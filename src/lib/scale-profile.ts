/**
 * 발행 규모 프로필 — 🔴 **capacity 와 공개 release 를 나눈다** (2026-09-08)
 *
 * 🔴 왜 나누는가.
 *    "몇 명을 준비했는가"(capacity)와 "실제로 몇 건을 공개하는가"(release)는 다른 결정이다.
 *    19명을 켜 두고도 공개는 1/day 로 두는 것이 정상이고, 그 반대는 사고다.
 *    한 값으로 묶으면 사람을 늘리는 순간 발행량이 따라 올라간다.
 *
 * 🔴 **운영 설정은 env 로 읽는다.** 예전 판은 `ACTIVE_PROFILE` 이 코드 리터럴이라
 *    규모를 바꿀 때마다 fixture 를 함께 고쳐야 했다 — 그 계약을 없앴다.
 *    설정을 읽지 못하면 **가장 안전한 단계로 떨어진다**(fail-closed).
 *
 * 🔴 이 파일은 계산만 한다. DB 도 네트워크도 없다. env 는 주입받는다.
 */

/** 🔴 재고를 며칠치로 잡는가 */
export const HORIZON_DAYS = 14

/** 🔴 이 구조가 답하는 상한 */
export const MAX_DAILY_TARGET = 100

// ─────────────────────────────────────────────────────────
// 🔴 rolling 7일 경계 — P1-4
// ─────────────────────────────────────────────────────────

/**
 * 🔴 최소 간격 `g` 일 때 **rolling 7일 창에 최대 몇 건**인가.
 *
 *    0일차에 쓰고 `g` 일마다 쓰면 7일 창에 `floor(6/g)+1` 건이 들어간다.
 *    예: g=3 → 0·3·6 일 = **3건**. 옛 판정 `g × w > 7` 은 이것을 9로 보고 거부했다 —
 *    가능한 조합을 막고 있었다.
 */
export function maxPostsPerWeek(minDaysBetween: number): number {
  if (!Number.isInteger(minDaysBetween) || minDaysBetween < 0) return 0
  if (minDaysBetween === 0) return Number.POSITIVE_INFINITY
  return Math.floor(6 / minDaysBetween) + 1
}

/** 🔴 실제로 쓸 수 있는 주간 상한 — 선언한 cap 과 간격이 허용하는 값 중 작은 쪽 */
export function effectiveWeeklyCap(postsPerWeek: number, minDaysBetween: number): number {
  return Math.min(postsPerWeek, maxPostsPerWeek(minDaysBetween))
}

// ─────────────────────────────────────────────────────────
// 🔴 슬롯 — P1-6
// ─────────────────────────────────────────────────────────

/** 🔴 분 단위다. 정시 배열로는 `00:05 KST` 를 표현할 수 없었다 */
export type Slot = { hour: number; minute: number; count: number }

/** `{hour, minute}` → 하루 중 분 */
export function minuteOfDay(s: { hour: number; minute: number }): number {
  return s.hour * 60 + s.minute
}

/** `HH:MM` */
export function slotLabel(s: { hour: number; minute: number }): string {
  return `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`
}

/** cron 표현 — 🔴 GitHub Actions 는 UTC 다. KST 는 +9 */
export function slotCronUtc(s: { hour: number; minute: number }): string {
  const utcHour = (s.hour - 9 + 24) % 24
  return `${s.minute} ${utcHour} * * *`
}

// ─────────────────────────────────────────────────────────

export type ScaleProfile = {
  /** 하루 몇 건 */
  dailyTarget: number
  /** persona 한 명이 주에 몇 건까지 (선언값) */
  postsPerWeek: number
  /** 같은 persona 가 다시 쓰기까지 최소 며칠 */
  minDaysBetween: number
  /** 🔴 분 단위 슬롯. 합이 `dailyTarget` 이어야 한다 */
  slots: readonly Slot[]
}

