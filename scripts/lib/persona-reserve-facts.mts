/**
 * Persona 4상태 **운영 원자료 어댑터** — 🔴 read-only. DB write 0 · Raw SQL 0 · 네트워크(DB 외) 0
 *
 * 🔴 여기서 판정하지 않는다. 운영 검증기의 **결과**와 이력 **사건**만 모아 넘긴다 —
 *    판정은 `src/lib/persona-reserve.ts` 하나가 한다.
 *
 *    자격 충돌 재료  `verifySeedCard`(DB seed ↔ 정본 카드) · `_count.accounts`/`providerId`(→ `judgeRealMember`)
 *                    · Gate ⑥-B(`checkNameCollision`, 자기 User 는 대조 집합에서 뺀다) · planner `seedComplete`
 *    역할           `PersonaApprovalQueue.reactionType` — 발행된 행(`publishedCommentId`)만
 *    이력           `Post.personaId`(공개 글 순서) · `Comment.personaId`
 *    말투 근거      `bundlesForPersonas` — 운영 생성이 쓰는 그 묶음
 *
 * 🔴 Gate ⑥-B 의 author 해시 salt 가 없으면 **공개 기본값으로 대조하지 않는다** —
 *    표시명 판정을 모른다(`null`)로 둔다. 모르는 것은 통과가 아니다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import type { Prisma, PrismaClient } from '@prisma/client'

import { parsePoolDoc, type PoolCard } from '../../src/lib/persona-pool-card'
import { verifySeedCard } from '../../src/lib/persona-card-verify'
import {
  historyFromEvents, type ActivityHistory, type CommentEvent, type PostEvent, type QualificationEvidence,
} from '../../src/lib/persona-reserve'
import type { PersonaReserveFacts, PersonaReserveRepo, PersonaReserveRow } from './d100-persona-tiers.mjs'
import { readPersonaReserve } from './d100-persona-tiers.mjs'
import { readEnvKeys } from './ops-signals.mjs'
import { checkNameCollision, type NameCollisionSets } from './persona-gate-name-collision.mjs'
import { loadAuthorHashSets } from './persona-name-collision-sets.mjs'
import { bundlesForPersonas } from './persona-reference-store.mjs'
import { PERSONA_POOL_DOC } from './voice-runtime.mjs'

type Reader = PrismaClient | Prisma.TransactionClient

export type ReserveFactsOptions = {
  now: Date
  repoRoot: string
  /**
   * Gate ⑥-B author 해시 salt. 🔴 `null`/빈 값이면 표시명 판정을 `null`(모른다)로 둔다 —
   *    공개 기본값(`soransoran-voice-v1`)으로 대조하면 사전 대입이 가능한 해시와 비교하는 셈이다.
   */
  authorHashSalt: string | null
}

const nonEmpty = (v: unknown): boolean =>
  v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '')

/**
 * 🔴 **DB 행 → 운영 seed 모양.** `persona-cohort-run --step=seed` 가 넣은 칸을 그대로 되돌린다 —
 *    `verifySeedCard` 가 정본 카드와 같은지 본다.
 */
export function seedOfRow(r: {
  identity: unknown; voiceCore: unknown; voiceVariations: unknown; activityRhythm: unknown
  ageBand: string | null; region: string | null; lifeStage: string | null
  noGoTopics: readonly string[]; noGoExpressions: readonly string[]; forbiddenReactionRoles: readonly string[]
  dailyCap: number | null; weeklyCap: number | null; silenceRate: { toString(): string } | number | null
}): Record<string, unknown> {
  return {
    identity: r.identity ?? undefined,
    voiceCore: r.voiceCore ?? undefined,
    voiceVariations: r.voiceVariations ?? undefined,
    activityRhythm: r.activityRhythm ?? undefined,
    ageBand: r.ageBand, region: r.region, lifeStage: r.lifeStage,
    noGoTopics: [...r.noGoTopics], noGoExpressions: [...r.noGoExpressions],
    forbiddenReactionRoles: [...r.forbiddenReactionRoles],
    dailyCap: r.dailyCap, weeklyCap: r.weeklyCap,
    silenceRate: r.silenceRate === null ? null : Number(r.silenceRate.toString()),
  }
}

/** 🔴 planner materializer 와 같은 뜻 (`persona-comment-targets` · `persona-publish-tx`) */
export const seedCompleteOf = (r: { identity: unknown; voiceCore: unknown; lifeStage: string | null }): boolean =>
  r.identity !== null && r.identity !== undefined && r.voiceCore !== null && r.voiceCore !== undefined
  && nonEmpty(r.lifeStage)

