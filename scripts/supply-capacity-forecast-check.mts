/**
 * 발행 시각 · Persona 가용 fixture (§4-AW ③-b · 2026-09-30 축소)
 *
 * 🔴 14일 발행 예측(`forecastPublishing`) · capacity · 필요 persona 절은 지웠다 — 함수가 지워졌다(source-slot-v1).
 *    남은 것: KST 경계 · 다음 예약 시각 · 관제 경고 유예 · rolling 7일/최소 간격.
 *
 * 🔴 네트워크 0 · LLM 0 · DB 0 · 파일 write 0.
 */

import { readFileSync } from 'node:fs'

import * as forecastLib from '../src/lib/supply-capacity-forecast'
import {
  availablePersonasAt, kstDateLabel, kstStamp, nextScheduleAt,
  personaAvailableAt, type PersonaHistory,
} from '../src/lib/supply-capacity-forecast'
import { MIN_DAYS_BETWEEN_POSTS, POST_CAP_PER_WEEK } from '../src/lib/original-post-persona-match'
// 🔴 슬롯 시각은 여기 적지 않는다 — PROFILES 가 정본이고 이 파일은 파생만 한다
import { PROFILES, minuteOfDay, slotLabel, type ReleaseStage } from '../src/lib/scale-profile'
import { judgePublish, PUBLISH_GRACE_MS } from '../src/lib/supply-health'
import { DAILY_PUBLISH_CAP, kstDayStart } from '../src/lib/original-post-publish'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

const DAY = 86_400_000
/** 🔴 KST 2026-09-07 21:00 = UTC 12:00 */
const NOW = new Date('2026-09-07T12:00:00.000Z')
const utc = (iso: string): Date => new Date(iso)

console.log('\n══ 발행 시각 · Persona 가용 fixture ══\n')

// ── ① KST 경계 ──
check('🔴 KST 하루 시작은 **정본** kstDayStart 를 쓴다 — 복제하지 않는다', (() => {
  const d = kstDayStart(NOW)
  return d.toISOString() === '2026-09-06T15:00:00.000Z'
})())
check('🔴 forecast lib 이 자체 KST 자정 계산을 두지 않는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  // 🔴 (2026-09-30) 예측기를 지운 뒤 lib 은 자정을 아예 계산하지 않는다 — 다시 생기면 정본을 import 해야 한다
  return !/function kstDayStart/.test(lib) && (!/kstDayStart/.test(lib) || /import \{ kstDayStart \}/.test(lib))
})())
check('🔴 하루 상한 중복 상수를 두지 않는다 — DAILY_PUBLISH_CAP 정본을 주입받는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  return !/DAILY_CAP_FOR_FORECAST/.test(lib) && DAILY_PUBLISH_CAP === 1
})())
check('🔴 UTC 날짜를 KST 처럼 보여주지 않는다 — 09-06T15:00Z 는 KST 09-07 이다',
  kstDateLabel(utc('2026-09-06T15:00:00.000Z')) === '2026-09-07')
check('🔴 UTC 자정 직전은 KST 로 이미 다음 날이다',
  kstDateLabel(utc('2026-09-07T23:00:00.000Z')) === '2026-09-08')
check('🔴 표시에 KST 가 드러난다', kstStamp(NOW).endsWith('KST'))
check('🔴 matchedAt UTC 13:38 은 KST 22:38 이다',
  kstStamp(utc('2026-09-02T13:38:00.000Z')).startsWith('09-02 22:38'))

/**
 * ── ② 다음 예약 — 🔴 **시각은 `PROFILES` 가 정본이다** ──
 *
 * 🔴 옛 판은 `PUBLISH_HOUR_KST=0 · PUBLISH_MINUTE_KST=5` 로 "다음 발행은 00:05" 를
 *    여기서 다시 계산했다. 발행 슬롯을 댓글 운영 창 안으로 옮긴 뒤에도 관제·예측은
 *    00:05 를 가리켜, d3 에서 09:30 에 내고 나면 다음이 13:30 인데 "내일 00:05" 라고 했다.
 *    이제 `nextSlotAnchor` 에 위임한다 — 시험도 시각을 적지 않고 profile 에서 파생시킨다.
 */
