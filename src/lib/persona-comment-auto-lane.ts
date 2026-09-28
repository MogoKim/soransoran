/**
 * 무인 댓글 루프 **bootstrap-auto 레인 규칙** — 🔴 순수 함수. DB · 시계 · 네트워크 없음
 *
 * 🔴 **왜 따로 두는가** (2026-09-28 · Track B).
 *
 *    댓글 경로에는 대상 선정 · 생성 · 9관문 · PENDING 적재 · 발행 트랜잭션이 전부 있었지만
 *    **하나로 이어 주는 예약 진입점**이 없었다. runner 는 사람이 승인한 행만 발행했고,
 *    후보는 아무도 만들지 않았다 — 그래서 공개 Persona 댓글은 0/day 였다.
 *
 *    무인으로 잇는 순간 새로 생기는 축은 넷뿐이다. 그 넷을 여기 한 곳에 둔다.
 *      ① 글이 공개된 뒤 **60분 안**에만 단다 — 늦은 첫 댓글은 대화가 아니라 발굴이다
 *      ② bootstrap-auto 에서는 **글당 1건**이다 — 글당 5건 자리는 organic 뒤의 일이다
 *      ③ 글을 쓴 Persona 는 **자기 글에** 달지 않는다 — 대화가 아니라 연출이다
 *      ④ 사람이 누르지 않은 발행은 **이 단계 · 자동 주체 · PENDING** 에서만 연다
 *
 * 🔴 **기존 규칙을 대신하지 않는다.** 9관문 · 실회원 댓글 3건 · 같은 Persona 두 번 ·
 *    kill switch · 일일 상한 · provenance · 생활사는 `recheckBeforePublish` · `planPublish` 가
 *    **같은 트랜잭션 안에서** 그대로 본다. 이 파일은 그 위에 넷을 더할 뿐 하나도 빼지 않는다.
 */

import type { BudgetLimits } from './llm-ledger'
import type { CommentStage } from './persona-comment-stage'
import { MEMBER_COMMENT_LIMIT_ON_PUBLISH } from './persona-comment-queue'

/** 🔴 이 레인이 열리는 유일한 단계 — 창업자가 env 로 올린 자리다 */
export const AUTO_LANE_STAGE: CommentStage = 'bootstrap-auto'

/**
 * 🔴 **새 글의 첫 댓글 시한(분).** 운영 정본(CURRENT-MILESTONE P0-B ①)의 수다.
 *    schedule 템플릿(`FIRST_COMMENT_MAX_MINUTES`)도 이 값을 쓴다 — 두 곳에 적지 않는다.
 */
export const AUTO_FIRST_COMMENT_WINDOW_MINUTES = 60
export const AUTO_FIRST_COMMENT_WINDOW_MS = AUTO_FIRST_COMMENT_WINDOW_MINUTES * 60_000

/** 🔴 bootstrap-auto 에서 한 글에 붙는 Persona 댓글 상한 (P0-B ②) */
export const AUTO_PERSONA_COMMENTS_PER_POST_MAX = 1

/**
 * 🔴 **기계 결정 표식.** 사람 승인과 구분되는 유일한 근거다 —
 *    "READY 는 status 가 아니라 decidedBy 로 센다" 는 운영 규칙과 같은 모양(`machine:` 접두)이다.
 */
export const AUTO_LANE_DECIDED_BY = 'machine:persona-comment-auto'
/** PersonaActivityLog.decidedBy — 스키마 주석의 `auto | operator` 중 `auto` */
export const AUTO_LANE_ACTIVITY_DECIDED_BY = 'auto'
/** 🔴 발행이 막힌 자동 후보를 닫을 때 남기는 코드 — 자유 텍스트가 아니다 */
export const AUTO_LANE_EXPIRE_REASON = 'AUTO_LANE_BLOCKED'

export type AutoLaneFacts = {
  stage: CommentStage
  /** 🔴 사람이 누른 발행은 이 레인이 아니다 */
  actor: 'automation' | 'manual-admin'
  /** Queue 행의 지금 상태 — 🔴 PENDING 만 이 레인에 들어온다 */
  queueStatus: string
  nowMs: number
  /** 글이 공개된 시각(`publishAt ?? createdAt`). 모르면 null */
  postPublishedAtMs: number | null
  /** 그 글의 살아 있는 Persona 댓글 수. 모르면 null */
  personaCommentsOnPost: number | null
  /** 글을 쓴 Persona 의 id. 사람이 쓴 글이면 null. 🔴 못 읽었으면 undefined */
  postAuthorPersonaId: string | null | undefined
  /** 댓글을 쓸 Persona 의 id */
  candidatePersonaId: string
  /** 그 글의 살아 있는 실사용자 댓글 수. 모르면 null */
  memberCommentsOnPost: number | null
}