/**
 * 🔴 **공개 release 단계 allowlist.**
 *    운영 설정이 이 중 하나를 고른다. 임의 숫자를 받지 않는다 —
 *    슬롯·간격·인원이 함께 검증된 조합만 연다.
 */
export const RELEASE_STAGES = ['d1', 'd3', 'd5', 'd10'] as const
export type ReleaseStage = (typeof RELEASE_STAGES)[number]

/** 🔴 가장 안전한 단계 — 설정을 읽지 못하면 여기로 떨어진다 */
export const SAFEST_STAGE: ReleaseStage = 'd1'

/**
 * 🔴 단계별 프로필. `d10` 의 `postsPerWeek: 5` 는 **실측**이다 —
 *    Pool 19명·주 4건에서 14일 135/140 이었고, 주 5건에서 140/140 이 됐다.
 *    산술 하한(`ceil(70/4)=18명`)은 생활사 hardFilter 를 반영하지 못한다.
 */
/**
 * 🔴 **모든 슬롯은 댓글 운영 창(08:00~22:00) 안에 있다** (2026-09-12).
 *
 *    옛 판은 네 단계 전부 `00:05 KST` 를 포함했다. 러너의 하루 상한이 KST 자정에 열리므로
 *    그 직후를 노린 것이었는데, §9.5-g 의 확정 계약과 충돌했다:
 *    **새 관리형 글의 첫 댓글은 60분 안에** 붙어야 하고 댓글 runner 는 08:07~22:00 에만 돈다.
 *    00:05 에 올린 글은 첫 댓글까지 **8시간 이상** 기다린다 — 계약 위반이고,
 *    아침에 처음 온 사람은 "댓글 하나 없는 어제 글" 을 본다.
 *
 * 🔴 **지켜야 할 계약은 넷이다** — 포함 관계는 여기 없다.
 *      ① 단계별 슬롯 수 = `dailyTarget`
 *      ② 모든 슬롯이 댓글 운영 창 08:00~22:00 안
 *      ③ 댓글 runner 가동 전제에서 다음 댓글 회차까지 60분 이하
 *      ④ 워크플로우가 `allStageCronLines()` 를 빠짐없이 예약
 *
 * 🟢 **[현재값]** 지금 배치에서는 d1·d3·d5 가 마침 d10 의 부분집합이고 합집합이 10개다.
 *    🔴 이것은 **관측이지 계약이 아니다.** 창 안이고 댓글 간격을 지키고 슬롯 수가 맞는
 *    유효한 시간 조정이라면, 포함 관계가 깨져도 막지 않는다 — yml 만 함께 갱신하면 된다.
 *
 * 🔴 **첫 댓글 대기 실측**(`planCommentLoopSchedule(500)` 의 43개 슬롯과 대조):
 *    최대 **20분 이하** · 60분 초과 **0건** · 22시 넘어가는 글 **0건**. fixture 가 이것을 본다.
 *    🔴 **예약표상 값이다** — 댓글 runner 가 등록·loaded 되고 그 stage 가 가동된다는 전제다.
 *    현재 댓글 runner 는 **미등록**이므로 운영 SLA 달성 실적이 아니다.
 */
