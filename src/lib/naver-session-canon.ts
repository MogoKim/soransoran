/**
 * Naver 세션 **정본 경로와 검증** — 🔴 순수 판정. 파일을 읽지도 쓰지도 않는다
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-10).
 *
 *    `SORAN_NAVERCAFE_SESSION_PATH` 가 **상대 경로**(`.naver-session/...`)였다.
 *    launchd 의 `WorkingDirectory` 는 runtime worktree 인데 세션 파일은 개발 트리에만
 *    있었고, 그 파일은 gitignore 대상이라 checkout 으로 따라가지 않는다.
 *
 *    결과: Wave B 로 등록한 다회 수집 job 이 **한 번도 성공하지 못했다.**
 *    remonterrace 4/4 · wgang 4/4 전부 `SESSION_FILE_MISSING` 으로 중단됐다.
 *    그런데 job 은 `loaded` 였고, 관제는 그것을 "수집 능력 80건/day" 로 읽었다 —
 *    **등록을 능력으로 오판**한 것이 진짜 사고다.
 *
 *    경로 하나를 고치는 것으로는 같은 사고가 다시 난다. 그래서 계약을 만든다:
 *    운영에서 상대 경로와 worktree 내부 경로는 **fail-closed** 다.
 *
 * 🔴 **이 파일은 쿠키를 다루지 않는다.** 경로 문자열과 모양만 본다 —
 *    값·자격증명은 어떤 반환값에도 담지 않는다.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 🔴 정본은 worktree 밖이다 — 배포·checkout 과 무관해야 한다 */
export const NAVER_SESSION_DIR = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'naver-session',
)
export const NAVER_SESSION_FILE = join(NAVER_SESSION_DIR, 'soransoran-storage-state.json')

/** 🔴 남이 읽을 수 있으면 세션이 아니다 */
export const SESSION_DIR_MODE = 0o700
export const SESSION_FILE_MODE = 0o600

/**
 * 🔴 **worktree 안이면 안 된다.** 배포가 트리를 갈아 끼우면 사라지고,
 *    개발 트리에만 있으면 runtime 이 못 읽는다.
 */
const WORKTREE_HINTS: readonly string[] = [
  '/Documents/soransoran-m0',
  '/Documents/soransoran-runtime',
  '/Documents/soransoran-',
  '/Documents/unao-',
]

export type SessionLocationCode =
  | 'SESSION_PATH_RELATIVE'
  | 'SESSION_PATH_IN_WORKTREE'

export type LocationVerdict =
  | { ok: true; reason: string }
  | { ok: false; code: SessionLocationCode; reason: string }

/**
 * 경로가 정본 계약을 지키는가 — 🔴 파일을 열지 않는다.
 *
 * @param path env 로 받은 경로
 * @param strict 운영 회차인가. `false` 면 상대 경로를 경고만 하고 통과시킨다
 */
export function judgeSessionLocation(path: string, strict = true): LocationVerdict {
  const p = path.trim()
  if (!p.startsWith('/')) {
    return strict
      ? {
        ok: false,
        code: 'SESSION_PATH_RELATIVE',
        reason: `세션 경로가 상대 경로다 — 실행 디렉터리에 따라 다른 파일을 본다(${p})`
          + ` · 정본은 ${NAVER_SESSION_FILE}`,
      }
      : { ok: true, reason: '🟡 상대 경로다 — 운영에서는 막힌다(지금은 개발 회차)' }
  }
  if (WORKTREE_HINTS.some((h) => p.includes(h))) {
    return {
      ok: false,
      code: 'SESSION_PATH_IN_WORKTREE',
      reason: `세션 경로가 worktree 안이다 — 배포가 트리를 갈아 끼우면 사라진다(${p})`
        + ` · 정본은 ${NAVER_SESSION_FILE}`,
    }
  }
  return { ok: true, reason: '정본 경로다 — worktree 밖 · 절대 경로' }
}

export type SessionShape = 'ok' | 'malformed' | 'unreadable'

/**
 * 🔴 **storageState 모양인가.** provider 요청 **전에** 본다 —
 *    깨진 파일로 브라우저를 열면 로그인 화면을 긁어 오고, 그것이 성공으로 기록된다.
 *
 * 🔴 값을 반환하지 않는다. 쿠키 이름도 도메인도 담지 않는다 — 모양만 답한다.
 */
export function judgeStorageStateShape(text: string): SessionShape {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return 'malformed' }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'malformed'
  const o = parsed as { cookies?: unknown; origins?: unknown }
  // Playwright storageState 는 cookies 와 origins 를 둘 다 가진다
  if (!Array.isArray(o.cookies) || !Array.isArray(o.origins)) return 'malformed'
  // 🔴 쿠키가 하나도 없으면 로그인 상태가 아니다 — 열어 봐야 로그인 화면이다
  if (o.cookies.length === 0) return 'malformed'
  return 'ok'
}

/** 🔴 권한이 정본보다 느슨한가 (group·other 비트가 서 있는가) */
export function isTooOpen(mode: number, want: number = SESSION_FILE_MODE): boolean {
  return (mode & 0o777 & ~want) !== 0
}
