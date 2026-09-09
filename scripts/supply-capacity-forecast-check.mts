/**
 * 발행 여력 예측 fixture (§4-AW ③-b)
 *
 * 🔴 네트워크 0 · LLM 0 · DB 0 · 파일 write 0.
 */

import { readFileSync } from 'node:fs'

import {
  MAX_NEED_MULTIPLIER, availablePersonasAt, blockRatesByCombination, capacityOf, classifyHeadBlock,
  forecastPublishing, judgeCapacity, kstDateLabel, kstStamp, nextScheduleAt,
  type BlockReason,
  personaAvailableAt, personasNeededFor, splitBlockReasons,
  type PersonaHistory,
} from '../src/lib/supply-capacity-forecast'
import {
  MIN_DAYS_BETWEEN_POSTS, POST_CAP_PER_WEEK, planMatch, planBatch,
  type BatchDraft, type PersonaForMatch,
} from '../src/lib/original-post-persona-match'
import { pickPublishTarget } from '../src/lib/original-post-auto-publish'
import type { QueueCandidate } from '../src/lib/supply-candidates'
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

console.log('\n══ 발행 여력 예측 fixture ══\n')

// ── ① KST 경계 ──
check('🔴 KST 하루 시작은 **정본** kstDayStart 를 쓴다 — 복제하지 않는다', (() => {
  const d = kstDayStart(NOW)
  return d.toISOString() === '2026-09-06T15:00:00.000Z'
})())
check('🔴 forecast lib 이 자체 KST 자정 계산을 두지 않는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  return /import \{ kstDayStart \}/.test(lib) && !/function kstDayStartOf/.test(lib)
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
  code, status: 'active', providerId: null, accountCount: 0,
  maritalStatus: null, parentCare: null, menopauseStatus: null,
  workStatus: null, economicStatus: null, region: null,
  noGoTopics: [], postsThisWeek: 0, daysSinceLastPost: null,
} as unknown as P)
const START = utc('2026-09-07T15:05:00.000Z')  // KST 09-08 00:05
const draft = (id: string): QueueCandidate =>
  ({ queueId: id, title: '저녁 뭐 드세요', body: '반찬이 마땅치 않아서요. 다들 어떻게 하세요?',
    gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null,
    // 🔴 예측일마다 나이를 다시 잰다 — 여기서는 늘 갓 수집된 글로 둔다
    capturedAt: START })


