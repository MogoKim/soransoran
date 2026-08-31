#!/usr/bin/env tsx
/**
 * Persona seed 이전 — identity · voiceCore · voiceVariations · activityRhythm · noGo · memory
 *
 * 정본: docs/operations/2026-08-30-persona-pool-design.md §4 카드
 *       docs/operations/2026-08-31-persona-db-model-design.md §6
 *
 * 사용법
 *   npx tsx scripts/persona-seed-apply.mts           # dry-run (기본) — DB write 0
 *   npx tsx scripts/persona-seed-apply.mts --apply   # 실제 적용
 *   npx tsx scripts/persona-seed-apply.mts --check   # 결과 검증
 *
 * 🔴 seed 값을 이 파일에 하드코딩하지 않는다.
 *    헌법 §9-6 — 페르소나를 TS 상수 배열로 두지 않는다.
 *    우나어 225명 PR 이 7단계를 소모한 사례가 그 금지의 근거다.
 *    → tmp/persona-seed.json (gitignored) 에서 읽는다.
 *
 * 🔴 seed 파일에 넣으면 안 되는 것 — 스크립트가 검사한다
 *      정확한 나이 · 년생 · 실제 시·구 지명 · 병명 ·
 *      출처 커뮤니티 호칭 · author 원문 · sourceUrl · sourceRef · 실회원 닉네임
 *    Pool 카드가 이미 밴드·구분값으로만 쓰여 있다. 그 형태를 유지한다.
 *
 * 🔴 이 스크립트가 하지 않는 것
 *      · status 를 active 로 올리는 것 — draft 그대로 둔다
 *      · Post/Comment.personaId 채우기
 *      · Persona Bot · 자동 발행 연결
 *      · kill switch 조작
 */
import { PrismaClient, type PersonaStatus } from '@prisma/client'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { checkNameCollision, type NameCollisionSets } from './lib/persona-gate-name-collision.mjs'
import { loadNameCollisionSets } from './lib/persona-name-collision-sets.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')

const SEED_PATH = 'tmp/persona-seed.json'
const CODES = ['P05', 'P07', 'P10', 'P15', 'P17'] as const
const DRAFT: PersonaStatus = 'draft'

const AUTHOR_SALT_ENV = 'VOICE_AUTHOR_HASH_SALT'
const DEFAULT_SALT = 'soransoran-voice-v1'

const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const ok = (m: string) => console.log(`   ✅ ${m}`)

/** seed 한 명분 — 🔴 전부 optional. 있는 것만 채운다 */
type PersonaSeed = {
  ageBand?: string
  region?: string
  lifeStage?: string
  identity?: Record<string, unknown>
  voiceCore?: Record<string, unknown>
  voiceVariations?: unknown[]
  activityRhythm?: Record<string, unknown>
  noGoTopics?: string[]
  noGoExpressions?: string[]
  forbiddenReactionRoles?: string[]
  dailyCap?: number
  weeklyCap?: number
  silenceRate?: number
  selfMemories?: string[]
  communityMemories?: Array<{ topic: string; summary: string }>
  negativeMemories?: Array<{ avoidance: string; reasonCode?: string }>
}

// ── 🔴 금지 패턴 — seed 값 전체를 훑는다 ──
const FORBIDDEN: ReadonlyArray<{ code: string; re: RegExp }> = [
  { code: 'AGE_EXACT', re: /[0-9]{2}\s*세(?![대기])/u },
  { code: 'BIRTH_YEAR', re: /[0-9]{2,4}\s*년생/u },
  { code: 'REGION_EXACT', re: /[가-힣]{2,4}(시|구|동|읍|면)(\s|$|·|,)/u },
  { code: 'DISEASE', re: /(당뇨|고혈압|갑상선|류마티스|우울증|치매|골다공증|디스크|협심증|뇌졸중|백내장|녹내장|공황장애)/u },
  { code: 'SOURCE_MARKER', re: /(82님|우갱님|레테님|은오님|82cook|masanmam|goondae|yeowooya|navercafe)/iu },
  { code: 'URL', re: /https?:\/\//u },
  { code: 'SOURCE_REF', re: /\bc[a-z0-9]{24}\b/u },
]
/** 🔴 지역 밴드는 허용값이다 — 실지명과 구분한다 */
const REGION_BAND = new Set(['수도권', '광역시', '중소도시', '읍면'])

function scanForbidden(value: unknown, path: string, hits: string[]): void {
  if (typeof value === 'string') {
    if (REGION_BAND.has(value.trim())) return
    for (const { code, re } of FORBIDDEN) {
      if (re.test(value)) hits.push(`${path}: ${code}`)   // 🔴 값을 담지 않는다
    }
    return
  }
  if (Array.isArray(value)) { value.forEach((v, i) => scanForbidden(v, `${path}[${i}]`, hits)); return }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) scanForbidden(v, `${path}.${k}`, hits)
  }
}

