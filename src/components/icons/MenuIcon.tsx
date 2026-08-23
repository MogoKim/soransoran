import type { MenuIconName } from '@/lib/board-registry'

/** 선은 currentColor 를 따른다 — 색은 부모가 토큰으로 정한다. */
const PATHS: Record<MenuIconName, React.ReactNode> = {
  heart: <path d="M12 20s-7-4.5-7-9.5A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.5C19 15.5 12 20 12 20Z" />,
  chat: (
    <>
      <path d="M20 12a7 7 0 0 1-7 7H8l-4 3v-4.6A7 7 0 0 1 11 5h2a7 7 0 0 1 7 7Z" />
      <path d="M9 12h.01M12 12h.01M15 12h.01" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5Z" />
    </>
  ),
  star: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8Z" />,
}

export default function MenuIcon({ name }: { name: MenuIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}
