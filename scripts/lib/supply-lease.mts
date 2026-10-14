/**
 * 🔴 **공급 러너 진입 — 커널 lease 안에서만 본체를 돈다** (2026-10-12 Batch C1)
 *
 *   launchd · 사람 · (다음) 복구 kickstart
 *     → supply-process.mts (바깥)  — DB · provider 0. 잠금 디렉터리만 만든다
 *     → runner-lease.sh            — 잠금 파일을 fd 9 로 열고 `lockf -s -t 0 9` → Node 로 exec
 *     → supply-process.mts (holder) — 커널 잠금 fd 를 쥔다. 회차(pass)마다 실행 token 을 발급하고
 *     → supply-process.mts (회차 자식) — fd 9 를 물려받아 lease 를 **다시 증명**한 뒤에만 본체(DB · 자식 단계)에 들어간다
 *     → 판정 · 초안 · 적재 자식      — 같은 fd 9 를 물려받는다(장부가 shadow 로 증명을 적는다)
 *
 * 🔴 **회차마다 자식 프로세스를 따로 띄우는 이유** — 회차 시각(`RUN_AT`)은 모듈이 뜰 때 한 번 정해지는 값이다
 *    (자정 · 생일 경계 계약 · `content-core-v2-check`). follow-up 회차를 같은 프로세스에서 돌면 앞 회차의 시각과
 *    회차 id 를 그대로 다시 쓴다. 그래서 holder 는 회차 시각을 정해 `SORAN_RUN_AT` 으로 넘기고 자식 하나를 띄운다.
 *
 * 🔴 **fd 9 는 명시적으로 넘긴다** — Node `spawn` 은 stdio 배열에 없는 fd 를 자식에게 주지 않고,
 *    `npx → tsx cli → node` 를 거치면 명시해도 사라진다(2026-10-12 macOS 실측). 그래서 자식은
 *    `process.execPath + 같은 loader 인자` 로 직접 띄우고 stdio 9 번 칸에 fd 9 를 싣는다(`stageSpawnOf`).
 *
 * 🔴 **실행 token 은 shadow 다.** 예산 허가에 쓰지 않는다 — 지금 예산 판정은 `supply-scheduled-reserve` 그대로다.
 */
import { randomUUID } from 'node:crypto'
import { spawn, type StdioOptions } from 'node:child_process'
import { fstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  LEASE_FD, LEASE_FD_ENV, LEASE_INNER_ENV, LOCKF_PATH,
  leaseEntry, loaderArgs, probeKernelLease, verifyInKernelLease,
  type LeaseProbe, type LeaseProof, type LeaseTrigger, type PassContext,
} from './runner-lease.mjs'
import { RUN_AT_ENV, runClockFrom } from './run-clock.mjs'
import {
  buildRunToken, judgeRunTokenShadow, supplyRunIdOf,
  type LockIdentity, type RunToken, type RunTokenShadow,
} from '../../src/lib/supply-run-token'
import { supplyRunKindOf } from '../../src/lib/supply-scheduled-reserve'

/** 🔴 커널 잠금 파일 — 옛 `wx` 잠금(`.microseed-data/supply-process.lock`)과 자리도 이름도 다르다. 있다는 것 자체는 잠금이 아니다 */
export const SUPPLY_LOCK_FILE = 'process.kernel-lock'
/** 🔴 실행 token(shadow) — holder 가 회차마다 덮어쓴다(임시 파일 + rename · 0600) */
export const SUPPLY_RUN_TOKEN_FILE = 'run-token.json'
/** 🔴 회차 자식 표식 — 값은 회차 번호. 이 표식만으로는 아무것도 열리지 않는다(lease 를 다시 증명한다) */
export const SUPPLY_PASS_ENV = 'SORAN_SUPPLY_PASS'
/** 🔴 이 회차의 token id — 자식 단계가 shadow 판정에 쓴다 */
export const SUPPLY_RUN_TOKEN_ENV = 'SORAN_SUPPLY_RUN_TOKEN'
/**
 * 🔴 잠금을 못 얻었을 때 한 번 더 보기까지 — 관제 probe 가 빈 잠금을 아주 잠깐 잡은 순간 뜬 정기 회차를 살린다.
 *    살아 있는 holder 가 있으면 그대로 follow-up 표식만 남기고 물러난다.
 */
