#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY — 실제 러너 사슬 검사 (격리 Postgres 전용)** (2026-09-25)
 *
 *   역사적 P0 회귀 반례: 예전 recovery-first 구현에서는 기존 배정 자동 행이 발행 트랜잭션에서
 *   `AUTO_ASSIGN_STALE` 가 되면 **같은 행이 매 회차 선두를 차지해 뒤의 정상 행을 굶겼다.**
 *   현재 정본은 recovery 상태로 순위를 바꾸지 않고 실제 원문 시각 순서를 유지한다.
 *
 *   이 검사는 함수가 아니라 **러너 프로세스 자체**(`original-post-auto-publish.mts --apply`)를
 *   두 회차 연속으로 띄워 본다. 반례 둘:
 *     A. 첫 행 — 기존 배정 뒤 Persona 생활사가 바뀌었다(기혼 → 미혼, 글은 "남편이…")
 *     B. 첫 행 — 기존 배정 Persona 가 이번 주 다른 글을 이미 받았다(주 상한 소진)
 *   둘째 행 — 정상 자동 READY 행. 🔴 첫 행은 발행·재배정되지 않고, 둘째 행은 발행돼야 한다.
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** sentinel · localhost · 고정 DB 이름을 모두 요구하고,
 *    러너 자식 프로세스에는 **격리 DB 주소만 담은 env 를 새로 만들어** 넘긴다(부모 env 상속 없음).
 * 🔴 **시각은 주입이다** (2026-10-13). 앞판은 벽시계로 fixture 를 만들고 러너도 벽시계로 돌아,
 *    도는 KST 시각마다 결과가 달랐다(09:30 전 · 22:00 뒤엔 미관측). 지금은 회차 시각 `AT`(13:00 KST) 하나를
 *    fixture 와 러너(`SORAN_RUN_AT` · 격리 DB 표식 동봉)가 같이 쓴다 — 언제 돌려도 같은 결과다.
 *    🔴 `AT` 은 **과거의 고정 시각**이다 — 감사 `AutoReadyAudit.selectedAt` 은 DB 기본값(벽시계)이라,
 *       주입 시각이 벽시계보다 6시간 넘게 뒤면 "판정 없이 6시간 넘은 감사" 로 보이는 시험 틀 착시가 난다
 *       (`source-evidence-e2e-db-check` ⑧ 참고). 과거 시각이면 selectedAt 은 늘 회차 시각보다 뒤다.
 *    🔴 정상 행은 원문 증거(source-slot-v1 `sourceEvidence`)를 싣는다 — 없으면 발행 선택기가 EVIDENCE_MISSING 으로
 *       뺀다(2026-09-30 이후). 앞판은 이 칸이 없어 **시각과 상관없이** 둘째 행이 재고에서 빠졌다.
 *    D 절이 시각 경계(자정 · 첫 슬롯 직전/정각 · 창 끝 직후)를 고정 시계로 잠근다.
 *
 *   npm run auto-ready:runner-check
 */
