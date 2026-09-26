/**
 * 🔴 **자동 READY 증거 복원 — 순수 판정** (2026-09-25 · feat/auto-ready-v2)
 *
 * 사람이 이미 결정한 기계 후보를, 로컬 artifact 정본에서 **정확히 한 장**을 찾아
 * 의미 검수 근거를 복원한다. 복원되면 그 결정은 증거 표본(30건)에 들어갈 수 있다.
 *
 * 🔴 **추정 매칭을 하지 않는다.** 열쇠는 `artifactId` 하나다. `sourceArticleId` 는
 *    열쇠가 아니라 **대조 항목**이다 — 같은 원천에서 여러 초안이 나올 수 있다.
 * 🔴 대조 규칙은 전부 적재 경로의 정본을 쓴다 — `baseArticleId` · `MACHINE_SITE_PREFIX` ·
 *    `semanticSummaryOf`. 여기서 다시 적지 않는다.
 * 🔴 DB·파일·네트워크를 모른다. 읽기는 부르는 쪽(scan 스크립트)이 한다.
 */
import {
  baseArticleId, MACHINE_SITE_PREFIX, semanticSummaryOf,
} from './micro-seed-supply-autofill'
import {
  semanticIssues, warningsOfGate, judgeRow, HUMAN_DECIDER, CONTRACT, digestOf, isHumanEditRecord,
} from './auto-ready-v2'
import { parseReviewerKind, isHumanReviewer, type ReviewerKind } from './review-provenance'

export { digestOf }

/** 🔴 결과는 이 여섯 가지뿐이다 — 섞어 세지 않는다 */
export const RESTORE_CLASSES = [
  'clean', 'warning', 'missing', 'ambiguous', 'draftMismatch', 'provenanceMismatch',
] as const
export type RestoreClass = (typeof RESTORE_CLASSES)[number]

/** artifact 한 장 — 필요한 칸만 */
export type ArtifactDoc = {
  file: string
  artifactId: string
  sourceArticleId: string
  contract: { pipelineVersion?: unknown; promptVersion?: unknown; stageModels?: unknown }
  planPersonaCode: string | null
  voice: { personaCode?: unknown; bundleDigest?: unknown; sourceDigest?: unknown }
  draft: { title: string; body: string }
  review: unknown
}

/** 같은 회차 `candidates.json` 의 한 줄 — `sourceSite` 는 여기만 있다 */
export type CandidateDoc = {
  file: string
  artifactId: string
  sourceArticleId: string
  sourceSite: string
}

/** 사람이 결정한 큐 행 — 필요한 칸만 */
export type DecidedRow = {
  id: string
  decidedBy: string | null
  draftTitle: string
  draftBody: string
  gateVerdict: string
  gateResults: unknown
  editDiff: unknown
  declineReason: string | null
  rawSourceSite: string
  rawSourceArticleId: string
  sourceCapturedAt: Date | null
  /** 🔴 큐에 배정된 Persona code — 미배정 그림자는 null */
  matchedPersonaCode: string | null
}

export type RestoreResult = {
  id: string
  klass: RestoreClass
  /** 왜 그 분류인가 — 값으로 남긴다 */
  reasons: string[]
  artifactFile: string | null
}

const S = (v: unknown): string => (typeof v === 'string' ? v : '')
const autoDraftOf = (g: unknown): Record<string, unknown> => {
  if (g === null || typeof g !== 'object') return {}
  const a = (g as Record<string, unknown>).autoDraft
  return a !== null && typeof a === 'object' ? a as Record<string, unknown> : {}
}
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

/**
 * 🔴 **한 행을 복원한다.** 순서대로 본다 — 앞에서 걸리면 뒤는 보지 않는다.
 *    ① 열쇠가 있는가(missing) ② 정확히 한 장인가(ambiguous)
 *    ③ 출처가 같은가(provenanceMismatch) ④ 초안이 같은가(draftMismatch)
 *    ⑤ 의미 검수가 완전하고 경고가 없는가(warning / clean)
 */
