#!/usr/bin/env tsx
/**
 * 적응 경로 검사 — 🔴 **긴 사연(raw) 원천이 쟁점을 살린 AI 원작 글이 되는가 · 막을 것은 여전히 막히는가** (2026-09-29)
 *
 *   ① 재현 모양 — 앞판 규칙(v3)이면 초안 0 인 원천이 v4 에서 적응 경로로 간다 · 바뀐 자리는 `axisMismatch` 하나뿐
 *   ② 앞 판 결론 인정 — v3 결론은 그대로(유료 재판정 0) · `axisMismatch` 기록만 다시 본다
 *   ③ 결정적 판정 — 주제 낱말 · 논쟁 표지 · 1인칭 자리
 *   ④ 전체 사슬 — 안전 필터 → 상세 축 → 판정 v4 → 경로 → Content Core(가짜 provider) → 채택
 *      · 불편하지만 안전한 소재(남녀·부부 갈등 · 연예인 · 돈 · 흔한 건강 궁금증 · 거친 의견 · 댓글 많은 글) → 채택
 *      · 개인정보 · 단정 명예훼손 · 괴롭힘 · 위험한 의료 지시 · 원문 복제 · 쟁점 소실 → 막힘
 *   ⑤ 경로 대조 — AUTO_RAW 를 적응 없이 만들면 채택하지 않는다 (raw 를 seed 로 흘리는 변이를 잡는다)
 *   ⑥ 사람 검토 — 적응 초안은 `DRAFT_LIFE_REVIEW:rawAdaptation` 경고로 적재 → 자동 READY 표본 아님
 *   ⑦ 창업자 gold 30/30 · 사람 중대 결함 누출 0 — seed 경로 판정은 그대로다
 *
 *   🔴 fixture 는 **합성 문장**이다 — 회원 원문을 옮기지 않았다. 모양(길이 · 축 · 댓글 수 · 판정 모양)만 실측을 따른다.
 *   🔴 네트워크 0 · provider 0 · DB 0 · 유료 호출 0.
 */
import { randomUUID } from 'node:crypto'

import {
  judgeOne, conclusionHoldsUnder, RULE_VERSION, SEED_AXIS, RAW_AXIS, MIN_CONFIDENCE,
  type JudgeInput, type SemanticOutcome, type SemanticVerdict, type AutoDecision,
} from '../src/lib/micro-seed-auto-judge'
import {
  draftRouteOf, requiredRouteOf, judgeRawAdaptation, topicAnchorsOf, debateMarkersOf,
  adaptationContractOf, isAdaptationContract,
  ADAPT_PLAN_RULE, ADAPT_DRAFT_RULES, ADAPT_REVIEW_RULES, RAW_ADAPTATION_VERSION, RAW_ADAPTATION_REVIEW_CODE,
} from '../src/lib/raw-adaptation'
import { pickV2, type DraftCandidate, type Pick } from '../src/lib/micro-seed-auto-draft'
import { measureOriginality, copiesSourceTitle } from '../src/lib/draft-originality'
import { SPEAKER_PLAN_VERSION } from '../src/lib/content-core/speaker'
import { REVIEW_VERSION } from '../src/lib/content-core/review'
import {
  CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION, STAGE_MAX_OUTPUT_LABEL,
  sameGenerationContract, type GenerationContract,
} from '../src/lib/content-core/pipeline'
import type { HumanReviewArtifact } from '../src/lib/content-core/artifact'
import { lifeReviewHoldsOf } from '../src/lib/semantic-summary-codes'
import { replayFounderGold, describeFounderGold } from '../src/lib/founder-gold'
import { qualityContractComponents, QUALITY_CONTRACT_VERSION } from '../src/lib/quality-contract'
import { judgementOutcome, artifactOutcome } from '../src/lib/supply-workset'
import { runContentCore, personaInputOf, STAGE_MODEL, type Ask, type AskResult } from './lib/content-core-run.mjs'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { classifyDetail } from './lib/micro-seed-detail-classify.mjs'
import { P13, CLEAN_REVIEW, FIXTURE_NOW } from './lib/draft-gate-fixtures.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  🔴 FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

console.log('\n══ 적응 경로 (긴 사연 → 쟁점을 살린 AI 원작 글) — 🔴 provider 0 · DB 0 · 유료 0 ══\n')

// ─────────────────────────────────────────────────────────
// 공통 — 판정 입력 · 모델 답 모양
// ─────────────────────────────────────────────────────────
const NOW = '2026-09-29T03:00:00.000Z'
const sem = (o: Partial<SemanticVerdict> = {}): SemanticVerdict => ({
  decision: 'AUTO_SEED', confidence: 0.85, risks: [], communityAngle: '우리 또래 이야기', ...o,
})
const ok = (v: SemanticVerdict): SemanticOutcome =>
  ({ verdict: v, status: 'ok', attemptCount: 1, providerErrorCode: null, model: 'claude-haiku-4.5' })
const failed: SemanticOutcome = { verdict: null, status: 'timeout', attemptCount: 2, providerErrorCode: 'TIMEOUT', model: 'claude-haiku-4.5' }
const input = (o: Partial<JudgeInput> = {}): JudgeInput => ({
  sourceArticleId: 'syn-1', axis: RAW_AXIS, access: 'ok', lane: 'originalRaw', assetAxes: '',
  safetyVerdict: 'pass', safetyReasons: '', bodyLength: 520, qualityFlags: [],
  title: '합성 제목', bodyHead: '합성 본문 머리'.repeat(10), commentCount: 20, ...o,
})

/**
 * 🔴 **앞판(v3) 규칙의 마지막 분기만** — 비교용으로 여기 둔다. 운영 코드에는 없다.
 *    위험·격리·확신 분기는 v3 와 v4 가 같으므로 v4 `judgeOne` 결과를 그대로 쓰고,
 *    두 통과 라벨 중 축과 다른 것을 말한 자리만 v3 는 `axisMismatch` HOLD 였다.
 */
const v3DecisionOf = (i: JudgeInput, o: SemanticOutcome): AutoDecision => {
  const v4 = judgeOne(i, NOW, o).decision
  const passed = v4 === 'AUTO_SEED' || v4 === 'AUTO_RAW'
  if (!passed || o.verdict === null) return v4
  return o.verdict.decision === v4 ? v4 : 'AUTO_HOLD'
}

