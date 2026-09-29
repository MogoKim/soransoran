#!/usr/bin/env tsx
/**
 * 🔴 **옛 품질 계약 기계 초안은 지금 계약의 Persona WIP 가 아니다 — 실행 검사 (격리 Postgres 전용)** (2026-09-28)
 *
 *   질문 — 품질 계약 digest 가 다른 옛 기계 초안은 자동 READY 도 자동 발행도 **영영** 받지 못한다
 *          (`stampRowInTx` · `recheckAutoReadyInTx` 가 `isCurrentQualityContract` 로 막는다).
 *          그런데 왜 그 글이 **지금 계약의 생성 WIP** 를 점유하는가? (운영 실측 WIP 46 / 실효 천장 54)
 *   답    — 재고 분류가 `HUMAN_REVIEW_REQUIRED` 전부를 `humanReviewPending`(WIP)으로 셌기 때문이다.
 *          이제 그 행은 `qualityContractMismatch`(WIP 아님 · 사람 검토로만 나간다)다.
 *
 *   반례 ①  옛 계약 기계 초안 46건 → 큐에 전부 남는다 · 자동 발행 0 · 지금 계약 WIP 0
 *   반례 ②  지금 계약 검토 대기 → WIP 유지
 *   반례 ③  지금 계약 발행 가능 행 → 기존 뜻(publishableNow · WIP)
 *   반례 ④  사람이 검토한 옛 계약 행(founder) → 제외하지 않는다(selector 대상 · 배정 규칙)
 *   반례 ⑤  옛 계약 자동 도장 행 → 자동 READY 가 **열려 있어도** selector 가 내지 않는다
 *   반례 ⑥  계약이 바뀐 상태로 공급·발행 읽기 경로 전부를 돌려도 DB 행 변경 0 (행 전체 스냅샷 대조)
 *   반례 ⑦  공급 분류 = 발행 러너 경로 분류 (칸마다 같은 id)
 *   반례 ⑧  공급 눈금은 capacity · 발행 눈금은 release — 섞이지 않는다
 *   반례 ⑨  TTL · profile · gate 분류 회귀 0
 *   반례 ⑩  같은 원천 Queue/Post 중복 0
 *   그리고 **실제 공급 러너 함수**(`buildSpeakerLoad`)로 Persona 별 WIP 가 어떻게 바뀌는지 찍는다.
 *
 * 🔴 PR #591(quality-v1 → v2)에 기대지 않는다. 코드 상수는 바꿀 수 없으므로 "지금 계약 ≠ 행의 계약" 을
 *    **행 쪽 표식**으로 만든다 — 같은 판 다른 digest · 옛 판 · 표식 없음(legacy).
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** sentinel · localhost · 고정 DB 이름을 모두 요구하고,
 *    주소를 한 글자도 찍지 않는다.
 */
import { PrismaClient } from '@prisma/client'

import {
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
  SAFEST_STOCK_LIMITS,
} from '../src/lib/micro-seed-supply-autofill'
import { PROFILES, RUNTIME_PROFILES, CAPACITY_ENV, RELEASE_ENV, type ReleaseStage } from '../src/lib/scale-profile'
import { resolveScale } from '../src/lib/scale-runtime'
import { authoritativeGate, stampAutoReady, stampRound } from '../src/lib/auto-ready-repo'
import {
  AUTO_DECIDER, AUTO_READY_ENV, AUTO_READY_RECORD_KEY, makeStamp, digestOf,
} from '../src/lib/auto-ready-v2'
import {
  currentQualityContract, isCurrentQualityContract, readQualityContract,
  QUALITY_CONTRACT_KEY, QUALITY_CONTRACT_VERSION,
} from '../src/lib/quality-contract'
import { MACHINE_REVIEWED_BY } from '../src/lib/original-post-auto-publish'
import {
  loadPublishableStock, resolvePublishScale, planPublishBatch, classifyStock, loadStockClassification,
  STOCK_BUCKETS, STOCK_BUCKET_META,
} from './lib/publishable-stock.mjs'
import { snapshot, buildSpeakerLoad, supplyPlanningProfile } from './supply-process.mjs'
import { remainingCapacity } from '../src/lib/content-core/speaker-availability'

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
const envOf = (release: ReleaseStage, capacity: ReleaseStage, extra: Record<string, string> = {}): Record<string, string> =>
  ({ [RELEASE_ENV]: release, [CAPACITY_ENV]: capacity, ...extra })

