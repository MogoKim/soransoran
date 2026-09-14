/**
 * 네이버 카페 → 얇은 저장 (§4-AV)
 *
 * 🔴 **이 파일은 네트워크에 나가지 않는다.** 이미 수집된 JSONL 을 읽어 형태만 바꾼다.
 *
 * 왜 필요한가 — 2026-09-07 실측:
 *   · 82cook 은 `thin-detail → thin-adapt → auto-judge → auto-draft → Queue` 로 이어진다
 *   · 네이버 카페 수집물은 `navercafe-<cafe>-<runId>.jsonl` 이고 **아무도 소비하지 않는다.**
 *     `auto-judge` 는 `.detail.jsonl` · `.raw-detail.jsonl` 만 읽는다 — 접미가 달라 판정에 닿지 못한다
 *   · 게다가 그 파일에는 `rawBody` **전문**이 들어 있다 (실측 최대 2,899자).
 *     82cook 은 마스킹 후 300자만 남기는데 네이버만 전문을 들고 있었다
 *
 * 그래서 **같은 얇은 계약으로 옮긴다.** 계약이 둘이면 언젠가 한쪽만 고쳐지고,
 * 전문을 들고 있는 쪽이 이 레인의 존재 이유를 무너뜨린다.
 *
 * 🔴 판정도 분류도 여기서 새로 만들지 않는다 — `classifyDetail` 과 `toThinRow` 를 그대로 쓴다.
 */

