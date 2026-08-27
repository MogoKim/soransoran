/**
 * VE-M3 1차 실험 층화 표본 (VE-M3-3)
 *
 * 정본: docs/operations/2026-08-27-voice-m3-model-selection-criteria.md §2-1
 *
 * 🔴 무작위로 뽑지 않는다
 *    `other` 81% · 짧은 본문 45.7% 라는 분포 탓에 무작위 30건은
 *    **"비슷한 글 30개"** 가 된다. 모델 차이가 드러날 자리가 없다.
 *
 * 🔴 같은 명령이면 같은 30건이 나온다
 *    난수를 쓰지 않고 **id 오름차순**으로만 고른다.
 *    두 모델에 같은 표본을 넣어야 "모델 차이" 를 보는 것이지 "글 차이" 를 보는 게 아니다.
 *
 * 🔴 이 파일은 원문을 반환하지 않는다
 *    표본 행에는 id · sourceRef · 길이 · 개수 · 축 태그만 담긴다.
 */

/** 표본이 덮어야 할 축. 🔴 하나라도 비면 표본을 다시 고른다 */
export const SAMPLE_AXES = [
  'shortBody', 'longBody',
  'manyComments', 'fewComments',
  'strongEmotion', 'calmTone',
  'question', 'complaint', 'experience',
  'sourceSpecificAddress', 'targetDescriptorRisk',
  'highOtherReaction',
  'referenced', 'notReferenced',
  'truncatedComment',
] as const

export type SampleAxis = (typeof SAMPLE_AXES)[number]

/** 축 판정에 필요한 만큼만. 🔴 본문 · 댓글 텍스트가 없다 */
export type SampleCandidate = {
  id: string
  sourceRef: string
  sourceSite: string
  contentLength: number | null
  commentCount: number | null
  legacyLabels: Record<string, unknown> | null
  /** VoiceDerived.communityRegister 에서 필요한 두 갈래만 */
  sourceSpecificCount: number
  targetDescriptorCount: number
  referenced: boolean
  /** VoiceCommentSignal 집계 */
  commentSignalTotal: number
  otherReactionCount: number
  truncatedCount: number
}

export type SampleRow = SampleCandidate & { axes: SampleAxis[] }

/**
 * 🔴 수집 상한에서 잘린 글은 제외한다.
 *    3,000자에서 끊긴 230건은 끝이 잘려 흐름 · 구조 판정이 오염된다.
 */
export function isExcluded(c: SampleCandidate): boolean {
  return c.contentLength === 3000
}

const label = (c: SampleCandidate, k: string): unknown => c.legacyLabels?.[k]

/** 이 후보가 어느 축에 해당하는가. 판정은 전부 값 기반이며 난수가 없다 */
export function axesOf(c: SampleCandidate): SampleAxis[] {
  const out: SampleAxis[] = []
  const len = c.contentLength ?? 0
  const cmt = c.commentCount ?? 0
  const tags = label(c, 'emotionTags')
  const urgency = label(c, 'urgencyLevel')
  const signal = label(c, 'communitySignal')

  if (len >= 150 && len <= 250) out.push('shortBody')
  if (len >= 1168) out.push('longBody')
  if (cmt >= 22) out.push('manyComments')
  if (cmt <= 3) out.push('fewComments')
  if (Array.isArray(tags) && tags.some((t) => ['ANGRY', 'ANXIOUS', 'RESIGNED'].includes(String(t)))) {
    out.push('strongEmotion')
  }
  if (typeof urgency === 'number' && urgency <= 2) out.push('calmTone')
  if (signal === 'question') out.push('question')
  if (signal === 'complaint') out.push('complaint')
  if (label(c, 'desireType') === 'big_desire' || signal === 'confession') out.push('experience')
  if (c.sourceSpecificCount > 0) out.push('sourceSpecificAddress')
  if (c.targetDescriptorCount > 0) out.push('targetDescriptorRisk')
  if (c.commentSignalTotal >= 5 && c.otherReactionCount / c.commentSignalTotal >= 0.9) {
    out.push('highOtherReaction')
  }
  out.push(c.referenced ? 'referenced' : 'notReferenced')
  if (c.truncatedCount > 0) out.push('truncatedComment')
  return out
}

export type SelectResult = {
  rows: SampleRow[]
  /** 축별로 몇 건이 잡혔는가 */
  coverage: Record<string, number>
  /** 🔴 비어 있는 축. 하나라도 있으면 표본을 쓰지 않는다 */
  missingAxes: SampleAxis[]
  siteSpread: Record<string, number>
}

/**
 * 층화 표본을 고른다.
 *
 * 🔴 **희소한 축을 먼저 채운다.** `targetDescriptorRisk` 는 전체 9,674건 중 7건뿐이라,
 *    흔한 축을 먼저 채우면 자리가 남지 않는다. 후보가 적은 축부터 배정한다.
 *
 * 🔴 난수가 없다. 후보를 id 오름차순으로 두고 앞에서부터 고른다 —
 *    같은 입력이면 항상 같은 30건이다.
 */
