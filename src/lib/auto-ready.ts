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

// ─────────────────────────────────────────────────────────
// 🔴 **기록을 어디에 남기는가** (2026-09-22)
//
//   스키마를 바꿀 수 없으므로 `editDiff` JSON 을 쓴다. 그런데 이 칸은 원래
//   "사람이 고친 내역" 자리다. **둘을 구분하지 않으면 표본이 망가진다** —
//   자동 도장을 찍은 행이 "수정된 행" 으로 세어지고, 표식만 남긴 폐기 행이
//   수정과 폐기 **양쪽에** 들어가 무수정 승인 수가 음수가 된다.
// ─────────────────────────────────────────────────────────

/** 🔴 **고친 내역인가.** 이 두 열쇠가 있어야 사람이 문장을 고친 기록이다 */
export function isEditRecord(editDiff: unknown): boolean {
  if (editDiff === null || typeof editDiff !== 'object') return false
  const d = editDiff as Record<string, unknown>
  return typeof d.titleChanged === 'boolean' || typeof d.bodyChanged === 'boolean'
}

export const AUTO_READY_RECORD_KEY = 'autoReady'

/** 🔴 자동 도장이 남긴 것을 되읽는다 — 발행 직전에 본문 판을 대조하려면 필요하다 */
export function readAutoReadyStamp(editDiff: unknown): { bodyVersion: string; openReason: string } | null {
  if (editDiff === null || typeof editDiff !== 'object') return null
  const r = (editDiff as Record<string, unknown>)[AUTO_READY_RECORD_KEY]
  if (r === null || typeof r !== 'object') return null
  const m = r as Record<string, unknown>
  const bv = typeof m.bodyVersion === 'string' ? m.bodyVersion : ''
  if (bv === '') return null
  return { bodyVersion: bv, openReason: typeof m.openReason === 'string' ? m.openReason : '' }
}

// ─────────────────────────────────────────────────────────
// 🔴 **한 회차가 무엇을 쓸지 정한다** — 러너는 이 계획을 그대로 집행한다.
//    러너 안에서 조립하면 검사가 닿지 않는다.
// ─────────────────────────────────────────────────────────

export type StampCandidate = RowInput & {
  id: string
  /** 지금 이 행에 적힌 결정자. 기계 값이어야 한다 — 이미 사람·자동이 정했으면 건드리지 않는다 */
  decidedBy: string | null
  /** 🔴 낙관적 잠금의 근거. 읽은 뒤 누가 한 번이라도 쓰면 값이 달라진다 */
  updatedAt: Date
  status: string
  createdPostId: string | null
}

export type StampWrite = {
  id: string
  /** 🔴 조건부 UPDATE 의 where 절 — 하나라도 어긋나면 0건이 되어 아무것도 쓰지 않는다 */
  where: { id: string; decidedBy: string; status: string; createdPostId: null; updatedAt: Date }
  data: { decidedBy: typeof AUTO_DECIDER; decidedAt: Date; editDiff: Record<string, unknown> }
}
export type StampSkip = { id: string; reasons: string[] }
export type RunPlan = { open: OpenVerdict; writes: StampWrite[]; toHumanReview: StampSkip[] }

/**
 * 🔴 **회차 계획.** 게이트가 닫혀 있으면 `writes` 는 **언제나 빈 배열**이다 —
 *    부르는 쪽이 판정을 잊어도 쓸 것이 없다(fail-closed).
 *
 * 🔴 이미 누가 정한 행은 손대지 않는다. `founder` 도장을 덮어쓰지 않고,
 *    자동 도장을 두 번 찍지도 않는다.
 */
