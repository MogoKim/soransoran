/**
 * scout 목록 점수 — 🔴 **초안이다. 운영값이 아니다** (PR-S2-b-11)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-F
 *
 * 🔴 **post-score-first**: 판단 단위는 게시판도 카페도 아니라 **게시글 1개**다.
 *    우갱 · 레몬테라스 · 82cook 사이에 서열이 없다. 소스는 quota · 가용성 · pacing 의
 *    단위이지 "무엇을 쓸지" 를 정하지 않는다.
 *
 * 🔴 **cheap-signal-first**: 목록에서 판단 가능한 것은 목록에서 끝낸다.
 *    상세 fetch · DB write · LLM 은 전부 비용이다. 점수 높은 후보에만 쓴다.
 *
 * 🔴 **이 파일은 네트워크도 DB 도 만지지 않는다.** 순수 함수뿐이다 —
 *    그래야 fixture 가 브라우저 없이 전부 검증한다.
 */

// ─────────────────────────────────────────────────────────
// 입력 — scout list JSONL 의 행 (읽기 전용)
// ─────────────────────────────────────────────────────────

export type ScoutRow = {
  sourceSite: string
  sourceArticleId: string
  originalTitle: string
  sourceBoardName: string
  sourceCommentCount: number
  sourceCommentCountRead: boolean
  sourceViewCount: number | null
  sourceListedAt: string
  sourcePostedAt: string | null
  sourcePage: number | null
  sourceRankOnPage: number | null
  sourceRunId?: string
  sourceBoardKey?: string | null
  sourceMenuId?: string | null
  sourceExcludeReason?: 'politics' | 'publicFigure' | 'pinned' | null
  qualityFlags?: string[]
}

// ─────────────────────────────────────────────────────────
// ⓪ 판단 단위는 **게시글 1개**다 (🔴 PR-S2-b-11 보정)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **row 가 아니라 article 이 판단 단위다** (§4-F).
 *
 *    앞 코드는 run 별 row 를 그대로 점수·top20 에 넣었다. 같은 글이 여러 run 에
 *    관측되면 **top20 에 중복으로 올라온다** — 실측 611 관측 = 552 고유 글,
 *    중복 49건(2회 39 · 3회 10).
 *
 *    "게시글 1개가 판단 단위" 라고 문서에 고정해 놓고 도구는 row 를 세고 있었다.
 *    비용 절감률도 row 기준이면 과장된다.
 *
 * 🔴 **최신 관측을 대표로 쓴다.** 댓글·조회는 시간이 갈수록 쌓이므로
 *    가장 최근에 본 값이 현재 상태에 가깝다.
 *
 * 🔴 **이력을 버리지 않는다.** "미달 → 다음 실행에서 충족" 을 추적하는 것이
 *    §4-E 의 핵심이라, 몇 번 봤고 얼마나 늘었는지를 함께 남긴다.
 */
export type ArticleObservation = {
  /** 대표 행 — 가장 최근 관측 */
  latest: ScoutRow
  firstRunId: string
  lastRunId: string
  seenCount: number
  /** 첫 관측 대비 댓글 증가분. 1회만 봤으면 0 */
  commentDelta: number
  /** 조회 증가분. 어느 한쪽이라도 못 읽었으면 null */
  viewDelta: number | null
}

export function articleKeyOf(row: ScoutRow): string {
  return `${row.sourceSite}|${row.sourceArticleId}`
}

export function toArticles(rows: readonly ScoutRow[]): ArticleObservation[] {
  const byKey = new Map<string, ScoutRow[]>()
  for (const r of rows) {
    const k = articleKeyOf(r)
    byKey.set(k, [...(byKey.get(k) ?? []), r])
  }
  return [...byKey.values()].map((list) => {
    // 🔴 sourceListedAt 으로 정렬한다. runId 문자열 정렬은 자릿수가 바뀌면 깨진다
    const sorted = [...list].sort((a, b) => Date.parse(a.sourceListedAt) - Date.parse(b.sourceListedAt))
    const first = sorted[0]
    const latest = sorted[sorted.length - 1]
    const viewDelta =
      first.sourceViewCount === null || latest.sourceViewCount === null
        ? null
        : latest.sourceViewCount - first.sourceViewCount
    return {
      latest,
      firstRunId: first.sourceRunId ?? '',
      lastRunId: latest.sourceRunId ?? '',
      seenCount: sorted.length,
      commentDelta: latest.sourceCommentCount - first.sourceCommentCount,
      viewDelta,
    }
  })
}

