#!/usr/bin/env tsx
/**
 * 🔴 **그 글이 나갈 날에 쓸 수 있는 사람에게만 초안을 준다 — 실행 검사 (격리 Postgres 전용)**
 *
 *   막는 사고 — 공급이 "내일 쓸 수 있으면 된다"로 화자를 골라 오늘 이미 쓴 사람이 오늘 자리 초안을 받았다.
 *               그 글은 그날 못 나가고(낼 글이 있는데 못 낸 틱의 98%) 다음 날 그 사람의 유일한 글이 된다.
 *
 *   실제 공급 러너 함수(`snapshot` · `buildSpeakerLoad` · `judgeJitDemand`)와 발행 계획(`planPublishBatch`) ·
 *   발행 러너(dry-run 자식 프로세스)를 격리 DB 위에서 돌려 잰다.
 *     ① 낮 회차 — 오늘 이미 쓴 사람은 오늘 자리 초안을 받지 않는다 · 쓸 사람이 모자라면 수요가 그만큼 준다
 *     ② 저녁 회차 — 내일 자리는 내일 쓸 수 있는 사람에게 · 이미 내일 자리로 쓰는 중인 사람은 다시 세지 않는다
 *     ③ 발행 러너 — 못 낸 이유를 사유별로 말한다(오늘 이미 씀 · 주간 상한) · "재고가 없어"라고 찍지 않는다
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** sentinel · localhost · 고정 DB 이름을 모두 요구하고 주소를 찍지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

import {
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'
import { CAPACITY_ENV, RELEASE_ENV, profileOf } from '../src/lib/scale-profile'
import { resolveScale } from '../src/lib/scale-runtime'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'
import { MACHINE_REVIEWED_BY } from '../src/lib/original-post-auto-publish'
import { judgeJitDemand } from '../src/lib/supply-process'
import { kstDateString } from '../src/lib/release-canary'
import { loadStockClassification } from './lib/publishable-stock.mjs'
import { snapshot, buildSpeakerLoad } from './supply-process.mjs'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { markedStageEnv } from './lib/stage-decision-fixture'
import { RUN_AT_ENV } from './lib/run-clock.mjs'

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

const HOUR = 3_600_000
const DAY = 24 * HOUR
const kst = (day: string, hm: string): Date => new Date(`${day}T${hm}:00+09:00`)
const TODAY = '2026-11-18'
const TOMORROW = '2026-11-19'
/** 낮 회차 17:15 · 운영 창이 끝난 뒤 23:55(마지막 틱 23:50 뒤 — 창은 하루 전체 · 2026-11-23) */
const NOON = kst(TODAY, '17:15')
const EVENING = kst(TODAY, '23:55')
/** 🔴 하루 20편 단계 — 오늘 16편이 나갔다. 17:15 에 남은 공개 기회는 4개(d20 슬롯 17~20번째) + 내일 첫 자리 */
const E = markedStageEnv({ [RELEASE_ENV]: 'd20', [CAPACITY_ENV]: 'd20' }, TODAY)
/**
 * 🔴 **17번째 d20 슬롯 — 16편이 나간 뒤 처음 도래하는 자리.** 시각은 정본(`profileOf('d20').slots`)에서 읽는다 —
 *    슬롯 표가 다시 계산돼도(2026-11-22 댓글 24시간 격자) 이 검사가 옛 시각에 묶이지 않는다.
 */
const NEXT_SLOT = profileOf('d20').slots[16]!
const NEXT_SLOT_AT = kst(TODAY, `${String(NEXT_SLOT.hour).padStart(2, '0')}:${String(NEXT_SLOT.minute).padStart(2, '0')}`)
if (NEXT_SLOT_AT.getTime() <= NOON.getTime()) throw new Error(`fixture — 17번째 d20 슬롯 ${NEXT_SLOT_AT.toISOString()} 이 낮 회차(17:15) 뒤가 아니다`)
const scale = resolveScale(E)

