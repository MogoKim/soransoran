#!/usr/bin/env tsx
/**
 * Persona 자동 확장 fixture — 🔴 **DB 0 · 네트워크 0 · LLM 0 · 파일 write 0** (2026-09-29, Track C)
 *
 * 🔴 **fixture 가 실제보다 강하면 안 된다.** 말투 근거는 실제 코퍼스가 아니라 합성 댓글이지만,
 *    판정은 운영 검증기(`parsePoolDoc` · `verifySeedCard` · `personaTiers` · `judgeRealMember` ·
 *    `hardFilter` · `judgePlannerPersona` · `referenceSeedShareCount`)를 **그대로** 통과한다.
 *    반례는 한 칸씩만 비틀어, 정확히 그 칸의 코드가 나오는지 본다(다른 이유로 막혀 우연히 통과하지 않게).
 */
import { readFileSync } from 'node:fs'

import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { verifySeedCard } from '../src/lib/persona-card-verify'
import { readLengthBand } from '../src/lib/original-post-persona-match'
import { judgeReferenceBundle, type VoiceReferenceBundle } from '../src/lib/persona-voice-reference'
import {
  AUTOGEN_CODE_FIRST, autogenCodeOf, lifeProblems, proposeLifeSkeletons, subjectOfCard, subjectOfLife,
  thinLifeAxisCount, voiceCoreFromBundle, isNameOnly,
  type AutogenBlockCode, type AutogenCandidate, type Cadence, type LifeSkeleton, type PersonaCreative,
} from '../src/lib/persona-autogen'
import { assignmentDrift, judgeAutogenCandidate } from './lib/persona-autogen.mjs'
import { judgeApplyBatch } from './lib/persona-autogen-apply.mjs'
import { referenceSeedShareCount } from './lib/persona-reference-store.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'
import { runPersonaReserveChecks } from './persona-reserve-check.mjs'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

console.log('\n══ Persona 자동 확장 fixture ══\n')

// ── 합성 재료 ──
const bundleOf = (code: string, texts: string[]): VoiceReferenceBundle => {
  const v = judgeReferenceBundle({ personaCode: code, texts, anchorCount: texts.length })
  if (!v.ok) throw new Error(`fixture 묶음이 서지 않는다: ${v.blocks.map((b) => b.code).join(',')}`)
  return v.bundle
}
const TEXTS_A = ['그 마음 알 것 같아요', '저도 요즘 그래요', '천천히 하셔도 돼요', '날이 많이 추워졌네요']
const TEXTS_B = ['아이고 고생 많았네', '그거 참 어렵지', '밥은 챙겨 먹고', '오늘은 푹 쉬어']
const LIFE: LifeSkeleton = {
  ageBand: '50대 초반', birthDate: '1973-03-08', region: '광역시', maritalStatus: '이혼',
  spouseRelationship: '해당없음', childrenCount: 1, childrenAgeBands: ['대학·취준'], childrenLiving: '동거',
  workStatus: '파트타임', economicStatus: '빠듯', housing: '월세', menopauseStatus: '진행중', parentCare: '간헐',
}
const CREATIVE: PersonaCreative = {
  title: '혼자 대학생 아이 뒷바라지하며',
  personality: ['담담함', '말 짧음', '남 얘기 잘 들음'],
  noGoTopics: ['이혼 권유', '금액 언급'],
  noGoExpressions: ['"그래도 ~하니 다행" 류'],
  variations: ['짧게 툭', '담백한 경험', '되묻기', '무호칭', '한 줄'],
}
const CADENCE: Cadence = {
  dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
  activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 },
}
const code = autogenCodeOf(AUTOGEN_CODE_FIRST)
const bA = bundleOf(code, TEXTS_A)
const base: AutogenCandidate = {
  code, life: LIFE, creative: CREATIVE,
  voice: { bundle: bA, seedShareCount: 1 },
  cadence: CADENCE,
  binding: { accountCount: 0, providerId: null },
  displayName: { name: '해솔', gate: 'pass' },
}
const taken = new Set(['P01', 'P05', 'P25'])
const judge = (c: AutogenCandidate) => judgeAutogenCandidate(c, { takenCodes: taken })
const has = (c: AutogenCandidate, b: AutogenBlockCode): boolean => judge(c).blocks.includes(b)

