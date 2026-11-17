#!/usr/bin/env tsx
/**
 * 운영자 이름 명단 — 전용 검사
 *
 *   npx tsx scripts/operator-writer-roster-check.mts            # 순수 판정만 (DB 없음)
 *   DATABASE_URL=postgresql://soran@127.0.0.1:54329/soran_test \
 *   SORAN_ISOLATED_DB=yes-throwaway \
 *     npx tsx scripts/operator-writer-roster-check.mts --db     # + 격리 DB 실제 트랜잭션
 *
 * 🔴 `--db` 는 격리 주소(127.0.0.1/localhost 의 soran_test)이고 SORAN_ISOLATED_DB=yes-throwaway 여야 한다.
 *    격리 Postgres 세우는 법: scripts/operator-compose-db-check.mts 머리 주석 참고.
 * 🔴 판정 모듈은 `OPERATOR_ROSTER_LIB` 으로 바꿔 끼울 수 있다 — 변이 하네스가 사본을 넣는다.
 *    바꿔 끼울 때 roster JSON 은 항상 원본 경로에서 읽는다(import.meta.url 혼동 방지).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

// 🔴 타입은 static import type — 런타임엔 지워진다. 판정 함수는 아래 동적 import 로 가져온다.
import type {
  RosterData, RosterFacts, RosterEntry,
  NameCheckResult, WriterFact, IgnoredFact, ProductionFacts,
  Change,
} from './lib/operator-writer-roster.mts'
import type { NameCollisionSets } from './lib/persona-gate-name-collision.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(HERE, '__fixtures__')
const ROSTER_JSON_PATH = join(HERE, 'lib/operator-writer-roster.json')

// ── 명단 로드 (항상 원본 경로 — 변이 사본과 무관) ───────────────────
const rosterRaw: unknown = JSON.parse(readFileSync(ROSTER_JSON_PATH, 'utf-8'))

// ── 판정 모듈 (변이 하네스가 OPERATOR_ROSTER_LIB 로 사본을 주입) ────
const libModulePath = process.env.OPERATOR_ROSTER_LIB
  ?? new URL('./lib/operator-writer-roster.mts', import.meta.url).pathname
type Lib = typeof import('./lib/operator-writer-roster.mts')
const lib = (await import(pathToFileURL(libModulePath).href)) as Lib

const {
  validateRoster, judgeRoster, judgeNewName, planDigestOf, rosterDigest,
  decideMode, decideProductionTime, judgeProduction, isIsolatedUrl, isOpCode,
  BRAND_FORBIDDEN,
} = lib

// ── Persona fixture 로드 (persona-expansion-*.json의 candidates.displayName) ─
function loadPersonaFixtureNames(): string[] {
  let files: string[] = []
  try {
    files = readdirSync(FIXTURE_DIR).filter((f) => f.startsWith('persona-expansion-') && f.endsWith('.json'))
  } catch {
    return []
  }
  const names: string[] = []
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as {
        candidates?: Array<{ displayName?: string }>
      }
      for (const c of data.candidates ?? []) {
        if (typeof c.displayName === 'string') names.push(c.displayName)
      }
    } catch { /* skip */ }
  }
  return names
}

const personaFixtureNames = loadPersonaFixtureNames()

// ── 헬퍼 ──────────────────────────────────────────────────────────────
let pass = 0
let fail = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}
const truthy = (label: string, v: boolean): void => expect(label, v, true)

// ── 순수 시험용 헬퍼 ──────────────────────────────────────────────────

function makeEntry(
  code: string,
  nickname: string,
  note = '50대 초반 · 서울 · 평범한 일상을 적는 직장인',
  status: 'active' | 'retired' = 'active',
): RosterEntry {
  return { code, nickname, note, status }
}

function makeRoster(
  entries: RosterEntry[],
): RosterData {
  return { kind: 'operator-writer-roster', version: 1, writers: entries }
}

function makeWriter(
  code: string,
  overrides: Partial<WriterFact> = {},
): WriterFact {
  return {
    id: `id-${code}`,
    code,
    status: 'active',
    userId: `u-${code}`,
    nickname: `닉${code}`,
    note: '50대 초반 · 서울 · 테스트',
    accountCount: 0,
    hasPersona: false,
    ...overrides,
  }
}

function makeFacts(
  writers: WriterFact[] = [],
  options: {
    ignoredRows?: IgnoredFact[]
    personaNames?: string[]
    memberNames?: string[]
    guestNames?: string[]
    userIds?: string[]
  } = {},
): RosterFacts {
  const collisionSets: NameCollisionSets = {
    personaNames: options.personaNames,
    memberNames: options.memberNames,
  }
  const userIds = new Set(options.userIds ?? writers.map((w) => w.userId))
  return {
    writers,
    ignoredRows: options.ignoredRows ?? [],
    ignoredPv: (options.ignoredRows ?? []).filter((r) => r.code.startsWith('PV')).length,
    ignoredOther: (options.ignoredRows ?? []).filter((r) => !r.code.startsWith('PV')).length,
    collisionSets,
    guestNames: new Set((options.guestNames ?? []).map((n) => n.toLowerCase().normalize('NFC').replace(/[^0-9a-z가-힣]/g, ''))),
    userIds,
    totals: { users: userIds.size, accounts: 0, personas: 0 },
  }
}

