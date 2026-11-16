/**
 * 댓글 생동감(vitality) 판독 — 🔴 순수 함수 · 읽기 전용 · 할당량 아님 (2026-11-13 창업자 결정 · canon §5)
 *
 * 🔴 **무엇을 재는가.** 글당 평균 댓글 수는 결과로만 보고한다. 평균 5는 대화할 거리가 있는 글의 장기 경험 목표이지
 *    PASS 기준이나 생산 quota 가 아니다. 대신 "죽은 서비스" 인상을 직접 가리키는 지표를 잰다:
 *      · 24시간 고립률     공개 뒤 24시간 안에 살아 있는 댓글이 1건 이하인 글의 비율(24시간이 지난 글만 분모)
 *      · 실회원 참여 글 비율 실회원(`MEMBER`) 댓글이 1건 이상인 글의 비율 — North Star 에 가장 가까운 칸
 *      · 분포              살아 있는 댓글 0 · 1 · 2~4 · 5~7 · 8~10 · 11+ 글 수, 8~10 비중
 *      · 열린 질문 응답률   🔴 지금은 재지 않는다(`null`). hook 판정 권위는 추가 댓글 planner 하나뿐이고(PR-2 통합 대상),
 *                          여기서 새 정규식 hook 을 만들면 두 번째 권위가 생긴다.
 *
 * 🔴 **판정 의미.** 분포·비율에는 목표 문턱을 두지 않는다(결과값). verdict 는 **불변식**만 본다:
 *      FAIL     같은 글에 글쓴이가 아닌 같은 Persona 가 두 번 이상 · 글쓴이 Persona 답글이 상한 초과 ·
 *               Persona 댓글이 글당 구조 상한(10) 초과
 *      UNKNOWN  분모 0 · 댓글 출처/시각을 읽지 못한 글이 있음(부분 데이터) — 그 칸은 `null`
 *      PASS     불변식 위반 0 이고 모든 글을 읽었다 — 🔴 "대화가 충분하다" 는 뜻이 아니다
 *
 * DB · 파일 · 네트워크 · 시각 조회 0. 원문 · 닉네임 · id 를 결과에 싣지 않는다(개수만).
 */
import { PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX, PERSONA_COMMENTS_PER_POST_MAX } from './persona-target-rules'

export const VITALITY_ISOLATION_WINDOW_MS = 24 * 3_600_000

/** Comment.commentOrigin 정본 어휘 — 모르는 값은 `null` 로 넘긴다(부분 데이터) */
export type VitalityOrigin = 'MEMBER' | 'PERSONA' | 'MICRO_SEED_VERBATIM' | 'GUEST' | 'OPERATOR'

export type VitalityComment = {
  origin: VitalityOrigin | null
  /** Persona 댓글이면 그 Persona 의 불투명 열쇠 — 결과에 싣지 않는다 */
  personaKey: string | null
  createdAtMs: number | null
  isDeleted: boolean
}

export type VitalityPost = {
  publishedAtMs: number | null
  /** 글쓴이가 Persona 면 그 열쇠 — 글쓴이 답글과 일반 중복을 가른다 */
  authorPersonaKey: string | null
  comments: readonly VitalityComment[]
}

export type VitalityBucket = '0' | '1' | '2-4' | '5-7' | '8-10' | '11+'
export const VITALITY_BUCKETS: readonly VitalityBucket[] = ['0', '1', '2-4', '5-7', '8-10', '11+']

export type VitalityCode = 'NO_POSTS' | 'PARTIAL_DATA' | 'DUP_PERSONA_ON_POST' | 'AUTHOR_REPLY_OVER_CAP' | 'PERSONA_OVER_CAP'

export type VitalityReport = {
  verdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  codes: VitalityCode[]
  posts: number
  /** 출처·시각을 다 읽은 글 */
  readablePosts: number
  /** 24시간이 지난(성숙) 글 — 고립률 분모 */
  maturePosts: number
  isolatedPosts: number
  isolationRate: number | null
  memberParticipationPosts: number
  memberParticipationRate: number | null
  /** 손님(GUEST) 댓글이 있는 글 — 실회원과 섞지 않는다 */
  guestParticipationPosts: number
  /** 🔴 hook 권위 통합(PR-2) 전에는 재지 않는다 */
  openQuestionResponseRate: null
  distribution: Record<VitalityBucket, number>
  share8to10: number | null
  /** 결과값 — 목표·quota 가 아니다 */
  averageLiveComments: number | null
  duplicatePersonaPosts: number
  authorReplyOverCapPosts: number
  personaOverCapPosts: number
}

