type CommentIconName = 'reply-to' | 'deleted' | 'blocked' | 'expand' | 'collapse' | 'back'

/**
 * 댓글 대화 스레드 아이콘.
 *
 * 🔴 아이콘 패키지를 새로 넣지 않는다 — EditorIcon · StatIcon 과 같은 규칙이다.
 *    모양은 Lucide(ISC) 의 corner-down-right · trash-2 · ban · chevron-down · chevron-up ·
 *    arrow-down 을 그대로 옮겼다. 새로 그린 모양이 아니다.
 * 🔴 전부 장식이다(aria-hidden). 뜻은 옆의 글자가 말한다 — 아이콘만으로 상태를 말하지 않는다.
 */
const PATHS: Record<CommentIconName, React.ReactNode> = {
  'reply-to': (
    <>
      <polyline points="15 10 20 15 15 20" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </>
  ),
  deleted: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </>
  ),
  blocked: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>
  ),
  expand: <path d="m6 9 6 6 6-6" />,
  collapse: <path d="m18 15-6-6-6 6" />,
  back: (
    <>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </>
  ),
}

/** 크기는 글자를 따라간다(1em) — 글자 크기 3단계에서 아이콘만 따로 놀지 않게 */
export default function CommentIcon({ name }: { name: CommentIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}