import { spawn, spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

import { AUTO_DECIDER, HUMAN_DECIDER, AUTO_READY_RECORD_KEY, makeStamp } from '../src/lib/auto-ready-v2'
import {
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'

import { EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT, bindingOf, digestOf as evDigest } from '../src/lib/auto-ready-evidence'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { RUN_AT_ENV } from './lib/run-clock.mjs'
import { EVENT_WAKE_ENV } from './lib/runner-wake.mjs'
/**
 * 🔴 증거 픽스처의 사람 검토 기록(v2) — 운영에서는 관리자 서버 경계(로그인 세션)만 쓴다.
 *    발행된 사람 결정 행 · 수정·폐기 없음 → noEdit 로 결속한다.
 */
const humanReviewed = (title: string, body: string) => ({
  [EVIDENCE_REVIEW_KEY]: [{
    contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', reviewerUserId: 'fixture-founder',
    ...bindingOf({ status: 'PUBLISHED', draftTitle: title, draftBody: body, editedTitle: null, editedBody: null, declineReason: null }),
    hardDefect: 'no', reasons: [], bundleDigest: evDigest('fixture-bundle'), reviewedAt: '2026-09-25T00:00:00Z',
  }],
})

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

/** 🔴 회차 시각 — 2026-10-01(목) 13:00 KST. d1 슬롯(09:30) 도래 · 운영 창 안 · 과거 고정값 */
const AT = new Date('2026-10-01T04:00:00.000Z')
const NOW = AT
const CAP = new Date(NOW.getTime() - 2 * 864e5)
const SR = { complete: true, deterministicPass: true, unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9 }
/** 🔴 지금 품질 계약으로 적재된 행 (2026-09-27) — 증거 cohort 와 자동 도장 대상은 이 표식이 있는 행뿐이다 */
const gate = (voiceCode: string | null, evidence: { at: Date; id: string } | null = null) => ({
  holds: [], blocks: [], semanticReview: SR, [QUALITY_CONTRACT_KEY]: currentQualityContract(),
  // 🔴 원문 증거 — 초안 적재 시각 기준으로 만든다(게시 < 목록 < 수집 < 초안 ≤ 행 생성)
  ...(evidence === null ? {} : fakeEvidenceGate(evidence.at, { id: evidence.id })),
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    ...(voiceCode === null ? {} : { voice: { personaCode: voiceCode, bundleDigest: `bd-${voiceCode}`, comments: 3 } }),
  },
})

/** 🔴 러너 자식 프로세스 — 격리 DB 주소와 스위치만 담은 새 env. 부모 env 를 상속하지 않는다 */
const runnerEnv = (at: Date): Record<string, string> => ({
  PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
  DATABASE_URL: URL, DIRECT_URL: URL, SORAN_AUTO_READY_ENABLED: 'on',
  // 🔴 주입 시각 + --apply 는 러너가 격리 DB 표식을 다시 확인한다 — 표식을 같이 넘긴다
  SORAN_ISOLATED_DB: 'yes-throwaway', [RUN_AT_ENV]: at.toISOString(),
  // 🔴 (2026-10-14) 발행 뒤 댓글 러너 깨움(C2)은 이 Mac 의 진짜 launchd job 을 kickstart 한다 — 시험에서는 늘 끈다.
  //    미설정도 off 지만 기본값에 기대지 않는다
  [EVENT_WAKE_ENV]: 'off',
})
function runRunner(at: Date = AT): { code: number; out: string } {
  const env = runnerEnv(at)
  const r = spawnSync('npx', ['tsx', 'scripts/original-post-auto-publish.mts', '--apply', '--limit=1', '--trigger=local'],
    { env, encoding: 'utf-8', timeout: 300_000 })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

/** 🔴 두 러너를 **동시에** 띄운다 — 같은 도래 슬롯을 두 프로세스가 노린다 */
function runRunnerAsync(at: Date = AT): Promise<{ code: number; out: string }> {
  const env = runnerEnv(at)
  return new Promise((resolve) => {
    const c = spawn('npx', ['tsx', 'scripts/original-post-auto-publish.mts', '--apply', '--limit=1', '--trigger=local'], { env })
    let out = ''
    c.stdout.on('data', (d: Buffer) => { out += d.toString() })
    c.stderr.on('data', (d: Buffer) => { out += d.toString() })
    c.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}

/**
 * 🔴 **발행 경로를 탔다는 양성 신호** — 슬롯 판정이 "낸다" 로 나온 줄(`judgeCatchUp` run=true 의 두 문구).
 *    앞판은 "운영 창|도래한 슬롯이 없|트리거가" 가 **없으면** 관측으로 셌는데, 실제 첫 슬롯 전 문구는
 *    "첫 슬롯(09:30 KST)이 아직 오지 않았다" 라 09:30 전에도 관측으로 통과했다(죽은 가드). 이제 있어야 통과다.
 */
const ranPublishPath = (out: string): boolean => /판정 (🟡 catch-up —|.+ 슬롯이고 아직 내지 않았다)/.test(out)

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
          // 🔴 증거는 **생성 순서상 먼저**다 — 품질 계약 cohort 는 첫 30건을 생성 순서로 본다
          createdAt: new Date(NOW.getTime() - 60 * 864e5 + i * 60_000),
          // 🔴 사람 정답 표본 — human:founder 검토 기록이 이 초안에 묶여 있다(결함 no)
          editDiff: humanReviewed(`사람이 본 글 ${i}`, `사람이 본 본문 ${i}`) as never,
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
        gateVerdict: 'PASS', gateResults: gate(p.code, { at: createdAt, id: `chain-${seq}` }) as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
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
    const observed = ranPublishPath(r1.out)
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

  /**
   * ── C. 🔴 🔴 슬롯 경쟁 — 두 러너가 같은 도래 슬롯을 동시에 노린다 (2026-09-26 마스터 P0) ──
   *    정상 후보 둘 · 도래 슬롯 1(d1) · 오늘 발행 0. 두 프로세스 모두 밖에서 "발행 0" 을 본다.
   *    🔴 발행은 정확히 1건 · 두 러너 모두 exit 0(패자는 사전 필터 또는 트랜잭션의 정상 무발행).
   */
  console.log('\n── C 슬롯 경쟁 (두 러너 동시) ──')
  {
    await wipe()
    await seedEvidence()
    const now = AT
    const p1 = await persona('PC1')
    const p2 = await persona('PC2')
    const c1 = await autoRow(p1, '아침에 산책을 다녀왔어요. 다들 어떻게 지내세요?', new Date(now.getTime() - 3 * 3600e3))
    const c2 = await autoRow(p2, '오늘 시장에서 호박을 샀어요. 다들 어떻게 지내세요?', new Date(now.getTime() - 2 * 3600e3))
    const [r1, r2] = await Promise.all([runRunnerAsync(), runRunnerAsync()])
    const observed = ranPublishPath(r1.out) && ranPublishPath(r2.out)
    check('[C] 발행 경로를 실제로 탔다 (슬롯·운영 창 안) — 밖이면 미관측', observed)
    const published = await prisma.originalPostApprovalQueue.count({ where: { id: { in: [c1.id, c2.id] }, status: 'PUBLISHED' } })
    const tail = (o: string) => o.split('\n').filter((l) => /⑤|✅ Post|중단|정상 무발행/.test(l)).slice(0, 2).join(' ⏎ ')
    console.log(`   러너1 exit ${r1.code} · ${tail(r1.out)}`)
    console.log(`   러너2 exit ${r2.code} · ${tail(r2.out)}`)
    check('🔴 🔴 **[C] 두 러너 동시 — 발행 정확히 1건 (Post 30+1)**', published === 1 && (await prisma.post.count()) === 31, `${published}`)
    check('🔴 🔴 **[C] 슬롯 경쟁 패자도 exit 0 — 두 러너 모두 0**', r1.code === 0 && r2.code === 0, `${r1.code}/${r2.code}`)
  }

  /**
   * ── D. 🔴 **시각 경계 — 같은 재고 · 다른 회차 시각** (2026-10-13) ──
   *    정상 후보 둘(원문 증거 있음) · 러너 한 번. 재고는 시각마다 같고 **슬롯 판정만** 갈려야 한다 —
   *    어느 시각에도 "재고가 없어" 로 끝나면 안 된다(앞판의 5 fail 이 이 모양이었다).
   *      00:00 KST · 09:29:59 KST → 첫 슬롯 전 — 발행 0 · exit 0
   *      09:30:00 KST            → d1 슬롯 정각 — 발행 1
   *      22:01 KST               → 운영 창 뒤 — 발행 0 · exit 0 (밀린 슬롯은 메우지 않는다)
   */
  const edges = [
    { label: '00:00 KST 자정', at: new Date('2026-09-30T15:00:00.000Z'), publish: 0, why: /첫 슬롯\(09:30 KST\)이 아직 오지 않았다/ },
    { label: '09:29:59 KST 첫 슬롯 직전', at: new Date('2026-10-01T00:29:59.000Z'), publish: 0, why: /첫 슬롯\(09:30 KST\)이 아직 오지 않았다/ },
    { label: '09:30:00 KST 첫 슬롯 정각', at: new Date('2026-10-01T00:30:00.000Z'), publish: 1, why: null },
    { label: '22:01 KST 운영 창 뒤', at: new Date('2026-10-01T13:01:00.000Z'), publish: 0, why: /운영 창\(08:00~22:00 KST\)이 끝났다/ },
  ] as const
  for (const e of edges) {
    console.log(`\n── D 시각 경계 ${e.label} ──`)
    await wipe()
    await seedEvidence()
    const d1 = await autoRow(await persona('PD1'), '아침에 산책을 다녀왔어요. 다들 어떻게 지내세요?', new Date(e.at.getTime() - 3 * 3600e3))
    const d2 = await autoRow(await persona('PD2'), '오늘 시장에서 호박을 샀어요. 다들 어떻게 지내세요?', new Date(e.at.getTime() - 2 * 3600e3))
    const r = runRunner(e.at)
    const published = await prisma.originalPostApprovalQueue.count({ where: { id: { in: [d1.id, d2.id] }, status: 'PUBLISHED' } })
    check(`[D ${e.label}] 러너 exit 0`, r.code === 0, `${r.code}`)
    check(`🔴 🔴 **[D ${e.label}] 발행 ${e.publish}건**`, published === e.publish && (await prisma.post.count()) === 30 + e.publish, `${published}`)
    check(`[D ${e.label}] 재고에서 빠진 행이 없다 — "재고가 없어" 로 끝나지 않는다`, !/재고가 없어/.test(r.out))
    if (e.why === null) check(`[D ${e.label}] 발행 경로를 탔다`, ranPublishPath(r.out))
    else check(`[D ${e.label}] 막은 것은 슬롯 판정이다 — ${e.why.source}`, e.why.test(r.out) && !ranPublishPath(r.out))
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()
