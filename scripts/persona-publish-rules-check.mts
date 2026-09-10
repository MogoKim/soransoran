#!/usr/bin/env tsx
/**
 * 페르소나 발행 규칙 fixture — 🔴 DB · 세션 · 네트워크 없음
 *
 * 🔴 규칙을 server action 안에 두면 DB 없이는 검증할 수 없다.
 *    순수 함수로 빼 두었기 때문에 전이표와 게이트를 전수로 확인할 수 있다.
 *
 * 실행: npx tsx scripts/persona-publish-rules-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import {
  planPublish, planTakedown, canPublish, resolveContent,
  type PublishInput, type PublishBlockCode,
} from '../src/lib/persona-publish-rules'
import {
  planCap, requireCapContext, kstDayStart, weekWindowStart, CapContextNotMeasuredError,
} from '../src/lib/persona-cap'
import { PERSONA_COMMENTS_PER_POST_MAX } from '../src/lib/persona-target-rules'
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

/** 전부 통과하는 기준 입력. 각 테스트가 필요한 곳만 덮어쓴다 */
const base = (): PublishInput => ({
  candidate: {
    status: 'APPROVED',
    targetPostId: 'post_1',
    publishedCommentId: null,
    candidateText: '저도 그맘때 딱 그랬어요. 지나고 보니 별거 아니더라고요.',
    editedText: null,
  },
  persona: { status: 'active', dailyCap: 2, weeklyCap: 5 },
  killSwitchEnabled: false,
  cap: { usedToday: 0, usedWeek: 0 },
  targetPost: { status: 'PUBLISHED' },
  personaCommentsOnPost: 0,
})

const codes = (input: PublishInput): PublishBlockCode[] => {
  const p = planPublish(input)
  return p.ok ? [] : p.blocks.map((b) => b.code)
}
const has = (input: PublishInput, code: PublishBlockCode): boolean => codes(input).includes(code)

console.log('\n══════ ① 기준 입력은 통과한다')
{
  const p = planPublish(base())
  expect('ok', p.ok, true)
  expect('  본문이 후보 본문이다', p.ok ? p.content : null, base().candidate.candidateText)
}

console.log('\n══════ ② APPROVED 만 발행 가능 (전수)')
{
  const offenders: string[] = []
  for (const st of ALL) {
    const want = st === 'APPROVED'
    if (canPublish(st) !== want) offenders.push(`canPublish(${st})=${canPublish(st)}`)
    const input = base()
    input.candidate.status = st
    const blocked = has(input, 'STATUS_NOT_APPROVED')
    if (want && blocked) offenders.push(`${st} 이 막혔다`)
    if (!want && !blocked) offenders.push(`🔴 ${st} 가 통과했다`)
  }
  expect(`${ALL.length}개 상태 전수`, offenders.join(' / '), '')
}

console.log('\n══════ ③ 이미 발행된 것은 다시 발행하지 않는다')
{
  const input = base()
  input.candidate.publishedCommentId = 'cmt_already'
  expect('ALREADY_PUBLISHED', has(input, 'ALREADY_PUBLISHED'), true)
}

console.log('\n══════ ④ targetPostId 가 없으면 발행 금지')
{
  const a = base(); a.candidate.targetPostId = null; a.targetPost = null
  expect('null → TARGET_POST_MISSING', has(a, 'TARGET_POST_MISSING'), true)

  const b = base(); b.candidate.targetPostId = '   '; b.targetPost = null
  expect('공백 → TARGET_POST_MISSING', has(b, 'TARGET_POST_MISSING'), true)

  const c = base(); c.targetPost = null
  expect('글 없음 → TARGET_POST_NOT_FOUND', has(c, 'TARGET_POST_NOT_FOUND'), true)

  const d = base(); d.targetPost = { status: 'HIDDEN' }
  expect('숨김 → TARGET_POST_NOT_PUBLISHED', has(d, 'TARGET_POST_NOT_PUBLISHED'), true)

  const e = base(); e.targetPost = { status: 'DELETED' }
  expect('삭제 → TARGET_POST_NOT_PUBLISHED', has(e, 'TARGET_POST_NOT_PUBLISHED'), true)
}

