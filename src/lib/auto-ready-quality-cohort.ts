/**
 * 🔴 **자동 READY 증거 — 품질 계약 cohort 판정 (순수)** (2026-09-27 마스터 결정)
 *
 * 왜 있나 — 앞판 증거(`cohortSampleOf` 를 사람 결정 행 **전체**에)는 세대를 섞었다.
 *   · 옛 생성 계약에서 나온 중대 결함 1건(감사 이력)이 새 계약의 표본을 **영원히** 닫았다
 *   · 검토 기록이 없는 행은 조용히 빠졌다 — 좋은 행만 골라 검토하면 30 이 찼다(cherry-pick)
 *
 * 🔴 **규칙**
 *   ① 표본은 **지금 품질 계약**(`isCurrentQualityContract` — 판정 시점의 코드 상수와 다시 견준다)으로
 *      적재된 기계 후보뿐이다. 표식이 없거나 다른 판(legacy)은 감사·운영 재고에는 남고 여기엔 없다.
 *      옛 행을 새 계약으로 옮겨 적는 경로는 없다. 날짜·수동 id 목록·reviewedAt 으로 가르지 않는다.
 *   ② 수열은 그 가운데 **자동 적격(warningsZero)** 인 행을 **생성 순서**(createdAt → id)로 늘어놓은 것이다.
 *      적격은 검토 전에 정해지는 결정적 규칙이다(적재 때 저장된 초안·gateResults·수집 시각).
 *   ③ 창은 수열의 **처음 30건**이다. 창 안 한 건이라도 사람 표본이 아니면(미검토 · 결속 깨짐 ·
 *      미측정) 닫힘이다 — 뒤의 좋은 행으로 건너뛰어 채우지 않는다.
 *   ④ 폐기·수정도 표본이다. 창 안 무수정 ≥ ceil(30×90%) = 27 이어야 한다.
 *   ⑤ **cohort 전체**(창 밖 포함) 어디든 사람 중대 결함 yes 가 있으면 그 계약은 실패다 —
 *      고친 뒤 새 판(`QUALITY_CONTRACT_VERSION`)으로 다시 검증한다.
 *   ⑥ 발행 뒤 독립 감사 결함 · 글 유실은 여기가 아니라 `judgeOpen` 의 **전역 차단**이다(판과 무관).
 * 🔴 기존 사람 기록 규칙(사용자별 최신 · 결속 · append-only · 누군가 yes 면 yes)은 `humanSampleOf` 그대로다.
 * 🔴 DB · 파일 · 네트워크 · env 를 모른다.
 */
import { humanSampleOf, readEvidenceReviews, effectiveHumanReviews, type BoundRow, type DecidedRow } from './auto-ready-evidence'
import { eligibilityOf, CONTRACT } from './auto-ready-v2'
import { isHumanReviewer } from './review-provenance'
import { isCurrentQualityContract, QUALITY_CONTRACT_VERSION, qualityContractDigest } from './quality-contract'

export type CohortRow = Pick<DecidedRow, 'decidedBy' | 'editDiff'> & BoundRow & {
  id: string
  createdAt: Date
  gateVerdict: string
  gateResults: unknown
  sourceCapturedAt: Date | null
  /** 🔴 발행 러너와 같은 눈(`profileOf`)으로 본 기계 후보인가 — 부르는 쪽이 정본 함수로 채운다 */
  machine: boolean
}

export type CohortBlocker = { index: number; id: string; why: string }

