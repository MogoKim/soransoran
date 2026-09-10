#!/usr/bin/env tsx
/**
 * 콘텐츠 가드 피드백 가드
 *
 * 정본: src/lib/content-guard.ts · src/lib/post-guard-message.ts
 *
 * 이 검사가 존재하는 이유:
 *   막히는 것은 눈에 띄지만 **왜 막혔는지 말해 주는 것**은 조용히 사라진다.
 *   문구가 뭉개져도 화면은 멀쩡하고 테스트도 녹색이다. 고객만 글 전체를 훑으며
 *   무엇을 고쳐야 하는지 짐작하게 된다 — 실제로 '지랄' 한 낱말 때문에 그런 일이 있었다.
 *
 * ── 이 검사가 보장하는 것 ──
 *   · 사유(code)가 뭉개지지 않는다 — 욕설·연락처·링크·반복이 각각 다른 code 로 나온다
 *   · 걸린 표현과 위치를 정규식이 실제로 잡은 값으로 돌려준다 (공백 우회 포함)
 *   · 연락처는 걸린 값을 **싣지 않는다**
 *   · 통과 결과에 입력 원문이 섞이지 않는다
 *   · 문구가 제목/본문을 구분해 말한다
 *   · 브랜드 금지어는 사용자 글에서 지금처럼 통과한다
 *   · reason 문구가 그대로다 — 댓글·인사말·어드민·Micro Seed 회귀 차단
 *
 * ── 🔴 보장하지 못하는 것 ──
 *   · 화면이 그 문구를 실제로 그 자리에 붙이는지는 보지 못한다. 그건 브라우저 QA 가 본다.
 *   · 금칙어 목록이 옳은지 판단하지 않는다. 이번 작업은 목록을 건드리지 않는다.
 *
 * 🔴 DB·네트워크·env 를 건드리지 않는다. 순수 함수만 부른다.
 */
import { checkContent, BRAND_BANNED_WORDS, MAX_BODY_LINKS } from '../src/lib/content-guard'
import { postGuardMessage } from '../src/lib/post-guard-message'
import { checkPostContent } from '../src/lib/post-guard-check'

const results: Array<[string, boolean, string]> = []
const check = (why: string, ok: boolean, detail = '') => void results.push([why, ok, detail])

/** 실패 결과에서 issue 를 꺼낸다. ok 면 undefined */
function issueOf(r: ReturnType<typeof checkContent>) {
  return r.ok ? undefined : r.issue
}

// ── 1. 실제 사례: '지랄' ─────────────────────────────────
const real = checkContent('이 지랄 ㅋㅋㅋ 미친거 아닌가요')
check('실제 사례가 차단된다', !real.ok)
check('  사유가 BLOCKED_EXPRESSION 이다', issueOf(real)?.code === 'BLOCKED_EXPRESSION')
const realIssue = issueOf(real)
check(
  "  걸린 표현이 '지랄' 이다",
  realIssue?.code === 'BLOCKED_EXPRESSION' && realIssue.matchedText === '지랄',
  realIssue?.code === 'BLOCKED_EXPRESSION' ? realIssue.matchedText : '',
)

// ── 2. 공백 우회 — 입력에 있는 모양 그대로 ────────────────
const spaced = checkContent('이 지 랄 좀 보세요')
const spacedIssue = issueOf(spaced)
check('공백 우회도 차단된다', !spaced.ok)
check(
  "  걸린 표현이 '지 랄' 이다 (원문 모양 그대로)",
  spacedIssue?.code === 'BLOCKED_EXPRESSION' && spacedIssue.matchedText === '지 랄',
  spacedIssue?.code === 'BLOCKED_EXPRESSION' ? `'${spacedIssue.matchedText}'` : '',
)
check(
  '  위치가 원문에서 그 표현을 가리킨다',
  spacedIssue?.code === 'BLOCKED_EXPRESSION' &&
    '이 지 랄 좀 보세요'.slice(spacedIssue.start, spacedIssue.end) === '지 랄',
)

// 앞 공백이 있어도 위치가 밀리지 않는다 (제목 선택이 한 글자씩 어긋나던 자리)
const padded = checkContent('   지랄 같네')
const paddedIssue = issueOf(padded)
check(
  '앞 공백이 있어도 위치가 원문 기준이다',
  paddedIssue?.code === 'BLOCKED_EXPRESSION' &&
    '   지랄 같네'.slice(paddedIssue.start, paddedIssue.end) === '지랄',
)

// ── 3. 정상 표현은 통과 ──────────────────────────────────
check('정상적인 ㅋㅋㅋ 는 통과한다', checkContent('아 진짜 웃겨요 ㅋㅋㅋ 재밌네').ok)
check('평범한 글은 통과한다', checkContent('오늘 날씨가 좋아서 산책했어요').ok)

