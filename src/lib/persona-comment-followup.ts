/**
 * 글당 Persona **추가 댓글**(첫 댓글 뒤 0~4건) 판정 — 🔴 순수 함수. DB · 시계 · 네트워크 · provider 없음
 *
 * 🔴 **왜 생겼나** (2026-10-13 · D100 canon §5 "첫 댓글에서 선택적 다중 턴으로").
 *
 *    무인 레인은 글마다 60분 안 첫 댓글 1건을 보장한다(`persona-comment-auto-lane`). 그 1건은
 *    **증명용 하한**이지 "글마다 정확히 1건" 이라는 제품 정책이 아니다(canon §5). 질문·경험·공감·
 *    가벼운 반론처럼 이어질 거리가 있으면 대화가 한 번 더 이어져야 하고, 인사·맞장구로 끝나는
 *    대화는 끝나도 된다. 이 파일은 **"지금 이 글에 한 건 더 이어도 되는가"** 하나만 판정한다.
 *
 * 🔴 **첫 댓글 계약을 건드리지 않는다.**
 *    · 첫 댓글이 자동 출처(`auto`)로 붙은 글에만 이어 붙인다 — 추가 댓글은 첫 댓글을 대신하지 않는다.
 *    · 60분 안 첫 댓글을 기다리는 글이 하나라도 있으면 이 레인은 그 회차를 통째로 양보한다.
 *    · 표식이 다르다(`FOLLOWUP_DECIDED_BY` · `FOLLOWUP_ACTIVITY_DECIDED_BY`). 첫 댓글 증거(`commentProvenanceOf`)가
 *      추가 댓글을 첫 댓글로 세거나 "깨진 출처" 로 볼 수 없게 한다.
 *
 * 🔴 **기본 OFF.** `SORAN_PERSONA_COMMENT_FOLLOWUP=on` 정확히 그 값일 때만 켜진다. 모르는 값은 OFF.
 *
 * 🔴 **필요성은 대화가 정한다** (2026-10-13 마스터 보정). 추가 댓글은 **아직 답이 없는**
 *    질문·반론·경험·공감이 있을 때만 한 건씩 잇는다. 같은 대상·같은 hook 은 한 번만 쓴다.
 *    근거가 없으면 0건, 근거가 있으면 최대 4건이다. 글 id 해시로 수량을 정하지 않는다 —
 *    결정적 해시는 **동률 순서와 시간차 jitter** 에만 쓴다.
 *    한 회차에 한 글에는 최대 한 건이다 — 한꺼번에 달지 않는다.
 *
 * 🔴 **실회원 대화가 먼저다.** 실회원 댓글이 있으면 추가량을 줄이고, 실회원 댓글에는 답하지 않는다
 *    (실회원 댓글에 대한 Persona 응답은 CURRENT-MILESTONE §6 의 창업자 결정 항목이다).
 *
 * 🔴 여기서 막는 것은 **이 레인이 더하는 축**뿐이다. 9관문 · 생활사 · No-Go · 모델 확정 · provenance ·
 *    트랜잭션 재검사는 기존 경로가 그대로 본다. 이 파일은 그 위에 더할 뿐 하나도 빼지 않는다.
 */

import { createHash } from 'node:crypto'

import { authorKindOf, buildCommentThreads, conversationContextFor, type ContextRow } from './comment-thread'
import { AUTO_PERSONA_COMMENTS_PER_POST_MAX } from './persona-comment-auto-lane'
import { MEMBER_COMMENT_LIMIT_ON_PUBLISH } from './persona-comment-queue'
import { COMMENT_REACTION_ROLES, type ReactionType } from './persona-reaction-roles'
import { PERSONA_COMMENTS_PER_POST_MAX } from './persona-target-rules'
import { AUTO_COMMENT_CLOCK_SKEW_MS, commentProvenanceOf, type CommentLinkFacts } from './stage-evidence'

// ─────────────────────────────────────────────────────────
// 🔴 스위치 — 기본 OFF
// ─────────────────────────────────────────────────────────

export const FOLLOWUP_SWITCH_ENV = 'SORAN_PERSONA_COMMENT_FOLLOWUP'
/** 🔴 켜는 유일한 값. `1` · `true` · `ON` 은 켜지 않는다 — 오타로 켜지는 일을 막는다 */
export const FOLLOWUP_SWITCH_ON = 'on'

export type FollowupSwitch = { enabled: boolean; reason: string }

export function readFollowupSwitch(env: Readonly<Record<string, string | undefined>>): FollowupSwitch {
  const raw = (env[FOLLOWUP_SWITCH_ENV] ?? '').trim()
  if (raw === '') return { enabled: false, reason: `${FOLLOWUP_SWITCH_ENV} 미설정 — OFF(기본)` }
  if (raw === FOLLOWUP_SWITCH_ON) return { enabled: true, reason: `${FOLLOWUP_SWITCH_ENV}=${FOLLOWUP_SWITCH_ON}` }
  return { enabled: false, reason: `${FOLLOWUP_SWITCH_ENV}=${raw} 는 모르는 값이다 — OFF(fail-closed)` }
}

