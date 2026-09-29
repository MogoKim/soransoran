#!/usr/bin/env tsx
/**
 * Persona 자동 확장 **적재 경로** 격리 DB 검사 — 🔴 운영 DB 에 붙지 않는다 (2026-09-29, Track C)
 *
 *   DATABASE_URL=postgresql://postgres@localhost:55442/soran_test SORAN_ISOLATED_DB=yes-throwaway \
 *     npm run persona:autogen-db-check
 *
 * 보는 것
 *   ① valid 후보 1명 적재 → User(계정 0) · Persona(draft · seed) · 감사 3건 · 운영 preflight(draft) 통과
 *   ② 같은 코드 재적재 → 전원 롤백 · write 0
 *   ③ 표시명이 실회원 이름과 같음 → 트랜잭션 안 Gate ⑥-B 가 막음 · write 0
 *   ④ quarantined 섞인 배치 · --limit 불일치 → DB 를 열기 전에 막음 · write 0
 *   ⑤ CLI dry-run(--db) → write 0
 *   ⑥ 건드리지 않기로 한 표(Post · Comment · Queue · ActivityLog · RawContent · Account) 불변
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const URL = process.env.DATABASE_URL ?? ''
{
  const problems: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  if (problems.length > 0) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.')
    for (const p of problems) console.error(`   · ${p}`)
    process.exit(2)
  }
}

const { PrismaClient } = await import('@prisma/client')
const { judgeAutogenCandidate } = await import('./lib/persona-autogen.mjs')
const { applyAutogenDrafts } = await import('./lib/persona-autogen-apply.mjs')
const { judgeReferenceBundle } = await import('../src/lib/persona-voice-reference')
const { preflightPersona } = await import('../src/lib/persona-wave2-verify')
const { judgeRealMember } = await import('../src/lib/real-member-gate')
type AutogenCandidate = import('../src/lib/persona-autogen').AutogenCandidate

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

const prisma = new PrismaClient()
const hashOf = (v: string): string => `sha256:${createHash('sha256').update(`test-salt::${v}`, 'utf8').digest('hex')}`
const TAG = `ag${Date.now().toString(36)}`
const REAL_NAME = '해솔'

const counts = async (): Promise<Record<string, number>> => ({
  users: await prisma.user.count(),
  personas: await prisma.persona.count(),
  audits: await prisma.personaAuditLog.count(),
  posts: await prisma.post.count(),
  comments: await prisma.comment.count(),
  queue: await prisma.originalPostApprovalQueue.count(),
  activity: await prisma.personaActivityLog.count(),
  raw: await prisma.microSeedRawContent.count(),
  accounts: await prisma.account.count(),
})
const same = (a: Record<string, number>, b: Record<string, number>): boolean =>
  Object.keys(a).every((k) => a[k] === b[k])

/**
 * 🔴 같은 격리 DB 를 앞뒤 검사가 함께 쓴다 — **이 검사가 쓰는 코드·계정만** 지운다.
 *    시작 전에도 부른다: 앞 회차가 중간에 죽었으면 남은 행 때문에 정상 경로가 거부된다.
 */