// ── 4~6. 링크 ───────────────────────────────────────────
const titleUrl = checkContent('https://example.com 보세요', { isTitle: true })
check('제목에 링크 1개면 막힌다', !titleUrl.ok)
check('  사유가 TOO_MANY_LINKS 다', issueOf(titleUrl)?.code === 'TOO_MANY_LINKS')
const t = issueOf(titleUrl)
check('  제목 허용치는 0 이다', t?.code === 'TOO_MANY_LINKS' && t.allowed === 0)

check(
  `본문에 링크 ${MAX_BODY_LINKS}개는 통과한다`,
  checkContent('https://a.com 과 https://b.com 참고하세요').ok,
)
const threeLinks = checkContent('https://a.com https://b.com https://c.com')
const three = issueOf(threeLinks)
check('본문에 링크 3개면 막힌다', !threeLinks.ok)
check(
  `  개수(3)와 허용치(${MAX_BODY_LINKS})를 함께 알려준다`,
  three?.code === 'TOO_MANY_LINKS' && three.count === 3 && three.allowed === MAX_BODY_LINKS,
)

// ── 7. 연락처 — 값을 싣지 않는다 ─────────────────────────
const phone = checkContent('연락은 010-1234-5678 로 주세요')
const phoneIssue = issueOf(phone)
check('전화번호가 막힌다', !phone.ok)
check('  사유가 CONTACT_INFO 다', phoneIssue?.code === 'CONTACT_INFO')
check(
  '  🔴 걸린 번호를 결과에 싣지 않는다',
  !JSON.stringify(phone).includes('010-1234-5678'),
  JSON.stringify(phone),
)
const kakao = checkContent('카톡: mysecretid123 으로 오세요')
check('카톡 아이디가 막힌다', !kakao.ok)
check('  🔴 걸린 아이디를 결과에 싣지 않는다', !JSON.stringify(kakao).includes('mysecretid123'))

// ── 8. 과도한 반복 ───────────────────────────────────────
const repeat = checkContent(`좋아요${'!'.repeat(25)}`)
const repeatIssue = issueOf(repeat)
check('같은 글자 과도 반복이 막힌다', !repeat.ok)
check('  사유가 EXCESSIVE_REPEAT 다', repeatIssue?.code === 'EXCESSIVE_REPEAT')
check(
  '  반복 구간 위치를 알려준다',
  repeatIssue?.code === 'EXCESSIVE_REPEAT' && repeatIssue.end > repeatIssue.start,
)

// ── 9. 브랜드 금지어는 사용자 글에서 통과 (기존 정책 유지) ──
const leaked = BRAND_BANNED_WORDS.filter((w) => !checkContent(`${w} 이야기입니다`).ok)
check('브랜드 금지어는 사용자 글에서 통과한다 (기존 정책)', leaked.length === 0, leaked.join(','))

// ── 10. 통과 결과에 원문이 없다 ──────────────────────────
const passed = checkContent('아주 평범하고 긴 본문입니다. 비밀번호 같은 것은 없습니다.')
check(
  '통과 결과는 { ok: true } 뿐이다',
  JSON.stringify(passed) === '{"ok":true}',
  JSON.stringify(passed),
)

// ── 11. 문구가 제목/본문을 구분한다 ──────────────────────
const bodyMsg = postGuardMessage('content', {
  code: 'BLOCKED_EXPRESSION',
  matchedText: '지랄',
  start: 0,
  end: 2,
})
const titleMsg = postGuardMessage('title', {
  code: 'BLOCKED_EXPRESSION',
  matchedText: '지랄',
  start: 0,
  end: 2,
})
check('본문 문구가 "본문에서" 로 시작한다', bodyMsg.startsWith('본문에서'), bodyMsg)
check('제목 문구가 "제목에서" 로 시작한다', titleMsg.startsWith('제목에서'), titleMsg)
check("본문 문구에 걸린 표현이 들어 있다", bodyMsg.includes('지랄'), bodyMsg)
check('본문 문구가 무엇을 하라고 말한다', bodyMsg.includes('바꿔 주세요'), bodyMsg)
check(
  '받침 없는 표현은 조사가 "가" 다',
  postGuardMessage('content', { code: 'BLOCKED_EXPRESSION', matchedText: '까까', start: 0, end: 2 })
    .includes('‘까까’가 발견'),
)

