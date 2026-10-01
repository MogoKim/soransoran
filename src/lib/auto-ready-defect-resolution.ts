/**
 * 🔴 **확정 결함의 해소 판정 — 자동 READY 열림의 결함 축 정본** (2026-10-01 · Lane E)
 *
 *   앞판은 `AutoReadyAudit.defect='yes'` 행을 **전 기간 · 전 계약**에서 셌다(`confirmedDefectCount`).
 *   그 행은 지우지도 고치지도 않으므로(끈적한 yes) 한 번 생긴 결함은 게이트를 **영원히** 닫았다 —
 *   그 결함을 통과시킨 게이트를 고친 새 품질 계약(quality-v6)이 나와도 열 길이 없었다.
 *
 *   이제 결함 축은 **"지금 품질 계약에 대해 해소되지 않은 확정 결함"** 하나다(`unresolvedDefectCount`).
 *   결함이 해소됐다고 보는 길은 **이 파일의 판정 하나**뿐이고, 아래를 **전부** 만족해야 한다.
 *
 *   ① 감사 행 — `defect='yes'` · 감사자가 기계 의미 감사(`model:semantic-audit…`) · note 머리가 `outcome=measured`
 *      (무결성 yes · 사람 신고 · 측정 못 한 감사는 초안 게이트로 해소할 대상이 아니다 → 언제나 미해소)
 *   ② 대상 큐 행 — 감사 행의 큐·글과 같은 행이고, **지금 품질 계약 행이 아니다**(legacy).
 *      🔴 지금 계약 행의 결함은 지금 게이트가 놓친 결함이다 — 어떤 기록으로도 해소되지 않는다
 *   ③ 해소 기록 — 큐 행 `editDiff[DEFECT_RESOLUTION_KEY]`(덧붙이기만 하는 배열)에 이 판정이 읽는 모양 그대로:
 *      · 기록 판 · **지금 품질 계약 판 + digest**(다른 판 · 다른 digest → 무효)
 *      · 감사 행 id(queueId) · 글 id · **감사 행 전체 지문**(감사 행이 한 칸이라도 바뀌면 무효)
 *      · 저장된 초안 제목·본문 hash = 지금 큐 초안 = 감사가 묶은 발행 글 hash
 *      · 재검증 — 지금 초안 게이트 판(`DRAFT_GATE_VERSION`)으로 그 초안을 다시 돌려 **확정 차단**(failures ≥ 1)
 *   하나라도 어긋나거나 모양이 깨졌으면 **미해소**다(fail-closed). 다른 행의 기록은 이 결함을 해소하지 못한다.
 *
 * 🔴 감사 행을 고치거나 지우지 않는다 — 기록은 큐 행에 덧붙인다(원래 결함 기록은 그대로 남는다).
 * 🔴 기록을 쓰는 길은 `auto-ready-defect-resolution-store` 하나다 — 같은 트랜잭션에서 게이트를 다시 돌린 뒤에만 쓴다.
 * 🔴 순수하다. DB · 파일 · 네트워크 없음.
 */
import { createHash } from 'node:crypto'

import { digestOf } from './auto-ready-v2'
import { DRAFT_GATE_CODES, DRAFT_GATE_VERSION } from './content-core/draft-life-gates'
import { SEMANTIC_AUDITOR, SEMANTIC_AUDIT_CONTRACT_VERSION } from './auto-ready-semantic-audit'
import { isCurrentQualityContract, type QualityContractMark } from './quality-contract'

/** 🔴 큐 행 `editDiff` 안의 칸 — 해소 기록 배열(덧붙이기만 한다) */
export const DEFECT_RESOLUTION_KEY = 'autoReadyDefectResolutions'
/** 🔴 기록 판 — 품질 계약 digest 구성에 들어간다(판정 규칙이 바뀌면 digest 가 바뀌어 옛 기록이 무효가 된다) */
export const DEFECT_RESOLUTION_RECORD_VERSION = 'defect-resolution-v1'
/** 🔴 기록한 쪽 — 사람이 아니다. 재검증을 돌린 저장 경계다 */
export const DEFECT_RESOLVER = 'system:defect-resolution'

/** 🔴 감사 행 — 지문에 들어가는 칸 전부(스키마의 칸 그대로) */
export type AuditRowForResolution = {
  queueId: string
  postId: string
  selectedAtN: number
  selectedTarget: number
  selectedAt: Date
  publishedTitleHash: string
  publishedBodyHash: string
  stampContractDigest: string
  defect: string | null
  judgedAt: Date | null
  auditor: string | null
  note: string | null
  auditContractVersion: string | null
  auditModel: string | null
  auditPromptVersion: string | null
}

