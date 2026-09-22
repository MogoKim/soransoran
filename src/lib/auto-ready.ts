/**
 * 자동 READY — 🔴 **사람 도장을 기계가 찍는 우회를 코드로 막는다** (2026-09-22)
 *
 * 🔴 **왜 필요한가.** 지금은 기계 후보가 `decidedBy === 'founder'` 일 때만 발행 대상이
 *    된다(`selectAutoTargets` 의 `HUMAN_REVIEW_REQUIRED`). 그래서 자동 판정을 넣으려면
 *    **자동 job 이 `founder` 를 찍는 길**밖에 없어 보이는데, 그것은 기록을 거짓으로 만든다 —
 *    "누가 정했나" 가 사라지고, 사후 감사도 표본 집계도 전부 무너진다.
 *
 * 🔴 그래서 **결정 주체를 다른 값으로 남긴다.** `auto-ready:v1` 이다.
 *    발행 선택기는 `founder` 와 이 값을 **각각** 인정하되, 자동 값은
 *    **게이트가 열려 있고 그 행이 적격일 때만** 인정한다.
 *    `founder` 를 기계가 찍는 것은 이 파일 어디에서도 허용하지 않는다.
 */

/** 🔴 사람이 찍는 도장 — 기계는 이 값을 쓰지 않는다 */
export const HUMAN_DECIDER = 'founder'

/** 🔴 자동 판정이 남기는 값. 사람 값과 **글자가 다르다** — 집계가 둘을 가른다 */
export const AUTO_DECIDER = 'auto-ready:v1'

/** 🔴 자동 READY 를 켜는 스위치. 없으면 꺼진 것이다(fail-closed) */
export const AUTO_READY_ENV = 'SORAN_AUTO_READY_ENABLED'

/**
 * 🔴 **표본 집계** — 분모는 "사람이 결정한 전부" 다.
 *    폐기를 빼면 성능이 부풀려진다(2026-09-22 지적).
 */
export type ReviewOutcome = {
  /** 🔴 결정 종류는 `status` 가 아니라 **남긴 흔적**으로 가른다 — 발행되면 status 가 덮인다 */
  hasEditDiff: boolean
  hasDeclineReason: boolean
  decidedBy: string | null
}

export type ReviewSample = {
  total: number
  ready: number
  edited: number
  rejected: number
  /** ready ÷ total. 표본이 0 이면 `null` — 0% 가 아니다 */
  noEditAccuracy: number | null
  /** 🔴 중대 결함 수를 셀 수 있는가. 지금은 가리는 필드가 없다 */
  hardDefects: number | null
  hardDefectsNote: string
}

export function sampleOf(rows: readonly ReviewOutcome[]): ReviewSample {
  const human = rows.filter((r) => (r.decidedBy ?? '').trim() === HUMAN_DECIDER)
  const edited = human.filter((r) => r.hasEditDiff).length
  const rejected = human.filter((r) => r.hasDeclineReason).length
  const ready = human.length - edited - rejected
  return {
    total: human.length, ready, edited, rejected,
    noEditAccuracy: human.length === 0 ? null : ready / human.length,
    /**
     * 🔴 **`null` 은 "0 건" 이 아니라 "재지 못했다" 다.**
     *    `declineReason` 은 폐기 사유 코드이고 `editDiff` 는 바뀐 줄 수·글자 증감뿐이다.
     *    "이 수정이 중대 결함이었나" 를 가리는 칸이 없다.
     */
    hardDefects: null,
    hardDefectsNote: '🔴 unmeasured — declineReason·editDiff 로는 중대 결함 여부를 가릴 수 없다',
  }
}

/** 🔴 자동 READY 를 열어도 되는가 — 계약 값은 `supply-schedule-contract` 가 정본이다 */
export type OpenInput = {
  enabled: boolean
  sample: ReviewSample
  reviewSampleMin: number
  noEditAccuracyMin: number
  hardDefectMax: number
}
export type OpenVerdict = { open: boolean; reason: string }

