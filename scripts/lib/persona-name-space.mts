/**
 * Persona 표시명 **구분 선택** — 🔴 Gate ⑥-B 를 그대로 부른다. DB · 네트워크 0 (2026-10-13)
 *
 * 🔴 옛 `assignCandidates` 는 묶음 안에서 **완전히 같은 이름**만 피했다 — 같은 묶음의 `봄수국` · `밤수국` 처럼
 *    서로 헷갈리는 이름을 함께 고를 수 있었다. 여기서는 이미 고른 이름까지 대조 집합(B3)에 넣어 본다.
 *
 * 🔴 대조 집합(회원 이름 · 기존 Persona 이름 전부)은 부르는 쪽이 준다 — 회원 이름이 없으면 `bound: 'upper'` 다.
 * 🔴 한 명이라도 못 고르면 전원 실패다. 일부만 만들지 않는다.
 */
import { nicknameSpace } from '../../src/lib/persona-nickname-space'
import { checkNameCollision, type NameCollisionSets } from './persona-gate-name-collision.mjs'

const passes = (name: string, sets: NameCollisionSets, picked: readonly string[]): boolean =>
  checkNameCollision(name, { ...sets, personaNames: [...(sets.personaNames ?? []), ...picked] }).status === 'pass'

/**
 * 🔴 **공간에서 서로 · 기존과 헷갈리지 않는 이름을 결정적 순서로 고른다.** 탐욕 선택이라 최대 독립 집합보다
 *    작을 수 있다 — 이 값은 "적어도 이만큼은 고를 수 있다" 는 하한 쪽 실측이다.
 */
export function selectDistinctNames(input: {
  sets: NameCollisionSets
  space?: readonly string[]
  limit?: number
}): { picked: string[]; space: number; bound: 'exact' | 'upper' } {
  const space = input.space ?? nicknameSpace()
  const picked: string[] = []
  for (const n of space) {
    if (input.limit !== undefined && picked.length >= input.limit) break
    if (passes(n, input.sets, picked)) picked.push(n)
  }
  return { picked, space: space.length, bound: input.sets.memberNames === undefined ? 'upper' : 'exact' }
}

/**
 * 🔴 **코드마다 하나씩** — `assignCandidates` 와 같은 모양으로 돌려준다(부르는 쪽 교체가 한 줄이게).
 *    코드 순서대로 공간 앞에서부터 배정한다 — 같은 입력이면 같은 결과다.
 */
export function assignDistinctNames(
  codes: readonly string[],
  sets: NameCollisionSets,
  space: readonly string[] = nicknameSpace(),
): { ok: boolean; picked: Map<string, string>; problems: string[] } {
  const chosen = selectDistinctNames({ sets, space, limit: codes.length }).picked
  const picked = new Map<string, string>()
  const problems: string[] = []
  codes.forEach((code, i) => {
    const name = chosen[i]
    if (name === undefined) problems.push(`${code}: 공간 ${space.length}개에서 서로·기존과 헷갈리지 않는 이름이 모자라다`)
    else picked.set(code, name)
  })
  return { ok: problems.length === 0 && picked.size === codes.length, picked, problems }
}
