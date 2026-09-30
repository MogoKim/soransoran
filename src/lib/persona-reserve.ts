/**
 * Persona **4상태 판정 정본** — 🔴 순수 함수. DB · 파일 · 네트워크 · LLM 없음 (2026-09-30)
 *
 *   designed               카드(설계)는 있으나 DB 행이 없다 — 저장된 seed 가 없으니 잴 것이 없다
 *   qualification-pending  DB 행은 있으나 계약 축 중 하나라도 막혔거나 **모른다**
 *   reserve                계약을 전부 통과했고 아직 active 가 아니다 (draft · paused)
 *   stage-active           계약을 전부 통과했고 DB status = active
 *   (retired 는 네 상태 밖이다 — 용량이 아니고, 다시 켜는 대상도 아니다)
 *
 * 🔴 **이름·active 행은 용량이 아니다** (정본 2026-09-30). 용량은 `contractValid`
 *    = reserve + stage-active 하나다. active 행이 40 이어도 계약을 통과한 사람이 0 이면 0 이다.
 *
 * 🔴 **저장 칸을 늘리지 않는다.** 상태는 DB status(draft/active/paused/retired) + 카드 · seed ·
 *    Post/Comment 이력에서 **계산**한다. 같은 입력이면 언제나 같은 상태다.
 *
 * 🔴 **이 파일이 대체한 옛 판정** — 같은 결정을 두 곳에서 하지 않는다.
 *    ① `scripts/lib/persona-autogen.mts` 의 ⑧ 단계: `candidateOf({ status: 'active',
 *       daysSinceActive: 0 })` 로 휴면·퇴역을 **거짓 입력으로** 지우고 `qualificationConflict` 를
 *       판정에서 뺀 별도 기준. → `contractAxes` 하나를 부른다(자격 충돌도 잰다).
 *    ② `scripts/lib/d100-persona-tiers.mts` 의 "active 행 = 쓸 수 있는 사람" 관점 —
 *       reserve 를 원리적으로 셀 수 없었다(draft 는 늘 retired+dormant). → `judgePersonaReserve`.
 *
 * 🔴 축 판정의 원시 규칙(생활사 14축 · 말투 3건 · 쏠림 0.5 · 연속 노출 1 · 짝 간격 5)은
 *    `d100-persona-scale` 의 `personaTiers` 가 정본이다. 여기서 숫자를 다시 적지 않는다 —
 *    **어느 코드가 계약에 들어가는가**만 정한다.
 */
import {
  DORMANT_AFTER_DAYS, PERSONA_LIFE_AXES, personaTiers, type PersonaBlockCode, type PersonaCandidate,
} from './d100-persona-scale'
import {
  PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET, type D100Stage,
} from './d100-capacity'
import { DEFAULT_FINGERPRINT_THRESHOLDS } from './persona-fingerprint-thresholds'
import { judgeRealMember, type RealMemberProbe } from './real-member-gate'

// ─────────────────────────────────────────────────────────
// 상태 · 축
// ─────────────────────────────────────────────────────────

export const RESERVE_STATES = ['designed', 'qualification-pending', 'reserve', 'stage-active'] as const
export type ReserveState = (typeof RESERVE_STATES)[number]

export type PersonaDbStatus = 'draft' | 'active' | 'paused' | 'retired'

/**
 * 🔴 **계약 축 8개.** 하나라도 막히거나 모르면 contract-valid 가 아니다.
 *
 *    카드  lifeAxes · ageBand · voiceEvidence · qualificationConflict
 *    Pool  topicShare · roleShare                      — 막히면 계약 실패(오래 가는 성질이다)
 *    회차  consecutiveExposures · postsSinceLastPairing — **모르면** 계약 실패,
 *          막힌 것은 "이번 회차만 못 쓴다"(`roundBlocked`) — 용량이 출렁이지 않게
 */
export const CONTRACT_AXES = [
  'lifeAxes', 'ageBand', 'voiceEvidence', 'qualificationConflict',
  'topicShare', 'roleShare', 'consecutiveExposures', 'postsSinceLastPairing',
] as const
export type ContractAxis = (typeof CONTRACT_AXES)[number]

