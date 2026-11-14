#!/usr/bin/env tsx
/**
 * D30 Persona cohort(wave7-d30 · P44~P63) **1회 무인 투입** — 🔴 기본은 dry-run(판정만 · write 0)
 *
 *   npx tsx scripts/persona-d30-oneshot.mts --date=2026-11-15            # 판정만 — DB write 0
 *   npx tsx scripts/persona-d30-oneshot.mts --date=2026-11-15 --apply    # 🔴 launchd 가 07:05 에 부른다
 *
 * 🔴 판정은 `scripts/lib/persona-d30-oneshot.mts` 하나다. 이 파일은 관측을 모으고 정본 명령을 부를 뿐이다.
 * 🔴 쓰기는 정본 `persona-cohort-run` 만 한다 — create → seed → check → activate. 이 파일은 DB 에 쓰지 않는다.
 *    seed 파일은 정본 `persona-cohort-seed --write` 가 만든다(승인 fixture digest 고정 · 재조립 바이트 대조).
 * 🔴 실패 처리
 *    · 판정 NO-GO → write 0 · 표식 없음(사람이 원인을 고친 뒤 같은 날 수동 재실행 가능)
 *    · 실행 중 단계 실패 → 켜기 전이면 draft 그대로(운영 노출 0) `held` · 켠 뒤 결과가 PASS 가 아니면 **새 cohort 만** pause
 *    · 표식 `started` 가 남아 있으면(중간 사망) 다음 실행은 무조건 멈춘다 — 사람이 DB 를 보고 판단한다
 * 🔴 하지 않는 것: StageDecision · READY · 장부 · 발행 · 댓글 · 기존 40 · migration · raw SQL
 * 🔴 출력은 JSON 한 줄씩(구조화 로그) — 코드 · 개수 · 판정 코드만. Persona 표시명·말투·회원 정보 0
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import {
  APPROVED_SUPPLEMENT_PLAN_DIGEST, COHORT_CODES, ONESHOT_COHORT, ONESHOT_WINDOW,
  judgeOneShot, judgeOutcome, remediationEligible, supplementApprovalDigestOf,
  type Identity, type MarkerState, type OneShotFacts,
} from './lib/persona-d30-oneshot.mjs'
import { executeOneShot, type Step } from './lib/persona-d30-oneshot-exec.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readPersonaCapacity } from './lib/persona-reserve-facts.mjs'
import { P15_PRODUCTION_PINS } from './lib/persona-p15-remediation.mjs'
import { fillDbConnection } from './lib/ops-signals.mjs'
import { assignmentDigest } from './lib/persona-reference-supplement-store.mjs'
import { stableAssignment } from './lib/persona-reference-store.mjs'
import { DEPLOY_QUIESCE_JOBS } from './lib/runtime-quiesce-jobs'
import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
import { readRuntimePersonaAssetIdentity } from '../src/lib/persona-reference-digest'
import { supplementPaths } from '../src/lib/persona-reference-supplement'
import { judgeJobState, RETIRED_JOBS, RUNTIME_JOBS } from '../src/lib/runtime-isolation'
import { validPersonaAssetIdentity } from '../src/lib/runtime-deploy'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const TARGET_DATE = (argv.find((a) => a.startsWith('--date='))?.split('=')[1] ?? '').trim()
/**
 * 🔴 dry-run 전용 시각 가정 — `--assume-kst=2026-11-14T07:05`. 창·날짜를 가정해 **나머지 게이트를 실제 상태로** 평가한다.
 *    `--apply` 와 함께 쓰면 거부한다. 가정한 날짜의 실제 StageDecision 행을 읽는다(쓰지 않는다).
 */
const ASSUME = (argv.find((a) => a.startsWith('--assume-kst='))?.split('=')[1] ?? '').trim() || null
const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
const RUNTIME_ROOT = join(homedir(), 'Documents', 'soransoran-runtime')
const MARKER_DIR = join(CANON_DIR, 'persona-d30-oneshot')
const MARKER = join(MARKER_DIR, `${TARGET_DATE || 'invalid'}.json`)
const LOCK = join(MARKER_DIR, 'run.lock')
const UID = process.getuid?.() ?? 0

