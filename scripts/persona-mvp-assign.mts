#!/usr/bin/env tsx
/**
 * MVP 5명 Persona DB 이전 — User 5행 + Persona 5행
 *
 * 정본: docs/operations/2026-08-31-persona-db-model-design.md
 *       docs/operations/2026-08-30-persona-mvp-activation-design.md
 *
 * 사용법
 *   npx tsx scripts/persona-mvp-assign.mts           # dry-run (기본) — DB write 0
 *   npx tsx scripts/persona-mvp-assign.mts --apply   # 실제 생성
 *   npx tsx scripts/persona-mvp-assign.mts --check   # 결과 검증
 *
 * 🔴 displayName 을 이 파일에 하드코딩하지 않는다.
 *    ① 헌법 §9-6 — 페르소나를 TS 상수 배열로 두지 않는다
 *    ② git 에 올라가면 닉네임이 저장소에 영구히 남는다
 *    ③ 문서에 20개 닉네임을 박는 것과 같은 문제다 (Pool §3-2 이유 ②)
 *    → tmp/persona-displayname-selected.json (gitignored) 에서 읽는다.
 *
 * 🔴 배정 직전 Gate ⑥-B 재검사를 한다.
 *    작명 시점과 배정 시점 사이에 회원이 같은 닉네임을 만들 수 있다.
 *    하나라도 pass 가 아니면 **전부 중단**한다 — 일부만 만들지 않는다.
 *
 * 🔴 이 스크립트가 하지 않는 것
 *      · Persona seed 데이터 (identity · voiceCore · memory) — 별도 단계
 *      · Persona Bot · 자동 발행 연결
 *      · Post/Comment.personaId 값 채우기
 *      · status 를 active 로 올리는 것 — draft 로만 만든다
 */
import { PrismaClient, type PersonaStatus } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'
import { checkNameCollision, type NameCollisionSets } from './lib/persona-gate-name-collision.mjs'
import { loadNameCollisionSets, describeSets } from './lib/persona-name-collision-sets.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { authorGateOf, readAuthorHashKey } from './lib/voice-author-hash.mjs'

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')

const SELECTION_PATH = 'tmp/persona-displayname-selected.json'
/** MVP 초기 활성 5명 (MVP 활성화 설계 §2) */
const CODES = ['P05', 'P07', 'P10', 'P15', 'P17'] as const
const DRAFT: PersonaStatus = 'draft'


const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
/**
 * 🔴 **Gate ⑥-B B2 해시 — 정본 `authorGateOf`(voice-author-hash) 가 허락할 때만** (2026-10-01 author-hash v2).
 *    key 는 정본 env 에서만 읽는다. key 없음 · 저장 작가 해시가 지금 key 의 v2 가 아님(옛 세대 · 섞임 · 손상 ·
 *    빈 집합 · 다른 key) 이면 **배정하지 않고 멈춘다** — 공개 기본값으로 대조하지 않는다.
 */
const AUTHOR_KEY = readAuthorHashKey()
const hashOfFor = (sets: NameCollisionSets): ((v: string) => string) => {
  const g = authorGateOf(AUTHOR_KEY, sets)
  return g.ok ? g.hashOf : fail(`표시명 Gate ⑥-B 를 쓸 수 없다 — ${g.reason}`)
}
const ok = (m: string) => console.log(`   ✅ ${m}`)

/** 🔴 닉네임을 그대로 출력하지 않는다 — 길이와 마스킹만 */
const mask = (s: string): string => {
  const c = [...s]
  return `${c[0]}${'●'.repeat(Math.max(0, c.length - 1))} (${c.length}자)`
}

await loadEnvLocal()
const prisma = new PrismaClient()

