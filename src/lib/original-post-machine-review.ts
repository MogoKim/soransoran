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
 *    검토 완료(`completeReview`)만 저장소를 **주입받아** 쓴다 — 여기서 Prisma 를 알지 않는다.
 */
import { judgeReviewSnapshot, type ReviewSnapshot } from './original-post-auto-publish'

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
  /**
   * 🔴 `verifiedCardValue` 는 **코드가 정본 Persona 카드에서 읽은 값**이다 —
   *    provider 가 적어 낸 값이 아니다. 검토자가 Pool 문서를 열지 않고도
   *    "이 사람이 정말 그런가" 를 볼 수 있게 함께 적는다.
   */
  warrants: { fact: string; requiredValue: string; evidenceText: string; verifiedCardValue: string }[]
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
 * 🔴 **전역 "READY 한 편당 비용" 은 만들지 않는다** (2026-09-20 보정).
 *
 *    앞판은 **로컬에 있는 모든 artifact 비용**을 **지금 미발행 상태로 남은 READY 수**로
 *    나눴다. 두 숫자의 모집단이 다르다 —
 *      · 분자: 어제·오늘·어느 회차든 로컬에 남아 있는 파일 전부
 *      · 분모: 지금 큐에 **미발행으로 남아 있는** READY 만 (발행된 것은 큐에서 빠진다)
 *    그래서 발행이 진행될수록 분모가 줄어 한 편당 비용이 **끝없이 커진다.**
 *
 * 🔴 **회차·기간·생성 cohort 가 명시되지 않으면 이 수를 내지 않는다.**
 *    없는 모집단을 여기서 새 규칙으로 추정하면, 그 규칙이 곧 근거 없는 숫자가 된다.
 *    🔴 개별 artifact 의 정산 비용(`artifactCostUsd`)은 그대로 쓴다 —
 *       그것은 모집단이 하나로 분명하다.
 */

