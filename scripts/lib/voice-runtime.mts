/**
 * 🔴 **말투 근거와 Persona 후보 풀을 읽는 한 곳** (2026-09-20 분리)
 *
 *    생성 러너가 후보를 고르는 데 쓰고, 생성 계약(`currentContractBase`)이
 *    "지금 말투 자산·후보 풀이 무엇인가" 를 적는 데 쓴다.
 *    🔴 두 곳이 각자 읽으면 계약에 적힌 값과 실제로 쓴 값이 어긋난다.
 *
 * 🔴 DB 를 읽지 않는다 · provider 를 부르지 않는다 — 파일까지다.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { loadCanonAsset, planBundles } from './persona-reference-store.mjs'
import { PRODUCTION_PERSONA_CODES } from '../../src/lib/persona-cohort'
import { parsePoolDoc, type PoolCard } from '../../src/lib/persona-pool-card'
import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'
import { personaInputOf, personaPoolIdentity, type PersonaInput } from './content-core-run.mjs'
import { VOICE_SAMPLE_MAX } from '../../src/lib/content-core/voice-evidence'

/** 🔴 지문 길이는 저장소가 쓰는 값과 같다 */
export const digest16 = (s: string): string =>
  createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16)

/** 🔴 Persona 정본 카드 문서 — 생성 러너가 읽는 그 경로다 */
export const PERSONA_POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'

/**
 * 🔴 **화자를 여기서 미리 배정하지 않는다** (2026-09-20, Content Core v2 전환).
 *
 *    앞판은 원천마다 Persona 를 **먼저 찍어** 주는 계획 함수가 따로 있었다.
 *    고른 쪽이 원문을 본 적이 없어서 알바 원문에 전업 Persona 가 배정됐다(2026-09-19 실측).
 *    이제 v2 계획 호출이 **원문과 후보 카드를 함께** 보고 고르고, 코드가 근거를 검증한다.
 *    🔴 여기가 하는 일은 **후보 풀을 정본에서 읽어 오는 것**뿐이다.
 */
export type VoiceRuntime = {
  describe: string
  /** 🔴 v2 계획 호출이 이 중에서 고른다 — 정본 카드 + 말투 묶음 */
  candidates: readonly PersonaInput[]
  /** 말투 자산 판 — artifact provenance 에 남는다 */
  sourceDigest: string
  /**
   * 🔴 **실제로 쓸 수 있었던 후보 풀의 지문** — 생성 계약의 한 칸이다.
   *    카드 문서 원문이 아니다. 문서의 오타를 고쳤다고 전량 다시 만들 이유가 없다.
   */
  poolDigest: string
  /** 🔴 정본을 못 읽었다 — provider 호출 전에 전 원천을 막는다 */
  blockAllCode: string | null
  blockReason: string | null
}

/**
 * 🔴 **말투 근거를 붙이고, 누가 쓸지 생성 전에 정한다** (2026-09-13).
 *
 * 🔴 Persona 정체성의 정본은 **Pool 카드 문서**다(`parsePoolDoc` → `cardToPersona`).
 *    DB 를 읽지 않는다 — 이 러너는 파일까지다.
 *
 * 🔴 **정본을 못 읽으면 machine 생성을 provider 호출 전에 멈춘다** (2026-09-13).
 *    말투 자산 · Persona 카드 · 쓸 수 있는 사람 0명 — 셋 다 `blockAllCode` 를 세워
 *    모든 원천에 같은 원인 코드를 남긴다. 예전에는 "말투 근거 없이 씁니다" 하고
 *    그냥 진행했는데, 그렇게 만든 글은 누구 이름으로 낼지 정할 수 없어 전량 보류됐다.
 */
/**
 * 🔴 `now` 를 주면 후보 풀 지문에 **그날의 나이**(`ageEpoch`)가 들어간다 —
 *    생일이 지나면 캐시가 무효화된다. 주지 않으면 앞판과 같다(나이 미포함).
 */
