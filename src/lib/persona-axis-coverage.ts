/**
 * 축 두께 자동 산출 — 🔴 **순수 함수. 얇은 축을 사람이 고르지 않는다** (2026-09-08)
 *
 * 🔴 왜 자동이어야 하는가.
 *    "이 축이 얇다" 를 사람이 고르면, 고른 축만 두터워지고 나머지는 계속 1명으로 남는다.
 *    Pool 을 24명으로 늘릴 때 **무엇을 보강할지**는 지금 카드가 정해야 한다.
 *
 * 🔴 세 종류를 함께 본다 — 하나만 보면 다른 축이 조용히 얇아진다.
 *      ① 생활사 축   자녀 나이대 · 혼인 · 돌봄 · 갱년기 · 일 · 형편 · 주거
 *      ② 반응 역할 축 그 역할을 **맡을 수 있는** 사람 수 (금지 목록의 여집합)
 *      ③ 문체 길이 축 짧게 · 보통 · 길게
 */

import { REACTION_ROLES } from './persona-pool-card'
import { readLengthBand } from './original-post-persona-match'

/** 축 하나를 판정하는 데 필요한 최소 정보 — Pool 카드와 DB persona 양쪽에서 만든다 */
export type AxisSubject = {
  code: string
  childrenAgeBands: readonly string[]
  childrenCount: number | null
  maritalStatus: string | null
  parentCare: string | null
  menopauseStatus: string | null
  workStatus: string | null
  economicStatus: string | null
  housing: string | null
  /** 🔴 **금지** 역할이다. 맡을 수 있는 역할은 이것의 여집합이다 */
  forbiddenReactionRoles: readonly string[]
  /**
   * 🔴 **원문 토큰 그대로** 넣는다 (`짧고 툭툭` · `중간 길이` · `길게 씀` …).
   *    밴드로 바꾸는 것은 `readLengthBand` 하나뿐이다 — 여기서 문자열을 직접 비교하면
   *    `중간 길이` 가 어느 밴드에도 안 걸려 **문체 축이 통째로 0명으로 보인다**(실측).
   */
  voiceLength: string | null
}

/** 🔴 두께 2명 미만이면 얇다 — 한 명이 쉬면 그 축이 통째로 막힌다 */
export const THIN_THRESHOLD = 2

export type AxisKind = 'life' | 'reaction' | 'voice'
export type AxisCoverage = { axis: string; kind: AxisKind; holders: string[] }

const LIFE_AXES: ReadonlyArray<{ axis: string; has: (s: AxisSubject) => boolean }> = [
  { axis: '자녀 영유아', has: (s) => s.childrenAgeBands.includes('영유아') },
  { axis: '자녀 초등', has: (s) => s.childrenAgeBands.includes('초등') },
  { axis: '자녀 중고등', has: (s) => s.childrenAgeBands.includes('중고등') },
  { axis: '자녀 대학·취준', has: (s) => s.childrenAgeBands.includes('대학·취준') },
  { axis: '자녀 성인', has: (s) => s.childrenAgeBands.includes('성인') },
  { axis: '무자녀', has: (s) => s.childrenCount === 0 },
  { axis: '기혼', has: (s) => s.maritalStatus === '기혼' },
  { axis: '이혼', has: (s) => s.maritalStatus === '이혼' },
  { axis: '사별', has: (s) => s.maritalStatus === '사별' },
  { axis: '비혼', has: (s) => s.maritalStatus === '비혼' },
  { axis: '별거', has: (s) => s.maritalStatus === '별거' },
  { axis: '돌봄 없음', has: (s) => s.parentCare === '없음' },
  { axis: '돌봄 간헐', has: (s) => s.parentCare === '간헐' },
  { axis: '돌봄 상시', has: (s) => s.parentCare === '상시' },
  { axis: '갱년기 전', has: (s) => s.menopauseStatus === '전' },
  { axis: '갱년기 진행중', has: (s) => s.menopauseStatus === '진행중' },
  { axis: '갱년기 후', has: (s) => s.menopauseStatus === '후' },
]

