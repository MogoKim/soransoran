/**
 * Persona **30 → 40 → 60 → 300 확장 계약** — 🔴 순수 함수. DB · 파일 · 네트워크 · LLM 없음 (2026-10-13)
 *
 * 🔴 **이 파일은 Persona 를 만들지도 켜지도 않는다.** 세 가지만 답한다.
 *
 *      ① 단계마다 무엇이 모자라는가 — 계약 유효 인원 · 말투 화자 · 닉네임 공간 · 코드 공간
 *      ② 새 묶음이 집단을 한쪽으로 기울이는가 — 축 쏠림 · 성격어 남용 · 핵심 연령 · 생활사 복제
 *      ③ 지금 30명의 활동이 몇 명에게 몰려 있는가 — 상위 점유 · 유효 인원
 *
 * 🔴 **게시 상한을 Persona 수로 계산하지 않는다.** 하루 공개 글 수는 `d100-capacity` 의 단계 계획과
 *    stage preflight(공급 · READY · 첫 댓글 실측)가 정한다. Persona 를 늘려도 글이 늘지 않고,
 *    글을 늘리려고 Persona 를 늘리지 않는다 — 이 파일의 반환 타입에 글·슬롯 칸이 없는 이유다.
 *
 * 🔴 **목표 인원은 여기 다시 적지 않는다.** `PERSONA_CANARY_FLOOR` · `PERSONA_SUSTAINED_TARGET` 에서 읽는다.
 *
 * 🔴 **새 후보는 운영 universe 밖에 있다.** `PROPOSED_COHORTS` 는 `persona-cohort.COHORTS` 와 다른 표다 —
 *    `COHORTS` 에 올리는 순간 `PRODUCTION_PERSONA_CODES` 가 바뀌고 말투 고정 배정이 다시 계산된다.
 *    올리는 일은 활성화 단계의 커밋이다(runbook `2026-10-13-persona-expansion-runbook.md`).
 */
import { PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET, type D100Stage } from './d100-capacity'
import { readLengthBand } from './original-post-persona-match'
import type { LifeSkeleton, PersonaCreative } from './persona-autogen'
import type { CohortId } from './persona-cohort'
import { comparePersonaCodes, isPersonaCode, PERSONA_CODE_MAX, personaCodeNumber } from './persona-code'
import type { PoolCard } from './persona-pool-card'

// ─────────────────────────────────────────────────────────
// ① 단계 — 정본 목표에서 파생한다
// ─────────────────────────────────────────────────────────

export const EXPANSION_STEP_IDS = ['d20-canary', 'd20-sustained', 'd100-sustained'] as const
export type ExpansionStepId = (typeof EXPANSION_STEP_IDS)[number]

export type ExpansionStep = {
  id: ExpansionStepId
  stage: D100Stage
  kind: 'canary' | 'sustained'
  /** 🔴 계약 유효 인원 목표 — `d100-capacity` 정본에서 읽은 값 */
  target: number
  /** 이 단계를 시작하기 전에 운영 증거로 닫혀 있어야 하는 단계 */
  requires: ExpansionStepId | null
  /** 사람이 읽을 한 줄 */
  purpose: string
}

/**
 * 🔴 **세 단계.** 숫자는 정본 표에서 온다 — D20 canary 40 · D20 지속 60 · D100 지속 300(하한).
 *    D30·D50 지속(90·150)은 D100 지속으로 가는 길의 중간 점이며 같은 계약으로 잰다(`planExpansionStep`).
 */
export const EXPANSION_STEPS: readonly ExpansionStep[] = [
  {
    id: 'd20-canary', stage: 'd20', kind: 'canary', target: PERSONA_CANARY_FLOOR.d20, requires: null,
    purpose: 'D20 하루 시험을 켤 최소 계약 유효 인원 — 신규 10명 canary',
  },
  {
    id: 'd20-sustained', stage: 'd20', kind: 'sustained', target: PERSONA_SUSTAINED_TARGET.d20, requires: 'd20-canary',
    purpose: 'D20 을 계속 운영할 다양성 목표',
  },
  {
    id: 'd100-sustained', stage: 'd100', kind: 'sustained', target: PERSONA_SUSTAINED_TARGET.d100, requires: 'd20-sustained',
    purpose: 'D100 지속 다양성 하한(300명 이상)',
  },
]

