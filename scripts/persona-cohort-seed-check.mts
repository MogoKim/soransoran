#!/usr/bin/env tsx
/**
 * Persona cohort seed materializer — 순수 fixture 🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0 (2026-10-08)
 *
 * 🔴 fixture 가 실제보다 강하지 않다 — 카드는 **정본 Pool 문서 그대로**, creative 는 그 카드 글자에
 *    합성 variation 을 붙인 것(운영 엄격 파서 통과), 말투 묶음은 운영 검증기(`judgeReferenceBundle`)를 지난 합성 묶음.
 *    반례는 한 칸씩만 비틀어, 정확히 그 사유 코드가 나오는지 본다.
 */
import { readFileSync } from 'node:fs'

import { parsePoolDoc, type PoolCard } from '../src/lib/persona-pool-card'
import { COHORTS, EXCLUDED_CODES } from '../src/lib/persona-cohort'
import { lifeStageOf, type Cadence, type PersonaCreative } from '../src/lib/persona-autogen'
import { judgeReferenceBundle, type VoiceReferenceBundle } from '../src/lib/persona-voice-reference'
import { changesOf, type RemediationRow } from '../src/lib/persona-contract-remediation'
import {
  buildCohortSeeds, judgeCohortVoice, judgeCreativeAgainstCards, judgeExistingOutput, readApprovedCreative,
  seedPrivacyProblems, serializeSeeds, sha256Hex,
} from './lib/persona-cohort-seed.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}
const has = (problems: readonly string[], tag: string): boolean => problems.some((p) => p.startsWith(`[${tag}]`))

console.log('\n══ Persona cohort seed materializer — 순수 fixture ══\n')

const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
const cards = new Map<string, PoolCard>(pool.cards.map((c) => [c.code, c]))
const CODES = COHORTS['wave5-d10'].codes
const card = (c: string): PoolCard => cards.get(c)!

// ── 합성 재료 ──
const BEHAVIORS = ['짧게 공감하고 끝내기', '경험을 한 줄 나누기', '되물어 보기', '웃으며 넘기기', '조용히 응원하기', '살림 요령 하나 건네기',
  '날씨 얘기로 말 걸기', '천천히 하라고 다독이기']
const creativeOf = (c: string): PersonaCreative => ({
  title: card(c).title,
  personality: [...card(c).personality],
  noGoTopics: [...card(c).noGoTopics],
  noGoExpressions: [...card(c).noGoExpressions],
  variations: BEHAVIORS.slice(0, card(c).variationCount).map((b) => `${b} (${c})`),
})
/** 승인 creative 파일 모양(= `--supplement` · 승인 final 파일) — 말버릇은 정본 `"…" 류` 그대로 */
const fileOf = (m: Record<string, PersonaCreative>): string => `${JSON.stringify(m, null, 2)}\n`
const GOOD = Object.fromEntries(CODES.map((c) => [c, creativeOf(c)]))
const goodRaw = fileOf(GOOD)
const goodSha = sha256Hex(goodRaw)

const TEXTS = [
  ['그 마음 알 것 같아요 저도 그랬어요', '천천히 하셔도 돼요 괜찮아요', '날이 많이 추워졌네요 감기 조심하세요'],
  ['아이고 고생 많았네 정말', '그거 참 어렵지 나도 알아', '밥은 꼭 챙겨 먹고 다녀'],
]
const bundleOf = (code: string, i: number): VoiceReferenceBundle => {
  const texts = TEXTS[i % 2]!.map((t) => `${t} ${code}`)
  const v = judgeReferenceBundle({ personaCode: code, texts, anchorCount: texts.length })
  if (!v.ok) throw new Error(`fixture 묶음이 서지 않는다: ${v.blocks.map((b) => b.code).join(',')}`)
  return v.bundle
}
const VOICE = new Map(CODES.map((c, i) => [c, bundleOf(c, i)]))
const CADENCE: Cadence = { dailyCap: 3, weeklyCap: 12, silenceRate: 0.3, activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 } }

