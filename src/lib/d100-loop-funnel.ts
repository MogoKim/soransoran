/**
 * D100 **하나의 루프 깔때기** — 🔴 순수 함수 · **관측·검증 전용**. DB · 파일 · 시계 · env 0
 *
 * 🔴 정본(D100 canon "Required operating measures"): 재고를 성공으로 보지 않고 깔때기를 잰다 —
 *      원문 게시/수집 → 후보 → 생성 → READY → 공개 지연 p50·p90 · 같은 KST 운영일 공개 비율 ·
 *      슬롯 채움 · 비용 · 첫 댓글 지연 · 감사 · Persona reserve 공백.
 *    **"Do not turn these measurements into independent policy engines."**
 *
 * 🔴 **이 파일은 아무것도 판정하지 않는다.** PASS/FAIL · verdict · 승급 · 공급 수요를 내지 않는다.
 *    단계 결정(`stage:controller`) · 공급(`supply:process`) · 발행 러너는 이 파일을 읽지 않는다 —
 *    `d100-readiness-check` 가 import 그래프로 잠근다(보고 화면 두 곳만 허용).
 *
 * 🔴 **원문 게시 시각은 `gateResults.sourceEvidence` 에서만 읽는다**(정본 판독기 `readSourceEvidence`).
 *    공개 행의 계약 여부는 `gateResults.release` 도장(`releaseStampStatusOf`)으로만 본다.
 *    capture 시각 · 초안 시각(`queue.createdAt`) · 목록 시각으로 게시 시각을 **대신하지 않는다** —
 *    기록이 없거나 손상됐으면 그 행은 게시 시각 **미관측**이다.
 *
 * 🔴 **모르는 것은 `null`(미관측)이다.** 0 이나 추정으로 채우지 않는다.
 */
import { AUTO_DECIDER } from './auto-ready-v2'
import { PERSONA_CANARY_FLOOR, D100_STAGES, type D100Stage } from './d100-capacity'
import { AUTO_FIRST_COMMENT_WINDOW_MINUTES } from './persona-comment-auto-lane'
import { readSourceEvidence, releaseStampStatusOf } from './source-slot-release'

export const LOOP_FUNNEL_VERSION = 'loop-funnel-v1'

const HOUR_MS = 3_600_000

/** 🔴 KST 운영일 — `YYYY-MM-DD` */
export const kstDayOf = (ms: number): string => new Date(ms + 9 * HOUR_MS).toISOString().slice(0, 10)

/** 🔴 큐 한 행 — 읽기 전용 판독기가 채운다. 시각은 ISO 또는 null */
export type LoopRow = {
  /** 저장된 `gateResults` — 원문 증거 · 발행 도장은 **여기서만** 읽는다 */
  gateResults: unknown
  /** 큐 행 생성(= 생성 완료) 시각 */
  generatedAt: string
  /** READY 결정 시각 — APPROVED · EDITED · PUBLISHED 행의 `decidedAt`. 아니면 null */
  readyAt: string | null
  /** READY 를 누가 냈나 — `auto-ready:v1` 이면 자동 */
  decidedBy: string | null
  /** 공개 시각 — 연결된 Post 의 생성 시각. 공개 전이면 null */
  publicAt: string | null
  /** 그 글의 첫 Persona 댓글 시각. 없으면 null */
  firstPersonaCommentAt: string | null
  /** 자동 READY 감사 — 선정 안 됐으면 null */
  audit: { judged: boolean; defect: boolean } | null
}

/** 🔴 그날의 단계 목표 — StageDecision 에서 읽는다(결정이 없던 날은 넣지 않는다) */
export type SlotDay = { kstDate: string; release: string; target: number }

export type LoopFunnelInput = {
  rows: readonly LoopRow[]
  /** 창 [from, to) — ISO */
  windowFrom: string
  windowTo: string
  /** 창 안 공급 묶음 원천 수(회차 파일) — 없으면 null(미관측) */
  candidates: number | null
  slotDays: readonly SlotDay[]
  /** 창 안 정산 비용(USD) — 레인마다 모르면 null */
  costs: { supplyUsd: number | null; commentUsd: number | null; auditUsd: number | null }
  /** 🔴 Persona 4상태 정본의 계약 유효 수 — 모르면 null. active 행 수를 넣지 않는다 */
  contractValidPersonas: number | null
}

export type Spread = { n: number; p50H: number | null; p90H: number | null }

