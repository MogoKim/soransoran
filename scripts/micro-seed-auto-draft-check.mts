#!/usr/bin/env tsx
/**
 * 기계 초안 채택 fixture — 🔴 **사람의 ADOPT 를 사칭하지 않는다** (§4-AS)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  pickDraft, checkDraft, summarizeDrafts, violatesDraftProvenance,
  hasBannedWord, normalize,
  echoesTitleAtEnd, parseQuality, applyQuality, type DraftQualityVerdict,
  DRAFT_QUALITY_AXES, QUALITY_DROP, QUALITY_HOLD, DRAFT_MIN_CONFIDENCE,
  DRAFT_PROMPT_VERSION, QUALITY_PROMPT_VERSION, MAX_DRAFTS_PER_SOURCE,
  AUTO_DRAFT_DECISIONS, HUMAN_DRAFT_DECISIONS, HUMAN_DRAFT_PROVENANCE,
  DRAFT_RULE_VERSION, DRAFT_PROVENANCE, BANNED_WORDS,
  BLOCKING_RISKS, DRAFT_REASON_LABEL,
  type DraftCandidate, type PickInput,
} from '../src/lib/micro-seed-auto-draft'
import { measureOriginality, judgeCopy, COPY_RUN_WORDS } from '../src/lib/draft-originality'
import { SEMANTIC_DROP } from '../src/lib/micro-seed-auto-judge'
import {
  buildGenSystemPrompt, buildQualitySystemPrompt, retryDirective, callBudgetOf,
  CallBudget, HARM_BANS, MAX_ORIGINALITY_RETRIES,
  CALL_ALLOWANCE_PER_SOURCE, CALL_EXPECTED_PATH_PER_SOURCE, HARM_PROMPT, digest16,
  buildAgeCheckSystemPrompt, parseAgeCheck,
} from './micro-seed-auto-draft.mjs'
import {
  readSourceProfile, readClosingIntent, readTitleIntent, endsNaturallyAsQuestion,
} from './lib/source-profile'
import { PRODUCTION_PERSONA_CODES, isProductionPersonaCode } from '../src/lib/persona-cohort'
// 🔴 Persona 정체성의 정본은 카드 문서다 — fixture 도 그것을 본다
import { parsePoolDoc, cardToPersona } from '../src/lib/persona-pool-card'
import { planVoicePersonas, loadSpread } from '../src/lib/voice-persona-plan'
import {
  lifeConflictDirective, MAX_LIFE_CONFLICT_RETRIES, schemaRetryDirective,
} from './micro-seed-auto-draft.mjs'
import {
  judgeLifeRetry, mergeLifeConflict, AGE_CHECK_MODEL_TRIAL, AGE_CHECK_QUALIFIED_MODEL,
  MACHINE_AGE_HUMAN_REVIEW_REQUIRED, MACHINE_AGE_HUMAN_REVIEW_NOTE,
} from '../src/lib/micro-seed-auto-draft'
import {
  lifeHistoryLines, evidenceFoundIn, LIFE_CONFLICT_MISSING, LIFE_EVIDENCE_NOT_FOUND,
  type PersonaLifeHistory,
} from '../src/lib/micro-seed-auto-draft'
import { PLANNED } from './persona-children-age-bands.mjs'
import { readPostRequirements, hardFilter } from '../src/lib/original-post-persona-match'
import { PERSONA_POOL_DOC } from './micro-seed-auto-draft.mjs'
import {
  readVoiceProvenance, voiceOfGateResults, judgeVoiceMatch, VOICE_MATCH_CODES,
} from '../src/lib/original-post-voice-match'
import { planMatch, planBatch } from '../src/lib/original-post-persona-match'
// 🔴 fixture 가 운영과 **같은 경로**를 지나게 한다 — 직접 matcher 만 부르면 중간 유실을 못 본다
import { prepareCandidates } from '../src/lib/supply-candidates'
import {
  DRAFT_RULE_VERSION as RV, DRAFT_PROMPT_VERSION as PV, QUALITY_PROMPT_VERSION as QV,
} from '../src/lib/micro-seed-auto-draft'
import { planRefill, MACHINE_PROFILE } from '../src/lib/micro-seed-supply-autofill'

/** 🔴 적재 단계까지 같은 글을 흘려보내 본다 — 판정만 통과하고 적재에서 막히면 의미가 없다 */
const MACHINE_ENV = {
  provenance: MACHINE_PROFILE.envelopeProvenance,
  ruleVersion: MACHINE_PROFILE.envelopeRuleVersion,
  promptVersion: MACHINE_PROFILE.envelopePromptVersion,
  model: MACHINE_PROFILE.envelopeModel,
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
/** 🔴 품질 판정을 mock 한다 — fixture 는 네트워크를 쓰지 않는다 */
const okQ = (o: Partial<{ decision: string; confidence: number; issues: string[]; harms: string[]; unknownIssues: string[] }> = {}) =>
  ({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 0.9, issues: [], unknownIssues: [], harms: [], ...o }) as never
const inp = (o: Partial<PickInput> = {}): PickInput => ({
  judgement: { sourceArticleId: 's1', decision: 'AUTO_SEED', semanticRisks: [] },
  drafts: [draft()],
  seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false,
  quality: new Map([[1, okQ()], [2, okQ()]]), ...o,
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
  check('🔴 후보 파일의 sourceDecision 이 AUTO_ADOPT 다', (() => {
    const r = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    return /sourceDecision: 'AUTO_ADOPT'/.test(r) && !/sourceDecision: 'ADOPT'/.test(r)
  })())
  check('🔴 supply-autofill 이 이 후보를 받지 않는다는 것을 파일에 적는다', (() => {
    const r = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    return /supply-autofill 이 받지 않는다/.test(r)
  })())
  check('🔴 supply-autofill 이 실제로 ADOPT·SAVE 만 받는다', (() => {
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

console.log('\n④ 🔴 초안 검사 — 하나라도 어긋나면 안 쓴다')
{
  const cases: [string, Partial<DraftCandidate>, string][] = [
    ['제목 빔', { title: '  ' }, 'emptyTitle'],
    ['본문 빔', { body: '' }, 'emptyBody'],
    ['safety 미통과', { safetyVerdict: 'hold' }, 'safetyNotPass'],
    ['safety 없음', { safetyVerdict: '' }, 'safetyNotPass'],
    ['원문 문장을 옮김',
      { originality: { runWords: COPY_RUN_WORDS, runChars: 30, coverRatio: 0.9 } }, 'copiedFromSource'],
    ['독창성을 재지 않음',
      { originality: undefined as never }, 'copiedFromSource'],
  ]
  for (const [label, patch, want] of cases) {
    check(`🔴 ${label} → ${want}`, checkDraft(draft(patch), inp()) === want)
  }
  // 🔴 기준은 이 파일이 갖지 않는다 — draft-originality-check.mts 가 경계선을 증명한다
  check('🟢 흔한 표현만 겹치는 초안은 통과',
    checkDraft(draft({
      originality: measureOriginality('그래서 저는 요즘 산책을 다녀요', '그래서 저는 일단 운동부터 시작합니다'),
    }), inp({ quality: new Map([[1, okQ()]]) })) === 'ok')

  // 🔴 제품 금지어 (CLAUDE.md)
  for (const w of BANNED_WORDS) {
    check(`🔴 금지어 "${w}" 가 제목에 있으면 안 쓴다`,
      checkDraft(draft({ title: `${w} 이야기` }), inp()) === 'bannedWord')
    check(`🔴 본문에 있어도 안 쓴다`,
      checkDraft(draft({ body: `우리 ${w} 들은` }), inp()) === 'bannedWord')
  }
  check('금지어가 4종', BANNED_WORDS.length === 4)

  // 🔴 2026-09-13 — 제목 낱말 반복은 하드 게이트가 아니다. 품질 축이 본다
  check('🟢 제목에 같은 낱말이 반복돼도 기계가 막지 않는다',
    checkDraft(draft({ title: '김치 담글 때 김치통 뭐 쓰세요?' }),
      inp({ quality: new Map([[1, okQ()]]) })) === 'ok')
  check('🟡 어색한 반복은 품질 축이 사람에게 넘긴다',
    applyQuality({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 1, issues: ['repetitiveWording'], unknownIssues: [], harms: [] }) === 'semanticHold')

  // 🔴 제목을 본문 끝에 그대로 되풀이하는 것
  check('🔴 제목이 본문 끝에 그대로 있으면 안 쓴다',
    echoesTitleAtEnd('간식 뭐 두고 드세요', '이런저런 이야기 끝에 간식 뭐 두고 드세요'))
  check('   checkDraft 가 이걸 잡는다',
    checkDraft(draft({ body: '요즘 간식 생각이 나서요. 간식 어떤 거 두고 드세요' }), inp()) === 'titleEchoedInBody')
  check('짧은 제목은 이 검사를 하지 않는다', !echoesTitleAtEnd('간식', '간식'))
  check('본문 앞쪽에 있는 것은 되풀이가 아니다',
    !echoesTitleAtEnd('간식 뭐 두고 드세요', '간식 뭐 두고 드세요 라고 묻고 싶었는데 오늘은 날씨 이야기만 했네요 참'))
  check('hasBannedWord 가 직접 잡는다', hasBannedWord('시니어 모임') && !hasBannedWord('우리 나이 모임'))
}

console.log('\n⑤ 🟢 제목·본문 일치를 낱말 포함으로 재지 않는다 (2026-09-13)')
{
  /**
   * 🔴 옛 `titleMatchesBody` 는 소재 낱말이 제목과 본문 양쪽에 **문자열로** 있어야 통과였다.
   *    같은 이야기를 다른 말로 풀면 떨어진다 — 사람은 늘 그렇게 쓴다.
   *    실측(2026-09-11~12) 최종 HOLD 15건 중 7건이 이 사유였다.
   */
  check('🟢 제목 낱말이 본문에 그대로 없어도 통과한다',
    checkDraft(draft({ title: '간식 어떤 거 두고 드세요?', body: '출출할 때 집어 먹을 게 없어서 늘 아쉬워요' }),
      inp({ quality: new Map([[1, okQ()]]) })) === 'ok')
  check('🟡 정말 다른 이야기면 품질 축이 잡는다',
    applyQuality({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 1, issues: ['titleBodyCoherence'], unknownIssues: [], harms: [] }) === 'semanticHold')
  check('🔴 판정 사유 목록에 titleBodyMismatch 가 남아 있지 않다',
    !Object.keys(DRAFT_REASON_LABEL).includes('titleBodyMismatch'))
  check('🔴 PickInput 에 material 자리가 없다', (() => {
    const lib2 = readFileSync('src/lib/micro-seed-auto-draft.ts', 'utf-8')
    const i = lib2.indexOf('export type PickInput')
    return !lib2.slice(i, lib2.indexOf('}\n', i)).includes('material')
  })())
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
    return /seenTitles\.add\(normalize\(d\.title\)\)/.test(r)
      && /seenBodies\.add\(normalize\(d\.body\)\)/.test(r)
  })())
}

console.log('\n⑤-b 🟢 말투를 강제하지 않는다 (2026-09-13)')
{
  /**
   * 🔴 **v3 이 막던 것을 그대로 넣어 통과를 확인한다.**
   *    아래 문장들은 2026-09-07 에 "반말" 로 걸려 버려진 실제 초안이다.
   *    커뮤니티에는 반말도 있고 섞인 말투도 있다 — 그게 사람이 쓴 게시판이다.
   */
  for (const [label, body] of [
    ['반말 본문', '커피맛이 자꾸 변한다니 신기하네. 나만 그런가 싶어서 적어봐'],
    ['존댓말·반말 섞임', '요즘 자꾸 잠이 깨요. 진짜 미치겠다 ㅋㅋ 다들 이러시나요'],
    ['감탄·말줄임', '아휴… 오늘도 그냥 그렇게 지나갔네요'],
    ['줄임말·웃음', '아점 먹고 바로 누웠어요 ㅋㅋㅋ 요즘 이게 낙이라'],
  ] as const) {
    check(`🟢 ${label} 이 통과한다`,
      checkDraft(draft({ body }), inp({ quality: new Map([[1, okQ()]]) })) === 'ok')
  }
  check('🔴 판정 사유 목록에 informalSpeech 가 남아 있지 않다',
    !Object.keys(DRAFT_REASON_LABEL).includes('informalSpeech'))
  check('🔴 품질 축에도 informalSpeech 가 없다',
    !(DRAFT_QUALITY_AXES as readonly string[]).includes('informalSpeech'))
  check('🔴 HOLD 축에도 없다', !(QUALITY_HOLD as readonly string[]).includes('informalSpeech'))
}

console.log('\n⑤-c 🟢 질문으로 끝나지 않아도 된다 (2026-09-13)')
{
  for (const [label, body] of [
    ['그냥 털어놓고 끝남', '문교부에서 컴퓨터를 줬어요. 그때 전산반에 들어갔어요. 참 오래된 얘기네요'],
    ['완곡하게 끝남', '정말로 이 정도가 필요한 건지 궁금해요.'],
    ['물음표 없이 끝남', '다들 어때요'],
  ] as const) {
    check(`🟢 ${label} 이 통과한다`,
      checkDraft(draft({ body }), inp({ quality: new Map([[1, okQ()]]) })) === 'ok')
  }
  check('🔴 판정 사유 목록에 missingAnswerableQuestion 이 남아 있지 않다',
    !Object.keys(DRAFT_REASON_LABEL).includes('missingAnswerableQuestion'))
  check('🔴 품질 축에도 answerableQuestion 이 없다',
    !(DRAFT_QUALITY_AXES as readonly string[]).includes('answerableQuestion'))
  check('🔴 생성 프롬프트가 물음표로 끝내라고 시키지 않는다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return !/마지막 문장은 반드시 물음표/.test(r) && !/본문 2~4문장/.test(r)
  })())
  check('🔴 생성 프롬프트가 존댓말을 강제하지 않는다',
    !/반드시 존댓말/.test(codeOf('scripts/micro-seed-auto-draft.mts')))
  check('🟢 생성 프롬프트가 원문 프로파일을 쓴다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return /readSourceProfile/.test(r) && /profileDirectives/.test(r)
      && /humanVoiceDirectives/.test(r) && /registerFreedomDirectives/.test(r)
  })())
  check('🔴 옛 레인과 정반대를 시키던 예시가 사라졌다',
    !/"다들 어떠세요\?" 처럼/.test(codeOf('scripts/micro-seed-auto-draft.mts')))
  check('🔴 프롬프트가 글마다 달라진다 — 상수가 아니라 함수다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return !/export const GEN_SYSTEM_PROMPT/.test(r) && /export function buildGenSystemPrompt/.test(r)
  })())
}