check('🟢 여유 persona 가 있으면 첫날 발행한다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1')], personas: [persona('P1')], history: [h('P1')],
    startAt: START, days: 7, dailyCap: 1,
  })
  return fc.days[0].published[0]?.queueId === 'q1' && fc.in7 === 1
})())
check('🔴 발행 후 그 persona 는 다음 날 못 쓴다 — 여력이 줄어든 것이 반영된다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2')], personas: [persona('P1')], history: [h('P1')],
    startAt: START, days: 7, dailyCap: 1,
  })
  return fc.days[0].published[0]?.queueId === 'q1' && fc.days[1].published.length === 0
    && fc.days[1].blockedReason === 'CAPACITY_WAIT'
})())
check('🔴 rolling 7일 경계가 포함이라 8일째에 풀린다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2')], personas: [persona('P1')], history: [h('P1')],
    startAt: START, days: 10, dailyCap: 1,
  })
  // 0일째 발행 → 7일째는 경계 포함이라 아직 막히고, 8일째에 풀린다
  return fc.days[0].published.length > 0
    && fc.days[7].published.length === 0
    && fc.days[8].published.length > 0
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
  return fc.days[0].published.length === 0 && fc.in7 === 0
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
  const r = judgeCapacity({ stockUsable: 14, in7: 0, nextWillPublish: false, nextCandidates: 0, shortfallMin: 2, dailyCap: 1 })
  return r.some((x) => x.code === 'FORECAST_EMPTY' && x.level === 'CRITICAL')
})())
check('🟡 재고는 있는데 다음 후보가 배정 불가면 WARNING', (() => {
  const r = judgeCapacity({ stockUsable: 14, in7: 3, nextWillPublish: false, nextCandidates: 0, shortfallMin: 0, dailyCap: 1 })
  return r.some((x) => x.code === 'NEXT_NOT_ASSIGNABLE' && x.level === 'WARNING')
})())
check('🟡 persona 가 부족하면 WARNING', (() => {
  const r = judgeCapacity({ stockUsable: 14, in7: 3, nextWillPublish: true, nextCandidates: 2, shortfallMin: 2, dailyCap: 1 })
  return r.some((x) => x.code === 'PERSONA_SHORTFALL' && x.level === 'WARNING')
})())
check('🟢 다 괜찮으면 HEALTHY', (() => {
  const r = judgeCapacity({ stockUsable: 14, in7: 7, nextWillPublish: true, nextCandidates: 3, shortfallMin: 0, dailyCap: 1 })
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

// ══════════════════════════════════════════════════════════════════
// 🔴 #468 이후 — childrenCount · 전체 후보 planBatch · 조합 분모 · dailyCap>1
// ══════════════════════════════════════════════════════════════════

// ① 실제 두 번째 후보의 조건에서 자녀 있는 persona 가 eligible 인가
{
  // 🔴 CHILDREN_RE 가 잡는 낱말을 쓴다 — '아이랑' 은 패턴에 없어 트리거되지 않는다
  const KID_TITLE = '애들이랑 같이 갈 숙소, 뭐 보고 고르세요?'
  const KID_BODY = '이번에 애들이랑 같이 가려는데 숙소를 뭘 보고 골라야 할지 모르겠어요.'
  const kidPersona = (code: string, kids: number | null): P => ({
    ...persona(code), ...(kids === null ? {} : { childrenCount: kids }),
  } as unknown as P)

  const withKids = planMatch({
    queueId: 'q2', title: KID_TITLE, body: KID_BODY,
    personas: [kidPersona('P10', 1), kidPersona('P17', 2), kidPersona('P15', 0)] as never,
  })
  check('🔴 [#468] 자녀 글에 P10·P17 이 eligible 이다',
    withKids.eligible.map((c) => c.code).sort().join(' ') === 'P10 P17')
  check('🔴 [#468] 무자녀 P15 는 차단된다',
    withKids.blocked.some((b) => b.code === 'P15' && b.reasons.some((r) => r.code === 'NO_CHILDREN')))

  const missing = planMatch({
    queueId: 'q2', title: KID_TITLE, body: KID_BODY,
    personas: [kidPersona('P10', null), kidPersona('P17', null)] as never,
  })
  check('🔴 [#468 회귀] childrenCount 를 넘기지 않으면 전원 잘못 막힌다',
    missing.eligible.length === 0
    && missing.blocked.every((b) => b.reasons.some((r) => r.code === 'NO_CHILDREN')))
  check('🔴 [#468] health 러너도 childrenCount 를 넘긴다', (() => {
    const h = readFileSync('scripts/supply-health.mts', 'utf-8')
    return /childrenCount: typeof id\.childrenCount === 'number'/.test(h)
  })())
}

// ② 전체 후보를 planBatch 에 넘기되 발행 대상은 head 다
check('🔴 [배치] 남은 후보 **전체**를 계획 함수에 넘긴다 — head 하나만 넘기지 않는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  /**
   * 🔴 2026-09-08: 배정은 이제 **공용 계획 함수**가 한다. 예측이 `planBatch` 를 직접 부르면
   *    러너가 쓰는 발행 우선권이 빠져 같은 입력에 다른 글을 고른다(재현 확인).
   *    그래도 "남은 후보 전체" 라는 계약은 그대로다.
   */
  return /prepareCandidates\(\{\s*candidates: remaining, personas: personasNow/.test(lib)
    && !/planBatch\(/.test(lib)
    && !/prepareCandidates\(\{ candidates: \[head\]/.test(lib)
})())
// 🔴 2026-09-07 교체: 발행 대상은 head 가 아니라 **배정이 있는 첫 글**이다.
//    그리고 그 규칙은 러너의 함수를 **그대로 부른다** — 예측용으로 복제하지 않는다
check('🔴 [선택] 러너의 pickPublishTarget 을 부른다 — 규칙을 복제하지 않는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  return /import \{ pickPublishTarget \} from '\.\/original-post-auto-publish'/.test(lib)
    && /pickPublishTarget\(\{/.test(lib)
})())
check('🔴 [선택] 예측이 자기만의 선택 규칙을 다시 만들지 않는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  // head 를 집어 그대로 발행 대상으로 삼던 옛 코드가 남아 있으면 안 된다
  return !/const head = remaining\[0\]/.test(lib)
    && !/function pickPublishTarget/.test(lib)
})())
check('🔴 [선택] 나간 것만 큐에서 뺀다 — 건너뛴 앞 글은 줄에 남는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  return /remaining\.splice\(/.test(lib) && !/remaining\.shift\(\)/.test(lib)
})())
check('🔴 [배치] 여력이 다른 글에 쓰이면 BATCH_EXHAUSTED 로 구분한다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  return /BATCH_EXHAUSTED/.test(lib)
})())

