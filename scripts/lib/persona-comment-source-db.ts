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
import type { FrequencyCorpus, FrequencyRead, TargetSource } from './persona-comment-targets'
import { loadCanonCorpusTexts } from './persona-reference-store.mjs'

/** 🔴 코퍼스는 회차마다 한 번만 읽는다 — 대상마다 다시 열면 같은 파일을 반복해서 연다 */
let corpusOnce: FrequencyRead | null = null

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
          // 🔴 운영자 직접 글 — 자동 배정 대상에서 뺀다
          operatorWriterId: true,
          author: { select: { providerId: true, isAdmin: true, _count: { select: { accounts: true } } } },
          comments: {
            where: { isDeleted: false },
            // 🔴 `persona.code` 까지 읽는다 — "누가 달았나" 를 모르면
            //    같은 Persona 가 같은 글에 두 번 다는 것을 막을 수 없다
            select: { commentOrigin: true, content: true, persona: { select: { code: true } } },
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
        comments: p.comments.map((c) => ({
          origin: String(c.commentOrigin), content: c.content, personaCode: c.persona?.code ?? null,
        })),
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
      if (args.readCorpus === false) {
        return { corpus: null, reason: '이 회차는 코퍼스를 읽지 않기로 했다(readCorpus=false)' }
      }
      corpusOnce ??= readCanonCorpus()
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
 * ② 댓글 코퍼스 — 🔴 **소란소란 익명 정본 자산에서 읽는다** (2026-09-11).
 *
 * 🔴 **왜 우나어가 아닌가.** 옛 판은 우나어 read-only 의 `CafePost.topComments` 를 읽었다.
 *    남의 서비스 DB 하나가 우리 댓글 레인의 생사를 쥐고 있었고,
 *    2026-09-10 네이버 카페 데이터 폐기 이후 그 표는 근거가 되지 못한다.
 *
 * 🔴 **왜 자기 Comment 표가 아닌가.** 지금 우리 댓글은 한 자릿수다. 얇은 코퍼스에서는
 *    `고생하셨어요` 같은 흔한 말도 빈도 0 이라 `rare` 로 잡혀 전부 regenerate 가 된다.
 *    그렇다고 "쌓일 때까지 기다린다" 는 규제를 두면 초기에는 영영 돌지 않는다 —
 *    **기다릴 필요가 없다.** 이미 정제를 마친 익명 정본이 그 자리에 있다
 *    (`persona-reference/corpus.json`, 작성자 729명 대조 · 잔존 0건).
 *
 * 🔴 **자산 부재·digest 불일치는 사유와 함께 표면화한다.** 새 규제를 만들지 않는다 —
 *    기존 fail-closed(② notRun · 유료 호출 차단) 그대로이고, 다른 것은
 *    "왜 못 읽었는지" 가 로그에 남는다는 점뿐이다.
 *
 * 🔴 원문을 Git·DB 로 복사하지 않는다. 메모리에만 올려 빈도 조회에만 쓴다.
 * 🔴 `speakerId` 는 받지도 않는다 — 빈도 판정에 화자는 들어가지 않는다.
 */
function readCanonCorpus(): FrequencyRead {
  const canon = loadCanonCorpusTexts()
  if (!canon.ok) return { corpus: null, reason: `${canon.code} — ${canon.reason}` }
  // 🔴 공백을 지운 형태로만 들고 있는다. n-gram 조회가 그 형태를 본다
  const bodies = canon.texts.map((t) => t.replace(/\s+/gu, '')).filter((b) => b !== '')
  if (bodies.length === 0) {
    return { corpus: null, reason: 'ASSET_EMPTY — 정본 자산에 쓸 수 있는 본문이 없다' }
  }
  const corpus: FrequencyCorpus = {
    size: bodies.length,
    corpusName: 'comment',
    lookup: (ngram: string): number => {
      let n = 0
      for (const b of bodies) if (b.includes(ngram)) { n += 1; if (n > 6) break }
      return n
    },
  }
  return { corpus, reason: canon.reason }
}
