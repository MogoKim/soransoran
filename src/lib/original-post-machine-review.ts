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
  /** 🔴 이 한 장을 정확히 가리키는 불투명 id — 원문에서 유도하지 않은 값 */
  artifactId: string
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
  'noArtifactId', 'artifactMissing', 'duplicateArtifactId',
  'sourceMismatch', 'noDraft', 'draftMismatch',
] as const
export type ReviewBlockCode = (typeof REVIEW_BLOCK_CODES)[number]

export const REVIEW_BLOCK_LABEL: Readonly<Record<ReviewBlockCode, string>> = {
  noArtifactId: '큐 행에 artifactId 가 없다 — 어느 한 장을 볼지 알 수 없다',
  artifactMissing: '그 artifactId 의 근거가 없다 — 사람이 볼 것이 없다',
  duplicateArtifactId: '🔴 같은 artifactId 가 여러 장이다 — 어느 것이 진짜인지 알 수 없다',
  sourceMismatch: '🔴 artifact 의 원천이 큐 행과 다르다',
  noDraft: 'artifact 에 초안이 없다 — 이 글이 거기서 나온 것이 아니다',
  draftMismatch: '🔴 artifact 의 최초 초안이 큐의 draft 와 다르다',
}

export type ReviewEvidence =
  | { ok: true; artifact: ReviewArtifact }
  | { ok: false; code: ReviewBlockCode; reason: string }

const flat = (s: string): string => s.replace(/\s+/g, '')

/**
 * 🔴 이 큐 행을 사람이 검토할 근거가 갖춰졌는가.
 *
 *    🔴 **`artifactId` 로 정확히 한 장을 찾는다.** 원천으로 훑으면 같은 원천의
 *       다른 회차 글이 걸릴 수 있다 — 사람은 맞는 근거를 봤다고 믿는다.
 *    🔴 찾은 뒤 `sourceArticleId` 와 **최초 초안**을 추가로 대조한다.
 *
 * 🔴 **사람이 고친 글을 잘못된 artifact 로 오해하지 않는다** (2026-09-20 보정).
 *    artifact 의 초안은 **큐의 `draftTitle`/`draftBody`**(최초 초안)와 견준다.
 *    `editedTitle`/`editedBody` 는 **사람이 고친 것**이고, 그것과 견주면
 *    정상적인 EDIT_REQUIRED 수정이 전부 `draftMismatch` 로 막힌다.
 */
export type ReviewTarget = {
  artifactId: string | null
  sourceArticleId: string | null
  /** 🔴 기계가 만든 **최초** 초안 — artifact 와 견주는 것은 이쪽이다 */
  draftTitle: string
  draftBody: string
  /** 사람이 고친 것. 없으면 `null` */
  editedTitle: string | null
  editedBody: string | null
}

/** 사람이 지금 읽어야 하는 글 — 🔴 수정본이 있으면 그쪽이다 */
export function currentText(t: ReviewTarget): { title: string; body: string; edited: boolean } {
  const et = (t.editedTitle ?? '').trim()
  const eb = (t.editedBody ?? '').trim()
  const edited = et !== '' || eb !== ''
  return edited
    ? { title: et === '' ? t.draftTitle : et, body: eb === '' ? t.draftBody : eb, edited: true }
    : { title: t.draftTitle, body: t.draftBody, edited: false }
}

