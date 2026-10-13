/**
 * 🔴 **품질 계약 전환 판정 — 배포 전에 target 계약의 결함 축을 센다** (2026-10-13 · PR #710 보정)
 *
 *   왜 있나 — 해소 기록은 **그 기록을 쓴 품질 계약 판·digest** 에만 묶인다(`recordProblem`). 운영이 v7 에서 쓴
 *   해소 기록은 v8 코드가 읽으면 무효다. 그래서 v7 → v8 배포는 운영 DB 를 한 글자도 바꾸지 않았는데도
 *   **미해소 확정 결함이 0 → 1** 이 되어 자동 READY 가 닫힐 수 있다(Batch B 배포에서 실제로 일어났다).
 *
 *   이 파일은 **배포 전에** 같은 DB 를 두 계약으로 센다:
 *     · runtime — 지금 돌고 있는 코드의 계약(배포가 runtime 트리에서 읽어 넘긴다)
 *     · target  — 배포하려는 코드의 계약(이 파일을 부르는 코드 자신의 `currentQualityContract`)
 *   🔴 **PASS 는 target 미해소 0 이고, runtime 미해소가 0 이거나 전부 승계됐을 때뿐이다.** 승인으로 여는 길은 없다.
 *
 *   🔴 **승계(succession · contract-transition-v3 · 2026-10-13 마스터 결정)** — 무시 · waiver 가 아니다. 옛 계약의 결함을
 *      새 계약의 공식 해소가 **인수**한다. v7 자기 계약 행의 결함은 v7 코드에서 어떤 기록으로도 해소되지 않으므로(정본 전제),
 *      그 결함이 남는 한 "v7=0" 은 영원히 오지 않는다. 그래서 아래를 **전부** 만족할 때만 그 결함을 넘긴다:
 *        ① 그 결함의 큐 행이 runtime(v7) 계약 자신의 행이다 — 다른 유형의 v7 미해소가 하나라도 있으면 BLOCK
 *        ② 그 행에 target(v8) 판 · digest 의 공식 해소 기록이 **정확히 하나** 정본 규칙(`recordProblem`)을 통과한다 —
 *           그 기록은 v8 초안 게이트의 재검증 차단(failureCodes ≥ 1)을 담는다 = v8 고정 반례가 그 결함을 발행 전에 막는다
 *        ③ 다른 결함을 가리키는 v8 기록 · 같은 기록의 중복 연결이 없다
 *        ④ 연결 집합의 digest 가 stage 가 남긴 집합과 같다(activate 직전 · checkout 뒤 두 번) — 새 결함 · 바뀐 연결은 BLOCK
 *      범용 force · bypass · 승인 플래그는 없다. activate 전까지 v7 자동 lane 은 그대로 닫혀 있다(v7 미해소는 그대로 센다).
 *   target 미해소를 없애는 길은 하나 — target 을 staging 트리에 준비하고, 옛 runtime·job 을 그대로 둔 채
 *   공식 `auto-ready:defect-resolve --apply --production --staged` 로 새 계약 기록을 **활성화 전에** 덧붙인 뒤
 *   다시 재는 것이다. 공식 dry-run 이 계획을 못 내는 결함이면 그 배포는 BLOCK 이다.
 *   이 판정은 쓰지 않는다 — 계획(digest)은 운영자가 공식 경로를 부를 수 있게 보여 줄 뿐이다.
 *
 * 🔴 판정 정본(`auto-ready-defect-resolution.ts`)은 품질 계약 지문 대상이라 고치지 않는다 — 그 위에 얹는다.
 *    정본 전제(`resolvableDefectProblem`)는 "지금 계약 행인가" 를 **코드 상수**로 본다. 다른 계약으로 셀 때는
 *    그 계약 자신의 행을 여기서 먼저 미해소로 둔다 — 정본이 그 계약의 코드에서 내는 답과 같다.
 * 🔴 순수하다. DB · 파일 · 네트워크 없음. 출력할 값은 판 · digest · 건수 · 코드 · 큐 id 뿐이다(글자 0).
 */
import { createHash } from 'node:crypto'

import {
  DEFECT_RESOLUTION_KEY, auditFingerprintOf, judgeDefectResolution, readResolutionRecord, recordProblem, resolutionEntriesOf,
  type AuditRowForResolution, type QueueRowForResolution,
} from '../../src/lib/auto-ready-defect-resolution'
import { readQualityContract, type QualityContractMark } from '../../src/lib/quality-contract'

