#!/usr/bin/env tsx
/**
 * 공급 러너 커널 lease · 실행 token(shadow) 검사 (2026-10-12 Batch C1)
 *
 *   npx tsx scripts/supply-lease-check.mts
 *
 * ① 순수 — token 모양 · shadow 판정 다섯 칸 · 예산 창 이름 · follow-up trigger 보존 · 띄운 이유 = 지금 예산 판정 · 자식 stdio
 * ② 예산 판정 불변 — token · lease 표식이 있어도 `supplySpendProtectAt` 결과가 같다(token 은 예산 허가가 아니다)
 * ③ 실제 OS 프로세스 (macOS + /usr/bin/lockf 전용 · 그 밖은 SKIP 이고 PASS 로 세지 않는다)
 *    holder 1 + contender 다수 · follow-up 상한 · 시작 전 event 표식 · 깨진 표식 · SIGKILL 재획득 ·
 *    부모 종료 뒤 자식 생존 · fd 9 실제 자식 전달 · 위조 거절 · busy 재시도 · probe · 최초 실행 · 실제 러너 진입
 * ④ fail-closed — lockf 없음 → 본체 0 (Linux 에서도 돈다)
 *
 * 🔴 DB 0 · provider 0 · 운영 HOME 0 — 모든 실행은 임시 HOME · 임시 cwd 다. 운영 lockf 잠금 파일을 건드리지 않는다.
 */
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FOLLOW_UP_FILE, LEASE_FD_ENV, LEASE_INNER_ENV, LOCKF_PATH, MAX_FOLLOW_UPS,
  followUpTriggerOf, lockfUsable, mergePassTrigger, probeKernelLease, shouldRunFollowUp,
} from './lib/runner-lease.mjs'
import {
  FAKE_LOCKF_MARK, SUPPLY_LOCK_FILE, SUPPLY_PASS_ENV, SUPPLY_RUN_TOKEN_ENV, SUPPLY_RUN_TOKEN_FILE,
  stageSpawnOf, supplyLaunchTrigger, supplyLockDir, supplyLockfPath, writeRunTokenAtomic,
} from './lib/supply-lease.mjs'
import {
  RUN_TOKEN_TTL_MS, RUN_TOKEN_VERSION, budgetWindowShadowOf, buildRunToken, judgeRunTokenShadow, parseRunToken,
  shadowTagOf, supplyRunIdOf, type RunToken,
} from '../src/lib/supply-run-token'
import {
  LAUNCHD_LABEL_ENV, SUPPLY_PROCESS_LAUNCHD_LABEL, supplyRunKindOf, supplySpendProtectAt,
} from '../src/lib/supply-scheduled-reserve'
import { SUPPLY_RUN_WINDOW_MS } from '../src/lib/supply-process'
import type { LedgerEntry } from '../src/lib/llm-ledger'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  ❌ ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}
const REPO = process.cwd()
const kst = (s: string): Date => new Date(`${s}+09:00`)