export function expansionStepOf(id: string): ExpansionStep | null {
  return EXPANSION_STEPS.find((s) => s.id === id) ?? null
}

// ─────────────────────────────────────────────────────────
// 제안 cohort — 🔴 운영 universe 밖. 기본 비활성
// ─────────────────────────────────────────────────────────

export type ProposedCohort = {
  id: string
  step: ExpansionStepId
  purpose: string
  codes: readonly string[]
  /** 🔴 이 cohort 를 `COHORTS` 로 올리기 전에 전부 active 여야 하는 운영 cohort */
  requires: readonly CohortId[]
  /** 🔴 후보 원자료(생활사 · creative · 표시명 · 관심사 · 게시판) — 저장소 fixture */
  fixture: string
}

/**
 * 🔴 **canary 10명 — 제안 상태다.** 운영 DB 행도, cohort 도, 말투 배정도 없다.
 *    코드는 high-water(P33 · 폐기 P31·P33 포함) 뒤 append-only 로 잡았다(`nextAutogenCodes` 와 같은 규칙).
 */
export const PROPOSED_COHORTS: readonly ProposedCohort[] = [
  {
    id: 'wave6-d20-canary',
    step: 'd20-canary',
    purpose: 'D20 canary 40 — 신규 10명 (기본 비활성 · 운영 DB write 0)',
    codes: ['P34', 'P35', 'P36', 'P37', 'P38', 'P39', 'P40', 'P41', 'P42', 'P43'],
    requires: ['wave1-mvp', 'wave2', 'wave3-scale', 'wave4-depth', 'wave5-d10'],
    fixture: 'scripts/__fixtures__/persona-expansion-canary.json',
  },
]

// ─────────────────────────────────────────────────────────
// 코드 공간 — 🔴 코드 형식이 300 을 막는 곳
// ─────────────────────────────────────────────────────────

/** 이미 제거된 코드 한계를 과거 보고와 호환되는 모양으로만 남긴다. 현재 한계는 `PERSONA_CODE_MAX` 하나다. */
export type CodeFormatLimit = {
  file: string
  pattern: string
  max: number
  kind: 'regex' | 'order'
  effect: string
}

export const CODE_FORMAT_LIMITS: readonly CodeFormatLimit[] = []

/** 🔴 지금 소스가 받아 주는 가장 큰 코드 번호 — 가장 좁은 한계 */
export function codeCeiling(limits: readonly CodeFormatLimit[] = CODE_FORMAT_LIMITS): number {
  return limits.length === 0 ? PERSONA_CODE_MAX : Math.min(PERSONA_CODE_MAX, ...limits.map((l) => l.max))
}

/**
 * 🔴 **코드 순서가 안전한가** — 전부 정본 코드이고 이미 숫자순이어야 한다.
 */
export function codeOrderSafe(codes: readonly string[]): boolean {
  return codes.every(isPersonaCode) && codes.every((c, i) => i === 0 || comparePersonaCodes(codes[i - 1]!, c) < 0)
}

/**
 * 🔴 **남은 코드 수.** high-water(카드 · DB · 폐기 코드 중 최대 번호) 뒤에서 `ceiling` 까지.
 *    빈 번호는 다시 쓰지 않는다(append-only — `nextAutogenCodes` 와 같은 규칙).
 */
export function codeRoom(input: { usedCodes: Iterable<string>; retiredCodes: Iterable<string>; ceiling: number }): {
  highWater: number
  room: number
} {
  const nums = [...input.usedCodes, ...input.retiredCodes].map(personaCodeNumber).filter((n): n is number => n !== null)
  const highWater = nums.length === 0 ? 0 : Math.max(...nums)
  return { highWater, room: Math.max(0, input.ceiling - highWater) }
}