// ─────────────────────────────────────────────────────────
console.log('① 재현 모양 — 앞판이면 초안 0, v4 는 적응 경로 · 바뀐 자리는 하나뿐')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 실측(2026-09-29, 운영 산출물 읽기 전용 · 전체 기간) 모양 그대로 — raw 축 판정 395 → 초안 0.
   *    axisMismatch 204(전부 위험 0 · 확신 0.7↑) · AUTO_RAW 83 · 판정 실패 95 · 위해·격리 소수.
   *    여기서는 그 모양을 **한 줄씩** 합성한다(원문 없음).
   */
  type Shape = { label: string; i: JudgeInput; o: SemanticOutcome; n: number }
  const shapes: Shape[] = [
    { label: 'raw · 모델 SEED 라벨(앞판 axisMismatch)', i: input(), o: ok(sem()), n: 204 },
    { label: 'raw · 모델 RAW 라벨(앞판 AUTO_RAW 막다른 길)', i: input(), o: ok(sem({ decision: 'AUTO_RAW' })), n: 83 },
    { label: 'seed · 모델 RAW 라벨(앞판 axisMismatch)', i: input({ axis: SEED_AXIS }), o: ok(sem({ decision: 'AUTO_RAW' })), n: 34 },
    { label: 'raw · 판정 실패', i: input(), o: failed, n: 95 },
    { label: 'raw · 구매처 문의', i: input(), o: ok(sem({ risks: ['purchaseOrSellerRequest'] })), n: 3 },
    { label: 'raw · 치료 판단 요청', i: input(), o: ok(sem({ risks: ['medicalDecisionRequest'] })), n: 2 },
    { label: 'raw · 건강 효능 주장', i: input(), o: ok(sem({ risks: ['healthEfficacyClaim'] })), n: 2 },
    { label: 'raw · 위기 신호', i: input(), o: ok(sem({ risks: ['crisisSignal'] })), n: 1 },
    { label: 'raw · 비공개 개인 특정', i: input(), o: ok(sem({ risks: ['identifiablePrivatePerson'] })), n: 1 },
    { label: 'raw · 확신 부족', i: input(), o: ok(sem({ confidence: MIN_CONFIDENCE - 0.1 })), n: 1 },
    { label: 'raw · 모델 DROP · 사유 없음', i: input(), o: ok(sem({ decision: 'AUTO_DROP' })), n: 1 },
  ]
  let v3Draftable = 0
  let v4Adapt = 0
  let v3Drop = 0
  let v4Drop = 0
  let changedNotMismatch = 0
  for (const s of shapes) {
    const v3 = v3DecisionOf(s.i, s.o)
    const v4 = judgeOne(s.i, NOW, s.o).decision
    // 🔴 앞판에서 초안이 되는 것은 AUTO_SEED 뿐이었다(AUTO_RAW 는 받아 쓰는 곳이 없었다)
    if (v3 === 'AUTO_SEED' && s.i.axis === RAW_AXIS) v3Draftable += s.n
    if (s.i.axis === RAW_AXIS && draftRouteOf(v4, RAW_AXIS) === 'adapt') v4Adapt += s.n
    if (v3 === 'AUTO_DROP') v3Drop += s.n
    if (v4 === 'AUTO_DROP') v4Drop += s.n
    const mismatch = s.o.verdict !== null && v3 === 'AUTO_HOLD' && (v4 === 'AUTO_SEED' || v4 === 'AUTO_RAW')
    if (v3 !== v4 && !mismatch) changedNotMismatch += s.n
    console.log(`   · ${s.label.padEnd(30)} ×${String(s.n).padStart(3)}  v3 ${v3.padEnd(9)} → v4 ${v4}`)
  }
  check(`🔴 앞판: raw 축 초안 대상 ${v3Draftable}건 (실측 395 → 0 과 같은 모양)`, v3Draftable === 0)
  check(`🟢 v4: raw 축 적응 경로 ${v4Adapt}건 = axisMismatch 204 + AUTO_RAW 83`, v4Adapt === 287, String(v4Adapt))
  check('🔴 🔴 **바뀐 자리는 통과 라벨 불일치 하나뿐 — 위험·격리·실패·확신 분기는 한 건도 바뀌지 않았다**',
    changedNotMismatch === 0, String(changedNotMismatch))
  check('🔴 🔴 **DROP 수가 늘지 않았다 (안전한 논쟁 소재의 거짓 폐기 증가 0)**', v4Drop === v3Drop, `${v3Drop} → ${v4Drop}`)
  check('🔴 위해 · 위기 · 의료 판단 · 구매처는 v4 에서도 그대로 막힌다',
    judgeOne(input(), NOW, ok(sem({ risks: ['identifiablePrivatePerson'] }))).decision === 'AUTO_DROP'
    && judgeOne(input(), NOW, ok(sem({ risks: ['unverifiedDefamation'] }))).decision === 'AUTO_DROP'
    && judgeOne(input(), NOW, ok(sem({ risks: ['targetedHarassmentOrThreat'] }))).decision === 'AUTO_DROP'
    && judgeOne(input(), NOW, ok(sem({ risks: ['dangerousMedicalInstruction'] }))).decision === 'AUTO_DROP'
    && judgeOne(input(), NOW, ok(sem({ risks: ['crisisSignal'] }))).decision === 'AUTO_HOLD'
    && judgeOne(input(), NOW, ok(sem({ risks: ['purchaseOrSellerRequest'] }))).decision === 'AUTO_HOLD')
  check('🔴 deterministic 차단은 모델 라벨과 무관하다 — safety hardExclude · 정치는 묻기 전에 DROP',
    judgeOne(input({ safetyVerdict: 'hardExclude', safetyReasons: 'politics' }), NOW, ok(sem())).decision === 'AUTO_DROP')
}

