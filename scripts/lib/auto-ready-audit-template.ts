/**
 * 자동 READY **독립 감사 러너 launchd 템플릿** — 🔴 문자열만 만든다. **등록하지 않는다** (2026-09-27)
 *
 * 🔴 등록(`~/Library/LaunchAgents` 에 두기 · `launchctl load`)은 되돌리기 어려운 쪽이라 별도 승인이다.
 *    이 파일은 파일을 쓰지 않는다. `launchd:template-check` 가 렌더 결과를 검사한다.
 *
 * 🔴 **왜 30분마다인가** — 발행 창(08:00~22:00 KST)에 나간 글의 감사가 늦어도 한 간격 안에 판정되게.
 *    판정 대기 시한(`AUDIT_OVERDUE_HOURS`)은 이 간격의 여러 배다 — 한두 번 못 깨도 닫지 않고,
 *    러너가 죽었으면 같은 날 안에 닫는다. 마지막 회차(23:40)는 22:00 발행분을 판정한다.
 * 🔴 판정 대기가 0 이면 러너는 DB 를 한 번 읽고 끝난다 — 제공사 호출 0.
 * 🔴 맥이 자면 돌지 않는다(launchd 계약). 그 경우는 판정 대기 시한이 도장·발행을 닫는다.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { runnerPathValue, type RunnerPlistInput } from './original-post-runner-template'
import { AUDIT_OVERDUE_HOURS } from '../../src/lib/auto-ready-audit-store'

/** 🔴 깨우는 시각 하나 — 시·분만 (발행 슬롯의 건수 칸은 여기 없다) */
export type AuditSlot = { hour: number; minute: number }

export const AUDIT_RUNNER_LABEL = 'com.soransoran.auto-ready-audit'
export const AUDIT_RUNNER_SCRIPT = 'scripts/auto-ready-audit.mts'
/** 🔴 예약 실행은 기록한다(`--apply`). 그래도 스위치가 꺼져 있으면 표를 읽지 않고 끝난다 */
export const AUDIT_RUNNER_ARGS: readonly string[] = ['--apply']

export const AUDIT_WINDOW_START_MINUTE = 8 * 60 + 10
export const AUDIT_WINDOW_END_MINUTE = 23 * 60 + 40
export const AUDIT_INTERVAL_MINUTES = 30

/** 🔴 깨우는 시각 — 08:10 부터 23:40 까지 30분마다(32회). 손으로 적지 않고 창에서 만든다 */
export function auditRunnerSlots(): AuditSlot[] {
  const out: AuditSlot[] = []
  for (let m = AUDIT_WINDOW_START_MINUTE; m <= AUDIT_WINDOW_END_MINUTE; m += AUDIT_INTERVAL_MINUTES) {
    out.push({ hour: Math.floor(m / 60), minute: m % 60 })
  }
  return out
}

/**
 * 🔴 **슬롯 계약** — 비었거나, 창 안 간격이 판정 대기 시한의 1/4 을 넘거나, 발행 창 끝(22:00) 뒤
 *    회차가 없으면 문제다. 건강한 러너가 시한을 건드리지 않아야 시한이 "러너가 멈췄다" 는 뜻이 된다.
 */
export function verifyAuditSlots(slots: readonly AuditSlot[]): string[] {
  const problems: string[] = []
  if (slots.length === 0) return ['감사 러너 슬롯이 없다 — 예약이 사라졌다']
  const mins = slots.map((s) => s.hour * 60 + s.minute)
  for (let i = 1; i < mins.length; i += 1) {
    if (mins[i]! <= mins[i - 1]!) problems.push(`슬롯 순서가 어긋났다 (${i})`)
    if (mins[i]! - mins[i - 1]! > (AUDIT_OVERDUE_HOURS * 60) / 4) problems.push(`창 안 간격 ${mins[i]! - mins[i - 1]!}분 — 시한의 1/4 초과`)
  }
  if (Math.max(...mins) <= 22 * 60) problems.push('발행 창 끝(22:00) 뒤 감사 회차가 없다')
  if (Math.min(...mins) < 8 * 60) problems.push('08:00 전 슬롯이 있다 — 발행 창 밖에서 깨울 이유가 없다')
  return problems
}

export function renderAuditRunnerPlist(input: RunnerPlistInput): string {
  const args = [
    `        <string>${input.npxPath}</string>`,
    '        <string>tsx</string>',
    `        <string>${input.runtimeRoot}/${AUDIT_RUNNER_SCRIPT}</string>`,
    ...AUDIT_RUNNER_ARGS.map((a) => `        <string>${a}</string>`),
  ].join('\n')
  const slots = auditRunnerSlots().map((s) =>
    `        <dict><key>Hour</key><integer>${s.hour}</integer>`
    + `<key>Minute</key><integer>${s.minute}</integer></dict>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${AUDIT_RUNNER_LABEL}</string>
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
    <key>StandardOutPath</key><string>${input.logDir}/auto-ready-audit.log</string>
    <key>StandardErrorPath</key><string>${input.logDir}/auto-ready-audit-error.log</string>
    <key>RunAtLoad</key><false/>
</dict>
</plist>
`
}

/**
 * 🔴 **전용 잠금 파일** — 저장소 밖(운영 정본 env 와 같은 부모)이다. `collect-lock` 의 `wx` 잠금을 그대로 쓴다.
 *    쥔 채로 죽으면 자동으로 뺏지 않는다 — 다음 회차는 물러나고 사람이 치운다(판정 대기 시한이 그동안 닫는다).
 */
export function auditLockDir(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'soransoran', 'auto-ready-audit')
}
export const AUDIT_LOCK_FILE = 'audit.lock'
/** 🔴 잠금 나이 경고 기준 — 이보다 오래 쥐고 있으면 "죽은 잠금" 으로 알린다(뺏지는 않는다) */
export const AUDIT_LOCK_TTL_MS = 2 * 3600_000

/** 🔴 등록 절차 — 사람이 읽는 순서. 이 PR 은 하지 않는다 */
export const AUDIT_RUNNER_INSTALL_STEPS: readonly string[] = [
  '① 이 PR 은 등록하지 않는다 — 아래는 별도 승인 뒤의 순서다',
  '② runtime 을 배포하고 SHA 를 확인한다 — npm run runtime:isolation-check -- --require-runtime',
  '③ 의미 감사 유료 설정을 정한다 — SORAN_AUTO_READY_SEMANTIC_PAID=on · 감사 전용 예산 env 셋'
  + '(SORAN_AUDIT_LLM_DAILY_BUDGET_USD · SORAN_AUDIT_LLM_RUN_REQUEST_CAP · SORAN_AUDIT_LLM_RESERVE_HEADROOM) · ANTHROPIC_API_KEY (정본 env)',
  '      🔴 유료를 켜지 않으면 모든 감사가 재시도 가능 실패로 남고(결함 아님) 그동안 자동 회차가 닫힌다 · 러너는 exit 2',
  `④ plist 를 ~/Library/LaunchAgents/${AUDIT_RUNNER_LABEL}.plist 로 쓴다`,
  '⑤ plutil -lint 로 문법을 확인한다',
  '⑥ launchctl load 로 올리고 launchctl print 로 실제 경로가 runtime 인지 대조한다',
]