// ─────────────────────────────────────────────────────────
// 🔴 수량 · 시간 정본 — 새 숫자는 여기에만 있다
// ─────────────────────────────────────────────────────────

/** 🔴 글당 Persona 댓글 총량 상한 = 장기 정본 5 (새 숫자 아님) */
export const FOLLOWUP_TOTAL_PER_POST_MAX = PERSONA_COMMENTS_PER_POST_MAX
/** 🔴 첫 댓글 뒤 추가 상한 = 5 − 첫 댓글 1 = 4 */
export const FOLLOWUP_EXTRA_PER_POST_MAX = FOLLOWUP_TOTAL_PER_POST_MAX - AUTO_PERSONA_COMMENTS_PER_POST_MAX

/** 직전 Persona 댓글에서 최소 이만큼 띄운다 */
export const FOLLOWUP_MIN_GAP_MS = 30 * 60_000
/** 🔴 그 위에 글·순번마다 결정적으로 0~이만큼 더 띄운다 — 모든 글이 같은 박자로 이어지지 않게 */
export const FOLLOWUP_JITTER_MAX_MS = 40 * 60_000
/** 🔴 공개 후 이 시간이 지난 글에는 잇지 않는다 — 식은 글에 늦게 붙이는 것은 대화가 아니다 */
export const FOLLOWUP_POST_AGE_MAX_MS = 24 * 3_600_000

/** 실회원 댓글이 1~2건이면 추가 상한을 이만큼으로 줄인다 */
export const FOLLOWUP_EXTRA_WITH_MEMBERS_MAX = 1

/** 답글 사슬 길이 상한(루트 포함) — 새 답글까지 합쳐 이 길이를 넘지 않는다 */
export const FOLLOWUP_CHAIN_MAX = 3

/** 이어질 거리로 보는 반응 — `other`(그냥 한마디) · `information` 은 자연스러운 끝이다 */
export const FOLLOWUP_HOOKS: readonly ReactionType[] = ['question', 'rebuttal', 'experience', 'empathy']

// ─────────────────────────────────────────────────────────
// 🔴 비용 · 상한 · 표식
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **수량·비용 상한은 코드 상수가 아니라 승인된 profile 이다** (2026-10-13 마스터 보정).
 *
 *    D10 과 D100 의 하루 상한이 같을 수 없다. 그래서 상한을 여기 고정하지 않고, 호출부가 그날의
 *    런타임 단계에 맞는 **승인된 profile** 을 주입한다. 없거나 · 손상됐거나 · 단계가 다르거나 ·
 *    승인자가 없으면 그 회차는 **0건**(fail-closed)이다. 첫 댓글 예산은 profile 과 무관하게 먼저 뗀다.
 */
export const FOLLOWUP_PROFILE_VERSION = 'followup-profile-v1'

export type FollowupProfile = {
  v: typeof FOLLOWUP_PROFILE_VERSION
  /** 적용 런타임 단계(`d10` · `d20` · `d100` …) — 그날 단계와 같아야 한다 */
  stage: string
  /** 하루 추가 댓글 건수 상한 */
  dailyCount: number
  /** 하루 추가 댓글 USD 상한 — 공유 장부에서 첫 댓글 몫을 뗀 뒤의 잔량과 둘 중 작은 쪽만 쓴다 */
  dailyUsd: number
  /** 한 회차 상한 */
  runMax: number
  /** 한 Persona 의 하루 추가 댓글 상한 */
  perPersonaDailyMax: number
  /** 🔴 사람 승인 — `machine:` 표식은 승인이 아니다 */
  approvedBy: string
  approvedAt: string
}

/**
 * 🔴 **canary profile 후보 — 승인 전이라 그대로는 0건이다.** D100 영구 상한이 아니다.
 *    첫 운영 관측용 숫자 후보일 뿐이며, 창업자 승인(`approvedBy` · `approvedAt`)과 적용 단계를 채운
 *    profile 만 `validateFollowupProfile` 을 통과한다.
 */
export const FOLLOWUP_CANARY_PROFILE_CANDIDATE: Readonly<Omit<FollowupProfile, 'approvedBy' | 'approvedAt'> & { approvedBy: null; approvedAt: null }> = Object.freeze({
  v: FOLLOWUP_PROFILE_VERSION,
  stage: 'canary',
  dailyCount: 40,
  dailyUsd: 0.08,
  runMax: 3,
  perPersonaDailyMax: 3,
  approvedBy: null,
  approvedAt: null,
})

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1

