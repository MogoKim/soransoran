/**
 * Gate ⑧ 반복 축(말끝 · 시작어절 · 3-gram) **후보 귀속 판정** — 🔴 순수 함수. DB · 파일 · 시계 · 네트워크 없음
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md §3-⑧
 *       "②는 이 표현을 써도 되는가를 보고, ⑧은 **이 표현을 또 쓰는가**를 본다."
 *
 * 🔴 **왜 바꿨나** (2026-11-07 D20 · COMMENT_MISSING).
 *
 *    옛 판은 `prior + 후보` 표본의 최빈 점유율만 봤다. 그래서 이전 발화(prior)만으로 이미 임계를 넘은
 *    Persona 는 **어떤 후보를 넣어도** regenerate 였다 — 후보는 최빈 개수를 늘릴 수만 있고 줄일 수 없다.
 *    실측: P14·P24(3-gram 4/4) · P17·P26(시작어절 2/4) · P39(말끝 2/4)가 이 상태로 영구 잠겼고,
 *    planner 의 "적게 쓴 사람 우선" 이 그들을 매번 맨 앞에 세워 혼자 공개된 글의 60분을 다 썼다.
 *    n=60 이어도 같다 — 말끝 24/60 은 후보가 그 말끝을 안 써도 24/61=0.393 으로 review(≥0.33)라 막힌다.
 *
 * 🔴 **새 계약 — 임계는 하나도 바꾸지 않는다.** 임계를 넘은 패턴(`over`) 가운데 **후보가 속한 것**이 있을 때만
 *    그 단계(regenerate · review)로 막는다. 후보가 속하지 않은 패턴만 넘었으면 `BASELINE_ONLY` — 통과하고 관측한다.
 *
 *      · **막는 단계 = 후보가 속한 임계 패턴 가운데 가장 높은 단계.** prior 만 넘은 더 높은 단계가 같은 축에 있어도
 *        그 단계를 후보에게 지우지 않는다. 예: 말끝 `같아요` 3/6(=0.50, regenerate · 후보 무관)과 후보가 쓴 `좋아요` 2/6
 *        (=0.33, review) → review 로 막는다(옛 판정은 regenerate). 둘 다 적재를 막는다 — 단계 이름만 원인을 따른다.
 *      · 막느냐 마느냐만 보면, 후보가 임계 패턴에 속하는 한 옛 판정과 같다. 통과로 바뀌는 것은 후보가 어느 임계 패턴에도
 *        속하지 않을 때뿐이다(그때 옛 판정은 prior 만으로 정해져 후보에 대해 아무것도 말하지 않았다).
 *      · 후보가 우세 패턴을 다시 쓰면(재사용) 점유율이 같거나 오른다(악화) — 둘 다 소속이라 막힌다.
 *      · 표본 부족(notRun)과 빈 후보는 이 비교의 대상이 아니다 — 각각 bootstrap 경로 · 별도 거절(`checkVoiceFingerprint`)이다.
 *
 * 🔴 seed 재사용 · 구조화 나열(TIDY)은 이 파일의 일이 아니다. seed 는 후보와 무관한 고정값이라
 *    `judgeStaticVoiceCapability` 가 유료 호출 **전에** 막고, TIDY 는 후보 자체의 위반이라 Gate 가 그대로 막는다.
 *
 * 🔴 반환값에 패턴 문자열을 담지 않는다(판정 · 로그용). 프롬프트 회피 표지(`dominantRepeatMarks`)만 패턴을 돌려준다 —
 *    이 Persona 자신이 이미 공개한 발화의 말끝 3자 · 첫 어절 · 3글자 조각이고, 원문 · 출처 본문은 아니다.
 */
import { DEFAULT_FINGERPRINT_THRESHOLDS, type FingerprintThresholds } from './persona-fingerprint-thresholds'

export const REPEAT_AXES = ['ENDING', 'HOOK', 'NGRAM'] as const
export type RepeatAxis = (typeof REPEAT_AXES)[number]
export type RepeatBand = 'pass' | 'review' | 'regenerate'
/** `NONE` 임계 패턴 없음 · `CANDIDATE` 후보가 임계 패턴에 속함(막음) · `BASELINE_ONLY` prior 만 넘음(통과 · 관측) */
export type RepeatCause = 'NONE' | 'CANDIDATE' | 'BASELINE_ONLY'

