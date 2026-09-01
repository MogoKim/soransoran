#!/usr/bin/env tsx
/**
 * 오리지널 게시글 초안 생성기 fixture — 🔴 LLM · DB · 네트워크 · 파일 IO 없음
 *
 * 🔴 프롬프트 조립과 응답 파싱을 순수 함수로 빼 둔 이유가 이 파일이다.
 *    돈을 쓰지 않고 "무엇을 시키는가 · 무엇을 받아들이는가 · 무엇을 저장하는가" 를
 *    전수로 확인한다.
 *
 * 실행: npx tsx scripts/original-post-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import { readFileSync } from 'node:fs'
import {
  buildPrompt, parseDraft, toOriginalPostRecord, assertNoStoredSource, analyzeDraft,
  isPostBoardHint, POST_BOARD_HINTS, ALLOWED_RECORD_KEYS, SOURCE_ECHO_MIN,
  RAW_BODY_MIN_CHARS, MAX_OUTPUT_TOKENS,
  PROMPT_BODY_MIN_CHARS, PROMPT_BODY_MAX_CHARS, PROMPT_TITLE_MAX_CHARS,
  CLICHE_POST_OPENERS, AI_STRUCTURE_BANS, MATERIAL_TAKEAWAYS,
  MAX_VOICE_SAMPLES, VOICE_TAKEAWAYS,
  CRITIQUE_BANNED_PHRASES, CRITIQUE_BANNED_REGISTERS, CRITIQUE_WATCH_PHRASES,
  partitionByStoredSource, sourceEchoCount, normalizeForEcho, selectByLengthQuantile,
  type PromptRawContent, type PromptBlockCode, type OriginalPostRecord,
} from './lib/original-post-prompt'
import {
  selectVoiceSamples, excludeReason,
  MIN_NATURALNESS, MIN_VOICE_RETENTION, MIN_ORIGINALITY_DELTA, MAX_RISK,
  EXCLUDED_MANUAL_CLASSES, VOICE_BUCKETS,
  type VoiceLearningRow, type ManualDecisionRow,
} from './lib/voice-sample-select'
import {
  readSourceProfile, profileDirectives, SORANSORAN_ADDRESS, BRIGHT_REGISTER_KEEPS,
  mustKeepDetails, MUST_KEEP_KINDS, titleDirectives, originTraceHitsIn,
} from './lib/source-profile'
import { READ_QUERIES, UNAO_READABLE_TABLES } from './lib/voice-unao-readonly.mjs'
import {
  PROVIDER_KEY_ENV, GEMINI_RESPONSE_MIME, ANTHROPIC_JSON_PREFILL, keyStatus,
} from './lib/voice-m3-provider.mjs'
import {
  apiModelIdFor, M3_MODEL_CANDIDATES, isMaxTokensReached, outputTokenPolicyFor,
} from './lib/voice-m3-contract.mjs'
import { BRAND_BANNED_WORDS } from '../src/lib/content-guard'
import { SOURCE_SPECIFIC_TERMS, SORANSORAN_REGISTER_TERMS, TARGET_DESCRIPTOR_TERMS } from './lib/voice-style-signals.mjs'
import {
  MIN_POST_TITLE_LENGTH, MAX_POST_TITLE_LENGTH,
  MIN_POST_CONTENT_LENGTH, MAX_POST_CONTENT_LENGTH,
} from '../src/lib/post-policy'

let failed = 0
let passed = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = actual === want
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}

/** 🔴 fixture 원문 — 실제 수집물이 아니다. 이 파일은 DB 를 읽지 않는다 */
const RAW_BODY =
  '요 며칠 새벽에 자꾸 깹니다. 이불을 걷었다 덮었다 하다 보면 어느새 네 시가 넘어 있고, ' +
  '그때부터는 다시 잠들기가 어렵습니다. 낮에는 멍하니 앉아 있다가 하루가 다 가버리는 것 같아요. ' +
  '병원에 가야 하나 싶다가도 이 정도로 유난이라고 할까 봐 망설여집니다. ' +
  '주변에서는 다들 그러려니 하고 넘긴다는데 저만 유독 힘든 건지 모르겠습니다. ' +
  '남편은 코를 골며 잘 자는 걸 보면 괜히 서운해지기도 하고요.'

const raw = (over: Partial<PromptRawContent> = {}): PromptRawContent => ({
  id: 'raw-fixture-0001',
  rawTitle: '새벽에 자꾸 깨는 게 저만 그런가요',
  rawBody: RAW_BODY,
  sourceSite: '82cook',
  ...over,
})

const sysOf = (over: Partial<PromptRawContent> = {}, board = 'MENOPAUSE'): string => {
  const p = buildPrompt({ raw: raw(over), boardHint: board })
  return p.ok ? p.prompt.systemPrompt : ''
}

console.log('\n══════ ① 게시판 힌트')
{
  expect('MENOPAUSE 는 유효', isPostBoardHint('MENOPAUSE'), true)
  expect('FREE 는 유효', isPostBoardHint('FREE'), true)
  expect('🔴 MAGAZINE 은 유효하지 않다', isPostBoardHint('MAGAZINE'), false)
  expect('  BEST 도 아니다', isPostBoardHint('BEST'), false)
  expect('  빈 문자열 아님', isPostBoardHint(''), false)
  expect('  숫자 아님', isPostBoardHint(1), false)
  expect(`힌트 ${POST_BOARD_HINTS.length}종`, POST_BOARD_HINTS.length, 2)
}

console.log('\n══════ ② 프롬프트 차단 조건')
{
  const blocked = (over: Partial<PromptRawContent>, board = 'MENOPAUSE'): PromptBlockCode[] => {
    const p = buildPrompt({ raw: raw(over), boardHint: board })
    return p.ok ? [] : p.blocks.map((b) => b.code)
  }
  expect('정상 입력은 통과', blocked({}).length, 0)
  expect('id 없음 → RAW_ID_EMPTY', blocked({ id: '  ' }).join(','), 'RAW_ID_EMPTY')
  expect('제목 없음 → RAW_TITLE_EMPTY', blocked({ rawTitle: '' }).join(','), 'RAW_TITLE_EMPTY')
  expect('본문 없음 → RAW_BODY_EMPTY', blocked({ rawBody: '   ' }).join(','), 'RAW_BODY_EMPTY')
  // 🔴 짧은 원문으로 긴 글을 쓰라고 하면 모델이 없는 이야기를 지어낸다
  expect(
    `본문 ${RAW_BODY_MIN_CHARS}자 미만 → RAW_BODY_TOO_SHORT`,
    blocked({ rawBody: '가'.repeat(RAW_BODY_MIN_CHARS - 1) }).join(','),
    'RAW_BODY_TOO_SHORT',
  )
  expect('  경계값은 통과한다', blocked({ rawBody: '가'.repeat(RAW_BODY_MIN_CHARS) }).length, 0)
  expect('알 수 없는 게시판 → BOARD_HINT_INVALID', blocked({}, 'MAGAZINE').join(','), 'BOARD_HINT_INVALID')
  expect('🔴 차단은 전부 모아 돌려준다', blocked({ id: '', rawTitle: '' }, 'BEST').length, 3)
}

console.log('\n══════ ③ 🔴 프롬프트가 실제로 무엇을 시키는가')
{
  const sys = sysOf()
  expect('복붙 금지가 가장 앞에 온다', sys.includes('옮겨 적는 것이 아닙니다'), true)
  expect('  한 조각도 그대로 쓰지 말라', sys.includes('한 조각도 그대로 쓰지 않습니다'), true)
  expect('  살짝 바꿔 옮기는 것도 막는다', sys.includes('말을 살짝 바꿔 옮기는 것도 안 됩니다'), true)
  // 🔴 2026-09-01 정책 변경. 이전 판은 숫자·날짜·약을 통째로 막았고 그 결과
  //    글에서 구체성이 전부 걷혔다(#7). 이제 **특정 개인이 드러나는 것만** 막는다
  expect('  개인 특정 정보만 차용 금지', sys.includes('실명 · 상호 · 병원 이름 · 정확한 주소'), true)
  expect('  🔴 시간·약·검사·수치는 살리라고 말한다', sys.includes('지우지 않습니다'), true)
  expect('    내 경우의 같은 종류로 쓰라', sys.includes('**내 경우의 같은 종류**'), true)
  expect('    느낌만 남으면 기계 글이라고 말한다', sys.includes('느낌만 남은 글이 기계가 쓴 글'), true)
  expect('  문단 순서 따라가기 금지', sys.includes('문단 순서를 따라가지 않습니다'), true)
  // 🔴 금지만 주면 모델은 남은 흔한 자리로 옮겨 간다 — 무엇을 가져올지 함께 준다
  const missingTakeaway = MATERIAL_TAKEAWAYS.filter((t) => !sys.includes(t))
  expect(`  가져올 것 ${MATERIAL_TAKEAWAYS.length}종 전부 명시`, missingTakeaway.join(','), '')
  expect('  내 이야기를 얹으라고 말한다', sys.includes('원문에 없던 당신의 하루'), true)

  expect('출처 노출 금지 섹션', sys.includes('출처가 드러나면 안 됩니다'), true)
  expect('  옮긴 글이라고 말하지 말라', sys.includes('어느 카페에서 봤는데'), true)
  expect('  등업 같은 출처 맥락어 차단', sys.includes('등업'), true)

  expect('금지 낱말 4종 전부', BRAND_BANNED_WORDS.filter((w) => !sys.includes(w)).join(','), '')
  expect('  타겟 설명어 금지 섹션', sys.includes('우리를 설명하지 않습니다'), true)
  expect('  설명하지 않는다는 이유까지', sys.includes('서로를 설명하지 않습니다'), true)

  const missingOpener = CLICHE_POST_OPENERS.filter((o) => !sys.includes(o))
  expect(`상투적 시작 ${CLICHE_POST_OPENERS.length}종 전부 명시`, missingOpener.join(','), '')
  const missingStruct = AI_STRUCTURE_BANS.filter((b) => !sys.includes(b))
  expect(`AI 구조 ${AI_STRUCTURE_BANS.length}종 전부 명시`, missingStruct.join(','), '')
  expect('  교훈으로 끝내지 말라', sys.includes('끝에 교훈을 붙이지 않습니다'), true)
  expect('  조언·진단 금지', sys.includes('진단·처방·약 이름·용량'), true)

  expect('길이 하한이 있다', sys.includes(`${PROMPT_BODY_MIN_CHARS}~${PROMPT_BODY_MAX_CHARS}자`), true)
  expect('  하한의 이유까지 말한다', sys.includes('원문 요약이 됩니다'), true)
  expect('  제목 권장 상한', sys.includes(`${PROMPT_TITLE_MAX_CHARS}자 이내`), true)
  expect('  정책 상한도 함께', sys.includes(`${MAX_POST_TITLE_LENGTH}자`), true)
  expect('출력 형식은 JSON 하나', sys.includes('{"title": "제목", "body": "본문"}'), true)
}

console.log('\n══════ ④ 🔴 출처 호칭은 site 별로 달라진다')
{
  const sys82 = sysOf({ sourceSite: '82cook' })
  const term82 = SOURCE_SPECIFIC_TERMS.filter((t) => t.site === '82cook').map((t) => t.term)
  expect('82cook 호칭이 명시된다', term82.every((t) => sys82.includes(t)), true)
  // 🔴 치환 결과를 함께 준다 — 금지만 주면 모델이 아무 호칭도 못 쓴다
  expect('  우리 호칭을 알려준다', SORANSORAN_REGISTER_TERMS.every((t) => sys82.includes(t)), true)

  const sysCafe = sysOf({ sourceSite: 'navercafe:remonterrace' })
  expect('레테 호칭이 명시된다', sysCafe.includes('레테님들'), true)
  // 🔴 사이트별 섹션만 본다. 전역 호칭 정책 섹션(2026-09-01 신설)은 목록 전체를 싣는다 —
  //    거기까지 포함해 보면 "다른 사이트 호칭이 들어갔다" 로 잘못 걸린다
  const siteSection = (sysText: string): string => {
    const a = sysText.indexOf('출처가 드러나면 안 됩니다')
    const b = sysText.indexOf('## 🔴 우리를 설명하지 않습니다')
    return a === -1 || b === -1 ? '' : sysText.slice(a, b)
  }
  expect('  🔴 사이트별 섹션에 다른 출처 호칭이 없다', siteSection(sysCafe).includes('82님들'), false)
  expect('    82cook 쪽은 반대로', siteSection(sys82).includes('레테님들'), false)

  const sysUnknown = sysOf({ sourceSite: 'unknown-site' })
  expect('모르는 출처여도 지시는 남는다', sysUnknown.includes('다른 커뮤니티의 호칭을 쓰지 않습니다'), true)
}

console.log('\n══════ ⑤ 🔴 원문은 프롬프트에만 실린다')
{
  const p = buildPrompt({ raw: raw(), boardHint: 'MENOPAUSE' })
  const sys = p.ok ? p.prompt.systemPrompt : ''
  const user = p.ok ? p.prompt.userPayload : ''
  expect('원문은 user 쪽에 있다', user.includes(RAW_BODY), true)
  expect('🔴 system 에는 원문이 없다', sys.includes(RAW_BODY), false)
  expect('  system 에 원문 제목도 없다', sys.includes('새벽에 자꾸 깨는 게'), false)
  expect('재료임을 user 가 못박는다', user.includes('옮겨 적지 마세요'), true)
  // 🔴 sourceSite 는 치환 판정에만 쓴다. **이 글이 어디서 왔는지**를 알려주면 그게 새어 나온다.
  //    단, 2026-09-01 부터 출처 흔적 **금지 목록**에는 서비스 이름이 실린다(막으려면 이름을 대야 한다).
  //    그래서 "이 글의 출처가 X 다" 라는 사실이 새는지만 본다 — user 쪽과 사이트별 섹션이다.
  expect('🔴 재료 쪽에 출처 사이트명이 없다', user.includes('82cook'), false)
  expect('  🔴 "이 글은 82cook 에서 왔다" 는 말이 없다', sys.includes('출처: 82cook') || sys.includes('82cook 에서'), false)
  expect('maxOutputTokens', p.ok ? p.prompt.maxOutputTokens : 0, MAX_OUTPUT_TOKENS)
}

