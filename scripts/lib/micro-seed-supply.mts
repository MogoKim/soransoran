/**
 * Raw 공급망 규칙 — 🔴 순수 함수. DB · 네트워크 · 파일 없음
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md
 *       docs/operations/2026-09-03-controlled-activity-automation-strategy.md §7
 *       docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-9-F · §12-2
 *
 * 🔴 **왜 이 파일이 따로 있나**
 *    "몇 건을 열어도 되는가" 와 "어떤 write 가 일어나는가" 는 규칙이지 절차가 아니다.
 *    스크립트 안에 두면 DB 를 붙이지 않고는 검증할 수 없다 — micro-seed-quality 와 같은 이유로
 *    import 0 개짜리 파일로 떼어 fixture 가 직접 부른다.
 *
 * 🔴 **두 레인은 상한이 다르다**
 *    Micro Seed 레인은 Sheet 승인 게이트를 통과해야 발행된다. 그 게이트는 사람이 읽는 화면이라
 *    한 번에 50행이 꽂히면 게이트로서 기능하지 않는다 → 여전히 1건이다.
 *    Original Post 레인은 Raw 를 **재료로만** 쓰고 승인은 별도 대기열에서 받는다 →
 *    Raw 적재는 배치로 연다. **같은 importer 지만 여는 문이 다르다.**
 */

// ─────────────────────────────────────────────────────────
// 자동 선별 (collect --auto)
// ─────────────────────────────────────────────────────────

/**
 * 한 실행에서 상세를 여는 최대 건수.
 *
 * 🔴 30 인 이유 — 요청 간격이 2초 고정이라 30건이면 상세만 60초다.
 *    목록 페이지까지 더하면 한 실행이 약 1분 30초 안에 끝난다.
 *    이보다 크게 잡으면 한 번의 실수가 그만큼 크게 나가고, 락파일 TTL 설계도 같이 늘어난다.
 *    300건/day 는 이 값을 키워서가 아니라 **실행 횟수(하루 10회 슬롯)** 로 채운다.
 */
export const AUTO_FETCH_MAX = 30

/**
 * 자동 선별에서 **열지 않는** 플래그.
 *
 * 🔴 이것은 Q-1("품질 플래그로 거부하지 않는다")의 예외가 아니다.
 *    거부가 아니라 **자동으로 열지 않는 것**이다 — 목록 JSONL 에는 전부 그대로 남고,
 *    사람이 `--fetch=<id>` 로 지정하면 언제든 열린다.
 *
 *    구분이 중요한 이유: 자동 경로에 사람이 없다. 정치·실명 글을 자동으로 상세까지 열고
 *    Raw Vault 에 넣으면 그 다음 단계(생성기)가 그것을 재료로 집어 든다.
 *    사람이 고를 때는 보고 넘기면 되지만 자동은 넘길 눈이 없다.
 */
export const AUTO_SKIP_FLAGS = ['politicalOrPublicFigure', 'medicalOrAdLikely'] as const

/** 자동 선별 하한. 🔴 점수가 낮다고 파일에서 지우지 않는다 — 여는 순서와 범위만 정한다 */
export const AUTO_MIN_SCORE = 20

export type AutoFetchInput = {
  sourceArticleId: string
  score: number
  flags: readonly string[]
  /** 이미 Raw Vault 에 있는가 — 부르는 쪽이 실측해 넘긴다 */
  alreadyInVault?: boolean
}

export type AutoSkipReason = 'ALREADY_IN_VAULT' | 'SKIP_FLAG' | 'BELOW_MIN_SCORE' | 'OVER_MAX'

export type AutoFetchPlan = {
  picked: string[]
  skipped: { sourceArticleId: string; reason: AutoSkipReason; detail: string }[]
}

/**
 * 목록에서 상세를 열 후보를 고른다.
 *
 * 🔴 순서가 규칙이다. 이미 있는 것을 **가장 먼저** 걸러낸다 —
 *    Vault 에 있는 글을 다시 여는 것은 82cook 에 부하만 주고 얻는 것이 없다.
 */
