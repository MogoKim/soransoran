#!/usr/bin/env tsx
/**
 * Persona 댓글 상한 일괄 변경 — 운영 CLI
 *
 * 사용법 (runtime 트리에서)
 *   npx tsx scripts/persona-comment-cap-apply.mts --expect=56 --reason="…"            # dry-run(기본) — DB write 0
 *   npx tsx scripts/persona-comment-cap-apply.mts --expect=56 --reason="…" --apply    # 실제 적용
 *   되돌리기: --from-daily=4 --from-weekly=18 --daily=3 --weekly=12 --expect=56 --reason="…" --apply
 *
 * 기본값: 바꾸기 전 3/12 · 바꾼 뒤 4/18 · 그대로 둘 무리 2/8.
 * 🔴 active 행이 "바꾸기 전 값" 과 "그대로 둘 값" 두 무리뿐이고 대상 수가 --expect 와 같을 때만 쓴다.
 * 🔴 Persona 행의 `updatedAt` 은 Prisma 가 함께 바꾼다. 그 밖의 칸은 건드리지 않는다.
 */
import { PrismaClient } from '@prisma/client'

import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'
import { applyCapChange, planCapChange, readCapRows } from './lib/persona-comment-cap.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const val = (k: string): string => (argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3).trim()
const num = (k: string, fallback: number): number => (val(k) === '' ? fallback : Number(val(k)))

const input = {
  from: { daily: num('from-daily', 3), weekly: num('from-weekly', 12) },
  to: { daily: num('daily', 4), weekly: num('weekly', 18) },
  keep: { daily: num('keep-daily', 2), weekly: num('keep-weekly', 8) },
  expect: num('expect', NaN),
}
const REASON = val('reason')

async function main(): Promise<number> {
  if (REASON === '') { console.error('🔴 --reason 이 필요하다'); return 2 }
  await loadEnvLocal()
  if (!fillDbConnection()) { console.error('🔴 canonical DB env 없음'); return 2 }
  const db = new PrismaClient()
  try {
    const rows = await readCapRows(db)
    const plan = planCapChange({ ...input, rows })
    console.log(`\n══ Persona 댓글 상한 변경 (${APPLY ? '🔴 --apply' : 'dry-run · write 0'}) ══`)
    console.log(`   ${input.from.daily}/${input.from.weekly} → ${input.to.daily}/${input.to.weekly} · 그대로 둘 무리 ${input.keep.daily}/${input.keep.weekly} · 기대 ${String(input.expect)}행`)
    console.log(`   active ${rows.filter((r) => r.status === 'active').length}행 / 전체 ${rows.length}행`)
    if (!plan.ok) { console.log(`\n🔴 거절 ${plan.code} — ${plan.reason}\n`); return 3 }
    if (plan.code === 'ALREADY_APPLIED') { console.log(`\n🟢 이미 적용됨 — write 0 · 그대로 둔 ${plan.kept.length}행 (${plan.kept.join(' · ')})\n`); return 0 }
    console.log(`\n   바뀔 ${plan.targets.length}행: ${plan.targets.join(' ')}`)
    console.log(`   그대로 ${plan.kept.length}행: ${plan.kept.join(' ')}`)
    const perDay = (c: { daily: number; weekly: number }, n: number): number => Math.floor((n * c.weekly) / 7)
    console.log(`   주간 수용량 ${plan.targets.length * input.from.weekly + plan.kept.length * input.keep.weekly} → ${plan.targets.length * input.to.weekly + plan.kept.length * input.keep.weekly}개`
      + ` (대상 무리 하루 약 ${perDay(input.from, plan.targets.length)} → ${perDay(input.to, plan.targets.length)}개)`)
    if (!APPLY) { console.log('\n   dry-run 끝 — DB write 0. 적용하려면 --apply\n'); return 0 }
    const r = await applyCapChange(db, { ...input, reason: REASON })
    if (r.code === 'REFUSED') { console.log(`\n🔴 쓰지 않았다 — ${r.reason}\n`); return 3 }
    if (r.code === 'ALREADY_APPLIED') { console.log('\n🟢 이미 적용됨 — write 0\n'); return 0 }
    const after = planCapChange({ ...input, rows: await readCapRows(db) })
    console.log(`\n🟢 적용 ${r.changed}행 · 감사 기록 ${r.changed}행 · 재판독 ${after.ok ? after.code : after.code}\n`)
    return after.ok && after.code === 'ALREADY_APPLIED' ? 0 : 4
  } finally { await db.$disconnect() }
}

process.exit(await main())
