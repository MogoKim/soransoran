#!/usr/bin/env tsx
/**
 * 콘텐츠 정책 가드
 *
 * 정본: src/lib/content-guard.ts · post-guard-check.ts · post-guard-message.ts
 *
 * 이 검사가 존재하는 이유:
 *   콘텐츠 정책은 틀려도 화면이 멀쩡하다. 정상 글이 막혀도 오류 로그가 남지 않고,
 *   광고가 통과해도 아무도 알려주지 않는다. 사람이 알아채는 순간은
 *   **회원이 글을 포기하고 떠난 뒤**다. 그래서 기계가 본다.
 *
 * ── 이 검사가 보장하는 것 ──
 *   · 감정·인용·피해·상담·경고 글이 사용자 영역에서 통과한다
 *   · 정상 한국어가 욕설 정규식에 걸리지 않는다 (공백·줄바꿈 결합 오탐 0)
 *   · 전화번호·외부 ID·제목 링크·링크 과다·도배는 여전히 막힌다
 *   · 광고는 단어가 아니라 **통로+모집+판** 세 신호가 모두 있을 때만 막힌다
 *   · nickname·official·bot 의 엄격 정책이 유지된다
 *   · 사용자 정책을 풀어도 봇 정책이 함께 풀리지 않는다
 *   · 오류 문구에 전화번호·아이디·광고 원문이 되풀이되지 않는다
 *
 * ── 🔴 보장하지 못하는 것 ──
 *   · 화면이 그 문구를 막힌 칸 옆에 실제로 붙이는지는 브라우저 QA 가 본다.
 *   · 신고·숨김·제재가 실제로 운영되는지는 사람이 본다.
 *
 * 🔴 DB·네트워크·env 를 건드리지 않는다. 순수 함수만 부른다.
 */
import { checkContent, BRAND_BANNED_WORDS, MAX_BODY_LINKS } from '../src/lib/content-guard'
import { postGuardMessage } from '../src/lib/post-guard-message'
import { checkPostContent } from '../src/lib/post-guard-check'
import { checkMicroSeedContent } from '../src/lib/micro-seed-guard'

const results: Array<[string, boolean, string]> = []
const check = (why: string, ok: boolean, detail = '') => void results.push([why, ok, detail])

const userOk = (t: string) => checkContent(t, { audience: 'user' }).ok
const userRes = (t: string) => checkContent(t, { audience: 'user' })
const code = (t: string) => {
  const r = userRes(t)
  return r.ok ? 'OK' : (r.issue?.code ?? 'NO_ISSUE')
}

// ══ 1. 거친 표현 단독 — 사용자 영역에서 통과 ══
const HARSH = ['시발', '씨발', '시팔', '병신', '개새끼', '좆', '썅', '지랄']
for (const w of HARSH) {
  check(`거친 표현 '${w}' 단독 사용이 통과한다`, userOk(`오늘 진짜 ${w} 같은 하루였어요`), code(`오늘 진짜 ${w} 같은 하루였어요`))
}

// ══ 2. 확정 정책이 명시한 허용 문장 ══
const MUST_PASS = [
  '이 일이 변화의 시발점이 됐어요',
  '도시 발전이 기대돼요',
  '질병 신호인지 걱정돼요',
  '병 신경써서 관리하세요',
  '이번 시 팔월에 다시 만나요',
  '올해 도시\n발전 계획이 나왔대요',
  '큰 병\n신경 쓰여요',
  '희망의 씨\n발아를 기다립니다',
  '카지노에서 돈을 잃은 가족 때문에 고민이에요',
  '카지노 광고 문자가 계속 와요',
  '리딩방 사기를 당했어요',
  '코인 리딩방에 속지 마세요',
  '먹튀를 당한 것 같아요',
  '대출 문의 전화가 계속 와서 무서워요',
  '신용불량 때문에 너무 힘들어요',
  '토토사이트 광고가 계속 뜹니다',
  '바카라 중독으로 이혼했어요',
  '작업대출 사기 조심하세요',
  '조건만남 피해를 신고했습니다',
  '오픈카톡 사기 조심하세요',
  '카지\n노래방에서 놀았어요',
  '내일 리딩\n방문 예정입니다',
  '작업 대출계 정리했어요',
  '먹\n튀김 맛있었어요',
  '신용 불량품을 받았어요',
  '대출 문의 없이 진행했어요',
  '남편이 또 저 지랄이에요',
  '그 사람이 저한테 병신이라고 했어요',
  '친구가 개새끼라고 욕해서 상처받았어요',
  '아 진짜 웃겨요 ㅋㅋㅋ 재밌네',
  '동호회 가입하려면 https://cafe.example 보세요',
]
for (const t of MUST_PASS) {
  check(`통과해야 한다 — "${t.replace(/\n/g, '⏎').slice(0, 26)}"`, userOk(t), code(t))
}

