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
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readlinkSync, mkdirSync, chmodSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { deliveryFingerprintOf } from './magazine-quarantine.mjs'
import { readConversationDom, createResponseWatch, extractManuscript } from './chatgpt-response.mjs'

/** 🔴 응답 관찰 — 간격 2초 · 연속 3번 같으면 안정 (전체 한도는 `timeoutMs` 그대로) */
export const RESPONSE_POLL_MS = 2000
export const RESPONSE_STABLE_POLLS = 3
/** 대화 주소만 남긴다 — 경로(`/c/<id>`) 외 쿼리·해시는 버린다 */
const safeUrl = (page) => { try { const u = new URL(page.url()); return u.origin + u.pathname } catch { return null } }
import {
  AUTOMATION_PROFILE_DIR, AUTOMATION_CDP_PORT, judgeAutomationProfile, readMarker,
  listChromeCommandLines, MISMATCH,
} from './chatgpt-automation-profile.mjs'

/** 프로필은 repo 밖에 둔다. 쿠키가 git 에 닿을 일이 없어야 한다 */
/**
 * 🔴 **자동화 전용 프로필** (2026-09-28 교체).
 *    옛 값 `soransoran-chatgpt` 는 실제로는 `내 Chrome` · `mogoyongseok@gmail.com` 이었다 —
 *    자동화 전용도, 소란소란 계정도 아니었다. 신원은
 *    `chatgpt-automation-profile.mjs` 가 정하고, 여기서는 그 값을 쓴다.
 *    **여기에 경로를 다시 적지 않는다** — 두 곳에 적으면 한쪽이 낡는다.
 */
export const PROFILE_DIR = AUTOMATION_PROFILE_DIR

/** 시스템 Chrome. Playwright 버전과 무관하게 경로가 고정이다 */
export const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const CHATGPT_URL = 'https://chatgpt.com/'

/**
 * CDP 포트. 이 포트로 떠 있는 Chrome 에만 붙는다.
 * 9222 는 흔히 쓰여 충돌하므로 이 프로젝트 전용 번호를 쓴다.
 */
/**
 * 🔴 **composer 선택자 정본.** 세 경로(probe · 원고 회수 · hero 생성)가 **이 하나**를 쓴다.
 *
 *    2026-09-27 회차에서 원고 회수 5건과 hero 2건이 전부 실패했다. probe 는 통과했는데
 *    그 둘만 죽었다 — probe 만 새 선택자를 알고 있었고 나머지는 `#prompt-textarea` 만
 *    봤기 때문이다. 계약이 세 군데로 갈라져 있으면 ChatGPT 가 DOM 을 바꿀 때마다
 *    **일부만 고쳐지고 일부는 조용히 죽는다.**
 *
 *    실측 (2026-09-27, 전용 프로필):
 *      #prompt-textarea                          → 0개
 *      [contenteditable="true"][role="textbox"]  → 1개
 *
 *    🔴 `[contenteditable="true"]` 만으로 넓히지 않는다. 그 속성은 제목·메모 같은 다른
 *       입력에도 붙는다 — 엉뚱한 칸에 원고를 써 넣는 사고가 난다. `role=textbox` 까지
 *       요구해 **입력 역할이 선언된 것**만 고른다.
 *    🔴 옛 선택자를 지우지 않는다. 되돌아올 수 있고, 둘 다 있어도 해는 없다.
 */
export const COMPOSER_SELECTOR = '#prompt-textarea, [contenteditable="true"][role="textbox"]'

/**
 * 🔴 **brief 를 파일로 붙이지 않는다 — 본문에 그대로 넣는다** (2026-09-28 · Codex P1).
 *
 *    2026-09-28 회차에서 막힌 6건 중 4건이 `[attach] upload_timeout` 이었다.
 *    원고에는 아무 문제가 없었다. 업로드는 우리가 통제할 수 없는 단계다 —
 *    파일 input 이 바뀌고, 칩 라벨이 바뀌고, 업로드가 조용히 멈춘다.
 *    그때마다 공급이 0이 된다.
 *
 *    brief 는 **글자**다. 글자를 파일로 감쌌다가 다시 푸는 과정 전체가
 *    없어도 되는 실패 지점이었다. 본문에 구분자와 함께 넣으면 업로드 단계가 사라진다.
 *
 * 🔴 **구분자는 눈에 띄고 본문에 없을 법한 것**이어야 한다. brief 안의 문장과
 *    섞이면 어디까지가 지시인지 모델도 우리도 알 수 없다.
 */
export const BRIEF_BEGIN = '===== BRIEF 시작 (여기부터 끝까지가 작성 지시다) ====='
export const BRIEF_END = '===== BRIEF 끝 ====='

export function buildManuscriptMessage({ promptText, briefText }) {
  return [promptText, '', BRIEF_BEGIN, String(briefText ?? '').trim(), BRIEF_END].join('\n')
}

/**
 * 넣은 글이 **실제로 들어갔는지** composer 에서 다시 읽어 확인한다.
 *
 * 🔴 **보내기 전에 확인한다.** 긴 글은 조용히 잘린다 — 삽입이 중간에 끊기거나
 *    에디터가 길이를 제한한다. 잘린 지시로 보내면 원고가 이상해지고,
 *    우리는 "모델이 이상하다" 고 읽는다. 잘렸으면 **한 글자도 보내지 않는다.**
 *
 * 🔴 `includes` 하나로 끝내지 않는다. 시작만 들어가고 뒤가 잘린 경우가 제일 흔하다 —
 *    끝 구분자와 **지정 문장 전부**를 같이 본다.
 */
export function judgeComposerReadback({ expected, actual, markers = [] }) {
  const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim()
  const a = norm(actual)
  const e = norm(expected)
  if (!a) return { ok: false, code: 'composer_empty', why: 'composer 가 비어 있다' }
  if (!a.includes(norm(BRIEF_BEGIN))) return { ok: false, code: 'composer_no_begin', why: '시작 구분자가 없다' }
  if (!a.includes(norm(BRIEF_END))) return { ok: false, code: 'composer_truncated', why: '끝 구분자가 없다 — 뒤가 잘렸다' }
  const missing = markers.filter((m) => m && !a.includes(norm(m)))
  if (missing.length) {
    return { ok: false, code: 'composer_markers_missing', why: `지정 문장 ${missing.length}개가 안 들어갔다` }
  }
  const ratio = e.length ? a.length / e.length : 0
  if (ratio < 0.95) return { ok: false, code: 'composer_short', why: `본문이 짧다 — ${a.length}/${e.length}자` }
  /**
   * 🔴 **더 긴 것도 실패다.** 앞 대화의 잔여 글자가 남아 있으면 우리가 쓰지 않은 문장이
   *    같이 전송된다. 새 탭이면 비어 있어야 한다 — 아니면 우리가 모르는 상태다.
   */
  if (ratio > 1.15) return { ok: false, code: 'composer_dirty', why: `본문이 길다 — ${a.length}/${e.length}자` }
  return { ok: true, ratio, length: a.length }
}

/**
 * 🔴 본문 삽입은 업로드가 아니다 — 네트워크를 타지 않는다. 오래 기다릴 이유가 없고,
 *    안 들어갔으면 **안 보내는 것**이 맞다. 시간을 늘려 초록을 만들지 않는다.
 */
export const COMPOSE_WAIT_MS = 15_000
export const COMPOSE_POLL_MS = 300

/** 정본 선택자로 composer 를 잡는다 — 여러 개면 첫 번째 */
export function composerLocator(page) {
  return page.locator(COMPOSER_SELECTOR).first()
}

/** 🔴 전용 포트. 사람 창(9333)과 섞이지 않는다 */
export const CDP_PORT = AUTOMATION_CDP_PORT
export const CDP_URL = `http://127.0.0.1:${CDP_PORT}`