// ── ① 정상 6명 ──
console.log('① 정상 — wave5 6명')
{
  const r = readApprovedCreative({ raw: goodRaw, expectSha: goodSha, codes: CODES })
  check('승인 creative 읽기 — SHA · 중복 · 엄격 파서 · 코드 집합 통과', r.ok, r.ok ? '' : r.problems.join(' / '))
  const creatives = r.ok ? r.value : {}
  check('카드 ↔ creative 일치', judgeCreativeAgainstCards({ codes: CODES, creatives, cards }).length === 0)
  const b = buildCohortSeeds({ codes: CODES, cards, creatives, voice: VOICE, cadence: CADENCE })
  check('🔴 반례 1 — 6명 전원 verifySeedCard PASS', b.ok, b.ok ? '' : b.problems.join(' / '))
  const seeds = b.ok ? b.value : {}
  check('🔴 반례 2 — lifeStage = lifeStageOf(카드) 정확히', CODES.every((c) => seeds[c]?.lifeStage === lifeStageOf(card(c))))
  check('🔴 lifeStage 는 카드 제목이 아니다', CODES.every((c) => seeds[c]?.lifeStage !== card(c).title))
  check('🔴 반례 3 — P26 · P27 · P30 어린 자녀 축 → 양육기', ['P26', 'P27', 'P30'].every((c) => seeds[c]?.lifeStage === '양육기'),
    ['P26', 'P27', 'P30'].map((c) => `${c} ${String(seeds[c]?.lifeStage)} ${JSON.stringify(card(c).childrenAgeBands)}`).join(' · '))
  check(`🔴 반례 4 — P28 성인 자녀 축 → 정본 lifeStageOf 결과("${lifeStageOf(card('P28'))}")`,
    seeds.P28?.lifeStage === lifeStageOf(card('P28')) && card('P28').childrenAgeBands.includes('성인'), JSON.stringify(card('P28').childrenAgeBands))
  check('🔴 반례 5 — P29 · P32 무자녀 → 무자녀', ['P29', 'P32'].every((c) => seeds[c]?.lifeStage === '무자녀' && card(c).childrenCount === 0))
  const text = serializeSeeds(CODES, seeds)
  check('seed 키 = cohort 6명 정확히 · 코드 순서', JSON.stringify(Object.keys(JSON.parse(text))) === JSON.stringify(CODES))
  check('결정론 — 같은 입력 같은 바이트', serializeSeeds(CODES, buildCohortSeeds({ codes: CODES, cards, creatives, voice: VOICE, cadence: CADENCE }).ok
    ? (buildCohortSeeds({ codes: CODES, cards, creatives, voice: VOICE, cadence: CADENCE }) as { value: Record<string, Record<string, unknown>> }).value : {}) === text)
  check('variations = 승인 creative 그대로 · cap = 운영 cadence', CODES.every((c) => JSON.stringify(seeds[c]?.voiceVariations) === JSON.stringify(creatives[c]!.variations)
    && seeds[c]?.dailyCap === 3 && seeds[c]?.weeklyCap === 12 && seeds[c]?.silenceRate === 0.3))
  check('🔴 privacy — 말투 묶음 원문 · 화자 · URL · 이메일 0', seedPrivacyProblems(text, { texts: [...VOICE.values()].flatMap((v) => v.comments.map((x) => x.text)), speakerIds: ['speaker-abcdef'] }).length === 0)
  check('🔴 seed 에 원문 묶음 칸이 없다(comments · speakerId · lengths 키 0)', !/"comments"|"speakerId"|"lengths"|"anchorCount"/.test(text))
}

// ── ② 승인 creative fail-closed ──
console.log('② 🔴 승인 creative — fail-closed')
{
  const wrongSha = readApprovedCreative({ raw: goodRaw, expectSha: '0'.repeat(64), codes: CODES })
  check('🔴 반례 6 — 잘못된 SHA → CREATIVE_SHA_MISMATCH', !wrongSha.ok && has(wrongSha.problems, 'CREATIVE_SHA_MISMATCH'))
  const judge = (m: Record<string, PersonaCreative>, raw = fileOf(m)) => readApprovedCreative({ raw, expectSha: sha256Hex(raw), codes: CODES })
  const missing = judge(Object.fromEntries(CODES.slice(1).map((c) => [c, GOOD[c]!])))
  check('🔴 반례 7a — 코드 누락 → CREATIVE_MISSING_CODE', !missing.ok && has(missing.problems, 'CREATIVE_MISSING_CODE'))
  const extra = judge({ ...GOOD, P34: { ...GOOD.P26!, title: '다른 사람', variations: GOOD.P26!.variations.map((v) => `${v}!`) } })
  check('🔴 반례 7b — 코드 추가 → CREATIVE_EXTRA_CODE', !extra.ok && has(extra.problems, 'CREATIVE_EXTRA_CODE'), extra.ok ? '' : extra.problems.join(' / '))
  const dupRaw = `${goodRaw.trimEnd().slice(0, -1)},"P27":${JSON.stringify(GOOD.P27)}}`
  const dup = judge(GOOD, dupRaw)
  check('🔴 반례 7c — 코드 중복(원문) → CREATIVE_DUPLICATE_CODE', !dup.ok && has(dup.problems, 'CREATIVE_DUPLICATE_CODE'))
  const broken = judge({ ...GOOD, P28: { ...GOOD.P28!, variations: ['하나'] } })
  check('엄격 파서 위반 → CREATIVE_INVALID', !broken.ok && has(broken.problems, 'CREATIVE_INVALID'))
}

