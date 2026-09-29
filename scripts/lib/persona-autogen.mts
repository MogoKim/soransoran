/**
 * Persona 자동 후보 **판정 · 말투 풀** — 🔴 운영이 쓰는 검증기를 그대로 부른다 (2026-09-29, Track C)
 *
 * 🔴 **새 판정을 만들지 않는다.** 후보 한 명을 아래 운영 함수에 그대로 통과시킨다.
 *
 *      카드 형식      `parsePoolDoc`            — 정본 문서를 읽는 바로 그 파서 (렌더 → 다시 읽기)
 *      seed          `verifySeedCard`           — `persona-cohort-run --step=seed` 가 쓰는 검증
 *      14축 · 층     `candidateOf` → `personaTiers` — D100 계기판이 쓰는 3계층 카드 층
 *      실회원        `judgeRealMember`          — 모든 경로의 단일 판정
 *      글 자격       `cardToPersona` → `hardFilter` — 배정 판정(`judgeAutoAssignment`)의 정적 축
 *      댓글 자격     `judgePlannerPersona`      — 댓글 분산 planner 의 Persona 쪽 판정
 *      말투 근거     `planBundles` · `referenceSeedShareCount` — 고정 배정과 같은 규칙
 *
 * 🔴 DB · 네트워크 · LLM 없음. 정본 말투 자산(로컬 파일)만 읽는다 — `voicePoolFor`.
 */
import { createHash } from 'node:crypto'