// ─────────────────────────────────────────────────────────
// ① 단계 계획 — 자원별로 모자람을 말한다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **확장 자원.** 재지 못한 것은 `null` 이다 — 0 이 아니다(0 은 "없다" 를 잰 값이다).
 *
 *    contractValid      운영 4상태의 계약 유효 수(`readPersonaReserve`) — 활성 행 수가 아니다
 *    voiceSpeakersFree  정본 말투 자산에서 아직 아무 Persona 에게 배정되지 않은 화자 수
 *    namesFree          지금 쓰인 이름과도, 서로도 Gate ⑥-B 로 부딪히지 않는 후보 이름 수
 *    codesFree          코드 형식 한계 안에서 남은 코드 수
 */
export type ExpansionResources = {
  contractValid: number | null
  voiceSpeakersFree: number | null
  namesFree: number | null
  codesFree: number
  /** `codesFree` 를 정한 한계 — 보고용 */
  codeCeiling: number
}

export const EXPANSION_BLOCK_CODES = [
  'CONTRACT_VALID_UNKNOWN', 'VOICE_SPEAKERS_SHORT', 'VOICE_SPEAKERS_UNKNOWN',
  'NAME_SPACE_SHORT', 'NAME_SPACE_UNKNOWN', 'CODE_SPACE_SHORT',
] as const
export type ExpansionBlockCode = (typeof EXPANSION_BLOCK_CODES)[number]

export type ExpansionStepPlan = {
  step: ExpansionStepId
  target: number
  /** 지금 계약 유효 수 — 모르면 null */
  have: number | null
  /** 🔴 새로 서야 하는 계약 유효 Persona 수. `have` 를 모르면 null */
  need: number | null
  blocks: { code: ExpansionBlockCode; detail: string }[]
  /** 🔴 모자람도 모름도 없을 때만 true — 준비가 된 것이지 켜도 된다는 뜻이 아니다 */
  resourcesReady: boolean
}

/**
 * 🔴 **한 단계의 자원 판정.** 계약 유효 수를 모르면 필요 수도 모른다 — 0 으로 보지 않는다.
 *    `assumedContractValid` 를 주면 그 가정으로 자원 모자람을 **함께 보고**하지만, 계약 유효 수를 모른다는
 *    차단(`CONTRACT_VALID_UNKNOWN`)은 그대로 남는다 — 가정으로 준비 완료가 되지 않는다.
 *    🔴 반환에 글·슬롯·게시 칸이 없다. Persona 수로 게시 상한을 계산하지 않는다.
 */
export function planExpansionStep(
  step: ExpansionStep, r: ExpansionResources, opts: { assumedContractValid?: number } = {},
): ExpansionStepPlan {
  const blocks: ExpansionStepPlan['blocks'] = []
  const need = r.contractValid === null ? null : Math.max(0, step.target - r.contractValid)
  const assumed = need === null && opts.assumedContractValid !== undefined
  const compareNeed = need ?? (assumed ? Math.max(0, step.target - opts.assumedContractValid!) : null)
  const tag = assumed ? ` (가정: 계약 유효 ${opts.assumedContractValid})` : ''
  if (need === null) blocks.push({ code: 'CONTRACT_VALID_UNKNOWN', detail: '계약 유효 수를 읽지 못했다 — 필요 수를 모른다' })
  const short = (have: number | null, code: ExpansionBlockCode, unknown: ExpansionBlockCode, label: string): void => {
    if (have === null) { blocks.push({ code: unknown, detail: `${label}을 재지 못했다` }); return }
    if (compareNeed !== null && have < compareNeed) blocks.push({ code, detail: `${label} ${have} < 필요 ${compareNeed}${tag}` })
  }
  short(r.voiceSpeakersFree, 'VOICE_SPEAKERS_SHORT', 'VOICE_SPEAKERS_UNKNOWN', '남은 말투 화자')
  short(r.namesFree, 'NAME_SPACE_SHORT', 'NAME_SPACE_UNKNOWN', '남은 이름 후보')
  if (compareNeed !== null && r.codesFree < compareNeed) {
    blocks.push({ code: 'CODE_SPACE_SHORT', detail: `남은 코드 ${r.codesFree} < 필요 ${compareNeed}${tag} (현재 한계 P${r.codeCeiling})` })
  }
  return { step: step.id, target: step.target, have: r.contractValid, need, blocks, resourcesReady: blocks.length === 0 }
}

