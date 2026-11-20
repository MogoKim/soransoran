#!/usr/bin/env tsx
/**
 * Persona 목소리 댓글 — D100 시스템 무영향 증명 (격리 Postgres 전용)
 *
 * `createPersonaVoiceCommentTx` 가 D100 자동 레인(단계 증거 · 댓글 예산 · 추가 댓글 대상)에
 * 영향을 주지 않음을 실제 D100 함수로 검증한다.
 *
 * 스냅 5항목 (before/after 동일):
 *   ① 오늘 PERSONA 댓글 수
 *   ② 7일 창 persona:real 비율 (windowFromRows)
 *   ③ 단계 증거 판정 JSON (judgeStageEvidence)
 *   ④ 추가 댓글 대상 글 수 (레인 창 24시간 내 Persona 발행 글)
 *   ⑤ 운영자 이름 목록 (OPERATOR_NAME_WRITER_WHERE)
 *
 * 🔴 운영 DB 에 절대 붙이지 않는다 — 가드가 주소와 플래그를 확인한다.
 *
 * 실행:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55432/soran_test \
 *   DIRECT_URL=postgresql://postgres@127.0.0.1:55432/soran_test \
 *   SORAN_ISOLATED_DB=yes-throwaway \
 *   npx tsx --tsconfig tsconfig.ops.json scripts/operator-persona-voice-db-check.mts
 */
import { PrismaClient, type Prisma } from '@prisma/client'

import { createPersonaVoiceCommentTx } from '../src/lib/operator-persona-voice-tx'
import { readStageEvidenceFacts } from '../src/lib/stage-evidence-repo'
import {
  judgeStageEvidence,
  FOLLOWUP_LANE_DECIDED_BY,
  FOLLOWUP_LANE_ACTIVITY_DECIDED_BY,
  type StageEvidenceFacts,
} from '../src/lib/stage-evidence'
import { AUTO_LANE_DECIDED_BY, AUTO_LANE_ACTIVITY_DECIDED_BY } from '../src/lib/persona-comment-auto-lane'
import { UNATTENDED_PUBLISH_DECIDED_BY } from '../src/lib/original-post-publish-tx'
import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { windowFromRows } from '../src/lib/persona-comment-governor'
import { kstDayStart } from '../src/lib/persona-cap'
import { OPERATOR_NAME_WRITER_WHERE } from '../src/lib/queries/operator-compose'

// ── 가드 ──────────────────────────────────────────────────────────────────
const URL_ = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway')
  problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL_))
  problems.push('DATABASE_URL 이 localhost 주소가 아니다')
if (!/\/soran_test(\?|$)/.test(URL_))
  problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}

// ── 테스트 프레임워크 ──────────────────────────────────────────────────────
let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`  ✅ ${name}`)
  } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const prisma = new PrismaClient()

// ── 시각 상수 ──────────────────────────────────────────────────────────────
const HOUR_MS = 3_600_000
const MIN_MS = 60_000
/**
 * 🔴 증명일 D = 실행 시점의 **어제(KST)** — 날짜를 박아 두면 며칠 뒤 CI 에서 7일 창 기준값이 저절로 깨진다(시한폭탄).
 *    Persona 목소리 댓글의 createdAt 은 DB 가 실제 현재 시각으로 넣으므로, 측정 창도 실제 현재 시각 기준이어야 한다.
 */
const WALL_START = new Date()
const D_KST = new Date(WALL_START.getTime() + 9 * HOUR_MS - 24 * HOUR_MS).toISOString().slice(0, 10)
/** D 09:00 KST — 자동 글 A 발행 시각 */
const T0 = new Date(`${D_KST}T09:00:00+09:00`)
/** D 09:10 KST — 자동 첫 댓글 · 회원 댓글 시각 */
const T0_10M = new Date(T0.getTime() + 10 * MIN_MS)
/** D 11:00 KST — 추가 댓글 시각 */
const T0_2H = new Date(T0.getTime() + 2 * HOUR_MS)
/** D+1 11:00 KST — 스냅 기준 시각 (25h 창 밖, 조용한 시간 밖) */
const T0_26H = new Date(T0.getTime() + 26 * HOUR_MS)
/** D+1 07:00 KST — 조용한 시간(06:30~08:30) 안 */
const T_QUIET = new Date(T0.getTime() + 22 * HOUR_MS)

// ── FK 순서 초기화 ─────────────────────────────────────────────────────────
async function wipe(): Promise<void> {
  await prisma.autoReadyAudit.deleteMany({})
  await prisma.report.deleteMany({})
  await prisma.operatorWriteLog.deleteMany({})
  await prisma.comment.deleteMany({ where: { parentId: { not: null } } })
  await prisma.comment.deleteMany({})
  await prisma.personaApprovalQueue.deleteMany({})
  await prisma.personaActivityLog.deleteMany({})
  await prisma.originalPostApprovalQueue.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.microSeedRawContent.deleteMany({})
  await prisma.userBlock.deleteMany({})
  await prisma.operatorWriter.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.account.deleteMany({})
  await prisma.user.deleteMany({})
  await prisma.stageDecision.deleteMany({})
}

