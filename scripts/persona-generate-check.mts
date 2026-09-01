#!/usr/bin/env tsx
/**
 * 생성기 fixture — 🔴 LLM · DB · 네트워크 · 파일 IO 없음
 *
 * 🔴 프롬프트 조립과 응답 파싱을 순수 함수로 빼 둔 이유가 이 파일이다.
 *    돈을 쓰지 않고 "무엇을 시키는가 · 무엇을 받아들이는가" 를 전수로 확인한다.
 *
 * 실행: npx tsx scripts/persona-generate-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import {
  buildPrompt, parseCandidate, toCandidateRecord, assertNoStoredSource,
  isReactionType, REACTION_TYPES, MAX_OUTPUT_TOKENS, SOURCE_ECHO_MIN, ALLOWED_RECORD_KEYS,
  CLICHE_COMFORT_PHRASES, CLICHE_OPENERS, PROMPT_TARGET_MAX_CHARS,
  type PromptPersona, type PromptTargetPost, type PromptBlockCode, type CandidateRecord,
} from './lib/persona-prompt'
// 🔴 sourcePostId 로 조달한 원문이 Gate ① 에서 실제로 대조되는지 확인한다
import { checkCommentCandidate } from './lib/persona-comment-candidate.mjs'
import { BRAND_BANNED_WORDS } from '../src/lib/content-guard'
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from '../src/lib/comment-policy'

let failed = 0
let passed = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = actual === want
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}

const persona = (): PromptPersona => ({
  code: 'P05',
  ageBand: '50대 초반',
  region: '수도권',
  lifeStage: '자녀 독립기',
  identity: { maritalStatus: '기혼', childrenCount: 2 },
  voiceCore: { ending: '~네요', length: '짧음', emoji: '거의 없음' },
  voiceVariations: [{ mood: '피곤', ending: '~요' }],
  noGoTopics: ['정치', '종교'],
  noGoExpressions: ['대박'],
  forbiddenReactionRoles: ['rebuttal'],
})

const post = (): PromptTargetPost => ({
  title: '요즘 잠이 자꾸 깨는데 다들 어떠신가요',
  content: '새벽 세시쯤 꼭 한 번씩 깹니다. 다시 잠들기가 어려워서 아침이 늘 무겁네요.',
  boardLabel: 'MENOPAUSE',
})

const codes = (p: ReturnType<typeof buildPrompt>): PromptBlockCode[] =>
  p.ok ? [] : p.blocks.map((b) => b.code)

console.log('\n══════ ① 기준 입력은 프롬프트를 만든다')
{
  const p = buildPrompt({ persona: persona(), post: post(), reactionType: 'empathy' })
  expect('ok', p.ok, true)
  if (p.ok) {
    expect('  maxOutputTokens', p.prompt.maxOutputTokens, MAX_OUTPUT_TOKENS)
    expect('  system 이 비어 있지 않다', p.prompt.systemPrompt.length > 200, true)
    expect('  user 에 제목이 들어간다', p.prompt.userPayload.includes(post().title), true)
    expect('  user 에 본문이 들어간다', p.prompt.userPayload.includes(post().content.trim()), true)
  }
}

console.log('\n══════ ② 반응 유형 (전수)')
{
  const offenders: string[] = []
  for (const rt of REACTION_TYPES) {
    const per = persona()
    // rebuttal 은 금지 역할이라 따로 본다
    const p = buildPrompt({ persona: per, post: post(), reactionType: rt })
    const want = rt !== 'rebuttal'
    if (p.ok !== want) offenders.push(`${rt}=${p.ok}`)
  }
  expect(`${REACTION_TYPES.length}종 전수 — 금지 역할만 차단`, offenders.join(' / '), '')
  expect('isReactionType(알 수 없는 값)', isReactionType('sarcasm'), false)

  const bad = buildPrompt({ persona: persona(), post: post(), reactionType: 'sarcasm' })
  expect('알 수 없는 유형 → REACTION_TYPE_INVALID', codes(bad).includes('REACTION_TYPE_INVALID'), true)

  const forbidden = buildPrompt({ persona: persona(), post: post(), reactionType: 'rebuttal' })
  expect('금지 역할 → REACTION_ROLE_FORBIDDEN', codes(forbidden).includes('REACTION_ROLE_FORBIDDEN'), true)
}

console.log('\n══════ ③ 말투 · 글이 없으면 만들지 않는다')
{
  const noVoice = persona(); noVoice.voiceCore = null
  expect(
    'voiceCore 없음 → PERSONA_VOICE_MISSING',
    codes(buildPrompt({ persona: noVoice, post: post(), reactionType: 'empathy' })).includes('PERSONA_VOICE_MISSING'),
    true,
  )
  const emptyVoice = persona(); emptyVoice.voiceCore = {}
  expect(
    '빈 객체도 없음으로 본다',
    codes(buildPrompt({ persona: emptyVoice, post: post(), reactionType: 'empathy' })).includes('PERSONA_VOICE_MISSING'),
    true,
  )
  const noTitle = post(); noTitle.title = '  '
  expect(
    '제목 공백 → POST_TITLE_EMPTY',
    codes(buildPrompt({ persona: persona(), post: noTitle, reactionType: 'empathy' })).includes('POST_TITLE_EMPTY'),
    true,
  )
  const noBody = post(); noBody.content = ''
  expect(
    '본문 없음 → POST_CONTENT_EMPTY',
    codes(buildPrompt({ persona: persona(), post: noBody, reactionType: 'empathy' })).includes('POST_CONTENT_EMPTY'),
    true,
  )
}

console.log('\n══════ ④ 🔴 금지어가 프롬프트에 지침으로 들어간다 (Gate ⑤ 와 같은 상수)')
{
  const p = buildPrompt({ persona: persona(), post: post(), reactionType: 'empathy' })
  const sys = p.ok ? p.prompt.systemPrompt : ''
  const missing = BRAND_BANNED_WORDS.filter((w) => !sys.includes(w))
  expect(`브랜드 금칙어 ${BRAND_BANNED_WORDS.length}종 전부 명시`, missing.join(','), '')
  expect('  No-Go 주제가 들어간다', sys.includes('정치') && sys.includes('종교'), true)
  expect('  No-Go 표현이 들어간다', sys.includes('대박'), true)
  expect('  길이 정책이 들어간다', sys.includes(String(MAX_COMMENT_LENGTH)), true)
  expect('  진단·처방 금지가 들어간다', sys.includes('진단'), true)
  expect('  출처 언급 금지가 들어간다', sys.includes('카페'), true)
}

console.log('\n══════ ⑨ 🔴 #9 실패(② 원문 공유 · ⑧ 말투 반복)를 겨냥한 지시')
{
  const p = buildPrompt({ persona: persona(), post: post(), reactionType: 'empathy' })
  const sys = p.ok ? p.prompt.systemPrompt : ''

  // ② — source 와 공유하는 희귀 n-gram 이 1개라도 있으면 regenerate 다.
  //     "원문을 옮기지 마라" 를 이름 대고 막는지 본다.
  expect('② 원문 조각 금지가 명시된다', sys.includes('한 조각도 그대로 쓰지 않습니다'), true)
  expect('  살짝 바꿔 옮기기도 금지', sys.includes('말을 살짝 바꿔 옮기는 것도 안 됩니다'), true)
  expect('  증상·상황 요약 금지', sys.includes('되풀이해 요약하지 않습니다'), true)

  // ⑧ HOOK — 시작어절 반복. 상투적 첫 어절을 이름으로 막는지 본다
  const missingOpeners = CLICHE_OPENERS.filter((w) => !sys.includes(w))
  expect(`⑧ 상투적 첫 어절 ${CLICHE_OPENERS.length}종 전부 명시`, missingOpeners.join(','), '')

  // ⑧ ENDING — 말끝 반복
  expect('⑧ 말끝 다르게 쓰기가 명시된다', sys.includes('말끝을 서로 다르게'), true)
  expect('  같은 어미 반복 금지', sys.includes('같은 어미로 두 번 끝내지 않습니다'), true)
  expect('  같은 리듬 반복 금지', sys.includes('같은 리듬을 매번 반복하면'), true)

  // 상투적 위로
  const missingCliche = CLICHE_COMFORT_PHRASES.filter((w) => !sys.includes(w))
  expect(`상투적 위로 ${CLICHE_COMFORT_PHRASES.length}종 전부 명시`, missingCliche.join(','), '')

  // 길이 — 짧을수록 반복할 자리가 줄어든다
  expect('권장 길이 상한이 명시된다', sys.includes(String(PROMPT_TARGET_MAX_CHARS)), true)
  expect('  정책 상한보다 좁다', PROMPT_TARGET_MAX_CHARS < MAX_COMMENT_LENGTH, true)

  // 정보 제공 · 판단 금지
  expect('방법 안내 금지가 명시된다', sys.includes('방법을 알려주지 않습니다'), true)
  expect('  판단 금지가 명시된다', sys.includes('판단하지 않습니다'), true)
  expect('  묻지 않은 정보 금지', sys.includes('묻지 않은 정보를 얹지 않습니다'), true)
}

console.log('\n══════ ⑤ 응답 파싱')
{
  expect('정상 JSON', parseCandidate('{"comment":"저도 그맘때 그랬어요"}').ok, true)

  const fenced = parseCandidate('```json\n{"comment":"저도 그맘때 그랬어요"}\n```')
  expect('🔴 코드블록 울타리 (M3 Haiku 사고)', fenced.ok, true)
  expect('  본문이 정확히 나온다', fenced.ok ? fenced.text : '', '저도 그맘때 그랬어요')

  const bare = parseCandidate('```\n{"comment":"저도 그맘때 그랬어요"}\n```')
  expect('언어 없는 울타리', bare.ok, true)

  const prefilled = parseCandidate('"comment":"저도 그맘때 그랬어요"}')
  expect('🔴 Anthropic prefill (여는 중괄호 없음)', prefilled.ok, true)

  const empty = parseCandidate('   ')
  expect('빈 응답 → EMPTY', empty.ok ? '' : empty.errorCode, 'EMPTY')

  const broken = parseCandidate('여기 댓글입니다: 안녕하세요')
  expect('JSON 아님 → JSON_PARSE', broken.ok ? '' : broken.errorCode, 'JSON_PARSE')

  const noField = parseCandidate('{"text":"댓글"}')
  expect('comment 없음 → FIELD_MISSING', noField.ok ? '' : noField.errorCode, 'FIELD_MISSING')

  const short = parseCandidate('{"comment":"음"}')
  expect(`${MIN_COMMENT_LENGTH}자 미만 → TOO_SHORT`, short.ok ? '' : short.errorCode, 'TOO_SHORT')

  const two = parseCandidate('{"comment":"맞아"}')
  expect(`${MIN_COMMENT_LENGTH}자 → 통과`, two.ok, true)

  const long = parseCandidate(JSON.stringify({ comment: '가'.repeat(MAX_COMMENT_LENGTH + 1) }))
  expect(`${MAX_COMMENT_LENGTH}자 초과 → TOO_LONG`, long.ok ? '' : long.errorCode, 'TOO_LONG')

  const trimmed = parseCandidate('{"comment":"  앞뒤 공백 있어요  "}')
  expect('앞뒤 공백 제거', trimmed.ok ? trimmed.text : '', '앞뒤 공백 있어요')
}

console.log('\n══════ ⑥ 🔴 원문 저장 금지 계약')
{
  const rec = toCandidateRecord({ personaCode: 'P05', text: '  저도 그랬어요  ', sourcePostId: ' post_1 ' })
  expect('레코드 키는 셋뿐', Object.keys(rec).sort().join(','), 'personaCode,sourcePostId,text')
  expect('  허용 키 목록과 일치', [...ALLOWED_RECORD_KEYS].sort().join(','), 'personaCode,sourcePostId,text')
  expect('  text 는 trim 된다', rec.text, '저도 그랬어요')
  // 🔴 sourcePostId 는 원문이 아니라 참조다 — 허용되지만 원문은 여전히 금지
  expect('  sourcePostId 는 trim 된다', rec.sourcePostId, 'post_1')

  const source = post().content
  const throws = (records: CandidateRecord[], sources: string[]): string => {
    try { assertNoStoredSource(records, sources); return '' } catch (e) { return e instanceof Error ? 'throw' : '?' }
  }

  expect('정상 레코드 → 통과', throws([rec], [source]), '')

  // 🔴 원문 연속 20자를 그대로 담은 레코드
  const echo = [...source].slice(0, SOURCE_ECHO_MIN + 4).join('')
  expect(
    `원문 연속 ${SOURCE_ECHO_MIN}자 포함 → throw`,
    throws([{ personaCode: 'P05', text: echo, sourcePostId: 'post_1' }], [source]),
    'throw',
  )

  // 🔴 sourcePostId 가 허용된 뒤에도 원문 필드는 여전히 막힌다
  const banned = ['sourceTexts', 'sourceUrl', 'sourceRef', 'author', 'rawContent']
  const smuggledCodes = banned.map((key) => {
    const r = { personaCode: 'P05', text: '저도 그랬어요', sourcePostId: 'post_1', [key]: source }
    return `${key}=${throws([r as unknown as CandidateRecord], [])}`
  })
  expect(
    `원문 필드 ${banned.length}종 전부 throw`,
    smuggledCodes.join(','),
    banned.map((k) => `${k}=throw`).join(','),
  )

  // 짧은 source 는 대조 대상이 아니다 (오탐 방지)
  expect('20자 미만 source 는 건너뛴다', throws([rec], ['짧은글']), '')
}

console.log('\n══════ ⑧ 🔴 sourcePostId 로 런타임 대조가 성립한다')
{
  // Gate ① 은 후보 본문 대 원문을 20자 단위로 본다.
  // 파일에 원문이 없어도 sourcePostId → DB 조회로 같은 대조가 가능해야 한다.
  // 여기서는 "조달된 원문을 넘기면 유출이 잡히는가" 만 순수하게 확인한다.
  const source = post().content
  // 🔴 Gate ① 은 **공백을 지운 뒤** 연속 20자를 본다.
  //    글자 수로 22자를 떠 오면 공백 때문에 17자가 되어 잡히지 않는다 — 넉넉히 뜬다.
  const echoed = [...source].slice(0, 38).join('')

  const leaked = checkCommentCandidate({
    personaCode: 'P05',
    text: echoed,
    sourceTexts: [source], // ← sourcePostId 로 DB 에서 읽어 넘긴 값이라고 보면 된다
  })
  expect('조달한 원문으로 ① 유출을 잡는다', leaked.sourceLeak, true)

  // 🔴 조달하지 못하면(빈 배열) pass 가 아니어야 한다 — "검사 불가"가 통과로 보이면 안 된다
  const notRun = checkCommentCandidate({ personaCode: 'P05', text: '그러네요 저도요', sourceTexts: [] })
  expect('원문을 못 넘기면 pass 아님', notRun.status !== 'pass', true)
}

console.log('\n══════ ⑦ 프롬프트에 API key 나 저장 경로가 섞이지 않는다')
{
  const p = buildPrompt({ persona: persona(), post: post(), reactionType: 'empathy' })
  const all = p.ok ? p.prompt.systemPrompt + p.prompt.userPayload : ''
  expect('sk- 문자열 없음', all.includes('sk-'), false)
  expect('env 이름 없음', all.includes('API_KEY'), false)
  expect('파일 경로 없음', all.includes('tmp/'), false)
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)
