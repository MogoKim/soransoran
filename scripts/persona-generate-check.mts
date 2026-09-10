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
  CLICHE_COMFORT_PHRASES, extractVoiceMarks, MAX_RECENT_MARKS,
  type PromptPersona, type PromptTargetPost, type PromptBlockCode, type CandidateRecord,
} from './lib/persona-prompt'
// 🔴 sourcePostId 로 조달한 원문이 Gate ① 에서 실제로 대조되는지 확인한다
import { checkCommentCandidate } from './lib/persona-comment-candidate.mjs'
import { BRAND_BANNED_WORDS } from '../src/lib/content-guard'
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from '../src/lib/comment-policy'
import { judgeReferenceBundle, type VoiceReferenceBundle } from '../src/lib/persona-voice-reference'

/**
 * 🔴 시험용 말투 근거. **실제 자산이 아니다** —
 *    자산 연결은 `persona-comment-engine-check` 가 실물로 본다.
 */
const refBundle = (): VoiceReferenceBundle => {
  const v = judgeReferenceBundle({
    personaCode: 'S01',
    texts: [
      '저도 그맘때 딱 그랬어요',
      '병원은 가보셨어요? 저는 한참 미루다 갔거든요',
      '읽다가 남 일 같지가 않네요',
      '그거 진짜 서럽죠 저만 그런 줄 알았어요',
      '무릎은 계단이 제일 무섭더라구요',
      '요즘은 좀 어떠세요',
      '아 저도 작년에 똑같았어요 지금은 그래도 좀 나아요',
      '괜히 마음이 내려앉네요',
      '저는 그때 그냥 울었어요',
    ],
  })
  if (!v.ok) throw new Error(`시험용 근거가 계약을 못 지킨다 — ${v.blocks.map((b) => b.code).join(',')}`)
  return v.bundle
}

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
  const p = buildPrompt({ persona: persona(), post: post(), reactionType: 'empathy', reference: refBundle() })
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
    const p = buildPrompt({ persona: per, post: post(), reactionType: rt, reference: refBundle() })
    const want = rt !== 'rebuttal'
    if (p.ok !== want) offenders.push(`${rt}=${p.ok}`)
  }
  expect(`${REACTION_TYPES.length}종 전수 — 금지 역할만 차단`, offenders.join(' / '), '')
  expect('isReactionType(알 수 없는 값)', isReactionType('sarcasm'), false)

  const bad = buildPrompt({ persona: persona(), post: post(), reactionType: 'sarcasm', reference: refBundle() })
  expect('알 수 없는 유형 → REACTION_TYPE_INVALID', codes(bad).includes('REACTION_TYPE_INVALID'), true)

  const forbidden = buildPrompt({ persona: persona(), post: post(), reactionType: 'rebuttal', reference: refBundle() })
  expect('금지 역할 → REACTION_ROLE_FORBIDDEN', codes(forbidden).includes('REACTION_ROLE_FORBIDDEN'), true)
}

console.log('\n══════ ③ 말투 · 글이 없으면 만들지 않는다')
{
  const noVoice = persona(); noVoice.voiceCore = null
  expect(
    'voiceCore 없음 → PERSONA_VOICE_MISSING',
    codes(buildPrompt({ persona: noVoice, post: post(), reactionType: 'empathy', reference: refBundle() })).includes('PERSONA_VOICE_MISSING'),
    true,
  )
  const emptyVoice = persona(); emptyVoice.voiceCore = {}
  expect(
    '빈 객체도 없음으로 본다',
    codes(buildPrompt({ persona: emptyVoice, post: post(), reactionType: 'empathy', reference: refBundle() })).includes('PERSONA_VOICE_MISSING'),
    true,
  )
  const noTitle = post(); noTitle.title = '  '
  expect(
    '제목 공백 → POST_TITLE_EMPTY',
    codes(buildPrompt({ persona: persona(), post: noTitle, reactionType: 'empathy', reference: refBundle() })).includes('POST_TITLE_EMPTY'),
    true,
  )
  const noBody = post(); noBody.content = ''
  expect(
    '본문 없음 → POST_CONTENT_EMPTY',
    codes(buildPrompt({ persona: persona(), post: noBody, reactionType: 'empathy', reference: refBundle() })).includes('POST_CONTENT_EMPTY'),
    true,
  )
}

