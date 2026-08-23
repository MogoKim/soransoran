/**
 * 작성 중인 글의 로컬 임시저장. 저장·복원·삭제를 여기서만 한다.
 *
 * localStorage 가 막히거나(사파리 시크릿) 값이 깨져 있어도 예외를 밖으로 던지지 않는다.
 * 임시저장이 안 되는 것보다 글쓰기 화면이 죽는 게 더 나쁘다.
 */

export type PostDraft = {
  boardSlug: string
  title: string
  content: string
  /** 저장 시각(ms) */
  savedAt?: number
}

export function draftKey(boardSlug: string): string {
  return `soran-post-draft-${boardSlug}`
}

/** 제목도 내용도 없으면 저장할 것이 없다 — 빈 값이 진짜 글을 덮어쓰면 안 된다. */
function hasBody(draft: Pick<PostDraft, 'title' | 'content'>): boolean {
  return Boolean(draft.title || draft.content)
}

export function readDraft(boardSlug: string): PostDraft | null {
  if (!boardSlug) return null
  try {
    const raw = localStorage.getItem(draftKey(boardSlug))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PostDraft>
    const draft: PostDraft = {
      boardSlug: parsed.boardSlug || boardSlug,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      content: typeof parsed.content === 'string' ? parsed.content : '',
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : undefined,
    }
    return hasBody(draft) ? draft : null
  } catch {
    return null
  }
}

/** 저장 성공 여부를 돌려준다 — 호출부가 실패를 알아야 사용자에게 알릴 수 있다. */
export function saveDraft(draft: PostDraft, now: number): boolean {
  if (!draft.boardSlug) return false
  if (!hasBody(draft)) return false
  try {
    localStorage.setItem(
      draftKey(draft.boardSlug),
      JSON.stringify({ ...draft, savedAt: now }),
    )
    return true
  } catch {
    return false
  }
}

export function removeDraft(boardSlug: string): void {
  if (!boardSlug) return
  try {
    localStorage.removeItem(draftKey(boardSlug))
  } catch {
    /* 지우지 못해도 화면 흐름을 막지 않는다 */
  }
}
