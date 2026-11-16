#!/usr/bin/env tsx
/**
 * 운영자 이름 명단 — 🔴 기본 dry-run (write 0)
 *
 *   npx tsx scripts/operator-writer-roster.mts                    # read-only 미리보기
 *   npx tsx scripts/operator-writer-roster.mts --show-db-notes    # DB note 포함 미리보기
 *   npx tsx scripts/operator-writer-roster.mts --json
 *   # 격리 DB(127.0.0.1 soran_test) 적용
 *   DATABASE_URL=postgresql://soran@127.0.0.1:54329/soran_test DIRECT_URL=$DATABASE_URL \
 *     npx tsx scripts/operator-writer-roster.mts --apply --expect=<64자리> --reason="…"
 *   # 🔴 운영 적용 — 창업자 승인 뒤, main 에 병합된 깨끗한 checkout 에서만
 *   npx tsx scripts/operator-writer-roster.mts --apply --production --target=<origin/main 40자리> \
 *     --expect=<미리보기의 계획 지문 64자리> --reason="…"
 *
 * 🔴 운영 apply 는 셸의 DATABASE_URL 을 믿지 않는다 — canonical env 를 읽어 덮는다.
 * 🔴 D100 자동 Persona(P01~) 확장이 아니다. 공급·발행·Persona·댓글·stage·runtime 과 무관하다.
 * 🔴 출력은 code · 개수 · 충돌 **종류**뿐이다. 회원 닉네임·이름·DB 주소를 찍지 않는다.
 * 🔴 종료 코드: same/applicable 0 · stop 1 · refuse 2.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

import { fillDbConnection } from './lib/ops-signals.mjs'
import {
  applyRoster, collectProductionFacts, decideMode, decideProductionTime,
  isIsolatedUrl, judgeProduction, judgeRoster, loadRoster, readRosterFacts, verifyAfter,
} from './lib/operator-writer-roster.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

const roster = loadRoster()

// 🔴 모드는 DB 에 붙기 **전에** 정한다 — 거부면 연결 0 · write 0
const mode = decideMode(argv, process.env.DATABASE_URL ?? '')
function refuse(problems: readonly string[]): never {
  console.error('🔴 열지 않는다 — 아무것도 쓰지 않았다')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}
if (mode.kind === 'refuse') refuse(mode.problems)

if (mode.kind === 'apply-production') {
  // P11 시간 가드 — 운영 적용만 걸린다
  const timeGuard = decideProductionTime(new Date())
  if (!timeGuard.ok) refuse([timeGuard.reason])
  const facts = collectProductionFacts(SCRIPT_DIR, process.env)
  const problems = judgeProduction(facts, mode.target)
  if (problems.length > 0) refuse(problems)
  // 🔴 셸에서 물려받은 주소를 버리고 canonical 값으로 덮는다
  process.env.DATABASE_URL = facts.env.databaseUrl
  process.env.DIRECT_URL = facts.env.directUrl
  console.log(`🔴 운영 DB 적용 · target ${mode.target} · 사유: ${mode.reason}`)
} else if (mode.kind === 'dry-run' || mode.kind === 'dry-run-show-db-notes') {
  if (!fillDbConnection()) refuse(['DB 주소가 없다 — DATABASE_URL 을 설정하거나 .env.local 을 둔다'])
} else if (mode.kind === 'apply-isolated') {
  // 🔴 canonical env 를 읽지 않는다(fillDbConnection 금지) — 비어 있는 DIRECT_URL 이 운영 값으로 채워지면
  //    격리 적용 프로세스에 운영 주소가 섞인다. DIRECT_URL 은 비우거나(→ 격리 DATABASE_URL) 격리 주소여야 한다.
  const direct = process.env.DIRECT_URL ?? ''
  if (direct === '') process.env.DIRECT_URL = process.env.DATABASE_URL
  else if (!isIsolatedUrl(direct)) refuse(['격리 적용인데 DIRECT_URL 이 격리 DB 주소가 아니다'])
}

const prisma = new PrismaClient()
try {
  if (mode.kind === 'dry-run' || mode.kind === 'dry-run-show-db-notes') {
    const facts = await readRosterFacts(prisma)
    const verdict = judgeRoster(roster, facts)
    if (JSON_OUT) {
      const out = {
        mode: 'dry-run · read-only (DB write 0)',
        verdictKind: verdict.kind,
        rosterEntries: roster.writers.length,
        ignoredPv: facts.ignoredPv,
        ignoredOther: facts.ignoredOther,
        diagnostics: facts.totals,
        changes: verdict.kind === 'applicable' ? verdict.changes : [],
        planDigest: verdict.kind === 'applicable' ? verdict.planDigest : null,
        problems: verdict.kind === 'stop' ? verdict.problems : [],
        applyCommand: verdict.kind === 'applicable'
          ? `npm run operator:roster -- --apply [--production --target=<origin/main 40자리>] --expect=${verdict.planDigest} --reason="<승인 사유>"`
          : null,
        dbNotes: mode.kind === 'dry-run-show-db-notes'
          ? facts.writers.map((w) => ({ code: w.code, dbNote: w.note }))
          : undefined,
      }
      console.log(JSON.stringify(out, null, 2))
    } else {
      console.log('\n══ 운영자 이름 명단 — dry-run (DB write 0) ══\n')
      console.log(`   명단 ${roster.writers.length}행 · DB OP ${facts.writers.length}행 · 무시(PV) ${facts.ignoredPv} · 무시(기타) ${facts.ignoredOther}`)
      console.log(`   진단(판정에 안 씀): User ${facts.totals.users} · Account ${facts.totals.accounts} · Persona ${facts.totals.personas}`)
      if (verdict.kind === 'same') {
        console.log('\n   ✅ 판정: same — 명단과 DB 가 같다. 변경 없음')
      } else if (verdict.kind === 'applicable') {
        const creates = verdict.changes.filter((c) => c.op === 'create').length
        const notes = verdict.changes.filter((c) => c.op === 'note').length
        const retires = verdict.changes.filter((c) => c.op === 'retire').length
        console.log(`\n   📋 판정: applicable — 변경 ${verdict.changes.length}건 (create ${creates} · note ${notes} · retire ${retires})`)
        for (const c of verdict.changes) {
          if (c.op === 'create') console.log(`   + create ${c.code}`)
          else if (c.op === 'note') console.log(`   ~ note   ${c.code}`)
          else if (c.op === 'retire') console.log(`   - retire ${c.code}`)
        }
        console.log(`\n   계획 지문: ${verdict.planDigest}`)
        console.log(`\n   적용(🔴 창업자 승인 뒤에만):`)
        console.log(`     npm run operator:roster -- --apply --production --target=<origin/main 40자리> \\`)
        console.log(`       --expect=${verdict.planDigest} --reason="<승인 사유>"`)
      } else {
        // stop
        console.log('\n   🔴 판정: stop — 아래 문제를 해결한 뒤 다시 미리보기')
        for (const p of verdict.problems) console.log(`   · ${p}`)
      }
      if (mode.kind === 'dry-run-show-db-notes') {
        console.log('\n   ── DB note (OP01~90) ──')
        for (const w of facts.writers) {
          const dbNote = w.note ?? '(null)'
          console.log(`   ${w.code}: ${dbNote}`)
        }
      }
      console.log('')
    }
    process.exitCode = verdict.kind === 'stop' ? 1 : 0
  } else {
    // apply-isolated or apply-production
    const r = await applyRoster(prisma, {
      approvedPlanDigest: mode.approvedPlanDigest,
      roster,
      reason: mode.reason,
    })
    if (!r.ok) {
      console.error(`🔴 ${r.reason} — 아무것도 남기지 않았다(트랜잭션 rollback)`)
      for (const p of r.problems) console.error(`   · ${p}`)
      process.exitCode = 1
    } else {
      // 🔴 커밋 뒤 새로 읽어 한 번 더 검증 — 행 단위 판정, 전체 수는 진단만
      const after = await readRosterFacts(prisma)
      const v = verifyAfter(r.before, after, roster)
      const d = v.diagnostics
      const diag = `진단 User ${d.usersDelta >= 0 ? '+' : ''}${d.usersDelta} · Account ${d.accountsDelta >= 0 ? '+' : ''}${d.accountsDelta} · Persona ${d.personasDelta >= 0 ? '+' : ''}${d.personasDelta}`
      if (v.problems.length > 0) {
        console.error(`🔴 커밋 뒤 검증 실패 — 사람이 본다 (${diag})`)
        for (const p of v.problems) console.error(`   · ${p}`)
        process.exitCode = 1
      } else {
        const created = r.created, noted = r.noted, retired = r.retired
        console.log(`✅ 적용 완료 — create ${created} · note ${noted} · retire ${retired}`)
        console.log(`   ${diag} (무관한 동시 가입이 있으면 User·Account 는 더 움직일 수 있다)`)
        console.log(`   사유: ${mode.reason}`)
      }
    }
  }
} finally {
  await prisma.$disconnect()
}
