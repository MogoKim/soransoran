/**
 * 답 기다리는 글 — 실회원 글이 사람의 답을 받았는가 (순수 판정 · 정책 정본)
 *
 * 🔴 DB · 시계 · 네트워크를 모른다. 조회는 queries/member-response.ts, 화면은 /admin/responses 가 한다.
 *    이 파일의 판정 하나를 화면·검사·변이 하네스가 같이 쓴다. 화면이 comments.length 를 직접 세지 않는다.
 * 🔴 상대 경로 import 만 둔다 — 변이 하네스가 이 파일 사본을 임시 디렉터리에서 그대로 import 한다.
 *
 * 정책 (2026-11-16 창업자 결정 ④)
 *   P1  대상 글 — 최근 7일 · 공개 · 사람이 쓴 실회원 글(갱년기톡·자유). Persona·운영·Micro Seed·매거진·
 *       창업자 시험 계정(관리자·allowlist)·운영 차단 회원 글은 대상이 아니다. (조회 조건: queries/member-response.ts)
 *   P2  가입인사도 대상이다(첫 인사가 무응답으로 끝나지 않게) — 배지로 구분한다.
 *   P3  답 = 살아 있는 댓글(대댓글 포함) 중 회원 · 손님 · 운영자 이름(Persona 목소리 포함)이 쓴 것.
 *       글쓴이 본인 댓글 · Persona 자동 댓글 · Micro Seed 원문 댓글은 답이 아니다.
 *       글쓴이가 차단한 사람의 댓글 · 운영 차단된 회원의 댓글 · 작성자 상태를 모르는 회원 댓글도 답이 아니다
 *       — 글쓴이에게 보이지 않거나, 모르는 것을 답으로 치면 회원 글이 조용히 방치된다.
 *   P4  작성자 종류는 comment-thread.ts authorKindOf 가 정한다(commentOrigin 정본). 여기서 다시 짐작하지 않는다.
 *   P5  다른 회원·손님이 먼저 답하면 그 글은 목록에서 빠진다 — 창업자가 회원끼리의 대화를 덮지 않는다.
 *   P6  출처를 판정할 수 없는 댓글은 답이 아니다. 유효한 답이 없고 그런 댓글이 있으면 '판정 불가' 로 맨 위에 둔다.
 *   P7  글이 올라온 뒤 3시간이 지나면 '기한 넘김'. 시계는 멈추지 않는다 — 새벽(KST 00:00~06:59) 글은 꼬리표만 붙인다.
 *   P9  "처리함" 같은 수동 상태는 없다. 상태는 저장하지 않는 파생값이다.
 */
import { authorKindOf, type ContextRow } from './comment-thread'

/** 이 시간 안에 첫 답이 달리길 목표로 한다. 넘으면 '기한 넘김' */
export const MEMBER_RESPONSE_TARGET_MS = 3 * 3_600_000
/** 이보다 오래된 글은 목록에 싣지 않는다 — North Star 창(7일)과 같다 */
export const MEMBER_RESPONSE_WINDOW_MS = 7 * 86_400_000
/** KST 0시부터 이 시각 전까지 올라온 글은 '새벽 글' 꼬리표 */
export const MEMBER_RESPONSE_DAWN_END_HOUR_KST = 7
/** 한 번에 싣는 글 수 상한 — 넘으면 화면이 넘었다고 말한다(조용히 자르지 않는다) */
export const MEMBER_RESPONSE_LIST_MAX = 200

const KST_OFFSET_MS = 9 * 3_600_000

/** 판정에 쓰는 댓글 한 줄 — authorBlocked 는 작성자 User 의 운영 차단 여부(작성자가 없거나 모르면 null) */
export type ResponseComment = ContextRow & { authorBlocked: boolean | null }

export type ResponderKind = 'member' | 'guest' | 'operator'
export type MemberResponseState = 'answered' | 'waiting' | 'overdue' | 'unknown'

export type MemberResponseVerdict = {
  state: MemberResponseState
  /** 첫 유효 답 시각 — 답이 없으면 null */
  firstResponseAt: Date | null
  responderKind: ResponderKind | null
  /** 답함: 첫 답까지 걸린 시간 · 그 밖: 지금까지 기다린 시간 (음수는 0) */
  waitedMs: number
  /** 살아 있는 Persona 자동 댓글이 있다 — 실회원 글에는 자동 레인이 붙지 않아야 하므로 점검 신호다 */
  personaPresent: boolean
}