console.log('\n══════ ⑤ active 페르소나만 발행 (전수)')
{
  const offenders: string[] = []
  for (const st of ['draft', 'active', 'paused', 'retired']) {
    const input = base()
    input.persona.status = st
    const blocked = has(input, 'PERSONA_NOT_ACTIVE')
    if (st === 'active' && blocked) offenders.push('active 가 막혔다')
    if (st !== 'active' && !blocked) offenders.push(`🔴 ${st} 가 통과했다`)
  }
  expect('draft · paused · retired 차단 · active 만 통과', offenders.join(' / '), '')
}

console.log('\n══════ ⑥ kill switch')
{
  const on = base(); on.killSwitchEnabled = true
  expect('enabled=true → KILL_SWITCH_ON', has(on, 'KILL_SWITCH_ON'), true)
  expect('enabled=false → 통과', has(base(), 'KILL_SWITCH_ON'), false)
}

console.log('\n══════ ⑦ cap — 🔴 NULL 은 무제한이 아니라 발행 금지')
{
  const d = base(); d.persona.dailyCap = null
  expect('dailyCap null → DAILY_CAP_UNSET', has(d, 'DAILY_CAP_UNSET'), true)

  const w = base(); w.persona.weeklyCap = null
  expect('weeklyCap null → WEEKLY_CAP_UNSET', has(w, 'WEEKLY_CAP_UNSET'), true)

  const both = base(); both.persona.dailyCap = null; both.persona.weeklyCap = null
  expect('둘 다 null → 사유 2건', codes(both).filter((c) => c.endsWith('_UNSET')).length, 2)

  const de = base(); de.cap = { usedToday: 2, usedWeek: 2 }
  expect('오늘 2/2 → DAILY_CAP_EXCEEDED', has(de, 'DAILY_CAP_EXCEEDED'), true)

  const we = base(); we.cap = { usedToday: 0, usedWeek: 5 }
  expect('주 5/5 → WEEKLY_CAP_EXCEEDED', has(we, 'WEEKLY_CAP_EXCEEDED'), true)

  const edge = base(); edge.cap = { usedToday: 1, usedWeek: 4 }
  expect('오늘 1/2 · 주 4/5 → 통과', planPublish(edge).ok, true)

  // 🔴 cap 0 이면 1건도 나가지 않아야 한다 (used >= cap 으로 쓰면 새어 나간다)
  const zero = base(); zero.persona.dailyCap = 0; zero.cap = { usedToday: 0, usedWeek: 0 }
  expect('dailyCap 0 → 1건도 불가', has(zero, 'DAILY_CAP_EXCEEDED'), true)
}

console.log('\n══════ ⑧ 한 글에 페르소나 댓글 1~5건 (2026-09-11 계약 교체)')
{
  // 🔴 경계값만 본다. 같은 **사람**이 두 번 다는 것은 댓글 레인 재검사가 막는다
  const four = base(); four.personaCommentsOnPost = PERSONA_COMMENTS_PER_POST_MAX - 1
  expect('4건 → 통과(자리 1개 남음)', has(four, 'PERSONA_POST_SLOTS_FULL'), false)
  const five = base(); five.personaCommentsOnPost = PERSONA_COMMENTS_PER_POST_MAX
  expect('5건 → PERSONA_POST_SLOTS_FULL', has(five, 'PERSONA_POST_SLOTS_FULL'), true)
  const one = base(); one.personaCommentsOnPost = 1
  expect('🔴 1건은 더 이상 막지 않는다(옛 계약 폐기)', has(one, 'PERSONA_POST_SLOTS_FULL'), false)
  expect('0건 → 통과', has(base(), 'PERSONA_POST_SLOTS_FULL'), false)
}

console.log('\n══════ ⑨ 본문 길이 — 회원 댓글과 같은 정책')
{
  const empty = base(); empty.candidate.candidateText = '   '
  expect('공백 → BODY_EMPTY', has(empty, 'BODY_EMPTY'), true)

  const two = base(); two.candidate.candidateText = '맞아'
  expect('2자 → 통과 (MIN 2)', has(two, 'BODY_TOO_SHORT'), false)

  const one = base(); one.candidate.candidateText = '음'
  expect('1자 → BODY_TOO_SHORT', has(one, 'BODY_TOO_SHORT'), true)

  const long = base(); long.candidate.candidateText = '가'.repeat(501)
  expect('501자 → BODY_TOO_LONG', has(long, 'BODY_TOO_LONG'), true)

  const max = base(); max.candidate.candidateText = '가'.repeat(500)
  expect('500자 → 통과', has(max, 'BODY_TOO_LONG'), false)
}

