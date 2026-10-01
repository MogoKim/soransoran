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
 *    아래는 그 상태를 **정본 슬롯 매칭**(`matchOpportunitiesToSlots` — 공급 러너 · 관제의 JIT 수요와 같은 함수 ·
 *    기회 모양은 `readyOpportunitiesOf` 와 같다)으로 재현하고, 다른 적격 화자의 글이 하나 들어오면 3/3 이 되는 것을
 *    값으로 보인다. 🔴 자격 없는 화자 · 간격 위반은 여전히 막히는지도 같은 함수로 확인한다.
 *    (2026-09-30 · 14일 발행 예측기 `forecastPublishing` 삭제 — 같은 질문을 정본 매칭으로 옮겼다)
 */
import {
  planSpeakerAvailability, remainingCapacity, planOpenDays,
} from '../src/lib/content-core/speaker-availability'
import {
  readSpeakerLoad, draftSpeakerOf,
} from '../src/lib/content-core/speaker-load-file'
import { readFileSync } from 'node:fs'
import { PROFILES } from '../src/lib/scale-profile'
import { availablePersonasAt, type PersonaHistory } from '../src/lib/supply-capacity-forecast'
import { judgeSlotRelease, matchOpportunitiesToSlots, type SlotOpportunity } from '../src/lib/source-slot-release'
import { slotTimesOn } from '../src/lib/stage-ladder-generic'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'

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

/** 🔴 9/23 d3 증명일 슬롯 — 정본 슬롯 표(`slotTimesOn`) */
const SLOTS = slotTimesOn('2026-09-23', d3)

/**
 * 🔴 **화자가 못박힌 기계 글 = 기회 하나.** 생성된 글은 그 사람의 말투로 쓰였으므로 남에게 넘길 수 없다 —
 *    `personaCode` 가 그 결속이다. 기회의 모양은 `readyOpportunitiesOf` 와 같다: 그 슬롯에 화자가 비어 있고
 *    (`availablePersonasAt` — 주간 상한 · 최소 간격) 정본 공개 판정이 eligible 이어야 그 슬롯에 유효하다.
 */
const oppOf = (id: string, speaker: string, history: readonly PersonaHistory[]): SlotOpportunity => {
  const gateResults = fakeEvidenceGate(START, { id })
  return {
    key: id, personaCode: speaker,
    validAt: (slotAt) => {
      const free = availablePersonasAt(history, slotAt, CAPS).includes(speaker)
      return judgeSlotRelease({
        gateResults, slotAt, now: START, hardGates: { ok: true, codes: [] },
        assignment: free ? { ok: true } : { ok: false, route: 'defer', codes: ['PERSONA_NOT_FREE_AT_SLOT'] },
        tieBreak: id,
      }).verdict === 'eligible'
    },
  }
}
const fresh = (codes: readonly string[]): PersonaHistory[] => codes.map((code) => ({ code, matchedAts: [] as Date[] }))
const keysOf = (bySlot: readonly (string | null)[]): string[] => bySlot.filter((k): k is string => k !== null)

