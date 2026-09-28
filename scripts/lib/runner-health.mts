/**
 * 예약 job 관측 — 🔴 **read-only. launchctl print · 파일 읽기만. load·unload·kickstart·write 0**
 *
 * 🔴 관측만 만든다. 판정은 순수 함수(`src/lib/job-health` · `runtime-isolation.judgeJobState`)가 한다.
 *    `d100:readiness` · `ops:status` · `stage:controller` 가 **같은 관측**을 쓴다 —
 *    화면마다 따로 읽으면 한쪽은 healthUnknown, 한쪽은 ready 인 날이 다시 온다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { judgeJobState, type JobState } from '../../src/lib/runtime-isolation'
import {
  parseLaunchdRunInfo, failingFromLaunchd, failingFromProcessRuns, combineFailing,
  type LaunchdRunInfo,
} from '../../src/lib/job-health'
import { RUN_FILE_RE } from '../../src/lib/supply-process'

/** 🔴 공급 회차 기록이 사는 곳 — runtime 의 `.microseed-data` 가 가리키는 정본 디렉터리 */
export const SUPPLY_DATA_DIR = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'microseed-data',
)

export type ProcessRunLite = {
  runId: string
  startedAt: string
  status: string
  completedAt: string | null
  runtimeSha: string | null
  /** 실패한 단계 요약 — 원문·비밀값 없이 단계·공급원·종료 코드만 */
  failedStages: string[]
}

/** 🔴 공급 회차 기록을 읽는다 — 깨진 파일은 건너뛰고 **몇 개 건너뛰었는지** 돌려준다 */
export function readProcessRuns(dir: string = SUPPLY_DATA_DIR): { runs: ProcessRunLite[]; unreadable: number } {
  if (!existsSync(dir)) return { runs: [], unreadable: 0 }
  const runs: ProcessRunLite[] = []
  let unreadable = 0
  for (const f of readdirSync(dir).filter((x) => RUN_FILE_RE.test(x))) {
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Record<string, unknown>
      const stages = Array.isArray(j.stages) ? j.stages as Record<string, unknown>[] : []
      runs.push({
        runId: String(j.runId ?? f),
        startedAt: String(j.startedAt ?? ''),
        status: String(j.status ?? ''),
        completedAt: typeof j.completedAt === 'string' ? j.completedAt : null,
        runtimeSha: typeof j.runtimeSha === 'string' ? j.runtimeSha : null,
        failedStages: stages.filter((s) => s.status === 'failed').map((s) =>
          `${String(s.stage)}${s.source ? `:${String(s.source)}` : ''} exit ${String(s.exitCode ?? '?')}`),
      })
    } catch { unreadable += 1 }
  }
  runs.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
  return { runs, unreadable }
}

export type JobObservation = {
  label: string
  /** plist 가 LaunchAgents 정본 자리에 있는가 */
  installed: boolean
  /** 🔴 loaded / unloaded / unknown — "못 봤다" 는 unloaded 가 아니다 */
  state: JobState
  stateReason: string
  run: LaunchdRunInfo
  /** launchd 기록만으로 본 실패 여부 */
  launchdFailing: boolean | null
}

/**
 * 🔴 **`launchctl print gui/<uid>/<label>` 한 번 — read-only.** 결과를 그대로 돌려준다.
 *    판정은 정본 `judgeJobState` · `parseLaunchdRunInfo` 가 한다. 명령을 못 돌렸으면 `exitCode: null`.
 *    (`launchd-observe` 는 관제용 `list` 하나만 부르도록 잠겨 있어 여기 둔다)
 */
export function printJob(label: string): { exitCode: number | null; stdout: string; stderr: string } {
  const uid = process.getuid?.() ?? 0
  try {
    const stdout = execFileSync('launchctl', ['print', `gui/${uid}/${label}`], {
      encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { exitCode: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer }
    return {
      exitCode: typeof err.status === 'number' ? err.status : null,
      stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? ''),
    }
  }
}

export type ObserveIo = {
  print: (label: string) => { exitCode: number | null; stdout: string; stderr: string }
  plistExists: (label: string) => boolean
}

export const REAL_IO: ObserveIo = {
  print: printJob,
  plistExists: (label) => existsSync(join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)),
}

export function observeJob(label: string, io: ObserveIo = REAL_IO): JobObservation {
  const probe = io.print(label)
  const st = judgeJobState(probe)
  const run = st.state === 'loaded' ? parseLaunchdRunInfo(probe.stdout) : parseLaunchdRunInfo(null)
  return {
    label, installed: io.plistExists(label), state: st.state, stateReason: st.reason,
    run, launchdFailing: failingFromLaunchd(run),
  }
}

/**
 * 🔴 **공급 처리 job 의 최근 회차 실패 여부** — launchd 종료 값과 회차 기록을 **둘 다** 본다.
 *    회차 기록이 `done` 이어도 프로세스가 비정상 종료했으면 실패다(그 반대도 같다).
 */
export function supplyFailing(obs: JobObservation, runs: readonly ProcessRunLite[]): boolean | null {
  const byRecord = failingFromProcessRuns(runs)
  /**
   * 🔴 launchd 가 `(never exited)` 인 것은 **다시 load 된 뒤 아직 한 번도 안 돌았다**는 뜻이지
   *    근거가 빠진 것이 아니다 — 그때 마지막 실제 회차는 기록이 말한다.
   *    launchctl 자체를 못 읽은 경우(`readable:false`)는 모른다로 남긴다.
   */
  if (obs.launchdFailing === null && obs.run.readable && obs.run.lastExitCode === null) return byRecord
  return combineFailing([obs.launchdFailing, byRecord])
}
