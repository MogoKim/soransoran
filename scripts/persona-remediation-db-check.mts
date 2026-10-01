#!/usr/bin/env tsx
/**
 * Persona 계약 복구 **격리 DB 반례** — 🔴 운영 DB 에 붙지 않는다 (2026-10-01 · Phase 2A)
 *
 *   DATABASE_URL=postgresql://soran@localhost:<port>/soran_test SORAN_ISOLATED_DB=yes-throwaway \
 *     npx tsx scripts/persona-remediation-db-check.mts
 *
 *   ① 카드와 정확히 같은 행 → 계획에 없다
 *   ② 계획 뒤 DB 가 바뀜 → PLAN_STALE · write 0
 *   ③ 중간 행에서 실패 → 앞서 쓴 행까지 롤백 · write 0
 *   ④ 적용 → 예측과 같은 계약 유효 · 기존 유효 회귀 0 · 활동 · 표시명 · 계정 행 불변
 *   ⑤ 두 번째 실행 → 계획 0 · write 0
 *   ⑥ 근거 없는 칸(생활 단계 · 말끝) · 말투 근거 0 · 표시명 충돌은 그대로 막혀 있다(채우지 않는다)
 *
 * 🔴 말투 근거는 운영과 같은 정본 자산(`bundlesForPersonas`)에서 온다 — fixture 가 실제보다 강하지 않다.
 *    자산이 없는 환경에서는 ④ 의 계약 유효 기대가 성립하지 않으므로 멈춘다(exit 3).
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
const { noGoExpressionKey } = await import('../src/lib/persona-card-verify')
const { readRemediation, applyRemediation } = await import('./lib/persona-contract-remediation.mjs')
const { bundlesForPersonas } = await import('./lib/persona-reference-store.mjs')
const { PERSONA_POOL_DOC } = await import('./lib/voice-runtime.mjs')

let pass = 0
let failN = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const prisma = new PrismaClient()
const root = process.cwd()
const now = new Date()
/** P01 · P14 정본 일치(유효) · P05 금지 역할 drift(카드로 고침) · P17 생활 단계 없음 · P21 말투 근거 없음 · P22 표시명 충돌 */
const CODES = ['P01', 'P14', 'P05', 'P17', 'P21', 'P22']

const bundles = bundlesForPersonas({ repoRoot: root, personaCodes: ['P01', 'P05', 'P14'] })
if (bundles.byCode.size < 3) {
  console.error('🔴 정본 말투 자산이 없다 — 이 검사의 계약 유효 기대가 성립하지 않는다(운영과 같은 자산이 필요). 멈춘다.')
  process.exit(3)
}

async function cleanup(): Promise<void> {
  const mine = await prisma.persona.findMany({ where: { code: { in: CODES } }, select: { id: true, userId: true } })
  await prisma.personaAuditLog.deleteMany({ where: { personaId: { in: mine.map((m) => m.id) } } })
  await prisma.persona.deleteMany({ where: { id: { in: mine.map((m) => m.id) } } })
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: mine.map((m) => m.userId) } }, { nickname: { startsWith: 'rmd-member' } }] } })
}
const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
const seedOf = (code: string) => {
  const c = pool.cards.find((x) => x.code === code)!
  return {
    identity: {
      maritalStatus: c.maritalStatus, spouseRelationship: c.maritalStatus === '기혼' ? (c.spouseRelationship ?? '원만') : '해당없음',
      childrenCount: c.childrenCount, childrenAgeBands: c.childrenAgeBands, parentCare: c.parentCare,
      menopauseStatus: c.menopauseStatus, workStatus: c.workStatus, economicStatus: c.economicStatus,
      housing: c.housing, personality: c.personality,
    },
    voiceCore: { length: c.voiceLength ?? '', register: '존댓말', ending: '~요', emoji: '없음' },
    voiceVariations: Array.from({ length: Math.max(5, Math.min(8, c.variationCount)) }, (_, i) => `v${i}`),
    activityRhythm: { activeHours: [[9, 12]], burstiness: 0.3, weekdayBias: 0.5 },
    ageBand: c.ageBand, region: c.region, lifeStage: '자녀 독립기',
    noGoTopics: c.noGoTopics, noGoExpressions: c.noGoExpressions.map(noGoExpressionKey), forbiddenReactionRoles: c.forbiddenReactionRoles,
    dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
  }
}
const make = async (code: string, nickname: string, over: Record<string, unknown> = {}) => {
  const u = await prisma.user.create({ data: { nickname }, select: { id: true } })
  return prisma.persona.create({ data: { code, userId: u.id, status: 'active', ...seedOf(code), ...over }, select: { id: true } })
}
/** 🔴 전 표 지문 — write 0 을 행 수가 아니라 내용으로 본다 */
const snapshot = async (): Promise<string> => JSON.stringify({
  personas: await prisma.persona.findMany({ where: { code: { in: CODES } }, orderBy: { code: 'asc' },
    select: { code: true, updatedAt: true, noGoTopics: true, forbiddenReactionRoles: true, identity: true, lifeStage: true, voiceCore: true } }),
  audit: await prisma.personaAuditLog.count(),
  users: await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, nickname: true, name: true } }),
  counts: [await prisma.post.count(), await prisma.comment.count(), await prisma.personaApprovalQueue.count(),
    await prisma.personaActivityLog.count(), await prisma.account.count()],
})
const actCounts = async (): Promise<string> => JSON.stringify([await prisma.post.count(), await prisma.comment.count(),
  await prisma.personaApprovalQueue.count(), await prisma.personaActivityLog.count(), await prisma.account.count()])

