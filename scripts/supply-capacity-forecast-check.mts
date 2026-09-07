/**
 * 발행 여력 예측 fixture (§4-AW ③-b)
 *
 * 🔴 네트워크 0 · LLM 0 · DB 0 · 파일 write 0.
 */

import { readFileSync } from 'node:fs'

import {
  DAILY_CAP_FOR_FORECAST, MAX_NEED_MULTIPLIER,
  availablePersonasAt, capacityOf, forecastPublishing, judgeCapacity, kstDateLabel,
  kstDayStartOf, kstStamp, nextScheduleAt, personaAvailableAt, personasNeededFor,
  splitBlockReasons,
  type PersonaHistory,
} from '../src/lib/supply-capacity-forecast'
import { MIN_DAYS_BETWEEN_POSTS, POST_CAP_PER_WEEK } from '../src/lib/original-post-persona-match'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

const DAY = 86_400_000
/** 🔴 KST 2026-09-07 21:00 = UTC 12:00 */
const NOW = new Date('2026-09-07T12:00:00.000Z')
const utc = (iso: string): Date => new Date(iso)

console.log('\n══ 발행 여력 예측 fixture ══\n')

// ── ① KST 경계 ──
check('🔴 KST 하루 시작이 UTC 15:00 이다', (() => {
  const d = kstDayStartOf(NOW)
  return d.toISOString() === '2026-09-06T15:00:00.000Z'
})())
check('🔴 UTC 날짜를 KST 처럼 보여주지 않는다 — 09-06T15:00Z 는 KST 09-07 이다',
  kstDateLabel(utc('2026-09-06T15:00:00.000Z')) === '2026-09-07')
check('🔴 UTC 자정 직전은 KST 로 이미 다음 날이다',
  kstDateLabel(utc('2026-09-07T23:00:00.000Z')) === '2026-09-08')
check('🔴 표시에 KST 가 드러난다', kstStamp(NOW).endsWith('KST'))
check('🔴 matchedAt UTC 13:38 은 KST 22:38 이다',
  kstStamp(utc('2026-09-02T13:38:00.000Z')).startsWith('09-02 22:38'))

// ── ② 다음 예약 — 오늘 cap 을 채웠으면 내일 ──
check('🔴 오늘 이미 1/1 이면 다음 예약은 **내일** 00:05 KST 다', (() => {
  const at = nextScheduleAt({ now: NOW, publishedToday: 1, dailyCap: 1 })
  return kstDateLabel(at) === '2026-09-08' && kstStamp(at).includes('00:05')
})())
check('🟢 오늘 예약 전이고 상한도 안 찼으면 오늘이다', (() => {
  // KST 09-07 00:03 = UTC 09-06 15:03
  const at = nextScheduleAt({ now: utc('2026-09-06T15:03:00.000Z'), publishedToday: 0, dailyCap: 1 })
  return kstDateLabel(at) === '2026-09-07'
})())
check('🔴 예약 시각이 지났으면 오늘 0건이어도 내일이다', (() => {
  const at = nextScheduleAt({ now: NOW, publishedToday: 0, dailyCap: 1 })
  return kstDateLabel(at) === '2026-09-08'
})())

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

// ── ④ 시뮬레이션 — 실제 러너 동작 재현 ──
type P = Parameters<typeof forecastPublishing>[0]['personas'][number]
const persona = (code: string): P => ({
  code, status: 'active', providerId: null,
  maritalStatus: null, parentCare: null, menopauseStatus: null,
  workStatus: null, economicStatus: null, region: null,
  noGoTopics: [], postsThisWeek: 0, daysSinceLastPost: null,
} as unknown as P)
const draft = (id: string): { queueId: string; title: string; body: string; gateVerdict: string; createdAt: number } =>
  ({ queueId: id, title: '오늘 저녁 뭐 드세요', body: '요즘 반찬이 마땅치 않아서요. 다들 어떻게 하세요?', gateVerdict: 'PASS', createdAt: 0 })