/**
 * 🔴 v2 (2026-10-13) — 승인 통과 경로를 없앴다.
 * 🔴 v3 (같은 날 · 마스터 결정) — v7 자기 계약 결함의 **승계**: 정확한 1:1 v8 공식 해소 · stage 집합 digest 대조
 */
export const CONTRACT_TRANSITION_VERSION = 'contract-transition-v3'

const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))
const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const sameMark = (a: QualityContractMark, b: QualityContractMark): boolean => a.version === b.version && a.digest === b.digest

/** 🔴 `<판>:<digest 64>` — 모양이 하나라도 어긋나면 `null` */
export function parseContractMark(s: string): QualityContractMark | null {
  const m = /^([A-Za-z0-9._-]+):([0-9a-f]{64})$/.exec(s.trim())
  return m === null ? null : { version: m[1]!, digest: m[2]! }
}
export const markText = (m: QualityContractMark): string => `${m.version}:${m.digest}`

/** 🔴 이 결함이 **그 계약에서** 해소됐는가 — 그 계약 자신의 행이면 언제나 미해소다 */
export function resolvedUnder(a: AuditRowForResolution, q: QueueRowForResolution | null, mark: QualityContractMark): boolean {
  const own = q === null ? null : readQualityContract(q.gateResults)
  if (own !== null && sameMark(own, mark)) return false
  return judgeDefectResolution(a, q, mark).resolved
}

/** 🔴 그 계약에서 미해소인 확정 결함의 큐 id — 오름차순 */
export function unresolvedUnder(
  audits: readonly AuditRowForResolution[], queues: ReadonlyMap<string, QueueRowForResolution>, mark: QualityContractMark,
): string[] {
  return audits
    .filter((a) => a.defect === 'yes')
    .filter((a) => !resolvedUnder(a, queues.get(a.queueId) ?? null, mark))
    .map((a) => a.queueId)
    .sort()
}

/** 🔴 target 코드로 낸 공식 dry-run 계획 한 건 — `planDefectResolution` 의 결과를 그대로 옮긴 것 */
export type PlanObservation =
  | { queueId: string; kind: 'plan'; digest: string; record: unknown }
  | { queueId: string; kind: 'already' }
  | { queueId: string; kind: 'refuse'; code: string }

export const TRANSITION_VERDICTS = ['PASS', 'BLOCK'] as const
export type TransitionVerdict = (typeof TRANSITION_VERDICTS)[number]

export type TransitionResult = {
  verdict: TransitionVerdict
  /** 🔴 PASS 는 NO_UNRESOLVED 하나다 */
  code: 'NO_UNRESOLVED' | 'SUCCESSION' | 'TARGET_UNRESOLVED' | 'SUCCESSION_BROKEN' | 'SUCCESSION_DIGEST_MISMATCH' | 'SUCCESSION_NOT_STAGED'
  runtime: QualityContractMark
  target: QualityContractMark
  /** 🔴 같은 판·같은 digest 면 전환이 아니다 — 그래도 미해소는 그대로 막는다 */
  transition: boolean
  runtimeUnresolved: string[]
  targetUnresolved: string[]
  /** 🔴 target 미해소마다 공식 dry-run 이 낸 것 — 계획이면 staging 트리에서 공식 해소를 부를 수 있다 · 아니면 활성화 전에 해소할 수 없다 */
  plans: { queueId: string; kind: PlanObservation['kind']; digest: string | null; code: string | null }[]
  /** 🔴 공식 계획을 전부 덧붙였다고 셌을 때 남는 미해소 — 0 이 아니면 staging 해소로도 열 수 없다(보여 주기만 한다) */
  afterPlans: { target: number; runtime: number }
  /** 🔴 승계 연결 — runtime 미해소 결함마다 그것을 인수한 target 공식 기록 하나 */
  succession: SuccessionLink[]
  /** 🔴 승계 집합 digest — stage 가 남기고 activate 가 대조한다(빈 집합도 digest 가 있다) */
  successionDigest: string
  problems: string[]
}

export type SuccessionLink = { queueId: string; auditFingerprint: string; recordDigest: string; failureCodes: string[] }
export type SuccessionProblem = { queueId: string; code: 'NOT_OWN_CONTRACT' | 'NO_QUEUE' | 'UNLINKED' | 'DUPLICATE' | 'FOREIGN_LINK'; detail: string }

const sha = (v: unknown): string => createHash('sha256').update(stableJson(v), 'utf8').digest('hex')