/**
 * 🔴 **이 단계까지 가려면 풀어야 하는 코드 형식 한계** — 한계 번호가 도달 번호보다 작은 줄 전부.
 *    도달 번호 = high-water + 새로 발급할 코드 수.
 */
export function codeLimitsToLift(input: {
  highWater: number
  newCodes: number
  limits?: readonly CodeFormatLimit[]
}): CodeFormatLimit[] {
  const reach = input.highWater + input.newCodes
  return (input.limits ?? CODE_FORMAT_LIMITS).filter((l) => l.max < reach)
}

// ─────────────────────────────────────────────────────────
// ② 집단 다양성 — 🔴 한 사람씩 다른 것과, 집단이 고른 것은 다르다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **집단을 보는 축.** 한 사람 단위 복제는 `judgeDistinctness`(성격 · 관점 · noGo · 생활사)가 이미 본다.
 *    여기서는 **모두가 서로 다른데도 집단이 한쪽으로 쏠리는 것**을 본다 —
 *    실측(2026-10-13 · autogen dry-run 10명): 얇은 축만 메우는 골격 선택이 10명 중 8명을 "자녀 2" 로,
 *    10명 중 9명을 기혼이 아닌 사람으로 골랐다. 한 명씩은 전부 달랐다.
 */
export type DiversitySubject = {
  code: string
  title: string
  ageBand: string
  region: string
  maritalStatus: string
  childrenCount: number
  childrenAgeBands: readonly string[]
  workStatus: string
  economicStatus: string
  housing: string
  parentCare: string
  personality: readonly string[]
  /** `readLengthBand` 밴드 — 말투 근거가 아직 없으면 null(그 축 집계에서 뺀다) */
  voiceBand: string | null
}

/**
 * 🔴 `childrenCount`(자녀 수)와 `children`(수 + 나이대)을 따로 본다. 나이대까지 묶으면 "자녀 2" 열 명이
 *    나이대만 달라 서로 다른 값으로 흩어지고 — 실측 반례(자녀 2 가 10명 중 8명)가 잡히지 않는다.
 */
export const DIVERSITY_AXES = [
  'ageBand', 'region', 'maritalStatus', 'childrenCount', 'children', 'workStatus', 'economicStatus', 'housing', 'parentCare', 'voiceBand',
] as const
export type DiversityAxis = (typeof DIVERSITY_AXES)[number]

const axisValue = (s: DiversitySubject, a: DiversityAxis): string | null => {
  if (a === 'childrenCount') return `${s.childrenCount}명`
  if (a === 'children') return s.childrenCount === 0 ? '무자녀' : `${s.childrenCount}명(${[...s.childrenAgeBands].join('/')})`
  if (a === 'voiceBand') return s.voiceBand
  const v = s[a]
  return v.trim() === '' ? null : v
}

/** 🔴 생활사 7칸 열쇠 — `persona-autogen.lifeKey` 와 같은 칸이다 */
const lifeKeyOf = (s: DiversitySubject): string => [
  s.ageBand, s.maritalStatus, [...s.childrenAgeBands].join('/'), s.workStatus, s.economicStatus, s.housing, s.parentCare,
].join('|')