/** 🔴 `personaTiers` 코드 → 계약 축. 여기 없는 코드는 계약이 아니다(아래 이유) */
const AXIS_OF_CODE: Readonly<Partial<Record<PersonaBlockCode, ContractAxis>>> = {
  lifeAxisMissing: 'lifeAxes',
  noAgeBand: 'ageBand',
  voiceEvidenceThin: 'voiceEvidence',
  qualificationConflict: 'qualificationConflict',
  topicConcentrated: 'topicShare',
  roleConcentrated: 'roleShare',
  consecutiveExposure: 'consecutiveExposures',
  pairRepeat: 'postsSinceLastPairing',
}

/**
 * 🔴 **계약에서 빼는 코드와 이유** — 빼는 것도 한 곳에만 적는다.
 *
 *    retired         status 로 판정한다. 옛 어댑터는 `status !== 'active'` 를 퇴역으로 적어
 *                    draft(= reserve 후보) 를 전부 퇴역으로 만들었다
 *    dormant         **켜는 상태의 관찰값**이지 자격이 아니다. 정본은 "활동을 위해 켜지 않는다" —
 *                    reserve 는 정의상 활동이 없고, 쓰이지 않은 active 는 cohort 가 크다는 신호다.
 *                    자격으로 두면 휴면 → 배정 제외 → 활동 불가 → 영구 휴면의 교착이 된다.
 *                    대신 `observations.dormantActive` 로 보고한다
 *    activityOverCap 오늘 하루의 사실이다 — 용량이 날마다 출렁이게 두지 않는다
 */
export const CONTRACT_EXCLUDED_CODES: Readonly<Partial<Record<PersonaBlockCode, string>>> = {
  retired: 'status 로 판정 — 계약 축이 아니다',
  dormant: '켜는 상태의 관찰값 — observations.dormantActive 로 보고',
  activityOverCap: '오늘 하루의 사실 — 회차 판정이 본다',
}

const ROUND_AXES: ReadonlySet<ContractAxis> = new Set(['consecutiveExposures', 'postsSinceLastPairing'])

// ─────────────────────────────────────────────────────────
// 입력
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **자격 충돌의 재료** — 운영 검증기 네 개의 결과를 그대로 받는다.
 *    `verifySeedCard`(저장 seed ↔ 정본 카드) · `judgeRealMember` · Gate ⑥-B · planner `seedComplete`.
 */
export type QualificationEvidence = {
  /** `verifySeedCard` 문제 목록. `null` = 정본 카드 문서를 읽지 못했다 */
  seedProblems: readonly string[] | null
  realMember: RealMemberProbe
  /** Gate ⑥-B 표시명 판정. `null` = 재지 못했다(사유는 `nameGateUnknown`) */
  nameGate: 'pass' | 'review' | 'regenerate' | 'reject' | null
  nameGateUnknown?: string
  /** planner materializer 와 같은 뜻 — identity · voiceCore · lifeStage 가 모두 있는가 */
  seedComplete: boolean
}

/**
 * 🔴 **활동 이력** — Post/Comment.personaId 에서 계산한 값(`historyFromEvents`).
 *    `null` 을 넘기면 "이력을 읽지 못했다" 이다 — 이력 0 과 다르다.
 */
export type ActivityHistory = {
  /** 최근 창(`RECENT_WINDOW_DAYS`) 안 이 사람의 공개 글 + 댓글 수 */
  recentEvents: number
  /** 최근 창 안 댓글의 역할별 수 (`PersonaApprovalQueue.reactionType`) */
  roleCounts: Readonly<Record<string, number>>
  /** 최근 창 안 댓글 중 역할을 찾지 못한 수 — 하나라도 있으면 역할 쏠림은 모른다 */
  unresolvedRoleEvents: number
  /** 공개 글 순서의 맨 끝에서부터 이 사람이 연속으로 쓴 글 수 */
  consecutiveExposures: number
  /** 다른 Persona 와 한 글에 마지막으로 함께 나온 뒤 지나간 공개 글 수 */
  postsSinceLastPairing: number | 'never'
  /** 마지막 활동 이후 지난 날. `null` = 활동 이력 0 */
  daysSinceActive: number | null
  /** 오늘(KST) 활동 수 — 계약이 아니라 회차 판정의 재료다 */
  activityToday: number
}

