#!/usr/bin/env tsx
/**
 * Persona 말투 근거 공급 **실제 CLI 경로** 격리 DB 검사 — 🔴 운영 DB 에 붙지 않는다 (2026-09-29, Lane 3)
 *
 *   DATABASE_URL=postgresql://postgres@localhost:55452/soran_test SORAN_ISOLATED_DB=yes-throwaway \
 *     npm run persona:voice-supply-db-check
 *
 * 🔴 임시 HOME(합성 정본 말투 자산 · 빈 장부) · 임시 수집 산출물 디렉터리 · 네트워크 0 · 유료 호출 0.
 *    운영 자산·장부·수집 산출물을 읽지 않는다.
 *
 * 보는 것
 *   ① dry-run(--db · fixture) — 실회원 화자·개인정보를 거르고 3건↑ 화자 8 · P20~P25 먼저 · drift 0 · write 0
 *   ② dry-run(--db · live 기본) — 예산 게이트가 막아 creative 0 · draft 가능 0 · write 0
 *   ③ fixture --apply 인데 격리 표식 없음 → 판정 전에 멈춤 · write 0
 *   ④ fixture --apply (격리) → P26·P27 draft · 계정 0 · 감사 +6 · 건드리지 않을 표 불변
 *   ⑤ 같은 계획 재적재 → 대상 코드가 이미 있어 멈춤 · write 0
 *   ⑥ live --apply → draft 가능 0 이라 적재 거부 · write 0
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

const { PrismaClient } = await import('@prisma/client')
const { writeFakePersonaAsset } = await import('./lib/fake-persona-asset.mjs')

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

const prisma = new PrismaClient()
const TAG = `vs${Date.now().toString(36)}`
const MEMBER = '해솔맘'
const CODES = ['P26', 'P27', 'P28']
const SEED_CODE = 'P47'

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
const same = (a: Record<string, number>, b: Record<string, number>): boolean => Object.keys(a).every((k) => a[k] === b[k])

/** 🔴 이 검사가 쓰는 코드·계정만 지운다 — 같은 격리 DB 를 다른 검사도 쓴다 */
async function cleanup(): Promise<void> {
  const mine = await prisma.persona.findMany({ where: { code: { in: [...CODES, SEED_CODE] } }, select: { id: true, userId: true } })
  await prisma.personaAuditLog.deleteMany({ where: { personaId: { in: mine.map((m) => m.id) } } })
  await prisma.persona.deleteMany({ where: { id: { in: mine.map((m) => m.id) } } })
  await prisma.user.deleteMany({ where: { id: { in: mine.map((m) => m.userId) } } })
  const acc = await prisma.account.findMany({ where: { providerAccountId: { startsWith: 'voice-supply-check-' } }, select: { userId: true } })
  await prisma.account.deleteMany({ where: { providerAccountId: { startsWith: 'voice-supply-check-' } } })
  await prisma.user.deleteMany({ where: { id: { in: acc.map((a) => a.userId) } } })
}

// ── 임시 HOME · 임시 수집 산출물 ──
const HOME = mkdtempSync(join(tmpdir(), 'voice-supply-db-'))
writeFakePersonaAsset({ home: HOME, speakers: 18, perSpeaker: 6 })
mkdirSync(join(HOME, 'Library', 'Application Support', 'soransoran', 'llm-ledger'), { recursive: true })
const DATA = join(HOME, 'collect')
mkdirSync(DATA, { recursive: true })
const STEMS = [
  '그러게요 그 말씀 맞네요', '아이고 그건 좀 그렇네요', '음 그럴 수도 있겠네요',
  '맞아요 같은 생각이에요', '흠 잘 되셨으면 좋겠네요', '그래요 천천히 하셔도 돼요',
]
const AUTHORS = ['봄바람', '달빛정원', '초록우산', '가을하늘', '산들바다', '노을빛길', '은행나무', '푸른언덕']
const lines: string[] = []
AUTHORS.forEach((author, s) => {
  lines.push(JSON.stringify({
    sourceSite: 'test:cafe', sourceArticleId: `a${s}`,
    comments: Array.from({ length: 4 + (s % 3) }, (_, i) => ({ author, content: `${STEMS[(s + i) % STEMS.length]!} (${s}-${i})` })),
  }))
})
// 🔴 실회원 사칭 화자 — 회원 표시명과 같은 작성자 표시
lines.push(JSON.stringify({
  sourceSite: 'test:cafe', sourceArticleId: 'm',
  comments: [0, 1, 2, 3].map((i) => ({ author: MEMBER, content: `${STEMS[i]!} (m-${i})` })),
}))
// 🔴 개인정보 — 연락처·이메일
lines.push(JSON.stringify({
  sourceSite: 'test:cafe', sourceArticleId: 'p',
  comments: [{ author: '봄바람', content: '연락 주세요 010-1234-5678 이에요' }, { author: '달빛정원', content: '메일 주세요 abc.def@example.com 이요' }],
}))
// 🔴 지금 운영 수집 산출물의 모양 — 댓글 수만 있고 원문·작성자가 없다
lines.push(JSON.stringify({ sourceSite: 'test:cafe', sourceArticleId: 'n', commentCount: 12, bodyHead: '…' }))
writeFileSync(join(DATA, `voice-supply-${TAG}.jsonl`), `${lines.join('\n')}\n`)