/** 🔴 주입된 profile 을 그날 단계에 대해 검증한다. 하나라도 어긋나면 쓰지 않는다 */
export function validateFollowupProfile(
  raw: unknown, runtimeStage: string | null,
): { ok: true; profile: FollowupProfile } | { ok: false; reason: string } {
  if (raw === null || raw === undefined) return { ok: false, reason: '추가 댓글 profile 이 주입되지 않았다 — 0건(fail-closed)' }
  if (typeof raw !== 'object') return { ok: false, reason: 'profile 이 객체가 아니다(fail-closed)' }
  const p = raw as Partial<Record<keyof FollowupProfile, unknown>>
  if (p.v !== FOLLOWUP_PROFILE_VERSION) return { ok: false, reason: `profile 판이 ${String(p.v)} 다(fail-closed)` }
  if (typeof runtimeStage !== 'string' || runtimeStage.trim() === '') return { ok: false, reason: '그날 런타임 단계를 모른다(fail-closed)' }
  if (p.stage !== runtimeStage) return { ok: false, reason: `profile 단계 ${String(p.stage)} ≠ 그날 단계 ${runtimeStage}(fail-closed)` }
  if (!isPosInt(p.dailyCount)) return { ok: false, reason: 'profile 하루 건수가 양의 정수가 아니다(fail-closed)' }
  if (typeof p.dailyUsd !== 'number' || !Number.isFinite(p.dailyUsd) || p.dailyUsd <= 0) {
    return { ok: false, reason: 'profile 하루 USD 가 양의 유한수가 아니다(fail-closed)' }
  }
  if (!isPosInt(p.runMax) || p.runMax > p.dailyCount) return { ok: false, reason: 'profile 회차 상한이 손상됐다(fail-closed)' }
  if (!isPosInt(p.perPersonaDailyMax)) return { ok: false, reason: 'profile Persona 하루 상한이 손상됐다(fail-closed)' }
  if (typeof p.approvedBy !== 'string' || p.approvedBy.trim() === '' || p.approvedBy.trim().startsWith('machine:')) {
    return { ok: false, reason: 'profile 에 사람 승인자가 없다 — 후보는 쓰지 않는다(fail-closed)' }
  }
  if (typeof p.approvedAt !== 'string' || !Number.isFinite(Date.parse(p.approvedAt))) {
    return { ok: false, reason: 'profile 승인 시각을 읽지 못했다(fail-closed)' }
  }
  return { ok: true, profile: p as FollowupProfile }
}

/** 🔴 Queue.decidedBy — 첫 댓글 표식(`machine:persona-comment-auto`)과 다르다 */
export const FOLLOWUP_DECIDED_BY = 'machine:persona-comment-followup'
/** 🔴 PersonaActivityLog.decidedBy — 첫 댓글 표식(`auto`)과 다르다 */
export const FOLLOWUP_ACTIVITY_DECIDED_BY = 'auto-followup'

// ─────────────────────────────────────────────────────────
// 🔴 결정적 난수 — 동률 순서와 시간차 jitter 에만 쓴다. 수량·필요성은 정하지 않는다
// ─────────────────────────────────────────────────────────

/** [0, 1) — sha256 앞 8바이트 */
export function unitOf(...parts: readonly string[]): number {
  const hex = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 13)
  return parseInt(hex, 16) / 2 ** 52
}

/** 🔴 멱등 열쇠 — (글 · 순번). 같은 자리에 두 회차가 동시에 넣으면 unique 가 하나만 남긴다 */
export function followupKeyOf(postId: string, ordinal: number): string {
  return `comment-followup:${postId}:${ordinal}`
}

// ─────────────────────────────────────────────────────────
// 🔴 한 글 판정
// ─────────────────────────────────────────────────────────

/** 판정에 쓰는 댓글 한 줄 — 🔴 본문 없음. 반응 라벨은 호출부가 정본 분류기로 붙인다 */
export type FollowupCommentRow = ContextRow & {
  /** 이 댓글의 반응 라벨(`classifyReaction`). 모르면 null — 이어질 거리로 세지 않는다 */
  reaction: ReactionType | null
  /** 신고가 접수된 댓글인가. 모르면 null — 그 댓글에는 답하지 않는다 */
  reported: boolean | null
  /** 🔴 자동 출처 판정(`commentProvenanceOf`) — Persona 댓글만 의미가 있다 */
  provenance: 'auto' | 'followup' | 'none' | 'broken' | null
}

export type FollowupPostFacts = {
  postId: string
  /** 공개 시각. 모르면 null */
  publishedAtMs: number | null
  /** 글 상태 — PUBLISHED 만 */
  postStatus: string | null
  /** 글을 쓴 Persona. 사람 글이면 null. 🔴 못 읽었으면 undefined */
  authorPersonaId: string | null | undefined
  /** 🔴 관리형 자동 글인가(무인 러너가 낸 자동 READY 글) — 실회원 글·운영자 글에는 잇지 않는다 */
  autoManagedPost: boolean | null
  /** 글 자체의 반응 라벨 — 글이 부르는 반응. 모르면 null */
  postReaction: ReactionType | null
  /** 이 글의 댓글 전부(지운 것 포함 — 스레드 계산에 필요하다) */
  comments: readonly FollowupCommentRow[]
  /** 이 글을 대상으로 열려 있는 Queue 가 있는가(어느 레인이든). 모르면 null */
  hasOpenQueue: boolean | null
}

export type FollowupTarget =
  /** 글에 새 최상위 댓글로 잇는다 */
  | { kind: 'post'; hook: ReactionType }
  /** 그 Persona 댓글에 답한다 */
  | { kind: 'reply'; commentId: string; hook: ReactionType; threadRootId: string }

