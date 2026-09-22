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
  /**
   * 🔴 **그 수정·폐기가 중대 결함이었는가** — 사람이 결정할 때 남긴 표식.
   *    `undefined` 는 "표시하지 않았다" 다. `false` 와 다르다.
   *    표시가 하나라도 빠지면 전체가 `unmeasured` 가 된다(아래 `sampleOf`).
   */
  hardDefect?: boolean
  /** 🔴 표본에 넣을 자격이 있는가 — 무경고 적격 기계 후보만 센다 */
  eligible: boolean
}

/** 🔴 `editDiff` · `declineReason` 기록에서 중대 결함 표식을 읽는 단일 지점 */
export const HARD_DEFECT_KEY = 'hardDefect'

export function hardDefectOf(record: unknown): boolean | undefined {
  if (record === null || typeof record !== 'object') return undefined
  const v = (record as Record<string, unknown>)[HARD_DEFECT_KEY]
  return typeof v === 'boolean' ? v : undefined
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
  /**
   * 🔴 **무경고 적격 기계 후보 중 사람이 결정한 것만 센다** (2026-09-22 정정).
   *    앞판은 `decidedBy === 'founder'` 인 기계 후보를 전부 셌다. 그러면
   *    애초에 자동 대상이 아닌 행(경고 있음 · 시각 미상 · 게이트 미통과)이
   *    분모에 들어가 **자동 판정 정확도와 다른 수**가 된다.
   */
  const human = rows.filter((r) => (r.decidedBy ?? '').trim() === HUMAN_DECIDER && r.eligible)
  const editedRows = human.filter((r) => r.hasEditDiff)
  const rejectedRows = human.filter((r) => r.hasDeclineReason)
  const ready = human.length - editedRows.length - rejectedRows.length
  /**
   * 🔴 **중대 결함은 수정·폐기한 행에만 물을 수 있다.** 그 행들이 **전부** 표식을
   *    가지고 있을 때만 세고, 하나라도 빠지면 `null` 이다 — 표시 안 한 것을 0 으로 읽지 않는다.
   */
  const marked = [...editedRows, ...rejectedRows]
  const missing = marked.filter((r) => r.hardDefect === undefined).length
  const hardDefects = marked.length === 0
    ? (human.length === 0 ? null : 0)
    : missing > 0 ? null : marked.filter((r) => r.hardDefect === true).length
  return {
    total: human.length, ready, edited: editedRows.length, rejected: rejectedRows.length,
    noEditAccuracy: human.length === 0 ? null : ready / human.length,
    hardDefects,
    hardDefectsNote: hardDefects === null
      ? `🔴 unmeasured — 수정·폐기 ${marked.length}건 중 ${missing}건에 중대 결함 표식이 없다`
      : `수정·폐기 ${marked.length}건 전부 표시됨`,
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
  /**
   * 🔴 **앞판은 `(seed + k*7) % N` 으로 골라 N=7·21 에서 같은 칸을 두 번 집었다**
   *    (2026-09-22 실측: N=7 에 2건을 요구했는데 1건, N=21 에 5건인데 3건).
   *    중복을 `Set` 으로 지우니 **요구한 수보다 적게** 나왔고, 감사 표본이 조용히 줄었다.
   *
   * 🔴 이제 **결정적 순열**을 만들고 앞에서 n 개를 자른다 — 중복이 나올 수 없다.
   *    순서는 `(seed, id)` 로만 정해지므로 같은 입력이면 언제나 같은 답이다.
   */
  const n = Math.ceil(input.autoDecided.length * input.ratio)
  if (n <= 0) return []
  const uniq = [...new Set(input.autoDecided)].sort()
  const keyOf = (id: string): number => {
    let h = input.seed >>> 0
    for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0
    return h
  }
  return [...uniq]
    .sort((a, b) => keyOf(a) - keyOf(b) || a.localeCompare(b))
    .slice(0, Math.min(n, uniq.length))
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

// ─────────────────────────────────────────────────────────
// 🔴 **실제 기록 경로** (2026-09-22)
//
//   판정 함수만 있으면 아무 일도 일어나지 않는다. 자동 판정이 **무엇을 어디에 쓰는지**,
//   그리고 **발행 직전에 무엇을 다시 보는지**가 여기 있다.
// ─────────────────────────────────────────────────────────

/** 🔴 자동 판정이 큐 행에 남기는 것 — `decidedBy` 와 **그때 본 본문의 판**이다 */
export type AutoReadyStamp = {
  decidedBy: typeof AUTO_DECIDER
  decidedAt: Date
  /** 🔴 **그때 본 본문**의 지문. 발행 직전에 다시 재서 다르면 자동 자격을 잃는다 */
  bodyVersion: string
  /** 어느 판정이 열어 줬는가 — 사후에 되짚을 수 있어야 한다 */
  openReason: string
}

/** 🔴 본문 판 — 제목과 본문을 합쳐 한 값으로. 부르는 쪽이 해시 함수를 넘긴다 */
export function bodyVersionOf(
  input: { title: string; body: string },
  sha256: (text: string) => string,
): string {
  return sha256(`${input.title}\n${input.body}`).slice(0, 16)
}

export type StampInput = {
  row: RowInput & { id: string }
  open: OpenVerdict
  now: Date
  sha256: (text: string) => string
}
export type StampResult =
  | { write: true; stamp: AutoReadyStamp }
  | { write: false; toHumanReview: true; reasons: string[] }

/**
 * 🔴 **자동 판정이 행에 무엇을 쓸지 정한다.** 쓰지 않기로 하면 **사람 묶음으로 보낸다** —
 *    조용히 버리지 않는다. `founder` 는 어떤 경우에도 쓰지 않는다.
 */
export function planAutoReadyWrite(i: StampInput): StampResult {
  if (!i.open.open) return { write: false, toHumanReview: true, reasons: [`게이트 닫힘 — ${i.open.reason}`] }
  const v = judgeRow(i.row)
  if (!v.auto) return { write: false, toHumanReview: true, reasons: v.reasons }
  return {
    write: true,
    stamp: {
      decidedBy: AUTO_DECIDER, decidedAt: i.now,
      bodyVersion: bodyVersionOf(i.row, i.sha256),
      openReason: i.open.reason,
    },
  }
}

/**
 * 🔴 **발행 직전 재확인** — 도장을 찍은 뒤 본문이 바뀌었거나 게이트가 닫혔으면
 *    그 행은 자동으로 나가지 않는다. 사람이 다시 본다.
 */
export type RecheckInput = {
  stampedBodyVersion: string
  current: { title: string; body: string }
  open: boolean
  row: RowInput
  sha256: (text: string) => string
}
export type RecheckVerdict = { ok: boolean; reason: string }

export function recheckBeforePublish(i: RecheckInput): RecheckVerdict {
  if (!i.open) return { ok: false, reason: '자동 READY 게이트가 닫혀 있다' }
  const now = bodyVersionOf(i.current, i.sha256)
  if (now !== i.stampedBodyVersion) {
    return { ok: false, reason: `도장 이후 본문이 바뀌었다 — ${i.stampedBodyVersion} → ${now}` }
  }
  const v = judgeRow(i.row)
  if (!v.auto) return { ok: false, reason: `지금 다시 보면 자동 대상이 아니다 — ${v.reasons.join(' · ')}` }
  return { ok: true, reason: `본문 판 ${now} 유지 · 적격` }
}
