/**
 * 글당 Persona **추가 댓글**(첫 댓글 뒤 — 몇 건인지는 글의 대화 계획) 판정 — 🔴 순수 함수. DB · 시계 · 네트워크 · provider 없음
 *
 * 🔴 **왜 생겼나** (2026-10-13 · D100 canon §5 "첫 댓글에서 선택적 다중 턴으로").
 *
 *    무인 레인은 글마다 60분 안 첫 댓글 1건을 보장한다(`persona-comment-auto-lane`). 그 1건은
 *    **증명용 하한**이지 "글마다 정확히 1건" 이라는 제품 정책이 아니다(canon §5). 질문·경험·공감·
 *    가벼운 반론처럼 이어질 거리가 있으면 대화가 자연스럽게 이어져야 하고, 인사·맞장구로 끝나는
 *    대화는 끝나도 된다. 이 파일은 **"지금 이 글에 한 건 더 이어도 되는가"** 하나만 판정한다.
 *
 * 🔴 **첫 댓글 계약을 건드리지 않는다.**
 *    · 첫 댓글이 자동 출처(`auto`)로 붙은 글에만 이어 붙인다 — 추가 댓글은 첫 댓글을 대신하지 않는다.
 *    · 60분 안 첫 댓글을 기다리는 글이 하나라도 있으면 이 레인은 그 회차를 통째로 양보한다.
 *    · 표식·출처 분류는 단계 증거 정본(`stage-evidence` 의 `FOLLOWUP_LANE_*` · `personaCommentProvenanceOf`)을
 *      그대로 쓴다(#707). 이 파일에 표식 상수·분류기를 다시 두지 않는다 — 두 곳에 있으면 언젠가 갈린다.
 *    · 🔴 **대화 감사(`judgeConversationAudit`)가 FAIL 이거나 읽지 못했으면 추가 댓글 후보 0** 이다.
 *      첫 댓글 경로는 이 파일을 보지 않으므로 멈추지 않는다.
 *
 * 🔴 **기본 OFF.** `SORAN_PERSONA_COMMENT_FOLLOWUP=on` 정확히 그 값일 때만 켜진다. 모르는 값은 OFF.
 *
 * 🔴 **누가 어디에 말할지는 글의 대화 계획이 정한다** (`persona-thread-plan`). 글 id 하나로 그 글의 Persona 댓글 수(목표 평균에서 나온 분포 — `persona-thread-target`)와
 *    자리마다의 종류(글에 답 · 글쓴이 답글 · 다른 사람 답글) · 모양 · 길이 · 간격이 정해진다. 이 파일은 계획의 다음 자리가
 *    **지금 사실로 설 수 있는지**만 본다(`followupSeatsOf`). 계획이 정한 자리가 막히면 새 사람의 자리로 넘어간다 —
 *    한 자리 · 한 사람의 실패가 글을 멈추지 않는다. 한 회차에 한 글에는 최대 한 건이다.
 *
 * 🔴 **실회원 대화가 먼저다.** 실회원 댓글이 있으면 추가량을 줄이고, 실회원 댓글에는 답하지 않는다
 *    (제한 canary 에서 실회원 댓글 자동 답글은 금지다 — D100 canon §5).
 *
 * 🔴 **사람** — 글쓴이는 자기 글에 답글로만 말한다(글당 3번까지). 다른 사람은 한 글에 두 번까지다 — 새 댓글 한 번,
 *    그리고 자기 댓글에 답이 달렸을 때 그 답에 한 번 더. 생성 쪽과 발행 트랜잭션이 같은 함수(`followupSeatsOf`)로 본다.
 *
 * 🔴 여기서 막는 것은 **이 레인이 더하는 축**뿐이다. 댓글 관문 · 생활사 · No-Go · 모델 확정 · provenance ·
 *    트랜잭션 재검사는 기존 경로가 그대로 본다. 이 파일은 그 위에 더할 뿐 하나도 빼지 않는다.
 */

import { createHash } from 'node:crypto'

import { authorKindOf, buildCommentThreads, conversationContextFor, type ContextRow } from './comment-thread'
import {
  activeAttempts, attemptKeyOf, isVoiceFailure, postPersonaKeyOf, type AttemptEntry, type AttemptLane,
} from './persona-comment-attempt-policy'
import { requestShapeRejected, transientProviderError } from './content-core/generation-failure'
import { AUTO_PERSONA_COMMENTS_PER_POST_MAX } from './persona-comment-auto-lane'
import { kstDayStart } from './persona-cap'
import { MEMBER_COMMENT_LIMIT_ON_PUBLISH } from './persona-comment-queue'
import { COMMENT_REACTION_ROLES, type ReactionType } from './persona-reaction-roles'
import {
  PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX,
  PERSONA_COMMENTS_PER_POST_MAX,
  PERSONA_OTHER_TURNS_PER_POST_MAX,
  PERSONA_REPLY_CHAIN_MAX,
} from './persona-target-rules'
import {
  PLAN_MIN_GAP_MS, THREAD_DEADLINE_MS, planSlotAt, threadPlanOf, unitOf, type PlanSeatKind,
} from './persona-thread-plan'
import type { PersonaCommentProvenance } from './stage-evidence'
import type { DecisionStageEnv } from './scale-runtime'
import { RUNTIME_STAGES, isRuntimeStage, type RuntimeStage } from './scale-profile'
import { kstDateString } from './release-canary'

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

/** 🔴 글당 Persona 댓글 총량 절대 상한 — 대화 계획의 가장 큰 크기(`PERSONA_COMMENTS_PER_POST_MAX`) */
export const FOLLOWUP_TOTAL_PER_POST_MAX = PERSONA_COMMENTS_PER_POST_MAX
/** 🔴 첫 댓글 뒤 추가 절대 상한 = 총량 상한 − 첫 댓글 1 */
export const FOLLOWUP_EXTRA_PER_POST_MAX = FOLLOWUP_TOTAL_PER_POST_MAX - AUTO_PERSONA_COMMENTS_PER_POST_MAX

/** 직전 Persona 댓글에서 최소 이만큼 띄운다 — 자리마다의 간격은 계획(`persona-thread-plan`)이 정한다 */
export const FOLLOWUP_MIN_GAP_MS = PLAN_MIN_GAP_MS
/**
 * 🔴 **대화 마감** — 공개 후 이 시간이 지난 글에는 새 자리를 열지 않는다(`THREAD_DEADLINE_MS` 하나에서 읽는다).
 *    계획의 간격이 이 마감에서 역산되므로 계획은 마감 안에 끝난다. 생성 · 발행 트랜잭션 · 시도 기억 창이 같은 값이다.
 */
export const FOLLOWUP_POST_AGE_MAX_MS = THREAD_DEADLINE_MS

/** 실회원 댓글이 1~2건이면 추가 상한을 이만큼으로 줄인다 */
export const FOLLOWUP_EXTRA_WITH_MEMBERS_MAX = 1

/** 답글 사슬 길이 상한(루트 포함) — 글쓴이와 다른 Persona 가 최대 세 번 왕복할 수 있다. */
export const FOLLOWUP_CHAIN_MAX = PERSONA_REPLY_CHAIN_MAX

// ─────────────────────────────────────────────────────────
// 🔴 비용 · 상한 · 표식
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **수량·비용 상한은 코드 상수가 아니라 승인된 profile 이다** (2026-10-13 마스터 보정).
 *
 *    D10 과 D100 의 하루 상한이 같을 수 없다. 그래서 상한을 여기 고정하지 않고, 호출부가 그날의
 *    런타임 단계 또는 모든 단계에 적용되는 **승인된 profile** 을 주입한다. 없거나 · 손상됐거나 · 단계가 다르거나 ·
 *    승인자가 없으면 그 회차는 **0건**(fail-closed)이다. 첫 댓글 예산은 profile 과 무관하게 먼저 뗀다.
 *    profile 의 값은 `deriveCommentScale`(하루 편수 · 글당 목표 평균 · Persona 수)이 계산한 것을 옮겨 적는다.
 */
export const FOLLOWUP_PROFILE_VERSION = 'followup-profile-v1'
/** 기능을 Dn 단계와 묶지 않는 운영 공통 profile 표식. 단계 전용 profile도 계속 지원한다. */
export const FOLLOWUP_PROFILE_ALL_STAGES = 'all'

