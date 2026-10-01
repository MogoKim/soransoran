/**
 * 🔴 **원천 identity — 정본은 이 파일 하나다** (2026-09-30 야간 P0-B)
 *
 *   원천 하나 = **(sourceSite, sourceArticleId)** 쌍이다. 원문 id 만으로는 원천이 아니다 —
 *   82cook 과 네이버 카페는 서로 다른 번호 체계를 쓰고, 같은 숫자 id 가 두 사이트에 동시에 있다.
 *   앞판은 판정 병합 · 작업 묶음 · 생성 메타 · 캐시 · 지난 결과 · 예산 · 화자 · 이미 쓴 원천을
 *   **원문 id 하나로** 키잉했다 — 같은 id 두 원천이 한 행으로 합쳐지고, 한쪽 제목 · 시각 · 결과가
 *   다른 쪽에 붙었다(`supply-workset-check` fixture 가 id 를 바꿔 피해 가던 결함).
 *
 * 🔴 내부 열쇠는 `sourceKeyOf(site, id)` 하나다. 사이트나 id 를 모르면 열쇠가 없다(`null`) —
 *    모르는 사이트를 이유로 다른 원천과 합치지 않는다(fail-closed).
 * 🔴 이 열쇠는 **파일 · 메모리 안에서만** 쓴다. 공개 DB 에 원문 id 를 새로 싣지 않는다
 *    (`FORBIDDEN_POST_KEYS` · 증거 기록은 `sha256(site::id)` 해시만).
 * 🔴 `supply-workset` 이 이 함수들을 다시 내보낸다 — 옮겼을 뿐 두 벌이 아니다.
 */

/** 🔴 `#` 뒤 조각을 뗀 원문 id — 큐 형제 판정은 이 값으로 한다 */
export const baseIdOf = (id: string): string => id.split('#')[0] ?? id

/** 🔴 원천 키 — 사이트 + (`#` 조각을 뗀) 원문 id. 구분자는 NUL(사이트 · id 어디에도 나오지 않는다) */
export const sourceKeyOf = (site: string, articleId: string): string =>
  `${site.trim()}\u0000${baseIdOf(articleId.trim())}`

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 🔴 **행 하나의 원천 열쇠.** 사이트와 id 가 **둘 다** 있어야 한다 — 하나라도 비면 `null`.
 *    부르는 쪽은 `null` 행을 고르지도 · 합치지도 않는다.
 */
export function sourceIdentityOf(site: unknown, articleId: unknown): string | null {
  const s = S(site)
  const id = baseIdOf(S(articleId))
  return s === '' || id === '' ? null : sourceKeyOf(s, id)
}

/** 🔴 열쇠 → (사이트, id). 열쇠 모양이 아니면 `null` */
export function sourceOfKey(key: string): { site: string; id: string } | null {
  const k = key.indexOf('\u0000')
  if (k <= 0 || k === key.length - 1) return null
  return { site: key.slice(0, k), id: key.slice(k + 1) }
}
