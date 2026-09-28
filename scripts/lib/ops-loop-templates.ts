/**
 * 🔴 **무인 운영 루프 launchd 템플릿 셋 — 문자열만 만든다. 등록 0 · 파일 write 0** (2026-09-28)
 *
 *   ① `com.soransoran.stage-controller` 하루 단계 결정(07:00 · 07:20 · 07:40 — 발행 창 08:00 전)
 *   ② `com.soransoran.runner-recover`   실패·누락 회차 복구(30분마다 · 기본 dry-run 아님 → `--apply` 로 등록)
 *   ③ `com.soransoran.keep-awake`       `caffeinate -i -s` 로 **유휴·AC 전원 잠자기**를 막는다
 *
 * 🔴 **③ 이 막지 못하는 것 — 정직하게 적는다.**
 *    · 노트북 **덮개를 닫으면** 외부 모니터·전원·입력장치가 없는 한 macOS 는 잔다(clamshell).
 *      `caffeinate` 는 이것을 막지 못한다. 막으려면 `sudo pmset -a disablesleep 1` 인데 관리자 권한 ·
 *      시스템 전역 설정이고 배터리 발열 위험이 있다 — 이 템플릿은 그 명령을 **쓰지 않는다**.
 *    · **로그아웃**하면 gui 도메인의 LaunchAgent 전부(발행·공급 포함)가 내려간다. keep-awake 도 같다.
 *    · 배터리만일 때 `-s` 는 효과가 없다(`-i` 만 남는다).
 *    그래서 이것은 **임시 bridge** 다. 상시 실행 주체는 별도 결정이다(보고서 참고).
 */
import { AUDIT_RUNNER_LABEL } from './auto-ready-audit-template'
import { PUBLISH_RUNNER_LABEL, runnerPathValue, type RunnerPlistInput } from './original-post-runner-template'
import { PUBLISH_WINDOW_START_MINUTE } from '../../src/lib/publish-slot-catchup'

export const STAGE_CONTROLLER_LABEL = 'com.soransoran.stage-controller'
export const STAGE_CONTROLLER_SCRIPT = 'scripts/stage-controller.mts'
/** 🔴 예약 실행은 `--apply` — 그래도 `STAGE_CONTROLLER_ENABLED=on` 이 아니면 쓰지 않는다 */
export const STAGE_CONTROLLER_ARGS: readonly string[] = ['--apply']

export const RUNNER_RECOVER_LABEL = 'com.soransoran.runner-recover'
export const RUNNER_RECOVER_SCRIPT = 'scripts/runner-recover.mts'
export const RUNNER_RECOVER_ARGS: readonly string[] = ['--apply']
/** 🔴 복구 점검 간격(초) — launchd `StartInterval`. 잠에서 깨면 놓친 한 번을 바로 돈다 */
export const RUNNER_RECOVER_INTERVAL_SEC = 1800

export const KEEP_AWAKE_LABEL = 'com.soransoran.keep-awake'
export const CAFFEINATE_PATH = '/usr/bin/caffeinate'
/** 🔴 `-i` 유휴 잠자기 방지 · `-s` AC 전원에서 시스템 잠자기 방지. 화면(-d)은 끄게 둔다 */
export const CAFFEINATE_ARGS: readonly string[] = ['-i', '-s']

/**
 * 🔴 **controller 는 발행 창보다 먼저 돈다** — 첫 발행 전에 그날 결정이 있어야 consumer 가
 *    safest 로 떨어지지 않는다. 세 번 깨우는 것은 **재시도**다(같은 날 결정은 하나 · 이미 있으면 읽기만).
 */
export function stageControllerSlots(): { hour: number; minute: number }[] {
  return [60, 40, 20].map((before) => {
    const m = PUBLISH_WINDOW_START_MINUTE - before
    return { hour: Math.floor(m / 60), minute: m % 60 }
  })
}

