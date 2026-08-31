/**
 * Gate ⑦ Persona Consistency · ⑧ Voice Fingerprint — 판정부
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md §3-⑦ §3-⑧ §5
 *
 * 🔴 순수 함수다. DB · LLM · 파일 IO · 네트워크 없음.
 *    identity · No-Go · 대조 발화 · seed 사용 횟수는 전부 인자로 받는다.
 *    (헌법 §9-6 — 페르소나를 코드 상수로 두지 않는다)
 *
 * 🔴 반환값에 본문 조각을 담지 않는다. 코드 · 개수 · 비율만 남긴다.
 *
 * 🔴 "돌지 않았다" 를 pass 로 보고하지 않는다 — notRun 으로 분리한다.
 *    ⑦ 은 identity 가 없으면 모순을 볼 수 없고,
 *    ⑧ 은 대조할 발화가 없으면 반복을 볼 수 없다. 둘 다 흔한 상태다.
 */

export type Gate78Status = 'pass' | 'review' | 'regenerate' | 'notRun'

const RANK: Record<Gate78Status, number> = { notRun: -1, pass: 0, review: 1, regenerate: 2 }
/** 🔴 축이 여러 개여도 관문은 하나다 — 더 엄격한 쪽을 남긴다 */
const stricter = (a: Gate78Status, b: Gate78Status): Gate78Status => (RANK[a] >= RANK[b] ? a : b)

// ══════════════════════════════════════════════════════════════
// ⑦ Persona Consistency
// ══════════════════════════════════════════════════════════════

/**
 * 판정에 쓰는 identity 필드만 받는다.
 * 🔴 coreWound · personality 같은 서술 필드는 자동 판정에 쓰지 않는다 —
 *    문자열 대조로는 모순을 가릴 수 없고, 억지로 재면 오탐만 는다.
 */
export type PersonaIdentityFacts = {
  maritalStatus?: string | null
  spouseRelationship?: string | null
  childrenCount?: number | null
  menopauseStatus?: string | null
}

export type ConsistencyInput = {
  identity?: PersonaIdentityFacts | null
  noGoTopics?: readonly string[]
  noGoExpressions?: readonly string[]
}

export type ConsistencyCode =
  | 'FAMILY_PROXY'        // 존재하지 않는 가족의 검증 가능한 사실을 판단 근거로
  | 'NO_GO'               // No-Go 주제 · 표현
  | 'SPOUSE_CONFLICT'     // 배우자 설정과 모순
  | 'CHILD_CONFLICT'      // 자녀 수 설정과 모순
  | 'MENOPAUSE_CONFLICT'  // 생애단계 설정과 모순

export type ConsistencyVerdict = {
  status: Gate78Status
  /** 🔴 걸린 문장이 아니라 코드만 */
  codes: ConsistencyCode[]
  detail: string
}

const FAMILY_NOUN = '딸|아들|남편|신랑|와이프|아내|엄마|어머니|아빠|아버지|시어머니|시아버지|며느리|사위|손주|손자|손녀'

/**
 * 🔴 설정과 일치해도 걸린다 (§5 "가족 경유 진술").
 *    설정에 딸이 있는 것과, 그 딸의 병원 경험을 남의 결정 근거로 내미는 것은 다르다.
 *    읽는 사람은 그것을 사실로 믿고 판단한다.
 *
 * 🔴 정서 표현은 걸리지 않는다 — "우리 딸도 그맘때 힘들었어요" 는 통과다.
 *    검증 가능한 행위 · 결과가 붙을 때만 잡는다.
 */
const FAMILY_PROXY = new RegExp(
  `(우리|저희)\\s*(${FAMILY_NOUN})[은는이가도]?\\s*[^.!?]{0,30}` +
  '(갔|다녀왔|다녀오|먹었|먹고|받았|받고|나았|나아|좋아졌|효과|완치|수술|처방|입원|퇴원|검사)',
  'u',
)

