#!/usr/bin/env tsx
/**
 * 🔴 **품질 계약 전환 preflight — 격리 Postgres 실행 반례** (2026-10-13 · PR #710 보정)
 *
 *   Batch B 배포 장애의 모양 그대로: 운영(runtime v7)이 쓴 해소 기록만 있는 확정 결함 하나.
 *   v7 코드에는 해소됐고(결함 축 0), v8 코드에는 미해소(결함 축 1)다. 이 상태로 v8 을 배포하면 자동 READY 가 닫힌다.
 *     ① v7 기록만 → target v8 미해소 1 → 실제 CLI exit 1 (BLOCK TARGET_UNRESOLVED) · runtime v7 미해소 0
 *     ② 우회 — 모르는 플래그 · runtime 빠짐 · runtime 을 target 으로 우겨도 · 옛 승인 플래그 → 전부 non-zero (승인 통과 경로 없음)
 *     ③ staged 운영 해소는 격리 env 에서 DB 에 붙기 전에 거절된다
 *     ④ 정본 쓰기로 v8 기록 append → target 미해소 0 · v7 기록 그대로 · v7 결함 축 0 그대로 · exit 0 (PASS)
 *     ⑤ 공식 dry-run 이 계획을 못 내는 결함 → exit 1 · v7 행의 결함 → RUNTIME_UNRESOLVED
 *     ⑥ CLI 출력에 제목 · 본문 · Persona 코드가 없다 · CLI 는 DB 를 한 칸도 바꾸지 않는다(표 전체 스냅샷)
 *
 * 🔴 운영 DB 에 붙지 않는다(sentinel · localhost · soran_test). 임시 HOME 아래 artifact 정본만 쓴다.
 *    `auto-ready:defect-resolution-db-check` 가 통과한 뒤 같은 CI step 에서 이 파일을 부른다(그 파일 끝의 import).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'

import { AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-v2'
import { authoritativeGate, unresolvedDefectCount } from '../src/lib/auto-ready-repo'
import { applyDefectResolution, planDefectResolution } from '../src/lib/auto-ready-defect-resolution-store'
import { DEFECT_RESOLUTION_KEY } from '../src/lib/auto-ready-defect-resolution'
import { SEMANTIC_AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-semantic-audit'
import { QUALITY_CONTRACT_KEY, currentQualityContract } from '../src/lib/quality-contract'
import { applyApprovedDefectResolution } from './lib/defect-resolution-approval.mjs'
import { makeReverifyContextLoader } from './lib/defect-reverify-context.mjs'
import { LIFE_FIXTURES } from './lib/life-gate-fixtures.mjs'
import { FIXTURE_NOW } from './lib/draft-gate-fixtures.mjs'
import { markText, unresolvedUnder } from './lib/quality-contract-transition.mjs'
import {
  requireIsolatedDb, wipeAuditFixtures, newFixture, seedEvidence, autoPublished, selectForAudit, flushArtifacts,
  type AutoPost, type Fixture,
} from './lib/auto-ready-audit-fixtures.mjs'

requireIsolatedDb()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const ON = { SORAN_AUTO_READY_ENABLED: 'on' } as const
const ROOT = process.cwd()
const TSX = join(ROOT, 'node_modules/.bin/tsx')
const CLI = join(ROOT, 'scripts/quality-contract-transition-check.mts')
const RESOLVER = join(ROOT, 'scripts/auto-ready-defect-resolve.mts')
const SCRATCH = mkdtempSync(join(tmpdir(), 'soran-contract-transition-'))
const LEGACY_MARK = { version: 'quality-v4', digest: '379bf6c61fe1431f928da2e44cde0731fdf1850a301b0c808378a6875be47daa' }
/** 🔴 운영 runtime 의 계약 — origin/main 11aed451 의 `quality-contract.fingerprint.json` 그대로 */
const V7 = { version: 'quality-v7', digest: 'ef9ff369253ee95de6707acd7a4c8de7cee294a9023c8a7833d64150b33bc8de' }
const BLOCKED = LIFE_FIXTURES.find((x) => x.queueId === 'counter-v6-peer-observation')!
const PASSING = LIFE_FIXTURES.find((x) => x.queueId === 'control-v6-peer-third-party')!

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))
const resolutionsOf = (editDiff: unknown): unknown[] => {
  const v = rec(editDiff)[DEFECT_RESOLUTION_KEY]
  return Array.isArray(v) ? v : []
}

/** 🔴 운영 결함과 같은 모양 — `auto-ready-defect-resolution-db-check` 의 fixture 와 같다(옛 계약 행 · 기계 의미 감사 yes) */
async function defectRow(f: Fixture, fx: typeof BLOCKED, mark: { version: string; digest: string } = LEGACY_MARK): Promise<AutoPost> {
  const a = await autoPublished(f, { personaCode: 'P04', title: fx.draft.title, body: fx.draft.body, sourceTitle: fx.source.title, sourceBody: fx.source.body })
  const art = f.artifacts.find((x) => x.artifactId === a.artifactId)!
  art.plan = { personaCode: 'P04', stance: 'QUESTION', selfBasis: null, warrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'], protectedFacts: [] }
  art.generatedAt = FIXTURE_NOW.toISOString()
  const cand = f.candidates.find((x) => x.artifactId === a.artifactId)!
  cand.sourcePostedAt = FIXTURE_NOW.toISOString()
  cand.sourceCapturedAt = FIXTURE_NOW.toISOString()
  flushArtifacts(f)
  const q = await f.prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.queueId }, select: { gateResults: true } })
  await f.prisma.originalPostApprovalQueue.update({
    where: { id: a.queueId }, data: { gateResults: { ...rec(q.gateResults), [QUALITY_CONTRACT_KEY]: mark } as Prisma.InputJsonValue },
  })
  await selectForAudit(f, a)
  await f.prisma.autoReadyAudit.update({
    where: { queueId: a.queueId },
    data: {
      defect: 'yes', judgedAt: f.now, auditor: 'model:semantic-audit:runner',
      note: `[${SEMANTIC_AUDIT_CONTRACT_VERSION} outcome=measured binding=fx artifact=${a.artifactId} persona=P04 card=fx] 결함 fixture`,
      auditContractVersion: AUDIT_CONTRACT_VERSION, auditModel: 'rule:integrity-safety-audit+claude-haiku-4.5',
      auditPromptVersion: 'integrity-safety-v1+semantic-audit-prompt-v1',
    },
  })
  return a
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 품질 계약 전환 preflight — 격리 DB · 실제 CLI · 공식 dry-run ══\n')
  const home = join(SCRATCH, 'home')
  mkdirSync(home, { recursive: true })
  const TARGET = currentQualityContract()
  check(`전제 — target 은 이 코드의 계약(${TARGET.version}) · runtime 은 v7 · 둘이 다르다`, TARGET.version !== V7.version && TARGET.digest !== V7.digest)
  const run = (args: string[]) => spawnSync(TSX, [CLI, ...args], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
  const tables = async (): Promise<string> => stableJson({
    audit: await prisma.autoReadyAudit.findMany({ orderBy: { queueId: 'asc' } }),
    queue: await prisma.originalPostApprovalQueue.findMany({ orderBy: { id: 'asc' } }),
    post: await prisma.post.findMany({ orderBy: { id: 'asc' }, select: { id: true, title: true, content: true, updatedAt: true } }),
  })
  const defectState = async () => {
    const audits = await prisma.autoReadyAudit.findMany({ where: { defect: 'yes' } })
    const rows = await prisma.originalPostApprovalQueue.findMany({
      where: { id: { in: audits.map((a) => a.queueId) } },
      select: { id: true, createdPostId: true, draftTitle: true, draftBody: true, gateResults: true, editDiff: true },
    })
    const qs = new Map(rows.map((q) => [q.id, q]))
    return { v7: unresolvedUnder(audits, qs, V7).length, target: unresolvedUnder(audits, qs, TARGET).length }
  }
  const field = (out: string, re: RegExp): string | null => re.exec(out)?.[1] ?? null

  await wipeAuditFixtures(prisma)
  const f = newFixture(prisma, home)
  const contextOf = makeReverifyContextLoader({ artifactDir: f.artifactDir })
  await seedEvidence(f, 30)

  console.log('① 🔴 v7 해소 기록만 있는 결함 — Batch B 배포 장애의 모양')
  const A = await defectRow(f, BLOCKED)
  const pA = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
  if (pA.kind !== 'plan') throw new Error(`fixture 계획 실패 ${JSON.stringify(pA)}`)
  // 🔴 v7 코드가 썼을 기록 — 같은 재검증 · 같은 감사 지문 · 계약만 v7(정본 쓰기는 지금 코드 계약만 쓰므로 격리 DB 에 직접 넣는다)
  const v7Record = { ...pA.plan.record, qualityContract: V7 }
  const qA0 = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: A.queueId }, select: { editDiff: true } })
  await prisma.originalPostApprovalQueue.update({
    where: { id: A.queueId }, data: { editDiff: { ...rec(qA0.editDiff), [DEFECT_RESOLUTION_KEY]: [v7Record] } as Prisma.InputJsonValue },
  })
  const s1 = await defectState()
  check('🔴 v7 계약에서는 해소 — runtime 결함 축 0', s1.v7 === 0, JSON.stringify(s1))
  check('🔴 🔴 **v8 코드에서는 미해소 1 — 정본 unresolvedDefectCount 도 1 · gate 닫힘**',
    s1.target === 1 && await unresolvedDefectCount(prisma) === 1 && !(await authoritativeGate(prisma, ON)).open, JSON.stringify(s1))
  const snap1 = await tables()
  const r1 = run([`--runtime=${markText(V7)}`])
  check('🔴 🔴 **target 미해소 1 → CLI exit 1 · BLOCK TARGET_UNRESOLVED · staged 해소 안내**', r1.status === 1 && /verdict=BLOCK code=TARGET_UNRESOLVED/.test(r1.stdout) && /--staged/.test(r1.stdout)
    && new RegExp(`target=${TARGET.version}:[0-9a-f]{64} unresolved=1`).test(r1.stdout) && /runtime=quality-v7:[0-9a-f]{64} unresolved=0/.test(r1.stdout), `${r1.status} ${r1.stdout}${r1.stderr}`)
  check('🔴 CLI 는 write 0 — 감사·큐·글 표 전체 그대로', await tables() === snap1)
  const planDigest = field(r1.stdout, new RegExp(`defect queue=${A.queueId} plan=plan digest=([0-9a-f]{64}) expect=1:0`))
  const official = spawnSync(TSX, [RESOLVER, `--queue=${A.queueId}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
  const officialDigest = field(official.stdout, /RESOLVE_APPROVAL digest=([0-9a-f]{64}) expect=1:0/)
  check('🔴 🔴 **CLI 가 낸 계획 digest = 공식 defect-resolve dry-run digest (expect 1:0)**',
    planDigest !== null && planDigest === officialDigest, `${planDigest} vs ${officialDigest} · ${official.stdout.slice(0, 200)}`)
  check('공식 dry-run 도 write 0', await tables() === snap1)

  console.log('\n② 🔴 우회 — 승인 통과 경로는 없다 · 전부 non-zero · write 0')
  {
    const force = run([`--runtime=${markText(V7)}`, '--force'])
    check('🔴 모르는 플래그(--force) → exit 2 (조용히 무시하지 않는다)', force.status === 2 && /UNKNOWN_ARG/.test(force.stderr), force.stderr)
    const noRt = run([])
    check('🔴 runtime 계약 없음 → exit 2', noRt.status === 2 && /NO_RUNTIME_CONTRACT/.test(noRt.stderr))
    const badRt = run(['--runtime=quality-v7:abc'])
    check('🔴 runtime 계약 모양이 깨짐 → exit 2', badRt.status === 2)
    const asTarget = run([`--runtime=${markText(TARGET)}`])
    check('🔴 🔴 **runtime 을 target 으로 우겨도(전환 아님) → target 미해소는 그대로 exit 1**',
      asTarget.status === 1 && /transition=no/.test(asTarget.stdout) && /unresolved=1/.test(asTarget.stdout), asTarget.stdout)
    const pd = planDigest ?? ''
    for (const [why, args] of [
      ['옛 승인 플래그', [`--approve-transition=${'0'.repeat(64)}`, `--defect-plan=${A.queueId}:${pd}`, '--reason=x']],
      ['계획 digest 만', [`--defect-plan=${A.queueId}:${pd}`]],
      ['reason 만', ['--reason=억지']],
    ] as const) {
      const r = run([`--runtime=${markText(V7)}`, ...args])
      check(`🔴 🔴 **${why} → exit 2 · 승인으로 여는 길이 없다**`, r.status === 2 && /UNKNOWN_ARG/.test(r.stderr), `${r.status} ${r.stderr.slice(0, 120)}`)
    }
    check('우회 시도 전부 write 0', await tables() === snap1)
  }

  console.log('\n③ 🔴 staged 운영 해소는 격리 env 에서 DB 에 붙기 전에 거절된다(가드 정본은 production-activation-check)')
  {
    const staged = spawnSync(TSX, [RESOLVER, `--queue=${A.queueId}`, '--apply', '--production', '--staged', `--target=${'a'.repeat(40)}`,
      `--digest=${officialDigest ?? ''}`, '--expect=1:0', '--reason=db-check'], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🔴 --staged 운영 플래그 + 격리 env → exit 2 · write 0', staged.status === 2 && await tables() === snap1, `${staged.status} ${staged.stderr.slice(0, 160)}`)
  }

  console.log('\n④ 공식 승인 적용(격리 DB = staging 해소와 같은 정본 쓰기)으로 v8 기록 append → target 0 · v7 기록과 v7 결함 축은 그대로')
  {
    const applied = await applyApprovedDefectResolution(prisma, {
      queueId: A.queueId, approval: { digest: officialDigest ?? '', expected: { before: 1, after: 0 }, reason: 'quality-v8 전환 db-check' }, contextOf, now: new Date(),
    })
    check('🟢 공식 승인 적용 → written 1 · 미해소 0', applied.kind === 'written' && applied.after === 0, JSON.stringify(applied))
    const recs = resolutionsOf((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: A.queueId } })).editDiff)
    check('🔴 🔴 **v7 기록은 한 글자도 그대로 · v8 기록이 뒤에 하나 덧붙었다**', recs.length === 2
      && stableJson(recs[0]) === stableJson(v7Record) && stableJson(rec(recs[1]).qualityContract) === stableJson(TARGET), stableJson(recs).slice(0, 200))
    const s4 = await defectState()
    check('🔴 🔴 **v7 결함 축 0 그대로 (지금 gate 를 흔들지 않는다) · target 0**', s4.v7 === 0 && s4.target === 0, JSON.stringify(s4))
    check('🟢 v8 코드의 gate 열림', (await authoritativeGate(prisma, ON)).open)
    const snap4 = await tables()
    const r4 = run([`--runtime=${markText(V7)}`])
    check('🟢 🟢 **CLI exit 0 · PASS NO_UNRESOLVED (v7=0 · v8=0)**', r4.status === 0 && /verdict=PASS code=NO_UNRESOLVED/.test(r4.stdout)
      && /unresolved=0/.test(r4.stdout), r4.stdout)
    check('CLI write 0', await tables() === snap4)
  }

  console.log('\n⑤ 🔴 공식 dry-run 이 계획을 못 내는 결함 → 어떤 승인으로도 못 연다')
  {
    const P = await defectRow(f, PASSING)
    const snap5 = await tables()
    const r5 = run([`--runtime=${markText(V7)}`])
    check('🔴 🔴 **재검증이 막지 않는 결함 → exit 1 · BLOCK · 계획 없음(NOT_BLOCKED) · 활성화 전 해소 불가 안내**', r5.status === 1 && /verdict=BLOCK/.test(r5.stdout) && /해소할 수 없다/.test(r5.stdout)
      && new RegExp(`defect queue=${P.queueId} plan=refuse code=NOT_BLOCKED`).test(r5.stdout), r5.stdout)
    const forced = run([`--runtime=${markText(V7)}`, `--defect-plan=${P.queueId}:${'2'.repeat(64)}`, '--reason=억지 승인'])
    check('🔴 🔴 **승인 흉내를 붙여도 열리지 않는다 (exit 2)**', forced.status === 2, forced.stderr)
    check('write 0', await tables() === snap5)
    await prisma.autoReadyAudit.delete({ where: { queueId: P.queueId } })
  }

  console.log('\n⑤-b 🔴 v7 계약 자신의 행이 낸 결함 — v7 에서는 어떤 기록으로도 해소되지 않는다')
  {
    const N = await defectRow(f, BLOCKED, V7)
    const pN = await planDefectResolution(prisma, { queueId: N.queueId, contextOf, now: new Date() })
    // 🔴 v7 기록을 손으로 맞춰 넣어도 — v7 코드의 정본 전제는 "지금 계약 행" 이라 미해소다
    if (pN.kind === 'plan') {
      const qN = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: N.queueId }, select: { editDiff: true } })
      await prisma.originalPostApprovalQueue.update({
        where: { id: N.queueId }, data: { editDiff: { ...rec(qN.editDiff), [DEFECT_RESOLUTION_KEY]: [{ ...pN.plan.record, qualityContract: V7 }] } as Prisma.InputJsonValue },
      })
    }
    const sN = await defectState()
    check('🔴 🔴 **v7 행의 결함은 v7 기록이 있어도 runtime 미해소 1 (그 계약 자신의 행)**', pN.kind === 'plan' && sN.v7 === 1, JSON.stringify(sN))
    const rN = run([`--runtime=${markText(V7)}`])
    check('🔴 CLI 가 runtime 미해소 1 로 보고 · BLOCK RUNTIME_UNRESOLVED (지금 gate 가 이미 닫혀 있으면 활성화하지 않는다)', rN.status === 1 && /runtime=quality-v7:[0-9a-f]{64} unresolved=1/.test(rN.stdout)
      && /code=RUNTIME_UNRESOLVED/.test(rN.stdout), rN.stdout)
    // 🔴 v8 정본 쓰기로 해소해도(target 0) — v7 은 여전히 미해소다. runtime 만 남은 상태도 막아야 한다
    const pN2 = await planDefectResolution(prisma, { queueId: N.queueId, contextOf, now: new Date() })
    const wN = pN2.kind === 'plan' ? await applyDefectResolution(prisma, { plan: pN2.plan, contextOf, now: new Date() }) : null
    const sN2 = await defectState()
    check('전제 — v8 해소 기록 append → target 0 · runtime(v7) 1', wN?.kind === 'written' && sN2.target === 0 && sN2.v7 === 1, JSON.stringify(sN2))
    const rN2 = run([`--runtime=${markText(V7)}`])
    check('🔴 🔴 **target 0 이어도 runtime 미해소 1 → exit 1 · RUNTIME_UNRESOLVED (v7=0 · v8=0 둘 다여야 PASS)**',
      rN2.status === 1 && /code=RUNTIME_UNRESOLVED/.test(rN2.stdout) && /runtime=quality-v7:[0-9a-f]{64} unresolved=1/.test(rN2.stdout), rN2.stdout)
    await prisma.autoReadyAudit.delete({ where: { queueId: N.queueId } })
  }

  console.log('\n⑥ 출력 — 판 · digest · 건수 · 코드 · 큐 id 뿐')
  {
    const out = `${r1.stdout}${r1.stderr}`
    const words = [BLOCKED.draft.title, ...BLOCKED.draft.body.split(/\n+/).filter((x) => x.trim().length >= 6), BLOCKED.source.title]
    check('🔴 제목 · 본문 · 원문 제목이 출력에 없다', words.every((w) => !out.includes(w.trim())), words.find((w) => out.includes(w.trim())) ?? '')
    check('🔴 Persona 코드 · DB 주소가 출력에 없다', !/\bP04\b/.test(out) && !out.includes('postgresql://') && !out.includes('127.0.0.1'))
  }

  await wipeAuditFixtures(prisma)
  await prisma.$disconnect()
  rmSync(SCRATCH, { recursive: true, force: true })
  console.log(`\n결과: ${pass} 통과 · ${fail} 실패\n`)
  if (fail > 0) process.exit(1)
  // 🔴 stage → resolve → recheck → activate · 실패 rollback — 같은 CI step · 같은 격리 DB. 실패하면 그 파일이 1 로 끝낸다
  await import('./quality-contract-deploy-db-check.mjs')
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