const RESPONDER_KINDS: ReadonlySet<string> = new Set<ResponderKind>(['member', 'guest', 'operator'])

/**
 * 실회원 글 한 편의 답 상태.
 *
 * @param post             글쓴이 id · 글 작성 시각
 * @param comments         그 글의 댓글(지운 것 포함해도 된다 — 여기서 뺀다)
 * @param blockedByAuthor  글쓴이가 차단한 User id
 */
export function judgeMemberPostResponse(
  post: { authorId: string; createdAt: Date },
  comments: readonly ResponseComment[],
  blockedByAuthor: ReadonlySet<string>,
  now: Date,
): MemberResponseVerdict {
  let first: { at: Date; kind: ResponderKind } | null = null
  let unknownSeen = false
  let personaPresent = false

  for (const c of comments) {
    if (c.isDeleted) continue
    const k = authorKindOf(c)
    if (!k.ok) {
      unknownSeen = true
      continue
    }
    if (k.kind === 'persona') personaPresent = true
    if (!RESPONDER_KINDS.has(k.kind)) continue
    // 🔴 글쓴이 본인 댓글은 답이 아니다. authorId 가 null 인 행(손님·탈퇴 회원)은 본인이 아니다
    if (c.authorId !== null && c.authorId === post.authorId) continue
    // 🔴 글쓴이가 차단한 사람의 댓글은 글쓴이에게 보이지 않는다
    if (c.authorId !== null && blockedByAuthor.has(c.authorId)) continue
    // 🔴 회원 댓글은 작성자가 운영 차단되지 않았다고 **확인된** 것만. 모르면(null) 답이 아니다
    if (k.kind === 'member' && c.authorBlocked !== false) continue
    if (first === null || c.createdAt.getTime() < first.at.getTime()) first = { at: c.createdAt, kind: k.kind as ResponderKind }
  }

  if (first !== null) {
    return {
      state: 'answered',
      firstResponseAt: first.at,
      responderKind: first.kind,
      waitedMs: Math.max(0, first.at.getTime() - post.createdAt.getTime()),
      personaPresent,
    }
  }
  const waitedMs = Math.max(0, now.getTime() - post.createdAt.getTime())
  const state: MemberResponseState = unknownSeen ? 'unknown' : waitedMs >= MEMBER_RESPONSE_TARGET_MS ? 'overdue' : 'waiting'
  return { state, firstResponseAt: null, responderKind: null, waitedMs, personaPresent }
}

/** KST 새벽(0시 이상 MEMBER_RESPONSE_DAWN_END_HOUR_KST 시 미만)에 올라온 글인가 */
export function isDawnKst(d: Date): boolean {
  const hour = new Date(d.getTime() + KST_OFFSET_MS).getUTCHours()
  return hour < MEMBER_RESPONSE_DAWN_END_HOUR_KST
}

export type MemberResponseSummary = {
  total: number
  answered: number
  /** 목표 시간(3시간) 안에 첫 답을 받은 글 */
  answeredWithinTarget: number
  byResponder: Record<ResponderKind, number>
  waiting: number
  overdue: number
  unknown: number
}

/** 화면 맨 위 요약 — 이미 판정한 결과로만 센다(추가 조회 0) */
export function summarizeMemberResponses(verdicts: readonly MemberResponseVerdict[]): MemberResponseSummary {
  const s: MemberResponseSummary = {
    total: verdicts.length,
    answered: 0,
    answeredWithinTarget: 0,
    byResponder: { member: 0, guest: 0, operator: 0 },
    waiting: 0,
    overdue: 0,
    unknown: 0,
  }
  for (const v of verdicts) {
    if (v.state === 'answered') {
      s.answered += 1
      if (v.waitedMs < MEMBER_RESPONSE_TARGET_MS) s.answeredWithinTarget += 1
      if (v.responderKind !== null) s.byResponder[v.responderKind] += 1
    } else {
      s[v.state] += 1
    }
  }
  return s
}
