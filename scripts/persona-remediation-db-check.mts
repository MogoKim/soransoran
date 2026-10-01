#!/usr/bin/env tsx
/**
 * Persona 계약 복구 **격리 DB 반례** — 🔴 운영 DB 에 붙지 않는다 (2026-10-01 · Phase 2A → Phase F)
 *
 *   DATABASE_URL=postgresql://soran@localhost:<port>/soran_test SORAN_ISOLATED_DB=yes-throwaway \
 *     npx tsx scripts/persona-remediation-db-check.mts
 *
 *   🔴 운영과 같은 모양 24명 — 정본 카드 seed + 운영에서 관측한 drift(P05 금지 역할 · P07/P10/P15/P17 생활 단계 없음 ·
 *      noGo 소재 없음 · P15/P17 카드가 적지 않은 말끝 없음) · 한 음절만 같은 표시명 한 쌍 · 실회원 1명
 *   ① 계획: 지금 19(말투·이름은 코드로 선다) → 예측 24 · 기존 유효 이탈 0 · 근거 필요 0
 *   ② 계획 뒤 DB 가 바뀜(계획 밖 · 안) → PLAN_STALE · write 0
 *   ③ 기대값 쌍이 다름 → EXPECTATION_MISMATCH · write 0
 *   ④ 중간 행에서 실패 → 앞서 쓴 행까지 롤백 · write 0
 *   ⑤ 같은 계획을 **동시에** 두 번 → 정확히 한 번만 쓴다
 *   ⑥ 적용 → 24 · 예측과 같은 사람 · 계획에 든 칸만 바뀜 · Post/Comment/Queue/활동/계정/User 불변
 *   ⑦ 두 번째 실행 → 계획 0 · write 0
 *   ⑧ 역할 쏠림은 실제 댓글 회차 원자료에서 읽히고 계약을 깎지 않는다(C9)
 *
 * 🔴 말투 근거 자산은 **임시 HOME 아래에 운영과 같은 모양**으로 만든다(CI · 로컬 동일) — 실제 정본 파일을 읽지 않는다.
 *    화자: 안전 3건 이상 18명 + 안전 2건 · 경험형 1건 이상 8명(운영 32 중 뒤 14명과 같은 종류) + 서지 못하는 화자 2명.
 *    fixture 가 실제보다 강하지 않다: 경험형은 실제 분류기(`carriesExperience`)가 경험형으로 판정한 문장만 쓴다.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// ── 🔴 임시 HOME — 말투 자산 경로가 HOME 아래다. 모듈을 읽기 **전에** 바꾼다 ──
const HOME = mkdtempSync(join(tmpdir(), 'soran-remediation-db-'))
process.env.HOME = HOME
const spk = (k: string): string => createHash('sha256').update(`spk-${k}`).digest('hex').slice(0, 12)
const OPEN = ['그러게요', '맞아요', '음', '아이고', '그쵸', '어머', '진짜요', '그러니까요', '하긴', '와', '정말요', '네네', '아휴', '흠', '그렇죠', '오', '아', '참']
const TAIL = ['날이 갑자기 추워졌네요', '그 말이 딱 맞네요', '다들 비슷하신가 봐요', '그런 날도 있는 거죠', '천천히 하시면 돼요']
const OPEN2 = ['그렇군요', '세상에', '어쩜', '아무렴요', '그럼요', '저런', '좋네요', '참말로', '역시', '그죠']
const EXP_WHAT = ['그거', '이사', '수술', '명절', '이직', '입원', '장례', '여행', '살림', '육아']
/** 🔴 경험형 문장 — 아래에서 실제 분류기로 경험형인지 확인하고, 아니면 멈춘다(가짜 fixture 금지) */
const expText = (i: number, k: number): string => `저도 작년에 ${EXP_WHAT[(i + k) % EXP_WHAT.length]} 겪었어요 정말 힘들었어요 ${'.'.repeat(k + 1)}`
const SAFE18 = OPEN.flatMap((o, i) => TAIL.slice(0, 4).map((t, k) => ({ speakerId: spk(String(i)), content: `${o} ${t} ${'~'.repeat(k)}`.trim() })))
/** 안전 2 + 경험형 1~2 — 8명(운영 32 중 뒤쪽과 같은 종류) · 서지 못하는 화자 2명(안전 2 만 · 안전 1 + 경험 3) */
const EXTRA = OPEN2.slice(0, 8).flatMap((o, i) => [
  { speakerId: spk(`x${i}`), content: `${o} ${TAIL[0]} 정말` }, { speakerId: spk(`x${i}`), content: `${o} ${TAIL[4]} 그쵸` },
  ...Array.from({ length: 1 + (i % 2) }, (_, k) => ({ speakerId: spk(`x${i}`), content: expText(i, k) })),
])
const WEAK = [
  { speakerId: spk('w0'), content: `${OPEN2[8]} ${TAIL[1]} 정말` }, { speakerId: spk('w0'), content: `${OPEN2[8]} ${TAIL[2]} 그쵸` },
  { speakerId: spk('w1'), content: `${OPEN2[9]} ${TAIL[3]} 정말` },
  ...[0, 1, 2].map((k) => ({ speakerId: spk('w1'), content: expText(9, k) })),
]
{
  const dir = join(HOME, 'Library', 'Application Support', 'soransoran', 'persona-reference')
  mkdirSync(dir, { recursive: true })
  const raw = JSON.stringify({ version: 1, comments: [...SAFE18, ...EXTRA, ...WEAK] })
  writeFileSync(join(dir, 'corpus.json'), raw)
  chmodSync(join(dir, 'corpus.json'), 0o600)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ sourceDigest: createHash('sha256').update(raw).digest('hex').slice(0, 16) }))
}

