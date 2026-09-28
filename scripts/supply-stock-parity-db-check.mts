#!/usr/bin/env tsx
/**
 * 🔴 **공급 capacity 준비 · 발행 release 제한 · 재고 분류 일치 — 실행 검사 (격리 Postgres 전용)** (2026-09-26)
 *
 *   반례 ①  release=d1 · capacity=d5 · 검토 대기 기계 초안 8건
 *           → 앞판은 공급 화자 여력을 **release d1** 지평(7일 7자리)으로 셌다. 8건이 그 자리를 차지해
 *             여력 있는 화자가 1명만 남았다(실측 2026-09-26). 공급은 capacity 로, 발행은 release 로 잰다.
 *   반례 ②  같은 DB 에서 공급 `readStock` = 9 · 발행 러너 = 0
 *           → 공급과 발행이 **같은 분류**를 쓴다. 검토 대기는 발행 가능 재고가 아니다.
 *
 *   발행 쪽 계산은 러너가 부르는 순서 그대로 부른다(`original-post-auto-publish.mts`):
 *     authoritativeGate → loadPublishableStock → resolvePublishScale → planPublishBatch
 *   (러너가 이 셋을 실제로 부르는지는 `original-post:auto-publish-check` 가 잠근다.)
 *   공급 쪽은 **공급 러너의 export 함수** `snapshot` · `buildSpeakerLoad` 를 직접 부른다 — 사본이 아니다.
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** sentinel · localhost · 고정 DB 이름을 모두 요구하고,
 *    주소를 한 글자도 찍지 않는다. 격리 DB 세우는 법은 `auto-ready-db-check.mts` 머리말과 같다.
 */
import { PrismaClient } from '@prisma/client'

import {
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
  readStock, SAFEST_STOCK_LIMITS,
} from '../src/lib/micro-seed-supply-autofill'
import { PROFILES, releaseCapsOf, CAPACITY_ENV, RELEASE_ENV, type ReleaseStage } from '../src/lib/scale-profile'
import { resolveScale } from '../src/lib/scale-runtime'
import { authoritativeGate } from '../src/lib/auto-ready-repo'
import {
  loadPublishableStock, resolvePublishScale, planPublishBatch, classifyStock, loadStockClassification,
  STOCK_BUCKETS,
} from './lib/publishable-stock.mjs'
import { snapshot, buildSpeakerLoad, supplyPlanningProfile } from './supply-process.mjs'
import { planSpeakerAvailability, remainingCapacity } from '../src/lib/content-core/speaker-availability'
import { MACHINE_REVIEWED_BY } from '../src/lib/original-post-auto-publish'
import { readPostRequirements } from '../src/lib/original-post-persona-match'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'

// ── 🔴 격리 가드 — 주소를 찍지 않는다 ──
const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

const NOW = new Date()
const DAY = 864e5
/** 🔴 단계 env 는 **값으로** 넘긴다 — 프로세스 env 를 바꾸지 않는다 */
const envOf = (release: ReleaseStage, capacity: ReleaseStage): Record<string, string> =>
  ({ [RELEASE_ENV]: release, [CAPACITY_ENV]: capacity })

/**
 * 🔴 기계 profile 이 **통째로** 맞는 gate 기록 — 적재기가 남기는 모양 그대로.
 *    🔴 적재기는 **지금 품질 계약** 표식을 함께 적는다(`buildQueuePayload`) — 검토 대기 WIP 는 그 행의 뜻이다.
 *       옛 계약 행은 WIP 가 아니다 — `supply:wip-contract-db-check` 가 본다(2026-09-28).
 */
const machineGate = (voiceCode: string) => ({
  holds: [], blocks: [], [QUALITY_CONTRACT_KEY]: currentQualityContract(),
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    voice: { personaCode: voiceCode, bundleDigest: `bd-${voiceCode}`, comments: 3 },
  },
})

/**
 * 🔴 **발행 러너가 부르는 순서 그대로** — 사본 판정이 아니라 같은 함수를 같은 순서로 부른다.
 *    러너는 이 결과의 `plan.assignmentReady`(깨진 복구가 없을 때)만 낼 수 있다.
 */
