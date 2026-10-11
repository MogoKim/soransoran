/**
 * 🔴 **러너 공통 lease — 커널 잠금 fd 를 Node 본체가 직접 쥔다** (2026-10-11 Batch A4 · P0 재보정 2차)
 *
 * 🔴 **왜 다시 바꿨나 (마스터 재검토 P0).**
 *    1차 `wx` 파일 잠금은 강제 종료 · 전원 · 재부팅 뒤 파일이 남아 러너를 영구 정지시켰다.
 *    2차 `lockf <파일> <명령>` 은 잠금을 **lockf 부모**가 쥐었다 — lockf 만 죽으면 잠금이 풀리는데 Node 본체는
 *    그 회차를 계속 돌고, 새 러너가 즉시 잠금을 얻어 **두 본체가 겹칠 수 있었다**(실측 · 아래 검사 ⑧ 이 재현한다).
 *
 * 🔴 **지금 구조 — 잠금 수명 = Node 본체 수명.**
 *    고정 wrapper(`runner-lease.sh`)가 잠금 파일을 fd 9 로 열고 `lockf -s -t 0 9` 로 그 fd 에 커널 잠금을 건 뒤,
 *    인자 배열 그대로 Node 를 `exec` 한다. 같은 프로세스가 Node 가 되므로 fd 9 와 잠금이 그대로 넘어온다.
 *    별도의 lockf 부모가 없다. Node 가 끝나거나 죽으면(SIGKILL · 전원 · 재부팅) 커널이 푼다 — 사람이 파일을 지울 일이 없다.
 *    `-k` 와 같게 파일은 남지만 **파일이 있다는 것 자체는 잠금이 아니다.**
 *
 * 🔴 **증명(`verifyInKernelLease`) = 셋 전부.**
 *    · 표식 env 가 이 잠금 파일 · fd 9 를 가리킨다
 *    · `fstat(9)` 와 `stat(잠금 파일)` 의 dev · ino 가 같다(fd 가 다른 파일이면 거절 — 그 파일 잠금은 얻어지므로 이것만이 막는다)
 *    · 내 fd 9 로 `lockf -s -t 0 9` 를 다시 하면 0 이다 — 같은 열린 파일의 잠금은 다시 얻어도 내 것이고,
 *      다른 holder 가 있으면 75 다(같은 파일을 fd 9 로 열기만 한 위조를 막는다). 아무도 없으면 이 fd 가 잠금을 얻는다 —
 *      그때 이 실행은 정당한 단독 holder 다.
 *    🔴 "같은 파일을 새로 열어 잠그면 75" probe 는 뺐다 — 위 셋째가 그 경우를 전부 포함한다(변이 시험에서 살아남은 죽은 게이트).
 *
 * 🔴 **하지 않는 것** — 시각 · PID · 부모 명령줄 · rename 으로 판정하거나 뺏지 않는다. 잠금 파일을 지우지 않는다.
 *    lockf 가 없거나 실행할 수 없으면 본체를 띄우지 않는다(fail-closed · provider 0 · DB 0).
 */
