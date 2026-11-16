/**
 * Persona 목소리 칸의 조회 — 고를 수 있는 Persona · 댓글을 달 글 (읽기 전용 · 운영 콘솔 전용)
 *
 * 🔴 판정은 src/lib/operator-persona-voice.ts 하나가 한다. 여기서 규칙을 다시 적지 않는다 —
 *    같은 판정 함수를 화면용으로 미리 돌려 "왜 안 되는지" 를 함께 싣는다. 저장 때는 트랜잭션이 다시 판정한다.
 * 🔴 막힌 Persona · 막힌 글도 빼지 않고 이유와 함께 싣는다 — 조용히 빠지면 왜 안 보이는지 모른다.
 * 🔴 고객 화면에서 import 하지 않는다.
 */
import type { BoardType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { boardLabel, communityPostHref, formatKst } from '@/lib/admin-format'
import { displayName } from '@/lib/display-name'
import {
  judgePersonaVoiceSpeaker,
  judgePersonaVoiceTarget,
  personaCardOf,
  type PersonaCard,
  type PersonaVoiceTargetKind,
} from '@/lib/operator-persona-voice'
import { OPERATOR_BOARDS } from '@/lib/operator-writer'
import { POST_VISIBILITY_SELECT, pickPostVisibility } from '@/lib/post-visibility'

export type PersonaVoiceSpeakerOption = {
  id: string
  code: string
  name: string
  card: PersonaCard
  /** 지금 쓸 수 있는가 — 안 되면 이유 */
  blockedReason: string | null
}

/** 활동 중 Persona 전원 — 처리 대기 신고가 있으면 이유와 함께 막힌 채로 싣는다 */
export async function getPersonaVoiceSpeakers(): Promise<PersonaVoiceSpeakerOption[]> {
  const personas = await prisma.persona.findMany({
    where: { status: 'active' },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      status: true,
      userId: true,
      ageBand: true,
      region: true,
      lifeStage: true,
      identity: true,
      voiceCore: true,
      noGoTopics: true,
      noGoExpressions: true,
      user: { select: { nickname: true, name: true } },
    },
  })
  const userIds = personas.map((p) => p.userId)
  // 🔴 그 계정이 쓴 댓글·글의 처리 대기 신고 — 트랜잭션과 같은 조건(댓글 OR 글)
  const reports = userIds.length === 0
    ? []
    : await prisma.report.findMany({
        where: {
          status: 'PENDING',
          OR: [{ comment: { authorId: { in: userIds } } }, { post: { authorId: { in: userIds } } }],
        },
        select: { comment: { select: { authorId: true } }, post: { select: { authorId: true } } },
      })
  const pendingOf = new Map<string, number>()
  for (const r of reports) {
    for (const uid of new Set([r.comment?.authorId, r.post?.authorId])) {
      if (uid) pendingOf.set(uid, (pendingOf.get(uid) ?? 0) + 1)
    }
  }
  return personas.map((p) => {
    const v = judgePersonaVoiceSpeaker({ code: p.code, status: p.status, pendingReports: pendingOf.get(p.userId) ?? 0 })
    return {
      id: p.id,
      code: p.code,
      name: displayName(p.user),
      card: personaCardOf(p),
      blockedReason: v.ok ? null : v.reason,
    }
  })
}

export type PersonaVoiceTargetOption = {
  id: string
  title: string
  boardType: BoardType
  boardLabel: string
  authorName: string
  /** 회원 글 · 운영자 이름 글 · Persona 글 — 막혔으면 null */
  kind: PersonaVoiceTargetKind | null
  blockedReason: string | null
  /** Persona 자동 글이 아직 25시간 전이면 열리는 시각(KST 문구 — 화면이 시간대를 계산하지 않게 서버에서 만든다) */
  opensAtLabel: string | null
  href: string | null
}

const TARGET_LIMIT = 40

/**
 * 댓글을 달 글 — 최근 공개 커뮤니티 글 40편(+ 미리 고른 한 편).
 * 🔴 글마다 판정을 미리 돌려 막힌 이유를 싣는다(실회원 글 · 운영자 이름 글 · 25시간 지난 Persona 글만 열린다).
 */
export async function getPersonaVoiceTargets({ now, includePostId }: { now: Date; includePostId?: string }): Promise<PersonaVoiceTargetOption[]> {
  const select = {
    id: true,
    title: true,
    boardType: true,
    personaId: true,
    operatorWriterId: true,
    publishAt: true,
    createdAt: true,
    ...POST_VISIBILITY_SELECT,
    author: { select: { nickname: true, name: true, providerId: true, _count: { select: { accounts: true } } } },
  } as const
  const recent = await prisma.post.findMany({
    where: { status: 'PUBLISHED', boardType: { in: [...OPERATOR_BOARDS] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: TARGET_LIMIT,
    select,
  })
  const extra = includePostId && !recent.some((p) => p.id === includePostId)
    ? await prisma.post.findFirst({ where: { id: includePostId, status: 'PUBLISHED', boardType: { in: [...OPERATOR_BOARDS] } }, select })
    : null
  const rows = extra ? [extra, ...recent] : recent

  return rows.map((p) => {
    const v = judgePersonaVoiceTarget(
      {
        ...pickPostVisibility(p),
        boardType: p.boardType,
        personaId: p.personaId,
        operatorWriterId: p.operatorWriterId,
        publishedAt: p.publishAt ?? p.createdAt,
        authorAccountCount: p.author._count.accounts,
        authorProviderId: p.author.providerId,
      },
      now.getTime(),
    )
    return {
      id: p.id,
      title: p.title,
      boardType: p.boardType,
      boardLabel: boardLabel(p.boardType),
      authorName: displayName(p.author),
      kind: v.ok ? v.kind : null,
      blockedReason: v.ok ? null : v.reason,
      opensAtLabel: !v.ok && v.opensAtMs !== undefined ? formatKst(new Date(v.opensAtMs)) : null,
      href: communityPostHref(p.id, p.boardType),
    }
  })
}
