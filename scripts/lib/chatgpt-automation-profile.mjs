/**
 * 자동화가 쓸 Chrome 프로필의 **신원 계약**.
 *
 * 🔴 **왜 생겼나** (2026-09-28 실측).
 *    자동화가 `~/Library/Application Support/soransoran-chatgpt` 를 쓰고 있었는데,
 *    그 폴더의 실제 신원은 이랬다:
 *      이름 `내 Chrome` · 계정 `mogoyongseok@gmail.com`
 *    소란소란 사람용 프로필(`Profile 9` · `용석 (소란 소란)` ·
 *    `soransoran.community@gmail.com`)과도 다르고, 자동화 전용도 아니었다.
 *    그 창에는 ChatGPT 가 아닌 페이지가 열려 있었고 새 탭도 열리지 않았다.
 *
 *    **엉뚱한 계정으로 글을 보내는 것은 조용한 사고다.** 로그만 보면 잘 돌아간 것처럼
 *    보이고, 나중에 "누가 이 대화를 만들었나" 를 되짚을 수 없다.
 *
 * 🔴 **원칙**
 *    ① 자동화는 **자기 폴더**만 쓴다. 사람 프로필로는 절대 돌지 않는다.
 *    ② 폴더에 **용도 표식**이 있어야 한다. 표식이 없으면 그 폴더가 무엇인지 모른다.
 *    ③ 포트도 전용이다. 다른 프로세스가 쓰고 있으면 **그건 우리 브라우저가 아니다.**
 *    ④ 열려 있는 page 가 chatgpt.com 이 아니면 **사람이 쓰는 창**이다 — 손대지 않는다.
 *    ⑤ 어느 하나라도 어긋나면 **첫 AI 호출·파일 write 전에** 멈춘다.
 *       기본 Chrome·Profile 9·옛 폴더로 **폴백하지 않는다.** 폴백은 사고를 숨긴다.
 *    ⑥ 남의 페이지를 navigate·close 해서 상태를 고치지 않는다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SUPPORT = join(homedir(), 'Library', 'Application Support')

/** 🔴 자동화 전용 — 사람이 쓰지 않는다 */
export const AUTOMATION_PROFILE_DIR = join(SUPPORT, 'soransoran-chatgpt-auto')
export const AUTOMATION_CDP_PORT = 9344
export const MARKER_FILE = 'soransoran-automation.json'
export const MARKER_SCHEMA_VERSION = 1
export const MARKER_PURPOSE = 'soransoran-chatgpt-automation'

/**
 * 🔴 **절대 자동화에 쓰지 않는 폴더.** 이름이 비슷하다고 봐주지 않는다.
 *    `Profile 9` 는 창업자가 소란소란 계정으로 쓰는 창이고,
 *    `soransoran-chatgpt` 는 다른 계정이 들어 있는 옛 폴더다.
 */
export const FORBIDDEN_PROFILE_DIRS = [
  join(SUPPORT, 'Google', 'Chrome'),
  join(SUPPORT, 'Google', 'Chrome', 'Profile 9'),
  join(SUPPORT, 'soransoran-chatgpt'),
]

export const MISMATCH = 'AUTOMATION_PROFILE_MISMATCH'

const norm = (p) => String(p ?? '').replace(/\/+$/, '')

/** 금지 폴더이거나 그 안쪽이면 막는다 */
export function isForbiddenProfileDir(dir, forbidden = FORBIDDEN_PROFILE_DIRS) {
  const d = norm(dir)
  return forbidden.some((f) => d === norm(f) || d.startsWith(`${norm(f)}/`))
}

export function markerPath(profileDir = AUTOMATION_PROFILE_DIR) {
  return join(profileDir, MARKER_FILE)
}

/**
 * 표식을 만든다. **폴더 0700 · 표식 0600** — 다른 사용자가 읽지 못한다.
 * 🔴 금지 폴더에는 만들지 않는다. 표식을 붙였다고 사람 프로필이 자동화 폴더가 되지 않는다.
 */