export const PROFILES: Readonly<Record<ReleaseStage, ScaleProfile>> = {
  // 🔴 지금 운영 중 — 오전 한 편. 댓글 회차 09:46 가 16분 뒤에 받는다
  d1: { dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 5, slots: [{ hour: 9, minute: 30, count: 1 }] },
  d3: {
    dailyTarget: 3, postsPerWeek: 3, minDaysBetween: 2,
    slots: [{ hour: 9, minute: 30, count: 1 }, { hour: 13, minute: 30, count: 1 }, { hour: 19, minute: 0, count: 1 }],
  },
  d5: {
    dailyTarget: 5, postsPerWeek: 4, minDaysBetween: 1,
    slots: [
      { hour: 8, minute: 10, count: 1 }, { hour: 10, minute: 50, count: 1 }, { hour: 13, minute: 30, count: 1 },
      { hour: 16, minute: 10, count: 1 }, { hour: 19, minute: 0, count: 1 },
    ],
  },
  // 🔴 80~90분 간격 — 하루가 고르게 채워져야 "계속 사람이 있다" 로 보인다
  d10: {
    dailyTarget: 10, postsPerWeek: 5, minDaysBetween: 1,
    slots: [
      { hour: 8, minute: 10, count: 1 }, { hour: 9, minute: 30, count: 1 }, { hour: 10, minute: 50, count: 1 },
      { hour: 12, minute: 10, count: 1 }, { hour: 13, minute: 30, count: 1 }, { hour: 14, minute: 50, count: 1 },
      { hour: 16, minute: 10, count: 1 }, { hour: 17, minute: 30, count: 1 }, { hour: 19, minute: 0, count: 1 },
      { hour: 20, minute: 30, count: 1 },
    ],
  },
}

// ─────────────────────────────────────────────────────────
// 🔴 러너 단계 — D20·D30·D50 (2026-09-29 generic scheduler 배선)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **러너가 돌릴 수 있는 단계 — `RELEASE_STAGES` 위에 D20·D30·D50 을 얹는다.**
 *
 *    `RELEASE_STAGES`·`PROFILES` 는 **d1~d10 그대로 둔다.** GitHub 예약 합집합
 *    (`allStageSlots` → `auto-publish.yml`)이 정본으로 쓴다 — 예약 10회를 늘리지 않는다.
 *    D100 용량표(`d100-capacity.schedulerSupportOf`)는 이 러너 프로필을 읽는다 — d20~d50 감당 · d100 미감당.
 *    D20 이상은 **로컬 heartbeat(10분 격자)** 로만 돈다. 슬롯이 전부 그 격자 위에 있어서
 *    GitHub 예약 없이도 catch-up 이 도래한 슬롯을 낸다(`stage-scheduler-check` 가 격자·창·첫 댓글 3회를 본다).
 *
 * 🔴 **D100 은 여기 없다.** 지금 러너(격자 10분 · 회차당 1건 · 첫 댓글 3회 시도)는 하루 80건까지만
 *    담고, 댓글 하루 상한 $0.20 은 첫 댓글 100건을 사지 못한다. 천장으로 **표현**은 되지만
 *    (`stage-ladder-generic.resolveCeiling`) 열 수 있는 천장은 d50 이다.
 *
 * 🔴 **승인 천장은 그대로다.** 이 목록에 있다고 열리는 것이 아니다 — controller 는 승인 천장
 *    (`SORAN_CAPACITY_STAGE`) 위로 어떤 단계도 열지 않는다. 지금 운영값은 d10 이다.
 */
export const RUNTIME_STAGES = ['d1', 'd3', 'd5', 'd10', 'd20', 'd30', 'd50'] as const
export type RuntimeStage = (typeof RUNTIME_STAGES)[number]

/** 🔴 D20 이상 Persona 발행 간격 — 새 숫자가 아니라 d10 운영값 그대로다 */
const EXTENDED_CAPS = { postsPerWeek: PROFILES.d10.postsPerWeek, minDaysBetween: PROFILES.d10.minDaysBetween }
const at = (hm: readonly (readonly [number, number])[]): Slot[] => hm.map(([hour, minute]) => ({ hour, minute, count: 1 }))

/**
 * 🔴 **러너 프로필 — d1~d10 은 `PROFILES` 그대로, D20 이상은 파생 슬롯.**
 *    D20 이상 슬롯은 `stage-ladder-generic.deriveSlots(n, 러너 격자)` 의 결과를 **그대로** 적었다 —
 *    창(08:00~22:00) 안 · heartbeat 10분 격자 위 · 발행 뒤 60분 안 댓글 회차 3번 이상 · 한 분에 한 건.
 *    `stage-scheduler-check` 가 여기 적힌 값과 파생값을 대조한다(손으로 고치면 CI 가 막는다).
 */
