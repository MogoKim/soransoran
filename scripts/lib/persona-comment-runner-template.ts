/**
 * 댓글 runner **schedule 템플릿** — 🔴 문자열만 만든다. **등록하지 않는다**
 *
 * 🔴 **예약 대상은 무인 루프다** (2026-09-28 · Track B).
 *    이 label 이 가리키는 스크립트는 `scripts/persona-comment-loop.mts` 다 —
 *    대상 선정 → 생성 → 9관문 → PENDING → 발행을 한 회차로 잇는다.
 *    옛 `scripts/persona-comment-runner.mts` 는 **사람이 승인한 행만** 내는 수동 CLI 로 남는다
 *    (`npm run persona:comment-runner`). 두 스크립트가 같은 label 을 다투지 않는다.
 *
 * 🔴 만들어 두되 올리지 않는 이유.
 *
 *    등록은 되돌리기 어려운 쪽이다. plist 를 `~/Library/LaunchAgents` 에 두면
 *    로그인·재부팅 때 launchd 가 알아서 올린다 — 실제로 은퇴시킨 job 2개가
 *    그렇게 되살아나 개발 작업트리를 가리켰다(2026-09-09).
 *    그래서 **템플릿은 코드에 두고, 등록은 별도 승인**으로 남긴다.
 *
 * 🔴 이 파일은 문자열을 만들 뿐 파일을 쓰지 않는다.
 */

export const COMMENT_RUNNER_LABEL = 'com.soransoran.persona-comment-runner'

/** 🔴 runner 는 runtime worktree 에서 돈다. 개발 작업트리를 가리키면 격리가 깨진다 */
export const COMMENT_RUNNER_SCRIPT = 'scripts/persona-comment-loop.mts'
/** 🔴 예약 실행은 쓴다(`--live`). 그래도 단계가 bootstrap-auto 가 아니면 provider 0 · write 0 이다 */
export const COMMENT_RUNNER_ARGS: readonly string[] = ['--live']

/**
 * 🔴 **슬롯은 손으로 적지 않고 하루 상한에서 역산한다** (2026-09-11).
 *
 *    옛 값은 `[{ hour: 19, minute: 40 }]` — **하루 한 번**이었다. 그 값은
 *    "댓글은 글 발행량과 묶지 않는다" 는 옛 계약에서 나온 것이고,
 *    지금 단기 정본(공개 글 100/day · 글당 1~5 · 하루 최대 500)과 정면으로 어긋난다.
 *    한 회차가 발행할 수 있는 상한은 25 건(`BATCH_MAX`)이므로
 *    하루 한 번이면 **schedule 만으로 이미 25/day 가 천장**이다.
 *    목표를 문서에만 적고 슬롯을 그대로 두면 500 은 영원히 "적혀만 있는 수" 가 된다.
 *
 * 🔴 정의는 파일 아래 `planRunnerSchedule` 뒤에 있다 — 그 함수가 정본이고
 *    이 상수는 그 결과다. 두 곳에 적으면 반드시 한쪽이 낡는다.
 */

/**
 * 🔴 **PATH 를 준다** (2026-09-28). 옛 판은 `EnvironmentVariables` 가 없었다 —
 *    launchd 기본 PATH 에는 nvm 의 node 가 없어 `npx` 가 **뜨기도 전에** 죽는다(발행 러너 exit 127 과 같은 모양).
 *    값의 정본은 `runnerPathValue` 하나다 — 발행 러너 · 감사 러너와 같은 형태.
 */
