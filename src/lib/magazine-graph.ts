/**
 * M-GRAPH 관계 해석기 — 하단 「함께 읽어보세요」가 **지정된 관계**를 읽게 한다.
 *
 * 왜 있나
 *   기존 `getRelatedMagazineArticles` 는 같은 cluster 의 최신 3편을 준다.
 *   그래서 한 cluster 안의 모든 글이 **똑같은 3편**을 본다 — 거미줄이 아니라 별이다.
 *   (실측: 갱년기 증상 공개 11편 → 서로 다른 조합 4가지, 8편이 동일)
 *   검색으로 들어온 독자가 다음 글로 넘어갈 이유가 글마다 달라야 한다.
 *
 * 🔴 기존 함수를 고치지 않는다. 폴백으로 **그대로** 쓴다.
 *    그래프가 어떤 이유로든 답을 못 내면 독자는 예전과 똑같은 화면을 본다.
 *
 * ── 🔴 빌드가 막는 것과 런타임이 삼키는 것을 섞지 않는다 ──
 *
 *   빌드가 막는다 (try/catch 로 감싸지 않는다):
 *     · `./graph/current` 또는 그것이 가리키는 버전 파일이 없다  → tsc 모듈 해석 실패
 *     · `./graph/control` 이 없다                                → tsc 모듈 해석 실패
 *     · GRAPH·CONTROL 타입이 맞지 않는다                          → tsc 타입 오류
 *     · EXPORT_HASH 가 재계산 해시와 다르다                       → npm run check:magazine-graph 실패
 *   🔴 이것들을 런타임에서 삼키면 **깨진 그래프가 배포된다.**
 *      빌드가 실패하면 새 배포가 승격되지 않고 기존 운영 배포가 그대로 서빙된다 —
 *      독자에게 보이는 변화가 0 이다. 그게 우리가 원하는 실패 방식이다.
 *
 *   런타임이 삼킨다 (요청 단위 폴백):
 *     · resolver 내부 예외 · 꺼져 있음 · cluster 미포함
 *     · 버전 불일치 · 대상이 미공개·중복·자기 자신 · 결과 0건
 *
 * 🔴 EXPORT_HASH 를 요청마다 다시 계산하지 않는다.
 *    번들에 정적으로 박힌 값이라 배포된 뒤에는 바뀔 수 없다. 대조는 빌드 때 한 번이면 족하고,
 *    요청마다 수백 KB 를 해싱하는 것은 독자를 느리게 만들 뿐 아무것도 지키지 못한다.
 *
 * 🔴 공개 판정을 새로 구현하지 않는다.
 *    `getAllMagazineArticles()` 가 이미 DRAFT·BLOCKED·예약 글을 거른다.
 *    여기서 또 재면 두 개의 진실이 생기고, 언젠가 한쪽만 고쳐져 미공개 글이 링크에 뜬다.
 */
import { CONTROL, enabledClusters, isGraphEnabled } from '@/content/magazine/graph/control'
import { GRAPH } from '@/content/magazine/graph/current'
import type { MagazineRecommendationSlot as GraphSlot } from '@/content/magazine/graph/types'
import type { MagazineArticle } from '@/content/magazine/types'
import { getAllMagazineArticles, getRelatedMagazineArticles } from '@/lib/magazine'

/**
 * 🔴 제품에 **실제로 붙어 있는** 표면의 정본이다.
 *    중앙 계약(contract/validate-graph.mjs)이 이 파일을 읽어서 대조한다 —
 *    사본을 갖지 않는다. 사본은 반드시 어긋나고, 어긋난 쪽이 먼저 읽힌다.
 *
 *    여기 없는 셋은 짐작이 아니라 **부재의 근거**가 있다:
 *      SERIES_NAV          getAdjacentMagazineArticles 에 호출처가 없다
 *      BODY_INLINE_OR_TOP  MagazineBlock 에 link 종류가 없다
 *      BODY_CALLOUT        callout 블록은 text 만 받는다 — 링크를 실을 자리가 없다
 */
export const IMPLEMENTED_SURFACES = [
  'CTA_END',
  'FOOTER_NEXT',
  'FOOTER_SIBLING',
  'FOOTER_BRIDGE',
] as const

/** 하단 「함께 읽어보세요」가 읽는 표면 — CTA_END 는 본문 끝 블록이라 여기 없다 */
export const FOOTER_SURFACES = ['FOOTER_NEXT', 'FOOTER_SIBLING', 'FOOTER_BRIDGE'] as const

export type MagazineRelationSurface = (typeof FOOTER_SURFACES)[number]