import { accessSync, constants, existsSync, fstatSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LOCKF_PATH = '/usr/bin/lockf'
/** 🔴 저장소에 고정된 좁은 wrapper — 이 파일 하나만 띄운다(셸 문자열 조립 0) */
export const LEASE_WRAPPER = fileURLToPath(new URL('./runner-lease.sh', import.meta.url))
/** 🔴 lockf `-t 0` 이 잠금을 못 얻었을 때의 종료 코드(sysexits EX_TEMPFAIL) — 본체는 이 값을 쓰지 않는다 */
export const LEASE_BUSY_EXIT = 75
/** 🔴 wrapper 가 lockf 를 실행할 수 없을 때(69) · 잠금 파일을 못 열 때(73) · 인자 부족(64) */
export const LEASE_UNAVAILABLE_EXITS: readonly number[] = [64, 69, 73]
/** 🔴 안쪽 표식 — 잠금 파일 경로 · fd 번호. 이것만으로는 증명이 아니다(`verifyInKernelLease`) */
export const LEASE_INNER_ENV = 'SORAN_RUNNER_LEASE_INNER'
export const LEASE_FD_ENV = 'SORAN_RUNNER_LEASE_FD'
export const LEASE_FD = 9
/** 🔴 겹친 깨움을 합친 뒤 더 도는 회차 수의 상한 — 하나다 */
export const MAX_FOLLOW_UPS = 1
export const FOLLOW_UP_FILE = 'follow-up.request'

export type LeaseTrigger = 'scheduled' | 'event' | 'recovery' | 'manual'

/** 🔴 lockf 를 실행할 수 있는가 — 없거나 실행 권한이 없으면 false */
export function lockfUsable(lockf: string = LOCKF_PATH): boolean {
  try { accessSync(lockf, constants.X_OK); return existsSync(lockf) } catch { return false }
}

export type OuterOutcome =
  | { kind: 'RAN'; code: number }
  | { kind: 'HELD'; followUp: FollowUpRequest }
  | { kind: 'UNAVAILABLE'; reason: string }

/**
 * 🔴 **바깥 — wrapper 로 같은 진입점을 다시 띄운다.** 바깥은 본체를 돌지 않는다(DB · provider 0).
 *    wrapper 는 잠금을 건 뒤 Node 로 `exec` 한다 — 잠금은 그 Node 가 쥔다. stdio 는 그대로 물려준다.
 */
export function runUnderKernelLease(i: {
  lockPath: string; followUpDir: string; command: string; args: readonly string[]
  env: NodeJS.ProcessEnv; nowMs: number; trigger: LeaseTrigger; lockf?: string
}): OuterOutcome {
  const lockf = i.lockf ?? LOCKF_PATH
  if (!lockfUsable(lockf)) return { kind: 'UNAVAILABLE', reason: `${lockf} 를 실행할 수 없다 — 본체를 띄우지 않는다(provider 0 · DB 0)` }
  const env = { ...i.env }
  delete env[LEASE_INNER_ENV]
  delete env[LEASE_FD_ENV]
  const r = spawnSync('/bin/sh', [LEASE_WRAPPER, i.lockPath, lockf, i.command, ...i.args], { stdio: 'inherit', env })
  if (r.error !== undefined) return { kind: 'UNAVAILABLE', reason: `wrapper 실행 실패 — ${(r.error as { code?: string }).code ?? r.error.name}` }
  if (r.status === LEASE_BUSY_EXIT) return { kind: 'HELD', followUp: requestFollowUp(i.followUpDir, i.nowMs, i.trigger) }
  if (r.status !== null && LEASE_UNAVAILABLE_EXITS.includes(r.status)) return { kind: 'UNAVAILABLE', reason: `wrapper exit ${r.status} — 잠금을 걸지 못했다` }
  if (r.status === null) return { kind: 'RAN', code: 1 }
  return { kind: 'RAN', code: r.status }
}

/** 🔴 커널 잠금 fd 를 쥐고 있다는 증명 — 이 값을 가진 쪽만 follow-up 표식을 거둔다 */
export type LeaseProof = { readonly lockPath: string; readonly followUpDir: string; readonly lockf: string; readonly fd: number }

/**
 * 🔴 **안쪽 — 커널 잠금 fd 를 내가 쥐고 있는가.** 셋 중 하나라도 아니면 증명 없음.
 *    부르는 쪽은 증명이 없으면 provider · DB 를 건드리지 않고 멈춘다.
 */
export function verifyInKernelLease(i: {
  lockPath: string; followUpDir: string; env: NodeJS.ProcessEnv; lockf?: string
}): { ok: true; proof: LeaseProof } | { ok: false; reason: string } {
  const lockf = i.lockf ?? LOCKF_PATH
  if (i.env[LEASE_INNER_ENV] !== i.lockPath || i.env[LEASE_FD_ENV] !== String(LEASE_FD)) {
    return { ok: false, reason: '안쪽 표식이 이 잠금 파일 · fd 를 가리키지 않는다' }
  }
  let same = false
  try {
    const a = fstatSync(LEASE_FD)
    const b = statSync(i.lockPath)
    same = a.dev === b.dev && a.ino === b.ino
  } catch { return { ok: false, reason: `fd ${LEASE_FD} 가 열려 있지 않거나 잠금 파일을 읽지 못했다` } }
  if (!same) return { ok: false, reason: `fd ${LEASE_FD} 가 다른 파일을 가리킨다` }
  if (!lockfUsable(lockf)) return { ok: false, reason: `${lockf} 를 실행할 수 없다` }
  // ③ 내 fd 로 다시 잠그면 얻어져야 한다 — 잠금을 쥔 것이 나다(다른 holder 면 75)
  const stdio: ('ignore' | number)[] = Array.from({ length: LEASE_FD }, () => 'ignore' as const)
  stdio.push(LEASE_FD)
  const mine = spawnSync(lockf, ['-s', '-t', '0', String(LEASE_FD)], { stdio })
  if (mine.status !== 0) return { ok: false, reason: `내 fd 의 잠금이 아니다(fd probe ${mine.status ?? 'signal'}) — 다른 holder 가 쥐고 있다` }
  return { ok: true, proof: { lockPath: i.lockPath, followUpDir: i.followUpDir, lockf, fd: LEASE_FD } }
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
 * 🔴 **공통 진입 — 바깥이면 wrapper(fd 9 잠금 → exec)로 다시 띄우고, 안쪽이면 증명 뒤 회차를 돈다.**
 *    정기 · 복구 · (다음) 사건 · 수동이 전부 이 함수 하나를 지난다. 바깥은 wrapper 로 다시 띄우기만 한다. 회차 본체(`pass`)는 증명 뒤에만 불린다.
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
      // 🔴 같은 진입점 · 같은 loader(tsx) — 인자 배열로만 넘긴다(wrapper 가 그대로 exec 한다)
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
  // 🔴 잠금 수명 = 이 프로세스 수명 — 증명은 한 번이면 된다(회차마다 다시 볼 실패 경로가 없다 · 죽은 게이트를 두지 않는다)
  // 🔴 시작할 때 이미 있던 깨움은 이번 회차가 받는다
  if (takeFollowUp(v.proof) === 'TAKEN') o.log('  follow-up 표식을 거뒀다 — 이번 회차가 그 깨움을 받는다')
  let worst = 0
  for (let pass = 0; ; pass += 1) {
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
