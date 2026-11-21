/**
 * `TargetSource` 의 **실제 DB 구현** — 🔴 read-only. write 0
 *
 * 🔴 **왜 나눠 두는가.**
 *    판정(`materializeTargets`)은 순수하게 두고, DB·외부 코퍼스 접근만 여기에 모은다.
 *    fixture 는 이 파일을 쓰지 않고 가짜 source 를 넣어 **행동으로** 시험한다.
 *
 * 🔴 못 읽은 것은 `undefined`·`null` 로 돌려준다. 0·`[]` 로 보정하지 않는다 —
 *    "조회했는데 없었다" 와 "조회하지 못했다" 는 다른 사실이고,
 *    뒤엣것은 유료 호출을 막아야 하는 사실이다.
 */
import type { PrismaClient } from '@prisma/client'

import { pickPostVisibility, POST_VISIBILITY_SELECT } from '../../src/lib/post-visibility'
import { OPEN_STATUSES } from '../../src/lib/persona-comment-queue'
import { RECENT_WINDOW_DAYS, roleHistoryOf } from '../../src/lib/persona-reserve'
import type { TargetSource } from './persona-comment-targets'
import { referenceSeedShareCount, stableAssignment } from './persona-reference-store.mjs'
import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'
import { countCapUsage, type PersonaCapState } from '../../src/lib/persona-cap-usage'

