#!/usr/bin/env tsx
/**
 * 작업 묶음 검사 — 🔴 **backlog 전체를 판정하지 않는다**는 계약을 값으로 본다 (2026-09-20)
 *
 * 🔴 2026-09-20 canary 실측을 그대로 세운다: adapt 가 backlog 를 609건으로 펼쳤고
 *    `judge` 가 공동 상한 15회를 전부 써 `draft` 는 0회였다. 후보 0건에 $0.029949.
 *
 * 🔴 **provider 를 부르지 않는다 · DB 를 읽지 않는다 · 파일을 쓰지 않는다.**
 *    순수 함수와 실제 소스 문자열만 본다.
 */
import { readFileSync } from 'node:fs'

import {
  artifactOutcome, baseIdOf, judgementOutcome, judgeStageBudget, readWorkset, selectWorkset,
  concludedSourceIds, attemptedOutcomes, latestOutcomes, parseInstantMs,
  OUTCOME_STATES, CONCLUDED_STATES, STAGE_RANK, WORKSET_RETRY_RESERVE, WORKSET_RETRY_STARVE_MS,
  type PriorArtifactRow, type PriorJudgementRow, type PriorOutcome,
  WORKSET_DEFAULT_LIMIT, WORKSET_KIND, WORKSET_STAGE_PER_SOURCE, WORKSET_TOTAL_PER_SOURCE,
  WORKSET_VERSION, worksetFileName, type WorksetRow,
} from '../src/lib/supply-workset'
import {
  ledgerRunIdOf, planBoundedCommonPhase, planCommonPhase, type Pending,
} from '../src/lib/supply-process'
import {
  AUTO_DECISIONS, holdBeforeAsking, mergeJudgeRows, PROVEN_LANES, SEED_AXIS,
} from '../src/lib/micro-seed-auto-judge'
import { ARTIFACT_VERSION } from '../src/lib/content-core/artifact'
import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION, STAGE_MAX_OUTPUT_LABEL, STAGE_MODEL,
  type GenerationContract,
} from '../src/lib/content-core/pipeline'
import {
  LIFE_CONTRACT_FIELDS, SPEAKER_PLAN_VERSION, orderPersonasForSource,
} from '../src/lib/content-core/speaker'
import { personaInputOf, personaPoolIdentity } from './lib/content-core-run.mjs'
import {
  buildSpeakerPlanPayload, buildSpeakerPlanSystemPrompt,
} from './lib/content-core-prompts.mjs'
import { buildEvidencePacket } from '../src/lib/content-core/evidence'
import type { PoolCard } from '../src/lib/persona-pool-card'
import {
  artifactRetryable, reviewShapeOk, DIRECT_REASONS, INCOMPLETE_CAUSES, NOT_RUN_CAUSES,
  RETRYABLE_CAUSES, REVIEW_VERSION,
} from '../src/lib/content-core/review'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** 🔴 정본 정규화를 지난 행 하나 — fixture 도 손으로 조립하지 않는다 */
const ROW = (o: {
  sourceArticleId: string; commentCount?: number
  sourcePostedAt?: string; sourceListedAt?: string
  access?: string; safetyVerdict?: string; axis?: string; title?: string
}): WorksetRow => {
  const [input] = mergeJudgeRows([{
    kind: 'detail',
    row: {
      sourceArticleId: o.sourceArticleId, title: o.title ?? '제목입니다 우리 이야기',
      bodyHead: '본문 머리 300자 가운데 일부입니다. 사람들이 반응한 이야기입니다.',
      // 🔴 정본이 인정하는 축만 통과한다 — fixture 도 실제 값을 쓴다
      commentCount: o.commentCount ?? 0, axis: o.axis ?? SEED_AXIS,
      access: o.access ?? 'ok', safetyVerdict: o.safetyVerdict ?? 'pass',
      // 🔴 실증된 lane 이어야 판정까지 간다 — 아니면 묻기 전에 HOLD 다
      lane: PROVEN_LANES[0] ?? '', assetAxes: '', safetyReasons: '', bodyLength: 300,
      qualityFlags: [],
    },
  }])
  return {
    sourceArticleId: o.sourceArticleId, sourceSite: 'navercafe:wgang',
    commentCount: o.commentCount ?? 0,
    sourcePostedAt: o.sourcePostedAt ?? '', sourceListedAt: o.sourceListedAt ?? '',
    input: input!,
  }
}
const NOW = new Date('2026-09-20T12:00:00Z')
const RUN = '20260920-120000'
/**
 * 🔴 이미 본 원천은 **언제 봤는지**가 함께 필요하다 — 오래 기다린 것부터 집기 때문이다.
 *    문자열만 주면 `NOW` 직전에 본 것으로 둔다.
 */
const attemptedMap = (
  v: readonly string[] | Readonly<Record<string, string>>,
): Map<string, PriorOutcome> => {
  const pairs = Array.isArray(v)
    ? v.map((id) => [id, '2026-09-20T11:00:00.000Z'] as const)
    : Object.entries(v as Record<string, string>)
  return new Map(pairs.map(([id, at]) => [id, {
    sourceArticleId: id, atMs: Date.parse(at), stage: 'judge' as const, state: 'retryable' as const,
  }]))
}
const sel = (o: {
  rows: readonly WorksetRow[]
  humanDecided?: readonly string[]
  queuePending?: readonly string[]
  concluded?: readonly string[]
  attempted?: readonly string[] | Readonly<Record<string, string>>
  limit?: number
  takenAt?: Date
}) => selectWorkset({
  rows: o.rows,
  humanDecided: new Set(o.humanDecided ?? []),
  queuePending: new Set(o.queuePending ?? []),
  concluded: new Set(o.concluded ?? []),
  attempted: attemptedMap(o.attempted ?? []),
  limit: o.limit ?? 5, runId: RUN, takenAt: o.takenAt ?? NOW,
})