export type FollowupProfile = {
  v: typeof FOLLOWUP_PROFILE_VERSION
  /** 적용 런타임 단계(`d10` · `d20` · `d100` …) 또는 운영 공통 `all` */
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
  if (p.stage !== FOLLOWUP_PROFILE_ALL_STAGES && p.stage !== runtimeStage) {
    return { ok: false, reason: `profile 단계 ${String(p.stage)} ≠ 운영 공통 또는 그날 단계 ${runtimeStage}(fail-closed)` }
  }
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


/** 결정적 [0, 1) — 계획과 같은 함수다. 여기서는 Persona 동률 순서에만 쓴다 */
export { unitOf }

/** 🔴 멱등 열쇠 — (글 · 순번). 같은 자리에 두 회차가 동시에 넣으면 unique 가 하나만 남긴다 */
export const FOLLOWUP_KEY_PREFIX = 'comment-followup:'
export function followupKeyOf(postId: string, ordinal: number): string {
  return `${FOLLOWUP_KEY_PREFIX}${postId}:${ordinal}`
}
/**
 * 🔴 추가 댓글 Queue 행인가 — **열쇠 모양으로만** 가른다.
 *    첫 댓글 sweep 은 이 행을 집지 않고(집으면 글당 1건 규칙에 막혀 닫힌다), 추가 댓글 sweep 은 이 행만 집는다.
 */
export const isFollowupKey = (dedupKey: string): boolean => dedupKey.startsWith(FOLLOWUP_KEY_PREFIX)
/**
 * 🔴 **닫힌 행은 자리 열쇠를 내놓는다.** 발행 재검사에서 닫힌(EXPIRED) 행이 `(글 · 순번)` 열쇠를 쥐고 있으면
 *    순번은 댓글이 늘어야 바뀌므로 그 글은 식을 때까지 아무도 못 선다. 닫을 때 열쇠를 이 모양으로 바꾼다 —
 *    추가 댓글 열쇠 모양이 아니라 sweep 이 다시 집지 않고, 행 id 가 붙어 서로 겹치지 않는다.
 */
export const FOLLOWUP_CLOSED_KEY_PREFIX = 'comment-followup-closed:'
export function closedFollowupKeyOf(dedupKey: string, rowId: string): string {
  return `${FOLLOWUP_CLOSED_KEY_PREFIX}${dedupKey.slice(FOLLOWUP_KEY_PREFIX.length)}:${rowId}`
}

// ─────────────────────────────────────────────────────────
// 🔴 한 글 판정
// ─────────────────────────────────────────────────────────

/** 판정에 쓰는 댓글 한 줄 — 🔴 본문 없음 */
export type FollowupCommentRow = ContextRow & {
  /** 신고가 접수된 댓글인가. 모르면 null — 그 댓글에는 답하지 않는다 */
  reported: boolean | null
  /** 🔴 출처 — 정본 `personaCommentProvenanceOf` 결과. Persona 댓글만 의미가 있다. 모르면 null */
  provenance: PersonaCommentProvenance | null
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
  /** 이 글의 댓글 전부(지운 것 포함 — 스레드 계산에 필요하다) */
  comments: readonly FollowupCommentRow[]
  /** 이 글을 대상으로 열려 있는 Queue 가 있는가(어느 레인이든). 모르면 null */
  hasOpenQueue: boolean | null
}

/** `hook` 은 계획이 이 자리에 준 모양(반응 역할)이다 */
export type FollowupTarget =
  /** 글에 새 최상위 댓글로 답한다 */
  | { kind: 'post'; hook: ReactionType }
  /** 그 Persona 댓글에 답한다 */
  | { kind: 'reply'; commentId: string; hook: ReactionType; threadRootId: string }

/**
 * 🔴 이번 자리의 화자. `author`(글쓴이) · `returning`(자기 댓글에 답이 달려 한 번 더 오는 사람)은 그 Persona 하나만 선다 —
 *    다른 Persona 로 바꾸지 않는다. `other` 는 이 글에 아직 없는 사람이다.
 */
export type FollowupSpeaker = { kind: 'author' | 'returning'; personaId: string } | { kind: 'other' }

/** 지금 설 수 있는 자리 하나 — 대상 · 화자 · 그 자리에서 쓸 수 있는 역할(앞에서부터 입력이 서는 첫 역할을 쓴다) */
export type FollowupSeat = { target: FollowupTarget; speaker: FollowupSpeaker; roles: readonly ReactionType[] }

export type FollowupPostVerdict =
  /**
   * `target` · `speaker` · `roles` 는 계획이 먼저 서 보라고 한 자리(`seats[0]`)다. 🔴 한 자리가 막혀도 글은 멈추지 않는다 —
   * 그 자리에 설 사람이 없으면 부르는 쪽이 `seats` 의 다음 자리로 넘어간다(`pickFollowupSeat`).
   */
  | { verdict: 'GO'; ordinal: number; extrasSoFar: number; openHooks: number; key: string; target: FollowupTarget; speaker: FollowupSpeaker; excludePersonaIds: readonly string[]; roles: readonly ReactionType[]; seats: readonly FollowupSeat[]; reason: string }
  | { verdict: 'WAIT'; notBeforeMs: number | null; reason: string }
  | { verdict: 'STOP'; reason: string }
  | { verdict: 'BLOCK'; reason: string }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

type FollowupBase =
  | { ok: false; verdict: Extract<FollowupPostVerdict, { verdict: 'STOP' | 'BLOCK' }> }
  | {
      ok: true
      live: readonly FollowupCommentRow[]
      livePersona: readonly FollowupCommentRow[]
      extrasSoFar: number
      cap: number
      ordinal: number
      lastPersonaMs: number
      /** 이 글에 이미 나온 Persona(지운 댓글 포함) + 글쓴 Persona — 일반 화자는 다시 쓰지 않는다 */
      onPost: ReadonlySet<string>
      publishedAtMs: number
    }

/**
 * 🔴 **생성 판정과 발행 트랜잭션이 함께 쓰는 사실 검사** — 같은 결정을 두 곳에 적지 않는다.
 *    사실 · 출처 · 첫 댓글 · 총량 · 실회원 상한 · 마지막 말 · 현재성까지. 시간차 jitter · 열린 후보 · 대상 고르기는 밖에서 본다.
 */
function followupBaseOf(f: FollowupPostFacts, nowMs: number): FollowupBase {
  const block = (reason: string): FollowupBase => ({ ok: false, verdict: { verdict: 'BLOCK', reason } })
  const stop = (reason: string): FollowupBase => ({ ok: false, verdict: { verdict: 'STOP', reason } })
  if (f.postStatus !== 'PUBLISHED') return block(`글 상태가 ${f.postStatus ?? '불명'} 다`)
  if (f.autoManagedPost !== true) {
    return block(f.autoManagedPost === false ? '관리형 자동 글이 아니다 — 잇지 않는다' : '관리형 자동 글인지 모른다(fail-closed)')
  }
  if (f.authorPersonaId === undefined) return block('글 작성 Persona 를 읽지 못했다(fail-closed)')
  if (f.publishedAtMs === null || !Number.isFinite(f.publishedAtMs) || f.publishedAtMs > nowMs) {
    return block('글의 공개 시각을 읽지 못했거나 미래다(fail-closed)')
  }
  for (const c of f.comments) {
    if (c.postId !== f.postId) return block('다른 글의 댓글이 섞였다(fail-closed)')
    // 🔴 지운 댓글도 본다 — 출처 모순은 지웠다고 사라지지 않는다
    if (!authorKindOf(c).ok) return block('댓글 작성자 종류가 모순이다(fail-closed)')
  }
  // 🔴 순환 · 사라진 부모 — 관계가 어긋난 글에 답글을 얹지 않는다
  if (buildCommentThreads(f.comments, { postId: f.postId, blockedAuthorIds: new Set() }).anomalies.length > 0) {
    return block('댓글 관계가 어긋났다(순환·사라진 부모) — fail-closed')
  }
  const live = f.comments.filter((c) => !c.isDeleted)
  const livePersona = live.filter((c) => c.commentOrigin === 'PERSONA')
  const historicalPersonaCount = f.comments.filter((c) => c.commentOrigin === 'PERSONA').length
  const liveReal = live.filter((c) => c.commentOrigin === 'MEMBER' || c.commentOrigin === 'GUEST')

  // ── 첫 댓글 계약 — 추가 댓글은 자동 출처 첫 댓글 위에서만 ──
  if (livePersona.some((c) => c.provenance === 'broken' || c.provenance === 'followup-broken' || c.provenance === null)) {
    return block('출처가 깨졌거나 모르는 Persona 댓글이 있다(fail-closed)')
  }
  if (!livePersona.some((c) => c.provenance === 'auto')) {
    return stop('자동 출처 첫 댓글이 없다 — 추가 댓글은 첫 댓글을 대신하지 않는다')
  }

  // ── 계획 크기 · 실회원 상한 ──
  // 🔴 구조 상한(`FOLLOWUP_TOTAL_PER_POST_MAX`)은 계획 크기의 최댓값이라 계획 크기가 먼저 막는다 — 따로 보지 않는다
  const personaCount = livePersona.length
  const planSize = threadPlanOf(f.postId, f.publishedAtMs).size
  if (personaCount >= planSize) return stop(`Persona 댓글 ${personaCount}건 — 이 글의 대화 계획 ${planSize}건을 다 채웠다`)
  const extrasSoFar = livePersona.filter((c) => c.provenance === 'followup').length
  // ── 실회원 우선 ──
  const realCap = liveReal.length >= MEMBER_COMMENT_LIMIT_ON_PUBLISH
    ? 0
    : liveReal.length > 0 ? FOLLOWUP_EXTRA_WITH_MEMBERS_MAX : FOLLOWUP_EXTRA_PER_POST_MAX
  const cap = Math.min(realCap, FOLLOWUP_EXTRA_PER_POST_MAX)
  if (extrasSoFar >= cap) {
    return stop(`추가 ${extrasSoFar}건 ≥ 이 글의 상한 ${cap} (실회원 ${liveReal.length}건)`)
  }
  const byTime = [...live].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const latest = byTime[byTime.length - 1]
  if (latest !== undefined && (latest.commentOrigin === 'MEMBER' || latest.commentOrigin === 'GUEST')) {
    return stop('마지막 말이 실회원이다 — Persona 가 끼어들지 않는다(실회원 대화 우선)')
  }
  // ── 마감 ──
  if (nowMs - f.publishedAtMs > FOLLOWUP_POST_AGE_MAX_MS) {
    return stop(`공개 ${Math.floor((nowMs - f.publishedAtMs) / 3_600_000)}시간 — 대화 마감(${FOLLOWUP_POST_AGE_MAX_MS / 3_600_000}시간)이 지났다`)
  }
  const onPost = new Set<string>()
  for (const c of f.comments) if (c.commentOrigin === 'PERSONA' && c.personaId !== null) onPost.add(c.personaId)
  if (f.authorPersonaId !== null) onPost.add(f.authorPersonaId)
  return {
    // 🔴 구조 상한은 live 수로 보되, 멱등 순번은 삭제 이력을 포함해 단조 증가한다.
    // 삭제 뒤 live 수로 순번을 재사용하면 이미 저장된 followup:<post>:N 과 충돌한다.
    ok: true, live, livePersona, extrasSoFar, cap, ordinal: historicalPersonaCount + 1,
    lastPersonaMs: Math.max(...livePersona.map((c) => c.createdAt.getTime())), onPost, publishedAtMs: f.publishedAtMs,
  }
}

/**
 * 🔴 **이 글에 지금 한 건 더 이어도 되는가.**
 *
 *    BLOCK — 사실을 못 읽었거나 모순이다(fail-closed). 그 글만 뺀다.
 *    STOP  — 이 글의 대화는 끝났다(계획을 다 채움 · 상한 · 실회원 우선 · 대화 마감).
 *    WAIT  — 아직 이르다(시간차). `notBeforeMs` 이후 다시 본다.
 *    GO    — 순번 · 멱등 열쇠 · 대상 · 제외 Persona · 역할 후보를 준다. Persona 를 고르지는 않는다.
 */
export function judgeFollowupPost(f: FollowupPostFacts, nowMs: number): FollowupPostVerdict {
  if (f.hasOpenQueue === null) return { verdict: 'BLOCK', reason: '열린 후보가 있는지 읽지 못했다(fail-closed)' }
  const b = followupBaseOf(f, nowMs)
  if (!b.ok) return b.verdict
  if (f.hasOpenQueue) return { verdict: 'WAIT', notBeforeMs: null, reason: '이 글에 열린 후보가 있다 — 쌓지 않는다' }
  const here = followupSeatsOf(f, b.ordinal)
  const first = here.seats[0]
  if (first === undefined) return { verdict: 'STOP', reason: '이 글의 계획에 남은 자리가 없다' }
  const notBeforeMs = b.lastPersonaMs + here.gapMs
  if (nowMs < notBeforeMs) {
    return { verdict: 'WAIT', notBeforeMs, reason: `시간차 — ${Math.ceil((notBeforeMs - nowMs) / 60_000)}분 뒤` }
  }
  return {
    verdict: 'GO', ordinal: b.ordinal, extrasSoFar: b.extrasSoFar, openHooks: here.seats.length,
    key: followupKeyOf(f.postId, b.ordinal), target: first.target, speaker: first.speaker,
    excludePersonaIds: [...b.onPost].sort(),
    roles: first.roles, seats: here.seats,
    reason: `추가 ${b.extrasSoFar + 1}/${b.cap} · 계획 ${b.ordinal}번째 · ${seatLabel(first)}`,
  }
}

const seatLabel = (s: FollowupSeat): string => (s.target.kind === 'post' ? '글에 새 댓글'
  : s.speaker.kind === 'author' ? '글쓴이 답글' : s.speaker.kind === 'returning' ? '댓글 쓴 사람이 다시 답글' : '다른 사람 답글')

/** 같은 판정을 `seats` 의 다른 자리로 본 것 — 순번 · 열쇠 · 제외 Persona 는 글의 것이라 그대로다 */
export function followupGoForSeat(
  go: Extract<FollowupPostVerdict, { verdict: 'GO' }>, seat: FollowupSeat,
): Extract<FollowupPostVerdict, { verdict: 'GO' }> {
  return { ...go, target: seat.target, speaker: seat.speaker, roles: seat.roles }
}

/** 🔴 답이 한 번이라도 달린 댓글(지운 답·실회원 답 포함) — 다시 소비하지 않는다 */
const consumedOf = (f: FollowupPostFacts): ReadonlySet<string> =>
  new Set(f.comments.filter((c) => c.parentId !== null).map((c) => c.parentId as string))

/**
 * 🔴 **그 댓글에 지금 답해도 되는가** — 반응 라벨은 보지 않는다(라벨은 고를 때 본다).
 *    살아 있음 · Persona 댓글 · 신고 없음(모름 포함 거절) · 아직 아무도 답하지 않음 · 사슬 깊이.
 *    생성 쪽(`openHooksOf`)과 발행 트랜잭션(`judgeFollowupPublish`)이 **같은 함수**를 쓴다.
 */
function replyTargetOpen(f: FollowupPostFacts, c: FollowupCommentRow, consumed: ReadonlySet<string>):
  { ok: true; threadRootId: string } | { ok: false; reason: string } {
  if (c.isDeleted) return { ok: false, reason: '대상 댓글이 지워졌다' }
  if (c.commentOrigin !== 'PERSONA') return { ok: false, reason: '대상이 Persona 댓글이 아니다(제한 canary 는 실회원 댓글에 자동으로 답하지 않는다)' }
  if (c.reported !== false) return { ok: false, reason: '대상 댓글이 신고됐거나 신고 여부를 모른다' }
  if (consumed.has(c.id)) return { ok: false, reason: '대상 댓글에 이미 답이 있다(같은 대상 재소비 금지)' }
  const ctx = conversationContextFor(f.comments, c.id, { postId: f.postId })
  if (!ctx.ok) return { ok: false, reason: `대상 맥락을 만들지 못했다(${ctx.reason})` }
  if (ctx.chain.length + 1 > FOLLOWUP_CHAIN_MAX) return { ok: false, reason: '답글 사슬이 깊다' }
  return { ok: true, threadRootId: ctx.threadRootId }
}

/** 앞에서부터 입력이 서는 첫 역할을 쓴다 — 계획의 모양이 먼저고, 못 서면 한마디 · 되묻기 · 공감 · 경험 순이다 */
const rolesOf = (shape: ReactionType): ReactionType[] =>
  [shape, ...(['other', 'question', 'empathy', 'experience'] as const).filter((r) => r !== shape)]
    .filter((r) => COMMENT_REACTION_ROLES.includes(r))

/**
 * 🔴 **이 순번에서 지금 설 수 있는 자리 — 계획이 정한 종류가 먼저, 그 뒤는 새 사람의 자리(글에 답 · 남의 댓글에 답)다.**
 *    생성 쪽(`judgeFollowupPost`)과 발행 트랜잭션(`judgeFollowupPublish`)이 **같은 함수**를 쓴다.
 *
 *    · 글에 답 — 이 글에 아직 없는 사람의 새 댓글. 언제나 설 수 있다
 *    · 글쓴이 답글 — 글쓴이 아닌 Persona 의 아직 답 없는 댓글에(글당 `PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX` 번까지)
 *    · 다른 사람 답글 — 자기 댓글에 답이 달린 사람이 그 답에 한 번 더(글당 `PERSONA_OTHER_TURNS_PER_POST_MAX` 번까지).
 *      그런 사람이 없으면 새 사람이 남의 댓글에 답한다
 *    답 대상은 Persona 댓글뿐이고 한 댓글에는 답이 하나만 달린다(`replyTargetOpen`).
 */
export function followupSeatsOf(f: FollowupPostFacts, ordinal: number): { seats: FollowupSeat[]; gapMs: number } {
  const slot = planSlotAt(threadPlanOf(f.postId, f.publishedAtMs), ordinal)
  if (slot === null) return { seats: [], gapMs: FOLLOWUP_MIN_GAP_MS }
  const author = f.authorPersonaId ?? null
  const consumed = consumedOf(f)
  const byId = new Map(f.comments.map((c) => [c.id, c]))
  const turnsOf = (personaId: string): number => f.comments.filter((c) => c.commentOrigin === 'PERSONA' && c.personaId === personaId).length
  // 🔴 동률은 시각 → id 순서다(해시 없이도 결정적)
  const open = [...f.comments]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((c) => {
      const o = replyTargetOpen(f, c, consumed)
      return o.ok ? [{ c, root: o.threadRootId }] : []
    })
  type Open = (typeof open)[number]
  const replyTo = (x: Open, speaker: FollowupSpeaker, hook: ReactionType): FollowupSeat =>
    ({ target: { kind: 'reply', commentId: x.c.id, hook, threadRootId: x.root }, speaker, roles: rolesOf(hook) })
  const forAuthor = author === null || turnsOf(author) >= PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX
    ? undefined : open.find((x) => x.c.personaId !== author)
  const back = open.flatMap((x) => {
    const parent = x.c.parentId === null ? undefined : byId.get(x.c.parentId)
    const who = parent?.commentOrigin === 'PERSONA' ? parent.personaId : null
    return who !== null && who !== author && who !== x.c.personaId && turnsOf(who) < PERSONA_OTHER_TURNS_PER_POST_MAX ? [{ x, who }] : []
  })[0]
  const forNew = open.filter((x) => x.c.personaId !== author).at(-1)
  const seatOf: Record<PlanSeatKind, (hook: ReactionType) => FollowupSeat | null> = {
    post: (hook) => ({ target: { kind: 'post', hook }, speaker: { kind: 'other' }, roles: rolesOf(hook) }),
    author: (hook) => (forAuthor === undefined || author === null ? null : replyTo(forAuthor, { kind: 'author', personaId: author }, hook)),
    reply: (hook) => (back !== undefined ? replyTo(back.x, { kind: 'returning', personaId: back.who }, hook)
      : forNew === undefined ? null : replyTo(forNew, { kind: 'other' }, hook)),
  }
  // 🔴 막힌 자리는 새 사람이 먼저 대신한다(글에 답 → 남의 댓글에 답). 글쓴이는 계획이 준 자리에서만 선다 —
  //    대체 순서에 글쓴이를 두면 사람이 없을 때마다 글쓴이가 서서 한 글에 글쓴이 답글이 두세 번 나온다
  const order: PlanSeatKind[] = [slot.kind, ...(['post', 'reply'] as const).filter((k) => k !== slot.kind)]
  const seats = order.flatMap((k) => {
    const seat = seatOf[k](k === slot.kind ? slot.shape : 'other')
    return seat === null ? [] : [seat]
  })
  return { seats, gapMs: slot.gapMs }
}

/**
 * 🔴 **한 회차에 자리가 모자라면 추가 댓글이 적은 글부터 잇는다.**
 *    읽은 순서대로 자리를 주면 앞 글들이 하루 상한을 다 먹고 나머지는 전부 첫 댓글로 끝난다
 *    (fixture 시뮬레이션 D100 실측: 71/100). 같은 수면 글 id 해시로 섞는다 — 결정적이다.
 */
export function orderFollowupGo<T extends { postId: string; publishedAtMs?: number | null; go: Extract<FollowupPostVerdict, { verdict: 'GO' }> }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => a.go.extrasSoFar - b.go.extrasSoFar
    || (b.publishedAtMs ?? 0) - (a.publishedAtMs ?? 0)
    || (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0))
}

