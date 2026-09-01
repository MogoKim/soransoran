#!/usr/bin/env tsx
/**
 * 발행 대상 글 지정 규칙 fixture — 🔴 DB · 세션 · 네트워크 없음
 *
 * 🔴 목록과 저장이 같은 함수(judgeTargetPost)를 쓰는지까지 확인한다.
 *    둘이 갈리면 "고를 수 있게 보여 놓고 저장에서 막는" 화면이 된다.
 *
 * 실행: npx tsx scripts/persona-target-rules-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import {
  canSetTarget, judgeTargetPost, planSetTarget, planClearTarget,
  MEMBER_COMMENT_LIMIT,
  type TargetBlockCode, type TargetPostFacts, type SetTargetInput,
} from '../src/lib/persona-target-rules'
import type { CandidateStatus } from '../src/lib/persona-candidate-rules'

let failed = 0
let passed = 0
const expect = (label: string, actual: unknown, want: unknown): void => {
  const ok = actual === want
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(actual)}`)
}

const ALL: CandidateStatus[] = ['PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED']
const SETTABLE = new Set<CandidateStatus>(['PENDING', 'APPROVED'])

const goodPost = (): TargetPostFacts => ({
  status: 'PUBLISHED',
  personaComments: 0,
  memberComments: 0,
})

const base = (): SetTargetInput => ({
  candidate: { status: 'APPROVED', publishedCommentId: null },
  postId: 'post_1',
  post: goodPost(),
})

const codes = (input: SetTargetInput): TargetBlockCode[] => {
  const p = planSetTarget(input)
  return p.ok ? [] : p.blocks.map((b) => b.code)
}
const has = (input: SetTargetInput, code: TargetBlockCode): boolean => codes(input).includes(code)

console.log('\n══════ ① 기준 입력은 통과한다')
{
  const p = planSetTarget(base())
  expect('ok', p.ok, true)
  expect('  postId 가 그대로 나온다', p.ok ? p.postId : null, 'post_1')
}

console.log('\n══════ ② PENDING · APPROVED 만 지정 가능 (전수)')
{
  const offenders: string[] = []
  for (const st of ALL) {
    const want = SETTABLE.has(st)
    if (canSetTarget(st) !== want) offenders.push(`canSetTarget(${st})=${canSetTarget(st)}`)
    const input = base()
    input.candidate.status = st
    const blocked = has(input, 'CANDIDATE_STATUS')
    if (want && blocked) offenders.push(`${st} 이 막혔다`)
    if (!want && !blocked) offenders.push(`🔴 ${st} 가 통과했다`)
  }
  expect(`${ALL.length}개 상태 전수 — PUBLISHED·DECLINED·EXPIRED·EDITED 차단`, offenders.join(' / '), '')
}

console.log('\n══════ ③ 발행된 뒤에는 바꾸지 못한다')
{
  const input = base()
  input.candidate.publishedCommentId = 'cmt_x'
  expect('ALREADY_PUBLISHED', has(input, 'ALREADY_PUBLISHED'), true)

  const clear = planClearTarget({ status: 'APPROVED', publishedCommentId: 'cmt_x' })
  expect('해제도 막힌다', clear.ok ? '' : clear.blocks[0]?.code, 'ALREADY_PUBLISHED')
}

console.log('\n══════ ④ 글을 고르지 않으면 지정되지 않는다')
{
  const a = base(); a.postId = ''; a.post = null
  expect('빈 값 → POST_ID_EMPTY', has(a, 'POST_ID_EMPTY'), true)

  const b = base(); b.postId = '   '; b.post = null
  expect('공백 → POST_ID_EMPTY', has(b, 'POST_ID_EMPTY'), true)

  // 🔴 글을 고르지 않았으면 글 쪽 사유를 덧붙이지 않는다 — 사유가 두 개면 헷갈린다
  expect('  글 쪽 사유는 붙지 않는다', has(a, 'POST_NOT_FOUND'), false)

  const c = base(); c.post = null
  expect('id 는 있는데 글 없음 → POST_NOT_FOUND', has(c, 'POST_NOT_FOUND'), true)
}

console.log('\n══════ ⑤ 공개 글만 대상이다')
{
  for (const st of ['HIDDEN', 'DELETED']) {
    const input = base()
    input.post = { ...goodPost(), status: st }
    expect(`${st} → POST_NOT_PUBLISHED`, has(input, 'POST_NOT_PUBLISHED'), true)
  }
  expect('PUBLISHED → 통과', has(base(), 'POST_NOT_PUBLISHED'), false)
}

console.log('\n══════ ⑥ 같은 글에 페르소나 1명 (§8)')
{
  const one = base()
  one.post = { ...goodPost(), personaComments: 1 }
  expect('페르소나 1건 → POST_HAS_PERSONA_COMMENT', has(one, 'POST_HAS_PERSONA_COMMENT'), true)
  expect('0건 → 통과', has(base(), 'POST_HAS_PERSONA_COMMENT'), false)
}

console.log('\n══════ ⑦ 회원 댓글 3건 이상이면 개입하지 않는다 (§8)')
{
  expect('상한 상수', MEMBER_COMMENT_LIMIT, 3)

  const two = base()
  two.post = { ...goodPost(), memberComments: 2 }
  expect('2건 → 통과', has(two, 'POST_MEMBER_COMMENTS_FULL'), false)

  const three = base()
  three.post = { ...goodPost(), memberComments: 3 }
  expect('3건 → BLOCK (경계값)', has(three, 'POST_MEMBER_COMMENTS_FULL'), true)

  const many = base()
  many.post = { ...goodPost(), memberComments: 9 }
  expect('9건 → BLOCK', has(many, 'POST_MEMBER_COMMENTS_FULL'), true)
}

console.log('\n══════ ⑧ 목록 판정과 저장 판정이 같은 함수다')
{
  const cases: TargetPostFacts[] = [
    goodPost(),
    { status: 'HIDDEN', personaComments: 0, memberComments: 0 },
    { status: 'PUBLISHED', personaComments: 1, memberComments: 0 },
    { status: 'PUBLISHED', personaComments: 0, memberComments: 3 },
    { status: 'PUBLISHED', personaComments: 2, memberComments: 5 },
  ]
  const offenders: string[] = []
  for (const facts of cases) {
    const listVerdict = judgeTargetPost(facts)
    const input = base()
    input.post = facts
    const saveOk = planSetTarget(input).ok
    if (listVerdict.eligible !== saveOk) {
      offenders.push(`${JSON.stringify(facts)} 목록=${listVerdict.eligible} 저장=${saveOk}`)
    }
  }
  expect(`${cases.length}개 케이스에서 목록 == 저장`, offenders.join(' / '), '')
}

console.log('\n══════ ⑨ 사유를 하나만 내고 멈추지 않는다')
{
  const input = base()
  input.candidate.status = 'DECLINED'
  input.candidate.publishedCommentId = 'cmt_x'
  input.post = { status: 'HIDDEN', personaComments: 2, memberComments: 4 }
  const c = codes(input)
  expect(
    '5개 사유를 한 번에 보고',
    [...c].sort().join(','),
    'ALREADY_PUBLISHED,CANDIDATE_STATUS,POST_HAS_PERSONA_COMMENT,POST_MEMBER_COMMENTS_FULL,POST_NOT_PUBLISHED',
  )
}

console.log('\n══════ ⑩ 해제')
{
  const a = planClearTarget({ status: 'PENDING', publishedCommentId: null })
  expect('PENDING → ok', a.ok, true)
  const b = planClearTarget({ status: 'APPROVED', publishedCommentId: null })
  expect('APPROVED → ok', b.ok, true)
  const c = planClearTarget({ status: 'EXPIRED', publishedCommentId: null })
  expect('EXPIRED → CANDIDATE_STATUS', c.ok ? '' : c.blocks[0]?.code, 'CANDIDATE_STATUS')
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)
