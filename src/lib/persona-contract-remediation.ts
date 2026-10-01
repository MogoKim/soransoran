/**
 * Persona 계약 **결정적 복구 계획** — 🔴 순수 함수. DB · 파일 · 네트워크 · LLM 없음 (2026-10-01 · Phase 2A)
 *
 *   저장된 seed 가 **정본 Pool 카드**와 어긋난 칸만, 카드가 그 값을 **직접 적고 있을 때만** 카드 값으로 맞춘다.
 *   카드에 없는 값은 채우지 않는다 — 말투 변주 · 활동 리듬 · 카드가 적지 않은 말끝은 사람이 고른 값이고,
 *   카드로부터 유도되지 않는다(2026-09-07 seed 파일도 지금 계약을 통과하지 못한다 — 근거가 아니다).
 *
 * 🔴 **Phase F (2026-10-01) 에 넓힌 결정적 복구 둘** — 둘 다 카드 글자 그대로다. 생성하지 않는다.
 *    · `lifeStage` 가 비었으면 **카드 제목**(`### P07 — 대학생 하나, 요양원 오가며` 의 제목)으로만 채운다
 *    · `voiceCore.ending` 이 비었고 카드가 말끝을 **정확히 하나** 따옴표로 적었으면 그 값으로 채운다
 *      (카드가 말끝을 적지 않으면 채우지 않는다 — 말끝은 더 이상 필수 칸이 아니다 · `REQUIRED_VOICE`)
 *
 * 🔴 하지 않는 것
 *    · 하한 · 품질 기준 변경 · active 행을 계약 유효로 세기
 *    · Post · Comment · Queue · 활동 이력 생성(쏠림 축은 활동 0 이면 측정된 0 이다)
 *    · 말투 근거 묶음 배정 · 표시명 변경 · 원본 작가 · 옛 작가 해시 입력
 *    · 자녀 나이대 쓰기 — 카드는 고유 밴드 집합이라 자녀 한 명당 한 칸인 DB 값을 만들 수 없다
 *
 * 🔴 카드가 정본인 근거: `verifySeedCard` ⑧ 이 이 칸들을 정본 카드와 대조한다 — 같은 결정을 여기서 다시 내리지 않고
 *    그 대조가 실패하는 칸을 카드 값으로 옮길 뿐이다. 판정은 `persona-reserve` 하나가 한다.
 */
import { createHash } from 'node:crypto'

import { MARITAL_VALUES, explicitEndingsOf } from './persona-card-verify'
import { noGoExpressionKey } from './persona-no-go'
import type { PoolCard } from './persona-pool-card'

export const REMEDIATION_PLAN_VERSION = 'persona-remediation-v2'

/** 🔴 카드가 직접 적는 칸 — 어긋나면 카드 값으로 맞춘다 */
export const CARD_CANON_FIELDS = [
  'noGoTopics', 'noGoExpressions', 'forbiddenReactionRoles',
  'identity.maritalStatus', 'identity.childrenCount', 'identity.parentCare', 'identity.menopauseStatus',
  'identity.spouseRelationship', 'voiceCore.length',
] as const
/**
 * 🔴 카드가 직접 적지만 `verifySeedCard` ⑧ 이 대조하지 않는 칸 — **비었을 때만** 채운다.
 *    `lifeStage` 는 카드 **제목** 그대로다(Phase F). 이미 값이 있는 사람의 생활 단계는 건드리지 않는다.
 */
export const CARD_FILL_FIELDS = [
  'ageBand', 'region', 'lifeStage', 'identity.workStatus', 'identity.economicStatus', 'identity.housing', 'identity.personality',
] as const
/** 🔴 카드가 말끝을 **정확히 하나** 명시했고 저장값이 비었을 때만 채운다 */
export const CARD_ENDING_FIELD = 'voiceCore.ending' as const
export type RemediableField = (typeof CARD_CANON_FIELDS)[number] | (typeof CARD_FILL_FIELDS)[number] | typeof CARD_ENDING_FIELD

/** 🔴 카드에서 유도할 수 없는 칸 — 비어 있으면 계획이 채우지 않고 `evidenceRequired` 로 낸다 */
export const EVIDENCE_REQUIRED_FIELDS = [
  'voiceCore.register', 'voiceCore.emoji',
] as const

