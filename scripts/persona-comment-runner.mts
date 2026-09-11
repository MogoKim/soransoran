#!/usr/bin/env tsx
/**
 * 댓글 **runner** — 🔴 기본 shadow. 공개 write 는 release 조건이 전부 맞아야만
 *
 * 🔴 이 파일은 schedule 템플릿이 가리키는 실체다.
 *    템플릿이 없는 파일을 가리키면 등록하는 순간 조용히 실패한다 —
 *    launchd 는 실행 파일이 없어도 job 을 올리고, 로그에만 오류가 남는다.
 *
 * 🔴 세 모드
 *    · `inspect` — 준비도만 본다
 *    · `shadow`  — 판정까지. 공개 write 0
 *    · `release` — 🔴 조건이 **전부** 맞을 때만. 하나라도 빠지면 0 이다
 *
 * 🔴 이 PR 에서는 schedule 을 등록하지 않는다.
 */
import { PrismaClient } from '@prisma/client'

import {
  judgeReadiness, windowFromRows, RATIO_WINDOW_DAYS, type CommentWindow,
} from '../src/lib/persona-comment-governor'
import {
  capabilitiesReady, judgeModelGate, judgeRelease,
  COMMENT_CAPABILITIES, type ModelSelection,
} from '../src/lib/persona-comment-release'
import { readConfirmedSelection } from '../src/lib/persona-comment-provenance'
import { readRunnerState } from './lib/persona-comment-runner-template'
import { legacyRunModeFor, readCommentStage, stagePowers } from '../src/lib/persona-comment-stage'
import { countManagedPostsToday } from '../src/lib/persona-comment-bootstrap-source'
import { publishCandidateTx } from '../src/lib/persona-publish-tx'
import { batchSizeFor, publishBatch } from './lib/persona-comment-publish-batch'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

await loadEnvLocal()
const prisma = new PrismaClient()
const now = new Date()

console.log('\n══ 댓글 runner ══\n')

