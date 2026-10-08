/**
 * Persona **cohort seed materializer** 판정 — 🔴 순수 함수. DB · 파일 · 네트워크 · LLM 없음 (2026-10-08)
 *
 * `tmp/persona-<cohort>-seed.json`(= `persona-cohort-run --step=seed` 의 입력)을 **결정적으로** 만든다.
 * 회차마다 seed JSON 을 손으로 쓰지 않는다 — 다음 Persona batch 도 같은 함수를 지난다.
 *
 *   입력 authority (하나씩만)
 *     대상 코드        `COHORTS[cohort].codes`
 *     생활사 · 정체성   정본 Pool 카드(`parsePoolDoc`) — personality · noGo · forbidden 포함
 *     variations       승인 creative 파일(SHA 고정) — 카드에는 개수만 있다
 *     voiceCore        현재 `PRODUCTION_PERSONA_CODES` 전체 기준 `stableAssignment` → `voiceCoreFromBundle`
 *     cadence          운영 active Persona 의 `modeCadence`
 *     lifeStage        `lifeStageOf`(카드의 생활사 축) — 🔴 카드 제목이 아니다
 *     조립 · 검증       `seedFromCard` → `verifySeedCard`
 *
 * 🔴 하나라도 어긋나면 파일을 쓰지 않는다 — 일부만 만들지 않는다.
 */
import { createHash } from 'node:crypto'

import type { PoolCard } from '../../src/lib/persona-pool-card'
import { seedFromCard, voiceCoreFromBundle, type Cadence, type PersonaCreative } from '../../src/lib/persona-autogen'
import { duplicateKeys, verifySeedCard } from '../../src/lib/persona-card-verify'
import { parseCreativeFile } from '../../src/lib/persona-creative'
import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'
import { assignmentDrift } from './persona-autogen.mjs'

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

export type Judged<T> = { ok: true; value: T } | { ok: false; problems: string[] }

/**
 * 🔴 **승인 creative 읽기** — SHA 가 먼저다(승인한 그 파일인가). 그다음 중복 키 · 엄격 파서 · 코드 집합.
 *    `JSON.parse` 는 중복 키를 조용히 덮으므로 원문에서 따로 센다.
 */
export function readApprovedCreative(input: {
  raw: string
  expectSha: string
  codes: readonly string[]
}): Judged<Record<string, PersonaCreative>> {
  const sha = sha256Hex(input.raw)
  if (sha !== input.expectSha) return { ok: false, problems: [`[CREATIVE_SHA_MISMATCH] 파일 ${sha} ≠ 승인 ${input.expectSha}`] }
  const dupes = duplicateKeys(input.raw)
  if (dupes.length > 0) return { ok: false, problems: [`[CREATIVE_DUPLICATE_CODE] ${dupes.join(',')}`] }
  const parsed = parseCreativeFile(input.raw)
  if (!parsed.ok) return { ok: false, problems: parsed.problems.map((p) => `[CREATIVE_INVALID] ${p}`) }
  const keys = Object.keys(parsed.creatives)
  const missing = input.codes.filter((c) => !keys.includes(c))
  const extra = keys.filter((c) => !input.codes.includes(c))
  const problems = [
    ...(missing.length > 0 ? [`[CREATIVE_MISSING_CODE] ${missing.join(',')}`] : []),
    ...(extra.length > 0 ? [`[CREATIVE_EXTRA_CODE] ${extra.join(',')}`] : []),
  ]
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: parsed.creatives }
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * 🔴 **creative ↔ 정본 카드** — 승인 카드에 들어간 글자와 승인 creative 가 같아야 한다.
 *    title · personality · noGo 소재 · noGo 표현은 글자까지, variations 는 카드의 개수와 같아야 한다.
 */
export function judgeCreativeAgainstCards(input: {
  codes: readonly string[]
  creatives: Readonly<Record<string, PersonaCreative>>
  cards: ReadonlyMap<string, PoolCard>
}): string[] {
  const problems: string[] = []
  for (const code of input.codes) {
    const card = input.cards.get(code)
    const cr = input.creatives[code]
    if (card === undefined) { problems.push(`[CARD_MISSING] ${code}`); continue }
    if (cr === undefined) { problems.push(`[CREATIVE_MISSING_CODE] ${code}`); continue }
    if (cr.title !== card.title) problems.push(`[CARD_CREATIVE_MISMATCH] ${code}: title`)
    if (!sameList(cr.personality, card.personality)) problems.push(`[CARD_CREATIVE_MISMATCH] ${code}: personality`)
    if (!sameList(cr.noGoTopics, card.noGoTopics)) problems.push(`[CARD_CREATIVE_MISMATCH] ${code}: noGoTopics`)
    if (!sameList(cr.noGoExpressions, card.noGoExpressions)) problems.push(`[CARD_CREATIVE_MISMATCH] ${code}: noGoExpressions`)
    if (cr.variations.length !== card.variationCount) {
      problems.push(`[VARIATION_COUNT_MISMATCH] ${code}: creative ${cr.variations.length} ≠ 카드 ${card.variationCount}`)
    }
  }
  return problems
}

