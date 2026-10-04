/**
 * 🔴 **정치 인물 플래그 이름 — 정치 축과 연예 · 대중문화를 가른다** (2026-10-04 P0-3) — 순수 · 이름만
 *
 *    옛 판은 `politicalOrPublicFigure`(제목) · `publicFigureMention`(본문) 하나로 정치인과 연예인 · 방송인을 함께 막았다.
 *    이제 수집기(`micro-seed-quality.findPoliticalFigureHits`)는 **정치 인물만** 플래그로 남긴다 —
 *    배우 · 가수 · 방송인 · 드라마 · 예능은 공인 이름이라는 이유로 막지 않는다(명예훼손 · 사생활 · 괴롭힘은 별도 hard gate).
 *
 *    🔴 **옛 혼합 플래그는 새로 만들지 않는다.** 이 계약 이전에 수집돼 저장된 행만 갖고 있고, 그 행은 정치와 연예를 가를 근거가
 *       없으므로 **정치로 읽는다(fail-closed)**. 그 행은 원문 나이 한도(72h)로 공급 대상에서 저절로 사라진다 — 구제하지 않는다.
 */
export const POLITICAL_FIGURE_FLAG = 'politicalFigure'
export const POLITICAL_FIGURE_MENTION_FLAG = 'politicalFigureMention'
/** 📜 옛 혼합 플래그 — 저장된 행에서 읽기만 한다 */
export const LEGACY_MIXED_FIGURE_FLAG = 'politicalOrPublicFigure'
export const LEGACY_MIXED_FIGURE_MENTION_FLAG = 'publicFigureMention'

/** 제목의 정치 인물(또는 가를 수 없는 옛 혼합 플래그) */
export const isPoliticalFigureTitleFlag = (f: string): boolean =>
  f === POLITICAL_FIGURE_FLAG || f === LEGACY_MIXED_FIGURE_FLAG

/** 본문의 정치 인물(또는 가를 수 없는 옛 혼합 플래그) */
export const isPoliticalFigureBodyFlag = (f: string): boolean =>
  f === POLITICAL_FIGURE_MENTION_FLAG || f === LEGACY_MIXED_FIGURE_MENTION_FLAG

/** 📜 옛 수집 제외 사유 — 정치인과 연예인이 섞인 사유다. 저장된 행에서 읽기만 하고 정치로 읽는다 */
export const LEGACY_MIXED_EXCLUDE_REASON = 'publicFigure'

/** 정치 제외 사유(또는 가를 수 없는 옛 혼합 사유) */
export const isPoliticsExcludeReason = (r: string | null | undefined): boolean =>
  r === 'politics' || r === LEGACY_MIXED_EXCLUDE_REASON
