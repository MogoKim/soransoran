#!/usr/bin/env tsx
/**
 * 회원가입 전환 ① logged_out_view · 요청 단위 세션 공유(D1) 검사.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-2 · §8-7 · §8-11.
 *
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-funnel-view-check.mts
 *
 * 🔴 DB · 인증 서버 · 브라우저에 연결하지 않는다. 세션 getter · navigator · fetch 는 호출 기록 대역이다.
 * 🔴 React 컴포넌트는 렌더하지 않는다(DOM 시험 도구가 없다). 판정은 순수 함수로 두고 그 함수를 시험하며,
 *    컴포넌트는 그 함수만 부르는지 소스로 고정한다.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AnonymousFunnelPayload } from '../src/lib/signup-funnel'
import { shouldTrackLoggedOutView, type SignupFunnelEnv } from '../src/lib/signup-funnel-gate'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (s: string) => s.replace(/^\s*(\*|\/\/|\/\*\*|\{\/\*).*$/gm, '')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

const P = {
  session: 'src/lib/request-session.ts',
  header: 'src/components/layouts/HeaderAuth.tsx',
  admin: 'src/lib/admin.ts',
  community: 'src/app/community/[boardSlug]/[postId]/page.tsx',
  magazine: 'src/app/magazine/[slug]/page.tsx',
  tracker: 'src/components/features/signup-funnel/LoggedOutViewTracker.tsx',
  beacon: 'src/components/features/signup-funnel/LoggedOutViewBeacon.tsx',
  send: 'src/lib/signup-funnel-send.ts',
}

// ─────────── 1. 세션 공유 ───────────
console.log('\n■ 1. 요청 단위 세션 공유 (D1)')
const srcFiles = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[])
  .map((f) => f.split('\\').join('/'))
  .filter((f) => /\.(ts|tsx)$/.test(f))
const cacheDefs = srcFiles.filter((f) => /cache\(\(\) => auth\(\)\)/.test(read(join('src', f))))
check('cache(() => auth()) 정의는 request-session 한 곳', JSON.stringify(cacheDefs) === JSON.stringify(['lib/request-session.ts']), cacheDefs.join(', '))
check('request-session 은 server-only · getter 하나만 내보낸다', /^import 'server-only'/m.test(read(P.session))
  && (read(P.session).match(/^export /gm) ?? []).length === 1
  && read(P.session).includes('export const getRequestSession = cache(() => auth())'))
for (const [name, p] of [['HeaderAuth', P.header], ['커뮤니티 상세', P.community], ['① 서버 tracker', P.tracker]] as const) {
  const s = read(p)
  check(`${name}: getRequestSession 사용 · auth 직접 import·호출 0`,
    s.includes("import { getRequestSession } from '@/lib/request-session'")
    && !s.includes("from '@/lib/auth'") && !/\bauth\(\)/.test(code(s)))
}
const header = read(P.header)
check('HeaderAuth 관리자 판정은 이미 읽은 세션 id 로 — requireAdmin(재 auth) 0',
  /checkAdminForUser\(session\.user\.id\)/.test(header) && !/requireAdmin/.test(header))
const admin = read(P.admin)
check('requireAdmin 은 여전히 auth() 를 직접 읽고 같은 판정 함수를 지난다',
  /export async function requireAdmin\(\)[\s\S]*?const session = await auth\(\)[\s\S]*?return checkAdminForUser\(userId\)\n\}/.test(admin))
check('관리자 판정 규칙은 한 곳(checkAdminForUser) — isAdmin · allowlist 그대로',
  /export async function checkAdminForUser\(userId: string\)[\s\S]*?prisma\.user\.findUnique[\s\S]*?if \(user\.isAdmin\) return \{ ok: true \}[\s\S]*?allowlist\.has\(user\.email\.toLowerCase\(\)\)/.test(admin)
  && (admin.match(/prisma\.user\.findUnique/g) ?? []).length === 1)

// 다른 경로의 인증 동작은 그대로 — auth 를 직접 import 하는 파일 집합이 정확히 두 개 줄고 하나 늘었다
const authImportersAt = (ref: string) => {
  try {
    return execFileSync('git', ['grep', '-l', "from '@/lib/auth'", ref, '--', 'src'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).map((l) => l.replace(`${ref}:`, '')).sort()
  } catch { return [] }
}
const before = authImportersAt('e52962834a21157e3835b9988d48e7f0e61b374f')
const now = srcFiles.filter((f) => read(join('src', f)).includes("from '@/lib/auth'")).map((f) => `src/${f}`).sort()
const expected = [...before.filter((f) => f !== P.header && f !== P.community), P.session].sort()
check('auth 직접 import 파일: HeaderAuth·커뮤니티 상세만 빠지고 request-session 하나 늘었다(다른 action·admin 경로 그대로)',
  before.length > 0 && JSON.stringify(now) === JSON.stringify(expected),
  `before=${before.length} now=${now.length}`)

// ─────────── 2. 서버 경계 판정 ───────────
console.log('\n■ 2. ① 서버 경계 — gate 먼저 · 로그인이면 그리지 않는다')
const OPEN: SignupFunnelEnv = { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }
const NOW = new Date('2026-10-07T03:00:00.000Z')
async function decide(env: SignupFunnelEnv, session: { user?: unknown } | null | 'throw') {
  let calls = 0
  const result = await shouldTrackLoggedOutView(env, NOW, async () => {
    calls++
    if (session === 'throw') throw new Error('session down')
    return session
  })
  return { result, calls }
}
for (const env of [
  {}, { VERCEL_ENV: 'preview', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }, { VERCEL_ENV: 'production' },
  { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-08' }, { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: 'garbage' },
] satisfies SignupFunnelEnv[]) {
  const r = await decide(env, null)
  check(`gate 닫힘 ${JSON.stringify(env)}: 그리지 않음 · 세션 판정 0`, r.result === false && r.calls === 0)
}
{
  const r = await decide(OPEN, { user: { id: 'u1' } })
  check('로그인 사용자: 그리지 않음 (세션 판정 1)', r.result === false && r.calls === 1)
}
{
  const r = await decide(OPEN, null)
  check('로그인되지 않은 방문: 그린다 (세션 판정 1)', r.result === true && r.calls === 1)
}
{
  const r = await decide(OPEN, {})
  check('user 없는 세션 객체: 그린다', r.result === true)
}
{
  const r = await decide(OPEN, 'throw')
  check('세션 판정 실패: 로그아웃으로 단정하지 않고 그리지 않는다', r.result === false)
}
const tracker = read(P.tracker)
check('서버 tracker: 판정 false 면 null · true 일 때만 beacon',
  /if \(!track\) return null\n\s*return <LoggedOutViewBeacon contentType=\{contentType\} \/>/.test(tracker))
check('서버 tracker: env 는 두 값만 명시해 넘긴다',
  (tracker.match(/process\.env\.[A-Z_]+/g) ?? []).sort().join() === 'process.env.SIGNUP_FUNNEL_COLLECTION_START,process.env.VERCEL_ENV')
check('서버 tracker: 공유 세션 getter 를 그대로 넘긴다', /new Date\(\),\s*getRequestSession,/.test(tracker))
check('서버 tracker: DB·store·저장 import 0', !/prisma|signup-funnel-store|signup-funnel-endpoint/.test(tracker))

// ─────────── 3. 연결 ───────────
console.log('\n■ 3. 상세 화면 연결')
const community = read(P.community)
const magazine = read(P.magazine)
check('커뮤니티 상세: contentType=community 로 한 번', (community.match(/<LoggedOutViewTracker contentType="community" \/>/g) ?? []).length === 1
  && (community.match(/<LoggedOutViewTracker/g) ?? []).length === 1)
check('매거진 상세: contentType=magazine 으로 한 번', (magazine.match(/<LoggedOutViewTracker contentType="magazine" \/>/g) ?? []).length === 1
  && (magazine.match(/<LoggedOutViewTracker/g) ?? []).length === 1)
check('매거진 상세: auth·세션 직접 판정 추가 0', !/from '@\/lib\/auth'|getRequestSession|\bauth\(\)/.test(magazine))
const trackerUsers = srcFiles.filter((f) => read(join('src', f)).includes('LoggedOutViewTracker')).sort()
check('tracker 를 그리는 곳은 두 상세 화면뿐', JSON.stringify(trackerUsers) === JSON.stringify([
  'app/community/[boardSlug]/[postId]/page.tsx', 'app/magazine/[slug]/page.tsx', 'components/features/signup-funnel/LoggedOutViewTracker.tsx',
]), trackerUsers.join(', '))

// ─────────── 4. mount 1회 ───────────
// 🔴 navigator 접근을 세기 위해 전송 모듈을 여기서 처음 import 한다 — import 만으로 브라우저 API 를 부르면 잡힌다.
console.log('\n■ 4. mount 1회 · 전송 계약')
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
let navigatorReads = 0
let beaconImpl: ((url: string, body: string) => boolean) | null = null
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get() {
    navigatorReads++
    return beaconImpl ? { sendBeacon: beaconImpl } : undefined
  },
})
const realFetch = globalThis.fetch
type FetchCall = { url: string; init: RequestInit | undefined }
let fetchCalls: FetchCall[] = []
let fetchBehavior: 'ok' | 'reject' = 'ok'
globalThis.fetch = ((url: string, init?: RequestInit) => {
  fetchCalls.push({ url, init })
  return fetchBehavior === 'ok' ? Promise.resolve(new Response(null, { status: 204 })) : Promise.reject(new Error('net down'))
}) as typeof fetch

const send = await import('../src/lib/signup-funnel-send')
check('전송 모듈 import 만으로 브라우저 API 호출 0', navigatorReads === 0)

const beacons: Array<{ url: string; body: string }> = []
beaconImpl = (url, body) => { beacons.push({ url, body }); return true }
const payload: AnonymousFunnelPayload = { step: 'logged_out_view', contentType: 'magazine', entryPoint: 'content_end' }

{
  const sent: AnonymousFunnelPayload[] = []
  const guard = { sent: false }
  const record = (p: AnonymousFunnelPayload) => { sent.push(p) }
  send.sendOncePerMount(guard, payload, record) // mount effect
  send.sendOncePerMount(guard, payload, record) // StrictMode effect 재실행 (같은 ref)
  send.sendOncePerMount(guard, payload, record) // rerender 뒤 effect (같은 ref)
  check('같은 mount(guard) 의 effect 재실행·rerender: 전송 1회', sent.length === 1 && sent[0] === payload)
  const nextMount = { sent: false }
  send.sendOncePerMount(nextMount, payload, record)
  check('새 mount(새로고침·새 탭): 새 방문으로 1회 더', sent.length === 2)
}

send.sendAnonymousFunnelEvent({ ...payload, postId: 'p1', slug: 's', path: '/x', userId: 'u' } as AnonymousFunnelPayload)
const b = beacons.at(-1)
const parsed = b ? (JSON.parse(b.body) as Record<string, unknown>) : {}
check('sendBeacon 로 상대 경로 /api/signup-funnel', b?.url === '/api/signup-funnel')
check('body 는 세 값뿐 — 섞여 들어온 ID·slug·path·사용자 값이 나가지 않는다',
  JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify(['contentType', 'entryPoint', 'step'])
  && JSON.stringify(parsed) === JSON.stringify({ step: 'logged_out_view', contentType: 'magazine', entryPoint: 'content_end' }))
check('sendBeacon 성공이면 fetch 0', fetchCalls.length === 0)

beaconImpl = () => false
send.sendAnonymousFunnelEvent(payload)
check('sendBeacon 거절 시 keepalive fetch 1회 · 기다리지 않음',
  fetchCalls.length === 1 && fetchCalls[0].url === '/api/signup-funnel' && fetchCalls[0].init?.keepalive === true && fetchCalls[0].init?.method === 'POST')

fetchCalls = []
fetchBehavior = 'reject'
let unhandled = 0
const onUnhandled = () => { unhandled++ }
process.on('unhandledRejection', onUnhandled)
beaconImpl = () => { throw new Error('beacon boom') }
let threw = false
try { send.sendAnonymousFunnelEvent(payload) } catch { threw = true }
beaconImpl = null
try { send.sendAnonymousFunnelEvent(payload) } catch { threw = true }
await new Promise((r) => setTimeout(r, 20))
process.off('unhandledRejection', onUnhandled)
check('sendBeacon 예외 · navigator 없음 · fetch 실패: 예외 0 · unhandled rejection 0', !threw && unhandled === 0)
check('sendBeacon 없음: fetch 로 1회 · 재시도 0', fetchCalls.length === 1)

if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
globalThis.fetch = realFetch

// ─────────── 5. 소스 계약 ───────────
console.log('\n■ 5. 소스 계약 — storage·timer·listener 0 · 개인정보 0 · D100 import 0')
const beacon = read(P.beacon)
const sendSrc = read(P.send)
check('beacon: use client · ref guard · effect 에서 sendOncePerMount 만',
  beacon.startsWith("'use client'") && /const guard = useRef\(\{ sent: false \}\)/.test(beacon)
  && /useEffect\(\(\) => \{\s*sendOncePerMount\(guard\.current, \{ step: 'logged_out_view', contentType, entryPoint: 'content_end' \}\)\s*\}, \[contentType\]\)/.test(beacon))
for (const [name, s] of [['beacon', beacon], ['전송 모듈', sendSrc], ['서버 tracker', tracker]] as const) {
  check(`${name}: storage·cookie·timer·listener·scroll 0`, !/localStorage|sessionStorage|document\.cookie|setTimeout|setInterval|addEventListener|onscroll|IntersectionObserver/.test(code(s)))
  check(`${name}: 콘텐츠 경로·ID·slug·사용자 값 0`, !/postId|slug|pathname|location\.|userId|session\.user|email|nickname/.test(code(s).replace(/getRequestSession/g, '')))
}
check('beacon·tracker props 는 contentType 하나', /\{ contentType \}: \{ contentType: SignupFunnelContentType \}/.test(beacon)
  && /\{ contentType \}: \{ contentType: SignupFunnelContentType \}/.test(tracker))
const imports = (p: string) => [...read(p).matchAll(/^import .*$/gm)].map((m) => m[0])
const expectImports: Array<[string, string[]]> = [
  [P.session, ["import 'server-only'", "import { cache } from 'react'", "import { auth } from '@/lib/auth'"]],
  [P.send, ["import type { AnonymousFunnelPayload } from '@/lib/signup-funnel'"]],
  [P.beacon, ["import { useEffect, useRef } from 'react'", "import type { SignupFunnelContentType } from '@/lib/signup-funnel'", "import { sendOncePerMount } from '@/lib/signup-funnel-send'"]],
  [P.tracker, [
    "import type { SignupFunnelContentType } from '@/lib/signup-funnel'",
    "import { shouldTrackLoggedOutView } from '@/lib/signup-funnel-gate'",
    "import { getRequestSession } from '@/lib/request-session'",
    "import LoggedOutViewBeacon from '@/components/features/signup-funnel/LoggedOutViewBeacon'",
  ]],
]
for (const [p, list] of expectImports) check(`import 목록 고정(D100 0): ${p}`, JSON.stringify(imports(p)) === JSON.stringify(list), imports(p).join(' | '))
check('client 쪽(beacon·전송)은 server 모듈을 값으로 import 하지 않는다',
  !/from '@\/lib\/(signup-funnel-gate|signup-funnel-store|signup-funnel-endpoint|request-session|auth|prisma)'/.test(beacon + sendSrc))

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
