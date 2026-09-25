/**
 * 자동 발행 레인 — 단계 판정만 한다.
 * 🔴 등급으로 가르지 않는다 (M3-A). `validationProfile` 을 정할 수 있으면 태운다.
 *
 * 🔴 이 모듈은 파일을 쓰지 않는다. 자식 프로세스도 띄우지 않는다.
 *    "지금 이 slug 가 어느 단계까지 왔고 다음에 무엇을 해야 하는가"만 계산한다.
 *    실행은 magazine-auto-register.mjs 가, 대상 선정은 -ready 가 한다.
 *
 * 🔴 등급 게이트를 여기 둔 이유 — batch-qa 만 믿으면 안 된다.
 *    batch-qa 는 topic-queue 에 없는 slug 를 만나면 ①riskLevel ②autoEligible 을
 *    **검사하지 않고** note 만 남긴 채 READY_TO_SCHEDULE 을 낼 수 있다.
 *    실제로 `--all` 을 돌리면 이미 등록돼 큐에서 빠진 HIGH 글(which-clinic-menopause)이
 *    READY 로 나온다. 자동 레인이 그 READY 를 그대로 믿으면 HIGH 가 흘러간다.
 *    그래서 이 레인은 **큐에 있을 것**을 먼저 요구하고, 등급을 직접 본다.
 *    (batch-qa 를 고치지 않는다 — 사람이 쓰는 도구의 판정 범위를 바꾸지 않기 위해서다.
 *     대신 자동 경로에서는 이 게이트를 반드시 통과해야 한다.)
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DRAFTS_DIR } from './magazine-load.mjs'
import { isAutoLaneEligible } from './magazine-validation-profile.mjs'

// 🔴 LANE_RISK 제거 (M3-A · SUPERSEDED) — 등급으로 레인을 가르지 않는다

/** 단계 순서 — 리포트와 진행 판단이 같은 이름을 쓴다 */
export const STAGES = ['gate', 'draft', 'article', 'qa', 'batch', 'hero', 'register', 'pr']

export function draftDir(slug) {
  return join(DRAFTS_DIR, slug)
}

export function paths(slug) {
  const dir = draftDir(slug)
  return {
    dir,
    brief: join(dir, 'brief.md'),
    review: join(dir, 'review.ts'),
    draftMd: join(dir, 'draft.md'),
    articleTs: join(dir, 'article-draft.ts'),
  }
}

/**
 * 자동 레인에 태워도 되는 slug 인가.
 *
 * 통과 조건 (전부 AND)
 *   ① topic-queue 에 있다        — 없으면 등급을 확인할 정본이 없다
 *   ② validationProfile 을 정할 수 있다 — 🔴 등급으로 가르지 않는다 (M3-A)
 *                                  못 정하면 멈춘다. 정해지면 태운다.
 *   ④ brief.md 와 review.ts 가 있다 — 없으면 회수도 대조도 못 한다
 */
export function gate(slug, queue) {
  const item = queue.find((q) => q.slug === slug) ?? null
  const blockedBy = []
  const block = (code, message) => blockedBy.push({ code, message })

  if (!item) {
    block('NOT_IN_QUEUE', 'topic-queue 에 없다 — 자동 레인은 큐에 있는 글만 태운다')
    return { ok: false, item: null, blockedBy }
  }
  /**
   * 🔴 **자동 레인은 등급으로 가르지 않는다** (M3-A).
   *    프로필을 정할 수 있으면 태운다. 못 나가는 이유는 QA 실패뿐이다.
   */
  const lane = isAutoLaneEligible(item)
  if (!lane.ok) {
    block(lane.code, lane.why)
  }
  // 🔴 autoEligible 은 호환 필드로만 읽는다 — 자동 진행을 막지 않는다

  const p = paths(slug)
  if (!existsSync(p.brief)) block('BRIEF_MISSING', 'brief.md 가 없다 — brief-auto 가 먼저 돌아야 한다')
  if (!existsSync(p.review)) block('REVIEW_MISSING', 'review.ts 가 없다 — 대조할 riskSentences 가 없다')

  return { ok: blockedBy.length === 0, item, blockedBy }
}

/** 지금 파일이 어디까지 있는가 */
export function progress(slug) {
  const p = paths(slug)
  return {
    hasBrief: existsSync(p.brief),
    hasReview: existsSync(p.review),
    hasDraftMd: existsSync(p.draftMd),
    hasArticleTs: existsSync(p.articleTs),
  }
}

/**
 * hero 를 만들어야 하는가.
 *   REQUIRED → 만든다 (alt 가 있어야 한다)
 *   OPTIONAL → 기본 스킵. allowOptional 을 사람이 켜야 만든다.
 */
export function heroPlan(item, { alt = null, allowOptional = false, autoLane = false } = {}) {
  const mode = item?.imageMode ?? null
  /**
   * 🔴 **자동 레인에서는 OPTIONAL 도 필수다** (2026-09-21 사고).
   *
   *    9/19~9/26 등록 글 8건이 전부 대표 이미지 없이 나갔다. 원인은 여기다 —
   *    `imageMode=OPTIONAL` 이면 `need:false` 로 **그냥 건너뛰었고**,
   *    batch-qa 와 register 는 `REQUIRED` 일 때만 hero 를 봤다.
   *    즉 OPTIONAL 인 글은 **아무도 이미지를 보지 않는 경로**로 끝까지 갔다.
   *
   *    OPTIONAL 의 원래 뜻은 "사람이 판단해서 뺄 수 있다" 였다.
   *    그런데 자동 레인에는 판단할 사람이 없다. 사람이 없는 자리에서
   *    "선택" 은 곧 "없음" 이 된다 — 실제로 8건 연속 그렇게 됐다.
   *
   * 🔴 **그래서 자동 등록 경로에서는 OPTIONAL 을 허용하지 않는다.**
   *    사람이 직접 돌리는 경로(`--allow-optional` 없이)에서는 그대로 둔다.
   */
  const required = mode === 'REQUIRED' || (autoLane && mode !== null) || (autoLane && mode === null)
  if (!required && !(mode === 'OPTIONAL' && allowOptional)) {
    return { need: false, mode, reason: mode === 'OPTIONAL' ? 'OPTIONAL — 기본 스킵' : `imageMode=${mode ?? '-'}` }
  }
  if (!alt) {
    return {
      need: true,
      mode,
      alt: null,
      blocked: { code: 'HERO_ALT_REQUIRED', message: `imageMode=${mode} 인데 alt 를 구하지 못했다 (review.ts·cluster 기본값 모두 실패)` },
    }
  }
  return { need: true, mode, alt, blocked: null, enforcedByLane: autoLane && mode !== 'REQUIRED' }
}
