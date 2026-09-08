/**
 * 후보 신선도 — 🔴 **순수 함수. DB·네트워크·시각 조회 0** (2026-09-08)
 *
 * 🔴 왜 필요한가.
 *    재고 목표가 14건일 때는 FIFO 가 문제되지 않았다. 하루 1건씩 14일이면
 *    가장 오래된 것도 2주다. 그런데 **d10 은 재고 140건**이다. FIFO 로 소비하면
 *    맨 뒤 후보는 14일을 기다리고, 그 사이 "요즘 날씨" 글이 계절을 넘긴다.
 *
 * 🔴 그렇다고 최신순으로 뒤집으면 오래된 것이 영원히 안 나간다.
 *    그래서 **주제 성격으로 나눈다** — 현재성 글은 신선도가 먼저,
 *    시간을 타지 않는 글(evergreen)은 품질·생활축·persona 적합도가 먼저다.
 *
 * 🔴 **TTL 이 지난 후보를 지우지 않는다.** 자동 발행 대상에서만 뺀다 —
 *    사람이 보고 판단할 여지를 남긴다. 지우는 것은 되돌릴 수 없다.
 */

/** 🔴 재고 지평 — `scale-profile.HORIZON_DAYS` 와 같은 값이어야 한다 (fixture 가 대조한다) */
const HORIZON_DAYS = 14

/**
 * 🔴 **TTL 근거** — 2026-09-08 실측 (read-only 조사).
 *
 * ```
 * 발행 대기 후보 19건의 age(원문 작성 기준, 일):
 *   0 1 1 1 1 1 1 1 1 1 2 2 2 2 6 6 6 6 6      p50=1 · p75=6 · max=6
 * 이미 발행된 5건의 적재→결정 지연: 전부 0일
 * ```
 *
 * · `hot ≤ 2일`  — 19건 중 14건이 여기 든다. 지금 파이프라인의 정상 대기 시간이다
 * · `timely warm ≤ 7일` — 실측 최대 6일 + 하루 여유. 현재성 글은 일주일이 넘으면
 *   "요즘" 이 어긋난다. 계절·명절·시사는 그보다 더 빨리 상한다
 * · `evergreen warm ≤ 28일` — 재고 지평(14일)의 **2배**. 14일로 잡으면 d10 에서
 *   재고를 한 바퀴 소비하는 순간 맨 뒤가 통째로 만료된다 — 한 사이클 여유를 둔다
 */
export const TTL_DAYS = {
  hot: 2,
  timelyWarm: 7,
  evergreenWarm: HORIZON_DAYS * 2,
} as const

/**
 * 🔴 `unknown` 은 등급이 아니라 **"모른다" 는 사실**이다 (2026-09-08).
 *    원문 시각을 모르는 후보를 `warm` 으로 적으면, 화면은 신선하다고 말하고
 *    러너는 그것을 자동으로 내보낸다 — 몇 년 전 글일 수도 있는데도.
 *    모르는 것은 사람이 본다(fail-closed).
 */
export type Freshness = 'hot' | 'warm' | 'expired' | 'unknown'
export type TopicKind = 'timely' | 'evergreen'

/**
 * 🔴 현재성 신호 — 이 말이 있으면 시간을 탄다.
 *
 *    🔴 **주제를 새로 판정하지 않는다.** 안전성·품질 게이트는 그대로다.
 *       여기서 보는 것은 "언제 읽어도 말이 되는가" 하나뿐이다.
 *    🔴 특정 인물·병명·상품명을 넣지 않는다 — 그런 판정은 안전 게이트의 일이다.
 *
 *    🔴 **여기 있는 것은 두 글자 이상이라 부분 문자열 오탐이 잘 나지 않는다.**
 *       한 글자짜리(`설`·`봄`)는 `TIMELY_SYLLABLES` 로 따로 뺐다 — 아래를 보라.
 */
export const TIMELY_MARKERS: readonly string[] = [
  // 시점 지시
  '오늘', '어제', '내일', '이번 주', '지난주', '다음 주', '이번 달', '요즘', '최근', '올해', '작년',
  '이번', '방금', '아까', '엊그제', '며칠 전',
  // 절기·계절
  '추석', '명절', '김장', '장마', '폭염', '한파', '황사', '미세먼지', '벚꽃', '단풍', '첫눈',
  '여름', '가을', '겨울', '연말', '새해', '개학', '방학', '수능', '입학', '졸업',
  // 생활 주기
  '연말정산', '건강검진', '명절 음식', '제사', '김장철', '이사철',
]