console.log('\n══════ ⑥ 응답 파싱')
{
  const okRes = parseDraft('{"title":"  제목입니다  ","body":"  본문입니다 조금 더 적어 둡니다  "}')
  expect('정상 JSON', okRes.ok, true)
  expect('  title trim', okRes.ok ? okRes.title : '', '제목입니다')
  expect('  body trim', okRes.ok ? okRes.body : '', '본문입니다 조금 더 적어 둡니다')

  // 🔴 M3 에서 Haiku 5건이 ```json 때문에 전멸했다
  const fenced = parseDraft('```json\n{"title":"제목","body":"본문을 열 자 넘게 적습니다"}\n```')
  expect('🔴 코드블록 울타리 (M3 Haiku 사고)', fenced.ok, true)
  expect('  언어 없는 울타리', parseDraft('```\n{"title":"제목","body":"본문을 열 자 넘게 적습니다"}\n```').ok, true)
  // 🔴 Anthropic prefill 로 여는 중괄호가 빠진 응답
  expect('🔴 prefill (여는 중괄호 없음)', parseDraft('"title":"제목","body":"본문을 열 자 넘게 적습니다"}').ok, true)

  const code = (r: ReturnType<typeof parseDraft>): string => (r.ok ? '(ok)' : r.errorCode)
  expect('빈 응답 → EMPTY', code(parseDraft('   ')), 'EMPTY')
  expect('JSON 아님 → JSON_PARSE', code(parseDraft('제목: 어쩌고')), 'JSON_PARSE')
  expect('title 없음 → FIELD_MISSING', code(parseDraft('{"body":"본문"}')), 'FIELD_MISSING')
  expect('body 없음 → FIELD_MISSING', code(parseDraft('{"title":"제목"}')), 'FIELD_MISSING')
  expect('body 가 문자열이 아님 → FIELD_MISSING', code(parseDraft('{"title":"제목","body":123}')), 'FIELD_MISSING')

  const t = (n: number) => `{"title":"${'가'.repeat(n)}","body":"${'나'.repeat(100)}"}`
  expect(`제목 ${MIN_POST_TITLE_LENGTH}자 미만 → TITLE_TOO_SHORT`, code(parseDraft(t(MIN_POST_TITLE_LENGTH - 1))), 'TITLE_TOO_SHORT')
  expect('  경계 통과', code(parseDraft(t(MIN_POST_TITLE_LENGTH))), '(ok)')
  expect(`제목 ${MAX_POST_TITLE_LENGTH}자 초과 → TITLE_TOO_LONG`, code(parseDraft(t(MAX_POST_TITLE_LENGTH + 1))), 'TITLE_TOO_LONG')
  expect('  경계 통과', code(parseDraft(t(MAX_POST_TITLE_LENGTH))), '(ok)')

  const b = (n: number) => `{"title":"제목","body":"${'나'.repeat(n)}"}`
  expect(`본문 ${MIN_POST_CONTENT_LENGTH}자 미만 → BODY_TOO_SHORT`, code(parseDraft(b(MIN_POST_CONTENT_LENGTH - 1))), 'BODY_TOO_SHORT')
  expect('  경계 통과', code(parseDraft(b(MIN_POST_CONTENT_LENGTH))), '(ok)')
  expect(`본문 ${MAX_POST_CONTENT_LENGTH}자 초과 → BODY_TOO_LONG`, code(parseDraft(b(MAX_POST_CONTENT_LENGTH + 1))), 'BODY_TOO_LONG')
  expect('  경계 통과', code(parseDraft(b(MAX_POST_CONTENT_LENGTH))), '(ok)')
}

console.log('\n══════ ⑦ 🔴 원문 저장 금지 계약')
{
  const rec = toOriginalPostRecord({ sourceRawContentId: ' raw-1 ', title: ' 제목 ', body: ' 본문 ' })
  expect('레코드 키는 셋뿐', Object.keys(rec).length, 3)
  expect('  허용 키 목록과 일치', Object.keys(rec).sort().join(','), [...ALLOWED_RECORD_KEYS].sort().join(','))
  expect('  sourceRawContentId trim', rec.sourceRawContentId, 'raw-1')
  expect('  title trim', rec.title, '제목')
  expect('  body trim', rec.body, '본문')

  const threw = (fn: () => void): boolean => {
    try { fn(); return false } catch { return true }
  }
  expect('정상 레코드 → 통과', threw(() => assertNoStoredSource([rec], [RAW_BODY])), false)

  // 🔴 원문 연속 20자를 담으면 막는다
  const echo = RAW_BODY.replace(/\s+/g, ' ').trim().slice(0, 40)
  const leaky = { sourceRawContentId: 'raw-1', title: '제목', body: echo } as OriginalPostRecord
  expect(`원문 연속 ${SOURCE_ECHO_MIN}자 포함 → throw`, threw(() => assertNoStoredSource([leaky], [RAW_BODY])), true)
  // 🔴 제목에 숨겨도 막힌다 — 필드를 가리지 않고 레코드 전체를 본다.
  //    🔴 눈금이 **공백 제거 후 20자** 라 25자로는 모자란다(공백이 8자쯤 섞인다).
  //       Gate ① 과 같은 기준이다 — 여기서 완화하면 두 눈금이 또 갈린다.
  const leakyTitle = { sourceRawContentId: 'raw-1', title: echo, body: '본문' } as OriginalPostRecord
  expect('  제목에 숨겨도 막힌다', threw(() => assertNoStoredSource([leakyTitle], [RAW_BODY])), true)

  // 🔴 타입 밖에서 만든 객체도 막는다 — 타입은 이 파일을 거칠 때만 유효하다
  for (const key of ['rawBody', 'rawTitle', 'sourceUrl', 'sourceSite', 'author']) {
    const bad = { sourceRawContentId: 'raw-1', title: '제목', body: '본문', [key]: 'x' } as unknown as OriginalPostRecord
    expect(`  허용 외 필드 ${key} → throw`, threw(() => assertNoStoredSource([bad], [])), true)
  }
  expect(`${SOURCE_ECHO_MIN}자 미만 source 는 건너뛴다`, threw(() => assertNoStoredSource([rec], ['짧다'])), false)
}

console.log('\n══════ ⑧ 🔴 초안 신호 — 판정이 아니라 세어 본 값')
{
  // 복붙 초안
  const copied = analyzeDraft({
    title: '제목', body: RAW_BODY, sourceTexts: [RAW_BODY],
  })
  expect('복붙이면 연속20자가 잡힌다', copied.sourceEchoCount > 0, true)
  expect('  어절 공유도 높다', copied.sharedWordRatio > 0.8, true)

  // 우리 말로 다시 쓴 초안
  const rewritten = analyzeDraft({
    title: '이불만 걷었다 덮었다',
    body: '어제는 라디오를 켜 두고 앉아 있었습니다. 소리가 있으면 좀 낫더라고요. 다들 어떻게 지내시는지 궁금합니다.',
    sourceTexts: [RAW_BODY],
  })
  expect('다시 쓰면 연속20자 0', rewritten.sourceEchoCount, 0)
  expect('  어절 공유는 낮다', rewritten.sharedWordRatio < 0.3, true)
  expect('  상투 시작 없음', rewritten.clicheOpener, null)
  expect('  출처 흔적 없음', rewritten.sourceMarkers.length, 0)
  expect('  금지 낱말 없음', rewritten.bannedTerms.length, 0)
  expect('  구조 흔적 없음', rewritten.structureFlags.length, 0)

  // 🔴 잡아야 하는 것들
  expect('상투적 시작을 잡는다',
    analyzeDraft({ title: 'ㅇ', body: '요즘 들어 자꾸 그럽니다', sourceTexts: [] }).clicheOpener, '요즘 들어')
  expect('출처 호칭을 잡는다',
    analyzeDraft({ title: 'ㅇ', body: '82님들 안녕하세요', sourceTexts: [] }).sourceMarkers.includes('82님들'), true)
  expect('  등업도 잡는다',
    analyzeDraft({ title: 'ㅇ', body: '등업을 해야 보이더라고요', sourceTexts: [] }).sourceMarkers.includes('등업'), true)
  expect('금지 낱말을 잡는다',
    analyzeDraft({ title: 'ㅇ', body: `${BRAND_BANNED_WORDS[0]} 이야기`, sourceTexts: [] }).bannedTerms.length, 1)
  expect('타겟 설명어를 잡는다',
    analyzeDraft({ title: 'ㅇ', body: `${TARGET_DESCRIPTOR_TERMS[0]} 안녕하세요`, sourceTexts: [] }).bannedTerms.length > 0, true)
  expect('번호 목록을 잡는다',
    analyzeDraft({ title: 'ㅇ', body: '1. 첫째\n2. 둘째', sourceTexts: [] }).structureFlags.includes('번호 목록'), true)
  expect('  불릿도 잡는다',
    analyzeDraft({ title: 'ㅇ', body: '- 하나\n- 둘', sourceTexts: [] }).structureFlags.includes('불릿'), true)
  expect('  마크다운 강조도 잡는다',
    analyzeDraft({ title: 'ㅇ', body: '**중요**합니다', sourceTexts: [] }).structureFlags.includes('마크다운'), true)

  // 🔴 띄어쓰기만 바꾼 복붙을 놓치지 않는다
  const spaced = RAW_BODY.slice(0, 40).replace(/ /g, '')
  expect('띄어쓰기만 바꾼 복붙도 잡는다',
    analyzeDraft({ title: 'ㅇ', body: spaced, sourceTexts: [RAW_BODY] }).sourceEchoCount > 0, true)

  expect('길이를 센다', analyzeDraft({ title: '가나', body: '다라마', sourceTexts: [] }).titleLength, 2)
  expect('  본문 길이', analyzeDraft({ title: '가나', body: '다라마', sourceTexts: [] }).bodyLength, 3)
  expect('source 없으면 유출 0', analyzeDraft({ title: 'ㅇ', body: RAW_BODY, sourceTexts: [] }).sourceEchoCount, 0)
}

