/**
 * 🔴 **자동 READY v2 — 판정 조각** (2026-09-25 · feat/auto-ready-v2)
 *
 * 🔴 **새 규칙을 만들지 않는다.** 아래는 PR #565(`src/lib/auto-ready.ts`)에서 검증된
 *    순수 판정 조각을 **그대로** 옮긴 것이다. #565 는 병합·rebase·cherry-pick 하지 않고
 *    read-only 참고로만 썼다. 계약 값은 main 의 `AUTO_READY_CONTRACT` 가 정본이다.
 *
 * 🔴 이 파일은 순수 함수만 둔다 — DB·파일·네트워크·env 를 모른다.
 *    도장을 찍는 쓰기 경로는 아직 없다(운영 변수·flag 변경 금지 — 켤 수 없다).
 */
import { createHash } from 'node:crypto'

import { AUTO_READY_CONTRACT } from './supply-schedule-contract'
import { LEGACY_DECISION_MARK } from './review-provenance'
import {
  SEMANTIC_SUMMARY_KEY, semanticHoldsOf, type SemanticSummary,
} from './micro-seed-supply-autofill'

/**
 * 🔴 사람 결정 경로의 표식 — 기계 자동 판정은 이 값을 **절대** 쓰지 않는다(founder 위장 금지).
 *    🔴 이 값만으로는 **사람 정답 표본이 아니다** — 누가 봤는지는 `review-provenance` 가 정한다.
 */
export const HUMAN_DECIDER = LEGACY_DECISION_MARK
/** 🔴 자동 판정의 표식 — 사람 값과 섞이지 않는 별개 문자열이다 */
export const AUTO_DECIDER = 'auto-ready:v1'

/** 계약 값은 정본을 그대로 쓴다 — 여기서 다시 적지 않는다 */
export const CONTRACT = AUTO_READY_CONTRACT

/**
 * 🔴 경고 = 저장 게이트가 남긴 `holds`·`blocks` + **의미 검수 기록의 구조 결함**.
 *
 * 🔴 **`semanticReview` 는 "객체이면 통과" 가 아니다** (2026-09-25 마스터 지적).
 *    #565 판은 `typeof rec === 'object'` 만 봤다 — `{}` 도, 필드가 문자열인 것도,
 *    `complete: false` 인 것도 **경고 0** 으로 읽혔다. 재지 않은 것을 이상 없음으로 읽은 것이다.
 *    이제 여섯 필드를 **구조적으로** 본다. 하나라도 어긋나면 예외 검토로 간다.
 *
 * 🔴 이 경고는 후보 생성도 사람 검토도 막지 않는다. **자동 READY 에서만** 뺀다.
 * 🔴 `confidence` 에 통과 임계값을 만들지 않는다. "유한한 0~1 숫자인가" 만 본다.
 */
export const SEMANTIC_RECORD_KEY = SEMANTIC_SUMMARY_KEY
export const NO_SEMANTIC_RECORD = 'SEMANTIC_REVIEW_MISSING'
/** 필드 모양이 계약과 다르다 — 뒤에 필드 이름이 붙는다 */
export const SEMANTIC_INVALID = 'SEMANTIC_REVIEW_INVALID'
/** 요약에서 나와야 할 holds 와 저장된 holds 가 다르다 */
export const SEMANTIC_HOLDS_MISMATCH = 'SEMANTIC_HOLDS_MISMATCH'

const COUNT_FIELDS = ['unsupportedAdditions', 'lifeContradictions', 'droppedFromSource'] as const

/** 유한한 비음수 **정수** — 개수 칸의 정본 모양 */
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0

/**
 * 🔴 의미 검수 요약의 **구조 결함**을 낸다. 비어 있으면 모양은 온전하다.
 *    온전하면 정본 `semanticHoldsOf` 로 대조할 수 있는 요약도 함께 돌려준다.
 */