// ─────────────────────────────────────────────────────────
// 🔴 실패 격리 — 실패한 Persona 가 매 회차 같은 자리를 다시 먹지 않게 (2026-11-14 H1 · starvation)
// ─────────────────────────────────────────────────────────

export type FollowupSourceContextFact = {
  postId: string
  operational: boolean | null
  reason: string
}

/**
 * 🔴 출처 문맥을 판독할 수 없는 글만 현재 회차에서 격리한다.
 * 한 글의 `null`은 글 속성이지 provider·DB 전체 장애가 아니다. 정상 글까지 막으면
 * 실패 글 하나가 모든 호출 용량을 막는 두 번째 starvation이 된다.
 * 실패 글은 다음 회차에 새 원문 상태로 다시 판독하며 provider를 부르지 않는다.
 */
export function partitionFollowupSourceContexts(facts: readonly FollowupSourceContextFact[]): {
  runnablePostIds: string[]
  blocked: { postId: string; reason: string }[]
} {
  const runnablePostIds: string[] = []
  const blocked: { postId: string; reason: string }[] = []
  for (const f of facts) {
    if (f.operational === null) blocked.push({ postId: f.postId, reason: f.reason })
    else runnablePostIds.push(f.postId)
  }
  return { runnablePostIds, blocked }
}

