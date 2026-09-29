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
  worksetAxisCaps, worksetAxisOf, worksetAxisQuota, WORKSET_RAW_SLOT_EVERY,
  OUTCOME_STATES, CONCLUDED_STATES, STAGE_RANK, worksetRetryReserve, WORKSET_RETRY_STARVE_MS,
  attributeRuns, runWindowOf, isLaterOutcome, runClockOf, retryTierOf, resolveWorksetLimit,
  queuedSourceKeysOf, hasSource, originalSourceOf, EMPTY_SOURCE_KEYS, WORKSET_MAX_LIMIT,
  shadowRecordOutcome,
  type RunWindow, type SourceKeySet,
  type PriorArtifactRow, type PriorJudgementRow, type PriorOutcome,
  WORKSET_DEFAULT_LIMIT, WORKSET_KIND, WORKSET_STAGE_PER_SOURCE, WORKSET_TOTAL_PER_SOURCE,
  WORKSET_VERSION, worksetFileName, type WorksetRow,
} from '../src/lib/supply-workset'
import {
  ledgerRunIdOf, planBoundedCommonPhase, planCarryOverFill, planCommonPhase, type Pending,
} from '../src/lib/supply-process'
import {
  AUTO_DECISIONS, holdBeforeAsking, mergeJudgeRows, PROVEN_LANES, RAW_AXIS, SEED_AXIS,
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
import { selectCarryOver } from '../src/lib/supply-fill-retry'
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
  /** 🔴 이미 본 원천을 **모양 그대로** 줄 때 — 차례(`retryTierOf`)를 시험한다 */
  attemptedOutcomes?: ReadonlyMap<string, PriorOutcome>
  queuedSources?: SourceKeySet
  carriedOver?: SourceKeySet
  limit?: number
  takenAt?: Date
}) => selectWorkset({
  rows: o.rows,
  humanDecided: new Set(o.humanDecided ?? []),
  queuePending: new Set(o.queuePending ?? []),
  queuedSources: o.queuedSources ?? EMPTY_SOURCE_KEYS,
  carriedOver: o.carriedOver ?? EMPTY_SOURCE_KEYS,
  concluded: new Set(o.concluded ?? []),
  attempted: o.attemptedOutcomes ?? attemptedMap(o.attempted ?? []),
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
  check('🔴 🔴 **기본 묶음 크기는 10 이다** (2026-09-28 공급 가속)', WORKSET_DEFAULT_LIMIT === 10)
  {
    const b10 = judgeStageBudget(10)
    check('🔴 🔴 **묶음 10 → judge 10 · draft 30 · 합 40**',
      b10.ok && b10.perStage.judge === 10 && b10.perStage.draft === 30 && b10.total === 40,
      b10.ok ? JSON.stringify(b10) : b10.reason)
  }
  check('🔴 🔴 **천장(10) 위는 거부한다 — 무제한 호출 없음**',
    WORKSET_MAX_LIMIT === 10 && judgeStageBudget(11).ok === false && judgeStageBudget(100).ok === false)
  check('🔴 🔴 **--workset-limit 해석 — 없으면 10 · 천장 위·모양 틀림은 -1**',
    resolveWorksetLimit([]) === 10 && resolveWorksetLimit(['--workset-limit=7']) === 7
    && resolveWorksetLimit(['--workset-limit=11']) === -1 && resolveWorksetLimit(['--workset-limit=5x']) === -1
    && resolveWorksetLimit(['--workset-limit=0']) === -1 && resolveWorksetLimit(['--workset-limit=-3']) === -1)
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
  /**
   * 🔴 회차 시각이 자식 env 에 함께 실리면서 모양이 바뀌었다(2026-09-23) —
   *    지키는 것은 같다: **자식에게만** 실리고, 부모 `process.env` 는 건드리지 않는다.
   */
  check('🔴 단계 env 는 자식 프로세스에만 실린다',
    /env: \{ \.\.\.process\.env, \.\.\.withClock \}/.test(runner)
    && /const withClock = \{ \.\.\.\(env \?\? \{\}\), \[RUN_AT_ENV\]: RUN_AT\.toISOString\(\) \}/.test(runner)
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
  // 🔴 (2026-09-29) `rawLane` 을 없앴다 — AUTO_RAW 는 이 레인이 적응 경로로 초안화한다
  check('🔴 상태 어휘가 다섯이다',
    OUTCOME_STATES.join(',') === 'seeded,terminal,retryable,candidate,unknown')
  check('🔴 이 레인에서 끝난 상태는 하나다', CONCLUDED_STATES.join(',') === 'terminal')

  // ── ② 같은 회차 AUTO_SEED → hard HOLD 는 HOLD 가 최종이다 ──
  const SAME = '2026-09-20T11:36:07.000Z'
  check('🔴 🔴 **같은 회차 SEED 뒤 hard HOLD 면 HOLD 가 최종이다**',
    done([jo({ decision: 'AUTO_SEED', decidedAt: SAME }), ao({ generatedAt: SAME })]).has('s1'))
  check('🔴 단계 순위는 judge < draft 다', STAGE_RANK.judge < STAGE_RANK.draft)

  // ── ③ 판정 네 가지를 빠짐없이 처리한다 ──
  check('🔴 🔴 **정본 decision 은 넷이다**',
    AUTO_DECISIONS.join(',') === 'AUTO_SEED,AUTO_RAW,AUTO_HOLD,AUTO_DROP')
  check('🟢 AUTO_SEED 는 seeded', jo({ decision: 'AUTO_SEED' })?.state === 'seeded')
  check('🔴 🔴 **AUTO_RAW 는 unknown 이 아니다 — 적응 경로의 초안 대상(seeded)이다** (2026-09-29)',
    jo({ decision: 'AUTO_RAW' })?.state === 'seeded')
  check('🔴 🔴 **AUTO_RAW 판정만으로 끝난 원천이 되지 않는다 — 생성이 결론을 낸다**',
    !done([jo({ decision: 'AUTO_RAW' })]).has('s1'))
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
   *
   * 🔴 일곱·여덟 번째 (2026-09-23) — `personaTransformFailed` · `loadBearingMismatch`.
   *    원문 화자의 사실을 우리 Persona 값으로 **바꾸지 못한** 실패다.
   *    앞판은 `complete` 인 HOLD 를 전부 결론으로 봐서, **다른 사람이면 될 수 있는**
   *    불일치 하나가 원천을 영구히 태웠다.
   */
  /**
   * 🔴 **load-bearing 이 둘로 나뉘었다** (2026-09-23 마스터 P0-1).
   *    `loadBearingMismatch` — 조건을 만족하는 다른 후보가 있다 (사람을 바꾼다)
   *    `loadBearingSelfImpossible` — 만족하는 후보가 없다 (자리를 바꾼다)
   *    🔴 `meaningUnpreservable` 은 여기 없다 — 결론이다.
   */
  check('🔴 🔴 **재시도 원인 아홉 가지**',
    RETRYABLE_CAUSES.join(',')
      === 'budgetBlocked,noResponse,truncated,usageUnknown,parseFailed,speakerSlotNarrowed'
        + ',personaTransformFailed,loadBearingMismatch,loadBearingSelfImpossible',
    RETRYABLE_CAUSES.join(','))
  check('🔴 🔴 **의미가 보존되지 않는다는 결론은 다시 시도하지 않는다**',
    !(RETRYABLE_CAUSES as readonly string[]).includes('meaningUnpreservable')
    && (INCOMPLETE_CAUSES as readonly string[]).includes('meaningUnpreservable'))
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
    /**
     * 🔴 화자 상대 사실 변환 실패도 **값 하나를 골라** 넘긴다 (2026-09-23) —
     *    `LOAD_BEARING` 이면 `loadBearingMismatch`, 아니면 `personaTransformFailed`.
     *    같은 이유로 위 정규식에 잡히지 않으므로 여기서 함께 센다.
     */
    const transform = [...src.matchAll(
      /'(loadBearingMismatch|loadBearingSelfImpossible|meaningUnpreservable|personaTransformFailed)' as const/g)]
      .map((m) => m[1]!)
    // 🔴 `notRunFrom` 은 앞 단계 완주 판정(`completionOf`)의 원인을 그대로 물려받는다
    const inherited = /notRunFrom\(/.test(src)
      ? [...src.matchAll(/reason: '([a-zA-Z]+)', cause: '([a-zA-Z]+)'/g)].map((m) => m[2]!)
      : []
    const emitted = new Set([...direct, ...inherited, ...picked, ...transform])
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
    /**
     * 🔴 회차 시각을 받게 됐다 (2026-09-23) — 계약에 그날 나이가 들어간다.
     *    **같은 함수를 쓴다**는 계약은 그대로다.
     */
    return /currentContractBase\(RUN_AT\)/.test(draft) && /currentContractBase\(runAt\)/.test(runner)
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
    variationCount: 6, household: { childrenLiving: '동거', careSide: null, careCohabit: null }, ...o,
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
    /**
     * 🔴 계획 후보에 **그날의 Persona 스냅샷**을 먼저 입힌다 (2026-09-23) —
     *    그래야 계획과 생성이 같은 사람을 본다. 순서 계약은 그대로다.
     */
    return /orderPersonasForSource\(dated, input\.contract\.sourceInputHash\)/.test(src)
      && /const dated = input\.personas\.map\(datedOf\)/.test(src)
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
  check('🔴 🔴 **재시도 자리 — 상한 5 에서 1 · 상한 10 에서 2 · 상한 1 은 0(기다린 시간 규칙)**',
    worksetRetryReserve(5) === 1 && worksetRetryReserve(10) === 2 && worksetRetryReserve(7) === 1
    && worksetRetryReserve(2) === 1 && worksetRetryReserve(1) === 0,
    `5→${worksetRetryReserve(5)} · 10→${worksetRetryReserve(10)}`)
  {
    // 🔴 상한 10 · 신규가 넘쳐도 재시도 **2** 자리 — 1 로 되돌리면 여기서 깨진다
    const rows = [...Array.from({ length: 20 }, (_, i) => R(`n${i}`, 90 - i)), R('r1', 1), R('r2', 1), R('r3', 1)]
    const plan = sel({ rows, attempted: { r1: at(1), r2: at(2), r3: at(3) }, limit: 10 })
    const retries = plan.workset.sourceIds.filter((x) => x.startsWith('r'))
    check('🔴 🔴 **상한 10 — 신규 8 + 재시도 2 (오래 기다린 r1 · r2)**',
      plan.workset.sourceIds.length === 10 && retries.join(',') === 'r1,r2', plan.workset.sourceIds.join(','))
  }
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
  /**
   * 🔴 묶음이 없으면 **모델 단계가 없다** (2026-09-27 보정). 예외는 고를 원천이 0건인 회차의
   *    **이월 적재(fill 하나)** 뿐이다 — 판정·초안은 여전히 0회다(`planCarryOverFill` 은 fill 만 낸다).
   */
  check('🔴 묶음이 없으면 공통 단계는 이월 fill 뿐이다 — judge·draft 0회',
    /const common = workset === undefined\s*\n\s*\? \(worksetEmpty \? planCarryOverFill\(policy, carryPaths, WORKSET_LIMIT\) : \[\]\)/.test(runner)
    && planCarryOverFill({ llm: true, fill: true, upTo: 9, reason: '' }, ['/d/a.candidates.json'], 5)
      .every((p) => p.stage === 'fill' && !p.llm))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 🔴 🔴 축별 자리 — raw 는 자리를 제한하고, 빼지는 않는다 (2026-09-28)')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 실측(2026-09-21~27, 39회차 195자리): raw 85자리 → 초안 0 · 채택 0.
 *    seed 110자리 → 채택 33. 댓글 수만 보고 고르면 raw 가 자리를 먹는다.
 *    fixture 는 **raw 의 댓글 수를 더 크게** 둔다 — 옛 규칙이면 raw 가 자리를 다 가져가는 모양이다.
 */
{
  const at = (h: number): string => `2026-09-20T${String(h).padStart(2, '0')}:00:00.000Z`
  const SEED = (id: string, c: number): WorksetRow => ROW({ sourceArticleId: id, commentCount: c, axis: SEED_AXIS })
  const RAW = (id: string, c: number): WorksetRow => ROW({ sourceArticleId: id, commentCount: c, axis: RAW_AXIS })
  const seeds = (n: number, base = 10): WorksetRow[] => Array.from({ length: n }, (_, i) => SEED(`s${i}`, base - i))
  const raws = (n: number, base = 90): WorksetRow[] => Array.from({ length: n }, (_, i) => RAW(`w${i}`, base - i))
  const axisCount = (p: ReturnType<typeof sel>) => ({
    seed: p.picked.filter((r) => worksetAxisOf(r) === 'seed').length,
    raw: p.picked.filter((r) => worksetAxisOf(r) === 'raw').length,
  })
  const ids = (p: ReturnType<typeof sel>): string => p.workset.sourceIds.join(',')

  // ── 상한 → 자리 ──
  check('🔴 fixture 가 정본 축을 탄다 — raw 행은 raw, seed 행은 seed',
    worksetAxisOf(RAW('x', 1)) === 'raw' && worksetAxisOf(SEED('y', 1)) === 'seed'
    && holdBeforeAsking(RAW('x', 1).input).length === 0 && holdBeforeAsking(SEED('y', 1).input).length === 0)
  check('🔴 🔴 **상한 5 → raw 최대 1 · raw 자리 1 보장**',
    WORKSET_RAW_SLOT_EVERY === 5
    && JSON.stringify(worksetAxisCaps(5)) === JSON.stringify({ rawCap: 1, rawReserve: 1 }))
  check('🔴 상한 10 → raw 최대 2 · 상한 7 → raw 최대 1 (비례)',
    JSON.stringify(worksetAxisCaps(10)) === JSON.stringify({ rawCap: 2, rawReserve: 2 })
    && JSON.stringify(worksetAxisCaps(7)) === JSON.stringify({ rawCap: 1, rawReserve: 1 }))
  check('🔴 상한 1~4 → raw 최대 1 · 남기는 자리 0 (20% 를 넘기지 않는다)',
    [1, 2, 3, 4].every((n) => JSON.stringify(worksetAxisCaps(n)) === JSON.stringify({ rawCap: 1, rawReserve: 0 })))
  check('🔴 상한이 양의 정수가 아니면 자리 0',
    [0, -1, 1.5, Number.NaN].every((n) => JSON.stringify(worksetAxisCaps(n)) === JSON.stringify({ rawCap: 0, rawReserve: 0 })))
  check('🔴 🔴 **quota — seed 충분 · raw 있음 → seed 4 · raw 1**',
    JSON.stringify(worksetAxisQuota(5, { seed: 10, raw: 10 })) === JSON.stringify({ seed: 4, raw: 1 }))
  check('🔴 🔴 **quota — seed 2 · raw 10 → seed 2 · raw 1 (빈 자리 2 는 비운다)**',
    JSON.stringify(worksetAxisQuota(5, { seed: 2, raw: 10 })) === JSON.stringify({ seed: 2, raw: 1 }))
  check('🔴 quota — raw 가 없으면 seed 가 5 자리를 다 쓴다',
    JSON.stringify(worksetAxisQuota(5, { seed: 10, raw: 0 })) === JSON.stringify({ seed: 5, raw: 0 }))

  // ── 실제 선택 ──
  {
    const p = sel({ rows: [...raws(10), ...seeds(10)], limit: 5 })
    check('🔴 🔴 **raw 댓글이 더 많아도 seed 4 · raw 1**',
      axisCount(p).seed === 4 && axisCount(p).raw === 1, JSON.stringify(axisCount(p)))
    check('🔴 🔴 **각 축 안에서는 댓글 수 순서 그대로** — seed 상위 4 · raw 상위 1',
      ids(p) === 'w0,s0,s1,s2,s3', ids(p))
    check('🔴 plan.axis 가 실제 고른 수와 같다',
      p.axis.picked.seed === 4 && p.axis.picked.raw === 1
      && p.axis.quota.seed === 4 && p.axis.quota.raw === 1
      && p.axis.eligible.seed === 10 && p.axis.eligible.raw === 10)
    check('🔴 고르지 않은 15건은 그대로 남는다', p.deferred === 15, `${p.deferred}`)
  }
  check('🔴 🔴 **raw 를 영구 제외하지 않는다 — seed 가 넘쳐도 raw 1 자리**', (() => {
    const p = sel({ rows: [...seeds(50, 200), RAW('only-raw', 0)], limit: 5 })
    return p.workset.sourceIds.includes('only-raw') && axisCount(p).raw === 1
  })())
  check('🔴 🔴 **seed 가 모자라도 raw 로 채우지 않는다 — seed 2 · raw 1 · 2 자리 빈다**', (() => {
    const p = sel({ rows: [...seeds(2), ...raws(10)], limit: 5 })
    return axisCount(p).seed === 2 && axisCount(p).raw === 1 && p.picked.length === 3 && p.deferred === 9
  })())
  check('🔴 🔴 **seed 가 0 이면 raw 1 건만** — 묶음 전체를 raw 로 채우지 않는다', (() => {
    const p = sel({ rows: raws(10), limit: 5 })
    return ids(p) === 'w0' && p.deferred === 9
  })())
  check('🔴 raw 가 없으면 seed 가 5 자리를 다 쓴다 (앞판과 같다)',
    ids(sel({ rows: seeds(10), limit: 5 })) === 's0,s1,s2,s3,s4')
  check('🔴 상한 10 → seed 8 · raw 2', (() => {
    const c = axisCount(sel({ rows: [...raws(10), ...seeds(20)], limit: 10 }))
    return c.seed === 8 && c.raw === 2
  })())
  check('🔴 상한 3 · seed 충분 → seed 3 · raw 0 (작은 상한은 raw 자리를 남기지 않는다)', (() => {
    const c = axisCount(sel({ rows: [...raws(10), ...seeds(10)], limit: 3 }))
    return c.seed === 3 && c.raw === 0
  })())
  check('🔴 🔴 **상한 1 · seed 0 → raw 1 건 (작은 상한에서도 raw 가 빠지지 않는다)**',
    ids(sel({ rows: raws(3), limit: 1 })) === 'w0')
  check('🔴 상한 3 · seed 1 → seed 1 · raw 1 (나머지 1 자리는 빈다)', (() => {
    const c = axisCount(sel({ rows: [...raws(10), ...seeds(1)], limit: 3 }))
    return c.seed === 1 && c.raw === 1
  })())

  // ── 신규/재시도 자리가 축 자리 안에서 그대로인가 ──
  {
    const rows = [...seeds(10, 90), SEED('rs1', 1), SEED('rs2', 1), SEED('rs3', 1), ...raws(5, 200)]
    const p = sel({ rows, attempted: { rs1: at(5), rs2: at(2), rs3: at(9) }, limit: 5 })
    check('🔴 🔴 **재시도 자리 1 이 유지된다 — 신규 seed 가 축 자리를 먼저 채워도**',
      ids(p) === 'w0,s0,s1,s2,rs2', ids(p))
  }
  {
    const rows = [...seeds(10, 90), RAW('rw1', 1), RAW('rw2', 1)]
    const p = sel({ rows, attempted: { rw1: at(5), rw2: at(2) }, limit: 5 })
    check('🔴 🔴 **재시도가 raw 뿐이면 그 raw 재시도가 raw 자리로 들어온다** — 오래 기다린 것',
      ids(p) === 's0,s1,s2,s3,rw2', ids(p))
  }
  {
    const rows = [SEED('n0', 90), SEED('r1', 1), SEED('r2', 1), SEED('r3', 1), SEED('r4', 1), ...raws(3)]
    const p = sel({ rows, attempted: { r1: at(4), r2: at(1), r3: at(3), r4: at(2) }, limit: 5 })
    check('🔴 🔴 **신규가 모자라면 재시도가 채운다 — 오래 기다린 순서로 · 축 자리 안에서**',
      ids(p) === 'n0,w0,r2,r4,r3', ids(p))
  }
  {
    // 🔴 raw 재시도가 가장 오래 기다렸어도 raw 자리를 신규 raw 가 이미 쓰면 들어오지 못한다 — 대신 seed 재시도가 자리를 받는다
    const rows = [...seeds(10, 90), SEED('rs', 1), RAW('rw', 1), ...raws(2, 300)]
    const p = sel({ rows, attempted: { rw: at(1), rs: at(3) }, limit: 5 })
    const c = axisCount(p)
    check('🔴 raw 자리는 1 을 넘지 않는다 — 재시도라도',
      c.raw === 1 && c.seed === 4 && p.workset.sourceIds.some((x) => x === 'rs' || x === 'rw'), ids(p))
  }
  // ── 상한 1 · 기다린 시간 규칙이 축 자리와 함께 그대로 ──
  {
    const rows = [SEED('n0', 90), SEED('r1', 10)]
    check('🔴 🔴 **상한 1 · 오래 기다린 seed 재시도가 그 자리를 가져간다 (앞판 규칙 유지)**',
      ids(sel({ rows, attempted: { r1: at(10) }, limit: 1,
        takenAt: new Date(Date.parse(at(10)) + WORKSET_RETRY_STARVE_MS) })) === 'r1'
      && ids(sel({ rows, attempted: { r1: at(10) }, limit: 1, takenAt: new Date('2026-09-20T11:00:00.000Z') })) === 'n0')
  }

  // ── 🔴 원천이 전부 seed 이면 앞판과 **값이 같다** — 축 자리가 다른 규칙을 몰래 바꾸지 않는다 ──
  {
    /** 🔴 2026-09-27 판(`720fc98`)의 신규/재시도 나눔을 그대로 적은 기준 — 비교용이다 */
    const reference = (rows: readonly WorksetRow[], attempted: ReadonlyMap<string, PriorOutcome>, limit: number, takenAt: Date): string => {
      const byWeight = (a: WorksetRow, b: WorksetRow): number =>
        b.commentCount - a.commentCount
        || (b.sourcePostedAt || b.sourceListedAt).localeCompare(a.sourcePostedAt || a.sourceListedAt)
        || a.sourceArticleId.localeCompare(b.sourceArticleId)
      const fresh = rows.filter((r) => !attempted.has(r.sourceArticleId)).sort(byWeight)
      const retry = rows.filter((r) => attempted.has(r.sourceArticleId))
        .sort((a, b) => (attempted.get(a.sourceArticleId)?.atMs ?? 0) - (attempted.get(b.sourceArticleId)?.atMs ?? 0) || byWeight(a, b))
      const waited = retry.length === 0 ? 0 : takenAt.getTime() - (attempted.get(retry[0]!.sourceArticleId)?.atMs ?? 0)
      const reserve = retry.length === 0 ? 0 : limit >= 2 ? 1 : waited >= WORKSET_RETRY_STARVE_MS ? limit : 0
      const f = fresh.slice(0, Math.max(0, limit - reserve))
      const r = retry.slice(0, Math.max(0, limit - f.length))
      return [...f, ...r].map((x) => x.sourceArticleId).join(',')
    }
    let seed = 20260928
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    let same = 0
    let firstDiff = ''
    const CASES = 300
    for (let k = 0; k < CASES; k += 1) {
      const n = 1 + rnd(12)
      const rows = Array.from({ length: n }, (_, i) =>
        ROW({ sourceArticleId: `c${k}-${i}`, commentCount: rnd(6), sourcePostedAt: `2026-09-${String(10 + rnd(9))}T00:00:00Z` }))
      const att: Record<string, string> = {}
      for (const r of rows) if (rnd(3) === 0) att[r.sourceArticleId] = at(1 + rnd(20))
      const limit = 1 + rnd(8)
      const takenAt = new Date(`2026-09-2${String(rnd(2))}T0${String(rnd(9))}:00:00.000Z`)
      const got = ids(sel({ rows, attempted: att, limit, takenAt }))
      const want = reference(rows, attemptedMap(att), limit, takenAt)
      if (got === want) same += 1
      else if (firstDiff === '') firstDiff = `case ${k}: ${got} ≠ ${want}`
    }
    check(`🔴 🔴 **seed 만 있는 무작위 ${CASES} 경우 — 앞판과 선택·순서가 모두 같다**`, same === CASES, `${same}/${CASES} ${firstDiff}`)
  }

  // ── 러너가 이 결과를 쓰는가 — 실행 증명은 `supply:draft-deferral-e2e-db-check` ⑤ 가 한다 ──
  {
    const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
    check('🔴 러너가 축별 자리를 로그에 적는다 (정본 plan.axis)',
      /plan\.axis\.quota\.seed/.test(runner) && /plan\.axis\.quota\.raw/.test(runner) && /worksetAxisOf\(r\)/.test(runner))
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 공급 가속 P0 (2026-09-28) — ⑪ 시계 역전 · ⑫ 같은 원천 두 번째 글 금지 · ⑬ 운영 33원천 · ⑭ 재시도 차례
// ─────────────────────────────────────────────────────────
const P0_CANON = {
  ruleVersion: 'auto-judge-v3', promptVersion: 'semantic-shadow-v2c', judgeModel: 'claude-haiku-4.5',
}
const P0_BASE: GenerationContract = {
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
const pj = (o: Partial<PriorJudgementRow> = {}): PriorOutcome => judgementOutcome({
  sourceArticleId: 's1', inputHash: 'h1',
  ruleVersion: P0_CANON.ruleVersion, promptVersion: P0_CANON.promptVersion, model: P0_CANON.judgeModel,
  decision: 'AUTO_SEED', semanticStatus: 'ok', decidedAt: '2026-09-24T05:15:10.850Z', ...o,
}, 'h1', P0_CANON)!
const pa = (o: Partial<PriorArtifactRow> = {}): PriorOutcome => artifactOutcome({
  sourceArticleId: 's1', artifactVersion: ARTIFACT_VERSION, contract: P0_BASE,
  outcome: 'hold', retryable: false, generatedAt: '2026-09-24T05:15:00.850Z', ...o,
}, P0_BASE, ARTIFACT_VERSION)!
/** 🔴 공급 러너가 적는 회차 기록 모양 그대로 — 칸만 읽는다 */
const runRecord = (runId: string, startedAt: string, judge: [string, string] | null): unknown => ({
  runId, startedAt, status: 'done', completedAt: null,
  stages: judge === null ? [] : [
    { stage: 'judge', source: null, status: 'ok', exitCode: 0, startedAt: judge[0], endedAt: judge[1], note: '' },
    { stage: 'draft', source: null, status: 'ok', exitCode: 0, startedAt: judge[1], endedAt: judge[1], note: '' },
  ],
})
const latestOf = (rows: readonly PriorOutcome[]): PriorOutcome | undefined => latestOutcomes(rows).get('s1')

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 🔴 🔴 같은 회차 안의 순서는 단계 순서다 — 벽시계가 아니다 (2026-09-28 시계 역전)')
// ─────────────────────────────────────────────────────────
{
  const RUN_AT = '2026-09-24T05:15:00.850Z'
  const W1 = runWindowOf(runRecord('20260924-051500', RUN_AT, ['2026-09-24T05:15:02.000Z', '2026-09-24T05:15:20.000Z']))
  const NEXT_AT = '2026-09-24T08:15:04.100Z'
  const W2 = runWindowOf(runRecord('20260924-081504', NEXT_AT, ['2026-09-24T08:15:06.000Z', '2026-09-24T08:15:30.000Z']))
  check('🔴 회차 기록에서 구간을 읽는다 — runId · 회차 시각 · 판정 구간',
    W1 !== null && W1.runId === '20260924-051500' && W1.runAtMs === Date.parse(RUN_AT)
    && W1.judge?.startMs === Date.parse('2026-09-24T05:15:02.000Z') && W2 !== null)
  const WINS: RunWindow[] = [W1!, W2!]

  // ── (1) 같은 회차 · 판정이 초안보다 10초 늦게 적혔다 → 초안이 이긴다 ──
  const judgeLate = pj({ decidedAt: '2026-09-24T05:15:10.850Z', runAt: RUN_AT, runId: '20260924-051500' })
  const draftHold = pa({ generatedAt: RUN_AT, outcome: 'hold', retryable: false })
  check('🔴 🔴 **(1) 같은 회차 · 판정 decidedAt 이 10초 늦어도 초안(terminal)이 최신이다** — 판정 기록 칸(runAt)',
    latestOf([judgeLate, draftHold])?.stage === 'draft' && latestOf([draftHold, judgeLate])?.stage === 'draft'
    && latestOf([judgeLate, draftHold])?.state === 'terminal',
    JSON.stringify(latestOf([judgeLate, draftHold])))
  const legacyJudge = pj({ decidedAt: '2026-09-24T05:15:10.850Z' })
  check('🔴 🔴 **(1) 벽시계만 보면 판정(seeded)이 이긴다** — 결함이 fixture 에서 재현된다',
    latestOf([legacyJudge, draftHold])?.stage === 'judge' && latestOf([legacyJudge, draftHold])?.state === 'seeded')
  check('🔴 🔴 **(1) 회차 칸이 없는 옛 판정도 회차 기록의 판정 구간으로 같은 회차를 찾는다 → 초안이 이긴다**', (() => {
    const at = attributeRuns([legacyJudge, draftHold], WINS)
    return latestOf(at)?.stage === 'draft' && at[0]?.run?.id === '20260924-051500'
      && at[0]?.run?.atMs === Date.parse(RUN_AT) && at[1]?.run?.id === '20260924-051500'
  })())
  check('🔴 🔴 **(1) 판정 기록 줄이 적은 runAt 을 읽는다** (`shadowRecordOutcome`)', (() => {
    const o = shadowRecordOutcome({
      sourceArticleId: 's1', inputHash: 'h1', ruleVersion: P0_CANON.ruleVersion,
      promptVersion: P0_CANON.promptVersion, model: P0_CANON.judgeModel, decision: 'AUTO_SEED',
      semanticStatus: 'ok', decidedAt: '2026-09-24T05:15:10.850Z', runAt: RUN_AT, runId: '20260924-051500',
    }, new Map([['s1', 'h1']]), P0_CANON)
    return o?.run?.atMs === Date.parse(RUN_AT) && o.run.id === '20260924-051500' && o.atMs === Date.parse('2026-09-24T05:15:10.850Z')
  })())

  // ── (2) 다음 회차의 판정은 앞 회차의 초안을 이긴다 ──
  const draftPrev = pa({ generatedAt: RUN_AT, outcome: 'adopt', retryable: false })
  const judgeNext = pj({ decidedAt: '2026-09-24T08:15:08.000Z', decision: 'AUTO_HOLD', runAt: NEXT_AT, runId: '20260924-081504' })
  check('🔴 🔴 **(2) 다음 회차 판정(HOLD)이 앞 회차 초안(candidate)을 이긴다**',
    latestOf([draftPrev, judgeNext])?.stage === 'judge' && latestOf([judgeNext, draftPrev])?.state === 'terminal')
  check('🔴 🔴 **(2) 회차 칸 없는 옛 판정도 다음 회차 구간으로 찾으면 앞 회차 초안을 이긴다**', (() => {
    const old = pj({ decidedAt: '2026-09-24T08:15:08.000Z', decision: 'AUTO_HOLD' })
    const at = attributeRuns([draftPrev, old], WINS)
    return latestOf(at)?.stage === 'judge' && at[1]?.run?.id === '20260924-081504'
  })())
  check('🔴 🔴 **(2) 다음 회차 초안은 그 회차 판정 뒤다 — 회차가 바뀌어도 규칙은 하나**', (() => {
    const d2 = pa({ generatedAt: NEXT_AT, outcome: 'hold', retryable: false })
    return latestOf([judgeNext, d2, draftPrev, judgeLate])?.stage === 'draft'
      && latestOf([judgeNext, d2, draftPrev, judgeLate])?.atMs === Date.parse(NEXT_AT)
  })())

  // ── (3) 시각이 같으면 초안이 이긴다 ──
  check('🔴 🔴 **(3) 같은 시각이면 초안이 이긴다** — 회차 정보가 없어도',
    latestOf([pj({ decidedAt: RUN_AT }), pa({ generatedAt: RUN_AT })])?.stage === 'draft'
    && latestOf([pa({ generatedAt: RUN_AT }), pj({ decidedAt: RUN_AT })])?.stage === 'draft')
  check('🔴 🔴 **(3) 같은 회차 시각이면 기록 시각과 무관하게 초안이 이긴다** (`isLaterOutcome`)',
    isLaterOutcome(draftHold, judgeLate) && !isLaterOutcome(judgeLate, draftHold)
    && runClockOf(judgeLate) === runClockOf(draftHold))

  // ── (4) 초안이 terminal 이면 재시도 풀을 떠난다 ──
  check('🔴 🔴 **(4) 같은 회차 terminal 초안은 재시도 풀을 떠난다** (concluded)', (() => {
    const at = attributeRuns([legacyJudge, draftHold], WINS)
    const done = concludedSourceIds(at)
    const p = sel({
      rows: [ROW({ sourceArticleId: 's1', commentCount: 50 }), ROW({ sourceArticleId: 'n1', commentCount: 1 })],
      concluded: [...done], attemptedOutcomes: attemptedOutcomes(at), limit: 5,
    })
    return done.has('s1') && !p.workset.sourceIds.includes('s1') && p.dropped.terminal === 1
  })())
  check('🔴 🔴 **(4) 벽시계 규칙이면 같은 원천이 seeded 로 남아 재시도 풀에 머문다** — 고치기 전 모양',
    !concludedSourceIds([legacyJudge, draftHold]).has('s1'))
  check('🔴 retryable 초안은 끝이 아니다 — 재시도 풀에 남는다',
    !concludedSourceIds(attributeRuns([legacyJudge, pa({ generatedAt: RUN_AT, retryable: true })], WINS)).has('s1'))

  // ── 경계 — 모르는 것을 안다고 하지 않는다 ──
  check('🔴 판정 구간 밖(손으로 부른 판정)은 회차를 붙이지 않는다 — 자기 시각이다', (() => {
    const at = attributeRuns([pj({ decidedAt: '2026-09-24T06:00:00.000Z' })], WINS)
    return at[0]?.run === undefined
  })())
  check('🔴 구간이 겹치는 두 회차에 걸리면 붙이지 않는다', (() => {
    const dup = runWindowOf(runRecord('20260924-051501', '2026-09-24T05:15:01.000Z', ['2026-09-24T05:15:05.000Z', '2026-09-24T05:15:30.000Z']))!
    return attributeRuns([legacyJudge], [...WINS, dup])[0]?.run === undefined
  })())
  check('🔴 기록이 적은 회차가 우선이다 — 구간으로 덮어쓰지 않는다',
    attributeRuns([judgeNext], WINS)[0]?.run?.id === '20260924-081504'
    && attributeRuns([pj({ decidedAt: '2026-09-24T05:15:10.850Z', runAt: NEXT_AT, runId: 'X' })], WINS)[0]?.run?.id === 'X')
  check('🔴 모양이 틀린 회차 기록은 구간이 아니다',
    runWindowOf(null) === null && runWindowOf({ runId: '', startedAt: RUN_AT }) === null
    && runWindowOf({ runId: 'r', startedAt: 'not-a-time' }) === null
    && runWindowOf(runRecord('r', RUN_AT, ['2026-09-24T05:15:20.000Z', '2026-09-24T05:15:02.000Z']))?.judge === null)
  check('🔴 🔴 **파일 이름에서 회차를 읽지 않는다** — 정본 함수에 파일명 파싱이 없다', (() => {
    const lib = readFileSync('src/lib/supply-workset.ts', 'utf-8')
    const reader = readFileSync('scripts/lib/prior-outcomes.mts', 'utf-8')
    const body = lib.slice(lib.indexOf('export function runWindowOf'), lib.indexOf('/** 🔴 `#` 뒤 조각을 뗀 원문 id'))
    return !/auto-judge-|auto-draft-|\\d\{8\}-\\d\{6\}/.test(body) && /attributeRuns\(out, readRunWindows\(o\.dataDir\)\)/.test(reader)
  })())
  check('🔴 🔴 **판정 러너가 회차 칸(runAt · runId)을 기록에 적는다**', (() => {
    const judge = readFileSync('scripts/micro-seed-auto-judge.mts', 'utf-8')
    return /const RUN_CLOCK = runClockFrom\(process\.env\)/.test(judge)
      && /runAt: RUN_CLOCK\.at\.toISOString\(\)/.test(judge)
      && /JSON\.stringify\(\{ \.\.\.jd, \.\.\.runStamp \}\)/.test(judge)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ 🔴 🔴 같은 원문으로 두 번째 글을 만들지 않는다 (2026-09-28 · C)')
// ─────────────────────────────────────────────────────────
{
  const at = (h: number): string => `2026-09-20T${String(h).padStart(2, '0')}:00:00.000Z`
  const SITE = (id: string, site: string, c = 10): WorksetRow => ({ ...ROW({ sourceArticleId: id, commentCount: c }), sourceSite: site })
  const queued = queuedSourceKeysOf([
    // 기계 행 · 발행 완료 — 상태를 보지 않는다
    { sourceSite: 'publish-candidate:auto:navercafe:wgang', sourceArticleId: 'p1-abcdef12' },
    // 사람 행 · `#` 조각이 있는 원천
    { sourceSite: 'publish-candidate:navercafe:wgang', sourceArticleId: 'p2#c3-1234abcd' },
    // 글(Post) 쪽 옛 모양 — `사이트:id`
    { sourceSite: '82cook', sourceArticleId: '82cook:777' },
    // 빈 id 는 아무것도 막지 않는다
    { sourceSite: 'publish-candidate:auto:navercafe:wgang', sourceArticleId: '' },
  ])
  check('🔴 원래 원천으로 되돌린다 — synthetic 접두 · 해시 · `#` 조각 · `사이트:` 접두',
    JSON.stringify(originalSourceOf('publish-candidate:auto:navercafe:wgang', 'p1-abcdef12')) === JSON.stringify({ site: 'navercafe:wgang', id: 'p1' })
    && JSON.stringify(originalSourceOf('publish-candidate:navercafe:wgang', 'p2#c3-1234abcd')) === JSON.stringify({ site: 'navercafe:wgang', id: 'p2' })
    && JSON.stringify(originalSourceOf('navercafe:remonterrace', 'navercafe:remonterrace:34783204')) === JSON.stringify({ site: 'navercafe:remonterrace', id: '34783204' })
    && originalSourceOf('x', '') === null && originalSourceOf(null, null) === null)
  check('🔴 사이트까지 맞춘다 — 다른 카페의 같은 글 번호는 다른 원천이다',
    hasSource(queued, 'navercafe:wgang', 'p1') && !hasSource(queued, 'navercafe:remonterrace', 'p1')
    && hasSource(queued, 'navercafe:wgang', 'p2#c9') && hasSource(queued, '82cook', '777'))
  check('🔴 행의 사이트를 모르면 id 만으로 막는다 — 모르는 사이트로 중복을 통과시키지 않는다',
    hasSource(queued, '', 'p1') && !hasSource(queued, '', 'zzz'))

  const rows = [
    SITE('p1', 'navercafe:wgang', 90), SITE('p2#c9', 'navercafe:wgang', 80), SITE('777', '82cook', 70),
    SITE('p1', 'navercafe:remonterrace', 60), SITE('fresh', 'navercafe:wgang', 50),
  ]
  // 🔴 같은 id 두 사이트는 `selectWorkset` 이 id 로 합친다 — 그래서 다른 카페 행은 id 를 달리해 본다
  const rows2 = [...rows.slice(0, 3), SITE('q1', 'navercafe:remonterrace', 60), SITE('fresh', 'navercafe:wgang', 50)]
  const p = sel({ rows: rows2, queuedSources: queued, limit: 10 })
  check('🔴 🔴 **발행된 형제가 있는 원천 · `#` 형제 · 옛 글 원천은 고르지 않는다**',
    p.workset.sourceIds.join(',') === 'q1,fresh' && p.dropped.alreadyQueued === 3,
    `${p.workset.sourceIds.join(',')} · alreadyQueued ${p.dropped.alreadyQueued}`)
  check('🔴 🔴 **재시도 풀에서도 빠진다 — candidate 로 남아 있던 원천**', (() => {
    const att = new Map<string, PriorOutcome>([
      ['p1', pa({ sourceArticleId: 'p1', outcome: 'adopt', retryable: false })],
      ['q1', pa({ sourceArticleId: 'q1', outcome: 'adopt', retryable: false })],
    ])
    const r = sel({ rows: rows2, queuedSources: queued, attemptedOutcomes: att, limit: 10 })
    return !r.workset.sourceIds.includes('p1') && r.workset.sourceIds.includes('q1')
  })())
  check('🔴 🔴 **변이 대조 — 빈 집합이면(앞판) 발행된 원천이 다시 뽑힌다**',
    sel({ rows: rows2, limit: 10 }).workset.sourceIds.includes('p1'))
  check('🔴 러너가 큐 **전체**(상태 무관)와 글 원천을 읽어 넘긴다 — 미발행만이 아니다', (() => {
    const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
    return /queuedSources = queuedSourceKeysOf\(\[/.test(runner)
      && /prisma\.post\.findMany\(\{\s*where: \{ sourceArticleId: \{ not: null \} \}/.test(runner)
      && /queuedSources,\n/.test(runner)
      && /if \(snapOk && queuedSources !== null && policy\.llm\)/.test(runner)
  })())

  // ── (5) 적재 실패 후보만 이월로 되살린다 — 다시 만들지 않는다 ──
  const cand = (id: string): PriorOutcome => pa({ sourceArticleId: id, outcome: 'adopt', retryable: false, generatedAt: at(3) })
  const att5 = new Map<string, PriorOutcome>([['c1', cand('c1')], ['c2', cand('c2')], ['c3', cand('c3')]])
  const carried = queuedSourceKeysOf([{ sourceSite: 'navercafe:wgang', sourceArticleId: 'c1' }])
  const queued5 = queuedSourceKeysOf([{ sourceSite: 'publish-candidate:auto:navercafe:wgang', sourceArticleId: 'c2-0badf00d' }])
  const p5 = sel({
    rows: [SITE('c1', 'navercafe:wgang', 5), SITE('c2', 'navercafe:wgang', 5), SITE('c3', 'navercafe:wgang', 5)],
    queuedSources: queued5, carriedOver: carried, attemptedOutcomes: att5, limit: 10,
  })
  check('🔴 🔴 **(5) 적재 실패 후보(c1)는 이월이 적재한다 — 묶음이 다시 만들지 않는다**',
    !p5.workset.sourceIds.includes('c1') && p5.dropped.carriedOver === 1)
  check('🔴 🔴 **(5) 큐 행이 이미 있는 후보(c2)는 다시 만들지 않는다**',
    !p5.workset.sourceIds.includes('c2') && p5.dropped.alreadyQueued === 1)
  check('🔴 (5) 큐에도 이월에도 없는 candidate(c3)는 재시도로 남는다 — 기한 밖 등',
    p5.workset.sourceIds.join(',') === 'c3')
  check('🔴 🔴 **(5) 이월은 적재를 끝내지 못한 파일만 고르고 그 원천을 넘긴다**', (() => {
    const env = {}
    const r = selectCarryOver({
      files: [
        { name: 'auto-draft-20260927-051506.candidates.json', envelope: env, candidateCount: 1, sources: [{ sourceSite: 'navercafe:wgang', sourceArticleId: 'c1' }] },
        { name: 'auto-draft-20260927-081505.candidates.json', envelope: env, candidateCount: 1, sources: [{ sourceSite: 'navercafe:wgang', sourceArticleId: 'c9' }] },
      ],
      runs: [
        { runId: '20260927-051506', stages: [{ stage: 'draft', status: 'ok' }, { stage: 'fill', status: 'failed' }] },
        { runId: '20260927-081505', stages: [{ stage: 'draft', status: 'ok' }, { stage: 'fill', status: 'ok' }] },
      ],
      currentRunId: '20260927-121504', nowMs: Date.parse('2026-09-27T12:15:04Z'),
    })
    const picked = r.picked.map((x) => x.name)
    // 🔴 품질 계약이 빈 봉투는 CONTRACT 로 빠질 수 있다 — 여기서는 "끝낸 파일은 고르지 않는다" 와 원천 전달만 본다
    return !picked.includes('auto-draft-20260927-081505.candidates.json')
      && r.rejected.some((x) => x.name === 'auto-draft-20260927-081505.candidates.json' && x.code === 'COMPLETED')
      && r.picked.every((x) => x.sources.length === x.candidateCount)
  })())
  check('🔴 러너가 이월 원천을 묶음에 넘긴다', /carriedOver: queuedSourceKeysOf\(carry\.picked\.flatMap\(\(x\) => x\.sources\)\)/
    .test(readFileSync('scripts/supply-process.mts', 'utf-8')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑬ 🔴 🔴 운영 33원천 재분류 — 읽기 전용 fixture (20260924-051500 이후 시계 역전)')
// ─────────────────────────────────────────────────────────
{
  type FxRec = {
    stage: 'judge' | 'draft'; decidedAt?: string; decision?: string; semanticStatus?: string
    generatedAt?: string; machineOutcome?: string; retryable?: boolean | null; cause?: string | null
  }
  type Fx = {
    kind: string
    sources: { sourceArticleId: string; invertedRun: string[]; records: FxRec[]
      expected: { state: string; stage: string; runId: string }; wallClock: { state: string; stage: string } }[]
    runs: unknown[]
  }
  const fx = JSON.parse(readFileSync('scripts/__fixtures__/supply/clock-inversion-33.json', 'utf-8')) as Fx
  const wins = fx.runs.map((r) => runWindowOf(r, (r as { manifest?: unknown }).manifest ?? undefined))
    .filter((w): w is RunWindow => w !== null)
  const outcomesOf = (src: Fx['sources'][number]): PriorOutcome[] => src.records.map((r) => (r.stage === 'judge'
    ? pj({ sourceArticleId: src.sourceArticleId, decidedAt: r.decidedAt ?? '', decision: r.decision ?? '', semanticStatus: r.semanticStatus ?? '' })
    : pa({ sourceArticleId: src.sourceArticleId, generatedAt: r.generatedAt ?? '', outcome: r.machineOutcome ?? '', retryable: r.retryable ?? null })))
  check('🔴 fixture 는 33원천이다', fx.kind === 'supply-clock-inversion-fixture' && fx.sources.length === 33, `${fx.sources.length}`)
  check('🔴 🔴 **원문·제목·본문·화자가 없다** — id · 시각 · 결과 · 회차 구간만', (() => {
    const allowed = new Set(['stage', 'decidedAt', 'decision', 'semanticStatus', 'generatedAt', 'machineOutcome', 'retryable', 'cause'])
    const txt = readFileSync('scripts/__fixtures__/supply/clock-inversion-33.json', 'utf-8')
    return fx.sources.every((s) => s.records.every((r) => Object.keys(r).every((k) => allowed.has(k))))
      && !/"(title|body|bodyHead|rawTitle|rawBody|personaCode|nickname|evidence|plan|voice)"\s*:/.test(txt)
  })())
  let fixed = 0
  let wallBug = 0
  let runMatch = 0
  const got: Record<string, number> = {}
  const miss: string[] = []
  for (const src of fx.sources) {
    const plain = outcomesOf(src)
    const wall = latestOutcomes(plain).get(src.sourceArticleId)
    if (wall?.stage === src.wallClock.stage && wall.state === src.wallClock.state && wall.stage === 'judge') wallBug += 1
    const now = latestOutcomes(attributeRuns(plain, wins)).get(src.sourceArticleId)
    if (now?.stage === src.expected.stage && now.state === src.expected.state) fixed += 1
    else miss.push(`${src.sourceArticleId}:${now?.stage}:${now?.state}≠${src.expected.stage}:${src.expected.state}`)
    if (now?.run?.id === src.expected.runId) runMatch += 1
    got[now?.state ?? '?'] = (got[now?.state ?? '?'] ?? 0) + 1
  }
  check('🔴 🔴 **고치기 전 규칙(벽시계)으로는 33원천 모두 판정 seeded 가 최신이다** — 결함 재현',
    wallBug === 33, `${wallBug}/33`)
  check('🔴 🔴 **고친 규칙으로 33원천 모두 정답표(파일 회차로 만든 것)와 같다**',
    fixed === 33, `${fixed}/33 ${miss.slice(0, 3).join(' ')}`)
  check('🔴 🔴 **최신 기록의 회차를 파일 이름 없이 찾았다 — 정답표의 회차와 33/33 같다**',
    runMatch === 33, `${runMatch}/33`)
  check('🔴 🔴 **재분류 — candidate 18 · terminal 9 · retryable 6 (seeded 0)**',
    got.candidate === 18 && got.terminal === 9 && got.retryable === 6 && (got.seeded ?? 0) === 0, JSON.stringify(got))
  check('🔴 🔴 **terminal 9원천이 재시도 풀을 떠난다**', (() => {
    const all = fx.sources.flatMap((s) => attributeRuns(outcomesOf(s), wins))
    return concludedSourceIds(all).size === 9
      && concludedSourceIds(fx.sources.flatMap((s) => outcomesOf(s))).size === 0
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑭ 🔴 🔴 재시도 차례 — 초안 없는 seeded 가 판정 retryable 보다 먼저 (2026-09-28)')
// ─────────────────────────────────────────────────────────
{
  const at = (h: number): string => `2026-09-20T${String(h).padStart(2, '0')}:00:00.000Z`
  const R = (id: string, c: number): WorksetRow => ROW({ sourceArticleId: id, commentCount: c })
  const att = new Map<string, PriorOutcome>([
    // 판정 retryable 이 **가장 오래** 기다렸다 — 그래도 seeded 가 먼저다
    ['jr', pj({ sourceArticleId: 'jr', semanticStatus: 'providerError', decidedAt: at(1) })],
    ['dr', pa({ sourceArticleId: 'dr', retryable: true, generatedAt: at(3) })],
    ['sd', pj({ sourceArticleId: 'sd', decision: 'AUTO_SEED', decidedAt: at(9) })],
  ])
  check('🔴 차례 값 — seeded 0 · 생성 결과 1 · 판정 retryable 2',
    retryTierOf(att.get('sd')) === 0 && retryTierOf(att.get('dr')) === 1 && retryTierOf(att.get('jr')) === 2
    && att.get('jr')?.state === 'retryable' && att.get('sd')?.state === 'seeded')
  const fresh = Array.from({ length: 20 }, (_, i) => R(`n${i}`, 90 - i))
  const rows = [...fresh, R('jr', 1), R('dr', 1), R('sd', 1)]
  const p5 = sel({ rows, attemptedOutcomes: att, limit: 5 })
  check('🔴 🔴 **상한 5 · 재시도 1 자리 → seeded(sd)** — 더 오래 기다린 판정 retryable 보다 먼저',
    p5.workset.sourceIds.filter((x) => !x.startsWith('n')).join(',') === 'sd', p5.workset.sourceIds.join(','))
  const p10 = sel({ rows, attemptedOutcomes: att, limit: 10 })
  check('🔴 🔴 **상한 10 · 재시도 2 자리 → sd · dr**',
    p10.workset.sourceIds.filter((x) => !x.startsWith('n')).join(',') === 'sd,dr', p10.workset.sourceIds.join(','))
  const pAll = sel({ rows: [R('jr', 1), R('dr', 1), R('sd', 1)], attemptedOutcomes: att, limit: 10 })
  check('🔴 신규가 없으면 재시도가 전부 — 차례대로 sd · dr · jr',
    pAll.workset.sourceIds.join(',') === 'sd,dr,jr', pAll.workset.sourceIds.join(','))
  check('🔴 상한 10 — seed 8 · raw 2 기본 자리 · raw 는 빠지지 않는다',
    JSON.stringify(worksetAxisQuota(10, { seed: 30, raw: 30 })) === JSON.stringify({ seed: 8, raw: 2 })
    && JSON.stringify(worksetAxisQuota(10, { seed: 3, raw: 30 })) === JSON.stringify({ seed: 3, raw: 2 })
    && JSON.stringify(worksetAxisQuota(10, { seed: 30, raw: 1 })) === JSON.stringify({ seed: 9, raw: 1 }))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 함수와 소스 계약만 본다 — provider 0 · DB 0 · 파일 write 0.')
if (fail > 0) process.exit(1)
