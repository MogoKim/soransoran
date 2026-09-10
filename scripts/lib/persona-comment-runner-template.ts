/**
 * 댓글 runner **schedule 템플릿** — 🔴 이번 PR 에서는 **등록하지 않는다**
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
export const COMMENT_RUNNER_SCRIPT = 'scripts/persona-comment-runner.mts'

/**
 * 🔴 **글 발행량과 묶지 않는다.**
 *    d10 이 되어 글이 하루 10개 나가도 댓글 회차는 그대로다 —
 *    "새 글마다 댓글 하나" 는 편한 규칙이지만 그 규칙이 곧 30% 를 넘긴다.
 */
export const COMMENT_RUNNER_SLOTS: readonly { hour: number; minute: number }[] = [
  { hour: 19, minute: 40 },
]

export function renderCommentRunnerPlist(input: {
  /** runtime worktree 절대 경로 */
  runtimeRoot: string
  /** npx 절대 경로 */
  npxPath: string
  logDir: string
}): string {
  const slots = COMMENT_RUNNER_SLOTS.map((s) =>
    `        <dict><key>Hour</key><integer>${s.hour}</integer>`
    + `<key>Minute</key><integer>${s.minute}</integer></dict>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${COMMENT_RUNNER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${input.npxPath}</string>
        <string>tsx</string>
        <string>${input.runtimeRoot}/${COMMENT_RUNNER_SCRIPT}</string>
    </array>
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

/** 🔴 등록 절차를 코드가 아니라 **사람이 읽는 순서**로 남긴다 */
export const COMMENT_RUNNER_INSTALL_STEPS: readonly string[] = [
  '① 이 PR 은 등록하지 않는다 — 아래는 별도 승인 뒤의 순서다',
  '② 모델이 확정(winner)되고 ratio 여유가 1 이상이어야 한다',
  '③ 사람이 승인한 Queue 후보가 있어야 한다',
  `④ plist 를 ~/Library/LaunchAgents/${COMMENT_RUNNER_LABEL}.plist 로 쓴다`,
  '⑤ plutil -lint 로 문법을 확인한다',
  `⑥ launchctl load 로 올리고 launchctl print 로 실제 경로가 runtime 인지 대조한다`,
  '⑦ npm run runtime:isolation-check -- --require-runtime 으로 격리를 확인한다',
]

// ─────────────────────────────────────────────────────────
// 🔴 runner 등록 상태 — 파일 존재만으로 판단하지 않는다
// ─────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { judgeJobPath, parseLaunchctlPrint } from '../../src/lib/runtime-isolation'

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