// ══ 3. 계속 막아야 하는 것 (사용자 영역) ══
const MUST_BLOCK: Array<[string, string, string]> = [
  ['연락은 010-1234-5678 로 주세요', 'CONTACT_PHONE', '전화번호'],
  ['카톡: mysecretid123 으로 오세요', 'CONTACT_EXTERNAL_ID', '카톡 ID'],
  ['텔레: investking 투자합니다', 'CONTACT_EXTERNAL_ID', '텔레그램 ID'],
  ['텔레그램 @moneyking 로 오세요', 'CONTACT_EXTERNAL_ID', '텔레그램 ID'],
  ['https://a.com https://b.com https://c.com', 'TOO_MANY_LINKS', '링크 3개'],
  [`좋아요${'!'.repeat(25)}`, 'EXCESSIVE_REPEAT', '동일 문자 20회'],
  ['리딩방 가입은 https://spam.example 에서 하세요', 'AD_COMBO', '리딩방 가입 + URL'],
  ['카지노 충전 문의는 오픈카톡으로 주세요', 'AD_COMBO', '카지노 충전 + 오픈채팅'],
  ['코인리딩 수익 보장 가입 https://x.example', 'AD_COMBO', '수익보장 + URL'],
  ['작업대출 상담 가입 www.loan.example', 'AD_COMBO', '대출 가입 + URL'],
]
for (const [t, expected, label] of MUST_BLOCK) {
  const got = code(t)
  check(`차단해야 한다 — ${label}`, got === expected, `기대 ${expected} / 받음 ${got}`)
}

// 링크 1·2개는 허용
check('본문 링크 1개는 통과한다', userOk('여기 보세요 https://a.com'))
check(`본문 링크 ${MAX_BODY_LINKS}개는 통과한다`, userOk('https://a.com 과 https://b.com 참고'))
check('제목 링크 1개는 차단한다', checkContent('https://a.com 보세요', { isTitle: true, audience: 'user' }).ok === false)

// ══ 4. 광고 조합 — 신호 하나만으로는 막지 않는다 ══
check('통로만 있으면 통과 (링크만)', userOk('사진 보세요 https://photo.example'))
check('모집만 있으면 통과 (가입만)', userOk('동호회 가입했어요 즐거워요'))
check('판만 있으면 통과 (리딩방만)', userOk('리딩방 때문에 속상해요'))
check('통로+모집만 있으면 통과 (도박 판 없음)', userOk('독서모임 가입 https://book.example'))
check('통로+판만 있으면 통과 (모집 없음)', userOk('리딩방 피해 기사 https://news.example'))
check('셋 다 있으면 차단', code('리딩방 가입 https://spam.example') === 'AD_COMBO')

// ══ 5. 영역 분리 — 사용자만 풀리고 나머지는 그대로 ══
for (const w of ['지랄', '카지노', '리딩방']) {
  const s = `${w} 이야기입니다`
  check(`'${w}' — user 통과`, checkContent(s, { audience: 'user' }).ok)
  check(`  nickname 차단 유지`, checkContent(s, { audience: 'nickname' }).ok === false)
  check(`  official 차단 유지`, checkContent(s, { audience: 'official' }).ok === false)
  check(`  bot 차단 유지`, checkContent(s, { audience: 'bot' }).ok === false)
}
check(
  '🔴 사용자 정책을 풀어도 봇은 욕설을 발행할 수 없다',
  checkMicroSeedContent('지랄 같은 하루였다').ok === false,
)
const leaked = BRAND_BANNED_WORDS.filter((w) => !checkMicroSeedContent(`${w} 이야기입니다`).ok)
check('브랜드 금지어 4종이 봇 경로에서 계속 차단된다', leaked.length === 4, `차단 ${leaked.length}/4`)
check(
  '브랜드 금지어는 사용자 글에서 통과한다 (기존 정책)',
  BRAND_BANNED_WORDS.every((w) => checkContent(`${w} 이야기입니다`, { audience: 'user' }).ok),
)

// ══ 6. 엄격 영역에서도 정상 한국어는 통과 ══
const STRICT_MUST_PASS = ['이 일이 변화의 시발점이 됐어요', '도시 발전이 기대돼요', '질병 신호인지 걱정돼요', '병 신경써서 관리하세요', '이번 시 팔월에 다시 만나요', '올해 도시\n발전 계획']
for (const t of STRICT_MUST_PASS) {
  check(
    `엄격(bot)에서도 통과 — "${t.replace(/\n/g, '⏎').slice(0, 22)}"`,
    checkContent(t, { audience: 'bot' }).ok,
  )
}