const machineGate = (voiceCode: string, at: Date, id: string) => ({
  holds: [], blocks: [],
  semanticReview: {
    complete: true, deterministicPass: true, unsupportedAdditions: 0,
    lifeContradictions: 0, droppedFromSource: 0, confidence: 1,
  },
  ...fakeEvidenceGate(at, { id }),
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    voice: { personaCode: voiceCode, bundleDigest: `bd-${voiceCode}`, comments: 3 },
  },
  [QUALITY_CONTRACT_KEY]: currentQualityContract(),
})

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 그 글이 나갈 날에 쓸 수 있는 사람에게만 초안을 준다 (격리 DB 전용 · 운영 DB 0) ══\n')
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
    + '"MicroSeedRawContent","Post","Persona","User" CASCADE',
  )

  let seq = 0
  const raw = async (site: string, capturedAt: Date) => {
    seq += 1
    return prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/sw${seq}`,
        sourceArticleId: `${7000 + seq}-sw`, sourceCapturedAt: capturedAt, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}`,
      },
      select: { id: true },
    })
  }
  const personaId = new Map<string, { personaId: string; userId: string }>()
  const persona = async (code: string): Promise<void> => {
    const u = await prisma.user.create({ data: { nickname: `자리${code}` }, select: { id: true } })
    const p = await prisma.persona.create({ data: { code, userId: u.id, status: 'active' }, select: { id: true } })
    personaId.set(code, { personaId: p.id, userId: u.id })
  }
  /** 그 사람이 `at` 에 글 한 편을 냈다 — 발행 트랜잭션이 남기는 세 행(Post · 큐 PUBLISHED+matchedAt · ActivityLog) */
  const published = async (code: string, at: Date): Promise<void> => {
    const who = personaId.get(code)!
    seq += 1
    const post = await prisma.post.create({
      data: { boardType: 'FREE', title: `지난 글 ${code} ${seq}`, content: `지난 본문 ${code}`, authorId: who.userId, createdAt: at },
      select: { id: true },
    })
    const r = await raw(`${AUTOFILL_SITE_PREFIX}fixture`, new Date(at.getTime() - DAY))
    await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: `지난 글 ${code} ${seq}`, draftBody: `지난 본문 ${code}`,
        gateVerdict: 'PASS', gateResults: {} as never, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
        decidedBy: 'founder', dedupKey: `sw-pub-${seq}`, createdPostId: post.id, matchedPersonaId: who.personaId, matchedAt: at,
      },
    })
    await prisma.personaActivityLog.create({
      data: { personaId: who.personaId, kind: 'post', targetId: post.id, gateStatus: 'PASS', decidedBy: 'operator', createdAt: at },
    })
  }
  /** 아직 안 나간 기계 초안 — `decidedBy` 가 기계면 자동 도장 대기(WIP), 사람 확인이면 발행 후보다 */
  const draft = async (voice: string, decidedBy: string, at: Date): Promise<string> => {
    const r = await raw(`${MACHINE_SITE_PREFIX}navercafe:t`, new Date(at.getTime() - 5 * HOUR))
    const n = seq
    return (await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `저녁 산책 이야기 ${n}`,
        draftBody: `저녁 먹고 동네를 한 바퀴 걸었어요 ${n}. 다들 요즘 저녁에 뭐 하세요?`,
        gateVerdict: 'PASS', gateResults: machineGate(voice, at, `sw-${n}`) as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy, dedupKey: `sw-${n}`,
      },
      select: { id: true },
    })).id
  }

  /**
   * ── 시드 — active Persona 20명 ──
   *    P01 · P02   오늘 아직 안 썼다
   *    P03         오늘 09:20 에 썼다
   *    P04         오늘 썼고, 아직 안 나간 초안 1편을 들고 있다(그 글이 내일 자리를 쓴다)
   *    P05         오늘 안 썼지만 아직 안 나간 초안 1편을 들고 있다(그 글이 오늘 자리를 쓴다)
   *    P06         최근 7일에 5편 — 주간 상한
   *    F01~F14     오늘 한 편씩 썼다
   */
  const FILLERS = Array.from({ length: 14 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`)
  for (const code of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', ...FILLERS]) await persona(code)
  await published('P03', kst(TODAY, '09:20'))
  await published('P04', kst(TODAY, '10:00'))
  for (const [i, code] of FILLERS.entries()) await published(code, new Date(kst(TODAY, '08:00').getTime() + i * 40 * 60_000))
  for (const d of [1, 2, 3, 4, 5]) await published('P06', new Date(kst(TODAY, '10:00').getTime() - d * DAY))
  await draft('P04', 'machine:auto-draft-v5', NOON)
  await draft('P05', 'machine:auto-draft-v5', NOON)

  const poolOf = (load: Awaited<ReturnType<typeof buildSpeakerLoad>>): string[] =>
    Object.entries(load.byCode).filter(([, r]) => (r.attemptCapacity ?? 0) > 0).map(([c]) => c).sort()

  // ─────────────────────────────────────────────────────────
  console.log('① 낮 회차(17:15) — 오늘 빈 자리 4개 + 내일 첫 자리 1개')
  // ─────────────────────────────────────────────────────────
  {
    const snap = await snapshot(prisma, { env: E, now: NOON })
    const jit = snap.jit
    check('fixture — 오늘 16편 발행 · 지평 5자리(오늘 4 + 내일 1) · 덮은 READY 0', jit !== null && jit.publishedToday === 16
      && jit.slots === 5 && jit.readyFilled === 0
      && jit.horizon.filter((d) => kstDateString(d) === TODAY).length === 4, JSON.stringify({ ...jit, horizon: jit?.horizon.map((d) => d.toISOString()) }))
    check('🔴 🔴 **쓸 사람이 모자라면 수요가 그만큼 준다** — 빈 자리 5개 중 오늘 쓸 수 있는 2명 몫만 산다',
      jit !== null && jit.fillable.length === 2 && jit.fillable.every((d) => kstDateString(d) === TODAY),
      String(jit?.fillable.length))
    const policy = judgeJitDemand(jit === null ? null : { slots: jit.slots, readyFilled: jit.readyFilled, writable: jit.fillable.length })
    check('🔴 수요 판정(`judgeJitDemand`)의 적재 상한이 2 다 — 앞판은 5 였다', policy.llm && policy.upTo === 2, policy.reason)
    check('날짜별 산수가 기록된다 — 오늘 빈 자리 4 · 쓸 사람 2 · 채움 2 / 내일 빈 자리 1 · 그날부터 16명 · 채움 0',
      JSON.stringify(jit?.writersByDate) === JSON.stringify([
        { date: TODAY, unfilled: 4, writers: 2, fill: 2 }, { date: TOMORROW, unfilled: 1, writers: 16, fill: 0 },
      ]), JSON.stringify(jit?.writersByDate))

    const load = await buildSpeakerLoad(prisma, 'sw-noon', { env: E, now: NOON, scale })
    check('🔴 🔴 **오늘 이미 쓴 사람은 오늘 자리 초안을 받지 않는다** — 시도 여력은 P01 · P02 뿐',
      JSON.stringify(poolOf(load)) === JSON.stringify(['P01', 'P02']), poolOf(load).join(','))
    check('🔴 오늘 쓴 16명(P03 · P04 · F01~F14) 전원 시도 여력 0 — 앞판은 내일 한 칸 때문에 1 이었다',
      ['P03', 'P04', ...FILLERS].every((c) => load.byCode[c]!.attemptCapacity === 0))
    check('🔴 초안을 들고 있는 사람(P05)은 그 글이 오늘 자리를 쓴다 — 오늘 자리 초안을 또 받지 않는다',
      load.byCode.P05!.attemptCapacity === 0 && load.byCode.P05!.readyCount === 1)
    check('주간 상한에 걸린 사람(P06)은 지평 안에 쓸 날이 없다', load.byCode.P06!.attemptCapacity === 0)
    check('수요 판정과 여력 파일이 같은 답이다 — 채울 자리 2', load.seats.fillable.length === 2
      && JSON.stringify(load.seats.byDate) === JSON.stringify(jit?.writersByDate))
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n② 운영 창이 끝난 뒤(23:55) — 오늘 회수 기회 0 · 지평은 내일 첫 자리 하나')
  // ─────────────────────────────────────────────────────────
  {
    const snap = await snapshot(prisma, { env: E, now: EVENING })
    const jit = snap.jit
    check('fixture — 지평 1자리(내일 첫 자리) · 빈 자리 1', jit !== null && jit.slots === 1 && jit.unfilled.length === 1
      && kstDateString(jit.horizon[0]!) === TOMORROW, JSON.stringify(jit?.horizon.map((d) => d.toISOString())))
    check('수요 1 — 내일 자리 하나만 산다', jit !== null && jit.fillable.length === 1
      && judgeJitDemand({ slots: jit.slots, readyFilled: jit.readyFilled, writable: jit.fillable.length }).upTo === 1)
    const load = await buildSpeakerLoad(prisma, 'sw-evening', { env: E, now: EVENING, scale })
    const pool = poolOf(load)
    check('🔴 🔴 **내일 자리는 내일 쓸 수 있는 사람에게** — 오늘 쓴 사람(P03 · F01~F14)도 내일은 쓸 수 있다',
      ['P01', 'P02', 'P03', ...FILLERS].every((c) => pool.includes(c)), pool.join(','))
    check('🔴 🔴 **이미 내일 자리로 쓰는 중인 사람은 다시 세지 않는다** — 초안을 들고 있는 P04 · P05 는 빠진다',
      !pool.includes('P04') && !pool.includes('P05'), pool.join(','))
    check('주간 상한(P06)은 내일도 못 쓴다 — 풀은 17명', !pool.includes('P06') && pool.length === 17, String(pool.length))
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n③ 발행 러너 — 못 낸 이유를 사유별로 말한다')
  // ─────────────────────────────────────────────────────────
  {
    /** 사람이 확인한 기계 글 두 편 — 쓴 사람은 오늘 이미 쓴 P03 · 주간 상한인 P06. 슬롯 자격은 있고 배정만 안 된다 */
    const tooSoonId = await draft('P03', MACHINE_REVIEWED_BY, NOON)
    const weeklyId = await draft('P06', MACHINE_REVIEWED_BY, NOON)
    const view = await loadStockClassification(prisma, E, NOON)
    const un = new Map(view.plan.unassigned.map((u) => [u.id, u]))
    check('fixture — 두 글 모두 슬롯 자격은 통과했다(재고는 있다) · 이번에 나갈 글은 없다',
      view.plan.prepared.auto.length === 2 && view.plan.picked === null, `자격 ${view.plan.prepared.auto.length}`)
    check('🔴 🔴 **오늘 이미 쓴 사람의 글 → TOO_SOON** (앞판 문구: "생활사 조건에 맞는 persona 가 없다")',
      JSON.stringify(un.get(tooSoonId)?.codes) === JSON.stringify(['TOO_SOON']) && un.get(tooSoonId)?.author === 'P03',
      JSON.stringify(un.get(tooSoonId)))
    check('🔴 🔴 **주간 상한인 사람의 글 → WEEKLY_CAP**',
      (un.get(weeklyId)?.codes ?? []).includes('WEEKLY_CAP') && un.get(weeklyId)?.author === 'P06', JSON.stringify(un.get(weeklyId)))

    /** 실제 러너를 dry-run 으로 띄운다 — DB write 0 · 로그만 읽는다 */
    const r = spawnSync(join(process.cwd(), 'node_modules', '.bin', 'tsx'), ['scripts/original-post-auto-publish.mts', '--trigger=local'], {
      env: { ...process.env, ...E, [RUN_AT_ENV]: NEXT_SLOT_AT.toISOString() }, encoding: 'utf-8',
    })
    const out = `${r.stdout}\n${r.stderr}`
    const unfilled = /SLOT_UNFILLED (\{.*\})/.exec(out)
    const held = unfilled === null ? null : (JSON.parse(unfilled[1]!) as { held: Record<string, number>; eligible: number }).held
    check('러너가 끝까지 돌았다(dry-run · exit 0) · 슬롯이 왔는데 못 냈다', r.status === 0 && unfilled !== null, out.slice(-600))
    check('🔴 🔴 **`SLOT_UNFILLED.held` 가 실제 보류 사유별 건수를 담는다** — TOO_SOON 1 · WEEKLY_CAP 1',
      held !== null && held.TOO_SOON === 1 && held.WEEKLY_CAP === 1, JSON.stringify(held))
    check('🔴 로그가 쓴 사람과 사유를 말한다 — "생활사 조건에 맞는 persona 가 없다"는 더 찍히지 않는다',
      out.includes('쓴 사람 P03 — TOO_SOON') && out.includes('쓴 사람 P06 — WEEKLY_CAP') && !out.includes('생활사 조건에 맞는 persona 가 없다'))
    check('🔴 재고가 있는 틱에 "재고가 없어 더 내지 않는다"고 찍지 않는다 — 글 2편 · 쓴 사람이 지금 못 쓴다',
      !out.includes('재고가 없어') && out.includes('낼 글 2편이 있지만 쓴 사람이 지금 못 써서'))
    const posts = await prisma.post.count()
    check('dry-run — 글이 늘지 않았다', posts === 16 + 5, String(posts))
  }

  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