const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env, HOME, ...over }
  // 🔴 예산 env 는 비운다 — live 경로가 예산 없이 부르지 않는지 본다
  delete e.SORAN_LLM_DAILY_BUDGET_USD
  delete e.SORAN_LLM_RUN_REQUEST_CAP
  delete e.SORAN_LLM_RESERVE_HEADROOM
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete e[k]
  return e
}
const cli = (args: string[], over: Record<string, string | undefined> = {}) =>
  spawnSync('npx', ['tsx', 'scripts/persona-voice-supply.mts', `--data-dir=${DATA}`, '--count=3', ...args], {
    env: env(over), encoding: 'utf-8',
  })

console.log('\n══ Persona 말투 근거 공급 — 격리 DB · 실제 CLI ══\n')
try {
  await cleanup()
  // ── 준비: 실회원 1명(계정 있음) · cadence 를 읽을 active Persona 1명 ──
  const member = await prisma.user.create({ data: { name: MEMBER }, select: { id: true } })
  await prisma.account.create({ data: { userId: member.id, type: 'oauth', provider: 'kakao', providerAccountId: `voice-supply-check-${TAG}` } })
  const seedUser = await prisma.user.create({ data: { nickname: `시드${TAG.slice(-4)}` }, select: { id: true } })
  await prisma.persona.create({
    data: {
      code: SEED_CODE, userId: seedUser.id, status: 'active',
      dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
      activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 },
    },
  })

  // ── ① dry-run · fixture ──
  {
    const b = await counts()
    const r = cli(['--db', '--creative=fixture'])
    check('① dry-run 종료 0', r.status === 0)
    if (r.status !== 0) console.log(r.stderr.slice(-600))
    check('① 실회원 화자 1명을 막았다', /실회원 화자 1/.test(r.stdout) && /REAL_MEMBER_SPEAKER 4/.test(r.stdout))
    check('① 개인정보 댓글 2건을 막았다', /PII 2/.test(r.stdout))
    check('① 3건↑ 안전 화자 8', /사용 가능\) 8/.test(r.stdout))
    check('① 대상 순서 P20 먼저', /대상 순서 P20·P21·P22·P23·P24·P25·P26·P27·P28/.test(r.stdout))
    check('① 운영 배정 바이트 drift 0', /drift 0 \(P01~P19 그대로\)/.test(r.stdout))
    check('① P20 말투 보충 묶음이 섰다', /P20 {2}묶음 \d+건 · seed 공유 1/.test(r.stdout))
    check('① P26·P27 valid · P28 격리(말투 없음)', /P26 {2}valid/.test(r.stdout) && /P27 {2}valid/.test(r.stdout) && /P28 {2}quarantined .*NO_VOICE_EVIDENCE/.test(r.stdout))
    check('🔴 ① 출력에 작성자 표시·회원 이름이 없다', [...AUTHORS, MEMBER].every((a) => !r.stdout.includes(a) && !r.stderr.includes(a)))
    check('① dry-run → write 0', same(b, await counts()))
  }

  // ── ② dry-run · live(기본) ──
  {
    const b = await counts()
    const r = cli(['--db'])
    check('② live dry-run 종료 0', r.status === 0)
    check('② 예산 env 미설정을 보고한다', /예산 env 미설정 SORAN_LLM_DAILY_BUDGET_USD/.test(r.stdout))
    check('② 예산 게이트가 막았다 — CREATIVE_BUDGET_BLOCKED · draft 가능 0',
      /P26 {2}quarantined CREATIVE_BUDGET_BLOCKED/.test(r.stdout) && /draft 가능 0/.test(r.stdout))
    check('② write 0', same(b, await counts()))
  }

  // ── ③ fixture --apply · 격리 표식 없음 ──
  {
    const b = await counts()
    const r = cli(['--db', '--creative=fixture', '--apply', '--limit=2', '--reason', 'x'], { SORAN_ISOLATED_DB: undefined })
    check('③ 격리 표식 없이 fixture 적재 → 멈춤', r.status !== 0 && /격리 DB\(SORAN_ISOLATED_DB=yes-throwaway\)에서만/.test(r.stderr))
    check('③ write 0', same(b, await counts()))
  }

  // ── ④ fixture --apply (격리) ──
  {
    const b = await counts()
    const r = cli(['--db', '--creative=fixture', '--apply', '--limit=2', '--reason', 'voice-supply db-check'])
    check('④ 적재 종료 0', r.status === 0)
    if (r.status !== 0) console.log(r.stderr.slice(-600))
    const a = await counts()
    check('④ User +2 · Persona +2 · 감사 +6', a.users === b.users + 2 && a.personas === b.personas + 2 && a.audits === b.audits + 6)
    check('④ Post·Comment·Queue·ActivityLog·RawContent·Account 불변',
      a.posts === b.posts && a.comments === b.comments && a.queue === b.queue && a.activity === b.activity
      && a.raw === b.raw && a.accounts === b.accounts)
    const rows = await prisma.persona.findMany({
      where: { code: { in: CODES } },
      select: { code: true, status: true, voiceCore: true, noGoExpressions: true, user: { select: { _count: { select: { accounts: true } }, providerId: true } } },
      orderBy: { code: 'asc' },
    })
    check('④ P26·P27 만 생겼다 (P28 격리)', rows.map((x) => x.code).join() === 'P26,P27')
    check('④ 전원 status=draft — 켜지 않았다', rows.every((x) => x.status === 'draft'))
    check('④ 새 User 는 계정 0 · providerId 없음', rows.every((x) => x.user._count.accounts === 0 && x.user.providerId === null))
    check('④ seed 가 채워졌다(voiceCore · noGo 표현)', rows.every((x) => x.voiceCore !== null && x.noGoExpressions.length > 0))
    const p20 = await prisma.persona.findUnique({ where: { code: 'P20' }, select: { id: true } })
    check('④ P20~P25 는 DB 에 만들지 않는다(말투 보충 계획뿐)', p20 === null)
  }

  // ── ⑤ 재적재 ──
  {
    const b = await counts()
    const r = cli(['--db', '--creative=fixture', '--apply', '--limit=2', '--reason', 'again'])
    check('⑤ 같은 계획 재적재 → 멈춤', r.status !== 0 && /배정 보존 없이 다시 적재하지 않는다/.test(r.stderr))
    check('⑤ write 0', same(b, await counts()))
  }

  // ── ⑥ live --apply ──
  {
    await prisma.personaAuditLog.deleteMany({ where: { persona: { code: { in: CODES } } } })
    const created = await prisma.persona.findMany({ where: { code: { in: CODES } }, select: { id: true, userId: true } })
    await prisma.persona.deleteMany({ where: { id: { in: created.map((c) => c.id) } } })
    await prisma.user.deleteMany({ where: { id: { in: created.map((c) => c.userId) } } })
    const b = await counts()
    const r = cli(['--db', '--apply', '--limit=0', '--reason', 'x'])
    check('⑥ live · 예산 없음 --apply → 적재 거부', r.status !== 0 && /적재하지 않았다/.test(r.stderr))
    check('⑥ write 0', same(b, await counts()))
  }
} finally {
  await cleanup()
  await prisma.$disconnect()
  rmSync(HOME, { recursive: true, force: true })
}

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
