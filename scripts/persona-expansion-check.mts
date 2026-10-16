#!/usr/bin/env tsx
/**
 * Persona 확장 계약 fixture — 🔴 **DB 0 · 네트워크 0 · LLM 0 · 파일 write 0** (2026-10-13)
 *
 * 🔴 **죽은 게이트를 만들지 않는다.** 판정마다 한 칸만 비튼 반례를 넣어 **정확히 그 코드**가 나오는지 본다 —
 *    다른 이유로 막혀 우연히 통과하는 반례는 반례가 아니다.
 * 🔴 **fixture 가 실제보다 강하면 안 된다.** 말투 근거는 합성 댓글이지만 판정은 운영 검증기를 그대로 지난다.
 *    정본 말투 자산이 없는 CI 에서도 같은 답이 나오도록 실제 자산을 읽지 않는다.
 */
import { readFileSync } from 'node:fs'

import { PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET } from '../src/lib/d100-capacity'
import { autogenCodeOf, RETIRED_AUTOGEN_CODES, type Cadence } from '../src/lib/persona-autogen'
import { PERSONA_CODE_MAX } from '../src/lib/persona-code'
import { COHORTS, PRODUCTION_PERSONA_CODES, RUNNABLE_COHORTS, TARGET_PERSONA_COUNT } from '../src/lib/persona-cohort'
import {
  activityConcentration, CODE_FORMAT_LIMITS, codeCeiling, codeLimitsToLift, codeOrderSafe, codeRoom,
  diversitySubjectOf, diversitySubjectOfCard, EXPANSION_STEPS, expansionStepOf, judgePopulationDiversity,
  planExpansionStep, PROPOSED_COHORTS, type DiversityRule, type DiversitySubject, type ExpansionResources,
} from '../src/lib/persona-expansion'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { judgeReferenceBundle, type VoiceReferenceBundle } from '../src/lib/persona-voice-reference'
import {
  judgeCandidateConflicts, judgeExpansionBatch, loadExpansionFixture, nameSpaceCapacity, nameSpaceUnion, parseExpansionFixture,
  type ConflictCode, type ExpansionCandidateFixture, type ExpansionFixture,
} from './lib/persona-expansion-gate.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}
const repoRoot = process.cwd()
const src = (p: string): string => readFileSync(p, 'utf-8')

console.log('\n══ Persona 확장 계약 fixture ══\n')

const pool = parsePoolDoc(src(PERSONA_POOL_DOC))
const FIXTURE = 'scripts/__fixtures__/persona-expansion-canary.json'
const promoted = COHORTS['wave6-d20-canary'].codes
const priorProductionCodes = PRODUCTION_PERSONA_CODES.filter((code) => !promoted.includes(code))
const priorCards = pool.cards.filter((c) => priorProductionCodes.includes(c.code))
const fxRead = loadExpansionFixture(repoRoot, FIXTURE)
if (!fxRead.ok) { console.log(`🔴 fixture 를 읽지 못했다: ${fxRead.problems.join(' / ')}`); process.exit(1) }
const fixture: ExpansionFixture = fxRead.fixture

// ─────────────────────────────────────────────────────────
console.log('① 정본 파생 · 운영 universe 격리')
// ─────────────────────────────────────────────────────────
check('단계 목표는 정본 표에서 온다 — d20 canary · d20 지속 · d100 지속',
  expansionStepOf('d20-canary')?.target === PERSONA_CANARY_FLOOR.d20
  && expansionStepOf('d20-sustained')?.target === PERSONA_SUSTAINED_TARGET.d20
  && expansionStepOf('d100-sustained')?.target === PERSONA_SUSTAINED_TARGET.d100)
check('정본 값 그대로 40 · 60 · 300', EXPANSION_STEPS.map((s) => s.target).join(',') === '40,60,300')
check('단계는 앞 단계를 선행으로 둔다', EXPANSION_STEPS.every((s, i) => s.requires === (i === 0 ? null : EXPANSION_STEPS[i - 1]!.id)))
check('🔴 운영 universe 는 40명이고 wave6 canary가 열린 회차다',
  PRODUCTION_PERSONA_CODES.length === 40 && TARGET_PERSONA_COUNT === 40
  && RUNNABLE_COHORTS.join() === 'wave6-d20-canary')