// ─────────────────────────────────────────────────────────
// 패턴 — 🔴 추출 규칙의 정본은 여기 하나다(Gate ⑧ · 프롬프트 회피 표지가 같이 쓴다)
// ─────────────────────────────────────────────────────────

/** 말끝 — 종결 기호 · 웃음 표기를 떼고 마지막 3자 */
export const endingOf = (t: string): string => t.replace(/[\s.!?~ㅋㅎ,]+$/u, '').slice(-3)
/** 시작 — 첫 어절 */
export const hookOf = (t: string): string => t.trim().split(/\s+/)[0] ?? ''
/** 공백을 지운 3글자 조각 — 한 발화 안의 반복은 한 번만 센다(문서빈도) */
export const gramsOf = (t: string): string[] => {
  const s = t.replace(/\s+/g, '')
  const out = new Set<string>()
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3))
  return [...out]
}

/** 발화 하나가 그 축에서 가진 패턴 — 빈 값은 패턴이 아니다 */
export function patternsOf(axis: RepeatAxis, text: string): string[] {
  if (axis === 'NGRAM') return gramsOf(text)
  const v = axis === 'ENDING' ? endingOf(text) : hookOf(text)
  return v === '' ? [] : [v]
}

/** 패턴별 **발화 수**(문서빈도). 분모는 언제나 표본 발화 수다 — 빈 패턴 발화도 분모에 든다(옛 판과 같다) */
export function countPatterns(axis: RepeatAxis, texts: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const t of texts) for (const p of patternsOf(axis, t)) counts.set(p, (counts.get(p) ?? 0) + 1)
  return counts
}

const maxOf = (m: ReadonlyMap<string, number>): number => (m.size === 0 ? 0 : Math.max(...m.values()))

export function thresholdsOf(axis: RepeatAxis, th: FingerprintThresholds): { review: number; regen: number } {
  if (axis === 'ENDING') return { review: th.endingReview, regen: th.endingRegen }
  if (axis === 'HOOK') return { review: th.hookReview, regen: th.hookRegen }
  return { review: th.ngramReview, regen: th.ngramRegen }
}

// ─────────────────────────────────────────────────────────
// 판정 — baseline(prior) · after(prior + 후보) · attribution(후보 소속)
// ─────────────────────────────────────────────────────────

export type RepeatAxisVerdict = {
  axis: RepeatAxis
  band: RepeatBand
  cause: RepeatCause
  /** prior 만의 최빈 점유율(분모 prior 수) — 관측용. prior 가 없으면 0 */
  baselineShare: number
  /** prior + 후보 표본의 최빈 점유율 — 옛 판이 보던 값 */
  afterShare: number
  /** 후보가 속한 패턴 가운데 최대 점유율(after 표본) — 후보가 속한 패턴이 없으면 0 */
  candidateShare: number
}

/**
 * 한 축 판정. 🔴 표본 크기(`minSamples`) 판정은 부르는 쪽(`judgeRepeatAxes`)이 한다 — 여기서는 숫자만 본다.
 *
 *   over_L = { p : after(p) / (n+1) ≥ th_L }      L = regenerate → review 순
 *   over_L 에 후보 소속 패턴이 있다   → band L · CANDIDATE   (= 후보가 속한 패턴 중 가장 높은 단계)
 *   over_L 이 비지 않았는데 소속 없음 → 그 단계는 후보에게 지우지 않는다 · 다음(낮은) 단계를 본다
 *   어느 단계에도 소속이 없다         → pass (임계 패턴이 하나라도 있었으면 BASELINE_ONLY)
 */
