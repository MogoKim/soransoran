/**
 * Wave C(공개 d3 승격) 준비도 — 🔴 **순수 함수. 하나의 판정으로 묶는다**
 *
 * 🔴 **왜 하나로 묶나.** 조건이 다섯 군데 화면에 흩어져 있으면 사람이 "대충 됐다" 고 읽는다.
 *    공개 발행량을 3배로 올리는 결정은 그렇게 내리면 안 된다 —
 *    하나라도 미달이면 **한 줄로 NOT_READY** 라고 말해야 한다.
 *
 * 🔴 이 판정은 **승격하지 않는다.** 승격은 사람이 `.env.local` 을 바꾸는 별도 행위다.
 */

export type WaveCInput = {
  /** 발행 러너가 먹을 수 있는 재고와 목표 (§6.3) */
  stock: number
  stockTarget: number
  /** Naver 다회 job 이 실제로 그날 돈 횟수 — source 별 */
  naverRuns: Readonly<Record<string, { expected: number; succeeded: number }>>
  /** 보호장치 이상 — 403·429·열린 차단기 */
  guardProblems: readonly string[]
  /** 마지막 공급 회차 checkpoint 상태 */
  lastCheckpoint: string | null
  /** 지금 공개 단계. 🔴 d1 이 아니면 이 판정 자체가 무의미하다 */
  releaseStage: string
  /** 예약 실행 격리가 성립하는가 (`runtime:isolation-check`) */
  runtimeIsolated: boolean
}

export type WaveCVerdict = {
  ready: boolean
  /** 사람이 한 줄로 읽을 판정 */
  summary: string
  /** 못 넘긴 조건들 — 순서가 곧 우선순위다 */
  blockers: string[]
  /** 넘긴 조건들 — "무엇이 이미 됐는지" 도 보여야 다음 판단이 빨라진다 */
  passed: string[]
}

/** 🔴 조건은 다섯이다. 늘리거나 줄이려면 이 목록을 고쳐야 한다(코드가 정본이다) */
export const WAVE_C_CONDITIONS: readonly string[] = [
  '재고가 목표를 채웠다',
  'Naver 다회 슬롯이 계획대로 돌았다',
  '보호장치 이상 0 (403·429·열린 차단기)',
  '마지막 공급 회차 checkpoint 가 done',
  '공개 단계가 아직 d1 이다',
]

export function judgeWaveC(input: WaveCInput): WaveCVerdict {
  const blockers: string[] = []
  const passed: string[] = []

  // ① 재고
  if (input.stock >= input.stockTarget) passed.push(`재고 ${input.stock}/${input.stockTarget}`)
  else blockers.push(`재고 ${input.stock}/${input.stockTarget} — ${input.stockTarget - input.stock}건 모자란다`)

  // ② Naver 다회 슬롯
  const runShort = Object.entries(input.naverRuns)
    .filter(([, v]) => v.succeeded < v.expected)
    .map(([k, v]) => `${k} ${v.succeeded}/${v.expected}회`)
  if (Object.keys(input.naverRuns).length === 0) {
    blockers.push('Naver 다회 실행 기록이 없다 — 한 번도 관측하지 못했다')
  } else if (runShort.length > 0) {
    blockers.push(`Naver 다회 슬롯 미달 — ${runShort.join(' · ')}`)
  } else {
    passed.push(`Naver 다회 슬롯 ${Object.values(input.naverRuns).map((v) => `${v.succeeded}/${v.expected}`).join(' · ')}`)
  }

  // ③ 보호장치
  if (input.guardProblems.length > 0) blockers.push(`보호장치 이상 ${input.guardProblems.length}건 — ${input.guardProblems.join(' · ')}`)
  else passed.push('보호장치 이상 0')

  // ④ checkpoint
  if (input.lastCheckpoint === 'done') passed.push('마지막 회차 checkpoint done')
  else blockers.push(`마지막 회차 checkpoint 가 ${input.lastCheckpoint ?? '없다'} — done 이어야 한다`)

  // ⑤ 🔴 지금 d1 인가. 이미 올라가 있으면 이 판정은 쓸 곳이 없다
  if (input.releaseStage === 'd1') passed.push('공개 단계 d1 유지')
  else blockers.push(`공개 단계가 이미 ${input.releaseStage} 다 — 이 판정은 d1 에서 올릴 때만 쓴다`)

  // ⑥ 🔴 격리 — 예약 실행이 개발 브랜치를 돌고 있으면 위 관측을 믿을 수 없다
  if (input.runtimeIsolated) passed.push('예약 실행 격리 성립')
  else blockers.push('🔴 예약 실행이 격리돼 있지 않다 — 관측한 결과가 어느 코드의 것인지 모른다')

  const ready = blockers.length === 0
  return {
    ready,
    summary: ready
      ? `🟢 WAVE_C_READY — 조건 ${passed.length}개 전부 충족. 승격은 사람이 결정한다`
      : `🔴 NOT_READY — ${blockers.length}건 미달: ${blockers[0]}`,
    blockers,
    passed,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 승격·롤백 계획 — **실행하지 않는다. 무엇을 할지만 정한다**
// ─────────────────────────────────────────────────────────

/** 🔴 공개 d3 의 슬롯. 지금 d1 은 1개다 */
export const D3_PUBLIC_SLOTS = 3
export const RELEASE_ENV_KEY = 'SORAN_RELEASE_STAGE'

export type PromotionPlan = {
  /** 사람이 그대로 따라 할 수 있는 단계 */
  steps: readonly string[]
  /** 되돌리는 방법 — 🔴 올리기 전에 이것부터 확인한다 */
  rollback: readonly string[]
  /** 승격 전후로 반드시 대조할 것 */
  verify: readonly string[]
}

/**
 * 🔴 **승격 계획을 코드가 만든다.** 사람이 그때그때 명령을 지어내면
 *    롤백을 빠뜨리거나 검증을 건너뛴다.
 */
export function planPromotion(input: { from: string; to: string }): PromotionPlan {
  return {
    steps: [
      `① 준비도 재확인 — npm run wave-c:readiness (🔴 NOT_READY 면 여기서 멈춘다)`,
      `② 공개 발행 workflow 슬롯을 ${D3_PUBLIC_SLOTS}개로 올린다 (창업자 승인 필요 · GitHub 설정)`,
      `③ .env.local 의 ${RELEASE_ENV_KEY} 를 ${input.from} → ${input.to} 로 바꾼다 (대상 key 만)`,
      `④ npm run supply:health -- --json 으로 releaseStage=${input.to} · dailyCap 반영을 확인한다`,
      `⑤ 첫 회차 발행 전후로 아래 검증을 돌린다`,
    ],
    rollback: [
      `🔴 ${RELEASE_ENV_KEY} 를 ${input.from} 로 되돌린다 — env 한 줄이면 끝난다`,
      `🔴 workflow 슬롯을 1개로 되돌린다`,
      `🔴 되돌린 뒤 supply:health 로 releaseStage=${input.from} · dailyCap 1 을 확인한다`,
      `🔴 이미 나간 글은 되돌리지 않는다 — 발행 취소는 회원이 본 것을 지우는 일이다`,
    ],
    verify: [
      'DB before/after — Post 증가분이 그날 cap 이하인가',
      'Persona 배정이 실회원 계정에 붙지 않았는가 (Account 0)',
      '재고가 목표 아래로 떨어지지 않는가',
      '보호장치 403·429·열린 차단기 0',
      'checkpoint done · lock/reaper 잔여 0',
    ],
  }
}