const DAY_MS = 24 * 3_600_000
/** 🔴 시각 t 가 속한 KST 날의 마지막 ms(포함) — 다음 KST 자정 00:00:00.000 에 기억이 끝난다 */
export const kstDayEndMs = (t: number): number => kstDayStart(new Date(t)).getTime() + DAY_MS - 1

/**
 * 🔴 **추가 댓글 실패 분류 코드** — 시도 기억 `blockCodes` 에 그대로 싣는다(파일 모양 v1 · `BLOCK_CODE_RE` 안).
 *
 *    근본 원인: `pickFollowupPersona` 는 (글, 순번) 해시로 같은 Persona 를 고른다. 실패를 기억하지 않으면
 *    **같은 실패 Persona 가 다음 회차에도 같은 자리에 다시 뽑힌다**. 그렇다고 글 전체를 막으면 그 글의 정상 Persona 까지
 *    하루 동안 못 고른다. 그래서 실패의 원인이 묶인 범위만 막는다.
 *
 *    · `FU_PERSONA_DAY` — 원인이 Persona 에 묶인 결정적 실패(⑧ 말투 · prompt 근거 · 비활성 · 실회원).
 *      그 Persona 를 KST 하루 동안 모든 글에서 빼고, **같은 회차에서** 다음 정상 Persona 를 다시 고른다
 *    · `FU_POST_DAY` — 원인이 글에 묶인 실패(글 사라짐 · 비공개 · 게시판 바뀜 · Persona 댓글 꽉 참 · 글 상태 모름).
 *      그 글만 KST 하루 동안 뺀다. 그 Persona 는 다른 글에서 그대로 쓴다
 *    · `FU_COMBO_DAY` — 그 글 × 그 Persona 의 본문에 묶인 실패(①~⑦ · ⑨ 관문 · 본문 중복 · 파싱 · 잘림 · 자리 중복 · 미완 기록).
 *      그 글에서 그 Persona 만 뺀다. ⑦(설정 모순 · 근거 없는 자기 경험)도 그 한 번의 본문이 만든 실패다 — 같은 사람이 다음 글에서는 통과한다.
 *      🔴 분류는 **실제로 막은 관문**이 정한다. ⑧ 표본이 모자란 신규 Persona 의 표시(`BOOTSTRAP_*`)는 원인이 아니라 꼬리표다 —
 *      그 꼬리표로 Persona 를 하루 빼면 본문 문제(②·⑦) 한 번에 그 사람이 모든 글에서 빠진다
 *    · `FU_TRANSIENT` — 일시 provider · IO · 장부 · 환경 실패(429 · 5xx · NETWORK · TIMEOUT · LEDGER_BLOCKED · 정산 모름 · DB ERROR).
 *      🔴 **아무것도 격리하지 않는다** — 다음 회차에 같은 조합을 다시 고를 수 있다. 이번 회차의 남은 호출은 멈춘다(fail-closed)
 *    · `FU_HALT` — 모르는 · 내부 실패 · 요청 모양 거부(400). 같은 글 × Persona 를 오늘 다시 보내지 않고 이번 회차를 멈춘다
 *      (모르는 실패에 돈을 한 번 더 쓰지 않는다 — `transientProviderError` 와 같은 원칙)
 */
export const FOLLOWUP_FAILURE_CODES = ['FU_PERSONA_DAY', 'FU_POST_DAY', 'FU_COMBO_DAY', 'FU_TRANSIENT', 'FU_HALT'] as const
export type FollowupFailureCode = (typeof FOLLOWUP_FAILURE_CODES)[number]
const isFailureCode = (c: string): c is FollowupFailureCode => (FOLLOWUP_FAILURE_CODES as readonly string[]).includes(c)

/** 🔴 이 분류가 이번 회차의 남은 provider 호출을 멈추는가 */
export const followupFailureHaltsRound = (c: FollowupFailureCode): boolean => c === 'FU_TRANSIENT' || c === 'FU_HALT'

const PERSONA_BLOCK_CODES: ReadonlySet<string> = new Set(['PERSONA_NOT_ACTIVE', 'PERSONA_REAL_MEMBER'])
const POST_BLOCK_CODES: ReadonlySet<string> = new Set([
  'POST_PERSONA_COMMENTS_FULL', 'POST_STATE_UNKNOWN', 'POST_NOT_PUBLISHED',
])
const INTERNAL_BLOCK_CODES: ReadonlySet<string> = new Set(['POST_ID_MISSING', 'TEXT_EMPTY', 'MODEL_NOT_CONFIRMED'])
/** 🔴 writer(`createPendingCandidateLocked`)의 글 쪽 실패 코드 */
const POST_WRITE_CODES: ReadonlySet<string> = new Set(['POST_GONE', 'BOARD_UNKNOWN', 'BOARD_CHANGED', 'NOT_PUBLISHED'])
/** 🔴 provider 앞 · 뒤 단계에서 그 Persona 의 근거로 막힌 코드 — prompt 가 Persona 말투 근거를 요구한다 */
const PERSONA_PROVIDER_CODES: ReadonlySet<string> = new Set(['PROMPT_BLOCKED'])
/** 🔴 그 한 번의 생성이 쓸 수 없었다 — 그 글 × Persona 만 */
const COMBO_PROVIDER_CODES: ReadonlySet<string> = new Set([
  'FOLLOWUP_TEXT_DUP', 'MAX_TOKENS_REACHED', 'EMPTY', 'JSON_PARSE', 'FIELD_MISSING', 'TOO_SHORT', 'TOO_LONG',
])
/** 🔴 일시 · 장부 · 환경 — 격리 없이 회차만 멈춘다 */
const TRANSIENT_PROVIDER_CODES: ReadonlySet<string> = new Set([
  'TIMEOUT', 'PROVIDER_EXCEPTION', 'SETTLE_NOT_RECORDED', 'SETTLE_AMOUNT_UNKNOWN', 'NO_API_KEY',
])

