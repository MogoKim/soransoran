#!/usr/bin/env tsx
/**
 * 🔴 **러너 복구 — 실패·누락 회차를 한 번 다시 깨운다**
 *
 *   npm run ops:recover              dry-run — 무엇을 깨울지 보여만 준다 (launchctl 변경 0)
 *   npm run ops:recover -- --apply   `launchctl kickstart`(실행 중이면 죽이지 않는다 · `-k` 없음) + 표식 기록
 *
 * 🔴 대상은 `RECOVERABLE_LABELS` 뿐이다 — 발행 · 공급 처리 · 감사 · 단계 controller · 댓글 러너(2026-10-11 · 슬롯 정책).
 *    수집 job 은 넣지 않는다(외부 source 요청 간격·일 상한은 영구 안전장치다).
 * 🔴 판정은 `judgeRecovery`(순수)가 한다 — 누락 기준은 관제 정본 `staleAfterFromSlots`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { judgeOrphanWake, judgeRecovery } from '../src/lib/runner-recovery'
import { FOLLOW_UP_FILE, followUpTriggerOf } from './lib/runner-lease.mjs'
import { EVENT_WAKE_ENV, WAKE_TARGETS, eventWakeModeOf, wakeAllowed } from './lib/runner-wake.mjs'
import { readEnvKeys } from './lib/ops-signals.mjs'
import { RECOVERABLE_LABELS, RECOVERY_POLICY_OF } from './lib/ops-loop-templates'
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

/**
 * 🔴 **고아 사건 깨움 표식** (2026-10-12 Batch C2) — 발행 뒤 깨움이 러너에 닿지 못하고 남은 follow-up 표식.
 *    대상은 사건 깨움이 있는 러너(지금은 댓글 러너 하나)뿐이다. 판정은 `judgeOrphanWake`(표식 하나에 최대 1회).
 *    🔴 다시 깨운 표식의 시각을 **kickstart 전에** 따로 적는다(`<label>.wake.json`) — kickstart 가 실패해도 같은 표식으로 반복하지 않는다.
 *       슬롯 복구 표식(`<label>.json`)과 섞지 않는다 — 섞으면 고아 깨움 하나가 그 슬롯 창의 누락 복구를 막는다.
 */
const WAKE_DIR_OF: Readonly<Record<string, string>> = { [WAKE_TARGETS.comment.label]: WAKE_TARGETS.comment.lockDir() }
const WAKE_ENABLED = wakeAllowed(eventWakeModeOf(readEnvKeys([EVENT_WAKE_ENV]).values).mode, 'comment')

function readWakeMarker(dir: string): { trigger: string | null; at: string | null } | null {
  const p = join(dir, FOLLOW_UP_FILE)
  if (!existsSync(p)) return null
  try { return followUpTriggerOf(readFileSync(p, 'utf-8')) } catch { return { trigger: null, at: null } }
}

function readHandledWake(label: string): string | null {
  const p = join(MARK_DIR, `${label}.wake.json`)
  if (!existsSync(p)) return null
  try { const v = (JSON.parse(readFileSync(p, 'utf-8')) as { wakeAt?: unknown }).wakeAt; return typeof v === 'string' ? v : 'unreadable' } catch { return 'unreadable' }
}

function writeHandledWake(label: string, wakeAt: string): void {
  mkdirSync(MARK_DIR, { recursive: true, mode: 0o700 })
  const p = join(MARK_DIR, `${label}.wake.json`)
  const tmp = `${p}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify({ wakeAt, at: NOW.toISOString() }, null, 2)}\n`, { mode: 0o600 })
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
    lastRecoveryAt: readMark(label), now: NOW, policy: RECOVERY_POLICY_OF[label] ?? 'stale',
  })
  console.log(`   ${v.action === 'kickstart' ? '🔁' : '·'} ${label.padEnd(40)} ${v.reason}`)
  // 🔴 고아 사건 표식 — 이번 틱에 슬롯 복구로 이미 깨우는 job 은 건드리지 않는다(한 틱에 kickstart 하나)
  const wakeDir = WAKE_DIR_OF[label]
  if (v.action !== 'kickstart' && wakeDir !== undefined) {
    const marker = readWakeMarker(wakeDir)
    const ow = judgeOrphanWake({ enabled: WAKE_ENABLED, state: o.state, running: o.run.running, marker, handledWakeAt: readHandledWake(label), now: NOW })
    console.log(`   ${ow.action === 'kickstart' ? '🔔' : '·'} ${`${label} (사건 깨움)`.padEnd(40)} ${ow.reason}`)
    if (ow.action === 'kickstart' && APPLY && marker?.at != null) {
      try {
        writeHandledWake(label, marker.at)
        execFileSync('launchctl', ['kickstart', `gui/${process.getuid?.() ?? 0}/${label}`], { stdio: 'ignore' })
        console.log('      → kickstart 보냈다(이 표식으로는 다시 깨우지 않는다)')
      } catch (e) {
        failed += 1
        console.log(`      🔴 kickstart 실패 — ${(e as Error).name} · 이 표식으로는 다시 깨우지 않는다(정기 회차가 받는다)`)
      }
    }
  }
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
