type EditorIconName = 'photo' | 'youtube' | 'bold' | 'spinner' | 'trash'

/**
 * 글쓰기 툴바 아이콘.
 *
 * 🔴 아이콘 패키지를 새로 넣지 않는다. 소란소란은 StatIcon·MenuIcon 처럼
 *    쓰는 모양만 직접 그려 왔다. 다섯 개 때문에 수백 개짜리 묶음을 들이면
 *    번들만 커지고 아이콘 규격이 두 벌이 된다.
 */
const PATHS: Record<EditorIconName, React.ReactNode> = {
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-4.5-4.5L7 21" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" />
      <path d="M10.5 9.5l5 2.5-5 2.5z" />
    </>
  ),
  bold: <path d="M7 5h6a3.5 3.5 0 010 7H7zm0 7h7a3.5 3.5 0 010 7H7z" />,
  spinner: <path d="M12 3a9 9 0 019 9" />,
  trash: (
    <>
      <path d="M4 7h16M10 7V5a1 1 0 011-1h2a1 1 0 011 1v2" />
      <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
    </>
  ),
}

export default function EditorIcon({
  name,
  size = 20,
}: {
  name: EditorIconName
  size?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={name === 'spinner' ? 'animate-spin' : undefined}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}