export type PersonaReserveInput = {
  code: string
  /** DB 행이 있는가 — 없으면 designed */
  stored: boolean
  status: PersonaDbStatus | null
  /** 카드 층 원자료 — `candidateOf` 가 옮긴 값 */
  card: { filledAxes: readonly string[]; ageBand: string | null; voiceComments: number }
  /** `null` = 자격 재료를 읽지 못했다 */
  qualification: QualificationEvidence | null
  /** `null` = 이력을 읽지 못했다 */
  history: ActivityHistory | null
}

// ─────────────────────────────────────────────────────────
// 축 하나씩
// ─────────────────────────────────────────────────────────

export type AxisOutcome =
  | { status: 'pass'; evidence?: string }
  | { status: 'blocked'; detail: string }
  | { status: 'unknown'; reason: string }

/**
 * 🔴 **자격 충돌** — 넷 중 하나라도 충돌이면 충돌, 충돌이 없는데 하나라도 모르면 모른다.
 *    `false`(충돌 없음)는 **넷 다 재고 넷 다 깨끗할 때만** 나온다.
 */
export function judgeQualification(e: QualificationEvidence | null): AxisOutcome {
  if (e === null) return { status: 'unknown', reason: '자격 재료를 읽지 못했다' }
  const conflicts: string[] = []
  const unknown: string[] = []
  if (e.seedProblems === null) unknown.push('정본 카드 문서를 읽지 못해 seed 를 대조하지 못했다')
  else if (e.seedProblems.length > 0) conflicts.push(`seed≠정본 ${e.seedProblems.length}건 (${e.seedProblems.slice(0, 3).join(' / ')})`)
  const real = judgeRealMember(e.realMember)
  if (real.real) (real.unknown ? unknown : conflicts).push(`실회원 ${real.reason}`)
  if (e.nameGate === null) unknown.push(`표시명 Gate ⑥-B 미측정${e.nameGateUnknown ? ` — ${e.nameGateUnknown}` : ''}`)
  else if (e.nameGate !== 'pass') conflicts.push(`표시명 Gate ⑥-B ${e.nameGate}`)
  if (!e.seedComplete) conflicts.push('seed 불완전(identity·voiceCore·lifeStage) — planner PERSONA_SEED_INCOMPLETE')
  if (conflicts.length > 0) return { status: 'blocked', detail: conflicts.join(' · ') }
  if (unknown.length > 0) return { status: 'unknown', reason: unknown.join(' · ') }
  return { status: 'pass' }
}

/**
 * 🔴 **쏠림 비율의 표본 하한** — Gate ⑧ 의 정본 `minSamples` 를 그대로 쓴다.
 *    "표본이 적으면 비율이 튄다 — 이 수 미만은 재지 않는다". 댓글 1건이면 한 역할이 100% 다 —
 *    그것은 쏠림이 아니라 표본이 없는 것이다.
 */
export const SHARE_MIN_EVENTS = DEFAULT_FINGERPRINT_THRESHOLDS.minSamples

/**
 * 🔴 **역할 쏠림** — 역할은 `PersonaApprovalQueue.reactionType` 이 유일한 원천이다.
 *
 *    역할 모르는 댓글이 있다     → unknown (그 한 건이 쏠림을 뒤집을 수 있다)
 *    댓글 0                      → 0 · 근거 없음(이력 0 = 쏠릴 재료가 없다 — 측정한 사실이다)
 *    댓글 < SHARE_MIN_EVENTS     → 0 · 근거 얇음(비율을 재지 않는다 — Gate ⑧ 과 같은 규칙)
 *    그 이상                     → 가장 많은 역할의 비율
 */