/** --login 이 Chrome 에 넘기는 인자. --no-sandbox 도 --enable-automation 도 없다 */
export function chromeArgs(profileDir = PROFILE_DIR) {
  return [
    `--user-data-dir=${profileDir}`,
    /**
     * Chrome 154는 전용 user-data-dir의 마지막 사용값이 Guest Profile이면
     * 시작 URL 대신 profile picker를 열었다. 전용 폴더 안에서도 자동화가
     * 사용하는 실제 프로필은 Default 하나로 고정한다.
     */
    '--profile-directory=Default',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    /**
     * 🔴 **Chrome 자신의 로그인 권유를 끈다** (2026-09-28 실측).
     *    새 프로필로 처음 띄우면 Chrome 이 `chrome://signin-dice-web-intercept` 로
     *    **탭을 가로채** accounts.google.com 을 띄운다. 그러면 chatgpt.com 페이지가
     *    사라지고, 신원 관문은 "ChatGPT 가 아닌 페이지" 를 보고 막는다.
     *    자동화 프로필은 Chrome 계정에 로그인할 이유가 없다.
     */
    '--disable-features=DiceWebSigninInterception,SigninInterceptBubble',
    '--disable-sync',
    '--no-service-autorun',
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
 *   chrome_not_running  전용 Chrome 이 안 떠 있다. CDP 로 붙을 대상이 없다
 *   cdp_connect_timeout CDP 는 살아 있는데 연결이 제한 시간 안에 끝나지 않았다
 *   protocol_error      붙기는 했는데 CDP 명령이 거부됐다. Chrome 은 살아 있다
 *   unknown             위 어디도 아니다. UI 가 바뀌었을 수 있다
 */
export const STATUS = {
  OK: 'ok',
  LOGIN_REQUIRED: 'login_required',
  CLOUDFLARE_BLOCKED: 'cloudflare_blocked',
  BROWSER_MISSING: 'browser_missing',
  PERMISSION_BLOCKED: 'permission_blocked',
  CHROME_NOT_RUNNING: 'chrome_not_running',
  CDP_CONNECT_TIMEOUT: 'cdp_connect_timeout',
  /** 🔴 프로필 신원이 계약과 다르다 — 폴백하지 않고 여기서 끝낸다 */
  AUTOMATION_PROFILE_MISMATCH: MISMATCH,
  PROTOCOL_ERROR: 'protocol_error',
  UNKNOWN: 'unknown',
}

/**
 * `connectOverCDP` 제한 시간.
 *
 * 🔴 **15초는 현실과 맞지 않았다** (2026-09-16 실측).
 *    탭이 여러 개 열린 실제 창에 붙는 데 **45,418ms** 가 걸렸다.
 *    Playwright 는 붙으면서 모든 타깃의 컨텍스트를 만드므로 탭이 많을수록 길어진다.
 *    15초에서 끊긴 뒤 그 실패가 `chrome_not_running` 으로 분류돼
 *    **살아 있는 Chrome 을 죽은 것으로 보고**했다 — 원고 회수가 통째로 막혔다.
 *
 * 🔴 넉넉히 잡아도 손해가 없다. 진짜로 안 떠 있으면 HTTP 확인(`cdpAvailable`)이
 *    먼저 걸러 내므로, 이 시간을 늘려도 "없는 Chrome" 을 오래 기다리지 않는다.
 */
export const CDP_CONNECT_TIMEOUT_MS = 90_000

/** Slack 알림 등급. 정상은 알리지 않는다 — 매일 오는 알림은 아무도 안 본다 */
export const SEVERITY = {
  [STATUS.OK]: null,
  [STATUS.LOGIN_REQUIRED]: 'BLOCKED',
  [STATUS.CLOUDFLARE_BLOCKED]: 'BLOCKED',
  [STATUS.BROWSER_MISSING]: 'ERROR',
  [STATUS.PERMISSION_BLOCKED]: 'ERROR',
  [STATUS.CHROME_NOT_RUNNING]: 'BLOCKED',
  [STATUS.CDP_CONNECT_TIMEOUT]: 'ERROR',
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
  [STATUS.CDP_CONNECT_TIMEOUT]: 'Chrome 은 살아 있는데 CDP 연결이 제한 시간을 넘겼다 — 탭이 많으면 오래 걸린다',
  [STATUS.PROTOCOL_ERROR]: 'Chrome 에 붙었지만 CDP 명령이 거부됐다 — 로그의 원문을 본다',
  [STATUS.AUTOMATION_PROFILE_MISMATCH]:
    '자동화 전용 프로필이 아니다 — 사람 프로필·옛 폴더로는 돌지 않는다 (폴백 없음)',
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

/**
 * 프로필 잠금의 **실제 상태**.
 *
 * 🔴 **파일이 있다 ≠ 쓰고 있다** (2026-09-26 운영 사고).
 *    앞판은 `SingletonLock` 같은 파일이 **존재하기만 하면** "쓰는 중" 으로 보았다.
 *    그런데 이 파일들은 Chrome 이 비정상 종료(강제 종료·절전 중 kill·크래시)하면
 *    **그대로 남는다.** 그래서 죽은 잠금 하나 때문에 `ensureChrome` 이 자동 기동을
 *    통째로 포기했고, `autoStart: true` 인데도 `chrome_not_running` 이 나왔다.
 *    실측: lock → `…-22457`, PID 22457 은 존재하지 않았다. 원고 4건이 전송 0으로 끝났다.
 *
 * 🔴 **살아 있는 Chrome·프로필은 절대 죽이지 않는다.** 이 함수는 읽기만 한다.
 *    판정이 애매하면 LIVE 로 본다 — 남의 창을 빼앗는 쪽보다 한 회차 쉬는 쪽이 싸다.
 *
 * @returns {{state:'LIVE'|'STALE'|'NONE', pid:number|null, why:string}}
 */
/**
 * 지금 도는 프로세스 목록. `null` 은 **모른다** 는 뜻이다 (조회 실패).
 *
 * 🔴 `pgrep` 로 "있다/없다" 만 묻지 않는다. **명령줄이 필요하다** —
 *    PID 만으로는 그 PID 가 Chrome 인지, 우리 프로필을 쓰는지 알 수 없다.
 */
export function listProcesses() {
  const r = spawnSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8', maxBuffer: 1 << 24 })
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null
  const rows = []
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), command: m[2] })
  }
  return rows
}

/** 이 명령줄이 **Chrome 이면서 이 프로필을 쓰는가** */
function usesProfile(command, profileDir) {
  if (!command) return false
  const isChrome = /Google Chrome|Chromium|chrome_crashpad_handler/.test(command)
  return isChrome && command.includes(`user-data-dir=${profileDir}`)
}

/**
 * 프로필 잠금의 **실제 상태**.
 *
 * 🔴 **파일이 있다 ≠ 쓰고 있다** (2026-09-26 운영 사고).
 *    이 파일들은 Chrome 이 비정상 종료(강제 종료·절전 중 kill·크래시)하면 **그대로 남는다.**
 *    죽은 잠금 하나 때문에 `ensureChrome` 이 자동 기동을 통째로 포기했고,
 *    `autoStart: true` 인데도 `chrome_not_running` 이 나왔다.
 *    실측: lock → `…-22457`, PID 22457 은 존재하지 않았다. 원고 4건이 전송 0으로 끝났다.
 *
 * 🔴 **PID 가 살아 있다 ≠ 그 Chrome 이 살아 있다** (Codex 재검토 2026-09-26).
 *    PID 는 재사용된다. 죽은 잠금이 가리키던 번호를 **전혀 다른 프로그램**이 물려받으면,
 *    "PID 가 있다" 만 보는 판정은 그 프로그램을 우리 Chrome 으로 착각한다.
 *    그러면 다시 기동을 포기하고 같은 사고가 난다. 그래서 **명령줄까지 본다** —
 *    Chrome 이면서 이 `user-data-dir` 을 쓰는 프로세스일 때만 LIVE 다.
 *
 * 🔴 **살아 있는 Chrome·프로필은 절대 죽이지 않는다.** 이 함수는 읽기만 한다.
 *    판정이 **불가능**할 때만 보수적으로 LIVE 로 본다 — 남의 창을 빼앗는 쪽보다
 *    한 회차 쉬는 쪽이 싸다. "모른다" 와 "죽었다" 를 섞지 않는다.
 *
 * @param {{profileDir?:string, processes?:() => ({pid:number,command:string}[]|null)}} [deps]
 *        🔴 시험이 **실제 이 함수**를 임시 프로필·가짜 프로세스 목록으로 돌리기 위한 자리.
 * @returns {{state:'LIVE'|'STALE'|'NONE', pid:number|null, why:string}}
 */