export type QueueRowForResolution = {
  id: string
  createdPostId: string | null
  draftTitle: string
  draftBody: string
  gateResults: unknown
  editDiff: unknown
}

export type DefectResolutionRecord = {
  recordVersion: string
  qualityContract: QualityContractMark
  audit: { queueId: string; postId: string; fingerprint: string }
  draft: { titleHash: string; bodyHash: string }
  reverify: {
    gateVersion: string
    outcome: 'blocked'
    failureCodes: string[]
    reviewCodes: string[]
    /** 🔴 재검증에 넣은 계획·카드·원천·시각의 지문 — 글자는 싣지 않는다 */
    inputDigest: string
    artifactId: string
  }
  resolvedAt: string
  resolvedBy: string
}

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

/** 🔴 감사 행 전체 지문 — 한 칸이라도 바뀌면 달라진다(시각은 ISO 로) */
export function auditFingerprintOf(a: AuditRowForResolution): string {
  const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString())
  return createHash('sha256').update(stableJson({
    queueId: a.queueId, postId: a.postId, selectedAtN: a.selectedAtN, selectedTarget: a.selectedTarget,
    selectedAt: iso(a.selectedAt), publishedTitleHash: a.publishedTitleHash, publishedBodyHash: a.publishedBodyHash,
    stampContractDigest: a.stampContractDigest, defect: a.defect, judgedAt: iso(a.judgedAt), auditor: a.auditor,
    note: a.note, auditContractVersion: a.auditContractVersion, auditModel: a.auditModel, auditPromptVersion: a.auditPromptVersion,
  }), 'utf8').digest('hex')
}

/** 🔴 재검증 입력 지문 — 계획 · 카드 · 원천 · 판정 시각 */
export function reverifyInputDigestOf(input: unknown): string {
  return createHash('sha256').update(stableJson(input), 'utf8').digest('hex')
}

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const HEX64 = /^[0-9a-f]{64}$/
const GATE_CODES: ReadonlySet<string> = new Set(DRAFT_GATE_CODES)

/**
 * 🔴 **해소 대상이 될 수 있는 결함인가** — 기록과 무관한 전제. 아니면 어떤 기록으로도 해소되지 않는다.
 *    `null` 이면 대상이다. 문자열이면 왜 아닌지다.
 */
export function resolvableDefectProblem(a: AuditRowForResolution, q: QueueRowForResolution | null): string | null {
  if (a.defect !== 'yes') return '확정 결함(yes)이 아니다'
  const auditor = (a.auditor ?? '').trim()
  if (auditor !== SEMANTIC_AUDITOR && !auditor.startsWith(`${SEMANTIC_AUDITOR}:`)) {
    return `감사자 ${auditor || '(없음)'} — 기계 의미 감사 결함만 초안 게이트 재검증으로 해소한다(무결성 · 사람 신고는 해소 대상이 아니다)`
  }
  if (!(a.note ?? '').startsWith(`[${SEMANTIC_AUDIT_CONTRACT_VERSION} outcome=measured `)) {
    return '의미 감사가 측정한 결함이 아니다(note 머리가 outcome=measured 가 아니다)'
  }
  if (q === null) return '감사 대상 큐 행이 없다'
  if (q.id !== a.queueId) return '큐 행이 감사 행의 큐가 아니다'
  if (q.createdPostId !== a.postId) return '큐 행이 가리키는 글이 감사 대상 글이 아니다'
  if (isCurrentQualityContract(q.gateResults)) return '🔴 지금 품질 계약 행의 결함이다 — 지금 게이트가 놓친 결함은 해소되지 않는다'
  if (digestOf(q.draftTitle) !== a.publishedTitleHash || digestOf(q.draftBody) !== a.publishedBodyHash) {
    return '저장된 초안이 감사가 묶은 발행 글과 다르다'
  }
  return null
}