export function semanticIssues(rec: unknown): { issues: string[]; summary: SemanticSummary | null } {
  if (rec === null || rec === undefined || typeof rec !== 'object' || Array.isArray(rec)) {
    return { issues: [NO_SEMANTIC_RECORD], summary: null }
  }
  const r = rec as Record<string, unknown>
  const issues: string[] = []
  if (r.complete !== true) issues.push(`${SEMANTIC_INVALID}:complete`)
  if (r.deterministicPass !== true) issues.push(`${SEMANTIC_INVALID}:deterministicPass`)
  for (const k of COUNT_FIELDS) {
    if (!isCount(r[k])) issues.push(`${SEMANTIC_INVALID}:${k}`)
  }
  const c = r.confidence
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
    issues.push(`${SEMANTIC_INVALID}:confidence`)
  }
  if (issues.length > 0) return { issues, summary: null }
  return {
    issues,
    summary: {
      complete: true, deterministicPass: true,
      unsupportedAdditions: r.unsupportedAdditions as number,
      lifeContradictions: r.lifeContradictions as number,
      droppedFromSource: r.droppedFromSource as number,
      confidence: c as number,
    },
  }
}

export function warningsOfGate(gate: unknown): string[] {
  if (gate === null || typeof gate !== 'object' || Array.isArray(gate)) return ['gateResults 없음']
  const g = gate as Record<string, unknown>
  const arr = (k: string): string[] => (Array.isArray(g[k]) ? (g[k] as unknown[]).map(String) : [])
  const holds = arr('holds')
  const out = [...holds, ...arr('blocks')]
  const { issues, summary } = semanticIssues(g[SEMANTIC_RECORD_KEY])
  out.push(...issues)
  /**
   * 🔴 **holds 와 요약이 같은 말을 하는가.** 요약은 "추가 1건" 이라는데 holds 에
   *    그 경고가 없으면(또는 그 반대면) 둘 중 하나가 잘못 실렸다. 어느 쪽인지 모르므로
   *    예외로 보낸다. 기대 holds 는 **정본 `semanticHoldsOf`** 가 만든다 — 다시 적지 않는다.
   */
  if (summary !== null) {
    const expected = semanticHoldsOf(summary).slice().sort()
    const actual = holds.filter((h) => h.startsWith('SEMANTIC_')).slice().sort()
    if (expected.join('|') !== actual.join('|')) out.push(SEMANTIC_HOLDS_MISMATCH)

  }
  return out
}

/** 🔴 회귀 사례에서 나온 네 가지 — #565 가 실측으로 얻은 값이다 */
export const AUTO_READY_BLOCKERS = {
  /** 이미지가 있어야 성립하는 문장 (P08 실측) */
  imageDependent: /이런\s*(가죽|레더|옷)|이\s*옷\s*어(떨|떻)|사진\s*보|위\s*사진|여기\s*보/,
  /** 발행일 당일처럼 읽히는 표현 (P03 실측) */
  timeDrift: /오늘도|아직도\s*안|방금|어제\s*밤|지금\s*막/,
  /** 근거 없는 단정 */
  unsourcedClaim: /확실히|틀림없이|반드시\s*그렇/,
  /** 후속 뉴스가 있을 수 있는 시의성 소재 (P01 실측) */
  followUpLikely: /저격|논란|해명|사과|입장문|폭로/,
} as const

export type RowInput = {
  gateVerdict: string
  /** 생성 시점 게이트가 남긴 경고 코드 — 빈 배열이면 경고 없음 */
  warnings: readonly string[]
  /** 원천을 언제 봤는지 아는가 — 모르면 사람이 본다 */
  sourceCapturedKnown: boolean
  title: string
  body: string
}
export type RowVerdict = { auto: boolean; reasons: string[] }

/**
 * 🔴 **그 행이 자동 판정 대상인가** — "경고 없는 적격 후보" 하나다.
 *    하나라도 걸리면 **예외 묶음**으로 간다. 조용히 통과시키지 않는다.
 */
export function judgeRow(i: RowInput): RowVerdict {
  const reasons: string[] = []
  if (i.gateVerdict !== 'PASS') reasons.push(`gate=${i.gateVerdict}`)
  if (i.warnings.length > 0) reasons.push(`경고 ${i.warnings.join(',')}`)
  if (!i.sourceCapturedKnown) reasons.push('원천 수집 시각을 모른다')
  const both = `${i.title}\n${i.body}`
  for (const [name, re] of Object.entries(AUTO_READY_BLOCKERS)) {
    const hit = re.exec(both)
    if (hit !== null) reasons.push(`${name}="${hit[0]}"`)
  }
  return { auto: reasons.length === 0, reasons }
}

