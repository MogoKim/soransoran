/**
 * 🔴 **자동 READY 사후 감사 검사용 픽스처 — 격리 Postgres 전용** (2026-09-27)
 *
 *   `auto-ready:audit-db-check` · `auto-ready:defect-http-check` 가 같은 모양의 데이터를 쓴다.
 *   · 증거 30행 — 사람 검토 기록(v2)이 묶인 지금 품질 계약 행 → 열림 판정이 연다
 *   · auto-ready:v1 발행 글 — 도장 · 글(작성자 = 배정 Persona 계정) · 큐 PUBLISHED
 *   · artifact 정본 — 임시 HOME 아래 `*.artifacts.json` · `*.candidates.json` (운영 로더가 읽는 모양 그대로)
 *
 * 🔴 운영 DB 에 붙지 않는다 — `requireIsolatedDb` 가 sentinel · localhost · soran_test 를 모두 요구한다.
 * 🔴 사람 기록(human:*)은 증거 행의 검토 기록만이다(이 표본이 없으면 열림을 시험할 수 없다) —
 *    감사 표에는 사람 기록을 만들지 않는다. 운영자 신고는 HTTP 검사가 서버 액션으로만 만든다.
 * 🔴 Raw SQL 없음 — 청소는 Prisma deleteMany 다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

import { AUTO_DECIDER, AUTO_READY_RECORD_KEY, HUMAN_DECIDER, digestOf, makeStamp, readStamp, auditTarget } from '../../src/lib/auto-ready-v2'
import { EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT, bindingOf } from '../../src/lib/auto-ready-evidence'
import { MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE } from '../../src/lib/micro-seed-supply-autofill'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../../src/lib/quality-contract'

export function requireIsolatedDb(): void {
  const url = process.env.DATABASE_URL ?? ''
  const problems: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(url)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(url)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  if (problems.length > 0) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.')
    for (const p of problems) console.error(`   · ${p}`)
    process.exit(2)
  }
}

/** 🔴 격리 DB 청소 — 이 검사들이 만드는 표만, FK 순서대로 */
export async function wipeAuditFixtures(prisma: PrismaClient): Promise<void> {
  await prisma.autoReadyAudit.deleteMany({})
  await prisma.personaActivityLog.deleteMany({})
  await prisma.originalPostApprovalQueue.deleteMany({})
  await prisma.microSeedRawContent.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.user.deleteMany({})
}

export const GOOD_SR = {
  complete: true, deterministicPass: true,
  unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9,
}
export const FX_CONTRACT = {
  pipelineVersion: 'fx-pipeline-v1', promptVersion: 'fx-prompt-v1',
  stageModels: { speakerPlan: 'gemini-3.7-flash', draftGen: 'gemini-3.7-flash', semanticReview: 'claude-haiku-4.5' },
}

export type Fixture = {
  prisma: PrismaClient
  artifactDir: string
  now: Date
  seq: number
  artifacts: Record<string, unknown>[]
  candidates: Record<string, unknown>[]
}

export function newFixture(prisma: PrismaClient, home: string, now = new Date()): Fixture {
  const artifactDir = join(home, 'Library', 'Application Support', 'soransoran', 'microseed-data')
  mkdirSync(artifactDir, { recursive: true })
  return { prisma, artifactDir, now, seq: 0, artifacts: [], candidates: [] }
}

/** 🔴 artifact 정본 파일을 다시 쓴다 — 운영 로더(`loadArtifactIndex`)가 읽는 모양 그대로 */
export function flushArtifacts(f: Fixture): void {
  writeFileSync(join(f.artifactDir, 'fx-run.artifacts.json'), JSON.stringify(f.artifacts))
  writeFileSync(join(f.artifactDir, 'fx-run.candidates.json'), JSON.stringify({ candidates: f.candidates }))
}

const gateOf = (voiceCode: string | null, extra: Record<string, unknown> = {}) => ({
  holds: [], blocks: [], semanticReview: GOOD_SR, [QUALITY_CONTRACT_KEY]: currentQualityContract(),
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    ...(voiceCode === null ? {} : { voice: { personaCode: voiceCode, bundleDigest: `bd-${voiceCode}`, sourceDigest: 'sd-fx', comments: 3 } }),
    ...extra,
  },
})