// ══ 7. 제목 → 본문 순서와 다음 문제 안내 ══
{
  const both = checkPostContent({ title: '010-1234-5678 문의', text: '본문에 https://a.com https://b.com https://c.com' })
  check('제목과 본문이 둘 다 걸리면 제목을 먼저 말한다', both?.field === 'title', both?.field ?? 'null')
  const afterTitle = checkPostContent({ title: '평범한 제목', text: '본문에 https://a.com https://b.com https://c.com' })
  check('제목을 고치면 다음 문제(본문)를 말한다', afterTitle?.field === 'content', afterTitle?.field ?? 'null')
  const clean = checkPostContent({ title: '평범한 제목', text: '지랄 같지만 평범한 본문입니다' })
  check('거친 표현만 있는 글은 제목·본문 모두 통과 (null)', clean === null, JSON.stringify(clean))
}

// ══ 8. 민감한 원문이 결과·문구에 실리지 않는다 ══
{
  const phone = userRes('연락은 010-1234-5678 로 주세요')
  check('🔴 전화번호가 결과에 실리지 않는다', !JSON.stringify(phone).includes('010-1234-5678'), JSON.stringify(phone))
  const kakao = userRes('카톡: mysecretid123 으로')
  check('🔴 카톡 아이디가 결과에 실리지 않는다', !JSON.stringify(kakao).includes('mysecretid123'))
  const ad = userRes('리딩방 가입 https://spam.example')
  check('🔴 광고 원문·링크가 결과에 실리지 않는다', !JSON.stringify(ad).includes('spam.example'))
  const passed = checkContent('아주 평범한 본문입니다', { audience: 'user' })
  check('통과 결과는 { ok: true } 뿐이다', JSON.stringify(passed) === '{"ok":true}', JSON.stringify(passed))
}

// ══ 9. 필드별 문구 ══
{
  const m = (f: 'title' | 'content', c: string) => {
    const r = f === 'title'
      ? checkContent(c, { isTitle: true, audience: 'user' })
      : checkContent(c, { audience: 'user' })
    return r.ok ? '' : postGuardMessage(f, r.issue!)
  }
  const phoneMsg = m('content', '연락은 010-1234-5678 로')
  check('전화번호 문구가 "전화번호를 지워 주세요" 다', phoneMsg.includes('전화번호를 지워 주세요'), phoneMsg)
  check('🔴 전화번호 문구에 번호가 없다', !phoneMsg.includes('010-1234-5678'), phoneMsg)
  const idMsg = m('content', '카톡: mysecretid123')
  check('외부 ID 문구가 종류만 말한다', idMsg.includes('외부 연락처 ID'), idMsg)
  check('🔴 외부 ID 문구에 아이디가 없다', !idMsg.includes('mysecretid123'), idMsg)
  const titleLink = m('title', 'https://a.com 보세요')
  check('제목 링크 문구가 "넣을 수 없어요" 다', titleLink.includes('넣을 수 없어요'), titleLink)
  const bodyLink = m('content', 'https://a.com https://b.com https://c.com')
  check(`본문 링크 문구가 ${MAX_BODY_LINKS}개 상한을 말한다`, bodyLink.includes(`${MAX_BODY_LINKS}개까지만`), bodyLink)
  const adMsg = m('content', '리딩방 가입 https://spam.example')
  check('광고 조합 문구가 조합을 말한다', adMsg.includes('가입·충전') && adMsg.includes('외부 링크'), adMsg)
  check('🔴 광고 문구가 낱말을 짚지 않는다', !adMsg.includes('리딩방'), adMsg)
  check('본문 문구가 "본문에" 로 시작한다', m('content', '연락은 010-1234-5678 로').startsWith('본문에'))
}

// ══ 보고 ══
const failed = results.filter(([, ok]) => !ok)
for (const [why, ok, detail] of results) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${why}${detail && !ok ? `  → ${detail}` : ''}`)
}
console.log('')
if (failed.length) {
  console.error(`🔴 콘텐츠 정책 가드 실패 — ${failed.length}/${results.length}\n`)
  for (const [why, , detail] of failed) console.error(`  ${why}${detail ? `  → ${detail}` : ''}`)
  process.exit(1)
}
console.log(`콘텐츠 정책 가드 통과 — ${results.length}건`)
console.log('')
console.log('🔴 이 검사는 규칙과 문구만 본다 —')
console.log('   화면이 그 문구를 막힌 칸 옆에 붙이는지는 브라우저 QA 가,')
console.log('   신고·숨김·제재가 실제로 도는지는 사람이 본다.')