export function planAutoFetch(
  rows: readonly AutoFetchInput[],
  opts: { max?: number; minScore?: number } = {},
): AutoFetchPlan {
  const max = opts.max ?? AUTO_FETCH_MAX
  const minScore = opts.minScore ?? AUTO_MIN_SCORE
  const picked: string[] = []
  const skipped: AutoFetchPlan['skipped'] = []

  const ordered = [...rows].sort((a, b) => b.score - a.score || a.sourceArticleId.localeCompare(b.sourceArticleId))

  for (const r of ordered) {
    if (r.alreadyInVault === true) {
      skipped.push({ sourceArticleId: r.sourceArticleId, reason: 'ALREADY_IN_VAULT', detail: '이미 Raw Vault 에 있다' })
      continue
    }
    const hit = AUTO_SKIP_FLAGS.filter((f) => r.flags.includes(f))
    if (hit.length > 0) {
      skipped.push({ sourceArticleId: r.sourceArticleId, reason: 'SKIP_FLAG', detail: `자동 제외 플래그 ${hit.join('·')} — 지정(--fetch)하면 열린다` })
      continue
    }
    if (r.score < minScore) {
      skipped.push({ sourceArticleId: r.sourceArticleId, reason: 'BELOW_MIN_SCORE', detail: `점수 ${r.score} < ${minScore}` })
      continue
    }
    if (picked.length >= max) {
      skipped.push({ sourceArticleId: r.sourceArticleId, reason: 'OVER_MAX', detail: `한 실행 상한 ${max}건을 넘었다 — 다음 실행에서 열린다` })
      continue
    }
    picked.push(r.sourceArticleId)
  }

  return { picked, skipped }
}

// ─────────────────────────────────────────────────────────
// 적재 모드 (import --raw-only / --batch)
// ─────────────────────────────────────────────────────────

/** Micro Seed 레인 적재 상한. 🔴 Sheet 승인 게이트가 사람이 읽는 화면이라 배치를 열지 않는다 */
export const SHEET_LANE_LIMIT = 1

/**
 * Raw-only 적재 한 실행 상한.
 *
 * 🔴 50 인 이유 — 한 번의 잘못된 실행이 되돌려야 할 양이다.
 *    RawContent 는 Post 도 Sheet 행도 만들지 않아 되돌리기가 DELETE 하나지만,
 *    그래도 "한 번에 300건" 은 실수의 크기를 300 으로 만든다.
 *    300/day 는 이 값이 아니라 **슬롯 수**로 채운다.
 */
export const RAW_ONLY_BATCH_MAX = 50

export type SupplyMode = 'dry-run' | 'micro-seed' | 'raw-only'

export type SupplyModeInput = {
  apply: boolean
  /** --limit=N (Micro Seed 레인) */
  limit: number | null
  /** --raw-only */
  rawOnly: boolean
  /** --batch=N (raw-only 레인) */
  batch: number | null
}

export type SupplyWrites = {
  rawContent: boolean
  candidate: boolean
  sheet: boolean
}

export type SupplyModePlan = {
  mode: SupplyMode
  /** 이 실행이 실제로 적재할 최대 건수. dry-run 이면 0 */
  take: number
  writes: SupplyWrites
  /** 왜 dry-run 인지 · 왜 거부인지 */
  notes: string[]
  /** 🔴 인자 조합 자체가 잘못된 경우. 부르는 쪽은 종료해야 한다 */
  fatal: string | null
}

const NO_WRITES: SupplyWrites = { rawContent: false, candidate: false, sheet: false }

/**
 * 인자 조합 → 적재 모드.
 *
 * 🔴 **두 스위치 원칙을 깨지 않는다.** `--apply` 하나로는 아무것도 쓰이지 않는다.
 *    Micro Seed 레인은 `--apply --limit=1`, raw-only 레인은 `--apply --raw-only --batch=N` 이다.
 *    크론이나 오타로 도는 일이 없어야 한다는 원래 이유(§6-9-F)가 그대로 유지된다.
 *
 * 🔴 **섞으면 거부한다.** `--raw-only --limit=1` 이나 `--batch` 단독은 fatal 이다 —
 *    "어느 레인으로 들어가는지" 가 모호한 명령을 통과시키면
 *    Sheet 에 50행이 꽂히는 사고가 오타 하나로 난다.
 */
