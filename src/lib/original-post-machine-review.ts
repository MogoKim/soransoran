/**
 * 기계 후보 사람 검토 — 🔴 **근거 없이 검토 완료를 찍지 않는다**
 *
 * 🔴 **왜 artifact 가 필요한가** (2026-09-20).
 *    큐 행에는 제목·본문과 provenance 만 있다. 사람이 *"원문에 없는 얘기를 지어냈나"* ·
 *    *"이 사람이 쓸 자격이 있나"* 를 판단하려면 **원문 근거와 계획·검수 결과**가 있어야
 *    한다. 그것은 러너가 남긴 `.microseed-data/*.artifacts.json` 에 있다.
 *
 * 🔴 **원문 근거를 DB 로 복사하지 않는다.** 큐에는 `sourceArticleId` 하나만 실리고,
 *    검토는 그 열쇠로 **로컬 정본**을 연다. 복사하면 원문이 DB 에 남는다.
 *
 * 🔴 **순수 함수다.** DB·파일·네트워크를 모른다 — fixture 가 그대로 돌린다.
 */

/** 🔴 사람이 보아야 하는 것만 추린다 — artifact 전문을 그대로 들고 다니지 않는다 */
export type ReviewArtifact = {
  sourceArticleId: string
  /** 마스킹되고 300자로 묶인 원문 근거 — 🔴 로컬 정본에서만 온다 */
  evidence: { kind: string; text: string }[]
  draft: { title: string; body: string } | null
  personaCode: string | null
  stance: string | null
  selfBasis: string | null
  warrants: { fact: string; requiredValue: string; evidenceText: string }[]
  unsupportedAdditions: { evidence: string; why: string }[]
  lifeContradictions: { fact: string; drafted: string; card: string; evidence: string }[]
  droppedFromSource: { evidence: string; why: string }[]
  machineOutcome: string
  machineReason: string
  /** 🔴 장부가 정산한 금액 — 여기서 다시 계산하지 않는다 */
  calls: { stage: string; model: string | null; usd: number | null }[]
}

export const REVIEW_BLOCK_CODES = [
  'noSourceId', 'artifactMissing', 'sourceMismatch', 'noDraft', 'draftMismatch',
] as const
export type ReviewBlockCode = (typeof REVIEW_BLOCK_CODES)[number]

export const REVIEW_BLOCK_LABEL: Readonly<Record<ReviewBlockCode, string>> = {
  noSourceId: '큐 행에 원천 id 가 없다 — 어느 artifact 를 볼지 알 수 없다',
  artifactMissing: '이 원천의 artifact 가 없다 — 사람이 볼 근거가 없다',
  sourceMismatch: '🔴 artifact 의 원천이 큐 행과 다르다',
  noDraft: 'artifact 에 초안이 없다 — 이 글이 거기서 나온 것이 아니다',
  draftMismatch: '🔴 artifact 의 초안과 큐 행의 글이 다르다',
}

export type ReviewEvidence =
  | { ok: true; artifact: ReviewArtifact }
  | { ok: false; code: ReviewBlockCode; reason: string }

const flat = (s: string): string => s.replace(/\s+/g, '')

/**
 * 🔴 이 큐 행을 사람이 검토할 근거가 갖춰졌는가.
 *
 *    🔴 **없거나 다른 원천이면 거부한다.** 다른 글의 근거로 이 글을 통과시키는 것이
 *       가장 조용한 사고다 — 사람은 맞는 근거를 봤다고 믿는다.
 *    🔴 **초안 본문까지 대조한다.** 같은 원천이라도 그 회차의 그 글이 아니면
 *       사람이 보는 근거와 승인하는 글이 어긋난다.
 */
export function findReviewArtifact(input: {
  sourceArticleId: string | null
  /** 큐 행의 실제 글 — 사람이 승인하려는 그것 */
  title: string
  body: string
  artifacts: readonly ReviewArtifact[]
}): ReviewEvidence {
  const id = (input.sourceArticleId ?? '').trim()
  if (id === '') return { ok: false, code: 'noSourceId', reason: REVIEW_BLOCK_LABEL.noSourceId }
  const hit = input.artifacts.filter((a) => a.sourceArticleId.trim() === id)
  if (hit.length === 0) {
    return { ok: false, code: 'artifactMissing', reason: `${REVIEW_BLOCK_LABEL.artifactMissing} (${id})` }
  }
  const withDraft = hit.filter((a) => a.draft !== null)
  if (withDraft.length === 0) {
    return { ok: false, code: 'noDraft', reason: `${REVIEW_BLOCK_LABEL.noDraft} (${id})` }
  }
  const same = withDraft.find((a) =>
    flat(a.draft!.title) === flat(input.title) && flat(a.draft!.body) === flat(input.body))
  if (same === undefined) {
    return { ok: false, code: 'draftMismatch', reason: `${REVIEW_BLOCK_LABEL.draftMismatch} (${id})` }
  }
  return { ok: true, artifact: same }
}

/** 🔴 원천별 총비용 — 장부가 정산한 값만 더한다. 하나라도 모르면 `null` */
export function artifactCostUsd(a: ReviewArtifact): number | null {
  if (a.calls.length === 0) return null
  if (a.calls.some((c) => c.usd === null)) return null
  return a.calls.reduce((n, c) => n + (c.usd ?? 0), 0)
}