/** 배우자를 현재 있는 사람으로 서술하는가 */
const SPOUSE_PRESENT = /(남편|신랑|와이프|아내|배우자)[은는이가도]?\s*[^.!?]{0,20}(있어요|있는데|해요|그래요|하네요|다녀|먹어|가요|와요|줘요|해줘|한대요|이래요)/u
/** 사별 · 이혼 · 과거를 명시하면 모순이 아니다 */
const SPOUSE_PAST = /(돌아가|먼저\s*갔|먼저\s*보내|이혼|헤어지|별거|살아\s*있을\s*때|있을\s*때는|였을\s*때)/u
/** 배우자가 없는 설정 */
const NO_SPOUSE = /(사별|이혼|미혼|비혼|독신)/u

const CHILD_MENTION = new RegExp(`(우리|저희)?\\s*(딸|아들|아이들|애들|자식)[은는이가도]`, 'u')

const MENO_DONE = /갱년기[^.!?]{0,10}(끝|지나|넘기|겪고\s*나)/u
const MENO_START = /갱년기[^.!?]{0,10}(시작|오나|왔나|초기)/u

/**
 * ⑦ — 실패 기준은 **모순 1건**이다 (§3-⑦).
 *
 * 🔴 identity 가 없어도 FAMILY_PROXY 는 확정적으로 잡는다.
 *    그것은 설정 대조가 아니라 §5 경계라 대조 집합이 필요 없다.
 *    잡을 수 있는 것을 "설정이 없어서" 못 본 척하면 그대로 나간다.
 */
export function checkPersonaConsistency(
  candidateText: string,
  input: ConsistencyInput = {},
): ConsistencyVerdict {
  const text = (candidateText ?? '').trim()
  const codes: ConsistencyCode[] = []

  // ── 축 1. 가족 경유 진술 — identity 무관 ──
  if (FAMILY_PROXY.test(text)) codes.push('FAMILY_PROXY')

  // ── 축 2. No-Go ──
  const noGo = [...(input.noGoTopics ?? []), ...(input.noGoExpressions ?? [])]
    .filter((v) => v.trim() !== '')
  if (noGo.some((v) => text.includes(v.trim()))) codes.push('NO_GO')

  // ── 축 3~5. 설정 모순 — identity 가 있어야 본다 ──
  const id = input.identity ?? null
  if (id !== null) {
    const marital = (id.maritalStatus ?? '').trim()
    if (marital !== '' && NO_SPOUSE.test(marital)
      && SPOUSE_PRESENT.test(text) && !SPOUSE_PAST.test(text)) {
      codes.push('SPOUSE_CONFLICT')
    }
    if (id.childrenCount === 0 && CHILD_MENTION.test(text)) codes.push('CHILD_CONFLICT')

    const meno = (id.menopauseStatus ?? '').trim()
    if ((meno === '전' && MENO_DONE.test(text)) || (meno === '후' && MENO_START.test(text))) {
      codes.push('MENOPAUSE_CONFLICT')
    }
  }

  if (codes.length > 0) {
    return { status: 'regenerate', codes, detail: `모순 ${codes.length} — ${codes.join(' · ')}` }
  }
  // 🔴 대조 집합이 없으면 "모순 없음" 이 아니라 "보지 못했다" 다
  if (id === null && noGo.length === 0) {
    return { status: 'notRun', codes: [], detail: 'identity · No-Go 없음 — 가족 경유 진술만 확인' }
  }
  return { status: 'pass', codes: [], detail: '설정 모순 없음' }
}

// ══════════════════════════════════════════════════════════════
// ⑧ Voice Fingerprint / 반복 패턴
// ══════════════════════════════════════════════════════════════