// ── ① 온전한 후보 — 운영 검증기 전부 통과 ──
console.log('① 온전한 후보')
{
  const v = judge(base)
  check('valid 이다', v.status === 'valid')
  check('격리 사유 0', v.blocks.length === 0)
  check('글 자격 · 댓글 자격 둘 다 참', v.postEligible && v.commentEligible)
  check('렌더된 카드를 정본 파서가 다시 읽는다', v.cardMarkdown !== null && parsePoolDoc(v.cardMarkdown).cards.length === 1)
  check('seed 가 운영 verifySeedCard 를 통과한다', v.seed !== null && v.card !== null && verifySeedCard(code, v.seed, v.card).length === 0)
  check('lifeStage 가 운영 어휘다 (자녀 독립 준비)', v.seed?.lifeStage === '자녀 독립 준비')
}

// ── ② 반례 — 한 칸씩 비튼다 ──
console.log('② 반례')
check('축 누락 — 생활사 골격 없음 → LIFE_AXIS_MISSING · quarantined',
  has({ ...base, life: null }, 'LIFE_AXIS_MISSING') && judge({ ...base, life: null }).status === 'quarantined')
check('축 누락 — noGo 표현 비움 → LIFE_AXIS_MISSING',
  has({ ...base, creative: { ...CREATIVE, noGoExpressions: [] } }, 'LIFE_AXIS_MISSING'))
check('축 누락 — 성격 비움 → LIFE_AXIS_MISSING',
  has({ ...base, creative: { ...CREATIVE, personality: [] } }, 'LIFE_AXIS_MISSING'))
check('말투 근거 없음 → NO_VOICE_EVIDENCE · quarantined',
  has({ ...base, voice: null }, 'NO_VOICE_EVIDENCE') && judge({ ...base, voice: null }).status === 'quarantined')
check('말투 근거 없음 → 글·댓글 자격 둘 다 거짓',
  !judge({ ...base, voice: null }).postEligible && !judge({ ...base, voice: null }).commentEligible)
{
  // 🔴 중복 화자 — 운영 `referenceSeedShareCount` 가 실제로 2 를 낸다
  const other = bundleOf('P01', TEXTS_A)
  const mine = bundleOf(code, TEXTS_A)
  const share = referenceSeedShareCount(new Map([['P01', other], [code, mine]]), code)
  check('운영 referenceSeedShareCount 가 같은 화자 묶음을 2 로 센다', share === 2)
  check('중복 화자 묶음 → VOICE_SPEAKER_DUPLICATE · quarantined',
    has({ ...base, voice: { bundle: mine, seedShareCount: share } }, 'VOICE_SPEAKER_DUPLICATE')
    && judge({ ...base, voice: { bundle: mine, seedShareCount: share } }).status === 'quarantined')
  const alone = referenceSeedShareCount(new Map([['P01', bundleOf('P01', TEXTS_B)], [code, mine]]), code)
  check('다른 화자면 1 — 막지 않는다', alone === 1 && !has({ ...base, voice: { bundle: mine, seedShareCount: alone } }, 'VOICE_SPEAKER_DUPLICATE'))
  check('공유 수를 못 셌으면(null) 막는다', has({ ...base, voice: { bundle: mine, seedShareCount: null } }, 'VOICE_SPEAKER_DUPLICATE'))
}
{
  const thin = { ...bA, comments: bA.comments.slice(0, 2) }
  check('말투 근거 2건 → VOICE_EVIDENCE_THIN', has({ ...base, voice: { bundle: thin, seedShareCount: 1 } }, 'VOICE_EVIDENCE_THIN'))
}
check('실회원 충돌 — 계정 붙은 User → REAL_MEMBER_COLLISION',
  has({ ...base, binding: { accountCount: 1, providerId: null } }, 'REAL_MEMBER_COLLISION'))
check('실회원 충돌 — providerId 있음 → REAL_MEMBER_COLLISION',
  has({ ...base, binding: { accountCount: 0, providerId: 'kakao-1' } }, 'REAL_MEMBER_COLLISION'))