export const RUNTIME_PROFILES: Readonly<Record<RuntimeStage, ScaleProfile>> = {
  ...PROFILES,
  d20: {
    dailyTarget: 20, ...EXTENDED_CAPS,
    slots: at([[8, 0], [8, 40], [9, 20], [10, 0], [10, 50], [11, 30], [12, 10], [12, 50], [13, 30], [14, 10],
      [15, 0], [15, 40], [16, 20], [17, 0], [17, 40], [18, 20], [19, 10], [19, 50], [20, 30], [21, 10]]),
  },
  d30: {
    dailyTarget: 30, ...EXTENDED_CAPS,
    slots: at([[8, 0], [8, 30], [8, 50], [9, 20], [9, 50], [10, 20], [10, 40], [11, 10], [11, 40], [12, 10],
      [12, 30], [13, 0], [13, 30], [13, 50], [14, 20], [14, 50], [15, 20], [15, 40], [16, 10], [16, 40],
      [17, 0], [17, 30], [18, 0], [18, 30], [18, 50], [19, 20], [19, 50], [20, 20], [20, 40], [21, 10]]),
  },
  d50: {
    dailyTarget: 50, ...EXTENDED_CAPS,
    slots: at([[8, 0], [8, 20], [8, 30], [8, 50], [9, 0], [9, 20], [9, 40], [9, 50], [10, 10], [10, 30],
      [10, 40], [11, 0], [11, 10], [11, 30], [11, 50], [12, 0], [12, 20], [12, 30], [12, 50], [13, 10],
      [13, 20], [13, 40], [13, 50], [14, 10], [14, 30], [14, 40], [15, 0], [15, 20], [15, 30], [15, 50],
      [16, 0], [16, 20], [16, 40], [16, 50], [17, 10], [17, 20], [17, 40], [18, 0], [18, 10], [18, 30],
      [18, 40], [19, 0], [19, 20], [19, 30], [19, 50], [20, 10], [20, 20], [20, 40], [20, 50], [21, 10]]),
  },
}

export const isRuntimeStage = (v: unknown): v is RuntimeStage =>
  typeof v === 'string' && (RUNTIME_STAGES as readonly string[]).includes(v)

/** 🔴 러너 단계의 프로필 — 정본은 `RUNTIME_PROFILES` 하나다 */
export function profileOf(s: RuntimeStage): ScaleProfile {
  return RUNTIME_PROFILES[s]
}

/** 🔴 러너 단계 중 가장 높은 것 — 지금은 d50 */
export const HIGHEST_RUNTIME_STAGE: RuntimeStage = RUNTIME_STAGES[RUNTIME_STAGES.length - 1]!

// ─────────────────────────────────────────────────────────
// 🔴 운영 설정 — env 주입. 코드 리터럴이 아니다
// ─────────────────────────────────────────────────────────

/** 공개 release 단계를 정하는 env 이름 */
export const RELEASE_ENV = 'SORAN_RELEASE_STAGE'
/** 준비된 capacity 단계 — 사람을 몇 단계까지 켜 뒀는가 */
export const CAPACITY_ENV = 'SORAN_CAPACITY_STAGE'

/**
 * 🔴 **`resolveStage`(d1~d10 만 받는 env 해석)를 지웠다** (2026-09-30). `resolveRuntimeStage` 와 허용 목록이 달라
 *    release 가 d20 이 되면 d1 로 떨어뜨려 읽었다(A2 C9). 러너 단계 해석은 `resolveRuntimeStage` 하나다.
 */
export type RuntimeStageResolution = {
  stage: RuntimeStage
  fromEnv: boolean
  fallbackReason: string | null
}