export function roleShareOf(h: ActivityHistory): { value: number; evidence: string } | { unknown: string } {
  if (h.unresolvedRoleEvents > 0) return { unknown: `역할을 찾지 못한 댓글 ${h.unresolvedRoleEvents}건` }
  const counts = Object.values(h.roleCounts)
  const total = counts.reduce((a, n) => a + n, 0)
  if (total === 0) return { value: 0, evidence: 'none' }
  if (total < SHARE_MIN_EVENTS) return { value: 0, evidence: `thin(${total}<${SHARE_MIN_EVENTS})` }
  return { value: Math.max(...counts) / total, evidence: `n=${total}` }
}

/**
 * 🔴 **소재 쏠림** — 소재를 담는 칸이 어느 표에도 없다(Persona 글 `Post.category` 전부 null ·
 *    `PersonaApprovalQueue.topicTags` 채워진 행 0 · 수집 원문·후보에 소재 칸 없음).
 *    🔴 **소재 정의 없이 분류표를 지어내지 않는다.**
 *    표본 하한은 역할 쏠림과 **같은 정본 `SHARE_MIN_EVENTS`** 다(Gate ⑧ 과 같은 규칙):
 *      활동 0                    → 0 · none(분류할 것이 없다)
 *      활동 1 ~ SHARE_MIN_EVENTS-1 → 0 · thin(비율 자체를 재지 않는 구간 — 라벨이 있어도 답이 같다)
 *      그 이상                    → 소재 라벨이 없으므로 **모른다**
 *    🔴 앞판은 활동이 한 건이라도 있으면 모른다고 했다 — 라벨이 판정을 바꿀 수 없는 구간까지 모름으로 두었다(2026-10-01 실측 17/18명).
 */
export const TOPIC_UNKNOWN_REASON =
  '소재 정의가 없다 — Post.category(Persona 글 전부 null)·Queue.topicTags(0행)·원문 어디에도 소재 칸이 없고, '
  + '분류표를 새로 지어내지 않는다'

export function topicShareOf(h: ActivityHistory): { value: number; evidence: string } | { unknown: string } {
  if (h.recentEvents === 0) return { value: 0, evidence: 'none' }
  if (h.recentEvents < SHARE_MIN_EVENTS) return { value: 0, evidence: `thin(${h.recentEvents}<${SHARE_MIN_EVENTS})` }
  return { unknown: TOPIC_UNKNOWN_REASON }
}

// ─────────────────────────────────────────────────────────
// 한 사람
// ─────────────────────────────────────────────────────────

export type ContractVerdict = {
  /** 계약을 전부 통과했는가 — blocked 0 · unknown 0 */
  valid: boolean
  blocked: Partial<Record<ContractAxis, string>>
  unknown: Partial<Record<ContractAxis, string>>
  /** 🔴 회차 축이 **이번 회차에** 막혔다 — 계약 실패가 아니다 */
  roundBlocked: ContractAxis[]
  /** 근거가 얇거나 없는 축 — 통과했지만 관측이 없다는 뜻 */
  evidence: Partial<Record<ContractAxis, string>>
}

/**
 * 🔴 **계약 축 판정 — 이 한 함수가 정본이다.** 운영 계기판(DB 행)과 자동 생성(메모리 후보)이
 *    둘 다 이것을 부른다. 원시 규칙은 `personaTiers` 가 내고, 여기서는 계약에 들 코드만 고른다.
 */
