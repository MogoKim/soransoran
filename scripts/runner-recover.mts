#!/usr/bin/env tsx
/**
 * 🔴 **러너 복구 — 실패·누락 회차를 한 번 다시 깨운다**
 *
 *   npm run ops:recover              dry-run — 무엇을 깨울지 보여만 준다 (launchctl 변경 0)
 *   npm run ops:recover -- --apply   `launchctl kickstart`(실행 중이면 죽이지 않는다 · `-k` 없음) + 표식 기록
 *
 * 🔴 대상은 `RECOVERABLE_LABELS` 뿐이다 — 발행 · 공급 처리 · 감사 · 단계 controller.
 *    수집 job 은 넣지 않는다(외부 source 요청 간격·일 상한은 영구 안전장치다).
 * 🔴 판정은 `judgeRecovery`(순수)가 한다 — 누락 기준은 관제 정본 `staleAfterFromSlots`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { judgeRecovery } from '../src/lib/runner-recovery'
import { RECOVERABLE_LABELS } from './lib/ops-loop-templates'
import { observeJob, readProcessRuns } from './lib/runner-health.mjs'
import { AGENT_DIR, slotsOfPlist } from './lib/launchd-observe.mjs'
import { LOG_DIR, tailFile } from './lib/ops-signals.mjs'

const APPLY = process.argv.slice(2).includes('--apply')
const NOW = new Date()
const MARK_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'runner-recover')

/** 로그 파일 이름 = label 에서 `com.soransoran.` 을 뗀 것 (모든 템플릿의 규칙) */
const logOf = (label: string): string => join(LOG_DIR, `${label.replace(/^com\.soransoran\./, '')}.log`)

function lastRunAtOf(label: string): string | null {
  if (label === 'com.soransoran.supply-process') {
    const runs = readProcessRuns().runs
    return runs[runs.length - 1]?.startedAt ?? null
  }
  return tailFile(logOf(label), 1).mtime
}

function readMark(label: string): string | null {
  const p = join(MARK_DIR, `${label}.json`)
  if (!existsSync(p)) return null
  try { return String((JSON.parse(readFileSync(p, 'utf-8')) as { at?: unknown }).at ?? 'unreadable') } catch { return 'unreadable' }
}

function writeMark(label: string, reason: string): void {
  mkdirSync(MARK_DIR, { recursive: true, mode: 0o700 })
  const p = join(MARK_DIR, `${label}.json`)
  const tmp = `${p}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify({ at: NOW.toISOString(), reason }, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, p)
}

console.log(`\n══ 러너 복구 (${APPLY ? '--apply' : 'dry-run · launchctl 변경 0'}) ══`)
let failed = 0
for (const label of RECOVERABLE_LABELS) {
  const o = observeJob(label)
  const plist = join(AGENT_DIR, `${label}.plist`)
  const slots = existsSync(plist) ? slotsOfPlist(plist).map((s) => [s.hour, s.minute] as const) : []
  const v = judgeRecovery({
    label, recoverable: true, state: o.state, running: o.run.running,
    lastExitCode: o.run.lastExitCode, lastRunAt: lastRunAtOf(label), slots,
    lastRecoveryAt: readMark(label), now: NOW,
  })
  console.log(`   ${v.action === 'kickstart' ? '🔁' : '·'} ${label.padEnd(40)} ${v.reason}`)
  if (v.action !== 'kickstart' || !APPLY) continue
  try {
    // 🔴 표식을 **먼저** 남긴다 — kickstart 뒤에 죽어도 다음 회차가 같은 창에서 반복하지 않는다
    writeMark(label, v.reason)
    execFileSync('launchctl', ['kickstart', `gui/${process.getuid?.() ?? 0}/${label}`], { stdio: 'ignore' })
    console.log('      → kickstart 보냈다')
  } catch (e) {
    failed += 1
    console.log(`      🔴 kickstart 실패 — ${(e as Error).name}`)
  }
}
console.log('')
process.exit(failed > 0 ? 1 : 0)