console.log('\n══════ ④ 🔴 금지어가 프롬프트에 지침으로 들어간다 (Gate ⑤ 와 같은 상수)')
{
  const p = buildPrompt({ persona: persona(), post: post(), reactionType: 'empathy', reference: refBundle() })
  const sys = p.ok ? p.prompt.systemPrompt : ''
  const missing = BRAND_BANNED_WORDS.filter((w) => !sys.includes(w))
  expect(`브랜드 금칙어 ${BRAND_BANNED_WORDS.length}종 전부 명시`, missing.join(','), '')
  expect('  No-Go 주제가 들어간다', sys.includes('정치') && sys.includes('종교'), true)
  expect('  No-Go 표현이 들어간다', sys.includes('대박'), true)
  expect('  길이 정책이 들어간다', sys.includes(String(MAX_COMMENT_LENGTH)), true)
  expect('  진단·처방 금지가 들어간다', sys.includes('진단'), true)
  expect('  출처 언급 금지가 들어간다', sys.includes('카페'), true)
}

console.log('\n══════ ⑩ 🔴 A안 — 최근 발화 말투 표지 주입')
{
  const marks = extractVoiceMarks([
    '밤마다 뒤척이다 새벽에 깨요',
    '저도 그맘때 그랬어요',
  ])
  expect('시작어절을 뽑는다', marks.openers.length > 0, true)
  expect('말끝을 뽑는다', marks.endings.length > 0, true)
  expect('빈 입력 → 빈 표지', extractVoiceMarks([]).openers.length, 0)
  expect('공백만 → 빈 표지', extractVoiceMarks(['   ', '']).endings.length, 0)

  const many = extractVoiceMarks(
    Array.from({ length: MAX_RECENT_MARKS + 4 }, (_, i) => `${i}번 문장이에요`),
  )
  expect(`표지는 ${MAX_RECENT_MARKS}개까지만`, many.openers.length <= MAX_RECENT_MARKS, true)

  const withMarks = buildPrompt({
    persona: persona(), post: post(), reactionType: 'empathy',
    recentMarks: marks, reference: refBundle(),
  })
  const sys = withMarks.ok ? withMarks.prompt.systemPrompt : ''
  expect('최근 시작어절이 프롬프트에 실린다', sys.includes('최근에 이렇게 시작했습니다'), true)
  expect('최근 말끝도 실린다', sys.includes('최근에 이렇게 끝냈습니다'), true)
  // 🔴 본문은 절대 실리지 않는다
  expect('🔴 본문은 실리지 않는다', sys.includes('밤마다 뒤척이다 새벽에 깨요'), false)

  const without = buildPrompt({
    persona: persona(), post: post(), reactionType: 'empathy', reference: refBundle(),
  })
  const sysNo = without.ok ? without.prompt.systemPrompt : ''
  expect('표지가 없으면 그 섹션도 없다', sysNo.includes('최근에 이렇게 시작했습니다'), false)
}

