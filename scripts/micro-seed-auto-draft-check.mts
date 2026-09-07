#!/usr/bin/env tsx
/**
 * 기계 초안 채택 fixture — 🔴 **사람의 ADOPT 를 사칭하지 않는다** (§4-AS)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  pickDraft, checkDraft, summarizeDrafts, violatesDraftProvenance,
  titleMatchesBody, overlapOk, hasBannedWord, normalize,
  hasRepetitiveWording, echoesTitleAtEnd, words, parseQuality, applyQuality,
  DRAFT_QUALITY_AXES, QUALITY_DROP, QUALITY_HOLD, DRAFT_MIN_CONFIDENCE,
  DRAFT_PROMPT_VERSION, QUALITY_PROMPT_VERSION, MAX_DRAFTS_PER_SOURCE,
  hasInformalSpeech, endsWithQuestion, isPoliteEnding, stripQuoted, sentences,
  AUTO_DRAFT_DECISIONS, HUMAN_DRAFT_DECISIONS, HUMAN_DRAFT_PROVENANCE,
  DRAFT_RULE_VERSION, DRAFT_PROVENANCE, MAX_OVERLAP, BANNED_WORDS,
  BLOCKING_RISKS, DRAFT_REASON_LABEL,
  type DraftCandidate, type PickInput,
} from '../src/lib/micro-seed-auto-draft'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const NOW = '2026-09-07T12:00:00.000Z'

const draft = (o: Partial<DraftCandidate> = {}): DraftCandidate => ({
  sourceArticleId: 's1', draftNo: 1,
  title: '간식 어떤 거 두고 드세요?',
  body: '간식 떨어지면 허전해서 늘 뭔가 두게 되더라고요. 다들 어떤 간식 두고 드세요?',
  safetyVerdict: 'pass', overlap: 2, generatedAt: NOW, ...o,
})
/** 🔴 품질 판정을 mock 한다 — fixture 는 네트워크를 쓰지 않는다 */
const okQ = (o: Partial<{ decision: string; confidence: number; issues: string[] }> = {}) =>
  ({ decision: 'AUTO_ADOPT', confidence: 0.9, issues: [], ...o }) as never
const inp = (o: Partial<PickInput> = {}): PickInput => ({
  judgement: { sourceArticleId: 's1', decision: 'AUTO_SEED', semanticRisks: [] },
  drafts: [draft()], material: '간식',
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
    judgement: { sourceArticleId: 's1', decision: 'AUTO_SEED', semanticRisks: ['celebrityOrBroadcast'] },
  }).reason === 'laneRisk')
  check('막는 위험이 6종', BLOCKING_RISKS.length === 6)
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
    [`원문 겹침 ${MAX_OVERLAP}자`, { overlap: MAX_OVERLAP }, 'overlapTooLong'],
    ['겹침 초과', { overlap: MAX_OVERLAP + 3 }, 'overlapTooLong'],
  ]
  for (const [label, patch, want] of cases) {
    check(`🔴 ${label} → ${want}`, checkDraft(draft(patch), inp()) === want)
  }
  check(`🟢 겹침 ${MAX_OVERLAP - 1}자는 통과`, overlapOk(MAX_OVERLAP - 1))
  check(`🔴 ${MAX_OVERLAP}자는 안 된다`, !overlapOk(MAX_OVERLAP))

  // 🔴 제품 금지어 (CLAUDE.md)
  for (const w of BANNED_WORDS) {
    check(`🔴 금지어 "${w}" 가 제목에 있으면 안 쓴다`,
      checkDraft(draft({ title: `${w} 이야기` }), inp()) === 'bannedWord')
    check(`🔴 본문에 있어도 안 쓴다`,
      checkDraft(draft({ body: `우리 ${w} 들은` }), inp()) === 'bannedWord')
  }
  check('금지어가 4종', BANNED_WORDS.length === 4)

  // 🔴 2026-09-07 에 실제로 나온 실패작 — "여행 가면 여행 어떻게 고르세요?"
  check('🔴 제목에 같은 낱말이 반복되면 안 쓴다',
    hasRepetitiveWording('여행 가면 여행 어떻게 고르세요?'))
  check('   checkDraft 가 이걸 잡는다',
    checkDraft(draft({ title: '여행 가면 여행 어떻게 고르세요?' }), inp()) === 'repetitiveWording')
  check('🟢 정상 제목은 통과', !hasRepetitiveWording('간식 어떤 거 두고 드세요?'))
  check('조사만 다른 것도 같은 낱말로 본다', hasRepetitiveWording('여행은 여행이 좋아요'))
  check('1자 낱말은 세지 않는다', !hasRepetitiveWording('그 사람 그 이야기'))
  check('낱말 쪼개기가 조사를 뗀다', words('여행을 간다').includes('여행'))

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