// ─────────────────────────────────────────────────────────
console.log(`① 🔴 🔴 실측 재현 — P01 글 2건 + P06 글 1건은 9/23 에 2/${SLOTS.length}`)
// ─────────────────────────────────────────────────────────
{
  const hist = fresh(['P01', 'P06', 'P07', 'P10'])
  const m = matchOpportunitiesToSlots(SLOTS, [oppOf('a', 'P01', hist), oppOf('b', 'P01', hist), oppOf('c', 'P06', hist)])
  check('fixture 전제 — d3 증명일 슬롯이 3개다', SLOTS.length === 3, String(SLOTS.length))
  check('🔴 🔴 **같은 화자 2건은 하루에 한 편만 나간다 — 2/3**',
    m.filled === 2 && keysOf(m.bySlot).filter((k) => k === 'a' || k === 'b').length === 1, JSON.stringify(m))
  check('🔴 쓸 수 있던 화자는 넉넉했다 — 사람이 모자란 것이 아니다',
    availablePersonasAt(hist, SLOTS[0]!, CAPS).length >= 4)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 다른 적격 화자의 글이 들어오면 3/3')
// ─────────────────────────────────────────────────────────
{
  const hist = fresh(['P01', 'P06', 'P07', 'P10'])
  const m = matchOpportunitiesToSlots(SLOTS, [oppOf('a', 'P01', hist), oppOf('b', 'P07', hist), oppOf('c', 'P06', hist)])
  check('🔴 🔴 **화자가 셋이면 9/23 에 3/3**', m.filled === 3 && new Set(keysOf(m.bySlot)).size === 3, JSON.stringify(m))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 🔴 자격 없는 화자·간격 위반은 여전히 막힌다')
// ─────────────────────────────────────────────────────────
{
  /** 🔴 글의 화자가 pool 에 없다 — 매칭이 우회해 다른 이름을 붙이지 않는다 */
  const orphan = matchOpportunitiesToSlots(SLOTS, [oppOf('a', 'P99', fresh(['P01']))])
  check('🔴 🔴 **없는 화자의 글은 나가지 않는다 — 다른 사람 이름을 붙이지 않는다**', orphan.filled === 0, JSON.stringify(orphan))

  /** 🔴 어제 쓴 사람은 오늘 못 쓴다 (최소 간격) */
  const tooSoon = matchOpportunitiesToSlots(SLOTS, [oppOf('a', 'P01',
    [{ code: 'P01', matchedAts: [new Date('2026-09-22T00:30:00.000Z')] }])])
  check('🔴 🔴 **최소 간격을 어기며 내보내지 않는다**', tooSoon.filled === 0, JSON.stringify(tooSoon))

  /** 🔴 주간 상한을 채운 사람도 못 쓴다 */
  const weekFull = matchOpportunitiesToSlots(SLOTS, [oppOf('a', 'P01', [{ code: 'P01', matchedAts: [
    new Date('2026-09-17T00:30:00.000Z'), new Date('2026-09-19T00:30:00.000Z'), new Date('2026-09-21T00:30:00.000Z'),
  ] }])])
  check('🔴 주 상한을 채운 화자도 막힌다', weekFull.filled === 0)

  /** 🔴 반례의 짝 — 이력이 비면 같은 글이 나간다(막힌 이유가 화자 여력이다) */
  check('🟢 같은 글 · 빈 이력이면 나간다', matchOpportunitiesToSlots(SLOTS, [oppOf('a', 'P01', fresh(['P01']))]).filled === 1)
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
  /**
   * 🔴 **겹침의 기준은 여력이다.** 여력이 1일인 사람은 한 원천에만 가고,
   *    3일인 사람은 **다른 날에** 세 편까지 쓸 수 있으므로 세 원천까지 갈 수 있다.
   *    같은 날 두 편이 되지 않게 하는 것이 목적이지, 사람을 한 번만 쓰는 것이 아니다.
   */
  const countOf = (code: string) => plan.slots.filter((sl) => sl.codes.includes(code)).length
  check('🔴 🔴 **여력 1일인 화자는 한 원천에만 간다**', (() => {
    const one = planSpeakerAvailability({
      sourceKeys: ['s1', 's2', 's3'],
      capacities: [cap('P01', 1), cap('P02', 1), cap('P03', 1)],
    })
    const flat = one.slots.flatMap((sl) => sl.codes)
    return new Set(flat).size === flat.length && flat.length === 3
  })())
  check('🔴 여력이 남는 화자는 여러 원천을 맡을 수 있다',
    countOf('P01') >= 1 && plan.slots.every((sl) => sl.codes.length > 0))
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
    writtenAt: '2026-09-22T02:30:00.000Z', runId: 'R', horizonDays: 7,
    byCode: { P01: { openDays: 3, readyCount: 2 }, P02: { openDays: 3, readyCount: 0 } },
  }, NOW)
  check('🔴 읽으면 그 값을 그대로 쓴다',
    good.loaded && good.openDaysOf('P01') === 3 && good.readyCountOf('P01') === 2)
  check('🔴 🔴 **모르는 화자는 여력 0 이다 — 1 로 보정하지 않는다**',
    good.openDaysOf('P99') === 0)
  check('🔴 모양이 어긋난 파일은 읽은 것으로 치지 않는다',
    readSpeakerLoad({ writtenAt: 1, runId: 'R', horizonDays: 7, byCode: {} }, NOW).loaded === false
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
    writtenAt: '2026-09-22T02:00:00.000Z', runId: 'R', horizonDays: 7,
    byCode: { P01: { openDays: 3, readyCount: 1 } },
  }, NOW)
  check('🔴 한 시간 전 기록은 쓴다', ok.loaded && ok.problem === null)

  const stale = readSpeakerLoad({
    writtenAt: '2026-09-21T02:00:00.000Z', runId: 'R', horizonDays: 7,
    byCode: { P01: { openDays: 3, readyCount: 1 } },
  }, NOW)
  check('🔴 🔴 **하루 전 기록은 쓰지 않는다 — 재고가 그 사이 바뀐다**',
    stale.loaded === false && stale.problem === 'stale', String(stale.problem))

  const future = readSpeakerLoad({
    writtenAt: '2026-09-23T02:00:00.000Z', runId: 'R', horizonDays: 7, byCode: {},
  }, NOW)
  check('🔴 미래 시각도 쓰지 않는다', future.loaded === false && future.problem === 'stale')

  check('🔴 없으면 missing · 깨졌으면 malformed 로 갈린다',
    readSpeakerLoad(null, NOW).problem === 'missing'
    && readSpeakerLoad({ writtenAt: 1, runId: 'R' }, NOW).problem === 'malformed')

  /** 🔴 유료 생성은 이 값을 보고 멈춘다 — 러너가 그렇게 배선돼 있다 */
  const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 🔴 **유료 회차는 여력 없이 돌지 않는다**',
    /if \(CALL && !speakerLoad\.loaded\)/.test(src) && /process\.exit\(1\)/.test(src))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 🔴 여력 계산 — 코드순 첫 화자에게 몰아주지 않는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측한 결함.** 앞판은 날마다 `availablePersonasAt(...).slice(0, dailyTarget)`
   *    를 썼다. 그 목록은 **코드순**이라 d1(하루 1편) 7일이면 **P01 이 7일을 다
   *    가져가고** P02·P03 은 0 이었다 — 주간 상한(1건)도 최소 간격(5일)도
   *    그 사람에게 실제로는 걸리는데, 자리를 세는 쪽이 그것을 몰랐다.
   */
  const KST = (d: number) => new Date(Date.UTC(2026, 8, 21 + d, 15, 0))
  const days7 = Array.from({ length: 7 }, (_, i) => KST(i))
  const label = (at: Date) => new Date(at.getTime() + 9 * 36e5).toISOString().slice(0, 10)
  const empty = ['P01', 'P02', 'P03'].map((code) => ({ code, matchedAts: [] as Date[] }))
  const availAt = (h: readonly { code: string; matchedAts: readonly Date[] }[],
    at: Date, caps: { postsPerWeek: number; minDaysBetween: number }) =>
    availablePersonasAt(h.map((x) => ({ code: x.code, matchedAts: [...x.matchedAts] })), at, caps)
  const d1 = PROFILES.d1
  const d3p = PROFILES.d3
  const capsOf = (p: typeof d1) => ({
    dailyTarget: p.dailyTarget, postsPerWeek: p.postsPerWeek, minDaysBetween: p.minDaysBetween,
  })

  const p1 = planOpenDays({
    days: days7, profileOf: () => capsOf(d1),
    history: empty, availableAt: availAt, dateLabel: label,
  })
  const got = ['P01', 'P02', 'P03'].map((c) => p1.openDays.get(c) ?? 0)
  check('🔴 🔴 **d1 7일 — P01 이 7일을 독식하지 않는다**',
    got[0]! < 7, `P01 ${got[0]} · P02 ${got[1]} · P03 ${got[2]}`)
  check('🔴 🔴 **주 1건 · 최소 5일이 실제로 걸린다**',
    got.every((n) => n <= 2), got.join(','))
  check('🔴 세 사람에게 골고루 간다',
    got.filter((n) => n > 0).length === 3, got.join(','))
  check('🔴 🔴 **하루 상한을 넘겨 세지 않는다**',
    p1.byDate.every((d) => d.codes.length <= d1.dailyTarget
      && new Set(d.codes).size === d.codes.length),
    JSON.stringify(p1.byDate))

  const booked = planOpenDays({
    days: days7, profileOf: () => capsOf(d1),
    history: [{ code: 'P01', matchedAts: [KST(0)] }, ...empty.slice(1)],
    availableAt: availAt, dateLabel: label,
  })
  check('🔴 🔴 **이미 예정한 배정을 반영한다 — 그 사람은 그만큼 덜 받는다**',
    (booked.openDays.get('P01') ?? 0) < (p1.openDays.get('P01') ?? 0),
    `예정 전 ${p1.openDays.get('P01')} → 예정 후 ${booked.openDays.get('P01')}`)

  const mixed = planOpenDays({
    days: days7,
    profileOf: (at) => (label(at) === '2026-09-22' ? capsOf(d3p) : capsOf(d1)),
    history: ['P01', 'P02', 'P03', 'P04', 'P05'].map((code) => ({ code, matchedAts: [] as Date[] })),
    availableAt: availAt, dateLabel: label,
  })
  const d22 = mixed.byDate.find((d) => d.date === '2026-09-22')
  const d23 = mixed.byDate.find((d) => d.date === '2026-09-23')
  check('🔴 🔴 **9/22 는 canary d3 — 자리 3개**',
    d22?.codes.length === 3, JSON.stringify(d22))
  check('🔴 🔴 **9/23 은 기본 d1 — 자리 1개**',
    d23?.codes.length === 1, JSON.stringify(d23))
  check('🔴 9/22 의 세 사람은 서로 다르다', new Set(d22?.codes ?? []).size === 3)
  check('🔴 🔴 **9/22 에 쓴 사람은 9/23 에 다시 쓰지 않는다 (최소 간격)**',
    d22 !== undefined && d23 !== undefined && !d22.codes.includes(d23.codes[0] ?? ''),
    `${JSON.stringify(d22?.codes)} → ${JSON.stringify(d23?.codes)}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 🔴 🔴 회차가 다른 기록은 쓰지 않는다')
// ─────────────────────────────────────────────────────────
{
  const NOW = new Date('2026-09-22T03:00:00.000Z')
  /** 🔴 **한 시간 전** 기록이다 — 시간만 보면 통과한다 */
  const recent = {
    writtenAt: '2026-09-22T02:00:00.000Z', runId: 'RUN-A', horizonDays: 7,
    byCode: { P01: { openDays: 3, readyCount: 0 } },
  }
  check('🔴 회차를 묻지 않으면 쓴다 (무료 회차)',
    readSpeakerLoad(recent, NOW, null).loaded === true)
  check('🔴 같은 회차면 쓴다', readSpeakerLoad(recent, NOW, 'RUN-A').loaded === true)
  check('🔴 🔴 **쓰기가 실패해 옛 기록이 남아도 그 회차는 시작하지 않는다**',
    (() => {
      const r = readSpeakerLoad(recent, NOW, 'RUN-B')
      return r.loaded === false && r.problem === 'runMismatch'
        && r.describe.includes('다른 회차의 기록이다')
    })())
  check('🔴 회차 id 가 없는 파일은 모양이 어긋난 것이다',
    readSpeakerLoad({ writtenAt: recent.writtenAt, horizonDays: 7, byCode: {} }, NOW).problem === 'malformed')

  const draftSrc = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 🔴 **유료 회차는 자기 회차 기록만 쓴다**', /CALL \? RUN_ID : null/.test(draftSrc))
  const procSrc = readFileSync('scripts/supply-process.mts', 'utf-8')
  check('🔴 🔴 **공급 러너는 적지 못하면 생성 단계를 시작하지 않는다**',
    /speakerLoadWriteFailed/.test(procSrc) && /이 회차의 생성을 시작하지 않는다/.test(procSrc))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 🔴 🔴 P01 미배정 READY 2건 — 실제 파일과 최종 후보')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측 그대로.** 2026-09-21 회차의 새 후보 2건은 `matchedPersonaId = null`
   *    이고 화자는 `gateResults.autoDraft.voice.personaCode = 'P01'` 이었다.
   *    아래는 공급 러너가 적는 것과 **같은 계산**으로 파일을 만들고,
   *    그 파일을 읽어 최종 후보 묶음까지 낸다 — 값을 그대로 보인다.
   */
  const KST = (d: number) => new Date(Date.UTC(2026, 8, 21 + d, 15, 0))
  const label = (at: Date) => new Date(at.getTime() + 9 * 36e5).toISOString().slice(0, 10)
  const availAt = (h: readonly { code: string; matchedAts: readonly Date[] }[],
    at: Date, caps: { postsPerWeek: number; minDaysBetween: number }) =>
    availablePersonasAt(h.map((x) => ({ code: x.code, matchedAts: [...x.matchedAts] })), at, caps)
  const d1 = PROFILES.d1
  const d3p = PROFILES.d3
  const capsOf = (p: typeof d1) => ({
    dailyTarget: p.dailyTarget, postsPerWeek: p.postsPerWeek, minDaysBetween: p.minDaysBetween,
  })
  const CODES = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06']

  /** 🔴 미배정 READY — 배정 칸은 비어 있고 화자는 gateResults 에 있다 */
  const pending = [
    { matchedPersona: null, gateResults: { autoDraft: { voice: { personaCode: 'P01' } } } },
    { matchedPersona: null, gateResults: { autoDraft: { voice: { personaCode: 'P01' } } } },
  ]
  const readyCountOf = (code: string) => pending
    .filter((r) => (r.matchedPersona as { code: string } | null)?.code === code
      || draftSpeakerOf(r.gateResults) === code).length
  check('🔴 🔴 **배정 전 P01 글 2건이 실제로 세어진다**',
    readyCountOf('P01') === 2 && readyCountOf('P02') === 0)

  /** 🔴 공급 러너와 같은 계산 — 9/22 는 canary d3, 9/23 부터 d1 */
  const plan = planOpenDays({
    days: Array.from({ length: 7 }, (_, i) => KST(i)),
    profileOf: (at) => (label(at) === '2026-09-22' ? capsOf(d3p) : capsOf(d1)),
    history: CODES.map((code) => ({ code, matchedAts: [] as Date[] })),
    availableAt: availAt, dateLabel: label,
  })
  const file = {
    writtenAt: new Date('2026-09-22T03:00:00.000Z').toISOString(),
    runId: 'SHOW-1', horizonDays: 7,
    byCode: Object.fromEntries(CODES.map((c) => [c, {
      openDays: plan.openDays.get(c) ?? 0, readyCount: readyCountOf(c),
    }])),
    byDate: plan.byDate,
  }
  console.log(`\n     실제 파일 byCode  ${JSON.stringify(file.byCode)}`)
  console.log(`     실제 파일 byDate  ${JSON.stringify(file.byDate)}`)

  const read = readSpeakerLoad(file, new Date('2026-09-22T03:10:00.000Z'), 'SHOW-1')
  check('🔴 그 파일을 유료 회차가 읽는다', read.loaded === true)
  check('🔴 🔴 **P01 의 재고 2건이 파일에 실려 있다**',
    read.readyCountOf('P01') === 2, String(read.readyCountOf('P01')))

  /** 🔴 그 파일로 최종 후보를 낸다 — 원천 2건 */
  const finalPlan = planSpeakerAvailability({
    sourceKeys: ['src-A', 'src-B'],
    capacities: CODES.map((c) => ({
      code: c, openDays: read.openDaysOf(c), readyCount: read.readyCountOf(c),
    })),
  })
  console.log(`     최종 후보        ${JSON.stringify(finalPlan.slots)}`)
  for (const n of finalPlan.notes) console.log(`     · ${n}`)
  const all = finalPlan.slots.flatMap((sl) => sl.codes)
  check('🔴 🔴 **P01 은 최종 후보에서 빠진다 — 이미 2건을 들고 있다**',
    !all.includes('P01'), all.join(','))
  check('🔴 두 원천이 각각 고를 사람을 받는다',
    finalPlan.slots.every((sl) => sl.codes.length > 0), JSON.stringify(finalPlan.slots))
  check('🔴 🔴 **두 원천의 후보가 서로 겹치지 않는다**',
    new Set(all).size === all.length, all.join(','))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 🔴 🔴 재고는 **낼 수 있는 글**만 센다 — legacy 를 세면 공급이 멎는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측한 회귀** (2026-09-22). 미배정 READY 를 세도록 고치면서
   *    미발행 `APPROVED·EDITED` 를 **전부** 셌다. 큐에는 계약이 어긋나 영영
   *    발행되지 않는 legacy 217건이 있어서 P01 13건 · P08 14건으로 잡혔고,
   *    `여력 = 열린날 − 재고` 가 전부 0 이 되어
   *    🔴 **여력 있는 화자 0명 → 원천 5건 전부 보류**로 공급이 멎었다.
   *
   *    실측 전후:
   *      · 고치기 전  P01(1/13) … 여력 0명 · 5건 보류
   *      · 고친 뒤    P01(1/2) P03(1/0) P04(1/0) P07(1/0) P08(1/0) … 4명 · 1건 보류
   */
  const cap = (code: string, openDays: number, readyCount: number) => ({ code, openDays, readyCount })
  const legacyCounted = planSpeakerAvailability({
    sourceKeys: ['s1', 's2', 's3', 's4', 's5'],
    capacities: [cap('P01', 1, 13), cap('P03', 1, 6), cap('P04', 1, 11), cap('P07', 1, 8), cap('P08', 1, 14)],
  })
  check('🔴 🔴 **legacy 까지 세면 전원 제외되고 공급이 멎는다 (재현)**',
    legacyCounted.eligible.length === 0
    && legacyCounted.slots.every((sl) => sl.codes.length === 0),
    JSON.stringify(legacyCounted.eligible))

  const publishableOnly = planSpeakerAvailability({
    sourceKeys: ['s1', 's2', 's3', 's4', 's5'],
    capacities: [cap('P01', 1, 2), cap('P03', 1, 0), cap('P04', 1, 0), cap('P07', 1, 0), cap('P08', 1, 0)],
  })
  check('🔴 🔴 **낼 수 있는 글만 세면 네 사람이 남는다**',
    publishableOnly.eligible.join(',') === 'P03,P04,P07,P08',
    publishableOnly.eligible.join(','))
  check('🔴 🔴 **P01 은 검토 대기 2건 때문에 빠진다 — 같은 화자로 또 만들지 않는다**',
    !publishableOnly.eligible.includes('P01')
    && publishableOnly.notes.some((n) => n.includes('P01(열린날 1·재고 2)')),
    publishableOnly.notes.join(' | '))

  /**
   * 🔴 공급 러너가 발행 러너와 **같은 분류**에서 WIP 를 받는다 (2026-09-26).
   *    앞판은 여기서 selector 를 따로 불러 `HUMAN_REVIEW_REQUIRED` 를 직접 셌다.
   *    분류의 행동(검토 대기는 WIP · legacy 는 아님)은 `supply:stock-parity-check` 가 실행으로 단정한다.
   */
  const src = readFileSync('scripts/supply-process.mts', 'utf-8')
  check('🔴 🔴 **재고 판정을 공용 분류(`loadStockClassification`)에 맡긴다**',
    /loadStockClassification\(prisma, opts\.env, opts\.now\)/.test(src)
    && !/selectAutoTargets\(/.test(src))
  check('🔴 🔴 **WIP 는 분류의 `personaWipIds` 다 — 여기서 다시 세지 않는다**',
    /classification\.personaWipIds/.test(src)
    && !/'HUMAN_REVIEW_REQUIRED'/.test(src))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0\n')
if (fail > 0) process.exit(1)
