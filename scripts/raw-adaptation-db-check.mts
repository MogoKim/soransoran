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
 *      · 검토 전 → QUALITY_CONTRACT_MISMATCH(창업자 검토 대기 아님) · 도장 0 · 재고 칸 qualityContractMismatch(WIP 아님)
 *      · 잘못 도장된 적응 행 · 품질 계약 표식까지 든 적응 행 · 경고가 지워진 적응 행 → selector · 도장 · 재검증 모두 거절
 *      · 사람 도장(founder)이 있는 적응 행도 selector 가 내지 않는다(격리는 사람 경로도 닫는다)
 *   ④ 적응 행에서 사람이 중대 결함을 찾아도 v4 열림은 닫히지 않는다 — v4 cohort 표본이 아니다
 *   ⑤ 읽기 경로 전부를 돌려도 v4 행은 한 글자도 바뀌지 않는다
 *   🔴 (2026-09-29 보강) **적응 행은 내부 실험 격리다 — 창업자 검토 백로그가 되지 않는다**
 *   ⑥ 창업자 대기열 0 — 재고 칸 humanReviewPending · selector HUMAN_REVIEW_REQUIRED · 자동 READY 검토 묶음 ·
 *      `publish:machine-review`(실제 CLI) 어디에도 적응 행이 없다 (대조: 검토 전 seed 행은 있다)
 *   ⑦ Persona WIP 0 — 배정 사용량(`personaMatchUsageOf`) · 화자 여력(`buildSpeakerLoad`)이 적응 행을 세지 않는다
 *   ⑧ 적재 상한 — **실제 적재기 CLI** 로 seed 먼저 · 회차 2 · 하루 4 · 상한은 건너뜀(cut 아님)
 *   ⑨ 기한 — 7일 지난 적응 행은 읽을 때 빠진다 · 청소는 `apply` 일 때만 · 사람 도장 행 · 살아 있는 행은 그대로
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다** — sentinel · localhost · soran_test 를 모두 요구하고 주소를 찍지 않는다.
 * 🔴 Raw SQL 없음 — 청소는 Prisma deleteMany 다. 네트워크 0 · LLM 0.
 * 🔴 문장은 합성이다 — 회원 원문을 옮기지 않았다.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { RAW_ADAPT_CONTRACT_KEY, RAW_ADAPT_QUARANTINE_KEY, carriesRawAdaptMark } from '../src/lib/raw-adapt-lane'
import { RAW_ADAPT_LOAD_CAP_PER_RUN, RAW_ADAPT_LOAD_CAP_PER_DAY } from '../src/lib/raw-adapt-quarantine'
import { personaMatchUsageOf } from '../src/lib/persona-for-match'
import { resolveScale } from '../src/lib/scale-runtime'
import { FILL_REPORT_PREFIX, type FillReport } from '../src/lib/supply-fill-retry'
import { selectBundleRows } from './lib/auto-ready-bundle-select.mjs'
import { readRawAdaptQuarantine, sweepRawAdaptQuarantine } from './lib/raw-adapt-quarantine-store.mjs'
import { buildSpeakerLoad } from './supply-process.mjs'
import { RAW_ADAPTATION_REVIEW_CODE } from '../src/lib/raw-adaptation'
import { measureOriginality } from '../src/lib/draft-originality'
import { CAPACITY_ENV, RELEASE_ENV } from '../src/lib/scale-profile'
import { candidateEnvelope } from './lib/candidate-envelope.mjs'
import { loadPublishableStock, loadStockClassification } from './lib/publishable-stock.mjs'

requireIsolatedDb()

