#!/usr/bin/env tsx
/**
 * 가입 제안 인증 왕복 복귀(D2) 검사 — 고정 fragment · 취소·실패 callback 쿠키 검증 · 실패 Toast · bfcache.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §6-5 「취소·실패 복귀 경로」.
 *
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-return-check.mts
 *
 * 🔴 Auth.js · 브라우저 · DB 에 연결하지 않는다. 쿠키 이름은 설치된 Auth.js 의 쿠키 정의 함수를 직접 불러 고정한다.
 * 🔴 복귀 소비는 순수 함수에 가짜 창을 넣어 시험하고, 화면은 그 함수만 부르는지 소스로 고정한다.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { AUTH_CALLBACK_COOKIE_NAMES, resolveSignupFailureReturn } from '../src/lib/signup-auth-return'
import {
  SIGNUP_AUTH_FAILED_TOAST,
  SIGNUP_RETURN_ANCHORS,
  consumeSignupReturn,
  parseSignupReturn,
  signupCallbackPath,
  signupFailedFragment,
  signupSuccessFragment,
  type SignupReturnWindow,
} from '../src/lib/signup-return'
import { createPromptFlow } from '../src/lib/signup-prompt-flow'
import { onboardingHref } from '../src/lib/callback-url'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (s: string) => s.replace(/^\s*(\*|\/\/|\/\*\*|\{\/\*).*$/gm, '')
const BASE = 'de683ec47285161c8f6a93b2223e0213ed162578' // 이 단계 직전
const gitShow = (p: string) => execFileSync('git', ['show', `${BASE}:${p}`], { encoding: 'utf8' })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

const P = {
  login: 'src/app/login/page.tsx',
  community: 'src/app/community/[boardSlug]/[postId]/page.tsx',
  magazine: 'src/app/magazine/[slug]/page.tsx',
  handler: 'src/components/features/signup-funnel/SignupReturnHandler.tsx',
  dialog: 'src/components/features/signup-funnel/SignupPromptDialog.tsx',
  ret: 'src/lib/signup-return.ts',
  authRet: 'src/lib/signup-auth-return.ts',
}

// ─────────── 1. 고정 복귀 위치 ───────────
console.log('\n■ 1. 고정 복귀 위치 · fragment')
check('anchor 는 콘텐츠 유형별 고정 둘', JSON.stringify(SIGNUP_RETURN_ANCHORS) === JSON.stringify({ community: 'signup-return-comments', magazine: 'signup-return-content-end' }))
check('성공·실패 fragment', signupSuccessFragment('community') === '#signup-return-comments' && signupFailedFragment('community') === '#signup-return-comments-failed'
  && signupSuccessFragment('magazine') === '#signup-return-content-end' && signupFailedFragment('magazine') === '#signup-return-content-end-failed')
check('성공 callbackUrl = 지금 경로 + 유형별 고정 fragment', signupCallbackPath('/community/free/abc', 'community') === '/community/free/abc#signup-return-comments'
  && signupCallbackPath('/magazine/foo', 'magazine') === '/magazine/foo#signup-return-content-end')
check('기존 onboardingHref 가 fragment 를 callbackUrl 안에 담아 그대로 옮긴다',
  onboardingHref(signupCallbackPath('/community/free/abc', 'community')) === '/onboarding?callbackUrl=%2Fcommunity%2Ffree%2Fabc%23signup-return-comments')
check('우리 네 값만 해석', ['#signup-return-comments', '#signup-return-comments-failed', '#signup-return-content-end', '#signup-return-content-end-failed']
  .every((h) => parseSignupReturn(h) !== null)
  && ['', '#', '#signup-return-comments-failedx', '#SIGNUP-RETURN-COMMENTS', '#comments', '#signup-return-comments?x=1', 'signup-return-comments']
    .every((h) => parseSignupReturn(h) === null))
check('실패 Toast 문구 정확히 일치', SIGNUP_AUTH_FAILED_TOAST === '카카오 로그인을 완료하지 못했어요. 읽던 글에서 다시 시도할 수 있어요.')

// ─────────── 2. 취소·실패 callback 쿠키 ───────────
console.log('\n■ 2. 취소·실패 — callback 쿠키 이름 · 검증')
const authCookie = (await import(pathToFileURL(join(ROOT, 'node_modules/@auth/core/lib/utils/cookie.js')).href)) as {
  defaultCookies: (secure: boolean) => { callbackUrl: { name: string } }
}
check('쿠키 이름은 설치된 Auth.js 정의와 같다(https · 로컬)', JSON.stringify(AUTH_CALLBACK_COOKIE_NAMES)
  === JSON.stringify([authCookie.defaultCookies(true).callbackUrl.name, authCookie.defaultCookies(false).callbackUrl.name]))
const ORIGIN = 'https://soransoran.com'
const cpath = '/community/free/abc123'
const mpath = '/magazine/how-to-sleep'
const wrap = (inner: string) => `${ORIGIN}/onboarding?callbackUrl=${encodeURIComponent(inner)}`
const okCases: Array<[string, Array<string | undefined>, string]> = [
  ['Auth.js 형식(같은 origin 절대 URL · onboarding 감싸기)', [wrap(`${cpath}#signup-return-comments`), undefined], `${cpath}#signup-return-comments-failed`],
  ['로컬 이름 쿠키', [undefined, wrap(`${mpath}#signup-return-content-end`)], `${mpath}#signup-return-content-end-failed`],
  ['두 이름 같은 값', [wrap(cpath), wrap(cpath)], `${cpath}#signup-return-comments-failed`],
  ['내부 절대경로 그대로', [`/onboarding?callbackUrl=${encodeURIComponent(cpath)}`], `${cpath}#signup-return-comments-failed`],
  ['감싸지 않은 상세 경로', [`${ORIGIN}${mpath}`], `${mpath}#signup-return-content-end-failed`],
  ['임의 fragment 는 고정 실패 fragment 로 교체', [wrap(`${cpath}#evil`)], `${cpath}#signup-return-comments-failed`],
  ['query 는 버린다', [wrap(`${cpath}?x=1#signup-return-comments`)], `${cpath}#signup-return-comments-failed`],
  ['안쪽이 같은 origin 절대 URL', [wrap(`${ORIGIN}${cpath}`)], `${cpath}#signup-return-comments-failed`],
]
for (const [name, cookies, expected] of okCases) {
  const got = resolveSignupFailureReturn(cookies, ORIGIN)
  check(`허용: ${name}`, got === expected, String(got))
}
const badCases: Array<[string, Array<string | undefined>]> = [
  ['쿠키 없음', [undefined, undefined]],
  ['빈 값', ['', '']],
  ['두 쿠키 값 충돌', [wrap(cpath), wrap(mpath)]],
  ['외부 origin', [`https://evil.com/onboarding?callbackUrl=${encodeURIComponent(cpath)}`]],
  ['다른 scheme', [`http://soransoran.com${cpath}`]],
  ['다른 host(www)', [`https://www.soransoran.com${cpath}`]],
  ['다른 port', [`https://soransoran.com:8443${cpath}`]],
  ['protocol-relative', [`//evil.com${cpath}`]],
  ['백슬래시 우회', [`/\\evil.com${cpath}`]],
  ['javascript:', ['javascript:alert(1)']],
  ['깨진 URL', ['https://']],
  ['안쪽이 외부 URL', [wrap('https://evil.com/community/free/abc')]],
  ['안쪽이 protocol-relative', [wrap('//evil.com/community/free/abc')]],
  ['onboarding 중첩 감싸기', [wrap(`/onboarding?callbackUrl=${encodeURIComponent(cpath)}`)]],
  ['onboarding callbackUrl 없음', [`${ORIGIN}/onboarding`]],
  ['홈', [wrap('/')]],
  ['게시판 목록', [wrap('/community/free')]],
  ['글 수정 화면', [wrap('/community/free/abc/edit')]],
  ['커뮤니티가 아닌 게시판', [wrap('/community/magazine/abc')]],
  ['없는 게시판', [wrap('/community/nope/abc')]],
  ['매거진 목록', [wrap('/magazine')]],
  ['글쓰기', [wrap('/write?board=free')]],
  ['이상한 글자 segment', [wrap('/community/free/a%20b')]],
  ['제어문자', [wrap('/community/free/abc\u0000')]],
]
for (const [name, cookies] of badCases) {
  const got = resolveSignupFailureReturn(cookies, ORIGIN)
  check(`거부(로그인 화면 유지): ${name}`, got === null, String(got))
}

// ─────────── 3. 로그인 화면 ───────────
console.log('\n■ 3. 로그인 화면 — OAuthCallbackError 만 · 실패면 그대로')
const login = read(P.login)
const loginCode = code(login)
check('OAuthCallbackError 하나만 복귀를 시도한다', /const OAUTH_CALLBACK_ERROR = 'OAuthCallbackError'/.test(login)
  && /if \(searchParams\.error === OAUTH_CALLBACK_ERROR\) \{/.test(login)
  && (loginCode.match(/searchParams\.error ===/g) ?? []).length === 2)
check('두 쿠키 이름 상수로만 읽고 검증 함수 하나를 지난다',
  /AUTH_CALLBACK_COOKIE_NAMES\.map\(\(name\) => jar\.get\(name\)\?\.value\)/.test(login) && /resolveSignupFailureReturn\(/.test(login))
check('검증을 통과했을 때만 redirect · 아니면 로그인 화면',
  /if \(target\) redirect\(target\)\n\s*\}/.test(login) && (loginCode.match(/redirect\(/g) ?? []).length === 1)
check('가입 차단 분기는 그대로', login.includes("const SIGNUP_BLOCKED = 'female_only'") && /if \(searchParams\.error === SIGNUP_BLOCKED\) \{\s*return \(/.test(login))
check('낡은 주석 정리: 「붙이는 쪽이 없다」 0 · 실제 출처(SIGNUP_BLOCKED_PATH) 명시',
  !login.includes('지금은 붙이는 쪽이 없다') && login.includes('SIGNUP_BLOCKED_PATH'))
check('callbackUrl 주석이 쿠키 복귀를 설명한다', login.includes('callback\n *    쿠키에만 둔다') || login.includes('callback 쿠키에만 둔다'))
check('로그인 화면은 인증 설정·Auth.js 내부를 들이지 않는다', !/from '@\/lib\/auth(\.config)?'|@auth\/core|next-auth/.test(login))
check('origin 은 요청 헤더에서 · 비밀값 0', /function requestOrigin\(\): string/.test(login) && !/process\.env/.test(loginCode))

// ─────────── 4. 돌아온 화면 ───────────
console.log('\n■ 4. 돌아온 화면 — 한 번 소비 · Toast 한 번 · fragment 제거')
function fakeWindow(hash: string) {
  const calls = { replace: [] as Array<[unknown, string]>, scroll: [] as string[], toast: [] as string[], push: 0, reload: 0 }
  const state = { __NA: true, tree: 'x' }
  const win: SignupReturnWindow = {
    hash,
    pathname: '/community/free/abc',
    search: '',
    historyState: state,
    replaceState(s, url) { calls.replace.push([s, url]); win.hash = '' },
    scrollToAnchor(id) { calls.scroll.push(id) },
    notifyFailed(m) { calls.toast.push(m) },
  }
  return { win, calls, state }
}
{
  const f = fakeWindow('#signup-return-comments-failed')
  const first = consumeSignupReturn(f.win, 'community')
  const second = consumeSignupReturn(f.win, 'community')
  check('실패: 소비 1회 · 두 번째 0', first && !second)
  check('실패: Toast 확정 문구 정확히 1회', JSON.stringify(f.calls.toast) === JSON.stringify([SIGNUP_AUTH_FAILED_TOAST]))
  check('실패: 같은 복귀 위치로 이동', JSON.stringify(f.calls.scroll) === JSON.stringify(['signup-return-comments']))
  check('fragment 제거: replaceState 1회 · 상태 그대로 · fragment 없는 주소 · push·reload 0',
    f.calls.replace.length === 1 && f.calls.replace[0][0] === f.state && f.calls.replace[0][1] === '/community/free/abc' && f.calls.push === 0 && f.calls.reload === 0)
}
{
  const f = fakeWindow('#signup-return-content-end')
  consumeSignupReturn(f.win, 'magazine')
  check('성공(매거진): 본문 끝으로 · Toast 0 · fragment 제거', JSON.stringify(f.calls.scroll) === JSON.stringify(['signup-return-content-end'])
    && f.calls.toast.length === 0 && f.calls.replace.length === 1)
}
{
  const f = fakeWindow('#signup-return-comments')
  consumeSignupReturn(f.win, 'community')
  check('성공(커뮤니티): 댓글 영역으로 · Toast 0', JSON.stringify(f.calls.scroll) === JSON.stringify(['signup-return-comments']) && f.calls.toast.length === 0)
}
{
  const f = fakeWindow('#signup-return-content-end-failed')
  check('다른 유형 화면의 fragment 는 건드리지 않는다', !consumeSignupReturn(f.win, 'community') && f.calls.replace.length === 0 && f.calls.toast.length === 0)
  const g = fakeWindow('#other')
  check('우리 것이 아닌 fragment 는 건드리지 않는다', !consumeSignupReturn(g.win, 'community') && g.calls.replace.length === 0)
}
const handler = read(P.handler)
check('handler: 일반 mount 와 pageshow.persisted 모두 같은 소비 함수',
  /consume\(\)\n\s*const onPageShow = \(event: PageTransitionEvent\) => \{\s*if \(event\.persisted\) consume\(\)/.test(handler)
  && /removeEventListener\('pageshow', onPageShow\)/.test(handler))
check('handler: replaceState 만 · pushState·reload·location 대입 0',
  /replaceState: \(state, url\) => window\.history\.replaceState\(state, '', url\)/.test(handler)
  && !/pushState|location\.reload|location\.assign|location\.href\s*=|location\.replace/.test(code(handler)))
check('handler: 기존 Toast 시스템 · 고정 key', /notifyFailed: \(message\) => toast\.info\(message, \{ key: 'signup-auth-failed' \}\)/.test(handler))

// ─────────── 5. 화면 배치 ───────────
console.log('\n■ 5. 복귀 위치는 gate · 로그인과 무관하게 늘 있다')
const community = read(P.community)
const magazine = read(P.magazine)
for (const [name, src, ct] of [['커뮤니티', community, 'community'], ['매거진', magazine, 'magazine']] as const) {
  check(`${name}: anchor 무조건 렌더(tracking 조건 밖)`, new RegExp(`\\n\\s*<div id=\\{SIGNUP_RETURN_ANCHORS\\.${ct}\\} aria-hidden className="scroll-mt-40" />`).test(src)
    && !new RegExp(`tracking \\? <div id=\\{SIGNUP_RETURN_ANCHORS`).test(src))
  check(`${name}: handler 무조건 렌더 · 경계 밖`, new RegExp(`\\n {6}<SignupReturnHandler contentType="${ct}" />`).test(src)
    && src.indexOf('<SignupReturnHandler') < src.indexOf('<SignupFunnelBoundary'))
}
check('커뮤니티 anchor 는 댓글 영역 바로 앞', /<div id=\{SIGNUP_RETURN_ANCHORS\.community\} aria-hidden className="scroll-mt-40" \/>\n\s*<CommentSection/.test(community))
{
  const iBody = magazine.indexOf('<MagazineBody article={article} />')
  const iAnchor = magazine.indexOf('id={SIGNUP_RETURN_ANCHORS.magazine}')
  const iEnd = magazine.indexOf('</article>')
  check('매거진 anchor 는 본문 끝(MagazineBody 뒤 · 카드 안)', iBody > 0 && iBody < iAnchor && iAnchor < iEnd)
}
check('dialog 성공 callbackUrl 은 signupCallbackPath', /callbackUrl=\{signupCallbackPath\(pathname, contentType\)\}/.test(read(P.dialog)))

// ─────────── 6. bfcache ───────────
console.log('\n■ 6. bfcache — 인증 왕복 dialog 는 닫는다')
{
  const f = createPromptFlow()
  f.open(); f.startSignIn()
  check('pending → closed · 같은 dialog 재시도 0 · 다시 열림 0', f.restoreFromCache() && f.phase() === 'closed' && !f.startSignIn() && !f.open())
}
const dialog = read(P.dialog)
const onPageShow = dialog.match(/const onPageShow = \(event: PageTransitionEvent\) => \{([\s\S]*?)\n {4}\}/)?.[1] ?? ''
check('복원 처리: 닫기만 — ③·④·표식·history.back·setPending 0',
  /if \(event\.persisted && flow\.restoreFromCache\(\)\) finish\(\)/.test(onPageShow) && !/onImpression|onAuthStart|history|setPending/.test(onPageShow))
check('닫기 정리(스크롤·초점·body)는 기존 cleanup 그대로 — finish 뒤 unmount 에서 원복',
  /body\.style\.overflow = previous\.overflow/.test(dialog) && /if \(closed\.current && restore\.current\)/.test(dialog))

// ─────────── 7. 개인정보 · 변경 경계 ───────────
console.log('\n■ 7. 개인정보 · 변경 경계')
for (const [name, p] of [['복귀 상수', P.ret], ['복귀 검증', P.authRet], ['handler', P.handler]] as const)
  check(`${name}: storage·cookie 쓰기·이벤트 전송 0`, !/localStorage|sessionStorage|document\.cookie|sendAnonymousFunnelEvent|sendBeacon|fetch\(/.test(code(read(p))))
const unchanged = [
  'src/components/features/CommentSection.tsx', 'src/components/features/KakaoSignInButton.tsx',
  'src/lib/signup-funnel-send.ts', 'src/lib/signup-prompt-storage.ts', 'src/lib/signup-funnel.ts',
  'src/lib/auth.ts', 'src/lib/auth.config.ts', 'src/lib/callback-url.ts', 'src/lib/actions/onboarding.ts',
  'src/components/features/onboarding/onboarding-form.tsx', 'src/app/onboarding/page.tsx', 'src/components/ui/toast/toast-context.tsx',
].filter((p) => read(p) !== gitShow(p))
check('변경 금지 파일(댓글·카카오 버튼·전송·저장·인증·온보딩·Toast) 그대로', unchanged.length === 0, unchanged.join(', '))
const imports = (p: string) => [...read(p).matchAll(/^import .*$/gm)].map((m) => m[0])
check('복귀 상수 import 는 타입 하나', JSON.stringify(imports(P.ret)) === JSON.stringify(["import type { SignupFunnelContentType } from '@/lib/signup-funnel'"]))
check('복귀 검증 import 고정(D100 0)', JSON.stringify(imports(P.authRet)) === JSON.stringify([
  "import { getBoardBySlug } from '@/lib/board-registry'",
  "import { toInternalPath } from '@/lib/callback-url'",
  "import type { SignupFunnelContentType } from '@/lib/signup-funnel'",
  "import { signupFailedFragment } from '@/lib/signup-return'",
]))
const srcFiles = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[]).map((f) => f.split('\\').join('/')).filter((f) => /\.(ts|tsx)$/.test(f))
check('fragment 문자열은 복귀 상수 한 곳에만 정의', srcFiles.filter((f) => read(join('src', f)).includes("'signup-return-")).join() === 'lib/signup-return.ts')

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
