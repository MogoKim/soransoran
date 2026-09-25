#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY — 실제 러너 사슬 검사 (격리 Postgres 전용)** (2026-09-25)
 *
 *   마스터 재리뷰 P0: 기존 배정 자동 행이 발행 트랜잭션에서 `AUTO_ASSIGN_STALE` 가 되면
 *   복구 우선 선택 + 러너 exit 때문에 **같은 행이 매 회차 선두를 차지해 뒤의 정상 행을 굶긴다.**
 *
 *   이 검사는 함수가 아니라 **러너 프로세스 자체**(`original-post-auto-publish.mts --apply`)를
 *   두 회차 연속으로 띄워 본다. 반례 둘:
 *     A. 첫 행 — 기존 배정 뒤 Persona 생활사가 바뀌었다(기혼 → 미혼, 글은 "남편이…")
 *     B. 첫 행 — 기존 배정 Persona 가 이번 주 다른 글을 이미 받았다(주 상한 소진)
 *   둘째 행 — 정상 자동 READY 행. 🔴 첫 행은 발행·재배정되지 않고, 둘째 행은 발행돼야 한다.
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** sentinel · localhost · 고정 DB 이름을 모두 요구하고,
 *    러너 자식 프로세스에는 **격리 DB 주소만 담은 env 를 새로 만들어** 넘긴다(부모 env 상속 없음).
 * 🔴 **시각에 묶인다.** 러너는 진짜 시계로 슬롯을 판정한다 — d1 슬롯(09:30 KST)이 도래했고
 *    운영 창(22:00 KST) 안일 때만 발행 경로를 탄다. 그 밖이면 **미관측**으로 실패한다(통과로 세지 않는다).
 *    그래서 CI 에 넣지 않고 수동으로 돈다.
 *
 *   npm run auto-ready:runner-check
 */
import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

import { AUTO_DECIDER, HUMAN_DECIDER, AUTO_READY_RECORD_KEY, makeStamp } from '../src/lib/auto-ready-v2'
import {
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'

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

const NOW = new Date()
const CAP = new Date(NOW.getTime() - 2 * 864e5)
const SR = { complete: true, deterministicPass: true, unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9 }
const gate = (voiceCode: string | null) => ({
  holds: [], blocks: [], semanticReview: SR,
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    ...(voiceCode === null ? {} : { voice: { personaCode: voiceCode, bundleDigest: `bd-${voiceCode}`, comments: 3 } }),
  },
})