const { PrismaClient } = await import('@prisma/client')
const { parsePoolDoc } = await import('../src/lib/persona-pool-card')
const { noGoExpressionKey } = await import('../src/lib/persona-no-go')
const { explicitEndingsOf } = await import('../src/lib/persona-card-verify')
const { PRODUCTION_PERSONA_CODES } = await import('../src/lib/persona-cohort')
const { readRemediation, applyRemediation } = await import('./lib/persona-contract-remediation.mjs')
const { bundlesForPersonas, carriesExperience } = await import('./lib/persona-reference-store.mjs')
const { makeDbTargetSource } = await import('./lib/persona-comment-source-db')
const { roleRoundVerdict } = await import('../src/lib/persona-reserve')
const { readReserveFacts } = await import('./lib/persona-reserve-facts.mjs')
const { PERSONA_POOL_DOC } = await import('./lib/voice-runtime.mjs')

{
  const exp = [...EXTRA, ...WEAK].map((c) => c.content).filter((t) => t.startsWith('저도 작년에'))
  const safe = [...SAFE18, ...EXTRA, ...WEAK].map((c) => c.content).filter((t) => !t.startsWith('저도 작년에'))
  if (!exp.every(carriesExperience) || safe.some(carriesExperience)) {
    console.error('🔴 fixture 가 실제 분류기와 맞지 않는다 — 경험형/안전 문장을 고쳐라'); process.exit(3)
  }
}

let pass = 0
let failN = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const prisma = new PrismaClient()
const root = process.cwd()
const now = new Date()
const CODES = [...PRODUCTION_PERSONA_CODES]
const DRIFT = ['P05', 'P07', 'P10', 'P15', 'P17']

const bundles = bundlesForPersonas({ repoRoot: root, personaCodes: CODES })
if (bundles.origin !== '정본 자산' || bundles.byCode.size !== 24) {
  console.error(`🔴 임시 말투 자산이 운영 모양으로 서지 않았다(${bundles.origin} · ${bundles.byCode.size}) — ${bundles.blocks.join(' / ')}`)
  process.exit(3)
}

