/**
 * 🔴 **예약 job 의 최근 회차 성패 — 순수 판정. launchctl·파일·DB 0** (2026-09-28)
 *
 * 🔴 **왜 필요한가 — `d100:readiness` 오판의 근본 원인.**
 *    `runnerFactsOf` 는 `failing: null`(모른다)이면 `healthUnknown` 을 낸다 — 그것은 옳다.
 *    결함은 **호출부**에 있었다. `d100-master-readiness` 의 `factsOf` 가 `failing: null` 을
 *    **상수로** 넘겼다(generate · publish · comment). 수집 능력(`collect`)도 공급원별 회차 기록을
 *    이미 읽어 `collectJobs` 에는 넣으면서, 능력 판정에는 그 값을 넘기지 않았다.
 *    그래서 load 돼 있고 최근 회차가 정상인 job 도 **언제나** `healthUnknown` → `canRun:false` 였다.
 *    실측(2026-09-28 17:33 KST): wgang·remonterrace 회차 기록 ✕(실패 아님) · supply-process
 *    `last exit code = 0` · 최근 run `done` · publish runner `last exit code = 0` 인데
 *    collect/generate/publish 가 전부 `healthUnknown` 이었다.
 *
 * 🔴 **근거는 둘이고, 모르면 모른다고 둔다.**
 *    ① `launchctl print` 의 `last exit code` — launchd 가 기록한 마지막 종료 값
 *    ② job 이 남기는 **구조화된 회차 기록**(있는 job 만) — 공급 `supply-process-*.run.json` ·
 *       수집 `collect-runs/*.jsonl`
 *    `(never exited)` · 읽지 못함 · 기록 없음 → `null`. `false`(확인했고 정상)로 채우지 않는다.
 */

export type LaunchdRunInfo = {
  /** `launchctl print` 를 읽었는가 */
  readable: boolean
  /** `runs = N` — load 이후 실행 횟수. 못 읽으면 null */
  runs: number | null
  /**
   * `last exit code = N`. 🔴 `(never exited)` 는 **null** 이다 — load 이후 한 번도 끝나지 않았다.
   *    0 으로 읽으면 한 번도 안 돈 job 이 "정상" 이 된다.
   */
  lastExitCode: number | null
  /** 지금 돌고 있는가 (`state = running`) */
  running: boolean
}

export const UNREADABLE_RUN_INFO: LaunchdRunInfo = Object.freeze({
  readable: false, runs: null, lastExitCode: null, running: false,
})

/** 🔴 `launchctl print gui/<uid>/<label>` 의 출력에서 회차 정보만 읽는다 */
export function parseLaunchdRunInfo(out: string | null): LaunchdRunInfo {
  if (out === null || out.trim() === '') return UNREADABLE_RUN_INFO
  const runsM = /^\s*runs = (\d+)\s*$/m.exec(out)
  const exitM = /^\s*last exit code = (.+?)\s*$/m.exec(out)
  const stateM = /^\s*state = (.+?)\s*$/m.exec(out)
  let lastExitCode: number | null = null
  if (exitM !== null) {
    const raw = exitM[1]!.trim()
    // 🔴 `(never exited)` 등 숫자가 아닌 값은 모른다 — 0 으로 읽지 않는다
    lastExitCode = /^-?\d+$/.test(raw) ? Number(raw) : null
  }
  return {
    readable: true,
    runs: runsM === null ? null : Number(runsM[1]),
    lastExitCode,
    running: stateM !== null && stateM[1]!.trim() === 'running',
  }
}

/**
 * 🔴 **launchd 기록으로 본 마지막 회차 실패 여부.**
 *    · 못 읽음 · 한 번도 끝나지 않음 → `null`
 *    · 0 → `false` · 그 밖 → `true`
 */
export function failingFromLaunchd(info: LaunchdRunInfo): boolean | null {
  if (!info.readable || info.lastExitCode === null) return null
  return info.lastExitCode !== 0
}

/**
 * 🔴 **공급 회차 기록**(`ProcessRun.status`)으로 본 마지막 회차 실패 여부.
 *    `running` 은 아직 끝나지 않은 회차다 — 끝난 회차만 본다. 기록이 없으면 `null`.
 */
export function failingFromProcessRuns(
  runs: readonly { startedAt: string; status: string }[],
): boolean | null {
  const done = runs.filter((r) => r.status === 'done' || r.status === 'failed')
  if (done.length === 0) return null
  const last = done.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b))
  return last.status === 'failed'
}

/**
 * 🔴 **근거 여러 개를 합친다 — 실패는 이기고, 정상은 전원 일치여야 한다.**
 *    · 하나라도 `true` → `true` (어느 근거든 실패를 봤다)
 *    · 전부 `false` 이고 하나 이상 있다 → `false`
 *    · 그 밖(`null` 섞임 · 근거 없음) → `null`
 *    🔴 `null` 하나를 무시하고 나머지 `false` 로 정상을 선언하지 않는다 — 근거가 빠진 것을
 *       정상으로 읽으면 앞판의 fail-open 이 다른 모양으로 돌아온다.
 */
export function combineFailing(values: readonly (boolean | null)[]): boolean | null {
  if (values.some((v) => v === true)) return true
  if (values.length > 0 && values.every((v) => v === false)) return false
  return null
}

/**
 * 🔴 **수집 능력은 공급원 job 여러 개다.** 능력 판정은 **켜져 있는 공급원 전부**의 최근 회차로 한다.
 *    정책으로 꺼 둔 공급원(82cook)은 여기 넣지 않는다 — 부르는 쪽이 `enabled` 인 것만 넘긴다.
 */
export function collectCapabilityFailing(
  perSource: readonly { enabled: boolean; failing: boolean | null }[],
): boolean | null {
  return combineFailing(perSource.filter((s) => s.enabled).map((s) => s.failing))
}
