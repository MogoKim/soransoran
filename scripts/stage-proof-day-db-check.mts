#!/usr/bin/env tsx
/**
 * 🔴 **단계 증명일 — 자동 target 증거 관측 · 실제 로더 · 계획 · 발행 트랜잭션** (2026-10-19 · 격리 Postgres 전용)
 *
 *   ① 사람 승인·자동 재고가 함께 있어도 실제 원문 시각 순서가 동일하게 적용된다
 *   ② 자동 재고가 부족하면 사람 글은 나갈 수 있지만 증거는 `PUBLISH_NOT_AUTO_READY` 로 FAIL
 *   ③ 비시험일도 같은 source-time 순서를 쓴다
 *   ④ 증명일 env 는 consumer 가 그날 TRIAL/REPROVE 결정에서만 넣는다 · 날짜가 오늘이 아니면 꺼진다 · v5 SUSTAIN 거절
 *
 *   발행은 정본 트랜잭션의 **예약 · 무인** 모드로만 한다 — 증거가 세는 무인 표식이 실제로 남는다.
 *   🔴 운영 DB 에 절대 붙이지 않는다 — sentinel · localhost · 고정 DB 이름을 요구한다. provider 0. raw SQL 0.
 */
import { PrismaClient } from '@prisma/client'
import {
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'
import { CAPACITY_ENV, RELEASE_ENV } from '../src/lib/scale-profile'
import { authoritativeGate } from '../src/lib/auto-ready-repo'
import { AUTO_DECIDER, AUTO_READY_ENV, AUTO_READY_RECORD_KEY, makeStamp } from '../src/lib/auto-ready-v2'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'
import { publishOriginalPostTx, UNATTENDED_PUBLISH_DECIDED_BY } from '../src/lib/original-post-publish-tx'
import { planStore } from '../src/lib/original-post-match-store'
import { kstDateString } from '../src/lib/release-canary'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { autoProofNeeded, proofDayOf, PROOF_DATE_ENV, PROOF_STAGE_ENV } from '../src/lib/stage-proof-day'
import { consumerEnvOf } from '../src/lib/stage-controller'
import { validateStoredDecision, STAGE_DECISION_VERSION, DECISION_WRITER, previousKstDate } from '../src/lib/stage-decision-contract'
import { createStageDecision } from '../src/lib/stage-decision-repo'
import { readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import { judgeStageEvidence, personaCommentCapFor } from '../src/lib/stage-evidence'
import { loadPublishableStock, resolvePublishScale, planPublishBatch, laneOf } from './lib/publishable-stock.mjs'
import { markedStageEnv } from './lib/stage-decision-fixture'

const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) { console.error('🔴 격리 DB 가 아니다. 멈춘다.'); for (const p of problems) console.error(`   · ${p}`); process.exit(2) }

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}

/**
 * 🔴 **시험 시계 — 고정 시각축 하나** (2026-10-20 · 실행 시각·TZ 의존 제거).
 *    앞판은 계획 시계 = 실행 시각(인자 없는 Date) · 트랜잭션 시계 = 그날 19:30 KST 로 **두 시계**를 썼다.
 *    사람 fixture 원문은 실행 시각에서 (48 + daysAgo)h 전에 게시되고 발행은 19:30 에 판정되므로,
 *    KST 00:30 전에 돌면 ② 의 두 번째 사람 글(daysAgo 5)이 72h 상한을 넘어 expired 가 됐다
 *    (2026-10-20 00:19 KST: 19h11m + 53h = 72h11m · PR #769 CI).
 *    이제 TODAY · fixture 원문 · 증거 · 계획/로더 now · 발행 txNow · matchedAt · 자동 도장이 전부 이 시각 하나에서 나온다.
 *    그날 d3 세 슬롯(09:30 · 13:30 · 19:00)이 다 지난 뒤다. 72h 상한 · daysAgo · source-time 순서 · 기대값은 그대로다.
 */
const TEST_CLOCK = new Date('2026-10-19T19:30:00+09:00')
const NOW = TEST_CLOCK
const TODAY = kstDateString(NOW)
/** 🔴 트랜잭션 시계 — 시험 시계 그대로 (그날 d3 세 슬롯이 다 도래한 뒤) · 슬롯마다 1초씩 뒤 */
const TX_BASE = TEST_CLOCK
const DAY = 864e5
const prisma = new PrismaClient()

