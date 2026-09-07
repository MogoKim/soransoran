/**
 * 후보 생성 파이프라인 판정 — 🔴 **순수 판정만. DB 도 파일도 네트워크도 없다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AO
 *
 * 🔴 **이 파일이 답하는 질문은 하나다: "지금 어디가 막혀 있나."**
 *
 * 후보가 큐에 닿기까지 다섯 층을 지난다. 각 층은 스크립트가 따로 있고,
 * 하나씩 돌려 보기 전에는 **어디서 멈췄는지 알 수가 없었다.**
 *
 * ```
 * ⓪   목록 → 본문      밖으로 요청  → 본문 없는 목록 몇 건?
 * ①   SEED 승인 → 초안  기계        → 미초안화 몇 건?
 * ②   초안 → 판정       사람        → 미판정 몇 건?
 * ③   ADOPT → 후보 파일 기계        → 미후보화 몇 건?
 * ④   후보 파일 → 큐    기계        → 미적재 몇 건?
 * ```
 *
 * 🔴 **세 종류의 층이 번갈아 온다.** 기계 · 사람 · 밖으로 나가는 것.
 *
 * **장기 목표는 전 구간 자동화다.** 다만 v1 은 그 셋을 **명시적으로 갈라 둔다** —
 * 무엇이 아직 자동이 아닌지 눈에 보여야 순서대로 열 수 있기 때문이다.
 *
 * | 층 | v1 | 자동화의 조건 |
 * |---|---|---|
 * | `machine` | 🟢 자동 | — |
 * | `network` | 🔴 승인 | **pacing · 관제 · 실패 처리**가 먼저다. 남의 서버에 보내는 요청이라 |
 * |          |          | 코드가 안전해도 상대가 막으면 끝난다 |
 * | `human`  | 🔴 보호 | **별도 gate · 판정 모델 · 검수 기준**이 서면 자동화 후보가 된다. |
 * |          |          | 지금 없는 것은 "무엇을 좋은 글로 볼 것인가" 의 기준이다 |
 *
 * 🔴 **"아직 아니다" 와 "영원히 아니다" 는 다르다.** 사람 층을 지금 여는 것은
 *    기준 없이 여는 것이라 막지만, 기준이 서면 그때 다시 판단한다.
 *    이 파일이 `actor` 를 값으로 들고 있는 이유가 그것이다 — 층을 옮기는 것이 한 줄이어야 한다.
 *
 * 🔴 **⓪층을 넣은 이유 (2026-09-07).** 이 도구가 처음엔 ①부터 셌다.
 *    그래서 "전 구간 일감 0 — 새 원천이 필요하다" 고 말했는데, **절반만 맞는 말**이었다.
 *    목록에는 1,054건이 있었고 그중 388건은 네이버에 붙지 않고도 본문을 읽을 수 있었다.
 *    보이지 않는 층은 없는 층이 된다.
 *
 * 🔴 **"본문 → 판정 후보" 를 층으로 세지 않는 이유.** 그 판정은 검수 화면 셋이
 *    (SRN · 소스 · Raw) 각자 다른 조건으로 한다. 여기서 그 조건을 흉내내면
 *    **판단이 두 곳이 되고**, 화면은 7건이라는데 이 도구는 38건이라 하게 된다
 *    (실제로 그렇게 나왔다). 화면이 정본이므로 여기서는 참고 수치로만 보여준다.
 */

/** 층 이름 — 순서가 곧 흐름이다 */
export const LAYERS = ['body', 'seedApproval', 'draft', 'adopt', 'candidate'] as const
export type Layer = (typeof LAYERS)[number]

export const LAYER_LABEL: Record<Layer, string> = {
  body: '⓪ 목록 → 본문',
  seedApproval: '① SEED 승인 → 초안',
  draft: '② 초안 → 판정',
  adopt: '③ ADOPT → 후보 파일',
  candidate: '④ 후보 파일 → 큐',
}

/**
 * 누가 이 층을 넘기나 — 🔴 **`network` 는 기계지만 밖으로 나간다.**
 *
 * 남의 서버에 요청을 보내는 층이라 `machine` 과 같이 두면 안 된다.
 * 자동으로 돌리는 순간 pacing·robots·차단 위험이 생긴다.
 *
 * 🔴 **이것도 최종 상태가 아니다.** pacing 규칙 · 실패 시 감속 · 일일 상한 · 관제가 붙으면
 *    `machine` 으로 옮길 수 있다. 지금 막는 것은 **그것들이 아직 없기 때문**이지
 *    자동화가 목표가 아니어서가 아니다.
 */
