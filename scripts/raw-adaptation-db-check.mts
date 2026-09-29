#!/usr/bin/env tsx
/**
 * 🔴 **적응 레인은 지금 자동 READY 재고를 건드리지 않는다 — 실행 반례 (격리 Postgres 전용)** (2026-09-29)
 *
 *   질문 — 긴 사연 적응 경로(#627)를 넣은 코드로 돌려도, main 코드가 적재·도장한 quality-v4 자동 READY 재고
 *          (운영 11건 모양 · AUTO_DECIDER 도장)가 **그대로 자동 발행 재고**인가? 적응 행은 사람 검토로만 나가는가?
 *
 *   ① quality-v4 자동 READY 11건 — 표식은 **main 이 적은 값 그대로**(digest 379bf6c6…) · 도장은 AUTO_DECIDER
 *      → 열림 판정 open · 실제 로더(`loadPublishableStock`) 대상 11/11 · 발행 트랜잭션 재검증(`recheckAutoReadyInTx`) 11/11
 *   ② 지금 코드의 도장 경로도 그대로 — 새 v4 기계 행 1건은 `stampRound` 가 도장한다
 *   ③ 적응 행 — **실제 적재기**(`buildQueuePayload`)가 만든 gateResults 그대로 적재
 *      · 검토 전 → HUMAN_REVIEW_REQUIRED · 도장 0 · 재고 칸 qualityContractMismatch(WIP 아님 · 사람 검토로만)
 *      · 잘못 도장된 적응 행 · 품질 계약 표식까지 든 적응 행 · 경고가 지워진 적응 행 → selector · 도장 · 재검증 모두 거절
 *      · 사람이 검토한 적응 행(founder) → 사람 경로로 selector 대상(사람 검토 레인은 열려 있다)
 *   ④ 적응 행에서 사람이 중대 결함을 찾아도 v4 열림은 닫히지 않는다 — v4 cohort 표본이 아니다
 *   ⑤ 읽기 경로 전부를 돌려도 v4 행은 한 글자도 바뀌지 않는다
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다** — sentinel · localhost · soran_test 를 모두 요구하고 주소를 찍지 않는다.
 * 🔴 Raw SQL 없음 — 청소는 Prisma deleteMany 다. 네트워크 0 · LLM 0.
 * 🔴 문장은 합성이다 — 회원 원문을 옮기지 않았다.
 */
import { PrismaClient } from '@prisma/client'

