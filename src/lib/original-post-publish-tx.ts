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
 * 🔴 **하루 상한은 트랜잭션 **안에서** 다시 센다** (2026-09-14 정정).
 *
 *    옛 판은 호출부가 밖에서 센 `publishedToday` 를 그대로 판정에 썼고, 격리 수준도
 *    기본값(Read Committed)이었다. 그러면 **서로 다른 후보의 두 트랜잭션이 같은 스냅샷을
 *    읽는다** — 둘 다 `publishedToday=0` 을 보고 둘 다 통과한다. 상한이 1인데 2건이 나간다.
 *    조건부 `updateMany` 는 **같은 후보**의 경쟁만 막는다. 다른 후보끼리는 막을 것이 없었다.
 *
 *    댓글 레인(`persona-publish-tx`)이 2026-09-09 에 같은 결함을 고쳤다. 이쪽은 남아 있었고,
 *    catch-up 도입으로 **여러 run 이 동시에 "밀린 1건" 을 보게 되면서** 실제 위험이 됐다.
 *    그래서 같은 처방을 쓴다 — Serializable + 트랜잭션 안 재counting.
 *
 * 🔴 예외 원문을 호출부로 흘리지 않는다.
 */
import { PERSONA_FOR_MATCH_SELECT, personaForMatchOf, judgeAutoAssignment } from './persona-for-match'
import { PROFILES, releaseCapsOf, type ReleaseStage } from './scale-profile'
import { boundedReleaseStage } from './scale-runtime'
import { AUTO_DECIDER } from './auto-ready-v2'
import { recheckAutoReadyInTx } from './auto-ready-repo'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  buildOriginalPostData, assertOriginalPostData, judgePublish, kstDayStart,
  type PublishBlockCode,
} from './original-post-publish'

const QUEUE_RACE = 'ORIGINAL_POST_QUEUE_RACE'

/**
 * 🔴 Serializable 트랜잭션의 시간 손잡이 — `persona-publish-tx` 와 같은 값이다.
 *    `maxWait` 는 잠금을 기다리는 시간, `timeout` 은 트랜잭션 자체의 상한이다.
 *    이 트랜잭션은 판정 쿼리가 여럿이라 기본 5초로는 부하가 있을 때 판정 도중 잘린다.
 */
export const TX_MAX_WAIT_MS = 20_000
export const TX_TIMEOUT_MS = 30_000

/**
 * 🔴 직렬화 충돌인가. Prisma 는 `P2034` 로 준다.
 *    코드가 없는 드라이버 오류도 있으므로 메시지도 함께 본다 — 모르면 충돌로 보지 않는다.
 */
export function isSerializationConflict(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false
  const e = err as { code?: unknown; message?: unknown }
  if (e.code === 'P2034') return true
  return typeof e.message === 'string'
    && /could not serialize|serialization failure|write conflict|deadlock detected/i.test(e.message)
}

export type PublishResult =
  | {
      kind: 'published'; postId: string; personaCode: string; boardType: string
      /** 🔴 트랜잭션 안에서 다시 센 오늘 발행 수 — 밖의 값과 다르면 경쟁이 있었다 */
      publishedTodayInTx?: number
    }
  | { kind: 'blocked'; code: PublishBlockCode; detail: string; publishedTodayInTx?: number }
  | { kind: 'error'; message: string }

