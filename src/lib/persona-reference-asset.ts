/**
 * 말투 근거 **정본 자산 계약** — 🔴 순수 판정. 파일을 읽지도 쓰지도 않는다
 *
 * 🔴 **왜 worktree 밖인가** (2026-09-10, P1).
 *
 *    파생 댓글 원문은 **Git 에 커밋하지 않는다.** 실제 사람이 쓴 공개 댓글이고,
 *    저장소에 넣으면 history 에 영구히 남아 되돌릴 수 없다.
 *    (원본 자산에는 닉네임과 원글 본문까지 들어 있어 더더욱 안 된다.)
 *
 *    그렇다고 `tmp/` 에 두면 배포가 트리를 갈아 끼울 때 사라진다 —
 *    Naver 세션이 정확히 그 사고를 냈다(`naver-session-canon.ts`).
 *    그래서 **세션 정본과 같은 자리·같은 권한**에 둔다.
 *
 * 🔴 **코드와 CI 에는 데이터가 없다.** 스키마 fixture 와 digest 검증만 둔다.
 *    CI 는 "자산이 이런 모양이어야 한다" 를 알지만 자산 자체는 보지 못한다.
 *
 * 🔴 **runtime 에서 부재·해시 불일치는 fail-closed 다.**
 *    자산이 없거나 바뀐 채로 생성하면, 그 회차의 근거가 무엇이었는지 아무도 모른다.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const REFERENCE_DIR = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'persona-reference',
)
export const REFERENCE_CORPUS_FILE = join(REFERENCE_DIR, 'corpus.json')
export const REFERENCE_MANIFEST_FILE = join(REFERENCE_DIR, 'manifest.json')

/** 🔴 남이 읽을 수 있으면 정본이 아니다 — 세션 정본과 같은 값 */
export const REFERENCE_DIR_MODE = 0o700
export const REFERENCE_FILE_MODE = 0o600

/** 🔴 worktree 안이면 안 된다. 배포가 트리를 갈아 끼우면 사라진다 */
const WORKTREE_HINTS: readonly string[] = [
  '/Documents/soransoran-m0',
  '/Documents/soransoran-runtime',
  '/Documents/soransoran-',
  '/Documents/unao-',
]

export type AssetLocationCode = 'ASSET_PATH_RELATIVE' | 'ASSET_PATH_IN_WORKTREE'

export function judgeAssetLocation(path: string, strict = true):
  | { ok: true; reason: string }
  | { ok: false; code: AssetLocationCode; reason: string } {
  const p = path.trim()
  if (!p.startsWith('/')) {
    return strict
      ? {
        ok: false, code: 'ASSET_PATH_RELATIVE',
        reason: `자산 경로가 상대 경로다 — 실행 디렉터리에 따라 다른 파일을 본다(${p})`
          + ` · 정본은 ${REFERENCE_CORPUS_FILE}`,
      }
      : { ok: true, reason: '🟡 상대 경로다 — 운영에서는 막힌다(지금은 개발 회차)' }
  }
  if (WORKTREE_HINTS.some((h) => p.includes(h))) {
    return {
      ok: false, code: 'ASSET_PATH_IN_WORKTREE',
      reason: `자산 경로가 worktree 안이다 — 배포가 트리를 갈아 끼우면 사라진다(${p})`
        + ` · 정본은 ${REFERENCE_CORPUS_FILE}`,
    }
  }
  return { ok: true, reason: '정본 경로다 — worktree 밖 · 절대 경로' }
}

/** 🔴 권한이 정본보다 느슨한가 */
export function isTooOpen(mode: number, want: number = REFERENCE_FILE_MODE): boolean {
  return (mode & 0o777 & ~want) !== 0
}

// ─────────────────────────────────────────────────────────
// 스키마 — 🔴 CI 가 아는 것은 이 모양뿐이다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 정본 자산의 한 항목 — **실제 작성자명을 담지 않는다** (2026-09-10, P0-4).
 *
 *    앞선 계약은 `{ author, content }` 였다. 자산이 worktree 밖 600 권한이라도
 *    **닉네임을 파일에 적어 두는 것 자체**가 유출 지점이다.
 *    이제 `speakerId` 만 남긴다 — 같은 사람이면 같은 값이 되지만
 *    **그 값에서 원래 닉네임을 되돌릴 수 없다.**
 *
 * 🔴 `author ↔ speakerId` 대응표는 **어디에도 저장하지 않는다.**
 *    저장하면 그 표가 곧 복원 열쇠가 된다.
 */
export type AssetComment = { speakerId: string; content: string }

/** 🔴 불투명 식별자의 모양 — 12자 hex. 길이·모양만으로는 아무것도 알 수 없다 */
export const SPEAKER_ID_PATTERN = /^[0-9a-f]{12}$/