/** 🔴 러너 자식 프로세스 — 격리 DB 주소와 스위치만 담은 새 env. 부모 env 를 상속하지 않는다 */
function runRunner(): { code: number; out: string } {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
    DATABASE_URL: URL, DIRECT_URL: URL, SORAN_AUTO_READY_ENABLED: 'on',
  }
  const r = spawnSync('npx', ['tsx', 'scripts/original-post-auto-publish.mts', '--apply', '--limit=1', '--trigger=local'],
    { env, encoding: 'utf-8', timeout: 300_000 })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY — 실제 러너 사슬 (격리 DB 전용 · 운영 DB 0) ══\n')
  const wipe = () => prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
    + '"MicroSeedRawContent","Post","Persona","User","PersonaGlobalSwitch" CASCADE',
  )
  let seq = 0
  const raw = async () => {
    seq += 1
    return prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:t`, sourceUrl: `https://example.invalid/r${seq}`,
        sourceArticleId: `${5000 + seq}-r`, sourceCapturedAt: CAP, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}`,
      },
      select: { id: true },
    })
  }
  const persona = async (code: string, identity: Record<string, unknown> = {}) => {
    const u = await prisma.user.create({ data: { nickname: `사슬${code}` }, select: { id: true } })
    return prisma.persona.create({ data: { code, userId: u.id, status: 'active', identity: identity as never }, select: { id: true, code: true } })
  }
  /** 🔴 증거 30건 — 실제 글을 가리킨다(createdPostId FK) */
  const seedEvidence = async () => {
    const author = (await prisma.user.create({ data: { nickname: '증거' }, select: { id: true } })).id
    for (let i = 0; i < 30; i += 1) {
      const r = await raw()
      const p = await prisma.post.create({ data: { boardType: 'FREE', title: `사람이 본 글 ${i}`, content: `사람이 본 본문 ${i}`, authorId: author }, select: { id: true } })
      await prisma.originalPostApprovalQueue.create({
        data: {
          sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: `사람이 본 글 ${i}`, draftBody: `사람이 본 본문 ${i}`,
          gateVerdict: 'PASS', gateResults: gate(null) as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
          decidedBy: HUMAN_DECIDER, createdPostId: p.id, dedupKey: `ev-${seq}`,
        },
      })
    }
  }
  /** 🔴 자동 도장까지 찍힌 기존 배정 행 — 도장은 러너가 아니라 여기서 찍는다(러너 도장 회차와 같은 모양) */
  const autoRow = async (p: { id: string; code: string }, body: string, createdAt: Date) => {
    const r = await raw()
    const title = `평범한 하루 이야기 ${seq}`
    return prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: title, draftBody: body,
        gateVerdict: 'PASS', gateResults: gate(p.code) as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: AUTO_DECIDER, decidedAt: createdAt, dedupKey: `row-${seq}`,
        matchedPersonaId: p.id, matchedAt: createdAt, createdAt,
        editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(title, body, createdAt) } as never,
      },
      select: { id: true },
    })
  }

  for (const scenario of ['A 생활사 충돌', 'B 주 상한 소진'] as const) {
    console.log(`\n── 반례 ${scenario} ──`)
    await wipe()
    await seedEvidence()
    const older = new Date(NOW.getTime() - 3 * 3600e3)
    const newer = new Date(NOW.getTime() - 2 * 3600e3)
    let first: { id: string }
    let firstPersona: { id: string; code: string }
    if (scenario === 'A 생활사 충돌') {
      firstPersona = await persona('PA1', { maritalStatus: '기혼' })
      first = await autoRow(firstPersona, '남편이 요즘 퇴근이 늦어요. 다들 어떻게 지내세요?', older)
      // 🔴 배정 뒤 생활사가 바뀌었다
      await prisma.persona.update({ where: { id: firstPersona.id }, data: { identity: { maritalStatus: '미혼' } as never } })
    } else {
      firstPersona = await persona('PB1')
      first = await autoRow(firstPersona, '아침에 산책을 다녀왔어요. 다들 어떻게 지내세요?', older)
      // 🔴 같은 Persona 가 이번 주 다른 글을 이미 받았다 (d1 · 주 1)
      const other = await raw()
      await prisma.originalPostApprovalQueue.create({
        data: {
          sourceRawContentId: other.id, status: 'EXPIRED', draftTitle: '지난 글', draftBody: '지난 글 본문',
          gateVerdict: 'PASS', gateResults: gate(firstPersona.code) as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
          decidedBy: 'machine:auto-draft-v5', dedupKey: `other-${seq}`,
          matchedPersonaId: firstPersona.id, matchedAt: new Date(NOW.getTime() - 6 * 864e5),
        },
      })
    }
    const goodPersona = await persona(scenario.startsWith('A') ? 'PA2' : 'PB2')
    const second = await autoRow(goodPersona, '오늘 시장에서 호박을 샀어요. 다들 어떻게 지내세요?', newer)
    const before1 = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: first.id } })

    const r1 = runRunner()
    const r2 = runRunner()
    const tail = (o: string) => o.split('\n').filter((l) => /🔴 중단|발행하지 않는다|✅ Post|AUTO_ASSIGN|유예|예외|🎯/.test(l)).slice(0, 6).join(' ⏎ ')
    console.log(`   회차 1 exit ${r1.code} · ${tail(r1.out)}`)
    console.log(`   회차 2 exit ${r2.code} · ${tail(r2.out)}`)
    const observed = !/운영 창|도래한 슬롯이 없|트리거가/.test(r1.out)
    check(`[${scenario}] 발행 경로를 실제로 탔다 (슬롯·운영 창 안) — 밖이면 미관측`, observed, observed ? '' : '시각 밖 — 미관측')

    const f = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: first.id } })
    const s = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: second.id } })
    check(`🔴 🔴 **[${scenario}] 첫 행은 발행되지 않았다**`, f.createdPostId === null && f.status === 'APPROVED', `${f.status} · ${String(f.createdPostId)}`)
    check(`🔴 🔴 **[${scenario}] 첫 행은 재배정되지 않았다 (Persona·배정 시각 그대로)**`,
      f.matchedPersonaId === before1.matchedPersonaId && f.matchedAt?.getTime() === before1.matchedAt?.getTime())
    check(`🔴 🔴 **[${scenario}] 둘째 행은 굶지 않고 발행됐다**`, s.createdPostId !== null && s.status === 'PUBLISHED', `${s.status}`)
    check(`🔴 🔴 **[${scenario}] 첫 행 때문에 러너가 죽지 않는다 — 두 회차 모두 exit 0**`, r1.code === 0 && r2.code === 0, `${r1.code}/${r2.code}`)
    check(`[${scenario}] 두 회차를 합쳐 발행은 정확히 1건 (d1 하루 상한)`, (await prisma.post.count()) === 31, `${await prisma.post.count()}`)
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()
