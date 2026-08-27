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
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs'
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
 *   protocol_error     붙기는 했는데 CDP 명령이 거부됐다. Chrome 은 살아 있다
 *   unknown            위 어디도 아니다. UI 가 바뀌었을 수 있다
 */
export const STATUS = {
  OK: 'ok',
  LOGIN_REQUIRED: 'login_required',
  CLOUDFLARE_BLOCKED: 'cloudflare_blocked',
  BROWSER_MISSING: 'browser_missing',
  PERMISSION_BLOCKED: 'permission_blocked',
  CHROME_NOT_RUNNING: 'chrome_not_running',
  PROTOCOL_ERROR: 'protocol_error',
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
  [STATUS.PROTOCOL_ERROR]: 'ERROR',
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
  [STATUS.PROTOCOL_ERROR]: 'Chrome 에 붙었지만 CDP 명령이 거부됐다 — 로그의 원문을 본다',
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

/**
 * 열려 있는 page 타겟 수. 탭을 하나도 안 세면 0 이다.
 *
 * 🔴 창을 다 닫아도 Chrome 프로세스와 CDP 포트는 남는다.
 *    그래서 cdpAvailable() 은 true 인데 붙을 페이지가 없는 상태가 생긴다.
 */
export async function pageTargetCount(timeoutMs = 2000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${CDP_URL}/json/list`, { signal: ac.signal })
    if (!res.ok) return 0
    const targets = await res.json()
    return targets.filter((x) => x.type === 'page').length
  } catch {
    return 0
  } finally {
    clearTimeout(t)
  }
}

/**
 * 붙기 전에 탭이 하나는 있게 한다.
 *
 * 🔴 탭이 0 개면 connectOverCDP 가 브라우저 레벨 설정 단계에서 죽는다.
 *    실측 에러: Protocol error (Browser.setDownloadBehavior):
 *              Browser context management is not supported.
 *    탭을 하나 열어 두면 같은 Chrome, 같은 포트에서 그대로 붙는다.
 *
 * 🔴 Chrome 을 재시작하지 않는다. CDP 의 HTTP 엔드포인트로 탭만 연다.
 *    Playwright 로 열면 프로필의 주인이 바뀌어 세션 쿠키가 지워진다(맨 위 §).
 */
export async function ensurePageTarget(timeoutMs = 10000) {
  if ((await pageTargetCount()) > 0) return { ok: true, opened: false }

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${CDP_URL}/json/new?${CHATGPT_URL}`, { method: 'PUT', signal: ac.signal })
    if (!res.ok) return { ok: false, opened: false }
  } catch {
    return { ok: false, opened: false }
  } finally {
    clearTimeout(t)
  }

  // 탭이 목록에 뜰 때까지 잠깐 기다린다. 바로 조회하면 아직 0 일 수 있다
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300))
    if ((await pageTargetCount()) > 0) return { ok: true, opened: true }
  }
  return { ok: false, opened: true }
}

/**
 * CDP 연결 실패를 상태로 바꾼다.
 *
 * 🔴 'connect' 를 부분 문자열로 잡지 않는다.
 *    Playwright 의 에러는 `browserType.connectOverCDP: ...` 로 시작한다.
 *    메서드 이름에 connect 가 들어 있어, 넓게 잡으면 **무슨 이유로 실패하든**
 *    "Chrome 이 안 떠 있다" 로 둔갑한다. 실제로 그 오분류 때문에
 *    살아 있는 Chrome 을 세 회차 동안 죽은 것으로 보고했다 (2026-08-27).
 *
 * 소켓이 실제로 안 붙은 경우만 chrome_not_running 이다.
 * 붙었는데 명령이 거부된 것은 protocol_error 로 따로 둔다 — 대응이 다르다.
 */
