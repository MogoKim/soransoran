/**
 * 상세 읽기 결과 판정 — 🔴 **순수 함수. 네트워크·DB·Sheet·LLM 없음**
 *
 * 정본: §4-U(6축) · §4-V(실측) · §4-W(자동 fetch 기준) · §4-Y(100자)
 *
 * 🔴 **이 모듈은 발행하지 않는다.** 읽은 결과를 6축으로 나눌 뿐이다.
 *    수집(브라우저)은 `micro-seed-detail-fetch.mts` 가 하고, 여기는 판정만 한다 —
 *    그래야 fixture 가 **네트워크 없이** 판정을 검증할 수 있다.
 */
import { safetyFilter, type SafetyResult } from './micro-seed-safety-filter.mjs'
import { topicHits } from './micro-seed-scout-score.mjs'

/** 🔴 상세 접근 결과. **HTTP 200 만으로 성공을 판정하지 않는다** (§4-W ⑥) */
export type AccessStatus =
  | 'ok'
  | 'deletedOrExpired'
  | 'permissionDenied'
  | 'renderFailed'
  | 'selectorFailed'

/** §4-U ⑥ 6축 */
export type DetailAxis =
  | 'shortRawNoindex'
  | 'seedOriginality'
  | 'rawOriginality'
  | 'hold'
  | 'drop'
  | 'access'

export const AXIS_LABEL: Record<DetailAxis, string> = {
  shortRawNoindex: 'Short Raw Noindex',
  seedOriginality: 'Seed Originality',
  rawOriginality: 'Raw Originality',
  hold: 'Hold',
  drop: 'Drop',
  access: 'Access',
}

/**
 * 🔴 **100자 기준은 아직 확정되지 않았다** (§4-Y ④).
 *    본문만 볼지 제목+본문을 볼지 결정 전이라, **어느 쪽으로 쟀는지 기록**한다.
 *    기본값은 `body` 다 — 원문 인용 범위와 일치하기 때문이다.
 */
export type LengthBasis = 'body' | 'titleBody'
export const SHORT_RAW_MAX = 100

/** 🔵 Raw 힌트: 본문 400자 이상 + 사연 축 (§4-V ①·③ 실측 419·491·697자) */
export const RAW_MIN_BODY = 400

/** 🔴 접근 신호. 브라우저가 관측한 사실만 담는다 — 판정은 여기서 한다 */
export type AccessSignals = {
  httpStatus?: number
  /** 문서 title 이 게시글 제목이 아니라 **카페 홈으로 폴백**했는가 (§4-T ④) */
  titleFallback?: boolean
  /** 삭제 alert 문구를 잡았는가 */
  dialogMessage?: string | null
  /** ca-fe article 프레임에 도달했는가 */
  articleFrame?: boolean
  /** 본문 컨테이너를 찾았는가 */
  bodyFound?: boolean
  /** 권한 안내 문구를 봤는가 */
  permissionNotice?: boolean
  /** 예외 메시지 */
  errorMessage?: string | null
}

/**
 * 🔴 **읽지 못한 것은 판정이 아니다.** 왜 못 읽었는지까지 남긴다 (§4-S ⑤).
 *    HTTP 200 만으로 성공을 판정하지 않는 원칙은 그대로다 (§4-W ⑥).
 *
 * 🔴 **그러나 titleFallback 하나로 삭제를 단정하지 않는다** (2026-09-05 실측 정정).
 *    네이버 카페는 SPA 라 `goto` 직후 `document.title` 이 아직 **카페 홈 제목**이다.
 *    그 순간을 읽으면 멀쩡한 글이 전부 삭제로 잡힌다 —
 *    live 1회차에서 **본문을 읽고도 10/10 이 deletedOrExpired** 가 됐다(8건이 오판).
 *
 *    🟢 본문을 읽었거나 ca-fe 프레임에 도달했다면 **그 글은 존재한다.**
 *       존재의 증거가 제목 문자열 비교보다 강하다.
 */
export function classifyAccess(s: AccessSignals): AccessStatus {
  // ① dialog 는 네이버가 직접 말해준 것이다 — 가장 강한 신호
  if (s.dialogMessage && /삭제|존재하지 않는/.test(s.dialogMessage)) return 'deletedOrExpired'
  if (s.permissionNotice === true) return 'permissionDenied'

  // ② 🟢 **존재의 증거가 먼저다.** 본문을 읽었으면 title 이 뭐든 그 글은 있다
  if (s.bodyFound === true) return 'ok'

  // ③ 프레임에 도달했는데 본문이 없다 — 삭제가 아니라 셀렉터 문제로 본다
  if (s.articleFrame === true) return 'selectorFailed'

  // ④ 프레임에 못 갔다. 이때만 title 폴백을 삭제 신호로 쓴다
  if (s.titleFallback === true) return 'deletedOrExpired'
  return 'renderFailed'
}