export const SUPPLY_BUSY_RETRY_MS = 3_000

/** 🔴 잠금 디렉터리 — 저장소 밖(Application Support). 잠금 파일 · follow-up 표식 · 실행 token 이 여기 있다 */
export function supplyLockDir(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'soransoran', 'supply-process')
}
export const supplyLockPath = (home?: string): string => join(supplyLockDir(home), SUPPLY_LOCK_FILE)

/**
 * 🔴 **시험 전용 lockf** — 가짜 provider 훅(`fake-provider-hook.mjs` · `NODE_OPTIONS=--import` 로만 들어간다)이
 *    `FAKE_RUNNER_LOCKF` 를 받아 전역 표식(`Symbol.for`)에 건 경로만 쓴다. 그 훅이 걸린 프로세스는 `fetch` 가 가짜라
 *    실제 유료 요청을 보낼 수 없다. 운영 경로는 env 를 보지 않고 언제나 `/usr/bin/lockf` 다.
 *    Linux CI 의 격리 DB e2e 가 `flock` 기반 대역(`fake-lockf.mts`)을 쓰는 자리다.
 */
export const FAKE_LOCKF_ENV = 'FAKE_RUNNER_LOCKF'
export const FAKE_LOCKF_MARK: unique symbol = Symbol.for('soransoran.test.fake-runner-lockf')
export function supplyLockfPath(): string {
  const v = (globalThis as unknown as Record<symbol, unknown>)[FAKE_LOCKF_MARK]
  return typeof v === 'string' && v !== '' ? v : LOCKF_PATH
}

/**
 * 🔴 **띄운 이유** — 지금 예산 판정과 **같은 함수**(`supplyRunKindOf`)로 정한다: 공급 job 라벨 + 슬롯 창 안이면 `scheduled`,
 *    그 밖은 전부 `manual`. 복구 · 사건 trigger 는 C1 에서 만들지 않는다(follow-up 표식으로만 들어온다).
 */
export function supplyLaunchTrigger(env: Readonly<Record<string, string | undefined>>, now: Date): LeaseTrigger {
  return supplyRunKindOf(env, now).kind === 'scheduled' ? 'scheduled' : 'manual'
}

/** 🔴 관측 전용 — 관제 · dry-run 이 쓴다. 파일을 만들지 않는다 */
export function probeSupplyLease(env: Readonly<Record<string, string | undefined>> = process.env, home?: string): LeaseProbe {
  void env
  return probeKernelLease(supplyLockPath(home), supplyLockfPath())
}

/** 🔴 fd 9 가 가리키는 파일의 identity — 못 읽으면 null */
export function lockIdentityOfFd(fd: number = LEASE_FD): LockIdentity | null {
  try { const s = fstatSync(fd); return { dev: s.dev, ino: s.ino } } catch { return null }
}

/**
 * 🔴 **token 쓰기 — 임시 파일(0600 · `wx`) → rename.** 읽는 쪽은 반쯤 쓴 token 을 보지 않는다.
 *    같은 pid 의 임시 파일이 남아 있으면 먼저 지운다(앞선 회차가 쓰다 죽은 것).
 */