// ── 자동 레인 댓글 헬퍼 (stage-evidence-db-check.mts 와 같은 모양) ──────────
let linkSeq = 0
async function autoComment(args: {
  data: Prisma.CommentUncheckedCreateInput & { personaId: string; createdAt: Date }
}): Promise<{ id: string }> {
  const c = await prisma.comment.create({ data: args.data, select: { id: true } })
  linkSeq += 1
  const at = args.data.createdAt
  await prisma.personaApprovalQueue.create({
    data: {
      personaId: args.data.personaId,
      targetPostId: args.data.postId as string,
      status: 'PUBLISHED',
      candidateText: 'fx',
      reactionType: 'empathy',
      gateStatus: 'pass',
      gateResults: [],
      dedupKey: `pv-auto-${linkSeq}-${c.id}`,
      decidedBy: AUTO_LANE_DECIDED_BY,
      decidedAt: at,
      publishedCommentId: c.id,
    },
  })
  await prisma.personaActivityLog.create({
    data: {
      personaId: args.data.personaId,
      kind: 'comment',
      targetId: c.id,
      gateStatus: 'pass',
      decidedBy: AUTO_LANE_ACTIVITY_DECIDED_BY,
      publishedAt: at,
      createdAt: at,
    },
  })
  return c
}

// ── 추가 댓글 레인 헬퍼 ────────────────────────────────────────────────────
async function followupComment(
  postId: string,
  parentId: string,
  personaId: string,
  authorId: string,
  createdAt: Date,
): Promise<{ id: string }> {
  const c = await prisma.comment.create({
    data: {
      content: '그 얘기 더 듣고 싶어요',
      source: 'SYSTEM',
      commentOrigin: 'PERSONA',
      postId,
      parentId,
      authorId,
      personaId,
      createdAt,
    },
    select: { id: true },
  })
  linkSeq += 1
  await prisma.personaApprovalQueue.create({
    data: {
      personaId,
      targetPostId: postId,
      status: 'PUBLISHED',
      candidateText: 'fx',
      reactionType: 'question',
      gateStatus: 'pass',
      gateResults: [],
      dedupKey: `pv-fu-${linkSeq}-${c.id}`,
      decidedBy: FOLLOWUP_LANE_DECIDED_BY,
      decidedAt: createdAt,
      publishedCommentId: c.id,
    },
  })
  await prisma.personaActivityLog.create({
    data: {
      personaId,
      kind: 'comment',
      targetId: c.id,
      gateStatus: 'pass',
      decidedBy: FOLLOWUP_LANE_ACTIVITY_DECIDED_BY,
      publishedAt: createdAt,
      createdAt,
    },
  })
  return c
}

// ── 스냅 타입 ─────────────────────────────────────────────────────────────
type SnapResult = {
  /** ① 오늘 PERSONA 댓글 수 */
  todayPersonaCommentCount: number
  /** 🔴 같은 창의 OPERATOR 댓글 수 — 측정 창이 Persona 목소리 댓글을 실제로 담았는지(빈 시험 방지) */
  todayOperatorCommentCount: number
  /** 🔴 7일 창에 담긴 OPERATOR 행 수 — 같은 이유 */
  govOperatorRows: number
  /** ② 7일 창 persona:real 비율 */
  govWindow: { measured: boolean; real: number; persona: number }
  /** ③ 단계 증거 판정 JSON */
  verdictJson: string
  /** ④ 추가 댓글 대상 글 수 */
  followupEligibleCount: number
  /** ⑤ 운영자 이름 목록 코드 */
  operatorWriterCodes: string[]
  /** S3 비교용 — 판정 facts 원본 */
  _facts: StageEvidenceFacts
}

