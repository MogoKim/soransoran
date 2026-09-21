#!/usr/bin/env tsx
/**
 * 화자 여력 계획 **행동 검사** — 🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0
 *
 * 🔴 **무엇을 잠그는가.**
 *
 *    실측(2026-09-21 회차): 새 후보 2건이 **둘 다 P01** 이었다.
 *    발행 쪽 최소 간격 때문에 9/23 예측이 `CAPACITY_WAIT` 로 **2/3** 에 멈췄다 —
 *    그날 쓸 수 있는 화자가 20명이었는데도. 글이 아니라 **화자가 겹친 것**이다.
 *
 *    아래는 그 상태를 **실제 발행 예측기**(`forecastPublishing`)로 재현하고,
 *    다른 적격 화자의 글이 하나 들어오면 3/3 이 되는 것을 값으로 보인다.
 *    🔴 자격 없는 화자·간격 위반은 여전히 막히는지도 같은 함수로 확인한다.
 */
import {
  planSpeakerAvailability, remainingCapacity,
} from '../src/lib/content-core/speaker-availability'
import {
  readSpeakerLoad, draftSpeakerOf,
} from '../src/lib/content-core/speaker-load-file'
import { readFileSync } from 'node:fs'
import { forecastPublishing } from '../src/lib/supply-capacity-forecast'
import { PROFILES } from '../src/lib/scale-profile'
import type { QueueCandidate } from '../src/lib/supply-candidates'
import type { PersonaForMatch } from '../src/lib/original-post-persona-match'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log('\n══ 화자 여력 계획 검사 (🔴 DB 0 · 네트워크 0 · LLM 0) ══\n')

const d3 = PROFILES.d3
const CAPS = { postsPerWeek: d3.postsPerWeek, minDaysBetween: d3.minDaysBetween }
const START = new Date('2026-09-22T15:00:00.000Z') // 2026-09-23 00:00 KST

const personaOf = (code: string): PersonaForMatch => ({
  code, status: 'active', providerId: null, accountCount: 0,
  maritalStatus: '기혼', childrenCount: 0, childrenAgeBands: [] as string[],
  parentCare: '상시', menopauseStatus: '진행중', workStatus: null, economicStatus: null,
  region: null, noGoTopics: [] as string[], voiceLength: '중간',
  postsThisWeek: 0, daysSinceLastPost: null,
} as unknown as PersonaForMatch)

/**
 * 🔴 **화자가 못박힌 기계 글.** 생성된 글은 그 사람의 말투로 쓰였으므로 남에게 넘길 수 없다 —
 *    `voice.personaCode` 가 그 결속이다. 발행기는 이것을 무시하고 재배정하지 않는다.
 */
const candOf = (id: string, speaker: string, n: number): QueueCandidate => ({
  queueId: id, title: `국수 이야기 ${n}`,
  body: '어제 국수를 삶아 먹었습니다. 별것 아닌데 오래 생각났어요.',
  gateVerdict: 'PASS', createdAt: n, assignedPersonaCode: null,
  capturedAt: new Date('2026-09-20T00:00:00.000Z'),
  // 🔴 이 글은 그 사람의 말투로 쓰였다 — 발행기가 남의 이름을 붙이지 않는 근거다
  voice: { personaCode: speaker, comments: 3, bundleDigest: 'x', sourceDigest: 'y' },
  profile: 'machine' as const,
})

const forecast = (queue: readonly QueueCandidate[], personas: readonly PersonaForMatch[]) =>
  forecastPublishing({
    queue, personas,
    history: personas.map((p) => ({ code: p.code, matchedAts: [] as Date[] })),
    startAt: START, days: 1, dailyCap: d3.dailyTarget, caps: CAPS,
  })

