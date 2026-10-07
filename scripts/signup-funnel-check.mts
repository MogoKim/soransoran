#!/usr/bin/env tsx
/**
 * 회원가입 전환 측정 핵심 계약 검사 — 순수 판정 · schema 모양 · 저장 모듈 · 변이 증명.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8.
 *
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-funnel-check.mts
 *
 * 🔴 DB 에 연결하지 않는다. 저장 모듈은 호출 기록 대역으로만 돌린다.
 * 🔴 `--tsconfig tsconfig.ops.json` 으로 돈다. 저장 모듈의 `server-only` 를 빈 shim 으로 잇기 위해서다
 *    (scripts/lib/server-only-shim.ts). 앱 tsconfig 는 건드리지 않는다.
 * 🔴 판정마다 일부러 망가뜨린 구현을 같은 검사 묶음에 넣어 **실패하는지** 확인한다(§8). 통과만 하는 검사는
 *    검사가 아니다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ANONYMOUS_FUNNEL_STEPS,
  SIGNUP_FUNNEL_CONTENT_TYPES,
  SIGNUP_FUNNEL_ENTRY_POINTS,
  SIGNUP_FUNNEL_RATIOS,
  SIGNUP_FUNNEL_STEPS,
  isSignupFunnelDay,
  isSignupFunnelKey,
  parseAnonymousFunnelPayload,
  parseSignupFunnelPayload,
  type SignupFunnelKey,
} from '../src/lib/signup-funnel'
import { incrementSignupFunnel, type SignupFunnelDb } from '../src/lib/signup-funnel-store'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

// ─────────── 1. 정의 ───────────
console.log('\n■ 1. 단계·허용값 정의')
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b)
check('다섯 단계가 순서대로 정의된다', same(SIGNUP_FUNNEL_STEPS, [
  'logged_out_view', 'prompt_reach', 'prompt_impression', 'auth_start', 'signup_complete',
]))
check('익명 단계는 ①~④ 넷이다', same(ANONYMOUS_FUNNEL_STEPS, [
  'logged_out_view', 'prompt_reach', 'prompt_impression', 'auth_start',
]))
check('signup_complete 는 서버 전용이다(익명 단계에 없다)',
  !(ANONYMOUS_FUNNEL_STEPS as readonly string[]).includes('signup_complete')
  && SIGNUP_FUNNEL_STEPS.filter((s) => !(ANONYMOUS_FUNNEL_STEPS as readonly string[]).includes(s)).join() === 'signup_complete')
check('contentType 은 community | magazine', same(SIGNUP_FUNNEL_CONTENT_TYPES, ['community', 'magazine']))
check('entryPoint 는 content_end 하나', same(SIGNUP_FUNNEL_ENTRY_POINTS, ['content_end']))

// ─────────── 2. parser 검사 묶음 (변이 증명에 다시 쓴다) ───────────
type Parse = (input: unknown) => unknown

function parserFailures(parseAnon: Parse, parseFull: Parse): string[] {
  const failures: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
  const valid = (step: string) => ({ step, contentType: 'community', entryPoint: 'content_end' })

  for (const step of ANONYMOUS_FUNNEL_STEPS)
    for (const contentType of SIGNUP_FUNNEL_CONTENT_TYPES)
      for (const entryPoint of SIGNUP_FUNNEL_ENTRY_POINTS) {
        const input = { step, contentType, entryPoint }
        expect(`익명 허용값 통과 ${step}/${contentType}`, JSON.stringify(parseAnon(input)) === JSON.stringify(input))
      }
  for (const step of SIGNUP_FUNNEL_STEPS)
    for (const contentType of SIGNUP_FUNNEL_CONTENT_TYPES) {
      const input = { step, contentType, entryPoint: 'content_end' }
      expect(`서버 허용값 통과 ${step}/${contentType}`, JSON.stringify(parseFull(input)) === JSON.stringify(input))
    }

  expect('익명 parser 가 signup_complete 거부', parseAnon(valid('signup_complete')) === null)
  expect('추가 필드 거부', parseAnon({ ...valid('auth_start'), contentId: 'p1' }) === null)
  expect('추가 필드 거부 — 서버 parser', parseFull({ ...valid('signup_complete'), url: '/x' }) === null)
  const withSymbol = { ...valid('auth_start'), [Symbol('x')]: 1 }
  expect('symbol 추가 키 거부', parseAnon(withSymbol) === null)
  const hidden = valid('auth_start')
  Object.defineProperty(hidden, 'slug', { value: 's', enumerable: false })
  expect('열거되지 않는 추가 키 거부', parseAnon(hidden) === null)
  expect('step 누락 거부', parseAnon({ contentType: 'community', entryPoint: 'content_end' }) === null)
  expect('contentType 누락 거부', parseAnon({ step: 'auth_start', entryPoint: 'content_end' }) === null)
  expect('entryPoint 누락 거부', parseAnon({ step: 'auth_start', contentType: 'community' }) === null)
  expect('허용값 밖 step 거부', parseAnon(valid('page_view')) === null)
  expect('허용값 밖 contentType 거부', parseAnon({ ...valid('auth_start'), contentType: 'board' }) === null)
  expect('허용값 밖 entryPoint 거부', parseAnon({ ...valid('auth_start'), entryPoint: 'header' }) === null)
  expect('대소문자 다른 값 거부', parseAnon({ ...valid('auth_start'), contentType: 'Community' }) === null)
  expect('숫자 값 거부', parseAnon({ ...valid('auth_start'), entryPoint: 1 }) === null)
  expect('배열 거부', parseAnon(['auth_start', 'community', 'content_end']) === null)
  expect('null 거부', parseAnon(null) === null)
  expect('undefined 거부', parseAnon(undefined) === null)
  expect('문자열 거부', parseAnon(JSON.stringify(valid('auth_start'))) === null)
  expect('숫자 거부', parseAnon(42) === null)
  class Box { step = 'auth_start'; contentType = 'community'; entryPoint = 'content_end' }
  expect('클래스 인스턴스 거부', parseAnon(new Box()) === null)
  let getterCalls = 0
  const withGetter = { contentType: 'community', entryPoint: 'content_end' }
  Object.defineProperty(withGetter, 'step', { get: () => { getterCalls++; return 'auth_start' }, enumerable: true })
  expect('getter 값 거부·호출 0', parseAnon(withGetter) === null && getterCalls === 0)

  const original = { ...valid('auth_start'), extra: 'x' }
  const snapshot = JSON.stringify(original)
  parseAnon(original)
  expect('입력 불변 — 거부 경로', JSON.stringify(original) === snapshot && 'extra' in original)
  const ok = valid('prompt_reach')
  const okSnap = JSON.stringify(ok)
  const out = parseAnon(ok)
  expect('입력 불변 — 통과 경로 · 새 객체를 돌려준다', JSON.stringify(ok) === okSnap && out !== ok)
  return failures
}

console.log('\n■ 2. parser — 허용·거부·불변')
const realFailures = parserFailures(parseAnonymousFunnelPayload, parseSignupFunnelPayload)
check('parser 검사 묶음 전부 통과', realFailures.length === 0, realFailures.join(' · '))
const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, {
  step: 'auth_start', contentType: 'magazine', entryPoint: 'content_end',
})
check('prototype 없는 일반 객체는 허용', parseAnonymousFunnelPayload(nullProto) !== null)

console.log('\n■ 3. 저장 key · 날짜 모양')
check('KST 날짜 모양 통과', isSignupFunnelDay('2026-10-07') && isSignupFunnelDay('2028-02-29'))
check('없는 날짜·모양 거부', ['2026-02-30', '2026-13-01', '2026-1-07', '20261007', '2026-10-07T00:00', '', 20261007]
  .every((v) => !isSignupFunnelDay(v)))
const goodKey: SignupFunnelKey = { day: '2026-10-07', step: 'signup_complete', contentType: 'magazine', entryPoint: 'content_end' }
check('정상 key 통과', isSignupFunnelKey(goodKey))
check('계약 밖 key 거부', !isSignupFunnelKey({ ...goodKey, step: 'x' as 'auth_start' }) && !isSignupFunnelKey({ ...goodKey, day: '2026-10-7' }))

// ─────────── 4. 비율 ───────────
console.log('\n■ 4. 비율 정의')
check('승인된 비율 세 개뿐', JSON.stringify(SIGNUP_FUNNEL_RATIOS.map((r) => [r.numerator, r.denominator])) === JSON.stringify([
  ['prompt_reach', 'logged_out_view'], ['prompt_impression', 'prompt_reach'], ['auth_start', 'prompt_impression'],
]))
check('signup_complete 가 비율에 들어가지 않는다', SIGNUP_FUNNEL_RATIOS.every((r) => !JSON.stringify(r).includes('signup_complete')))

// ─────────── 5. schema 모양 (변이 증명에 다시 쓴다) ───────────
function schemaFailures(schema: string): string[] {
  const failures: string[] = []
  const block = schema.match(/\nmodel SignupFunnelDaily \{\n([\s\S]*?)\n\}/)
  if (!block) return ['SignupFunnelDaily 모델 없음']
  const lines = block[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'))
  const fields = lines.filter((l) => !l.startsWith('@@')).map((l) => l.split(/\s+/).slice(0, 3).join(' '))
  const expected = [
    'day String', 'step String', 'contentType String', 'entryPoint String',
    'count Int @default(0)', 'updatedAt DateTime @updatedAt',
  ]
  if (JSON.stringify(fields) !== JSON.stringify(expected)) failures.push(`열 6개 불일치: ${fields.join(', ')}`)
  const attrs = lines.filter((l) => l.startsWith('@@'))
  if (JSON.stringify(attrs) !== JSON.stringify(['@@id([day, step, contentType, entryPoint])'])) failures.push(`모델 속성 불일치: ${attrs.join(', ')}`)
  if (/@relation|@unique|@@index|@@unique|@@map|@map/.test(block[1])) failures.push('관계·별도 index·unique·map 존재')
  if (/\b(ip|userAgent|userId|memberId|kakaoId|email|phone|gender|birth\w*|nickname|postId|contentId|slug|title|url|callback\w*)\b/i
    .test(lines.filter((l) => !l.startsWith('@@')).map((l) => l.split(/\s+/)[0]).join(' '))) failures.push('금지 열 이름')
  const typeNames = lines.filter((l) => !l.startsWith('@@')).map((l) => l.split(/\s+/)[1])
  if (!typeNames.every((t) => ['String', 'Int', 'DateTime'].includes(t))) failures.push(`enum·관계 타입 사용: ${typeNames.join(',')}`)
  return failures
}

console.log('\n■ 5. Prisma 모델 — 0031 과 같은 모양')
const schemaText = read('prisma/schema.prisma')
const realSchema = schemaFailures(schemaText)
check('SignupFunnelDaily 열 6개 · 복합 PK · 관계/index/enum/금지 열 0', realSchema.length === 0, realSchema.join(' · '))
check('SignupFunnelDaily 모델은 하나뿐', (schemaText.match(/\nmodel SignupFunnelDaily \{/g) ?? []).length === 1)

// ─────────── 6. 저장 모듈 ───────────
console.log('\n■ 6. 저장 모듈 — upsert increment 하나')
type UpsertArgs = Parameters<SignupFunnelDb['signupFunnelDaily']['upsert']>[0]
function fakeDb(behavior: 'ok' | 'reject'): { db: SignupFunnelDb; calls: UpsertArgs[] } {
  const calls: UpsertArgs[] = []
  const delegate = {
    upsert: (args: UpsertArgs) => {
      calls.push(args)
      return behavior === 'ok' ? Promise.resolve({}) : Promise.reject(new Error('db down'))
    },
  }
  return { db: { signupFunnelDaily: delegate } as unknown as SignupFunnelDb, calls }
}
const now = new Date('2026-10-07T03:00:00.000Z')
{
  const { db, calls } = fakeDb('ok')
  await incrementSignupFunnel(db, goodKey, now)
  const c = calls[0]
  check('upsert 1회', calls.length === 1)
  check('where 는 복합 PK', JSON.stringify(c?.where) === JSON.stringify({ day_step_contentType_entryPoint: { day: '2026-10-07', step: 'signup_complete', contentType: 'magazine', entryPoint: 'content_end' } }))
  check('create 는 count 1 · updatedAt=now', JSON.stringify(c?.create) === JSON.stringify({ ...goodKey, count: 1, updatedAt: now }))
  check('update 는 count increment 1 · updatedAt=now', JSON.stringify(c?.update) === JSON.stringify({ count: { increment: 1 }, updatedAt: now }))
}
{
  const { db, calls } = fakeDb('ok')
  let threw = false
  try { await incrementSignupFunnel(db, { ...goodKey, contentType: 'board' as 'community' }, now) } catch { threw = true }
  check('계약 밖 key 는 DB 호출 0 으로 거부', threw && calls.length === 0)
}
{
  const { db } = fakeDb('reject')
  let surfaced = false
  try { await incrementSignupFunnel(db, goodKey, now) } catch { surfaced = true }
  check('DB 실패를 삼키지 않는다', surfaced)
}

function storeSourceFailures(src: string): string[] {
  const failures: string[] = []
  if (!/^import 'server-only'/m.test(src)) failures.push('server-only 없음')
  if (/\$queryRaw|\$executeRaw|Unsafe|Prisma\.sql/.test(src)) failures.push('raw SQL')
  if (!/count:\s*\{\s*increment:\s*1\s*\}/.test(src)) failures.push('increment 1 없음')
  if (!/\.upsert\(/.test(src)) failures.push('upsert 없음')
  if (/\.(findUnique|findFirst|update|create)\(/.test(src)) failures.push('읽고 쓰기 경로')
  if (/process\.env|Date\.now|new Date\(|from '@\/lib\/prisma'|from '@\/lib\/auth'/.test(src)) failures.push('env·시계·싱글턴·인증')
  if (/catch\s*\{|catch\s*\(/.test(src)) failures.push('실패를 삼킴')
  return failures
}
const storeSrc = read('src/lib/signup-funnel-store.ts')
const realStore = storeSourceFailures(storeSrc)
check('저장 소스: server-only · upsert increment · raw SQL 0 · 시계/env/싱글턴 0 · catch 0', realStore.length === 0, realStore.join(' · '))

// ─────────── 7. 경계 ───────────
console.log('\n■ 7. 모듈 경계 · runtime 연결 0')
const pureSrc = read('src/lib/signup-funnel.ts')
const pureImports = [...pureSrc.matchAll(/^import .*$/gm)].map((m) => m[0])
check('순수 모듈은 import 0', pureImports.length === 0, pureImports.join(' | '))
check('순수 모듈에 env·시계·DB·React 0', !/process\.env|Date\.now|new Date\(\)|prisma|react|server-only/i.test(pureSrc.replace(/^\s*(\*|\/\/).*$/gm, '')))
const storeImports = [...storeSrc.matchAll(/^import .*$/gm)].map((m) => m[0])
check('저장 모듈 import 는 server-only · Prisma 타입 · 순수 계약뿐', JSON.stringify(storeImports) === JSON.stringify([
  "import 'server-only'",
  "import type { PrismaClient } from '@prisma/client'",
  "import { isSignupFunnelKey, type SignupFunnelKey } from '@/lib/signup-funnel'",
]))

// 🔴 두 모듈을 부르는 곳은 회원가입 전환 익명 기록 경로 셋뿐이다. 화면·인증·온보딩·어드민은 아직 0 이다.
const importers = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[])
  .map((f) => f.split('\\').join('/'))
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .filter((f) => !['lib/signup-funnel.ts', 'lib/signup-funnel-store.ts'].includes(f))
  .filter((f) => /from '@\/lib\/signup-funnel(-store)?'|from '\.{1,2}\/[^']*signup-funnel/.test(read(join('src', f))))
  .sort()
check('두 모듈을 부르는 곳은 익명 기록 경로(gate · endpoint · route) 셋뿐이다', JSON.stringify(importers) === JSON.stringify([
  'app/api/signup-funnel/route.ts', 'lib/signup-funnel-endpoint.ts', 'lib/signup-funnel-gate.ts',
]), importers.join(', '))

// ─────────── 8. 변이 증명 ───────────
console.log('\n■ 8. 변이 — 망가뜨린 판정은 검사 묶음이 잡는다')
const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const pick3 = (v: Record<string, unknown>, steps: readonly string[]) =>
  steps.includes(v.step as string) && (SIGNUP_FUNNEL_CONTENT_TYPES as readonly string[]).includes(v.contentType as string)
    && v.entryPoint === 'content_end' ? { step: v.step, contentType: v.contentType, entryPoint: v.entryPoint } : null
const mutants: Array<[string, Parse, Parse]> = [
  ['추가 키를 버리고 통과시킨다', (v) => (plain(v) ? pick3(v, ANONYMOUS_FUNNEL_STEPS) : null), parseSignupFunnelPayload],
  ['익명 경로가 signup_complete 를 받는다', parseSignupFunnelPayload, parseSignupFunnelPayload],
  ['배열도 객체로 본다', (v) => (Array.isArray(v) ? { step: 'auth_start', contentType: 'community', entryPoint: 'content_end' } : parseAnonymousFunnelPayload(v)), parseSignupFunnelPayload],
  ['contentType 을 검사하지 않는다', (v) => (plain(v) && Reflect.ownKeys(v).length === 3 && (ANONYMOUS_FUNNEL_STEPS as readonly string[]).includes(v.step as string) ? { ...v } : null), parseSignupFunnelPayload],
  ['추가 키를 지워서 입력을 고친다', (v) => { if (plain(v)) delete v.extra; return parseAnonymousFunnelPayload(v) }, parseSignupFunnelPayload],
]
for (const [name, anon, full] of mutants) check(`변이 잡음: ${name}`, parserFailures(anon, full).length > 0)

const schemaMutants: Array<[string, string]> = [
  ['email 열 추가', schemaText.replace('  count       Int      @default(0)', '  email       String\n  count       Int      @default(0)')],
  ['PK 열 순서 변경', schemaText.replace('@@id([day, step, contentType, entryPoint])', '@@id([step, day, contentType, entryPoint])')],
  ['별도 index 추가', schemaText.replace('@@id([day, step, contentType, entryPoint])', '@@id([day, step, contentType, entryPoint])\n  @@index([day])')],
  ['count 기본값 제거', schemaText.replace('count       Int      @default(0)', 'count       Int')],
]
for (const [name, text] of schemaMutants) check(`변이 잡음 — schema: ${name}`, text !== schemaText && schemaFailures(text).length > 0)

const storeMutants: Array<[string, string]> = [
  ['increment 대신 덮어쓰기', storeSrc.replace('count: { increment: 1 }', 'count: 1')],
  ['raw SQL', storeSrc.replace('await db.signupFunnelDaily.upsert(', 'await db.$executeRaw``; await db.signupFunnelDaily.upsert(')],
  ['실패 삼키기', storeSrc.replace('  await db.signupFunnelDaily.upsert({', '  try {} catch {}\n  await db.signupFunnelDaily.upsert({')],
  ['server-only 제거', storeSrc.replace("import 'server-only'\n", '')],
]
for (const [name, text] of storeMutants) check(`변이 잡음 — store: ${name}`, text !== storeSrc && storeSourceFailures(text).length > 0)

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
