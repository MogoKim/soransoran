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
  parseLaunchdRunInfo, failingFromLaunchd, failingFromProcessRuns, combineFailing, failingFromPublishRun,
  recoveryRunClassOf, type LaunchdRunInfo, type PublishRunRead, type RecoveryRunClass,
} from '../../src/lib/job-health'
import { RUN_FILE_RE } from '../../src/lib/supply-process'
import { parseRunTokenShadowTag, type RunTokenShadowTag } from '../../src/lib/supply-run-token'

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
  /** 회차 token이 증명한 전체 기원. 옛·손상 tag면 null(최종 trigger만으로 추정 0). */
  runTokenShadow: RunTokenShadowTag | null
  /**
   * 원본 tag 기준 recovery 신원 — 파싱이 손상 tag를 `null`로 버리기 **전에** 정한다. `readProcessRuns`는 언제나 채운다.
   * 없는 기록(수동·옛 시험 리터럴)은 `other`로 보고 자연 실패 판정에 남긴다(`failingFromProcessRuns`).
   */
  recoveryClass?: RecoveryRunClass
  /** 실패한 단계 요약 — 원문·비밀값 없이 단계·공급원·종료 코드만 */
  failedStages: string[]
}

/** 🔴 공급 회차 기록을 읽는다 — 깨진 파일은 건너뛰고 **몇 개 건너뛰었는지** 돌려준다 */
export type ProcessRunRead = { runs: ProcessRunLite[]; unreadable: number; unreadableFiles: string[] }

export function readProcessRuns(dir: string = SUPPLY_DATA_DIR): ProcessRunRead {
  if (!existsSync(dir)) return { runs: [], unreadable: 0, unreadableFiles: [] }
  const runs: ProcessRunLite[] = []
  let unreadable = 0
  const unreadableFiles: string[] = []
  for (const f of readdirSync(dir).filter((x) => RUN_FILE_RE.test(x))) {
    try {
      const j = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Record<string, unknown>
      const stages = Array.isArray(j.stages) ? j.stages as Record<string, unknown>[] : []
      const shadow = j.runTokenShadow !== null && typeof j.runTokenShadow === 'object' && !Array.isArray(j.runTokenShadow)
        ? j.runTokenShadow as Record<string, unknown> : null
      const runTokenShadow = parseRunTokenShadowTag(shadow)
      // 🔴 startedAt 이 없거나 날짜가 아니면 슬롯을 못 정한다 — 증명 슬롯에서 사라지지 않게 읽지 못한 파일로 센다
      //    (슬롯은 파일명 벽시계로 정한다)
      if (typeof j.startedAt !== 'string' || Number.isNaN(Date.parse(j.startedAt))) {
        unreadable += 1; unreadableFiles.push(f); continue
      }
      runs.push({
        runId: String(j.runId ?? f),
        startedAt: String(j.startedAt ?? ''),
        status: String(j.status ?? ''),
        completedAt: typeof j.completedAt === 'string' && Number.isFinite(Date.parse(j.completedAt)) ? j.completedAt : null,
        runtimeSha: typeof j.runtimeSha === 'string' && j.runtimeSha.trim() !== '' ? j.runtimeSha : null,
        runTokenShadow,
        recoveryClass: recoveryRunClassOf(j.runTokenShadow),
        failedStages: stages.filter((s) => s.status === 'failed').map((s) =>
          `${String(s.stage)}${s.source ? `:${String(s.source)}` : ''} exit ${String(s.exitCode ?? '?')}`),
      })
    } catch { unreadable += 1; unreadableFiles.push(f) }
  }
  runs.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
  return { runs, unreadable, unreadableFiles }
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

/**
 * 🔴 **발행 job 의 최근 회차 실패 여부.** launchd 가 종료 값을 갖고 있으면 그것이 전부다.
 *    **재등록 직후 한 번도 안 돈 상태**(`runs = 0 · (never exited)` · 돌고 있지 않음)에서만
 *    wrapper 가 남긴 마지막 실제 회차 기록을 읽는다 — 판정은 `failingFromPublishRun`.
 *    🔴 공급 `ProcessRun` 은 발행의 근거가 아니다 — 여기서 읽지 않는다.
 *    launchctl 을 못 읽었거나 재등록 뒤 한 번이라도 떴으면(돌고 있는 중 포함) 기록으로 채우지 않는다.
 */
export function publishFailing(
  obs: JobObservation, read: PublishRunRead, now: Date, maxAgeMs: number,
): boolean | null {
  // `runs` 는 launchd 가 띄울 때 오른다 — `runs = 0` 이면 지금 돌고 있는 중일 수도 없다
  const reloadedNeverRan = obs.run.readable && obs.run.runs === 0 && obs.run.lastExitCode === null
  if (obs.launchdFailing === null && reloadedNeverRan) return failingFromPublishRun(read, obs.label, now, maxAgeMs)
  return obs.launchdFailing
}
