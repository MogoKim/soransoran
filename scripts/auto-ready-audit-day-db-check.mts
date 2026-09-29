#!/usr/bin/env tsx
/**
 * 🔴 **감사 표본은 그날(KST) 자동 발행에서 고른다 — 실제 선정 함수 · 격리 Postgres 전용** (2026-09-29)
 *
 *   운영 반례: 09-28 자동 글 1건이 감사된 뒤 09-29 자동 글이 나갔는데 선정기는 누적 N=2 · 목표 1 을
 *   "이미 채움" 으로 보고 0건을 골랐다 → 단계 증거 `AUDIT_COVERAGE_ZERO` 로 D3 가 영원히 막힌다.
 *
 *   ① 어제 감사된 자동 글 + 오늘 감사 없는 자동 글 → 오늘 글을 1건 고른다(앞판은 0건)
 *   ② 다시 돌려도 더 고르지 않는다
 *   ③ 어제 감사 안 된 자동 글은 오늘 모집단이 아니다(오늘 표본으로 끌려오지 않는다)
 *   ④ 오늘 자동 10건 → ceil(10×20%)=2건 · 전부 오늘 글
 *   (글이 사라진 자동 행 missingPost 는 날짜와 무관 — `auto-ready:db-check` 가 본다)
 *
 *   🔴 운영 DB 에 절대 붙이지 않는다 — sentinel · localhost · 고정 DB 이름을 요구한다. provider 0. raw SQL 0.
 */
import { PrismaClient } from '@prisma/client'

import { selectAudits } from '../src/lib/auto-ready-repo'
import { AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX } from '../src/lib/micro-seed-supply-autofill'

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

const prisma = new PrismaClient()
/** 🔴 판정 시각 — 오늘 KST 19:05. 어제 = 그 24시간 전 */
const KST_DATE = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
const NOW = new Date(`${KST_DATE}T19:05:00+09:00`)
const TODAY_AT = (hh: number) => new Date(`${KST_DATE}T${String(hh).padStart(2, '0')}:30:00+09:00`)
const YESTERDAY = new Date(NOW.getTime() - 86_400_000)

async function wipe(): Promise<void> {
  await prisma.autoReadyAudit.deleteMany({})
  await prisma.comment.deleteMany({})
  await prisma.personaActivityLog.deleteMany({})
  await prisma.originalPostApprovalQueue.deleteMany({})
  await prisma.post.deleteMany({})
  await prisma.microSeedRawContent.deleteMany({})
  await prisma.persona.deleteMany({})
  await prisma.user.deleteMany({})
}

let seq = 0
let personaId = ''
let authorId = ''
async function setup(): Promise<void> {
  await wipe()
  const u = await prisma.user.create({ data: { nickname: 'auditday' }, select: { id: true } })
  authorId = u.id
  personaId = (await prisma.persona.create({ data: { code: 'P01', userId: u.id, status: 'active' }, select: { id: true } })).id
}
/** 자동 도장(AUTO_DECIDER)으로 발행된 글 하나 — 발행 시각을 정한다 */
async function autoPublished(at: Date): Promise<{ queueId: string; postId: string }> {
  seq += 1
  const raw = await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: `${AUTOFILL_SITE_PREFIX}fixture`, sourceUrl: `https://example.invalid/ad${seq}`,
      sourceArticleId: `${9500 + seq}-ad`, sourceCapturedAt: at, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}` },
    select: { id: true },
  })
  const post = await prisma.post.create({
    data: { boardType: 'FREE', title: `저녁 산책 ${seq}`, content: `동네 한 바퀴 ${seq}`, source: 'SYSTEM', authorId, personaId, createdAt: at },
    select: { id: true },
  })
  const q = await prisma.originalPostApprovalQueue.create({
    data: { sourceRawContentId: raw.id, status: 'PUBLISHED', draftTitle: `저녁 산책 ${seq}`, draftBody: `동네 한 바퀴 ${seq}`,
      gateVerdict: 'PASS', gateResults: {}, promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
      decidedBy: AUTO_DECIDER, dedupKey: `ad-${seq}`, createdPostId: post.id, matchedPersonaId: personaId },
    select: { id: true },
  })
  return { queueId: q.id, postId: post.id }
}
async function audited(r: { queueId: string; postId: string }, at: Date): Promise<void> {
  await prisma.autoReadyAudit.create({ data: {
    queueId: r.queueId, postId: r.postId, selectedAtN: 1, selectedTarget: 1, selectedAt: at,
    publishedTitleHash: 'a'.repeat(64), publishedBodyHash: 'b'.repeat(64), stampContractDigest: 'd',
    defect: 'no', judgedAt: new Date(at.getTime() + 600_000), auditor: 'machine:fixture',
    auditContractVersion: 'v', auditModel: 'm', auditPromptVersion: 'p',
  } })
}

try {
  console.log('\n══ 감사 표본 — 그날(KST) 자동 발행 기준 (격리 DB) ══')

  console.log('\n① · ② 09-29 운영 반례 모양 — 어제 감사된 글 + 오늘 감사 없는 글')
  {
    await setup()
    const y = await autoPublished(YESTERDAY)
    await audited(y, YESTERDAY)
    const t = await autoPublished(TODAY_AT(13))
    const s = await selectAudits(prisma, NOW)
    check('🔴 🔴 **오늘 자동 글을 1건 고른다 (앞판: 누적 N=2 · 목표 1 이미 채움 → 0건)**',
      s.kind === 'ok' && s.picked.length === 1 && s.picked[0] === t.queueId, JSON.stringify(s))
    check('그날 모집단 N=1 · 목표 1', s.kind === 'ok' && s.n === 1 && s.target === 1)
    const again = await selectAudits(prisma, NOW)
    check('🔴 다시 돌려도 더 고르지 않는다', again.kind === 'ok' && again.picked.length === 0
      && await prisma.autoReadyAudit.count() === 2)
    const row = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: t.queueId } })
    check('새 감사 행의 글 = 오늘 글', row.postId === t.postId)
  }

  console.log('\n③ 어제 감사 안 된 자동 글은 오늘 표본으로 끌려오지 않는다')
  {
    await setup()
    const y = await autoPublished(YESTERDAY)
    const t = await autoPublished(TODAY_AT(9))
    const s = await selectAudits(prisma, NOW)
    check('🔴 오늘 글만 고른다 — 어제 글은 모집단 밖', s.kind === 'ok' && s.picked.length === 1 && s.picked[0] === t.queueId
      && !s.picked.includes(y.queueId), JSON.stringify(s))
  }

  console.log('\n④ 오늘 자동 10건 → ceil(10×20%)=2건')
  {
    await setup()
    const today: string[] = []
    for (let i = 0; i < 10; i += 1) today.push((await autoPublished(new Date(TODAY_AT(8).getTime() + i * 3_600_000))).queueId)
    await autoPublished(YESTERDAY)
    const s = await selectAudits(prisma, NOW)
    check('🔴 표본 2 · 전부 오늘 글', s.kind === 'ok' && s.n === 10 && s.target === 2 && s.picked.length === 2
      && s.picked.every((q) => today.includes(q)), JSON.stringify(s))
  }

} finally {
  await wipe()
  await prisma.$disconnect()
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
