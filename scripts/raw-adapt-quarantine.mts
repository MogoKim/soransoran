#!/usr/bin/env tsx
/**
 * 적응 레인 격리 행 보기 · 기한 청소 — 🔴 **기본 read-only. DB write 0** (2026-09-29)
 *
 * 🔴 긴 사연 적응 초안은 **내부 실험 격리**다 — 창업자 검토 대기열 · Persona WIP · 자동 발행 어디에도 없다.
 *    이 명령은 그 행을 **따로** 본다(창업자 할 일 목록이 아니다). 기한(7일)이 지난 행은 살아 있는 쪽에서 뺀다.
 *
 * 사용법
 *   npm run supply:raw-adapt-quarantine                       살아 있는 격리 행 · 기한 지난 행 수 (read-only)
 *   npm run supply:raw-adapt-quarantine -- --sweep            청소 계획 (read-only)
 *   npm run supply:raw-adapt-quarantine -- --sweep --apply    🔴 기한 지난 검토 전 격리 행 → EXPIRED
 *
 * 🔴 **예약되어 있지 않다** — launchd · 공급 러너 어디서도 부르지 않는다. 청소 write 는 `--sweep --apply` 뿐이다.
 */
import { PrismaClient } from '@prisma/client'

import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readRawAdaptQuarantine, sweepRawAdaptQuarantine } from './lib/raw-adapt-quarantine-store.mjs'
import {
  RAW_ADAPT_QUARANTINE_TTL_DAYS, RAW_ADAPT_LOAD_CAP_PER_RUN, RAW_ADAPT_LOAD_CAP_PER_DAY, RAW_ADAPT_DRAFT_CAP_PER_RUN,
} from '../src/lib/raw-adapt-quarantine'

const argv = process.argv.slice(2)
const SWEEP = argv.includes('--sweep')
const APPLY = argv.includes('--apply')
if (APPLY && !SWEEP) {
  console.error('\n🔴 중단: --apply 는 --sweep 과 함께만 씁니다.\n')
  process.exit(1)
}

await loadEnvLocal()
const prisma = new PrismaClient()
const now = new Date()
const ageDays = (d: Date | null): string => (d === null ? '?' : ((now.getTime() - d.getTime()) / 864e5).toFixed(1))

console.log(APPLY ? '\n══ 🔴 적응 격리 행 기한 청소 (--sweep --apply) ══\n' : '\n══ 적응 격리 행 (read-only · DB write 0) ══\n')
console.log(`  기한 ${RAW_ADAPT_QUARANTINE_TTL_DAYS}일 · 적재 상한 회차 ${RAW_ADAPT_LOAD_CAP_PER_RUN} · 하루 ${RAW_ADAPT_LOAD_CAP_PER_DAY}`
  + ` · 생성 상한 회차 ${RAW_ADAPT_DRAFT_CAP_PER_RUN}`)
console.log('  🔴 창업자 검토 대기열이 아니다 — 자동 발행 0 · 창업자 대기열 0 · Persona WIP 0\n')

const view = await readRawAdaptQuarantine(prisma, now)
console.log(`① 살아 있는 격리 행 ${view.live.length}건 · 기한 지난 행 ${view.expired.length}건 (읽을 때 뺀다)`)
for (const r of view.live) console.log(`   · ${r.id} · ${r.status} · ${ageDays(r.createdAt)}일`)

if (!SWEEP) {
  await prisma.$disconnect()
  process.exit(0)
}
const res = await sweepRawAdaptQuarantine(prisma, now, { apply: APPLY })
console.log(`\n② 청소 대상 ${res.planned.length}건 — 기한 지남 · APPROVED · 발행 전 · machine:* 결정`)
if (!APPLY) {
  console.log('   🟡 read-only 입니다. DB write 0 — 실행하려면 --sweep --apply')
} else {
  console.log(`   ✅ EXPIRED ${res.expired.length}건 · 🟡 그 사이 바뀌어 건드리지 않음 ${res.raced.length}건`)
}
console.log()
await prisma.$disconnect()