/** KST `HH:MM` 로 그 날짜의 UTC Date */
const kstAt = (day: string, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`)
}
const slotsOf = (st: ReleaseStage): string[] =>
  [...PROFILES[st].slots].sort((a, b) => minuteOfDay(a) - minuteOfDay(b)).map(slotLabel)

/** 🔴 **주석이 아니라 코드를 본다** — 이 저장소는 옛 결함을 원문으로 적어 둔다 */
const codeOf = (f: string): string => readFileSync(f, 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')

check('🔴 00:05 고정 상수가 코드에서 사라졌다', (() => {
  const src = codeOf('src/lib/supply-capacity-forecast.ts')
  return !/PUBLISH_HOUR_KST/.test(src) && !/PUBLISH_MINUTE_KST/.test(src)
})())
check('🔴 nextScheduleAt 이 nextSlotAnchor 에 위임한다',
  /return nextSlotAnchor\(input\.profile/.test(codeOf('src/lib/supply-capacity-forecast.ts')))
check('🔴 관제가 첫 슬롯을 profile 에서 읽는다 — dayStart + 5분이 아니다', (() => {
  const src = codeOf('scripts/supply-health.mts')
  return /releaseProfile\.slots/.test(src) && !/dayStart\.getTime\(\) \+ 5 \* 60_000/.test(src)
})())

// ⑤ d3 첫 발행 뒤 오전 → 다음 예약은 그날 두 번째 슬롯
check('🔴 d3 · 첫 발행 뒤 오전 → 오늘 두 번째 슬롯', (() => {
  const [first, second] = slotsOf('d3') as [string, string]
  const at = nextScheduleAt({
    now: new Date(kstAt('2026-09-07', first).getTime() + 30 * 60_000),
    publishedToday: 1, profile: PROFILES.d3,
  })
  return kstDateLabel(at) === '2026-09-07' && kstStamp(at).includes(second)
})())
// ⑥ d3 오늘 상한 완료 → 내일 첫 슬롯
check('🔴 d3 · 오늘 3건 완료 → 내일 첫 슬롯', (() => {
  const first = slotsOf('d3')[0]!
  const at = nextScheduleAt({
    now: kstAt('2026-09-07', '20:00'), publishedToday: 3, profile: PROFILES.d3,
  })
  return kstDateLabel(at) === '2026-09-08' && kstStamp(at).includes(first)
})())
// ⑦ d5 · d10 도 자기 profile 슬롯에서 고른다
for (const st of ['d1', 'd5', 'd10'] as const) {
  check(`🔴 ${st} · 다음 예약이 자기 profile 슬롯이다`, (() => {
    const at = nextScheduleAt({
      now: kstAt('2026-09-07', '00:30'), publishedToday: 0, profile: PROFILES[st],
    })
    return slotsOf(st).some((lab) => kstStamp(at).includes(lab))
  })())
  check(`🔴 ${st} · 오늘 상한을 채우면 내일 첫 슬롯이다`, (() => {
    const at = nextScheduleAt({
      now: kstAt('2026-09-07', '12:00'),
      publishedToday: PROFILES[st].dailyTarget, profile: PROFILES[st],
    })
    return kstDateLabel(at) === '2026-09-08' && kstStamp(at).includes(slotsOf(st)[0]!)
  })())
}
check('🔴 어느 단계의 다음 예약도 00:05 가 아니다', (['d1', 'd3', 'd5', 'd10'] as const).every((st) => {
  const at = nextScheduleAt({ now: kstAt('2026-09-07', '00:30'), publishedToday: 0, profile: PROFILES[st] })
  return !kstStamp(at).includes('00:05')
}))

// ── ②-b 관제 경고 기준 — 🔴 첫 슬롯 + 유예 이후에만 운다 ──
{
  const firstMin = (st: ReleaseStage): number => Math.min(...PROFILES[st].slots.map(minuteOfDay))
  const graceMin = PUBLISH_GRACE_MS / 60_000
  const warns = (st: ReleaseStage, hhmm: string, todayCount: number): boolean => {
    const now = kstAt('2026-09-07', hhmm)
    const scheduled = new Date(kstDayStart(now).getTime() + firstMin(st) * 60_000)
    const graceUntil = new Date(scheduled.getTime() + PUBLISH_GRACE_MS)
    return judgePublish({
      todayCount, dailyCap: PROFILES[st].dailyTarget,
      afterPublishGrace: now.getTime() >= graceUntil.getTime(),
      mismatched: 0, legacyPublishedToday: 0, historicUnknownProfile: 0,
      candidates: 5, now,
    }).some((x) => x.code === 'PUBLISH_NONE_TODAY')
  }
  const d1First = firstMin('d1')
  const hm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  check('① d1 · 첫 슬롯 1분 전 · 발행 0 → 경고 없음', !warns('d1', hm(d1First - 1), 0))
  check('② d1 · 첫 슬롯 직후 → 유예 중, 경고 없음', !warns('d1', hm(d1First), 0))
  check(`③ d1 · 유예(${graceMin}분) 1분 전 → 경고 없음`, !warns('d1', hm(d1First + graceMin - 1), 0))
  check(`④ d1 · 유예 지남 · 발행 0 → WARNING`, warns('d1', hm(d1First + graceMin), 0))
  check('🔴 옛 판이라면 01:05 에 이미 울었다 — 지금은 조용하다', !warns('d1', '01:05', 0))
  check('🟢 발행이 있었으면 유예 뒤에도 조용하다', !warns('d1', hm(d1First + graceMin + 60), 1))
}

// ── ③ rolling 7일 경계 ──
const h = (code: string, ...iso: string[]): PersonaHistory =>
  ({ code, matchedAts: iso.map(utc) })

check('🔴 rolling 7일 경계는 **포함**이다 — 정확히 7일 전 글은 아직 이번 주다', (() => {
  const at = utc('2026-09-08T00:00:00.000Z')
  const p = h('P1', '2026-09-01T00:00:00.000Z')  // 정확히 7일 전
  return !personaAvailableAt(p, at)
})())
check('🟢 7일 하고 1ms 더 지나면 풀린다', (() => {
  const at = utc('2026-09-08T00:00:00.001Z')
  const p = h('P1', '2026-09-01T00:00:00.000Z')
  return personaAvailableAt(p, at)
})())
check('🔴 최소 간격 5일 경계 — 4일 23시간은 아직 안 된다', (() => {
  const at = utc('2026-09-08T00:00:00.000Z')
  const p = h('P1', '2026-09-03T01:00:00.000Z')
  return !personaAvailableAt(p, at)
})())
// 🔴 5일이 지나도 **주간 cap 이 먼저 막는다** — 두 조건 중 더 조이는 쪽이 이긴다.
//    최소 간격만 따로 보려면 그 글이 rolling 7일 밖에 있어야 한다.
check('🔴 5일은 지났지만 주간 cap 안이면 아직 못 쓴다', (() => {
  const at = utc('2026-09-08T00:00:00.000Z')
  const p = h('P1', '2026-09-03T00:00:00.000Z')   // 5일 전 · 주간 안
  return !personaAvailableAt(p, at)
})())
check('🟢 주간 밖 + 5일 경과면 쓸 수 있다', (() => {
  const at = utc('2026-09-08T00:00:00.000Z')
  const p = h('P1', '2026-08-30T00:00:00.000Z')   // 9일 전
  return personaAvailableAt(p, at)
})())
check('🟢 이력이 없으면 언제든 가능하다', personaAvailableAt(h('P1'), NOW))
check('🔴 주간 cap 과 최소 간격을 **둘 다** 본다',
  POST_CAP_PER_WEEK === 1 && MIN_DAYS_BETWEEN_POSTS === 5)
check('🟢 가능한 persona 만 추린다', (() => {
  const list = availablePersonasAt(
    [h('P1'), h('P2', '2026-09-06T00:00:00.000Z'), h('P3', '2026-08-01T00:00:00.000Z')],
    utc('2026-09-08T00:00:00.000Z'),
  )
  return list.join(' ') === 'P1 P3'
})())

// ── ④ 🔴 지운 예측기가 돌아오지 않는다 (2026-09-30 · source-slot-v1) ──
check('🔴 🔴 **14일 발행 예측 · capacity · 필요 persona 함수가 없다**', (() => {
  const names = Object.keys(forecastLib)
  return ['forecastPublishing', 'capacityOf', 'personasNeededFor', 'judgeCapacity', 'classifyHeadBlock',
    'blockRatesByCombination', 'splitBlockReasons', 'MAX_NEED_MULTIPLIER'].every((n) => !names.includes(n))
})())

// ── ⑤ read-only 계약 ──
{
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check('🔴 lib 이 DB 를 건드리지 않는다', !/PrismaClient|prisma\./.test(lib))
  check('🔴 lib 이 파일을 쓰지 않는다', !/writeFileSync|rmSync|mkdirSync/.test(lib))
  check('🔴 상한을 자체 정의하지 않는다',
    /POST_CAP_PER_WEEK/.test(lib) && !/POST_CAP_PER_WEEK\s*=\s*\d/.test(lib))

  const runner = readFileSync('scripts/supply-health.mts', 'utf-8')
  check('🔴 관제가 14일 예측을 다시 조립하지 않는다', !/forecastPublishing\(|simulateAllStages\(|promotionPlan\(/.test(runner))
  check('🔴 관제가 러너와 같은 적재 · 같은 JIT 함수를 쓴다',
    /loadStockClassification\(prisma, process\.env, now\)/.test(runner) && /jitCoverageOf\(view, now\)/.test(runner))
  check('🔴 러너가 오늘 발행 수를 넘겨 다음 예약을 정한다',
    /nextScheduleAt\(\{ now, publishedToday: todayCount/.test(runner))
  check('🔴 하루 상한은 러너 정본 상수를 쓴다', DAILY_PUBLISH_CAP === 1)
  // 🔴 러너는 **확정된 release 프로필**의 상한을 주입한다 — 모듈 상수는 안전 기본값일 뿐이다
  check('🔴 러너가 dailyCap 을 명시적으로 주입한다',
    /dailyCap: RELEASE_DAILY_CAP/.test(runner) && !/dailyCap: DAILY_PUBLISH_CAP/.test(runner))
  check('🔴 러너가 그 상한을 규모 확정(적재) 뒤에 만든다',
    runner.indexOf('loadStockClassification(prisma') < runner.indexOf('const RELEASE_DAILY_CAP ='))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