export function restoreRow(
  row: DecidedRow,
  artifactsById: ReadonlyMap<string, readonly ArtifactDoc[]>,
  candidatesById: ReadonlyMap<string, readonly CandidateDoc[]>,
): RestoreResult {
  const ad = autoDraftOf(row.gateResults)
  const artifactId = S(ad.artifactId)
  const out = (klass: RestoreClass, reasons: string[], file: string | null = null): RestoreResult =>
    ({ id: row.id, klass, reasons, artifactFile: file })

  // ① 열쇠
  if (artifactId === '') return out('missing', ['행에 artifactId 가 없다 — 옛 판이다'])
  const arts = artifactsById.get(artifactId) ?? []
  const cands = candidatesById.get(artifactId) ?? []
  if (arts.length === 0) return out('missing', [`artifact ${artifactId} 가 정본 디렉터리에 없다`])
  // ② 정확히 한 장
  if (arts.length > 1) return out('ambiguous', [`artifact ${artifactId} 가 ${arts.length}장이다`])
  if (cands.length !== 1) {
    return out(cands.length === 0 ? 'missing' : 'ambiguous',
      [`candidates.json 의 ${artifactId} 가 ${cands.length}줄이다`], arts[0]!.file)
  }
  const a = arts[0]!
  const c = cands[0]!

  // ③ 출처 — 원천 · 사이트 · Persona · 말투 · 생성 계약
  const prov: string[] = []
  const base = baseArticleId(row.rawSourceArticleId)
  if (a.sourceArticleId !== base || S(ad.sourceArticleId) !== base || c.sourceArticleId !== base) {
    prov.push(`sourceArticleId — 원천 ${base} · 행 ${S(ad.sourceArticleId)} · artifact ${a.sourceArticleId} · 후보 ${c.sourceArticleId}`)
  }
  if (`${MACHINE_SITE_PREFIX}${c.sourceSite}` !== row.rawSourceSite) {
    prov.push(`sourceSite — 원천 ${row.rawSourceSite} · 후보 ${MACHINE_SITE_PREFIX}${c.sourceSite}`)
  }
  const rv = (ad.voice !== null && typeof ad.voice === 'object') ? ad.voice as Record<string, unknown> : {}
  for (const k of ['personaCode', 'bundleDigest', 'sourceDigest'] as const) {
    if (S(rv[k]) === '' || S(rv[k]) !== S(a.voice[k])) prov.push(`voice.${k} — 행 ${S(rv[k])} · artifact ${S(a.voice[k])}`)
  }
  /**
   * 🔴 **배정된 Persona 가 있으면 artifact 의 plan·voice Persona 와 같아야 한다** (2026-09-25 마스터 F).
   *    다른 사람의 말투로 쓴 글을 다른 사람이 낸 것이면, 그 artifact 의 판정은 이 글의 근거가 아니다.
   *    미배정(null) 그림자는 허용한다.
   */
  if (row.matchedPersonaCode !== null
    && (row.matchedPersonaCode !== a.planPersonaCode || row.matchedPersonaCode !== S(a.voice.personaCode))) {
    prov.push(`matchedPersona ${row.matchedPersonaCode} ≠ artifact plan ${String(a.planPersonaCode)} · voice ${S(a.voice.personaCode)}`)
  }
  if (a.planPersonaCode !== S(a.voice.personaCode)) {
    prov.push(`plan.personaCode ${String(a.planPersonaCode)} ≠ voice.personaCode ${S(a.voice.personaCode)}`)
  }
  if (S(ad.pipelineVersion) === '' || S(ad.pipelineVersion) !== S(a.contract.pipelineVersion)) {
    prov.push(`pipelineVersion — 행 ${S(ad.pipelineVersion)} · artifact ${S(a.contract.pipelineVersion)}`)
  }
  if (S(ad.draftPromptVersion) === '' || S(ad.draftPromptVersion) !== S(a.contract.promptVersion)) {
    prov.push(`promptVersion — 행 ${S(ad.draftPromptVersion)} · artifact ${S(a.contract.promptVersion)}`)
  }
  if (stable(ad.stageModels) !== stable(a.contract.stageModels)) prov.push('stageModels 가 다르다')
  if (prov.length > 0) return out('provenanceMismatch', prov, a.file)

  // ④ 초안 — 사람이 본 원래 초안(draft)이 그 artifact 가 만든 것인가
  const draft: string[] = []
  if (digestOf(row.draftTitle) !== digestOf(a.draft.title)) draft.push('draftTitle digest 가 다르다')
  if (digestOf(row.draftBody) !== digestOf(a.draft.body)) draft.push('draftBody digest 가 다르다')
  if (draft.length > 0) return out('draftMismatch', draft, a.file)

  // ⑤ 의미 검수 — artifact 정본에서 복원한 요약이 완전한가
  const summary = semanticSummaryOf(a.review)
  const sem = semanticIssues(summary)
  /**
   * 🔴 **복원한 요약으로 경고를 다시 낸다.** 저장된 gateResults 의 holds·blocks 는 그대로
   *    두고, 비어 있던 semanticReview 자리에만 artifact 정본의 요약을 넣는다.
   *    그래서 원래 경고는 하나도 사라지지 않는다.
   */
  const g = (row.gateResults !== null && typeof row.gateResults === 'object')
    ? row.gateResults as Record<string, unknown> : {}
  const restoredGate = { ...g, semanticReview: summary }
  const warnings = [...new Set([...sem.issues, ...warningsOfGate(restoredGate)])]
  const verdict = judgeRow({
    gateVerdict: row.gateVerdict, warnings,
    sourceCapturedKnown: row.sourceCapturedAt !== null,
    title: row.draftTitle, body: row.draftBody,
  })
  if (!verdict.auto) return out('warning', verdict.reasons, a.file)
  return out('clean', ['artifact 한 장 · 출처·초안·계약 일치 · 의미 검수 완전 · 경고 0'], a.file)
}