check('🔴 승격이 끝난 제안 cohort 목록은 비었다', PROPOSED_COHORTS.length === 0)
check('wave6 선행은 기존 다섯 cohort 전부다',
  COHORTS['wave6-d20-canary'].requires.slice().sort().join(',')
  === Object.keys(COHORTS).filter((id) => id !== 'wave6-d20-canary').sort().join(','))
check('canary 는 정확히 10명 = 40 − 30', promoted.length === PERSONA_CANARY_FLOOR.d20 - priorProductionCodes.length)
check('승격 코드는 P34~P43 append-only · 폐기 코드 재사용 0',
  promoted.every((c) => RETIRED_AUTOGEN_CODES[c] === undefined)
  && promoted.join(',') === Array.from({ length: 10 }, (_, i) => autogenCodeOf(34 + i)).join(','))
check('fixture 코드 = 승격 cohort 코드', fixture.candidates.map((c) => c.code).join(',') === promoted.join(','))
const promotedCards = new Map(pool.cards.filter((card) => promoted.includes(card.code)).map((card) => [card.code, card]))
check('🔴 wave6 카드 10장이 모두 정본 Pool에 있고 파싱 문제 0', promotedCards.size === 10 && pool.problems.length === 0)
for (const candidate of fixture.candidates) {
  const card = promotedCards.get(candidate.code)
  const life = candidate.life
  const creative = candidate.creative
  check(`🔴 ${candidate.code} 카드 = 승인 fixture 생활사·creative`, card !== undefined
    && card.title === creative.title
    && card.birthDate === life.birthDate
    && card.ageBand === life.ageBand
    && card.region === life.region
    && card.maritalStatus === life.maritalStatus
    && (card.spouseRelationship ?? '해당없음') === life.spouseRelationship
    && card.childrenCount === life.childrenCount
    && card.childrenAgeBands.join(',') === life.childrenAgeBands.join(',')
    && card.household.childrenLiving === life.childrenLiving
    && card.workStatus === life.workStatus
    && card.economicStatus === life.economicStatus
    && card.housing === life.housing
    && card.menopauseStatus === life.menopauseStatus
    && card.parentCare === life.parentCare
    && card.personality.join(',') === creative.personality.join(',')
    && card.noGoTopics.join(',') === creative.noGoTopics.join(',')
    && card.noGoExpressions.join(',') === creative.noGoExpressions.join(',')
    && card.variationCount === creative.variations.length
    && card.voiceLength !== null)
}

