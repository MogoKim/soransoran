/**
 * 🔴 **Persona 의 정확한 나이 정본** (2026-09-23).
 *
 *   지금까지 Persona 카드에는 `ageBand`(예: `40대 후반`) 만 있었다. 그래서 초안이
 *   정확한 나이를 말해야 할 때 **원문 작성자의 숫자를 베꼈다**(P02 실패).
 *
 * 🔴 **매번 임의의 숫자를 만들지 않는다.** Persona 마다 **생일 기준점**(birth anchor)을
 *    한 번 정하고, 발행 시점(KST)으로 나이를 계산한다. 해가 바뀌면 나이도 같이 는다 —
 *    **사람이 매년 고치는 구조를 만들지 않는다.**
 *
 * 🔴 **정본은 한 벌이다.** `ageBand` 는 Persona Pool 문서가 정한다(`parsePoolDoc`).
 *    birth anchor 는 그 `ageBand` 와 **코드가 정한 규칙**으로 유도한다 —
 *    사람이 따로 적는 표를 두지 않는다. 표를 두면 두 벌이 되어 어긋난다.
 *
 * 🔴 **DB migration 이 필요 없다.** 이 값은 Pool 문서(코드 저장소)와 이 함수만으로 나온다.
 *    운영 DB 의 `Persona.identity` 를 쓰지 않으므로 25명 일괄 write 도 필요 없다.
 *
 * 🔴 **birth anchor 자체는 글에 나오지 않는다.** 생일·생년은 외부에 드러내지 않는다 —
 *    나오는 것은 계산된 나이뿐이다.
 */
import { parseAgeBand } from './persona-self-age'

/** 🔴 규칙이 바뀌면 올린다. 올리면 모든 Persona 의 나이가 다시 계산된다 */
export const BIRTH_ANCHOR_RULE_VERSION = 'birth-anchor-v1'

/**
 * 🔴 **기준일.** 이 날짜에 그 Persona 가 `ageBand` 안의 나이였다고 본다.
 *    Pool 정본 문서가 쓰인 날이다 — 그때의 카드가 참이었으므로 여기서 역산한다.
 */
export const ANCHOR_BASE_DATE = '2026-08-30'

/** 🔴 결정적 해시 — 같은 code 면 언제나 같은 값이다. 무작위가 아니다 */
function hashOf(code: string): number {
  let h = 2166136261 >>> 0
  for (const ch of code) h = (Math.imul(h ^ ch.charCodeAt(0), 16777619)) >>> 0
  return h >>> 0
}

export type BirthAnchor = {
  /** `YYYY-MM-DD` — 🔴 내부 값이다. 글에 쓰지 않는다 */
  birthDate: string
  /** 기준일에 이 나이였다 */
  ageAtBase: number
}

/**
 * 🔴 `ageBand` 안에서 **결정적으로** 하나를 고른다.
 *    밴드를 읽지 못하면 `null` — 모르면 만들지 않는다(fail-closed).
 */
export function birthAnchorOf(input: {
  code: string
  ageBand: string | null | undefined
  baseDate?: string
}): BirthAnchor | null {
  const span = parseAgeBand(input.ageBand)
  if (span === null) return null
  const base = input.baseDate ?? ANCHOR_BASE_DATE
  const baseY = Number(base.slice(0, 4))
  if (!Number.isFinite(baseY)) return null

  const h = hashOf(`${BIRTH_ANCHOR_RULE_VERSION}|${input.code}`)
  /**
   * 🔴 **밴드 맨 위를 쓰지 않는다** (2026-09-23 보정).
   *    상단을 고르면 그해 생일이 지나는 순간 밴드를 벗어나 `OUT_OF_BAND` 가 된다
   *    (P03·P14·P24 실측 — 12월 31일에 깨졌다). 그러면 **매년 사람이 카드를 고쳐야** 한다.
   *    한 칸 아래까지만 써서 **최소 1년**은 카드 갱신 없이 버티게 한다.
   *    (밴드 폭이 1이면 그 한 칸을 쓴다 — 그때는 어쩔 수 없다.)
   */
  const top = span.to > span.from ? span.to - 1 : span.to
  const width = top - span.from + 1
  const age = span.from + (h % width)
  // 🔴 월·일도 결정적으로. 28일까지만 써서 어느 달이든 실재하는 날짜가 된다
  const month = ((h >>> 8) % 12) + 1
  const day = ((h >>> 16) % 28) + 1
  /**
   * 🔴 **월·일을 함께 본다** (2026-09-23 보정).
   *    `baseY - age` 로만 잡으면, 생일이 기준일보다 **뒤**인 Persona 는 기준일에
   *    아직 생일 전이라 실제 나이가 한 살 적어진다. 그러면 며칠만 지나도
   *    `OUT_OF_BAND` 가 난다 (P01·P16·P19 실측).
   */
  const baseM = Number(base.slice(5, 7))
  const baseD = Number(base.slice(8, 10))
  const birthdayPassedAtBase = month < baseM || (month === baseM && day <= baseD)
  const birthYear = baseY - age - (birthdayPassedAtBase ? 0 : 1)
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return { birthDate: `${birthYear}-${mm}-${dd}`, ageAtBase: age }
}