export function judgeRepeatAxis(
  axis: RepeatAxis, prior: readonly string[], candidate: string, th: FingerprintThresholds,
): RepeatAxisVerdict {
  const sample = [...prior, candidate]
  const size = sample.length
  const after = countPatterns(axis, sample)
  const mine = new Set(patternsOf(axis, candidate))
  const base = countPatterns(axis, prior)
  const baselineShare = prior.length === 0 ? 0 : maxOf(base) / prior.length
  const afterShare = maxOf(after) / size
  let candidateShare = 0
  for (const p of mine) candidateShare = Math.max(candidateShare, (after.get(p) ?? 0) / size)

  const t = thresholdsOf(axis, th)
  let baselineOver = false
  for (const [band, limit] of [['regenerate', t.regen], ['review', t.review]] as const) {
    const over = [...after].filter(([, c]) => c / size >= limit).map(([p]) => p)
    if (over.some((p) => mine.has(p))) {
      return { axis, band, cause: 'CANDIDATE', baselineShare, afterShare, candidateShare }
    }
    if (over.length > 0) baselineOver = true
  }
  return { axis, band: 'pass', cause: baselineOver ? 'BASELINE_ONLY' : 'NONE', baselineShare, afterShare, candidateShare }
}

export type RepeatAxesVerdict = {
  /** 표본(prior + 후보)이 `minSamples` 이상이라 반복 축을 쟀는가 — 아니면 `axes` 는 비고 Gate 는 notRun 이다 */
  ran: boolean
  sampleSize: number
  axes: RepeatAxisVerdict[]
}

export function judgeRepeatAxes(
  prior: readonly string[], candidate: string, th: FingerprintThresholds = DEFAULT_FINGERPRINT_THRESHOLDS,
): RepeatAxesVerdict {
  const sampleSize = prior.length + 1
  if (sampleSize < th.minSamples) return { ran: false, sampleSize, axes: [] }
  return { ran: true, sampleSize, axes: REPEAT_AXES.map((a) => judgeRepeatAxis(a, prior, candidate, th)) }
}

// ─────────────────────────────────────────────────────────
// 후보와 무관한 고정 축 — 유료 호출 전에 쓴다
// ─────────────────────────────────────────────────────────

export type StaticVoiceCode = 'SEED_REUSE_LOCKED' | 'SEED_SHARE_UNKNOWN'

/**
 * 🔴 **어떤 후보로도 바꿀 수 없는 ⑧ 결과**만 여기서 막는다.
 *    seed 공유 수는 고정 배정에서 나온 Persona 단위 값이다 — 후보 문장과 무관하게 ⑧ 이 review(≥2)·regenerate(≥3)가 된다.
 *    review 도 적재를 막으므로(`fullGatePass` 는 전부 pass) 공유 2 이상이면 이 Persona 는 이 레인에서 쓸 수 없다.
 *    🔴 반복 축은 여기 오지 않는다 — 후보 귀속 판정에서는 반복 축이 언제나 후보에 따라 달라진다(영구 잠금이 없다).
 */
export function judgeStaticVoiceCapability(
  input: { seedShare: number | null }, th: FingerprintThresholds = DEFAULT_FINGERPRINT_THRESHOLDS,
): { capable: boolean; codes: StaticVoiceCode[] } {
  if (input.seedShare === null || !Number.isFinite(input.seedShare)) return { capable: false, codes: ['SEED_SHARE_UNKNOWN'] }
  if (input.seedShare >= th.seedReuseReview) return { capable: false, codes: ['SEED_REUSE_LOCKED'] }
  return { capable: true, codes: [] }
}

/**
 * 🔴 **첫 댓글을 쓸 수 있는 사람 수** — readiness 관측(막는 코드가 아니다). 계약 유효 코드 가운데 고정 잠금을 뺀다.
 *    seed 공유 수 조회는 부르는 쪽이 넘긴다(운영 댓글 경로와 같은 고정 배정 · 같은 함수). 조회가 던지면 모름(null)으로 본다.
 */
export function commentCapableOf(
  codes: readonly string[], seedShareOf: (code: string) => number | null,
): { commentCapable: number; staticLocked: { code: string; codes: StaticVoiceCode[] }[] } {
  const staticLocked: { code: string; codes: StaticVoiceCode[] }[] = []
  for (const code of codes) {
    let seedShare: number | null
    try { seedShare = seedShareOf(code) } catch { seedShare = null }
    const v = judgeStaticVoiceCapability({ seedShare })
    if (!v.capable) staticLocked.push({ code, codes: v.codes })
  }
  return { commentCapable: codes.length - staticLocked.length, staticLocked }
}