export type LoopFunnel = {
  version: typeof LOOP_FUNNEL_VERSION
  window: { from: string; to: string }
  counts: {
    candidates: number | null
    generated: number
    ready: number
    readyAuto: number
    public: number
    publicAuto: number
    /** 지금 계약(`source-slot-v1`) eligible 도장으로 나간 공개 글 */
    publicStamped: number
    /** 원문 게시 시각을 읽을 수 없는 공개 글 — 🔴 지연 · 같은 날 비율에서 빠진다 */
    publicPostedUnknown: number
  }
  latency: {
    sourceToCapture: Spread
    captureToGenerated: Spread
    generatedToReady: Spread
    readyToPublic: Spread
    /** 🔴 원문 게시 → 공개 — 지금 계약 도장으로 나간 글만(preflight 와 같은 모집단) */
    sourceToPublic: Spread
  }
  /** 같은 KST 운영일에 원문 게시와 공개가 모두 일어난 비율 — 모집단은 `sourceToPublic` 과 같다 */
  sameDayPublicShare: { n: number; share: number | null }
  slots: {
    /** StageDecision 이 있던 날의 자동 목표 합 · 자동 공개 합 */
    days: number
    target: number
    filledAuto: number
    fillRate: number | null
    /** 🔴 증명일 slot-valid 기회 덮음 — controller preflight 가 저장하지 않아 여기서는 미관측이다 */
    slotValidCoverage: null
  }
  cost: {
    totalUsd: number | null
    perPublicUsd: number | null
    /** 모르는 레인 */
    unknownLanes: string[]
  }
  comment: {
    firstCommentLatency: { n: number; p50Min: number | null; p90Min: number | null }
    within60Share: number | null
    withoutComment: number
  }
  audit: { autoPublic: number; selected: number; judged: number; defects: number }
  persona: {
    contractValid: number | null
    /** 단계별 canary 하한 대비 공백 — 모르면 null */
    gapByStage: { stage: D100Stage; floor: number; gap: number | null }[]
    /**
     * 🔴 **처음 막히는 전이** — `judgeNextPreflight` 는 **다음 단계**의 canary 하한을 본다.
     *    그래서 계약 유효 수가 d3 하한(24)보다 작으면 D3→D5 가 아니라 **D1→D3 부터** 막힌다.
     *    모르면 null · 전부 채웠으면 'none'.
     */
    firstBlockedTransition: string | null
  }
  /** 미관측 칸 — 화면이 "미관측" 으로 찍는다 */
  unobserved: string[]
}

const toMs = (iso: string | null): number | null => {
  if (iso === null) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** 🔴 최근접 순위 백분위 — 표본이 없으면 null */
export function quantile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))
  return Math.round(s[i]! * 100) / 100
}

const spread = (hours: readonly number[]): Spread => ({
  n: hours.length, p50H: quantile(hours, 0.5), p90H: quantile(hours, 0.9),
})

/** 🔴 원문 증거에서 게시 · 수집 시각을 읽는다 — 다른 칸으로 대신하지 않는다 */
export function sourceTimesOf(gateResults: unknown): { postedMs: number | null; capturedMs: number | null } {
  const ev = readSourceEvidence(gateResults)
  if (!ev.ok) return { postedMs: null, capturedMs: null }
  return { postedMs: toMs(ev.record.postedAt), capturedMs: toMs(ev.record.capturedAt) }
}

const TRANSITION_FROM: Readonly<Record<D100Stage, string>> = {
  d3: 'D1→D3', d5: 'D3→D5', d10: 'D5→D10', d20: 'D10→D20', d30: 'D20→D30', d50: 'D30→D50', d100: 'D50→D100',
}

