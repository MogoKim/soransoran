/**
 * 운영 Persona 말투 배정 **digest** — 🔴 원문을 담지 않는 지문 (2026-10-13)
 *
 * 🔴 코드 정렬 · 보충 화자 같은 기반 변경이 운영 Persona 의 묶음을 바꾸지 않았는지 전후로 대조한다.
 *    값은 `scripts/__fixtures__/persona-voice-assignment-digests.json` 에 고정돼 있다.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'

export const VOICE_DIGEST_FIXTURE = 'scripts/__fixtures__/persona-voice-assignment-digests.json'

export function bundleDigest(b: VoiceReferenceBundle | undefined): string {
  return b === undefined ? '∅'
    : createHash('sha256').update(JSON.stringify({ t: b.comments.map((x) => x.text), s: b.style, o: b.observedCount })).digest('hex').slice(0, 16)
}

export type VoiceDigestFixture = { sourceDigest: string; order: string[]; digests: Record<string, string> }

export function loadVoiceDigestFixture(repoRoot: string): VoiceDigestFixture {
  return JSON.parse(readFileSync(`${repoRoot}/${VOICE_DIGEST_FIXTURE}`, 'utf-8')) as VoiceDigestFixture
}

/**
 * 🔴 **대조 — 같은 자산일 때만 뜻이 있다.** 자산이 없거나 다르면 `notRun` 이다(통과가 아니다).
 */
export function compareVoiceDigests(input: {
  fixture: VoiceDigestFixture
  sourceDigest: string | null
  order: readonly string[]
  byCode: ReadonlyMap<string, VoiceReferenceBundle>
}): { status: 'same' | 'changed' | 'notRun'; changed: string[]; reason: string } {
  if (input.sourceDigest === null) return { status: 'notRun', changed: [], reason: '정본 말투 자산이 없다' }
  if (input.sourceDigest !== input.fixture.sourceDigest) {
    return { status: 'notRun', changed: [], reason: `정본 자산이 다르다 (${input.sourceDigest} ≠ ${input.fixture.sourceDigest})` }
  }
  const changed: string[] = []
  if (input.order.join(',') !== input.fixture.order.join(',')) changed.push('순서')
  for (const c of input.fixture.order) if (bundleDigest(input.byCode.get(c)) !== input.fixture.digests[c]) changed.push(c)
  return { status: changed.length === 0 ? 'same' : 'changed', changed, reason: '' }
}
