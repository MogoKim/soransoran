#!/usr/bin/env tsx
/**
 * 🔴 **무인 운영 한 화면 — read-only.** DB write 0 · launchctl 변경 0 · 네트워크 0 · provider 0
 *
 *    supply · publish(original-post-runner) · comment · audit 네 레인에 대해
 *      ① 최근 성공 시각과 그 근거   ② 최근 실패 시각과 이유
 *      ③ 그 job 이 도는 runtime SHA  ④ 오늘 비용 / 하루 상한
 *    을 한 번에 본다. 여기에 단계 결정(StageDecision)과 깨어 있기 상태를 덧붙인다.
 *
 * 🔴 **모르는 것은 모른다고 적는다.** 로그 시각은 "그 파일이 마지막으로 바뀐 때" 다 —
 *    회차 기록이 있는 레인(공급)만 회차 시각을 쓴다.
 *
 *   npm run ops:status            사람이 읽는 화면
 *   npm run ops:status -- --json  기계가 읽는 값
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { parseLaunchctlPrint } from '../src/lib/runtime-isolation'
import {
  OPS_LANES, laneHealth, lastFailureLine, judgeCost,
  type LaneStatus, type OpsLane, type CostVerdict,
} from '../src/lib/ops-status'
import { kstDateString } from '../src/lib/release-canary'
import { CONTROLLER_ENV } from '../src/lib/stage-decision-store'
import { readStageDecision } from '../src/lib/stage-decision-repo'
import { KEEP_AWAKE_LABEL, STAGE_CONTROLLER_LABEL } from './lib/ops-loop-templates'
import { observeJob, readProcessRuns, type JobObservation } from './lib/runner-health.mjs'
import { printJob } from './lib/launchd-observe.mjs'
import { LOG_DIR, fillDbConnection, readCostSignals, readEnvKeys, tailFile } from './lib/ops-signals.mjs'

const JSON_OUT = process.argv.slice(2).includes('--json')
const NOW = new Date()
const APP_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')

const LANE_LABEL: Readonly<Record<OpsLane, string>> = {
  supply: 'com.soransoran.supply-process',
  publish: 'com.soransoran.original-post-runner',
  comment: 'com.soransoran.persona-comment-runner',
  audit: 'com.soransoran.auto-ready-audit',
}
/** 로그 파일 이름 — plist 템플릿이 정한 이름 그대로 */
const LANE_LOG: Readonly<Record<OpsLane, string>> = {
  supply: 'supply-process', publish: 'original-post-runner',
  comment: 'persona-comment-runner', audit: 'auto-ready-audit',
}