async function cleanup(): Promise<void> {
  const mine = await prisma.persona.findMany({ where: { code: { in: CODES } }, select: { id: true, userId: true } })
  const ids = mine.map((m) => m.id)
  const posts = await prisma.post.findMany({ where: { OR: [{ personaId: { in: ids } }, { title: { startsWith: 'rmd-role' } }] }, select: { id: true } })
  await prisma.personaApprovalQueue.deleteMany({ where: { OR: [{ personaId: { in: ids } }, { dedupKey: { startsWith: 'rmd-role' } }] } })
  await prisma.comment.deleteMany({ where: { OR: [{ personaId: { in: ids } }, { postId: { in: posts.map((p) => p.id) } }] } })
  await prisma.post.deleteMany({ where: { id: { in: posts.map((p) => p.id) } } })
  await prisma.personaAuditLog.deleteMany({ where: { personaId: { in: ids } } })
  await prisma.persona.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: mine.map((m) => m.userId) } }, { nickname: { startsWith: 'rmd-' } }] } })
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
    voiceCore: { length: c.voiceLength ?? '', register: '존댓말', ending: explicitEndingsOf(c.voiceTokens)[0] ?? '~요', emoji: '없음' },
    voiceVariations: Array.from({ length: c.variationCount }, (_, i) => `v${i}`),
    activityRhythm: { activeHours: [[9, 12]], burstiness: 0.3, weekdayBias: 0.5 },
    ageBand: c.ageBand, region: c.region, lifeStage: '자녀 독립기',
    noGoTopics: c.noGoTopics, noGoExpressions: c.noGoExpressions.map(noGoExpressionKey), forbiddenReactionRoles: c.forbiddenReactionRoles,
    dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
  }
}
/** 🔴 운영에서 관측한 drift 모양 그대로 */
const driftOf = (code: string): Record<string, unknown> => {
  const base = seedOf(code)
  const noEnding = { ...base.voiceCore } as Record<string, unknown>
  delete noEnding.ending
  switch (code) {
    case 'P05': return { forbiddenReactionRoles: ['information'] }
    case 'P07': return { lifeStage: null, noGoTopics: [], voiceCore: { ...base.voiceCore, length: '중간' } }
    case 'P10': return { lifeStage: null, noGoTopics: [] }
    case 'P15': return { lifeStage: null, noGoTopics: [], voiceCore: noEnding }
    case 'P17': return { lifeStage: null, noGoTopics: [], voiceCore: noEnding }
    default: return {}
  }
}
/** 🔴 표시명 — 고유 3음절. P22 · P25 는 끝 음절 하나만 같은 쌍(옛 거리 판정이 review 로 막던 모양) */
const NAME_POOL = ['은하수', '도라지', '개나리', '무지개', '청포도', '진달래', '소나무', '바람결', '해오름', '구름밭', '물안개', '들꽃길',
  '별무리', '첫눈송이', '오솔길', '조각달', '능소화', '산들애', '찻잔속', '느티잎', '봄비', '모래알', '하얀돌', '파도']
const NAMES: Record<string, string> = Object.fromEntries(CODES.map((c, i) => [c, NAME_POOL[i]!]))
NAMES.P22 = '노을빛'
NAMES.P25 = '새벽빛'
{
  // 🔴 fixture 이름끼리는 서로 혼동되지 않아야 한다 — 아니면 시험이 이름 축을 섞어 잰다
  const { checkNameCollision } = await import('./lib/persona-gate-name-collision.mjs')
  const bad = CODES.filter((c) => checkNameCollision(NAMES[c]!, { personaNames: CODES.filter((x) => x !== c).map((x) => NAMES[x]!), memberNames: ['소담길'] }).status !== 'pass')
  if (bad.length > 0) { console.error(`🔴 fixture 표시명이 서로 혼동된다: ${bad.join(',')}`); process.exit(3) }
}
const make = async (code: string) => {
  const u = await prisma.user.create({ data: { nickname: NAMES[code]! }, select: { id: true } })
  return prisma.persona.create({ data: { code, userId: u.id, status: 'active', ...seedOf(code), ...driftOf(code) }, select: { id: true } })
}
const FIELDS = { code: true, updatedAt: true, ageBand: true, region: true, lifeStage: true, identity: true, voiceCore: true, voiceVariations: true,
  activityRhythm: true, noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true, dailyCap: true, weeklyCap: true, silenceRate: true, status: true } as const