// ─────────────────────────────────────────────────────────
// 프롬프트 회피 표지 — "이것을 또 쓰면 ⑧ 이 막는다" 를 정확히 그 패턴으로
// ─────────────────────────────────────────────────────────

/** 축마다 실을 최대 개수 — 목록이 길면 지시가 아니게 된다 */
export const MAX_DOMINANT_MARKS = 6

export type DominantRepeatMarks = { endings: string[]; hooks: string[]; grams: string[] }

/**
 * 후보가 **다시 쓰면 막히는** 패턴: `(prior(p) + 1) / (n + 1) ≥ review`.
 *    Gate 와 같은 추출 · 같은 임계 · 같은 표본 크기다. 표본이 모자라 ⑧ 이 돌지 않으면 비운다.
 *    많은 순 · 같으면 문자열 순(결정적).
 */
export function dominantRepeatMarks(
  prior: readonly string[], th: FingerprintThresholds = DEFAULT_FINGERPRINT_THRESHOLDS,
): DominantRepeatMarks {
  const texts = prior.map((t) => (t ?? '').trim()).filter((t) => t !== '')
  const size = texts.length + 1
  const pick = (axis: RepeatAxis): string[] => {
    if (size < th.minSamples) return []
    const limit = thresholdsOf(axis, th).review
    return [...countPatterns(axis, texts)]
      .filter(([, c]) => (c + 1) / size >= limit)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, MAX_DOMINANT_MARKS)
      .map(([p]) => p)
  }
  return { endings: pick('ENDING'), hooks: pick('HOOK'), grams: pick('NGRAM') }
}

// ─────────────────────────────────────────────────────────
// 원인 표식 — Gate detail 앞의 기계용 꼬리표. 로그가 후보 원인 · 기준선 원인을 가른다
// ─────────────────────────────────────────────────────────

const CAUSE_TAG_RE = /^\[cause=([A-Z_:|]*)\] /

/** `[cause=CANDIDATE:HOOK|BASELINE_ONLY:NGRAM] ` — 축 이름과 원인만(패턴 · 본문 없음) */
export function formatVoiceCause(axes: readonly RepeatAxisVerdict[]): string {
  const parts = axes.filter((a) => a.cause !== 'NONE').map((a) => `${a.cause}:${a.axis}`)
  return parts.length === 0 ? '' : `[cause=${parts.join('|')}] `
}

export type VoiceCauseSummary = { candidate: RepeatAxis[]; baselineOnly: RepeatAxis[] }

export function parseVoiceCause(detail: string | undefined): VoiceCauseSummary {
  const out: VoiceCauseSummary = { candidate: [], baselineOnly: [] }
  const m = CAUSE_TAG_RE.exec(detail ?? '')
  if (m === null) return out
  for (const part of m[1]!.split('|')) {
    const [cause, axis] = part.split(':')
    if (!(REPEAT_AXES as readonly string[]).includes(axis ?? '')) continue
    if (cause === 'CANDIDATE') out.candidate.push(axis as RepeatAxis)
    else if (cause === 'BASELINE_ONLY') out.baselineOnly.push(axis as RepeatAxis)
  }
  return out
}

/** Gate 결과 목록에서 ⑧ 원인 한 줄 — 없으면 빈 문자열. 🔴 축 이름만 */
export function voiceCauseNote(gates: readonly { gate: string; detail?: string }[]): string {
  const s = parseVoiceCause(gates.find((g) => g.gate === '⑧')?.detail)
  const out: string[] = []
  if (s.candidate.length > 0) out.push(`⑧ 후보 원인 ${s.candidate.join('·')}`)
  if (s.baselineOnly.length > 0) out.push(`⑧ 기준선 초과(후보 무관 · 통과) ${s.baselineOnly.join('·')}`)
  return out.join(' · ')
}
