/**
 * 댓글 **대상 materializer** — 🔴 shadow planner 와 Queue CLI 가 **이것 하나를 쓴다**
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-09).
 *
 *    같은 일을 두 스크립트가 각자 적어 두고 있었다. 대상 선정·입력 구성·
 *    Gate 입력 수집이 `persona-comment-plan.mts` 와 `persona-comment-queue.mts`
 *    양쪽에 있었고, **두 벌이 갈렸다.**
 *
 *      · plan 쪽은 생활사 축 8개를 identity 에서 읽어 넘겼고,
 *        queue 쪽은 `noGoTopics` 하나만 넘겼다 — 같은 planner 를 부르는데
 *        입력이 달라서 **다른 대상**이 나왔다.
 *      · plan 쪽은 회원 표시명·코퍼스를 실제로 읽었고,
 *        queue 쪽은 `knownNames: []`·`seedUseCount: 1` 을 **손으로 적어** 넘겼다.
 *        그래서 Queue 경로의 ②·⑥·⑧ 은 돌지 않은 채로 9관문이 채워졌다.
 *      · plan 쪽은 열린 Queue 를 `targetPostId` 로, queue 쪽은 `dedupKey` 로 봤다.
 *
 *    한 벌로 만들면 이런 어긋남이 생길 자리가 없다. 고칠 곳도 한 곳이다.
 *
 * 🔴 **DB 를 직접 잡지 않는다.** 읽기는 `TargetSource` 로 주입받는다 —
 *    그래야 fixture 가 진짜 함수 합성을 시험할 수 있다(소스 문자열 검사가 아니라).
 *
 * 🔴 **이 파일은 provider 를 부르지 않고 DB 에 쓰지도 않는다.** 판정 재료만 만든다.
 */
import {
  buildCommentInput, voiceEvidenceFromAssets, type CommentInput,
} from '../../src/lib/persona-comment-input'
import {
  planCommentDistribution, type PlannerPersona, type PlannerPost,
} from '../../src/lib/persona-comment-planner'
import { COMMENT_REACTION_ROLES, isAdviceForbidden } from '../../src/lib/persona-reaction-roles'
import { judgeSourceContext } from '../../src/lib/persona-comment-source-context'
import { dedupKeyOf } from '../../src/lib/persona-comment-queue'
import { judgeRealMember } from '../../src/lib/real-member-gate'
import { judgeGateInputs } from '../../src/lib/persona-comment-gate-report'
import type { PostAuthorFacts } from '../../src/lib/persona-comment-release'
import { describeGateInput, toGateInput } from './persona-comment-bridge'
import type { PipelineTarget } from './persona-comment-pipeline'
import type { CandidateInput } from './persona-comment-candidate.mjs'

type BuildPersona = Parameters<typeof buildCommentInput>[0]['persona']

/** 대상 글 실측 — 🔴 3축 가시성은 정본 select 로 읽어 그대로 넘긴다 */
export type SourcePost = {
  id: string
  source: string | null
  title: string
  content: string
  boardType: string
  publishAtMs: number | null
  category: string | null
  /** 🔴 어느 공동체에서 왔는가 — ⑨ 출처 문맥 판정 재료다. 자체 글이면 null */
  sourceSite: string | null
  authorPersonaCode: string | null
  author: { providerId: string | null; isAdmin: boolean | null; accountCount: number | null } | null
  /** 🔴 3축은 정본 select 로 읽어 그대로 넘긴다 — 여기서 축을 비교하지 않는다 */
  visibility: NonNullable<PostAuthorFacts['visibility']>
  comments: readonly { origin: string; content: string }[]
}

export type SourcePersona = BuildPersona & {
  status: string
  user: { providerId: string | null; accountCount: number | null } | null
  /** 🔴 이 persona 의 이전 발화. ⑧ 표본이자 voice 근거다 */
  comments: readonly { content: string; createdAtMs: number }[]
}

/** ② 코퍼스 — 🔴 원문은 담지 않는다. 조회 함수와 규모만 넘긴다 */
export type FrequencyCorpus = {
  lookup: CandidateInput['frequencyLookup']
  size: number
  corpusName: string
}

/**
 * 🔴 **읽기를 주입받는다.** 각 메서드는 "못 읽었다" 를 값으로 돌려준다 —
 *    throw 로 흘리지 않는다. 못 읽은 것을 0·[] 로 보정하지도 않는다.
 */