/**
 * 🔴 **한 시도의 결과 → 분류 코드.** 적재(`ENQUEUED`)는 실패가 아니다(null).
 *    겹치면 넓은 원인부터 — Persona → 글 → 내부 → 글 × Persona. 사람이 읽을 문장 · 본문은 받지 않는다.
 */
export function classifyFollowupFailure(o: {
  step: string
  /** provider 가 돌려준 오류 코드(PROVIDER_FAILED 일 때) */
  errorCode?: string | null
  /** writer 의 실패 코드(WRITE_FAILED 일 때) */
  writeCode?: string | null
  failedGates?: readonly string[]
  blockCodes?: readonly string[]
}): FollowupFailureCode | null {
  const gates = o.failedGates ?? []
  const codes = o.blockCodes ?? []
  switch (o.step) {
    case 'ENQUEUED':
      return null
    case 'STARTED':
      // 🔴 결과를 못 적은 시도 — 돈이 나갔는지 모른다. 같은 글 × Persona 만 오늘 다시 보내지 않는다(넓히지 않는다)
      return 'FU_COMBO_DAY'
    case 'PROVIDER_FAILED': {
      const c = (o.errorCode ?? '').trim()
      if (requestShapeRejected(c)) return 'FU_HALT'
      if (transientProviderError(c) || TRANSIENT_PROVIDER_CODES.has(c) || c.startsWith('LEDGER_BLOCKED')) return 'FU_TRANSIENT'
      if (PERSONA_PROVIDER_CODES.has(c)) return 'FU_PERSONA_DAY'
      if (COMBO_PROVIDER_CODES.has(c)) return 'FU_COMBO_DAY'
      return 'FU_HALT'
    }
    case 'PARSE_FAILED':
      return 'FU_COMBO_DAY'
    case 'ENQUEUE_BLOCKED':
      if (isVoiceFailure({ failedGates: gates }) || codes.some((c) => PERSONA_BLOCK_CODES.has(c))) {
        return 'FU_PERSONA_DAY'
      }
      if (codes.some((c) => POST_BLOCK_CODES.has(c))) return 'FU_POST_DAY'
      if (codes.some((c) => INTERNAL_BLOCK_CODES.has(c))) return 'FU_HALT'
      // 🔴 관문이 아예 돌지 않았다(관문 오류 · 입력 문맥 없음) — 내부 고장이다
      if (codes.includes('GATE_MISSING_REQUIRED') && gates.length === 0) return 'FU_HALT'
      return 'FU_COMBO_DAY'
    case 'WRITE_FAILED': {
      const c = (o.writeCode ?? '').trim()
      if (POST_WRITE_CODES.has(c)) return 'FU_POST_DAY'
      if (c === 'DUPLICATE') return 'FU_COMBO_DAY'
      if (c === 'ERROR') return 'FU_TRANSIENT'
      return 'FU_HALT'
    }
    case 'WRITE_SKIPPED':
      // 🔴 dry-run — 실패가 아니다. 그래도 같은 조합은 시작 기록이 막는다
      return null
    default:
      return 'FU_HALT'
  }
}

/** 🔴 기억 한 줄의 분류 — 적힌 `FU_*` 코드가 먼저, 없으면 같은 분류기로 다시 판정한다(미완 `STARTED` 포함) */
export function followupFailureCodeOf(e: Pick<AttemptEntry, 'step' | 'failedGates' | 'blockCodes'>): FollowupFailureCode | null {
  if (e.step === 'ENQUEUED' || e.step === 'WRITE_SKIPPED') return null
  const written = e.blockCodes.find(isFailureCode)
  if (written !== undefined) return written
  return classifyFollowupFailure({ step: e.step, failedGates: e.failedGates, blockCodes: e.blockCodes })
}

/** 🔴 오늘(KST) 막힌 범위 — 세 집합이 전부다. `FU_TRANSIENT` 는 어디에도 들지 않는다 */
export type FollowupIsolation = {
  personaCodes: Set<string>
  postIds: Set<string>
  /** `postPersonaKeyOf` — 글 × Persona */
  postPersonaKeys: Set<string>
}

export function emptyFollowupIsolation(): FollowupIsolation {
  return { personaCodes: new Set(), postIds: new Set(), postPersonaKeys: new Set() }
}

/** 🔴 한 분류를 격리 집합에 더한다 — 같은 회차 재선정이 읽는 집합과 다음 회차가 파일에서 읽는 집합이 같은 함수다 */
export function addFollowupIsolation(
  iso: FollowupIsolation, e: { postId: string; personaCode: string }, code: FollowupFailureCode | null,
): void {
  if (code === 'FU_PERSONA_DAY') iso.personaCodes.add(e.personaCode)
  else if (code === 'FU_POST_DAY') iso.postIds.add(e.postId)
  else if (code === 'FU_COMBO_DAY' || code === 'FU_HALT') iso.postPersonaKeys.add(postPersonaKeyOf(e))
}

/** 🔴 만료되지 않은(같은 KST 날) 기억에서 격리 범위를 만든다 */
export function followupIsolationOf(entries: readonly AttemptEntry[], nowMs: number): FollowupIsolation {
  const iso = emptyFollowupIsolation()
  for (const e of activeAttempts(entries, nowMs, FOLLOWUP_ATTEMPT_LANE)) addFollowupIsolation(iso, e, followupFailureCodeOf(e))
  return iso
}

/** 🔴 이 글 × Persona 가 오늘 막혔는가 — 이유 문장(코드 · 본문 없음) 또는 null */
export function followupIsolationReason(iso: FollowupIsolation, e: { postId: string; personaCode: string }): string | null {
  if (iso.personaCodes.has(e.personaCode)) return `${e.personaCode} 는 오늘(KST) Persona 실패로 격리됐다`
  if (iso.postIds.has(e.postId)) return '이 글은 오늘(KST) 글 쪽 실패로 격리됐다'
  if (iso.postPersonaKeys.has(postPersonaKeyOf(e))) return `이 글에서 ${e.personaCode} 는 오늘(KST) 이미 실패했다`
  return null
}

/**
 * 🔴 **글쓴이는 자기 글에서 글 × Persona 하루 격리를 받지 않는다.** 글쓴이 답글 자리는 다른 사람으로 바꿀 수 없어,
 *    한 번 탈락했다고 그 쌍을 하루 빼면 그 글의 대화가 자정까지 멈춘다. 대신 같은 (글 · 글쓴이 · 역할) 조합만
 *    시도 기억이 막는다(`followupSpentRoleKeys`) — 다음 회차에 남은 역할로 다시 선다.
 *    Persona 하루 격리(⑧ 말투 · 비활성)는 글쓴이에게도 그대로다.
 */
export function withoutAuthorOwnPost(
  iso: FollowupIsolation, authors: readonly { postId: string; personaCode: string }[],
): FollowupIsolation {
  const own = new Set(authors.map(postPersonaKeyOf))
  return {
    personaCodes: new Set(iso.personaCodes), postIds: new Set(iso.postIds),
    postPersonaKeys: new Set([...iso.postPersonaKeys].filter((k) => !own.has(k))),
  }
}

/** 🔴 오늘 이미 보내 실패로 끝난 (글 · Persona · 역할) 조합 — 같은 조합은 시작 기록이 거절하므로 고를 때 미리 뺀다 */
export function followupSpentRoleKeys(entries: readonly AttemptEntry[], nowMs: number): Set<string> {
  return new Set(activeAttempts(entries, nowMs, FOLLOWUP_ATTEMPT_LANE)
    .filter((e) => !FOLLOWUP_ATTEMPT_LANE.replaceableOnRestart(e)).map(attemptKeyOf))
}

/**
 * 🔴 **추가 댓글 시도 기억 lane.** 기억은 시도한 KST 날의 자정까지다 — 영구 차단 목록을 만들지 않는다.
 *    시도는 공개 후 `FOLLOWUP_POST_AGE_MAX_MS`(대화 마감) 안에서만 일어난다.
 *    · 같은 조합 재시작 — 적재로 끝난 조합(다음 자리의 새 시도)과 `FU_TRANSIENT` 만 새 시작으로 바꾼다
 *    · 마지막 방어선 — 오늘 격리된 Persona · 글이면 시작 기록을 받지 않는다. 글 × Persona 는 여기서 막지 않는다 —
 *      글쓴이가 자기 글에서 역할을 바꿔 다시 서는 길이고(`withoutAuthorOwnPost`), 같은 조합은 열쇠 중복으로 이미 거절된다
 */