/** 🔴 기록 한 줄의 모양 — 하나라도 어긋나면 `null`(없는 것과 같다) */
export function readResolutionRecord(v: unknown): DefectResolutionRecord | null {
  const r = rec(v)
  const qc = rec(r.qualityContract)
  const au = rec(r.audit)
  const dr = rec(r.draft)
  const rv = rec(r.reverify)
  const str = (x: unknown): x is string => typeof x === 'string' && x !== ''
  const strArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((y) => typeof y === 'string')
  if (!str(r.recordVersion) || !str(qc.version) || !str(qc.digest) || !str(au.queueId) || !str(au.postId)
    || !str(au.fingerprint) || !str(dr.titleHash) || !str(dr.bodyHash) || !str(rv.gateVersion) || rv.outcome !== 'blocked'
    || !strArr(rv.failureCodes) || !strArr(rv.reviewCodes) || !str(rv.inputDigest) || !str(rv.artifactId)
    || !str(r.resolvedAt) || !str(r.resolvedBy)) return null
  return {
    recordVersion: r.recordVersion, qualityContract: { version: qc.version, digest: qc.digest },
    audit: { queueId: au.queueId, postId: au.postId, fingerprint: au.fingerprint },
    draft: { titleHash: dr.titleHash, bodyHash: dr.bodyHash },
    reverify: {
      gateVersion: rv.gateVersion, outcome: 'blocked', failureCodes: [...rv.failureCodes], reviewCodes: [...rv.reviewCodes],
      inputDigest: rv.inputDigest, artifactId: rv.artifactId,
    },
    resolvedAt: r.resolvedAt, resolvedBy: r.resolvedBy,
  }
}

/** 🔴 큐 행에 남은 해소 기록 전부(모양이 깨진 줄도 그대로 — 판정이 거른다) */
export function resolutionEntriesOf(editDiff: unknown): unknown[] {
  const arr = rec(editDiff)[DEFECT_RESOLUTION_KEY]
  return Array.isArray(arr) ? arr : []
}

/**
 * 🔴 **기록 한 줄이 이 결함을 지금 계약에서 해소하는가.** `null` 이면 해소, 문자열이면 왜 아닌지다.
 */
export function recordProblem(
  r: DefectResolutionRecord, a: AuditRowForResolution, q: QueueRowForResolution, contract: QualityContractMark,
): string | null {
  if (r.recordVersion !== DEFECT_RESOLUTION_RECORD_VERSION) return `기록 판 ${r.recordVersion}`
  if (r.resolvedBy !== DEFECT_RESOLVER) return `기록한 쪽 ${r.resolvedBy}`
  if (r.qualityContract.version !== contract.version) return `품질 계약 판 ${r.qualityContract.version} ≠ 지금 ${contract.version}`
  if (r.qualityContract.digest !== contract.digest) return '품질 계약 digest 가 지금과 다르다'
  if (r.audit.queueId !== a.queueId || r.audit.postId !== a.postId) return '다른 감사 행 · 다른 글의 기록이다'
  if (r.audit.fingerprint !== auditFingerprintOf(a)) return '기록 뒤 감사 행이 바뀌었다(지문 불일치)'
  if (r.draft.titleHash !== digestOf(q.draftTitle) || r.draft.bodyHash !== digestOf(q.draftBody)) return '기록의 초안 hash 가 지금 초안과 다르다'
  if (r.draft.titleHash !== a.publishedTitleHash || r.draft.bodyHash !== a.publishedBodyHash) return '기록의 초안 hash 가 감사가 묶은 발행 글과 다르다'
  if (r.reverify.gateVersion !== DRAFT_GATE_VERSION) return `재검증 게이트 판 ${r.reverify.gateVersion} ≠ 지금 ${DRAFT_GATE_VERSION}`
  if (r.reverify.failureCodes.length === 0) return '재검증이 확정 차단하지 않았다'
  if (!r.reverify.failureCodes.every((c) => GATE_CODES.has(c))) return '재검증 차단 코드가 지금 게이트 코드가 아니다'
  if (!HEX64.test(r.reverify.inputDigest)) return '재검증 입력 지문 모양이 깨졌다'
  return null
}

export type ResolutionJudgment = { resolved: boolean; reason: string }

/**
 * 🔴 **정본 — 이 확정 결함이 지금 품질 계약에서 해소됐는가.** 전제(`resolvableDefectProblem`)를 먼저 보고,
 *    큐 행의 기록 중 **하나라도** 지금 계약에 맞으면 해소다. 아니면 미해소(fail-closed).
 */
export function judgeDefectResolution(
  a: AuditRowForResolution, q: QueueRowForResolution | null, contract: QualityContractMark,
): ResolutionJudgment {
  const pre = resolvableDefectProblem(a, q)
  if (pre !== null) return { resolved: false, reason: pre }
  const entries = resolutionEntriesOf(q!.editDiff)
  if (entries.length === 0) return { resolved: false, reason: '해소 기록이 없다' }
  const problems: string[] = []
  for (const e of entries) {
    const r = readResolutionRecord(e)
    if (r === null) { problems.push('기록 모양이 깨졌다'); continue }
    const p = recordProblem(r, a, q!, contract)
    if (p === null) return { resolved: true, reason: `지금 계약 재검증 차단 ${r.reverify.failureCodes.join(',')}` }
    problems.push(p)
  }
  return { resolved: false, reason: problems.join(' · ') }
}