const windowStart = new Date(now.getTime() - RATIO_WINDOW_DAYS * 86_400_000)
const window: CommentWindow = await (async (): Promise<CommentWindow> => {
  try {
    return windowFromRows(await prisma.comment.findMany({
      where: { isDeleted: false, createdAt: { gte: windowStart, lte: now } },
      select: { commentOrigin: true, personaId: true },
    }), RATIO_WINDOW_DAYS)
  } catch { return { measured: false, real: 0, persona: 0, windowDays: RATIO_WINDOW_DAYS } }
})()
const kstDayStart = new Date(
  Math.floor((now.getTime() + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000,
)
const publishedToday = await prisma.comment.count({
  where: { isDeleted: false, commentOrigin: 'PERSONA', createdAt: { gte: kstDayStart } },
}).catch(() => null)
const killSwitchOff = await (async (): Promise<boolean | null> => {
  try {
    const r = await prisma.personaGlobalSwitch.findUnique({ where: { id: 'global' }, select: { enabled: true } })
    return r === null ? true : !r.enabled
  } catch { return null }
})()

/** 🔴 단계가 예산의 정본이다 — bootstrap 계열은 오늘 관리형 공개 글 수로 센다 */
const stage = readCommentStage(process.env)
const powers = stagePowers(stage.stage)
const managed = powers.budget === 'bootstrap'
  ? await countManagedPostsToday(prisma, kstDayStart, now)
  : null
const readiness = judgeReadiness({
  window, mode: legacyRunModeFor(stage.stage), stage: stage.stage, publishedToday, killSwitchOff,
  bootstrap: {
    openSlots: managed?.openSlots ?? Number.NaN, publishedToday, killSwitchOff,
  },
})
console.log(`  단계  ${stage.stage} — ${stage.reason}`)
console.log(`  예산  ${powers.budget}`
  + (powers.budget === 'bootstrap'
    ? ` · 관리형 공개 글 ${managed?.eligible ?? '🔴 읽지 못함'}편`
      + ` · 열린 댓글 자리 ${managed?.openSlots ?? '🔴 읽지 못함'}개`
    : ''))
const selection: ModelSelection | null = readConfirmedSelection().selection
const modelGate = judgeModelGate({ selection })
const approved = await prisma.personaApprovalQueue.count({
  where: { status: { in: ['APPROVED', 'EDITED'] }, publishedCommentId: null },
}).catch(() => 0)
const runner = readRunnerState()

/**
 * 🔴 **배선을 하드코딩하지 않는다** (2026-09-09 정정).
 *
 *    옛 판은 `txRecheckWired: true` 를 적어 두었다. 발행 함수에서 재검사가
 *    빠져도 runner 는 "연결됨" 이라고 말했고, 그 말은 아무것도 확인하지 않은 말이었다.
 *    지금은 코드가 스스로 선언한 capability 를 읽고,
 *    그 선언이 참인지는 `persona:comment-engine-check` 가 행동으로 확인한다.
 */
const caps = capabilitiesReady(COMMENT_CAPABILITIES)
const release = judgeRelease({
  stage: stage.stage,
  /** 🔴 runner 는 APPROVED/EDITED 만 발행한다 — 그것이 곧 사람 승인이다 */
  humanApproved: approved > 0,
  // 🔴 **남은 수량**이다. 총 상한이 아니다 — 이름을 갈라 둔 이유가 이것이다
  publicAllowedToday: readiness.allowance.remaining,
  modelGate,
  approvedQueueCount: approved,
  isBootstrap: false,
  txRecheckWired: caps.ok,
  runnerRegistered: runner.healthy,
})

console.log(`  공개 허용  남은 ${readiness.allowance.remaining}건`
  + ` (오늘 상한 ${readiness.allowance.cap} · 사용 ${readiness.allowance.used})`
  + ` · 승인 Queue ${approved}건`)
console.log(`  capability ${caps.ok ? '전부 연결' : `🔴 빠짐 ${caps.missing.join(' · ')}`}`)
console.log(`  모델       ${selection?.status ?? '없음'} · winner ${selection?.winner ?? '(없음)'}`)
console.log(`  runner     ${runner.detail}`)
console.log(`\n  ${release.summary}`)
for (const b of release.blockers) console.log(`     · ${b}`)

/**
 * 🔴 **canary dry-run — 무엇이 첫 번째로 나갈지 보여 준다** (2026-09-11).
 *
 *    "승인은 했는데 저게 정말 나가는 건가" 를 사람이 확인할 자리가 없었다.
 *    조건이 안 맞아 멈추는 회차에서도 **대상은 보여야** 한다 —
 *    그래야 무엇이 막고 있는지와 무엇이 기다리는지를 같이 볼 수 있다.
 *
 *    🔴 이 분기는 읽기만 한다. write 0 · provider 0.
 */
{
  const waiting = await prisma.personaApprovalQueue.findMany({
    where: { status: { in: ['APPROVED', 'EDITED'] }, publishedCommentId: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 3,
    select: {
      id: true, status: true, gateStatus: true, decidedBy: true,
      targetPostId: true, persona: { select: { code: true } },
    },
  }).catch(() => [])
  console.log(`\n  ── canary dry-run — 승인 대기 ${waiting.length}건 (🔴 읽기만 한다)`)
  for (const [i, w] of waiting.entries()) {
    console.log(`     ${i === 0 ? '🔵 다음 발행 대상' : '   대기'} ${w.id}`
      + ` · ${w.persona?.code ?? '?'} · ${w.status} · gate ${w.gateStatus}`
      + ` · 승인자 ${w.decidedBy === null ? '🔴 없음' : '있음'} · 글 ${w.targetPostId}`)
  }
  if (waiting.length === 0) console.log('     (없음)')
}

if (!release.canPublishNow) {
  // 🔴 조건이 맞지 않으면 후보를 만들지도, provider 를 부르지도 않는다
  console.log('\n  🔴 공개 조건 미충족 — provider 호출 0 · DB write 0 · 발행 0\n')
  await prisma.$disconnect()
  process.exit(0)
}

/**
 * 🔴 **여기부터가 공개 발행이다.**
 *
 *    승인된 후보를 **결정적으로** 고른다 — `createdAt` 오름차순으로,
 *    같으면 `id` 로. 무작위나 `findFirst` 기본 정렬은 회차마다 다른 것을 집어
 *    "왜 이게 나갔는지" 를 나중에 설명할 수 없게 만든다.
 *
 * 🔴 write 는 `publishCandidateTx` 하나만 쓴다 — server action·CLI 와 같은 함수다.
 *    이 파일은 **주체를 넘기지 않는다.** 그래서 `automation` 이고,
 *    bootstrap 후보는 그 판정에서 막힌다.
 */
/**
 * 🔴 **막힌 후보에서 회차가 끝나지 않게 한다** (2026-09-09 정정).
 *
 *    옛 판은 `take: release.allowed` 였다. 허용이 1건일 때 맨 앞 후보가
 *    provenance 없음·bootstrap·Gate 미달로 막히면, 뒤에 멀쩡한 후보가 있어도
 *    그 회차는 **0건 발행**으로 끝났다. 다음 회차도 같은 후보를 맨 앞에서 다시
 *    집으므로 사실상 영구히 막힌다.
 *
 *    그래서 **결정적으로 정렬된 유한 배치**를 읽고, 막힌 것은 건너뛰고 다음을 본다.
 *    성공이 허용치에 닿으면 즉시 멈춘다. 배치가 유한하므로 무한 루프는 없다.
 */
const batchSize = batchSizeFor(release.allowed)
const candidates = await prisma.personaApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, publishedCommentId: null },
  select: { id: true, personaId: true, targetPostId: true, createdAt: true },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  take: batchSize,
})
console.log(`\n  후보 배치 ${candidates.length}건 (허용 ${release.allowed}건 · 배치 상한 ${batchSize}건 · 결정적 정렬)`)