/** 관계 7종. 그래프가 주는 값이지만 계측에 실리므로 좁혀 둔다 */
export const MAGAZINE_RELATION_TYPES = [
  'PREREQUISITE',
  'NEXT_QUESTION',
  'SIBLING',
  'SERIES',
  'BRIDGE',
  'ACTION',
  'COMMUNITY',
] as const

export type MagazineRelationType = (typeof MAGAZINE_RELATION_TYPES)[number]

/** 폴백한 이유. 화면에는 쓰지 않고 로그·검사에서만 읽는다 */
export type MagazineGraphFallbackReason =
  | 'DISABLED'
  | 'VERSION_MISMATCH'
  | 'CLUSTER_NOT_ENABLED'
  | 'NO_MAPPING'
  | 'NO_RESULT'
  | 'EXCEPTION'

/**
 * 한 줄의 출처. 🔴 **목록 단위가 아니라 항목 단위다.**
 *
 *   GRAPH          지정 관계가 고른 글
 *   FALLBACK_FILL  그래프가 자리를 다 못 채워 예전 방식으로 **보충**한 글
 *   FALLBACK       그래프가 아예 답을 못 내 목록 전체가 예전 방식인 글
 *
 * 🔴 보충 항목이 graph relation 인 척하면 안 된다. 그러면 계측에서
 *    "지정 관계가 클릭을 만들었다" 는 숫자가 부풀고, 그 숫자로 그래프를 넓히게 된다.
 */
export type RelatedMagazineSource = 'GRAPH' | 'FALLBACK_FILL' | 'FALLBACK'

/**
 * 🔴 슬롯 매핑을 **이 파일에 적지 않는다.** 정본은 연구 저장소의
 *    `contract/graph-contract.ts` 이고, builder 가 거기서 파생한 값을
 *    exporter 가 번들까지 실어 온다. 제품은 `edge.slot` 을 **읽기만** 한다.
 *    (타입만 번들의 `types.ts` 에서 가져온다 — 그것도 생성된 파일이다)
 */
export type { MagazineRecommendationSlot } from '@/content/magazine/graph/types'

/** 화면에 짧게 보여 줄 슬롯 문구 */
export const SLOT_LABEL: Record<GraphSlot, string> = {
  DIRECT_NEXT: '다음 질문',
  SAME_EXPERIENCE: '같은 경험',
  ACTION_OR_CONTEXT: '함께 알아보기',
  BRIDGE_DISCOVERY: '새로운 이야기',
}

/** 직접 연관 슬롯 — 최대 3개 */
export const DIRECT_SLOTS = ['DIRECT_NEXT', 'SAME_EXPERIENCE', 'ACTION_OR_CONTEXT'] as const
/** 발견 슬롯 — 최대 1개 · BRIDGE 관계만 */
export const DISCOVERY_SLOT = 'BRIDGE_DISCOVERY' as const

export const MAX_DIRECT = 3
export const MAX_DISCOVERY = 1
export const MAX_TOTAL = MAX_DIRECT + MAX_DISCOVERY

export type RelatedMagazineItem = {
  article: MagazineArticle
  relationType: MagazineRelationType
  surface: MagazineRelationSurface
  /**
   * 🔴 그래프가 고른 줄만 슬롯을 갖는다. 보충은 `null` 이다 —
   *    보충을 특정 슬롯인 것처럼 표시하면 화면이 거짓말을 한다.
   */
  slot: GraphSlot | null
  /** 🔴 검증된 그래프 문구. 런타임에서 만들지 않는다. 보충은 null */
  reason: string | null
  /** 화면 순서. 계측의 position 과 같은 값이다 (0부터) */
  position: number
  /** 🔴 이 한 줄이 어디서 왔나 */
  source: RelatedMagazineSource
  /** 🔴 **항목마다** 다르다. 그래프가 고른 줄만 실제 버전, 나머지는 'none' */
  graphVersion: string
}

export type ResolvedRelatedMagazine = {
  items: RelatedMagazineItem[]
  /**
   * 목록 전체의 성격.
   *   GRAPH  한 줄이라도 지정 관계가 있다 (보충이 섞여 있을 수 있다)
   *   FALLBACK  전부 예전 방식이다
   * 🔴 계측에는 이 값을 쓰지 않는다 — 클릭은 **눌린 줄의** source·graphVersion 을 쓴다.
   */
  source: 'GRAPH' | 'FALLBACK'
  reason: MagazineGraphFallbackReason | null
  /** 🔴 목록 전체가 폴백일 때만 'none'. **클릭 attribution 에 쓰지 않는다** */
  graphVersion: string
}

