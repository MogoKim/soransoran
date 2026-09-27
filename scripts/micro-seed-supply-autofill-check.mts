#!/usr/bin/env tsx
/**
 * 공급 자동 보충 fixture — 🔴 **사람이 뺀 것을 기계가 도로 넣지 않는다** (§4-AN)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
import {
  planRefill, judgeApply, readStock, verifyAfterRefill, isHeld, hasPendingSibling,
  provenanceKeyOf, baseArticleId,
  STOCK_TARGET, STOCK_MIN, STOCK_WARN,
  AUTOFILL_ALLOWED_TYPES, REQUIRED_DECISION, SKIP_LABEL,
  type Candidate, type HeldEntry, type QueueRow,
  MACHINE_PROFILE, MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_DECIDED_BY,
  MACHINE_SITE_PREFIX, HUMAN_ONLY_VALUES, USABLE_PROMPT_VERSIONS,
  machineProfileMismatch, impersonatesHuman, buildQueuePayload, queueProfileOf, semanticSummaryOf,
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  type Envelope, type QueueProfileRow,
  queueSourceTimesOf,
} from '../src/lib/micro-seed-supply-autofill'
import { qualityContractDigest, QUALITY_CONTRACT_VERSION } from '../src/lib/quality-contract'
import { STAGE_MODEL } from '../src/lib/content-core/pipeline'
import { planBoundedCommonPhase, planCommonPhase, type Pending } from '../src/lib/supply-process'

const NOW = '2026-09-07T12:00:00.000Z'
/**
 * 🔴 후보 행이 싣는 것은 **잰 값**이다. 통과·탈락은 `draft-originality.ts` 가 정한다.
 *    `CLEAN` 은 옛 6자 기준이라면 막혔을 값이다 — 그게 이 판의 요점이다.
 */
const CLEAN = { runWords: 3, runChars: 8, coverRatio: 0 }
const COPIED = { runWords: 9, runChars: 31, coverRatio: 0.8 }

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

/** 통과하는 표본 — 여기서 한 가지씩 어긋뜨려 본다 */
const ok = (o: Partial<Candidate> = {}): Candidate => ({
  candidateType: 'seedOriginality', sourceArticleId: '34998804',
  sourceSite: 'navercafe:remonterrace', sourceInput: 'navercafe:remonterrace',
  sourceDecision: 'ADOPT', title: '아이랑 같이 갈 숙소, 뭐 보고 고르세요?',
  body: '숙소 고를 때 뭘 먼저 보시는지 궁금해요.',
  safetyVerdict: 'pass', originality: CLEAN, leakedTokens: '', reviewedAt: '2026-09-06T11:00:00Z',
  // 🔴 기계 후보는 말투 근거가 필수다 (2026-09-13)
  voiceProvenance: { personaCode: 'P01', comments: 5, bundleDigest: 'bd1', sourceDigest: 'sd1' },
  ...o,
})
const base = { held: [] as HeldEntry[], existing: new Set<string>(), queue: [] as QueueRow[], usable: 5 }

// 🔴 2026-09-07 에 사람이 실제로 뺀 2건 — 이 fixture 의 존재 이유다
const HELD_REAL: HeldEntry[] = [
  { sourceArticleId: '34999239', title: '주방에서 제일 오래 쓴 물건이 뭐예요?', reason: '형제(후라이팬)가 큐에 있음' },
  { sourceArticleId: '35003196', title: '아침에 뭐 드세요?', reason: '형제(간식)가 이미 발행됨' },
]

console.log('\n공급 자동 보충 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 사람이 보류한 2건이 다시 들어오지 않는다')
{
  const held1 = ok({ sourceArticleId: '34999239', title: '주방에서 제일 오래 쓴 물건이 뭐예요?' })
  const held2 = ok({ sourceArticleId: '35003196', title: '아침에 뭐 드세요?' })
  check('🔴 "주방에서 제일 오래 쓴 물건" 이 보류로 잡힌다', isHeld(held1, HELD_REAL))
  check('🔴 "아침에 뭐 드세요?" 가 보류로 잡힌다', isHeld(held2, HELD_REAL))

  const r = planRefill({ ...base, held: HELD_REAL, candidates: [held1, ok(), held2] })
  check('🔴 보류 2건이 보충 대상에서 빠진다', r.targets.length === 1)
  check('🔴 남는 것은 보류가 아닌 1건뿐', r.targets[0]!.sourceArticleId === '34998804')
  check('빠진 이유가 HELD 로 남는다',
    r.skipped.filter((s) => s.code === 'HELD').length === 2)

  // 🔴 이것이 이 검사의 핵심이다 — 제목이 키에 들어가므로 "새 후보" 로 보인다
  check('🔴 보류 2건은 existing 으로는 못 막는다 — 올린 적이 없기 때문이다', (() => {
    const existing = new Set([provenanceKeyOf('34999239', '후라이팬 언제 바꾸세요?')])
    return !existing.has(provenanceKeyOf('34999239', '주방에서 제일 오래 쓴 물건이 뭐예요?'))
  })())
  check('🔴 보류 목록이 비면 그 2건이 도로 들어온다 — 목록이 유일한 방어다', (() => {
    const r2 = planRefill({ ...base, held: [], candidates: [held1, held2] })
    return r2.targets.length === 2
  })())

  check('제목의 공백 차이는 같은 것으로 본다', isHeld(
    ok({ sourceArticleId: '35003196', title: '아침에  뭐   드세요?' }), HELD_REAL))
  check('출처가 다르면 다른 글이다',
    !isHeld(ok({ sourceArticleId: '99999', title: '아침에 뭐 드세요?' }), HELD_REAL))
}