// ─────────────────────────────────────────────────────────
// ① 명단 — 90행 · note · TO_FILL_FROM_DB · GRANDFATHERED
// ─────────────────────────────────────────────────────────
console.log('\n① 명단 · validateRoster')

// 명단 형식 가드
const rosterTyped = rosterRaw as RosterData
expect('kind', rosterTyped.kind, 'operator-writer-roster')
expect('version', rosterTyped.version, 1)
expect('writers 90행', rosterTyped.writers.length, 90)

// 연속 code OP01~OP90
const expectedCodes = Array.from({ length: 90 }, (_, i) => `OP${String(i + 1).padStart(2, '0')}`)
expect('code 연속 OP01~OP90', rosterTyped.writers.map((e) => e.code), expectedCodes)

// 🔴 자리표시 `TO_FILL_FROM_DB` 가 하나라도 남아 있으면 FAIL 이다 — 소개 없이 통과시키는 예외를 두지 않는다.
//    (2026-11-17) OP01~10 은 운영 DB 에도 note 가 없었다(null) — 창업자 승인 초안으로 채웠다.
const noToFill = rosterTyped.writers.filter((e) => e.note.trim() === 'TO_FILL_FROM_DB')
expect('🔴 TO_FILL_FROM_DB 0건 — 자리표시 note 가 남아 있지 않다', noToFill.map((e) => e.code), [])

// 🔴 실제 명단은 결함 0 이어야 한다 — TO_FILL_FROM_DB 도 결함으로 잡힌다
const rosterErrors = validateRoster(rosterTyped)
expect('🔴 validateRoster(명단) 결함 0', rosterErrors, [])

// ─────────────────────────────────────────────────────────
// ② Persona fixture — 집합이 비어 있으면 FAIL (빈 집합 거짓 PASS 금지)
// ─────────────────────────────────────────────────────────
console.log('\n② Persona fixture 집합')
truthy(`persona fixture displayName ≥ 1 (실제 ${personaFixtureNames.length}건)`, personaFixtureNames.length > 0)
truthy('fixture 에 nono 포함(canary.json:513 canary)', personaFixtureNames.some((n) => n === 'nono'))

// ─────────────────────────────────────────────────────────
// ③ P9 GRANDFATHERED — 소급 안 함 · 정확히 3개
// ─────────────────────────────────────────────────────────
console.log('\n③ P9 GRANDFATHERED')
const fixtureCollisionSets: NameCollisionSets = { personaNames: personaFixtureNames }

// DB 에 없는 행으로 취급 → judgeNewName 에서 걸려야 하는 기존 3명
const GRANDFATHERED_CODES = ['OP10', 'OP29', 'OP37'] as const
const failedForNew: string[] = []
for (const e of rosterTyped.writers) {
  const r: NameCheckResult = judgeNewName(e.nickname, fixtureCollisionSets)
  if (!r.ok) failedForNew.push(e.code)
}
expect('GRANDFATHERED 가 정확히 [OP10,OP29,OP37]', failedForNew, [...GRANDFATHERED_CODES])

// OP51~90 (새 40명) 전원 판정 통과
const newEntries = rosterTyped.writers.filter((e) => {
  const n = parseInt(e.code.slice(2), 10)
  return n >= 51 && n <= 90
})
expect('OP51~90 개수 40', newEntries.length, 40)
const newFailed = newEntries.filter((e) => !judgeNewName(e.nickname, fixtureCollisionSets).ok)
expect(`OP51~90 이름 판정 ${newEntries.length}/${newEntries.length} pass`, newFailed.length, 0)
if (newFailed.length > 0) {
  for (const e of newFailed) {
    const r = judgeNewName(e.nickname, fixtureCollisionSets)
    console.log(`     🔴 ${e.code} ${e.nickname}: ${r.problems.join(' · ')}`)
  }
}

// isOpCode 직접 (M2 변이 겨냥 — `^OP\d+$` → `.*` 로 바꾸면 아래가 FAIL)
truthy('isOpCode: OP01 → true', isOpCode('OP01'))
truthy('isOpCode: OP90 → true', isOpCode('OP90'))
truthy('isOpCode: PV07 → false', !isOpCode('PV07'))
truthy('isOpCode: OPX → false', !isOpCode('OPX'))
truthy('isOpCode: op01 → false (소문자)', !isOpCode('op01'))
truthy('isOpCode: 빈 문자열 → false', !isOpCode(''))

// ─────────────────────────────────────────────────────────
// ④ 반례 — 고정된 stop 케이스들
// ─────────────────────────────────────────────────────────
console.log('\n④ 반례 고정')