/** 수집기가 남긴 행 — 🔴 `rawBody` 는 **전문**이다. 이 파일 밖으로 내보내지 않는다 */
export type CafeRow = {
  sourceArticleId?: unknown
  sourceSite?: unknown
  sourceUrl?: unknown
  originalTitle?: unknown
  rawBody?: unknown
  sourceCommentCount?: unknown
  sourceBoardName?: unknown
  qualityFlags?: unknown
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

export const SKIP_LABEL = {
  NO_ID: 'id 가 없다',
  NO_BODY: '본문이 비어 있다',
  NOT_NAVERCAFE: '네이버 카페 행이 아니다',
  ALREADY: '이미 얇게 저장했다',
  TITLE_POLITICS: '🔴 제목이 정치·공인 소재다',
  TITLE_SAFETY: '🔴 제목이 안전 기준에 걸린다',
  DROP: '🔴 분류가 drop 이다',
  HARD_EXCLUDE: '🔴 안전 판정이 hardExclude 다',
} as const

export type SkipCode = keyof typeof SKIP_LABEL
export type Skip = { id: string; code: SkipCode }

/**
 * 중복 판단의 정본 키 — 🔴 **articleId 단독으로는 안 된다.**
 *
 * 82cook 의 447520 과 레몬테라스의 447520 은 **다른 글**이다.
 * id 만으로 판단하면 한쪽을 먹었다는 이유로 다른 쪽을 영영 건너뛴다 —
 * 소스가 늘수록 조용히 유실되는 글이 늘어난다.
 */
export function dedupKeyOf(sourceSite: unknown, sourceArticleId: unknown): string {
  return `${S(sourceSite)}|${S(sourceArticleId)}`
}

export type PlanInput = {
  rows: readonly CafeRow[]
  /** 이미 얇게 저장한 것 — 🔴 `sourceSite|articleId` 다. id 단독이 아니다 */
  seen: ReadonlySet<string>
  /** 제목만 보는 사전 판정. 수집 당시 플래그가 안 붙은 것을 여기서 한 번 더 거른다 */
  judge?: { isPolitics: (title: string) => boolean; isBlocked: (title: string) => boolean }
  cap?: number
}

/**
 * 🔴 **"제외" 를 네 갈래로 나눈다** (2026-09-13).
 *
 *    옛 판은 `targets.slice(0, cap)` 으로 잘라낸 행을 **아무 데도 적지 않았다.**
 *    화면에는 "제외 N건" 만 남았고, 그 안에는
 *    ① 안전상 영영 안 가져올 것, ② 이미 읽은 것, ③ 이번 회차 상한 때문에 미룬 것이
 *    한 덩어리로 섞여 있었다. 2026-09-11~12 관측에서 후보 1,479건 중 95건만 열렸는데,
 *    나머지 1,384건이 "제외" 로 보였다 — 실제로는 **버린 것이 아니라 다음 회차로 미룬 것**이다.
 *    섞어 놓으면 "왜 이렇게 많이 거르나" 라는 틀린 물음을 하게 된다.
 */
export type Plan = {
  /** 이번 회차에 실제로 옮길 것 */
  targets: CafeRow[]
  /** 🔴 안전·형식상 **영영 가져오지 않는 것** */
  rejected: Skip[]
  /** 🔴 **이미 읽은 것** — 버린 것이 아니라 지난 회차에 이미 처리했다 */
  alreadyRead: Skip[]
  /** 🔴 **이번 회차 상한 때문에 미룬 것** — 다음 회차에 다시 후보가 된다 */
  deferred: CafeRow[]
  /**
   * 🔴 옛 이름. `rejected + alreadyRead` 다 — **이월(`deferred`)은 여기 들어가지 않는다.**
   *    부르는 쪽이 옛 뜻으로 쓰더라도 이월을 제외로 세지 않게 한다.
   */
  skipped: Skip[]
}

/** 🔴 `navercafe:` 로 시작하는 것만 이 레인이 다룬다 */
export function isNaverCafeRow(r: CafeRow): boolean {
  return S(r.sourceSite).startsWith('navercafe:')
}

/**
 * 무엇을 옮길 것인가 — 🔴 **hard gate 를 여기서도 지난다.**
 *
 * 수집 시점에 플래그가 안 붙은 정치 글이 남아 있다(82cook 에서 실측된 것과 같은 문제).
 * 판정기(`auto-judge`)까지 가서 걸러도 되지만, 그러면 그 글의 본문이 한 번 더 저장되고
 * 모델 호출도 한 번 더 일어난다. **가져오지 않는 것이 가장 싸고 안전하다.**
 */
export function planCafeThin(input: PlanInput): Plan {
  const skipped: Skip[] = []
  const targets: CafeRow[] = []
  const push = (id: string, code: SkipCode): void => { skipped.push({ id, code }) }

  for (const r of input.rows) {
    const id = S(r.sourceArticleId)
    if (id === '') { push('(id 없음)', 'NO_ID'); continue }
    if (!isNaverCafeRow(r)) { push(id, 'NOT_NAVERCAFE'); continue }
    // 🔴 소스까지 붙여 본다 — 같은 번호가 다른 카페에 있어도 서로를 막지 않는다
    if (input.seen.has(dedupKeyOf(r.sourceSite, id))) { push(id, 'ALREADY'); continue }
    if (S(r.rawBody) === '') { push(id, 'NO_BODY'); continue }
    const title = S(r.originalTitle)
    if (input.judge !== undefined) {
      if (input.judge.isPolitics(title)) { push(id, 'TITLE_POLITICS'); continue }
      if (input.judge.isBlocked(title)) { push(id, 'TITLE_SAFETY'); continue }
    }
    targets.push(r)
  }

  // 🔴 순서를 고정한다 — 같은 입력이면 같은 것을 고른다
  targets.sort((a, b) => S(a.sourceArticleId).localeCompare(S(b.sourceArticleId)))
  const cap = input.cap ?? targets.length
  const alreadyRead = skipped.filter((x) => x.code === 'ALREADY')
  const rejected = skipped.filter((x) => x.code !== 'ALREADY')
  return {
    targets: targets.slice(0, cap),
    // 🔴 **잘라낸 것을 이름 붙여 돌려준다.** 조용히 사라지면 관측이 거짓말을 한다
    deferred: targets.slice(cap),
    rejected, alreadyRead, skipped,
  }
}

/** 고유 원천 수 — 🔴 **행 수가 아니다.** 같은 글이 여러 페이지에 걸쳐 두 번 나올 수 있다 */
export function uniqueSourceCount(rows: readonly CafeRow[]): number {
  return new Set(rows.map((r) => dedupKeyOf(r.sourceSite, r.sourceArticleId))).size
}

/**
 * 분류 결과를 받아 최종 채택 여부를 정한다 — 🔴 **drop · hardExclude 는 저장하지 않는다.**
 * 82cook thin 은 전부 저장하고 adapt 에서 걸렀지만, 여기서는 아예 파일에 남기지 않는다.
 * 네이버 원문은 로컬에만 있어도 위험이 크다.
 */
export function keepAfterClassify(input: { axis: string; safetyVerdict: string }): {
  keep: boolean; code: SkipCode | null
} {
  if (input.safetyVerdict === 'hardExclude') return { keep: false, code: 'HARD_EXCLUDE' }
  if (input.axis === 'drop') return { keep: false, code: 'DROP' }
  return { keep: true, code: null }
}

/** 🔴 산출 파일명 — `.thin-detail.jsonl` 이어야 기존 adapt 가 집는다 */
export function outPathOf(dataDir: string, cafeId: string, runId: string): string {
  return `${dataDir}/navercafe-thin-${cafeId}-${runId}.thin-detail.jsonl`
}

/**
 * 🔴 이 레인이 남기는 본문 길이 — 82cook 과 **같은 값**이어야 한다.
 *
 * `scripts/lib/micro-seed-raw-originality.mts` 의 `BODY_HEAD_CHARS` 가 정본이지만
 * `src/lib` 이 `scripts/lib` 을 import 하는 방향은 두지 않는다.
 * 대신 **fixture 가 두 값이 같은지 검사한다** — 한쪽만 늘어나면 거기서 걸린다.
 */
export const CAFE_BODY_HEAD_CHARS = 300

export type ThinStats = {
  total: number
  kept: number
  dropped: number
  byAxis: Record<string, number>
}

export function statsOf(rows: readonly { axis?: unknown }[]): ThinStats {
  const byAxis: Record<string, number> = {}
  for (const r of rows) {
    const a = S(r.axis) || '(없음)'
    byAxis[a] = (byAxis[a] ?? 0) + 1
  }
  return { total: rows.length, kept: rows.length, dropped: 0, byAxis }
}

/**
 * 정합 — 🔴 **네트워크에 나가지 않았는지**까지 본다.
 * 이 레인은 이미 수집된 파일만 읽는다. 요청이 한 건이라도 있으면 계약 위반이다.
 */
export function verifyThinRun(input: {
  planned: number; written: number; networkRequests: number; dbWrites: number
}): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (input.networkRequests !== 0) {
    problems.push(`🔴 네트워크 요청이 ${input.networkRequests}건 — 이 레인은 파일만 읽는다`)
  }
  if (input.dbWrites !== 0) problems.push(`🔴 DB write 가 ${input.dbWrites}건 — 적재는 importer 의 일이다`)
  if (input.written > input.planned) {
    problems.push(`🔴 계획(${input.planned})보다 많이 썼다(${input.written})`)
  }
  return { ok: problems.length === 0, problems }
}