// ─────────────────────────────────────────────────────────
// ① hard exclude · hold — 🔴 점수를 매기기 **전에** 가른다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **점수로 이길 수 있는 축이 아니다.** 아무리 화제성이 높아도 통과하지 않는다.
 *    그래서 가중치가 아니라 게이트로 둔다 — 가중치로 두면 언젠가 큰 점수가 이긴다.
 */
export type Verdict = 'excluded' | 'hold' | 'candidate'

/** 본문을 봐야 아는 위험 — 목록 단계에서는 **보류**이지 제외가 아니다 */
export const HOLD_FLAGS = ['medicalOrAdLikely', 'publicFigureMention'] as const

export type Gate = {
  verdict: Verdict
  /** 왜 갈렸는가. candidate 면 null */
  reason: string | null
}

export function gateOf(row: ScoutRow): Gate {
  // 🔴 sourceExcludeReason 이 단일 판정이다 (PR-S2-b-8). 여기서 다시 만들지 않는다 —
  //    두 곳에서 판정하면 언젠가 갈라진다.
  if (row.sourceExcludeReason === 'politics') return { verdict: 'excluded', reason: 'politics' }
  if (row.sourceExcludeReason === 'pinned') return { verdict: 'excluded', reason: 'pinned' }
  if (row.sourceExcludeReason === 'publicFigure') return { verdict: 'excluded', reason: 'publicFigure' }

  const flags = row.qualityFlags ?? []
  const hit = HOLD_FLAGS.find((f) => flags.includes(f))
  if (hit) return { verdict: 'hold', reason: hit }

  return { verdict: 'candidate', reason: null }
}

// ─────────────────────────────────────────────────────────
// ② source normalization — 🔴 절대값을 그대로 비교하지 않는다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **같은 댓글 10개가 두 소스에서 같은 의미일 수 없다.**
 *
 *    실측: 쫑알쫑알 시간당 약 98건 · 우갱 약 14건. 활동량이 7배 다르다.
 *    절대 임계값 하나로 자르면 활동량 많은 소스가 후보를 독식하고,
 *    그 순간 다시 source-first 로 되돌아간다(§4-F).
 *
 * 🔴 그룹은 `(runId, boardKey|sourceSite)` 다. run 이 다르면 시간대가 다르고,
 *    게시판이 다르면 활동량이 다르다 — 둘을 섞으면 정규화가 무의미해진다.
 */
export function groupKeyOf(row: ScoutRow): string {
  return `${row.sourceRunId ?? 'norun'}|${row.sourceBoardKey ?? row.sourceSite}`
}

/**
 * 그룹 안에서의 백분위(0~1). 동점은 같은 값을 받는다.
 *
 * 🔴 값이 하나뿐이면 0.5 를 준다 — 1.0 을 주면 표본 1건짜리 소스가 최상위를 먹는다.
 */
export function percentileIn(values: readonly number[], v: number): number {
  if (values.length === 0) return 0
  if (values.length === 1) return 0.5
  const below = values.filter((x) => x < v).length
  const equal = values.filter((x) => x === v).length
  return (below + equal / 2) / values.length
}

// ─────────────────────────────────────────────────────────
// ③ 타겟 핏 · 대화 가능성 — 제목·게시판 어휘
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **"시니어 · 어르신 · 노인 · 실버" 어휘를 쓰지 않는다** (CLAUDE.md 브랜드 규칙).
 *    40대 중반~60대 중반 여성이 **자기 이야기처럼** 느낄 생활 주제를 본다.
 */
export const TARGET_TOPICS: readonly (readonly [string, RegExp])[] = [
  ['몸·갱년기', /갱년기|폐경|호르몬|불면|열감|우울|무릎|관절|허리|건강검진|병원|영양제/],
  ['가족', /남편|아들|딸|며느리|사위|시댁|친정|엄마|아빠|손주|가족|아이들/],
  ['돈·노후', /돈|생활비|용돈|연금|노후|은퇴|보험|적금|재테크|세금|월급/],
  ['일', /직장|일터|알바|취업|사장|동료|퇴직|이직|자격증/],
  ['살림·집', /살림|청소|정리|반찬|김치|요리|집밥|장보기|이사|인테리어|베란다/],
  ['관계·마음', /친구|이웃|지인|서운|속상|외롭|허무|위로|고맙|미안|서럽/],
]

