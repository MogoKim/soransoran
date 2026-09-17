'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/lib/auth'
import { requireAdmin } from '@/lib/admin'
import { prisma } from '@/lib/prisma'
import { getBoardByType } from '@/lib/board-registry'
import { communityPostHref } from '@/lib/admin-format'
import { checkPostContent } from '@/lib/post-guard-check'
import { checkContent } from '@/lib/content-guard'
import { isHtmlContent, postContentToText, sanitizePostHtml } from '@/lib/post-html'
import {
  COMMENT_TOO_LONG,
  COMMENT_TOO_SHORT,
  MAX_COMMENT_LENGTH,
  MIN_COMMENT_LENGTH,
} from '@/lib/comment-policy'
import {
  MAX_POST_CONTENT_LENGTH,
  MIN_POST_CONTENT_LENGTH,
  POST_CONTENT_TOO_LONG,
  POST_CONTENT_TOO_SHORT,
} from '@/lib/post-policy'
import { isOperatorBoard, judgeOperatorTitle } from '@/lib/operator-writer'
import {
  createOperatorCommentTx,
  createOperatorPostTx,
  deleteOperatorCommentTx,
  deleteOperatorPostTx,
  updateOperatorCommentTx,
  updateOperatorPostTx,
  type ComposeResult,
} from '@/lib/operator-compose-tx'

/**
 * 운영자 직접 작성 — 🔴 **이 파일이 유일한 진입점이다**
 *
 * 🔴 **전 함수가 `requireAdmin()` 을 먼저 통과한다.** 통과 못 하면 한 줄도 쓰지 않는다.
 *    layout 의 권한 확인에 기대지 않는다 — 서버 액션은 layout 을 거치지 않는다.
 *
 * 🔴 **실제 조작자는 서버 세션에서 얻는다.** `actorUserId` 를 FormData 로 받지 않는다 —
 *    받는 순간 그 값은 클라이언트가 정하는 값이 되고, 감사 기록이 근거를 잃는다.
 *
 * 🔴 **공개 작성자는 다시 검증한다.** 화면이 보낸 `operatorWriterId` 는 주장일 뿐이다.
 *    트랜잭션 안에서 status·Account·Persona 연결을 다시 읽어 판정한다
 *    (`operator-compose-tx.readWriter`).
 *
 * 🔴 **내용 검사를 새로 만들지 않는다.** 회원 글쓰기가 쓰는 `checkPostContent` ·
 *    `checkContent` 를 그대로 부른다. 운영자만 다른 규칙을 쓰면
 *    "회원에게는 막히는 말이 운영 글에서는 나간다" 가 된다.
 *
 * 🔴 **AI 를 부르지 않는다. 승인 대기열에 넣지 않는다.** 창업자가 손으로 쓴 글이다.
 */

export type ComposeActionState = {
  error?: string
  ok?: true
  /** 등록에 성공했을 때 고객 화면 주소 — 화면이 "가서 보기" 링크를 만든다 */
  href?: string
  /**
   * 🔴 **성공한 요청을 구분하는 값** (2026-09-17).
   *
   *    `ok` 만으로는 **두 번째 성공을 알아볼 수 없다.** `true` 에서 `true` 로 바뀌면
   *    바뀐 것이 없고, 화면의 정리 로직이 돌지 않는다 — 실측으로 잡은 결함이다.
   *    옛 판은 `[state.ok]` 만 보다가 두 번째 등록부터 **요청 키를 갱신하지 못했고**,
   *    같은 키로 보내진 두 번째 글이 중복 차단에 걸려 영영 등록되지 않았다.
   *    (중복 차단이 틀린 것이 아니라, 새 요청에 새 키를 못 준 것이 틀렸다)
   *
   * 🔴 값은 **그 요청의 `requestKey`** 다. 매 등록마다 다르므로 화면이 매번 알아본다.
   *    새로 만든 글의 id 가 아니다 — 화면이 물어야 하는 것은 "무엇이 생겼나" 가 아니라
   *    **"내가 보낸 그 요청이 끝났나"** 이고, 두 질문은 다르다.
   */
  doneKey?: string
  /**
   * 🔴 **이 응답이 어느 쪽 요청의 것인가** — `post` 또는 `comment` (2026-09-17).
   *
   *    화면은 글 쓰기와 댓글 달기를 한 폼에서 오간다. `useFormState` 의 상태는
   *    모드를 바꿔도 살아 있으므로, 글을 올린 뒤 댓글 모드로 옮기면
   *    **방금 올린 글의 "등록했습니다" 와 그 글 링크가 그대로 남아 있었다.**
   *    댓글이 등록된 것으로 읽히는 자리다.
   *
   *    서버가 어느 쪽이었는지 말해 주고, 화면은 지금 모드와 같을 때만 보여 준다.
   *    화면이 짐작하지 않는다 — 짐작하면 보내고 나서 모드를 바꾼 경우에 틀린다.
   */
  kind?: 'post' | 'comment'
  /** 입력을 잃지 않도록 화면이 되돌려 받는 값 */
  kept?: { writerId: string; boardType: string; title: string; content: string }
}

