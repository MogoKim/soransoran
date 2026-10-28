import type { BoardType, PersonaCandidateStatus, PostStatus } from '@prisma/client'

/**
 * 어드민 게시판 변경 — 🔴 순수 판정. DB · 세션 · 네트워크 없음.
 *
 * 창업자가 관리자 글 상세에서 글을 자유게시판(FREE) ↔ 갱년기톡(MENOPAUSE) 사이로 옮긴다.
 * 바뀌는 것은 Post.boardType 하나뿐이다(board-move-tx.ts). 제목 · 본문 · 작성자 · 댓글 ·
 * 공개 상태 · 작성 시각은 그대로다.
 *
 * 🔴 자동 운영 자산은 옮기지 않는다 — Persona 글 · Micro Seed 글 · 오리지널 큐(D100)가 낸 글.
 *    옮기면 자동 운영 기록(boardTopic · 단계 증거 · 자동 READY 감사)의 뜻이 글과 어긋난다.
 *    기록을 고쳐 맞추지 않는다 — 옮기지 않는다.
 * 🔴 가입인사 글은 옮기지 않는다 — 첫 인사 게시판 계약(greeting-policy.ts)이 있다.
 * 🔴 열린 Persona 댓글 후보(PENDING · APPROVED · EDITED)가 가리키는 글은 옮기지 않는다 —
 *    후보는 만들 때의 게시판 문맥으로 쓰였다. 후보를 고치지 않고 이동을 막는다.
 *    끝난 후보(PUBLISHED · DECLINED · EXPIRED)만 걸린 글은 옮길 수 있다.
 * 🔴 공개(PUBLISHED) 글만 옮긴다 — 숨김 · 삭제 글은 이 화면에서 상태를 바꾸지 않는 것과 같은 이유다.
 *
 * 화면(관리자 글 상세)과 서버 트랜잭션이 이 함수 하나로 판정한다 — 둘이 갈라지지 않는다.
 */

export const MOVABLE_BOARDS = ['FREE', 'MENOPAUSE'] as const satisfies readonly BoardType[]
export type MovableBoard = (typeof MOVABLE_BOARDS)[number]

/** 이동을 막는 열린 Persona 후보 상태 — 아직 발행 · 폐기 · 만료로 끝나지 않은 것 */
export const OPEN_PERSONA_CANDIDATE_STATUSES = [
  'PENDING', 'APPROVED', 'EDITED',
] as const satisfies readonly PersonaCandidateStatus[]

export function isMovableBoard(value: unknown): value is MovableBoard {
  return typeof value === 'string' && (MOVABLE_BOARDS as readonly string[]).includes(value)
}

/** 판정 입력 — 글에서 읽은 사실. 판정 축 이름(isMicroSeed 등)은 여기 들어오지 않는다 */
export type BoardMoveFacts = {
  boardType: BoardType
  status: PostStatus
  personaId: string | null
  microSeedLane: boolean
  originalQueueLinked: boolean
  greeting: boolean
  openPersonaCandidates: number
}

export type BoardMoveBlockCode =
  | 'INVALID_TARGET'
  | 'NOT_COMMUNITY_BOARD'
  | 'PERSONA_POST'
  | 'MICRO_SEED_POST'
  | 'ORIGINAL_QUEUE_POST'
  | 'GREETING_POST'
  | 'NOT_PUBLISHED'
  | 'OPEN_PERSONA_CANDIDATE'
  | 'SAME_BOARD'

export const AUTOMATED_POST_MESSAGE = '자동 운영 글은 게시판을 변경할 수 없습니다.'

export const BOARD_MOVE_BLOCK_MESSAGE: Record<BoardMoveBlockCode, string> = {
  INVALID_TARGET: '옮길 수 있는 게시판은 자유게시판과 갱년기톡뿐입니다.',
  NOT_COMMUNITY_BOARD: '자유게시판·갱년기톡 글만 게시판을 변경할 수 있습니다.',
  PERSONA_POST: AUTOMATED_POST_MESSAGE,
  MICRO_SEED_POST: AUTOMATED_POST_MESSAGE,
  ORIGINAL_QUEUE_POST: AUTOMATED_POST_MESSAGE,
  GREETING_POST: '가입인사 글은 게시판을 변경할 수 없습니다.',
  NOT_PUBLISHED: '공개 중인 글만 게시판을 변경할 수 있습니다. 숨김·삭제 상태의 글은 옮기지 않습니다.',
  OPEN_PERSONA_CANDIDATE: '대기 중인 Persona 댓글 후보가 있어 이동할 수 없습니다.',
  SAME_BOARD: '이미 그 게시판에 있는 글입니다.',
}

export type BoardMoveBlocked = { ok: false; code: BoardMoveBlockCode; message: string }
export type BoardMoveJudgement = { ok: true; to: MovableBoard } | BoardMoveBlocked

const blocked = (code: BoardMoveBlockCode): BoardMoveBlocked =>
  ({ ok: false, code, message: BOARD_MOVE_BLOCK_MESSAGE[code] })

/**
 * 글 자체가 옮길 수 있는 글인가 — 목표 게시판과 무관한 막힘만 본다.
 * 화면은 이것으로 패널을 열지 · 닫을지(이유 문구)를 정한다.
 *
 * 🔴 순서가 곧 우선순위다 — 자동 운영 자산이면 다른 이유보다 먼저 그렇게 말한다.
 */
export function judgeBoardMoveSource(f: BoardMoveFacts): BoardMoveBlocked | null {
  if (!isMovableBoard(f.boardType)) return blocked('NOT_COMMUNITY_BOARD')
  if (f.personaId !== null && f.personaId !== '') return blocked('PERSONA_POST')
  if (f.microSeedLane) return blocked('MICRO_SEED_POST')
  if (f.originalQueueLinked) return blocked('ORIGINAL_QUEUE_POST')
  if (f.greeting) return blocked('GREETING_POST')
  if (f.status !== 'PUBLISHED') return blocked('NOT_PUBLISHED')
  if (f.openPersonaCandidates > 0) return blocked('OPEN_PERSONA_CANDIDATE')
  return null
}

/** 이 글을 이 게시판으로 옮길 수 있는가 — 서버 트랜잭션이 쓰기 직전에 부른다 */
export function judgeBoardMove(f: BoardMoveFacts, to: unknown): BoardMoveJudgement {
  if (!isMovableBoard(to)) return blocked('INVALID_TARGET')
  const source = judgeBoardMoveSource(f)
  if (source !== null) return source
  if (f.boardType === to) return blocked('SAME_BOARD')
  return { ok: true, to }
}