function classifyConnectError(err) {
  const m = String(err?.message ?? '').toLowerCase()
  if (/econnrefused|econnreset|socket hang up|connection (refused|closed)|timeout \d+ms exceeded/.test(m)) {
    return STATUS.CHROME_NOT_RUNNING
  }
  if (m.includes('permission') || m.includes('eacces') || m.includes('denied')) return STATUS.PERMISSION_BLOCKED
  if (m.includes('protocol error')) return STATUS.PROTOCOL_ERROR
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
/**
 * 전용 Chrome 이 CDP 로 붙을 수 있는 상태가 되도록 보장한다.
 *
 * 01:00 무인 실행에서는 사람이 창을 띄워 둘 수 없다. 그래서 wrapper 가 직접 띄운다.
 *
 * 🔴 이미 떠 있으면 재사용한다. 두 번 띄우지 않는다.
 *    같은 프로필로 Chrome 을 또 띄우면 기존 창에 탭만 열리거나 프로필이 잠긴다.
 *
 * 🔴 프로필이 CDP 없이 점유돼 있으면 죽이지 않는다.
 *    사람이 그 창에서 뭔가 하고 있을 수 있다. 상태만 돌려주고 판단은 호출자에게 맡긴다.
 *
 * 세션은 디스크에 남으므로 재기동해도 로그인이 유지된다(A 시험에서 확인).
 * 만료되면 login_required 로 잡히고, 그건 사람만 풀 수 있다.
 *
 * @returns {{ ok: boolean, started: boolean, reason?: string }}
 */
export async function ensureChrome({ waitMs = 30000, pollMs = 1000 } = {}) {
  if (await cdpAvailable()) return { ok: true, started: false }

  if (!browserAvailable()) return { ok: false, started: false, reason: STATUS.BROWSER_MISSING }

  // CDP 는 없는데 프로필은 쓰이고 있다 = 포트 없이 띄운 창이 있다.
  // 죽이면 사람의 작업을 날린다. 알리고 끝낸다.
  if (profileInUse()) {
    return { ok: false, started: false, reason: STATUS.CHROME_NOT_RUNNING }
  }

  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true })
  try { chmodSync(PROFILE_DIR, 0o700) } catch { /* 이미 맞으면 그만 */ }

  const child = spawn(CHROME_APP, chromeArgs(), { detached: true, stdio: 'ignore' })
  child.unref()

  // 포트가 열릴 때까지 기다린다. Chrome 은 뜨는 데 몇 초 걸린다
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
    if (await cdpAvailable()) return { ok: true, started: true }
  }
  return { ok: false, started: true, reason: STATUS.CHROME_NOT_RUNNING }
}

export async function probe({ timeoutMs = 45000, composerWaitMs = 20000, autoStart = false } = {}) {
  // launched 가 아니라 connected 다 — 이 코드는 브라우저를 띄우지 않는다
  const out = { connected: false, httpStatus: null, profileExists: profileExists(), via: 'cdp' }

  if (!browserAvailable()) {
    return { ...out, status: STATUS.BROWSER_MISSING }
  }
  // 🔴 Playwright 로 띄우지 않는다. 띄우면 프로필의 주인이 되고 세션 쿠키가 지워진다.
  //    autoStart 일 때도 일반 Chrome 을 spawn 할 뿐이다(ensureChrome).
  if (!(await cdpAvailable())) {
    if (!autoStart) {
      return { ...out, status: STATUS.CHROME_NOT_RUNNING, profileInUse: profileInUse() }
    }
    const r = await ensureChrome()
    out.chromeStarted = r.started
    if (!r.ok) {
      return { ...out, status: r.reason ?? STATUS.CHROME_NOT_RUNNING, profileInUse: profileInUse() }
    }
  }

  // 🔴 붙기 전에 탭이 하나는 있어야 한다. 0 개면 connectOverCDP 가
  //    Browser.setDownloadBehavior 에서 죽는다 (ensurePageTarget 주석 참조)
  const tab = await ensurePageTarget()
  out.tabOpened = tab.opened
  if (!tab.ok) return { ...out, status: STATUS.CHROME_NOT_RUNNING }

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
    // 🔴 원문 앞머리를 남긴다. 상태 코드만 남기면 무엇이 거부됐는지 영영 모른다.
    //    Protocol error 문구에는 URL·계정·쿠키가 실리지 않는다 — 첫 줄만 자른다.
    out.errorDetail = String(err?.message ?? '').split('\n')[0].slice(0, 200)
  } finally {
    // 🔴 close() 가 아니라 disconnect 다. 사람이 띄운 Chrome 을 죽이지 않는다
    try { await browser?.close() } catch { /* 연결만 끊는다 */ }
  }

  return out
}

/**
 * brief 를 ChatGPT 에 넘기고 마크다운 원고를 받아 파일로 저장한다.
 *
 * 🔴 원고를 이 프로세스가 "읽고 다시 쓰는" 경로가 없다.
 *    page.evaluate 가 돌려준 문자열을 그대로 writeFileSync 한다.
 *    사람도 다른 모델도 중간에서 원고를 손대지 않는다 — 전략 §13.1 의 역할 분리다.
 *
 * 실물로 겪은 실패 4가지를 처음부터 막는다.
 *   ① 프롬프트에 백틱 3개를 넣으면 에디터가 코드블록 모드로 들어가 Enter 가 줄바꿈이 된다
 *      → 백틱을 쓰지 않고, Enter 대신 전송 버튼을 클릭한다
 *   ② 업로드가 끝나기 전에 제출하면 제출이 통째로 무시된다
 *      → uploading 이 사라지고 파일명이 보일 때까지 기다린다
 *   ③ ChatGPT 가 --- 를 <hr> 로, ## 를 <h2> 로 렌더해 원본 표기가 사라진다
 *      → 처음부터 마크다운 코드블록으로 달라고 요청하고, pre code 의 textContent 를 회수한다
 *   ④ Cloudflare / 로그인 만료
 *      → 보내기 전에 probe 로 걸러낸다. 여기서는 재시도하지 않는다
 *
 * @returns {{ ok: boolean, reason?: string, length?: number, sent: boolean }}
 */
