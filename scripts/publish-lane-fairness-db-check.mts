#!/usr/bin/env tsx
/**
 * 🔴 **발행 lane 관측 — 실제 로더 · 계획 · 발행 트랜잭션** (2026-10-19 fresh-first · 격리 Postgres 전용)
 *
 *   사람 승인 재고(human lane)와 자동 도장 행(auto lane)이 함께 기다려도 lane 이력은 순위를 바꾸지 않는다.
 *     · 실제 원문 시각 최신순 하나가 선택한다
 *     · recovery/lane 은 관측값일 뿐 우선권이 아니다
 *     · 상한 · 슬롯 · 트랜잭션 재검증은 그대로다
 *
 *   🔴 운영 DB 에 절대 붙이지 않는다 — sentinel · localhost · 고정 DB 이름을 요구한다. provider 0.
 */
import { PrismaClient } from '@prisma/client'
import {
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'
import { CAPACITY_ENV, RELEASE_ENV, type ReleaseStage } from '../src/lib/scale-profile'
import { authoritativeGate } from '../src/lib/auto-ready-repo'
import { AUTO_DECIDER, AUTO_READY_ENV, AUTO_READY_RECORD_KEY, makeStamp } from '../src/lib/auto-ready-v2'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { planStore } from '../src/lib/original-post-match-store'
import { loadPublishableStock, resolvePublishScale, planPublishBatch, laneOf } from './lib/publishable-stock.mjs'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
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
const NOW = new Date()
const DAY = 864e5
const envOf = (release: ReleaseStage): Record<string, string> =>
  markedStageEnv({ [RELEASE_ENV]: release, [CAPACITY_ENV]: 'd10', [AUTO_READY_ENV]: 'on' })

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
  let seq = 0
  const raw = async (site: string, capturedAt: Date) => {
    seq += 1
    return prisma.microSeedRawContent.create({
      data: { origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/lf${seq}`, sourceArticleId: `${7000 + seq}-lf`,
        sourceCapturedAt: capturedAt, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}` },
      select: { id: true },
    })
  }
  const CODES = Array.from({ length: 8 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
  for (const code of CODES) {
    const u = await prisma.user.create({ data: { nickname: `lane${code}` }, select: { id: true } })
    await prisma.persona.create({ data: { code, userId: u.id, status: 'active' } })
  }
  const human = async (daysAgo: number) => {
    const r = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, new Date(NOW.getTime() - daysAgo * DAY))
    return (await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `가을 이불 꺼낸 날 ${seq}`,
        draftBody: `가을 이불을 꺼내 햇볕에 말렸어요 ${seq}. 다들 이불 바꾸셨어요?`, gateVerdict: 'PASS',
        gateResults: fakeEvidenceGate(NOW, { id: `lf-h-${seq}`, ageH: 48 + daysAgo }) as never,
        promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL, decidedBy: 'founder', dedupKey: `lf-h-${seq}` },
      select: { id: true },
    })).id
  }
  /** 자동 행에 이미 쓴 말투 Persona — 새 자동 행은 이 값을 다시 쓰지 않는다 */
  const usedVoices = new Set<string>()
  const auto = async (voice: string, daysAgo: number) => {
    usedVoices.add(voice)
    const r = await raw(`${MACHINE_SITE_PREFIX}navercafe:t`, new Date(NOW.getTime() - daysAgo * DAY))
    const title = `저녁 산책 이야기 ${seq}`
    const body = `저녁 먹고 동네를 한 바퀴 걸었어요 ${seq}. 다들 요즘 저녁에 뭐 하세요?`
    return (await prisma.originalPostApprovalQueue.create({
      data: { sourceRawContentId: r.id, status: 'APPROVED', draftTitle: title, draftBody: body, gateVerdict: 'PASS',
        gateResults: { holds: [], blocks: [], ...fakeEvidenceGate(NOW, { id: `lf-a-${seq}`, ageH: daysAgo * 24 }),
          semanticReview: { complete: true, deterministicPass: true, unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9 },
          autoDraft: { provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
          draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion, voice: { personaCode: voice, bundleDigest: `bd-${voice}`, comments: 3 } },
          [QUALITY_CONTRACT_KEY]: currentQualityContract() } as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy: AUTO_DECIDER, dedupKey: `lf-a-${seq}`,
        editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(title, body, NOW) } as never },
      select: { id: true },
    })).id
  }
  // 사람 승인 재고 6건(오래 기다림) · 자동 도장 3건(새로 옴) — 운영 모양(22 대 소수)
  const H = [await human(6), await human(5.5), await human(5), await human(4.5), await human(4), await human(3.5)]
  const A = [await auto('P01', 1), await auto('P02', 0.8), await auto('P03', 0.6)]

  /**
   * 🔴 **뒤에 만드는 자동 행의 말투 Persona 는 아직 아무 글도 배정받지 않은 Persona 로 고른다** (2026-09-29).
   *    ② 의 사람 행은 `planStore` 의 가중 무작위(seed = 큐 id · cuid 라 회차마다 다르다)로 Persona 를 받는다.
   *    말투를 'P04' 로 박아 두면 약 30% 회차에서 사람 행이 P04 를 먼저 가져가고, 자동 행은
   *    WEEKLY_CAP · TOO_SOON 으로 배정이 막혀 ⑤ · ⑥ 이 lane 판정과 무관하게 빨개졌다(재현 9/30).
   *    제품 동작은 그대로다 — 막힌 자동 행을 빼는 것은 정상이고, 이 검사가 보려는 것은 lane 차례다.
   */
  const freeVoice = async (): Promise<string> => {
    const taken = new Set<string>(usedVoices)
    const logged = await prisma.personaActivityLog.findMany({ where: { kind: 'post' }, select: { persona: { select: { code: true } } } })
    for (const l of logged) taken.add(l.persona.code)
    const matched = await prisma.originalPostApprovalQueue.findMany({ where: { matchedPersonaId: { not: null } }, select: { matchedPersona: { select: { code: true } } } })
    for (const m of matched) if (m.matchedPersona !== null) taken.add(m.matchedPersona.code)
    const code = CODES.find((c) => !taken.has(c))
    if (code === undefined) throw new Error('fixture — 비어 있는 Persona 가 없다')
    return code
  }

  const view = async (release: ReleaseStage) => {
    const E = envOf(release)
    const gate = await authoritativeGate(prisma, E)
    const loaded = await loadPublishableStock(prisma, NOW, { autoReadyOpen: gate.open })
    const resolved = resolvePublishScale({ env: E, loaded, now: NOW })
    return { E, gate, loaded, plan: planPublishBatch({ loaded, caps: resolved.caps, at: NOW }) }
  }
  let publishSeq = 0
  /** 🔴 러너와 같은 순서 — 사람 행은 배정 먼저 쓰고, 자동 행은 배정 계획을 트랜잭션에 넘긴다 */
  const publish = async (v: Awaited<ReturnType<typeof view>>, id: string) => {
    // 트랜잭션 시계를 회차마다 1초씩 떨어뜨린다 — ActivityLog(슬롯 · Persona 이력) 시각이 겹치지 않게.
    // 🔴 lane 차례는 Post.createdAt(@default(now()) · 벽시계)으로 정한다 — 이 값의 영향을 받지 않는다.
    const txNow = new Date(NOW.getTime() - 60_000 + publishSeq * 1000)
    publishSeq += 1
    const t = v.loaded.targets.find((x) => x.id === id)!
    const a = v.plan.assignOf.get(id)
    const plan = planStore({ status: t.status as never, createdPostId: null, seed: id,
      assigned: a?.assigned ?? null, eligible: a?.eligible ?? [], top: a?.top ?? [], blockedCount: a?.blocked.length ?? 0 })
    if (!plan.ok) return { kind: 'noPlan' as const }
    const persona = await prisma.persona.findUniqueOrThrow({ where: { code: plan.personaCode }, select: { id: true } })
    const isAuto = laneOf(t.decidedBy) === 'auto'
    if (!isAuto) {
      await prisma.originalPostApprovalQueue.updateMany({ where: { id, matchedPersonaId: null }, data: { matchedPersonaId: persona.id, matchedAt: new Date(), matchMeta: plan.meta as never } })
    }
    const today = await prisma.post.count()
    return publishOriginalPostTx(prisma, { queueId: id, publishedToday: today, mode: { kind: 'manual-live', dailyCap: 100 },
      autoReadyEnv: v.E, ...(isAuto ? { autoAssign: { personaId: persona.id, matchMeta: plan.meta } } : {}) },
    { now: () => txNow })
  }

  console.log('\n── ① 두 lane 대기 → lane 이력과 무관하게 최신 원천이 먼저 ──')
  const v0 = await view('d1')
  check('게이트 열림(v4 · 창업자 gold)', v0.gate.open, v0.gate.reasons.join(' · '))
  check('🔴 🔴 **picked = 최신 원천(auto)**', v0.plan.picked !== null && laneOf(v0.plan.picked.decidedBy) === 'auto', String(v0.plan.picked?.id))
  {
    // 🔴 과거 lane 이력 필드를 주입할 자리가 없다. 같은 입력은 같은 최신 원천을 고른다.
    const E = envOf('d1')
    const same = planPublishBatch({ loaded: { ...v0.loaded },
      caps: resolvePublishScale({ env: E, loaded: v0.loaded, now: NOW }).caps, at: NOW })
    check('🔴 lane 우선 입력 없이 결정적 순서가 같다',
      v0.plan.freshOrdered.map((x) => x.id).join(',') === same.freshOrdered.map((x) => x.id).join(',')
      && v0.plan.picked?.id === same.picked?.id)
  }

  console.log('\n── ② 순차 발행 — 최신 auto 3건 뒤 다음 최신 human ──')
  const lanes: string[] = []
  for (let k = 0; k < 4; k += 1) {
    const v = await view('d3')
    const id = v.plan.picked?.id
    if (id === undefined) { lanes.push('none'); continue }
    const r = await publish(v, id)
    lanes.push(`${laneOf(v.loaded.targets.find((x) => x.id === id)!.decidedBy)}:${r.kind}`)
  }
  check('🔴 🔴 **auto → auto → auto → human · 전부 발행**',
    lanes.join(',') === 'auto:published,auto:published,auto:published,human:published', lanes.join(','))

  console.log('\n── ③ 낡은 도장 행(도장 뒤 본문 변경)은 selector 가 거절 — 다른 행은 계속 나간다 ──')
  // 앞 절에서 초기 auto 3건을 모두 냈으므로, 새 자동 행 하나를 만들어 도장 뒤 본문 변경 반례로 쓴다.
  const staleAuto = await auto(await freeVoice(), 0.55)
  // 🔴 아직 나가지 않은 자동 행 전부 — 도장 뒤 본문이 바뀌었다(발행된 행은 건드리지 않는다)
  const leftAuto = [staleAuto]
  for (const id of leftAuto) await prisma.originalPostApprovalQueue.update({ where: { id }, data: { draftBody: '도장 뒤에 바뀐 본문' } })
  const v3 = await view('d3')
  check('낡은 자동 행은 발행 대상 밖(AUTO_READY_STALE)', leftAuto.length > 0
    && leftAuto.every((id) => v3.loaded.rejected.some((x) => x.id === id && x.code === 'AUTO_READY_STALE')),
  JSON.stringify({ leftAuto, rejected: v3.loaded.rejected.filter((x) => leftAuto.includes(x.id)) }))
  const autoLeft = v3.loaded.targets.filter((t) => laneOf(t.decidedBy) === 'auto').length
  check('🔴 auto lane 이 비면(유효 행 0) human lane 이 그대로 나간다 — 멈추지 않는다',
    autoLeft === 0 && v3.plan.picked !== null && laneOf(v3.plan.picked.decidedBy) === 'human', `${autoLeft} · ${String(v3.plan.picked?.id)}`)

  console.log('\n── ④ 한 lane 만 있을 때 기존 순서 그대로 ──')
  check('🔴 사람 행만 → 기존 순서의 첫 행(lane 선호 없음)', v3.plan.picked?.id === v3.plan.freshOrdered.find((t) => v3.plan.assignOf.get(t.id)?.assigned != null)?.id)

  console.log('\n── ⑤ 동시 두 발행 — 같은 대상은 정확히 한 번 ──')
  const A4 = await auto(await freeVoice(), 0.5)
  const v5 = await view('d3')
  // 🔴 fixture 전제 — 이것이 깨지면 아래 lane 판정은 배정 실패를 lane 실패로 잘못 보고한다
  check('fixture 전제 — 새 자동 행(⑤)은 배정 가능', v5.plan.assignOf.get(A4)?.assigned != null,
    JSON.stringify(v5.plan.assignOf.get(A4)?.blocked.map((b) => `${b.code}:${b.reasons.map((x) => x.code).join('+')}`)))
  check('d3 · 새 auto 원천이 가장 신선해 먼저', v5.plan.picked?.id === A4, String(v5.plan.picked?.id))
  const [r1, r2] = await Promise.all([publish(v5, A4), publish(v5, A4)])
  const n = await prisma.post.count({ where: { id: { in: [r1, r2].filter((x): x is Extract<typeof x, { kind: 'published' }> => x.kind === 'published').map((x) => x.postId) } } })
  check('🔴 🔴 **동시 두 트랜잭션 — 발행 1 · 나머지는 정상 무발행**', [r1.kind, r2.kind].filter((k) => k === 'published').length === 1 && n === 1,
    `${r1.kind} / ${r2.kind}`)
  const logs = await prisma.personaActivityLog.count({ where: { kind: 'post' } })
  check('ActivityLog = 발행된 글 수(중복 0)', logs === await prisma.post.count(), `${logs}`)

  console.log('\n── ⑥ d1 — 직전 lane 이 아니라 새 원천 시각이 결정 ──')
  const A5 = await auto(await freeVoice(), 0.4)
  await prisma.originalPostApprovalQueue.update({ where: { id: H[2]! }, data: {} })
  const lastAuto = await prisma.post.findFirst({ where: { id: { in: (await prisma.originalPostApprovalQueue.findMany({ where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } }, select: { createdPostId: true } })).map((x) => x.createdPostId!) } }, orderBy: { createdAt: 'desc' } })
  check('직전 발행은 auto(⑤)', lastAuto !== null)
  const v6 = await view('d1')
  check('🔴 d1 · 마지막 lane 과 무관하게 최신 auto', v6.plan.picked?.id === A5 && laneOf(v6.plan.picked.decidedBy) === 'auto', String(v6.plan.picked?.id))
  void A5

  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  if (fail > 0) process.exit(1)
}
await main()
