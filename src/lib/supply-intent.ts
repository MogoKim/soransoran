/**
 * 🔴 **JIT 공급 계약 · 공급 의도** — 순수. DB · 파일 없음 (2026-10-04 P0-2 보정)
 *
 *    묶음(`workset-v3`) → 판정 → 생성 → 적재 → 큐 행 `gateResults.supplyIntent` 까지 같은 회차 id 로 이어진다.
 *    적재기가 그 회차 묶음에서 원천마다 의도를 옮겨 적는다 — 판정 · 생성 산출물을 다시 해석하지 않는다.
 *    🔴 발행 시점 재검사는 그대로다 — 의도는 근거 기록이지 발행 권한이 아니다.
 */
/**
 * 🔴 **JIT 공급 계약** (2026-10-04 P0-2 보정) — 부족 슬롯마다 원천을 정본 판정으로 짝지어 산 묶음.
 *    이 판(`workset-v3`)만 원천마다 예정 슬롯(`slotAt`)과 그 슬롯 시점 원문 나이(`ageAtSlotH`)를 **필수로** 적는다.
 *    수율 · 손실 · 비용 근거는 이 계약의 묶음 · 큐 행(`gateResults.supplyIntent`) · 장부 줄(`supplyContract`)만 센다.
 *    🔴 옛 판(v1 · v2)과 계약 표식이 없는 행 · 장부 줄은 구제하지 않고 근거로도 세지 않는다(legacy).
 */
export const SUPPLY_JIT_CONTRACT = 'supply-jit-v1'
export const WORKSET_VERSION_JIT = 'workset-v3'
/** 🔴 큐 행 `gateResults` 의 공급 의도 칸 — 적재기가 묶음에서 옮겨 적는다 */
export const SUPPLY_INTENT_KEY = 'supplyIntent'

/** 🔴 공급 의도 — 원문 · 작성자 · id 평문 없음(원천 해시만) */
export type SupplyIntent = {
  contract: typeof SUPPLY_JIT_CONTRACT
  runId: string
  /** `articleIdHashOf(site, id)` — 증거 기록의 `provenance.articleIdHash` 와 같은 식 */
  sourceHash: string
  intendedSlotAt: string
  ageAtSlotH: number
}

/** 🔴 큐 행에서 공급 의도를 읽는다 — 모양 · 계약이 하나라도 다르면 `null`(legacy) */
export function readSupplyIntent(gateResults: unknown): SupplyIntent | null {
  if (gateResults === null || typeof gateResults !== 'object' || Array.isArray(gateResults)) return null
  const v = (gateResults as Record<string, unknown>)[SUPPLY_INTENT_KEY]
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.contract !== SUPPLY_JIT_CONTRACT || typeof o.runId !== 'string' || o.runId === '') return null
  if (typeof o.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(o.sourceHash)) return null
  if (typeof o.intendedSlotAt !== 'string' || !Number.isFinite(Date.parse(o.intendedSlotAt))) return null
  if (typeof o.ageAtSlotH !== 'number' || !Number.isFinite(o.ageAtSlotH) || o.ageAtSlotH < 0) return null
  return {
    contract: SUPPLY_JIT_CONTRACT, runId: o.runId, sourceHash: o.sourceHash,
    intendedSlotAt: o.intendedSlotAt, ageAtSlotH: o.ageAtSlotH,
  }
}

/**
 * 🔴 **현재 계약을 주장하는가** — 공급 의도 칸이 있고 계약 표식이 `supply-jit-v1` 이면 주장이다(모양은 따지지 않는다).
 *    주장하지 않는 행만 legacy 다. 주장했는데 모양 · 연결이 틀리면 legacy 로 조용히 빼지 않는다(`intentLinkIssue`).
 */
export function claimsJitContract(gateResults: unknown): boolean {
  if (gateResults === null || typeof gateResults !== 'object' || Array.isArray(gateResults)) return false
  const v = (gateResults as Record<string, unknown>)[SUPPLY_INTENT_KEY]
  return v !== null && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, unknown>).contract === SUPPLY_JIT_CONTRACT
}

export const INTENT_LINK_ISSUES = [
  'INTENT_MALFORMED', 'EVIDENCE_HASH_MISMATCH', 'WORKSET_NOT_FOUND',
  'RUN_MISMATCH', 'SOURCE_HASH_MISMATCH', 'SLOT_MISMATCH', 'AGE_MISMATCH',
] as const
export type IntentLinkIssue = (typeof INTENT_LINK_ISSUES)[number]

/**
 * 🔴 **큐 행 의도 ↔ 그 회차 묶음 의도 ↔ 원문 증거 — 정확히 같아야 현재 계약 표본이다** (2026-10-04 P0-2 최종).
 *    · `intent`        큐 행 `gateResults.supplyIntent` 판독 결과(모양이 틀리면 null)
 *    · `evidenceHash`  큐 행 `sourceEvidence.provenance.articleIdHash`
 *    · `workset`       그 회차(`intent.runId`) `workset-v3` 를 정본 판독기(`readWorkset`)로 읽어 같은 원천 해시로 찾은 의도
 *    🔴 하나라도 다르면 이유 코드 — 호출부는 cohort 전체를 모름(UNKNOWN)으로 닫는다.
 */
export function intentLinkIssue(i: {
  intent: SupplyIntent | null
  evidenceHash: string | null
  workset: SupplyIntent | null
}): IntentLinkIssue | null {
  if (i.intent === null) return 'INTENT_MALFORMED'
  if (i.evidenceHash !== i.intent.sourceHash) return 'EVIDENCE_HASH_MISMATCH'
  const w = i.workset
  if (w === null) return 'WORKSET_NOT_FOUND'
  if (w.runId !== i.intent.runId) return 'RUN_MISMATCH'
  if (w.sourceHash !== i.intent.sourceHash) return 'SOURCE_HASH_MISMATCH'
  if (w.intendedSlotAt !== i.intent.intendedSlotAt) return 'SLOT_MISMATCH'
  if (w.ageAtSlotH !== i.intent.ageAtSlotH) return 'AGE_MISMATCH'
  return null
}