/** 🔴 진행 규칙은 `publishBatch` 하나가 한다 — 막힌 것은 건너뛰고 다음을 본다 */
const batch = await publishBatch({
  candidates,
  allowed: release.allowed,
  publish: async (c) => {
    // 🔴 actor 를 넘기지 않는다 = automation. bootstrap 은 트랜잭션이 막는다
    const r = await publishCandidateTx(prisma, { id: c.id, now })
    if (r.kind === 'published') {
      console.log(`     ✅ ${c.id.slice(0, 8)} → comment ${r.commentId.slice(0, 8)}`)
      return { outcome: 'published' as const, detail: r.commentId }
    }
    if (r.kind === 'blocked') {
      const why = r.blocks[0]?.message ?? '?'
      console.log(`     ⏭️  ${c.id.slice(0, 8)} 막힘 — ${why} (다음 후보를 본다)`)
      return { outcome: 'blocked' as const, detail: why }
    }
    console.log(`     ⏭️  ${c.id.slice(0, 8)} 오류 — ${r.message} (다음 후보를 본다)`)
    return { outcome: 'error' as const, detail: r.message }
  },
})
console.log(`\n  발행 ${batch.published}건 · 막힘 ${batch.blocked}건 · 시도 ${batch.attempted}건`)
if (batch.shortOfAllowed) {
  // 🔴 배치를 다 보고도 허용치를 못 채웠다 — 배치를 늘려 다시 읽지 않는다. 사실만 적는다
  console.log(`  🟡 허용 ${release.allowed}건 중 ${batch.published}건만 발행했다`
    + ` — 배치 ${candidates.length}건을 모두 보았고 나머지는 막혔다`)
}
console.log('  🔴 provider 호출 0 — runner 는 후보를 만들지 않는다(적재는 persona:comment-queue)\n')
await prisma.$disconnect()
process.exit(0)