/**
 * 🔴 **env → 러너 단계** (2026-09-29). `resolveStage` 와 같은 규칙에 허용 목록만 `RUNTIME_STAGES` 다.
 *    모르는 값(d100 포함 — 러너가 담지 못한다)은 **가장 안전한 단계**로 떨어진다.
 *    🔴 `resolveStage` 는 d1~d10 보고서(D100 용량표 · 준비도)용으로 그대로 둔다.
 */
export function resolveRuntimeStage(raw: string | undefined, label = 'release'): RuntimeStageResolution {
  const v = (raw ?? '').trim()
  if (v === '') return { stage: SAFEST_STAGE, fromEnv: false, fallbackReason: `${label} 설정이 없다 — 가장 안전한 ${SAFEST_STAGE} 로 둔다` }
  if (!isRuntimeStage(v)) {
    return { stage: SAFEST_STAGE, fromEnv: false, fallbackReason: `${label} 설정 "${v}" 는 러너 단계가 아니다 (${RUNTIME_STAGES.join('·')}) — ${SAFEST_STAGE} 로 둔다` }
  }
  return { stage: v, fromEnv: true, fallbackReason: null }
}

/**
 * 단계 순서 비교 — 공개량이 준비량을 넘지 못하게 한다.
 * 🔴 러너 단계 전체(`RUNTIME_STAGES`) 위의 순서다 — d1~d10 의 순서는 예전과 같다(0·1·2·3).
 */
export function stageRank(s: RuntimeStage): number {
  return RUNTIME_STAGES.indexOf(s)
}

export type ProfileProblem = string

/** 🔴 프로필이 자기모순이 아닌가 — rolling 경계로 본다 */
export function verifyProfile(p: ScaleProfile): ProfileProblem[] {
  const out: ProfileProblem[] = []
  if (!Number.isInteger(p.dailyTarget) || p.dailyTarget < 1 || p.dailyTarget > MAX_DAILY_TARGET) {
    out.push(`dailyTarget ${p.dailyTarget} — 1~${MAX_DAILY_TARGET} 정수여야 한다`)
  }
  if (!Number.isInteger(p.postsPerWeek) || p.postsPerWeek < 1) out.push(`postsPerWeek ${p.postsPerWeek} — 1 이상 정수`)
  if (!Number.isInteger(p.minDaysBetween) || p.minDaysBetween < 0) out.push(`minDaysBetween ${p.minDaysBetween} — 0 이상 정수`)
  // 🔴 rolling 7일 경계 — `g × w > 7` 이 아니다
  const max = maxPostsPerWeek(p.minDaysBetween)
  if (Number.isFinite(max) && p.postsPerWeek > max) {
    out.push(`주 ${p.postsPerWeek}건인데 간격 ${p.minDaysBetween}일로는 7일에 최대 ${max}건 — 도달할 수 없다`)
  }
  if (p.slots.length === 0) out.push('slots 가 비었다')
  for (const s of p.slots) {
    if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) out.push(`슬롯 시각 ${s.hour} — 0~23`)
    if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59) out.push(`슬롯 분 ${s.minute} — 0~59`)
    if (!Number.isInteger(s.count) || s.count < 1) out.push(`슬롯 ${slotLabel(s)} count ${s.count} — 1 이상`)
  }
  const mins = p.slots.map(minuteOfDay)
  if (new Set(mins).size !== mins.length) out.push('같은 시각 슬롯이 두 번 있다')
  const total = p.slots.reduce((n, s) => n + s.count, 0)
  if (total !== p.dailyTarget) out.push(`슬롯 합 ${total} ≠ 목표 ${p.dailyTarget}`)
  return out
}

export type Derived = {
  dailyPublishCap: number
  stockTarget: number
  stockMin: number
  stockWarn: number
  /** 🔴 산술 최소 인원 — 실제 검증치가 아니다 */
  personasNeededArithmetic: number
  /** 간격까지 반영한 실효 주간 상한 */
  effectiveWeeklyCap: number
  postsInHorizon: number
  slotCount: number
}