console.log('\n⑤ 🔴 제목과 본문이 같은 이야기여야 한다')
{
  check('🟢 소재가 양쪽에 있으면 통과', titleMatchesBody('간식 뭐 드세요', '간식 이야기예요', '간식'))
  check('🔴 제목에만 있으면 안 된다', !titleMatchesBody('간식 뭐 드세요', '날씨 이야기예요', '간식'))
  check('🔴 본문에만 있어도 안 된다', !titleMatchesBody('날씨 어때요', '간식 이야기예요', '간식'))
  check('띄어쓰기 차이는 같은 것으로 본다',
    titleMatchesBody('간 식 뭐 드세요', '간식 이야기', '간식'))
  // 🔴 v1 은 소재를 모르면 true 를 돌려줬다 — "검사 안 함" 이 "통과" 가 되어 버렸다
  check('🔴 소재를 모르면 통과가 아니다', !titleMatchesBody('아무 제목', '아무 본문', ''))
  check('🔴 소재를 모르는 글은 semantic 판정으로 넘어간다', (() => {
    // material 이 비어도 낱말 검사로 막지 않고, 품질 판정이 없으면 semanticUnavailable
    const r = checkDraft(draft(), { ...inp({ material: '' }), quality: undefined })
    return r === 'semanticUnavailable'
  })())
  check('checkDraft 가 이걸 본다',
    // 🔴 존댓말 · 질문은 갖췄지만 소재(간식)가 본문에 없다
    checkDraft(draft({ body: '오늘 날씨가 참 좋았어요. 다들 어떠셨나요?' }), inp()) === 'titleBodyMismatch')
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

console.log('\n⑤-b 🔴 반말을 막는다 — 2026-09-07 실측 3건')
{
  // 🔴 실제로 통과해 버린 문장들
  check('🔴 4234589 "신기하네" → 반말', hasInformalSpeech('커피맛이 자꾸 변한다니 신기하네'))
  check('🔴 4234589 "걸까?" → 반말', hasInformalSpeech('물맛이 영향을 주는 걸까?'))
  check('🔴 34999093 "말이야" → 반말', hasInformalSpeech('예쁘다고 잘 안 해주는데 말이야'))
  check('🔴 34999093 "몰라" → 반말', hasInformalSpeech('나도 잘 몰라'))
  check('🔴 448113 "전산반이었어" → 반말', hasInformalSpeech('우리 고등학교 전산반이었어'))

  check('🟢 존댓말은 통과', !hasInformalSpeech('간식 떨어지면 허전하더라고요. 다들 어떠세요?'))
  // 🔴 isPoliteEnding 은 **문장으로 쪼갠 뒤** 불린다 — 종결부호가 이미 떨어져 있다
  for (const e of ['요', '네요', '더라고요', '까요', '습니다', '세요', '거든요']) {
    check(`존댓말 종결 "${e}" 인정`, isPoliteEnding(`이러이러하${e}`))
  }
  for (const e of ['신기하네', '말이야', '몰라', '걸까', '이었어', '한다']) {
    check(`🔴 반말 종결 "${e}" 걸림`, !isPoliteEnding(e))
  }

  // 🔴 따옴표 안 인용문은 예외
  check('🔴 따옴표 안 반말은 봐준다',
    !hasInformalSpeech('AI 한테 "내 단점을 말해 줄 수 있어?" 라고 물어봤어요. 다들 해보셨나요?'))
  check('작은따옴표도 지운다', stripQuoted("그가 '왜 그래' 라고 했어요").includes('라고 했어요'))
  check('🔴 제목은 반말 판정을 하지 않는다 — 명사형이 자연스럽다', (() => {
    // 제목이 명사형이어도 본문이 존댓말+질문이면 통과한다
    const r = checkDraft(draft({ title: '돌담 아래 마신 맥주' }),
      inp({ material: '', quality: new Map([[1, okQ()]]) }))
    return r === 'ok'
  })())

  check('checkDraft 가 반말을 잡는다',
    checkDraft(draft({ body: '간식 이야기인데 신기하네. 왜 그럴까?' }), inp()) === 'informalSpeech')
  check('🔴 informalSpeech 는 정책이 HOLD 로 확정한다 — 모델 답과 무관',
    applyQuality({ decision: 'AUTO_ADOPT', confidence: 1, issues: ['informalSpeech'] }) === 'semanticHold')
  check('   HOLD 축 맨 앞에 있다', QUALITY_HOLD[0] === 'informalSpeech')
  check('품질 축이 8종이 됐다', DRAFT_QUALITY_AXES.length === 8)
  check('프롬프트에 실패 예시가 들어갔다', (() => {
    const r = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    return /신기하네/.test(r) && /말이야/.test(r) && /전산반이었어/.test(r)
  })())
}

console.log('\n⑤-c 🔴 본문 마지막에 실제 질문이 있어야 한다')
{
  check('🟢 물음표로 끝나면 통과', endsWithQuestion('이런 일이 있었어요. 다들 어떠세요?'))
  check('🟢 "~까요?" 도 통과', endsWithQuestion('그래서 궁금해요. 어떻게 하면 좋을까요?'))
  // 🔴 2026-09-07 실측 — "궁금해요." 로 끝난 글이 통과했다
  check('🔴 34999280 "궁금해요." 는 질문이 아니다',
    !endsWithQuestion('정말로 이 정도가 필요한 건지 궁금해요.'))
  check('🔴 "어때요" 도 물음표가 없으면 질문이 아니다', !endsWithQuestion('다들 어때요'))
  check('물음표 뒤 따옴표는 봐준다', endsWithQuestion('어떠세요?"'))
  // 🔴 448113 — intendedQuestion 필드만 있고 본문은 회고뿐이었다
  check('🔴 448113 회고만 있고 질문이 없으면 막힌다',
    !endsWithQuestion('문교부에서 전국 몇 개 학교만 골라서 컴퓨터를 줬어요. 그때 전산반에 들어갔어요.'))
  check('🔴 물음표가 앞쪽에만 있으면 마지막 질문이 아니다',
    !endsWithQuestion('왜 그럴까요? 그래서 그날 이후로 계속 그 생각만 하면서 지금까지 살아왔던 것 같아요.'))
  check('checkDraft 가 이걸 잡는다',
    checkDraft(draft({ body: '간식 이야기가 있었어요. 참 오래된 이야기예요.' }), inp()) === 'missingAnswerableQuestion')
  check('🔴 intendedQuestion 필드가 있다고 통과시키지 않는다 — 본문을 본다', (() => {
    // 🔴 판정 lib 은 intendedQuestion 을 아예 모른다. DraftCandidate 에 그 필드가 없다
    const lib2 = readFileSync('src/lib/micro-seed-auto-draft.ts', 'utf-8')
    const i = lib2.indexOf('export type DraftCandidate')
    return !lib2.slice(i, lib2.indexOf('}', i)).includes('intendedQuestion')
  })())
  check('문장 쪼개기가 종결부호를 본다', sentences('가요. 나요? 다요!').length === 3)
}

console.log('\n⑥-b 🔴 semantic 품질 판정 — 정책이 모델을 이긴다')
{
  check('품질 축 8종', DRAFT_QUALITY_AXES.length === 8)
  check('🔴 DROP 축과 HOLD 축이 겹치지 않는다',
    QUALITY_DROP.every((x) => !QUALITY_HOLD.includes(x)))
  check('🔴 판정을 못 받으면 통과가 아니다', applyQuality(null) === 'semanticUnavailable')
  check('🟢 깨끗하면 통과', applyQuality({ decision: 'AUTO_ADOPT', confidence: 0.9, issues: [] }) === 'ok')
  for (const a of QUALITY_DROP) {
    check(`🔴 ${a} → semanticDrop`,
      applyQuality({ decision: 'AUTO_ADOPT', confidence: 1, issues: [a] }) === 'semanticDrop')
  }
  for (const a of QUALITY_HOLD) {
    check(`🟡 ${a} → semanticHold`,
      applyQuality({ decision: 'AUTO_ADOPT', confidence: 1, issues: [a] }) === 'semanticHold')
  }
  check('🔴 모델이 통과라 해도 축이 있으면 통과가 아니다',
    applyQuality({ decision: 'AUTO_ADOPT', confidence: 1, issues: ['naturalKorean'] }) !== 'ok')
  check('🔴 모델이 버리라 해도 버릴 축이 없으면 HOLD',
    applyQuality({ decision: 'AUTO_DROP', confidence: 1, issues: [] }) === 'semanticHold')
  check(`🔴 confidence ${DRAFT_MIN_CONFIDENCE} 미만이면 HOLD`,
    applyQuality({ decision: 'AUTO_ADOPT', confidence: 0.5, issues: [] }) === 'lowConfidence')

  check('🔴 파싱 실패 → null', parseQuality('JSON 아님') === null)
  check('🔴 모르는 decision → null', parseQuality('{"decision":"YES","confidence":1}') === null)
  check('🔴 사람 값을 답해도 null', parseQuality('{"decision":"ADOPT","confidence":1}') === null)
  check('🟢 온전한 응답은 읽는다',
    parseQuality('{"decision":"AUTO_ADOPT","confidence":0.9,"issues":[]}') !== null)
  check('모르는 축 이름은 일반론으로 읽는다', (() => {
    const v = parseQuality('{"decision":"AUTO_ADOPT","confidence":0.9,"issues":["newAxis"]}')
    return v !== null && v.issues.includes('genericWithoutSourceAngle')
  })())

  // 🔴 deterministic 이 semantic 보다 먼저다
  check('🔴 모델이 통과라 해도 금지어는 막힌다', (() => {
    const r = checkDraft(draft({ title: '시니어 이야기' }), inp())
    return r === 'bannedWord'
  })())
  check('🔴 모델이 통과라 해도 겹침은 막힌다',
    checkDraft(draft({ overlap: 10 }), inp()) === 'overlapTooLong')
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
  check('POST_CAP_PER_WEEK = 1 그대로', /export const POST_CAP_PER_WEEK = 1\b/.test(m))
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', /export const MIN_DAYS_BETWEEN_POSTS = 5\b/.test(m))
  check('DAILY_PUBLISH_CAP = 1 그대로',
    /export const DAILY_PUBLISH_CAP = 1\b/.test(readFileSync('src/lib/original-post-publish.ts', 'utf-8')))
  check('🔴 자동 발행은 여전히 human-curated 만 먹는다',
    /export const AUTO_MODEL = 'human-curated'/.test(readFileSync('src/lib/original-post-auto-publish.ts', 'utf-8')))
  check('🔴 기존 템플릿 생성기를 수정하지 않았다',
    /export const MAX_SOURCE_OVERLAP = 6/.test(readFileSync('scripts/lib/micro-seed-seed-originality.mts', 'utf-8')))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
