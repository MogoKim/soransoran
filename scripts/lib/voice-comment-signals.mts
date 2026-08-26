/**
 * 댓글 반응 신호 (VE-M2)
 *
 * 정본: docs/operations/2026-08-26-voice-derived-m2-design.md §1
 *       docs/operations/2026-08-27-voice-engine-schema-strategy.md §2-4
 *
 * 🔴 댓글 본문을 저장하지 않는다
 *    테이블 이름이 `CommentSource` 가 아니라 `CommentSignal` 인 이유가 이것이다.
 *    본문은 해시를 계산하고 분류하는 순간에만 메모리에 있고, 반환값에는 남지 않는다.
 *    본문이 필요한 순간마다 우나어 DB 를 다시 읽는다.
 *
 * 🔴 닉네임 원문을 저장하지 않는다
 *    우나어 닉네임은 3~7자라 원문을 두면 검색으로 특정된다. salt 해시만 남긴다.
 *
 * 🔴 비용 0원 — 네트워크 · LLM · 난수가 없다.
 */
import { createHash } from 'node:crypto'

/** 이 규칙 묶음의 버전 */
export const COMMENT_RULE_VERSION = 'voice-m2-rule-v1'

/**
 * 이 길이 이상이면 잘렸다고 본다.
 * 🔴 우나어 댓글의 약 4.0% 가 여기 걸린다. 모르고 학습하면
 *    "우리 또래는 200자에서 말을 끊는다" 는 거짓 패턴을 배운다.
 */
export const COMMENT_TRUNCATE_AT = 199

/**
 * 규칙으로 가르는 반응 유형.
 *
 * 🔴 **알려진 한계 — 실측 (댓글 1,940개 기준, 2026-08-26)**
 * ```
 * other 80% · question 13% · empathy 5% · rebuttal 1% · information 1% · experience 1%
 * ```
 * `other` 1,556개를 다시 훑어도 **61%(946개)는 어떤 키워드 패턴에도 걸리지 않는다.**
 * 흔한 것은 감사(10%) · 축하/칭찬(8%) · 추측/의견(12%) · 짧은 동의(6%)인데,
 * 사전을 그만큼 늘려도 946개는 그대로 남는다 — **키워드로 커버되는 영역이 아니다.**
 *
 * 그래서 사전을 무리하게 늘리지 않았다. 지금 값은 **기초 분류**이고,
 * `other` 가 많다는 사실 자체가 "규칙으로는 여기까지" 라는 정직한 신호다.
 * 정교한 분류가 필요해지면 VE-M3 에서 LLM 으로 풀 문제이지,
 * 정규식을 100줄 늘려 풀 문제가 아니다.
 *
 * ⚠️ 이 수치를 보고 `other` 를 버리지 마라. 댓글이 붙었다는 사실 자체가
 *    참여 신호이고, `contentLength` · `likeCount` · `ordinal` 은 유형과 무관하게 쓰인다.
 */
export type ReactionType =
  | 'empathy'      // 공감 — 나도 그래요
  | 'question'     // 되묻기
  | 'rebuttal'     // 반박
  | 'experience'   // 경험 공유
  | 'information'  // 정보 제공
  | 'other'

/** 🔴 DB 로 가는 한 행. 댓글 본문 · 닉네임이 없다 */
export type CommentSignalRow = {
  ordinal: number
  authorHash: string | null
  contentHash: string | null
  contentLength: number
  likeCount: number
  replyCount: number
  truncated: boolean
  reactionType: ReactionType
  /** ⚠️ 댓글에 인용 정보가 없어 **대부분 null 이 되는 것이 정상**이다 */
  anchorHint: Record<string, unknown> | null
  capturedAt: Date
}