// ─────────────────────────────────────────────────────────
console.log('\n② 앞 판 결론 인정 — v3 결론은 그대로(유료 재판정 0) · axisMismatch 만 다시 본다')
// ─────────────────────────────────────────────────────────
{
  check(`지금 판 = auto-judge-v4 (지금 ${RULE_VERSION})`, RULE_VERSION === 'auto-judge-v4')
  const v3 = (reasonCodes?: readonly string[]) => ({ ruleVersion: 'auto-judge-v3', reasonCodes })
  check('🟢 v3 HOLD(semanticHold) · DROP · SEED 는 v4 에서도 결론이다',
    conclusionHoldsUnder(v3(['purchaseOrSellerRequest', 'semanticHold']), RULE_VERSION)
    && conclusionHoldsUnder(v3(['identifiablePrivatePerson', 'semanticDrop']), RULE_VERSION)
    && conclusionHoldsUnder(v3(['axisSeed']), RULE_VERSION))
  check('🔴 🔴 **v3 axisMismatch 는 결론이 아니다 — 다음 회차가 v4 로 다시 판정한다**',
    !conclusionHoldsUnder(v3(['axisMismatch']), RULE_VERSION))
  check('🔴 사유를 못 읽는 v3 기록은 인정하지 않는다', !conclusionHoldsUnder(v3(undefined), RULE_VERSION))
  check('🔴 표에 없는 판(v2)은 인정하지 않는다', !conclusionHoldsUnder({ ruleVersion: 'auto-judge-v2', reasonCodes: ['axisSeed'] }, RULE_VERSION))
  const canon = { ruleVersion: RULE_VERSION, promptVersion: 'p', judgeModel: 'm' }
  const row = (decision: string, reasonCodes: readonly string[]) => ({
    sourceArticleId: 's1', inputHash: 'h', ruleVersion: 'auto-judge-v3', promptVersion: 'p', model: 'm',
    decision, semanticStatus: 'ok', decidedAt: '2026-09-20T00:00:00.000Z', reasonCodes,
  })
  check('🟢 작업 묶음 — v3 AUTO_HOLD(semanticHold) 은 끝난 원천(terminal)이다',
    judgementOutcome(row('AUTO_HOLD', ['semanticHold']), 'h', canon)?.state === 'terminal')
  check('🔴 🔴 **작업 묶음 — v3 axisMismatch 는 지금 결론이 아니다(null) → 다시 판정 대상**',
    judgementOutcome(row('AUTO_HOLD', ['axisMismatch']), 'h', canon) === null)
  check('🟢 작업 묶음 — v3 AUTO_RAW 는 적응 경로 초안 대상(seeded)이다',
    judgementOutcome(row('AUTO_RAW', ['axisRaw']), 'h', canon)?.state === 'seeded')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 결정적 판정 — 주제 낱말 · 논쟁 표지 · 1인칭 자리')
// ─────────────────────────────────────────────────────────
{
  const a = topicAnchorsOf('남편이 명절마다 시댁만 먼저 가자고 해요 제가 예민한가요')
  check('주제 열쇠 — 조사를 떼고 서술어·군말은 뺀다', a.includes('남편') && a.includes('명절') && a.includes('시댁')
    && !a.some((x) => x.startsWith('가자') || x.startsWith('예민') || x === '제가'), a.join(','))
  check('🔴 "나이" 를 "나" 로 자르지 않는다 · 한 글자 주제(돈)는 남긴다',
    topicAnchorsOf('나이 들수록 돈 문제로 섭섭').includes('나이') && topicAnchorsOf('나이 들수록 돈 문제로 섭섭').includes('돈'))
  check('논쟁 표지는 띄어쓰기가 달라도 같다', debateMarkersOf('누가 맞 는 걸까요 이해가 안 가요').length >= 1
    && debateMarkersOf('이해가안가요').includes('이해가안'))
  const src = { sourceTitle: '남편이 명절마다 시댁만 먼저 가자고 해요 제가 예민한가요', sourceBody: '서운한 마음이 들어요' }
  check('🟢 주제 · 논쟁을 살린 관찰 글은 통과', judgeRawAdaptation({
    ...src, stance: 'QUESTION', draftTitle: '명절에 시댁 먼저, 친정은 늘 나중이면',
    draftBody: '남편 쪽부터 챙기는 게 당연한 집이 많다죠. 서운하다는 마음도 이해가 가요. 여러분이라면 어떻게 나누세요?',
  }).length === 0)
  check('🔴 1인칭 경험 자리 → adaptSelfExperience', judgeRawAdaptation({
    ...src, stance: 'SELF_EXPERIENCE', draftTitle: '명절 시댁', draftBody: '남편이 서운하게 해요 여러분이라면?',
  }).some((f) => f.code === 'adaptSelfExperience'))
  check('🔴 🔴 **주제가 사라진 일반론 → adaptTopicLost**', judgeRawAdaptation({
    ...src, stance: 'REFLECTION', draftTitle: '요즘 마음이 복잡하네요', draftBody: '다들 어떻게 지내세요? 서운한 일도 있고요.',
  }).some((f) => f.code === 'adaptTopicLost'))
  check('🔴 🔴 **주제는 남았는데 논쟁을 지워 순하게 만든 글 → adaptDebateLost**', judgeRawAdaptation({
    ...src, stance: 'OBSERVATION', draftTitle: '명절엔 시댁도 친정도 즐겁게',
    draftBody: '남편과 함께 명절 계획을 세우면 마음이 편해요. 올해도 즐겁게 보내세요.',
  }).some((f) => f.code === 'adaptDebateLost'))
  check('🟢 원문에 논쟁 표지가 없으면 논쟁 대조를 하지 않는다(잴 수 없는 것을 결함으로 세지 않는다)', judgeRawAdaptation({
    stance: 'QUESTION', sourceTitle: '갱년기 열감 때문에 밤마다 깨요', sourceBody: '다들 어떻게 버티세요',
    draftTitle: '갱년기 열감으로 새벽에 깨는 분들', draftBody: '밤마다 깨면 다음 날이 길죠. 어떻게들 지내세요?',
  }).length === 0)
}

// ─────────────────────────────────────────────────────────
// ④ 전체 사슬 — 안전 필터 → 상세 축 → 판정 v4 → 경로 → Content Core(가짜 provider) → 채택
// ─────────────────────────────────────────────────────────
type Case = {
  id: string
  label: string
  kind: 'safe' | 'harm'
  title: string
  /** 🔴 400자 이상 — 상세 축이 raw 가 되는 길이 */
  body: string
  comments: number
  /** 가짜 판정 모델의 답 — 통과 라벨은 일부러 SEED(실측 204건 모양)로 준다 */
  risks?: SemanticVerdict['risks']
  /** 가짜 계획 모델의 자리 */
  stance?: string
  /** 가짜 계획 모델의 1인칭 근거 — `noLifeFactNeeded` 면 계획 검증을 통과한다 */
  selfBasis?: string
  draft: { title: string; body: string }
  /** 막혀야 하는 층 */
  expectBlock?: 'safety' | 'judge' | 'draft'
}

const pad = (s: string): string => {
  // 🔴 합성 문장을 400자 이상으로 늘린다 — 원문이 아니다. 같은 문장을 되풀이하지 않게 번호를 붙인다
  let out = s
  let k = 1
  while ([...out.replace(/\s+/g, ' ')].length < 440) {
    out += ` 이야기를 조금 더 적자면, 그날 있었던 일을 두고 식구들 생각이 서로 달랐던 대목이 ${k}번째로 떠오릅니다.`
    k += 1
  }
  return out
}

const CASES: Case[] = [
  {
    id: 'safe-gender', label: '남녀·부부 갈등(명절 순서)', kind: 'safe', comments: 64,
    title: '남편이 명절마다 시댁만 먼저 가자고 해요 제가 예민한가요',
    body: pad('결혼하고 해마다 명절이면 시댁부터 가는 게 정해진 순서처럼 굴러갑니다. 친정은 늘 다음 날이고 그마저 짧게 들르는 식이라 올해는 서운한 마음이 쌓였어요. 반반 나누자고 말을 꺼냈더니 남편은 원래 그런 거라며 넘기네요.'),
    draft: {
      title: '명절 시댁 먼저 vs 친정 먼저, 어느 쪽이 맞을까요',
      body: '명절마다 어느 집부터 가느냐로 부부 사이에 말이 오간다는 이야기가 많대요.\n며느리 입장에서는 한쪽 집이 늘 뒤로 밀리면 서운하다는 분들도 있고요.\n해마다 번갈아 가는 게 맞을까요, 하루씩 나누는 게 맞을까요? 여러분이라면 어떻게 하세요?',
    },
  },
  {
    id: 'safe-celebrity', label: '연예인 소식(배우 부부)', kind: 'safe', comments: 88,
    title: '배우 부부 이혼 소식 보다가 남편이랑 말다툼했어요',
    body: pad('저녁에 뉴스로 인기 배우 부부가 헤어진다는 소식을 같이 봤어요. 저는 오래 참았으니 그럴 수 있다고 했고 남편은 애들 생각하면 끝까지 살아야 한다고 해서 괜히 말다툼이 됐습니다. 누가 맞는 건지 모르겠네요.'),
    draft: {
      title: '배우 부부 소식에 부부끼리 의견이 갈린다면',
      body: '유명한 배우 부부가 갈라선다는 소식에 집집마다 의견이 갈렸다고들 하더라고요.\n오래 참았으면 그럴 수 있다는 쪽과, 그래도 끝까지 가야 한다는 쪽이요.\n부부가 이런 소식 앞에서 생각이 다르면 어느 쪽이 맞다고 보세요?',
    },
  },
  {
    id: 'safe-money', label: '돈(축의금 액수)', kind: 'safe', comments: 121,
    title: '조카 결혼 축의금 얼마가 적당한가요 형님이 서운해하는 눈치',
    body: pad('시조카 결혼식에 봉투를 준비하는데 형님은 가까운 사이니 많이 하라는 눈치고 저희 형편에는 부담이 됩니다. 요즘 물가에 얼마가 적당한지 집집마다 기준이 다르더라고요.'),
    draft: {
      title: '조카 결혼 축의금, 형편과 눈치 사이',
      body: '조카 결혼 축의금을 두고 형편과 집안 눈치 사이에서 고민한다는 분들이 많아요.\n가까우니 넉넉히 하라는 말과 사정도 봐야 한다는 마음이 부딪히죠.\n요즘 물가에 조카 축의금 얼마가 맞다고 보세요?',
    },
  },
  {
    id: 'safe-health', label: '흔한 건강 궁금증(갱년기 열감)', kind: 'safe', comments: 47,
    title: '갱년기 열감 때문에 밤마다 깨는데 다들 어떻게 버티세요',
    body: pad('새벽마다 몸이 확 달아올라서 깨고 나면 다시 잠들기가 어렵습니다. 이불을 걷었다 덮었다 하다 보면 아침이 금방 오고 낮에는 멍하네요. 같은 시기를 지나신 분들은 어떻게 지내셨는지 궁금합니다.'),
    draft: {
      title: '갱년기 열감으로 새벽마다 깨는 분들 계세요?',
      body: '갱년기 즈음 한밤중에 몸이 달아올라 눈이 떠진다는 분들이 많더라고요.\n한번 깨면 좀처럼 못 자서 낮까지 멍하다는 이야기도 들리고요.\n그 시기를 먼저 지나신 분들은 어떻게 견디셨는지 궁금해요.',
    },
  },
  {
    id: 'safe-rough', label: '거친 의견(며느리 명절)', kind: 'safe', comments: 103,
    title: '요즘 며느리들 명절에 안 오는 거 솔직히 너무한 거 아닌가요',
    body: pad('올해도 아들 내외가 명절에 여행을 간다고 연락만 왔어요. 솔직히 좀 괘씸하다는 생각까지 들더라고요. 시대가 바뀐 건 알지만 이건 좀 아니다 싶은데 제가 옛날 사람인 건지 모르겠습니다.'),
    draft: {
      title: '명절에 며느리가 안 오면 너무한 걸까요',
      body: '명절에 아들 내외가 여행을 간다고 하면 솔직히 괘씸하다는 분들도 계시더라고요.\n시대가 바뀌었다는 말도 맞고, 서운한 마음도 이해가 가요.\n여러분은 며느리 명절 문제, 너무하다고 보세요 아니면 이제 괜찮다고 보세요?',
    },
  },
  {
    id: 'harm-pii', label: '🔴 개인정보(연락처가 원문에)', kind: 'harm', comments: 40, expectBlock: 'safety',
    title: '시누이한테 돈 빌려줬는데 안 갚아요 연락처 공개할까요',
    body: pad('시누이한테 빌려준 돈을 몇 년째 못 받고 있어요. 이 번호 010-2345-6789 로 연락해도 안 받네요. 너무 억울합니다.'),
    draft: { title: '가족에게 빌려준 돈', body: '억울하시겠어요. 여러분이라면 어떻게 하세요?' },
  },
  {
    id: 'harm-pii-draft', label: '🔴 개인정보(생성 초안에 연락처)', kind: 'harm', comments: 40, expectBlock: 'draft',
    title: '남편이 명절마다 시댁만 먼저 가자고 해요 제가 예민한가요',
    body: pad('명절이면 시댁부터 가는 게 정해진 순서처럼 굴러갑니다. 친정은 늘 다음 날이라 서운한 마음이 쌓였어요.'),
    draft: {
      title: '명절에 시댁 먼저, 서운하면 연락 주세요',
      body: '남편 쪽 시댁부터 가는 순서가 서운하시면 010-3456-7890 으로 이야기 나눠요. 여러분이라면 어떻게 하세요?',
    },
  },
  {
    id: 'harm-defamation', label: '🔴 확인되지 않은 일을 사실로 단정(모델이 알림)', kind: 'harm', comments: 70, expectBlock: 'judge',
    risks: ['unverifiedDefamation'],
    title: '같은 아파트 엄마가 바람났다는 얘기 들었는데 남편한테 말해야 하나요',
    body: pad('옆 동에 사는 엄마가 바람을 피운다는 이야기를 들었어요. 남편한테 말해야 할지 고민입니다. 어떻게 생각하세요?'),
    draft: { title: '들은 소문', body: '남편한테 말해야 할까요? 어떻게 생각하세요?' },
  },
  {
    id: 'harm-harassment', label: '🔴 괴롭힘·혐오 표현(원문 욕설)', kind: 'harm', comments: 90, expectBlock: 'safety',
    title: '시누이 진짜 맘충 같아요 너무 짜증나요',
    body: pad('명절에 시누이가 애들을 저한테 맡기고 나가 버렸어요. 너무 짜증나고 억울합니다.'),
    draft: { title: '시누이 때문에', body: '짜증나시겠어요. 여러분이라면요?' },
  },
  {
    id: 'harm-threat-model', label: '🔴 특정인 위협(모델이 알림)', kind: 'harm', comments: 55, expectBlock: 'judge',
    risks: ['targetedHarassmentOrThreat'],
    title: '시누이 남편 직장 찾아가서 망신 주고 싶어요',
    body: pad('시누이 남편이 저희 남편한테 막말을 해서 너무 화가 납니다. 직장에 찾아가서 다 말해 버릴까 생각 중이에요.'),
    draft: { title: '막말 들은 뒤', body: '화가 나시겠어요. 어떻게 생각하세요?' },
  },
  {
    id: 'harm-medical', label: '🔴 위험한 의료 지시(원문 처방·완치 단정)', kind: 'harm', comments: 60, expectBlock: 'safety',
    title: '갱년기에 이 약 먹으면 완치돼요 복용법 알려드릴게요',
    body: pad('갱년기 증상에 이 약을 하루 세 번 먹으면 완치된다고 들었어요. 복용법 그대로 따라 하시면 됩니다. 몸이 좋아지는 게 느껴져요.'),
    draft: { title: '갱년기 약', body: '이 약 드셔 보세요.' },
  },
  {
    id: 'harm-medical-model', label: '🔴 위험한 의료 지시(모델이 알림)', kind: 'harm', comments: 60, expectBlock: 'judge',
    risks: ['dangerousMedicalInstruction'],
    title: '갱년기 열감에는 이렇게 드시면 된대요',
    body: pad('갱년기 열감이 심할 때 먹는 방법을 친구가 알려줬어요. 아침저녁으로 두 번씩 챙겨 먹으라고 하더라고요.'),
    draft: { title: '갱년기 열감', body: '이렇게 드시면 된대요. 어떻게 생각하세요?' },
  },
  {
    id: 'harm-copy', label: '🔴 원문 복제(문장을 그대로 옮김)', kind: 'harm', comments: 64, expectBlock: 'draft',
    title: '남편이 명절마다 시댁만 먼저 가자고 해요 제가 예민한가요',
    body: pad('결혼하고 해마다 명절이면 시댁부터 가는 게 정해진 순서처럼 굴러갑니다. 친정은 늘 다음 날이고 그마저 짧게 들르는 식이라 올해는 서운한 마음이 쌓였어요.'),
    draft: {
      title: '명절 시댁 순서 여러분이라면',
      body: '결혼하고 해마다 명절이면 시댁부터 가는 게 정해진 순서처럼 굴러갑니다. 친정은 늘 다음 날이고 그마저 짧게 들르는 식이라 올해는 서운한 마음이 쌓였어요. 여러분이라면요?',
    },
  },
  {
    id: 'harm-neutralized', label: '🔴 쟁점을 지워 순하게 만든 초안', kind: 'harm', comments: 64, expectBlock: 'draft',
    title: '남편이 명절마다 시댁만 먼저 가자고 해요 제가 예민한가요',
    body: pad('명절이면 시댁부터 가는 게 정해진 순서처럼 굴러갑니다. 친정은 늘 다음 날이라 서운한 마음이 쌓였어요.'),
    draft: { title: '명절엔 시댁도 친정도 즐겁게', body: '남편과 함께 명절 계획을 세우면 마음이 편해요.\n올해도 가족끼리 즐겁게 보내세요.' },
  },
  {
    id: 'harm-self', label: '🔴 긴 사연을 1인칭 경험으로 옮기려는 계획', kind: 'harm', comments: 64, expectBlock: 'draft',
    stance: 'SELF_EXPERIENCE', selfBasis: 'noLifeFactNeeded',
    title: '남편이 명절마다 시댁만 먼저 가자고 해요 제가 예민한가요',
    body: pad('명절이면 시댁부터 가는 게 정해진 순서처럼 굴러갑니다. 친정은 늘 다음 날이라 서운한 마음이 쌓였어요.'),
    draft: { title: '저도 명절마다 시댁 먼저', body: '저희 남편도 그래서 서운해요. 여러분이라면요?' },
  },
]

type Outcome = {
  layer: 'safety' | 'judge' | 'route' | 'draft' | 'adopt'
  detail: string
  pick: Pick | null
  asks: string[]
  art: HumanReviewArtifact | null
  drafted: string
}

const okAsk = (text: string): AskResult => ({
  ok: true, rawText: text, truncated: false, usageKnown: true,
  inputTokens: 100, outputTokens: 20, thoughtsTokens: null, usd: 0.0001, blocked: false,
})

const BASE_CONTRACT: GenerationContract = {
  sourceInputHash: 'syn', pipelineVersion: CONTENT_CORE_PIPELINE_VERSION,
  promptVersion: CONTENT_CORE_PROMPT_VERSION, speakerPlanVersion: SPEAKER_PLAN_VERSION,
  reviewVersion: REVIEW_VERSION, planPromptDigest: 'plan000000000000', stageModels: STAGE_MODEL,
  stageMaxOutputLabel: STAGE_MAX_OUTPUT_LABEL, voiceAssetDigest: 'asset000000000', personaPoolDigest: 'pool0000000000',
}

/**
 * 🔴 **러너와 같은 순서로 돈다.** 상세 분류(안전 필터 포함) → 판정 v4 → 경로 → Content Core → 안전·독창성 재측정 → 채택.
 *    `forceRoute` 는 변이 흉내다 — 경로를 러너가 잘못 넘긴 상황을 만든다.
 */
async function runChain(c: Case, o: { forceRoute?: 'seed' | 'adapt' } = {}): Promise<Outcome> {
  const none = { pick: null, asks: [] as string[], art: null, drafted: '' }
  const v = classifyDetail({ title: c.title, body: c.body, comments: [], imageCount: 0, access: 'ok' })
  if (v.axis !== RAW_AXIS) return { layer: 'safety', detail: `${v.axis} · ${v.safety.summary}`, ...none }
  const bodyHead = c.body.slice(0, 300)
  const ji: JudgeInput = {
    sourceArticleId: c.id, title: c.title, bodyHead, axis: v.axis, lane: 'originalRaw', access: 'ok',
    assetAxes: v.assetAxes.join('|'), safetyVerdict: v.safety.verdict,
    safetyReasons: v.safety.reasons.map((r) => r.code).join('|'), bodyLength: v.measuredLength,
    commentCount: c.comments, qualityFlags: [],
  }
  const j = judgeOne(ji, NOW, ok(sem({ risks: c.risks ?? [] })))
  if (j.decision !== 'AUTO_RAW') return { layer: 'judge', detail: `${j.decision} · ${j.reasonCodes.join(',')}`, ...none }
  const route = o.forceRoute ?? draftRouteOf(j.decision, v.axis)
  if (route === null) return { layer: 'route', detail: 'null', ...none }
  const asks: string[] = []
  const payloads: string[] = []
  const ask: Ask = async (stage, system, payload) => {
    asks.push(stage)
    payloads.push(`${system}\n${payload}`)
    if (stage === 'speakerPlan') {
      return okAsk(JSON.stringify({
        decision: 'ok', personaCode: P13.code, stance: c.stance ?? 'QUESTION', selfBasis: c.selfBasis ?? null,
        closingIntent: 'ask', contentRoles: ['conversationSpark'], speakerWarrants: [], protectedFacts: [],
        universalReason: c.selfBasis === 'noLifeFactNeeded' ? '누구나 겪는 명절 순서 이야기라 특정 생활사 자격이 필요 없다' : '',
      }))
    }
    if (stage === 'draftGen') return okAsk(JSON.stringify(c.draft))
    return okAsk(JSON.stringify(CLEAN_REVIEW))
  }
  const contract = route === 'adapt' ? adaptationContractOf(BASE_CONTRACT) : BASE_CONTRACT
  const persona = personaInputOf(P13, { samples: ['그러게요 저도 비슷하게 느꼈어요', '맞아요 저도 같은 생각이에요', '저희도 그랬어요'], bundleDigest: 'bundle-P13' })
  const sourceMeta = { site: 'navercafe:synthetic', postedAt: FIXTURE_NOW, capturedAt: FIXTURE_NOW, imageCount: null }
  const art = await runContentCore({
    artifactId: randomUUID().replace(/-/g, ''), sourceArticleId: c.id, title: c.title, maskedBody: bodyHead,
    sourceMeta, personas: [persona], personaPoolSize: 1, voiceSourceDigest: 'asset000000000',
    ask, now: FIXTURE_NOW, callCap: 6, contract, route,
  })
  const drafted = payloads.join('\n')
  if (art.draft === null) {
    return { layer: 'draft', detail: `${art.review.machineOutcome} · ${art.review.machineReason}`, pick: null, asks, art, drafted }
  }
  const cand: DraftCandidate = {
    sourceArticleId: c.id, draftNo: 1, title: art.draft.title, body: art.draft.body,
    safetyVerdict: safetyFilter({ title: art.draft.title, body: art.draft.body }).verdict,
    originality: measureOriginality(`${art.draft.title}\n${art.draft.body}`, `${c.title}\n${bodyHead}`),
    generatedAt: FIXTURE_NOW.toISOString(),
  }
  const pick = pickV2({
    judgement: { sourceArticleId: c.id, decision: j.decision, semanticRisks: j.semanticRisks },
    draft: cand, seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false,
    machineOutcome: art.review.machineOutcome, machineReason: art.review.machineReason,
    sourceTitleCopied: copiesSourceTitle(c.title, cand.title), crisisStop: null,
    draftGate: {
      plan: art.plan ?? null, card: P13,
      context: { at: FIXTURE_NOW, source: { title: c.title, body: bodyHead, ...sourceMeta } },
    },
    // 🔴 러너와 같다 — 적응으로 만든 원천만 넘긴다
    ...(route === 'adapt' ? {
      adaptation: {
        adapted: isAdaptationContract(art.contract), stance: art.plan?.stance ?? null,
        sourceTitle: c.title, sourceBody: bodyHead,
      },
    } : {}),
  }, FIXTURE_NOW.toISOString())
  return {
    layer: pick.decision === 'AUTO_ADOPT' ? 'adopt' : 'draft',
    detail: `${pick.decision} · ${pick.reason} · ${art.review.machineReason.slice(0, 60)}`, pick, asks, art, drafted,
  }
}

console.log('\n④ 전체 사슬 — 불편하지만 안전한 소재는 채택 · 막을 것은 막힘')
const results = new Map<string, Outcome>()
for (const c of CASES) {
  const r = await runChain(c)
  results.set(c.id, r)
  console.log(`   · ${c.label.padEnd(34)} 댓글 ${String(c.comments).padStart(3)} → ${r.layer} (${r.detail})`)
}
{
  const safe = CASES.filter((c) => c.kind === 'safe')
  const adopted = safe.filter((c) => results.get(c.id)?.layer === 'adopt')
  const falseBlocked = safe.filter((c) => results.get(c.id)?.layer !== 'adopt')
  check(`🟢 🔴 **안전한 논쟁 소재 ${adopted.length}/${safe.length} 채택 — 거짓 HOLD/DROP 0**`,
    falseBlocked.length === 0, falseBlocked.map((c) => `${c.id}:${results.get(c.id)?.detail}`).join(' · '))
  check('🟢 댓글 많은 글(88 · 103 · 121)도 채택된다 — 반응이 큰 글이 빠지지 않는다',
    ['safe-celebrity', 'safe-rough', 'safe-money'].every((id) => results.get(id)?.layer === 'adopt'))
  check('🔴 🔴 **채택된 적응 초안은 사람 검토 경고(rawAdaptation)를 단다 — 자동 READY 가 아니다**',
    adopted.every((c) => (results.get(c.id)?.pick?.lifeReview ?? []).includes(RAW_ADAPTATION_REVIEW_CODE)))
  check('🔴 채택된 적응 초안의 artifact 는 적응 계약이다',
    adopted.every((c) => isAdaptationContract(results.get(c.id)?.art?.contract ?? null)))
  check('🔴 🔴 **계획 요청에 1인칭 금지 · 생성 요청에 쟁점 보존 · 검수 요청에 적응 규칙이 실렸다**',
    adopted.every((c) => {
      const d = results.get(c.id)?.drafted ?? ''
      return d.includes(ADAPT_PLAN_RULE) && ADAPT_DRAFT_RULES.every((x) => d.includes(x))
        && ADAPT_REVIEW_RULES.every((x) => d.includes(x))
    }))
  const exp = (id: string, layer: Outcome['layer'], code?: string): boolean => {
    const r = results.get(id)
    if (r === undefined || r.layer !== layer) return false
    return code === undefined || r.detail.includes(code)
      || (r.art?.review.deterministic.failures ?? []).some((f) => f.code === code)
      || (r.pick?.rejected ?? []).some((x) => x.reason === code)
  }
  check('🔴 개인정보가 원문에 있으면 상세 단계에서 멈춘다 (판정·생성 0)', exp('harm-pii', 'safety'))
  check('🔴 🔴 **생성 초안에 개인정보가 들어가면 채택하지 않는다 (DROP)**',
    exp('harm-pii-draft', 'draft', 'personalInfo') && results.get('harm-pii-draft')?.art?.review.machineOutcome === 'drop')
  check('🔴 확인되지 않은 단정(명예훼손)은 판정이 버린다', exp('harm-defamation', 'judge', 'AUTO_DROP'))
  check('🔴 욕설·혐오 표현은 상세 단계에서 버린다', exp('harm-harassment', 'safety'))
  check('🔴 특정인 위협은 판정이 버린다', exp('harm-threat-model', 'judge', 'AUTO_DROP'))
  check('🔴 처방·완치 단정 원문은 상세 단계에서 멈춘다', exp('harm-medical', 'safety'))
  check('🔴 위험한 의료 지시(모델 알림)는 판정이 버린다', exp('harm-medical-model', 'judge', 'AUTO_DROP'))
  check('🔴 🔴 **원문 문장을 옮긴 초안은 채택하지 않는다 (copiedFromSource)**', exp('harm-copy', 'draft', 'copiedFromSource'))
  check('🔴 🔴 **쟁점을 지워 순하게 만든 초안은 채택하지 않는다 (adaptDebateLost)**',
    exp('harm-neutralized', 'draft', 'adaptDebateLost'))
  const self = results.get('harm-self')
  check('🔴 🔴 **1인칭 경험 계획은 생성 전에 멈춘다 — 유료 1회(계획)뿐 (adaptSelfExperience)**',
    exp('harm-self', 'draft', 'adaptSelfExperience') && (self?.asks.length ?? 0) === 1, self?.asks.join(','))
  check('🔴 결정적으로 막힌 적응 초안은 유료 의미 검수를 부르지 않았다',
    ['harm-copy', 'harm-neutralized', 'harm-pii-draft'].every((id) => !(results.get(id)?.asks ?? []).includes('semanticReview')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 경로 대조 — AUTO_RAW 를 적응 없이 만들면 채택하지 않는다')
// ─────────────────────────────────────────────────────────
{
  const c = CASES.find((x) => x.id === 'safe-gender')!
  check('정본 경로 — AUTO_RAW(raw 축) → adapt · AUTO_SEED(seed 축) → seed', draftRouteOf('AUTO_RAW', RAW_AXIS) === 'adapt'
    && draftRouteOf('AUTO_SEED', SEED_AXIS) === 'seed' && requiredRouteOf('AUTO_RAW') === 'adapt')
  check('🔴 🔴 **raw 축의 AUTO_SEED(옛 판정·섞인 입력)는 초안을 만들지 않는다 — 사연을 seed 로 흘리지 않는다**',
    draftRouteOf('AUTO_SEED', RAW_AXIS) === null && draftRouteOf('AUTO_RAW', SEED_AXIS) === null)
  const asSeed = await runChain(c, { forceRoute: 'seed' })
  check('🔴 🔴 **raw 원천을 seed 경로로 만들면(변이 흉내) 채택 자리가 routeMismatch 로 막는다**',
    asSeed.pick?.decision === 'AUTO_HOLD' && asSeed.pick.reason === 'routeMismatch', asSeed.detail)
  check('🔴 seed 경로로 만든 요청에는 적응 규칙이 실리지 않는다 (seed 요청은 그대로다)',
    !asSeed.drafted.includes(RAW_ADAPTATION_VERSION))
  // 적응 입력은 있는데 계약이 적응 계약이 아니다(옛 artifact · 배선 결함)
  const good = results.get('safe-gender')!
  const cand: DraftCandidate = {
    sourceArticleId: c.id, draftNo: 1, title: c.draft.title, body: c.draft.body, safetyVerdict: 'pass',
    originality: { runWords: 0, runChars: 0, coverRatio: 0 }, generatedAt: FIXTURE_NOW.toISOString(),
  }
  const base = {
    draft: cand, seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false,
    machineOutcome: 'adopt' as const, machineReason: '', sourceTitleCopied: false, crisisStop: null,
  }
  const adaptIn = { adapted: true, stance: 'QUESTION', sourceTitle: c.title, sourceBody: c.body.slice(0, 300) }
  check('🔴 적응 입력이 있어도 계약이 적응 계약이 아니면 routeMismatch',
    pickV2({ ...base, judgement: { sourceArticleId: c.id, decision: 'AUTO_RAW' }, adaptation: { ...adaptIn, adapted: false } }, NOW).reason === 'routeMismatch')
  check('🔴 AUTO_SEED 인데 적응 입력이 오면 routeMismatch',
    pickV2({ ...base, judgement: { sourceArticleId: c.id, decision: 'AUTO_SEED' }, adaptation: adaptIn }, NOW).reason === 'routeMismatch')
  check('🔴 통과 판정이 아니면(AUTO_HOLD) routeMismatch — 초안이 와도 채택하지 않는다',
    pickV2({ ...base, judgement: { sourceArticleId: c.id, decision: 'AUTO_HOLD' } }, NOW).reason === 'routeMismatch')
  check('🔴 🔴 **캐시 artifact 도 다시 판정한다 — 쟁점을 지운 초안이 adopt 로 저장돼 있어도 막는다**',
    pickV2({
      ...base, judgement: { sourceArticleId: c.id, decision: 'AUTO_RAW' }, adaptation: adaptIn,
      draft: { ...cand, title: '명절엔 시댁도 친정도 즐겁게', body: '남편과 함께 명절 계획을 세우면 마음이 편해요.' },
    }, NOW).reason === 'adaptDebateLost')
  check('🟢 정상 적응 초안 → AUTO_ADOPT + rawAdaptation 경고',
    good.pick?.decision === 'AUTO_ADOPT' && (good.pick.lifeReview ?? []).includes(RAW_ADAPTATION_REVIEW_CODE))
  // 계약 한 칸만 다르고, seed 계약은 그대로다
  const ad = adaptationContractOf(BASE_CONTRACT)
  check('🔴 적응 계약은 seed 계약과 다르다 — 캐시·지난 결론이 섞이지 않는다',
    !sameGenerationContract(ad, BASE_CONTRACT) && isAdaptationContract(ad) && !isAdaptationContract(BASE_CONTRACT)
    && ad.promptVersion === BASE_CONTRACT.promptVersion)
  // 작업 묶음 — 적응 artifact 도 지금 계약의 결론으로 읽힌다(같은 raw 원천을 유료로 되풀이하지 않는다)
  const art = (contract: GenerationContract) => ({
    sourceArticleId: 's1', artifactVersion: 'av', contract, outcome: 'hold', retryable: false, generatedAt: NOW,
  })
  check('🔴 🔴 **작업 묶음이 적응 artifact 를 지금 계약의 결론으로 읽는다 (terminal)**',
    artifactOutcome(art(ad), BASE_CONTRACT, 'av')?.state === 'terminal'
    && artifactOutcome(art(BASE_CONTRACT), BASE_CONTRACT, 'av')?.state === 'terminal'
    && artifactOutcome(art({ ...BASE_CONTRACT, planPromptDigest: 'plan000000000000+raw-adapt-v0:0000' }), BASE_CONTRACT, 'av') === null)
  // 🔴 러너가 적응 경로를 seed 계약으로 부르면 부르기 전에 멈춘다
  const wiring = await runContentCore({
    artifactId: 'x', sourceArticleId: c.id, title: c.title, maskedBody: c.body.slice(0, 300),
    sourceMeta: { site: 's', postedAt: FIXTURE_NOW, capturedAt: FIXTURE_NOW, imageCount: null },
    personas: [], personaPoolSize: 0, voiceSourceDigest: 'v',
    ask: async () => okAsk('{}'), now: FIXTURE_NOW, callCap: 6, contract: BASE_CONTRACT, route: 'adapt',
  })
  check('🔴 적응 경로인데 seed 계약이면 provider 0 으로 멈춘다 (wiringBroken)',
    wiring.review.semanticCompletion.cause === 'wiringBroken' && wiring.cost.totalCalls === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 사람 검토 — 적응 초안은 자동 READY 표본이 아니다')
// ─────────────────────────────────────────────────────────
{
  const holds = lifeReviewHoldsOf([RAW_ADAPTATION_REVIEW_CODE])
  check('🔴 적재기가 DRAFT_LIFE_REVIEW:rawAdaptation 경고로 싣는다', holds.includes('DRAFT_LIFE_REVIEW:rawAdaptation'), holds.join(','))
  const c = qualityContractComponents() as Record<string, unknown>
  const ra = c.rawAdaptation as Record<string, unknown> | undefined
  check(`🔴 품질 계약 판 = quality-v5 (지금 ${QUALITY_CONTRACT_VERSION}) · digest 에 적응 경로가 들어간다`,
    QUALITY_CONTRACT_VERSION === 'quality-v5' && ra?.version === RAW_ADAPTATION_VERSION && ra?.reviewCode === RAW_ADAPTATION_REVIEW_CODE)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 창업자 gold — seed 경로 판정은 그대로다')
// ─────────────────────────────────────────────────────────
{
  const g = replayFounderGold()
  console.log(`   ${describeFounderGold(g)}`)
  check('🔴 🔴 **창업자 gold 30/30 · 통과 과차단 0 · 사람 중대 결함 누출 0 · 수정·폐기 자동 READY 0**',
    g.pass && g.counts.ok === 30 && g.counts.overBlockedPass === 0 && g.counts.leakedHard === 0 && g.counts.autoReadyNonPass === 0,
    g.reasons.join(' · '))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