/** 🔴 카드 표기가 자유 서술이라 **포함**으로 본다 — 정확 일치를 요구하면 전부 0명이 된다 */
const CONTAINS_AXES: ReadonlyArray<{ axis: string; pick: (s: AxisSubject) => string | null; key: string }> = [
  { axis: '일: 전업', pick: (s) => s.workStatus, key: '전업' },
  { axis: '일: 파트타임', pick: (s) => s.workStatus, key: '파트' },
  { axis: '일: 자영', pick: (s) => s.workStatus, key: '자영' },
  { axis: '일: 직장', pick: (s) => s.workStatus, key: '직장' },
  { axis: '형편: 빠듯', pick: (s) => s.economicStatus, key: '빠듯' },
  { axis: '형편: 보통', pick: (s) => s.economicStatus, key: '보통' },
  { axis: '형편: 여유', pick: (s) => s.economicStatus, key: '여유' },
  { axis: '주거: 자가', pick: (s) => s.housing, key: '자가' },
  { axis: '주거: 전월세', pick: (s) => s.housing, key: '전' },
]

export function coverageOf(subjects: readonly AxisSubject[]): AxisCoverage[] {
  const out: AxisCoverage[] = []
  for (const a of LIFE_AXES) {
    out.push({ axis: a.axis, kind: 'life', holders: subjects.filter(a.has).map((s) => s.code) })
  }
  for (const a of CONTAINS_AXES) {
    out.push({
      axis: a.axis, kind: 'life',
      holders: subjects.filter((s) => (a.pick(s) ?? '').includes(a.key)).map((s) => s.code),
    })
  }
  // 🔴 반응 역할 — **맡을 수 있는** 사람. 금지 목록의 여집합이다
  for (const role of REACTION_ROLES) {
    out.push({
      axis: `반응: ${role}`, kind: 'reaction',
      holders: subjects.filter((s) => !s.forbiddenReactionRoles.includes(role)).map((s) => s.code),
    })
  }
  // 🔴 문체 길이 — **정본 판정기로 밴드를 읽는다.** 모르는 카드는 어느 축에도 넣지 않는다
  for (const band of ['짧게', '보통', '길게'] as const) {
    out.push({
      axis: `문체: ${band}`, kind: 'voice',
      holders: subjects.filter((s) => readLengthBand(s.voiceLength) === band).map((s) => s.code),
    })
  }
  return out
}

/** 🔴 얇은 축 — 두께가 임계 미만. **얇은 순서대로** 돌려준다 */
export function thinAxes(subjects: readonly AxisSubject[], threshold = THIN_THRESHOLD): AxisCoverage[] {
  return coverageOf(subjects)
    .filter((c) => c.holders.length < threshold)
    .sort((a, b) => a.holders.length - b.holders.length || a.axis.localeCompare(b.axis))
}

/**
 * 🔴 새 카드가 얇은 축을 **실제로 메우는가.**
 *    "설계했다" 가 아니라 두께가 올라갔는지를 숫자로 본다.
 */
export function gainOf(
  before: readonly AxisSubject[],
  after: readonly AxisSubject[],
  threshold = THIN_THRESHOLD,
): { axis: string; kind: AxisKind; before: number; after: number; fixed: boolean }[] {
  const b = new Map(coverageOf(before).map((c) => [c.axis, c]))
  return coverageOf(after)
    .map((c) => {
      const prev = b.get(c.axis)?.holders.length ?? 0
      return {
        axis: c.axis, kind: c.kind, before: prev, after: c.holders.length,
        fixed: prev < threshold && c.holders.length >= threshold,
      }
    })
    .filter((x) => x.before < threshold)
    .sort((a, b2) => a.before - b2.before || a.axis.localeCompare(b2.axis))
}

/** 사람이 읽을 한 줄 */
export function describeThin(subjects: readonly AxisSubject[]): string {
  const thin = thinAxes(subjects)
  if (thin.length === 0) return '얇은 축 없음'
  return thin.map((c) => `${c.axis}(${c.holders.length})`).join(' · ')
}