export type TargetSource = {
  posts: () => Promise<readonly SourcePost[]>
  personas: () => Promise<readonly SourcePersona[]>
  /** 열린 Queue 의 **dedupKey** 목록 — 🔴 `(글·persona·역할)` 계약 그대로다 */
  openDedupKeys: () => Promise<readonly string[]>
  /**
   * 최근 역할 사용량 — 🔴 **못 읽으면 `null`**.
   *
   *    앞선 판은 실패를 `{}` 로 삼켰다. 호출부는 "최근 아무 역할도 안 썼다" 로 읽고
   *    편중 방지가 꺼진 채 대상을 뽑았다 — 그리고 그 대상으로 유료 호출까지 갔다.
   *    조회 실패와 실제 0건은 다른 사실이다.
   */
  recentRoleCounts: () => Promise<Record<string, number> | null>
  /** ⑥-A 회원 표시명 — 🔴 못 읽으면 `undefined`. `[]` 는 "없었다" 라 다른 뜻이다 */
  knownNames: () => Promise<readonly string[] | undefined>
  /** ② 댓글 코퍼스 — 🔴 못 읽으면 `null` */
  frequency: () => Promise<FrequencyCorpus | null>
  /** ⑧ seed 재사용 횟수 — 🔴 못 세면 `null` */
  seedUseCount: (personaCode: string) => Promise<number | null>
}

/**
 * 🔴 **provider 로 나가는 조각과 ① 대조 목록을 같은 곳에서 만든다.**
 *
 *    프롬프트에 실리는 것은 제목 · 본문 요약 · 기존 댓글 요약이다
 *    (`toPromptPost` 참조). ① 유출 대조가 그중 하나라도 못 보면,
 *    모델이 그 조각을 그대로 베껴도 잡히지 않는다.
 *    그래서 목록을 **입력 객체에서 파생**시킨다 — 손으로 적지 않는다.
 */
export function sourceTextsOf(input: CommentInput): string[] {
  return [input.post.title, input.post.bodyDigest, ...input.post.existingCommentDigests]
}

export type GateContext = {
  sourceTexts: readonly string[]
  knownNames: readonly string[] | undefined
  frequency: FrequencyCorpus | null
  priorTexts: readonly string[]
  seedUseCount: number | null
  /** 🔴 반응 역할 정본에서 파생한다 — 고정 false 를 적어 넣지 않는다 */
  adviceForbidden: boolean
  /** 🔴 `null` 은 **판정 불가**다. `false` 로 보정하지 않는다 */
  sourceIsCafeOperational: boolean | null
  /** 판정 근거 한 줄 — 상수와 게시판 이름만 담는다 */
  sourceContextReason: string
}


/** 🔴 후보 텍스트가 생기면 이 함수로 Gate 입력을 만든다 — 호출부가 손으로 채우지 않는다 */
export function gateInputOf(ctx: GateContext, input: CommentInput, text: string): CandidateInput {
  return toGateInput({
    input,
    text,
    sourceTexts: ctx.sourceTexts,
    ...(ctx.knownNames === undefined ? {} : { knownNames: ctx.knownNames }),
    ...(ctx.frequency === null
      ? {}
      : { frequencyLookup: ctx.frequency.lookup, corpusName: ctx.frequency.corpusName }),
    priorTexts: ctx.priorTexts,
    ...(ctx.seedUseCount === null ? {} : { seedUseCount: ctx.seedUseCount }),
    adviceForbidden: ctx.adviceForbidden,
    // 🔴 모르면 넘기지 않는다 — 그래야 ⑨ 가 notRun 으로 남고, 그 사실이 보인다
    ...(ctx.sourceIsCafeOperational === null
      ? {}
      : { sourceIsCafeOperational: ctx.sourceIsCafeOperational }),
  })
}

export type MaterializedTarget = {
  target: PipelineTarget
  gate: GateContext
  /** voice 근거로 쓰는 이 persona 의 실제 발화 */
  recentTexts: readonly string[]
  /**
   * 🔴 **필드를 다 넘겼는가.** 유료 호출을 막는 것은 **이것**이다 —
   *    못 읽은 입력으로 부르면 돈을 쓰고도 잴 수 없다.
   */
  fieldsComplete: boolean
  /**
   * 🔴 **그 입력으로 필수 관문이 실제로 도는가.** 이것은 호출을 막지 않는다 —
   *    ⑧ 은 이전 발화가 쌓이기 전에는 정의상 돌지 않는다(cold-start).
   *    그것까지 막으면 첫 후보를 영원히 만들 수 없다(bootstrap dead-end).
   */
  gateReady: boolean
  gateMissing: readonly string[]
  willNotRun: readonly string[]
}

