/**
 * Persona 목소리 댓글 저장 트랜잭션 — 운영 레인 (정책 정본: operator-persona-voice.ts 머리 주석)
 *
 * 🔴 저장 모양은 운영자 댓글과 같다 — buildOperatorCommentData · assertOperatorCommentData 를 그대로 쓴다
 *    (commentOrigin=OPERATOR · personaId 없음 · 최상위). 작성자 = 그 Persona 의 User, 작성자 행 = 그 Persona 의 `PV` 행.
 *    그래서 자동 레인(D100)의 예산·비율·단계 증거는 이 댓글을 세지 않는다.
 * 🔴 판정은 전부 이 트랜잭션 안에서 다시 한다(화면이 본 사진을 믿지 않는다).
 * 🔴 **거절은 throw 한다.** 콜백이 거절을 return 하면 트랜잭션이 커밋되어, 그 전에 만든 행이 남는다.
 *    그래서 PV 행 확보는 모든 판정 **뒤**에 두고, 거절은 Refused 로 던져 통째로 되돌린다.
 * 🔴 PV 행은 그 Persona 로 처음 쓸 때 만든다 — createMany(skipDuplicates)(= INSERT … ON CONFLICT DO NOTHING).
 *    두 요청이 동시에 와도 OperatorWriter.userId·code @unique 가 한 행만 남긴다. 그 뒤 다시 읽어 code 를 대조한다.
 * 🔴 /best 동기화(syncBestEligibility)를 부르지 않는다 — 운영 댓글은 /best 입력이 아니다.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

import { judgeKstQuietWindow, PERSONA_VOICE_QUIET_WINDOW } from './kst-write-quiet-window'
import { judgePersonaVoiceSpeaker, judgePersonaVoiceTarget } from './operator-persona-voice'
import { assertOperatorCommentData, buildOperatorCommentData, judgeOperatorWriter } from './operator-writer'
import { TX_MAX_WAIT_MS, TX_TIMEOUT_MS, isDuplicateRequest, type ComposeResult } from './operator-compose-tx'
import { POST_VISIBILITY_SELECT, pickPostVisibility } from './post-visibility'

export type CreatePersonaVoiceCommentInput = {
  personaId: string
  postId: string
  content: string
  /** 🔴 서버 세션의 관리자 User.id. 클라이언트 입력이 아니다 */
  actorUserId: string
  requestKey: string
  /** 판정 시각 — 시간 창과 25시간 경계가 같은 시각을 본다 */
  now: Date
}

export const PERSONA_VOICE_MESSAGE = {
  personaGone: '그 Persona 를 찾을 수 없습니다.',
  postGone: '대상 글을 찾을 수 없습니다.',
  blockedByAuthor: '이 글을 쓴 회원이 이 Persona 를 차단했습니다. 회원에게 보이지 않으니 다른 Persona 를 골라 주세요.',
  writerMismatch: '🔴 이 Persona 의 작성자 행이 어긋났습니다 — 쓰지 않습니다.',
  duplicate: '이미 등록된 댓글입니다. 작성 내역에서 확인해 주세요.',
  error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
} as const

class Refused extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage)
  }
}