export function buildLoopFunnel(i: LoopFunnelInput): LoopFunnel {
  const fromMs = Date.parse(i.windowFrom)
  const toMsW = Date.parse(i.windowTo)
  const inWin = (ms: number | null): boolean => ms !== null && ms >= fromMs && ms < toMsW
  const unobserved: string[] = []

  const generatedRows = i.rows.filter((r) => inWin(toMs(r.generatedAt)))
  const readyRows = i.rows.filter((r) => inWin(toMs(r.readyAt)))
  const publicRows = i.rows.filter((r) => inWin(toMs(r.publicAt)))
  const isAuto = (r: LoopRow): boolean => r.decidedBy === AUTO_DECIDER
  const publicAuto = publicRows.filter(isAuto)

  // 지연 — 단계 사이
  const s2c: number[] = []; const c2g: number[] = []; const g2r: number[] = []; const r2p: number[] = []
  for (const r of generatedRows) {
    const { postedMs, capturedMs } = sourceTimesOf(r.gateResults)
    const gen = toMs(r.generatedAt)!
    if (postedMs !== null && capturedMs !== null) s2c.push((capturedMs - postedMs) / HOUR_MS)
    if (capturedMs !== null) c2g.push((gen - capturedMs) / HOUR_MS)
  }
  for (const r of readyRows) {
    const g = toMs(r.generatedAt); const rd = toMs(r.readyAt)
    if (g !== null && rd !== null) g2r.push((rd - g) / HOUR_MS)
  }
  const s2p: number[] = []
  let sameDay = 0
  let postedUnknown = 0
  let stamped = 0
  for (const r of publicRows) {
    const pub = toMs(r.publicAt)!
    const rd = toMs(r.readyAt)
    if (rd !== null) r2p.push((pub - rd) / HOUR_MS)
    const { postedMs } = sourceTimesOf(r.gateResults)
    if (postedMs === null) postedUnknown += 1
    if (releaseStampStatusOf(r.gateResults) !== 'STAMPED_ELIGIBLE') continue
    stamped += 1
    if (postedMs === null) continue
    s2p.push((pub - postedMs) / HOUR_MS)
    if (kstDayOf(postedMs) === kstDayOf(pub)) sameDay += 1
  }
  if (i.candidates === null) unobserved.push('후보(공급 묶음 원천 수)')
  if (s2p.length === 0) unobserved.push('원문 게시 → 공개 지연 · 같은 날 공개 비율(지금 계약 도장 + 게시 시각이 있는 공개 글 없음)')
  if (s2c.length === 0) unobserved.push('원문 게시 → 수집 지연')

  // 슬롯 채움 — StageDecision 이 있던 날, 자동 공개만(사람 승인 글은 자동 목표에 들어가지 않는다)
  const days = new Set(i.slotDays.map((d) => d.kstDate))
  const target = i.slotDays.reduce((a, d) => a + d.target, 0)
  const filledByDay = new Map<string, number>()
  for (const r of publicAuto) {
    const d = kstDayOf(toMs(r.publicAt)!)
    if (days.has(d)) filledByDay.set(d, (filledByDay.get(d) ?? 0) + 1)
  }
  const filledAuto = i.slotDays.reduce((a, d) => a + Math.min(d.target, filledByDay.get(d.kstDate) ?? 0), 0)
  if (i.slotDays.length === 0) unobserved.push('슬롯 채움(창 안 StageDecision 없음)')
  unobserved.push('증명일 slot-valid 기회 덮음(controller preflight 가 저장하지 않는다 — `npm run stage:controller` dry-run 에서 본다)')

  // 비용
  const lanes = [['supply', i.costs.supplyUsd], ['comment', i.costs.commentUsd], ['audit', i.costs.auditUsd]] as const
  const unknownLanes = lanes.filter(([, v]) => v === null).map(([k]) => k)
  const totalUsd = unknownLanes.length > 0 ? null
    : Math.round(lanes.reduce((a, [, v]) => a + (v ?? 0), 0) * 10_000) / 10_000
  const perPublicUsd = totalUsd === null || publicRows.length === 0 ? null
    : Math.round((totalUsd / publicRows.length) * 10_000) / 10_000
  if (totalUsd === null) unobserved.push(`비용(장부 없음: ${unknownLanes.join(' · ')})`)

  // 첫 댓글
  const cmin: number[] = []
  let withoutComment = 0
  for (const r of publicRows) {
    const c = toMs(r.firstPersonaCommentAt)
    if (c === null) { withoutComment += 1; continue }
    cmin.push((c - toMs(r.publicAt)!) / 60_000)
  }
  const within = cmin.filter((m) => m <= AUTO_FIRST_COMMENT_WINDOW_MINUTES).length
  if (cmin.length === 0) unobserved.push('첫 댓글 지연')

  // 감사
  const audit = {
    autoPublic: publicAuto.length,
    selected: publicAuto.filter((r) => r.audit !== null).length,
    judged: publicAuto.filter((r) => r.audit?.judged === true).length,
    defects: publicAuto.filter((r) => r.audit?.defect === true).length,
  }

  // Persona reserve 공백 — 다음 단계 canary 하한
  const cv = i.contractValidPersonas
  const gapByStage = D100_STAGES.map((stage) => ({
    stage, floor: PERSONA_CANARY_FLOOR[stage], gap: cv === null ? null : Math.max(0, PERSONA_CANARY_FLOOR[stage] - cv),
  }))
  const firstShort = cv === null ? null : gapByStage.find((g) => (g.gap ?? 0) > 0) ?? null
  const firstBlockedTransition = cv === null ? null : firstShort === null ? 'none' : TRANSITION_FROM[firstShort.stage]
  if (cv === null) unobserved.push('계약 유효 Persona(Persona 4상태 정본을 읽지 못했다)')

  return {
    version: LOOP_FUNNEL_VERSION,
    window: { from: i.windowFrom, to: i.windowTo },
    counts: {
      candidates: i.candidates,
      generated: generatedRows.length,
      ready: readyRows.length,
      readyAuto: readyRows.filter(isAuto).length,
      public: publicRows.length,
      publicAuto: publicAuto.length,
      publicStamped: stamped,
      publicPostedUnknown: postedUnknown,
    },
    latency: {
      sourceToCapture: spread(s2c),
      captureToGenerated: spread(c2g),
      generatedToReady: spread(g2r),
      readyToPublic: spread(r2p),
      sourceToPublic: spread(s2p),
    },
    sameDayPublicShare: { n: s2p.length, share: s2p.length === 0 ? null : Math.round((sameDay / s2p.length) * 1000) / 1000 },
    slots: {
      days: i.slotDays.length, target, filledAuto,
      fillRate: target === 0 ? null : Math.round((filledAuto / target) * 1000) / 1000,
      slotValidCoverage: null,
    },
    cost: { totalUsd, perPublicUsd, unknownLanes },
    comment: {
      firstCommentLatency: { n: cmin.length, p50Min: quantile(cmin, 0.5), p90Min: quantile(cmin, 0.9) },
      within60Share: cmin.length === 0 ? null : Math.round((within / cmin.length) * 1000) / 1000,
      withoutComment,
    },
    audit,
    persona: { contractValid: cv, gapByStage, firstBlockedTransition },
    unobserved,
  }
}