export const LAYER_ACTOR: Record<Layer, 'machine' | 'human' | 'network'> = {
  body: 'network',
  seedApproval: 'machine',
  draft: 'human',
  adopt: 'machine',
  candidate: 'machine',
}

/** 각 층에서 다음으로 넘어가려면 무엇을 하나 */
export const LAYER_ACTION: Record<Layer, string> = {
  body: '🔴 승인 필요: 상세 fetch — 82cook 은 fetch 만, 네이버는 브라우저·세션이 든다',
  seedApproval: 'npm run micro-seed:seed-originality-dry-run',
  draft: '🔴 사람: seed-originality-review.html 에서 ADOPT / REVISE 판정',
  adopt: 'npm run micro-seed:publish-candidates',
  candidate: 'npx tsx scripts/micro-seed-supply-autofill.mts --apply --limit=N',
}

/**
 * 목록 재고 — 🔴 **본문이 없으면 판정할 수 없다.**
 *
 * 2026-09-07 에 파이프라인이 "전 구간 일감 0 — 새 원천이 필요하다" 고 말했다.
 * 맞는 말이었지만 **절반만** 맞았다. 목록에는 1,054건이 있었고,
 * 그중 82cook 388건은 **네이버에 붙지 않고도** 본문을 읽을 수 있는 것이었다.
 * "원천이 없다" 와 "원천은 있는데 본문을 안 읽었다" 는 완전히 다른 문제다.
 */
export type ListStock = {
  /** 목록에 있으나 본문을 안 읽은 것 */
  pending: number
  /** 그중 브라우저·세션 없이 읽을 수 있는 것 (82cook) */
  fetchOnly: number
  /** 브라우저·세션이 필요한 것 (네이버 카페) */
  needsBrowser: number
}

/**
 * 🔴 **읽기 비용으로 가른다.** 건수가 아니라 "무엇이 필요한가" 가 판단을 바꾼다.
 *
 * `fetchOnly` 가 남아 있으면 네이버 승인을 기다릴 필요가 없다.
 * 이걸 뭉뚱그리면 "수집 승인" 하나를 기다리며 쓸 수 있는 재고를 놀린다.
 */
export function readListStock(rows: readonly { sourceSite?: string }[]): ListStock {
  let fetchOnly = 0
  let needsBrowser = 0
  for (const r of rows) {
    if (String(r.sourceSite ?? '').startsWith('navercafe')) needsBrowser += 1
    else fetchOnly += 1
  }
  return { pending: rows.length, fetchOnly, needsBrowser }
}

export type LayerCount = {
  /** 이 층에 들어온 것 */
  total: number
  /** 다음 층으로 이미 넘어간 것 */
  passed: number
}

/** 층 하나의 상태 */
export type LayerState = {
  layer: Layer
  total: number
  passed: number
  /** 아직 안 넘어간 것 — 이것이 "일감" 이다 */
  pending: number
  actor: 'machine' | 'human' | 'network'
}

export function readLayer(layer: Layer, c: LayerCount): LayerState {
  const pending = Math.max(0, c.total - c.passed)
  return { layer, total: c.total, passed: c.passed, pending, actor: LAYER_ACTOR[layer] }
}

export type PipelineInput = Record<Layer, LayerCount>

/**
 * 막힌 곳을 찾는다 — 🔴 **가장 앞에서 일감이 있는 층**이 답이다.
 *
 * 뒤쪽 층에 일감이 있어도 앞이 비어 있으면 곧 마른다.
 * 그래서 "지금 할 일" 은 뒤가 아니라 **앞에서** 찾는다.
 * 전부 비었으면 막힌 곳이 없는 게 아니라 **재고가 없는 것**이다 — 그건 다른 문제다.
 */
export function findBottleneck(input: PipelineInput): {
  states: LayerState[]
  /** 지금 일감이 있는 가장 앞 층 — 없으면 null */
  next: LayerState | null
  /** 🔴 전 구간에 일감이 0 */
  starved: boolean
} {
  const states = LAYERS.map((l) => readLayer(l, input[l]))
  const next = states.find((s) => s.pending > 0) ?? null
  return { states, next, starved: states.every((s) => s.pending === 0) }
}

export type StepPlan = {
  layer: Layer
  /** 기계가 넘길 수 있는가 */
  runnable: boolean
  reason: string
  command: string
}

/**
 * 이번에 기계가 돌릴 수 있는 것 — 🔴 **사람 층에서 멈춘다.**
 *
 * `draft` 층(판정)은 **지금은** 사람이 한다. 여기를 기계가 넘기면 "사람이 고른 글" 이라는
 * 이 레인의 전제가 무너진다 — 그 전제 위에 자동 발행이 서 있다(§4-AL).
 *
 * 🔴 **영구 금지가 아니다.** 판정 gate 와 검수 기준이 서면 `LAYER_ACTOR` 에서
 *    `machine` 으로 옮긴다. 그때까지는 전제를 지킨다.
 */