export function findReviewArtifact(input: {
  target: ReviewTarget
  artifacts: readonly ReviewArtifact[]
}): ReviewEvidence {
  const t = input.target
  const id = (t.artifactId ?? '').trim()
  if (id === '') return { ok: false, code: 'noArtifactId', reason: REVIEW_BLOCK_LABEL.noArtifactId }
  const hit = input.artifacts.filter((a) => a.artifactId.trim() === id)
  if (hit.length === 0) {
    return { ok: false, code: 'artifactMissing', reason: `${REVIEW_BLOCK_LABEL.artifactMissing} (${id})` }
  }
  if (hit.length > 1) {
    /** 🔴 같은 id 인데 내용이 다르면 어느 것이 진짜인지 알 수 없다 */
    const distinct = new Set(hit.map((a) => JSON.stringify(a)))
    if (distinct.size > 1) {
      return { ok: false, code: 'duplicateArtifactId', reason: `${REVIEW_BLOCK_LABEL.duplicateArtifactId} (${id})` }
    }
  }
  const a = hit[0]!
  if ((t.sourceArticleId ?? '').trim() !== '' && a.sourceArticleId.trim() !== (t.sourceArticleId ?? '').trim()) {
    return { ok: false, code: 'sourceMismatch', reason: `${REVIEW_BLOCK_LABEL.sourceMismatch} (${a.sourceArticleId} ≠ ${t.sourceArticleId})` }
  }
  if (a.draft === null) {
    return { ok: false, code: 'noDraft', reason: `${REVIEW_BLOCK_LABEL.noDraft} (${id})` }
  }
  // 🔴 **최초 초안**과 견준다. 사람이 고친 글과 견주지 않는다
  if (flat(a.draft.title) !== flat(t.draftTitle) || flat(a.draft.body) !== flat(t.draftBody)) {
    return { ok: false, code: 'draftMismatch', reason: `${REVIEW_BLOCK_LABEL.draftMismatch} (${id})` }
  }
  return { ok: true, artifact: a }
}

/** 🔴 최초 초안과 수정본의 차이 — 사람이 무엇이 바뀌었는지 본다 */
export function editDiffLines(t: ReviewTarget): string[] {
  const cur = currentText(t)
  if (!cur.edited) return []
  const out: string[] = []
  if (flat(cur.title) !== flat(t.draftTitle)) {
    out.push(`제목  기계 "${t.draftTitle}"`, `      사람 "${cur.title}"`)
  }
  if (flat(cur.body) !== flat(t.draftBody)) {
    const a = t.draftBody.split('\n')
    const b = cur.body.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (flat(a[i] ?? '') === flat(b[i] ?? '')) continue
      out.push(`본문 ${i + 1}행  기계 "${a[i] ?? '(없음)'}"`, `           사람 "${b[i] ?? '(없음)'}"`)
    }
  }
  return out.length === 0 ? ['(수정본이 최초 초안과 같다)'] : out
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
  /** 🔴 사람이 READY 를 찍은 **artifactId** 들 */
  readyArtifactIds: readonly string[]
}): { total: number | null; ready: number; perReady: number | null; why: string } {
  /**
   * 🔴 **같은 artifactId 는 한 번만 센다** (2026-09-20).
   *    캐시 hit 이나 회차 파일이 여럿이면 같은 장이 반복해서 들어온다 —
   *    그대로 더하면 분자가 부풀어 한 편당 비용이 실제보다 크게 나온다.
   *    🔴 같은 id 인데 **금액이 다르면** 오류다. 어느 쪽이 맞는지 알 수 없다.
   */
  const byId = new Map<string, number | null>()
  for (const a of input.artifacts) {
    const c = artifactCostUsd(a)
    if (!byId.has(a.artifactId)) { byId.set(a.artifactId, c); continue }
    const seen = byId.get(a.artifactId)!
    if (seen !== c) {
      return {
        total: null, ready: new Set(input.readyArtifactIds).size, perReady: null,
        why: `🔴 같은 artifactId 가 서로 다른 비용을 갖는다 (${a.artifactId})`,
      }
    }
  }
  const costs = [...byId.values()]
  if (costs.some((c) => c === null)) {
    return {
      total: null, ready: new Set(input.readyArtifactIds).size, perReady: null,
      why: '정산하지 못한 요청이 있다 — 계산 불가',
    }
  }
  /** 🔴 HOLD·폐기한 글의 비용도 분자에 든다. 쓴 돈은 쓴 돈이다 */
  const total = costs.reduce((n: number, c) => n + (c ?? 0), 0)
  const ready = new Set(input.readyArtifactIds).size
  if (ready === 0) return { total, ready: 0, perReady: null, why: 'READY 0건 — 계산 불가' }
  return { total, ready, perReady: total / ready, why: '' }
}

/** 🔴 사람이 화면에서 읽는 줄 — 판정이 아니라 근거다 */
export function reviewEvidenceLines(a: ReviewArtifact): string[] {
  return [
    `artifact ${a.artifactId} · 원천 ${a.sourceArticleId} · 기계 ${a.machineOutcome}${a.machineReason === '' ? '' : ` — ${a.machineReason}`}`,
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
  const aid = typeof o.artifactId === 'string' ? o.artifactId : ''
  if (aid === '') return null
  return {
    artifactId: aid,
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