// nono31 → Gate ⑥-B review (Persona nono 와 근접)
{
  const r = judgeNewName('nono31', fixtureCollisionSets)
  truthy('nono31 → Gate ⑥-B 로 막힘(review)', !r.ok && r.problems.some((p) => p.includes('Gate ⑥-B')))
}

// bluej82 → verifyNamePolicy 출처 호칭 "82"
{
  const r = judgeNewName('bluej82', fixtureCollisionSets)
  truthy('bluej82 → verifyNamePolicy 로 막힘', !r.ok)
}

// 별거없음 → verifyNamePolicy 가족 상태 "별거"
{
  const r = judgeNewName('별거없음', fixtureCollisionSets)
  truthy('별거없음 → verifyNamePolicy 로 막힘', !r.ok)
}

// note 나이대 위반 → validateRoster 에서 잡힘
{
  const r30 = makeRoster([makeEntry('OP01', '이름하나', '30대 후반 · 서울 · 테스트')])
  truthy('note 30대 후반 → validateRoster 막힘', validateRoster(r30).some((p) => p.includes('OP01')))
}
{
  const r40 = makeRoster([makeEntry('OP01', '이름하나', '40대 초반 · 서울 · 테스트')])
  truthy('note 40대 초반 → validateRoster 막힘', validateRoster(r40).some((p) => p.includes('OP01')))
}

// TO_FILL_FROM_DB → 막힘
{
  const rfill = makeRoster([makeEntry('OP01', '이름하나', 'TO_FILL_FROM_DB')])
  truthy('TO_FILL_FROM_DB → validateRoster 막힘', validateRoster(rfill).some((p) => p.includes('TO_FILL_FROM_DB')))
}

// 브랜드 금지 표현
{
  const rBrand = makeRoster([makeEntry('OP01', '시니어수다')])
  truthy('닉네임 금지 표현(시니어) → 막힘', validateRoster(rBrand).some((p) => p.includes('시니어')))
}

// ─────────────────────────────────────────────────────────
// ⑤ judgeRoster — 판정 행렬
// ─────────────────────────────────────────────────────────
console.log('\n⑤ judgeRoster 판정 행렬')

// 명단이 비어 있으면 stop
{
  const empty = makeRoster([])
  expect('빈 명단 → stop', judgeRoster(empty, makeFacts()).kind, 'stop')
}

// 명단 결함이면 DB 가 깨끗해도 stop
{
  const badRoster = makeRoster([makeEntry('OP01', '이름하나', 'TO_FILL_FROM_DB')])
  expect('명단 결함 → DB 가 깨끗해도 stop', judgeRoster(badRoster, makeFacts()).kind, 'stop')
}

// DB 에만 있는 OP → stop (P5)
{
  const r = makeRoster([makeEntry('OP01', '이름하나')])
  const f = makeFacts([
    makeWriter('OP01', { nickname: '이름하나' }),
    makeWriter('OP02', { nickname: '다른이름' }),  // 명단에 없음
  ])
  expect('DB 에만 있는 OP → stop (P5)', judgeRoster(r, f).kind, 'stop')
}

// DB 에 없는 retired → stop (P2)
{
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 초반 · 서울 · 테스트', 'retired')])
  expect('명단 retired + DB 없음 → stop (P2)', judgeRoster(r, makeFacts()).kind, 'stop')
}

// DB 에 있는 행 닉네임 다름 → stop (P3)
{
  const r = makeRoster([makeEntry('OP01', '새이름하나')])
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나' })])
  const v = judgeRoster(r, f)
  expect('닉네임 다름 → stop (P3)', v.kind, 'stop')
}

// DB retired → 명단 active 되살리기 금지 (P4)
{
  const r = makeRoster([makeEntry('OP01', '이름하나')])
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', status: 'retired' })])
  expect('DB retired → active 되살리기 → stop (P4)', judgeRoster(r, f).kind, 'stop')
}

// Account > 0 → stop (P7)
{
  const r = makeRoster([makeEntry('OP01', '이름하나')])
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', accountCount: 1 })])
  expect('Account 1 → stop (P7)', judgeRoster(r, f).kind, 'stop')
}

// Persona 연결 → stop (P7)
{
  const r = makeRoster([makeEntry('OP01', '이름하나')])
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', hasPersona: true })])
  expect('Persona 연결 → stop (P7)', judgeRoster(r, f).kind, 'stop')
}

// 완전히 같음 → same
{
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 초반 · 서울 · 테스트')])
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', note: '50대 초반 · 서울 · 테스트' })])
  expect('DB 와 같음 → same', judgeRoster(r, f).kind, 'same')
}

// 명단에 새 active → applicable (create)
{
  const emptyCollision: NameCollisionSets = { personaNames: [], memberNames: [] }
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 초반 · 서울 · 테스트')])
  const f = makeFacts([], { personaNames: [], memberNames: [] })
  const v = judgeRoster(r, f, emptyCollision)
  expect('DB 비어 있음 + 새 이름 판정 통과 → applicable', v.kind, 'applicable')
  if (v.kind === 'applicable') {
    expect('changes[0].op === create', v.changes[0]?.op, 'create')
  }
}

