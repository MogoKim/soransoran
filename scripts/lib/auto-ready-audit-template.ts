/**
 * 자동 READY **독립 감사 러너 launchd 템플릿** — 🔴 문자열만 만든다. **등록하지 않는다** (2026-09-27)
 *
 * 🔴 등록(`~/Library/LaunchAgents` 에 두기 · `launchctl load`)은 되돌리기 어려운 쪽이라 별도 승인이다.
 *    이 파일은 파일을 쓰지 않는다. `launchd:template-check` 가 렌더 결과를 검사한다.
 *
 * 🔴 **왜 하루 전체 30분마다인가** (2026-11-23 · 옛 08:10~23:40 32회) — 발행 창이 하루 전체라, 언제 나간 글이든
 *    감사가 늦어도 한 간격 안에 판정되게. 새벽 글의 감사가 아침까지 밀려 판정 대기 시한을 넘기지 않고(넘기면 자동
 *    도장·발행이 닫힌다), 결정(01:50) 전에 한 번 다시 돈다(재시도 가능 실패 한 건이 그날 품질 신호를 굳히지 않는다).
 *    판정 대기 시한(`AUDIT_OVERDUE_HOURS`)은 이 간격의 여러 배다 — 한두 번 못 깨도 닫지 않고,
 *    러너가 죽었으면 같은 날 안에 닫는다.
 * 🔴 판정 대기가 0 이면 러너는 DB 를 한 번 읽고 끝난다 — 제공사 호출 0.
 * 🔴 맥이 자면 돌지 않는다(launchd 계약). 그 경우는 판정 대기 시한이 도장·발행을 닫는다.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { runnerPathValue, type RunnerPlistInput } from './original-post-runner-template'

/** 🔴 깨우는 시각 하나 — 시·분만 (발행 슬롯의 건수 칸은 여기 없다) */
export type AuditSlot = { hour: number; minute: number }

export const AUDIT_RUNNER_LABEL = 'com.soransoran.auto-ready-audit'
export const AUDIT_RUNNER_SCRIPT = 'scripts/auto-ready-audit.mts'
/** 🔴 예약 실행은 기록한다(`--apply`). 그래도 스위치가 꺼져 있으면 표를 읽지 않고 끝난다 */
export const AUDIT_RUNNER_ARGS: readonly string[] = ['--apply']

/** 🔴 깨는 간격(분) — 판정 대기 시한은 이 간격의 4배 이상이어야 한다(`auto-ready:audit-check`) */
export const AUDIT_INTERVAL_MINUTES = 30
/** 🔴 위상 — 매시 :10 · :40(옛 08:10 시작과 같은 위상 · 정시와 반 시 발행 틱에서 10분 뒤) */
export const AUDIT_PHASE_MINUTE = 10

const DAY_MINUTES = 24 * 60

/** 🔴 깨우는 시각 — 00:10 부터 23:40 까지 30분마다(48회). 손으로 적지 않고 간격 · 위상에서 만든다 */
export function auditRunnerSlots(): AuditSlot[] {
  const out: AuditSlot[] = []
  for (let m = AUDIT_PHASE_MINUTE; m < DAY_MINUTES; m += AUDIT_INTERVAL_MINUTES) {
    out.push({ hour: Math.floor(m / 60), minute: m % 60 })
  }
  return out
}

/**
 * 🔴 **슬롯 계약 — 하루 어느 30분에도 회차가 있다.** 비었거나, 순서가 어긋났거나, 자정을 넘는 마지막→첫 간격까지 세어
 *    한 간격(`AUDIT_INTERVAL_MINUTES`)보다 긴 틈이 있으면 문제다. 발행이 하루 전체라 감사가 비는 시간대가 없어야
 *    건강한 러너가 시한을 건드리지 않고, 시한이 "러너가 멈췄다" 는 뜻이 된다.
 */
export function verifyAuditSlots(slots: readonly AuditSlot[]): string[] {
  const problems: string[] = []
  if (slots.length === 0) return ['감사 러너 슬롯이 없다 — 예약이 사라졌다']
  const mins = slots.map((s) => s.hour * 60 + s.minute)
  const label = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  for (let i = 1; i < mins.length; i += 1) {
    if (mins[i]! <= mins[i - 1]!) problems.push(`슬롯 순서가 어긋났다 (${i})`)
  }
  const gaps = mins.map((m, i) => ({ from: m, gap: (i + 1 < mins.length ? mins[i + 1]! : mins[0]! + DAY_MINUTES) - m }))
  for (const g of gaps) {
    if (g.gap > AUDIT_INTERVAL_MINUTES) {
      problems.push(`${label(g.from)} 뒤 ${g.gap}분 동안 감사 회차가 없다 — 하루 어느 ${AUDIT_INTERVAL_MINUTES}분에도 회차가 있어야 한다(자정 포함)`)
    }
  }
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
  '      설치 뒤 템플릿(예약표)이 바뀌면 runtime:deploy 다음 npm run ops:loop-install -- --apply 가 새 원문으로 교체한다',
]