import { cardToPersona, parsePoolDoc, type PoolCard } from '../../src/lib/persona-pool-card'
import { verifySeedCard } from '../../src/lib/persona-card-verify'
import { personaTiers, VOICE_MIN_COMMENTS } from '../../src/lib/d100-persona-scale'
import { judgeRealMember } from '../../src/lib/real-member-gate'
import { hardFilter, readLengthBand, readPostRequirements } from '../../src/lib/original-post-persona-match'
import { judgePlannerPersona, type PlannerPersona, type PlannerPost } from '../../src/lib/persona-comment-planner'
import { COMMENT_REACTION_ROLES } from '../../src/lib/persona-reaction-roles'
import { judgeReferenceBundle, type VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'
import { PRODUCTION_PERSONA_CODES } from '../../src/lib/persona-cohort'
import { isPoolCode } from '../../src/lib/persona-card-verify'
import {
  AUTOGEN_CODE_FIRST, AUTOGEN_FORBIDDEN_ROLES, isNameOnly, lifeProblems, renderPoolCardBlock,
  seedFromCard, voiceCoreFromBundle,
  type AutogenBlockCode, type AutogenCandidate,
} from '../../src/lib/persona-autogen'
import { candidateOf } from './d100-persona-tiers.mjs'
import {
  loadCanonAsset, planBundles, referenceSeedShareCount, stableAssignment,
} from './persona-reference-store.mjs'

export type AutogenVerdict = {
  code: string
  /** 🔴 `valid` 만 활성화 계획에 오른다. `rejected` 는 후보가 아니다(이름만 있다) */
  status: 'valid' | 'quarantined' | 'rejected'
  blocks: AutogenBlockCode[]
  /** 사람이 읽는 사유 — 🔴 원문·닉네임을 담지 않는다 */
  details: string[]
  /** 글 배정 정적 축을 통과하는가 — 재지 못했으면 false */
  postEligible: boolean
  /** 댓글 planner 의 Persona 쪽 판정을 통과하는 역할이 하나라도 있는가 */
  commentEligible: boolean
  /** 렌더된 정본 카드 블록 — creative 가 있을 때만 */
  cardMarkdown: string | null
  seed: Record<string, unknown> | null
  card: PoolCard | null
}

/** 🔴 댓글 자격을 볼 **중립 글** — 요구 축이 없는 글이라 Persona 쪽 판정만 남는다 */
const NEUTRAL_POST: PlannerPost = {
  id: 'autogen-neutral', status: 'PUBLISHED', authorPersonaCode: null,
  memberComments: 0, personaComments: 0, personaCodesOnPost: [], openQueuePersonaCodes: [],
  publishedAtMs: Date.UTC(2026, 8, 29), onHold: false, operatorWritten: false,
  title: '오늘 하루', body: '날이 선선해졌네요',
}

/**
 * 🔴 **한 후보를 운영 검증기에 통과시킨다.** 막힌 이유를 전부 모은다 — 첫 이유에서 멈추지 않는다
 *    (무엇을 채우면 서는지 한 번에 보여야 한다).
 *
 * 🔴 판정에서 **빼는 것** — 둘 다 "아직 켜지 않은 사람" 이라 당연히 붙는 상태다.
 *      `dormant`  활동 기록이 없으면 휴면이다(운영 어댑터 규칙) — 새 후보는 늘 그렇다
 *      `retired`  status≠active — 새 후보는 draft 로 만들어진다
 *    `qualificationConflict` 는 운영에서도 재지 않는 축이라(`null`) 운영 계기판과 같게 뺀다.
 */
export function judgeAutogenCandidate(
  c: AutogenCandidate,
  ctx: { takenCodes: ReadonlySet<string> },
): AutogenVerdict {
  const blocks = new Set<AutogenBlockCode>()
  const details: string[] = []
  const add = (b: AutogenBlockCode, d: string): void => { blocks.add(b); details.push(`${b}: ${d}`) }
  const out = (status: AutogenVerdict['status'], extra: Partial<AutogenVerdict> = {}): AutogenVerdict => ({
    code: c.code, status, blocks: [...blocks], details,
    postEligible: false, commentEligible: false, cardMarkdown: null, seed: null, card: null, ...extra,
  })

  // ── ⓪ 이름만 있는 후보는 격리가 아니라 거부다 ──
  if (isNameOnly(c)) {
    add('NAME_ONLY', '생활사·말투·성격/noGo 가 전부 없다 — 이름만 늘린 사람은 후보가 아니다')
    return out('rejected')
  }

  // ── ① 코드 ──
  const n = Number(c.code.slice(1))
  if (!isPoolCode(c.code) || n < AUTOGEN_CODE_FIRST) add('CODE_INVALID', `${c.code} — 자동 후보는 P${AUTOGEN_CODE_FIRST}~P50 이다`)
  if (ctx.takenCodes.has(c.code)) add('CODE_TAKEN', `${c.code} — 이미 카드나 DB 행이 있다`)

  // ── ② 생활사 골격 ──
  if (c.life === null) add('LIFE_AXIS_MISSING', '생활사 골격이 없다')
  else {
    if (c.life.ageBand.trim() === '') add('NO_AGE_BAND', '나이대가 없다')
    const lp = lifeProblems(c.life)
    if (lp.length > 0) add('LIFE_INCONSISTENT', lp.join(' / '))
  }

  // ── ③ 말투 근거 — 한 화자 · 3건 이상 · 다른 Persona 와 겹치지 않음 ──
  let voiceTokens: string[] = []
  let voiceCore: ReturnType<typeof voiceCoreFromBundle> | null = null
  if (c.voice === null) add('NO_VOICE_EVIDENCE', '배정되지 않은 정본 화자 묶음이 없다')
  else {
    const texts = c.voice.bundle.comments.map((x) => x.text)
    const ref = judgeReferenceBundle({ personaCode: c.code, texts, anchorCount: c.voice.bundle.anchorCount })
    if (!ref.ok) add('VOICE_EVIDENCE_THIN', ref.blocks.map((b) => b.code).join('·'))
    else if (texts.length < VOICE_MIN_COMMENTS || c.voice.bundle.anchorRatio < 1) {
      add('VOICE_EVIDENCE_THIN', `한 화자 댓글 ${texts.length}건 · anchor 비율 ${c.voice.bundle.anchorRatio}`)
    }
    if (c.voice.seedShareCount === null) add('VOICE_SPEAKER_DUPLICATE', '묶음 공유 수를 세지 못했다')
    else if (c.voice.seedShareCount > 1) add('VOICE_SPEAKER_DUPLICATE', `같은 댓글이 ${c.voice.seedShareCount}개 묶음에 있다`)
    voiceCore = voiceCoreFromBundle(c.voice.bundle)
    voiceTokens = [voiceCore.length, voiceCore.register, `"${voiceCore.ending}" 기본`, `이모티콘 ${voiceCore.emoji}`]
    if (readLengthBand(voiceCore.length) === null) add('VOICE_LENGTH_UNREADABLE', voiceCore.length)
  }

  // ── ④ 실회원 — 새 User 가 계정을 가졌거나, 이름이 회원 이름과 부딪히면 안 된다 ──
  const real = judgeRealMember({ accountCount: c.binding.accountCount, providerId: c.binding.providerId })
  if (real.real) add(real.unknown ? 'REAL_MEMBER_UNMEASURED' : 'REAL_MEMBER_COLLISION', real.reason)
  if (c.displayName === null || c.displayName.gate === null) {
    add('REAL_MEMBER_UNMEASURED', '표시명 Gate ⑥-B 를 재지 못했다')
  } else if (c.displayName.gate !== 'pass') {
    add('REAL_MEMBER_COLLISION', `표시명 Gate ⑥-B ${c.displayName.gate}`)
  }

  // ── ⑤ cadence ──
  if (c.cadence === null) add('CADENCE_UNMEASURED', '운영 cadence 최빈값을 읽지 못했다')

  // ── ⑥ creative — 🔴 LLM 단계. 이 PR 은 구현하지 않는다 ──
  if (c.creative === null) {
    add('LLM_STEP_UNIMPLEMENTED', '제목·성격·noGo·variation 을 만드는 단계가 없다 — 기본값으로 채우지 않는다')
  } else {
    if (c.creative.personality.length === 0) add('LIFE_AXIS_MISSING', 'personality')
    if (c.creative.noGoTopics.length === 0) add('LIFE_AXIS_MISSING', 'noGoTopics')
    if (c.creative.noGoExpressions.length === 0) add('LIFE_AXIS_MISSING', 'noGoExpressions')
  }

  // ── ⑦ 카드 → 운영 파서 → seed → 운영 검증기 ──
  if (c.life === null || c.creative === null || voiceCore === null || c.cadence === null) {
    return out('quarantined')
  }
  const cardMarkdown = renderPoolCardBlock({
    code: c.code, life: c.life, creative: c.creative, voiceTokens,
    forbiddenReactionRoles: AUTOGEN_FORBIDDEN_ROLES,
  })
  const parsed = parsePoolDoc(cardMarkdown)
  const card = parsed.cards.find((x) => x.code === c.code) ?? null
  if (card === null || parsed.problems.length > 0) {
    add('CARD_PARSE_FAILED', parsed.problems.join(' / ') || '카드를 읽지 못했다')
    return out('quarantined', { cardMarkdown })
  }
  // 🔴 렌더러와 파서가 같은 사람을 말하는가 — 어긋나면 문서에 다른 사람이 적힌다
  const drift = roundTripDrift(c, card)
  if (drift.length > 0) add('CARD_PARSE_FAILED', `렌더 ≠ 파서: ${drift.join(', ')}`)

  const seed = seedFromCard({ card, life: c.life, voiceCore, variations: c.creative.variations, cadence: c.cadence })
  const seedProblems = verifySeedCard(c.code, seed, card)
  if (seedProblems.length > 0) add('SEED_INVALID', seedProblems.join(' / '))

  // ── ⑧ 14축 — D100 계기판의 카드 층 ──
  const idn = seed.identity as Record<string, unknown>
  const tiers = personaTiers(candidateOf({
    code: c.code, status: 'active', identity: idn,
    ageBand: card.ageBand, region: card.region,
    noGoTopics: card.noGoTopics, noGoExpressions: card.noGoExpressions,
    activityToday: 0, daysSinceActive: 0,
    voiceComments: c.voice?.bundle.comments.length ?? 0,
  }))
  for (const b of tiers.card.blocked) {
    if (b === 'lifeAxisMissing') add('LIFE_AXIS_MISSING', '14축 중 빈 축이 있다 (카드 층)')
    else if (b === 'noAgeBand') add('NO_AGE_BAND', '카드 층')
    else if (b === 'voiceEvidenceThin') add('VOICE_EVIDENCE_THIN', '카드 층')
    // 🔴 dormant·retired 는 입력에서 이미 "활성·오늘 활동" 으로 두었다 — 여기 오면 규칙이 바뀐 것이다
    else add('SEED_INVALID', `카드 층 ${b}`)
  }

  // ── ⑨ 글 자격 — 배정 판정의 정적 축 (요구가 없는 글) ──
  const forMatch = { ...cardToPersona(card), accountCount: c.binding.accountCount ?? null, providerId: c.binding.providerId }
  const hf = hardFilter(forMatch, readPostRequirements('', ''), '', '')
  const postEligible = hf.length === 0 && c.voice !== null && readLengthBand(card.voiceLength) !== null
  if (!postEligible) add('POST_INELIGIBLE', hf.map((b) => b.code).join('·') || '말투 근거·길이')

  // ── ⑩ 댓글 자격 — planner 의 Persona 쪽 판정 + reference ──
  const pm = cardToPersona(card)
  const planner: PlannerPersona = {
    code: c.code, status: 'active',
    realMember: { accountCount: c.binding.accountCount, providerId: c.binding.providerId },
    // 🔴 운영 materializer 와 같은 뜻 — identity · voiceCore · lifeStage 가 모두 있는가
    seedComplete: seed.identity !== undefined && seed.voiceCore !== undefined
      && String(seed.lifeStage ?? '').trim() !== '',
    forbiddenReactionRoles: card.forbiddenReactionRoles,
    recentComments: 0,
    life: {
      ageBand: pm.ageBand, maritalStatus: pm.maritalStatus, childrenCount: pm.childrenCount,
      childrenAgeBands: pm.childrenAgeBands, parentCare: pm.parentCare, menopauseStatus: pm.menopauseStatus,
      workStatus: pm.workStatus, economicStatus: pm.economicStatus, region: pm.region,
      noGoTopics: pm.noGoTopics, voiceLength: pm.voiceLength,
    },
  }
  const roleOk = COMMENT_REACTION_ROLES.some((role) => judgePlannerPersona(planner, NEUTRAL_POST, role).length === 0)
  const commentEligible = roleOk && c.voice !== null
  if (!commentEligible) add('COMMENT_INELIGIBLE', roleOk ? '말투 근거(reference)가 없다' : '맡을 수 있는 댓글 역할이 없다')

  const status = blocks.size === 0 ? 'valid' : 'quarantined'
  return out(status, { postEligible, commentEligible, cardMarkdown, seed, card })
}

/** 🔴 렌더 입력과 파서 결과가 같은 사람인가 — 칸 이름만 돌려준다 */
function roundTripDrift(c: AutogenCandidate, card: PoolCard): string[] {
  const l = c.life!
  const cr = c.creative!
  const same = (a: readonly unknown[], b: readonly unknown[]): boolean =>
    JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort())
  const out: string[] = []
  if (card.ageBand !== l.ageBand) out.push('ageBand')
  if (card.birthDate !== l.birthDate) out.push('birthDate')
  if (card.region !== l.region) out.push('region')
  if (card.maritalStatus !== l.maritalStatus) out.push('maritalStatus')
  if ((card.spouseRelationship ?? '해당없음') !== l.spouseRelationship) out.push('spouseRelationship')
  if (card.childrenCount !== l.childrenCount) out.push('childrenCount')
  if (!same(card.childrenAgeBands, l.childrenAgeBands)) out.push('childrenAgeBands')
  if (card.workStatus !== l.workStatus) out.push('workStatus')
  if (card.economicStatus !== l.economicStatus) out.push('economicStatus')
  if (card.housing !== l.housing) out.push('housing')
  if (card.menopauseStatus !== l.menopauseStatus) out.push('menopauseStatus')
  if (card.parentCare !== l.parentCare) out.push('parentCare')
  if (!same(card.personality, cr.personality)) out.push('personality')
  if (!same(card.noGoTopics, cr.noGoTopics)) out.push('noGoTopics')
  if (!same(card.noGoExpressions, cr.noGoExpressions)) out.push('noGoExpressions')
  if (card.variationCount !== cr.variations.length) out.push('variations')
  return out
}

