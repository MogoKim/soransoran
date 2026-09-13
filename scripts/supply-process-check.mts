#!/usr/bin/env tsx
/**
 * 공급 처리(drain) 검사 — 🔴 **네트워크 0 · LLM 0 · DB 0 · launchctl 0**
 *
 * 🔴 **문자열이 아니라 행동을 본다.** 이 검사가 지키는 것은 하나다 —
 *    **한 source 가 죽어도 다른 source 의 공급은 계속된다.**
 *
 *    옛 `supply-autopilot` 은 수집·판정·적재를 한 회차에 묶었고, 82cook 하나가
 *    `ECONNREFUSED` 이면 이미 받아 둔 네이버 thin 까지 Raw 로 가지 못했다(09-10 실측:
 *    이틀간 신규 공급 0). 그래서 여기서는 **가짜 exec 를 주입해 호출 순서와 횟수**를 본다.
 *    "실패해도 계속한다" 는 주석은 검사가 아니다.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  COMMON_STAGES, LOCK_FILE, LOCK_TTL_MS, NETWORK_STAGES, PER_SOURCE_STAGES,
  PROCESS_KILL_SWITCH_ENV, RUN_FILE_RE, SUPPLY_SOURCES,
  adaptKeyOf, hasWork, judgeBuffer, judgeProcessRun,
  mayWriteRunState, planCommonPhase, planPending, planSourcePhase,
  runCommonPhase, runSourcePhase, runStatusOf, sourceOfDataFile, verifyRun,
  type ExecResult, type ProcessStage, type StagePlan, type SupplySourceId,
} from '../src/lib/supply-process'
import { DATA_DIR_NAME } from '../src/lib/micro-seed-82cook-thin-adapt'
import { STOCK_BANDS } from '../src/lib/supply-stock-plan'
/** 🔴 잠금 정본 — 러너와 **같은 함수**를 시험한다. 사본을 만들지 않는다 */
import { acquireLock, lockAnomaly, releaseLock } from './lib/collect-lock.mjs'
import { planRefill, provenanceKeyOf, type Candidate, type HeldEntry, type QueueRow } from '../src/lib/micro-seed-supply-autofill'
import { collectArgsFor, planCafeRun } from './lib/navercafe-run-plan.mjs'
import { BOARD_TARGETS, pagesOf } from './lib/micro-seed-navercafe.mjs'
import { MAX_REQUESTS_PER_DAY, RUNS_PER_DAY, THIN_82COOK_RUNS_PER_DAY, thin82cookCapPerRun } from '../src/lib/collect-schedule'
/** 🔴 운영 job 정본 — 여기에 label 을 다시 적지 않는다 */
import { RETIRED_JOBS, RUNTIME_JOBS } from '../src/lib/runtime-isolation'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}`) }
}

console.log('\n══ 공급 처리(drain) 검사 (🔴 네트워크 0 · LLM 0 · DB 0) ══\n')

// ─────────────────────────────────────────────────────────
// 도구 — 🔴 가짜 exec. 어떤 단계에서 실패시킬지 지정한다
// ─────────────────────────────────────────────────────────
type Fail = { stage: ProcessStage; source: SupplySourceId | null }
const NOW = (): string => '2026-09-11T12:00:00.000Z'

function fakeExec(failures: readonly Fail[]) {
  const calls: { stage: ProcessStage; source: SupplySourceId | null; args: string[] }[] = []
  const exec = async (plan: StagePlan): Promise<ExecResult> => {
    calls.push({ stage: plan.stage, source: plan.source, args: [...plan.args] })
    const bad = failures.some((f) => f.stage === plan.stage && f.source === plan.source)
    return bad
      ? { ok: false, exitCode: 1, spawnError: '' }
      : { ok: true, exitCode: 0, spawnError: '' }
  }
  return { calls, exec }
}

/** 세 source 가 전부 밀려 있는 상태의 `.microseed-data` 목록 */
const FILES_ALL = [
  // 82cook 수집 job 이 낸 얇은 파일 (아직 adapt 안 됨)
  '82cook-thin-20260911-010000.thin-detail.jsonl',
  // remonterrace: raw 수집물 + 얇은 파일
  'navercafe-remonterrace-20260911-042000.jsonl',
  'navercafe-remonterrace-20260911-042000.list.jsonl',
  'navercafe-thin-remonterrace-20260910-222000.thin-detail.jsonl',
  // wgang: raw 수집물
  'navercafe-wgang-20260911-025000.jsonl',
  'navercafe-wgang-20260911-025000.list.jsonl',
]

const pendingAll = planPending(FILES_ALL)

/**
 * 🔴 **source 국면이 끝난 뒤의 상태.** `adapt` 가 검수용 파일을 만들었고,
 *    그것이 공통 국면(judge → draft → fill)의 입력이다.
 *    러너도 두 국면 사이에 다시 센다 — 계획을 미리 굳혀 두면 방금 만든 입력을 놓친다.
 */
/**
 * 🔴 **두 산출물이 한 짝이다.** detail 만 적어 두면 "한쪽만 있어도 완료" 라는
 *    옛 결함을 시험 데이터가 되레 고정한다 (2026-09-11 Codex 리뷰).
 */
const FILES_AFTER_ADAPT = [
  ...FILES_ALL,
  '82cook-adapt-20260911-010000.detail.jsonl',
  '82cook-adapt-20260911-010000.raw-detail.jsonl',
  '82cook-adapt-remonterrace-20260910-222000.detail.jsonl',
  '82cook-adapt-remonterrace-20260910-222000.raw-detail.jsonl',
]
const pendingAfter = planPending(FILES_AFTER_ADAPT)
const FULL_BUFFER = judgeBuffer(120)

// ─────────────────────────────────────────────────────────
console.log('① 미처리 입력을 source 별로 가른다')
// ─────────────────────────────────────────────────────────
check('🔴 82cook 얇은 파일이 82cook 몫이다', (pendingAll.thin['82cook'] ?? []).length === 1)
check('🔴 remonterrace 얇은 파일이 remonterrace 몫이다',
  (pendingAll.thin['navercafe:remonterrace'] ?? []).length === 1)
check('🔴 remonterrace raw 수집물이 cafeThin 대상이다',
  (pendingAll.rawCafe['navercafe:remonterrace'] ?? []).length === 1)
check('🔴 wgang raw 수집물이 wgang 몫이다',
  (pendingAll.rawCafe['navercafe:wgang'] ?? []).length === 1)
check('🔴 목록(.list.jsonl)은 입력이 아니다 — 본문이 없다',
  !JSON.stringify(pendingAll).includes('.list.jsonl'))
check('🔴 이미 얇아진 회차는 cafeThin 대상이 아니다', (() => {
  const p = planPending([
    'navercafe-wgang-20260911-025000.jsonl',
    'navercafe-thin-wgang-20260911-025000.thin-detail.jsonl',
  ])
  return (p.rawCafe['navercafe:wgang'] ?? []).length === 0
})())
check('🔴 같은 runId 의 다른 카페가 서로를 막지 않는다', (() => {
  const p = planPending([
    'navercafe-remonterrace-20260911-042000.jsonl',
    'navercafe-wgang-20260911-042000.jsonl',
    'navercafe-thin-remonterrace-20260911-042000.thin-detail.jsonl',
  ])
  return (p.rawCafe['navercafe:remonterrace'] ?? []).length === 0
    && (p.rawCafe['navercafe:wgang'] ?? []).length === 1
})())
/**
 * 🔴 **완료 판정 경계** — 예약 실행이 실제로 지나가는 `planPending` 에서 본다.
 *
 *    어댑터를 직접 spawn 하는 시험은 이 경로를 지나가지 않는다.
 *    옛 판은 `^82cook-adapt-(.+?)\.` 하나로 셌고, detail 만 있어도 완료였다.
 */
{
  const THIN = '82cook-thin-20260911-010000.thin-detail.jsonl'
  const D = '82cook-adapt-20260911-010000.detail.jsonl'
  const R = '82cook-adapt-20260911-010000.raw-detail.jsonl'
  const thinOf = (files: readonly string[]): string[] => planPending(files).thin['82cook'] ?? []
  const adaptPlanned = (files: readonly string[]): boolean =>
    planSourcePhase(planPending(files))
      .some((sp) => sp.source === '82cook' && sp.stages.some((st) => st.stage === 'adapt'))

  check('🔴 detail 만 있으면 아직 끝난 것이 아니다 — pending 1건',
    thinOf([THIN, D]).length === 1)
  check('🔴 detail 만 있으면 adapt 가 다시 계획된다', adaptPlanned([THIN, D]))
  check('🔴 raw-detail 만 있어도 아직 끝난 것이 아니다 — pending 1건',
    thinOf([THIN, R]).length === 1)
  check('🔴 raw-detail 만 있어도 adapt 가 다시 계획된다', adaptPlanned([THIN, R]))
  check('🔴 두 산출물이 다 있어야 끝난 것이다 — pending 0건',
    thinOf([THIN, D, R]).length === 0)
  check('🔴 두 산출물이 다 있으면 adapt 를 다시 계획하지 않는다',
    !adaptPlanned([THIN, D, R]))
  check('🔴 두 산출물이 다 있으면 공통 judge·draft·fill 이 선다', (() => {
    const stages = planCommonPhase(planPending([THIN, D, R]), judgeBuffer(24)).map((x) => x.stage)
    return stages.includes('judge') && stages.includes('draft') && stages.includes('fill')
  })())
}
check('🔴 adaptKey 는 82cook 과 카페를 구분한다',
  adaptKeyOf('82cook-thin-A.thin-detail.jsonl') === 'A'
  && adaptKeyOf('navercafe-thin-wgang-A.thin-detail.jsonl') === 'wgang-A')
check('🔴 모르는 파일은 아무 source 에도 붙이지 않는다', sourceOfDataFile('whatever.jsonl') === null)

// ─────────────────────────────────────────────────────────
console.log('\n② 처리기는 수집하지 않는다')
// ─────────────────────────────────────────────────────────
check('🔴 네트워크 단계가 하나도 없다', NETWORK_STAGES.length === 0)
check('🔴 source 단계는 파일 변환 둘뿐이다',
  PER_SOURCE_STAGES.join(',') === 'cafeThin,adapt')
check('🔴 공통 단계는 판정·초안·보충 셋뿐이다',
  COMMON_STAGES.join(',') === 'judge,draft,fill')
{
  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  const table = /const STAGE_SCRIPT: Record<ProcessStage, string> = \{[\s\S]*?\n\}/.exec(runner)?.[0] ?? ''
  check('🔴 러너의 단계표에 수집 스크립트가 없다',
    table !== ''
    && !/82cook-thin-detail|collect-82cook|collect-navercafe|navercafe-run/.test(table))
  check('🔴 러너가 수집 스크립트를 어디서도 spawn 하지 않는다',
    !/spawn[\s\S]{0,200}(collect-82cook|collect-navercafe|navercafe-run|thin-detail)/.test(runner))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 한 source 가 실패해도 다른 source 는 처리된다')
// ─────────────────────────────────────────────────────────
const plans = planSourcePhase(pendingAll)
check('🔴 계획에 세 source 가 모두 있다', plans.length === 3
  && plans.map((p) => p.source).join(',') === SUPPLY_SOURCES.join(','))

for (const [label, down, alive] of [
  ['82cook', '82cook', ['navercafe:remonterrace', 'navercafe:wgang']],
  ['remonterrace', 'navercafe:remonterrace', ['82cook', 'navercafe:wgang']],
  ['wgang', 'navercafe:wgang', ['82cook', 'navercafe:remonterrace']],
] as const) {
  // 🔴 그 source 의 **첫 단계**를 실패시킨다
  const first = plans.find((p) => p.source === down)!.stages[0]!
  const { calls, exec } = fakeExec([{ stage: first.stage, source: down }])
  const r = await runSourcePhase({ plans, exec, now: NOW })
  check(`🔴 [${label} 실패] 그 source 는 failed 로 남는다`,
    r.sources.find((s) => s.source === down)?.status === 'failed')
  check(`🟢 [${label} 실패] 나머지 source 는 ok 다`,
    alive.every((a) => r.sources.find((s) => s.source === a)?.status === 'ok'))
  check(`🟢 [${label} 실패] 나머지 source 의 단계가 실제로 호출됐다`,
    alive.every((a) => calls.some((c) => c.source === a)))
  check(`🔴 [${label} 실패] 실패한 source 의 뒤 단계는 부르지 않는다`,
    calls.filter((c) => c.source === down).length === 1)

  // 🔴 공통 국면은 **그래도 돈다** — 지난 회차가 남긴 입력은 이번 수집과 무관하다
  const common = planCommonPhase(pendingAfter, FULL_BUFFER)
  const c2 = fakeExec([])
  const r2 = await runCommonPhase({ plan: common, exec: c2.exec, now: NOW })
  check(`🟢 [${label} 실패] 공통 단계(판정→초안→보충)는 계속 돈다`,
    c2.calls.map((c) => c.stage).join(',') === 'judge,draft,fill'
    && r2.outcomes.every((o) => o.status === 'ok'))
}

{
  const { calls, exec } = fakeExec([])
  const r = await runSourcePhase({ plans, exec, now: NOW })
  check('🟢 아무도 실패하지 않으면 계획된 단계가 하나도 빠짐없이 돈다',
    calls.length === plans.flatMap((p) => p.stages).length)
  check('🟢 밀린 입력이 여러 source 에 있으면 전부 drain 된다',
    r.sources.every((s) => s.status === 'ok')
    && calls.filter((c) => c.stage === 'adapt').length === 2
    && calls.filter((c) => c.stage === 'cafeThin').length === 2)
  check('🔴 cafeThin 은 자기 카페만 연다 — 인자에 남의 카페가 없다',
    calls.filter((c) => c.stage === 'cafeThin')
      .every((c) => c.args.some((a) => a === `--cafe=${c.source === 'navercafe:wgang' ? 'wgang' : 'remonterrace'}`)))
  check('🔴 adapt 는 자기 source 의 파일만 받는다', calls
    .filter((c) => c.stage === 'adapt')
    .every((c) => {
      const inp = c.args.find((a) => a.startsWith('--input='))!.slice('--input='.length)
      return inp.split(',').every((f) => sourceOfDataFile(f) === c.source)
    }))
  check('🔴 82cook 에는 cafeThin 이 없다 — 수집 job 이 이미 얇은 파일을 낸다',
    !calls.some((c) => c.source === '82cook' && c.stage === 'cafeThin'))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 회복 — checkpoint 가 아니라 입력에서 다시 읽는다')
// ─────────────────────────────────────────────────────────
check('🔴 회차 기록 파일을 재개 근거로 읽지 않는다', (() => {
  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  // 기록은 **쓰기만** 한다. 읽어서 무엇을 돌릴지 정하는 코드가 없어야 한다
  return !/readFileSync\([^)]*run\.json/.test(runner)
    && !/resumeDecision|nextStage|missingArtifacts|checkpoint/i.test(runner)
})())
check('🟢 adapt 는 끝났고 judge 가 끊긴 회차 — 다시 돌리면 adapt 는 건너뛰고 judge 부터다', (() => {
  const after = planPending([
    '82cook-thin-A.thin-detail.jsonl',
    // 🔴 adapt 성공은 **두 산출물이 다 난 것**이다 — 한쪽만으로는 성공이 아니다
    '82cook-adapt-A.detail.jsonl',
    '82cook-adapt-A.raw-detail.jsonl',
  ])
  const src = planSourcePhase(after)
  const common = planCommonPhase(after, FULL_BUFFER)
  return src.length === 0 && common.map((c) => c.stage).join(',') === 'judge,draft,fill'
})())
check('🟢 cafeThin 이 끊긴 회차 — 다시 돌리면 그 카페의 cafeThin 부터다', (() => {
  const after = planPending(['navercafe-wgang-20260911-025000.jsonl'])
  const src = planSourcePhase(after)
  return src.length === 1 && src[0]!.source === 'navercafe:wgang'
    && src[0]!.stages.map((s) => s.stage).join(',') === 'cafeThin'
})())
{
  const common = planCommonPhase(pendingAfter, FULL_BUFFER)
  const { calls, exec } = fakeExec([{ stage: 'judge', source: null }])
  const r = await runCommonPhase({ plan: common, exec, now: NOW })
  check('🔴 judge 가 실패하면 draft·fill 을 부르지 않는다',
    calls.map((c) => c.stage).join(',') === 'judge'
    && r.outcomes.filter((o) => o.status === 'skipped').map((o) => o.stage).join(',') === 'draft,fill')
  check('🔴 실패한 회차는 failed 로 남는다 — 숨기지 않는다', runStatusOf(r.outcomes) === 'failed')
}
check('🟢 아무 실패가 없으면 done 이다', runStatusOf([]) === 'done')

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 미처리 입력이 없으면 정상 no-op 이다')
// ─────────────────────────────────────────────────────────
{
  const empty = planPending([])
  check('🔴 빈 디렉터리는 할 일이 없다', !hasWork(empty))
  check('🔴 계획도 비어 있다',
    planSourcePhase(empty).length === 0 && planCommonPhase(empty, FULL_BUFFER).length === 0)
  const v = judgeProcessRun({ live: true, killOpen: true, lock: 'free', hasWork: false })
  check('🔴 live 여도 돌지 않는다 — 실패가 아니라 no-op 이다',
    !v.ok && v.code === 'NO_INPUT')
  check('🟢 목록·adapt 산출물만 남은 디렉터리도 카페 수집 대상이 아니다', (() => {
    const p = planPending(['navercafe-wgang-20260911-025000.list.jsonl'])
    return !SUPPLY_SOURCES.some((s) => (p.rawCafe[s] ?? []).length > 0)
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 버퍼 정책 — 🔴 재고는 적재 상한이지 수집 스위치가 아니다')
// ─────────────────────────────────────────────────────────
check('🔴 버퍼 목표는 700 이다', STOCK_BANDS.target === 700)
for (const usable of [0, 100, 300, 699]) {
  const p = judgeBuffer(usable)
  check(`🟢 재고 ${usable} — 공급 경로가 살아 있다 (모델 · 적재 둘 다)`,
    p.llm && p.fill && p.upTo === 700 - usable)
  const common = planCommonPhase(pendingAfter, p)
  check(`🟢 재고 ${usable} — 판정·초안·보충이 계획에 다 있다`,
    common.map((c) => c.stage).join(',') === 'judge,draft,fill')
  check(`🔴 재고 ${usable} — 적재 상한이 인자에 실린다`,
    common.find((c) => c.stage === 'fill')!.args.includes(`--up-to=${700 - usable}`))
}
for (const usable of [700, 1_000]) {
  const p = judgeBuffer(usable)
  check(`🟡 재고 ${usable} — 버퍼가 찼다: 모델 0 · DB write 0`, !p.llm && !p.fill && p.upTo === 0)
  check(`🟢 재고 ${usable} — 그래도 파일 단계는 계획에 남는다 (수집물을 방치하지 않는다)`,
    planSourcePhase(pendingAll).length === 3 && planCommonPhase(pendingAfter, p).length === 0)
}
check('🔴 재고를 못 읽으면 파일 단계까지만 한다 — 모르는 수로 DB 에 쓰지 않는다', (() => {
  const p = judgeBuffer(null)
  return !p.llm && !p.fill
    && planSourcePhase(pendingAll).length === 3
    && planCommonPhase(pendingAfter, p).length === 0
})())
check('🔴 재고는 회차를 막지 않는다 — judgeProcessRun 이 재고를 인자로 받지 않는다', (() => {
  const src = readFileSync('src/lib/supply-process.ts', 'utf-8')
  const fn = /export function judgeProcessRun\(input: \{[\s\S]*?\n\}\)/.exec(src)?.[0] ?? ''
  return fn !== '' && !/stock|usable|재고/.test(fn)
})())
/**
 * 🔴 **여기가 진짜 병목이었다** (2026-09-11).
 *    적재 천장이 capacity 프로필의 `stockTarget`(d3 에서 42)이면, 재고가 42 에 닿는 순간
 *    `judgeApply` 가 `room = 0` 으로 보고 거절한다 — 100 → 300 → 700 은 산술적으로 불가능하다.
 */
check('🔴 적재 천장 정본이 STOCK_BANDS.target 이다 — capacity 눈금으로 자르지 않는다', (() => {
  const cli = readFileSync('scripts/micro-seed-supply-autofill.mts', 'utf-8')
  return /const BUFFER_TARGET = STOCK_BANDS\.target/.test(cli)
    && /judgeApply\(\{[^}]*target: BUFFER_TARGET/.test(cli)
    && !/judgeApply\(\{[^}]*target: LIMITS\.target/.test(cli)
})())

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 중복 방지 — lock 은 기계 안, dedup 은 DB 에서')
// ─────────────────────────────────────────────────────────
const BASE = { held: [] as HeldEntry[], existing: new Set<string>(), queue: [] as QueueRow[], usable: 5 }
const CAND = (o: Partial<Candidate> = {}): Candidate => ({
  candidateType: 'seedOriginality', sourceArticleId: '34998804',
  sourceSite: 'navercafe:remonterrace', sourceInput: 'navercafe:remonterrace',
  sourceDecision: 'ADOPT', title: '아이랑 같이 갈 숙소, 뭐 보고 고르세요?',
  body: '숙소 고를 때 뭘 먼저 보시는지 궁금해요.',
  safetyVerdict: 'pass',
  // 🔴 잰 값이다. 통과·탈락은 `draft-originality.ts` 가 정한다
  originality: { runWords: 3, runChars: 8, coverRatio: 0 },
  leakedTokens: '', reviewedAt: '2026-09-06T11:00:00Z', ...o,
})
check('🔴 같은 입력을 다시 돌려도 이미 올린 것은 적재되지 않는다', (() => {
  const c = CAND()
  const existing = new Set([provenanceKeyOf('34998804', '아이랑 같이 갈 숙소, 뭐 보고 고르세요?')])
  const r = planRefill({ ...BASE, existing, candidates: [c] })
  return r.targets.length === 0 && r.skipped[0]?.code === 'ALREADY'
})())
check('🔴 두 처리기가 같은 후보를 봐도 DB 조회 결과가 같은 키를 막는다', (() => {
  // 🔴 두 프로세스가 같은 파일을 읽어도 **키가 같다** — 그래서 뒤에 들어온 쪽이 걸린다
  const a = provenanceKeyOf('34998804', '아이랑  같이 갈 숙소, 뭐 보고 고르세요?')
  const b = provenanceKeyOf('34998804', '아이랑 같이 갈 숙소, 뭐 보고 고르세요?')
  return a === b
})())
check('🔴 적재는 트랜잭션 안에서 한 쌍으로 만든다', (() => {
  const cli = readFileSync('scripts/micro-seed-supply-autofill.mts', 'utf-8')
  return /prisma\.\$transaction\(async \(tx\) => \{[\s\S]{0,600}tx\.microSeedRawContent\.create[\s\S]{0,600}tx\.originalPostApprovalQueue\.create/.test(cli)
})())
check('🔴 처리기 lock 은 수집 job 의 lock 과 다른 파일이다', LOCK_FILE === 'supply-process.lock')
check('🔴 앞 회차가 돌고 있으면 이번 회차는 돌지 않는다', (() => {
  const v = judgeProcessRun({ live: true, killOpen: true, lock: 'held', hasWork: true })
  return !v.ok && v.code === 'LOCKED'
})())
/**
 * 🔴 **죽어 보이는 락도 뺏지 않는다** (2026-09-11 정정).
 *
 *    앞선 판은 `read → stale 판정 → 삭제 → rename` 으로 획득했다. 이 저장소는 이미
 *    2026-09-09(PR #483)에 그 길이 안 된다는 결론을 내고 `collect-lock.mts` 에 적어 뒀다 —
 *    같은 결함을 공급 처리기에 다시 들여왔던 것이다.
 */
check('🔴 죽은 것으로 보이는 락도 뺏지 않고 멈춘다 — 사람이 치운다', (() => {
  const v = judgeProcessRun({ live: true, killOpen: true, lock: 'stale-held', hasWork: true })
  return !v.ok && v.code === 'LOCKED' && v.reason.includes('자동으로 뺏지 않는다')
})())
check('🔴 락 상태를 못 읽으면 통과시키지 않는다(fail-closed)', (() => {
  const v = judgeProcessRun({ live: true, killOpen: true, lock: 'unreadable', hasWork: true })
  return !v.ok && v.code === 'LOCKED'
})())
check('🔴 러너가 자동 회수 코드를 갖고 있지 않다', (() => {
  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  // 🔴 stale 을 지우거나 rename 으로 뺏는 길이 **없어야** 한다
  return !/rmSync\([^)]*lockPath/.test(runner)
    && !/renameSync\([^)]*lockPath/.test(runner)
    && !/unlinkSync\([^)]*lockPath/.test(runner)
    && !/planStaleLock|applyStaleLockPlan|lockDecision/.test(runner)
})())
check('🔴 러너가 검증된 계약을 그대로 쓴다 — 새 프로토콜을 만들지 않는다', (() => {
  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  return /from '\.\/lib\/collect-lock\.mjs'/.test(runner)
    && /acquireLock\(/.test(runner) && /releaseLock\(/.test(runner)
})())
check('🔴 모든 경로에서 finally 로 푼다 — process.exit 으로 빠져나가지 않는다', (() => {
  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  const body = runner.slice(runner.indexOf('async function main('), runner.indexOf('const isDirectRun'))
  return /\} finally \{[\s\S]{0,400}releaseHeldLock\(\)/.test(runner)
    // 🔴 main 안에 process.exit 이 있으면 finally 를 건너뛴다
    && !/process\.exit\(/.test(body)
})())

/**
 * 🔴 **실제 OS 프로세스 두 개로 잰다.** 문자열 검사로는 경쟁을 증명할 수 없다.
 *
 *    두 역할을 준다.
 *      `fast` — 같은 죽은 락을 관측하고, 출발 신호에 곧바로 획득한다
 *      `slow` — **먼저 관측**해 두고, `fast` 가 자리를 차지한 **뒤에** 낡은 관측으로 덤빈다
 *
 *    그리고 **대조군**으로 옛 rename 방식을 같은 안무에 돌린다.
 *    거기서 2가 나와야 이 시험이 경쟁을 실제로 잡아낸다는 뜻이다.
 */
{
  const LOCK_NAME = 'supply-process.lock'
  const OBSERVE_MS = 6000
  const WAIT_MS = 4000
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const lockLib = resolve('scripts/lib/collect-lock.mts')

  /** 🔴 지금 계약 — `wx` 한 번. 지지 않으려고 지우거나 rename 하지 않는다 */
  const CHILD_REAL = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireLock, releaseLock } from ${JSON.stringify(lockLib)}
const LOCK = join(process.env.ROOT, ${JSON.stringify(LOCK_NAME)})
const ROLE = process.env.ROLE
// 🔴 빈 자리 경쟁에서는 관측할 것이 없다 — 그때도 barrier 는 맞춘다
let observed = null
try { observed = JSON.parse(readFileSync(LOCK, 'utf-8')) } catch { /* 빈 자리 */ }
writeFileSync(process.env.READY + '.' + ROLE, String(observed?.at ?? 'empty'))
while (!existsSync(process.env.START)) { /* spin */ }
if (ROLE === 'slow' && observed !== null) {
  const t0 = Date.now()
  while (Date.now() - t0 < ${OBSERVE_MS}) {
    try {
      const cur = JSON.parse(readFileSync(LOCK, 'utf-8'))
      if (cur.token !== observed.token) break
    } catch { /* 교체 중 */ }
  }
}
let handle = null
const deadline = Date.now() + ${WAIT_MS}
while (handle === null && Date.now() < deadline) {
  const r = acquireLock(LOCK, Date.now(), 1000)
  if (r.ok) { handle = r.handle; break }
  await new Promise((res) => setTimeout(res, 10))
}
if (handle !== null) {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'enter', t: Date.now(), role: ROLE }) + '\\n')
  await new Promise((res) => setTimeout(res, 250))
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'exit', t: Date.now(), role: ROLE }) + '\\n')
  releaseLock(handle)
} else {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'blocked', role: ROLE }) + '\\n')
}
`
  /**
   * 🔴 **대조군 — 이 PR 이 걷어낸 옛 supply-process 방식 그대로.**
   *    읽고(관측) → TTL 지났으면 지우고 → rename 으로 자리를 차지한다.
   *    같은 안무에서 이쪽은 **두 주인**이 나온다.
   */
  const CHILD_LEGACY = `
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
const LOCK = join(process.env.ROOT, ${JSON.stringify(LOCK_NAME)})
const ROLE = process.env.ROLE
const observed = JSON.parse(readFileSync(LOCK, 'utf-8'))
const observedStale = Date.now() - observed.at > 1000   // 🔴 이 판정을 끝까지 들고 간다
writeFileSync(process.env.READY + '.' + ROLE, String(observed.at))
while (!existsSync(process.env.START)) { /* spin */ }
if (ROLE === 'slow') {
  const t0 = Date.now()
  while (Date.now() - t0 < ${OBSERVE_MS}) {
    try {
      const cur = JSON.parse(readFileSync(LOCK, 'utf-8'))
      if (cur.token !== observed.token) break
    } catch { /* 교체 중 */ }
  }
}
let got = false
const deadline = Date.now() + ${WAIT_MS}
while (!got && Date.now() < deadline) {
  // 🔴 **낡은 관측으로 지우고, rename 으로 덮어쓴다** — 지금 누가 있는지 다시 보지 않는다
  if (observedStale) rmSync(LOCK, { force: true })
  const tmp = LOCK + '.tmp-' + ROLE
  writeFileSync(tmp, JSON.stringify({ at: Date.now(), token: ROLE }))
  renameSync(tmp, LOCK)
  got = true
  break
}
if (got) {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'enter', t: Date.now(), role: ROLE }) + '\\n')
  await new Promise((res) => setTimeout(res, 250))
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'exit', t: Date.now(), role: ROLE }) + '\\n')
  rmSync(LOCK, { force: true })
} else {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'blocked', role: ROLE }) + '\\n')
}
`
  const runChild = (dir: string, script: string, env: Record<string, string>): Promise<number> =>
    new Promise((res) => {
      const c = spawn('npx', ['tsx', script], {
        cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'],
      })
      c.on('close', (code) => res(code ?? -1))
    })

  const raceOnce = async (src: string, trials: number, plantDead: boolean): Promise<number> => {
    let peak = 0
    for (let i = 0; i < trials; i += 1) {
      const dir = mkdtempSync(join(tmpdir(), 'soran-proc-race-'))
      try {
        // 🔴 `plantDead` 면 아주 오래된 락을 심는다 — 두 역할 모두 "죽었다" 고 관측한다
        if (plantDead) {
          writeFileSync(join(dir, LOCK_NAME),
            JSON.stringify({ token: 'dead', pid: 999_999, at: new Date(Date.now() - 3_600_000).toISOString() }))
        }
        const script = join(dir, 'child.mts')
        writeFileSync(script, src)
        const out = join(dir, 'ev.jsonl')
        writeFileSync(out, '')
        const base = { ROOT: dir, OUT: out, START: join(dir, 'START'), READY: join(dir, 'READY') }
        const running = [
          runChild(dir, script, { ...base, ROLE: 'fast' }),
          runChild(dir, script, { ...base, ROLE: 'slow' }),
        ]
        // 🔴 **둘 다 관측을 마친 뒤에** 출발시킨다 — 안무를 운에 맡기지 않는다
        const readyCount = (): number => readdirSync(dir).filter((f) => f.startsWith('READY.')).length
        for (let k = 0; k < 400 && readyCount() < 2; k += 1) await sleep(25)
        writeFileSync(base.START, 'go')
        await Promise.all(running)
        const evs = readFileSync(out, 'utf-8').split('\n').filter(Boolean)
          .map((l) => JSON.parse(l) as { ev: string; t: number })
          .sort((a, b) => a.t - b.t)
        let cur = 0
        let mx = 0
        for (const e of evs) {
          if (e.ev === 'enter') { cur += 1; mx = Math.max(mx, cur) }
          if (e.ev === 'exit') cur -= 1
        }
        peak = Math.max(peak, mx)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    return peak
  }

  /**
   * ── 시나리오 A: **빈 자리에 두 프로세스** ──
   *    정상 동작은 "승자 하나". 0 이면 경쟁을 재지 못한 것이고, 2 면 배타가 깨진 것이다.
   */
  const freeRace = await raceOnce(CHILD_REAL, 3, false)
  console.log(`   A 빈 자리   maxConcurrent = ${freeRace}  (승자 1명이어야 한다)`)
  check(`🔴 [A] 두 프로세스가 동시에 들어가지 않는다 — maxConcurrent === 1 (측정 ${freeRace})`,
    freeRace === 1)

  /**
   * ── 시나리오 B: **죽은 락이 남아 있는 자리에 두 프로세스** ──
   *
   *    🔴 지금 계약은 **아무도 들어가지 않는다(0)** — 시효가 지나도 뺏지 않기 때문이다.
   *       멈추는 것이 계약이다. 뺏으면 두 회차가 같이 들어가 DB 를 두 번 민다.
   *    🔴 대조군(옛 rename 방식)은 **두 주인(2)** 이 된다. 그 2가 이 시험의 검증력이다 —
   *       보호를 되돌리면 위 [A] 가 아니라 여기가 먼저 빨개진다.
   */
  const staleReal = await raceOnce(CHILD_REAL, 3, true)
  console.log(`   B 죽은 락   지금 계약 maxConcurrent = ${staleReal}  (0 = 둘 다 물러난다)`)
  check(`🔴 [B] 죽은 락을 뺏지 않는다 — 아무도 들어가지 않는다 (측정 ${staleReal})`, staleReal === 0)
  const legacy = await raceOnce(CHILD_LEGACY, 3, true)
  console.log(`   B 대조군(옛) maxConcurrent = ${legacy}   ← 2 여야 이 시험에 검증력이 있다`)
  check(`🔴 [B] 대조군(옛 rename 방식)은 2가 나온다 — 시험에 검증력이 있다 (측정 ${legacy})`, legacy === 2)
}

/** 🔴 해제는 **내 token 일 때만**. 남의 락은 건드리지 않는다 */
{
  const dir = mkdtempSync(join(tmpdir(), 'soran-proc-release-'))
  try {
    const p = join(dir, LOCK_FILE)
    const mine = acquireLock(p, Date.now(), LOCK_TTL_MS)
    check('🟢 빈 자리에서는 획득한다', mine.ok)
    const second = acquireLock(p, Date.now(), LOCK_TTL_MS)
    check('🔴 이미 있으면 두 번째는 진다 — 지우거나 뺏지 않는다',
      !second.ok && second.kind === 'HELD' && existsSync(p))
    check('🔴 남의 token 으로는 못 푼다',
      releaseLock({ path: p, token: 'not-mine' }) === 'NOT_MINE' && existsSync(p))
    check('🟢 내 token 으로는 푼다', mine.ok && releaseLock(mine.handle) === 'RELEASED' && !existsSync(p))
    // 🔴 시효가 지난 락도 **뺏지 않는다** — 사람이 치울 때까지 멈춘다(fail-closed)
    writeFileSync(p, JSON.stringify({ token: 'dead', pid: 1, at: new Date(Date.now() - 3_600_000).toISOString() }))
    const stale = acquireLock(p, Date.now(), 1000)
    check('🔴 죽은 락을 자동으로 뺏지 않는다', !stale.ok && stale.kind === 'STALE_HELD' && existsSync(p))
    check('🔴 관제가 그것을 이상으로 낸다', lockAnomaly(p, Date.now(), 1000) !== null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

check('🔴 회차 기록 이름이 관제가 찾는 형태다', RUN_FILE_RE.test('supply-process-20260911-120000.run.json'))

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 수집 job 은 처리기 상태 때문에 막히지 않는다')
// ─────────────────────────────────────────────────────────
{
  const DIR = 'docs/operations/launchd'
  const templates = readdirSync(DIR).filter((f) => f.endsWith('.plist.template'))
  const argsOf = (f: string): string => {
    const t = readFileSync(join(DIR, f), 'utf-8')
    const block = /<key>ProgramArguments<\/key>[\s\S]*?<\/array>/.exec(t)?.[0] ?? ''
    return (block.match(/<string>[^<]*<\/string>/g) ?? []).join(' ')
  }
  const collectors = templates.filter((f) => /collect/.test(f))
  check('🔴 수집 job 이 처리기를 부르지 않는다 — 서로를 소유하지 않는다',
    collectors.length >= 3 && collectors.every((f) => !argsOf(f).includes('supply-process')))
  check('🔴 처리 job 이 수집기를 부르지 않는다', (() => {
    const f = 'com.soransoran.supply-process.plist.template'
    return templates.includes(f)
      && !/collect|navercafe-run|thin-detail/.test(argsOf(f))
  })())
  check('🟢 82cook 얇은 상세가 독립 job 으로 있다', (() => {
    const f = 'com.soransoran.supply-collect-82cook-thin.plist.template'
    return templates.includes(f) && argsOf(f).includes('micro-seed-82cook-thin-detail.mts')
  })())
  check('🟢 처리 job 이 하루 4회 이상이다', (() => {
    const t = readFileSync(join(DIR, 'com.soransoran.supply-process.plist.template'), 'utf-8')
    const n = (t.match(/<key>Hour<\/key>/g) ?? []).length
    return n >= 4
  })())
  check('🔴 옛 autopilot 템플릿이 없다',
    !existsSync(join(DIR, 'com.soransoran.supply-autopilot.plist.template')))

  /**
   * 🔴 **3-source 운영 정본은 job 다섯이다** (2026-09-11).
   *
   *    82cook 은 **두 job** 이 필요하다 — `raw-collect-82cook` 이 목록을 만들고,
   *    `supply-collect-82cook-thin` 이 그 목록을 소비해 얇은 상세를 연다.
   *    thin 은 목록을 스스로 만들지 않는다. raw 가 없으면 **열 대상이 0** 이다.
   *    앞선 판은 82cook 을 "선택 사항" 으로 두었고, 그러면 네이버 둘로만 공급이 돈다.
   */
  check('🔴 예약 job 이 다섯이다 — 수집 넷 + 처리 하나', RUNTIME_JOBS.length === 5)
  for (const l of [
    'com.soransoran.navercafe-collect-remonterrace-multi',
    'com.soransoran.navercafe-collect-wgang-multi',
    'com.soransoran.raw-collect-82cook',
    'com.soransoran.supply-collect-82cook-thin',
    'com.soransoran.supply-process',
  ]) {
    check(`🔴 ${l} 가 예약 job 이다`, RUNTIME_JOBS.includes(l))
    check(`🔴 ${l} 템플릿이 저장소에 있다`, templates.includes(`${l}.plist.template`))
  }
  check('🔴 Raw Vault 적재(raw-import)는 공급 예약 job 이 아니다',
    !RUNTIME_JOBS.includes('com.soransoran.raw-import'))

  /**
   * 🔴 **네이버 두 job 은 계획된 게시판·페이지·회차를 실제로 쓴다.**
   *    옛 one-page runner(`micro-seed-collect-navercafe.mts --pages=1 --max=10`)가
   *    남아 있으면 실패해야 한다 — 그 인자로 도는 한 `BOARD_TARGETS` 는 열리지 않는다.
   */
  for (const cafe of ['remonterrace', 'wgang']) {
    const a = argsOf(`com.soransoran.navercafe-collect-${cafe}-multi.plist.template`)
    check(`🟢 [${cafe}] 새 runner 를 부른다`, a.includes('micro-seed-navercafe-run.mts'))
    check(`🔴 [${cafe}] 옛 one-page runner 를 부르지 않는다`,
      !a.includes('micro-seed-collect-navercafe.mts'))
    check(`🔴 [${cafe}] --pages·--max 를 손으로 적지 않는다`,
      !a.includes('--pages=') && !a.includes('--max='))
    check(`🟢 [${cafe}] 계획 phase 를 넘긴다`, a.includes('--phase=start'))
  }
  check('🟢 82cook raw 가 목록을 만든다 — thin 이 소비할 입력이다',
    argsOf('com.soransoran.raw-collect-82cook.plist.template').includes('--list'))
  check('🟢 82cook thin 이 목록을 소비한다', (() => {
    const a = argsOf('com.soransoran.supply-collect-82cook-thin.plist.template')
    return a.includes('micro-seed-82cook-thin-detail.mts') && a.includes(`--cap=${thin82cookCapPerRun()}`)
  })())

  /** 🔴 퇴역 job 은 예약 job 과 겹치지 않는다 — 겹치면 올리면서 내리게 된다 */
  check('🔴 예약 job 과 퇴역 job 이 겹치지 않는다',
    RUNTIME_JOBS.every((l) => !RETIRED_JOBS.includes(l)))
  check('🔴 옛 중앙 러너가 퇴역 목록에 있다',
    RETIRED_JOBS.includes('com.soransoran.supply-autopilot'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 계획된 게시판·페이지·회차가 실제 인자로 나간다')
// ─────────────────────────────────────────────────────────
{
  const rem = planCafeRun({ cafeId: 'remonterrace' })
  check('🟢 remonterrace 계획에 jjong 과 humor 가 둘 다 있다',
    rem.boards.map((b) => b.key).join(',') === 'remonterrace:jjong,remonterrace:humor')
  const jjong = rem.boards.find((b) => b.key === 'remonterrace:jjong')!
  const jT = BOARD_TARGETS.find((b) => b.key === 'remonterrace:jjong')!
  check('🟢 jjong 페이지 범위가 BOARD_TARGETS 와 같다',
    jjong.startPage === jT.startPage && jjong.endPage === jT.endPage
    && jjong.pages === pagesOf(jT).length)
  const humor = rem.boards.find((b) => b.key === 'remonterrace:humor')!
  check('🟢 humor 가 1p 다', humor.startPage === 1 && humor.endPage === 1)
  check('🟢 remonterrace 회차가 RUNS_PER_DAY 와 같다',
    rem.runsPerDay === RUNS_PER_DAY['navercafe:remonterrace'].start)

  const wg = planCafeRun({ cafeId: 'wgang' })
  const all = wg.boards.find((b) => b.key === 'wgang:all')!
  const wT = BOARD_TARGETS.find((b) => b.key === 'wgang:all')!
  check('🟢 wgang:all 페이지 범위가 BOARD_TARGETS 와 같다',
    all.startPage === wT.startPage && all.endPage === wT.endPage && all.pages === pagesOf(wT).length)
  check('🟢 wgang 회차가 RUNS_PER_DAY 와 같다',
    wg.runsPerDay === RUNS_PER_DAY['navercafe:wgang'].start)

  /** 🔴 **`--pages=1` 로 끝나면 실패다** — 계획이 인자에 닿는지 값으로 본다 */
  const args = rem.boards.map((b) => collectArgsFor(b, { live: true, thin: true }).join(' '))
  check('🔴 인자가 --board 를 쓴다', args.every((a) => a.includes('--board=')))
  check('🔴 인자에 --pages 를 손으로 적지 않는다', args.every((a) => !a.includes('--pages')))
  for (const p of [rem, wg]) {
    check(`🔴 ${p.cafeId} 하루 요청이 상한 안이다`,
      p.withinLimit && p.requestsPerDay <= MAX_REQUESTS_PER_DAY[p.source])
  }
  /** 🔴 82cook 은 raw 수집이 이미 먹은 몫을 빼고 남은 것만 쓴다 */
  const raw82 = 33 * RUNS_PER_DAY['82cook'].start
  check('🔴 82cook 얇은 상세 회차가 하루 상한 안이다',
    raw82 + thin82cookCapPerRun() * THIN_82COOK_RUNS_PER_DAY <= MAX_REQUESTS_PER_DAY['82cook'])
  check('🔴 82cook 얇은 상세 몫이 0 이 아니다 — 0 이면 82cook 공급이 조용히 없다',
    thin82cookCapPerRun() > 0 && THIN_82COOK_RUNS_PER_DAY >= 1)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 옛 운영 경로가 남아 있지 않다')
// ─────────────────────────────────────────────────────────
{
  /** 🔴 **운영 경로**를 본다. 역사 문서에 "폐기된 과거 구조" 로 남는 것은 허용한다 */
  const LIVE_PATHS = [
    'package.json', '.github/workflows/supply-collect.yml', '.github/workflows/visibility-guard.yml',
    'docs/operations/launchd/README.md',
  ]
  for (const f of LIVE_PATHS) {
    check(`🔴 ${f} 에 supply-autopilot 이 없다`,
      !/supply-autopilot|supply:autopilot/.test(readFileSync(f, 'utf-8')))
  }
  /**
   * 🔴 **공급 레인의 live 경로에 우나어가 0건이다.**
   *    (다른 레인의 `voice:unao-*` 는 우나어 DB 를 **read-only 로만** 보는 별도 커넥터이고,
   *     launchd README 의 우나어 언급은 "세션을 재사용하지 말라" 는 **금지**다 —
   *     이 검사는 공급 경로가 우나어를 **쓰지 않는다**는 것을 본다.)
   */
  const SUPPLY_LIVE = [
    'src/lib/supply-process.ts', 'scripts/supply-process.mts',
    '.github/workflows/supply-collect.yml',
    'docs/operations/launchd/com.soransoran.supply-process.plist.template',
    'docs/operations/launchd/com.soransoran.supply-collect-82cook-thin.plist.template',
    'docs/operations/launchd/com.soransoran.navercafe-collect-remonterrace-multi.plist.template',
    'docs/operations/launchd/com.soransoran.navercafe-collect-wgang-multi.plist.template',
  ]
  for (const f of SUPPLY_LIVE) {
    const t = readFileSync(f, 'utf-8')
    /** 🔴 우나어 **자산**(repo 경로 · localStorage 키 · 도메인)은 한 글자도 없다 */
    check(`🔴 ${f} 에 우나어 자산 참조가 없다`,
      !/age-doesnt-matter|agedoesntmatter|unao-[a-z]/.test(t))
    /**
     * 🔴 우나어라는 낱말이 나온다면 그것은 **금지 문장**이어야 한다.
     *    "쓰지 말라" 는 남겨 두는 것이 맞고, "쓴다" 는 남으면 안 된다.
     */
    const uses = t.split('\n').filter((l) => /우나어/.test(l)
      && !/막는다|막힌다|재사용|금지|쓰지 않는다|분리/.test(l))
    check(`🔴 ${f} 의 우나어 언급은 금지 문장뿐이다`, uses.length === 0)
    check(`🔴 ${f} 에 금지 표현(시니어·어르신·노인·실버)이 없다`,
      !/시니어|어르신|노인|실버/.test(t))
  }
  check('🔴 autopilot 코드가 저장소에 없다',
    !existsSync('scripts/supply-autopilot.mts')
    && !existsSync('scripts/supply-autopilot-check.mts')
    && !existsSync('scripts/supply-autopilot-lock-check.mts')
    && !existsSync('src/lib/supply-autopilot.ts'))
  check('🔴 owner 우회 플래그(--no-collect)가 어디에도 없다', (() => {
    for (const f of [...LIVE_PATHS, 'scripts/supply-process.mts', 'src/lib/supply-process.ts']) {
      if (readFileSync(f, 'utf-8').includes('--no-collect')) return false
    }
    return true
  })())
  /** 🔴 옛 1회판 navercafe job 은 템플릿도 인자도 없다 */
  for (const cafe of ['remonterrace', 'wgang']) {
    check(`🔴 [${cafe}] 옛 1회판 템플릿이 없다`,
      !existsSync(`docs/operations/launchd/com.soransoran.navercafe-collect-${cafe}.plist.template`))
  }
  const readme = readFileSync('docs/operations/launchd/README.md', 'utf-8')
  check('🔴 README 가 "재고 14" 를 말하지 않는다', !/재고\D{0,6}14/.test(readme))
  check('🔴 README 가 "전부 미등록" 과 "등록됨" 을 동시에 말하지 않는다',
    !(/등록되어 있지 않다/.test(readme) && /등록됨/.test(readme)))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 발행하지 않는다')
// ─────────────────────────────────────────────────────────
{
  const base = {
    postBefore: 10, postAfter: 10, stockBefore: 5, stockAfter: 7,
    machineBefore: 3, machineAfter: 5, queuedMachine: 2, queuedNonMachine: 0,
  }
  check('🟢 정상 회차는 통과', verifyRun(base).ok)
  check('🔴 Post 가 늘면 사고다', !verifyRun({ ...base, postAfter: 11 }).ok)
  check('🔴 재고가 줄면 사고다', !verifyRun({ ...base, stockAfter: 4, machineAfter: 3, queuedMachine: 0 }).ok)
  check('🔴 버퍼 목표를 넘겨 적재하면 사고다',
    !verifyRun({ ...base, stockAfter: STOCK_BANDS.target + 1 }).ok)
  check('🔴 기계가 아닌 행이 적재되면 사고다', !verifyRun({ ...base, queuedNonMachine: 1 }).ok)
  const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
  check('🔴 러너가 Post·persona·ActivityLog 를 만들지 않는다',
    !/prisma\.post\.create|personaActivityLog|assignPersona/.test(runner))
  check('🔴 kill switch 이름이 처리기 전용이다', PROCESS_KILL_SWITCH_ENV === 'SORAN_SUPPLY_PROCESS_ENABLED')
  check('🔴 --live 하나로는 열리지 않는다', (() => {
    const v = judgeProcessRun({ live: true, killOpen: false, lock: 'free', hasWork: true })
    return !v.ok && v.code === 'NO_KILL_SWITCH'
  })())
  check('🔴 기본은 dry-run 이다', (() => {
    const v = judgeProcessRun({ live: false, killOpen: true, lock: 'free', hasWork: true })
    return !v.ok && v.code === 'DRY_RUN'
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 데이터 디렉터리 이름은 정본 하나다')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 **공급 처리 체인 안에서** `.microseed-data` 리터럴 선언은 lib 정본 하나뿐이다.
 *
 *    러너와 어댑터가 각자 문자열을 들고 있던 것이 2026-09-11 결함의 뿌리다 —
 *    러너는 `readdirSync(DATA_DIR)` 가 준 맨 이름을 넘겼고 어댑터는 그것을
 *    cwd 기준으로 열었다. 두 곳이 같은 값을 "따로" 알고 있으면 그런 어긋남이 생긴다.
 *
 *    🟡 이 가드의 범위는 **이 체인**이다. 저장소의 다른 스크립트들은 각자
 *       자기 DATA_DIR 을 갖고 있고, 그것은 이 PR 의 범위가 아니다.
 */
{
  const CHAIN = [
    'scripts/supply-process.mts',
    'scripts/micro-seed-82cook-thin-adapt.mts',
    'src/lib/supply-process.ts',
  ]
  // 🔴 주석과 설명 문자열은 세지 않는다 — 결함을 원문으로 적어 둔 곳이 있다
  const codeOf = (f: string): string => readFileSync(f, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
  const LITERAL = /=\s*'\.microseed-data'/
  for (const f of CHAIN) {
    check(`🔴 ${f} 가 리터럴을 선언하지 않는다`, !LITERAL.test(codeOf(f)))
  }
  check('🔴 러너가 정본을 가져다 쓴다',
    /DATA_DIR_NAME/.test(codeOf('scripts/supply-process.mts')))
  check('🔴 어댑터가 정본을 가져다 쓴다',
    /DATA_DIR_NAME/.test(codeOf('scripts/micro-seed-82cook-thin-adapt.mts')))
  check('🔴 정본은 lib 한 곳뿐이다', (() => {
    const lib = codeOf('src/lib/micro-seed-82cook-thin-adapt.ts')
    return (lib.match(/=\s*'\.microseed-data'/g) ?? []).length === 1
      && DATA_DIR_NAME === '.microseed-data'
  })())
  check('🔴 완료 판정도 정본 하나다 — planPending 이 정규식을 다시 쓰지 않는다', (() => {
    const lib = codeOf('src/lib/supply-process.ts')
    return /completedAdaptKeys\(/.test(lib) && !/82cook-adapt-\(\.\+\?\)/.test(lib)
  })())
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