export function planRun(input: {
  candidates: readonly StampCandidate[]
  open: OpenVerdict
  now: Date
  machineDecidedBy: string
  sha256: (text: string) => string
}): RunPlan {
  if (!input.open.open) {
    return {
      open: input.open, writes: [],
      toHumanReview: input.candidates.map((c) => ({ id: c.id, reasons: [`게이트 닫힘 — ${input.open.reason}`] })),
    }
  }
  const writes: StampWrite[] = []
  const toHumanReview: StampSkip[] = []
  for (const c of input.candidates) {
    if (c.createdPostId !== null) continue          // 이미 나간 글이다
    if ((c.decidedBy ?? '') !== input.machineDecidedBy) continue  // 사람·자동이 이미 정했다
    const v = judgeRow(c)
    if (!v.auto) { toHumanReview.push({ id: c.id, reasons: v.reasons }); continue }
    writes.push({
      id: c.id,
      where: { id: c.id, decidedBy: input.machineDecidedBy, status: c.status, createdPostId: null, updatedAt: c.updatedAt },
      data: {
        decidedBy: AUTO_DECIDER,
        decidedAt: input.now,
        editDiff: {
          [AUTO_READY_RECORD_KEY]: {
            decidedBy: AUTO_DECIDER,
            decidedAt: input.now.toISOString(),
            bodyVersion: bodyVersionOf(c, input.sha256),
            openReason: input.open.reason,
          },
        },
      },
    })
  }
  return { open: input.open, writes, toHumanReview }
}

// ─────────────────────────────────────────────────────────
// 🔴 **표본을 읽는 곳이 둘이면 답이 둘이 된다** (2026-09-22 실측).
//
//   발행 러너는 22/30·95.5%, 보고 명령은 15/30·93.3% 를 냈다. 러너가
//   `publish-candidate:` 접두를 써서 **사람 후보까지 표본에 넣었기** 때문이다.
//   그래서 한 행을 판정으로 바꾸는 일을 여기 한 함수로 모은다.
// ─────────────────────────────────────────────────────────

/** 🔴 경고 = 저장 게이트가 남긴 `holds`·`blocks`. 기록 자체가 없으면 그것도 경고다 */
export function warningsOfGate(gate: unknown): string[] {
  if (gate === null || typeof gate !== 'object') return ['gateResults 없음']
  const g = gate as Record<string, unknown>
  const arr = (k: string): string[] => (Array.isArray(g[k]) ? (g[k] as unknown[]).map(String) : [])
  return [...arr('holds'), ...arr('blocks')]
}

/** 표본·적격 판정에 필요한 한 행 — Prisma 모양을 그대로 받지 않는다 */
export type SampleRow = {
  gateVerdict: unknown
  gateResults: unknown
  draftTitle: string
  draftBody: string
  decidedBy: string | null
  editDiff: unknown
  declineReason: string | null
  /** 🔴 **원천을 언제 봤는가.** `null` 이면 모르는 것이고, 모르면 자동 대상이 아니다 */
  sourceCapturedAt: Date | null
}

/** 🔴 자동이 손댈 행인가 — 표본의 분모를 이것으로 거른다 */
export function eligibilityOf(r: SampleRow): RowVerdict {
  return judgeRow({
    gateVerdict: String(r.gateVerdict),
    warnings: warningsOfGate(r.gateResults),
    sourceCapturedKnown: r.sourceCapturedAt !== null,
    title: r.draftTitle, body: r.draftBody,
  })
}

