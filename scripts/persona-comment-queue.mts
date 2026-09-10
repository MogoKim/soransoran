#!/usr/bin/env tsx
/**
 * 댓글 후보 **Queue 적재** — 🔴 기본은 계산만. provider 0 · DB write 0
 *
 * 🔴 **세 모드다** (2026-09-09 정정).
 *
 *    · `inspect` (기본)  실제 대상을 계산한다. provider 0 · DB write 0
 *    · `--call`          provider 를 부른다. 🔴 DB write 는 여전히 0
 *    · `--call --apply`  조건이 다 맞으면 `PENDING` 을 **오늘 예산까지** 만든다
 *
 *    `--apply` 단독은 실패다 — 부르지 않고 적재할 후보 텍스트가 없기 때문이다.
 *
 *    옛 판은 모드가 둘뿐이었고, 기본 회차의 planner 상한이 `0` 이라
 *    "무엇이 될지 본다" 는 회차가 **아무 대상도 계산하지 않았다.**
 *
 * 🔴 대상 선정·입력 구성·Gate 입력은 `materializeTargets` **한 곳**이 한다.
 *    shadow planner 와 같은 함수다 — 두 벌로 갈라져 다른 대상을 뽑던 것을 합쳤다.
 *
 * 사용법
 *   npm run persona:comment-queue                    대상 계산만
 *   npm run persona:comment-queue -- --call          provider 호출 (write 0)
 *   npm run persona:comment-queue -- --call --apply  🔴 PENDING 최대 1건
 */
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import type { Prisma } from '@prisma/client'

import { judgeModelGate } from '../src/lib/persona-comment-release'
import { judgeGateReport } from '../src/lib/persona-comment-gate-report'
import {
  judgeReadiness, windowFromRows, RATIO_WINDOW_DAYS,
} from '../src/lib/persona-comment-governor'
import { runEnqueuePipeline } from './lib/persona-comment-pipeline'
import {
  gateInputOf, materializeTargets, type GateContext,
} from './lib/persona-comment-targets'
import { makeDbTargetSource } from './lib/persona-comment-source-db'
import { bundlesForPersonas } from './lib/persona-reference-store.mjs'
import { buildPromptFromInput } from './lib/persona-comment-bridge'
import { checkCommentCandidate } from './lib/persona-comment-candidate.mjs'
import { parseCandidate } from './lib/persona-prompt'
import { callProvider, type ProviderModel } from './lib/voice-m3-provider.mjs'
import { readConfirmedSelection } from '../src/lib/persona-comment-provenance'
import { dedupKeyOf, OPEN_STATUSES } from '../src/lib/persona-comment-queue'
import { EVAL_ROOT } from './lib/persona-comment-eval-store'
import { MODEL_CANON_FILE } from '../src/lib/persona-comment-provenance'
import { judgeQueueFlags } from './lib/persona-comment-run-flags'
import { legacyRunModeFor, readCommentStage, stagePowers } from '../src/lib/persona-comment-stage'
import { countManagedPostsToday } from '../src/lib/persona-comment-bootstrap-source'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

/** 🔴 모드 판정은 순수 함수가 한다 — 스크립트 안의 `if` 는 fixture 가 볼 수 없다 */
const flags = judgeQueueFlags(process.argv)
if (!flags.ok) {
  console.error(`\n🔴 ${flags.reason}`)
  console.error('   기본(inspect): 대상 계산만 · provider 0 · DB write 0')
  console.error('   --call        : provider 호출 · DB write 0')
  console.error('   --call 과 --apply 함께: 조건 충족 시 PENDING 을 오늘 예산까지\n')
  process.exit(1)
}
const WANT_CALL = flags.providerAllowed
const WANT_APPLY = flags.writeAllowed
const MODE = flags.mode

/**
 * 🔴 **한 회차가 만들 수 있는 후보 상한.**
 *
 *    하루 예산이 500 이어도 한 번에 500 을 부르지 않는다 — 유료 호출이 한 회차에
 *    몰리면 실패했을 때 잃는 것도 한꺼번에 크다. 발행 배치 상한(`BATCH_MAX`)과 같은 25 다.
 */
const QUEUE_RUN_MAX = 25
/**
 * 🔴 **예산이 0 이어도 "무엇이 대상이 될지" 는 보여 준다.**
 *    inspect 회차 전용 상한이고, 이 경로는 provider 를 부르지 않는다.
 */
const PREVIEW_LIMIT = 5

await loadEnvLocal()
const prisma = new PrismaClient()