await loadEnvLocal()
const prisma = new PrismaClient()
const salt = (process.env[AUTHOR_SALT_ENV] ?? DEFAULT_SALT).trim()
const hashOf = (v: string) => `sha256:${createHash('sha256').update(`${salt}::${v}`, 'utf8').digest('hex')}`

// ── --check ──
if (CHECK) {
  console.log('══ 검증 (--check) ══\n')
  let failed = 0
  const bad = (m: string) => { console.log(`  🔴 ${m}`); failed++ }
  const good = (m: string) => console.log(`  ✅ ${m}`)

  const personas = await prisma.persona.findMany({
    where: { code: { in: [...CODES] } },
    select: {
      code: true, status: true, identity: true, voiceCore: true, voiceVariations: true,
      activityRhythm: true, noGoTopics: true, dailyCap: true,
      _count: { select: { selfMemories: true, communityMemories: true, negativeMemories: true } },
    },
    orderBy: { code: 'asc' },
  })
  if (personas.length === CODES.length) good(`Persona ${personas.length}/${CODES.length}`)
  else bad(`Persona ${personas.length}/${CODES.length}`)

  const notDraft = personas.filter((p) => p.status !== DRAFT)
  if (notDraft.length === 0) good('전부 status=draft (seed 는 활성화가 아니다)')
  else bad(`🔴 draft 가 아닌 것 ${notDraft.length}개`)

  for (const p of personas) {
    const parts = [
      p.identity !== null ? 'identity' : null,
      p.voiceCore !== null ? 'voiceCore' : null,
      p.voiceVariations !== null ? 'variations' : null,
      p.activityRhythm !== null ? 'rhythm' : null,
      p.noGoTopics.length > 0 ? `noGo ${p.noGoTopics.length}` : null,
      p.dailyCap !== null ? `cap ${p.dailyCap}` : null,
    ].filter((v): v is string => v !== null)
    console.log(`     ${p.code}  ${parts.length === 0 ? '(비어 있음)' : parts.join(' · ')}` +
      `  memory ${p._count.selfMemories}/${p._count.communityMemories}/${p._count.negativeMemories}`)
  }

  const linkedPosts = await prisma.post.count({ where: { personaId: { not: null } } })
  const linkedComments = await prisma.comment.count({ where: { personaId: { not: null } } })
  if (linkedPosts === 0 && linkedComments === 0) good('Post/Comment.personaId 전부 NULL')
  else bad(`🔴 Post ${linkedPosts} · Comment ${linkedComments} 에 personaId 가 채워졌다`)

  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

// ── seed 파일 ──
if (!existsSync(SEED_PATH)) {
  await prisma.$disconnect()
  fail(`${SEED_PATH} 이 없습니다.\n   Pool 설계 §4 카드를 {"P05": {...}, ...} 형식으로 두세요 (tmp/ 는 gitignored).`)
}
function readSeed(): Record<string, PersonaSeed> | { error: string } {
  try { return JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as Record<string, PersonaSeed> }
  catch (e) { return { error: (e as Error).message } }
}
const parsed = readSeed()
if ('error' in parsed && typeof parsed.error === 'string') {
  await prisma.$disconnect()
  fail(`${SEED_PATH} 을 읽을 수 없습니다: ${parsed.error}`)
}
const seeds = parsed as Record<string, PersonaSeed>

const missing = CODES.filter((c) => seeds[c] === undefined)
if (missing.length > 0) { await prisma.$disconnect(); fail(`seed 가 없는 코드: ${missing.join(', ')}`) }
const extra = Object.keys(seeds).filter((k) => !CODES.includes(k as (typeof CODES)[number]))
if (extra.length > 0) { await prisma.$disconnect(); fail(`MVP 5명 외 코드가 있습니다: ${extra.join(', ')}`) }
ok(`seed 파일 — ${CODES.length}명`)

// ── 🔴 금지 패턴 스캔 ──
const forbiddenHits: string[] = []
for (const code of CODES) scanForbidden(seeds[code], code, forbiddenHits)
if (forbiddenHits.length > 0) {
  await prisma.$disconnect()
  fail(`seed 에 금지 패턴이 있습니다 (${forbiddenHits.length}건):\n     ${forbiddenHits.join('\n     ')}`)
}
ok('금지 패턴 스캔 — 나이 · 년생 · 실지명 · 병명 · 출처 흔적 · URL · sourceRef 0건')

// ── 🔴 적용 직전 상태 검증 ──
console.log('\n══ 적용 직전 검증 ══')
const personas = await prisma.persona.findMany({
  where: { code: { in: [...CODES] } },
  select: { id: true, code: true, status: true, user: { select: { nickname: true, name: true } } },
  orderBy: { code: 'asc' },
})
if (personas.length !== CODES.length) { await prisma.$disconnect(); fail(`Persona 가 ${personas.length}/${CODES.length} 개입니다.`) }
ok(`Persona ${personas.length}/${CODES.length} 존재`)

const notDraft = personas.filter((p) => p.status !== DRAFT)
if (notDraft.length > 0) { await prisma.$disconnect(); fail(`draft 가 아닌 페르소나가 있습니다: ${notDraft.map((p) => p.code).join(', ')}`) }
ok('전부 status=draft')

const noNick = personas.filter((p) => ((p.user.nickname ?? p.user.name) ?? '').trim() === '')
if (noNick.length > 0) { await prisma.$disconnect(); fail(`nickname 이 없는 페르소나: ${noNick.map((p) => p.code).join(', ')}`) }
ok('전부 User.nickname 보유')

// 🔴 Gate ⑥-B 재검사 — seed 단계에서도 이름이 여전히 유효한지 본다
const sets: NameCollisionSets = await loadNameCollisionSets(prisma)
const blocked: string[] = []
for (const p of personas) {
  const name = ((p.user.nickname ?? p.user.name) ?? '').trim()
  // 🔴 자기 자신은 대조 집합에서 뺀다 — 이미 배정된 이름이다
  const own = new Set([name])
  const scoped: NameCollisionSets = {
    ...sets,
    memberNames: (sets.memberNames ?? []).filter((n) => !own.has(n)),
    personaNames: (sets.personaNames ?? []).filter((n) => !own.has(n)),
  }
  const v = checkNameCollision(name, scoped, { hashOf })
  if (v.status !== 'pass') blocked.push(`${p.code}:${v.status}`)
}
if (blocked.length > 0) { await prisma.$disconnect(); fail(`Gate ⑥-B 재검사 실패: ${blocked.join(', ')}`) }
ok(`Gate ⑥-B 재검사 ${personas.length}/${personas.length} pass`)

const linkedPosts = await prisma.post.count({ where: { personaId: { not: null } } })
const linkedComments = await prisma.comment.count({ where: { personaId: { not: null } } })
if (linkedPosts !== 0 || linkedComments !== 0) {
  await prisma.$disconnect()
  fail(`이미 발행물이 있습니다: Post ${linkedPosts} · Comment ${linkedComments}. seed 는 발행 전에 넣습니다.`)
}
ok('Post/Comment.personaId 전부 NULL')

const killSwitch = await prisma.personaGlobalSwitch.findFirst({ orderBy: { changedAt: 'desc' } })
if (killSwitch?.enabled === true) { await prisma.$disconnect(); fail('전체 발화 스위치가 켜져 있습니다. 끄고 진행하세요.') }
ok(`전체 발화 스위치 ${killSwitch === null ? '미생성 (= 꺼짐)' : '꺼짐'}`)

// ── 생성/수정 예정 ──
console.log('\n══ 적용 예정 ══')
let memSelf = 0, memComm = 0, memNeg = 0
for (const code of CODES) {
  const s = seeds[code]
  const fields = [
    s.identity !== undefined ? 'identity' : null,
    s.voiceCore !== undefined ? 'voiceCore' : null,
    s.voiceVariations !== undefined ? 'variations' : null,
    s.activityRhythm !== undefined ? 'rhythm' : null,
    (s.noGoTopics?.length ?? 0) > 0 ? `noGoTopics ${s.noGoTopics!.length}` : null,
    (s.noGoExpressions?.length ?? 0) > 0 ? `noGoExpr ${s.noGoExpressions!.length}` : null,
    (s.forbiddenReactionRoles?.length ?? 0) > 0 ? `forbidden ${s.forbiddenReactionRoles!.length}` : null,
    s.dailyCap !== undefined ? `dailyCap ${s.dailyCap}` : null,
    s.weeklyCap !== undefined ? `weeklyCap ${s.weeklyCap}` : null,
    s.silenceRate !== undefined ? `silenceRate ${s.silenceRate}` : null,
    s.ageBand !== undefined ? 'ageBand' : null,
    s.region !== undefined ? 'region' : null,
    s.lifeStage !== undefined ? 'lifeStage' : null,
  ].filter((v): v is string => v !== null)
  memSelf += s.selfMemories?.length ?? 0
  memComm += s.communityMemories?.length ?? 0
  memNeg += s.negativeMemories?.length ?? 0
  console.log(`   ${code}  update ${fields.length}필드  ${fields.join(' · ')}`)
}
console.log(`\n   Persona update            ${CODES.length}행 (status 는 draft 그대로)`)
console.log(`   PersonaSelfMemory      +${memSelf}`)
console.log(`   PersonaCommunityMemory +${memComm}`)
console.log(`   PersonaNegativeMemory  +${memNeg}`)
console.log(`   PersonaAuditLog        +${CODES.length}  (updated)`)
console.log(`\n   🔴 건드리지 않는 것: status · Post/Comment.personaId · kill switch · User`)

if (!APPLY) {
  console.log('\n🟡 dry-run 입니다. DB write 0.')
  console.log('   실제 적용: npx tsx scripts/persona-seed-apply.mts --apply\n')
  await prisma.$disconnect()
  process.exit(0)
}

// ── 적용 — 하나의 트랜잭션 ──
const byCode = new Map(personas.map((p) => [p.code, p.id]))
try {
  await prisma.$transaction(async (tx) => {
    for (const code of CODES) {
      const s = seeds[code]
      const id = byCode.get(code)
      if (id === undefined) throw new Error(`${code} 의 personaId 를 찾을 수 없습니다.`)
      const changed: string[] = []
      const data: Record<string, unknown> = {}
      const put = (k: string, v: unknown) => { if (v !== undefined) { data[k] = v; changed.push(k) } }
      put('ageBand', s.ageBand); put('region', s.region); put('lifeStage', s.lifeStage)
      put('identity', s.identity); put('voiceCore', s.voiceCore)
      put('voiceVariations', s.voiceVariations); put('activityRhythm', s.activityRhythm)
      put('noGoTopics', s.noGoTopics); put('noGoExpressions', s.noGoExpressions)
      put('forbiddenReactionRoles', s.forbiddenReactionRoles)
      put('dailyCap', s.dailyCap); put('weeklyCap', s.weeklyCap); put('silenceRate', s.silenceRate)

      if (Object.keys(data).length > 0) await tx.persona.update({ where: { id }, data })

      for (const summary of s.selfMemories ?? []) await tx.personaSelfMemory.create({ data: { personaId: id, summary } })
      for (const m of s.communityMemories ?? []) await tx.personaCommunityMemory.create({ data: { personaId: id, topic: m.topic, summary: m.summary } })
      for (const m of s.negativeMemories ?? []) await tx.personaNegativeMemory.create({ data: { personaId: id, avoidance: m.avoidance, reasonCode: m.reasonCode ?? null } })

      await tx.personaAuditLog.create({
        data: { personaId: id, action: 'updated', reason: 'Pool 카드 seed 이전', changedFields: changed },
      })
    }
  })
} catch (e) {
  await prisma.$disconnect()
  fail(`적용 실패 — 롤백했습니다: ${(e as Error).message}`)
}
ok('적용 완료 (트랜잭션 커밋)')

const stillDraft = await prisma.persona.count({ where: { code: { in: [...CODES] }, status: DRAFT } })
if (stillDraft !== CODES.length) { await prisma.$disconnect(); fail(`🔴 status 가 바뀌었습니다: draft ${stillDraft}/${CODES.length}`) }
ok(`status draft 유지 ${stillDraft}/${CODES.length}`)
console.log('\n다음: npx tsx scripts/persona-seed-apply.mts --check\n')
await prisma.$disconnect()
