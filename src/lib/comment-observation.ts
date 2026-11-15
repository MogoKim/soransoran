/**
 * 자동 댓글 **자연 회차 관측** — 🔴 순수 함수 · 보고 전용. 판정·게이트·장부는 이 파일을 읽지 않는다 (2026-11-15)
 *
 * 원천(호출부가 읽어 넘긴다 — 여기서는 파일·DB 를 건드리지 않는다)
 *   · 시도 장부 2종 — `first-comment-attempts.v1.json`(첫 댓글) · `followup-attempts.v1.json`(추가 댓글)
 *   · 댓글 전용 LLM 장부 — stage `commentGen`(첫 댓글) · `commentFollowupGen`(추가 댓글)
 *   · DB — 관리형 공개 글(커뮤니티 게시판 · Persona 작성) · 그 글의 댓글(`parentId` 실데이터)
 *
 * 🔴 **모르는 것은 0 이 아니다.** 장부가 없거나 깨졌으면 그 축은 `null`(UNKNOWN)이다.
 *    시도 장부는 **굴러가는 기억**이다(첫 댓글 lane 은 공개 뒤 60분 · 추가 댓글 lane 은 시도한 KST 날 자정까지).
 *    기억 기간 밖의 날은 지워졌을 수 있으므로 UNKNOWN 이다 — 증명된 범위 밖을 0 으로 세지 않는다.
 * 🔴 정확한 "같은 tick" 은 시도 장부에 tick 식별자가 없어 알 수 없다(`exactSameTick: null`).
 *    대신 같은 lane·같은 글에서 막힌 직후 120초 안에 다른 Persona 로 다시 시도한 것을 **추정 재선정**으로 센다.
 * 🔴 회차당 LLM 요청 수는 슬롯 용량이 아니다. 실제 슬롯 용량은 권위 원천이 없어 `null`(UNKNOWN)이다.
 * 🔴 숫자는 결과값이다. 평균·분포는 quota 가 아니다. 출력은 개수·코드·SHA 만(본문·표시명·회원 정보·id 0).
 */

export const INFERRED_RESELECT_WINDOW_MS = 120_000
export const COMMENT_STAGES = ['commentGen', 'commentFollowupGen'] as const
export type Lane = 'first-comment' | 'followup'
export type SourceStatus = 'ok' | 'missing' | 'corrupt'

export type ObservedAttempt = {
  lane: Lane
  postId: string; personaCode: string; attemptedAtMs: number; step: string; blockCodes: readonly string[]
}
export type ObservedLedger = { stage: string; runId: string; startedAt: string; status: string; settledUsd: number | null }
export type ObservedPost = { id: string; createdAtMs: number }
/**
 * 🔴 **공개 가시 댓글 하나** — 호출부가 `isDeleted=false` 인 것만 넘긴다(가시성 칸은 그것 하나다).
 *    작성자 종류는 우선순위로 **하나만** 정한다: Persona(`personaId`) > 운영 작성자(`operatorWriterId`)
 *    > 관리자(`author.isAdmin`) > 비회원(`authorId` 없음) > 회원.
 */
export type ObservedComment = {
  postId: string; parentId: string | null; createdAtMs: number
  isPersona: boolean; isOperator: boolean; isAdmin: boolean; isGuest: boolean
}
export type AuthorKind = 'persona' | 'operator' | 'admin' | 'guest' | 'member'
export const authorKindOf = (c: ObservedComment): AuthorKind =>
  c.isPersona ? 'persona' : c.isOperator ? 'operator' : c.isAdmin ? 'admin' : c.isGuest ? 'guest' : 'member'

export const kstDateOfMs = (ms: number): string => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)

/** 🔴 KST 날짜 목록(포함 · 포함). 모양이 틀리거나 뒤집히면 빈 목록 */
export function kstDatesBetween(from: string, to: string): string[] {
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (!re.test(from) || !re.test(to) || to < from) return []
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); ; t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10)
    if (d > to) break
    out.push(d)
  }
  return out
}

/**
 * 🔴 시도 장부가 그 날을 **온전히 또는 부분적으로** 덮는가 — lane 의 기억 규칙에서 나온다.
 *    · followup — 시도한 KST 날 자정까지 기억 → 오늘만 덮는다(지금까지의 부분) · 그 전 날은 지워졌을 수 있다
 *    · first-comment — 공개 뒤 60분만 기억 → 어떤 날도 하루 전체를 증명하지 못한다
 */