check('실회원 충돌 — 표시명 Gate ⑥-B reject → REAL_MEMBER_COLLISION',
  has({ ...base, displayName: { name: '해솔', gate: 'reject' } }, 'REAL_MEMBER_COLLISION'))
check('실회원 미측정 — 계정 수 null → REAL_MEMBER_UNMEASURED',
  has({ ...base, binding: { accountCount: null, providerId: null } }, 'REAL_MEMBER_UNMEASURED'))
check('실회원 미측정 — 표시명 판정 없음 → REAL_MEMBER_UNMEASURED',
  has({ ...base, displayName: null }, 'REAL_MEMBER_UNMEASURED'))
{
  const nameOnly: AutogenCandidate = { ...base, life: null, voice: null, creative: null }
  check('이름만 있는 후보 → rejected · NAME_ONLY', judge(nameOnly).status === 'rejected' && has(nameOnly, 'NAME_ONLY'))
  check('이름만 있는 후보는 계획용 카드·seed 가 없다', judge(nameOnly).cardMarkdown === null && judge(nameOnly).seed === null)
  check('제목만 채운 creative 도 이름만이다',
    isNameOnly({ ...nameOnly, creative: { ...CREATIVE, personality: [], noGoTopics: [], noGoExpressions: [] } }))
}
check('creative 없음 → LLM_STEP_UNIMPLEMENTED (기본값으로 채우지 않는다)',
  has({ ...base, creative: null }, 'LLM_STEP_UNIMPLEMENTED') && judge({ ...base, creative: null }).seed === null)
check('cadence 모름 → CADENCE_UNMEASURED', has({ ...base, cadence: null }, 'CADENCE_UNMEASURED'))
check('운영 코드와 겹침 → CODE_TAKEN', has({ ...base, code: 'P25' }, 'CODE_TAKEN'))
check('자동 범위 밖 코드 → CODE_INVALID', has({ ...base, code: 'P05' }, 'CODE_INVALID') && has({ ...base, code: 'P51' }, 'CODE_INVALID'))
check('생활사 모순 — 60대 초반 갱년기 전 → LIFE_INCONSISTENT',
  has({ ...base, life: { ...LIFE, ageBand: '60대 초반', birthDate: '1963-03-08', menopauseStatus: '전' } }, 'LIFE_INCONSISTENT'))
check('생활사 모순 — 생일이 나이대 밖 → LIFE_INCONSISTENT',
  has({ ...base, life: { ...LIFE, birthDate: '1960-03-08' } }, 'LIFE_INCONSISTENT'))

// ── ③ 생활사 골격 — 결정론 · 모순 0 · 정본과 겹치지 않음 ──
console.log('③ 생활사 골격')
{
  const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
  const codes = [26, 27, 28, 29, 30, 31].map(autogenCodeOf)
  const a = proposeLifeSkeletons({ existing: pool.cards, codes })
  const b = proposeLifeSkeletons({ existing: pool.cards, codes })
  check('요청한 코드 수만큼 만든다', a.length === codes.length && a.every((x, i) => x.code === codes[i]))
  check('두 번 돌려도 같다(결정론)', JSON.stringify(a) === JSON.stringify(b))
  check('전원 lifeProblems 0 (운영 checkLifeConsistency 포함)', a.every((x) => lifeProblems(x.life).length === 0))
  const key = (l: { ageBand: string; maritalStatus: string; childrenAgeBands: readonly string[]; workStatus: string; economicStatus: string; housing: string; parentCare: string }): string =>
    [l.ageBand, l.maritalStatus, l.childrenAgeBands.join('/'), l.workStatus, l.economicStatus, l.housing, l.parentCare].join('|')
  const cardKeys = new Set(pool.cards.map(key))
  check('정본 카드와 같은 조합이 없다', a.every((x) => !cardKeys.has(key(x.life))))
  check('골격끼리 같은 조합이 없다', new Set(a.map((x) => key(x.life))).size === a.length)
  check('얇은 생활사 축이 늘지 않는다',
    thinLifeAxisCount([...pool.cards.map(subjectOfCard), ...a.map((x) => subjectOfLife(x.code, x.life))])
      <= thinLifeAxisCount(pool.cards.map(subjectOfCard)))
  check('골격만으로는 valid 가 되지 않는다(말투·creative 없음)',
    a.every((x) => judge({ ...base, code: x.code, life: x.life, voice: null, creative: null }).status === 'quarantined'))
}