console.log('\n② 이미 큐에 올라간 것은 제외한다')
{
  const c = ok()
  const existing = new Set([provenanceKeyOf('34998804', '아이랑 같이 갈 숙소, 뭐 보고 고르세요?')])
  const r = planRefill({ ...base, existing, candidates: [c] })
  check('🔴 이미 올린 후보는 제외', r.targets.length === 0 && r.skipped[0]?.code === 'ALREADY')
  check('synthetic id 를 원래 id 로 되돌린다', baseArticleId('34998804-9588cfda') === '34998804')
  check('접미가 없으면 그대로', baseArticleId('34998804') === '34998804')
}

console.log('\n③ 같은 원문의 형제가 안 나갔으면 제외한다')
{
  const q = (id: string, pub: string | null): QueueRow =>
    ({ sourceArticleId: id, status: pub === null ? 'APPROVED' : 'PUBLISHED', createdPostId: pub })
  check('🔴 형제가 미발행으로 큐에 있으면 제외', (() => {
    const r = planRefill({ ...base, queue: [q('34998804-aaaaaaaa', null)], candidates: [ok()] })
    return r.targets.length === 0 && r.skipped[0]?.code === 'SIBLING'
  })())
  check('🟢 형제가 이미 발행됐으면 넣는다 — 시간이 벌어졌다', (() => {
    const r = planRefill({ ...base, queue: [q('34998804-aaaaaaaa', 'post1')], candidates: [ok()] })
    return r.targets.length === 1
  })())
  check('다른 원문은 형제가 아니다',
    !hasPendingSibling('34998804', [q('35003196-bbbbbbbb', null)]))
  check('🔴 같은 회차 안에서도 형제가 겹치면 하나만', (() => {
    const r = planRefill({ ...base, candidates: [
      ok({ title: '첫 번째 초안' }), ok({ title: '두 번째 초안' }),
    ] })
    return r.targets.length === 1 && r.skipped[0]?.code === 'SIBLING'
  })())
}

console.log('\n④ 값이 어긋난 후보를 거른다')
{
  const cases: [string, Partial<Candidate>, string][] = [
    ['SRN 은 경로가 다르다', { candidateType: 'shortRawNoindex' }, 'TYPE'],
    ['모르는 유형', { candidateType: 'growthIssue' }, 'TYPE'],
    // 🔴 이제 profile 로 통째로 본다 — 사람도 기계도 아닌 조합은 PROFILE 이다
    ['Seed 인데 ADOPT 가 아니다', { candidateType: 'seedOriginality', sourceDecision: 'HOLD' }, 'PROFILE'],
    ['Raw 인데 SAVE 가 아니다', { candidateType: 'rawOriginality', sourceDecision: 'ADOPT' }, 'PROFILE'],
    ['safety hold', { safetyVerdict: 'hold' }, 'SAFETY'],
    ['safety 없음', { safetyVerdict: '' }, 'SAFETY'],
    ['원문을 옮김', { originality: COPIED }, 'COPIED'],
    ['독창성을 재지 않음', { originality: undefined }, 'UNMEASURED'],
    ['유출 토큰', { leakedTokens: '연락처' }, 'LEAK'],
    ['제목 빔', { title: '  ' }, 'EMPTY'],
    ['본문 빔', { body: '' }, 'EMPTY'],
  ]
  for (const [label, patch, code] of cases) {
    const r = planRefill({ ...base, candidates: [ok(patch)] })
    check(`🔴 ${label} → 제외 (${code})`, r.targets.length === 0 && r.skipped[0]?.code === code)
  }
  check('🟢 Raw 는 SAVE 면 통과', planRefill({ ...base, candidates: [
    ok({ candidateType: 'rawOriginality', sourceDecision: 'SAVE' }),
  ] }).targets.length === 1)
  /**
   * 🔴 **생성 쪽과 같은 함수로 판정한다.** 옛 판은 이 파일이 `>= 6`,
   *    생성 쪽이 `< 6` 을 따로 가져서 정확히 6자짜리의 운명이 단계마다 달랐다.
   *    이제 기준선 증명은 `draft-originality-check.mts` 한 곳이 한다.
   */
  check('🔴 실질 복제는 여기서도 거절된다',
    planRefill({ ...base, candidates: [ok({ originality: COPIED })] }).targets.length === 0)
  check('🟢 흔한 표현만 겹치는 것은 여기서도 통과한다',
    planRefill({ ...base, candidates: [ok({ originality: CLEAN })] }).targets.length === 1)
  check('🔴 옛 6자 기준이라면 막혔을 값이 지금은 통과한다',
    CLEAN.runChars >= 6
    && planRefill({ ...base, candidates: [ok({ originality: CLEAN })] }).targets.length === 1)
  check('허용 유형은 둘뿐', AUTOFILL_ALLOWED_TYPES.length === 2)
  check('유형마다 요구 결정이 다르다',
    REQUIRED_DECISION.seedOriginality === 'ADOPT' && REQUIRED_DECISION.rawOriginality === 'SAVE')
  check('제외 사유에 라벨이 하나씩 있다', Object.keys(SKIP_LABEL).length === 13)
}

