#!/usr/bin/env tsx
/**
 * Persona 확장 planner fixture — 🔴 **DB 0 · 네트워크 0 · LLM 0 · 파일 write 0**
 *
 * 🔴 **실제 결과와 synthetic 을 분리한다.**
 *    🔴 **실제 조합은 운영 데이터에 따라 변한다** — 큐 재고·발행 이력·활성 persona 가
 *    바뀌면 답도 바뀐다. 특정 코드를 여기 적으면 그날부터 CI 가 매일 깨지고,
 *    더 나쁘게는 사람이 그 코드를 확정된 결론으로 읽는다.
 *    그것을 fixture 에 박으면 CI 가 매일 깨진다. 그래서 여기서는 **규칙**만 고정한다 —
 *    카드를 정확히 읽는가 · 조합을 빠짐없이 보는가 · 순위가 결정적인가 · 얇은 축을 자동으로 찾는가.
 *    실제 수치는 `persona-capacity-planner` 를 사람이 돌려 본다.
 */
import { readFileSync } from 'node:fs'

import {
  parseCard, parsePoolDoc, readChildren, readMarital, cardToPersona, isKnownChildBand,
  type PoolCard,
} from '../src/lib/persona-pool-card'
import { readLengthBand } from '../src/lib/original-post-persona-match'
import {
  planBatch, POST_CAP_PER_WEEK, type BatchDraft, type PersonaForMatch,
} from '../src/lib/original-post-persona-match'
import { duplicateKeys, isPoolCode, verifySeedCard } from '../src/lib/persona-card-verify'
import type { QueueCandidate } from '../src/lib/supply-candidates'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

console.log('\n══ Persona 확장 planner fixture ══\n')

// ── ① 카드 파싱 — synthetic ──
console.log('① 카드 파싱')
{
  const body = `
ageBand 50대 초반 · 수도권 · 기혼(원만) · 자녀 2(중고생·초등, 동거) · 자녀관계 가까움
birthDate 1974-05-05   · 🔴 내부 값이다. 글에 쓰지 않는다 — 계산된 나이만 쓴다
파트타임 · 빠듯 · 전세 · 갱년기 진행중 · 간병 간헐
성격    부지런함 · 현실적
voiceCore  짧은 문장 · "~해요" 기본 · 이모티콘 거의 없음
variation  ① 한 줄 ② 두 줄 ③ 질문형 ④ 맞장구 ⑤ 경험 ⑥ 본론
금지 advice(의료·재무) · caution
noGo 남의 형편 비교
`
  const { card, problems } = parseCard('P99', '시험용', body)
  check('문제 없이 읽는다', problems.length === 0 && card !== null)
  check('혼인 상태와 관계를 나눠 읽는다', card?.maritalStatus === '기혼' && card?.spouseRelationship === '원만')
  check('자녀 수와 나이대를 읽는다', card?.childrenCount === 2
    && card?.childrenAgeBands.join(',') === '중고등,초등')
  check('🔴 나이대가 매칭이 아는 밴드다', (card?.childrenAgeBands ?? []).every(isKnownChildBand))
  check('갱년기·간병을 읽는다', card?.menopauseStatus === '진행중' && card?.parentCare === '간헐')
  check('생활 축을 읽는다', card?.workStatus === '파트타임' && card?.economicStatus === '빠듯' && card?.housing === '전세')
  check('길이 표현을 읽는다', card?.voiceLength === '짧은 문장')
  check('variation 개수를 센다', card?.variationCount === 6)
  check('성격을 읽는다', card?.personality.join(',') === '부지런함,현실적')

  // 🔴 길이 토큰이 첫 번째가 아니어도 찾는다 (P11 이 `구어체 · 길게` 다)
  const later = parseCard('P98', 'x', body.replace('voiceCore  짧은 문장 ·', 'voiceCore  구어체 · 길게 ·')).card
  check('🔴 길이 토큰이 앞이 아니어도 찾는다', later?.voiceLength === '길게')

  // 🔴 못 읽으면 null 이다 — 기본값을 몰래 넣지 않는다
  const unknown = parseCard('P97', 'x', body.replace('voiceCore  짧은 문장 ·', 'voiceCore  또박또박 ·')).card
  check('🔴 길이를 모르면 null 이다 — 기본값을 넣지 않는다', unknown !== null && unknown.voiceLength === null)

  // 🔴 자녀 수와 나이대가 어긋나면 카드를 버린다
  const mismatch = parseCard('P96', 'x', body.replace('자녀 2(중고생·초등, 동거)', '자녀 2'))
  check('🔴 자녀가 있는데 나이대가 없으면 문제로 잡는다', mismatch.card === null && mismatch.problems.length > 0)

  const none = parseCard('P95', 'x', body.replace('자녀 2(중고생·초등, 동거) · 자녀관계 가까움', '자녀 없음'))
  check('자녀 없음을 읽는다', none.card?.childrenCount === 0 && none.card?.childrenAgeBands.length === 0)

  // 🔴 밴드가 겹치는 표기를 두 번 세지 않는다
  check('🔴 "중고생" 을 "고등" 으로 중복해 세지 않는다',
    readChildren('자녀 2(중고생, 동거)').bands.join(',') === '중고등')
  check('여러 나이대가 섞인 표기를 읽는다',
    readChildren('자녀 3(성인 2 분가 · 고등 1 동거)').bands.join(',') === '성인,중고등'
    && readChildren('자녀 3(성인 2 분가 · 고등 1 동거)').count === 3)
  check('별거·사별·비혼을 구분한다',
    readMarital('별거').status === '별거' && readMarital('사별').status === '사별'
    && readMarital('비혼').status === '비혼')
  check('🔴 모르는 혼인 표기는 null 이다', readMarital('동거중').status === null)

  // 🔴 카드 → 매칭 입력
  const p = cardToPersona(card!)
  check('🔴 매칭 입력에 실계정이 붙지 않는다', p.providerId === null)
  check('🔴 여유는 만땅에서 시작한다 — 이력은 예측기가 채운다',
    p.postsThisWeek === 0 && p.daysSinceLastPost === null)
  check('매칭 입력이 카드 축을 그대로 옮긴다',
    p.maritalStatus === '기혼' && p.childrenCount === 2 && p.parentCare === '간헐')
}

