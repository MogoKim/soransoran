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
 *   npx tsx scripts/persona-seed-apply.mts --check   # 결과 검증 (DB 반영 상태)
 *   npx tsx scripts/persona-seed-apply.mts --check-cards  # 🔴 설계 카드만 검사하고 끝난다 (DB read 최소)
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
import { readFileSync, existsSync } from 'node:fs'
import { checkNameCollision, type NameCollisionSets } from './lib/persona-gate-name-collision.mjs'
import { loadNameCollisionSets } from './lib/persona-name-collision-sets.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { duplicateKeys, isPoolCode, verifySeedCard } from '../src/lib/persona-card-verify'

const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')
/**
 * 🔴 **설계 카드 전용 검사** — persona 를 늘리기 전에 카드가 쓸 만한지 본다 (2026-09-07).
 *
 *    예전에는 MVP 5명 외 코드가 seed 에 있으면 그 자리에서 멈췄다. 그래서 **새 카드를
 *    이 검사기에 태울 방법이 없었고**, 금지 패턴도 필수 축도 사람 눈으로만 봤다.
 *
 *    이 모드는 DB 반영을 보지 않는다 — 아직 DB 에 없는 사람이기 때문이다.
 *    `--check` 의 의미(seed 가 실제로 반영됐는가)는 건드리지 않는다.
 */
const CHECK_CARDS = process.argv.includes('--check-cards')

const SEED_PATH = 'tmp/persona-seed.json'
const CODES = ['P05', 'P07', 'P10', 'P15', 'P17'] as const
const DRAFT: PersonaStatus = 'draft'

/** 🔴 seed 이전이 남기는 AuditLog 표식. 중복 적용 판정의 기준이다 */
const SEED_AUDIT_REASON = 'Pool 카드 seed 이전'

/** seed 가 채우는 Persona 스칼라 필드 — --check 와 preflight 가 함께 본다 */
const SEED_FIELDS = [
  'ageBand', 'region', 'lifeStage',
  'identity', 'voiceCore', 'voiceVariations', 'activityRhythm',
  'noGoTopics', 'noGoExpressions', 'forbiddenReactionRoles',
  'dailyCap', 'weeklyCap', 'silenceRate',
] as const
type SeedField = (typeof SEED_FIELDS)[number]

/** DB 값이 "채워져 있는가" — 배열은 길이로 본다 */
function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim() !== ''
  return true
}


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

/** 🔴 설계 카드 — DB 에 아직 없는 정본 Pool 코드다. `--apply` 대상이 **아니다** */
const DRAFT_CARDS = Object.keys(seeds).filter((k) => !CODES.includes(k as (typeof CODES)[number])).sort()

/**
 * 🔴 **`--apply` 는 설계 카드를 조용히 지나치지 않는다.**
 *    무시하면 사람은 "적용했다" 고 믿는데 그 카드는 어디에도 반영되지 않는다.
 *    persona 생성은 별도 승인이 필요한 일이므로, 여기서 **거부**하고 사람에게 넘긴다.
 */
if (APPLY && DRAFT_CARDS.length > 0) {
  await prisma.$disconnect()
  fail(`--apply 는 설계 카드를 지원하지 않습니다: ${DRAFT_CARDS.join(', ')}\n`
    + '     이 스크립트는 이미 있는 Persona 에 seed 를 채웁니다. 새 사람을 만들지 않습니다.\n'
    + '     카드만 검사하려면 --check-cards 를 쓰세요.')
}

ok(`seed 파일 — MVP ${CODES.length}명`
  + (DRAFT_CARDS.length > 0 ? ` + 설계 카드 ${DRAFT_CARDS.length}명 (${DRAFT_CARDS.join(', ')}) — 🔴 검사만, 생성하지 않는다` : ''))

// ── 🔴 금지 패턴 스캔 — 설계 카드도 **똑같이** 훑는다 ──
const forbiddenHits: string[] = []
for (const code of [...CODES, ...DRAFT_CARDS]) scanForbidden(seeds[code], code, forbiddenHits)
if (forbiddenHits.length > 0) {
  await prisma.$disconnect()
  fail(`seed 에 금지 패턴이 있습니다 (${forbiddenHits.length}건):\n     ${forbiddenHits.join('\n     ')}`)
}
ok(`금지 패턴 스캔 — 나이 · 년생 · 실지명 · 병명 · 출처 흔적 · URL · sourceRef 0건 (${CODES.length + DRAFT_CARDS.length}명)`)

