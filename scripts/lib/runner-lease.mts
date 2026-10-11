/**
 * 🔴 **러너 공통 lease — 커널 잠금(`/usr/bin/lockf`) · 죽으면 저절로 풀린다** (2026-10-11 Batch A4 보정)
 *
 * 🔴 **왜 바꿨나.** 앞판은 `wx` 파일 잠금이었다. 강제 종료 · 전원 장애 · 재부팅 뒤 파일이 남으면
 *    자동 회수가 없으므로 러너가 **영구 정지**했다(마스터 재검토 P0).
 *    BSD `lockf(1)` 은 커널 잠금이다 — 명령이 끝나거나 죽으면(SIGKILL 포함) 커널이 푼다.
 *    `-k` 로 파일은 남지만 **파일이 있다는 것은 잠금이 아니다** — 커널 잠금이 없으면 다음 실행이 바로 얻는다.
 *
 * 🔴 **구조 — 진입점 하나 · 두 겹.**
 *    ① 바깥: `lockf -k -t 0 <잠금 파일> <node> <같은 스크립트> …` 를 **인자 배열로** 띄운다(셸 문자열 0).
 *       75(EX_TEMPFAIL) = 다른 holder 가 있다 → 본체에 들어가지 않고 follow-up 표식 하나로 합친다.
 *    ② 안쪽: lockf 가 띄운 같은 스크립트. 본체를 돌기 **전에** 커널 잠금이 진짜 잡혀 있는지 증명한다
 *       (`verifyInKernelLease`). 증명이 없으면 provider 0 · DB 0 으로 멈춘다 — 안쪽 표식 env 를 손으로 넣어도 우회되지 않는다.
 *
 * 🔴 **증명 = 세 가지 전부.**
 *    · 안쪽 표식 env 가 이 잠금 파일을 가리킨다
 *    · 부모 프로세스가 `lockf -k -t 0 <이 잠금 파일>` 이다(lockf 가 죽으면 부모가 바뀐다 — 그 순간 증명이 깨진다)
 *    · 같은 파일을 `lockf -k -t 0` 로 다시 잡으려 하면 75 다(커널 잠금이 실제로 있다)
 *    🔴 lockf 는 잠금 fd 를 자식에게 물려주지 않는다(실측) — lockf 만 죽고 본체가 살면 잠금이 풀린다.
 *       그래서 본체는 회차 시작과 **유료 호출 직전마다** 증명을 다시 본다. 깨지면 그 자리에서 멈춘다.
 *
 * 🔴 **하지 않는 것** — 시각 · PID · rename 으로 살아 있는 holder 를 뺏지 않는다. 잠금 파일을 지우지 않는다.
 *    lockf 가 없거나 실행할 수 없으면 본체를 띄우지 않는다(fail-closed).
 */