const START = utc('2026-09-07T15:05:00.000Z')  // KST 09-08 00:05

check('🟢 여유 persona 가 있으면 첫날 발행한다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1')], personas: [persona('P1')], history: [h('P1')],
    startAt: START, days: 7, dailyCap: 1,
  })
  return fc.days[0].publishedQueueId === 'q1' && fc.in7 === 1
})())
check('🔴 발행 후 그 persona 는 다음 날 못 쓴다 — 여력이 줄어든 것이 반영된다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2')], personas: [persona('P1')], history: [h('P1')],
    startAt: START, days: 7, dailyCap: 1,
  })
  return fc.days[0].publishedQueueId === 'q1' && fc.days[1].publishedQueueId === null
    && fc.days[1].blockedReason === 'NO_PERSONA'
})())
check('🔴 rolling 7일 경계가 포함이라 8일째에 풀린다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2')], personas: [persona('P1')], history: [h('P1')],
    startAt: START, days: 10, dailyCap: 1,
  })
  // 0일째 발행 → 7일째는 경계 포함이라 아직 막히고, 8일째에 풀린다
  return fc.days[0].publishedQueueId !== null
    && fc.days[7].publishedQueueId === null
    && fc.days[8].publishedQueueId !== null
})())
check('🔴 후보가 떨어지면 NO_CANDIDATE 다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1')], personas: [persona('P1'), persona('P2')],
    history: [h('P1'), h('P2')], startAt: START, days: 3, dailyCap: 1,
  })
  return fc.days[1].blockedReason === 'NO_CANDIDATE'
})())
check('🔴 맨 앞 글에 배정이 안 되면 **뒤 글로 우회하지 않는다** — 러너가 그렇게 멈춘다', (() => {
  // noGo 로 P1 을 막아 첫 글이 배정 불가가 되게 한다
  const blocked = { ...persona('P1'), noGoTopics: ['저녁'] } as unknown as P
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2')], personas: [blocked], history: [h('P1')],
    startAt: START, days: 3, dailyCap: 1,
  })
  // 우회했다면 q2 가 나갔을 것이다
  return fc.days[0].publishedQueueId === null && fc.in7 === 0
})())
check('🔴 호출자의 이력 배열을 바꾸지 않는다', (() => {
  const hist = [h('P1')]
  forecastPublishing({
    queue: [draft('q1')], personas: [persona('P1')], history: hist,
    startAt: START, days: 3, dailyCap: 1,
  })
  return hist[0].matchedAts.length === 0
})())
check('🔴 공백 날짜를 KST 로 돌려준다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1')], personas: [persona('P1')], history: [h('P1')],
    startAt: START, days: 3, dailyCap: 1,
  })
  return fc.gapDates7.length === 2 && fc.gapDates7[0] === '2026-09-09'
})())
check('🔴 다음 대상과 배정 가능 persona 를 돌려준다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1')], personas: [persona('P1'), persona('P2')],
    history: [h('P1'), h('P2')], startAt: START, days: 3, dailyCap: 1,
  })
  return fc.nextQueueId === 'q1' && fc.nextPersonaCandidates.length === 2
})())

// ── ⑤ 등급 ──
check('🔴 7일 예상 0건이면 CRITICAL — 재고가 있어도 나가지 못한다', (() => {
  const r = judgeCapacity({ stockUsable: 14, in7: 0, nextWillPublish: false, nextCandidates: 0, shortfallMin: 2 })
  return r.some((x) => x.code === 'FORECAST_EMPTY' && x.level === 'CRITICAL')
})())
check('🟡 재고는 있는데 다음 후보가 배정 불가면 WARNING', (() => {
  const r = judgeCapacity({ stockUsable: 14, in7: 3, nextWillPublish: false, nextCandidates: 0, shortfallMin: 0 })
  return r.some((x) => x.code === 'NEXT_NOT_ASSIGNABLE' && x.level === 'WARNING')
})())
check('🟡 persona 가 부족하면 WARNING', (() => {
  const r = judgeCapacity({ stockUsable: 14, in7: 3, nextWillPublish: true, nextCandidates: 2, shortfallMin: 2 })
  return r.some((x) => x.code === 'PERSONA_SHORTFALL' && x.level === 'WARNING')
})())
check('🟢 다 괜찮으면 HEALTHY', (() => {
  const r = judgeCapacity({ stockUsable: 14, in7: 7, nextWillPublish: true, nextCandidates: 3, shortfallMin: 0 })
  return r.length === 1 && r[0].level === 'HEALTHY'
})())

