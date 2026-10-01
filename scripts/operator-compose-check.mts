#!/usr/bin/env tsx
/**
 * 운영자 직접 작성 fixture — 🔴 **DB · 세션 · 네트워크 · provider 0**
 *
 * 🔴 **이 파일이 답하는 질문은 하나다.**
 *    *창업자가 직접 쓰는 것이 자동 운영을 건드리는가.*
 *    §⑥ 이 그 답을 **수동 활동 전후의 값을 비교해서** 낸다 — 선언이 아니라 계산이다.
 *
 * 실행: npx tsx scripts/operator-compose-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import {
  assertOperatorCommentData,
  assertOperatorPostData,
  buildOperatorCommentData,
  buildOperatorPostData,
  isOperatorBoard,
  judgeOperatorOwnership,
  judgeOperatorTitle,
  judgeOperatorWriter,
  OPERATOR_BOARDS,
  OPERATOR_COMMENT_CONTEXT_POLICY,
  type OperatorWriterFacts,
} from '../src/lib/operator-writer'
import { judgePostAuthor, type PostAuthorFacts } from '../src/lib/persona-comment-release'
import {
  countManagedPosts,
  judgeBootstrapBudget,
  type ManagedPostFacts,
} from '../src/lib/persona-comment-bootstrap-budget'
import { classifyComment, windowFromRows, judgeRatio } from '../src/lib/persona-comment-governor'
import { planCommentDistribution, type PlannerPersona, type PlannerPost } from '../src/lib/persona-comment-planner'
import { COMMENT_REACTION_ROLES } from '../src/lib/persona-reaction-roles'
import { isRealMember } from '../src/lib/admin-format'
import { displayName } from '../src/lib/display-name'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  materializeTargets, sourceTextsOf,
  type SourcePersona, type SourcePost, type TargetSource,
} from './lib/persona-comment-targets'

let failed = 0
let passed = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}
const throws = (label: string, fn: () => unknown): void => {
  let threw = false
  try { fn() } catch { threw = true }
  expect(label, threw, true)
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ① 작성자 자격 — 모르면 막는다')
// ─────────────────────────────────────────────────────────
{
  const good = (): OperatorWriterFacts => ({
    status: 'active', accountCount: 0, providerId: null, hasPersona: false,
  })
  expect('기준 입력은 통과한다', judgeOperatorWriter(good()).ok, true)
  expect('없는 작성자', judgeOperatorWriter(null), { ok: false, code: 'NOT_FOUND', reason: '그 작성자를 찾을 수 없습니다.' })

  const code = (f: Partial<OperatorWriterFacts>): string => {
    const v = judgeOperatorWriter({ ...good(), ...f })
    return v.ok ? 'OK' : v.code
  }
  expect('retired 는 못 쓴다', code({ status: 'retired' }), 'NOT_ACTIVE')
  expect('상태를 모르면 막는다', code({ status: null }), 'NOT_ACTIVE')
  expect('🔴 로그인 수단이 붙은 계정(실회원)은 막는다', code({ accountCount: 1 }), 'REAL_MEMBER')
  expect('🔴 providerId 가 있으면 막는다', code({ providerId: 'kakao:1' }), 'REAL_MEMBER')
  expect('🔴 Account 수를 못 세면 막는다', code({ accountCount: null }), 'UNKNOWN_ACCOUNT')
  expect('🔴 select 누락(undefined)도 막는다', code({ accountCount: undefined }), 'UNKNOWN_ACCOUNT')
  expect('🔴 NaN 은 조용히 통과하지 않는다', code({ accountCount: Number.NaN }), 'UNKNOWN_ACCOUNT')
  expect('🔴 자동 Persona 가 붙어 있으면 막는다', code({ hasPersona: true }), 'ALSO_PERSONA')
  expect('🔴 Persona 연결 여부를 모르면 막는다', code({ hasPersona: null }), 'UNKNOWN_ACCOUNT')
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ② 저장 직전 값 — 레인이 섞이지 않는다')
// ─────────────────────────────────────────────────────────
{
  const data = buildOperatorPostData({
    boardType: 'FREE', title: '요즘 잠이 안 와요', content: '새벽에 자꾸 깹니다',
    authorId: 'u1', operatorWriterId: 'ow1',
  })
  expect('🔴 personaId 가 아예 없다', 'personaId' in data, false)
  expect('source 는 USER 다 — 사람이 직접 썼다', data.source, 'USER')
  expect('3축은 평범한 커뮤니티 글과 같다',
    [data.isMicroSeed, data.permanentNoindex, data.indexPromotionBlocked], [false, false, false])
  expect('assert 통과', (() => { assertOperatorPostData(data); return true })(), true)

  throws('🔴 personaId 를 끼워 넣으면 저장 직전에 막힌다',
    () => assertOperatorPostData({ ...data, personaId: 'P01' }))
  throws('🔴 출처를 붙이면 막힌다',
    () => assertOperatorPostData({ ...data, sourceUrl: 'https://example.com' }))
  throws('🔴 3축을 덮어쓰면 막힌다',
    () => assertOperatorPostData({ ...data, isMicroSeed: true }))
  throws('🔴 게시판이 아닌 곳은 막힌다',
    () => assertOperatorPostData({ ...data, boardType: 'MAGAZINE' }))
  throws('🔴 작성자가 비면 막힌다',
    () => assertOperatorPostData({ ...data, operatorWriterId: '  ' }))

  const c = buildOperatorCommentData({
    postId: 'p1', content: '저도 그래요', authorId: 'u1', operatorWriterId: 'ow1',
  })
  expect('commentOrigin 은 OPERATOR 다', c.commentOrigin, 'OPERATOR')
  expect('🔴 personaId 가 아예 없다', 'personaId' in c, false)
  expect('🔴 parentId 가 아예 없다 — 답글은 범위 밖이다', 'parentId' in c, false)
  expect('assert 통과', (() => { assertOperatorCommentData(c); return true })(), true)
  throws('🔴 MEMBER 로 적재하려 하면 막힌다',
    () => assertOperatorCommentData({ ...c, commentOrigin: 'MEMBER' }))
  throws('🔴 personaId 를 붙이면 막힌다',
    () => assertOperatorCommentData({ ...c, personaId: 'P01' }))
  throws('🔴 답글을 만들려 하면 막힌다',
    () => assertOperatorCommentData({ ...c, parentId: 'c0' }))
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ③ 게시판 — 매거진·베스트는 게시판이 아니다')
// ─────────────────────────────────────────────────────────
{
  expect('갱년기톡·자유게시판만', [...OPERATOR_BOARDS], ['MENOPAUSE', 'FREE'])
  expect('🔴 매거진은 아니다', isOperatorBoard('MAGAZINE'), false)
  expect('🔴 베스트는 아니다', isOperatorBoard('BEST'), false)
  expect('🔴 빈 값도 아니다', isOperatorBoard(''), false)
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ④ 수정·삭제 권한 — 회원 콘텐츠는 건드리지 않는다')
// ─────────────────────────────────────────────────────────
{
  expect('이 도구의 글은 고칠 수 있다',
    judgeOperatorOwnership({ operatorWriterId: 'ow1', personaId: null }),
    { ok: true, operatorWriterId: 'ow1' })
  expect('🔴 회원 글은 막힌다',
    judgeOperatorOwnership({ operatorWriterId: null, personaId: null }).ok, false)
  expect('🔴 자동 Persona 글은 막힌다',
    judgeOperatorOwnership({ operatorWriterId: null, personaId: 'P01' }).ok, false)
  expect('🔴 두 축이 섞인 행도 막힌다',
    judgeOperatorOwnership({ operatorWriterId: 'ow1', personaId: 'P01' }).ok, false)
  expect('🔴 select 누락이면 막힌다',
    judgeOperatorOwnership({ operatorWriterId: undefined }).ok, false)
  expect('🔴 없는 대상은 막힌다', judgeOperatorOwnership(null).ok, false)
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ⑤ 작성자 유형 — operator 는 member 도 persona 도 아니다')
// ─────────────────────────────────────────────────────────
{
  const vis = {
    status: 'PUBLISHED' as const, isMicroSeed: false,
    permanentNoindex: false, indexPromotionBlocked: false,
  }
  const facts = (o: Partial<PostAuthorFacts>): PostAuthorFacts => ({
    authorPersonaCode: null, authorOperatorWriterId: null, source: 'USER',
    authorRealMember: { accountCount: 0, providerId: null },
    authorIsAdmin: false, visibility: vis, ...o,
  })
  expect('운영 직접 글은 operator 다',
    judgePostAuthor(facts({ authorOperatorWriterId: 'ow1' })).kind, 'operator')
  expect('🔴 본문을 외부 모델로 보내지 않는다 — 말투 학습에 섞이지 않는다',
    judgePostAuthor(facts({ authorOperatorWriterId: 'ow1' })).externalSendAllowed, false)
  expect('🔴 두 축이 섞이면 안전한 쪽(operator)으로 읽는다',
    judgePostAuthor(facts({ authorOperatorWriterId: 'ow1', authorPersonaCode: 'P01' })).kind, 'operator')
  expect('🔴 select 누락이면 unknown 이다',
    judgePostAuthor(facts({ authorOperatorWriterId: undefined as unknown as null })).kind, 'unknown')
  expect('회원 글은 그대로 member 다',
    judgePostAuthor(facts({ authorRealMember: { accountCount: 1, providerId: null } })).kind, 'member')
  expect('Persona 글은 그대로 persona 다',
    judgePostAuthor(facts({ authorPersonaCode: 'P01' })).kind, 'persona')
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ⑥ 🔴 회귀 — 수동 작성 전후 자동 여력과 배정이 그대로다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **"영향 없음" 을 선언하지 않는다. 같은 입력으로 두 번 계산해 값을 비교한다.**
   *    before = 자동 레인의 글만 있는 하루
   *    after  = 거기에 **창업자가 직접 쓴 글 3편**이 더해진 하루
   *    두 결과가 완전히 같아야 한다.
   */
  const personaPost = (): ManagedPostFacts => ({
    authorKind: 'persona', externalSourced: false, personaCommentCount: 0,
  })
  const operatorPost = (): ManagedPostFacts => ({
    authorKind: 'operator', externalSourced: false, personaCommentCount: 0,
  })

  const before = countManagedPosts([personaPost(), personaPost()])
  const after = countManagedPosts([
    personaPost(), operatorPost(), personaPost(), operatorPost(), operatorPost(),
  ])

  expect('열린 댓글 자리 수가 같다', after.openSlots, before.openSlots)
  expect('대상 글 수가 같다', after.eligible, before.eligible)
  expect('🔴 빠진 이유가 조용하지 않다', after.excluded['운영자 직접 글'], 3)

  const budgetBefore = judgeBootstrapBudget({
    openSlots: before.openSlots, publishedToday: 0, killSwitchOff: true,
  })
  const budgetAfter = judgeBootstrapBudget({
    openSlots: after.openSlots, publishedToday: 0, killSwitchOff: true,
  })
  expect('오늘 남은 발행 여력이 같다', budgetAfter.remaining, budgetBefore.remaining)
  expect('총 상한도 같다', budgetAfter.cap, budgetBefore.cap)
  expect('🔴 여력이 0 이 아니다 — "둘 다 0" 으로 같아진 것이 아니다', budgetBefore.remaining > 0, true)

  /**
   * 🔴 **후보 배정도 같아야 한다.** 예산이 같아도 planner 가 운영 글을 대상에 넣으면
   *    그날 누가 어디에 붙을지가 달라진다 — 그것도 "자동 운영을 건드린 것" 이다.
   */
  const NOW = Date.parse('2026-09-17T12:00:00+09:00')
  const post = (id: string, o: Partial<PlannerPost> = {}): PlannerPost => ({
    id, status: 'PUBLISHED', authorPersonaCode: 'P09', memberComments: 0, personaComments: 0,
    personaCodesOnPost: [], openQueuePersonaCodes: [], publishedAtMs: NOW - 3_600_000,
    onHold: false, operatorWritten: false,
    title: '요즘 잠이 잘 안 와요', body: '새벽에 자꾸 깹니다', ...o,
  })
  const persona = (code: string): PlannerPersona => ({
    code, status: 'active', realMember: { accountCount: 0, providerId: null },
    seedComplete: true, forbiddenReactionRoles: [], recentComments: 0, recentRoles: { roleCounts: {}, unresolvedRoleEvents: 0 },
    life: { noGoTopics: [] },
  })
  const personas = [persona('P01'), persona('P02')]
  const planArgs = {
    personas, reactionRoles: COMMENT_REACTION_ROLES, limit: 10, nowMs: NOW,
    recentRoleCounts: {},
  }

  const planBefore = planCommentDistribution({
    ...planArgs, posts: [post('a'), post('b')],
  })
  const planAfter = planCommentDistribution({
    ...planArgs,
    posts: [post('a'), post('op1', { operatorWritten: true }), post('b'), post('op2', { operatorWritten: true })],
  })
  const shape = (p: typeof planBefore): string =>
    JSON.stringify(p.items.map((i) => [i.postId, i.personaCode, i.reactionRole]))

  expect('🔴 배정 결과가 글자 하나까지 같다', shape(planAfter), shape(planBefore))
  expect('🔴 배정이 0건이라 같아진 것이 아니다', planBefore.items.length > 0, true)
  expect('운영 글은 한 건도 배정되지 않았다',
    planAfter.items.some((i) => i.postId.startsWith('op')), false)

  /**
   * 🔴 **30% 비율도 움직이지 않는다.** 운영 댓글이 실사용자 댓글로 세어지면
   *    분모가 부풀어 자동 댓글 상한이 **근거 없이 열린다** — 반대 방향의 오염이다.
   */
  const rows = [
    { commentOrigin: 'MEMBER', personaId: null },
    { commentOrigin: 'PERSONA', personaId: 'P01' },
  ]
  const opRows = [...rows, { commentOrigin: 'OPERATOR', personaId: null }]
  expect('운영 댓글은 어느 분자도 아니다',
    classifyComment({ commentOrigin: 'OPERATOR', personaId: null }), 'other')
  expect('창이 그대로다', windowFromRows(opRows, 7), windowFromRows(rows, 7))
  expect('🔴 자동 댓글 여유가 그대로다',
    judgeRatio(windowFromRows(opRows, 7)).headroom, judgeRatio(windowFromRows(rows, 7)).headroom)
  expect('🔴 OPERATOR 에 personaId 가 붙으면 모순으로 잡힌다',
    classifyComment({ commentOrigin: 'OPERATOR', personaId: 'P01' }), 'contradiction')
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ⑦ 🔴 대화 맥락은 참고하되, 말투·경험 자산에는 넣지 않는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **계약이 바뀐 자리다** (2026-09-17 · 창업자 결정).
   *
   *    옛 계약: 운영 댓글을 프롬프트에서 통째로 뺀다.
   *    새 계약: **그 글의 대화 맥락으로는 참고**하되, **Persona 의 자산으로는 삼지 않는다.**
   *
   *    창업자가 남긴 말만 빼 놓으면 모델이 그 말을 못 본 채 같은 말을 다시 하거나
   *    대화를 끊는다. 그래서 맥락은 연다. 대신 경계가 어디인지 값으로 못박는다.
   *
   * 🔴 **자산 경로는 `personaId` 관계 하나다.** 운영 댓글은 그 값이 null 이라
   *    구조적으로 못 들어간다 — 막는 필터가 아니라 표의 모양이 답한다.
   *    이 절은 그 사실을 **실제 materializer 산출물**로 확인한다.
   */
  expect('경계가 계약 문장으로 남아 있다', OPERATOR_COMMENT_CONTEXT_POLICY.length > 0, true)

  const NOW = Date.parse('2026-09-17T00:00:00Z')
  const DAY = 86_400_000
  const OPERATOR_TEXT = '창업자가직접쓴댓글입니다맥락으로는보이고자산은아닙니다'
  const MEMBER_TEXT = '저도 어제 걸었어요 좋더라고요'

  const post = (comments: SourcePost['comments']): SourcePost => ({
    id: 'p1', source: 'SYSTEM', title: '동네 산책',
    content: '오늘 동네를 한 바퀴 걸었어요. 바람이 선선했어요.',
    boardType: '수다방', publishAtMs: NOW - DAY, category: null, sourceSite: null,
    // 🔴 **자동 Persona 가 쓴 글**이다 — 정상적인 자동 댓글 대상이다
    authorPersonaCode: 'P02', authorOperatorWriterId: null, author: null,
    visibility: {
      status: 'PUBLISHED', isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false,
    },
    comments,
  })

  /** 🔴 이 Persona 의 발화는 **자기 personaId 로 달린 것**뿐이다 (DB source 와 같은 모양) */
  const persona: SourcePersona = {
    code: 'P01', status: 'active',
    identity: { job: '강사', maritalStatus: '기혼' },
    voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
    voiceVariations: ['질문형'],
    ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
    user: { providerId: null, accountCount: 0 },
    recentRoles: { roleCounts: {}, unresolvedRoleEvents: 0 },
    comments: [
      '저도 그런 날이 있었어요', '무릎이 시큰해서 병원에 갔어요', '햇살이 좋더라고요',
      '같이 걸으면 더 좋아요', '오늘은 좀 쉬려고요',
    ].map((content, i) => ({ content, createdAtMs: NOW - (i + 1) * 3_600_000 })),
  }

  const sourceFor = (comments: SourcePost['comments']): TargetSource => ({
    posts: async () => [post(comments)],
    personas: async () => [persona],
    openDedupKeys: async () => [],
    recentRoleCounts: async () => ({}),
    knownNames: async () => ['홍길동'],
    frequency: async () => ({
      corpus: { lookup: () => 0, size: 1_000, corpusName: 'comment' }, reason: '시험 코퍼스',
    }),
    seedUseCount: async () => 3,
  })

  const memberOnly = [{ origin: 'MEMBER', content: MEMBER_TEXT, personaCode: null }]
  const withOperator = [
    ...memberOnly,
    // 🔴 운영 댓글은 personaCode 가 null 이다 — 자산 관계에 들어갈 수 없는 모양
    { origin: 'OPERATOR', content: OPERATOR_TEXT, personaCode: null },
  ]

  const before = await materializeTargets({
    source: sourceFor(memberOnly), limit: 5, nowMs: NOW, windowMs: 7 * DAY,
  })
  const after = await materializeTargets({
    source: sourceFor(withOperator), limit: 5, nowMs: NOW, windowMs: 7 * DAY,
  })

  expect('🔴 대상이 실제로 만들어졌다 — 0건이라 같아진 것이 아니다', before.targets.length > 0, true)

  // ── ㉮ 맥락으로는 보인다 ──────────────────────────────
  const digestsOf = (m: typeof after): string[] =>
    m.targets.flatMap((t) => [...t.target.input.post.existingCommentDigests])
  expect('🟢 운영 댓글이 그 글의 대화 맥락으로 실린다', digestsOf(after).some((d) => d.includes(OPERATOR_TEXT)), true)
  expect('회원 댓글도 그대로 실린다', digestsOf(after).some((d) => d.includes(MEMBER_TEXT)), true)
  expect('🔴 옛 계약과 달라진 것이 맞다 — 입력이 실제로 바뀐다',
    JSON.stringify(digestsOf(after)) !== JSON.stringify(digestsOf(before)), true)

  // ── ㉯ 보호 기준은 그대로다 ───────────────────────────
  const LONG = '가'.repeat(500)
  const longOp = await materializeTargets({
    source: sourceFor([...memberOnly, { origin: 'OPERATOR', content: LONG, personaCode: null }]),
    limit: 5, nowMs: NOW, windowMs: 7 * DAY, commentDigestChars: 60,
  })
  const longMember = await materializeTargets({
    source: sourceFor([{ origin: 'MEMBER', content: LONG, personaCode: null }]),
    limit: 5, nowMs: NOW, windowMs: 7 * DAY, commentDigestChars: 60,
  })
  const maxLen = (m: typeof after): number =>
    Math.max(0, ...digestsOf(m).map((d) => d.length))
  expect('🔴 발췌 길이 기준이 회원 댓글과 같다 (전문이 아니라 발췌다)', maxLen(longOp), 60)
  expect('🔴 회원 댓글과 정확히 같은 상한이다', maxLen(longOp), maxLen(longMember))
  expect('🔴 ① 유출 대조에도 함께 걸린다 — 베끼면 잡힌다',
    after.targets.every((t) => sourceTextsOf(t.target.input).some((x) => x.includes(OPERATOR_TEXT))), true)

  // ── ㉰ 🔴 자산에는 들어가지 않는다 (이 절의 핵심) ──────
  const assetTexts = (m: typeof after): string =>
    JSON.stringify(m.targets.map((t) => ({
      recent: t.recentTexts,        // voice 근거 — 말투
      prior: t.gate.priorTexts,     // ⑧ 표본 — 이전 발화
      voice: t.target.input.voice,  // 말투 근거 조립본
    })))
  expect('🔴 말투 근거(voice)에 운영 문장이 없다', assetTexts(after).includes(OPERATOR_TEXT), false)
  expect('🔴 ⑧ 이전 발화 표본에도 없다',
    after.targets.every((t) => !t.gate.priorTexts.some((x) => x.includes(OPERATOR_TEXT))), true)
  expect('🔴 자산 조각이 운영 댓글 전후로 완전히 같다', assetTexts(after), assetTexts(before))
  expect('🔴 Persona 자기 발화는 personaId 관계에서만 온다 (수가 그대로다)',
    after.targets.every((t) => t.recentTexts.length === persona.comments.length), true)

  // ── ㉱ 자동 상한·배정·사용량은 그대로다 ────────────────
  expect('대상 수가 같다 — 배정이 바뀌지 않았다', after.targets.length, before.targets.length)
  expect('배정 조합이 글자 하나까지 같다',
    JSON.stringify(after.plan.items.map((i) => [i.postId, i.personaCode, i.reactionRole])),
    JSON.stringify(before.plan.items.map((i) => [i.postId, i.personaCode, i.reactionRole])))
  expect('🔴 운영 댓글이 "그 글의 Persona 댓글 수" 로 세어지지 않는다',
    after.targets.every((t) => t.target.facts.personaCommentsOnPost === 0), true)
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ⑧ 공개 표시 — 닉네임만 보이고 내부 축은 새지 않는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **고객에게 보이는 이름은 닉네임 하나다.**
   *    내부 코드(OP01) · 운영 작성자 관계 · 실제 조작자(관리자) 는 나가지 않는다.
   *    이번 범위에서 운영자 배지도 붙이지 않는다 — 공개 표시 정책은 기존 정본을 따른다.
   *
   * 🔴 **주석으로 약속하지 않고 파일을 읽어 확인한다.** 고객 경로가 운영 축을
   *    한 글자라도 참조하면 그때부터 노출은 한 줄 거리다 — 그 한 줄을 여기서 막는다.
   */
  expect('공개 이름은 nickname 이다', displayName({ nickname: '봄날의정원', name: '카카오이름' }), '봄날의정원')
  expect('nickname 이 없으면 name 으로 떨어진다', displayName({ nickname: null, name: '카카오이름' }), '카카오이름')

  const CUSTOMER_PATHS = [
    'src/lib/queries/posts.ts',
    'src/lib/queries/my.ts',
    'src/components/features/CommentItem.tsx',
    'src/app/community/[boardSlug]/[postId]/page.tsx',
    'src/app/community/[boardSlug]/page.tsx',
    'src/app/page.tsx',
    'src/app/best/page.tsx',
  ]
  const here = dirname(fileURLToPath(import.meta.url))
  const offenders: string[] = []
  for (const rel of CUSTOMER_PATHS) {
    let body = ''
    try { body = readFileSync(join(here, '..', rel), 'utf-8') } catch { offenders.push(`${rel} (읽지 못했다)`); continue }
    // 🔴 운영 축 · 내부 코드 · 관리자 플래그 어느 것도 고객 경로에 없어야 한다
    if (/operatorWriter|OperatorWriter|OperatorWriteLog/.test(body)) offenders.push(`${rel}: 운영 작성자 축`)
    if (/\bisAdmin\b/.test(body)) offenders.push(`${rel}: isAdmin`)
  }
  expect('🔴 고객 경로가 운영 축·관리자 플래그를 읽지 않는다', offenders, [])

  /** 🔴 공개 프로필 화면이 없다 — 있으면 거기서 또 새기 때문에 존재 자체를 확인한다 */
  expect('공개 프로필 경로를 만들지 않았다',
    existsSync(join(here, '..', 'src/app/users')) || existsSync(join(here, '..', 'src/app/profile')), false)
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ⑨ North Star — 운영 작성자는 실회원이 아니다')
// ─────────────────────────────────────────────────────────
{
  expect('카카오로 들어온 사람은 실회원이다',
    isRealMember({ accounts: [{ id: 'a' }], persona: null, operatorWriter: null }), true)
  expect('🔴 운영용 작성자는 실회원이 아니다',
    isRealMember({ accounts: [{ id: 'a' }], persona: null, operatorWriter: { id: 'ow1' } }), false)
  expect('🔴 자동 Persona 도 실회원이 아니다',
    isRealMember({ accounts: [{ id: 'a' }], persona: { id: 'p' }, operatorWriter: null }), false)
}

// ─────────────────────────────────────────────────────────
console.log('\n══════ ⑩ 입력 규칙 — 회원 글쓰기와 같은 상수를 쓴다')
// ─────────────────────────────────────────────────────────
{
  expect('한 글자 제목은 막힌다', judgeOperatorTitle('아') !== null, true)
  expect('두 글자면 통과', judgeOperatorTitle('안녕'), null)
  expect('앞뒤 공백은 세지 않는다', judgeOperatorTitle('  안녕  '), null)
  expect('너무 긴 제목은 막힌다', judgeOperatorTitle('가'.repeat(200)) !== null, true)
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failed === 0 ? '✅' : '🔴'} ${passed} pass · ${failed} fail`)
if (failed > 0) process.exit(1)
