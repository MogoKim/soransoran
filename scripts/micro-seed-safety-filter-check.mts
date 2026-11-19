#!/usr/bin/env tsx
/**
 * 안전 · 브랜드 필터 fixture — 🔴 **판정만 검사한다. 발행하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-U ⑤ · §4-X ⑦ · §4-Y ⑤
 *
 * 🔴 이 fixture 가 막는 사고
 *    ① 공지가 hold 로 새어 어딘가로 가는 것 (hardExclude 다)
 *    ② 펑·펑예가 Drop 으로 취급되는 것 (휘발 신호는 Drop 이 아니다)
 *    ③ 건강 **주제** 가 제외되는 것 (막는 것은 단정·시술이다)
 *    ④ 네이버와 82cook 이 같은 입력에 다른 답을 내는 것
 *    ⑤ 필터가 발행·fetch·DB·Sheet·LLM 을 건드리는 것
 *
 * 🔴 부정 스캔은 codeOf() 를 지난 뒤에 한다 — 원문에 걸면 *금지를 설명하는 주석* 이 잡힌다.
 */
import { readFileSync } from 'node:fs'
import {
  safetyFilter, passesSafety, isVolatile, NOTICE_LABELS, safetyReasonCodes, INVALID_SAFETY_REASON_CODE,
  type SafetyInput, type SafetyReasonCode, type SafetyVerdict,
} from './lib/micro-seed-safety-filter.mjs'
import { toThinRow } from '../src/lib/micro-seed-82cook-thin'
import { thinRowFromCollected } from '../src/lib/micro-seed-navercafe-thin'
import { toDetailRecord } from '../src/lib/micro-seed-82cook-thin-adapt'
import { KNOWN_SAFETY_CODES, mergeJudgeRows, readReasons } from '../src/lib/micro-seed-auto-judge'
import { ROW_LABELS } from './lib/micro-seed-navercafe.mjs'

const SRC = readFileSync('scripts/lib/micro-seed-safety-filter.mts', 'utf-8')
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const CODE = codeOf(SRC)

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, why = ''): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}${why ? ` — ${why}` : ''}`) }
}

const run = (o: Partial<SafetyInput> & { title: string }) => safetyFilter(o as SafetyInput)
const codes = (o: Partial<SafetyInput> & { title: string }): SafetyReasonCode[] =>
  run(o).reasons.map((r) => r.code)
const verdict = (o: Partial<SafetyInput> & { title: string }): SafetyVerdict => run(o).verdict

console.log('\n안전 · 브랜드 필터 fixture')
console.log('─────────────────────────────────────────────────────────')

// ─────────────────────────────────────────────────────────
console.log('\n① 낱말 사전으로 글을 버리지 않는다 — 정치 낱말 사전은 지웠다 (2026-11-18 창업자 결정)')
// ─────────────────────────────────────────────────────────
{
  // 부분일치 사전이 무관한 글을 지우던 모양(지어낸 제목): 진영 · 수구 · 친문 · 장관 · 반일 이 낱말 안에 들어 있다
  for (const t of ['배우 박진영 나오는 드라마 보셨어요', '하수구가 막혀서 사람 불렀어요', '남친문제로 잠이 안 와요', '공장관리 일 해보신 분', '이것도 약관 위반일까요']) {
    check(`🔴 "${t.slice(0, 12)}…" 는 통과다`, verdict({ title: t }) === 'pass', `실제 ${verdict({ title: t })}`)
  }
  // 사회 · 정치 화제도 낱말로는 버리지 않는다 — 해가 되는 글인지는 판정이 본다
  for (const t of ['대선 후보 토론 보셨어요', '탄핵심판 뉴스 보고 한마디', '수능 감독 강화 대책 어떻게 보세요']) {
    check(`🔴 화제 글 "${t.slice(0, 12)}…" 도 낱말로 버리지 않는다`, verdict({ title: t, body: t }) === 'pass', `실제 ${verdict({ title: t, body: t })}`)
  }
  check('🔴 안전 필터에 정치 사유 · 정치 판정 호출이 없다', !/politic|findPolitical/i.test(CODE))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 공지 · 필독 · 추천 — 🔴 hardExclude')
// ─────────────────────────────────────────────────────────
{
  for (const l of NOTICE_LABELS) {
    check(`🔴 라벨 "${l}" → hardExclude`, verdict({ title: '게시판 이용 안내', sourceRowLabel: l }) === 'hardExclude')
  }
  check('🔴 제목 [공지] 접두도 hardExclude', verdict({ title: '[공지] 9월 이벤트 안내' }) === 'hardExclude')
  check('🔴 sourcePinned 도 hardExclude', verdict({ title: '평범한 제목', sourcePinned: true }) === 'hardExclude')
  check('🔴 사유 코드가 noticeSlot 이다', codes({ title: '[공지] 안내' }).includes('noticeSlot'))
  // 🔴 navercafe 의 라벨 목록과 갈라지면 안 된다
  check('🔴 NOTICE_LABELS 가 navercafe ROW_LABELS 와 같다',
    JSON.stringify([...NOTICE_LABELS].sort()) === JSON.stringify([...ROW_LABELS].sort()),
    `${NOTICE_LABELS.join(',')} vs ${ROW_LABELS.join(',')}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 펑 · 휘발 신호 — 🔴 Drop 이 아니다')