// ── ⑥ capacity · 필요 persona ──
check('🔴 이론 capacity 와 실매칭 capacity 를 나눈다', (() => {
  const c = capacityOf({ activePersonas: 5, lifeBlockRate: 0.2 })
  return c.theoreticalPerWeek === 5 && Math.abs(c.theoreticalPerDay - 5 / 7) < 1e-9
    && c.effectivePerDay < c.theoreticalPerDay
})())
check('🔴 권장 persona 를 **범위**로 낸다 — 표본이 작다', (() => {
  const n = personasNeededFor({ targetPerDay: 1, lifeBlockRate: 0.2, activePersonas: 5 })
  return n.min === 7 && n.max > n.min && n.shortfallMin === 2
})())
check('🔴 탈락률이 1 에 가까워도 폭주하지 않는다 — 700명 같은 수는 근거가 아니라 잡음이다', (() => {
  const n = personasNeededFor({ targetPerDay: 1, lifeBlockRate: 1, activePersonas: 5 })
  return n.max === n.min * MAX_NEED_MULTIPLIER
})())
check('🟢 3/day 이론 최소는 21명', personasNeededFor({ targetPerDay: 3, lifeBlockRate: 0, activePersonas: 5 }).min === 21)
check('🟢 5/day 이론 최소는 35명', personasNeededFor({ targetPerDay: 5, lifeBlockRate: 0, activePersonas: 5 }).min === 35)

// ── ⑦ 생활사 / 여력 분리 ──
check('🔴 생활사(영구)와 여력(임시)을 나눈다', (() => {
  const s = splitBlockReasons({
    WEEKLY_CAP: 76, TOO_SOON: 76, MARITAL_CONFLICT: 8, CHILD_AGE_CONFLICT: 5,
    NO_CHILDREN: 5, NO_PARENT_CARE: 2,
  })
  return s.capacity === 152 && s.life === 20 && Math.abs(s.lifeRate - 20 / 172) < 1e-9
})())
check('🟢 차단이 없으면 비율 0', splitBlockReasons({}).lifeRate === 0)

// ── ⑧ read-only 계약 ──
{
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check('🔴 lib 이 DB 를 건드리지 않는다', !/PrismaClient|prisma\./.test(lib))
  check('🔴 lib 이 파일을 쓰지 않는다', !/writeFileSync|rmSync|mkdirSync/.test(lib))
  check('🔴 새 매칭 판정을 만들지 않는다 — planBatch 를 쓴다',
    /planBatch/.test(lib) && !/function planMatch|function scoreOf/.test(lib))
  check('🔴 상한을 자체 정의하지 않는다',
    /POST_CAP_PER_WEEK/.test(lib) && !/POST_CAP_PER_WEEK\s*=\s*\d/.test(lib))

  const runner = readFileSync('scripts/supply-health.mts', 'utf-8')
  check('🔴 러너가 legacy 를 selectAutoTargets 로 거른다', /selectAutoTargets\(/.test(runner))
  check('🔴 러너가 화면과 JSON 에 같은 forecast 를 쓴다', (() => {
    const built = (runner.match(/forecastPublishing\(/g) ?? []).length
    return built === 1
  })())
  check('🔴 러너가 오늘 발행 수를 넘겨 다음 예약을 정한다',
    /nextScheduleAt\(\{ now, publishedToday: todayCount/.test(runner))
  check('🔴 하루 상한은 러너 상수를 쓴다', DAILY_CAP_FOR_FORECAST === 1)
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