/** 🔴 한 행을 판정 입력으로 — 러너·그림자 판정·표본이 같은 함수를 쓴다 */
export function eligibilityOf(r: {
  gateVerdict: unknown
  gateResults: unknown
  title: string
  body: string
  sourceCapturedAt: Date | null
}): RowVerdict {
  return judgeRow({
    gateVerdict: String(r.gateVerdict),
    warnings: warningsOfGate(r.gateResults),
    sourceCapturedKnown: r.sourceCapturedAt !== null,
    title: r.title, body: r.body,
  })
}

// ─────────────────────────────────────────────────────────
// 🔴 도장 — 무엇을 보고 찍었는지 **값으로** 남긴다 (2026-09-25)
// ─────────────────────────────────────────────────────────

/** 🔴 도장은 `editDiff` 의 이 칸에 남긴다 — 수정 기록과 섞이지 않는다 */
export const AUTO_READY_RECORD_KEY = 'autoReady'
export const AUTO_READY_RECORD_VERSION = 'auto-ready-record-v1'

export const digestOf = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

/**
 * 🔴 **판정 계약의 판.** 계약 값 · 차단 규칙 · 의미 검수 코드 · 기록 판을 묶은 digest 다.
 *    규칙이 하나라도 바뀌면 이 값이 바뀌고, **옛 도장은 무효**가 된다 —
 *    어제의 규칙으로 찍은 도장을 오늘의 규칙 아래에서 쓰지 않는다.
 */
export const JUDGE_CONTRACT_DIGEST = digestOf(stableJson({
  contract: CONTRACT,
  blockers: Object.fromEntries(Object.entries(AUTO_READY_BLOCKERS).map(([k, v]) => [k, v.source])),
  semantic: [NO_SEMANTIC_RECORD, SEMANTIC_INVALID, SEMANTIC_HOLDS_MISMATCH],
  recordVersion: AUTO_READY_RECORD_VERSION,
})).slice(0, 32)

export type AutoReadyStamp = {
  decidedBy: typeof AUTO_DECIDER
  recordVersion: string
  /** 도장을 찍을 때의 판정 계약 판 */
  contractDigest: string
  /** 🔴 도장을 찍을 때 **실제로 본** 제목·본문 */
  titleHash: string
  bodyHash: string
  stampedAt: string
}

export function makeStamp(title: string, body: string, now: Date): AutoReadyStamp {
  return {
    decidedBy: AUTO_DECIDER, recordVersion: AUTO_READY_RECORD_VERSION,
    contractDigest: JUDGE_CONTRACT_DIGEST,
    titleHash: digestOf(title), bodyHash: digestOf(body), stampedAt: now.toISOString(),
  }
}

/** 🔴 저장된 도장을 읽는다 — 모양이 하나라도 어긋나면 `null` (없는 것과 같다) */
export function readStamp(editDiff: unknown): AutoReadyStamp | null {
  if (editDiff === null || typeof editDiff !== 'object' || Array.isArray(editDiff)) return null
  const r = (editDiff as Record<string, unknown>)[AUTO_READY_RECORD_KEY]
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return null
  const s = r as Record<string, unknown>
  const str = (k: string): string | null => (typeof s[k] === 'string' && s[k] !== '' ? s[k] as string : null)
  if (s.decidedBy !== AUTO_DECIDER) return null
  const recordVersion = str('recordVersion')
  const contractDigest = str('contractDigest')
  const titleHash = str('titleHash')
  const bodyHash = str('bodyHash')
  const stampedAt = str('stampedAt')
  if (recordVersion === null || contractDigest === null || titleHash === null
    || bodyHash === null || stampedAt === null) return null
  return { decidedBy: AUTO_DECIDER, recordVersion, contractDigest, titleHash, bodyHash, stampedAt }
}

/**
 * 🔴 **그 도장이 지금 내보낼 글에 유효한가.**
 *    도장을 찍은 뒤 제목·본문이 한 글자라도 바뀌었거나, 판정 계약이 바뀌었으면 무효다.
 */