// ③ 조합 분모 — 사유 개수가 아니다
check('🔴 [조합] 분모는 후보 × persona 다', (() => {
  const r = blockRatesByCombination({ candidates: 14, personas: 5, blockedCombos: [] })
  return r.total === 70 && r.eligible === 70
})())
check('🔴 [조합] 한 조합에 사유가 여러 개여도 **한 번만** 센다', (() => {
  const r = blockRatesByCombination({
    candidates: 2, personas: 1,
    blockedCombos: [['NO_CHILDREN', 'CHILD_AGE_CONFLICT', 'MARITAL_CONFLICT']],
  })
  return r.total === 2 && r.lifeBlocked === 1 && r.eligible === 1
})())
check('🔴 [조합] 생활사가 하나라도 있으면 영구 차단으로 센다 — 시간이 지나도 안 풀린다', (() => {
  const r = blockRatesByCombination({
    candidates: 1, personas: 1, blockedCombos: [['WEEKLY_CAP', 'NO_CHILDREN']],
  })
  return r.lifeBlocked === 1 && r.capacityBlocked === 0
})())
check('🟢 [조합] cap·간격만이면 임시 차단이다', (() => {
  const r = blockRatesByCombination({
    candidates: 1, personas: 1, blockedCombos: [['WEEKLY_CAP', 'TOO_SOON']],
  })
  return r.capacityBlocked === 1 && r.lifeBlocked === 0
})())
check('🔴 [조합] 러너가 조합 단위로 센다 — 사유 개수 집계를 쓰지 않는다', (() => {
  const h = readFileSync('scripts/supply-health.mts', 'utf-8')
  return /blockRatesByCombination\(/.test(h) && !/blockCounts\[/.test(h)
})())

// ④ dailyCap 1 · 3
check('🟢 [cap=1] 하루 1건만 나간다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2'), draft('q3')],
    personas: [persona('P1'), persona('P2'), persona('P3')],
    history: [h('P1'), h('P2'), h('P3')], startAt: START, days: 2, dailyCap: 1,
  })
  return fc.days[0].published.length === 1
})())
check('🔴 [cap=3] 하루 여러 건이 **배열로** 남는다 — 덮어쓰지 않는다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2'), draft('q3')],
    personas: [persona('P1'), persona('P2'), persona('P3')],
    history: [h('P1'), h('P2'), h('P3')], startAt: START, days: 2, dailyCap: 3,
  })
  const first = fc.days[0].published
  return first.length === 3
    && new Set(first.map((x) => x.queueId)).size === 3
    && new Set(first.map((x) => x.persona)).size === 3
})())
check('🔴 [cap=3] 세 건이 in7 에 모두 반영된다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2'), draft('q3')],
    personas: [persona('P1'), persona('P2'), persona('P3')],
    history: [h('P1'), h('P2'), h('P3')], startAt: START, days: 7, dailyCap: 3,
  })
  return fc.in7 === 3
})())
check('🔴 [cap=3] persona 가 모자라면 그만큼만 나간다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2'), draft('q3')],
    personas: [persona('P1')], history: [h('P1')], startAt: START, days: 2, dailyCap: 3,
  })
  return fc.days[0].published.length === 1
})())

// ⑤ 차단 사유 구분
check('🔴 [사유] 생활사 영구 차단을 LIFE_BLOCKED 로 낸다', (() => {
  const blocked = { ...persona('P1'), noGoTopics: ['저녁'] } as unknown as P
  const fc = forecastPublishing({
    queue: [draft('q1')], personas: [blocked], history: [h('P1')],
    startAt: START, days: 2, dailyCap: 1,
  })
  return fc.days[0].blockedReason === 'LIFE_BLOCKED' && fc.nextBlockReason === 'LIFE_BLOCKED'
})())
check('🔴 [사유] cap·간격 대기는 CAPACITY_WAIT 다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2')], personas: [persona('P1')], history: [h('P1')],
    startAt: START, days: 3, dailyCap: 1,
  })
  return fc.days[1].blockedReason === 'CAPACITY_WAIT'
})())
check('🔴 [사유] 막힌 글의 id 를 남긴다', (() => {
  const blocked = { ...persona('P1'), noGoTopics: ['저녁'] } as unknown as P
  const fc = forecastPublishing({
    queue: [draft('q1')], personas: [blocked], history: [h('P1')],
    startAt: START, days: 2, dailyCap: 1,
  })
  return fc.days[0].blockedQueueId === 'q1'
})())
check('🔴 [사유] 상한을 채우면 DAILY_CAP_DONE 이다', (() => {
  const fc = forecastPublishing({
    queue: [draft('q1'), draft('q2')], personas: [persona('P1'), persona('P2')],
    history: [h('P1'), h('P2')], startAt: START, days: 2, dailyCap: 1,
  })
  return fc.days[0].blockedReason === 'DAILY_CAP_DONE'
})())