export async function fetchManuscript({ briefPath, outPath, promptText, requiredMarkers = [], timeoutMs = 300000 }) {
  if (!existsSync(briefPath)) return { ok: false, reason: 'brief_missing', sent: false }

  // probe 와 같은 이유로 탭을 먼저 확보한다 — 여기만 빠뜨리면 회수 단계에서 같은 실패가 난다
  const tab = await ensurePageTarget()
  if (!tab.ok) return { ok: false, reason: STATUS.CHROME_NOT_RUNNING, sent: false }

  const { chromium } = await import('playwright-core')
  let browser = null
  let sent = false

  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 15000 })
    const ctx = browser.contexts()[0]
    if (!ctx) return { ok: false, reason: 'no_context', sent }

    // 새 대화로 시작한다 — 앞 원고의 톤이 다음 글에 섞이지 않게
    const page = await ctx.newPage()
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#prompt-textarea', { timeout: 60000 })

    // ── 첨부 ──
    const inputs = await page.locator('input[type=file]').all()
    let attached = false
    for (const input of inputs) {
      try { await input.setInputFiles(briefPath); attached = true; break } catch { /* 다음 input */ }
    }
    if (!attached) { await page.close(); return { ok: false, reason: 'attach_failed', sent } }

    // ② 업로드 완료를 기다린다. 이걸 안 하면 제출이 통째로 무시된다
    try {
      await page.waitForFunction(() => {
        const t = document.body.innerText || ''
        return t.includes('brief') && !/업로드 중|Uploading/i.test(t)
      }, null, { timeout: 60000 })
    } catch { await page.close(); return { ok: false, reason: 'upload_timeout', sent } }

    // ── 전송 ──
    await page.locator('#prompt-textarea').click()
    await page.keyboard.insertText(promptText) // ① 백틱 없음
    await page.waitForTimeout(600)

    // ① Enter 를 쓰지 않는다
    const sendBtn = page.locator('[data-testid="send-button"], button[aria-label*="보내기"], button[aria-label*="Send"]').first()
    try { await sendBtn.click({ timeout: 15000 }) }
    catch { await page.close(); return { ok: false, reason: 'send_button_missing', sent } }
    sent = true

    // ── 완료 대기 ──
    // 판정은 텍스트가 아니라 불리언이다 — 길이 · 코드블록 · frontmatter 시작 · [CTA]
    try {
      await page.waitForFunction(() => {
        if (document.querySelector('[data-testid="stop-button"]')) return false
        const codes = [...document.querySelectorAll('pre code')]
        if (!codes.length) return false
        const t = codes[codes.length - 1].textContent || ''
        return t.length > 900 && t.includes('[CTA]') && t.trimStart().startsWith('---')
      }, null, { timeout: timeoutMs, polling: 3000 })
    } catch {
      await page.close()
      return { ok: false, reason: 'response_timeout', sent }
    }

    // ③ pre code 의 textContent — 렌더된 <hr>/<h2> 가 아니라 원본 표기가 그대로 있다
    const text = await page.evaluate(() => {
      const codes = [...document.querySelectorAll('pre code')]
      return codes[codes.length - 1].textContent || ''
    })
    await page.close()

    // 지정 문장이 빠졌으면 저장하지 않는다 — 원고를 고치지 않고 되돌린다
    const missing = requiredMarkers.filter((m) => !text.includes(m))
    if (missing.length) return { ok: false, reason: 'markers_missing', missingCount: missing.length, length: text.length, sent }

    // 🔴 여기서 처음이자 마지막으로 원고가 디스크에 닿는다. 문자열을 손대지 않는다
    writeFileSync(outPath, text)
    return { ok: true, length: text.length, sent }
  } catch (err) {
    return { ok: false, reason: 'connect_failed', errorName: err?.name ?? 'Error', sent }
  } finally {
    try { await browser?.close() } catch { /* 연결만 끊는다 */ }
  }
}

/**
 * 실패를 두 갈래로 나눈다. 대응이 완전히 다르기 때문이다.
 *
 * 전역(fatal) — 다음 slug 도 어차피 실패한다. 재시도하면 봇 감지만 악화된다 → **즉시 중단**
 * 개별(skip)  — 이 글만의 문제다. 나머지는 만들 수 있다 → **다음 slug 로 계속**
 *
 * 재고 확보가 목적이므로 하나가 막혔다고 전부 포기하지 않는다.
 * 다만 계정이 막힌 상태에서 계속 두드리는 것은 손해만 크다.
 */
export const FATAL_REASONS = new Set([
  STATUS.CLOUDFLARE_BLOCKED,
  STATUS.LOGIN_REQUIRED,
  STATUS.CHROME_NOT_RUNNING,
  STATUS.BROWSER_MISSING,
  STATUS.PERMISSION_BLOCKED,
  'connect_failed',
  'no_context',
])

export function isFatal(reason) {
  return FATAL_REASONS.has(reason)
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