/** 🔴 자식 프로세스(실제 CLI)는 이 작업트리의 파일 · tsx 로 돈다 — DB 주소는 부모 env(격리 DB) 그대로 */
const WORKTREE = join(dirname(fileURLToPath(import.meta.url)), '..')
const TSX = join(WORKTREE, 'node_modules', '.bin', 'tsx')
const CHILD_ENV = { ...process.env, TSX_TSCONFIG_PATH: join(WORKTREE, 'tsconfig.json') }
/** 🔴 적재기 CLI 의 작업 폴더(후보 파일 · 보류 목록) — 임시 폴더다 */
const SCRATCH = process.env.RAW_ADAPT_CHECK_TMP ?? tmpdir()

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
  check('🔴 🔴 **검토 전 적응 행 → QUALITY_CONTRACT_MISMATCH (창업자 검토 대기 HUMAN_REVIEW_REQUIRED 가 아니다)**',
    code2(rawPending) === 'QUALITY_CONTRACT_MISMATCH', code2(rawPending))
  check('🔴 🔴 **잘못 도장된 적응 행 → QUALITY_CONTRACT_MISMATCH (열림에서도)**', code2(rawStamped) === 'QUALITY_CONTRACT_MISMATCH', code2(rawStamped))
  check('🔴 🔴 **품질 계약 표식까지 든 적응 행 → QUALITY_CONTRACT_MISMATCH**', code2(rawBoth) === 'QUALITY_CONTRACT_MISMATCH', code2(rawBoth))
  check('🔴 🔴 **경고가 지워진 적응 행(적응 레인 표식만) → QUALITY_CONTRACT_MISMATCH**', code2(rawBare) === 'QUALITY_CONTRACT_MISMATCH', code2(rawBare))
  check('🔴 🔴 **사람 도장(founder) 적응 행도 selector 가 내지 않는다 — 격리는 사람 경로도 닫는다**',
    code2(rawHuman) === 'QUALITY_CONTRACT_MISMATCH', code2(rawHuman))
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
  check('🔴 재고 분류 — 검토 전 적응 행은 qualityContractMismatch 칸(WIP 아님 · humanReviewPending 아님)',
    cls.ids.qualityContractMismatch.includes(rawPending) && !cls.personaWipIds.includes(rawPending))

  console.log('\n④ 적응 행의 사람 중대 결함은 v4 열림을 닫지 않는다')
  const ev = await evidenceFromDb(prisma)
  const gate2 = await authoritativeGate(prisma, ON)
  check('🔴 🔴 **v4 cohort 사람 중대 결함 0 · 열림 유지 (적응 행 결함 yes 가 있어도)**',
    ev.cohortHardDefects === 0 && gate2.open, `${ev.cohortHardDefects} · ${gate2.reasons.join(' · ')}`)

  console.log('\n⑤ v4 행은 읽기·도장 경로를 전부 지나도 그대로')
  const after = JSON.stringify(await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: v4Ids } }, orderBy: { id: 'asc' } }))
  check('🔴 v4 11행 전체(updatedAt 포함) 변경 0', before === after)

  // ═════════════════════════════════════════════════════════
  // 🔴 (2026-09-29 보강) 내부 실험 격리 — 창업자 대기열 0 · Persona WIP 0 · 상한 · 기한
  // ═════════════════════════════════════════════════════════
  console.log('\n⑥ 창업자 검토 대기열 — 적응 행 0 (재고 칸 · 묶음 · 사람 검토 CLI)')
  // 대조군 — 검토 전 seed 기계 행(지금 품질 계약) 하나. 도장 회차 뒤에 넣는다
  const seedPl = payloadOf({ n: 60, route: 'seed', title: '가을 김치전 부쳤어요', body: '비 오는 날 김치전을 부쳤어요. 다들 비 오면 뭐 드세요?', voice: 'P14' })
  const seedPending = await insert({
    site: seedPl.syntheticSite, title: '가을 김치전 부쳤어요', body: '비 오는 날 김치전을 부쳤어요. 다들 비 오면 뭐 드세요?',
    gateResults: seedPl.gateResults, decidedBy: seedPl.decidedBy,
  })
  const adaptAll = [...rawIds, rawHuman, rawDefect]
  const cls3 = (await loadStockClassification(prisma, ON, NOW)).classification
  check('🟢 대조 — 검토 전 seed 기계 행은 창업자 검토 대기(humanReviewPending · WIP)',
    cls3.ids.humanReviewPending.includes(seedPending) && cls3.personaWipIds.includes(seedPending))
  check('🔴 🔴 **적응 행 7건 전부 — humanReviewPending 0 · Persona WIP 0**',
    adaptAll.every((id) => !cls3.ids.humanReviewPending.includes(id) && !cls3.personaWipIds.includes(id)),
    adaptAll.filter((id) => cls3.ids.humanReviewPending.includes(id) || cls3.personaWipIds.includes(id)).join(','))
  const loaded3 = await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })
  check('🔴 🔴 **selector 거절 코드 — 적응 행은 HUMAN_REVIEW_REQUIRED 0건**',
    !loaded3.rejected.some((r) => r.code === 'HUMAN_REVIEW_REQUIRED' && adaptAll.includes(r.id)))
  const bundle = await selectBundleRows(prisma, NOW)
  const bundleIds = [...bundle.window.map((w) => w.row.id), ...bundle.decided.map((r) => r.id), ...bundle.shadow.map((r) => r.id)]
  check('🔴 🔴 **자동 READY 창업자 검토 묶음(창 · 결정 · 그림자) — 적응 행 0**',
    !bundleIds.some((id) => adaptAll.includes(id)), bundleIds.filter((id) => adaptAll.includes(id)).join(','))
  const cli = (args: string[]) => spawnSync(TSX, [join(WORKTREE, 'scripts/original-post-machine-review.mts'), ...args], {
    cwd: WORKTREE, env: CHILD_ENV, encoding: 'utf-8', timeout: 120_000,
  })
  const cliAdapt = cli([`--id=${rawPending}`])
  check('🔴 🔴 **publish:machine-review --id <적응 행> → "대기열에 없는 id" 로 멈춘다 (한 건 보기 · 검토 완료 둘 다 막힘)**',
    cliAdapt.status !== 0 && `${cliAdapt.stdout}${cliAdapt.stderr}`.includes('대기열에 없는 id'),
    `exit ${cliAdapt.status} · ${`${cliAdapt.stderr}`.slice(-160)}`)
  const cliSeed = cli([`--id=${seedPending}`])
  check('🟢 대조 — publish:machine-review --id <seed 행> 은 한 건을 보여 준다',
    cliSeed.status === 0 && cliSeed.stdout.includes(`② 후보 ${seedPending}`), `exit ${cliSeed.status} · ${cliSeed.stderr.slice(-200)}`)
  const cliList = cli([])
  const m = /① 기계 후보 (\d+)건/.exec(cliList.stdout)
  const machineNonAdapt = (await prisma.originalPostApprovalQueue.findMany({
    where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null }, select: { gateResults: true },
  })).filter((r) => !carriesRawAdaptMark(r.gateResults)).length
  check('🔴 publish:machine-review 목록 — 기계 후보 수에 적응 행이 없다',
    m !== null && Number(m[1]) === machineNonAdapt, `${m?.[1] ?? '?'} vs ${machineNonAdapt}`)

  console.log('\n⑦ Persona WIP — 배정 사용량 · 화자 여력에 적응 행 0')
  const mkPersona = async (code: string) => {
    const u = await prisma.user.create({ data: { nickname: `격리${code}` }, select: { id: true } })
    return prisma.persona.create({ data: { code, userId: u.id, status: 'active' }, select: { id: true, code: true } })
  }
  const pA = await mkPersona('P13')
  const pB = await mkPersona('P14')
  // 🔴 잘못 남은 배정을 흉내 — 적응 행에 P13 배정 · 대조로 seed 행에 P14 배정
  await prisma.originalPostApprovalQueue.update({ where: { id: rawPending }, data: { matchedPersonaId: pA.id, matchedAt: NOW } })
  const seedMatched = await insert({
    site: seedPl.syntheticSite, title: '가을 김치전 부쳤어요 (2)', body: '비 오는 날 김치전을 부쳤어요. 다들 비 오면 뭐 드세요?',
    gateResults: seedPl.gateResults, decidedBy: seedPl.decidedBy,
  })
  await prisma.originalPostApprovalQueue.update({ where: { id: seedMatched }, data: { matchedPersonaId: pB.id, matchedAt: NOW } })
  const WEEK_AGO = new Date(NOW.getTime() - 7 * DAY)
  const uA = await personaMatchUsageOf(prisma, 'P13', WEEK_AGO)
  const uB = await personaMatchUsageOf(prisma, 'P14', WEEK_AGO)
  check('🔴 🔴 **배정 사용량(personaForMatch) — 적응 행 배정은 주간 수 · 마지막 배정에 없다**',
    uA.postsThisWeek === 0 && uA.last === null, JSON.stringify(uA))
  check('🟢 대조 — seed 행 배정은 센다', uB.postsThisWeek === 1 && uB.last?.matchedAt?.getTime() === NOW.getTime(), JSON.stringify(uB))
  const E = { ...ON }
  const load = await buildSpeakerLoad(prisma, 'q627-wip', { env: E, now: NOW, scale: resolveScale(E) })
  check('🔴 🔴 **화자 여력(buildSpeakerLoad) — 적응 행 화자 P13 의 WIP 0 · seed 대조 P14 는 WIP 로 센다**',
    load.byCode.P13?.readyCount === 0 && (load.byCode.P14?.readyCount ?? 0) >= 1, JSON.stringify({ P13: load.byCode.P13, P14: load.byCode.P14 }))
  check('🔴 화자 여력 — 사람 검토 대기 수에 적응 행 없음', load.wip.humanReviewPending === cls3.counts.humanReviewPending + 1,
    `${load.wip.humanReviewPending}`)
  await prisma.originalPostApprovalQueue.update({ where: { id: rawPending }, data: { matchedPersonaId: null, matchedAt: null } })

  console.log('\n⑧ 적재 상한 — 실제 적재기 CLI · seed 먼저 · 회차 2 · 하루 4 · 상한은 건너뜀')
  // 🔴 앞 fixture 적응 행은 이틀 전 적재로 옮긴다 — 하루 상한은 **적재기가 오늘 실은 것**만 세야 한다
  await prisma.originalPostApprovalQueue.updateMany({ where: { id: { in: adaptAll } }, data: { createdAt: new Date(NOW.getTime() - 2 * DAY) } })
  const home = mkdtempSync(join(SCRATCH, 'loader-'))
  mkdirSync(join(home, '.microseed-data'), { recursive: true })
  writeFileSync(join(home, '.microseed-data', 'held-candidates.json'), '{"held":[]}\n', 'utf-8')
  let fileSeq = 0
  const candFile = (items: { id: string; route: 'seed' | 'adapt' }[]): string => {
    fileSeq += 1
    const env = candidateEnvelope({
      generatedAt: NOW.toISOString(), ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, stageModels: STAGE_MODEL,
      items: items.map((it, i) => {
        const title = `${it.route === 'adapt' ? '명절 순서' : '동네 산책'} 이야기 ${fileSeq}-${i}`
        const body = it.route === 'adapt'
          ? `명절마다 어느 집부터 가느냐로 말이 오간대요. 여러분이라면 어떻게 하세요? (${fileSeq}-${i})`
          : `요즘 저녁마다 동네를 한 바퀴 걸어요. 다들 요즘 어떻게 지내세요? (${fileSeq}-${i})`
        return {
          artifact: {
            artifactId: `q627-art-${fileSeq}-${i}`, review: REVIEW_CLEAN,
            voice: { provenance: { personaCode: it.route === 'adapt' ? 'P13' : 'P14', sampleCount: 3, bundleDigest: 'bd', sourceDigest: 'sd' } },
          } as never,
          sourceArticleId: it.id,
          meta: { site: 'navercafe:tb', sourcePostedAt: '', sourceListedAt: '', sourceCapturedAt: NOW.toISOString() },
          draft: {
            title, body, safetyVerdict: 'pass',
            originality: measureOriginality(`${title}\n${body}`, `합성 원문 ${it.id}\n합성 원문 본문 ${it.id}`),
            generatedAt: NOW.toISOString(),
          },
          sourceTitleCopied: false, sourceTitleCheckVersion: 'v', autoJudge: AJ,
          ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, reviewedAt: NOW.toISOString(),
          lifeReview: it.route === 'adapt' ? [RAW_ADAPTATION_REVIEW_CODE] : [], draftRoute: it.route,
        }
      }),
    })
    const p = join(home, '.microseed-data', `auto-draft-q627-${fileSeq}.candidates.json`)
    writeFileSync(p, `${JSON.stringify(env, null, 2)}\n`, 'utf-8')
    return p
  }
  const countBy = async (): Promise<{ seed: number; adapt: number }> => {
    const rows = await prisma.originalPostApprovalQueue.findMany({
      where: { rawContent: { sourceUrl: { startsWith: 'publish-candidate://' } } }, select: { gateResults: true },
    })
    const adapt = rows.filter((r) => carriesRawAdaptMark(r.gateResults)).length
    return { seed: rows.length - adapt, adapt }
  }
  const fill = (file: string, upTo: number) => {
    const r = spawnSync(TSX, [join(WORKTREE, 'scripts/micro-seed-supply-autofill.mts'), `--input=${file}`, '--apply', `--up-to=${upTo}`], {
      cwd: home, env: CHILD_ENV, encoding: 'utf-8', timeout: 180_000,
    })
    const line = r.stdout.split('\n').find((l) => l.startsWith(FILL_REPORT_PREFIX))
    const report = line === undefined ? null : JSON.parse(line.slice(FILL_REPORT_PREFIX.length)) as FillReport
    if (r.status !== 0) console.log(`     · 적재기 exit ${r.status}\n${r.stdout.slice(-1200)}\n${r.stderr.slice(-600)}`)
    return { status: r.status, report }
  }
  // ⓐ seed 먼저 — 적응 원천 id 가 정렬상 앞이어도 --up-to 2 자리는 seed 가 받는다
  const c0 = await countBy()
  const f0 = fill(candFile([{ id: '1000-a', route: 'adapt' }, { id: '1001-a', route: 'adapt' }, { id: '5000-s', route: 'seed' }, { id: '5001-s', route: 'seed' }]), 2)
  const c1 = await countBy()
  check('🔴 🔴 **seed 먼저 — --up-to=2 에서 seed 2 적재 · 적응 0 (적응이 정렬상 앞이어도)**',
    f0.status === 0 && c1.seed - c0.seed === 2 && c1.adapt - c0.adapt === 0, JSON.stringify({ c0, c1, rep: f0.report?.skipped }))
  // ⓑ 회차 상한 — 적응 4 + seed 3 → 적응 2 · seed 3 · 건너뜀 RAW_ADAPT_CAP 2 (cut 아님)
  const f1 = fill(candFile([
    { id: '1100-a', route: 'adapt' }, { id: '1101-a', route: 'adapt' }, { id: '1102-a', route: 'adapt' }, { id: '1103-a', route: 'adapt' },
    { id: '5100-s', route: 'seed' }, { id: '5101-s', route: 'seed' }, { id: '5102-s', route: 'seed' },
  ]), 20)
  const c2 = await countBy()
  check('🔴 🔴 **회차 상한 — 적응 4 후보 중 2 적재 · seed 3 전부 적재**',
    f1.status === 0 && c2.adapt - c1.adapt === RAW_ADAPT_LOAD_CAP_PER_RUN && c2.seed - c1.seed === 3, JSON.stringify({ c1, c2 }))
  check('🔴 상한에 걸린 적응 후보는 건너뜀(RAW_ADAPT_CAP 2) · cut 0 — 이월 파일 자리를 차지하지 않는다',
    f1.report !== null && f1.report.skipped.RAW_ADAPT_CAP === 2 && f1.report.cut === 0, JSON.stringify(f1.report?.skipped ?? null))
  // ⓒ 하루 상한 — 오늘 2 → 이번 2 → 오늘 4
  const f2 = fill(candFile([
    { id: '1200-a', route: 'adapt' }, { id: '1201-a', route: 'adapt' }, { id: '1202-a', route: 'adapt' }, { id: '5200-s', route: 'seed' },
  ]), 20)
  const c3 = await countBy()
  check('🔴 🔴 **하루 상한 — 두 번째 회차 적응 2 더 (오늘 4) · seed 1**',
    f2.status === 0 && c3.adapt - c2.adapt === 2 && c3.seed - c2.seed === 1 && c3.adapt === RAW_ADAPT_LOAD_CAP_PER_DAY, JSON.stringify({ c2, c3 }))
  const f3 = fill(candFile([{ id: '1300-a', route: 'adapt' }, { id: '1301-a', route: 'adapt' }, { id: '5300-s', route: 'seed' }]), 20)
  const c4 = await countBy()
  check('🔴 🔴 **하루 상한 도달 — 세 번째 회차 적응 0 · seed 는 그대로 적재**',
    f3.status === 0 && c4.adapt === c3.adapt && c4.seed - c3.seed === 1 && f3.report?.skipped.RAW_ADAPT_CAP === 2, JSON.stringify({ c3, c4 }))
  const loadedAdapt = await prisma.originalPostApprovalQueue.findMany({
    where: { rawContent: { sourceUrl: { startsWith: 'publish-candidate://' } } }, select: { id: true, gateResults: true, decidedBy: true },
  })
  const la = loadedAdapt.filter((r) => carriesRawAdaptMark(r.gateResults))
  check('🔴 실제 적재된 적응 행 — 격리 표식 · 적응 레인 표식 · 품질 계약 표식 없음 · machine:* 결정',
    la.length === 4 && la.every((r) => {
      const g = r.gateResults as Record<string, unknown>
      return RAW_ADAPT_QUARANTINE_KEY in g && RAW_ADAPT_CONTRACT_KEY in g && !(QUALITY_CONTRACT_KEY in g) && (r.decidedBy ?? '').startsWith('machine:')
    }))

  console.log('\n⑨ 기한 — 읽기 배제 · 청소는 --apply 뒤에만 (예약 없음)')
  const back = async (id: string, days: number): Promise<void> => {
    await prisma.originalPostApprovalQueue.update({ where: { id }, data: { createdAt: new Date(NOW.getTime() - days * DAY) } })
  }
  const oldMachine = await insert({ site: rawPl.syntheticSite, title: `${rt} (기한1)`, body: rb, gateResults: rawG, decidedBy: rawPl.decidedBy })
  const oldFounder = await insert({ site: rawPl.syntheticSite, title: `${rt} (기한2)`, body: rb, gateResults: rawG, decidedBy: MACHINE_REVIEWED_BY })
  const liveMachine = await insert({ site: rawPl.syntheticSite, title: `${rt} (기한3)`, body: rb, gateResults: rawG, decidedBy: rawPl.decidedBy })
  await back(oldMachine, 8)
  await back(oldFounder, 8)
  await back(liveMachine, 1)
  const q = await readRawAdaptQuarantine(prisma, NOW)
  check('🔴 🔴 **읽기 배제 — 기한 지난 적응 행은 살아 있는 격리 행에 없다 · 1일 된 행은 있다**',
    !q.live.some((r) => r.id === oldMachine || r.id === oldFounder) && q.live.some((r) => r.id === liveMachine)
    && q.expired.some((r) => r.id === oldMachine))
  const snapAll = async (): Promise<string> => JSON.stringify(await prisma.originalPostApprovalQueue.findMany({ orderBy: { id: 'asc' } }))
  const s0 = await snapAll()
  const dry = await sweepRawAdaptQuarantine(prisma, NOW, { apply: false })
  check('🔴 청소 계획(write 0) — 대상은 기한 지난 machine:* 적응 행뿐', dry.planned.includes(oldMachine)
    && !dry.planned.includes(oldFounder) && !dry.planned.includes(liveMachine) && (await snapAll()) === s0, JSON.stringify(dry))
  const cliQ = spawnSync(TSX, [join(WORKTREE, 'scripts/raw-adapt-quarantine.mts'), '--sweep'], { cwd: WORKTREE, env: CHILD_ENV, encoding: 'utf-8', timeout: 120_000 })
  check('🔴 CLI `--sweep`(apply 없음) — DB write 0', cliQ.status === 0 && (await snapAll()) === s0, `exit ${cliQ.status}`)
  const cliBad = spawnSync(TSX, [join(WORKTREE, 'scripts/raw-adapt-quarantine.mts'), '--apply'], { cwd: WORKTREE, env: CHILD_ENV, encoding: 'utf-8', timeout: 120_000 })
  check('🔴 CLI `--apply` 만(--sweep 없음) → 멈춘다 · write 0', cliBad.status !== 0 && (await snapAll()) === s0)
  const wet = await sweepRawAdaptQuarantine(prisma, NOW, { apply: true })
  const after9 = await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: [oldMachine, oldFounder, liveMachine] } }, select: { id: true, status: true } })
  const st = (id: string): string => String(after9.find((r) => r.id === id)?.status ?? '?')
  check('🔴 🔴 **청소 apply — 기한 지난 검토 전 적응 행만 EXPIRED · 사람 도장 행 · 살아 있는 행은 그대로**',
    wet.expired.includes(oldMachine) && st(oldMachine) === 'EXPIRED' && st(oldFounder) === 'APPROVED' && st(liveMachine) === 'APPROVED',
    JSON.stringify({ wet, s: [st(oldMachine), st(oldFounder), st(liveMachine)] }))
  const cls9 = (await loadStockClassification(prisma, ON, NOW)).classification
  check('🔴 청소된 행은 재고 분류 어디에도 없다 (APPROVED · EDITED 만 읽는다)',
    !Object.values(cls9.ids).some((xs) => xs.includes(oldMachine)))
  const v4After = await prisma.originalPostApprovalQueue.findMany({ where: { id: { in: v4Ids } }, select: { status: true } })
  check('🔴 청소가 v4 자동 READY 11건을 건드리지 않았다', v4After.length === 11 && v4After.every((r) => r.status === 'APPROVED'))

  await wipeAuditFixtures(prisma)
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 전용 · 운영 DB 0 · 네트워크 0 · LLM 0\n')
  if (fail > 0) process.exit(1)
}

await main()