async function snap(now: Date): Promise<SnapResult> {
  // 🔴 ①② 는 운영 코드처럼 **실제 현재 시각** 기준이다 — 댓글 createdAt 은 DB 기본값(실제 시각)이다
  const wallNow = new Date()
  // ① 오늘 PERSONA 댓글 수 — persona-publish-tx 하루 예산과 같은 where(commentOrigin · kstDayStart)
  const todayStart = kstDayStart(wallNow)
  const todayPersonaCommentCount = await prisma.comment.count({
    where: { commentOrigin: 'PERSONA', createdAt: { gte: todayStart } },
  })
  const todayOperatorCommentCount = await prisma.comment.count({
    where: { commentOrigin: 'OPERATOR', createdAt: { gte: todayStart } },
  })

  // ② 7일 창 persona:real 비율
  const windowStart = new Date(wallNow.getTime() - 7 * 24 * HOUR_MS)
  const rows = await prisma.comment.findMany({
    where: { isDeleted: false, createdAt: { gte: windowStart, lte: wallNow } },
    select: { commentOrigin: true, personaId: true },
  })
  const govWindow = windowFromRows(rows, 7)
  const govOperatorRows = rows.filter((r) => r.commentOrigin === 'OPERATOR').length

  // ③ 단계 증거 판정 JSON
  const _facts = await readStageEvidenceFacts(prisma, {
    kstDate: D_KST,
    stage: 'd20',
    decision: null,
    now,

  })
  const verdict = judgeStageEvidence(D_KST, 'd20', _facts, null)
  const verdictJson = JSON.stringify(verdict)

  // ④ 추가 댓글 대상 글 수 (레인 창 24시간 내 Persona 발행 글)
  const followupWindowStart = new Date(now.getTime() - 24 * HOUR_MS)
  const followupEligibleCount = await prisma.post.count({
    where: {
      status: 'PUBLISHED',
      personaId: { not: null },
      OR: [
        { publishAt: { gte: followupWindowStart, lte: now } },
        { publishAt: null, createdAt: { gte: followupWindowStart, lte: now } },
      ],
    },
  })

  // ⑤ 운영자 이름 목록
  const operatorWriters = await prisma.operatorWriter.findMany({
    where: OPERATOR_NAME_WRITER_WHERE,
    select: { code: true },
    orderBy: { code: 'asc' },
  })
  const operatorWriterCodes = operatorWriters.map((w) => w.code)

  return {
    todayPersonaCommentCount,
    todayOperatorCommentCount,
    govOperatorRows,
    govWindow: {
      measured: govWindow.measured,
      real: govWindow.real,
      persona: govWindow.persona,
    },
    verdictJson,
    followupEligibleCount,
    operatorWriterCodes,
    _facts,
  }
}

