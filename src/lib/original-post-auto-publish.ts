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
  /** 승인 시각 — 없으면 `createdAt` 이 대신한다. 🔴 줄 세우기의 근거다 */
  decidedAt: Date | null
  createdAt: Date
}

export type RejectCode =
  | 'STATUS' | 'ALREADY_PUBLISHED' | 'GATE' | 'PROMPT_VERSION' | 'MODEL' | 'SITE' | 'SAFETY' | 'EMPTY'

export const REJECT_LABEL: Record<RejectCode, string> = {
  STATUS: 'APPROVED · EDITED 가 아니다',
  ALREADY_PUBLISHED: '이미 발행됐다',
  GATE: `gate 가 ${AUTO_GATE_VERDICT} 가 아니다`,
  PROMPT_VERSION: `${AUTO_PROMPT_VERSION} 판이 아니다 — 내용을 모르는 글이다`,
  MODEL: `${AUTO_MODEL} 이 아니다 — 사람이 쓴 글이 아니다`,
  SITE: `${AUTO_SITE_PREFIX} 출처가 아니다`,
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
    if (r.promptVersion !== AUTO_PROMPT_VERSION) { push(r.id, 'PROMPT_VERSION'); continue }
    if (r.model !== AUTO_MODEL) { push(r.id, 'MODEL'); continue }
    if (!r.sourceSite.startsWith(AUTO_SITE_PREFIX)) { push(r.id, 'SITE'); continue }
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
  // 🔴 **여럿이면 맨 앞 하나를 고른다.** 임의로 고르는 것이 아니라 줄 순서대로다 —
  //    `compareAutoRow` 가 정한 순서는 입력이 어떻게 들어와도 같으므로,
  //    dry-run 에서 본 그 한 건이 그대로 나간다. 나머지는 다음 회차로 밀린다.
  return { ok: true, target: input.targets[0]! }
}

/** 이번에 나가는 것과 밀리는 것 — 화면에 함께 보여준다 */
export function splitTargets(targets: readonly AutoRow[]): { picked: AutoRow | null; waiting: AutoRow[] } {
  return targets.length === 0
    ? { picked: null, waiting: [] }
    : { picked: targets[0]!, waiting: [...targets.slice(1)] }
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