// note 변경 → applicable (note)
{
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 중반 · 서울 · 바뀐 note')])
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', note: '50대 초반 · 서울 · 테스트' })])
  const v = judgeRoster(r, f)
  expect('note 다름 → applicable (note)', v.kind, 'applicable')
  if (v.kind === 'applicable') expect('op note', v.changes[0]?.op, 'note')
}

// retire → applicable (retire)
{
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 초반 · 서울 · 테스트', 'retired')])
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', note: '50대 초반 · 서울 · 테스트', status: 'active' })])
  const v = judgeRoster(r, f)
  expect('active → retired → applicable (retire)', v.kind, 'applicable')
  if (v.kind === 'applicable') expect('op retire', v.changes[0]?.op, 'retire')
}

// 이미 retired → retired → same
{
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 초반 · 서울 · 테스트', 'retired')])
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', note: '50대 초반 · 서울 · 테스트', status: 'retired' })])
  expect('DB retired + 명단 retired → same', judgeRoster(r, f).kind, 'same')
}

// PV 행 섞인 사실 — 무시 · 판정 same
{
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 초반 · 서울 · 테스트')])
  const pvRow: IgnoredFact = { id: 'id-pv07', code: 'PV07', status: 'active', userId: 'u-pv07' }
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', note: '50대 초반 · 서울 · 테스트' })], { ignoredRows: [pvRow] })
  expect('PV 행 섞인 사실 → same (무시)', judgeRoster(r, f).kind, 'same')
}

// OPX / op51 같은 기타 code 는 무시 (IgnoredFact)
{
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 초반 · 서울 · 테스트')])
  const otherRow: IgnoredFact = { id: 'id-opx', code: 'OPX', status: 'active', userId: 'u-opx' }
  const f = makeFacts([makeWriter('OP01', { nickname: '이름하나', note: '50대 초반 · 서울 · 테스트' })], { ignoredRows: [otherRow] })
  expect('OPX code(기타) → 무시 · same', judgeRoster(r, f).kind, 'same')
}

// 새 이름 판정 실패 → stop
{
  const emptyStopCollision: NameCollisionSets = { personaNames: ['이름하나'], memberNames: [] }
  const r = makeRoster([makeEntry('OP01', '이름하나')])
  const f = makeFacts([], { personaNames: ['이름하나'], memberNames: [] })
  expect('새 이름이 Persona 와 완전 일치 → stop', judgeRoster(r, f, emptyStopCollision).kind, 'stop')
}

// ─────────────────────────────────────────────────────────
// ⑥ 계획 지문 — 결정적 · 변경 하나 달라지면 바뀜
// ─────────────────────────────────────────────────────────
console.log('\n⑥ 계획 지문 planDigestOf')
const dummyRDigest = 'a'.repeat(64)
const change1: Change = { op: 'create', code: 'OP51', nickname: '이름', note: 'note' }
const change2: Change = { op: 'create', code: 'OP52', nickname: '이름2', note: 'note' }
const D1 = planDigestOf(dummyRDigest, [change1])
const D2 = planDigestOf(dummyRDigest, [change2])
truthy('지문은 SHA-256 64자리', /^[0-9a-f]{64}$/.test(D1))
expect('결정적(같은 입력 → 같은 값)', planDigestOf(dummyRDigest, [change1]), D1)
truthy('변경 목록이 달라지면 지문이 바뀜', D1 !== D2)
// 순서 무관(정렬)
truthy('변경 순서 달라도 같은 지문', planDigestOf(dummyRDigest, [change2, change1]) === planDigestOf(dummyRDigest, [change1, change2]))
// 명단 note 한 글자에 바뀜
{
  const r1 = makeRoster([makeEntry('OP01', '이름', '50대 초반 · 서울 · 테스트')])
  const r2 = makeRoster([makeEntry('OP01', '이름', '50대 초반 · 서울 · 테스트!')])
  truthy('명단 note 한 글자에 rosterDigest 바뀜', rosterDigest(r1) !== rosterDigest(r2))
}

// applicable 판정 → planDigest 는 --expect 로 써야 하는 값
{
  const emptyC: NameCollisionSets = { personaNames: [], memberNames: [] }
  const r = makeRoster([makeEntry('OP01', '이름하나', '50대 초반 · 서울 · 테스트')])
  const f = makeFacts([], { personaNames: [], memberNames: [] })
  const v = judgeRoster(r, f, emptyC)
  if (v.kind === 'applicable') {
    truthy('applicable 판정의 planDigest 는 64자리 hex', /^[0-9a-f]{64}$/.test(v.planDigest))
    expect('다른 명단은 다른 planDigest', v.planDigest !== planDigestOf('b'.repeat(64), v.changes), true)
  } else {
    truthy('applicable 판정 가정 — 판정이 applicable 이어야 했다', false)
  }
}