export type AutoLaneVerdict = { ok: boolean; blockers: string[] }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/**
 * 🔴 **하나라도 어긋나면 이 레인으로 발행하지 않는다.** 전부 모아 돌려준다.
 *    모르는 값은 막는다 — 시각·수·작성자를 못 읽었으면 "괜찮다" 가 아니라 "모른다" 다.
 */
export function judgeAutoLane(f: AutoLaneFacts): AutoLaneVerdict {
  const blockers: string[] = []
  if (f.stage !== AUTO_LANE_STAGE) {
    blockers.push(`${f.stage} 단계다 — 무인 발행은 ${AUTO_LANE_STAGE} 에서만 연다`)
  }
  if (f.actor !== 'automation') blockers.push('사람이 누른 발행은 무인 레인이 아니다')
  if (f.queueStatus !== 'PENDING') {
    blockers.push(`Queue 상태가 ${f.queueStatus} 다 — 무인 레인은 PENDING 만 발행한다`)
  }

  // ① 60분 창
  if (f.postPublishedAtMs === null || !Number.isFinite(f.postPublishedAtMs)) {
    blockers.push('글의 공개 시각을 읽지 못했다(fail-closed)')
  } else if (f.postPublishedAtMs > f.nowMs) {
    blockers.push('아직 공개되지 않은 글이다(공개 시각이 미래다)')
  } else if (f.nowMs - f.postPublishedAtMs > AUTO_FIRST_COMMENT_WINDOW_MS) {
    blockers.push(
      `공개된 지 ${Math.floor((f.nowMs - f.postPublishedAtMs) / 60_000)}분 — `
      + `첫 댓글 시한 ${AUTO_FIRST_COMMENT_WINDOW_MINUTES}분을 넘겼다`,
    )
  }

  // ② 글당 1건
  if (!isCount(f.personaCommentsOnPost)) {
    blockers.push('그 글의 Persona 댓글 수를 읽지 못했다(fail-closed)')
  } else if (f.personaCommentsOnPost >= AUTO_PERSONA_COMMENTS_PER_POST_MAX) {
    blockers.push(
      `그 글에 Persona 댓글이 이미 ${f.personaCommentsOnPost}건이다 — `
      + `${AUTO_LANE_STAGE} 는 글당 ${AUTO_PERSONA_COMMENTS_PER_POST_MAX}건이다`,
    )
  }

  // ③ 자기 글
  if (f.postAuthorPersonaId === undefined) {
    blockers.push('글 작성 Persona 를 읽지 못했다(fail-closed)')
  } else if (f.postAuthorPersonaId !== null && f.postAuthorPersonaId === f.candidatePersonaId) {
    blockers.push('🔴 글을 쓴 Persona 가 자기 글에 댓글을 달려 한다')
  }

  // 실사용자 대화 — 트랜잭션 재검사도 보지만, 이 레인의 계약으로도 못박는다
  if (!isCount(f.memberCommentsOnPost)) {
    blockers.push('실사용자 댓글 수를 읽지 못했다(fail-closed)')
  } else if (f.memberCommentsOnPost >= MEMBER_COMMENT_LIMIT_ON_PUBLISH) {
    blockers.push(`실사용자 댓글이 ${f.memberCommentsOnPost}건이다 — 끼어들지 않는다`)
  }
  return { ok: blockers.length === 0, blockers }
}

// ─────────────────────────────────────────────────────────
// 🔴 생성 전에 고르는 규칙 — 트랜잭션 규칙과 **같은 축**을 먼저 본다
// ─────────────────────────────────────────────────────────

export type AutoLanePostFacts = {
  id: string
  publishedAtMs: number | null
  /** 살아 있는 Persona 댓글 수 */
  personaComments: number
  /** 이 글을 대상으로 열려 있는 Queue 가 있는가 */
  hasOpenQueue: boolean
}

/**
 * 🔴 **유료 호출 전에** 창 밖 · 이미 댓글이 있는 글 · 열린 후보가 있는 글을 뺀다.
 *    트랜잭션이 어차피 막을 글에 돈을 쓰지 않기 위해서다 — 막는 권한은 여전히 트랜잭션에 있다.
 */
export function isAutoLaneCandidatePost(p: AutoLanePostFacts, nowMs: number): boolean {
  if (p.publishedAtMs === null || !Number.isFinite(p.publishedAtMs)) return false
  if (p.publishedAtMs > nowMs) return false
  if (nowMs - p.publishedAtMs > AUTO_FIRST_COMMENT_WINDOW_MS) return false
  if (p.personaComments >= AUTO_PERSONA_COMMENTS_PER_POST_MAX) return false
  return !p.hasOpenQueue
}