/** 🔴 한 행 → 한 판정. 러너와 보고 명령이 **같은 이 함수**를 쓴다 */
export function outcomeOf(r: SampleRow): ReviewOutcome {
  return {
    decidedBy: r.decidedBy ?? '',
    // 🔴 도장·표식만 담긴 editDiff 는 "고친 내역" 이 아니다
    hasEditDiff: isEditRecord(r.editDiff),
    hasDeclineReason: (r.declineReason ?? '').trim() !== '',
    eligible: eligibilityOf(r).auto,
    hardDefect: hardDefectOf(r.editDiff),
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 **감사를 남긴다** (2026-09-22 보정)
//
//   앞판은 `auditPicks` 결과를 GitHub Actions 러너의 임시 디스크에 파일로 썼다.
//   그 디스크는 회차가 끝나면 사라진다. **다음 회차가 읽을 수 없으면 감사가 아니다** —
//   고른 것도, 사람이 무엇을 보고 무엇을 찾았는지도 남지 않는다.
//
//   스키마를 바꿀 수 없으므로 **감사 대상 행 자신의 `editDiff`** 에 적는다.
//   그 행이 곧 감사 대상이므로 자리가 흩어지지 않고, 다음 회차가 그대로 읽는다.
// ─────────────────────────────────────────────────────────

export const AUDIT_RECORD_KEY = 'audit'

export type AuditRecord = {
  /** 감사 대상으로 뽑힌 회차(KST 날짜) */
  pickedOn: string
  /** 🔴 사람이 보고 내린 판정. **없으면 "아직 안 봤다"** 이지 "결함 없음" 이 아니다 */
  defect?: boolean
  note?: string
}

export function readAuditRecord(editDiff: unknown): AuditRecord | null {
  if (editDiff === null || typeof editDiff !== 'object') return null
  const r = (editDiff as Record<string, unknown>)[AUDIT_RECORD_KEY]
  if (r === null || typeof r !== 'object') return null
  const m = r as Record<string, unknown>
  const on = typeof m.pickedOn === 'string' ? m.pickedOn : ''
  if (on === '') return null
  return {
    pickedOn: on,
    ...(typeof m.defect === 'boolean' ? { defect: m.defect } : {}),
    ...(typeof m.note === 'string' ? { note: m.note } : {}),
  }
}

export type AuditState = {
  /** 🔴 가장 오래 묵은 미확인 대상이 뽑힌 날 (KST `YYYY-MM-DD`). 없으면 `null` */
  oldestPendingOn: string | null
  /** 자동이 정한 글 전체 */
  autoDecided: number
  /** 감사 대상으로 남아 있는 것 */
  picked: number
  /** 그중 사람이 보고 판정을 끝낸 것 */
  reviewed: number
  /** 결함이 나온 것 */
  defects: number
  /** 🔴 아직 안 본 것 — **결함 0 으로 치지 않는다** */
  pending: number
}

export function auditStateOf(rows: readonly { id: string; editDiff: unknown }[]): AuditState {
  const recs = rows.map((r) => readAuditRecord(r.editDiff)).filter((r): r is AuditRecord => r !== null)
  const reviewed = recs.filter((r) => r.defect !== undefined)
  const pendingOns = recs.filter((r) => r.defect === undefined).map((r) => r.pickedOn).sort()
  return {
    autoDecided: rows.length,
    picked: recs.length,
    reviewed: reviewed.length,
    defects: reviewed.filter((r) => r.defect === true).length,
    pending: recs.length - reviewed.length,
    oldestPendingOn: pendingOns[0] ?? null,
  }
}

/**
 * 🔴 **감사가 자동을 닫는 실제 경로.** `judgeAutoReadyOpen` 이 열어도 이것이 닫으면 닫힌다.
 *
 * 🔴 **미확인이 있다는 사실만으로 즉시 닫지 않는다** (2026-09-22 보정).
 *    그렇게 하면 20% 사후 감사가 사람의 **매회차 허가**가 되고, 사람이 한 번 늦으면
 *    자동이 선다. D100 에서는 하루 20건을 매일 처리해야 자동이 멎지 않는다 —
 *    그것은 자동화가 아니라 사전 승인이다.
 *
 * 🔴 대신 **밀린 정도**로 닫는다. 막으려는 것은 "사람이 조금 늦는 것" 이 아니라
 *    "아무도 보지 않는데 계속 나가는 것" 이다.
 *      · 결함이 하나라도 나오면 → 즉시 닫힘 (그대로)
 *      · 미확인이 `auditPendingMaxDays` 보다 오래 묵으면 → 닫힘
 *      · 미확인이 `auditPendingMax` 건을 넘으면 → 닫힘
 */
export function judgeAuditGate(state: AuditState, limits?: {
  pendingMaxDays: number
  pendingMax: number
  /** 오늘(KST `YYYY-MM-DD`) */
  todayKst: string
}): OpenVerdict {
  if (state.autoDecided === 0) return { open: true, reason: '자동 판정이 없어 감사할 것이 없다' }
  if (state.picked === 0) return { open: false, reason: '🔴 자동 판정이 있는데 감사 대상이 뽑히지 않았다' }
  // 🔴 **결함이 먼저다.** 대기가 남아 있어도 이미 나온 결함이 더 굳은 사실이다
  if (state.defects > 0) {
    const o = judgeAuditOutcome({ audited: state.reviewed, defectsFound: state.defects })
    return { open: false, reason: `🔴 감사 — ${o.reason}` }
  }
  // 🔴 그다음이 **밀린 정도**다. 미확인이 있다는 사실만으로는 닫지 않는다
  if (state.pending > 0) {
    // 🔴 한도를 주지 않으면 닫는다 — 부르는 쪽이 계약을 빠뜨리면 안전한 쪽으로 간다
    if (limits === undefined) {
      return { open: false, reason: `🔴 감사 대기 ${state.pending}건 · 한도가 주어지지 않았다` }
    }
    if (state.pending > limits.pendingMax) {
      return { open: false, reason: `🔴 감사 대기 ${state.pending}건 — 한도 ${limits.pendingMax}건을 넘었다` }
    }
    const days = state.oldestPendingOn === null ? 0 : daysBetween(state.oldestPendingOn, limits.todayKst)
    if (days > limits.pendingMaxDays) {
      return { open: false, reason: `🔴 가장 오래 묵은 감사 대기가 ${days}일 — 한도 ${limits.pendingMaxDays}일을 넘었다` }
    }
    return {
      open: true,
      reason: `감사 확인 ${state.reviewed}건 · 결함 0 · 대기 ${state.pending}건(${days}일 — 한도 안)`,
    }
  }
  const outcome = judgeAuditOutcome({ audited: state.reviewed, defectsFound: state.defects })
  if (!outcome.keepOpen) return { open: false, reason: `🔴 감사 — ${outcome.reason}` }
  return { open: true, reason: `감사 ${state.reviewed}건 전부 확인 · 결함 0` }
}

/** 🔴 두 날짜(KST `YYYY-MM-DD`) 사이의 날 수. 형식이 이상하면 **아주 큰 값**을 낸다 — 모르면 닫는 쪽이다 */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.MAX_SAFE_INTEGER
  return Math.round((b - a) / 864e5)
}

/** 🔴 두 문이 **모두** 열려야 열린다 — 하나라도 닫히면 닫힌다 */
export function combineGates(sample: OpenVerdict, audit: OpenVerdict): OpenVerdict {
  if (!sample.open) return sample
  if (!audit.open) return audit
  return { open: true, reason: `${sample.reason} · ${audit.reason}` }
}

// ─────────────────────────────────────────────────────────
// 🔴 **발행 트랜잭션 안에서 다시 본다** (2026-09-22 보정)
//
//   `recheckBeforePublish` 는 트랜잭션 **밖**에 있다. 재확인이 통과한 직후
//   다른 실행이 본문을 고치면, 고쳐진 본문이 그대로 `Post` 에 쓰인다.
//   그래서 **실제로 Post 를 만드는 그 트랜잭션 안에서** 같은 것을 다시 묻는다.
// ─────────────────────────────────────────────────────────

export type InTxRow = {
  decidedBy: string | null
  editDiff: unknown
  gateVerdict: unknown
  gateResults: unknown
  /** 🔴 **실제로 Post 에 쓰일 글** — 수정본이 있으면 그것이다 */
  title: string
  body: string
  sourceCapturedAt: Date | null
}

export type InTxVerdict = { ok: true } | { ok: false; detail: string }

/**
 * 🔴 **자동이 정한 글만 본다.** 사람이 정한 글은 이 문을 지나지 않는다 — 기존 동작 불변.
 *
 *    셋 중 하나라도 어긋나면 막는다.
 *      ① 게이트가 닫혀 있다
 *      ② 도장 당시의 본문 판과 **지금 쓰이려는 글**이 다르다
 *      ③ 지금 다시 봐도 자동 대상이어야 한다
 */
export function judgeAutoInTx(input: {
  row: InTxRow
  autoReadyOpen: boolean
  sha256: (text: string) => string
}): InTxVerdict {
  const r = input.row
  if ((r.decidedBy ?? '') !== AUTO_DECIDER) return { ok: true }
  if (!input.autoReadyOpen) return { ok: false, detail: '자동 READY 게이트가 닫혀 있다' }
  const stamp = readAutoReadyStamp(r.editDiff)
  if (stamp === null) return { ok: false, detail: '자동 도장 기록이 없다 — 본문 판을 대조할 수 없다' }
  const now = bodyVersionOf({ title: r.title, body: r.body }, input.sha256)
  if (now !== stamp.bodyVersion) {
    return { ok: false, detail: `도장 이후 본문이 바뀌었다 — ${stamp.bodyVersion} → ${now}` }
  }
  const v = judgeRow({
    gateVerdict: String(r.gateVerdict),
    warnings: warningsOfGate(r.gateResults),
    sourceCapturedKnown: r.sourceCapturedAt !== null,
    title: r.title, body: r.body,
  })
  if (!v.auto) return { ok: false, detail: `지금 다시 보면 자동 대상이 아니다 — ${v.reasons.join(' · ')}` }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────
// 🔴 **JSON 한 칸을 여럿이 쓴다** (2026-09-22 보정)
//
//   `editDiff` 에는 세 가지가 함께 산다 — 사람이 고친 내역, 자동 도장, 감사 기록.
//   읽고-합쳐서-통째로 쓰는 방식은, 두 실행이 같은 값을 읽으면 **나중 것이 앞 것을 덮는다.**
//   앞판 주석은 "그 사이 변경 시 0건" 이라고 적었지만 `where` 에 `updatedAt` 이 없어
//   그 말이 성립하지 않았다. 아래 두 가지로 고친다.
//     ① 조건부 UPDATE 에 **읽은 순간의 `updatedAt`** 을 넣는다
//     ② 0건이면 **다시 읽어 합치고 재시도**한다 — 조용히 지나가지 않는다
// ─────────────────────────────────────────────────────────

/** 🔴 한 칸만 바꾸고 나머지는 그대로 둔다 — 통째로 갈아끼우지 않는다 */
export function mergeJsonField(
  base: unknown,
  key: string,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const obj = (base !== null && typeof base === 'object') ? { ...(base as Record<string, unknown>) } : {}
  obj[key] = value
  return obj
}

export type CasWrite = {
  where: { id: string; updatedAt: Date }
  data: Record<string, unknown>
}

/**
 * 🔴 **읽고-합쳐-조건부로 쓰고, 어긋나면 다시 읽어 되풀이한다.**
 *
 *    `read` 는 그때의 `editDiff` 와 `updatedAt` 을 함께 준다. `write` 는 조건이
 *    어긋나면 0 을 돌려준다. 횟수를 다 쓰면 **실패로 알린다** — 성공한 척하지 않는다.
 */
export async function casMergeEditDiff(input: {
  id: string
  key: string
  value: Record<string, unknown>
  read: (id: string) => Promise<{ editDiff: unknown; updatedAt: Date } | null>
  write: (w: CasWrite) => Promise<number>
  attempts?: number
}): Promise<{ ok: true; tries: number } | { ok: false; reason: string; tries: number }> {
  const max = input.attempts ?? 3
  for (let i = 1; i <= max; i += 1) {
    const cur = await input.read(input.id)
    if (cur === null) return { ok: false, reason: '그 행이 없다', tries: i }
    const merged = mergeJsonField(cur.editDiff, input.key, input.value)
    const n = await input.write({ where: { id: input.id, updatedAt: cur.updatedAt }, data: { editDiff: merged } })
    if (n === 1) return { ok: true, tries: i }
  }
  return { ok: false, reason: `🔴 ${max}번 시도했지만 그 사이 계속 바뀌었다 — 쓰지 않았다`, tries: max }
}
