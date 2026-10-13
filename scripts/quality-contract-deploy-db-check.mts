#!/usr/bin/env tsx
/**
 * 🔴 **품질 계약 전환 배포 — stage → resolve → recheck → activate (격리 Postgres)** (2026-10-13 · PR #710 마스터 재검토)
 *
 *   실제 `runDeploy` 오케스트레이션에 launchd · git 만 가짜로 붙이고, 전환 검사는 **실제 CLI**
 *   (`quality-contract-transition-check.mts`)를 격리 DB 에 대고 돈다. 해소는 정본 쓰기 경로(공식 승인 적용)다.
 *     ① stage   — v7 기록만 있는 결함: staging 전환 preflight BLOCK → 활성화 0 · job·SHA·pin·plist 그대로 · DB write 0
 *     ② resolve — 활성화 **전에** 정본 쓰기로 v8 기록 append(옛 runtime·job 은 그대로 loaded) · v7 결함 축 0 그대로
 *     ③ recheck — CLI PASS (v7=0 · v8=0)
 *     ④ activate — runDeploy 통과 · pin=target · job loaded · 활성화 뒤에도 v7 기록 그대로 · 미해소 0
 *     ⑤ rollback — staging 확인 뒤 새 결함이 생기면 checkout 뒤 재확인이 BLOCK → 직전 SHA·pin·manifest·plist·job 으로 되돌린다
 *     ⑥ 활성화 전에 해소할 수 없는 결함(공식 dry-run 이 계획을 못 낸다) → 배포 BLOCK · 해소 시도도 write 0
 *
 * 🔴 운영 DB 에 붙지 않는다(sentinel · localhost · soran_test). 임시 HOME 아래 artifact 정본만 쓴다.
 *    `quality-contract-transition-db-check` 끝에서 같은 CI step 으로 부른다.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'

import { AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-v2'
import { unresolvedDefectCount } from '../src/lib/auto-ready-repo'
import { planDefectResolution } from '../src/lib/auto-ready-defect-resolution-store'
import { DEFECT_RESOLUTION_KEY } from '../src/lib/auto-ready-defect-resolution'
import { SEMANTIC_AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-semantic-audit'
import { QUALITY_CONTRACT_KEY, currentQualityContract } from '../src/lib/quality-contract'
import { runDeploy, type DeployEffects } from '../src/lib/runtime-deploy'
import type { JobState } from '../src/lib/runtime-isolation'
import { applyApprovedDefectResolution, defectPlanDigestOf, expectationOf } from './lib/defect-resolution-approval.mjs'
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
const ROOT = process.cwd()
const TSX = join(ROOT, 'node_modules/.bin/tsx')
const CLI = join(ROOT, 'scripts/quality-contract-transition-check.mts')
const SCRATCH = mkdtempSync(join(tmpdir(), 'soran-contract-deploy-'))
const LEGACY_MARK = { version: 'quality-v4', digest: '379bf6c61fe1431f928da2e44cde0731fdf1850a301b0c808378a6875be47daa' }
/** 🔴 운영 runtime 의 계약 — origin/main 의 `quality-contract.fingerprint.json` 그대로 */
const V7 = { version: 'quality-v7', digest: 'ef9ff369253ee95de6707acd7a4c8de7cee294a9023c8a7833d64150b33bc8de' }
const BLOCKED = LIFE_FIXTURES.find((x) => x.queueId === 'counter-v6-peer-observation')!
const PASSING = LIFE_FIXTURES.find((x) => x.queueId === 'control-v6-peer-third-party')!
const PREV = 'a'.repeat(40)
const NEXT = 'b'.repeat(40)
const RT = '/fx/soransoran-runtime'
const JOBS = ['com.soransoran.fx-supply', 'com.soransoran.fx-collect']

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))
const resolutionsOf = (editDiff: unknown): unknown[] => {
  const v = rec(editDiff)[DEFECT_RESOLUTION_KEY]
  return Array.isArray(v) ? v : []
}

