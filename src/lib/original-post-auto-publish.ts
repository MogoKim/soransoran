/**
 * 자동 발행 후보 선정 — 🔴 **순수 판정만. DB 도 네트워크도 없다** (§4-AL)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AL
 *
 * 🔴 **이 파일이 정하는 것은 "무엇을 낼까" 하나뿐이다.**
 *    배정도 발행도 하지 않는다 — 그건 기존 `planBatch` 와 `publishOriginalPostTx` 의 일이다.
 *
 * 🔴 **왜 조건을 이렇게 좁게 박았나.**
 *    같은 대기열에 **성격이 다른 글 두 종류**가 산다.
 *      · `publish-candidate-v1` / `human-curated` — 사람이 고르고 사람이 쓴 글
 *      · `13~14판` / `gemini-*`               — 다른 레인이 만든 글
 *    자동 발행은 **사람이 매 건을 보지 않는다**는 뜻이므로,
 *    **내용을 아는 것만** 대상이어야 한다. 그래서 판(promptVersion)과 모델을 못박는다.
 *    2026-09-06 에 그 구분이 없어 내용 모르는 글 둘이 발행 직전까지 갔다.
 */

/** 🔴 이 판으로 만든 것만 자동 발행한다 */
export const AUTO_PROMPT_VERSION = 'publish-candidate-v1'
/** 🔴 사람이 쓴 글이라는 표시 */
export const AUTO_MODEL = 'human-curated'
/** 🔴 synthetic RawContent 표시 (§4-AJ) */
export const AUTO_SITE_PREFIX = 'publish-candidate:'
/** 기존 발행 게이트가 요구하는 값 */
export const AUTO_GATE_VERDICT = 'PASS'

// 🔴 profile 판정의 단일 지점 — 적재기(§4-AN)와 같은 함수를 쓴다
import { queueProfileOf } from './micro-seed-supply-autofill'
// 🔴 기계 표식 검사는 적재 쪽과 같은 함수를 쓴다 — 두 벌이면 한쪽만 고쳐져 P0 가 된다
export { machineGateOk as machineMarksOk } from './micro-seed-supply-autofill'

/**
 * 🔴 **기계가 만든 글도 발행한다 — 다만 profile 을 통째로 맞을 때만** (§4-AT)
 *
 * §4-AS 가 낸 초안이 §4-AN 을 거쳐 큐에 들어온다. 그 글은 사람이 고른 것이 아니므로
 * 사람 판(`publish-candidate-v1` · `human-curated`)을 쓰지 않는다.
 *
 * 🔴 **필드를 독립으로 보지 않는다.** `promptVersion` 만 기계 것이고 `model` 이 사람 것이면
 *    그 행은 어느 경로로 들어왔는지 알 수 없다 — 통째로 맞거나 전부 거절이다.
 *    "일부만 섞인 행" 을 허용하는 순간 구분이 무너지고, 그 구분 위에 이 레인이 서 있다.
 */
export const MACHINE_PROMPT_VERSION = 'publish-candidate-auto-v1'
export const MACHINE_MODEL = 'claude-haiku-4.5'
export const MACHINE_SITE_PREFIX = 'publish-candidate:auto:'
/** gateResults 에 남아야 하는 표시 */
export const MACHINE_GATE_MARKS = {
  provenance: 'machine-generated',
  sourceDecision: 'AUTO_ADOPT',
  draftRuleVersion: 'auto-draft-v3',
} as const

export type PublishProfile = 'human' | 'machine'

export type AutoRow = {
  id: string
  status: string
  createdPostId: string | null
  gateVerdict: string
  promptVersion: string
  model: string
  matchedPersonaId: string | null
  title: string
  body: string
  sourceSite: string
  /** 🔴 기계 후보 확인용 — 큐에 남긴 표시를 다시 본다 */
  gateResults?: unknown
  /** 승인 시각 — 없으면 `createdAt` 이 대신한다. 🔴 줄 세우기의 근거다 */
  decidedAt: Date | null
  createdAt: Date
}

export type RejectCode =
  | 'STATUS' | 'ALREADY_PUBLISHED' | 'GATE' | 'PROMPT_VERSION' | 'MODEL' | 'SITE' | 'SAFETY' | 'EMPTY'
  | 'PROFILE'

export const REJECT_LABEL: Record<RejectCode, string> = {
  STATUS: 'APPROVED · EDITED 가 아니다',
  ALREADY_PUBLISHED: '이미 발행됐다',
  GATE: `gate 가 ${AUTO_GATE_VERDICT} 가 아니다`,
  PROMPT_VERSION: '허용된 판이 아니다 — 내용을 모르는 글이다',
  MODEL: '허용된 모델이 아니다',
  SITE: '허용된 출처가 아니다',
  PROFILE: '🔴 사람 profile 도 기계 profile 도 아니다 — 일부만 섞인 행은 받지 않는다',
  SAFETY: 'safety 재판정이 pass 가 아니다',
  EMPTY: '제목이나 본문이 비었다',
}

export type Reject = { id: string; code: RejectCode }

/** 발행 문안으로 다시 돌린 safety 결과만 받는다 — 판정 자체는 기존 필터가 한다 */
export type SafetyVerdictOf = (title: string, body: string) => string

/**
 * 대상을 고른다 — 🔴 **일곱 조건을 모두 통과해야 한다.**
 *
 * 하나라도 빠지면 자동 발행의 전제("내용을 안다")가 무너진다.
 * 🔴 `safety` 는 **저장된 값을 믿지 않고 발행 문안으로 다시 잰다** —
 *    큐에 들어간 뒤 문안이 바뀌었을 수 있고, 필터가 그 사이 좋아졌을 수도 있다.
 */
/**
 * 이 행이 어느 profile 인가 — 🔴 **통째로 맞아야 한다. 아니면 `null`.**
 *
 * 기계 profile 은 `gateResults` 의 표시까지 본다. 큐 컬럼 셋만 맞으면
 * 누군가 그 값을 손으로 넣었을 때 통과해 버린다 — 게이트 기록은 적재기가 남긴 것이다.
 */
export function profileOf(r: AutoRow): PublishProfile | null {
  // 🔴 **적재기와 같은 함수를 쓴다.** 각자 판정하면 두 구현이 갈라지고,
  //    실제로 갈라졌었다 — 적재기가 사람 접두를 붙이는 동안 발행기는 기계 접두를 찾았다.
  return queueProfileOf({
    promptVersion: r.promptVersion, model: r.model,
    sourceSite: r.sourceSite, gateResults: r.gateResults,
  })
}

export function selectAutoTargets(
  rows: readonly AutoRow[], safetyOf: SafetyVerdictOf,
): { targets: AutoRow[]; rejected: Reject[] } {
  const targets: AutoRow[] = []
  const rejected: Reject[] = []
  const push = (id: string, code: RejectCode): void => { rejected.push({ id, code }) }

  for (const r of rows) {
    if (r.status !== 'APPROVED' && r.status !== 'EDITED') { push(r.id, 'STATUS'); continue }
    if (r.createdPostId !== null && r.createdPostId !== '') { push(r.id, 'ALREADY_PUBLISHED'); continue }
    if (r.gateVerdict !== AUTO_GATE_VERDICT) { push(r.id, 'GATE'); continue }
    // 🔴 여기가 legacy 글을 막는 자리다
    // 🔴 두 profile 중 하나를 **통째로** 만족해야 한다. 일부만 섞인 행은 거절이다
    const profile = profileOf(r)
    if (profile === null) { push(r.id, 'PROFILE'); continue }
    if (r.title.trim() === '' || r.body.trim() === '') { push(r.id, 'EMPTY'); continue }
    if (safetyOf(r.title, r.body) !== 'pass') { push(r.id, 'SAFETY'); continue }
    targets.push(r)
  }
  targets.sort(compareAutoRow)
  return { targets, rejected }
}