async function main(): Promise<void> {
  console.log('\n🔵 operator-persona-voice-db-check 시작\n')
  console.log('   격리 확인됨 (SORAN_ISOLATED_DB · localhost · soran_test)\n')

  await wipe()

  // ══════════════════════════════════════════════════════════════════════
  // 고정 픽스처 생성
  // ══════════════════════════════════════════════════════════════════════
  console.log('── 픽스처 생성')

  // 운영자 actorUser (관리자)
  const adminUser = await prisma.user.create({
    data: { nickname: '운영자', isAdmin: true },
    select: { id: true },
  })

  // P01 — 활동 중 Persona (PV 행 없음)
  const p1User = await prisma.user.create({ data: { nickname: 'P01사용자' }, select: { id: true } })
  const p1 = await prisma.persona.create({
    data: { code: 'P01', userId: p1User.id, status: 'active' },
    select: { id: true },
  })

  // P02 — 활동 중 Persona (PV 행 없음)
  const p2User = await prisma.user.create({ data: { nickname: 'P02사용자' }, select: { id: true } })
  const p2 = await prisma.persona.create({
    data: { code: 'P02', userId: p2User.id, status: 'active' },
    select: { id: true },
  })

  // P03 — 일시 정지 Persona
  const p3User = await prisma.user.create({ data: { nickname: 'P03사용자' }, select: { id: true } })
  const p3 = await prisma.persona.create({
    data: { code: 'P03', userId: p3User.id, status: 'paused' },
    select: { id: true },
  })

  // P04 — 활동 중 Persona (PV 행 없음 — 거절 경로에서 PV 행이 생기지 않음을 증명)
  const p4User = await prisma.user.create({ data: { nickname: 'P04사용자' }, select: { id: true } })
  const p4 = await prisma.persona.create({
    data: { code: 'P04', userId: p4User.id, status: 'active' },
    select: { id: true },
  })

  // M — 실회원 (카카오 Account)
  const mUser = await prisma.user.create({ data: { nickname: '실회원M' }, select: { id: true } })
  await prisma.account.create({
    data: { userId: mUser.id, type: 'oauth', provider: 'kakao', providerAccountId: 'pv-check-m-01' },
    select: { id: true },
  })

  // OP01 — 운영자 이름 작성자
  const op01User = await prisma.user.create({ data: { nickname: 'OP01사용자' }, select: { id: true } })
  const op01Writer = await prisma.operatorWriter.create({
    data: { code: 'OP01', userId: op01User.id },
    select: { id: true },
  })

  // 자동 글 A — P01 발행, 증명일 D 09:00 KST (PersonaActivityLog + OriginalPostApprovalQueue 포함)
  const rawContent = await prisma.microSeedRawContent.create({
    data: {
      origin: 'live',
      sourceSite: 'pv-check-fixture',
      sourceUrl: 'https://example.invalid/pv-a',
      sourceArticleId: 'pv-check-a-001',
      sourceCapturedAt: T0,
      rawTitle: '자동 글 A 원문',
      rawBody: '자동 글 A 원문 본문',
    },
    select: { id: true },
  })
  const postA = await prisma.post.create({
    data: {
      boardType: 'MENOPAUSE',
      title: '자동 글 A',
      content: 'P01 이 자동으로 쓴 글',
      status: 'PUBLISHED',
      source: 'SYSTEM',
      authorId: p1User.id,
      personaId: p1.id,
      isMicroSeed: false,
      permanentNoindex: false,
      indexPromotionBlocked: false,
      publishAt: T0,
      createdAt: T0,
    },
    select: { id: true },
  })
  // PersonaActivityLog — kind=post, UNATTENDED 표식
  await prisma.personaActivityLog.create({
    data: {
      personaId: p1.id,
      kind: 'post',
      targetId: postA.id,
      gateStatus: 'PASS',
      decidedBy: UNATTENDED_PUBLISH_DECIDED_BY,
      publishedAt: T0,
      createdAt: T0,
    },
  })
  // OriginalPostApprovalQueue — PUBLISHED, AUTO_DECIDER
  await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: rawContent.id,
      draftTitle: '자동 글 A',
      draftBody: 'P01 이 자동으로 쓴 글',
      gateVerdict: 'PASS',
      gateResults: {},
      promptVersion: 'fx-pv',
      model: 'fx-pv',
      status: 'PUBLISHED',
      decidedBy: AUTO_DECIDER,
      decidedAt: T0,
      createdPostId: postA.id,
      matchedPersonaId: p1.id,
      dedupKey: `pv-check-a-${postA.id}`,
    },
  })

  // 자동 첫 댓글 — P02 → A, D 09:10 KST
  const autoFirst = await autoComment({
    data: {
      content: 'P02 첫 댓글',
      source: 'SYSTEM',
      commentOrigin: 'PERSONA',
      postId: postA.id,
      authorId: p2User.id,
      personaId: p2.id,
      createdAt: T0_10M,
    },
  })

  // 추가 댓글 (followup) — P02 → A, D 11:00 KST
  await followupComment(postA.id, autoFirst.id, p2.id, p2User.id, T0_2H)

  // 회원 글 G — M 작성
  const postG = await prisma.post.create({
    data: {
      boardType: 'FREE',
      title: '회원 글 G',
      content: '실회원이 직접 쓴 글',
      status: 'PUBLISHED',
      source: 'USER',
      authorId: mUser.id,
      isMicroSeed: false,
      permanentNoindex: false,
      indexPromotionBlocked: false,
      publishAt: T0_10M,
      createdAt: T0_10M,
    },
    select: { id: true },
  })
  // 회원 댓글 — 7일 창 real 분모용 (createdAt 명시 → snap(T0_26H) 창 안)
  await prisma.comment.create({
    data: {
      postId: postG.id,
      authorId: mUser.id,
      content: '회원 댓글',
      commentOrigin: 'MEMBER',
      source: 'USER',
      createdAt: T0_10M,
    },
    select: { id: true },
  })

  // 운영자 이름 글 O — OP01 작성
  const postO = await prisma.post.create({
    data: {
      boardType: 'FREE',
      title: '운영자 이름 글 O',
      content: '운영자가 직접 쓴 글',
      status: 'PUBLISHED',
      source: 'USER',
      authorId: op01User.id,
      operatorWriterId: op01Writer.id,
      isMicroSeed: false,
      permanentNoindex: false,
      indexPromotionBlocked: false,
      publishAt: T0_10M,
      createdAt: T0_10M,
    },
    select: { id: true },
  })

  console.log('   픽스처 생성 완료\n')

  // ══════════════════════════════════════════════════════════════════════
  // S0 — PV 댓글 추가 전 스냅
  // ══════════════════════════════════════════════════════════════════════
  console.log('── S0: 기준 스냅 (before)')
  const before = await snap(T0_26H)
  console.log(`   ① 오늘 PERSONA 댓글=${before.todayPersonaCommentCount}`)
  console.log(`   ② 7일 창 persona=${before.govWindow.persona} real=${before.govWindow.real} measured=${before.govWindow.measured}`)
  console.log(`   ③ 판정 verdict=${JSON.parse(before.verdictJson).verdict}`)
  console.log(`   ④ 추가 댓글 대상 글=${before.followupEligibleCount}`)
  console.log(`   ⑤ 운영자 이름 목록=${JSON.stringify(before.operatorWriterCodes)}`)

  check('S0-A 오늘 PERSONA 댓글 0 (fixture 댓글은 전날)',
    before.todayPersonaCommentCount === 0,
    `count=${before.todayPersonaCommentCount}`,
  )
  check('S0-B 7일 창 persona=2 (첫댓글+추가댓글), real=1 (회원댓글)',
    before.govWindow.persona === 2 && before.govWindow.real === 1,
    `persona=${before.govWindow.persona} real=${before.govWindow.real}`,
  )
  check('S0-C 추가 댓글 대상 글 0 (A 는 24시간 창 밖)',
    before.followupEligibleCount === 0,
    `count=${before.followupEligibleCount}`,
  )
  check('S0-D 운영자 이름 목록 = [OP01]',
    JSON.stringify(before.operatorWriterCodes) === JSON.stringify(['OP01']),
    `actual=${JSON.stringify(before.operatorWriterCodes)}`,
  )

  // ══════════════════════════════════════════════════════════════════════
  // S1 — PV 댓글 3건 등록
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── S1: Persona 목소리 댓글 등록')

  // P01 → G (회원 글)
  const s1r1 = await createPersonaVoiceCommentTx(prisma, {
    personaId: p1.id,
    postId: postG.id,
    content: 'P01 목소리 — 회원 글에',
    actorUserId: adminUser.id,
    requestKey: 's1-p1-g',
    now: T0_26H,
  })
  check('S1-A P01→G (회원 글) → created', s1r1.kind === 'created', `kind=${s1r1.kind}`)

  // P02 → A (자동 Persona 글, 26시간 경과)
  const s1r2 = await createPersonaVoiceCommentTx(prisma, {
    personaId: p2.id,
    postId: postA.id,
    content: 'P02 목소리 — 자동 글에',
    actorUserId: adminUser.id,
    requestKey: 's1-p2-a',
    now: T0_26H,
  })
  check('S1-B P02→A (자동 글, 26h 경과) → created', s1r2.kind === 'created', `kind=${s1r2.kind}`)

  // P01 → O (운영자 이름 글)
  const s1r3 = await createPersonaVoiceCommentTx(prisma, {
    personaId: p1.id,
    postId: postO.id,
    content: 'P01 목소리 — 운영자 이름 글에',
    actorUserId: adminUser.id,
    requestKey: 's1-p1-o',
    now: T0_26H,
  })
  check('S1-C P01→O (운영자 이름 글) → created', s1r3.kind === 'created', `kind=${s1r3.kind}`)

  // PV01, PV02 행 생성 확인
  const pv1Row = await prisma.operatorWriter.findFirst({ where: { code: 'PV01', userId: p1User.id } })
  const pv2Row = await prisma.operatorWriter.findFirst({ where: { code: 'PV02', userId: p2User.id } })
  check('S1-D PV01 행 생성됨', pv1Row !== null, 'PV01 없음')
  check('S1-E PV02 행 생성됨', pv2Row !== null, 'PV02 없음')

  // PV 댓글 commentOrigin=OPERATOR 확인
  if (s1r1.kind === 'created') {
    const c1 = await prisma.comment.findUnique({ where: { id: s1r1.targetId }, select: { commentOrigin: true, personaId: true } })
    check('S1-F PV 댓글 commentOrigin=OPERATOR', c1?.commentOrigin === 'OPERATOR', `origin=${c1?.commentOrigin}`)
    check('S1-G PV 댓글 personaId=null', c1?.personaId === null, `personaId=${c1?.personaId}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // S2 — 거절 8가지
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── S2: 거절 케이스')

  // S2-A: 조용한 시간 창 (06:30~08:30 KST)
  {
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p1.id, postId: postG.id, content: '조용한 시간', actorUserId: adminUser.id,
      requestKey: 's2-quiet', now: T_QUIET,
    })
    check('S2-A 조용한 시간(07:00 KST) → blocked', r.kind === 'blocked', `kind=${r.kind}`)
  }

  // S2-B: 일시 정지 Persona (P03)
  {
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p3.id, postId: postG.id, content: 'P03 목소리', actorUserId: adminUser.id,
      requestKey: 's2-paused', now: T0_26H,
    })
    check('S2-B P03 일시 정지 → blocked (NOT_ACTIVE)', r.kind === 'blocked', `kind=${r.kind}`)
    const pv3Row = await prisma.operatorWriter.findFirst({ where: { code: 'PV03' } })
    check('S2-B PV03 행 없음 (거절 → PV 행 미생성)', pv3Row === null)
  }

  // S2-C: PENDING 신고가 있는 Persona (P01 계정의 글에 신고 생성)
  {
    const report = await prisma.report.create({
      data: { reporterId: adminUser.id, reason: 'pv-check-test', postId: postA.id, status: 'PENDING' },
      select: { id: true },
    })
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p1.id, postId: postG.id, content: 'P01 신고 중', actorUserId: adminUser.id,
      requestKey: 's2-pending-report', now: T0_26H,
    })
    check('S2-C PENDING 신고 있으면 → blocked (PENDING_REPORT)', r.kind === 'blocked', `kind=${r.kind}`)
    await prisma.report.delete({ where: { id: report.id } })
  }

  // S2-D: 숨김 글 (NOT_PUBLIC)
  {
    const hiddenPost = await prisma.post.create({
      data: {
        boardType: 'FREE', title: '숨김 글', content: '숨김', status: 'HIDDEN',
        source: 'USER', authorId: mUser.id,
        isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false,
      },
      select: { id: true },
    })
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p1.id, postId: hiddenPost.id, content: '숨김 글에', actorUserId: adminUser.id,
      requestKey: 's2-hidden', now: T0_26H,
    })
    check('S2-D 숨김 글 → blocked (NOT_PUBLIC)', r.kind === 'blocked', `kind=${r.kind}`)
  }

  // S2-E: 매거진 글 (NOT_BOARD)
  {
    const magazinePost = await prisma.post.create({
      data: {
        boardType: 'MAGAZINE', title: '매거진 글', content: '매거진', status: 'PUBLISHED',
        source: 'USER', authorId: mUser.id,
        isMicroSeed: false, permanentNoindex: true, indexPromotionBlocked: true,
      },
      select: { id: true },
    })
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p1.id, postId: magazinePost.id, content: '매거진에', actorUserId: adminUser.id,
      requestKey: 's2-magazine', now: T0_26H,
    })
    check('S2-E 매거진 글 → blocked (NOT_BOARD)', r.kind === 'blocked', `kind=${r.kind}`)
  }

  // S2-F: Micro Seed 글 (MICRO_SEED)
  {
    const microPost = await prisma.post.create({
      data: {
        boardType: 'FREE', title: 'Micro Seed 글', content: '외부 원문', status: 'PUBLISHED',
        source: 'SYSTEM', authorId: p1User.id, personaId: p1.id,
        isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true,
      },
      select: { id: true },
    })
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p2.id, postId: microPost.id, content: '마이크로 시드에', actorUserId: adminUser.id,
      requestKey: 's2-micro-seed', now: T0_26H,
    })
    check('S2-F Micro Seed 글 → blocked (MICRO_SEED)', r.kind === 'blocked', `kind=${r.kind}`)
  }

  // S2-G: TOO_EARLY — P04 (PV 행 없음), 10시간짜리 Persona 글에 도전
  {
    const youngPostTime = new Date(T0_26H.getTime() - 10 * HOUR_MS)
    const youngPost = await prisma.post.create({
      data: {
        boardType: 'MENOPAUSE', title: '10시간 된 자동 글', content: '아직 이르다', status: 'PUBLISHED',
        source: 'SYSTEM', authorId: p1User.id, personaId: p1.id,
        isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false,
        publishAt: youngPostTime, createdAt: youngPostTime,
      },
      select: { id: true },
    })
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p4.id, postId: youngPost.id, content: 'P04 목소리', actorUserId: adminUser.id,
      requestKey: 's2-too-early-p4', now: T0_26H,
    })
    check('S2-G 10h 자동 글 P04 → blocked (TOO_EARLY)', r.kind === 'blocked', `kind=${r.kind}`)
    const pv4Row = await prisma.operatorWriter.findFirst({ where: { code: 'PV04' } })
    check('S2-G PV04 행 없음 — 거절은 PV 행 생성 전에 일어난다', pv4Row === null)
  }

  // S2-H: 차단 — 글쓴이(p1User)가 P02(p2User)를 차단
  {
    await prisma.userBlock.create({
      data: { blockerId: p1User.id, blockedUserId: p2User.id },
    })
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p2.id, postId: postA.id, content: 'P02 차단됨', actorUserId: adminUser.id,
      requestKey: 's2-blocked-p2', now: T0_26H,
    })
    check('S2-H 글쓴이가 P02 차단 → blocked', r.kind === 'blocked', `kind=${r.kind}`)
    await prisma.userBlock.deleteMany({ where: { blockerId: p1User.id, blockedUserId: p2User.id } })
  }

  // S2 임시 글 정리 — after 스냅 전에 삭제
  // youngPost(S2-G): publishAt = T0_26H-10h → 추가 댓글 24h 창 안에 들어가 followupEligibleCount 를 오염시킨다
  // microPost(S2-F): personaId 있음 + publishAt null → wall-clock createdAt 이 창 안에 들어갈 수 있다
  await prisma.post.deleteMany({
    where: { title: { in: ['10시간 된 자동 글', 'Micro Seed 글'] } },
  })

  // ══════════════════════════════════════════════════════════════════════
  // S3 — PV 댓글 추가 후 스냅 비교
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── S3: S1 이후 스냅 비교')
  const after = await snap(T0_26H)

  check('S3-A 판정 JSON 동일 — OPERATOR 댓글은 verdict 에 영향 없음',
    before.verdictJson === after.verdictJson,
    `before=${before.verdictJson.slice(0, 80)} after=${after.verdictJson.slice(0, 80)}`,
  )
  check('S3-B ① 오늘 PERSONA 댓글 수 동일',
    before.todayPersonaCommentCount === after.todayPersonaCommentCount,
    `before=${before.todayPersonaCommentCount} after=${after.todayPersonaCommentCount}`,
  )
  // 🔴 빈 시험 방지 — 측정 창이 S1 의 Persona 목소리 댓글 3건을 실제로 담았는가
  check('S3-0a ① 측정 창에 Persona 목소리 댓글 3건이 들어왔다(OPERATOR +3)',
    after.todayOperatorCommentCount === before.todayOperatorCommentCount + 3,
    `before=${before.todayOperatorCommentCount} after=${after.todayOperatorCommentCount}`)
  check('S3-0b ② 7일 창에 Persona 목소리 댓글 3건이 들어왔다(OPERATOR 행 +3) · 그래도 measured 유지',
    after.govOperatorRows === before.govOperatorRows + 3 && after.govWindow.measured === true,
    `before=${before.govOperatorRows} after=${after.govOperatorRows} measured=${after.govWindow.measured}`)
  check('S3-C ② 7일 창 persona 수 동일',
    before.govWindow.persona === after.govWindow.persona,
    `before=${before.govWindow.persona} after=${after.govWindow.persona}`,
  )
  check('S3-D ② 7일 창 real 수 동일',
    before.govWindow.real === after.govWindow.real,
    `before=${before.govWindow.real} after=${after.govWindow.real}`,
  )
  check('S3-E ④ 추가 댓글 대상 글 수 동일',
    before.followupEligibleCount === after.followupEligibleCount,
    `before=${before.followupEligibleCount} after=${after.followupEligibleCount}`,
  )
  check('S3-F ⑤ 운영자 이름 목록 동일 (PV 행 제외)',
    JSON.stringify(before.operatorWriterCodes) === JSON.stringify(after.operatorWriterCodes),
    `before=${JSON.stringify(before.operatorWriterCodes)} after=${JSON.stringify(after.operatorWriterCodes)}`,
  )

  // facts 비교 — conversationComments 에 OPERATOR 행 추가됨, personaComments 불변
  const beforeA = before._facts.posts.find((p) => p.postId === postA.id)
  const afterA = after._facts.posts.find((p) => p.postId === postA.id)
  const beforeConv = beforeA?.conversationComments
  const afterConv = afterA?.conversationComments
  check('S3-G0 postA 대화 장부가 있다(없으면 아래 비교가 빈 시험)', beforeConv !== undefined && afterConv !== undefined)
  if (beforeA !== undefined && afterA !== undefined && beforeConv !== undefined && afterConv !== undefined) {
    check('S3-G postA conversationComments 1개 증가 (OPERATOR PV 댓글)',
      afterConv.length === beforeConv.length + 1,
      `before=${beforeConv.length} after=${afterConv.length}`,
    )
    const addedRow = afterConv.find(
      (c) => !beforeConv.some((bc) => bc.id === c.id),
    )
    check('S3-H 추가된 행 commentOrigin=OPERATOR',
      addedRow?.commentOrigin === 'OPERATOR',
      `origin=${addedRow?.commentOrigin}`,
    )
    check('S3-I postA personaComments JSON 동일 (verdict 입력 불변)',
      JSON.stringify(afterA.personaComments) === JSON.stringify(beforeA.personaComments),
    )
  } else {
    check('S3-G postA facts 에서 발견됨', beforeA !== undefined && afterA !== undefined,
      `beforeA=${beforeA !== undefined} afterA=${afterA !== undefined}`)
  }

  // ══════════════════════════════════════════════════════════════════════
  // S5 — 동시 첫 PV 댓글 (P04 — PV 행 없음에서 출발)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── S5: 동시 PV 댓글 (P04)')

  const [s5r1, s5r2] = await Promise.all([
    createPersonaVoiceCommentTx(prisma, {
      personaId: p4.id, postId: postG.id, content: 'P04 동시 1',
      actorUserId: adminUser.id, requestKey: 's5-p4-concurrent-1', now: T0_26H,
    }),
    createPersonaVoiceCommentTx(prisma, {
      personaId: p4.id, postId: postG.id, content: 'P04 동시 2',
      actorUserId: adminUser.id, requestKey: 's5-p4-concurrent-2', now: T0_26H,
    }),
  ])
  check('S5-A 동시 요청 둘 다 created', s5r1.kind === 'created' && s5r2.kind === 'created',
    `r1=${s5r1.kind} r2=${s5r2.kind}`)
  const pv4After = await prisma.operatorWriter.count({ where: { code: 'PV04', userId: p4User.id } })
  check('S5-B PV04 행 정확히 1개 (skipDuplicates 중복 없음)', pv4After === 1, `count=${pv4After}`)

  // ══════════════════════════════════════════════════════════════════════
  // S6 — 중복 requestKey
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── S6: 중복 requestKey')

  const s6Input = {
    personaId: p1.id, postId: postG.id, content: '중복 테스트',
    actorUserId: adminUser.id, requestKey: 's6-dup-key-001', now: T0_26H,
  }
  const s6r1 = await createPersonaVoiceCommentTx(prisma, s6Input)
  const s6r2 = await createPersonaVoiceCommentTx(prisma, s6Input)
  check('S6-A 첫 번째 요청 → created', s6r1.kind === 'created', `kind=${s6r1.kind}`)
  check('S6-B 같은 requestKey 재전송 → duplicate', s6r2.kind === 'duplicate', `kind=${s6r2.kind}`)

  // ══════════════════════════════════════════════════════════════════════
  // S8 — Persona User 에 다른 코드의 작성자 행(손으로 만든 OP)이 이미 있으면 막고, 원인을 말한다 · write 0
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── S8: 어긋난 작성자 행')
  {
    const p6User = await prisma.user.create({ data: { nickname: '어긋난행' }, select: { id: true } })
    const p6 = await prisma.persona.create({ data: { code: 'P06', userId: p6User.id, status: 'active' }, select: { id: true } })
    await prisma.operatorWriter.create({ data: { code: 'OP77', userId: p6User.id } })
    const commentsBefore = await prisma.comment.count()
    const r = await createPersonaVoiceCommentTx(prisma, {
      personaId: p6.id, postId: postG.id, content: '어긋난 행으로 시도',
      actorUserId: adminUser.id, requestKey: 's8-mismatch', now: T0_26H,
    })
    check('S8-A 다른 코드의 작성자 행 → blocked · 원인(지금 행 OP77 · 기대 PV06)을 말한다',
      r.kind === 'blocked' && r.message.includes('OP77') && r.message.includes('PV06'), `kind=${r.kind} ${r.kind === 'blocked' ? r.message : ''}`)
    check('S8-B 댓글 write 0 · PV06 행 생성 0',
      (await prisma.comment.count()) === commentsBefore && (await prisma.operatorWriter.count({ where: { code: 'PV06' } })) === 0)
  }

  // ══════════════════════════════════════════════════════════════════════
  // S7 — 운영자 이름 목록에 PV 행 없음
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── S7: 운영자 이름 목록 PV 제외')

  const allWriters = await prisma.operatorWriter.findMany({
    select: { code: true, status: true },
    orderBy: { code: 'asc' },
  })
  const pvRows = allWriters.filter((w) => w.code.startsWith('PV'))
  const opRows = allWriters.filter((w) => w.code.startsWith('OP'))
  console.log(`   전체 OperatorWriter: ${JSON.stringify(allWriters.map((w) => w.code))}`)

  const nameList = await prisma.operatorWriter.findMany({
    where: OPERATOR_NAME_WRITER_WHERE,
    select: { code: true },
    orderBy: { code: 'asc' },
  })
  check('S7-A PV 행이 존재한다 (S1·S5 에서 생성됨)', pvRows.length > 0, `pvCount=${pvRows.length}`)
  check('S7-B OPERATOR_NAME_WRITER_WHERE 결과에 PV 행 없음',
    nameList.every((w) => !w.code.startsWith('PV')),
    `list=${JSON.stringify(nameList.map((w) => w.code))}`,
  )
  check('S7-C OPERATOR_NAME_WRITER_WHERE 결과에 OP01 포함',
    nameList.some((w) => w.code === 'OP01'),
    `list=${JSON.stringify(nameList.map((w) => w.code))}`,
  )
  check('S7-D OPERATOR_NAME_WRITER_WHERE 결과가 OP 행만',
    nameList.every((w) => w.code.startsWith('OP')),
    `list=${JSON.stringify(nameList.map((w) => w.code))}`,
  )
  check('S7-E OP 행 수 = OP 접두사 행 수 (PV 가 필터됨)',
    nameList.length === opRows.length,
    `nameList=${nameList.length} opRows=${opRows.length}`,
  )

  // ══════════════════════════════════════════════════════════════════════
  // 정리
  // ══════════════════════════════════════════════════════════════════════
  await wipe()
}

main()
  .then(() => {
    console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
    if (fail > 0) process.exit(1)
  })
  .catch((err: unknown) => {
    console.error('\n🔴 예외 발생:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