// ─────────────────────────────────────────────────────────
{
  for (const t of ['조카 얘기 좀 들어주세요 (펑예)', '곧 펑 할게요 조언 부탁', '삭제 예정입니다 봐주세요', '잠시 올려요 고민이에요']) {
    const r = run({ title: t })
    check(`🟡 "${t.slice(0, 12)}…" 는 volatile 만 붙는다`, r.verdict === 'pass', `실제 ${r.verdict}`)
    check(`   Drop·hardExclude 가 아니다`, r.verdict !== 'drop' && r.verdict !== 'hardExclude')
    check(`   volatile 사유가 남는다`, isVolatile(r))
  }
  check('🔴 volatile 은 verdict 를 바꾸지 않는다 — 통과로 남는다',
    passesSafety(run({ title: '펑예 시댁 이야기' })))
  check('🟢 note 에 "Drop 아님" 을 적는다',
    run({ title: '펑예 시댁 이야기' }).reasons.some((r) => r.code === 'volatile' && r.note.includes('Drop 아님')))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 의료 낱말로 막지 않는다 — 위험한 의료 지시는 모델 판정이 본다 (2026-11-18 창업자 결정)')
// ─────────────────────────────────────────────────────────
{
  for (const t of [
    '당뇨 관리 어떻게들 하세요', '갱년기 불면증 어떻게 버티세요',
    '혈압약 드시는 분 경험 궁금해요', '질유산균 뭐 드세요??',
    // 앞판이 낱말 하나로 보류하던 제목들 — 처방 · 시술 · 수술 · 완치 · 부작용
    '도수치료 받아보신 분 어떤가요', '레이저 시술 추천해주세요',
    '이 약 처방 받아도 될까요', '이거 먹으면 완치된대요', '부작용 없고 효과 직빵이에요',
  ]) {
    const v = verdict({ title: t, body: `${t} 저는 수술 받고 처방 받은 약을 복용법대로 먹는 중이에요` })
    check(`🟢 "${t.slice(0, 14)}…" 는 통과다`, v === 'pass', `실제 ${v}`)
  }
  // 앞판이 의료 판단 요청 · 건강 효능 주장으로 보류하던 본문
  check('🟢 치료를 계속해도 되는지 묻는 글도 낱말로 보류하지 않는다',
    verdict({ title: '미레나 5년 채워야 한다고들 하는데, 진짜 그럼?', body: '미레나 부작용일 수도 있겠다는 생각은 들고요. 계속 써도 괜찮은 건 아닐까요?' }) === 'pass')
  check('🟢 효과가 있었다는 이야기도 낱말로 보류하지 않는다',
    verdict({ title: '무릎 안 아프고 숨 안 차는 운동 찾다가', body: '걸음으로 뛰니까 무릎에 무리가 없다고 하고 운동 효과는 본다고.' }) === 'pass')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 광고 낱말로 막지 않는다 — 광고 글인지는 모델 판정이 본다')
// ─────────────────────────────────────────────────────────
{
  for (const t of ['협찬 받아서 써봤어요', '공동구매 진행합니다', '할인코드 드려요', '카톡 문의 주세요', '체험단 모집합니다',
    '축의금 입금했는데 계좌가 틀렸대요', '아파트 분양 받으신 분', '캡슐커피머신 추천해주세요']) {
    const v = verdict({ title: t })
    check(`🟢 "${t.slice(0, 12)}…" 는 통과다`, v === 'pass', `실제 ${v}`)
  }
  check('🟢 댓글에 광고 낱말이 있어도 원문을 막지 않는다',
    verdict({ title: '정수기 추천해주세요', comments: ['공동구매 링크 타고 들어오세요'] }) === 'pass')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 연락처 · 식별번호 — 낱말이 아니라 실제 번호가 적혔을 때만 버린다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 휴대전화 번호 → drop', verdict({ title: '연락 주세요 010-1234-5678' }) === 'drop')
  check('🔴 수집 때 마스킹된 연락처 자리표 → drop',
    verdict({ title: '나눔합니다', body: '필요하신 분 [연락처] 로 문자 주세요' }) === 'drop')
  check('🔴 주민등록번호 → drop', verdict({ title: '확인 부탁', body: '800101-2345678 이거 맞나요' }) === 'drop')
  check('🔴 카드 번호 → drop', verdict({ title: '결제가 안 돼요', body: '1234-5678-9012-3456 인데 왜 안 될까요' }) === 'drop')
  check('🔴 계좌 번호 → drop', verdict({ title: '보내주세요', body: '국민 110-234-567890 입니다' }) === 'drop')
  check('🔴 사유 코드가 personalIdentity 다', codes({ title: '연락 주세요 010-1234-5678' }).includes('personalIdentity'))
  // 낱말만으로는 버리지 않는다 — 앞판은 "주민번호" "계좌번호" 라는 말만 나와도 보류했다
  for (const t of ['주민번호 알려달래요', '계좌번호 보내라는데', '전화번호 알려달라는 사람', '신상 털어서 올렸더라구요']) {
    check(`🟢 "${t.slice(0, 12)}…" 는 낱말뿐이라 통과다`, verdict({ title: t }) === 'pass', `실제 ${verdict({ title: t })}`)
  }
  // 번호처럼 보이지만 아닌 것 — 날짜 · 금액 · 짧은 숫자
  for (const b of ['2026-11-19 에 다녀왔어요', '3-4인분 기준으로 2-3번 먹어요', '전기세 400,000원 나왔어요', '1588-1234 로 전화했더니']) {
    check(`🟢 "${b.slice(0, 14)}…" 는 식별번호가 아니다`, verdict({ title: '평범한 제목', body: b }) === 'pass', `실제 ${verdict({ title: '평범한 제목', body: b })}`)
  }
  check('🟢 publicFigureMention 플래그만으로는 막지 않는다 — 위해가 아니라 소재다',
    verdict({ title: '평범한 제목', qualityFlags: ['publicFigureMention'] }) === 'pass')
  check('🟢 medicalOrAdLikely 플래그만으로도 막지 않는다',
    verdict({ title: '평범한 제목', qualityFlags: ['medicalOrAdLikely'] }) === 'pass')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 욕설 · 혐오 · 분쟁 유도 → drop')
// ─────────────────────────────────────────────────────────
{
  for (const t of ['진짜 병신같은 상황이에요', '맘충들 때문에 못 살겠어요']) {
    const v = verdict({ title: t })
    check(`🔴 "${t.slice(0, 12)}…" → drop`, v === 'drop', `실제 ${v}`)
  }
  // 🔵 (P0-3 최종) 강한 호불호 · 주관적 의견(고소각 · 극혐)은 위해가 아니다 — 혐오 · 위협 · 동원만 막는다
  check('🔵 "고소각인가요" · "극혐이었어요" (주관적 의견) → drop 아님',
    verdict({ title: '고소각인가요' }) !== 'drop' && verdict({ title: '그 장면 극혐이었어요' }) !== 'drop')
  check('🔴 사유 코드가 hostility 다', codes({ title: '진짜 병신같은' }).includes('hostility'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 이미지 의존 → drop · visualDependent')
// ─────────────────────────────────────────────────────────
{
  check('🔴 글씨체 질문 → drop', verdict({ title: '이 글씨체 뭔지 아는 분 계신가요???' }) === 'drop')
  check('🔴 사유 코드가 visualDependent 다',
    codes({ title: '이 글씨체 뭔지 아는 분' }).includes('visualDependent'))
  check('🔴 본문 거의 없고 이미지만 있으면 drop',
    verdict({ title: '다이슨 추천', body: '이거 어때요?', imageCount: 3 }) === 'drop')
  check('🟢 이미지가 있어도 본문이 충분하면 통과',
    verdict({ title: '미드 추천', body: '언두잉 빅리틀라이즈 니콜키드먼 나오는데 연기 최고예요 넷플릭스에는 없어요 쿠플에서 볼 수 있어요', imageCount: 2 }) === 'pass')
  // 🔴 이미지를 가져오겠다는 뜻이 아니다
  check('🔴 이미지 수집·다운로드 코드가 없다', !/download|fetchImage|img\.src|createWriteStream/.test(CODE))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ Access — 🔴 읽지 못한 것은 판정이 아니다')
// ─────────────────────────────────────────────────────────
{
  for (const s of ['deletedOrExpired', 'permissionDenied', 'renderFailed', 'unknown'] as const) {
    check(`⚫ ${s} → access`, verdict({ title: '아무 제목', accessStatus: s }) === 'access')
  }
  check('🟢 ok 는 access 가 아니다', verdict({ title: '아무 제목', accessStatus: 'ok' }) !== 'access')
  check('🔴 사유 코드가 access 다',
    codes({ title: '아무 제목', accessStatus: 'deletedOrExpired' }).includes('access'))
  check('🔴 Access 를 Drop·Hold 로 뭉개지 않는다',
    verdict({ title: '아무 제목', accessStatus: 'deletedOrExpired' }) === 'access')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ source-agnostic — 🔴 네이버와 82cook 이 같은 답을 낸다')
// ─────────────────────────────────────────────────────────
{
  // 🔴 입력에 sourceSite 가 아예 없다 — 소스를 알 수 없으므로 갈라질 수 없다
  check('🔴 sourceSite 를 입력으로 받지 않는다', !/sourceSite/.test(CODE))
  check('🔴 네이버 DOM·URL 에 의존하지 않는다',
    !/cafe\.naver|iframe|querySelector|ArticleList|ca-fe/.test(CODE))
  const cases: (Partial<SafetyInput> & { title: string })[] = [
    { title: '대선 토론 보셨어요' },
    { title: '[공지] 안내' },
    { title: '도수치료 어떤가요' },
    { title: '냉장고 추천해주세요' },
    { title: '펑예 고민이에요' },
  ]
  for (const c of cases) {
    // 같은 입력을 두 번 — 소스 구분이 없으므로 항상 같아야 한다
    check(`🟢 "${c.title.slice(0, 12)}…" 결정적(deterministic)`,
      JSON.stringify(run(c)) === JSON.stringify(run(c)))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 이 필터가 하지 않는 것 — 🔴 발행·fetch·DB·Sheet·LLM 0')
// ─────────────────────────────────────────────────────────
{
  const BANNED: readonly (readonly [RegExp, string])[] = [
    [/PrismaClient|@prisma\/client/, 'Prisma'],
    [/googleapis|google-spreadsheet|sheets\./, 'Google Sheet'],
    [/anthropic|openai|claude-|gpt-/i, 'LLM'],
    [/playwright|chromium|puppeteer/, '브라우저'],
    [/\bfetch\s*\(|axios|node-fetch/, '네트워크'],
    [/writeFileSync|appendFileSync|createWriteStream/, '파일 쓰기'],
    [/publish|noindex|develop|배포/i, '발행·배포'],
  ]
  for (const [re, label] of BANNED) check(`🔴 ${label} 없음`, !re.test(CODE))
  // 🔴 2026-09-16 — 위기 신호 판정부를 정본 순수 모듈 하나에서 가져온다(규칙 복제 금지)
  // 🔴 한자 언어 핏 shared helper(`cjk-ideograph` — 의존 없는 순수 모듈)가 둘째다
  check('🟢 import 는 안전 신호 판정부 · 한자 helper 둘뿐이다',
    (CODE.match(/^import /gm) ?? []).length === 2
    && /from '\.\.\/\.\.\/src\/lib\/cjk-ideograph'/.test(CODE),
    `${(CODE.match(/^import /gm) ?? []).length}개`)
  check('🔴 위기 판정 규칙을 필터가 다시 쓰지 않는다', !/자살|자해/.test(CODE))
}


{
  console.log('\n🔴 ⑫ 위기 신호 — 버리지 않고 사람에게 넘긴다')
  const v = (title: string, body: string): SafetyVerdict => safetyFilter({ title, body }).verdict
  const codes = (title: string, body: string): string[] =>
    safetyFilter({ title, body }).reasons.map((r) => r.code)

  // 실측 결함(2026-09-16) — 위기 암시 글이 통과했다
  const crisis = {
    title: '오늘 아침부터 자꾸만 그런 생각이',
    body: '어제 밤은 괜찮았는데 오늘 아침 눈을 뜨자마자 그 생각이 들었다\n'
      + '친하던 친구한테 문자를 쳤다\n"갑자기 오랜만에 그런 생각이 들어\n'
      + '우리 애들 좀 봐 줄 수 있어?"\n"쓸데없는 소리하지 말고 출근이나 해"\n다들 이런 아침도 있어?',
  }
  check('🔴 위기 암시 글이 통과하지 않는다', v(crisis.title, crisis.body) !== 'pass')
  check('🔴 사유를 crisisSignal 로 적는다', codes(crisis.title, crisis.body).includes('crisisSignal'))
  check('🔴 버리지 않고 사람에게 넘긴다 (hold)', v(crisis.title, crisis.body) === 'hold')

  // 과잉 차단 금지 — 간접 표현 **하나만** 으로는 막지 않는다
  check('🟢 "그런 생각이 들었다" 단독은 막지 않는다',
    v('요즘 드는 생각', '문득 그런 생각이 들었어요. 나만 뒤처지나 싶고.') === 'pass')
  check('🟢 "아이들 좀 봐줘" 단독은 막지 않는다',
    v('급한 부탁', '내일 일이 생겨서 아이들 좀 봐 줄 수 있어? 하고 언니한테 물었어요.') === 'pass')
  check('🔴 간접 신호가 둘 이상 겹치면 막는다',
    v('요즘 마음이', '자꾸 그런 생각이 들어요. 내가 없으면 애들은 누가 챙기나 싶고.') !== 'pass')
  check('🔴 명시 표현은 하나만 있어도 막는다',
    v('힘든 밤', '요즘 살기 싫다는 마음이 들어요.') !== 'pass')
  check('🟢 갱년기 수면 경험 질문은 통과한다',
    v('갱년기 때문에 잠을 못 자는데 다들 어떤가요', '요즘 새벽에 자꾸 깨요. 다들 어떻게 지내세요?') === 'pass')
}

/**
 * ─────────────────────────────────────────────────────────
 * 🔴 ⑬ 저장 사유는 정본 `code` 만 (2026-10-10 P0)
 *
 *    세 생산 경로가 `String(사유 객체)` 로 "[object Object]" 를 저장했다(2026-09-07 부터 362행).
 *    판정기는 그 글자를 모르는 사유로 읽어 안전 pass 원천 20건까지 HOLD 했고, 실제 사유는 지워졌다.
 * ─────────────────────────────────────────────────────────
 */
{
  console.log('\n🔴 ⑬ 저장 사유 직렬화 — code 만 · 왕복 · 세 생산 경로 같은 계약')
  const NOTE = '노트원문표식XYZ http://example.com me@example.com'
  check('🟢 사유 1개 {code, note} → code 1개만',
    JSON.stringify(safetyReasonCodes([{ code: 'promotion', note: NOTE }])) === '["promotion"]')
  check('🟢 사유 여러 개 → 순서와 code 보존',
    JSON.stringify(safetyReasonCodes([{ code: 'volatile', note: 'a' }, { code: 'hostility', note: 'b' }, { code: 'access', note: 'c' }]))
      === '["volatile","hostility","access"]')
  check('🟢 빈 사유 → 빈 결과', safetyReasonCodes([]).length === 0)
  const weird: unknown[] = [{ code: '' }, { note: 'only' }, null, 7, 'promotion', { code: 'a|b' }, { code: 'x:y' }, { code: ['nested'] }, {}]
  const weirdOut = safetyReasonCodes(weird)
  check('🔴 빈 code · 문자열 아님 · 객체 아님 · 하류 구분자(| :)를 담은 code → 지어내지 않고 무효 표식(fail-closed)',
    weirdOut.length === weird.length && weirdOut.every((c) => c === INVALID_SAFETY_REASON_CODE))
  check('🔴 무효 표식은 판정기가 아는 코드가 아니다 → unknownReason(HOLD) 으로 읽힌다',
    !KNOWN_SAFETY_CODES.includes(INVALID_SAFETY_REASON_CODE)
    && JSON.stringify(readReasons(INVALID_SAFETY_REASON_CODE)) === '["unknownReason"]')
  const all = JSON.stringify([...safetyReasonCodes([{ code: 'promotion', note: NOTE }]), ...weirdOut])
  check('🔴 출력에 "[object Object]" · note · 원문 · URL · 이메일 없음',
    !all.includes('[object Object]') && !all.includes('노트원문표식') && !all.includes('http') && !all.includes('@'))

  // 🔴 실제 필터가 낸 사유 — 안전 pass 이면서 비차단 사유(volatile)가 붙는 입력도 code 를 잃지 않는다
  const real = safetyFilter({ title: '펑 할게요 남편이랑 오늘 크게 다퉜어요', body: '저녁 먹다가 말다툼이 시작됐어요. 다들 이럴 때 어떻게 하세요?' })
  const realCodes = safetyReasonCodes(real.reasons)
  check('🟢 안전 pass + 비차단 사유(volatile) → code 를 그대로 저장',
    real.verdict === 'pass' && realCodes.includes('volatile') && realCodes.length === real.reasons.length,
    `${real.verdict} ${JSON.stringify(realCodes)}`)

  // 🔴 왕복 — 생산 경로가 쓰는 thin 조립(82cook · 네이버) → adapt 상세 행 → 판정기 입력 → readReasons
  const codesIn = safetyReasonCodes([{ code: 'volatile', note: NOTE }, { code: 'hostility', note: NOTE }, { code: 'access', note: NOTE }])
  const base = {
    maskedBody: '본문 머리입니다. 사람들이 반응한 이야기예요.', bodyHeadChars: 300, axis: 'seedOriginality', safetyVerdict: 'pass',
    safetyReasons: codesIn, reason: 'ok', runId: '20261010-000000', fetchedAt: '2026-10-10T00:00:00.000Z',
  }
  const cookThin = toThinRow({ ...base, id: 'rt-1', url: '', title: '제목입니다', commentCount: 3, score: 0 })
  const cafeThin = thinRowFromCollected({
    ...base, collected: { sourceArticleId: 'rt-2', sourceSite: 'navercafe:wgang', sourceUrl: '', originalTitle: '제목입니다', sourceCommentCount: 3 },
  })
  const back = (thin: unknown): string[] => {
    const [inp] = mergeJudgeRows([{ kind: 'detail', row: toDetailRecord(thin as Parameters<typeof toDetailRecord>[0]) }])
    return readReasons(String(inp?.safetyReasons ?? ''))
  }
  const want = '["volatile","hostility","accessNotOk"]'
  check('🟢 왕복 — 82cook · 네이버 thin 이 같은 글자로 저장하고 판정기가 code 를 정확히 다시 읽는다(access → accessNotOk 는 기존 판독 규칙)',
    cookThin.safetyReasons === 'volatile|hostility|access' && cafeThin.safetyReasons === cookThin.safetyReasons
    && JSON.stringify(back(cookThin)) === want && JSON.stringify(back(cafeThin)) === want,
    `${cookThin.safetyReasons} · ${JSON.stringify(back(cookThin))}`)

  // 🔴 세 생산 경로가 같은 helper 를 부른다 — 사유 객체를 문자열로 바꾸는 다른 길이 없다
  const PRODUCERS = ['scripts/micro-seed-82cook-thin-detail.mts', 'scripts/micro-seed-collect-navercafe.mts', 'scripts/micro-seed-navercafe-thin.mts']
  const srcs = PRODUCERS.map((f) => codeOf(readFileSync(f, 'utf-8')))
  check('🔴 82cook · remonterrace/wgang 수집기 · 네이버 thin — 셋 다 safetyReasonCodes(v.safety.reasons)',
    srcs.every((s) => (s.match(/safetyReasons: safetyReasonCodes\(v\.safety\.reasons\)/g) ?? []).length === 1))
  check('🔴 셋 다 사유 객체를 String 으로 바꾸는 길이 없다',
    srcs.every((s) => !/reasons\.map\(\s*(\(x\)\s*=>\s*String\(x\)|String)\s*\)/.test(s)))
  const at = CODE.indexOf('export function safetyReasonCodes')
  check('🔴 helper 자체도 String(사유) 를 쓰지 않는다',
    at >= 0 && !/String\(r\)|map\(String\)/.test(CODE.slice(at, at + 600)))
}

/**
 * ─────────────────────────────────────────────────────────
 * 🔴 ⑫ 이 검사가 **실제로 돌고 있는가**
 *
 *    2026-09-16 실측: `micro-seed:safety-check` 는 `visibility-guard.yml` 에 없다.
 *    그래서 위 fixture 들은 **CI 에서 한 번도 돌지 않았고**, ⑥ 의 낡은 계약이
 *    실패한 채로 남아 있었다. 핵심 계약은 CI 에 있는 검사에도 함께 고정한다
 *    (`micro-seed:auto-draft-check` 의 [SG] 절) — 그래도 이 줄은 남겨 둔다.
 * ─────────────────────────────────────────────────────────
 */
{
  console.log('\n🔴 ⑫ CI 배선')
  const wf = ((): string => {
    try { return readFileSync('.github/workflows/visibility-guard.yml', 'utf-8') } catch { return '' }
  })()
  const wired = /npm run micro-seed:safety-check/.test(wf)
  if (!wired) {
    console.log('  🟡 micro-seed:safety-check 가 CI 에 배선되어 있지 않다 —'
      + ' 이 검사는 사람이 직접 돌릴 때만 돈다 (운영 판단 필요)')
  } else {
    check('🟢 micro-seed:safety-check 가 CI 에 있다', true)
  }
}

console.log(`\n${'─'.repeat(57)}`)
if (fail > 0) {
  console.log(`\n❌ ${fail}건 실패 · ${pass}건 통과\n`)
  process.exit(1)
}
console.log(`\n✅ 전부 통과 (${pass}건) — 필터는 판정만 한다. 발행하지 않는다.\n`)
