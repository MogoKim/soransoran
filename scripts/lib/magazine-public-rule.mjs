/**
 * 매거진 공개 판정 규칙 — **본문은 여기 한 곳이다** (S2 P1-C · 2026-11-10).
 *
 * 왜 따로 있나
 *   vNext compiler(`magazine-content-plan.mjs`)는 순수해야 한다(같은 입력 = 같은 planHash · merge gate 재컴파일).
 *   앞판은 compiler 가 `magazine-gate.mjs` 를 import 했고, gate 는 node:fs · node:path · process.cwd() · 기본값 Date.now() 를
 *   함께 끌고 왔다. 그래서 규칙 본문을 import 0 모듈로 옮기고, gate 는 같은 이름을 다시 내보내며 위임만 한다.
 *
 * 내보내는 것
 *   KST_PUBLISH_TIME · resolvePublishAt  gate 앞판 본문 그대로(gate 가 같은 객체를 다시 내보낸다)
 *   isHeldStatus(article)                 DRAFT · BLOCKED — 시각과 무관하게 공개도 예약도 아닌 행
 *   publicAtRule(article, now)            legacy 판정 본문. 시각 검증을 하지 않는다 — gate.isPublic 의 앞판 의미
 *                                         (NaN · 비교 강제 변환)를 그대로 지킨다
 *   isPublicAt(article, nowMs)            vNext 판정. nowMs 는 **필수 · 유한한 수** — 아니면 던진다(벽시계로 넘어가지 않는다)
 *   strictOffsetTimeMs(text)              오프셋이 있는 ISO 시각 → ms. 달력에 없는 날(2/30 · 평년 2/29) · 24:00 · 범위 밖 값은 NaN
 *                                         (Date.parse 는 2026-02-30 을 3/2 로 조용히 넘긴다 — S2 P1-2)
 *   strictPublishAtMs(article)            publishAt(있으면) · 아니면 publishedAt(날짜만) + KST 10:30 — 둘 다 같은 엄격 규칙. 아니면 NaN
 *
 * 🔴 import 0 · fs · env · cwd · 벽시계 · 네트워크 0. 경계 검사 R17(전이 폐포)이 본다.
 * 🔴 `src/lib/magazine.ts` 와의 동기화 검사(assertGateInSync)는 gate 에 남는다 — 그 검사는 파일을 읽기 때문이다.
 */

/** KST 기본 공개 시각 — magazine.ts 의 KST_PUBLISH_TIME 과 같아야 한다 */
export const KST_PUBLISH_TIME = 'T10:30:00+09:00'

/** publishAt 이 없으면 publishedAt 을 KST 10:30 으로 본다 */
export function resolvePublishAt(article) {
  return new Date(article.publishAt ?? `${article.publishedAt}${KST_PUBLISH_TIME}`).getTime()
}

const OFFSET_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]

/**
 * 엄격 시각 판독 — 형식 · 달력 · 시분초 · 오프셋 범위를 먼저 확인하고 Date.UTC 로 계산한다(정규화 0 · 환경 시간대 0 · 벽시계 0).
 * @returns {number} ms 또는 NaN
 */
export function strictOffsetTimeMs(text) {
  if (typeof text !== 'string') return NaN
  const m = OFFSET_TIME_RE.exec(text)
  if (!m) return NaN
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number)
  const s = m[6] === undefined ? 0 : Number(m[6])
  const ms = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'))
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || s > 59) return NaN
  let off = 0
  if (m[8] !== undefined) {
    const oh = Number(m[9]), om = Number(m[10])
    if (oh > 14 || om > 59) return NaN
    if (oh === 14 && om !== 0) return NaN // ISO 8601 오프셋 최대 ±14:00 — +14:01 · -14:59 는 범위 밖
    off = (m[8] === '+' ? 1 : -1) * (oh * 60 + om)
  }
  return Date.UTC(y, mo - 1, d, h, mi, s, ms) - off * 60000
}

/** 공개 시각 — publishAt 이 있으면 그것만, 없으면 publishedAt(날짜만) + KST 10:30. 둘 다 strictOffsetTimeMs 규칙 하나 */
export function strictPublishAtMs(article) {
  if (article?.publishAt !== undefined && article?.publishAt !== null) return strictOffsetTimeMs(article.publishAt)
  const day = article?.publishedAt
  if (typeof day !== 'string' || !DATE_ONLY_RE.test(day)) return NaN
  return strictOffsetTimeMs(`${day}${KST_PUBLISH_TIME}`)
}

/** 공개도 예약도 아닌 행 — DRAFT · BLOCKED. qaStatus · riskLevel 은 런타임 판정에 쓰지 않는다 */
export function isHeldStatus(article) {
  return article.status === 'DRAFT' || article.status === 'BLOCKED'
}

/** legacy 판정 본문 — 시각 인자를 검증하지 않는다(gate.isPublic 의 앞판 의미 보존) */
export function publicAtRule(article, now) {
  if (isHeldStatus(article)) return false
  return resolvePublishAt(article) <= now
}

/** vNext 판정 — nowMs 필수 · 유한한 수. 호출자가 시각을 준다 */
export function isPublicAt(article, nowMs) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new TypeError(`isPublicAt: nowMs 는 유한한 수여야 한다 (${typeof nowMs} ${String(nowMs)})`)
  return publicAtRule(article, nowMs)
}