/**
 * 🔴 **옛 결과 표식(legacy)** — `editDiff` 의 수정 표식 · `declineReason` 으로 읽는다.
 *    출처를 증명하지 못하므로 **표본 계산에 쓰지 않는다**(검토 묶음에서 참고로만 보인다).
 */
export function legacyOutcomeOf(row: Pick<DecidedRow, 'editDiff' | 'declineReason'>): HumanOutcome {
  if ((row.declineReason ?? '').trim() !== '') return 'declined'
  return isHumanEditRecord(row.editDiff) ? 'edited' : 'noEdit'
}

/**
 * ── 🔴 **증거 검토 기록 v2 — 누가 무엇을 최종으로 확정했나** (2026-09-25 마스터 P0 ×2) ──
 *
 *    v1 은 두 가지가 틀렸다(격리 DB 에서 네 반례 모두 재현).
 *      ① 검토자가 **자기신고 문자열**이었다 — 파일에 `human:founder` 를 적으면 사람이 됐다.
 *      ② 사람 기록이 `hardDefect` 만 확정했다 — 무수정/수정/폐기는 출처 불명의 옛
 *         `editDiff`·`declineReason` 에서 다시 읽었고, 검토 뒤 수정본·폐기가 바뀌어도 표본이 남았다.
 *
 *    v2 는 **최종 결과를 기록 자체가 확정한다.**
 *      · `outcome` — noEdit | edited | declined
 *      · 원본 초안 digest + **최종 발행 문안 digest**(edited 면 수정본, 아니면 초안) + 폐기 사유
 *      · 검토 뒤 이 값 중 하나라도 DB 와 달라지면 그 기록은 **즉시 무효**다(표본에서 빠진다)
 *    🔴 사람 기록(`human:*`)은 **관리자 서버 경계만** 쓴다 — 로그인 세션으로 검토자와 사용자 id 를,
 *       서버 시계로 시각을 정한다. CLI importer 는 사람 기록을 만들지 못한다(`recordNonHumanReviews`).
 *    🔴 v1 기록은 읽지 않는다 — 출처를 증명하지 못한다.
 */
export const EVIDENCE_REVIEW_KEY = 'evidenceReviews'
export const EVIDENCE_REVIEW_CONTRACT = 'evidence-review-v2'

export type HumanOutcome = 'noEdit' | 'edited' | 'declined'

