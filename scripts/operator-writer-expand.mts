#!/usr/bin/env tsx
/**
 * 운영용 작성자 풀 확장 OP01~OP30 → OP01~OP50 — 🔴 기본 dry-run (write 0)
 *
 *   npx tsx scripts/operator-writer-expand.mts                 # read-only 계획 · digest · 충돌 종류
 *   npx tsx scripts/operator-writer-expand.mts --json
 *   # 격리 DB(127.0.0.1 soran_test) 적용
 *   DATABASE_URL=postgresql://soran@127.0.0.1:54329/soran_test DIRECT_URL=$DATABASE_URL \
 *     npx tsx scripts/operator-writer-expand.mts --apply --expect=30:50 --digest=<64자리> --reason="…"
 *   # 🔴 운영 적용 — 마스터 승인 뒤, main 에 병합된 깨끗한 checkout 에서만
 *   npx tsx scripts/operator-writer-expand.mts --apply --production --target=<origin/main 40자리> \
 *     --expect=30:50 --digest=<dry-run 의 64자리> --reason="…"
 *
 * 🔴 운영 apply 는 셸의 DATABASE_URL 을 믿지 않는다 — canonical env 를 읽어 덮는다.
 * 🔴 D100 자동 Persona(P01~) 확장이 아니다. 공급·발행·Persona·댓글·stage·runtime 과 무관하다.
 * 🔴 출력은 code · 운영용 닉네임 · 개수 · 충돌 **종류**뿐이다. 회원 닉네임·이름·DB 주소를 찍지 않는다.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

import { fillDbConnection } from './lib/ops-signals.mjs'
import {
  BASELINE_CODES, EXPANSION, TARGET_ACTIVE,
  applyExpansion, collectProductionFacts, decideMode, judgeProduction, planExpansion, readFacts, verifyAfter,
} from './lib/operator-writer-expand.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

// 🔴 모드는 DB 에 붙기 **전에** 정한다 — 거부면 연결 0 · write 0
const mode = decideMode(argv, process.env.DATABASE_URL ?? '')
function refuse(problems: readonly string[]): never {
  console.error('🔴 열지 않는다 — 아무것도 쓰지 않았다')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}
if (mode.kind === 'refuse') refuse(mode.problems)

if (mode.kind === 'apply-production') {
  const facts = collectProductionFacts(SCRIPT_DIR, process.env)
  const problems = judgeProduction(facts, mode.target)
  if (problems.length > 0) refuse(problems)
  // 🔴 셸에서 물려받은 주소를 버리고 canonical 값으로 덮는다
  process.env.DATABASE_URL = facts.env.databaseUrl
  process.env.DIRECT_URL = facts.env.directUrl
  console.log(`🔴 운영 DB 적용 · target ${mode.target} · 사유: ${mode.reason}`)
} else if (mode.kind === 'dry-run') {
  if (!fillDbConnection()) refuse(['DB 주소가 없다'])
}

const prisma = new PrismaClient()
try {
  if (mode.kind === 'dry-run') {
    const facts = await readFacts(prisma)
    const plan = planExpansion(facts)
    const baseline = BASELINE_CODES.map((code) => {
      const w = facts.writers.find((x) => x.code === code)
      return w === undefined
        ? { code, present: false }
        : { code, present: true, status: w.status, accounts: w.accountCount, persona: w.hasPersona }
    })
    const out = {
      mode: 'dry-run · read-only (DB write 0)',
      digest: plan.digest,
      action: plan.action,
      expect: `${plan.activeBefore}:${plan.activeAfter}`,
      target: TARGET_ACTIVE,
      diagnostics: facts.totals,
      baseline,
      creates: plan.action === 'create' ? plan.creates.map((s) => ({ code: s.code, nickname: s.nickname })) : [],
      problems: plan.action === 'abort' ? plan.problems : [],
      applyCommand: plan.action === 'abort'
        ? null
        : `npx tsx scripts/operator-writer-expand.mts --apply --production --target=<병합 뒤 origin/main 40자리> `
          + `--expect=${plan.activeBefore}:${plan.activeAfter} --digest=${plan.digest} --reason="<승인 사유>"`,
    }
    if (JSON_OUT) console.log(JSON.stringify(out, null, 2))
    else {
      console.log('\n══ 운영용 작성자 OP 확장 — dry-run (DB write 0) ══\n')
      console.log(`   명단 digest ${out.digest}`)
      console.log(`   판정 ${out.action} · expect ${out.expect} (목표 active ${out.target})`)
      console.log(`   진단(판정에 안 씀): User ${out.diagnostics.users} · Account ${out.diagnostics.accounts} · Persona ${out.diagnostics.personas}`)
      for (const b of out.baseline) {
        console.log(b.present
          ? `   · 기준 ${b.code}: ${b.status} · Account ${b.accounts} · Persona ${b.persona ? '연결' : '0'}`
          : `   · 기준 ${b.code}: 없음`)
      }
      for (const c of out.creates) console.log(`   + ${c.code} ${c.nickname}`)
      for (const p of out.problems) console.log(`   🔴 ${p}`)
      if (out.applyCommand !== null) console.log(`\n   적용(🔴 승인 뒤에만): ${out.applyCommand}`)
      console.log('')
    }
    process.exitCode = plan.action === 'abort' ? 1 : 0
  } else {
    const r = await applyExpansion(prisma, { expected: mode.expected, approvedDigest: mode.digest })
    if (!r.ok) {
      console.error(`🔴 ${r.reason} — 아무것도 남기지 않았다(트랜잭션 rollback)`)
      for (const p of r.problems) console.error(`   · ${p}`)
      process.exitCode = 1
    } else if (r.noop) {
      console.log(`✅ 이미 같은 ${EXPANSION.length}명이 있다 — 변경 0 · active ${r.activeAfter}`)
    } else {
      // 🔴 커밋 뒤 새로 읽어 한 번 더 — 판정은 행 단위, 전체 수는 진단으로만
      const after = await readFacts(prisma)
      const v = verifyAfter(r.before, after)
      const d = v.diagnostics
      const diag = `진단 User ${d.usersDelta >= 0 ? '+' : ''}${d.usersDelta} · Account ${d.accountsDelta >= 0 ? '+' : ''}${d.accountsDelta} · Persona ${d.personasDelta >= 0 ? '+' : ''}${d.personasDelta}`
      if (v.problems.length > 0) {
        console.error(`🔴 커밋 뒤 검증 실패 — 사람이 본다 (${diag})`)
        for (const p of v.problems) console.error(`   · ${p}`)
        process.exitCode = 1
      } else {
        console.log(`✅ 생성 ${r.created}명 · active ${r.activeBefore}→${r.activeAfter} · OP01~OP${TARGET_ACTIVE} · 새 20명 각각 Account 0 · Persona 0 · 기준 30명 불변`)
        console.log(`   ${diag} (무관한 동시 가입이 있으면 User·Account 는 더 움직일 수 있다)`)
      }
    }
  }
} finally {
  await prisma.$disconnect()
}