import { requireIsolatedDb, wipeAuditFixtures } from './lib/auto-ready-audit-fixtures.mjs'
import {
  buildQueuePayload, MACHINE_PROMPT_VERSION, MACHINE_MODEL, type Candidate,
} from '../src/lib/micro-seed-supply-autofill'
import { DRAFT_RULE_VERSION, DRAFT_PROVENANCE } from '../src/lib/micro-seed-auto-draft'
import { STAGE_MODEL } from '../src/lib/content-core/pipeline'
import {
  AUTO_DECIDER, AUTO_READY_ENV, AUTO_READY_RECORD_KEY, makeStamp, digestOf,
} from '../src/lib/auto-ready-v2'
import { EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT, bindingOf } from '../src/lib/auto-ready-evidence'
import { authoritativeGate, recheckAutoReadyInTx, stampRound, evidenceFromDb } from '../src/lib/auto-ready-repo'
import { MACHINE_REVIEWED_BY } from '../src/lib/original-post-auto-publish'
import { isCurrentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'
import { RAW_ADAPT_CONTRACT_KEY, carriesRawAdaptMark } from '../src/lib/raw-adapt-lane'
import { RAW_ADAPTATION_REVIEW_CODE } from '../src/lib/raw-adaptation'
import { measureOriginality } from '../src/lib/draft-originality'
import { CAPACITY_ENV, RELEASE_ENV } from '../src/lib/scale-profile'
import { candidateEnvelope } from './lib/candidate-envelope.mjs'
import { loadPublishableStock, loadStockClassification } from './lib/publishable-stock.mjs'

requireIsolatedDb()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** 🔴 main(3f8af5a)이 적재한 행이 들고 있는 품질 계약 표식 — **지금 코드가 계산한 값이 아니다** */
const MAIN_V4_MARK = { version: 'quality-v4', digest: '379bf6c61fe1431f928da2e44cde0731fdf1850a301b0c808378a6875be47daa' }
const NOW = new Date()
const DAY = 864e5
const ON: Record<string, string> = { [AUTO_READY_ENV]: 'on', [RELEASE_ENV]: 'd1', [CAPACITY_ENV]: 'd10' }

const REVIEW_CLEAN = {
  semantic: { unsupportedAdditions: [], lifeContradictions: [], droppedFromSource: [], confidence: 0.9 },
  deterministic: { pass: true, failures: [] }, semanticCompletion: { complete: true },
}
const AJ = { ruleVersion: 'auto-judge-v4', promptVersion: 'p', model: 'm', inputHash: 'h', provenance: 'machine:auto-judge' }

/** 🔴 실제 후보 봉투 → 실제 적재기. 원천·문장은 합성이다 */
function payloadOf(o: { n: number; route: 'seed' | 'adapt'; title: string; body: string; voice: string }) {
  const lifeReview = o.route === 'adapt' ? [RAW_ADAPTATION_REVIEW_CODE] : []
  const env = candidateEnvelope({
    generatedAt: NOW.toISOString(), ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, stageModels: STAGE_MODEL,
    items: [{
      artifact: {
        artifactId: `tb-art-${o.n}`, review: REVIEW_CLEAN,
        voice: { provenance: { personaCode: o.voice, sampleCount: 3, bundleDigest: `bd-${o.voice}`, sourceDigest: 'sd-tb' } },
      } as never,
      sourceArticleId: `${7000 + o.n}-tb`,
      meta: { site: 'navercafe:tb', sourcePostedAt: '', sourceListedAt: '', sourceCapturedAt: NOW.toISOString() },
      draft: {
        title: o.title, body: o.body, safetyVerdict: 'pass',
        originality: measureOriginality(`${o.title}\n${o.body}`, `합성 원문 제목 ${o.n}\n합성 원문 본문 ${o.n}`),
        generatedAt: NOW.toISOString(),
      },
      sourceTitleCopied: false, sourceTitleCheckVersion: 'v', autoJudge: AJ,
      ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, reviewedAt: NOW.toISOString(),
      lifeReview, draftRoute: o.route,
    }],
  })
  const c = (env.candidates as Record<string, unknown>[])[0]!
  const pl = buildQueuePayload({ envelope: env, candidate: c as Candidate, autoJudge: AJ, review: REVIEW_CLEAN, now: NOW.toISOString() })
  if (pl === null) throw new Error(`적재기가 payload 를 만들지 않았다 (${o.route} ${o.n})`)
  return pl
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 적응 레인 · quality-v4 자동 READY 재고 보존 (격리 DB 전용 · 운영 DB 0) ══\n')
  await wipeAuditFixtures(prisma)

  let seq = 0
  const rawRow = async (site: string) => {
    seq += 1
    return prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: site, sourceUrl: `https://example.invalid/tb/${seq}`,
        sourceArticleId: `${8000 + seq}-tb`, sourceCapturedAt: new Date(NOW.getTime() - 1 * DAY),
        rawTitle: `합성 원문 ${seq}`, rawBody: `합성 원문 본문 ${seq}`,
      },
      select: { id: true },
    })
  }
  const insert = async (o: {
    site: string; title: string; body: string; gateResults: unknown; decidedBy: string; stamp?: boolean
    editDiff?: Record<string, unknown>
  }): Promise<string> => {
    const r = await rawRow(o.site)
    const editDiff: Record<string, unknown> = {
      ...(o.editDiff ?? {}),
      ...(o.stamp === true ? { [AUTO_READY_RECORD_KEY]: makeStamp(o.title, o.body, NOW) } : {}),
    }
    return (await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: o.title, draftBody: o.body,
        gateVerdict: 'PASS', gateResults: o.gateResults as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: o.decidedBy, decidedAt: NOW, dedupKey: `tb-${seq}`,
        ...(Object.keys(editDiff).length > 0 ? { editDiff: editDiff as never } : {}),
      },
      select: { id: true },
    })).id
  }

  // ── ① quality-v4 자동 READY 11건 — main 이 적재 · 도장한 모양 그대로 ──
  const TOPICS = ['아침 산책', '가을 이불', '베란다 화분', '저녁 반찬', '동네 도서관', '주말 장보기',
    '손주 운동회', '김장 준비', '무릎 스트레칭', '뜨개질 모임', '친구 안부']
  const v4Ids: string[] = []
  for (const [i, t] of TOPICS.entries()) {
    const title = `${t} 이야기 나눠요`
    const body = `요즘 ${t} 때문에 하루가 조금 달라졌어요. 다들 요즘 어떻게 지내세요? (${i + 1})`
    const pl = payloadOf({ n: i, route: 'seed', title, body, voice: `P${String(i + 1).padStart(2, '0')}` })
    // 🔴 표식은 main 이 적은 값 그대로 — 지금 코드가 계산한 값으로 바꿔 끼우지 않는다
    const g = { ...(pl.gateResults as Record<string, unknown>), [QUALITY_CONTRACT_KEY]: MAIN_V4_MARK }
    v4Ids.push(await insert({ site: pl.syntheticSite, title, body, gateResults: g, decidedBy: AUTO_DECIDER, stamp: true }))
  }
  // ② 지금 코드로 도장받을 새 v4 기계 행 1건 (대조)
  const freshPl = payloadOf({ n: 50, route: 'seed', title: '단풍 구경 다녀왔어요', body: '주말에 단풍 구경을 다녀왔어요. 다들 올가을 어디 다녀오셨어요?', voice: 'P12' })
  const freshId = await insert({
    site: freshPl.syntheticSite, title: '단풍 구경 다녀왔어요', body: '주말에 단풍 구경을 다녀왔어요. 다들 올가을 어디 다녀오셨어요?',
    gateResults: freshPl.gateResults, decidedBy: freshPl.decidedBy,
  })

  // ── ③ 적응 행 — 실제 적재기 gateResults ──
  const rt = '명절 시댁 먼저 vs 친정 먼저, 어느 쪽이 맞을까요'
  const rb = '명절마다 어느 집부터 가느냐로 부부 사이에 말이 오간대요. 여러분이라면 어떻게 하세요?'
  const rawPl = payloadOf({ n: 100, route: 'adapt', title: rt, body: rb, voice: 'P13' })
  const rawG = rawPl.gateResults as Record<string, unknown>
  const rawPending = await insert({ site: rawPl.syntheticSite, title: rt, body: rb, gateResults: rawG, decidedBy: rawPl.decidedBy })
  const rawStamped = await insert({ site: rawPl.syntheticSite, title: `${rt} (2)`, body: rb, gateResults: rawG, decidedBy: AUTO_DECIDER, stamp: true })
  // 🔴 변이 흉내 — 품질 계약 표식까지 든 적응 행 · 사람 검토 경고가 지워진 적응 행(적응 레인 표식만 남음)
  const bothG = { ...rawG, [QUALITY_CONTRACT_KEY]: MAIN_V4_MARK }
  const bareG = { ...bothG, holds: [] }
  const rawBoth = await insert({ site: rawPl.syntheticSite, title: `${rt} (3)`, body: rb, gateResults: bothG, decidedBy: AUTO_DECIDER, stamp: true })
  const rawBare = await insert({ site: rawPl.syntheticSite, title: `${rt} (4)`, body: rb, gateResults: bareG, decidedBy: AUTO_DECIDER, stamp: true })
  const rawBarePending = await insert({ site: rawPl.syntheticSite, title: `${rt} (5)`, body: rb, gateResults: bareG, decidedBy: rawPl.decidedBy })
  // 사람이 검토한 적응 행
  const rawHuman = await insert({ site: rawPl.syntheticSite, title: `${rt} (6)`, body: rb, gateResults: rawG, decidedBy: MACHINE_REVIEWED_BY })
  // ④ 사람이 중대 결함을 찾은 적응 행
  const defT = `${rt} (7)`
  const rawDefect = await insert({
    site: rawPl.syntheticSite, title: defT, body: rb, gateResults: rawG, decidedBy: MACHINE_REVIEWED_BY,
    editDiff: {
      [EVIDENCE_REVIEW_KEY]: [{
        contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', reviewerUserId: 'tb-founder',
        ...bindingOf({ status: 'APPROVED', draftTitle: defT, draftBody: rb, editedTitle: null, editedBody: null, declineReason: null }),
        hardDefect: 'yes', reasons: ['합성 결함'], bundleDigest: digestOf('tb-bundle'), reviewedAt: NOW.toISOString(),
      }],
    },
  })
  const rawIds = [rawPending, rawStamped, rawBoth, rawBare, rawBarePending]

  console.log('── fixture')
  const stored = await prisma.originalPostApprovalQueue.findMany({
    where: { id: { in: [...v4Ids, ...rawIds, rawHuman, rawDefect] } }, select: { id: true, gateResults: true },
  })
  const gOf = new Map(stored.map((r) => [r.id, r.gateResults]))
  check('🔴 🔴 **v4 11건 — main 이 적은 표식(379bf6c6…)이 지금 코드에서도 "지금 품질 계약" 이다**',
    v4Ids.length === 11 && v4Ids.every((id) => isCurrentQualityContract(gOf.get(id))))
  check('🔴 적재기가 만든 적응 행 — 품질 계약 표식 없음 · 적응 레인 표식 · 사람 검토 경고',
    !(QUALITY_CONTRACT_KEY in rawG) && RAW_ADAPT_CONTRACT_KEY in rawG && carriesRawAdaptMark(rawG)
    && (rawG.holds as string[]).includes(`DRAFT_LIFE_REVIEW:${RAW_ADAPTATION_REVIEW_CODE}`))

  const before = JSON.stringify(await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: v4Ids } }, orderBy: { id: 'asc' } }))

  console.log('\n① quality-v4 자동 READY 11건 — 여전히 자동 발행 재고')
  const gate = await authoritativeGate(prisma, ON)
  check('🔴 🔴 **열림 판정 open (창업자 gold 30/30 · v4 사람 중대 결함 0)**', gate.open, gate.reasons.join(' · '))
  const loaded = await loadPublishableStock(prisma, NOW, { autoReadyOpen: gate.open })
  const codeOf = (id: string): string => loaded.rejected.find((r) => r.id === id)?.code
    ?? (loaded.targets.some((t) => t.id === id) ? 'TARGET' : '?')
  check('🔴 🔴 **실제 로더 — v4 자동 READY 11/11 이 자동 발행 대상이다**',
    v4Ids.every((id) => codeOf(id) === 'TARGET'), v4Ids.map(codeOf).join(','))
  let rechecked = 0
  for (const id of v4Ids) {
    const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({
      where: { id }, select: { draftTitle: true, draftBody: true, editDiff: true, gateVerdict: true, gateResults: true, rawContent: { select: { sourceCapturedAt: true } } },
    })
    const v = await prisma.$transaction((tx) => recheckAutoReadyInTx(tx, {
      env: ON, title: r.draftTitle, body: r.draftBody, editDiff: r.editDiff, gateVerdict: r.gateVerdict,
      gateResults: r.gateResults, sourceCapturedAt: r.rawContent.sourceCapturedAt,
    }), { isolationLevel: 'Serializable' })
    if (v.ok) rechecked += 1
    else console.log(`     · ${id} 재검증 거절 — ${v.reason}`)
  }
  check('🔴 🔴 **발행 트랜잭션 재검증 — v4 자동 READY 11/11 통과**', rechecked === 11, `${rechecked}/11`)
  const cls = (await loadStockClassification(prisma, ON, NOW)).classification
  check('🔴 재고 분류 — v4 11건은 옛 계약 칸(qualityContractMismatch)에 없다',
    !v4Ids.some((id) => cls.ids.qualityContractMismatch.includes(id)))

  console.log('\n② 지금 코드의 도장 경로 — 새 v4 행은 도장된다 · 적응 행은 도장되지 않는다')
  const tally = await stampRound(prisma, { env: ON, now: NOW })
  const fresh = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: freshId }, select: { decidedBy: true } })
  check('🟢 새 v4 기계 행 → auto-ready:v1 도장', fresh.decidedBy === AUTO_DECIDER, `${fresh.decidedBy} · ${JSON.stringify([...tally])}`)
  const pend = await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: [rawPending, rawBarePending] } }, select: { decidedBy: true, editDiff: true } })
  check('🔴 🔴 **적응 행(경고가 지워진 행 포함) → 도장 0 · decidedBy 그대로 machine:***',
    pend.every((r) => (r.decidedBy ?? '').startsWith('machine:') && JSON.stringify(r.editDiff ?? {}).indexOf(AUTO_READY_RECORD_KEY) < 0))
  check('도장 회차 — 도장 1건뿐(새 v4 행)', (tally.get('stamped') ?? 0) === 1, JSON.stringify([...tally]))

  console.log('\n③ 적응 행 — 사람 검토 전용')
  const loaded2 = await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })
  const code2 = (id: string): string => loaded2.rejected.find((r) => r.id === id)?.code
    ?? (loaded2.targets.some((t) => t.id === id) ? 'TARGET' : '?')
  check('🔴 검토 전 적응 행 → HUMAN_REVIEW_REQUIRED', code2(rawPending) === 'HUMAN_REVIEW_REQUIRED', code2(rawPending))
  check('🔴 🔴 **잘못 도장된 적응 행 → QUALITY_CONTRACT_MISMATCH (열림에서도)**', code2(rawStamped) === 'QUALITY_CONTRACT_MISMATCH', code2(rawStamped))
  check('🔴 🔴 **품질 계약 표식까지 든 적응 행 → QUALITY_CONTRACT_MISMATCH**', code2(rawBoth) === 'QUALITY_CONTRACT_MISMATCH', code2(rawBoth))
  check('🔴 🔴 **경고가 지워진 적응 행(적응 레인 표식만) → QUALITY_CONTRACT_MISMATCH**', code2(rawBare) === 'QUALITY_CONTRACT_MISMATCH', code2(rawBare))
  check('🟢 사람이 검토한 적응 행 → 사람 경로로 selector 대상 (사람 검토 레인은 열려 있다)', code2(rawHuman) === 'TARGET', code2(rawHuman))
  let rawRecheckOk = 0
  for (const id of [rawStamped, rawBoth, rawBare]) {
    const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({
      where: { id }, select: { draftTitle: true, draftBody: true, editDiff: true, gateVerdict: true, gateResults: true, rawContent: { select: { sourceCapturedAt: true } } },
    })
    const v = await prisma.$transaction((tx) => recheckAutoReadyInTx(tx, {
      env: ON, title: r.draftTitle, body: r.draftBody, editDiff: r.editDiff, gateVerdict: r.gateVerdict,
      gateResults: r.gateResults, sourceCapturedAt: r.rawContent.sourceCapturedAt,
    }), { isolationLevel: 'Serializable' })
    if (v.ok) rawRecheckOk += 1
  }
  check('🔴 🔴 **발행 트랜잭션 재검증 — 도장 든 적응 행 3건 전부 거절**', rawRecheckOk === 0, `${rawRecheckOk}/3 통과`)
  check('🔴 재고 분류 — 검토 전 적응 행은 사람 검토 전용 칸(qualityContractMismatch · WIP 아님)',
    cls.ids.qualityContractMismatch.includes(rawPending) && !cls.personaWipIds.includes(rawPending))

  console.log('\n④ 적응 행의 사람 중대 결함은 v4 열림을 닫지 않는다')
  const ev = await evidenceFromDb(prisma)
  const gate2 = await authoritativeGate(prisma, ON)
  check('🔴 🔴 **v4 cohort 사람 중대 결함 0 · 열림 유지 (적응 행 결함 yes 가 있어도)**',
    ev.cohortHardDefects === 0 && gate2.open, `${ev.cohortHardDefects} · ${gate2.reasons.join(' · ')}`)

  console.log('\n⑤ v4 행은 읽기·도장 경로를 전부 지나도 그대로')
  const after = JSON.stringify(await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: v4Ids } }, orderBy: { id: 'asc' } }))
  check('🔴 v4 11행 전체(updatedAt 포함) 변경 0', before === after)

  await wipeAuditFixtures(prisma)
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 전용 · 운영 DB 0 · 네트워크 0 · LLM 0\n')
  if (fail > 0) process.exit(1)
}

await main()