const git = (cwd: string): string | null => {
  try { return execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}
const pinSha = ((): string | null => {
  const p = join(APP_DIR, 'runtime-pinned-sha')
  try { return existsSync(p) ? readFileSync(p, 'utf-8').trim() : null } catch { return null }
})()

function jobWord(o: JobObservation): LaneStatus['job'] {
  if (o.state === 'unknown') return 'unknown'
  if (o.state === 'loaded') return 'loaded'
  return o.installed ? 'unloaded' : 'notInstalled'
}

function runtimeShaOf(label: string, o: JobObservation): string | null {
  if (o.state !== 'loaded') return null
  const cfg = parseLaunchctlPrint(printJob(label).stdout)
  return cfg.workingDirectory === null ? null : git(cfg.workingDirectory)
}

/** 🔴 로그 기반 성공/실패 — 회차 기록이 없는 레인. 시각은 **파일이 바뀐 때**다 */
function fromLogs(lane: OpsLane, o: JobObservation): {
  successAt: string | null; successBasis: string; failureAt: string | null; failureReason: string | null
} {
  const out = tailFile(join(LOG_DIR, `${LANE_LOG[lane]}.log`))
  const err = tailFile(join(LOG_DIR, `${LANE_LOG[lane]}-error.log`))
  const lastExitOk = o.run.lastExitCode === 0
  const successAt = lastExitOk ? out.mtime : null
  const errLine = err.text.trim() === '' ? null : lastFailureLine(err.text)
  // 🔴 launchd 가 실패로 끝났다고 말하면 그 사실이 먼저다 — 오류 로그 줄은 이유로 붙인다
  if (o.run.lastExitCode !== null && o.run.lastExitCode !== 0) {
    return {
      successAt: null, successBasis: '마지막 회차가 실패로 끝났다',
      failureAt: err.mtime ?? out.mtime,
      failureReason: `exit ${o.run.lastExitCode}${errLine === null ? '' : ` — ${errLine}`}`,
    }
  }
  return {
    successAt,
    successBasis: lastExitOk ? 'launchd last exit 0 · 표준 출력 로그가 바뀐 시각' : 'launchd 에 끝난 회차가 없다(never exited)',
    // 🔴 오류 로그가 표준 출력보다 늦게 바뀌었으면 그 뒤에 실패가 있었다
    failureAt: err.mtime !== null && errLine !== null ? err.mtime : null,
    failureReason: errLine,
  }
}

async function main(): Promise<void> {
  const env = readEnvKeys([
    'SORAN_LLM_DAILY_BUDGET_USD', 'SORAN_LLM_RUN_REQUEST_CAP', 'SORAN_LLM_RESERVE_HEADROOM',
    'SORAN_AUDIT_LLM_DAILY_BUDGET_USD', 'SORAN_AUDIT_LLM_RUN_REQUEST_CAP', 'SORAN_AUDIT_LLM_RESERVE_HEADROOM',
    'SORAN_RELEASE_STAGE', 'SORAN_CAPACITY_STAGE', CONTROLLER_ENV,
  ])
  const cost = readCostSignals(NOW, env.values)
  const { runs } = readProcessRuns()

  // 🔴 DB 는 읽기만 — 최근 실제 발행·댓글 · 감사 판정 · 오늘 단계 결정
  const db: {
    ok: boolean; reason: string | null; lastPostAt: string | null; lastCommentAt: string | null
    lastAuditJudgedAt: string | null; stage: string
  } = { ok: false, reason: null, lastPostAt: null, lastCommentAt: null, lastAuditJudgedAt: null, stage: '(읽지 않음)' }
  if (fillDbConnection()) {
    const prisma = new PrismaClient()
    try {
      const post = await prisma.personaActivityLog.findFirst({ where: { kind: 'post', publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } })
      const cmt = await prisma.personaActivityLog.findFirst({ where: { kind: 'comment', publishedAt: { not: null } }, orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } })
      const aud = await prisma.autoReadyAudit.findFirst({ where: { judgedAt: { not: null } }, orderBy: { judgedAt: 'desc' }, select: { judgedAt: true } })
      const today = kstDateString(NOW)
      const sd = await readStageDecision(prisma, today)
      db.ok = true
      db.lastPostAt = post?.publishedAt?.toISOString() ?? null
      db.lastCommentAt = cmt?.publishedAt?.toISOString() ?? null
      db.lastAuditJudgedAt = aud?.judgedAt?.toISOString() ?? null
      db.stage = !sd.found ? `${today} 결정 없음`
        : sd.result.ok ? `${today} ${sd.result.decision.state} · 공개 ${sd.result.decision.release} · 천장 ${sd.result.decision.capacity}`
          : `🔴 ${today} 결정이 깨졌다 — ${sd.result.reason}`
    } catch (e) {
      db.reason = `DB 를 읽지 못했다 — ${(e as Error).name}`
    } finally { await prisma.$disconnect() }
  } else {
    db.reason = 'DATABASE_URL 이 없다 — 정본 env 를 찾지 못했다'
  }

  const lanes: LaneStatus[] = OPS_LANES.map((lane) => {
    const label = LANE_LABEL[lane]
    const o = observeJob(label)
    const notes: string[] = []
    let successAt: string | null
    let successBasis: string
    let failureAt: string | null
    let failureReason: string | null
    let runtimeSha = runtimeShaOf(label, o)
    if (lane === 'supply') {
      const done = runs.filter((r) => r.status === 'done')
      const failed = runs.filter((r) => r.status === 'failed')
      const lastDone = done[done.length - 1] ?? null
      const lastFailed = failed[failed.length - 1] ?? null
      successAt = lastDone?.completedAt ?? null
      successBasis = lastDone === null ? '끝난 회차 기록이 없다' : `회차 기록 ${lastDone.runId} done`
      failureAt = lastFailed?.startedAt ?? null
      failureReason = lastFailed === null ? null : `회차 ${lastFailed.runId} failed — ${lastFailed.failedStages.join(' · ') || '단계 기록 없음'}`
      const logs = fromLogs(lane, o)
      if (o.run.lastExitCode !== null && o.run.lastExitCode !== 0) {
        failureAt = logs.failureAt; failureReason = logs.failureReason
      }
      const last = runs[runs.length - 1]
      if (last?.runtimeSha) notes.push(`마지막 회차가 남긴 runtime SHA ${last.runtimeSha.slice(0, 12)}`)
      runtimeSha ??= last?.runtimeSha ?? null
    } else {
      const logs = fromLogs(lane, o)
      successAt = logs.successAt; successBasis = logs.successBasis
      failureAt = logs.failureAt; failureReason = logs.failureReason
    }
    if (lane === 'publish') notes.push(`마지막 실제 발행(DB) ${db.lastPostAt ?? (db.ok ? '없음' : '읽지 못함')}`)
    if (lane === 'comment') notes.push(`마지막 Persona 댓글(DB) ${db.lastCommentAt ?? (db.ok ? '없음' : '읽지 못함')}`)
    if (lane === 'audit') notes.push(`마지막 감사 판정(DB) ${db.lastAuditJudgedAt ?? (db.ok ? '없음' : '읽지 못함')}`)

    const laneCost: CostVerdict = lane === 'publish'
      ? judgeCost({ uses: false, tally: null, ledgerError: null, settleHold: null, capUsd: null })
      : lane === 'audit' ? cost.auditLedger : cost.supplyLedger
    if (lane === 'supply' || lane === 'comment') {
      notes.push(`🔴 공급·댓글은 장부와 하루 상한을 **공유**한다 — 그중 댓글 $${cost.commentSpentUsd?.toFixed(4) ?? '?'}`)
    }
    const partial: Omit<LaneStatus, 'health'> = {
      lane, label, job: jobWord(o), lastExitCode: o.run.lastExitCode, runs: o.run.runs,
      lastSuccessAt: successAt, lastSuccessBasis: successBasis,
      lastFailureAt: failureAt, lastFailureReason: failureReason,
      runtimeSha, cost: laneCost, notes,
    }
    return { ...partial, health: laneHealth(partial) }
  })

  const runtimeHead = git('/Users/yanadoo/Documents/soransoran-runtime')
  const keepAwake = observeJob(KEEP_AWAKE_LABEL)
  const assertions = ((): string | null => {
    try { return execFileSync('pmset', ['-g', 'assertions'], { encoding: 'utf-8' }) } catch { return null }
  })()
  const caffeinateHeld = assertions === null ? null : /caffeinate/.test(assertions)
  const controllerObs = observeJob(STAGE_CONTROLLER_LABEL)

  if (JSON_OUT) {
    console.log(JSON.stringify({
      at: NOW.toISOString(), runtime: { head: runtimeHead, pin: pinSha },
      lanes, db, stageController: { flag: env.values[CONTROLLER_ENV] ?? null, job: jobWord(controllerObs) },
      keepAwake: { job: jobWord(keepAwake), caffeinateAssertion: caffeinateHeld },
    }, null, 2))
    return
  }
  const mark = (h: string): string => (h === 'ok' ? '🟢' : h === 'bad' ? '🔴' : '⚪')
  const kst = (iso: string | null): string => {
    if (iso === null) return '—'
    return `${new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} KST`
  }
  console.log('\n══ 무인 운영 상태 (read-only · DB write 0 · launchctl 변경 0) ══')
  console.log(`   ${kst(NOW.toISOString())} · runtime HEAD ${runtimeHead?.slice(0, 12) ?? '(모름)'} · pin ${pinSha?.slice(0, 12) ?? '(모름)'}`
    + `${runtimeHead !== null && pinSha !== null && runtimeHead !== pinSha ? '  🔴 HEAD ≠ pin' : ''}`)
  for (const l of lanes) {
    console.log(`\n${mark(l.health)} ${l.lane.padEnd(8)} ${l.label}  [${l.job} · runs ${l.runs ?? '?'} · last exit ${l.lastExitCode ?? '—'}]`)
    console.log(`   최근 성공  ${kst(l.lastSuccessAt)}  (${l.lastSuccessBasis})`)
    console.log(`   최근 실패  ${kst(l.lastFailureAt)}${l.lastFailureReason === null ? '' : `  ${l.lastFailureReason}`}`)
    console.log(`   runtime   ${l.runtimeSha?.slice(0, 12) ?? '—'}${l.runtimeSha !== null && pinSha !== null && l.runtimeSha !== pinSha ? '  🔴 pin 과 다르다' : ''}`)
    const c = l.cost
    console.log(`   비용      ${c.spentUsd === null ? '?' : `$${c.spentUsd.toFixed(4)}`} / ${c.capUsd === null ? '상한 없음' : `$${c.capUsd.toFixed(2)}`}`
      + `${c.codes.length > 0 ? `  ${c.codes.join('·')}` : ''}`)
    for (const r of c.reasons) console.log(`             · ${r}`)
    for (const n of l.notes) console.log(`   · ${n}`)
  }
  console.log(`\n   단계 결정   ${db.ok ? db.stage : db.reason}`)
  console.log(`   단계 controller  flag ${CONTROLLER_ENV}=${env.values[CONTROLLER_ENV] ?? '(없음)'} · job ${jobWord(controllerObs)}`)
  console.log(`   깨어 있기   job ${jobWord(keepAwake)} · caffeinate assertion ${caffeinateHeld === null ? '?' : caffeinateHeld ? '있음' : '없음'}`)
  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · launchctl 변경 0 · provider 0\n')
}

await main()
