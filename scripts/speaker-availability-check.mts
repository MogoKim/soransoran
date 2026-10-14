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
  planAttemptCapacity, createAttemptPool, ATTEMPT_CONTRACT, type AttemptPool,
} from '../src/lib/content-core/speaker-availability'
import {
  readSpeakerLoad, draftSpeakerOf,
} from '../src/lib/content-core/speaker-load-file'
import { readFileSync } from 'node:fs'
import {
  decidePersona, orderPersonasForSource, type PersonaLifeContract, type SourceNeed,
} from '../src/lib/content-core/speaker'
import type { EvidenceSpan } from '../src/lib/content-core/evidence'
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

// ─────────────────────────────────────────────────────────
console.log('\n⑫ 🔴 🔴 생성 시도 여력은 공개 자리와 다르다 (speaker-attempt-v1 · 2026-10-13 12:15 재현)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측** (2026-10-13 12:15 회차 · d5). 공개 자리 4개(오늘 13:30·16:10·19:00 + 내일 08:10) ·
   *    실제 SEED 10건 · 상한·간격을 통과한 화자 27명 · WIP 1(P03). 공개 자리 몫(`openDays`)으로 나누면
   *    4명 − WIP 1 = **3명**만 후보가 되고 7건이 부르기 전에 멈췄다. 아래는 그 모양을 정본 함수로 재현한다.
   */
  const d5 = PROFILES.d5
  const CAPS5 = { postsPerWeek: d5.postsPerWeek, minDaysBetween: d5.minDaysBetween }
  const T1 = new Date('2026-10-13T04:30:00.000Z') // 10/13 13:30 KST — 그날 남은 자리 3
  const T2 = new Date('2026-10-13T23:10:00.000Z') // 10/14 08:10 KST — 다음 첫 기회 1
  const SEATS = new Map([[T1.getTime(), 3], [T2.getTime(), 1]])
  const codes = Array.from({ length: 30 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
  const HOUR = 3_600_000
  /** 🔴 P21~P23 — 지평 두 날 모두 주간 상한(4)에 걸린다 → 자격 27명 */
  const capped = new Set(['P21', 'P22', 'P23'])
  const history = codes.map((code) => ({
    code,
    matchedAts: capped.has(code) ? [1, 2, 3, 4].map((d) => new Date(T1.getTime() - d * 26 * HOUR)) : [],
  }))
  const wip = new Map([['P03', 1]])
  const avail = (h: readonly { code: string; matchedAts: readonly Date[] }[], at: Date, c: { postsPerWeek: number; minDaysBetween: number }): string[] =>
    availablePersonasAt(h.map((x) => ({ code: x.code, matchedAts: [...x.matchedAts] })), at, c)
  const before = JSON.stringify(history)
  const attempt = planAttemptCapacity({
    days: [T1, T2], history, availableAt: avail, caps: CAPS5, wipOf: (c) => wip.get(c) ?? 0,
  })
  const attemptRows = codes.map((code) => ({ code, attemptCapacity: attempt.get(code)?.attemptCapacity ?? 0 }))
  const seedKeys = (n: number): string[] => Array.from({ length: n }, (_, i) => `seed-${String(i + 1).padStart(2, '0')}`)

  // 공개 자리 계획 — 정본 그대로 (바꾸지 않았다)
  const seatPlan = planOpenDays({
    days: [T1, T2], history, availableAt: avail, dateLabel: (at) => at.toISOString(),
    profileOf: (at) => ({ dailyTarget: SEATS.get(at.getTime()) ?? 0, ...CAPS5 }),
  })
  const seatTotal = [...seatPlan.openDays.values()].reduce((n, v) => n + v, 0)
  const oldContract = planSpeakerAvailability({
    sourceKeys: seedKeys(10),
    capacities: codes.map((code) => ({ code, openDays: seatPlan.openDays.get(code) ?? 0, readyCount: wip.get(code) ?? 0 })),
  })
  check('재현 — 옛 계약(공개 자리 몫 − WIP)은 3명 · 7건 보류였다',
    oldContract.eligible.length === 3 && oldContract.slots.filter((sl) => sl.codes.length === 0).length === 7,
    `${oldContract.eligible.join(',')}`)
  check('자격 화자 27명 — 상한에 걸린 3명은 시도 여력 0',
    [...attempt.values()].filter((r) => r.eligibleDays > 0).length === 27
    && ['P21', 'P22', 'P23'].every((c) => attempt.get(c)?.attemptCapacity === 0))

  /**
   * 🔴 **회차 시뮬레이터 — 러너와 같은 순서다** (`take` → 원천별 정본 순서 → `decidePersona` → `markChosen`).
   *    `decidePersona` · `orderPersonasForSource` 는 정본 그대로 부른다. 러너가 이 순서를 지키는지는 아래 배선 검사가 본다.
   *    `failDraft` 는 "고른 뒤 초안·게이트에서 실패" 를 흉내 낸다 — 그래도 사용됨은 그대로여야 한다.
   */
  const SPANS: EvidenceSpan[] = [{ kind: 'head', text: '남편이랑 저녁 먹다가 문득 생각났어요', fromRatio: 0, toRatio: 1 }]
  const needOther: SourceNeed = {
    decision: 'ok', holdReason: '', stance: 'QUESTION', stanceRaw: 'QUESTION', selfBasis: null, warrants: [],
    universalReason: '', protectedFacts: [], speakerRelative: [], closingIntent: null, contentRoles: [],
  }
  const needSpouse: SourceNeed = {
    ...needOther, stance: 'SELF_EXPERIENCE', stanceRaw: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts',
    warrants: [{ fact: 'spouse', requiredValue: '있음', evidenceRef: 'head', evidenceText: '남편이랑' }],
  }
  const cardOf = (code: string, married: boolean): PersonaLifeContract => ({
    code, ageBand: '50대 초반', region: '수도권', maritalStatus: married ? '기혼' : '미혼', spouseRelationship: '',
    childrenCount: 0, childrenAgeBands: [], workStatus: '', economicStatus: '', menopauseStatus: '',
    parentCare: '', personality: '', noGoTopics: [], noGoExpressions: [],
  } as unknown as PersonaLifeContract)
  type Src = { key: string; hash: string; need: SourceNeed }
  const walk = (pool: AttemptPool, srcs: readonly Src[], cards: readonly PersonaLifeContract[], failDraft = new Set<string>()) => {
    const out: { key: string; candidates: number; chosen: string | null; providerPath: boolean; draftFailed: boolean }[] = []
    for (const src of srcs) {
      const cand = pool.take()
      if (cand.length === 0) { out.push({ key: src.key, candidates: 0, chosen: null, providerPath: false, draftFailed: false }); continue }
      const ordered = orderPersonasForSource(cards.filter((c) => cand.includes(c.code)), src.hash)
      const d = decidePersona({ need: src.need, personas: ordered, spans: SPANS }).decision
      if (d.chosen !== null) pool.markChosen(d.chosen)
      out.push({ key: src.key, candidates: cand.length, chosen: d.chosen, providerPath: true, draftFailed: d.chosen !== null && failDraft.has(src.key) })
    }
    return out
  }
  const eligible27 = attemptRows.filter((r) => r.attemptCapacity > 0).map((r) => r.code).sort()

  // ── 반례 1 · 27명 · 원천 10 — 첫 원천은 27명 전부 · 뒤 원천은 앞 선택만 빠진다 · 선택은 모두 다르다 ──
  {
    const pool = createAttemptPool({ attemptCapacity: attemptRows, attemptDemand: 10 })
    const sizes: number[] = []
    const chosen: string[] = []
    for (let i = 0; i < 10; i += 1) {
      const cand = pool.take()
      sizes.push(cand.length)
      const pick = orderPersonasForSource(cand.map((c) => cardOf(c, false)), `h-${i}`)[0]!.code
      check(`  원천 ${i + 1} 후보 = 27 − 앞 선택 ${chosen.length}명 (앞 선택은 없다)`,
        cand.length === 27 - chosen.length && !chosen.some((c) => cand.includes(c)), `${cand.length}`)
      pool.markChosen(pick); chosen.push(pick)
    }
    check('🔴 🔴 **반례1 — 첫 원천은 27명 전부를 본다**', sizes[0] === 27 && eligible27.length === 27, sizes.join(','))
    check('🔴 🔴 **반례1 — 10명 선택이 모두 다르다**', new Set(chosen).size === 10)
    check('🔴 상한에 걸린 화자는 어느 원천 후보에도 없다', !chosen.some((c) => capped.has(c)) && !pool.eligible.some((c) => capped.has(c)))
  }

  // ── 반례 2 · 12:15 requiredValueUnmet 재작성 — 앞 3명 부적격 · 4번째 이후 적격자 · 옛 stride 는 실패 ──
  {
    /** 적격(기혼)은 한 명 — stride 로 원천 4 묶음(위치 3·13·23)에 들지 않는 자리에 둔다 */
    const married = eligible27[5]!
    const cards = eligible27.map((c) => cardOf(c, c === married))
    /** 원천 4 의 정본 순서에서 적격자가 4번째 이후가 되는 지문을 고른다(결정적 탐색) */
    let hash = ''
    for (let k = 0; k < 500 && hash === ''; k += 1) {
      const ord = orderPersonasForSource(cards, `rvu-${k}`).map((c) => c.code)
      if (ord.indexOf(married) >= 3) hash = `rvu-${k}`
    }
    const srcs: Src[] = [0, 1, 2].map((i) => ({ key: `s${i}`, hash: `o-${i}`, need: needOther }))
      .concat([{ key: 's3', hash, need: needSpouse }])
    // 앞 원천 3개가 적격자를 먼저 가져가지 않게 — 적격자가 그들의 첫 순서가 아님을 단정한다
    const firstOf = (h: string): string => orderPersonasForSource(cards, h)[0]!.code
    check('  (fixture) 앞 원천들의 첫 사람은 적격자가 아니다', [0, 1, 2].every((i) => firstOf(`o-${i}`) !== married))
    const res = walk(createAttemptPool({ attemptCapacity: attemptRows, attemptDemand: 4 }), srcs, cards)
    const ord4 = orderPersonasForSource(cards.filter((c) => !res.slice(0, 3).some((r) => r.chosen === c.code)), hash).map((c) => c.code)
    check('🔴 🔴 **반례2 — 앞 3명은 모두 부적격 · 4번째 이후 적격자가 선택된다**',
      hash !== '' && ord4.indexOf(married) >= 3 && res[3]!.chosen === married, `${ord4.indexOf(married)} · ${res[3]!.chosen}`)
    const old = planSpeakerAvailability({
      sourceKeys: srcs.map((x) => x.key).concat(['s4', 's5', 's6', 's7', 's8', 's9']),
      capacities: attemptRows.map((r) => ({ code: r.code, openDays: r.attemptCapacity, readyCount: 0 })),
    })
    const oldBundle = old.slots[3]!.codes
    const oldDecision = decidePersona({
      need: needSpouse, personas: orderPersonasForSource(cards.filter((c) => oldBundle.includes(c.code)), hash), spans: SPANS,
    })
    check('🔴 🔴 **반례2 — 옛 stride 분배(원천 10)에서는 같은 원천이 requiredValueUnmet 로 실패한다**',
      oldBundle.length <= 3 && !oldBundle.includes(married) && oldDecision.decision.chosen === null
      && oldDecision.plan.rejection === 'requiredValueUnmet', `${oldBundle.length} · ${oldDecision.plan.rejection}`)
  }

  // ── 반례 3 · 3명 · SEED 8 — 최대 3원천만 · 나머지 5개는 provider 경로 없이 보류 ──
  {
    const three = eligible27.slice(0, 3)
    const rows = three.map((code) => ({ code, attemptCapacity: 1 }))
    const res = walk(createAttemptPool({ attemptCapacity: rows, attemptDemand: 8 }),
      Array.from({ length: 8 }, (_, i) => ({ key: `t${i}`, hash: `t-${i}`, need: needOther })), three.map((c) => cardOf(c, false)))
    const picked = res.map((r) => r.chosen).filter((c): c is string => c !== null)
    check('🔴 🔴 **반례3 — 3명 · SEED 8 → 최대 3원천만 Persona 선택 · 모두 다른 사람**',
      picked.length === 3 && new Set(picked).size === 3)
    check('🔴 🔴 **반례3 — 나머지 5원천은 provider 경로 없이 명시 보류(후보 0)**',
      res.filter((r) => !r.providerPath && r.candidates === 0).length === 5)
    /** 앞 원천이 자격 미달로 아무도 고르지 않아도 유료 경로 상한은 3 이다 — 판독 호출이 늘지 않는다 */
    const rvuFirst = walk(createAttemptPool({ attemptCapacity: rows, attemptDemand: 8 }),
      [{ key: 'x0', hash: 'x', need: needSpouse }, ...Array.from({ length: 7 }, (_, i) => ({ key: `x${i + 1}`, hash: `x-${i}`, need: needOther }))],
      three.map((c) => cardOf(c, false)))
    check('🔴 앞 원천이 아무도 못 골라도 유료 경로 진입은 3원천 — 상한 min(SEED, 인원) 그대로',
      rvuFirst.filter((r) => r.providerPath).length === 3 && rvuFirst[0]!.chosen === null)
  }

  // ── 반례 4 · SEED 0 — 계획 · 생성 0 ──
  {
    const pool = createAttemptPool({ attemptCapacity: attemptRows, attemptDemand: 0 })
    check('🔴 🔴 **반례4 — SEED 0 이면 유료 경로 상한 0 · 후보 0**',
      pool.attemptLimit === 0 && pool.take().length === 0 && pool.started === 0)
  }

  // ── 반례 5 · 공개 자리 4 · SEED 10 — 생성 후보 ≤ 10 · 공개 상한 4 그대로 ──
  {
    const res = walk(createAttemptPool({ attemptCapacity: attemptRows, attemptDemand: 10 }),
      Array.from({ length: 10 }, (_, i) => ({ key: `f${i}`, hash: `f-${i}`, need: needOther })), eligible27.map((c) => cardOf(c, false)))
    const picked = res.map((r) => r.chosen).filter((c): c is string => c !== null)
    check('🔴 🔴 **반례5 — 생성 후보는 최대 10 (SEED 수)**', picked.length === 10 && res.filter((r) => r.providerPath).length === 10)
    check('🔴 🔴 **반례5 — 공개 가능량은 여전히 4 — 공개 자리 계획은 그대로다**',
      seatTotal === 4 && d5.dailyTarget === 5 && d5.postsPerWeek === 4 && d5.minDaysBetween === 1, `seats ${seatTotal}`)
    check('🔴 시도 계획은 이력을 바꾸지 않는다 — 다음 판정이 가짜 배정을 보지 않는다', JSON.stringify(history) === before)
    const slots = [T1, new Date(T1.getTime() + 160 * 60_000), new Date(T1.getTime() + 330 * 60_000), T2]
    const opps: SlotOpportunity[] = picked.map((code, i) => ({ key: `draft-${i}`, personaCode: code, validAt: () => true }))
    check('🔴 🔴 **반례5 — 10개 초안이 모두 성공해도 발행은 공개 자리 4 — 상한 · cadence 불변**',
      matchOpportunitiesToSlots(slots, opps).filled === 4)
  }

  // ── 반례 6 · 선택 뒤 초안 실패 — 뒤 원천에서 다시 쓰지 않는다 ──
  {
    const cards = eligible27.map((c) => cardOf(c, false))
    const srcs = Array.from({ length: 10 }, (_, i) => ({ key: `g${i}`, hash: `g-${i}`, need: needOther }))
    const res = walk(createAttemptPool({ attemptCapacity: attemptRows, attemptDemand: 10 }), srcs, cards, new Set(['g0', 'g1']))
    const failed = res.filter((r) => r.draftFailed).map((r) => r.chosen)
    check('🔴 🔴 **반례6 — 초안 실패한 원천의 Persona 를 뒤 원천에서 다시 쓰지 않는다**',
      failed.length === 2 && res.slice(2).every((r) => !failed.includes(r.chosen)))
    const pool = createAttemptPool({ attemptCapacity: attemptRows, attemptDemand: 10 })
    pool.take(); pool.markChosen(eligible27[0]!)
    let threw = false
    try { pool.markChosen(eligible27[0]!) } catch { threw = true }
    let outsider = false
    try { pool.markChosen('P21') } catch { outsider = true }
    check('🔴 같은 사람을 두 번 표시하거나 풀 밖 사람을 표시하면 멈춘다', threw && outsider && !pool.take().includes(eligible27[0]!))
  }

  // ── 반례 7 · 결정성 — 반복 · 입력 순서 뒤집기 ──
  {
    const cards = eligible27.map((c) => cardOf(c, c === eligible27[7]))
    const srcs: Src[] = Array.from({ length: 10 }, (_, i) => ({ key: `d${i}`, hash: `d-${i}`, need: i === 4 ? needSpouse : needOther }))
    const a = walk(createAttemptPool({ attemptCapacity: attemptRows, attemptDemand: 10 }), srcs, cards).map((r) => r.chosen)
    const b = walk(createAttemptPool({ attemptCapacity: attemptRows, attemptDemand: 10 }), srcs, cards).map((r) => r.chosen)
    const c = walk(createAttemptPool({ attemptCapacity: [...attemptRows].reverse(), attemptDemand: 10 }), srcs, [...cards].reverse()).map((r) => r.chosen)
    check('🔴 🔴 **반례7 — 같은 입력이면 같은 결과 · 입력 배열을 뒤집어도 같다**',
      JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(c), JSON.stringify([a, c]))
  }

  // ── 반례 8 · 호출 — 후보 확대만으로 판독(speakerPlan) 진입이 늘지 않는다 ──
  {
    for (const [n, rows] of [[10, attemptRows], [8, eligible27.slice(0, 3).map((code) => ({ code, attemptCapacity: 1 }))], [3, attemptRows]] as const) {
      const keys = Array.from({ length: n }, (_, i) => `k${i}`)
      const old = planSpeakerAvailability({ sourceKeys: keys, capacities: rows.map((r) => ({ code: r.code, openDays: r.attemptCapacity, readyCount: 0 })) })
      const oldEntries = old.slots.filter((sl) => sl.codes.length > 0).length
      const pool = createAttemptPool({ attemptCapacity: rows, attemptDemand: n })
      let entries = 0
      for (let i = 0; i < n; i += 1) if (pool.take().length > 0) entries += 1
      check(`🔴 🔴 **반례8 — SEED ${n} · 시도 가능 ${rows.filter((r) => r.attemptCapacity > 0).length}명: 유료 경로 진입 ${entries} = 옛 stride ${oldEntries} (판독 호출 증가 0)**`,
        entries === oldEntries && entries === Math.min(n, rows.filter((r) => r.attemptCapacity > 0).length))
    }
  }

  const overfed = createAttemptPool({
    attemptCapacity: codes.map((code) => ({ code, attemptCapacity: ['P01', 'P02', 'P04'].includes(code) ? 2 : 0 })),
    attemptDemand: 10,
  })
  check('🔴 🔴 **시도 여력 값이 2 로 들어와도 한 사람 한 원천 — 인원 3 → 유료 경로 상한 3**',
    overfed.attemptSupply === 3 && overfed.attemptLimit === 3)

  const wipOnly = planAttemptCapacity({
    days: [T1], history: [{ code: 'P01', matchedAts: [] }, { code: 'P02', matchedAts: [] }],
    availableAt: avail, caps: CAPS5, wipOf: (c) => (c === 'P01' ? 1 : 0),
  })
  check('🔴 WIP 는 계속 뺀다 — 자격 1일 · WIP 1 이면 시도 0',
    wipOnly.get('P01')?.attemptCapacity === 0 && wipOnly.get('P02')?.attemptCapacity === 1)
  const noHorizon = planAttemptCapacity({ days: [], history, availableAt: avail, caps: CAPS5, wipOf: () => 0 })
  check('🔴 지평에 공개 자리가 없으면 시도 여력도 없다 — 지평 밖 날로 앞당기지 않는다',
    [...noHorizon.values()].every((r) => r.attemptCapacity === 0))
  const voiceOnly = planAttemptCapacity({
    days: [T1, T2], history, availableAt: avail, caps: CAPS5, wipOf: () => 0, canTakeSlot: (c) => c === 'P05',
  })
  check('🔴 말투 근거 없는 화자는 시도 여력 0 — 자격 없는 사람을 끼우지 않는다',
    [...voiceOnly.entries()].every(([c, r]) => r.attemptCapacity === (c === 'P05' ? 1 : 0)))

  // 파일 계약 — 시도 계약이 있을 때만 시도 여력을 준다
  const now = new Date()
  const withContract = readSpeakerLoad({
    writtenAt: now.toISOString(), runId: 'r1', horizonDays: 2, attemptContract: ATTEMPT_CONTRACT, releaseSeats: 4,
    byCode: { P01: { openDays: 0, readyCount: 0, attemptCapacity: 1 } },
  }, now, 'r1')
  const legacy = readSpeakerLoad({
    writtenAt: now.toISOString(), runId: 'r1', horizonDays: 2, byCode: { P01: { openDays: 0, readyCount: 0 } },
  }, now, 'r1')
  check('🔴 파일 — 시도 계약이 있으면 공개 자리 몫이 0 이어도 시도 여력 1 · 공개 자리 4 를 그대로 읽는다',
    withContract.loaded && withContract.attemptCapacityOf?.('P01') === 1 && withContract.releaseSeats === 4
    && withContract.attemptCapacityOf?.('P99') === 0)
  check('🔴 파일 — 시도 계약이 없으면 null (옛 계약으로 좁게 돈다)',
    legacy.loaded && legacy.attemptCapacityOf === null)

  /** 🔴 **배선** — 만든 함수가 실제 소비자에서 쓰인다(사본이 아니다) */
  const draftSrc = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  const supplySrc = readFileSync('scripts/supply-process.mts', 'utf-8')
  check('🔴 🔴 **생성 러너가 실제 SEED 와 시도 여력으로 전체 후보 풀을 만든다**',
    /createAttemptPool\(\{\s*attemptCapacity: voice\.candidates\.map\(\(c\) => \(\{ code: c\.code, attemptCapacity: attemptOf\(c\.code\) \}\)\),\s*attemptDemand: seeds\.length,/.test(draftSrc)
    && /const attemptOf = speakerLoad\.loaded \? speakerLoad\.attemptCapacityOf : null/.test(draftSrc)
    && !/planSpeakerAttempts/.test(draftSrc))
  {
    const iTake = draftSrc.indexOf('const slotCodes = attemptPool !== null ? attemptPool.take() : slotOf.get(keyOfJ(j)) ?? []')
    const iRun = draftSrc.indexOf('art = await runContentCore({')
    const iMark = draftSrc.indexOf('attemptPool.markChosen(chosenCode)')
    const iDraftNull = draftSrc.indexOf('if (art.draft === null) {')
    check('🔴 🔴 **배선 — 원천마다 take → runContentCore → 고른 즉시 markChosen → (그 뒤) 초안 결과**',
      iTake > 0 && iRun > iTake && iMark > iRun && iDraftNull > iMark
      && /const chosenCode = \(art\.plan\?\.personaDecision\?\.chosen \?\? ''\)\.trim\(\)/.test(draftSrc)
      // 🔴 초안 결과와 무관하게 표시한다 — 조건에 초안 성공을 끼우면 실패한 사람이 다시 쓰인다
      && /if \(attemptPool !== null && chosenCode !== ''\) \{\n\s*try \{ attemptPool\.markChosen\(chosenCode\) \}/.test(draftSrc),
      `${iTake} ${iRun} ${iMark} ${iDraftNull}`)
  }
  check('🔴 🔴 **공개 자리는 공개 슬롯 수 그대로 — 시도 수로 키우지 않는다**',
    /dailyTarget: seatsByDate\.get\(kstDateString\(at\)\)\?\.seats \?\? 0,/.test(supplySrc)
    && /const releaseSeats = \[\.\.\.seatsByDate\.values\(\)\]\.reduce\(\(n, d\) => n \+ d\.seats, 0\)/.test(supplySrc))
  check('🔴 🔴 **공급 러너가 같은 지평 · 같은 WIP 로 시도 여력을 적는다**',
    /planAttemptCapacity\(\{\s*days, history,/.test(supplySrc)
    && /wipOf: \(code\) => wipBy\.byCode\.get\(code\) \?\? 0/.test(supplySrc)
    && /attemptCapacity: attempt\.get\(code\)\?\.attemptCapacity \?\? 0/.test(supplySrc)
    && /attemptContract: ATTEMPT_CONTRACT, releaseSeats,/.test(supplySrc))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0\n')
if (fail > 0) process.exit(1)