export type EvidenceReview = {
  contract: typeof EVIDENCE_REVIEW_CONTRACT
  reviewer: ReviewerKind
  /** 🔴 사람 기록이면 로그인 세션의 User.id — 서버가 채운다. 비사람 기록은 null */
  reviewerUserId: string | null
  outcome: HumanOutcome
  draftTitleDigest: string
  draftBodyDigest: string
  /** 🔴 최종 발행 문안 — edited 면 수정본, noEdit·declined 면 초안 */
  finalTitleDigest: string
  finalBodyDigest: string
  /** 🔴 declined 일 때만 값 — 그 밖은 null */
  declineReason: string | null
  hardDefect: 'yes' | 'no' | 'unmeasured'
  reasons: string[]
  bundleDigest: string
  /** 🔴 서버(또는 importer 프로세스) 시계 — 호출자가 넣은 값이 아니다 */
  reviewedAt: string
}

/** 결속을 재는 데 필요한 지금 행의 값 */
export type BoundRow = {
  status: string
  draftTitle: string
  draftBody: string
  editedTitle: string | null
  editedBody: string | null
  declineReason: string | null
}

/**
 * 🔴 **지금 행 상태에서 결과를 읽는다 — 옛 editDiff 표식을 믿지 않는다.**
 *    폐기 상태면 declined, 최종 문안이 초안과 다르면 edited, 같으면 noEdit.
 */
export function stateOutcomeOf(r: BoundRow): HumanOutcome {
  if (r.status === 'DECLINED') return 'declined'
  const t = r.editedTitle ?? r.draftTitle
  const b = r.editedBody ?? r.draftBody
  return t !== r.draftTitle || b !== r.draftBody ? 'edited' : 'noEdit'
}

/** 🔴 지금 상태 그대로의 결속 값 — 서버·importer 가 기록할 때 이 함수 하나로 만든다 */
export function bindingOf(r: BoundRow): Pick<EvidenceReview,
  'outcome' | 'draftTitleDigest' | 'draftBodyDigest' | 'finalTitleDigest' | 'finalBodyDigest' | 'declineReason'> {
  const outcome = stateOutcomeOf(r)
  return {
    outcome,
    draftTitleDigest: digestOf(r.draftTitle), draftBodyDigest: digestOf(r.draftBody),
    finalTitleDigest: digestOf(r.editedTitle ?? r.draftTitle), finalBodyDigest: digestOf(r.editedBody ?? r.draftBody),
    declineReason: outcome === 'declined' ? (r.declineReason ?? '') : null,
  }
}

/** 🔴 기록이 **지금 행**과 여전히 맞는가 — 하나라도 다르면 무효 */
export function bindingHolds(rec: EvidenceReview, r: BoundRow): boolean {
  const now = bindingOf(r)
  return rec.outcome === now.outcome
    && rec.draftTitleDigest === now.draftTitleDigest && rec.draftBodyDigest === now.draftBodyDigest
    && rec.finalTitleDigest === now.finalTitleDigest && rec.finalBodyDigest === now.finalBodyDigest
    && rec.declineReason === now.declineReason
}

const HEX64 = /^[0-9a-f]{64}$/

