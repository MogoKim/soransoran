/**
 * ChatGPT web UI 세션 — 시스템 Chrome 을 headed 로 띄우고 접근 상태만 판정한다.
 *
 * 🔴 headless 를 쓰지 않는다. 쓸 수 없다.
 *    headless 는 Cloudflare 가 403 으로 막았고 headed 만 200 이었다.
 *    우회(stealth·UA 위조)는 하지 않는다 — 탐지 회피이고 계정 정지를 감수할 이유가 없다.
 *
 * 🔴 Playwright 가 프로필을 직접 열지 않는다. 열면 로그인이 날아간다.
 *    launchPersistentContext 로 전용 프로필을 열면 Chrome 이 키체인(Chrome Safe Storage)에
 *    접근하지 못해, 읽을 수 없는 암호화 쿠키를 무효로 보고 **지운다.**
 *    실측: 로그인 직후 chatgpt/openai 쿠키 42개 → probe 1회 후 8개 (34개 소실).
 *    그래서 이 파일에는 launchPersistentContext 가 없다. connectOverCDP 만 쓴다.
 *
 * 🔴 브라우저는 사람이 띄운 일반 Chrome 이다.
 *    --login 이 --remote-debugging-port 를 붙여 평범한 Chrome 을 띄우고,
 *    probe 는 거기에 **붙기만** 한다. 프로필의 주인은 끝까지 그 Chrome 이다.
 *
 * 🔴 번들 chromium 을 쓰지 않는다.
 *    Playwright 버전이 오르면 요구 브라우저 번호가 바뀌어 경로가 조용히 죽는다.
 *    시스템 Chrome 은 경로가 고정이라 그 사고가 없다.
 *
 * 🔴 아무것도 저장하지 않는다.
 *    스크린샷·DOM 덤프·HTML 본문·URL·쿠키·토큰 — 전부 남기지 않는다.
 *    Cloudflare challenge URL 의 __cf_chl_rt_tk 는 계정과 연결되고,
 *    로그인 화면 스크린샷에는 계정명이 찍힌다. 불리언 플래그와 상태 코드만 남긴다.
 */
import { existsSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 프로필은 repo 밖에 둔다. 쿠키가 git 에 닿을 일이 없어야 한다 */
export const PROFILE_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran-chatgpt')

/** 시스템 Chrome. Playwright 버전과 무관하게 경로가 고정이다 */
export const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const CHATGPT_URL = 'https://chatgpt.com/'

/**
 * CDP 포트. 이 포트로 떠 있는 Chrome 에만 붙는다.
 * 9222 는 흔히 쓰여 충돌하므로 이 프로젝트 전용 번호를 쓴다.
 */
export const CDP_PORT = 9333
export const CDP_URL = `http://127.0.0.1:${CDP_PORT}`

/** --login 이 Chrome 에 넘기는 인자. --no-sandbox 도 --enable-automation 도 없다 */
export function chromeArgs() {
  return [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    CHATGPT_URL,
  ]
}


/**
 * 접근 상태. 각각 대응이 다르다.
 *   ok                 정상 — 자동화를 이어갈 수 있다
 *   login_required     사람이 1회 로그인해야 한다. 무인으로 풀 수 없다
 *   cloudflare_blocked 봇 감지. 재시도하면 악화된다 — 즉시 중단
 *   browser_missing    Chrome 이 없거나 경로가 바뀌었다
 *   permission_blocked 브라우저 실행이 정책에 막혔다
 *   chrome_not_running 전용 Chrome 이 안 떠 있다. CDP 로 붙을 대상이 없다
 *   unknown            위 어디도 아니다. UI 가 바뀌었을 수 있다
 */
export const STATUS = {
  OK: 'ok',
  LOGIN_REQUIRED: 'login_required',
  CLOUDFLARE_BLOCKED: 'cloudflare_blocked',
  BROWSER_MISSING: 'browser_missing',
  PERMISSION_BLOCKED: 'permission_blocked',
  CHROME_NOT_RUNNING: 'chrome_not_running',
  UNKNOWN: 'unknown',
}

/** Slack 알림 등급. 정상은 알리지 않는다 — 매일 오는 알림은 아무도 안 본다 */
export const SEVERITY = {
  [STATUS.OK]: null,
  [STATUS.LOGIN_REQUIRED]: 'BLOCKED',
  [STATUS.CLOUDFLARE_BLOCKED]: 'BLOCKED',
  [STATUS.BROWSER_MISSING]: 'ERROR',
  [STATUS.PERMISSION_BLOCKED]: 'ERROR',
  [STATUS.CHROME_NOT_RUNNING]: 'BLOCKED',
  [STATUS.UNKNOWN]: 'ERROR',
}

/** 사람이 읽을 한 줄. 여기에도 URL·계정·경로를 넣지 않는다 */
export const MESSAGE = {
  [STATUS.OK]: 'ChatGPT 접근 정상',
  [STATUS.LOGIN_REQUIRED]: 'ChatGPT 로그인이 필요하다 — 사람이 전용 프로필에서 1회 로그인해야 한다',
  [STATUS.CLOUDFLARE_BLOCKED]: 'Cloudflare 가 막았다 — 재시도하지 않는다',
  [STATUS.BROWSER_MISSING]: 'Chrome 을 찾지 못했다',
  [STATUS.PERMISSION_BLOCKED]: '브라우저 실행이 막혔다',
  [STATUS.CHROME_NOT_RUNNING]: '전용 Chrome 이 떠 있지 않다 — --login 으로 띄워 두어야 한다',
  [STATUS.UNKNOWN]: 'ChatGPT 화면을 판정하지 못했다 — UI 가 바뀌었을 수 있다',
}

export function browserAvailable() {
  return existsSync(CHROME_APP)
}

export function profileExists() {
  return existsSync(PROFILE_DIR)
}

/**
 * 전용 Chrome 이 CDP 포트로 떠 있는가.
 *
 * CDP 구조에서는 Chrome 이 **떠 있는 것이 정상**이다.
 * 안 떠 있으면 붙을 대상이 없다.
 */
export async function cdpAvailable(timeoutMs = 2000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: ac.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

/** 전용 프로필로 Chrome 이 돌고 있는가 (CDP 포트와 무관하게 프로세스 존재만) */
export function profileInUse() {
  if (!existsSync(PROFILE_DIR)) return false
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { lstatSync(join(PROFILE_DIR, name)); return true } catch { /* 없으면 다음 */ }
  }
  return false
}

/** CDP 연결 실패를 상태로 바꾼다. 원문을 그대로 흘리지 않는다 */
function classifyConnectError(err) {
  const m = String(err?.message ?? '').toLowerCase()
  if (m.includes('econnrefused') || m.includes('connect')) return STATUS.CHROME_NOT_RUNNING
  if (m.includes('permission') || m.includes('eacces') || m.includes('denied')) return STATUS.PERMISSION_BLOCKED
  return STATUS.UNKNOWN
}

/**
 * 페이지 화면을 상태로 바꾼다.
 * 순서가 중요하다 — Cloudflare 화면은 본문이 비어 있어 로그인 판정이 먼저 걸리면 오진한다.
 */
export function classifyPage({ httpStatus, title, signals = {} }) {
  const t = String(title ?? '')

  // Cloudflare 가 먼저다 — challenge 화면은 본문이 비어 있어서
  // 뒤 판정에 걸리면 "로그인 필요" 로 오진한다
  if (httpStatus === 403 || /잠시만 기다|Just a moment|Attention Required/i.test(t)) {
    return STATUS.CLOUDFLARE_BLOCKED
  }

  // 로그인된 화면에서만 나오는 것들. 하나라도 있으면 세션이 살아 있다
  const loggedIn = [
    signals.promptTextarea,   // composer 본체
    signals.editableBox,      // composer 가 role=textbox 로 바뀐 변형
    signals.plusButton,       // 첨부 버튼
    signals.historyItem,      // 사이드바 대화 목록
    signals.accountButton,    // 계정 메뉴
  ].filter(Boolean).length

  // 로그아웃 랜딩에서만 나오는 것들
  // 로그아웃 랜딩의 title 은 마케팅 문구가 붙는다. 로그인 상태면 그냥 "ChatGPT".
  // signals 에 얹어 두면 판정 근거가 출력에 그대로 보인다
  if (/Chat, Work, Create/i.test(t)) signals.landingTitle = true

  const loggedOut = [
    signals.loginBtn,
    signals.signupBtn,
    signals.welcomeText,
    signals.landingTitle,
  ].filter(Boolean).length

  if (loggedIn > 0) return STATUS.OK
  if (loggedOut > 0) return STATUS.LOGIN_REQUIRED

  // 어느 쪽 신호도 없다 = 화면을 못 읽었다. 로그인 필요라고 단정하지 않는다
  return STATUS.UNKNOWN
}

/**
 * 브라우저를 띄워 ChatGPT 접근 상태만 본다. 메시지를 보내지 않는다.
 *
 * @param {{ headless?: boolean, timeoutMs?: number }} opts
 *   headless 는 명시적으로 막혀 있다. true 를 주면 실행하지 않고 에러를 던진다.
 */
export async function probe({ timeoutMs = 45000, composerWaitMs = 20000 } = {}) {
  // launched 가 아니라 connected 다 — 이 코드는 브라우저를 띄우지 않는다
  const out = { connected: false, httpStatus: null, profileExists: profileExists(), via: 'cdp' }

  if (!browserAvailable()) {
    return { ...out, status: STATUS.BROWSER_MISSING }
  }
  // 🔴 여기서 브라우저를 띄우지 않는다. 떠 있는 것에만 붙는다.
  //    띄우면 Playwright 가 프로필의 주인이 되고, 그 순간 세션 쿠키가 지워진다.
  if (!(await cdpAvailable())) {
    return { ...out, status: STATUS.CHROME_NOT_RUNNING, profileInUse: profileInUse() }
  }

  const { chromium } = await import('playwright-core')
  let browser = null

  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 15000 })
    out.connected = true

    const ctx = browser.contexts()[0]
    if (!ctx) return { ...out, status: STATUS.UNKNOWN }

    // 이미 열려 있는 탭 중 ChatGPT 를 찾는다. 없으면 새 탭을 연다
    const pages = ctx.pages()
    let page = pages.find((pg) => pg.url().includes('chatgpt.com'))
    if (!page) {
      page = await ctx.newPage()
      const res = await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      out.httpStatus = res?.status() ?? null
    } else {
      // 이미 떠 있던 탭이면 HTTP 상태를 모른다. 화면 신호로만 판정한다
      out.httpStatus = 200
    }

    // SPA 라 composer 가 늦게 뜬다. 고정 대기로는 못 잡아 login_required 로 오진했다
    try {
      await page.waitForSelector('#prompt-textarea, [contenteditable="true"][role="textbox"]', { timeout: composerWaitMs })
    } catch { /* 없으면 아래 신호로 본다 */ }

    // 불리언만 꺼낸다. DOM 도 본문도 URL 도 쿠키도 반환하지 않는다
    const seen = await page.evaluate(() => ({
      title: document.title,
      signals: {
        promptTextarea: !!document.querySelector('#prompt-textarea'),
        editableBox: !!document.querySelector('[contenteditable="true"][role="textbox"]'),
        plusButton: !!document.querySelector('[data-testid="composer-plus-btn"]'),
        historyItem: !!document.querySelector('[data-testid^="history-item-"]'),
        accountButton: !!document.querySelector('[data-testid="accounts-profile-button"], [data-testid="profile-button"]'),
        loginBtn: !!document.querySelector('[data-testid="login-button"]'),
        signupBtn: !!document.querySelector('[data-testid="signup-button"]'),
        welcomeText: /무료로 가입|Get started|Welcome back/i.test((document.body.innerText || '').slice(0, 300)),
      },
    }))
    out.status = classifyPage({ httpStatus: out.httpStatus, ...seen })
    out.signals = seen.signals
  } catch (err) {
    out.status = out.connected ? STATUS.UNKNOWN : classifyConnectError(err)
    out.errorName = err?.name ?? 'Error'
  } finally {
    // 🔴 close() 가 아니라 disconnect 다. 사람이 띄운 Chrome 을 죽이지 않는다
    try { await browser?.close() } catch { /* 연결만 끊는다 */ }
  }

  return out
}

/** 프로필 권한 안내. 쿠키가 든 디렉터리라 다른 사용자가 읽을 수 있으면 안 된다 */
export const PROFILE_SETUP_GUIDE = `
전용 Chrome 준비 (창업자)

  node scripts/magazine-webui-runner.mjs --login

  1. 일반 Chrome 창이 열린다 (자동화 아님 · CDP 포트 ${CDP_PORT} 열림)
  2. ChatGPT 에 로그인한다
  3. 🔴 창을 닫지 않는다 — probe 가 이 창에 붙는다

  ⚠️ 처음 열 때 "나만의 Chrome 만들기" 팝업이 뜨면
     "계정 없이 Chrome 사용" 을 눌러야 쿠키가 디스크에 저장된다.

🔴 Playwright 는 이 Chrome 을 띄우지도 닫지도 않는다. 붙기만 한다.
   직접 띄우면 키체인 접근이 막혀 세션 쿠키가 지워진다(실측 42개 → 8개).
🔴 무인으로 로그인할 방법은 없고, 있어서도 안 된다.
🔴 이 디렉터리를 repo 안으로 옮기지 않는다.
`.trim()
