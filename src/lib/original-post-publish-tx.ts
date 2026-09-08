/**
 * Original Post 발행 트랜잭션 — 🔴 write 가 일어나는 유일한 지점
 *
 * 정본: docs/operations/2026-09-02-original-post-lane-strategy.md §4
 *
 * 🔴 **세 write 가 한 트랜잭션이다.**
 *      ① Post          글이 생긴다
 *      ② Queue         status=PUBLISHED · createdPostId  — 🔴 ①과 반드시 같은 트랜잭션
 *      ③ ActivityLog   kind=post — 🔴 cap 의 정본. 빠지면 다음 발행에서 상한이 조용히 열린다
 *
 *    createdPostId 와 status 를 따로 쓰면 "PUBLISHED 인데 글이 없는" 행이 생기고,
 *    그게 이중 발행의 입구다. persona-publish-tx.ts 가 같은 이유로 셋을 묶는다.
 *
 * 🔴 **트랜잭션 안에서 다시 본다.** 배정과 발행 사이에 시간이 흐른다 —
 *    페르소나가 paused 됐을 수도, 다른 세션이 먼저 발행했을 수도 있다.
 *
 * 🔴 **조건부 UPDATE 다.** count 0 이면 throw 해서 Post 까지 롤백한다.
 *    글만 생기고 대기열은 그대로인 상태를 만들지 않는다.
 *
 * 🔴 예외 원문을 호출부로 흘리지 않는다.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  buildOriginalPostData, assertOriginalPostData, judgePublish,
  type PublishBlockCode,
} from './original-post-publish'

const QUEUE_RACE = 'ORIGINAL_POST_QUEUE_RACE'

export type PublishResult =
  | { kind: 'published'; postId: string; personaCode: string; boardType: string }
  | { kind: 'blocked'; code: PublishBlockCode; detail: string }
  | { kind: 'error'; message: string }

export type PublishTxInput = {
  queueId: string
  /** 오늘(KST) 이미 발행된 수 — 부르는 쪽이 센다 */
  publishedToday: number
  /**
   * 🔴 **하루 상한을 주입받는다** (2026-09-08).
   *    모듈 상수를 읽으면 `loadEnvLocal()`·GHA vars 로 정한 단계가 이 쓰기 경로에
   *    도달하지 못한다 — 관제는 감속했다고 말하는데 여기서는 옛 값으로 나간다.
   *    주지 않으면 `judgePublish` 가 가장 안전한 상수(1건)로 떨어뜨린다.
   */
  dailyCap: number
}

/**
 * 🔴 발행한다. 되돌릴 수 없다.
 *    이 함수가 성공하면 글은 커뮤니티에 나가고 sitemap 에 실린다.
 */
export async function publishOriginalPostTx(
  prisma: PrismaClient,
  input: PublishTxInput,
): Promise<PublishResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.originalPostApprovalQueue.findUnique({
        where: { id: input.queueId },
        select: {
          id: true, status: true, createdPostId: true, gateVerdict: true,
          draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
          matchedPersona: {
            select: {
              id: true, code: true, status: true, userId: true,
              // 🔴 실회원 판별 정본 — 카카오 로그인이 만드는 것은 Account 다.
              //    `providerId` 는 adapter 가 채우지 않는다 (src/lib/auth.ts §signIn)
              user: { select: { providerId: true, _count: { select: { accounts: true } } } },
            },
          },
        },
      })
      if (row === null) return { kind: 'error', message: '대상을 찾을 수 없습니다.' }

      // 🔴 kill switch — 행이 없으면 "중지 꺼짐" 과 같다 (schema 주석)
      const sw = await tx.personaGlobalSwitch.findUnique({
        where: { id: 'global' },
        select: { enabled: true },
      })

      // 🔴 트랜잭션 안에서 다시 판정한다. 배정 시점의 판정을 믿지 않는다
      const verdict = judgePublish(
        {
          status: row.status,
          createdPostId: row.createdPostId,
          gateVerdict: row.gateVerdict,
          matchedPersonaCode: row.matchedPersona?.code ?? null,
          personaStatus: row.matchedPersona?.status ?? null,
          personaProviderId: row.matchedPersona?.user?.providerId ?? null,
          // 🔴 persona 가 없으면 `null` 이고, judgePublish 가 fail-closed 로 막는다.
          //    여기서 0 으로 눙치면 "없는 persona" 가 실회원 검사를 통과한 것처럼 된다
          personaAccountCount: row.matchedPersona?.user?._count.accounts ?? null,
        },
        {
          killSwitchEnabled: sw?.enabled === true,
          publishedToday: input.publishedToday,
          // 🔴 주입값이다. 트랜잭션 안에서 다시 판정할 때도 같은 상한을 쓴다
          dailyCap: input.dailyCap,
        },
      )
      if (!verdict.ok) return { kind: 'blocked', code: verdict.code, detail: verdict.detail }

      const persona = row.matchedPersona!

      // ── ① Post ──
      // 🔴 수정본이 있으면 그것이 발행될 글이다
      const data = buildOriginalPostData({
        title: row.editedTitle ?? row.draftTitle,
        content: row.editedBody ?? row.draftBody,
        authorId: persona.userId,
        personaId: persona.id,
      })
      // 🔴 create 직전. 함수가 있다는 것과 그 함수만 쓰인다는 것은 다르다
      assertOriginalPostData(data)
      const post = await tx.post.create({
        data: data as unknown as Prisma.PostUncheckedCreateInput,
        select: { id: true, boardType: true },
      })

      // ── ② Queue ──
      // 🔴 조건부 UPDATE. 읽은 뒤 쓰는 사이에 누가 먼저 발행했으면 0건이 되어 롤백한다
      const updated = await tx.originalPostApprovalQueue.updateMany({
        where: { id: row.id, status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
        data: { status: 'PUBLISHED', createdPostId: post.id },
      })
      if (updated.count === 0) throw new Error(QUEUE_RACE)

      // ── ③ ActivityLog ──
      // 🔴 cap 의 정본이다. 이것이 빠지면 다음 발행에서 상한이 조용히 열린다
      await tx.personaActivityLog.create({
        data: {
          personaId: persona.id,
          kind: 'post',
          targetId: post.id,
          gateStatus: row.gateVerdict,
          decidedBy: 'operator',
          publishedAt: new Date(),
        },
      })

      return { kind: 'published', postId: post.id, personaCode: persona.code, boardType: post.boardType }
    })
  } catch (err) {
    if (err instanceof Error && err.message === QUEUE_RACE) {
      return { kind: 'error', message: '이미 발행된 후보입니다. 다시 확인해 주세요.' }
    }
    // 🔴 예외 원문을 호출부로 흘리지 않는다
    return { kind: 'error', message: '발행하지 못했습니다.' }
  }
}
