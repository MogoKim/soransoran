#!/usr/bin/env tsx
/**
 * 기계 초안 채택 fixture — 🔴 **사람의 ADOPT 를 사칭하지 않는다** (§4-AS)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { digest16, PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { readFileSync } from 'node:fs'
import {
  pickDraft, pickV2, checkDraft, summarizeDrafts, violatesDraftProvenance,
  hasBannedWord, normalize, echoesTitleAtEnd,
  AUTO_DRAFT_DECISIONS, HUMAN_DRAFT_DECISIONS, HUMAN_DRAFT_PROVENANCE,
  DRAFT_RULE_VERSION, DRAFT_PROVENANCE, BANNED_WORDS,
  BLOCKING_RISKS, DRAFT_REASON_LABEL, judgeSourceGate, judgeDraftGate,
  type DraftCandidate, type PickInput,
} from '../src/lib/micro-seed-auto-draft'
import { measureOriginality, judgeCopy, COPY_RUN_WORDS } from '../src/lib/draft-originality'
import { parseAgeBand, judgeSelfAgeConflict } from '../src/lib/persona-self-age'
import {
  judgeCrisisSignal, judgeMedicalDecisionRequest, judgeHealthEfficacyClaim,
  judgeSafetySignals, SAFETY_SIGNAL_CODES,
} from '../src/lib/micro-seed-safety-signals'
import { SEMANTIC_RISKS, SEMANTIC_HOLD, DRAFT_HARM_AXES } from '../src/lib/micro-seed-auto-judge'
import { SEMANTIC_DROP } from '../src/lib/micro-seed-auto-judge'
import {
  callBudgetOf, CallBudget, HARM_BANS, MAX_ORIGINALITY_RETRIES,
  CALL_ALLOWANCE_PER_SOURCE, HARM_PROMPT, V2_CALL_CAP, V2_LEDGER_STAGE,
} from './micro-seed-auto-draft.mjs'
import {
  readSourceProfile, readClosingIntent, readTitleIntent, endsNaturallyAsQuestion,
} from './lib/source-profile'
import { PRODUCTION_PERSONA_CODES, isProductionPersonaCode } from '../src/lib/persona-cohort'
// 🔴 Persona 정체성의 정본은 카드 문서다 — fixture 도 그것을 본다
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { STAGE_MODEL } from './lib/content-core-run.mjs'
import { LEDGER_STAGES } from '../src/lib/llm-ledger'
import { PLANNED } from './persona-children-age-bands.mjs'
import { readPostRequirements, hardFilter } from '../src/lib/original-post-persona-match'
import {
  readVoiceProvenance, voiceOfGateResults, judgeVoiceMatch, VOICE_MATCH_CODES,
} from '../src/lib/original-post-voice-match'
import { planMatch, planBatch } from '../src/lib/original-post-persona-match'
// 🔴 fixture 가 운영과 **같은 경로**를 지나게 한다 — 직접 matcher 만 부르면 중간 유실을 못 본다
import { prepareCandidates } from '../src/lib/supply-candidates'
import { DRAFT_RULE_VERSION as RV } from '../src/lib/micro-seed-auto-draft'
import { CONTENT_CORE_PROMPT_VERSION } from '../src/lib/content-core/pipeline'
import { planRefill, MACHINE_PROFILE } from '../src/lib/micro-seed-supply-autofill'

/** 🔴 적재 단계까지 같은 글을 흘려보내 본다 — 판정만 통과하고 적재에서 막히면 의미가 없다 */
const MACHINE_ENV = {
  provenance: MACHINE_PROFILE.envelopeProvenance,
  ruleVersion: MACHINE_PROFILE.envelopeRuleVersion,
  promptVersion: MACHINE_PROFILE.envelopePromptVersion,
  pipelineVersion: MACHINE_PROFILE.envelopePipelineVersion,
  stageModels: STAGE_MODEL,
}
const machineCandidate = (o: { title: string; body: string }) => ({
  candidateType: MACHINE_PROFILE.candidateType,
  sourceArticleId: '447520', sourceSite: 'navercafe:remonterrace',
  sourceInput: MACHINE_PROFILE.sourceInput, sourceDecision: MACHINE_PROFILE.sourceDecision,
  title: o.title, body: o.body, safetyVerdict: 'pass',
  originality: { runWords: 2, runChars: 5, coverRatio: 0 },
  leakedTokens: '', reviewedAt: NOW,
  // 🔴 기계 후보는 말투 근거가 필수다 (2026-09-13)
  voiceProvenance: { personaCode: 'P01', comments: 5, bundleDigest: 'bd1', sourceDigest: 'sd1' },
  autoJudge: { ruleVersion: 'r', promptVersion: 'p', model: 'm', inputHash: 'h', provenance: 'machine-auto' },
})
import { POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const NOW = '2026-09-07T12:00:00.000Z'
/**
 * 🔴 **주석을 검사하지 않는다.** 주석에는 "옛 판은 이랬다" 는 역사 기록이 남아 있고,
 *    그것까지 정규식에 걸면 기록을 지워야 검사가 통과하는 이상한 압력이 생긴다.
 */
const codeOf = (path: string): string =>
  readFileSync(path, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const draft = (o: Partial<DraftCandidate> = {}): DraftCandidate => ({
  sourceArticleId: 's1', draftNo: 1,
  title: '간식 어떤 거 두고 드세요?',
  body: '간식 떨어지면 허전해서 늘 뭔가 두게 되더라고요. 다들 어떤 간식 두고 드세요?',
  safetyVerdict: 'pass',
  originality: { runWords: 2, runChars: 4, coverRatio: 0 }, generatedAt: NOW, ...o,
})
/**
 * 🔴 **품질 판정 mock 은 없앴다** (2026-09-20). `pickDraft` 는 이제 deterministic 만
 *    본다 — 의미 판정은 Content Core v2 통합 검수가 하고 `pickV2` 가 받는다.
 */
const inp = (o: Partial<PickInput> = {}): PickInput => ({
  judgement: { sourceArticleId: 's1', decision: 'AUTO_SEED', semanticRisks: [] },
  drafts: [draft()],
  seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false, ...o,
})
const p = (o: Partial<PickInput> = {}) => pickDraft(inp(o), NOW)

console.log('\n기계 초안 채택 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 사람의 ADOPT 를 사칭하지 않는다')
{
  check('결정 3종이 전부 AUTO_ 로 시작', AUTO_DRAFT_DECISIONS.every((d) => d.startsWith('AUTO_')))
  check('🔴 사람 값과 겹치지 않는다',
    AUTO_DRAFT_DECISIONS.every((d) => !(HUMAN_DRAFT_DECISIONS as readonly string[]).includes(d)))
  check(`provenance 가 ${DRAFT_PROVENANCE}`, p().provenance === DRAFT_PROVENANCE)
  check('ruleVersion 이 붙는다', p().ruleVersion === DRAFT_RULE_VERSION)
  check('decidedAt 이 붙는다', p().decidedAt === NOW)

  const row = p() as unknown as Record<string, unknown>
  check('🟢 온전한 채택은 통과', violatesDraftProvenance(row).length === 0)
  for (const d of HUMAN_DRAFT_DECISIONS) {
    check(`🔴 decision=${d} 를 쓰면 잡는다`,
      violatesDraftProvenance({ ...row, decision: d }).length > 0)
  }
  for (const pv of HUMAN_DRAFT_PROVENANCE) {
    check(`🔴 provenance=${pv} 를 쓰면 잡는다`,
      violatesDraftProvenance({ ...row, provenance: pv }).length > 0)
  }
  // 🔴 후보 파일이 사람 판정으로 위장하지 않는지
  // 🔴 봉투 조립은 `candidate-envelope` 하나다(2026-09-23) — 옮긴 자리에서 본다
  check('🔴 후보 파일의 sourceDecision 이 AUTO_ADOPT 다', (() => {
    const r = readFileSync('scripts/lib/candidate-envelope.mts', 'utf-8')
    return /sourceDecision: 'AUTO_ADOPT'/.test(r) && !/sourceDecision: 'ADOPT'/.test(r)
  })())
  /**
   * 🔴 **설명이 현실과 반대였다** (2026-09-20 정정). 앞판 note 는
   *    *"AUTO_ADOPT 라 autofill 이 받지 않는다"* 였는데, `MACHINE_PROFILE` 의
   *    `sourceDecision` 이 곧 `AUTO_ADOPT` 라 **machine 경로로 받는다.**
   *    막는 것은 그 다음 단계, 발행 전 사람 검토다.
   */
  check('🔴 🔴 **note 가 현실을 적는다 — autofill 은 받고, 발행은 사람 검토가 연다**', (() => {
    const r = readFileSync('scripts/lib/candidate-envelope.mts', 'utf-8')
    return /supply-autofill 은 이 후보를 큐에 올리지만/.test(r)
      && /publish:machine-review 로 검토를 마쳐야 열린다/.test(r)
      && !/supply-autofill 이 받지 않는다/.test(r)
  })())
  check('🔴 기계 경로의 결정값이 사람 경로와 다르다 — 사칭하지 않는다', (() => {
    const lib = readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')
    return /seedOriginality: 'ADOPT'/.test(lib) && /rawOriginality: 'SAVE'/.test(lib)
  })())
}

console.log('\n② 🔴 AUTO_SEED 만 초안화한다')
{
  check('🟢 AUTO_SEED 는 통과', p().decision === 'AUTO_ADOPT')
  for (const d of ['AUTO_HOLD', 'AUTO_DROP', 'AUTO_RAW', '']) {
    check(`🔴 ${d || '(빈값)'} 은 초안화하지 않는다`, p({
      judgement: { sourceArticleId: 's1', decision: d, semanticRisks: [] },
    }).decision === 'AUTO_DROP')
  }
  check('사유가 notAutoSeed', p({
    judgement: { sourceArticleId: 's1', decision: 'AUTO_HOLD', semanticRisks: [] },
  }).reason === 'notAutoSeed')

  // 🔴 판정 단계 위험을 여기서 다시 본다
  for (const r of BLOCKING_RISKS) {
    check(`🔴 ${r} 위험이 남아 있으면 초안화 안 함`, p({
      judgement: { sourceArticleId: 's1', decision: 'AUTO_SEED', semanticRisks: [r] },
    }).decision === 'AUTO_DROP')
  }
  check('사유가 laneRisk', p({
    judgement: { sourceArticleId: 's1', decision: 'AUTO_SEED', semanticRisks: [BLOCKING_RISKS[0]!] },
  }).reason === 'laneRisk')
  check('🔴 막는 위험 목록이 판정 단계 정본과 같다 — 숫자를 여기 적지 않는다',
    BLOCKING_RISKS.length > 0
    && BLOCKING_RISKS.every((x) => (SEMANTIC_DROP as readonly string[]).includes(x)))
}

console.log('\n③ 🔴 원천당 최종 초안 하나')
{
  check('🔴 이미 골랐으면 더 고르지 않는다', p({ sourceUsed: true }).decision === 'AUTO_HOLD')
  check('사유가 sourceAlreadyUsed', p({ sourceUsed: true }).reason === 'sourceAlreadyUsed')
  check('🔴 초안이 둘이어도 하나만 고른다', (() => {
    const r = p({ drafts: [draft({ draftNo: 1 }), draft({ draftNo: 2, title: '다른 간식 제목' })] })
    return r.decision === 'AUTO_ADOPT' && r.draftNo === 1
  })())
  check('🔴 draftNo 순으로 본다 — 입력 순서가 달라도 같은 것을 고른다', (() => {
    const a = p({ drafts: [draft({ draftNo: 2, title: '간식 둘' }), draft({ draftNo: 1 })] })
    return a.draftNo === 1
  })())
  check('첫 초안이 떨어지면 다음을 본다', (() => {
    const r = p({ drafts: [
      draft({ draftNo: 1, safetyVerdict: 'hold' }),
      draft({ draftNo: 2, title: '간식 두 번째' }),
    ] })
    return r.decision === 'AUTO_ADOPT' && r.draftNo === 2 && r.rejected.length === 1
  })())
  check('🔴 전부 떨어지면 버리지 않고 HOLD — 소재는 살아 있다', (() => {
    const r = p({ drafts: [draft({ safetyVerdict: 'hold' })] })
    return r.decision === 'AUTO_HOLD' && r.reason === 'safetyNotPass'
  })())
  check('초안이 0건이면 HOLD', p({ drafts: [] }).decision === 'AUTO_HOLD')
  check('떨어진 이유가 조용히 사라지지 않는다',
    p({ drafts: [draft({ safetyVerdict: 'hold' })] }).rejected.length === 1)
}

console.log('\n⑥ 🔴 같은 글을 두 번 내지 않는다')
{
  check('🔴 제목이 겹치면 안 쓴다', (() => {
    const r = p({ seenTitles: new Set([normalize('간식 어떤 거 두고 드세요?')]) })
    return r.decision === 'AUTO_HOLD' && r.reason === 'duplicateTitle'
  })())
  check('🔴 본문이 겹쳐도 안 쓴다', (() => {
    const r = p({ seenBodies: new Set([normalize(draft().body)]) })
    return r.decision === 'AUTO_HOLD' && r.reason === 'duplicateBody'
  })())
  check('띄어쓰기만 다른 것도 같은 글이다',
    normalize('간식 어떤 거') === normalize('간식어떤거'))
  check('러너가 이번 회차 안에서도 중복을 막는다', (() => {
    const r = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    return /seenTitles\.add\(normalize\(\w+\.title\)\)/.test(r)
      && /seenBodies\.add\(normalize\(\w+\.body\)\)/.test(r)
  })())
}

console.log('\n⑦ 집계')
{
  const picks = [p(), p({ sourceUsed: true }), p({
    judgement: { sourceArticleId: 's2', decision: 'AUTO_HOLD', semanticRisks: [] },
  })]
  const s = summarizeDrafts(picks)
  check('총계 3', s.total === 3)
  check('ADOPT 1 · HOLD 1 · DROP 1',
    s.AUTO_ADOPT === 1 && s.AUTO_HOLD === 1 && s.AUTO_DROP === 1)
  check('사유별로 센다', Object.keys(s.byReason).length > 0)
  check('사유마다 라벨이 있다', Object.keys(DRAFT_REASON_LABEL).length >= 13)
}

console.log('\n⑭ 🔴 생성 말투 → 후보 → 발행 author 가 이어진다')
{
  const V = { personaCode: 'P01', comments: 5, bundleDigest: 'abc123', sourceDigest: 'src1' }
  check('🔴 후보에서 읽어 낸다', readVoiceProvenance(V)?.personaCode === 'P01')
  for (const [label, bad] of [
    ['null', null], ['문자열', 'P01'], ['personaCode 빔', { ...V, personaCode: '' }],
    ['digest 빔', { ...V, bundleDigest: '' }], ['댓글 0건', { ...V, comments: 0 }],
  ] as const) {
    check(`🔴 깨진 값(${label})은 null 이다`, readVoiceProvenance(bad) === null)
  }
  check('🔴 큐 행의 gateResults 에서 읽어 낸다',
    voiceOfGateResults({ autoDraft: { voice: V } })?.personaCode === 'P01')
  check('🔴 적재가 그 값을 큐 payload 에 싣는다',
    /voice: readVoiceProvenance\(c\.voiceProvenance\)/.test(codeOf('src/lib/micro-seed-supply-autofill.ts')))
  /**
   * 🔴 **호출부마다 따로 부르지 않는다** (2026-09-13 3차 정정).
   *    러너 · 관제 · 예측 · 준비도 · 수동 배정이 각자 `profileOf` 와 `voiceOfGateResults` 를
   *    부르면 한 곳이 빠져도 아무도 모른다 — 실제로 `supply-candidates.draftOf()` 가
   *    둘 다 떨어뜨렸고 P01 이 쓴 글이 P02 이름으로 배정됐다.
   */
  check('🔴 말투·profile 을 만드는 함수가 하나다', (() => {
    const c = codeOf('src/lib/original-post-auto-publish.ts')
    return /export function voiceInputOf/.test(c)
      && /voice: voiceOfGateResults\(r\.gateResults\)/.test(c)
      && /profile: profileOf\(r\) === 'human' \? 'human' : 'machine'/.test(c)
  })())
  for (const f of [
    /**
     * 🔴 auto-publish 의 조립은 `scripts/lib/publishable-stock.mts` 로 옮겨졌다
     *    (2026-09-24 — 러너와 관제가 같은 함수를 쓰게 하려고). 그 자리를 본다.
     */
    'scripts/lib/publishable-stock.mts',
    // 🔴 (2026-09-30) supply-health 는 러너와 같은 공용 적재(publishable-stock)를 읽고 · persona-capacity-planner 는 퇴역 — 조립 사본이 없다
    'scripts/original-post-match-assign.mts',
    'scripts/original-post-persona-match-dry-run.mts',
  ]) {
    check(`🔴 ${f.split('/').pop()} 가 그 함수를 쓴다`, /voiceInputOf\(/.test(codeOf(f)))
  }
  check('🔴 🔴 **발행 러너가 그 조립 결과를 실제로 소비한다**',
    /loadPublishableStock\(/.test(codeOf('scripts/original-post-auto-publish.mts')))
  check('🔴 중간 단계가 voice·profile 을 떨어뜨리지 않는다',
    /voice: c\.voice, profile: c\.profile/.test(codeOf('src/lib/supply-candidates.ts')))
  check('🔴 profile 을 optional 로 두고 human 으로 떨어뜨리지 않는다', (() => {
    const m = codeOf('src/lib/original-post-persona-match.ts')
    const s2 = codeOf('src/lib/supply-candidates.ts')
    return !/profile\?: CandidateProfile/.test(m) && !/profile\?: CandidateProfile/.test(s2)
      && !/profile: input\.profile \?\? 'human'/.test(m) && !/profile: d\.profile \?\? 'human'/.test(m)
  })())

  /**
   * 🔴 **기계 후보는 말투 근거가 필수다** (2026-09-13 2차).
   *    옛 판은 `voice === null` 하나로 사람과 기계를 뭉개 `NO_VOICE` 로 통과시켰다 —
   *    voice 를 잃어버린 기계 글이 아무 Persona 이름으로나 나갈 수 있었다.
   */
  check('🔴 기계 후보 + voice 없음 → 막힌다',
    !judgeVoiceMatch({ voice: null, personaCode: 'P01', profile: 'machine' }).ok
    && judgeVoiceMatch({ voice: null, personaCode: 'P01', profile: 'machine' }).code === 'VOICE_MISSING')
  check('🟢 사람 후보 + voice 없음 → 기존대로 통과',
    judgeVoiceMatch({ voice: null, personaCode: 'P09', profile: 'human' }).code === 'HUMAN_NO_VOICE')
  check('🟢 기계 후보 + 유효한 voice + 같은 Persona → 통과',
    judgeVoiceMatch({ voice: V, personaCode: 'P01', profile: 'machine' }).code === 'SAME_PERSONA')
  check('🔴 다른 Persona 는 길이가 같아도 차단 — 호환 경로를 없앴다',
    !judgeVoiceMatch({ voice: V, personaCode: 'P02', profile: 'machine' }).ok
    && judgeVoiceMatch({ voice: V, personaCode: 'P02', profile: 'machine' }).code === 'OTHER_PERSONA')
  check('🔴 COMPATIBLE_BAND 라는 길이 밴드 우회가 남아 있지 않다',
    !(VOICE_MATCH_CODES as readonly string[]).includes('COMPATIBLE_BAND')
    && !/lengthBand/.test(codeOf('src/lib/original-post-voice-match.ts')))

  /** 🔴 적재 단계에서도 막힌다 — 발행까지 가지 않는다 */
  check('🔴 voice 없는 기계 후보는 적재되지 않는다', (() => {
    const c = machineCandidate({ title: '제목입니다', body: '본문입니다 요즘 그렇더라고요' })
    const bad = { ...c, voiceProvenance: undefined }
    const plan = planRefill({
      envelope: MACHINE_ENV, candidates: [bad as never],
      existing: new Set(), held: [], queue: [],
    })
    return plan.targets.length === 0 && plan.skipped[0]?.code === 'PROFILE'
  })())
  check('🔴 깨진 voice 도 적재되지 않는다', (() => {
    const c = machineCandidate({ title: '제목입니다', body: '본문입니다 요즘 그렇더라고요' })
    const bad = { ...c, voiceProvenance: { personaCode: '', comments: 1, bundleDigest: 'x' } }
    const plan = planRefill({
      envelope: MACHINE_ENV, candidates: [bad as never],
      existing: new Set(), held: [], queue: [],
    })
    return plan.targets.length === 0 && plan.skipped[0]?.code === 'PROFILE'
  })())

  const persona = (o: Record<string, unknown>) => ({
    code: 'P01', status: 'active', providerId: null, accountCount: 0,
    noGoTopics: [], postsThisWeek: 0, daysSinceLastPost: 30, ...o,
  }) as never
  const P01 = persona({ code: 'P01', voiceLength: '중간' })
  const P02same = persona({ code: 'P02', voiceLength: '중간' })
  const draftIn = { queueId: 'q1', title: '간식 뭐 드세요', body: '요즘 간식을 자꾸 찾게 되네요. 다들 어떤 거 두고 드시나요' }

  check('🔴 matcher 가 쓴 사람만 후보로 남긴다', (() => {
    const plan = planMatch({ ...draftIn, personas: [P01, P02same], voice: V, profile: 'machine' })
    return plan.eligible.length === 1 && plan.eligible[0]!.code === 'P01'
      && plan.recommended === 'P01'
      && plan.blocked.some((b) => b.code === 'P02' && b.reasons.some((r) => r.code === 'VOICE_MISMATCH'))
  })())
  check('🔴 쓴 사람이 못 쓰면 남에게 넘기지 않는다 — 이번 회차 보류', (() => {
    const plan = planMatch({ ...draftIn, personas: [P02same], voice: V, profile: 'machine' })
    return plan.eligible.length === 0 && plan.recommended === null && !plan.publishable
  })())
  check('🔴 쓴 사람이 여력으로 막혀도 남에게 넘기지 않는다', (() => {
    const full = persona({ code: 'P01', voiceLength: '중간', postsThisWeek: 99 })
    const b = planBatch([{ ...draftIn, gateVerdict: 'PASS', createdAt: 0, voice: V, profile: 'machine' }],
      [full, P02same], {})
    return b.assignments[0]!.assigned === null
  })())
  check('🟢 사람 글은 종전대로 전원 후보다', (() => {
    const plan = planMatch({ ...draftIn, personas: [P01, P02same], voice: null, profile: 'human' })
    return plan.eligible.length === 2
  })())
  check('🔴 기계 글인데 voice 가 없으면 아무도 못 쓴다', (() => {
    const plan = planMatch({ ...draftIn, personas: [P01, P02same], voice: null, profile: 'machine' })
    return plan.eligible.length === 0 && plan.recommended === null
  })())
  check('🔴 이미 배정된 행도 같은 규칙으로 재검사한다', (() => {
    const b = planBatch([{
      ...draftIn, gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: 'P02',
      voice: V, profile: 'machine',
    }], [P02same], {})
    const a = b.assignments[0]!
    return a.assigned === null && (a.recoveryProblem ?? '').includes('이 글을 쓴')
  })())
  check('🔴 생성 쪽이 정본 universe 의 Persona 코드에 묶는다', (() => {
    // 🔴 후보 풀을 읽는 곳은 생성 러너와 계약 산출이 **함께 쓰는 한 파일**이다
    const r = codeOf('scripts/lib/voice-runtime.mts')
    return /planBundles\(\{ rows: asset\.rows, personaCodes: PRODUCTION_PERSONA_CODES \}\)/.test(r)
      && !/voice-a/.test(r)
      // 🔴 `loadVoice` 가 시각을 받게 됐다 (2026-09-23) — 후보 풀 지문에 그날 나이가 들어간다.
      //    묶는 곳이 하나라는 계약은 그대로다.
      && /loadVoice\(/.test(codeOf('scripts/micro-seed-auto-draft.mts'))
  })())
  check('🔴 판 값이 세 곳에 흩어져 있지 않다 — 정본 하나에서 나온다', (() => {
    const af = codeOf('src/lib/micro-seed-supply-autofill.ts')
    const ap = codeOf('src/lib/original-post-auto-publish.ts')
    return /envelopeRuleVersion: DRAFT_RULE_VERSION/.test(af)
      && /draftRuleVersion: DRAFT_RULE_VERSION/.test(ap)
      && !/auto-draft-v\d/.test(af) && !/auto-draft-v\d/.test(ap)
  })())
}

/**
 * 🔴 **직접 matcher 를 부르지 않는다 — 운영이 쓰는 경로 전체를 지난다** (2026-09-13).
 *
 *    앞선 fixture 는 `planMatch()` 를 직접 불러 통과했다. 그런데 운영은
 *    `selectAutoTargets → QueueCandidate → prepareCandidates → planBatch` 로 간다.
 *    그 중간의 `draftOf()` 가 `voice` 와 `profile` 을 떨어뜨리고 있었고,
 *    **fixture 가 본 경로와 운영이 쓰는 경로가 달랐다.**
 */
console.log('\n⑭-a 🔴 운영 호출 그래프 전체를 지난다')
{
  const AT = new Date('2026-09-13T00:00:00.000Z')
  const full = (o: Record<string, unknown>) => ({
    code: String(o.code), status: 'active', providerId: null, accountCount: 0, noGoTopics: [],
    postsThisWeek: 0, daysSinceLastPost: 30, voiceLength: '중간',
    maritalStatus: '기혼', childrenCount: 0, childrenAgeBands: [], parentCare: '없음',
    menopauseStatus: '진행중', workStatus: '주부', economicStatus: '보통', region: '수도권',
    ...o,
  }) as never
  const VP = { personaCode: 'P01', comments: 5, bundleDigest: 'bd1', sourceDigest: 'sd1' }
  const qc = (o: Record<string, unknown> = {}) => ({
    queueId: 'q1', title: '간식 뭐 드세요',
    body: '요즘 간식을 자꾸 찾게 되네요. 다들 어떤 거 두고 드시나요',
    gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null,
    // 🔴 (2026-09-30) 원문 증거 — 없으면 정본 슬롯 판정이 계획에서 뺀다(배정까지 가지 않는다)
    gateResults: fakeEvidenceGate(AT, { id: 'q1' }),
    voice: VP, profile: 'machine' as const, ...o,
  })
  const assignedOf = (c: Record<string, unknown>, codes: readonly string[]): string | null =>
    prepareCandidates({
      candidates: [c as never], personas: codes.map((x) => full({ code: x })), at: AT,
    }).batch.assignments[0]?.assigned ?? null

  check('🔴 실제 경로: P01 이 쓴 글은 P02 에게 넘어가지 않는다', assignedOf(qc(), ['P02']) === null)
  check('🟢 실제 경로: P01 이 있으면 P01 이 쓴다', assignedOf(qc(), ['P01', 'P02']) === 'P01')
  check('🔴 실제 경로: 기계 후보 + voice 없음 → 아무도 못 쓴다',
    assignedOf(qc({ voice: null }), ['P01', 'P02']) === null)
  check('🟢 실제 경로: 사람 후보 + voice 없음 → 기존대로 배정된다',
    assignedOf(qc({ voice: null, profile: 'human' as const }), ['P02']) === 'P02')
  check('🔴 중간 단계가 voice·profile 을 들고 간다', (() => {
    const r = prepareCandidates({ candidates: [qc() as never], personas: [full({ code: 'P01' })], at: AT })
    const d = r.auto[0] as Record<string, unknown>
    return d.voice !== undefined && d.profile === 'machine'
  })())
  check('🔴 러너 · 관제 · 예측이 같은 답을 낸다 — 같은 함수를 쓰기 때문이다', (() => {
    const cands = [qc() as never]
    const personas = [full({ code: 'P02' })]
    const a = prepareCandidates({ candidates: cands, personas, at: AT })
    const b = prepareCandidates({ candidates: cands, personas, at: AT })
    return a.batch.assignments[0]?.assigned === b.batch.assignments[0]?.assigned
      && a.batch.assignments[0]?.assigned === null
  })())
}

/**
 * 🔴 **생성 전에 쓸 사람을 정한다** (2026-09-13).
 *
 *    옛 판은 원천 ID 해시로 골랐다 — 원문이 무엇을 요구하는지, 그 Persona 가 누구인지
 *    보지 않았다. 실측(외부 source 8건 · 정본 카드): 생성 **전** 생활사 충돌 3/8 ·
 *    P03 혼자 3건 · 18명 중 6명만 쓰임. 쓸 수 없는 사람 목소리로 AI 를 부른 것이 낭비였다.
 */
console.log('\n⑭-b 🔴 제목에 있는 참여 의도를 살린다')
{
  for (const [title, body, want] of [
    ['동네 소주한잔하자는 할머니 어찌대응하세요?', '우리 동네 할머니가 마주칠 때마다 소주 한잔하자고 하세요.', 'explicit_question'],
    ['진상맘인지 들어주세요🥲', '아이 학교에서 있었던 일인데 담임한테 얘기했어요.', 'vent_to_audience'],
    ['스케일링 몇 년에 한 번씩 받으세요?', '치과에서 자꾸 오라고 해요.', 'explicit_question'],
    ['이거 어떡하죠', '시어머니가 또 같은 얘기를 하세요.', 'explicit_question'],
    ['다들 어떤 거 추천하세요', '주방칼을 바꾸려는데 종류가 너무 많네요.', 'advice_request'],
    ['써보신 분 계신가요', '이런 건 처음이라 감이 안 와요.', 'experience_call'],
  ] as const) {
    check(`🟢 "${title.slice(0, 16)}" → ${want}`,
      readSourceProfile({ rawTitle: title, rawBody: body }).closingIntent === want)
  }
  /**
   * 🔴 **낱말 하나로 판정하지 않는다** (2026-09-13 정정).
   *    첫 판은 `어찌` · `어쩌나` · `추천` 을 단독 부분 문자열로 봐서 아래를 전부 오판정했다.
   */
  for (const [title, body] of [
    ['어찌나 웃기던지', '어제 예능 보다가 배꼽 빠지는 줄 알았어요.'],
    ['세월이 어찌 이렇게 빠른지', '벌써 애가 중학생이 됐네요.'],
    ['어쩌나 저쩌나 그냥 살죠', '다들 그러고 사는 거 아니겠어요.'],
    ['이번 주 추천 드라마', '요즘 보는 게 하나 있는데 재밌더라고요.'],
    ['오늘 김치를 담갔어요', '배추가 좋아서 스무 포기 했어요. 허리가 아프네요.'],
    ['나이들수록 먹고싶은것도 없나봐요', '아침에 밥 차려 놔도 반만 먹고 남겨요.'],
    ['어제 손주가 다녀갔어요', '하루 종일 놀아줬더니 삭신이 쑤시네요.'],
  ] as const) {
    check(`🟢 진술형 "${title.slice(0, 14)}" 는 no_call 이다`,
      readSourceProfile({ rawTitle: title, rawBody: body }).closingIntent === 'no_call')
  }
  check('🔴 본문이 먼저다 — 본문이 부르면 제목을 보지 않는다',
    readClosingIntent({ title: '오늘 김치를 담갔어요', body: '써보신 분 계신가요', tone: 'plain' }) === 'experience_call')
  check('🔴 제목 판정이 따로 있다 — 본문 판정과 같은 목록을 쓴다',
    readTitleIntent('추천 좀 해주세요') === 'advice_request'
    && readTitleIntent('오늘 날씨가 좋네요') === null)
  /**
   * 🔴 **묻는 모양인지 재기만 한다 — 막지 않는다.**
   *    막기 시작하면 다시 "마지막 글자는 물음표" 가 된다.
   */
  check('🟢 자연스러운 질문 종결을 알아본다',
    endsNaturallyAsQuestion('그래서 여쭤봐요. 다들 어떻게 하세요?')
    && endsNaturallyAsQuestion('이게 맞는 걸까요?'))
  check('🔴 물음표 없이 끝나면 질문 모양이 아니다',
    !endsNaturallyAsQuestion('정말 궁금해요.')
    && !endsNaturallyAsQuestion('왜 그럴까요? 그래서 그냥 두기로 했어요.'))
  check('🔴 이 함수로 초안을 막지 않는다 — 판정 경로에 없다',
    !/endsNaturallyAsQuestion/.test(codeOf('src/lib/micro-seed-auto-draft.ts'))
    && !/endsNaturallyAsQuestion/.test(codeOf('scripts/micro-seed-supply-autofill.mts')))
}

console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
