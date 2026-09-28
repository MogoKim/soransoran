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
} = {}) {
  const alive = await cdpCheck()
  if (alive) return { ok: true, started: false }
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

  if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true })
  try { chmodSync(profileDir, 0o700) } catch { /* 이미 맞으면 그만 */ }

  const child = spawnFn(CHROME_APP, chromeArgs(profileDir), { detached: true, stdio: 'ignore' })
  child?.unref?.()
  // 🔴 죽은 잠금 위에서 띄운 경우를 기록에 남긴다 — 다음 사고 때 이 줄이 단서다
  const startedOverStaleLock = lock.state === 'STALE'

  // 포트가 열릴 때까지 기다린다. Chrome 은 뜨는 데 몇 초 걸린다
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs))
    if (await cdpCheck()) return { ok: true, started: true, startedOverStaleLock, lock }
  }
  return { ok: false, started: true, reason: STATUS.CHROME_NOT_RUNNING, startedOverStaleLock, lock }
}

/**
 * 🔴 **프로필 신원 관문** — 첫 AI 호출·파일 write 전에 선다 (2026-09-28 · P0-2).
 *
 *    폴더·표식·포트 주인·명령줄·열린 페이지를 **한 번에** 본다.
 *    하나라도 어긋나면 `AUTOMATION_PROFILE_MISMATCH` 로 끝낸다 —
 *    기본 Chrome·사람 프로필·옛 폴더로 **폴백하지 않는다.**
 *    남의 페이지를 navigate·close 해서 고치지도 않는다.
 */
export async function verifyAutomationProfile({
  profileDir = PROFILE_DIR,
  port = CDP_PORT,
  requireRunning = true,
  readMarkerFn = readMarker,
  commandLinesFn = listChromeCommandLines,
  listTargets = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) })
      return await r.json()
    } catch { return [] }
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
  const pages = portInUse ? await listTargets() : []
  return judgeAutomationProfile({
    profileDir, port,
    marker: m.ok ? m.marker : null,
    markerMode: m.ok ? m.mode : null,
    dirMode: m.ok ? m.dirMode : null,
    commandLines: commandLinesFn(),
    pages, portInUse, requireRunning,
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
} = {}) {
  // launched 가 아니라 connected 다 — 이 코드는 브라우저를 띄우지 않는다
  const out = { connected: false, httpStatus: null, profileExists: profileExists(), via: 'cdp' }

  /**
   * 🔴 **무엇보다 먼저 신원을 본다.** 여기서 막히면 브라우저를 켜지도, 붙지도,
   *    한 글자도 보내지도 않는다. 2026-09-28 에 자동화가 **다른 계정 프로필**로
   *    돌고 있던 것을 아무도 몰랐다 — 로그만 보면 정상이었기 때문이다.
   */
  const identity = await verifyProfileFn({ requireRunning: false })
  if (!identity.ok) {
    return { ...out, status: STATUS.AUTOMATION_PROFILE_MISMATCH, errorDetail: identity.why, identity }
  }

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
    const message = buildManuscriptMessage({ promptText, briefText: readFileSync(briefPath, 'utf8') })
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
      return { ok: false, reason: 'send_button_missing', stage, sent, messageFingerprint,
        errorName: e?.name ?? 'Error',
        errorDetail: String(e?.message ?? '').split('\n')[0].slice(0, 200) }
    }
    sent = true

    // ── 완료 대기 ──
    stage = 'await-response'
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
      // 🔴 닫기는 finally 가 한다 — 여기서 닫으면 뒤 경로가 닫힌 page 를 만진다
      return { ok: false, reason: 'response_timeout', stage, sent, messageFingerprint }
    }

    // ③ pre code 의 textContent — 렌더된 <hr>/<h2> 가 아니라 원본 표기가 그대로 있다
    const text = await page.evaluate(() => {
      const codes = [...document.querySelectorAll('pre code')]
      return codes[codes.length - 1].textContent || ''
    })

    // 지정 문장이 빠졌으면 저장하지 않는다 — 원고를 고치지 않고 되돌린다
    const missing = requiredMarkers.filter((m) => !text.includes(m))
    if (missing.length) return { ok: false, reason: 'markers_missing', missingCount: missing.length, length: text.length, sent, messageFingerprint }

    // 🔴 관문. 여기서 막히면 파일이 생기지 않는다 — 다음 실행이 깨끗한 상태에서 다시 받는다.
    if (validate) {
      const v = validate(text)
      if (!v.ok) return { ok: false, reason: 'invalid_manuscript', invalid: v.reasons ?? [], length: text.length, sent, messageFingerprint }
    }

    // 🔴 여기서 처음이자 마지막으로 원고가 디스크에 닿는다. 문자열을 손대지 않는다
    writeFileSync(outPath, text)
    return { ok: true, length: text.length, sent, messageFingerprint }
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