export async function readReserveFacts(prisma: Reader, opts: ReserveFactsOptions): Promise<PersonaReserveFacts> {
  const personas = await prisma.persona.findMany({
    select: {
      id: true, code: true, status: true, identity: true, ageBand: true, region: true, lifeStage: true,
      voiceCore: true, voiceVariations: true, activityRhythm: true,
      noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
      dailyCap: true, weeklyCap: true, silenceRate: true,
      user: { select: { id: true, nickname: true, name: true, providerId: true, _count: { select: { accounts: true } } } },
    },
    orderBy: { code: 'asc' },
  })

  // ── 정본 카드 — 못 읽으면 seed 대조는 모른다(null) ──
  let cards: PoolCard[] | null = null
  try {
    const doc = parsePoolDoc(readFileSync(join(opts.repoRoot, PERSONA_POOL_DOC), 'utf-8'))
    cards = doc.problems.length === 0 ? doc.cards : null
  } catch {
    cards = null
  }

  // ── 말투 근거 — 운영 생성이 쓰는 묶음 ──
  const voiceBy = new Map<string, number>()
  try {
    const b = bundlesForPersonas({ repoRoot: opts.repoRoot, personaCodes: personas.map((p) => p.code) })
    for (const t of b.table) voiceBy.set(t.personaCode, t.anchorComments)
  } catch {
    // 🔴 자산을 못 열면 0 이다 — 말투 근거가 **없는** 것이 맞다(운영 어댑터와 같은 규칙)
  }

  // ── Gate ⑥-B — 자기 User 를 뺀 실회원 표시명 · author 해시 ──
  const salt = (opts.authorHashSalt ?? '').trim()
  const users = await prisma.user.findMany({ select: { id: true, nickname: true, name: true } })
  const hashSets = salt === '' ? null : await loadAuthorHashSets(prisma)
  const hashOf = (v: string): string => `sha256:${createHash('sha256').update(`${salt}::${v}`, 'utf8').digest('hex')}`
  const namesExcept = (userId: string): string[] => {
    const out: string[] = []
    for (const u of users) {
      if (u.id === userId) continue
      for (const n of [u.nickname, u.name]) if (n !== null && n.trim() !== '') out.push(n.trim())
    }
    return out
  }

  // ── 이력 — 공개 글 순서 · Persona 댓글 · 발행된 역할 ──
  const posts = await prisma.post.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, personaId: true, createdAt: true },
  })
  const comments = await prisma.comment.findMany({
    where: { personaId: { not: null }, isDeleted: false },
    select: { id: true, postId: true, personaId: true, createdAt: true },
  })
  const roles = await prisma.personaApprovalQueue.findMany({
    where: { publishedCommentId: { not: null } },
    select: { publishedCommentId: true, reactionType: true },
  })
  const roleOf = new Map<string, string>()
  for (const r of roles) if (r.publishedCommentId !== null) roleOf.set(r.publishedCommentId, r.reactionType)
  const history: Map<string, ActivityHistory> = historyFromEvents({
    personaIds: personas.map((p) => p.id),
    posts: posts.map((p): PostEvent => ({ id: p.id, personaId: p.personaId, at: p.createdAt })),
    comments: comments.map((c): CommentEvent => ({ id: c.id, postId: c.postId, personaId: c.personaId!, at: c.createdAt })),
    roleOf,
    now: opts.now,
  })

  const rows: PersonaReserveRow[] = personas.map((p) => {
    const name = ((p.user.nickname ?? p.user.name) ?? '').trim()
    let nameGate: QualificationEvidence['nameGate'] = null
    let nameGateUnknown: string | undefined
    if (hashSets === null) nameGateUnknown = 'VOICE_AUTHOR_HASH_SALT 없음 — 공개 기본값으로 대조하지 않는다'
    else if (name === '') nameGateUnknown = '표시명이 없다'
    else {
      const sets: NameCollisionSets = {
        memberNames: namesExcept(p.user.id), personaNames: [],
        authorHashes: hashSets.authorHashes, authorHashNorms: hashSets.authorHashNorms,
      }
      nameGate = checkNameCollision(name, sets, { hashOf }).status
    }
    const seed = seedOfRow(p)
    const card = cards === null ? null : (cards.find((c) => c.code === p.code) ?? null)
    const qualification: QualificationEvidence = {
      seedProblems: cards === null ? null : verifySeedCard(p.code, seed, card),
      realMember: { accountCount: p.user._count.accounts, providerId: p.user.providerId },
      nameGate, nameGateUnknown,
      seedComplete: seedCompleteOf(p),
    }
    const h = history.get(p.id) ?? null
    return {
      code: p.code, status: String(p.status),
      identity: (p.identity ?? {}) as Record<string, unknown>,
      ageBand: p.ageBand, region: p.region,
      noGoTopics: p.noGoTopics, noGoExpressions: p.noGoExpressions,
      activityToday: h?.activityToday ?? 0,
      daysSinceActive: h?.daysSinceActive ?? null,
      voiceComments: voiceBy.get(p.code) ?? 0,
      qualification,
      history: h,
    }
  })

  const stored = new Set(personas.map((p) => p.code))
  return {
    rows,
    // 🔴 정본 카드가 있고 DB 행이 없는 코드 — 카드를 못 읽었으면 designed 를 모른다(빈 목록 + 행만 판정)
    designedOnly: cards === null ? [] : cards.map((c) => c.code).filter((c) => !stored.has(c)),
  }
}

export function prismaReserveRepo(prisma: Reader, opts: ReserveFactsOptions): PersonaReserveRepo {
  return { reserveFacts: () => readReserveFacts(prisma, opts) }
}

/**
 * 🔴 **계약 유효 Persona 수 — 단계 preflight·D100 계기판이 받는 값은 이것 하나다.**
 *    salt 는 정본 env 에서만 읽는다(없으면 null → 자격 대조 축은 모름 → 계약 유효로 세지 않는다).
 *    읽기 실패는 0 이 아니라 null 이다. 활성 행 수로 대신하지 않는다.
 */
export async function readContractValidPersonas(
  prisma: Reader, opts: { now: Date; repoRoot: string },
): Promise<number | null> {
  try {
    const env = readEnvKeys(['VOICE_AUTHOR_HASH_SALT'])
    const salt = env.ok ? (env.values.VOICE_AUTHOR_HASH_SALT ?? '').trim() : ''
    const r = await readPersonaReserve(prismaReserveRepo(prisma, {
      now: opts.now, repoRoot: opts.repoRoot, authorHashSalt: salt === '' ? null : salt,
    }))
    return r.contractValid
  } catch {
    return null
  }
}