const DENIED: ComposeActionState = { error: '권한이 없습니다.' }

/** 🔴 관리자 확인 + 실제 조작자 id. 하나라도 없으면 아무것도 쓰지 않는다 */
async function requireActor(): Promise<{ actorUserId: string } | null> {
  const { ok } = await requireAdmin()
  if (!ok) return null
  const session = await auth()
  const actorUserId = session?.user?.id
  // 🔴 requireAdmin 이 세션을 봤으므로 여기 없을 수 없지만, 없으면 쓰지 않는다
  if (!actorUserId) return null
  return { actorUserId }
}

/**
 * 이 글이 바뀌면 다시 그려야 할 고객 화면들 — 어드민(`actions/admin.ts`)과 같은 조각이다.
 *
 * 🔴 경로를 문자열로 짐작하지 않는다. `board-registry` 가 유일한 출처다 —
 *    없는 경로를 revalidate 하면 조용히 실패해서 "올렸는데 목록에 없다" 로 나타난다.
 * 🔴 홈과 /best 도 넣는다. 인기글이 두 곳에서 뽑힌다.
 */
function revalidateFor(postId: string, boardType: string): string | null {
  if (!isOperatorBoard(boardType)) return null
  const board = getBoardByType(boardType)
  const href = communityPostHref(postId, boardType)
  if (href) revalidatePath(href)
  if (board) revalidatePath(board.href)
  revalidatePath('/')
  revalidatePath('/best')
  revalidatePath('/admin/compose')
  return href
}

/**
 * 트랜잭션 결과를 화면의 말로 옮긴다.
 *
 * 🔴 `doneKey` 는 **등록(create)에만** 붙는다. 수정·삭제는 요청 키를 쓰지 않고,
 *    화면도 그때는 폼을 비우지 않는다.
 */
function toState(
  res: ComposeResult,
  kept?: ComposeActionState['kept'],
  requestKey?: string,
  /** 🔴 어느 쪽 요청이었나 — 화면이 지금 모드와 대조한다 */
  kind?: 'post' | 'comment',
): ComposeActionState {
  const tag = kind ? { kind } : {}
  if (res.kind === 'created') {
    const href = revalidateFor(res.postId, res.boardType)
    return {
      ok: true,
      ...tag,
      ...(href ? { href } : {}),
      ...(requestKey ? { doneKey: requestKey } : {}),
    }
  }
  if (res.kind === 'updated' || res.kind === 'deleted') {
    revalidatePath('/admin/compose')
    revalidatePath('/')
    revalidatePath('/best')
    return { ok: true, ...tag }
  }
  // 🔴 실패하면 쓰던 내용을 돌려준다 — 오류 때문에 글을 잃지 않게 한다
  return { error: res.message, ...tag, ...(kept ? { kept } : {}) }
}

// ─────────────────────────────────────────────────────────
// ⓪ 진입점 하나 — 🔴 화면은 이 함수만 부른다
// ─────────────────────────────────────────────────────────