export type PublishTxInput = {
  queueId: string
  /**
   * 오늘(KST) 이미 발행된 수 — 부르는 쪽이 센 값이다.
   *
   * 🔴 **판정에 쓰지 않는다.** 이 값은 밖에서 센 그 순간의 사진이라, 그 사이 다른 run 이
   *    가져간 자리를 모른다. 판정은 트랜잭션 안에서 다시 센 값으로 한다 —
   *    이 필드는 **로그 대조용**으로만 남는다(밖과 안이 다르면 경쟁이 있었다는 뜻이다).
   */
  publishedToday: number
  /**
   * 🔴 **하루 상한을 주입받는다** (2026-09-08).
   *    모듈 상수를 읽으면 `loadEnvLocal()`·GHA vars 로 정한 단계가 이 쓰기 경로에
   *    도달하지 못한다 — 관제는 감속했다고 말하는데 여기서는 옛 값으로 나간다.
   *    주지 않으면 `judgePublish` 가 가장 안전한 상수(1건)로 떨어뜨린다.
   *
   * 🔴 **계약 부채 (2026-09-25 · auto-ready-v2 PR #573)** — Persona 상한은 이제 단계 이름을 받아
   *    env 천장으로 누르지만(`releaseStage`), 이 하루 상한은 **아직 호출자가 넘기는 숫자**다.
   *    같은 방식(단계 → `PROFILES[stage].dailyTarget`)으로 옮기는 일은 기반 PR 밖에서 한다.
   */
  dailyCap: number
  /**
   * 🔴 **자동 READY env** (2026-09-25 · auto-ready-v2). 스위치는 여기서 읽고, 증거·결함은
   *    **이 트랜잭션 안에서 DB 로** 다시 판정한다 — 호출자가 "열림" 을 정하지 않는다.
   *    주지 않으면 `{}` = 꺼짐. 사람 결정 행에는 아무 영향이 없다.
   */
  autoReadyEnv?: Readonly<Record<string, string | undefined>>
  /**
   * 🔴 **자동 행의 Persona 배정 — 발행 트랜잭션 안에서 쓴다** (2026-09-25 마스터 지적).
   *    앞판은 러너가 트랜잭션 **밖에서 먼저** 배정을 쓰고, 그 뒤 재검증이 실패하면
   *    Post 는 0 인데 `matchedPersonaId`·`matchedAt` 만 바뀐 채 남았다.
   *    이제 자동 행은 재검증 → 발행 판정 → **배정 쓰기** → Post 가 한 트랜잭션이다.
   *    🔴 사람 결정 행에는 쓰지 않는다 — 그 경로의 기존 동작은 그대로다.
   */
  autoAssign?: {
    /**
     * 🔴 **권위값이 아니다.** "누구를 검토할지" 일 뿐이다. 트랜잭션 안에서 그 Persona 를
     *    다시 읽어 말투·생활사·실회원·주간 사용량·최소 간격을 정본 함수로 다시 판정한다.
     */
    personaId: string
    matchMeta: unknown
  }
  /**
   * 🔴 **자동 행 Persona 재판정에 쓸 공개 단계** (2026-09-25 마스터 지적).
   *    앞판은 `caps` 숫자를 그대로 받았다 — 호출자가 `{ postsPerWeek: 1e9 }` 를 넘기면 상한이 열렸다.
   *    이제 단계 이름만 받고, 상한은 정본 `releaseCapsOf(PROFILES[stage])` 에서 얻는다.
   *    그 단계도 env 천장(`boundedReleaseStage`)으로 누른다. 없거나 모르는 값이면 가장 안전한 단계.
   *    🔴 `matchedAt` 도 받지 않는다 — 배정 시각은 이 트랜잭션의 시계 하나다.
   */
  releaseStage?: ReleaseStage
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
      /**
       * 🔴 **이 트랜잭션의 시계는 하나다** (2026-09-25 마스터 지적). 배정 시각 · 주간 사용량 ·
       *    최소 간격 · 오늘 발행 수 · 단계 천장이 모두 이 값을 쓴다. 호출자 시각을 받지 않는다 —
       *    미래 `matchedAt` 을 넘겨 간격 계산을 틀어지게 하는 길을 없앤다.
       */
      const txNow = new Date()
      const row = await tx.originalPostApprovalQueue.findUnique({
        where: { id: input.queueId },
        select: {
          id: true, status: true, createdPostId: true, gateVerdict: true,
          draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
          // 🔴 자동 도장 재검증용 — 누가 결정했고 무엇을 보고 찍었나
          decidedBy: true, editDiff: true, gateResults: true,
          rawContent: { select: { sourceCapturedAt: true } },
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

      /**
       * ── ⓪ 🔴 **자동 도장 행은 가장 먼저 다시 본다** (2026-09-25) ──
       *    배정·Post 어떤 쓰기보다 **앞**이다. 스위치 · 도장(실제로 발행할 제목·본문) ·
       *    경고 · **DB 증거 30/90%/결함 0** · 확정 결함을 이 트랜잭션 안에서 판정한다.
       *    여기서 막히면 이 트랜잭션은 아무것도 쓰지 않는다.
       */
      const isAuto = (row.decidedBy ?? '').trim() === AUTO_DECIDER
      if (isAuto) {
        const recheck = await recheckAutoReadyInTx(tx, {
          env: input.autoReadyEnv ?? {},
          title: row.editedTitle ?? row.draftTitle,
          body: row.editedBody ?? row.draftBody,
          editDiff: row.editDiff, gateVerdict: row.gateVerdict, gateResults: row.gateResults,
          sourceCapturedAt: row.rawContent?.sourceCapturedAt ?? null,
        })
        if (!recheck.ok) return { kind: 'blocked', code: 'AUTO_READY_RECHECK', detail: recheck.reason }
      }

      /**
       * 🔴 **자동 행의 배정은 아직 쓰지 않는다.** 배정할 Persona 를 읽어 발행 판정에 쓰고,
       *    판정을 통과한 뒤에만 이 트랜잭션 안에서 쓴다.
       */
      const pinned = row.matchedPersona !== null
      const pendingAssign = isAuto && !pinned && input.autoAssign !== undefined
      let personaRow = row.matchedPersona
      if (isAuto && (pinned || pendingAssign)) {
        /**
         * 🔴 **자동 행의 Persona 를 트랜잭션 안에서 다시 판정한다** (2026-09-25 마스터 지적 ×2).
         *    · 계획한 Persona — 호출자가 넘긴 id 를 믿으면 상한이 찼거나 말투가 다르거나
         *      아무 active id 여도 그대로 나간다.
         *    · **이미 배정된 Persona 도 같다** — 배정 뒤 말투·생활사·상태·Account 가 바뀌었을 수 있다.
         *      🔴 재배정하지 않는다. 부적격이면 막고, 행은 큐에 그대로 남는다.
         *    로더와 **같은 조립**(`personaForMatchOf`)과 **같은 판정**(`judgeVoiceMatch` ·
         *    `readPostRequirements` · `hardFilter`)을 쓴다. 주간 사용량·최소 간격에서는
         *    **이 행 자신의 배정을 뺀다** — 넣으면 정상 행이 자기 `matchedAt` 으로 막힌다.
         */
        const personaId = pinned ? row.matchedPersona!.id : input.autoAssign!.personaId
        const pr = await tx.persona.findUnique({ where: { id: personaId }, select: PERSONA_FOR_MATCH_SELECT })
        const which = pinned ? '기존 배정' : '계획한 배정'
        if (pr === null) return { kind: 'blocked', code: 'AUTO_ASSIGN_STALE', detail: `${which} Persona 가 없다` }
        const forMatch = await personaForMatchOf(tx, pr, txNow, { excludeQueueId: row.id })
        const stage = boundedReleaseStage(input.releaseStage, input.autoReadyEnv ?? {}, txNow)
        // 🔴 계획기(`planPublishBatch`)와 **같은 판정 함수**다 — 둘이 갈리면 막히는 행이 선두를 차지한다
        const v = judgeAutoAssignment({
          persona: forMatch, gateResults: row.gateResults,
          title: row.editedTitle ?? row.draftTitle, body: row.editedBody ?? row.draftBody,
          caps: releaseCapsOf(PROFILES[stage]),
        })
        if (!v.ok) {
          return {
            kind: 'blocked', code: 'AUTO_ASSIGN_STALE',
            detail: `${which} ${pr.code} (${stage}) — ${v.route === 'defer' ? '유예' : '예외'}: ${v.codes.join(', ')}`,
          }
        }
        personaRow = { id: pr.id, code: pr.code, status: pr.status, userId: pr.userId, user: pr.user }
      }

      // 🔴 kill switch — 행이 없으면 "중지 꺼짐" 과 같다 (schema 주석)
      const sw = await tx.personaGlobalSwitch.findUnique({
        where: { id: 'global' },
        select: { enabled: true },
      })

      /**
       * 🔴 **오늘 발행 수를 이 트랜잭션 안에서 다시 센다** (2026-09-14).
       *
       *    밖에서 센 값(`input.publishedToday`)은 그 순간의 사진이다. catch-up 이 들어오면
       *    여러 run 이 같은 "밀린 1건" 을 동시에 보게 되고, 그때 밖의 사진을 믿으면
       *    둘 다 통과한다. cap 의 정본은 `PersonaActivityLog(kind='post')` 이고,
       *    러너·화면·이 트랜잭션이 **같은 표를 같은 경계(KST 자정)로** 세야 한다.
       */
      const publishedTodayInTx = await tx.personaActivityLog.count({
        where: { kind: 'post', createdAt: { gte: kstDayStart(txNow) } },
      })

      // 🔴 트랜잭션 안에서 다시 판정한다. 배정 시점의 판정을 믿지 않는다
      const verdict = judgePublish(
        {
          status: row.status,
          createdPostId: row.createdPostId,
          gateVerdict: row.gateVerdict,
          matchedPersonaCode: personaRow?.code ?? null,
          personaStatus: personaRow?.status ?? null,
          personaProviderId: personaRow?.user?.providerId ?? null,
          // 🔴 persona 가 없으면 `null` 이고, judgePublish 가 fail-closed 로 막는다.
          //    여기서 0 으로 눙치면 "없는 persona" 가 실회원 검사를 통과한 것처럼 된다
          personaAccountCount: personaRow?.user?._count.accounts ?? null,
        },
        {
          killSwitchEnabled: sw?.enabled === true,
          // 🔴 **트랜잭션 안에서 다시 센 값**이다. 밖에서 받은 사진을 쓰지 않는다
          publishedToday: publishedTodayInTx,
          // 🔴 주입값이다. 트랜잭션 안에서 다시 판정할 때도 같은 상한을 쓴다
          dailyCap: input.dailyCap,
        },
      )
      if (!verdict.ok) {
        return { kind: 'blocked', code: verdict.code, detail: verdict.detail, publishedTodayInTx }
      }

      const persona = personaRow!

      // ── ⓪-b 🔴 자동 행 배정 — 재검증·발행 판정을 모두 통과한 뒤, 같은 트랜잭션에서 ──
      if (pendingAssign) {
        const assigned = await tx.originalPostApprovalQueue.updateMany({
          where: {
            id: row.id, matchedPersonaId: null, decidedBy: AUTO_DECIDER,
            status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null,
          },
          data: {
            matchedPersonaId: persona.id, matchedAt: txNow,
            matchMeta: input.autoAssign!.matchMeta as Prisma.InputJsonValue,
          },
        })
        // 🔴 그 사이 누가 배정했으면 롤백한다 — 뒤의 쓰기와 함께 되돌아간다
        if (assigned.count !== 1) throw new Error(QUEUE_RACE)
      }

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
        // 🔴 결정자도 읽은 그대로여야 한다 — 그 사이 도장이 바뀌었으면 0건이 되어 롤백한다
        where: { id: row.id, status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null, decidedBy: row.decidedBy },
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
          publishedAt: txNow,
        },
      })

      return {
        kind: 'published', postId: post.id, personaCode: persona.code,
        boardType: post.boardType, publishedTodayInTx,
      }
    }, {
      /**
       * 🔴 **Serializable 이어야 하는 이유.**
       *    글로벌 일일 상한은 "이 후보가 몇 번째인가" 로 판정한다. 기본 격리에서는 서로 다른
       *    후보의 두 트랜잭션이 같은 스냅샷을 읽어 둘 다 통과한다. Serializable 에서
       *    두 번째 트랜잭션은 직렬화 실패(P2034)로 되돌아간다.
       */
      isolationLevel: 'Serializable',
      maxWait: TX_MAX_WAIT_MS,
      timeout: TX_TIMEOUT_MS,
    })
  } catch (err) {
    if (err instanceof Error && err.message === QUEUE_RACE) {
      return { kind: 'error', message: '이미 발행된 후보입니다. 다시 확인해 주세요.' }
    }
    /**
     * 🔴 **직렬화 실패는 실패다. 재시도하지 않는다.**
     *    P2034 는 "다른 트랜잭션이 먼저 자리를 가져갔다" 는 뜻이다. 여기서 재시도하면
     *    상한을 넘기려고 다시 시도하는 셈이 된다 — 막으려던 바로 그 일이다.
     *    이 회차는 그냥 지고, 공개 write 는 남지 않는다. 밀린 것은 다음 run 이 본다.
     */
    if (isSerializationConflict(err)) {
      return { kind: 'error', message: '다른 발행이 먼저 진행됐습니다. 잠시 후 다시 확인해 주세요.' }
    }
    // 🔴 예외 원문을 호출부로 흘리지 않는다
    return { kind: 'error', message: '발행하지 못했습니다.' }
  }
}
