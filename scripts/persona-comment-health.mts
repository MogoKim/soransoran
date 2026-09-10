#!/usr/bin/env tsx
/**
 * 댓글 release 준비도 — 🔴 **read-only. DB write 0 · 네트워크 0 · 발행 0**
 *
 * 🔴 **화면과 JSON 이 같은 객체를 쓴다.**
 *    두 벌이면 한쪽만 고쳐지고, 사람이 보는 숫자와 도구가 읽는 숫자가 갈린다.
 *
 * 사용법
 *   npm run persona:comment-health
 *   npm run persona:comment-health -- --json
 */
import { PrismaClient } from '@prisma/client'

import {
  judgeRatio, judgeReadiness, readRunMode, windowFromRows,
  RATIO_WINDOW_DAYS, RELEASE_ENV_KEY, type CommentWindow,
} from '../src/lib/persona-comment-governor'
import {
  capabilitiesReady, judgeModelGate, judgeRelease,
  COMMENT_CAPABILITIES, type ModelSelection,
} from '../src/lib/persona-comment-release'
import { judgeGateReport } from '../src/lib/persona-comment-gate-report'
import { verifyProvenance } from '../src/lib/persona-comment-provenance'
import { readConfirmedSelection } from '../src/lib/persona-comment-provenance'
import { COMMENT_RUNNER_LABEL, readRunnerState } from './lib/persona-comment-runner-template'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const WANT_JSON = process.argv.includes('--json')

await loadEnvLocal()
const prisma = new PrismaClient()
const now = new Date()
const nowMs = now.getTime()
const windowStart = new Date(nowMs - RATIO_WINDOW_DAYS * 86_400_000)

// ── ① rolling 창 ──
const window: CommentWindow = await (async (): Promise<CommentWindow> => {
  try {
    const rows = await prisma.comment.findMany({
      where: { isDeleted: false, createdAt: { gte: windowStart, lte: now } },
      select: { commentOrigin: true, personaId: true },
    })
    return windowFromRows(rows, RATIO_WINDOW_DAYS)
  } catch {
    return { measured: false, real: 0, persona: 0, windowDays: RATIO_WINDOW_DAYS }
  }
})()

