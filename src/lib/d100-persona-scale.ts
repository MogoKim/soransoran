/**
 * Persona 24 → 180~200 **확장 계약** — 🔴 순수 함수
 *
 * 🔴 **카드만 늘린다고 READY 가 되지 않는다.** 이 파일이 그것을 타입과 판정으로 막는다.
 *    한 사람이 서려면 생활사 14축 · 말투 근거 · 활동 여력 · 자격이 전부 있어야 한다.
 *
 * 🔴 **이번 PR 은 Persona 를 만들지 않는다.** 필요 인원과 준비 상태만 계산한다.
 */
import { LIFE_CONTRACT_FIELDS } from './content-core/speaker'
import { d100Plan, D100_PERSONA_TARGET_MAX, type D100Stage } from './d100-capacity'

/** 🔴 생활사 축은 생성 계약과 **같은 목록**이다 — 여기서 다시 적지 않는다 */
export const PERSONA_LIFE_AXES = LIFE_CONTRACT_FIELDS

/** 🔴 말투 근거 최소치 — 이보다 적으면 그 사람의 말투라고 부를 수 없다 */
export const VOICE_MIN_COMMENTS = 3

export const PERSONA_BLOCK_CODES = [
  'lifeAxisMissing', 'voiceEvidenceThin', 'noAgeBand',
  'topicConcentrated', 'roleConcentrated',
  'activityOverCap', 'consecutiveExposure', 'pairRepeat',
  'dormant', 'retired', 'qualificationConflict',
] as const
export type PersonaBlockCode = (typeof PERSONA_BLOCK_CODES)[number]

export const PERSONA_BLOCK_LABEL: Readonly<Record<PersonaBlockCode, string>> = {
  lifeAxisMissing: '생활사 축이 비었다',
  voiceEvidenceThin: '말투 근거가 모자라다',
  noAgeBand: '나이대가 없다 — 글쓴이가 몇 살인지 모른다',
  topicConcentrated: '한 소재에 쏠렸다',
  roleConcentrated: '한 역할에 쏠렸다',
  activityOverCap: '글·댓글 합산 활동 상한을 넘겼다',
  consecutiveExposure: '연속으로 노출됐다',
  pairRepeat: '같은 조합이 반복됐다',
  dormant: '휴면이다',
  retired: '퇴역했다',
  qualificationConflict: '자격이 충돌한다',
}

/** 🔴 한 사람이 하루에 쓸 수 있는 글·댓글 합 — 사람처럼 보이는 상한이다 */
export const ACTIVITY_CAP_PER_DAY = 6
/** 🔴 한 사람이 연속으로 노출될 수 있는 횟수 */
export const CONSECUTIVE_EXPOSURE_CAP = 1
/** 🔴 같은 두 사람이 한 글에 다시 붙기까지 비워야 할 글 수 */
export const PAIR_REPEAT_GAP = 5
/** 🔴 이 기간 활동이 없으면 휴면 */
export const DORMANT_AFTER_DAYS = 30

export type PersonaCandidate = {
  code: string
  /** 생활사 14축 중 값이 있는 축 */
  filledAxes: readonly string[]
  ageBand: string | null
  /** 말투 근거 댓글 수 */
  voiceComments: number
  /** 오늘 이미 한 글+댓글 */
  activityToday: number
  /** 바로 앞 글에 연속으로 나왔는가 */
  consecutiveExposures: number
  /** 마지막 활동 이후 지난 날 */
  daysSinceActive: number
  retired: boolean
  qualificationConflict: boolean
}

/** 🔴 이 사람이 지금 쓸 수 있는가 — 막는 이유를 전부 낸다 */
export function personaBlockers(p: PersonaCandidate): PersonaBlockCode[] {
  const out: PersonaBlockCode[] = []
  if (PERSONA_LIFE_AXES.some((a) => !p.filledAxes.includes(a))) out.push('lifeAxisMissing')
  if (p.ageBand === null || p.ageBand.trim() === '') out.push('noAgeBand')
  if (p.voiceComments < VOICE_MIN_COMMENTS) out.push('voiceEvidenceThin')
  if (p.activityToday >= ACTIVITY_CAP_PER_DAY) out.push('activityOverCap')
  if (p.consecutiveExposures > CONSECUTIVE_EXPOSURE_CAP) out.push('consecutiveExposure')
  if (p.daysSinceActive >= DORMANT_AFTER_DAYS) out.push('dormant')
  if (p.retired) out.push('retired')
  if (p.qualificationConflict) out.push('qualificationConflict')
  return out
}

export function personaUsable(p: PersonaCandidate): boolean {
  return personaBlockers(p).length === 0
}

export type PersonaScaleNeed = {
  stage: D100Stage
  target: number
  targetMax: number
  usable: number
  /** 🔴 카드는 있는데 계약을 못 채운 사람 */
  cardsOnly: number
  shortfall: number
  ready: boolean
}

/**
 * 🔴 **카드 수가 아니라 쓸 수 있는 사람 수로 센다.**
 *    카드만 180장 만들어도 `usable` 이 모자라면 READY 가 아니다.
 */
export function judgePersonaScale(input: {
  stage: D100Stage
  candidates: readonly PersonaCandidate[]
}): PersonaScaleNeed {
  const plan = d100Plan(input.stage)
  const usable = input.candidates.filter(personaUsable).length
  return {
    stage: input.stage,
    target: plan.activePersonaTarget,
    targetMax: input.stage === 'd100' ? D100_PERSONA_TARGET_MAX : plan.activePersonaTarget,
    usable,
    cardsOnly: input.candidates.length - usable,
    shortfall: Math.max(0, plan.activePersonaTarget - usable),
    ready: usable >= plan.activePersonaTarget,
  }
}