/**
 * 🔴 **한 글자 신호는 부분 문자열로 찾으면 안 된다** (2026-09-08 결함).
 *
 *    `'설'` 을 `includes` 로 찾으면 `설거지` · `소설` · `말설임` · `주말설계` 가 전부
 *    "명절 이야기" 가 된다. 그러면 상시 글이 현재성으로 분류돼 TTL 이 28일에서 7일로
 *    줄고, 멀쩡한 재고가 3주 만에 자동 발행에서 빠진다.
 *
 *    그래서 한 글자 신호는 **경계를 본다**:
 *      · 앞 글자가 한글이면 그 말의 일부다 → 신호가 아니다 (`소설` · `말설임`)
 *      · 뒤 글자가 한글이면, 그것이 **조사·접미**일 때만 신호다 (`설날` · `봄이`)
 *        그 밖이면 다른 말이다 (`설거지` · `봄바람`은 놓친다 — 놓치는 쪽이 안전하다)
 */
export const TIMELY_SYLLABLES: readonly string[] = ['설', '봄']

/**
 * 🔴 한 글자 신호 뒤에 붙어도 그 말이 유지되는 것들 — 조사와 짧은 접미.
 *    이 목록에 없으면 **다른 낱말로 본다**(놓치는 쪽이 안전하다).
 */
const TRAILING_OK: readonly string[] = [
  '이', '가', '은', '는', '을', '를', '에', '의', '도', '만', '과', '와', '로', '요',
  '날', '철', '빔', '엔', '께', '밑', '무', '연',
]

/** 한글 음절인가 */
const isHangul = (ch: string | undefined): boolean => ch !== undefined && /[가-힣]/.test(ch)

/** 🔴 한 글자 신호가 **낱말로** 쓰였는가 */
function hasSyllableMarker(text: string, syl: string): boolean {
  for (let i = text.indexOf(syl); i >= 0; i = text.indexOf(syl, i + 1)) {
    // 앞이 한글이면 그 말의 꼬리다 — `소설` · `말설임`
    if (isHangul(text[i - 1])) continue
    const next = text[i + syl.length]
    // 뒤가 한글이 아니면(공백·문장부호·끝) 그대로 낱말이다 — `설 연휴` · `봄, 이제`
    if (!isHangul(next)) return true
    // 뒤가 한글이면 조사·짧은 접미일 때만 낱말이다 — `설날` · `봄이`
    if (TRAILING_OK.includes(next!)) return true
  }
  return false
}

/** 🔴 제목·본문에서 현재성 신호를 찾는다. 없으면 evergreen 이다 */
export function classifyTopic(title: string, body: string): TopicKind {
  return timelyMarkersIn(title, body).length > 0 ? 'timely' : 'evergreen'
}

/** 어떤 신호가 걸렸는지 — 화면에 근거를 보여 준다 */
export function timelyMarkersIn(title: string, body: string): string[] {
  const text = `${title}\n${body}`
  return [
    ...TIMELY_MARKERS.filter((m) => text.includes(m)),
    ...TIMELY_SYLLABLES.filter((s) => hasSyllableMarker(text, s)),
  ]
}

/**
 * 🔴 신선도 등급.
 *
 *    🔴 **`ageDays` 를 모르면 `unknown` 이다.** 예전 판은 `warm` 으로 적었는데,
 *       그것은 "괜찮다" 는 뜻이라 자동 발행 대상에 그대로 들어갔다.
 *       모르는 것을 괜찮다고 적는 것이 이 파일에서 가장 위험한 낙관이다.
 */
export function freshnessOf(input: { ageDays: number | null; topic: TopicKind }): Freshness {
  const a = input.ageDays
  if (a === null || !Number.isFinite(a) || a < 0) return 'unknown'
  if (a <= TTL_DAYS.hot) return 'hot'
  const warmLimit = input.topic === 'timely' ? TTL_DAYS.timelyWarm : TTL_DAYS.evergreenWarm
  return a <= warmLimit ? 'warm' : 'expired'
}

/**
 * 🔴 자동 발행 대상인가 — **`expired` 와 `unknown` 을 뺀다. 지우지 않는다.**
 *    뺀 것은 사람 검수로 간다(`orderForPublish().heldForReview`).
 */
export function isAutoPublishable(f: Freshness): boolean {
  return f === 'hot' || f === 'warm'
}