// ─────────────────────────────────────────────────────────
console.log('② 게시 상한을 Persona 수로 계산하지 않는다 · 쓰기 경로 0')
// ─────────────────────────────────────────────────────────
const sample = planExpansionStep(EXPANSION_STEPS[0]!, { contractValid: 30, voiceSpeakersFree: 10, namesFree: 10, codesFree: 10, codeCeiling: PERSONA_CODE_MAX })
check('🔴 단계 계획 반환에 글·게시·슬롯 칸이 없다', Object.keys(sample).every((k) => !/post|publish|slot|daily|perDay/i.test(k)), Object.keys(sample).join(','))
const libSrc = src('src/lib/persona-expansion.ts')
check('🔴 확장 lib 은 단계 게시 계획(publicPostsPerDay · publishSlotCount)을 읽지 않는다',
  !/publicPostsPerDay|publishSlotCount|d100Plan\(/.test(libSrc))
const writeRe = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRaw|\$transaction/
for (const f of ['scripts/persona-expansion.mts', 'scripts/lib/persona-expansion-facts.mts', 'scripts/lib/persona-expansion-gate.mts', 'src/lib/persona-expansion.ts']) {
  check(`🔴 ${f} — DB write · Raw SQL 0`, !writeRe.test(src(f)))
}
const cli = src('scripts/persona-expansion.mts')
check('🔴 CLI 는 --apply · --execute 를 거부한다', /a === '--apply' \|\| a\.startsWith\('--apply='\) \|\| a === '--execute'/.test(cli) && /fail\('이 도구는 켜지도 쓰지도 않는다/.test(cli))
check('CLI 는 LLM·provider 를 부르지 않는다', !/anthropic|openai|gemini|fetch\(|generateCreative/i.test(cli))
check('🔴 보충 말투 근거는 --db 없이는 회원 대조 전에 거부한다',
  cli.includes("if (USE_VOICE_EVIDENCE && !USE_DB) fail('--voice-evidence"))
check('보충 말투 근거는 익명 행만 append-only 말투 풀에 넘긴다',
  cli.includes('readUsableVoiceEvidence({')
  && cli.includes('voicePoolFor({ repoRoot, newCodes: batchCodes, supplementalRows })'))
check('🔴 승격 산출물은 ready 후보의 검증된 카드·seed만 JSON에 싣는다',
  cli.includes("cardMarkdown: c.status === 'ready' ? c.autogen.cardMarkdown : null")
  && cli.includes("seed: c.status === 'ready' ? c.autogen.seed : null"))

// ─────────────────────────────────────────────────────────
console.log('③ 코드 공간 — #712 숫자 코드 정본 통합')
// ─────────────────────────────────────────────────────────
check('옛 코드 형식 한계 목록은 비었다', CODE_FORMAT_LIMITS.length === 0)
check('코드 상한은 정본 P999', codeCeiling() === PERSONA_CODE_MAX && PERSONA_CODE_MAX === 999)
check('반례 — 숫자순이 아닌 P10,P100,P11을 잡는다', !codeOrderSafe(['P10', 'P100', 'P11']))
check('세 자리까지 숫자순이면 안전', codeOrderSafe(['P09', 'P10', 'P43', 'P99', 'P100']))
check('codeRoom — high-water 33(폐기 P33 포함) · P999 까지 966',
  JSON.stringify(codeRoom({ usedCodes: ['P01', 'P32'], retiredCodes: ['P31', 'P33'], ceiling: PERSONA_CODE_MAX })) === JSON.stringify({ highWater: 33, room: 966 }))
check('canary·지속60·지속300 모두 추가 코드 한계 해제 작업 0',
  [10, 30, 270].every((n) => codeLimitsToLift({ highWater: 33, newCodes: n }).length === 0))

// ─────────────────────────────────────────────────────────
console.log('④ 단계 자원 판정')
// ─────────────────────────────────────────────────────────
const R = (o: Partial<ExpansionResources>): ExpansionResources => ({
  contractValid: 30, voiceSpeakersFree: 10, namesFree: 10, codesFree: 10, codeCeiling: PERSONA_CODE_MAX, ...o,
})
const canary = EXPANSION_STEPS[0]!
const codesOf = (r: ExpansionResources, o: { assumedContractValid?: number } = {}): string =>
  planExpansionStep(canary, r, o).blocks.map((b) => b.code).join(',')
check('자원이 정확히 필요 수면 준비', planExpansionStep(canary, R({})).resourcesReady && planExpansionStep(canary, R({})).need === 10)
check('반례 — 말투 화자 9 → VOICE_SPEAKERS_SHORT 만', codesOf(R({ voiceSpeakersFree: 9 })) === 'VOICE_SPEAKERS_SHORT')
check('반례 — 이름 9 → NAME_SPACE_SHORT 만', codesOf(R({ namesFree: 9 })) === 'NAME_SPACE_SHORT')
check('반례 — 코드 9 → CODE_SPACE_SHORT 만', codesOf(R({ codesFree: 9 })) === 'CODE_SPACE_SHORT')
check('반례 — 말투 모름 → VOICE_SPEAKERS_UNKNOWN (0 으로 보지 않는다)', codesOf(R({ voiceSpeakersFree: null })) === 'VOICE_SPEAKERS_UNKNOWN')
check('반례 — 이름 모름 → NAME_SPACE_UNKNOWN', codesOf(R({ namesFree: null })) === 'NAME_SPACE_UNKNOWN')
const unk = planExpansionStep(canary, R({ contractValid: null }))
check('🔴 계약 유효 모름 → 필요 수 null · 준비 아님', unk.need === null && !unk.resourcesReady && codesOf(R({ contractValid: null })) === 'CONTRACT_VALID_UNKNOWN')
check('🔴 가정을 줘도 모름 차단은 남고, 모자람은 함께 보고한다',
  codesOf(R({ contractValid: null, voiceSpeakersFree: 2 }), { assumedContractValid: 30 }) === 'CONTRACT_VALID_UNKNOWN,VOICE_SPEAKERS_SHORT')
check('이미 목표를 넘었으면 필요 0 · 자원 0 이어도 준비', planExpansionStep(canary, R({ contractValid: 45, voiceSpeakersFree: 0, namesFree: 0, codesFree: 0 })).resourcesReady)

// ─────────────────────────────────────────────────────────
console.log('⑤ 집단 다양성 — 모두 다른데도 한쪽으로 쏠리는 것')
// ─────────────────────────────────────────────────────────
const existing = priorCards.map(diversitySubjectOfCard)
const batchOf = (f: ExpansionFixture): DiversitySubject[] => f.candidates.map((c) => diversitySubjectOf(c.code, c.life, c.creative, null))
const real = judgePopulationDiversity({ existing, batch: batchOf(fixture) })
check('canary fixture 는 30명 집단을 기울이지 않는다', real.ok, real.problems.map((p) => `${p.rule}: ${p.detail}`).join(' / '))
const rules = (batch: DiversitySubject[], ex: DiversitySubject[] = existing): DiversityRule[] =>
  [...new Set(judgePopulationDiversity({ existing: ex, batch }).problems.map((p) => p.rule))]
const base = batchOf(fixture)
const mut = (f: (s: DiversitySubject, i: number) => Partial<DiversitySubject>): DiversitySubject[] => base.map((s, i) => ({ ...s, ...f(s, i) }))

check('반례 — 10명 전원 같은 자녀 구성 → BATCH_MONOCULTURE',
  rules(mut(() => ({ childrenCount: 2, childrenAgeBands: ['중고등', '초등'] }))).includes('BATCH_MONOCULTURE'))
check('반례 — 10명 전원 40대 → CORE_DECADE_NOT_PLURALITY',
  rules(mut((s, i) => ({ ageBand: i % 2 === 0 ? '40대 중반' : '40대 후반', code: s.code }))).includes('CORE_DECADE_NOT_PLURALITY'))
check('반례 — 10명 전원 같은 성격어 → PERSONALITY_TERM_OVERUSED',
  rules(mut((s) => ({ personality: [...s.personality.slice(0, 2), '정 많음'] }))).includes('PERSONALITY_TERM_OVERUSED'))
check('반례 — 돌봄 없음 10명 → POPULATION_AXIS_DOMINANT (57% → 68%)',
  rules(mut(() => ({ parentCare: '없음' }))).includes('POPULATION_AXIS_DOMINANT'))
const twin = existing.find((s) => s.code === 'P05')!
check('반례 — 기존 카드와 생활사 7칸이 같다 → LIFE_KEY_DUPLICATE',
  rules([...base.slice(1), { ...twin, code: 'P34', personality: ['새 성격'] }]).includes('LIFE_KEY_DUPLICATE'))
// 🔴 "나빠지지 않으면 통과" — 이미 넘은 축을 묶음이 낮추면 막지 않는다
const allMarried = existing.slice(0, 10).map((s) => ({ ...s, maritalStatus: '기혼' }))
check('기존이 이미 넘은 축을 낮추는 묶음은 막지 않는다 (기혼 100% + 비기혼 묶음)',
  !rules(base.map((s) => ({ ...s, maritalStatus: '사별' })).slice(0, 4), allMarried).includes('POPULATION_AXIS_DOMINANT'))
check('작은 묶음(4명)은 단일 품종 판정을 하지 않는다',
  !rules(mut(() => ({ housing: '월세' })).slice(0, 4)).includes('BATCH_MONOCULTURE'))

// ─────────────────────────────────────────────────────────
console.log('⑥ 충돌 — 닉네임 · 연령 · 관심사 · 게시판 · 금칙')
// ─────────────────────────────────────────────────────────
const p34 = fixture.candidates.find((c) => c.code === 'P34')!
const batchNames = new Map(fixture.candidates.map((c) => [c.code, c.displayName]))
const EMPTY_SETS = { memberNames: [] as string[], personaNames: [] as string[] }
const conf = (c: ExpansionCandidateFixture, o: { nameSets?: typeof EMPTY_SETS | null; names?: Map<string, string> } = {}): ConflictCode[] =>
  [...new Set(judgeCandidateConflicts(c, { nameSets: o.nameSets === undefined ? EMPTY_SETS : o.nameSets, batchNames: o.names ?? batchNames }).map((x) => x.code))]
const edit = (o: Partial<ExpansionCandidateFixture> & { lifePatch?: Partial<ExpansionCandidateFixture['life']>; creativePatch?: Partial<ExpansionCandidateFixture['creative']> }): ExpansionCandidateFixture => ({
  ...p34, ...o, life: { ...p34.life, ...(o.lifePatch ?? {}) }, creative: { ...p34.creative, ...(o.creativePatch ?? {}) },
})
const only = (got: ConflictCode[], want: ConflictCode): boolean => got.length === 1 && got[0] === want
for (const c of fixture.candidates) check(`fixture ${c.code} 충돌 0 (대조 집합 빈 값)`, conf(c).length === 0, conf(c).join(','))
check('반례 — 대조 집합이 없으면 NAME_MEMBERS_UNMEASURED 만 (통과 아님)', only(conf(p34, { nameSets: null }), 'NAME_MEMBERS_UNMEASURED'))
check('반례 — 표시명에 지역명 → NAME_POLICY 만', only(conf(edit({ displayName: '부산꽃' })), 'NAME_POLICY'))
check('반례 — 기존 Persona 이름과 같다 → NAME_COLLISION 만', only(conf(p34, { nameSets: { memberNames: [], personaNames: ['노을'] } }), 'NAME_COLLISION'))
check('반례 — 회원 이름과 같다 → NAME_COLLISION 만', only(conf(p34, { nameSets: { memberNames: ['노을'], personaNames: [] } }), 'NAME_COLLISION'))
check('반례 — 묶음 안 같은 이름 → NAME_BATCH_CONFUSABLE 만',
  only(conf(p34, { names: new Map([...batchNames, ['P35', '노을']]) }), 'NAME_BATCH_CONFUSABLE'))
check('반례 — 대상 밖 연령대 → AGE_OUT_OF_AUDIENCE 포함',
  conf(edit({ lifePatch: { ageBand: '30대 후반' } })).includes('AGE_OUT_OF_AUDIENCE'))
check('반례 — 생일이 나이대와 어긋난다 → AGE_LIFE_CONFLICT 만', only(conf(edit({ lifePatch: { birthDate: '1990-01-01' } })), 'AGE_LIFE_CONFLICT'))
check('반례 — 관심사 1개 → INTEREST_COUNT 만', only(conf(edit({ interests: ['등산'] })), 'INTEREST_COUNT'))
check('반례 — 관심사가 자기 noGo 를 품는다 → INTEREST_NOGO_CONFLICT 만',
  only(conf(edit({ interests: ['연봉 액수 비교', '갱년기 열감'] })), 'INTEREST_NOGO_CONFLICT'))
check('반례 — 성인 자녀 없이 손주 → INTEREST_LIFE_CONFLICT 만', only(conf(edit({ interests: ['손주 돌보기', '갱년기 열감'] })), 'INTEREST_LIFE_CONFLICT'))
check('반례 — 자영업 아닌데 가게 → INTEREST_LIFE_CONFLICT 만', only(conf(edit({ interests: ['가게 운영', '갱년기 열감'] })), 'INTEREST_LIFE_CONFLICT'))
check('반례 — 게시판 없음 → BOARD_EMPTY 만', only(conf(edit({ boards: [] })), 'BOARD_EMPTY'))
check('🔴 반례 — 매거진은 게시판이 아니다 → BOARD_NOT_A_BOARD 만', only(conf(edit({ boards: ['FREE', 'MAGAZINE'] })), 'BOARD_NOT_A_BOARD'))
check('반례 — 모르는 게시판 → BOARD_UNKNOWN 만', only(conf(edit({ boards: ['QNA'] })), 'BOARD_UNKNOWN'))
check('🔴 반례 — 관심사에 브랜드 금지어 → BRAND_BANNED_WORD 만', only(conf(edit({ interests: ['실버 요가', '갱년기 열감'] })), 'BRAND_BANNED_WORD'))
check('반례 — 변주에 공통 금지 문구 → COMMON_NOGO_IN_VARIATION 만',
  only(conf(edit({ creativePatch: { variations: [...p34.creative.variations.slice(0, 4), '추천드립니다 로 맺기'] } })), 'COMMON_NOGO_IN_VARIATION'))

// ─────────────────────────────────────────────────────────
console.log('⑦ fixture 파서 — 칸을 기본값으로 메우지 않는다')
// ─────────────────────────────────────────────────────────
const raw = src(FIXTURE)
check('정본 fixture 는 읽힌다', parseExpansionFixture(raw).ok)
const broken = JSON.parse(raw) as { candidates: Record<string, unknown>[] }
delete broken.candidates[0]!.interests
check('반례 — interests 가 빠지면 거부', !parseExpansionFixture(JSON.stringify(broken)).ok)
const dup = JSON.parse(raw) as { candidates: Record<string, unknown>[] }
dup.candidates[1]!.code = dup.candidates[0]!.code
check('반례 — 중복 코드 거부', !parseExpansionFixture(JSON.stringify(dup)).ok)
const badBand = JSON.parse(raw) as { candidates: { life: { childrenAgeBands: string[] } }[] }
badBand.candidates[0]!.life.childrenAgeBands = ['고딩']
check('반례 — 모르는 자녀 나이대 거부', !parseExpansionFixture(JSON.stringify(badBand)).ok)

// ─────────────────────────────────────────────────────────
console.log('⑧ 묶음 판정 — 운영 검증기 + 충돌 + 품질 + 다양성 (합성 말투)')
// ─────────────────────────────────────────────────────────
const bundleOf = (code: string, texts: string[]): VoiceReferenceBundle => {
  const v = judgeReferenceBundle({ personaCode: code, texts, anchorCount: texts.length })
  if (!v.ok) throw new Error(`fixture 묶음이 서지 않는다: ${v.blocks.map((b) => b.code).join(',')}`)
  return v.bundle
}
const TEXTS = ['그 마음 알 것 같아요', '저도 요즘 그래요', '천천히 하셔도 돼요', '날이 많이 추워졌네요']
// 🔴 후보 말투는 길이 밴드를 섞는다 — 열 명이 같은 밴드면 묶음 다양성이 문체 단일 품종으로 막는다(그게 맞다)
const MID = ['요즘 저녁마다 산책을 나가는데 바람이 제법 차가워져서 겉옷을 하나 더 챙기게 되네요 다들 감기 조심하세요',
  '저도 비슷한 일을 겪었는데 처음에는 당황했지만 시간이 지나니 조금씩 괜찮아지더라고요 너무 걱정 마세요',
  '오늘 시장에 갔더니 채소 값이 많이 올라서 놀랐어요 그래도 제철 나물은 싸고 맛있어서 몇 가지 사 왔어요',
  '아침에 일어나면 몸이 무겁고 땀이 나서 힘든데 그래도 따뜻한 차 한 잔 마시면 조금 나아지는 것 같아요']
const LONG = MID.map((t) => `${t} 그리고 주말에는 오랜만에 친구들을 만나서 이런저런 이야기를 나누다 보니 마음이 한결 가벼워졌어요 역시 사람 사는 이야기가 제일 위로가 되네요`)
// 🔴 운영 묶음 둘이 같은 문체면 분리 기준이 0 이다 — 그러면 VOICE_TOO_CLOSE 는 절대 나오지 않는다(아래 ⑨ 참고)
const prodBundles = [bundleOf('P01', TEXTS), bundleOf('P02', TEXTS)]
const CADENCE: Cadence = { dailyCap: 3, weeklyCap: 12, silenceRate: 0.3, activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 } }
const voiceFor = (codes: readonly string[]): Map<string, { bundle: VoiceReferenceBundle; seedShareCount: number | null }> =>
  new Map(codes.map((c, i) => [c, { bundle: bundleOf(c, [TEXTS, MID, LONG][i % 3]!), seedShareCount: 1 }]))
const judge = (o: { voice?: readonly string[]; cadence?: Cadence | null; nameSets?: typeof EMPTY_SETS | null } = {}) => judgeExpansionBatch({
  fixture, existingCards: priorCards, productionCodes: priorProductionCodes, takenCodes: new Set(priorCards.map((c) => c.code)),
  voiceByCode: voiceFor(o.voice ?? promoted), productionBundles: prodBundles,
  cadence: o.cadence === undefined ? CADENCE : o.cadence, nameSets: o.nameSets === undefined ? EMPTY_SETS : o.nameSets,
})
const full = judge()
check('말투 · cadence · 대조 집합이 모두 있으면 10/10 ready · 묶음 OK', full.ok && full.candidates.every((c) => c.status === 'ready'),
  full.candidates.filter((c) => c.status !== 'ready').map((c) => `${c.code}:${c.reasons.join('+')}`).join(' '))
const two = judge({ voice: ['P34', 'P35'] })
check('🔴 실제와 같은 말투 2명 → 2 ready · 8 blocked(NO_VOICE_EVIDENCE) · 묶음 서지 않음',
  !two.ok && two.candidates.filter((c) => c.status === 'ready').map((c) => c.code).join(',') === 'P34,P35'
  && two.candidates.filter((c) => c.status === 'blocked').every((c) => c.reasons.includes('NO_VOICE_EVIDENCE')))
const noSets = judge({ nameSets: null })
check('🔴 대조 집합이 없으면 ready 가 아니라 unmeasured (blocked 와 섞지 않는다)',
  noSets.candidates.every((c) => c.status === 'unmeasured') && !noSets.ok)
const noCad = judge({ cadence: null })
check('cadence 모름 → unmeasured (CADENCE_UNMEASURED)', noCad.candidates.every((c) => c.status === 'unmeasured' && c.reasons.includes('CADENCE_UNMEASURED')))

// ─────────────────────────────────────────────────────────
const sameVoice = judgeExpansionBatch({
  fixture, existingCards: priorCards, productionCodes: priorProductionCodes, takenCodes: new Set(priorCards.map((c) => c.code)),
  voiceByCode: new Map(promoted.map((c) => [c, { bundle: bundleOf(c, TEXTS), seedShareCount: 1 }])), productionBundles: prodBundles,
  cadence: CADENCE, nameSets: EMPTY_SETS,
})
check('🔴 반례 — 열 명이 같은 길이 밴드 말투 → 묶음 다양성 BATCH_MONOCULTURE(voiceBand)',
  !sameVoice.ok && sameVoice.diversity.problems.some((p) => p.rule === 'BATCH_MONOCULTURE' && p.detail.includes('voiceBand')))
const autogenSrc = src('scripts/lib/persona-autogen.mts')
check('🔴 autogen 계약 사유 줄 형식이 "모름" 분류와 맞는다',
  autogenSrc.includes('add(CODE_OF_AXIS[axis], `계약 ${axis}: ${d}`)') && autogenSrc.includes('add(CODE_OF_AXIS[axis], `계약 ${axis} 모름: ${d}`)'))

console.log('⑨ 규모가 커질 때 약해지는 곳 — 현재 사실')
// ─────────────────────────────────────────────────────────
const union = nameSpaceUnion()
const cap0 = nameSpaceCapacity({ takenNames: [], memberNames: null, space: union })
check(`이름 공간 합집합 ${union.length} 중 서로 헷갈리지 않는 이름 ${cap0.free} — 기존 40명 뒤 260명을 받을 수 있다 (회원 0 가정)`,
  cap0.free >= PERSONA_SUSTAINED_TARGET.d100 - PRODUCTION_PERSONA_CODES.length && cap0.bound === 'upper')
const tiny = nameSpaceCapacity({ takenNames: [], memberNames: [], space: ['노을', '밤수국', '봄수국'] })
check('반례 — 편집 거리 1 인 세 글자 이름은 하나만 남는다 · 회원 집합을 받으면 exact', tiny.free === 2 && tiny.bound === 'exact', tiny.picked.join(','))
check('🔴 반례 — 회원 이름과 같은 후보는 공간에서 빠진다 (exact 1)',
  nameSpaceCapacity({ takenNames: [], memberNames: ['노을'], space: ['노을', '모과'] }).free === 1)
check('이름 상한은 회원 이름이 더 막을 수 있다(upper ≥ exact)',
  nameSpaceCapacity({ takenNames: [], memberNames: ['노을'], space: ['노을', '모과'] }).free
  <= nameSpaceCapacity({ takenNames: [], memberNames: null, space: ['노을', '모과'] }).free)

// ─────────────────────────────────────────────────────────
console.log('⑩ 활동 집중도')
// ─────────────────────────────────────────────────────────
const even = activityConcentration(Array.from({ length: 30 }, (_, i) => ({ code: `P${i}`, posts: 1, comments: 1 })))
check('고르게 쓰이면 유효 인원 30 · Gini 0', Math.abs(even.effectivePersonas - 30) < 1e-9 && Math.abs(even.gini) < 1e-9)
const mono = activityConcentration([{ code: 'P01', posts: 10, comments: 0 }, ...Array.from({ length: 9 }, (_, i) => ({ code: `P1${i}`, posts: 0, comments: 0 }))])
check('한 명 독점 → 유효 인원 1 · 1위 점유 100% · 0건 9명', mono.effectivePersonas === 1 && mono.top1?.share === 1 && mono.idle.length === 9)
const none = activityConcentration([{ code: 'P01', posts: 0, comments: 0 }])
check('🔴 활동 0 건이면 점유를 계산하지 않는다 (1위 null)', none.top1 === null && none.events === 0)

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