export type DetailInput = {
  title: string
  body: string
  comments: readonly string[]
  imageCount: number
  boardName?: string
  qualityFlags?: readonly string[]
  access: AccessStatus
  lengthBasis?: LengthBasis
}

export type DetailVerdict = {
  axis: DetailAxis
  reason: string
  /** 재현용 — 어떤 길이 기준으로 쟀는지 남긴다 */
  lengthBasis: LengthBasis
  measuredLength: number
  safety: SafetyResult
  assetAxes: string[]
}

/** 🔴 사연 축 — §4-X·§4-V 와 같은 목록을 쓴다 */
const ASSET_TOPICS: readonly string[] = ['가족', '자녀·교육', '돈·노후', '몸·건강', '관계·마음', '일']

/** 🔴 띄어쓰기를 포함해서 센다 (§4-Y ④). 연속 공백만 하나로 접는다 */
export function measureLength(title: string, body: string, basis: LengthBasis): number {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
  return basis === 'titleBody' ? [...`${norm(title)} ${norm(body)}`.trim()].length : [...norm(body)].length
}

/**
 * 상세를 읽은 뒤 6축으로 나눈다.
 *
 * 🔴 순서가 중요하다.
 *    ① Access — 못 읽었으면 그것으로 끝이다. Drop·Hold 로 뭉개지 않는다.
 *    ② 안전·브랜드 — 위험은 길이보다 먼저다. 짧다고 통과시키지 않는다 (§4-Y ⑤).
 *    ③ 길이 — 100자 미만이면 Short Raw Noindex **후보**다. 확정이 아니다.
 *    ④ 사연 — 400자 이상 + 사연 축이면 Raw Originality.
 *    ⑤ 나머지는 Seed Originality.
 */
export function classifyDetail(input: DetailInput): DetailVerdict {
  const basis: LengthBasis = input.lengthBasis ?? 'body'
  const measured = measureLength(input.title, input.body, basis)
  const assetAxes = topicHits(input.title, input.boardName ?? '')
    .map((h) => h.label)
    .filter((l) => ASSET_TOPICS.includes(l))

  const safety = safetyFilter({
    title: input.title,
    body: input.body,
    comments: input.comments,
    qualityFlags: input.qualityFlags ?? [],
    imageCount: input.imageCount,
    accessStatus: input.access === 'ok' ? 'ok' : 'unknown',
  })
  const base = { lengthBasis: basis, measuredLength: measured, safety, assetAxes }

  // ① 🔴 못 읽은 것은 판정이 아니다
  if (input.access !== 'ok') {
    return { ...base, axis: 'access', reason: `읽지 못함(${input.access})` }
  }
  // ② 🔴 위험은 길이보다 먼저다
  if (safety.verdict === 'hardExclude' || safety.verdict === 'drop') {
    return { ...base, axis: 'drop', reason: `안전·브랜드: ${safety.summary}` }
  }
  if (safety.verdict === 'hold') {
    return { ...base, axis: 'hold', reason: `안전·브랜드: ${safety.summary}` }
  }
  // ③ 🟡 100자 미만 — **후보**다. 발행은 사람이 승인한다 (§4-Y ②)
  if (measured > 0 && measured < SHORT_RAW_MAX) {
    return {
      ...base,
      axis: 'shortRawNoindex',
      reason: `본문 ${measured}자(${basis}) — 100자 미만 · 🔴 발행 전 사람 확인 필요`,
    }
  }
  // ④ 🔵 긴 사연
  if (measured >= RAW_MIN_BODY && assetAxes.length > 0) {
    return { ...base, axis: 'rawOriginality', reason: `본문 ${measured}자 · 사연 축(${assetAxes.join('/')})` }
  }
  // ⑤ 🟢 나머지
  return {
    ...base,
    axis: 'seedOriginality',
    reason: measured >= RAW_MIN_BODY
      ? `본문 ${measured}자지만 사연 축이 없다 — 소재로 쓴다`
      : `본문 ${measured}자 — 우리 말투로 확장한다`,
  }
}