console.log('\n══════ ⑨ 🔴 생성기 스크립트가 지켜야 할 것 (정적 검사)')
{
  const code = readFileSync('scripts/original-post-generate.mts', 'utf-8')
  // 🔴 상한 5 (2026-09-01, 3 → 5). 길이 네 구간을 3자리로는 못 덮는다.
  //    그 이상 올리면 검토 부담이 사람에게 넘어간다 — 30건은 5건씩 여섯 번이다
  expect('MAX_LIMIT = 5', /const MAX_LIMIT = 5\b/.test(code), true)
  expect('  --limit 범위를 검사한다', code.includes('LIMIT > MAX_LIMIT'), true)
  // 🔴 dry-run 이 기본이다
  expect('--call 없이는 호출하지 않는다', code.includes("const CALL = argv.includes('--call')"), true)
  expect('  dry-run 은 파일을 쓰지 않는다', /if \(!CALL\)[\s\S]{0,400}process\.exit\(0\)/.test(code), true)
  // 🔴 발행·적재 경로가 아예 없어야 한다
  expect('🔴 Post 를 만들지 않는다', /post\.create|post\.upsert/.test(code), false)
  expect('🔴 --enqueue 가 없다', code.includes('--enqueue'), false)
  expect('🔴 publish 경로가 없다', /publishCandidateTx|--apply/.test(code), false)
  expect('🔴 personaId 를 채우지 않는다', code.includes('personaId'), false)
  // 🔴 크롤하지 않는다 — 네트워크는 LLM 하나뿐이다
  expect('🔴 직접 fetch 하지 않는다', /\bfetch\(/.test(code), false)
  expect('  API 는 provider 로만 부른다', code.includes("from './lib/voice-m3-provider.mjs'"), true)
  // 🔴 저장 직전 실측 방어를 반드시 거친다
  // 🔴 2026-09-01 7판 — 배치 전체 검사에서 **레코드별 검사**로 바뀌었다.
  //    한 건이 걸려 깨끗한 두 건까지 버려진 사고 때문이다
  const PART_CALL = 'partitionByStoredSource(records, allSources)'
  expect('🔴 레코드별로 가른다', code.includes(PART_CALL), true)
  expect('  🔴 대조 대상이 둘이다 (원문 + 말투 샘플)',
    code.includes('[...sourceTexts, ...voiceSampleBodies]'), true)
  expect('  걸린 것만 제외하고 나머지는 저장한다', code.includes('const merged = [...existing, ...clean]'), true)
  expect('  🔴 제외 건수를 화면에 알린다', code.includes('원문 조각이 섞인 ${leaking.length}건은 저장하지 않습니다'), true)
  expect('  저장 건수도 알린다', code.includes('생성 ${records.length}건 → 저장 ${clean.length}건'), true)
  expect('  전부 걸리면 exit 1', code.includes('저장 가능한 초안이 0건입니다'), true)
  // 🔴 통과한 것만 한 번 더 본다 — 두 눈금이 갈리면 여기서 던진다
  expect('  통과분에 assert 를 한 번 더 건다', code.includes('assertNoStoredSource(clean, allSources)'), true)
  expect('  writeFileSync 보다 앞이다',
    code.indexOf(PART_CALL) < code.indexOf('writeFileSync(OUTPUT_PATH'), true)
  // 🔴 원문·초안 전문을 찍지 않는다
  expect('출력은 brief 를 거친다', code.includes('const brief'), true)
  expect('  프롬프트는 해시로만 남긴다', code.includes('sha ${digest(systemPrompt)}'), true)
}


console.log('\n══════ ⑩ 🔴 말투 샘플 선별 — voice engine 배선')
{
  const row = (over: Partial<VoiceLearningRow> = {}): VoiceLearningRow => ({
    sourceRef: 'ref-ok', bucket: 'voice_gold',
    naturalnessScore: 85, voiceRetention: 80, originalityDelta: 70,
    overSanitizedRisk: 10, overMimicryRisk: 10, expressionRisk: 20, sequenceSimilarityRisk: 5,
    hasIdentifyingDetail: false, isPrivateTopic: false, speakerVerified: true,
    ...over,
  })
  const none = undefined

  expect('기준을 다 넘으면 통과', excludeReason(row(), none), null)

  // 🔴 사람 판정이 자동 점수를 이긴다
  for (const cls of EXCLUDED_MANUAL_CLASSES) {
    expect(`  사람이 뺀 것(${cls}) → MANUAL_EXCLUDED`,
      excludeReason(row(), { sourceRef: 'ref-ok', class: cls }), 'MANUAL_EXCLUDED')
  }
  expect('  남성 화자 힌트 → MALE_HINT',
    excludeReason(row(), { sourceRef: 'ref-ok', class: 'humanVoiceApproved', speakerHint: 'male' }), 'MALE_HINT')
  expect('  행 자체의 speakerHint 도 본다', excludeReason(row({ speakerHint: 'male' }), none), 'MALE_HINT')

  // 🔴 story_topic 은 말투가 아니다 — 화자 성별 무관이라 말투로 쓰면 안 된다
  expect('story_topic → BUCKET_NOT_VOICE', excludeReason(row({ bucket: 'story_topic' }), none), 'BUCKET_NOT_VOICE')
  expect('  held → BUCKET_NOT_VOICE', excludeReason(row({ bucket: 'held' }), none), 'BUCKET_NOT_VOICE')
  expect(`  말투 bucket 은 ${VOICE_BUCKETS.length}종`, VOICE_BUCKETS.join(','), 'voice_gold,voice_silver')
  expect('  silver 는 통과', excludeReason(row({ bucket: 'voice_silver' }), none), null)

  // 🔴 식별 디테일·민감 주제는 샘플로 넣는 순간 생성물로 흘러갈 길이 열린다
  expect('식별 디테일 → IDENTIFYING_DETAIL', excludeReason(row({ hasIdentifyingDetail: true }), none), 'IDENTIFYING_DETAIL')
  expect('민감 주제 → PRIVATE_TOPIC', excludeReason(row({ isPrivateTopic: true }), none), 'PRIVATE_TOPIC')

  // 🔴 신호가 없으면 통과가 아니라 제외다 — 없는 것을 좋은 것으로 읽지 않는다
  expect('신호 누락 → SIGNAL_MISSING', excludeReason(row({ naturalnessScore: null }), none), 'SIGNAL_MISSING')
  expect('  위험 신호 누락도', excludeReason(row({ overMimicryRisk: null }), none), 'SIGNAL_MISSING')

  expect(`naturalness ${MIN_NATURALNESS} 미만 → SIGNAL_BELOW_MIN`,
    excludeReason(row({ naturalnessScore: MIN_NATURALNESS - 1 }), none), 'SIGNAL_BELOW_MIN')
  expect('  경계값은 통과', excludeReason(row({ naturalnessScore: MIN_NATURALNESS }), none), null)
  expect(`voiceRetention ${MIN_VOICE_RETENTION} 미만 → SIGNAL_BELOW_MIN`,
    excludeReason(row({ voiceRetention: MIN_VOICE_RETENTION - 1 }), none), 'SIGNAL_BELOW_MIN')
  expect(`originalityDelta ${MIN_ORIGINALITY_DELTA} 미만 → SIGNAL_BELOW_MIN`,
    excludeReason(row({ originalityDelta: MIN_ORIGINALITY_DELTA - 1 }), none), 'SIGNAL_BELOW_MIN')
  expect(`위험 ${MAX_RISK} 초과 → RISK_ABOVE_MAX`,
    excludeReason(row({ overMimicryRisk: MAX_RISK + 1 }), none), 'RISK_ABOVE_MAX')
  expect('  경계값은 통과', excludeReason(row({ overMimicryRisk: MAX_RISK }), none), null)

  // 🔴 정렬이 결정적이어야 한다 — 샘플이 매번 바뀌면 프롬프트 효과를 분리할 수 없다
  const rows: VoiceLearningRow[] = [
    row({ sourceRef: 'b-silver-high', bucket: 'voice_silver', naturalnessScore: 99 }),
    row({ sourceRef: 'a-gold-low', bucket: 'voice_gold', naturalnessScore: 70 }),
    row({ sourceRef: 'c-human', bucket: 'voice_silver', naturalnessScore: 70 }),
  ]
  const decisions: ManualDecisionRow[] = [{ sourceRef: 'c-human', class: 'humanVoiceApproved' }]
  const plan = selectVoiceSamples({ rows, decisions, limit: 3 })
  expect('사람 승인이 가장 앞', plan.picked[0]?.sourceRef, 'c-human')
  expect('  그 다음 gold', plan.picked[1]?.sourceRef, 'a-gold-low')
  expect('  점수 높아도 silver 는 뒤', plan.picked[2]?.sourceRef, 'b-silver-high')
  const again = selectVoiceSamples({ rows: [...rows].reverse(), decisions, limit: 3 })
  expect('🔴 입력 순서가 달라도 결과가 같다',
    again.picked.map((p) => p.sourceRef).join(','), plan.picked.map((p) => p.sourceRef).join(','))

  expect('limit 만큼만 고른다', selectVoiceSamples({ rows, decisions, limit: 2 }).picked.length, 2)
  expect('  limit 0 이면 0건', selectVoiceSamples({ rows, decisions, limit: 0 }).picked.length, 0)

  // 🔴 같은 글이 gold·silver 양쪽에 있어도 한 번만
  const dup = selectVoiceSamples({
    rows: [row({ sourceRef: 'same', bucket: 'voice_gold' }), row({ sourceRef: 'same', bucket: 'voice_silver' })],
    decisions: [], limit: 3,
  })
  expect('중복 sourceRef 는 한 번만', dup.picked.length, 1)
  expect('  gold 쪽이 남는다', dup.picked[0]?.bucket, 'voice_gold')
  expect('  검토 건수도 1', dup.considered, 1)

  // 제외 사유 집계
  const mixed = selectVoiceSamples({
    rows: [row({ sourceRef: 'x1', hasIdentifyingDetail: true }), row({ sourceRef: 'x2', bucket: 'story_topic' })],
    decisions: [], limit: 3,
  })
  expect('제외 사유를 센다 — 식별', mixed.excluded.IDENTIFYING_DETAIL, 1)
  expect('  제외 사유를 센다 — bucket', mixed.excluded.BUCKET_NOT_VOICE, 1)
  expect('  아무것도 고르지 못할 수 있다', mixed.picked.length, 0)

  // 🔴 이 모듈은 본문을 다루지 않는다
  const planKeys = Object.keys(plan.picked[0] ?? {})
  expect('🔴 산출물에 본문 계열 키가 없다',
    planKeys.filter((k) => /body|content|text|title/i.test(k)).join(','), '')
}

console.log('\n══════ ⑪ 🔴 프롬프트 — 소재 축과 말투 축이 분리된다')
{
  const SAMPLE_A = '어제 김장을 하다 말고 허리를 폈는데 그대로 한참을 서 있었습니다 별것도 아닌데 눈물이 났어요'
  const SAMPLE_B = '요새는 라디오를 켜 두고 삽니다 소리가 있으면 좀 낫더라고요 다들 그러신가요'

  const withVoice = buildPrompt({ raw: raw(), boardHint: 'MENOPAUSE', voiceSamples: [SAMPLE_A, SAMPLE_B] })
  const sys = withVoice.ok ? withVoice.prompt.systemPrompt : ''
  const user = withVoice.ok ? withVoice.prompt.userPayload : ''

  expect('말투 참고 섹션이 있다', sys.includes('말투 참고 — 우리 회원들이 실제로 쓴 글'), true)
  expect('  샘플 본문이 실린다', sys.includes(SAMPLE_A) && sys.includes(SAMPLE_B), true)
  expect('  🔴 내용을 가져오지 말라고 못박는다', sys.includes('내용을 가져오지 않습니다'), true)
  expect('  🔴 말하는 방식만', sys.includes('**말하는 방식만** 보고'), true)
  expect('  흉내가 아니라 기준이라고 말한다', sys.includes('흉내 내는 것이 아닙니다'), true)
  const missingVt = VOICE_TAKEAWAYS.filter((t) => !sys.includes(t))
  expect(`  볼 것 ${VOICE_TAKEAWAYS.length}종 전부 명시`, missingVt.join(','), '')

  // 🔴 축 분리 — 소재는 user, 말투는 system. 구조 자체가 축을 나눈다
  expect('🔴 재료가 둘임을 먼저 못박는다', sys.includes('재료가 두 가지입니다 — 섞지 마세요'), true)
  expect('  소재는 user 쪽에 있다', user.includes(RAW_BODY), true)
  expect('  🔴 소재가 system 에 새지 않는다', sys.includes(RAW_BODY), false)
  expect('  🔴 말투 샘플이 user 에 새지 않는다', user.includes(SAMPLE_A), false)
  expect('  user 라벨이 재료임을 밝힌다', user.includes('[재료 —'), true)

  // 🔴 안전 규칙 3종은 그대로다 — 샘플이 들어와도 약해지지 않는다
  expect('안전 ① 20자 복사 금지 유지', sys.includes('한 조각도 그대로 쓰지 않습니다'), true)
  expect('안전 ② 출처 흔적 금지 유지', sys.includes('출처가 드러나면 안 됩니다'), true)
  expect('안전 ③ 개인 특정 정보 금지 유지', sys.includes('실명 · 상호 · 병원 이름 · 정확한 주소'), true)

  // 🔴 샘플이 없으면 섹션 자체가 없다 — 빈 목록을 지시로 읽지 않게
  const noVoice = buildPrompt({ raw: raw(), boardHint: 'MENOPAUSE' })
  const sysNo = noVoice.ok ? noVoice.prompt.systemPrompt : ''
  expect('샘플 없으면 섹션도 없다', sysNo.includes('말투 참고'), false)
  expect('  축 안내도 없다', sysNo.includes('재료가 두 가지입니다'), false)
  expect('  나머지 지시는 그대로', sysNo.includes('한 조각도 그대로 쓰지 않습니다'), true)
  expect('  빈 배열도 같다', (() => {
    const p = buildPrompt({ raw: raw(), boardHint: 'MENOPAUSE', voiceSamples: [] })
    return p.ok ? p.prompt.systemPrompt.includes('말투 참고') : true
  })(), false)
  expect('  공백만 있는 샘플은 무시', (() => {
    const p = buildPrompt({ raw: raw(), boardHint: 'MENOPAUSE', voiceSamples: ['   ', ''] })
    return p.ok ? p.prompt.systemPrompt.includes('말투 참고') : true
  })(), false)

  // 🔴 상한
  const many = buildPrompt({
    raw: raw(), boardHint: 'MENOPAUSE',
    voiceSamples: ['샘플하나요', '샘플둘이요', '샘플셋이요', '샘플넷이요', '샘플다섯이요'],
  })
  const sysMany = many.ok ? many.prompt.systemPrompt : ''
  expect(`샘플 상한 ${MAX_VOICE_SAMPLES}`, (sysMany.match(/--- 우리 회원 글 /g) ?? []).length, MAX_VOICE_SAMPLES)
  expect('  넘친 것은 잘린다', sysMany.includes('샘플넷이요'), false)
}

console.log('\n══════ ⑫ 🔴 말투 샘플도 유출 대조 대상이다')
{
  const SAMPLE = '어제 김장을 하다 말고 허리를 폈는데 그대로 한참을 서 있었습니다 별것도 아닌데 눈물이 났어요'
  const threw = (fn: () => void): boolean => {
    try { fn(); return false } catch { return true }
  }
  const rec = toOriginalPostRecord({ sourceRawContentId: 'raw-1', title: '제목', body: '본문을 열 자 넘게 적습니다' })
  expect('정상 레코드는 통과', threw(() => assertNoStoredSource([rec], [RAW_BODY, SAMPLE])), false)

  // 🔴 마이크로시드가 아니라 **말투 샘플**을 베껴도 막힌다 — 새로 생긴 유출원이다
  const echoed = { sourceRawContentId: 'raw-1', title: '제목', body: SAMPLE.slice(0, 30) } as OriginalPostRecord
  expect('🔴 말투 샘플 연속 20자 → throw', threw(() => assertNoStoredSource([echoed], [SAMPLE])), true)
  expect('  마이크로시드만 넘기면 못 잡는다(그래서 둘 다 넘겨야 한다)',
    threw(() => assertNoStoredSource([echoed], [RAW_BODY])), false)
  expect('  둘 다 넘기면 잡는다', threw(() => assertNoStoredSource([echoed], [RAW_BODY, SAMPLE])), true)

  // 계측도 샘플을 볼 수 있다
  const sig = analyzeDraft({ title: '제목', body: SAMPLE, sourceTexts: [SAMPLE] })
  expect('계측도 샘플 유출을 센다', sig.sourceEchoCount > 0, true)
}

console.log('\n══════ ⑬ 🔴 우나어 본문 조달 쿼리')
{
  expect('bodiesBySourceRefs 가 있다', typeof READ_QUERIES.bodiesBySourceRefs, 'string')
  const sql = String(READ_QUERIES.bodiesBySourceRefs)
  expect('  SELECT 로만 시작한다', /^\s*SELECT/i.test(sql.trim()), true)
  expect('  🔴 write 키워드가 없다', /INSERT|UPDATE|DELETE|DROP|ALTER/i.test(sql), false)
  expect('  파라미터 바인딩을 쓴다 (문자열 조립 아님)', sql.includes('= ANY($1)'), true)
  // 🔴 권한 범위 — 우나어는 우리 운영 DB 다
  const tables = [...sql.matchAll(/FROM\s+"([A-Za-z]+)"/g)].map((m) => m[1])
  expect('  읽는 테이블이 권한 범위 안',
    tables.every((t) => (UNAO_READABLE_TABLES as readonly string[]).includes(t ?? '')), true)
  expect('  기존 쿼리를 지우지 않았다',
    ['ping', 'whoami', 'countCafePost', 'sampleOne'].every((k) => k in READ_QUERIES), true)
}

console.log('\n══════ ⑭ 🔴 생성기 — 샘플 본문을 저장하지 않는다 (정적 검사)')
{
  const code = readFileSync('scripts/original-post-generate.mts', 'utf-8')
  expect('샘플은 메모리 배열에만 담긴다', code.includes('const voiceSampleBodies: string[] = []'), true)
  // 🔴 저장 레코드는 3키 계약 그대로다
  expect('🔴 저장 레코드에 샘플이 들어가지 않는다',
    /toOriginalPostRecord\(\{\s*sourceRawContentId[\s\S]{0,120}?\}\)/.test(code)
      && !/toOriginalPostRecord\([\s\S]{0,200}?voiceSample/.test(code), true)
  expect('  --no-voice 로 첫 판을 재현할 수 있다', code.includes("argv.includes('--no-voice')"), true)
  expect('  --voice-samples 범위를 검사한다', code.includes('VOICE_SAMPLES > MAX_VOICE_SAMPLES'), true)
  // 🔴 수동 판정 파일명을 지어내지 않는다
  expect('🔴 수동판정 파일을 실제로 찾아 쓴다', code.includes("readdirSync(DEC_DIR)"), true)
  // 🔴 최상위가 배열이 아니라 { ..., items: [...] } 다. 배열만 받으면 조용히 0건이 된다
  expect('  items 래핑을 벗긴다', code.includes('Array.isArray(obj.items)'), true)
  expect('  🔴 0건이면 조용히 넘어가지 않고 멈춘다', code.includes('판정이 0건입니다'), true)
  expect('  파일명을 하드코딩하지 않는다', code.includes("'ve-m3-manual-decisions.json'"), false)
  // 🔴 산출물 디렉터리도 실제 존재하는 것 중 최신
  expect('산출물 디렉터리를 찾아 쓴다', code.includes("readdirSync(LEARN_ROOT)"), true)
  // 🔴 우나어 접속은 read-only URL 로만
  expect('우나어는 read-only URL 로만 연다', code.includes('loadUnaoReadonlyUrl()'), true)
  expect('  SQL 은 READ_QUERIES 에서 가져온다', code.includes('READ_QUERIES.bodiesBySourceRefs'), true)
  expect('  🔴 생성기가 SQL 을 조립하지 않는다', /client\.query\(\s*[`'"]/.test(code), false)
}

console.log('\n══════ ⑮ 🔴 Gemini provider 연결 — 유료 경로는 하나다')
{
  // ── 모델 등록 ──
  expect('gemini-3.7-flash 가 등록됐다', 'gemini-3.7-flash' in M3_MODEL_CANDIDATES, true)
  expect('  apiModelId 가 있다', apiModelIdFor('gemini-3.7-flash'), 'gemini-3.7-flash')
  // 🔴 출처·확인일 없는 단가는 "확인된 비용" 처럼 읽힌다 (계약 §E)
  const gp: { source: string; checkedAt: string; inputPerMTok: number; outputPerMTok: number } =
    M3_MODEL_CANDIDATES['gemini-3.7-flash']
  expect('  단가에 출처·확인일이 있다', gp.source.length > 0 && gp.checkedAt.length > 0, true)
  expect('  input 단가', gp.inputPerMTok, 0.75)
  expect('  output 단가', gp.outputPerMTok, 3.75)
  // 🔴 2027-01-01 부터 2배가 된다. 그 사실이 코드에 남아 있지 않으면
  //    그날 이후 비용 추정이 절반으로 나오고 "확인된 비용" 처럼 읽힌다
  expect('  🔴 2027 단가 인상이 명시돼 있다', gp.source.includes('2027-01-01'), true)
  expect('    인상 후 input', gp.source.includes('$1.50'), true)
  expect('    인상 후 output', gp.source.includes('$7.50'), true)

  // 🔴 호출 불가로 확인된 모델을 후보에 남기지 않는다.
  //    ListModels 에는 보이지만 generateContent 가 404 다("no longer available
  //    to new users", 2026-09-01 실측 3/3 실패). 남겨 두면 다음 사람이 같은 404 를 만난다
  expect('🔴 gemini-2.5-pro 는 제거됐다', 'gemini-2.5-pro' in M3_MODEL_CANDIDATES, false)
  expect('  🔴 비용상 제외한 3.1-pro-preview 도 없다', 'gemini-3.1-pro-preview' in M3_MODEL_CANDIDATES, false)

  // ── keyStatus ──
  expect('GEMINI_API_KEY 로 매핑된다',
    (PROVIDER_KEY_ENV as Record<string, string>)['gemini-3.7-flash'], 'GEMINI_API_KEY')
  // 🔴 기존 경로 회귀 없음
  expect('  Anthropic 매핑 유지',
    (PROVIDER_KEY_ENV as Record<string, string>)['claude-haiku-4.5'], 'ANTHROPIC_API_KEY')
  expect('  OpenAI 매핑 유지',
    (PROVIDER_KEY_ENV as Record<string, string>)['gpt-5-nano'], 'OPENAI_API_KEY')
  expect('  gpt-5-mini 매핑 유지',
    (PROVIDER_KEY_ENV as Record<string, string>)['gpt-5-mini'], 'OPENAI_API_KEY')
  expect('지원 모델 4종', Object.keys(PROVIDER_KEY_ENV).length, 4)

  // 🔴 keyStatus 는 값을 한 조각도 내보내지 않는다
  const st = keyStatus('gemini-3.7-flash')
  expect('keyStatus 는 이름과 boolean 뿐', Object.keys(st).sort().join(','), 'envName,present')
  expect('  값이 섞이지 않는다', JSON.stringify(st).includes(process.env.GEMINI_API_KEY ?? ' '), false)
  expect('모르는 모델은 present false', keyStatus('gemini-9-ultra').present, false)
  // 🔴 제거한 모델은 keyStatus 에서도 사라져야 한다 — 남으면 "쓸 수 있다" 로 읽힌다
  expect('  제거한 2.5-pro 도 false', keyStatus('gemini-2.5-pro').present, false)

  // ── provider 내부 구현 (정적 검사) ──
  const prov = readFileSync('scripts/lib/voice-m3-provider.mts', 'utf-8')
  expect('Gemini 엔드포인트가 provider 안에만 있다', prov.includes('generativelanguage.googleapis.com'), true)
  expect('  모델 ID 를 경로에 치환한다',
    prov.includes("ENDPOINT[req.model].replace('{model}', apiModelIdFor(req.model))"), true)
  // 🔴 key 를 URL 에 붙이지 않는다 — URL 은 로그·에러 메시지·프록시 기록에 남는다
  expect('🔴 key 를 URL 쿼리에 붙이지 않는다', prov.includes('?key='), false)
  expect('  헤더로 보낸다', prov.includes("'x-goog-api-key'"), true)
  // 🔴 모델명을 하나 박으면 교체할 때마다 이 줄을 고쳐야 하고 언젠가 빠뜨린다.
  //    실제로 2.5-pro → 3.7-flash 교체가 하루 만에 일어났다
  expect('  Gemini 분기는 계열로 판정한다', prov.includes("req.model.startsWith('gemini-')"), true)
  expect('    🔴 모델명을 박지 않는다', prov.includes("req.model === 'gemini"), false)
  // 🔴 요청 형태
  expect('systemInstruction 을 따로 둔다', prov.includes('systemInstruction:'), true)
  expect('  contents 에 user 턴', prov.includes("contents: [{ role: 'user'"), true)
  expect('  울타리를 API 로 막는다', prov.includes('responseMimeType: GEMINI_RESPONSE_MIME'), true)
  expect('  mime 값', GEMINI_RESPONSE_MIME, 'application/json')
  // 🔴 응답 형태
  // 🔴 parts[0] 만 읽으면 긴 응답이 조용히 잘린다
  expect('parts 를 전부 이어 붙인다', prov.includes('geminiCand?.content?.parts ?? []'), true)
  expect('  join 으로 합친다', prov.includes(".join('')"), true)
  expect('  usageMetadata 를 읽는다', prov.includes('gUsage.promptTokenCount'), true)
  expect('  candidatesTokenCount', prov.includes('gUsage.candidatesTokenCount'), true)
  expect('  thinking 토큰은 없으면 null', prov.includes('thoughtsTokenCount'), true)
  expect('  finishReason 은 candidate 에서', prov.includes('geminiCand?.finishReason'), true)

  // 🔴 기존 경로가 그대로 남아 있다
  expect('Anthropic prefill 유지', ANTHROPIC_JSON_PREFILL, '{')
  expect('  prefill 코드 유지', prov.includes('ANTHROPIC_JSON_PREFILL + continuation'), true)
  expect('  OpenAI Bearer 유지', prov.includes('authorization: `Bearer ${key}`'), true)
  expect('  Anthropic x-api-key 유지', prov.includes("'x-api-key': key"), true)
  expect('  anthropic-version 유지', prov.includes("'anthropic-version': '2023-06-01'"), true)

  // 🔴 Gemini 는 종료 사유를 대문자로 준다. 상한 판정이 그것을 읽는가
  expect('Gemini MAX_TOKENS 를 상한으로 읽는다', isMaxTokensReached('MAX_TOKENS', 10, 100), true)
  expect('  STOP 은 상한 아님', isMaxTokensReached('STOP', 10, 100), false)
  expect('  기존 length 유지', isMaxTokensReached('length', 10, 100), true)
  expect('  기존 max_tokens 유지', isMaxTokensReached('max_tokens', 10, 100), true)
}

console.log('\n══════ ⑯ 🔴 생성기 — 모델 선택 (정적 검사)')
{
  const code = readFileSync('scripts/original-post-generate.mts', 'utf-8')
  expect('기본 모델은 haiku 그대로', code.includes("const DEFAULT_MODEL: ProviderModel = 'claude-haiku-4.5'"), true)
  // 🔴 무검증 캐스팅을 하지 않는다 — 오타가 apiModelIdFor 의 throw 로만 드러나면 이유가 안 읽힌다
  expect('--model 을 검증한다', code.includes('SUPPORTED_MODELS.includes(MODEL_RAW)'), true)
  expect('  지원 목록은 provider 에서 가져온다', code.includes('Object.keys(PROVIDER_KEY_ENV)'), true)
  expect('  🔴 모델 목록을 생성기가 따로 적지 않는다', code.includes("'gemini-3.7-flash'"), false)
  // 🔴 실패 사유를 반드시 찍는다. 2026-09-01 Gemini 3건 실패가 "호출 실패" 로만 남아
  //    별도 프로브를 돌려서야 HTTP_404 임을 알았다 — 진단 공백이었다
  expect('🔴 호출 실패에 errorCode 를 찍는다', code.includes('res.errorCode ?? '), true)
  expect('  errorMessage 도 찍는다', code.includes('res.errorMessage ?? '), true)
  expect('  파싱 실패에 finish·상한도 찍는다', code.includes('res.maxTokensReached ?'), true)
  // 🔴 성공 0건을 정상 종료로 두지 않는다
  expect('  성공 0건이면 exit 1', code.includes('process.exit(1)') && code.includes('저장할 초안이 0건입니다'), true)
  // 🔴 dry-run 에서 key 유무가 보인다 — --call 뒤에 아는 것은 늦다
  expect('dry-run 에서 모델·key 를 보여준다', code.includes('keyStatus(MODEL)'), true)
  // 🔴 Gemini 세부는 생성기에 새지 않는다
  expect('🔴 생성기에 Gemini 엔드포인트가 없다', code.includes('generativelanguage'), false)
  expect('  🔴 생성기에 x-goog 헤더가 없다', code.includes('x-goog'), false)
  expect('  🔴 생성기에 GEMINI_API_KEY 문자열이 없다', code.includes('GEMINI_API_KEY'), false)
  // 🔴 reasoning 모델의 추론 예산 — gpt-5-nano 가 1,000 에서 5/5 잘린 그 자리다
  expect('reasoning 모델은 상한을 넓힌다', code.includes('policy.reasoning ? Math.max(maxOutputTokens, policy.maxOutputTokens)'), true)
  expect('  정책은 계약에서 가져온다', code.includes('outputTokenPolicyFor(MODEL)'), true)
  // 🔴 넓히기만 한다 — haiku 상한이 정책값(1500)으로 줄면 기존 초안 3건의 기준선이 흔들린다.
  //    (파일 전체에서 Math.min 을 찾으면 재료 선정 루프의 것까지 걸린다. outCap 줄만 본다)
  const capLine = code.split('\n').find((l) => l.includes('const outCap =')) ?? ''
  expect('  🔴 outCap 은 Math.max 로만 정한다', capLine.includes('Math.max(') && !capLine.includes('Math.min('), true)
  expect('gemini 는 reasoning 으로 본다', outputTokenPolicyFor('gemini-3.7-flash').reasoning, true)
  expect('  상한 4000', outputTokenPolicyFor('gemini-3.7-flash').maxOutputTokens, 4000)
  expect('  🔴 haiku 는 reasoning 아님 (상한 불변)', outputTokenPolicyFor('claude-haiku-4.5').reasoning, false)
  expect('  비용 추정은 최악값 = 상한', outputTokenPolicyFor('gemini-3.7-flash').estimatedOutputTokens, 4000)
  // 🔴 제거한 모델은 정책 조회에서 던져야 한다
  expect('  🔴 2.5-pro 정책 조회는 던진다', (() => {
    try { outputTokenPolicyFor('gemini-2.5-pro'); return false } catch { return true }
  })(), true)

  // 🔴 저장 계약은 그대로다
  expect('저장 키 3개 그대로', ALLOWED_RECORD_KEYS.join(','), 'sourceRawContentId,title,body')
  expect('  유출 대조 양쪽 유지',
    code.includes('const allSources = [...sourceTexts, ...voiceSampleBodies]'), true)
}

console.log('\n══════ ⑰ 🔴 source profile — 원문을 규칙으로 읽는다')
{
  // 🔴 #7 턱관절: 다급하고 분통 터진 글. 번호 나열 · 약 · 시간 · CT · 되풀이가 있었다.
  //    3판 전부 이것을 문학 수필로 바꿨다. 프로파일이 그 자리를 지목하는지 본다.
  const PANIC_TITLE = '턱이 안 벌어져요 진짜 어떡하죠ㅠㅠ'
  const PANIC_BODY = [
    '1. 새벽 3시에 턱이 딱 걸려서 깼어요',
    '2. 진통제 두 알 먹었는데 소용이 없어요',
    '3. 어제 CT 찍었는데 이상 없대요',
    '',
    '무서워요 진짜 무서워요 이게 무서워요',
    '입이 안 벌어지니까 밥을 못 먹어요',
    '82님들 저 진짜 어떡하죠',
  ].join('\n')
  const p7 = readSourceProfile({ rawTitle: PANIC_TITLE, rawBody: PANIC_BODY })

  expect('#7 다급한 글로 읽는다', p7.emotionTone, 'panic')
  expect('  제목 온도를 과열로 읽는다', p7.titleTemperature, 'overheat')
  expect('  🔴 번호 나열을 알아본다', p7.structureType, 'numbered_list')
  expect('  🔴 번호를 살릴 대상으로 둔다', p7.preserveStructure.numberedList, true)
  expect('  도움 요청으로 읽는다', p7.interactionNeed, 'help_request')
  expect('  🔴 되풀이("무서워요")를 잡는다', p7.repeatedFixations.includes('무서워요'), true)
  const kinds7 = new Set(p7.concreteDetailsToKeep.map((d) => d.kind))
  expect('  🔴 시간 디테일을 살릴 목록에 넣는다', kinds7.has('time'), true)
  expect('    약·검사도', kinds7.has('medical'), true)
  expect('    몸의 느낌도', kinds7.has('body'), true)
  expect('  🔴 외부 호칭을 찾아낸다', p7.externalAddressTerms.includes('82님들'), true)

  // 지시문으로 옮겨졌는가 — 코드값이 아니라 사람 말이어야 한다
  const d7 = profileDirectives(p7).join('\n')
  expect('  🔴 "차분하게 정리하지 마세요" 를 말한다', d7.includes('차분하게 정리하지 마세요'), true)
  expect('  🔴 제목 온도를 낮추지 말라', d7.includes('정제하면 실패입니다'), true)
  // 🔴 4판 #10 피드백 — "번호를 살려라" 가 AI 브리핑을 낳았다. 지시를 다시 썼다
  expect('  🔴 번호를 산문으로 묶지 말라', d7.includes('산문으로 묶지 마세요'), true)
  expect('  🔴 깔끔한 목록도 실패라고 말한다', d7.includes('깔끔한 목록으로 정리하는 것도 실패'), true)
  expect('    덜 정돈된 번호 모양을 허용한다', d7.includes('`1)` `1..` `1-`'), true)
  expect('    요약 명사 대신 말하듯 이어쓰라', d7.includes('말하듯 이어서'), true)
  expect('    번호 사이에 감정·사족이 섞여야 한다', d7.includes('감정·사족·괄호·되풀이가 섞여야'), true)
  expect('    항목 길이가 들쭉날쭉해도 된다', d7.includes('들쭉날쭉해도 됩니다'), true)
  expect('  🔴 AI 브리핑처럼 보이면 실패', d7.includes('브리핑처럼 보이면 실패'), true)
  // 🔴 #10 원문에는 URL 이 있었다. 링크는 호칭보다 확실한 유출이다
  const withUrl = readSourceProfile({
    rawTitle: '이거 보세요',
    rawBody: '어제 병원 다녀왔는데 https://example.com/abc 여기 글이랑 똑같더라고요 정말 놀랐어요 새벽 3시에 깼고 진통제도 소용이 없었어요 무서워요 무서워요 무서워요 어떡하죠',
  })
  expect('  🔴 원문 URL 을 알아본다', withUrl.hasSourceUrl, true)
  expect('    주소를 옮기지 말라고 말한다',
    profileDirectives(withUrl).join('\n').includes('최종 글에 주소를 옮기지 않습니다'), true)
  expect('  URL 없으면 그 지시도 없다', p7.hasSourceUrl, false)
  expect('  🔴 되풀이는 붙들린 지점이라고 말한다', d7.includes('붙들린 지점'), true)
  expect('  🔴 부르는 말을 남기라고 말한다', d7.includes('소란님들 저 진짜 어떡하죠'), true)
  expect('  🔴 코드값을 그대로 내보내지 않는다', d7.includes('panic') || d7.includes('numbered_list'), false)

  // 🔴 #8 도시락: 밝은 주접글. 3판이 신파 수필로 바꾸고 없던 쓸쓸함을 넣었다
  const BRIGHT_TITLE = '딸 도시락 자랑 좀 할게요ㅋㅋ'
  const BRIGHT_BODY = [
    '오늘 아침에 딸내미 도시락 싸는데 헤헹 너무 예쁘게 나왔지 뭐예요',
    '계란말이가 진짜 진짜 잘 됐어요 ㅋㅋㅋ',
    '딸이 사진 찍어서 친구들한테 자랑했대요 ^^',
    '나야 나 도시락 수발러 ㅋㅋㅋ',
    '딸 표정 보니까 뿌듯하고 기특하고 그러네요 진짜 뿌듯해요',
  ].join('\n')
  const p8 = readSourceProfile({ rawTitle: BRIGHT_TITLE, rawBody: BRIGHT_BODY })

  expect('#8 밝은 글로 읽는다', ['bright_pride', 'playful_affection'].includes(p8.emotionTone), true)
  expect('  제목 온도를 장난스럽게 읽는다', p8.titleTemperature, 'playful')
  expect('  🔴 자랑글로 읽는다', p8.structureType, 'brag_post')
  expect('  자랑 나눔으로 읽는다', p8.interactionNeed, 'brag_share')
  expect('  🔴 이모티콘을 살릴 대상으로 둔다', p8.preserveStructure.emoticons, true)
  const kinds8 = new Set(p8.concreteDetailsToKeep.map((d) => d.kind))
  expect('  🔴 이모티콘 디테일을 잡는다', kinds8.has('emoticon'), true)
  expect('    가족 디테일도', kinds8.has('family'), true)
  expect('    말버릇("진짜")도', kinds8.has('verbal_tic'), true)

  const d8 = profileDirectives(p8).join('\n')
  expect('  🔴 쓸쓸함을 얹지 말라고 말한다', d8.includes('쓸쓸함·회한을 얹지 마세요'), true)
  expect('  🔴 밝은 글을 신파로 바꾸지 말라', d8.includes('밝은 글을 신파·회한으로 바꾸기'), true)
  expect('  🔴 없는 쓸쓸함을 지어내지 말라', d8.includes('원문에 없는 쓸쓸함·외로움'), true)
  expect('    없는 서먹함도', d8.includes('원문에 없는 가족 간 서먹함'), true)
  expect('  자랑글 호출은 가볍게', d8.includes('주말 잘 보내세요'), true)

  // 🔴 4판 #11 피드백 — 밝기는 살았는데 "가짜 4050 말투" 가 섞였다
  expect('  🔴 자랑하고 싶어서 못 참는 흐름이라고 말한다', d8.includes('자랑하고 싶어서 못 참는'), true)
  expect('  🔴 점잖게 귀여운 척하면 실패', d8.includes('귀여운 척 점잖게 쓰면 실패'), true)
  const missingKeeps = BRIGHT_REGISTER_KEEPS.filter((k) => !d8.includes(k))
  expect(`  🔴 밝은 글 유지어 ${BRIGHT_REGISTER_KEEPS.length}종 전부 명시`, missingKeeps.join(','), '')
  expect('  🔴 억지로 끼워 넣지 말라고 말한다', d8.includes('억지로 박으면 그게 더 티가 납니다'), true)
  // 🔴 다급한 글에는 이 목록이 나오면 안 된다 — 갈래별로 달라야 한다
  expect('    다급한 글에는 유지어 목록이 없다', d7.includes('수발러'), false)

  // 🔴 두 글이 **다른 지시**를 받아야 한다. 같으면 프로파일이 일을 안 한 것이다
  expect('🔴 다급한 글과 밝은 글의 지시가 다르다', d7 === d8, false)

  // 🔴 4판 #12 피드백 — 피부 글이 plain/calm 으로 너무 낮게 읽혔다.
  //    폼클·크림·연고·기간·체중이 있는데 사전에 한 낱말도 없었다
  const skin = readSourceProfile({
    rawTitle: '피부가 자꾸 뒤집어지는데 물세안 계속해도 될까요',
    rawBody: [
      '물세안 3개월 하다가 폼클렌징 다시 써봤는데 더 심해졌어요',
      '트러블이 계속 올라와서 피부과 다녀왔고 제약사 크림이랑 연고 받아왔어요',
      '살이 51kg 에서 48kg 까지 빠졌는데 면역력 때문인가 걱정이에요',
      '폼클렌징 다시 쓰시는 분 계실까요 어떻게 하셨는지 궁금해요',
    ].join('\n'),
  })
  expect('#12 담담한 글로 읽히지 않는다', skin.emotionTone === 'plain', false)
  expect('  걱정 또는 실용 질문으로 읽는다',
    ['worry', 'practical_question'].includes(skin.emotionTone), true)
  expect('  🔴 경험자 호출로 읽는다', skin.interactionNeed, 'experience_call')
  expect('  후기형 또는 질문형 구조', ['review_post', 'practical_question'].includes(skin.structureType), true)
  const skinKinds = new Set(skin.concreteDetailsToKeep.map((d) => d.kind))
  expect('  🔴 크림·연고·폼클렌징을 살릴 목록에 넣는다', skinKinds.has('medical'), true)
  expect('    체중·기간 수치도', skinKinds.has('amount'), true)
  expect('    몸의 변화(트러블·뒤집)도', skinKinds.has('body'), true)

  // 파편 나열
  const frag = readSourceProfile({
    rawTitle: '그냥 적어봐요',
    rawBody: ['잠이 안 온다', '창밖만 본다', '뭘 해야 하나', '모르겠다', '그냥 그렇다'].join('\n'),
  })
  expect('짧게 끊긴 글을 파편으로 읽는다', frag.structureType, 'fragmented_stream')
  expect('  🔴 문단으로 정리하지 말라고 말한다',
    profileDirectives(frag).join('\n').includes('문단으로 정리하지 말고'), true)

  // 🔴 외부 호칭이 없으면 그 지시가 나오지 않는다 (없는 문제를 만들지 않는다)
  expect('외부 호칭 없으면 치환 지시도 없다',
    profileDirectives(p8).join('\n').includes('다른 커뮤니티 호칭이 있습니다'), false)
}

console.log('\n══════ ⑱ 🔴 프로파일이 프롬프트에 실린다 · 우선순위')
{
  const PANIC = {
    rawTitle: '턱이 안 벌어져요 어떡하죠ㅠㅠ',
    // 🔴 RAW_BODY_MIN_CHARS(120) 를 넘겨야 buildPrompt 가 막지 않는다
    rawBody: [
      '1. 새벽 3시에 턱이 딱 걸려서 깼어요 진통제 두 알 먹었는데 소용이 없어요',
      '2. 어제 CT 찍었는데 이상 없다고만 하고 그냥 돌려보내더라고요',
      '3. 오늘은 아예 입이 안 벌어져서 밥을 못 먹었어요',
      '무서워요 진짜 무서워요 이게 무서워요 어깨까지 뻐근하고 욱신거려요',
      '82님들 저 진짜 어떡하죠 이런 거 겪어보신 분 계실까요',
    ].join('\n'),
  }
  const p = buildPrompt({
    raw: { id: 'r1', ...PANIC, sourceSite: '82cook' },
    boardHint: 'MENOPAUSE',
    voiceSamples: ['어제 김장하다 허리를 폈는데 한참 서 있었습니다 별것도 아닌데 눈물이 났어요'],
  })
  const sys = p.ok ? p.prompt.systemPrompt : ''

  expect('프로파일 섹션이 있다', sys.includes('이 글이 어떤 글인지 (가장 먼저 지킬 것)'), true)
  // 🔴 프로파일이 말투 샘플보다 **앞**에 와야 한다. 뒤에 오면 샘플이 덮는다
  expect('🔴 프로파일이 말투 샘플보다 앞에 온다',
    sys.indexOf('이 글이 어떤 글인지') < sys.indexOf('말투 참고'), true)
  expect('🔴 충돌 시 프로파일이 이긴다고 명시한다', sys.includes('어긋나면 위쪽이 우선입니다'), true)
  expect('  갈래별로 무엇을 살릴지 말한다', sys.includes('밝은 글이면 밝은 주접과 이모티콘으로'), true)

  // 🔴 창업자 critique
  expect('실패 표현 섹션이 있다', sys.includes('이런 글은 실패입니다'), true)
  const missing = CRITIQUE_BANNED_PHRASES.filter((x) => !sys.includes(x))
  expect(`  실패 표현 ${CRITIQUE_BANNED_PHRASES.length}종 전부 명시`, missing.join(','), '')
  const missingReg = CRITIQUE_BANNED_REGISTERS.filter((x) => !sys.includes(x))
  expect(`  실패 문체 ${CRITIQUE_BANNED_REGISTERS.length}종 전부 명시`, missingReg.join(','), '')
  expect('  🔴 "깔끔한 문장은 실패" 라고 말한다', sys.includes('여기서는 실패'), true)

  // 🔴 내부 critic/rewrite 루프 — 호출을 늘리지 않는다
  expect('내부 점검 절차가 있다', sys.includes('쓰기 전에, 그리고 쓴 뒤에'), true)
  expect('  스스로 깎아 보라고 말한다', sys.includes('초안을 스스로 깎아 봅니다'), true)
  expect('  온도가 낮아졌는지 자문', sys.includes('원문의 온도가 낮아지지 않았나'), true)
  expect('  구체성이 사라졌는지 자문', sys.includes('사라지지 않았나'), true)
  expect('  지어냈는지 자문', sys.includes('원문에 없던 사실·감정을 지어내지 않았나'), true)
  expect('  매끄러우면 실패 신호', sys.includes('매끄러우면 그것이 실패 신호'), true)
  expect('🔴 과정을 출력하지 말라고 말한다', sys.includes('과정은 출력하지 않습니다'), true)
  expect('  최종은 JSON 하나', sys.includes('{"title": "제목", "body": "본문"}'), true)
  expect('  자기평가도 출력 금지', sys.includes('설명·과정·자기평가를 출력하지 않습니다'), true)
}

console.log('\n══════ ⑲ 🔴 호칭 정책')
{
  const p = buildPrompt({
    raw: {
      id: 'r1',
      rawTitle: '도와주세요 어떡하죠ㅠㅠ',
      // 🔴 120자 이상이어야 buildPrompt 가 통과시킨다
      rawBody: [
        '82님들 진짜 어떡하죠 무서워요 무서워요 무서워요',
        '새벽 3시에 깼고 진통제 두 알 먹었는데도 소용이 없어요',
        '어제 CT 까지 찍었는데 이상 없다는 말만 듣고 왔어요',
        '오늘은 밥도 제대로 못 먹겠어요 턱이 계속 욱신거리고 어깨까지 뻐근해요',
        '도와주세요 이런 거 겪어보신 분 계실까요',
      ].join('\n'),
      sourceSite: '82cook',
    },
    boardHint: 'FREE',
  })
  const sys = p.ok ? p.prompt.systemPrompt : ''
  expect('호칭 섹션이 있다', sys.includes('우리를 부르는 말'), true)
  const missingOurs = SORANSORAN_ADDRESS.filter((x) => !sys.includes(x))
  expect(`  우리 호칭 ${SORANSORAN_ADDRESS.length}종 전부`, missingOurs.join(','), '')
  expect('  🔴 낱말만 바꾸지 말라고 말한다', sys.includes('부르는 문장 전체를'), true)
  expect('  목적에 맞게 다시 쓰라', sys.includes('이 글의 목적에 맞게 다시 씁니다'), true)
  expect('  🔴 원문에 있던 외부 호칭을 지목한다', sys.includes('다른 커뮤니티 호칭이 있습니다'), true)

  // 🔴 계측 — 외부 호칭이 남으면 잡는다
  const leaked = analyzeDraft({ title: '제목', body: '82님들 안녕하세요 오늘도 잘 부탁드립니다', sourceTexts: [] })
  expect('외부 호칭이 남으면 센다', leaked.externalAddressHits.includes('82님들'), true)
  expect('  우리 호칭은 0', leaked.soransoranAddressHits.length, 0)
  const ours = analyzeDraft({ title: '제목', body: '소란님들 저 진짜 어떡하죠 도와주세요', sourceTexts: [] })
  expect('우리 호칭을 쓰면 센다', ours.soransoranAddressHits.includes('소란님들'), true)
  expect('  외부 호칭은 0', ours.externalAddressHits.length, 0)
  for (const term of ['맘님들', '레테님들', '회원님들', '82쿡님들']) {
    expect(`  ${term} 도 잡는다`,
      analyzeDraft({ title: 'ㅇ', body: `${term} 안녕하세요`, sourceTexts: [] }).externalAddressHits.length > 0, true)
  }
}

console.log('\n══════ ⑳ 🔴 critique 계측 · 번호 나열 예외')
{
  // 🔴 창업자가 실제로 걸었던 문장들
  for (const phrase of CRITIQUE_BANNED_PHRASES) {
    const hit = analyzeDraft({ title: '제목', body: `그래서 ${phrase} 라고 생각했어요`, sourceTexts: [] })
    expect(`실패 표현을 센다 — "${phrase}"`, hit.critiqueHits.includes(phrase), true)
  }
  const clean = analyzeDraft({ title: '제목', body: '어제 설거지하다 말고 한참을 서 있었어요', sourceTexts: [] })
  expect('깨끗하면 0건', clean.critiqueHits.length, 0)

  // 🔴 4판 피드백으로 새로 들어온 실패 표현
  for (const phrase of ['주책부렸네요', '이 맛에 사나 봐요', '느낀 점이에요', '피부는 참 마음대로 안 되네요']) {
    expect(`  4판 실패 표현 — "${phrase}"`, CRITIQUE_BANNED_PHRASES.includes(phrase), true)
  }
  // 🔴 경계 표현은 **따로 센다.** 합치면 실패 건수가 부풀고 판단에 쓸 수 없다
  const watch = analyzeDraft({ title: '제목', body: '글쎄 잘 모르겠어요', sourceTexts: [] })
  expect('🔴 경계 표현은 실패로 세지 않는다', watch.critiqueHits.length, 0)
  expect('  경계로는 센다', watch.critiqueWatchHits.includes('글쎄'), true)

  // 🔴 4판 피드백으로 새로 들어온 실패 문체
  for (const reg of ['드라마 대본 말투', '아침방송 리포터 말투', '점잖게 귀여운 척하는 말투',
                     '바른 생활 일기장', 'AI 가 번호 매겨 요약한 브리핑']) {
    expect(`  4판 실패 문체 — ${reg}`, CRITIQUE_BANNED_REGISTERS.includes(reg), true)
  }
  expect('  후기 요약으로 끝맺기도 실패',
    CRITIQUE_BANNED_REGISTERS.some((r) => r.includes('느낀 점')), true)

  // 🔴 링크가 남으면 잡는다 — 호칭보다 확실한 유출이다
  for (const u of ['https://example.com/abc', 'www.82cook.com/x', 'cafe.naver.com/abc']) {
    expect(`URL 을 잡는다 — ${u}`,
      analyzeDraft({ title: 'ㅇ', body: `여기 보세요 ${u} 참고하세요`, sourceTexts: [] }).urlHits.length > 0, true)
  }
  expect('  주소 없으면 0건', clean.urlHits.length, 0)

  // 🔴 원문이 번호 나열이면 초안의 번호는 흔적이 아니다 — 살리라고 시킨 것이다
  const numbered = '1. 첫째\n2. 둘째\n3. 셋째'
  expect('기본은 번호 목록을 흔적으로 센다',
    analyzeDraft({ title: 'ㅇ', body: numbered, sourceTexts: [] }).structureFlags.includes('번호 목록'), true)
  expect('🔴 원문이 번호 나열이면 세지 않는다',
    analyzeDraft({ title: 'ㅇ', body: numbered, sourceTexts: [], allowNumberedList: true }).structureFlags.includes('번호 목록'), false)
  // 🔴 다른 구조 흔적은 예외와 무관하게 그대로 잡힌다
  expect('  마크다운은 예외와 무관하게 잡힌다',
    analyzeDraft({ title: 'ㅇ', body: '**강조**입니다', sourceTexts: [], allowNumberedList: true }).structureFlags.includes('마크다운'), true)

  // 🔴 기존 안전 계측은 그대로다
  const SRC = '요 며칠 새벽에 자꾸 깹니다 이불을 걷었다 덮었다 하다 보면 어느새 네 시가 넘어 있고'
  const echo = analyzeDraft({ title: 'ㅇ', body: SRC, sourceTexts: [SRC], allowNumberedList: true })
  expect('  번호 예외가 유출 검사를 건드리지 않는다', echo.sourceEchoCount > 0, true)
}

console.log('\n══════ ㉒ 🔴 5판 피드백 — 필수 디테일 · 감정 연기 금지 · 이모티콘 배치')
{
  // ── #13 턱관절: 증거 디테일이 빠지면 실패 ──
  const JAW = readSourceProfile({
    rawTitle: '턱이 안 벌어져요 어떡하죠ㅠㅠ',
    rawBody: [
      '8/24 새벽 4시 42분에 턱이 걸려서 깼어요',
      '렉사프로랑 리보트릴 먹고 있는데도 똑같아요',
      '8/25 에 CT 찍었더니 기도가 좁다고만 하고 개구장애라는 말만 들었어요',
      '전기자극 치료도 받아봤는데 입술 위치가 이상하고 하관이 틀어진 것 같아요',
      '줌인아웃에 올렸는데도 답이 없어서 여기 써봐요 지금도 침 삼키기가 힘들어요',
    ].join('\n'),
  })
  const must = mustKeepDetails(JAW.concreteDetailsToKeep)
  const mustSamples = must.map((d) => d.sample).join(' ')
  expect('#13 약 이름을 잡는다 — 렉사프로', mustSamples.includes('렉사프로'), true)
  expect('  리보트릴도', mustSamples.includes('리보트릴'), true)
  expect('  CT 도', mustSamples.includes('CT'), true)
  expect('  개구장애도', mustSamples.includes('개구장애'), true)
  expect('  전기자극도', mustSamples.includes('전기자극'), true)
  expect('  기도(좁음)도', mustSamples.includes('기도'), true)
  expect('  입술도', mustSamples.includes('입술'), true)
  expect('  하관도', mustSamples.includes('하관'), true)
  expect('  🔴 8/24 날짜를 잡는다', mustSamples.includes('8/24'), true)
  expect('    8/25 도', mustSamples.includes('8/25'), true)
  expect('  🔴 새벽 4시 42분을 잡는다', mustSamples.includes('42분'), true)
  // 🔴 2026-09-01 6판 #16 — `줌인아웃` 은 상황감이 아니라 **출처**였다.
  //    "살려라" 로 나가서 그대로 남았다. 필수 목록에서 빼고 지울 쪽으로 옮겼다.
  expect('🔴 줌인아웃은 필수 디테일이 아니다', mustSamples.includes('줌인아웃'), false)
  expect('  🔴 출처 흔적으로 잡는다', JAW.originTraceTerms.includes('줌인아웃'), true)

  const dJaw = profileDirectives(JAW).join('\n')
  expect('  🔴 "빠지면 실패" 로 등급을 올린다', dJaw.includes('빠지면 실패입니다'), true)
  expect('    다 쓴 뒤 확인하라고 말한다', dJaw.includes('빠졌으면 넣어서 다시 씁니다'), true)
  expect('    베끼라는 뜻이 아니라고 못박는다', dJaw.includes('내 경우의 같은 종류를 그만큼 구체적으로'), true)
  // 🔴 감정 연기 금지
  expect('  🔴 감정을 연기하지 말라고 말한다', dJaw.includes('감정을 연기하지 마세요'), true)
  expect('    없는 몸 반응 예시를 든다', dJaw.includes('손이 떨린다 · 입을 벌린 채 멍하니'), true)
  expect('    현실의 행동·들은 말로 쓰라', dJaw.includes('현실의 행동과 들은 말'), true)
  expect('    무엇을 쓸지 알려준다', dJaw.includes('먹은 약이 어떻게 안 들었는지'), true)

  // 🔴 감정·말버릇은 "빠지면 실패" 등급이 아니다 — 등급이 닳으면 안 된다
  expect('🔴 이모티콘은 필수 등급이 아니다', MUST_KEEP_KINDS.includes('emoticon'), false)
  expect('  말버릇도 아니다', MUST_KEEP_KINDS.includes('verbal_tic'), false)
  expect('  가족도 아니다', MUST_KEEP_KINDS.includes('family'), false)
  expect('  약·검사는 필수다', MUST_KEEP_KINDS.includes('medical'), true)
  expect('  수치도', MUST_KEEP_KINDS.includes('amount'), true)
  expect('  상황도', MUST_KEEP_KINDS.includes('situation'), true)
  expect('  생활 맥락도', MUST_KEEP_KINDS.includes('lifestyle'), true)

  // ── #15 피부: 추가정보를 핵심으로 ──
  const SKIN = readSourceProfile({
    rawTitle: '피부가 자꾸 뒤집어지는데 물세안 계속해도 될까요',
    rawBody: [
      '162cm 에 51kg 이었는데 48~49kg 까지 빠지고 살이 안 쪄요',
      '외식 줄이고 음식첨가물도 안 먹으려고 하는데 면역력이 걱정이에요',
      '물세안 3개월 하다가 폼클렌징 다시 써봤는데 더 심해졌어요',
      '제약사 크림 쓰고 연고는 일주일 쓰고 중단했다가 상태 안 좋을 때만 써요',
      '폼클렌징 다시 쓰시는 분 계실까요',
    ].join('\n'),
  })
  const skinMust = mustKeepDetails(SKIN.concreteDetailsToKeep).map((d) => d.sample).join(' ')
  expect('#15 162cm 를 잡는다', skinMust.includes('162cm'), true)
  expect('  51kg 도', skinMust.includes('51kg'), true)
  expect('  🔴 48~49kg 범위를 통째로 잡는다', skinMust.includes('48~49kg'), true)
  expect('  외식도', skinMust.includes('외식'), true)
  expect('  첨가물도', skinMust.includes('첨가물'), true)
  expect('  면역력도', skinMust.includes('면역력'), true)
  expect('  크림·연고도', /크림|연고/.test(skinMust), true)
  expect('  물세안·폼클렌징도', /물세안|폼클렌징/.test(skinMust), true)
  expect('  🔴 살이 안 찜도', skinMust.includes('살이 안'), true)
  expect('  빠지면 실패로 올린다',
    profileDirectives(SKIN).join('\n').includes('빠지면 실패입니다'), true)

  // ── #14 도시락: 이모티콘 균등 배치 ──
  const even = analyzeDraft({
    title: 'ㅇ',
    body: ['오늘 도시락 쌌어요ㅋㅋㅋ', '계란말이 잘 됐어요ㅋㅋㅋ', '딸이 좋아했어요ㅋㅋㅋ', '뿌듯하네요ㅋㅋㅋ'].join('\n'),
    sourceTexts: [],
  })
  expect('🔴 줄 끝마다 고르게 박히면 잡는다', (even.emoticonEvenness ?? 0) >= 0.9, true)
  const clumped = analyzeDraft({
    title: 'ㅇ',
    body: ['오늘 도시락을 쌌는데', '계란말이가 진짜 잘 됐어요', '딸이 사진 찍어 갔대요 헤헹ㅋㅋㅋ❤️', '괜히 하루 종일 생각나네요'].join('\n'),
    sourceTexts: [],
  })
  expect('  몰려 있으면 낮게 나온다', (clumped.emoticonEvenness ?? 1) <= 0.5, true)
  // 🔴 짧은 글은 분모가 작아 의미 없는 값이 나온다. null 이어야 한다
  expect('  🔴 줄이 3개 미만이면 null', analyzeDraft({ title: 'ㅇ', body: '한 줄ㅋㅋㅋ', sourceTexts: [] }).emoticonEvenness, null)
  // 🔴 판정이 아니다 — 실패 건수에 섞이지 않는다
  expect('  실패 표현으로 세지 않는다', even.critiqueHits.length, 0)

  // 밝은 톤 지시에 배치 규칙이 있는가
  const bright = readSourceProfile({
    rawTitle: '딸 도시락 자랑 좀 할게요ㅋㅋ',
    rawBody: '오늘 아침에 딸내미 도시락 싸는데 헤헹 너무 예쁘게 나왔지 뭐예요 계란말이가 진짜 진짜 잘 됐어요 ㅋㅋㅋ 딸이 사진 찍어서 자랑했대요 사정상(?) 오늘만 쌌는데 뿌듯하고 기특하고 그러네요',
  })
  const dBright = profileDirectives(bright).join('\n')
  expect('🔴 고르게 하나씩 달지 말라고 말한다', dBright.includes('문장 끝마다 고르게 하나씩'), true)
  expect('  몰릴 때는 몰린다고 말한다', dBright.includes('몰릴 때는 몰리고'), true)
  expect('  ❤️ 는 가장 기쁜 대목에', dBright.includes('가장 기쁜 대목'), true)
  expect('  🔴 괄호 사족 뉘앙스를 살린다', dBright.includes('사정상(?)'), true)
  // 🔴 다급한 글에는 이 배치 규칙이 나오지 않는다
  expect('  다급한 글에는 배치 규칙이 없다', dJaw.includes('문장 끝마다 고르게 하나씩'), false)
}

console.log('\n══════ ㉓ 🔴 5판 실패 표현 · 문체')
{
  for (const x of ['손이 떨리고', '글이 두서없어도 제발 봐주세요', '입을 벌린 채로 멍하니']) {
    expect(`실패 표현 — "${x}"`, CRITIQUE_BANNED_PHRASES.includes(x), true)
    expect(`  계측이 잡는다`,
      analyzeDraft({ title: 'ㅇ', body: `그때 ${x} 있었어요`, sourceTexts: [] }).critiqueHits.includes(x), true)
  }
  for (const r of ['영화 대사 같은 감정 표현', '소설용 공포 표현', '정갈한 요약 후기']) {
    expect(`실패 문체 — ${r}`, CRITIQUE_BANNED_REGISTERS.includes(r), true)
  }
  expect('연극용 절박함도', CRITIQUE_BANNED_REGISTERS.some((r) => r.includes('연극용 절박함')), true)
  // 🔴 너무 넓은 금지어로 정상 표현을 죽이지 않는다
  const normal = analyzeDraft({
    title: 'ㅇ',
    body: '어제 손이 시려워서 장갑을 꺼냈어요 입을 헹구고 나니 좀 나아졌고요',
    sourceTexts: [],
  })
  expect('🔴 정상 표현은 걸리지 않는다', normal.critiqueHits.length, 0)
  expect('  경계 표현도 0', normal.critiqueWatchHits.length, 0)
}

console.log('\n══════ ㉔ 🔴 6판 — 출처 흔적 · 제목 엔진 · 과보정 방지')
{
  // ── 출처 흔적 ──
  const JAW2 = readSourceProfile({
    rawTitle: '턱이 안 벌어져요 어떡하죠',
    rawBody: '줌인아웃에 사진 올렸는데 답이 없어서요 8/24 새벽에 깼고 렉사프로 먹는데도 똑같아요 CT 찍었더니 기도가 좁대요 지금도 침 삼키기 힘들어요 무서워요 무서워요',
  })
  expect('출처 서비스명을 잡는다', JAW2.originTraceTerms.includes('줌인아웃'), true)
  for (const t of ['줌인줌아웃', '82쿡', '레몬테라스', '맘스홀릭', '맘카페', '자유게시판']) {
    expect(`  ${t} 도 잡는다`, originTraceHitsIn(`어제 ${t} 에서 봤어요`).length > 0, true)
  }
  // 🔴 행동으로 드러나는 자리도 잡는다
  expect('  "게시판에 올렸" 도 잡는다', originTraceHitsIn('자유게시판에 사진 올렸는데').length > 0, true)
  expect('  "카페에 올렸" 도 잡는다', originTraceHitsIn('카페에 글 올렸었어요').length > 0, true)
  // 🔴 좁게 유지 — 흔한 말로 정상 문장을 죽이지 않는다
  expect('🔴 커피숍 카페는 걸리지 않는다', originTraceHitsIn('동네 카페에서 커피 마셨어요').length, 0)
  expect('  게시판 없는 문장도 안 걸린다', originTraceHitsIn('사진을 찍어서 남겨뒀어요').length, 0)

  const dJ = profileDirectives(JAW2).join('\n')
  expect('🔴 출처를 남기지 말라고 말한다', dJ.includes('최종 글에 남기지 않습니다'), true)
  expect('  찾아갈 수 있다고 이유를 댄다', dJ.includes('원문을 찾아갈 수 있습니다'), true)
  // 🔴 지우되 상황감은 버리지 않는다
  expect('  🔴 상황감은 행동으로 바꿔 살리라', dJ.includes('출처가 아니라 행동으로 바꿔 씁니다'), true)
  expect('    예시를 준다', dJ.includes('사진도 찍어봤어요'), true)
  expect('    두 번째 예시도', dJ.includes('얼굴 상태도 따로 남겨뒀어요'), true)

  // 🔴 계측 — URL 과 따로 센다
  const traced = analyzeDraft({ title: 'ㅇ', body: '줌인아웃에도 올려봤는데 답이 없네요', sourceTexts: [] })
  expect('🔴 출처 흔적을 계측한다', traced.originTraceHits.includes('줌인아웃'), true)
  expect('  URL 과 섞이지 않는다', traced.urlHits.length, 0)
  const linked = analyzeDraft({ title: 'ㅇ', body: '여기 보세요 https://example.com/a', sourceTexts: [] })
  expect('  링크만 있으면 출처흔적은 0', linked.originTraceHits.length, 0)

  // ── 제목 엔진 ──
  const tJ = titleDirectives(JAW2).join('\n')
  expect('제목 섹션이 있다', tJ.includes('## 🔴 제목'), true)
  expect('🔴 조용한 요약 제목은 실패', tJ.includes('조용한 요약 제목은 실패입니다'), true)
  expect('  눌러 보고 싶은 제목이어야', tJ.includes('눌러 보고 싶은 제목'), true)
  expect('  🔴 낚시·거짓 과장은 금지', tJ.includes('낚시·거짓 과장은 금지'), true)
  expect('  원문 제목을 그대로 쓰지 않는다', tJ.includes('원문 제목을 그대로 쓰지 않습니다'), true)
  // 유형별
  expect('  🔴 도움 요청엔 절박한 호출 허용', tJ.includes('저 어떡하죠'), true)
  expect('    망한 것 같아요도', tJ.includes('망한 것 같아요'), true)

  const brag = readSourceProfile({
    rawTitle: '딸 도시락 자랑 좀 할게요ㅋㅋ',
    rawBody: '오늘 아침에 딸내미 도시락 싸는데 헤헹 예쁘게 나왔지 뭐예요 계란말이가 진짜 잘 됐어요 ㅋㅋㅋ 사정상(?) 오늘만 쌌는데 뿌듯하고 기특하고 그러네요 진짜 뿌듯해요',
  })
  const tB = titleDirectives(brag).join('\n')
  expect('  🔴 자랑글엔 주접 제목 허용', tB.includes('수발러 나야 나'), true)
  expect('    사서 고생도', tB.includes('사서 고생'), true)
  expect('    점잖게 줄이지 말라', tB.includes('점잖게 줄이지 마세요'), true)

  const skin2 = readSourceProfile({
    rawTitle: '피부가 자꾸 뒤집어지는데 물세안 계속해도 될까요',
    rawBody: '물세안 3개월 하다가 폼클렌징 다시 써봤는데 더 심해졌어요 트러블이 계속 올라와서 피부과 다녀왔고 제약사 크림이랑 연고 받아왔어요 연고는 일주일 바르고 중단했다가 안 좋을 때만 발라요 162cm 에 51kg 이었는데 48~49kg 까지 빠지고 살이 안 쪄요 외식 줄이고 음식첨가물도 피하는데 면역력이 걱정이에요 폼클렌징 다시 쓰시는 분 계실까요',
  })
  const tS = titleDirectives(skin2).join('\n')
  expect('  🔴 경험자 호출엔 기간·증상·질문이 보이게', tS.includes('3개월 차'), true)
  expect('    다 뒤집어짐도', tS.includes('다 뒤집어짐'), true)
  expect('    영향 있을까요도', tS.includes('영향 있을까요'), true)
  // 🔴 유형이 다르면 제목 지시도 달라야 한다
  expect('🔴 유형별로 제목 지시가 다르다', tJ === tB, false)
  expect('  자랑글과 질문글도 다르다', tB === tS, false)

  // ── #17 과보정 방지 ──
  const dB = profileDirectives(brag).join('\n')
  expect('🔴 밝은 글에만 밝은 유지어가 실린다', dB.includes('수발러'), true)
  expect('  🔴 다급한 글에는 안 실린다', dJ.includes('수발러'), false)
  const dS = profileDirectives(skin2).join('\n')
  expect('  🔴 질문 글에도 안 실린다', dS.includes('수발러'), false)
  expect('  괄호 사족은 유지', dB.includes('사정상(?)'), true)
  expect('  🔴 정돈된 인사문으로 맺지 말라', dB.includes('정돈된 인사문'), true)
  expect('    감정 뒤에 인사가 온다고 말한다', dB.includes('그 김에 인사로 흘러가는'), true)
  expect('  이모티콘 균등 배치 금지 유지', dB.includes('문장 끝마다 고르게 하나씩'), true)

  // ── #18 흐름 필수화 ──
  expect('🔴 사용 패턴이 필수 종류다', MUST_KEEP_KINDS.includes('usage_pattern'), true)
  const skinMust2 = mustKeepDetails(skin2.concreteDetailsToKeep)
  const skinSamples = skinMust2.map((d) => d.sample).join(' ')
  const skinKinds2 = new Set(skinMust2.map((d) => d.kind))
  expect('  🔴 연고 사용 패턴을 잡는다', skinKinds2.has('usage_pattern'), true)
  expect('    "안 좋을 때" 를 잡는다', /안 좋을 때/.test(skinSamples), true)
  expect('  제약사 크림·연고', /크림|연고/.test(skinSamples), true)
  expect('  162cm', skinSamples.includes('162cm'), true)
  expect('  51kg', skinSamples.includes('51kg'), true)
  expect('  48~49kg', skinSamples.includes('48~49kg'), true)
  expect('  외식·첨가물', /외식|첨가물/.test(skinSamples), true)
  expect('  면역력', skinSamples.includes('면역력'), true)
  expect('  살이 안 찜', skinSamples.includes('살이 안'), true)
  // 🔴 단정한 질문문 금지 + 자책 허용
  expect('🔴 단정한 질문문으로 열지 말라', dS.includes('단정한 질문문으로 시작하지 마세요'), true)
  expect('  설문지가 된다고 이유를 댄다', dS.includes('설문지가 됩니다'), true)
  expect('  🔴 자책·억울함을 살리라', dS.includes('자책이나 억울함'), true)
  expect('  🔴 없으면 만들지 말라', dS.includes('없으면 만들지 않습니다'), true)
}

console.log('\n══════ ㉕ 🔴 7판 — 저장 가드 (레코드별 · 눈금 통일)')
{
  const SRC = '요 며칠 새벽에 자꾸 깹니다 이불을 걷었다 덮었다 하다 보면 어느새 네 시가 넘어 있고 그때부터는 다시 잠들기가 어렵습니다'
  const SAMPLE = '어제 김장을 하다 말고 허리를 폈는데 그대로 한참을 서 있었습니다 별것도 아닌데 눈물이 났어요'
  const rec = (id: string, body: string): OriginalPostRecord =>
    ({ sourceRawContentId: id, title: '제목', body })

  // ── ① 3건 중 1건만 유출이면 1건만 빠진다 ──
  const three = [
    rec('r1', '어제 라디오를 켜 두고 앉아 있었습니다 소리가 있으면 좀 낫더라고요'),
    rec('r2', SRC.slice(0, 45)),                       // 🔴 원문 그대로
    rec('r3', '오늘은 창문을 열어 두고 커피를 마셨어요 바람이 제법 선선하네요'),
  ]
  const part = partitionByStoredSource(three, [SRC, SAMPLE])
  expect('🔴 3건 중 1건만 유출 → 2건 저장', part.clean.length, 2)
  expect('  제외는 1건', part.leaking.length, 1)
  expect('  🔴 걸린 것이 r2 다', part.leaking[0]?.record.sourceRawContentId, 'r2')
  expect('  유출 조각 수를 알려준다', (part.leaking[0]?.echoCount ?? 0) > 0, true)
  expect('  깨끗한 것은 r1 · r3', part.clean.map((r) => r.sourceRawContentId).join(','), 'r1,r3')
  // 🔴 순서가 유지돼야 어느 재료의 초안인지 짝을 잃지 않는다
  expect('  🔴 원래 순서를 지킨다', part.clean[0]?.sourceRawContentId, 'r1')

  // ── ② 공백만 바꾼 20자 복붙 ──
  const noSpace = rec('r4', SRC.slice(0, 45).replace(/ /g, ''))
  expect('🔴 공백을 지운 복붙도 잡는다', partitionByStoredSource([noSpace], [SRC]).leaking.length, 1)
  const threwNoSpace = (() => {
    try { assertNoStoredSource([noSpace], [SRC]); return false } catch { return true }
  })()
  expect('  assert 도 잡는다', threwNoSpace, true)

  // ── ③ 줄바꿈만 바꾼 20자 복붙 ──
  const nl = rec('r5', SRC.slice(0, 45).replace(/ /g, '\n'))
  expect('🔴 줄바꿈으로 바꾼 복붙도 잡는다', partitionByStoredSource([nl], [SRC]).leaking.length, 1)
  const threwNl = (() => {
    try { assertNoStoredSource([nl], [SRC]); return false } catch { return true }
  })()
  expect('  assert 도 잡는다', threwNl, true)

  // ── ④ 정상 레코드는 통과 ──
  const okRec = rec('r6', '어제는 라디오를 켜 두고 한참 앉아 있었어요 소리가 있으면 좀 낫더라고요')
  expect('정상 레코드는 통과', partitionByStoredSource([okRec], [SRC, SAMPLE]).clean.length, 1)
  expect('  제외 0건', partitionByStoredSource([okRec], [SRC, SAMPLE]).leaking.length, 0)
  expect('  assert 도 통과', (() => {
    try { assertNoStoredSource([okRec], [SRC, SAMPLE]); return true } catch { return false }
  })(), true)

  // ── ⑤ voice 샘플도 대조 대상이다 ──
  const sampleEcho = rec('r7', SAMPLE.slice(0, 45))
  expect('🔴 말투 샘플 복붙도 제외된다', partitionByStoredSource([sampleEcho], [SRC, SAMPLE]).leaking.length, 1)
  expect('  원문만 넘기면 못 잡는다(그래서 둘 다 넘긴다)',
    partitionByStoredSource([sampleEcho], [SRC]).leaking.length, 0)

  // ── ⑥ 두 검사기의 눈금이 같다 ──
  const probes = [
    ['그대로', SRC.slice(0, 45)],
    ['공백 제거', SRC.slice(0, 45).replace(/ /g, '')],
    ['줄바꿈 대체', SRC.slice(0, 45).replace(/ /g, '\n')],
    ['정상', '어제는 라디오를 켜 두고 앉아 있었어요'],
  ] as const
  for (const [label, body] of probes) {
    const viaAnalyze = analyzeDraft({ title: '제목', body, sourceTexts: [SRC] }).sourceEchoCount > 0
    const viaPart = partitionByStoredSource([rec('x', body)], [SRC]).leaking.length > 0
    expect(`🔴 눈금 일치 — ${label}`, viaAnalyze, viaPart)
  }
  // 🔴 공통 함수를 쓰는지 직접 확인한다
  expect('sourceEchoCount 가 공통 함수다', sourceEchoCount(SRC.slice(0, 45), [SRC]) > 0, true)
  expect('  정규화도 공통이다', normalizeForEcho('가 나\n다'), '가나다')
  expect('  20자 미만 원문은 건너뛴다', sourceEchoCount('아무 글이나 적어 봅니다', ['짧다']), 0)
  expect('  20자 미만 초안도 0', sourceEchoCount('짧은 글', [SRC]), 0)

  // ── ⑦ 저장 계약 3키는 그대로 ──
  expect('저장 키 3개 유지', ALLOWED_RECORD_KEYS.join(','), 'sourceRawContentId,title,body')
  const badKey = { sourceRawContentId: 'r', title: 't', body: 'b', rawBody: 'x' } as unknown as OriginalPostRecord
  expect('🔴 허용 외 필드는 여전히 throw', (() => {
    try { assertNoStoredSource([badKey], []); return false } catch { return true }
  })(), true)
  // 🔴 키 위반은 partition 이 아니라 throw 다 — 그건 데이터가 아니라 코드 결함이다
  expect('  partition 은 키 위반을 거르지 않는다',
    partitionByStoredSource([badKey], []).clean.length, 1)
}

console.log('\n══════ ㉖ 🔴 표본 선정 — 길이 분위수 (limit 5)')
{
  type R = { id: string; len: number }
  const mk = (n: number): R[] => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, len: 100 + i * 10 }))
  const pick = (items: readonly R[], limit: number): R[] =>
    selectByLengthQuantile({ items, lengthOf: (r) => r.len, keyOf: (r) => r.id, limit })

  // ── 5건 선정: 양 끝 + 사이가 고르게 ──
  const ten = mk(10) // 길이 100 · 110 … 190
  const five = pick(ten, 5)
  expect('limit 5 → 5건', five.length, 5)
  expect('  🔴 가장 짧은 것이 들어간다(p0)', five[0]?.len, 100)
  expect('  🔴 가장 긴 것이 들어간다(p100)', five[4]?.len, 190)
  expect('  p25', five[1]?.len, 120)
  expect('  p50', five[2]?.len, 150)
  expect('  p75', five[3]?.len, 170)
  // 🔴 뭉치지 않는가 — 이전 로직은 4·5번째가 계속 중앙값이었다
  const gaps = five.slice(1).map((r, i) => r.len - five[i]!.len)
  expect('  🔴 간격이 전부 0보다 크다(뭉치지 않는다)', gaps.every((g) => g > 0), true)
  expect('  길이 오름차순', five.map((r) => r.len).join(','), '100,120,150,170,190')

  // ── rawId 중복 없음 ──
  expect('🔴 id 중복 없음', new Set(five.map((r) => r.id)).size, 5)
  const many = pick(mk(40), 5)
  expect('  40건에서도 중복 없음', new Set(many.map((r) => r.id)).size, 5)
  expect('  양 끝을 포함한다', `${many[0]?.len},${many[4]?.len}`, '100,490')

  // ── 결정적 ──
  const again = pick([...ten].reverse(), 5)
  expect('🔴 입력 순서가 달라도 같은 결과', again.map((r) => r.id).join(','), five.map((r) => r.id).join(','))
  // 길이가 같으면 id 로 가른다 — 그래야 재현된다
  const tie = [
    { id: 'b', len: 300 }, { id: 'a', len: 300 }, { id: 'c', len: 100 }, { id: 'd', len: 500 },
  ]
  expect('  길이가 같으면 id 순',
    pick(tie, 4).map((r) => r.id).join(','), pick([...tie].reverse(), 4).map((r) => r.id).join(','))

  // ── limit 3 은 이전 의도와 같은 집합 ──
  const three = pick(ten, 3)
  expect('limit 3 → 3건', three.length, 3)
  expect('  🔴 짧은 것·중앙·긴 것 (이전과 같은 집합)', three.map((r) => r.len).join(','), '100,150,190')

  // ── limit 1 은 가장 긴 것 (이전 동작 유지) ──
  expect('limit 1 → 가장 긴 것', pick(ten, 1)[0]?.len, 190)

  // ── 5건 미만일 때 안전 ──
  expect('🔴 3건뿐인데 5를 요청하면 3건', pick(mk(3), 5).length, 3)
  expect('  그래도 중복 없음', new Set(pick(mk(3), 5).map((r) => r.id)).size, 3)
  expect('  양 끝은 포함', pick(mk(3), 5).map((r) => r.len).join(','), '100,110,120')
  expect('  1건뿐이면 1건', pick(mk(1), 5).length, 1)
  expect('  🔴 0건이면 0건 (던지지 않는다)', pick([], 5).length, 0)
  expect('  limit 0 이면 0건', pick(ten, 0).length, 0)
  expect('  음수 limit 도 0건', pick(ten, -1).length, 0)

  // ── 실제 재료 분포와 같은 모양에서 ──
  const real: R[] = [
    { id: 'a', len: 137 }, { id: 'b', len: 236 }, { id: 'c', len: 566 },
    { id: 'd', len: 741 }, { id: 'e', len: 1071 },
  ]
  expect('현재 재료 5건 → 5건 전부', pick(real, 5).map((r) => r.len).join(','), '137,236,566,741,1071')
}

console.log('\n══════ ㉗ 🔴 생성기 상한 · 선정 배선 (정적 검사)')
{
  const code = readFileSync('scripts/original-post-generate.mts', 'utf-8')
  expect('MAX_LIMIT = 5', /const MAX_LIMIT = 5\b/.test(code), true)
  expect('  --limit 범위를 검사한다', code.includes('LIMIT > MAX_LIMIT'), true)
  // 🔴 선정 규칙을 생성기가 따로 적지 않는다 — 순수 함수를 부른다
  expect('🔴 분위수 함수를 쓴다', code.includes('selectByLengthQuantile({'), true)
  expect('  길이는 자소 단위로 센다', code.includes('lengthOf: (r) => [...r.rawBody].length'), true)
  expect('  키는 rawId 다', code.includes('keyOf: (r) => r.id'), true)
  expect('  🔴 옛 중앙값 반복 로직이 남아 있지 않다', code.includes('rest[Math.floor(rest.length / 2)]'), false)
  expect('  분위수 라벨을 화면에 찍는다', code.includes('p${String(pct).padStart(3)}'), true)
  // 🔴 dry-run 계약은 그대로다
  expect('dry-run 은 파일을 쓰지 않는다', /if \(!CALL\)[\s\S]{0,400}process\.exit\(0\)/.test(code), true)
  expect('  🔴 Post 를 만들지 않는다', /post\.create|post\.upsert/.test(code), false)
  expect('  🔴 직접 fetch 하지 않는다', /\bfetch\(/.test(code), false)
  expect('  🔴 Sheet 를 쓰지 않는다', /Sheet|sheet/.test(code), false)
}

console.log('\n══════ ㉑ 🔴 생성기가 프로파일을 배선했는가 (정적 검사)')
{
  const code = readFileSync('scripts/original-post-generate.mts', 'utf-8')
  expect('생성 전에 프로파일을 읽는다', code.includes('readSourceProfile({ rawTitle: raw.rawTitle'), true)
  expect('  buildPrompt 에 넘긴다', code.includes('profile,'), true)
  expect('  화면에 찍는다', code.includes('profile.emotionTone'), true)
  expect('  🔴 번호 예외를 프로파일에서 가져온다',
    code.includes('profile.preserveStructure.numberedList'), true)
  expect('  실패 표현을 찍는다', code.includes('s.critiqueHits.length'), true)
  expect('  외부 호칭을 찍는다', code.includes('s.externalAddressHits.length'), true)
  expect('  🔴 링크를 찍는다', code.includes('s.urlHits.length'), true)
  expect('  경계 표현도 찍는다', code.includes('s.critiqueWatchHits.length'), true)
  expect('  🔴 필수 디테일 수를 찍는다', code.includes('mustKeepDetails(profile.concreteDetailsToKeep).length'), true)
  expect('  이모티콘 배치도 찍는다', code.includes('s.emoticonEvenness'), true)
  expect('  🔴 출처 흔적도 찍는다', code.includes('s.originTraceHits.length'), true)
  // 🔴 저장 계약은 그대로다 — profile · critic 은 저장하지 않는다
  expect('🔴 프로파일을 저장하지 않는다', /toOriginalPostRecord\([\s\S]{0,200}?profile/.test(code), false)
  expect('  저장 키 3개 그대로', ALLOWED_RECORD_KEYS.join(','), 'sourceRawContentId,title,body')
  expect('  유출 대조 양쪽 유지',
    code.includes('const allSources = [...sourceTexts, ...voiceSampleBodies]'), true)
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)
