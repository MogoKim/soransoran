/**
 * 발행 시각 · Persona 가용 — 🔴 **예측기가 아니다** (2026-09-30 · source-slot-v1 에서 축소)
 *
 * 🔴 **지운 것** — `forecastPublishing`(14일 발행 예측) · `capacityOf` · `personasNeededFor` · `judgeCapacity`
 *    · `classifyHeadBlock` · `blockRatesByCombination` · `splitBlockReasons`. 정본(Sep 30)은 14일치 완성 글
 *    재고를 준비도로 쓰지 않는다. 다음 단계를 감당하는가는 `judgeNextPreflight` 하나가 본다(원천 기회 ·
 *    처리량 · 지연 · 계약 유효 Persona · 비용 · 러너 건강). 이 파일에 남은 것은 KST 표기 · 다음 발행 예정 시각 ·
 *    Persona 주간 상한/간격 가용 — 러너 · 관제가 쓰는 순수 함수뿐이다.
 *
 * 🔴 read-only. DB 도 파일도 건드리지 않는다.
 */

import { MIN_DAYS_BETWEEN_POSTS, POST_CAP_PER_WEEK, type BatchCaps } from './original-post-persona-match'
// 🔴 다음 슬롯 계산은 **정본 하나**다 — 여기서 시각을 다시 계산하지 않는다
import { nextSlotAnchor, type ScaleProfile } from './scale-profile'

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** `YYYY-MM-DD` (KST) — 🔴 UTC 날짜를 KST 처럼 보여주지 않는다 */
export function kstDateLabel(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** `MM-DD HH:mm KST` */
export function kstStamp(d: Date): string {
  return `${new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(5, 16).replace('T', ' ')} KST`
}

/**
 * 다음 발행 예약 시각 — 🔴 **`nextSlotAnchor` 에 위임한다. 여기서 계산하지 않는다.**
 *
 * 🔴 **왜 위임인가** (2026-09-12). 옛 판은 `PUBLISH_HOUR_KST=0 · PUBLISH_MINUTE_KST=5` 로
 *    "다음 발행은 00:05" 를 **여기서 다시 계산**했다. 발행 슬롯을 댓글 운영 창 안으로
 *    옮긴 뒤에도 이 함수는 00:05 를 가리켰다 — 관제와 예측이 러너와 **다른 시각**을
 *    말하게 된 것이다. d3 에서 09:30 에 내고 나면 다음은 13:30 인데 "내일 00:05" 라고 했다.
 *
 *    시각의 정본은 `PROFILES[stage].slots` 하나이고, 그것을 읽는 함수도 하나여야 한다.
 *
 * 🔴 **오늘 이미 상한을 채웠으면 내일이다.** (`nextSlotAnchor` 가 그 판정을 한다)
 *    2026-09-07 에 이미 1/1 을 채웠는데 그날 발행을 한 번 더 세면
 *    예측이 하루씩 앞당겨져 공백이 가려진다.
 */
export function nextScheduleAt(input: {
  now: Date
  publishedToday: number
  /** 🔴 지금 **실제로 적용된** release profile — 상한도 슬롯도 여기서 나온다 */
  profile: ScaleProfile
}): Date {
  return nextSlotAnchor(input.profile, { now: input.now, publishedToday: input.publishedToday })
}

/** persona 한 명의 발행 이력 — 🔴 `matchedAt` 이 정본이다 */
export type PersonaHistory = {
  code: string
  /** 과거 배정 시각들 (UTC Date) */
  matchedAts: Date[]
}

/**
 * 그 시점에 이 persona 가 쓸 수 있는가 — 🔴 **실제 게이트와 같은 두 조건**이다.
 *
 * · 주간 상한: `matchedAt >= at - 7일` 인 건수 < `POST_CAP_PER_WEEK`
 *   🔴 rolling 7일이다. 달력 주가 아니다. 경계는 **포함**(`>=`)이며 러너 쿼리와 같다
 * · 최소 간격: 마지막 배정에서 `MIN_DAYS_BETWEEN_POSTS` 일 경과
 */
export function personaAvailableAt(h: PersonaHistory, at: Date, caps: BatchCaps = {}): boolean {
  // 🔴 상한은 **주입값이 먼저**다. 넘기지 않으면 가장 안전한 상수로 떨어진다
  const weekCap = caps.postsPerWeek ?? POST_CAP_PER_WEEK
  const minGap = caps.minDaysBetween ?? MIN_DAYS_BETWEEN_POSTS
  const weekAgo = new Date(at.getTime() - 7 * DAY_MS)
  const inWeek = h.matchedAts.filter((d) => d.getTime() >= weekAgo.getTime() && d.getTime() <= at.getTime()).length
  if (inWeek >= weekCap) return false
  const last = h.matchedAts.length === 0 ? null
    : h.matchedAts.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
  if (last === null) return true
  return at.getTime() - last.getTime() >= minGap * DAY_MS
}

/** 그 시점에 쓸 수 있는 persona 코드들 */
export function availablePersonasAt(hist: readonly PersonaHistory[], at: Date, caps: BatchCaps = {}): string[] {
  return hist.filter((h) => personaAvailableAt(h, at, caps)).map((h) => h.code).sort()
}