// ─────────────────────────────────────────────────────────
// ⑦ 실행 모드 decideMode
// ─────────────────────────────────────────────────────────
console.log('\n⑦ 실행 모드 decideMode')
const PROD_URL = 'postgresql://u:p@aws-0.pooler.supabase.com:6543/postgres'
const ISO_URL = 'postgresql://soran@127.0.0.1:54329/soran_test'
const SHA40 = 'a'.repeat(40)
const PLAN_HEX = 'b'.repeat(64)

expect('인자 없음 → dry-run', decideMode([], PROD_URL).kind, 'dry-run')
expect('--json → dry-run', decideMode(['--json'], PROD_URL).kind, 'dry-run')
expect('--show-db-notes → dry-run-show-db-notes', decideMode(['--show-db-notes'], PROD_URL).kind, 'dry-run-show-db-notes')
expect('--show-db-notes + --apply → refuse', decideMode(['--apply', '--show-db-notes', `--expect=${PLAN_HEX}`, '--reason=x'], ISO_URL).kind, 'refuse')
expect('--production 만 → refuse', decideMode(['--production'], PROD_URL).kind, 'refuse')
expect('--apply 만 → refuse', decideMode(['--apply'], PROD_URL).kind, 'refuse')

// 옛 --digest 는 모르는 인자로 거절
expect('옛 --digest → refuse', decideMode(['--apply', `--digest=${PLAN_HEX}`, '--reason=x'], ISO_URL).kind, 'refuse')
// 옛 --expect=50:90 형식도 거절
expect('옛 --expect=50:90 → refuse', decideMode(['--apply', '--expect=50:90', '--reason=x'], ISO_URL).kind, 'refuse')

// 격리 apply
expect('격리: 완비 → apply-isolated', decideMode(['--apply', `--expect=${PLAN_HEX}`, '--reason=창업자승인'], ISO_URL).kind, 'apply-isolated')
expect('격리: reason 빈칸 → refuse', decideMode(['--apply', `--expect=${PLAN_HEX}`, '--reason=  '], ISO_URL).kind, 'refuse')
expect('격리: expect 없음 → refuse', decideMode(['--apply', '--reason=x'], ISO_URL).kind, 'refuse')
expect('격리: expect 짧음(63자) → refuse', decideMode(['--apply', `--expect=${'c'.repeat(63)}`, '--reason=x'], ISO_URL).kind, 'refuse')
expect('격리: 운영 주소 + --production 없음 → refuse', decideMode(['--apply', `--expect=${PLAN_HEX}`, '--reason=x'], PROD_URL).kind, 'refuse')
expect('격리: --target 은 --production 과 함께만 → refuse', decideMode(['--apply', `--target=${SHA40}`, `--expect=${PLAN_HEX}`, '--reason=x'], ISO_URL).kind, 'refuse')

// 운영 apply
const OK_PROD = ['--apply', '--production', `--target=${SHA40}`, `--expect=${PLAN_HEX}`, '--reason=창업자승인']
expect('운영: 완비 → apply-production', decideMode(OK_PROD, PROD_URL).kind, 'apply-production')
expect('운영: target 없음 → refuse', decideMode(['--apply', '--production', `--expect=${PLAN_HEX}`, '--reason=x'], PROD_URL).kind, 'refuse')
expect('운영: target 39자리 → refuse', decideMode(['--apply', '--production', `--target=${'a'.repeat(39)}`, `--expect=${PLAN_HEX}`, '--reason=x'], PROD_URL).kind, 'refuse')
expect('운영: 셸이 격리여도 --production 이면 통과(가드가 나중에 판정)', decideMode(OK_PROD, ISO_URL).kind, 'apply-production')
expect('격리 URL 판정', [isIsolatedUrl(ISO_URL), isIsolatedUrl(PROD_URL), isIsolatedUrl('postgresql://a@127.0.0.1:5432/postgres'), isIsolatedUrl('postgres://a@127.0.0.1:5432/soran_test'), isIsolatedUrl('postgres://a@db.example.com:5432/soran_test')], [true, false, false, true, false])
expect('오타 인자 → refuse', decideMode(['--aply'], PROD_URL).kind, 'refuse')

// ─────────────────────────────────────────────────────────
// ⑧ 시간 가드 decideProductionTime (P11)
// ─────────────────────────────────────────────────────────
console.log('\n⑧ 시간 가드 (P11) — 06:00~09:00 KST')
// KST = UTC+9. UTC로 테스트:
// KST 06:00 = UTC 21:00(전날). KST 05:59 = UTC 20:59(전날).

// 거절 케이스: KST 06:00(UTC 21:00), 08:59:59(UTC 23:59:59)
expect('KST 06:00:00 거절', decideProductionTime(new Date('2026-11-16T21:00:00Z')).ok, false)
expect('KST 08:59:59 거절', decideProductionTime(new Date('2026-11-16T23:59:59Z')).ok, false)
// 허용 케이스: KST 05:59:59(UTC 20:59:59), KST 09:00:00(UTC 00:00:00)
expect('KST 05:59:59 허용', decideProductionTime(new Date('2026-11-16T20:59:59Z')).ok, true)
expect('KST 09:00:00 허용', decideProductionTime(new Date('2026-11-17T00:00:00Z')).ok, true)
// 한낮 허용
expect('KST 12:00 허용', decideProductionTime(new Date('2026-11-17T03:00:00Z')).ok, true)

