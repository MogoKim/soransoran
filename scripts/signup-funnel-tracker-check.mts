#!/usr/bin/env tsx
/**
 * 회원가입 전환 tracker 검사 — 요청 단위 세션 공유(D1) · ① logged_out_view · ② prompt_reach · 댓글 슬롯.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §5 · §6-3 · §8-1 · §8-2 · §8-7 · §8-11.
 *
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-funnel-tracker-check.mts
 *
 * 🔴 DB · 인증 서버 · 브라우저에 연결하지 않는다. 세션 getter · 시계 · navigator · fetch · 문서는 대역이다.
 * 🔴 React 컴포넌트는 브라우저로 렌더하지 않는다(DOM 시험 도구가 없다). 판정은 순수 상태 기계와 순수 함수로
 *    두고 그것을 시험하며, 컴포넌트는 그 함수만 부르는지 소스로 고정한다.
 * 🔴 도달 시나리오 묶음은 일부러 망가뜨린 기계에도 돌려 **실패하는지** 확인한다.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { Fragment, type ReactElement } from 'react'

import type { AnonymousFunnelPayload } from '../src/lib/signup-funnel'
import { shouldTrackSignupFunnel, type SignupFunnelEnv } from '../src/lib/signup-funnel-gate'
import {
  REACH_DWELL_MS,
  createReachMachine,
  hasDomConflict,
  type ReachMachine,
  type ReachMachineOptions,
} from '../src/lib/signup-funnel-reach'
import * as BoundaryModule from '../src/components/features/signup-funnel/SignupFunnelBoundary'
import * as TrackerModule from '../src/components/features/signup-funnel/SignupFunnelTracker'

// 🔴 tsx 는 .tsx 를 CJS 로 이어 default 가 한 겹 더 싸여 온다. 함수가 나올 때까지 벗긴다.
function unwrapDefault<T>(mod: unknown): T {
  let m = mod
  while (m && typeof m !== 'function' && typeof m === 'object' && 'default' in m) m = (m as { default: unknown }).default
  return m as T
}
const SignupFunnelBoundary = unwrapDefault<typeof BoundaryModule.default>(BoundaryModule)
const SignupFunnelTracker = unwrapDefault<typeof TrackerModule.default>(TrackerModule)

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (s: string) => s.replace(/^\s*(\*|\/\/|\/\*\*|\{\/\*).*$/gm, '')
const gitShow = (ref: string, p: string) => execFileSync('git', ['show', `${ref}:${p}`], { encoding: 'utf8' })
const BASE = '1e86082fdf37af89f0818ccf438a2f82e8d640fa' // ② 직전
const BEFORE_D1 = 'e52962834a21157e3835b9988d48e7f0e61b374f' // D1 직전

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

const P = {
  session: 'src/lib/request-session.ts',
  tracking: 'src/lib/signup-funnel-tracking.ts',
  header: 'src/components/layouts/HeaderAuth.tsx',
  admin: 'src/lib/admin.ts',
  community: 'src/app/community/[boardSlug]/[postId]/page.tsx',
  magazine: 'src/app/magazine/[slug]/page.tsx',
  boundary: 'src/components/features/signup-funnel/SignupFunnelBoundary.tsx',
  tracker: 'src/components/features/signup-funnel/SignupFunnelTracker.tsx',
  marker: 'src/components/features/signup-funnel/SignupFunnelMarker.tsx',
  commentsEnd: 'src/components/features/signup-funnel/SignupFunnelCommentsEnd.tsx',
  reach: 'src/lib/signup-funnel-reach.ts',
  send: 'src/lib/signup-funnel-send.ts',
  commentSection: 'src/components/features/CommentSection.tsx',
}
const srcFiles = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[])
  .map((f) => f.split('\\').join('/'))
  .filter((f) => /\.(ts|tsx)$/.test(f))

// ─────────── 1. 요청 단위 세션 공유 (D1) ───────────
console.log('\n■ 1. 요청 단위 세션 공유 (D1)')
const cacheDefs = srcFiles.filter((f) => /cache\(\(\) => auth\(\)\)/.test(read(join('src', f))))
check('cache(() => auth()) 정의는 request-session 한 곳', JSON.stringify(cacheDefs) === JSON.stringify(['lib/request-session.ts']), cacheDefs.join(', '))
check('request-session 은 server-only · getter 하나만 내보낸다', /^import 'server-only'/m.test(read(P.session))
  && (read(P.session).match(/^export /gm) ?? []).length === 1
  && read(P.session).includes('export const getRequestSession = cache(() => auth())'))
for (const [name, p] of [['HeaderAuth', P.header], ['커뮤니티 상세', P.community], ['tracking 판정', P.tracking]] as const) {
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
check('관리자 판정 규칙은 한 곳(checkAdminForUser)',
  /export async function checkAdminForUser\(userId: string\)[\s\S]*?prisma\.user\.findUnique[\s\S]*?if \(user\.isAdmin\) return \{ ok: true \}/.test(admin)
  && (admin.match(/prisma\.user\.findUnique/g) ?? []).length === 1)
const authImportersAt = (ref: string) =>
  execFileSync('git', ['grep', '-l', "from '@/lib/auth'", ref, '--', 'src'], { encoding: 'utf8' })
    .split('\n').filter(Boolean).map((l) => l.replace(`${ref}:`, '')).sort()
const before = authImportersAt(BEFORE_D1)
const now = srcFiles.filter((f) => read(join('src', f)).includes("from '@/lib/auth'")).map((f) => `src/${f}`).sort()
check('auth 직접 import: D1 전보다 HeaderAuth·커뮤니티 상세만 빠지고 request-session 하나 늘었다',
  before.length > 0 && JSON.stringify(now) === JSON.stringify([...before.filter((f) => f !== P.header && f !== P.community), P.session].sort()),
  `before=${before.length} now=${now.length}`)

// ─────────── 2. 서버 경계 ───────────
console.log('\n■ 2. 서버 경계 — gate 먼저 · 로그인이면 그리지 않는다 · 요청당 한 번')
const OPEN: SignupFunnelEnv = { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }
const NOW = new Date('2026-10-07T03:00:00.000Z')
async function decide(env: SignupFunnelEnv, session: { user?: unknown } | null | 'throw') {
  let calls = 0
  const result = await shouldTrackSignupFunnel(env, NOW, async () => {
    calls++
    if (session === 'throw') throw new Error('session down')
    return session
  })
  return { result, calls }
}
for (const env of [
  {}, { VERCEL_ENV: 'preview', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }, { VERCEL_ENV: 'production' },
  { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-08' },
] satisfies SignupFunnelEnv[]) {
  const r = await decide(env, null)
  check(`gate 닫힘 ${JSON.stringify(env)}: 그리지 않음 · 세션 판정 0`, r.result === false && r.calls === 0)
}
check('로그인 사용자: 그리지 않음', (await decide(OPEN, { user: { id: 'u1' } })).result === false)
check('로그인되지 않은 방문: 그린다', (await decide(OPEN, null)).result === true)
check('세션 판정 실패: 그리지 않는다', (await decide(OPEN, 'throw')).result === false)
const tracking = read(P.tracking)
check('tracking 판정: React cache 한 번 · env 두 값 · 공유 세션',
  /export const isSignupFunnelTracking = cache\(\(\) =>/.test(tracking)
  && (tracking.match(/process\.env\.[A-Z_]+/g) ?? []).sort().join() === 'process.env.SIGNUP_FUNNEL_COLLECTION_START,process.env.VERCEL_ENV'
  && /new Date\(\),\s*getRequestSession,/.test(tracking))
{
  // 🔴 tsx 는 JSX 를 고전 런타임(React.createElement)으로 바꾼다. 컴포넌트를 함수로 부르는 이 자리에서만 이어 준다.
  ;(globalThis as { React?: unknown }).React = React
  const child = 'CHILD'
  const off = SignupFunnelBoundary({ active: false, contentType: 'community', children: child }) as ReactElement<{ children: unknown }>
  const on = SignupFunnelBoundary({ active: true, contentType: 'magazine', children: child }) as ReactElement<{ children: unknown; contentType: string }>
  check('경계: active=false 면 children 그대로 · client tracker 0', off.type === Fragment && off.props.children === child)
  check('경계: active=true 면 client tracker 로 감싼다', on.type === SignupFunnelTracker && on.props.children === child && on.props.contentType === 'magazine')
}

// ─────────── 3. 화면 연결 ───────────
console.log('\n■ 3. 화면 연결 — 감지 지점 위치')
const community = read(P.community)
const magazine = read(P.magazine)
check('커뮤니티: tracking 은 요청에서 한 번 · 경계가 main 을 감싼다',
  (community.match(/await isSignupFunnelTracking\(\)/g) ?? []).length === 1
  && /<SignupFunnelBoundary active=\{tracking\} contentType="community">\n\s*<main /.test(community)
  && /<\/main>\n\s*<\/SignupFunnelBoundary>/.test(community))
check('커뮤니티: 본문 카드 바로 뒤 body-end 감지 지점',
  /<\/article>\n\s*\{\/\*[^\n]*\*\/\}\n\s*\{tracking \? <SignupFunnelMarker kind="body-end" \/> : null\}/.test(community))
check('커뮤니티: 댓글 끝 감지 지점은 CommentSection 슬롯으로',
  /afterComments=\{tracking \? <SignupFunnelCommentsEnd \/> : undefined\}/.test(community))
check('매거진: tracking 은 요청에서 한 번 · 경계가 main 을 감싼다',
  (magazine.match(/await isSignupFunnelTracking\(\)/g) ?? []).length === 1
  && /<SignupFunnelBoundary active=\{tracking\} contentType="magazine">\n\s*<main /.test(magazine))
{
  const iBody = magazine.indexOf('<MagazineBody article={article} />')
  const iMarker = magazine.indexOf('<SignupFunnelMarker kind="content-end" />')
  const iArticleEnd = magazine.indexOf('</article>')
  const iRelated = magazine.indexOf('<RelatedMagazineList')
  check('매거진: 본문 카드 끝 감지 지점 — MagazineBody 뒤 · </article> 앞 · 연관 글 앞',
    iBody > 0 && iBody < iMarker && iMarker < iArticleEnd && iArticleEnd < iRelated)
  check('매거진: body-end 감지 지점 없음(본문 끝 하나가 기준)', !magazine.includes('kind="body-end"'))
  check('매거진: 감지 지점은 하나', (magazine.match(/<SignupFunnelMarker/g) ?? []).length === 1)
}
check('매거진: auth·세션 직접 판정 추가 0', !/from '@\/lib\/auth'|getRequestSession|\bauth\(\)/.test(magazine))

// ─────────── 4. CommentSection 슬롯 ───────────
console.log('\n■ 4. CommentSection 슬롯 — 공유 파일 최소 변경')
const cs = read(P.commentSection)
const csBase = gitShow(BASE, P.commentSection)
const csWithoutSlot = cs
  .replace("import type { ReactNode } from 'react'\n", '')
  .replace('  likedCommentIds,\n  afterComments,\n}: {', '  likedCommentIds,\n}: {')
  .replace(/\n  \/\*\*\n   \* 공개 댓글·답글 목록 바로 뒤[\s\S]*?\*\/\n  afterComments\?: ReactNode/, '')
  .replace('\n          {afterComments}\n', '')
check('슬롯 추가분을 빼면 이전 CommentSection 과 글자 그대로 같다(슬롯 없으면 출력·동작 불변)', csWithoutSlot === csBase)
{
  const iList = cs.indexOf('<SortableCommentList')
  const iEmpty = cs.indexOf('아직 댓글이 없어요')
  const iSlot = cs.indexOf('{afterComments}')
  const iAnchor = cs.indexOf('<CommentComposeAnchor')
  const iProvider = cs.indexOf('<ComposeModeProvider>')
  const iProviderEnd = cs.indexOf('</ComposeModeProvider>')
  check('슬롯은 목록·빈 상태 뒤 · 입력창 앞 · 작성 모드 provider 안',
    iList > 0 && iEmpty > 0 && iList < iSlot && iEmpty < iSlot && iSlot < iAnchor && iProvider < iSlot && iSlot < iProviderEnd)
  check('슬롯은 감싸는 DOM 없이 그대로 놓인다', /\n {10}\{afterComments\}\n/.test(cs))
}
check('CommentSection 의 회원가입 전환 import 0', !/signup-funnel/i.test(cs))
const sharedUnchanged = [
  'src/components/features/ComposeModeProvider.tsx', 'src/components/features/ReplyForm.tsx',
  'src/components/features/CommentEditor.tsx', 'src/components/features/GuestCommentControls.tsx',
  'src/components/features/CommentComposeAnchor.tsx', 'src/components/features/ThreadReplies.tsx',
  'src/components/features/CommentThread.tsx', 'src/components/features/SortableCommentList.tsx',
  'src/components/features/ThreadNavProvider.tsx',
].filter((p) => read(p) !== gitShow(BASE, p))
check('그 밖의 공유 댓글 파일 변경 0', sharedUnchanged.length === 0, sharedUnchanged.join(', '))

// ─────────── 5. ② 도달 상태 기계 ───────────
console.log('\n■ 5. ② 도달 — 1초 연속 · 취소 · 오염 · 한 번')
type Task = { id: number; at: number; fn: () => void }
function fakeClock() {
  let t = 0
  let seq = 0
  let tasks: Task[] = []
  let maxActive = 0
  return {
    set(fn: () => void, ms: number) {
      const task = { id: ++seq, at: t + ms, fn }
      tasks.push(task)
      maxActive = Math.max(maxActive, tasks.length)
      return task.id
    },
    clear(id: unknown) { tasks = tasks.filter((x) => x.id !== id) },
    advance(ms: number) {
      const end = t + ms
      for (;;) {
        const next = tasks.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        tasks = tasks.filter((x) => x !== next)
        t = next.at
        next.fn()
      }
      t = end
    },
    active: () => tasks.length,
    maxActive: () => maxActive,
  }
}
type Factory = (o: ReachMachineOptions) => ReachMachine
type Rig = { m: ReachMachine; clock: ReturnType<typeof fakeClock>; reached: () => number; dom: { conflict: boolean }; pendingFlips: boolean[] }
function rig(factory: Factory, requireBodyEnd: boolean): Rig {
  const clock = fakeClock()
  const dom = { conflict: false }
  let reached = 0
  const pendingFlips: boolean[] = []
  const m = factory({
    requireBodyEnd,
    domConflict: () => dom.conflict,
    onReach: () => { reached++ },
    onPendingChange: (p) => { pendingFlips.push(p) },
    setTimer: (fn, ms) => clock.set(fn, ms),
    clearTimer: (h) => clock.clear(h),
  })
  return { m, clock, reached: () => reached, dom, pendingFlips }
}

function reachFailures(factory: Factory): string[] {
  const f: string[] = []
  const expect = (name: string, ok: boolean) => { if (!ok) f.push(name) }
  { // 본문 끝 전에는 0
    const r = rig(factory, true)
    r.m.contentEnd(true); r.clock.advance(5000)
    expect('커뮤니티: 본문 끝 관측 전 댓글 끝만 보이면 0', r.reached() === 0)
    r.m.bodyEndSeen(); r.clock.advance(REACH_DWELL_MS - 1)
    expect('커뮤니티: 본문 관측 뒤 999ms 는 0', r.reached() === 0)
    r.clock.advance(1)
    expect('커뮤니티: 본문 관측 뒤 1000ms 연속이면 1', r.reached() === 1)
  }
  { // 정상 순서
    const r = rig(factory, true)
    r.m.bodyEndSeen(); r.m.contentEnd(true); r.clock.advance(999)
    expect('999ms 0', r.reached() === 0)
    r.clock.advance(1)
    expect('1000ms 1', r.reached() === 1)
    r.m.contentEnd(false); r.m.contentEnd(true); r.clock.advance(5000)
    expect('같은 mount 재관측 추가 0', r.reached() === 1)
  }
  { // 나갔다 들어오면 처음부터
    const r = rig(factory, true)
    r.m.bodyEndSeen(); r.m.contentEnd(true); r.clock.advance(600)
    r.m.contentEnd(false); r.clock.advance(100); r.m.contentEnd(true); r.clock.advance(999)
    expect('나갔다 들어오면 다시 1초 — 999ms 0', r.reached() === 0)
    r.clock.advance(1)
    expect('나갔다 들어온 뒤 1000ms 1', r.reached() === 1)
  }
  { // 답글 펼침으로 밀려남
    const r = rig(factory, true)
    r.m.bodyEndSeen(); r.m.contentEnd(true); r.clock.advance(500)
    r.m.contentEnd(false); r.clock.advance(5000)
    expect('답글 펼침으로 밀려나면 취소', r.reached() === 0 && r.clock.active() === 0)
  }
  { // 매거진
    const r = rig(factory, false)
    r.m.contentEnd(true); r.clock.advance(999)
    expect('매거진 999ms 0', r.reached() === 0)
    r.clock.advance(1)
    expect('매거진 본문 카드 끝 1000ms 1', r.reached() === 1)
  }
  { // 시작 전 DOM 충돌 → 닫혀도 재진입 전 0
    const r = rig(factory, false)
    r.dom.conflict = true
    r.m.contentEnd(true); r.clock.advance(2000)
    r.dom.conflict = false; r.m.domChanged(); r.clock.advance(5000)
    expect('시작 전 충돌: 닫혀도 재진입 전 0', r.reached() === 0)
    r.m.contentEnd(false); r.m.contentEnd(true); r.clock.advance(1000)
    expect('시작 전 충돌: 재진입 뒤 1000ms 1', r.reached() === 1)
  }
  { // 도중 작성 폼 열림
    const r = rig(factory, true)
    r.m.bodyEndSeen(); r.m.contentEnd(true); r.clock.advance(400)
    r.m.composeConflict(true); r.clock.advance(2000)
    expect('도중 답글·수정 폼 열림: 0', r.reached() === 0 && r.clock.active() === 0)
    r.m.composeConflict(false); r.clock.advance(5000)
    expect('폼이 닫혀도 재진입 전 0', r.reached() === 0)
    r.m.contentEnd(false); r.m.contentEnd(true); r.clock.advance(1000)
    expect('폼 닫힌 뒤 재진입 1000ms 1', r.reached() === 1)
  }
  { // 초점 없이 폼이 열린 채로 들어옴
    const r = rig(factory, true)
    r.m.bodyEndSeen(); r.m.composeConflict(true)
    r.m.contentEnd(true); r.clock.advance(3000)
    expect('폼이 열린 채(초점 무관) 들어오면 0', r.reached() === 0)
    r.m.composeConflict(false); r.clock.advance(3000)
    expect('폼이 닫혀도 같은 보임 구간은 0', r.reached() === 0)
    r.m.contentEnd(false); r.m.contentEnd(true); r.clock.advance(1000)
    expect('재진입 뒤 1', r.reached() === 1)
  }
  { // 도중 DOM 충돌
    const r = rig(factory, false)
    r.m.contentEnd(true); r.clock.advance(300)
    r.dom.conflict = true; r.m.domChanged(); r.clock.advance(3000)
    expect('도중 modal·menu·초점: 0', r.reached() === 0 && r.clock.active() === 0)
  }
  { // 완료 순간 충돌
    const r = rig(factory, false)
    r.m.contentEnd(true); r.clock.advance(999)
    r.dom.conflict = true; r.clock.advance(1)
    expect('완료 순간 충돌이면 0', r.reached() === 0)
  }
  { // dispose
    const r = rig(factory, true)
    r.m.bodyEndSeen(); r.m.contentEnd(true); r.clock.advance(500)
    r.m.dispose(); r.clock.advance(5000)
    r.m.contentEnd(false); r.m.contentEnd(true); r.m.bodyEndSeen(); r.clock.advance(5000)
    expect('unmount 뒤 timer·관측 동작 0', r.reached() === 0 && r.clock.active() === 0)
    expect('대기 손잡이는 열고 닫힘이 짝', r.pendingFlips.filter(Boolean).length === r.pendingFlips.filter((x) => !x).length)
  }
  { // pending 최대 하나
    const r = rig(factory, true)
    r.m.bodyEndSeen()
    for (let i = 0; i < 5; i++) { r.m.contentEnd(true); r.m.bodyEndSeen(); r.m.composeConflict(false); r.clock.advance(100) }
    expect('pending timer 는 최대 하나', r.clock.maxActive() <= 1)
  }
  return f
}

const real: Factory = createReachMachine
const realFailures = reachFailures(real)
check('② 도달 시나리오 묶음 전부 통과', realFailures.length === 0, realFailures.join(' · '))

const mutants: Array<[string, Factory]> = [
  ['본문 끝 조건을 무시한다', (o) => createReachMachine({ ...o, requireBodyEnd: false })],
  ['999ms 에 완료한다', (o) => createReachMachine({ ...o, dwellMs: 999 })],
  ['감지 지점이 나가도 취소하지 않는다', (o) => {
    const m = createReachMachine(o)
    return { ...m, contentEnd: (v) => { if (v) m.contentEnd(true) } }
  }],
  ['작성 폼 열림을 무시한다', (o) => ({ ...createReachMachine(o), composeConflict: () => {} })],
  ['DOM 충돌을 보지 않는다', (o) => createReachMachine({ ...o, domConflict: () => false })],
  ['완료 뒤에도 다시 알린다', (o) => {
    let m = createReachMachine(o)
    const reset = () => { m = createReachMachine(o) }
    return {
      bodyEndSeen: () => m.bodyEndSeen(),
      contentEnd: (v) => { if (!v) reset(); m.contentEnd(v) },
      composeConflict: (x) => m.composeConflict(x),
      domChanged: () => m.domChanged(),
      dispose: () => m.dispose(),
    }
  }],
]
for (const [name, factory] of mutants) check(`변이 잡음: ${name}`, reachFailures(factory).length > 0)

// ─────────── 6. DOM 충돌 판정 ───────────
console.log('\n■ 6. DOM 충돌 — 공개 의미만')
const SELECTORS = {
  modal: '[role="dialog"][aria-modal="true"]',
  alert: '[role="alertdialog"]',
  dialog: 'dialog[open]',
  menu: '[role="menu"]',
  popover: '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]',
}
function doc(present: string[], active: unknown = null) {
  return { querySelector: (sel: string) => (sel.split(', ').some((s) => present.includes(s)) ? {} : null), activeElement: active }
}
for (const [name, sel] of Object.entries(SELECTORS)) check(`충돌: ${name}`, hasDomConflict(doc([sel])))
check('충돌 없음', !hasDomConflict(doc([])))
check('답글 「더 보기·접기」 의 aria-expanded 만으로는 충돌이 아니다(aria-haspopup 필요)',
  !hasDomConflict(doc(['[aria-expanded="true"]'])))
for (const [name, el] of [
  ['textarea', { tagName: 'TEXTAREA' }], ['text input', { tagName: 'INPUT', type: 'text' }],
  ['password input', { tagName: 'INPUT', type: 'password' }], ['select', { tagName: 'SELECT' }],
  ['iframe(Turnstile)', { tagName: 'IFRAME' }], ['contenteditable', { tagName: 'DIV', isContentEditable: true }],
] as const) check(`작성 초점: ${name}`, hasDomConflict(doc([], el)))
for (const [name, el] of [
  ['button', { tagName: 'BUTTON' }], ['checkbox', { tagName: 'INPUT', type: 'checkbox' }],
  ['hidden', { tagName: 'INPUT', type: 'hidden' }], ['body', { tagName: 'BODY' }], ['링크', { tagName: 'A' }],
] as const) check(`작성 초점 아님: ${name}`, !hasDomConflict(doc([], el)))

// ─────────── 7. ① · 전송 ───────────
// 🔴 navigator 접근을 세기 위해 전송 모듈을 여기서 처음 import 한다.
console.log('\n■ 7. ① mount 1회 · 전송 계약')
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
let navigatorReads = 0
let beaconImpl: ((url: string, body: string) => boolean) | null = null
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  get() { navigatorReads++; return beaconImpl ? { sendBeacon: beaconImpl } : undefined },
})
const realFetch = globalThis.fetch
const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = []
globalThis.fetch = ((url: string, init?: RequestInit) => {
  fetchCalls.push({ url, init })
  return Promise.reject(new Error('net down'))
}) as typeof fetch
const send = await import('../src/lib/signup-funnel-send')
check('전송 모듈 import 만으로 브라우저 API 호출 0', navigatorReads === 0)
{
  const sent: AnonymousFunnelPayload[] = []
  const record = (p: AnonymousFunnelPayload) => { sent.push(p) }
  const view = { sent: false }
  const reach = { sent: false }
  const v: AnonymousFunnelPayload = { step: 'logged_out_view', contentType: 'community', entryPoint: 'content_end' }
  const r: AnonymousFunnelPayload = { step: 'prompt_reach', contentType: 'community', entryPoint: 'content_end' }
  send.sendOncePerMount(view, v, record); send.sendOncePerMount(view, v, record)
  send.sendOncePerMount(reach, r, record); send.sendOncePerMount(reach, r, record)
  check('같은 mount: ① 1회 · ② 1회 (effect 재실행·rerender 추가 0)', sent.length === 2 && sent[0] === v && sent[1] === r)
  send.sendOncePerMount({ sent: false }, r, record)
  check('새 mount 는 새 ② 가능', sent.length === 3)
}
const beacons: Array<{ url: string; body: string }> = []
beaconImpl = (url, body) => { beacons.push({ url, body }); return true }
send.sendAnonymousFunnelEvent({ step: 'prompt_reach', contentType: 'community', entryPoint: 'content_end', postId: 'p', slug: 's', path: '/x' } as AnonymousFunnelPayload)
check('body 는 세 값뿐 · 상대 경로', beacons[0]?.url === '/api/signup-funnel'
  && beacons[0]?.body === JSON.stringify({ step: 'prompt_reach', contentType: 'community', entryPoint: 'content_end' }))
let unhandled = 0
const onUnhandled = () => { unhandled++ }
process.on('unhandledRejection', onUnhandled)
let threw = false
beaconImpl = () => { throw new Error('boom') }
try { send.sendAnonymousFunnelEvent({ step: 'prompt_reach', contentType: 'community', entryPoint: 'content_end' }) } catch { threw = true }
beaconImpl = null
try { send.sendAnonymousFunnelEvent({ step: 'prompt_reach', contentType: 'community', entryPoint: 'content_end' }) } catch { threw = true }
await new Promise((r) => setTimeout(r, 20))
process.off('unhandledRejection', onUnhandled)
check('전송 실패: 예외 0 · unhandled 0 · keepalive fetch 1회 · 재시도 0', !threw && unhandled === 0 && fetchCalls.length === 1 && fetchCalls[0].init?.keepalive === true)
if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
globalThis.fetch = realFetch

// ─────────── 8. 소스 계약 ───────────
console.log('\n■ 8. 소스 계약 — observer · listener · storage · 개인정보 · 레거시')
const tracker = read(P.tracker)
const trackerCode = code(tracker)
check('tracker: use client · ①②가 각자 ref guard 와 sendOncePerMount',
  tracker.startsWith("'use client'") && /const viewGuard = useRef\(\{ sent: false \}\)/.test(tracker)
  && /const reachGuard = useRef\(\{ sent: false \}\)/.test(tracker)
  && /sendOncePerMount\(viewGuard\.current, \{ step: 'logged_out_view', contentType, entryPoint: 'content_end' \}\)/.test(tracker)
  && /sendOncePerMount\(reachGuard\.current, \{ step: 'prompt_reach', contentType, entryPoint: 'content_end' \}\)/.test(tracker))
check('tracker: IntersectionObserver 없으면 ② 설정을 하지 않는다', /if \(typeof IntersectionObserver === 'undefined'\) return/.test(tracker))
check('tracker: 커뮤니티만 본문 끝 먼저', /requireBodyEnd: contentType === 'community'/.test(tracker))
check('tracker: cleanup 에서 observer 해제 · 기계 dispose', /return \(\) => \{\s*observer\.disconnect\(\)\s*machine\.dispose\(\)/.test(tracker))
check('tracker: MutationObserver·focusin 은 대기 중에만 붙이고 떼어 낸다',
  (trackerCode.match(/new MutationObserver/g) ?? []).length === 1
  && (trackerCode.match(/addEventListener\('focusin', onFocusChange, true\)/g) ?? []).length === 1
  && (trackerCode.match(/removeEventListener\('focusin', onFocusChange, true\)/g) ?? []).length === 1
  && /if \(pending\) \{[\s\S]*?watcher\.observe[\s\S]*?\} else \{[\s\S]*?watcher\?\.disconnect\(\)/.test(tracker))
for (const [name, p] of [['tracker', P.tracker], ['감지 지점', P.marker], ['댓글 끝', P.commentsEnd], ['도달 기계', P.reach], ['경계', P.boundary], ['전송', P.send]] as const) {
  // 🔴 tracker 의 localStorage 는 가입 제안 저장 모듈에 넘길 손잡이 하나(browserStorage)뿐이다 — 직접 읽고 쓰지 않는다
  const s = code(read(p)).replace('return window.localStorage\n', '')
  check(`${name}: scroll listener·interval·storage·cookie 0`, !/addEventListener\('scroll'|onscroll|setInterval|localStorage|sessionStorage|document\.cookie|getItem|setItem/.test(s))
  check(`${name}: 콘텐츠 경로·ID·slug·사용자 값 0`, !/postId|slug|pathname|location\.|userId|session\.user|email|nickname/.test(s))
}
check('도달 기계는 window·document·setTimeout 을 직접 부르지 않는다', !/\bwindow\.|\bdocument\.|setTimeout\(/.test(code(read(P.reach))))
const marker = read(P.marker)
check('감지 지점: 높이 0 · aria-hidden · 클래스 없음 · tracker 밖이면 null',
  /return <div ref=\{ref\} aria-hidden \/>/.test(marker) && /if \(!tracker\) return null/.test(marker) && !/className/.test(marker))
const commentsEnd = read(P.commentsEnd)
check('댓글 끝: otherComposerOpen 을 읽기만 · 새 상태·이벤트 0',
  /const \{ otherComposerOpen \} = useComposeMode\(\)/.test(commentsEnd) && /composeConflict\?\.\(otherComposerOpen\)/.test(commentsEnd)
  && !/setOpenParentId|registerComposer|useComposeLock|useState|dispatchEvent/.test(commentsEnd))
const allSrc = srcFiles.map((f) => read(join('src', f))).join('\n')
check('prompt_impression 은 단계 정의 · tracker 의 ③ 전송 · 어드민 단계 이름표에만 있다', JSON.stringify(srcFiles.filter((f) => read(join('src', f)).includes('prompt_impression')).sort())
  === JSON.stringify(['components/features/signup-funnel/SignupFunnelTracker.tsx', 'lib/signup-funnel-admin.ts', 'lib/signup-funnel.ts']))
check('dialog 마크업은 가입 제안 dialog 파일 하나에만 있다(tracker·감지 지점·경계 0)', !/role="dialog"/.test([P.tracker, P.marker, P.commentsEnd, P.boundary].map(read).join('\n')))
const legacy = srcFiles.filter((f) => read(join('src', f)).includes('LoggedOutView'))
  .concat((readdirSync(join(ROOT, 'scripts')) as string[]).filter((f) => f !== 'signup-funnel-tracker-check.mts' && f.startsWith('signup-funnel') && read(join('scripts', f)).includes('LoggedOutView')))
check('대체된 LoggedOutView 파일·import·주석 0', legacy.length === 0 && !allSrc.includes('shouldTrackLoggedOutView'), legacy.join(', '))
const imports = (p: string) => [...read(p).matchAll(/^import .*$/gm)].map((m) => m[0])
const expectImports: Array<[string, string[]]> = [
  [P.tracking, ["import 'server-only'", "import { cache } from 'react'", "import { shouldTrackSignupFunnel } from '@/lib/signup-funnel-gate'", "import { getRequestSession } from '@/lib/request-session'"]],
  [P.reach, []],
  [P.boundary, ["import type { ReactNode } from 'react'", "import type { SignupFunnelContentType } from '@/lib/signup-funnel'", "import SignupFunnelTracker from '@/components/features/signup-funnel/SignupFunnelTracker'"]],
  [P.commentsEnd, ["import { useEffect } from 'react'", "import { useComposeMode } from '@/components/features/ComposeModeProvider'", "import SignupFunnelMarker from '@/components/features/signup-funnel/SignupFunnelMarker'", "import { useSignupFunnelTracker } from '@/components/features/signup-funnel/SignupFunnelTracker'"]],
]
for (const [p, list] of expectImports) check(`import 목록 고정(D100 0): ${p}`, JSON.stringify(imports(p)) === JSON.stringify(list), imports(p).join(' | '))
check('client 쪽은 server 모듈을 값으로 import 하지 않는다',
  !/from '@\/lib\/(signup-funnel-gate|signup-funnel-store|signup-funnel-endpoint|signup-funnel-tracking|request-session|auth|prisma)'/.test([P.tracker, P.marker, P.commentsEnd, P.send, P.reach].map(read).join('\n')))

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