/** 🔴 격리 DB 청소 — FK 순서대로. raw SQL 0 */
async function wipe(): Promise<void> {
  await prisma.autoReadyAudit.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.personaActivityLog.deleteMany({})
  await prisma.originalPostApprovalQueue.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.microSeedRawContent.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.user.deleteMany({})
  await prisma.stageDecision.deleteMany({})
  await prisma.personaGlobalSwitch.deleteMany({})
}

let seq = 0
const raw = async (site: string, capturedAt: Date) => {
  seq += 1
  return prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/pd${seq}`, sourceArticleId: `${8000 + seq}-pd`,
      sourceCapturedAt: capturedAt, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}` },
    select: { id: true },
  })
}
async function personas(): Promise<void> {
  for (let i = 1; i <= 10; i += 1) {
    const code = `P${String(i).padStart(2, '0')}`
    const u = await prisma.user.create({ data: { nickname: `pd${code}` }, select: { id: true } })
    await prisma.persona.create({ data: { code, userId: u.id, status: 'active' } })
  }
}
const human = async (daysAgo: number, pinnedCode: string | null = null) => {
  const r = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, new Date(NOW.getTime() - daysAgo * DAY))
  const pinned = pinnedCode === null ? null
    : (await prisma.persona.findUniqueOrThrow({ where: { code: pinnedCode }, select: { id: true } })).id
  return (await prisma.originalPostApprovalQueue.create({
    data: { sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `가을 이불 꺼낸 날 ${seq}`,
      draftBody: `가을 이불을 꺼내 햇볕에 말렸어요 ${seq}. 다들 이불 바꾸셨어요?`, gateVerdict: 'PASS',
      gateResults: fakeEvidenceGate(EVIDENCE_AT, { id: `pd-h-${seq}`, ageH: 48 + daysAgo }) as never,
      promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL, decidedBy: 'founder', dedupKey: `pd-h-${seq}`,
      // 🔴 복구 행 — 앞 회차가 배정만 쓰고 끊긴 사람 행(평소에는 줄 맨 앞이다)
      ...(pinned === null ? {} : { matchedPersonaId: pinned, matchedAt: new Date(NOW.getTime() - DAY) }) },
    select: { id: true },
  })).id
}
const auto = async (voice: string, daysAgo: number) => {
  const r = await raw(`${MACHINE_SITE_PREFIX}navercafe:t`, new Date(NOW.getTime() - daysAgo * DAY))
  const title = `저녁 산책 이야기 ${seq}`
  const body = `저녁 먹고 동네를 한 바퀴 걸었어요 ${seq}. 다들 요즘 저녁에 뭐 하세요?`
  return (await prisma.originalPostApprovalQueue.create({
    data: { sourceRawContentId: r.id, status: 'APPROVED', draftTitle: title, draftBody: body, gateVerdict: 'PASS',
      gateResults: { holds: [], blocks: [], ...fakeEvidenceGate(EVIDENCE_AT, { id: `pd-a-${seq}`, ageH: daysAgo * 24 }),
        semanticReview: { complete: true, deterministicPass: true, unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9 },
        autoDraft: { provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
          draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion, voice: { personaCode: voice, bundleDigest: `bd-${voice}`, comments: 3 } },
        [QUALITY_CONTRACT_KEY]: currentQualityContract() } as never,
      promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy: AUTO_DECIDER, dedupKey: `pd-a-${seq}`,
      editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(title, body, NOW) } as never },
    select: { id: true },
  })).id
}

/**
 * 🔴 러너 env 모양 — consumer 가 넣는 그대로(2026-09-30 · canary 제거).
 *    증명일(TRIAL d3): release = d3 · 증명일 두 칸. 비시험일(지속 d3 · 증명 후 HOLD): release = d3 · 증명일 칸 없음.
 */
