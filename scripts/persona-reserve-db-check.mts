#!/usr/bin/env tsx
/**
 * Persona 4상태 **운영 어댑터** 격리 DB 검사 — 🔴 운영 DB 에 붙지 않는다 (2026-09-30)
 *
 *   DATABASE_URL=postgresql://soran@localhost:<port>/soran_test SORAN_ISOLATED_DB=yes-throwaway \
 *     npx tsx scripts/persona-reserve-db-check.mts
 *
 * 보는 것
 *   ① 정본 카드와 같은 seed 의 draft(이력 0) → reserve  — 운영에 draft 가 0행이라 실측으로는 못 보는 경로
 *   ② 같은 사람을 active + 공개 글 1 · 발행 댓글 1 → 소재 thin(1<5 · #640 표본 하한) — 모름이 아니다
 *   ③ retired → 네 상태 밖 · 정본 카드만 있는 코드 → designed
 *   ④ 두 Persona 가 한 글에 붙음 → 짝 간격 · 발행 역할(reactionType) 이 어댑터를 거쳐 읽힌다
 *   ⑤ 옛 크롤 작가 해시(v1)가 없음 · 있음 · v1/v2 섞임 → 표시명 판정이 **측정되고 똑같다**(inert · 2026-10-01 · #641) ·
 *      B1 실회원 · B3 다른 Persona(retired 포함)와 같은 이름은 reject
 *   ⑥ 어댑터 자체는 write 0 — 전 표 행 수 불변
 */
import { readFileSync } from 'node:fs'

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
const { parsePoolDoc } = await import('../src/lib/persona-pool-card')
const { readReserveFacts } = await import('./lib/persona-reserve-facts.mjs')
const { readPersonaReserve } = await import('./lib/d100-persona-tiers.mjs')
const { PERSONA_POOL_DOC } = await import('./lib/voice-runtime.mjs')

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}
const prisma = new PrismaClient()
const CODES = ['P14', 'P01', 'P25']
const TAG = `rs${Date.now().toString(36)}`

async function cleanup(): Promise<void> {
  const mine = await prisma.persona.findMany({ where: { code: { in: CODES } }, select: { id: true, userId: true } })
  const ids = mine.map((m) => m.id)
  const posts = await prisma.post.findMany({ where: { OR: [{ personaId: { in: ids } }, { title: { startsWith: 'reserve-check' } }] }, select: { id: true } })
  await prisma.personaApprovalQueue.deleteMany({ where: { personaId: { in: ids } } })
  await prisma.comment.deleteMany({ where: { OR: [{ personaId: { in: ids } }, { postId: { in: posts.map((p) => p.id) } }] } })
  await prisma.post.deleteMany({ where: { id: { in: posts.map((p) => p.id) } } })
  await prisma.persona.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: mine.map((m) => m.userId) } } })
  await prisma.voiceSource.deleteMany({ where: { sourceRef: { startsWith: 'reserve-db-check' } } })
}
/** 🔴 옛 크롤 작가 해시 fixture — 합성 hex(공개 사슬 아님). 판정에 쓰이지 않아야 한다 */
async function seedLegacy(kind: 'none' | 'v1' | 'mixed'): Promise<void> {
  await prisma.voiceSource.deleteMany({ where: { sourceRef: { startsWith: 'reserve-db-check' } } })
  const rows = kind === 'none' ? [] : kind === 'v1'
    ? [`sha256:${'a'.repeat(64)}`]
    : [`sha256:${'a'.repeat(64)}`, `hmac-v2:${'b'.repeat(12)}:${'c'.repeat(64)}`]
  for (const [i, h] of rows.entries()) {
    await prisma.voiceSource.create({ data: {
      origin: 'fixture', sourceRef: `reserve-db-check-${kind}-${i}`, sourceSite: 'navercafe:fixture', sourceUrl: 'https://example.invalid/r',
      capturedAt: new Date(0), authorHash: h, authorHashNorm: h,
    } })
  }
}
const counts = async (): Promise<string> => JSON.stringify([
  await prisma.user.count(), await prisma.persona.count(), await prisma.post.count(),
  await prisma.comment.count(), await prisma.personaApprovalQueue.count(), await prisma.account.count(),
])

