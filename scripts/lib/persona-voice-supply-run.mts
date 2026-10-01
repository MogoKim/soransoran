/**
 * Persona 말투 공급 → **draft 후보** — 공급 묶음 · 생활사 골격 · creative · 운영 검증기 (2026-09-29, Lane 3)
 *
 * 🔴 판정은 #623 의 `judgeAutogenCandidate` 를 **그대로** 부른다(카드 파서 · seed 검증 · 3계층 ·
 *    실회원 · 글/댓글 자격 · seed 공유). 여기서 새 판정을 만들지 않는다.
 *
 * 🔴 대상 순서 — 공급 계획(`planVoiceSupply`)의 `targets` 그대로:
 *      P20~P25  운영 active 인데 정본 말투가 없는 코드 → **말투 보충 계획**만 낸다(Persona 는 이미 있다)
 *      P26~     새 코드 → 말투 · 골격 · creative 를 붙여 **후보**로 판정한다
 *
 * 🔴 draft 로 갈 수 있는 것은 `valid` 이면서 creative 가 **live** 에서 온 것뿐이다.
 *    fixture creative 는 격리 DB(`SORAN_ISOLATED_DB=yes-throwaway`)에서만 허용한다 —
 *    fixture 가 운영 Persona 를 만들면 그것이 곧 "활발한 척" 이다.
 */
import type { PoolCard } from '../../src/lib/persona-pool-card'
import {
  proposeLifeSkeletons, voiceCoreFromBundle,
  type AutogenCandidate, type Cadence, type DisplayNameCheck, type PersonaCreative,
} from '../../src/lib/persona-autogen'
import { judgeAutogenCandidate, type AutogenVerdict } from './persona-autogen.mjs'
import {
  runCreativeStep, type CreativeBudget, type CreativeOrigin, type CreativeOutcomeCode, type CreativeProvider,
} from './persona-voice-creative.mjs'
import type { SpeakerBlockCode, VoiceSupplyPlan } from './persona-voice-supply.mjs'

export type VoiceTopUp = {
  code: string
  comments: number
  seedShareCount: number | null
  blocks: SpeakerBlockCode[]
}

export type SupplyCandidate = {
  code: string
  verdict: AutogenVerdict
  creativeOrigin: CreativeOrigin | null
  /** creative 가 서지 않은 이유 — 🔴 `null` 이면 섰거나 부를 이유가 없었다(말투 없음) */
  creativeCode: CreativeOutcomeCode | null
  /** 🔴 draft 적재 대상인가 — valid · live creative (격리 DB 는 fixture 허용) */
  draftable: boolean
  draftBlock: string | null
}

export type SupplyRun = {
  topUps: VoiceTopUp[]
  candidates: SupplyCandidate[]
  /** 🔴 creative provider 를 실제로 부른 횟수 — 말투 없는 후보에는 부르지 않는다 */
  creativeCalls: number
}

/**
 * 🔴 **draft 로 가도 되는가** — 판정 결과와 creative 출처만 본다.
 *    `rejected`(이름만) · `quarantined` 는 어떤 경우에도 가지 않는다.
 */
export function draftGate(v: { status: AutogenVerdict['status']; origin: CreativeOrigin | null; allowFixture: boolean }): string | null {
  if (v.status !== 'valid') return `status=${v.status}`
  if (v.origin === null) return 'creative 없음'
  if (v.origin === 'fixture' && !v.allowFixture) return 'fixture creative — 격리 DB 에서만 적재한다'
  return null
}

export async function runVoiceSupply(input: {
  plan: VoiceSupplyPlan
  productionCodes: readonly string[]
  pool: readonly PoolCard[]
  takenCodes: ReadonlySet<string>
  provider: CreativeProvider
  budget: CreativeBudget | null
  liveEnabled: boolean
  cadence: Cadence | null
  names: ReadonlyMap<string, string> | null
  gateOf: ((name: string) => DisplayNameCheck['gate']) | null
  allowFixture: boolean
}): Promise<SupplyRun> {
  const slotOf = new Map(input.plan.slots.map((s) => [s.code, s]))
  const topUps: VoiceTopUp[] = input.plan.targets
    .filter((c) => input.productionCodes.includes(c))
    .map((code) => {
      const s = slotOf.get(code)
      return { code, comments: s?.bundle.comments.length ?? 0, seedShareCount: s?.seedShareCount ?? null, blocks: s?.blocks ?? [] }
    })

  const newCodes = input.plan.targets.filter((c) => !input.productionCodes.includes(c))
  const skeletons = proposeLifeSkeletons({ existing: input.pool, codes: newCodes })
  const lifeOf = new Map(skeletons.map((s) => [s.code, s.life]))

  const candidates: SupplyCandidate[] = []
  let creativeCalls = 0
  for (const code of newCodes) {
    const slot = slotOf.get(code)
    const life = lifeOf.get(code) ?? null
    const voice = slot === undefined ? null : { bundle: slot.bundle, seedShareCount: slot.seedShareCount }

    // 🔴 말투가 없으면 creative 를 부르지 않는다 — 어차피 격리될 사람에게 돈을 쓰지 않는다
    let creative: PersonaCreative | null = null
    let origin: CreativeOrigin | null = null
    let creativeCode: CreativeOutcomeCode | null = null
    if (voice !== null && life !== null) {
      creativeCalls += 1
      const out = await runCreativeStep(input.provider, { code, life, voiceCore: voiceCoreFromBundle(voice.bundle) }, {
        budget: input.budget, liveEnabled: input.liveEnabled,
      })
      if (out.ok) { creative = out.creative; origin = out.origin } else creativeCode = out.code
    }

    const name = input.names?.get(code) ?? null
    const cand: AutogenCandidate = {
      code, life, creative, voice, cadence: input.cadence,
      // 🔴 자동 후보는 언제나 새 User — 계정 0 · providerId 없음
      binding: { accountCount: 0, providerId: null },
      displayName: name === null || input.gateOf === null ? null : { name, gate: input.gateOf(name) },
    }
    const verdict = judgeAutogenCandidate(cand, { takenCodes: input.takenCodes })
    // 🔴 운영 배정이 바이트 하나라도 바뀌었으면 전원 격리 — 이 계획 전체를 믿을 수 없다
    if (input.plan.drift.length > 0) {
      verdict.blocks.push('VOICE_ASSIGNMENT_DRIFT')
      if (verdict.status === 'valid') verdict.status = 'quarantined'
    }
    const draftBlock = draftGate({ status: verdict.status, origin, allowFixture: input.allowFixture })
    candidates.push({ code, verdict, creativeOrigin: origin, creativeCode, draftable: draftBlock === null, draftBlock })
  }
  return { topUps, candidates, creativeCalls }
}
