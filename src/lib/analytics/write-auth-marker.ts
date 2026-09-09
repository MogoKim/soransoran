/**
 * 글쓰기 인증 왕복 표식.
 *
 * 비회원이 글을 다 쓰고 "카카오로 계속하기" 를 누른 순간에 심고, 로그인·온보딩을 거쳐
 * 돌아와 그 게시판의 쓰다 만 글이 실제로 복원됐을 때 가져간다(consume).
 * 이 표식이 있어야만 write_draft_restored 를 보낸다 —
 * 그냥 새로고침해서 복원된 것과 왕복하고 돌아와 복원된 것은 다른 일이다.
 *
 * 🔴 localStorage 다. sessionStorage 를 쓰지 않는다.
 *    카카오 로그인은 모바일에서 카카오톡 앱으로 넘어갔다 돌아오고, 그때 브라우저가
 *    새 탭으로 복귀할 수 있다. 탭 단위인 sessionStorage 는 그 순간 사라진다.
 *    쓰다 만 글 자체도 localStorage 에 있다(write-draft.ts) — 저장소가 갈리면
 *    "글은 살아 돌아왔는데 표식만 없는" 어긋남이 생긴다.
 *
 * 🔴 담는 것은 boardSlug 와 만료 시각 둘뿐이다.
 *    제목·본문·회원 식별자·callbackUrl 을 넣지 않는다. 로그인하지 않은 사람의
 *    브라우저에 오래 남는 값이라, 담을 이유가 없는 것은 담지 않는다.
 *
 * 🔴 30분이면 만료된다. 카카오 로그인 + 온보딩 2단계를 마치기에 넉넉하면서,
 *    하루 뒤에 우연히 글이 복원돼 이벤트가 나가는 일은 막는 길이다.
 *    (api/view 의 조회 중복 창과 같은 30분을 쓴다)
 *
 * 🔴 읽기·쓰기 어느 쪽도 예외를 밖으로 던지지 않는다.
 *    계측 표식 하나 때문에 글쓰기 화면이 죽는 쪽이 훨씬 나쁘다 — write-draft.ts 와 같은 계약이다.
 */

const MARKER_KEY = 'soran-write-auth-return'

/** 왕복에 허용하는 시간 */
export const WRITE_AUTH_MARKER_TTL_MS = 30 * 60 * 1000

type WriteAuthMarker = {
  boardSlug: string
  /** 만료 시각(ms) */
  expiresAt: number
}

/** 모양이 맞는 것만 돌려준다. 값이 깨져 있으면 없는 것으로 본다 */
function readMarker(): WriteAuthMarker | null {
  try {
    const raw = localStorage.getItem(MARKER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WriteAuthMarker>
    if (typeof parsed.boardSlug !== 'string') return null
    if (typeof parsed.expiresAt !== 'number') return null
    return { boardSlug: parsed.boardSlug, expiresAt: parsed.expiresAt }
  } catch {
    /* 못 읽으면 없는 것으로 본다 */
    return null
  }
}

export function clearWriteAuthMarker(): void {
  try {
    localStorage.removeItem(MARKER_KEY)
  } catch {
    /* 못 지워도 화면 흐름을 막지 않는다. 어차피 만료된다 */
  }
}

/** 인증하러 나가기 직전에 심는다 */
export function markWriteAuthStart(boardSlug: string, now: number): void {
  try {
    const marker: WriteAuthMarker = { boardSlug, expiresAt: now + WRITE_AUTH_MARKER_TTL_MS }
    localStorage.setItem(MARKER_KEY, JSON.stringify(marker))
  } catch {
    /* 못 심으면 복원 이벤트가 안 나갈 뿐이다. 글쓰기는 그대로 흐른다 */
  }
}

/**
 * 표식을 가져간다 — 이 게시판의 왕복이 맞으면 지우고 true 를 준다.
 *
 * 🔴 판정보다 삭제가 먼저다. 어떤 이유로 두 번 불려도 두 번째는 표식이 없어 false 가 된다 —
 *    이벤트가 한 번만 나가는 것을 호출부의 조심성이 아니라 이 함수가 보장한다.
 *
 * 🔴 게시판이 다르면 지우지 않는다. `?board=` 를 잃고 돌아온 사람은 다른 게시판 화면에서
 *    "이어서 쓰기" 로 자기 글을 복원한다 — 그때 이 표식이 살아 있어야 그 왕복을 셀 수 있다.
 */
export function takeWriteAuthMarker(boardSlug: string, now: number): boolean {
  const marker = readMarker()
  if (!marker) return false

  if (marker.expiresAt <= now) {
    clearWriteAuthMarker()
    return false
  }
  if (marker.boardSlug !== boardSlug) return false

  clearWriteAuthMarker()
  return true
}