/** 🔴 사람이 화면에서 읽는 줄 — 판정이 아니라 근거다 */
export function reviewEvidenceLines(a: ReviewArtifact): string[] {
  return [
    `artifact ${a.artifactId} · 원천 ${a.sourceArticleId} · 기계 ${a.machineOutcome}${a.machineReason === '' ? '' : ` — ${a.machineReason}`}`,
    `화자 ${a.personaCode ?? '(없음)'} / ${a.stance ?? '(없음)'}`
      + (a.selfBasis === null ? '' : ` (${a.selfBasis})`),
    ...(a.warrants.length > 0
      ? [`1인칭 근거: ${a.warrants.map((w) => `${w.fact}=${w.requiredValue}`
        + `${w.verifiedCardValue === '' ? '' : ` (카드 "${w.verifiedCardValue}")`}`
        + ` ← "${w.evidenceText}"`).join(' · ')}`]
      : ['1인칭 근거: (없음)']),
    '원문 근거:',
    ...a.evidence.map((e) => `   [${e.kind}] ${e.text}`),
    /**
     * 🔴 **이 둘은 경고다 — 기계가 막지 않고 사람에게 넘긴 것이다** (2026-09-20).
     *    같은 원문·같은 초안에 회차마다 판정이 갈렸다. 그래서 막지 않고 **보여준다.**
     *    🔴 근거는 지우지 않는다 — 사람이 이것을 보고 READY 를 정한다.
     */
    ...(a.unsupportedAdditions.length > 0
      ? ['🟡 [사람이 판정] 원문에 없어 보이는 것:',
        ...a.unsupportedAdditions.map((x) => `   "${x.evidence}" — ${x.why}`),
        '   🔴 기계가 막지 않았다. 원문과 견주어 직접 확인해 주세요.']
      : ['🟢 원문에 없어 보이는 것: 없음']),
    ...(a.droppedFromSource.length > 0
      ? ['🟡 [사람이 판정] 원문에서 사라져 보이는 것:',
        ...a.droppedFromSource.map((x) => `   "${x.evidence}" — ${x.why}`),
        '   🔴 기계가 막지 않았다. 뜻이 남았는지 직접 확인해 주세요.']
      : ['🟢 원문에서 사라져 보이는 것: 없음']),
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
      verifiedCardValue: S(x.verifiedCardValue),
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

// ─────────────────────────────────────────────────────────
// 🔴 검토 완료 — **검증과 기록이 한 경계 안에 있다**
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **왜 하나로 묶나** (2026-09-20 보정).
 *
 *    앞판은 ① 조건부 UPDATE 로 도장을 찍고 ② 그 **뒤에** 다시 읽어 대조했다.
 *    ②가 어긋나면 종료 코드 1 로 멈추지만 **도장은 이미 찍혀 있었다** —
 *    "검증 실패인데 `decidedBy`/`decidedAt` 가 남는" 상태다.
 *    🔴 이제 읽기·검증·기록·재대조가 **한 트랜잭션** 안이고,
 *       어느 단계든 어긋나면 **되돌아간다(write 0).**
 */
/**
 * 🔴 읽은 행 — 대조용 스냅샷에 **도장 칸**을 더한 것.
 *    `judgeReviewSnapshot` 은 `decidedAt` 을 비교하지 않는다(바뀌라고 쓴 칸이다).
 *    그래서 "도장이 내가 찍은 그 시각인가" 는 여기서 따로 본다.
 */
export type ReviewRow = ReviewSnapshot & { decidedAt: Date | null }

export type ReviewTx = {
  /** 지금 행의 스냅샷 — 없으면 `null` */
  read: (id: string) => Promise<ReviewRow | null>
  /**
   * 🔴 **조건부 기록.** `where` 가 한 칸이라도 다르면 0 을 돌려준다 —
   *    "그 사이 누가 바꿨다" 를 DB 가 판정한다.
   */
  stamp: (input: {
    id: string; where: ReviewSnapshot; decidedBy: string; decidedAt: Date
  }) => Promise<number>
}

/** 🔴 `fn` 이 던지면 **되돌린다.** 그것이 이 계약의 전부다 */
export type ReviewStore = {
  transaction: <T>(fn: (tx: ReviewTx) => Promise<T>) => Promise<T>
}

export const COMPLETE_FAIL_CODES = [
  'notFound', 'snapshotChanged', 'conditionMissed', 'verifyFailed', 'stampMissing',
] as const
export type CompleteFailCode = (typeof COMPLETE_FAIL_CODES)[number]

export const COMPLETE_FAIL_LABEL: Readonly<Record<CompleteFailCode, string>> = {
  notFound: '그 행이 없다',
  snapshotChanged: '🔴 검토한 뒤 그 사이에 후보가 바뀌었다 — 아무것도 쓰지 않았다',
  conditionMissed: '🔴 조건부 기록이 0건이다 — 그 사이 누가 바꿨다. 아무것도 쓰지 않았다',
  verifyFailed: '🔴 쓴 뒤 대조가 어긋났다 — **되돌렸다**',
  stampMissing: '🔴 도장이 남지 않았다 — 되돌렸다',
}

export type CompleteVerdict =
  | { ok: true; decidedAt: Date }
  | { ok: false; code: CompleteFailCode; reason: string }

/** 🔴 되돌리기 위해 던지는 표식 — 밖으로 새지 않는다 */
class RollbackSignal extends Error {
  constructor(readonly code: CompleteFailCode, readonly detail: string) { super(code) }
}

export async function completeReview(input: {
  store: ReviewStore
  id: string
  /** 사람이 읽었을 때의 스냅샷 */
  before: ReviewSnapshot
  decidedBy: string
  now: Date
}): Promise<CompleteVerdict> {
  try {
    return await input.store.transaction(async (tx) => {
      const current = await tx.read(input.id)
      if (current === null) throw new RollbackSignal('notFound', '')
      // ── ① 검증 — 사람이 읽은 그 글인가 ──
      const same = judgeReviewSnapshot(input.before, current)
      if (!same.ok) throw new RollbackSignal('snapshotChanged', same.changed.join(' · '))
      // ── ② 조건부 기록 — DB 가 한 번 더 판정한다 ──
      const n = await tx.stamp({
        id: input.id, where: input.before, decidedBy: input.decidedBy, decidedAt: input.now,
      })
      if (n !== 1) throw new RollbackSignal('conditionMissed', `${n}건`)
      // ── ③ 같은 경계 안에서 다시 읽어 대조 — 어긋나면 **되돌린다** ──
      const back = await tx.read(input.id)
      if (back === null) throw new RollbackSignal('notFound', '쓴 뒤')
      if (back.decidedBy !== input.decidedBy) throw new RollbackSignal('stampMissing', String(back.decidedBy))
      // 🔴 **시각까지 대조한다.** 표시만 맞고 시각이 다르면 다른 write 가 끼어든 것이다
      if (back.decidedAt === null || back.decidedAt.getTime() !== input.now.getTime()) {
        throw new RollbackSignal('stampMissing', `decidedAt ${back.decidedAt?.toISOString() ?? '없음'}`)
      }
      const still = judgeReviewSnapshot(input.before, back)
      if (!still.ok) throw new RollbackSignal('verifyFailed', still.changed.join(' · '))
      return { ok: true as const, decidedAt: input.now }
    })
  } catch (e) {
    if (e instanceof RollbackSignal) {
      return {
        ok: false, code: e.code,
        reason: `${COMPLETE_FAIL_LABEL[e.code]}${e.detail === '' ? '' : ` (${e.detail})`}`,
      }
    }
    throw e
  }
}