const RELATION_TYPES: ReadonlySet<string> = new Set(MAGAZINE_RELATION_TYPES)
const FOOTER: ReadonlySet<string> = new Set(FOOTER_SURFACES)

/**
 * 예전 방식 한 줄로 바꾼다.
 *
 * 🔴 `relationType: 'SIBLING'` 은 "같은 분류의 이웃" 이라는 사실 그대로다.
 *    지정 관계가 아니라는 것은 `source` 가 말한다 — 관계 이름으로 속이지 않는다.
 */
function asFallbackItem(
  article: MagazineArticle,
  source: 'FALLBACK' | 'FALLBACK_FILL',
  position: number,
): RelatedMagazineItem {
  return {
    article,
    relationType: 'SIBLING',
    surface: 'FOOTER_SIBLING',
    // 🔴 슬롯도 이유도 없다. 그래프가 고른 줄이 아니기 때문이다.
    slot: null,
    reason: null,
    position,
    source,
    // 🔴 그래프가 고르지 않은 줄에 버전을 달면 계측이 그래프 성과를 부풀린다.
    graphVersion: 'none',
  }
}

/**
 * 그래프가 아예 답을 못 냈다 — **예전 화면 그대로** 돌려준다.
 *
 * 🔴 개수는 항상 `MAX_DIRECT`(3)다. 발견 자리는 **그래프만 채울 수 있는 자리**이고,
 *    그래프가 없으면 그 자리도 없다. 예전 규칙이 같은 cluster 최신 3편이었으므로
 *    폴백도 정확히 3편이어야 "그래프 OFF = 예전과 동일" 이 참이 된다.
 */
function fallback(
  article: MagazineArticle,
  reason: MagazineGraphFallbackReason,
): ResolvedRelatedMagazine {
  return {
    items: getRelatedMagazineArticles(article, MAX_DIRECT).map((a, i) =>
      asFallbackItem(a, 'FALLBACK', i),
    ),
    source: 'FALLBACK',
    reason,
    graphVersion: 'none',
  }
}

/**
 * 이 글 아래에 무엇을 놓을지 정한다.
 *
 * 🔴 **개수 인자를 받지 않는다.** 개수는 계약이 정하지 호출부가 정하는 값이 아니다.
 *
 * ```
 * 그래프 ON  직접 연관 최대 3 + 발견 최대 1 = 최대 4
 * 그래프 OFF 같은 cluster 최신 최대 3 (예전과 동일)
 * ```
 *
 *    앞판은 `limit` 인자를 받아 놓고 **쓰지 않았다.** 호출부와 시험이 3을 넘기면서
 *    4개를 기대하는 모순이 생겼고, 읽는 사람이 "3을 넘기면 3개가 나오겠구나" 라고
 *    잘못 읽을 수 있었다. 받지 않으면 그 오해가 생길 자리가 없다.
 *
 * @param env 실제 환경변수. 🔴 값을 바꿔도 **재배포해야** 현재 배포에 반영된다.
 *            (Vercel 환경변수는 빌드·런타임에 주입된다. 「즉시」가 아니다)
 */