export function stampValidFor(
  stamp: AutoReadyStamp | null, title: string, body: string,
): { ok: boolean; reason: string } {
  if (stamp === null) return { ok: false, reason: '도장 기록이 없거나 모양이 깨졌다' }
  if (stamp.recordVersion !== AUTO_READY_RECORD_VERSION) return { ok: false, reason: `기록 판 ${stamp.recordVersion}` }
  if (stamp.contractDigest !== JUDGE_CONTRACT_DIGEST) return { ok: false, reason: '판정 계약이 바뀌었다 — 옛 도장이다' }
  if (stamp.titleHash !== digestOf(title)) return { ok: false, reason: '도장 뒤에 제목이 바뀌었다' }
  if (stamp.bodyHash !== digestOf(body)) return { ok: false, reason: '도장 뒤에 본문이 바뀌었다' }
  return { ok: true, reason: '' }
}

/** 🔴 자동 도장만 담긴 editDiff 는 "사람이 고친 기록" 이 아니다 */
export function isHumanEditRecord(editDiff: unknown): boolean {
  if (editDiff === null || typeof editDiff !== 'object' || Array.isArray(editDiff)) return false
  const r = editDiff as Record<string, unknown>
  return r.bodyChanged === true || r.titleChanged === true
}

// ─────────────────────────────────────────────────────────
// 🔴 열림 · 감사 — 순수 계산
// ─────────────────────────────────────────────────────────

/** 🔴 스위치 — **기본 OFF**. 정확히 `on` 일 때만 켜진다 */
export const AUTO_READY_ENV = 'SORAN_AUTO_READY_ENABLED'
export function autoReadyEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env[AUTO_READY_ENV] ?? '').trim().toLowerCase() === 'on'
}

export type OpenState = { open: boolean; reasons: string[] }

/**
 * 🔴 **자동 READY 가 열려 있는가.** 넷 다 참이어야 연다:
 *    스위치 ON · 증거 표본이 계약을 채움 · **확정된 결함(yes)이 하나도 없음** ·
 *    **글이 사라진 자동 발행 행이 없음**.
 *    🔴 감사 **대기**(판정 전)는 막지 않는다 — 대기를 매 회차 사람 허가로 만들지 않는다.
 */
export function judgeOpen(i: {
  enabled: boolean
  evidence: { meetsContract: boolean; reasons: readonly string[] }
  confirmedDefects: number
  /**
   * 🔴 **글이 사라진 자동 발행 행 수** (2026-09-25 마스터 지적). 감사로 뽑히지 않은 행이면
   *    감사 행이 없어 확정 결함으로 잡히지 않는다 — 그래서 열림 판정이 직접 본다.
   *    DB 상태에서 매번 다시 세므로 행이 남아 있는 한 닫힘이 **영속**한다.
   */
  missingAutoPosts: number
}): OpenState {
  const reasons: string[] = []
  if (!i.enabled) reasons.push(`${AUTO_READY_ENV} 가 꺼져 있다`)
  if (!i.evidence.meetsContract) reasons.push(`증거 미달 — ${i.evidence.reasons.join(' · ') || '사유 없음'}`)
  if (!Number.isInteger(i.confirmedDefects) || i.confirmedDefects < 0) reasons.push('결함 수를 읽지 못했다')
  else if (i.confirmedDefects > 0) reasons.push(`🔴 확정 결함 ${i.confirmedDefects}건 — 자동 회차를 멈춘다`)
  if (!Number.isInteger(i.missingAutoPosts) || i.missingAutoPosts < 0) reasons.push('글 유실 수를 읽지 못했다')
  else if (i.missingAutoPosts > 0) reasons.push(`🔴 무결성 — 글이 사라진 자동 발행 ${i.missingAutoPosts}건 — 자동 회차를 멈춘다`)
  return { open: reasons.length === 0, reasons }
}

/**
 * 🔴 **감사 목표 수 = ceil(N × 비율)** — 정수 계산으로 낸다.
 *    지금 비율 0.2 는 부동소수 곱에서도 0~100000 구간에 어긋남이 없었다(실측).
 *    다만 비율이 바뀌면 깨질 수 있다 — 예: `100 × 0.55 = 55.00000000000001` 이라
 *    ceil 이 56 이 된다(실측). 계약 값이 바뀌어도 맞게 천분율 정수로 계산한다.
 */