// ══════════════════════════════════════════════════════════════════
// 🔴 차단 분류는 **persona 조합 단위**다
//
// 전체 blocked 에서 "생활사가 하나라도 / capacity 가 하나라도" 를 따로 세면
// 서로 다른 persona 의 사유가 섞여, 아무도 기다려서 풀리지 않는 경우가
// CAPACITY_WAIT 로 잘못 읽힌다 — 기다리면 된다고 착각하게 된다.
// ══════════════════════════════════════════════════════════════════
check('🔴 [분류] P1: NO_CHILDREN+WEEKLY_CAP · P2: NO_CHILDREN → LIFE_BLOCKED', (() => (
  classifyHeadBlock({
    eligibleCount: 0,
    blocked: [['NO_CHILDREN', 'WEEKLY_CAP'], ['NO_CHILDREN']],
  }) === 'LIFE_BLOCKED'
))())
check('🔴 [분류] P1: NO_CHILDREN · P2: WEEKLY_CAP 만 → CAPACITY_WAIT', (() => (
  classifyHeadBlock({
    eligibleCount: 0,
    blocked: [['NO_CHILDREN'], ['WEEKLY_CAP']],
  }) === 'CAPACITY_WAIT'
))())
check('🔴 [분류] 한 persona 의 NO_CHILDREN+WEEKLY_CAP 은 기다려도 안 풀린다', (() => (
  classifyHeadBlock({ eligibleCount: 0, blocked: [['NO_CHILDREN', 'WEEKLY_CAP']] }) === 'LIFE_BLOCKED'
))())
check('🟡 [분류] TOO_SOON 만 있는 persona 가 있으면 CAPACITY_WAIT', (() => (
  classifyHeadBlock({ eligibleCount: 0, blocked: [['MARITAL_CONFLICT'], ['TOO_SOON']] }) === 'CAPACITY_WAIT'
))())
check('🔴 [분류] eligible 이 있으면 배치 여력 문제다', (() => (
  classifyHeadBlock({ eligibleCount: 2, blocked: [['WEEKLY_CAP']] }) === 'BATCH_EXHAUSTED'
))())
check('🔴 [분류] 러너가 이 함수를 쓴다 — anyLife/anyCapacity 를 섞지 않는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  return /classifyHeadBlock\(\{/.test(lib) && !/const anyLife =/.test(lib)
})())

// ══════════════════════════════════════════════════════════════════
// 🔴 FORECAST_LOW — "다음 한 건은 나간다" 가 그 뒤 엿새를 가리면 안 된다
// ══════════════════════════════════════════════════════════════════
const jc = (in7: number, dailyCap = 1, nextWillPublish = true): ReturnType<typeof judgeCapacity> =>
  judgeCapacity({ stockUsable: 14, in7, nextWillPublish, nextCandidates: 2, shortfallMin: 0, dailyCap })

check('🔴 [LOW] cap=1 · 7일 3건(기대 7의 절반 미만) → WARNING', (() => {
  const r = jc(3)
  return r.some((x) => x.code === 'FORECAST_LOW' && x.level === 'WARNING')
})())
check('🟢 [LOW 경계] 정확히 절반(3.5 → 4건)은 경고하지 않는다 — 부등호는 "미만" 하나다',
  !jc(4).some((x) => x.code === 'FORECAST_LOW'))
check('🔴 [LOW 경계] 3건은 3.5 미만이라 경고한다',
  jc(3).some((x) => x.code === 'FORECAST_LOW'))