type Mark = 'current' | 'otherDigest' | 'otherVersion' | 'none'
/** 🔴 행 쪽 품질 계약 표식 — `current` 만 지금 코드 상수와 같다 */
const markOf = (m: Mark): Record<string, unknown> => {
  switch (m) {
    case 'current': return { [QUALITY_CONTRACT_KEY]: currentQualityContract() }
    case 'otherDigest': return { [QUALITY_CONTRACT_KEY]: { version: QUALITY_CONTRACT_VERSION, digest: digestOf('옛 게이트 · 옛 검수 · 옛 생성') } }
    case 'otherVersion': return { [QUALITY_CONTRACT_KEY]: { version: 'quality-v0', digest: digestOf('옛 판') } }
    case 'none': return {}
    default: {
      const never: never = m
      return never
    }
  }
}
/** 🔴 기계 profile 이 **통째로** 맞는 gate 기록 — 적재기가 남기는 모양 그대로 + 품질 계약 표식 */
const machineGate = (voiceCode: string, m: Mark) => ({
  holds: [], blocks: [],
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    voice: { personaCode: voiceCode, bundleDigest: `bd-${voiceCode}`, comments: 3 },
  },
  ...markOf(m),
})

async function publisherView(prisma: PrismaClient, env: Record<string, string>, forceOpen = false) {
  const autoOpen = await authoritativeGate(prisma, env)
  const loaded = await loadPublishableStock(prisma, NOW, { autoReadyOpen: forceOpen || autoOpen.open })
  const resolved = resolvePublishScale({ env, loaded, now: NOW })
  const plan = planPublishBatch({ loaded, caps: resolved.caps, at: NOW })
  const runnable = plan.brokenRecovery.length > 0 ? [] : plan.assignmentReady
  return { loaded, resolved, plan, runnable, classification: classifyStock({ loaded, plan }) }
}