// ─────────────────────────────────────────────────────────
console.log('\n① 순수 — token · shadow · 창 · trigger')
// ─────────────────────────────────────────────────────────
{
  check('예산 창(shadow) — 첫 슬롯 전은 첫 슬롯의 창', budgetWindowShadowOf(kst('2026-10-12T05:30:00')) === '2026-10-12 06:15')
  check('예산 창(shadow) — 슬롯 시각 정각은 그 슬롯', budgetWindowShadowOf(kst('2026-10-12T12:15:00')) === '2026-10-12 12:15')
  check('예산 창(shadow) — 다음 슬롯 직전까지 앞 슬롯 (이어 붙인 창 · 45분 창이 아니다)',
    budgetWindowShadowOf(kst('2026-10-12T12:14:59')) === '2026-10-12 08:15' && budgetWindowShadowOf(kst('2026-10-12T16:59:00')) === '2026-10-12 14:15')
  check('예산 창(shadow) — 마지막 슬롯 뒤 자정 전은 마지막 슬롯 · KST 날짜', budgetWindowShadowOf(kst('2026-10-12T23:59:00')) === '2026-10-12 22:15'
    && budgetWindowShadowOf(kst('2026-10-13T00:05:00')) === '2026-10-13 06:15')
  check('회차 id = 회차 시각(UTC) YYYYMMDD-HHMMSS', supplyRunIdOf(new Date('2026-10-12T09:22:47.039Z')) === '20261012-092247')
  check('token 수명 = 공급 회차 정상 수명(45분)', RUN_TOKEN_TTL_MS === SUPPLY_RUN_WINDOW_MS && RUN_TOKEN_TTL_MS === 45 * 60_000)

  const at = new Date('2026-10-12T03:00:00.000Z')
  const lock = { dev: 16777230, ino: 86300280 }
  const tok = buildRunToken({
    tokenId: 't-1', trigger: 'event', launchTrigger: 'manual', absorbedTrigger: 'event', absorbedAt: '2026-10-12T02:59:00.000Z',
    issuedAt: at, lock, runId: supplyRunIdOf(at), pass: 0,
  })
  const raw = JSON.stringify(tok)
  check('token 모양 — 일곱 칸(tokenId · trigger · budgetWindow · issuedAt · expiresAt · lock · runId) 전부', parseRunToken(raw) !== null
    && tok.version === RUN_TOKEN_VERSION && tok.budgetWindowShadow === '2026-10-12 08:15'
    && Date.parse(tok.expiresAt) - Date.parse(tok.issuedAt) === RUN_TOKEN_TTL_MS && tok.runId === '20261012-030000')
  const bad = (f: (t: Record<string, unknown>) => void): string => { const t = JSON.parse(raw) as Record<string, unknown>; f(t); return JSON.stringify(t) }
  check('🔴 깨진 token → null (JSON 아님 · 버전 · 만료를 멀리 · identity 없음 · trigger 모름 · 창 모양)',
    parseRunToken('{oops') === null
    && parseRunToken(bad((t) => { t.version = 'v0' })) === null
    && parseRunToken(bad((t) => { t.expiresAt = '2099-01-01T00:00:00.000Z' })) === null
    && parseRunToken(bad((t) => { delete t.lock })) === null
    && parseRunToken(bad((t) => { t.trigger = 'cron' })) === null
    && parseRunToken(bad((t) => { t.budgetWindowShadow = '08:15' })) === null)

  const proven = { kind: 'proven' as const, identity: lock }
  const J = (o: Partial<Parameters<typeof judgeRunTokenShadow>[0]>) => judgeRunTokenShadow({
    lease: proven, envTokenId: 't-1', file: { kind: 'raw', raw }, now: new Date(at.getTime() + 60_000), ...o,
  })
  const code = (s: ReturnType<typeof judgeRunTokenShadow>): string => (s.ok ? 'OK' : s.code)
  check('shadow — 다섯 칸이 다 맞으면 ok · trigger · 창', (() => { const s = J({}); return s.ok && s.trigger === 'event' && s.budgetWindowShadow === '2026-10-12 08:15' })())
  check('🔴 shadow — lease 표식 없음(손 실행) → NO_LEASE', code(J({ lease: { kind: 'absent' } })) === 'NO_LEASE')
  check('🔴 shadow — lease 증명 실패(fd 위조) → LEASE_NOT_PROVEN', code(J({ lease: { kind: 'unproven' } })) === 'LEASE_NOT_PROVEN')
  check('🔴 shadow — token env 없음 → NO_TOKEN_ENV', code(J({ envTokenId: null })) === 'NO_TOKEN_ENV' && code(J({ envTokenId: '' })) === 'NO_TOKEN_ENV')
  check('🔴 shadow — 파일 없음 · 못 읽음', code(J({ file: { kind: 'missing' } })) === 'TOKEN_MISSING' && code(J({ file: { kind: 'unreadable' } })) === 'TOKEN_UNREADABLE')
  check('🔴 shadow — corrupt token → TOKEN_CORRUPT', code(J({ file: { kind: 'raw', raw: '{"version":' } })) === 'TOKEN_CORRUPT')
  check('🔴 shadow — env id 위조 → TOKEN_ID_MISMATCH', code(J({ envTokenId: 't-2' })) === 'TOKEN_ID_MISMATCH')
  check('🔴 shadow — lock identity 불일치(다른 잠금 파일) → LOCK_IDENTITY_MISMATCH',
    code(J({ lease: { kind: 'proven', identity: { dev: lock.dev, ino: lock.ino + 1 } } })) === 'LOCK_IDENTITY_MISMATCH')
  check('🔴 shadow — 만료 token(발급 + 45분) → TOKEN_EXPIRED · 직전은 ok',
    code(J({ now: new Date(at.getTime() + RUN_TOKEN_TTL_MS) })) === 'TOKEN_EXPIRED' && code(J({ now: new Date(at.getTime() + RUN_TOKEN_TTL_MS - 1) })) === 'OK')
  check('🔴 shadow — 미래 발급(시계 오차 1분 초과) → TOKEN_NOT_YET_VALID', code(J({ now: new Date(at.getTime() - 61_000) })) === 'TOKEN_NOT_YET_VALID')
  check('장부 칸 모양 — 실패면 trigger · 창을 싣지 않는다', (() => {
    const t = shadowTagOf(J({ envTokenId: 't-2' }))
    return !t.ok && t.code === 'TOKEN_ID_MISMATCH' && t.trigger === null && t.budgetWindow === null
  })())

  check('follow-up 표식 trigger — 네 값은 그대로 · 깨짐 · 모르는 값 · 칸 없음은 unknown(추정 0)',
    (['scheduled', 'event', 'recovery', 'manual'] as const).every((t) => followUpTriggerOf(JSON.stringify({ at: at.toISOString(), trigger: t })).trigger === t)
    && followUpTriggerOf('{oops').trigger === 'unknown' && followUpTriggerOf('{"trigger":"cron"}').trigger === 'unknown'
    && followUpTriggerOf('{}').trigger === 'unknown' && followUpTriggerOf('null').trigger === 'unknown')
  check('첫 회차 trigger — 더 강한 쪽 · unknown 은 올리지 않는다',
    mergePassTrigger('manual', 'event') === 'event' && mergePassTrigger('scheduled', 'manual') === 'scheduled'
    && mergePassTrigger('manual', 'unknown') === 'manual' && mergePassTrigger('recovery', null) === 'recovery'
    && mergePassTrigger('event', 'scheduled') === 'scheduled')
  check('follow-up 상한 — 첫 회차 뒤 한 번', MAX_FOLLOW_UPS === 1 && shouldRunFollowUp(0, 'TAKEN') && !shouldRunFollowUp(1, 'TAKEN'))

  // 띄운 이유 = 지금 예산 판정의 실행 종류(같은 함수)
  const label = { [LAUNCHD_LABEL_ENV]: SUPPLY_PROCESS_LAUNCHD_LABEL }
  const grid: [Record<string, string>, string][] = [
    [label, '2026-10-12T08:15:30'], [label, '2026-10-12T08:59:59'], [label, '2026-10-12T09:00:01'], [label, '2026-10-12T07:40:00'],
    [{}, '2026-10-12T08:16:00'], [{ [LAUNCHD_LABEL_ENV]: 'com.soransoran.persona-comment-runner' }, '2026-10-12T12:16:00'],
    [label, '2026-10-12T22:59:00'], [label, '2026-10-12T23:01:00'],
  ]
  check('🔴 띄운 이유 = 지금 예산 판정의 실행 종류(supplyRunKindOf) — 라벨 + 45분 슬롯 창 안만 scheduled',
    grid.every(([env, t]) => supplyLaunchTrigger(env, kst(t)) === supplyRunKindOf(env, kst(t)).kind)
    && supplyLaunchTrigger(label, kst('2026-10-12T08:15:30')) === 'scheduled'
    && supplyLaunchTrigger(label, kst('2026-10-12T09:00:01')) === 'manual'
    && supplyLaunchTrigger({}, kst('2026-10-12T08:16:00')) === 'manual')

  const proof = { lockPath: '/x', followUpDir: '/', lockf: LOCKF_PATH, fd: 9 }
  const withFd = stageSpawnOf('scripts/x.mts', ['--a'], proof)
  const noFd = stageSpawnOf('scripts/x.mts', ['--a'], null)
  const io = (s: unknown): unknown[] => (Array.isArray(s) ? s : [])
  check('🔴 자식 단계 — npx 없이 같은 Node · stdio 0·1·2 는 ignore·pipe·pipe · lease 가 있으면 9 번 칸에 fd 9',
    withFd.command === process.execPath && !withFd.args.includes('npx') && withFd.args.includes('scripts/x.mts')
    && JSON.stringify(io(withFd.stdio).slice(0, 3)) === '["ignore","pipe","pipe"]' && io(withFd.stdio).length === 10 && io(withFd.stdio)[9] === 9
    && JSON.stringify(io(noFd.stdio)) === '["ignore","pipe","pipe"]')

  const g = globalThis as unknown as Record<symbol, unknown>
  const prodPath = supplyLockfPath()
  g[FAKE_LOCKF_MARK] = '/tmp/fake'
  const testPath = supplyLockfPath()
  delete g[FAKE_LOCKF_MARK]
  check('🔴 lockf 대역은 가짜 provider 훅이 건 표식이 있을 때만 — 운영 경로는 env 를 보지 않고 언제나 /usr/bin/lockf',
    prodPath === LOCKF_PATH && testPath === '/tmp/fake' && supplyLockfPath() === LOCKF_PATH)
  {
    const hook = readFileSync('scripts/lib/fake-provider-hook.mjs', 'utf-8')
    const users = spawnSync('grep', ['-rlF', 'soransoran.test.fake-runner-lockf', 'scripts', 'src'], { encoding: 'utf-8' }).stdout.trim().split('\n')
      .filter((x) => x !== '' && x !== 'scripts/supply-lease-check.mts').sort()
    check('🔴 lockf 대역 표식을 거는 곳은 가짜 provider 훅 하나 · 읽는 곳은 supply-lease 하나',
      /globalThis\[Symbol\.for\('soransoran\.test\.fake-runner-lockf'\)\] = process\.env\.FAKE_RUNNER_LOCKF/.test(hook)
      && JSON.stringify(users) === JSON.stringify(['scripts/lib/fake-provider-hook.mjs', 'scripts/lib/supply-lease.mts']), users.join(','))
    const leaseSrc = readFileSync('scripts/lib/supply-lease.mts', 'utf-8')
    check('🔴 supply-lease 는 가짜 provider 격리 표식 · FAKE_RUNNER_LOCKF env 를 읽지 않는다', !/fake-provider-ledger-isolation|env\[FAKE_LOCKF_ENV\]/.test(leaseSrc))
  }
  check('잠금 디렉터리 — Application Support 아래 공급 전용', supplyLockDir('/h') === '/h/Library/Application Support/soransoran/supply-process'
    && SUPPLY_LOCK_FILE === 'process.kernel-lock')
}