export type QualityCohortVerdict = {
  contractVersion: string
  contractDigest: string
  /** 지금 계약 · 자동 적격 수열의 길이 */
  sequence: number
  /** 🔴 표본 = 창 안에서 사람 표본으로 셀 수 있는 행 수(최대 30) */
  eligible: number
  noEdit: number
  edited: number
  declined: number
  noEditRate: number | null
  /** 창 안 결함 수 — 창 안에 미측정이 있으면 null */
  hardDefects: number | null
  /** 🔴 cohort 전체(창 밖 포함)의 결함 yes 행 수 */
  cohortHardDefects: number
  /** 창의 queueId — 생성 순서 */
  windowIds: string[]
  /** 🔴 창 안 첫 차단 행 — 없으면 null */
  firstBlocking: CohortBlocker | null
  /** 지금 계약이 아닌 기계 행 수(보고용 — 판정에 쓰지 않는다) */
  legacyRows: number
  meetsContract: boolean
  reasons: string[]
  /**
   * 🔴 (quality-v4) **열림 근거** — `humanCohort`(첫 30건 사람 표본 · v1~v3) 또는 `founderGold`(창업자 gold 재생 +
   *    지금 계약 행의 사람 중대 결함 0). 없으면 `humanCohort` 다.
   */
  basis?: 'humanCohort' | 'founderGold'
  /** 🔴 (founderGold) 재생 요약 — 화면·로그용 */
  founderGold?: string
}

/**
 * 🔴 **후속 계약의 열림 근거를 적용한다** (quality-v4 · 2026-09-28 창업자 결정) — 순수.
 *    사람 30건 표본 대신 **창업자 gold 재생**이 근거다. cohort 는 그대로 계산해 보고하고(지우지 않는다),
 *    그중 **사람 중대 결함**(창 밖 포함 `cohortHardDefects`)은 여전히 닫는다 — 운영 중 사람이 결함을 적으면 멈춘다.
 *    🔴 발행 뒤 감사 결함 · 재시도 가능 실패 · 판정 대기 시한 · 글 유실은 여기가 아니라 `judgeOpen` · 감사 저장소가 닫는다.
 */
export function applyFounderGoldBasis(
  cohort: QualityCohortVerdict,
  gold: { pass: boolean; reasons: readonly string[]; summary: string },
): QualityCohortVerdict {
  const reasons: string[] = []
  if (!gold.pass) reasons.push(`🔴 창업자 gold 재현 실패 — ${gold.reasons.slice(0, 3).join(' · ') || '사유 없음'}`)
  if (cohort.cohortHardDefects > 0) reasons.push(`🔴 지금 품질 계약 사람 중대 결함 ${cohort.cohortHardDefects}건 — 닫는다`)
  return { ...cohort, basis: 'founderGold', founderGold: gold.summary, meetsContract: reasons.length === 0, reasons }
}

/** 🔴 무수정 최소 수 — 정수 계산(부동소수 ceil 어긋남 방지) */
export function noEditNeed(n: number = CONTRACT.reviewSampleMin, rate: number = CONTRACT.noEditAccuracyMin): number {
  const perMille = Math.round(rate * 1000)
  return Math.floor((n * perMille + 999) / 1000)
}