export function resolveRelatedMagazine(
  article: MagazineArticle,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRelatedMagazine {
  try {
    if (!isGraphEnabled(env)) return fallback(article, 'DISABLED')

    // 버전 파일과 control 이 짝이 맞지 않으면 어느 쪽이 맞는지 알 수 없다. 묻지 않고 물러선다.
    if (GRAPH.graphVersion !== CONTROL.graphVersion) {
      return fallback(article, 'VERSION_MISMATCH')
    }

    // 🔴 cluster 단위로 연다. 한 분류에서 먼저 재보고 넓히기 위해서다.
    if (!enabledClusters(env).includes(article.cluster)) {
      return fallback(article, 'CLUSTER_NOT_ENABLED')
    }

    const fromIntents = new Set(
      GRAPH.mappings.filter((m) => m.slug === article.slug).map((m) => m.intent),
    )
    if (fromIntents.size === 0) return fallback(article, 'NO_MAPPING')

    // 🔴 공개 관문을 거친 글만 후보다. slug → 글 한 번만 만든다.
    const published = new Map(getAllMagazineArticles().map((a) => [a.slug, a]))

    /**
     * 🔴 **직접 연관과 발견을 처음부터 나눠 모은다.**
     *    한 통에 담았다가 나중에 고르면, 우선순위가 높은 직접 연관이 4자리를 다 차지해
     *    발견 카드가 영원히 나오지 않는다. 발견은 "밀려나는 자리" 가 아니라 **전용 자리**다.
     */
    type Cand = { item: RelatedMagazineItem; priority: number }
    const direct: Cand[] = []
    const discovery: Cand[] = []
    const seen = new Set<string>([article.slug]) // 🔴 자기 자신을 먼저 넣어 자기 링크를 원천 차단

    for (const edge of GRAPH.edges) {
      if (!edge.active) continue
      if (!FOOTER.has(edge.placement)) continue
      if (!RELATION_TYPES.has(edge.type)) continue
      if (!fromIntents.has(edge.from)) continue
      // 🔴 슬롯이 없는 edge 는 하단 추천 대상이 아니다 (COMMUNITY 등)
      if (!edge.slot) continue
      // 🔴 발견 슬롯은 BRIDGE 관계만 채울 수 있다. 번들이 어긋나도 여기서 한 번 더 막는다
      if (edge.slot === DISCOVERY_SLOT && edge.type !== 'BRIDGE') continue

      for (const m of GRAPH.mappings) {
        if (m.intent !== edge.to) continue
        if (seen.has(m.slug)) continue // 자기 자신 · 이미 담은 slug

        const target = published.get(m.slug)
        if (!target) continue // 🔴 미공개·존재하지 않는 slug — 관문이 걸렀다

        seen.add(m.slug)
        const cand: Cand = {
          item: {
            article: target,
            relationType: edge.type as MagazineRelationType,
            surface: edge.placement as MagazineRelationSurface,
            slot: edge.slot,
            reason: edge.reason || null,
            position: 0, // 아래에서 최종 순서가 정해진 뒤 다시 매긴다
            source: 'GRAPH',
            graphVersion: GRAPH.graphVersion,
          },
          priority: edge.priority,
        }
        if (edge.slot === DISCOVERY_SLOT) discovery.push(cand)
        else direct.push(cand)
      }
    }

    if (direct.length === 0 && discovery.length === 0) {
      return fallback(article, 'NO_RESULT')
    }

    // 같은 우선순위면 최신 글이 앞이다 — 기존 목록과 같은 태도다.
    const byPriority = (a: Cand, b: Cand) =>
      a.priority - b.priority ||
      b.item.article.publishedAt.localeCompare(a.item.article.publishedAt)
    direct.sort(byPriority)
    discovery.sort(byPriority)

    /**
     * 🔴 **모자란 직접 연관만 채운다.** 그래프를 켰다는 이유로 독자가 보는 연관 글이
     *    줄어들면 안 된다 — 실측(2026-09-23): 채우지 않으면 36편 중 **13편**이 줄었다.
     *
     * 🔴 **얼마나 채우나.** `max(예전 개수, 그래프 직접 연관 수)` 까지다 (상한 3).
     *      · 예전보다 적어지지 않는다 — 그게 보충의 목적이다
     *      · 예전보다 억지로 많아지지도 않는다
     *
     * 🔴 채우는 재료는 **기존 함수의 결과뿐**이다. 세 번째 규칙을 만들지 않는다.
     * 🔴 **발견 자리는 채우지 않는다.** 유효한 BRIDGE 가 없으면 그냥 비운다 —
     *    최신 글이나 인기 글을 넣는 순간 "같은 또래가 궁금해한 것" 이 거짓이 된다.
     */
    const legacy = getRelatedMagazineArticles(article, MAX_DIRECT)
    const directTarget = Math.min(MAX_DIRECT, Math.max(legacy.length, direct.length))

    const items: RelatedMagazineItem[] = direct.slice(0, directTarget).map((c) => c.item)
    const chosen = new Set<string>([article.slug, ...items.map((i) => i.article.slug)])

    for (const a of legacy) {
      if (items.length >= directTarget) break
      if (chosen.has(a.slug)) continue // 자기 자신 · 그래프가 이미 고른 글
      chosen.add(a.slug)
      items.push(asFallbackItem(a, 'FALLBACK_FILL', items.length))
    }

    // 🔴 발견 카드는 마지막 한 자리. 직접 연관과 중복될 수 없다.
    for (const c of discovery) {
      if (items.length >= MAX_TOTAL) break
      if (chosen.has(c.item.article.slug)) continue
      chosen.add(c.item.article.slug)
      items.push(c.item)
      break // 🔴 발견은 최대 1개
    }

    // 화면 순서를 계측 position 과 일치시킨다
    items.forEach((it, n) => {
      it.position = n
    })

    return {
      items,
      source: 'GRAPH',
      reason: null,
      graphVersion: GRAPH.graphVersion,
    }
  } catch {
    // 🔴 예외를 밖으로 던지지 않는다. 연관 글 하나 때문에 상세 페이지가 죽는 쪽이 훨씬 큰 손해다.
    return fallback(article, 'EXCEPTION')
  }
}