export function derive(p: ScaleProfile): Derived {
  const eff = effectiveWeeklyCap(p.postsPerWeek, p.minDaysBetween)
  return {
    dailyPublishCap: p.dailyTarget,
    stockTarget: p.dailyTarget * HORIZON_DAYS,
    stockMin: Math.max(1, Math.ceil(p.dailyTarget * 5)),
    stockWarn: Math.max(1, Math.ceil(p.dailyTarget * 3)),
    // 🔴 **산술값이다.** 생활사 hardFilter 를 반영하지 않는다 —
    //    READY 판정에 이 값만 쓰면 안 된다 (`scale-readiness` 가 시뮬레이션으로 판정한다)
    personasNeededArithmetic: Math.ceil((p.dailyTarget * 7) / eff),
    effectiveWeeklyCap: eff,
    postsInHorizon: p.dailyTarget * HORIZON_DAYS,
    slotCount: p.slots.length,
  }
}

/** 🔴 슬롯을 시각순으로 펴서 하나씩 — 중복 실행에도 전역 cap 이 지켜지는지 계산에 쓴다 */
export function expandSlots(p: ScaleProfile): { minuteOfDay: number; label: string; index: number }[] {
  const out: { minuteOfDay: number; label: string; index: number }[] = []
  let i = 0
  for (const s of [...p.slots].sort((a, b) => minuteOfDay(a) - minuteOfDay(b))) {
    for (let k = 0; k < s.count; k += 1) { out.push({ minuteOfDay: minuteOfDay(s), label: slotLabel(s), index: i }); i += 1 }
  }
  return out
}

export function describeProfile(p: ScaleProfile): string {
  const d = derive(p)
  return `${p.dailyTarget}/day · 주 ${p.postsPerWeek}건(실효 ${d.effectiveWeeklyCap}) · 최소 ${p.minDaysBetween}일`
    + ` · 재고 ${d.stockTarget}건 · 슬롯 ${p.slots.map(slotLabel).join(' ')}`
}

// ─────────────────────────────────────────────────────────
// 🔴 단계 감속(`safeStageFor` · `StageVerdict`)을 지웠다 (2026-09-30 · source-slot-v1)
//
//    14일 준비도 판정으로 공개 단계를 깎던 규칙이다 — 러너(`resolveScale`)와 controller 가 함께 썼다.
//    정본: 14일 완성 글 재고는 지속 준비도가 아니다. 단계는 StageDecision 하나가 정하고,
//    그 결정은 운영 증거 PASS + `judgeNextPreflight` 로 오른다 · 운영 신호 브레이크로만 내려간다.
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// 🔴 시간축 — **두 개다. 섞으면 준비도가 부풀거나 깎인다** (2026-09-08)
//
//    ① `nextSlotAnchor`   그 단계의 **다음 실제 발행 슬롯**. 러너·화면이 "다음에 언제
//       나가는가" 를 말할 때 쓴다. 오늘 몫이 남았으면 오늘, 다 채웠으면 내일이다.
//
//    ② `horizonStart`     **준비도 14일 지평의 시작점.** 언제나 다음 KST 운영일 0시다.
//
//    🔴 왜 나눠야 하는가 — ②에 ①을 쓰면 두 가지가 동시에 깨진다.
//       · **오늘 몫이 한 번 더 계산된다.** d10 에서 오늘 3건을 내고 13:25 를 시작점으로
//         잡으면, 예측기는 그 지점부터 하루를 세어 **오늘 하루에 10건을 다시 배정**한다
//         (= 오늘 13건). 재고·인원이 실제보다 넉넉해 보인다.
//       · **단계 비교가 성립하지 않는다.** d1 은 내일 00:05, d10 은 오늘 13:25 가 되어
//         서로 다른 창(그것도 반나절짜리 조각 하루가 섞인 창)을 비교하게 된다.
//
//    🔴 그래서 지평은 **모든 단계가 같은, 완전한 KST 운영일 14일**이다.
//       오늘(이미 일부가 지나갔고 이미 일부를 낸 날)은 지평에 넣지 않는다.
// ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3600_000

