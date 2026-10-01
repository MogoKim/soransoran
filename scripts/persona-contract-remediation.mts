#!/usr/bin/env tsx
/**
 * Persona 계약 **결정적 복구** — 기본 dry-run (2026-10-01 · Phase 2A)
 *
 *   npx tsx scripts/persona-contract-remediation.mts                 # read-only 계획 · 예측 · 남는 막힘
 *   npx tsx scripts/persona-contract-remediation.mts --json
 *   # 🔴 apply 는 이번 Phase 에서 격리 DB 만 연다(운영 apply 는 별도 승인 PR)
 *   SORAN_ISOLATED_DB=yes-throwaway DATABASE_URL=postgresql://…@localhost:…/soran_test \
 *     npx tsx scripts/persona-contract-remediation.mts --apply --digest=<dry-run 의 digest> --reason "…"
 *
 * 🔴 출력은 코드 · 축 · 필드 이름 · 개수다. 표시명 · 값 · 원문 · 해시를 찍지 않는다.
 */
import { PrismaClient } from '@prisma/client'

import { fillDbConnection } from './lib/ops-signals.mjs'
import { applyRemediation, readRemediation } from './lib/persona-contract-remediation.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const JSON_OUT = argv.includes('--json')
const arg = (k: string): string | null => {
  const i = argv.findIndex((a) => a === k || a.startsWith(`${k}=`))
  if (i < 0) return null
  return argv[i]!.includes('=') ? argv[i]!.slice(k.length + 1) : (argv[i + 1] ?? null)
}

/** 🔴 이번 Phase 의 apply 는 격리 DB 뿐이다 — 운영 주소면 열지 않는다 */
export function isolatedDb(env: NodeJS.ProcessEnv): boolean {
  const url = env.DATABASE_URL ?? ''
  return (env.SORAN_ISOLATED_DB ?? '').trim() === 'yes-throwaway'
    && /^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(url) && /\/soran_test(\?|$)/.test(url)
}

if (APPLY && !isolatedDb(process.env)) {
  console.error('🔴 --apply 는 이번 Phase 에서 격리 DB 에서만 연다 — 운영 apply 는 별도 승인 PR 이다. 아무것도 쓰지 않았다.')
  process.exit(2)
}
if (!APPLY && !fillDbConnection()) { console.error('🔴 DB 주소가 없다'); process.exit(2) }

const prisma = new PrismaClient()
const now = new Date()
const repoRoot = process.cwd()
try {
  if (APPLY) {
    const digest = arg('--digest')
    const reason = arg('--reason') ?? ''
    if (digest === null) { console.error('🔴 --digest=<dry-run digest> 가 필요하다 — 본 계획만 적용한다'); process.exit(2) }
    const r = await applyRemediation(prisma, { approvedDigest: digest, reason, now, repoRoot })
    console.log(r.ok ? `✅ 적용 ${r.updated.length}명 [${r.updated.join(',')}] · 계약 유효 ${r.before}→${r.after}` : `🔴 ${r.reason} (write ${r.wrote})`)
    process.exitCode = r.ok ? 0 : 1
  } else {
    const r = await readRemediation(prisma, { now, repoRoot })
    const gaps = (x: typeof r.before) => Object.fromEntries(Object.entries(x.gapsByAxis)
      .filter(([, g]) => g.blocked.length + g.unknown.length > 0)
      .map(([a, g]) => [a, { blocked: g.blocked, unknown: g.unknown }]))
    const valid = (x: typeof r.before) => [...x.byState.reserve, ...x.byState['stage-active']].sort()
    const out = {
      mode: 'dry-run · read-only',
      digest: r.plan.digest,
      before: { contractValid: r.before.contractValid, valid: valid(r.before), gaps: gaps(r.before) },
      predicted: { contractValid: r.predicted.contractValid, valid: valid(r.predicted), gaps: gaps(r.predicted) },
      changes: r.plan.personas.map((p) => ({ code: p.code, fields: p.changes.map((c) => c.field) })),
      evidenceRequired: r.plan.evidenceRequired.map((g) => `${g.code}:${g.field}`),
      skipped: r.plan.skipped,
    }
    if (JSON_OUT) console.log(JSON.stringify(out, null, 2))
    else {
      console.log(`\n══ Persona 계약 복구 — dry-run (DB write 0) ══\n`)
      console.log(`   계획 digest ${out.digest}`)
      console.log(`   계약 유효 ${out.before.contractValid} → 예측 ${out.predicted.contractValid}`)
      for (const c of out.changes) console.log(`   · ${c.code}: ${c.fields.join(' · ')}`)
      console.log('\n   남는 막힘(예측):')
      for (const [a, g] of Object.entries(out.predicted.gaps)) console.log(`   · ${a}: 막힘 ${g.blocked.length} [${g.blocked.join(',')}] · 모름 ${g.unknown.length} [${g.unknown.join(',')}]`)
      console.log(`\n   카드로 채울 수 없는 칸: ${out.evidenceRequired.length}건 — ${out.evidenceRequired.join(' ')}\n`)
    }
  }
} finally {
  await prisma.$disconnect()
}