export function profileLockState({ profileDir = PROFILE_DIR, processes = listProcesses } = {}) {
  if (!existsSync(profileDir)) return { state: 'NONE', pid: null, why: '프로필 폴더가 없다' }

  const present = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].filter((n) => {
    try { lstatSync(join(profileDir, n)); return true } catch { return false }
  })
  if (!present.length) return { state: 'NONE', pid: null, why: '잠금 파일이 없다' }

  const procs = processes()
  /** 🔴 목록을 못 얻었다 = **모른다.** 모르면 LIVE 다 (죽었다고 단정하지 않는다) */
  if (!Array.isArray(procs)) {
    return { state: 'LIVE', pid: null, why: '프로세스 목록을 얻지 못했다 — 쓰는 중일 수 있다고 본다' }
  }

  /** ① 이 프로필을 쓰는 Chrome 이 실재하는가. 본체든 Helper 든 하나면 충분하다 */
  const owners = procs.filter((x) => x.pid !== process.pid && usesProfile(x.command, profileDir))
  if (owners.length) {
    return { state: 'LIVE', pid: owners[0].pid, why: `이 프로필을 쓰는 Chrome ${owners.length}개가 돌고 있다` }
  }

  /** ② `SingletonLock` 은 `<host>-<pid>` 를 가리킨다. 그 PID 가 **무엇인지**까지 본다 */
  let target = null
  try { target = readlinkSync(join(profileDir, 'SingletonLock')) } catch { /* 없거나 심링크가 아니다 */ }
  if (target) {
    const pid = Number(target.slice(target.lastIndexOf('-') + 1))
    if (Number.isInteger(pid) && pid > 0) {
      const holder = procs.find((x) => x.pid === pid)
      if (!holder) return { state: 'STALE', pid, why: `잠금은 PID ${pid} 를 가리키는데 그런 프로세스가 없다` }
      /** 🔴 **PID 재사용** — 번호는 살아 있지만 우리 Chrome 이 아니다. 죽은 잠금이 맞다 */
      return { state: 'STALE', pid,
        why: `PID ${pid} 는 살아 있지만 이 프로필의 Chrome 이 아니다 (${holder.command.slice(0, 60)}) — 번호가 재사용됐다` }
    }
  }
  return { state: 'STALE', pid: null, why: `잠금 파일 ${present.join('·')} 만 남아 있고 쓰는 Chrome 이 없다` }
}