console.log('\n══ 댓글 후보 Queue 적재 ══\n')
/**
 * 🔴 **shadow 단계에서는 후보를 만들지 않는다** (2026-09-11 정정).
 *
 *    옛 판은 이 명령이 단계를 아예 읽지 않았다. 그래서 `SORAN_PERSONA_COMMENT_STAGE`
 *    가 비어 있는 shadow 상태에서도 `--call --apply` 가 provider 를 부르고
 *    PENDING 을 적재했다 — 실측으로 그렇게 1건이 들어갔다.
 *    "shadow 는 provider 0 · Queue write 0" 이라고 적어 두고 코드가 지키지 않으면
 *    그 문장은 계약이 아니라 장식이다.
 */
const stage = readCommentStage(process.env)
const powers = stagePowers(stage.stage)
console.log(`  단계  ${stage.stage} — ${stage.reason}`)
console.log(`  권한  후보 생성 ${powers.generateCandidates ? '가능' : '🔴 불가'}`
  + ` · 공개 ${powers.publishAllowed ? '가능' : '🔴 불가'}`
  + ` · ${powers.detail}`)
if (WANT_CALL && !powers.generateCandidates) {
  console.error(`\n🔴 중단: ${stage.stage} 단계는 후보를 만들지 않는다 (provider 0 · Queue write 0)`)
  console.error(`   후보를 만들려면 ${'SORAN_PERSONA_COMMENT_STAGE'}=bootstrap-review 로 올린다`)
  console.error('   🔴 이 값은 창업자가 바꾸는 것이다 — 스크립트가 바꾸지 않는다.\n')
  await prisma.$disconnect()
  process.exit(1)
}
console.log(`  모드  ${MODE} — provider ${WANT_CALL ? '호출 가능' : '0'}`
  + ` · DB write ${WANT_APPLY ? '예산까지' : '0'}`)

// ── 🔴 모델 확정 여부가 첫 관문이다. 정본은 worktree 밖 파일이다 ──
const canon = readConfirmedSelection()
const selection = canon.selection
const modelGate = judgeModelGate({ selection })
console.log(`  모델  ${selection?.status ?? '없음'} · winner ${selection?.winner ?? '(없음)'}`)
console.log(`        ${modelGate.reason}`)
console.log(`        정본  ${canon.detail}`)

if (!modelGate.canWriteQueue) {
  console.log('\n  🔴 모델이 확정되지 않았다 — 후보를 만들지도, 적재하지도 않는다.')
  console.log('     blind 표본을 사람이 채점한 뒤 winner 를 정본으로 옮긴다:')
  console.log(`       ${join(EVAL_ROOT, '<runId>', 'samples.json')} → key.json`)
  console.log(`       → ${MODEL_CANON_FILE} (runId · artifact SHA · winner · 채점자)`)
  console.log('\n  🔴 DB write 0 · provider 호출 0\n')
  await prisma.$disconnect()
  process.exit(0)
}

/**
 * 🔴 **적재 상한의 정본은 단계 예산이다** (2026-09-11).
 *
 *    옛 판은 `limit: WANT_APPLY ? 1 : 0` — **회차당 1건 고정**이었다.
 *    그 숫자는 "글당 Persona 댓글 1건" 계약과 함께 들어온 값이고,
 *    글 100편 × 자리 5개(=500)를 목표로 삼는 지금은 계약이 아니라 병목이다.
 *    상한은 `judgeBootstrapBudget`(bootstrap) · `judgeRatio`(organic) 하나가 정한다 —
 *    스크립트가 제 숫자를 지어내면 예산이 두 벌로 갈라진다.
 *
 * 🔴 이 블록은 **읽기만** 한다. write 0 · provider 0.
 */