console.log('\n══ Persona 4상태 어댑터 — 격리 DB ══\n')
try {
  await cleanup()
  const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
  // 🔴 정본 카드와 같은 seed — `verifySeedCard` 가 통과해야 자격 충돌이 아니다
  const seedOf = (code: string) => {
    const c = pool.cards.find((x) => x.code === code)!
    return {
      identity: {
        maritalStatus: c.maritalStatus, spouseRelationship: c.spouseRelationship ?? '해당없음',
        childrenCount: c.childrenCount, childrenAgeBands: c.childrenAgeBands, parentCare: c.parentCare,
        menopauseStatus: c.menopauseStatus, workStatus: c.workStatus, economicStatus: c.economicStatus,
        housing: c.housing, personality: c.personality,
      },
      voiceCore: { length: c.voiceLength ?? '', register: '존댓말', ending: '~요', emoji: '없음' },
      voiceVariations: Array.from({ length: Math.max(5, Math.min(8, c.variationCount)) }, (_, i) => `v${i}`),
      activityRhythm: { activeHours: [[9, 12]], burstiness: 0.3, weekdayBias: 0.5 },
      ageBand: c.ageBand, region: c.region, lifeStage: '자녀 독립기',
      noGoTopics: c.noGoTopics, noGoExpressions: c.noGoExpressions, forbiddenReactionRoles: c.forbiddenReactionRoles,
      dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
    }
  }
  const make = async (code: string, status: 'draft' | 'active' | 'retired', nickname: string) => {
    const u = await prisma.user.create({ data: { nickname }, select: { id: true } })
    return prisma.persona.create({ data: { code, userId: u.id, status, ...seedOf(code) }, select: { id: true, userId: true } })
  }
  const p14 = await make('P14', 'draft', '새봄')
  const p01 = await make('P01', 'active', '가람')
  await make('P25', 'retired', '누리')

  const read = async () => {
    const facts = await readReserveFacts(prisma, { now: new Date(), repoRoot: process.cwd() })
    return { facts, res: await readPersonaReserve({ reserveFacts: async () => facts }) }
  }

  // ── ① draft · 이력 0 ──
  const before = await counts()
  const r1 = await read()
  check('어댑터 write 0 — 행 수 불변', before === await counts())
  const v14 = r1.res.verdicts.find((v) => v.code === 'P14')!
  check(`정본 seed · 이력 0 draft → reserve (${v14.state} ${JSON.stringify(v14.contract?.blocked)} ${JSON.stringify(v14.contract?.unknown)})`,
    v14.state === 'reserve')
  check('이력 0 → cadence 근거 없음 표시 · 휴면 아님', v14.observations.noCadenceEvidence && !v14.observations.dormantActive)
  check('retired → 네 상태 밖', r1.res.retired.includes('P25'))
  check('정본 카드만 있는 코드 → designed (P09 포함)', r1.res.byState.designed.includes('P09') && !r1.res.byState.designed.includes('P14'))

  // ── ② 활동 1건 → 소재 모름 ──
  await prisma.persona.update({ where: { id: p14.id }, data: { status: 'active' } })
  const post = await prisma.post.create({
    data: { boardType: 'FREE', title: 'reserve-check 글', content: '본문', authorId: p14.userId, personaId: p14.id },
    select: { id: true },
  })
  // ── ④ 다른 Persona 가 같은 글에 댓글 · 발행 역할 ──
  const cmt = await prisma.comment.create({
    data: { postId: post.id, content: '댓글', authorId: p01.userId, personaId: p01.id, commentOrigin: 'PERSONA' },
    select: { id: true },
  })
  await prisma.personaApprovalQueue.create({
    data: {
      personaId: p01.id, targetPostId: post.id, candidateText: '댓글', reactionType: 'empathy',
      gateStatus: 'pass', gateResults: {}, dedupKey: `rs-${TAG}`, status: 'PUBLISHED', publishedCommentId: cmt.id,
    },
  })
  const r2 = await read()
  const a14 = r2.res.verdicts.find((v) => v.code === 'P14')!
  // 🔴 (#640) 소재 표본 하한 = SHARE_MIN_EVENTS(5) — 1건은 비율을 재지 않는다(thin · 0). 이 격리 DB 검사는 CI 목록 밖이라 #640 때 갱신되지 않았다
  check('active + 공개 글 1 → 소재 thin(1<5) · 모름 아님(#640)',
    a14.contract?.unknown.topicShare === undefined && a14.contract?.evidence.topicShare === 'thin(1<5)')
  const h14 = r2.facts.rows.find((r) => r.code === 'P14')!.history!
  const h01 = r2.facts.rows.find((r) => r.code === 'P01')!.history!
  check('연속 노출 — 맨 끝 글이 P14 → 1', h14.consecutiveExposures === 1)
  check('짝 간격 — P14 글에 P01 댓글 → 둘 다 0', h14.postsSinceLastPairing === 0 && h01.postsSinceLastPairing === 0)
  check('발행 역할 — P01 empathy 1 · 모르는 역할 0', h01.roleCounts.empathy === 1 && h01.unresolvedRoleEvents === 0)
  check('짝 간격 0 은 이번 회차만 막는다(roundBlocked) — 계약 사유가 아니다',
    a14.contract?.roundBlocked.includes('postsSinceLastPairing') === true && a14.contract.blocked.postsSinceLastPairing === undefined)

  // ── ⑤ 옛 크롤 작가 해시는 inert — 없음 · v1 · 섞임에서 표시명 판정이 측정되고 같다 ──
  const gates = async (kind: 'none' | 'v1' | 'mixed'): Promise<string> => {
    await seedLegacy(kind)
    const f = await readReserveFacts(prisma, { now: new Date(), repoRoot: process.cwd() })
    return JSON.stringify(f.rows.map((r) => [r.code, r.qualification?.nameGate ?? null, r.qualification?.nameGateUnknown ?? null]))
  }
  const gNone = await gates('none')
  const parsed = JSON.parse(gNone) as Array<[string, string | null, string | null]>
  check(`옛 작가 해시 없음 → 표시명 판정이 측정된다(모름 0) ${gNone}`,
    parsed.length === 3 && parsed.every(([, g, u]) => g === 'pass' && u === null))
  check('옛 v1 작가 해시가 있어도 같다', await gates('v1') === gNone)
  check('v1 · v2 가 섞여도 같다', await gates('mixed') === gNone)
  await seedLegacy('none')

  // ── ⑥ B1 실회원 · B3 다른 Persona(retired 포함) 이름은 계속 막는다 ──
  // nickname 은 유일키라 카카오 이름 칸(name)으로 같은 이름을 만든다 — B1 은 nickname ∪ name 을 본다
  const member = await prisma.user.create({ data: { name: '가람' }, select: { id: true } })
  try {
    const f = await readReserveFacts(prisma, { now: new Date(), repoRoot: process.cwd() })
    check('B1 — 실회원이 같은 이름(가람) → P01 표시명 reject',
      f.rows.find((r) => r.code === 'P01')?.qualification?.nameGate === 'reject')
  } finally {
    await prisma.user.delete({ where: { id: member.id } })
  }
  // nickname 유일키 — 표시명(nickname ?? name)을 name 칸으로 같은 이름으로 만든다
  await prisma.user.update({ where: { id: p14.userId }, data: { nickname: null, name: '누리' } })
  const f3 = await readReserveFacts(prisma, { now: new Date(), repoRoot: process.cwd() })
  check('B3 — retired Persona(P25 누리)와 같은 이름 → P14 표시명 reject',
    f3.rows.find((r) => r.code === 'P14')?.qualification?.nameGate === 'reject')
  await prisma.user.update({ where: { id: p14.userId }, data: { nickname: '새봄', name: null } })
} catch (e) {
  failN += 1
  console.log(`  🔴 FAIL  예외: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  await cleanup()
  await prisma.$disconnect()
}

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