export function judgeAutoReadyOpen(i: OpenInput): OpenVerdict {
  if (!i.enabled) return { open: false, reason: `${AUTO_READY_ENV} 가 꺼져 있다` }
  if (i.sample.total < i.reviewSampleMin) {
    return { open: false, reason: `표본 ${i.sample.total}/${i.reviewSampleMin} — ${i.reviewSampleMin - i.sample.total}건 부족` }
  }
  if (i.sample.noEditAccuracy === null) return { open: false, reason: '무수정 비율을 재지 못했다' }
  if (i.sample.noEditAccuracy < i.noEditAccuracyMin) {
    return {
      open: false,
      reason: `무수정 ${(i.sample.noEditAccuracy * 100).toFixed(1)}% < 기준 ${(i.noEditAccuracyMin * 100).toFixed(0)}%`,
    }
  }
  /**
   * 🔴 **재지 못한 것을 통과로 읽지 않는다.** `hardDefects` 가 `null` 이면
   *    "중대 결함 0" 이 증명되지 않은 것이고, 그때는 열지 않는다(fail-closed).
   */
  if (i.sample.hardDefects === null) {
    return { open: false, reason: `🔴 중대 결함을 재지 못했다 — ${i.sample.hardDefectsNote}` }
  }
  if (i.sample.hardDefects > i.hardDefectMax) {
    return { open: false, reason: `중대 결함 ${i.sample.hardDefects} > ${i.hardDefectMax}` }
  }
  return { open: true, reason: `표본 ${i.sample.total} · 무수정 ${(i.sample.noEditAccuracy * 100).toFixed(1)}% · 중대 결함 ${i.sample.hardDefects}` }
}

/**
 * 🔴 **그 행이 자동 판정 대상인가** — "경고 없는 적격 후보" 하나다.
 *    하나라도 걸리면 사람 묶음 검토로 간다. 조용히 통과시키지 않는다.
 */
export type RowInput = {
  gateVerdict: string
  /** 생성 시점 게이트가 남긴 경고 코드 (빈 배열이면 경고 없음) */
  warnings: readonly string[]
  /** 원천을 언제 봤는지 아는가 — 모르면 사람이 본다 */
  sourceCapturedKnown: boolean
  /** 본문 · 제목 */
  title: string
  body: string
}
export type RowVerdict = { auto: boolean; reasons: string[] }

/** 🔴 회귀 사례에서 나온 네 가지 — 값으로 적어 두고 검사가 읽는다 */
export const AUTO_READY_BLOCKERS = {
  /** 이미지가 있어야 성립하는 문장 (P08 실측) */
  imageDependent: /이런\s*(가죽|레더|옷)|이\s*옷\s*어(떨|떻)|사진\s*보|위\s*사진|여기\s*보/,
  /** 발행일 당일처럼 읽히는 표현 (P03 실측) */
  timeDrift: /오늘도|아직도\s*안|방금|어제\s*밤|지금\s*막/,
  /** 근거 없는 단정 */
  unsourcedClaim: /확실히|틀림없이|반드시\s*그렇/,
  /** 후속 뉴스가 있을 수 있는 시의성 소재 (P01 심수봉 실측) */
  followUpLikely: /저격|논란|해명|사과|입장문|폭로/,
} as const

export function judgeRow(i: RowInput): RowVerdict {
  const reasons: string[] = []
  if (i.gateVerdict !== 'PASS') reasons.push(`gate=${i.gateVerdict}`)
  if (i.warnings.length > 0) reasons.push(`경고 ${i.warnings.join(',')}`)
  if (!i.sourceCapturedKnown) reasons.push('원천 수집 시각을 모른다')
  const both = `${i.title}\n${i.body}`
  for (const [name, re] of Object.entries(AUTO_READY_BLOCKERS)) {
    const hit = re.exec(both)
    if (hit !== null) reasons.push(`${name}="${hit[0]}"`)
  }
  return { auto: reasons.length === 0, reasons }
}

/**
 * 🔴 **사후 감사** — 열린 뒤에도 일부는 사람이 다시 본다.
 *    떨어지면 감속한다. 감속은 "닫는다" 가 아니라 **비율을 0 으로** 만드는 것이다.
 */
export function auditPicks(input: {
  autoDecided: readonly string[]
  ratio: number
  /** 🔴 재현 가능한 선택 — 무작위면 같은 날 두 번 세면 다른 답이 나온다 */
  seed: number
}): string[] {
  const n = Math.ceil(input.autoDecided.length * input.ratio)
  if (n <= 0) return []
  const sorted = [...input.autoDecided].sort()
  const out: string[] = []
  for (let k = 0; k < n && k < sorted.length; k += 1) {
    out.push(sorted[(input.seed + k * 7) % sorted.length]!)
  }
  return [...new Set(out)]
}

/** 🔴 감사에서 결함이 나오면 비율을 줄이지 말고 **자동을 닫는다** */
export function judgeAuditOutcome(input: {
  audited: number
  defectsFound: number
}): { keepOpen: boolean; reason: string } {
  if (input.audited === 0) return { keepOpen: false, reason: '감사 표본이 0 — 열어 둔 채로 두지 않는다' }
  if (input.defectsFound > 0) {
    return { keepOpen: false, reason: `사후 감사에서 결함 ${input.defectsFound}건 — 자동을 닫는다` }
  }
  return { keepOpen: true, reason: `감사 ${input.audited}건 · 결함 0` }
}
