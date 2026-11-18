#!/usr/bin/env tsx
/** Persona 댓글 상한 변경 판정 검사 — 🔴 순수 함수만. DB 0 */
import { planCapChange, type CapPlanInput, type CapRow } from './lib/persona-comment-cap.mjs'

let pass = 0; let fail = 0
const check = (label: string, ok: boolean, d = ''): void => { if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${d ? ` — ${d}` : ''}`) } }

const row = (n: number, daily: number | null, weekly: number | null, status = 'active'): CapRow =>
  ({ code: `P${String(n).padStart(2, '0')}`, status, dailyCap: daily, weeklyCap: weekly })
/** 운영 모양 — 56명 3/12 · 4명 2/8 */
const world = (): CapRow[] => [
  ...Array.from({ length: 56 }, (_, i) => row(i + 1, 3, 12)),
  ...Array.from({ length: 4 }, (_, i) => row(i + 57, 2, 8)),
]
const base = (patch: Partial<CapPlanInput> = {}): CapPlanInput => ({
  rows: world(), from: { daily: 3, weekly: 12 }, to: { daily: 4, weekly: 18 }, keep: { daily: 2, weekly: 8 }, expect: 56, ...patch,
})
const want = (label: string, i: CapPlanInput, code: string): void => {
  const p = planCapChange(i); check(`${label} → ${code}`, p.code === code, `got ${p.code}${p.ok ? '' : ` · ${p.reason}`}`)
}

console.log('\n① 계획')
{
  const p = planCapChange(base())
  check('정확한 조건 → APPLY · 대상 56 · 그대로 4', p.ok && p.code === 'APPLY' && p.targets.length === 56 && p.kept.length === 4)
  check('그대로 둘 무리는 대상에 없다', p.ok && p.code === 'APPLY' && !p.targets.includes('P57') && p.kept.includes('P57'))
}
want('이미 전부 바뀜(멱등)', base({ rows: world().map((r) => (r.dailyCap === 3 ? { ...r, dailyCap: 4, weeklyCap: 18 } : r)) }), 'ALREADY_APPLIED')
want('기대 수가 다르다', base({ expect: 55 }), 'EXPECT_MISMATCH')
want('일부만 바뀐 상태', base({ rows: world().map((r, i) => (i < 10 ? { ...r, dailyCap: 4, weeklyCap: 18 } : r)) }), 'EXPECT_MISMATCH')
want('모르는 조합 한 행(5/20)', base({ rows: [...world().slice(1), row(1, 5, 20)] }), 'UNKNOWN_ROWS')
want('상한 미설정 행(null)', base({ rows: [...world().slice(1), row(1, null, null)] }), 'UNKNOWN_ROWS')
want('하루만 같은 행(3/14)', base({ rows: [...world().slice(1), row(1, 3, 14)] }), 'UNKNOWN_ROWS')
{
  // 🔴 active 가 아닌 행은 무슨 값이든 보지 않고 바꾸지도 않는다
  const p = planCapChange(base({ rows: [...world(), row(99, 9, 9, 'paused'), row(98, 3, 12, 'draft')] }))
  check('paused·draft 행은 판정 밖 · 대상 아님', p.ok && p.code === 'APPLY' && p.targets.length === 56 && !p.targets.includes('P98'))
}

console.log('\n② 인자')
want('하루 0', base({ to: { daily: 0, weekly: 18 } }), 'ARGS')
want('하루 11', base({ to: { daily: 11, weekly: 18 } }), 'ARGS')
want('주 < 하루', base({ to: { daily: 4, weekly: 3 } }), 'ARGS')
want('주 71', base({ to: { daily: 4, weekly: 71 } }), 'ARGS')
want('소수', base({ to: { daily: 4.5, weekly: 18 } }), 'ARGS')
want('전후가 같다', base({ to: { daily: 3, weekly: 12 } }), 'ARGS')
want('--expect 없음', base({ expect: NaN }), 'ARGS')
want('--expect 0', base({ expect: 0 }), 'ARGS')

console.log('\n③ 되돌리기 — 같은 판정에 from/to 만 바꾼다')
{
  const applied = world().map((r) => (r.dailyCap === 3 ? { ...r, dailyCap: 4, weeklyCap: 18 } : r))
  const p = planCapChange(base({ rows: applied, from: { daily: 4, weekly: 18 }, to: { daily: 3, weekly: 12 } }))
  check('4/18 → 3/12 · 대상 56', p.ok && p.code === 'APPLY' && p.targets.length === 56)
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