export type FollowupPostVerdict =
  | { verdict: 'GO'; ordinal: number; extrasSoFar: number; openHooks: number; key: string; target: FollowupTarget; excludePersonaIds: readonly string[]; roles: readonly ReactionType[]; reason: string }
  | { verdict: 'WAIT'; notBeforeMs: number | null; reason: string }
  | { verdict: 'STOP'; reason: string }
  | { verdict: 'BLOCK'; reason: string }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** 🔴 정본 순서 — 질문에 먼저 답하고, 반론·경험·공감 순이다 */
const HOOK_ORDER: readonly ReactionType[] = ['question', 'rebuttal', 'experience', 'empathy']

/**
 * 🔴 대상 반응에 어울리는 역할 — `COMMENT_REACTION_ROLES` 의 부분집합만 쓴다(생성기가 거부하지 않게).
 *    반박(`rebuttal`) 역할은 만들지 않는다 — 가벼운 반론에는 경험이나 한마디로 받는다.
 */
const ROLES_FOR: Readonly<Record<string, readonly ReactionType[]>> = {
  question: ['experience', 'other'],
  rebuttal: ['experience', 'other'],
  experience: ['empathy', 'question', 'other'],
  empathy: ['other', 'experience'],
}

export function rolesFor(hook: ReactionType): readonly ReactionType[] {
  return (ROLES_FOR[hook] ?? ['other']).filter((r) => COMMENT_REACTION_ROLES.includes(r))
}

/**
 * 🔴 **이 글에 지금 한 건 더 이어도 되는가.**
 *
 *    BLOCK — 사실을 못 읽었거나 모순이다(fail-closed). 그 글만 뺀다.
 *    STOP  — 이 글의 대화는 끝났다(상한 · 실회원 우선 · 식음 · 미해결 거리 없음).
 *    WAIT  — 아직 이르다(시간차). `notBeforeMs` 이후 다시 본다.
 *    GO    — 순번 · 멱등 열쇠 · 대상 · 제외 Persona · 역할 후보를 준다. Persona 를 고르지는 않는다.
 */