/** 사람이 읽는 줄 — 🔴 미관측은 "미관측" 이라고 찍는다(0 이 아니다) */
export function describeLoopFunnel(f: LoopFunnel): string[] {
  const h = (v: number | null): string => (v === null ? '미관측' : `${v}h`)
  const sp = (s: Spread): string => (s.n === 0 ? '미관측' : `p50 ${h(s.p50H)} · p90 ${h(s.p90H)} (n=${s.n})`)
  const pct = (v: number | null): string => (v === null ? '미관측' : `${Math.round(v * 1000) / 10}%`)
  const usd = (v: number | null): string => (v === null ? '미관측' : `$${v.toFixed(4)}`)
  const c = f.counts
  const out = [
    `창 ${f.window.from.slice(0, 16)} → ${f.window.to.slice(0, 16)} (UTC)`,
    `후보 ${c.candidates ?? '미관측'} → 생성 ${c.generated} → READY ${c.ready}(자동 ${c.readyAuto}) → 공개 ${c.public}(자동 ${c.publicAuto} · 계약 도장 ${c.publicStamped})`,
    `  원문 게시 → 수집    ${sp(f.latency.sourceToCapture)}`,
    `  수집 → 생성         ${sp(f.latency.captureToGenerated)}`,
    `  생성 → READY        ${sp(f.latency.generatedToReady)}`,
    `  READY → 공개        ${sp(f.latency.readyToPublic)}`,
    `  원문 게시 → 공개    ${sp(f.latency.sourceToPublic)}  (계약 도장 글만)`,
    `  같은 KST 운영일 공개 ${pct(f.sameDayPublicShare.share)} (n=${f.sameDayPublicShare.n})`
      + (c.publicPostedUnknown > 0 ? ` · 🔴 게시 시각 미관측 공개 ${c.publicPostedUnknown}건(대용 시각을 쓰지 않는다)` : ''),
    `  슬롯 채움(자동)     ${f.slots.target === 0 ? '미관측' : `${f.slots.filledAuto}/${f.slots.target} = ${pct(f.slots.fillRate)} (${f.slots.days}일)`}`,
    '  slot-valid 기회 덮음 미관측 — controller preflight(`stage:controller` dry-run)가 본다',
    `  비용                ${usd(f.cost.totalUsd)} · 공개 1건당 ${usd(f.cost.perPublicUsd)}`,
    `  첫 댓글 지연        ${f.comment.firstCommentLatency.n === 0 ? '미관측'
      : `p50 ${f.comment.firstCommentLatency.p50Min}분 · p90 ${f.comment.firstCommentLatency.p90Min}분 · 60분 안 ${pct(f.comment.within60Share)}`}`
      + (f.comment.withoutComment > 0 ? ` · 댓글 없는 공개 ${f.comment.withoutComment}건` : ''),
    `  감사                자동 공개 ${f.audit.autoPublic} · 선정 ${f.audit.selected} · 판정 ${f.audit.judged} · 결함 ${f.audit.defects}`,
    `  Persona 계약 유효   ${f.persona.contractValid ?? '미관측'}`
      + (f.persona.firstBlockedTransition === null ? ''
        : f.persona.firstBlockedTransition === 'none' ? ' · 모든 단계 canary 하한 충족'
          : ` · 🔴 ${f.persona.firstBlockedTransition} 부터 preflight PERSONA_SHORT (다음 단계 하한 `
            + `${f.persona.gapByStage.find((g) => (g.gap ?? 0) > 0)?.floor ?? '?'}명)`),
  ]
  if (f.unobserved.length > 0) out.push(`  🔴 미관측: ${f.unobserved.join(' / ')}`)
  out.push('  🔴 관측 전용 — 이 값은 단계 결정 · 공급 수요 · 발행을 정하지 않는다')
  return out
}
