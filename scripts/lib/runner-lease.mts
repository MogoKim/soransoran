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
import { accessSync, constants, existsSync, fstatSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
  /**
   * 🔴 잠금을 못 얻으면 이만큼 쉬고 **한 번만** 다시 본다(2026-10-12 Batch C1). 생략하면 0 — 바로 물러난다(앞판 그대로).
   *    관제 probe(`probeKernelLease`)는 빈 잠금을 아주 잠깐 잡았다 놓는다 — 그 순간 뜬 정기 회차가 follow-up 표식만
   *    남기고 사라지지 않게 하려는 것이다. 살아 있는 holder 를 기다리거나 뺏는 장치가 아니다.
   */
  busyRetryMs?: number
}): OuterOutcome {
  const lockf = i.lockf ?? LOCKF_PATH
  if (!lockfUsable(lockf)) return { kind: 'UNAVAILABLE', reason: `${lockf} 를 실행할 수 없다 — 본체를 띄우지 않는다(provider 0 · DB 0)` }
  const env = { ...i.env }
  delete env[LEASE_INNER_ENV]
  delete env[LEASE_FD_ENV]
  let r = spawnSync('/bin/sh', [LEASE_WRAPPER, i.lockPath, lockf, i.command, ...i.args], { stdio: 'inherit', env })
  if (r.error === undefined && r.status === LEASE_BUSY_EXIT && (i.busyRetryMs ?? 0) > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, i.busyRetryMs)
    r = spawnSync('/bin/sh', [LEASE_WRAPPER, i.lockPath, lockf, i.command, ...i.args], { stdio: 'inherit', env })
  }
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
 * 🔴 **회차를 연 깨움의 종류** — 네 trigger 또는 `unknown`(표식이 깨졌다 · 칸이 없다 · 모르는 값).
 *    `unknown` 은 추정하지 않은 값이다. 어떤 trigger 로도 올려 읽지 않는다(fail-closed).
 */
export type PassTrigger = LeaseTrigger | 'unknown'

const LEASE_TRIGGERS: readonly LeaseTrigger[] = ['scheduled', 'event', 'recovery', 'manual']

/** 🔴 표식 원문 → trigger. JSON 이 아니거나 칸이 네 값 중 하나가 아니면 `unknown` */
export function followUpTriggerOf(raw: string): { trigger: PassTrigger; at: string | null } {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return { trigger: 'unknown', at: null } }
  if (typeof v !== 'object' || v === null) return { trigger: 'unknown', at: null }
  const o = v as { trigger?: unknown; at?: unknown }
  const at = typeof o.at === 'string' && Number.isFinite(Date.parse(o.at)) ? o.at : null
  return { trigger: LEASE_TRIGGERS.includes(o.trigger as LeaseTrigger) ? o.trigger as LeaseTrigger : 'unknown', at }
}

export type FollowUpRecord = { take: FollowUpTake; trigger: PassTrigger | null; at: string | null }

/**
 * 🔴 **표식 거두기 — 지우기 전에 trigger 를 읽는다** (2026-10-12 Batch C1).
 *    표식은 `wx` 로만 생기고 지우는 쪽은 holder 하나라, 읽은 뒤 지우기 전까지 내용이 바뀌지 않는다.
 *    못 읽으면(깨진 내용) `unknown` 으로 남기고 거둔다 — 다음 holder 가 같은 깨진 표식을 또 받지 않게.
 *    읽기 자체가 실패(권한 등)하면 지우지 않고 `ERROR` 다 — 내용을 모르는 깨움을 없애지 않는다.
 */
export function takeFollowUpRecord(proof: LeaseProof): FollowUpRecord {
  const path = join(proof.followUpDir, FOLLOW_UP_FILE)
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch (e) {
    return { take: (e as { code?: string }).code === 'ENOENT' ? 'NONE' : 'ERROR', trigger: null, at: null }
  }
  const read = followUpTriggerOf(raw)
  try { unlinkSync(path) } catch (e) {
    return { take: (e as { code?: string }).code === 'ENOENT' ? 'NONE' : 'ERROR', trigger: null, at: null }
  }
  return { take: 'TAKEN', ...read }
}

/**
 * 🔴 **표식 거두기 — 커널 잠금 증명을 가진 holder 만**(타입이 `LeaseProof` 를 요구한다).
 *    지운 뒤 생긴 깨움은 다음 holder 가 시작할 때 거둔다 — 깨움은 사라지지 않고 늘지도 않는다.
 */
export function takeFollowUp(proof: LeaseProof): FollowUpTake {
  return takeFollowUpRecord(proof).take
}

/**
 * 🔴 **첫 회차의 trigger** — 띄운 이유와 시작할 때 거둔 표식 중 더 강한 것.
 *    순서 `scheduled > event > recovery > manual`. 거둔 표식이 `unknown` 이면 올리지 않는다(띄운 이유 그대로).
 */
export function mergePassTrigger(launch: LeaseTrigger, absorbed: PassTrigger | null): PassTrigger {
  if (absorbed === null || absorbed === 'unknown') return launch
  const rank = (t: LeaseTrigger): number => LEASE_TRIGGERS.length - LEASE_TRIGGERS.indexOf(t)
  return rank(absorbed) > rank(launch) ? absorbed : launch
}

