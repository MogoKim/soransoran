#!/usr/bin/env tsx
/**
 * Content Core v2 행동 검사 — 🔴 **네트워크 0 · 실제 provider 0 · DB 0**
 *
 * 🔴 **정규식이 있는지 세지 않는다.** 실제 함수를 돌려 나온 `HumanReviewArtifact`
 *    값으로 본다. 통과 수는 제품 성공이 아니다 — 이 검사가 증명하는 것은
 *    **경로가 계약대로 도는가** 하나뿐이다.
 *
 * 🔴 **못 하는 것**: 실제 모델이 재미있는 글을 쓰는가. 가짜 provider 는 정해진
 *    답을 돌려준다. 그것은 사람 blind 평가와 유료 실측으로만 확인된다.
 */
import { existsSync, readFileSync } from 'node:fs'

import { runContentCore, type Ask, type AskResult, type PersonaInput }
  from './lib/content-core-run.mjs'
import { isContentCoreV2Enabled, CONTENT_CORE_V2_ENV, CONTENT_CORE_V2_FLAG_REMOVE_AT }
  from '../src/lib/content-core/flag'
import { EVIDENCE_CHAR_BUDGET } from '../src/lib/content-core/evidence'
import { violatesArtifact, artifactSummary, type HumanReviewArtifact }
  from '../src/lib/content-core/artifact'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : ` — ${extra}`}`) }
}
const NOW = new Date('2026-09-19T10:00:00.000Z')

// ── 가짜 provider ─────────────────────────────────────────
type Canned = { essence?: unknown; draft?: unknown; review?: unknown; age?: unknown }
type Fault = { truncate?: Ask extends never ? never : string; blocked?: string; usageUnknown?: string }
const okRes = (text: string): AskResult => ({
  ok: true, rawText: text, truncated: false, usageKnown: true,
  inputTokens: 100, outputTokens: 20, usd: 0.0001, blocked: false,
})
const fakeAsk = (c: Canned, fault: { truncate?: string; blocked?: string; usageUnknown?: string } = {}): Ask =>
  async (stage) => {
    if (fault.blocked === stage) {
      return { ok: false, rawText: '', truncated: false, usageKnown: false, inputTokens: null, outputTokens: null, usd: null, blocked: true }
    }
    if (fault.truncate === stage) return { ...okRes(''), truncated: true }
    if (fault.usageUnknown === stage) return { ...okRes(pick(c, stage)), usageKnown: false, inputTokens: null, outputTokens: null, usd: null }
    return okRes(pick(c, stage))
  }
const pick = (c: Canned, stage: string): string => JSON.stringify(
  stage === 'essence' ? c.essence ?? {}
    : stage === 'draftGen' ? c.draft ?? {}
      : stage === 'semanticReview' ? c.review ?? { issues: [], confidence: 0.9, note: '' }
        : c.age ?? { conflict: false, evidence: '' })

// ── 합성 Persona ──────────────────────────────────────────
const P = (o: Partial<PersonaInput> & { code: string }): PersonaInput => ({
  code: o.code, spouse: o.spouse, children: o.children, childAgeBands: o.childAgeBands,
  parentCare: o.parentCare, menopause: o.menopause, work: o.work ?? null, region: o.region ?? null,
  ageBand: o.ageBand ?? '40대 후반',
  voiceCore: o.voiceCore ?? '짧은 문장 · ~해요 기본',
  samples: o.samples ?? ['그러게요 저도 비슷하게 느꼈어요', '맞아요 저도 같은 생각이에요'],
  bundleDigest: o.bundleDigest ?? 'bundle0000000000',
})
const 전업 = P({ code: 'P02', spouse: true, children: 1, work: '전업', region: '광역시' })
const 파트타임 = P({ code: 'P01', spouse: true, children: 2, childAgeBands: ['중고생'], work: '파트타임', region: '수도권' })
const 무자녀 = P({ code: 'P04', spouse: true, children: 0, work: '회사원', region: '수도권' })
const ALL = [파트타임, 전업, 무자녀]

const run = (o: {
  id: string; title: string; body: string; canned: Canned
  personas?: readonly PersonaInput[]
  fault?: { truncate?: string; blocked?: string; usageUnknown?: string }
  cap?: number
}): Promise<HumanReviewArtifact> => runContentCore({
  sourceArticleId: o.id, title: o.title, maskedBody: o.body,
  personas: o.personas ?? ALL, voiceSourceDigest: 'asset000000000',
  ask: fakeAsk(o.canned, o.fault), now: NOW, callCap: o.cap ?? 6,
})

const anchor = (kind: string, text: string, preserve = 'semantic', ref = 'head'): unknown =>
  ({ kind, text, preserve, evidenceRef: ref })

console.log('\n══ Content Core v2 행동 검사 (🔴 네트워크 0 · provider 0 · DB 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('⓪ 스위치 — 🔴 기본은 꺼짐. 운영 경로가 바뀌지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 아무것도 안 주면 꺼져 있다', !isContentCoreV2Enabled({}))
  check('🔴 모르는 값도 꺼진 것이다', !isContentCoreV2Enabled({ [CONTENT_CORE_V2_ENV]: '1' }))
  check('🟢 "true" 하나만 켠다', isContentCoreV2Enabled({ [CONTENT_CORE_V2_ENV]: 'true' }))
  check('🔴 스위치에 지울 마일스톤이 박혀 있다', CONTENT_CORE_V2_FLAG_REMOVE_AT === 'M5')
}

const results: { name: string; a: HumanReviewArtifact }[] = []
const record = (name: string, a: HumanReviewArtifact): HumanReviewArtifact => {
  results.push({ name, a }); return a
}

// ─────────────────────────────────────────────────────────
console.log('\n① 짧지만 완결된 일상글 — 🔴 없는 갈등을 만들지 않고 짧게 완주')
// ─────────────────────────────────────────────────────────
{
  const a = record('①', await run({
    id: 'S1', title: '오늘 아침에 처음으로 김장 김치를 꺼냈어요',
    body: '아직 좀 이른가 싶었는데 그냥 꺼냈습니다. 맛은 괜찮네요.',
    canned: {
      essence: {
        coreMoment: '올해 첫 김장 김치를 이르게 꺼내 먹은 이야기',
        anchors: [anchor('situation', '김장 김치'), anchor('emotion', '괜찮네요', 'semantic', 'head')],
        participationHook: '', participationConfidence: 0.4,
        closingIntent: 'share', timeSensitivity: 'timeBound',
        contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '김장 김치 벌써 꺼내신 분', body: '올해는 좀 이른가 싶었는데 그냥 열어 봤어요. 생각보다 맛이 들었더라고요.' },
    },
  }))
  check('🔴 짧은 글도 끝까지 갔다 (초안이 나왔다)', a.draft !== null)
  check('🔴 없는 갈등·질문을 만들지 않았다',
    a.essence?.claimRequirements.length === 0 && a.essence?.participationHook === null)
  check('🔴 원문 흐름이 통째로 근거에 남았다 (짧은 글은 안 자른다)',
    !a.evidence.truncated && a.evidence.spans.filter((s) => s.kind === 'tail').length === 0)
  check('🔴 기계 판정이 나왔고 사람 칸은 비어 있다',
    a.review.machineOutcome === 'adopt' && a.humanDecision.verdict === null)
  check('🔴 정상 경로 호출 4회 (판정1 · 생성1 · 검수1 · 나이1)', a.cost.totalCalls === 4, `${a.cost.totalCalls}회`)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 사진·앞 대화가 있어야 아는 글 — 🔴 생성 0')
// ─────────────────────────────────────────────────────────
{
  const a = record('②', await run({
    id: 'S2', title: '이거 어떤가요', body: '아래 사진 보시고 알려주세요. 지난 글에 이어서요.',
    canned: { draft: { title: 'x', body: 'y' } },
  }))
  check('🔴 무슨 이야기인지 확인 못 함으로 섰다', a.evidence.contextSufficiency === 'insufficient')
  check('🔴 사진·앞 글 두 가지를 다 짚었다',
    a.evidence.insufficientReasons.includes('needsImage')
    && a.evidence.insufficientReasons.includes('needsPriorThread'))
  check('🔴 🔴 **유료 호출 0회** — 묻기 전에 멈췄다', a.cost.totalCalls === 0, `${a.cost.totalCalls}회`)
  check('🔴 초안을 만들지 않았다', a.draft === null)
  check('🔴 adopt 가 아니다', a.review.machineOutcome === 'hold')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 핵심 질문이 끝에 있는 긴 글 — 🔴 꼬리로 보존')
// ─────────────────────────────────────────────────────────
{
  const long = `${'서론이 길게 이어집니다. '.repeat(30)}그래서 다들 어떻게 하시는지 궁금해요?`
  const a = record('③', await run({
    id: 'S3', title: '요즘 고민이 하나 있어서요', body: long,
    canned: {
      essence: {
        coreMoment: '길게 적은 고민 끝에 다들 어떻게 하는지 묻는 글',
        anchors: [anchor('participationIntent', '다들 어떻게 하시는지', 'semantic', 'tail')],
        participationHook: '다들 어떻게 하시는지', participationConfidence: 0.8,
        closingIntent: 'ask', timeSensitivity: 'evergreen',
        contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '다들 이럴 때 어떻게 하세요', body: '한참 혼자 생각하다가 여기 여쭤봅니다. 어떻게들 하시는지 궁금해요.' },
    },
  }))
  const tail = a.evidence.spans.find((s) => s.kind === 'tail')
  check('🔴 긴 글은 머리·꼬리로 잘렸다', a.evidence.truncated && tail !== undefined)
  check('🔴 🔴 **끝의 질문이 꼬리 근거에 남았다**', (tail?.text ?? '').includes('궁금해요'))
  check('🔴 머리와 꼬리가 겹치지 않는다', (() => {
    const h = a.evidence.spans.find((s) => s.kind === 'head')!
    return h.toRatio <= (tail?.fromRatio ?? 1)
  })())
  check(`🔴 근거 총량이 예산 ${EVIDENCE_CHAR_BUDGET}자 안이다`,
    a.evidence.bodyEvidenceChars <= EVIDENCE_CHAR_BUDGET, `${a.evidence.bodyEvidenceChars}자`)
  check('🔴 버린 가운데를 비율로 남겼다', a.evidence.omittedRatio > 0)
  check('🔴 꼬리 근거가 있으니 만들었다', a.draft !== null)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 숫자가 있는 실용 질문 — 🔴 exact / semantic 을 가른다')
// ─────────────────────────────────────────────────────────
{
  const canned = (draftBody: string): Canned => ({
    essence: {
      coreMoment: '직원 9명인 곳에서 여행 선물을 사야 하는지 묻는 글',
      anchors: [
        anchor('number', '9명', 'exact', 'head'),
        anchor('discoverabilityTerm', '선물', 'exact', 'title'),
        anchor('situation', '여행', 'semantic', 'title'),
      ],
      participationHook: '사야 하나 말아야 하나', participationConfidence: 0.9,
      closingIntent: 'ask', timeSensitivity: 'evergreen',
      contentRoles: ['usefulAnswer', 'conversationSpark'], claimRequirements: [],
    },
    draft: { title: '여행 선물 다들 사오세요', body: draftBody },
  })
  const keep = record('④', await run({
    id: 'S4', title: '여행 다녀오면 선물하나요', body: '직원이 9명 정도 되는데 다들 사오시나요.',
    canned: canned('직원이 9명이라 한 명씩 챙기면 부담이 큽니다. 다들 어떻게 하세요.'),
  }))
  check('🔴 exact 숫자를 지키면 통과한다', keep.review.deterministic.pass)
  const lost = await run({
    id: 'S4b', title: '여행 다녀오면 선물하나요', body: '직원이 9명 정도 되는데 다들 사오시나요.',
    canned: canned('사람이 꽤 많아서 한 명씩 챙기면 부담이 큽니다. 다들 어떻게 하세요.'),
  })
  check('🔴 🔴 **exact 숫자를 지우면 잡는다**',
    !lost.review.deterministic.pass
    && lost.review.deterministic.failures.some((f) => f.code === 'exactAnchorAltered'))
  check('🔴 semantic 은 글자 그대로를 요구하지 않는다',
    !lost.review.deterministic.failures.some((f) => f.detail.includes('여행')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 1인칭 직업 경험 — 🔴 자격 있는 사람 또는 HOLD')
// ─────────────────────────────────────────────────────────
{
  const claim = { fact: 'work', detail: '파트타임으로 일하는 사람의 경험', stanceShiftable: false }
  const essence = {
    coreMoment: '파트타임으로 일하며 겪은 일',
    anchors: [anchor('situation', '일하는')],
    participationHook: '', participationConfidence: 0.5,
    closingIntent: 'share', timeSensitivity: 'evergreen',
    contentRoles: ['experienceResonance'], claimRequirements: [claim],
  }
  const ok = record('⑤', await run({
    id: 'S5', title: '파트타임 일하면서 느낀 거', body: '오전에만 나가는데 이런 점이 좋더라고요.',
    canned: { essence, draft: { title: '오전만 나가는 일', body: '오전에만 나가니 오후가 통으로 남더라고요.' } },
  }))
  check('🔴 자격 있는 사람이 있으면 내 경험으로 쓴다',
    ok.speaker.personaCode === 'P01' && ok.speaker.stance === 'SELF_EXPERIENCE')
  const hold = await run({
    id: 'S5b', title: '파트타임 일하면서 느낀 거', body: '오전에만 나가는데 이런 점이 좋더라고요.',
    canned: { essence, draft: { title: 'x', body: 'y' } },
    personas: [전업],
  })
  check('🔴 🔴 **자격 없고 자리도 못 낮추면 HOLD**', hold.review.machineOutcome === 'hold' && hold.draft === null)
  check('🔴 coverageGap 을 남겼다 — 어떤 사람이 없었는지', (() => {
    const g = hold.speaker.coverageGap
    return g !== null && g.why === 'coreIsOwnExperience' && g.missing.some((m) => m.fact === 'work')
  })())
  check('🔴 🔴 **아무나 배정하지 않았다** (v1 fallback 금지)', hold.speaker.personaCode === null)
  check('🔴 생성 호출까지 가지 않았다', hold.cost.calls.every((c) => c.stage !== 'draftGen'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 관찰로 바꿀 수 있는 소재 — 🔴 자리를 낮춰 완주')
// ─────────────────────────────────────────────────────────
{
  const a = record('⑥', await run({
    id: 'S6', title: '아들 낳으면 왜 안쓰럽게 보는지', body: '주위에서 그런 시선 많이 보셨나요.',
    canned: {
      essence: {
        coreMoment: '아들 엄마를 안쓰럽게 보는 시선에 대한 이야기',
        anchors: [anchor('contrast', '안쓰럽게')],
        participationHook: '그런 시선 보셨나요', participationConfidence: 0.8,
        closingIntent: 'ask', timeSensitivity: 'evergreen',
        contentRoles: ['conversationSpark', 'experienceResonance'],
        claimRequirements: [{ fact: 'children', detail: '아들을 키우는 사람의 경험', stanceShiftable: true }],
      },
      draft: { title: '그런 시선 겪어보셨어요', body: '주위에서 안쓰럽게 보는 말 들었다는 얘기를 들었어요. 다들 어떠세요.' },
    },
    personas: [무자녀],
  }))
  check('🔴 자격이 없어도 버리지 않았다', a.draft !== null)
  check('🔴 🔴 자리를 낮췄다 (내 경험이 아니다)',
    a.speaker.stance !== null && a.speaker.stance !== 'SELF_EXPERIENCE', String(a.speaker.stance))
  check('🔴 묻는 글이었으므로 질문 자리로 갔다', a.speaker.stance === 'QUESTION')
  check('🔴 못 채운 주장을 남겨 생성이 1인칭으로 못 쓰게 했다',
    a.speaker.unmetClaims.some((c) => c.fact === 'children'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 공개 고유명 · 시의성 — 🔴 이름과 TTL 보존')
// ─────────────────────────────────────────────────────────
{
  const a = record('⑦', await run({
    id: 'S7', title: '어제 그 프로그램 보셨어요', body: '나는솔로 마지막 회 보고 한참 생각했네요.',
    canned: {
      essence: {
        coreMoment: '나는솔로 마지막 회를 보고 든 생각',
        anchors: [anchor('publicEntity', '나는솔로', 'exact', 'head')],
        participationHook: '보신 분 계세요', participationConfidence: 0.7,
        closingIntent: 'ask', timeSensitivity: 'timeBound',
        contentRoles: ['discoveryAnchor', 'conversationSpark'], claimRequirements: [],
      },
      draft: { title: '나는솔로 마지막 회 보신 분', body: '어젯밤에 보고 한참 앉아 있었어요. 보신 분 계세요.' },
    },
  }))
  check('🔴 고유명이 exact 로 살아 있다', a.review.deterministic.pass)
  check('🔴 🔴 시의성이 artifact 에 남았다 (TTL 판단 근거)', a.essence?.timeSensitivity === 'timeBound')
  check('🔴 검색 유입 역할이 기록됐다', a.essence?.contentRoles.includes('discoveryAnchor') === true)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 말투 참고의 사건을 자기 경험으로 가져옴 — 🔴 HOLD')
// ─────────────────────────────────────────────────────────
{
  const 누수 = P({
    code: 'P09', spouse: true, children: 1, work: '전업',
    samples: ['지난주에 시어머니 병원 모시고 다녀왔어요', '그러게요 저도 비슷했어요'],
  })
  const a = record('⑧', await run({
    id: 'S8', title: '요즘 날이 부쩍 차네요', body: '아침에 창문 열었다가 놀랐어요.',
    canned: {
      essence: {
        coreMoment: '아침 공기가 갑자기 차가워진 이야기',
        anchors: [anchor('situation', '창문')],
        participationHook: '', participationConfidence: 0.3,
        closingIntent: 'share', timeSensitivity: 'timeBound',
        contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      // 🔴 참고에만 있던 사건(시어머니 · 병원)을 자기 일로 가져왔다
      draft: { title: '아침 공기가 달라졌어요', body: '창문 열다 놀랐네요. 지난주 시어머니 병원 모시고 갔을 때랑 또 다르더라고요.' },
    },
    personas: [누수],
  }))
  check('🔴 🔴 **말투 참고의 사건을 가져온 것을 잡았다**',
    a.review.deterministic.failures.some((f) => f.code === 'voiceContentLeak'),
    JSON.stringify(a.review.deterministic.failures))
  check('🔴 adopt 가 아니다', a.review.machineOutcome === 'hold')
  check('🔴 무엇을 가져왔는지 근거가 남았다',
    (a.review.deterministic.failures.find((f) => f.code === 'voiceContentLeak')?.detail ?? '').length > 0)
  check('🔴 말투 출처가 artifact 에 남았다', a.voice.provenance?.personaCode === 'P09')
  check('🔴 사람이 blind 로 볼 항목이 있다', a.voice.blindCheckPoints.length >= 3)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 소재가 사라진 일반 글 — 🔴 사람에게 넘긴다')
// ─────────────────────────────────────────────────────────
{
  const a = record('⑨', await run({
    id: 'S9', title: '여행 다녀오면 선물하나요', body: '직원이 9명 정도 되는데 다들 사오시나요.',
    canned: {
      essence: {
        coreMoment: '직원 9명인 곳에서 여행 선물을 사야 하는지 묻는 글',
        anchors: [anchor('situation', '선물', 'semantic', 'title')],
        participationHook: '사야 하나', participationConfidence: 0.9,
        closingIntent: 'ask', timeSensitivity: 'evergreen',
        contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '요즘 누구랑 가장 자주 이야기하세요', body: '문득 그런 생각이 들어서 여쭤봅니다. 다들 어떠세요.' },
      // 🔴 의미 검수가 소재 소실을 말한다
      review: { issues: ['sourceFidelity'], confidence: 0.8, note: '어떤 원문을 읽고 썼는지 알 수 없다' },
    },
  }))
  check('🔴 🔴 **소재가 사라지면 adopt 가 아니다**', a.review.machineOutcome === 'hold')
  check('🔴 사유가 남았다', a.review.machineReason.includes('sourceFidelity'))
  check('🔴 사람 판정 칸은 비어 있다 — 기계가 READY 라고 하지 않는다',
    a.humanDecision.verdict === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 미완주 검수 — 🔴 잘림·차단·사용량 미상은 통과가 아니다')
// ─────────────────────────────────────────────────────────
{
  const base = {
    id: 'S10', title: '오늘 아침 김치 꺼냈어요', body: '맛은 괜찮네요.',
    canned: {
      essence: {
        coreMoment: '김치를 이르게 꺼낸 이야기', anchors: [anchor('situation', '김치')],
        participationHook: '', participationConfidence: 0.4, closingIntent: 'share',
        timeSensitivity: 'timeBound', contentRoles: ['conversationSpark'], claimRequirements: [],
      },
      draft: { title: '벌써 꺼냈어요', body: '좀 이른가 싶었는데 열어 봤어요. 맛은 들었더라고요.' },
    },
  }
  for (const [label, fault, reason] of [
    ['검수 답이 잘림', { truncate: 'semanticReview' }, 'truncated'],
    ['검수가 예산에 막힘', { blocked: 'semanticReview' }, 'budgetBlocked'],
    ['검수 사용량 미상', { usageUnknown: 'semanticReview' }, 'usageUnknown'],
    ['나이 검수 잘림', { truncate: 'ageCheck' }, 'truncated'],
  ] as const) {
    const a = await run({ ...base, fault })
    const c = reason === 'truncated' && 'truncate' in fault && fault.truncate === 'ageCheck'
      ? a.review.ageCompletion : a.review.semanticCompletion
    check(`🔴 ${label} → adopt 아님`, a.review.machineOutcome !== 'adopt', a.review.machineOutcome)
    check(`   ↳ 사유가 남았다 (${reason})`, c.reason === reason || a.review.ageCompletion.reason === reason)
  }
  const capped = await run({ ...base, cap: 2 })
  check('🔴 원천별 상한에 걸리면 adopt 아님', capped.review.machineOutcome !== 'adopt')
  check('🔴 상한을 넘겨 부르지 않았다', capped.cost.totalCalls <= 2, `${capped.cost.totalCalls}회`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ artifact 계약 — 🔴 담으면 안 되는 것이 없다')
// ─────────────────────────────────────────────────────────
{
  for (const { name, a } of results) {
    const bad = violatesArtifact(a)
    check(`${name} artifact 가 계약을 지킨다`, bad.length === 0, bad.join(' / '))
  }
  const one = results.find((r) => r.name === '④')!.a
  check('🔴 사람이 읽을 요약이 나온다', artifactSummary(one).includes('S4'))
  check('🔴 비용 칸이 채워졌다', one.cost.totalCalls > 0 && one.cost.totalUsd !== null)
  check('🔴 🔴 원문 전문을 담지 않는다 — 근거는 예산 안이다',
    results.every((r) => r.a.evidence.bodyEvidenceChars <= EVIDENCE_CHAR_BUDGET))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ v1/v2 경계 — 🔴 옛 경로가 새 경로로 새지 않는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **이것만 소스 검사다.** import 관계는 실행으로 못 잰다 —
   *    v1 계약이 새어 들어오는 것은 돌려 봐야 알 수 없고, 새고 나면 늦다.
   */
  const files = [
    'scripts/lib/content-core-run.mts', 'scripts/lib/content-core-prompts.mts',
    'src/lib/content-core/evidence.ts', 'src/lib/content-core/essence.ts',
    'src/lib/content-core/speaker.ts', 'src/lib/content-core/voice-evidence.ts',
    'src/lib/content-core/review.ts', 'src/lib/content-core/artifact.ts',
    'src/lib/content-core/flag.ts',
  ]
  /** 🔴 v2 가 v1 에서 가져와도 되는 것 — 저장소에 한 벌이어야 하는 안전 정본만 */
  const ALLOWED = new Set(['hasBannedWord', 'BANNED_WORDS'])
  const FORBIDDEN = [
    'readSourceProfile', 'expandSeed', 'MAX_DRAFTS_PER_SOURCE',
    'buildGenSystemPrompt', 'buildQualitySystemPrompt', 'buildAgeCheckSystemPrompt',
    'DRAFT_QUALITY_AXES', 'pickDraft', 'generateWithRetries',
  ]
  /**
   * 🔴 **주석을 지우고 본다.** 계약은 **코드**가 지키는 것이고, 주석은
   *    "쓰지 않는다" 를 설명하느라 그 이름을 적을 수밖에 없다.
   *    앞서 이 검사가 주석까지 세어 제 설명을 위반으로 잡았다.
   */
  const srcOf = (f: string): string => readFileSync(f, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const name of FORBIDDEN) {
    const hit = files.filter((f) => new RegExp(`\\b${name}\\b`).test(srcOf(f)))
    check(`🔴 v2 가 \`${name}\` 을 쓰지 않는다`, hit.length === 0, hit.join(', '))
  }
  const imported = files.flatMap((f) => {
    const m = srcOf(f).match(/import\s*\{([^}]*)\}\s*from\s*'[^']*micro-seed-auto-draft'/g) ?? []
    return m.flatMap((x) => (x.match(/\{([^}]*)\}/)?.[1] ?? '').split(',').map((w) => w.replace(/\btype\b/, '').trim()))
  }).filter((x) => x !== '')
  check('🔴 🔴 v1 에서 가져오는 것이 허용 목록 안이다',
    imported.every((x) => ALLOWED.has(x)), imported.filter((x) => !ALLOWED.has(x)).join(', '))
  check('🟢 v1 러너는 그대로 있다 (되돌릴 수 있다)', existsSync('scripts/micro-seed-auto-draft.mts'))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델이 재미있는 글을 쓰는지는 증명하지 않았다.')
console.log('🔴 통과 수는 제품 성공이 아니다. 사람 READY 판정은 아직 0건이다.')
if (fail > 0) process.exit(1)