/** 전용 프로필로 Chrome 이 **실제로** 돌고 있는가 */
export function profileInUse() {
  return profileLockState().state === 'LIVE'
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
 *
 * 🔴 **timeout 을 chrome_not_running 으로 보내지 않는다** (2026-09-16 실측).
 *    CDP HTTP 엔드포인트가 200 을 주는데 `connectOverCDP` 만 제한 시간을 넘긴 경우가 있다.
 *    탭이 많으면 연결이 길어진다 — 실측 **45,418ms**. 15초 제한에서 끊긴 뒤
 *    그 실패가 "Chrome 이 안 떠 있다" 로 둔갑해 원고 회수가 통째로 막혔다.
 *    2026-08-27 에 한 번 겪은 오분류가 **다른 문구로 다시 들어온 것**이다.
 *
 *    그래서 `cdpAlive` 를 받아 가른다.
 *      CDP 살아 있음 + timeout → `cdp_connect_timeout` (Chrome 은 살아 있다)
 *      CDP 없음     + timeout → `chrome_not_running`  (붙을 대상이 없다)
 *
 * @param {unknown} err
 * @param {{cdpAlive?: boolean}} [ctx] CDP HTTP 엔드포인트가 응답했는가
 */
export function classifyConnectError(err, { cdpAlive = false } = {}) {
  const m = String(err?.message ?? '').toLowerCase()
  const isTimeout = /timeout \d+ms exceeded|timed? ?out/.test(m)

  if (isTimeout) {
    return cdpAlive ? STATUS.CDP_CONNECT_TIMEOUT : STATUS.CHROME_NOT_RUNNING
  }
  if (/econnrefused|econnreset|socket hang up|connection (refused|closed)/.test(m)) {
    // 🔴 소켓이 실제로 끊긴 것이다. CDP 가 살아 있다면 그 사이 죽은 것이므로 그대로 둔다.
    return STATUS.CHROME_NOT_RUNNING
  }
  if (m.includes('permission') || m.includes('eacces') || m.includes('denied')) return STATUS.PERMISSION_BLOCKED
  if (m.includes('protocol error')) return STATUS.PROTOCOL_ERROR
  return STATUS.UNKNOWN
}

/**
 * CDP 에 붙는다. **연결만 한다** — 판정도 페이지 조작도 하지 않는다.
 *
 * 🔴 실행기(`connector`)와 시계(`now`)를 주입받는다.
 *    45초를 실제로 기다리는 테스트는 만들 수 없다. 느린 연결·제한 시간 초과를
 *    **가짜 connector 로** 시험해야 이 경로에 회귀가 붙는다.
 *
 * @returns {Promise<{ok:boolean, browser?:object, status?:string, elapsedMs:number}>}
 */
export async function connectCdp({
  connector,
  timeoutMs = CDP_CONNECT_TIMEOUT_MS,
  isCdpAlive = cdpAvailable,
  now = () => Date.now(),
} = {}) {
  const started = now()
  try {
    const browser = await connector({ url: CDP_URL, timeout: timeoutMs })
    return { ok: true, browser, elapsedMs: now() - started }
  } catch (err) {
    // 🔴 실패한 **그 순간** CDP 가 살아 있었는지 다시 본다.
    //    연결 시도 전 값을 쓰면, 그 사이 Chrome 이 죽은 경우를 놓친다.
    const alive = await isCdpAlive()
    return { ok: false, status: classifyConnectError(err, { cdpAlive: alive }), elapsedMs: now() - started }
  }
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
 * ChatGPT 탭 하나를 CDP HTTP 엔드포인트로 연다 — **열기만** 한다. 입력·전송은 없다.
 * 🔴 Playwright 로 열지 않는다 (프로필 주인이 바뀌어 세션 쿠키가 지워진다 · ensurePageTarget 주석).
 * @returns {Promise<{ok:boolean, target?:object, why?:string}>}
 */
export async function openChatgptTarget({ timeoutMs = 10000 } = {}) {
  try {
    const res = await fetch(`${CDP_URL}/json/new?${CHATGPT_URL}`, { method: 'PUT', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { ok: false, why: `/json/new 가 ${res.status} 를 돌려줬다` }
    return { ok: true, target: await res.json() }
  } catch (e) {
    return { ok: false, why: `/json/new 실패: ${e?.message ?? e}` }
  }
}

/**
 * 🔴 **id 하나만 닫는다** (`/json/close/{id}`). 목록을 훑어 "비슷한 탭" 을 고르지 않는다 —
 *    무엇을 닫을지는 부르는 쪽이 자기가 연 target id 로만 정한다.
 */
export async function closeChatgptTarget(targetId, { timeoutMs = 5000 } = {}) {
  try {
    const res = await fetch(`${CDP_URL}/json/close/${encodeURIComponent(targetId)}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { ok: false, why: `/json/close 가 ${res.status} 를 돌려줬다` }
    return { ok: true }
  } catch (e) {
    return { ok: false, why: `/json/close 실패: ${e?.message ?? e}` }
  }
}

/** 닫은 뒤 정말 사라졌는지 보는 목록 — 읽기 실패와 0건을 구분한다 */
export async function listCdpTargets({ timeoutMs = 4000 } = {}) {
  try {
    const r = await fetch(`${CDP_URL}/json/list`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return { readOk: false, targets: null }
    return { readOk: true, targets: await r.json() }
  } catch { return { readOk: false, targets: null } }
}

/** CDP target id 모양 — 비었거나 이상한 값이면 닫기를 시도하지 않는다 (추측 금지) */
const TARGET_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

const isChatgptTarget = (t) => {
  try { return t?.type === 'page' && new URL(String(t?.url ?? '')).hostname.replace(/^www\./, '') === 'chatgpt.com' }
  catch { return false }
}

/**
 * 🔴 **page 0건 복구** (2026-10-07 자연 회차 · Codex 판정).
 *    전용 프로필·표식·권한·포트 주인이 모두 맞고 페이지 목록도 정상적으로 읽었는데 **page 만 0건**이면,
 *    신원 관문이 그 자리에서 MISMATCH 로 끝나 `ensurePageTarget` 에 영영 닿지 못했다.
 *    그날 producer·auto-register 가 같은 이유로 둘 다 멈췄다 (전송 0 · draft 0).
 *
 *    이제 판정이 `zeroPage` 를 달고 왔을 때만 — 그 외 어떤 불일치도 아닐 때만 —
 *      ① ChatGPT 탭 하나를 연다 (`/json/new`) → 실패면 안전 중단
 *      ② 돌아온 target 이 chatgpt.com page 가 아니면 안전 중단
 *      ③ **전체 신원을 처음부터 다시 본다.** 목록 반영이 늦으면 page 0 만 잠깐 더 기다린다
 *    읽기 실패·남의 페이지·잘못된 프로필·표식·권한·포트 주인이면 탭을 열지 않는다.
 *
 *    🔴 **실패하면 이번 호출이 연 target 하나만 닫는다** (Codex 재검토 P1).
 *       ②·③ 에서 멈추면 우리가 연 탭이 남아, 다음 회차가 그 탭 덕에 page 0 관문을 통과해 버린다.
 *       닫는 대상은 `/json/new` 가 돌려준 id 하나뿐이다 — 기존 page·나중에 나타난 page 는 닫지 않고,
 *       id 가 없으면 아무것도 닫지 않는다. 닫기 실패·잔존은 `bootstrap` 에 남기고 실패로 돌려준다.
 *       성공하면 연 탭을 그대로 둔다 (그 탭이 붙을 창이다).
 *
 * @returns {Promise<object>} verifyProfileFn 과 같은 모양 + `bootstrap` 기록
 */
export async function verifyWithZeroPageBootstrap(verifyProfileFn, args, {
  openTargetFn = openChatgptTarget, closeTargetFn = closeChatgptTarget, listTargetsFn = listCdpTargets,
  settleTries = 10, settleMs = 300,
} = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const first = await verifyProfileFn(args)
  if (first.ok || first.zeroPage !== true) return first
  const opened = await openTargetFn()
  if (!opened.ok) {
    // 열렸는지조차 모른다 — 닫을 id 가 없으니 추측해서 닫지 않는다
    return { ...first, zeroPage: false, why: `page 0건 복구 실패 — ChatGPT 탭을 열지 못했다 (${opened.why ?? '사유 없음'})`, bootstrap: { attempted: true, opened: false, closeAttempted: false } }
  }
  const targetId = opened.target?.id ?? null
  /** 🔴 이번 호출이 연 target 하나만 닫고, 정말 사라졌는지 목록으로 확인한다 */
  const cleanup = async () => {
    if (typeof targetId !== 'string' || !TARGET_ID_RE.test(targetId)) {
      return { closeAttempted: false, closed: false, residue: 'unknown', closeWhy: 'target id 가 없거나 불명확하다 — 다른 target 을 추측해 닫지 않는다' }
    }
    const c = await closeTargetFn(targetId)
    if (!c?.ok) return { closeAttempted: true, closed: false, residue: 'present', closeWhy: c?.why ?? '사유 없음' }
    for (let i = 0; i <= settleTries; i++) {
      const listed = await listTargetsFn()
      if (!listed?.readOk) return { closeAttempted: true, closed: true, residue: 'unknown', closeWhy: '닫은 뒤 목록을 읽지 못했다' }
      if (!listed.targets.some((t) => t?.id === targetId)) return { closeAttempted: true, closed: true, residue: 'none' }
      if (i < settleTries) await sleep(settleMs)
    }
    return { closeAttempted: true, closed: true, residue: 'present', closeWhy: '닫은 뒤에도 목록에 남아 있다' }
  }
  const failWith = async (base, why, extra = {}) => {
    const cl = await cleanup()
    const tail = cl.residue === 'none' ? '연 탭은 닫았다' : `연 탭이 남았을 수 있다 (${cl.closeWhy})`
    return { ...base, ok: false, zeroPage: false, why: `${why} — ${tail}`, bootstrap: { attempted: true, opened: true, targetId, ...extra, ...cl } }
  }
  if (!isChatgptTarget(opened.target)) {
    return failWith(first, `page 0건 복구 실패 — 열린 target 이 ChatGPT page 가 아니다 (${String(opened.target?.url ?? '').slice(0, 60)})`,
      { targetUrl: opened.target?.url ?? null })
  }
  let again = await verifyProfileFn(args)
  for (let i = 0; i < settleTries && !again.ok && again.zeroPage === true; i++) {
    await sleep(settleMs)
    again = await verifyProfileFn(args)
  }
  if (!again.ok) return failWith(again, `page 0건 복구 뒤 신원 재검사 실패 — ${again.why}`)
  return { ...again, bootstrap: { attempted: true, opened: true, targetId, closeAttempted: false } }
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
export async function ensureChrome({
  waitMs = 30000, pollMs = 1000,
  /** 🔴 시험이 **진짜 Chrome 을 띄우지 않고** 기동 여부를 확인하기 위한 자리. 기본은 실제 spawn */
  spawnFn = spawn,
  /** 🔴 시험이 포트 판정을 고정하기 위한 자리. 기본은 실제 CDP 조회 */
  cdpCheck = cdpAvailable,
  /**
   * 🔴 브라우저 존재 판정도 주입점이다. CI 러너(Linux)에는 macOS Chrome 경로가 없다 —
   *    시험이 이 함수를 그대로 쓰면 **환경을 읽게 되어** 로컬 초록 / CI 빨강이 된다.
   *    기본은 실제 확인이고, 판정 자체는 그대로 돈다.
   */
  browserCheck = browserAvailable,
  /**
   * 🔴 프로필 경로도 주입점이다. 시험이 실제 프로필을 읽으면 **그때 Chrome 이 떠 있었는지**에
   *    따라 결과가 달라진다 (2026-09-27: 살아 있는 프로필 때문에 죽은 잠금 반례가 깨졌다).
   */
  profileDir = PROFILE_DIR,
  /** 🔴 프로세스 목록도 그대로 넘긴다 — 잠금 판정을 시험이 고정할 수 있어야 한다 */
  processes,
  /**
   * 🔴 **신원 판정의 정본은 여기다** (2026-09-28 · P0-1).
   *    앞판은 `cdpAvailable()` 하나만 보고 `ok` 를 돌려줬다. 그래서 **이미 떠 있기만 하면**
   *    폴더·표식·포트 주인·열린 페이지를 하나도 보지 않았고,
   *    `magazine-hero-runner` 처럼 `ensureChrome` 을 직접 부르는 경로는
   *    **엉뚱한 프로필에 그대로 붙었다.** 모든 호출 경로가 여기를 지나므로
   *    검사도 여기 있어야 한다.
   */
  verifyProfileFn = verifyAutomationProfile,
  /** 'operate' 는 무인 실행 · 'login' 은 사람이 처음 로그인하는 중 */
  mode = 'operate',
  /** 🔴 page 0건 복구가 탭을 여는 자리 — 시험은 가짜를 넣는다. 운영은 실제 `/json/new` */
  openTargetFn = openChatgptTarget,
  /** 🔴 복구가 실패했을 때 자기가 연 탭을 닫는 자리 · 닫혔는지 보는 목록 — 시험은 가짜를 넣는다 */
  closeTargetFn = closeChatgptTarget,
  listTargetsFn = listCdpTargets,
} = {}) {
  const port = CDP_PORT
  /** 🔴 모든 신원 검사가 같은 page 0건 복구 계약을 지난다 — hero 경로도 여기를 지난다 */
  const verify = (a) => verifyWithZeroPageBootstrap(verifyProfileFn, a, { openTargetFn, closeTargetFn, listTargetsFn })
  /**
   * ① 🔴 **띄우기 전에 본다.** 폴더·표식·권한·포트 주인이 맞아야 spawn 한다.
   *    표식이 없으면 **여기서 만들지 않는다** — 표식 생성은 `--login` 만 한다.
   *    자동 실행이 표식을 만들어 주면 "확인했다" 가 아니라 "덮어썼다" 가 된다.
   */
  const pre = await verify({ profileDir, port, mode, requireRunning: false })
  if (!pre.ok) {
    return { ok: false, started: false, reason: STATUS.AUTOMATION_PROFILE_MISMATCH, why: pre.why, identity: pre }
  }

  const alive = await cdpCheck()
  if (alive) {
    /**
     * ② 🔴 **떠 있어도 그냥 통과시키지 않는다.** 살아 있는 포트가 우리 창이라는 보장은 없다.
     *    떠 있는 상태 그대로 **전체 신원**을 다시 본다 (열린 페이지 포함).
     */
    const post = await verify({ profileDir, port, mode, requireRunning: true })
    if (!post.ok) {
      /**
       * 🔴 앞 검사(pre)에서 **이 호출이 연** 탭이 있으면 그 id 하나만 닫는다.
       *    pre 가 탭을 열지 않았으면(기존 page 였으면) 아무것도 닫지 않는다.
       */
      const own = pre.bootstrap?.opened === true && pre.bootstrap.closeAttempted === false ? pre.bootstrap.targetId : null
      let zeroPageCleanup
      if (own && TARGET_ID_RE.test(own)) {
        const c = await closeTargetFn(own)
        zeroPageCleanup = { targetId: own, closeAttempted: true, closed: c?.ok === true, ...(c?.ok ? {} : { closeWhy: c?.why ?? '사유 없음' }) }
      }
      return { ok: false, started: false, reason: STATUS.AUTOMATION_PROFILE_MISMATCH, why: post.why, identity: post, ...(zeroPageCleanup ? { zeroPageBootstrap: { ...pre.bootstrap, cleanup: zeroPageCleanup } } : {}) }
    }
    // 🔴 page 0건 복구는 앞 검사(pre)에서 일어났을 수 있다 — 기록을 잃지 않는다
    const zeroPageBootstrap = pre.bootstrap ?? post.bootstrap
    return { ok: true, started: false, identity: post, ...(zeroPageBootstrap ? { zeroPageBootstrap } : {}) }
  }
  if (!browserCheck()) return { ok: false, started: false, reason: STATUS.BROWSER_MISSING }

  /**
   * CDP 는 없는데 프로필을 **실제로** 쓰는 프로세스가 있다 = 포트 없이 띄운 창이 있다.
   * 죽이면 사람의 작업을 날린다. 알리고 끝낸다.
   *
   * 🔴 죽은 잠금(STALE)은 여기서 멈출 이유가 아니다. Chrome 은 시작할 때 죽은 잠금을
   *    스스로 거둬 간다 — 우리가 지울 것도 없다. 그냥 띄우면 된다.
   */
  const lock = profileLockState({ profileDir, ...(processes ? { processes } : {}) })
  if (lock.state === 'LIVE') {
    return { ok: false, started: false, reason: STATUS.CHROME_NOT_RUNNING, lock }
  }

  const child = spawnFn(CHROME_APP, chromeArgs(profileDir), { detached: true, stdio: 'ignore' })
  child?.unref?.()
  // 🔴 죽은 잠금 위에서 띄운 경우를 기록에 남긴다 — 다음 사고 때 이 줄이 단서다
  const startedOverStaleLock = lock.state === 'STALE'

  // 포트가 열릴 때까지 기다린다. Chrome 은 뜨는 데 몇 초 걸린다
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
    if (!(await cdpCheck())) continue
    /**
     * ③ 🔴 **띄운 뒤에도 다시 본다.** 우리가 spawn 했다고 해서 붙는 창이 우리 창이라는
     *    보장은 없다 — 같은 포트를 다른 프로세스가 먼저 잡았을 수 있다.
     */
    const post = await verify({ profileDir, port, mode, requireRunning: true })
    if (!post.ok) {
      return { ok: false, started: true, reason: STATUS.AUTOMATION_PROFILE_MISMATCH, why: post.why, identity: post, startedOverStaleLock, lock }
    }
    return { ok: true, started: true, startedOverStaleLock, lock, identity: post, ...(post.bootstrap ? { zeroPageBootstrap: post.bootstrap } : {}) }
  }
  return { ok: false, started: true, reason: STATUS.CHROME_NOT_RUNNING, startedOverStaleLock, lock }
}

export async function verifyAutomationProfile({
  profileDir = PROFILE_DIR,
  port = CDP_PORT,
  requireRunning = true,
  /** 🔴 'operate' 는 무인 실행 · 'login' 은 사람이 처음 로그인하는 중 */
  mode = 'operate',
  readMarkerFn = readMarker,
  commandLinesFn = listChromeCommandLines,
  /**
   * 🔴 **읽기 실패와 "0건" 을 구분해 돌려준다.** 예전처럼 `catch → []` 로 뭉개면
   *    "못 읽었다" 가 "페이지가 없다" 가 되고, 그게 다시 정상으로 통과한다.
   */
  listTargets = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) })
      if (!r.ok) return { readOk: false, pages: null }
      return { readOk: true, pages: await r.json() }
    } catch { return { readOk: false, pages: null } }
  },
  portInUseFn = async () => {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) })
      return true
    } catch { return false }
  },
} = {}) {
  const m = readMarkerFn(profileDir)
  const portInUse = await portInUseFn()
  const t = portInUse ? await listTargets() : { readOk: true, pages: [] }
  return judgeAutomationProfile({
    profileDir, port, mode,
    marker: m.ok ? m.marker : null,
    markerMode: m.ok ? m.mode : null,
    dirMode: m.ok ? m.dirMode : null,
    commandLines: commandLinesFn(),
    pages: t.pages, pagesReadOk: t.readOk, portInUse, requireRunning,
  })
}

export async function probe({
  timeoutMs = 45000,
  composerWaitMs = 20000,
  autoStart = false,
  // 🔴 주입 가능하게 둔다. 정본은 CDP_CONNECT_TIMEOUT_MS 하나다
  connectTimeoutMs = CDP_CONNECT_TIMEOUT_MS,
  /** 🔴 시험이 신원 판정을 갈아끼우는 자리. 운영은 실제 검증이다 */
  verifyProfileFn = verifyAutomationProfile,
  /** 🔴 page 0건 복구가 탭을 여는 자리 — 시험은 가짜를 넣는다 */
  openTargetFn = openChatgptTarget,
  closeTargetFn = closeChatgptTarget,
  listTargetsFn = listCdpTargets,
  /** 🔴 브라우저 존재 판정 — 시험이 신원 관문 다음 단계에서 멈추게 하는 자리 (실제 Chrome 에 닿지 않게) */
  browserCheck = browserAvailable,
} = {}) {
  // launched 가 아니라 connected 다 — 이 코드는 브라우저를 띄우지 않는다
  const out = { connected: false, httpStatus: null, profileExists: profileExists(), via: 'cdp' }

  /**
   * 🔴 **무엇보다 먼저 신원을 본다.** 여기서 막히면 브라우저를 켜지도, 붙지도,
   *    한 글자도 보내지도 않는다. 2026-09-28 에 자동화가 **다른 계정 프로필**로
   *    돌고 있던 것을 아무도 몰랐다 — 로그만 보면 정상이었기 때문이다.
   */
  const identity = await verifyWithZeroPageBootstrap(verifyProfileFn, { requireRunning: false }, { openTargetFn, closeTargetFn, listTargetsFn })
  if (!identity.ok) {
    return { ...out, status: STATUS.AUTOMATION_PROFILE_MISMATCH, errorDetail: identity.why, identity }
  }
  if (identity.bootstrap) out.zeroPageBootstrap = identity.bootstrap

  if (!browserCheck()) {
    return { ...out, status: STATUS.BROWSER_MISSING }
  }
  // 🔴 Playwright 로 띄우지 않는다. 띄우면 프로필의 주인이 되고 세션 쿠키가 지워진다.
  //    autoStart 일 때도 일반 Chrome 을 spawn 할 뿐이다(ensureChrome).
  if (!(await cdpAvailable())) {
    if (!autoStart) {
      return { ...out, status: STATUS.CHROME_NOT_RUNNING, profileInUse: profileInUse() }
    }
    const r = await ensureChrome({ verifyProfileFn, openTargetFn, closeTargetFn, listTargetsFn })
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
  /** 🔴 이 호출이 **직접 연** 탭. 기존 탭을 재사용했으면 null 이다 */
  let openedPage = null

  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: connectTimeoutMs })
    out.connected = true

    const ctx = browser.contexts()[0]
    if (!ctx) return { ...out, status: STATUS.UNKNOWN }

    // 이미 열려 있는 탭 중 ChatGPT 를 찾는다. 없으면 새 탭을 연다
    const pages = ctx.pages()
    let page = pages.find((pg) => pg.url().includes('chatgpt.com'))
    if (!page) {
      page = await ctx.newPage()
      // 🔴 **내가 연 탭이다.** 끝나면 내가 닫는다 — 남의 탭은 건드리지 않는다
      openedPage = page
      const res = await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      out.httpStatus = res?.status() ?? null
    } else {
      // 이미 떠 있던 탭이면 HTTP 상태를 모른다. 화면 신호로만 판정한다
      out.httpStatus = 200
    }

    // SPA 라 composer 가 늦게 뜬다. 고정 대기로는 못 잡아 login_required 로 오진했다
    try {
      await page.waitForSelector(COMPOSER_SELECTOR, { timeout: composerWaitMs })
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
    // 🔴 실패한 그 순간 CDP 가 살아 있었는지 다시 본다 — timeout 오분류를 막는다
    out.status = out.connected
      ? STATUS.UNKNOWN
      : classifyConnectError(err, { cdpAlive: await cdpAvailable() })
    out.errorName = err?.name ?? 'Error'
    // 🔴 원문 앞머리를 남긴다. 상태 코드만 남기면 무엇이 거부됐는지 영영 모른다.
    //    Protocol error 문구에는 URL·계정·쿠키가 실리지 않는다 — 첫 줄만 자른다.
    out.errorDetail = String(err?.message ?? '').split('\n')[0].slice(0, 200)
  } finally {
    /**
     * 🔴 **내가 연 탭은 내가 닫는다** (2026-09-27 탭 누수).
     *    앞판은 닫지 않았다. 실패한 회차마다 `chatgpt.com/` 루트 탭이 하나씩 쌓여
     *    실측에서 8개가 남아 있었다. 기존 탭을 재사용한 경우에는 닫지 않는다 —
     *    사람이 보고 있던 창일 수 있다.
     */
    try { await openedPage?.close() } catch { /* 이미 닫혔으면 그만 */ }
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
 * 🔴 validate 는 **쓰기 직전**에 부른다.
 *    저장한 뒤 검사하면 오염된 원고가 이미 디스크에 있고, 다음 단계가 그것을 받는다.
 *    실제로 ChatGPT 인용 마커가 그렇게 흘러가 production 에 공개된 적이 있다.
 *    받은 문자열을 여기서 고치지 않는다 — 통과하거나, 저장하지 않거나 둘 중 하나다.
 *
 * @param {(text: string) => { ok: boolean, reasons?: {code:string, why:string}[] }} [validate]
 * @returns {{ ok: boolean, reason?: string, length?: number, sent: boolean }}
 */
/**
 * 저장 전 관문 — 🔴 회수(`fetchManuscript`)와 무전송 회수(`recoverManuscript`)가 **같은 함수**를 지난다.
 *    지정 문장(requiredMarkers) → 원고 관문(frontmatter·H2·CTA). 원고를 고치지 않고 판정만 한다.
 */
export function checkManuscript(text, { requiredMarkers = [], validate = null } = {}) {
  const missing = requiredMarkers.filter((m) => !text.includes(m))
  if (missing.length) return { ok: false, reason: 'markers_missing', missingCount: missing.length }
  if (validate) {
    const v = validate(text)
    if (!v.ok) return { ok: false, reason: 'invalid_manuscript', invalid: v.reasons ?? [] }
  }
  return { ok: true }
}

/** 신원 대조용 정규화 — 공백·코드 표시 차이만 지운다 (사용자 말풍선은 마크다운 일부를 그려 보여 준다) */
const identityNorm = (t) => String(t ?? '').replace(/`/g, '').replace(/\s+/g, ' ').trim()

/**
 * 🔴 **이미 온 응답을 다시 보내지 않고 회수한다** (2026-09-30 · 무전송 회수).
 *
 *    보낸 원고가 판독 결함으로 저장되지 못했을 때, 같은 brief 를 다시 보내면 중복 전송이다.
 *    그래서 **신원이 확정된 기존 대화 하나**만 열어 원문을 읽는다.
 *
 *    🔴 이 함수는 composer·send·키보드를 **참조하지 않는다** — 전송 경로가 코드에 없다.
 *    🔴 신원: 주소가 `https://chatgpt.com/c/<id>` 그대로 열리고 · 사용자 메시지 1 · assistant 응답 1 ·
 *       그 사용자 메시지가 **우리가 보낸 메시지와 같다**(공백·코드 표시만 무시). 하나라도 어긋나면 저장 0.
 *    🔴 원문은 `extractManuscript` 하나로 꺼내고, 관문은 `checkManuscript` 하나로 본다 — 회수 경로와 같다.
 *    🔴 이미 draft 가 있으면 덮지 않는다.
 */
export async function recoverManuscript({
  conversationUrl, expectedMessage, outPath, requiredMarkers = [], validate = null,
  connectTimeoutMs = CDP_CONNECT_TIMEOUT_MS, settleMs = 6000, connect, ensureTab,
  /** 🔴 true 면 신원·원문·관문까지만 보고 **쓰지 않는다** (실제 회수 전 점검) */
  checkOnly = false,
}) {
  if (!/^https:\/\/chatgpt\.com\/c\/[0-9a-f-]{20,}$/.test(String(conversationUrl ?? ''))) {
    return { ok: false, reason: 'recover_bad_url', sent: false, errorDetail: '대화 주소가 https://chatgpt.com/c/<id> 형태가 아니다' }
  }
  if (!expectedMessage) return { ok: false, reason: 'recover_no_expected_message', sent: false }
  if (existsSync(outPath)) return { ok: false, reason: 'recover_draft_exists', sent: false, errorDetail: 'draft.md 가 이미 있다 — 덮지 않는다' }
  const tab = await (ensureTab ?? ensurePageTarget)()
  if (!tab.ok) return { ok: false, reason: STATUS.CHROME_NOT_RUNNING, sent: false }
  const connectFn = connect ?? (async (url, opts) => {
    const { chromium } = await import('playwright-core')
    return chromium.connectOverCDP(url, opts)
  })
  let browser = null
  let page = null
  let stage = 'connect'
  try {
    browser = await connectFn(CDP_URL, { timeout: connectTimeoutMs })
    const ctx = browser.contexts()[0]
    if (!ctx) return { ok: false, reason: 'no_context', stage, sent: false }
    stage = 'open-conversation'
    page = await ctx.newPage()
    await page.goto(conversationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(settleMs)
    const where = { conversationUrl: safeUrl(page) }
    if (where.conversationUrl !== conversationUrl) {
      return { ok: false, reason: 'recover_identity_mismatch', stage, sent: false, ...where, errorDetail: '다른 주소로 열렸다 — 저장하지 않는다' }
    }
    stage = 'read'
    const snap = await page.evaluate(readConversationDom).catch(() => null)
    if (!snap?.readOk || snap.stop) {
      return { ok: false, reason: 'response_unreadable', stage, sent: false, ...where, errorDetail: '대화를 읽지 못했거나 아직 생성 중이다' }
    }
    const users = snap.units.filter((u) => u.role === 'user')
    const assistants = snap.units.filter((u) => u.role === 'assistant')
    if (users.length !== 1 || assistants.length !== 1 || !assistants[0].id) {
      return { ok: false, reason: 'recover_identity_mismatch', stage, sent: false, ...where,
        errorDetail: `사용자 ${users.length} · 응답 ${assistants.length} — 한 번 보낸 한 대화가 아니다` }
    }
    if (identityNorm(users[0].text) !== identityNorm(expectedMessage)) {
      return { ok: false, reason: 'recover_identity_mismatch', stage, sent: false, ...where, assistantMessageId: assistants[0].id,
        errorDetail: '대화의 사용자 메시지가 우리가 보낸 메시지와 다르다 — 저장하지 않는다' }
    }
    const ex = extractManuscript(assistants[0])
    const at = { ...where, assistantMessageId: assistants[0].id, responseForm: ex.ok ? ex.via : ex.form }
    if (!ex.ok) return { ok: false, reason: ex.code, stage, sent: false, ...at, errorDetail: ex.why }
    const g = checkManuscript(ex.text, { requiredMarkers, validate })
    if (!g.ok) return { ...g, stage: 'validate', sent: false, length: ex.text.length, ...at }
    if (checkOnly) return { ok: true, checkOnly: true, sent: false, length: ex.text.length, via: ex.via, ...at }
    stage = 'write'
    writeFileSync(outPath, ex.text, { flag: 'wx' })
    return { ok: true, sent: false, length: ex.text.length, via: ex.via, ...at }
  } catch (err) {
    return { ok: false, reason: 'connect_failed', stage, sent: false,
      errorName: err?.name ?? 'Error', errorDetail: String(err?.message ?? '').split('\n')[0].slice(0, 200) }
  } finally {
    try { await page?.close() } catch { /* 이미 닫혔으면 그만 */ }
    try { await browser?.close() } catch { /* 연결만 끊는다 */ }
  }
}

export async function fetchManuscript({
  briefPath, outPath, promptText, requiredMarkers = [], validate = null, timeoutMs = 300000,
  connectTimeoutMs = CDP_CONNECT_TIMEOUT_MS,
  /**
   * 🔴 **실제 이 함수를 시험이 돌리기 위한 자리.** 가짜 browser/page 를 넣어
   *    composer·send·응답 대기 예외를 각각 주입하고, **자기가 연 탭만 1회 닫는지**를
   *    실제 경로로 확인한다. 시험 안에서 계약을 흉내 낸 함수를 검사하면
   *    제품이 틀려도 초록이 뜬다 (2026-09-27 Codex 재검토 지적).
   *    기본값은 실제 CDP 연결과 실제 탭 확보 그대로다.
   * @type {((url: string, opts: object) => Promise<object>) | undefined}
   */
  connect,
  /** @type {(() => Promise<{ok: boolean}>) | undefined} */
  ensureTab,
  /**
   * 🔴 **send 를 누르기 직전에 불린다.** 여기서 단일 격리 장부에 원자적으로 적는다.
   *    실패하면 누르지 않는다. 이 함수는 장부를 모른다 — 호출부가 준다.
   * @type {((ctx: {messageFingerprint: string|null, stage: string}) => Promise<{ok: boolean, why?: string}>) | undefined}
   */
  onBeforeSend,
  /**
   * 🔴 **호출부가 전송 판정에 쓴 바로 그 메시지** (2026-09-28 · 재생성 HOLD).
   *    여기서 다시 조립하면 판정한 글자와 보내는 글자가 갈라질 수 있다 —
   *    갈라진 날 지문이 달라져 **막아야 할 것을 못 막는다.** 주면 그대로 보낸다.
   */
  message: plannedMessage = null,
  /**
   * 🔴 응답 관찰 간격과 "안정됐다" 로 볼 연속 동일 관찰 수. 전체 한도(`timeoutMs`)는 그대로다 —
   *    시간을 늘려 해결하지 않는다. 시험은 짧은 값을 준다.
   */
  pollMs = RESPONSE_POLL_MS,
  stablePolls = RESPONSE_STABLE_POLLS,
}) {
  if (!existsSync(briefPath)) return { ok: false, reason: 'brief_missing', sent: false }

  // probe 와 같은 이유로 탭을 먼저 확보한다 — 여기만 빠뜨리면 회수 단계에서 같은 실패가 난다
  const tab = await (ensureTab ?? ensurePageTarget)()
  if (!tab.ok) return { ok: false, reason: STATUS.CHROME_NOT_RUNNING, sent: false }

  const connectFn = connect ?? (async (url, opts) => {
    const { chromium } = await import('playwright-core')
    return chromium.connectOverCDP(url, opts)
  })
  let browser = null
  let page = null
  let sent = false
  /** 🔴 어디까지 갔는지 남긴다 — `connect_failed` 한 단어로는 고칠 수가 없다 */
  let stage = 'connect'
  /** 🔴 실제로 composer 에 넣은 글자의 지문. 보내기 전에도 만들어 둔다 */
  let messageFingerprint = null
  /** 🔴 누르기 전에 장부에 적었는가. 적었다면 그 뒤 실패는 **전송 여부를 확정할 수 없다** */
  let preRecorded = false

  try {
    browser = await connectFn(CDP_URL, { timeout: connectTimeoutMs })
    const ctx = browser.contexts()[0]
    if (!ctx) return { ok: false, reason: 'no_context', stage, sent }

    // 새 대화로 시작한다 — 앞 원고의 톤이 다음 글에 섞이지 않게
    stage = 'open-tab'
    page = await ctx.newPage()
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    stage = 'composer'
    await page.waitForSelector(COMPOSER_SELECTOR, { timeout: 60000 })

    // ── 본문 작성 (🔴 첨부하지 않는다) ──
    stage = 'compose'
    /**
     * 🔴 **`setInputFiles` 를 부르지 않는다.** brief 를 파일로 올리던 경로가
     *    2026-09-28 공급 0건의 최대 원인이었다 (`upload_timeout` 4건).
     *    글자는 글자로 넣는다 — 업로드라는 단계 자체를 없앤다.
     */
    const message = plannedMessage
      ?? buildManuscriptMessage({ promptText, briefText: readFileSync(briefPath, 'utf8') })
    /**
     * 🔴 **보낸 글자의 지문**을 만들어 결과에 싣는다 (P0-1).
     *    상위는 이 값으로 "같은 글을 또 보내는가" 를 판정한다.
     *    여기서 만들지 않고 상위가 다시 조립하면 언젠가 갈라진다 —
     *    갈라진 날 지문이 달라져 **막아야 할 것을 못 막는다.**
     */
    messageFingerprint = deliveryFingerprintOf(message)
    await composerLocator(page).click()
    await page.keyboard.insertText(message)

    /**
     * 🔴 **보내기 전에 다시 읽는다.** 긴 글은 조용히 잘린다.
     *    React 가 상태를 반영할 시간이 필요하므로 **한 번 보고 포기하지 않고** 폴링한다.
     *    그래도 안 맞으면 **전송 0건으로 끝낸다** — 잘린 지시를 보내느니 안 보낸다.
     */
    let readback = { ok: false, code: 'composer_empty', why: '아직 읽지 못했다' }
    const composeDeadline = Date.now() + COMPOSE_WAIT_MS
    while (Date.now() < composeDeadline) {
      const actual = await composerLocator(page).innerText().catch(() => '')
      readback = judgeComposerReadback({ expected: message, actual, markers: requiredMarkers })
      if (readback.ok) break
      await page.waitForTimeout(COMPOSE_POLL_MS)
    }
    if (!readback.ok) {
      return { ok: false, reason: readback.code, stage, sent, messageFingerprint,
        errorDetail: `${readback.why} (한 글자도 보내지 않았다)` }
    }

    /**
     * 🔴 **보내기 전에 먼저 적는다** (2026-09-28 · P0-2).
     *
     *    앞판은 send 를 누르고 **돌아온 뒤에** 장부를 적었다. 전송 직후 프로세스가
     *    죽으면(맥이 잠들거나, launchd 가 끊거나, 예외로 터지거나) 기록이 없다 —
     *    다음 회차는 "안 보냈다" 로 읽고 **같은 brief 를 다시 보낸다.**
     *
     *    그래서 순서를 뒤집는다. readback 이 끝나 보낼 글자가 확정된 **그 순간**,
     *    누르기 **전에** 적는다. 적지 못하면 **한 글자도 보내지 않는다** —
     *    기억할 수 없는 전송은 하지 않는 편이 낫다.
     */
    /**
     * 🔴 **전송 전 기준선** (2026-09-28 · 응답 회수 재설계).
     *    지금 화면에 있는 assistant 응답을 적어 둔다. 전송 뒤에는 **여기 없던 응답 하나만** 원고 후보다.
     *    기준선을 못 읽으면 새 응답을 가릴 수 없다 — **보내지 않는다** (예약 전이라 장부도 그대로다).
     */
    const baseline = await page.evaluate(readConversationDom).catch(() => null)
    if (!baseline?.readOk) {
      return { ok: false, reason: 'response_baseline_unreadable', stage, sent: false, messageFingerprint,
        errorDetail: '전송 전 대화 상태를 읽지 못했다 (한 글자도 보내지 않았다)' }
    }

    if (onBeforeSend) {
      const pre = await onBeforeSend({ messageFingerprint, stage: 'send' })
      if (!pre?.ok) {
        return { ok: false, reason: 'predelivery_record_failed', stage: 'compose', sent: false, messageFingerprint,
          errorDetail: `${pre?.why ?? '전송 사실을 미리 적지 못했다'} (한 글자도 보내지 않았다)` }
      }
      preRecorded = true
    }

    // ── 전송 ──
    stage = 'send'
    await page.waitForTimeout(300)

    // ① Enter 를 쓰지 않는다
    const sendBtn = page.locator('[data-testid="send-button"], button[aria-label*="보내기"], button[aria-label*="Send"]').first()
    try { await sendBtn.click({ timeout: 15000 }) }
    catch (e) {
      /**
       * 🔴 **`catch {}` 로 오류를 버리지 않는다** (2026-09-28).
       *    버튼이 없는 것과, 있는데 가려진 것과, 눌렀는데 비활성인 것은 다 다르다.
       *    코드 한 단어만 남기면 운영 로그로는 어느 쪽인지 알 수 없다 —
       *    2026-09-27 의 `connect_failed` 와 같은 실수다.
       */
      return { ok: false, reason: 'send_button_missing', stage, sent, messageFingerprint, preRecorded,
        errorName: e?.name ?? 'Error',
        errorDetail: String(e?.message ?? '').split('\n')[0].slice(0, 200) }
    }
    sent = true

    // ── 완료 대기 ──
    stage = 'await-response'
    /**
     * 🔴 **새로 생긴 assistant 응답 하나 · 생성 끝 · 내용 안정** 일 때만 읽는다 (chatgpt-response.mjs).
     *    `pre code`·`data-message-author-role` 를 전제로 하지 않는다 — 2026-09-28 에 둘 다 사라졌다.
     *    판정 불가면 저장하지 않는다. 보낸 뒤이므로 결말은 전송불명(DELIVERY_UNCERTAIN)이다.
     */
    const watch = createResponseWatch(baseline, { stablePolls })
    const deadline = Date.now() + timeoutMs
    let seen = null
    let text = null
    for (;;) {
      const snap = await page.evaluate(readConversationDom).catch(() => null)
      const o = watch.observe(snap ?? { readOk: false, stop: false, units: [] })
      if (o.done) { text = o.text; seen = o; break }
      if (o.abort) {
        return { ok: false, reason: o.code, stage, sent, messageFingerprint, preRecorded,
          conversationUrl: safeUrl(page), assistantMessageId: o.messageId ?? null, responseForm: o.form ?? 'unknown',
          errorDetail: `${o.why} — 저장하지 않았다` }
      }
      seen = o
      if (Date.now() >= deadline) {
        // 🔴 닫기는 finally 가 한다 — 여기서 닫으면 뒤 경로가 닫힌 page 를 만진다
        return { ok: false, reason: 'response_timeout', stage, sent, messageFingerprint, preRecorded,
          conversationUrl: safeUrl(page), assistantMessageId: seen?.messageId ?? null, responseForm: seen?.form ?? 'unknown',
          errorDetail: `응답이 끝나지 않았다 (${seen?.phase ?? '-'}${seen?.partial ? ` · 부분 ${seen.partial}자` : ''}) — 저장하지 않았다` }
      }
      await page.waitForTimeout(pollMs)
    }

    /**
     * 🔴 **실패해도 어느 대화의 어느 응답이었는지 남긴다** (2026-09-30).
     *    앞판은 관문 실패 행에 대화 주소가 없어, 온전히 온 응답을 되찾으려면 사이드바를 뒤져 신원을 맞춰야 했다.
     */
    const where = { conversationUrl: safeUrl(page), assistantMessageId: seen?.messageId ?? null, responseForm: seen?.via ?? 'unknown' }
    const g = checkManuscript(text, { requiredMarkers, validate })
    if (!g.ok) return { ...g, stage: 'validate', length: text.length, sent, messageFingerprint, preRecorded, ...where }

    // 🔴 여기서 처음이자 마지막으로 원고가 디스크에 닿는다. 문자열을 손대지 않는다
    writeFileSync(outPath, text)
    return { ok: true, length: text.length, sent, messageFingerprint, preRecorded, via: seen?.via ?? null, ...where }
  } catch (err) {
    /**
     * 🔴 **`connect_failed` 한 단어로 삼키지 않는다** (2026-09-27 사고).
     *    그날 5건이 전부 이 한 단어로 끝났다. 실제 원인은 composer 선택자였는데
     *    로그만 보고는 알 수 없었다. 이제 **어느 단계**에서 **무슨 오류**였는지 남긴다.
     *    원문은 첫 줄만, 200자까지 — URL·계정·쿠키가 실리지 않는 구간이다.
     */
    return {
      ok: false,
      reason: 'connect_failed',
      stage,
      messageFingerprint,
      preRecorded,
      errorName: err?.name ?? 'Error',
      errorDetail: String(err?.message ?? '').split('\n')[0].slice(0, 200),
      sent,
    }
  } finally {
    // 🔴 성공·실패·예외 모두에서 **내가 연 탭**을 닫는다. Chrome 자체는 끊기만 한다.
    try { await page?.close() } catch { /* 이미 닫혔으면 그만 */ }
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
  // 🔴 신원이 틀리면 **회차 전체**를 멈춘다. 한 후보만 건너뛰면 나머지가 엉뚱한 계정으로 나간다.
  STATUS.AUTOMATION_PROFILE_MISMATCH,
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
