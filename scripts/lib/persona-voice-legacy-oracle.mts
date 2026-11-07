/**
 * 🔴 **시험 전용 — 옛 Gate ⑧ 반복 축 판정 oracle** (`2ff939dd` 의 `checkVoiceFingerprint` 를 그대로 옮겼다)
 *
 *   옛 판: 표본 = prior + 후보 · 축마다 최빈 점유율 하나를 임계와 비교한다(후보 소속을 보지 않는다).
 *   새 판(`src/lib/persona-voice-repeat`)과 **비교할 때만** 쓴다. 운영 코드는 이 파일을 import 하지 않는다.
 *   🔴 표본 부족(notRun)과 빈 후보는 비교 대상이 아니다 — 부르는 쪽이 n+1 ≥ minSamples 이고 후보가 비지 않은 경우만 넘긴다.
 */
import { DEFAULT_FINGERPRINT_THRESHOLDS as TH } from '../../src/lib/persona-fingerprint-thresholds'
import { endingOf, hookOf, type RepeatAxis } from '../../src/lib/persona-voice-repeat'

export type LegacyBand = 'pass' | 'review' | 'regenerate'
export const LEGACY_RANK: Readonly<Record<LegacyBand, number>> = { pass: 0, review: 1, regenerate: 2 }

const topShare = (values: readonly string[]): number => {
  const counts = new Map<string, number>()
  for (const v of values) { if (v === '') continue; counts.set(v, (counts.get(v) ?? 0) + 1) }
  return counts.size === 0 ? 0 : Math.max(...counts.values()) / values.length
}
const topNgram = (texts: readonly string[]): number => {
  const df = new Map<string, number>()
  for (const t of texts) {
    const s = t.replace(/\s+/g, '')
    const gs = new Set<string>()
    for (let i = 0; i + 3 <= s.length; i++) gs.add(s.slice(i, i + 3))
    for (const g of gs) df.set(g, (df.get(g) ?? 0) + 1)
  }
  return df.size === 0 ? 0 : Math.max(...df.values()) / texts.length
}
const band = (v: number, review: number, regen: number): LegacyBand => (v >= regen ? 'regenerate' : v >= review ? 'review' : 'pass')

/** 옛 판정 — 한 축 */
export function legacyAxisBand(axis: RepeatAxis, prior: readonly string[], candidate: string): LegacyBand {
  const sample = [...prior, candidate]
  if (axis === 'ENDING') return band(topShare(sample.map(endingOf)), TH.endingReview, TH.endingRegen)
  if (axis === 'HOOK') return band(topShare(sample.map(hookOf)), TH.hookReview, TH.hookRegen)
  return band(topNgram(sample), TH.ngramReview, TH.ngramRegen)
}

/** 옛 판정 — 세 반복 축 가운데 가장 엄격한 것(⑧ 반복 축 결과) */
export function legacyRepeatBand(prior: readonly string[], candidate: string): LegacyBand {
  const bands = (['ENDING', 'HOOK', 'NGRAM'] as const).map((a) => legacyAxisBand(a, prior, candidate))
  return bands.reduce((a, b) => (LEGACY_RANK[a] >= LEGACY_RANK[b] ? a : b), 'pass')
}