export type MaterializeResult = {
  plan: ReturnType<typeof planCommentDistribution>
  targets: readonly MaterializedTarget[]
  openDedupKeys: ReadonlySet<string>
  openPostIds: ReadonlySet<string>
  /** 입력 구성에서 막힌 것들 (`buildCommentInput` 차단 코드) */
  blockedInputs: readonly string[]
  /**
   * 🔴 **유료 호출 앞에서 읽는 값.**
   *    Gate 입력을 **못 읽은** 대상이 하나라도 있으면 `false` 다 —
   *    "일부만 부른다" 는 선택지를 두지 않는다. 부르고 나서 못 잰다는 것을
   *    알게 되면 돈은 이미 나갔다.
   *
   * 🔴 표본이 모자라 ⑧ 이 돌지 않는 것은 **여기서 막지 않는다.**
   *    그것은 읽기 실패가 아니라 cold-start 이고, 막으면 첫 후보를 만들 수 없다.
   *    대신 `gateReady: false` 로 남아 사람 승인 경로(bootstrap)로 간다.
   */
  gateInputsComplete: boolean
  gaps: readonly string[]
  /**
   * 🔴 **유료 호출을 막는 사유 전부.** Gate 입력 결손 + 분산 신뢰 실패 +
   *    출처 문맥 판정 불가를 한자리에 모은다 — 부르기 전에 읽는 목록이다.
   */
  providerBlockers: readonly string[]
  /** 🔴 이것이 false 면 provider 를 한 번도 부르지 않는다 */
  providerAllowed: boolean
  /** 🔴 편중 방지 근거 — **못 읽었으면 `null`**. `{}` 로 위장하지 않는다 */
  recentRoleCounts: Readonly<Record<string, number>> | null
  counts: {
    posts: number
    postsWithNoComments: number
    personas: number
    personasActive: number
    personasSeedComplete: number
    planned: number
    built: number
  }
}