console.log('\n══════ ⑫ 🔴 Wave E — 억지 생활 장면 유도 규칙이 사라졌다')
/**
 * 🔴 **이 절은 "있는가" 가 아니라 "없는가" 를 본다.**
 *
 *    옛 fixture 는 정확히 반대를 잠그고 있었다 —
 *    *"예시 4종 전부"* · *"상투적 시작 글자 6종 전부"* · *"120자 권장 유지"*.
 *    그래서 프롬프트가 억지 장면을 시켜도 검사는 초록이었다.
 *    창업자 채점(`20260909-181515`)이 그 결과를 실물로 확인했으므로 방향을 뒤집는다.
 */
{
  const p = buildPrompt({
    persona: persona(), post: post(), reactionType: 'empathy', reference: refBundle(),
  })
  const sys = p.ok ? p.prompt.systemPrompt : ''

  // ── 억지 장면 예시 (실측: 이렇게 여는 실제 댓글 1,566건 중 0건) ──
  for (const ex of ['설거지하다 말고', '창밖 보다가', '커피 식는 줄도 모르고', '손이 시려워서']) {
    expect(`🔴 장면 예시 "${ex}" 가 지시로 남아 있지 않다`,
      sys.includes(`예를 들면 이런 방식입니다`) && sys.includes(ex), false)
  }
  expect('🔴 "첫 문장을 여는 방법" 절이 없다', sys.includes('첫 문장을 여는 방법'), false)
  expect('🔴 "짧은 상황이나 감각" 요구가 없다', sys.includes('짧은 상황이나 감각'), false)
  expect('🔴 "지금 뭘 하다 이 글을 봤는지" 요구가 없다',
    sys.includes('지금 뭘 하다 이 글을 봤는지'), false)
  expect('🔴 "감각이나 상황 한 조각" 요구가 없다', sys.includes('감각이나 상황 한 조각'), false)

  // ── 첫 글자 회피 (실측: 실제 댓글 19.2% 를 막고 있었다) ──
  expect('🔴 첫 글자 회피 지시가 없다', sys.includes('이 글자로 시작하지 않습니다'), false)
  expect('🔴 시작 어절 금지 목록이 없다', sys.includes('이런 말로 시작하지 않습니다'), false)
  expect('🔴 반복 글자 지목이 없다', sys.includes('번 시작했습니다'), false)

  // ── 어미 미세 통제 ──
  expect('🔴 "말끝을 서로 다르게" 강제가 없다', sys.includes('말끝을 서로 다르게'), false)
  expect('🔴 "같은 어미로 두 번" 금지가 없다', sys.includes('같은 어미로 두 번'), false)

  // ── 고정 길이 목표 ──
  expect('🔴 "한두 문장" 강제가 없다', sys.includes('한두 문장'), false)
  expect('🔴 120자 목표가 없다', /120자/.test(sys), false)
  expect('🔴 "길게 쓸수록 사람 말에서 멀어집니다" 가 없다',
    sys.includes('길게 쓸수록'), false)

  // ── 원글 맥락으로 여는 것을 막던 지시 ──
  expect('🔴 "요약해서 여는 것은 안 됩니다" 가 없다',
    sys.includes('요약해서 여는 것은 안 됩니다'), false)
  expect('🟢 대신 원글에 직접 반응하라고 말한다',
    sys.includes('윗글에 직접 반응하면 됩니다'), true)

  // ── 그래도 남아야 하는 안전 규칙 ──
  expect('🟢 원문 유출 금지는 남는다', sys.includes('한 조각도 그대로 쓰지 않습니다'), true)
  expect('🟢 없는 경험 지어내기 금지는 남는다', sys.includes('지어내지 않습니다'), true)
  expect('🟢 억지 생활 장면을 이름 대고 막는다',
    sys.includes('글과 상관없는 생활 장면을 만들어 붙이지 않습니다'), true)
  expect('🟢 진단·처방 금지는 남는다', sys.includes('진단·처방'), true)
  expect('🟢 방법 안내 금지는 남는다', sys.includes('방법을 알려주지 않습니다'), true)
  expect('🟢 판단 금지는 남는다', sys.includes('판단하지 않습니다'), true)
  const missingCliche = CLICHE_COMFORT_PHRASES.filter((w) => !sys.includes(w))
  expect(`🟢 상투적 위로 ${CLICHE_COMFORT_PHRASES.length}종은 남는다 (실측 0~0.70%)`,
    missingCliche.join(','), '')
}