async function cleanup(): Promise<void> {
  const mine = await prisma.persona.findMany({ where: { code: { in: ['P49', 'P50'] } }, select: { id: true, userId: true } })
  await prisma.personaAuditLog.deleteMany({ where: { personaId: { in: mine.map((m) => m.id) } } })
  await prisma.persona.deleteMany({ where: { id: { in: mine.map((m) => m.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: mine.map((m) => m.userId) } } })
  const acc = await prisma.account.findMany({ where: { providerAccountId: { startsWith: 'autogen-check-' } }, select: { userId: true } })
  await prisma.user.deleteMany({ where: { id: { in: acc.map((a) => a.userId) } } })
}

console.log('\n══ Persona 자동 확장 적재 — 격리 DB ══\n')
try {
  await cleanup()
  // ── 준비: 실회원 1명 (계정 있음 · 이름 REAL_NAME) ──
  const member = await prisma.user.create({ data: { name: REAL_NAME }, select: { id: true } })
  await prisma.account.create({
    data: { userId: member.id, type: 'oauth', provider: 'kakao', providerAccountId: `autogen-check-${TAG}` },
  })

  // ── 운영 판정기를 통과한 후보를 만든다(합성 말투 · 합성 creative) ──
  const texts = ['그 마음 알 것 같아요', '저도 요즘 그래요', '천천히 하셔도 돼요', '날이 많이 추워졌네요']
  const ref = judgeReferenceBundle({ personaCode: 'P50', texts, anchorCount: texts.length })
  if (!ref.ok) throw new Error('fixture 묶음이 서지 않는다')
  const cand = (code: string): AutogenCandidate => ({
    code,
    life: {
      ageBand: '50대 초반', birthDate: '1973-03-08', region: '광역시', maritalStatus: '이혼',
      spouseRelationship: '해당없음', childrenCount: 1, childrenAgeBands: ['대학·취준'], childrenLiving: '동거',
      workStatus: '파트타임', economicStatus: '빠듯', housing: '월세', menopauseStatus: '진행중', parentCare: '간헐',
    },
    creative: {
      title: '혼자 대학생 아이 뒷바라지하며', personality: ['담담함', '말 짧음'],
      noGoTopics: ['이혼 권유'], noGoExpressions: ['"그래도 ~하니 다행" 류'],
      variations: ['짧게 툭', '담백한 경험', '되묻기', '무호칭', '한 줄'],
    },
    voice: { bundle: { ...ref.bundle, personaCode: code }, seedShareCount: 1 },
    cadence: {
      dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
      activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 },
    },
    binding: { accountCount: 0, providerId: null },
    displayName: { name: '다온', gate: 'pass' },
  })
  const v50 = judgeAutogenCandidate(cand('P50'), { takenCodes: new Set() })
  const v49 = judgeAutogenCandidate(cand('P49'), { takenCodes: new Set() })
  check('fixture 후보가 운영 판정기에서 valid', v50.status === 'valid' && v49.status === 'valid')
  const plan50 = { code: 'P50', status: v50.status, name: '다온', seed: v50.seed! }

  // ── ④ DB 를 열기 전에 막는다 ──
  {
    const b = await counts()
    const r1 = await applyAutogenDrafts(prisma, {
      plans: [plan50, { code: 'P49', status: 'quarantined', name: '보람', seed: v49.seed! }], limit: 2, hashOf, reason: 'check',
    })
    const r2 = await applyAutogenDrafts(prisma, { plans: [plan50], limit: 3, hashOf, reason: 'check' })
    const r3 = await applyAutogenDrafts(prisma, { plans: [], limit: 0, hashOf, reason: 'check' })
    check('quarantined 섞인 배치 → 거부', !r1.ok)
    check('--limit 불일치 → 거부', !r2.ok)
    check('빈 배치 → 거부', !r3.ok)
    check('거부 세 번 모두 write 0', same(b, await counts()))
  }

  // ── ③ 실회원 이름 → 트랜잭션 안 Gate ⑥-B ──
  {
    const b = await counts()
    const r = await applyAutogenDrafts(prisma, {
      plans: [{ ...plan50, name: REAL_NAME }], limit: 1, hashOf, reason: 'check',
    })
    check('실회원 이름과 같은 표시명 → 거부', !r.ok && /Gate/.test(r.ok ? '' : r.reason))
    check('실회원 충돌 거부 → write 0', same(b, await counts()))
  }

  // ── ① 정상 적재 ──
  {
    const b = await counts()
    const r = await applyAutogenDrafts(prisma, { plans: [plan50], limit: 1, hashOf, reason: 'autogen db-check' })
    check('valid 1명 적재 성공', r.ok)
    const a = await counts()
    check('User +1 · Persona +1 · 감사 +3', a.users === b.users + 1 && a.personas === b.personas + 1 && a.audits === b.audits + 3)
    check('Post·Comment·Queue·ActivityLog·RawContent·Account 불변',
      a.posts === b.posts && a.comments === b.comments && a.queue === b.queue
      && a.activity === b.activity && a.raw === b.raw && a.accounts === b.accounts)
    const row = await prisma.persona.findUnique({
      where: { code: 'P50' },
      select: {
        code: true, status: true, ageBand: true, region: true, lifeStage: true, identity: true,
        voiceCore: true, voiceVariations: true, activityRhythm: true, noGoTopics: true, noGoExpressions: true,
        forbiddenReactionRoles: true, dailyCap: true, weeklyCap: true, silenceRate: true,
        user: { select: { nickname: true, providerId: true, _count: { select: { accounts: true } } } },
        auditLogs: { select: { action: true, fromStatus: true, toStatus: true, actorUserId: true, reason: true } },
      },
    })
    check('status=draft — 켜지 않았다', row?.status === 'draft')
    check('새 User 는 실회원이 아니다(계정 0)',
      row !== null && !judgeRealMember({ accountCount: row.user._count.accounts, providerId: row.user.providerId }).real)
    const pre = row === null ? null : preflightPersona({
      row: {
        code: row.code, status: row.status, nickname: row.user.nickname,
        accountCount: row.user._count.accounts, providerId: row.user.providerId,
        ageBand: row.ageBand, region: row.region, lifeStage: row.lifeStage, identity: row.identity,
        voiceCore: row.voiceCore, voiceVariations: row.voiceVariations, activityRhythm: row.activityRhythm,
        noGoTopics: row.noGoTopics, noGoExpressions: row.noGoExpressions, forbiddenReactionRoles: row.forbiddenReactionRoles,
        dailyCap: row.dailyCap, weeklyCap: row.weeklyCap, silenceRate: row.silenceRate,
        auditCreated: row.auditLogs.filter((x) => x.action === 'created').length,
        auditNameAssigned: row.auditLogs.filter((x) => x.action === 'display_name_assigned').length,
        auditStatusChanged: row.auditLogs.filter((x) => x.action === 'status_changed'),
      },
      poolCard: v50.card, expectStatus: 'draft',
    })
    check('저장된 행이 운영 preflight(draft · seed · 감사) 를 통과한다', pre !== null && pre.ok)
    if (pre !== null && !pre.ok) console.log(`     ${pre.problems.join(' / ')}`)
  }

  // ── ② 같은 코드 재적재 ──
  {
    const b = await counts()
    const r = await applyAutogenDrafts(prisma, { plans: [{ ...plan50, name: '보람' }], limit: 1, hashOf, reason: 'check' })
    check('같은 코드 재적재 → 거부', !r.ok)
    check('재적재 거부 → write 0', same(b, await counts()))
  }

  // ── ⑤ CLI dry-run 은 쓰지 않는다 ──
  {
    const b = await counts()
    const run = spawnSync('npx', ['tsx', 'scripts/persona-autogen.mts', '--db', '--count=3'], {
      env: process.env, encoding: 'utf-8',
    })
    check('CLI dry-run(--db) 종료 코드 0', run.status === 0)
    check('CLI dry-run 이 dry-run 이라고 말한다', /dry-run — DB write 0/.test(run.stdout))
    check('CLI dry-run → write 0', same(b, await counts()))
    const runApply = spawnSync('npx', ['tsx', 'scripts/persona-autogen.mts', '--db', '--count=3', '--apply', '--limit=0', '--reason', 'x'], {
      env: process.env, encoding: 'utf-8',
    })
    check('valid 0 인데 --apply → 실패 종료', runApply.status !== 0)
    check('valid 0 --apply → write 0', same(b, await counts()))
  }
} finally {
  await cleanup()
  await prisma.$disconnect()
}

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