import { accessSync, constants, existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export const LOCKF_PATH = '/usr/bin/lockf'
/** 🔴 lockf `-t 0` 이 잠금을 못 얻었을 때의 종료 코드(sysexits EX_TEMPFAIL) — 본체는 이 값을 쓰지 않는다 */
export const LEASE_BUSY_EXIT = 75
/** 🔴 안쪽 표식 — 값은 잠금 파일 경로. 이것만으로는 증명이 아니다(`verifyInKernelLease`) */
export const LEASE_INNER_ENV = 'SORAN_RUNNER_LEASE_INNER'
/** 🔴 겹친 깨움을 합친 뒤 더 도는 회차 수의 상한 — 하나다 */
export const MAX_FOLLOW_UPS = 1
export const FOLLOW_UP_FILE = 'follow-up.request'

export type LeaseTrigger = 'scheduled' | 'event' | 'recovery' | 'manual'

/** 🔴 lockf 를 실행할 수 있는가 — 없거나 실행 권한이 없으면 false */
export function lockfUsable(lockf: string = LOCKF_PATH): boolean {
  try { accessSync(lockf, constants.X_OK); return existsSync(lockf) } catch { return false }
}

const lockfArgs = (lockPath: string): string[] => ['-k', '-t', '0', lockPath]

export type OuterOutcome =
  | { kind: 'RAN'; code: number }
  | { kind: 'HELD'; followUp: FollowUpRequest }
  | { kind: 'UNAVAILABLE'; reason: string }

/**
 * 🔴 **바깥 — lockf 아래에서 같은 진입점을 다시 띄운다.** 본체는 여기서 돌지 않는다.
 *    stdio 는 그대로 물려준다(로그 한 줄도 잃지 않는다).
 */
export function runUnderKernelLease(i: {
  lockPath: string; followUpDir: string; command: string; args: readonly string[]
  env: NodeJS.ProcessEnv; nowMs: number; trigger: LeaseTrigger; lockf?: string
}): OuterOutcome {
  const lockf = i.lockf ?? LOCKF_PATH
  if (!lockfUsable(lockf)) return { kind: 'UNAVAILABLE', reason: `${lockf} 를 실행할 수 없다 — 본체를 띄우지 않는다(provider 0 · DB 0)` }
  const r = spawnSync(lockf, [...lockfArgs(i.lockPath), i.command, ...i.args], {
    stdio: 'inherit', env: { ...i.env, [LEASE_INNER_ENV]: i.lockPath },
  })
  if (r.error !== undefined) return { kind: 'UNAVAILABLE', reason: `lockf 실행 실패 — ${(r.error as { code?: string }).code ?? r.error.name}` }
  if (r.status === LEASE_BUSY_EXIT) return { kind: 'HELD', followUp: requestFollowUp(i.followUpDir, i.nowMs, i.trigger) }
  if (r.status === null) return { kind: 'RAN', code: 1 }
  return { kind: 'RAN', code: r.status }
}

/** 🔴 커널 잠금 안에 있다는 증명 — 이 값을 가진 쪽만 follow-up 표식을 거둔다 */
export type LeaseProof = { readonly lockPath: string; readonly followUpDir: string; readonly lockf: string }

/** 🔴 부모 프로세스의 명령줄 — 읽기만 한다(`ps`). 못 읽으면 null */
function parentCommand(): string | null {
  const r = spawnSync('/bin/ps', ['-o', 'command=', '-p', String(process.ppid)], { encoding: 'utf-8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/**
 * 🔴 **안쪽 — 커널 잠금이 진짜 잡혀 있는가.** 셋 중 하나라도 아니면 증명 없음.
 *    부르는 쪽은 증명이 없으면 provider · DB 를 건드리지 않고 멈춘다.
 */
export function verifyInKernelLease(i: {
  lockPath: string; followUpDir: string; env: NodeJS.ProcessEnv; lockf?: string
}): { ok: true; proof: LeaseProof } | { ok: false; reason: string } {
  const lockf = i.lockf ?? LOCKF_PATH
  if (i.env[LEASE_INNER_ENV] !== i.lockPath) return { ok: false, reason: '안쪽 표식이 이 잠금 파일을 가리키지 않는다' }
  const parent = parentCommand()
  if (parent === null || !parent.startsWith(`${lockf} ${lockfArgs(i.lockPath).join(' ')} `)) {
    return { ok: false, reason: '부모가 이 잠금 파일의 lockf 가 아니다 — 잠금 밖에서 떴거나 lockf 가 죽었다' }
  }
  if (!lockfUsable(lockf)) return { ok: false, reason: `${lockf} 를 실행할 수 없다` }
  const probe = spawnSync(lockf, [...lockfArgs(i.lockPath), '/usr/bin/true'], { stdio: 'ignore' })
  if (probe.status !== LEASE_BUSY_EXIT) {
    return { ok: false, reason: `커널 잠금이 잡혀 있지 않다(probe ${probe.status ?? 'signal'}) — 잠금 밖이다` }
  }
  return { ok: true, proof: { lockPath: i.lockPath, followUpDir: i.followUpDir, lockf } }
}

/** 🔴 증명을 다시 본다 — 회차 시작 · 유료 호출 직전. lockf 가 죽었으면 여기서 깨진다 */
export function stillInKernelLease(p: LeaseProof, env: NodeJS.ProcessEnv): boolean {
  return verifyInKernelLease({ lockPath: p.lockPath, followUpDir: p.followUpDir, env, lockf: p.lockf }).ok
}

export type FollowUpRequest = 'REQUESTED' | 'COALESCED' | 'ERROR'

/**
 * 🔴 **잠금을 못 얻은 실행이 남기는 깨움** — `wx` 하나. 이미 있으면 합쳐진 것이다.
 *    🔴 이것은 잠금이 아니다 — 이 파일이 남아도 아무것도 막지 않는다(다음 holder 가 거둔다).
 */
export function requestFollowUp(dir: string, nowMs: number, trigger: LeaseTrigger): FollowUpRequest {
  try {
    writeFileSync(join(dir, FOLLOW_UP_FILE), JSON.stringify({ at: new Date(nowMs).toISOString(), trigger }), { flag: 'wx', mode: 0o600 })
    return 'REQUESTED'
  } catch (e) {
    return (e as { code?: string }).code === 'EEXIST' ? 'COALESCED' : 'ERROR'
  }
}

export type FollowUpTake = 'TAKEN' | 'NONE' | 'ERROR'

/**
 * 🔴 **표식 거두기 — 커널 잠금 증명을 가진 holder 만**(타입이 `LeaseProof` 를 요구한다).
 *    지운 뒤 생긴 깨움은 다음 holder 가 시작할 때 거둔다 — 깨움은 사라지지 않고 늘지도 않는다.
 */
export function takeFollowUp(proof: LeaseProof): FollowUpTake {
  try { unlinkSync(join(proof.followUpDir, FOLLOW_UP_FILE)); return 'TAKEN' } catch (e) {
    return (e as { code?: string }).code === 'ENOENT' ? 'NONE' : 'ERROR'
  }
}

/** 🔴 회차 순서 — 첫 회차 + follow-up 최대 `MAX_FOLLOW_UPS`. `pass` 는 방금 끝낸 회차 번호(0 부터) */
export function shouldRunFollowUp(pass: number, take: FollowUpTake): boolean {
  return pass < MAX_FOLLOW_UPS && take === 'TAKEN'
}

/**
 * 🔴 **공통 진입 — 바깥이면 lockf 아래로 다시 띄우고, 안쪽이면 증명 뒤 회차를 돈다.**
 *    정기 · 복구 · (다음) 사건 · 수동이 전부 이 함수 하나를 지난다. 회차 본체(`pass`)는 증명 뒤에만 불린다.
 *    🔴 본체 종료 코드는 0 · 1 · 2 만 쓴다 — 75 는 바깥이 "잠금 있음" 으로 읽는 값이라 1 로 바꾼다.
 */
export async function leaseEntry(o: {
  lockDir: string; lockFile: string; scriptPath: string; argv: readonly string[]
  env: NodeJS.ProcessEnv; trigger: LeaseTrigger; lockf?: string
  pass: (pass: number, proof: LeaseProof) => Promise<number>
  log: (line: string) => void
}): Promise<number> {
  const lockPath = join(o.lockDir, o.lockFile)
  if (o.env[LEASE_INNER_ENV] === undefined) {
    const out = runUnderKernelLease({
      lockPath, followUpDir: o.lockDir, command: process.execPath,
      // 🔴 같은 진입점 · 같은 loader(tsx) — 인자 배열로만 넘긴다
      args: [...process.execArgv.filter((a, k, all) => a !== '--eval' && all[k - 1] !== '--eval'), o.scriptPath, ...o.argv],
      env: o.env, nowMs: Date.now(), trigger: o.trigger, ...(o.lockf === undefined ? {} : { lockf: o.lockf }),
    })
    if (out.kind === 'HELD') {
      o.log(`⏭️  LEASE_HELD — 다른 회차가 커널 잠금을 쥐고 있다 · follow-up ${out.followUp} · 본체에 들어가지 않는다`)
      return out.followUp === 'ERROR' ? 1 : 0
    }
    if (out.kind === 'UNAVAILABLE') { o.log(`🔴 LEASE_UNAVAILABLE — ${out.reason}`); return 1 }
    return out.code
  }
  const v = verifyInKernelLease({ lockPath, followUpDir: o.lockDir, env: o.env, ...(o.lockf === undefined ? {} : { lockf: o.lockf }) })
  if (!v.ok) { o.log(`🔴 LEASE_NOT_PROVEN — ${v.reason} · provider 0 · DB 0`); return 1 }
  // 🔴 시작할 때 이미 있던 깨움은 이번 회차가 받는다
  if (takeFollowUp(v.proof) === 'TAKEN') o.log('  follow-up 표식을 거뒀다 — 이번 회차가 그 깨움을 받는다')
  let worst = 0
  for (let pass = 0; ; pass += 1) {
    if (!stillInKernelLease(v.proof, o.env)) { o.log('🔴 커널 잠금 증명이 깨졌다 — 멈춘다'); return 1 }
    const raw = await o.pass(pass, v.proof)
    const code = raw === LEASE_BUSY_EXIT ? 1 : raw
    worst = Math.max(worst, code)
    if (code === 1) break
    // 🔴 상한에 닿았으면 표식을 거두지 않는다 — 남은 깨움은 다음 holder 가 시작할 때 받는다
    if (pass >= MAX_FOLLOW_UPS) break
    if (!shouldRunFollowUp(pass, takeFollowUp(v.proof))) break
    o.log(`\n  ── follow-up 회차 (${pass + 1}/${MAX_FOLLOW_UPS}) — 겹친 깨움을 합친 한 번 ──`)
  }
  return worst
}