const header = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>`

function tsxArgs(input: RunnerPlistInput, script: string, args: readonly string[]): string {
  return [
    `        <string>${input.npxPath}</string>`,
    '        <string>tsx</string>',
    `        <string>${input.runtimeRoot}/${script}</string>`,
    ...args.map((a) => `        <string>${a}</string>`),
  ].join('\n')
}

export function renderStageControllerPlist(input: RunnerPlistInput): string {
  const slots = stageControllerSlots().map((s) =>
    `        <dict><key>Hour</key><integer>${s.hour}</integer>`
    + `<key>Minute</key><integer>${s.minute}</integer></dict>`).join('\n')
  return `${header}
    <key>Label</key><string>${STAGE_CONTROLLER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${tsxArgs(input, STAGE_CONTROLLER_SCRIPT, STAGE_CONTROLLER_ARGS)}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>${runnerPathValue(input.nodeBinDir)}</string>
    </dict>
    <key>WorkingDirectory</key><string>${input.runtimeRoot}</string>
    <key>StartCalendarInterval</key>
    <array>
${slots}
    </array>
    <key>StandardOutPath</key><string>${input.logDir}/stage-controller.log</string>
    <key>StandardErrorPath</key><string>${input.logDir}/stage-controller-error.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
`
}

export function renderRunnerRecoverPlist(input: RunnerPlistInput): string {
  return `${header}
    <key>Label</key><string>${RUNNER_RECOVER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${tsxArgs(input, RUNNER_RECOVER_SCRIPT, RUNNER_RECOVER_ARGS)}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>${runnerPathValue(input.nodeBinDir)}</string>
    </dict>
    <key>WorkingDirectory</key><string>${input.runtimeRoot}</string>
    <key>StartInterval</key><integer>${RUNNER_RECOVER_INTERVAL_SEC}</integer>
    <key>StandardOutPath</key><string>${input.logDir}/runner-recover.log</string>
    <key>StandardErrorPath</key><string>${input.logDir}/runner-recover-error.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
`
}

/**
 * 🔴 **keep-awake — node 도 저장소도 쓰지 않는다.** 시스템 `caffeinate` 하나다.
 *    `KeepAlive` 로 죽으면 launchd 가 다시 띄운다. `RunAtLoad` 로 로그인 즉시 잡는다.
 *    🔴 sudo · pmset 쓰기 없음. 끄는 법 = `launchctl bootout gui/<uid>/com.soransoran.keep-awake`.
 */
export function renderKeepAwakePlist(input: { logDir: string }): string {
  const args = [CAFFEINATE_PATH, ...CAFFEINATE_ARGS].map((a) => `        <string>${a}</string>`).join('\n')
  return `${header}
    <key>Label</key><string>${KEEP_AWAKE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>KeepAlive</key><true/>
    <key>RunAtLoad</key><true/>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>${input.logDir}/keep-awake.log</string>
    <key>StandardErrorPath</key><string>${input.logDir}/keep-awake-error.log</string>
</dict>
</plist>
`
}

/**
 * 🔴 **복구 대상 — 같은 회차를 한 번 더 돌려도 안전한 job 만.**
 *    · 발행: 트랜잭션이 `도래 슬롯 − 오늘 발행 수` 로 정한다(중복 0 · heartbeat 틱 잠금)
 *    · 공급 처리: 회차 잠금 · 적재 멱등
 *    · 감사: 전용 잠금 · 같은 글 두 번 고르지 않음(기본키)
 *    · 단계 controller: 하루 결정은 하나 · 있으면 읽기만
 *    🔴 **수집 job 은 넣지 않는다** — 외부 source 요청 간격·일 상한은 영구 안전장치다.
 *       밀린 수집을 한꺼번에 당기면 그 간격을 깬다.
 */
export const RECOVERABLE_LABELS: readonly string[] = [
  PUBLISH_RUNNER_LABEL,
  'com.soransoran.supply-process',
  AUDIT_RUNNER_LABEL,
  STAGE_CONTROLLER_LABEL,
]

/** 🔴 설치 절차 — 이 PR 은 아무것도 설치하지 않는다. 사람이 이 순서로 한다 */
export const OPS_LOOP_INSTALL_STEPS: readonly string[] = [
  '① runtime 을 이 PR 이 들어간 main SHA 로 배포한다 (npm run runtime:deploy — 기존 절차)',
  '② 렌더: npx tsx scripts/ops-loop-render.mts --out=<임시 디렉터리> (파일 셋을 만든다 · 등록 0)',
  '③ keep-awake: cp <임시>/com.soransoran.keep-awake.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.soransoran.keep-awake.plist',
  '④ 확인: pmset -g assertions | grep caffeinate',
  '⑤ runner-recover: 같은 방법으로 bootstrap — 첫 회는 `npm run ops:recover` (dry-run) 로 무엇을 할지 먼저 본다',
  '⑥ stage-controller: bootstrap 만 한다. 실제 저장은 정본 env 에 STAGE_CONTROLLER_ENABLED=on 을 사람이 넣은 뒤부터다',
  '⑦ consumer: 발행·공급 러너가 결정을 읽게 하려면 두 러너의 ProgramArguments 앞에 `npx tsx scripts/stage-consume-exec.mts --` 를 붙인다 (flag OFF 면 그대로 통과 · legacy)',
]