// ─────────────────────────────────────────────────────────
// 말투 풀 — 🔴 정본 자산에서 **아직 배정되지 않은 화자**만 꺼낸다
// ─────────────────────────────────────────────────────────

const digestOf = (b: VoiceReferenceBundle | undefined): string =>
  b === undefined ? '∅'
    : createHash('sha256').update(b.comments.map((x) => x.text).join('\u0000')).digest('hex').slice(0, 16)

/**
 * 🔴 **확장 배정이 운영 고정 배정을 바꿨는가** — 바뀐 코드 목록. 비어 있어야 한다.
 *    한 코드라도 다른 묶음을 받으면 그 Persona 의 말투가 확장 때문에 바뀐 것이다.
 */
export function assignmentDrift(
  base: ReadonlyMap<string, VoiceReferenceBundle>,
  wide: ReadonlyMap<string, VoiceReferenceBundle>,
  codes: readonly string[],
): string[] {
  return codes.filter((code) => digestOf(base.get(code)) !== digestOf(wide.get(code)))
}

export type VoicePool = {
  ok: boolean
  code: string
  /** 3건 이상 안전 댓글을 가진 화자 수 — 🔴 코드·수만. 화자 식별자는 나가지 않는다 */
  eligibleSpeakers: number
  /** 운영 고정 배정이 이미 쓴 화자 수 */
  assignedSpeakers: number
  /** 🔴 운영 active 인데 말투 근거가 없는 코드 — 새 화자는 **여기부터** 간다(코드순 배정) */
  productionWithoutVoice: string[]
  /** 새 코드별 묶음 — 없으면 그 코드에는 화자가 남지 않았다 */
  byCode: Map<string, { bundle: VoiceReferenceBundle; seedShareCount: number | null }>
  /** 🔴 확장 배정이 운영 고정 배정을 바꿨는가 — 바꾸면 전부 막는다 */
  drift: string[]
}