export function contractAxes(p: Pick<PersonaReserveInput, 'code' | 'card' | 'qualification' | 'history'>): ContractVerdict {
  const blocked: ContractVerdict['blocked'] = {}
  const unknown: ContractVerdict['unknown'] = {}
  const evidence: ContractVerdict['evidence'] = {}

  const q = judgeQualification(p.qualification)
  const h = p.history
  const topic = h === null ? { unknown: '이력을 읽지 못했다' } : topicShareOf(h)
  const role = h === null ? { unknown: '이력을 읽지 못했다' } : roleShareOf(h)

  const cand: PersonaCandidate = {
    code: p.code,
    filledAxes: p.card.filledAxes,
    ageBand: p.card.ageBand,
    voiceComments: p.card.voiceComments,
    activityToday: h?.activityToday ?? 0,
    consecutiveExposures: h === null ? null : h.consecutiveExposures,
    // 🔴 dormant 는 계약에서 뺀다(CONTRACT_EXCLUDED_CODES) — 값은 정직하게 넘긴다
    daysSinceActive: h?.daysSinceActive ?? Number.MAX_SAFE_INTEGER,
    retired: false,
    qualificationConflict: q.status === 'unknown' ? null : q.status === 'blocked',
    topicShare: 'unknown' in topic ? null : topic.value,
    roleShare: 'unknown' in role ? null : role.value,
    postsSinceLastPairing: h === null ? null : h.postsSinceLastPairing,
  }
  const t = personaTiers(cand)
  const roundBlocked: ContractAxis[] = []

  for (const code of [...t.card.blocked, ...t.pool.blocked, ...t.assignment.blocked]) {
    const axis = AXIS_OF_CODE[code]
    if (axis === undefined) continue // CONTRACT_EXCLUDED_CODES
    if (ROUND_AXES.has(axis)) { roundBlocked.push(axis); continue }
    blocked[axis] = axis === 'qualificationConflict' && q.status === 'blocked' ? q.detail
      : axis === 'lifeAxes'
        ? `생활사 ${PERSONA_LIFE_AXES.length}축 중 빈 축: ${PERSONA_LIFE_AXES.filter((a) => !p.card.filledAxes.includes(a)).join('·')}`
        : axis === 'voiceEvidence' ? `말투 근거 ${p.card.voiceComments}건`
          : axis === 'roleShare' && !('unknown' in role) ? `역할 쏠림 ${role.value.toFixed(2)} (${role.evidence})`
            : code
  }
  for (const code of [...t.card.unmeasured, ...t.pool.unmeasured, ...t.assignment.unmeasured]) {
    const axis = AXIS_OF_CODE[code]
    if (axis === undefined) continue
    unknown[axis] = axis === 'qualificationConflict' && q.status === 'unknown' ? q.reason
      : axis === 'topicShare' && 'unknown' in topic ? topic.unknown
        : axis === 'roleShare' && 'unknown' in role ? role.unknown
          : '이력을 읽지 못했다'
  }
  if (!('unknown' in topic)) evidence.topicShare = topic.evidence
  if (!('unknown' in role) && !role.evidence.startsWith('n=')) evidence.roleShare = role.evidence
  if (h !== null && h.recentEvents === 0 && h.daysSinceActive === null) {
    evidence.consecutiveExposures = 'none'
    evidence.postsSinceLastPairing = 'none'
  }

  return {
    valid: Object.keys(blocked).length === 0 && Object.keys(unknown).length === 0,
    blocked, unknown, roundBlocked, evidence,
  }
}

export type PersonaReserveVerdict = {
  code: string
  /** retired 는 네 상태 밖 — `null` */
  state: ReserveState | null
  status: PersonaDbStatus | null
  contract: ContractVerdict | null
  observations: {
    /** active 인데 마지막 활동이 DORMANT_AFTER_DAYS 이상 전 — cohort 가 크다는 신호 */
    dormantActive: boolean
    /** 활동 이력 0 — cadence 를 본 적이 없다(쏠림 0 은 참이지만 리듬 근거는 없다) */
    noCadenceEvidence: boolean
  }
}

/** 🔴 한 사람의 상태 — 저장 여부 → 계약 → DB status 순서로만 정한다 */
export function judgePersonaState(p: PersonaReserveInput): PersonaReserveVerdict {
  const obs = {
    dormantActive: p.status === 'active' && p.history !== null && p.history.daysSinceActive !== null
      && p.history.daysSinceActive >= DORMANT_AFTER_DAYS,
    noCadenceEvidence: p.history !== null && p.history.daysSinceActive === null,
  }
  if (p.status === 'retired') return { code: p.code, state: null, status: p.status, contract: null, observations: obs }
  if (!p.stored || p.status === null) {
    return { code: p.code, state: 'designed', status: null, contract: null, observations: obs }
  }
  const contract = contractAxes(p)
  const state: ReserveState = !contract.valid ? 'qualification-pending'
    : p.status === 'active' ? 'stage-active' : 'reserve'
  return { code: p.code, state, status: p.status, contract, observations: obs }
}