export function judgeFollowupPost(f: FollowupPostFacts, nowMs: number): FollowupPostVerdict {
  // ── 사실 확인(fail-closed) ──
  if (f.postStatus !== 'PUBLISHED') return { verdict: 'BLOCK', reason: `글 상태가 ${f.postStatus ?? '불명'} 다` }
  if (f.autoManagedPost !== true) {
    return { verdict: 'BLOCK', reason: f.autoManagedPost === false ? '관리형 자동 글이 아니다 — 잇지 않는다' : '관리형 자동 글인지 모른다(fail-closed)' }
  }
  if (f.authorPersonaId === undefined) return { verdict: 'BLOCK', reason: '글 작성 Persona 를 읽지 못했다(fail-closed)' }
  if (f.publishedAtMs === null || !Number.isFinite(f.publishedAtMs) || f.publishedAtMs > nowMs) {
    return { verdict: 'BLOCK', reason: '글의 공개 시각을 읽지 못했거나 미래다(fail-closed)' }
  }
  if (f.hasOpenQueue === null) return { verdict: 'BLOCK', reason: '열린 후보가 있는지 읽지 못했다(fail-closed)' }

  for (const c of f.comments) {
    if (c.postId !== f.postId) return { verdict: 'BLOCK', reason: '다른 글의 댓글이 섞였다(fail-closed)' }
    // 🔴 지운 댓글도 본다 — 출처 모순은 지웠다고 사라지지 않는다
    if (!authorKindOf(c).ok) return { verdict: 'BLOCK', reason: '댓글 작성자 종류가 모순이다(fail-closed)' }
  }
  // 🔴 순환 · 사라진 부모 — 관계가 어긋난 글에 답글을 얹지 않는다
  if (buildCommentThreads(f.comments, { postId: f.postId, blockedAuthorIds: new Set() }).anomalies.length > 0) {
    return { verdict: 'BLOCK', reason: '댓글 관계가 어긋났다(순환·사라진 부모) — fail-closed' }
  }
  const live = f.comments.filter((c) => !c.isDeleted)
  const livePersona = live.filter((c) => c.commentOrigin === 'PERSONA')
  const liveReal = live.filter((c) => c.commentOrigin === 'MEMBER' || c.commentOrigin === 'GUEST')

  // ── 첫 댓글 계약 — 추가 댓글은 자동 출처 첫 댓글 위에서만 ──
  if (livePersona.some((c) => c.provenance === 'broken' || c.provenance === null)) {
    return { verdict: 'BLOCK', reason: '출처가 깨졌거나 모르는 Persona 댓글이 있다(fail-closed)' }
  }
  const firsts = livePersona.filter((c) => c.provenance === 'auto')
  if (firsts.length === 0) {
    return { verdict: 'STOP', reason: '자동 출처 첫 댓글이 없다 — 추가 댓글은 첫 댓글을 대신하지 않는다' }
  }

  // ── 총량 · 실회원 상한 — 수량은 미해결 거리가 정하고 여기서는 넘지 못할 선만 본다 ──
  const personaCount = livePersona.length
  if (personaCount >= FOLLOWUP_TOTAL_PER_POST_MAX) {
    return { verdict: 'STOP', reason: `Persona 댓글 ${personaCount}건 — 글당 ${FOLLOWUP_TOTAL_PER_POST_MAX}건 상한` }
  }
  const extrasSoFar = livePersona.filter((c) => c.provenance === 'followup').length

  // ── 실회원 우선 ──
  const realCap = liveReal.length >= MEMBER_COMMENT_LIMIT_ON_PUBLISH
    ? 0
    : liveReal.length > 0 ? FOLLOWUP_EXTRA_WITH_MEMBERS_MAX : FOLLOWUP_EXTRA_PER_POST_MAX
  const cap = Math.min(realCap, FOLLOWUP_EXTRA_PER_POST_MAX)
  if (extrasSoFar >= cap) {
    return {
      verdict: 'STOP',
      reason: `추가 ${extrasSoFar}건 ≥ 이 글의 상한 ${cap} (실회원 ${liveReal.length}건)`,
    }
  }
  const byTime = [...live].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const latest = byTime[byTime.length - 1]
  if (latest !== undefined && (latest.commentOrigin === 'MEMBER' || latest.commentOrigin === 'GUEST')) {
    return { verdict: 'STOP', reason: '마지막 말이 실회원이다 — Persona 가 끼어들지 않는다(실회원 대화 우선)' }
  }

  // ── 현재성 · 시간차 ──
  if (nowMs - f.publishedAtMs > FOLLOWUP_POST_AGE_MAX_MS) {
    return { verdict: 'STOP', reason: `공개 ${Math.floor((nowMs - f.publishedAtMs) / 3_600_000)}시간 — 식은 글에 잇지 않는다` }
  }
  if (f.hasOpenQueue) return { verdict: 'WAIT', notBeforeMs: null, reason: '이 글에 열린 후보가 있다 — 쌓지 않는다' }
  const ordinal = personaCount + 1
  const lastPersonaMs = Math.max(...livePersona.map((c) => c.createdAt.getTime()))
  const notBeforeMs = lastPersonaMs + FOLLOWUP_MIN_GAP_MS
    + Math.floor(unitOf('followup-jitter', f.postId, String(ordinal)) * FOLLOWUP_JITTER_MAX_MS)
  if (nowMs < notBeforeMs) {
    return { verdict: 'WAIT', notBeforeMs, reason: `시간차 — ${Math.ceil((notBeforeMs - nowMs) / 60_000)}분 뒤` }
  }

  // ── 이어질 거리 ──
  const open = openHooksOf(f, live)
  const target = open[0] ?? null
  if (target === null) return { verdict: 'STOP', reason: '이어질 거리(답 없는 질문·경험·공감·반론)가 없다 — 자연스러운 끝' }

  const onPost = new Set(livePersona.map((c) => c.personaId).filter((id): id is string => id !== null))
  for (const c of f.comments) if (c.commentOrigin === 'PERSONA' && c.personaId !== null) onPost.add(c.personaId)
  if (f.authorPersonaId !== null) onPost.add(f.authorPersonaId)
  return {
    verdict: 'GO', ordinal, extrasSoFar, openHooks: open.length, key: followupKeyOf(f.postId, ordinal), target,
    excludePersonaIds: [...onPost].sort(),
    roles: rolesFor(target.hook),
    reason: `추가 ${extrasSoFar + 1}/${cap} · 미해결 거리 ${open.length} · ${target.kind === 'reply' ? `${target.hook} 에 답글` : `글의 ${target.hook} 에 새 댓글`}`,
  }
}

/**
 * 🔴 **아직 답이 없는 이어질 거리** — 우선순위 순서로 전부 돌려준다. 첫 원소가 이번 대상이다.
 *
 *    · 답 대상은 **Persona 댓글뿐**이다(실회원 응답은 창업자 결정 항목).
 *    · 🔴 같은 대상은 한 번만 소비한다 — 그 댓글에 **누구든**(실회원 포함) 답한 적이 있으면,
 *      그 답이 지금 지워졌더라도 이미 소비된 거리다. 지운 답을 핑계로 같은 자리에 다시 달지 않는다.
 *    · 신고·삭제·신고 여부 모름·사슬이 긴 댓글은 거리로 세지 않는다.
 *    · 글 자체의 반응(질문·반론·경험·공감)은 **새 최상위 추가 댓글 한 번**으로만 소비한다.
 *      첫 댓글은 글에 대한 기본 응답이라 이 거리를 소비하지 않는다.
 */