const contactMsg = postGuardMessage('content', { code: 'CONTACT_INFO' })
check('연락처 문구가 종류만 말한다', contactMsg.includes('연락처 또는 외부 대화방'), contactMsg)
const titleLinkMsg = postGuardMessage('title', { code: 'TOO_MANY_LINKS', count: 1, allowed: 0 })
check('제목 링크 문구가 "넣을 수 없어요" 다', titleLinkMsg.includes('넣을 수 없어요'), titleLinkMsg)
const bodyLinkMsg = postGuardMessage('content', { code: 'TOO_MANY_LINKS', count: 3, allowed: 2 })
check(`본문 링크 문구가 ${MAX_BODY_LINKS}개 상한을 말한다`, bodyLinkMsg.includes(`${MAX_BODY_LINKS}개까지`), bodyLinkMsg)
const repeatMsg = postGuardMessage('content', { code: 'EXCESSIVE_REPEAT', start: 0, end: 20 })
check('반복 문구가 줄이라고 말한다', repeatMsg.includes('줄여 주세요'), repeatMsg)

check(
  '🔴 어떤 문구도 "사용할 수 없는 표현이 있습니다" 로 뭉개지지 않는다',
  ![bodyMsg, titleMsg, contactMsg, titleLinkMsg, bodyLinkMsg, repeatMsg].some(
    (m) => m === '사용할 수 없는 표현이 있습니다. 다시 적어주세요.',
  ),
)

// ── 12. reason 문구 회귀 차단 (댓글·인사말·어드민·Micro Seed 가 그대로 쓴다) ──
const REASONS: Array<[string, string]> = [
  ['지랄', '사용할 수 없는 표현이 있습니다. 다시 적어주세요.'],
  ['카톡: abc123', '연락처나 외부 대화방 주소는 남길 수 없습니다.'],
  ['https://a.com https://b.com https://c.com', '링크가 너무 많습니다.'],
  [`ㅎ${'ㅎ'.repeat(25)}`, '같은 글자가 너무 많이 반복됩니다.'],
]
for (const [input, expected] of REASONS) {
  const r = checkContent(input)
  check(
    `reason 문구가 그대로다 — "${expected.slice(0, 18)}…"`,
    !r.ok && r.reason === expected,
    r.ok ? '통과해 버림' : r.reason,
  )
}


// ── 13. 제목 → 본문 순서 · 다음 문제 안내 (checkPostContent) ──
{
  const both = checkPostContent({ title: '지랄 같은 제목', text: '본문에도 병신 이 있다' })
  check('제목과 본문이 둘 다 걸리면 제목을 먼저 말한다', both?.field === 'title', both?.field ?? 'null')
  check("  걸린 표현이 '지랄' 이다", both?.matchedText === '지랄', both?.matchedText ?? '')

  const afterTitleFixed = checkPostContent({ title: '평범한 제목', text: '본문에도 병신 이 있다' })
  check(
    '제목을 고치면 다음 문제(본문)를 말한다',
    afterTitleFixed?.field === 'content',
    afterTitleFixed?.field ?? 'null',
  )

  // 차단 표현 2개 — 첫 표현을 지우면 두 번째를 말한다
  const two = checkPostContent({ title: '제목', text: '지랄 하고 병신 같다' })
  check('차단 표현 2개면 첫 번째를 말한다', two?.matchedText === '지랄', two?.matchedText ?? '')
  const oneLeft = checkPostContent({ title: '제목', text: '하고 병신 같다' })
  check(
    '  첫 표현을 지우면 두 번째를 말한다',
    oneLeft?.matchedText === '병신',
    oneLeft?.matchedText ?? 'null',
  )
  const allGone = checkPostContent({ title: '제목', text: '하고 같다' })
  check('  둘 다 지우면 통과한다 (null)', allGone === null, JSON.stringify(allGone))

  // 금칙어와 무관한 글자를 바꿔도 여전히 막힌다
  const unrelatedEdit = checkPostContent({ title: '제목', text: '지랄 하고 병신 같다!!' })
  check('금칙어와 무관한 글자를 바꿔도 막힌 채로 남는다', unrelatedEdit !== null)

  const clean = checkPostContent({ title: '평범한 제목', text: '평범하고 즐거운 본문입니다.' })
  check('둘 다 깨끗하면 null 이다 — CTA 를 열 수 있는 유일한 조건', clean === null)
}

// ── 보고 ────────────────────────────────────────────────
const failed = results.filter(([, ok]) => !ok)
for (const [why, ok, detail] of results) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${why}${detail && !ok ? `  → ${detail}` : ''}`)
}
console.log('')
if (failed.length) {
  console.error(`🔴 콘텐츠 가드 피드백 가드 실패 — ${failed.length}/${results.length}\n`)
  for (const [why, , detail] of failed) console.error(`  ${why}${detail ? `  → ${detail}` : ''}`)
  process.exit(1)
}
console.log(`콘텐츠 가드 피드백 가드 통과 — ${results.length}건`)
console.log('')
console.log('🔴 이 검사는 규칙과 문구만 본다 —')
console.log('   화면이 그 문구를 막힌 칸 옆에 실제로 붙이는지는 브라우저 QA 가 본다.')