export const FOLLOWUP_ATTEMPT_LANE: AttemptLane = Object.freeze({
  name: 'followup',
  windowLabel: 'KST 하루',
  expiresAtMs: (e: Pick<AttemptEntry, 'postPublishedAtMs' | 'attemptedAtMs'>) => kstDayEndMs(e.attemptedAtMs),
  attemptWindowMs: FOLLOWUP_POST_AGE_MAX_MS,
  allExpiredAtMs: (lastWriteMs: number) => kstDayEndMs(lastWriteMs),
  replaceableOnRestart: (prev: AttemptEntry) => prev.step === 'ENQUEUED' || followupFailureCodeOf(prev) === 'FU_TRANSIENT',
  startBlockedBy: (live: readonly AttemptEntry[], e: AttemptEntry) => {
    const iso = emptyFollowupIsolation()
    const key = attemptKeyOf(e)
    for (const x of live) if (attemptKeyOf(x) !== key) addFollowupIsolation(iso, x, followupFailureCodeOf(x))
    const why = followupIsolationReason({ ...iso, postPersonaKeys: new Set() }, e)
    return why === null ? null : `${why} — 다시 보내지 않는다`
  },
})

/**
 * 🔴 **같은 회차 재선정.** 자리(`allowed`)마다 예비 호출을 이만큼 더 허락한다 — 앞 Persona 가 실패하면 같은 글에서
 *    다음 정상 Persona 를 다시 고른다. 🔴 적재 상한은 `allowed` 그대로이고, 호출 상한(`providerCallBudget`)은 이 수와
 *    비용 잔량 건수 중 작은 쪽이다 — 하루 USD · 공유 장부 하루 상한(첫 댓글 몫 포함)을 넘는 호출은 없다.
 */
export const FOLLOWUP_SPARE_PER_SLOT = 1
export function followupPlanCap(allowed: number): number {
  return allowed * (1 + FOLLOWUP_SPARE_PER_SLOT)
}
/**
 * 🔴 **추가 댓글은 자기 장부 회차를 쓴다** — 첫 댓글과 회차 유료 요청 상한을 나눠 쓰지 않는다.
 *    한 회차 id 를 같이 쓰면 첫 댓글이 쓴 요청만큼 추가 댓글 몫이 줄어 profile 의 회차 상한을 구조상 못 채우고,
 *    장부가 `RUN_CAP` 으로 막아 회차가 멈춘다. 하루 USD 상한은 같은 장부(같은 날 파일)라 그대로 공용이다.
 */
export const followupLedgerRunIdOf = (firstCommentRunId: string): string => `${firstCommentRunId}-fu`
/** 🔴 추가 댓글 장부 회차의 유료 요청 상한 = 승인 profile 회차 상한의 호출 몫(`followupPlanCap`). profile 이 없으면 0 */
export function followupRunRequestCap(profile: unknown, runtimeStage: string | null): number {
  const prof = validateFollowupProfile(profile, runtimeStage)
  return prof.ok ? followupPlanCap(prof.profile.runMax) : 0
}
/** 🔴 한 회차에 한 글에서 provider 를 부르는 최대 횟수 — 한 글이 회차 예산을 다 먹지 않는다 */
export const FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK = 1 + FOLLOWUP_SPARE_PER_SLOT

/** 🔴 고를 수 있는 Persona 의 사실 — 자격 판정은 부르는 쪽 정본(`judgeRealMember` · 정적 말투 능력)이 끝낸 값이다 */
export type FollowupPersonaFacts = {
  code: string
  personaId: string | null
  active: boolean
  /** 🔴 실회원 Persona — 어떤 경우에도 고르지 않는다 */
  realMember: boolean
  /** identity · voiceCore · lifeStage 를 다 갖췄는가 */
  profileComplete: boolean
  /** `judgeStaticVoiceCapability` — 후보와 무관하게 ⑧ 이 막는 Persona 는 false */
  voiceCapable: boolean
  followupsToday: number
  /**
   * 🔴 한 건 더 달면 카드 상한(dailyCap · weeklyCap)을 넘는가 — 넘으면 그 사유, 아니면 null.
   *    발행 트랜잭션과 같은 `planCap` · 같은 셈법(활동 로그 + 열린 대기)으로 부르는 쪽이 만든다(`capBlocksForOneMore`).
   */
  capBlocked: string | null
}

/**
 * 🔴 **이 글에서 지금 고를 수 있는 Persona 후보.** 자격(활성 · 실회원 아님 · 프로필 · 말투 능력) → 오늘 격리
 *    (Persona · 글 · 글 × Persona) → 이번 회차 사용을 뺀다. 같은 회차에 같은 글에서 실패한 Persona 는 부르는 쪽이
 *    격리 집합(사본)에 먼저 더하므로 여기서 빠진다 — 따로 "시도함" 집합을 두지 않는다.
 *    순서 · 동률은 `pickFollowupPersona` 가 정한다(이 함수는 걸러내기만 한다).
 */
