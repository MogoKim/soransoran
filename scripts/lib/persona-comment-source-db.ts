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
import pg from 'pg'

import { POST_VISIBILITY_SELECT } from '../../src/lib/post-visibility'
import { OPEN_STATUSES } from '../../src/lib/persona-comment-queue'
import type { FrequencyCorpus, TargetSource } from './persona-comment-targets'
import { loadUnaoReadonlyUrl } from './voice-unao-readonly.mjs'

/** 🔴 코퍼스는 회차마다 한 번만 읽는다 — 대상마다 다시 열면 read-only DB 를 두드린다 */
let corpusOnce: Promise<FrequencyCorpus | null> | null = null

export function makeDbTargetSource(args: {
  prisma: PrismaClient
  windowStart: Date
  /** ② 코퍼스를 읽을 것인가 — 🔴 inspect 회차도 읽는다. "돌 수 있는가" 를 알아야 하기 때문이다 */
  readCorpus?: boolean
}): TargetSource {
  const { prisma } = args
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
          author: { select: { providerId: true, isAdmin: true, _count: { select: { accounts: true } } } },
          comments: {
            where: { isDeleted: false },
            select: { commentOrigin: true, content: true },
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
        author: p.author === null ? null : {
          providerId: p.author.providerId,
          isAdmin: p.author.isAdmin,
          accountCount: p.author._count.accounts,
        },
        visibility: {
          status: p.status,
          isMicroSeed: p.isMicroSeed,
          permanentNoindex: p.permanentNoindex,
          indexPromotionBlocked: p.indexPromotionBlocked,
        },
        comments: p.comments.map((c) => ({ origin: String(c.commentOrigin), content: c.content })),
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
          comments: { where: { isDeleted: false }, select: { content: true, createdAt: true } },
        },
      })
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

    frequency: async () => {
      if (args.readCorpus === false) return null
      corpusOnce ??= readCommentCorpus()
      return corpusOnce
    },

    /**
     * ⑧ seed 재사용 횟수 — 🔴 이 persona 의 voice seed 가 몇 번 쓰였나.
     *    발화(Comment)와 적재된 후보(Queue)를 함께 센다. 못 세면 `null` 이다.
     */
    seedUseCount: async (personaCode) => {
      try {
        const persona = await prisma.persona.findUnique({
          where: { code: personaCode }, select: { id: true },
        })
        if (persona === null) return null
        const [comments, queued] = await Promise.all([
          prisma.comment.count({ where: { personaId: persona.id, isDeleted: false } }),
          prisma.personaApprovalQueue.count({ where: { personaId: persona.id } }),
        ])
        // 🔴 아직 한 번도 안 썼으면 이번이 1회째다
        return comments + queued + 1
      } catch { return null }
    },
  }
}

/**
 * ② 댓글 코퍼스 — 🔴 우나어 read-only 에서 읽는다. **원문은 저장하지 않는다.**
 *    본문 코퍼스로 재면 "고생하셨어요" 같은 흔한 말이 고유 표현이 된다.
 */
async function readCommentCorpus(): Promise<FrequencyCorpus | null> {
  const url = ((): string | null => { try { return loadUnaoReadonlyUrl() } catch { return null } })()
  if (url === null) return null
  try {
    const unao = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await unao.connect()
    const { rows } = await unao.query<{ topComments: unknown }>(
      'SELECT "topComments" FROM "CafePost" WHERE "topComments" IS NOT NULL LIMIT 3000',
    )
    await unao.end()
    const bodies: string[] = []
    for (const r of rows) {
      let arr: unknown = r.topComments
      if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { continue } }
      if (!Array.isArray(arr)) continue
      for (const item of arr) {
        if (item === null || typeof item !== 'object') continue
        const body = (item as Record<string, unknown>).content
        if (typeof body === 'string' && body.trim() !== '') bodies.push(body.replace(/\s+/gu, ''))
      }
    }
    return {
      size: bodies.length,
      corpusName: 'comment',
      lookup: (ngram: string): number => {
        let n = 0
        for (const b of bodies) if (b.includes(ngram)) { n += 1; if (n > 6) break }
        return n
      },
    }
  } catch { return null }
}