/**
 * 줄 세우기 — 🔴 **오래 기다린 것이 먼저다.**
 *
 * 승인 시각(`decidedAt`)이 기준이고, 없으면 `createdAt` 으로 갈음한다.
 * 시각까지 같으면 `id` 로 가른다 — **어떤 입력 순서로 들어와도 결과가 같아야**
 * dry-run 에서 본 것이 실제로 나간다.
 */
export function queueOrderKey(r: AutoRow): number {
  return (r.decidedAt ?? r.createdAt).getTime()
}
export function compareAutoRow(a: AutoRow, b: AutoRow): number {
  return queueOrderKey(a) - queueOrderKey(b) || a.id.localeCompare(b.id)
}

export type ApplyGate = { ok: true; target: AutoRow } | { ok: false; reason: string }

/**
 * 실제로 돌려도 되는가 — 🔴 **하나라도 어긋나면 멈춘다. 잘라내지 않는다.**
 *
 * 🔴 **한 번에 한 건이다.** 후보가 여럿이면 줄 순서대로 맨 앞을 고르고 나머지는 다음 회차로 민다.
 *    무작위가 아니라 **정해진 순서**라야 dry-run 에서 본 것이 그대로 나간다.
 *    0건이면 아무 일도 하지 않는다.
 */
export function judgeApply(input: {
  targets: readonly AutoRow[]
  /**
   * 🔴 `pickPublishTarget` 이 고른 한 건. **게이트가 스스로 고르지 않는다** —
   *    고르는 규칙이 두 곳에 있으면 dry-run 이 보여준 것과 다른 글이 나갈 수 있다.
   */
  picked: AutoRow | null
  apply: boolean
  limit: number | null
  publishedToday: number
  dailyCap: number
  killSwitchEnabled: boolean
}): ApplyGate {
  if (!input.apply) return { ok: false, reason: 'dry-run — --apply 가 없다' }
  if (input.limit !== 1) {
    return { ok: false, reason: `--limit 은 1 이어야 한다 (받은 값 ${input.limit ?? '없음'})` }
  }
  if (input.killSwitchEnabled) return { ok: false, reason: '전체 중지(kill switch)가 켜져 있다' }
  if (input.targets.length === 0) return { ok: false, reason: '후보가 0건이다' }
  if (input.publishedToday >= input.dailyCap) {
    return { ok: false, reason: `오늘 상한 ${input.dailyCap}건을 채웠다 (${input.publishedToday}/${input.dailyCap})` }
  }
  // 🔴 배정된 글이 하나도 없으면 나가지 않는다 — 후보가 있어도 persona 가 없으면 발행은 없다
  if (input.picked === null) {
    return { ok: false, reason: '배정된 후보가 없다 — persona 여력이나 생활사 조건이 막고 있다' }
  }
  // 🔴 줄에 같은 id 가 두 번 있으면 어느 쪽을 낸 것인지 말할 수 없다. 멈춘다
  const ids = input.targets.map((t) => t.id)
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: '후보 목록에 같은 id 가 두 번 있다 — 어느 행을 낸 것인지 말할 수 없다' }
  }
  // 🔴 **고른 것이 줄 안에 있어야 한다.** 밖에서 들어온 행은 안전 재판정을 거치지 않았다 —
  //    legacy 도, 이미 발행된 것도, 내용을 모르는 글도 이 문으로 들어올 수 있다
  const inLine = input.targets.find((t) => t.id === input.picked!.id)
  if (inLine === undefined) {
    return { ok: false, reason: `고른 행 ${input.picked.id} 이 후보 목록에 없다 — 재판정을 거치지 않은 행이다` }
  }
  // 🔴 같은 id 라도 **줄에 있는 그 행**을 낸다. 밖에서 온 사본을 쓰지 않는다
  return { ok: true, target: inLine }
}