/**
 * 🔴 **글마다 첫 대상 하나만 남긴다.** planner 는 라운드로빈으로 한 글에 둘째 자리를
 *    채울 수 있다(글당 5건 계약). 이 레인은 글당 1건이므로 둘째부터는 만들지도 부르지도 않는다.
 */
export function firstPerPost<T>(items: readonly T[], postIdOf: (t: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const t of items) {
    const id = postIdOf(t)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(t)
  }
  return out
}

// ─────────────────────────────────────────────────────────
// 🔴 비용 — 댓글 전용 장부 · 하루 상한
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **댓글 루프 예산 env.** 공급(`SORAN_LLM_*`) · 감사(`SORAN_AUDIT_LLM_*`)와 이름을 나눈다 —
 *    같은 값을 읽으면 한 레인의 지출이 다른 레인의 여력을 먹는다(감사 전용 장부와 같은 결정).
 */
export const COMMENT_LOOP_BUDGET_ENV = {
  dailyUsd: 'SORAN_PERSONA_COMMENT_DAILY_BUDGET_USD',
  runRequestCap: 'SORAN_PERSONA_COMMENT_RUN_REQUEST_CAP',
  headroomMultiplier: 'SORAN_PERSONA_COMMENT_RESERVE_HEADROOM',
} as const

/**
 * 🔴 **하루 절대 상한(USD).** env 가 이보다 크면 이 값으로 내린다 — 올릴 수 없다.
 *    마스터 정책(2026-09-28): 댓글 루프 하루 ≤ $0.20.
 */
export const COMMENT_LOOP_DAILY_USD_MAX = 0.2
/** env 가 없을 때의 기본값 — 🔴 상한과 같다(기본값이 상한을 넘지 않는다) */
export const COMMENT_LOOP_DAILY_USD_DEFAULT = COMMENT_LOOP_DAILY_USD_MAX
/** 한 회차 유료 요청 상한 기본값 — 20회/day 슬롯 × 이 값이 하루 요청의 천장이다 */
export const COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT = 6
/** 예약 여유 배수 기본값 — 공급·감사 운영값과 같다 */
export const COMMENT_LOOP_HEADROOM_DEFAULT = 1.5

export type CommentLoopLimits = {
  limits: BudgetLimits
  /** 사람이 읽는 한 줄씩 — 기본값을 썼는지 · 내렸는지 · 못 읽었는지 */
  notes: string[]
}

/**
 * 🔴 **env 가 없으면 기본값, 있는데 못 읽으면 null(보류), 상한을 넘으면 상한으로 내린다.**
 *
 *    "없음" 과 "잘못 씀" 을 같이 기본값으로 읽지 않는다 — `0.2O` 같은 오타가 조용히
 *    기본값이 되면, 사람이 낮춰 두었다고 믿는 값이 실제로는 적용되지 않는다.
 */
export function commentLoopLimitsFromEnv(env: Readonly<Record<string, string | undefined>>): CommentLoopLimits {
  const notes: string[] = []
  const read = (name: string, dflt: number, opts: { integer?: boolean; min?: number } = {}): number | null => {
    const raw = (env[name] ?? '').trim()
    if (raw === '') { notes.push(`${name} 미설정 — 기본값 ${dflt}`); return dflt }
    const n = Number(raw)
    const min = opts.min ?? 0
    if (!Number.isFinite(n) || n <= min || (opts.integer === true && !Number.isInteger(n))) {
      notes.push(`🔴 ${name}=${raw} 를 읽지 못했다 — 유료 요청 보류(fail-closed)`)
      return null
    }
    return n
  }
  let daily = read(COMMENT_LOOP_BUDGET_ENV.dailyUsd, COMMENT_LOOP_DAILY_USD_DEFAULT)
  if (daily !== null && daily > COMMENT_LOOP_DAILY_USD_MAX) {
    notes.push(`🔴 ${COMMENT_LOOP_BUDGET_ENV.dailyUsd}=${daily} 는 상한 $${COMMENT_LOOP_DAILY_USD_MAX} 를 넘는다 — 상한으로 내린다`)
    daily = COMMENT_LOOP_DAILY_USD_MAX
  }
  const runCap = read(COMMENT_LOOP_BUDGET_ENV.runRequestCap, COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT, { integer: true })
  // 🔴 여유 배수는 1 이상이어야 예약이 추정 오차를 덮는다(`reserveOf` 계약)
  const headroom = read(COMMENT_LOOP_BUDGET_ENV.headroomMultiplier, COMMENT_LOOP_HEADROOM_DEFAULT, { min: 0.999_999 })
  return { limits: { dailyUsd: daily, runRequestCap: runCap, headroomMultiplier: headroom }, notes }
}
