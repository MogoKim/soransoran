/**
 * 설계 카드 검증 — 🔴 **순수 함수. DB · 파일 · 네트워크를 건드리지 않는다**
 *
 * 🔴 왜 떼어냈나.
 *    검증이 스크립트 안에만 있으면 CI 가 그것을 시험할 수 없다. 그러면 "검사기가 실제로
 *    잡는가" 를 사람이 매번 손으로 확인해야 하고, 언젠가 확인하지 않는 날이 온다.
 *
 * 🔴 판정을 새로 만들지 않는다 — `CHILD_AGE_BANDS` · `readLengthBand` 는 매칭 정본의 것을 부른다.
 */

import { CHILD_AGE_BANDS, readLengthBand } from './original-post-persona-match'
import type { PoolCard } from './persona-pool-card'

/** 🔴 제어값 — 자유 문장이면 카드마다 말이 달라져 비교가 불가능해진다 */
export const MARITAL_VALUES = ['기혼', '이혼', '사별', '비혼', '별거'] as const
/** 🔴 `해당없음` 으로 통일한다 — 띄어쓴 `해당 없음` 과 섞이면 두 값이 같은 뜻으로 공존한다 */
export const SPOUSE_REL_VALUES = ['원만', '소원', '갈등', '해당없음'] as const
export const PARENT_CARE_VALUES = ['없음', '간헐', '상시'] as const
export const MENOPAUSE_VALUES = ['전', '진행중', '후'] as const

/** 🔴 매칭이 반드시 읽는 축 — 비면 조용히 배제되거나 기본값으로 잘못 판정된다 (#468) */
export const REQUIRED_IDENTITY = [
  'maritalStatus', 'childrenCount', 'parentCare', 'menopauseStatus',
  'workStatus', 'economicStatus', 'housing', 'personality', 'spouseRelationship',
] as const
/**
 * 🔴 `childrenAgeBands` 는 **비어 있는 것이 정상일 수 있다** — 무자녀 카드가 그렇다.
 *    그래서 "채워졌는가" 가 아니라 "키가 있고 배열인가" 만 보고,
 *    내용은 자녀 수와의 **정합 검사**(⑤)가 판단한다.
 */
export const REQUIRED_ARRAY_IDENTITY = ['childrenAgeBands'] as const
export const REQUIRED_VOICE = ['length', 'register', 'ending', 'emoji'] as const
export const REQUIRED_SCALAR = ['ageBand', 'region', 'lifeStage', 'dailyCap', 'weeklyCap', 'silenceRate'] as const
export const REQUIRED_LIST = ['noGoTopics', 'noGoExpressions', 'forbiddenReactionRoles'] as const

export const VARIATION_MIN = 5
export const VARIATION_MAX = 8

export type SeedCard = Record<string, unknown>

const filled = (v: unknown): boolean => {
  if (v === null || v === undefined) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim() !== ''
  return true
}
const sorted = (xs: readonly unknown[]): string => [...xs].map(String).sort().join('|')

/**
 * 카드 한 장 — 🔴 문제 목록을 돌려준다. 비어 있으면 통과다.
 *
 * `poolCard` 를 주면 **정본과 일치하는지**까지 본다. 주지 않으면 형식만 본다 —
 * 정본이 없는 카드는 어차피 켜서는 안 되므로, 부르는 쪽이 정본을 찾아 넘긴다.
 */
