/**
 * 배너 조작 아이콘.
 *
 * 🔴 아이콘 라이브러리를 새로 설치하지 않는다. 이 저장소에는 아이콘 패키지가 없고
 *    (lucide · heroicons · react-icons 어느 것도 없다), 넣으려면 package.json 을
 *    고쳐야 하는데 지금 열린 다른 PR 이 같은 파일을 바꾸고 있다.
 *    의존성 하나를 위해 충돌을 만들지 않는다 — 인라인 SVG 로 같은 것을 그린다.
 *
 * 🔴 아이콘만 두지 않는다. 모든 호출부가 aria-label 과 title 을 함께 준다 —
 *    화살표 두 개가 나란히 있으면 어느 쪽이 무엇인지 아이콘만으로는 알 수 없고,
 *    화면을 읽어 주는 사람에게는 아예 닿지 않는다.
 *
 * 🔴 currentColor 를 쓴다. 색을 여기서 정하지 않아야 버튼의 상태색을 그대로 따라간다
 *    (hex literal 은 globals.css 에만 존재한다 — CLAUDE.md).
 */
const BASE = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

export function IconArrowUp() {
  return (
    <svg {...BASE}>
      <path d="M8 13V3" />
      <path d="M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  )
}

export function IconArrowDown() {
  return (
    <svg {...BASE}>
      <path d="M8 3v10" />
      <path d="M3.5 8.5 8 13l4.5-4.5" />
    </svg>
  )
}

/** 보관 — 상자에 넣는 모양 */
export function IconArchive() {
  return (
    <svg {...BASE}>
      <path d="M2 4.5h12v2H2z" />
      <path d="M3 6.5v6h10v-6" />
      <path d="M6.5 9h3" />
    </svg>
  )
}

/** 복원 — 되돌아오는 화살표 */
export function IconRestore() {
  return (
    <svg {...BASE}>
      <path d="M3 8a5 5 0 1 0 1.6-3.7" />
      <path d="M3 2.5V5.5h3" />
    </svg>
  )
}
