/**
 * ChatGPT web UI 세션 — 시스템 Chrome 을 headed 로 띄우고 접근 상태만 판정한다.
 *
 * 🔴 headless 를 쓰지 않는다. 쓸 수 없다.
 *    7-D-12 권한 시험에서 5개 조합을 돌린 결과, headless 는 프로필 유무와 무관하게
 *    Cloudflare 가 403 으로 막았고 headed 만 200 이 나왔다.
 *    우회(stealth·UA 위조)는 하지 않는다 — 탐지 회피이고 계정 정지를 감수할 이유가 없다.
 *
 * 🔴 번들 chromium 을 쓰지 않는다.
 *    Playwright 버전이 오르면 요구 브라우저 번호가 바뀌어 경로가 조용히 죽는다.
 *    실제로 npx 캐시의 1.63.0-alpha 가 chromium-1237 을 요구했고 로컬엔 1208·1217 뿐이었다.
 *    시스템 Chrome 은 경로가 고정이라 그 사고가 없다. playwright-core 만 있으면 된다.
 *
 * 🔴 아무것도 저장하지 않는다.
 *    스크린샷·DOM 덤프·HTML 본문·URL·쿠키·토큰 — 전부 남기지 않는다.
 *    Cloudflare challenge URL 의 __cf_chl_rt_tk 는 계정과 연결되고,
 *    로그인 화면 스크린샷에는 계정명이 찍힌다. 불리언 플래그와 상태 코드만 남긴다.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 프로필은 repo 밖에 둔다. 쿠키가 git 에 닿을 일이 없어야 한다 */
export const PROFILE_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran-chatgpt')

/** 시스템 Chrome. Playwright 버전과 무관하게 경로가 고정이다 */
export const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const CHATGPT_URL = 'https://chatgpt.com/'

/**
 * 접근 상태. 각각 대응이 다르다.
 *   ok                 정상 — 자동화를 이어갈 수 있다
 *   login_required     사람이 1회 로그인해야 한다. 무인으로 풀 수 없다
 *   cloudflare_blocked 봇 감지. 재시도하면 악화된다 — 즉시 중단
 *   browser_missing    Chrome 이 없거나 경로가 바뀌었다
 *   permission_blocked 브라우저 실행이 정책에 막혔다
 *   unknown            위 어디도 아니다. UI 가 바뀌었을 수 있다
 */
export const STATUS = {
  OK: 'ok',
  LOGIN_REQUIRED: 'login_required',
  CLOUDFLARE_BLOCKED: 'cloudflare_blocked',
  BROWSER_MISSING: 'browser_missing',
  PERMISSION_BLOCKED: 'permission_blocked',
  UNKNOWN: 'unknown',
}

/** Slack 알림 등급. 정상은 알리지 않는다 — 매일 오는 알림은 아무도 안 본다 */
export const SEVERITY = {
  [STATUS.OK]: null,
  [STATUS.LOGIN_REQUIRED]: 'BLOCKED',
  [STATUS.CLOUDFLARE_BLOCKED]: 'BLOCKED',
  [STATUS.BROWSER_MISSING]: 'ERROR',
  [STATUS.PERMISSION_BLOCKED]: 'ERROR',
  [STATUS.UNKNOWN]: 'ERROR',
}

/** 사람이 읽을 한 줄. 여기에도 URL·계정·경로를 넣지 않는다 */
export const MESSAGE = {
  [STATUS.OK]: 'ChatGPT 접근 정상',
  [STATUS.LOGIN_REQUIRED]: 'ChatGPT 로그인이 필요하다 — 사람이 전용 프로필에서 1회 로그인해야 한다',
  [STATUS.CLOUDFLARE_BLOCKED]: 'Cloudflare 가 막았다 — 재시도하지 않는다',
  [STATUS.BROWSER_MISSING]: 'Chrome 을 찾지 못했다',
  [STATUS.PERMISSION_BLOCKED]: '브라우저 실행이 막혔다',
  [STATUS.UNKNOWN]: 'ChatGPT 화면을 판정하지 못했다 — UI 가 바뀌었을 수 있다',
}

export function browserAvailable() {
  return existsSync(CHROME_APP)
}