console.log('\n⑤ 재고 계산 — 🔴 발행 러너가 인정하는 행만 센다')
{
  const hRow = (o: Partial<QueueProfileRow & { status: string; createdPostId: string | null }> = {}) => ({
    status: 'APPROVED', createdPostId: null,
    promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
    sourceSite: `${AUTOFILL_SITE_PREFIX}navercafe:x`, gateResults: {}, ...o,
  })
  const mRow = (o: Partial<QueueProfileRow & { status: string; createdPostId: string | null }> = {}) => ({
    status: 'APPROVED', createdPostId: null,
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}82cook`,
    gateResults: { autoDraft: {
      provenance: MACHINE_PROFILE.envelopeProvenance,
      sourceDecision: MACHINE_PROFILE.sourceDecision,
      draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    } }, ...o,
  })
  check('🟢 사람 행을 센다', readStock([hRow()]).human === 1)
  check('🟢 기계 행도 센다', readStock([mRow()]).machine === 1)
  check('합계가 맞다', readStock([hRow(), mRow()]).usable === 2)
  check('🔴 legacy 는 재고가 아니다',
    readStock([hRow({ promptVersion: '13~14판' })]).usable === 0)
  check('🔴 발행된 것은 재고가 아니다', readStock([hRow({ createdPostId: 'p' })]).usable === 0)
  check('🔴 PENDING 은 재고가 아니다', readStock([hRow({ status: 'PENDING' })]).usable === 0)
  check('EDITED 는 재고다', readStock([hRow({ status: 'EDITED' })]).usable === 1)

  // 🔴 **잘못된 machine tuple 은 재고 0** — 판만 맞고 나머지가 어긋나면 아무도 못 먹는다
  check('🔴 기계 판인데 사람 접두 → 재고 0',
    readStock([mRow({ sourceSite: `${AUTOFILL_SITE_PREFIX}82cook` })]).usable === 0)
  check('🔴 기계 판인데 모델이 사람 것 → 재고 0',
    readStock([mRow({ model: AUTOFILL_MODEL })]).usable === 0)
  check('🔴 기계 판인데 gateResults 표시 없음 → 재고 0',
    readStock([mRow({ gateResults: {} })]).usable === 0)
  check('🔴 기계 판인데 gate 가 옛 판 → 재고 0', readStock([mRow({
    gateResults: { autoDraft: { provenance: 'machine-generated', sourceDecision: 'AUTO_ADOPT', draftRuleVersion: 'auto-draft-v2' } },
  })]).usable === 0)
  check('🔴 사람 판인데 기계 접두 → 재고 0',
    readStock([hRow({ sourceSite: `${MACHINE_SITE_PREFIX}x` })]).usable === 0)

  check(`경고선 ${STOCK_WARN} 이하`, readStock(Array.from({ length: 3 }, () => hRow())).level === 'critical')
  check(`${STOCK_MIN} 이상은 ok`, readStock(Array.from({ length: 5 }, () => hRow())).level === 'ok')
  check('부족분을 목표 기준으로 센다',
    readStock(Array.from({ length: 5 }, () => hRow())).shortfall === STOCK_TARGET - 5)
}

console.log('\n⑤-b 🔴 통합 — 만들어질 행이 발행 러너에게 machine 으로 보이는가')
{
  const mEnv: Envelope = {
    provenance: MACHINE_PROFILE.envelopeProvenance,
    ruleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    promptVersion: MACHINE_PROFILE.envelopePromptVersion,
    pipelineVersion: MACHINE_PROFILE.envelopePipelineVersion,
    stageModels: STAGE_MODEL,
    // 🔴 생성기가 적는 값 — 적재기는 자기 코드 상수와 같은지만 본다 (2026-09-27)
    qualityContractDigest: qualityContractDigest(),
  }
  const mc = ok({
    sourceDecision: 'AUTO_ADOPT', sourceInput: 'auto-judge',
    candidateType: 'seedOriginality', originality: CLEAN, leakedTokens: '',
  // 🔴 기계 후보는 말투 근거가 필수다 (2026-09-13)
  voiceProvenance: { personaCode: 'P01', comments: 5, bundleDigest: 'bd1', sourceDigest: 'sd1' },

  })
  const aj = { ruleVersion: 'auto-judge-v3', promptVersion: 'semantic-shadow-v2b',
    model: 'claude-haiku-4.5', inputHash: 'abc123', provenance: 'machine-shadow' }
  const p1 = buildQueuePayload({ envelope: mEnv, candidate: mc, autoJudge: aj, now: NOW })
  check('🟢 기계 payload 가 만들어진다', p1 !== null && p1.profile === 'machine')
  // 🔴 이것이 P0 회귀 fixture다 — 만든 행을 그대로 발행 러너 눈으로 본다
  check('🔴 만들어진 machine 행이 profileOf=machine 이다', p1 !== null && queueProfileOf({
    promptVersion: p1.promptVersion, model: p1.model,
    sourceSite: p1.syntheticSite, gateResults: p1.gateResults,
  }) === 'machine')
  check('🔴 기계 접두를 쓴다', p1 !== null && p1.syntheticSite.startsWith(MACHINE_SITE_PREFIX))
  check('🔴 decidedBy 가 founder 가 아니다', p1 !== null && p1.decidedBy === MACHINE_DECIDED_BY)
  check('🔴 autoJudge 를 상수가 아니라 후보 값으로 남긴다', (() => {
    const g = p1?.gateResults.autoJudge as Record<string, unknown> | undefined
    return g?.ruleVersion === 'auto-judge-v3' && g?.inputHash === 'abc123'
  })())
  check('🔴 🔴 **적재가 품질 계약을 코드 상수로 남긴다**', (() => {
    const q = p1?.gateResults.qualityContract as Record<string, unknown> | undefined
    return q?.digest === qualityContractDigest() && q?.version === QUALITY_CONTRACT_VERSION
  })())
  check('🔴 판정 출처가 없으면 payload 를 만들지 않는다',
    buildQueuePayload({ envelope: mEnv, candidate: mc, now: NOW }) === null)
  check('🔴 provenance 에 원문·제목·본문이 없다', (() => {
    const j = JSON.stringify(p1?.gateResults ?? {})
    return !/bodyHead|rawBody|"title"|"body"/.test(j)
  })())

  const p2 = buildQueuePayload({ envelope: {}, candidate: ok(), now: NOW })
  check('🟢 사람 payload 도 만들어진다', p2 !== null && p2.profile === 'human')
  check('🔴 만들어진 human 행이 profileOf=human 이다', p2 !== null && queueProfileOf({
    promptVersion: p2.promptVersion, model: p2.model,
    sourceSite: p2.syntheticSite, gateResults: p2.gateResults,
  }) === 'human')

  // 🔴 provenance 세탁 금지 — 입력이 틀렸는데 정상 상수를 찍지 않는다
  for (const [label, patch] of [
    ['envelope.promptVersion 없음', { promptVersion: '' }],
    ['envelope.pipelineVersion 이 다름', { pipelineVersion: 'content-core-v1' }],
    // 🔴 단계별 모델을 손대면 통과하지 않는다 — 어느 모델이 썼는지가 계약이다
    ['stageModels 가 없음', { stageModels: undefined }],
    ['stageModels 한 칸이 다름', { stageModels: { ...STAGE_MODEL, draftGen: 'claude-haiku-4.5' } }],
    ['stageModels 에 모르는 단계', { stageModels: { ...STAGE_MODEL, extra: 'x' } }],
    // 🔴 품질 계약 — 다른(수정 전) 코드가 만든 파일은 적재하지 않는다 (2026-09-27)
    ['품질 계약 digest 없음', { qualityContractDigest: undefined }],
    ['품질 계약 digest 가 다름', { qualityContractDigest: '0'.repeat(64) }],
  ] as const) {
    check(`🔴 ${label} → payload 없음`,
      buildQueuePayload({ envelope: { ...mEnv, ...patch }, candidate: mc, autoJudge: aj, now: NOW }) === null)
  }
  for (const [label, patch] of [
    ['독창성을 재지 않음', { originality: undefined }],
    ['실질 복제', { originality: COPIED }],
    ['safety 미통과', { safetyVerdict: 'hold' }],
    ['leakedTokens 있음', { leakedTokens: '연락처' }],
  ] as const) {
    check(`🔴 ${label} → payload 없음`, buildQueuePayload({
      envelope: mEnv, candidate: ok({ ...mc, ...patch } as never), autoJudge: aj, now: NOW,
    }) === null)
  }
}

console.log('\n⑥ 실행 게이트 — 두 스위치가 다 있어야 한다')
{
  const t = [ok()]
  const g = { targets: t, apply: true, limit: 1, usable: 5 }
  check('🟢 전부 맞으면 통과', judgeApply(g).ok)
  check('🔴 --apply 없으면 안 돈다', !judgeApply({ ...g, apply: false }).ok)
  check('🔴 --limit 없으면 안 돈다', !judgeApply({ ...g, limit: null }).ok)
  check('🔴 --limit 0 이면 안 돈다', !judgeApply({ ...g, limit: 0 }).ok)
  check('🔴 --limit 이 음수면 안 돈다', !judgeApply({ ...g, limit: -1 }).ok)
  check('🔴 후보 0건이면 안 돈다', !judgeApply({ ...g, targets: [] }).ok)
  check(`🔴 재고가 목표 ${STOCK_TARGET}건이면 안 돈다`, !judgeApply({ ...g, usable: STOCK_TARGET }).ok)
  check('🔴 --limit 을 못 채우면 잘라내지 않고 멈춘다', (() => {
    const r = judgeApply({ ...g, limit: 3 })
    return !r.ok && r.reason.includes('잘라내지 않고 멈춘다')
  })())
  /**
   * 🔴 **자동 경로는 상한이다** (2026-09-09 Wave B 실측).
   *    목표를 42 로 올리자 부족분 29 를 `--limit` 으로 요구해 후보 1건에서 **적재 0건**이 됐다.
   *    사람이 주는 `--limit`(정확히)과 러너가 주는 `--up-to`(상한까지)를 나눈다.
   */
  check('🔴 --up-to 는 못 채워도 있는 만큼 적재한다', (() => {
    const r = judgeApply({ ...g, limit: null, upTo: 29 })
    return r.ok && r.take.length === g.targets.length
  })())
  check('🔴 --up-to 도 상한을 넘기지 않는다', (() => {
    const many = Array.from({ length: 5 }, (_, i) => ok({ title: `t${i}`, sourceArticleId: `a${i}` }))
    const r = judgeApply({ targets: many, apply: true, limit: null, upTo: 2, usable: 0, target: 42 })
    return r.ok && r.take.length === 2
  })())
  check('🔴 --up-to 도 목표 여력을 넘기지 않는다', (() => {
    const many = Array.from({ length: 5 }, (_, i) => ok({ title: `t${i}`, sourceArticleId: `a${i}` }))
    const r = judgeApply({ targets: many, apply: true, limit: null, upTo: 99, usable: 41, target: 42 })
    return r.ok && r.take.length === 1
  })())
  check('🔴 --up-to 와 --limit 을 함께 주면 막는다', (() => {
    const r = judgeApply({ ...g, limit: 1, upTo: 1 })
    return !r.ok && r.reason.includes('함께 주지 않는다')
  })())
  check('🔴 --up-to 여도 후보 0건이면 안 돈다', !judgeApply({ ...g, limit: null, upTo: 29, targets: [] }).ok)
  check('🔴 사람이 주는 --limit 의 "정확히" 계약은 그대로다', (() => {
    const r = judgeApply({ ...g, limit: 3 })
    return !r.ok && r.reason.includes('잘라내지 않고 멈춘다')
  })())
  /**
   * 🔴 **인자를 값으로 본다** (2026-09-20 보정). 앞판은 호출 문장을 글자로 박아
   *    두었는데, 작업 묶음이 생기며 문장 모양이 바뀌자 계약은 그대로인데 검사가 깨졌다.
   *    계약은 "러너는 상한까지(`--up-to`)로 부른다 · 정확히(`--limit`)로 부르지 않는다" 다.
   */
  check('🔴 러너는 --up-to 로 부른다 — --limit 으로 부르지 않는다', (() => {
    const pending: Pending = {
      rawCafe: {}, thin: {}, detail: ['a.detail.jsonl'], shadow: [],
      candidates: ['auto-draft-x.candidates.json'],
    }
    const policy = { llm: true, fill: true, upTo: 29, reason: '' }
    const gate = { kind: 'ready' as const, snapshotPath: '/d/s.json', runId: 'R1' }
    const plans = [
      // 🔴 옛 경로(묶음 없음)와 새 경로(묶음 있음) **둘 다** 본다
      ...planCommonPhase(pending, policy, gate),
      ...planBoundedCommonPhase(pending, policy, gate, {
        manifestPath: '/d/w.json', shadowPath: '/d/s.shadow.jsonl',
        candidatesPath: '/d/c.json', limit: 5, perStage: { judge: 5, draft: 15 },
      }),
    ].filter((p) => p.stage === 'fill')
    return plans.length === 2
      && plans.every((p) => p.args.some((a: string) => a.startsWith('--up-to=')))
      && plans.every((p) => !p.args.some((a: string) => a.startsWith('--limit=')))
  })())
  check('🔴 autofill CLI 가 --up-to 를 실제로 판정부에 넘긴다', (() => {
    const cli = readFileSync('scripts/micro-seed-supply-autofill.mts', 'utf-8')
    return /const UP_TO = UP_TO_RAW === null \? null : Number\.parseInt\(UP_TO_RAW, 10\)/.test(cli)
      && /judgeApply\(\{ targets, apply: APPLY, limit: LIMIT, upTo: UP_TO,/.test(cli)
  })())
  check('여력만큼만 가져간다', (() => {
    const many = Array.from({ length: 5 }, (_, i) => ok({ title: `t${i}`, sourceArticleId: `a${i}` }))
    const r = judgeApply({ targets: many, apply: true, limit: 2, usable: 10 })
    return r.ok && r.take.length === 2
  })())
}

console.log('\n⑦ 🔴 발행하지 않는다 — 정합이 이것을 잡는다')
{
  const b = { raw: 48, queue: 14, post: 38 }
  check('🟢 정상 보충', verifyAfterRefill({ before: b, after: { raw: 50, queue: 16, post: 38 }, added: 2 }).ok)
  check('🔴 Post 가 늘면 실패다 — 공급은 발행하지 않는다', (() => {
    const r = verifyAfterRefill({ before: b, after: { raw: 50, queue: 16, post: 39 }, added: 2 })
    return !r.ok && r.problems.some((p) => p.includes('발행하지 않는다'))
  })())
  check('🔴 Post 가 줄어도 실패다', !verifyAfterRefill({
    before: b, after: { raw: 50, queue: 16, post: 37 }, added: 2 }).ok)
  check('RawContent 증가가 안 맞으면 실패', !verifyAfterRefill({
    before: b, after: { raw: 49, queue: 16, post: 38 }, added: 2 }).ok)
  check('Queue 증가가 안 맞으면 실패', !verifyAfterRefill({
    before: b, after: { raw: 50, queue: 15, post: 38 }, added: 2 }).ok)
}

console.log('\n⑧ 🔴 원문 컬럼을 만들지 않는다 · 발행 코드가 없다')
{
  // 🔴 주석을 지우고 본다 — 주석에 적힌 금지 패턴이 자기 자신을 잡으면 안 된다
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const lib = codeOf('src/lib/micro-seed-supply-autofill.ts')
  const runner = codeOf('scripts/micro-seed-supply-autofill.mts')

  for (const [label, re] of [
    ['post.create', /post\.create|Post\.create/],
    ['comment 생성', /comment\.create/i],
    ['ActivityLog 생성', /ActivityLog\.create/i],
    ['persona 배정', /matchedPersonaId|planBatch|planStore/],
    // 🔴 로그에 이름을 적는 것은 호출이 아니다. import 와 호출 형태만 잡는다
    ['publish 호출', /publishOriginalPostTx\s*\(|from\s+'[^']*(?:publish-live|auto-publish)'/],
    ['PUBLISHED 전환', /status:\s*'PUBLISHED'/],
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['LLM', /openai|anthropic|gemini|gpt-/i],
    ['Sheet', /googleapis|sheets\.|spreadsheet/i],
    ['네이버 네트워크', /naver\.com|playwright|chromium/i],
  ] as const) {
    check(`🔴 러너에 ${label} 없음`, !re.test(runner))
  }

  // 🔴 원문 컬럼 — 남의 글 전문을 우리 저장소에 쌓지 않는다 (§4-AF ⑤)
  for (const col of ['bodyHead', 'sourceBody', 'sourceTitle', 'rawComments'] as const) {
    check(`🔴 ${col} 컬럼을 쓰지 않는다`, !new RegExp(`\\b${col}\\b`).test(runner + lib))
  }

  check('🔴 lib 은 순수 함수만이다 — DB·파일·네트워크 없음',
    !/PrismaClient|readFileSync|writeFileSync|fetch\(|await /.test(lib))
  check('러너가 두 스위치를 요구한다',
    /--apply/.test(runner) && /--limit=N/.test(runner))
  check('러너가 보류 파일을 읽는다', /held-candidates\.json/.test(runner))
  check('🔴 보류 파일이 없으면 멈춘다', (() => {
    // `if (missing) { … process.exit(1) }` 블록이 실제로 있는지 본다
    const i = runner.indexOf('if (missing)')
    if (i < 0) return false
    const block = runner.slice(i, runner.indexOf('\n  }', i))
    return /process\.exit\(1\)/.test(block)
  })())
  check('🔴 "없다" 와 "비었다" 를 구분한다',
    /missing:\s*true/.test(runner) && /missing:\s*false/.test(runner))
  check('엔트리포인트 가드가 있다', /isDirectRun/.test(runner))
}

console.log('\n⑨ 🔴 pacing 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-08).
  //    상수를 `RUNTIME_PROFILE` 에서 파생시키면서 `= 1` 같은 리터럴이 사라졌다.
  //    문자열을 찾던 검사는 "값이 그대로인가" 를 물으려던 것이므로, 값으로 묻는 편이 더 강하다 —
  //    프로필이 바뀌면 문자열은 그대로여도 값이 달라질 수 있다.
  check('POST_CAP_PER_WEEK = 1 그대로', POST_CAP_PER_WEEK === 1)
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', MIN_DAYS_BETWEEN_POSTS === 5)
  const pub = readFileSync('src/lib/original-post-publish.ts', 'utf-8')
  check('DAILY_PUBLISH_CAP = 1 그대로', DAILY_PUBLISH_CAP === 1)
  const lib = readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')
  check('🔴 공급 lib 이 발행 상수를 재정의하지 않는다',
    !/DAILY_PUBLISH_CAP|POST_CAP_PER_WEEK|MIN_DAYS_BETWEEN_POSTS/.test(lib))
}

// ─────────────────────────────────────────────────────────
// [ST] 적재가 읽을 원문 시각 — 🔴 **이 PR 은 아직 DB 에 쓰지 않는다**
//
//   `0026_raw_content_source_times` migration 을 적용한 뒤 별도 PR 에서 잇는다.
//   지금 잇고 migration 을 안 하면 컬럼이 없어 적재 전체가 죽는다.
// ─────────────────────────────────────────────────────────
{
  const POSTED = '2020-12-13T15:00:00.000Z'
  const CAPTURED = '2026-09-17T00:00:00.000Z'

  const t = queueSourceTimesOf({
    sourcePostedAt: POSTED, sourceListedAt: CAPTURED, sourceCapturedAt: CAPTURED,
  })
  check('🔴 [ST] 게시 시각을 Date 로 읽는다', t.sourcePostedAt?.toISOString() === POSTED)
  check('🔴 [ST] 세 칸이 서로 다른 값을 들 수 있다',
    t.sourcePostedAt?.getTime() !== t.sourceCapturedAt?.getTime())

  const none = queueSourceTimesOf({ sourceCapturedAt: CAPTURED })
  check('🔴 [ST] 게시 시각이 없으면 null (모른다)', none.sourcePostedAt === null)
  check('🔴 [ST] 🔴 가져온 시각으로 **메우지 않는다** — 옛 이슈가 새 글이 되는 길을 막는다',
    none.sourcePostedAt === null && none.sourceCapturedAt !== null)
  const bad = queueSourceTimesOf({ sourcePostedAt: '2020년 겨울쯤', sourceCapturedAt: CAPTURED })
  check('🔴 [ST] 읽을 수 없는 값은 null 이다 — 지금 시각으로 바꾸지 않는다',
    bad.sourcePostedAt === null)
  check('🔴 [ST] 빈 문자열도 null 이다', queueSourceTimesOf({ sourcePostedAt: '' }).sourcePostedAt === null)

  // 🔴 이번 PR 의 **정지선** — 적재가 아직 이 값을 쓰지 않는다
  {
    const runner = readFileSync('scripts/micro-seed-supply-autofill.mts', 'utf-8')
    const create = runner.slice(runner.indexOf('microSeedRawContent.create'))
      .slice(0, runner.slice(runner.indexOf('microSeedRawContent.create')).indexOf('select:'))
    check('🔴 [ST] 적재가 아직 sourcePostedAt 을 쓰지 않는다 (migration 미적용)',
      !create.includes('sourcePostedAt'))
    check('🔴 [ST] 기존 sourceCapturedAt 적재는 그대로다', create.includes('sourceCapturedAt:'))
  }

  /**
   * ── 🔴 **DB 변경 없이 배포 가능해야 한다** (2026-09-17 보정) ──
   *
   *    앞선 판은 활성 schema 에 컬럼을 올려 두고 migration 을 적용하지 않았다.
   *    Prisma 의 `create()` 는 `select` 를 주지 않으면 **모든 스칼라 필드를 돌려주므로**
   *    `RETURNING` 에 없는 컬럼이 들어가 그 자리에서 죽는다.
   *    실측: `micro-seed-import-82cook-live.mts` 의 `create()` 두 곳이 `select` 가 없다.
   *    그래서 schema 변경·migration 적용·적재 연결을 **한 작업으로 묶어** 별도 PR 로 뺀다.
   */
  {
    const schema = readFileSync('prisma/schema.prisma', 'utf-8')
    check('🔴 [ST] 활성 schema 에 sourcePostedAt 이 **없다** — DB 변경 없이 배포 가능해야 한다',
      !/sourcePostedAt/.test(schema))
    check('🔴 [ST] 활성 schema 에 sourceListedAt 이 **없다**', !/sourceListedAt/.test(schema))
    check('🔴 [ST] 기존 sourceCapturedAt 은 그대로다',
      /model MicroSeedRawContent[\s\S]*?sourceCapturedAt DateTime\n/.test(schema))
    check('🔴 [ST] 적용 대기 migration 을 prisma/migrations 에 두지 않는다',
      !existsSync('prisma/migrations/0026_raw_content_source_times'))

    // 🔴 초안은 보존한다 — 다음 작업이 그대로 옮겨 쓴다
    const mig = readFileSync(
      'prisma/migrations-draft/0026_raw_content_source_times/migration.sql', 'utf-8')
    check('🔴 [ST] 초안이 두 칸을 더한다', /ADD COLUMN "sourcePostedAt"/.test(mig)
      && /ADD COLUMN "sourceListedAt"/.test(mig))
    check('🔴 [ST] 초안이 기존 행을 가져온 시각으로 채우지 않는다',
      !/UPDATE\s+"MicroSeedRawContent"/i.test(mig))
    check('🔴 [ST] 초안이 기존 컬럼을 바꾸지 않는다', !/ALTER COLUMN|DROP COLUMN/i.test(mig))
    check('🔴 [ST] 초안 디렉터리가 왜 따로인지 적어 둔다',
      readFileSync('prisma/migrations-draft/README.md', 'utf-8').includes('select'))
  }

  /**
   * 🔴 **호환성 근거 — 읽기 질의는 전부 `select` 를 준다.**
   *    이 성질이 깨지면 다음에 컬럼을 더할 때 같은 사고가 난다.
   */
  {
    const files = [
      'scripts/micro-seed-publish-enqueue.mts', 'scripts/original-post-enqueue.mts',
      'scripts/original-post-decide.mts', 'scripts/original-post-generate.mts',
    ]
    for (const f of files) {
      const src = readFileSync(f, 'utf-8')
      const calls = src.split('microSeedRawContent.find').slice(1)
      check(`🔴 [ST] ${f} 의 읽기 질의가 select 를 준다`,
        calls.every((c) => c.slice(0, 400).includes('select:')))
    }
  }
}

console.log('\n⑳ 🔴 🔴 **의미 검수 경고가 적재까지 온다 — 실제 artifact 파일로 확인한다**')
{
  /**
   * 🔴 **손으로 베낀 fixture 가 아니다.** 운영 러너가 쓴 `.microseed-data/*.artifacts.json`
   *    에서 `review.semantic` 이 실린 장을 찾아, artifact → 요약 → 후보가 나르는 모양 →
   *    적재 payload → `gateResults.holds` 까지 **한 경로로** 확인한다.
   *
   * 🔴 2026-09-22 실측 결함: 후보 `cmucp5zkd…`(P07) 에서 semanticReview 가
   *    `unsupportedAdditions` 2건을 찾았는데 DB 의 `holds` 는 비어 있었다.
   *    적재가 `holds: [], blocks: []` 를 하드코딩했기 때문이다.
   */
  // 🔴 이 블록만의 fixture — 바깥 스코프에 기대지 않는다
  const eEnv: Envelope = {
    provenance: MACHINE_PROFILE.envelopeProvenance,
    ruleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    promptVersion: MACHINE_PROFILE.envelopePromptVersion,
    pipelineVersion: MACHINE_PROFILE.envelopePipelineVersion,
    stageModels: STAGE_MODEL,
    // 🔴 생성기가 적는 값 — 적재기는 자기 코드 상수와 같은지만 본다 (2026-09-27)
    qualityContractDigest: qualityContractDigest(),
  }
  const eC = ok({
    sourceDecision: 'AUTO_ADOPT', sourceInput: 'auto-judge',
    candidateType: 'seedOriginality', originality: CLEAN, leakedTokens: '',
    voiceProvenance: { personaCode: 'P01', comments: 5, bundleDigest: 'bd1', sourceDigest: 'sd1' },
  })
  const eAj = { ruleVersion: 'auto-judge-v3', promptVersion: 'semantic-shadow-v2b',
    model: 'claude-haiku-4.5', inputHash: 'abc123', provenance: 'machine-shadow' }

  const dirs = [join(homedir(), 'Documents/soransoran-runtime/.microseed-data'), '.microseed-data']
  let real: { file: string; review: unknown; n: number } | null = null
  for (const d of dirs) {
    let names: string[] = []
    try { names = readdirSync(d).filter((x) => x.includes('artifacts')) } catch { continue }
    for (const n of names) {
      try {
        const o = JSON.parse(readFileSync(join(d, n), 'utf-8')) as { artifacts?: unknown[] }
        const arr = (Array.isArray(o) ? o : (o.artifacts ?? [])) as Array<Record<string, unknown>>
        for (const a of arr) {
          const sum = semanticSummaryOf(a.review)
          // 🔴 **결함이 하나라도 있는 장**을 찾는다 — 깨끗한 장만 보면 전달을 증명하지 못한다
          if (sum !== null && sum.unsupportedAdditions > 0) {
            real = { file: n, review: a.review, n: sum.unsupportedAdditions }; break
          }
        }
      } catch { /* 깨진 파일은 건너뛴다 */ }
      if (real !== null) break
    }
    if (real !== null) break
  }

  /**
   * 🔴 **CI 에는 `.microseed-data` 가 없다** — 그 파일은 운영 머신의 로컬 산출물이다.
   *    그래서 "파일이 없으면 실패" 로 두면 CI 가 언제나 빨갛다.
   *
   * 🔴 대신 **실제 artifact 에서 그대로 옮겨 온 값**으로 같은 경로를 검증한다.
   *    아래 값은 2026-09-22 22:15 회차 원천 35019068(P07) 의 `review` 다 —
   *    지어낸 모양이 아니라 운영이 실제로 낸 판정이고, 그렇게 적는다.
   *    로컬에서는 위에서 찾은 **실제 파일**이 이 자리를 대신한다.
   */
  const SNAPSHOT_35019068 = {
    deterministic: { pass: true, failures: [] },
    semantic: {
      issues: [], unknownIssues: [], droppedFromSource: [],
      unsupportedAdditions: [
        { evidence: '어디서 글을 읽다 보니까 …', why: "원문에는 '아들 낳으면 왜 안쓰럽게 보는지' 궁금해하는 주제인데, 초안은 구체적 행동을 추가했다" },
        { evidence: '주변 보면 … 많잖아요.', why: "원문은 '봤거든요'(경험)인데, 초안은 '주변 보면' 으로 바꿨다" },
      ],
      lifeContradictions: [], confidence: 0.75,
    },
    semanticCompletion: { complete: true, reason: null, cause: null },
  }
  const src = real ?? { file: '(스냅샷 — 실제 22:15 회차 값)', review: SNAPSHOT_35019068, n: 2 }
  check('🔴 결함이 실린 판정을 근거로 쓴다 (로컬=실제 파일 · CI=실제 값 스냅샷)',
    semanticSummaryOf(src.review) !== null)
  {
    const sum = semanticSummaryOf(src.review)!
    check('🔴 ① 그 판정에서 결함을 읽는다', sum.unsupportedAdditions === src.n && sum.unsupportedAdditions > 0)

    // ② 후보 파일이 나르는 모양 (micro-seed-auto-draft 가 싣는 값)
    const carried = { semantic: sum, deterministic: { pass: sum.deterministicPass },
      semanticCompletion: { complete: sum.complete } }
    const sum2 = semanticSummaryOf(carried)
    check('🔴 ② 후보 파일을 거쳐도 값이 보존된다 — 수로 실어도 같다',
      JSON.stringify(sum) === JSON.stringify(sum2))

    // ③ 적재 payload — **실제 `buildQueuePayload`** 를 부른다
    const pl = buildQueuePayload({ envelope: eEnv, candidate: eC, autoJudge: eAj, review: carried, now: NOW })
    const g = (pl?.gateResults ?? {}) as Record<string, unknown>
    const holds = Array.isArray(g.holds) ? (g.holds as unknown[]).map(String) : []
    check('🔴 🔴 **③ 적재가 경고를 `holds` 에 싣는다 — 하드코딩된 빈 배열이 아니다**',
      holds.some((h) => h.startsWith('SEMANTIC_UNSUPPORTED_ADDITION')))
    check('🔴 🔴 **③ `blocks` 는 비어 있다 — 후보 생성은 계속된다**',
      Array.isArray(g.blocks) && (g.blocks as unknown[]).length === 0)
    check('🔴 ③ 요약도 함께 실린다', g.semanticReview != null)
    check('🔴 🔴 **원문·근거 문장을 DB 로 복제하지 않는다 — 수와 완전성 6칸뿐이다**', (() => {
      const j = JSON.stringify(g.semanticReview)
      return !j.includes('evidence') && !j.includes('why')
        && Object.keys(g.semanticReview as object).length === 6
    })())
  }

  // ④ 깨끗한 후보는 경고가 없다 — 불필요하게 막지 않는다
  const cleanRev = { semantic: { unsupportedAdditions: [], lifeContradictions: [], droppedFromSource: [], confidence: 0.95 },
    deterministic: { pass: true }, semanticCompletion: { complete: true } }
  const cleanPl = buildQueuePayload({ envelope: eEnv, candidate: eC, autoJudge: eAj, review: cleanRev, now: NOW })
  const cg = (cleanPl?.gateResults ?? {}) as Record<string, unknown>
  check('🔴 🔴 **④ 깨끗한 후보는 `holds` 가 비어 있다**',
    Array.isArray(cg.holds) && (cg.holds as unknown[]).length === 0)

  // ⑤ 판정 기록이 없으면 경고다 — 재지 못한 것을 "이상 없음" 으로 읽지 않는다
  const nonePl = buildQueuePayload({ envelope: eEnv, candidate: eC, autoJudge: eAj, now: NOW })
  const ng = (nonePl?.gateResults ?? {}) as Record<string, unknown>
  check('🔴 🔴 **⑤ 판정 기록이 없으면 경고가 남는다**',
    Array.isArray(ng.holds) && (ng.holds as string[]).includes('SEMANTIC_REVIEW_INCOMPLETE'))
  check('🔴 ⑤ 그때도 `blocks` 는 비어 있다 — 후보 생성은 멈추지 않는다',
    Array.isArray(ng.blocks) && (ng.blocks as unknown[]).length === 0)
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