/**
 * 🔴 **사람 READY 한 편당 비용.** READY 가 0 이면 **계산 불가**다 —
 *    0 으로 나눈 값이나 "무한" 을 적지 않는다.
 */
export function usdPerReady(input: {
  artifacts: readonly ReviewArtifact[]
  readySourceIds: readonly string[]
}): { total: number | null; ready: number; perReady: number | null; why: string } {
  const costs = input.artifacts.map(artifactCostUsd)
  if (costs.some((c) => c === null)) {
    return { total: null, ready: input.readySourceIds.length, perReady: null, why: '정산하지 못한 요청이 있다' }
  }
  const total = costs.reduce((n: number, c) => n + (c ?? 0), 0)
  const ready = new Set(input.readySourceIds).size
  if (ready === 0) return { total, ready: 0, perReady: null, why: 'READY 0건 — 계산 불가' }
  return { total, ready, perReady: total / ready, why: '' }
}

/** 🔴 사람이 화면에서 읽는 줄 — 판정이 아니라 근거다 */
export function reviewEvidenceLines(a: ReviewArtifact): string[] {
  return [
    `원천 ${a.sourceArticleId} · 기계 ${a.machineOutcome}${a.machineReason === '' ? '' : ` — ${a.machineReason}`}`,
    `화자 ${a.personaCode ?? '(없음)'} / ${a.stance ?? '(없음)'}`
      + (a.selfBasis === null ? '' : ` (${a.selfBasis})`),
    ...(a.warrants.length > 0
      ? [`1인칭 근거: ${a.warrants.map((w) => `${w.fact}=${w.requiredValue} ← "${w.evidenceText}"`).join(' · ')}`]
      : ['1인칭 근거: (없음)']),
    '원문 근거:',
    ...a.evidence.map((e) => `   [${e.kind}] ${e.text}`),
    ...(a.unsupportedAdditions.length > 0
      ? ['🔴 원문에 없는 것:', ...a.unsupportedAdditions.map((x) => `   "${x.evidence}" — ${x.why}`)]
      : ['🟢 원문에 없는 것: 없음']),
    ...(a.droppedFromSource.length > 0
      ? ['🔴 원문에서 사라진 것:', ...a.droppedFromSource.map((x) => `   "${x.evidence}" — ${x.why}`)]
      : ['🟢 원문에서 사라진 것: 없음']),
    ...(a.lifeContradictions.length > 0
      ? ['🔴 생활사 모순:', ...a.lifeContradictions.map((x) => `   ${x.fact}: "${x.drafted}" ↔ 카드 "${x.card}" — "${x.evidence}"`)]
      : ['🟢 생활사 모순: 없음']),
    `비용: ${artifactCostUsd(a) === null ? '🔴 정산 미상' : `$${artifactCostUsd(a)!.toFixed(6)}`}`
      + ` (${a.calls.map((c) => `${c.stage}:${c.model ?? '?'}`).join(' · ')})`,
  ]
}

/** 🔴 artifact JSON 한 장을 검토용으로 줄인다 — 모양이 다르면 `null` */
export function readReviewArtifact(v: unknown): ReviewArtifact | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const id = typeof o.sourceArticleId === 'string' ? o.sourceArticleId : ''
  if (id === '') return null
  const ev = (o.evidence ?? {}) as Record<string, unknown>
  const plan = (o.plan ?? {}) as Record<string, unknown>
  const review = (o.review ?? {}) as Record<string, unknown>
  const cost = (o.cost ?? {}) as Record<string, unknown>
  const d = o.draft as Record<string, unknown> | null
  const arr = (x: unknown): Record<string, unknown>[] =>
    (Array.isArray(x) ? x : []).filter((y): y is Record<string, unknown> => typeof y === 'object' && y !== null)
  const S = (x: unknown): string => (typeof x === 'string' ? x : '')
  return {
    sourceArticleId: id,
    evidence: arr(ev.spans).map((x) => ({ kind: S(x.kind), text: S(x.text) })),
    draft: d === null || d === undefined ? null : { title: S(d.title), body: S(d.body) },
    personaCode: typeof plan.personaCode === 'string' ? plan.personaCode : null,
    stance: typeof plan.stance === 'string' ? plan.stance : null,
    selfBasis: typeof plan.selfBasis === 'string' ? plan.selfBasis : null,
    warrants: arr(plan.warrants).map((x) => ({
      fact: S(x.fact), requiredValue: S(x.requiredValue), evidenceText: S(x.evidenceText),
    })),
    unsupportedAdditions: arr(review.unsupportedAdditions).map((x) => ({ evidence: S(x.evidence), why: S(x.why) })),
    droppedFromSource: arr(review.droppedFromSource).map((x) => ({ evidence: S(x.evidence), why: S(x.why) })),
    lifeContradictions: arr(review.lifeContradictions).map((x) => ({
      fact: S(x.fact), drafted: S(x.drafted), card: S(x.card), evidence: S(x.evidence),
    })),
    machineOutcome: S(review.machineOutcome),
    machineReason: S(review.machineReason),
    calls: arr(cost.calls).map((x) => ({
      stage: S(x.stage),
      model: typeof x.model === 'string' ? x.model : null,
      usd: typeof x.usd === 'number' && Number.isFinite(x.usd) ? x.usd : null,
    })),
  }
}