export function followupPersonaCandidates(i: {
  postId: string
  personas: readonly FollowupPersonaFacts[]
  isolation: FollowupIsolation
  usedPersonaIds: ReadonlySet<string>
}): FollowupPersonaCandidate[] {
  return i.personas.flatMap((p) => {
    if (p.personaId === null || !p.active || p.realMember || !p.profileComplete || !p.voiceCapable) return []
    // 🔴 상한이 찬 사람은 고르지 않는다 — 고른 뒤 발행 트랜잭션에서 닫히면 유료 생성을 버리고 그 자리도 빈다
    if (p.capBlocked !== null) return []
    if (i.usedPersonaIds.has(p.personaId)) return []
    if (followupIsolationReason(i.isolation, { postId: i.postId, personaCode: p.code }) !== null) return []
    return [{ personaId: p.personaId, eligible: true, followupsToday: p.followupsToday }]
  })
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

/**
 * 🔴 글쓴이 답글 자리에 글쓴이가 설 수 없는 **실제 사유** — 로그가 원인을 가리지 않게 한다.
 *    `followupPersonaCandidates` 가 거르는 순서와 같다. 설 수 있으면 null.
 */
export function followupAuthorUnavailableReason(i: {
  postId: string
  author: FollowupPersonaFacts | undefined
  isolation: FollowupIsolation
  usedPersonaIds: ReadonlySet<string>
  perPersonaDailyMax: number
}): string | null {
  const a = i.author
  if (a === undefined || a.personaId === null) return '글쓴이 Persona 를 찾지 못했다'
  if (!a.active) return `글쓴이 ${a.code} 가 비활성이다`
  if (a.realMember) return `글쓴이 ${a.code} 에 실회원 계정이 붙어 있다`
  if (!a.profileComplete) return `글쓴이 ${a.code} 의 프로필이 덜 찼다`
  if (!a.voiceCapable) return `글쓴이 ${a.code} 는 말투 고정 잠금이다`
  if (a.capBlocked !== null) return `글쓴이 ${a.code} — ${a.capBlocked}`
  if (i.usedPersonaIds.has(a.personaId)) return `글쓴이 ${a.code} 는 이번 회차에 이미 다른 글에 썼다`
  const iso = followupIsolationReason(i.isolation, { postId: i.postId, personaCode: a.code })
  if (iso !== null) return iso
  if (a.followupsToday >= i.perPersonaDailyMax) return `글쓴이 ${a.code} 의 오늘 추가 댓글 ${a.followupsToday}건 — 하루 상한 ${i.perPersonaDailyMax}`
  return null
}

export function pickFollowupPersona(
  go: Extract<FollowupPostVerdict, { verdict: 'GO' }>,
  postId: string,
  candidates: readonly FollowupPersonaCandidate[],
  /** 🔴 검증된 profile 의 `perPersonaDailyMax` — 손상이면 아무도 고르지 않는다 */
  perPersonaDailyMax: number,
): { personaId: string } | { personaId: null; reason: string } {
  if (!isPosInt(perPersonaDailyMax)) return { personaId: null, reason: 'Persona 하루 상한이 손상됐다(fail-closed)' }
  const speaker = go.speaker
  if (speaker.kind !== 'other') {
    // 🔴 정해진 사람의 자리 — 다른 Persona 로 바꾸지 않는다. 그 사람이 못 서면 부르는 쪽이 다음 자리로 넘어간다
    const a = candidates.find((c) => c.personaId === speaker.personaId)
    return a !== undefined && a.eligible && isCount(a.followupsToday) && a.followupsToday < perPersonaDailyMax
      ? { personaId: a.personaId }
      : { personaId: null, reason: speaker.kind === 'author' ? '글쓴이 답글 자리 — 글쓴이가 지금 설 수 없다' : '댓글 쓴 사람이 다시 답할 자리 — 그 사람이 지금 설 수 없다' }
  }
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

type FollowupGo = Extract<FollowupPostVerdict, { verdict: 'GO' }>

/**
 * 🔴 **이 글에서 지금 설 수 있는 (자리 · Persona) 하나 — 한 후보의 실패가 글을 멈추지 않는다.**
 *    자리는 `go.seats` 순서, 사람은 `pickFollowupPersona` 순서(결정적)다. 고른 사람이 `prepare`(유료 호출 **전** 준비 —
 *    생활사·No-Go · 입력 만들기)에서 막히면 같은 자리의 다음 사람으로, 그 자리에 설 사람이 없으면 다음 자리로 간다.
 *    글쓴이 자리는 글쓴이 한 사람뿐이라 글쓴이가 못 서면 바로 다음 자리다. 끝까지 없으면 **실제 사유**를 모아 돌려준다.
 */
export function pickFollowupSeat<T>(i: {
  go: FollowupGo
  postId: string
  candidates: readonly FollowupPersonaCandidate[]
  perPersonaDailyMax: number
  prepare: (seatGo: FollowupGo, personaId: string) => { ok: true; value: T } | { ok: false; reason: string }
  /** 글쓴이 자리에 글쓴이가 후보로 없을 때의 실제 사유(`followupAuthorUnavailableReason`) */
  authorWhy?: (authorPersonaId: string) => string | null
}): { ok: true; value: T; personaId: string } | { ok: false; reason: string } {
  const why: string[] = []
  for (const seat of i.go.seats) {
    const seatGo = followupGoForSeat(i.go, seat)
    const tried = new Set<string>()
    for (;;) {
      const pick = pickFollowupPersona(seatGo, i.postId, i.candidates.filter((c) => !tried.has(c.personaId)), i.perPersonaDailyMax)
      if (pick.personaId === null) {
        // 앞사람들의 사유는 이미 적혔다 — 아무도 서 보지 못한 자리만 고르기 사유를 적는다
        if (tried.size === 0) {
          const authorWhy = seat.speaker.kind === 'author' ? i.authorWhy?.(seat.speaker.personaId) ?? null : null
          why.push(authorWhy === null ? pick.reason : `${pick.reason} — ${authorWhy}`)
        }
        break
      }
      tried.add(pick.personaId)
      const r = i.prepare(seatGo, pick.personaId)
      if (r.ok) return { ok: true, value: r.value, personaId: pick.personaId }
      why.push(r.reason)
    }
  }
  const uniq = [...new Set(why)]
  return { ok: false, reason: `지금 설 사람이 없다 — ${uniq.slice(0, 4).join(' / ')}${uniq.length > 4 ? ` 외 ${uniq.length - 4}건` : ''}` }
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
  /**
   * 🔴 **최근 단계 증거의 대화 감사**(`StageEvidenceVerdict.conversation`) — 그대로 넘긴다.
   *    PASS 만 통과다. FAIL · 없음 · 모양이 아님 → 추가 댓글 0(fail-closed). 첫 댓글은 이 값을 보지 않는다.
   */
  conversationAudit: unknown
}

/**
 * 🔴 대화 감사 판독 — `{ verdict: 'PASS', codes: [] }` 만 통과다.
 *    PASS 인데 코드가 있거나 모양이 아니면 판독 불가로 막는다.
 */
export function readConversationAudit(raw: unknown): { ok: true } | { ok: false; reason: string } {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return { ok: false, reason: '대화 감사를 읽지 못했다 — 추가 댓글 0(fail-closed · 첫 댓글은 그대로)' }
  }
  const a = raw as { verdict?: unknown; codes?: unknown }
  // 🔴 코드 이름은 따로 대조하지 않는다 — FAIL 은 코드와 무관하게 막고, PASS 는 코드 0 만 통과다
  if (!Array.isArray(a.codes)) return { ok: false, reason: '대화 감사 코드가 모양이 아니다 — 추가 댓글 0(fail-closed)' }
  if (a.verdict === 'FAIL') {
    return { ok: false, reason: `대화 감사 FAIL [${(a.codes as string[]).join(',')}] — 추가 댓글 0(첫 댓글은 그대로)` }
  }
  if (a.verdict !== 'PASS' || a.codes.length > 0) {
    return { ok: false, reason: '대화 감사 판정이 모양이 아니다 — 추가 댓글 0(fail-closed)' }
  }
  return { ok: true }
}

export type FollowupTickVerdict = {
  /** 이번 회차에 **적재**할 수 있는 최대 건수 */
  allowed: number
  /**
   * 🔴 이번 회차에 provider 를 **부를** 수 있는 최대 횟수 — `min(followupPlanCap(allowed), 비용 잔량 건수)`.
   *    실패한 호출도 돈을 쓰므로 예비 후보 재선정은 비용 잔량(첫 댓글 몫을 뗀 공유 장부 · 추가 댓글 하루 USD) 안에서만 한다.
   */
  providerCallBudget: number
  blockers: string[]
  detail: string
}

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
  const audit = readConversationAudit(f.conversationAudit)
  if (!audit.ok) blockers.push(audit.reason)
  const prof = validateFollowupProfile(f.profile, f.runtimeStage)
  if (!prof.ok) blockers.push(prof.reason)
  if (!isCount(f.followupsToday)) blockers.push('오늘 추가 댓글 수를 읽지 못했다(fail-closed)')
  const money = [f.followupUsdToday, f.commentLedgerRemainingUsd, f.firstCommentReserveUsd, f.perCallReserveUsd]
  if (money.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0) || !(f.perCallReserveUsd > 0)) {
    blockers.push('비용 값을 읽지 못했다(fail-closed)')
  }
  if (blockers.length > 0 || !prof.ok) return { allowed: 0, providerCallBudget: 0, blockers, detail: blockers[0] ?? '' }

  const P = prof.profile
  const countLeft = Math.max(0, P.dailyCount - (f.followupsToday as number))
  const ownUsdLeft = Math.max(0, P.dailyUsd - (f.followupUsdToday as number))
  // 🔴 공유 장부에서 첫 댓글 몫을 먼저 떼고 남은 것만 쓴다
  const sharedLeft = Math.max(0, (f.commentLedgerRemainingUsd as number) - (f.firstCommentReserveUsd as number))
  const byMoney = Math.floor(Math.min(ownUsdLeft, sharedLeft) / f.perCallReserveUsd)
  const allowed = Math.min(P.runMax, countLeft, byMoney)
  // 🔴 같은 회차 재선정의 호출 상한 — 예비 후보 몫까지만 · 비용 잔량 건수를 넘지 않는다
  const providerCallBudget = Math.min(followupPlanCap(allowed), byMoney)
  return {
    allowed, providerCallBudget, blockers: [],
    detail: `회차 ${allowed}건 = min(회차 ${P.runMax} · 건수 잔량 ${countLeft} · 비용 ${byMoney}) · 호출 ${providerCallBudget} · profile ${P.stage}`,
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
  // 순번은 구조 상한이 아니라 삭제 이력을 포함한 사건 순서다. live 구조 상한은 followupBaseOf가 따로 지킨다.
  if (!isCount(s.ordinal) || s.ordinal < 2) return { ok: false, reason: '도장 순번이 범위 밖이다' }
  if (followupKeyOf(expect.postId, s.ordinal) !== expect.dedupKey) return { ok: false, reason: '도장 순번과 멱등 열쇠가 다르다' }
  if (s.parentCommentId !== null && (typeof s.parentCommentId !== 'string' || s.parentCommentId === '')) {
    return { ok: false, reason: '답글 대상이 모양이 아니다' }
  }
  if (typeof s.hook !== 'string' || !COMMENT_REACTION_ROLES.includes(s.hook as ReactionType)) return { ok: false, reason: '도장의 자리 모양이 정본 역할이 아니다' }
  return { ok: true, stamp: s as FollowupStamp }
}

/**
 * 🔴 **도장은 Queue `editDiff` 의 `followupStamp` 칸에 싣는다** (스키마 변경 0).
 *    `gateResults` 는 관문 결과 **배열**이라 섞으면 관문 판독(`readStoredGates`)이 깨진다.
 *    `editDiff` 는 사람 수정 승인용 칸인데, 추가 댓글 행은 무인 레인이라 사람이 고치지 않는다 —
 *    누가 고쳐 칸이 바뀌면 도장 검증이 실패해 발행하지 않는다(fail-closed).
 */
export const FOLLOWUP_STAMP_FIELD = 'followupStamp'
export const followupEditDiffOf = (stamp: FollowupStamp): Record<string, FollowupStamp> => ({ [FOLLOWUP_STAMP_FIELD]: stamp })
export function stampFromEditDiff(editDiff: unknown): unknown {
  if (editDiff === null || typeof editDiff !== 'object' || Array.isArray(editDiff)) return null
  return (editDiff as Record<string, unknown>)[FOLLOWUP_STAMP_FIELD] ?? null
}

// ─────────────────────────────────────────────────────────
// 🔴 profile 출처 — env 는 **파일 경로**만 가리킨다. 값은 승인 파일 안에 있다
// ─────────────────────────────────────────────────────────

/** 🔴 미설정이면 profile 없음 → 0건. 이 PR 은 이 env 를 어디에도 설정하지 않는다 */
export const FOLLOWUP_PROFILE_ENV = 'SORAN_PERSONA_COMMENT_FOLLOWUP_PROFILE'

/** 🔴 읽기만 주입받는다. 경로 없음 · 못 읽음 · JSON 아님 → null(검증이 0건으로 막는다) */
export function readFollowupProfileRaw(
  env: Readonly<Record<string, string | undefined>>, readText: (path: string) => string,
): unknown {
  const path = (env[FOLLOWUP_PROFILE_ENV] ?? '').trim()
  if (path === '') return null
  try { return JSON.parse(readText(path)) as unknown } catch { return null }
}

