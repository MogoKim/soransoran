#!/usr/bin/env tsx
/**
 * 가입 제안 검사 — 24시간 노출 저장 · dialog 상태 · B안 계약 · ③ prompt_impression · ④ auth_start · 귀속 표식 ·
 * 카카오 버튼 재사용 · bfcache.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §6 · §7 · §8-1 · §8-4 · §8-11 · §8-13.
 *
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-prompt-check.mts
 *
 * 🔴 브라우저 · 인증 서버 · DB 에 연결하지 않는다. storage · 시계는 대역이다.
 * 🔴 DOM 시험 도구가 없다. 판정은 순수 모듈(storage · flow)로 시험하고, 컴포넌트는 그 모듈만 부르는지와
 *    정본 문구·접근성·레이어 계약을 소스로 고정한다.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AUTH_MARKER_KEY,
  AUTH_MARKER_TTL_MS,
  PROMPT_COOLDOWN_MS,
  PROMPT_SHOWN_KEY,
  claimPromptExposure,
  decidePromptExposure,
  recordPromptExposure,
  writeAuthMarker,
  type PromptStorage,
} from '../src/lib/signup-prompt-storage'
import { createPromptFlow, nextFocusIndex, scrollbarCompensation, type PromptCloseSource } from '../src/lib/signup-prompt-flow'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (s: string) => s.replace(/^\s*(\*|\/\/|\/\*\*|\{\/\*).*$/gm, '')
const BASE = '8030d173f21458fd804fe2512b58331f728e7c50' // 이 단계 직전
const gitShow = (p: string) => execFileSync('git', ['show', `${BASE}:${p}`], { encoding: 'utf8' })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

const P = {
  storage: 'src/lib/signup-prompt-storage.ts',
  flow: 'src/lib/signup-prompt-flow.ts',
  dialog: 'src/components/features/signup-funnel/SignupPromptDialog.tsx',
  tracker: 'src/components/features/signup-funnel/SignupFunnelTracker.tsx',
  kakao: 'src/components/features/KakaoSignInButton.tsx',
}

// ─────────── storage 대역 ───────────
type Mode = 'ok' | 'throw-get' | 'throw-set' | 'ignore-set' | 'garble-set'
function memoryStorage(mode: Mode = 'ok', seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed))
  const writes: Array<[string, string]> = []
  const storage: PromptStorage = {
    getItem(key) {
      if (mode === 'throw-get') throw new Error('blocked')
      return data.has(key) ? (data.get(key) as string) : null
    },
    setItem(key, value) {
      writes.push([key, value])
      if (mode === 'throw-set') throw new Error('quota')
      if (mode === 'ignore-set') return
      data.set(key, mode === 'garble-set' ? `${value}x` : value)
    },
  }
  return { storage, data, writes }
}
const NOW = 1_790_000_000_000

// ─────────── 1. 24시간 노출 ───────────
console.log('\n■ 1. 24시간 노출 저장')
check('값 없음: 노출 가능', decidePromptExposure(memoryStorage().storage, NOW) === 'allowed')
for (const bad of ['abc', '', '-1', '1.5', '1e3', ' 123', '1234567890123456', '{"t":1}'])
  check(`손상값 ${JSON.stringify(bad)}: 새 노출 시도 가능`, decidePromptExposure(memoryStorage('ok', { [PROMPT_SHOWN_KEY]: bad }).storage, NOW) === 'allowed')
check('1ms 전 노출: 24시간 제한', decidePromptExposure(memoryStorage('ok', { [PROMPT_SHOWN_KEY]: String(NOW - 1) }).storage, NOW) === 'cooldown')
check('24시간 - 1ms: 제한', decidePromptExposure(memoryStorage('ok', { [PROMPT_SHOWN_KEY]: String(NOW - PROMPT_COOLDOWN_MS + 1) }).storage, NOW) === 'cooldown')
check('정확히 24시간: 노출 가능', decidePromptExposure(memoryStorage('ok', { [PROMPT_SHOWN_KEY]: String(NOW - PROMPT_COOLDOWN_MS) }).storage, NOW) === 'allowed')
check('미래 시각: 노출하지 않음', decidePromptExposure(memoryStorage('ok', { [PROMPT_SHOWN_KEY]: String(NOW + 1) }).storage, NOW) === 'cooldown')
check('읽기 실패: unreadable', decidePromptExposure(memoryStorage('throw-get').storage, NOW) === 'unreadable')
check('24시간은 정확히 86,400,000ms', PROMPT_COOLDOWN_MS === 86_400_000)
{
  const m = memoryStorage()
  check('기록: 쓰고 다시 읽어 같으면 성공', recordPromptExposure(m.storage, NOW) && m.data.get(PROMPT_SHOWN_KEY) === String(NOW))
  check('저장값은 시각 숫자 하나뿐', /^\d+$/.test(m.data.get(PROMPT_SHOWN_KEY) ?? '') && m.data.size === 1)
}
check('기록: setItem 실패면 false', !recordPromptExposure(memoryStorage('throw-set').storage, NOW))
check('기록: 써지지 않았으면(readback 없음) false', !recordPromptExposure(memoryStorage('ignore-set').storage, NOW))
check('기록: readback 불일치면 false', !recordPromptExposure(memoryStorage('garble-set').storage, NOW))
{
  const m = memoryStorage()
  check('claim: 처음이면 true · 기록 1회', claimPromptExposure(m.storage, NOW) && m.writes.length === 1)
  check('claim: 24시간 안 두 번째는 false · 쓰기 추가 0', !claimPromptExposure(m.storage, NOW + 1000) && m.writes.length === 1)
  check('claim: 24시간 뒤 다시 true', claimPromptExposure(m.storage, NOW + PROMPT_COOLDOWN_MS))
}
check('claim: storage 없음 false', !claimPromptExposure(null, NOW))
for (const mode of ['throw-get', 'throw-set', 'ignore-set', 'garble-set'] as const)
  check(`claim: ${mode} 이면 false (dialog·③·④ 0)`, !claimPromptExposure(memoryStorage(mode).storage, NOW))

// ─────────── 2. 귀속 표식 ───────────
console.log('\n■ 2. 인증 귀속 표식')
{
  const m = memoryStorage()
  const ok = writeAuthMarker(m.storage, 'magazine', NOW)
  const raw = m.data.get(AUTH_MARKER_KEY) ?? '{}'
  const parsed = JSON.parse(raw) as Record<string, unknown>
  check('표식: 쓰기 성공', ok && m.writes.length === 1 && m.writes[0][0] === AUTH_MARKER_KEY)
  check('표식: 정확히 세 값', JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify(['contentType', 'entryPoint', 'expiresAt']))
  check('표식: contentType · content_end · 만료 30분', parsed.contentType === 'magazine' && parsed.entryPoint === 'content_end'
    && parsed.expiresAt === NOW + 30 * 60 * 1000 && AUTH_MARKER_TTL_MS === 1_800_000)
}
check('표식: setItem 실패는 false · 예외 0', (() => { try { return writeAuthMarker(memoryStorage('throw-set').storage, 'community', NOW) === false } catch { return false } })())
check('표식: storage 없음 false', writeAuthMarker(null, 'community', NOW) === false)
check('두 키는 기존 조회수·글쓰기·글자크기 키와 다르다', ![PROMPT_SHOWN_KEY, AUTH_MARKER_KEY].some((k) =>
  ['soran-write-auth-return', 'soran-font-size'].includes(k) || k.startsWith('soransoran:viewed:')) && new Set([PROMPT_SHOWN_KEY, AUTH_MARKER_KEY]).size === 2)

// ─────────── 3. dialog 상태 ───────────
console.log('\n■ 3. dialog 상태 — 한 번 열림 · 다섯 닫기 · CTA 한 번 · bfcache')
const SOURCES: PromptCloseSource[] = ['close-button', 'dim', 'escape', 'secondary', 'back']
for (const s of SOURCES) {
  const f = createPromptFlow()
  f.open()
  check(`닫기 ${s}: 열린 dialog 를 닫는다 · 다시 열리지 않음`, f.close(s) && f.phase() === 'closed' && !f.open())
}
{
  const f = createPromptFlow()
  check('처음 open 만 true', f.open() && !f.open())
  check('CTA 첫 시도만 받아들인다(연타 → ④·signIn 1회)', f.startSignIn() && !f.startSignIn() && !f.startSignIn())
  check('진행 중에는 다섯 닫기 모두 거절', SOURCES.every((s) => !f.close(s)) && f.phase() === 'pending')
  check('bfcache 복원: 인증 왕복이 일어난 dialog 는 닫힌다(같은 dialog 재시도 0)', f.restoreFromCache() && f.phase() === 'closed' && !f.startSignIn())
  check('bfcache 복원: 닫힌 dialog 를 다시 열지 않는다 · 두 번째 복원은 아무 일 없음', !f.restoreFromCache() && f.phase() === 'closed' && !f.open())
}
{
  const f = createPromptFlow()
  check('열리기 전 CTA·닫기 거절', !f.startSignIn() && !f.close('dim'))
}
check('Tab 순환', nextFocusIndex(3, 2, false) === 0 && nextFocusIndex(3, 0, true) === 2 && nextFocusIndex(3, 1, false) === 2)
check('초점이 밖이면 Tab 처음 · Shift+Tab 끝', nextFocusIndex(3, -1, false) === 0 && nextFocusIndex(3, -1, true) === 2)
check('초점 대상 0개면 -1', nextFocusIndex(0, -1, false) === -1)
check('스크롤바 폭 계산', scrollbarCompensation(1280, 1265) === 15 && scrollbarCompensation(390, 390) === 0 && scrollbarCompensation(100, 120) === 0)

// ─────────── 4. B안 · 접근성 · 레이어 ───────────
console.log('\n■ 4. B안 문구 · 접근성 · 레이어 · 닫기 배선')
const dialog = read(P.dialog)
const dialogCode = code(dialog)
check('제목 두 줄 · 둘째 줄만 브랜드색',
  /마음에 남은 이야기를\n\s*<br \/>\n\s*<span className="text-brand-ink">계속 이어가세요<\/span>/.test(dialog)
  && (dialogCode.match(/text-brand/g) ?? []).length === 1)
check('불렛 정확히 셋 · 문구 그대로', JSON.stringify([...dialog.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1])) === JSON.stringify([
  '내 이야기를 글로 남기기', '마음에 닿은 글에 공감하기', '댓글로 편하게 이야기 나누기',
]))
check("CTA 문구 '카카오로 시작하기' · 진행 중 '카카오로 이동 중…'", dialog.includes("label={pending ? '카카오로 이동 중…' : '카카오로 시작하기'}"))
check("보조 버튼 '계속 둘러볼게요'", /\n\s*계속 둘러볼게요\n/.test(dialog))
check('role=dialog · aria-modal · aria-labelledby · 초점 받을 패널',
  /role="dialog"\s*aria-modal="true"\s*aria-labelledby=\{titleId\}\s*tabIndex=\{-1\}/.test(dialog) && /<h2 id=\{titleId\}/.test(dialog))
check('X 접근성 이름 · 52×52', /aria-label="가입 제안 닫기"/.test(dialog) && /h-\[52px\] w-\[52px\]/.test(dialog))
check('보조 버튼 52px(TOUCH_MIN)', /className=\{`inline-flex \$\{TOUCH_MIN\} w-full/.test(dialog))
check('CTA 는 prompt variant(56px)', /<KakaoSignInButton\s*variant="prompt"/.test(dialog))
check('dim 48% · 레이어 z-60 fixed overlay', /fixed inset-0 z-\[60\]/.test(dialog) && /bg-content-primary opacity-\[0\.48\]/.test(dialog))
check('모바일 하단 전체 폭 · 위 모서리 22px · 데스크톱 최대 600px 하단 중앙',
  /items-end justify-center/.test(dialog) && /relative w-full rounded-t-\[22px\]/.test(dialog) && /md:max-w-\[600px\] md:rounded-\[22px\]/.test(dialog))
check('정본 간격: 위 24 · 좌우 20 · 제목 1.35 · 제목→불렛 14 · 불렛 10 · 불렛→CTA 22 · CTA→보조 4 · 아래 16+safe-area',
  /pt-6/.test(dialog) && /px-5/.test(dialog) && /leading-\[1\.35\]/.test(dialog) && /mt-\[14px\]/.test(dialog)
  && /gap-\[10px\]/.test(dialog) && /mt-\[22px\] flex flex-col gap-1/.test(dialog) && /pb-\[calc\(16px\+env\(safe-area-inset-bottom,0px\)\)\]/.test(dialog))
check('고정 높이 0 · drag 손잡이 0 · 그림 0', !/\bh-\[(?!52px)|max-h-|min-h-\[(?!52px)|\bh-1 w-10|touchmove|onTouch|<img|<Image/.test(dialogCode))
check('움직임은 motion-safe 에서만', (dialogCode.match(/animate-in/g) ?? []).length === 1 && /motion-safe:animate-in motion-safe:slide-in-from-bottom/.test(dialog))
check('닫기 배선: X · dim · ESC · 보조 · 뒤로가기',
  /requestClose\('close-button'\)/.test(dialog) && /requestClose\('dim'\)/.test(dialog) && /requestClose\('escape'\)/.test(dialog)
  && /requestClose\('secondary'\)/.test(dialog) && /flow\.close\('back'\)/.test(dialog))
check('진행 중 X·보조·CTA 비활성', (dialog.match(/disabled=\{pending\}/g) ?? []).length === 3)
check('뒤로가기: history 에 고정 boolean 하나 · URL 인자 0',
  /window\.history\.pushState\(\{ \[HISTORY_MARKER\]: true \}, ''\)/.test(dialog) && dialog.includes("const HISTORY_MARKER = 'signupPrompt'"))
check('뒤로가기 외 닫기는 우리가 넣은 한 칸만 되돌린다',
  /\[HISTORY_MARKER\] === true\) \{\s*window\.history\.back\(\)/.test(dialog))
check('popstate·pageshow 는 열린 동안만 · cleanup 에서 뗀다',
  /addEventListener\('popstate', onPopState\)/.test(dialog) && /removeEventListener\('popstate', onPopState\)/.test(dialog)
  && /addEventListener\('pageshow', onPageShow\)/.test(dialog) && /removeEventListener\('pageshow', onPageShow\)/.test(dialog))
check('bfcache: persisted 이고 진행 중이었을 때만 닫는다 · history.back·이벤트·표식 0',
  /const onPageShow = \(event: PageTransitionEvent\) => \{\s*if \(event\.persisted && flow\.restoreFromCache\(\)\) finish\(\)\s*\}/.test(dialog)
  && !/(history\.back|onAuthStart|onImpression|setPending|pushState)/.test(dialog.match(/const onPageShow = \(event: PageTransitionEvent\) => \{([\s\S]*?)\n {4}\}/)?.[1] ?? 'missing history.back'))
check('스크롤 잠금은 열린 동안만 · cleanup 원복 · 스크롤바 자리 유지(본문 밀림 0)',
  /body\.style\.overflow = 'hidden'/.test(dialog) && /body\.style\.overflow = previous\.overflow/.test(dialog)
  && /if \(scrollbarCompensation\(window\.innerWidth, html\.clientWidth\) > 0\) html\.style\.scrollbarGutter = 'stable'/.test(dialog)
  && /html\.style\.scrollbarGutter = previous\.gutter/.test(dialog))
check('닫힌 뒤 이전 초점·스크롤 복원', /if \(closed\.current && restore\.current\) \{\s*window\.scrollTo\(0, restore\.current\.scrollY\)\s*restore\.current\.focus\?\.focus/.test(dialog))
check('열리면 패널로 초점 · Tab/Shift+Tab 순환 · ESC',
  /panelRef\.current\?\.focus\(\{ preventScroll: true \}\)/.test(dialog) && /nextFocusIndex\(items\.length/.test(dialog) && /event\.key === 'Escape'/.test(dialog))
check('③ 은 mount effect 에서 부른다', /panelRef\.current\?\.focus\(\{ preventScroll: true \}\)\s*onImpression\(\)/.test(dialog))
check('CTA 시작: flow 승인 → 진행 표시 → 표식·④(실패 삼킴) → true',
  /if \(!flow\.startSignIn\(\)\) return false\s*setPending\(true\)\s*try \{\s*onAuthStart\(\)\s*\} catch \{[\s\S]*?\}\s*return true/.test(dialog))
check('dialog 는 인증 호출을 직접 하지 않는다', !/signIn\(|onboardingHref|next-auth/.test(dialogCode))
check('callbackUrl 은 카카오 버튼에만 · 지금 경로 + 고정 성공 fragment', /callbackUrl=\{signupCallbackPath\(pathname, contentType\)\}/.test(dialog) && (dialog.match(/pathname/g) ?? []).length === 2)

// ─────────── 5. tracker 연결 ───────────
console.log('\n■ 5. tracker — ② 다음 24시간 · ③ · ④ 순서와 한 번')
const tracker = read(P.tracker)
check('② 는 24시간과 무관하게 먼저 · 그다음 한 번만 노출 시도',
  /onReach: \(\) => \{\s*sendOncePerMount\(reachGuard\.current, \{ step: 'prompt_reach'[^\n]*\n\s*if \(promptTried\.current\) return\s*promptTried\.current = true\s*if \(claimPromptExposure\(browserStorage\(\), Date\.now\(\)\)\) setPromptOpen\(true\)/.test(tracker))
check('dialog 는 claim 성공일 때만 그려진다', /\{promptOpen \? \(\s*<SignupPromptDialog/.test(tracker))
check('③ 은 dialog mount 콜백에서 impressionGuard 로 한 번',
  /onImpression=\{\(\) =>\s*sendOncePerMount\(impressionGuard\.current, \{ step: 'prompt_impression', contentType, entryPoint: 'content_end' \}\)/.test(tracker))
check('④ 는 CTA 승인 콜백에서 표식 다음 authGuard 로 한 번',
  /onAuthStart=\{\(\) => \{\s*writeAuthMarker\(browserStorage\(\), contentType, Date\.now\(\)\)\s*sendOncePerMount\(authGuard\.current, \{ step: 'auth_start', contentType, entryPoint: 'content_end' \}\)/.test(tracker))
check('닫히면 같은 mount 에서 다시 열지 않는다', /onClosed=\{\(\) => setPromptOpen\(false\)\}/.test(tracker) && /if \(promptTried\.current\) return/.test(tracker))
check('localStorage 접근 실패는 null(노출 0)', /function browserStorage\(\): PromptStorage \| null \{\s*try \{\s*return window\.localStorage\s*\} catch \{\s*return null/.test(tracker))
const srcFiles = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[]).map((f) => f.split('\\').join('/')).filter((f) => /\.(ts|tsx)$/.test(f))
const sentSteps = new Set<string>()
for (const f of srcFiles) for (const m of read(join('src', f)).matchAll(/step: '([a-z_]+)'/g)) sentSteps.add(m[1])
check('클라이언트가 보내는 단계는 ①~④ 뿐 — 새 이벤트 0 · signup_complete 0',
  JSON.stringify([...sentSteps].sort()) === JSON.stringify(['auth_start', 'logged_out_view', 'prompt_impression', 'prompt_reach']), [...sentSteps].join(','))

// ─────────── 6. 카카오 버튼 ───────────
console.log('\n■ 6. 기존 카카오 버튼 재사용')
const kakao = read(P.kakao)
const kakaoBase = gitShow(P.kakao)
const kakaoWithout = kakao
  .replace("/**\n * default = 화면 안에 놓이는 기본형 · onboarding = 로그인 화면 하단 고정 CTA\n * prompt = 회원가입 전환 가입 제안 dialog 의 CTA(B안 · 높이 56px · 진행 중 비활성 표시)\n */\ntype Variant = 'default' | 'onboarding' | 'prompt'",
    "/** default = 화면 안에 놓이는 기본형 · onboarding = 로그인 화면 하단 고정 CTA */\ntype Variant = 'default' | 'onboarding'")
  .replace("  prompt: 'min-h-[56px] rounded-xl px-4 py-2 disabled:cursor-default disabled:opacity-70',\n", '')
  .replace('  onSignInStart,\n  disabled,\n}: {', '  onSignInStart,\n}: {')
  .replace("   * 🔴 false 를 돌려주면 이번 누름은 인증을 시작하지 않는다(연타 거절). 아무것도 돌려주지 않는\n   *    기존 호출부는 지금처럼 인증을 시작한다.\n", '')
  .replace('  onSignInStart?: () => boolean | void\n  /** 진행 중 표시 — 넘기지 않으면 기존 화면의 버튼 마크업은 그대로다 */\n  disabled?: boolean\n', '  onSignInStart?: () => void\n')
  .replace('      disabled={disabled}\n', '')
  .replace('        if (onSignInStart?.() === false) return\n', '        onSignInStart?.()\n')