export function makeDbTargetSource(args: {
  prisma: PrismaClient
  windowStart: Date
  /** 🔴 역할 이력 창의 기준 시각 — 생략하면 지금. 창 길이는 계약과 같은 `RECENT_WINDOW_DAYS` 다 */
  now?: Date
  /**
   * ⑧ seed 재사용을 셀 고정 배정 — 🔴 시험용 주입. 운영은 생성 경로와 **같은** `stableAssignment` 를 읽는다
   *    (묶음을 다시 나누지 않는다 — 나누면 생성과 판정이 다른 묶음을 본다).
   */
  referenceByCode?: () => ReadonlyMap<string, VoiceReferenceBundle>
}): TargetSource {
  const { prisma } = args
  let assignment: ReadonlyMap<string, VoiceReferenceBundle> | null = null
  const referenceByCode = args.referenceByCode
    ?? (() => (assignment ??= stableAssignment({ repoRoot: process.cwd() }).byCode))
  return {
    posts: async () => {
      const rows = await prisma.post.findMany({
        where: { status: 'PUBLISHED' },
        select: {
          id: true, source: true, title: true, content: true, boardType: true,
          publishAt: true, createdAt: true, category: true,
          // 🔴 ⑨ 출처 문맥 판정 재료 — 어느 공동체에서 온 글인가
          sourceSite: true,
          // 🔴 3축은 정본 select 를 쓴다 — 손으로 고르면 판정 입력이 갈라진다
          ...POST_VISIBILITY_SELECT,
          persona: { select: { code: true } },
          // 🔴 운영자 직접 글 — 자동 배정 대상에서 뺀다
          operatorWriterId: true,
          author: { select: { providerId: true, isAdmin: true, _count: { select: { accounts: true } } } },
          comments: {
            // 🔴 `persona.code` 까지 읽는다 — "누가 달았나" 를 모르면
            //    같은 Persona 가 같은 글에 두 번 다는 것을 막을 수 없다
            select: { isDeleted: true, commentOrigin: true, content: true, persona: { select: { code: true } } },
          },
        },
      })
      return rows.map((p) => ({
        id: p.id,
        source: p.source,
        title: p.title,
        content: p.content,
        boardType: String(p.boardType),
        publishAtMs: (p.publishAt ?? p.createdAt)?.getTime() ?? null,
        category: p.category,
        sourceSite: p.sourceSite,
        authorPersonaCode: p.persona?.code ?? null,
        authorOperatorWriterId: p.operatorWriterId,
        author: p.author === null ? null : {
          providerId: p.author.providerId,
          isAdmin: p.author.isAdmin,
          accountCount: p.author._count.accounts,
        },
        // 🔴 축 이름은 정본만 안다 — 같은 추출 함수를 쓴다(C-2)
        visibility: pickPostVisibility(p),
        // 공개 맥락과 구조 상한은 살아 있는 댓글만 본다.
        comments: p.comments.filter((c) => !c.isDeleted).map((c) => ({
          origin: String(c.commentOrigin), content: c.content, personaCode: c.persona?.code ?? null,
        })),
        // 삭제해도 같은 Persona가 다시 말할 자격은 복원되지 않는다.
        personaCodesEverOnPost: p.comments
          .filter((c) => c.commentOrigin === 'PERSONA' && c.persona?.code !== undefined)
          .map((c) => c.persona!.code),
      }))
    },

    personas: async () => {
      const rows = await prisma.persona.findMany({
        select: {
          code: true, status: true, identity: true, voiceCore: true, voiceVariations: true,
          ageBand: true, region: true, lifeStage: true, noGoTopics: true, noGoExpressions: true,
          forbiddenReactionRoles: true,
          // 🔴 실회원 판별 정본에 **두 값 다** 필요하다. 하나라도 빠지면 unknown 으로 막힌다
          user: { select: { providerId: true, _count: { select: { accounts: true } } } },
          comments: { where: { isDeleted: false }, select: { id: true, content: true, createdAt: true } },
        },
      })
      /**
       * 🔴 **역할 이력 — 계약과 같은 원천 · 같은 함수**(`roleHistoryOf`). 발행된 Queue 행의 `reactionType` 이 역할이다.
       *    못 읽으면 전원 `null` — planner 가 이번 회차에서 뺀다(fail-closed). `{}` 로 삼키지 않는다.
       */
      const now = args.now ?? new Date()
      const since = now.getTime() - RECENT_WINDOW_DAYS * 86_400_000
      let roleOf: Map<string, string> | null = null
      try {
        const ids = rows.flatMap((p) => p.comments.filter((c) => c.createdAt.getTime() >= since).map((c) => c.id))
        const q = ids.length === 0 ? [] : await prisma.personaApprovalQueue.findMany({
          where: { publishedCommentId: { in: ids } }, select: { publishedCommentId: true, reactionType: true },
        })
        roleOf = new Map(q.flatMap((r) => (r.publishedCommentId === null ? [] : [[r.publishedCommentId, r.reactionType] as const])))
      } catch { roleOf = null }
      return rows.map((p) => ({
        code: p.code,
        status: String(p.status),
        identity: p.identity,
        voiceCore: p.voiceCore,
        voiceVariations: p.voiceVariations,
        ageBand: p.ageBand,
        region: p.region,
        lifeStage: p.lifeStage,
        noGoTopics: p.noGoTopics,
        noGoExpressions: p.noGoExpressions,
        forbiddenReactionRoles: p.forbiddenReactionRoles,
        user: p.user === null ? null : {
          providerId: p.user.providerId, accountCount: p.user._count.accounts,
        },
        comments: p.comments.map((c) => ({ content: c.content, createdAtMs: c.createdAt.getTime() })),
        recentRoles: roleOf === null ? null
          : roleHistoryOf({ comments: p.comments.map((c) => ({ id: c.id, at: c.createdAt })), roleOf, now }),
      }))
    },

    openDedupKeys: async () => (await prisma.personaApprovalQueue.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      select: { dedupKey: true },
    })).map((q) => q.dedupKey),

    /**
     * 🔴 **못 읽으면 `null` 이다.** 앞선 판은 실패를 `{}` 로 삼켰다 —
     *    호출부는 "최근 아무 역할도 안 썼다" 로 읽었고, 편중 방지가 꺼진 채로
     *    유료 호출까지 갔다. 실제 0건과 조회 실패는 다른 사실이다.
     */
    recentRoleCounts: async () => {
      try {
        const counts: Record<string, number> = {}
        for (const q of await prisma.personaApprovalQueue.findMany({
          where: { createdAt: { gte: args.windowStart } }, select: { reactionType: true },
        })) counts[q.reactionType] = (counts[q.reactionType] ?? 0) + 1
        return counts
      } catch { return null }
    },

    // 🔴 값은 찍지 않는다. 수만 센다
    knownNames: async () => {
      try {
        const users = await prisma.user.findMany({ select: { nickname: true, name: true } })
        return users.flatMap((u) => [u.nickname, u.name])
          .filter((v): v is string => v !== null && v.trim() !== '')
      } catch { return undefined }
    },

    /**
     * ⑧ seed 재사용 횟수 — 🔴 이 persona 의 voice seed 가 몇 번 쓰였나.
     *    발화(Comment)와 적재된 후보(Queue)를 함께 센다. 못 세면 `null` 이다.
     */
    seedUseCount: async (personaCode) => {
      // 🔴 ⑧ seed 재사용 = 같은 seed 를 받은 Persona 수(전체 단위 · 계약 §3-⑧). 이력 수가 아니다
      try { return referenceSeedShareCount(referenceByCode(), personaCode) } catch { return null }
    },

    /**
     * 🔴 **카드 상한 사실** — 발행 트랜잭션과 같은 셈법(`countCapUsage`)에 열린 대기를 더한다. 못 읽으면 `null`.
     *    시각은 `now`(생략하면 부르는 순간)다 — 발행 트랜잭션도 자기 순간의 KST 오늘 · 7일로 센다.
     */
    capStates: async () => {
      try {
        const rows = await prisma.persona.findMany({ select: { id: true, code: true, dailyCap: true, weeklyCap: true } })
        const used = await countCapUsage(prisma, rows.map((r) => r.id), args.now ?? new Date(), { withOpenQueue: true })
        return new Map<string, PersonaCapState>(rows.map((r) => [r.code, {
          limits: { dailyCap: r.dailyCap, weeklyCap: r.weeklyCap }, used: used.get(r.id)!,
        }]))
      } catch { return null }
    },
  }
}