export type RemediationRow = {
  code: string
  status: string
  /** 🔴 precondition 에 들어간다 — 계획 뒤 어떤 write 든 있었으면 계획이 낡은 것이다 */
  updatedAt: string
  ageBand: string | null
  region: string | null
  lifeStage: string | null
  identity: Record<string, unknown> | null
  voiceCore: Record<string, unknown> | null
  noGoTopics: readonly string[]
  noGoExpressions: readonly string[]
  forbiddenReactionRoles: readonly string[]
}

export type FieldChange = { field: RemediableField; before: unknown; after: unknown }
export type PersonaRemediation = { code: string; precondition: string; changes: FieldChange[] }
export type EvidenceGap = { code: string; field: string; reason: string }

export type RemediationPlan = {
  version: typeof REMEDIATION_PLAN_VERSION
  personas: PersonaRemediation[]
  /** 카드로 채울 수 없어 남는 칸 — 계획은 건드리지 않는다 */
  evidenceRequired: EvidenceGap[]
  /** 카드가 없거나 정본 문서를 못 읽어 계획하지 않은 코드 */
  skipped: { code: string; reason: string }[]
  /** 🔴 계획 전체의 지문 — apply 는 같은 지문을 다시 계산해 맞을 때만 쓴다 */
  digest: string
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 24)
/** 🔴 키 순서 · 배열 순서에 기대지 않는 직렬화(jsonb 는 키 순서를 보존하지 않는다) */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export function fingerprintOf(r: RemediationRow): string {
  return sha(canon({ ...r }))
}

const empty = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
const setKey = (xs: readonly string[], key: (s: string) => string = (s) => s): string =>
  [...new Set(xs.map(key))].sort().join('\u0001')

function getField(r: RemediationRow, f: string): unknown {
  if (f.startsWith('identity.')) return (r.identity ?? {})[f.slice('identity.'.length)]
  if (f.startsWith('voiceCore.')) return (r.voiceCore ?? {})[f.slice('voiceCore.'.length)]
  return (r as unknown as Record<string, unknown>)[f]
}

/**
 * 🔴 **배우자 관계의 카드 값** — 카드는 `기혼(원만)` 의 괄호만 적는다.
 *    기혼이 아니면 `verifySeedCard` 가 허용하는 값은 `해당없음` 하나다 — 유도가 아니라 계약의 유일해다.
 *    기혼인데 카드 괄호가 없으면 모른다(`null`) — 채우지 않는다.
 */
function spouseOf(card: PoolCard): string | null {
  if (card.maritalStatus !== '기혼') return '해당없음'
  return card.spouseRelationship
}

/** 한 사람의 변경 — 순서 고정(필드 목록 순서) */
export function changesOf(r: RemediationRow, card: PoolCard): { changes: FieldChange[]; gaps: EvidenceGap[] } {
  const changes: FieldChange[] = []
  const gaps: EvidenceGap[] = []
  const put = (field: RemediableField, after: unknown): void => { changes.push({ field, before: getField(r, field) ?? null, after }) }

  if (setKey(r.noGoTopics) !== setKey(card.noGoTopics)) put('noGoTopics', [...card.noGoTopics])
  if (setKey(r.noGoExpressions, noGoExpressionKey) !== setKey(card.noGoExpressions, noGoExpressionKey)) {
    put('noGoExpressions', [...card.noGoExpressions])
  }
  if (setKey(r.forbiddenReactionRoles) !== setKey(card.forbiddenReactionRoles)) {
    put('forbiddenReactionRoles', [...card.forbiddenReactionRoles])
  }
  if ((MARITAL_VALUES as readonly string[]).includes(card.maritalStatus) && getField(r, 'identity.maritalStatus') !== card.maritalStatus) {
    put('identity.maritalStatus', card.maritalStatus)
  }
  if (getField(r, 'identity.childrenCount') !== card.childrenCount) put('identity.childrenCount', card.childrenCount)
  if (getField(r, 'identity.parentCare') !== card.parentCare) put('identity.parentCare', card.parentCare)
  if (getField(r, 'identity.menopauseStatus') !== card.menopauseStatus) put('identity.menopauseStatus', card.menopauseStatus)
  const spouse = spouseOf(card)
  if (spouse === null) {
    if (empty(getField(r, 'identity.spouseRelationship'))) gaps.push({ code: r.code, field: 'identity.spouseRelationship', reason: '기혼인데 카드에 관계가 없다' })
  } else if (getField(r, 'identity.spouseRelationship') !== spouse) put('identity.spouseRelationship', spouse)
  if (card.voiceLength !== null && getField(r, 'voiceCore.length') !== card.voiceLength) put('voiceCore.length', card.voiceLength)

  const fill: Record<(typeof CARD_FILL_FIELDS)[number], unknown> = {
    ageBand: card.ageBand, region: card.region, lifeStage: card.title,
    'identity.workStatus': card.workStatus, 'identity.economicStatus': card.economicStatus,
    'identity.housing': card.housing, 'identity.personality': card.personality,
  }
  for (const f of CARD_FILL_FIELDS) if (empty(getField(r, f)) && !empty(fill[f])) put(f, fill[f])

  const endings = explicitEndingsOf(card.voiceTokens)
  if (empty(getField(r, CARD_ENDING_FIELD)) && endings.length === 1) put(CARD_ENDING_FIELD, endings[0])
  else if (empty(getField(r, CARD_ENDING_FIELD)) && endings.length > 1) {
    gaps.push({ code: r.code, field: CARD_ENDING_FIELD, reason: `카드가 말끝을 ${endings.length}개 적는다 — 하나를 고를 근거가 없다` })
  }

  for (const f of EVIDENCE_REQUIRED_FIELDS) {
    if (empty(getField(r, f))) gaps.push({ code: r.code, field: f, reason: '카드에서 유도할 수 없다 — 근거 필요' })
  }
  if (setKey(((r.identity ?? {}).childrenAgeBands as string[] | undefined) ?? []) !== setKey(card.childrenAgeBands)) {
    gaps.push({ code: r.code, field: 'identity.childrenAgeBands', reason: '카드는 고유 밴드 집합이다 — 자녀 한 명당 한 칸을 만들 수 없다' })
  }
  return { changes, gaps }
}