// ── ③ 카드 ↔ creative ──
console.log('③ 🔴 카드 ↔ creative 불일치 · variation 개수')
{
  const j = (patch: Partial<PersonaCreative>) => judgeCreativeAgainstCards({ codes: CODES, creatives: { ...GOOD, P27: { ...GOOD.P27!, ...patch } }, cards })
  check('🔴 반례 8a — title 불일치', j({ title: `${GOOD.P27!.title} 다르게` }).some((p) => p === '[CARD_CREATIVE_MISMATCH] P27: title'))
  check('🔴 반례 8b — personality 불일치', j({ personality: [...GOOD.P27!.personality].reverse() }).some((p) => p.endsWith('P27: personality')))
  check('🔴 반례 8c — noGo 소재 불일치', j({ noGoTopics: [...GOOD.P27!.noGoTopics, '추가 소재'] }).some((p) => p.endsWith('P27: noGoTopics')))
  check('🔴 반례 8d — noGo 표현 불일치', j({ noGoExpressions: ['"다른 말버릇" 류'] }).some((p) => p.endsWith('P27: noGoExpressions')))
  check('🔴 반례 9 — variation 개수 불일치', j({ variations: GOOD.P27!.variations.slice(0, -1) }).some((p) => p.startsWith('[VARIATION_COUNT_MISMATCH] P27')))
  const noCard = new Map(cards); noCard.delete('P30')
  check('카드 누락 → CARD_MISSING', has(judgeCreativeAgainstCards({ codes: CODES, creatives: GOOD, cards: noCard }), 'CARD_MISSING'))
}

// ── ④ 말투 · cadence ──
console.log('④ 🔴 말투 묶음 누락 · 기존 배정 drift · cadence 없음')
{
  const a = bundleOf('P01', 0)
  const b = bundleOf('P01', 1)
  const full = new Map([...VOICE, ['P01', a]])
  check('정상 — 누락 0 · drift 0', judgeCohortVoice({ cohortCodes: CODES, existingCodes: ['P01'], base: new Map([['P01', a]]), full }).length === 0)
  const noVoice = new Map(full); noVoice.delete('P32')
  check('🔴 반례 10a — 대상 묶음 누락 → VOICE_BUNDLE_MISSING', has(judgeCohortVoice({ cohortCodes: CODES, existingCodes: ['P01'], base: new Map([['P01', a]]), full: noVoice }), 'VOICE_BUNDLE_MISSING'))
  check('🔴 반례 10b — 기존 production 묶음이 바뀜 → VOICE_ASSIGNMENT_DRIFT',
    has(judgeCohortVoice({ cohortCodes: CODES, existingCodes: ['P01'], base: new Map([['P01', b]]), full }), 'VOICE_ASSIGNMENT_DRIFT'))
  const nc = buildCohortSeeds({ codes: CODES, cards, creatives: GOOD, voice: VOICE, cadence: null })
  check('🔴 반례 11 — cadence 없음 → CADENCE_UNMEASURED', !nc.ok && has(nc.problems, 'CADENCE_UNMEASURED'))
  const badCap = buildCohortSeeds({ codes: CODES, cards, creatives: GOOD, voice: VOICE, cadence: { ...CADENCE, dailyCap: 11 } })
  check('seed 한 명이라도 verifySeedCard 실패 → SEED_INVALID · seed 전체 없음', !badCap.ok && has(badCap.problems, 'SEED_INVALID') && !('value' in badCap))
}

