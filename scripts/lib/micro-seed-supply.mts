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
// sourceSite 계약 (PR-S2-b-1)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **82cook 과 네이버 카페는 양대 주요 Raw 공급망이다.** 하나가 보조가 아니다.
 *
 *   82cook       짧고 당일성 있는 4050·5060 커뮤니티 언어 · 자유게시판형 소재
 *   navercafe    깊은 생활 맥락 · 다양한 실제 고민
 *
 * 한쪽이 막히면 공급이 0이 된다 — 2026-09-03 82cook 접속 실패로 30건 슬롯이
 * 전면 중단됐다. 소스 이중화는 처리량이 아니라 **가용성**의 문제다.
 */

/** Micro Seed Sheet 레인이 받는 유일한 소스. 🔴 여기는 넓히지 않는다 (§레인 분리) */
export const SHEET_LANE_SOURCE_SITE = '82cook'

/**
 * 네이버 카페 sourceSite 형태 — `navercafe:{cafeId}`.
 *
 * 🔴 **cafeId 를 sourceSite 에 넣는 이유**
 *    `dedupKey = sha256(sourceSite::sourceArticleId)` 이고 네이버 articleId 는
 *    **카페 안에서만** 유일하다. cafeId 가 빠지면 다른 카페의 같은 번호 글이
 *    같은 키가 되어 한쪽이 조용히 SKIP 된다.
 *
 * 🔴 **sourceSite 는 운영 단위이지 주제 라벨이 아니다.**
 *    카페마다 성격 경향은 있지만 그것을 고정 라벨로 굳히지 않는다 —
 *    주제·소재 판정은 **글 단위**로 한다(qualityFlags · Originality Gate).
 *    "이 카페는 갱년기 카페" 로 굳히면 그 카페의 다른 글을 잘못 읽고,
 *    다른 카페의 갱년기 글을 놓친다.
 *
 * 실측: Raw Vault 에 `navercafe:remonterrace` / articleId `34783204` 행이 이미 있다.
 *       이 계약은 새로 만드는 것이 아니라 **코드로 고정하는 것**이다.
 */
export const NAVERCAFE_PREFIX = 'navercafe:'

/** cafeId 는 네이버 카페 URL 의 영문 ID 다 (`cafe.naver.com/{cafeId}`) */
const CAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/i

export function isNaverCafeSource(sourceSite: string): boolean {
  if (!sourceSite.startsWith(NAVERCAFE_PREFIX)) return false
  return CAFE_ID_RE.test(sourceSite.slice(NAVERCAFE_PREFIX.length))
}

/** `navercafe:remonterrace` → `remonterrace`. 형태가 아니면 null */
export function cafeIdOf(sourceSite: string): string | null {
  if (!isNaverCafeSource(sourceSite)) return null
  return sourceSite.slice(NAVERCAFE_PREFIX.length)
}

export type SourceVerdict = { ok: true } | { ok: false; reason: string }

/**
 * 이 레인이 이 소스를 받아도 되는가.
 *
 * 🔴 **레인마다 받는 소스가 다르다.**
 *
 *   raw-only     82cook · navercafe:*     Original Post 재료. 승인은 별도 대기열
 *   micro-seed   🔴 82cook 만              Sheet 승인 게이트를 거쳐 **원문 그대로** 발행된다
 *
 * 🔴 네이버를 Sheet 레인에 넣지 않는 이유는 품질이 아니라 **레인의 성격**이다.
 *    Micro Seed 는 원문을 그대로 쓰고 영구 noindex 를 받는다(헌법 §10-5).
 *    네이버 카페 글은 로그인 영역의 글이라 그 레인에 올리는 것은 다른 판단이고,
 *    그 판단을 이 PR 이 대신 내리지 않는다.
 *
 * 🔴 dry-run 은 어느 소스든 **읽고 보여준다** — 판정을 사람이 볼 수 있어야 한다.
 *    막는 것은 실제 적재 모드다.
 */
export function judgeSourceSite(sourceSite: string, mode: SupplyMode): SourceVerdict {
  const known = sourceSite === SHEET_LANE_SOURCE_SITE || isNaverCafeSource(sourceSite)
  if (!known) {
    return {
      ok: false,
      reason:
        `알 수 없는 sourceSite: ${JSON.stringify(sourceSite)} — ` +
        `'${SHEET_LANE_SOURCE_SITE}' 또는 '${NAVERCAFE_PREFIX}{cafeId}' 만 받는다`,
    }
  }
  if (mode === 'micro-seed' && sourceSite !== SHEET_LANE_SOURCE_SITE) {
    return {
      ok: false,
      reason:
        `Micro Seed 레인은 '${SHEET_LANE_SOURCE_SITE}' 만 받는다 (받은 값 ${JSON.stringify(sourceSite)}). ` +
        '네이버는 raw-only 전용이다 — --raw-only --batch=N 을 쓴다',
    }
  }
  return { ok: true }
}

/**
 * 소스별 한 슬롯 수집 상한.
 *
 * 🔴 네이버가 훨씬 작다. **실패 비용이 다르기 때문이다.**
 *    82cook 이 막히면 IP 문제이고 네트워크를 바꾸면 회복된다(2026-09-03 실측).
 *    네이버가 막히면 **계정**이고, 그건 되돌릴 수 없다.
 *
 * 🔴 한 소스를 세게 긁지 않는다. 여러 카페·시간대에 얇게 분산한다.
 */