/**
 * 🔴 **계획** — retired 는 대상이 아니다. 카드를 못 읽었으면(`cards === null`) 아무것도 계획하지 않는다.
 *    같은 입력이면 언제나 같은 계획 · 같은 digest 다.
 */
export function planRemediation(rows: readonly RemediationRow[], cards: readonly PoolCard[] | null): RemediationPlan {
  const personas: PersonaRemediation[] = []
  const evidenceRequired: EvidenceGap[] = []
  const skipped: RemediationPlan['skipped'] = []
  for (const r of [...rows].sort((a, b) => a.code.localeCompare(b.code))) {
    if (r.status === 'retired') { skipped.push({ code: r.code, reason: 'retired' }); continue }
    if (cards === null) { skipped.push({ code: r.code, reason: '정본 카드 문서를 읽지 못했다' }); continue }
    const card = cards.find((c) => c.code === r.code)
    if (card === undefined) { skipped.push({ code: r.code, reason: '정본 카드가 없다' }); continue }
    const { changes, gaps } = changesOf(r, card)
    evidenceRequired.push(...gaps)
    if (changes.length > 0) personas.push({ code: r.code, precondition: fingerprintOf(r), changes })
  }
  /**
   * 🔴 **모든 행의 지문이 digest 에 들어간다** — 계획에 없는 사람이 바뀌어도 판정(이름 충돌 · 짝 등)이 달라질 수 있다.
   *    계획 뒤 Persona 행이 하나라도 바뀌면 승인된 digest 와 달라져 apply 가 멈춘다.
   */
  const universe = [...rows].sort((a, b) => a.code.localeCompare(b.code)).map((r) => `${r.code}:${fingerprintOf(r)}`)
  const digest = sha(canon({ v: REMEDIATION_PLAN_VERSION, personas, universe }))
  return { version: REMEDIATION_PLAN_VERSION, personas, evidenceRequired, skipped, digest }
}

/** 🔴 변경을 적용한 행 — 예측과 apply 가 같은 함수를 쓴다 */
export function patchedRow(r: RemediationRow, changes: readonly FieldChange[]): RemediationRow {
  const out: RemediationRow = {
    ...r,
    identity: { ...(r.identity ?? {}) },
    voiceCore: r.voiceCore === null ? null : { ...r.voiceCore },
    noGoTopics: [...r.noGoTopics], noGoExpressions: [...r.noGoExpressions], forbiddenReactionRoles: [...r.forbiddenReactionRoles],
  }
  for (const c of changes) {
    if (c.field.startsWith('identity.')) (out.identity as Record<string, unknown>)[c.field.slice('identity.'.length)] = c.after
    else if (c.field.startsWith('voiceCore.')) out.voiceCore = { ...(out.voiceCore ?? {}), [c.field.slice('voiceCore.'.length)]: c.after }
    else (out as unknown as Record<string, unknown>)[c.field] = c.after
  }
  return out
}