export function renderCommentRunnerPlist(input: RunnerPlistInput): string {
  const slots = COMMENT_RUNNER_SLOTS.map((s) =>
    `        <dict><key>Hour</key><integer>${s.hour}</integer>`
    + `<key>Minute</key><integer>${s.minute}</integer></dict>`).join('\n')
  const args = [
    `        <string>${input.npxPath}</string>`,
    '        <string>tsx</string>',
    `        <string>${input.runtimeRoot}/${COMMENT_RUNNER_SCRIPT}</string>`,
    ...COMMENT_RUNNER_ARGS.map((a) => `        <string>${a}</string>`),
  ].join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${COMMENT_RUNNER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
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
    <key>StandardOutPath</key><string>${input.logDir}/persona-comment-runner.log</string>
    <key>StandardErrorPath</key><string>${input.logDir}/persona-comment-runner-error.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
`
}

/** 🔴 등록 절차를 코드가 아니라 **사람이 읽는 순서**로 남긴다 — 설치 명령은 `npm run persona:comment-loop-install` */
export const COMMENT_RUNNER_INSTALL_STEPS: readonly string[] = [
  '① 이 PR 은 등록하지 않는다 — 아래는 별도 승인 뒤의 순서다',
  '② runtime 을 이 코드가 든 SHA 로 배포한다 — npm run runtime:deploy -- --apply --target=<sha>',
  '③ 정본 env 에 단계를 올린다 — SORAN_PERSONA_COMMENT_STAGE=bootstrap-auto (창업자 결정)',
  '      예산 env 는 선택이다 — 없으면 코드 기본값(하루 $0.20 · 회차 6건 · 여유 1.5)이고 하루 상한은 $0.20 을 넘지 못한다',
  '      GEMINI_API_KEY 가 정본 env 에 있어야 한다 — 확정 모델 gemini-3.7-flash',
  '④ 첫 회차를 사람이 본다 — (runtime 에서) npx tsx scripts/persona-comment-loop.mts   ← dry-run · provider 0 · write 0',
  '⑤ 설치 — (runtime 에서) npm run persona:comment-loop-install -- --apply',
  '      = render → ~/Library/LaunchAgents/com.soransoran.persona-comment-runner.plist → plutil -lint → launchctl load → print 대조',
  '⑥ npm run runtime:isolation-check -- --require-runtime 으로 경로·인자·원문·SHA 를 대조한다',
  '⑦ 되돌리기 — launchctl unload 후 plist 를 보관소로 옮기거나, 더 빠르게 SORAN_PERSONA_COMMENT_STAGE 를 내린다',
]

// ─────────────────────────────────────────────────────────
// 🔴 runner 등록 상태 — 파일 존재만으로 판단하지 않는다
// ─────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { judgeJobPath, parseLaunchctlPrint } from '../../src/lib/runtime-isolation'
import { BOOTSTRAP_DAILY_MAX } from '../../src/lib/persona-comment-bootstrap-budget'
import { AUTO_FIRST_COMMENT_WINDOW_MINUTES } from '../../src/lib/persona-comment-auto-lane'
import { runnerPathValue, type RunnerPlistInput } from './original-post-runner-template'

export type RunnerState = {
  /** plist 파일이 그 자리에 있는가 */
  plistPresent: boolean
  /** launchctl 이 실제로 물고 있는가 — 🔴 loaded / unloaded / unknown */
  loaded: 'loaded' | 'unloaded' | 'unknown'
  /** 실제 실행 경로가 runtime 인가 */
  pathsOk: boolean | null
  /** 대상 스크립트 파일이 실제로 있는가 */
  targetExists: boolean
  /** 🔴 위를 모두 만족해야 "등록됐다" 다 */
  healthy: boolean
  detail: string
}

/**
 * 🔴 **plist 가 있다고 등록된 것이 아니다.**
 *
 *    앞선 판은 `readdirSync(LaunchAgents).includes(...)` 만 봤다.
 *    그러면 파일만 있고 unload 된 상태, 또는 **개발 작업트리를 가리키는** 상태도
 *    "등록됨" 으로 읽힌다 — 실제로 은퇴 job 2개가 파일이 남아 되살아나
 *    개발 트리를 가리켰던 그 모양이다.
 *
 * 🔴 launchctl 실패는 `unloaded` 가 아니라 `unknown` 이다.
 *    "확실히 내려가 있다" 와 "못 읽었다" 를 같이 세면 fail-open 이 된다.
 */
export function readRunnerState(input?: {
  runtimeRoot?: string
  agentDir?: string
  /** 시험용 주입 — 없으면 실제 launchctl 을 부른다 */
  printJob?: (label: string) => { ok: boolean; out: string }
  fileExists?: (p: string) => boolean
  /** 시험용 주입 — LaunchAgents 목록 */
  listAgents?: () => readonly string[]
}): RunnerState {
  const runtimeRoot = input?.runtimeRoot ?? join(homedir(), 'Documents', 'soransoran-runtime')
  const agentDir = input?.agentDir ?? join(homedir(), 'Library', 'LaunchAgents')
  const fileExists = input?.fileExists ?? existsSync

  const plistPresent = ((): boolean => {
    try {
      const list = input?.listAgents?.() ?? readdirSync(agentDir)
      return list.includes(`${COMMENT_RUNNER_LABEL}.plist`)
    } catch { return false }
  })()
  const targetExists = fileExists(join(runtimeRoot, COMMENT_RUNNER_SCRIPT))

  const printJob = input?.printJob ?? ((label: string): { ok: boolean; out: string } => {
    try {
      const uid = process.getuid?.() ?? 0
      return { ok: true, out: execFileSync('launchctl', ['print', `gui/${uid}/${label}`], { encoding: 'utf-8' }) }
    } catch (e) {
      // 🔴 "service not found" 만 확실한 unloaded 다. 그 밖은 모른다
      const err = e as { status?: number; stderr?: Buffer | string }
      const msg = String(err.stderr ?? '')
      return { ok: false, out: msg }
    }
  })

  const printed = printJob(COMMENT_RUNNER_LABEL)
  const loaded: RunnerState['loaded'] = printed.ok
    ? 'loaded'
    : /Could not find service|No such process/.test(printed.out) ? 'unloaded' : 'unknown'

  const pathsOk = loaded !== 'loaded' ? null : ((): boolean => {
    const cfg = parseLaunchctlPrint(printed.out)
    // 🔴 관측 자체에 실패했으면 "정상" 이 아니다
    if (!cfg.readable) return false
    // 🔴 ProgramArguments 의 .mts 와 WorkingDirectory 를 둘 다 본다
    return judgeJobPath({
      label: COMMENT_RUNNER_LABEL,
      programPath: cfg.programPath,
      workingDirectory: cfg.workingDirectory,
      runtimeRoot,
      devRoots: [join(homedir(), 'Documents', 'soransoran-m0')],
    }).ok
  })()

  const healthy = plistPresent && loaded === 'loaded' && pathsOk === true && targetExists
  const detail = !targetExists
    ? `🔴 대상 스크립트가 없다 — ${join(runtimeRoot, COMMENT_RUNNER_SCRIPT)}`
    : !plistPresent
      ? '🔴 미등록 (plist 없음) — 이 PR 은 등록하지 않는다'
      : loaded === 'unknown'
        ? '🔴 launchctl 상태를 읽지 못했다(fail-closed)'
        : loaded === 'unloaded'
          ? '🔴 plist 는 있으나 loaded 가 아니다'
          : pathsOk === true
            ? '등록됨 · runtime 경로 확인'
            : '🔴 loaded 지만 실행 경로가 runtime 이 아니다'
  return { plistPresent, loaded, pathsOk, targetExists, healthy, detail }
}


// ─────────────────────────────────────────────────────────
// 🔴 하루 목표에서 schedule 을 **역산**한다 (2026-09-11)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **왜 slot 을 손으로 적지 않는가.**
 *
 *    지금 template 은 하루 한 번(19:40)이다. 한 회차가 publish 하는 상한은
 *    `batchSizeFor` 의 `BATCH_MAX` 로 25 건이다 — 즉 지금 구조로는
 *    하루 100 건이 **schedule 만으로 이미 불가능**하다. 목표를 문서에만 적고
 *    template 을 그대로 두면, 100/day 는 영원히 "적혀만 있는 수" 가 된다.
 *
 *    그래서 slot 을 목표에서 역산한다. 그리고 **하루에 몰지 않는다** —
 *    한 시간에 100 건이 쏟아지면 타임라인이 봇으로 덮인다.
 *    깨어 있는 시간대(08~22시)에 고르게 나눈다.
 *
 * 🔴 이 함수는 **아무것도 등록하지 않는다.** 문자열만 만든다.
 */
export const RUNNER_WINDOW_START_HOUR = 8
export const RUNNER_WINDOW_END_HOUR = 22

/**
 * 🔴 **정각에서 이만큼 밀어 둔다.** 매시 정각은 사람보다 기계처럼 보인다.
 *    창 전체를 미루므로 간격은 그대로 균등하다 — 슬롯마다 따로 흔들면 간격이 깨진다.
 */
export const RUNNER_WINDOW_OFFSET_MINUTES = 7

/**
 * 🔴 새 글에 첫 댓글이 붙기까지의 목표 — 단기 정본(§9.5-g)에서 온 수다.
 *    값의 정본은 무인 레인 규칙(`AUTO_FIRST_COMMENT_WINDOW_MINUTES`)이다 — 발행 트랜잭션이 그 값으로 막는다.
 */
export const FIRST_COMMENT_MAX_MINUTES = AUTO_FIRST_COMMENT_WINDOW_MINUTES

export type RunnerSchedule = {
  /** 하루 몇 번 도는가 */
  runs: number
  /** 한 회차가 발행할 수 있는 상한 */
  perRun: number
  slots: readonly { hour: number; minute: number }[]
  /** 이 schedule 이 감당하는 하루 최대치 */
  capacity: number
  /**
   * 🔴 **창 안에서 회차 사이의 최대 간격(분).** 회차가 1회 이하면 `null` —
   *    "간격이 0" 이 아니라 "간격이라는 것이 없다" 이고, 둘을 같이 세면
   *    하루 한 번 도는 schedule 이 "간격 0분" 으로 보인다.
   */
  maxGapMinutes: number | null
  /** 🔴 창 **밖**(밤)의 공백. 이 시간에 올라온 글은 아침까지 기다린다 */
  nightGapMinutes: number
  reason: string
}

/**
 * @param dailyTarget 하루 목표 발행 수
 * @param perRunMax   한 회차 상한 (기본은 배치 상한 25)
 */
export function planRunnerSchedule(dailyTarget: number, perRunMax = 25): RunnerSchedule {
  const target = Number.isInteger(dailyTarget) && dailyTarget > 0 ? dailyTarget : 0
  const perRun = Math.max(1, Math.min(perRunMax, target === 0 ? 1 : target))
  const runs = target === 0 ? 0 : Math.ceil(target / perRun)
  const startMin = RUNNER_WINDOW_START_HOUR * 60 + RUNNER_WINDOW_OFFSET_MINUTES
  const endMin = RUNNER_WINDOW_END_HOUR * 60
  const span = endMin - startMin
  /**
   * 🔴 **분을 시각에서 파생시킨다** (2026-09-11 정정).
   *
   *    옛 판은 시각을 `span * i / (runs-1)` 로 잡아 놓고 분을 `(i * 17) % 60` 으로
   *    따로 지어냈다. 두 수가 무관해서 간격이 들쭉날쭉했고 —
   *    500/day(20회)에서 실측 **최대 77분** — 회차 사이가 60분 계약을 넘겼다.
   *    분은 그 회차가 돌기로 한 시각의 나머지여야 한다.
   */
  const atMinutes = Array.from({ length: runs }, (_, i) => Math.round(
    runs === 1 ? startMin + span / 2 : startMin + (span * i) / (runs - 1),
  ))
  const slots = atMinutes.map((m) => ({ hour: Math.floor(m / 60), minute: m % 60 }))
  const maxGapMinutes = atMinutes.length < 2
    ? null
    : atMinutes.slice(1).reduce((max, m, i) => Math.max(max, m - atMinutes[i]!), 0)
  // 🔴 마지막 회차부터 다음 날 첫 회차까지 — 창을 08~22 로 잡은 대가다
  const nightGapMinutes = runs === 0 ? 24 * 60 : 24 * 60 - span

  return {
    runs, perRun, slots, capacity: runs * perRun, maxGapMinutes, nightGapMinutes,
    reason: target === 0
      ? '하루 목표가 0 이다 — 도는 회차가 없다'
      : `하루 ${target}건 ÷ 회차당 ${perRun}건 → ${runs}회`
        + ` · ${RUNNER_WINDOW_START_HOUR}~${RUNNER_WINDOW_END_HOUR}시에 균등 분산`
        + ` · 감당 ${runs * perRun}건`
        + ` · 회차 간격 최대 ${maxGapMinutes ?? '—'}분 · 🔴 야간 공백 ${nightGapMinutes}분`,
  }
}

/**
 * 🔴 **template 슬롯의 정본.** 하루 절대 상한에서 역산한다 —
 *    상한이 바뀌면 슬롯도 함께 바뀐다. 손으로 적은 값이 남으면 반드시 어긋난다.
 */
export const COMMENT_RUNNER_SLOTS: readonly { hour: number; minute: number }[] =
  planRunnerSchedule(BOOTSTRAP_DAILY_MAX).slots
