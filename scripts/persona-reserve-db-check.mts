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
 *   ⑤ key 없음 · 저장 작가 해시가 v2 가 아님(v1 만 · 빈 집합) → Gate ⑥-B 모름(공개 기본값으로 대조하지 않는다 · 2026-10-01 author-hash v2)
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
const { authorHashKeyOf, authorHashV2Of } = await import('./lib/voice-author-hash.mjs')
const { normalizeN2 } = await import('./lib/persona-gate-name-collision.mjs')
/** 🔴 시험 전용 key(합성 32자 이상) — 운영 key 가 아니다 */
const TEST_KEY = authorHashKeyOf('reserve-db-check-key-0123456789abcdef0123')
if (!TEST_KEY.ok) throw new Error('test key')
const CRAWL_AUTHOR = '크롤작가시험'

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
/** 🔴 작가 해시 fixture 1행 — 지금 key 의 v2(비교 집합이 비면 Gate ⑥-B 는 모름이다) */
async function seedAuthor(gen: 'v2' | 'v1'): Promise<void> {
  await prisma.voiceSource.deleteMany({ where: { sourceRef: { startsWith: 'reserve-db-check' } } })
  const key = (TEST_KEY as { ok: true; key: Parameters<typeof authorHashV2Of>[1] }).key
  const v2 = authorHashV2Of(CRAWL_AUTHOR, key)
  const v2n = authorHashV2Of(normalizeN2(CRAWL_AUTHOR), key)
  // 🔴 v1 모양 fixture 는 합성 hex 다(공개 사슬을 쓰지 않는다) — 세대 판정만 본다
  const v1 = `sha256:${'a'.repeat(64)}`
  await prisma.voiceSource.create({ data: {
    origin: 'fixture', sourceRef: `reserve-db-check-${gen}`, sourceSite: 'navercafe:fixture', sourceUrl: 'https://example.invalid/r',
    capturedAt: new Date(0), authorHash: gen === 'v2' ? v2 : v1, authorHashNorm: gen === 'v2' ? v2n : v1,
  } })
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
  // 🔴 Gate ⑥-B 비교 집합 — 지금 key 의 v2 작가 해시 1행(없으면 표시명 판정은 모름이다)
  await seedAuthor('v2')

  const read = async () => {
    const facts = await readReserveFacts(prisma, { now: new Date(), repoRoot: process.cwd(), authorHashKey: TEST_KEY })
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

  // ── ⑤ key 없음 · 저장 세대 ──
  const noKey = await readReserveFacts(prisma, { now: new Date(), repoRoot: process.cwd(), authorHashKey: authorHashKeyOf('') })
  check('key 없음 → Gate ⑥-B 모름(null) · 공개 기본값 대조 없음',
    noKey.rows.every((r) => r.qualification?.nameGate === null && (r.qualification.nameGateUnknown ?? '').includes('VOICE_AUTHOR_HASH_SALT')))
  await prisma.voiceSource.deleteMany({ where: { sourceRef: { startsWith: 'reserve-db-check' } } })
  const empty = await readReserveFacts(prisma, { now: new Date(), repoRoot: process.cwd(), authorHashKey: TEST_KEY })
  check('🔴 key 있음 · 작가 해시 집합이 비었다 → 모름(빈 집합을 통과로 읽지 않는다)',
    empty.rows.every((r) => r.qualification?.nameGate === null && (r.qualification.nameGateUnknown ?? '').includes('비었다')))
  await seedAuthor('v1')
  const v1only = await readReserveFacts(prisma, { now: new Date(), repoRoot: process.cwd(), authorHashKey: TEST_KEY })
  check('🔴 key 있음 · 저장값이 v1 만(새 key 만 넣고 전환 안 함) → 모름',
    v1only.rows.every((r) => r.qualification?.nameGate === null && (r.qualification.nameGateUnknown ?? '').includes('옛 세대')))
  await seedAuthor('v2')
} catch (e) {
  failN += 1
  console.log(`  🔴 FAIL  예외: ${e instanceof Error ? e.message : String(e)}`)
} finally {
  await cleanup()
  await prisma.$disconnect()
}

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