export function loadVoice(now?: Date): VoiceRuntime {
  const none: VoiceRuntime = {
    describe: '', candidates: [], sourceDigest: '', poolDigest: '',
    blockAllCode: null, blockReason: null,
  }
  /** 🔴 정본을 못 읽었다 — 쓰지 않는다. 조용히 품질이 낮은 글을 만들지 않는다 */
  const blocked = (code: string, why: string): VoiceRuntime => ({
    ...none, blockAllCode: code, blockReason: why,
    describe: `  🔴 ${why} — machine 생성을 멈춥니다 (provider 호출 0)`,
  })
  const asset = loadCanonAsset()
  if (!asset.ok || asset.rows.length === 0) {
    return blocked('voiceAssetMissing', `말투 근거 정본을 읽지 못했다 (${asset.code})`)
  }
  const plan = planBundles({ rows: asset.rows, personaCodes: PRODUCTION_PERSONA_CODES })
  const bundleOf = new Map<string, VoiceReferenceBundle>(plan.bundles.map((b) => [b.personaCode, b]))

  // 🔴 정본 카드 — 여기서 Persona 를 만들지 않는다. 문서가 정본이다
  let cards: PoolCard[] = []
  let cardNote = ''
  try {
    const doc = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
    cards = doc.cards
    if (doc.problems.length > 0) cardNote = ` · 🟡 카드 문제 ${doc.problems.length}건`
  } catch {
    return blocked('personaCanonMissing', `Persona 정본 카드를 읽지 못했다 (${PERSONA_POOL_DOC})`)
  }
  /**
   * 🔴 **말투 근거가 선 사람 + 나이대가 있는 사람만 후보다** (2026-09-14).
   *
   *    `ageBand` 가 없으면 생성 프롬프트도 나이 검수도 글쓴이가 몇 살인지 모른다 —
   *    그 상태로 provider 를 부르면 실측 결함(`40대 후반의 언니가 30대 초반`)이 그대로 난다.
   *    🔴 **호출 전에 멈춘다.** 모르는 채로 돈을 쓰고 글을 만들지 않는다.
   */
  const withVoice = cards.filter((p) => bundleOf.has(p.code))
  const hasAge = (p: { ageBand?: string | null }): boolean =>
    typeof p.ageBand === 'string' && p.ageBand.trim() !== ''
  const usable = withVoice.filter(hasAge)
  const noAge = withVoice.filter((p) => !hasAge(p))
  if (withVoice.length === 0) {
    return blocked('noUsablePersona', '말투 근거가 선 Persona 가 0명이다')
  }
  if (usable.length === 0) {
    return blocked('personaAgeBandMissing',
      `정본 나이대(ageBand)가 있는 Persona 가 0명이다 — provider 를 부르지 않는다`
      + ` (말투 근거는 ${withVoice.length}명이 섰다)`)
  }
  const textsOf = (code: string): string[] => (bundleOf.get(code)?.comments ?? []).map((x) => x.text)
  /**
   * 🔴 **정본 변환 하나만 쓴다** (`personaInputOf`). 칸을 손으로 재조립하면
   *    2026-09-19 처럼 말투 기준이 빈 채로 유료 요청이 나간다.
   */
  const candidates = usable.map((c) => personaInputOf(c, {
    samples: textsOf(c.code).slice(0, VOICE_SAMPLE_MAX),
    bundleDigest: digest16(textsOf(c.code).join('\u0000')),
  }))
  /**
   * 🔴 **후보 풀의 지문은 실제 후보에서 만든다.** 생활사 계약 전체 · 말투 토큰 ·
   *    말투 묶음 지문 — 프롬프트에 실려 결과를 바꾸는 값만이다.
   *    🔴 조립은 정본 `personaPoolIdentity` 하나가 한다.
   */
  const poolDigest = digest16(personaPoolIdentity(candidates, now))
  return {
    describe: `  🟢 말투 근거·나이대 모두 선 ${usable.length}명 — v2 계획 호출이 이 중에서 고른다`
      + (noAge.length > 0 ? `\n     🔴 나이대(ageBand) 없어 제외 ${noAge.length}명: ${noAge.map((x) => x.code).join(' · ')}` : '')
      + ` · 자산 ${asset.sourceDigest ?? '?'}${cardNote}`
      + (plan.blocks.length > 0 ? `\n     🟡 ${plan.blocks.slice(0, 2).join(' · ')}` : ''),
    candidates,
    sourceDigest: asset.sourceDigest ?? '',
    poolDigest,
    blockAllCode: null,
    blockReason: null,
  }
}