async function rawOf(f: Fixture): Promise<{ id: string; base: string }> {
  f.seq += 1
  const base = String(5000 + f.seq)
  const r = await f.prisma.microSeedRawContent.create({
    data: {
      origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:fx`, sourceUrl: `https://example.invalid/fx/${f.seq}`,
      sourceArticleId: `${base}-fx`, sourceCapturedAt: new Date(f.now.getTime() - 2 * 864e5),
      rawTitle: `원문 ${f.seq}`, rawBody: `원문 본문 ${f.seq}`,
    },
    select: { id: true },
  })
  return { id: r.id, base }
}

/**
 * 🔴 증거 30행 — 지금 품질 계약 · 사람 결정(founder 표식) · 발행됨. 이것이 있어야 열림을 시험할 수 있다.
 *    `reviewed: true`(격리 DB 실행 검사) — 기존 `auto-ready:db-check` 와 같은 사람 검토 기록(v2)을 붙인다.
 *    `reviewed: false`(HTTP 검사) — 기록을 붙이지 않는다. 검사가 **관리자 서버 액션**으로 기록한다.
 */
export async function seedEvidence(f: Fixture, n = 30, o: { reviewed?: boolean } = {}): Promise<{ queueId: string; title: string; body: string }[]> {
  const reviewed = o.reviewed ?? true
  const out: { queueId: string; title: string; body: string }[] = []
  const author = (await f.prisma.user.create({ data: { nickname: '증거작성' }, select: { id: true } })).id
  for (let i = 0; i < n; i += 1) {
    const r = await rawOf(f)
    const title = `사람이 본 글 ${i}`
    const body = `사람이 본 본문 ${i}`
    const p = await f.prisma.post.create({ data: { boardType: 'FREE', title, content: body, authorId: author }, select: { id: true } })
    const q = await f.prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: title, draftBody: body,
        gateVerdict: 'PASS', gateResults: gateOf(null) as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: HUMAN_DECIDER, createdPostId: p.id, dedupKey: `fx-ev-${i}`,
        ...(reviewed ? { editDiff: {
          [EVIDENCE_REVIEW_KEY]: [{
            contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', reviewerUserId: 'fixture-founder',
            ...bindingOf({ status: 'PUBLISHED', draftTitle: title, draftBody: body, editedTitle: null, editedBody: null, declineReason: null }),
            hardDefect: 'no', reasons: [], bundleDigest: digestOf('fixture-bundle'), reviewedAt: '2026-09-25T00:00:00Z',
          }],
        } as never } : {}),
      },
      select: { id: true },
    })
    out.push({ queueId: q.id, title, body })
  }
  return out
}

let personaSeq = 0
/** 🔴 Persona code 는 유일하다 — 같은 code 는 같은 사람(같은 계정)이다 */
export async function personaOf(f: Fixture, code: string): Promise<{ id: string; code: string; userId: string }> {
  const had = await f.prisma.persona.findUnique({ where: { code }, select: { id: true, code: true, userId: true } })
  if (had !== null) return had
  personaSeq += 1
  const u = await f.prisma.user.create({ data: { nickname: `fx-${code}-${personaSeq}` }, select: { id: true } })
  const p = await f.prisma.persona.create({ data: { code, userId: u.id, status: 'active' }, select: { id: true, code: true } })
  return { ...p, userId: u.id }
}

export type AutoPost = { queueId: string; postId: string; personaCode: string; artifactId: string; title: string; body: string }

/**
 * 🔴 **auto-ready:v1 로 발행된 글 한 건** — 발행 트랜잭션이 남기는 상태 그대로다:
 *    큐 PUBLISHED · decidedBy auto-ready:v1 · 도장(발행 제목·본문 hash) · createdPostId · 작성자 = 배정 Persona 계정.
 *    artifact 정본에도 그 초안·원문 근거·계획 Persona 를 적는다.
 *    `artifact` 로 결속을 일부러 깨뜨릴 수 있다(없는 artifact · 다른 Persona).
 */