/**
 * 🔴 임계는 운영 데이터로 정했다 (§3-⑧ "운영 데이터 없이 정하지 않는다").
 *
 *    우나어 댓글 코퍼스에서 **5건 이상 쓴 사람 690명 · 댓글 15,932건**의
 *    1인당 반복률을 실측한 분포:
 *
 *      축              p50   p75   p90   p95
 *      최빈 말끝       17%   20%   33%   40%
 *      최빈 시작어절   14%   20%   20%   30%
 *      최빈 3-gram     39%   50%   67%   80%
 *
 *    사람도 반복한다. 그래서 "반복하면 잡는다" 가 아니라
 *    **사람 분포의 상위 10%(review) · 상위 5%(regenerate)** 를 넘을 때 잡는다.
 *    시작어절은 p75~p90 이 20% 로 붙어 분포가 거칠어 한 칸씩 올려 잡았다.
 *
 * 🔴 이 값들은 손잡이다. AI 티가 나면 낮춘다.
 */
export type FingerprintThresholds = {
  /** 🔴 표본이 적으면 비율이 튄다 — 5건 미만은 재지 않는다 */
  minSamples: number
  endingReview: number
  endingRegen: number
  hookReview: number
  hookRegen: number
  ngramReview: number
  ngramRegen: number
  /** seed 재사용은 persona 단위가 아니라 **전체 단위**로 본다 (§3-⑧) */
  seedReuseReview: number
  seedReuseRegen: number
}

export const DEFAULT_FINGERPRINT_THRESHOLDS: FingerprintThresholds = {
  minSamples: 5,
  endingReview: 0.33,
  endingRegen: 0.40,
  hookReview: 0.25,
  hookRegen: 0.35,
  ngramReview: 0.67,
  ngramRegen: 0.80,
  seedReuseReview: 2,
  seedReuseRegen: 3,
}

export type FingerprintInput = {
  /** 같은 persona 의 최근 발화 — 발행물 + 같은 배치의 앞선 후보 */
  priorTexts?: readonly string[]
  /** 이 후보가 쓴 seed 가 **전체에서** 쓰인 횟수 (자기 자신 포함) */
  seedUseCount?: number
  /** 구조화 나열 · 마크다운 — 🔴 "AI 말투" 는 별도 관문이 아니라 ⑧의 축 하나다 */
  tidyMarks?: boolean
  thresholds?: Partial<FingerprintThresholds>
}

export type FingerprintAxis = 'ENDING' | 'HOOK' | 'NGRAM' | 'SEED_REUSE' | 'TIDY'

export type FingerprintVerdict = {
  status: Gate78Status
  axes: FingerprintAxis[]
  sampleSize: number
  detail: string
}

/** 말끝 — 종결 기호 · 웃음 표기를 떼고 마지막 3자 */
const endingOf = (t: string): string => t.replace(/[\s.!?~ㅋㅎ,]+$/u, '').slice(-3)
/** 시작 — 첫 어절 */
const hookOf = (t: string): string => t.trim().split(/\s+/)[0] ?? ''

const gramsOf = (t: string): string[] => {
  const s = t.replace(/\s+/g, '')
  const out: string[] = []
  for (let i = 0; i + 3 <= s.length; i++) out.push(s.slice(i, i + 3))
  return out
}