// ─────────────────────────────────────────────────────────
console.log('① 🔴 🔴 실측 재현 — P01 글 2건 + P06 글 1건은 9/23 에 2/3')
// ─────────────────────────────────────────────────────────
{
  const queue = [candOf('a', 'P01', 1), candOf('b', 'P01', 2), candOf('c', 'P06', 3)]
  const personas = ['P01', 'P06', 'P07', 'P10'].map(personaOf)
  const f = forecast(queue, personas)
  const day = f.days[0]!
  check('🔴 🔴 **같은 화자 2건은 하루에 한 편만 나간다 — 2/3**',
    day.published.length === 2 && day.date === '2026-09-23',
    JSON.stringify({ 발행: day.published, 날짜: day.date, 사유: day.blockedReason }))
  check('🔴 막힌 사유는 `CAPACITY_WAIT` 다 — 후보가 없는 것이 아니다',
    day.blockedReason === 'CAPACITY_WAIT', String(day.blockedReason))
  check('🔴 쓸 수 있던 화자는 넉넉했다 — 사람이 모자란 것이 아니다',
    day.availableCodes.length >= 4, String(day.availableCodes.length))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 다른 적격 화자의 글이 들어오면 3/3')
// ─────────────────────────────────────────────────────────
{
  const queue = [candOf('a', 'P01', 1), candOf('b', 'P07', 2), candOf('c', 'P06', 3)]
  const personas = ['P01', 'P06', 'P07', 'P10'].map(personaOf)
  const day = forecast(queue, personas).days[0]!
  check('🔴 🔴 **화자가 셋이면 9/23 에 3/3**',
    day.published.length === 3
    && new Set(day.published.map((p) => p.persona)).size === 3,
    JSON.stringify(day.published))
  check('🔴 한 사람이 두 편을 쓰지 않는다',
    day.published.every((p, i, arr) => arr.filter((x) => x.persona === p.persona).length === 1))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 🔴 자격 없는 화자·간격 위반은 여전히 막힌다')
// ─────────────────────────────────────────────────────────
{
  /** 🔴 글의 화자가 pool 에 없다 — 발행기가 우회해 다른 이름을 붙이지 않는다 */
  const orphan = forecastPublishing({
    queue: [candOf('a', 'P99', 1)],
    personas: [personaOf('P01')],
    history: [{ code: 'P01', matchedAts: [] as Date[] }],
    startAt: START, days: 1, dailyCap: d3.dailyTarget, caps: CAPS,
  })
  check('🔴 🔴 **없는 화자의 글은 나가지 않는다 — 다른 사람 이름을 붙이지 않는다**',
    orphan.days[0]!.published.length === 0,
    JSON.stringify(orphan.days[0]!.published))

  /** 🔴 어제 쓴 사람은 오늘 못 쓴다 (최소 2일) */
  const tooSoon = forecastPublishing({
    queue: [candOf('a', 'P01', 1)],
    personas: [personaOf('P01')],
    history: [{ code: 'P01', matchedAts: [new Date('2026-09-22T00:30:00.000Z')] }],
    startAt: START, days: 1, dailyCap: d3.dailyTarget, caps: CAPS,
  })
  check('🔴 🔴 **최소 간격을 어기며 내보내지 않는다**',
    tooSoon.days[0]!.published.length === 0
    && tooSoon.days[0]!.blockedReason === 'CAPACITY_WAIT',
    String(tooSoon.days[0]!.blockedReason))

  /** 🔴 주간 상한을 채운 사람도 못 쓴다 */
  const weekFull = forecastPublishing({
    queue: [candOf('a', 'P01', 1)],
    personas: [personaOf('P01')],
    history: [{ code: 'P01', matchedAts: [
      new Date('2026-09-17T00:30:00.000Z'),
      new Date('2026-09-19T00:30:00.000Z'),
      new Date('2026-09-21T00:30:00.000Z'),
    ] }],
    startAt: START, days: 1, dailyCap: d3.dailyTarget, caps: CAPS,
  })
  check('🔴 주 상한을 채운 화자도 막힌다',
    weekFull.days[0]!.published.length === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 🔴 계획이 회차 안에서 화자를 겹치지 않게 나눈다')
// ─────────────────────────────────────────────────────────
{
  const cap = (code: string, openDays: number, readyCount = 0) => ({ code, openDays, readyCount })
  const plan = planSpeakerAvailability({
    sourceKeys: ['s1', 's2', 's3'],
    capacities: [cap('P01', 3), cap('P02', 3), cap('P03', 3), cap('P04', 3), cap('P05', 3), cap('P06', 3)],
  })
  const all = plan.slots.flatMap((s) => s.codes)
  check('🔴 🔴 **원천끼리 화자가 겹치지 않는다**',
    new Set(all).size === all.length, JSON.stringify(plan.slots))
  check('🔴 모든 원천이 고를 사람을 받는다',
    plan.slots.every((s) => s.codes.length > 0))

  /** 🔴 이미 재고를 들고 있으면 여력이 줄고, 다 차면 빠진다 */
  check('🔴 🔴 **이미 재고가 있으면 여력이 줄어든다**',
    remainingCapacity(cap('P01', 3, 1)) === 2 && remainingCapacity(cap('P01', 3, 3)) === 0)
  const saturated = planSpeakerAvailability({
    sourceKeys: ['s1'],
    capacities: [cap('P01', 2, 2), cap('P02', 2, 0)],
  })
  check('🔴 🔴 **여력이 0 인 화자는 후보에서 빠진다**',
    saturated.eligible.join(',') === 'P02'
    && saturated.slots[0]!.codes.join(',') === 'P02',
    JSON.stringify(saturated.eligible))

  /** 🔴 아무도 여력이 없으면 억지로 주지 않고 보류한다 */
  const none = planSpeakerAvailability({
    sourceKeys: ['s1', 's2'],
    capacities: [cap('P01', 1, 1), cap('P02', 0, 0)],
  })
  check('🔴 🔴 **여력 있는 화자가 없으면 보류한다 — 억지로 주지 않는다**',
    none.slots.every((s) => s.codes.length === 0)
    && none.notes.some((n) => n.includes('보류')),
    JSON.stringify(none.slots))

  /** 🔴 원천이 화자보다 많으면 일부는 이 회차에 만들지 않는다 */
  const tight = planSpeakerAvailability({
    sourceKeys: ['s1', 's2', 's3'],
    capacities: [cap('P01', 1), cap('P02', 1)],
  })
  check('🔴 화자가 모자라면 그 사실을 적고 일부를 보류한다',
    tight.slots.filter((s) => s.codes.length === 0).length === 1
    && tight.notes.some((n) => n.includes('원천')),
    JSON.stringify(tight.slots.map((s) => s.codes)))

  /** 🔴 같은 입력이면 같은 결과 — 계약·캐시가 흔들리지 않는다 */
  const again = planSpeakerAvailability({
    sourceKeys: ['s1', 's2', 's3'],
    capacities: [cap('P01', 3), cap('P02', 3), cap('P03', 3), cap('P04', 3), cap('P05', 3), cap('P06', 3)],
  })
  check('🔴 🔴 **같은 입력이면 같은 계획이다 (캐시가 흔들리지 않는다)**',
    again.identity === plan.identity, `${again.identity} vs ${plan.identity}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 여력 파일 — 무료 회차만 좁히지 않고 지나간다')
// ─────────────────────────────────────────────────────────
{
  const NOW = new Date('2026-09-22T03:00:00.000Z')
  const missing = readSpeakerLoad(null, NOW)
  check('🔴 🔴 **못 읽으면 그 사실과 사유를 값으로 남긴다**',
    missing.loaded === false && missing.problem === 'missing'
    && missing.describe.includes('화자 여력을 쓸 수 없다'))

  const good = readSpeakerLoad({
    writtenAt: '2026-09-22T02:30:00.000Z', horizonDays: 7,
    byCode: { P01: { openDays: 3, readyCount: 2 }, P02: { openDays: 3, readyCount: 0 } },
  }, NOW)
  check('🔴 읽으면 그 값을 그대로 쓴다',
    good.loaded && good.openDaysOf('P01') === 3 && good.readyCountOf('P01') === 2)
  check('🔴 🔴 **모르는 화자는 여력 0 이다 — 1 로 보정하지 않는다**',
    good.openDaysOf('P99') === 0)
  check('🔴 모양이 어긋난 파일은 읽은 것으로 치지 않는다',
    readSpeakerLoad({ writtenAt: 1, horizonDays: 7, byCode: {} }, NOW).loaded === false
    && readSpeakerLoad({ writtenAt: 'x', horizonDays: 0, byCode: {} }, NOW).loaded === false
    && readSpeakerLoad({ writtenAt: 'x', horizonDays: 7, byCode: { P01: { openDays: -1, readyCount: 0 } } }, NOW).loaded === false)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 🔴 미배정 READY 의 화자를 재고로 센다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측 재현.** 2026-09-21 회차의 P01 글 2건은 `matchedPersonaId = null` 이었다.
   *    배정된 행만 세던 앞판은 그 둘을 **한 건도 세지 않았고**, 그래서 P01 이
   *    여력이 가득한 것처럼 보였다. 화자는 `autoDraft.voice.personaCode` 에 있다.
   */
  const row = (speaker: string | null) => ({
    autoDraft: speaker === null ? undefined : { voice: { personaCode: speaker, comments: 3 } },
  })
  check('🔴 🔴 **배정 전 READY 의 화자를 gateResults 에서 읽는다**',
    draftSpeakerOf(row('P01')) === 'P01' && draftSpeakerOf(row(null)) === null)
  check('🔴 모양이 아니면 null 이다 — 아무에게나 얹지 않는다',
    draftSpeakerOf(null) === null && draftSpeakerOf({ autoDraft: { voice: {} } }) === null
    && draftSpeakerOf({ autoDraft: { voice: { personaCode: '  ' } } }) === null)

  /** 🔴 그 둘을 세면 P01 의 여력이 실제로 줄어든다 */
  const withoutCount = planSpeakerAvailability({
    sourceKeys: ['s1'],
    capacities: [{ code: 'P01', openDays: 2, readyCount: 0 },
      { code: 'P02', openDays: 2, readyCount: 0 }],
  })
  const withCount = planSpeakerAvailability({
    sourceKeys: ['s1'],
    // 🔴 P01 이 이미 2건을 들고 있다 — 실측 그대로
    capacities: [{ code: 'P01', openDays: 2, readyCount: 2 },
      { code: 'P02', openDays: 2, readyCount: 0 }],
  })
  check('🔴 🔴 **P01 글 2건을 세면 P01 이 후보에서 빠진다**',
    withoutCount.eligible.includes('P01') && !withCount.eligible.includes('P01')
    && withCount.eligible.join(',') === 'P02',
    `${withoutCount.eligible.join(',')} → ${withCount.eligible.join(',')}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 🔴 여력 파일 — 오래되거나 깨지면 쓰지 않는다')
// ─────────────────────────────────────────────────────────
{
  const NOW = new Date('2026-09-22T03:00:00.000Z')
  const ok = readSpeakerLoad({
    writtenAt: '2026-09-22T02:00:00.000Z', horizonDays: 7,
    byCode: { P01: { openDays: 3, readyCount: 1 } },
  }, NOW)
  check('🔴 한 시간 전 기록은 쓴다', ok.loaded && ok.problem === null)

  const stale = readSpeakerLoad({
    writtenAt: '2026-09-21T02:00:00.000Z', horizonDays: 7,
    byCode: { P01: { openDays: 3, readyCount: 1 } },
  }, NOW)
  check('🔴 🔴 **하루 전 기록은 쓰지 않는다 — 재고가 그 사이 바뀐다**',
    stale.loaded === false && stale.problem === 'stale', String(stale.problem))

  const future = readSpeakerLoad({
    writtenAt: '2026-09-23T02:00:00.000Z', horizonDays: 7, byCode: {},
  }, NOW)
  check('🔴 미래 시각도 쓰지 않는다', future.loaded === false && future.problem === 'stale')

  check('🔴 없으면 missing · 깨졌으면 malformed 로 갈린다',
    readSpeakerLoad(null, NOW).problem === 'missing'
    && readSpeakerLoad({ writtenAt: 1 }, NOW).problem === 'malformed')

  /** 🔴 유료 생성은 이 값을 보고 멈춘다 — 러너가 그렇게 배선돼 있다 */
  const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 🔴 **유료 회차는 여력 없이 돌지 않는다**',
    /if \(CALL && !speakerLoad\.loaded\)/.test(src) && /process\.exit\(1\)/.test(src))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0\n')
if (fail > 0) process.exit(1)