/** 🔴 생성 순서 — createdAt(서버 기본값) → id. 파일에서 온 시각을 쓰지 않는다 */
function byGeneration(a: CohortRow, b: CohortRow): number {
  const d = a.createdAt.getTime() - b.createdAt.getTime()
  if (d !== 0) return d
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 🔴 **이 행에 사람 중대 결함이 있는가** — 결속과 무관하게 본다.
 *    결속이 깨졌다고(나중에 고쳤다고) 발견된 결함이 사라지지 않는다. 사용자별 **최신** 기록만 본다 —
 *    같은 사람의 정정(append-only 재검토)은 존중한다. 누군가의 최신이 yes 면 yes.
 */
export function humanDefectOf(row: Pick<CohortRow, 'editDiff'>): boolean {
  const human = readEvidenceReviews(row.editDiff).filter((r) => isHumanReviewer(r.reviewer))
  return effectiveHumanReviews(human).some((r) => r.hardDefect === 'yes')
}

export function qualityCohortOf(rows: readonly CohortRow[]): QualityCohortVerdict {
  const machine = rows.filter((r) => r.machine)
  const current = machine.filter((r) => isCurrentQualityContract(r.gateResults))
  const seq = current.filter((r) => eligibilityOf({
    gateVerdict: r.gateVerdict, gateResults: r.gateResults,
    title: r.draftTitle, body: r.draftBody, sourceCapturedAt: r.sourceCapturedAt,
  }).auto).slice().sort(byGeneration)
  const N = CONTRACT.reviewSampleMin
  const window = seq.slice(0, N)
  let eligible = 0
  let noEdit = 0
  let edited = 0
  let declined = 0
  let windowDefects = 0
  let unmeasured = false
  let firstBlocking: CohortBlocker | null = null
  window.forEach((r, i) => {
    const v = humanSampleOf(r)
    if (!v.counted || v.hardDefect === 'unmeasured') {
      if (firstBlocking === null) {
        firstBlocking = { index: i + 1, id: r.id, why: v.counted ? 'hardDefectUnmeasured' : v.why }
      }
      if (v.counted) unmeasured = true
      return
    }
    eligible += 1
    if (v.outcome === 'noEdit') noEdit += 1
    else if (v.outcome === 'edited') edited += 1
    else declined += 1
    if (v.hardDefect === 'yes') windowDefects += 1
  })
  const cohortHardDefects = seq.filter((r) => humanDefectOf(r)).length
  const need = noEditNeed()
  const reasons: string[] = []
  if (seq.length < N) reasons.push(`현재 품질 계약 표본 ${seq.length}/${N} — 생성이 더 필요하다`)
  const fb = firstBlocking as CohortBlocker | null
  if (fb !== null) {
    reasons.push(`첫 ${N}건 사람 검토 ${eligible}/${N} — 첫 차단 #${fb.index} ${fb.id} (${fb.why}) · 뒤 행으로 건너뛰지 않는다`)
  }
  if (window.length === N && fb === null && noEdit < need) reasons.push(`무수정 ${noEdit}/${N} < ${need}`)
  if (cohortHardDefects > CONTRACT.hardDefectMax) {
    reasons.push(`🔴 현재 품질 계약 중대 결함 ${cohortHardDefects}건 — 이 계약은 실패다(고친 뒤 새 판으로 다시 검증)`)
  }
  return {
    contractVersion: QUALITY_CONTRACT_VERSION, contractDigest: qualityContractDigest(),
    sequence: seq.length, eligible, noEdit, edited, declined,
    noEditRate: eligible === 0 ? null : noEdit / eligible,
    hardDefects: unmeasured ? null : windowDefects,
    cohortHardDefects,
    windowIds: window.map((r) => r.id),
    firstBlocking: fb,
    legacyRows: machine.length - current.length,
    meetsContract: reasons.length === 0,
    reasons,
  }
}

/** 🔴 보고 한 줄 — 러너·probe·스크립트가 같은 문장을 쓴다 */
export function describeCohort(v: QualityCohortVerdict): string {
  const N = CONTRACT.reviewSampleMin
  return `품질 계약 ${v.contractVersion}(${v.contractDigest.slice(0, 12)}…) · 수열 ${v.sequence} · 첫 ${N}건 사람 표본 ${v.eligible}/${N}`
    + ` · 무수정 ${v.noEdit} · 수정 ${v.edited} · 폐기 ${v.declined}`
    + ` · 창 결함 ${v.hardDefects === null ? '미측정 있음' : v.hardDefects} · cohort 결함 ${v.cohortHardDefects}`
    + `${v.firstBlocking === null ? '' : ` · 첫 차단 #${v.firstBlocking.index} ${v.firstBlocking.id}(${v.firstBlocking.why})`}`
    + ` · legacy 행 ${v.legacyRows}(판정 밖)`
    + `${v.basis === 'founderGold' ? ` · 🔴 열림 근거 창업자 gold(${v.founderGold ?? '?'}) — 사람 표본 30건은 요구하지 않는다` : ''}`
}