// ─────────────────────────────────────────────────────────
// 🔴 그날 단계 — consumer 가 넣은 오늘 결정 · 그날 결정 전이면 전날 결정 (E6 · 2026-11-22)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **추가 댓글이 믿는 그날 단계.** 회차(`readFollowupContext`)와 발행 트랜잭션이 **같은 함수**를 쓴다.
 *    입력은 단계 env 의 유일한 읽기 문(`decisionStageEnv`) 결과뿐이다 — 이 파일은 단계 칸을 직접 읽지 않는다.
 *    · 표식 날짜 = 오늘(KST) — 그날 결정
 *    · 표식 날짜 = 어제(KST) — 그날 결정이 아직 없을 때 consumer 가 넣은 전날 결정(`readSupplyHeadStart` → `headStartFor`).
 *      브레이크로 낮춘 전날 · 전날 행 없음은 consumer 가 표식을 넣지 않는다(→ 아래 null)
 *    · 표식 없음(consumer 미경유 · 수동 실행 · consumer 가 OFF 로 safest 를 넣음) → null
 *    · 이틀 이상 낡은 표식 · 미래 표식 · 손으로 적은 옛 표식 → null
 *    · 공개·천장이 정본 단계 이름이 아니다 · 공개 > 천장(consumer 가 낼 수 없는 모양 — 위조) → null
 */
export function followupStageOf(d: DecisionStageEnv, now: Date): { stage: RuntimeStage | null; reason: string } {
  const today = kstDateString(now)
  const yesterday = kstDateString(new Date(now.getTime() - 864e5))
  // 🔴 표식 없음(markDate null)도 "오늘·어제가 아님" 하나로 막는다 — 같은 판정을 두 줄로 쓰지 않는다
  if (d.markDate !== today && d.markDate !== yesterday) {
    return { stage: null, reason: d.markDate === null ? '그날 결정 표식이 없다(consumer 미경유) — 추가 댓글 0' : `결정 표식 ${d.markDate} 이 오늘·어제(KST)가 아니다 — 추가 댓글 0` }
  }
  if (!isRuntimeStage(d.release) || !isRuntimeStage(d.capacity)) return { stage: null, reason: '결정 단계 값이 정본 이름이 아니다(fail-closed)' }
  if (RUNTIME_STAGES.indexOf(d.release) > RUNTIME_STAGES.indexOf(d.capacity)) {
    return { stage: null, reason: `공개 ${d.release} > 천장 ${d.capacity} — consumer 가 낼 수 없는 모양이다(fail-closed)` }
  }
  return { stage: d.release, reason: `${d.markDate === today ? '오늘 결정' : '그날 결정 전 · 전날 결정'} · 공개 ${d.release} · 천장 ${d.capacity}` }
}

// ─────────────────────────────────────────────────────────
// 🔴 발행 트랜잭션 판정 — 트랜잭션 안에서 다시 읽은 사실로 본다
// ─────────────────────────────────────────────────────────

export type FollowupPublishFacts = {
  /** 🔴 트랜잭션이 env 에서 다시 읽은 값 — 호출부 주장을 믿지 않는다 */
  switch: FollowupSwitch
  commentStage: string
  actor: 'automation' | 'manual-admin'
  queueStatus: string
  dedupKey: string
  /** Queue `editDiff` 원본 */
  editDiff: unknown
  /** 트랜잭션 안에서 다시 읽은 글·댓글 사실. 반응 라벨은 없다(null) — 대상 고르기는 생성 쪽 몫이다 */
  post: FollowupPostFacts
  candidatePersonaId: string
  /** 그 글을 가리키는 **다른** 열린 Queue 가 있는가 */
  otherOpenQueue: boolean | null
  /** 🔴 트랜잭션이 승인 파일에서 다시 읽은 profile · 그날 런타임 단계 */
  profile: unknown
  runtimeStage: string | null
  /** 오늘(KST) 이미 발행된 추가 댓글 수 · 이 Persona 의 오늘 추가 댓글 수 — 트랜잭션 안에서 센 값 */
  followupsTodayInTx: number | null
  personaFollowupsTodayInTx: number | null
  nowMs: number
}

/**
 * 🔴 **추가 댓글 발행 직전 재판정.** 하나라도 어긋나면 발행하지 않는다.
 *    기존 재검사(댓글 관문 · 실회원 3건 · 같은 Persona · kill switch · 하루 예산 · provenance · 생활사 · cap)는
 *    호출부(`publishCandidateTx`)가 **그대로** 돌린다 — 이 판정은 그 위에 더할 뿐이다.
 */
export type FollowupPublishVerdict = {
  ok: boolean
  blockers: string[]
  personaRepeatAllowed: boolean
  /** 승인 profile의 오늘 남은 추가 댓글 수. 실패 시 null — bootstrap 예산으로 대체하지 않는다. */
  profileDailyRemaining: number | null
}

export function judgeFollowupPublish(f: FollowupPublishFacts): FollowupPublishVerdict {
  const blockers: string[] = []
  if (!f.switch.enabled) blockers.push(f.switch.reason)
  if (f.commentStage !== 'bootstrap-auto') blockers.push(`댓글 단계 ${f.commentStage} — 추가 댓글은 bootstrap-auto 위에서만`)
  if (f.actor !== 'automation') blockers.push('사람이 누른 발행은 추가 댓글 레인이 아니다')
  if (f.queueStatus !== 'PENDING') blockers.push(`Queue 상태가 ${f.queueStatus} 다 — 추가 댓글 레인은 PENDING 만 발행한다`)
  if (!isFollowupKey(f.dedupKey)) blockers.push('추가 댓글 열쇠가 아니다')
  const prof = validateFollowupProfile(f.profile, f.runtimeStage)
  if (!prof.ok) blockers.push(prof.reason)
  else {
    if (!isCount(f.followupsTodayInTx)) blockers.push('오늘 추가 댓글 수를 세지 못했다(fail-closed)')
    else if (f.followupsTodayInTx >= prof.profile.dailyCount) blockers.push(`오늘 추가 댓글 ${f.followupsTodayInTx}건 — profile 하루 상한 ${prof.profile.dailyCount}`)
    if (!isCount(f.personaFollowupsTodayInTx)) blockers.push('이 Persona 의 오늘 추가 댓글 수를 세지 못했다(fail-closed)')
    else if (f.personaFollowupsTodayInTx >= prof.profile.perPersonaDailyMax) blockers.push(`이 Persona 오늘 추가 ${f.personaFollowupsTodayInTx}건 — profile 상한 ${prof.profile.perPersonaDailyMax}`)
  }
  if (f.otherOpenQueue !== false) blockers.push(f.otherOpenQueue === null ? '다른 열린 후보를 읽지 못했다(fail-closed)' : '이 글에 다른 열린 후보가 있다')

  const st = verifyStamp(stampFromEditDiff(f.editDiff), { postId: f.post.postId, dedupKey: f.dedupKey })
  if (!st.ok) {
    blockers.push(st.reason)
    return { ok: false, blockers, personaRepeatAllowed: false, profileDailyRemaining: null }
  }
  const b = followupBaseOf(f.post, f.nowMs)
  if (!b.ok) {
    blockers.push(b.verdict.reason)
    return { ok: false, blockers, personaRepeatAllowed: false, profileDailyRemaining: null }
  }
  // 🔴 순번 — 적재 뒤 그 글에 다른 Persona 댓글이 생겼으면 이 후보의 자리는 사라졌다
  if (st.stamp.ordinal !== b.ordinal) blockers.push(`도장 순번 ${st.stamp.ordinal} ≠ 지금 자리 ${b.ordinal}`)
  // 🔴 시간차 — jitter 는 고를 때 이미 지났다. 여기서는 최소 간격만 다시 본다
  if (f.nowMs - b.lastPersonaMs < FOLLOWUP_MIN_GAP_MS) blockers.push('직전 Persona 댓글과 간격이 짧다')
  // 🔴 자리는 생성 쪽과 같은 함수가 정한다 — 도장의 대상이 지금도 이 순번의 자리이고, 그 자리에 설 수 있는 사람이어야 한다
  const here = followupSeatsOf(f.post, b.ordinal).seats
    .filter((s) => (s.target.kind === 'reply' ? s.target.commentId : null) === st.stamp.parentCommentId)
  let personaRepeatAllowed = false
  if (here.length === 0) blockers.push('🔴 지금 설 수 있는 자리가 아니다(답글 대상이 없거나 닫혔다)')
  else if (here.some((s) => s.speaker.kind !== 'other' && s.speaker.personaId === f.candidatePersonaId)) {
    personaRepeatAllowed = b.onPost.has(f.candidatePersonaId)
  } else if (!here.some((s) => s.speaker.kind === 'other')) blockers.push('🔴 정해진 사람의 자리다 — 다른 Persona 로 바꿔 내보내지 않는다')
  else if (b.onPost.has(f.candidatePersonaId)) blockers.push('🔴 이 Persona 는 이 글에 이미 썼거나 글쓴이다')
  const ok = blockers.length === 0
  const profileDailyRemaining = ok && prof.ok && isCount(f.followupsTodayInTx)
    ? Math.max(0, prof.profile.dailyCount - f.followupsTodayInTx)
    : null
  return {
    ok,
    blockers,
    personaRepeatAllowed: ok && personaRepeatAllowed,
    profileDailyRemaining,
  }
}