export function planSteps(input: PipelineInput): StepPlan[] {
  const { states } = findBottleneck(input)
  return states.map((s) => {
    const command = LAYER_ACTION[s.layer]
    if (s.pending === 0) {
      return { layer: s.layer, runnable: false, reason: '일감이 없다', command }
    }
    // 🔴 밖으로 나가는 층은 기계지만 자동으로 돌리지 않는다 — pacing·robots·차단은 승인의 문제다
    if (s.actor === 'network') {
      return {
        layer: s.layer, runnable: false,
        reason: `🟡 밖으로 요청해야 한다 (${s.pending}건) — 승인 사항`, command,
      }
    }
    if (s.actor === 'human') {
      return {
        layer: s.layer, runnable: false,
        reason: `🔴 사람이 판정해야 한다 (${s.pending}건 대기)`, command,
      }
    }
    return { layer: s.layer, runnable: true, reason: `${s.pending}건 처리 가능`, command }
  })
}

/** 재고 신호 — 공급이 마르고 있는지 */
export type SupplySignal = 'starved' | 'human-blocked' | 'network-blocked' | 'runnable'

/**
 * 한 줄 진단 — 🔴 **"마름" 과 "사람 대기" 를 구분한다.**
 *
 * 둘 다 "지금 후보가 안 늘어난다" 지만 할 일이 정반대다.
 * 사람 대기는 **판정 화면을 열면** 풀리고, 마름은 **새 원천을 들여와야** 풀린다.
 * 이걸 뭉뚱그리면 판정만 하다가 원천이 없는 걸 뒤늦게 안다.
 */
export function diagnose(input: PipelineInput): { signal: SupplySignal; message: string } {
  const { next, starved } = findBottleneck(input)
  if (starved) {
    return {
      signal: 'starved',
      message: '🔴 전 구간에 일감이 0 — 새 원천이 들어와야 한다. 판정할 것도 만들 것도 없다',
    }
  }
  if (next !== null && next.actor === 'network') {
    return {
      signal: 'network-blocked',
      message: `🟡 ${LAYER_LABEL[next.layer]} 에 ${next.pending}건 — 밖으로 요청을 보내야 한다. 승인 사항이다`,
    }
  }
  if (next !== null && next.actor === 'human') {
    return {
      signal: 'human-blocked',
      message: `🔴 ${LAYER_LABEL[next.layer]} 에서 사람 판정 ${next.pending}건 대기 — 기계는 여기서 멈춘다`,
    }
  }
  return {
    signal: 'runnable',
    message: `🟢 ${next === null ? '' : LAYER_LABEL[next.layer]} 에서 ${next?.pending ?? 0}건 처리 가능`,
  }
}

export type Candidate = {
  candidateType?: string
  sourceArticleId?: string
  title?: string
  safetyVerdict?: string
}

/** 출처 + 제목 — 같은 원문에서 나온 두 초안은 서로 다른 후보다 */
export function candidateKeyOf(articleId: string, title: string): string {
  return `${String(articleId ?? '')} ${String(title ?? '').replace(/\s+/g, ' ').trim()}`
}

/**
 * 후보 파일이 supply-autofill 이 먹을 수 있는 모양인지 본다 —
 * 🔴 **생성기와 소비기 사이 계약이 어긋나면 조용히 0건이 된다.**
 *
 * 실제로 그럴 뻔했다: 소비기는 `candidateType` 과 `safetyVerdict` 로 거르는데,
 * 생성기가 그 필드를 안 쓰면 전부 걸러진다 — 그런데 화면에는 "후보 0건" 이라고만 뜬다.
 */
export function checkCandidateShape(rows: readonly Candidate[]): {
  ok: boolean; problems: string[]
} {
  const problems: string[] = []
  if (rows.length === 0) return { ok: true, problems }
  const missing = (f: keyof Candidate): number =>
    rows.filter((r) => String(r[f] ?? '').trim() === '').length
  for (const f of ['candidateType', 'sourceArticleId', 'title', 'safetyVerdict'] as const) {
    const n = missing(f)
    if (n > 0) problems.push(`${f} 가 빈 행 ${n}건 — supply-autofill 이 전부 거른다`)
  }
  const dup = rows.length - new Set(rows.map((r) => candidateKeyOf(
    String(r.sourceArticleId ?? ''), String(r.title ?? ''),
  ))).size
  if (dup > 0) problems.push(`같은 (출처+제목)이 ${dup}건 겹친다`)
  return { ok: problems.length === 0, problems }
}
