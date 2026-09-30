/**
 * Persona 3계층 **운영 실측** — 🔴 read-only. DB write 0 · Raw SQL 0 · 네트워크 0
 *
 * 🔴 **순수 함수만 있고 계기판이 부르지 않으면 없는 것과 같다** (2026-09-21 3차 보정).
 *
 *    앞판은 `judgePersonaScale` 를 만들어 두고, 계기판은 `persona.count({status:'active'})`
 *    **하나**만 읽어 24 라고 적었다. 그 24 는 "카드가 있다" 이지 "쓸 수 있다" 가 아니다 —
 *    3계층을 만든 이유가 바로 그 구분이었는데, 정작 화면에는 옛 숫자가 남아 있었다.
 *
 * 🔴 **재지 못하는 축은 `null` 이다.** 0 으로 채우면 "쏠리지 않았다" 로 읽힌다 —
 *    실제로는 잰 적이 없다. `candidateOf` 는 원자료만 옮기므로 이력 축은 여전히 `null` 이다.
 *
 * 🔴 **용량의 정본은 `readPersonaReserve` 다** (2026-09-30).
 *    5개 null 축을 실제로 재는 값(자격 충돌 · 역할 쏠림 · 연속 노출 · 짝 간격 · 소재)은
 *    `scripts/lib/persona-reserve-facts.mts` 가 읽고, 4상태 판정은 `src/lib/persona-reserve.ts`
 *    `judgePersonaReserve` 하나가 한다. `readPersonaCandidates` → `personaTierReadiness` 는
 *    **옛 3계층 계기판**이고 active 행을 사람 수로 센다 — 용량으로 쓰지 않는다.
 */
import { LIFE_CONTRACT_FIELDS } from '../../src/lib/content-core/speaker'
import type { PersonaCandidate } from '../../src/lib/d100-persona-scale'
import {
  judgePersonaReserve,
  type ActivityHistory, type PersonaDbStatus, type PersonaReserveInput, type PersonaReserveResult,
  type QualificationEvidence,
} from '../../src/lib/persona-reserve'

/** 🔴 한 사람의 원자료 — 판정은 하지 않는다 */
export type PersonaRow = {
  code: string
  status: string
  /** identity JSON — 생활사 축이 여기 산다 */
  identity: Record<string, unknown>
  ageBand: string | null
  /**
   * 🔴 **컬럼이다 — identity JSON 이 아니다.** 실측에서 이걸 놓쳐
   *    24명 전원이 `lifeAxisMissing` 으로 찍혔다(카드 0/24). 없는 결함을 만든 셈이다.
   */
  region: string | null
  noGoTopics: readonly string[]
  noGoExpressions: readonly string[]
  /** 오늘(KST) 이 사람이 남긴 글·댓글 활동 수 */
  activityToday: number
  /** 마지막 활동 이후 지난 날 — 활동이 없으면 `null` */
  daysSinceActive: number | null
  /** 🔴 말투 근거 묶음의 anchor 댓글 수. 묶음이 서지 않았으면 0 */
  voiceComments: number
}

export type PersonaTierRepo = {
  personaRows: () => Promise<readonly PersonaRow[]>
}

/**
 * 🔴 **DB 행 → 판정 입력.** 여기서 규칙을 만들지 않는다 —
 *    무엇이 비었는지만 옮기고, 막을지 말지는 `personaTiers` 가 정한다.
 */
export function candidateOf(r: PersonaRow): PersonaCandidate {
  // 🔴 생활사 축은 identity JSON + 컬럼 두 곳에 흩어져 있다. 둘 다 본다
  const value = (k: string): unknown => {
    if (k === 'code') return r.code
    if (k === 'ageBand') return r.ageBand ?? r.identity.ageBand
    // 🔴 region 도 컬럼이 정본이다
    if (k === 'region') return r.region ?? r.identity.region
    if (k === 'noGoTopics') return r.noGoTopics.length > 0 ? r.noGoTopics : r.identity.noGoTopics
    if (k === 'noGoExpressions') {
      return r.noGoExpressions.length > 0 ? r.noGoExpressions : r.identity.noGoExpressions
    }
    return r.identity[k]
  }
  /**
   * 🔴 **빈 것과 없는 것을 가른다** (실측 보정).
   *
   *    무자녀(`childrenCount === 0`)인 사람의 `childrenAgeBands` 는 **비어 있는 것이 맞다.**
   *    그것을 "축이 비었다" 로 세면 4명이 없는 결함으로 빨갛게 찍힌다 —
   *    검사가 사실이 아닌 것을 가리키기 시작하면 사람이 화면을 믿지 않게 된다.
   */
  const childless = r.identity.childrenCount === 0
  const filled = LIFE_CONTRACT_FIELDS.filter((k) => {
    if (k === 'childrenAgeBands' && childless) return true
    const v = value(k)
    if (v === null || v === undefined) return false
    if (typeof v === 'string') return v.trim() !== ''
    if (Array.isArray(v)) return v.length > 0
    return true
  })

  return {
    code: r.code,
    filledAxes: filled,
    ageBand: r.ageBand ?? (typeof r.identity.ageBand === 'string' ? r.identity.ageBand : null),
    voiceComments: r.voiceComments,
    activityToday: r.activityToday,
    /**
     * 🔴 **연속 노출은 회차 단위 사실이다.** 이 조회는 회차를 모른다 —
     *    `0` 을 넣으면 "연속으로 나오지 않았다" 는 **거짓**이 되고, 그 거짓이 배정을 열어 준다.
     *    재지 않았으므로 `null` 이다.
     */
    consecutiveExposures: null,
    // 🔴 활동 기록이 없으면 "오늘 활동했다"(0일) 가 아니다 — 휴면으로 본다(fail-closed)
    daysSinceActive: r.daysSinceActive ?? Number.MAX_SAFE_INTEGER,
    retired: r.status !== 'active',
    /**
     * 🔴 자격 충돌은 별도 감사 경로다 — 이 조회로는 알 수 없다.
     *    `false` 는 "확인했고 문제없다" 는 뜻이라, 확인한 적 없는 것을 그렇게 적으면
     *    감사 없이 통과시키는 것이 된다. 그래서 `null` 이다.
     */
    qualificationConflict: null,
    /**
     * 🔴 **소재·역할 쏠림과 짝 반복은 아직 재는 곳이 없다.**
     *    글의 "소재" 와 댓글의 "역할" 은 어느 표에도 컬럼으로 없고,
     *    짝 반복은 한 글에 붙은 두 사람의 이력을 회차 단위로 되짚어야 한다.
     *    🔴 `0` 을 넣으면 "쏠리지 않았다" 로 읽힌다 — 재지 않았으므로 `null` 이다.
     */
    topicShare: null,
    roleShare: null,
    postsSinceLastPairing: null,
  }
}