// ── ④ 말투 칸 — 관찰값이 매칭 정본으로 읽힌다 ──
console.log('④ 말투 칸')
{
  const vc = voiceCoreFromBundle(bA)
  check('길이 토큰을 readLengthBand 가 읽는다', readLengthBand(vc.length) !== null)
  check('요 비율이 높으면 존댓말', vc.register === '존댓말')
  check('요 비율이 낮으면 구어체', voiceCoreFromBundle(bundleOf(code, TEXTS_B)).register === '구어체')
}

// ── ④-2 운영 말투 배정 불변 ──
console.log('④-2 운영 말투 배정 불변')
{
  const a = bundleOf('P01', TEXTS_A)
  const b = bundleOf('P02', TEXTS_B)
  check('같은 배정이면 drift 0', assignmentDrift(new Map([['P01', a], ['P02', b]]), new Map([['P01', a], ['P02', b]]), ['P01', 'P02']).length === 0)
  check('운영 코드의 묶음이 바뀌면 drift 로 잡는다',
    assignmentDrift(new Map([['P01', a], ['P02', b]]), new Map([['P01', b], ['P02', a]]), ['P01', 'P02']).join(',') === 'P01,P02')
  check('운영 코드가 묶음을 잃어도 drift 다', assignmentDrift(new Map([['P01', a]]), new Map(), ['P01']).length === 1)
}

// ── ⑤ 적재 배치 게이트 — DB 를 열기 전에 막는다 ──
console.log('⑤ 적재 배치 게이트')
{
  const ok = { code, status: 'valid' as const, name: '해솔', seed: {} }
  check('빈 배치는 막는다', judgeApplyBatch([], 0).length > 0)
  check('quarantined 가 섞이면 막는다', judgeApplyBatch([ok, { ...ok, code: 'P27', name: '다온', status: 'quarantined' }], 2).length > 0)
  check('--limit 불일치는 막는다', judgeApplyBatch([ok], 2).length > 0 && judgeApplyBatch([ok], null).length > 0)
  check('같은 코드 두 번은 막는다', judgeApplyBatch([ok, { ...ok, name: '다온' }], 2).length > 0)
  check('온전한 배치는 통과한다', judgeApplyBatch([ok], 1).length === 0)
}

// ── ⑥ 연결 — CLI 가 이 판정·적재를 실제로 부른다 ──
console.log('⑥ CLI 연결')
{
  const cli = readFileSync('scripts/persona-autogen.mts', 'utf-8')
  // 🔴 한 명씩(judgeAutogenCandidate) + 겹침·문체 거리를 배치로 본다(2026-09-30)
  check('CLI 가 judgeAutogenBatch 로 판정한다', /judgeAutogenBatch\(cands, \{ takenCodes: taken,/.test(cli))
  check('CLI 가 운영 규칙 말투 풀(voicePoolFor)을 쓴다', /voicePoolFor\(\{ repoRoot: process\.cwd\(\), newCodes: codes \}\)/.test(cli))
  const gate = cli.indexOf('if (!APPLY) {')
  const call = cli.indexOf('await applyAutogenDrafts(')
  check('적재는 --apply 게이트 뒤에서만 부른다', gate > 0 && call > gate)
  check('적재 대상은 valid 만이다', /const plans = valid\.map\(/.test(cli))
  check('CLI 는 LLM·provider 를 부르지 않는다', !/anthropic|openai|gemini|fetch\(/i.test(cli))
}

// ── ⑦ 4상태 판정 — 🔴 CI 가 이 스크립트로 함께 돈다(`scripts/persona-reserve-check.mts`) ──
console.log('⑦ Persona 4상태 판정')
await runPersonaReserveChecks(check)

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