export function laneCoverage(lane: Lane, date: string, nowMs: number): 'PARTIAL_TODAY' | 'UNKNOWN' {
  if (lane === 'followup' && date === kstDateOfMs(nowMs)) return 'PARTIAL_TODAY'
  return 'UNKNOWN'
}

/** 추정 재선정 수 — 같은 lane · 같은 글 · 막힌 직후 120초 안 다른 Persona */
export function countInferredReselections(attempts: readonly ObservedAttempt[]): number {
  const byKey = new Map<string, ObservedAttempt[]>()
  for (const a of attempts) {
    const k = `${a.lane}|${a.postId}`
    byKey.set(k, [...(byKey.get(k) ?? []), a])
  }
  let n = 0
  for (const list of byKey.values()) {
    const s = [...list].sort((x, y) => x.attemptedAtMs - y.attemptedAtMs)
    for (let i = 1; i < s.length; i++) {
      const prev = s[i - 1]!; const cur = s[i]!
      if (cur.attemptedAtMs - prev.attemptedAtMs <= INFERRED_RESELECT_WINDOW_MS && prev.step !== 'ENQUEUED' && prev.personaCode !== cur.personaCode) n += 1
    }
  }
  return n
}

export type LaneDay = {
  coverage: 'PARTIAL_TODAY' | 'UNKNOWN'
  source: SourceStatus
  /** 🔴 coverage 가 UNKNOWN 이거나 장부가 ok 가 아니면 아래는 전부 null */
  attempts: number | null
  steps: Record<string, number> | null
  blockCodes: Record<string, number> | null
  inferredReselectionsWithin120s: number | null
  /** 🔴 시도 장부에 tick 식별자가 없다 — 언제나 UNKNOWN */
  exactSameTick: null
}
export type StageDay = {
  /** 🔴 그날 장부가 없거나 깨졌으면 전부 null */
  requests: number | null; settled: number | null; usageUnknown: number | null; reserved: number | null; blocked: number | null
  /** 🔴 정산 줄 중 금액이 null·비유한이면 null(UNKNOWN) */
  settledUsd: number | null
}
export type CommentDay = {
  kstDate: string
  /** 그날 만들어진 관리형 공개 글(커뮤니티 게시판 · Persona 작성 · status PUBLISHED) */
  managedPosts: number
  comments: {
    /** 🔴 그 글들의 **공개 가시 댓글 전체**(isDeleted=false) — 아래 두 분할의 합이 각각 이 값이다 */
    total: number
    /** 🔴 작성자 분할 — 서로 겹치지 않는다 · 합 = total */
    byAuthor: Record<AuthorKind, number>
    /** 🔴 구조 분할 — 서로 겹치지 않는다 · 합 = total. 🔴 작성자 분할과는 **겹친다**(답글도 누군가 쓴다) — 두 축을 더하지 않는다 */
    byStructure: { topLevel: number; reply: number }
    /** 🔴 Persona 최상위 댓글의 **부분집합** — 합계 분해가 아니다(첫 = 글마다 처음 Persona 최상위 · 추가 = 그 뒤) */
    personaTopLevel: { first: number; followup: number }
  }
  /** 회원(가입 · 비관리자 · Persona/운영 작성자 아님)이 공개 가시 댓글을 단 관리형 글 수 — 비회원은 따로 */
  memberParticipatedPosts: number
  guestParticipatedPosts: number
  /** 🔴 분자 = comments.total(공개 가시 댓글 전체) · 분모 = managedPosts. 글이 0 이면 null */
  avgCommentsPerPost: number | null
  lanes: Record<Lane, LaneDay>
  provider: Record<(typeof COMMENT_STAGES)[number], StageDay>
  /** 🔴 회차당 댓글 LLM 요청 — 용량이 아니다. 장부를 못 읽은 날은 null */
  requestsPerRun: { runs: number; max: number; avg: number | null } | null
  /** 🔴 실제 슬롯 용량 — 권위 원천 없음 */
  slotCapacity: null
}

const bump = (r: Record<string, number>, k: string): void => { r[k] = (r[k] ?? 0) + 1 }
const UNKNOWN_STAGE: StageDay = { requests: null, settled: null, usageUnknown: null, reserved: null, blocked: null, settledUsd: null }