check('🔴 [LOW] 다음 예약 1건이 가능해도 이후가 막히면 HEALTHY 가 아니다', (() => {
  const r = jc(1, 1, true)
  return r.some((x) => x.code === 'FORECAST_LOW') && !r.some((x) => x.code === 'CAPACITY_OK')
})())
check('🔴 [LOW] cap=3 이면 기대 21건 — 10건도 경고다', (() => {
  const r = jc(10, 3)
  return r.some((x) => x.code === 'FORECAST_LOW')
})())
check('🟢 [LOW] cap=3 · 11건(절반 10.5 초과)은 경고하지 않는다',
  !jc(11, 3).some((x) => x.code === 'FORECAST_LOW'))
check('🔴 [LOW] 0건은 여전히 CRITICAL 이다 — LOW 로 낮추지 않는다', (() => {
  const r = jc(0, 1, false)
  return r.some((x) => x.code === 'FORECAST_EMPTY' && x.level === 'CRITICAL')
    && !r.some((x) => x.code === 'FORECAST_LOW')
})())
check('🟢 [LOW] 기대량을 채우면 HEALTHY', (() => {
  const r = jc(7)
  return r.length === 1 && r[0].code === 'CAPACITY_OK'
})())
// 🔴 **주입값을 넘겨야 한다** (2026-09-08). 모듈 상수를 넘기면 규모 설정이 관제에 닿지 않는다
check('🔴 [LOW] 러너가 확정된 release 상한을 judgeCapacity 에 넘긴다', (() => {
  const h = readFileSync('scripts/supply-health.mts', 'utf-8')
  return /dailyCap: RELEASE_DAILY_CAP,/.test(h) && !/dailyCap: DAILY_PUBLISH_CAP/.test(h)
})())

// 🔴 옛 실측 수치가 주석에 박혀 있지 않다
check('🔴 [stale] lib 주석에 특정 공백 일수를 박아 두지 않는다', (() => {
  const lib = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  return !/14일 중 \*\*5일|앞으로 5일 공백|7일 중 6일/.test(lib)
})())

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
  check('🔴 하루 상한은 러너 정본 상수를 쓴다', DAILY_PUBLISH_CAP === 1)
  // 🔴 러너는 **확정된 release 프로필**의 상한을 주입한다 — 모듈 상수는 안전 기본값일 뿐이다
  check('🔴 러너가 dailyCap 을 명시적으로 주입한다',
    /dailyCap: RELEASE_DAILY_CAP/.test(runner) && !/dailyCap: DAILY_PUBLISH_CAP/.test(runner))
  check('🔴 러너가 그 상한을 규모 확정 뒤에 만든다',
    runner.indexOf('installFromEnv(') < runner.indexOf('const RELEASE_DAILY_CAP ='))
}

// ③ 🔴 예측과 러너가 **같은 글**을 고른다 — 두 화면이 다른 말을 하면 안 된다
{
  const D = (n: number): QueueCandidate => ({ queueId: `q${n}`, title: '국수', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: n, assignedPersonaCode: null, capturedAt: new Date('2026-09-07T15:05:00.000Z') })
  const queue = [D(0), D(1), D(2)]
  // q0 만 자녀 글로 바꿔 아무도 못 맡게 한다 → 예측도 러너도 q1 을 골라야 한다
  const blockedHead: QueueCandidate = { ...D(0), title: '중학생 딸', body: '딸이 사춘기라 힘들어요.' }
  const q = [blockedHead, D(1), D(2)]
  const personas = ['A', 'B'].map((c) => ({
    code: c, status: 'active', providerId: null, accountCount: 0,
    maritalStatus: '기혼', childrenCount: 0, childrenAgeBands: [] as string[],
    parentCare: '상시', menopauseStatus: '진행중', workStatus: null, economicStatus: null,
    region: null, noGoTopics: [] as string[], voiceLength: '중간',
    postsThisWeek: 0, daysSinceLastPost: null,
  })) as unknown as PersonaForMatch[]

  const batch = planBatch(q, personas)
  const assignOf = new Map(batch.assignments.map((a) => [a.queueId, a]))
  const runnerPick = pickPublishTarget({
    ordered: q.map((d) => ({ id: d.queueId })),
    assignedOf: (id) => assignOf.get(id)?.assigned ?? null,
  }).picked?.id ?? null

  const f = forecastPublishing({
    queue: q, personas, history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
    startAt: new Date('2026-09-08T15:05:00.000Z'), days: 1, dailyCap: 1,
  })
  const forecastPick = f.days[0]?.published[0]?.queueId ?? null

  check('🔴 맨 앞이 막혀도 예측이 하루를 버리지 않는다', forecastPick !== null)
  check('🔴 예측과 러너가 같은 글을 고른다', forecastPick === runnerPick && forecastPick === 'q1')
  check('🔴 막힌 맨 앞 글은 큐에서 사라지지 않는다 — 다음 날 다시 후보다', (() => {
    const two = forecastPublishing({
      queue: q, personas, history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
      startAt: new Date('2026-09-08T15:05:00.000Z'), days: 2, dailyCap: 1,
    })
    return two.days.every((d) => d.published.every((pb) => pb.queueId !== 'q0'))
  })())
  check('🔴 아무도 배정되지 않으면 발행 0 — 아무거나 내지 않는다', (() => {
    const none = forecastPublishing({
      queue: [blockedHead], personas, history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
      startAt: new Date('2026-09-08T15:05:00.000Z'), days: 3, dailyCap: 1,
    })
    return none.days.every((d) => d.published.length === 0)
      && none.days.every((d) => d.blockedReason === 'LIFE_BLOCKED')
  })())
}