export type TopicHit = { label: string }

export function topicHits(title: string, boardName: string): TopicHit[] {
  const text = `${title} ${boardName}`
  return TARGET_TOPICS.filter(([, re]) => re.test(text)).map(([label]) => ({ label }))
}

/**
 * 대화가 붙을 모양인가.
 *
 * 🔴 조회만 높고 대화가 안 붙는 글은 Raw 로서 가치가 낮다 —
 *    North Star 가 주간 재방문 **참여** 유저 수이기 때문이다.
 */
export const CONVERSATION_SHAPES: readonly (readonly [string, RegExp])[] = [
  ['질문', /\?|나요|까요|을까|나요\?|어떻게|어디|뭐가|추천/],
  ['고민', /고민|힘들|어쩌|모르겠|괜찮을|해야 ?하나|망설/],
  ['공감', /저만|다들|여러분|공감|같은 ?분|계신가/],
  ['경험', /해봤|했어요|후기|해보니|겪었|당했|다녀왔/],
]

export function conversationHits(title: string): TopicHit[] {
  return CONVERSATION_SHAPES.filter(([, re]) => re.test(title)).map(([label]) => ({ label }))
}

// ─────────────────────────────────────────────────────────
// ④ 점수 — 🔴 가중치는 **초안**이다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 이 가중치는 확정값이 아니다. 표본이 하루치 몇 회뿐이라 근거가 얇다 —
 *    dry-run 으로 순위가 납득되는지 보는 용도다.
 */
export const WEIGHTS = { engagement: 45, targetFit: 25, conversation: 20, freshness: 10 } as const

export type ScoreBreakdown = {
  engagement: number
  targetFit: number
  conversation: number
  freshness: number
  total: number
}

export type ScoredRow = {
  row: ScoutRow
  /** 🔴 이 글의 관측 이력. row 가 아니라 article 이 판단 단위다 */
  obs: ArticleObservation
  gate: Gate
  score: ScoreBreakdown
  /** 왜 점수가 높았는가 — 🔴 제목 원문이 아니라 매칭 라벨만 */
  why: string
  /** 🔴 어느 레인에 좋은 글인가. **자동 라우팅이 아니라 사람이 보는 힌트다** */
  laneHint: LaneHint
  /** 지금은 미달이지만 다음 scout 에서 다시 볼 값어치가 있는가 */
  watch: boolean
  lagMinutes: number | null
  commentPct: number
  viewPct: number
}

/** 반응 속도 — 시간당 댓글. 🔴 오래된 글이 절대수만으로 이기지 않게 한다 */
export function velocityOf(comments: number, lagMinutes: number | null): number {
  if (lagMinutes === null || lagMinutes <= 0) return 0
  return comments / (lagMinutes / 60)
}