/**
 * 글이든 댓글이든 **이 함수 하나로 들어온다.**
 *
 * 🔴 **왜 하나인가** (2026-09-17 · 실측으로 잡은 결함).
 *
 *    옛 판은 화면이 모드에 따라 `useFormState(글 액션)` 과 `useFormState(댓글 액션)` 을
 *    바꿔 끼웠다. 그런데 `useFormState` 가 돌려주는 dispatch 는 폼에 심긴
 *    **server action 참조와 한 몸**이라, 모드를 오가면 그 참조가 따라오지 않는 순간이 있다.
 *
 *    실측: 글 → 댓글 → **다시 글** 로 돌아가 등록을 누르면 서버에서는 여전히
 *    **댓글 액션**이 돌았다. 글 모드에는 `postId` 가 폼에 없으니 *"댓글을 달 글을
 *    골라 주세요"* 로 막히는데, 그 응답은 `kind='comment'` 라 글 모드 화면에서
 *    **걸러져 아무것도 보이지 않았다.** 버튼을 눌러도 조용히 아무 일도 안 일어난다 —
 *    사용자가 원인을 알 길이 없는 가장 나쁜 실패다.
 *
 * 🔴 **고치는 방향은 "화면이 액션을 바꾸지 않는다" 다.** 무엇을 쓰는지는 값(`mode`)으로
 *    보내고, 갈라지는 것은 서버에서 한다. 바꿔 끼울 것이 없으면 어긋날 것도 없다.
 */
export async function createOperatorContent(
  prev: ComposeActionState,
  formData: FormData,
): Promise<ComposeActionState> {
  const mode = String(formData.get('mode') ?? '').trim()
  if (mode === 'post') return createOperatorPost(prev, formData)
  if (mode === 'comment') return createOperatorComment(prev, formData)
  // 🔴 모르면 쓰지 않는다. 짐작해서 한쪽으로 보내면 엉뚱한 곳에 글이 올라간다
  return { error: '무엇을 쓸지 고르지 못했습니다. 새로고침 후 다시 시도해 주세요.' }
}

// ─────────────────────────────────────────────────────────
// ① 글 쓰기
// ─────────────────────────────────────────────────────────

