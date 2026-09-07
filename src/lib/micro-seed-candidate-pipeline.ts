/**
 * 후보 생성 파이프라인 판정 — 🔴 **순수 판정만. DB 도 파일도 네트워크도 없다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AO
 *
 * 🔴 **이 파일이 답하는 질문은 하나다: "지금 어디가 막혀 있나."**
 *
 * 후보가 큐에 닿기까지 네 층을 지난다. 각 층은 스크립트가 따로 있고,
 * 하나씩 돌려 보기 전에는 **어디서 멈췄는지 알 수가 없었다.**
 * 2026-09-07 에 그걸 알아내는 데 다섯 번을 실행해야 했다 —
 * 그리고 답은 "전 구간이 비었다" 였다.
 *
 * ```
 * ① SEED 승인   사람이 원천을 고름        → 미초안화 몇 건?
 * ② 초안        템플릿이 만듦 (LLM 아님)   → 미판정 몇 건?
 * ③ ADOPT       사람이 초안을 고름         → 미후보화 몇 건?
 * ④ 후보 파일   생성기가 모음              → 미적재 몇 건?
 * ```
 *
 * 🔴 **자동으로 넘길 수 있는 층과 사람이 있어야 하는 층이 번갈아 온다.**
 *    ②와 ④는 기계가 한다. ①과 ③은 사람이 한다.
 *    그래서 "전부 자동화" 는 애초에 불가능하고, 목표는 **기계 층을 사람이 손대지 않는 것**이다.
 */

/** 층 이름 — 순서가 곧 흐름이다 */
export const LAYERS = ['seedApproval', 'draft', 'adopt', 'candidate'] as const
export type Layer = (typeof LAYERS)[number]

export const LAYER_LABEL: Record<Layer, string> = {
  seedApproval: '① SEED 승인 → 초안',
  draft: '② 초안 → 판정',
  adopt: '③ ADOPT → 후보 파일',
  candidate: '④ 후보 파일 → 큐',
}

/** 누가 이 층을 넘기나 */
export const LAYER_ACTOR: Record<Layer, 'machine' | 'human'> = {
  seedApproval: 'machine',
  draft: 'human',
  adopt: 'machine',
  candidate: 'machine',
}

/** 각 층에서 다음으로 넘어가려면 무엇을 하나 */
export const LAYER_ACTION: Record<Layer, string> = {
  seedApproval: 'npm run micro-seed:seed-originality-dry-run',
  draft: '🔴 사람: seed-originality-review.html 에서 ADOPT / REVISE 판정',
  adopt: 'npm run micro-seed:publish-candidates',
  candidate: 'npx tsx scripts/micro-seed-supply-autofill.mts --apply --limit=N',
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
  actor: 'machine' | 'human'
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
 * `draft` 층(판정)은 사람이 한다. 여기를 기계가 넘기면 "사람이 고른 글" 이라는
 * 이 레인의 전제가 무너진다 — 그 전제 위에 자동 발행이 서 있다(§4-AL).
 */
export function planSteps(input: PipelineInput): StepPlan[] {
  const { states } = findBottleneck(input)
  return states.map((s) => {
    const command = LAYER_ACTION[s.layer]
    if (s.pending === 0) {
      return { layer: s.layer, runnable: false, reason: '일감이 없다', command }
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
export type SupplySignal = 'starved' | 'human-blocked' | 'runnable'

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
