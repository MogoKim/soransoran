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
 *   🔴 **PASS 는 runtime 미해소 0 · target 미해소 0 뿐이다.** 승인으로 여는 길은 없다(2026-10-13 마스터 재검토).
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
import {
  DEFECT_RESOLUTION_KEY, judgeDefectResolution, resolutionEntriesOf,
  type AuditRowForResolution, type QueueRowForResolution,
} from '../../src/lib/auto-ready-defect-resolution'
import { readQualityContract, type QualityContractMark } from '../../src/lib/quality-contract'

/** 🔴 v2 (2026-10-13) — 승인 통과 경로를 없앴다. PASS 는 runtime 0 · target 0 뿐이다 */
export const CONTRACT_TRANSITION_VERSION = 'contract-transition-v2'

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
  code: 'NO_UNRESOLVED' | 'TARGET_UNRESOLVED' | 'RUNTIME_UNRESOLVED'
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
  problems: string[]
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
  const base = { runtime: i.runtime, target: i.target, transition: !sameMark(i.runtime, i.target), runtimeUnresolved, targetUnresolved, plans, afterPlans }
  // 🔴 두 계약의 문제를 함께 적는다 — 운영자가 무엇을 먼저 할지 한 번에 본다. 코드는 runtime 을 먼저 친다
  const problems: string[] = []
  if (runtimeUnresolved.length > 0) problems.push(`runtime 계약 미해소 ${runtimeUnresolved.length} — 지금 gate 가 이미 닫혀 있다. 활성화하지 않는다`)
  if (targetUnresolved.length > 0) {
    const unplannable = plans.filter((p) => p.kind !== 'plan').length
    problems.push(`target 계약 미해소 ${targetUnresolved.length} — 활성화 전에 staging 트리에서 공식 해소를 덧붙이고 다시 잰다`)
    if (unplannable > 0) problems.push(`그중 ${unplannable} 건은 공식 dry-run 이 계획을 내지 않는다 — 활성화 전에 해소할 수 없다`)
    if (afterPlans.target > 0) problems.push(`공식 계획을 전부 덧붙여도 target 미해소 ${afterPlans.target} 이 남는다`)
  }
  if (problems.length > 0) {
    return { ...base, verdict: 'BLOCK', code: runtimeUnresolved.length > 0 ? 'RUNTIME_UNRESOLVED' : 'TARGET_UNRESOLVED', problems }
  }
  return { ...base, verdict: 'PASS', code: 'NO_UNRESOLVED', problems: [] }
}