// ── ⑤ privacy · 출력 ──
console.log('⑤ 🔴 privacy · 기존 출력 파일')
{
  const t = '{"P26":{"voiceVariations":["그 마음 알 것 같아요 저도 그랬어요 P26"]}}'
  check('🔴 댓글 원문이 seed 에 → SEED_PRIVACY', has(seedPrivacyProblems(t, { texts: ['그 마음 알 것 같아요 저도 그랬어요 P26'], speakerIds: [] }), 'SEED_PRIVACY'))
  check('🔴 화자 id → SEED_PRIVACY', has(seedPrivacyProblems('{"x":"speaker-abcdef"}', { texts: [], speakerIds: ['speaker-abcdef'] }), 'SEED_PRIVACY'))
  check('🔴 URL · 이메일 → SEED_PRIVACY', has(seedPrivacyProblems('{"x":"https://example.invalid"}', { texts: [], speakerIds: [] }), 'SEED_PRIVACY')
    && has(seedPrivacyProblems('{"x":"a.b@example.invalid"}', { texts: [], speakerIds: [] }), 'SEED_PRIVACY'))
  check('짧은 맞장구가 겹치는 것은 유출로 세지 않는다(10자 미만)', seedPrivacyProblems('{"x":"맞아요"}', { texts: ['맞아요'], speakerIds: [] }).length === 0)
  check('기존 파일 없음 → write · 같은 내용 → same · 다름 → conflict',
    judgeExistingOutput(null, 'a') === 'write' && judgeExistingOutput('a', 'a') === 'same' && judgeExistingOutput('a', 'b') === 'conflict')
}

// ── ⑥ 기존 의미 불변 ──
console.log('⑥ 🔴 기존 의미 불변 — lifeStageOf 규칙표 · remediation 카드 제목 fallback · P09')
{
  const L = (childrenCount: number, childrenAgeBands: string[], parentCare: string): string =>
    lifeStageOf({ childrenCount, childrenAgeBands: childrenAgeBands as PoolCard['childrenAgeBands'], parentCare })
  check('lifeStageOf 규칙표 그대로 — 무자녀 · 양육기 · 자녀 독립 준비 · 부모 돌봄기 · 자녀 독립기',
    L(0, [], '상시') === '무자녀' && L(1, ['초등'], '없음') === '양육기' && L(2, ['성인', '대학·취준'], '없음') === '자녀 독립 준비'
    && L(1, ['성인'], '상시') === '부모 돌봄기' && L(1, ['성인'], '간헐') === '자녀 독립기')
  const c07 = card('P07')
  const row: RemediationRow = { code: 'P07', status: 'active', updatedAt: '2026-10-01T00:00:00.000Z', ageBand: c07.ageBand, region: c07.region,
    lifeStage: null, identity: {}, voiceCore: {}, noGoTopics: c07.noGoTopics, noGoExpressions: c07.noGoExpressions, forbiddenReactionRoles: c07.forbiddenReactionRoles }
  const ls = changesOf(row, c07).changes.find((x) => x.field === 'lifeStage')
  check('🔴 반례 15 — 기존 행 복구(remediation)는 여전히 카드 제목으로 채운다', ls?.after === c07.title, String(ls?.after))
  check('P09 제외(EXCLUDED_CODES)는 cohort seed 대상이 아니다', Object.keys(EXCLUDED_CODES).every((c) => !CODES.includes(c)))
}

// ── ⑦ 연결 — CLI 가 이 판정을 실제로 부른다 ──
console.log('⑦ CLI 연결')
{
  const cli = readFileSync('scripts/persona-cohort-seed.mts', 'utf-8')
  check('CLI 가 readApprovedCreative · judgeCreativeAgainstCards · judgeCohortVoice · buildCohortSeeds · seedPrivacyProblems · judgeExistingOutput 를 부른다',
    ['readApprovedCreative({', 'judgeCreativeAgainstCards({', 'judgeCohortVoice({', 'buildCohortSeeds({', 'seedPrivacyProblems(text', 'judgeExistingOutput('].every((s) => cli.includes(s)))
  check('🔴 CLI 는 DB 를 읽기만 한다(create · update · delete · upsert · $transaction 0)', !/\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(|\$transaction|\$executeRaw/.test(cli))
  check('🔴 CLI 는 provider 를 부르지 않는다', !/anthropic|openai|gemini|fetch\(/i.test(cli))
  check('🔴 --write 일 때만 쓴다 · 임시 파일 → rename · 600', /if \(!WRITE\) \{/.test(cli) && cli.indexOf('if (!WRITE) {') < cli.indexOf('writeFileSync(tmp')
    && /writeFileSync\(tmp, text, \{ mode: 0o600 \}\)/.test(cli) && /renameSync\(tmp, path\)/.test(cli))
}

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