/** KST 자정 (UTC Date) — 하루 경계는 러너와 같아야 한다 */
export function kstMidnight(now: Date): Date {
  const k = new Date(now.getTime() + KST_OFFSET_MS)
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_OFFSET_MS)
}

/**
 * 🔴 그 단계의 **다음 실제 발행 슬롯**.
 *
 *    · 오늘 이미 그 단계의 하루 상한을 채웠으면 → 내일 첫 슬롯
 *    · 아니면 오늘 남은 슬롯 중 `now` 이후 첫 번째, 없으면 내일 첫 슬롯
 *
 *    🔴 슬롯이 여러 건을 내는 경우(`count > 1`)도 슬롯 단위로 본다 —
 *       한 슬롯이 3건을 내면 그 슬롯 하나가 3건을 담당한다.
 */
export function nextSlotAnchor(p: ScaleProfile, input: { now: Date; publishedToday: number }): Date {
  const midnight = kstMidnight(input.now)
  const minutes = [...p.slots].map(minuteOfDay).sort((a, b) => a - b)
  const first = minutes[0] ?? 0
  if (minutes.length === 0) return new Date(midnight.getTime() + DAY_MS)
  // 🔴 오늘 상한을 채웠으면 오늘 남은 슬롯은 의미가 없다
  if (input.publishedToday >= p.dailyTarget) {
    return new Date(midnight.getTime() + DAY_MS + first * 60_000)
  }
  const elapsed = Math.floor((input.now.getTime() - midnight.getTime()) / 60_000)
  const next = minutes.find((m) => m > elapsed)
  return next === undefined
    ? new Date(midnight.getTime() + DAY_MS + first * 60_000)
    : new Date(midnight.getTime() + next * 60_000)
}

/**
 * 🔴 **준비도 지평의 시작점 — 다음 KST 운영일 0시.**
 *
 *    · 단계에 의존하지 않는다. d1·d3·d5·d10 이 **같은 창**을 본다
 *    · 오늘은 지평에 들어가지 않는다 — 이미 일부가 지나갔고 이미 일부를 냈다.
 *      조각 하루를 하루로 세면 그날 상한이 두 번 계산된다
 *    · 그래서 `publishedToday` 를 보지 않는다. 오늘 몫은 지평 밖이라 뺄 것도 더할 것도 없다
 *
 *    🔴 이 값이 `nextSlotAnchor` 와 같아지면 위 두 성질이 깨진다. fixture 가 그것을 본다.
 */
export function horizonStart(now: Date): Date {
  return new Date(kstMidnight(now).getTime() + DAY_MS)
}

/** 🔴 지평이 덮는 KST 운영일 수 — 재고 지평과 같은 값이어야 한다 */
export const HORIZON_ANCHOR_DAYS = HORIZON_DAYS

/** 🔴 주입을 잊었을 때 쓰이는 값. 지금 운영값과 정확히 같다 */
export const SAFEST_PROFILE: ScaleProfile = PROFILES[SAFEST_STAGE]

/**
 * 🔴 **단계 → Persona 발행 상한 — 정본은 여기 하나다** (2026-09-25 자리 이동).
 *    공용 로더에 있던 것을 발행 트랜잭션도 쓰도록 `src/lib` 로 옮겼다. 러너·probe·발행
 *    트랜잭션이 **같은 단계에서 같은 상한**을 얻는다. 숫자를 따로 받지 않는다.
 */
export const releaseCapsOf = (p: ScaleProfile): { postsPerWeek: number; minDaysBetween: number } => ({
  postsPerWeek: effectiveWeeklyCap(p.postsPerWeek, p.minDaysBetween),
  minDaysBetween: p.minDaysBetween,
})