const log = (event: string, data: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), tool: 'persona-d30-oneshot', apply: APPLY, date: TARGET_DATE, event, ...data }))
}
const read = (cmd: string, args: readonly string[], cwd = RUNTIME_ROOT): string | null => {
  try { return execFileSync(cmd, [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}
const kstNow = (): { date: string; minute: number } => {
  if (ASSUME !== null) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(ASSUME)
    if (m === null) throw new Error('--assume-kst 모양 오류')
    return { date: m[1]!, minute: Number(m[2]) * 60 + Number(m[3]) }
  }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) }
}
const readMarker = (): MarkerState | undefined => {
  if (!existsSync(MARKER)) return null
  try {
    const m = JSON.parse(readFileSync(MARKER, 'utf-8')) as { state?: unknown; date?: unknown }
    return typeof m.state === 'string' && typeof m.date === 'string' ? m as MarkerState : undefined
  } catch { return undefined }
}
const writeMarker = (state: NonNullable<MarkerState>['state'], extra: Record<string, unknown> = {}): void => {
  mkdirSync(MARKER_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${MARKER}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify({ state, date: TARGET_DATE, at: new Date().toISOString(), ...extra }, null, 2), { mode: 0o600 })
  renameSync(tmp, MARKER)
}

function observeJobs(): { running: string[]; unknown: string[] } {
  const running: string[] = []
  const unknown: string[] = []
  for (const l of [...new Set([...RUNTIME_JOBS, ...RETIRED_JOBS, ...DEPLOY_QUIESCE_JOBS])]) {
    let out = ''; let code: number | null = 0; let err = ''
    try { out = execFileSync('launchctl', ['print', `gui/${UID}/${l}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e) { const x = e as { status?: number; stdout?: string; stderr?: string }; code = x.status ?? null; out = String(x.stdout ?? ''); err = String(x.stderr ?? '') }
    const { state } = judgeJobState({ exitCode: code, stdout: out, stderr: err })
    if (state === 'unknown') { unknown.push(l); continue }
    if (state === 'loaded' && /state = running/.test(out)) running.push(l)
  }
  return { running, unknown }
}

function approvalDigest(): string | null {
  try {
    const p = supplementPaths(2)
    return supplementApprovalDigestOf(JSON.parse(readFileSync(p.corpus, 'utf-8')), JSON.parse(readFileSync(p.manifest, 'utf-8')))
  } catch { return null }
}
function manifestFacts(): { sha: string | null; identity: Identity | null } {
  try {
    const m = JSON.parse(readFileSync(join(CANON_DIR, 'runtime-manifest.json'), 'utf-8')) as { sha?: unknown; personaAssets?: unknown }
    return { sha: typeof m.sha === 'string' ? m.sha : null, identity: validPersonaAssetIdentity(m.personaAssets) ? m.personaAssets : null }
  } catch { return { sha: null, identity: null } }
}
/** 🔴 기존 40 말투 — 동결 v1 배정과 현재(v2) 배정이 기존 코드에서 바이트 같은가 */
function old40VoiceSame(expectedOld40: readonly string[]): boolean | null {
  try {
    const v1 = stableAssignment({ repoRoot: process.cwd(), supplementGeneration: 1 })
    const now = stableAssignment({ repoRoot: process.cwd() })
    if (!v1.canonicalAsset || !now.canonicalAsset) return null
    return assignmentDigest(v1.byCode, expectedOld40) === assignmentDigest(now.byCode, expectedOld40)
      && expectedOld40.every((c) => v1.byCode.has(c) && now.byCode.has(c))
  } catch { return null }
}

/**
 * 🔴 **DB 클라이언트는 env 를 읽은 뒤에 만든다** (2026-11-15 04:10 host dry-run 재현).
 *    모듈 최상단에서 만들면 `loadEnvLocal()`·`fillDbConnection()` 전이라 DATABASE_URL 이 없어
 *    `PrismaClientInitializationError` 로 모든 판독이 실패한다(fail-closed 로 write 0 이지만 실행도 0).
 *    `main()` 이 env 를 채운 직후 한 번만 만든다. 그 전에 부르면 throw 한다.
 */
let prismaClient: PrismaClient | null = null
/** 정리용 — 열린 적 없으면 null */
const openedClient = (): PrismaClient | null => prismaClient
const db = (): PrismaClient => {
  if (prismaClient === null) throw new Error('PrismaClient 를 env 판독 전에 쓰려 했다')
  return prismaClient
}
type Old40Row = { code: string; status: string; updatedAt: Date }
const old40Fingerprint = async (codes: readonly string[]): Promise<string> => {
  const rows: Old40Row[] = await db().persona.findMany({ where: { code: { in: [...codes] } }, select: { code: true, status: true, updatedAt: true }, orderBy: { code: 'asc' } })
  return JSON.stringify(rows.map((r) => [r.code, r.status, r.updatedAt.toISOString()]))
}

async function gather(expectedOld40: readonly string[]): Promise<OneShotFacts> {
  const now = kstNow()
  const fetched = read('git', ['fetch', '--quiet', 'origin', 'main']) !== null
  const manifest = manifestFacts()
  const jobs = observeJobs()
  const pinRaw = ((): string | null => { try { return readFileSync(join(CANON_DIR, 'runtime-pinned-sha'), 'utf-8').trim() } catch { return null } })()
  const lock = ((): boolean | null => { try { return existsSync(join(CANON_DIR, 'runtime-deploy.lock')) } catch { return null } })()
  let stage: OneShotFacts['stage']
  let old40Active: string[] | null = null
  let cohortExisting: string[] | null = null
  let adminCount: number | null = null
  try {
    const row = await db().stageDecision.findUnique({ where: { kstDate: now.date } })
    stage = row === null ? null : { kstDate: row.kstDate, state: row.state, release: row.release, capacity: row.capacity, decidedBy: row.decidedBy }
    old40Active = (await db().persona.findMany({ where: { status: 'active' }, select: { code: true } })).map((r) => r.code)
    cohortExisting = (await db().persona.findMany({ where: { code: { in: [...COHORT_CODES] } }, select: { code: true } })).map((r) => r.code)
    adminCount = await db().user.count({ where: { isAdmin: true } })
  } catch (e) {
    log('db-read-failed', { reason: (e as Error).name })
    stage = undefined
  }
  const runtimeIdentity = ((): Identity | null => { const x = readRuntimePersonaAssetIdentity(); return validPersonaAssetIdentity(x) ? x : null })()
  return {
    targetDate: TARGET_DATE, kstDate: now.date, kstMinute: now.minute, stage,
    originMain: fetched ? read('git', ['rev-parse', 'refs/remotes/origin/main']) : null,
    head: read('git', ['rev-parse', 'HEAD']), pin: pinRaw, manifestSha: manifest.sha, manifestIdentity: manifest.identity,
    deployLock: lock, runningJobs: jobs.running, unknownJobs: jobs.unknown,
    approvalDigest: approvalDigest(), runtimeIdentity,
    old40VoiceSame: old40VoiceSame(expectedOld40), old40ActiveCodes: old40Active, expectedOld40,
    cohortExisting, adminCount, marker: readMarker(),
    capacity: stage === undefined ? null : await readPersonaCapacity(db(), { now: new Date(), repoRoot: process.cwd() }).catch(() => null),
  }
}

/** 정본 단계 하나 — exit code 와 무관하게 **DB 실측**으로 다음을 정한다 */
const canonical = (step: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): boolean => {
  log('step-start', { step })
  const r = spawnSync('npx', ['tsx', ...args], { cwd: process.cwd(), env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60_000 })
  const last = `${r.stdout ?? ''}`.split('\n').filter((l) => /✅|🔴|중단/.test(l)).slice(-3).map((l) => l.trim().slice(0, 160))
  log('step-end', { step, exit: r.status, signal: r.signal, tail: last })
  return r.status === 0
}
const cohortStatuses = async (): Promise<Map<string, string>> =>
  new Map((await db().persona.findMany({ where: { code: { in: [...COHORT_CODES] } }, select: { code: true, status: true } })).map((r) => [r.code, r.status]))

async function main(): Promise<number> {
  if (ASSUME !== null && APPLY) { log('refuse', { code: 'ASSUME_WITH_APPLY' }); return 2 }
  if (process.cwd() !== RUNTIME_ROOT && APPLY) { log('refuse', { code: 'NOT_RUNTIME_TREE', cwd: process.cwd() }); return 2 }
  await loadEnvLocal()
  if (!fillDbConnection()) { log('refuse', { code: 'CREDENTIAL', reason: 'canonical DB env 없음' }); return 2 }
  prismaClient = new PrismaClient()
  const expectedOld40 = PRODUCTION_PERSONA_CODES.filter((c) => !COHORT_CODES.includes(c))

  // ── 판정 — 잠깐 도는 job(observer 60초 주기)은 창 안에서 다시 본다 ──
  let facts = await gather(expectedOld40)
  let verdict = judgeOneShot(facts)
  for (let i = 0; i < 6 && !verdict.go && verdict.code === 'JOB_RUNNING' && kstNow().minute <= ONESHOT_WINDOW.endMinute; i++) {
    log('wait-running-jobs', { running: facts.runningJobs })
    await new Promise((r) => setTimeout(r, 15_000))
    facts = await gather(expectedOld40)
    verdict = judgeOneShot(facts)
  }
  log('verdict', {
    code: verdict.code, problems: verdict.problems,
    stage: facts.stage === undefined ? 'UNKNOWN' : facts.stage === null ? null : `${facts.stage.state}·${facts.stage.release}·${facts.stage.capacity}`,
    runtime: facts.head?.slice(0, 12) ?? null, approvalDigest: facts.approvalDigest?.slice(0, 12) ?? null,
    expectedApproval: APPROVED_SUPPLEMENT_PLAN_DIGEST.slice(0, 12), cohortExisting: facts.cohortExisting?.length ?? null,
  })
  const needsRemediation = remediationEligible(verdict, facts)
  log('capacity', { capacity: facts.capacity, remediationEligible: needsRemediation })
  if (!verdict.go && !needsRemediation) { log('done', { result: verdict.noop === true ? 'NOOP' : 'NO_GO', write: 0 }); return verdict.noop === true ? 0 : 3 }
  if (!APPLY) { log('done', { result: needsRemediation ? 'DRY_RUN_GO_AFTER_P15_REMEDIATION' : 'DRY_RUN_GO', write: 0 }); return 0 }

  // ── 단일 실행 잠금 ──
  mkdirSync(MARKER_DIR, { recursive: true, mode: 0o700 })
  let fd: number
  try { fd = openSync(LOCK, 'wx', 0o600) } catch { log('refuse', { code: 'ONESHOT_LOCK' }); return 3 }
  writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`); closeSync(fd)
  try {
    // 🔴 잠금 안의 순서는 `executeOneShot` 하나다 — 격리 DB 통합 검사가 같은 함수를 부른다
    const C = `--cohort=${ONESHOT_COHORT}`
    const N = `--limit=${COHORT_CODES.length}`
    const REASON = `D30 cohort 무인 1회 투입 — 창업자 승인(2026-11-15 세션) · 실행기 persona-d30-oneshot · ${TARGET_DATE} PREPARE·d20·d30`
    const STEP_ARGS: Record<Step, string[]> = {
      'seed-file': ['scripts/persona-cohort-seed.mts', C, '--write'],
      create: ['scripts/persona-cohort-run.mts', C, '--step=create', '--apply', N],
      seed: ['scripts/persona-cohort-run.mts', C, '--step=seed', '--apply', N],
      'check-before-activate': ['scripts/persona-cohort-run.mts', C, '--step=check'],
      activate: ['scripts/persona-cohort-run.mts', C, '--step=activate', '--apply', N, '--reason', REASON],
      'check-after-activate': ['scripts/persona-cohort-run.mts', C, '--step=check'],
    }
    const r = await executeOneShot({
      gather: () => gather(expectedOld40),
      writeMarker: (state, extra = {}) => writeMarker(state, { runtime: facts.head, ...extra }),
      remediate: async () => canonical('p15-remediation', ['scripts/persona-p15-remediation.mts', '--apply',
        `--expect-before=${P15_PRODUCTION_PINS.beforeIdentityDigest}`, `--reason=D30 투입 전 P15 정본 교정 · persona-d30-oneshot · ${TARGET_DATE}`]),
      step: async (st, actor) => canonical(st, STEP_ARGS[st], actor === null ? process.env : { ...process.env, ACTOR_USER_ID: actor }),
      pause: async (actor, why) => canonical('pause', ['scripts/persona-cohort-run.mts', C, '--step=pause', '--apply', N, '--reason', `${REASON} · 자동 되돌림(${why})`], { ...process.env, ACTOR_USER_ID: actor }),
      cohortStatuses,
      adminIds: async () => (await db().user.findMany({ where: { isAdmin: true }, select: { id: true } })).map((u) => u.id),
      old40Fingerprint: () => old40Fingerprint(expectedOld40),
      counts: async () => ({
        totalActive: await db().persona.count({ where: { status: 'active' } }),
        cohortActive: await db().persona.count({ where: { code: { in: [...COHORT_CODES] }, status: 'active' } }),
      }),
      capacity: () => readPersonaCapacity(db(), { now: new Date(), repoRoot: process.cwd() }),
      log,
    })
    log('done', { ...r })
    return r.exit
  } finally {
    try { unlinkSync(LOCK) } catch { /* 이미 없다 */ }
  }
}

let code = 1
try { code = await main() } catch (e) { log('crash', { error: (e as Error).name, message: (e as Error).message.slice(0, 200) }); code = 1 }
finally { await openedClient()?.$disconnect().catch(() => undefined) }
process.exit(code)