export function verifySeedCard(code: string, card: SeedCard, poolCard: PoolCard | null): string[] {
  const problems: string[] = []
  const idv = (card.identity ?? {}) as Record<string, unknown>
  const vcv = (card.voiceCore ?? {}) as Record<string, unknown>

  // ── ① 필수 축 ──
  for (const f of REQUIRED_IDENTITY) if (!filled(idv[f]) && idv[f] !== 0) problems.push(`identity.${f}`)
  for (const f of REQUIRED_ARRAY_IDENTITY) if (!Array.isArray(idv[f])) problems.push(`identity.${f} 가 배열이 아니다`)
  for (const f of REQUIRED_VOICE) if (!filled(vcv[f])) problems.push(`voiceCore.${f}`)
  for (const f of REQUIRED_SCALAR) if (!filled(card[f])) problems.push(String(f))
  // 🔴 리스트는 **키가 있는지**만 보지 않는다 — 빈 배열이면 그 사람은 아무것도 피하지 않는다
  for (const f of REQUIRED_LIST) {
    if (card[f] === undefined) problems.push(String(f))
    else if (!Array.isArray(card[f])) problems.push(`${f} 가 배열이 아니다`)
  }

  // ── ② voiceVariations ──
  const vv = Array.isArray(card.voiceVariations) ? card.voiceVariations : []
  if (vv.length < VARIATION_MIN || vv.length > VARIATION_MAX) {
    problems.push(`voiceVariations ${vv.length}개 (${VARIATION_MIN}~${VARIATION_MAX}개여야 한다)`)
  }

  // ── ③ activityRhythm ──
  const ar = (card.activityRhythm ?? {}) as Record<string, unknown>
  for (const f of ['activeHours', 'burstiness', 'weekdayBias'] as const) {
    if (!filled(ar[f])) problems.push(`activityRhythm.${f}`)
  }

  // ── ④ 제어값 ──
  const enumOf = (v: unknown, allowed: readonly string[], label: string): void => {
    if (typeof v === 'string' && !allowed.includes(v)) problems.push(`${label}=${v} (허용: ${allowed.join('·')})`)
  }
  enumOf(idv.maritalStatus, MARITAL_VALUES, 'identity.maritalStatus')
  enumOf(idv.spouseRelationship, SPOUSE_REL_VALUES, 'identity.spouseRelationship')
  enumOf(idv.parentCare, PARENT_CARE_VALUES, 'identity.parentCare')
  enumOf(idv.menopauseStatus, MENOPAUSE_VALUES, 'identity.menopauseStatus')
  // 🔴 기혼이 아닌데 배우자 관계가 있으면 카드와 매칭이 다른 말을 한다
  if (idv.maritalStatus !== '기혼' && typeof idv.spouseRelationship === 'string'
    && idv.spouseRelationship !== '해당없음') {
    problems.push(`identity.spouseRelationship=${idv.spouseRelationship} 인데 maritalStatus=${String(idv.maritalStatus)}`)
  }

  // ── ⑤ 자녀 정합 ──
  const kids = typeof idv.childrenCount === 'number' ? idv.childrenCount : -1
  const bands = Array.isArray(idv.childrenAgeBands) ? idv.childrenAgeBands : []
  if (kids < 0) problems.push('identity.childrenCount 가 숫자가 아니다')
  else if (kids > 0 && bands.length === 0) problems.push('자녀가 있는데 childrenAgeBands 가 비었다')
  else if (kids === 0 && bands.length > 0) problems.push('자녀가 없는데 childrenAgeBands 가 있다')
  if (kids >= 0 && bands.length > kids) problems.push(`나이대 ${bands.length}종 > 자녀 ${kids}명`)
  for (const b of bands) {
    if (!(CHILD_AGE_BANDS as readonly unknown[]).includes(b)) problems.push(`모르는 자녀 나이대: ${String(b)}`)
  }

  // ── ⑥ 🔴 매칭이 길이를 읽을 수 있어야 한다 ──
  if (typeof vcv.length === 'string' && readLengthBand(vcv.length) === null) {
    problems.push(`voiceCore.length="${vcv.length}" 를 readLengthBand 가 읽지 못한다`)
  }

  // ── ⑦ cap · silenceRate ──
  if (typeof card.dailyCap === 'number' && (card.dailyCap < 1 || card.dailyCap > 10)) problems.push(`dailyCap ${card.dailyCap}`)
  if (typeof card.weeklyCap === 'number' && (card.weeklyCap < 1 || card.weeklyCap > 50)) problems.push(`weeklyCap ${card.weeklyCap}`)
  if (typeof card.silenceRate === 'number' && (card.silenceRate < 0 || card.silenceRate > 1)) problems.push(`silenceRate ${card.silenceRate}`)

  // ── ⑧ 🔴 정본과 일치하는가 ──
  if (poolCard === null) {
    problems.push(`정본 Pool 카드 ${code} 를 찾지 못했다`)
    return problems
  }
  const same = (a: readonly unknown[], b: readonly unknown[], label: string): void => {
    if (sorted(a) !== sorted(b)) problems.push(`${label} 가 정본과 다르다 (정본 ${b.length}개 / seed ${a.length}개)`)
  }
  same(Array.isArray(card.noGoTopics) ? card.noGoTopics : [], poolCard.noGoTopics, 'noGoTopics')
  same(Array.isArray(card.noGoExpressions) ? card.noGoExpressions : [], poolCard.noGoExpressions, 'noGoExpressions')
  same(Array.isArray(card.forbiddenReactionRoles) ? card.forbiddenReactionRoles : [], poolCard.forbiddenReactionRoles, 'forbiddenReactionRoles')
  // 🔴 매칭에 쓰이는 축은 정본과 **같아야 한다** — 다르면 시뮬레이션한 사람과 만들 사람이 다르다
  if (idv.maritalStatus !== poolCard.maritalStatus) problems.push(`maritalStatus 가 정본과 다르다 (정본 ${poolCard.maritalStatus})`)
  if (idv.childrenCount !== poolCard.childrenCount) problems.push(`childrenCount 가 정본과 다르다 (정본 ${poolCard.childrenCount})`)
  if (sorted(bands) !== sorted(poolCard.childrenAgeBands)) problems.push('childrenAgeBands 가 정본과 다르다')
  if (idv.parentCare !== poolCard.parentCare) problems.push(`parentCare 가 정본과 다르다 (정본 ${poolCard.parentCare})`)
  if (idv.menopauseStatus !== poolCard.menopauseStatus) problems.push(`menopauseStatus 가 정본과 다르다 (정본 ${poolCard.menopauseStatus})`)
  // 🔴 **길이도 정본과 같아야 한다.** 정본이 미상인데 seed 에 값이 있으면,
  //    시뮬레이션은 중립으로 돌았는데 실제 사람은 다른 말투가 된다
  if (poolCard.voiceLength === null) {
    problems.push('정본 카드의 voiceCore 길이가 미상이다 — 사람이 추정한 값을 넣지 않는다. 정본을 먼저 보완하라')
  } else if (vcv.length !== poolCard.voiceLength) {
    problems.push(`voiceCore.length 가 정본과 다르다 (정본 "${poolCard.voiceLength}")`)
  }

  return problems
}