const envOf = (proof: boolean): Record<string, string> => markedStageEnv({
  [RELEASE_ENV]: 'd3', [CAPACITY_ENV]: 'd3', [AUTO_READY_ENV]: 'on',
  ...(proof ? { [PROOF_STAGE_ENV]: 'd3', [PROOF_DATE_ENV]: TODAY } : {}),
}, TODAY)
/** 🔴 증거 기준 시각 — 계획(NOW) · 트랜잭션(TX_BASE) 어느 쪽에서도 게시 72h 안 · 미래 시각 없음 (둘 다 시험 시계) */
const EVIDENCE_AT = new Date(Math.min(NOW.getTime(), TX_BASE.getTime()))

/** 🔴 러너와 같은 조립 — 로더 → 규모 → 증명일 필요 수 → 계획 */
const view = async (proof: boolean) => {
  const E = envOf(proof)
  const gate = await authoritativeGate(prisma, E)
  const loaded = await loadPublishableStock(prisma, NOW, { autoReadyOpen: gate.open })
  const resolved = resolvePublishScale({ env: E, loaded, now: NOW })
  const needed = autoProofNeeded(proofDayOf(E, NOW), loaded.autoTargetsToday ?? 0)
  return { E, gate, loaded, resolved, needed, plan: planPublishBatch({ loaded, caps: resolved.caps, at: NOW }) }
}
let tick = 0
/** 🔴 예약 · 무인 발행 — 사람 행은 배정 먼저 쓰고, 자동 행은 배정 계획을 트랜잭션에 넘긴다(러너와 같다) */
const publish = async (v: Awaited<ReturnType<typeof view>>, id: string) => {
  const txNow = new Date(TX_BASE.getTime() + tick * 1000)
  tick += 1
  const t = v.loaded.targets.find((x) => x.id === id)!
  const a = v.plan.assignOf.get(id)
  const plan = planStore({ status: t.status as never, createdPostId: null, seed: id,
    assigned: a?.assigned ?? null, eligible: a?.eligible ?? [], top: a?.top ?? [], blockedCount: a?.blocked.length ?? 0 })
  if (!plan.ok) return { kind: 'noPlan' as const }
  const persona = await prisma.persona.findUniqueOrThrow({ where: { code: plan.personaCode }, select: { id: true } })
  const isAuto = laneOf(t.decidedBy) === 'auto'
  if (!isAuto) {
    await prisma.originalPostApprovalQueue.updateMany({ where: { id, matchedPersonaId: null }, data: { matchedPersonaId: persona.id, matchedAt: txNow, matchMeta: plan.meta as never } })
  }
  const row = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, createdPostId: true, updatedAt: true, decidedBy: true } })
  return publishOriginalPostTx(prisma, {
    queueId: id, publishedToday: v.loaded.publishedToday,
    mode: { kind: 'scheduled', releaseStage: 'd3', unattended: true,
      planned: { queueId: row.id, status: row.status, createdPostId: row.createdPostId, updatedAt: row.updatedAt, decidedBy: row.decidedBy } },
    autoReadyEnv: v.E, ...(isAuto ? { autoAssign: { personaId: persona.id, matchMeta: plan.meta } } : {}),
  }, { now: () => txNow })
}
/** 🔴 한 슬롯 = 러너 한 회차 — 계획의 picked 를 발행 */
const slot = async (proof: boolean): Promise<string> => {
  const v = await view(proof)
  const id = v.plan.picked?.id
  if (id === undefined) return 'none'
  const r = await publish(v, id)
  return `${laneOf(v.loaded.targets.find((x) => x.id === id)!.decidedBy)}:${r.kind === 'published' ? 'ok' : r.kind === 'blocked' ? r.code : r.kind}`
}