export async function createPersonaVoiceCommentTx(
  db: PrismaClient,
  input: CreatePersonaVoiceCommentInput,
): Promise<ComposeResult> {
  try {
    return await db.$transaction(async (tx: Prisma.TransactionClient): Promise<ComposeResult> => {
      // ① 시간 창 (임시)
      const quiet = judgeKstQuietWindow(input.now, PERSONA_VOICE_QUIET_WINDOW)
      if (!quiet.ok) throw new Refused(quiet.reason)

      // ② 말하는 Persona — 상태 · 처리 대기 신고(그 계정의 댓글·글)
      const persona = await tx.persona.findUnique({
        where: { id: input.personaId },
        select: {
          id: true,
          code: true,
          status: true,
          userId: true,
          user: { select: { providerId: true, _count: { select: { accounts: true } } } },
        },
      })
      if (persona === null) throw new Refused(PERSONA_VOICE_MESSAGE.personaGone)
      const pendingReports = await tx.report.count({
        where: {
          status: 'PENDING',
          OR: [{ comment: { authorId: persona.userId } }, { post: { authorId: persona.userId } }],
        },
      })
      const speaker = judgePersonaVoiceSpeaker({ code: persona.code, status: persona.status, pendingReports })
      if (!speaker.ok) throw new Refused(speaker.reason)

      // ③ 대상 글 — 공개 · 게시판 · Micro Seed · 자동 글 나이 · 글쓴이
      const post = await tx.post.findUnique({
        where: { id: input.postId },
        select: {
          id: true,
          boardType: true,
          personaId: true,
          operatorWriterId: true,
          authorId: true,
          publishAt: true,
          createdAt: true,
          ...POST_VISIBILITY_SELECT,
          author: { select: { providerId: true, _count: { select: { accounts: true } } } },
        },
      })
      if (post === null) throw new Refused(PERSONA_VOICE_MESSAGE.postGone)
      const target = judgePersonaVoiceTarget(
        {
          ...pickPostVisibility(post),
          boardType: post.boardType,
          personaId: post.personaId,
          operatorWriterId: post.operatorWriterId,
          publishedAt: post.publishAt ?? post.createdAt,
          authorAccountCount: post.author._count.accounts,
          authorProviderId: post.author.providerId,
        },
        input.now.getTime(),
      )
      if (!target.ok) throw new Refused(target.reason)

      // ④ 글쓴이가 이 Persona 를 차단했는가 — 글쓴이에게 보이지 않는 댓글은 답이 아니다
      const blocked = await tx.userBlock.count({ where: { blockerId: post.authorId, blockedUserId: persona.userId } })
      if (blocked > 0) throw new Refused(PERSONA_VOICE_MESSAGE.blockedByAuthor)

      // ⑤ 🔴 판정이 모두 끝난 뒤에만 PV 행을 확보한다
      await tx.operatorWriter.createMany({ data: [{ code: speaker.pvCode, userId: persona.userId }], skipDuplicates: true })
      const writer = await tx.operatorWriter.findUnique({
        where: { userId: persona.userId },
        select: { id: true, code: true, status: true },
      })
      if (writer === null || writer.code !== speaker.pvCode) throw new Refused(PERSONA_VOICE_MESSAGE.writerMismatch)
      const writerVerdict = judgeOperatorWriter(
        {
          status: writer.status,
          accountCount: persona.user._count.accounts,
          providerId: persona.user.providerId,
          hasPersona: true,
        },
        'persona',
      )
      if (!writerVerdict.ok) throw new Refused(writerVerdict.reason)

      // ⑥ 저장 — 운영자 댓글과 같은 모양 · 감사 기록과 한 트랜잭션
      const data = buildOperatorCommentData({
        postId: post.id,
        content: input.content,
        authorId: persona.userId,
        operatorWriterId: writer.id,
      })
      assertOperatorCommentData(data)
      const comment = await tx.comment.create({
        data: data as unknown as Prisma.CommentUncheckedCreateInput,
        select: { id: true },
      })
      await tx.operatorWriteLog.create({
        data: {
          operatorWriterId: writer.id,
          actorUserId: input.actorUserId,
          kind: 'comment',
          action: 'create',
          targetId: comment.id,
          postId: post.id,
          requestKey: input.requestKey,
        },
        select: { id: true },
      })
      return { kind: 'created', targetId: comment.id, postId: post.id, boardType: post.boardType }
    }, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS })
  } catch (err) {
    if (err instanceof Refused) return { kind: 'blocked', message: err.userMessage }
    if (isDuplicateRequest(err)) return { kind: 'duplicate', message: PERSONA_VOICE_MESSAGE.duplicate }
    console.error('[operator-persona-voice]', (err as Error)?.message)
    return { kind: 'error', message: PERSONA_VOICE_MESSAGE.error }
  }
}