const bucketOf = (n: number): VitalityBucket =>
  n === 0 ? '0' : n === 1 ? '1' : n <= 4 ? '2-4' : n <= 7 ? '5-7' : n <= 10 ? '8-10' : '11+'

const readable = (p: VitalityPost): boolean =>
  p.publishedAtMs !== null && Number.isFinite(p.publishedAtMs)
  && p.comments.every((c) => c.origin !== null && c.createdAtMs !== null && Number.isFinite(c.createdAtMs)
    && (c.origin !== 'PERSONA' || c.personaKey !== null))

export function judgeCommentVitality(posts: readonly VitalityPost[], nowMs: number): VitalityReport {
  const codes = new Set<VitalityCode>()
  const distribution = Object.fromEntries(VITALITY_BUCKETS.map((b) => [b, 0])) as Record<VitalityBucket, number>
  let readablePosts = 0
  let mature = 0
  let isolated = 0
  let memberPosts = 0
  let guestPosts = 0
  let liveTotal = 0
  let dup = 0
  let authorOver = 0
  let personaOver = 0
  for (const p of posts) {
    if (!readable(p)) { codes.add('PARTIAL_DATA'); continue }
    readablePosts += 1
    const live = p.comments.filter((c) => !c.isDeleted)
    liveTotal += live.length
    distribution[bucketOf(live.length)] += 1
    if (live.some((c) => c.origin === 'MEMBER')) memberPosts += 1
    if (live.some((c) => c.origin === 'GUEST')) guestPosts += 1
    // 불변식 — 지운 Persona 댓글도 그 Persona 가 이미 말한 기록이다(중복 판정에서 빼지 않는다)
    const persona = p.comments.filter((c) => c.origin === 'PERSONA')
    const byKey = new Map<string, number>()
    for (const c of persona) byKey.set(c.personaKey as string, (byKey.get(c.personaKey as string) ?? 0) + 1)
    let authorReplies = 0
    let duplicated = false
    for (const [k, n] of byKey) {
      if (p.authorPersonaKey !== null && k === p.authorPersonaKey) authorReplies = n
      else if (n > 1) duplicated = true
    }
    if (duplicated) dup += 1
    if (authorReplies > PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX) authorOver += 1
    // 총 구조 상한 10 — 첫 댓글 1 + 선택 0~9(글쓴이 답글 포함) · canon §5
    if (persona.length > PERSONA_COMMENTS_PER_POST_MAX) personaOver += 1
    // 고립 — 24시간이 지난 글만. 그 창 안에 살아 있는 댓글이 1건 이하면 고립
    const publishedAt = p.publishedAtMs as number
    if (nowMs - publishedAt >= VITALITY_ISOLATION_WINDOW_MS) {
      mature += 1
      const inWindow = live.filter((c) => (c.createdAtMs as number) - publishedAt <= VITALITY_ISOLATION_WINDOW_MS)
      if (inWindow.length <= 1) isolated += 1
    }
  }
  if (posts.length === 0) codes.add('NO_POSTS')
  if (dup > 0) codes.add('DUP_PERSONA_ON_POST')
  if (authorOver > 0) codes.add('AUTHOR_REPLY_OVER_CAP')
  if (personaOver > 0) codes.add('PERSONA_OVER_CAP')
  const failing = dup > 0 || authorOver > 0 || personaOver > 0
  const unknown = codes.has('NO_POSTS') || codes.has('PARTIAL_DATA')
  const ratio = (num: number, den: number): number | null => (den > 0 && !codes.has('PARTIAL_DATA') ? num / den : null)
  return {
    verdict: failing ? 'FAIL' : unknown ? 'UNKNOWN' : 'PASS',
    codes: [...codes].sort(),
    posts: posts.length,
    readablePosts,
    maturePosts: mature,
    isolatedPosts: isolated,
    isolationRate: ratio(isolated, mature),
    memberParticipationPosts: memberPosts,
    memberParticipationRate: ratio(memberPosts, readablePosts),
    guestParticipationPosts: guestPosts,
    openQuestionResponseRate: null,
    distribution,
    share8to10: ratio(distribution['8-10'], readablePosts),
    averageLiveComments: ratio(liveTotal, readablePosts),
    duplicatePersonaPosts: dup,
    authorReplyOverCapPosts: authorOver,
    personaOverCapPosts: personaOver,
  }
}