// ─────────────────────────────────────────────────────────
// 전체
// ─────────────────────────────────────────────────────────

export type PersonaReserveRead =
  | { ok: true; personas: readonly PersonaReserveInput[] }
  | { ok: false; detail: string }

export type PersonaReserveResult = {
  /**
   * 🔴 **용량 정본** = reserve + stage-active. 읽기 실패면 `null` — 0 이 아니다.
   *    `judgeNextPreflight` 의 `contractValidPersonas` 가 이 값을 받는다.
   */
  contractValid: number | null
  byState: Readonly<Record<ReserveState, string[]>>
  retired: string[]
  /** 축별로 누가 막혔고(blocked) 누가 모르는가(unknown) — 저장된 사람만 센다 */
  gapsByAxis: Readonly<Record<ContractAxis, { blocked: string[]; unknown: string[] }>>
  /** 🔴 DB active 행 수 — **용량이 아니다.** 비교용으로만 낸다 */
  activeRows: number
  /** active 인데 계약을 통과하지 못한 사람 — "행은 있는데 용량은 없다" */
  activeNotContractValid: string[]
  verdicts: PersonaReserveVerdict[]
  detail: string | null
}

export function judgePersonaReserve(read: PersonaReserveRead): PersonaReserveResult {
  const byState = Object.fromEntries(RESERVE_STATES.map((s) => [s, [] as string[]])) as Record<ReserveState, string[]>
  const gaps = Object.fromEntries(
    CONTRACT_AXES.map((a) => [a, { blocked: [] as string[], unknown: [] as string[] }]),
  ) as Record<ContractAxis, { blocked: string[]; unknown: string[] }>
  if (!read.ok) {
    // 🔴 fail-closed — 못 읽었으면 0 명이 아니라 모른다
    return {
      contractValid: null, byState, retired: [], gapsByAxis: gaps, activeRows: 0,
      activeNotContractValid: [], verdicts: [], detail: read.detail,
    }
  }
  const verdicts = [...read.personas].sort((a, b) => a.code.localeCompare(b.code)).map(judgePersonaState)
  const retired: string[] = []
  const activeNotContractValid: string[] = []
  for (const v of verdicts) {
    if (v.state === null) { retired.push(v.code); continue }
    byState[v.state].push(v.code)
    if (v.status === 'active' && v.state !== 'stage-active') activeNotContractValid.push(v.code)
    if (v.contract === null) continue
    for (const a of Object.keys(v.contract.blocked) as ContractAxis[]) gaps[a].blocked.push(v.code)
    for (const a of Object.keys(v.contract.unknown) as ContractAxis[]) gaps[a].unknown.push(v.code)
  }
  return {
    contractValid: byState.reserve.length + byState['stage-active'].length,
    byState, retired, gapsByAxis: gaps,
    activeRows: verdicts.filter((v) => v.status === 'active').length,
    activeNotContractValid, verdicts, detail: null,
  }
}

/**
 * 🔴 **단계 하한 대비 부족분** — 하한은 `d100-capacity` 정본 그대로다. 여기서 낮추지 않는다.
 *    `contractValid === null` 이면 부족분도 모른다(`null`) — 충족으로 읽히지 않게.
 */
export function reserveFloorGap(contractValid: number | null, stage: D100Stage): {
  stage: D100Stage
  canaryFloor: number
  sustainedTarget: number
  canaryShortfall: number | null
  sustainedShortfall: number | null
  canaryMet: boolean | null
} {
  const canaryFloor = PERSONA_CANARY_FLOOR[stage]
  const sustainedTarget = PERSONA_SUSTAINED_TARGET[stage]
  return {
    stage, canaryFloor, sustainedTarget,
    canaryShortfall: contractValid === null ? null : Math.max(0, canaryFloor - contractValid),
    sustainedShortfall: contractValid === null ? null : Math.max(0, sustainedTarget - contractValid),
    canaryMet: contractValid === null ? null : contractValid >= canaryFloor,
  }
}