export function observeComments(i: {
  dates: readonly string[]
  nowMs: number
  posts: readonly ObservedPost[]
  comments: readonly ObservedComment[]
  attempts: Readonly<Record<Lane, { status: SourceStatus; entries: readonly ObservedAttempt[] }>>
  /** 날짜 → 그날 댓글 장부 줄. 없거나 깨진 날은 null */
  ledgerByDate: ReadonlyMap<string, readonly ObservedLedger[] | null>
}): CommentDay[] {
  const postDay = new Map(i.posts.map((p) => [p.id, kstDateOfMs(p.createdAtMs)]))
  return i.dates.map((d): CommentDay => {
    const posts = i.posts.filter((p) => postDay.get(p.id) === d)
    const ids = new Set(posts.map((p) => p.id))
    const cs = i.comments.filter((c) => ids.has(c.postId))
    const c: CommentDay['comments'] = {
      total: cs.length,
      byAuthor: { persona: 0, operator: 0, admin: 0, guest: 0, member: 0 },
      byStructure: { topLevel: 0, reply: 0 },
      personaTopLevel: { first: 0, followup: 0 },
    }
    const memberPosts = new Set<string>()
    const guestPosts = new Set<string>()
    const byPost = new Map<string, ObservedComment[]>()
    for (const x of cs) byPost.set(x.postId, [...(byPost.get(x.postId) ?? []), x])
    for (const list of byPost.values()) {
      let seenPersonaTop = false
      for (const x of [...list].sort((a, b) => a.createdAtMs - b.createdAtMs)) {
        const kind = authorKindOf(x)
        c.byAuthor[kind] += 1
        if (x.parentId !== null) c.byStructure.reply += 1
        else {
          c.byStructure.topLevel += 1
          if (kind === 'persona') { if (seenPersonaTop) c.personaTopLevel.followup += 1; else { c.personaTopLevel.first += 1; seenPersonaTop = true } }
        }
        if (kind === 'member') memberPosts.add(x.postId)
        if (kind === 'guest') guestPosts.add(x.postId)
      }
    }
    const laneDay = (lane: Lane): LaneDay => {
      const src = i.attempts[lane]
      const coverage = laneCoverage(lane, d, i.nowMs)
      if (src.status !== 'ok' || coverage === 'UNKNOWN') {
        return { coverage, source: src.status, attempts: null, steps: null, blockCodes: null, inferredReselectionsWithin120s: null, exactSameTick: null }
      }
      const day = src.entries.filter((a) => kstDateOfMs(a.attemptedAtMs) === d)
      const steps: Record<string, number> = {}; const blockCodes: Record<string, number> = {}
      for (const a of day) { bump(steps, a.step); for (const b of a.blockCodes) bump(blockCodes, b) }
      return { coverage, source: 'ok', attempts: day.length, steps, blockCodes, inferredReselectionsWithin120s: countInferredReselections(day), exactSameTick: null }
    }
    const lines = i.ledgerByDate.get(d) ?? null
    let provider: CommentDay['provider'] = { commentGen: { ...UNKNOWN_STAGE }, commentFollowupGen: { ...UNKNOWN_STAGE } }
    let requestsPerRun: CommentDay['requestsPerRun'] = null
    if (lines !== null) {
      const mk = (): StageDay => ({ requests: 0, settled: 0, usageUnknown: 0, reserved: 0, blocked: 0, settledUsd: 0 })
      provider = { commentGen: mk(), commentFollowupGen: mk() }
      const runs = new Map<string, number>()
      for (const e of lines) {
        if (!(COMMENT_STAGES as readonly string[]).includes(e.stage)) continue
        const s = provider[e.stage as (typeof COMMENT_STAGES)[number]]
        s.requests! += 1
        if (e.status === 'settled') {
          s.settled! += 1
          s.settledUsd = s.settledUsd === null || typeof e.settledUsd !== 'number' || !Number.isFinite(e.settledUsd) ? null : s.settledUsd + e.settledUsd
        } else if (e.status === 'usageUnknown') s.usageUnknown! += 1
        else if (e.status === 'reserved') s.reserved! += 1
        else if (e.status === 'blocked') s.blocked! += 1
        if (e.status !== 'blocked') runs.set(e.runId, (runs.get(e.runId) ?? 0) + 1)
      }
      const counts = [...runs.values()]
      requestsPerRun = { runs: counts.length, max: counts.length === 0 ? 0 : Math.max(...counts), avg: counts.length === 0 ? null : Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 100) / 100 }
    }
    return {
      kstDate: d, managedPosts: posts.length, comments: c, memberParticipatedPosts: memberPosts.size, guestParticipatedPosts: guestPosts.size,
      avgCommentsPerPost: posts.length === 0 ? null : Math.round((cs.length / posts.length) * 100) / 100,
      lanes: { 'first-comment': laneDay('first-comment'), followup: laneDay('followup') },
      provider, requestsPerRun, slotCapacity: null,
    }
  })
}