/** 🔴 회차 하나를 연 깨움 — 본체가 기록에 남긴다(진단 · shadow). 잠금 · 장부 · 상한은 이 값으로 갈리지 않는다 */
export type PassContext = {
  trigger: PassTrigger
  /** 이 프로세스를 띄운 이유(바깥이 정한 값) */
  launch: LeaseTrigger
  /** 이 회차가 거둔 표식의 trigger — 없으면 null */
  absorbed: PassTrigger | null
  absorbedAt: string | null
}

export type LeaseProbe = 'free' | 'busy' | 'unknown'

/**
 * 🔴 **관측 전용 probe** (2026-10-12 Batch C1) — 파일이 있다는 것이 아니라 **커널 잠금**을 본다.
 *    · 잠금 파일이 없다 → `free`(만들지 않는다 · `-n`)
 *    · `lockf -k -s -n -t 0 <파일> /usr/bin/true` → 0 이면 `free`, 75 면 `busy`, 그 밖은 `unknown`
 *      🔴 `-k` 로 파일을 남긴다 — 지우면 holder 가 쥔 inode 와 새 실행이 잠글 inode 가 갈라진다
 *    · lockf 를 실행할 수 없다(Linux 등) → `unknown` — 모르는 것을 free 로 읽지 않는다
 *    🔴 빈 잠금이면 /usr/bin/true 가 도는 아주 짧은 동안 잠금을 쥔다 — 그 순간 뜬 회차는 `busyRetryMs` 로 한 번 더 본다.
 */
export function probeKernelLease(lockPath: string, lockf: string = LOCKF_PATH): LeaseProbe {
  if (!lockfUsable(lockf)) return 'unknown'
  if (!existsSync(lockPath)) return 'free'
  // 🔴 `-k` 필수 — 없으면 macOS lockf 는 명령이 끝난 뒤 잠금 파일을 **지운다**. 지우면 다음 실행이 새 inode 를 잠가
  //    옛 inode 를 쥔 holder 와 동시에 본체에 들어간다(2026-10-12 C1 검사가 잡았다). 관측이 잠금을 깨면 안 된다
  const r = spawnSync(lockf, ['-k', '-s', '-n', '-t', '0', lockPath, '/usr/bin/true'], { stdio: 'ignore' })
  if (r.error !== undefined) return 'unknown'
  return r.status === 0 ? 'free' : r.status === LEASE_BUSY_EXIT ? 'busy' : 'unknown'
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
  /** 🔴 생략하면 0 — `runUnderKernelLease.busyRetryMs` */
  busyRetryMs?: number
  /** 🔴 세 번째 인자는 그 회차를 연 깨움이다(생략해도 된다 — 앞판 본체는 두 인자만 받는다) */
  pass: (pass: number, proof: LeaseProof, ctx: PassContext) => Promise<number>
  log: (line: string) => void
}): Promise<number> {
  const lockPath = join(o.lockDir, o.lockFile)
  if (o.env[LEASE_INNER_ENV] === undefined) {
    const out = runUnderKernelLease({
      lockPath, followUpDir: o.lockDir, command: process.execPath,
      // 🔴 같은 진입점 · 같은 loader(tsx) — 인자 배열로만 넘긴다(wrapper 가 그대로 exec 한다)
      args: [...loaderArgs(), o.scriptPath, ...o.argv],
      env: o.env, nowMs: Date.now(), trigger: o.trigger, ...(o.lockf === undefined ? {} : { lockf: o.lockf }),
      ...(o.busyRetryMs === undefined ? {} : { busyRetryMs: o.busyRetryMs }),
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
  // 🔴 시작할 때 이미 있던 깨움은 이번 회차가 받는다 — 그 trigger 를 첫 회차에 싣는다
  const start = takeFollowUpRecord(v.proof)
  if (start.take === 'TAKEN') o.log(`  follow-up 표식을 거뒀다(${start.trigger}) — 이번 회차가 그 깨움을 받는다`)
  const absorbed = start.take === 'TAKEN' ? start.trigger : null
  let ctx: PassContext = {
    trigger: mergePassTrigger(o.trigger, absorbed), launch: o.trigger, absorbed, absorbedAt: start.take === 'TAKEN' ? start.at : null,
  }
  let worst = 0
  for (let pass = 0; ; pass += 1) {
    const raw = await o.pass(pass, v.proof, ctx)
    const code = raw === LEASE_BUSY_EXIT ? 1 : raw
    worst = Math.max(worst, code)
    if (code === 1) break
    // 🔴 상한에 닿았으면 표식을 거두지 않는다 — 남은 깨움은 다음 holder 가 시작할 때 받는다
    if (pass >= MAX_FOLLOW_UPS) break
    const next = takeFollowUpRecord(v.proof)
    if (!shouldRunFollowUp(pass, next.take)) break
    // 🔴 follow-up 회차의 trigger 는 거둔 표식 그대로다(띄운 이유는 앞 회차의 것이다)
    ctx = { trigger: next.trigger ?? 'unknown', launch: o.trigger, absorbed: next.trigger, absorbedAt: next.at }
    o.log(`\n  ── follow-up 회차 (${pass + 1}/${MAX_FOLLOW_UPS}) — 겹친 깨움(${ctx.trigger})을 합친 한 번 ──`)
  }
  return worst
}

/**
 * 🔴 **같은 Node · 같은 loader(tsx) 인자** — wrapper 재실행과 본체가 띄우는 자식이 같은 값을 쓴다.
 *    `--eval` 과 그 값은 뺀다(스크립트 경로로 다시 띄운다).
 */
export function loaderArgs(): string[] {
  return process.execArgv.filter((a, k, all) => a !== '--eval' && all[k - 1] !== '--eval')
}