export function selectStratifiedSample(
  candidates: readonly SampleCandidate[], size: number,
): SelectResult {
  // 🔴 id 오름차순 고정. 입력 순서에 기대지 않는다
  const pool = candidates
    .filter((c) => !isExcluded(c))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const axesByCandidate = new Map<string, SampleAxis[]>()
  for (const c of pool) axesByCandidate.set(c.id, axesOf(c))

  // 축별 후보 수 — 적은 축부터 채운다
  const countByAxis = new Map<SampleAxis, number>()
  for (const a of SAMPLE_AXES) countByAxis.set(a, 0)
  for (const c of pool) {
    for (const a of axesByCandidate.get(c.id) ?? []) {
      countByAxis.set(a, (countByAxis.get(a) ?? 0) + 1)
    }
  }
  const axisOrder = [...SAMPLE_AXES].sort(
    (a, b) => (countByAxis.get(a) ?? 0) - (countByAxis.get(b) ?? 0),
  )

  const picked = new Map<string, SampleRow>()
  const takenByAxis = new Map<SampleAxis, number>()
  const PER_AXIS_MIN = 2

  // ① 희소 축부터 최소 인원을 채운다
  for (const axis of axisOrder) {
    for (const c of pool) {
      if (picked.size >= size) break
      if ((takenByAxis.get(axis) ?? 0) >= PER_AXIS_MIN) break
      if (picked.has(c.id)) continue
      const axes = axesByCandidate.get(c.id) ?? []
      if (!axes.includes(axis)) continue
      picked.set(c.id, { ...c, axes })
      for (const a of axes) takenByAxis.set(a, (takenByAxis.get(a) ?? 0) + 1)
    }
  }

  // ② 남은 자리는 **아직 덜 채워진 축을 가장 많이 메우는 후보**로 메운다.
  //    🔴 앞에서부터 아무거나 넣으면 흔한 축만 두꺼워진다.
  while (picked.size < size) {
    let best: SampleCandidate | null = null
    let bestGain = -1
    for (const c of pool) {
      if (picked.has(c.id)) continue
      const axes = axesByCandidate.get(c.id) ?? []
      const gain = axes.filter((a) => (takenByAxis.get(a) ?? 0) < PER_AXIS_MIN).length
      if (gain > bestGain) { best = c; bestGain = gain }
      // 동점이면 앞선 id 를 쓴다 — pool 이 정렬돼 있으므로 첫 후보가 유지된다
    }
    if (!best) break
    const axes = axesByCandidate.get(best.id) ?? []
    picked.set(best.id, { ...best, axes })
    for (const a of axes) takenByAxis.set(a, (takenByAxis.get(a) ?? 0) + 1)
  }

  const rows = [...picked.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  const coverage: Record<string, number> = {}
  for (const a of SAMPLE_AXES) coverage[a] = rows.filter((r) => r.axes.includes(a)).length
  const missingAxes = SAMPLE_AXES.filter((a) => coverage[a] === 0)
  const siteSpread: Record<string, number> = {}
  for (const r of rows) siteSpread[r.sourceSite] = (siteSpread[r.sourceSite] ?? 0) + 1

  return { rows, coverage, missingAxes, siteSpread }
}

/**
 * 표본을 사람이 읽을 한 줄로.
 * 🔴 본문 · 댓글이 들어갈 자리가 없다 — id · 수치 · 축 태그뿐이다.
 */
export function formatSampleRow(r: SampleRow, index: number): string {
  return (
    `  ${String(index + 1).padStart(2)}. ${r.sourceRef}  ` +
    `${String(r.contentLength ?? 0).padStart(4)}자 · 댓글 ${String(r.commentCount ?? 0).padStart(3)} · ` +
    `${r.sourceSite.replace('navercafe:', '').padEnd(13)} · ${r.axes.join(',')}`
  )
}

/** 표본이 쓸 수 있는 상태인가. 🔴 축이 비면 쓰지 않는다 */
export function validateSample(result: SelectResult, expectedSize: number): {
  ok: boolean
  problems: string[]
} {
  const problems: string[] = []
  if (result.rows.length !== expectedSize) {
    problems.push(`표본이 ${result.rows.length}건 (${expectedSize}건이어야 한다)`)
  }
  if (result.missingAxes.length > 0) {
    problems.push(`비어 있는 축: ${result.missingAxes.join(', ')}`)
  }
  const ids = new Set(result.rows.map((r) => r.id))
  if (ids.size !== result.rows.length) problems.push('표본에 중복이 있다')
  if (result.rows.some((r) => r.contentLength === 3000)) {
    problems.push('수집 상한에서 잘린 글이 섞였다')
  }
  return { ok: problems.length === 0, problems }
}
