/**
 * 보드 정본 (SSoT)
 *
 * IA 정본 (soransoran-d7-dday-milestone.md §4)
 *   갱년기톡 · 자유게시판 = 게시판
 *   매거진               = 콘텐츠 영역 (게시판 아님)
 *   베스트               = 모아보기 영역 (게시판 아님)
 */
export type BoardType = 'MENOPAUSE' | 'FREE' | 'MAGAZINE' | 'BEST'

export interface BoardMeta {
  type: BoardType
  slug: string
  label: string
  href: string
  /** 회원이 글을 쓰는 게시판인가 */
  isCommunity: boolean
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
    isCommunity: false,
    emptyTitle: '아직 모인 글이 없습니다',
    emptyBody: '글과 댓글이 쌓이면 여기에 모입니다.',
    emptyCta: '',
  },
] as const satisfies readonly BoardMeta[]

export const COMMUNITY_BOARDS = BOARD_REGISTRY.filter((b) => b.isCommunity)

export function getBoardBySlug(slug: string): BoardMeta | undefined {
  return BOARD_REGISTRY.find((b) => b.slug === slug)
}
