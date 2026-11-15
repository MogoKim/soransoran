/**
 * 자동 댓글 **자연 회차 관측** — 🔴 순수 함수 · 보고 전용. 판정·게이트·장부는 이 파일을 읽지 않는다 (2026-11-15)
 *
 * 원천(호출부가 읽어 넘긴다 — 여기서는 파일·DB 를 건드리지 않는다)
 *   · 시도 장부 2종 — `first-comment-attempts.v1.json`(첫 댓글) · `followup-attempts.v1.json`(추가 댓글)
 *   · 댓글 전용 LLM 장부 — stage `commentGen`(첫 댓글) · `commentFollowupGen`(추가 댓글)
 *   · DB — 관리형 공개 글(커뮤니티 게시판 · Persona 작성) · 그 글의 댓글(`parentId` 실데이터)
 *
 * 🔴 숫자는 결과값이다. 평균·분포는 quota 가 아니다(평균 5 는 자연 생동감 관측치일 뿐).
 * 🔴 출력은 개수·코드·SHA 만 — 본문·표시명·회원 정보·id 0.
 *
 * 정의
 *   · 첫 댓글 = 그 글에 처음 달린 Persona 최상위 댓글 · 추가 댓글 = 그 뒤 Persona 최상위 댓글 · 답글 = `parentId` 가 있는 댓글
 *   · 실회원 댓글 = Persona 도 관리자도 아닌 작성자의 댓글
 *   · 같은 tick 재선정 = 같은 lane · 같은 글에서, 직전 시도(≤ RESELECT_WINDOW_MS)가 ENQUEUED 가 아니었고 다른 Persona 로 다시 시도한 것
 *   · 회차 용량 = 같은 runId 의 댓글 LLM 요청 수(최대 · 평균)
 */

export const RESELECT_WINDOW_MS = 120_000
export const COMMENT_STAGES = ['commentGen', 'commentFollowupGen'] as const

export type ObservedAttempt = {
  lane: 'first-comment' | 'followup'
  postId: string; personaCode: string; attemptedAtMs: number; step: string; blockCodes: readonly string[]
}
export type ObservedLedger = { stage: string; runId: string; startedAt: string; status: string; settledUsd: number | null }
export type ObservedPost = { id: string; createdAtMs: number }
export type ObservedComment = {
  postId: string; parentId: string | null; isPersona: boolean; isAdmin: boolean; createdAtMs: number
}

export const kstDateOfMs = (ms: number): string => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)

export type LaneDay = {
  attempts: number
  steps: Record<string, number>
  blockCodes: Record<string, number>
  sameTickReselections: number
}
export type StageDay = { requests: number; settled: number; usageUnknown: number; reserved: number; blocked: number; settledUsd: number }
export type CommentDay = {
  kstDate: string
  managedPosts: number
  comments: { first: number; followup: number; reply: number; member: number; total: number }
  memberParticipatedPosts: number
  avgCommentsPerPost: number | null
  lanes: Record<ObservedAttempt['lane'], LaneDay>
  provider: Record<(typeof COMMENT_STAGES)[number], StageDay>
  runCapacity: { runs: number; maxRequestsPerRun: number; avgRequestsPerRun: number | null }
}

const bump = (r: Record<string, number>, k: string): void => { r[k] = (r[k] ?? 0) + 1 }
const emptyLane = (): LaneDay => ({ attempts: 0, steps: {}, blockCodes: {}, sameTickReselections: 0 })
const emptyStage = (): StageDay => ({ requests: 0, settled: 0, usageUnknown: 0, reserved: 0, blocked: 0, settledUsd: 0 })

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

/** 같은 tick 재선정 수 — 시각 순으로 같은 lane·같은 글을 본다 */
export function countReselections(attempts: readonly ObservedAttempt[]): number {
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
      if (cur.attemptedAtMs - prev.attemptedAtMs <= RESELECT_WINDOW_MS && prev.step !== 'ENQUEUED' && prev.personaCode !== cur.personaCode) n += 1
    }
  }
  return n
}

export function observeComments(i: {
  dates: readonly string[]
  posts: readonly ObservedPost[]
  comments: readonly ObservedComment[]
  attempts: readonly ObservedAttempt[]
  ledger: readonly ObservedLedger[]
}): CommentDay[] {
  const want = new Set(i.dates)
  const postDay = new Map(i.posts.map((p) => [p.id, kstDateOfMs(p.createdAtMs)]))
  return i.dates.map((d): CommentDay => {
    const posts = i.posts.filter((p) => postDay.get(p.id) === d)
    const ids = new Set(posts.map((p) => p.id))
    const cs = i.comments.filter((c) => ids.has(c.postId))
    const c = { first: 0, followup: 0, reply: 0, member: 0, total: cs.length }
    const memberPosts = new Set<string>()
    const byPost = new Map<string, ObservedComment[]>()
    for (const x of cs) byPost.set(x.postId, [...(byPost.get(x.postId) ?? []), x])
    for (const list of byPost.values()) {
      let seenPersonaTop = false
      for (const x of [...list].sort((a, b) => a.createdAtMs - b.createdAtMs)) {
        if (x.parentId !== null) c.reply += 1
        else if (x.isPersona) { if (seenPersonaTop) c.followup += 1; else { c.first += 1; seenPersonaTop = true } }
        if (!x.isPersona && !x.isAdmin) { c.member += 1; memberPosts.add(x.postId) }
      }
    }
    const lanes = { 'first-comment': emptyLane(), followup: emptyLane() }
    const dayAttempts = i.attempts.filter((a) => want.has(d) && kstDateOfMs(a.attemptedAtMs) === d)
    for (const a of dayAttempts) {
      const l = lanes[a.lane]
      l.attempts += 1; bump(l.steps, a.step)
      for (const b of a.blockCodes) bump(l.blockCodes, b)
    }
    for (const lane of ['first-comment', 'followup'] as const) lanes[lane].sameTickReselections = countReselections(dayAttempts.filter((a) => a.lane === lane))
    const provider = { commentGen: emptyStage(), commentFollowupGen: emptyStage() }
    const runs = new Map<string, number>()
    for (const e of i.ledger) {
      if (!(COMMENT_STAGES as readonly string[]).includes(e.stage)) continue
      const at = Date.parse(e.startedAt)
      if (Number.isNaN(at) || kstDateOfMs(at) !== d) continue
      const s = provider[e.stage as (typeof COMMENT_STAGES)[number]]
      s.requests += 1
      if (e.status === 'settled') { s.settled += 1; s.settledUsd += e.settledUsd ?? 0 }
      else if (e.status === 'usageUnknown') s.usageUnknown += 1
      else if (e.status === 'reserved') s.reserved += 1
      else if (e.status === 'blocked') s.blocked += 1
      if (e.status !== 'blocked') runs.set(e.runId, (runs.get(e.runId) ?? 0) + 1)
    }
    const counts = [...runs.values()]
    return {
      kstDate: d, managedPosts: posts.length, comments: c, memberParticipatedPosts: memberPosts.size,
      avgCommentsPerPost: posts.length === 0 ? null : Math.round((cs.length / posts.length) * 100) / 100,
      lanes, provider,
      runCapacity: { runs: counts.length, maxRequestsPerRun: counts.length === 0 ? 0 : Math.max(...counts), avgRequestsPerRun: counts.length === 0 ? null : Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 100) / 100 },
    }
  })
}
