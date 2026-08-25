type StatIconName = 'comment' | 'eye'

const PATHS: Record<StatIconName, React.ReactNode> = {
  comment: (
    <path d="M12 3C7 3 3 6.58 3 11c0 2.13.94 4.06 2.5 5.5L4 21l4.5-1.5C9.6 19.8 10.8 20 12 20c5 0 9-3.58 9-8s-4-9-9-9z" />
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
}

/** 목록 메타용 — 숫자보다 커지면 시선을 먼저 끈다. 14px 를 넘기지 않는다. */
export default function StatIcon({ name, size = 14 }: { name: StatIconName; size?: number }) {
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