export type ReferenceAsset = {
  version: number
  generatedAt: string
  comments: AssetComment[]
}

export const ASSET_VERSION = 1

export type AssetShapeCode =
  | 'ASSET_MALFORMED'
  | 'ASSET_VERSION_MISMATCH'
  | 'ASSET_EMPTY'
  | 'ASSET_ITEM_MALFORMED'

export type AssetShapeVerdict =
  | { ok: true; comments: number; reason: string }
  | { ok: false; code: AssetShapeCode; reason: string }

/**
 * 🔴 **모양이 아니면 쓰지 않는다.** 값은 반환하지 않는다 — 개수와 판정만 낸다.
 */
export function judgeAssetShape(parsed: unknown): AssetShapeVerdict {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'ASSET_MALFORMED', reason: '자산이 객체가 아니다' }
  }
  const o = parsed as Partial<ReferenceAsset>
  if (o.version !== ASSET_VERSION) {
    return {
      ok: false, code: 'ASSET_VERSION_MISMATCH',
      reason: `자산 판이 다르다 — ${String(o.version)} · 기대 ${ASSET_VERSION}`,
    }
  }
  if (!Array.isArray(o.comments) || o.comments.length === 0) {
    return { ok: false, code: 'ASSET_EMPTY', reason: '자산에 댓글이 없다' }
  }
  for (const c of o.comments) {
    if (c === null || typeof c !== 'object') {
      return { ok: false, code: 'ASSET_ITEM_MALFORMED', reason: '항목이 객체가 아니다' }
    }
    const it = c as Partial<AssetComment>
    // 🔴 `content` 는 반드시 이름 붙은 자리에 있어야 한다 — 맨 문자열은 받지 않는다
    if (typeof it.content !== 'string' || it.content.trim() === '') {
      return { ok: false, code: 'ASSET_ITEM_MALFORMED', reason: 'content 가 문자열이 아니다' }
    }
    // 🔴 실제 닉네임이 들어오지 못하게 **모양으로** 막는다
    if (typeof it.speakerId !== 'string' || !SPEAKER_ID_PATTERN.test(it.speakerId)) {
      return {
        ok: false, code: 'ASSET_ITEM_MALFORMED',
        reason: 'speakerId 가 12자 hex 가 아니다 — 실제 작성자명을 담지 않는다',
      }
    }
  }
  return { ok: true, comments: o.comments.length, reason: `자산 ${o.comments.length}건 — 모양 확인` }
}

export type AssetReadinessCode =
  | 'ASSET_MISSING'
  | 'ASSET_MANIFEST_MISSING'
  | 'ASSET_DIGEST_MISMATCH'
  | 'ASSET_TOO_OPEN'

/**
 * 🔴 **runtime 에서 쓸 수 있는 상태인가** — 부재·해시 불일치는 fail-closed 다.
 *
 *    파일을 읽지 않는다. 부르는 쪽이 잰 사실을 넘겨받아 판정만 한다.
 */
export function judgeAssetReadiness(input: {
  corpusExists: boolean
  manifestExists: boolean
  /** 지금 파일에서 잰 digest */
  actualDigest: string | null
  /** manifest 가 말하는 digest */
  expectedDigest: string | null
  /** 파일 권한 (0o600 기대) */
  mode: number | null
}): { ok: boolean; code: AssetReadinessCode | 'OK'; reason: string } {
  if (!input.corpusExists) {
    return {
      ok: false, code: 'ASSET_MISSING',
      reason: `말투 근거 정본이 없다 — ${REFERENCE_CORPUS_FILE}`
        + ' · 🔴 없는 채로 생성하지 않는다(fail-closed)',
    }
  }
  if (!input.manifestExists) {
    return {
      ok: false, code: 'ASSET_MANIFEST_MISSING',
      reason: `자산 manifest 가 없다 — ${REFERENCE_MANIFEST_FILE}`
        + ' · 무엇을 근거로 만든 자산인지 알 수 없다',
    }
  }
  if (input.actualDigest === null || input.expectedDigest === null
    || input.actualDigest !== input.expectedDigest) {
    return {
      ok: false, code: 'ASSET_DIGEST_MISMATCH',
      // 🔴 모르면 통과시키지 않는다
      reason: `자산 digest 가 manifest 와 다르다 — 지금 ${String(input.actualDigest)}`
        + ` · manifest ${String(input.expectedDigest)}`,
    }
  }
  if (input.mode !== null && isTooOpen(input.mode)) {
    return {
      ok: false, code: 'ASSET_TOO_OPEN',
      reason: `자산 권한이 느슨하다 — ${(input.mode & 0o777).toString(8)} · 기대 600`,
    }
  }
  return { ok: true, code: 'OK', reason: '정본 자산 확인 — 경로 · digest · 권한' }
}