const now = new Date()
const nowMs = now.getTime()
const windowMs = RATIO_WINDOW_DAYS * 86_400_000
const kstDayStart = new Date(
  Math.floor((nowMs + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000,
)
const commentWindow = await (async () => {
  try {
    return windowFromRows(await prisma.comment.findMany({
      where: { isDeleted: false, createdAt: { gte: new Date(nowMs - windowMs), lte: now } },
      select: { commentOrigin: true, personaId: true },
    }), RATIO_WINDOW_DAYS)
  } catch { return { measured: false, real: 0, persona: 0, windowDays: RATIO_WINDOW_DAYS } }
})()
const publishedToday = await prisma.comment.count({
  where: { isDeleted: false, commentOrigin: 'PERSONA', createdAt: { gte: kstDayStart } },
}).catch(() => null)
const killSwitchOff = await (async (): Promise<boolean | null> => {
  try {
    const r = await prisma.personaGlobalSwitch.findUnique({
      where: { id: 'global' }, select: { enabled: true },
    })
    return r === null ? true : !r.enabled
  } catch { return null }
})()
const managed = powers.budget === 'bootstrap'
  ? await countManagedPostsToday(prisma, kstDayStart, now)
  : null
const readiness = judgeReadiness({
  window: commentWindow,
  mode: legacyRunModeFor(stage.stage),
  stage: stage.stage,
  publishedToday,
  killSwitchOff,
  bootstrap: {
    openSlots: managed?.openSlots ?? Number.NaN, publishedToday, killSwitchOff,
  },
})
/** 🔴 유료 호출과 write 가 함께 묶이는 상한 */
const RUN_LIMIT = Math.min(QUEUE_RUN_MAX, readiness.allowance.remaining)
const TARGET_LIMIT = WANT_CALL ? RUN_LIMIT : PREVIEW_LIMIT
console.log(`  예산  ${powers.budget} — ${readiness.detail}`)
if (powers.budget === 'bootstrap') {
  console.log(`        관리형 공개 글 ${managed?.eligible ?? '🔴 읽지 못함'}편`
    + ` · 열린 댓글 자리 ${managed?.openSlots ?? '🔴 읽지 못함'}개`)
}
console.log(`  회차 상한  ${TARGET_LIMIT}건`
  + ` (하루 남은 ${readiness.allowance.remaining} · 회차 상한 ${QUEUE_RUN_MAX})`)

/**
 * 🔴 **대상은 공유 materializer 가 만든다.**
 *    글·Persona·생활사 축·열린 Queue·최근 역할·이전 발화·회원 표시명·
 *    코퍼스 빈도·seed 사용 횟수가 **한 경로**로 이어진다.
 */
const material = await materializeTargets({
  source: makeDbTargetSource({ prisma, windowStart: new Date(nowMs - windowMs) }),
  limit: TARGET_LIMIT,
  nowMs,
  windowMs,
})

console.log(`\n  공개 글 ${material.counts.posts}건 · Persona ${material.counts.personas}명`)
console.log(`  planner 선정 ${material.counts.planned}건 · 입력 생성 ${material.counts.built}건`)
console.log(`  열려 있는 Queue ${material.openDedupKeys.size}건 · 대상 글 ${material.openPostIds.size}건`
  + ` (${OPEN_STATUSES.join('/')})`)
console.log(`  Gate 입력  ${material.gateInputsComplete ? '완비' : '🔴 미완'}`)
console.log(`  최근 역할  ${material.recentRoleCounts === null
  ? '🔴 읽지 못했다 — 편중 방지를 신뢰할 수 없다'
  : `${Object.keys(material.recentRoleCounts).length}종`}`)
console.log(`  유료 호출  ${material.providerAllowed ? '가능' : '🔴 막힘 — provider 를 부르지 않는다'}`)
for (const b of material.providerBlockers) console.log(`     차단: ${b}`)
/**
 * 🔴 **말투 근거** (2026-09-10, Wave E). 자산이 있으면 강제하고, 없으면 끈다 —
 *    이 경로는 shadow·미리보기라 자산 부재로 멈추면 관제가 죽는다.
 *    유료 생성 경로(`persona-comment-eval` · `persona-comment-generate`)는 강제한다.
 */
const reference = bundlesForPersonas({
  repoRoot: process.cwd(),
  personaCodes: material.targets.map((x) => x.target.input.personaCode),
})
console.log(`  말투 근거  Persona ${reference.byCode.size}종`
  + (reference.blocks.length > 0 ? ` · 🟡 ${reference.blocks[0]}` : ''))

for (const t of material.targets) {
  if (t.gateReady) continue
  console.log(`     ${t.target.facts.personaCode} → 🔴 notRun 예정 ${t.willNotRun.join('·')}`)
}
for (const c of material.blockedInputs) console.log(`     입력 차단: ${c}`)

/**
 * 🔴 Gate 입력과 이전 발화를 **대상별로** 찾는다. 손으로 채우지 않는다 —
 *    옛 판은 `knownNames: []` · `seedUseCount: 1` 을 적어 넣어
 *    ②·⑥·⑧ 이 돌지 않은 채 9관문이 채워졌다.
 */
const ctxByKey = new Map<string, { gate: GateContext; recentTexts: readonly string[] }>(
  material.targets.map((t) => [
    dedupKeyOf(t.target.facts.postId, t.target.facts.personaCode, t.target.facts.reactionRole),
    { gate: t.gate, recentTexts: t.recentTexts },
  ]),
)
const ctxOf = (postId: string, personaCode: string, role: string): {
  gate: GateContext; recentTexts: readonly string[]
} | undefined => ctxByKey.get(dedupKeyOf(postId, personaCode, role))

const result = await runEnqueuePipeline({
  selection,
  canon: canon.canon,
  targets: material.targets.map((t) => t.target),
  /** 🔴 하나라도 막히면 파이프라인이 provider 앞에서 멈춘다 */
  preflightOk: material.providerAllowed,
  preflightBlockers: material.providerBlockers,
  provider: async ({ model, input }) => {
    const ctx = ctxOf(input.post.id, input.personaCode, input.reactionRole)
    if (ctx === undefined) return { ok: false, text: null, errorCode: 'NO_GATE_CONTEXT' }
    const prompt = buildPromptFromInput(input, ctx.recentTexts, reference.byCode.get(input.personaCode),
      { requireReference: reference.byCode.size > 0 })
    if (!prompt.ok) return { ok: false, text: null, errorCode: 'PROMPT_BLOCKED' }
    const res = await callProvider({
      model: model as ProviderModel,
      systemPrompt: prompt.prompt.systemPrompt,
      userPayload: prompt.prompt.userPayload,
      maxOutputTokens: prompt.prompt.maxOutputTokens,
      timeoutMs: 60_000,
    })
    if (!res.ok) return { ok: false, text: null, errorCode: res.errorCode }
    const parsed = parseCandidate(res.rawText)
    return parsed.ok
      ? { ok: true, text: parsed.text, errorCode: null }
      : { ok: false, text: null, errorCode: parsed.errorCode }
  },
  gate: ({ input, text }) => {
    const ctx = ctxOf(input.post.id, input.personaCode, input.reactionRole)
    if (ctx === undefined) {
      // 🔴 입력을 못 찾으면 통과시키지 않는다 — 빈 gates 는 planEnqueue 가 막는다
      return { gates: [], gateStatus: 'INPUT_CONTEXT_MISSING', isBootstrap: false }
    }
    const verdict = checkCommentCandidate(gateInputOf(ctx.gate, input, text))
    const report = judgeGateReport({ gates: verdict.gates, status: verdict.status })
    return {
      gates: verdict.gates.map((g) => ({ gate: g.gate, outcome: g.outcome })),
      gateStatus: verdict.status,
      // 🔴 호출자 주장이 아니라 Gate 모양으로 판정한다
      isBootstrap: report.missingRequired.length === 1 && report.missingRequired[0] === '⑧',
    }
  },
  ...(WANT_APPLY ? {
    writer: async ({ input, text, dedupKey, gates, gateStatus, provenance }) => {
      try {
        /**
         * 🔴 **중복은 unique constraint 가 가른다.**
         *    미리 `findUnique` 로 보고 쓰면 그 사이에 다른 회차가 넣을 수 있다.
         *    `create` 가 P2002 로 지는 쪽이 진 것이다 — 조회로 이기려 하지 않는다.
         */
        await prisma.personaApprovalQueue.create({
          data: {
            persona: { connect: { code: input.personaCode } },
            targetPostId: input.post.id,
            status: 'PENDING',
            candidateText: text,
            reactionType: input.reactionRole,
            gateStatus,
            gateResults: gates as unknown as Prisma.InputJsonValue,
            dedupKey,
            /**
             * 🔴 **생성 근거는 전용 칼럼에 쓴다** (마이그레이션 0024).
             *    옛 판은 `storyRefs`·`topicTags` 에 문자열로 끼워 넣었다 —
             *    그 두 칼럼은 사람이 편집하는 자리라, 편집 한 번이면
             *    "어느 모델이 만들었나" 가 사라지거나 위조된다.
             */
            generatedModel: provenance.model,
            canonRunId: provenance.canonRunId,
            canonDigest: provenance.canonDigest,
          },
        })
        return { created: true, reason: 'PENDING 적재' }
      } catch (e) {
        const code = (e as { code?: string }).code
        return {
          created: false,
          reason: code === 'P2002'
            ? '🔴 같은 dedupKey 가 이미 있다 — 다른 회차가 먼저 넣었다(fail-closed)'
            : `적재 실패 — ${code ?? 'UNKNOWN'}`,
        }
      }
    },
  } : {}),
  // 🔴 호출 상한과 write 상한은 다른 것이다. inspect 는 부르지 않는다
  providerCallLimit: WANT_CALL ? RUN_LIMIT : 0,
  limit: WANT_APPLY ? RUN_LIMIT : 0,
})

console.log(`\n  provider 호출 ${result.providerCalls}회 · 적재 ${result.created}건`)
if (result.stoppedReason !== null) console.log(`  멈춘 이유  ${result.stoppedReason}`)
for (const o of result.outcomes) console.log(`     ${o.personaCode} ${o.step} — ${o.reason}`)
console.log(`\n  🔴 이 회차 provider 호출 ${result.providerCalls}회 · DB write ${result.created}건\n`)
await prisma.$disconnect()
process.exit(0)
