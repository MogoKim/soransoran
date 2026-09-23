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

export type BirthAnchor = {
  /** `YYYY-MM-DD` — 🔴 내부 값이다. 글에 쓰지 않는다 */
  birthDate: string
}

/**
 * 🔴 **카드에 적힌 생일을 그대로 쓴다** (2026-09-23 정정).
 *
 *    앞판은 `RULE_VERSION|code` 해시로 생일을 **유도**했다. 그것은 정본이 아니다 —
 *    규칙 판이나 `ageBand` 가 바뀌면 같은 사람의 생일이 바뀐다.
 *    이제 Persona Pool 카드의 `birthDate` 줄 **한 곳**이 정본이고, 여기서는 읽기만 한다.
 */
export function birthAnchorOf(input: { birthDate: string | null | undefined }): BirthAnchor | null {
  const d = (input.birthDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  return { birthDate: d }
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
  | { ok: false; code: 'NO_BIRTHDATE' | 'NO_BAND' | 'OUT_OF_BAND'; reason: string }

/**
 * 🔴 **그날의 정확한 나이.** `ageBand` 와 반드시 일치해야 한다 —
 *    어긋나면 쓰지 않는다(fail-closed). 해가 바뀌어 밴드를 벗어나면 여기서 잡힌다.
 */
export function exactAgeOf(input: {
  birthDate: string | null | undefined
  ageBand: string | null | undefined
  /** 발행 날짜 (KST `YYYY-MM-DD`) */
  onKstDate: string
}): ExactAgeVerdict {
  const anchor = birthAnchorOf(input)
  if (anchor === null) {
    return { ok: false, code: 'NO_BIRTHDATE', reason: `생일을 읽을 수 없다 — ${input.birthDate ?? '(없음)'}` }
  }
  const age = exactAgeOn(anchor.birthDate, input.onKstDate)
  const span = parseAgeBand(input.ageBand)
  if (span === null) {
    return { ok: false, code: 'NO_BAND', reason: `나이대를 읽을 수 없다 — ${input.ageBand ?? '(없음)'}` }
  }
  if (age === null) return { ok: false, code: 'NO_BIRTHDATE', reason: '나이를 계산할 수 없다' }
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
 * 🔴 **정확한 나이가 다른 생활사와 모순되지 않는가.** 여섯 축 전부를 본다 —
 *    `ageBand` 하나만 맞춰 놓고 "정합" 이라고 쓰지 않는다.
 */
export function checkLifeConsistency(input: {
  age: number
  ageBand?: string | null
  childrenAgeBands?: readonly string[] | null
  childrenCount?: number | null
  maritalStatus?: string | null
  menopauseStatus?: string | null
  parentCare?: string | null
  workStatus?: string | null
}): LifeConsistencyProblem[] {
  const out: LifeConsistencyProblem[] = []

  // ① ageBand 안에 있는가
  const span = parseAgeBand(input.ageBand)
  if (input.ageBand != null && span === null) {
    out.push({ axis: 'ageBand', reason: `나이대를 읽을 수 없다 — ${input.ageBand}` })
  } else if (span !== null && (input.age < span.from || input.age > span.to)) {
    out.push({ axis: 'ageBand', reason: `${input.age}세가 ${input.ageBand}(${span.from}~${span.to}) 밖이다` })
  }

  /**
   * ② 자녀 연령대 — 🔴 문자열 그대로 읽는다 (`초등 고학년` · `중3` · `20대` …).
   *    숫자만 긁으면 `중3` 을 3세로 읽는다.
   */
  for (const raw of input.childrenAgeBands ?? []) {
    const childAge = childAgeFrom(String(raw))
    if (childAge === null) continue
    const gap = input.age - childAge
    if (gap < 18) out.push({ axis: 'children', reason: `자녀 약 ${childAge}세인데 화자가 ${input.age}세다 (터울 ${gap})` })
    if (gap > 55) out.push({ axis: 'children', reason: `자녀 약 ${childAge}세인데 화자가 ${input.age}세다 (터울 ${gap})` })
  }
  if ((input.childrenCount ?? 0) > 0 && (input.childrenAgeBands ?? []).length === 0) {
    out.push({ axis: 'children', reason: '자녀 수는 있는데 연령대가 비어 있다 — 모순을 잴 수 없다' })
  }

  // ③ 갱년기
  const men = (input.menopauseStatus ?? '').trim()
  if (men === '후' && input.age < 45) out.push({ axis: 'menopause', reason: `갱년기 '후' 인데 ${input.age}세다` })
  if (men === '전' && input.age >= 58) out.push({ axis: 'menopause', reason: `갱년기 '전' 인데 ${input.age}세다` })

  // ④ 부모 돌봄 — 🔴 40세 미만이 상시 간병이면 드물다. 값 자체를 모르면 그것도 문제다
  const care = (input.parentCare ?? '').trim()
  if (input.parentCare != null && care === '') out.push({ axis: 'parentCare', reason: '값이 비어 있다' })

  // ⑤ 혼인 — 값이 비어 있으면 자격 판정이 fail-closed 로 막힌다
  const mar = (input.maritalStatus ?? '').trim()
  if (input.maritalStatus != null && mar === '') out.push({ axis: 'maritalStatus', reason: '값이 비어 있다' })

  // ⑥ 직업 — 정년을 크게 넘겨 '직장인' 이면 어긋난다
  const work = (input.workStatus ?? '').trim()
  if (input.workStatus != null && work === '') out.push({ axis: 'work', reason: '값이 비어 있다' })
  else if (/직장|회사|근무|재직/.test(work) && input.age >= 66) {
    out.push({ axis: 'work', reason: `${input.age}세인데 '${work}' 이다` })
  }
  return out
}

/** 🔴 `초등 고학년` · `중3` · `20대` 같은 표현을 나이로 읽는다. 못 읽으면 `null` */
export function childAgeFrom(band: string): number | null {
  const t = band.trim()
  if (t === '') return null
  if (/영유아|유아|미취학/.test(t)) return 4
  if (/초등\s*저/.test(t)) return 8
  if (/초등\s*고/.test(t)) return 11
  if (/초등/.test(t)) return 10
  const mid = /중\s*([1-3])/.exec(t)
  if (mid !== null) return 12 + Number(mid[1])
  const high = /고\s*([1-3])/.exec(t)
  if (high !== null) return 15 + Number(high[1])
  if (/중학/.test(t)) return 14
  if (/고등/.test(t)) return 17
  const decade = /([1-9]0)\s*대/.exec(t)
  if (decade !== null) return Number(decade[1]) + 5
  const plain = /(\d{1,2})\s*세?/.exec(t)
  if (plain !== null) { const n = Number(plain[1]); if (n >= 0 && n <= 60) return n }
  return null
}