console.log('\n══════ ⑬ 🔴 Wave E — 말투 근거(reference)가 규칙보다 먼저다')
{
  const bundle = refBundle()
  const p = buildPrompt({
    persona: persona(), post: post(), reactionType: 'empathy', reference: bundle,
  })
  const sys = p.ok ? p.prompt.systemPrompt : ''

  // 🔴 근거가 프롬프트에 실제로 실린다
  for (const c of bundle.comments) {
    expect(`참고 댓글이 실린다: "${c.text.slice(0, 12)}…"`, sys.includes(c.text), true)
  }
  expect('🟢 규칙보다 먼저라고 말한다', sys.includes('규칙 목록보다'), true)
  /**
   * 🔴 **자리도 본다.** "먼저" 라고 써 놓고 뒤에 두면 모델은 나중 것을 따른다 —
   *    옛 프롬프트가 정확히 그 실수를 했고 주석에 스스로 적어 두었다.
   */
  expect('🔴 근거가 금지 목록보다 앞에 온다',
    sys.indexOf('말투는 아래 실제 댓글에서') < sys.indexOf('## 절대 하지 않는 것'), true)
  expect('🔴 근거가 말투 설정보다 앞에 온다',
    sys.indexOf('말투는 아래 실제 댓글에서') < sys.indexOf('## 말투 설정'), true)
  expect('🟢 설정과 어긋나면 실제 댓글을 따르라고 한다',
    sys.includes('실제 댓글 쪽**을 따릅니다') || sys.includes('실제 댓글 쪽'), true)
  expect('🔴 통째로 베끼지 말라고 한다', sys.includes('통째로 옮기지는 않습니다'), true)

  // 🔴 길이는 관찰된 분포로 전한다 — 숫자 하나를 목표로 주지 않는다
  expect('🟢 참고 댓글의 길이 분포를 전한다', sys.includes('참고 댓글은 짧게는'), true)
  expect('🟢 맞출 필요 없다고 말한다', sys.includes('맞출 필요는 없습니다'), true)
  expect(`🟢 운영 상한 ${MAX_COMMENT_LENGTH}자는 한계로만 말한다`,
    sys.includes('목표가 아니라 한계입니다'), true)

  // 🔴 근거가 없으면 만들지 않는다 (fail-closed)
  const noRef = buildPrompt({ persona: persona(), post: post(), reactionType: 'empathy' })
  expect('🔴 reference 없이는 프롬프트를 만들지 않는다', noRef.ok, false)
  expect('  REFERENCE_MISSING 으로 막는다',
    !noRef.ok && noRef.blocks.some((b) => b.code === 'REFERENCE_MISSING'), true)
  const opt = buildPrompt({
    persona: persona(), post: post(), reactionType: 'empathy', requireReference: false,
  })
  expect('  명시적으로 끄면 통과한다(단위 시험용)', opt.ok, true)
}

console.log('\n══════ ⑨ 🔴 #9 실패(② 원문 공유)를 겨냥한 지시')
{
  const p = buildPrompt({
    persona: persona(), post: post(), reactionType: 'empathy', reference: refBundle(),
  })
  const sys = p.ok ? p.prompt.systemPrompt : ''
  expect('② 원문 조각 금지가 명시된다', sys.includes('한 조각도 그대로 쓰지 않습니다'), true)
  expect('  살짝 바꿔 옮기기도 금지', sys.includes('말을 살짝 바꿔 옮기는 것도 안 됩니다'), true)
  expect('  증상·상황 요약 금지', sys.includes('되풀이해 요약하지 않습니다'), true)
  expect('방법 안내 금지가 명시된다', sys.includes('방법을 알려주지 않습니다'), true)
  expect('  판단 금지가 명시된다', sys.includes('판단하지 않습니다'), true)
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