// ─────────────────────────────────────────────────────────
console.log('\n① 🔴 🔴 adapt 가 backlog 를 펼쳐도 묶음은 5건이다 (canary 재현)')
// ─────────────────────────────────────────────────────────
{
  /** 🔴 adapt 전에는 판정할 것이 없었고, adapt 뒤에 609건이 생겼다 */
  const before: WorksetRow[] = []
  const after = Array.from({ length: 609 }, (_, i) =>
    ROW({ sourceArticleId: `s${String(i).padStart(4, '0')}`, commentCount: i % 40 }))

  check('🔴 adapt 전에는 고를 것이 없다', sel({ rows: before }).picked.length === 0)
  const p = sel({ rows: after })
  check('🔴 🔴 **adapt 뒤 609건이어도 묶음은 정확히 5건이다**', p.picked.length === 5, `${p.picked.length}건`)
  check('🔴 🔴 **나머지 604건은 그대로 남는다** — 판정·삭제·완료 처리 0',
    p.deferred === 604, `${p.deferred}건`)
  check('🔴 manifest 에 그 5건만 적힌다',
    p.workset.sourceIds.length === 5 && p.workset.limit === 5
    && p.workset.kind === WORKSET_KIND && p.workset.version === WORKSET_VERSION)
  check('🔴 회차 id 가 묶음에 묶인다', p.workset.runId === RUN)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 단계별 상한 — 앞 단계가 뒤 단계를 굶기지 못한다')
// ─────────────────────────────────────────────────────────
{
  const b = judgeStageBudget(5)
  check('🔴 🔴 **judge 최대 5회**', b.ok && b.perStage.judge === 5, b.ok ? '' : b.reason)
  check('🔴 🔴 **draft 에 15회가 보장된다**', b.ok && b.perStage.draft === 15)
  check('🔴 🔴 **회차 전체 최대 20회**', b.ok && b.total === 20)
  check('🔴 판정 1 · 생성 3 · 전체 4 (원천당)',
    WORKSET_STAGE_PER_SOURCE.judge === 1 && WORKSET_STAGE_PER_SOURCE.draft === 3
    && WORKSET_TOTAL_PER_SOURCE === 4)
  check('🔴 기본 묶음 크기는 5다', WORKSET_DEFAULT_LIMIT === 5)
  for (const bad of [0, -1, 2.5, Number.NaN]) {
    check(`🔴 상한이 ${String(bad)} 이면 거부한다`, judgeStageBudget(bad).ok === false)
  }
  check('🔴 🔴 **단계 합이 전체를 넘으면 실행 전에 거부한다**',
    WORKSET_STAGE_PER_SOURCE.judge + WORKSET_STAGE_PER_SOURCE.draft <= WORKSET_TOTAL_PER_SOURCE)
  check('🔴 🔴 **장부 회차 id 만 단계별로 다르다** — 파이프라인 id 는 하나다',
    ledgerRunIdOf(RUN, 'judge') !== ledgerRunIdOf(RUN, 'draft')
    && ledgerRunIdOf(RUN, 'judge') === `${RUN}-j`
    && ledgerRunIdOf(RUN, 'draft') === `${RUN}-d`)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 고르기 전에 빼는 것 — AI 호출 전이다')
// ─────────────────────────────────────────────────────────
{
  const rows = [
    ROW({ sourceArticleId: 'a1', commentCount: 99 }),
    ROW({ sourceArticleId: 'b2', commentCount: 98 }),
    ROW({ sourceArticleId: 'c3#2', commentCount: 97 }),
    ROW({ sourceArticleId: 'd4', commentCount: 96 }),
    ROW({ sourceArticleId: 'e5', commentCount: 95, access: 'blocked' }),
    ROW({ sourceArticleId: 'f6', commentCount: 94, safetyVerdict: 'review' }),
    ROW({ sourceArticleId: 'g7', commentCount: 93 }),
  ]
  const p = sel({ rows, humanDecided: ['a1'], queuePending: ['c3'], concluded: ['b2'], limit: 5 })
  const ids = p.workset.sourceIds
  check('🔴 사람이 이미 판정한 원천은 빠진다', !ids.includes('a1') && p.dropped.humanDecided === 1)
  check('🔴 🔴 **같은 원문의 Queue 형제는 AI 호출 전에 빠진다**',
    !ids.includes('c3#2') && p.dropped.queueSibling === 1)
  check('🔴 🔴 **앞 회차가 끝낸 원천은 빠진다** — 다음 회차를 굶기지 않는다',
    !ids.includes('b2') && p.dropped.terminal === 1)
  check('🔴 🔴 **접근·안전은 판정기 정본 게이트가 거른다**',
    !ids.includes('e5') && !ids.includes('f6') && p.dropped.preGated === 2)
  check('🟢 남은 둘만 고른다', ids.length === 2 && ids.includes('d4') && ids.includes('g7'))
  check('🔴 형제 판정은 `#` 앞을 본다', baseIdOf('c3#2') === 'c3' && baseIdOf('c3') === 'c3')
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 순서 — 지금 있는 신호만 쓴다')
// ─────────────────────────────────────────────────────────
{
  const rows = [
    ROW({ sourceArticleId: 'low', commentCount: 1, sourcePostedAt: '2026-09-20T00:00:00Z' }),
    ROW({ sourceArticleId: 'high', commentCount: 40, sourcePostedAt: '2026-09-01T00:00:00Z' }),
    ROW({ sourceArticleId: 'mid-new', commentCount: 10, sourcePostedAt: '2026-09-19T00:00:00Z' }),
    ROW({ sourceArticleId: 'mid-old', commentCount: 10, sourcePostedAt: '2026-09-02T00:00:00Z' }),
  ]
  const ids = sel({ rows, limit: 4 }).workset.sourceIds
  check('🔴 🔴 **댓글 수가 먼저다**', ids[0] === 'high', ids.join(','))
  check('🔴 같은 댓글 수면 최신이 먼저다', ids[1] === 'mid-new' && ids[2] === 'mid-old')
  check('🔴 목록에서 본 시각도 쓴다 (작성 시각이 없을 때)', (() => {
    const two = sel({
      rows: [
        ROW({ sourceArticleId: 'x', commentCount: 5, sourceListedAt: '2026-09-01T00:00:00Z' }),
        ROW({ sourceArticleId: 'y', commentCount: 5, sourceListedAt: '2026-09-19T00:00:00Z' }),
      ], limit: 2,
    }).workset.sourceIds
    return two[0] === 'y'
  })())
  check('🔴 같은 값이면 id 오름차순 — 같은 입력이면 같은 결과다', (() => {
    const a = sel({ rows: [ROW({ sourceArticleId: 'b' }), ROW({ sourceArticleId: 'a' })], limit: 2 })
    const b = sel({ rows: [ROW({ sourceArticleId: 'a' }), ROW({ sourceArticleId: 'b' })], limit: 2 })
    return a.workset.sourceIds.join(',') === b.workset.sourceIds.join(',')
      && a.workset.sourceIds[0] === 'a'
  })())
  check('🔴 같은 원천이 여러 파일에 있으면 마지막 행이 이긴다', (() => {
    const p = sel({
      rows: [ROW({ sourceArticleId: 'dup', commentCount: 1 }), ROW({ sourceArticleId: 'dup', commentCount: 50 })],
      limit: 5,
    })
    return p.picked.length === 1 && p.picked[0]!.commentCount === 50
  })())
  check('🔴 🔴 **새 AI 점수·낱말 사전을 쓰지 않는다**', (() => {
    const src = readFileSync('src/lib/supply-workset.ts', 'utf-8')
    return !/fetch\(|callProvider|KEYWORD|키워드 사전|score\s*\+=/.test(src)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 manifest 는 fail-closed 로 읽는다')
// ─────────────────────────────────────────────────────────
{
  const good = sel({ rows: [ROW({ sourceArticleId: 'k1' })], limit: 5 }).workset
  check('🟢 정상 manifest 는 읽힌다', readWorkset(good, RUN).ok)
  check('🔴 다른 회차 파일은 거부한다', (() => {
    const v = readWorkset(good, 'other-run')
    return !v.ok && v.code === 'RUN_MISMATCH'
  })())
  check('🔴 다른 종류 파일은 거부한다', (() => {
    const v = readWorkset({ ...good, kind: 'something' }, RUN)
    return !v.ok && v.code === 'KIND'
  })())
  check('🔴 옛 판은 거부한다', (() => {
    const v = readWorkset({ ...good, version: 'workset-v0' }, RUN)
    return !v.ok && v.code === 'VERSION'
  })())
  check('🔴 🔴 **상한을 넘겨 적힌 파일은 거부한다**', (() => {
    const v = readWorkset({ ...good, limit: 2, sourceIds: ['a', 'b', 'c'] }, RUN)
    return !v.ok && v.code === 'OVER_LIMIT'
  })())
  for (const bad of [null, 'text', 42, { kind: WORKSET_KIND }]) {
    check(`🔴 모양이 다르면 거부한다 (${JSON.stringify(bad)})`, readWorkset(bad, RUN).ok === false)
  }
  check('🔴 파일 이름이 회차에 묶인다', worksetFileName(RUN) === `supply-workset-${RUN}.json`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 세 단계가 같은 묶음을 본다 — 과거 파일을 다시 훑지 않는다')
// ─────────────────────────────────────────────────────────
{
  const pending: Pending = {
    rawCafe: {}, thin: {},
    detail: ['a.detail.jsonl'],
    shadow: ['old-1.shadow.jsonl', 'old-2.shadow.jsonl'],
    candidates: ['auto-draft-old.candidates.json'],
  }
  const policy = { llm: true, fill: true, upTo: 698, reason: '' }
  const gate = { kind: 'ready' as const, snapshotPath: '/d/snap.json', runId: RUN }
  const ws = {
    manifestPath: '/d/ws.json', shadowPath: '/d/new.shadow.jsonl',
    candidatesPath: '/d/new.candidates.json', limit: 5,
    perStage: { judge: 5, draft: 15 },
  }
  const plans = planBoundedCommonPhase(pending, policy, gate, ws)
  const of = (st: string): typeof plans[number] | undefined => plans.find((p) => p.stage === st)

  check('🔴 🔴 **judge 가 묶음 파일만 본다**',
    of('judge')?.args.includes('--workset=/d/ws.json') === true)
  check('🔴 🔴 **judge 판정 파일 경로를 회차가 정한다**',
    of('judge')?.args.includes('--shadow-out=/d/new.shadow.jsonl') === true)
  check('🔴 🔴 **draft 가 그 회차 shadow 만 읽는다** — 과거 2개를 훑지 않는다',
    of('draft')?.args.includes('--input=/d/new.shadow.jsonl') === true)
  check('🔴 🔴 **fill 이 그 회차 candidates 만 읽는다** — 과거 후보 파일은 대상이 아니다',
    of('fill')?.args.includes('--input=/d/new.candidates.json') === true)
  check('🔴 🔴 **fill 은 정확히 묶음 크기까지만** — 캐시 hit 으로 늘어도 5건',
    of('fill')?.args.includes('--up-to=5') === true, of('fill')?.args.join(' '))
  check('🔴 🔴 **단계마다 자기 요청 상한을 받는다**',
    of('judge')?.env?.SORAN_LLM_RUN_REQUEST_CAP === '5'
    && of('draft')?.env?.SORAN_LLM_RUN_REQUEST_CAP === '15')
  check('🔴 🔴 **파이프라인 id 는 세 단계가 같다** — 묶음·스냅샷·산출물이 이어진다',
    of('judge')?.args.includes(`--run-id=${RUN}`) === true
    && of('draft')?.args.includes(`--run-id=${RUN}`) === true)
  check('🔴 🔴 **장부 id 만 j/d 로 갈린다**',
    of('judge')?.args.includes(`--ledger-run-id=${ledgerRunIdOf(RUN, 'judge')}`) === true
    && of('draft')?.args.includes(`--ledger-run-id=${ledgerRunIdOf(RUN, 'draft')}`) === true)
  check('🔴 🔴 **생성기가 받는 --run-id 가 큐 스냅샷 회차와 같다** — RUN_MISMATCH 가 없다',
    of('draft')?.args.includes(`--run-id=${gate.runId}`) === true)
  check('🔴 draft 는 큐 스냅샷을 계속 요구한다',
    of('draft')?.args.includes('--require-queue-snapshot') === true)
  check('🟢 🔴 **손으로 부르는 경로는 묶음을 쓰지 않는다** — 함수가 다르다', (() => {
    const old = planCommonPhase(pending, policy, gate)
    const j = old.find((p) => p.stage === 'judge')
    const f = old.find((p) => p.stage === 'fill')
    return j?.args.some((a) => a.startsWith('--workset=')) === false
      && j?.args.some((a) => a.startsWith('--ledger-run-id=')) === false
      && j?.env === undefined
      && f?.args.includes('--up-to=698') === true
  })())
  check('🔴 🔴 **live 경로는 묶음을 반드시 받는다** — 타입이 강제한다', (() => {
    const src = readFileSync('src/lib/supply-process.ts', 'utf-8')
    return /planBoundedCommonPhase\([\s\S]{0,200}workset: WorksetGate,\n\): StagePlan\[\]/.test(src)
      && !/planBoundedCommonPhase[\s\S]{0,200}workset\?:/.test(src)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 배선이 실제로 그렇게 돼 있는가')
// ─────────────────────────────────────────────────────────
{
  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  const judge = readFileSync('scripts/micro-seed-auto-judge.mts', 'utf-8')
  const draft = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')

  check('🔴 🔴 **묶음을 adapt 뒤·공통 단계 계획 앞에서 고른다**', (() => {
    // 🔴 import 줄이 아니라 **호출 자리**를 본다
    const call = runner.indexOf('const plan = selectWorkset({')
    const adapt = runner.indexOf('const phase1 = await runSourcePhase')
    const plan = runner.indexOf('planBoundedCommonPhase(after1')
    return adapt > 0 && call > adapt && plan > call
  })())
  check('🔴 🔴 **상한이 잘못되면 실행 전에 멈춘다**',
    /const budget = judgeStageBudget\(WORKSET_LIMIT\)[\s\S]{0,120}if \(!budget\.ok\)[\s\S]{0,120}return 1/.test(runner))
  check('🔴 단계 env 는 자식 프로세스에만 실린다',
    /env: \{ \.\.\.process\.env, \.\.\.env \}/.test(runner)
    && !/process\.env\.SORAN_LLM_RUN_REQUEST_CAP\s*=/.test(runner))
  check('🔴 🔴 **판정기가 묶음 밖 원천을 판정하지 않는다**',
    /all = all0\.filter\(\(t\) => ws\.sourceIds\.has\(/.test(judge))
  check('🔴 🔴 **묶음을 못 읽으면 멈춘다 — "전부 판정" 으로 넘어가지 않는다**',
    /if \(!ws\.ok\) fail\(/.test(judge))
  check('🔴 판정기가 고르지 않은 것을 남긴다고 적는다',
    judge.includes('그대로 남는다'))
  check('🔴 생성기가 회차 id 로 산출물 이름을 짓는다 — 러너가 경로를 안다',
    /const rid = RUN_ID \?\? runId\(now\)/.test(draft))
  check('🔴 🔴 **묶음 선택에 AI 호출이 없다**', (() => {
    const i = runner.indexOf('const budget = judgeStageBudget')
    const j = runner.indexOf('planCommonPhase(after1')
    const block = runner.slice(i, j)
    return !/callProvider|fetch\(|--call/.test(block)
  })())
  check('🔴 🔴 **backlog 입력 파일을 지우지 않는다**', (() => {
    // 🔴 지우는 호출 자체가 없다 — 잠금 해제조차 여기서 하지 않는다
    const calls = runner.match(/\b(rmSync|unlinkSync|rmdirSync)\(/g) ?? []
    return calls.length === 0
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 한 원천이 막혀도 다음 원천은 간다 · 실패는 fail-closed')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 생성기는 원천을 **하나씩** 돌고 HOLD 는 `continue` 다 — 한 건이 막혀도
   *    다음 원천이 그대로 진행된다. 그 계약이 코드에 있는지 값으로 본다.
   */
  const draft = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 🔴 **한 원천 HOLD 가 다음 원천을 막지 않는다**',
    /if \(art\.draft === null\) \{[\s\S]{0,120}continue/.test(draft))
  check('🔴 🔴 **정산 못 적은 건은 완주가 아니다** (fail-closed 유지)',
    /ok: r\.ok && r\.settlementRecorded/.test(draft))
  check('🔴 잘림·사용량 미상은 계속 통과가 아니다 — 원인도 값으로 남는다', (() => {
    const run = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
    return /reason: 'truncated', cause: 'truncated'/.test(run)
      && /reason: 'usageUnknown', cause: 'usageUnknown'/.test(run)
  })())
  check('🔴 🔴 **Post 를 쓰지 않는다 · 사람 미검토 발행 0**', (() => {
    const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
    const fillSrc = readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')
    return !/prisma\.post\.(create|update|delete)/.test(runner)
      && /HUMAN_ONLY_VALUES/.test(fillSrc)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦-c 🔴 🔴 묻기 전에 HOLD 인 것은 묶음이 고르지 않는다')
// ─────────────────────────────────────────────────────────
{
  const ok = ROW({ sourceArticleId: 'g1', commentCount: 10 })
  const badLane: WorksetRow = {
    ...ok, sourceArticleId: 'g2', input: { ...ok.input, lane: '아직-증명되지-않은-lane' },
  }
  check('🔴 🔴 **실증되지 않은 lane 은 묻기 전에 빠진다** — 판정 예산을 쓰지 않는다',
    holdBeforeAsking(badLane.input).includes('laneNotProven')
    && sel({ rows: [ok, badLane] }).workset.sourceIds.join(',') === 'g1')
  check('🔴 판정기와 **같은 함수**가 같은 답을 낸다',
    holdBeforeAsking(ok.input).length === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 🔴 상태 전이 — 최신 하나가 정한다 (2026-09-20 재설계)')
// ─────────────────────────────────────────────────────────
{
  const CANON = {
    ruleVersion: 'auto-judge-v3', promptVersion: 'semantic-shadow-v2c',
    judgeModel: 'claude-haiku-4.5',
  }
  const BASE: GenerationContract = {
    sourceInputHash: 'h1',
    pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
    promptVersion: CONTENT_CORE_PROMPT_VERSION,
    speakerPlanVersion: SPEAKER_PLAN_VERSION,
    reviewVersion: REVIEW_VERSION,
    planPromptDigest: 'plan000000000000',
    stageModels: STAGE_MODEL,
    stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL,
    voiceAssetDigest: 'v1', personaPoolDigest: 'p1',
  }
  const J = (o: Partial<PriorJudgementRow> = {}): PriorJudgementRow => ({
    sourceArticleId: 's1', inputHash: 'h1',
    ruleVersion: CANON.ruleVersion, promptVersion: CANON.promptVersion, model: CANON.judgeModel,
    decision: 'AUTO_HOLD', semanticStatus: 'ok', decidedAt: '2026-09-07T03:20:58.000Z', ...o,
  })
  const A = (o: Partial<PriorArtifactRow> = {}): PriorArtifactRow => ({
    sourceArticleId: 's1', artifactVersion: ARTIFACT_VERSION, contract: BASE,
    outcome: 'hold', retryable: false, generatedAt: '2026-09-20T20:41:28.000Z', ...o,
  })
  const jo = (o: Partial<PriorJudgementRow> = {}) => judgementOutcome(J(o), 'h1', CANON)
  const ao = (o: Partial<PriorArtifactRow> = {}) => artifactOutcome(A(o), BASE, ARTIFACT_VERSION)
  const done = (rows: (PriorOutcome | null)[]): Set<string> =>
    concludedSourceIds(rows.filter((x): x is PriorOutcome => x !== null))

  // ── ① 실제 파일 이름이 시간 순이 아니어도 최신이 이긴다 ──
  check('🔴 🔴 **파일명 문자열로는 2026-09-20 draft 가 2026-09-07 judge 보다 앞선다**',
    'auto-draft-20260920-204128.artifacts.json' < 'auto-judge-20260907-032058.shadow.jsonl')
  check('🔴 🔴 **그래도 명시 시각으로는 최신 retryable 이 이긴다**',
    !done([jo(), ao({ retryable: true })]).has('s1'))
  check('🔴 🔴 **배열에 늦게 온 것이 아니라 시각이 최신인 것이 이긴다**',
    !done([ao({ retryable: true }), jo()]).has('s1')
    && done([ao({ retryable: true, generatedAt: '2026-09-01T00:00:00.000Z' }), jo()]).has('s1'))
  check('🔴 🔴 **같은 순간을 다른 글자로 적어도 같은 순간이다**', (() => {
    const z = jo({ decidedAt: '2026-09-20T00:00:00.000Z' })!
    const kst = ao({ generatedAt: '2026-09-20T09:00:00+09:00' })!
    return z.atMs === kst.atMs && latestOutcomes([z, kst]).get('s1')?.stage === 'draft'
  })())
  check('🔴 상태 어휘가 여섯이다',
    OUTCOME_STATES.join(',') === 'seeded,terminal,rawLane,retryable,candidate,unknown')
  check('🔴 이 레인에서 끝난 상태는 둘이다', CONCLUDED_STATES.join(',') === 'terminal,rawLane')

  // ── ② 같은 회차 AUTO_SEED → hard HOLD 는 HOLD 가 최종이다 ──
  const SAME = '2026-09-20T11:36:07.000Z'
  check('🔴 🔴 **같은 회차 SEED 뒤 hard HOLD 면 HOLD 가 최종이다**',
    done([jo({ decision: 'AUTO_SEED', decidedAt: SAME }), ao({ generatedAt: SAME })]).has('s1'))
  check('🔴 단계 순위는 judge < draft 다', STAGE_RANK.judge < STAGE_RANK.draft)

  // ── ③ 판정 네 가지를 빠짐없이 처리한다 ──
  check('🔴 🔴 **정본 decision 은 넷이다**',
    AUTO_DECISIONS.join(',') === 'AUTO_SEED,AUTO_RAW,AUTO_HOLD,AUTO_DROP')
  check('🟢 AUTO_SEED 는 seeded', jo({ decision: 'AUTO_SEED' })?.state === 'seeded')
  check('🔴 🔴 **AUTO_RAW 는 unknown 이 아니다** — 다른 레인으로 끝난 것이다',
    jo({ decision: 'AUTO_RAW' })?.state === 'rawLane')
  check('🔴 🔴 **AUTO_RAW 는 다음 회차에 다시 올라오지 않는다**',
    done([jo({ decision: 'AUTO_RAW' })]).has('s1'))
  check('🔴 AUTO_HOLD·AUTO_DROP 은 terminal',
    jo()?.state === 'terminal' && jo({ decision: 'AUTO_DROP' })?.state === 'terminal')
  check('🔴 물어보지 못한 판정은 결론이 아니다 — AUTO_RAW 라도',
    jo({ semanticStatus: 'timeout' })?.state === 'retryable'
    && jo({ decision: 'AUTO_RAW', semanticStatus: 'timeout' })?.state === 'retryable')
  check('🔴 🔴 **모르는 decision 은 unknown — 영구 terminal 이 아니다**',
    jo({ decision: '뭔가' })?.state === 'unknown' && !done([jo({ decision: '뭔가' })]).has('s1'))
  check('🔴 🔴 **정본에 다섯 번째가 생기면 여기서 걸린다**', (() => {
    const src = readFileSync('src/lib/supply-workset.ts', 'utf-8')
    const i2 = src.indexOf('function seededState')
    const body = src.slice(i2, src.indexOf('\n}', i2))
    // 목록을 다시 적지 않고 정본 타입을 switch 로 받는다 — 빠뜨리면 컴파일이 깨진다
    return AUTO_DECISIONS.every((d) => body.includes(`case '${d}'`))
      && /const never: never = decision/.test(body)
      && !/\['AUTO_SEED'/.test(src)
  })())
  check('🔴 🔴 **생성 러너는 AUTO_SEED 만 읽는다**',
    /\.filter\(\(j\) => j\.decision === 'AUTO_SEED'\)/
      .test(readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')))
  check('🔴 adopt 는 candidate — terminal 이 아니다',
    ao({ outcome: 'adopt' })?.state === 'candidate' && !done([ao({ outcome: 'adopt' })]).has('s1'))
  check('🔴 재시도 대상 artifact 는 retryable', ao({ retryable: true })?.state === 'retryable')
  check('🔴 🔴 **모르는 outcome 은 unknown**', ao({ outcome: '뭔가' })?.state === 'unknown')

  // ── ④ 지금 입력·지금 계약이 아니면 기록을 쓰지 않는다 ──
  check('🔴 🔴 **원문 inputHash 가 바뀌면 옛 판정을 쓰지 않는다**', jo({ inputHash: 'old' }) === null)
  for (const [name, patch] of [
    ['규칙', { ruleVersion: 'auto-judge-v2' }],
    ['프롬프트', { promptVersion: 'semantic-shadow-v2' }],
    ['모델', { model: 'other' }],
  ] as const) {
    check(`🔴 🔴 **judge ${name} 판이 바뀌면 다시 평가한다**`, jo(patch) === null)
  }
  for (const [name, patch] of [
    ['생성 프롬프트', { promptVersion: '옛판' }],
    ['파이프라인', { pipelineVersion: 'content-core-v2' }],
    ['출력 상한', { stageMaxOutputLabel: 'speakerPlan=1,draftGen=1,semanticReview=1' }],
    ['검수 판', { reviewVersion: 'review-v0' }],
    ['화자 계획 판', { speakerPlanVersion: 'speaker-plan-v0' }],
    ['계획 프롬프트', { planPromptDigest: 'plan2' }],
    ['단계 모델', { stageModels: { ...STAGE_MODEL, draftGen: 'other' } }],
    ['말투 자산', { voiceAssetDigest: 'v2' }],
    ['Persona 후보 풀', { personaPoolDigest: 'p2' }],
  ] as const) {
    check(`🔴 🔴 **${name}이 바뀌면 그 artifact 를 결론으로 쓰지 않는다**`,
      ao({ contract: { ...BASE, ...patch } }) === null)
  }
  check('🔴 🔴 **계약 칸이 없거나 빠진 옛 artifact 는 쓰지 않는다**',
    ao({ contract: null }) === null
    && artifactOutcome({ ...A(), contract: { ...BASE, planPromptDigest: '' } },
      BASE, ARTIFACT_VERSION) === null)
  check('🔴 스키마 판이 다르면 쓰지 않는다', ao({ artifactVersion: 'human-review-v8' }) === null)
  check('🔴 원문 지문이 다르면 쓰지 않는다',
    artifactOutcome(A(), { ...BASE, sourceInputHash: 'h2' }, ARTIFACT_VERSION) === null)

  // ── ⑤ 시각은 엄격한 ISO 만 받는다 ──
  for (const bad of [
    'not-a-time', '2026-02-31T00:00:00Z', '2026-09-20 11:00:00', '2026-09-20T11:00:00',
    '2026-13-01T00:00:00Z', '', '1999-12-31T23:59:59Z', '2100-01-01T00:00:00Z',
  ]) {
    check(`🔴 🔴 **${bad === '' ? '(빈 값)' : bad} 은 기록이 아니다**`,
      parseInstantMs(bad) === null && jo({ decidedAt: bad }) === null
      && ao({ generatedAt: bad }) === null)
  }
  check('🔴 정상 시각은 받는다',
    parseInstantMs('2026-09-20T11:00:00.000Z') === Date.parse('2026-09-20T11:00:00.000Z')
    && parseInstantMs('2026-09-20T20:00:00+09:00') === Date.parse('2026-09-20T11:00:00.000Z'))
  check('🔴 id 가 없으면 세지 않는다', jo({ sourceArticleId: '' }) === null)
  check('🔴 🔴 **malformed 가 terminal 을 만들지 않는다**',
    done([jo({ decidedAt: 'not-a-time' }), ao({ generatedAt: '' })]).size === 0)

  // ── ⑥ 검수 모양과 재시도 사유 ──
  const RV = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    machineOutcome: 'hold',
    semanticCompletion: { complete: false, reason: 'notRun', cause: 'speakerUnqualified' }, ...o,
  })
  /**
   * 🔴 여섯 번째가 늘었다 (2026-09-22) — `speakerSlotNarrowed`.
   *    화자 여력 계획이 원천마다 후보를 나누면서 "이번 묶음에 맞는 사람이 없었다" 가
   *    생겼다. 그것은 결론이 아니다 — 다음 회차에 다른 묶음을 받으면 쓸 수 있다.
   */
  check('🔴 🔴 **재시도 원인 여섯 가지**',
    RETRYABLE_CAUSES.join(',')
      === 'budgetBlocked,noResponse,truncated,usageUnknown,parseFailed,speakerSlotNarrowed',
    RETRYABLE_CAUSES.join(','))
  check('🔴 🔴 **좁힌 묶음 탓은 다시 보고, 전체 자격 미달은 결론이다**',
    (RETRYABLE_CAUSES as readonly string[]).includes('speakerSlotNarrowed')
    && !(RETRYABLE_CAUSES as readonly string[]).includes('speakerUnqualified'))
  check('🔴 🔴 **모델이 형식을 어긴 것은 결론이 아니다**',
    (RETRYABLE_CAUSES as readonly string[]).includes('parseFailed'))
  check('🔴 🔴 **장부 탓·초안 읽기 실패라는 원인은 사라졌다**',
    !(INCOMPLETE_CAUSES as readonly string[]).includes('ledgerUnavailable')
    && !(INCOMPLETE_CAUSES as readonly string[]).includes('draftUnreadable'))
  check('🔴 🔴 **근거 예산 위반은 제 이름으로 남는다 — 재시도가 아니다**',
    (INCOMPLETE_CAUSES as readonly string[]).includes('evidenceBudgetViolated')
    && !(RETRYABLE_CAUSES as readonly string[]).includes('evidenceBudgetViolated'))
  for (const c of RETRYABLE_CAUSES) {
    check(`🔴 ${c} 는 재시도다`,
      artifactRetryable(RV({ semanticCompletion: { complete: false, reason: 'notRun', cause: c } })) === true)
  }
  for (const c of INCOMPLETE_CAUSES.filter((x) => !(RETRYABLE_CAUSES as readonly string[]).includes(x))) {
    check(`🔴 ${c} 는 결론이다`,
      artifactRetryable(RV({ semanticCompletion: { complete: false, reason: 'notRun', cause: c } })) === false)
  }
  check('🔴 완주한 검수는 재시도가 아니다',
    artifactRetryable(RV({ semanticCompletion: { complete: true, reason: null, cause: null } })) === false)
  check('🔴 🔴 **문구로 가르지 않는다** — machineReason 을 바꿔도 판정이 같다',
    artifactRetryable(RV({ machineReason: '예산·상한에 막혀 묻지 못했다' })) === false
    && artifactRetryable(RV({
      semanticCompletion: { complete: false, reason: 'notRun', cause: 'budgetBlocked' },
      machineReason: '아무 말이나',
    })) === true)
  for (const [name, bad] of [
    ['completion 없음', { machineOutcome: 'hold' }],
    ['직접 실패인데 원인이 다르다',
      { machineOutcome: 'hold', semanticCompletion: { complete: false, reason: 'truncated', cause: 'voiceUnready' } }],
    ['예산 차단인데 원인이 파싱 실패',
      { machineOutcome: 'hold', semanticCompletion: { complete: false, reason: 'budgetBlocked', cause: 'parseFailed' } }],
    ['미완료인데 채택',
      { machineOutcome: 'adopt', semanticCompletion: { complete: false, reason: 'truncated', cause: 'truncated' } }],
    ['미완료인데 폐기 — 확정 결함이 아니다',
      { machineOutcome: 'drop', semanticCompletion: { complete: false, reason: 'notRun', cause: 'voiceUnready' } }],
    ['completion 이 객체가 아니다', { machineOutcome: 'hold', semanticCompletion: 'hold' }],
    ['complete 가 없다', { machineOutcome: 'hold', semanticCompletion: { reason: 'notRun', cause: 'voiceUnready' } }],
    ['모르는 reason', { machineOutcome: 'hold', semanticCompletion: { complete: false, reason: '뭔가', cause: 'voiceUnready' } }],
    ['모르는 cause', { machineOutcome: 'hold', semanticCompletion: { complete: false, reason: 'notRun', cause: '뭔가' } }],
    ['완주했는데 원인이 있다', { machineOutcome: 'hold', semanticCompletion: { complete: true, reason: 'notRun', cause: null } }],
    ['모르는 machineOutcome', { machineOutcome: '뭔가', semanticCompletion: { complete: true, reason: null, cause: null } }],
  ] as const) {
    check(`🔴 🔴 **부분 artifact(${name})는 terminal 이 아니다**`,
      !reviewShapeOk(bad) && artifactRetryable(bad) === null
      && artifactOutcome({
        ...A(), retryable: artifactRetryable(bad),
        outcome: String((bad as { machineOutcome?: string }).machineOutcome ?? ''),
      }, BASE, ARTIFACT_VERSION)?.state === 'unknown')
  }
  check('🔴 🔴 **직접 실패는 사유와 원인이 같아야 한다**',
    DIRECT_REASONS.every((r) => reviewShapeOk(RV({
      semanticCompletion: { complete: false, reason: r, cause: r },
    }))))
  check('🔴 🔴 **notRun 은 검증된 앞 단계 원인만 단다**',
    NOT_RUN_CAUSES.every((c) => reviewShapeOk(RV({
      semanticCompletion: { complete: false, reason: 'notRun', cause: c },
    }))))
  /**
   * 🔴 **목록이 러너의 실제 배출과 같아야 한다.** 러너가 새 원인으로 멈추는데
   *    목록에 없으면 그 artifact 는 모양이 깨진 것(`unknown`)이 되어 조용히 다시 돌게 된다.
   *    🔴 그래서 **값 목록과 실제 코드**를 여기서 묶는다.
   */
  check('🔴 🔴 **러너가 내는 notRun 원인이 목록과 정확히 같다**', (() => {
    const src = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
    const direct = [...src.matchAll(/notRun\('([a-zA-Z]+)'\)/g)].map((m) => m[1]!)
    /**
     * 🔴 화자 없음은 **값 하나를 골라** 넘긴다 (2026-09-22) —
     *    좁혀졌으면 `speakerSlotNarrowed`, 아니면 `speakerUnqualified`.
     *    `notRun(<변수>)` 라 위 정규식에 잡히지 않으므로 여기서 함께 센다.
     */
    const picked = [...src.matchAll(/'(speakerSlotNarrowed|speakerUnqualified)' as const/g)]
      .map((m) => m[1]!)
    // 🔴 `notRunFrom` 은 앞 단계 완주 판정(`completionOf`)의 원인을 그대로 물려받는다
    const inherited = /notRunFrom\(/.test(src)
      ? [...src.matchAll(/reason: '([a-zA-Z]+)', cause: '([a-zA-Z]+)'/g)].map((m) => m[2]!)
      : []
    const emitted = new Set([...direct, ...inherited, ...picked])
    const listed = new Set<string>(NOT_RUN_CAUSES)
    return emitted.size > 0 && [...emitted].every((c) => listed.has(c))
      && [...listed].every((c) => emitted.has(c))
  })())
  check('🔴 🔴 **확정 결함으로 묻기 전에 버린 것만 미완료 drop 이다**', (() => {
    const det = RV({
      machineOutcome: 'drop',
      semanticCompletion: { complete: false, reason: 'notRun', cause: 'deterministicFailed' },
    })
    return reviewShapeOk(det) && artifactRetryable(det) === false
      && artifactOutcome({
        ...A(), retryable: false, outcome: 'drop',
      }, BASE, ARTIFACT_VERSION)?.state === 'terminal'
  })())
  check('🔴 정상 hard HOLD 는 terminal 이다', (() => {
    const good = RV({ semanticCompletion: { complete: true, reason: null, cause: null } })
    return reviewShapeOk(good) && artifactOutcome({
      ...A(), retryable: artifactRetryable(good), outcome: 'hold',
    }, BASE, ARTIFACT_VERSION)?.state === 'terminal'
  })())
  check('🔴 정상 budgetBlocked 는 재시도다', (() => {
    const b = RV({ semanticCompletion: { complete: false, reason: 'budgetBlocked', cause: 'budgetBlocked' } })
    return artifactOutcome({
      ...A(), retryable: artifactRetryable(b), outcome: 'hold',
    }, BASE, ARTIFACT_VERSION)?.state === 'retryable'
  })())
  check('🔴 정상 자격 실패 notRun 은 결론이다', (() => {
    const b = RV()
    return artifactOutcome({
      ...A(), retryable: artifactRetryable(b), outcome: 'hold',
    }, BASE, ARTIFACT_VERSION)?.state === 'terminal'
  })())

  // ── ⑦ 계약을 한 곳에서만 만든다 ──
  check('🔴 🔴 **생성 러너와 공급 러너가 같은 함수를 쓴다**', (() => {
    const draft = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
    return /currentContractBase\(\)/.test(draft) && /currentContractBase\(\)/.test(runner)
  })())
  check('🔴 🔴 **artifact 가 원문을 계약에 담지 않는다** — 해시 한 칸뿐', (() => {
    const src = readFileSync('src/lib/content-core/pipeline.ts', 'utf-8')
    const i2 = src.indexOf('export type GenerationContract')
    const block = src.slice(i2, src.indexOf('\n}', i2))
    return block.includes('sourceInputHash') && !/bodyHead|title:|maskedBody/.test(block)
  })())
  check('🔴 🔴 **파일명으로 최신을 판단하는 코드가 남지 않았다**', (() => {
    const lib = readFileSync('src/lib/supply-workset.ts', 'utf-8')
    const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
    return !/order: f\b/.test(runner) && !/\border\b\s*:/.test(lib)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧-a 🔴 🔴 생성 계약이 화자의 생활사를 실제로 담는다')
// ─────────────────────────────────────────────────────────
{
  const CARD = (o: Partial<PoolCard> = {}): PoolCard => ({
    code: 'P01', birthDate: '1978-05-05', title: '카드', ageBand: '40대 후반', region: '수도권',
    maritalStatus: '기혼', spouseRelationship: '원만', childrenCount: 2,
    childrenAgeBands: ['중고등'], workStatus: '파트타임', economicStatus: '빠듯',
    housing: '전세', menopauseStatus: '전', parentCare: '간병 간헐',
    personality: ['부지런함'], noGoTopics: ['남의 형편 비교'], noGoExpressions: ['"그래도"'],
    forbiddenReactionRoles: [], voiceTokens: ['짧은 문장'], voiceLength: '짧음',
    variationCount: 6, ...o,
  })
  const ref = { samples: ['가나다'], bundleDigest: 'b1' }
  const poolOf = (...cards: PoolCard[]): string =>
    personaPoolIdentity(cards.map((c) => personaInputOf(c, ref)))
  const base = poolOf(CARD())

  check('🔴 🔴 **계약 칸이 정본 생활사 열넷과 같다**',
    LIFE_CONTRACT_FIELDS.join(',')
      === 'code,ageBand,region,maritalStatus,spouseRelationship,childrenCount,childrenAgeBands,'
      + 'workStatus,economicStatus,menopauseStatus,parentCare,personality,noGoTopics,noGoExpressions',
    LIFE_CONTRACT_FIELDS.join(','))

  /** 🔴 **열넷을 하나씩 바꿔 본다** — 하나라도 지문에 없으면 여기서 걸린다 */
  const CHANGES: readonly (readonly [string, Partial<PoolCard>])[] = [
    ['code', { code: 'P02' }],
    ['ageBand', { ageBand: '50대 초반' }],
    ['region', { region: '광역시' }],
    ['maritalStatus', { maritalStatus: '이혼' }],
    ['spouseRelationship', { spouseRelationship: '소원' }],
    ['childrenCount', { childrenCount: 1 }],
    ['childrenAgeBands', { childrenAgeBands: ['성인'] }],
    ['workStatus', { workStatus: '전업' }],
    ['economicStatus', { economicStatus: '여유' }],
    ['menopauseStatus', { menopauseStatus: '진행중' }],
    ['parentCare', { parentCare: '없음' }],
    ['personality', { personality: ['느긋함'] }],
    ['noGoTopics', { noGoTopics: ['다른 소재'] }],
    ['noGoExpressions', { noGoExpressions: ['"다른 표현"'] }],
  ]
  for (const [name, patch] of CHANGES) {
    check(`🔴 🔴 **${name} 이 바뀌면 계약이 바뀐다**`, poolOf(CARD(patch)) !== base)
  }
  check('🔴 🔴 **배열 순서가 바뀌어도 다른 계약이다** — 프롬프트에 그 순서로 실린다',
    poolOf(CARD({ personality: ['가', '나'] })) !== poolOf(CARD({ personality: ['나', '가'] })))
  check('🔴 말투 토큰이 바뀌면 계약이 바뀐다', poolOf(CARD({ voiceTokens: ['긴 문장'] })) !== base)
  check('🔴 🔴 **말투 묶음이 바뀌면 계약이 바뀐다** — 댓글 원문은 담지 않는다', (() => {
    const other = personaPoolIdentity([personaInputOf(CARD(), { samples: ['가나다'], bundleDigest: 'b2' })])
    const sameBundleOtherText =
      personaPoolIdentity([personaInputOf(CARD(), { samples: ['전혀 다른 댓글'], bundleDigest: 'b1' })])
    return other !== base && sameBundleOtherText === base
  })())
  check('🔴 🔴 **계약에 댓글 원문이 없다**', !base.includes('가나다'))
  check('🔴 🔴 **계약에 들어가지 않는 칸도 있다** — 집·금지 역할·variation 수',
    poolOf(CARD({ housing: '자가' })) === base
    && poolOf(CARD({ forbiddenReactionRoles: ['advice'] })) === base
    && poolOf(CARD({ variationCount: 1 })) === base)
  check('🔴 🔴 **읽는 순서가 달라도 같은 계약이다**', (() => {
    const a = CARD(); const b = CARD({ code: 'P02' })
    return poolOf(a, b) === poolOf(b, a)
  })())
  check('🔴 같은 풀이면 같은 값이다', poolOf(CARD()) === base)

  // ── 🔴 후보 순서는 원문이 정한다 — 실제로 보내는 것과 계약이 같은 입력을 쓴다 ──
  const POOL = ['P01', 'P02', 'P03', 'P04', 'P05'].map((c) => personaInputOf(CARD({ code: c }), ref))
  const codes = (hash: string, from: readonly typeof POOL[number][] = POOL): string =>
    orderPersonasForSource(from, hash).map((x) => x.code).join(',')

  check('🔴 🔴 **같은 원문 지문은 언제나 같은 후보 순서다**',
    codes('h-aaaa') === codes('h-aaaa'))
  check('🔴 🔴 **읽은 순서가 달라도 같은 순서가 나온다**',
    codes('h-aaaa', [...POOL].reverse()) === codes('h-aaaa'))
  check('🔴 🔴 **원문이 다르면 순서가 흩어진다**', (() => {
    const orders = new Set(Array.from({ length: 40 }, (_, i) => codes(`h-${i}`)))
    return orders.size > 1
  })(), `${new Set(Array.from({ length: 40 }, (_, i) => codes(`h-${i}`))).size}가지`)
  check('🔴 🔴 **첫 후보가 한 사람으로 고정되지 않는다**', (() => {
    const first = new Set(Array.from({ length: 40 }, (_, i) => codes(`h-${i}`).split(',')[0]!))
    return first.size >= 3
  })(), [...new Set(Array.from({ length: 40 }, (_, i) => codes(`h-${i}`).split(',')[0]!))].join(','))
  check('🔴 아무도 빠지거나 겹치지 않는다', (() => {
    const got = orderPersonasForSource(POOL, 'h-x').map((x) => x.code)
    return got.length === POOL.length && new Set(got).size === POOL.length
  })())
  check('🔴 🔴 **계약은 순서에 흔들리지 않는다** — 순서는 지문에서 다시 만든다',
    personaPoolIdentity(POOL) === personaPoolIdentity([...POOL].reverse()))
  check('🔴 🔴 **요청을 만드는 쪽이 그 순서를 실제로 쓴다**', (() => {
    const src = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
    return /orderPersonasForSource\(input\.personas, input\.contract\.sourceInputHash\)/.test(src)
      && /personas: ordered/.test(src)
  })())
  /** 🔴 **실제로 나가는 문자열로 본다** — 주석이 아니라 만들어진 요청이다 */
  check('🔴 🔴 **요청에도 지시에도 회차 상태가 없다**', (() => {
    const packet = buildEvidencePacket({
      sourceArticleId: 's1', title: '제목', maskedBody: '본문입니다. 다들 어떠세요?',
    })
    const payload = buildSpeakerPlanPayload({ packet, personas: POOL })
    return !payload.includes('맡은 수')
      && !buildSpeakerPlanSystemPrompt().includes('맡은 수')
  })())
  check('🔴 🔴 **읽은 순서가 달라도 실제로 나가는 요청이 같다**', (() => {
    const packet = buildEvidencePacket({
      sourceArticleId: 's1', title: '제목', maskedBody: '본문입니다. 다들 어떠세요?',
    })
    const hash = 'h-payload'
    const one = buildSpeakerPlanPayload({ packet, personas: orderPersonasForSource(POOL, hash) })
    const two = buildSpeakerPlanPayload({
      packet, personas: orderPersonasForSource([...POOL].reverse(), hash),
    })
    return one === two
  })())
  check('🔴 🔴 **생성 러너가 회차 안 상태를 더는 만들지 않는다**',
    !/v2Load/.test(readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧-b 🔴 🔴 지속 유입에서도 재시도가 굶지 않는다')
// ─────────────────────────────────────────────────────────
{
  const at = (h: number): string => `2026-09-20T${String(h).padStart(2, '0')}:00:00.000Z`
  const R = (id: string, comments: number): WorksetRow => ROW({ sourceArticleId: id, commentCount: comments })

  /** 🔴 신규 5건이 회차마다 들어와도 재시도 차례가 온다 */
  {
    const rows: WorksetRow[] = [R('retry-me', 1)]
    let pickedRounds = 0
    for (let round = 1; round <= 10; round += 1) {
      for (let i = 0; i < 5; i += 1) rows.push(R(`new-${round}-${i}`, 50 + i))
      const plan = sel({
        rows, attempted: { 'retry-me': at(1) }, limit: 5,
        takenAt: new Date(`2026-09-20T${String(11 + round).padStart(2, '0')}:00:00.000Z`),
      })
      if (plan.workset.sourceIds.includes('retry-me')) pickedRounds += 1
    }
    check('🔴 🔴 **신규 5건 × 10회차에도 재시도가 매 회차 자리를 얻는다**',
      pickedRounds === 10, `${pickedRounds}/10`)
  }
  check('🔴 상한 5에서 신규는 최대 4다', WORKSET_RETRY_RESERVE === 1)
  {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => R(`n${i}`, 90 - i)),
      R('r1', 10), R('r2', 9),
    ]
    const plan = sel({ rows, attempted: { r1: at(1), r2: at(2) }, limit: 5 })
    check('🔴 🔴 **신규 4 + 재시도 1**',
      plan.workset.sourceIds.join(',') === 'n0,n1,n2,n3,r1', plan.workset.sourceIds.join(','))
    check('🔴 🔴 **재시도 안에서는 오래 기다린 것이 먼저다**',
      sel({ rows, attempted: { r1: at(5), r2: at(2) }, limit: 5 })
        .workset.sourceIds.includes('r2'))
  }
  check('🔴 🔴 **재시도가 없으면 신규가 5칸을 다 쓴다**',
    sel({ rows: Array.from({ length: 6 }, (_, i) => R(`n${i}`, 90 - i)), limit: 5 })
      .workset.sourceIds.join(',') === 'n0,n1,n2,n3,n4')
  check('🔴 🔴 **신규가 2건이면 재시도가 나머지 3칸을 채운다**', (() => {
    const rows = [R('n0', 90), R('n1', 89), R('r1', 10), R('r2', 9), R('r3', 8), R('r4', 7)]
    const got = sel({ rows, attempted: { r1: at(1), r2: at(2), r3: at(3), r4: at(4) }, limit: 5 })
    return got.workset.sourceIds.join(',') === 'n0,n1,r1,r2,r3'
  })())
  check('🔴 🔴 **끝난 원천은 재시도 자리에도 들어오지 않는다**', (() => {
    const rows = [R('n0', 90), R('r1', 10), R('r2', 9)]
    const got = sel({ rows, concluded: ['r1'], attempted: { r1: at(1), r2: at(2) }, limit: 5 })
    return !got.workset.sourceIds.includes('r1') && got.workset.sourceIds.includes('r2')
      && got.dropped.terminal === 1
  })())
  check('🔴 🔴 **같은 입력은 같은 순서를 낸다**', (() => {
    const rows = [R('a', 10), R('b', 10), R('c', 10), R('r1', 10), R('r2', 10)]
    const o = { rows, attempted: { r1: at(1), r2: at(1) }, limit: 4 } as const
    return sel(o).workset.sourceIds.join(',') === sel(o).workset.sourceIds.join(',')
      && sel(o).workset.sourceIds.join(',') === 'a,b,c,r1'
  })())
  /** 🔴 상한 1 — 자리를 나눌 수 없으니 **기다린 시간**이 정한다 */
  {
    const rows = [R('n0', 90), R('r1', 10)]
    const soon = sel({
      rows, attempted: { r1: at(10) }, limit: 1,
      takenAt: new Date('2026-09-20T11:00:00.000Z'),
    })
    const later = sel({
      rows, attempted: { r1: at(10) }, limit: 1,
      takenAt: new Date(Date.parse(at(10)) + WORKSET_RETRY_STARVE_MS),
    })
    check('🔴 🔴 **상한 1 — 처음에는 신규가 그 자리를 쓴다**',
      soon.workset.sourceIds.join(',') === 'n0')
    check('🔴 🔴 **상한 1 — 오래 기다리면 재시도가 그 자리를 가져간다**',
      later.workset.sourceIds.join(',') === 'r1')
    check('🔴 🔴 **상한 1에서도 신규가 영구히 굶지 않는다** — 재시도가 없으면 신규가 쓴다',
      sel({ rows: [R('n0', 90)], limit: 1 }).workset.sourceIds.join(',') === 'n0')
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 🔴 버퍼가 차 있거나 고를 것이 0건이면 정상 종료다')
// ─────────────────────────────────────────────────────────
{
  const pending: Pending = {
    rawCafe: {}, thin: {}, detail: ['a.detail.jsonl'], shadow: [], candidates: [],
  }
  const gate = { kind: 'ready' as const, snapshotPath: '/d/s.json', runId: RUN }
  const ws = {
    manifestPath: '/d/w.json', shadowPath: '/d/s.shadow.jsonl',
    candidatesPath: '/d/c.json', limit: 5, perStage: { judge: 5, draft: 15 },
  }
  check('🔴 🔴 **모델 단계가 꺼져 있으면 계획이 비어 있다**',
    planBoundedCommonPhase(pending, { llm: false, fill: false, upTo: 0, reason: '재고 충분' }, gate, ws)
      .length === 0)

  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  check('🔴 🔴 **버퍼 충족은 실패가 아니다 — done 으로 끝낸다**',
    /if \(!policy\.llm\) \{[\s\S]{0,200}모델 단계 없음/.test(runner)
    && !/if \(!policy\.llm\)[\s\S]{0,200}return 1/.test(runner))
  check('🔴 🔴 **고를 원천이 0건이면 정상 no-op 이다**',
    /worksetEmpty[\s\S]{0,160}정상 no-op/.test(runner))
  check('🔴 🔴 **빈 묶음으로 manifest 를 쓰지 않는다**',
    /if \(plan\.picked\.length === 0\) \{[\s\S]{0,140}worksetEmpty = true/.test(runner))
  check('🔴 🔴 **못 만든 회차만 실패다**',
    /} else \{[\s\S]{0,160}작업 묶음을 만들지 못했다[\s\S]{0,160}return 1/.test(runner))
  check('🔴 묶음이 없으면 공통 단계 계획이 비어 있다',
    /const common = workset === undefined\s*\n\s*\? \[\]/.test(runner))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 함수와 소스 계약만 본다 — provider 0 · DB 0 · 파일 write 0.')
if (fail > 0) process.exit(1)