/** 최빈값의 점유율 */
const topShare = (values: readonly string[]): number => {
  const counts = new Map<string, number>()
  for (const v of values) {
    if (v === '') continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  if (counts.size === 0) return 0
  return Math.max(...counts.values()) / values.length
}

/** 최빈 3-gram 이 **몇 건의 발화에** 나오는가 (문서빈도 — 한 발화 안 반복은 세지 않는다) */
const topNgramShare = (texts: readonly string[]): number => {
  const df = new Map<string, number>()
  for (const t of texts) for (const g of new Set(gramsOf(t))) df.set(g, (df.get(g) ?? 0) + 1)
  if (df.size === 0) return 0
  return Math.max(...df.values()) / texts.length
}

const band = (v: number, review: number, regen: number): Gate78Status =>
  v >= regen ? 'regenerate' : v >= review ? 'review' : 'pass'

const pct = (v: number): string => `${Math.round(v * 100)}%`

/**
 * ⑧ — 고정 말투 하나가 반복되어 사람 글로 읽히지 않는 것을 막는다.
 *
 * 🔴 ② 와 겹치지 않는다. ②는 "이 표현을 써도 되는가",
 *    ⑧은 "이 표현을 또 쓰는가" 를 본다 (§3-⑧).
 */
export function checkVoiceFingerprint(
  candidateText: string,
  input: FingerprintInput = {},
): FingerprintVerdict {
  const th = { ...DEFAULT_FINGERPRINT_THRESHOLDS, ...(input.thresholds ?? {}) }
  const text = (candidateText ?? '').trim()
  const prior = (input.priorTexts ?? []).map((t) => t.trim()).filter((t) => t !== '')
  const sample = text === '' ? prior : [...prior, text]

  const axes: FingerprintAxis[] = []
  const why: string[] = []
  let status: Gate78Status = 'notRun'

  // 🔴 축마다 실행 조건이 다르다. 한 축이 못 돈다고 다른 축까지 건너뛰면
  //    그 축은 조용히 무력해진다 — 표본 부족으로 seed 재사용을 놓친 적이 있다.
  //    그래서 어떤 축도 early return 하지 않고, 끝에서 한 번만 판정한다.

  // ── 축 1. 구조화 나열 — 🔴 대조 집합 없이 확정적으로 잡힌다 ──
  if (input.tidyMarks === true) {
    axes.push('TIDY')
    why.push('구조화 나열 · 마크다운')
    status = stricter(status, 'regenerate')
  }

  // ── 축 2~4. 반복 — 🔴 표본이 모자라면 비율이 튄다. 재지 않는다 ──
  const repeatRan = sample.length >= th.minSamples
  if (repeatRan) {
    const e = topShare(sample.map(endingOf))
    const h = topShare(sample.map(hookOf))
    const g = topNgramShare(sample)
    const eb = band(e, th.endingReview, th.endingRegen)
    const hb = band(h, th.hookReview, th.hookRegen)
    const gb = band(g, th.ngramReview, th.ngramRegen)
    if (eb !== 'pass') { axes.push('ENDING'); why.push(`말끝 ${pct(e)}`) }
    if (hb !== 'pass') { axes.push('HOOK'); why.push(`시작어절 ${pct(h)}`) }
    if (gb !== 'pass') { axes.push('NGRAM'); why.push(`3-gram ${pct(g)}`) }
    status = stricter(stricter(status, eb), stricter(hb, gb))
  }

  // ── 축 5. seed 재사용 — 🔴 전체 단위이고, 표본 수와 무관하다 ──
  if (input.seedUseCount !== undefined) {
    const n = input.seedUseCount
    const sb: Gate78Status = n >= th.seedReuseRegen ? 'regenerate' : n >= th.seedReuseReview ? 'review' : 'pass'
    if (sb !== 'pass') { axes.push('SEED_REUSE'); why.push(`seed 재사용 ${n}회`) }
    status = stricter(status, sb)
  }

  // ── 판정 ──
  //    🔴 위반이 없더라도 반복 축을 못 봤으면 pass 가 아니다.
  //       ⑧ 의 본질은 반복이다. 구조 축만 깨끗한 것을 "통과" 로 세면 통계가 거짓이 된다.
  const sampleNote = `표본 ${sample.length}`
  if (axes.length === 0) {
    return repeatRan
      ? { status: 'pass', axes, sampleSize: sample.length, detail: `반복 없음 (${sampleNote})` }
      : {
          status: 'notRun',
          axes,
          sampleSize: sample.length,
          detail: `대조 발화 부족 — ${sampleNote} (최소 ${th.minSamples})`,
        }
  }
  // 🔴 본문이 아니라 축 이름 · 비율만
  const note = repeatRan ? sampleNote : `반복 축 미실행 · ${sampleNote}`
  return { status, axes, sampleSize: sample.length, detail: `${why.join(' · ')} (${note})` }
}
