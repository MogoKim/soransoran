#!/usr/bin/env tsx
/** 하루 13바퀴 시간표 검사 — 🔴 순수 함수만. DB 0 · 네트워크 0 · 변이 시험은 `day-window-mutation.mts` */
import {
  CYCLES, CYCLE_MINUTES, HEARTBEAT_INTERVAL_MINUTES, cycleIndexAt, cycleLabel, cycleLengthMinutes, cyclePublishWindow,
  cycleQuotas, cycleSlots,
} from '../src/lib/cycle-schedule'

let pass = 0; let fail = 0
const check = (label: string, ok: boolean, d = ''): void => { if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${d ? ` — ${d}` : ''}`) } }
const sum = (a: number[]): number => a.reduce((s, n) => s + n, 0)

console.log('\n① 표 — 창업자 결정(2026-11-19)')
check('13바퀴', CYCLES.length === 13)
check('시각', CYCLE_MINUTES.map(cycleLabel).join(' ') === '01:00 04:00 06:30 08:20 10:00 11:20 12:20 13:20 15:20 17:20 18:20 20:20 22:20', CYCLE_MINUTES.map(cycleLabel).join(' '))
check('오름차순 · 중복 없음', CYCLE_MINUTES.every((m, i) => i === 0 || m > CYCLE_MINUTES[i - 1]!))
{
  const by = (b: string): number => sum(CYCLES.filter((c) => c.band === b).map((c) => c.weight))
  const n = (b: string): number => CYCLES.filter((c) => c.band === b).length
  check('바퀴 수 — 새벽 2 · 아침 3 · 점심 2 · 오후 3 · 저녁 3', [n('dawn'), n('morning'), n('noon'), n('afternoon'), n('evening')].join(',') === '2,3,2,3,3')
  check('30편 몫 — 새벽 3 · 아침 8 · 점심 6 · 오후 7 · 저녁 6', [by('dawn'), by('morning'), by('noon'), by('afternoon'), by('evening')].join(',') === '3,8,6,7,6')
}

console.log('\n② 진행 중인 바퀴')
check('00:30 → 전날 22:20 바퀴(12)', cycleIndexAt(30) === 12)
check('01:00 → 0', cycleIndexAt(60) === 0)
check('08:19 → 06:30 바퀴(2)', cycleIndexAt(8 * 60 + 19) === 2)
check('08:20 → 3', cycleIndexAt(8 * 60 + 20) === 3)
check('23:59 → 12', cycleIndexAt(23 * 60 + 59) === 12)
check('범위 밖 · 소수 → null', cycleIndexAt(-1) === null && cycleIndexAt(1440) === null && cycleIndexAt(1.5) === null)
check('길이 합 = 24시간', sum(CYCLES.map((_, i) => cycleLengthMinutes(i) ?? 0)) === 1440)
check('마지막 바퀴는 자정을 넘는다(160분)', cycleLengthMinutes(12) === 160)
check('없는 순번 → null', cycleLengthMinutes(13) === null)

console.log('\n③ 몫')
check('30편 = 표의 weight 그대로', cycleQuotas(30).join(',') === CYCLES.map((c) => c.weight).join(','))
for (const t of [1, 20, 30, 50, 100]) check(`${t}편 — 합이 정확히 ${t}`, sum(cycleQuotas(t)) === t, cycleQuotas(t).join(','))
check('0 · 음수 · 소수 → 전부 0', [cycleQuotas(0), cycleQuotas(-3), cycleQuotas(2.5)].every((q) => sum(q) === 0))
check('같은 입력 → 같은 답', cycleQuotas(47).join(',') === cycleQuotas(47).join(','))

console.log('\n④ 공개 자리 — 바퀴 몫을 그 바퀴의 공개 창에 편다 (2026-11-23 · 하루 전체 창)')
{
  const windows = CYCLES.map((_, i) => cyclePublishWindow(i)!)
  const inWindow = (m: number, w: { start: number; end: number }): boolean =>
    (m >= w.start && m < w.end) || (m + 1440 >= w.start && m + 1440 < w.end)
  // 창 시작 = (공급 + 한 틱)을 격자 위로 · 끝 = 다음 바퀴 창 시작(마지막은 다음 날 01:30)
  check('창 시작 — 공급 회차 뒤 첫 틱',
    windows.map((w) => cycleLabel(w.start)).join(' ') === '01:30 04:30 07:00 08:50 10:30 11:50 12:50 13:50 15:50 17:50 18:50 20:50 22:50',
    windows.map((w) => cycleLabel(w.start)).join(' '))
  check('창 틱 수 18·15·11·10·8·6·6·12·12·6·12·12·16 · 합 = 하루 틱 144 · 마지막 창은 다음 날 첫 창 시작에서 끝난다',
    windows.map((w) => (w.end - w.start) / HEARTBEAT_INTERVAL_MINUTES).join(',') === '18,15,11,10,8,6,6,12,12,6,12,12,16'
    && sum(windows.map((w) => w.end - w.start)) === 1440 && windows[12]!.end === windows[0]!.start + 1440
    && cyclePublishWindow(13) === null)
  const labels = (n: number): string => { const d = cycleSlots(n); return d.ok ? d.minutes.map(cycleLabel).join(' ') : `불가 ${d.problems.join(' / ')}` }
  // 🔴 명세(밤 3 §2)의 D30 "후" 목록 · 검토(REVIEW 부록 A)의 D20 · D50 목록 — 손계산과 함수 출력이 같다
  const D30 = '00:50 02:10 03:40 05:40 07:20 08:20 09:00 09:40 10:10 10:40 11:10 11:30 12:00 12:20 12:40 13:00 13:20 13:40 14:20 15:20 16:10 16:50 17:30 18:00 18:30 19:20 20:20 21:20 22:20 23:30'
  const D20 = '00:10 02:10 03:40 05:40 07:20 08:20 09:10 10:00 10:50 11:30 12:00 12:30 13:00 13:30 14:50 16:20 17:20 18:20 19:50 21:50'
  const D50 = '00:10 01:00 01:50 02:30 03:20 04:00 05:00 06:20 07:10 07:40 08:00 08:30 09:00 09:20 09:40 10:00 10:20 10:30 10:50 11:10'
    + ' 11:20 11:40 11:50 12:00 12:20 12:30 12:40 12:50 13:00 13:20 13:30 13:40 14:10 14:50 15:30 16:00 16:20 16:50 17:10 17:30'
    + ' 18:00 18:20 18:40 19:10 19:50 20:30 21:10 21:50 22:30 23:10'
  check('🔴 D30 자리 — 00:50(전날 22:20 바퀴 몫) · 02:10 · 03:40 · 05:40 … 23:30 (30칸)', labels(30) === D30, labels(30))
  check('🔴 D20 자리 (20칸)', labels(20) === D20, labels(20))
  check('🔴 D50 자리 (50칸)', labels(50) === D50, labels(50))
  // 🔴 바퀴마다 몫만큼 · 그 바퀴 창 안 · 한 틱 한 건 · 분 오름차순
  for (const n of [20, 30, 50]) {
    const d = cycleSlots(n)
    const mins = d.ok ? d.minutes : []
    const inside = windows.map((w) => mins.filter((m) => inWindow(m, w)).length)
    check(`${n}편 — 바퀴별 자리 수 = 몫 · 격자 위 · 같은 분 없음 · 오름차순`,
      d.ok && inside.join(',') === cycleQuotas(n).join(',') && mins.every((m) => m % HEARTBEAT_INTERVAL_MINUTES === 0)
      && new Set(mins).size === n && mins.every((m, i) => i === 0 || m > mins[i - 1]!), inside.join(','))
  }
  {
    // D30 시간대 몫(창 기준) — 새벽 3 · 아침 8 · 점심 6 · 오후 7 · 저녁 6
    const d = cycleSlots(30)
    const mins = d.ok ? d.minutes : []
    const band = (b: string): number => CYCLES.reduce((s, c, i) =>
      s + (c.band === b ? mins.filter((m) => inWindow(m, windows[i]!)).length : 0), 0)
    check('D30 시간대 — 새벽 3 · 아침 8 · 점심 6 · 오후 7 · 저녁 6', ['dawn', 'morning', 'noon', 'afternoon', 'evening'].map(band).join(',') === '3,8,6,7,6')
  }
  const d100 = cycleSlots(100)
  check('🔴 100편 — 몫이 틱보다 큰 바퀴(10:00 · 11:20 · 12:20 · 17:20)가 있어 담지 못한다',
    !d100.ok && d100.problems.length === 4
    && ['10:00', '11:20', '12:20', '17:20'].every((l) => d100.problems.some((p) => p.startsWith(`${l} 바퀴`))),
    d100.ok ? '' : d100.problems.join(' / '))
  check('0 · 소수 · 음수 목표 → 만들지 않는다', [0, 2.5, -1].every((n) => !cycleSlots(n).ok))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