/** 🔴 어느 축이 몇 명에게서 비었는가 — "17명 미완성" 만으로는 무엇을 채울지 모른다 */
export function missingAxisHistogram(
  candidates: readonly PersonaCandidate[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of candidates) {
    for (const a of LIFE_CONTRACT_FIELDS) {
      if (!c.filledAxes.includes(a)) out[a] = (out[a] ?? 0) + 1
    }
  }
  return out
}

export type PersonaTierRead =
  | { ok: true; candidates: PersonaCandidate[]; rows: readonly PersonaRow[] }
  | { ok: false; detail: string }

export async function readPersonaCandidates(repo: PersonaTierRepo): Promise<PersonaTierRead> {
  let rows: readonly PersonaRow[]
  try {
    rows = await repo.personaRows()
  } catch (e) {
    // 🔴 fail-closed — 못 읽으면 0 명이 아니다
    return { ok: false, detail: e instanceof Error ? e.message : '알 수 없음' }
  }
  return { ok: true, candidates: rows.map(candidateOf), rows }
}

// ─────────────────────────────────────────────────────────
// 4상태 — 🔴 용량 정본 (`contractValid`)
// ─────────────────────────────────────────────────────────

/** 🔴 DB 행 + 잰 재료. 판정은 하지 않는다 */
export type PersonaReserveRow = PersonaRow & {
  /** `null` = 자격 재료를 읽지 못했다 */
  qualification: QualificationEvidence | null
  /** `null` = 이력을 읽지 못했다 — 이력 0 과 다르다 */
  history: ActivityHistory | null
}

export type PersonaReserveFacts = {
  rows: readonly PersonaReserveRow[]
  /** 🔴 정본 카드는 있는데 DB 행이 없는 코드 — designed */
  designedOnly: readonly string[]
}

export type PersonaReserveRepo = { reserveFacts: () => Promise<PersonaReserveFacts> }

const DB_STATUSES: readonly PersonaDbStatus[] = ['draft', 'active', 'paused', 'retired']

/** 🔴 DB 행 → 4상태 입력. 카드 층 원자료는 `candidateOf` 가 옮긴 값 그대로다 */
export function reserveInputOf(r: PersonaReserveRow): PersonaReserveInput {
  if (!(DB_STATUSES as readonly string[]).includes(r.status)) {
    // 🔴 모르는 status 를 draft 로 읽지 않는다 — 읽기 실패로 올린다
    throw new Error(`${r.code}: 모르는 Persona status "${r.status}"`)
  }
  const c = candidateOf(r)
  return {
    code: r.code,
    stored: true,
    status: r.status as PersonaDbStatus,
    card: { filledAxes: c.filledAxes, ageBand: c.ageBand, voiceComments: c.voiceComments },
    qualification: r.qualification,
    history: r.history,
  }
}

/** 🔴 설계만 있는 코드 — 잴 seed 가 없다 */
export function designedInputOf(code: string): PersonaReserveInput {
  return {
    code, stored: false, status: null,
    card: { filledAxes: [], ageBand: null, voiceComments: 0 },
    qualification: null, history: null,
  }
}

/**
 * 🔴 **Persona 용량 — 4상태 판정.** 읽기에 실패하면 `contractValid = null` (0 이 아니다).
 *    통합 레인의 `judgeNextPreflight` 는 `contractValidPersonas` 로 이 값만 받는다.
 */
export async function readPersonaReserve(repo: PersonaReserveRepo): Promise<PersonaReserveResult> {
  try {
    const f = await repo.reserveFacts()
    const stored = new Set(f.rows.map((r) => r.code))
    return judgePersonaReserve({
      ok: true,
      personas: [
        ...f.rows.map(reserveInputOf),
        ...f.designedOnly.filter((c) => !stored.has(c)).map(designedInputOf),
      ],
    })
  } catch (e) {
    return judgePersonaReserve({ ok: false, detail: e instanceof Error ? e.message : '알 수 없음' })
  }
}
