#!/usr/bin/env tsx
/**
 * 🔴 **자동 단계 사다리 — 한 사다리 · 한 관문 검사** (2026-09-24 · 2026-09-30 source-slot-v1 재작성)
 *
 *   정본(Sep 30): D1 → D3 → D5 → D10 → D20 → D30 → D50. 시험(TRIAL)은
 *     전날 결정 + 전날 운영 증거(PASS → 다음 칸 · 아니면 RETEST) + 그 대상 preflight PASS + 첫 슬롯 전
 *   일 때만 열린다. 열리지 않은 날은 지금 단계를 증명일로 다시 돈다(REPROVE · 바닥 제외).
 *
 * 🔴 지운 권위(이 파일이 더 이상 검사하지 않는 옛 경로): 승인 천장 env(`authorizedCapacityCeiling` · CEILING) ·
 *    14일 준비도(`stageVerdicts`) · 하루 canary(`judgeOneDayCanary` · STALE_DAILY) · 지속 승격(`judgePromotion` → SUSTAIN) ·
 *    단계 출처 대조(`stage-source`). 그 경로가 돌아오지 않는지는 ①이 잠근다.
 *
 * 🔴 DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import {
  previousKstDate, nextStage, isCalendarDate, DECISION_WRITER, BLOCK_CODES,
  REQUIRED_KEYS, TRANSITION_FATAL_BLOCKS,
  type StageDecision, type ValidatedStageDecision,
  planStageDecision, safestDecision, preparedStageOf, STAGE_DECISION_VERSION, TRANSITION_STATES,
} from '../src/lib/stage-ladder'
import {
  ensureStageDecision, consumeStageDecision, validateStoredDecision,
  controllerEnabled, CONTROLLER_ENV, ENSURE_STEPS, DECISION_CONSUMERS,
  STORED_COLUMNS, decisionToRow, rowToDecisionInput, decisionKeyOf,
} from '../src/lib/stage-decision-store'
import { RUNTIME_PROFILES as PROFILES, RELEASE_ENV, CAPACITY_ENV, type RuntimeStage } from '../src/lib/scale-profile'
import { consumerEnvOf } from '../src/lib/stage-controller'
import { COMMENT_STAGE_ENV } from '../src/lib/persona-comment-stage'
import { judgeNextPreflight, type PreflightFacts, type PreflightVerdict } from '../src/lib/stage-ladder-generic'
import { RUNNER_GRID, PREFLIGHT_ENV_KEYS } from './lib/stage-preflight-facts.mjs'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { loadPublishableStock, stageStock } from './lib/publishable-stock.mjs'
import { planPublishBatch, resolvePublishScale } from './lib/publishable-stock.mjs'
import { activeScale } from '../src/lib/scale-runtime'
import { judgeStageEvidence, type StageEvidenceVerdict } from '../src/lib/stage-evidence'
import { auditTarget } from '../src/lib/auto-ready-v2'
import { markedStageEnv } from './lib/stage-decision-fixture'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** 🔴 07:00 KST — 결정 시각. d3 첫 슬롯(09:30) 전이다 */
const NOW = new Date('2026-09-24T07:00:00+09:00')
const AT = NOW.toISOString()
const DATE = '2026-09-24'

const PREV_DATE = previousKstDate(DATE)!
const prevRow = (release: RuntimeStage, o: Record<string, unknown> = {}): unknown => ({
  kstDate: PREV_DATE, capacity: preparedStageOf(release), release, state: 'HOLD',
  reasons: [], blocks: [], dayPinned: false, supply: null,
  decidedAt: `${PREV_DATE}T01:00:00.000Z`,
  contractVersion: STAGE_DECISION_VERSION,
  decidedBy: DECISION_WRITER, transition: null, ...o,
})
/**
 * 🔴 **검사도 운영과 같은 문을 지난다.** `ValidatedStageDecision` 은 brand 타입이라
 *    `validateStoredDecision` 을 지나야만 만들어진다 — 검사가 손으로 지어낼 수 없다.
 */
const validatePrev = (row: unknown): ValidatedStageDecision | null => {
  const v = validateStoredDecision({ row, expectKstDate: PREV_DATE })
  return v.ok ? v.decision : null
}
const prevDecision = (release: RuntimeStage, o: Record<string, unknown> = {}) =>
  validatePrev(prevRow(release, o))
/** 🔴 전날 TRIAL 결정(기반 → 대상) — 정본 validator 를 지난다 */
const prevTrial = (base: RuntimeStage, target: RuntimeStage) => prevDecision(target, {
  state: 'TRIAL', transition: {
    kind: 'TRIAL', trialBase: base, previousKstDate: previousKstDate(PREV_DATE), target,
    ...(base === 'd1' ? {} : { basis: 'PASS' }),
  },
})
/**
 * 🔴 **전날 운영 PASS — 정본 판정기로만 만든다** (2026-09-29 P0 · 조항 ⑦ 도장 포함).
 */
const passEvidence = (stage: RuntimeStage): StageEvidenceVerdict => {
  const at = Date.parse(`${PREV_DATE}T09:30:00+09:00`)
  const n = PROFILES[stage].dailyTarget
  return judgeStageEvidence(PREV_DATE, stage, {
    kstDate: PREV_DATE, stage,
    decision: { kstDate: PREV_DATE, state: 'TRIAL', release: stage, decidedBy: DECISION_WRITER },
    posts: Array.from({ length: n }, (_, i) => ({
      postId: `pp-${i}`, queueId: `pq-${i}`,
      publishedAtMs: at + i * 3600_000, unattended: true, queueRows: 1, publishLogs: 1, authorPersonaId: `pa-${i}`,
      decider: 'auto' as const, release: 'STAMPED_ELIGIBLE' as const,
      personaComments: [{ personaId: `pc-${i}`, createdAtMs: at + i * 3600_000 + 600_000, topLevel: true }],
    })),
    orphanPublishLogs: 0, unloggedPublishes: 0, commentCapPerPost: 1,
    audits: {
      rows: Array.from({ length: auditTarget(n) }, (_, i) => ({
        postId: `pp-${i}`, queueId: `pq-${i}`, judged: true, defectYes: false, retryable: false, overdue: false,
      })),
      globalUnresolvedDefects: 0, globalOverdue: 0, globalRetryable: 0, globalMissingPosts: 0,
    },
  }, { cost: [{ name: '공급', health: 'ok' }, { name: '댓글', health: 'ok' }, { name: '감사', health: 'ok' }], errors: 'ok' })
}
/** 🔴 preflight 는 정본 `judgeNextPreflight` 로만 만든다 — 넉넉한 사실이면 PASS 가 나와야 한다 */
const GOOD_FACTS = (s: RuntimeStage): PreflightFacts => ({
  slotValidOpportunities: PROFILES[s].dailyTarget * 2,
  readyCohort: { sources: PROFILES[s].dailyTarget, published: PROFILES[s].dailyTarget, lost: 0, scheduled: 0, unknown: 0, supplyUsd: 0.001 * PROFILES[s].dailyTarget },
  latencyP50H: 20, latencyP90H: 50,
  contractValidPersonas: 500, commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.2, auditUsdPerCall: 0.001, auditDailyUsdCap: 0.3,
  supplyDailyUsdCap: 0.5, runnerHealth: 'ok',
})
const preflightFor = (s: RuntimeStage, o: Partial<PreflightFacts> = {}): PreflightVerdict =>
  judgeNextPreflight(s, { ...GOOD_FACTS(s), ...o }, RUNNER_GRID)
/** 🔴 사다리 한 번 — 정본 입력 모양 그대로 */
const plan = (o: {
  sustained: RuntimeStage; prev: ValidatedStageDecision | null; evidence?: StageEvidenceVerdict | null
  preflight?: PreflightVerdict | null; publishedToday?: number; decidedAt?: string
}) => planStageDecision({
  kstDate: DATE, sustainedRelease: o.sustained, previousDecision: o.prev,
  previousEvidence: o.evidence === undefined ? null : o.evidence,
  nextPreflight: o.preflight === undefined ? null : o.preflight,
  publishedToday: o.publishedToday ?? 0, decidedAt: o.decidedAt ?? AT,
})

/**
 * 🔴 **하드코딩한 목록은 새 파일을 놓친다** (2026-09-25 마스터 지적). production TS/MTS 를 전부 훑는다.
 */
const PRODUCTION_FILES = (() => {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'generated') walk(full) }
      else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(full)
    }
  }
  walk('src'); walk('scripts')
  return out.filter((f) => f !== 'src/lib/stage-decision-contract.ts' && !/-check\.mts$/.test(f))
})()

console.log('\n══ 자동 단계 사다리 — 한 사다리 · 한 관문 (DB 0 · 네트워크 0) ══')

console.log('\n① 🔴 🔴 옛 권위가 돌아오지 않는다 — 입력원은 StageDecision 하나')
{
  const codeOnly = (f: string): string => readFileSync(f, 'utf-8')
    .split('\n').filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n')
  const ladder = codeOnly('src/lib/stage-ladder.ts')
  // 🔴 consumer(`consumerEnvOf`)는 결정을 env 로 **쓴다** — 결정을 **읽는** 쪽(sustained · decideStage)만 본다
  const controller = codeOnly('src/lib/stage-controller.ts').split('export function consumerEnvOf')[0]!
  const runner = codeOnly('scripts/stage-controller.mts')
  const gone = /judgePromotion|judgeOneDayCanary|stageVerdicts|safeStageFor|authorizedCapacityCeiling|STALE_DAILY|readinessOf|d100:readiness/
  check('🔴 🔴 **사다리 · controller · controller 러너가 옛 권위를 부르지 않는다**',
    !gone.test(ladder) && !gone.test(controller) && !gone.test(runner),
    [ladder, controller, runner].map((x) => (x.match(gone) ?? [''])[0]).join('|'))
  check('🔴 🔴 **controller 가 env 단계 · env 천장을 읽지 않는다**',
    !/SORAN_RELEASE_STAGE|SORAN_CAPACITY_STAGE|envRelease|ceilingOf/.test(controller)
    && !/process\.env\.SORAN_(RELEASE|CAPACITY)_STAGE/.test(runner))
  check('🔴 옛 모듈 파일이 없다 (stage-source · scale-readiness · supply-freshness)',
    !existsSync('src/lib/stage-source.ts') && !existsSync('src/lib/scale-readiness.ts') && !existsSync('src/lib/supply-freshness.ts'))
  check('🔴 사다리는 SUSTAIN 을 만들지 않는다', !/'SUSTAIN'/.test(ladder) && !/kind: 'SUSTAIN'/.test(controller))
  check('🔴 capacity 칸 = 다음에 증명할 단계', preparedStageOf('d1') === 'd3' && preparedStageOf('d10') === 'd20'
    && preparedStageOf('d50') === 'd50' && /const capacity = preparedStageOf\(release\)/.test(ladder))
}

console.log('\n② 🔴 🔴 시험은 계획 · preflight · 시각이 모두 맞을 때만 열린다')
{
  const ok = plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d5') })
  check('🟢 전날 TRIAL d3 PASS · d5 preflight PASS · 07:00 → TRIAL d5 (기반 d3 · PASS)',
    ok.state === 'TRIAL' && ok.release === 'd5' && ok.transition?.kind === 'TRIAL'
    && ok.transition.trialBase === 'd3' && ok.transition.basis === 'PASS' && ok.blocks.length === 0,
    `${ok.state} ${ok.release} ${JSON.stringify(ok.blocks)}`)
  check('그때 capacity 는 다음 증명 단계(d10)', ok.capacity === 'd10')
  check('그 결정은 정본 validator 를 통과한다', validateStoredDecision({ row: ok, expectKstDate: DATE }).ok)

  const noPf = plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: null })
  check('🔴 preflight 가 없으면 열리지 않는다 (PREFLIGHT_UNKNOWN · REPROVE d3)',
    noPf.state === 'REPROVE' && noPf.release === 'd3' && noPf.blocks.some((b) => b.code === 'PREFLIGHT_UNKNOWN'), noPf.state)
  const wrongPf = plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d10') })
  check('🔴 🔴 **다른 단계의 초록 preflight 로 열지 않는다**',
    wrongPf.state !== 'TRIAL' && wrongPf.blocks.some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
  const failPf = plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'),
    preflight: preflightFor('d5', { slotValidOpportunities: 1 }) })
  check('🔴 preflight FAIL(기회 부족) → PREFLIGHT_FAIL · 시험 없음', failPf.state !== 'TRIAL' && failPf.blocks.some((b) => b.code === 'PREFLIGHT_FAIL'))
  const unkPf = plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'),
    preflight: preflightFor('d5', { contractValidPersonas: null }) })
  check('🔴 🔴 **계약 유효 Persona 모름(null · 오늘 운영) → PREFLIGHT_UNKNOWN · 시험 없음**',
    unkPf.state !== 'TRIAL' && unkPf.blocks.some((b) => b.code === 'PREFLIGHT_UNKNOWN'))
  const late = plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d5'),
    decidedAt: new Date(`${DATE}T10:00:00+09:00`).toISOString() })
  check('🔴 첫 슬롯 뒤에 결정하면 조각 하루로 시험하지 않는다 (LATE_START)',
    late.state !== 'TRIAL' && late.blocks.some((b) => b.code === 'LATE_START'))
  for (const d of [noPf, wrongPf, failPf, unkPf, late]) {
    const v = validateStoredDecision({ row: d, expectKstDate: d.kstDate })
    check(`막힌 결정(${d.state} ${d.release} · ${d.blocks.map((b) => b.code).join(',')})도 저장 가능한 모양이다`, v.ok, v.ok ? '' : v.reason)
  }
}