export function planSupplyMode(input: SupplyModeInput): SupplyModePlan {
  const notes: string[] = []

  // ── 인자 조합 검증 — 모호한 명령을 통과시키지 않는다 ──
  if (input.batch !== null && !input.rawOnly) {
    return {
      mode: 'dry-run', take: 0, writes: NO_WRITES, notes,
      fatal: '--batch 는 --raw-only 와 함께만 쓴다. Micro Seed 레인(Sheet 승인 게이트)은 배치를 열지 않는다',
    }
  }
  if (input.rawOnly && input.limit !== null) {
    return {
      mode: 'dry-run', take: 0, writes: NO_WRITES, notes,
      fatal: '--raw-only 에는 --limit 대신 --batch 를 쓴다. 두 레인의 상한을 같은 이름으로 부르지 않는다',
    }
  }
  if (input.batch !== null && (!Number.isInteger(input.batch) || input.batch < 1 || input.batch > RAW_ONLY_BATCH_MAX)) {
    return {
      mode: 'dry-run', take: 0, writes: NO_WRITES, notes,
      fatal: `--batch 는 1~${RAW_ONLY_BATCH_MAX} 의 정수다 (받은 값: ${String(input.batch)})`,
    }
  }

  // ── raw-only 레인 ──
  if (input.rawOnly) {
    if (!input.apply || input.batch === null) {
      notes.push(`raw-only 실제 적재에는 --apply 와 --batch=N(1~${RAW_ONLY_BATCH_MAX}) 이 둘 다 필요하다`)
      return { mode: 'dry-run', take: 0, writes: NO_WRITES, notes, fatal: null }
    }
    notes.push('🔴 RawContent 만 만든다 — Candidate 없음 · Sheet write 없음 · 발행 경로 없음')
    return {
      mode: 'raw-only',
      take: input.batch,
      writes: { rawContent: true, candidate: false, sheet: false },
      notes,
      fatal: null,
    }
  }

  // ── Micro Seed 레인 (기존 동작 그대로) ──
  if (!input.apply || input.limit !== SHEET_LANE_LIMIT) {
    notes.push(`Micro Seed 레인 실제 적재에는 --apply 와 --limit=${SHEET_LANE_LIMIT} 이 둘 다 필요하다`)
    if (input.apply && input.limit !== null && input.limit !== SHEET_LANE_LIMIT) {
      notes.push(`🔴 --limit=${input.limit} 은 허용하지 않는다. Sheet 승인 게이트는 한 번에 ${SHEET_LANE_LIMIT}건이다`)
    }
    return { mode: 'dry-run', take: 0, writes: NO_WRITES, notes, fatal: null }
  }
  notes.push('RawContent + Candidate(HOLD) + Sheet 행 1개를 만든다')
  return {
    mode: 'micro-seed',
    take: SHEET_LANE_LIMIT,
    writes: { rawContent: true, candidate: true, sheet: true },
    notes,
    fatal: null,
  }
}

/**
 * 🔴 어떤 모드에서도 발행 경로가 열리지 않는다는 불변식.
 *    개발/검증용 — 깨지면 true 를 반환한다.
 */
export function violatesSupplyInvariant(plan: SupplyModePlan): boolean {
  // Sheet 를 쓰면서 Candidate 를 안 만들거나, 그 반대는 성립하지 않는다
  if (plan.writes.sheet !== plan.writes.candidate) return true
  // Candidate 를 만들면서 RawContent 를 안 만들 수 없다
  if (plan.writes.candidate && !plan.writes.rawContent) return true
  // dry-run 인데 무엇이든 쓰면 안 된다
  if (plan.mode === 'dry-run' && (plan.writes.rawContent || plan.writes.candidate || plan.writes.sheet)) return true
  // take 와 mode 가 어긋나면 안 된다
  if (plan.mode === 'dry-run' && plan.take !== 0) return true
  if (plan.mode !== 'dry-run' && plan.take < 1) return true
  return false
}