/** 🔴 운영 결함과 같은 모양 — 옛 계약 행 · 기계 의미 감사 yes(측정됨) */
async function defectRow(f: Fixture, fx: typeof BLOCKED): Promise<AutoPost> {
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
    where: { id: a.queueId }, data: { gateResults: { ...rec(q.gateResults), [QUALITY_CONTRACT_KEY]: LEGACY_MARK } as Prisma.InputJsonValue },
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

/**
 * 🔴 **가짜 runtime 호스트** — launchd · git · 파일만 가짜다. 전환 검사 두 자리는 실제 CLI 를 격리 DB 에 대고 부른다
 *    (staging 트리 = 이 저장소의 target 코드).
 */
type Host = {
  sha: string; pin: string; manifest: string | null
  jobs: Map<string, JobState>; plists: Map<string, string>; order: string[]
  fx: DeployEffects
}
function makeHost(home: string, o: { stagedHead?: string } = {}): Host {
  const h: Host = {
    sha: PREV, pin: PREV, manifest: JSON.stringify({ sha: PREV }),
    jobs: new Map(JOBS.map((l) => [l, 'loaded'])), plists: new Map(JOBS.map((l) => [l, JSON.stringify(['npx', 'tsx', `${RT}/scripts/${l}.mts`, '--old'])])),
    order: [], fx: {} as DeployEffects,
  }
  const cli = (): boolean => spawnSync(TSX, [CLI, `--runtime=${markText(V7)}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' }).status === 0
  h.fx = {
    fetch: () => true, currentSha: () => h.sha, originMain: () => NEXT, isAncestor: () => true, dirty: () => false,
    runningJobs: () => ({ running: [], unknown: [] }), envBlockers: () => [],
    unload: (l) => { h.order.push(`unload:${l}`); h.jobs.set(l, 'unloaded'); return true },
    bootout: (l) => { h.order.push(`bootout:${l}`); h.jobs.set(l, 'unloaded'); return true },
    probeJob: (l) => h.jobs.get(l) ?? 'unloaded',
    load: (l) => { h.order.push(`load:${l}`); h.jobs.set(l, 'loaded'); return true },
    checkout: (s) => { h.order.push(`checkout:${s === NEXT ? 'target' : 'prev'}`); h.sha = s; return true },
    install: () => true, generate: () => true, offlineGate: (g) => { h.order.push(`gate:${g}`); return true },
    runtimeQualityContract: () => { h.order.push('runtime-contract'); return markText(V7) },
    // 🔴 staging 트리가 target 에 있어야 그 트리로 잰다 — 아니면 false(배포기 실제 효과와 같은 계약)
    stagedTransitionCheck: (target) => {
      h.order.push('staged-check')
      return (o.stagedHead ?? NEXT) === target && cli()
    },
    contractTransitionGate: () => { h.order.push('recheck'); return cli() },
    readInstalledPlist: (l) => h.plists.get(l) ?? null,
    renderPlist: (_t, l) => JSON.stringify(['npx', 'tsx', `${RT}/scripts/${l}.mts`, '--new']),
    writePlist: (l, xml) => { h.order.push(`write-plist:${l}`); h.plists.set(l, xml); return true },
    removePlist: (l) => { h.plists.delete(l); return true },
    retirePlist: () => true, unretirePlist: () => true, lintPlist: () => true,
    argsOf: (xml) => JSON.parse(xml) as string[], workingDirOf: () => RT,
    loadedConfig: (l) => ({ readable: true, programPath: `${RT}/scripts/${l}.mts`, workingDirectory: RT, args: JSON.parse(h.plists.get(l) ?? '[]') as string[] }),
    isolationGate: () => true,
    readManifest: () => h.manifest, readPin: () => h.pin,
    writeManifest: (j) => { h.order.push('write-manifest'); h.manifest = j; return true },
    removeManifest: () => { h.manifest = null; return true },
    writePin: (s) => { h.pin = s; return true },
    log: () => { /* 조용히 */ },
  }
  return h
}
const deploy = (h: Host) => runDeploy({ target: NEXT, jobs: JOBS, paths: { runtimeRoot: RT, devRoots: ['/fx/dev'] }, offlineGates: ['fx-gate'], now: () => '2026-10-13T00:00:00.000Z' }, h.fx)
const allLoaded = (h: Host): boolean => JOBS.every((l) => h.jobs.get(l) === 'loaded')
const oldPlists = (h: Host): boolean => JOBS.every((l) => (JSON.parse(h.plists.get(l) ?? '[]') as string[]).includes('--old'))

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 품질 계약 전환 배포 — stage → resolve → recheck → activate · 실패 rollback (격리 DB · 실제 CLI · 실제 runDeploy) ══\n')
  const home = join(SCRATCH, 'home')
  mkdirSync(home, { recursive: true })
  const TARGET = currentQualityContract()
  const tables = async (): Promise<string> => stableJson({
    audit: await prisma.autoReadyAudit.findMany({ orderBy: { queueId: 'asc' } }),
    queue: await prisma.originalPostApprovalQueue.findMany({ orderBy: { id: 'asc' } }),
  })
  const counts = async () => {
    const audits = await prisma.autoReadyAudit.findMany({ where: { defect: 'yes' } })
    const rows = await prisma.originalPostApprovalQueue.findMany({
      where: { id: { in: audits.map((a) => a.queueId) } },
      select: { id: true, createdPostId: true, draftTitle: true, draftBody: true, gateResults: true, editDiff: true },
    })
    const qs = new Map(rows.map((q) => [q.id, q]))
    return { v7: unresolvedUnder(audits, qs, V7).length, v8: unresolvedUnder(audits, qs, TARGET).length }
  }

  await wipeAuditFixtures(prisma)
  const f = newFixture(prisma, home)
  const contextOf = makeReverifyContextLoader({ artifactDir: f.artifactDir })
  await seedEvidence(f, 30)
  const A = await defectRow(f, BLOCKED)
  const pA = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
  if (pA.kind !== 'plan') throw new Error('fixture 계획 실패')
  const v7Record = { ...pA.plan.record, qualityContract: V7 }
  const q0 = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: A.queueId }, select: { editDiff: true } })
  await prisma.originalPostApprovalQueue.update({ where: { id: A.queueId }, data: { editDiff: { ...rec(q0.editDiff), [DEFECT_RESOLUTION_KEY]: [v7Record] } as Prisma.InputJsonValue } })

  console.log('① stage — v7 기록만 · 활성화 전에 막는다')
  {
    const c = await counts()
    check('전제 — v7=0 · v8=1 (Batch B 장애 모양)', c.v7 === 0 && c.v8 === 1, JSON.stringify(c))
    const snap = await tables()
    const h = makeHost(home)
    const r = await deploy(h)
    check('🔴 🔴 **staging 전환 preflight BLOCK → preflight 에서 멈춘다**', !r.ok && r.phase === 'preflight' && /staging/.test(r.problems.join(' ')), `${r.phase} ${r.problems.join(' · ')}`)
    check('🔴 🔴 **활성화 0 — unload · checkout · plist · manifest · pin 0 · v7 job 은 그대로 loaded**',
      !h.order.some((x) => x.startsWith('unload') || x.startsWith('checkout') || x.startsWith('write-')) && h.sha === PREV && h.pin === PREV
      && allLoaded(h) && oldPlists(h) && r.rollback === null, h.order.join(' '))
    check('🔴 순서 — runtime 계약을 읽은 뒤 staging 으로 쟀다', h.order.indexOf('runtime-contract') < h.order.indexOf('staged-check'))
    check('🔴 BLOCK 도 DB write 0', await tables() === snap)
    const wrongStage = makeHost(home, { stagedHead: PREV })
    const rw = await deploy(wrongStage)
    check('🔴 staging 트리가 target 이 아니면 → BLOCK (그 트리로 잰 값은 target 의 값이 아니다)', !rw.ok && rw.phase === 'preflight' && allLoaded(wrongStage) && wrongStage.sha === PREV)
  }

  console.log('\n② resolve — 활성화 전에 정본 쓰기로 v8 기록 append (v7 runtime·job 은 그대로)')
  const hostBefore = makeHost(home)
  {
    // 🔴 공식 dry-run 을 **지금** 다시 뽑는다 — v7 기록을 넣으며 큐 행이 바뀌었다(낡은 계획은 정본이 PLAN_STALE 로 거절한다)
    const fresh = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
    if (fresh.kind !== 'plan') throw new Error(`fresh 계획 실패 ${JSON.stringify(fresh)}`)
    const stale = await applyApprovedDefectResolution(prisma, {
      queueId: A.queueId, approval: { digest: defectPlanDigestOf(pA.plan), expected: { before: 1, after: 0 }, reason: '낡은 계획' }, contextOf, now: new Date(),
    })
    check('🔴 v7 기록 전에 뽑은 낡은 계획 → PLAN_STALE · write 0', stale.kind === 'refuse' && stale.code === 'PLAN_STALE', JSON.stringify(stale))
    const dig = defectPlanDigestOf(fresh.plan)
    const ex = await expectationOf(prisma, fresh.plan)
    check('공식 dry-run 값 — expect 1:0', ex.before === 1 && ex.after === 0, JSON.stringify(ex))
    const a = await applyApprovedDefectResolution(prisma, { queueId: A.queueId, approval: { digest: dig, expected: ex, reason: 'quality-v8 활성화 전 해소' }, contextOf, now: new Date() })
    check('🟢 정본 승인 적용 → written 1 · v8 미해소 0', a.kind === 'written' && a.after === 0, JSON.stringify(a))
    const recs = resolutionsOf((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: A.queueId } })).editDiff)
    check('🔴 🔴 **v7 기록 그대로 · v8 기록이 뒤에 덧붙었다(append-only)**', recs.length === 2 && stableJson(recs[0]) === stableJson(v7Record)
      && stableJson(rec(recs[1]).qualityContract) === stableJson(TARGET))
    const c = await counts()
    check('🔴 🔴 **활성화 전 · v7 결함 축 0 그대로 (돌고 있는 v7 gate 를 흔들지 않는다)**', c.v7 === 0 && c.v8 === 0, JSON.stringify(c))
    check('v7 job 은 해소 동안 그대로 loaded · SHA·pin 그대로', allLoaded(hostBefore) && hostBefore.sha === PREV && hostBefore.pin === PREV)
  }

  console.log('\n③ recheck — v7=0 · v8=0')
  {
    const r = spawnSync(TSX, [CLI, `--runtime=${markText(V7)}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🟢 CLI exit 0 · PASS NO_UNRESOLVED · runtime 0 · target 0', r.status === 0 && /verdict=PASS code=NO_UNRESOLVED/.test(r.stdout)
      && /runtime=quality-v7:[0-9a-f]{64} unresolved=0/.test(r.stdout) && new RegExp(`target=${TARGET.version}:[0-9a-f]{64} unresolved=0`).test(r.stdout), r.stdout)
  }

  console.log('\n④ activate — 재확인 둘을 지나야 pin 전환 · job 로드')
  {
    const snap = await tables()
    const h = makeHost(home)
    const r = await deploy(h)
    check('🟢 🟢 **배포 통과 · pin=target · manifest=target · 새 plist · job loaded**', r.ok && h.pin === NEXT && h.sha === NEXT
      && (JSON.parse(h.manifest ?? '{}') as { sha?: string }).sha === NEXT && !oldPlists(h) && allLoaded(h), `${r.phase} ${r.problems.join(' · ')}`)
    const o = h.order
    check('🔴 순서 — staging 확인 → unload → checkout → 재확인 → 게이트 → plist → manifest → load',
      o.indexOf('staged-check') < o.findIndex((x) => x.startsWith('unload')) && o.indexOf('checkout:target') < o.indexOf('recheck')
      && o.indexOf('recheck') < o.indexOf('gate:fx-gate') && o.indexOf('gate:fx-gate') < o.findIndex((x) => x.startsWith('write-plist'))
      && o.indexOf('write-manifest') < o.findIndex((x) => x.startsWith('load:')), o.join(' '))
    check('🔴 활성화는 DB write 0 · 활성화 뒤 v8 코드의 미해소 0 · v7 기록 그대로', await tables() === snap && await unresolvedDefectCount(prisma) === 0
      && stableJson(resolutionsOf((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: A.queueId } })).editDiff)[0]) === stableJson(v7Record))
  }

  console.log('\n⑤ rollback — staging 확인 뒤 새 결함이 생기면 checkout 뒤 재확인이 막고 되돌린다')
  {
    // 🔴 staging 확인(PASS) 뒤 · 재확인 전에 새 확정 결함이 생긴다 — 동기 효과 안이라 checkout 직전에 넣어 둔다
    const h = makeHost(home)
    let injected: AutoPost | null = null
    const origCheckout = h.fx.checkout
    const origStaged = h.fx.stagedTransitionCheck
    let stagedOk: boolean | null = null
    h.fx.stagedTransitionCheck = (t, rt) => { stagedOk = origStaged(t, rt); return stagedOk }
    h.fx.checkout = (s) => {
      if (s === NEXT && injected === null) {
        // 🔴 같은 격리 DB 에 다른 프로세스가 쓴 것처럼 — 결함 행을 동기 spawn 으로 만든다
        const r = spawnSync(TSX, [join(ROOT, 'scripts/quality-contract-deploy-db-check.mts'), '--inject-defect'], {
          cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8',
        })
        injected = r.status === 0 ? ({ queueId: r.stdout.trim() } as AutoPost) : ({ queueId: 'FAILED' } as AutoPost)
        h.order.push('db-changed-after-stage')
      }
      return origCheckout(s)
    }
    // ④ 에서 이미 target 이 됐으니 ⑤ 는 새 호스트(직전 = PREV)에서 다시 배포한다
    const r = await deploy(h)
    check('전제 — staging 확인은 통과했다 · 그 뒤 새 결함이 생겼다', stagedOk === true && injected !== null && (injected as AutoPost).queueId !== 'FAILED', String((injected as AutoPost | null)?.queueId))
    check('🔴 🔴 **checkout 뒤 재확인 BLOCK → contract-transition 에서 멈춘다**', !r.ok && r.phase === 'contract-transition', `${r.phase} ${r.problems.join(' · ')}`)
    check('🔴 🔴 **직전 SHA · pin · manifest · 옛 plist · job loaded 로 되돌렸다 · 복구 완전**', h.sha === PREV && h.pin === PREV
      && (JSON.parse(h.manifest ?? '{}') as { sha?: string }).sha === PREV && oldPlists(h) && allLoaded(h) && r.rollback?.complete === true, JSON.stringify(r.rollback))
    check('🔴 재확인 BLOCK 이면 offline 게이트 · plist · manifest 단계에 닿지 않았다', !r.steps.some((x) => x === 'write-manifest' || x.startsWith('plist:') || x.startsWith('gate:fx')))
    if (injected !== null && (injected as AutoPost).queueId !== 'FAILED') await prisma.autoReadyAudit.delete({ where: { queueId: (injected as AutoPost).queueId } })
  }

  console.log('\n⑥ 활성화 전에 해소할 수 없는 결함 → 배포 BLOCK')
  {
    const P = await defectRow(f, PASSING)
    const pP = await planDefectResolution(prisma, { queueId: P.queueId, contextOf, now: new Date() })
    const snap = await tables()
    check('🔴 공식 dry-run 이 계획을 못 낸다 (refuse NOT_BLOCKED) · write 0', pP.kind === 'refuse' && pP.code === 'NOT_BLOCKED' && await tables() === snap, JSON.stringify(pP))
    const h = makeHost(home)
    const r = await deploy(h)
    check('🔴 🔴 **배포 BLOCK · 활성화 0 · v7 job 그대로**', !r.ok && r.phase === 'preflight' && h.sha === PREV && h.pin === PREV && allLoaded(h) && oldPlists(h))
    await prisma.autoReadyAudit.delete({ where: { queueId: P.queueId } })
  }

  await wipeAuditFixtures(prisma)
  await prisma.$disconnect()
  rmSync(SCRATCH, { recursive: true, force: true })
  console.log(`\n결과: ${pass} 통과 · ${fail} 실패\n`)
  process.exit(fail === 0 ? 0 : 1)
}

/**
 * 🔴 `--inject-defect` — ⑤ 반례가 **배포 도중** 다른 프로세스가 결함을 만든 것을 흉내 낼 때만 쓴다.
 *    같은 격리 DB 에 미해소 v8 결함 행 하나를 만들고 그 큐 id 를 찍는다. 운영 DB 가드(`requireIsolatedDb`)는 위에서 이미 돌았다.
 */
async function injectDefect(): Promise<void> {
  const prisma = new PrismaClient()
  const home = process.env.HOME ?? ''
  const f = newFixture(prisma, home)
  // 🔴 부모와 원천 id · artifact id 가 겹치지 않게 순번을 띄운다
  f.seq = 900
  const a = await defectRow(f, BLOCKED)
  console.log(a.queueId)
  await prisma.$disconnect()
}

if (process.argv.includes('--inject-defect')) {
  injectDefect().then(() => process.exit(0), (e: unknown) => { console.error(e); process.exit(1) })
} else {
  main().catch((e: unknown) => { console.error(e); process.exit(1) })
}
