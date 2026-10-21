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
 *     ⑤ 공식 dry-run 이 계획을 못 내는 결함 → exit 1 · v7 자기 계약 결함은 v8 기록 전 BLOCK · 뒤 승계 PASS
 *     ⑥ CLI 출력에 제목 · 본문 · Persona 코드가 없다 · CLI 는 DB 를 한 칸도 바꾸지 않는다(표 전체 스냅샷)
 *
 *   🔴 (v4 hotfix) source(v7) 상태는 **실제 운영 runtime 커밋 트리**(`source-snapshot-fixture` · e4d31d68)가 자기 코드로 센
 *      봉인 snapshot 으로만 넘긴다. v7 기록은 운영이 실제로 쓴 모양 그대로다(계약 v7 · 재검증 게이트 `draft-gates-v6.1`).
 *      앞판 fixture 는 v7 기록에 v8 게이트 판을 실어, target 코드가 source 를 다시 세도 맞아 보였다 — 그 결함을 덮었다.
 *     ⑤-c 옛 계약 행(v7 해소) + v7 자기 계약 행(v7 미해소) — source 미해소는 자기 계약 행 하나뿐 · 승계 1
 *     ⑦ snapshot 없음 · 손상 · 봉인 불일치 · 계약 불일치 · 게이트 판 불일치 · target 트리로 뜬 snapshot · 뒤에 바뀐 집합 → BLOCK
 *     ⑧ stage 뒤 source 결함 집합이 바뀌면(링크 · target 그대로여도) activate 대조 BLOCK
 *
 * 🔴 운영 DB 에 붙지 않는다(sentinel · localhost · soran_test). 임시 HOME 아래 artifact 정본만 쓴다.
 *    `auto-ready:defect-resolution-db-check` 가 통과한 뒤 같은 CI step 에서 이 파일을 부른다(그 파일 끝의 import).
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'

import { AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-v2'
import { authoritativeGate, unresolvedDefectCount } from '../src/lib/auto-ready-repo'
import { applyDefectResolution, planDefectResolution } from '../src/lib/auto-ready-defect-resolution-store'
import { DEFECT_RESOLUTION_KEY, type DefectResolutionRecord } from '../src/lib/auto-ready-defect-resolution'
import { QUALITY_CONTRACT_KEY, currentQualityContract } from '../src/lib/quality-contract'
import { applyApprovedDefectResolution } from './lib/defect-resolution-approval.mjs'
import { makeReverifyContextLoader } from './lib/defect-reverify-context.mjs'
import { LIFE_FIXTURES } from './lib/life-gate-fixtures.mjs'
import { FIXTURE_NOW } from './lib/draft-gate-fixtures.mjs'
import { judgeTransition, markText, unresolvedUnder } from './lib/quality-contract-transition.mjs'
import { openRuntimeTree, snapshotToFile, RUNTIME_FIXTURE_SHA } from './lib/source-snapshot-fixture.mjs'
import { readSealedSnapshot, sealSnapshot, snapshotDigestOf, takeSourceSnapshot } from './lib/source-snapshot.mjs'
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
/** 🔴 운영 runtime 의 초안 게이트 판 — v7 이 쓴 해소 기록의 `reverify.gateVersion` */
const V7_GATE = 'draft-gates-v6.1'
/** 🔴 source snapshot 파일 — 배포기의 `contract-source-<SHA>.json` 과 같은 역할 */
const SRC = join(SCRATCH, 'contract-source.json')
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
/** 🔴 v7 코드가 실제로 쓴 기록의 모양 — 같은 재검증 · 같은 감사 지문 · 계약 v7 · 게이트 판 v7 */
const v7RecordOf = (r: DefectResolutionRecord): DefectResolutionRecord =>
  ({ ...r, qualityContract: V7, reverify: { ...r.reverify, gateVersion: V7_GATE } })

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
      note: `[auto-ready-semantic-audit-v1 outcome=measured binding=fx artifact=${a.artifactId} persona=P04 card=fx] 결함 fixture`,
      auditContractVersion: AUDIT_CONTRACT_VERSION, auditModel: 'rule:integrity-safety-audit+claude-haiku-4.5',
      auditPromptVersion: 'integrity-safety-v1+semantic-audit-prompt-v1',
    },
  })
  return a
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 품질 계약 전환 preflight — 격리 DB · 실제 CLI · 공식 dry-run · source 는 실제 runtime 트리 ══\n')
  const home = join(SCRATCH, 'home')
  mkdirSync(home, { recursive: true })
  const TARGET = currentQualityContract()
  check(`전제 — target 은 이 코드의 계약(${TARGET.version}) · runtime 은 v7 · 둘이 다르다`, TARGET.version !== V7.version && TARGET.digest !== V7.digest)
  const env = { ...process.env, HOME: home }
  // 🔴 source runtime 트리 — 운영 보조 Mac 의 runtime 커밋 그대로(시험이 끝나면 지운다)
  const rt = openRuntimeTree(ROOT)
  process.on('exit', rt.cleanup)
  /** 🔴 배포기 `snapshotSource` 와 같다 — runtime 트리에서 게이트 판 · snapshot 을 떠 SRC 에 봉인 */
  const sourceNow = () => {
    const s = snapshotToFile(rt, SRC, env)
    if (s === null) throw new Error('runtime 트리에서 source snapshot 을 뜨지 못했다')
    return s
  }
  const s0 = sourceNow()
  check(`🔴 🔴 **실제 runtime ${RUNTIME_FIXTURE_SHA.slice(0, 8)} 트리에서 source snapshot 을 뜬다 — 계약 v7 · 게이트 ${V7_GATE}**`,
    s0.gate === V7_GATE && (readSealedSnapshot(readFileSync(SRC, 'utf8')) as { ok: boolean; snapshot?: { contract: unknown } }).ok
    && stableJson((readSealedSnapshot(readFileSync(SRC, 'utf8')) as { snapshot: { contract: unknown } }).snapshot.contract) === stableJson(V7), JSON.stringify(s0))
  /** 🔴 CLI — 기본은 배포기처럼 그 자리에서 snapshot 을 새로 뜨고 넘긴다. `keep` 은 SRC 를 그대로 · `none` 은 source 인자 0 */
  const run = (args: string[], o: { source?: 'fresh' | 'keep' | 'none'; gate?: string; file?: string } = {}) => {
    const mode = o.source ?? 'fresh'
    if (mode === 'fresh') sourceNow()
    const src = mode === 'none' ? [] : [`--runtime-gate=${o.gate ?? V7_GATE}`, `--source-snapshot=${o.file ?? SRC}`]
    return spawnSync(TSX, [CLI, ...args, ...src], { cwd: ROOT, env, encoding: 'utf8' })
  }
  const tables = async (): Promise<string> => stableJson({
    audit: await prisma.autoReadyAudit.findMany({ orderBy: { queueId: 'asc' } }),
    queue: await prisma.originalPostApprovalQueue.findMany({ orderBy: { id: 'asc' } }),
    post: await prisma.post.findMany({ orderBy: { id: 'asc' }, select: { id: true, title: true, content: true, updatedAt: true } }),
  })
  const loadDefects = async () => {
    const audits = await prisma.autoReadyAudit.findMany({ where: { defect: 'yes' } })
    const rows = await prisma.originalPostApprovalQueue.findMany({
      where: { id: { in: audits.map((a) => a.queueId) } },
      select: { id: true, createdPostId: true, draftTitle: true, draftBody: true, gateResults: true, editDiff: true },
    })
    return { audits, queues: new Map(rows.map((q) => [q.id, q])) }
  }
  /**
   * 🔴 결함 축 — v7 은 **runtime 트리(v7 코드)** 가 센 값, target 은 이 코드의 값.
   *    `v7AsTarget` 은 hotfix 전 결함(target 코드로 v7 기록을 다시 셈)의 재현 — 판정에 쓰지 않는다.
   */
  const defectState = async () => {
    const { audits, queues } = await loadDefects()
    const s = sourceNow()
    return { v7: s.unresolved.length, v7Unresolved: s.unresolved, v7Resolved: s.resolved,
      v7AsTarget: unresolvedUnder(audits, queues, V7).length, target: unresolvedUnder(audits, queues, TARGET).length }
  }
  const field = (out: string, re: RegExp): string | null => re.exec(out)?.[1] ?? null

  await wipeAuditFixtures(prisma)
  const f = newFixture(prisma, home)
  const contextOf = makeReverifyContextLoader({ artifactDir: f.artifactDir })
  await seedEvidence(f, 30)

  console.log('① 🔴 v7 해소 기록만 있는 결함 — Batch B 배포 장애의 모양 (옛 계약 행 · cmunjakqf 모양)')
  const A = await defectRow(f, BLOCKED)
  const pA = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
  if (pA.kind !== 'plan') throw new Error(`fixture 계획 실패 ${JSON.stringify(pA)}`)
  // 🔴 v7 코드가 썼을 기록 — 같은 재검증 · 같은 감사 지문 · 계약 v7 · 게이트 판 v7(정본 쓰기는 지금 코드 계약만 쓰므로 격리 DB 에 직접 넣는다)
  const v7Record = v7RecordOf(pA.plan.record)
  const qA0 = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: A.queueId }, select: { editDiff: true } })
  await prisma.originalPostApprovalQueue.update({
    where: { id: A.queueId }, data: { editDiff: { ...rec(qA0.editDiff), [DEFECT_RESOLUTION_KEY]: [v7Record] } as Prisma.InputJsonValue },
  })
  const s1 = await defectState()
  check('🔴 🔴 **v7 runtime 코드에서는 해소 — runtime 결함 축 0 (실제 runtime 트리가 셌다)**', s1.v7 === 0 && s1.v7Resolved.includes(A.queueId), JSON.stringify(s1))
  check('🔴 🔴 **재현 — target 코드로 v7 기록을 다시 세면 1 (게이트 판 v6.1 ≠ v8 · hotfix 전 결함의 원인)**', s1.v7AsTarget === 1, JSON.stringify(s1))
  check('🔴 🔴 **v8 코드에서는 미해소 1 — 정본 unresolvedDefectCount 도 1 · gate 닫힘**',
    s1.target === 1 && await unresolvedDefectCount(prisma) === 1 && !(await authoritativeGate(prisma, ON)).open, JSON.stringify(s1))
  const snap1 = await tables()
  const r1 = run([`--runtime=${markText(V7)}`])
  check('🔴 🔴 **target 미해소 1 → CLI exit 1 · BLOCK TARGET_UNRESOLVED · staged 해소 안내 · runtime(source) 0**', r1.status === 1 && /verdict=BLOCK code=TARGET_UNRESOLVED/.test(r1.stdout) && /--staged/.test(r1.stdout)
    && new RegExp(`target=${TARGET.version}:[0-9a-f]{64} unresolved=1`).test(r1.stdout)
    && new RegExp(`runtime=quality-v7:[0-9a-f]{64} gate=${V7_GATE} unresolved=0`).test(r1.stdout), `${r1.status} ${r1.stdout}${r1.stderr}`)
  check('🔴 CLI 는 write 0 — 감사·큐·글 표 전체 그대로', await tables() === snap1)
  const planDigest = field(r1.stdout, new RegExp(`defect queue=${A.queueId} plan=plan digest=([0-9a-f]{64}) expect=1:0`))
  const official = spawnSync(TSX, [RESOLVER, `--queue=${A.queueId}`], { cwd: ROOT, env, encoding: 'utf8' })
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
    check('🔴 🔴 **runtime 을 target 으로 우겨도 → source snapshot(v7) 과 계약 불일치 → BLOCK exit 1**',
      asTarget.status === 1 && /code=SOURCE_SNAPSHOT_INVALID/.test(asTarget.stdout) && /source 계약 불일치/.test(asTarget.stdout), asTarget.stdout)
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
      `--digest=${officialDigest ?? ''}`, '--expect=1:0', '--reason=db-check'], { cwd: ROOT, env, encoding: 'utf8' })
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
    check('🔴 🔴 **v7 결함 축 0 그대로 (v8 기록은 v7 판정을 흔들지 않는다 · runtime 트리가 셌다) · target 0**', s4.v7 === 0 && s4.target === 0, JSON.stringify(s4))
    check('🟢 v8 코드의 gate 열림', (await authoritativeGate(prisma, ON)).open)
    const snap4 = await tables()
    const r4 = run([`--runtime=${markText(V7)}`])
    check('🟢 🟢 **CLI exit 0 · PASS NO_UNRESOLVED (v7=0 · v8=0)**', r4.status === 0 && /verdict=PASS code=NO_UNRESOLVED/.test(r4.stdout)
      && /unresolved=0/.test(r4.stdout) && !/source-unresolved/.test(r4.stdout), r4.stdout)
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

  console.log('\n⑤-b 🔴 v7 계약 자신의 행이 낸 결함(cmv689 모양) — v7 에서는 어떤 기록으로도 해소되지 않는다')
  const N = await defectRow(f, BLOCKED, V7)
  {
    const pN = await planDefectResolution(prisma, { queueId: N.queueId, contextOf, now: new Date() })
    // 🔴 v7 기록을 v7 모양 그대로 넣어도 — v7 코드의 정본 전제는 "지금 계약 행" 이라 미해소다
    if (pN.kind === 'plan') {
      const qN = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: N.queueId }, select: { editDiff: true } })
      await prisma.originalPostApprovalQueue.update({
        where: { id: N.queueId }, data: { editDiff: { ...rec(qN.editDiff), [DEFECT_RESOLUTION_KEY]: [v7RecordOf(pN.plan.record)] } as Prisma.InputJsonValue },
      })
    }
    const sN = await defectState()
    check('🔴 🔴 **live v7 — 옛 계약 행 A 는 해소 · v7 자기 계약 행 N 만 미해소 (실제 runtime 트리가 셌다)**', pN.kind === 'plan' && sN.v7 === 1
      && sN.v7Unresolved[0] === N.queueId && sN.v7Resolved.includes(A.queueId), JSON.stringify(sN))
    check('🔴 🔴 **target v8 — A 는 1차 v8 기록으로 해소 · N 만 미해소**', sN.target === 1, JSON.stringify(sN))
    const rN = run([`--runtime=${markText(V7)}`])
    check('🔴 🔴 **CLI — source 미해소는 N 하나 · NOT_OWN_CONTRACT 없음 · v8 기록 전이라 BLOCK TARGET_UNRESOLVED · 승계 UNLINKED**', rN.status === 1
      && /runtime=quality-v7:[0-9a-f]{64} gate=draft-gates-v6\.1 unresolved=1/.test(rN.stdout)
      && (rN.stdout.match(/source-unresolved queue=/g) ?? []).length === 1 && rN.stdout.includes(`source-unresolved queue=${N.queueId}`)
      && /code=TARGET_UNRESOLVED/.test(rN.stdout) && /UNLINKED/.test(rN.stdout) && !/NOT_OWN_CONTRACT/.test(rN.stdout)
      && !rN.stdout.includes(`defect queue=${A.queueId}`) && rN.stdout.includes(`defect queue=${N.queueId}`), rN.stdout)
    // 🔴 v8 정본 쓰기로 해소해도(target 0) — v7 은 여전히 미해소다. 승계로만 넘어간다
    const pN2 = await planDefectResolution(prisma, { queueId: N.queueId, contextOf, now: new Date() })
    const wN = pN2.kind === 'plan' ? await applyDefectResolution(prisma, { plan: pN2.plan, contextOf, now: new Date() }) : null
    const sN2 = await defectState()
    check('전제 — N 에 v8 해소 기록 append → target 0 · runtime(v7) 1 (N)', wN?.kind === 'written' && sN2.target === 0 && sN2.v7 === 1 && sN2.v7Unresolved[0] === N.queueId, JSON.stringify(sN2))
    const rN2 = run([`--runtime=${markText(V7)}`])
    check('🟢 🟢 **A(v7 해소 · v8 1차 해소) + N(v7 자기 계약 · 정확한 v8 공식 기록 1) → PASS SUCCESSION=1 · target 0**',
      rN2.status === 0 && /code=SUCCESSION/.test(rN2.stdout) && /runtime=quality-v7:[0-9a-f]{64} gate=draft-gates-v6\.1 unresolved=1/.test(rN2.stdout)
      && /succession=1 /.test(rN2.stdout) && new RegExp(`target=${TARGET.version}:[0-9a-f]{64} unresolved=0`).test(rN2.stdout), rN2.stdout)

    console.log('\n⑤-c 🔴 반례 — source 를 target 코드로 다시 세면(hotfix 전) 같은 DB 가 NOT_OWN_CONTRACT 로 막힌다')
    const { audits, queues } = await loadDefects()
    const sealed = readSealedSnapshot(readFileSync(SRC, 'utf8'))
    if (!sealed.ok) throw new Error(sealed.reason)
    const recomputed = unresolvedUnder(audits, queues, V7)
    const bad = judgeTransition({ runtime: V7, target: TARGET, audits, queues, plans: [], source: {
      gateVersion: V7_GATE, defects: audits.map((a) => ({ queueId: a.queueId, auditFingerprint: sealed.snapshot.defects.find((d) => d.queueId === a.queueId)?.auditFingerprint ?? '', resolved: !recomputed.includes(a.queueId) })) } })
    const good = judgeTransition({ runtime: V7, target: TARGET, audits, queues, plans: [], source: { gateVersion: sealed.snapshot.gateVersion, defects: sealed.snapshot.defects } })
    check('🔴 🔴 **target 코드로 다시 센 source → A 부활 · BLOCK SUCCESSION_BROKEN NOT_OWN_CONTRACT (hotfix 가 막는 결함)**',
      recomputed.includes(A.queueId) && bad.verdict === 'BLOCK' && bad.code === 'SUCCESSION_BROKEN' && JSON.stringify(bad).includes('NOT_OWN_CONTRACT'), JSON.stringify(bad).slice(0, 300))
    check('🟢 같은 DB · runtime 트리 snapshot → PASS SUCCESSION', good.verdict === 'PASS' && good.code === 'SUCCESSION' && good.succession.length === 1, JSON.stringify(good).slice(0, 300))
  }

  console.log('\n⑦ 🔴 source snapshot 을 읽거나 믿을 수 없으면 fail-closed — 전부 BLOCK · write 0')
  {
    const base = run([`--runtime=${markText(V7)}`])
    check('대조 — 같은 상태 · 정상 snapshot 은 PASS SUCCESSION', base.status === 0 && /code=SUCCESSION/.test(base.stdout), base.stdout.slice(0, 200))
    const good = readFileSync(SRC, 'utf8')
    const snap7 = await tables()
    const blocked = (r: ReturnType<typeof run>, why: RegExp): boolean => r.status === 1 && /verdict=BLOCK code=SOURCE_SNAPSHOT_INVALID/.test(r.stdout) && why.test(r.stdout)
    const noArgs = run([`--runtime=${markText(V7)}`], { source: 'none' })
    check('🔴 source 인자 없음 → exit 2 NO_SOURCE_IDENTITY', noArgs.status === 2 && /NO_SOURCE_IDENTITY/.test(noArgs.stderr), noArgs.stderr)
    const missing = run([`--runtime=${markText(V7)}`], { source: 'keep', file: join(SCRATCH, 'no-such-source.json') })
    check('🔴 🔴 **snapshot 파일 없음 → BLOCK**', blocked(missing, /파일이 없다/), missing.stdout)
    const F = join(SCRATCH, 'source-forged.json')
    writeFileSync(F, good.slice(0, Math.floor(good.length / 2)), 'utf8')
    const corrupt = run([`--runtime=${markText(V7)}`], { source: 'keep', file: F })
    check('🔴 🔴 **snapshot 손상(잘림) → BLOCK**', blocked(corrupt, /손상/), corrupt.stdout)
    const j = JSON.parse(good) as { snapshot: { defects: { queueId: string; resolved: boolean }[]; contract: unknown; gateVersion: string }; digest: string }
    const flip = structuredClone(j)
    for (const d of flip.snapshot.defects) d.resolved = true
    writeFileSync(F, JSON.stringify(flip), 'utf8')
    const edited = run([`--runtime=${markText(V7)}`], { source: 'keep', file: F })
    check('🔴 🔴 **봉인 뒤 편집(해소 여부를 바꿈) → BLOCK 봉인 불일치**', blocked(edited, /봉인/), edited.stdout)
    const asV8 = readSealedSnapshot(good)
    if (!asV8.ok) throw new Error(asV8.reason)
    writeFileSync(F, sealSnapshot({ ...asV8.snapshot, contract: TARGET }), 'utf8')
    const wrongContract = run([`--runtime=${markText(V7)}`], { source: 'keep', file: F })
    check('🔴 🔴 **다시 봉인해도 계약이 runtime 과 다르면 → BLOCK 계약 불일치**', blocked(wrongContract, /source 계약 불일치/), wrongContract.stdout)
    const wrongGate = run([`--runtime=${markText(V7)}`], { source: 'keep', gate: 'draft-gates-v8' })
    check('🔴 🔴 **runtime 게이트 판이 snapshot 과 다르면 → BLOCK 게이트 판 불일치**', blocked(wrongGate, /게이트 판 불일치/), wrongGate.stdout)
    writeFileSync(F, sealSnapshot({ ...asV8.snapshot, gateVersion: 'draft-gates-v8' }), 'utf8')
    const forgedGate = run([`--runtime=${markText(V7)}`], { source: 'keep', file: F })
    check('🔴 🔴 **snapshot 게이트 판만 v8 로 다시 봉인 → BLOCK 게이트 판 불일치**', blocked(forgedGate, /게이트 판 불일치/), forgedGate.stdout)
    // 🔴 target 트리(이 저장소)에서 뜬 snapshot — target 판정기로 센 source 다. 계약이 v8 이라 막힌다
    const fromTarget = takeSourceSnapshot(ROOT, env)
    if (fromTarget !== null) writeFileSync(F, sealSnapshot(fromTarget), 'utf8')
    const tgt = run([`--runtime=${markText(V7)}`], { source: 'keep', file: F })
    check('🔴 🔴 **target 트리에서 뜬 snapshot(target 판정기로 센 source) → BLOCK 계약 불일치**', fromTarget !== null && fromTarget.contract.version === TARGET.version
      && blocked(tgt, /source 계약 불일치/), tgt.stdout)
    // 🔴 snapshot 뒤 결함 집합이 바뀌었다 — 새 확정 결함
    sourceNow()
    const X = await defectRow(f, BLOCKED)
    const stale = run([`--runtime=${markText(V7)}`], { source: 'keep' })
    check('🔴 🔴 **snapshot 뒤 새 확정 결함 → BLOCK 집합 바뀜**', blocked(stale, /결함 집합이 바뀌었다 — 새 1/), stale.stdout)
    await prisma.autoReadyAudit.delete({ where: { queueId: X.queueId } })
    // 🔴 snapshot 뒤 감사 행이 바뀌었다 — 같은 큐 · 다른 지문
    sourceNow()
    const noteN = (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: N.queueId } })).note
    await prisma.autoReadyAudit.update({ where: { queueId: N.queueId }, data: { note: `${noteN ?? ''} ·` } })
    const changed = run([`--runtime=${markText(V7)}`], { source: 'keep' })
    check('🔴 🔴 **snapshot 뒤 감사 행이 바뀜 → BLOCK**', blocked(changed, /감사 행 바뀜 1/), changed.stdout)
    // 되돌린다 — 감사 지문이 원래대로 돌아와야 N 의 기록이 다시 맞는다(⑧ 이 같은 상태에서 시작한다)
    await prisma.autoReadyAudit.update({ where: { queueId: N.queueId }, data: { note: noteN } })
    // 시험이 직접 만든 X 행 · 고쳤다 되돌린 N 감사 행 말고는 그대로 — CLI 는 한 칸도 쓰지 않았다
    const notX = (t: string) => stableJson((JSON.parse(t) as { queue: { id: string }[] }).queue.filter((q) => q.id !== X.queueId))
    check('fail-closed 시도 전부 CLI write 0', notX(await tables()) === notX(snap7)
      && stableJson((JSON.parse(await tables()) as { audit: unknown[] }).audit) === stableJson((JSON.parse(snap7) as { audit: unknown[] }).audit))
  }

  console.log('\n⑧ 🔴 stage 뒤 source 결함 집합이 바뀌면 activate 대조 BLOCK (링크 · target 그대로여도)')
  {
    const SUCC = join(SCRATCH, 'contract-succession.json')
    rmSync(SUCC, { force: true })
    const st = run([`--runtime=${markText(V7)}`, `--record-succession=${SUCC}`])
    check('stage — PASS SUCCESSION=1 · 승계 집합을 남긴다', st.status === 0 && /succession=1 /.test(st.stdout) && /CONTRACT_SUCCESSION_STAGED/.test(st.stdout), st.stdout.slice(0, 400))
    const same = run([`--runtime=${markText(V7)}`, `--verify-succession=${SUCC}`])
    check('대조 — 그대로면 activate 대조 PASS', same.status === 0, same.stdout.slice(0, 300))
    // 🔴 양쪽에서 모두 해소된 옛 계약 행 결함 B — 링크 · target 미해소는 그대로, source 집합만 바뀐다
    const B = await defectRow(f, BLOCKED)
    const pB = await planDefectResolution(prisma, { queueId: B.queueId, contextOf, now: new Date() })
    if (pB.kind !== 'plan') throw new Error('B 계획 실패')
    const qB = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: B.queueId }, select: { editDiff: true } })
    await prisma.originalPostApprovalQueue.update({ where: { id: B.queueId }, data: { editDiff: { ...rec(qB.editDiff), [DEFECT_RESOLUTION_KEY]: [v7RecordOf(pB.plan.record)] } as Prisma.InputJsonValue } })
    const pB2 = await planDefectResolution(prisma, { queueId: B.queueId, contextOf, now: new Date() })
    const wB = pB2.kind === 'plan' ? await applyDefectResolution(prisma, { plan: pB2.plan, contextOf, now: new Date() }) : null
    const sB = await defectState()
    check('전제 — B 는 v7 · v8 모두 해소 · source 미해소 N 하나 · target 0', wB?.kind === 'written' && sB.v7 === 1 && sB.target === 0 && sB.v7Resolved.includes(B.queueId), JSON.stringify(sB))
    const after = run([`--runtime=${markText(V7)}`, `--verify-succession=${SUCC}`])
    check('🔴 🔴 **stage 뒤 source 집합이 바뀌었다 → activate BLOCK SUCCESSION_DIGEST_MISMATCH**', after.status === 1 && /SUCCESSION_DIGEST_MISMATCH/.test(after.stdout), after.stdout.slice(0, 300))
    await prisma.autoReadyAudit.delete({ where: { queueId: B.queueId } })
    await prisma.autoReadyAudit.delete({ where: { queueId: N.queueId } })
  }

  console.log('\n⑥ 출력 — 판 · digest · 건수 · 코드 · 큐 id 뿐')
  {
    const out = `${r1.stdout}${r1.stderr}`
    const words = [BLOCKED.draft.title, ...BLOCKED.draft.body.split(/\n+/).filter((x) => x.trim().length >= 6), BLOCKED.source.title]
    check('🔴 제목 · 본문 · 원문 제목이 출력에 없다', words.every((w) => !out.includes(w.trim())), words.find((w) => out.includes(w.trim())) ?? '')
    check('🔴 Persona 코드 · DB 주소가 출력에 없다', !/\bP04\b/.test(out) && !out.includes('postgresql://') && !out.includes('127.0.0.1'))
    const sealed = readSealedSnapshot(readFileSync(SRC, 'utf8'))
    check('🔴 snapshot 파일에도 판 · digest · 큐 id · 감사 지문 · 해소 여부뿐 (글자 · DB 주소 0)', sealed.ok && snapshotDigestOf(sealed.snapshot) === sealed.digest
      && !readFileSync(SRC, 'utf8').includes(BLOCKED.draft.title) && !readFileSync(SRC, 'utf8').includes('postgresql://'))
  }

  rt.cleanup()
  await wipeAuditFixtures(prisma)
  await prisma.$disconnect()
  rmSync(SCRATCH, { recursive: true, force: true })
  console.log(`\n결과: ${pass} 통과 · ${fail} 실패\n`)
  if (fail > 0) process.exit(1)
  // 🔴 stage → resolve → recheck → activate · 실패 rollback — 같은 CI step · 같은 격리 DB. 실패하면 그 파일이 1 로 끝낸다
  await import('./quality-contract-deploy-db-check.mjs')
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })
