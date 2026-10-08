#!/usr/bin/env tsx
/**
 * 회원가입 전환 익명 기록 경로 검사 — gate · KST · `POST /api/signup-funnel` 판정 순서와 제외 규칙.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-3 · §8-7 · §8-10 · §8-13.
 *
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-funnel-endpoint-check.mts
 *
 * 🔴 DB · 외부 서버 · 실제 인증에 연결하지 않는다. handler 에 호출 기록 대역만 넣는다.
 * 🔴 gate 가 닫힌 대역은 인증 · body · 저장이 **불리면** 기록이 남는다 — 그 기록이 0 이어야 통과다.
 *    그리고 일부러 gate 를 무시하는 변이 handler 를 같은 검사에 넣어 잡히는지 확인한다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SignupFunnelKey } from '../src/lib/signup-funnel'
import {
  SIGNUP_FUNNEL_BODY_LIMIT_BYTES,
  handleSignupFunnelRequest,
  type SignupFunnelEndpointDeps,
} from '../src/lib/signup-funnel-endpoint'
import { signupFunnelGate, toKstDay, type SignupFunnelEnv } from '../src/lib/signup-funnel-gate'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

// ─────────── 1. KST ───────────
console.log('\n■ 1. KST 날짜')
check('KST 자정 직전은 전날', toKstDay(new Date('2026-10-06T14:59:59.999Z')) === '2026-10-06')
check('KST 자정은 다음 날', toKstDay(new Date('2026-10-06T15:00:00.000Z')) === '2026-10-07')
check('UTC 자정은 KST 오전 9시 같은 날', toKstDay(new Date('2026-10-07T00:00:00.000Z')) === '2026-10-07')
check('연말 경계', toKstDay(new Date('2026-12-31T15:00:00.000Z')) === '2027-01-01')
check('윤일', toKstDay(new Date('2028-02-28T15:00:00.000Z')) === '2028-02-29')

// ─────────── 2. gate 전체 조합 ───────────
console.log('\n■ 2. gate 조합')
const BEFORE = new Date('2026-10-06T14:59:59.999Z') // KST 2026-10-06
const AT = new Date('2026-10-06T15:00:00.000Z') //     KST 2026-10-07
const vercelEnvs: Array<string | undefined> = ['production', 'preview', 'development', undefined, '', 'Production', ' production']
const starts: Array<string | undefined> = [
  undefined, '', 'garbage', '2026-02-30', '2026-13-01', '2026-10-7', ' 2026-10-07', '2026-10-07 ', '2026-10-07T00:00',
  '2026-10-06', '2026-10-07', '2026-10-08',
]
let combos = 0
let mismatches: string[] = []
for (const VERCEL_ENV of vercelEnvs)
  for (const SIGNUP_FUNNEL_COLLECTION_START of starts)
    for (const now of [BEFORE, AT]) {
      combos++
      const env: SignupFunnelEnv = { VERCEL_ENV, SIGNUP_FUNNEL_COLLECTION_START }
      let gate: ReturnType<typeof signupFunnelGate> | 'threw'
      try { gate = signupFunnelGate(env, now) } catch { gate = 'threw' }
      const today = now === BEFORE ? '2026-10-06' : '2026-10-07'
      const valid = typeof SIGNUP_FUNNEL_COLLECTION_START === 'string'
        && ['2026-10-06', '2026-10-07', '2026-10-08'].includes(SIGNUP_FUNNEL_COLLECTION_START)
      const expected = VERCEL_ENV === 'production' && valid && today >= (SIGNUP_FUNNEL_COLLECTION_START as string)
      const got = gate !== 'threw' && gate.active
      if (gate === 'threw' || got !== expected || (gate.active && gate.today !== today))
        mismatches.push(`${String(VERCEL_ENV)}|${String(SIGNUP_FUNNEL_COLLECTION_START)}|${today}`)
    }
check(`gate ${combos}개 조합이 독립 판정과 같고 throw 0`, mismatches.length === 0, mismatches.join(' · '))
check('시작일 당일 KST 자정부터 열린다', signupFunnelGate({ VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-07' }, BEFORE).active === false
  && signupFunnelGate({ VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-07' }, AT).active === true)
check('빈 env 는 닫힘', signupFunnelGate({}, AT).active === false)
mismatches = []

// ─────────── 3. handler 대역 ───────────
const URL_OK = 'https://soransoran.com/api/signup-funnel'
const ORIGIN = 'https://soransoran.com'
const OPEN_ENV: SignupFunnelEnv = { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }
const NOW = new Date('2026-10-06T15:30:00.000Z') // KST 2026-10-07 00:30

type Recorder = {
  deps: SignupFunnelEndpointDeps
  auth: number
  saved: Array<{ key: SignupFunnelKey; now: Date }>
}
function recorder(opts: { env?: SignupFunnelEnv; loggedIn?: boolean | 'throw'; save?: 'ok' | 'reject' } = {}): Recorder {
  const r: Recorder = {
    auth: 0,
    saved: [],
    deps: {
      env: opts.env ?? OPEN_ENV,
      now: () => NOW,
      isLoggedIn: async () => {
        r.auth++
        if (opts.loggedIn === 'throw') throw new Error('auth down')
        return opts.loggedIn ?? false
      },
      increment: async (key, now) => {
        r.saved.push({ key, now })
        if (opts.save === 'reject') throw new Error('db down')
      },
    },
  }
  return r
}

type ReqOpts = { body?: string; headers?: Record<string, string>; origin?: string | null; stream?: { pulls: number } }
function req(opts: ReqOpts = {}): Request {
  const headers = new Headers(opts.headers)
  if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN)
  const text = opts.body ?? JSON.stringify({ step: 'prompt_reach', contentType: 'community', entryPoint: 'content_end' })
  if (opts.stream) {
    const counter = opts.stream
    // 🔴 highWaterMark 0 — 기본값(1)이면 스트림이 만들어지자마자 pull 을 한 번 불러 "읽지 않았는데 읽음" 이 된다.
    //    읽는 쪽이 실제로 read() 할 때만 pull 이 세지게 한다.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          counter.pulls++
          controller.enqueue(new TextEncoder().encode(text))
          controller.close()
        },
      },
      { highWaterMark: 0 },
    )
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers, body, duplex: 'half' }
    return new Request(URL_OK, init)
  }
  return new Request(URL_OK, { method: 'POST', headers, body: text })
}

async function run(r: Recorder, request: Request, handler = handleSignupFunnelRequest): Promise<Response> {
  return handler(request, r.deps)
}
const is204 = async (res: Response) => res.status === 204 && (await res.text()) === ''

console.log('\n■ 3. 정상 익명 요청')
{
  const r = recorder()
  const res = await run(r, req())
  check('정상 요청은 204 · 저장 1회', (await is204(res)) && r.saved.length === 1)
  check('저장 key 는 payload + 서버 KST 날짜', JSON.stringify(r.saved[0]?.key) === JSON.stringify({
    step: 'prompt_reach', contentType: 'community', entryPoint: 'content_end', day: '2026-10-07',
  }))
  check('저장 시각은 서버 now', r.saved[0]?.now === NOW)
  check('응답에 noindex · no-store', res.headers.get('x-robots-tag') === 'noindex' && res.headers.get('cache-control') === 'no-store')
}
for (const step of ['logged_out_view', 'prompt_reach', 'prompt_impression', 'auth_start'] as const)
  for (const contentType of ['community', 'magazine'] as const) {
    const r = recorder()
    await run(r, req({ body: JSON.stringify({ step, contentType, entryPoint: 'content_end' }) }))
    check(`허용 ${step}/${contentType} 저장 1회`, r.saved.length === 1 && r.saved[0]?.key.step === step && r.saved[0]?.key.contentType === contentType)
  }
{
  const r = recorder()
  await run(r, req({ headers: { 'sec-fetch-site': 'same-origin' } }))
  check('Sec-Fetch-Site same-origin 은 통과', r.saved.length === 1)
}

// ─────────── 4. gate 닫힘 — 인증 · body · DB 0 ───────────
console.log('\n■ 4. gate 닫힘 — 인증 · body · DB 0')
async function gateOffViolations(handler: typeof handleSignupFunnelRequest): Promise<string[]> {
  const v: string[] = []
  for (const env of [
    {}, { VERCEL_ENV: 'preview', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' },
    { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-08' },
  ] satisfies SignupFunnelEnv[]) {
    const r = recorder({ env })
    const stream = { pulls: 0 }
    const request = req({ stream })
    const res = await run(r, request, handler)
    if (res.status !== 204) v.push(`${JSON.stringify(env)} status ${res.status}`)
    if (r.auth !== 0) v.push(`${JSON.stringify(env)} 인증 ${r.auth}`)
    if (r.saved.length !== 0) v.push(`${JSON.stringify(env)} DB ${r.saved.length}`)
    if (stream.pulls !== 0 || request.bodyUsed) v.push(`${JSON.stringify(env)} body 읽음`)
  }
  return v
}
const offReal = await gateOffViolations(handleSignupFunnelRequest)
check('gate 닫힘 4종: 204 · 인증 0 · body 0 · DB 0', offReal.length === 0, offReal.join(' · '))
const gateIgnoringMutant: typeof handleSignupFunnelRequest = async (request, deps) => {
  await deps.increment({ step: 'prompt_reach', contentType: 'community', entryPoint: 'content_end', day: '2026-10-07' }, deps.now())
  return handleSignupFunnelRequest(request, deps)
}
check('변이 잡음: gate 를 무시하고 DB 를 부르는 handler', (await gateOffViolations(gateIgnoringMutant)).length > 0)
const authFirstMutant: typeof handleSignupFunnelRequest = async (request, deps) => {
  await deps.isLoggedIn()
  return handleSignupFunnelRequest(request, deps)
}
check('변이 잡음: gate 보다 인증을 먼저 부르는 handler', (await gateOffViolations(authFirstMutant)).length > 0)
const bodyFirstMutant: typeof handleSignupFunnelRequest = async (request, deps) => {
  await request.text()
  return handleSignupFunnelRequest(request, deps)
}
check('변이 잡음: gate 보다 body 를 먼저 읽는 handler (대역이 실제 읽기를 센다)', (await gateOffViolations(bodyFirstMutant)).length > 0)

// ─────────── 5. 제외 규칙 — 저장 0 · 순서 ───────────
console.log('\n■ 5. 제외 규칙')
async function excluded(name: string, request: () => Request, opts: Parameters<typeof recorder>[0] = {}, authExpected = 0) {
  const r = recorder(opts)
  const res = await run(r, request())
  check(`${name}: 204 · 저장 0 · 인증 ${authExpected}`, (await is204(res)) && r.saved.length === 0 && r.auth === authExpected,
    `status=${res.status} saved=${r.saved.length} auth=${r.auth}`)
}
for (const [h, v] of [['next-router-prefetch', '1'], ['purpose', 'prefetch'], ['sec-purpose', 'prefetch;prerender'], ['x-bot-type', 'ops']] as const) {
  const stream = { pulls: 0 }
  await excluded(`prefetch·자동화 ${h}`, () => req({ headers: { [h]: v }, stream }))
  check(`prefetch·자동화 ${h}: body 읽기 0`, stream.pulls === 0)
}
{
  const stream = { pulls: 0 }
  await excluded('Origin 누락', () => req({ origin: null, stream }))
  check('Origin 누락: body 읽기 0', stream.pulls === 0)
}
await excluded('cross-origin', () => req({ origin: 'https://evil.example' }))
await excluded('같은 host 다른 scheme', () => req({ origin: 'http://soransoran.com' }))
await excluded('www 와 apex 는 다른 origin', () => req({ origin: 'https://www.soransoran.com' }))
await excluded('Origin null 문자열', () => req({ origin: 'null' }))
await excluded('Sec-Fetch-Site cross-site', () => req({ headers: { 'sec-fetch-site': 'cross-site' } }))
await excluded('Sec-Fetch-Site same-site', () => req({ headers: { 'sec-fetch-site': 'same-site' } }))
await excluded('Sec-Fetch-Site none', () => req({ headers: { 'sec-fetch-site': 'none' } }))

const okBody = (extra = '') => `{"step":"prompt_reach","contentType":"community","entryPoint":"content_end"}${extra}`
await excluded('signup_complete 는 익명 경로에서 거부', () => req({ body: '{"step":"signup_complete","contentType":"community","entryPoint":"content_end"}' }))
await excluded('추가 필드', () => req({ body: '{"step":"prompt_reach","contentType":"community","entryPoint":"content_end","contentId":"p1"}' }))
await excluded('클라이언트 day 필드', () => req({ body: '{"step":"prompt_reach","contentType":"community","entryPoint":"content_end","day":"2020-01-01"}' }))
await excluded('허용값 밖 step', () => req({ body: '{"step":"page_view","contentType":"community","entryPoint":"content_end"}' }))
await excluded('허용값 밖 contentType', () => req({ body: '{"step":"prompt_reach","contentType":"board","entryPoint":"content_end"}' }))
await excluded('허용값 밖 entryPoint', () => req({ body: '{"step":"prompt_reach","contentType":"community","entryPoint":"header"}' }))
await excluded('깨진 JSON', () => req({ body: '{"step":' }))
await excluded('빈 body', () => req({ body: '' }))
await excluded('배열 JSON', () => req({ body: '["prompt_reach","community","content_end"]' }))
await excluded('문자열 JSON', () => req({ body: '"prompt_reach"' }))
await excluded('null JSON', () => req({ body: 'null' }))
{
  const bad = new Uint8Array([0x7b, 0xff, 0x7d])
  await excluded('깨진 UTF-8', () => new Request(URL_OK, { method: 'POST', headers: { origin: ORIGIN }, body: bad }))
}

// 크기 경계 — 공백은 유효한 JSON 이므로 같은 payload 를 바이트 수만 바꿔 본다
const pad = (n: number) => okBody(' '.repeat(n - okBody().length))
{
  const r = recorder()
  await run(r, req({ body: pad(SIGNUP_FUNNEL_BODY_LIMIT_BYTES) }))
  check(`${SIGNUP_FUNNEL_BODY_LIMIT_BYTES} bytes 는 저장 1회`, new TextEncoder().encode(pad(256)).byteLength === 256 && r.saved.length === 1)
}
await excluded('257 bytes', () => req({ body: pad(SIGNUP_FUNNEL_BODY_LIMIT_BYTES + 1) }))
{
  const stream = { pulls: 0 }
  await excluded('Content-Length 가 상한 초과', () => req({ headers: { 'content-length': '300' }, stream }))
  check('Content-Length 초과: body 읽기 0', stream.pulls === 0)
}
await excluded('Content-Length 가 숫자가 아님', () => req({ headers: { 'content-length': 'abc' } }))
await excluded('Content-Length 거짓(작게 선언 · 실제 257)', () => req({ headers: { 'content-length': '10' }, body: pad(257) }))

await excluded('로그인 사용자', () => req(), { loggedIn: true }, 1)
await excluded('인증 판정 실패', () => req(), { loggedIn: 'throw' }, 1)
{
  const r = recorder({ save: 'reject' })
  let threw = false
  let res: Response | null = null
  try { res = await run(r, req()) } catch { threw = true }
  check('DB 저장 실패에도 204 · 예외 전파 0', !threw && res !== null && (await is204(res)) && r.saved.length === 1)
}

// ─────────── 6. 소스 경계 ───────────
console.log('\n■ 6. 소스 경계 — D100 import 0 · GET 0 · runtime 호출자 0')
const imports = (p: string) => [...read(p).matchAll(/^import .*$/gm)].map((m) => m[0])
check('gate import', JSON.stringify(imports('src/lib/signup-funnel-gate.ts')) === JSON.stringify([
  "import 'server-only'",
  "import { isSignupFunnelDay } from '@/lib/signup-funnel'",
]))
check('endpoint import', JSON.stringify(imports('src/lib/signup-funnel-endpoint.ts')) === JSON.stringify([
  "import 'server-only'",
  "import { parseAnonymousFunnelPayload, type SignupFunnelKey } from '@/lib/signup-funnel'",
  "import { signupFunnelGate, type SignupFunnelEnv } from '@/lib/signup-funnel-gate'",
]))
check('route import — 인증 · Prisma 싱글턴 · 회원가입 전환 모듈뿐', JSON.stringify(imports('src/app/api/signup-funnel/route.ts')) === JSON.stringify([
  "import { auth } from '@/lib/auth'",
  "import { prisma } from '@/lib/prisma'",
  "import { handleSignupFunnelRequest } from '@/lib/signup-funnel-endpoint'",
  "import { incrementSignupFunnel } from '@/lib/signup-funnel-store'",
]))
const routeSrc = read('src/app/api/signup-funnel/route.ts')
check('route 는 POST 만 내보낸다', /export function POST\(/.test(routeSrc) && !/export (async )?(function|const) (GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(routeSrc))
const gateSrc = read('src/lib/signup-funnel-gate.ts')
const endpointSrc = read('src/lib/signup-funnel-endpoint.ts')
const code = (s: string) => s.replace(/^\s*(\*|\/\/|\/\*\*).*$/gm, '')
check('gate·endpoint 는 시계·env 를 직접 읽지 않는다', !/process\.env|Date\.now|new Date\(\)/.test(code(gateSrc) + code(endpointSrc)))
check('endpoint 에 로그 0', !/console\./.test(endpointSrc + routeSrc))
check('endpoint 에 timer·scroll 0', !/setTimeout|setInterval|addEventListener/.test(endpointSrc + routeSrc))

const srcFiles = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[])
  .map((f) => f.split('\\').join('/'))
  .filter((f) => /\.(ts|tsx)$/.test(f))
// 🔴 API 경로 문자열은 전송 모듈 하나에만 있다(endpoint 는 주석). 화면·온보딩·어드민이 직접 부르지 않는다.
const apiCallers = srcFiles.filter((f) => read(join('src', f)).includes('/api/signup-funnel')).sort()
check('API 경로 문자열은 전송 모듈 하나(+ endpoint 주석)에만 있다', JSON.stringify(apiCallers) === JSON.stringify([
  'lib/signup-funnel-endpoint.ts', 'lib/signup-funnel-send.ts',
]), apiCallers.join(', '))
const endpointImporters = srcFiles.filter((f) => /from '@\/lib\/signup-funnel-(endpoint|gate)'/.test(read(join('src', f)))).sort()
check('gate·endpoint 를 부르는 곳은 route · endpoint · tracking 판정 · ⑤ 가입 완료 · 어드민 reader·계산뿐', JSON.stringify(endpointImporters) === JSON.stringify([
  'app/api/signup-funnel/route.ts', 'lib/queries/signup-funnel.ts', 'lib/signup-completion.ts', 'lib/signup-funnel-admin.ts',
  'lib/signup-funnel-endpoint.ts', 'lib/signup-funnel-tracking.ts',
]), endpointImporters.join(', '))

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