/** 🔴 모양이 v2 계약과 정확히 맞는 기록만 읽는다 — 하나라도 어긋나면 그 기록은 없는 것이다 */
export function readEvidenceReviews(editDiff: unknown): EvidenceReview[] {
  if (editDiff === null || typeof editDiff !== 'object' || Array.isArray(editDiff)) return []
  const arr = (editDiff as Record<string, unknown>)[EVIDENCE_REVIEW_KEY]
  if (!Array.isArray(arr)) return []
  const out: EvidenceReview[] = []
  for (const x of arr) {
    if (x === null || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    const reviewer = parseReviewerKind(r.reviewer)
    if (r.contract !== EVIDENCE_REVIEW_CONTRACT || reviewer === null) continue
    const human = isHumanReviewer(reviewer)
    if (human ? (typeof r.reviewerUserId !== 'string' || r.reviewerUserId === '') : r.reviewerUserId !== null) continue
    if (r.outcome !== 'noEdit' && r.outcome !== 'edited' && r.outcome !== 'declined') continue
    const hashes = [r.draftTitleDigest, r.draftBodyDigest, r.finalTitleDigest, r.finalBodyDigest, r.bundleDigest]
    if (!hashes.every((h) => typeof h === 'string' && HEX64.test(h))) continue
    if (r.outcome === 'declined' ? typeof r.declineReason !== 'string' || r.declineReason === '' : r.declineReason !== null) continue
    if (r.hardDefect !== 'yes' && r.hardDefect !== 'no' && r.hardDefect !== 'unmeasured') continue
    if (!Array.isArray(r.reasons) || !r.reasons.every((v) => typeof v === 'string')) continue
    if (typeof r.reviewedAt !== 'string' || Number.isNaN(Date.parse(r.reviewedAt))) continue
    out.push({
      contract: EVIDENCE_REVIEW_CONTRACT, reviewer, reviewerUserId: human ? r.reviewerUserId as string : null,
      outcome: r.outcome, draftTitleDigest: r.draftTitleDigest as string, draftBodyDigest: r.draftBodyDigest as string,
      finalTitleDigest: r.finalTitleDigest as string, finalBodyDigest: r.finalBodyDigest as string,
      declineReason: r.outcome === 'declined' ? r.declineReason as string : null,
      hardDefect: r.hardDefect, reasons: r.reasons as string[], bundleDigest: r.bundleDigest as string, reviewedAt: r.reviewedAt,
    })
  }
  return out
}

/**
 * 🔴 **사람 기록은 이력이다 — 덮지 않고 쌓는다.** 유효한 것은 **지금 결속에 맞는 기록 중
 *    사용자(reviewerUserId)별 마지막 하나**다.
 * 🔴 **최신의 정본은 append 순서다** (2026-09-26 마스터). `reviewedAt` 은 감사 표시용일 뿐이다 —
 *    나중에 붙은 기록의 시각이 더 과거여도 그 기록이 최신이다. 배열 순서는 `readEvidenceReviews` 가
 *    저장된 순서 그대로 보존한다.
 *    결속이 깨진 옛 기록은 남아 있지만 판정에 쓰이지 않는다 — 같은 사람이 새 상태를 다시 검토하면
 *    그 새 기록이 유효해진다.
 */
export function effectiveHumanReviews(bound: readonly EvidenceReview[]): EvidenceReview[] {
  const byUser = new Map<string, EvidenceReview>()
  for (const r of bound) byUser.set(r.reviewerUserId ?? '', r)
  return [...byUser.values()]
}

export type HumanSampleVerdict =
  | { counted: true; outcome: HumanOutcome; hardDefect: 'yes' | 'no' | 'unmeasured'; reviewers: ReviewerKind[] }
  | { counted: false; why: 'notHumanDecision' | 'noReview' | 'nonHumanOnly' | 'bindingBroken' }

/**
 * 🔴 **이 행이 사람 정답 표본인가.**
 *    ① 사람 결정 경로 표식(`decidedBy='founder'`)이 있다
 *    ② 서버 경계가 쓴 `human:*` v2 기록이 있다(사용자 id 포함)
 *    ③ 그 기록의 결속(초안·최종 문안·폐기 사유·결과)이 **지금 행과 같다**
 *    (결속이 맞는 기록의 결과는 언제나 지금 상태의 결과다 — 사람 기록끼리 결과가 갈릴 수 없다)
 *    ④ 사용자별 **최신** 기록만 쓴다(`effectiveHumanReviews`)
 *    결과는 **기록이 확정한 값**이다 — 행의 옛 editDiff·declineReason 을 다시 읽지 않는다.
 */
export function humanSampleOf(
  row: Pick<DecidedRow, 'decidedBy' | 'editDiff'> & BoundRow,
): HumanSampleVerdict {
  if ((row.decidedBy ?? '').trim() !== HUMAN_DECIDER) return { counted: false, why: 'notHumanDecision' }
  const all = readEvidenceReviews(row.editDiff)
  if (all.length === 0) return { counted: false, why: 'noReview' }
  const human = all.filter((r) => isHumanReviewer(r.reviewer))
  if (human.length === 0) return { counted: false, why: 'nonHumanOnly' }
  const bound = human.filter((r) => bindingHolds(r, row))
  if (bound.length === 0) return { counted: false, why: 'bindingBroken' }
  const latest = effectiveHumanReviews(bound)
  /**
   * 🔴 **사용자별 최신 판정을 모은다** (2026-09-25 마스터 P0).
   *    누군가 yes 면 yes · 아니면 누군가 no 면 no · 모두 미측정일 때만 unmeasured.
   *    앞판은 미측정 기록 하나가 다른 사람의 no 를 영원히 가렸다.
   */
  const hardDefect = latest.some((r) => r.hardDefect === 'yes') ? 'yes'
    : latest.some((r) => r.hardDefect === 'no') ? 'no' : 'unmeasured'
  return { counted: true, outcome: latest[0]!.outcome, hardDefect, reviewers: latest.map((r) => r.reviewer) }
}

export type CohortSample = {
  /** 사람 정답 표본 수 = 적격 표본 */
  eligible: number
  noEdit: number
  edited: number
  declined: number
  /** 무수정 ÷ 적격. 표본 0 이면 null — 0% 가 아니다 */
  noEditRate: number | null
  /** 표본 전부에 사람 판정이 있을 때만 값이다. 하나라도 unmeasured 면 null */
  hardDefects: number | null
  hardDefectUnmeasured: number
  /** 🔴 표본에서 뺀 행 — 사유별. 숨기지 않는다 */
  excluded: Record<Exclude<HumanSampleVerdict, { counted: true }>['why'], number>
  /** 계약을 채웠는가 — 낮추지 않는다 */
  meetsContract: boolean
  reasons: string[]
}

/**
 * 🔴 **증거 표본 — 서버가 인증한 사람 v2 기록만 센다.**
 *    결과(무수정/수정/폐기)도 그 기록에서 온다. 중대 결함은 표본 전부에서 잰다(미측정=닫힘).
 * 🔴 기준 30 · 90% · 0 은 `CONTRACT` 그대로다.
 */
export function cohortSampleOf(
  rows: readonly (Pick<DecidedRow, 'decidedBy' | 'editDiff'> & BoundRow)[],
): CohortSample {
  const excluded = { notHumanDecision: 0, noReview: 0, nonHumanOnly: 0, bindingBroken: 0 }
  const samples: { o: HumanOutcome; d: 'yes' | 'no' | 'unmeasured' }[] = []
  for (const r of rows) {
    const v = humanSampleOf(r)
    if (v.counted) samples.push({ o: v.outcome, d: v.hardDefect })
    else excluded[v.why] += 1
  }
  const noEdit = samples.filter((x) => x.o === 'noEdit').length
  const edited = samples.filter((x) => x.o === 'edited').length
  const declined = samples.filter((x) => x.o === 'declined').length
  const unmeasured = samples.filter((x) => x.d === 'unmeasured').length
  const hardDefects = unmeasured > 0 ? null : samples.filter((x) => x.d === 'yes').length
  const eligible = samples.length
  const noEditRate = eligible === 0 ? null : noEdit / eligible
  const reasons: string[] = []
  if (eligible < CONTRACT.reviewSampleMin) reasons.push(`적격 표본 ${eligible}/${CONTRACT.reviewSampleMin}`)
  if (noEditRate === null) reasons.push('무수정률을 잴 표본이 없다')
  else if (noEditRate < CONTRACT.noEditAccuracyMin) {
    reasons.push(`무수정률 ${(noEditRate * 100).toFixed(1)}% < ${(CONTRACT.noEditAccuracyMin * 100).toFixed(0)}%`)
  }
  if (hardDefects === null) reasons.push(`중대 결함 unmeasured ${unmeasured}건 — 0 으로 읽지 않는다`)
  else if (hardDefects > CONTRACT.hardDefectMax) reasons.push(`중대 결함 ${hardDefects}`)
  return {
    eligible, noEdit, edited, declined, noEditRate, hardDefects,
    hardDefectUnmeasured: unmeasured, excluded, meetsContract: reasons.length === 0, reasons,
  }
}