// ── 🔴 설계 카드 검사 (--check-cards) ──
//    판정은 `persona-card-verify` 가 한다 — 순수 함수라 CI 가 그것을 직접 시험한다.
//    여기서 다시 구현하면 CI 가 시험한 것과 운영이 쓰는 것이 갈린다.
if (DRAFT_CARDS.length > 0 || CHECK_CARDS) {
  console.log('\n══ 설계 카드 검사 ══\n')
  let cardFail = 0
  const cbad = (m: string) => { console.log(`  🔴 ${m}`); cardFail += 1 }
  const cgood = (m: string) => console.log(`  ✅ ${m}`)

  // 🔴 정본 Pool 형식 — 임의 코드를 만들면 문서와 DB 가 갈린다
  const badForm = DRAFT_CARDS.filter((c) => !isPoolCode(c))
  if (badForm.length > 0) cbad(`정본 형식(P01~P20)이 아닌 코드: ${badForm.join(', ')}`)
  else cgood(`코드 형식 P01~P20 — ${DRAFT_CARDS.length}명`)

  // 🔴 이미 DB 에 있는 코드를 설계 카드로 다시 내면 어느 쪽이 정본인지 알 수 없다
  const inDb = await prisma.persona.findMany({
    where: { code: { in: DRAFT_CARDS } }, select: { code: true, status: true },
  })
  if (inDb.length > 0) cbad(`이미 DB 에 있는 코드다: ${inDb.map((r) => `${r.code}(${r.status})`).join(', ')}`)
  else cgood('DB 에 없는 코드다 — 새로 켤 사람이다')

  const dupes = duplicateKeys(readFileSync(SEED_PATH, 'utf-8'))
  if (dupes.length > 0) cbad(`seed 파일에 중복 코드가 있다: ${dupes.join(', ')}`)
  else cgood('seed 파일에 중복 코드 없음')

  // 🔴 정본 카드를 읽어 대조한다 — seed 가 문서와 다르면 시뮬레이션한 사람이 아니다
  const pool = parsePoolDoc(readFileSync(POOL_DOC, 'utf-8'))
  if (pool.problems.length > 0) cbad(`정본 Pool 문서 파싱 문제 ${pool.problems.length}건: ${pool.problems.join(' / ')}`)
  else cgood(`정본 Pool 카드 ${pool.cards.length}장 파싱`)
  const poolOf = new Map(pool.cards.map((c) => [c.code, c]))

  for (const code of DRAFT_CARDS) {
    const problems = verifySeedCard(code, seeds[code] as never, poolOf.get(code) ?? null)
    if (problems.length === 0) cgood(`${code}  필수 축 · 제어값 · 정합 · 정본 일치 전부 통과`)
    else cbad(`${code}  ${problems.join(' / ')}`)
  }

  if (cardFail > 0) { await prisma.$disconnect(); fail(`설계 카드 ${cardFail}건 실패`) }
  console.log(`\n  ✅ 설계 카드 ${DRAFT_CARDS.length}명 전부 통과\n`)
}

// 🔴 카드만 보고 끝낸다 — DB 반영 검증(--check)의 의미를 흐리지 않는다
if (CHECK_CARDS) {
  await prisma.$disconnect()
  console.log('🔴 --check-cards: DB write 0 · persona 생성 0. 카드 검사만 했습니다.\n')
  process.exit(0)
}