/**
 * 🔴 **문턱 — 잠정값이다.** 회원 분포 실측이 없어 정본 비율을 지어내지 않고, 이미 있는 원칙에서 가져온다.
 *
 *    POPULATION_SHARE_MAX 0.6   한 값이 집단의 60% 를 넘으면 그 축은 사실상 한 사람이다
 *    BATCH_SHARE_MAX 0.7         새 묶음 안에서 한 값이 70% 를 넘으면 단일 품종 배치다
 *                                (작은 묶음은 우연히 반을 넘는다 — 그래서 집단 상한보다 느슨하다)
 *    BATCH_MIN_SIZE 5            이보다 작은 묶음은 비율이 뜻이 없다
 *    PERSONALITY_TERM_SHARE 0.1  한 성격어가 열 명 중 한 명을 넘게 설명하면 성격이 아니라 기본값이다
 *    PERSONALITY_TERM_FLOOR 3    작은 집단에서 10% 는 한두 명이라 바닥을 둔다
 *
 * 🔴 **"나빠지지 않으면 통과"** — 지금 30명이 이미 넘는 축은 묶음이 그 값을 **더 키울 때만** 막는다.
 *    기존 집단의 한계를 이유로 모든 확장을 막으면, 그 쏠림을 풀 묶음도 못 들어온다.
 */
export const POPULATION_SHARE_MAX = 0.6
export const BATCH_SHARE_MAX = 0.7
export const BATCH_MIN_SIZE = 5
export const PERSONALITY_TERM_SHARE = 0.1
export const PERSONALITY_TERM_FLOOR = 3

/** 🔴 핵심 타겟 연령대 — CLAUDE.md "핵심 타겟 50대". 집단에서 가장 큰 연령 십년대여야 한다 */
export const CORE_DECADE = '50대'

export type AxisShare = { axis: DiversityAxis; value: string; count: number; total: number; share: number }