console.log('\n══ Persona 계약 복구 — 격리 DB ══\n')
try {
  await cleanup()
  await make('P01', '가람')
  await make('P14', '새봄')
  await make('P05', '하늘결', { forbiddenReactionRoles: ['information'] })
  await make('P17', '물결', { lifeStage: null, noGoTopics: [], voiceCore: { length: '길게', register: '구어체', emoji: '자주' } })
  await make('P21', '여울')
  await prisma.user.create({ data: { nickname: 'rmd-member', name: '소담' } })
  await make('P22', '소담') // 🔴 실회원과 같은 이름 — Gate ⑥-B 가 막는다. 복구가 이름을 바꾸지 않는다

  // ── ① ──
  const r0 = await readRemediation(prisma, { now, repoRoot: root })
  const planned = r0.plan.personas.map((p) => p.code)
  check(`카드와 같은 P01 · P14 · P21 · P22 는 계획에 없다 [${planned.join(',')}]`, !planned.some((c) => ['P01', 'P14', 'P21', 'P22'].includes(c)))
  check('P05 금지 역할 · P17 noGoTopics 만 계획', planned.join(',') === 'P05,P17'
    && r0.plan.personas.find((p) => p.code === 'P17')!.changes.every((c) => c.field === 'noGoTopics'))
  check('🔴 P17 생활 단계 · 말끝은 근거 필요로만 낸다', r0.plan.evidenceRequired.some((g) => g.code === 'P17' && g.field === 'lifeStage')
    && r0.plan.evidenceRequired.some((g) => g.code === 'P17' && g.field === 'voiceCore.ending'))
  const validBefore = [...r0.before.byState['stage-active']].sort()
  const validPred = [...r0.predicted.byState['stage-active']].sort()
  check(`복구 전 유효 [${validBefore.join(',')}] · 예측 [${validPred.join(',')}]`,
    validBefore.join(',') === 'P01,P14' && validPred.join(',') === 'P01,P05,P14')
  check('P21 말투 근거 없음 · P22 표시명 충돌은 예측에서도 막힘', r0.predicted.gapsByAxis.voiceEvidence.blocked.includes('P21')
    && r0.predicted.gapsByAxis.qualificationConflict.blocked.includes('P22'))

  // ── ② 계획 뒤 DB 가 바뀜 ──
  const s2 = await snapshot()
  const stale = r0.plan.digest
  // 🔴 계획 **밖** 행(P14)만 바뀌어도 낡은 계획이다
  await prisma.persona.update({ where: { code: 'P14' }, data: { dailyCap: 4 } })
  const s2b = await snapshot()
  const rStale = await applyRemediation(prisma, { approvedDigest: stale, reason: 'db-check', now, repoRoot: root })
  check(`🔴 계획 밖 행 변경 → 중단 (${rStale.ok ? 'ok' : rStale.reason.slice(0, 40)})`, !rStale.ok && rStale.reason.includes('PLAN_STALE'))
  check('🔴 중단 시 write 0 (내용 지문 불변)', s2b === await snapshot() && s2 !== s2b)
  // 🔴 계획 **안** 행(P05)이 바뀌어도
  const staleIn = (await readRemediation(prisma, { now, repoRoot: root })).plan.digest
  await prisma.persona.update({ where: { code: 'P05' }, data: { weeklyCap: 13 } })
  const s2c = await snapshot()
  const rStaleIn = await applyRemediation(prisma, { approvedDigest: staleIn, reason: 'db-check', now, repoRoot: root })
  check('🔴 계획 안 행 변경 → 중단 · write 0', !rStaleIn.ok && rStaleIn.reason.includes('PLAN_STALE') && s2c === await snapshot())

  // ── ③ 부분 실패 ──
  const r3 = await readRemediation(prisma, { now, repoRoot: root })
  const s3 = await snapshot()
  const rPart = await applyRemediation(prisma, {
    approvedDigest: r3.plan.digest, reason: 'db-check', now, repoRoot: root,
    hooks: { beforeUpdate: (_code, i) => { if (i === 1) throw new Error('주입 실패 — 두 번째 행') } },
  })
  check('🔴 두 번째 행에서 실패 → 전원 롤백', !rPart.ok && rPart.reason.includes('주입 실패'))
  check('🔴 부분 실패 시 write 0 — 첫 행(P05)도 그대로 · 감사 기록 0', s3 === await snapshot())

  // ── ④ 적용 ──
  const acts = await actCounts()
  const users = JSON.stringify(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, nickname: true, name: true } }))
  const rOk = await applyRemediation(prisma, { approvedDigest: r3.plan.digest, reason: 'db-check', now, repoRoot: root })
  check(`적용 ${rOk.ok ? `${rOk.updated.join(',')} · ${rOk.before}→${rOk.after}` : rOk.reason}`, rOk.ok && rOk.updated.join(',') === 'P05,P17' && rOk.before === 2 && rOk.after === 3)
  const r4 = await readRemediation(prisma, { now, repoRoot: root })
  const valid4 = [...r4.before.byState['stage-active']].sort()
  check(`🔴 적용 뒤 계약 유효 = 예측 [${valid4.join(',')}] · 기존 유효 회귀 0`, valid4.join(',') === validPred.join(',') && validBefore.every((c) => valid4.includes(c)))
  check('🔴 가짜 활동 0 — Post · Comment · Queue · 활동 · 계정 행 불변', acts === await actCounts())
  check('🔴 표시명 · User 불변 (P22 이름 자동 변경 0)', users === JSON.stringify(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, nickname: true, name: true } })))
  const p17 = await prisma.persona.findUniqueOrThrow({ where: { code: 'P17' }, select: { lifeStage: true, voiceCore: true, noGoTopics: true } })
  check('🔴 P17 생활 단계 · 말끝은 여전히 비어 있다(기본값 0) · noGoTopics 는 카드 값', p17.lifeStage === null
    && !('ending' in ((p17.voiceCore ?? {}) as Record<string, unknown>)) && p17.noGoTopics.length > 0)
  check('P17 은 아직 유효가 아니다(근거 필요)', !valid4.includes('P17') && r4.before.gapsByAxis.qualificationConflict.blocked.includes('P17'))
  check('감사 기록 — 고친 사람마다 1건', (await prisma.personaAuditLog.count({ where: { reason: { startsWith: '정본 카드 복구' } } })) === 2)

  // ── ⑤ 두 번째 실행 ──
  const s5 = await snapshot()
  check('🔴 두 번째 계획 0', r4.plan.personas.length === 0)
  const rAgain = await applyRemediation(prisma, { approvedDigest: r4.plan.digest, reason: 'db-check', now, repoRoot: root })
  check('🔴 두 번째 실행 write 0', rAgain.ok && rAgain.updated.length === 0 && s5 === await snapshot())
} finally {
  await cleanup()
  await prisma.$disconnect()
}
console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail — 운영 DB 0\n`)
process.exit(failN === 0 ? 0 : 1)