check('카카오 버튼: 이번 추가분을 빼면 이전 파일과 글자 그대로 같다(기존 variant 마크업·동작 불변)', kakaoWithout === kakaoBase)
check('카카오 버튼: 인증 호출은 여전히 한 줄 · onboardingHref 그대로',
  (kakao.match(/signIn\('kakao', \{ callbackUrl: onboardingHref\(callbackUrl\) \}\)/g) ?? []).length === 1)
check('카카오 버튼: false 면 인증을 시작하지 않고, void 면 기존처럼 시작',
  /if \(onSignInStart\?\.\(\) === false\) return\n\s*signIn\('kakao'/.test(kakao))
check('signIn 호출은 저장소 전체에서 카카오 버튼 한 곳', srcFiles.filter((f) => /\bsignIn\('kakao'/.test(read(join('src', f)))).join() === 'components/features/KakaoSignInButton.tsx')
check('기존 호출부(글쓰기 안내)는 false 를 돌려주지 않는다', !/return false/.test(read('src/components/features/WriteLoginPrompt.tsx')))

// ─────────── 7. 개인정보 · 공유 파일 ───────────
console.log('\n■ 7. 개인정보 · 공유 파일')
for (const [name, p] of [['저장', P.storage], ['flow', P.flow], ['dialog', P.dialog], ['tracker', P.tracker]] as const)
  check(`${name}: 콘텐츠 ID·slug·회원 값·쿠키 0`, !/postId|slug|userId|session\.user|email|nickname|document\.cookie|sessionStorage/.test(code(read(p))))
check('저장·flow 는 window·document·Date.now 를 직접 부르지 않는다', !/\bwindow\.|\bdocument\.|Date\.now/.test(code(read(P.storage)) + code(read(P.flow))))
const sharedUnchanged = [
  'src/components/features/CommentSection.tsx', 'src/components/features/ComposeModeProvider.tsx',
  'src/components/features/ReplyForm.tsx', 'src/components/features/CommentEditor.tsx',
  'src/components/features/GuestCommentControls.tsx', 'src/components/features/CommentComposeAnchor.tsx',
  'src/components/ui/toast/toast-tokens.ts', 'src/components/ui/BottomSheet.tsx',
  'src/components/features/WriteLoginPrompt.tsx', 'src/lib/callback-url.ts', 'src/lib/auth.ts', 'src/lib/auth.config.ts',
  'src/lib/actions/onboarding.ts', 'src/components/features/onboarding/onboarding-form.tsx',
].filter((p) => read(p) !== gitShow(p))
check('공유 파일(댓글·Toast·시트·인증·온보딩) 변경 0 — 로그인 화면 복귀는 D2 검사가 따로 본다', sharedUnchanged.length === 0, sharedUnchanged.join(', '))
check('Toast 레이어는 이미 70 — dialog 60 보다 위', /export const TOAST_Z = 70/.test(read('src/components/ui/toast/toast-tokens.ts')))
const imports = (p: string) => [...read(p).matchAll(/^import .*$/gm)].map((m) => m[0])
check('저장 모듈 import 는 타입 하나', JSON.stringify(imports(P.storage)) === JSON.stringify(["import type { SignupFunnelContentType } from '@/lib/signup-funnel'"]))
check('flow 모듈 import 0', imports(P.flow).length === 0)
check('dialog import 고정(D100 0 · 인증 모듈 직접 0)', JSON.stringify(imports(P.dialog)) === JSON.stringify([
  "import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'",
  "import { usePathname } from 'next/navigation'",
  "import KakaoSignInButton from '@/components/features/KakaoSignInButton'",
  "import type { SignupFunnelContentType } from '@/lib/signup-funnel'",
  "import { TOUCH_MIN } from '@/lib/spacing'",
  "import {",
  "import { signupCallbackPath } from '@/lib/signup-return'",
]))

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