console.log('\n③ 🔴 🔴 PASS 가 아니면 같은 단계를 다시 · 바닥은 FLOOR · 기반은 지속 단계여야 한다')
{
  const retest = plan({ sustained: 'd1', prev: prevTrial('d1', 'd3'), evidence: null, preflight: preflightFor('d3') })
  check('🔴 전날 TRIAL d3 · 증거 없음 → TRIAL d3 재시험 (RETEST · 기반 d1)',
    retest.state === 'TRIAL' && retest.release === 'd3' && retest.transition?.kind === 'TRIAL' && retest.transition.basis === 'RETEST')
  const floor = plan({ sustained: 'd1', prev: prevDecision('d1'), preflight: preflightFor('d3') })
  check('바닥(d1) 유지 날 → d3 시험 (FLOOR)', floor.state === 'TRIAL' && floor.release === 'd3'
    && floor.transition?.kind === 'TRIAL' && floor.transition.basis === 'FLOOR')
  const mismatch = plan({ sustained: 'd1', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d5') })
  check('🔴 🔴 **계획 기반(d3) ≠ 지속 단계(d1) → PROVENANCE_STAGE · 두 칸을 뛰지 않는다**',
    mismatch.state !== 'TRIAL' && mismatch.release === 'd1' && mismatch.blocks.some((b) => b.code === 'PROVENANCE_STAGE'),
    `${mismatch.state} ${mismatch.release}`)
  const hold3 = plan({ sustained: 'd3', prev: prevDecision('d3'), preflight: preflightFor('d5') })
  check('🔴 증거 없는 d3 유지 날 → 시험 없이 REPROVE d3 (d5 preflight 가 초록이어도)',
    hold3.state === 'REPROVE' && hold3.release === 'd3')
  const first = plan({ sustained: 'd1', prev: null, preflight: preflightFor('d3') })
  check('🔴 전날 결정이 없으면 시험 없음 (첫 controller 실행일 · fail-closed)',
    first.state !== 'TRIAL' && first.blocks.some((b) => b.code === 'PROVENANCE_PREVIOUS'))
  check('그때 바닥은 REPROVE 가 아니라 PREPARE(다음 증명 d3 준비)', first.state === 'PREPARE' && first.capacity === 'd3')
  const pinned = plan({ sustained: 'd1', prev: null, publishedToday: 3 })
  check('🔴 오늘 이미 d1 목표보다 많이 냈으면 그날 고정 (dayPinned)', pinned.dayPinned === true)
}

console.log('\n⑩ 🔴 writer · 동시성 · rollback · 🔴 세 지점 전부 검증')
{
  /** 🔴 검사도 **운영과 같은 validator** 를 쓴다 — 여기서 느슨하게 만들면 뜻이 없다 */
  const validate = (row: unknown) => validateStoredDecision({
    row, expectKstDate: DATE
  })
  /** 🔴 `safestDecision` 은 HOLD·d1/d1 이다 — 그대로는 PREPARE 불변식에 걸리지 않는다 */
  const D = (o: Partial<StageDecision> = {}): StageDecision =>
    ({ ...safestDecision(DATE, AT), capacity: 'd10', ...o })

  /** ① 행이 없으면 controller 가 만든다 */
  let inserted = 0
  const first = await ensureStageDecision({
    read: async () => null, compute: () => D({ release: 'd5' }),
    insert: async () => { inserted += 1; return 'inserted' }, validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **결정은 controller 하나가 만든다 (first-writer 폐기)**',
    first.ok && first.created && first.by === DECISION_WRITER && inserted === 1, JSON.stringify(first))

  /** ② 이미 있으면 읽기만 한다 — 다시 계산하지 않는다 */
  let computed = 0
  const second = await ensureStageDecision({
    read: async () => D({ release: 'd3' }),
    compute: () => { computed += 1; return D({ release: 'd5' }) },
    insert: async () => 'inserted', validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **이미 있으면 그 행을 쓴다 — 계산도 덮어쓰기도 하지 않는다**',
    second.ok && !second.created && second.decision.release === 'd3' && computed === 0,
    `computed=${computed}`)

  /** ③ 동시 시작 — INSERT 충돌이면 이긴 행을 읽는다 */
  let reads = 0
  const raced = await ensureStageDecision({
    read: async () => { reads += 1; return reads === 1 ? null : D({ release: 'd3' }) },
    compute: () => D({ release: 'd5' }),
    insert: async () => 'conflict', validate, by: DECISION_WRITER,
  })
  check('🔴 유일키 충돌이면 자기 계산을 버리고 그 행을 읽는다',
    raced.ok && !raced.created && raced.decision.release === 'd3')

  /** ④ 만들지도 읽지도 못하면 UNAVAILABLE */
  const gone = await ensureStageDecision({
    read: async () => null, compute: () => D(), insert: async () => 'conflict',
    validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **행을 끝내 못 읽으면 `UNAVAILABLE` — "모른다" 를 어제 값으로 채우지 않는다**',
    !gone.ok && gone.code === 'UNAVAILABLE', JSON.stringify(gone))

  /**
   * ── 🔴 **세 지점 전부 검증한다** (2026-09-24 6차 · 마스터 지적) ──
   *    앞판은 읽은 행을 **검증 없이** `ok:true` 로 돌려줬다. 같은 행을 consumer 는
   *    `BROKEN` 으로 거절했으니, 두 경로가 서로 다른 답을 내고 있었다.
   */
  const brokenRow = { ...D({ release: 'd5' }), decidedBy: 'publish' }
  const b1 = await ensureStageDecision({
    read: async () => brokenRow, compute: () => D(), insert: async () => 'inserted',
    validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **① 기존 행이 깨졌으면 `ok:true` 가 아니라 `BROKEN`**',
    !b1.ok && b1.code === 'BROKEN', JSON.stringify(b1))

  /** 🔴 깨진 값이 저장까지 흘러갔는지 — 0 이어야 한다 */
  let leaked = 0
  const b2 = await ensureStageDecision({
    read: async () => null,
    // 🔴 계산한 값이 계약을 어기면 **넣기 전에** 막는다 — immutable 이라 되돌릴 수 없다
    compute: () => ({ ...D(), release: 'd10', capacity: 'd3' }),
    // 🔴 던지지 않고 **세어 둔다** — 던지면 검사가 죽어 빨간 줄이 아니라 스택이 나온다
    insert: async () => { leaked += 1; return 'inserted' },
    validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **② 계산한 행도 insert 전에 검증한다 (release > capacity 차단)**',
    !b2.ok && b2.code === 'BROKEN' && leaked === 0,
    `leaked=${leaked} ${JSON.stringify(b2)}`)

  let r3 = 0
  const b3 = await ensureStageDecision({
    read: async () => { r3 += 1; return r3 === 1 ? null : brokenRow },
    compute: () => D({ release: 'd5' }), insert: async () => 'conflict',
    validate, by: DECISION_WRITER,
  })
  check('🔴 🔴 **③ 충돌 뒤 읽은 승자 행도 검증한다**',
    !b3.ok && b3.code === 'BROKEN', JSON.stringify(b3))

  /** 🔴 controller 와 consumer 가 **같은 validator** 를 쓴다 — 같은 행에 같은 답이다 */
  const cSame = await consumeStageDecision({
    read: async () => brokenRow, validate, controllerOn: true, by: 'publish',
  })
  check('🔴 🔴 **같은 깨진 행에 controller 와 consumer 가 같은 답을 낸다**',
    !b1.ok && !cSame.ok && cSame.code === 'BROKEN',
    `controller=${b1.ok ? 'ok' : b1.code} consumer=${cSame.ok ? 'ok' : cSame.code}`)

  check('🔴 순서가 계약으로 고정돼 있다', ENSURE_STEPS.join(',') === 'read,compute,insert,reread')
  check('🔴 🔴 **rollback 은 kill switch 다 — contractVersion 되돌리기가 아니다**',
    controllerEnabled({ [CONTROLLER_ENV]: 'on' })
    && !controllerEnabled({ [CONTROLLER_ENV]: 'off' })
    && !controllerEnabled({}))
  const store = readFileSync('src/lib/stage-decision-store.ts', 'utf-8')
  check('🔴 하루 결정은 immutable — 갱신 칼럼을 두지 않는다',
    /immutable/.test(store) && !/revision\s*Int/.test(store))
  check('🔴 🔴 **근거 없는 90일 삭제 규칙이 없다**',
    !/90일|retention|보존 기간 규칙을 둔다/.test(store))
  /**
   * 🔴 이 파일은 **순서만** 정의하는 순수 계약 모듈이다. Prisma 는
   *    `stage-decision-repo` 가 끼워 넣는다 — 계약과 I/O 를 섞지 않는다.
   */
  check('🔴 store 순수 계약 모듈은 Prisma/DB I/O 를 직접 하지 않는다',
    !/prisma\.|\$transaction|migration\.sql/.test(store))
}

console.log('\n⑬ 🔴 🔴 consumer 는 읽기만 한다 — 없으면 사후 생성하지 않는다')
{
  const D = (o: Partial<StageDecision> = {}): StageDecision =>
    ({ ...safestDecision(DATE, AT), capacity: 'd10', ...o })
  /**
   * 🔴 **검사가 "통과" 를 지어낼 수 없다.** brand 타입이라 `validateStoredDecision`
   *    을 지나야만 `ok:true` 를 만들 수 있다 — 느슨한 가짜 validator 를 못 쓴다.
   */
  const pass = (row: unknown) => validateStoredDecision({
    row, expectKstDate: DATE
  })
  const off = await consumeStageDecision({
    read: async () => D(), validate: pass, controllerOn: false, by: 'supply',
  })
  check('🔴 🔴 **kill switch 가 꺼져 있으면 가장 안전한 단계로 간다 — env 로 돌아가는 legacy 경로는 없다**',
    !off.ok && off.fallback === 'safest', JSON.stringify(off))
  const none = await consumeStageDecision({
    read: async () => null, validate: pass, controllerOn: true, by: 'publish',
  })
  check('🔴 🔴 **결정이 없으면 높은 단계를 사후 생성하지 않고 안전 단계로 간다**',
    !none.ok && none.code === 'NO_DECISION' && none.fallback === 'safest', JSON.stringify(none))
  const broken = await consumeStageDecision({
    read: async () => D(), validate: () => ({ ok: false as const, reason: '계약 판이 다르다' }),
    controllerOn: true, by: 'publish',
  })
  check('🔴 🔴 **깨진 행은 쓰지 않는다 (BROKEN → 안전 단계)**',
    !broken.ok && broken.code === 'BROKEN' && broken.fallback === 'safest')
  const good = await consumeStageDecision({
    read: async () => D({ release: 'd5' }), validate: pass,
    controllerOn: true, by: 'supply',
  })
  check('정상 행은 그대로 쓴다', good.ok && good.decision.release === 'd5')
  check('🔴 consumer 는 둘이다 — writer 는 하나다',
    DECISION_CONSUMERS.join(',') === 'supply,publish' && DECISION_WRITER === 'controller')

  /** 🔴 저장된 행 검증 — 계약 판·날짜·enum·시각 */
  const V = (o: Record<string, unknown>) => validateStoredDecision({
    row: { ...D(), ...o }, expectKstDate: DATE
  })
  check('🔴 계약 판이 다르면 거절', !V({ contractVersion: 'old' }).ok)
  /**
   * 🔴 **계약 판은 매개변수가 아니다** (2026-09-24 8차). 호출자가 기대 판을 줄 수
   *    있으면 옛 행을 승인시킬 수 있고, 그러면 검증을 통과한 타입이 "현재 판" 을
   *    뜻하지 않게 된다. 🔴 시그니처에서 아예 없앴다 — 줄 자리가 없다.
   */
  check('🔴 🔴 **옛 판 행은 통과하지 못한다 (기대값을 줄 수 없다)**',
    !validateStoredDecision({
      row: { ...safestDecision(DATE, AT), capacity: 'd10', contractVersion: 'stage-decision-v3' },
      expectKstDate: DATE,
    }).ok
    && !/expectContractVersion|allowedStages|allowedStates/.test(
      readFileSync('src/lib/stage-decision-contract.ts', 'utf-8')
        .split('export function validateStoredDecision')[1] ?? ''))
  check('🔴 날짜가 다르면 거절', !V({ kstDate: '2026-09-23' }).ok)
  check('🔴 모르는 단계면 거절', !V({ release: 'd7' }).ok)
  check('🔴 모르는 상태면 거절', !V({ state: 'WAT' }).ok)
  check('🔴 결정 시각을 못 읽으면 거절', !V({ decidedAt: 'nope' }).ok)
  check('정상 행은 통과', V({}).ok)

  /**
   * ── 🔴 **깨진 입력에 던지지 않는다** (2026-09-24 6차 · 마스터 지적) ──
   *    앞판 시그니처는 `row: StageDecision` 이었다. 그 타입은 저장소의 약속이 아니라
   *    **희망**이다 — JSON 이 깨진 행을 읽으면 `r.decidedAt.trim()` 에서 그대로
   *    throw 했고 consumer 가 죽었다. 🔴 지금은 어떤 입력에도 `ok:false` 다.
   */
  const ROT: unknown[] = [
    null, undefined, 42, 'row', [], { }, { kstDate: DATE },
    { ...D(), reasons: 'nope' }, { ...D(), blocks: [{ code: 1 }] },
    { ...D(), dayPinned: 'yes' }, { ...D(), supply: { eligibleSpeakers: 'many' } },
  ]
  let threw: string | null = null
  const verdicts2 = ROT.map((row) => {
    try {
      return validateStoredDecision({
        row, expectKstDate: DATE
      })
    } catch (e) { threw = `${String(row)} → ${String(e)}`; return { ok: true as const } }
  })
  check('🔴 🔴 **어떤 깨진 입력에도 던지지 않는다**', threw === null, threw ?? '')
  check('🔴 🔴 **그리고 전부 거절한다 — 모르는 것을 통과시키지 않는다**',
    verdicts2.every((v) => !v.ok), `통과해 버린 것 ${verdicts2.filter((v) => v.ok).length}건`)

  /** ── 🔴 저장 행 불변식 ── */
  check('🔴 🔴 **공개가 승인 천장을 넘으면 거절**',
    !V({ release: 'd10', capacity: 'd3' }).ok, JSON.stringify(V({ release: 'd10', capacity: 'd3' })))
  check('🔴 🔴 **decidedAt 의 KST 날짜가 kstDate 와 다르면 거절**',
    !V({ decidedAt: `${PREV_DATE}T01:00:00.000Z` }).ok)
  check('🔴 🔴 **controller 가 쓴 행이 아니면 거절**', !V({ decidedBy: 'publish' }).ok)
  check('🔴 🔴 **TRIAL 인데 구조화된 시험 근거가 없으면 거절**',
    !V({ state: 'TRIAL', release: 'd3', transition: null }).ok)
  check('🔴 🔴 **TRIAL 공개가 기반의 바로 다음 칸이 아니면 거절**',
    !V({
      state: 'TRIAL', release: 'd10',
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: PREV_DATE, target: 'd10' },
    }).ok)
  check('🔴 정상 TRIAL 행은 통과 — d1 기반의 다음 칸은 d3 다',
    V({
      state: 'TRIAL', release: 'd3',
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: PREV_DATE, target: 'd3' },
    }).ok)
  check('🔴 🔴 **SUSTAIN 인데 승격 근거가 없거나 어긋나면 거절**',
    !V({ state: 'SUSTAIN', release: 'd3', transition: null }).ok
    && !V({
      state: 'SUSTAIN', release: 'd3',
      transition: { kind: 'SUSTAIN', from: 'd1', to: 'd5' },
    }).ok)
  check('🔴 🔴 **PREPARE 인데 천장이 공개보다 높지 않으면 거절**',
    !V({ state: 'PREPARE', release: 'd10', capacity: 'd10' }).ok
    && V({ state: 'PREPARE', release: 'd3', capacity: 'd10' }).ok)
  check('🔴 HOLD 인데 전이 근거가 붙어 있으면 거절',
    !V({ state: 'HOLD', transition: { kind: 'SUSTAIN', from: 'd1', to: 'd3' } }).ok)
  check('🔴 🔴 **문구를 파싱해 상태를 검증하지 않는다**',
    !/reasons[\s\S]{0,80}(includes|match|test)\(/.test(
      readFileSync('src/lib/stage-decision-store.ts', 'utf-8')))
}

console.log('\n⑮ 🔴 🔴 trialBase 는 전날 실제 결정에서만 온다')
{
  const hasPrev = (d: ReturnType<typeof plan>) => d.blocks.some((b) => b.code === 'PROVENANCE_PREVIOUS')
  const twoDays = plan({ sustained: 'd1', prev: prevDecision('d1', { kstDate: previousKstDate(PREV_DATE)! }), preflight: preflightFor('d3') })
  check('🔴 🔴 **이틀 전 결정이면 차단**', twoDays.state !== 'TRIAL' && hasPrev(twoDays))
  const oldVer = plan({ sustained: 'd1', prev: prevDecision('d1', { contractVersion: 'stage-decision-v3' as never }), preflight: preflightFor('d3') })
  check('🔴 🔴 **모르는 contractVersion 이면 차단 (validator 가 거절 → 결정 없음)**', oldVer.state !== 'TRIAL' && hasPrev(oldVer))
  const notController = plan({ sustained: 'd1', prev: prevDecision('d1', { decidedBy: 'publish' }), preflight: preflightFor('d3') })
  check('🔴 🔴 **writer 가 controller 가 아니면 차단**', notController.state !== 'TRIAL' && hasPrev(notController))
  const bigJump = plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d10') })
  check('🔴 🔴 **전날 d3 PASS 인데 d10 preflight 를 넘겨도 d10 은 열리지 않는다 (다음 칸은 d5)**',
    bigJump.release !== 'd10' && bigJump.state !== 'TRIAL')
  check('🔴 정본은 전날 결정이다 — env 문자열에서 기반을 만들지 않는다',
    !/trialBase[^\n]*SORAN_RELEASE_STAGE/.test(readFileSync('src/lib/stage-ladder.ts', 'utf-8')))
  check('🔴 다음 칸 계산은 정본 하나다 — 러너 단계 위(d10 → d20 · d50 → 없음)', nextStage('d3') === 'd5' && nextStage('d10') === 'd20' && nextStage('d50') === null)
}

console.log('\n⑯ 🔴 🔴 검증되지 않은 전날 결정으로 시험이 열리면 안 된다')
{
  const go = (prev: ValidatedStageDecision | null) =>
    plan({ sustained: 'd3', prev, evidence: prev === null ? null : passEvidence('d3'), preflight: preflightFor('d5') })
  check('🔴 기준선 — 멀쩡한 전날 TRIAL d3 결정이면 열린다', go(prevTrial('d1', 'd3')).state === 'TRIAL')
  const rot = (label: string, o: Record<string, unknown>, want: string) => {
    const v = validateStoredDecision({ row: prevRow('d3', o), expectKstDate: PREV_DATE })
    check(`🔴 🔴 **${label} — 저장 검증이 거절한다**`, !v.ok && v.reason.includes(want), v.ok ? '🔴 통과해 버림' : v.reason)
    const d = go(v.ok ? v.decision : null)
    check(`🔴 🔴 **${label} — 그래서 시험이 열리지 않는다**`,
      d.state !== 'TRIAL' && d.blocks.some((b) => b.code === 'PROVENANCE_PREVIOUS'),
      `${d.state} release=${d.release} blocks=${JSON.stringify(d.blocks.map((b) => b.code))}`)
  }
  rot('전날 천장 < 공개', { capacity: 'd1' }, '승인 천장')
  rot('전날 decidedAt 이 그 날짜가 아니다', { decidedAt: '2020-01-01T00:00:00.000Z' }, 'decidedAt')
  rot('전날 전이 근거가 상태와 어긋난다', { state: 'TRIAL', transition: { kind: 'SUSTAIN', from: 'd1', to: 'd10' } }, '시험 근거')
  rot('전날 상태가 정본 enum 이 아니다', { state: 'NOPE' }, '모르는 상태')
  rot('전날 block 코드가 정본이 아니다', { blocks: [{ code: 'WAT', reason: 'x' }] }, 'block 코드')
  rot('전날 supply 가 깨졌다', { supply: { eligibleSpeakers: -1, excluded: [] } }, 'eligibleSpeakers')
  rot('🔴 전날이 v5 SUSTAIN 이다(지속 승격 경로 삭제)', { state: 'SUSTAIN', transition: { kind: 'SUSTAIN', from: 'd1', to: 'd3' } }, 'SUSTAIN')
  check('🔴 🔴 **사다리가 검증 로직을 두 벌로 복제하지 않는다**', (() => {
    const ladder = readFileSync('src/lib/stage-ladder.ts', 'utf-8')
    return !/prev\.contractVersion/.test(ladder) && !/prev\.decidedBy/.test(ladder)
      && /previousDecision: ValidatedStageDecision \| null/.test(ladder)
  })())
}

console.log('\n⑰ 🔴 🔴 TRIAL 의 previousKstDate 는 정확히 직전 날짜다')
{
  const V = (o: Record<string, unknown>) => validateStoredDecision({
    row: {
      ...safestDecision(DATE, AT), capacity: 'd10', release: 'd3', state: 'TRIAL',
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: PREV_DATE, target: 'd3' },
      ...o,
    },
    expectKstDate: DATE
  })
  const withPrev = (previousKstDate: string) => V({
    transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate, target: 'd3' },
  })
  check('🔴 정상 직전 날짜는 통과', withPrev(PREV_DATE).ok, PREV_DATE)
  /** 🔴 **마스터 실행 반례** — 형식만 맞는 아무 날짜가 통과했다 */
  check('🔴 🔴 **1999-01-01 은 직전 날짜가 아니다 — 거절**', !withPrev('1999-01-01').ok)
  check('🔴 하루 더 전도 거절', !withPrev(previousKstDate(PREV_DATE)!).ok)
  check('🔴 같은 날도 거절', !withPrev(DATE).ok)
  /**
   * 🔴 **정규식만 보지 않는다.** `2026-02-30` 은 `\d{4}-\d{2}-\d{2}` 를 만족하지만
   *    달력에 없는 날이다. 되돌려 찍어(canonical round-trip) 같은 글자가 나오는지 본다.
   */
  check('🔴 🔴 **달력에 없는 날짜는 거절한다 (round-trip)**',
    !withPrev('2026-02-30').ok && !withPrev('2026-13-01').ok && !withPrev('2026-09-00').ok,
    JSON.stringify(['2026-02-30', '2026-13-01', '2026-09-00'].map((x) => withPrev(x).ok)))
  /**
   * 🔴 **round-trip 만이 잡는 입력.** `Date.parse('2026-02-30T00:00:00Z')` 는
   *    **유한한 값**을 돌려준다(3월 2일로 굴러간다) — 그래서 `Number.isFinite` 로는
   *    걸리지 않는다. 되돌려 찍어 같은 글자가 나오는지 보는 것만이 이것을 막는다.
   */
  check('🔴 🔴 **정본 날짜 함수가 달력에 없는 날을 거절한다 (round-trip 단독)**',
    !isCalendarDate('2026-02-30') && !isCalendarDate('2026-13-01')
    && !isCalendarDate('2026-09-00') && isCalendarDate('2026-09-24'),
    JSON.stringify(['2026-02-30', '2026-13-01', '2026-09-00', '2026-09-24'].map(isCalendarDate)))
  check('🔴 🔴 **previousKstDate 도 그런 날짜를 받지 않는다**',
    previousKstDate('2026-02-30') === null && previousKstDate('2026-09-24') === '2026-09-23',
    `${String(previousKstDate('2026-02-30'))} · ${String(previousKstDate('2026-09-24'))}`)
  check('🔴 kstDate 자체도 달력에 있는 날이어야 한다',
    !validateStoredDecision({
      row: { ...safestDecision('2026-02-30', AT), capacity: 'd10' },
      expectKstDate: '2026-02-30'
    }).ok)
}

console.log('\n⑱ 🔴 🔴 저장 모델 왕복 · KST 날짜당 결정 하나')
{
  /** 🔴 validator 가 요구하는 값을 **전부** 담은 결정 */
  const full: StageDecision = {
    kstDate: DATE, capacity: 'd10', release: 'd5', state: 'TRIAL',
    reasons: ['🟢 오늘 하루 d5 로 낸다'],
    // 🔴 TRIAL 을 무효로 만들지 않는 block 이어야 한다 — 승격 출처 어긋남은
    //    승격만 버리고 하루 시험은 그대로 연다(planStageDecision 이 실제로 만드는 조합)
    blocks: [{ code: 'PROVENANCE_NEXT', reason: 'promotion.next 가 다음 칸이 아니다' }],
    dayPinned: true,
    supply: { eligibleSpeakers: 3, excluded: [{ reason: 'noOpenDay', codes: ['P01', 'P02'] }] },
    decidedAt: `${DATE}T02:15:00.000Z`,
    contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER,
    transition: { kind: 'TRIAL', trialBase: 'd3', previousKstDate: PREV_DATE, target: 'd5', basis: 'PASS' },
  }
  /** 🔴 제안 모델의 칸이 validator 가 보는 키를 전부 덮는가 */
  check('🔴 🔴 **모델 칸이 결정의 모든 키를 덮는다 — 빠지면 저장 못 한다**',
    Object.keys(full).every((k) => (STORED_COLUMNS as readonly string[]).includes(k))
    && STORED_COLUMNS.length === Object.keys(full).length,
    `결정 ${Object.keys(full).length}키 vs 모델 ${STORED_COLUMNS.length}칸`)

  /** 🔴 결정 → DB 행 → 다시 읽기 → 검증 */
  const row = decisionToRow(full)
  const back = rowToDecisionInput(row)
  const v = validateStoredDecision({
    row: back, expectKstDate: DATE
  })
  check('🔴 🔴 **완전한 저장 모델 왕복이 검증을 통과한다**', v.ok, v.ok ? '' : v.reason)
  /** 🔴 키 순서는 뜻이 아니다 — 정렬해 비교한다 */
  const norm = (x: unknown): string =>
    JSON.stringify(x, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort())
      : val))
  check('🔴 🔴 **왕복에서 값이 사라지지 않는다**',
    v.ok && norm(v.decision) === norm(full),
    v.ok ? `${norm(v.decision).slice(0, 140)}` : '')
  check('🔴 dayPinned · supply · transition 이 실제로 담겼다',
    row.dayPinned === true
    && JSON.stringify(row.supply) === JSON.stringify(full.supply)
    && JSON.stringify(row.transition) === JSON.stringify(full.transition))
  /** 🔴 DateTime 왕복이 KST 날짜를 지키는가 — 이것이 어긋나면 검증이 막는다 */
  check('🔴 🔴 **decidedAt 이 DateTime 왕복 뒤에도 그날 안이다**',
    (back as { decidedAt: string }).decidedAt === full.decidedAt)

  /**
   * ── 🔴 **같은 KST 날짜에 판이 다른 두 번째 행을 만들지 않는다** ──
   *    앞판 유일키는 `(kstDate, contractVersion)` 이었다 — 그 키는 같은 날 판을 올리면
   *    **두 번째 행**을 허용한다. 하루 결정이 둘이 되면 아침과 낮의 상한이 달라진다.
   */
  check('🔴 🔴 **유일키가 KST 날짜 하나다**',
    Object.keys(decisionKeyOf(full)).join(',') === 'kstDate',
    Object.keys(decisionKeyOf(full)).join(','))
  let inserts = 0
  const oldVersionRow = { ...decisionToRow(full), contractVersion: 'stage-decision-v3' }
  const second = await ensureStageDecision({
    // 🔴 같은 날에 **옛 판** 행이 이미 있다
    read: async () => rowToDecisionInput(oldVersionRow),
    compute: () => full,
    insert: async () => { inserts += 1; return 'inserted' },
    validate: (row) => validateStoredDecision({
      row, expectKstDate: DATE
    }),
    by: DECISION_WRITER,
  })
  check('🔴 🔴 **같은 날 다른 contractVersion 이면 두 번째 행을 만들지 않는다**',
    !second.ok && second.code === 'BROKEN' && inserts === 0,
    `inserts=${inserts} ${JSON.stringify(second)}`)
  const consumed = await consumeStageDecision({
    read: async () => rowToDecisionInput(oldVersionRow),
    validate: (row) => validateStoredDecision({
      row, expectKstDate: DATE
    }),
    controllerOn: true, by: 'publish',
  })
  check('🔴 🔴 **그때 consumer 는 fail-closed 로 간다 (가장 안전한 단계 d1)**',
    !consumed.ok && consumed.code === 'BROKEN' && consumed.fallback === 'safest',
    JSON.stringify(consumed))
  check('🔴 🔴 **제안 모델이 kstDate 를 기본키로 둔다 — DB 가 하루 하나를 강제한다**', (() => {
    const store = readFileSync('src/lib/stage-decision-store.ts', 'utf-8')
    // 🔴 설명 문장이 아니라 **모델 블록 안**을 본다
    const model = store.match(/```prisma([\s\S]*?)```/)?.[1] ?? ''
    return /kstDate\s+String\s+@id/.test(model) && !/@@unique\(/.test(model)
      // 🔴 모델이 validator 가 요구하는 칸을 전부 갖는다
      && STORED_COLUMNS.every((c) => new RegExp(`\\b${c}\\s+\\w`).test(model))
  })())
}

console.log('\n⑲ 🔴 🔴 supply · blocks 모양 검증')
{
  const V = (o: Record<string, unknown>) => validateStoredDecision({
    row: { ...safestDecision(DATE, AT), capacity: 'd10', ...o },
    expectKstDate: DATE
  })
  check('🔴 정상 supply 는 통과',
    V({ supply: { eligibleSpeakers: 0, excluded: [{ reason: 'holdingStock', codes: [] }] } }).ok)
  check('🔴 🔴 **eligibleSpeakers 가 음수면 거절**',
    !V({ supply: { eligibleSpeakers: -1, excluded: [] } }).ok)
  check('🔴 🔴 **정수가 아니거나 유한하지 않으면 거절**',
    !V({ supply: { eligibleSpeakers: 1.5, excluded: [] } }).ok
    && !V({ supply: { eligibleSpeakers: Number.POSITIVE_INFINITY, excluded: [] } }).ok
    && !V({ supply: { eligibleSpeakers: Number.NaN, excluded: [] } }).ok
    && !V({ supply: { eligibleSpeakers: '3', excluded: [] } }).ok)
  check('🔴 🔴 **모르는 제외 사유면 거절**',
    !V({ supply: { eligibleSpeakers: 1, excluded: [{ reason: 'because', codes: [] }] } }).ok)
  check('🔴 codes 가 문자열 배열이 아니면 거절',
    !V({ supply: { eligibleSpeakers: 1, excluded: [{ reason: 'noOpenDay', codes: [1] }] } }).ok)
  check('🔴 excluded 가 배열이 아니면 거절',
    !V({ supply: { eligibleSpeakers: 1, excluded: {} } }).ok)
  check('🔴 🔴 **blocks.code 는 정본 enum 만이다**',
    !V({ blocks: [{ code: 'WAT', reason: 'x' }] }).ok
    && V({ blocks: [{ code: 'CEILING', reason: 'x' }] }).ok
    && BLOCK_CODES.includes('PROVENANCE_PREVIOUS'))
  check('🔴 blocks 항목 모양이 깨지면 거절',
    !V({ blocks: [{ code: 'CEILING' }] }).ok && !V({ blocks: ['CEILING'] }).ok)
}

console.log('\n⑳ 🔴 🔴 validator 는 fail-open 이 아니다')
{
  const raw = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    kstDate: DATE, capacity: 'd10', release: 'd5', state: 'HOLD',
    reasons: ['유지'], blocks: [], dayPinned: false, supply: null,
    decidedAt: `${DATE}T01:00:00.000Z`,
    contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null, ...o,
  })
  const V = (row: unknown) => validateStoredDecision({ row, expectKstDate: DATE })

  /** ── ① 🔴 호출자가 정본 enum 을 주입할 수 없다 ── */
  check('🔴 🔴 **allowedStages 로 `evil` 단계를 통과시킬 수 없다**',
    !V({ ...raw({ release: 'evil', capacity: 'evil' }), allowedStages: ['d1', 'evil'] }).ok,
    JSON.stringify(V({ ...raw({ release: 'evil', capacity: 'evil' }) }).ok))
  check('🔴 🔴 **allowedStates 로 `EVIL` 상태를 통과시킬 수 없다**',
    !V({ ...raw({ state: 'EVIL' }), allowedStates: ['EVIL'] }).ok)
  /** 🔴 **각 칸이 단독으로 결정하는 입력** — 하나만 어긋나게 해 서로 가리지 않게 한다 */
  /**
   * 🔴 **거절만으로는 모자란다.** 천장 값이 쓰레기일 때 순위 비교 규칙도 거절하지만,
   *    그 메시지는 "공개 d1 이 승인 천장 evil 를 넘는다" 다 — **공개가 잘못됐다**고
   *    읽힌다. 실제로 고칠 칸은 천장이다. 어느 칸이 깨졌는지 맞게 말해야 한다.
   */
  const badCap = V(raw({ capacity: 'evil', release: 'd1' }))
  check('🔴 🔴 **천장만 어긋나도 거절하고, 천장이 문제라고 말한다**',
    !badCap.ok && badCap.reason.includes('모르는 천장'),
    badCap.ok ? '🔴 통과해 버림' : badCap.reason)
  check('🔴 공개만 어긋나도 거절 (capacity 는 정상)', !V(raw({ release: 'evil' })).ok)
  check('🔴 상태만 어긋나도 거절', !V(raw({ state: 'EVIL' })).ok)
  check('🔴 🔴 **시그니처에 주입 자리가 없다 — 줄 수가 없다**', (() => {
    const src = readFileSync('src/lib/stage-decision-contract.ts', 'utf-8')
    const fn = src.split('export function validateStoredDecision')[1] ?? ''
    const sig = fn.slice(0, fn.indexOf('}): ValidateResult'))
    return !/allowedStages|allowedStates|expectContractVersion/.test(sig)
      && /expectKstDate: string/.test(sig)
  })())

  /** ── ② 🔴 검증된 결정은 입력과 참조를 공유하지 않는다 ── */
  const mutable = raw({
    state: 'TRIAL', release: 'd5',
    transition: { kind: 'TRIAL', trialBase: 'd3', previousKstDate: PREV_DATE, target: 'd5', basis: 'PASS' },
    reasons: ['처음'],
    blocks: [{ code: 'PROVENANCE_NEXT', reason: '어긋남' }],
    supply: { eligibleSpeakers: 2, excluded: [{ reason: 'noOpenDay', codes: ['P01'] }] },
  })
  const got = V(mutable)
  check('🔴 기준선 — 그 행은 통과한다', got.ok, got.ok ? '' : got.reason)
  if (got.ok) {
    const d = got.decision
    const snapshot = JSON.stringify(d)
    /** 🔴 원본을 통째로 흔든다 — 하나라도 따라 바뀌면 그 검증은 사진이 아니다 */
    mutable.capacity = 'evil'
    mutable.release = 'evil'
    mutable.decidedAt = '2020-01-01T00:00:00.000Z'
    mutable.state = 'EVIL'
    ;(mutable.reasons as string[]).push('나중')
    ;(mutable.blocks as { code: string }[])[0]!.code = 'EVIL'
    ;(mutable.blocks as unknown[]).push({ code: 'CEILING', reason: 'x' })
    const sp = mutable.supply as { eligibleSpeakers: number; excluded: { codes: string[] }[] }
    sp.eligibleSpeakers = -9
    sp.excluded[0]!.codes.push('P99')
    ;(mutable.transition as { trialBase: string }).trialBase = 'evil'
    check('🔴 🔴 **검증 뒤 원본을 바꿔도 결정은 그대로다 (깊은 스냅샷)**',
      JSON.stringify(d) === snapshot, `${JSON.stringify(d).slice(0, 160)}`)
    check('🔴 🔴 **중첩까지 얼어 있다 — 받은 쪽도 못 고친다**', (() => {
      const before = JSON.stringify(d)
      try {
        (d.blocks as unknown as { code: string }[])[0]!.code = 'EVIL'
        ;(d.reasons as unknown as string[]).push('침입')
        ;(d.supply?.excluded[0]?.codes as unknown as string[])?.push('P99')
      } catch { /* strict mode 에서는 던진다 — 그것도 막힌 것이다 */ }
      return JSON.stringify(d) === before
        && Object.isFrozen(d) && Object.isFrozen(d.blocks) && Object.isFrozen(d.supply)
    })())
  }

  /** ── ③ 🔴 필수 키 — DB select 에서 칼럼 하나가 빠진 행 ── */
  for (const k of REQUIRED_KEYS) {
    const missing = raw()
    delete missing[k]
    const v = V(missing)
    /**
     * 🔴 **거절만으로는 모자란다 — 어느 칸이 빠졌는지 맞게 말해야 한다.**
     *    칸별 규칙도 `undefined` 는 거절하지만, `transition` 누락을 "붙어 있다" 로
     *    말한다. 없는 것을 있다고 하는 메시지는 사람을 엉뚱한 칼럼으로 보낸다.
     */
    check(`🔴 필수 키 \`${k}\` 누락을 거절하고 그 칸 이름을 맞게 말한다`,
      !v.ok && v.reason.includes(k) && !/붙어 있다/.test(v.reason),
      v.ok ? '🔴 통과해 버림' : v.reason)
  }
  check('🔴 🔴 **`supply`·`transition` 이 `undefined` 면 거절 (null 과 다르다)**',
    !V(raw({ supply: undefined })).ok && !V(raw({ transition: undefined })).ok)
  check('🔴 `null` 은 정상이다 — "값이 없음" 을 뜻한다',
    V(raw({ supply: null, transition: null })).ok)

  /** ── ④ 🔴 선택된 전이를 무효로 만드는 block ── */
  const trialWith = (code: string) => V(raw({
    state: 'TRIAL', release: 'd5',
    transition: { kind: 'TRIAL', trialBase: 'd3', previousKstDate: PREV_DATE, target: 'd5', basis: 'PASS' },
    blocks: [{ code, reason: 'x' }],
  }))
  for (const code of TRANSITION_FATAL_BLOCKS.TRIAL) {
    check(`🔴 🔴 **TRIAL 인데 \`${code}\` 가 있으면 거절**`, !trialWith(code).ok,
      trialWith(code).ok ? '🔴 통과해 버림' : '')
  }
  check('🔴 TRIAL 을 무효로 만들지 않는 block 은 허용한다 — 승격만 버려진 경우다',
    trialWith('PROVENANCE_NEXT').ok && trialWith('PROVENANCE_CURRENT').ok)
  /** 🔴 (2026-09-30) v5 는 SUSTAIN 을 받지 않는다 — 옛 v4 행의 SUSTAIN 규칙만 남아 있다 */
  check('🔴 🔴 **v5 SUSTAIN 행은 거절한다 — 지속 승격 경로를 지웠다**', !V(raw({
    state: 'SUSTAIN', release: 'd5', transition: { kind: 'SUSTAIN', from: 'd3', to: 'd5' },
  })).ok)
  const sustainWith = (code: string) => V(raw({
    state: 'SUSTAIN', release: 'd5', contractVersion: 'stage-decision-v4',
    transition: { kind: 'SUSTAIN', from: 'd3', to: 'd5' },
    blocks: [{ code, reason: 'x' }],
  }))
  for (const code of TRANSITION_FATAL_BLOCKS.SUSTAIN) {
    check(`🔴 🔴 **SUSTAIN 인데 \`${code}\` 가 있으면 거절**`, !sustainWith(code).ok)
  }
  check('🔴 (옛 v4 행) SUSTAIN 을 무효로 만들지 않는 block 은 허용한다',
    sustainWith('STALE_DAILY').ok)
  check('🔴 🔴 **PREPARE·HOLD 는 block 이 있어도 정상이다 — 비었는지로 보지 않는다**',
    V(raw({ state: 'PREPARE', release: 'd3', capacity: 'd10', blocks: [{ code: 'CEILING', reason: 'x' }] })).ok
    && V(raw({ state: 'HOLD', blocks: [{ code: 'CEILING', reason: 'x' }] })).ok)

  /** 🔴 실측 반례 — consumer 까지 fail-closed 인가 */
  const badTrial = raw({
    state: 'TRIAL', release: 'd5',
    transition: { kind: 'TRIAL', trialBase: 'd3', previousKstDate: PREV_DATE, target: 'd5', basis: 'PASS' },
    blocks: [{ code: 'PROVENANCE_PREVIOUS', reason: '전날 결정이 없다' }],
  })
  const consumed = await consumeStageDecision({
    read: async () => badTrial, validate: (row) => validateStoredDecision({ row, expectKstDate: DATE }),
    controllerOn: true, by: 'publish',
  })
  check('🔴 🔴 **`TRIAL d5 + PROVENANCE_PREVIOUS` → consumer 가 fail-closed 로 간다**',
    !consumed.ok && consumed.code === 'BROKEN' && consumed.fallback === 'safest',
    JSON.stringify(consumed))

  /** ── ⑤ 🔴 brand 는 실수를 막을 뿐이다 — production 전체에서 cast 를 금지한다 ── */
  check('🔴 🔴 **brand 설명이 사실이다 — "만들어 낼 수 없다" 고 쓰지 않는다**', (() => {
    const src = readFileSync('src/lib/stage-decision-contract.ts', 'utf-8')
    return /assertion/.test(src) && /brand 를 그대로 통과한다|우회할 수 있다|사실이 아니다/.test(src)
      && /진짜 안전 경계는 타입이 아니라 값이다/.test(src)
  })())
  check('🔴 자동 탐색이 실제로 파일을 찾았다 — 빈 목록으로 초록이 되지 않는다',
    PRODUCTION_FILES.length > 50, `${PRODUCTION_FILES.length}개`)
  check('🔴 🔴 **contract 밖 production 어디에도 직접·이중 cast 가 없다**', (() => {
    const bad = PRODUCTION_FILES.filter((f) => {
      const code = readFileSync(f, 'utf-8')
        .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
      return /as\s+(unknown\s+as\s+)?ValidatedStageDecision/.test(code)
        || /<ValidatedStageDecision>/.test(code)
        || /as\s+\w+\s+as\s+ValidatedStageDecision/.test(code)
        || /satisfies\s+ValidatedStageDecision/.test(code)
    })
    return bad.length === 0
  })(), '')
  check('🔴 🔴 **cast 는 contract 안 materialize 한 줄에만 있다**', (() => {
    // 🔴 주석에 적힌 설명은 코드가 아니다 — 코드 줄만 센다
    const code = readFileSync('src/lib/stage-decision-contract.ts', 'utf-8')
      .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    return (code.match(/as ValidatedStageDecision/g) ?? []).length === 1
      && /deepFreeze\(decision\) as ValidatedStageDecision/.test(code)
  })())
}

console.log('\n㉑ 🔴 🔴 정본 결정기가 만드는 결과는 정본 validator 를 통과한다')
{
  const cases: { label: string; d: ReturnType<typeof planStageDecision> }[] = [
    { label: 'TRIAL (전날 d3 PASS → 오늘 d5)', d: plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d5') }) },
    { label: 'TRIAL RETEST (d3)', d: plan({ sustained: 'd1', prev: prevTrial('d1', 'd3'), preflight: preflightFor('d3') }) },
    { label: 'TRIAL FLOOR (d1 → d3)', d: plan({ sustained: 'd1', prev: prevDecision('d1'), preflight: preflightFor('d3') }) },
    { label: 'REPROVE (preflight UNKNOWN)', d: plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d5', { contractValidPersonas: null }) }) },
    { label: 'REPROVE (증거 없는 d5 유지 날)', d: plan({ sustained: 'd5', prev: prevDecision('d5') }) },
    { label: 'PREPARE (전날 결정 없음)', d: plan({ sustained: 'd1', prev: null }) },
    { label: 'PROVENANCE_STAGE (기반 ≠ 지속)', d: plan({ sustained: 'd1', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d5') }) },
    { label: 'LATE_START', d: plan({ sustained: 'd3', prev: prevTrial('d1', 'd3'), evidence: passEvidence('d3'), preflight: preflightFor('d5'), decidedAt: new Date(`${DATE}T21:00:00+09:00`).toISOString() }) },
    { label: '맨 위 d50 유지', d: plan({ sustained: 'd50', prev: prevDecision('d50') }) },
  ]
  const states = new Set(cases.map((c) => c.d.state))
  check('🔴 시나리오가 여러 상태를 실제로 만든다 — 한 가지만 보고 통과시키지 않는다',
    states.has('TRIAL') && states.has('REPROVE') && states.has('PREPARE'), [...states].join(','))
  for (const c of cases) {
    const v = validateStoredDecision({ row: c.d, expectKstDate: DATE })
    check(`🔴 🔴 **${c.label} → state=${c.d.state} · validator 통과**`,
      v.ok, v.ok ? '' : `${v.reason} · blocks=${JSON.stringify(c.d.blocks.map((b) => b.code))}`)
  }
  check('🔴 🔴 **TRIAL 결과에 치명 block 이 실제로 붙지 않는다**',
    cases.filter((c) => c.d.state === 'TRIAL').every((c) => c.d.blocks.every((b) => !TRANSITION_FATAL_BLOCKS.TRIAL.includes(b.code))))
  check('🔴 사다리가 만든 결정은 전부 v5 다', cases.every((c) => c.d.contractVersion === STAGE_DECISION_VERSION) && TRANSITION_STATES.includes('REPROVE'))
}

console.log('\n㉒ 🔴 🔴 저장 adapter 는 create/read 뿐이다 · flag 는 꺼져 있다')
{
  const REPO = 'src/lib/stage-decision-repo.ts'
  const repoCode = readFileSync(REPO, 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')

  /**
   * 🔴 **불변은 DB 가 지켜 주지 않는다** (2026-09-25 마스터 정정).
   *    `updatedAt` 칼럼이 없어도 `UPDATE`·`upsert`·`deleteMany` 는 그대로 돈다.
   *    실제로 지키는 것은 **adapter 가 그 경로를 내주지 않는 것**이다.
   */
  const FORBIDDEN = [
    'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
    'createMany', 'executeRaw', 'queryRaw',
  ]
  const found = FORBIDDEN.filter((m) => new RegExp(`stageDecision\\.${m}\\b`).test(repoCode)
    || new RegExp(`\\$${m}\\b`).test(repoCode))
  check('🔴 🔴 **adapter 에 갱신·삭제 경로가 하나도 없다**',
    found.length === 0, found.join(',') || '(없음)')
  check('🔴 🔴 **쓰는 길은 `create` 하나뿐이다**',
    (repoCode.match(/stageDecision\.create\(/g) ?? []).length === 1
    && /stageDecision\.findUnique\(/.test(repoCode),
    `${(repoCode.match(/stageDecision\.create\(/g) ?? []).length}회`)
  check('🔴 유일키 충돌을 예외로 삼키지 않고 값으로 낸다',
    /P2002/.test(repoCode) && /return 'conflict'/.test(repoCode))
  /**
   * 🔴 **nullable JSON 은 `JsonNull` 하나로 쓴다.** `DbNull` 과 섞이면 읽을 때
   *    한쪽이 `undefined` 로 와 validator 가 필수 키 누락으로 거절한다.
   */
  check('🔴 🔴 **JsonNull 로 쓰고 DbNull 을 쓰지 않는다**',
    (repoCode.match(/Prisma\.JsonNull/g) ?? []).length === 2 && !/Prisma\.DbNull/.test(repoCode))
  /**
   * 🔴 **저장 경계는 검증된 값만 받는다** (2026-09-25 마스터 지적).
   *    앞판 `createStageDecision`·`decisionToCreateInput` 은 `StageDecision` 을 받았다 —
   *    계산만 하고 검증을 지나지 않은 객체가 그대로 저장 입력이 됐다.
   *    저장은 되돌릴 수 없다(immutable). 타입으로 좁히고, 런타임에서 한 번 더 본다.
   */
  check('🔴 🔴 **create 경계가 ValidatedStageDecision 만 받는다**',
    /createStageDecision\(\s*\n?\s*db: StageDecisionDb, d: ValidatedStageDecision,/.test(repoCode)
    && /decisionToCreateInput\(d: ValidatedStageDecision\)/.test(repoCode))
  check('🔴 🔴 **저장 직전에 정본 validator 를 한 번 더 지난다 — 실패면 create 를 안 부른다**',
    /const v = validateStoredDecision\(\{ row: d, expectKstDate: d\.kstDate \}\)/.test(repoCode)
    && /if \(!v\.ok\) return 'rejected'/.test(repoCode)
    // 🔴 검증기가 만든 **사본**을 넣는다 — 들어온 객체를 그대로 쓰지 않는다
    && /decisionToCreateInput\(v\.decision\)/.test(repoCode))
  const storeCode = readFileSync('src/lib/stage-decision-store.ts', 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  check('🔴 🔴 **ensure 가 검증 전 원본이 아니라 불변 사본을 넣는다**',
    /await io\.insert\(fv\.decision\)/.test(storeCode)
    && !/await io\.insert\(fresh\)/.test(storeCode)
    && /insert: \(d: ValidatedStageDecision\)/.test(storeCode))
  check('🔴 저장 경계가 거절하면 BROKEN 이다 — 성공으로 넘기지 않는다',
    /if \(r === 'rejected'\) return broken\(/.test(storeCode))
  /**
   * 🔴 **빠진 칼럼을 `null` 로 메우지 않는다.** 메우면 select 가 칼럼을 빠뜨린 행이
   *    "값 없음" 으로 통과한다(fail-open). 빠진 것과 없는 것은 다른 사실이다.
   */
  check('🔴 🔴 **읽기가 `undefined` 를 `null` 로 메우지 않는다**',
    !/row\.supply \?\? null/.test(repoCode) && !/row\.transition \?\? null/.test(repoCode)
    && /supply: row\.supply,/.test(repoCode) && /transition: row\.transition,/.test(repoCode))
  check('🔴 읽은 원본을 그대로 흘리지 않는다 — 정본 validator 를 지난다',
    /validateStoredDecision\(\{ row: rowToValidatorInput\(row\)/.test(repoCode))

  /** 🔴 모델이 validator 가 요구하는 칸을 전부 갖는가 — 주석이 아니라 schema 를 본다 */
  const model = (readFileSync('prisma/schema.prisma', 'utf-8')
    .match(/model StageDecision \{([\s\S]*?)\n\}/)?.[1] ?? '')
  check('🔴 🔴 **schema 에 StageDecision 모델이 있다**', model.trim() !== '')
  check('🔴 🔴 **유일키는 `kstDate` 하나다 — 같은 날 두 번째 행을 DB 가 막는다**',
    /kstDate\s+String\s+@id/.test(model) && !/@@unique\(/.test(model),
    model.split('\n')[1] ?? '')
  check('🔴 🔴 **validator 가 요구하는 칸이 전부 있다**',
    STORED_COLUMNS.every((c) => new RegExp(`^\\s*${c}\\s+\\w`, 'm').test(model)),
    STORED_COLUMNS.filter((c) => !new RegExp(`^\\s*${c}\\s+\\w`, 'm').test(model)).join(',') || '(빠짐 없음)')
  check('🔴 갱신 칼럼을 두지 않는다 — 계약의 표시다(강제는 adapter 가 한다)',
    !/updatedAt/.test(model) && !/revision/.test(model))
  /**
   * 🔴 **`supply`·`transition` 은 `Json?` 이 아니라 `Json` 이다.**
   *    nullable 로 두면 SQL NULL 행이 생기고, 그 행은 "값 없음" 과 구분되지 않는다.
   */
  // 🔴 주석에 적힌 `Json?` 은 설명이지 칼럼이 아니다 — 필드 줄만 본다
  const modelFields = model.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  check('🔴 🔴 **supply·transition 이 필수 칼럼이다 (Json? 아님)**',
    /^\s*supply Json$/m.test(modelFields) && /^\s*transition Json$/m.test(modelFields)
    && !/Json\?/.test(modelFields),
    modelFields.split('\n').filter((l) => /supply|transition/.test(l)).join(' | '))
  check('🔴 🔴 **migration 도 JSONB NOT NULL 이다**', (() => {
    const sql = readFileSync('prisma/migrations/0028_stage_decision/migration.sql', 'utf-8')
      .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    return /"supply" JSONB NOT NULL/.test(sql) && /"transition" JSONB NOT NULL/.test(sql)
  })())
  check('🔴 migration 파일이 있고 기존 표를 건드리지 않는다', (() => {
    // 🔴 주석에 적힌 되돌리기 설명은 실행되는 SQL 이 아니다 — 코드 줄만 본다
    const sql = readFileSync('prisma/migrations/0028_stage_decision/migration.sql', 'utf-8')
      .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    return /CREATE TABLE "StageDecision"/.test(sql)
      && /PRIMARY KEY \("kstDate"\)/.test(sql)
      && !/ALTER TABLE/.test(sql) && !/DROP /.test(sql) && !/TRUNCATE/.test(sql)
  })())

  /**
   * 🔴 **adapter 를 부르는 곳은 정해진 셋뿐이다** (2026-09-28 운영 루프 배선).
   *    controller(쓰기 — `ensureStageDecision` 경유) · consumer 감싸기(읽기) · 운영 화면(읽기).
   *    🔴 발행·공급 **러너 파일은 여전히 부르지 않는다** — 러너는 consumer 가 넣어 준 env 만 본다.
   *    목록 밖에서 import 가 생기면 빨개진다(두 번째 writer 를 막는다).
   */
  const ADAPTER_CALLERS = [
    'scripts/stage-controller.mts', 'scripts/stage-consume-exec.mts', 'scripts/ops-status.mts',
    // 🔴 (2026-09-30) D100 계기판 — 현재 단계를 env 대신 저장된 결정에서 **읽는다**(읽기 전용)
    'scripts/lib/d100-operational-stock.mts',
  ]
  check('🔴 🔴 **adapter 호출은 controller·consumer·운영 화면 셋뿐 — 발행·공급 러너는 부르지 않는다**', (() => {
    // 🔴 주석에서 이름을 부르는 것은 배선이 아니다 — **실제 import 문**만 본다
    const wired = PRODUCTION_FILES.filter((f) => f !== REPO
      && /^\s*import[^\n]*['"][^'"]*stage-decision-repo[^'"]*['"]/m.test(readFileSync(f, 'utf-8')))
    return wired.every((f) => ADAPTER_CALLERS.includes(f))
      && !wired.some((f) => /original-post-auto-publish|supply-process\.mts/.test(f))
  })(), '')
  check('🔴 🔴 **feature flag 기본값이 꺼짐이다 — 켜야만 켜진다**',
    !controllerEnabled({}) && !controllerEnabled({ [CONTROLLER_ENV]: '' })
    && !controllerEnabled({ [CONTROLLER_ENV]: 'true' })
    && !controllerEnabled({ [CONTROLLER_ENV]: '1' })
    && controllerEnabled({ [CONTROLLER_ENV]: 'on' }))
  /**
   * 🔴 **kill switch 는 단계 authority 가 아니다** (2026-10-01 마스터 보정).
   *    앞판은 실제 HOME 의 canonical env 에 이 키가 **없어야** 한다고 봤다 — 2026-09-28 미활성 스냅샷이다.
   *    지금은 canonical env 에 switch 가 있는 것이 정상이고, 호스트 상태로 코드 검사가 갈리면 안 된다.
   *    대신 switch 가 무엇을 못 하는지를 본다. 실제 HOME · 실제 env 값을 읽지 않는다(값 출력 0).
   */
  check('🔴 🔴 **OFF 인 consumer 는 env 단계로 돌아가지 않고 safest d1 로 간다**', (() => {
    const off = consumerEnvOf({ ok: false, code: 'NO_DECISION', fallback: 'safest', reason: `${CONTROLLER_ENV} off` })
    // 🔴 env 파일에 손으로 적은 단계가 있어도 overrides 가 뒤에서 덮는다 — 그 순서까지 본다
    const merged = { [RELEASE_ENV]: 'd10', [CAPACITY_ENV]: 'd10', ...off }
    const exec = readFileSync('scripts/stage-consume-exec.mts', 'utf-8')
    return off[RELEASE_ENV] === 'd1' && off[CAPACITY_ENV] === 'd1'
      && merged[RELEASE_ENV] === 'd1' && merged[CAPACITY_ENV] === 'd1'
      && /if \(!flagOn\) \{[^}]*consumerEnvOf\(\{ ok: false, code: 'NO_DECISION', fallback: 'safest'/.test(exec)
      && /env: \{ \.\.\.process\.env, \.\.\.overrides \}/.test(exec)
  })())
  check('🔴 🔴 **controller 진입점은 단계 결정을 위해 kill switch 하나만 읽는다 — env 단계·canary·window 는 입력원이 아니다**', (() => {
    const code = readFileSync('scripts/stage-controller.mts', 'utf-8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')
    // 🔴 실제로 메모리에 올리는 키 전부 — readEnvKeys 의 인자를 그대로 모은다
    const args = [...code.matchAll(/readEnvKeys\(([^)]*)\)/g)].map((m) => m[1]!.trim())
    const ARG_KEYS: Record<string, readonly string[]> = {
      '[CONTROLLER_ENV]': [CONTROLLER_ENV],
      // 댓글 상한(글당 댓글 수)을 정하는 값이다 — 공개 단계 입력이 아니다
      '[COMMENT_STAGE_ENV]': [COMMENT_STAGE_ENV],
      // preflight 의 자동 READY 스위치 · 예산 키
      PREFLIGHT_ENV_KEYS,
    }
    if (args.length === 0 || !args.every((a) => a in ARG_KEYS)) return false
    const keys = args.flatMap((a) => ARG_KEYS[a]!)
    const FORBIDDEN = [RELEASE_ENV, CAPACITY_ENV]
    return keys.includes(CONTROLLER_ENV)
      && !keys.some((k) => FORBIDDEN.includes(k) || /CANARY|WINDOW/.test(k))
      && !/process\.env/.test(code)
      && !FORBIDDEN.some((k) => code.includes(k)) && !/\b(RELEASE_ENV|CAPACITY_ENV)\b/.test(code)
  })())
  /**
   * 🔴 **OFF 를 옛 경로로 안내하는 운영 문구가 다시 들어오지 않는다** (2026-10-01 마스터 보정).
   *    controller 로그가 "러너는 롤백 env 경로로 돈다" 고 말했다 — 동작(d1 감속)과 반대다.
   *    운영 코드 · 롤백 runbook · 스케줄 검사 머리말을 본다. "돌아갔다"(역사)·"돌아가지 않는다"는 걸리지 않는다.
   */
  check('🔴 🔴 **OFF 를 옛 env/canary 경로로 안내하는 문구 0 · controller OFF 로그는 d1 감속을 말한다**', (() => {
    const WRONG = /롤백 env 경로|env\/canary 경로로 (그대로 )?돌아간다|legacy\/가장 안전|consumer legacy\(아무것도/
    const files = [...PRODUCTION_FILES, 'scripts/stage-scheduler-check.mts', 'prisma/migrations/0028_stage_decision/APPLY.md']
    const offLog = readFileSync('scripts/stage-controller.mts', 'utf-8')
      .split('\n').find((l) => l.includes('가 on 이 아니다 — 저장하지 않는다')) ?? ''
    return files.every((f) => !WRONG.test(readFileSync(f, 'utf-8')))
      && /가장 안전한 d1 로 감속/.test(offLog) && !/롤백/.test(offLog)
  })())
  /**
   * ── 🔴 **비밀값을 찍지 않는다** (2026-09-25 마스터 지적) ──
   *    앞판은 실패 메시지에 `DATABASE_URL` 앞 40자를 찍었다. 주소에는 사용자명이,
   *    때로는 비밀번호가 들어간다. **잘못 붙였을 때**가 정확히 그 값이 새는 순간이다.
   */
  {
    const db = readFileSync('scripts/stage-decision-db-check.mts', 'utf-8')
    const dbCode = db.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    check('🔴 🔴 **소스 어디에도 URL 을 출력하는 줄이 없다**',
      !/console\.(log|error|warn)\([^)]*\bURL\b/.test(dbCode)
      && !/console\.(log|error|warn)\([^)]*DATABASE_URL/.test(dbCode)
      && !/URL\.(slice|replace|substring)/.test(dbCode))
    check('🔴 🔴 **격리 sentinel · localhost · 고정 DB 이름을 모두 요구한다**',
      /SORAN_ISOLATED_DB/.test(dbCode) && /yes-throwaway/.test(dbCode)
      && /127\\\.0\\\.0\\\.1\|localhost/.test(dbCode) && /soran_test/.test(dbCode)
      && (dbCode.match(/problems\.push\(/g) ?? []).length === 3)
    /**
     * 🔴 **실제로 돌려서 본다.** 소스를 읽는 것만으로는 "찍지 않는다" 를 증명하지 못한다.
     *    가짜 비밀번호가 든 운영처럼 보이는 주소를 주고, stdout·stderr 어디에도
     *    그 값이 나오지 않는지 확인한다.
     */
    const SECRET = 'PW-ZZTOP-9931-DO-NOT-PRINT'
    const r = spawnSync('npx', ['tsx', 'scripts/stage-decision-db-check.mts'], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://soran:${SECRET}@db.prod.example.com:5432/soran_prod`,
        DIRECT_URL: `postgresql://soran:${SECRET}@db.prod.example.com:5432/soran_prod`,
        SORAN_ISOLATED_DB: '',
      },
    })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    check('🔴 🔴 **격리 DB 가 아니면 실행되지 않는다 (exit 2)**', r.status === 2, `exit=${String(r.status)}`)
    check('🔴 🔴 **가짜 비밀번호가 stdout·stderr 어디에도 없다**',
      !out.includes(SECRET), out.slice(0, 160))
    check('🔴 🔴 **주소의 host·DB 이름도 새지 않는다**',
      !out.includes('db.prod.example.com') && !out.includes('soran_prod'),
      out.slice(0, 160))
    check('🔴 그래도 무엇이 틀렸는지는 말한다 — 조용히 죽지 않는다',
      /격리 DB 가 아니다/.test(out) && /sentinel|SORAN_ISOLATED_DB/.test(out))
  }
  check('🔴 DB 검사는 격리 Postgres 에서만 돈다 — 아니면 exit 2 로 멈춘다', (() => {
    const db = readFileSync('scripts/stage-decision-db-check.mts', 'utf-8')
    return /격리 DB 가 아니다/.test(db) && /process\.exit\(2\)/.test(db)
      && /127\\\.0\\\.0\\\.1\|localhost/.test(db)
  })())
}

console.log('\n⑭ 🔴 🔴 publisher 와 probe 실행 동등성 — 같은 fake store · 같은 runAt')
{
  /**
   * 🔴 **문자열 검사를 지웠다.** 두 파일에 같은 글자가 있는지가 아니라,
   *    **같은 입력에 같은 결과를 내는지**를 본다.
   *
   * 🔴 발행 러너는 `loadPublishableStock` 을 **실제로 부른다**(2026-09-24 리팩터링).
   *    그래서 여기서 그 함수를 한 번 돌리면, 러너와 probe 가 소비하는 값이 곧 이 값이다.
   */
  const runner = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  const probe = readFileSync('scripts/stage-decision-probe.mts', 'utf-8')
  /** 🔴 주석 처리·이름만 남기기를 막는다 — **import 와 호출과 소비**가 모두 있어야 한다 */
  const runnerCode = runner.split('\n')
    .filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n')
  check('🔴 🔴 **발행 러너가 공용 조립 함수를 실제로 호출하고 그 결과를 쓴다**',
    /import \{[^}]*loadPublishableStock[^}]*\} from '\.\/lib\/publishable-stock\.mjs'/.test(runnerCode)
    // 🔴 (2026-09-30) 회차 시각은 `runClockFrom(SORAN_RUN_AT)` 하나 — 비어 있으면 벽시계(운영 그대로)
    && /^const RUN_CLOCK = runClockFrom\(process\.env\)\s*$/m.test(runnerCode)
    && /^const RUN_AT = RUN_CLOCK\.at\s*$/m.test(runnerCode)
    && /const stock = await loadPublishableStock\(prisma, RUN_AT, \{ autoReadyOpen: autoOpen\.open \}\)\s*$/m.test(runnerCode)
    // 🔴 러너의 시계는 하나다 — 단계마다 다른 `now` 를 쓰면 경계에서 답이 갈린다(벽시계 직접 호출 0)
    && runnerCode.split('\n').filter((l) => /new Date\(\)/.test(l)).length === 0
    && /const targets = stock\.targets/.test(runnerCode)
    && /const rejected = stock\.rejected/.test(runnerCode)
    // 🔴 (2026-09-30) 오늘 발행 수는 슬롯 판정 직전에 DB 로 다시 센다(준비도 축 `axisPublishedToday` 삭제)
    && /stock\.queueCandidates/.test(runnerCode)
    && /const publishedToday = await prisma\.personaActivityLog\.count\(/.test(runnerCode)
    // 🔴 조립 결과가 판정 함수 둘로 **그대로** 흘러간다 — 러너가 중간에 다시 읽지 않는다
    && /resolvePublishScale\(\{ env: process\.env, loaded: stock, now: axisNow \}\)/.test(runnerCode)
    // 🔴 (2026-09-30) 교체 루프 — 만료된 행만 뺀 같은 조립 결과(view)로 다시 계획한다
    && /const view = excluded\.size === 0 \? stock : \{/.test(runnerCode)
    && /planPublishBatch\(\{ loaded: view, caps: RELEASE_CAPS, at: axisNow, proofAutoNeeded \}\)/.test(runnerCode)
    // 🔴 (2026-09-29) 증명일 필요 수도 같은 조립 결과(stock.autoTargetsToday)와 consumer env 에서만 나온다
    && /const proofAutoNeeded = autoFirstNeeded\(proofDay, stock\.autoTargetsToday \?\? 0\)/.test(runnerCode),
    runnerCode.split('\n').filter((l) => l.includes('stock.')).slice(0, 6).join(' | '))
  check('🔴 🔴 **러너 안에 별도 조립이 남아 있지 않다**',
    !/selectAutoTargets\(rows,/.test(runner)
    && !/const rows: AutoRow\[\] = raw\.map/.test(runner)
    && !/personaActivityLog\.findMany/.test(runner),
    [/selectAutoTargets\(rows,/, /const rows: AutoRow\[\] = raw\.map/, /personaActivityLog\.findMany/]
      .filter((re) => re.test(runner)).map(String).join(' | ') || '(남은 것 없음)')
  check('🔴 probe 도 같은 함수만 쓴다',
    /loadPublishableStock\(/.test(probe) && !/selectAutoTargets\(/.test(probe))
  /**
   * 🔴 **상한은 resolved scale 에서만 나온다** (2026-09-24 5차).
   *    `installFromEnv(process.env)` 를 직접 부르는 소비자가 있으면 bare env 로
   *    돌아간다 — 허가가 켜진 날 러너와 다른 상한을 쓰게 된다.
   */
  check('🔴 🔴 **러너와 probe 가 같은 resolvePublishScale 로 상한을 만든다**',
    /const resolved = resolvePublishScale\(\{ env: process\.env, loaded: stock, now: axisNow \}\)/.test(runner)
    && /const RELEASE_CAPS = resolved\.caps/.test(runner)
    && /resolvePublishScale\(\{ env: process\.env, loaded: s, now: NOW \}\)/.test(probe)
    && /const RELEASE_CAPS = resolved\.caps/.test(probe))
  /** 🔴 주석에 적힌 과거 사례는 세지 않는다 — **코드 줄**만 본다 */
  const codeLinesOf = (src: string): string => src.split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  check('🔴 🔴 **어느 쪽도 bare env 로 되돌아가지 않는다**',
    !/installFromEnv\(process\.env\)/.test(codeLinesOf(runner))
    && !/installFromEnv\(process\.env\)/.test(codeLinesOf(probe)),
    [runner, probe].filter((f) => /installFromEnv\(process\.env\)/.test(codeLinesOf(f))).length + '곳')
  /**
   * 🔴 **배정 계획도 러너가 공용 함수를 부른다.** 이 호출을 떼면 아래 fixture 검사가
   *    아니라 **이 줄**이 먼저 빨개진다 — 사본 비교가 아니라 실제 소비 경로다.
   */
  check('🔴 🔴 **러너가 planPublishBatch 를 부르고 그 결과만 쓴다**',
    /const plan = planPublishBatch\(\{ loaded: view, caps: RELEASE_CAPS, at: axisNow, proofAutoNeeded \}\)/.test(runner)
    && /assignOf = plan\.assignOf/.test(runner)
    && /plan\.brokenRecovery\.length > 0/.test(runner)
    && /\{ picked, recovered, skipped, waiting \} = plan/.test(runner)
    // 🔴 러너 안에 같은 계산이 다시 있으면 안 된다
    && !/prepareCandidates\(\{/.test(runner) && !/pickPublishTarget\(\{/.test(runner))

  /**
   * 🔴 **같은 함수를 두 번 부르는 것은 동등성 검사가 아니다** (2026-09-24 마스터 지적).
   *    핵심 분기를 실제로 갈리게 하는 fixture 를 만들고, **publisher 가 쓰는 계약**
   *    (`freshOrdered` · `brokenRecovery` 전체 중단 · `pickPublishTarget`)이
   *    `stageStock` 결과와 같은 답을 내는지 본다.
   */
  const RUN_AT = new Date('2026-09-24T09:00:00+09:00')
  const fresh = new Date(RUN_AT.getTime() - 2 * 864e5)
  const stale = new Date(RUN_AT.getTime() - 40 * 864e5)
  const qrow = (o: {
    id: string; persona?: string | null; captured: Date | null; gate?: string
    // 🔴 `null` 을 **명시적으로** 넘길 수 있어야 한다 — `?? 'founder'` 로 뭉개면
    //    "값이 없는 행" 을 사람 검토로 세는 결함을 fixture 가 표현하지 못한다
    decidedBy?: string | null; site?: string
  }) => ({
    id: o.id, status: 'APPROVED', createdPostId: null, gateVerdict: o.gate ?? 'PASS',
    promptVersion: 'publish-candidate-v1', model: 'human-curated',
    matchedPersonaId: o.persona ?? null,
    draftTitle: '오늘 있었던 작은 이야기',
    draftBody: '아침에 창을 열어 두었더니 바람이 선선했어요.\n다들 어떻게 지내시는지 궁금합니다.',
    editedTitle: null, editedBody: null,
    // 🔴 (2026-09-30) 원문 게시 시각은 증거 기록에 있다 — `captured` 가 게시 시각이다 · null 이면 증거 없음
    gateResults: o.captured === null ? {} : fakeEvidenceGate(RUN_AT, { postedAt: o.captured, id: o.id }), decidedBy: o.decidedBy === undefined ? 'founder' : o.decidedBy,
    decidedAt: RUN_AT, createdAt: fresh,
    rawContent: { sourceSite: o.site ?? 'publish-candidate:test', sourceCapturedAt: o.captured },
  })
  const prow = (code: string, id: string, o: Record<string, unknown> = {}) => ({
    id, code, status: 'active',
    identity: {
      ageBand: '50대 초반', maritalStatus: '기혼', childrenCount: 1,
      childrenAgeBands: ['성인'], parentCare: '없음', menopauseStatus: '진행중',
      region: '수도권', lifeStage: '양육기', ...o,
    },
    voiceCore: { length: '중간' }, noGoTopics: [],
    user: { providerId: null, _count: { accounts: 0 } },
  })
  const fakeOf = (qrows: unknown[], prows: unknown[]) => ({
    originalPostApprovalQueue: {
      findMany: async () => qrows, count: async () => 0, findFirst: async () => null,
    },
    persona: { findMany: async () => prows },
    personaActivityLog: { findMany: async () => [], count: async () => 0 },
  } as never)
  const CAPS = { postsPerWeek: 3, minDaysBetween: 1 }

  /**
   * 🔴 **검사는 러너 계산을 베끼지 않는다** (2026-09-24 5차 · 마스터 지적).
   *    앞판은 `prepareCandidates → freshOrdered → brokenRecovery → pickPublishTarget`
   *    을 검사 안에 **복사**해 두고 결과를 비교했다. 사본은 러너가 바뀌어도 함께
   *    바뀌지 않는다 — 갈라진 순간부터 조용히 거짓 초록이 된다.
   *    🔴 지금은 **러너가 부르는 그 함수**(`planPublishBatch`)를 직접 부른다.
   */
  const core = (loaded: Awaited<ReturnType<typeof loadPublishableStock>>, caps = CAPS) =>
    planPublishBatch({ loaded, caps, at: RUN_AT })

  /** ── ⓐ fresh 하지만 배정 불가 · TTL hold · 임의 decidedBy 가 섞인 경우 ── */
  {
    const qrows = [
      qrow({ id: 'a-ok', persona: 'p1', captured: fresh }),
      // 🔴 (2026-09-30) 복구 행도 원천 72h 를 넘으면 빠진다 — 사람 복구 레인(RECOVERY_STALE 구제)은 없다
      qrow({ id: 'b-ttl', persona: null, captured: stale }),
      qrow({ id: 'c-unknown-age', persona: null, captured: null }),
      qrow({ id: 'h-recovery-stale', persona: 'p1', captured: stale }),
      qrow({ id: 'd-gate', persona: 'p1', captured: fresh, gate: 'HOLD' }),
      qrow({ id: 'e-legacy', persona: 'p1', captured: fresh, site: 'legacy:x' }),
      qrow({ id: 'f-odd', persona: 'p1', captured: fresh, decidedBy: 'someone-else' }),
      qrow({ id: 'g-machine', persona: 'p1', captured: fresh, decidedBy: 'machine:auto-draft-v5' }),
    ]
    const loaded = await loadPublishableStock(fakeOf(qrows, [prow('P01', 'p1')]), RUN_AT)
    const st = stageStock({ loaded, caps: CAPS, at: RUN_AT })
    const c = core(loaded)

    check('🔴 🔴 **nextPickedId 가 publisher 계산과 같다**',
      st.nextPickedId === c.nextPickedId, `stage=${st.nextPickedId} core=${c.nextPickedId}`)
    check('🔴 🔴 **releaseEligible 이 publisher 의 freshOrdered 와 같다**',
      st.releaseEligible.ids.join(',') === c.freshOrdered.map((t) => t.id).join(','),
      `${st.releaseEligible.ids.join(',')} vs ${c.freshOrdered.map((t) => t.id).join(',')}`)
    const reasons = st.holdsByReason.map((h) => `${h.reason}:${h.ids.slice().sort().join('/')}`).sort().join(',')
    check('🔴 🔴 **판정 제외가 닫힌 enum(ReleaseReason)으로 나온다 — 복구 행도 72h 를 넘으면 빠진다**',
      reasons === 'EVIDENCE_MISSING:c-unknown-age,SOURCE_TOO_OLD_AT_SLOT:b-ttl/h-recovery-stale'
      && st.holdsByReason.every((h) => h.count === h.ids.length && h.count > 0), reasons)
    check('🔴 🔴 **제외된 행은 releaseEligible 에 들어가지 않는다**',
      st.holdsByReason.flatMap((h) => h.ids).every((id) => !st.releaseEligible.ids.includes(id)),
      `hold=${st.holdsByReason.flatMap((h) => h.ids).join(',')} eligible=${st.releaseEligible.ids.join(',')}`)
    check('🔴 🔴 **여섯 수가 서로 다르다 — 단계가 실제로 갈린다**',
      st.selectorTargets.count < st.queueTotal
      && st.releaseEligible.count < st.selectorTargets.count,
      `queue=${st.queueTotal} selector=${st.selectorTargets.count}`
      + ` eligible=${st.releaseEligible.count} assigned=${st.successfullyAssigned.count}`
      + ` runnable=${st.assignmentReady.count} picked=${st.nextPickedId}`)
    check('🔴 🔴 **임의 decidedBy 는 사람 검토로 세지 않는다**',
      loaded.humanReviewed === qrows.filter((r) => r.decidedBy === 'founder').length
      && loaded.humanReviewed
        < qrows.filter((r) => !String(r.decidedBy).startsWith('machine:')).length,
      `humanReviewed=${loaded.humanReviewed}`)
    check('🔴 Persona 생활사 값이 조립에 실린다',
      (loaded.personas[0] as Record<string, unknown>)?.voiceLength === '중간'
      && (loaded.personas[0] as Record<string, unknown>)?.menopauseStatus === '진행중')
  }

  /** ── ⓑ fresh 한데 Persona 가 없어 배정이 불가능한 경우 ── */
  {
    const qrows = [qrow({ id: 'x-fresh', persona: null, captured: fresh })]
    const loaded = await loadPublishableStock(fakeOf(qrows, []), RUN_AT)
    const st = stageStock({ loaded, caps: CAPS, at: RUN_AT })
    const c = core(loaded)
    check('🔴 🔴 **eligible 하지만 배정 불가면 successfullyAssigned 에 들어가지 않는다**',
      st.releaseEligible.count === 1 && st.successfullyAssigned.count === 0,
      `eligible=${st.releaseEligible.count} assigned=${st.successfullyAssigned.count}`)
    check('🔴 🔴 **그때 runnableNow 도 0 이고 nextPickedId 는 null 이다**',
      st.assignmentReady.count === 0 && st.nextPickedId === null && c.nextPickedId === null,
      `runnable=${st.assignmentReady.count} picked=${st.nextPickedId} core=${c.nextPickedId}`)
    check('🔴 🔴 **assigned=null 인 assignment 를 배정 성공으로 세지 않는다**',
      !st.successfullyAssigned.ids.includes('x-fresh'), st.successfullyAssigned.ids.join(','))
  }

  /** ── ⓖ 🔴 **resolver 는 전역을 건드리지 않는다** ── */
  {
    /**
     * 🔴 앞판 `resolvePublishScale` 은 "순수 함수다" 라고 적어 두고 `installFromEnv`
     *    를 불렀다 — 그 함수는 `applyScale` 로 **module-global `installed`** 를 바꾼다.
     *    그래서 probe 나 이 검사를 돌리기만 해도 프로세스의 `activeScale()` 이 바뀌었다.
     */
    const qrows = [qrow({ id: 'g-1', persona: null, captured: fresh })]
    const loaded = await loadPublishableStock(fakeOf(qrows, [prow('P01', 'p1')]), RUN_AT)
    const before = activeScale()
    const r = resolvePublishScale({
      env: markedStageEnv({ SORAN_CAPACITY_STAGE: 'd10', SORAN_RELEASE_STAGE: 'd10' }), loaded, now: RUN_AT,
    })
    const after = activeScale()
    check('🔴 🔴 **resolver 호출이 activeScale 을 바꾸지 않는다**',
      after === before && after.releaseStage === before.releaseStage,
      `before=${before.releaseStage} after=${after.releaseStage} resolved=${r.scale.releaseStage}`)
    check('🔴 🔴 **계산 결과는 전역과 다를 수 있다 — 그래서 설치가 따로다**',
      r.scale.capacityStage === 'd10' && before.releaseStage !== 'd10',
      `resolved=${r.scale.capacityStage} global=${before.releaseStage}`)
    check('🔴 🔴 **공용 조립 파일은 installFromEnv 를 쓰지 않는다**', (() => {
      const stockSrc = readFileSync('scripts/lib/publishable-stock.mts', 'utf-8')
        .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
      return !/installFromEnv\(/.test(stockSrc) && /resolveScale\(/.test(stockSrc)
    })())
    /** 🔴 설치는 **실제로 발행하는 러너**만, 정확히 한 번 */
    const runnerSrc = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
      .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    check('🔴 🔴 **publisher 만 applyScale 로 정확히 한 번 설치한다**',
      (runnerSrc.match(/applyScale\(/g) ?? []).length === 1
      && /applyScale\(resolved\.scale\)/.test(runnerSrc),
      `${(runnerSrc.match(/applyScale\(/g) ?? []).length}회`)
    check('🔴 🔴 **probe 는 설치하지 않는다 — 관제가 전역을 바꾸면 안 된다**',
      !/applyScale\(/.test(readFileSync('scripts/stage-decision-probe.mts', 'utf-8')))
  }

  /** ── ⓔ 🔴 **옛 canary · window env 는 상한을 바꾸지 않는다** (2026-09-30) ── */
  {
    const qrows = Array.from({ length: 40 }, (_, i) =>
      qrow({ id: `q${String(i).padStart(2, '0')}`, persona: null, captured: fresh }))
    const prows = Array.from({ length: 30 }, (_, i) => prow(`P${String(i).padStart(2, '0')}`, `p${i}`))
    const loaded = await loadPublishableStock(fakeOf(qrows, prows), RUN_AT)
    const BASE = markedStageEnv({ SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' })
    const at = (env: Record<string, string>) => {
      const r = resolvePublishScale({ env, loaded, now: RUN_AT })
      return { r, plan: core(loaded, r.caps) }
    }
    const bare = at(BASE)
    const legacy = at({ ...BASE, SORAN_RELEASE_CANARY_STAGE: 'd3', SORAN_RELEASE_CANARY_DATE: '2026-09-24',
      SORAN_RELEASE_WINDOW_STAGE: 'd10', SORAN_RELEASE_WINDOW_FROM: '2026-09-20', SORAN_RELEASE_WINDOW_UNTIL: '2026-09-26' })
    check('🔴 🔴 **결정 env(d1) 그대로 — 주 1 · 최소 5일**',
      bare.r.scale.releaseStage === 'd1' && bare.r.caps.postsPerWeek === 1 && bare.r.caps.minDaysBetween === 5,
      `${bare.r.scale.releaseStage} 주${bare.r.caps.postsPerWeek} 최소${bare.r.caps.minDaysBetween}`)
    check('🔴 🔴 **canary · window 키를 실어도 같은 상한 · 같은 배정이다 (죽은 입력)**',
      legacy.r.scale.releaseStage === 'd1' && legacy.r.dailyCap === bare.r.dailyCap
      && legacy.r.caps.postsPerWeek === bare.r.caps.postsPerWeek
      && legacy.plan.assignmentReady.join(',') === bare.plan.assignmentReady.join(','),
      `${legacy.r.scale.releaseStage} 일${legacy.r.dailyCap}`)
    const d3 = at(markedStageEnv({ SORAN_CAPACITY_STAGE: 'd3', SORAN_RELEASE_STAGE: 'd3' }))
    check('🟢 결정이 d3 이면(TRIAL · consumer env) d3 상한 — 배정이 늘어난다',
      d3.r.scale.releaseStage === 'd3' && d3.r.dailyCap === 3 && d3.plan.assignmentReady.length > bare.plan.assignmentReady.length,
      `bare ${bare.plan.assignmentReady.length} vs d3 ${d3.plan.assignmentReady.length}`)
    check('🔴 🔴 **같은 resolved scale 을 주면 probe 와 publisher 가 같은 picked 를 낸다**',
      stageStock({ loaded, caps: d3.r.caps, at: RUN_AT }).nextPickedId === d3.plan.nextPickedId)
  }

  /** ── ⓕ 🔴 **기계 지표 두 축을 섞지 않는다** ── */
  {
    const qrows = [
      // 🔴 기계가 만든 행 — decidedBy 가 machine:
      qrow({ id: 'm-made', persona: null, captured: fresh, decidedBy: 'machine:auto-draft-v5' }),
      // 🔴 사람이 넣었지만 machine profile 계약에는 맞는 행
      qrow({ id: 'h-made', persona: null, captured: fresh, decidedBy: 'founder' }),
      // 🔴 어느 축에도 들어가지 않는 행 — 기계도 아니고 사람 검토도 아니다
      qrow({ id: 'x-odd', persona: null, captured: fresh, decidedBy: 'someone-else' }),
      qrow({ id: 'y-null', persona: null, captured: fresh, decidedBy: null }),
    ]
    const loaded = await loadPublishableStock(fakeOf(qrows, [prow('P01', 'p1')]), RUN_AT)
    check('🔴 🔴 **`decidedBy=machine:` 인 행만 "기계가 만든 행" 으로 센다**',
      loaded.machineDecided === 1, `machineDecided=${loaded.machineDecided}`)
    check('🔴 🔴 **profile 유효 수는 그것과 다른 축이다 — 같은 이름으로 부르지 않는다**',
      loaded.machineProfiled !== loaded.machineDecided
      || loaded.machineProfiled === 0,
      `machineProfiled=${loaded.machineProfiled} machineDecided=${loaded.machineDecided}`)
    check('🔴 🔴 **사람 검토는 `founder` 1건뿐 — 임의 문자열도 null 도 세지 않는다**',
      loaded.humanReviewed === 1 && loaded.queueTotal === 4,
      `humanReviewed=${loaded.humanReviewed} queueTotal=${loaded.queueTotal}`)
    check('🔴 🔴 **세 축을 합쳐도 전체가 되지 않는다 — 서로 다른 질문이다**',
      loaded.machineDecided + loaded.humanReviewed < loaded.queueTotal,
      `machine=${loaded.machineDecided} human=${loaded.humanReviewed} total=${loaded.queueTotal}`)
  }

  /** ── ⓓ 질의 순서와 발행 순서가 실제로 갈리는 경우 ── */
  {
    // 🔴 DB 질의 순서는 비복구 먼저지만, 발행은 **복구 행이 먼저**다(prepareCandidates 의 복구 우선).
    //    정렬을 지우면 이 fixture 에서 답이 바뀐다 — 그래서 여기서만 변이가 잡힌다.
    const qrows = [
      qrow({ id: 'n-plain', persona: null, captured: fresh }),
      qrow({ id: 'r-recovery', persona: 'p2', captured: fresh }),
    ]
    const loaded = await loadPublishableStock(
      fakeOf(qrows, [prow('P01', 'p1'), prow('P02', 'p2')]), RUN_AT)
    const st = stageStock({ loaded, caps: CAPS, at: RUN_AT })
    const c = core(loaded)
    check('🔴 🔴 **질의 순서와 발행 순서가 다르다 — 복구 행이 앞선다**',
      st.selectorTargets.ids.join(',') === 'n-plain,r-recovery'
      && st.releaseEligible.ids.join(',') === 'r-recovery,n-plain',
      `selector=${st.selectorTargets.ids.join(',')} eligible=${st.releaseEligible.ids.join(',')}`)
    check('🔴 🔴 **그 순서로 publisher 와 같은 한 건을 고른다**',
      st.nextPickedId === 'r-recovery' && c.nextPickedId === 'r-recovery'
      && st.assignmentReady.ids.join(',') === 'r-recovery,n-plain',
      `stage=${st.nextPickedId} core=${c.nextPickedId} runnable=${st.assignmentReady.ids.join(',')}`)
  }

  /** ── ⓒ broken recovery 하나 때문에 전체가 중단되는 경우 ── */
  {
    // 🔴 배정된 persona 가 목록에 없다 → recoveryProblem 이 생긴다
    const qrows = [
      qrow({ id: 'r-broken', persona: 'ghost', captured: fresh }),
      qrow({ id: 'r-ok', persona: 'p1', captured: fresh }),
    ]
    const loaded = await loadPublishableStock(fakeOf(qrows, [prow('P01', 'p1')]), RUN_AT)
    const st = stageStock({ loaded, caps: CAPS, at: RUN_AT })
    const c = core(loaded)
    check('🔴 🔴 **배정이 깨진 행을 값으로 낸다**',
      st.brokenRecovery.length === c.brokenRecovery.length && st.brokenRecovery.length > 0,
      `${JSON.stringify(st.brokenRecovery)} vs ${JSON.stringify(c.brokenRecovery)}`)
    check('🔴 🔴 **하나만 깨져도 runnableNow 는 0 이다 — publisher 는 전체 중단한다**',
      st.assignmentReady.count === 0 && st.nextPickedId === null,
      `runnable=${st.assignmentReady.count} picked=${st.nextPickedId}`)
    check('🔴 그때도 publisher core 와 같은 답이다',
      st.nextPickedId === c.nextPickedId)
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 production migration apply 0 · 운영 DB write 0.'
  + ' 실제 운영 조립은 `stage:probe` 가, 저장 왕복은 `stage:db-check`(격리 DB)가 따로 본다.\n')
if (fail > 0) process.exit(1)