export type FreshCandidate = {
  queueId: string
  title: string
  body: string
  /** 원문 작성(또는 수집) 기준 경과일. 모르면 null */
  ageDays: number | null
  /** 🔴 기존 배정이 있는 행 — 복구 대상이다 */
  isRecovery: boolean
  /**
   * 🔴 **실제 배정 점수**다 (`planBatch` 가 고른 persona 의 `score.total`).
   *
   *    상시 후보의 순서는 이 값이 정한다. 러너가 넘기지 않으면 전부 0 이 되어
   *    "적합도 우선" 이라는 계약이 **문서에만 있는 말**이 된다 — 실제로 그랬다.
   *    그래서 생산 경로가 이 값을 넘기는지 fixture 가 본다.
   */
  fitScore?: number
  /** 줄 순서 tie-break — 기존 FIFO 기준값 */
  seq: number
}

/** 🔴 자동 발행에서 뺀 이유 — **할 일이 다르므로 코드를 나눈다** */
export type HoldReason =
  /** TTL 을 넘겼다 — 사람이 보고 버릴지 살릴지 정한다 */
  | 'TTL_EXPIRED'
  /** 원문 시각을 모른다 — 나이를 확인해야 판단할 수 있다 */
  | 'AGE_UNKNOWN'
  /** 🔴 기존 배정이 있는데 그 글이 상했다 — 재배정이 아니라 **사람 판단**이 필요하다 */
  | 'RECOVERY_STALE'

export type FreshVerdict = {
  queueId: string
  topic: TopicKind
  freshness: Freshness
  autoPublishable: boolean
  /** 🔴 자동에서 뺐다면 왜인가. 자동 대상이면 null */
  hold: HoldReason | null
  /** 왜 이 자리인가 */
  reason: string
}

export function judgeCandidate(c: FreshCandidate): FreshVerdict {
  const topic = classifyTopic(c.title, c.body)
  const freshness = freshnessOf({ ageDays: c.ageDays, topic })
  const label = topic === 'timely' ? '현재성' : '상시'
  const age = c.ageDays === null ? '?' : `${c.ageDays}일`

  /**
   * 🔴 **복구도 TTL 을 면제받지 않는다** (2026-09-08 정정).
   *
   *    예전 판은 "이미 그 사람에게 준 글" 이라는 이유로 복구 행을 TTL 밖에 두고
   *    맨 앞에 세웠다. 그러면 **가장 오래 상한 글이 가장 먼저 자동 발행된다** —
   *    배정만 하고 며칠 멈춰 있던 행이 정확히 그런 행이다.
   *    복구는 여전히 우선이지만, 상했으면 자동으로 내보내지 않고 사람에게 보낸다.
   */
  const stale = freshness === 'expired' || freshness === 'unknown'
  if (c.isRecovery && stale) {
    return {
      queueId: c.queueId, topic, freshness, autoPublishable: false, hold: 'RECOVERY_STALE',
      reason: `${label} 복구 행이 상했다 (${age}) — 배정은 그대로 두고 **사람 검수**로 보낸다.`
        + ' 자동 발행하지 않는다. 재배정하지도 삭제하지도 않는다',
    }
  }
  if (freshness === 'unknown') {
    return {
      queueId: c.queueId, topic, freshness, autoPublishable: false, hold: 'AGE_UNKNOWN',
      reason: `${label} 후보의 원문 시각을 모른다 — 자동 발행 보류(hold). 사람이 확인한다.`
        + ' 삭제하지 않는다',
    }
  }
  if (freshness === 'expired') {
    return {
      queueId: c.queueId, topic, freshness, autoPublishable: false, hold: 'TTL_EXPIRED',
      reason: `${label} 후보가 TTL 을 넘겼다 (${age}) — 자동 발행에서만 뺀다. 삭제하지 않는다`,
    }
  }
  return {
    queueId: c.queueId, topic, freshness, autoPublishable: true, hold: null,
    reason: `${label} · ${freshness} (${age})`,
  }
}