async function main(): Promise<void> {
  console.log('\n══ 단계 증명일 — 자동 target 증거 관측 (격리 DB) ══')

  console.log('\n④ 증명일 env 의 출처 — consumer · 오늘 날짜')
  {
    const row = (state: string, release: string, transition: unknown) => validateStoredDecision({
      row: { kstDate: TODAY, capacity: 'd10', release, state, reasons: ['x'], blocks: [], dayPinned: false, supply: null,
        decidedAt: NOW.toISOString(), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition },
      expectKstDate: TODAY,
    })
    const trial = row('TRIAL', 'd3', { kind: 'TRIAL', trialBase: 'd1', previousKstDate: previousKstDate(TODAY), target: 'd3', basis: 'RETEST' })
    const te = trial.ok ? consumerEnvOf({ ok: true, decision: trial.decision }) : {}
    check('🟢 TRIAL(RETEST) 결정 → 증명일 d3 · 오늘', te[PROOF_STAGE_ENV] === 'd3' && te[PROOF_DATE_ENV] === TODAY, JSON.stringify(te))
    const sustain = row('SUSTAIN', 'd3', { kind: 'SUSTAIN', from: 'd1', to: 'd3' })
    check('🔴 v5 는 SUSTAIN 결정을 받지 않는다 — 지속 승격 경로가 없다', !sustain.ok, sustain.ok ? 'accepted' : sustain.reason)
    const reprove = row('REPROVE', 'd3', null)
    const re = reprove.ok ? consumerEnvOf({ ok: true, decision: reprove.decision }) : {}
    check('🟢 REPROVE d3 결정 → 증명일 d3 · 공개 d3', re[PROOF_STAGE_ENV] === 'd3' && re.SORAN_RELEASE_STAGE === 'd3',
      reprove.ok ? JSON.stringify(re) : reprove.reason)
    const prep = row('PREPARE', 'd1', null)
    const pe = prep.ok ? consumerEnvOf({ ok: true, decision: prep.decision }) : { [PROOF_STAGE_ENV]: 'x' }
    check('🔴 PREPARE 날 → 증명일 빈 값(비시험일)', pe[PROOF_STAGE_ENV] === '' && pe[PROOF_DATE_ENV] === '', JSON.stringify(pe))
    const safe = consumerEnvOf({ ok: false, code: 'BROKEN', fallback: 'safest', reason: '' })
    check('🔴 결정이 깨졌다(safest) → 증명일 빈 값', safe[PROOF_STAGE_ENV] === '')
    check('🔴 증명일 날짜가 오늘이 아니면 꺼진다', proofDayOf(markedStageEnv({ [PROOF_STAGE_ENV]: 'd3', [PROOF_DATE_ENV]: previousKstDate(TODAY)! }), NOW) === null)
    check('🔴 모르는 단계면 꺼진다', proofDayOf(markedStageEnv({ [PROOF_STAGE_ENV]: 'd7', [PROOF_DATE_ENV]: TODAY }), NOW) === null)
    check('필요 수 — 3 목표 · 오늘 자동 1 → 2 · 비시험일 → 0',
      autoProofNeeded(proofDayOf(envOf(true), NOW), 1) === 2 && autoProofNeeded(proofDayOf(envOf(false), NOW), 0) === 0)
  }

  console.log('\n① 사람 재고 6(복구 행 1 포함) · 더 신선한 자동 3 — source-time 순서로 auto 3')
  {
    await wipe(); await personas()
    await human(6, 'P07'); await human(5.5); await human(5); await human(4.5); await human(4); await human(3.5)
    await auto('P01', 1); await auto('P02', 0.8); await auto('P03', 0.6)
    const v = await view(true)
    check('게이트 열림 · 오늘 자동 target 0 · 필요 3', v.gate.open && (v.loaded.autoTargetsToday ?? -1) === 0 && v.needed === 3,
      `${v.gate.reasons.join('·')} · ${v.loaded.autoTargetsToday} · ${v.needed}`)
    check('🔴 더 오래된 사람 복구 행보다 최신 auto가 먼저', v.plan.picked !== null && laneOf(v.plan.picked.decidedBy) === 'auto', String(v.plan.picked?.id))
    const lanes = [await slot(true), await slot(true), await slot(true)]
    check('🔴 🔴 **최신 세 원천 = auto · auto · auto (전부 발행)**', lanes.join(',') === 'auto:ok,auto:ok,auto:ok', lanes.join(','))
    const after = await view(true)
    check('그 뒤 오늘 자동 target 3 · 필요 0(목표를 채웠다)', (after.loaded.autoTargetsToday ?? -1) === 3 && after.needed === 0,
      `${after.loaded.autoTargetsToday} · ${after.needed}`)
    const logs = await prisma.personaActivityLog.findMany({ where: { kind: 'post' }, select: { decidedBy: true } })
    check('발행 기록 3 · 전부 무인 표식', logs.length === 3 && logs.every((l) => l.decidedBy === UNATTENDED_PUBLISH_DECIDED_BY), logs.map((l) => l.decidedBy).join(','))
    // 증거 — 그날 결정을 TRIAL d3 로 두고 실제 수집 경로로 물량만 본다
    const dec = validateStoredDecision({ row: { kstDate: TODAY, capacity: 'd10', release: 'd3', state: 'TRIAL', reasons: ['x'], blocks: [],
      dayPinned: false, supply: null, decidedAt: NOW.toISOString(), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER,
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: previousKstDate(TODAY), target: 'd3', basis: 'RETEST' } }, expectKstDate: TODAY })
    if (dec.ok) await createStageDecision(prisma, dec.decision)
    const facts = await readStageEvidenceFacts(prisma, { kstDate: TODAY, stage: 'd3', decision: dec.ok ? dec.decision : null, now: NOW,
      commentCapPerPost: personaCommentCapFor('bootstrap-auto') })
    const ev = judgeStageEvidence(TODAY, 'd3', facts, { cost: [{ name: 'x', health: 'ok' }], errors: 'ok' })
    check('🟢 증거 — 자동 target 3/3 · PUBLISH_NOT_AUTO_READY 없음', ev.counts.autoTargets === 3 && !ev.codes.includes('PUBLISH_NOT_AUTO_READY'),
      `${ev.verdict} ${ev.codes.join(',')} ${JSON.stringify(ev.counts)}`)
  }

  console.log('\n② 자동 재고 부족(1) — 사람 글은 나갈 수 있지만 단계 물량은 short → FAIL')
  {
    await wipe(); await personas()
    await human(6); await human(5.5); await human(5); await human(4.5)
    await auto('P01', 1)
    const lanes = [await slot(true), await slot(true), await slot(true)]
    check('🟢 혼합 발행 가능 — auto 1 뒤에 사람 글 2 가 나간다', lanes.join(',') === 'auto:ok,human:ok,human:ok', lanes.join(','))
    const dec = validateStoredDecision({ row: { kstDate: TODAY, capacity: 'd10', release: 'd3', state: 'TRIAL', reasons: ['x'], blocks: [],
      dayPinned: false, supply: null, decidedAt: NOW.toISOString(), contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER,
      transition: { kind: 'TRIAL', trialBase: 'd1', previousKstDate: previousKstDate(TODAY), target: 'd3', basis: 'RETEST' } }, expectKstDate: TODAY })
    if (dec.ok) await createStageDecision(prisma, dec.decision)
    const facts = await readStageEvidenceFacts(prisma, { kstDate: TODAY, stage: 'd3', decision: dec.ok ? dec.decision : null, now: NOW,
      commentCapPerPost: personaCommentCapFor('bootstrap-auto') })
    const ev = judgeStageEvidence(TODAY, 'd3', facts, { cost: [{ name: 'x', health: 'ok' }], errors: 'ok' })
    check('🔴 🔴 **증거 FAIL — PUBLISH_NOT_AUTO_READY (자동 1 · 사람 2 는 물량 0)**',
      ev.verdict === 'FAIL' && ev.codes.includes('PUBLISH_NOT_AUTO_READY') && ev.counts.autoTargets === 1 && ev.counts.humanApproved === 2,
      `${ev.verdict} ${ev.codes.join(',')} ${JSON.stringify(ev.counts)}`)
    const after = await view(true)
    check('그때 필요 수는 2 로 남는다(사람 글로 채워지지 않는다)', after.needed === 2, String(after.needed))
  }

  console.log('\n③ 비시험일 — 같은 source-time 순서')
  {
    await wipe(); await personas()
    await human(6); await human(5.5); await human(5)
    await auto('P01', 1); await auto('P02', 0.8); await auto('P03', 0.6)
    const v = await view(false)
    check('비시험일 필요 수 0', v.needed === 0)
    const lanes = [await slot(false), await slot(false), await slot(false)]
    check('🔴 🔴 **비시험일도 최신 auto 세 건이 먼저**', lanes.join(',') === 'auto:ok,auto:ok,auto:ok', lanes.join(','))
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  if (fail > 0) process.exit(1)
}
await main()