/** 🔴 너무 오래된 글은 감점. 12시간을 넘으면 신선도 0 */
export function freshnessOf(lagMinutes: number | null): number {
  if (lagMinutes === null) return 0
  if (lagMinutes < 0) return 0 // 🔴 음수 lag 는 이상치다 — 보상하지 않는다
  const h = lagMinutes / 60
  if (h >= 12) return 0
  return 1 - h / 12
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

export type ScoreOptions = {
  /** watch 로 볼 최대 경과 시간(분). 이보다 오래됐으면 반응이 더 붙을 여지가 적다 */
  watchMaxLagMinutes?: number
  /** 상위 몇 %를 후보로 볼 것인가 — 🔴 표시용이지 자동 fetch 기준이 아니다 */
  topRatio?: number
}

/**
 * 그룹 정규화까지 끝난 점수를 매긴다.
 *
 * 🔴 **hard exclude / hold 는 여기서 점수를 받지 않는다.** 0 점을 주는 것이 아니라
 *    애초에 후보 집합에 들어오지 않는다 — 0 점을 주면 언젠가 "0점도 후보" 가 된다.
 */
export function scoreRows(rows: readonly ScoutRow[], opts: ScoreOptions = {}): {
  scored: ScoredRow[]
  excluded: ScoredRow[]
  held: ScoredRow[]
} {
  const watchMax = opts.watchMaxLagMinutes ?? 120

  const lagOf = (r: ScoutRow): number | null =>
    r.sourcePostedAt === null ? null : (Date.parse(r.sourceListedAt) - Date.parse(r.sourcePostedAt)) / 60_000

  // 🔴 **row 를 먼저 article 로 접는다.** 같은 글이 여러 run 에 관측되면
  //    접지 않는 한 top20 에 중복으로 올라온다 (실측 611 관측 = 552 글).
  const articles = toArticles(rows)
  const gated = articles.map((obs) => ({ row: obs.latest, obs, gate: gateOf(obs.latest), lag: lagOf(obs.latest) }))
  const candidates = gated.filter((g) => g.gate.verdict === 'candidate')

  // 🔴 정규화 모집단은 **후보뿐**이다. 제외된 행(공지는 조회수가 7배다)을 넣으면
  //    백분위가 통째로 눌린다 — PR-S2-b-9 에서 겪은 착시와 같은 실수다.
  const byGroup = new Map<string, { comments: number[]; views: number[]; vel: number[] }>()
  for (const g of candidates) {
    const k = groupKeyOf(g.row)
    const b = byGroup.get(k) ?? { comments: [], views: [], vel: [] }
    b.comments.push(g.row.sourceCommentCount)
    b.views.push(g.row.sourceViewCount ?? 0)
    b.vel.push(velocityOf(g.row.sourceCommentCount, g.lag))
    byGroup.set(k, b)
  }

  const build = (g: { row: ScoutRow; obs: ArticleObservation; gate: Gate; lag: number | null }): ScoredRow => {
    const b = byGroup.get(groupKeyOf(g.row)) ?? { comments: [], views: [], vel: [] }
    const cPct = percentileIn(b.comments, g.row.sourceCommentCount)
    const vPct = percentileIn(b.views, g.row.sourceViewCount ?? 0)
    const velPct = percentileIn(b.vel, velocityOf(g.row.sourceCommentCount, g.lag))
    // 댓글/조회 비율 — 조회 대비 대화가 붙었는가
    const ratio = (g.row.sourceViewCount ?? 0) > 0 ? g.row.sourceCommentCount / (g.row.sourceViewCount ?? 1) : 0

    const topics = topicHits(g.row.originalTitle, g.row.sourceBoardName)
    const convs = conversationHits(g.row.originalTitle)

    // 🔴 댓글 수를 못 읽었으면 화제성을 신뢰하지 않는다 — 0 으로 뭉개지 말고 깎는다
    const readPenalty = g.row.sourceCommentCountRead ? 1 : 0.5

    const engagement =
      WEIGHTS.engagement * readPenalty * clamp01(cPct * 0.4 + vPct * 0.2 + velPct * 0.3 + clamp01(ratio * 10) * 0.1)
    const targetFit = WEIGHTS.targetFit * clamp01(topics.length / 2)
    const conversation = WEIGHTS.conversation * clamp01(convs.length / 2)
    const freshness = WEIGHTS.freshness * freshnessOf(g.lag)
    const total = engagement + targetFit + conversation + freshness

    const why = [
      `댓글 p${Math.round(cPct * 100)}`,
      `조회 p${Math.round(vPct * 100)}`,
      `속도 p${Math.round(velPct * 100)}`,
      topics.length ? `핏(${topics.map((t) => t.label).join('/')})` : null,
      convs.length ? `대화(${convs.map((c) => c.label).join('/')})` : null,
      g.row.sourceCommentCountRead ? null : '🔴 댓글수 미확인',
      // 🔴 여러 번 본 글은 증가분을 함께 보여준다 — "미달 → 충족" 추적의 근거 (§4-E)
      g.obs.seenCount > 1
        ? `관측 ${g.obs.seenCount}회 · 댓글 +${g.obs.commentDelta}${g.obs.viewDelta === null ? '' : ` · 조회 +${g.obs.viewDelta}`}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ')

    return {
      row: g.row,
      obs: g.obs,
      gate: g.gate,
      laneHint: laneHintOf(g.row, g.gate),
      score: { engagement, targetFit, conversation, freshness, total },
      why,
      // 🔴 지금 미달이어도 아직 어린 글이면 다음 scout 에서 다시 본다 (§4-E)
      watch: g.lag !== null && g.lag <= watchMax && g.row.sourceCommentCount >= 1,
      lagMinutes: g.lag,
      commentPct: cPct,
      viewPct: vPct,
    }
  }

  return {
    scored: candidates.map(build).sort((a, b) => b.score.total - a.score.total),
    excluded: gated.filter((g) => g.gate.verdict === 'excluded').map(build),
    held: gated.filter((g) => g.gate.verdict === 'hold').map(build),
  }
}

/**
 * 정규화가 순위를 얼마나 바꿨는가 — 🔴 정규화가 실제로 일하고 있는지 본다.
 *
 * 단순 댓글수 내림차순 순위와 점수 순위를 비교한다. 차이가 0 이면
 * 정규화가 아무 일도 하지 않은 것이고, 그건 곧 source-first 와 같다.
 */
export function rankShift(scored: readonly ScoredRow[]): { moved: number; maxShift: number; meanShift: number } {
  const naive = [...scored].sort((a, b) => b.row.sourceCommentCount - a.row.sourceCommentCount)
  const naiveRank = new Map(naive.map((s, i) => [s.row.sourceArticleId, i]))
  const shifts = scored.map((s, i) => Math.abs(i - (naiveRank.get(s.row.sourceArticleId) ?? i)))
  return {
    moved: shifts.filter((n) => n > 0).length,
    maxShift: shifts.length ? Math.max(...shifts) : 0,
    meanShift: shifts.length ? shifts.reduce((a, b) => a + b, 0) / shifts.length : 0,
  }
}

// ─────────────────────────────────────────────────────────
// ⑤ laneHint — 🔴 "좋은 글인가" 가 아니라 "어느 레인에 좋은가" (PR-S2-b-12)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **자동 라우팅이 아니다.** dry-run 에서 사람이 보는 힌트다.
 *    Sheet write · DB write · 자동 fetch · import 를 하지 않는다.
 *
 * 🔴 **짧은 글은 결함이 아니다.** 긴 사연만 쓸모 있는 것이 아니라,
 *    짧은 질문·추천·잡담은 **다른 레인의 재료**다. 그걸 구분하지 못해서
 *    지금까지 "짧으면 shortBody 라 감점" 으로만 다뤄졌다.
 *
 * 🔴 **Raw Vault 는 Original Post 재료 저장소다.** 짧은 질문글을 전부 Vault 에
 *    넣는 것이 목적이 아니다 — 레인이 다르면 저장 경로도 달라야 한다.
 */
export type Lane =
  | 'exclude'
  | 'hold'
  | 'growthIssue'
  | 'infoSeed'
  | 'microSeedQuestion'
  | 'participationSeed'
  | 'originalRaw'

export type LaneHint = {
  lane: Lane
  /** 왜 이 레인인가 — 사람이 읽는 근거 */
  reason: string
  /** 매칭된 신호 라벨 (🔴 제목 원문이 아니다) */
  signals: string[]
}

/** 연예 · 방송 · 셀럽 — 🔴 정치와 **다른 축**이다 (§4-C) */
const ENTERTAINMENT =
  /연예|배우|가수|아이돌|드라마|예능|방송|출연|콘서트|영화|무대|앨범|컴백|열애|결별|가십/

/** 댓글에 **정보가 모이는** 주제 — 제품 · 병원 · 보험 · 가전 · 살림 · 건강관리 */
const INFO_TOPIC =
  /냉장고|세탁기|청소기|에어컨|정수기|가전|제품|브랜드|병원|의원|치과|보험|약국|영양제|건강검진|살림|세제|용품|가격|비용|얼마/

/** 질문 · 추천 요청 모양 */
const ASK_SHAPE =
  /추천|어디가|어디서|뭐 ?쓰|어떤 ?거|어떤 ?게|얼마나|얼마가|괜찮을까|좋을까|나을까|어때요|어떻게 ?해/

/** 참여 유도형 — 가벼운 잡담 · 공감 질문 */
const PARTICIPATION =
  /다들|여러분|저만|계신가|있으신가|어떠세요|어떠신가|같이|함께|수다|잡담|하소연/

/** 생활 고민 — 긴 사연으로 확장 가능한 축 */
const LIFE_WORRY =
  /고민|힘들|속상|서운|답답|억울|허무|외롭|밉|화가|눈물|서럽|어쩌면 ?좋|어떡하죠|어쩌죠/

/** 🔴 제목이 이보다 짧으면 "짧은 글" 로 본다 (초안) */
export const SHORT_TITLE_CHARS = 25

const labelsOf = (title: string, board: string): string[] => {
  const text = `${title} ${board}`
  return [
    ENTERTAINMENT.test(text) ? '연예' : null,
    INFO_TOPIC.test(text) ? '정보' : null,
    ASK_SHAPE.test(title) ? '질문' : null,
    PARTICIPATION.test(title) ? '참여' : null,
    LIFE_WORRY.test(title) ? '고민' : null,
  ].filter((s): s is string => s !== null)
}

/**
 * 레인 힌트를 판정한다.
 *
 * 🔴 **순서가 규칙이다.**
 * ```
 *   ① exclude   정치 · 고정 슬롯 · 실명/공인   → 점수로 이길 수 없다
 *   ② hold      의료 · 광고 위험               → 본문을 봐야 안다
 *   ③ growth    연예 · 방송 · 셀럽             → 🔴 정치와 섞이면 ①이 이긴다
 *   ④ info      정보 주제 + 질문 모양          → 댓글에 정보가 모인다
 *   ⑤ question  질문 · 추천 요청 (짧아도 된다)
 *   ⑥ participation  참여 유도 · 잡담
 *   ⑦ originalRaw    나머지 — 생활 Original 재료
 * ```
 *
 * 🔴 **정치가 growth 보다 먼저다.** 순서를 바꾸면 "정치인 + 방송 출연" 글이
 *    growth 후보로 새어 나간다.
 */
export function laneHintOf(row: ScoutRow, gate: Gate): LaneHint {
  const title = row.originalTitle ?? ''
  const board = row.sourceBoardName ?? ''
  const signals = labelsOf(title, board)
  const short = [...title].length <= SHORT_TITLE_CHARS

  if (gate.verdict === 'excluded') {
    // 🔴 publicFigure 는 생활 Original 에서 빼되 **Growth 여지를 사유에 남긴다** (§4-C).
    //    사유를 안 남기면 Growth 레인이 열릴 때 무엇을 되살릴지 알 수 없다.
    const reason =
      gate.reason === 'publicFigure'
        ? '실명·공인 언급 — 생활 Original 제외. 🔵 연예·셀럽이면 Growth 여지 있음'
        : gate.reason === 'politics'
          ? '정치·진영 — 🔴 public · growth · shadow 어디에도 가지 않는다'
          : '고정 슬롯(공지·필독·추천) — 자동 상세 대상 아님'
    return { lane: 'exclude', reason, signals }
  }
  if (gate.verdict === 'hold') {
    return { lane: 'hold', reason: `${gate.reason} — 본문을 봐야 판단된다`, signals }
  }

  if (signals.includes('연예')) {
    return { lane: 'growthIssue', reason: '연예·방송·셀럽 — 🔵 Growth 후보 (🔴 미구현 레인)', signals }
  }
  if (signals.includes('정보') && signals.includes('질문')) {
    return { lane: 'infoSeed', reason: '정보 주제 + 질문 — 댓글에 정보가 모인다', signals }
  }
  if (signals.includes('질문')) {
    return {
      lane: 'microSeedQuestion',
      reason: short ? '짧은 질문·추천 요청 — 🔴 짧은 것이 결함이 아니다' : '질문·추천 요청',
      signals,
    }
  }
  if (signals.includes('참여')) {
    return { lane: 'participationSeed', reason: '참여 유도·잡담 — 댓글이 붙는 모양', signals }
  }
  return {
    lane: 'originalRaw',
    reason: signals.includes('고민') ? '생활 고민 — 긴 사연으로 확장 가능' : '생활 소재 — Original Post 재료',
    signals,
  }
}

/** 사람이 읽는 짧은 이름 */
export const LANE_LABEL: Record<Lane, string> = {
  exclude: '제외',
  hold: '보류',
  growthIssue: 'Growth',
  infoSeed: 'Info',
  microSeedQuestion: 'Question',
  participationSeed: '참여',
  originalRaw: 'Original',
}
