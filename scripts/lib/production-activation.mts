/**
 * 🔴 **운영 적용 열림 — 사실 수집 · 판정 붙이기** (2026-10-02 · Phase G)
 *
 *   판정은 `src/lib/production-activation-guard.ts` 하나다. 여기는 진짜 명령(git · launchctl · 파일)을 붙인다.
 *   🔴 읽기만 한다 — `git fetch origin main` 외에 아무것도 바꾸지 않는다. job 을 내리거나 올리지 않는다.
 *   🔴 canonical env 는 기존 helper(`readEnvKeys`)로 읽고, 운영 모드에서만 그 값으로 DB 주소를 **덮는다**
 *      (셸에서 물려받은 주소를 믿지 않는다). 값 · secret 을 찍지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  activationModeOf, approvalOf, looksIsolatedDb, productionGuardProblems, writerStateOf,
  type ActivationMode, type Approval, type ProductionFacts, type WriterProbe,
} from '../../src/lib/production-activation-guard'
import { RUNTIME_JOBS } from '../../src/lib/runtime-isolation'
import { readEnvKeys } from './ops-signals.mjs'
import { DEPLOY_QUIESCE_JOBS } from './runtime-quiesce-jobs'

/** 🔴 D100 writer job — 공급 job(`RUNTIME_JOBS`) + 같은 runtime 트리에서 쓰는 job(`DEPLOY_QUIESCE_JOBS`). label 을 다시 적지 않는다 */
export const D100_WRITER_JOBS: readonly string[] = [...new Set([...RUNTIME_JOBS, ...DEPLOY_QUIESCE_JOBS])]

export type FactPaths = { repoRoot: string; runtimeRoot: string; canonDir: string; envFile?: string }
/** 🔴 runtime 배포기(`runtime-deploy.mts`)와 같은 자리 */
export const DEFAULT_PATHS = (repoRoot: string): FactPaths => ({
  repoRoot,
  runtimeRoot: join(homedir(), 'Documents', 'soransoran-runtime'),
  canonDir: join(homedir(), 'Library', 'Application Support', 'soransoran'),
})

const git = (cwd: string, args: readonly string[]): string | null => {
  try { return execFileSync('git', [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}
const probe = (label: string): WriterProbe => {
  const uid = process.getuid?.() ?? 0
  try {
    const out = execFileSync('launchctl', ['print', `gui/${uid}/${label}`], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { label, exitCode: 0, stdout: out, stderr: '' }
  } catch (e) {
    const x = e as { status?: number | null; stdout?: string; stderr?: string }
    return { label, exitCode: typeof x.status === 'number' ? x.status : null, stdout: String(x.stdout ?? ''), stderr: String(x.stderr ?? '') }
  }
}

/** 🔴 실행 직전의 사실 — fetch 는 여기서 한다 */
export function collectProductionFacts(p: FactPaths): ProductionFacts {
  const fetched = git(p.repoRoot, ['fetch', '-q', 'origin', 'main']) !== null
  const originMain = fetched ? git(p.repoRoot, ['rev-parse', 'refs/remotes/origin/main']) : null
  const status = git(p.runtimeRoot, ['status', '--porcelain'])
  let manifestSha: string | null = null
  try {
    const m = JSON.parse(readFileSync(join(p.canonDir, 'runtime-manifest.json'), 'utf-8')) as { sha?: unknown }
    manifestSha = typeof m.sha === 'string' ? m.sha.trim() : null
  } catch { manifestSha = null }
  let pin: string | null = null
  try { pin = readFileSync(join(p.canonDir, 'runtime-pinned-sha'), 'utf-8').trim() } catch { pin = null }
  const env = p.envFile === undefined ? readEnvKeys(['DATABASE_URL', 'DIRECT_URL']) : readEnvKeys(['DATABASE_URL', 'DIRECT_URL'], p.envFile)
  const url = env.values.DATABASE_URL ?? ''
  return {
    originMain,
    repoHead: git(p.repoRoot, ['rev-parse', 'HEAD']),
    runtimeHead: git(p.runtimeRoot, ['rev-parse', 'HEAD']),
    runtimePin: pin,
    runtimeManifestSha: manifestSha,
    runtimeClean: status === null ? null : status === '',
    writers: D100_WRITER_JOBS.map((label) => ({ label, state: writerStateOf(probe(label)) })),
    canonicalEnv: { read: env.ok, hasDatabaseUrl: url !== '', looksIsolated: url !== '' && looksIsolatedDb(url) },
  }
}

export type CliActivation =
  | { kind: 'dry-run' }
  | { kind: 'isolated' }
  | { kind: 'production'; target: string; approval: Approval }
  | { kind: 'refuse'; problems: string[] }

const argOf = (argv: readonly string[], k: string): string | null => {
  const i = argv.findIndex((a) => a === k || a.startsWith(`${k}=`))
  if (i < 0) return null
  return argv[i]!.includes('=') ? argv[i]!.slice(k.length + 1) : (argv[i + 1] ?? null)
}

/**
 * 🔴 **CLI 의 열림 하나** — 플래그 → (운영이면) 승인 → 사실 → 판정. 운영 열림이면 canonical env 로 DB 주소를 덮는다.
 *    `collect` 는 시험이 바꿔 끼운다(기본은 진짜 사실). 운영이 아닌 모드는 사실을 모으지 않는다(fetch 0).
 */
export function openActivation(argv: readonly string[], opts: {
  repoRoot: string
  collect?: (p: FactPaths) => ProductionFacts
  paths?: FactPaths
}): CliActivation {
  const mode: ActivationMode = activationModeOf({
    apply: argv.includes('--apply'), production: argv.includes('--production'), target: argOf(argv, '--target'),
  })
  if (mode.mode === 'refuse') return { kind: 'refuse', problems: mode.problems }
  if (mode.mode === 'dry-run') return { kind: 'dry-run' }
  if (mode.mode === 'isolated') return { kind: 'isolated' }
  const ap = approvalOf({ digest: argOf(argv, '--digest'), expect: argOf(argv, '--expect'), reason: argOf(argv, '--reason') })
  if (!ap.ok) return { kind: 'refuse', problems: ap.problems }
  if ((process.env.SORAN_ISOLATED_DB ?? '') !== '') return { kind: 'refuse', problems: ['SORAN_ISOLATED_DB 가 켜진 채로 운영을 열지 않는다'] }
  const paths = opts.paths ?? DEFAULT_PATHS(opts.repoRoot)
  const facts = (opts.collect ?? collectProductionFacts)(paths)
  const problems = productionGuardProblems(mode.target, facts)
  if (problems.length > 0) return { kind: 'refuse', problems }
  // 🔴 셸에서 물려받은 주소를 믿지 않는다 — canonical env 값으로 덮는다(찍지 않는다)
  const env = paths.envFile === undefined ? readEnvKeys(['DATABASE_URL', 'DIRECT_URL']) : readEnvKeys(['DATABASE_URL', 'DIRECT_URL'], paths.envFile)
  for (const k of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    if ((env.values[k] ?? '') !== '') process.env[k] = env.values[k]
    else delete process.env[k]
  }
  return { kind: 'production', target: mode.target, approval: ap.approval }
}
