/**
 * 보드 정본 (SSoT)
 *
 * IA 정본 (soransoran-d7-dday-milestone.md §4)
 *   갱년기톡 · 자유게시판 = 게시판
 *   매거진               = 콘텐츠 영역 (게시판 아님)
 *   베스트               = 모아보기 영역 (게시판 아님)
 */
export type BoardType = 'MENOPAUSE' | 'FREE' | 'MAGAZINE' | 'BEST'

/** 상단 메뉴 아이콘 종류 */
export type MenuIconName = 'heart' | 'chat' | 'book' | 'star'

export interface BoardMeta {
  type: BoardType
  slug: string
  label: string
  href: string
  /** 회원이 글을 쓰는 게시판인가 */
  isCommunity: boolean
  /** 상단 메뉴에 노출하는가 — 준비 중인 면을 내릴 때 여기서만 끈다 */
  showInMenu: boolean
  icon: MenuIconName
  /** 보드 색 토큰명. 실제 hex 는 globals.css 에만 있다 */
  iconBgVar: string
  iconStrokeVar: string
  /** 글자용. stroke 를 그대로 글자에 쓰면 배경 위 대비가 모자란다 */
  iconTextVar: string
  /** empty state 문구 (창업자 확정) */
  emptyTitle: string
  emptyBody: string
  emptyCta: string
}

export const BOARD_REGISTRY = [
  {
    type: 'MENOPAUSE',
    slug: 'menopause',
    label: '갱년기톡',
    href: '/community/menopause',
    showInMenu: true,
    icon: 'heart',
    iconBgVar: '--icon-meno-bg',
    iconStrokeVar: '--icon-meno-stroke',
    iconTextVar: '--icon-meno-text',
    isCommunity: true,
    emptyTitle: '여기서는 갱년기 이야기를 해도 됩니다',
    emptyBody: '증상도, 기분도, 사소한 것도 괜찮아요.',
    emptyCta: '이야기 남기기',
  },
  {
    type: 'FREE',
    slug: 'free',
    label: '자유게시판',
    href: '/community/free',
    showInMenu: true,
    icon: 'chat',
    iconBgVar: '--icon-free-bg',
    iconStrokeVar: '--icon-free-stroke',
    iconTextVar: '--icon-free-text',
    isCommunity: true,
    emptyTitle: '무슨 이야기든 괜찮습니다',
    emptyBody: '잘 쓰지 않아도 됩니다.',
    emptyCta: '글쓰기',
  },
  {
    type: 'MAGAZINE',
    slug: 'magazine',
    label: '매거진',
    href: '/magazine',
    showInMenu: true,
    icon: 'book',
    iconBgVar: '--icon-magazine-bg',
    iconStrokeVar: '--icon-magazine-stroke',
    iconTextVar: '--icon-magazine-text',
    isCommunity: false,
    emptyTitle: '아직 발행된 글이 없습니다',
    emptyBody: '차분히 읽을 만한 글을 준비하고 있습니다.',
    emptyCta: '',
  },
  {
    type: 'BEST',
    slug: 'best',
    label: '베스트',
    href: '/best',
    showInMenu: true,
    icon: 'star',
    iconBgVar: '--icon-best-bg',
    iconStrokeVar: '--icon-best-stroke',
    iconTextVar: '--icon-best-text',
    isCommunity: false,
    emptyTitle: '아직 모인 글이 없습니다',
    emptyBody: '글과 댓글이 쌓이면 여기에 모입니다.',
    emptyCta: '',
  },
] as const satisfies readonly BoardMeta[]

export const COMMUNITY_BOARDS = BOARD_REGISTRY.filter((b) => b.isCommunity)

/**
 * 상단 메뉴 표시 순서 — 등록 순서와 분리한다.
 *
 * 🔴 BOARD_REGISTRY 를 재정렬하지 않는다. 그 배열은 보드 정본이라
 *    getBoardByType·getBoardBySlug·COMMUNITY_BOARDS 가 함께 읽는다.
 *    메뉴 순서 하나 바꾸자고 정본을 흔들면 다른 화면이 조용히 따라 움직인다.
 *
 * 🔴 Record<BoardType, number> 로 둔다. 배열이면 새 보드를 넣고 여기 빠뜨려도
 *    조용히 맨 앞으로 가지만, Record 는 컴파일이 깨져 알려준다.
 */
const MENU_ORDER: Record<BoardType, number> = {
  BEST: 0,
  MENOPAUSE: 1,
  FREE: 2,
  MAGAZINE: 3,
}

/** 노출 여부는 showInMenu 가, 순서는 MENU_ORDER 가 정한다. */
export const MENU_BOARDS = BOARD_REGISTRY.filter((b) => b.showInMenu).sort(
  (a, b) => MENU_ORDER[a.type] - MENU_ORDER[b.type],
)

/** 커뮤니티 보드 타입 → 메타. 홈처럼 여러 보드 글을 섞어 보여줄 때 쓴다. */
export function getBoardByType(type: BoardType): BoardMeta | undefined {
  return BOARD_REGISTRY.find((b) => b.type === type)
}

export function getBoardBySlug(slug: string): BoardMeta | undefined {
  return BOARD_REGISTRY.find((b) => b.slug === slug)
}