/**
 * 🔴 **말투 묶음** — 대상 전원에게 묶음이 있어야 하고, 이 cohort 를 universe 에 넣은 배정이
 *    **그 밖의 production Persona 묶음을 하나도 바꾸지 않아야** 한다(`assignmentDrift`).
 *    `base` = cohort 를 뺀 production 으로 나눈 배정 · `full` = 현재 production 전체 배정(`stableAssignment`).
 */
export function judgeCohortVoice(input: {
  cohortCodes: readonly string[]
  existingCodes: readonly string[]
  base: ReadonlyMap<string, VoiceReferenceBundle>
  full: ReadonlyMap<string, VoiceReferenceBundle>
}): string[] {
  const missing = input.cohortCodes.filter((c) => !input.full.has(c))
  const drift = assignmentDrift(input.base, input.full, input.existingCodes)
  return [
    ...(missing.length > 0 ? [`[VOICE_BUNDLE_MISSING] ${missing.join(',')}`] : []),
    ...(drift.length > 0 ? [`[VOICE_ASSIGNMENT_DRIFT] 기존 production 묶음이 바뀐다: ${drift.join(',')}`] : []),
  ]
}

/**
 * 🔴 **seed 조립 — `seedFromCard` 그대로**, lifeStage 축은 카드에서(`lifeStageOf`). 그다음 `verifySeedCard`.
 *    한 명이라도 실패하면 seed 전체가 없다.
 */
export function buildCohortSeeds(input: {
  codes: readonly string[]
  cards: ReadonlyMap<string, PoolCard>
  creatives: Readonly<Record<string, PersonaCreative>>
  voice: ReadonlyMap<string, VoiceReferenceBundle>
  cadence: Cadence | null
}): Judged<Record<string, Record<string, unknown>>> {
  if (input.cadence === null) return { ok: false, problems: ['[CADENCE_UNMEASURED] 운영 active Persona cadence 가 없다'] }
  const seeds: Record<string, Record<string, unknown>> = {}
  const problems: string[] = []
  for (const code of input.codes) {
    const card = input.cards.get(code)
    const cr = input.creatives[code]
    const bundle = input.voice.get(code)
    if (card === undefined || cr === undefined || bundle === undefined) { problems.push(`[SEED_INPUT_MISSING] ${code}`); continue }
    const seed = seedFromCard({ card, life: card, voiceCore: voiceCoreFromBundle(bundle), variations: cr.variations, cadence: input.cadence })
    const bad = verifySeedCard(code, seed, card)
    if (bad.length > 0) problems.push(`[SEED_INVALID] ${code}: ${bad.join(' / ')}`)
    seeds[code] = seed
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: seeds }
}

/** 🔴 seed 파일 글자 — 코드 순서 고정 · 끝 줄바꿈. 같은 입력이면 같은 바이트다 */
export function serializeSeeds(codes: readonly string[], seeds: Readonly<Record<string, Record<string, unknown>>>): string {
  return `${JSON.stringify(Object.fromEntries(codes.map((c) => [c, seeds[c]])), null, 2)}\n`
}

/** 원문으로 볼 최소 길이 — 짧은 맞장구("맞아요")가 variation 글자와 우연히 겹치는 것은 유출이 아니다 */
export const LEAK_MIN_CHARS = 10

/**
 * 🔴 **privacy** — seed 글자에 말투 자산의 댓글 원문 · 화자 id · URL · 이메일이 없어야 한다.
 *    말투 묶음에서는 **파생된 voiceCore 만** 들어간다. 대조 결과에는 원문을 담지 않는다(건수만).
 */
export function seedPrivacyProblems(text: string, asset: { texts: readonly string[]; speakerIds: readonly string[] }): string[] {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
  const body = norm(text)
  const leaked = asset.texts.map(norm).filter((t) => [...t].length >= LEAK_MIN_CHARS && body.includes(t)).length
  const ids = asset.speakerIds.filter((id) => id.length >= 6 && text.includes(id)).length
  return [
    ...(leaked > 0 ? [`[SEED_PRIVACY] 댓글 원문 ${leaked}건`] : []),
    ...(ids > 0 ? [`[SEED_PRIVACY] 화자 id ${ids}건`] : []),
    ...(/https?:\/\/|www\./i.test(text) ? ['[SEED_PRIVACY] URL'] : []),
    ...(/[\w.+-]+@[\w-]+\.[\w.]+/.test(text) ? ['[SEED_PRIVACY] 이메일'] : []),
  ]
}

/**
 * 🔴 **기존 출력 파일** — 없으면 쓴다 · 같은 digest 면 그대로 둔다(멱등) · 다르면 **덮지 않는다**.
 *    다른 실행 · 다른 승인으로 만든 seed 를 조용히 바꾸지 않는다.
 */
export function judgeExistingOutput(existing: string | null, next: string): 'write' | 'same' | 'conflict' {
  if (existing === null) return 'write'
  return sha256Hex(existing) === sha256Hex(next) ? 'same' : 'conflict'
}