/**
 * 🔴 **승계 연결을 센다** — runtime 미해소 결함마다 정확히 하나의 target 공식 기록이 그것을 인수했는가.
 *    판정은 정본 `recordProblem` 을 그대로 부른다(같은 감사 행 지문 · 같은 초안 hash · 지금 게이트 판의 재검증 차단).
 */
export function successionOf(i: {
  runtime: QualityContractMark; target: QualityContractMark
  audits: readonly AuditRowForResolution[]; queues: ReadonlyMap<string, QueueRowForResolution>
  runtimeUnresolved: readonly string[]
}): { links: SuccessionLink[]; problems: SuccessionProblem[] } {
  const links: SuccessionLink[] = []
  const problems: SuccessionProblem[] = []
  for (const id of i.runtimeUnresolved) {
    const a = i.audits.find((x) => x.queueId === id)
    const q = i.queues.get(id) ?? null
    if (a === undefined || q === null) { problems.push({ queueId: id, code: 'NO_QUEUE', detail: '감사 행 또는 큐 행이 없다' }); continue }
    const own = readQualityContract(q.gateResults)
    if (own === null || !sameMark(own, i.runtime)) {
      problems.push({ queueId: id, code: 'NOT_OWN_CONTRACT', detail: `runtime 계약 자신의 행이 아니다(${own?.version ?? '표식 없음'}) — 다른 유형의 미해소는 승계하지 않는다` })
      continue
    }
    const targetRecs = resolutionEntriesOf(q.editDiff).map(readResolutionRecord)
      .filter((r): r is NonNullable<typeof r> => r !== null && sameMark(r.qualityContract, i.target))
    const foreign = targetRecs.filter((r) => r.audit.queueId !== a.queueId || r.audit.postId !== a.postId)
    const ownRecs = targetRecs.filter((r) => r.audit.queueId === a.queueId && r.audit.postId === a.postId)
    if (foreign.length > 0) problems.push({ queueId: id, code: 'FOREIGN_LINK', detail: `다른 결함을 가리키는 target 기록 ${foreign.length}줄` })
    // 🔴 1:1 — 이 결함을 가리키는 target 판 기록은 유효 여부와 무관하게 **정확히 하나**다(깨진 줄이 섞여도 중복 연결이다)
    if (ownRecs.length > 1) problems.push({ queueId: id, code: 'DUPLICATE', detail: `이 결함을 가리키는 target 기록 ${ownRecs.length}줄 — 정확히 하나여야 한다` })
    const only = ownRecs.length === 1 ? ownRecs[0]! : null
    const why = only === null ? 'target 공식 해소 기록이 없다' : recordProblem(only, a, q, i.target)
    if (ownRecs.length <= 1 && why !== null) problems.push({ queueId: id, code: 'UNLINKED', detail: `${why} — 정본 규칙을 통과하는 target 기록이 아니다` })
    if (foreign.length > 0 || only === null || why !== null) continue
    const r = only
    links.push({ queueId: id, auditFingerprint: auditFingerprintOf(a), recordDigest: sha(r), failureCodes: [...r.reverify.failureCodes] })
  }
  // 🔴 같은 기록이 두 결함에 걸리면 중복 연결이다(기록 안의 감사 지문이 둘 다와 맞을 수는 없지만 모양으로 한 번 더 막는다)
  const seen = new Map<string, string>()
  for (const l of links) {
    const prev = seen.get(l.recordDigest)
    if (prev !== undefined) problems.push({ queueId: l.queueId, code: 'DUPLICATE', detail: `같은 target 기록이 ${prev} 에도 연결됐다` })
    seen.set(l.recordDigest, l.queueId)
  }
  return { links: problems.length === 0 ? links : [], problems }
}

export function successionDigestOf(runtime: QualityContractMark, target: QualityContractMark, links: readonly SuccessionLink[]): string {
  return sha({ v: CONTRACT_TRANSITION_VERSION, runtime, target, links: [...links].sort((x, y) => x.queueId.localeCompare(y.queueId)) })
}

/**
 * 🔴 **정본 — 이 DB 상태에서 target 계약을 활성화해도 결함 축이 닫히지 않는가.**
 *    runtime 미해소 0 · target 미해소 0 일 때만 PASS 다. 승인 · 계획 존재로 열지 않는다.
 */