/** 🔴 행 전체 스냅샷 — updatedAt 까지 값으로 비교한다 */
async function fullSnapshot(prisma: PrismaClient): Promise<string> {
  const q = await prisma.originalPostApprovalQueue.findMany({ orderBy: { id: 'asc' } })
  const post = await prisma.post.findMany({ orderBy: { id: 'asc' } })
  const persona = await prisma.persona.findMany({ orderBy: { id: 'asc' } })
  const log = await prisma.personaActivityLog.findMany({ orderBy: { id: 'asc' } })
  const raw = await prisma.microSeedRawContent.findMany({ orderBy: { id: 'asc' } })
  const audit = await prisma.autoReadyAudit.findMany({ orderBy: { queueId: 'asc' } })
  return JSON.stringify({ q, post, persona, log, raw, audit })
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 옛 품질 계약 기계 초안 · 지금 계약 Persona WIP (격리 DB 전용 · 운영 DB 0) ══')
  console.log('   격리 확인됨 (SORAN_ISOLATED_DB · localhost · soran_test)')
  console.log(`   지금 품질 계약: ${QUALITY_CONTRACT_VERSION} · digest ${currentQualityContract().digest.slice(0, 12)}…\n`)

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
        origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/w${seq}`,
        sourceArticleId: `${9000 + seq}-wc`, sourceCapturedAt: capturedAt, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}`,
      },
      select: { id: true },
    })
  }

  /** ── 시드 — active Persona 18 (기계 초안 화자) · 전원 이틀 전에 한 편씩 발행했다 · 쉰 Persona 1 ── */
  const SPEAKERS = Array.from({ length: 18 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
  const TWO_DAYS_AGO = new Date(NOW.getTime() - 2 * DAY)
  for (const code of SPEAKERS) {
    const u = await prisma.user.create({ data: { nickname: `계약${code}` }, select: { id: true } })
    const p = await prisma.persona.create({ data: { code, userId: u.id, status: 'active' }, select: { id: true } })
    const post = await prisma.post.create({
      data: { boardType: 'FREE', title: `지난 글 ${code}`, content: `지난 본문 ${code}`, authorId: u.id }, select: { id: true },
    })
    const r = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, new Date(NOW.getTime() - 3 * DAY))
    await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: `지난 글 ${code}`, draftBody: `지난 본문 ${code}`,
        gateVerdict: 'PASS', gateResults: {} as never, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
        decidedBy: 'founder', dedupKey: `wc-pub-${code}`, createdPostId: post.id, matchedPersonaId: p.id, matchedAt: TWO_DAYS_AGO,
      },
    })
    await prisma.personaActivityLog.create({
      data: { personaId: p.id, kind: 'post', targetId: post.id, gateStatus: 'PASS', decidedBy: 'operator', createdAt: TWO_DAYS_AGO },
    })
  }
  {
    const u = await prisma.user.create({ data: { nickname: '계약P19' }, select: { id: true } })
    await prisma.persona.create({ data: { code: 'P19', userId: u.id, status: 'active' } })
  }

  const machineRow = async (o: { voice: string; mark: Mark; decidedBy: string; stamp?: boolean; title?: string }) => {
    const r = await raw(`${MACHINE_SITE_PREFIX}navercafe:t`, new Date(NOW.getTime() - 2 * DAY))
    const title = o.title ?? `저녁 산책 이야기 ${seq}`
    const body = `저녁 먹고 동네를 한 바퀴 걸었어요 ${seq}. 다들 요즘 저녁에 뭐 하세요?`
    return (await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: title, draftBody: body,
        gateVerdict: 'PASS', gateResults: machineGate(o.voice, o.mark) as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: o.decidedBy, dedupKey: `wc-${seq}`,
        ...(o.stamp === true ? { editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(title, body, NOW) } as never } : {}),
      },
      select: { id: true },
    })).id
  }
  const humanRow = async (capturedAt: Date, title: string, body: string) => {
    const r = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, capturedAt)
    return (await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: title, draftBody: body,
        gateVerdict: 'PASS', gateResults: {} as never, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
        decidedBy: 'founder', dedupKey: `wc-${seq}`,
      },
      select: { id: true },
    })).id
  }

  /**
   * ① 46건 — 운영 모양(46 / 18×3). 먼저 **지금 계약**으로 적재된 상태로 둔다(= 계약을 올리기 전).
   *    화자는 18명에게 고르게(P01~P10 은 3건 · P11~P18 은 2건).
   */
  const oldIds: string[] = []
  const voiceOfOld = new Map<string, string>()
  for (let i = 0; i < 46; i += 1) {
    const voice = SPEAKERS[i % 18]!
    const id = await machineRow({ voice, mark: 'current', decidedBy: 'machine:auto-draft-v5' })
    oldIds.push(id); voiceOfOld.set(id, voice)
  }
  /** ⑤ 자동 도장 행 — 옛 계약 2건 · 지금 계약 1건(대조) */
  const oldAutoIds = [
    await machineRow({ voice: 'P05', mark: 'otherDigest', decidedBy: AUTO_DECIDER, stamp: true }),
    await machineRow({ voice: 'P06', mark: 'none', decidedBy: AUTO_DECIDER, stamp: true }),
  ]
  const curAutoId = await machineRow({ voice: 'P07', mark: 'current', decidedBy: AUTO_DECIDER, stamp: true })
  /** ② 지금 계약 검토 대기 */
  const curReviewId = await machineRow({ voice: 'P17', mark: 'current', decidedBy: 'machine:auto-draft-v5' })
  /** ④ 사람이 검토한 옛 계약 기계 행 — `founder` */
  const humanOldId = await machineRow({ voice: 'P18', mark: 'otherDigest', decidedBy: MACHINE_REVIEWED_BY })
  /** ③ 지금 발행 가능 — 사람이 고른 새 글(쉰 P19 가 받을 수 있다) */
  const freshId = await humanRow(new Date(NOW.getTime() - 1 * DAY), '가을 이불 꺼낸 날', '가을 이불을 꺼내 햇볕에 말렸어요. 다들 이불 바꾸셨어요?')
  /** ⑨ 회귀 — TTL 만료 · profile 불일치 · gate 탈락 */
  const ttlId = await humanRow(new Date(NOW.getTime() - 40 * DAY), '베란다 화분 이야기', '베란다에 화분을 들였더니 아침이 달라졌어요. 다들 키우는 식물 있으세요?')
  const legacyRaw = await raw('legacy:site', new Date(NOW.getTime() - 3 * DAY))
  const legacyId = (await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: legacyRaw.id, status: 'APPROVED', draftTitle: '옛 판 글', draftBody: '옛 판 본문입니다.',
      gateVerdict: 'PASS', gateResults: {} as never, promptVersion: '13~14판', model: 'old', decidedBy: 'founder', dedupKey: 'wc-legacy',
    },
    select: { id: true },
  })).id
  const gateRaw = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, new Date(NOW.getTime() - 3 * DAY))
  const gateId = (await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: gateRaw.id, status: 'APPROVED', draftTitle: '게이트 탈락 글', draftBody: '게이트를 넘지 못한 본문입니다.',
      gateVerdict: 'FAIL', gateResults: {} as never, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
      decidedBy: 'founder', dedupKey: 'wc-gate',
    },
    select: { id: true },
  })).id

  /** 🔴 공급 capacity d10 · 발행 release d1 — 운영 모양(공급은 넉넉히 준비 · 발행은 좁게) */
  const E = envOf('d1', 'd10')
  const scale = resolveScale(E)

  console.log('── 계약을 올리기 전 — 46건이 지금 계약 검토 대기일 때 (앞판과 같은 뜻) ──')
  const loadBefore = await buildSpeakerLoad(prisma, 'wc-before', { env: E, now: NOW, scale })
  const beforeClass = (await loadStockClassification(prisma, E, NOW)).classification
  check('계약을 올리기 전 — 46건은 humanReviewPending · WIP (지금 계약 검토 대기의 뜻 그대로)',
    oldIds.every((id) => beforeClass.ids.humanReviewPending.includes(id) && beforeClass.personaWipIds.includes(id)))

  /**
   * 🔴 **계약을 올린다** — 코드 상수는 이 프로세스에서 바꿀 수 없으므로 **행 쪽 표식**을 옛 것으로 옮긴다.
   *    검사의 fixture 조작이다(격리 DB). 코드 경로는 이 뒤로 **한 줄도 쓰지 않는다** — ⑥ 이 잰다.
   *    같은 판 다른 digest(주) · 옛 판 · 표식 없음을 섞는다 — 셋 다 정본상 "지금 계약 아님" 이다.
   */
  const marks: Mark[] = ['otherDigest', 'otherDigest', 'otherVersion', 'none']
  for (const [i, id] of oldIds.entries()) {
    await prisma.originalPostApprovalQueue.update({
      where: { id }, data: { gateResults: machineGate(voiceOfOld.get(id)!, marks[i % marks.length]!) as never },
    })
  }
  const stored = await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: oldIds } }, select: { gateResults: true } })
  check('fixture — 46건 모두 정본상 지금 계약이 아니다 · 같은 판 다른 digest 는 모양이 온전하다',
    stored.every((r) => !isCurrentQualityContract(r.gateResults))
    && stored.some((r) => readQualityContract(r.gateResults)?.version === QUALITY_CONTRACT_VERSION))

  // ⑥ 의 기준 — 여기부터 코드 경로만 돈다
  const snap0 = await fullSnapshot(prisma)
  const counts0 = { q: await prisma.originalPostApprovalQueue.count(), post: await prisma.post.count() }

  console.log('\n① 🔴 옛 계약 기계 초안 46건 — 큐에 남는다 · 자동 발행 0 · 지금 계약 WIP 0')
  const pub = await publisherView(prisma, E)
  const c = pub.classification
  {
    check('🔴 🔴 **46건 전부 qualityContractMismatch** (앞판: humanReviewPending)',
      oldIds.every((id) => c.ids.qualityContractMismatch.includes(id)) && !oldIds.some((id) => c.ids.humanReviewPending.includes(id)),
      JSON.stringify(c.counts))
    check('🔴 🔴 **지금 계약 Persona WIP 점유 0** (46건 중 WIP 에 든 것 0)', !oldIds.some((id) => c.personaWipIds.includes(id)))
    check('🔴 자동 발행 대상 0 · 발행 가능 0', !oldIds.some((id) => pub.loaded.targets.some((t) => t.id === id) || pub.runnable.includes(id)))
    check('🔴 selector 코드는 그대로 HUMAN_REVIEW_REQUIRED — 사람 검토 묶음(`auto-ready-bundle-select`)이 계속 본다',
      oldIds.every((id) => pub.loaded.rejected.some((r) => r.id === id && r.code === 'HUMAN_REVIEW_REQUIRED')))
    const still = await prisma.originalPostApprovalQueue.count({ where: { id: { in: oldIds }, status: 'APPROVED', createdPostId: null } })
    check('🔴 큐에 46건 그대로 남는다 (삭제 0 · 상태 변경 0)', still === 46, String(still))
    check('칸 표 — WIP 아님 · 복구 주체 human', STOCK_BUCKET_META.qualityContractMismatch.wip === false
      && STOCK_BUCKET_META.qualityContractMismatch.owner === 'human')
  }

  console.log('\n② ③ ④ 지금 계약 검토 대기 · 발행 가능 · 사람이 검토한 옛 계약 행')
  {
    check('🔴 🔴 **② 지금 계약 검토 대기 → humanReviewPending · WIP 유지**',
      c.ids.humanReviewPending.includes(curReviewId) && c.personaWipIds.includes(curReviewId))
    check('🔴 🔴 **③ 지금 발행 가능 행 → publishableNow · WIP (기존 뜻)**',
      c.ids.publishableNow.includes(freshId) && c.personaWipIds.includes(freshId) && pub.runnable.includes(freshId),
      `runnable ${pub.runnable.join(',')}`)
    const humanBucket = STOCK_BUCKETS.find((b) => c.ids[b].includes(humanOldId))
    check('🔴 🔴 **④ 사람이 검토한 옛 계약 행 → selector 대상 · 불일치 칸 아님 · 배정 규칙이 정한 칸(WIP)**',
      pub.loaded.targets.some((t) => t.id === humanOldId) && humanBucket !== 'qualityContractMismatch'
      && humanBucket !== undefined && STOCK_BUCKET_META[humanBucket].wip && c.personaWipIds.includes(humanOldId),
      String(humanBucket))
  }

  console.log('\n⑤ 🔴 옛 계약 자동 도장 행 — 자동 READY 가 열려 있어도 selector 가 내지 않는다')
  {
    const open = await publisherView(prisma, E, true)
    check('대조 — 지금 계약 자동 도장 행은 열리면 selector 대상이다(열림을 실제로 흉내 냈다)',
      open.loaded.targets.some((t) => t.id === curAutoId))
    check('🔴 🔴 **옛 계약 자동 도장 행 → QUALITY_CONTRACT_MISMATCH · 대상 0 · 발행 줄에 없다**',
      oldAutoIds.every((id) => open.loaded.rejected.some((r) => r.id === id && r.code === 'QUALITY_CONTRACT_MISMATCH'))
      && !oldAutoIds.some((id) => open.loaded.targets.some((t) => t.id === id) || open.plan.freshOrdered.some((t) => t.id === id)
        || open.runnable.includes(id) || open.plan.nextPickedId === id))
    check('🔴 열림에서도 46건은 대상이 아니다', !oldIds.some((id) => open.loaded.targets.some((t) => t.id === id)))
    check('🔴 🔴 **닫혀 있을 때도 옛 도장 행은 autoReadyClosed(WIP)로 숨지 않는다 → 불일치 칸 · WIP 아님**',
      oldAutoIds.every((id) => c.ids.qualityContractMismatch.includes(id) && !c.personaWipIds.includes(id))
      && c.ids.autoReadyClosed.includes(curAutoId) && c.personaWipIds.includes(curAutoId))
  }

  console.log('\n⑦ 공급 분류 = 발행 러너 경로 분류')
  {
    const sup = await snapshot(prisma, SAFEST_STOCK_LIMITS, { env: E, now: NOW })
    check('공급 snapshot 이 분류를 읽었다', sup.classification !== null, sup.classifyError ?? '')
    check('🔴 🔴 **공급 분류 = 발행 러너 경로 분류 (칸마다 같은 id · 새 칸 포함)**',
      sup.classification !== null && STOCK_BUCKETS.every((b) => same(sup.classification!.ids[b], c.ids[b])))
    const shared = await loadStockClassification(prisma, E, NOW)
    check('공용 로더도 같은 답이다', STOCK_BUCKETS.every((b) => same(shared.classification.ids[b], c.ids[b])))
    const total = STOCK_BUCKETS.reduce((n, b) => n + c.counts[b], 0)
    const all = STOCK_BUCKETS.flatMap((b) => c.ids[b])
    check('🔴 칸은 겹치지 않고 빠지지 않는다 — 합 = 대기열 전체', total === c.queueTotal && new Set(all).size === all.length,
      `합 ${total} · 대기열 ${c.queueTotal}`)
  }

  console.log('\n⑨ 회귀 — TTL · profile · gate')
  check('🔴 TTL 만료 → ttlExpired · WIP 아님', c.ids.ttlExpired.includes(ttlId) && !c.personaWipIds.includes(ttlId))
  check('profile 불일치 · gate 탈락 칸 그대로', c.ids.profileMismatch.includes(legacyId) && c.ids.gateBlocked.includes(gateId))

  console.log('\n🔴 실제 공급 러너 함수(`buildSpeakerLoad`) — Persona 별 WIP 전후')
  const loadAfter = await buildSpeakerLoad(prisma, 'wc-after', { env: E, now: NOW, scale })
  {
    const rows = SPEAKERS.map((code) => {
      const b = loadBefore.byCode[code]!; const a = loadAfter.byCode[code]!
      return { code, open: a.openDays, before: b.readyCount, after: a.readyCount,
        leftBefore: remainingCapacity({ code, ...b }), leftAfter: remainingCapacity({ code, ...a }) }
    })
    for (const r of rows) {
      console.log(`     ${r.code}  열린날 ${r.open} · WIP ${r.before} → ${r.after} · 남은 자리 ${r.leftBefore} → ${r.leftAfter}`)
    }
    const sum = (k: 'before' | 'after' | 'leftBefore' | 'leftAfter') => rows.reduce((n, r) => n + r[k], 0)
    console.log(`     합계  WIP ${sum('before')} → ${sum('after')} · 남은 자리 ${sum('leftBefore')} → ${sum('leftAfter')}`)
    console.log(`     공급 러너 wip — 합 ${loadAfter.wip.total} · 검토 대기 ${loadAfter.wip.humanReviewPending}`
      + ` · 발행 가능 ${loadAfter.wip.publishableNow} · 옛 품질 계약(WIP 아님) ${loadAfter.wip.qualityContractMismatch}`)
    /** 🔴 옛 자동 도장 2건은 처음부터 옛 계약이다 — 전후 모두 WIP 가 아니므로 차이에 들지 않는다 */
    const expectDrop = (code: string) => oldIds.filter((id) => voiceOfOld.get(id) === code).length
    check('🔴 🔴 **Persona 별 WIP 가 정확히 그 화자의 옛 계약 행 수만큼 줄었다**',
      rows.every((r) => r.before - r.after === expectDrop(r.code)),
      rows.filter((r) => r.before - r.after !== expectDrop(r.code)).map((r) => `${r.code}:${r.before}→${r.after}`).join(' '))
    check('🔴 공급 러너 wip 에 옛 계약 수가 따로 적힌다(48) — WIP 합에는 들지 않는다',
      loadAfter.wip.qualityContractMismatch === 48 && loadAfter.wip.total === c.personaWipIds.length)
    check('🔴 지금 계약 검토 대기 화자(P17) · 사람 검토 옛 행 화자(P18)는 그 글을 계속 든다',
      loadAfter.byCode.P17!.readyCount >= 1 && loadAfter.byCode.P18!.readyCount >= 1)
  }

  console.log('\n⑧ 공급 눈금 capacity · 발행 눈금 release — 섞이지 않는다')
  {
    check('🔴 공급 계획 눈금 = capacity d10 · 파일에 release 눈금 d1 따로',
      loadAfter.planningStage === 'd10' && loadAfter.releaseStage === 'd1' && supplyPlanningProfile(scale).stage === 'd10')
    const open = Object.values(loadAfter.byCode).reduce((n, r) => n + r.openDays, 0)
    check('🔴 공급 지평 자리는 capacity 로 잰다 (≤ d10 × 7)', open > 0 && open <= PROFILES.d10.dailyTarget * 7, `열린 자리 ${open}`)
    check('🔴 🔴 **발행 상한은 release 그대로 — 공급 눈금이 발행으로 새지 않는다**',
      pub.resolved.dailyCap === pub.resolved.scale.releaseProfile.dailyTarget
      && RUNTIME_PROFILES[pub.resolved.scale.releaseStage].dailyTarget <= PROFILES.d1.dailyTarget,
      JSON.stringify({ stage: pub.resolved.scale.releaseStage, cap: pub.resolved.dailyCap }))
    check('🔴 계약 칸이 생겨도 열린 날(openDays)은 그대로다 — 분류는 WIP 만 바꾼다',
      SPEAKERS.every((code) => loadBefore.byCode[code]!.openDays === loadAfter.byCode[code]!.openDays))
  }

  console.log('\n⑥ 🔴 계약이 바뀐 상태로 읽기 경로를 전부 돌려도 DB 행 변경 0')
  {
    // 🔴 자동 도장 경로도 부른다 — 스위치 ON 이어도 증거가 없어 닫힌다(쓰기 0). 옛 행은 도장 대상도 아니다
    const ON = envOf('d1', 'd10', { [AUTO_READY_ENV]: 'on' })
    const st = await stampAutoReady(prisma, { queueId: oldIds[0]!, env: ON, now: NOW })
    const round = await stampRound(prisma, { env: ON, now: NOW })
    await publisherView(prisma, ON)
    await publisherView(prisma, envOf('d5', 'd10'), true)
    for (const rel of ['d1', 'd3', 'd5', 'd10'] as const) await loadStockClassification(prisma, envOf(rel, 'd10'), NOW)
    await snapshot(prisma, SAFEST_STOCK_LIMITS, { env: E, now: NOW })
    await buildSpeakerLoad(prisma, 'wc-again', { env: E, now: NOW, scale })
    check('자동 도장 경로 — 닫힘(stamped 0)', st.kind !== 'stamped' && (round.get('stamped') ?? 0) === 0,
      `${st.kind} · ${JSON.stringify([...round])}`)
    const snap1 = await fullSnapshot(prisma)
    check('🔴 🔴 **Queue · Post · Persona · ActivityLog · RawContent · Audit 행 전체가 그대로 (updatedAt 포함)**', snap0 === snap1)
    const counts1 = { q: await prisma.originalPostApprovalQueue.count(), post: await prisma.post.count() }
    check('🔴 Queue · Post 행 수 그대로', counts0.q === counts1.q && counts0.post === counts1.post,
      `${JSON.stringify(counts0)} → ${JSON.stringify(counts1)}`)
    const marksNow = await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: [...oldIds, ...oldAutoIds] } }, select: { gateResults: true } })
    check('🔴 옛 계약 표식을 고쳐 쓰지 않았다 (지금 계약으로 바뀐 행 0)', marksNow.every((r) => !isCurrentQualityContract(r.gateResults)))
  }

  console.log('\n⑩ 같은 원천 Queue/Post 중복 0')
  {
    const q = await prisma.originalPostApprovalQueue.findMany({
      select: { createdPostId: true, rawContent: { select: { sourceArticleId: true } } },
    })
    const bySource = new Map<string, number>()
    for (const r of q) bySource.set(r.rawContent.sourceArticleId ?? '', (bySource.get(r.rawContent.sourceArticleId ?? '') ?? 0) + 1)
    const posts = q.map((r) => r.createdPostId).filter((x): x is string => x !== null)
    check('🔴 같은 원천을 가진 Queue 행 0', [...bySource.values()].every((n) => n === 1))
    check('🔴 한 Post 를 두 Queue 행이 가리키는 경우 0', new Set(posts).size === posts.length)
  }

  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 전용 · 운영 DB 0 · 네트워크 0 · LLM 0\n')
  if (fail > 0) process.exit(1)
}

await main()
