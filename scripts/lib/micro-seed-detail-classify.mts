/**
 * 상세 읽기 결과 판정 — 🔴 **순수 함수. 네트워크·DB·Sheet·LLM 없음**
 *
 * 🔴 **이 모듈은 발행하지 않는다.** 읽은 결과를 네 갈래(글감 · 보류 · 버림 · 못 읽음)로 나눌 뿐이다.
 * 🔴 **길이로 가르지 않는다.** 짧은 글도 긴 사연도 글감이다 — 무엇을 막을지는 판정이 본다.
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

/** 읽은 글이 가는 네 갈래 — 글감(`seedOriginality`) · 안전 보류 · 버림 · 못 읽음 */
export type DetailAxis =
  | 'seedOriginality'
  | 'hold'
  | 'drop'
  | 'access'

export const AXIS_LABEL: Record<DetailAxis, string> = {
  seedOriginality: 'Seed Originality',
  hold: 'Hold',
  drop: 'Drop',
  access: 'Access',
}

/** 본문 길이를 무엇으로 쟀는지 — 사본의 `bodyLength` 를 다시 읽을 때 쓴다. 판정에는 쓰지 않는다 */
export type LengthBasis = 'body' | 'titleBody'

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

/** 🔴 띄어쓰기를 포함해서 센다. 연속 공백만 하나로 접는다 */
export function measureLength(title: string, body: string, basis: LengthBasis): number {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
  return basis === 'titleBody' ? [...`${norm(title)} ${norm(body)}`.trim()].length : [...norm(body)].length
}

/**
 * 상세를 읽은 뒤 네 갈래로 나눈다.
 *
 *    ① Access — 못 읽었으면 그것으로 끝이다. Drop·Hold 로 뭉개지 않는다.
 *    ② 안전 — 결정적으로 버리거나 보류할 것(`safetyFilter`).
 *    ③ 나머지는 길이와 무관하게 전부 글감이다.
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
  // ② 결정적 안전 판정
  if (safety.verdict === 'hardExclude' || safety.verdict === 'drop') {
    return { ...base, axis: 'drop', reason: `안전·브랜드: ${safety.summary}` }
  }
  if (safety.verdict === 'hold') {
    return { ...base, axis: 'hold', reason: `안전·브랜드: ${safety.summary}` }
  }
  // ③ 나머지는 전부 글감이다 — 길이는 기록만 한다
  return { ...base, axis: 'seedOriginality', reason: `본문 ${measured}자` }
}