export async function createOperatorPost(
  _prev: ComposeActionState,
  formData: FormData,
): Promise<ComposeActionState> {
  const actor = await requireActor()
  if (actor === null) return DENIED

  const writerId = String(formData.get('writerId') ?? '').trim()
  const boardType = String(formData.get('boardType') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()
  const raw = String(formData.get('content') ?? '').trim()
  const requestKey = String(formData.get('requestKey') ?? '').trim()

  // 🔴 실패해도 입력을 잃지 않는다
  const kept = { writerId, boardType, title, content: raw }
  const fail = (error: string): ComposeActionState => ({ error, kept, kind: 'post' })

  if (writerId === '') return fail('작성자를 골라 주세요.')
  if (!isOperatorBoard(boardType)) return fail('게시판을 골라 주세요.')
  if (requestKey === '') return fail('다시 시도해 주세요.')

  const titleError = judgeOperatorTitle(title)
  if (titleError !== null) return fail(titleError)

  /**
   * 🔴 운영자가 쓴 본문도 sanitize 를 지난다. 운영자를 의심해서가 아니라,
   *    다른 화면에서 본문을 복사해 붙이는 일이 실제로 일어나기 때문이다.
   *    평문으로 온 것은 평문으로 둔다 — 어드민 수정과 같은 계약이다.
   */
  const content = isHtmlContent(raw) ? sanitizePostHtml(raw) : raw
  const text = postContentToText(content)
  if (text.length < MIN_POST_CONTENT_LENGTH) return fail(POST_CONTENT_TOO_SHORT)
  if (text.length > MAX_POST_CONTENT_LENGTH) return fail(POST_CONTENT_TOO_LONG)

  // 🔴 회원 글쓰기와 **같은 함수**다
  const guard = checkPostContent({ title, text })
  if (guard !== null) return fail(guard.message)

  const res = await createOperatorPostTx(prisma, {
    operatorWriterId: writerId,
    boardType,
    title,
    content,
    actorUserId: actor.actorUserId,
    requestKey,
  })
  return toState(res, kept, requestKey, 'post')
}

// ─────────────────────────────────────────────────────────
// ② 댓글 쓰기
// ─────────────────────────────────────────────────────────

export async function createOperatorComment(
  _prev: ComposeActionState,
  formData: FormData,
): Promise<ComposeActionState> {
  const actor = await requireActor()
  if (actor === null) return DENIED

  const writerId = String(formData.get('writerId') ?? '').trim()
  const postId = String(formData.get('postId') ?? '').trim()
  const content = String(formData.get('content') ?? '').trim()
  const requestKey = String(formData.get('requestKey') ?? '').trim()

  const kept = { writerId, boardType: '', title: '', content }
  const fail = (error: string): ComposeActionState => ({ error, kept, kind: 'comment' })

  if (writerId === '') return fail('작성자를 골라 주세요.')
  if (postId === '') return fail('댓글을 달 글을 골라 주세요.')
  if (requestKey === '') return fail('다시 시도해 주세요.')
  if (content.length < MIN_COMMENT_LENGTH) return fail(COMMENT_TOO_SHORT)
  if (content.length > MAX_COMMENT_LENGTH) return fail(COMMENT_TOO_LONG)

  const guard = checkContent(content, { audience: 'user' })
  if (!guard.ok) return fail(guard.reason)

  const res = await createOperatorCommentTx(prisma, {
    operatorWriterId: writerId,
    postId,
    content,
    actorUserId: actor.actorUserId,
    requestKey,
  })
  return toState(res, kept, requestKey, 'comment')
}

// ─────────────────────────────────────────────────────────
// ③ 수정
// ─────────────────────────────────────────────────────────

export async function updateOperatorPost(
  _prev: ComposeActionState,
  formData: FormData,
): Promise<ComposeActionState> {
  const actor = await requireActor()
  if (actor === null) return DENIED

  const postId = String(formData.get('postId') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()
  const raw = String(formData.get('content') ?? '').trim()

  if (postId === '') return { error: '글을 찾지 못했습니다.' }
  const titleError = judgeOperatorTitle(title)
  if (titleError !== null) return { error: titleError }

  const content = isHtmlContent(raw) ? sanitizePostHtml(raw) : raw
  const text = postContentToText(content)
  if (text.length < MIN_POST_CONTENT_LENGTH) return { error: POST_CONTENT_TOO_SHORT }
  if (text.length > MAX_POST_CONTENT_LENGTH) return { error: POST_CONTENT_TOO_LONG }

  const guard = checkPostContent({ title, text })
  if (guard !== null) return { error: guard.message }

  return toState(await updateOperatorPostTx(prisma, {
    postId, title, content, actorUserId: actor.actorUserId,
  }))
}

export async function updateOperatorComment(
  _prev: ComposeActionState,
  formData: FormData,
): Promise<ComposeActionState> {
  const actor = await requireActor()
  if (actor === null) return DENIED

  const commentId = String(formData.get('commentId') ?? '').trim()
  const content = String(formData.get('content') ?? '').trim()

  if (commentId === '') return { error: '댓글을 찾지 못했습니다.' }
  if (content.length < MIN_COMMENT_LENGTH) return { error: COMMENT_TOO_SHORT }
  if (content.length > MAX_COMMENT_LENGTH) return { error: COMMENT_TOO_LONG }

  const guard = checkContent(content, { audience: 'user' })
  if (!guard.ok) return { error: guard.reason }

  return toState(await updateOperatorCommentTx(prisma, {
    commentId, content, actorUserId: actor.actorUserId,
  }))
}

// ─────────────────────────────────────────────────────────
// ④ 삭제 — 🔴 되돌릴 수 있게 가린다
// ─────────────────────────────────────────────────────────

export async function deleteOperatorPost(postId: string): Promise<ComposeActionState> {
  const actor = await requireActor()
  if (actor === null) return DENIED
  if (postId.trim() === '') return { error: '글을 찾지 못했습니다.' }
  return toState(await deleteOperatorPostTx(prisma, { postId, actorUserId: actor.actorUserId }))
}

export async function deleteOperatorComment(commentId: string): Promise<ComposeActionState> {
  const actor = await requireActor()
  if (actor === null) return DENIED
  if (commentId.trim() === '') return { error: '댓글을 찾지 못했습니다.' }
  return toState(await deleteOperatorCommentTx(prisma, { commentId, actorUserId: actor.actorUserId }))
}
