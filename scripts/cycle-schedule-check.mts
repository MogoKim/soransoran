#!/usr/bin/env tsx
/** 하루 13바퀴 시간표 검사 — 🔴 순수 함수만. DB 0 · 네트워크 0 */
import { CYCLES, CYCLE_MINUTES, cycleIndexAt, cycleLabel, cycleLengthMinutes, cycleQuotas } from '../src/lib/cycle-schedule'

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
{
  // 1단계: 공개 08~22시 — 새벽 2바퀴와 22:20 바퀴가 빠진다
  const day = cycleQuotas(30, (c) => c.band !== 'dawn' && c.minute !== 22 * 60 + 20)
  check('빠진 바퀴의 몫은 0', day[0] === 0 && day[1] === 0 && day[12] === 0)
  check('빠져도 합은 30', sum(day) === 30, day.join(','))
}
check('0 · 음수 · 소수 · 참여 0 → 전부 0', [cycleQuotas(0), cycleQuotas(-3), cycleQuotas(2.5), cycleQuotas(30, () => false)].every((q) => sum(q) === 0))
check('같은 입력 → 같은 답', cycleQuotas(47).join(',') === cycleQuotas(47).join(','))

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