// ── --check — 🔴 seed 파일 기준으로 "실제 반영됐는가" 를 본다 ──
//    이전 판은 Persona 존재 · draft · personaId NULL 만 봤다.
//    그러면 seed 를 한 번도 적용하지 않은 상태도 통과한다 — 검증이 아니다.
if (CHECK) {
  console.log('\n══ 검증 (--check) — seed 반영 상태 ══\n')
  let failed = 0
  const bad = (m: string) => { console.log(`  🔴 ${m}`); failed++ }
  const good = (m: string) => console.log(`  ✅ ${m}`)

  const rows = await prisma.persona.findMany({
    where: { code: { in: [...CODES] } },
    select: {
      id: true, code: true, status: true,
      ageBand: true, region: true, lifeStage: true,
      identity: true, voiceCore: true, voiceVariations: true, activityRhythm: true,
      noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
      dailyCap: true, weeklyCap: true, silenceRate: true,
      _count: { select: { selfMemories: true, communityMemories: true, negativeMemories: true } },
    },
    orderBy: { code: 'asc' },
  })
  if (rows.length === CODES.length) good(`Persona ${rows.length}/${CODES.length}`)
  else bad(`Persona ${rows.length}/${CODES.length}`)

  const notDraft = rows.filter((r) => r.status !== DRAFT)
  if (notDraft.length === 0) good('전부 status=draft (seed 는 활성화가 아니다)')
  else bad(`🔴 draft 가 아닌 것 ${notDraft.length}개 — ${notDraft.map((r) => r.code).join(', ')}`)

  // 🔴 seed 파일이 요구한 필드가 DB 에 실제로 반영됐는가 — 값은 출력하지 않는다
  let missingTotal = 0
  for (const row of rows) {
    const want = seeds[row.code]
    if (want === undefined) continue
    const expected = SEED_FIELDS.filter((f) => (want as Record<string, unknown>)[f] !== undefined)
    const missing = expected.filter((f) => !isFilled((row as unknown as Record<string, unknown>)[f]))
    missingTotal += missing.length

    const wantSelf = want.selfMemories?.length ?? 0
    const wantComm = want.communityMemories?.length ?? 0
    const wantNeg = want.negativeMemories?.length ?? 0
    const memOk =
      row._count.selfMemories >= wantSelf &&
      row._count.communityMemories >= wantComm &&
      row._count.negativeMemories >= wantNeg
    if (!memOk) missingTotal++

    const line = `     ${row.code}  필드 ${expected.length - missing.length}/${expected.length}` +
      `  memory ${row._count.selfMemories}/${row._count.communityMemories}/${row._count.negativeMemories}` +
      ` (기대 ${wantSelf}/${wantComm}/${wantNeg})`
    // 🔴 빠진 것은 필드명만 적는다. 값은 담지 않는다
    console.log(missing.length === 0 && memOk ? line : `${line}  🔴 미반영: ${missing.join(' · ') || 'memory'}`)
  }
  if (missingTotal === 0) good('seed 파일의 모든 필드가 DB 에 반영됨')
  else bad(`🔴 미반영 ${missingTotal}건 — seed 가 적용되지 않았거나 일부만 적용됐다`)

  // 🔴 seed 이전 AuditLog 가 남아 있는가
  const seedLogs = await prisma.personaAuditLog.count({
    where: { action: 'updated', reason: SEED_AUDIT_REASON, persona: { code: { in: [...CODES] } } },
  })
  if (seedLogs === CODES.length) good(`seed AuditLog ${seedLogs}/${CODES.length}`)
  else bad(`🔴 seed AuditLog ${seedLogs}/${CODES.length} — 적용 이력이 맞지 않는다`)

  const linkedPosts = await prisma.post.count({ where: { personaId: { not: null } } })
  const linkedComments = await prisma.comment.count({ where: { personaId: { not: null } } })
  if (linkedPosts === 0 && linkedComments === 0) good('Post/Comment.personaId 전부 NULL')
  else bad(`🔴 Post ${linkedPosts} · Comment ${linkedComments} 에 personaId 가 채워졌다`)

  console.log(failed === 0 ? '\n✅ 검증 통과\n' : `\n🔴 ${failed}건 실패\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

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
  const v = checkNameCollision(name, scoped)
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
// 🔴 enabled = "중지" 다. 켜져 있으면 전체 발화가 멈춘 상태이므로 seed 도 넣지 않는다
if (killSwitch?.enabled === true) { await prisma.$disconnect(); fail('전체 중지 스위치가 켜져 있습니다. 해제하고 진행하세요.') }
ok(`전체 중지 스위치 ${killSwitch === null ? '꺼짐 (미생성)' : '꺼짐'}`)

// ── 🔴 중복 적용 preflight ──
//    seed 를 두 번 적용하면 memory 와 AuditLog 가 중복 생성된다.
//    update 는 멱등하지만 create 는 아니다 — 그래서 여기서 막는다.
//    🔴 --force 를 만들지 않는다. 다시 넣어야 하면 사람이 지우고 다시 돈다.
{
  const already: string[] = []

  // ① seed 대상 필드가 이미 채워져 있는가
  const filled = await prisma.persona.findMany({
    where: { code: { in: [...CODES] } },
    select: {
      code: true,
      ageBand: true, region: true, lifeStage: true,
      identity: true, voiceCore: true, voiceVariations: true, activityRhythm: true,
      noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
      dailyCap: true, weeklyCap: true, silenceRate: true,
    },
  })
  for (const row of filled) {
    const hit = SEED_FIELDS.filter((f) => isFilled((row as unknown as Record<string, unknown>)[f]))
    // 🔴 필드명만 적는다. 값은 담지 않는다
    if (hit.length > 0) already.push(`${row.code} 필드 이미 채워짐: ${hit.join(' · ')}`)
  }

  // ② memory row 가 이미 있는가
  const [selfN, commN, negN] = await Promise.all([
    prisma.personaSelfMemory.count({ where: { persona: { code: { in: [...CODES] } } } }),
    prisma.personaCommunityMemory.count({ where: { persona: { code: { in: [...CODES] } } } }),
    prisma.personaNegativeMemory.count({ where: { persona: { code: { in: [...CODES] } } } }),
  ])
  if (selfN + commN + negN > 0) already.push(`memory 이미 존재: self ${selfN} · community ${commN} · negative ${negN}`)

  // ③ seed 이전 AuditLog 가 이미 있는가
  const seedLogs = await prisma.personaAuditLog.count({
    where: { action: 'updated', reason: SEED_AUDIT_REASON, persona: { code: { in: [...CODES] } } },
  })
  if (seedLogs > 0) already.push(`seed AuditLog 이미 존재: ${seedLogs}건`)

  if (already.length > 0) {
    await prisma.$disconnect()
    fail(
      `이미 seed 가 적용된 흔적이 있습니다 (${already.length}건):\n     ` +
      already.join('\n     ') +
      `\n\n   🔴 부분 적용을 허용하지 않습니다 — 하나라도 걸리면 전체를 중단합니다.` +
      `\n   다시 넣어야 하면 해당 행을 정리한 뒤 실행하세요. --force 는 만들지 않았습니다.`,
    )
  }
  ok('중복 적용 preflight — 필드 · memory · AuditLog 흔적 0건')
}

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
        data: { personaId: id, action: 'updated', reason: SEED_AUDIT_REASON, changedFields: changed },
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