export function openHooksOf(f: FollowupPostFacts, live: readonly FollowupCommentRow[]): FollowupTarget[] {
  const consumed = new Set(f.comments.filter((c) => c.parentId !== null).map((c) => c.parentId as string))
  const options: { hookRank: number; atMs: number; id: string; t: FollowupTarget }[] = []
  for (const c of live) {
    if (c.commentOrigin !== 'PERSONA' || c.reaction === null || !FOLLOWUP_HOOKS.includes(c.reaction)) continue
    if (c.reported !== false || consumed.has(c.id)) continue
    const ctx = conversationContextFor(f.comments, c.id, { postId: f.postId })
    if (!ctx.ok) continue
    if (ctx.chain.length + 1 > FOLLOWUP_CHAIN_MAX) continue
    options.push({
      hookRank: HOOK_ORDER.indexOf(c.reaction), atMs: c.createdAt.getTime(), id: c.id,
      t: { kind: 'reply', commentId: c.id, hook: c.reaction, threadRootId: ctx.threadRootId },
    })
  }
  // 🔴 동률은 시각 → id 순서다(해시 없이도 결정적)
  options.sort((a, b) => a.hookRank - b.hookRank || a.atMs - b.atMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const out = options.map((o) => o.t)
  const postHookUsed = f.comments.some((c) => c.commentOrigin === 'PERSONA' && c.parentId === null && c.provenance === 'followup')
  if (!postHookUsed && f.postReaction !== null && FOLLOWUP_HOOKS.includes(f.postReaction)) {
    out.push({ kind: 'post', hook: f.postReaction })
  }
  return out
}

/**
 * 🔴 **한 회차에 자리가 모자라면 추가 댓글이 적은 글부터 잇는다.**
 *    읽은 순서대로 자리를 주면 앞 글들이 하루 상한을 다 먹고 나머지는 전부 첫 댓글로 끝난다
 *    (fixture 시뮬레이션 D100 실측: 71/100). 같은 수면 글 id 해시로 섞는다 — 결정적이다.
 */
export function orderFollowupGo<T extends { postId: string; go: Extract<FollowupPostVerdict, { verdict: 'GO' }> }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => a.go.extrasSoFar - b.go.extrasSoFar
    || unitOf('followup-order', a.postId, String(a.go.ordinal)) - unitOf('followup-order', b.postId, String(b.go.ordinal)))
}

// ─────────────────────────────────────────────────────────
// 🔴 Persona 고르기 — 반복 · 자기 글 · 자기 댓글 · 쏠림 금지
// ─────────────────────────────────────────────────────────

export type FollowupPersonaCandidate = {
  personaId: string
  /** 🔴 기존 계약(active · contract-valid · No-Go · 생활사)을 이미 통과했는가 — 여기서 다시 판정하지 않는다 */
  eligible: boolean
  /** 오늘 이 Persona 의 추가 댓글 수. 모르면 null — 그 Persona 를 뺀다 */
  followupsToday: number | null
}

export function pickFollowupPersona(
  go: Extract<FollowupPostVerdict, { verdict: 'GO' }>,
  postId: string,
  candidates: readonly FollowupPersonaCandidate[],
  /** 🔴 검증된 profile 의 `perPersonaDailyMax` — 손상이면 아무도 고르지 않는다 */
  perPersonaDailyMax: number,
): { personaId: string } | { personaId: null; reason: string } {
  if (!isPosInt(perPersonaDailyMax)) return { personaId: null, reason: 'Persona 하루 상한이 손상됐다(fail-closed)' }
  const excluded = new Set(go.excludePersonaIds)
  const pool = candidates.filter((c) => c.eligible && !excluded.has(c.personaId)
    && isCount(c.followupsToday) && c.followupsToday < perPersonaDailyMax)
  if (pool.length === 0) return { personaId: null, reason: '이을 수 있는 Persona 가 없다(반복·자기 글·하루 상한·자격)' }
  // 🔴 자격이 같은 후보 사이의 동률 순서만 해시로 정한다 — 같은 (글, 순번)에는 같은 사람
  const ranked = [...pool].sort((a, b) =>
    unitOf('followup-persona', postId, String(go.ordinal), a.personaId)
    - unitOf('followup-persona', postId, String(go.ordinal), b.personaId))
  return { personaId: ranked[0]!.personaId }
}

// ─────────────────────────────────────────────────────────
// 🔴 생성 뒤 본문 검사 — 내용 중복 · 같은 도입
// ─────────────────────────────────────────────────────────

/** 비교용 정규화 — 공백·문장부호·이모티콘 반복을 지운다 */
export function normalizeForDup(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}ㅋㅎㅠㅜ]+/gu, '')
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2))
  return out
}