export function auditTarget(n: number, ratio: number = CONTRACT.sampledAuditRatio): number {
  if (!Number.isInteger(n) || n <= 0) return 0
  const perMille = Math.round(ratio * 1000)
  return Math.floor((n * perMille + 999) / 1000)
}

/**
 * 🔴 **감사 대상 고르기** — 이미 고른 것은 다시 고르지 않고, 모자란 만큼만 더 고른다.
 *    순서는 queueId digest 로 정한다 — 오래된 글만 몰리지 않게 하되, 다시 돌려도 같은 답이다.
 */
export function pickAudits(i: {
  autoPublished: readonly string[]
  alreadySelected: ReadonlySet<string>
  ratio?: number
}): { target: number; pick: string[] } {
  const target = auditTarget(i.autoPublished.length, i.ratio)
  const already = i.autoPublished.filter((q) => i.alreadySelected.has(q)).length
  const need = Math.max(0, target - already)
  const pool = i.autoPublished.filter((q) => !i.alreadySelected.has(q))
    .slice().sort((a, b) => (digestOf(a) < digestOf(b) ? -1 : digestOf(a) > digestOf(b) ? 1 : 0))
  return { target, pick: pool.slice(0, need) }
}

/** 🔴 결함 판정은 **끈적하다** — `yes` 는 `no` 로 덮이지 않는다 */
export type DefectMark = 'yes' | 'no'
export function mergeDefect(prev: DefectMark | null, next: DefectMark): DefectMark {
  return prev === 'yes' ? 'yes' : next
}

// ─────────────────────────────────────────────────────────
// 🔴 감사 판정의 모양 (2026-09-25 마스터 지적)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **감사 계약의 판.** 판정 규칙·출력 모양이 바뀌면 이 값을 올린다.
 *    다른 판으로 낸 결과는 기록되지 않는다 — 옛 판정이 새 감사 자리에 붙지 않게 한다.
 */
export const AUDIT_CONTRACT_VERSION = 'auto-ready-audit-v1'

/** 감사자에게 주는 것 — **실제로 발행된** 글과, 그 글에 찍혀 있던 도장 */
export type AuditJudgeInput = {
  queueId: string
  postId: string
  /** 🔴 발행된 Post 의 제목·본문 — 큐의 값이 아니다 */
  title: string
  body: string
  stamp: AutoReadyStamp | null
}

/**
 * 🔴 감사자가 돌려주는 것. **무엇을 보고**(judged hash) **어느 판으로**(계약·모델·프롬프트)
 *    판정했는지가 함께 와야 기록된다.
 */
export type AuditVerdict = {
  defect: DefectMark
  reasons: string[]
  contractVersion: string
  model: string
  promptVersion: string
  judgedTitleHash: string
  judgedBodyHash: string
}

/**
 * 🔴 감사자 — 도장을 찍은 판정과 다른 경로로 **발행된 글**을 다시 본다.
 *    지금 구현은 규칙 기반 **무결성·안전 감사**뿐이다. 의미 감사(모델)는 활성화 전 별도 작업이다.
 */
export type AuditJudge = (i: AuditJudgeInput) => Promise<AuditVerdict>

/** 🔴 판정 결과의 모양 검사 — 하나라도 비었으면 기록하지 않는다 */
export function verdictShapeOk(v: AuditVerdict): { ok: boolean; reason: string } {
  if (v.defect !== 'yes' && v.defect !== 'no') return { ok: false, reason: `defect=${String(v.defect)}` }
  for (const k of ['contractVersion', 'model', 'promptVersion'] as const) {
    if (typeof v[k] !== 'string' || v[k].trim() === '') return { ok: false, reason: `${k} 가 비었다` }
  }
  for (const k of ['judgedTitleHash', 'judgedBodyHash'] as const) {
    if (!/^[0-9a-f]{64}$/.test(v[k])) return { ok: false, reason: `${k} 가 sha256 이 아니다` }
  }
  return { ok: true, reason: '' }
}
