/**
 * 댓글 운영 **단계 정본** — 🔴 순수 함수. env 문자열만 본다
 *
 * 🔴 **왜 단계를 나누는가** (2026-09-11).
 *
 *    옛 축은 `inspect / shadow / release` 셋이었고, 그 축은 **"공개 write 를 하는가"**
 *    하나만 물었다. 그래서 "후보를 만들어도 되는가" 와 "사람 승인 없이 공개해도 되는가" 가
 *    같은 칸에 들어갔다. 결과는 이랬다 —
 *
 *    · 초기에는 실회원 댓글이 0 이라 ratio 상한이 0 이고,
 *    · 상한이 0 이니 `release` 로 올려도 공개가 0 이고,
 *    · 사람이 승인한 후보 1건조차 나가지 못했다(실측 `cmtw53fzz…` APPROVED · 공개 0).
 *
 *    "사람이 하나하나 승인해서 내보내는 단계" 는 안전한 단계인데도 갈 곳이 없었다.
 *    그래서 축을 **생성 / 공개 / 자동 여부**로 갈라 네 단계로 다시 세운다.
 *
 * 🔴 **모르는 값은 shadow 다.** 오타 하나로 자동 공개가 켜지지 않게 한다.
 */

export const COMMENT_STAGES = [
  'shadow', 'bootstrap-review', 'bootstrap-auto', 'organic',
] as const
export type CommentStage = (typeof COMMENT_STAGES)[number]

export const COMMENT_STAGE_ENV = 'SORAN_PERSONA_COMMENT_STAGE'

/**
 * 🔴 **옛 문자열을 버리지 않고 옮긴다.**
 *
 *    · `inspect` — 계산만 하던 자리. 공개 write 0 이었으므로 `shadow` 로 접는다
 *    · `shadow`  — 그대로
 *    · `release` — 30% ratio 로 공개하던 자리다. 그 자리가 지금의 `organic` 이다 —
 *      **감속 정책을 조용히 벗기지 않는다.**
 *
 *    옛 값을 `bootstrap-*` 으로 옮기지 않는 것이 중요하다. 옮기면 어제까지
 *    `release` 였던 환경이 오늘 사람 승인 없이 자동 공개로 바뀐다.
 */
const LEGACY: Readonly<Record<string, CommentStage>> = Object.freeze({
  inspect: 'shadow',
  release: 'organic',
})

export type StageRead = {
  stage: CommentStage
  /** 옛 문자열을 옮겨 왔는가 */
  legacy: boolean
  reason: string
}

export function readCommentStage(env: Readonly<Record<string, string | undefined>>): StageRead {
  const raw = (env[COMMENT_STAGE_ENV] ?? '').trim()
  if (raw === '') {
    return { stage: 'shadow', legacy: false, reason: `${COMMENT_STAGE_ENV} 가 없다 — shadow(공개 write 0)` }
  }
  if ((COMMENT_STAGES as readonly string[]).includes(raw)) {
    return { stage: raw as CommentStage, legacy: false, reason: `${COMMENT_STAGE_ENV}=${raw}` }
  }
  const moved = LEGACY[raw]
  if (moved !== undefined) {
    return {
      stage: moved, legacy: true,
      reason: `${COMMENT_STAGE_ENV}=${raw} 는 옛 이름이다 — ${moved} 로 읽는다(호환)`,
    }
  }
  return {
    stage: 'shadow', legacy: false,
    reason: `${COMMENT_STAGE_ENV}=${raw} 는 모르는 값이다 — shadow 로 내린다(fail-closed)`,
  }
}

/** 단계가 무엇을 허용하는가 — 🔴 이 표가 정본이다 */
export type StagePowers = {
  /** provider 를 불러 후보를 만들어도 되는가 */
  generateCandidates: boolean
  /** 공개 write 경로가 열려 있는가 */
  publishAllowed: boolean
  /** 🔴 사람이 승인한 후보만 공개할 수 있는가 */
  humanApprovalRequired: boolean
  /** 예산을 어디서 받는가 */
  budget: 'none' | 'bootstrap' | 'organic'
  detail: string
}

const POWERS: Readonly<Record<CommentStage, StagePowers>> = Object.freeze({
  shadow: {
    generateCandidates: false, publishAllowed: false, humanApprovalRequired: true,
    budget: 'none',
    detail: 'provider 0 · Queue write 0 · 공개 write 0',
  },
  'bootstrap-review': {
    generateCandidates: true, publishAllowed: true, humanApprovalRequired: true,
    budget: 'bootstrap',
    detail: '후보 자동 생성 · 🔴 사람이 승인한 것만 공개 · 실회원 댓글 수와 무관',
  },
  'bootstrap-auto': {
    generateCandidates: true, publishAllowed: true, humanApprovalRequired: false,
    budget: 'bootstrap',
    detail: '🔴 창업자가 명시로 올린 단계에서만 — 관리형 글 댓글을 자동 생성·공개',
  },
  organic: {
    generateCandidates: true, publishAllowed: true, humanApprovalRequired: false,
    budget: 'organic',
    detail: '실사용자 활동이 충분해진 뒤 — Persona 비율 감속(30%)을 적용한다',
  },
})

export function stagePowers(stage: CommentStage): StagePowers {
  return POWERS[stage]
}

/**
 * 🔴 **옛 축(`RunMode`)으로 되돌려 주는 어댑터.**
 *
 *    `judgeReadiness` 는 아직 `mode` 를 받는다. 그 자리에 env 를 **다시 읽어** 넣으면
 *    `bootstrap-review` 같은 새 값이 옛 파서에게는 "모르는 값" 으로 보이고,
 *    화면에 `모르는 값이다 — shadow 로 내린다(fail-closed)` 가 같이 찍힌다.
 *    실제로는 fail-closed 가 아닌데 그렇게 보이면, 다음 사람은 그 줄을 믿는다.
 *
 *    그래서 env 를 두 번 읽지 않고 **단계에서 옛 이름을 만든다.**
 */
export function legacyRunModeFor(stage: CommentStage): 'inspect' | 'shadow' | 'release' {
  return stagePowers(stage).publishAllowed ? 'release' : 'shadow'
}