export function commentHashOf(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

export function commentAuthorHashOf(author: string, salt: string): string {
  return `sha256:${createHash('sha256').update(`${salt}::${author}`, 'utf8').digest('hex')}`
}

// ── 반응 분류 ─────────────────────────────────────────────
//    🔴 순서가 의미를 만든다. 아래로 갈수록 약한 신호다.
//       "저도 그런 적 있어요" 는 공감이자 경험인데, 우리에게 중요한 건 경험 쪽이다.

const REBUTTAL = /(아니요|아닌데|그건 아니|글쎄요|반대로|오히려|잘못 알고|틀렸)/

/**
 * 🔴 **경험 동사가 있어야 경험이다.**
 *    처음에는 `저도` 같은 1인칭만으로 경험이라 봤는데, 그러면
 *    "맞아요 저도요 힘내세요" 가 경험으로 잡힌다 — 그건 공감이다.
 *    (fixture 가 실제로 잡았다)
 */
const EXPERIENCE = /(겪었|겪어보|당했|해봤|해 봤|써봤|써 봤|다녀왔|다녀 왔|가봤|경험했|경험이)/

/**
 * 🔴 **주제어가 아니라 행위 안내여야 정보다.**
 *    처음에는 `병원` · `번호` 같은 주제어를 넣었는데, 그러면
 *    "어느 병원 가셨어요?" 라는 **질문**이 정보제공으로 잡힌다.
 *    (fixture 가 실제로 잡았다)
 */
const INFORMATION = /(하시면 됩니다|하시면 돼요|하시면 될|참고하세요|참고로|검색해|링크|신청하|서류|접수|절차는|방법은)/

const QUESTION = /\?|(나요\b|까요\b|은가요|인가요|어떠세요)/
const EMPATHY = /(맞아요|그러게|공감|저도요|힘내|토닥|응원|같은 마음|어쩜)/

/**
 * 댓글 한 줄의 반응 유형.
 *
 * 🔴 **순서가 의미를 만든다.**
 *    "저도 겪었는데 어느 병원 가셨어요?" 는 경험이자 질문이다.
 *    경험을 먼저 보는 이유는 그쪽이 Voice 학습에 쓸 재료이기 때문이다 —
 *    질문은 어디에나 있지만 경험담은 드물다.
 *
 * 🔴 반환은 **라벨뿐**이다. 무엇 때문에 그렇게 분류했는지의 원문 조각을 담지 않는다 —
 *    담는 순간 이 테이블이 댓글 저장소가 된다.
 */
export function classifyReaction(text: string): ReactionType {
  if (REBUTTAL.test(text)) return 'rebuttal'
  if (EXPERIENCE.test(text)) return 'experience'
  if (QUESTION.test(text)) return 'question'
  if (INFORMATION.test(text)) return 'information'
  if (EMPATHY.test(text)) return 'empathy'
  return 'other'
}

/** 우나어 topComments 원소에서 안전하게 값을 꺼낸다 */
function pick(item: unknown, keys: readonly string[]): string {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    for (const k of keys) {
      const v = (item as Record<string, unknown>)[k]
      if (typeof v === 'string' && v.length > 0) return v
    }
  }
  return ''
}

function pickNumber(item: unknown, keys: readonly string[]): number {
  if (item && typeof item === 'object') {
    for (const k of keys) {
      const v = (item as Record<string, unknown>)[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
  }
  return 0
}

/**
 * `topComments` 배열 → 저장 가능한 신호 배열.
 *
 * 🔴 `capturedAt` 은 인자로 받는다. 여기서 `new Date()` 를 부르면
 *    같은 입력이 매번 다른 출력을 내고 fixture 로 잠글 수 없다.
 */
export function toCommentSignals(
  raw: unknown, opts: { authorSalt: string; capturedAt: Date },
): CommentSignalRow[] {
  if (!Array.isArray(raw)) return []
  const out: CommentSignalRow[] = []
  raw.forEach((item, index) => {
    const body = pick(item, ['content', 'text', 'body', 'comment'])
    if (!body) return
    const author = pick(item, ['author', 'nickname', 'writer', 'name'])
    out.push({
      ordinal: index,
      authorHash: author ? commentAuthorHashOf(author, opts.authorSalt) : null,
      contentHash: commentHashOf(body),
      contentLength: body.length,
      likeCount: pickNumber(item, ['likeCount', 'likes', 'like']),
      replyCount: pickNumber(item, ['replyCount', 'replies', 'reply']),
      truncated: body.length >= COMMENT_TRUNCATE_AT,
      reactionType: classifyReaction(body),
      // ⚠️ 댓글에 인용 정보가 없어 복원할 수 없다. 필드는 두되 비어 있는 것이 정상이다
      anchorHint: null,
      capturedAt: opts.capturedAt,
    })
  })
  return out
}

/** 로그에 찍어도 안전한 요약 — 🔴 본문 · 닉네임이 없다 */
export function summarizeCommentSignals(rows: readonly CommentSignalRow[]): {
  count: number
  truncated: number
  byReaction: Record<string, number>
  avgLength: number
} {
  const byReaction: Record<string, number> = {}
  for (const r of rows) byReaction[r.reactionType] = (byReaction[r.reactionType] ?? 0) + 1
  return {
    count: rows.length,
    truncated: rows.filter((r) => r.truncated).length,
    byReaction,
    avgLength: rows.length
      ? Math.round(rows.reduce((a, r) => a + r.contentLength, 0) / rows.length)
      : 0,
  }
}