// ④ 🔴 복구 행은 가상 발행해도 matchedAt 을 다시 더하지 않는다 (2026-09-07)
{
  const persona = {
    code: 'A', status: 'active', providerId: null, accountCount: 0,
    maritalStatus: '기혼', childrenCount: 0, childrenAgeBands: [] as string[],
    parentCare: '상시', menopauseStatus: '진행중', workStatus: null, economicStatus: null,
    region: null, noGoTopics: [] as string[], voiceLength: '중간',
    postsThisWeek: 0, daysSinceLastPost: null,
  } as unknown as PersonaForMatch
  const start = new Date('2026-09-08T15:05:00.000Z')
  // 🔴 A 는 이 행 때문에 이미 이번 주를 썼다 — matchedAt 이 이력에 있다
  const already = new Date('2026-09-08T00:00:00.000Z')
  const stuck: QueueCandidate = {
    queueId: 'stuck', title: '국수', body: '국수를 삶았어요.',
    gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: 'A', capturedAt: new Date('2026-09-07T15:05:00.000Z'),
  }
  const fresh: QueueCandidate = { queueId: 'fresh', title: '국수', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 1, assignedPersonaCode: null, capturedAt: new Date('2026-09-07T15:05:00.000Z') }

  const f = forecastPublishing({
    queue: [stuck, fresh], personas: [persona],
    history: [{ code: 'A', matchedAts: [already] }],
    // 🔴 A 의 주간 여력이 풀릴 때까지 봐야 차이가 드러난다. 7일이면 양쪽 다 발행 0 이라
    //    "같다" 가 참이 되어 fixture 가 헛돈다
    startAt: start, days: 12, dailyCap: 1,
  })
  const out = f.days.flatMap((d) => d.published)
  check('🔴 복구 행이 먼저 나간다', out[0]?.queueId === 'stuck' && out[0]?.persona === 'A')
  check('🔴 복구 행은 기존 배정 persona 로 나간다 — 재배정되지 않는다',
    out.every((pb) => pb.queueId !== 'stuck' || pb.persona === 'A'))

  // 🔴 matchedAt 을 중복으로 더했다면 A 의 여력이 한 번 더 줄어
  //    다음 글이 실제보다 늦게 나간다. 그 차이를 잡는다
  const noDup = forecastPublishing({
    queue: [fresh], personas: [persona],
    history: [{ code: 'A', matchedAts: [already] }],
    startAt: start, days: 12, dailyCap: 1,
  })
  const freshDayWith = f.days.findIndex((d) => d.published.some((pb) => pb.queueId === 'fresh'))
  const freshDayAlone = noDup.days.findIndex((d) => d.published.some((pb) => pb.queueId === 'fresh'))
  check('🔴 fixture 가 헛돌지 않는다 — 두 경우 모두 실제로 발행에 도달한다',
    freshDayWith !== -1 && freshDayAlone !== -1)
  check('🔴 복구 발행이 A 의 여력을 두 번 깎지 않는다', freshDayWith === freshDayAlone)

  // 🔴 예측이 쓰는 선택 함수에 복구 규칙이 함께 붙어 있다
  const libSrc = readFileSync('src/lib/supply-capacity-forecast.ts', 'utf-8')
  check('🔴 예측도 복구 우선 규칙을 그대로 쓴다', /isRecovery: \(id\) =>/.test(libSrc))
  check('🔴 복구 행은 이력에 다시 더하지 않는다', /if \(!plan\.recovery\) \{/.test(libSrc))
}

// ⑤ 🔴 DB 모양 입력 — supply-health 가 만드는 그대로를 넣어 본다 (2026-09-07)
//
//    관제는 `matchedPersonaId`(id) 를 code 로 바꿔 `assignedPersonaCode` 로 넘긴다.
//    여기서는 그 변환 결과와 **같은 모양**을 만들어 행동을 고정한다.
{
  const mkPersona = (code: string, over: Record<string, unknown> = {}): PersonaForMatch => ({
    code, status: 'active', providerId: null, accountCount: 0,
    maritalStatus: '기혼', childrenCount: 0, childrenAgeBands: [] as string[],
    parentCare: '상시', menopauseStatus: '진행중', workStatus: null, economicStatus: null,
    region: null, noGoTopics: [] as string[], voiceLength: '중간',
    postsThisWeek: 0, daysSinceLastPost: null, ...over,
  } as unknown as PersonaForMatch)

  /** 🔴 관제의 변환을 그대로 흉내낸다 — id 를 못 찾으면 `__unknown:` 이다 */
  const codeOfId = new Map([['pid_A', 'A'], ['pid_B', 'B'], ['pid_OFF', 'OFF'], ['pid_REAL', 'REAL']])
  const asHealthDoes = (rows: readonly { id: string; matchedPersonaId: string | null; title?: string }[]): QueueCandidate[] =>
    rows.map((r, i) => ({
      queueId: r.id, title: r.title ?? '국수', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: i,
      capturedAt: new Date('2026-09-07T15:05:00.000Z'),
      assignedPersonaCode: r.matchedPersonaId === null
        ? null
        : (codeOfId.get(r.matchedPersonaId) ?? `__unknown:${r.matchedPersonaId}`),
    }))

  const START = new Date('2026-09-08T15:05:00.000Z')
  const ALREADY = new Date('2026-09-08T00:00:00.000Z')

  // ── A. 정상 기배정 행 → 기존 persona 로 복구 우선 ──
  {
    const queue = asHealthDoes([
      { id: 'stuck', matchedPersonaId: 'pid_A' },
      { id: 'fresh', matchedPersonaId: null },
    ])
    const f = forecastPublishing({
      queue, personas: [mkPersona('A'), mkPersona('B')],
      history: [{ code: 'A', matchedAts: [ALREADY] }, { code: 'B', matchedAts: [] }],
      startAt: START, days: 12, dailyCap: 1,
    })
    const first = f.days.flatMap((d) => d.published)[0]
    check('🔴 [A] DB 모양 기배정 행이 기존 persona 로 먼저 나간다',
      first?.queueId === 'stuck' && first?.persona === 'A')
    // 🔴 nextPersonaCandidates 가 빈 배열로 거짓 표시되지 않는다
    check('🔴 [A] 복구 행의 다음 후보가 빈 배열로 거짓 표시되지 않는다',
      f.nextQueueId === 'stuck' && f.nextPersonaCandidates.join(',') === 'A')
    check('🔴 [A] 복구 행은 배정 가능으로 보고된다', f.nextScheduleWillPublish)
    check('🔴 [A] 깨진 복구는 없다', f.recoveryBroken.length === 0)
  }

  // ── B. 복구 발행 후 matchedAt 이중 추가 0 ──
  {
    const withStuck = forecastPublishing({
      queue: asHealthDoes([{ id: 'stuck', matchedPersonaId: 'pid_A' }, { id: 'fresh', matchedPersonaId: null }]),
      personas: [mkPersona('A')],
      history: [{ code: 'A', matchedAts: [ALREADY] }],
      startAt: START, days: 12, dailyCap: 1,
    })
    const alone = forecastPublishing({
      queue: asHealthDoes([{ id: 'fresh', matchedPersonaId: null }]),
      personas: [mkPersona('A')],
      history: [{ code: 'A', matchedAts: [ALREADY] }],
      startAt: START, days: 12, dailyCap: 1,
    })
    const dayOf = (f: typeof withStuck): number => f.days.findIndex((d) => d.published.some((p) => p.queueId === 'fresh'))
    check('🔴 [B] fixture 가 헛돌지 않는다 — 두 경우 모두 fresh 가 실제로 나간다',
      dayOf(withStuck) !== -1 && dayOf(alone) !== -1)
    check('🔴 [B] 복구 발행이 A 의 여력을 두 번 깎지 않는다', dayOf(withStuck) === dayOf(alone))
  }

  // ── C. 깨진 복구 + 정상 신규 후보 → 우회하지 않고 RECOVERY_BROKEN ──
  {
    const cases: [string, QueueCandidate[]][] = [
      ['없는 persona', asHealthDoes([{ id: 'gone', matchedPersonaId: 'pid_MISSING' }, { id: 'fresh', matchedPersonaId: null }])],
      ['비활성 persona', asHealthDoes([{ id: 'off', matchedPersonaId: 'pid_OFF' }, { id: 'fresh', matchedPersonaId: null }])],
      ['실계정 persona', asHealthDoes([{ id: 'real', matchedPersonaId: 'pid_REAL' }, { id: 'fresh', matchedPersonaId: null }])],
    ]
    const personas = [
      mkPersona('A'),
      mkPersona('OFF', { status: 'draft' }),
      mkPersona('REAL', { providerId: 'kakao:1' }),
    ]
    for (const [name, queue] of cases) {
      const f = forecastPublishing({
        queue, personas, history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
        startAt: START, days: 14, dailyCap: 1,
      })
      // 🔴 신규 후보(fresh)가 배정 가능한데도 우회해서 내지 않는다 — 러너가 멈추기 때문이다
      check(`🔴 [C] ${name}: 신규 후보로 우회하지 않는다 — 발행 0`,
        f.days.every((d) => d.published.length === 0) && f.in7 === 0 && f.in14 === 0)
      check(`🔴 [C] ${name}: 사유가 RECOVERY_BROKEN 이다`,
        f.days.every((d) => d.blockedReason === ('RECOVERY_BROKEN' satisfies BlockReason))
        && f.nextBlockReason === 'RECOVERY_BROKEN')
      check(`🔴 [C] ${name}: 어느 행인지 말한다`, f.recoveryBroken.length === 1)
      check(`🔴 [C] ${name}: 관제가 CRITICAL 로 본다`, judgeCapacity({
        stockUsable: 14, in7: f.in7, nextWillPublish: f.nextScheduleWillPublish,
        nextCandidates: f.nextPersonaCandidates.length, shortfallMin: 0, dailyCap: 1,
        recoveryBroken: f.recoveryBroken,
      }).some((x) => x.level === 'CRITICAL' && x.code === 'RECOVERY_BROKEN'))
    }
    // 🔴 우회했다면 fresh 가 나갔을 것이다 — 그 대조군으로 fixture 가 헛돌지 않음을 보인다
    const onlyFresh = forecastPublishing({
      queue: asHealthDoes([{ id: 'fresh', matchedPersonaId: null }]),
      personas, history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
      startAt: START, days: 14, dailyCap: 1,
    })
    check('🔴 [C] 대조군: 깨진 복구가 없으면 fresh 는 나간다 — fixture 가 헛돌지 않는다', onlyFresh.in7 > 0)
  }

  // ── D. 기배정 없는 현재 정상 경로 수치 회귀 0 ──
  {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}`, matchedPersonaId: null }))
    const personas = ['A', 'B', 'C'].map((c) => mkPersona(c))
    const history = personas.map((p) => ({ code: p.code, matchedAts: [] as Date[] }))
    // 🔴 관제가 만드는 모양(assignedPersonaCode: null 이 붙은 것) 과
    //    그 필드가 아예 없는 옛 모양이 **같은 결과**여야 한다
    const withField = forecastPublishing({ queue: asHealthDoes(rows), personas, history, startAt: START, days: 14, dailyCap: 1 })
    const withoutField = forecastPublishing({
      queue: rows.map((r, i) => ({ queueId: r.id, title: '국수', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null, capturedAt: new Date('2026-09-07T15:05:00.000Z') })),
      personas, history, startAt: START, days: 14, dailyCap: 1,
    })
    const sig = (f: typeof withField): string =>
      `${f.in7}/${f.in14}/${f.nextQueueId}/${f.nextPersonaCandidates.join('|')}/${f.days.map((d) => d.published.map((p) => `${d.date}:${p.queueId}:${p.persona}`).join(';')).join(',')}`
    check('🔴 [D] 기배정이 없으면 수치가 예전과 완전히 같다', sig(withField) === sig(withoutField))
    check('🔴 [D] 깨진 복구도 없다', withField.recoveryBroken.length === 0)
    check('🔴 [D] 대조군이 실제로 발행한다 — 빈 비교가 아니다', withField.in7 > 0)
  }
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