/** 🔴 코드가 정본 형식인가 — 임의 코드를 만들면 문서와 DB 가 갈린다 */
export function isPoolCode(code: string): boolean {
  // 🔴 **P01~P50** (2026-09-08). Pool 이 25장으로 늘었고 50장까지 갈 계획이다.
  //    범위를 넓혀도 안전한 이유: 도구가 **정본 Pool 문서에 카드가 없는 코드를 거부**한다.
  return /^P(0[1-9]|[1-4][0-9]|50)$/.test(code)
}

/**
 * JSON 원문의 **최상위 키만** 센다 — 중첩 키(`identity.housing`)는 카드마다 반복되는 것이 정상이다.
 * 🔴 들여쓰기로 판단하면 포맷이 바뀔 때 조용히 무너지므로 중괄호 깊이를 센다.
 */
export function topLevelKeys(raw: string): string[] {
  const keys: string[] = []
  let depth = 0
  let inStr = false
  let esc = false
  let start = -1
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!
    if (inStr) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') {
        inStr = false
        if (depth === 1) {
          const rest = raw.slice(i + 1)
          const next = rest.search(/\S/)
          if (next >= 0 && rest[next] === ':') keys.push(raw.slice(start + 1, i))
        }
      }
      continue
    }
    if (ch === '"') { inStr = true; start = i; continue }
    if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') depth -= 1
  }
  return keys
}

/** 🔴 같은 키가 두 번 있으면 JSON 은 뒤엣것을 쓴다 — 파싱 후에는 보이지 않는다 */
export function duplicateKeys(raw: string): string[] {
  const ks = topLevelKeys(raw)
  return [...new Set(ks.filter((k, i) => ks.indexOf(k) !== i))]
}