async function publisherView(prisma: PrismaClient, env: Record<string, string>) {
  const autoOpen = await authoritativeGate(prisma, env)
  const loaded = await loadPublishableStock(prisma, NOW, { autoReadyOpen: autoOpen.open })
  const resolved = resolvePublishScale({ env, loaded, now: NOW })
  const plan = planPublishBatch({ loaded, caps: resolved.caps, at: NOW })
  const runnable = plan.brokenRecovery.length > 0 ? [] : plan.assignmentReady
  return { loaded, resolved, plan, runnable, classification: classifyStock({ loaded, plan }) }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 공급 capacity · 발행 release · 재고 분류 일치 (격리 DB 전용 · 운영 DB 0) ══')
  console.log('   격리 확인됨 (SORAN_ISOLATED_DB · localhost · soran_test)\n')

  // 🔴 검사 파일의 청소다 — 격리 DB 에서만 돈다
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
    + '"MicroSeedRawContent","Post","Persona","User" CASCADE',
  )

  let seq = 0
  const raw = async (site: string, capturedAt: Date) => {
    seq += 1
    return prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/p${seq}`,
        sourceArticleId: `${7000 + seq}-pp`, sourceCapturedAt: capturedAt, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}`,
      },
      select: { id: true },
    })
  }
  /**
   * ── 시드 — 운영 모양 그대로: active Persona 24 · 전원 **이틀 전에 한 편씩 발행**했다 ──
   *    🔴 배정기(`personaForMatchOf`)와 공급 여력은 큐의 `matchedAt` 을 이력으로 본다 —
   *       실제로 발행된 행(Post · PUBLISHED · matchedAt)을 만든다. ActivityLog 도 같이 남긴다.
   */
  const personas: { id: string; code: string }[] = []
  const TWO_DAYS_AGO = new Date(NOW.getTime() - 2 * DAY)
  for (let i = 1; i <= 24; i += 1) {
    const u = await prisma.user.create({ data: { nickname: `패리티${i}` }, select: { id: true } })
    const code = `P${String(i).padStart(2, '0')}`
    const p = await prisma.persona.create({ data: { code, userId: u.id, status: 'active' }, select: { id: true, code: true } })
    personas.push(p)
    const post = await prisma.post.create({
      data: { boardType: 'FREE', title: `지난 글 ${code}`, content: `지난 본문 ${code}`, authorId: u.id },
      select: { id: true },
    })
    const r = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, new Date(NOW.getTime() - 3 * DAY))
    await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: `지난 글 ${code}`, draftBody: `지난 본문 ${code}`,
        gateVerdict: 'PASS', gateResults: {} as never, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
        decidedBy: 'founder', dedupKey: `pp-pub-${code}`, createdPostId: post.id,
        matchedPersonaId: p.id, matchedAt: TWO_DAYS_AGO,
      },
    })
    await prisma.personaActivityLog.create({
      data: { personaId: p.id, kind: 'post', targetId: post.id, gateStatus: 'PASS', decidedBy: 'operator', createdAt: TWO_DAYS_AGO },
    })
  }
  /** 🔴 사람 검토를 기다리는 기계 초안 — 운영의 8건과 같은 모양(`machine:auto-draft-v5` · 배정 전) */
  const REVIEW_SPEAKERS = ['P01', 'P02', 'P04', 'P07', 'P12', 'P13', 'P14', 'P15'] as const
  const reviewIds: string[] = []
  for (const code of REVIEW_SPEAKERS) {
    const r = await raw(`${MACHINE_SITE_PREFIX}navercafe:t`, new Date(NOW.getTime() - 3 * DAY))
    reviewIds.push((await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `아침 산책 이야기 ${seq}`,
        draftBody: `아침에 동네를 한 바퀴 걸었어요 ${seq}. 다들 요즘 어떻게 지내세요?`,
        gateVerdict: 'PASS', gateResults: machineGate(code) as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: 'machine:auto-draft-v5', dedupKey: `pp-${seq}`,
      },
      select: { id: true },
    })).id)
  }
  /** 🔴 사람이 고른 글인데 원천이 40일 전이다 — TTL(상시 28일)을 넘겼다 */
  const humanRow = async (capturedAt: Date, title: string, body: string) => {
    const r = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, capturedAt)
    return (await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: title, draftBody: body,
        gateVerdict: 'PASS', gateResults: {} as never,
        promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
        decidedBy: 'founder', dedupKey: `pp-${seq}`,
      },
      select: { id: true },
    })).id
  }
  const ttlId = await humanRow(new Date(NOW.getTime() - 40 * DAY), '베란다 화분 이야기', '베란다에 화분을 들였더니 아침이 달라졌어요. 다들 키우는 식물 있으세요?')
  /** legacy — profile 불일치(영영 나가지 않는다) · gate 탈락 */
  const legacyRaw = await raw('legacy:site', new Date(NOW.getTime() - 3 * DAY))
  const legacyId = (await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: legacyRaw.id, status: 'APPROVED', draftTitle: '옛 판 글', draftBody: '옛 판 본문입니다.',
      gateVerdict: 'PASS', gateResults: {} as never, promptVersion: '13~14판', model: 'old', decidedBy: 'founder', dedupKey: 'pp-legacy',
    },
    select: { id: true },
  })).id
  const gateRaw = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, new Date(NOW.getTime() - 3 * DAY))
  const gateId = (await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: gateRaw.id, status: 'APPROVED', draftTitle: '게이트 탈락 글', draftBody: '게이트를 넘지 못한 본문입니다.',
      // 🔴 운영의 gate 탈락 3건처럼 형식도 옛 판이다 — readStock 은 세지 않고, 분류는 GATE 로 먼저 가른다
      gateVerdict: 'FAIL', gateResults: {} as never, promptVersion: '13~14판', model: 'old',
      decidedBy: 'founder', dedupKey: 'pp-gate',
    },
    select: { id: true },
  })).id

  const E15 = envOf('d1', 'd5')

  console.log('① 🔴 반례 ② — 같은 DB · 공급 readStock 9 · 발행 러너 0')
  {
    const rows = await prisma.originalPostApprovalQueue.findMany({
      select: { status: true, createdPostId: true, promptVersion: true, model: true, gateResults: true, rawContent: { select: { sourceSite: true } } },
    })
    const profiled = readStock(rows.map((r) => ({
      status: r.status, createdPostId: r.createdPostId, promptVersion: r.promptVersion, model: r.model,
      sourceSite: r.rawContent?.sourceSite ?? '', gateResults: r.gateResults,
    })), SAFEST_STOCK_LIMITS)
    check('형식 행(readStock) = 9 — 운영 반례와 같은 모양 (사람 1 · 기계 8)',
      profiled.usable === 9 && profiled.human === 1 && profiled.machine === 8, JSON.stringify(profiled))
    const pub = await publisherView(prisma, E15)
    check('🔴 발행 러너가 낼 수 있는 것 = 0', pub.runnable.length === 0, pub.runnable.join(','))

    const sup = await snapshot(prisma, SAFEST_STOCK_LIMITS, { env: E15, now: NOW })
    check('공급 snapshot 이 분류를 읽었다', sup.classification !== null, sup.classifyError ?? '')
    const c = sup.classification!
    check('🔴 🔴 **공급의 발행 가능 재고 = 발행 러너 = 0** (앞판: 공급 9)',
      c.counts.publishableNow === 0 && same(c.ids.publishableNow, pub.runnable),
      `공급 ${c.counts.publishableNow} · 러너 ${pub.runnable.length}`)
    check('🔴 공급 snapshot 의 형식 행은 9 로 남는다 — 버퍼 천장 계산용 (발행 가능이 아니다)', sup.profiled === 9)
    check('🔴 🔴 **검토 대기 8건은 publishable 이 아니라 humanReviewPending 이다**',
      same(c.ids.humanReviewPending, reviewIds) && !c.ids.publishableNow.some((id) => reviewIds.includes(id)))
    check('🔴 TTL 만료 1건은 ttlExpired — 신선 재고로 합치지 않는다',
      same(c.ids.ttlExpired, [ttlId]) && !c.ids.publishableNow.includes(ttlId))
    check('🔴 🔴 **TTL 만료는 WIP 를 점유하지 않는다 · 검토 대기는 점유한다**',
      !c.personaWipIds.includes(ttlId) && reviewIds.every((id) => c.personaWipIds.includes(id)))
    check('profile 불일치 1건 · gate 탈락 1건',
      same(c.ids.profileMismatch, [legacyId]) && same(c.ids.gateBlocked, [gateId]))
    const total = STOCK_BUCKETS.reduce((n, b) => n + c.counts[b], 0)
    check('🔴 칸은 겹치지 않고 빠지지 않는다 — 합 = 대기열 전체', total === c.queueTotal && c.queueTotal === 11,
      `합 ${total} · 대기열 ${c.queueTotal}`)
    const allIds = STOCK_BUCKETS.flatMap((b) => c.ids[b])
    check('🔴 한 행이 두 칸에 들어가지 않는다', new Set(allIds).size === allIds.length)
    check('🔴 🔴 **공급 분류 = 발행 러너 경로로 만든 분류** (칸마다 같은 id)',
      STOCK_BUCKETS.every((b) => same(c.ids[b], pub.classification.ids[b])))
    const shared = await loadStockClassification(prisma, E15, NOW)
    check('공용 로더도 같은 답이다', STOCK_BUCKETS.every((b) => same(shared.classification.ids[b], pub.classification.ids[b])))
  }

  console.log('\n② 🔴 반례 ① — release d1 · capacity d5 · 검토 대기 8건 → 공급 여력은 capacity, 발행 상한은 d1')
  {
    const scale = resolveScale(E15)
    check('정본이 release d1 · capacity d5 로 읽는다', scale.releaseStage === 'd1' && scale.capacityStage === 'd5')
    check('🔴 공급 계획 눈금은 capacity 다', supplyPlanningProfile(scale).stage === 'd5'
      // 🔴 값으로 비교한다 — Node 20 의 tsx 는 같은 모듈을 두 인스턴스로 적재할 수 있다
      && JSON.stringify(supplyPlanningProfile(scale).profile) === JSON.stringify(PROFILES.d5))
    const load = await buildSpeakerLoad(prisma, 'parity-run', { env: E15, now: NOW, scale })
    const totalOpen = Object.values(load.byCode).reduce((n, r) => n + r.openDays, 0)
    check('🔴 🔴 **지평 7일의 자리 = capacity d5 × 7 = 35** (앞판 release d1: 7)',
      totalOpen === PROFILES.d5.dailyTarget * 7, `열린 자리 ${totalOpen}`)
    check('지평의 모든 날이 d5 로 적힌다', load.stageByDate.length === 7 && load.stageByDate.every((d) => d.stage === 'd5'))
    check('파일에 release 눈금도 따로 적힌다 (d1)', load.releaseStage === 'd1' && load.planningStage === 'd5')
    /** 🔴 검토 대기는 WIP 에 **남는다** — 같은 화자로 또 만들지 않는다 */
    check('🔴 🔴 **검토 대기 8건은 화자 WIP 에 남는다** (P01 · P02 · P04 · P07 · P12 · P13 · P14 · P15 각 1)',
      REVIEW_SPEAKERS.every((code) => load.byCode[code]?.readyCount === 1)
      && load.wip.humanReviewPending === 8,
      REVIEW_SPEAKERS.map((c) => `${c}:${load.byCode[c]?.readyCount}`).join(' '))
    const caps = Object.entries(load.byCode).map(([code, r]) => ({ code, ...r }))
    const eligible = caps.filter((c) => remainingCapacity(c) > 0)
    check('🔴 🔴 **여력 있는 화자가 1명이 아니다** — 원천 5건이 서로 다른 화자를 받는다',
      eligible.length >= 5, `${eligible.length}명`)
    const plan = planSpeakerAvailability({ sourceKeys: ['s1', 's2', 's3', 's4', 's5', 's6'], capacities: caps })
    check('SEED 6건이 전부 화자를 받는다 (앞판: 2건 · 보류 4건)', plan.slots.every((s) => s.codes.length > 0),
      plan.slots.map((s) => `${s.sourceKey}:${s.codes.join(',')}`).join(' '))

    /** 🔴 발행은 여전히 d1 이다 — 공급 눈금이 발행 상한으로 새지 않는다 */
    const pub = await publisherView(prisma, E15)
    check('🔴 🔴 **발행 상한은 release d1 그대로** (일 1 · 주 1 · 최소 5일)',
      pub.resolved.scale.releaseStage === 'd1' && pub.resolved.dailyCap === 1
      && pub.resolved.caps.postsPerWeek === releaseCapsOf(PROFILES.d1).postsPerWeek
      && pub.resolved.caps.minDaysBetween === PROFILES.d1.minDaysBetween,
      JSON.stringify({ stage: pub.resolved.scale.releaseStage, cap: pub.resolved.dailyCap, caps: pub.resolved.caps }))
  }

  console.log('\n③ 🔴 새 사람 글 — 발행 러너가 d1 로 못 내면 공급도 발행 가능으로 세지 않는다')
  {
    const freshId = await humanRow(new Date(NOW.getTime() - 1 * DAY), '가을 옷장 정리', '가을 옷을 꺼내다가 작년에 산 니트를 찾았어요. 다들 옷장 정리 하셨어요?')
    const pub = await publisherView(prisma, envOf('d1', 'd5'))
    const sup = (await snapshot(prisma, SAFEST_STOCK_LIMITS, { env: envOf('d1', 'd5'), now: NOW })).classification!
    check('🔴 d1(최소 5일) — 이틀 전에 쓴 Persona 뿐이라 배정 유예(시간성) → 러너 0 · 공급 0',
      pub.runnable.length === 0 && sup.counts.publishableNow === 0 && sup.ids.assignmentDeferred.includes(freshId),
      `러너 ${pub.runnable.length} · 공급 ${sup.counts.publishableNow}`)
    /**
     * 🔴 **최근에 쓰지 않은 Persona 가 들어오면** 러너가 d1 로도 낸다 — 공급도 같은 한 건을 센다.
     *    (release d5 를 env 로 요청해도 준비도 감속으로 d1 이 된다 — ④ 에서 본다. 그래서 사람을 늘린다.)
     */
    const u = await prisma.user.create({ data: { nickname: '패리티25' }, select: { id: true } })
    await prisma.persona.create({ data: { code: 'P25', userId: u.id, status: 'active' } })
    const pub5 = await publisherView(prisma, envOf('d1', 'd5'))
    const sup5 = (await snapshot(prisma, SAFEST_STOCK_LIMITS, { env: envOf('d1', 'd5'), now: NOW })).classification!
    check('🔴 쉰 Persona 가 생기면 — 같은 글이 러너에서 나가고 공급도 같은 한 건을 센다',
      pub5.runnable.length === 1 && same(sup5.ids.publishableNow, pub5.runnable) && sup5.ids.publishableNow[0] === freshId,
      `러너 ${pub5.runnable.join(',')} · 공급 ${sup5.ids.publishableNow.join(',')}`)
    check('🔴 시간성 유예 글은 WIP 에 남는다 (d1 에서 밀린 그 글)', sup.personaWipIds.includes(freshId))
    check('🔴 발행 가능 글도 그 화자 WIP 다', sup5.personaWipIds.includes(freshId))
    check('🔴 legacy · gate 탈락은 WIP 가 아니다', !sup5.personaWipIds.includes(legacyId) && !sup5.personaWipIds.includes(gateId))
  }

  console.log('\n④ 기존 d1 · d3 · d5 — 공급은 capacity · 발행은 release (회귀)')
  {
    const combos: [ReleaseStage, ReleaseStage][] = [['d1', 'd1'], ['d1', 'd3'], ['d3', 'd3'], ['d3', 'd5'], ['d5', 'd5']]
    for (const [rel, cap] of combos) {
      const env = envOf(rel, cap)
      const scale = resolveScale(env)
      const load = await buildSpeakerLoad(prisma, `parity-${rel}-${cap}`, { env, now: NOW, scale })
      const pub = await publisherView(prisma, env)
      const open = Object.values(load.byCode).reduce((n, r) => n + r.openDays, 0)
      /** 🔴 발행은 준비도 감속을 받는다 — 요청한 release 를 넘지 않고, 공급 눈금으로 올라가지 않는다 */
      check(`release ${rel} · capacity ${cap} — 공급 ${load.planningStage} · 발행 ${pub.resolved.scale.releaseStage}`,
        load.planningStage === cap
        && pub.resolved.caps.minDaysBetween === releaseCapsOf(pub.resolved.scale.releaseProfile).minDaysBetween
        && pub.resolved.dailyCap === pub.resolved.scale.releaseProfile.dailyTarget
        && PROFILES[pub.resolved.scale.releaseStage].dailyTarget <= PROFILES[rel].dailyTarget
        && open <= PROFILES[cap].dailyTarget * 7,
        `열린 자리 ${open} · 발행 일 ${pub.resolved.dailyCap}`)
    }
  }

  console.log('\n⑤ 🔴 마스터 반례 — 배정기(planBatch) → classifyStock 실제 경로 · 말투를 보지 않고 유예를 추정하지 않는다')
  {
    /**
     * voice=P03 · 성인 딸 글 · P03 무자녀(NO_CHILDREN) · P01·P02 는 자녀(성인)가 있지만 이틀 전에 썼다
     * → d1(주 1 · 최소 5일)에서 WEEKLY_CAP + TOO_SOON · 말투는 P03 뿐이라 deferredBy 없음.
     * 🔴 기계 글은 사람 검토를 마친 모양(`MACHINE_REVIEWED_BY`)이어야 배정기에 들어간다 — 격리 DB fixture 다.
     */
    const TITLE = '성인 된 딸이 독립해서 나갔어요'
    const BODY = '우리 딸이 올해 서른이 되어 따로 나가 살아요. 다 큰 딸 독립, 다들 어떻게 받아들이셨어요?'
    const req = readPostRequirements(TITLE, BODY)
    check('fixture 글이 자녀 요구를 가진다 (정본 판정)', req.needsChildren, JSON.stringify(req.needsChildAgeBands))
    const bands = req.needsChildAgeBands.length > 0 ? req.needsChildAgeBands : ['성인']
    for (const code of ['P01', 'P02']) {
      await prisma.persona.update({ where: { code }, data: { identity: { childrenCount: 1, childrenAgeBands: bands } as never } })
    }
    await prisma.persona.update({ where: { code: 'P03' }, data: { identity: { childrenCount: 0 } as never } })
    const machineReviewed = async (voice: string): Promise<string> => {
      const r = await raw(`${MACHINE_SITE_PREFIX}navercafe:t`, new Date(NOW.getTime() - 1 * DAY))
      return (await prisma.originalPostApprovalQueue.create({
        data: {
          sourceRawContentId: r.id, status: 'APPROVED', draftTitle: TITLE, draftBody: `${BODY} (${seq})`,
          gateVerdict: 'PASS', gateResults: machineGate(voice) as never,
          promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
          decidedBy: MACHINE_REVIEWED_BY, dedupKey: `pp-v-${seq}`,
        },
        select: { id: true },
      })).id
    }
    const negId = await machineReviewed('P03')
    const posId = await machineReviewed('P01')
    const pub = await publisherView(prisma, envOf('d1', 'd5'))
    const neg = pub.plan.assignOf.get(negId)
    const blockedOf = (a: typeof neg, code: string): string[] =>
      (a?.blocked.find((b) => b.code === code)?.reasons ?? []).map((r) => r.code).sort()
    check('반례 모양이 실제로 나온다 — 배정 없음 · deferredBy 없음',
      neg !== undefined && neg.assigned === null && neg.deferredBy.length === 0, JSON.stringify(neg?.deferredBy))
    check('반례 모양 — P03 은 NO_CHILDREN · P01·P02 는 TOO_SOON + WEEKLY_CAP 뿐 (배정기는 그들의 말투를 보지 않았다)',
      blockedOf(neg, 'P03').includes('NO_CHILDREN')
      && blockedOf(neg, 'P01').join(',') === 'TOO_SOON,WEEKLY_CAP' && blockedOf(neg, 'P02').join(',') === 'TOO_SOON,WEEKLY_CAP',
      `P01 ${blockedOf(neg, 'P01')} · P02 ${blockedOf(neg, 'P02')} · P03 ${blockedOf(neg, 'P03')}`)
    const c = pub.classification
    check('🔴 🔴 **voice=P03 글은 assignmentException · WIP 아님** (앞판: 유예 · WIP)',
      c.ids.assignmentException.includes(negId) && !c.personaWipIds.includes(negId))
    const pos = pub.plan.assignOf.get(posId)
    check('양성 모양 — voice=P01 · 배정 없음 · deferredBy 없음 · P01 은 리듬 사유뿐',
      pos !== undefined && pos.assigned === null && pos.deferredBy.length === 0
      && blockedOf(pos, 'P01').join(',') === 'TOO_SOON,WEEKLY_CAP')
    check('🔴 🔴 **voice=P01 글(글쓴이 본인 리듬만) → assignmentDeferred · WIP**',
      c.ids.assignmentDeferred.includes(posId) && c.personaWipIds.includes(posId))
    const sup = (await snapshot(prisma, SAFEST_STOCK_LIMITS, { env: envOf('d1', 'd5'), now: NOW })).classification!
    check('🔴 공급 분류도 같은 답이다', sup.ids.assignmentException.includes(negId) && sup.ids.assignmentDeferred.includes(posId))
    const load = await buildSpeakerLoad(prisma, 'parity-voice', { env: envOf('d1', 'd5'), now: NOW, scale: resolveScale(envOf('d1', 'd5')) })
    const load0 = { P01: 1, P03: 0 }
    check('🔴 화자 WIP — P01 은 그 글을 든다 · P03 은 예외 글로 점유되지 않는다',
      (load.byCode.P01?.readyCount ?? -1) === load0.P01 + 1 && (load.byCode.P03?.readyCount ?? -1) === load0.P03,
      `P01 ${load.byCode.P01?.readyCount} · P03 ${load.byCode.P03?.readyCount}`)
  }

  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 전용 · 운영 DB 0 · 네트워크 0 · LLM 0\n')
  if (fail > 0) process.exit(1)
}

await main()