// ── ② 정본 문서 — 🔴 25장이 전부 읽혀야 한다 ──
console.log('\n② 정본 Pool 문서 (docs/operations/2026-08-30-persona-pool-design.md §5)')
{
  const doc = readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8')
  const { cards, problems } = parsePoolDoc(doc)
  check('🔴 카드 25장을 전부 읽는다', cards.length === 25)
  check('🔴 파싱 문제 0건', problems.length === 0)
  check('코드가 P01~P25 이다',
    cards.map((c) => c.code).join(',') === Array.from({ length: 25 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`).join(','))
  check('🔴 카드마다 제목이 있다', cards.every((c) => c.title.trim() !== ''))
  check('🔴 카드마다 성격이 있다', cards.every((c) => c.personality.length >= 3))
  check('🔴 나이대가 전부 매칭이 아는 밴드다', cards.every((c) => c.childrenAgeBands.every(isKnownChildBand)))
  check('🔴 자녀 수와 나이대가 정합이다',
    cards.every((c) => (c.childrenCount > 0) === (c.childrenAgeBands.length > 0)))
  check('variation 이 전부 5~8개다', cards.every((c) => c.variationCount >= 5 && c.variationCount <= 8))
  // 🔴 마지막 카드가 뒤 절을 먹지 않는다 — 코드펜스로 자르지 않으면 여기서 걸린다
  check('🔴 마지막 카드(P25)가 뒤 절을 먹지 않는다',
    cards.find((c) => c.code === 'P25')?.variationCount === 6)
  check('혼인 상태를 전부 읽었다', cards.every((c) => c.maritalStatus !== ''))
  // 🔴 얇은 축이 실재함을 문서로 확인한다 — 중고등 자녀는 소수다
  check('🔴 중고등 자녀 카드가 소수다 — 얇은 축이 실재한다',
    cards.filter((c) => c.childrenAgeBands.includes('중고등')).length <= 5)
}

// ── ③ planner 가 쓰는 규칙 — synthetic 큐로 고정 ──
console.log('\n③ 조합 탐색 규칙 (synthetic)')
{
  const draft = (n: number, title = '오늘', body = '국수를 삶았어요.'): QueueCandidate =>
    ({ queueId: `q${n}`, title, body, gateVerdict: 'PASS', createdAt: n, assignedPersonaCode: null,
      voice: null, profile: 'human' as const, gateResults: null })
  // 🔴 `as never` 를 쓰지 않는다 — 카드에 필드가 늘었을 때 컴파일러가 잡아야 한다.
  //    실측: 캐스팅 때문에 `noGoTopics` 누락이 런타임 오류로만 드러났다
  const card = (code: string, over: Partial<PoolCard> = {}): PersonaForMatch =>
    cardToPersona({
      code, birthDate: '1974-05-05', title: 't', ageBand: '50대 초반', region: '수도권',
      maritalStatus: '기혼', spouseRelationship: '원만',
      childrenCount: 0, childrenAgeBands: [], workStatus: '전업', economicStatus: '보통',
      housing: '자가', menopauseStatus: '진행중', parentCare: '없음',
      personality: ['무던함'],
      noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: ['advice'],
      voiceTokens: ['중간 길이'], voiceLength: '중간 길이', variationCount: 6,
      household: { childrenLiving: null, careSide: null, careCohabit: null },
      ...over,
    })

  // 🔴 (2026-09-30) 14일 발행 예측 기반 조합 탐색(단조성 · 순서 불변)은 지웠다 — planner 가 퇴역했다.
  const queue = Array.from({ length: 8 }, (_, i) => draft(i))

  // 🔴 주간 상한을 planner 층에서도 넘기지 않는다
  const many = ['A', 'B', 'C'].map((c) => card(c))
  const batch = planBatch(queue, many)
  check(`🔴 주간 상한 ${POST_CAP_PER_WEEK}건을 넘기지 않는다`,
    Object.values(batch.load).every((n) => n <= POST_CAP_PER_WEEK))

  // 🔴 생활사 hardFilter 는 카드에서 와도 그대로 작동한다
  const kidQueue = [draft(0, '중학생 딸', '딸이 사춘기라 힘들어요.')]
  const noKid = planBatch(kidQueue, [card('A')])
  check('🔴 무자녀 카드는 자녀 글을 못 맡는다', noKid.assignments[0]!.assigned === null)
  const withKid = planBatch(kidQueue, [card('B', { childrenCount: 1, childrenAgeBands: ['중고등'] })])
  check('🔴 중고등 자녀 카드는 맡는다', withKid.assignments[0]!.assigned === 'B')
  const spouseQueue = [draft(0, '남편이', '남편이 요즘 말이 없어요.')]
  const single = planBatch(spouseQueue, [card('C', { maritalStatus: '비혼' })])
  check('🔴 비혼 카드는 현재형 배우자 글을 못 맡는다', single.assignments[0]!.assigned === null)
}

// ── ④ planner 소스 계약 — 🔴 read-only 여야 한다 ──
console.log('\n④ planner 계약 (소스)')
{
  const src = readFileSync('scripts/persona-capacity-planner.mts', 'utf-8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // 🔴 (2026-09-30 · source-slot-v1) planner 는 퇴역했다 — 14일 예측 · 카드 수동 계획 경로가 없다.
  //    Persona 가 다음 단계를 감당하는가는 preflight 의 `contractValidPersonas` 하나가 본다.
  check('🔴 퇴역 — import 도 계산도 없다(안내만 찍는다)', !/^import /m.test(code) && !/forecastPublishing|planBatch|prisma/i.test(code))
  check('🔴 DB 에 쓰지 않는다', !/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(code))
  check('🔴 발행하지 않는다', !/publishOriginalPostTx|\bpublish\(/.test(code))
  check('🔴 정본 경로를 안내한다', /contractValidPersonas/.test(code))
}

// ── ⑤ 🔴 noGo — cardToPersona 가 실제 hardFilter 입력으로 넘기는가 (2026-09-08) ──
console.log('\n⑤ noGo 파싱 · 매칭 전달')
{
  const body = (noGo: string, ban = '금지 advice · caution') => `
ageBand 50대 초반 · 수도권 · 기혼(원만) · 자녀 없음
birthDate 1974-05-05   · 🔴 내부 값이다. 글에 쓰지 않는다 — 계산된 나이만 쓴다
전업 · 보통 · 자가 · 갱년기 후 · 간병 없음
성격    무던함 · 성실 · 조용함
voiceCore  중간 길이 · 존댓말
variation  ① a ② b ③ c ④ d ⑤ e
${ban}
noGo ${noGo}
`
  const c = parseCard('P99', 'x', body('시어머니 험담 · 며느리 훈계 · "요즘 애들" 류')).card!
  // 🔴 따옴표는 말버릇이다 — 본문 substring 매칭에 넣으면 걸리지 않는다
  check('🔴 noGo 소재와 말버릇을 나눈다',
    c.noGoTopics.join(',') === '시어머니 험담,며느리 훈계' && c.noGoExpressions.length === 1)
  // 🔴 이것이 P0-1 이었다 — 예전에는 여기가 [] 였다
  check('🔴 cardToPersona 가 noGoTopics 를 버리지 않는다',
    cardToPersona(c).noGoTopics.join(',') === '시어머니 험담,며느리 훈계')

  // 🔴 실제로 hardFilter 가 막는가 — 넘기기만 하고 안 걸리면 의미가 없다
  const hit: BatchDraft = { queueId: 'q0', title: '오늘', body: '시어머니 험담을 좀 했어요.', gateVerdict: 'PASS', createdAt: 0, voice: null, profile: 'human' as const, assignedPersonaCode: null }
  const miss: BatchDraft = { queueId: 'q0', title: '오늘', body: '국수를 삶았어요.', gateVerdict: 'PASS', createdAt: 0, voice: null, profile: 'human' as const, assignedPersonaCode: null }
  check('🔴 noGo 소재 글은 그 사람에게 가지 않는다', planBatch([hit], [cardToPersona(c)]).assignments[0]!.assigned === null)
  check('그 밖의 글은 정상 배정된다', planBatch([miss], [cardToPersona(c)]).assignments[0]!.assigned === 'P99')
  check('🔴 차단 사유가 NOGO_TOPIC 이다',
    planBatch([hit], [cardToPersona(c)]).assignments[0]!.blocked.some((b) => b.reasons.some((r) => r.code === 'NOGO_TOPIC')))

  // 🔴 파싱 실패는 기본값 없이 문제로 남는다
  check('🔴 noGo 줄이 없으면 카드를 버린다', (() => {
    const r = parseCard('P98', 'x', body('x').replace(/^noGo .*$/m, ''))
    return r.card === null && r.problems.some((p) => p.includes('noGo'))
  })())
  check('🔴 모르는 금지 역할은 조용히 버리지 않는다', (() => {
    const r = parseCard('P97', 'x', body('험담', '금지 advise · caution'))
    return r.card === null && r.problems.some((p) => p.includes('advise'))
  })())
  check('역할 뒤 한정어는 괄호·공백 모두 받는다', (() => {
    const a = parseCard('P96', 'x', body('험담', '금지 advice(의료·재무) · caution')).card
    const b = parseCard('P95', 'x', body('험담', '금지 information 단정 · caution')).card
    return a?.forbiddenReactionRoles.join(',') === 'advice,caution'
      && b?.forbiddenReactionRoles.join(',') === 'information,caution'
  })())
  // 🔴 괄호 안 `·` 는 구분자가 아니다 — 자녀 나이대도 같은 규칙을 탄다
  check('🔴 괄호 안 · 를 구분자로 쓰지 않는다',
    parseCard('P94', 'x', body('험담').replace('자녀 없음', '자녀 2(중고생·초등, 동거)')).card
      ?.childrenAgeBands.join(',') === '중고등,초등')
}

// ── ⑥ 🔴 카드 검증 — 실제로 FAIL 하는가 ──
console.log('\n⑥ 설계 카드 검증 (persona-card-verify)')
{
  const pool = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8'))
  const p01 = pool.cards.find((c) => c.code === 'P01')!
  // 🔴 길이 미상 카드 — §7-1 에도 없어 추정하지 않고 남겨 둔 카드다
  const p09 = pool.cards.find((c) => c.code === 'P09')!
  /** 🔴 정본 P01 에서 그대로 만든 카드 — 이것이 통과 기준선이다 */
  const good = (): Record<string, unknown> => ({
    ageBand: p01.ageBand, region: p01.region, lifeStage: '양육기',
    dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
    identity: {
      housing: p01.housing, parentCare: p01.parentCare, workStatus: p01.workStatus,
      childrenCount: p01.childrenCount, maritalStatus: p01.maritalStatus,
      economicStatus: p01.economicStatus, menopauseStatus: p01.menopauseStatus,
      childrenAgeBands: [...p01.childrenAgeBands],
      spouseRelationship: p01.spouseRelationship ?? '해당없음',
      personality: [...p01.personality],
    },
    voiceCore: { emoji: '없음', ending: '~해요', length: p01.voiceLength, register: '존댓말' },
    voiceVariations: ['a', 'b', 'c', 'd', 'e', 'f'],
    activityRhythm: { burstiness: 0.3, activeHours: [[10, 13]], weekdayBias: 0.5 },
    noGoTopics: [...p01.noGoTopics], noGoExpressions: [...p01.noGoExpressions],
    forbiddenReactionRoles: [...p01.forbiddenReactionRoles],
  })
  const bad = (mut: (c: Record<string, unknown>) => void, card = p01): string[] => {
    const c = good(); mut(c); return verifySeedCard('P01', c, card)
  }
  check('🟢 정본에서 만든 카드는 통과한다', verifySeedCard('P01', good(), p01).length === 0)

  // 🔴 P1-2 — 빈 noGo 를 무조건 허용하지 않는다
  check('🔴 noGoTopics 를 비우면 FAIL', bad((c) => { c.noGoTopics = [] }).some((p) => p.includes('noGoTopics')))
  check('🔴 forbiddenReactionRoles 를 비우면 FAIL',
    bad((c) => { c.forbiddenReactionRoles = [] }).some((p) => p.includes('forbiddenReactionRoles')))
  check('🔴 금지 역할이 정본과 다르면 FAIL',
    bad((c) => { c.forbiddenReactionRoles = ['advice'] }).some((p) => p.includes('forbiddenReactionRoles')))
  check('🔴 noGo 소재가 정본과 다르면 FAIL',
    bad((c) => { c.noGoTopics = ['엉뚱한 소재'] }).some((p) => p.includes('noGoTopics')))

  // 🔴 P0-2 — 정본이 길이 미상이면 seed 에 값이 있어도 FAIL
  check('🔴 정본 길이 미상(P09)이면 seed 에 값이 있어도 FAIL — 추정값을 넣지 않는다', (() => {
    const c = good()
    ;(c.voiceCore as Record<string, unknown>).length = '짧고 조심스럽게'
    return verifySeedCard('P09', c, p09).some((p) => p.includes('미상'))
  })())
  check('🔴 길이가 정본과 다르면 FAIL', (() => {
    const c = good()
    ;(c.voiceCore as Record<string, unknown>).length = '길게'
    return verifySeedCard('P01', c, p01).some((p) => p.includes('voiceCore.length'))
  })())
  check('🔴 매칭이 못 읽는 길이는 FAIL', (() => {
    const c = good()
    ;(c.voiceCore as Record<string, unknown>).length = '또박또박'
    return verifySeedCard('P01', c, p01).some((p) => p.includes('readLengthBand'))
  })())

  // 🔴 제어값 · 정합
  check('🔴 spouseRelationship 은 "해당없음" 으로 통일한다 — 띄어쓴 값은 FAIL',
    bad((c) => { (c.identity as Record<string, unknown>).spouseRelationship = '해당 없음' })
      .some((p) => p.includes('spouseRelationship')))
  check('🔴 모르는 parentCare 는 FAIL',
    bad((c) => { (c.identity as Record<string, unknown>).parentCare = '가끔' }).some((p) => p.includes('parentCare')))
  check('🔴 자녀가 있는데 나이대가 비면 FAIL',
    bad((c) => { (c.identity as Record<string, unknown>).childrenAgeBands = [] }).some((p) => p.includes('childrenAgeBands')))
  check('🔴 매칭 축이 정본과 다르면 FAIL',
    bad((c) => { (c.identity as Record<string, unknown>).parentCare = '상시' }).some((p) => p.includes('정본과 다르다')))
  check('🔴 voiceVariations 가 범위를 벗어나면 FAIL',
    bad((c) => { c.voiceVariations = ['a', 'b'] }).some((p) => p.includes('voiceVariations')))
  check('🔴 정본 카드를 못 찾으면 FAIL', verifySeedCard('P99', good(), null).some((p) => p.includes('정본')))

  // 🔴 무자녀 카드는 빈 나이대가 정상이다
  const p04 = pool.cards.find((c) => c.code === 'P04')!
  check('🟢 무자녀 카드는 빈 childrenAgeBands 로 통과한다', (() => {
    const c = good()
    const id = c.identity as Record<string, unknown>
    id.childrenCount = 0; id.childrenAgeBands = []
    id.maritalStatus = p04.maritalStatus; id.parentCare = p04.parentCare
    id.menopauseStatus = p04.menopauseStatus; id.spouseRelationship = p04.spouseRelationship ?? '해당없음'
    ;(c.voiceCore as Record<string, unknown>).length = p04.voiceLength
    c.noGoTopics = [...p04.noGoTopics]; c.noGoExpressions = [...p04.noGoExpressions]
    c.forbiddenReactionRoles = [...p04.forbiddenReactionRoles]
    return verifySeedCard('P04', c, p04).length === 0
  })())

  // 🔴 코드 형식 · 중복
  // 🔴 P01~P50 을 받는다 — Pool 확장 계획. 실제 안전장치는 "Pool 문서에 카드가 있는가" 다
  check('🔴 P01~P50 이 정본 코드 범위다',
    isPoolCode('P01') && isPoolCode('P25') && isPoolCode('P50') && !isPoolCode('P51') && !isPoolCode('N01'))
  check('🔴 최상위 중복 키만 센다 — 중첩 키는 정상 반복이다',
    duplicateKeys('{"P01":{"a":1},"P02":{"a":2}}').length === 0
    && duplicateKeys('{"P01":{"a":1},"P01":{"a":2}}').join(',') === 'P01')
}

// ── ⑦ 🔴 --apply 가 설계 카드를 거부하는가 (소스 계약) ──
console.log('\n⑦ --apply 거부 계약')
{
  const src = readFileSync('scripts/persona-seed-apply.mts', 'utf-8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('🔴 --apply 는 설계 카드를 만나면 멈춘다',
    /if \(APPLY && DRAFT_CARDS\.length > 0\) \{[\s\S]{0,200}?fail\(/.test(code))
  check('🔴 --check-cards 는 DB 반영 검증으로 넘어가지 않는다',
    /if \(CHECK_CARDS\) \{[\s\S]{0,200}?process\.exit\(0\)/.test(code))
  check('🔴 판정을 스크립트가 다시 만들지 않는다 — verifySeedCard 를 부른다',
    /verifySeedCard\(/.test(code) && !/function verifySeedCard/.test(code))
  check('🔴 정본 문서를 읽어 대조한다', /parsePoolDoc\(/.test(code))
}

// ── ⑧ 🔴 정본 문서 내부 정합 — §7-1 말투 배분 ↔ 카드 voiceCore (2026-09-08) ──
//
//    §7-1 은 20명을 한눈에 놓고 길이를 배분한 표다. 카드가 그것과 어긋나면
//    한쪽만 보고 판단하는 사람이 생긴다. 실측: P02 는 §7-1 에서 `중간` 인데
//    카드에는 길이 표현이 없었고, P03 은 `긴` 인데 카드가 `긴 문장` 이라
//    매칭(`readLengthBand`)이 읽지 못해 후보에서 빠져 있었다.
console.log('\n⑧ 정본 §7-1 ↔ 카드 voiceCore 정합')
{
  const doc = readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8')
  const { cards } = parsePoolDoc(doc)
  const cardOf = new Map(cards.map((c) => [c.code, c]))

  /** §7-1 `문장 길이` 줄에서 밴드별 코드를 읽는다 — 손으로 옮겨 적지 않는다 */
  const lengthLine = doc.split('\n').find((l) => l.startsWith('문장 길이')) ?? ''
  const groups = new Map<string, string[]>()
  for (const seg of lengthLine.replace(/^문장 길이\s*/, '').split('·')) {
    const m = /^\s*(\S+)\s+((?:P\d{2}\s*)+)$/.exec(seg.trim())
    if (m !== null) groups.set(m[1]!, m[2]!.trim().split(/\s+/))
  }
  check('🔴 §7-1 문장 길이 줄을 읽는다 — 짧음·중간·긴 세 묶음', groups.size === 3)

  /**
   * 🔴 **명시적 길이 미상 목록** — 근거가 없어 비워 둔 카드다.
   *    이 줄이 없으면 "빠진 것" 과 "일부러 비운 것" 을 구별할 수 없다 —
   *    실측: P05 · P09 · P10 · P14 네 명이 어느 목록에도 없었는데,
   *    그중 셋은 단순 누락이고 하나(P09)만 근거가 없는 것이었다.
   */
  const unknownLine = doc.split('\n').find((l) => l.startsWith('길이 미상')) ?? ''
  const unknownCodes = (unknownLine.match(/P\d{2}/g) ?? [])
  check('🔴 §7-1 에 명시적 `길이 미상` 줄이 있다', unknownCodes.length > 0)

  /** §7-1 밴드 이름 → 매칭 밴드 */
  const BAND: Record<string, string> = { '짧음': '짧게', '중간': '보통', '긴': '길게' }
  const mismatched: string[] = []
  const missing: string[] = []
  for (const [label, codes] of groups) {
    for (const code of codes) {
      const c = cardOf.get(code)
      if (c === undefined) { missing.push(`${code}(카드 없음)`); continue }
      if (c.voiceLength === null) { mismatched.push(`${code}(카드 길이 미상)`); continue }
      const got = readLengthBand(c.voiceLength)
      if (got !== BAND[label]) mismatched.push(`${code}(§7-1 ${label} / 카드 ${got ?? '미상'})`)
    }
  }
  // 🔴 **알려진 불일치 예외 목록을 두지 않는다.** 예외는 한 번 생기면 늘어나기만 한다 —
  //    다음에 어긋나는 카드가 생겨도 "거기 넣으면 되지" 가 되기 때문이다. 전부 맞춘 뒤 없앴다
  check(`🔴 §7-1 과 카드 사이에 불일치가 없다${mismatched.length ? ` — ${mismatched.join(' ')}` : ''}`,
    mismatched.length === 0 && missing.length === 0)

  // ── 🔴 완전성 — 20명 전원이 **정확히 한 번씩** 어느 목록에 있어야 한다 ──
  //    한 명이라도 빠지면 그 카드의 말투는 아무도 배분하지 않은 채로 남는다.
  //    두 번 들어가면 어느 밴드가 그 사람인지 문서가 두 말을 한다.
  {
    const listed = [...[...groups.values()].flat(), ...unknownCodes]
    const counts = new Map<string, number>()
    for (const c of listed) counts.set(c, (counts.get(c) ?? 0) + 1)
    const allCodes = cards.map((c) => c.code)
    const absent = allCodes.filter((c) => !counts.has(c))
    const dupes = [...counts].filter(([, n]) => n > 1).map(([c, n]) => `${c}×${n}`)
    const stray = [...counts.keys()].filter((c) => !allCodes.includes(c))

    check(`🔴 어느 목록에도 없는 카드가 없다${absent.length ? ` — ${absent.join(' ')}` : ''}`, absent.length === 0)
    check(`🔴 두 목록에 겹쳐 든 카드가 없다${dupes.length ? ` — ${dupes.join(' ')}` : ''}`, dupes.length === 0)
    check(`🔴 카드에 없는 코드가 목록에 없다${stray.length ? ` — ${stray.join(' ')}` : ''}`, stray.length === 0)
    check(`🔴 목록 합계가 카드 수와 같다 (${listed.length} / ${allCodes.length})`, listed.length === allCodes.length)

    // 🔴 미상 목록에 든 카드는 **정말로** 카드에서도 길이를 읽지 못해야 한다.
    //    읽히는데 미상 목록에 있으면, 쓸 수 있는 사람을 근거 없이 후보에서 빼는 것이다
    const wronglyUnknown = unknownCodes.filter((c) => cardOf.get(c)?.voiceLength !== null)
    check(`🔴 미상 목록의 카드는 실제로 길이를 읽지 못한다${wronglyUnknown.length ? ` — ${wronglyUnknown.join(' ')}` : ''}`,
      wronglyUnknown.length === 0)
    // 🔴 반대로, 카드에서 못 읽는데 밴드 목록에 든 것도 없어야 한다
    const readable = cards.filter((c) => c.voiceLength !== null).map((c) => c.code)
    const bandListed = [...groups.values()].flat()
    check('🔴 밴드 목록에 든 카드는 전부 길이를 읽을 수 있다',
      bandListed.every((c) => readable.includes(c)))
    check('🔴 미상 목록과 파서의 미상 판정이 일치한다',
      [...unknownCodes].sort().join(',') === cards.filter((c) => c.voiceLength === null).map((c) => c.code).sort().join(','))
  }

  // 🔴 이번 보정을 회귀로 고정한다 — 되돌아가면 여기서 걸린다
  check('🔴 [회귀] P02 voiceCore 에 길이가 있다 (§7-1 중간)',
    readLengthBand(cardOf.get('P02')?.voiceLength) === '보통')
  check('🔴 [회귀] P03 voiceCore 를 매칭이 읽는다 (§7-1 긴)',
    readLengthBand(cardOf.get('P03')?.voiceLength) === '길게')
  // 🔴 카드가 명확하면 카드가 우선이다 — §7-1 을 옮겼다
  check('🔴 [회귀] P01 은 카드의 `짧은 문장` 을 지킨다', readLengthBand(cardOf.get('P01')?.voiceLength) === '짧게')
  check('🔴 [회귀] P16 은 카드의 `짧음` 을 지킨다', readLengthBand(cardOf.get('P16')?.voiceLength) === '짧게')
  // 🔴 P13 은 방향(§7-1 `긴`)을 지키되 매칭이 읽는 표현으로 바꿨다.
  //    괄호 안에 "중간" 을 쓰면 별칭 검사 순서 때문에 **보통**으로 읽힌다 — 실측으로 잡았다
  check('🔴 [회귀] P13 을 매칭이 `길게` 로 읽는다', readLengthBand(cardOf.get('P13')?.voiceLength) === '길게')
  check('🔴 [회귀] P13 의 문체 뉘앙스가 지워지지 않았다',
    (cardOf.get('P13')?.voiceLength ?? '').includes('아주 길지는'))
  // 🔴 별칭 검사 순서가 바뀌면 위 표현이 조용히 다른 밴드가 된다 — 그 전제를 고정한다
  check('🔴 별칭은 보통 → 짧게 → 길게 순으로 검사된다 (괄호 표현이 이 순서에 걸린다)',
    readLengthBand('길게(중간보다 조금 긴 편)') === '보통' && readLengthBand('길게(아주 길지는 않은 편)') === '길게')
  // 🔴 P09 는 §7-1 에도 없다 — 추정하지 않고 미상으로 남긴다
  check('🔴 P09 는 §7-1 어디에도 없다 — 추정하지 않는다',
    [...groups.values()].every((cs) => !cs.includes('P09')))
  check('🔴 P09 는 길이 미상으로 남아 후보에서 빠진다', cardOf.get('P09')?.voiceLength === null)
  check('🔴 길이 미상은 P09 뿐이다', cards.filter((c) => c.voiceLength === null).map((c) => c.code).join(',') === 'P09')

  // 🔴 seed 카드의 길이가 정본과 어긋나면 검증이 잡는다 (P02 · P03 회귀)
  for (const code of ['P02', 'P03'] as const) {
    const pc = cardOf.get(code)!
    const base: Record<string, unknown> = {
      ageBand: pc.ageBand, region: pc.region, lifeStage: 'x',
      dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
      identity: {
        housing: pc.housing, parentCare: pc.parentCare, workStatus: pc.workStatus,
        childrenCount: pc.childrenCount, maritalStatus: pc.maritalStatus,
        economicStatus: pc.economicStatus, menopauseStatus: pc.menopauseStatus,
        childrenAgeBands: [...pc.childrenAgeBands],
        spouseRelationship: pc.spouseRelationship ?? '해당없음',
        personality: [...pc.personality],
      },
      voiceCore: { emoji: '없음', ending: '~네요', length: pc.voiceLength, register: '존댓말' },
      voiceVariations: ['a', 'b', 'c', 'd', 'e'],
      activityRhythm: { burstiness: 0.3, activeHours: [[10, 13]], weekdayBias: 0.5 },
      noGoTopics: [...pc.noGoTopics], noGoExpressions: [...pc.noGoExpressions],
      forbiddenReactionRoles: [...pc.forbiddenReactionRoles],
    }
    check(`🟢 ${code} seed 가 정본 길이와 같으면 통과`, verifySeedCard(code, base, pc).length === 0)
    const drifted = { ...base, voiceCore: { ...(base.voiceCore as object), length: '아주 짧음' } }
    check(`🔴 ${code} seed 길이가 정본과 어긋나면 FAIL`,
      verifySeedCard(code, drifted, pc).some((x) => x.includes('voiceCore.length')))
  }
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
