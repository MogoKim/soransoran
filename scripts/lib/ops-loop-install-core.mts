/**
 * 무인 운영 루프 설치기(`scripts/ops-loop-install.mts`)의 판정·적용 순서 — 🔴 launchctl·파일을 직접 부르지 않는다.
 * 부르는 쪽이 진짜 명령을 붙이고, 검사(`scripts/ops-loop-check.mts`)는 가짜를 붙여 막힘·재기동·rollback 을 실행해 본다.
 *
 * 🔴 **실행 중 blocker 예외는 keep-awake 하나다** (2026-09-30 실측: plan 이 "keep-awake 실행 중 → 막힘 1건" 으로 영원히 막혔다).
 *    keep-awake 는 caffeinate 상주(KeepAlive)라 설계상 늘 running 이다 — 끊을 회차가 없다.
 *    발행 러너·단계 controller·복구 job 이 running 이면 회차 한가운데이므로 계속 막는다.
 *    예외 목록은 호스트 이전의 `ALWAYS_RUNNING_LABELS` 를 그대로 쓴다 — "돌고 있는 회차 위로 내리지 않는다,
 *    늘 pid 가 있는 keep-awake 만 예외" 라는 **같은 판단**이라 두 곳이 갈라지면 안 된다.
 */
import { ALWAYS_RUNNING_LABELS } from './host-migrate.mjs'
import { programArguments } from './launchd-install.mjs'
import {
  KEEP_AWAKE_LABEL, RUNNER_RECOVER_LABEL, STAGE_CONTROLLER_LABEL,
  renderKeepAwakePlist, renderRunnerRecoverPlist, renderStageControllerPlist,
} from './ops-loop-templates'
import {
  PUBLISH_RUNNER_LABEL, judgeLaunchdRunMarker, launchctlEnvironmentOf, renderRunnerPlistFor,
  type RunnerPlistInput, type RunnerTriggerMode,
} from './original-post-runner-template'
import { parseLaunchctlPrint } from '../../src/lib/runtime-isolation'

/** 교체 대상 4 job 과 기대 plist — 🔴 keep-awake 도 여기 있으므로 bootout·교체·bootstrap·검증을 똑같이 거친다 */
export function desiredPlists(publishMode: RunnerTriggerMode, input: RunnerPlistInput): Map<string, string> {
  return new Map<string, string>([
    [PUBLISH_RUNNER_LABEL, renderRunnerPlistFor(publishMode, input)],
    [STAGE_CONTROLLER_LABEL, renderStageControllerPlist(input)],
    [RUNNER_RECOVER_LABEL, renderRunnerRecoverPlist(input)],
    [KEEP_AWAKE_LABEL, renderKeepAwakePlist({ logDir: input.logDir })],
  ])
}

/** 🔴 실행 중이어도 교체를 막지 않는 label — 늘 떠 있는 것(keep-awake)만 */
export const isAlwaysRunning = (label: string): boolean => ALWAYS_RUNNING_LABELS.includes(label)

/** preflight: 교체 대상 중 **회차가 돌고 있는** job 마다 막힘 한 줄 */
export function runningBlockers(labels: Iterable<string>, isRunning: (label: string) => boolean): string[] {
  const problems: string[] = []
  for (const label of labels) {
    if (isAlwaysRunning(label)) continue
    if (isRunning(label)) problems.push(`${label}이 실행 중이다 — 회차 종료 뒤 다시 실행`)
  }
  return problems
}

export type LoadedVerdict = { ok: boolean; lines: string[] }

/**
 * bootstrap 뒤 launchctl 이 **실제로 물고 있는** 설정 확인 — `print` 출력(못 읽으면 null) 기준.
 * 🔴 keep-awake 재기동 = loaded 이고 인자가 caffeinate 그대로. running 순간값은 보지 않는다:
 *    다른 job 도 loaded 로만 판정하고, KeepAlive 가 떠 있게 유지한다. 방금 bootstrap 한 순간의 state 로
 *    막으면 기동 경합 한 번에 루프 전체가 rollback 된다(fail-closed 는 공짜가 아니다).
 */
export function verifyLoaded(label: string, xml: string, printOut: string | null, runtimeRoot: string): LoadedVerdict {
  const lines: string[] = []
  const cfg = parseLaunchctlPrint(printOut)
  const argsOk = cfg.readable && JSON.stringify(cfg.args) === JSON.stringify(programArguments(xml))
  const wdOk = label === KEEP_AWAKE_LABEL || (cfg.readable && cfg.workingDirectory === runtimeRoot)
  let ok = argsOk && wdOk
  lines.push(`   ${ok ? '🟢' : '🔴'} ${label} loaded 인자·경로${label === KEEP_AWAKE_LABEL ? ' (keep-awake 재기동)' : ''}`)
  if (label === PUBLISH_RUNNER_LABEL) {
    // 🔴 파일이 아니라 launchctl 이 **실제로 물고 있는** env 에서 표식·label 을 본다
    const marker = judgeLaunchdRunMarker(launchctlEnvironmentOf(printOut))
    lines.push(`   ${marker.ok ? '🟢' : '🔴'} ${label} loaded 실행 표식·label`)
    for (const m of marker.problems) lines.push(`      ${m}`)
    ok = marker.ok && ok
  }
  return { ok, lines }
}

export type ApplyIo = {
  bootout: (label: string) => void
  write: (label: string, xml: string) => boolean
  lint: (label: string) => boolean
  bootstrap: (label: string) => boolean
  /** `launchctl print` 출력 · 실패면 null */
  print: (label: string) => string | null
  /** 설치 전 snapshot 으로 **전체** 되돌리기 */
  restore: () => boolean
  log: (line: string) => void
}

export type ApplyOutcome = { ok: true } | { ok: false; restored: boolean }

/**
 * 🔴 순서: 전부(keep-awake 포함) bootout → plist 교체 → bootstrap → loaded 검증.
 *    하나라도 실패하면 snapshot 으로 전체 rollback 한다.
 */
export function applyInstall(desired: ReadonlyMap<string, string>, runtimeRoot: string, io: ApplyIo): ApplyOutcome {
  let ok = true
  for (const label of desired.keys()) io.bootout(label)
  for (const [label, xml] of desired) {
    ok = io.write(label, xml) && ok
    ok = io.lint(label) && ok
  }
  for (const label of desired.keys()) {
    const booted = io.bootstrap(label)
    if (!booted) io.log(`   🔴 ${label} bootstrap 실패`)
    ok = booted && ok
  }
  for (const [label, xml] of desired) {
    const v = verifyLoaded(label, xml, io.print(label), runtimeRoot)
    for (const line of v.lines) io.log(line)
    ok = v.ok && ok
  }
  if (ok) return { ok: true }
  io.log('🔴 설치 검증 실패 — 설치 전 상태로 되돌린다')
  return { ok: false, restored: io.restore() }
}