// ─────────────────────────────────────────────────────────
// ⑨ 운영 가드 judgeProduction
// ─────────────────────────────────────────────────────────
console.log('\n⑨ 운영 가드 judgeProduction')
const goodProdFacts: ProductionFacts = {
  isolatedFlag: '',
  env: { ok: true, reason: null, databaseUrl: PROD_URL, directUrl: 'postgresql://u:p@db.x.supabase.co:5432/postgres' },
  fetched: true, originMain: SHA40, head: SHA40, trackedChanges: '',
  toolFilesCommitted: [
    { path: 'scripts/operator-writer-roster.mts', tracked: true },
    { path: 'scripts/lib/operator-writer-roster.mts', tracked: true },
    { path: 'scripts/lib/operator-writer-roster.json', tracked: true },
  ],
}
const pj = (over: Partial<ProductionFacts>, target = SHA40): string[] =>
  judgeProduction({ ...goodProdFacts, ...over }, target)
expect('가드: 모두 맞음 → 통과', pj({}), [])
truthy('가드: SORAN_ISOLATED_DB 설정 → 거부', pj({ isolatedFlag: 'yes-throwaway' }).length > 0)
truthy('가드: canonical env 읽기 실패 → 거부', pj({ env: { ok: false, reason: '없음', databaseUrl: '', directUrl: '' } }).length > 0)
truthy('가드: DATABASE_URL 없음 → 거부', pj({ env: { ...goodProdFacts.env, databaseUrl: '' } }).length > 0)
truthy('가드: canonical 이 격리 DB 모양 → 거부', pj({ env: { ...goodProdFacts.env, databaseUrl: ISO_URL } }).length > 0)
truthy('가드: canonical 이 로컬 → 거부', pj({ env: { ...goodProdFacts.env, directUrl: 'postgresql://a@localhost:5432/postgres' } }).length > 0)
truthy('가드: fetch 실패 → 거부', pj({ fetched: false, originMain: null }).length > 0)
truthy('가드: HEAD ≠ origin/main → 거부', pj({ head: 'b'.repeat(40) }, 'b'.repeat(40)).length > 0)
truthy('가드: HEAD = origin/main ≠ target → 거부', pj({}, 'c'.repeat(40)).length > 0)
truthy('가드: tracked 변경 있음 → 거부', pj({ trackedChanges: ' M src/lib/nickname.ts' }).length > 0)
truthy('가드: 작업 트리 상태 모름 → 거부', pj({ trackedChanges: null }).length > 0)
truthy('가드: 도구 파일 미커밋 → 거부', pj({ toolFilesCommitted: [{ path: 'scripts/operator-writer-roster.mts', tracked: false }, { path: 'scripts/lib/operator-writer-roster.mts', tracked: true }, { path: 'scripts/lib/operator-writer-roster.json', tracked: true }] }).length > 0)
truthy('가드: 도구 파일 목록 비어 있음 → 거부', pj({ toolFilesCommitted: [] }).length > 0)
truthy('가드: 거부 사유에 DB 주소 원문 없음', pj({ env: { ...goodProdFacts.env, databaseUrl: ISO_URL } }).every((p) => !p.includes('127.0.0.1')))