/** 🔴 KST 기준 만 나이. 생일이 지나지 않았으면 한 살 적다 */
export function exactAgeOn(birthDate: string, onKstDate: string): number | null {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  const o = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onKstDate)
  if (b === null || o === null) return null
  const [by, bm, bd] = [Number(b[1]), Number(b[2]), Number(b[3])]
  const [oy, om, od] = [Number(o[1]), Number(o[2]), Number(o[3])]
  let age = oy - by
  if (om < bm || (om === bm && od < bd)) age -= 1
  return age >= 0 ? age : null
}

export type ExactAgeVerdict =
  | { ok: true; age: number; birthDate: string }
  /** 🔴 밴드를 못 읽었거나, 계산한 나이가 밴드 밖이다 — 쓰지 않는다 */
  | { ok: false; code: 'NO_BAND' | 'OUT_OF_BAND'; reason: string }

/**
 * 🔴 **그날의 정확한 나이.** `ageBand` 와 반드시 일치해야 한다 —
 *    어긋나면 쓰지 않는다(fail-closed). 해가 바뀌어 밴드를 벗어나면 여기서 잡힌다.
 */
export function exactAgeOf(input: {
  code: string
  ageBand: string | null | undefined
  /** 발행 날짜 (KST `YYYY-MM-DD`) */
  onKstDate: string
  baseDate?: string
}): ExactAgeVerdict {
  const anchor = birthAnchorOf(input)
  if (anchor === null) {
    return { ok: false, code: 'NO_BAND', reason: `나이대를 읽을 수 없다 — ${input.ageBand ?? '(없음)'}` }
  }
  const age = exactAgeOn(anchor.birthDate, input.onKstDate)
  const span = parseAgeBand(input.ageBand)
  if (age === null || span === null) {
    return { ok: false, code: 'NO_BAND', reason: '나이를 계산할 수 없다' }
  }
  if (age < span.from || age > span.to) {
    return {
      ok: false, code: 'OUT_OF_BAND',
      reason: `🔴 계산한 나이 ${age} 가 정본 ${input.ageBand}(${span.from}~${span.to}) 밖이다`
        + ` — 카드를 갱신해야 한다. 임의로 쓰지 않는다`,
    }
  }
  return { ok: true, age, birthDate: anchor.birthDate }
}

export type LifeConsistencyProblem = { axis: string; reason: string }

/**
 * 🔴 **정확한 나이가 다른 생활사와 모순되지 않는가.**
 *    자녀 나이·혼인·갱년기와 어긋나면 그 나이를 쓰지 않는다.
 */
export function checkLifeConsistency(input: {
  age: number
  childrenAgeBands?: readonly string[] | null
  maritalStatus?: string | null
  menopauseStatus?: string | null
}): LifeConsistencyProblem[] {
  const out: LifeConsistencyProblem[] = []
  // 🔴 자녀가 있으면 적어도 그 나이 + 18 이어야 말이 된다
  for (const b of input.childrenAgeBands ?? []) {
    const m = /(\d{1,2})/.exec(String(b))
    if (m === null) continue
    const childAge = Number(m[1])
    if (Number.isFinite(childAge) && input.age - childAge < 18) {
      out.push({ axis: 'children', reason: `자녀 ${childAge}세인데 화자가 ${input.age}세다` })
    }
  }
  // 🔴 갱년기 '후' 인데 40대 초반이면 어긋난다
  if ((input.menopauseStatus ?? '') === '후' && input.age < 45) {
    out.push({ axis: 'menopause', reason: `갱년기 '후' 인데 ${input.age}세다` })
  }
  return out
}