// ─────────────────────────────────────────────────────────
console.log('\n② 예산 판정 불변 — token · lease 표식은 예산 허가가 아니다')
// ─────────────────────────────────────────────────────────
{
  const label = { [LAUNCHD_LABEL_ENV]: SUPPLY_PROCESS_LAUNCHD_LABEL }
  const forged = {
    [LEASE_INNER_ENV]: '/x/process.kernel-lock', [LEASE_FD_ENV]: '9', [SUPPLY_RUN_TOKEN_ENV]: 'tok', [SUPPLY_PASS_ENV]: '0',
  }
  const entries: LedgerEntry[] = []
  const times = ['2026-10-12T07:10:00', '2026-10-12T08:16:00', '2026-10-12T09:05:00', '2026-10-12T12:20:00', '2026-10-12T22:40:00', '2026-10-12T23:30:00']
  const same = times.every((t) => [label, {}].every((env) => {
    const a = supplySpendProtectAt({ env, now: kst(t), todayEntries: entries, historyEntries: null, dailyUsd: 0.3 })
    const b = supplySpendProtectAt({ env: { ...env, ...forged }, now: kst(t), todayEntries: entries, historyEntries: null, dailyUsd: 0.3 })
    return JSON.stringify(a) === JSON.stringify(b)
  }))
  check('🔴 같은 시각 · 같은 라벨이면 lease · token 표식이 있어도 예산 판정(종류 · 몫 · 천장) 결과가 바이트 단위로 같다', same)
  const call = readFileSync('scripts/lib/supply-llm-call.mts', 'utf-8')
  const code = call.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  check('🔴 장부 세션 — shadow 는 줄에 나란히 적기만 한다(판정 함수 · 보호 판정 인자에 들어가지 않는다)',
    (code.match(/tokenShadow/g) ?? []).length === 3 && (code.match(/\.\.\.tokenShadow,/g) ?? []).length === 2
    && !/protectAt\([^)]*tokenShadow|judgeSpend\(\{[^}]*tokenShadow/.test(code))
  const reserve = readFileSync('src/lib/supply-scheduled-reserve.ts', 'utf-8')
  check('🔴 예산 판정 정본이 token · lease 를 보지 않는다', !/run-token|runToken|supply-lease|LEASE_|SORAN_SUPPLY_RUN_TOKEN/.test(reserve))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 실제 OS 프로세스 — 커널 lease · follow-up · fd 9 · 위조')
// ─────────────────────────────────────────────────────────
const REAL = process.platform === 'darwin' && lockfUsable(LOCKF_PATH)
const skip = (name: string): void => console.log(`  ⏭️  SKIP(macOS + /usr/bin/lockf 전용 · PASS 로 세지 않는다) ${name}`)
const ROOT = mkdtempSync(join(tmpdir(), 'supply-lease-check-'))
const HOME = join(ROOT, 'home')
mkdirSync(HOME)
const LOCKD = supplyLockDir(HOME)
const LOCKP = join(LOCKD, SUPPLY_LOCK_FILE)
const LOG = join(ROOT, 'passes.jsonl')
const LEAF = join(ROOT, 'leaf.mts')
const HARNESS = join(ROOT, 'harness.mts')
const lib = (p: string): string => JSON.stringify(join(REPO, p))
writeFileSync(LEAF, [
  "import { appendFileSync } from 'node:fs'",
  `import { runTokenShadowFromEnv } from ${lib('scripts/lib/supply-lease.mjs')}`,
  'const [log, tag] = process.argv.slice(2)',
  "appendFileSync(log!, JSON.stringify({ kind: 'leaf', tag, pid: process.pid, ppid: process.ppid, shadow: runTokenShadowFromEnv(process.env, new Date()) }) + '\\n')",
].join('\n'))
/** 🔴 실제 진입 함수(`supplyEntry`)와 실제 자식 띄우기(`stageSpawnOf`)를 그대로 쓰는 하네스 — 본체만 시작 · 끝을 적고 잔다 */
writeFileSync(HARNESS, [
  "import { appendFileSync, writeFileSync } from 'node:fs'",
  "import { spawnSync } from 'node:child_process'",
  "import { join } from 'node:path'",
  "import { fileURLToPath } from 'node:url'",
  `import { supplyEntry, stageSpawnOf, runTokenShadowFromEnv, supplyLockDir, SUPPLY_RUN_TOKEN_FILE, FAKE_LOCKF_MARK } from ${lib('scripts/lib/supply-lease.mjs')}`,
  'const [log, holdMs, leaf] = process.argv.slice(2)',
  "if ((process.env.HARNESS_FAKE_LOCKF ?? '') !== '') (globalThis as Record<symbol, unknown>)[FAKE_LOCKF_MARK] = process.env.HARNESS_FAKE_LOCKF",
  'const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))',
  'const code = await supplyEntry({ scriptPath: fileURLToPath(import.meta.url), argv: process.argv.slice(2), env: process.env, log: () => undefined,',
  '  body: async (proof) => {',
  "    const pass = Number(process.env.SORAN_SUPPLY_PASS)",
  "    const token = process.env.SORAN_SUPPLY_RUN_TOKEN ?? null",
  "    appendFileSync(log!, JSON.stringify({ kind: 'start', pid: process.pid, ppid: process.ppid, pass, at: Date.now(), runAt: process.env.SORAN_RUN_AT, token, shadow: runTokenShadowFromEnv(process.env, new Date()) }) + '\\n')",
  "    if (leaf !== undefined && leaf !== '-') {",
  "      const env = { ...process.env }",
  "      if (leaf === 'wrong-token') env.SORAN_SUPPLY_RUN_TOKEN = 'not-the-token'",
  "      if (leaf === 'corrupt-token') writeFileSync(join(supplyLockDir(), SUPPLY_RUN_TOKEN_FILE), '{broken')",
  "      const how = stageSpawnOf(" + JSON.stringify(LEAF) + ", [log!, leaf], leaf === 'no-fd' ? null : proof)",
  '      spawnSync(how.command, how.args, { stdio: how.stdio, env })',
  "      if (leaf === 'npx') spawnSync('npx', ['tsx', " + JSON.stringify(LEAF) + ", log!, 'npx'], { stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', proof.fd], env })",
  '    }',
  '    await sleep(Number(holdMs))',
  "    appendFileSync(log!, JSON.stringify({ kind: 'end', pid: process.pid, pass, at: Date.now() }) + '\\n')",
  '    return 0',
  '  } })',
  'process.exit(code)',
].join('\n'))

type Line = { kind: string; pid: number; ppid: number; pass: number; at: number; runAt?: string; token?: string | null; tag?: string
  shadow?: { ok: boolean; code?: string; trigger?: string; tokenId?: string | null } }
const lines = (): Line[] => (existsSync(LOG) ? readFileSync(LOG, 'utf-8') : '').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Line)
const starts = (): Line[] => lines().filter((l) => l.kind === 'start')
const leaves = (): Line[] => lines().filter((l) => l.kind === 'leaf')
const maxConcurrent = (): number => {
  const ev = lines().filter((l) => l.kind !== 'leaf').map((l) => ({ at: l.at, d: l.kind === 'start' ? 1 : -1 })).sort((x, y) => x.at - y.at || x.d - y.d)
  let cur = 0; let max = 0
  for (const e of ev) { cur += e.d; max = Math.max(max, cur) }
  return max
}
const baseEnv = (): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', HOME }
  return e
}
type Opt = { env?: NodeJS.ProcessEnv; fd9?: number; leaf?: string }
const run = (holdMs: number, o: Opt = {}) => spawn(process.execPath, [...process.execArgv, HARNESS, LOG, String(holdMs), o.leaf ?? '-'], {
  env: o.env ?? baseEnv(),
  stdio: o.fd9 === undefined ? 'ignore' : ['ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', o.fd9],
})
const exitOf = (c: ReturnType<typeof spawn>): Promise<number | null> => new Promise((r) => {
  if (c.exitCode !== null) r(c.exitCode); else c.on('exit', (code) => r(code))
})
const waitFor = async (pred: () => boolean, ms = 30_000): Promise<boolean> => {
  const until = Date.now() + ms
  while (Date.now() < until) { if (pred()) return true; await new Promise((r) => setTimeout(r, 50)) }
  return pred()
}
const killOwn = (pid: number | undefined): boolean => {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 1) return false
  try { process.kill(pid, 'SIGKILL'); return true } catch { return false }
}
const reset = (): void => { writeFileSync(LOG, ''); rmSync(join(LOCKD, FOLLOW_UP_FILE), { force: true }) }
const tokenNow = (): RunToken | null => { try { return parseRunToken(readFileSync(join(LOCKD, SUPPLY_RUN_TOKEN_FILE), 'utf-8')) } catch { return null } }