export function writeRunTokenAtomic(dir: string, token: RunToken): void {
  const path = join(dir, SUPPLY_RUN_TOKEN_FILE)
  const tmp = `${path}.tmp-${process.pid}`
  try { unlinkSync(tmp) } catch { /* 없다 */ }
  writeFileSync(tmp, `${JSON.stringify(token, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  renameSync(tmp, path)
}

/**
 * 🔴 **자식 단계 띄우기 — 같은 Node · 같은 loader · fd 9 명시.** lease 증명이 없으면(관측 실행) fd 9 를 싣지 않는다.
 *    stdio 0 · 1 · 2 는 앞판(`ignore` · `pipe` · `pipe`)과 같다.
 */
export function stageSpawnOf(script: string, args: readonly string[], proof: LeaseProof | null): {
  command: string; args: string[]; stdio: StdioOptions
} {
  const base: ('ignore' | 'pipe' | number)[] = ['ignore', 'pipe', 'pipe']
  if (proof !== null) {
    while (base.length < proof.fd) base.push('ignore')
    base.push(proof.fd)
  }
  return { command: process.execPath, args: [...loaderArgs(), script, ...args], stdio: base }
}

/** 🔴 회차 자식 하나 — stdio 0 · 1 · 2 는 holder 것을 물려주고 9 번 칸에 커널 잠금 fd 를 싣는다 */
function runPassChild(i: {
  scriptPath: string; argv: readonly string[]; env: NodeJS.ProcessEnv; pass: number; tokenId: string | null; runAt: Date
}): Promise<number> {
  const stdio: ('inherit' | 'ignore' | number)[] = ['inherit', 'inherit', 'inherit']
  while (stdio.length < LEASE_FD) stdio.push('ignore')
  stdio.push(LEASE_FD)
  const env: NodeJS.ProcessEnv = { ...i.env, [SUPPLY_PASS_ENV]: String(i.pass), [RUN_AT_ENV]: i.runAt.toISOString() }
  if (i.tokenId === null) delete env[SUPPLY_RUN_TOKEN_ENV]
  else env[SUPPLY_RUN_TOKEN_ENV] = i.tokenId
  return new Promise((resolve) => {
    let done = false
    const finish = (code: number): void => { if (!done) { done = true; resolve(code) } }
    try {
      const c = spawn(process.execPath, [...loaderArgs(), i.scriptPath, ...i.argv], { stdio, env })
      c.on('error', () => finish(1))
      c.on('exit', (code) => finish(code ?? 1))
    } catch { finish(1) }
  })
}

/**
 * 🔴 **공급 진입 하나** — 바깥 · holder · 회차 자식이 모두 이 함수를 지난다.
 *    · 회차 자식(`SORAN_SUPPLY_PASS`): lease 를 다시 증명한다. 실패면 exit 1 — DB · provider 0.
 *    · 바깥: 잠금 디렉터리(0700)를 만들고 wrapper 로 다시 띄운다(`leaseEntry`).
 *    · holder: 회차마다 token 을 발급하고 회차 자식을 띄운다. follow-up 은 `leaseEntry` 상한(1) 그대로다.
 */
export async function supplyEntry(o: {
  scriptPath: string; argv: readonly string[]; env: NodeJS.ProcessEnv
  body: (proof: LeaseProof) => Promise<number>
  log: (line: string) => void
  now?: () => Date
}): Promise<number> {
  const now = o.now ?? ((): Date => new Date())
  const lockDir = supplyLockDir()
  const lockf = supplyLockfPath()
  if (o.env[SUPPLY_PASS_ENV] !== undefined) {
    const v = verifyInKernelLease({ lockPath: join(lockDir, SUPPLY_LOCK_FILE), followUpDir: lockDir, env: o.env, lockf })
    if (!v.ok) { o.log(`🔴 LEASE_NOT_PROVEN(회차 자식) — ${v.reason} · provider 0 · DB 0`); return 1 }
    return o.body(v.proof)
  }
  if (o.env[LEASE_INNER_ENV] === undefined) {
    try { mkdirSync(lockDir, { recursive: true, mode: 0o700 }) } catch (e) {
      o.log(`🔴 잠금 디렉터리를 만들지 못했다 — ${(e as { code?: string }).code ?? 'UNKNOWN'} · provider 0 · DB 0`)
      return 1
    }
  }
  return leaseEntry({
    lockDir, lockFile: SUPPLY_LOCK_FILE, scriptPath: o.scriptPath, argv: o.argv, env: o.env,
    trigger: supplyLaunchTrigger(o.env, now()), lockf, busyRetryMs: SUPPLY_BUSY_RETRY_MS, log: o.log,
    pass: async (pass: number, _proof: LeaseProof, ctx: PassContext): Promise<number> => {
      // 🔴 회차 시각 — 첫 회차는 부모가 준 값(없으면 지금), follow-up 은 지금. 모양이 틀린 값은 회차를 열지 않는다
      let runAt: Date
      try { runAt = pass === 0 ? runClockFrom(o.env).at : now() } catch (e) {
        o.log(`🔴 회차 시각을 읽지 못했다 — ${e instanceof Error ? e.message : 'unknown'} · 회차를 열지 않는다`)
        return 1
      }
      const tokenId = issueRunToken({ lockDir, ctx, pass, runAt, issuedAt: now(), log: o.log })
      return runPassChild({ scriptPath: o.scriptPath, argv: o.argv, env: o.env, pass, tokenId, runAt })
    },
  })
}

/** 🔴 token 발급 — shadow 라 실패해도 회차를 막지 않는다(실패는 그대로 적고 자식 shadow 가 `NO_TOKEN_ENV` 로 남긴다) */
function issueRunToken(i: {
  lockDir: string; ctx: PassContext; pass: number; runAt: Date; issuedAt: Date; log: (l: string) => void
}): string | null {
  const lock = lockIdentityOfFd()
  if (lock === null) { i.log('  🟡 실행 token(shadow) 발급 안 함 — fd 9 identity 를 읽지 못했다'); return null }
  const token = buildRunToken({
    tokenId: randomUUID(), trigger: i.ctx.trigger, launchTrigger: i.ctx.launch,
    absorbedTrigger: i.ctx.absorbed, absorbedAt: i.ctx.absorbedAt,
    issuedAt: i.issuedAt, lock, runId: supplyRunIdOf(i.runAt), pass: i.pass,
  })
  try {
    writeRunTokenAtomic(i.lockDir, token)
  } catch (e) {
    i.log(`  🟡 실행 token(shadow) 을 적지 못했다 — ${(e as { code?: string }).code ?? 'UNKNOWN'} · 예산 판정과 무관`)
    return null
  }
  i.log(`  실행 token(shadow) 회차 ${i.pass} · trigger ${token.trigger} (띄운 이유 ${token.launchTrigger}`
    + `${token.absorbedTrigger === null ? '' : ` · 거둔 표식 ${token.absorbedTrigger}`}) · 창 ${token.budgetWindowShadow}`
    + ` · 만료 ${token.expiresAt} — 🔴 예산 판정에 쓰지 않는다`)
  return token.tokenId
}

/**
 * 🔴 **자식 쪽 shadow 판정** — 지금 프로세스가 공급 lease 안인가 · token 이 진짜인가. 던지지 않는다.
 *    표식 env 가 없으면 lockf 를 부르지 않는다(손 실행은 비용 0 으로 `NO_LEASE`).
 */
export function runTokenShadowFromEnv(
  env: Readonly<Record<string, string | undefined>>, now: Date, home?: string,
): RunTokenShadow {
  try {
    const lockDir = supplyLockDir(home)
    const marked = env[LEASE_INNER_ENV] !== undefined || env[LEASE_FD_ENV] !== undefined
    let lease: Parameters<typeof judgeRunTokenShadow>[0]['lease'] = { kind: 'absent' }
    if (marked) {
      const v = verifyInKernelLease({
        lockPath: join(lockDir, SUPPLY_LOCK_FILE), followUpDir: lockDir, env: env as NodeJS.ProcessEnv, lockf: supplyLockfPath(),
      })
      const identity = v.ok ? lockIdentityOfFd() : null
      lease = identity === null ? { kind: 'unproven' } : { kind: 'proven', identity }
    }
    let file: Parameters<typeof judgeRunTokenShadow>[0]['file']
    try { file = { kind: 'raw', raw: readFileSync(join(lockDir, SUPPLY_RUN_TOKEN_FILE), 'utf-8') } } catch (e) {
      file = (e as { code?: string }).code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable' }
    }
    return judgeRunTokenShadow({ lease, envTokenId: env[SUPPLY_RUN_TOKEN_ENV] ?? null, file, now })
  } catch {
    return { ok: false, code: 'ERROR', tokenId: null }
  }
}
