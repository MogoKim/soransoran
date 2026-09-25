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
 * 🔴 **사람 결정의 결과** — 무수정 · 수정 · 폐기.
 *    `editDiff` 에 수정 기록(`bodyChanged`·`titleChanged` 가 true)이 있으면 수정이다.
 *    자동 도장 기록만 있는 editDiff 는 수정이 아니다.
 */
export type HumanOutcome = 'noEdit' | 'edited' | 'declined'
export function outcomeOf(row: Pick<DecidedRow, 'editDiff' | 'declineReason'>): HumanOutcome {
  if ((row.declineReason ?? '').trim() !== '') return 'declined'
  return isHumanEditRecord(row.editDiff) ? 'edited' : 'noEdit'
}

/**
 * ── 🔴 **증거 검토 기록 — 누가 이 초안을 보고 무엇이라 했나** (2026-09-25) ──
 *
 *    `editDiff.evidenceReviews` 에 **검토자 종류별로 한 줄**씩 남긴다(배치 검토 importer 가 쓴다).
 *    · `reviewer`     — `review-provenance` 의 닫힌 목록. 사람 종류만 정답 표본이 된다
 *    · 초안 digest    — 이 기록이 **바로 이 초안**에 대한 것인지 묶는다. 다르면 무효
 *    · `hardDefect`   — `yes`|`no`|`unmeasured`. 🔴 비어 있으면 `no` 가 아니라 `unmeasured` 다
 *    · `bundleDigest` — 어느 검토 묶음을 보고 판정했나
 */
export const EVIDENCE_REVIEW_KEY = 'evidenceReviews'
export const EVIDENCE_REVIEW_CONTRACT = 'evidence-review-v1'

export type EvidenceReview = {
  contract: typeof EVIDENCE_REVIEW_CONTRACT
  reviewer: ReviewerKind
  draftTitleDigest: string
  draftBodyDigest: string
  hardDefect: 'yes' | 'no' | 'unmeasured'
  reasons: string[]
  bundleDigest: string
  reviewedAt: string
}

const HEX64 = /^[0-9a-f]{64}$/

/** 🔴 모양이 계약과 정확히 맞는 기록만 읽는다 — 하나라도 어긋나면 그 기록은 없는 것이다 */
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
    if (typeof r.draftTitleDigest !== 'string' || !HEX64.test(r.draftTitleDigest)) continue
    if (typeof r.draftBodyDigest !== 'string' || !HEX64.test(r.draftBodyDigest)) continue
    if (r.hardDefect !== 'yes' && r.hardDefect !== 'no' && r.hardDefect !== 'unmeasured') continue
    if (!Array.isArray(r.reasons) || !r.reasons.every((v) => typeof v === 'string')) continue
    if (typeof r.bundleDigest !== 'string' || !HEX64.test(r.bundleDigest)) continue
    if (typeof r.reviewedAt !== 'string' || Number.isNaN(Date.parse(r.reviewedAt))) continue
    out.push({
      contract: EVIDENCE_REVIEW_CONTRACT, reviewer, draftTitleDigest: r.draftTitleDigest,
      draftBodyDigest: r.draftBodyDigest, hardDefect: r.hardDefect, reasons: r.reasons as string[],
      bundleDigest: r.bundleDigest, reviewedAt: r.reviewedAt,
    })
  }
  return out
}

export type HumanSampleVerdict =
  | { counted: true; hardDefect: 'yes' | 'no' | 'unmeasured'; reviewers: ReviewerKind[] }
  | { counted: false; why: 'notHumanDecision' | 'noReview' | 'nonHumanOnly' | 'draftMismatch' }

/**
 * 🔴 **이 행이 사람 정답 표본인가.** 셋 다 참이어야 한다:
 *    ① 사람 결정 경로의 표식(`decidedBy='founder'`)이 있다 — 기계·자동 결정 행이 아니다
 *    ② `human:*` 검토 기록이 **이 초안**(제목·본문 digest)에 묶여 있다
 *    ③ (없으면) Codex·Claude·모델 기록만 있는 행은 운영 근거일 수는 있어도 **표본이 아니다**
 *    중대 결함은 사람 기록에서만 읽는다 — 하나라도 yes 면 yes, 아니면 하나라도 미측정이면 미측정.
 */
export function humanSampleOf(
  row: Pick<DecidedRow, 'decidedBy' | 'editDiff' | 'draftTitle' | 'draftBody'>,
): HumanSampleVerdict {
  if ((row.decidedBy ?? '').trim() !== HUMAN_DECIDER) return { counted: false, why: 'notHumanDecision' }
  const all = readEvidenceReviews(row.editDiff)
  if (all.length === 0) return { counted: false, why: 'noReview' }
  const human = all.filter((r) => isHumanReviewer(r.reviewer))
  if (human.length === 0) return { counted: false, why: 'nonHumanOnly' }
  const t = digestOf(row.draftTitle)
  const b = digestOf(row.draftBody)
  const bound = human.filter((r) => r.draftTitleDigest === t && r.draftBodyDigest === b)
  if (bound.length === 0) return { counted: false, why: 'draftMismatch' }
  const hardDefect = bound.some((r) => r.hardDefect === 'yes') ? 'yes'
    : bound.some((r) => r.hardDefect === 'unmeasured') ? 'unmeasured' : 'no'
  return { counted: true, hardDefect, reviewers: bound.map((r) => r.reviewer) }
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
 * 🔴 **증거 표본 — 사람 정답만 센다** (2026-09-25 개정).
 *    앞판은 `decidedBy='founder'` 이기만 하면 사람 표본으로 셌다. 그 값은 실행자와 무관하게
 *    써진다(founder 위장). 이제 `humanSampleOf` 가 사람 검토 기록을 요구한다.
 * 🔴 **중대 결함은 표본 전부에서 잰다** — 앞판은 수정·폐기 행만 요구해, 무수정 행은
 *    판정 없이 "결함 없음" 으로 읽혔다. 사람 판정이 없으면 unmeasured 이고 게이트는 닫힌다.
 * 🔴 기준 30 · 90% · 0 은 `CONTRACT` 그대로다.
 */
export function cohortSampleOf(
  rows: readonly Pick<DecidedRow, 'decidedBy' | 'editDiff' | 'declineReason' | 'draftTitle' | 'draftBody'>[],
): CohortSample {
  const excluded = { notHumanDecision: 0, noReview: 0, nonHumanOnly: 0, draftMismatch: 0 }
  const samples: { o: HumanOutcome; d: 'yes' | 'no' | 'unmeasured' }[] = []
  for (const r of rows) {
    const v = humanSampleOf(r)
    if (v.counted) samples.push({ o: outcomeOf(r), d: v.hardDefect })
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