try {
  // ── ④ fail-closed — Linux 에서도 돈다 ──
  {
    const noLockf = await exitOf(run(0, { env: { ...baseEnv(), HARNESS_FAKE_LOCKF: join(ROOT, 'no-such-lockf') } }))
    check('🔴 🔴 반례 lockf 없음(대역 경로 없음) → exit 1 · 본체 0(DB · provider 0)', noLockf === 1 && starts().length === 0, String(noLockf))
    if (!REAL) {
      const linux = await exitOf(run(0))
      check('🔴 🔴 반례 이 기계에 /usr/bin/lockf 가 없다 → live 회차 exit 1 · 본체 0(macOS 전용 검사는 SKIP 이고 PASS 가 아니다)',
        linux === 1 && starts().length === 0, String(linux))
    }
    check('probe — lockf 를 실행할 수 없으면 unknown(free 로 읽지 않는다)', probeKernelLease(LOCKP, join(ROOT, 'no-such-lockf')) === 'unknown')
  }

  const REAL_CASES = [
    '최초 실행(디렉터리 없음) · 0700 · token 0600', 'holder 1 + contender 5 → 본체 1 · follow-up 1 · 상한', '시작 전 event 표식 → pass0 event · pass1 없음',
    '깨진 표식 → unknown 기록 · 올리지 않음', 'holder SIGKILL → 즉시 재획득', '부모 종료 뒤 자식 생존 → 자식 끝까지 진입 0',
    'fd 9 실제 자식 전달 · token 일치', 'fd 미전달 · npx 경유 → 증명 실패', '자식 token 위조 · corrupt', '바깥 위조(fd 없음 · 같은 파일 · 다른 파일)',
    '회차 자식 위조 → 본체 0', 'busy 재시도 — probe 순간 충돌 구제', 'probe free/busy · 파일 생성 0', 'token 원자 쓰기(새 inode · 0600)', '실제 러너 진입',
  ]
  if (!REAL) { for (const c of REAL_CASES) skip(c) } else {
    check('/usr/bin/lockf 가 있고 실행할 수 있다(이 기계 · macOS)', true)

    // ── probe 는 파일을 만들지 않는다 ──
    {
      const fresh = join(ROOT, 'fresh-home')
      const p = join(supplyLockDir(fresh), SUPPLY_LOCK_FILE)
      check('🔴 probe — 잠금 디렉터리가 없으면 free · 아무것도 만들지 않는다', probeKernelLease(p) === 'free' && !existsSync(supplyLockDir(fresh)))
    }
    rmSync(LOCKD, { recursive: true, force: true })

    // ── 최초 실행 + holder 1 + contender 5 + 실제 자식 fd 9 ──
    reset()
    // 🔴 contender 는 잠금을 못 얻으면 3초 쉬고 한 번 더 본다(SUPPLY_BUSY_RETRY_MS) — holder 는 그보다 오래 쥔다
    const holder = run(6_000, { leaf: 'real' })
    const holderExit = exitOf(holder)
    check('holder 가 본체에 들어갔다(최초 실행 — 잠금 디렉터리가 없던 자리)', await waitFor(() => starts().length >= 1))
    check('🔴 최초 실행 — 잠금 디렉터리 0700 · token 0600', (statSync(LOCKD).mode & 0o777) === 0o700
      && (statSync(join(LOCKD, SUPPLY_RUN_TOKEN_FILE)).mode & 0o777) === 0o600)
    check('🔴 probe — holder 가 있으면 busy', probeKernelLease(LOCKP) === 'busy')
    const t0 = tokenNow()
    const s0 = starts()[0]
    await waitFor(() => leaves().length >= 1)
    const leaf0 = leaves()[0]
    check('🔴 🔴 fd 9 실제 자식 전달 — 회차 자식이 stageSpawnOf 로 띄운 자식이 같은 lease 를 증명하고 token 이 일치한다(shadow ok)',
      leaf0?.shadow?.ok === true && leaf0.shadow.tokenId === t0?.tokenId && leaf0.ppid === s0?.pid, JSON.stringify(leaf0?.shadow))
    check('회차 자식 자신의 shadow 도 ok · token 의 trigger = manual(라벨 없음)', s0?.shadow?.ok === true && t0?.trigger === 'manual' && t0.pass === 0)
    const contenders = [run(0), run(0), run(0), run(0), run(0)]
    const cExits = await Promise.all(contenders.map(exitOf))
    check('🔴 🔴 반례 holder 1 + contender 5 → 다섯 다 본체에 들어가지 않고 0 으로 물러난다', cExits.every((c) => c === 0) && starts().length === 1, JSON.stringify(cExits))
    check('🔴 🔴 반례 진 깨움 다섯 → follow-up 표식 정확히 1개', readdirSync(LOCKD).filter((f) => f === FOLLOW_UP_FILE).length === 1)
    await waitFor(() => starts().some((l) => l.pass === 1))
    const late = await exitOf(run(0))
    const hc = await holderExit
    const ps = starts()
    const t1 = tokenNow()
    check('🔴 🔴 반례 follow-up 5회 → 추가 회차 최대 1 — pass 0 · 1 만, 회차마다 다른 자식 · 다른 token · 다른 회차 시각',
      hc === 0 && ps.length === 2 && ps.map((p) => p.pass).join(',') === '0,1' && ps[0]!.pid !== ps[1]!.pid
      && ps[0]!.token !== ps[1]!.token && ps[0]!.runAt !== ps[1]!.runAt && t1?.pass === 1 && t1.tokenId === ps[1]!.token,
      JSON.stringify(ps.map((p) => [p.pass, p.pid, p.runAt])))
    check('🔴 follow-up 회차의 token trigger = 거둔 표식(contender 의 manual) · 띄운 이유와 따로 남는다',
      t1?.trigger === 'manual' && t1.absorbedTrigger === 'manual' && t1.absorbedAt !== null)
    check('🔴 🔴 반례 상한 뒤 들어온 깨움 — 더 돌지 않고 표식은 남는다(다음 holder 가 받는다)', late === 0 && existsSync(join(LOCKD, FOLLOW_UP_FILE)))
    check('🔴 🔴 subprocess 실측 — 본체 동시 실행 최대 1', maxConcurrent() === 1, String(maxConcurrent()))
    const inoBefore = statSync(LOCKP).ino
    const pr = probeKernelLease(LOCKP)
    check('🔴 probe — holder 가 끝나면 free(남은 잠금 파일은 잠금이 아니다)', pr === 'free', pr)
    check('🔴 🔴 반례 probe 가 잠금 파일을 지우거나 바꾸지 않는다(-k) — 지우면 holder 의 inode 와 새 실행의 inode 가 갈라져 두 본체가 겹친다',
      existsSync(LOCKP) && statSync(LOCKP).ino === inoBefore)

    // ── 시작 전에 있던 event 표식 ──
    reset()
    writeFileSync(join(LOCKD, FOLLOW_UP_FILE), JSON.stringify({ at: new Date().toISOString(), trigger: 'event' }), { mode: 0o600 })
    const ev = await exitOf(run(200))
    const te = tokenNow()
    check('🔴 🔴 반례 시작 전 event 표식 → pass 0 trigger = event(거둔 표식) · 불필요한 pass 1 없음 · 표식 거둠',
      ev === 0 && starts().length === 1 && starts()[0]!.pass === 0 && te?.trigger === 'event' && te.launchTrigger === 'manual'
      && te.absorbedTrigger === 'event' && !existsSync(join(LOCKD, FOLLOW_UP_FILE)), JSON.stringify(te))

    // ── 깨진 표식 ──
    reset()
    writeFileSync(join(LOCKD, FOLLOW_UP_FILE), '{oops', { mode: 0o600 })
    const cr = await exitOf(run(200))
    const tc = tokenNow()
    check('🔴 🔴 반례 깨진 표식 → 추정하지 않고 unknown 으로 기록 · trigger 는 띄운 이유 그대로 · 표식은 거둔다',
      cr === 0 && starts().length === 1 && tc?.absorbedTrigger === 'unknown' && tc.trigger === 'manual' && !existsSync(join(LOCKD, FOLLOW_UP_FILE)))

    // ── holder SIGKILL → 즉시 재획득 ──
    reset()
    const victim = run(60_000)
    const victimExit = exitOf(victim)
    await waitFor(() => starts().length === 1)
    const vs = starts()[0]!
    check('회차 자식과 holder PID 를 테스트가 직접 받았다', killOwn(vs.pid) && killOwn(vs.ppid), `${vs.pid} ${vs.ppid}`)
    await victimExit
    rmSync(join(LOCKD, FOLLOW_UP_FILE), { force: true })
    const tk = Date.now()
    const re = await exitOf(run(0))
    check('🔴 🔴 반례 holder SIGKILL → 잠금 파일 삭제 없이 다음 실행이 즉시 획득', re === 0 && starts().length === 2 && existsSync(LOCKP) && Date.now() - tk < 15_000,
      `${re} ${Date.now() - tk}ms`)

    // ── 부모(holder) 종료 뒤 자식 생존 ──
    reset()
    const keep = run(10_000)
    const keepExit = exitOf(keep)
    await waitFor(() => starts().length === 1)
    const ks = starts()[0]!
    check('holder(회차 자식의 부모) PID 를 받았다', killOwn(ks.ppid))
    await keepExit
    const during = await exitOf(run(0))
    rmSync(join(LOCKD, FOLLOW_UP_FILE), { force: true })
    check('🔴 🔴 반례 부모 종료 후 자식이 살아 있으면 — 새 holder 진입 0(fd 9 를 쥔 자식이 잠금을 유지)', during === 0 && starts().length === 1)
    await waitFor(() => lines().some((l) => l.kind === 'end'), 25_000)
    const after = await exitOf(run(0))
    check('🔴 그 자식이 끝나면 다음 실행이 바로 들어간다', after === 0 && starts().length === 2 && maxConcurrent() === 1)

    // ── fd 9 미전달 · npx 경유 ──
    reset()
    await exitOf(run(0, { leaf: 'no-fd' }))
    await exitOf(run(0, { leaf: 'npx' }))
    const noFd = leaves().find((l) => l.tag === 'no-fd')
    const viaNpx = leaves().find((l) => l.tag === 'npx')
    check('🔴 🔴 반례 fd 9 를 넘기지 않은 자식 — 표식 env 는 물려받아도 lease 증명 실패(LEASE_NOT_PROVEN)', noFd?.shadow?.ok === false && noFd.shadow.code === 'LEASE_NOT_PROVEN',
      JSON.stringify(noFd?.shadow))
    // 🔴 관측만 한다(PASS 로 세지 않는다) — `npx → tsx cli → node` 경유 전달은 env 에 따라 갈렸다(2026-10-12 실측:
    //    전체 셸 env 에서는 fd 9 가 다른 객체로 바뀌었고, 이 하네스의 최소 env 에서는 남았다). 보장되지 않는 길이라 러너는 쓰지 않는다
    console.log(`  ⓘ 관측(PASS 아님) 앞판 방식 \`npx tsx\` 자식의 lease 증명 — ${viaNpx?.shadow?.ok === true ? 'ok(이 env 에서는 남았다)' : viaNpx?.shadow?.code ?? '기록 없음'} · 러너는 이 길을 쓰지 않는다`)

    // ── 자식 token 위조 · corrupt ──
    reset()
    await exitOf(run(0, { leaf: 'wrong-token' }))
    await exitOf(run(0, { leaf: 'corrupt-token' }))
    const wt = leaves().find((l) => l.tag === 'wrong-token')
    const ct = leaves().find((l) => l.tag === 'corrupt-token')
    check('🔴 🔴 반례 lease 안의 자식이 token id 를 위조 → TOKEN_ID_MISMATCH', wt?.shadow?.code === 'TOKEN_ID_MISMATCH', JSON.stringify(wt?.shadow))
    check('🔴 🔴 반례 token 파일이 깨짐 → TOKEN_CORRUPT', ct?.shadow?.code === 'TOKEN_CORRUPT', JSON.stringify(ct?.shadow))

    // ── 바깥에서 lease · token 위조 (holder 실행 중) ──
    reset()
    const h2 = run(6_000)
    const h2Exit = exitOf(h2)
    await waitFor(() => starts().length === 1)
    const realToken = tokenNow()?.tokenId ?? ''
    const forgedEnv = { ...baseEnv(), [LEASE_INNER_ENV]: LOCKP, [LEASE_FD_ENV]: '9', [SUPPLY_RUN_TOKEN_ENV]: realToken }
    const leafRun = (fd9?: number): string => {
      const stdio = fd9 === undefined ? (['ignore', 'pipe', 'pipe'] as const) : ['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', fd9]
      spawnSync(process.execPath, [...process.execArgv, LEAF, LOG, `forged-${fd9 ?? 'none'}`], { env: forgedEnv, stdio: stdio as never })
      const l = leaves().filter((x) => x.tag === `forged-${fd9 ?? 'none'}`).pop()
      return l?.shadow?.ok === false ? l.shadow.code ?? '' : 'OK'
    }
    const noneCode = leafRun()
    const sameFd = openSync(LOCKP, 'a')
    const sameCode = leafRun(sameFd)
    closeSync(sameFd)
    const other = join(ROOT, 'other.file'); writeFileSync(other, '')
    const otherFd = openSync(other, 'a')
    const otherCode = leafRun(otherFd)
    check('🔴 🔴 반례 env 만 위조(fd 9 없음) · 진짜 token id 를 알아도 → LEASE_NOT_PROVEN', noneCode === 'LEASE_NOT_PROVEN', noneCode)
    check('🔴 🔴 반례 holder 실행 중 같은 잠금 파일을 새로 열어 fd 9 로 → LEASE_NOT_PROVEN(내 잠금이 아니다)', sameCode === 'LEASE_NOT_PROVEN', sameCode)
    check('🔴 🔴 반례 fd 9 가 다른 파일 → LEASE_NOT_PROVEN', otherCode === 'LEASE_NOT_PROVEN', otherCode)
    // 회차 자식 위조 — 본체 0
    const forgedPass = await exitOf(run(0, { env: { ...forgedEnv, [SUPPLY_PASS_ENV]: '0' }, fd9: otherFd }))
    const forgedPassNoFd = await exitOf(run(0, { env: { ...forgedEnv, [SUPPLY_PASS_ENV]: '0' } }))
    closeSync(otherFd)
    check('🔴 🔴 반례 회차 자식 표식 + lease 표식 위조(fd 없음 · 다른 파일) → exit 1 · 본체 0(DB · provider 0)',
      forgedPass === 1 && forgedPassNoFd === 1 && starts().length === 1, `${forgedPass} ${forgedPassNoFd}`)
    await h2Exit

    // ── busy 재시도 — 관제 probe 가 빈 잠금을 잠깐 잡은 순간 뜬 회차 ──
    reset()
    const brief = spawn(LOCKF_PATH, ['-k', '-s', '-t', '0', LOCKP, '/bin/sleep', '1'], { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 200))
    const tb = Date.now()
    const rescued = await exitOf(run(0))
    await exitOf(brief)
    check('🔴 🔴 반례 probe 가 잡은 1초 사이에 뜬 회차 → 한 번 더 보고 본체에 들어간다(표식만 남기고 사라지지 않는다)',
      rescued === 0 && starts().length === 1 && !existsSync(join(LOCKD, FOLLOW_UP_FILE)) && Date.now() - tb >= 2_500, `${Date.now() - tb}ms`)
    const busyHolder = run(8_000)
    const busyExit = exitOf(busyHolder)
    await waitFor(() => starts().length === 2)
    const tw = Date.now()
    const held = await exitOf(run(0))
    check('살아 있는 holder 앞에서는 재시도 뒤에도 물러난다(본체 0 · 표식 1)', held === 0 && starts().length === 2 && existsSync(join(LOCKD, FOLLOW_UP_FILE))
      && Date.now() - tw >= 2_500)
    rmSync(join(LOCKD, FOLLOW_UP_FILE), { force: true })
    killOwn(starts()[1]!.pid); killOwn(starts()[1]!.ppid)
    await busyExit

    // ── token 원자 쓰기 ──
    {
      const d = join(ROOT, 'atomic'); mkdirSync(d)
      const p = join(d, SUPPLY_RUN_TOKEN_FILE)
      writeFileSync(p, 'old', { mode: 0o644 })
      const ino0 = statSync(p).ino
      const at = new Date()
      writeRunTokenAtomic(d, buildRunToken({ tokenId: 'a', trigger: 'manual', launchTrigger: 'manual', absorbedTrigger: null, absorbedAt: null,
        issuedAt: at, lock: { dev: 1, ino: 2 }, runId: supplyRunIdOf(at), pass: 0 }))
      const st = statSync(p)
      check('🔴 🔴 token 원자 쓰기 — 임시 파일 + rename(새 inode) · 0600 · 임시 파일이 남지 않는다',
        st.ino !== ino0 && (st.mode & 0o777) === 0o600 && parseRunToken(readFileSync(p, 'utf-8'))?.tokenId === 'a'
        && readdirSync(d).length === 1, `${ino0}→${st.ino} ${(st.mode & 0o777).toString(8)}`)
    }

    // ── 실제 러너 진입 — 임시 HOME · 임시 cwd · 닿지 않는 DB ──
    {
      const cwd = join(ROOT, 'cwd'); mkdirSync(cwd)
      const home = join(ROOT, 'runner-home'); mkdirSync(home)
      const env = {
        PATH: process.env.PATH ?? '', HOME: home,
        DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none', DIRECT_URL: 'postgresql://nobody@127.0.0.1:1/none',
      }
      const tsx = join(REPO, 'node_modules', '.bin', 'tsx')
      const dry = spawnSync(tsx, [join(REPO, 'scripts/supply-process.mts'), '--live'], { cwd, env, encoding: 'utf-8', timeout: 180_000 })
      check('🔴 실제 러너 — 스위치 닫힘(관측 실행)은 lease 를 지나지 않고 잠금 디렉터리도 만들지 않는다',
        dry.status === 0 && !existsSync(supplyLockDir(home)) && /관측만 한다/.test(dry.stdout ?? ''), `${dry.status}`)
      const live = spawnSync(tsx, [join(REPO, 'scripts/supply-process.mts'), '--live'], {
        cwd, env: { ...env, SORAN_SUPPLY_PROCESS_ENABLED: 'true' }, encoding: 'utf-8', timeout: 180_000,
      })
      const out = `${live.stdout ?? ''}${live.stderr ?? ''}`
      const tok = (() => { try { return parseRunToken(readFileSync(join(supplyLockDir(home), SUPPLY_RUN_TOKEN_FILE), 'utf-8')) } catch { return null } })()
      check('🔴 🔴 실제 러너 — live 는 커널 lease 를 증명한 회차 자식에서만 본체에 들어가고 token(shadow)을 남긴다',
        live.status === 0 && /커널 lease 안 \(fd 9\)/.test(out) && /실행 token\(shadow\) manual/.test(out) && tok !== null && tok.pass === 0,
        `${live.status} ${out.slice(-300)}`)
      check('실제 러너 — 옛 wx 잠금 파일(.microseed-data/supply-process.lock)을 만들지 않는다', !existsSync(join(cwd, '.microseed-data', 'supply-process.lock')))
    }
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} 공급 lease 검사 ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · provider 0 · 운영 HOME 0\n')
process.exit(fail === 0 ? 0 : 1)
