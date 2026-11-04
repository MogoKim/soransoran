import { spawn } from 'node:child_process'

/** SIGTERM 뒤 후손까지 끝내기 위해 기다리는 운영 유예 시간. */
export const PROCESS_GROUP_KILL_GRACE_MS = 5_000

/**
 * SIGKILL 전달 뒤 OS reaper/subreaper가 고아 후손을 수거할 때까지 기다리는 상한.
 * `kill(-pgid, 0)`은 이미 죽은 zombie도 잠시 살아 있다고 보고하므로,
 * signal 전송 직후 성공을 반환하면 호출자가 후손 정리를 완료로 오인할 수 있다.
 */
export const PROCESS_GROUP_REAP_WAIT_MS = 2_000
const PROCESS_GROUP_REAP_POLL_MS = 20

function processGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * detached process group 하나를 제한 시간 안에서 실행한다.
 *
 * timeout 뒤 부모가 먼저 끝나더라도 강제 종료 timer를 유지해, SIGTERM을 무시한
 * browser/provider 후손까지 SIGKILL한 뒤에만 실패를 돌려준다.
 */
export function runDetachedProcessGroup(i: {
  command: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  logFd: number
  timeoutMs: number
  killGraceMs?: number
  onSpawn?: (pid: number) => void
  signal?: AbortSignal
}): Promise<number> {
  return new Promise((resolveCode) => {
    let done = false
    let terminating = false
    let timeoutTimer: NodeJS.Timeout | null = null
    let killTimer: NodeJS.Timeout | null = null
    let reapTimer: NodeJS.Timeout | null = null
    const finish = (code: number): void => {
      if (done) return
      done = true
      if (timeoutTimer !== null) clearTimeout(timeoutTimer)
      if (killTimer !== null) clearTimeout(killTimer)
      if (reapTimer !== null) clearInterval(reapTimer)
      i.signal?.removeEventListener('abort', abort)
      resolveCode(code)
    }
    const finishAfterGroupExit = (pid: number, code: number): void => {
      if (!processGroupAlive(pid)) { finish(code); return }
      const deadline = Date.now() + PROCESS_GROUP_REAP_WAIT_MS
      // unref 금지. 호출자는 process group이 실제로 사라지기 전에 완료를 받으면 안 된다.
      reapTimer = setInterval(() => {
        if (!processGroupAlive(pid)) { finish(code); return }
        if (Date.now() >= deadline) finish(1)
      }, PROCESS_GROUP_REAP_POLL_MS)
    }
    const child = spawn(i.command, [...i.args], {
      cwd: i.cwd, env: i.env, stdio: ['ignore', i.logFd, i.logFd], detached: true,
    })
    child.once('spawn', () => {
      if (child.pid !== undefined) i.onSpawn?.(child.pid)
    })
    const terminate = (): void => {
      if (done || terminating) return
      terminating = true
      const pid = child.pid
      if (pid === undefined) { finish(1); return }
      try { process.kill(-pid, 'SIGTERM') } catch { /* 이미 끝난 group도 아래에서 실패로 닫는다 */ }
      // 🔴 unref 금지. 부모가 SIGTERM으로 먼저 끝나도 이 timer가 살아 있어야
      // 같은 process group의 browser/provider 후손을 반드시 SIGKILL한다.
      killTimer = setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL') } catch { /* 이미 전부 끝남 */ }
        finishAfterGroupExit(pid, 1)
      }, i.killGraceMs ?? PROCESS_GROUP_KILL_GRACE_MS)
    }
    const abort = (): void => { terminate() }
    if (i.signal?.aborted === true) terminate()
    else i.signal?.addEventListener('abort', abort, { once: true })
    timeoutTimer = setTimeout(terminate, i.timeoutMs)
    // 정상 실행 중에는 살아 있는 child handle이 event loop를 붙든다.
    timeoutTimer.unref()
    child.on('error', () => { if (!terminating) finish(1) })
    child.on('exit', (code) => {
      if (terminating) return
      const pid = child.pid
      if (pid !== undefined) {
        if (processGroupAlive(pid)) {
          // leader가 끝난 뒤 같은 process group 후손이 남은 경우에만 정상 경로도 정리한다.
          terminating = true
          try { process.kill(-pid, 'SIGTERM') } catch { finish(code ?? 1); return }
          killTimer = setTimeout(() => {
            try { process.kill(-pid, 'SIGKILL') } catch { /* 이미 전부 끝남 */ }
            finishAfterGroupExit(pid, code ?? 1)
          }, i.killGraceMs ?? PROCESS_GROUP_KILL_GRACE_MS)
          return
        }
      }
      finish(code ?? 1)
    })
  })
}