/** 🔴 전 표 지문 — write 0 을 행 수가 아니라 내용으로 본다 */
const snapshot = async (): Promise<string> => JSON.stringify({
  personas: await prisma.persona.findMany({ where: { code: { in: CODES } }, orderBy: { code: 'asc' }, select: FIELDS }),
  audit: await prisma.personaAuditLog.count(),
  users: await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, nickname: true, name: true, updatedAt: true } }),
  counts: [await prisma.post.count(), await prisma.comment.count(), await prisma.personaApprovalQueue.count(),
    await prisma.personaActivityLog.count(), await prisma.account.count()],
})
const actCounts = async (): Promise<string> => JSON.stringify([await prisma.post.count(), await prisma.comment.count(),
  await prisma.personaApprovalQueue.count(), await prisma.originalPostApprovalQueue.count(), await prisma.personaActivityLog.count(),
  await prisma.microSeedRawContent.count(), await prisma.account.count()])
const valid = (r: { byState: Record<string, string[]> }): string[] => [...r.byState.reserve!, ...r.byState['stage-active']!].sort()

console.log('\n══ Persona 계약 복구 — 격리 DB (운영 모양 24명) ══\n')
try {
  await cleanup()
  for (const c of CODES) await make(c)
  await prisma.user.create({ data: { nickname: 'rmd-member', name: '소담길' } })

  // ── ① 계획 ──
  const r0 = await readRemediation(prisma, { now, repoRoot: root })
  const planned = r0.plan.personas.map((p) => p.code)
  check(`계획 = drift 5명 [${planned.join(',')}]`, planned.join(',') === DRIFT.join(','))
  check('🔴 lifeStage 는 카드 제목 그대로만', r0.plan.personas.filter((p) => p.code !== 'P05').every((p) =>
    p.changes.find((c) => c.field === 'lifeStage')?.after === pool.cards.find((c) => c.code === p.code)!.title))
  check('🔴 카드가 말끝을 적지 않은 P15 · P17 — 말끝 생성 0', !r0.plan.personas.some((p) => p.changes.some((c) => c.field === 'voiceCore.ending')))
  check('근거 필요 칸 0', r0.plan.evidenceRequired.length === 0, JSON.stringify(r0.plan.evidenceRequired))
  const validBefore = valid(r0.before)
  const validPred = valid(r0.predicted)
  check(`지금 ${r0.before.contractValid} — drift 5명만 빠진다 · P20~P25 는 말투·이름으로 선다`, r0.before.contractValid === 19
    && CODES.filter((c) => !DRIFT.includes(c)).join(',') === validBefore.join(','), validBefore.join(','))
  check(`🔴 예측 정확히 24 · 이탈 0`, r0.predicted.contractValid === 24 && validBefore.every((c) => validPred.includes(c)))
  const EXPECT = { before: 19, after: 24 }

  // ── ② 계획 뒤 DB 가 바뀜 ──
  const stale = r0.plan.digest
  await prisma.persona.update({ where: { code: 'P14' }, data: { dailyCap: 4 } })
  const s2 = await snapshot()
  const rStale = await applyRemediation(prisma, { approvedDigest: stale, expected: EXPECT, reason: 'db-check', now, repoRoot: root })
  check(`🔴 계획 밖 행 변경 → 중단 (${rStale.ok ? 'ok' : rStale.reason.slice(0, 40)})`, !rStale.ok && rStale.reason.includes('PLAN_STALE'))
  check('🔴 중단 시 write 0 (내용 지문 불변)', s2 === await snapshot())
  const staleIn = (await readRemediation(prisma, { now, repoRoot: root })).plan.digest
  await prisma.persona.update({ where: { code: 'P05' }, data: { weeklyCap: 13 } })
  const s2c = await snapshot()
  const rStaleIn = await applyRemediation(prisma, { approvedDigest: staleIn, expected: EXPECT, reason: 'db-check', now, repoRoot: root })
  check('🔴 계획 안 행 변경 → 중단 · write 0', !rStaleIn.ok && rStaleIn.reason.includes('PLAN_STALE') && s2c === await snapshot())

  // ── ③ 기대값 쌍이 다름 ──
  const r3 = await readRemediation(prisma, { now, repoRoot: root })
  const s3 = await snapshot()
  for (const bad of [{ before: 13, after: 24 }, { before: 19, after: 23 }]) {
    const rBad = await applyRemediation(prisma, { approvedDigest: r3.plan.digest, expected: bad, reason: 'db-check', now, repoRoot: root })
    check(`🔴 기대 ${bad.before}→${bad.after} ≠ 실제 → 중단 · write 0`, !rBad.ok && rBad.reason.includes('EXPECTATION_MISMATCH') && s3 === await snapshot())
  }
  const rNoReason = await applyRemediation(prisma, { approvedDigest: r3.plan.digest, expected: EXPECT, reason: '  ', now, repoRoot: root })
  check('🔴 reason 이 비면 중단 · write 0', !rNoReason.ok && s3 === await snapshot())

  // ── ④ 부분 실패 ──
  const rPart = await applyRemediation(prisma, {
    approvedDigest: r3.plan.digest, expected: EXPECT, reason: 'db-check', now, repoRoot: root,
    hooks: { beforeUpdate: (_code, i) => { if (i === 3) throw new Error('주입 실패 — 네 번째 행') } },
  })
  check('🔴 네 번째 행에서 실패 → 전원 롤백', !rPart.ok && rPart.reason.includes('주입 실패'))
  check('🔴 부분 실패 시 write 0 — 앞 세 행도 그대로 · 감사 기록 0', s3 === await snapshot())

  // ── ⑤ 동시 실행 → 정확히 한 번 ──
  const acts = await actCounts()
  const users = JSON.stringify(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, nickname: true, name: true, updatedAt: true } }))
  const beforeRows = await prisma.persona.findMany({ where: { code: { in: CODES } }, orderBy: { code: 'asc' }, select: FIELDS })
  const [ra, rb] = await Promise.all([1, 2].map(() =>
    applyRemediation(prisma, { approvedDigest: r3.plan.digest, expected: EXPECT, reason: 'db-check 동시', now, repoRoot: root })))
  const oks = [ra!, rb!].filter((x) => x.ok)
  check(`🔴 동시 두 번 → 성공 정확히 1 (${[ra!, rb!].map((x) => (x.ok ? 'ok' : x.reason.slice(0, 30))).join(' | ')})`, oks.length === 1)
  check('🔴 감사 기록 = 고친 사람 5명 × 1 (두 번 쓰지 않았다)',
    (await prisma.personaAuditLog.count({ where: { reason: { startsWith: '정본 카드 복구' } } })) === 5)

  // ── ⑥ 적용 결과 ──
  const ok = oks[0]
  check(`적용 ${ok?.ok ? `${ok.updated.join(',')} · ${ok.before}→${ok.after}` : '실패'}`, ok?.ok === true && ok.updated.join(',') === DRIFT.join(',') && ok.before === 19 && ok.after === 24)
  const r6 = await readRemediation(prisma, { now, repoRoot: root })
  check(`🔴 적용 뒤 계약 유효 24 = 예측 · 기존 유효 이탈 0`, r6.before.contractValid === 24 && valid(r6.before).join(',') === validPred.join(','))
  check('🔴 가짜 활동 0 — Post · Comment · 두 Queue · 활동 · 원문 · 계정 행 불변', acts === await actCounts())
  check('🔴 User 불변 — 표시명 자동 변경 0', users === JSON.stringify(await prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, nickname: true, name: true, updatedAt: true } })))
  const afterRows = await prisma.persona.findMany({ where: { code: { in: CODES } }, orderBy: { code: 'asc' }, select: FIELDS })
  const plannedFields = new Map(r3.plan.personas.map((p) => [p.code, new Set(p.changes.map((c) => c.field.split('.')[0]!))]))
  const strays: string[] = []
  for (const [i, b] of beforeRows.entries()) {
    const a = afterRows[i]! as Record<string, unknown>
    for (const k of Object.keys(b)) {
      if (k === 'updatedAt') continue
      const changed = JSON.stringify((b as Record<string, unknown>)[k]) !== JSON.stringify(a[k])
      if (changed && !(plannedFields.get(b.code)?.has(k) ?? false)) strays.push(`${b.code}.${k}`)
    }
    if (!plannedFields.has(b.code) && b.updatedAt.getTime() !== (a.updatedAt as Date).getTime()) strays.push(`${b.code}.updatedAt`)
  }
  check(`🔴 계획에 든 칸만 바뀌었다 (계획 밖 변경 ${strays.length})`, strays.length === 0, strays.join(','))
  const p17 = afterRows.find((r) => r.code === 'P17')!
  check('P17 — lifeStage = 카드 제목 · 말끝 칸은 여전히 없다', p17.lifeStage === pool.cards.find((c) => c.code === 'P17')!.title
    && !('ending' in ((p17.voiceCore ?? {}) as Record<string, unknown>)))

  // ── ⑦ 두 번째 실행 ──
  const s7 = await snapshot()
  check('🔴 두 번째 계획 0', r6.plan.personas.length === 0)
  const rAgain = await applyRemediation(prisma, { approvedDigest: r6.plan.digest, expected: { before: 24, after: 24 }, reason: 'db-check', now, repoRoot: root })
  check('🔴 두 번째 실행 write 0', rAgain.ok && rAgain.updated.length === 0 && s7 === await snapshot())
  // 🔴 같은 승인(19→24)을 그대로 다시 보내도 계획이 비었으면 쓸 것이 없다 — 실패가 아니라 no-op 이다
  const rReplay = await applyRemediation(prisma, { approvedDigest: r6.plan.digest, expected: EXPECT, reason: 'db-check 재실행', now, repoRoot: root })
  check('🔴 같은 승인 재실행 → no-op 성공 · write 0', rReplay.ok && rReplay.updated.length === 0 && s7 === await snapshot())

  // ── ⑦-b 🔴 운영 플래그(Phase G) — 격리 env · SHA 불일치 · 인자 누락은 DB 에 붙기 전에 거부 ──
  {
    const { spawnSync } = await import('node:child_process')
    const TSX = join(root, 'node_modules/.bin/tsx')
    const CLI = join(root, 'scripts/persona-contract-remediation.mts')
    const s7b = await snapshot()
    const A40 = 'a'.repeat(40)
    const full = ['--apply', '--production', `--target=${A40}`, `--digest=${r6.plan.digest}`, '--expect=19:24', '--reason=db-check']
    const run = (args: string[], env: Record<string, string>) => spawnSync(TSX, [CLI, ...args], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' })
    const iso = run(full, {})
    check('🔴 운영 플래그 + 격리 env → exit 2 · write 0', iso.status === 2 && /SORAN_ISOLATED_DB/.test(iso.stderr) && s7b === await snapshot(), iso.stderr.slice(0, 200))
    const sha = run(full, { SORAN_ISOLATED_DB: '' })
    check('🔴 운영 플래그 + SHA 불일치 → exit 2 · write 0', sha.status === 2 && /≠ target|읽지 못했다/.test(sha.stderr) && s7b === await snapshot(), sha.stderr.slice(0, 300))
    for (const drop of ['--target', '--digest', '--expect', '--reason', '--apply']) {
      const r = run(full.filter((a) => !a.startsWith(drop)), { SORAN_ISOLATED_DB: '' })
      check(`🔴 운영 인자 ${drop} 누락 → exit 2 · write 0`, r.status === 2 && s7b === await snapshot(), r.stderr.slice(0, 160))
    }
    const plainProd = run(['--apply', '--digest=x', '--expect=19:24', '--reason=x'], { SORAN_ISOLATED_DB: '', DATABASE_URL: 'postgresql://u@db.example.invalid:5432/postgres' })
    check('🔴 플래그 없는 --apply + 운영 주소 → exit 2(격리 전용 그대로)', plainProd.status === 2 && /격리 DB 에서만/.test(plainProd.stderr), plainProd.stderr.slice(0, 200))
  }

  // ── ⑧ 🔴 역할 쏠림은 **실제 댓글 회차 원자료**에서 읽힌다 (2026-10-01 · C9 보정) ──
  const ids = Object.fromEntries((await prisma.persona.findMany({ where: { code: { in: ['P01', 'P14'] } }, select: { code: true, id: true, userId: true } }))
    .map((p) => [p.code, p]))
  const rolePost = await prisma.post.create({
    data: { boardType: 'FREE', title: 'rmd-role 글', content: '본문', authorId: ids.P14!.userId, personaId: ids.P14!.id, status: 'PUBLISHED' },
    select: { id: true },
  })
  const roles = [...Array(9).fill('empathy'), 'question'] as string[]
  for (const [i, role] of roles.entries()) {
    const c = await prisma.comment.create({
      data: { postId: rolePost.id, content: `댓글 ${i}`, authorId: ids.P01!.userId, personaId: ids.P01!.id, commentOrigin: 'PERSONA' },
      select: { id: true },
    })
    await prisma.personaApprovalQueue.create({ data: {
      personaId: ids.P01!.id, targetPostId: rolePost.id, candidateText: `댓글 ${i}`, reactionType: role,
      gateStatus: 'pass', gateResults: {}, dedupKey: `rmd-role-${i}`, status: 'PUBLISHED', publishedCommentId: c.id,
    } })
  }
  const src = makeDbTargetSource({ prisma, windowStart: new Date(now.getTime() - 7 * 86_400_000), now })
  const sp = await src.personas()
  const p01 = sp.find((p) => p.code === 'P01')!
  check(`🔴 DB source → P01 역할 이력 ${JSON.stringify(p01.recentRoles)}`, p01.recentRoles !== null
    && p01.recentRoles.roleCounts.empathy === 9 && p01.recentRoles.roleCounts.question === 1 && p01.recentRoles.unresolvedRoleEvents === 0)
  const facts = await readReserveFacts(prisma, { now, repoRoot: root })
  const h01 = facts.rows.find((r) => r.code === 'P01')!.history!
  check('🔴 회차 원자료 = 계약 원자료 (같은 정본 `roleHistoryOf`)', JSON.stringify(h01.roleCounts) === JSON.stringify(p01.recentRoles!.roleCounts))
  const rr = roleRoundVerdict(p01.recentRoles)
  check('🔴 회차 판정 → P01 empathy 만 막힘', rr.status === 'ok' && rr.blockedRoles.join(',') === 'empathy')
  const r8 = await readRemediation(prisma, { now, repoRoot: root })
  check('🔴 P01 contract-valid 유지 — 역할 쏠림은 계약을 깎지 않는다', r8.before.byState['stage-active'].includes('P01'))
  // 역할을 모르는 댓글(발행 Queue 행 없음) 하나 → 이번 회차 모름
  await prisma.comment.create({
    data: { postId: rolePost.id, content: '역할 모름', authorId: ids.P01!.userId, personaId: ids.P01!.id, commentOrigin: 'PERSONA' },
  })
  const p01b = (await src.personas()).find((p) => p.code === 'P01')!
  check('🔴 역할 모르는 댓글 1건 → 회차 모름(fail-closed)', roleRoundVerdict(p01b.recentRoles).status === 'unknown'
    && (await readRemediation(prisma, { now, repoRoot: root })).before.byState['stage-active'].includes('P01'))
} finally {
  await cleanup()
  await prisma.$disconnect()
}
console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail — 운영 DB 0\n`)
process.exit(failN === 0 ? 0 : 1)