/** identity JSON 의 생활사 축 — 🔴 없으면 `undefined`. 0 으로 보정하지 않는다 */
function lifeOf(identity: unknown): PlannerPersona['life'] {
  const id = (identity ?? {}) as Record<string, unknown>
  const num = (v: unknown): number | null | undefined => (typeof v === 'number' ? v : undefined)
  const str = (v: unknown): string | null | undefined => (typeof v === 'string' ? v : undefined)
  const bands = Array.isArray(id.childrenAgeBands)
    ? (id.childrenAgeBands as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined
  return {
    maritalStatus: str(id.maritalStatus),
    childrenCount: num(id.childrenCount),
    childrenAgeBands: bands as PlannerPersona['life']['childrenAgeBands'],
    parentCare: str(id.parentCare),
    menopauseStatus: str(id.menopauseStatus),
    workStatus: str(id.workStatus),
    economicStatus: str(id.economicStatus),
    region: str(id.region),
    noGoTopics: [],
    voiceLength: undefined,
  }
}

/**
 * 🔴 **한 흐름이다.** 실측 읽기 → planner → Persona-first 입력 → Gate 입력.
 *
 *    `limit` 만 호출부가 정한다 — shadow 는 `shadowLimit`, Queue CLI 는 자기 상한.
 *    그 밖의 판정은 전부 이 함수 안에서 같은 규칙으로 돈다.
 */
export async function materializeTargets(args: {
  source: TargetSource
  limit: number
  nowMs: number
  windowMs: number
  /** 본문 요약 길이 — 🔴 원문 전문은 나가지 않는다 */
  digestChars?: number
  commentDigestChars?: number
}): Promise<MaterializeResult> {
  const digestChars = args.digestChars ?? 600
  const commentDigestChars = args.commentDigestChars ?? 60
  const windowStartMs = args.nowMs - args.windowMs

  const [posts, personas, openKeys, recentRoleCounts, knownNames, frequency] = await Promise.all([
    args.source.posts(),
    args.source.personas(),
    args.source.openDedupKeys(),
    args.source.recentRoleCounts(),
    args.source.knownNames(),
    args.source.frequency(),
  ])

  const openDedupKeys = new Set(openKeys)
  /** 🔴 planner 는 "이 글에 열린 것이 있나" 를 묻는다 — 조합 열쇠에서 글 id 를 뽑는다 */
  const openPostIds = new Set(
    [...openDedupKeys].map((k) => k.split(':')[1] ?? '').filter((x) => x !== ''),
  )

  const gaps: string[] = []
  if (knownNames === undefined) gaps.push('knownNames (⑥-A 회원 표시명을 읽지 못했다)')
  if (frequency === null) gaps.push('frequencyLookup (② 댓글 코퍼스를 읽지 못했다)')

  /**
   * 🔴 **조회 실패를 정상 0건으로 읽지 않는다.**
   *    분산을 못 믿는 회차는 대상을 계산해 보여 줄 수는 있어도,
   *    그 대상으로 돈을 쓰지는 않는다.
   */
  const distributionBlockers: string[] = []
  if (recentRoleCounts === null) {
    distributionBlockers.push(
      'recentRoleCounts (최근 역할 사용량을 읽지 못했다 — 편중 방지를 신뢰할 수 없다)',
    )
  }

  const plannerPosts: PlannerPost[] = posts.map((p) => ({
    id: p.id,
    status: p.visibility.status,
    authorPersonaCode: p.authorPersonaCode,
    memberComments: p.comments.filter((c) => c.origin === 'MEMBER' || c.origin === 'GUEST').length,
    personaComments: p.comments.filter((c) => c.origin === 'PERSONA').length,
    hasOpenQueue: openPostIds.has(p.id),
    publishedAtMs: p.publishAtMs,
    // 🔴 가입인사는 대화를 여는 자리가 아니다
    onHold: p.category === '가입인사',
    title: p.title,
    body: p.content,
  }))

  const plannerPersonas: PlannerPersona[] = personas.map((pe) => ({
    code: pe.code,
    status: pe.status,
    // 🔴 판정은 judgeRealMember 하나가 한다. 여기서 비교하지 않는다
    realMember: {
      accountCount: pe.user?.accountCount ?? null,
      providerId: pe.user?.providerId ?? null,
    },
    seedComplete: pe.identity !== null && pe.voiceCore !== null
      && pe.lifeStage !== null && pe.lifeStage.trim() !== '',
    forbiddenReactionRoles: pe.forbiddenReactionRoles,
    recentComments: pe.comments.filter((c) => c.createdAtMs >= windowStartMs).length,
    // 🔴 **생활사 축을 전부 넘긴다.** 한 축만 넘기면 planner 의 다양성 판정이 죽는다
    life: { ...lifeOf(pe.identity), noGoTopics: pe.noGoTopics },
  }))

  const plan = planCommentDistribution({
    posts: plannerPosts,
    personas: plannerPersonas,
    reactionRoles: COMMENT_REACTION_ROLES,
    limit: args.limit,
    nowMs: args.nowMs,
    // 🔴 못 읽었으면 빈 값으로 계획은 세우되, 위에서 이미 유료 호출을 막아 두었다
    recentRoleCounts: recentRoleCounts ?? {},
  })

  const postById = new Map(posts.map((p) => [p.id, p]))
  const personaByCode = new Map(personas.map((p) => [p.code, p]))
  const targets: MaterializedTarget[] = []
  const blockedInputs: string[] = []

  for (const item of plan.items) {
    const pr = postById.get(item.postId)
    const pe = personaByCode.get(item.personaCode)
    if (pr === undefined || pe === undefined) continue

    const recentTexts = pe.comments.map((c) => c.content)
    const built = buildCommentInput({
      persona: {
        code: pe.code, ageBand: pe.ageBand, region: pe.region, lifeStage: pe.lifeStage,
        identity: pe.identity, voiceCore: pe.voiceCore, voiceVariations: pe.voiceVariations,
        noGoTopics: pe.noGoTopics, noGoExpressions: pe.noGoExpressions,
        forbiddenReactionRoles: pe.forbiddenReactionRoles,
      },
      post: {
        id: pr.id,
        title: pr.title,
        // 🔴 원문 앞부분이다. 개인정보 판정을 통과한 글만 provider 로 간다
        bodyDigest: pr.content.slice(0, digestChars),
        boardLabel: pr.boardType,
        existingCommentDigests: pr.comments.map((c) => c.content.slice(0, commentDigestChars)),
      },
      reactionRole: item.reactionRole,
      voice: voiceEvidenceFromAssets({
        voiceCore: pe.voiceCore, voiceVariations: pe.voiceVariations, recentTexts,
      }),
      memory: { has: false, note: '' },
    })
    if (!built.ok) {
      for (const b of built.blocks) blockedInputs.push(b.code)
      continue
    }

    const seedUseCount = await args.source.seedUseCount(pe.code)
    /**
     * 🔴 **출처 문맥을 실제로 판정한다.** 고정 false 를 적어 넣지 않는다 —
     *    그 값은 관측이 아니라 주장이었고, ⑨ 가 올릴 근거를 영영 못 받았다.
     */
    const ctx = judgeSourceContext({
      // 🔴 3축은 통째로 넘긴다 — 여기서 축을 꺼내 비교하지 않는다(헌법 §3 C-2)
      visibility: pr.visibility,
      sourceSite: pr.sourceSite,
      boardType: pr.boardType,
      title: pr.title,
      body: pr.content,
    })
    const gate: GateContext = {
      // 🔴 provider 로 나갈 조각 그대로다
      sourceTexts: sourceTextsOf(built.input),
      knownNames,
      frequency,
      priorTexts: recentTexts,
      seedUseCount,
      // 🔴 반응 역할 정본에서 파생한다 — advice·caution 전면 금지가 지금 정본이다
      adviceForbidden: isAdviceForbidden(pe.forbiddenReactionRoles),
      sourceIsCafeOperational: ctx.operational,
      sourceContextReason: ctx.reason,
    }
    const readiness = judgeGateInputs(
      describeGateInput(gateInputOf(gate, built.input, '(입력 점검 — 생성물 없음)')),
    )

    targets.push({
      target: {
        input: built.input,
        author: {
          authorPersonaCode: pr.authorPersonaCode,
          source: pr.source,
          authorRealMember: pr.author === null ? null : {
            accountCount: pr.author.accountCount, providerId: pr.author.providerId,
          },
          authorIsAdmin: pr.author?.isAdmin ?? null,
          visibility: pr.visibility,
        },
        facts: {
          postId: pr.id,
          personaCode: pe.code,
          reactionRole: item.reactionRole,
          // 🔴 **정확한 조합**으로 본다 — 같은 글이라도 역할이 다르면 다른 자리다
          hasOpenQueue: openDedupKeys.has(dedupKeyOf(pr.id, pe.code, item.reactionRole)),
          personaCommentsOnPost: pr.comments.filter((c) => c.origin === 'PERSONA').length,
          postStatus: pr.visibility.status,
          personaActive: pe.status === 'active',
          personaRealMember: judgeRealMember({
            accountCount: pe.user?.accountCount ?? null,
            providerId: pe.user?.providerId ?? null,
          }).real,
        },
      },
      gate,
      recentTexts,
      fieldsComplete: readiness.fieldsComplete,
      gateReady: readiness.ok,
      gateMissing: readiness.missing,
      willNotRun: readiness.willNotRun,
    })
    if (seedUseCount === null) gaps.push(`seedUseCount (${pe.code} 의 ⑧ seed 재사용 횟수를 세지 못했다)`)
    if (ctx.operational === null) {
      // 🔴 판정 불가는 통과가 아니다 — 부르기 전에 막는다
      distributionBlockers.push(`sourceIsCafeOperational (${pr.id.slice(0, 8)} — ${ctx.reason})`)
    }
  }

  return {
    plan,
    targets,
    openDedupKeys,
    openPostIds,
    blockedInputs,
    // 🔴 하나라도 못 갖췄으면 전체가 미완이다 — 부분 호출을 허용하지 않는다
    gateInputsComplete: gaps.length === 0 && targets.every((t) => t.fieldsComplete),
    gaps,
    providerBlockers: [...gaps, ...distributionBlockers],
    providerAllowed: gaps.length === 0 && distributionBlockers.length === 0
      && targets.every((t) => t.fieldsComplete),
    recentRoleCounts,
    counts: {
      posts: posts.length,
      postsWithNoComments: plannerPosts.filter((p) => p.memberComments + p.personaComments === 0).length,
      personas: personas.length,
      personasActive: plannerPersonas.filter((p) => p.status === 'active').length,
      personasSeedComplete: plannerPersonas.filter((p) => p.seedComplete).length,
      planned: plan.items.length,
      built: targets.length,
    },
  }
}