/**
 * 이번에 나가는 것 · 건너뛴 것 · 밀리는 것
 *
 * 🔴 **맨 앞 한 건을 집지 않는다** (2026-09-07 교체).
 *
 *    예전에는 줄 맨 앞(`targets[0]`)을 그대로 발행 대상으로 삼았다. 그런데 그 한 건이
 *    배정되지 않으면 **그날 하루를 통째로 버렸다** — 뒤에 배정된 글이 있어도 나가지 않았다.
 *    실측: 최희소 후보 하나가 막혀 09-20 · 21 · 22 사흘이 연속으로 비었다.
 *
 *    그래서 줄 순서는 그대로 두되, **배정이 있는 첫 글**을 집는다.
 *    건너뛴 글은 지우지도 상태를 바꾸지도 않는다 — 다음 회차에 다시 맨 앞이고,
 *    왜 건너뛰었는지는 `skipped` 로 화면과 관제에 남는다.
 *
 * 🔴 한 회차에 나가는 것은 여전히 **한 건**이다. 상한을 여는 변경이 아니다.
 *
 * 🔴 **복구가 먼저다** (2026-09-07)
 *
 *    이전 회차가 배정을 저장한 뒤 발행 전에 죽으면, 그 행은 persona 의 주간 여력을
 *    **이미 써 버린 채** 발행되지 않은 상태로 남는다. 그 사람은 글을 쓰지도 못했는데
 *    이번 주를 다 쓴 것이 된다. 그러니 새 글보다 이 행을 먼저 내보내 상태를 푼다.
 *    복구 대상이 여럿이면 그중 가장 오래 기다린 것이다.
 */
export function pickPublishTarget<T extends { id: string }>(input: {
  /** 🔴 이미 `compareAutoRow` 로 정렬된 줄 — 오래 기다린 순 */
  ordered: readonly T[]
  /** 그 글에 배정된 persona code. 없으면 null */
  assignedOf: (id: string) => string | null
  /** 🔴 이전 회차가 배정만 하고 발행하지 못한 행인가 — 있으면 먼저 복구한다 */
  isRecovery?: (id: string) => boolean
}): { picked: T | null; recovered: boolean; skipped: T[]; waiting: T[] } {
  const has = (t: T): boolean => input.assignedOf(t.id) !== null
  const isRec = input.isRecovery ?? ((): boolean => false)

  // 🔴 ① 기존 배정이 살아 있는 행 중 가장 오래된 것
  let at = input.ordered.findIndex((t) => isRec(t.id) && has(t))
  const recovered = at !== -1
  // ② 없으면 이번에 배정된 것 중 가장 오래된 것
  if (at === -1) at = input.ordered.findIndex((t) => has(t))

  if (at === -1) return { picked: null, recovered: false, skipped: [...input.ordered], waiting: [] }
  return {
    picked: input.ordered[at]!,
    recovered,
    skipped: [...input.ordered.slice(0, at)],
    waiting: [...input.ordered.slice(at + 1)],
  }
}

/** 발행 뒤 정합 — 🔴 셋이 다 맞아야 성공이다 */
export function verifyAfterPublish(input: {
  queueStatus: string
  createdPostId: string | null
  postExists: boolean
  activityLogCount: number
}): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (input.queueStatus !== 'PUBLISHED') problems.push(`Queue status ${input.queueStatus} (PUBLISHED 여야 한다)`)
  if (input.createdPostId === null || input.createdPostId === '') problems.push('createdPostId 가 비었다')
  if (!input.postExists) problems.push('Post 를 찾지 못했다')
  // 🔴 cap 의 정본이다. 빠지면 다음 발행에서 상한이 조용히 열린다
  if (input.activityLogCount !== 1) problems.push(`ActivityLog ${input.activityLogCount}건 (1이어야 한다)`)
  return { ok: problems.length === 0, problems }
}
