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
 *   🔴 (v4 hotfix) 가짜 호스트의 runtime 트리는 **실제 운영 runtime 커밋**(e4d31d68 · v7) worktree 다. 배포기와 같이
 *      staging 확인 직전에 그 트리에서 source snapshot 을 뜨고, checkout 뒤 재확인은 그 snapshot 을 다시 쓴다.
 *      v7 기록은 운영이 실제로 쓴 모양(게이트 판 `draft-gates-v6.1`)이다.
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
import { stampAutoReady, unresolvedDefectCount } from '../src/lib/auto-ready-repo'
import { eligibilityOf } from '../src/lib/auto-ready-v2'
import { judgeMachine, type SemanticVerdict } from '../src/lib/content-core/review'
import { STAGE_MODEL } from '../src/lib/content-core/pipeline'
import { pickV2 } from '../src/lib/micro-seed-auto-draft'
import { RULE_VERSION as AUTO_JUDGE_RULE_VERSION } from '../src/lib/micro-seed-auto-judge'
import * as af from '../src/lib/micro-seed-supply-autofill'
import { SEMANTIC_HOLD_CODES } from '../src/lib/semantic-summary-codes'
import { planDefectResolution } from '../src/lib/auto-ready-defect-resolution-store'
import { DEFECT_RESOLUTION_KEY, type DefectResolutionRecord } from '../src/lib/auto-ready-defect-resolution'
import { SEMANTIC_AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-semantic-audit'
import { QUALITY_CONTRACT_KEY, currentQualityContract } from '../src/lib/quality-contract'
import { runDeploy, type DeployEffects } from '../src/lib/runtime-deploy'
import type { JobState } from '../src/lib/runtime-isolation'
import { applyApprovedDefectResolution, defectPlanDigestOf, expectationOf } from './lib/defect-resolution-approval.mjs'
import { makeReverifyContextLoader } from './lib/defect-reverify-context.mjs'
import { LIFE_FIXTURES } from './lib/life-gate-fixtures.mjs'
import { FIXTURE_NOW } from './lib/draft-gate-fixtures.mjs'
import { markText, unresolvedUnder } from './lib/quality-contract-transition.mjs'
import { openRuntimeTree, snapshotToFile, type RuntimeTree } from './lib/source-snapshot-fixture.mjs'
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
/** 🔴 승계 집합 기록 — 배포기의 `contract-succession-<SHA>.json` 과 같은 역할(stage 가 쓰고 activate 가 대조) */
const SUCC_FILE = join(SCRATCH, 'contract-succession.json')
/** 🔴 source snapshot — 배포기의 `contract-source-<SHA>.json` 과 같은 역할(staging 확인 직전에 뜨고 checkout 뒤 재확인이 다시 쓴다) */
const SRC_FILE = join(SCRATCH, 'contract-source.json')
const LEGACY_MARK = { version: 'quality-v4', digest: '379bf6c61fe1431f928da2e44cde0731fdf1850a301b0c808378a6875be47daa' }
/** 🔴 운영 runtime 의 계약 — origin/main 의 `quality-contract.fingerprint.json` 그대로 */
const V7 = { version: 'quality-v7', digest: 'ef9ff369253ee95de6707acd7a4c8de7cee294a9023c8a7833d64150b33bc8de' }
const V7_GATE = 'draft-gates-v6.1'
const BLOCKED = LIFE_FIXTURES.find((x) => x.queueId === 'counter-v6-peer-observation')!
const PASSING = LIFE_FIXTURES.find((x) => x.queueId === 'control-v6-peer-third-party')!
/** 🔴 14:40 감사 결함 재작성 — P02(자녀 1명) · SELF · `아들 둘 데리고` · v7 표식 · 자동 발행됨 */
const KIDS = LIFE_FIXTURES.find((x) => x.queueId === 'cmv689wzr0001xm7mubgfebxp')!
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
/** 🔴 v7 코드가 실제로 쓴 기록의 모양 — 계약 v7 · 게이트 판 v7 */
const v7RecordOf = (r: DefectResolutionRecord): DefectResolutionRecord =>
  ({ ...r, qualityContract: V7, reverify: { ...r.reverify, gateVersion: V7_GATE } })
/** 🔴 실제 runtime 커밋 트리 — main 에서 연다(`--inject-defect` 자식은 쓰지 않는다) */
let RT_TREE: RuntimeTree | null = null
/** 🔴 배포기 `snapshotSource` 와 같다 — runtime 트리에서 snapshot 을 떠 SRC_FILE 에 봉인. 뜨지 못하면 null(배포기는 BLOCK) */
const snapshotSource = (home: string, root?: RuntimeTree) => {
  const t = root ?? RT_TREE
  return t === null ? null : snapshotToFile(t, SRC_FILE, { ...process.env, HOME: home })
}
const sourceArgs = [`--runtime-gate=${V7_GATE}`, `--source-snapshot=${SRC_FILE}`]

/** 🔴 운영 결함과 같은 모양 — 옛 계약 행 · 기계 의미 감사 yes(측정됨) */
async function defectRow(f: Fixture, fx: typeof BLOCKED, o: {
  persona?: string; mark?: { version: string; digest: string }; plan?: Record<string, unknown>
} = {}): Promise<AutoPost> {
  const persona = o.persona ?? 'P04'
  const a = await autoPublished(f, { personaCode: persona, title: fx.draft.title, body: fx.draft.body, sourceTitle: fx.source.title, sourceBody: fx.source.body })
  const art = f.artifacts.find((x) => x.artifactId === a.artifactId)!
  art.plan = o.plan ?? { personaCode: persona, stance: 'QUESTION', selfBasis: null, warrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'], protectedFacts: [] }
  art.generatedAt = FIXTURE_NOW.toISOString()
  const cand = f.candidates.find((x) => x.artifactId === a.artifactId)!
  cand.sourcePostedAt = FIXTURE_NOW.toISOString()
  cand.sourceCapturedAt = FIXTURE_NOW.toISOString()
  flushArtifacts(f)
  const q = await f.prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.queueId }, select: { gateResults: true } })
  await f.prisma.originalPostApprovalQueue.update({
    where: { id: a.queueId }, data: { gateResults: { ...rec(q.gateResults), [QUALITY_CONTRACT_KEY]: o.mark ?? LEGACY_MARK } as Prisma.InputJsonValue },
  })
  await selectForAudit(f, a)
  await f.prisma.autoReadyAudit.update({
    where: { queueId: a.queueId },
    data: {
      defect: 'yes', judgedAt: f.now, auditor: 'model:semantic-audit:runner',
      note: `[${SEMANTIC_AUDIT_CONTRACT_VERSION} outcome=measured binding=fx artifact=${a.artifactId} persona=${persona} card=fx] 결함 fixture`,
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
function makeHost(home: string, o: { stagedHead?: string; sourceTree?: RuntimeTree } = {}): Host {
  const h: Host = {
    sha: PREV, pin: PREV, manifest: JSON.stringify({ sha: PREV }),
    jobs: new Map(JOBS.map((l) => [l, 'loaded'])), plists: new Map(JOBS.map((l) => [l, JSON.stringify(['npx', 'tsx', `${RT}/scripts/${l}.mts`, '--old'])])),
    order: [], fx: {} as DeployEffects,
  }
  // 🔴 activate 의 두 재확인 — 배포기와 같이 stage 가 남긴 승계 집합 · source snapshot 으로 대조한다
  const cli = (): boolean => spawnSync(TSX, [CLI, `--runtime=${markText(V7)}`, ...sourceArgs, `--verify-succession=${SUCC_FILE}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' }).status === 0
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
      if ((o.stagedHead ?? NEXT) !== target) return false
      // 🔴 job 을 내리기 전 · runtime 트리가 아직 source 일 때 snapshot 을 뜬다 — 뜨지 못하면 BLOCK
      rmSync(SRC_FILE, { force: true })
      if (snapshotSource(home, o.sourceTree) === null) { h.order.push('source-snapshot-failed'); return false }
      h.order.push('source-snapshot')
      return cli()
    },
    // 🔴 checkout 뒤에는 runtime 트리가 target 이다 — source 를 다시 뜨지 않고 staging 직전의 snapshot 을 쓴다
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
/** 🔴 stage — 배포기 `--stage` 가 staging 트리에서 부르는 것과 같은 CLI · 같은 인자(PASS 면 승계 집합을 남긴다) */
const stageRun = (home: string) => {
  rmSync(SUCC_FILE, { force: true })
  if (snapshotSource(home) === null) throw new Error('stage — runtime 트리에서 source snapshot 을 뜨지 못했다')
  return spawnSync(TSX, [CLI, `--runtime=${markText(V7)}`, ...sourceArgs, `--record-succession=${SUCC_FILE}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
}
/** 🔴 activate 대조만 — 배포기처럼 snapshot 을 새로 뜨고 승계 파일과 대조한다 */
const verifyRun = (home: string, file = SUCC_FILE) => {
  if (snapshotSource(home) === null) throw new Error('verify — runtime 트리에서 source snapshot 을 뜨지 못했다')
  return spawnSync(TSX, [CLI, `--runtime=${markText(V7)}`, ...sourceArgs, `--verify-succession=${file}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
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
  const tree = openRuntimeTree(ROOT)
  RT_TREE = tree
  process.on('exit', tree.cleanup)
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
    // 🔴 v7 축은 runtime 트리(v7 코드)가 센 값이다 — target 코드로 v7 기록을 다시 세지 않는다
    const s = snapshotSource(home)
    if (s === null) throw new Error('counts — runtime 트리에서 source snapshot 을 뜨지 못했다')
    return { v7: s.unresolved.length, v8: unresolvedUnder(audits, qs, TARGET).length }
  }

  await wipeAuditFixtures(prisma)
  const f = newFixture(prisma, home)
  const contextOf = makeReverifyContextLoader({ artifactDir: f.artifactDir })
  await seedEvidence(f, 30)
  const A = await defectRow(f, BLOCKED)
  const pA = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
  if (pA.kind !== 'plan') throw new Error('fixture 계획 실패')
  const v7Record = v7RecordOf(pA.plan.record)
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
    if (snapshotSource(home) === null) throw new Error('recheck snapshot 실패')
    const r = spawnSync(TSX, [CLI, `--runtime=${markText(V7)}`, ...sourceArgs], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🟢 CLI exit 0 · PASS NO_UNRESOLVED · runtime 0 · target 0', r.status === 0 && /verdict=PASS code=NO_UNRESOLVED/.test(r.stdout)
      && /runtime=quality-v7:[0-9a-f]{64} gate=draft-gates-v6\.1 unresolved=0/.test(r.stdout) && new RegExp(`target=${TARGET.version}:[0-9a-f]{64} unresolved=0`).test(r.stdout), r.stdout)
  }

  console.log('\n④ activate — 재확인 둘을 지나야 pin 전환 · job 로드')
  {
    const st = stageRun(home)
    check('stage — PASS · 승계 집합을 남긴다(빈 집합)', st.status === 0 && /CONTRACT_SUCCESSION_STAGED/.test(st.stdout), st.stdout.slice(0, 300))
    // 🔴 source snapshot 을 뜰 수 없는 runtime 트리 — 나머지가 전부 PASS 여도 활성화 0
    const broken = makeHost(home, { sourceTree: { root: join(SCRATCH, 'no-runtime-tree'), cleanup: () => undefined } })
    const rb = await deploy(broken)
    check('🔴 🔴 **runtime 트리에서 source snapshot 을 뜨지 못하면 → preflight BLOCK · 활성화 0 · v7 job 그대로**', !rb.ok && rb.phase === 'preflight'
      && broken.order.includes('source-snapshot-failed') && !broken.order.some((x) => x.startsWith('unload') || x.startsWith('checkout'))
      && broken.sha === PREV && broken.pin === PREV && allLoaded(broken) && oldPlists(broken), `${rb.phase} ${broken.order.join(' ')}`)
    const snap = await tables()
    const h = makeHost(home)
    const r = await deploy(h)
    check('🟢 🟢 **배포 통과 · pin=target · manifest=target · 새 plist · job loaded**', r.ok && h.pin === NEXT && h.sha === NEXT
      && (JSON.parse(h.manifest ?? '{}') as { sha?: string }).sha === NEXT && !oldPlists(h) && allLoaded(h), `${r.phase} ${r.problems.join(' · ')}`)
    const o = h.order
    check('🔴 순서 — source snapshot → staging 확인 → unload → checkout → 재확인 → 게이트 → plist → manifest → load',
      o.indexOf('source-snapshot') > -1 && o.indexOf('source-snapshot') < o.findIndex((x) => x.startsWith('unload'))
      && o.indexOf('staged-check') < o.findIndex((x) => x.startsWith('unload')) && o.indexOf('checkout:target') < o.indexOf('recheck')
      && o.indexOf('recheck') < o.indexOf('gate:fx-gate') && o.indexOf('gate:fx-gate') < o.findIndex((x) => x.startsWith('write-plist'))
      && o.indexOf('write-manifest') < o.findIndex((x) => x.startsWith('load:')), o.join(' '))
    check('🔴 활성화는 DB write 0 · 활성화 뒤 v8 코드의 미해소 0 · v7 기록 그대로', await tables() === snap && await unresolvedDefectCount(prisma) === 0
      && stableJson(resolutionsOf((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: A.queueId } })).editDiff)[0]) === stableJson(v7Record))
  }

  console.log('\n⑤ rollback — staging 확인 뒤 새 결함이 생기면 checkout 뒤 재확인이 막고 되돌린다')
  {
    // 🔴 staging 확인(PASS) 뒤 · 재확인 전에 새 확정 결함이 생긴다 — 동기 효과 안이라 checkout 직전에 넣어 둔다
    stageRun(home)
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
    // 🔴 재확인은 unload 전에 뜬 snapshot 을 다시 쓴다 — 그 뒤 생긴 결함은 집합 불일치로 막힌다
    const why = spawnSync(TSX, [CLI, `--runtime=${markText(V7)}`, ...sourceArgs, `--verify-succession=${SUCC_FILE}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🔴 🔴 **사유 — unload 전 source snapshot 뒤 결함 집합이 바뀌었다(SOURCE_SNAPSHOT_INVALID)**', why.status === 1
      && /code=SOURCE_SNAPSHOT_INVALID/.test(why.stdout) && /결함 집합이 바뀌었다/.test(why.stdout), why.stdout.slice(0, 300))
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

  console.log('\n⑦ 🔴 승계 — v7 자기 계약 결함을 v8 공식 해소가 정확히 1:1 로 인수할 때만 (14:40 감사 결함 모양)')
  {
    const KPLAN = { personaCode: 'P02', stance: 'SELF_EXPERIENCE', selfBasis: 'lifeFacts', closingIntent: 'vent', contentRoles: ['experienceResonance'], protectedFacts: [],
      warrants: [{ fact: 'children', requiredValue: '있음', evidenceRef: 'head', evidenceText: '아들 둘 데리고', verifiedCardValue: '1' }] }
    const ownDefect = () => defectRow(f, KIDS, { persona: 'P02', mark: V7, plan: KPLAN })
    /** 공식 v8 해소 — 정본 dry-run 계획 → 정본 승인 적용(staging 트리의 `defect-resolve --staged` 와 같은 쓰기) */
    const resolveV8 = async (queueId: string): Promise<string> => {
      const pl = await planDefectResolution(prisma, { queueId, contextOf, now: new Date() })
      if (pl.kind !== 'plan') return `plan:${pl.kind}`
      const ex = await expectationOf(prisma, pl.plan)
      const ap = await applyApprovedDefectResolution(prisma, { queueId, approval: { digest: defectPlanDigestOf(pl.plan), expected: ex, reason: 'v8 승계 db-check' }, contextOf, now: new Date() })
      return ap.kind
    }
    const qOf = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { editDiff: true } })
    const setRecords = async (id: string, recs: unknown[]) => {
      const q = await qOf(id)
      await prisma.originalPostApprovalQueue.update({ where: { id }, data: { editDiff: { ...rec(q.editDiff), [DEFECT_RESOLUTION_KEY]: recs } as Prisma.InputJsonValue } })
    }
    const drop = async (...ids: string[]) => { for (const id of ids) await prisma.autoReadyAudit.delete({ where: { queueId: id } }) }
    const activate = async (): Promise<{ ok: boolean; h: Host; phase: string; rollback: boolean }> => {
      const h = makeHost(home)
      const r = await deploy(h)
      return { ok: r.ok, h, phase: r.phase, rollback: r.rollback?.complete === true }
    }
    const untouched = (h: Host): boolean => h.sha === PREV && h.pin === PREV && allLoaded(h) && oldPlists(h) && !h.order.some((x) => x.startsWith('unload'))

    // ── a. 정확한 1:1 승계 → 통과 ──
    const K = await ownDefect()
    const c0 = await counts()
    check('전제 — v7 자기 계약 결함 1 · v7=1 · v8=1 (v7 자동 lane 닫힘)', c0.v7 === 1 && c0.v8 === 1, JSON.stringify(c0))
    const pre = stageRun(home)
    const pre2 = await activate()
    check('🔴 v8 기록 전 — stage BLOCK(TARGET_UNRESOLVED) · activate BLOCK · 활성화 0', pre.status === 1 && /TARGET_UNRESOLVED/.test(pre.stdout) && !pre2.ok && untouched(pre2.h), pre.stdout.slice(0, 200))
    const pK = await planDefectResolution(prisma, { queueId: K.queueId, contextOf, now: new Date() })
    check('🟢 공식 dry-run 이 v8 게이트로 실제 계획을 낸다 (childLifeStageConflict)', pK.kind === 'plan' && pK.plan.record.reverify.failureCodes.includes('childLifeStageConflict'), JSON.stringify(pK).slice(0, 200))
    check('🟢 resolve — 정본 승인 적용 written', await resolveV8(K.queueId) === 'written')
    const c1 = await counts()
    check('🔴 resolve 뒤 v8=0 · v7=1 그대로 — activate 전까지 v7 자동 lane 은 닫혀 있다', c1.v8 === 0 && c1.v7 === 1, JSON.stringify(c1))
    const st1 = stageRun(home)
    check('🟢 🟢 **stage — PASS SUCCESSION · 승계 1 (v7 결함 ↔ v8 기록 1:1)**', st1.status === 0 && /code=SUCCESSION/.test(st1.stdout)
      && /succession=1 /.test(st1.stdout) && /CONTRACT_SUCCESSION_STAGED/.test(st1.stdout), st1.stdout.slice(0, 400))
    const a1 = await activate()
    check('🟢 🟢 **activate — 두 재확인이 같은 승계 집합 · pin=target · job loaded**', a1.ok && a1.h.pin === NEXT && allLoaded(a1.h), a1.phase)

    // ── b. 중복 연결 → 차단 ──
    const recsK = resolutionsOf((await qOf(K.queueId)).editDiff)
    const v8rec = recsK.find((x) => stableJson(rec(x).qualityContract) === stableJson(TARGET))!
    await setRecords(K.queueId, [...recsK, v8rec])
    const sDup = stageRun(home)
    check('🔴 🔴 **같은 v8 기록 두 줄(중복 연결) → BLOCK SUCCESSION_BROKEN · DUPLICATE**', sDup.status === 1 && /SUCCESSION_BROKEN/.test(sDup.stdout) && /DUPLICATE/.test(sDup.stdout), sDup.stdout.slice(0, 300))
    // 🔴 하나는 맞고 하나는 깨진(재검증 차단 코드 비움) v8 기록 두 줄 — 깨진 줄이 섞여도 1:1 이 아니다
    const broken = { ...rec(v8rec), reverify: { ...rec(rec(v8rec).reverify), failureCodes: [] } }
    await setRecords(K.queueId, [...recsK, broken])
    const sDup2 = stageRun(home)
    check('🔴 🔴 **맞는 v8 기록 + 깨진 v8 기록(같은 결함) → BLOCK DUPLICATE (유효 줄만 세지 않는다)**', sDup2.status === 1 && /DUPLICATE/.test(sDup2.stdout), sDup2.stdout.slice(0, 300))
    await setRecords(K.queueId, recsK)

    // ── c. 다른 결함 연결 → 차단 ──
    const K2 = await ownDefect()
    await setRecords(K2.queueId, [v8rec])
    const sForeign = stageRun(home)
    check('🔴 🔴 **다른 결함(K)의 v8 기록만 단 결함 K2 → BLOCK (FOREIGN_LINK · v8 미해소)**', sForeign.status === 1 && /FOREIGN_LINK/.test(sForeign.stdout), sForeign.stdout.slice(0, 300))

    // ── d. v8 기록 없음 → 차단 ──
    await setRecords(K2.queueId, [])
    const sNone = stageRun(home)
    check('🔴 🔴 **v8 기록 없는 v7 결함 → BLOCK (UNLINKED · v8 미해소 1)**', sNone.status === 1 && /TARGET_UNRESOLVED/.test(sNone.stdout) && /UNLINKED/.test(sNone.stdout), sNone.stdout.slice(0, 300))

    // ── e. 여러 결함이 모두 정확히 매핑 → 통과 ──
    check('K2 도 공식 v8 해소', await resolveV8(K2.queueId) === 'written')
    const sMulti = stageRun(home)
    check('🟢 🟢 **v7 결함 2 · 둘 다 정확한 v8 기록 → PASS · 승계 2**', sMulti.status === 0 && /succession=2 /.test(sMulti.stdout), sMulti.stdout.slice(0, 300))

    // ── f. stage 뒤 새 v7 결함 → activate 차단(집합 digest 불일치) ──
    const K3 = await ownDefect()
    check('새 결함 K3 도 공식 v8 해소(그래도 stage 집합 밖이다)', await resolveV8(K3.queueId) === 'written')
    const aNew = await activate()
    check('🔴 🔴 **stage 뒤 새 v7 결함 → activate BLOCK(승계 집합 digest 불일치) · 활성화 0**', !aNew.ok && aNew.phase === 'preflight' && untouched(aNew.h), aNew.phase)
    const rcNew = verifyRun(home)
    check('🔴 사유 — SUCCESSION_DIGEST_MISMATCH', rcNew.status === 1 && /SUCCESSION_DIGEST_MISMATCH/.test(rcNew.stdout), rcNew.stdout.slice(0, 200))
    const noStage = verifyRun(home, join(SCRATCH, 'missing.json'))
    check('🔴 stage 기록이 없으면 → BLOCK SUCCESSION_NOT_STAGED', noStage.status === 1 && /SUCCESSION_NOT_STAGED/.test(noStage.stdout))
    await drop(K2.queueId, K3.queueId)

    // ── f2. stage 뒤 source 결함 집합만 바뀜(양쪽에서 해소된 옛 계약 행 결함 B · 링크 · v8 미해소 그대로) → activate 차단 ──
    const sF = stageRun(home)
    check('stage — PASS · 승계 1 (K)', sF.status === 0 && /succession=1 /.test(sF.stdout), sF.stdout.slice(0, 300))
    const B = await defectRow(f, BLOCKED)
    const pB = await planDefectResolution(prisma, { queueId: B.queueId, contextOf, now: new Date() })
    if (pB.kind !== 'plan') throw new Error('B 계획 실패')
    await setRecords(B.queueId, [v7RecordOf(pB.plan.record)])
    check('B 는 v7 기록(실제 모양) + 공식 v8 해소', await resolveV8(B.queueId) === 'written')
    const cB = await counts()
    check('전제 — B 는 v7 · v8 모두 해소 · v7 미해소는 K 하나 · v8 0', cB.v7 === 1 && cB.v8 === 0, JSON.stringify(cB))
    const aB = await activate()
    check('🔴 🔴 **stage 뒤 source 결함 집합이 바뀜 → activate BLOCK · 활성화 0**', !aB.ok && aB.phase === 'preflight' && untouched(aB.h), aB.phase)
    const vB = verifyRun(home)
    check('🔴 사유 — SUCCESSION_DIGEST_MISMATCH (source 집합이 승계 digest 에 들어 있다)', vB.status === 1 && /SUCCESSION_DIGEST_MISMATCH/.test(vB.stdout), vB.stdout.slice(0, 300))
    await drop(B.queueId)

    // ── g. v7 에 다른 유형의 미해소(옛 계약 행 · v7 기록 없음 · v8 기록만) → 차단 ──
    const L = await defectRow(f, BLOCKED)
    check('L(옛 계약 행) 공식 v8 해소', await resolveV8(L.queueId) === 'written')
    const cL = await counts()
    const sOther = stageRun(home)
    check('🔴 🔴 **v7 미해소에 자기 계약 행이 아닌 결함 → BLOCK NOT_OWN_CONTRACT (v8=0 이어도)**', cL.v8 === 0 && sOther.status === 1
      && /NOT_OWN_CONTRACT/.test(sOther.stdout), `${JSON.stringify(cL)} ${sOther.stdout.slice(0, 300)}`)
    await drop(L.queueId)

    // ── h. activate 실패 → 완전 rollback (승계 상태에서) ──
    const sOk = stageRun(home)
    check('다시 stage — 승계 1 · PASS', sOk.status === 0 && /succession=1 /.test(sOk.stdout))
    const h = makeHost(home)
    const origCheckout = h.fx.checkout
    let injected = ''
    h.fx.checkout = (sha) => {
      if (sha === NEXT && injected === '') {
        const r = spawnSync(TSX, [join(ROOT, 'scripts/quality-contract-deploy-db-check.mts'), '--inject-defect'], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
        injected = r.status === 0 ? r.stdout.trim() : 'FAILED'
      }
      return origCheckout(sha)
    }
    const rr = await deploy(h)
    check('🔴 🔴 **activate 도중 새 결함 → checkout 뒤 재확인 BLOCK → runtime · pin · manifest · plist · job 완전 rollback**', !rr.ok && rr.phase === 'contract-transition'
      && h.sha === PREV && h.pin === PREV && (JSON.parse(h.manifest ?? '{}') as { sha?: string }).sha === PREV && oldPlists(h) && allLoaded(h)
      && rr.rollback?.complete === true, `${rr.phase} ${injected}`)
    if (injected !== '' && injected !== 'FAILED') await drop(injected)
    await drop(K.queueId)
  }

  console.log('\n⑧ 🔴 의미 경고 초안(17:15 artifact 3dd770e2 모양) · 자녀 수 생활사 모순 — 최종 pick · 적재 · READY 도장 · 발행 재검증')
  {
    /**
     * 🔴 artifact `machineOutcome=adopt` 는 **경고를 달고 사람에게 넘긴다**는 기계 결론이다(2026-09-20 결정 · `judgeMachine`).
     *    최종 정본은 pick · 후보 봉투다. 경고는 적재 때 `holds` 로 실리고, 도장과 발행 트랜잭션이 같은 `eligibilityOf` 로 막는다.
     */
    const NOW = new Date()
    const ok = { complete: true, reason: null, cause: null } as const
    const det = { pass: true, failures: [] }
    const warnSem: SemanticVerdict = {
      issues: [], unknownIssues: [], lifeContradictions: [], confidence: 0.92, note: '',
      droppedFromSource: [{ evidence: '원문 문장 하나', why: 'x' }, { evidence: '원문 문장 둘', why: 'y' }],
      unsupportedAdditions: [{ evidence: '초안 문장 하나', why: 'z' }],
    }
    const kidSem: SemanticVerdict = {
      issues: [], unknownIssues: [], droppedFromSource: [], unsupportedAdditions: [], confidence: 0.9, note: '',
      lifeContradictions: [{ fact: 'children', drafted: '아들 둘', card: '자녀 1명', evidence: '아들 둘 데리고 버스를 탔어요.' }],
    }
    const jw = judgeMachine({ deterministic: det, semantic: warnSem, semanticCompletion: ok })
    const jk = judgeMachine({ deterministic: det, semantic: kidSem, semanticCompletion: ok })
    check('표현 확인 — 경고만 있으면 기계 결론은 adopt + 경고 2줄(사람에게 넘긴다 · 판정 누락 아님)', jw.outcome === 'adopt' && jw.warnings.length === 2, JSON.stringify(jw))
    check('🔴 🔴 **자녀 수 생활사 모순 → 기계 결론 hold**', jk.outcome === 'hold' && /children/.test(jk.reason), JSON.stringify(jk))
    const cand = (id: string) => ({ sourceArticleId: id, draftNo: 1, title: '평범한 하루', body: '아침에 산책을 다녀왔어요. 다들 어떻게 지내세요?',
      safetyVerdict: 'pass', originality: { runWords: 3, runChars: 8, coverRatio: 0 }, generatedAt: NOW.toISOString() })
    const pick = (id: string, j: { outcome: 'adopt' | 'hold' | 'drop'; reason: string }) => pickV2({
      judgement: { sourceArticleId: id, decision: 'AUTO_SEED', semanticRisks: [] }, draft: cand(id) as never,
      seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false,
      machineOutcome: j.outcome, machineReason: j.reason, sourceTitleCopied: false, crisisStop: null,
    }, NOW.toISOString())
    const pw = pick('W1', jw)
    const pk = pick('K1', jk)
    check('최종 pick — 경고 초안은 AUTO_ADOPT(사람 검토 후보 · 2026-09-20 설계 그대로)', pw.decision === 'AUTO_ADOPT', JSON.stringify(pw))
    check('🔴 🔴 **최종 pick — 자녀 수 모순은 AUTO_HOLD semanticHold (후보 봉투 · 적재 0)**', pk.decision === 'AUTO_HOLD' && pk.reason === 'semanticHold', JSON.stringify(pk))

    // ── 실제 적재기 → 격리 DB 큐 행 → 실제 도장 ──
    const env = {
      provenance: af.MACHINE_PROFILE.envelopeProvenance, ruleVersion: af.MACHINE_PROFILE.envelopeRuleVersion,
      promptVersion: af.MACHINE_PROFILE.envelopePromptVersion, pipelineVersion: af.MACHINE_PROFILE.envelopePipelineVersion,
      stageModels: STAGE_MODEL, qualityContractDigest: TARGET.digest,
    }
    const aj = {
      ruleVersion: AUTO_JUDGE_RULE_VERSION,
      promptVersion: 'p',
      model: 'm',
      inputHash: 'h',
      provenance: 'machine-shadow',
      boardTopic: 'FREE' as const,
    }
    const review = (sem: SemanticVerdict) => ({ deterministic: det, semanticCompletion: ok, semantic: sem })
    const cleanSem: SemanticVerdict = { ...warnSem, droppedFromSource: [], unsupportedAdditions: [] }
    let seq = 0
    const row = async (sem: SemanticVerdict): Promise<{ id: string; holds: string[] }> => {
      seq += 1
      const c = { candidateType: 'seedOriginality', sourceArticleId: `S8${seq}`, sourceSite: 'navercafe:fx8', sourceInput: 'auto-judge',
        sourceDecision: 'AUTO_ADOPT', title: `평범한 하루 ${seq}`, body: `아침에 산책을 다녀왔어요 ${seq}. 다들 어떻게 지내세요?`,
        safetyVerdict: 'pass', originality: { runWords: 3, runChars: 8, coverRatio: 0 }, leakedTokens: '', lifeReview: [],
        voiceProvenance: { personaCode: 'P01', comments: 5, bundleDigest: 'bd1', sourceDigest: 'sd1' } }
      const p = af.buildQueuePayload({ envelope: env, candidate: c as never, autoJudge: aj, review: review(sem), now: NOW.toISOString() })
      if (p === null) throw new Error('적재 payload 실패')
      const raw = await prisma.microSeedRawContent.create({ data: { origin: 'live', sourceSite: p.syntheticSite, sourceUrl: `https://example.invalid/s8/${seq}`,
        sourceArticleId: `S8${seq}`, sourceCapturedAt: NOW, rawTitle: '원문', rawBody: '원문 본문' }, select: { id: true } })
      const q = await prisma.originalPostApprovalQueue.create({ data: {
        sourceRawContentId: raw.id, status: 'APPROVED', draftTitle: c.title, draftBody: c.body, gateVerdict: 'PASS',
        promptVersion: p.promptVersion, model: p.model, decidedBy: p.decidedBy, decidedAt: NOW, dedupKey: `s8-${seq}-${Date.now()}`,
        gateResults: p.gateResults as Prisma.InputJsonValue,
      }, select: { id: true } })
      return { id: q.id, holds: (rec(p.gateResults).holds as string[] | undefined) ?? [] }
    }
    const W = await row(warnSem)
    const C = await row(cleanSem)
    check('🔴 🔴 **적재기 — 경고가 holds 에 그대로 실린다 (탈락 2 · 추가 1)**',
      W.holds.includes(`${SEMANTIC_HOLD_CODES.droppedFromSource}:2`) && W.holds.includes(`${SEMANTIC_HOLD_CODES.unsupportedAdditions}:1`), W.holds.join(','))
    const wRow = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: W.id } })
    const ev = eligibilityOf({ gateVerdict: wRow.gateVerdict, gateResults: wRow.gateResults, title: wRow.draftTitle, body: wRow.draftBody })
    check('🔴 🔴 **자동 READY 적격 — 경고 행은 예외(도장 · 발행 트랜잭션이 같은 판정을 쓴다)**', !ev.auto && ev.reasons.some((r) => r.includes('SEMANTIC_')), ev.reasons.join(' · '))
    const on = { SORAN_AUTO_READY_ENABLED: 'on' } as const
    const sc = await stampAutoReady(prisma, { queueId: C.id, env: on, now: NOW })
    const sw = await stampAutoReady(prisma, { queueId: W.id, env: on, now: NOW })
    check('대조 — 같은 자리 · 경고 없는 행은 도장된다(gate 열림 · 경고 거부가 경고 때문임을 보인다)', sc.kind === 'stamped', JSON.stringify(sc))
    check('🔴 🔴 **실제 도장 — 경고 행은 exception · 도장 0 · decidedBy 그대로(자동 발행 대상 아님)**', sw.kind === 'exception'
      && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: W.id } })).decidedBy === wRow.decidedBy, JSON.stringify(sw))
  }

  tree.cleanup()
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
  // 🔴 부모와 · 앞선 주입과 원천 id · artifact id 가 겹치지 않게 순번을 띄운다(같은 회차에 여러 번 주입한다)
  f.seq = 1000 + (Date.now() % 900000)
  const a = await defectRow(f, BLOCKED)
  console.log(a.queueId)
  await prisma.$disconnect()
}

if (process.argv.includes('--inject-defect')) {
  injectDefect().then(() => process.exit(0), (e: unknown) => { console.error(e); process.exit(1) })
} else {
  main().catch((e: unknown) => { console.error(e); process.exit(1) })
}