export const SLOT_QUOTA: Record<string, number> = {
  '82cook': 30,
  /** 🔴 네이버 카페 — 슬롯당 10건. 우나어의 카페당 80건과 의도적으로 다르다 */
  navercafe: 10,
}

/** 이 소스의 한 슬롯 상한. 모르는 소스는 가장 보수적인 값을 준다 */
export function slotQuotaOf(sourceSite: string): number {
  if (sourceSite === SHEET_LANE_SOURCE_SITE) return SLOT_QUOTA['82cook']
  if (isNaverCafeSource(sourceSite)) return SLOT_QUOTA.navercafe
  return Math.min(...Object.values(SLOT_QUOTA))
}

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
 * 🔴 자동 제외는 **두 단계**다. 한 목록에 섞어 두면 작동하지 않는 가드가 생긴다.
 *
 * ## 왜 나누는가 — 2026-09-03 실측 결함
 *
 * 처음엔 하나였다: `AUTO_SKIP_FLAGS = ['politicalOrPublicFigure', 'medicalOrAdLikely']`.
 * 그런데 **자동 선별은 목록 단계에서 일어난다.** 목록에는 제목과 댓글수뿐이다.
 *
 * `medicalOrAdLikely` 는 (시설|시술) **AND** 가격, 또는 상업유도 조합을 요구한다.
 * 제목만으로 그 조합이 성립하는 일은 사실상 없다 — 그래서 목록 단계에서 **한 번도 붙지 않았다.**
 *
 * 실측: `불안으로 정신과약 드셔본 분 계신가요`(4234890) ·
 *       `뇌MRI 사진에서 치매 및 어지럼증 같이 보일까요?`(4234897)
 *       → 목록 단계 플래그는 `highEngagement` 하나뿐. 자동 수집에 그대로 들어왔다.
 *
 * 🔴 **"목록에 있는 이름"과 "그 단계에서 실제로 붙는 플래그"는 다르다.**
 *    이름만 적어 두면 가드가 있는 것처럼 보이지만 아무것도 막지 않는다 —
 *    `noGoTopics` 0/28 히트와 같은 종류의 실패다.
 */

/**
 * ① 목록 단계 자동 제외 — **상세를 열기 전에** 뺀다.
 *
 * 🔴 여기에는 **제목만으로 판정되는 플래그만** 넣는다.
 *    fixture 가 "이 플래그가 제목 하나로 실제 발화하는가" 를 증명하고,
 *    증명하지 못하면 실패한다(구조 가드).
 *
 * 🔴 거부가 아니라 **자동으로 열지 않는 것**이다.
 *    목록 JSONL 에는 전부 남고, 사람이 `--fetch=<id>` 로 지정하면 언제든 열린다.
 *    자동 경로에는 넘길 눈이 없기 때문에 그 경로만 좁힌다.
 */
export const AUTO_SKIP_LIST_FLAGS = ['politicalOrPublicFigure', 'politicalTopicLikely'] as const

/**
 * ② 상세 단계 자동 보류 — 본문을 읽은 **뒤**, Raw Vault 자동 적재 **전**에 뺀다.
 *
 * 🔴 상세 JSONL 에서 지우지 않는다. 원자료는 보존하고 **자동 적재 대상에서만** 뺀다.
 *    사람이 `--sourceArticleId=<id>` 로 지목하면 적재된다 — 그것이 사람의 판단이다.
 *
 * 🔴 Raw Vault 저장 정책과 Originality Gate 정책을 혼동하지 않는다.
 *    Vault 저장은 발행이 아니다. 다만 **자동 원료 공급**에서는 더 보수적으로 간다 —
 *    자동으로 들어온 원문은 자동으로 생성기의 재료가 되고, 그 경로에 사람이 없다.
 */
export const AUTO_HOLD_DETAIL_FLAGS = ['medicalOrAdLikely', 'publicFigureMention'] as const

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
    const hit = AUTO_SKIP_LIST_FLAGS.filter((f) => r.flags.includes(f))
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
// 상세 단계 자동 보류 (import --raw-only)
// ─────────────────────────────────────────────────────────

export type AutoHoldInput = {
  sourceArticleId: string
  /** 상세까지 매겨진 플래그 */
  flags: readonly string[]
  /** 🔴 사람이 `--sourceArticleId` 로 지목했는가. 지목했으면 보류하지 않는다 */
  humanDesignated?: boolean
}

export type AutoHoldVerdict =
  | { hold: false }
  | { hold: true; flags: string[]; detail: string }

/**
 * 자동 적재를 보류할 것인가.
 *
 * 🔴 **사람이 지목한 것은 보류하지 않는다.** `--sourceArticleId=<id>` 는
 *    "이 글을 넣겠다" 는 명시적 판단이고, 그 판단을 코드가 뒤집지 않는다.
 *    자동 경로에만 사람이 없다 — 좁히는 것도 그 경로만이다.
 *
 * 🔴 보류는 삭제가 아니다. 상세 JSONL 의 원자료는 그대로 남는다.
 */
export function judgeAutoHold(input: AutoHoldInput): AutoHoldVerdict {
  if (input.humanDesignated === true) return { hold: false }
  const hit = AUTO_HOLD_DETAIL_FLAGS.filter((f) => input.flags.includes(f))
  if (hit.length === 0) return { hold: false }
  return {
    hold: true,
    flags: [...hit],
    detail: `자동 보류 ${hit.join('·')} — 원자료는 남는다. 넣으려면 --sourceArticleId 로 지목한다`,
  }
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