// ─────────────────────────────────────────────────────────
// 이력 계산 — 🔴 순수. 어댑터는 읽기만 하고 여기로 넘긴다
// ─────────────────────────────────────────────────────────

/** 🔴 "최근 활동" 의 창 — 휴면 기준과 같은 30일. 새 숫자를 만들지 않는다 */
export const RECENT_WINDOW_DAYS = DORMANT_AFTER_DAYS

export type PostEvent = { id: string; personaId: string | null; at: Date }
export type CommentEvent = { id: string; postId: string; personaId: string; at: Date }

const DAY_MS = 86_400_000
const kstDayStart = (now: Date): number => {
  const k = new Date(now.getTime() + 9 * 3_600_000)
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3_600_000
}

/**
 * 🔴 **Post/Comment.personaId 이력 → 사람별 `ActivityHistory`.**
 *
 *    posts     공개 글 전체(회원 글 포함) — 순서가 "회차" 다. 연속 노출·짝 간격을 이 순서로 센다
 *    comments  Persona 댓글
 *    roleOf    댓글 id → reactionType (발행된 Queue 행). 없으면 그 댓글의 역할은 모른다
 *
 *    연속 노출   글 순서 맨 끝부터 이 사람이 **글쓴이로** 연속한 수 (회원 글이 끼면 끊긴다)
 *    짝 간격     글쓴이·댓글 단 Persona 가 둘 이상인 글 중 이 사람이 낀 마지막 글 이후 지나간 글 수
 *    이력 0      recentEvents 0 · 연속 0 · 짝 'never' · daysSinceActive null — **측정한 0** 이다
 */
export function historyFromEvents(input: {
  personaIds: readonly string[]
  posts: readonly PostEvent[]
  comments: readonly CommentEvent[]
  roleOf: ReadonlyMap<string, string>
  now: Date
}): Map<string, ActivityHistory> {
  const seq = [...input.posts].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))
  const indexOf = new Map(seq.map((p, i) => [p.id, i]))
  const participants = new Map<string, Set<string>>()
  for (const p of seq) participants.set(p.id, new Set(p.personaId === null ? [] : [p.personaId]))
  for (const c of input.comments) participants.get(c.postId)?.add(c.personaId)

  const since = input.now.getTime() - RECENT_WINDOW_DAYS * DAY_MS
  const today = kstDayStart(input.now)
  const out = new Map<string, ActivityHistory>()
  for (const id of input.personaIds) {
    const myPosts = seq.filter((p) => p.personaId === id)
    const myComments = input.comments.filter((c) => c.personaId === id)
    const recentPosts = myPosts.filter((p) => p.at.getTime() >= since)
    const recentComments = myComments.filter((c) => c.at.getTime() >= since)
    const roleCounts: Record<string, number> = {}
    let unresolved = 0
    for (const c of recentComments) {
      const r = input.roleOf.get(c.id)
      if (r === undefined || r.trim() === '') unresolved += 1
      else roleCounts[r] = (roleCounts[r] ?? 0) + 1
    }
    let streak = 0
    for (let i = seq.length - 1; i >= 0 && seq[i]!.personaId === id; i -= 1) streak += 1
    let lastPair = -1
    for (const [postId, set] of participants) {
      if (set.size >= 2 && set.has(id)) lastPair = Math.max(lastPair, indexOf.get(postId) ?? -1)
    }
    const times = [...myPosts.map((p) => p.at.getTime()), ...myComments.map((c) => c.at.getTime())]
    const last = times.length === 0 ? null : Math.max(...times)
    out.set(id, {
      recentEvents: recentPosts.length + recentComments.length,
      roleCounts,
      unresolvedRoleEvents: unresolved,
      consecutiveExposures: streak,
      postsSinceLastPairing: lastPair < 0 ? 'never' : seq.length - 1 - lastPair,
      daysSinceActive: last === null ? null : Math.floor((input.now.getTime() - last) / DAY_MS),
      activityToday: times.filter((t) => t >= today).length,
    })
  }
  return out
}
