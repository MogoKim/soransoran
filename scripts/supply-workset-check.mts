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
  baseIdOf, judgeStageBudget, readWorkset, selectWorkset, terminalSourceIds,
  type PriorArtifact, type PriorJudgement,
  WORKSET_DEFAULT_LIMIT, WORKSET_KIND, WORKSET_STAGE_PER_SOURCE, WORKSET_TOTAL_PER_SOURCE,
  WORKSET_VERSION, worksetFileName, type WorksetRow,
} from '../src/lib/supply-workset'
import {
  ledgerRunIdOf, planBoundedCommonPhase, planCommonPhase, type Pending,
} from '../src/lib/supply-process'
import { mergeJudgeRows, SEED_AXIS } from '../src/lib/micro-seed-auto-judge'
import {
  artifactRetryable, INCOMPLETE_LABEL, RETRYABLE_REASONS,
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
      lane: 'seed', assetAxes: '', safetyReasons: '', bodyLength: 300, qualityFlags: [],
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
const sel = (o: {
  rows: readonly WorksetRow[]
  humanDecided?: readonly string[]
  queuePending?: readonly string[]
  terminal?: readonly string[]
  limit?: number
}) => selectWorkset({
  rows: o.rows,
  humanDecided: new Set(o.humanDecided ?? []),
  queuePending: new Set(o.queuePending ?? []),
  terminal: new Set(o.terminal ?? []),
  limit: o.limit ?? 5, runId: RUN, takenAt: NOW,
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
  const p = sel({ rows, humanDecided: ['a1'], queuePending: ['c3'], terminal: ['b2'], limit: 5 })
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
  check('🔴 잘림·사용량 미상은 계속 통과가 아니다', (() => {
    const run = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
    return /if \(r\.truncated\) return \{ complete: false, reason: 'truncated' \}/.test(run)
      && /if \(!r\.usageKnown\) return \{ complete: false, reason: 'usageUnknown' \}/.test(run)
  })())
  check('🔴 🔴 **Post 를 쓰지 않는다 · 사람 미검토 발행 0**', (() => {
    const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
    const fillSrc = readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')
    return !/prisma\.post\.(create|update|delete)/.test(runner)
      && /HUMAN_ONLY_VALUES/.test(fillSrc)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 🔴 terminal 은 지금 입력·지금 판의 최신 결과 하나다 (2026-09-20)')
// ─────────────────────────────────────────────────────────
{
  const CANON = {
    ruleVersion: 'auto-judge-v3', promptVersion: 'semantic-shadow-v2c',
    judgeModel: 'claude-haiku-4.5', artifactVersion: 'human-review-v7',
  }
  const CUR = [{ sourceArticleId: 's1', inputHash: 'h1' }]
  const J = (o: Partial<PriorJudgement> & { order: string }): PriorJudgement => ({
    sourceArticleId: 's1', inputHash: 'h1',
    ruleVersion: CANON.ruleVersion, promptVersion: CANON.promptVersion, model: CANON.judgeModel,
    decision: 'AUTO_HOLD', semanticStatus: 'ok', ...o,
  })
  const A = (o: Partial<PriorArtifact> & { order: string }): PriorArtifact => ({
    sourceArticleId: 's1', artifactVersion: CANON.artifactVersion,
    outcome: 'hold', retryable: false, ...o,
  })
  const T = (j: PriorJudgement[], a: PriorArtifact[] = []): Set<string> =>
    terminalSourceIds({ current: CUR, judgements: j, artifacts: a, canon: CANON })

  check('🔴 정상으로 끝난 HOLD 는 terminal 이다', T([J({ order: '1' })]).has('s1'))
  check('🔴 🔴 **옛 HOLD 뒤 최신 SEED 면 terminal 이 아니다**',
    !T([J({ order: '1' }), J({ order: '2', decision: 'AUTO_SEED' })]).has('s1'))
  check('🔴 🔴 **옛 hard HOLD 뒤 최신 재시도 실패면 terminal 이 아니다**',
    !T([J({ order: '1' }), J({ order: '2', semanticStatus: 'timeout' })]).has('s1'))
  check('🔴 순서가 거꾸로 와도 최신이 이긴다',
    !T([J({ order: '2', decision: 'AUTO_SEED' }), J({ order: '1' })]).has('s1'))

  // ── 지금 입력·지금 판이 아니면 보지 않는다 ──
  check('🔴 🔴 **입력 지문이 바뀌면 옛 결론을 쓰지 않는다**',
    !T([J({ order: '1', inputHash: 'old' })]).has('s1'))
  for (const [name, patch] of [
    ['규칙 판', { ruleVersion: 'auto-judge-v2' }],
    ['프롬프트 판', { promptVersion: 'semantic-shadow-v2' }],
    ['모델', { model: 'other-model' }],
  ] as const) {
    check(`🔴 🔴 **${name}이 바뀌면 다시 평가할 수 있다**`,
      !T([J({ order: '1', ...patch })]).has('s1'))
  }
  check('🔴 지금 고르지 않는 원천은 세지 않는다',
    T([J({ order: '1', sourceArticleId: 'other' })]).size === 0)

  // ── 생성 쪽 ──
  check('🔴 완주 뒤 확정 HOLD 는 terminal 이다', T([], [A({ order: '3' })]).has('s1'))
  check('🔴 🔴 **재시도 대상 artifact 는 terminal 이 아니다**',
    !T([], [A({ order: '3', retryable: true })]).has('s1'))
  check('🔴 artifact 판이 바뀌면 보지 않는다',
    !T([], [A({ order: '3', artifactVersion: 'human-review-v6' })]).has('s1'))
  check('🔴 adopt 는 terminal 이 아니다 — 후보가 됐고 큐 형제로 걸린다',
    !T([], [A({ order: '3', outcome: 'adopt' })]).has('s1'))
  check('🔴 🔴 **판정 HOLD 뒤 생성이 재시도 대상이면 최신이 이긴다**',
    !T([J({ order: '1' })], [A({ order: '2', retryable: true })]).has('s1'))

  // ── 재시도 사유 어휘 ──
  check('🔴 🔴 **재시도 사유 다섯 가지**',
    RETRYABLE_REASONS.join(',') === 'truncated,noResponse,parseFailed,usageUnknown,budgetBlocked')
  for (const r of RETRYABLE_REASONS) {
    check(`🔴 ${r} 는 재시도다`,
      artifactRetryable({ semanticCompletion: { complete: false, reason: r } }))
  }
  check('🔴 🔴 **notRun 은 원인으로 가른다 — 예산이면 재시도**',
    artifactRetryable({
      semanticCompletion: { complete: false, reason: 'notRun' },
      machineReason: `화자 계획을 완주하지 못했다 (${INCOMPLETE_LABEL.budgetBlocked})`,
    }))
  check('🔴 🔴 **notRun 이라도 자격 실패면 결론이다**',
    !artifactRetryable({
      semanticCompletion: { complete: false, reason: 'notRun' },
      machineReason: '1인칭 허가 실패 — 그 사람의 카드가 이 값을 충족하지 않는다',
    }))
  check('🔴 🔴 **잘림도 원인 문구로 잡는다**',
    artifactRetryable({
      semanticCompletion: { complete: false, reason: 'notRun' },
      machineReason: `초안 생성을 완주하지 못했다 (${INCOMPLETE_LABEL.truncated})`,
    }))
  check('🔴 완주한 확정 HOLD 는 재시도가 아니다',
    !artifactRetryable({ semanticCompletion: { complete: true, reason: null }, machineReason: '생활사 모순 work' }))
  check('🔴 읽지 못한 것은 결론으로 보지 않는다', artifactRetryable(null))
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
