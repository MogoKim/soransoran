import type { MenuIconName } from '@/lib/board-registry'

/** 선은 currentColor 를 따른다 — 색은 부모가 토큰으로 정한다. */
const PATHS: Record<MenuIconName, React.ReactNode> = {
  heart: (
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  ),
  chat: (
    <>
      <path d="M21 12a8.5 8.5 0 01-1.2 4.4L21 21l-4.6-1.2A8.5 8.5 0 1121 12z" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  book: (
    <>
      <path d="M2 4.5C3.5 3.5 6 3 8.5 3c2.2 0 3.5.7 3.5.7V20s-1.3-.7-3.5-.7c-2.5 0-5 .5-6.5 1.5V4.5z" />
      <path d="M22 4.5C20.5 3.5 18 3 15.5 3c-2.2 0-3.5.7-3.5.7V20s1.3-.7 3.5-.7c2.5 0 5 .5 6.5 1.5V4.5z" />
    </>
  ),
  star: (
    <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.25l-5.8 3.15 1.1-6.45-4.7-4.6 6.5-.95L12 2.5z" />
  ),
}

export default function MenuIcon({ name, size = 24 }: { name: MenuIconName; size?: number }) {
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
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}
