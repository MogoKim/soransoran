/**
 * 🔴 **단계 값의 원천이 둘이다 — 그래서 갈라진다** (2026-09-24 실측)
 *
 *   ```
 *   공급  supply-process   launchd(로컬)  ← canonical env.local
 *   발행  auto-publish     GitHub Actions ← GitHub Variables
 *   수집  supply-collect   GitHub Actions ← GitHub Variables
 *   ```
 *
 *   2026-09-24: D5 전환 때 **GitHub 만** d5 로 올리고 canonical 을 d3 로 두었다.
 *   공급 러너는 매 회차 canonical 을 읽으므로 하루 내내 d3 로 돌았고,
 *   화자 여력이 0명이 되어 후보가 **0건**이었다. 발행 쪽은 d5 로 GO 였다.
 *
 * 🔴 **`publish:trigger-preflight` 가 이 불일치를 잡지만 아무도 자동으로 부르지 않는다.**
 *    발행 러너 설치 절차 문서에만 있다 — 사람이 그 절차를 밟을 때까지 갈라진 채로 간다.
 *
 * 🔴 **canary·window 는 canonical 에 아예 없다.** 그래서 공급은 그 값을 **영영 보지 못한다** —
 *    발행이 기간 허가로 d5 를 열어도 공급은 d1/d3 재고만 만든다.
 *
 * 이 파일은 두 원천을 **하나로 화해**시키고, 갈라진 지점을 값으로 낸다.
 * 🔴 순수 함수다 — 파일도 네트워크도 모른다.
 */
import { RELEASE_STAGES, resolveStage, stageRank, SAFEST_STAGE, type ReleaseStage } from './scale-profile'

/** 🔴 두 원천이 **똑같이** 들고 있어야 하는 키 */
export const SHARED_STAGE_KEYS = ['SORAN_CAPACITY_STAGE', 'SORAN_RELEASE_STAGE'] as const

/**
 * 🔴 **GitHub 에만 있고 canonical 에는 없는 키.** 공급이 못 보는 값들이다 —
 *    빠졌다고 막지는 않되, **공급이 그 허가를 모른다는 사실**을 값으로 남긴다.
 */
export const PUBLISH_ONLY_KEYS = [
  'SORAN_RELEASE_CANARY_STAGE', 'SORAN_RELEASE_CANARY_DATE',
  'SORAN_RELEASE_WINDOW_STAGE', 'SORAN_RELEASE_WINDOW_FROM', 'SORAN_RELEASE_WINDOW_UNTIL',
] as const

export type StageConflict = {
  key: string
  canonical: string
  github: string
}

export type StageReconciliation = {
  /** 🔴 실제로 쓸 값 — 갈라졌으면 **낮은 쪽**이다 */
  capacity: ReleaseStage
  release: ReleaseStage
  /** 갈라진 키 — 비어 있어야 정상이다 */
  conflicts: StageConflict[]
  /** 공급이 보지 못하는 발행 전용 키 (값은 담지 않는다 — 있는지만) */
  publishOnlyPresent: string[]
  /** 사람이 읽는 줄 */
  notes: string[]
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 🔴 **갈라지면 낮은 쪽을 쓴다** (fail-closed).
 *
 *    멈추지 않는 이유: 멈추면 공급이 끊긴다. 낮은 쪽으로 가면 **덜 내는 것**뿐이고,
 *    그것은 되돌릴 수 있다. 높은 쪽으로 가면 준비되지 않은 양을 내보낸다.
 *    🔴 어느 쪽을 버렸는지 `conflicts` 에 값으로 남긴다 — 조용히 고르지 않는다.
 */
export function reconcileStageSources(input: {
  canonical: Readonly<Record<string, string | undefined>>
  github: Readonly<Record<string, string | undefined>>
}): StageReconciliation {
  const conflicts: StageConflict[] = []
  const notes: string[] = []
  const pick = (key: string, label: 'capacity' | 'release'): ReleaseStage => {
    const c = S(input.canonical[key])
    const g = S(input.github[key])
    const cr = resolveStage(c === '' ? undefined : c, label)
    const gr = resolveStage(g === '' ? undefined : g, label)
    if (cr.fallbackReason !== null) notes.push(`canonical ${key}: ${cr.fallbackReason}`)
    if (gr.fallbackReason !== null) notes.push(`github ${key}: ${gr.fallbackReason}`)
    if (cr.stage === gr.stage) return cr.stage
    conflicts.push({ key, canonical: cr.stage, github: gr.stage })
    const lower = stageRank(cr.stage) <= stageRank(gr.stage) ? cr.stage : gr.stage
    notes.push(
      `🔴 ${key} 가 갈라졌다 — canonical ${cr.stage} · github ${gr.stage}. `
      + `낮은 쪽 ${lower} 를 쓴다(준비되지 않은 양을 내보내지 않는다)`,
    )
    return lower
  }
  const capacity = pick('SORAN_CAPACITY_STAGE', 'capacity')
  const release = pick('SORAN_RELEASE_STAGE', 'release')

  const publishOnlyPresent = PUBLISH_ONLY_KEYS
    .filter((k) => S(input.github[k]) !== '' && S(input.canonical[k]) === '')
  if (publishOnlyPresent.length > 0) {
    notes.push(
      `🔴 발행 전용 허가 ${publishOnlyPresent.length}개가 GitHub 에만 있다 — `
      + '공급 러너는 이 값을 보지 못한다(재고가 그 단계를 따라가지 못할 수 있다)',
    )
  }
  return { capacity, release, conflicts, publishOnlyPresent, notes }
}

/**
 * 🔴 **공급과 발행이 같은 스냅샷을 보는가.** 한 회차가 정한 단계를 파일로 남기고,
 *    다른 러너가 그 값을 그대로 쓰는지 대조한다 — 같은 날 서로 다른 단계로 도는 것을 막는다.
 */
export type StageSnapshot = {
  kstDate: string
  /** 그 회차가 실제로 쓴 값 */
  capacity: ReleaseStage
  release: ReleaseStage
  /** 어디서 정했나 */
  decidedBy: 'supply' | 'publish' | 'ladder'
  decidedAt: string
}

export type SnapshotVerdict =
  | { ok: true; note: string }
  | { ok: false; code: 'DATE_MISMATCH' | 'STAGE_MISMATCH' | 'MISSING'; reason: string }

export function sameStageSnapshot(
  a: StageSnapshot | null, b: StageSnapshot | null,
): SnapshotVerdict {
  if (a === null || b === null) {
    return { ok: false, code: 'MISSING', reason: '한쪽 스냅샷이 없다 — 같은 값을 본다고 말할 수 없다' }
  }
  if (a.kstDate !== b.kstDate) {
    return { ok: false, code: 'DATE_MISMATCH', reason: `날짜가 다르다 — ${a.kstDate} vs ${b.kstDate}` }
  }
  if (a.capacity !== b.capacity || a.release !== b.release) {
    return {
      ok: false, code: 'STAGE_MISMATCH',
      reason: `단계가 다르다 — ${a.decidedBy}(cap ${a.capacity}·rel ${a.release})`
        + ` vs ${b.decidedBy}(cap ${b.capacity}·rel ${b.release})`,
    }
  }
  return { ok: true, note: `${a.kstDate} cap ${a.capacity} · rel ${a.release} — 두 러너가 같은 값을 본다` }
}

/** 🔴 아무 값도 못 읽었을 때 쓰는 가장 안전한 결론 */
export const SAFEST_RECONCILIATION: StageReconciliation = Object.freeze({
  capacity: SAFEST_STAGE, release: SAFEST_STAGE,
  conflicts: [], publishOnlyPresent: [],
  notes: [`🔴 단계 값을 읽지 못했다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다`],
})

/** 🔴 허용 단계 목록은 정본 하나다 — 여기서 다시 적지 않는다 */
export const LADDER_STAGES = RELEASE_STAGES