export function profileExists() {
  return existsSync(PROFILE_DIR)
}

/** 실행 실패 메시지를 상태로 바꾼다. 원문을 그대로 흘리지 않는다 */
function classifyLaunchError(err) {
  const m = String(err?.message ?? '').toLowerCase()
  if (m.includes("executable doesn't exist") || m.includes('enoent')) return STATUS.BROWSER_MISSING
  if (m.includes('permission') || m.includes('eacces') || m.includes('denied')) return STATUS.PERMISSION_BLOCKED
  return STATUS.UNKNOWN
}

/**
 * 페이지 화면을 상태로 바꾼다.
 * 순서가 중요하다 — Cloudflare 화면은 본문이 비어 있어 로그인 판정이 먼저 걸리면 오진한다.
 */
export function classifyPage({ httpStatus, title, bodyHead, hasComposer }) {
  const t = String(title ?? '')
  const b = String(bodyHead ?? '')

  if (httpStatus === 403 || /잠시만 기다|Just a moment|Attention Required/i.test(t)) {
    return STATUS.CLOUDFLARE_BLOCKED
  }
  if (hasComposer) return STATUS.OK
  if (/무료로 가입|Log ?in|Sign ?up|로그인/i.test(b)) return STATUS.LOGIN_REQUIRED
  return STATUS.UNKNOWN
}

/**
 * 브라우저를 띄워 ChatGPT 접근 상태만 본다. 메시지를 보내지 않는다.
 *
 * @param {{ headless?: boolean, timeoutMs?: number }} opts
 *   headless 는 명시적으로 막혀 있다. true 를 주면 실행하지 않고 에러를 던진다.
 */
export async function probe({ headless = false, timeoutMs = 45000 } = {}) {
  if (headless) {
    throw new Error('headless 는 쓸 수 없다 — Cloudflare 가 막는다 (7-D-12 시험에서 확인)')
  }
  if (!browserAvailable()) {
    return { status: STATUS.BROWSER_MISSING, launched: false, httpStatus: null, profileExists: profileExists() }
  }

  const { chromium } = await import('playwright-core')
  let ctx = null
  const out = { launched: false, httpStatus: null, profileExists: profileExists() }

  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      channel: 'chrome',
      // 01:00 무인 실행에서 창이 화면을 가리지 않게 한다. 창은 뜨지만 보이지 않는다
      args: ['--window-position=-2400,-2400', '--window-size=1280,900'],
    })
    out.launched = true

    const page = ctx.pages()[0] ?? (await ctx.newPage())
    const res = await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    out.httpStatus = res?.status() ?? null
    await page.waitForTimeout(3000)

    // 판정에 필요한 최소한만 꺼낸다. 본문도 URL 도 반환하지 않는다
    const seen = await page.evaluate(() => ({
      title: document.title,
      bodyHead: (document.body.innerText || '').slice(0, 400),
      hasComposer: !!document.querySelector('#prompt-textarea'),
    }))
    out.status = classifyPage({ httpStatus: out.httpStatus, ...seen })
    out.hasComposer = seen.hasComposer
  } catch (err) {
    out.status = out.launched ? STATUS.UNKNOWN : classifyLaunchError(err)
    out.errorName = err?.name ?? 'Error'
  } finally {
    try { await ctx?.close() } catch { /* 닫기 실패는 판정에 영향이 없다 */ }
  }

  return out
}

/** 프로필 권한 안내. 쿠키가 든 디렉터리라 다른 사용자가 읽을 수 있으면 안 된다 */
export const PROFILE_SETUP_GUIDE = `
전용 프로필 준비 (창업자 1회)

  1. 디렉터리를 만들고 권한을 좁힌다
       mkdir -p "${PROFILE_DIR}"
       chmod 700 "${PROFILE_DIR}"

  2. 프로필로 Chrome 을 열어 ChatGPT 에 로그인한다
       node scripts/magazine-webui-runner.mjs --login

  3. 로그인 후 창을 닫는다. 쿠키는 OS 키체인으로 암호화돼 이 디렉터리에 남는다

🔴 무인으로 로그인할 방법은 없고, 있어서도 안 된다.
🔴 이 디렉터리를 repo 안으로 옮기지 않는다.
`.trim()