const kstDayStart = new Date(Math.floor((nowMs + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000)
const publishedToday = await prisma.comment.count({
  where: { isDeleted: false, commentOrigin: 'PERSONA', createdAt: { gte: kstDayStart } },
}).catch(() => null)
const killSwitchOff = await (async (): Promise<boolean | null> => {
  try {
    const row = await prisma.personaGlobalSwitch.findUnique({ where: { id: 'global' }, select: { enabled: true } })
    return row === null ? true : !row.enabled
  } catch { return null }
})()

/**
 * 🔴 **소스 문자열로 배선을 판정하지 않는다** (2026-09-09 정정).
 *    주석에 이름만 적어 둬도 통과했다. 지금은 코드가 스스로 선언한 capability 를 쓰고,
 *    그 선언이 참인지는 `persona:comment-engine-check` 가 행동으로 확인한다.
 */
const caps = capabilitiesReady(COMMENT_CAPABILITIES)

const mode = readRunMode(process.env)
const readiness = judgeReadiness({ window, mode: mode.mode, publishedToday, killSwitchOff })

// ── ② Queue 실측 ──
const queue = await (async (): Promise<{ pending: number; approved: number; published: number; declined: number } | null> => {
  try {
    const rows = await prisma.personaApprovalQueue.findMany({ select: { status: true } })
    const n = (s: string): number => rows.filter((r) => r.status === s).length
    return { pending: n('PENDING'), approved: n('APPROVED') + n('EDITED'), published: n('PUBLISHED'), declined: n('DECLINED') }
  } catch { return null }
})()

// ── ③ 모델 선택 — 🔴 **정본은 worktree 밖 파일이다.** gitignored tmp 를 근거로 쓰지 않는다 ──
const confirmed = readConfirmedSelection()
const selection: { value: ModelSelection | null; runId: string | null; note: string } = {
  value: confirmed.selection, runId: confirmed.canon?.runId ?? null, note: confirmed.detail,
}
const modelGate = judgeModelGate({ selection: selection.value })

// ── ④ runner/schedule — 🔴 **파일 존재만으로 판단하지 않는다** ──
//    plist 만 있고 unloaded 이거나 개발 트리를 가리키면 "등록됨" 이 아니다
const runner = readRunnerState()

/**
 * 🔴 **bootstrap 후보 수를 저장된 Gate 에서 센다.**
 *    Queue 행의 `gateResults` 를 읽어 "⑧ 만 notRun" 인 것을 고른다 —
 *    행 수만 세면 사람 승인 전용이 몇 건인지 알 수 없다.
 */
const bootstrapReviewCount = await (async (): Promise<number | null> => {
  try {
    const rows = await prisma.personaApprovalQueue.findMany({
      where: { status: { in: ['PENDING', 'APPROVED', 'EDITED'] } },
      select: { gateResults: true, gateStatus: true },
    })
    let boot = 0
    for (const r of rows) {
      const gates = Array.isArray(r.gateResults)
        ? (r.gateResults as unknown[]).filter(
          (g): g is { gate: string; outcome: string } =>
            g !== null && typeof g === 'object'
            && typeof (g as { gate?: unknown }).gate === 'string'
            && typeof (g as { outcome?: unknown }).outcome === 'string',
        )
        : []
      const report = judgeGateReport({ gates, status: r.gateStatus })
      if (report.missingRequired.length === 1 && report.missingRequired[0] === '⑧') boot += 1
    }
    return boot
  } catch { return null }
})()

/**
 * 🔴 **생성 근거 집계는 따로 센다** (2026-09-09 정정).
 *
 *    근거는 마이그레이션 0024 가 더한 전용 칼럼에 있다. 그 칼럼이 아직 없는 DB 에서
 *    한 쿼리로 묶어 읽으면 **bootstrap 집계까지 함께 죽는다** — 실제로 그랬다.
 *    읽을 수 있는 것과 없는 것을 갈라, 못 읽은 쪽만 "모른다" 로 남긴다.
 *
 * 🔴 못 읽었다고 안전한 쪽으로 보정하지 않는다. `null` 은 "세지 못했다" 다.
 */
const provenance = await (async (): Promise<{ missing: number | null; note: string }> => {
  try {
    const rows = await prisma.personaApprovalQueue.findMany({
      where: { status: { in: ['PENDING', 'APPROVED', 'EDITED'] } },
      // 🔴 생성 근거는 전용 칼럼에서 읽는다 — storyRefs/topicTags 는 사람이 편집하는 자리다
      select: { generatedModel: true, canonRunId: true, canonDigest: true },
    })
    let noProv = 0
    for (const r of rows) {
      /**
       * 🔴 **정본과 대조한다.** 모양만 보지 않는다 —
       *    옛 판은 접두사만 확인해서, 아무 문자열이나 적어 넣으면 통과했다.
       *    지금은 확정 정본의 runId·digest 와 같은지까지 본다.
       */
      const v = verifyProvenance({
        stored: r.canonRunId === null ? null : {
          model: r.generatedModel, canonRunId: r.canonRunId, canonDigest: r.canonDigest,
        },
        canon: confirmed.canon,
      })
      if (!v.ok) noProv += 1
    }
    return { missing: noProv, note: `${rows.length}건 중 ${noProv}건이 자동 공개 불가` }
  } catch {
    return {
      missing: null,
      note: '🔴 근거 칼럼을 읽지 못했다 — 마이그레이션 0024 미적용일 수 있다(자동 공개는 그대로 막힌다)',
    }
  }
})()
const noProvenanceCount = provenance.missing

// ── ⑤ 최근 성공/실패 ──
const lastActivity = await (async (): Promise<{ at: string; gateStatus: string | null } | null> => {
  try {
    const row = await prisma.personaActivityLog.findFirst({
      where: { kind: 'comment' }, orderBy: { createdAt: 'desc' },
      select: { createdAt: true, gateStatus: true },
    })
    return row === null ? null : { at: row.createdAt.toISOString(), gateStatus: row.gateStatus }
  } catch { return null }
})()

const release = judgeRelease({
  mode: mode.mode,
  // 🔴 **남은 수량**이다. 총 상한이 아니다 — 이름을 갈라 둔 이유가 이것이다
  publicAllowedToday: readiness.allowance.remaining,
  modelGate,
  approvedQueueCount: queue?.approved ?? 0,
  // 🔴 후보 단위 판정이 아니라 레인 수준 점검이므로 bootstrap 은 여기서 false 로 둔다.
  //    실제 발행 경로는 후보마다 `recheckBeforePublish` 가 다시 본다.
  isBootstrap: false,
  // 🔴 하드코딩하지 않는다. 실제 발행 함수가 재검사를 부르는지 **소스로 확인**한다 —
  //    앞선 판은 true 를 적어 두어, 배선이 빠져도 health 가 "연결됨" 이라고 말했다
  txRecheckWired: caps.ok,
  runnerRegistered: runner.healthy,
})

/** 🔴 화면과 JSON 이 **이 객체 하나**를 쓴다 */
const health = {
  ranAt: now.toISOString(),
  mode: mode.mode,
  modeReason: mode.reason,
  publicAllowedToday: readiness.allowance.remaining,
  allowance: readiness.allowance,
  shadowLimit: readiness.shadowLimit,
  window: { measured: window.measured, real: window.real, persona: window.persona, windowDays: window.windowDays },
  ratio: judgeRatio(window).reason,
  publishedToday,
  killSwitchOff,
  queue,
  approvedQueueCount: queue?.approved ?? 0,
  // 🔴 저장된 Gate 결과에서 **실제로** 센다. null 로 두면 "모른다" 인데 그럴 이유가 없다
  bootstrapReviewCount,
  // 🔴 provenance 가 없는 옛 후보는 자동 공개 불가다 — 그 수를 함께 낸다
  noProvenanceCount,
  noProvenanceNote: provenance.note,
  capabilities: { ...COMMENT_CAPABILITIES, ready: caps.ok, missing: caps.missing },
  model: {
    runId: selection.runId,
    status: selection.value?.status ?? null,
    winner: selection.value?.winner ?? null,
    canCallProvider: modelGate.canCallProvider,
    canWriteQueue: modelGate.canWriteQueue,
    reason: modelGate.reason === '' ? selection.note : modelGate.reason,
  },
  runner: {
    label: COMMENT_RUNNER_LABEL,
    // 🔴 tri-state 를 그대로 낸다 — "등록됨" 한 글자로 뭉개지 않는다
    plistPresent: runner.plistPresent,
    loaded: runner.loaded,
    pathsOk: runner.pathsOk,
    targetExists: runner.targetExists,
    registered: runner.healthy,
    detail: runner.detail,
  },
  lastActivity,
  release: {
    canPublishNow: release.canPublishNow,
    allowed: release.allowed,
    blockReason: release.blockers[0] ?? null,
    blockers: release.blockers,
    summary: release.summary,
  },
}

if (WANT_JSON) {
  console.log(JSON.stringify(health, null, 2))
} else {
  console.log('\n══ 댓글 release 준비도 (read-only · 발행 0) ══\n')
  console.log(`  실행 모드   ${health.mode} — ${health.modeReason}`)
  console.log(`  최근 ${RATIO_WINDOW_DAYS}일   실사용자 ${health.window.real} · Persona ${health.window.persona}`
    + `${health.window.measured ? '' : '  🔴 집계 실패'}`)
  console.log(`  ratio       ${health.ratio}`)
  console.log(`  오늘 공개 허용 남은 ${health.allowance.remaining}건`
    + ` (상한 ${health.allowance.cap} · 사용 ${health.allowance.used}) · shadow ${health.shadowLimit}건`)
  console.log(`  오늘 발행   ${health.publishedToday ?? '🔴 세지 못했다'}`
    + ` · kill switch ${health.killSwitchOff === null ? '🔴 읽지 못했다' : health.killSwitchOff ? '꺼짐' : '🔴 켜짐'}`)
  console.log(`  Queue       ${queue === null ? '🔴 읽지 못했다'
    : `PENDING ${queue.pending} · 승인 ${queue.approved} · 발행 ${queue.published} · 폐기 ${queue.declined}`}`)
  console.log(`  bootstrap   ${health.bootstrapReviewCount ?? '🔴 집계 실패'}건 (사람 승인 전용)`
    + ` · 근거 ${health.noProvenanceCount === null ? '' : `없음 ${health.noProvenanceCount}건 `}`
    + `(${health.noProvenanceNote})`)
  console.log(`  capability  ${caps.ok ? '전부 연결' : `🔴 빠짐 ${caps.missing.join(' · ')}`}`)
  console.log(`  모델        ${health.model.status ?? '없음'} · winner ${health.model.winner ?? '(없음)'}`)
  console.log(`              ${health.model.reason}`)
  console.log(`  runner      ${health.runner.label}`)
  console.log(`              ${health.runner.detail}`)
  console.log(`              plist ${health.runner.plistPresent ? '있음' : '없음'}`
    + ` · launchctl ${health.runner.loaded}`
    + ` · 경로 ${health.runner.pathsOk === null ? '(미확인)' : health.runner.pathsOk ? 'runtime' : '🔴 runtime 아님'}`
    + ` · 대상 파일 ${health.runner.targetExists ? '있음' : '🔴 없음'}`)
  console.log(`  최근 발행   ${health.lastActivity === null ? '없음' : `${health.lastActivity.at} (gate ${health.lastActivity.gateStatus ?? '?'})`}`)
  console.log(`\n  ${health.release.summary}`)
  for (const b of health.release.blockers) console.log(`     · ${b}`)
  console.log(`\n  🔴 ${RELEASE_ENV_KEY} 를 켜도 위 조건이 다 맞아야 공개된다`)
  console.log('  🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 발행 0\n')
}

await prisma.$disconnect()
process.exit(0)