/**
 * 🔴 **소비 순서.** 위에서부터 나간다.
 *
 *    ① 기존 배정 복구가 **가장 먼저**다 — 배정만 하고 발행하지 못한 행을 두면
 *       레인이 멈춘 채로 다른 글이 나가고, 화면이 보여준 필자와 실제가 달라진다.
 *       🔴 다만 **상한 복구 행은 자동으로 내보내지 않는다** — 사람 검수로 간다.
 *    ② 현재성 hot → 현재성 warm  (신선도가 먼저)
 *    ③ 상시 후보는 **적합도**가 먼저, 같으면 신선도, 같으면 줄 순서
 *       🔴 적합도는 호출부가 `fitScore` 로 넘긴 **실제 배정 점수**다
 *    ④ expired · unknown 은 목록에서 빠져 `heldForReview` 로 간다 (지우지 않는다)
 *
 *    🔴 결정적이다 — 같은 입력이면 같은 순서다. 시각·난수를 읽지 않는다.
 */
export function orderForPublish(cands: readonly FreshCandidate[]): {
  ordered: FreshCandidate[]
  excluded: { candidate: FreshCandidate; verdict: FreshVerdict }[]
  /** 🔴 사람이 봐야 하는 것 — 사유별로 나눠 둔다. `excluded` 와 같은 집합이다 */
  heldForReview: { candidate: FreshCandidate; verdict: FreshVerdict; hold: HoldReason }[]
  verdicts: Map<string, FreshVerdict>
} {
  const verdicts = new Map<string, FreshVerdict>()
  for (const c of cands) verdicts.set(c.queueId, judgeCandidate(c))

  const excluded: { candidate: FreshCandidate; verdict: FreshVerdict }[] = []
  const heldForReview: { candidate: FreshCandidate; verdict: FreshVerdict; hold: HoldReason }[] = []
  const keep: FreshCandidate[] = []
  for (const c of cands) {
    const v = verdicts.get(c.queueId)!
    // 🔴 복구도 예외가 아니다 — 상했으면 자동에서 빼고 사람에게 보낸다
    if (!v.autoPublishable) {
      excluded.push({ candidate: c, verdict: v })
      heldForReview.push({ candidate: c, verdict: v, hold: v.hold! })
    } else keep.push(c)
  }

  const rank = (c: FreshCandidate): number => {
    if (c.isRecovery) return 0
    const v = verdicts.get(c.queueId)!
    if (v.topic === 'timely') return v.freshness === 'hot' ? 1 : 2
    return 3
  }
  const freshRank = (c: FreshCandidate): number => {
    const v = verdicts.get(c.queueId)!
    return v.freshness === 'hot' ? 0 : v.freshness === 'warm' ? 1 : 2
  }
  // 🔴 여기 남은 것은 전부 hot·warm 이다 (expired·unknown 은 위에서 빠졌다)

  const ordered = [...keep].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    // 🔴 복구끼리는 기존 줄 순서를 지킨다
    if (ra === 0) return a.seq - b.seq
    if (ra <= 2) {
      // 현재성: 신선한 것이 먼저, 같으면 줄 순서
      const fa = a.ageDays ?? Number.MAX_SAFE_INTEGER
      const fb = b.ageDays ?? Number.MAX_SAFE_INTEGER
      if (fa !== fb) return fa - fb
      return a.seq - b.seq
    }
    // 상시: 적합도 → 신선도 → 줄 순서
    const qa = a.fitScore ?? 0
    const qb = b.fitScore ?? 0
    if (qa !== qb) return qb - qa
    const ga = freshRank(a)
    const gb = freshRank(b)
    if (ga !== gb) return ga - gb
    return a.seq - b.seq
  })

  return { ordered, excluded, heldForReview, verdicts }
}

/** 사람이 읽을 요약 */
export function describeFreshness(cands: readonly FreshCandidate[]): string {
  const { ordered, heldForReview, verdicts } = orderForPublish(cands)
  const n = (f: Freshness): number => [...verdicts.values()].filter((v) => v.freshness === f).length
  const h = (r: HoldReason): number => heldForReview.filter((x) => x.hold === r).length
  const t = [...verdicts.values()].filter((v) => v.topic === 'timely').length
  return `후보 ${cands.length}건 — hot ${n('hot')} · warm ${n('warm')} · expired ${n('expired')}`
    + ` · 시각미상 ${n('unknown')}`
    + ` · 현재성 ${t} / 상시 ${cands.length - t}`
    + ` → 자동 대상 ${ordered.length}건`
    + ` · 사람 검수 ${heldForReview.length}건(TTL ${h('TTL_EXPIRED')} · 시각미상 ${h('AGE_UNKNOWN')}`
    + ` · 상한 복구 ${h('RECOVERY_STALE')} — 삭제 아님)`
}