console.log('\n══════ ⑩ 수정본이 있으면 그것을 쓴다')
{
  expect(
    'editedText 우선',
    resolveContent({ candidateText: '원본', editedText: '수정본' }),
    '수정본',
  )
  expect(
    'editedText 공백이면 원본',
    resolveContent({ candidateText: '원본', editedText: '   ' }),
    '원본',
  )
}

console.log('\n══════ ⑪ 사유를 하나만 내고 멈추지 않는다')
{
  const input = base()
  input.candidate.status = 'PENDING'
  input.candidate.targetPostId = null
  input.targetPost = null
  input.persona.status = 'draft'
  input.killSwitchEnabled = true
  input.persona.dailyCap = null
  const c = codes(input)
  expect(
    '5개 사유를 한 번에 보고',
    [...c].sort().join(','),
    'DAILY_CAP_UNSET,KILL_SWITCH_ON,PERSONA_NOT_ACTIVE,STATUS_NOT_APPROVED,TARGET_POST_MISSING',
  )
}

console.log('\n══════ ⑫ requireCapContext — 🔴 보정하지 않고 throw')
{
  const throws = (v: unknown): boolean => {
    try { requireCapContext(v); return false } catch (e) { return e instanceof CapContextNotMeasuredError }
  }
  expect('null → throw', throws(null), true)
  expect('빈 객체 → throw', throws({}), true)
  expect('usedToday 음수 → throw', throws({ usedToday: -1, usedWeek: 0 }), true)
  expect('usedWeek 소수 → throw', throws({ usedToday: 0, usedWeek: 1.5 }), true)
  expect('정상값 → 통과', requireCapContext({ usedToday: 1, usedWeek: 2 }).usedToday, 1)
}

console.log('\n══════ ⑬ KST 날짜 경계')
{
  // 2026-09-01 00:30 KST = 2026-08-31 15:30 UTC → 하루 시작은 2026-08-31T15:00:00Z
  const a = kstDayStart(new Date('2026-08-31T15:30:00.000Z'))
  expect('00:30 KST → 그날 시작', a.toISOString(), '2026-08-31T15:00:00.000Z')

  // 2026-08-31 23:59 KST = 2026-08-31 14:59 UTC → 하루 시작은 2026-08-30T15:00:00Z
  const b = kstDayStart(new Date('2026-08-31T14:59:00.000Z'))
  expect('23:59 KST → 전날 시작', b.toISOString(), '2026-08-30T15:00:00.000Z')

  const w = weekWindowStart(new Date('2026-09-01T00:00:00.000Z'))
  expect('주간 창은 7일 전', w.toISOString(), '2026-08-25T00:00:00.000Z')
}

console.log('\n══════ ⑭ planCap 단독')
{
  const p = planCap({ dailyCap: 3, weeklyCap: 10 }, { usedToday: 1, usedWeek: 4 })
  expect('ok', p.ok, true)
  expect('  오늘 남은 2', p.remainingToday, 2)
  expect('  주 남은 6', p.remainingWeek, 6)
  const q = planCap({ dailyCap: null, weeklyCap: null }, { usedToday: 0, usedWeek: 0 })
  expect('미설정이면 남은 수를 세지 않는다', q.remainingToday, null)
}

console.log('\n══════ ⑮ 내림(takedown)')
{
  const good = planTakedown({ comment: { personaId: 'p1', isDeleted: false } })
  expect('페르소나 댓글 → ok', good.ok, true)

  const member = planTakedown({ comment: { personaId: null, isDeleted: false } })
  expect('실회원 댓글 → NOT_PERSONA_COMMENT', member.ok ? '' : member.blocks[0]?.code, 'NOT_PERSONA_COMMENT')

  const gone = planTakedown({ comment: { personaId: 'p1', isDeleted: true } })
  expect('이미 삭제 → ALREADY_DELETED', gone.ok ? '' : gone.blocks[0]?.code, 'ALREADY_DELETED')

  const none = planTakedown({ comment: null })
  expect('없음 → COMMENT_NOT_FOUND', none.ok ? '' : none.blocks[0]?.code, 'COMMENT_NOT_FOUND')
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)