// ── --check ──
if (CHECK) {
  console.log('══ 검증 (--check) ══\n')
  let failed = 0
  const bad = (m: string) => { console.log(`  🔴 ${m}`); failed++ }
  const good = (m: string) => console.log(`  ✅ ${m}`)

  const personas = await prisma.persona.findMany({
    where: { code: { in: [...CODES] } },
    select: { code: true, status: true, userId: true, user: { select: { nickname: true } } },
    orderBy: { code: 'asc' },
  })
  if (personas.length === CODES.length) good(`Persona ${personas.length}/${CODES.length}`)
  else bad(`Persona ${personas.length}/${CODES.length}`)

  const notDraft = personas.filter((p) => p.status !== DRAFT)
  if (notDraft.length === 0) good('전부 status=draft')
  else bad(`🔴 draft 가 아닌 것 ${notDraft.length}개 — ${notDraft.map((p) => `${p.code}:${p.status}`).join(', ')}`)

  const noNick = personas.filter((p) => (p.user.nickname ?? '').trim() === '')
  if (noNick.length === 0) good('전부 User.nickname 보유')
  else bad(`nickname 없는 페르소나 ${noNick.length}개`)

  const logs = await prisma.personaAuditLog.groupBy({
    by: ['action'], _count: { _all: true },
    where: { persona: { code: { in: [...CODES] } } },
  })
  const created = logs.find((l) => l.action === 'created')?._count._all ?? 0
  const assigned = logs.find((l) => l.action === 'display_name_assigned')?._count._all ?? 0
  if (created === CODES.length && assigned === CODES.length) good(`AuditLog created ${created} · display_name_assigned ${assigned}`)
  else bad(`AuditLog created ${created}/${CODES.length} · display_name_assigned ${assigned}/${CODES.length}`)

  // 🔴 이 단계가 넘지 말아야 할 선
  const linkedPosts = await prisma.post.count({ where: { personaId: { not: null } } })
  const linkedComments = await prisma.comment.count({ where: { personaId: { not: null } } })
  if (linkedPosts === 0 && linkedComments === 0) good('Post/Comment.personaId 전부 NULL — 발행물 없음')
  else bad(`🔴 Post ${linkedPosts} · Comment ${linkedComments} 에 personaId 가 채워졌다`)

  const sw = await prisma.personaGlobalSwitch.findMany()
  if (sw.length === 0 || sw.every((s) => s.enabled === false)) good('kill switch 꺼짐 (또는 미생성)')
  else bad('🔴 kill switch 가 켜져 있다')

  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

// ── 선택 파일 ──
if (!existsSync(SELECTION_PATH)) {
  await prisma.$disconnect()
  fail(`${SELECTION_PATH} 이 없습니다.\n   창업자가 고른 이름을 {"P05":"...", ...} 형식으로 두세요 (tmp/ 는 gitignored).`)
}
function readSelection(): Record<string, string> | { error: string } {
  try {
    return JSON.parse(readFileSync(SELECTION_PATH, 'utf-8')) as Record<string, string>
  } catch (e) {
    return { error: (e as Error).message }
  }
}
const parsed = readSelection()
if ('error' in parsed && typeof parsed.error === 'string') {
  await prisma.$disconnect()
  fail(`${SELECTION_PATH} 을 읽을 수 없습니다: ${parsed.error}`)
}
const selection = parsed as Record<string, string>
const missing = CODES.filter((c) => (selection[c] ?? '').trim() === '')
if (missing.length > 0) { await prisma.$disconnect(); fail(`선택이 비어 있습니다: ${missing.join(', ')}`) }
const extra = Object.keys(selection).filter((k) => !CODES.includes(k as (typeof CODES)[number]))
if (extra.length > 0) { await prisma.$disconnect(); fail(`MVP 5명 외 코드가 있습니다: ${extra.join(', ')}`) }
ok(`선택 파일 — ${CODES.length}명`)

// 🔴 선택끼리 중복은 아닌가
const uniq = new Set(CODES.map((c) => selection[c].trim()))
if (uniq.size !== CODES.length) { await prisma.$disconnect(); fail('선택된 이름 중 중복이 있습니다.') }
ok('선택된 이름 상호 중복 없음')

console.log(`\n══ 배정 직전 Gate ⑥-B 재검사 ══`)
const sets: NameCollisionSets = await loadNameCollisionSets(prisma)
const hashOf = hashOfFor(sets)
console.log(`   대조 집합: ${describeSets(sets)}`)

const verdicts = CODES.map((code) => ({
  code,
  name: selection[code].trim(),
  verdict: checkNameCollision(selection[code].trim(), sets, { hashOf }),
}))
for (const { code, name, verdict } of verdicts) {
  const flag = verdict.status === 'pass' ? '✅' : '🔴'
  console.log(`   ${flag} ${code}  ${mask(name)}  ${verdict.status}${verdict.status === 'pass' ? '' : ` — ${verdict.reason}`}`)
}
const blocked = verdicts.filter((v) => v.verdict.status !== 'pass')
if (blocked.length > 0) {
  await prisma.$disconnect()
  fail(`Gate ⑥-B 를 통과하지 못한 이름이 ${blocked.length}개 있습니다. 🔴 일부만 만들지 않습니다 — 전부 중단합니다.`)
}
ok(`Gate ⑥-B 전원 pass (${CODES.length}/${CODES.length})`)

// ── 기존 상태 ──
const existing = await prisma.persona.findMany({ where: { code: { in: [...CODES] } }, select: { code: true } })
if (existing.length > 0) {
  await prisma.$disconnect()
  fail(`이미 있는 Persona: ${existing.map((p) => p.code).join(', ')} — 이 스크립트는 새로 만들기만 합니다.`)
}
const beforeUsers = await prisma.user.count()
const beforePosts = await prisma.post.count()
const beforeComments = await prisma.comment.count()
const beforePersonas = await prisma.persona.count()
const beforeLogs = await prisma.personaAuditLog.count()

console.log(`\n══ 생성 예정 ══`)
console.log(`   User            +${CODES.length}   (현재 ${beforeUsers})`)
console.log(`   Persona         +${CODES.length}   (현재 ${beforePersonas}) · status=${DRAFT}`)
console.log(`   PersonaAuditLog +${CODES.length * 2}  (현재 ${beforeLogs}) — created ${CODES.length} + display_name_assigned ${CODES.length}`)
console.log(`\n   🔴 건드리지 않는 것: Post ${beforePosts}행 · Comment ${beforeComments}행 · personaId 값 · status 승격`)

if (!APPLY) {
  console.log('\n🟡 dry-run 입니다. DB write 0.')
  console.log('   실제 적용: npx tsx scripts/persona-mvp-assign.mts --apply\n')
  await prisma.$disconnect()
  process.exit(0)
}

// ── 적용 — 하나의 트랜잭션 ──
try {
  await prisma.$transaction(async (tx) => {
    for (const { code, name } of verdicts) {
      // 🔴 id 를 직접 넣지 않는다. schema 의 @default(cuid()) 에 맡긴다.
      //    페르소나 User 만 UUID 로 만들면 실회원 cuid 와 형식이 섞이고,
      //    어드민 · 검증 · 추적에서 "왜 이것만 다른가" 를 매번 되묻게 된다.
      const user = await tx.user.create({
        data: { nickname: name },
        select: { id: true },
      })
      const persona = await tx.persona.create({
        data: { code, userId: user.id, status: DRAFT },
        select: { id: true },
      })
      await tx.personaAuditLog.create({
        data: { personaId: persona.id, action: 'created', toStatus: DRAFT, reason: 'MVP 초기 5명 이전' },
      })
      await tx.personaAuditLog.create({
        data: { personaId: persona.id, action: 'display_name_assigned', reason: 'Gate ⑥-B pass 후 배정' },
      })
    }
  })
} catch (e) {
  await prisma.$disconnect()
  fail(`적용 실패 — 롤백했습니다: ${(e as Error).message}`)
}
ok('적용 완료 (트랜잭션 커밋)')

const afterPosts = await prisma.post.count()
const afterComments = await prisma.comment.count()
if (afterPosts !== beforePosts || afterComments !== beforeComments) {
  await prisma.$disconnect()
  fail(`🔴 Post/Comment row count 가 변했습니다: ${beforePosts}→${afterPosts} · ${beforeComments}→${afterComments}`)
}
ok(`Post ${afterPosts} · Comment ${afterComments} 불변`)
console.log(`\n   User ${await prisma.user.count()} · Persona ${await prisma.persona.count()} · AuditLog ${await prisma.personaAuditLog.count()}`)
console.log('\n다음: npx tsx scripts/persona-mvp-assign.mts --check\n')
await prisma.$disconnect()