export function judgeTransition(i: {
  runtime: QualityContractMark
  target: QualityContractMark
  audits: readonly AuditRowForResolution[]
  queues: ReadonlyMap<string, QueueRowForResolution>
  plans: readonly PlanObservation[]
  /**
   * 🔴 activate 쪽 대조 — stage 가 남긴 승계 집합 digest. `undefined` 면 대조하지 않는다(stage 가 재는 자리).
   *    `null` 이면 stage 기록이 없다 → BLOCK. 사람이 넣는 값이 아니다 — 배포가 stage 파일에서 읽어 넘긴다.
   */
  stagedSuccession?: string | null
}): TransitionResult {
  const runtimeUnresolved = unresolvedUnder(i.audits, i.queues, i.runtime)
  const targetUnresolved = unresolvedUnder(i.audits, i.queues, i.target)
  const planOf = new Map(i.plans.map((p) => [p.queueId, p]))
  const plans = targetUnresolved.map((id) => {
    const p = planOf.get(id)
    return p === undefined ? { queueId: id, kind: 'refuse' as const, digest: null, code: 'NOT_OBSERVED' }
      : p.kind === 'plan' ? { queueId: id, kind: p.kind, digest: p.digest, code: null }
        : { queueId: id, kind: p.kind, digest: null, code: p.kind === 'refuse' ? p.code : 'ALREADY_UNDER_PLAN' }
  })
  // 🔴 공식 계획 기록을 덧붙였다고 센다 — 쓰지 않는다. 운영자에게 "staging 해소로 열 수 있는가" 를 보여 줄 뿐이다
  const simulated = new Map(i.queues)
  for (const id of targetUnresolved) {
    const p = planOf.get(id)
    const q = simulated.get(id)
    if (p?.kind !== 'plan' || q === undefined) continue
    const m = rec(rec(p.record).qualityContract)
    if (m.version !== i.target.version || m.digest !== i.target.digest) continue
    simulated.set(id, { ...q, editDiff: { ...rec(q.editDiff), [DEFECT_RESOLUTION_KEY]: [...resolutionEntriesOf(q.editDiff), p.record] } })
  }
  const afterPlans = {
    target: unresolvedUnder(i.audits, simulated, i.target).length,
    runtime: unresolvedUnder(i.audits, simulated, i.runtime).length,
  }
  const succ = successionOf({ runtime: i.runtime, target: i.target, audits: i.audits, queues: i.queues, runtimeUnresolved })
  const successionDigest = successionDigestOf(i.runtime, i.target, succ.links)
  const base = {
    runtime: i.runtime, target: i.target, transition: !sameMark(i.runtime, i.target), runtimeUnresolved, targetUnresolved, plans, afterPlans,
    succession: succ.links, successionDigest,
  }
  const block = (code: TransitionResult['code'], problems: string[]): TransitionResult => ({ ...base, verdict: 'BLOCK', code, problems })
  if (targetUnresolved.length > 0) {
    const unplannable = plans.filter((p) => p.kind !== 'plan').length
    return block('TARGET_UNRESOLVED', [
      `target 계약 미해소 ${targetUnresolved.length} — 활성화 전에 staging 트리에서 공식 해소를 덧붙이고 다시 잰다`,
      ...(unplannable > 0 ? [`그중 ${unplannable} 건은 공식 dry-run 이 계획을 내지 않는다 — 활성화 전에 해소할 수 없다`] : []),
      ...(afterPlans.target > 0 ? [`공식 계획을 전부 덧붙여도 target 미해소 ${afterPlans.target} 이 남는다`] : []),
      ...succ.problems.map((p) => `승계 ${p.queueId}: ${p.code} — ${p.detail}`),
    ])
  }
  if (succ.problems.length > 0) return block('SUCCESSION_BROKEN', succ.problems.map((p) => `승계 ${p.queueId}: ${p.code} — ${p.detail}`))
  if (i.stagedSuccession === null) return block('SUCCESSION_NOT_STAGED', ['stage 가 남긴 승계 집합이 없다 — stage 부터 다시 한다'])
  if (i.stagedSuccession !== undefined && i.stagedSuccession !== successionDigest) {
    return block('SUCCESSION_DIGEST_MISMATCH', [`승계 집합이 stage 와 다르다(stage ${i.stagedSuccession.slice(0, 16)} · 지금 ${successionDigest.slice(0, 16)}) — 새 결함 또는 바뀐 연결`])
  }
  return { ...base, verdict: 'PASS', code: runtimeUnresolved.length > 0 ? 'SUCCESSION' : 'NO_UNRESOLVED', problems: [] }
}