// ─────────────────────────────────────────────────────────
// ⑩ 격리 DB — 실제 트랜잭션
// ─────────────────────────────────────────────────────────
if (process.argv.includes('--db')) {
  console.log('\n⑩ 격리 DB 실제 트랜잭션')
  const url = process.env.DATABASE_URL ?? ''
  if (!isIsolatedUrl(url)) { console.error('🔴 격리 DB 가 아니다. 멈춘다.'); process.exit(2) }
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() === '') {
    console.error('🔴 SORAN_ISOLATED_DB=yes-throwaway 가 없다. 멈춘다.')
    process.exit(2)
  }

  // lib 함수를 격리 DB 시험용으로 직접 가져온다
  const dbLib = await import('./lib/operator-writer-roster.mjs')

  // 🔴 DB 시험용 clean 명단 — OP01~10 의 TO_FILL_FROM_DB 를 유효한 note 로 채운다.
  //    운영 명단을 고치지 않고 시험 안에서만 쓴다.
  //    🔴 code 마다 셋째 토막을 다르게 둔다 — 같은 문장 10개면 (나이·지역·셋째) 3중 일치로 validateRoster 가 멈춘다.
  //    명단을 이미 채운 뒤에는 이 치환이 0건이라 실제 명단 그대로 돈다.
  const dbTestRoster: RosterData = {
    ...rosterTyped,
    writers: rosterTyped.writers.map((e) =>
      e.note.trim() === 'TO_FILL_FROM_DB'
        ? { ...e, note: `50대 초반 · 서울 · 시험용 소개 ${e.code}` }
        : e,
    ),
  }
  truthy('격리 DB 시험 명단은 결함 0 (판정 논리를 보려면 명단이 깨끗해야 한다)', validateRoster(dbTestRoster).length === 0)

  const prisma = new PrismaClient()

  async function wipe(): Promise<void> {
    await prisma.operatorWriteLog.deleteMany({})
    await prisma.report.deleteMany({})
    await prisma.comment.deleteMany({ where: { parentId: { not: null } } })
    await prisma.comment.deleteMany({})
    await prisma.personaApprovalQueue.deleteMany({})
    await prisma.personaActivityLog.deleteMany({})
    await prisma.homeExposureOverride.deleteMany({})
    await prisma.autoReadyAudit.deleteMany({})
    await prisma.originalPostApprovalQueue.deleteMany({})
    await prisma.microSeedRawContent.deleteMany({ where: { sourceSite: 'test:op' } })
    await prisma.post.deleteMany({})
    await prisma.operatorWriter.deleteMany({})
    await prisma.persona.deleteMany({})
    await prisma.account.deleteMany({})
    await prisma.user.deleteMany({})
  }

  try {
    await wipe()

    // 🔴 OP01~50 을 직접 만들어 초기 상태로 쓴다 (dbTestRoster — TO_FILL_FROM_DB 없음)
    for (let i = 1; i <= 50; i++) {
      const code = `OP${String(i).padStart(2, '0')}`
      const e = dbTestRoster.writers.find((w) => w.code === code)
      if (e === undefined) continue
      await prisma.user.create({ data: { nickname: e.nickname, operatorWriter: { create: { code, note: e.note, status: 'active' } } } })
    }

    // 실회원 1명 추가 (Account 붙음)
    const memberUser = await prisma.user.create({ data: { nickname: '진짜회원', name: '카카오이름' } })
    await prisma.account.create({ data: { userId: memberUser.id, type: 'oauth', provider: 'kakao', providerAccountId: 'k-1' } })

    // PV 행 1개 추가 (OperatorWriter PV07) — 판정에 영향 없어야 한다
    const pvUser = await prisma.user.create({ data: { nickname: 'PV07닉네임' } })
    await prisma.operatorWriter.create({ data: { code: 'PV07', userId: pvUser.id, status: 'active' } })

    const counts = async () => [
      await prisma.user.count(),
      await prisma.operatorWriter.count(),
      await prisma.account.count(),
      await prisma.persona.count(),
    ]
    const start = await counts()

    // (a) OP01~50 있음 → applicable (create 40 for OP51~90)
    const facts0 = await dbLib.readRosterFacts(prisma)
    const v0 = dbLib.judgeRoster(dbTestRoster, facts0)
    expect('(a) 미리보기: OP51~90 없음 → applicable', v0.kind, 'applicable')
    if (v0.kind === 'applicable') {
      expect('(a) create 40', v0.changes.filter((c) => c.op === 'create').length, 40)
    }

    // (b) 계획 지문 틀림 → 0 write
    const wrongDigest = '0'.repeat(64)
    const r_b = await dbLib.applyRoster(prisma, { approvedPlanDigest: wrongDigest, roster: dbTestRoster, reason: '시험' })
    expect('(b) 계획 지문 틀림 → 실패', r_b.ok, false)
    expect('(b) write 0', await counts(), start)

    // (c) OP90 이름을 회원 name 으로 선점 → 0 write (앞 39명도 없음)
    const op90 = dbTestRoster.writers.find((e) => e.code === 'OP90')!
    await prisma.user.update({ where: { id: memberUser.id }, data: { name: op90.nickname } })
    const planDigestForApply = v0.kind === 'applicable' ? v0.planDigest : '0'.repeat(64)
    const r_c = await dbLib.applyRoster(prisma, { approvedPlanDigest: planDigestForApply, roster: dbTestRoster, reason: '시험' })
    expect('(c) 이름 충돌 → 실패', r_c.ok, false)
    expect('(c) write 0 (앞 39명도 없음)', await counts(), start)
    await prisma.user.update({ where: { id: memberUser.id }, data: { name: '카카오이름' } })

    // (d) PV 행 있는 상태 → 판정 영향 0 · 적용 성공 · PV 행 불변
    const facts_d = await dbLib.readRosterFacts(prisma)
    expect('(d) PV 행 → ignoredPv 1', facts_d.ignoredPv, 1)
    const v_d = dbLib.judgeRoster(dbTestRoster, facts_d)
    expect('(d) PV 있어도 applicable', v_d.kind, 'applicable')
    if (v_d.kind !== 'applicable') {
      truthy('(d) applicable 필요 — 실패', false)
    } else {
      const r_d = await dbLib.applyRoster(prisma, { approvedPlanDigest: v_d.planDigest, roster: dbTestRoster, reason: '시험' })
      expect('(d) 적용 성공', r_d.ok, true)
      if (r_d.ok) {
        expect('(d) create 40', r_d.created, 40)
        // PV 행 불변 확인
        const afterFacts = await dbLib.readRosterFacts(prisma)
        expect('(d) PV 행 불변 — ignoredPv 1', afterFacts.ignoredPv, 1)
        const pvRow = afterFacts.ignoredRows.find((r) => r.code === 'PV07')
        expect('(d) PV07 userId 불변', pvRow?.userId, pvUser.id)
      }
    }
    expect('(d) User +40 · Writer +40 · Account +0 · Persona +0', (await counts()).map((v, i) => v - start[i]!), [40, 40, 0, 0])

    const afterStart = await counts()

    // (e) 재실행 → same
    const facts_e = await dbLib.readRosterFacts(prisma)
    const v_e = dbLib.judgeRoster(dbTestRoster, facts_e)
    expect('(e) 재실행 → same', v_e.kind, 'same')

    // (f) DB OP12 닉네임 변경 → stop (P3)
    const op12 = await prisma.operatorWriter.findUnique({ where: { code: 'OP12' }, select: { userId: true } })
    if (op12) {
      await prisma.user.update({ where: { id: op12.userId }, data: { nickname: '완전히다른이름' } })
      const facts_f = await dbLib.readRosterFacts(prisma)
      const v_f = dbLib.judgeRoster(dbTestRoster, facts_f)
      expect('(f) DB 닉네임 변경 → stop (P3)', v_f.kind, 'stop')
      // 복원
      const op12Entry = dbTestRoster.writers.find((e) => e.code === 'OP12')!
      await prisma.user.update({ where: { id: op12.userId }, data: { nickname: op12Entry.nickname } })
    }

    // (g) DB 에만 OP91 → stop (P5)
    const extraUser = await prisma.user.create({ data: { nickname: '이름없는91' } })
    await prisma.operatorWriter.create({ data: { code: 'OP91', userId: extraUser.id, status: 'active' } })
    const facts_g = await dbLib.readRosterFacts(prisma)
    expect('(g) DB 에만 OP91 → stop (P5)', dbLib.judgeRoster(dbTestRoster, facts_g).kind, 'stop')
    // 정리
    await prisma.operatorWriter.delete({ where: { code: 'OP91' } })
    await prisma.user.delete({ where: { id: extraUser.id } })

    // (h) 명단 OP58 retired → retire 적용
    const rosterRetireOP58 = {
      ...dbTestRoster,
      writers: dbTestRoster.writers.map((e) =>
        e.code === 'OP58' ? { ...e, status: 'retired' as const } : e,
      ),
    }
    const facts_h = await dbLib.readRosterFacts(prisma)
    const v_h = dbLib.judgeRoster(rosterRetireOP58, facts_h)
    expect('(h) 명단 OP58 retired → applicable', v_h.kind, 'applicable')
    if (v_h.kind === 'applicable') {
      const r_h = await dbLib.applyRoster(prisma, { approvedPlanDigest: v_h.planDigest, roster: rosterRetireOP58, reason: '시험' })
      expect('(h) retire 적용 성공', r_h.ok, true)
      if (r_h.ok) expect('(h) retired 1', r_h.retired, 1)
      // getOperatorWriters 에서 OP58 이 빠지는지 (status=retired 필터)
      const afterOP58 = await prisma.operatorWriter.findUnique({ where: { code: 'OP58' }, select: { status: true } })
      expect('(h) OP58 status retired', afterOP58?.status, 'retired')
    }
    expect('(h) write 최소 1 · User 불변', (await counts()).slice(0, 2), [afterStart[0], afterStart[1]])

    // (i) OP31~50 없는 초기 상태 → applicable(create 60) 확인용 (별도 wipe 후)
    await wipe()
    for (let i = 1; i <= 30; i++) {
      const code = `OP${String(i).padStart(2, '0')}`
      const e = dbTestRoster.writers.find((w) => w.code === code)
      if (e === undefined) continue
      await prisma.user.create({ data: { nickname: e.nickname, operatorWriter: { create: { code, note: e.note, status: 'active' } } } })
    }
    const facts_i = await dbLib.readRosterFacts(prisma)
    const v_i = dbLib.judgeRoster(dbTestRoster, facts_i)
    // 🔴 OP31~50 이 운영에 없다면 그 20명은 "새 행"이 되어 새 이름 규칙(P8)을 받는다 — 그중 OP37 이 걸려 stop 이다.
    //    설계 §7: 이 분기는 "OP31~50 적용됨" 기록이 틀렸다는 뜻이라 멈추고 창업자에게 올린다. stop 이 그 멈춤이다.
    expect('(i) OP01~30 만 있음 → stop (OP31~50 미적용은 사람이 본다)', v_i.kind, 'stop')
    if (v_i.kind === 'stop') {
      expect('(i) 멈춘 사유는 OP37 새 이름 판정 하나', v_i.problems.map((p) => p.split(':')[0]), ['OP37'])
    }

  } finally {
    await wipe()
    await prisma.$disconnect()
  }
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