console.log('\n⑥-b 🔴 semantic 품질 판정 — 정책이 모델을 이긴다')
{
  check('품질 축 6종 — 말투·질문 축을 뺐다', DRAFT_QUALITY_AXES.length === 6)
  check('🔴 DROP 축과 HOLD 축이 겹치지 않는다',
    QUALITY_DROP.every((x) => !QUALITY_HOLD.includes(x)))
  check('🔴 판정을 못 받으면 통과가 아니다', applyQuality(null) === 'semanticUnavailable')
  check('🟢 깨끗하면 통과', applyQuality({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 0.9, issues: [], unknownIssues: [], harms: [] }) === 'ok')
  for (const a of QUALITY_DROP) {
    check(`🔴 ${a} → semanticDrop`,
      applyQuality({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 1, issues: [a], unknownIssues: [], harms: [] }) === 'semanticDrop')
  }
  for (const a of QUALITY_HOLD) {
    check(`🟡 ${a} → semanticHold`,
      applyQuality({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 1, issues: [a], unknownIssues: [], harms: [] }) === 'semanticHold')
  }
  check('🔴 모델이 통과라 해도 축이 있으면 통과가 아니다',
    applyQuality({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 1, issues: ['naturalKorean'], unknownIssues: [], harms: [] }) !== 'ok')
  check('🔴 모델이 버리라 해도 버릴 축이 없으면 HOLD',
    applyQuality({ lifeConflict: null, decision: 'AUTO_DROP', confidence: 1, issues: [], unknownIssues: [], harms: [] }) === 'semanticHold')
  check(`🔴 confidence ${DRAFT_MIN_CONFIDENCE} 미만이면 HOLD`,
    applyQuality({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 0.5, issues: [], unknownIssues: [], harms: [] }) === 'lowConfidence')

  check('🔴 파싱 실패 → null', parseQuality('JSON 아님') === null)
  check('🔴 모르는 decision → null', parseQuality('{"decision":"YES","confidence":1}') === null)
  check('🔴 사람 값을 답해도 null', parseQuality('{"decision":"ADOPT","confidence":1}') === null)
  check('🟢 온전한 응답은 읽는다',
    parseQuality('{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[]}') !== null)
  check('🔴 모르는 축 이름을 다른 축으로 바꾸지 않는다', (() => {
    const v = parseQuality('{"decision":"AUTO_ADOPT","confidence":0.9,"issues":["newAxis"]}')
    return v !== null && v.issues.length === 0 && v.unknownIssues.includes('newAxis')
  })())

  // 🔴 deterministic 이 semantic 보다 먼저다
  check('🔴 모델이 통과라 해도 금지어는 막힌다', (() => {
    const r = checkDraft(draft({ title: '시니어 이야기' }), inp())
    return r === 'bannedWord'
  })())
  check('🔴 모델이 통과라 해도 실질 복제는 막힌다',
    checkDraft(draft({ originality: { runWords: 12, runChars: 40, coverRatio: 0.9 } }),
      inp()) === 'copiedFromSource')
  check('🔴 모델이 통과라 해도 safety 는 막힌다',
    checkDraft(draft({ safetyVerdict: 'hold' }), inp()) === 'safetyNotPass')
  check('🔴 품질 판정이 없으면 통과가 아니다', (() => {
    const r = checkDraft(draft(), { ...inp(), quality: new Map() })
    return r === 'semanticUnavailable'
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

console.log('\n⑧ 🔴 하지 않는 것 — 스캔')
{
  const codeOf = (path: string): string => readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const runner = codeOf('scripts/micro-seed-auto-draft.mts')
  const lib = codeOf('src/lib/micro-seed-auto-draft.ts')

  for (const [label, re] of [
    ['Prisma / DB', /PrismaClient|prisma\./],
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['네트워크', /fetch\(|axios|playwright|chromium/i],
    ['Sheet', /googleapis|spreadsheet/i],
    ['Raw Vault', /microSeedRawContent/],
    ['큐 적재', /originalPostApprovalQueue/],
    ['Post 생성', /post\.create/i],
    ['발행 호출', /publishOriginalPostTx\s*\(/],
  ] as const) {
    check(`🔴 러너에 ${label} 없음`, !re.test(runner))
  }
  check('🔴 lib 은 순수 함수만이다',
    !/readFileSync|writeFileSync|fetch\(|await |PrismaClient/.test(lib))
  check('🔴 기존 템플릿 생성기를 재사용한다 — 새로 만들지 않는다',
    /from '\.\/lib\/micro-seed-seed-originality\.mjs'/.test(runner) && /expandSeed\(/.test(runner))
  check('🔴 템플릿 생성기에 제목만 넘긴다', (() => {
    const i = runner.lastIndexOf('expandSeed({')
    const body = runner.slice(i, runner.indexOf('}, nowIso)', i))
    return /title: meta\.title/.test(body) && !/rawBody|body:/.test(body)
  })())
  // 🔴 LLM 을 쓰지만 기존 경로만 쓴다
  check('🔴 새 HTTP 클라이언트를 만들지 않았다 — callProvider 를 쓴다',
    /from '\.\/lib\/voice-m3-provider\.mjs'/.test(runner) && !/new\s+\w*Client\(/.test(runner))
  check('🔴 러너가 직접 fetch 하지 않는다', !/\bfetch\(/.test(runner))
  check('🔴 LLM 에 원문 전문 · 댓글 · 작성자 · URL 을 보내지 않는다', (() => {
    // 🔴 시그니처가 아니라 **실제로 보내는 객체**만 본다 —
    //    타입 표기(`bodyHead: string`)가 검사에 걸리면 검사가 무의미해진다
    const i = runner.indexOf('return JSON.stringify({', runner.indexOf('buildGenPayload'))
    const body = runner.slice(i, runner.indexOf('})', i))
    return /sourceBodyHead/.test(body)
      && !/rawBody|comments|author|sourceUrl|\burl\b/i.test(body)
  })())
  check('🔴 보낼 때도 300자로 자른다', /bodyHead\.slice\(0, 300\)/.test(runner))
  check('🔴 LLM 초안도 기존 safetyFilter 로 다시 잰다',
    /safetyFilter\(\{ title: d\.title, body: d\.body \}\)\.verdict/.test(runner))
  check('🔴 --apply 단독은 거부한다', /APPLY && !CALL[\s\S]{0,60}fail\(/.test(runner))
  check('원천당 초안 상한이 있다', MAX_DRAFTS_PER_SOURCE === 2 && /MAX_DRAFTS_PER_SOURCE/.test(runner))
  check('promptVersion 을 기록한다', /DRAFT_PROMPT_VERSION/.test(runner))
  // 🔴 생성 캐시와 품질 캐시를 나눈다 — 품질만 바뀔 때 생성을 다시 하지 않는다
  check('🔴 생성 캐시 키와 품질 캐시 키가 다르다',
    /const genKey = `gen\|/.test(runner) && /`q\|\$\{/.test(runner))
  check('품질 키에 QUALITY_PROMPT_VERSION 이 들어간다',
    /QUALITY_PROMPT_VERSION\}\|\$\{DRAFT_MODEL\}/.test(runner))
  check('🔴 deterministic 에서 막힌 초안에는 모델을 부르지 않는다',
    /deterministic 에서 이미 막힌 것은 묻지 않는다/.test(readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')))
  check('계획이 기본이고 --apply 가 있어야 쓴다',
    /const APPLY = argv\.includes\('--apply'\)/.test(runner))
  check('🔴 기록 직전 provenance 를 검사한다', /violatesDraftProvenance/.test(runner))
  check('🔴 산출물은 데이터 디렉터리 안에만', /isInsideDataDir/.test(runner))
  check('엔트리포인트 가드가 있다', /isDirectRun/.test(runner))
}

console.log('\n⑨ 🔴 기존 경로를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-08).
  //    상수를 `RUNTIME_PROFILE` 에서 파생시키면서 `= 1` 리터럴이 사라졌다.
  //    원래 의도가 "값이 그대로인가" 였으므로 값으로 묻는 편이 더 강하다.
  check('POST_CAP_PER_WEEK = 1 그대로', POST_CAP_PER_WEEK === 1)
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', MIN_DAYS_BETWEEN_POSTS === 5)
  check('DAILY_PUBLISH_CAP = 1 그대로', DAILY_PUBLISH_CAP === 1)
  check('🔴 자동 발행은 여전히 human-curated 만 먹는다',
    /export const AUTO_MODEL = 'human-curated'/.test(readFileSync('src/lib/original-post-auto-publish.ts', 'utf-8')))
  check('🔴 템플릿 생성기도 같은 독창성 정본을 쓴다', (() => {
    const r = codeOf('scripts/lib/micro-seed-seed-originality.mts')
    return /from '\.\.\/\.\.\/src\/lib\/draft-originality'/.test(r) && /judgeCopy\(originality\)/.test(r)
  })())
}

// ── exact input — 🔴 이번에 판정하지 않은 원천으로 글을 쓰지 않는다 (§4-AU) ──
{
  const r = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  check('🔴 --input 으로 판정 결과 파일을 지정할 수 있다', /--input=/.test(r) && /shadowOverride/.test(r))
  check('🔴 지정이 없으면 종전대로 shadow 전체를 읽는다',
    /shadowOverride\(\) \?\? filesEnding\('\.shadow\.jsonl'\)/.test(r))
  check('🔴 shadow 가 아닌 경로는 받지 않는다', /endsWith\('\.shadow\.jsonl'\)/.test(r))
}

/**
 * 🔴 **필수 행동 검사** (2026-09-13) — 문구가 아니라 실제 경로를 본다.
 *    앞선 회차는 `DRAFT_QUALITY_AXES` 만 보고 "반말 허용 완료" 라고 보고했다.
 *    프롬프트는 그대로였고, 모델이 `informalSpeech` 를 돌려주면
 *    parser 가 그것을 다른 사유로 바꿔 HOLD 시켰다 — **실제 경로에는 허용이 없었다.**
 */
console.log('\n⑫ 🔴 생성 → 품질 → 채택 → 적재 전체 경로')
{
  const runner = codeOf('scripts/micro-seed-auto-draft.mts')

  // ── ① 품질 프롬프트가 축 목록에서 만들어진다 ──
  check('🔴 품질 프롬프트가 상수가 아니라 축에서 만들어진다',
    !/export const QUALITY_SYSTEM_PROMPT/.test(runner)
    && /export function buildQualitySystemPrompt/.test(runner))
  {
    const qp = buildQualitySystemPrompt()
    check('🔴 품질 프롬프트가 반말을 문제로 말하지 않는다',
      !/informalSpeech/.test(qp) && !/존댓말이다/.test(qp))
    check('🔴 품질 프롬프트가 질문 없음을 문제로 말하지 않는다', !/answerableQuestion/.test(qp))
    check('🔴 품질 프롬프트의 축이 DRAFT_QUALITY_AXES 와 정확히 같다', (() => {
      const named = DRAFT_QUALITY_AXES.filter((a) => qp.includes(`- ${a}:`))
      return named.length === DRAFT_QUALITY_AXES.length
        && !/- (informalSpeech|answerableQuestion):/.test(qp)
    })())
    check('🔴 품질 프롬프트가 소재로 막지 않는다고 말한다', /소재로 막지 않는다/.test(qp))
  }

  // ── ② 모르는 축이 다른 사유로 둔갑하지 않는다 ──
  {
    const v = parseQuality(JSON.stringify({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 0.95, issues: ['informalSpeech'] }))
    check('🔴 모르는 축이 genericWithoutSourceAngle 로 바뀌지 않는다',
      v !== null && v.issues.length === 0)
    check('🔴 모르는 축은 이름 그대로 남는다',
      v !== null && v.unknownIssues.includes('informalSpeech'))
    check('🔴 모르는 축만 있으면 통과가 아니라 schema 불일치다 (2026-09-13 정정)',
      applyQuality(v) === 'qualitySchemaMismatch')
  }

  // ── ③~⑥ 말투·맺음 end-to-end ──
  const e2e = (label: string, body: string, title = '간식 어떤 거 두고 드세요?'): string => {
    const d = draft({ title, body })
    const r = checkDraft(d, inp({ drafts: [d], quality: new Map([[1, okQ()]]) }))
    if (r !== 'ok') return r
    // 🔴 채택까지 갔으면 적재 단계도 같은 글을 받아야 한다
    const plan = planRefill({
      envelope: MACHINE_ENV, candidates: [machineCandidate({ title, body })],
      existing: new Set(), held: [], queue: [], usable: 0,
    })
    return plan.targets.length === 1 ? 'ok' : `적재 거부(${plan.skipped[0]?.code ?? '?'})`
  }
  for (const [label, body] of [
    ['반말', '지방대 원서 접수할 때면 버스나 기차 타고 가야 했어. 요즘은 인터넷으로 다 되니까 편하겠네.'],
    ['존댓말', '간식 떨어지면 허전해서 늘 뭔가 두게 되더라고요. 다들 어떠세요?'],
    ['혼합 말투', '요즘 자꾸 잠이 깨요. 진짜 미치겠다 ㅋㅋ 다들 이러시나요'],
    ['질문 없는 경험담', '문교부에서 컴퓨터를 줬어요. 그때 전산반에 들어갔어요. 참 오래된 얘기네요'],
    ['감탄·말줄임', '아휴… 오늘도 그냥 그렇게 지나갔네요'],
  ] as const) {
    check(`🟢 ${label} 초안이 품질·채택·적재까지 통과한다`, e2e(label, body) === 'ok')
  }

  // ── ⑦ 연예인 실명·방송명 보존 ──
  {
    const title = '차태현 술 끊었다는 얘기 남편한테 했더니'
    const body = '미운 우리 새끼 보다가 남편이 자기도 끊는다고 하네요. 사흘 갔어요 ㅋㅋ'
    check('🟢 연예인 실명과 방송명이 들어간 초안이 통과한다', e2e('연예', body, title) === 'ok')
    check('🔴 이름을 익명화하라고 시키지 않는다', (() => {
      const g = buildGenSystemPrompt({ title, bodyHead: body })
      return /사람 이름 · 프로그램 이름 · 작품 이름은 그대로 씁니다/.test(g)
        && /"어떤 배우" · "한 방송인" 으로 뭉개지 않습니다/.test(g)
    })())
    check('🟢 고유명사만 겹치는 것은 복제가 아니다',
      !judgeCopy(measureOriginality(body, `${title}\n차태현이 술을 끊었다고 미운 우리 새끼에서 말했다`)).copied)
  }

  // ── ⑧⑨ 위해만 차단 ──
  check('🔴 위해 축은 초안화하지 않는다', (() => {
    for (const r of BLOCKING_RISKS) {
      const p2 = pickDraft({
        judgement: { sourceArticleId: 'x', decision: 'AUTO_SEED', semanticRisks: [r] },
        drafts: [draft()], seenTitles: new Set(), seenBodies: new Set(), sourceUsed: false,
        quality: new Map([[1, okQ()]]),
      }, NOW)
      if (p2.decision !== 'AUTO_DROP' || p2.reason !== 'laneRisk') return false
    }
    return true
  })())
  check('🔴 차단 목록이 판정 단계 정본과 같다 — 두 벌로 적지 않는다',
    BLOCKING_RISKS.length === SEMANTIC_DROP.length
    && BLOCKING_RISKS.every((x) => (SEMANTIC_DROP as readonly string[]).includes(x)))
  check('🟢 소재 축(연예·건강·갈등)은 차단 목록에 없다',
    !['celebrityOrBroadcast', 'healthScheduleOrMedicalAdvice', 'hostilityOrConflictBait',
      'medicalAdvice', 'politicsOrPublicFigure', 'personalSpecificity']
      .some((x) => (BLOCKING_RISKS as readonly string[]).includes(x)))
  check('🔴 생성 프롬프트가 주제를 금지하지 않는다', (() => {
    const g = buildGenSystemPrompt({ title: '제목', bodyHead: '본문 머리입니다' })
    return !/쓰지 않습니다: 정치 · 공인 · 연예인/.test(g) && /이런 이야기도 우리 이야기입니다/.test(g)
  })())
  check('🔴 생성 프롬프트의 금지는 위해뿐이다', (() => {
    const g = buildGenSystemPrompt({ title: '제목', bodyHead: '본문 머리입니다' })
    return HARM_BANS.every((x) => g.includes(x))
  })())

  // ── ⑤ 실제 질문 소재는 질문을 유지 ──
  for (const [intent, title, body] of [
    ['묻는 글', '스케일링 몇 년에 한 번씩 받으세요?', '치과에서 자꾸 오라는데 다들 얼마 만에 가시나요? 궁금해서 여쭤봐요?'],
    ['조언 청하는 글', '형제들끼리 연봉 오픈하나요', '언니가 남편 연봉을 자꾸 물어요. 다들 어떻게들 하시는지 조언 좀 부탁드려요.'],
  ] as const) {
    const prof = readSourceProfile({ rawTitle: title, rawBody: body })
    const g = buildGenSystemPrompt({ title, bodyHead: body })
    check(`🔴 ${intent}(${prof.closingIntent})에서 질문을 살리라고 말한다`,
      /이 글은 묻는 글입니다/.test(g) && !/질문으로 끝나지 않아도 됩니다/.test(g))
  }
  {
    const title = '자꾸 반찬 보내는 엄마...'
    const body = '엄마가 자꾸 반찬을 택배로 보내세요. 그만 보내라고 해도 또 보내시고. 결국 버리게 되네요.'
    const g = buildGenSystemPrompt({ title, bodyHead: body })
    check('🟢 묻지 않는 글에서는 질문 없이 끝나도 된다고 말한다',
      /질문으로 끝나지 않아도 됩니다/.test(g) && !/이 글은 묻는 글입니다/.test(g))
  }

  // ── ⑩ 말투 근거 ──
  check('🔴 말투 샘플을 받을 자리가 있다', /voiceSamples/.test(runner))
  check('🟢 샘플이 있으면 프롬프트가 달라진다', (() => {
    const a = buildGenSystemPrompt({ title: '제목', bodyHead: '본문 머리입니다' })
    const b = buildGenSystemPrompt({
      title: '제목', bodyHead: '본문 머리입니다',
      voiceSamples: ['아이고 그러셨구나… 저도 비슷해요 ㅠㅠ'],
    })
    return a !== b && /말투 참고/.test(b) && !/말투 참고/.test(a)
  })())
  check('🔴 샘플이 다르면 프롬프트도 다르다 — 사람마다 다른 목소리', (() => {
    const x = buildGenSystemPrompt({ title: '제목', bodyHead: '본문', voiceSamples: ['그쵸 ㅋㅋ 저도요'] })
    const y = buildGenSystemPrompt({ title: '제목', bodyHead: '본문', voiceSamples: ['말씀 잘 들었습니다. 참 공감이 갑니다.'] })
    return x !== y
  })())
  check('🔴 샘플에서 내용을 가져오지 말라고 말한다', (() => {
    const b = buildGenSystemPrompt({ title: '제목', bodyHead: '본문', voiceSamples: ['샘플'] })
    return /내용을 가져오지 않습니다/.test(b) && /쓸 내용은 \[소재\] 에서 가져옵니다/.test(b)
  })())
  /**
   * 🔴 **말투 근거는 정본 Persona 에 묶인다** (2026-09-13).
   *    가짜 슬롯(`voice-a`)에 묶으면 matcher 가 그 이름을 모른다 — 연결이 끊긴다.
   *    🔴 후보를 만드는 것만으로 발행 자리를 잡지는 않는다: DB write 도 `matchedAt` 도 없고,
   *    발행 시 `hardFilter` 와 여력을 다시 본다.
   */
  check('🔴 말투 슬롯이 정본 Persona 코드다',
    PRODUCTION_PERSONA_CODES.length > 0
    && PRODUCTION_PERSONA_CODES.every((c) => isProductionPersonaCode(c)))
  // 🔴 "같은 원천이면 같은 Persona" 는 이제 해시가 아니라 `planVoicePersonas` 가 정한다 —
  //    그 결정성은 ⑭-c 가 **입력 순서를 뒤집어** 증명한다. 여기 옛 검사는 지웠다
  check('🔴 후보 생성이 발행 슬롯을 점유하지 않는다 — DB write 가 없다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return !/prisma/i.test(r) && !/matchedAt/.test(r) && !/personaActivityLog/i.test(r)
  })())
  check('🔴 후보에 말투 근거의 신원을 남긴다 — 텍스트도 작성자도 아니다',
    /voiceProvenance: voice\.provenanceFor/.test(runner))

  // ── ⑬ 옛 규칙과 죽은 주석 0건 ──
  check('🔴 옛 반말·질문·6글자 규칙이 코드에 남아 있지 않다', (() => {
    for (const f of ['src/lib/micro-seed-auto-draft.ts', 'scripts/micro-seed-auto-draft.mts',
      'src/lib/micro-seed-supply-autofill.ts', 'scripts/micro-seed-supply-autofill.mts']) {
      const c = codeOf(f)
      if (/informalSpeech|answerableQuestion|MAX_OVERLAP|isPoliteEnding|endsWithQuestion/.test(c)) return false
    }
    return true
  })())

  // ── ⑦ 실제 호출 상한이 코드로 관측된다 ──
  check('🔴 provider 요청을 코드가 센다', /class CallBudget/.test(runner) && /BUDGET\.take\(\)/.test(runner))
  check('🔴 상한이 재생성 횟수가 아니라 실제 요청 수다', (() => {
    const b = new CallBudget(2)
    return b.take() && b.take() && !b.take() && b.spent === 2 && b.left === 0
  })())
  check('🔴 상한은 원천 수에서 낸다 — 상수 하나로 두지 않는다',
    callBudgetOf(0) === 0 && callBudgetOf(10) === 10 * callBudgetOf(1) && callBudgetOf(1) > MAX_ORIGINALITY_RETRIES + 1)
  check('🔴 재생성 문구가 없는 경험을 지어내라고 시키지 않는다',
    !/당신의 자리에서 겪은/.test(retryDirective('x')) && /겪지 않은 일을 지어내지 않습니다/.test(retryDirective('x')))
}

/**
 * 🔴 **이번 보정의 필수 행동 검사** (2026-09-13).
 *    앞선 판은 "voiceProvenance 를 남긴다" 만 보고 완료로 처리했다.
 *    아무도 그 값을 읽지 않았는데도 통과했다 — 이제 **연결**을 본다.
 */
console.log('\n⑬ 🔴 cache 가 실제 프롬프트와 실제 본문을 본다')
{
  const runner = codeOf('scripts/micro-seed-auto-draft.mts')
  check('🔴 생성 cache key 가 system prompt digest 를 담는다',
    /genKey = [\s\S]*?digest16\(genSystem\)/.test(runner))
  check('🔴 품질 cache key 가 초안 본문 digest 를 담는다',
    /qKey = [\s\S]*?digest16\(`\$\{d\.title\}/.test(runner))
  check('🔴 품질 cache key 가 품질 프롬프트 digest 를 담는다', /qSystemDigest/.test(runner))
  check('🟢 말투 근거가 바뀌면 생성 key 가 바뀐다', (() => {
    const a = digest16(buildGenSystemPrompt({ title: 't', bodyHead: 'b', voiceSamples: ['그쵸 ㅋㅋ'] }))
    const b = digest16(buildGenSystemPrompt({ title: 't', bodyHead: 'b', voiceSamples: ['말씀 잘 들었습니다.'] }))
    const none = digest16(buildGenSystemPrompt({ title: 't', bodyHead: 'b' }))
    return a !== b && a !== none && b !== none
  })())
  check('🟢 본문이 바뀌면 품질 key 가 바뀐다',
    digest16('제목\n본문A') !== digest16('제목\n본문B'))
  check('🔴 판 값이 올라갔다 — 옛 회차와 섞이지 않는다',
    DRAFT_RULE_VERSION === 'auto-draft-v5'
    // 🔴 2026-09-14 — 나이대를 프롬프트에 넣었다. 옛 캐시를 재사용하지 않는다
    && DRAFT_PROMPT_VERSION === 'draft-gen-v6'
    && QUALITY_PROMPT_VERSION === 'draft-quality-v5')
  check('🔴 옛 cache 를 지우지 않고 무시할 수 있다 (--no-cache)',
    /const NO_CACHE = argv\.includes\('--no-cache'\)/.test(runner)
    && /if \(NO_CACHE\) return new Map\(\)/.test(runner))
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
    'scripts/original-post-auto-publish.mts',
    'scripts/supply-health.mts',
    'scripts/persona-capacity-planner.mts',
    'scripts/original-post-match-assign.mts',
    'scripts/original-post-persona-match-dry-run.mts',
  ]) {
    check(`🔴 ${f.split('/').pop()} 가 그 함수를 쓴다`, /voiceInputOf\(/.test(codeOf(f)))
  }
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
      existing: new Set(), held: [], queue: [], usable: 0,
    })
    return plan.targets.length === 0 && plan.skipped[0]?.code === 'PROFILE'
  })())
  check('🔴 깨진 voice 도 적재되지 않는다', (() => {
    const c = machineCandidate({ title: '제목입니다', body: '본문입니다 요즘 그렇더라고요' })
    const bad = { ...c, voiceProvenance: { personaCode: '', comments: 1, bundleDigest: 'x' } }
    const plan = planRefill({
      envelope: MACHINE_ENV, candidates: [bad as never],
      existing: new Set(), held: [], queue: [], usable: 0,
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
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return /planBundles\(\{ rows: asset\.rows, personaCodes: PRODUCTION_PERSONA_CODES \}\)/.test(r)
      && !/voice-a/.test(r)
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
    gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null, capturedAt: AT,
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
console.log('\n⑭-c 🔴 생성 전 Persona 선택 — 생활사 정본으로 고른다')
{
  const CARDS = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
  check('🔴 Persona 정체성의 정본은 Pool 카드 문서다 — 복제본을 만들지 않았다',
    CARDS.problems.length === 0 && CARDS.cards.length >= 20)
  const P = CARDS.cards.map(cardToPersona)
  const byCode = new Map(P.map((x) => [x.code, x]))
  const pick1 = (title: string, body: string): string | null =>
    planVoicePersonas({ sources: [{ sourceArticleId: 's1', title, body }], personas: P })
      .picks[0]!.personaCode

  /** 🔴 고른 사람이 그 소재를 **실제로** 쓸 수 있는가 — 정본 판정으로 다시 본다 */
  const conflictOf = (title: string, body: string): string[] => {
    const c = pick1(title, body)
    if (c === null) return ['HOLD']
    const p = byCode.get(c)!
    return hardFilter(p, readPostRequirements(title, body), title, body, {}).map((b) => b.code)
  }

  for (const [label, title, body, forbidden] of [
    ['남편 소재', '남편이랑 또 말다툼했어요', '미우새 보다가 남편이 자기도 술 끊는다고 하네요. 사흘 갔어요.', 'MARITAL_CONFLICT'],
    ['자녀 소재', '우리 애 중학교 들어가고 나서', '아이가 중학생이 되니 말수가 줄었어요. 담임 선생님 상담도 다녀왔고요.', 'NO_CHILDREN'],
    ['부모 돌봄 소재', '친정엄마 병간호 다녀왔어요', '엄마가 요양병원에 계셔서 주말마다 갑니다. 모시고 다니는 게 쉽지 않네요.', 'NO_PARENT_CARE'],
    ['갱년기 소재', '갱년기 때문에 잠을 못 자요', '새벽 세 시에 눈이 떠져요. 열이 확 오르고 안면홍조도 있고요.', 'MENOPAUSE_CONFLICT'],
  ] as const) {
    const bad = conflictOf(title, body)
    check(`🔴 ${label} → 생활사가 충돌하는 Persona 를 고르지 않는다`,
      !bad.includes(forbidden) && !bad.includes('HOLD'))
  }

  /** 🔴 생활사 요구가 없는 글은 고르게 나눈다 */
  {
    const plain = Array.from({ length: 12 }, (_, i) => ({
      sourceArticleId: `g${String(i).padStart(2, '0')}`,
      title: `오늘 김치를 담갔어요 ${i}`,
      body: '배추가 좋아서 스무 포기 했어요. 허리가 아프네요. 김장은 역시 힘드네요.',
    }))
    const r = planVoicePersonas({ sources: plain, personas: P })
    check('🟢 생활사 요구가 없으면 여러 Persona 에 퍼진다',
      Object.values(r.load).filter((n) => n > 0).length >= 8)
    check('🔴 한 사람에게 몰리지 않는다 — 편차 1 이하', loadSpread(r.load) <= 1)
    check('🔴 원천 ID modulo 로 몰리던 옛 방식이 아니다', (() => {
      const codes = r.picks.map((x) => x.personaCode)
      return new Set(codes).size === codes.length
    })())
  }

  /** 🔴 같은 입력이면 순서가 달라도 같은 답 */
  check('🔴 입력 순서를 뒤집어도 같은 배정', (() => {
    const src = Array.from({ length: 9 }, (_, i) => ({
      sourceArticleId: `x${i}`, title: `제목 ${i}`,
      body: '요즘 이런 일이 있었어요. 그냥 적어 봅니다. 다들 비슷하시겠지요.',
    }))
    const a = planVoicePersonas({ sources: src, personas: P })
    const b = planVoicePersonas({ sources: [...src].reverse(), personas: P })
    const key = (r: ReturnType<typeof planVoicePersonas>) =>
      r.picks.map((x) => `${x.sourceArticleId}:${x.personaCode}`).sort().join('|')
    return key(a) === key(b)
  })())

  /** 🔴 쓸 사람이 정말 없을 때만 생성 전 HOLD */
  check('🔴 말투 근거가 하나도 없으면 생성 전 HOLD', (() => {
    const r = planVoicePersonas({ sources: [{ sourceArticleId: 's', title: '제목', body: '본문' }], personas: [] })
    return r.picks[0]!.personaCode === null && r.picks[0]!.reason === 'noVoiceBundle'
  })())
  /**
   * 🔴 **소재를 이유로 멈추지 않는다** (2026-09-13).
   *    생활사가 맞는 사람이 없다는 것은 "그 사람이 그 사연의 주인공이 아니다" 일 뿐이다.
   *    옛 판은 여기서 원천을 통째로 HOLD 했고, 가족 · 자녀 · 돌봄 소재가 그렇게 사라졌다.
   */
  check('🟢 생활사가 맞는 사람이 없어도 소재를 버리지 않는다 — 사유만 남긴다', (() => {
    const unknownKid = { ...P[0]!, code: 'Z01', childrenCount: 1, childrenAgeBands: null }
    const r = planVoicePersonas({
      sources: [{ sourceArticleId: 's', title: '우리 애 중학교 들어가고', body: '우리 애가 중학생이 되니 말수가 줄었어요.' }],
      personas: [unknownKid],
    })
    return r.picks[0]!.personaCode === 'Z01' && r.picks[0]!.reason === 'noLifeFit'
      && r.picks[0]!.eligibleCount === 0
  })())

  /** 🔴 판정 함수를 복제하지 않았다 */
  check('🔴 생활사 판정을 복제하지 않고 정본을 부른다', (() => {
    const c = codeOf('src/lib/voice-persona-plan.ts')
    return /readPostRequirements/.test(c) && /judgeLifeHistory\(/.test(c)
      && !/maritalStatus|childrenAgeBands|parentCare|menopauseStatus/.test(c)
  })())
  /**
   * 🔴 **생성 전 선택은 생활사만 본다** (2026-09-13).
   *    active · 실회원 · 주간 cap · 최소 간격은 **발행 자리**의 조건이다.
   *    `hardFilter` 전체를 부르면 "이번 주에 이미 한 편 썼다" 는 이유로
   *    그 사람의 목소리로 **글을 쓰는 것 자체**가 막힌다.
   */
  check('🔴 생성 전 선택이 hardFilter 전체를 부르지 않는다', (() => {
    const c = codeOf('src/lib/voice-persona-plan.ts')
    return !/\bhardFilter\s*\(/.test(c)
      && !/postsThisWeek|daysSinceLastPost|accountCount|providerId|'active'/.test(c)
  })())
  check('🟢 이번 주 cap 을 다 쓴 사람도 생성에는 쓰인다 — 초안은 다음 주에 나가면 된다', (() => {
    const tired = P.map((x) => ({ ...x, postsThisWeek: 99, daysSinceLastPost: 0 }))
    const r = planVoicePersonas({
      sources: [{ sourceArticleId: 's', title: '오늘 김치를 담갔어요', body: '배추가 좋아서 스무 포기 했어요.' }],
      personas: tired,
    })
    return r.picks[0]!.personaCode !== null
  })())
  check('🔴 발행 직전에는 여전히 hardFilter 전체를 다시 본다', (() => {
    const tired = { ...P[0]!, postsThisWeek: 99 }
    return hardFilter(tired, readPostRequirements('제목', '본문'), '제목', '본문', {})
      .some((b) => b.code === 'WEEKLY_CAP')
  })())
  /**
   * 🔴 **Pool 카드와 창업자 확정값이 어긋나면 생성과 발행이 다른 사람을 본다** (2026-09-13).
   *    실측: P05 카드가 `중고생·초등`, 확정값은 `중고등·대학·취준` 이었다.
   *    카드 파서는 **매칭용 고유 밴드 집합**을 돌려주고 DB 는 **자녀별 밴드**를 담는다 —
   *    P17 의 `성인·성인` 은 성인 자녀 2명이라는 뜻이지 오류 중복이 아니다.
   *    그래서 대조는 **고유 집합끼리** 한다.
   */
  check('🔴 Pool 카드 자녀 나이대 = 창업자 확정값 (고유 집합 기준)', (() => {
    const uniq = (xs: readonly string[]): string => [...new Set(xs)].sort().join('·')
    for (const want of PLANNED) {
      const card = byCode.get(want.code)
      if (card === undefined) continue
      if (uniq(card.childrenAgeBands ?? []) !== uniq(want.bands)) return false
    }
    return true
  })())

  check('🔴 새 Persona registry 를 만들지 않았다 — 카드 문서가 정본이다', (() => {
    const c = codeOf('src/lib/voice-persona-plan.ts')
    return !/P0\d|PRODUCTION_PERSONA_CODES|const PERSONAS/.test(c)
  })())
  check('🔴 러너가 원천 ID 해시로 고르지 않는다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return !/voiceSlotOf/.test(r) && /planVoicePersonas/.test(r)
      && /parsePoolDoc/.test(r) && !/prisma/i.test(r)
  })())
  check('🔴 쓸 사람이 없으면 AI 를 부르기 전에 멈춘다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return /voice\.holdReasonFor\(j\.sourceArticleId\)/.test(r)
      && /voiceHeld \+= 1/.test(r)
  })())
  check('🔴 생성 후 다른 Persona 로 갈아 끼우는 fallback 이 없다', (() => {
    const vm = codeOf('src/lib/original-post-voice-match.ts')
    const vp = codeOf('src/lib/voice-persona-plan.ts')
    return !/COMPATIBLE|fallback|대체/.test(vm) && !/fallback/.test(vp)
      && /input\.voice\.personaCode === input\.personaCode/.test(vm)
  })())
  check('🔴 생성 시점에 DB write 도 슬롯 예약도 없다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    const vp = codeOf('src/lib/voice-persona-plan.ts')
    return !/prisma/i.test(r) && !/matchedAt/.test(r) && !/personaActivityLog/i.test(r)
      && !/from '(node:|@prisma)/.test(vp)
  })())
}

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

console.log('\n⑮ 🔴 생성된 글에도 위해 판정을 다시 한다')
{
  const HARM = (h: string) => okQ({ harms: [h] })
  for (const h of SEMANTIC_DROP) {
    check(`🔴 생성된 글에 ${h} 가 있으면 막힌다`,
      checkDraft(draft(), inp({ quality: new Map([[1, HARM(h)]]) })) === 'generatedHarm')
  }
  check('🔴 위해가 품질보다 먼저다 — 모델이 통과라 해도 막는다',
    applyQuality({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 1, issues: [], unknownIssues: [],
      harms: ['unverifiedDefamation'],
    }) === 'generatedHarm')
  check('🔴 위해 축 이름을 새로 만들지 않았다 — 판정 단계 정본 그대로다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return /\.\.\.SEMANTIC_DROP\.map/.test(r) && Object.keys(HARM_PROMPT).every((k) =>
      (SEMANTIC_DROP as readonly string[]).includes(k))
  })())
  check('🔴 모르는 위해 이름은 위해로 세지 않고 schema 불일치로 남는다', (() => {
    const v = parseQuality(JSON.stringify({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 0.9, harms: ['tooSpicy'], issues: [] }))
    return v !== null && v.harms.length === 0 && v.unknownIssues.includes('tooSpicy')
  })())
  // 🔴 소재는 그대로 통과해야 한다
  for (const [label, title, body] of [
    ['연예·방송', '차태현 술 끊었다는 얘기 남편한테 했더니', '미우새 보다가 남편이 자기도 끊는다고 하네요. 사흘 갔어요 ㅋㅋ'],
    ['건강·갱년기', '갱년기 때문에 잠을 못 자는데 다들 어떤가요', '새벽 세 시에 눈이 떠져요. 벌써 반년째라 낮에 너무 졸려요'],
    ['검사 주기 질문', '스케일링 몇 년에 한 번씩 받으세요?', '치과에서 자꾸 오라는데 다들 얼마 만에 가시는지 궁금해요'],
    ['가족 갈등', '시어머니랑 또 부딪혔어요', '명절마다 같은 얘기예요. 이번엔 저도 그냥 넘어가지지가 않더라고요'],
  ] as const) {
    check(`🟢 ${label} 소재가 통과한다`,
      checkDraft(draft({ title, body }), inp({ quality: new Map([[1, okQ()]]) })) === 'ok')
  }
}

console.log('\n⑯ 🔴 모르는 품질 축은 통과도 둔갑도 아니다')
{
  const only = parseQuality(JSON.stringify({ lifeConflict: null, decision: 'AUTO_ADOPT', confidence: 0.95, issues: ['bannedTopic'] }))
  check('🔴 우리 축이 아닌 이름만 왔으면 명시적으로 막는다',
    applyQuality(only) === 'qualitySchemaMismatch')
  check('🔴 콘텐츠 결함으로 위장하지 않는다',
    only !== null && !only.issues.includes('genericWithoutSourceAngle'))
  check('🔴 원래 문자열이 남는다', only !== null && only.unknownIssues.includes('bannedTopic'))
  check('🔴 pickDraft 까지 막힌다',
    checkDraft(draft(), inp({ quality: new Map([[1, only]]) })) === 'qualitySchemaMismatch')
  check('🔴 러너가 한 번은 다시 묻는다', (() => {
    const src = codeOf('scripts/micro-seed-auto-draft.mts')
    // 🔴 재요청 문구는 `schemaRetryDirective` 정본 하나로 모았다 (2026-09-13)
    return /schemaRetryDirective\(q\.value\.unknownIssues\)/.test(src)
      && schemaRetryDirective(['someUnknownAxis']).includes('우리 축이 아닌 이름이 있었다')
  })())
  check('🔴 provider 오류 · schema 오류 · 품질 HOLD 를 나눠 센다',
    /응답 \$\{\[\.\.\.grouped/.test(codeOf('scripts/micro-seed-auto-draft.mts')))
}

console.log('\n⑰ 🔴 원천당 실제 요청 상한')
{
  /**
   * 🔴 **원천당 상한이 아니라 공동 예산이다** (2026-09-13 정정).
   *    이름과 설명은 "원천 하나가 나가는 최대치" 였지만 구현은 처음부터 총량만 셌다.
   *    최악 경로는 생성1 + 검수2 + 재생성1 + 재검수2 = 6회로 4회를 넘는다.
   */
  check('🔴 공동 예산이다 — 원천당 상한이라고 부르지 않는다', (() => {
    const src = codeOf('scripts/micro-seed-auto-draft.mts')
    return CALL_ALLOWANCE_PER_SOURCE === 4 && callBudgetOf(1) === 4 && callBudgetOf(8) === 32
      && CALL_EXPECTED_PATH_PER_SOURCE === 6
      && !/MAX_CALLS_PER_SOURCE/.test(src)
      && /공동 예산/.test(src)
  })())
  check('🔴 원천별 사용량이 관측된다 — 누가 몰아 썼는지 보인다', (() => {
    const b = new CallBudget(10)
    b.enter('s1'); b.take(); b.take(); b.take()
    b.enter('s2'); b.take()
    return b.worstPerSource === 3 && b.perSource.get('s1') === 3 && b.perSource.get('s2') === 1
  })())
  check('🔴 원천을 지정하지 않은 요청도 총량에는 들어간다', (() => {
    const b = new CallBudget(3)
    b.take()
    return b.spent === 1 && b.worstPerSource === 0
  })())
  check('🔴 겹침 재생성은 원천당 1회', MAX_ORIGINALITY_RETRIES === 1)
  check('🔴 위해 판정에 별도 호출을 쓰지 않는다 — 품질 요청 안에 있다', (() => {
    const qp = buildQualitySystemPrompt()
    return SEMANTIC_DROP.every((h) => qp.includes(h)) && /"harms"/.test(qp)
  })())
  check('🔴 transport · json 재시도도 같은 예산에서 나간다', (() => {
    const r = codeOf('scripts/micro-seed-auto-draft.mts')
    return /'transportRetry'/.test(r) && /countCall\('jsonRetry'\)/.test(r)
  })())
  check('🔴 예산 소진은 조용한 중단이 아니라 명시 사유다',
    /status: 'budgetExhausted'/.test(codeOf('scripts/micro-seed-auto-draft.mts')))
}

console.log('\n⑱ 🔴 Persona 의 삶을 생성과 검수가 함께 본다 (2026-09-13)')
{
  // 🔴 정본 카드 — 여기서 Persona 를 만들지 않는다
  const P = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8')).cards.map(cardToPersona)
  const SINGLE: PersonaLifeHistory = {
    code: 'P-single', maritalStatus: '비혼', childrenCount: 0, childrenAgeBands: [],
    parentCare: '없음', menopauseStatus: '전',
  }
  const MARRIED: PersonaLifeHistory = {
    code: 'P-married', maritalStatus: '기혼', childrenCount: 2, childrenAgeBands: ['중고등'],
    parentCare: '상시', menopauseStatus: '진행중',
  }

  /**
   * 🔴 **"발행 직전 hardFilter 가 잡는다" 는 거짓이었다.**
   *    `hardFilter` 는 `readPostRequirements` 의 출력을 인자로 받는다 —
   *    extractor 가 놓친 것은 발행에서도 놓친다. 실측으로 고정한다.
   */
  check('🔴 extractor 가 놓치면 발행 hardFilter 도 놓친다 — 안전망이 아니다', (() => {
    const t = '어제 남편이 늦게 들어왔어요'
    const req = readPostRequirements(t, '')
    const p2 = {
      code: 'P-single', status: 'active', providerId: null, accountCount: 0,
      maritalStatus: '비혼', childrenCount: 0, childrenAgeBands: [],
      parentCare: '없음', menopauseStatus: '전', noGoTopics: [],
      postsThisWeek: 0, daysSinceLastPost: 30,
    }
    return !req.needsCurrentSpouse
      && !hardFilter(p2 as never, req, t, '', {}).some((b) => b.code === 'MARITAL_CONFLICT')
  })())

  // ── ① 생성 프롬프트가 Persona 의 삶을 알려 준다 ──
  const genSingle = buildGenSystemPrompt({ title: '남편 흉 좀 볼게요', bodyHead: '어제 남편이 늦게 들어왔어요.', persona: SINGLE })
  check('🔴 생성 프롬프트가 선택 Persona 의 생활사 네 가지를 담는다',
    ['혼인: 비혼', '자녀: 없음', '부모 돌봄: 없음', '갱년기: 전'].every((x) => genSingle.includes(x)))
  check('🟢 소재를 버리라고 하지 않는다 — 자리를 바꿔 쓰라고 한다',
    genSingle.includes('소재를 버리지 말고 자리를 바꿔 씁니다')
    && !/남편.{0,6}(?:쓰지 않습니다|금지)/.test(genSingle.replace('없는 자녀를', '')))
  check('🔴 없는 가족을 지어내지 말라고 한다',
    genSingle.includes('"우리 남편" 이라고 부르지 않습니다'))
  check('🔴 Persona 가 없으면 섹션 자체가 빠진다 — 빈 값을 지시로 읽히지 않는다', (() => {
    const g = buildGenSystemPrompt({ title: 'ㄱ', bodyHead: 'ㄴ' })
    return !g.includes('당신은 이런 사람입니다')
  })())
  check('🔴 Persona 가 다르면 프롬프트가 다르다 — cache key 가 갈린다', (() => {
    const a = buildGenSystemPrompt({ title: 'ㄱ', bodyHead: 'ㄴ', persona: SINGLE })
    const b = buildGenSystemPrompt({ title: 'ㄱ', bodyHead: 'ㄴ', persona: MARRIED })
    return a !== b
  })())
  check('🔴 말투 근거는 그대로 유지된다', (() => {
    const g = buildGenSystemPrompt({ title: 'ㄱ', bodyHead: 'ㄴ', persona: SINGLE, voiceSamples: ['아이고 참 그러네요'] })
    return g.includes('아이고 참 그러네요')
  })())

  // ── ② 검수가 같은 생활사를 본다 ──
  const q = buildQualitySystemPrompt(SINGLE)
  check('🔴 검수 프롬프트가 같은 생활사 줄을 본다',
    lifeHistoryLines(SINGLE).every((x) => q.includes(x.trim())))
  check('🔴 검수가 근거를 함께 요구한다', q.includes('"lifeConflict"') && q.includes('evidence'))
  check('🟢 소재로 판단하지 말라고 못박는다',
    q.includes('소재로 판단하지 않는다') && q.includes('애매하면 conflict=false'))
  check('🔴 Persona 가 없으면 이 절이 빠진다', !buildQualitySystemPrompt().includes('lifeConflict'))

  // ── ③ 판정 — 근거 있는 명백한 모순만 ──
  const V = (lc: { conflict: boolean; evidence: string } | null): DraftQualityVerdict => ({
    lifeConflict: lc, decision: 'AUTO_ADOPT', confidence: 0.9,
    issues: [], unknownIssues: [], harms: [],
  })
  check('🔴 근거 있는 모순은 막는다', applyQuality(V({ conflict: true, evidence: '우리 남편이 어제도' })) === 'lifeHistoryConflict')
  check('🟢 근거 없는 모순 주장은 막지 않는다', applyQuality(V({ conflict: true, evidence: '' })) === 'ok')
  check('🟢 모순 아님은 그대로 통과', applyQuality(V({ conflict: false, evidence: '' })) === 'ok')
  check('🔴 모델이 답하지 않았으면 "충돌 없음" 으로 읽지 않는다', (() => {
    const parsed = parseQuality('{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],"harms":[]}')
    return parsed !== null && parsed.lifeConflict === null && applyQuality(parsed) === 'ok'
  })())
  check('🔴 위해가 생활사보다 먼저다', (() => {
    const v = V({ conflict: true, evidence: 'x' })
    return applyQuality({ ...v, harms: ['identifiablePrivatePerson'] }) === 'generatedHarm'
  })())
  check('🔴 parseQuality 가 lifeConflict 를 읽는다', (() => {
    const parsed = parseQuality('{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],"harms":[],'
      + '"lifeConflict":{"conflict":true,"evidence":"우리 애가"}}')
    return parsed?.lifeConflict?.conflict === true && parsed.lifeConflict.evidence === '우리 애가'
  })())

  // ── ④ 다시 쓰기는 소재를 버리지 않는다 ──
  const rd = lifeConflictDirective(SINGLE, ['우리 남편이 어제도 늦게'])
  check('🔴 다시 쓰기 지시가 소재를 지키라고 말한다',
    rd.includes('소재는 그대로 씁니다') && rd.includes('당신이 서 있는 자리'))
  check('🔴 다시 쓰기 지시가 근거를 보여 준다', rd.includes('우리 남편이 어제도 늦게'))
  check('🔴 다시 쓰기는 기존 호출 예산 안이다 — 원천당 1회',
    MAX_LIFE_CONFLICT_RETRIES === 1 && CALL_ALLOWANCE_PER_SOURCE >= 4)

  // ── ⑤ 소재를 이유로 멈추지 않는다 ──
  check('🟢 생활사가 안 맞아도 원천을 버리지 않는다', (() => {
    const only = { ...P[0]!, code: 'Z01', maritalStatus: '비혼', childrenCount: 0, childrenAgeBands: [] }
    const r = planVoicePersonas({
      sources: [{ sourceArticleId: 's', title: '우리 남편이 또', body: '우리 남편이 어제도 늦게 들어왔어요.' }],
      personas: [only],
    })
    return r.picks[0]!.personaCode === 'Z01' && r.picks[0]!.reason === 'noLifeFit'
  })())
  check('🔴 연예·방송·의료·갈등·가족 소재만으로 멈추는 일이 없다', (() => {
    const SRC = [
      ['s1', '미우새 보다가', '연예인 아들 이야기가 나오는데 다들 어떻게 보세요?'],
      ['s2', '병원에서 들은 말', '갱년기 호르몬 치료 이야기를 들었어요.'],
      ['s3', '시어머니랑 또', '명절마다 같은 얘기를 하세요.'],
      ['s4', '우리 애 학원비', '중학생 학원비가 너무 올랐어요.'],
      ['s5', '친정엄마 간병', '요양병원에 다녀왔어요.'],
    ] as const
    const r = planVoicePersonas({
      sources: SRC.map(([id, title, body]) => ({ sourceArticleId: id, title, body })),
      personas: P,
    })
    return r.picks.every((x) => x.personaCode !== null)
  })())
  check('🔴 말투 근거가 하나도 없을 때만 멈춘다', (() => {
    const r = planVoicePersonas({ sources: [{ sourceArticleId: 's', title: 'ㄱ', body: 'ㄴ' }], personas: [] })
    return r.picks[0]!.personaCode === null && r.picks[0]!.reason === 'noVoiceBundle'
  })())
  check('🔴 같은 입력이면 같은 Persona 를 고른다 — 결정적이다', (() => {
    const src = Array.from({ length: 6 }, (_, i) => ({ sourceArticleId: `d${i}`, title: `제목 ${i}`, body: '본문입니다.' }))
    const a = planVoicePersonas({ sources: src, personas: P })
    const b = planVoicePersonas({ sources: src, personas: P })
    return a.picks.map((x) => x.personaCode).join(',') === b.picks.map((x) => x.personaCode).join(',')
  })())

  // ── ⑥ 죽은 코드 · 두 번째 정본이 없다 ──
  check('🔴 Persona 생활사 정본이 하나다 — 복제 상수도 두 번째 변환도 없다', (() => {
    const lib = codeOf('src/lib/micro-seed-auto-draft.ts')
    const runner = codeOf('scripts/micro-seed-auto-draft.mts')
    return /PersonaForMatch\['maritalStatus'\]/.test(lib)
      && !/const .*MARITAL|const .*BANDS *=|'기혼' *,/.test(runner)
      && !/noEligiblePersona/.test(codeOf('src/lib/voice-persona-plan.ts'))
  })())
}

console.log('\n⑲ 🔴 검수 응답을 **무엇을 물었는지와 함께** 읽는다 (2026-09-13)')
{
  const P1: PersonaLifeHistory = {
    code: 'P-x', maritalStatus: '비혼', childrenCount: 0, childrenAgeBands: [],
    parentCare: '없음', menopauseStatus: '전',
  }
  const DRAFT = '오늘 김치를 담갔어요\n배추가 좋아서 스무 포기 했어요. 허리가 아프네요.'
  const OK_JSON = '{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],"harms":[]'

  // ── ① Persona 있음 + lifeConflict 누락 → schema mismatch ──
  check('🔴 Persona 를 넘겨 물었는데 답이 없으면 통과가 아니다', (() => {
    const v = parseQuality(`${OK_JSON}}`, { persona: P1, draftText: DRAFT })
    return v !== null && v.unknownIssues.includes(LIFE_CONFLICT_MISSING)
      && applyQuality(v) === 'qualitySchemaMismatch'
  })())
  check('🔴 형식을 다시 일러 주는 문구가 생활사 누락을 짚는다',
    schemaRetryDirective([LIFE_CONFLICT_MISSING]).includes('lifeConflict')
    && schemaRetryDirective([LIFE_CONFLICT_MISSING]).includes('반드시'))
  check('🔴 계속 누락이면 명시적 HOLD 다 — 콘텐츠 사유로 둔갑하지 않는다', (() => {
    const v = parseQuality(`${OK_JSON}}`, { persona: P1, draftText: DRAFT })
    return applyQuality(v) === 'qualitySchemaMismatch'
      && applyQuality(v) !== 'lifeHistoryConflict' && applyQuality(v) !== 'ok'
  })())

  // ── ② Persona 없음 → 기존 동작 유지 ──
  check('🟢 Persona 없이 물었으면 lifeConflict 가 없어도 정상이다', (() => {
    const v = parseQuality(`${OK_JSON}}`)
    return v !== null && v.unknownIssues.length === 0 && applyQuality(v) === 'ok'
  })())
  check('🟢 사람 글 경로(비Persona)는 그대로다', (() => {
    const v = parseQuality(`${OK_JSON}}`, { draftText: DRAFT })
    return v !== null && applyQuality(v) === 'ok'
  })())

  // ── ③ 근거가 초안에 실제로 있을 때만 막는다 ──
  const withEv = (e: string): string =>
    `${OK_JSON},"lifeConflict":{"conflict":true,"evidence":${JSON.stringify(e)}}}`
  check('🔴 초안에 있는 근거는 충돌로 인정한다', (() => {
    const v = parseQuality(withEv('배추가 좋아서 스무 포기 했어요'), { persona: P1, draftText: DRAFT })
    return applyQuality(v) === 'lifeHistoryConflict'
  })())
  check('🟢 공백·문장부호 차이는 같은 문장으로 본다', (() => {
    const v = parseQuality(withEv('배추가 좋아서  스무 포기 했어요.'), { persona: P1, draftText: DRAFT })
    return applyQuality(v) === 'lifeHistoryConflict'
  })())
  check('🔴 초안에 없는 근거는 차단이 아니라 schema 재요청이다', (() => {
    const v = parseQuality(withEv('우리 남편이 어제 술 먹고 들어왔어요'), { persona: P1, draftText: DRAFT })
    return v !== null && v.unknownIssues.includes(LIFE_EVIDENCE_NOT_FOUND)
      && v.lifeConflict?.conflict === false
      && applyQuality(v) === 'qualitySchemaMismatch'
  })())
  check('🔴 지어낸 근거 재요청 문구가 "초안의 문장을 그대로" 라고 말한다',
    schemaRetryDirective([LIFE_EVIDENCE_NOT_FOUND]).includes('초안에 없는 문장'))
  check('🔴 evidence 대조는 초안을 실제로 본다 — 빈 근거는 못 찾은 것이다',
    !evidenceFoundIn('', DRAFT) && !evidenceFoundIn('없는 말', DRAFT)
    && evidenceFoundIn('허리가 아프네요', DRAFT))

  // ── ④ conflict=false → 통과 ──
  check('🟢 충돌 아님은 그대로 통과', (() => {
    const v = parseQuality(`${OK_JSON},"lifeConflict":{"conflict":false,"evidence":""}}`,
      { persona: P1, draftText: DRAFT })
    return applyQuality(v) === 'ok'
  })())

  // ── ⑤ 정본 로드 실패 → provider 호출 0 ──
  check('🔴 말투 자산·Persona 정본을 못 읽으면 생성 전에 멈춘다', (() => {
    const src = codeOf('scripts/micro-seed-auto-draft.mts')
    return /blockAllCode/.test(src)
      && /voiceAssetMissing/.test(src) && /personaCanonMissing/.test(src) && /noUsablePersona/.test(src)
      // 🔴 멈춤 판정이 **생성 호출보다 앞**에 있어야 한다
      && src.indexOf('const voiceHold') < src.indexOf('await callJson(system, payload, parseGen)')
      && !/말투 근거 없이 씁니다|프로파일만으로 씁니다/.test(src)
  })())
  check('🔴 멈출 때 원천마다 같은 원인 코드를 남긴다', (() => {
    const src = codeOf('scripts/micro-seed-auto-draft.mts')
    return /\$\{voice\.blockAllCode\}: \$\{voice\.holdReasonFor/.test(src)
  })())

  // ── ⑥ 재검수 계약 ──
  check('🔴 재검수를 못 받았으면 해소로 세지 않는다', (() => {
    const src = codeOf('scripts/micro-seed-auto-draft.mts')
    // 🔴 집계 정본은 `judgeLifeRetry` 하나다 — 러너가 조건을 다시 적지 않는다
    return /const outcome = judgeLifeRetry\(/.test(src)
      && /else lifeUnverified \+= 1/.test(src)
      && /해소 미확인/.test(src)
      && judgeLifeRetry([null]) === 'unverified'
  })())

  // ── ⑦ 소재·말투는 여전히 막지 않는다 ──
  check('🟢 반말·혼합 말투를 막는 축이 없다', (() => {
    const q = buildQualitySystemPrompt(P1)
    return q.includes('반말도') && !/informalSpeech|반말 금지/.test(q)
      && !(DRAFT_QUALITY_AXES as readonly string[]).some((a) => /speech|tone|formal/i.test(a))
  })())
  check('🟢 연예·방송·의료·갈등·가족 소재를 막지 말라고 못박는다', (() => {
    const q = buildQualitySystemPrompt(P1)
    return q.includes('소재로 막지 않는다') && q.includes('소재로 판단하지 않는다')
  })())
}

console.log('\n⑳ 🔴 생활사 재생성 집계 — 확인하지 못한 것을 성공으로 세지 않는다')
{
  const P2: PersonaLifeHistory = {
    code: 'P-y', maritalStatus: '비혼', childrenCount: 0, childrenAgeBands: [],
    parentCare: '없음', menopauseStatus: '전',
  }
  const DRAFT2 = '오늘 김치를 담갔어요\n배추가 좋아서 스무 포기 했어요. 허리가 아프네요.'
  /** 🔴 러너와 **같은 경로**로 만든다 — 조건을 fixture 에 다시 적지 않는다 */
  const v = (json: string): DraftQualityVerdict | null =>
    parseQuality(json, { persona: P2, draftText: DRAFT2 })
  const HEAD = '{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],"harms":[]'
  const CLEAR = v(`${HEAD},"lifeConflict":{"conflict":false,"evidence":""}}`)
  const CONFLICT = v(`${HEAD},"lifeConflict":{"conflict":true,"evidence":"허리가 아프네요"}}`)
  const MISSING = v(`${HEAD}}`)
  const FAKE_EV = v(`${HEAD},"lifeConflict":{"conflict":true,"evidence":"우리 남편이 어제"}}`)
  const CLEAR_BUT_HARM = v('{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],'
    + '"harms":["identifiablePrivatePerson"],"lifeConflict":{"conflict":false,"evidence":""}}')

  check('① 재검수 응답이 전부 없으면 unverified', judgeLifeRetry([null, null]) === 'unverified')
  check('② lifeConflict 누락(schema 불일치)은 unverified — fixed 가 아니다', (() => {
    return applyQuality(MISSING) === 'qualitySchemaMismatch'
      && judgeLifeRetry([MISSING]) === 'unverified'
  })())
  check('③ 지어낸 근거(evidenceNotFound)도 unverified', (() => {
    return FAKE_EV !== null && FAKE_EV.unknownIssues.includes(LIFE_EVIDENCE_NOT_FOUND)
      && judgeLifeRetry([FAKE_EV]) === 'unverified'
  })())
  check('④ 전부 근거 있는 conflict=true 면 held', judgeLifeRetry([CONFLICT, CONFLICT]) === 'held')
  check('⑤ 하나라도 명시적 conflict=false 면 fixed', (() => {
    return judgeLifeRetry([CONFLICT, CLEAR]) === 'fixed' && judgeLifeRetry([CLEAR]) === 'fixed'
  })())
  check('⑥ 생활사는 풀렸는데 다른 위해가 있으면 — 집계는 fixed, 글은 HOLD', (() => {
    return judgeLifeRetry([CLEAR_BUT_HARM]) === 'fixed'
      && applyQuality(CLEAR_BUT_HARM) === 'generatedHarm'
  })())
  /**
   * 🔴 **위해가 생활사 축을 덮지 않는다** (2026-09-14 경계 결함).
   *    `judgeLifeRetry` 가 `applyQuality` 를 쓰던 판에서는 위해가 먼저 반환돼
   *    **명백한 생활사 충돌이 `unverified`** 로 셌다 — 확인한 것을 못 한 것으로 센 셈.
   *    채택은 여전히 위해 우선 fail-closed 다. 두 축은 서로 가리지 않는다.
   */
  {
    const CONFLICT_HARM = v(`{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],`
      + `"harms":["identifiablePrivatePerson"],`
      + `"lifeConflict":{"conflict":true,"evidence":"허리가 아프네요"}}`)
    const CONFLICT_QUALITY = v(`{"decision":"AUTO_ADOPT","confidence":0.9,`
      + `"issues":["repetitiveWording"],"harms":[],`
      + `"lifeConflict":{"conflict":true,"evidence":"허리가 아프네요"}}`)
    check('⑦ 충돌 + 근거 확인 + 위해 → 생활사 held · 채택 generatedHarm',
      judgeLifeRetry([CONFLICT_HARM]) === 'held'
      && applyQuality(CONFLICT_HARM) === 'generatedHarm')
    /**
     * 🔴 채택 사유는 `lifeHistoryConflict` 다 — **생활사가 품질보다 앞**이라는
     *    기존 순서(위해 > 생활사 > 품질)를 이번에 바꾸지 않았다. 어느 쪽이든
     *    글은 HOLD 되고, **집계는 생활사 축만** 본다는 것이 여기서 보는 것이다.
     */
    check('⑧ 충돌 + 근거 확인 + 품질 HOLD → 생활사 held · 채택은 HOLD 계열',
      judgeLifeRetry([CONFLICT_QUALITY]) === 'held'
      && applyQuality(CONFLICT_QUALITY) === 'lifeHistoryConflict'
      // 🔴 같은 초안에서 생활사만 풀리면 그때 품질 사유가 드러난다
      && applyQuality(v(`{"decision":"AUTO_ADOPT","confidence":0.9,`
        + `"issues":["repetitiveWording"],"harms":[],`
        + `"lifeConflict":{"conflict":false,"evidence":""}}`)) === 'semanticHold')
    check('⑨ 해소(false) + 위해 → 생활사 fixed · 채택 generatedHarm',
      judgeLifeRetry([CLEAR_BUT_HARM]) === 'fixed'
      && applyQuality(CLEAR_BUT_HARM) === 'generatedHarm')
    check('🔴 집계가 채택 판정 함수를 부르지 않는다 — 축이 서로 가리지 않는다', (() => {
      const lib = codeOf('src/lib/micro-seed-auto-draft.ts')
      const fn = /export function judgeLifeRetry\([\s\S]*?\n\}/.exec(lib)?.[0] ?? ''
      const helper = /const lifeAxisOf = [\s\S]*?\n\}/.exec(lib)?.[0] ?? ''
      return fn !== '' && helper !== ''
        && !/applyQuality/.test(fn) && !/applyQuality/.test(helper)
        && !/harms/.test(fn) && !/harms/.test(helper)
        && !/issues\b/.test(fn)
    })())
  }
  check('🔴 운영 출력이 실제 의미를 말한다 — 한 가지 원인만 적지 않는다', (() => {
    const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    return /해소 미확인/.test(src)
      && !/재검수 못 받음/.test(src)
      && !/예산이 없어 \*\*재검수를 못 받은\*\*/.test(src)
      && /응답이 오지 않았거나/.test(src)
  })())
  check('🔴 확인 못 한 것과 막힌 것을 섞지 않는다', (() => {
    // 🔴 판정을 못 받은 것(null)이 섞여 있어도, 근거 있는 충돌만으로 막혔으면 held
    return judgeLifeRetry([CONFLICT, null]) === 'held'
      && judgeLifeRetry([MISSING, null]) === 'unverified'
  })())
  check('🔴 러너가 이 함수를 그대로 부른다 — 조건을 복제하지 않았다', (() => {
    const src = codeOf('scripts/micro-seed-auto-draft.mts')
    return /const outcome = judgeLifeRetry\(\[\.\.\.qmap\.values\(\)\]\)/.test(src)
      && !/rejudged|allConflict\(\) \? 'lifeHeld'/.test(src)
  })())
  check('🔴 채택 판정은 그대로 fail-closed 다 — 집계가 통과를 만들지 않는다', (() => {
    // 집계상 fixed 여도 applyQuality 는 여전히 막는다
    return judgeLifeRetry([CLEAR_BUT_HARM]) === 'fixed' && applyQuality(CLEAR_BUT_HARM) !== 'ok'
      && applyQuality(MISSING) !== 'ok' && applyQuality(FAKE_EV) !== 'ok'
  })())

  // ── 거짓 주석 정리 ──
  check('🔴 "자산 없으면 없이 간다" 는 낡은 주석이 남아 있지 않다', (() => {
    const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    return !/막지 않고 없이 간다|말투 근거 없이 씁니다|프로파일만으로 씁니다/
      .test(src.replace(/예전에는[^\n]*/g, ''))
      && /정본을 못 읽으면 machine 생성을 provider 호출 전에 멈춘다/.test(src)
  })())
  check('🔴 6회는 강제 상한이 아니라 기대치라고 적혀 있다', (() => {
    const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    return CALL_EXPECTED_PATH_PER_SOURCE === 6
      && /강제 상한이 아니라 설계상 기대치/.test(src)
      && /이 수를 넘을 수 있다/.test(src)
      && !/CALL_WORST_PATH/.test(src)
  })())
}

console.log('\n㉑ 🔴 나이·세대 관점 — 글쓴이 나이를 생성과 검수가 함께 본다 (2026-09-14)')
{
  /**
   * 🔴 **실측 결함.** 공개 Post `cmu0sjyll…` · Queue `cmu0ov5b3…` · 원천 34998885.
   *    40대 후반 P03 이 `우리 언니가 요즘 그 나이대(30~32)에 결혼 준비 중` 을 썼고
   *    `lifeConflict=false` 로 통과했다. 40대 후반의 **언니**가 30대 초반일 수는 없다.
   *
   *    원인은 하나였다 — `PersonaLifeHistory` 에 `ageBand` 가 없었다.
   *    생성 프롬프트도 검수 프롬프트도 **글쓴이가 몇 살인지 보지 못했다.**
   */
  const P03_LIKE: PersonaLifeHistory = {
    code: 'P03', ageBand: '40대 후반', maritalStatus: '기혼',
    childrenCount: 2, childrenAgeBands: ['중고등'], parentCare: '없음', menopauseStatus: '전',
  }

  // ── ① 정본이 실제로 흘러오는가 — 캐스트를 믿지 않고 값으로 본다 ──
  const cards = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8')).cards
  check('🔴 [회귀] cardToPersona 가 ageBand 를 실어 보낸다 (as 캐스트가 숨기던 자리)',
    cards.length > 0 && cards.every((c) => {
      const v = cardToPersona(c).ageBand
      return typeof v === 'string' && v.trim() !== ''
    }))
  check('🟢 정본 카드의 ageBand 를 그대로 옮긴다 — 보정하지 않는다',
    cards.every((c) => cardToPersona(c).ageBand === c.ageBand))
  check('🔴 [회귀] 러너의 lifeOf 가 ageBand 를 넘긴다',
    /code: card\.code, ageBand: card\.ageBand/.test(codeOf('scripts/micro-seed-auto-draft.mts')))

  // ── ② 두 프롬프트가 같은 줄을 본다 ──
  const lines = lifeHistoryLines(P03_LIKE)
  check('🔴 생활사 줄 맨 앞이 나이대다', lines[0] === '- 나이대: 40대 후반')
  const gen = buildGenSystemPrompt({
    title: '결혼 준비 이야기', bodyHead: '요즘 결혼 준비가 만만치 않네요',
    voiceSamples: ['그러게 말이야'], persona: P03_LIKE,
  })
  const qual = buildQualitySystemPrompt(P03_LIKE)
  check('🔴 생성 프롬프트가 나이대를 담는다', gen.includes('- 나이대: 40대 후반'))
  check('🔴 검수 프롬프트가 나이대를 담는다', qual.includes('- 나이대: 40대 후반'))
  check('🔴 [회귀] 생활사가 없으면 검수 프롬프트에 나이 절이 없다',
    !buildQualitySystemPrompt(undefined).includes('나이대'))

  // ── ③ 🔴 막는 것은 **관계의 나이 모순** 하나다 ──
  check('🔴 생성 프롬프트가 나올 수 없는 가족 관계를 막는다',
    gen.includes('당신 나이에서 나올 수 없는 가족 관계를 지어내지 않습니다'))
  // 🔴 나이는 **큰 검수가 아니라 집중 호출**이 본다 (2026-09-14 · shadow 2/2 실패 뒤 분리)
  check('🔴 [계약] 큰 품질 프롬프트에 나이 절차를 덧붙이지 않는다 — 비싸지고 묻힌다',
    !qual.includes('아래 순서로만 본다') && !qual.includes('우리 언니가 서른 하나'))
  check('🟢 큰 검수는 나이대를 **맥락으로만** 담는다', qual.includes('- 나이대: 40대 후반'))

  // ── ④ 🟢 반드시 허용해야 하는 것 — 프롬프트가 명시로 열어 둔다 ──
  const age = buildAgeCheckSystemPrompt('40대 후반')
  const allowed: [string, string][] = [
    ['일반적인 30대 결혼 이야기', '요즘 서른 넘어 결혼하는 사람이 많다'],
    ['자녀/조카/후배 세대', '"조카" · "후배" · "아는 집 딸" · "우리 애 또래"'],
    ['주변 관찰', '"주변 30대가" — 관찰이다'],
    ['실제 가능한 연상·연하', '"우리 언니가 쉰 넷"'],
    ['나이를 말하지 않은 가족 이야기', '모르면 어긋난 것이 아니다'],
  ]
  for (const [label, needle] of allowed) {
    check(`🟢 [허용] ${label} — 집중 검수가 conflict=false 로 열어 둔다`, age.includes(needle))
  }
  check('🔴 집중 검수는 나이 하나만 본다 — 소재·말투를 보지 않는다',
    age.includes('**소재 · 말투 · 재미 · 갈등은 보지 않는다.**'))
  check('🔴 집중 검수가 글쓴이 나이대를 직접 받는다', age.includes('글쓴이는 **40대 후반** 여성이다'))
  check('🔴 "그 나이대" 처럼 앞 문장을 받는 말도 나이 명시로 센다',
    age.includes('앞 문장을 받는 "그 나이대"'))
  check('🔴 ① 또는 ② 가 없으면 추측하지 않는다', age.includes('추측해서 세지 않는다'))
  check('🟢 집중 프롬프트는 짧다 — 큰 검수보다 작다', age.length < qual.length)
  check('🟢 [허용] 생성 프롬프트도 같은 것을 열어 둔다',
    gen.includes('나이 이야기를 못 한다는 뜻이 아닙니다')
    && gen.includes('아래 세대 이야기')
    && gen.includes('세대 차이에 대한 생각'))

  // ── ⑤ 🔴 소재·말투 규제가 늘지 않았다 ──
  check('🔴 [계약] 품질 축이 늘지 않았다 — 새 차단 축을 만들지 않는다',
    DRAFT_QUALITY_AXES.length === 6 && !DRAFT_QUALITY_AXES.some((a) => /age|generation|나이/i.test(a)))
  check('🔴 [계약] 사람 관계 낱말 목록·정규식을 만들지 않았다',
    !/RELATION_WORDS|FAMILY_WORDS|AGE_BAN|언니\|누나\|오빠/.test(codeOf('src/lib/micro-seed-auto-draft.ts')))
  check('🟢 [계약] 반말·혼합 말투는 그대로 허용된다',
    qual.includes('반말도 · 존댓말과 섞인 말투도'))
  check('🟢 [계약] 결혼·연예·방송·건강·갈등 소재는 그대로 허용된다',
    qual.includes('결혼 · 연예 · 방송 · 병원')
    && qual.includes('연예인 · 방송 · 드라마 · 건강 · 갱년기 · 병원 경험'))

  // ── ⑥ 모순이면 **소재를 버리지 않고 세대를 옮긴다** ──
  const dir = lifeConflictDirective(P03_LIKE, ['우리 언니가 요즘 그 나이대(30~32)에 결혼 준비 중'])
  check('🔴 재생성 지시가 나이대를 함께 보여 준다', dir.includes('- 나이대: 40대 후반'))
  check('🟢 재생성 지시가 소재를 버리라고 하지 않는다', dir.includes('**소재는 그대로 씁니다.**'))
  check('🟢 재생성 지시가 세대 전환을 제시한다',
    dir.includes('세대를 옮깁니다') && dir.includes('자녀 세대 이야기로')
    && dir.includes('조카/후배 이야기로') && dir.includes('주변에서 본 사례로'))
  check('🔴 재생성 지시가 근거 문장을 그대로 보여 준다', dir.includes('30~32'))

  // ── ⑦ 판정 경로 — 같은 lifeConflict 축을 그대로 쓴다 ──
  const DRAFT_BAD = '우리 언니가 요즘 그 나이대(30~32)에 결혼 준비 중이라 정신이 없어요.'
  const conflictJson = '{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],"harms":[],'
    + '"lifeConflict":{"conflict":true,"evidence":"우리 언니가 요즘 그 나이대(30~32)에 결혼 준비 중"}}'
  const vBad = parseQuality(conflictJson, { persona: P03_LIKE, draftText: DRAFT_BAD })
  /**
   * 🔴 **이 검사는 "모델이 잡는가" 가 아니다.** 검수 모델이 `conflict=true` 를 돌려줬을 때
   *    판정 경로가 그것을 재생성으로 잇는가만 본다.
   *    🔴 실제 모델(claude-haiku-4.5)이 이 사례를 잡는지는 **shadow 로만 확인된다** —
   *    2026-09-14 실측에서 보강 전후 2회 모두 **잡지 못했다**(§ PR 본문 · 설계 문서).
   */
  check('🔴 [판정 경로] conflict=true + 근거 확인 → lifeHistoryConflict',
    vBad !== null && applyQuality(vBad) === 'lifeHistoryConflict')
  check('🔴 그 회차는 재생성/HOLD 로 간다 (버리지 않는다)',
    vBad !== null && judgeLifeRetry([vBad]) === 'held')

  const okJson = '{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],"harms":[],'
    + '"lifeConflict":{"conflict":false,"evidence":""}}'
  for (const [label, draft] of [
    ['요즘 서른 넘어 결혼하는 사람이 많다', '요즘은 서른 넘어 결혼하는 사람이 많더라고요.'],
    ['주변 30대가 결혼을 준비한다', '주변 30대가 결혼을 준비하는 걸 보니 세상이 참 달라졌어요.'],
    ['자녀 세대 결혼 이야기', '우리 애 또래가 슬슬 결혼 이야기를 하네요.'],
    ['조카 세대 결혼 이야기', '조카가 서른 하나인데 결혼 준비를 한대요.'],
  ] as [string, string][]) {
    const v = parseQuality(okJson, { persona: P03_LIKE, draftText: draft })
    check(`🟢 [판정 경로 · 통과] ${label}`,
      v !== null && applyQuality(v) === 'ok' && judgeLifeRetry([v]) === 'fixed')
  }

  // 🔴 모순을 관점 변경으로 고치면 통과한다 — 한 번 다시 쓴 결과가 clear 면 fixed
  const FIXED = '조카가 요즘 그 나이대라 결혼 준비하는 걸 옆에서 보고 있어요.'
  const vFixed = parseQuality(okJson, { persona: P03_LIKE, draftText: FIXED })
  check('🟢 [판정 경로 · 재생성 성공] 모순을 세대 전환으로 고치면 통과한다',
    vBad !== null && vFixed !== null
    && judgeLifeRetry([vBad, vFixed]) === 'fixed' && applyQuality(vFixed) === 'ok')

  // 🔴 지어낸 근거로는 막지 않는다 (기존 계약 유지)
  const vFake = parseQuality(
    '{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[],"harms":[],'
    + '"lifeConflict":{"conflict":true,"evidence":"초안에 없는 문장"}}',
    { persona: P03_LIKE, draftText: DRAFT_BAD },
  )
  check('🔴 [계약] 초안에 없는 근거로는 막지 않는다',
    vFake !== null && vFake.unknownIssues.includes(LIFE_EVIDENCE_NOT_FOUND))

  // ── ⑧ 캐시 — 옛 프롬프트 결과가 hit 되지 않는다 ──
  const runnerSrc = codeOf('scripts/micro-seed-auto-draft.mts')
  check('🔴 생성 cache key 가 실제 프롬프트 digest 를 담는다',
    /genKey = `gen\|.*\|\$\{DRAFT_PROMPT_VERSION\}`/.test(runnerSrc)
    && /\+ `\|\$\{DRAFT_MODEL\}\|\$\{digest16\(genSystem\)\}`/.test(runnerSrc))
  check('🔴 품질 cache key 가 실제 프롬프트 digest 를 담는다',
    /qSystemDigest = digest16\(buildQualitySystemPrompt\(persona\)\)/.test(runnerSrc))
  check('🔴 [회귀] 나이대가 빠지면 프롬프트 digest 가 달라진다 — 옛 캐시가 hit 되지 않는다',
    digest16(buildQualitySystemPrompt(P03_LIKE))
    !== digest16(buildQualitySystemPrompt({ ...P03_LIKE, ageBand: undefined })))
  check('🔴 [회귀] 생성 프롬프트도 나이대가 빠지면 digest 가 달라진다', (() => {
    const t = { title: 'x', bodyHead: 'y', voiceSamples: ['z'] }
    return digest16(buildGenSystemPrompt({ ...t, persona: P03_LIKE }))
      !== digest16(buildGenSystemPrompt({ ...t, persona: { ...P03_LIKE, ageBand: undefined } }))
  })())

  // ── ⑩ 🔴 집중 나이 검수 — 기존 lifeConflict 칸으로 합쳐진다 (새 축 아님) ──
  check('🔴 [계약] 품질 축은 여전히 6개다', DRAFT_QUALITY_AXES.length === 6)
  check('🟢 근거 확인된 나이 충돌이 lifeConflict 로 합쳐진다',
    mergeLifeConflict(null, { conflict: true, evidence: '우리 언니가 서른 하나' })?.conflict === true)
  check('🟢 큰 검수가 이미 충돌이면 그대로 둔다',
    mergeLifeConflict({ conflict: true, evidence: 'a' }, { conflict: false, evidence: '' })?.evidence === 'a')
  check('🔴 근거 없는 나이 주장은 합치지 않는다',
    mergeLifeConflict({ conflict: false, evidence: '' }, { conflict: true, evidence: '' })?.conflict === false)
  check('🔴 둘 다 판정이 없으면 모른다(null) 그대로', mergeLifeConflict(null, null) === null)

  const AGE_DRAFT = '우리 언니가 서른 하나인데 결혼 준비 중이에요.'
  check('🟢 나이 검수 응답을 읽는다', (() => {
    const v = parseAgeCheck('{"conflict":true,"evidence":"우리 언니가 서른 하나"}', AGE_DRAFT)
    return v?.conflict === true && v.evidence === '우리 언니가 서른 하나'
  })())
  check('🔴 [계약] 초안에 없는 근거로는 막지 않는다 (지어낸 문장)',
    parseAgeCheck('{"conflict":true,"evidence":"초안에 없는 문장"}', AGE_DRAFT)?.conflict === false)
  check('🔴 JSON 이 아니면 null — 통과로 세지 않는다', parseAgeCheck('설명만 있다', AGE_DRAFT) === null)
  check('🔴 conflict 가 boolean 이 아니면 null', parseAgeCheck('{"conflict":"yes"}', AGE_DRAFT) === null)
  check('🔴 러너가 집중 호출을 붙이고 결과를 합친다',
    /buildAgeCheckSystemPrompt\(persona\.ageBand\)/.test(runnerSrc)
    && /mergeLifeConflict\(q\.value\.lifeConflict, age\)/.test(runnerSrc))
  check('🔴 집중 호출은 작은 토큰 상한을 쓴다', /AGE_CHECK_MAX_TOKENS/.test(runnerSrc))

  // ── ⑪ 🔴 ageBand 필수 — provider 호출 전에 멈춘다 ──
  check('🔴 [회귀] cardToPersona 가 `as PersonaForMatch` 캐스트를 쓰지 않는다',
    !/\} as PersonaForMatch/.test(codeOf('src/lib/persona-pool-card.ts')))
  check('🔴 ageBand 없는 Persona 는 생성 후보에서 빠진다',
    /const usable = withVoice\.filter\(hasAge\)/.test(runnerSrc))
  check('🔴 ageBand 있는 Persona 가 0명이면 provider 호출 전에 멈춘다',
    /blocked\('personaAgeBandMissing'/.test(runnerSrc)
    && runnerSrc.indexOf("blocked('personaAgeBandMissing'") < runnerSrc.indexOf('const { picks, load } = planVoicePersonas'))
  check('🔴 제외된 Persona 를 조용히 줄이지 않고 이름을 남긴다',
    /나이대\(ageBand\) 없어 제외/.test(runnerSrc))
  check('🟢 정본 카드 25명 전원 ageBand 가 있다', cards.every((c) => c.ageBand.trim() !== ''))

  // ── ⑫ 🔴 실측 — 합격한 모델이 없다. 사람 확인이 필요하다 ──
  check('🔴 합격 모델이 없다고 값으로 적혀 있다', AGE_CHECK_QUALIFIED_MODEL === null)
  check('🔴 세 모델 실측이 기록돼 있다',
    AGE_CHECK_MODEL_TRIAL.results.length === 3
    && AGE_CHECK_MODEL_TRIAL.results.every((r) => r.defects < 3))
  check('🔴 자동 발행 전 사람 확인이 필요하다고 명시돼 있다',
    MACHINE_AGE_HUMAN_REVIEW_REQUIRED === true
    && MACHINE_AGE_HUMAN_REVIEW_NOTE.includes('자동 발행 전 사람 확인'))
  check('🔴 러너가 회차마다 그 문장을 찍는다', /MACHINE_AGE_HUMAN_REVIEW_NOTE/.test(runnerSrc))

  // ── ⑨ 생성 voice 와 최종 author 동일성 ──
  check('🔴 [계약] 말투 근거 Persona 와 lifeOf 가 **같은 코드**를 본다',
    /const c = byId\.get\(id\)\?\.personaCode/.test(runnerSrc)
    && /const card = usable\.find\(\(x\) => x\.code === c\)/.test(runnerSrc))
  check('🔴 [계약] 최종 author 는 생성 말투와 이어진다 (voiceProvenance)',
    /voiceProvenance: voice\.provenanceFor\(a\.pick\.sourceArticleId\)/.test(runnerSrc)
    && /personaCode: c, comments: texts\.length/.test(runnerSrc))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