/**
 * 🔴 **새 코드에 줄 화자를 운영과 같은 규칙으로 정한다.**
 *
 *    운영 `stableAssignment` 는 정본 24코드를 **코드순**으로 세우고 화자를 많이 가진 순으로 준다.
 *    새 코드(P26~)를 그 뒤에 붙여 같은 `planBundles` 를 돌리면 —
 *      · 운영 코드의 묶음은 **그대로**여야 한다(아니면 `drift` — 전부 막는다)
 *      · 남는 화자는 먼저 **운영 active 인데 말투가 없는 코드**(P20~P25)로 가고, 그다음 새 코드로 간다
 *    이것은 운영이 새 코드를 manifest 에 올린 뒤 실제로 계산할 배정과 같다.
 */
export function voicePoolFor(input: { repoRoot: string; newCodes: readonly string[] }): VoicePool {
  const canon = loadCanonAsset()
  const empty: VoicePool = {
    ok: false, code: canon.code, eligibleSpeakers: 0, assignedSpeakers: 0,
    productionWithoutVoice: [], byCode: new Map(), drift: [],
  }
  if (!canon.ok || canon.rows.length === 0) return empty
  const base = stableAssignment({ repoRoot: input.repoRoot })
  const universe = [...new Set([...PRODUCTION_PERSONA_CODES, ...input.newCodes])].sort()
  const wide = planBundles({ rows: canon.rows, personaCodes: universe })
  // 🔴 코드 수가 화자보다 많으면 모든 화자가 배정된다 — 그 수가 "3건 이상 안전 화자" 전부다
  const all = planBundles({
    rows: canon.rows,
    personaCodes: Array.from({ length: 999 }, (_, i) => `X${String(i).padStart(3, '0')}`),
  })
  const wideBy = new Map(wide.bundles.map((b) => [b.personaCode, b]))
  const drift = assignmentDrift(base.byCode, wideBy, PRODUCTION_PERSONA_CODES)
  const byCode: VoicePool['byCode'] = new Map()
  for (const code of input.newCodes) {
    const b = wideBy.get(code)
    if (b === undefined) continue
    byCode.set(code, { bundle: b, seedShareCount: referenceSeedShareCount(wideBy, code) })
  }
  return {
    ok: drift.length === 0,
    code: drift.length === 0 ? 'OK' : 'VOICE_ASSIGNMENT_DRIFT',
    eligibleSpeakers: all.bundles.length,
    assignedSpeakers: base.byCode.size,
    productionWithoutVoice: PRODUCTION_PERSONA_CODES.filter((c) => !base.byCode.has(c)),
    byCode,
    drift,
  }
}