export function ensureAutomationProfile({ profileDir = AUTOMATION_PROFILE_DIR, port = AUTOMATION_CDP_PORT } = {}) {
  if (isForbiddenProfileDir(profileDir)) {
    return { ok: false, code: MISMATCH, why: `금지된 프로필 폴더다: ${profileDir}` }
  }
  mkdirSync(profileDir, { recursive: true, mode: 0o700 })
  chmodSync(profileDir, 0o700)
  const body = { schemaVersion: MARKER_SCHEMA_VERSION, purpose: MARKER_PURPOSE, cdpPort: port }
  const f = markerPath(profileDir)
  writeFileSync(f, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  chmodSync(f, 0o600)
  return { ok: true, profileDir, port, marker: body }
}

export function readMarker(profileDir = AUTOMATION_PROFILE_DIR) {
  const f = markerPath(profileDir)
  if (!existsSync(f)) return { ok: false, why: '용도 표식이 없다' }
  try {
    const marker = JSON.parse(readFileSync(f, 'utf8'))
    const mode = statSync(f).mode & 0o777
    const dirMode = existsSync(profileDir) ? statSync(profileDir).mode & 0o777 : null
    return { ok: true, marker, mode, dirMode }
  } catch (e) {
    return { ok: false, why: `표식을 읽지 못했다: ${e.message}` }
  }
}

/** 실행 중인 Chrome 명령줄 — 시험은 문자열 배열을 그대로 넣는다 */
export function listChromeCommandLines() {
  const r = spawnSync('ps', ['-Ao', 'command='], { encoding: 'utf8' })
  return String(r.stdout ?? '').split('\n').filter((l) => /user-data-dir=/.test(l))
}

/**
 * 🔴 **명령줄이 계약과 같은가.** 폴더만 보고 판단하면, 같은 폴더를 다른 포트로 띄운
 *    프로세스에 붙는다. 경로와 포트를 **같이** 본다.
 */
export function judgeCommandLine(lines, { profileDir, port }) {
  const ours = lines.filter((l) => l.includes(`--user-data-dir=${profileDir}`))
  if (!ours.length) return { ok: false, why: '이 폴더로 실행 중인 Chrome 이 없다', running: false }
  const withPort = ours.filter((l) => l.includes(`--remote-debugging-port=${port}`))
  if (!withPort.length) {
    return { ok: false, running: true, why: `같은 폴더인데 포트가 다르다 (기대 ${port})` }
  }
  return { ok: true, running: true }
}

/**
 * 🔴 **포트 주인이 우리인가.** 다른 프로그램이 9344 를 쓰고 있으면 거기 붙어서는 안 된다.
 *    붙으면 남의 브라우저에 글을 넣는다.
 */
export function judgePortOwner(lines, { profileDir, port, portInUse }) {
  if (!portInUse) return { ok: true, why: '포트를 쓰는 프로세스가 없다' }
  const ours = lines.some((l) => l.includes(`--user-data-dir=${profileDir}`) && l.includes(`--remote-debugging-port=${port}`))
  if (ours) return { ok: true, why: '우리 브라우저가 쓰고 있다' }
  return { ok: false, why: `다른 프로세스가 포트 ${port} 를 쓰고 있다` }
}

/**
 * 🔴 **모드마다 허용하는 페이지가 다르다.**
 *    `operate` — 무인 실행이다. **chatgpt.com 만** 허용한다. 다른 페이지가 있으면
 *              그 창은 우리가 아는 창이 아니다.
 *    `login`   — 사람이 처음 로그인하는 중이다. 그때만 `auth.openai.com` 을 허용한다.
 *              운영 실행에서는 절대 허용하지 않는다.
 */
export const OPERATE_HOSTS = new Set(['chatgpt.com'])
export const LOGIN_HOSTS = new Set(['chatgpt.com', 'auth.openai.com'])

function hostOf(url) {
  try { return new URL(String(url ?? '')).hostname.replace(/^www\./, '') }
  catch { return null }
}

/**
 * 🔴 **fail-closed 다.** 페이지 목록을 못 읽은 것과 "페이지가 없다" 를 **정상으로 바꾸지 않는다.**
 *    못 읽었으면 그 창이 무엇인지 모르는 것이고, 모르는 창에 글을 넣으면 안 된다.
 *    `operate` 에서 page 0건도 실패다 — 붙을 대상이 없는데 ok 를 돌려주면
 *    다음 단계가 엉뚱하게 죽는다.
 */
export function judgePages(pages, { mode = 'operate', readOk = true } = {}) {
  if (!readOk || pages === null || pages === undefined) {
    return { ok: false, why: 'CDP 페이지 목록을 읽지 못했다 — 어떤 창인지 모른다' }
  }
  const allowed = mode === 'login' ? LOGIN_HOSTS : OPERATE_HOSTS
  const list = (pages ?? []).filter((t) => t?.type === 'page')
  const bad = list.filter((t) => !allowed.has(hostOf(t.url)))
  if (bad.length) {
    return {
      ok: false,
      why: `${mode === 'login' ? '로그인 중에도' : '운영 실행에서'} 허용되지 않는 페이지가 있다: `
        + bad.map((t) => String(t.url ?? '').slice(0, 60)).join(' | '),
    }
  }
  if (mode !== 'login' && list.length === 0) {
    return { ok: false, why: 'ChatGPT page 가 0건이다 — 붙을 창이 없다' }
  }
  return { ok: true, pages: list.length }
}

/**
 * 전부 모아 한 번에 판정한다. **한 군데라도 어긋나면 `MISMATCH` 다.**
 *
 * @returns {{ok:boolean, code?:string, why?:string, checked:object}}
 */
export function judgeAutomationProfile({
  profileDir = AUTOMATION_PROFILE_DIR,
  port = AUTOMATION_CDP_PORT,
  marker = null, markerMode = null, dirMode = null,
  commandLines = [], pages = [], portInUse = false, pagesReadOk = true,
  requireRunning = true,
  /** 🔴 'operate' 는 무인 실행 · 'login' 은 사람이 처음 로그인하는 중 */
  mode = 'operate',
}) {
  const checked = { profileDir, port }
  if (isForbiddenProfileDir(profileDir)) {
    return { ok: false, code: MISMATCH, why: `사람용·옛 프로필은 자동화에 쓰지 않는다: ${profileDir}`, checked }
  }
  if (norm(profileDir) !== norm(AUTOMATION_PROFILE_DIR)) {
    return { ok: false, code: MISMATCH, why: `자동화 전용 폴더가 아니다: ${profileDir}`, checked }
  }
  if (!marker) return { ok: false, code: MISMATCH, why: '용도 표식이 없다', checked }
  if (marker.schemaVersion !== MARKER_SCHEMA_VERSION) {
    return { ok: false, code: MISMATCH, why: `모르는 표식 판 ${marker.schemaVersion}`, checked }
  }
  if (marker.purpose !== MARKER_PURPOSE) {
    return { ok: false, code: MISMATCH, why: `표식 용도가 다르다: ${marker.purpose}`, checked }
  }
  if (marker.cdpPort !== port) {
    return { ok: false, code: MISMATCH, why: `표식 포트가 다르다 (${marker.cdpPort} ≠ ${port})`, checked }
  }
  // 🔴 권한이 느슨하면 다른 사용자가 자동화 세션을 들여다볼 수 있다
  if (markerMode !== null && markerMode !== 0o600) {
    return { ok: false, code: MISMATCH, why: `표식 권한이 0600 이 아니다 (${markerMode.toString(8)})`, checked }
  }
  if (dirMode !== null && dirMode !== 0o700) {
    return { ok: false, code: MISMATCH, why: `폴더 권한이 0700 이 아니다 (${dirMode.toString(8)})`, checked }
  }
  const owner = judgePortOwner(commandLines, { profileDir, port, portInUse })
  if (!owner.ok) return { ok: false, code: MISMATCH, why: owner.why, checked }
  const cmd = judgeCommandLine(commandLines, { profileDir, port })
  if (!cmd.ok && (requireRunning || cmd.running)) {
    return { ok: false, code: MISMATCH, why: cmd.why, checked }
  }
  /**
   * 🔴 **떠 있으면 무슨 창인지 반드시 본다.** 포트가 열려 있는데 페이지를 안 보면,
   *    `ensureChrome` 이 "CDP 살아 있음 → ok" 로 끝내던 옛 결함이 그대로 돌아온다.
   *    떠 있지 않으면 볼 페이지가 없으므로 이 검사는 건너뛴다.
   */
  if (portInUse) {
    const pg = judgePages(pages, { mode, readOk: pagesReadOk })
    if (!pg.ok) return { ok: false, code: MISMATCH, why: pg.why, checked }
    return { ok: true, checked: { ...checked, mode, pages: pg.pages, running: cmd.running } }
  }
  if (requireRunning) {
    return { ok: false, code: MISMATCH, why: `포트 ${port} 가 열려 있지 않다 — 붙을 창이 없다`, checked }
  }
  return { ok: true, checked: { ...checked, mode, pages: 0, running: cmd.running } }
}