export function bigramJaccard(a: string, b: string): number {
  const A = bigrams(normalizeForDup(a))
  const B = bigrams(normalizeForDup(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

/** 🔴 이 이상 겹치면 같은 말로 본다 */
export const FOLLOWUP_DUP_JACCARD_MAX = 0.5
/** 🔴 Persona 댓글끼리 첫 이만큼(정규화 글자)이 같으면 같은 도입으로 본다 — AI 티의 대표 */
export const FOLLOWUP_SAME_OPENING_CHARS = 6

export function judgeFollowupText(input: {
  text: string
  /** 이 글의 살아 있는 댓글 본문(실회원 포함)과 글 본문 */
  existing: readonly { text: string; persona: boolean }[]
}): { ok: boolean; blockers: string[] } {
  const blockers: string[] = []
  const n = normalizeForDup(input.text)
  if (n.length === 0) blockers.push('본문이 비었다')
  for (const e of input.existing) {
    const m = normalizeForDup(e.text)
    if (m.length === 0) continue
    if (m === n) { blockers.push('🔴 이미 있는 말과 같다'); break }
    if (bigramJaccard(e.text, input.text) >= FOLLOWUP_DUP_JACCARD_MAX) { blockers.push('🔴 이미 있는 말과 거의 같다'); break }
    if (e.persona && n.length >= FOLLOWUP_SAME_OPENING_CHARS
      && m.slice(0, FOLLOWUP_SAME_OPENING_CHARS) === n.slice(0, FOLLOWUP_SAME_OPENING_CHARS)) {
      blockers.push('🔴 다른 Persona 댓글과 도입이 같다'); break
    }
  }
  return { ok: blockers.length === 0, blockers }
}

// ─────────────────────────────────────────────────────────
// 🔴 회차 판정 — kill switch · 첫 댓글 양보 · 예산 · 회차 상한
// ─────────────────────────────────────────────────────────

export type FollowupTickFacts = {
  switch: FollowupSwitch
  /** 댓글 단계 — 🔴 추가 댓글은 무인 레인(`bootstrap-auto`) 위에서만 돈다 */
  commentStage: string
  /** 🔴 PersonaGlobalSwitch 가 꺼져 있는가(=발행해도 되는가). 모르면 null */
  killSwitchOff: boolean | null
  /** 🔴 60분 창 안에서 아직 첫 댓글이 없는 자동 글 수. 모르면 null */
  pendingFirstComments: number | null
  /** 🔴 호출부가 주입한 그날의 승인 profile — 검증은 여기서 한다 */
  profile: unknown
  /** 그날 런타임 단계(`StageDecision` 공개 단계). 모르면 null */
  runtimeStage: string | null
  /** 오늘 추가 댓글 발행 수 · 쓴 USD. 모르면 null */
  followupsToday: number | null
  followupUsdToday: number | null
  /** 🔴 댓글 장부(첫 댓글과 공유)의 오늘 남은 USD. 모르면 null */
  commentLedgerRemainingUsd: number | null
  /** 🔴 오늘 아직 남은 첫 댓글 의무를 위해 남겨 둘 USD(남은 자동 글 × 1건 예약액). 모르면 null */
  firstCommentReserveUsd: number | null
  /** 추가 댓글 1건의 예약액(USD) */
  perCallReserveUsd: number
}

export type FollowupTickVerdict = { allowed: number; blockers: string[]; detail: string }

/**
 * 🔴 **이번 회차에 추가 댓글을 최대 몇 건 만들 수 있는가.** 모르면 0 이다.
 *    첫 댓글이 기다리고 있으면 0 이다 — 추가 댓글은 첫 댓글의 시간·돈을 먹지 않는다.
 */
export function judgeFollowupTick(f: FollowupTickFacts): FollowupTickVerdict {
  const blockers: string[] = []
  if (!f.switch.enabled) blockers.push(f.switch.reason)
  if (f.commentStage !== 'bootstrap-auto') blockers.push(`댓글 단계 ${f.commentStage} — 추가 댓글은 bootstrap-auto 위에서만`)
  if (f.killSwitchOff !== true) blockers.push(f.killSwitchOff === false ? 'kill switch 가 켜져 있다' : 'kill switch 상태를 읽지 못했다(fail-closed)')
  if (!isCount(f.pendingFirstComments)) blockers.push('첫 댓글 대기 수를 읽지 못했다(fail-closed)')
  else if (f.pendingFirstComments > 0) blockers.push(`첫 댓글을 기다리는 글 ${f.pendingFirstComments}편 — 이번 회차는 첫 댓글에 양보한다`)
  const prof = validateFollowupProfile(f.profile, f.runtimeStage)
  if (!prof.ok) blockers.push(prof.reason)
  if (!isCount(f.followupsToday)) blockers.push('오늘 추가 댓글 수를 읽지 못했다(fail-closed)')
  const money = [f.followupUsdToday, f.commentLedgerRemainingUsd, f.firstCommentReserveUsd, f.perCallReserveUsd]
  if (money.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0) || !(f.perCallReserveUsd > 0)) {
    blockers.push('비용 값을 읽지 못했다(fail-closed)')
  }
  if (blockers.length > 0 || !prof.ok) return { allowed: 0, blockers, detail: blockers[0] ?? '' }

  const P = prof.profile
  const countLeft = Math.max(0, P.dailyCount - (f.followupsToday as number))
  const ownUsdLeft = Math.max(0, P.dailyUsd - (f.followupUsdToday as number))
  // 🔴 공유 장부에서 첫 댓글 몫을 먼저 떼고 남은 것만 쓴다
  const sharedLeft = Math.max(0, (f.commentLedgerRemainingUsd as number) - (f.firstCommentReserveUsd as number))
  const byMoney = Math.floor(Math.min(ownUsdLeft, sharedLeft) / f.perCallReserveUsd)
  const allowed = Math.min(P.runMax, countLeft, byMoney)
  return {
    allowed, blockers: [],
    detail: `회차 ${allowed}건 = min(회차 ${P.runMax} · 건수 잔량 ${countLeft} · 비용 ${byMoney}) · profile ${P.stage}`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 Queue 도장 — 스키마를 바꾸지 않고 `gateResults.followup` 에 싣는다
// ─────────────────────────────────────────────────────────

/** 🔴 판 이름 — 바뀌면 옛 도장을 새 계약으로 읽지 않는다 */
export const FOLLOWUP_STAMP_VERSION = 'followup-v1'

export type FollowupStamp = {
  v: typeof FOLLOWUP_STAMP_VERSION
  postId: string
  ordinal: number
  /** 답글이면 직접 대상 댓글 id, 새 최상위 댓글이면 null */
  parentCommentId: string | null
  hook: ReactionType
}

export function stampOf(postId: string, go: Extract<FollowupPostVerdict, { verdict: 'GO' }>): FollowupStamp {
  return {
    v: FOLLOWUP_STAMP_VERSION, postId, ordinal: go.ordinal,
    parentCommentId: go.target.kind === 'reply' ? go.target.commentId : null,
    hook: go.target.hook,
  }
}

/**
 * 🔴 발행 직전에 도장을 다시 읽는다. 모양이 아니거나 열쇠와 어긋나면 발행하지 않는다 —
 *    손으로 고친 행 · 다른 판 도장 · 순번이 밀린 행을 자동으로 내보내지 않는다.
 */
export function verifyStamp(raw: unknown, expect: { postId: string; dedupKey: string }): { ok: true; stamp: FollowupStamp } | { ok: false; reason: string } {
  if (raw === null || typeof raw !== 'object') return { ok: false, reason: '추가 댓글 도장이 없다' }
  const s = raw as Partial<FollowupStamp>
  if (s.v !== FOLLOWUP_STAMP_VERSION) return { ok: false, reason: `도장 판이 ${String(s.v)} 다` }
  if (s.postId !== expect.postId) return { ok: false, reason: '도장의 글과 대상 글이 다르다' }
  if (!isCount(s.ordinal) || s.ordinal < 2 || s.ordinal > FOLLOWUP_TOTAL_PER_POST_MAX) return { ok: false, reason: '도장 순번이 범위 밖이다' }
  if (followupKeyOf(expect.postId, s.ordinal) !== expect.dedupKey) return { ok: false, reason: '도장 순번과 멱등 열쇠가 다르다' }
  if (s.parentCommentId !== null && (typeof s.parentCommentId !== 'string' || s.parentCommentId === '')) {
    return { ok: false, reason: '답글 대상이 모양이 아니다' }
  }
  if (typeof s.hook !== 'string' || !FOLLOWUP_HOOKS.includes(s.hook as ReactionType)) return { ok: false, reason: '도장의 이어질 거리가 모양이 아니다' }
  return { ok: true, stamp: s as FollowupStamp }
}

// ─────────────────────────────────────────────────────────
// 🔴 출처 — 첫 댓글 판정(`commentProvenanceOf`) 위에 `followup` 한 칸만 더한다
// ─────────────────────────────────────────────────────────

export type PersonaCommentProvenance = 'auto' | 'followup' | 'none' | 'broken'

/**
 * 🔴 **추가 댓글 표식이 있으면 추가 댓글 계약으로, 없으면 첫 댓글 정본 그대로 판정한다.**
 *    · 두 표식이 한 댓글에 섞이면 `broken` 이다 — 같은 사건이 첫 댓글이자 추가 댓글일 수 없다.
 *    · 추가 댓글은 60분 창을 보지 않는다(시간차로 늦게 붙는 것이 정상이다). 답글이어도 된다.
 *    · 세 행(Comment · Queue · ActivityLog)이 한 줄씩 · 같은 Persona · 같은 글 · 같은 결정 시각이어야 한다.
 */
export function followupProvenanceOf(f: CommentLinkFacts): PersonaCommentProvenance {
  const marked = f.queues.some((q) => (q.decidedBy ?? '').trim() === FOLLOWUP_DECIDED_BY)
    || f.logs.some((l) => (l.decidedBy ?? '').trim() === FOLLOWUP_ACTIVITY_DECIDED_BY)
  if (!marked) return commentProvenanceOf(f)
  if (f.queues.length !== 1 || f.logs.length !== 1) return 'broken'
  const q = f.queues[0]!
  const l = f.logs[0]!
  if (q.status !== 'PUBLISHED' || (q.decidedBy ?? '').trim() !== FOLLOWUP_DECIDED_BY) return 'broken'
  if ((l.decidedBy ?? '').trim() !== FOLLOWUP_ACTIVITY_DECIDED_BY) return 'broken'
  const c = f.comment
  if (c.personaId === null || q.personaId !== c.personaId || l.personaId !== c.personaId) return 'broken'
  if (q.targetPostId !== c.postId) return 'broken'
  if (q.decidedAtMs === null || l.publishedAtMs === null || q.decidedAtMs !== l.publishedAtMs) return 'broken'
  if (c.createdAtMs - q.decidedAtMs < -AUTO_COMMENT_CLOCK_SKEW_MS) return 'broken'
  return 'followup'
}