export async function autoPublished(f: Fixture, o: {
  personaCode: string; title: string; body: string; sourceTitle: string; sourceBody: string
  artifact?: 'ok' | 'missing' | 'otherPersona' | 'noEvidence'
  cardCode?: string
}): Promise<AutoPost> {
  const r = await rawOf(f)
  const persona = await personaOf(f, o.personaCode)
  const artifactId = `fx-art-${f.seq}`
  const mode = o.artifact ?? 'ok'
  const post = await f.prisma.post.create({
    data: { boardType: 'FREE', title: o.title, content: o.body, authorId: persona.userId }, select: { id: true },
  })
  const q = await f.prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: o.title, draftBody: o.body, gateVerdict: 'PASS',
      gateResults: gateOf(o.personaCode, {
        artifactId, sourceArticleId: r.base, pipelineVersion: FX_CONTRACT.pipelineVersion,
        draftPromptVersion: FX_CONTRACT.promptVersion, stageModels: FX_CONTRACT.stageModels,
      }) as never,
      promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, decidedBy: AUTO_DECIDER, decidedAt: f.now,
      dedupKey: `fx-auto-${f.seq}`, matchedPersonaId: persona.id, matchedAt: f.now, createdPostId: post.id,
      editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(o.title, o.body, f.now) } as never,
    },
    select: { id: true },
  })
  if (mode !== 'missing') {
    const planCode = mode === 'otherPersona' ? 'P09' : o.personaCode
    f.artifacts.push({
      artifactId, sourceArticleId: r.base, contract: FX_CONTRACT,
      plan: { personaCode: planCode },
      voice: { provenance: { personaCode: planCode, bundleDigest: `bd-${o.personaCode}`, sourceDigest: 'sd-fx' } },
      draft: { title: o.title, body: o.body },
      evidence: { spans: mode === 'noEvidence' ? [] : [{ kind: 'title', text: o.sourceTitle }, { kind: 'head', text: o.sourceBody }] },
      review: {},
    })
    f.candidates.push({ artifactId, sourceArticleId: r.base, sourceSite: 'navercafe:fx' })
    flushArtifacts(f)
  }
  return { queueId: q.id, postId: post.id, personaCode: o.personaCode, artifactId, title: o.title, body: o.body }
}

/**
 * 🔴 **감사 대상으로 고른 상태** — `selectAudits` 가 쓰는 칸 그대로(발행 글 hash · 도장 계약 판).
 *    `selectAudits` 는 ceil(N×0.2) 만 고르므로, 특정 글을 반드시 감사하게 하려고 같은 칸으로 만든다.
 *    실제 `selectAudits` 경로는 검사가 따로 한 번 돌린다.
 */
export async function selectForAudit(f: Fixture, a: AutoPost, selectedAt?: Date): Promise<void> {
  const q = await f.prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.queueId }, select: { editDiff: true } })
  const post = await f.prisma.post.findUniqueOrThrow({ where: { id: a.postId }, select: { title: true, content: true } })
  const n = await f.prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } } })
  await f.prisma.autoReadyAudit.create({
    data: {
      queueId: a.queueId, postId: a.postId, selectedAtN: n, selectedTarget: Math.max(1, auditTarget(n)),
      publishedTitleHash: digestOf(post.title), publishedBodyHash: digestOf(post.content),
      stampContractDigest: readStamp(q.editDiff)?.contractDigest ?? 'missing-stamp',
      ...(selectedAt === undefined ? {} : { selectedAt }),
    },
  })
}

/** 🔴 발행 대기 기계 행 — 도장·발행 게이트를 실제로 두드려 볼 행(배정된 새 Persona) */
export async function machineRow(f: Fixture, code: string): Promise<{ id: string }> {
  const r = await rawOf(f)
  const persona = await personaOf(f, code)
  return f.prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `평범한 하루 이야기 ${f.seq}`,
      draftBody: `아침에 산책을 다녀왔어요 ${f.seq}. 다들 어떻게 지내세요?`,
      gateVerdict: 'PASS', gateResults: gateOf(code) as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
      decidedBy: 'machine:auto-draft-v5', dedupKey: `fx-m-${f.seq}`, matchedPersonaId: persona.id, matchedAt: f.now,
    },
    select: { id: true },
  })
}