/** 축별 최빈 값과 점유 — 값이 없는 사람은 그 축 분모에서 뺀다 */
export function topShares(subjects: readonly DiversitySubject[]): AxisShare[] {
  const out: AxisShare[] = []
  for (const axis of DIVERSITY_AXES) {
    const counts = new Map<string, number>()
    for (const s of subjects) {
      const v = axisValue(s, axis)
      if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    if (total === 0) continue
    const [value, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!
    out.push({ axis, value, count, total, share: count / total })
  }
  return out
}

/** 🔴 축별 유효 값 수(1/HHI) — 값이 고르게 퍼질수록 크다. 보고용이다(판정하지 않는다) */
export function effectiveValues(subjects: readonly DiversitySubject[]): Record<DiversityAxis, number> {
  const out = {} as Record<DiversityAxis, number>
  for (const axis of DIVERSITY_AXES) {
    const counts = new Map<string, number>()
    for (const s of subjects) {
      const v = axisValue(s, axis)
      if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    out[axis] = total === 0 ? 0 : 1 / [...counts.values()].reduce((a, c) => a + (c / total) ** 2, 0)
  }
  return out
}

const normTerm = (s: string): string => s.replace(/[\s·,.()~"'“”‘’]/g, '')

function personalityOwners(subjects: readonly DiversitySubject[]): Map<string, string[]> {
  const owners = new Map<string, string[]>()
  for (const s of subjects) {
    for (const t of new Set(s.personality.map(normTerm).filter((x) => x !== ''))) {
      owners.set(t, [...(owners.get(t) ?? []), s.code])
    }
  }
  return owners
}

const decadeShares = (subjects: readonly DiversitySubject[]): Map<string, number> => {
  const m = new Map<string, number>()
  for (const s of subjects) {
    const d = /^([4-6]0대)/.exec(s.ageBand)?.[1]
    if (d !== undefined) m.set(d, (m.get(d) ?? 0) + 1)
  }
  return m
}

export const DIVERSITY_RULES = [
  'POPULATION_AXIS_DOMINANT', 'BATCH_MONOCULTURE', 'PERSONALITY_TERM_OVERUSED', 'CORE_DECADE_NOT_PLURALITY',
  'LIFE_KEY_DUPLICATE',
] as const
export type DiversityRule = (typeof DIVERSITY_RULES)[number]

export type DiversityVerdict = {
  ok: boolean
  problems: { rule: DiversityRule; detail: string }[]
  /** 합친 집단의 축별 최빈 점유 — 보고용 */
  merged: AxisShare[]
  /** 묶음 안 축별 최빈 점유 — 보고용 */
  batch: AxisShare[]
  effective: Record<DiversityAxis, number>
}

/**
 * 🔴 **새 묶음이 집단을 기울이는가.** 기존 집단만으로 이미 넘은 한계는, 묶음이 그것을 더 키울 때만 막는다.
 */
export function judgePopulationDiversity(input: {
  existing: readonly DiversitySubject[]
  batch: readonly DiversitySubject[]
}): DiversityVerdict {
  const problems: DiversityVerdict['problems'] = []
  const merged = [...input.existing, ...input.batch]
  const shareOf = (subjects: readonly DiversitySubject[], axis: DiversityAxis, value: string): number => {
    const vals = subjects.map((s) => axisValue(s, axis)).filter((v): v is string => v !== null)
    return vals.length === 0 ? 0 : vals.filter((v) => v === value).length / vals.length
  }

  // ── 합친 집단의 축 쏠림 — 나빠질 때만 ──
  const mergedTop = topShares(merged)
  for (const t of mergedTop) {
    if (t.share <= POPULATION_SHARE_MAX) continue
    const prev = shareOf(input.existing, t.axis, t.value)
    if (t.share > prev + 1e-9) {
      problems.push({ rule: 'POPULATION_AXIS_DOMINANT',
        detail: `${t.axis}=${t.value} ${(t.share * 100).toFixed(0)}% > ${POPULATION_SHARE_MAX * 100}% (기존 ${(prev * 100).toFixed(0)}%)` })
    }
  }

  // ── 묶음 자체의 단일 품종 ──
  const batchTop = topShares(input.batch)
  if (input.batch.length >= BATCH_MIN_SIZE) {
    for (const t of batchTop) {
      if (t.total >= BATCH_MIN_SIZE && t.share > BATCH_SHARE_MAX) {
        problems.push({ rule: 'BATCH_MONOCULTURE',
          detail: `묶음 ${t.axis}=${t.value} ${t.count}/${t.total} > ${BATCH_SHARE_MAX * 100}%` })
      }
    }
  }

  // ── 성격어 남용 — 나빠질 때만 ──
  const cap = (n: number): number => Math.max(PERSONALITY_TERM_FLOOR, Math.ceil(n * PERSONALITY_TERM_SHARE))
  const prevOwners = personalityOwners(input.existing)
  for (const [term, codes] of personalityOwners(merged)) {
    if (codes.length <= cap(merged.length)) continue
    const prev = prevOwners.get(term)?.length ?? 0
    if (codes.length > prev) {
      problems.push({ rule: 'PERSONALITY_TERM_OVERUSED',
        detail: `성격어 "${term}" ${codes.length}명 > 상한 ${cap(merged.length)} (기존 ${prev}명 · ${codes.filter((c) => !(prevOwners.get(term) ?? []).includes(c)).join(',')})` })
    }
  }

  // ── 핵심 연령 — 50대가 가장 큰 십년대여야 한다 · 나빠질 때만 ──
  const dec = decadeShares(merged)
  const core = dec.get(CORE_DECADE) ?? 0
  const rival = [...dec.entries()].filter(([d]) => d !== CORE_DECADE).sort((a, b) => b[1] - a[1])[0]
  if (rival !== undefined && rival[1] > core) {
    const decPrev = decadeShares(input.existing)
    const gapPrev = (decPrev.get(rival[0]) ?? 0) - (decPrev.get(CORE_DECADE) ?? 0)
    if (rival[1] - core > gapPrev) {
      problems.push({ rule: 'CORE_DECADE_NOT_PLURALITY', detail: `${rival[0]} ${rival[1]}명 > ${CORE_DECADE} ${core}명` })
    }
  }

  // ── 생활사 7칸 완전 일치 — 묶음 쪽만 본다(기존끼리는 이미 운영 중이다) ──
  const seen = new Map<string, string>(input.existing.map((s) => [lifeKeyOf(s), s.code]))
  for (const s of input.batch) {
    const k = lifeKeyOf(s)
    const prev = seen.get(k)
    if (prev !== undefined) problems.push({ rule: 'LIFE_KEY_DUPLICATE', detail: `${s.code}: 생활사 7칸이 ${prev} 와 같다` })
    else seen.set(k, s.code)
  }

  return { ok: problems.length === 0, problems, merged: mergedTop, batch: batchTop, effective: effectiveValues(merged) }
}

export const diversitySubjectOfCard = (c: PoolCard): DiversitySubject => ({
  code: c.code, title: c.title, ageBand: c.ageBand, region: c.region, maritalStatus: c.maritalStatus,
  childrenCount: c.childrenCount, childrenAgeBands: c.childrenAgeBands, workStatus: c.workStatus,
  economicStatus: c.economicStatus, housing: c.housing, parentCare: c.parentCare, personality: c.personality,
  voiceBand: readLengthBand(c.voiceLength),
})

export const diversitySubjectOf = (code: string, life: LifeSkeleton, creative: PersonaCreative | null, voiceBand: string | null): DiversitySubject => ({
  code, title: creative?.title ?? '', ageBand: life.ageBand, region: life.region, maritalStatus: life.maritalStatus,
  childrenCount: life.childrenCount, childrenAgeBands: life.childrenAgeBands, workStatus: life.workStatus,
  economicStatus: life.economicStatus, housing: life.housing, parentCare: life.parentCare,
  personality: creative?.personality ?? [], voiceBand,
})

// ─────────────────────────────────────────────────────────
// ③ 활동 집중도 — 지금 30명이 고르게 쓰이는가
// ─────────────────────────────────────────────────────────

export type PersonaActivityRow = { code: string; posts: number; comments: number }

export type ActivityConcentration = {
  personas: number
  /** 글+댓글 합 */
  events: number
  /** 활동 1건 이상 */
  activePersonas: number
  /** 활동 0 — 코드 목록 */
  idle: string[]
  top1: { code: string; share: number } | null
  top3Share: number
  /** 🔴 유효 인원 = 1/HHI. 30명이 고르게 쓰이면 30에 가깝고, 몇 명에 몰리면 작다 */
  effectivePersonas: number
  /** 0(완전 균등) ~ 1(한 명 독점) */
  gini: number
}

/**
 * 🔴 **집중도.** 활동이 0건이면 점유를 계산하지 않는다(나눗셈이 뜻이 없다 — 0 으로 쓰지 않는다).
 */
export function activityConcentration(rows: readonly PersonaActivityRow[], pick: 'all' | 'posts' | 'comments' = 'all'): ActivityConcentration {
  const v = (r: PersonaActivityRow): number => pick === 'posts' ? r.posts : pick === 'comments' ? r.comments : r.posts + r.comments
  const sorted = [...rows].sort((a, b) => v(b) - v(a) || a.code.localeCompare(b.code))
  const events = sorted.reduce((a, r) => a + v(r), 0)
  const idle = sorted.filter((r) => v(r) === 0).map((r) => r.code).sort()
  if (events === 0) {
    return { personas: rows.length, events: 0, activePersonas: 0, idle, top1: null, top3Share: 0, effectivePersonas: 0, gini: 0 }
  }
  const shares = sorted.map((r) => v(r) / events)
  const hhi = shares.reduce((a, s) => a + s * s, 0)
  // 🔴 Gini — 오름차순 누적식
  const asc = [...sorted].map(v).sort((a, b) => a - b)
  const n = asc.length
  const giniNum = asc.reduce((a, x, i) => a + (2 * (i + 1) - n - 1) * x, 0)
  return {
    personas: n, events, activePersonas: n - idle.length, idle,
    top1: { code: sorted[0]!.code, share: shares[0]! },
    top3Share: shares.slice(0, 3).reduce((a, s) => a + s, 0),
    effectivePersonas: 1 / hhi,
    gini: n === 0 ? 0 : giniNum / (n * events),
  }
}
