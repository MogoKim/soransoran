#!/usr/bin/env tsx
/**
 * 안전 · 브랜드 필터 fixture — 🔴 **판정만 검사한다. 발행하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-U ⑤ · §4-X ⑦ · §4-Y ⑤
 *
 * 🔴 이 fixture 가 막는 사고
 *    ① 정치·공지가 hold 로 새어 어딘가로 가는 것 (둘은 hardExclude 다)
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
import { findPoliticalTopicHit } from './lib/micro-seed-quality.mjs'

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
console.log('\n① 정치 — 🔴 hardExclude. 어디에도 가지 않는다')
// ─────────────────────────────────────────────────────────
{
  for (const t of ['대선 후보 토론 보셨어요', '이재명 대통령 발언 어떻게 보세요', '민주당 의료대란 책임 공방']) {
    const v = verdict({ title: t })
    check(`🔴 "${t.slice(0, 14)}…" → hardExclude`, v === 'hardExclude', `실제 ${v}`)
  }
  // 🔵 (2026-10-04 창업자 확정 · P0-3 최종) 생활 정책 낱말은 단독으로 정치 근거가 아니다 — 다른 정치 신호가 있을 때만
  check('🔵 "의료대란 언제 끝날까요" (생활 정책 낱말 단독) → 정치 아님', verdict({ title: '의료대란 언제 끝날까요' }) !== 'hardExclude')
  check('🔴 수집기 politics 판정도 hardExclude',
    verdict({ title: '평범한 제목', sourceExcludeReason: 'politics' }) === 'hardExclude')
  check('🔴 사유 코드가 politics 다', codes({ title: '대선 후보 토론 보셨어요' }).includes('politics'))
  // 🔴 보강된 정치어도 safety 에서 hardExclude 여야 한다 (PR-S2-b-34)
  for (const t of ['친윤계 갈등', '친명 후보', '내란특검', '탄핵심판']) {
    check(`🔴 보강 정치어 "${t}" → hardExclude`, verdict({ title: t }) === 'hardExclude')
  }
  for (const t of ['모친명의로 된 집', '모친명절 준비', '특검사 받았어요']) {
    check(`🟢 생활 표현 "${t.slice(0, 12)}…" 는 hardExclude 아님`, verdict({ title: t }) !== 'hardExclude')
  }
  // ─────────────────────────────────────────────────────────
  // 🔴 짧은 어휘의 일상어 충돌 (2026-09-06 실측 · 어휘 10개 정밀화)
  //
  //    `찢` 한 글자가 "바지가 찢어졌어요" 를 정치로 만들었다. 254자 생활글이
  //    실제로 그렇게 hardExclude 됐고, 4444자 글도 politics 로 잘렸다.
  //    Raw 레인은 정의상 **긴 글**을 찾는데, 본문 전체를 훑는 필터라
  //    **글이 길수록 우연히 걸릴 확률이 올라간다** — 찾는 것을 정확히 겨냥해 자르는 셈이었다.
  //
  //    🔴 정치 hard block 원칙은 그대로다. 좁힌 것은 **낱말의 모양**뿐이다.
  //       아래 두 묶음이 함께 지켜져야 한다 — 하나만 보면 반대쪽으로 넘어간다.
  // ─────────────────────────────────────────────────────────
  for (const t of [
    '바지가 찢어졌어요', '남친이랑 밥 먹었어요', '남사친이 보고싶대요', '비명을 질렀어요',
    '땅을 파면 물이 나와요', '정당한 요구예요', '수박 사왔어요', '텃밭 가꿔요',
    '험지 등반했어요', '엑셀 매크로 배웠어요', '586 컴퓨터 얘기',
  ]) {
    check(`🟢 일상 문장 "${t}" 는 politics 가 아니다`, !codes({ title: t }).includes('politics'))
  }
  for (const t of [
    '이재명 탄핵', '국민의힘 전당대회', '민주당 비명계 갈등', '친이계 인사',
    '댓글매크로 의혹', '586세대 정치인', '찢재명 논란',
    // 🔴 단독 '정당' 을 뺀 자리는 결합형이 메운다 — 띄어쓴 형태까지
    '정당 지지율 보셨어요', '정당지지율 발표', '정당 정치 얘기',
  ]) {
    check(`🔴 정치 문장 "${t}" 는 여전히 hardExclude`, verdict({ title: t }) === 'hardExclude')
  }
  // 🔴 본문에서도 같아야 한다 — 실제 사고가 본문 쪽에서 났다
  check('🟢 본문의 "찢어지게" 는 politics 가 아니다',
    !codes({ title: '병원비 이야기', body: '형편이 찢어지게 어려웠어요' }).includes('politics'))
  check('🔴 본문의 "찢재명" 은 여전히 hardExclude',
    verdict({ title: '평범한 제목', body: '찢재명 논란 얘기' }) === 'hardExclude')

  // 🔴 판정을 두 벌 만들지 않는다 — quality lib 의 matcher 하나를 쓴다 (§4-K)
  check('🔴 정치 matcher 를 재정의하지 않는다',
    !/POLITICAL_TOPIC_TERMS|const POLITICAL_TOPIC\s*=/.test(CODE))
  check('🟢 findPoliticalTopicHit 을 재사용한다', /findPoliticalTopicHit/.test(CODE))
  check('🟢 같은 matcher 가 같은 답을 낸다',
    (findPoliticalTopicHit('대선 후보 토론') !== null) === (verdict({ title: '대선 후보 토론' }) === 'hardExclude'))
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
console.log('\n④ 건강 — 🔴 주제는 막지 않는다. 단정·시술을 막는다 (§4-J)')
// ─────────────────────────────────────────────────────────
{
  // 🟢 경험담 · 생활관리 질문은 통과
  for (const t of [
    '당뇨 관리 어떻게들 하세요', '갱년기 불면증 어떻게 버티세요',
    '혈압약 드시는 분 경험 궁금해요', '질유산균 뭐 드세요??',
    '무릎 관절 아픈데 다들 어떠세요',
  ]) {
    const v = verdict({ title: t })
    check(`🟢 "${t.slice(0, 14)}…" 는 건강 주제라고 제외되지 않는다`, v === 'pass', `실제 ${v}`)
  }
  // 🟡 처방 · 치료 선택 · 효능 단정 · 시술 유도는 hold
  for (const t of [
    '도수치료 받아보신 분 어떤가요', '레이저 시술 추천해주세요',
    '이 약 처방 받아도 될까요', '이거 먹으면 완치된대요',
    '부작용 없고 효과 직빵이에요',
  ]) {
    const v = verdict({ title: t })
    check(`🟡 "${t.slice(0, 14)}…" → hold`, v === 'hold', `실제 ${v}`)
  }
  check('🔴 사유 코드가 medicalClaim 이다', codes({ title: '도수치료 받아보신 분' }).includes('medicalClaim'))
  check('🔴 건강 주제 자체를 막는 어휘가 없다',
    !/당뇨|갱년기|혈압|관절|유산균/.test(CODE.replace(/MEDICAL_CLAIM[\s\S]{0,400}?\//, '')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 광고 · 홍보 → hold')
// ─────────────────────────────────────────────────────────
{
  for (const t of ['협찬 받아서 써봤어요', '공동구매 진행합니다', '할인코드 드려요', '카톡 문의 주세요', '체험단 모집합니다']) {
    const v = verdict({ title: t })
    check(`🟡 "${t.slice(0, 12)}…" → hold`, v === 'hold', `실제 ${v}`)
  }
  check('🟡 댓글에 광고가 있어도 잡는다',
    verdict({ title: '정수기 추천해주세요', comments: ['공동구매 링크 타고 들어오세요'] }) === 'hold')
  check('🟢 평범한 제품 추천은 통과', verdict({ title: '캡슐커피머신 추천해주세요' }) === 'pass')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 실명 · 개인정보 → hold')
// ─────────────────────────────────────────────────────────
{
  check('🟡 주민번호 언급 → hold', verdict({ title: '주민번호 알려달래요' }) === 'hold')
  check('🟡 계좌번호 언급 → hold', verdict({ title: '계좌번호 보내라는데' }) === 'hold')
  check('🟡 신상 털기 → hold', verdict({ title: '신상 털어서 올렸더라구요' }) === 'hold')
  /**
   * 🔴 **공개 인물 언급은 위해가 아니라 소재다** (2026-09-13 정정).
   *    필터는 그때 `publicFigure` · `publicFigureMention` 을 사유에서 뺐는데
   *    이 fixture 만 옛 계약을 그대로 들고 있었다 — 그래서 **2026-09-16 현재까지
   *    이 검사는 1건 실패 상태로 서 있었다.** 아무도 못 본 이유는 아래 ⑫ 에 적는다.
   */
  check('🟢 publicFigureMention 플래그만으로는 막지 않는다 — 위해가 아니라 소재다',
    verdict({ title: '평범한 제목', qualityFlags: ['publicFigureMention'] }) === 'pass')
  check('🔴 사유 코드가 personalIdentity 다', codes({ title: '주민번호 알려달래요' }).includes('personalIdentity'))
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
  // 🔴 (2026-10-04 P0-3) 정치 사유 이름 정본(`political-flags` — 의존 없는 순수 이름 모듈)이 셋째다
  // 🔴 (P0-3 최종) 한자 언어 핏 shared helper(`cjk-ideograph` — 의존 없는 순수 모듈)가 넷째다
  check('🟢 import 는 quality lib · 안전 신호 판정부 · 정치 사유 이름 · 한자 helper 넷뿐이다',
    (CODE.match(/^import /gm) ?? []).length === 4 && /from '\.\.\/\.\.\/src\/lib\/political-flags'/.test(CODE)
    && /from '\.\.\/\.\.\/src\/lib\/cjk-ideograph'/.test(CODE),
    `${(CODE.match(/^import /gm) ?? []).length}개`)
  check('🔴 위기·의료 판정 규칙을 필터가 다시 쓰지 않는다',
    !/자살|자해|미레나|무리가 ?없/.test(CODE))
  // 🔴 100자 판정도 레인 배정도 여기서 하지 않는다
  check('🔴 100자 기준을 여기서 정하지 않는다', !/100|shortRaw|SHORT_RAW/.test(CODE))
  check('🔴 레인 이름을 여기서 배정하지 않는다',
    !/seedOriginality|rawOriginality|Short Raw Noindex/.test(CODE))
}


/**
 * ─────────────────────────────────────────────────────────
 * 🔴 ⑨⑩⑪ 위기 신호 · 의료 판단 요청 · 건강 효능 주장 (2026-09-16 실측)
 *
 *    정본 §4 는 자해·자살을 **생성 전 선행 차단**(`crisis_hold`)으로 못박았는데
 *    코드에는 그 축이 한 줄도 없었다. 아래 세 글이 `verdict=pass` 로 통과했다.
 * ─────────────────────────────────────────────────────────
 */
{
  console.log('\n🔴 ⑨⑩⑪ 위기 신호 · 의료 판단 요청 · 건강 효능 주장')
  const v = (title: string, body: string): SafetyVerdict => safetyFilter({ title, body }).verdict
  const codes = (title: string, body: string): string[] =>
    safetyFilter({ title, body }).reasons.map((r) => r.code)

  // ① 🔴 실측 결함 — 위기 암시 글이 통과했다
  const crisis = {
    title: '오늘 아침부터 자꾸만 그런 생각이',
    body: '어제 밤은 괜찮았는데 오늘 아침 눈을 뜨자마자 그 생각이 들었다\n'
      + '친하던 친구한테 문자를 쳤다\n"갑자기 오랜만에 그런 생각이 들어\n'
      + '우리 애들 좀 봐 줄 수 있어?"\n"쓸데없는 소리하지 말고 출근이나 해"\n다들 이런 아침도 있어?',
  }
  check('🔴 위기 암시 글이 통과하지 않는다', v(crisis.title, crisis.body) !== 'pass')
  check('🔴 사유를 crisisSignal 로 적는다', codes(crisis.title, crisis.body).includes('crisisSignal'))
  check('🔴 버리지 않고 사람에게 넘긴다 (hold)', v(crisis.title, crisis.body) === 'hold')

  // ② 🔴 과잉 차단 금지 — 간접 표현 **하나만** 으로는 막지 않는다
  check('🟢 "그런 생각이 들었다" 단독은 막지 않는다',
    v('요즘 드는 생각', '문득 그런 생각이 들었어요. 나만 뒤처지나 싶고.') === 'pass')
  check('🟢 "아이들 좀 봐줘" 단독은 막지 않는다',
    v('급한 부탁', '내일 일이 생겨서 아이들 좀 봐 줄 수 있어? 하고 언니한테 물었어요.') === 'pass')
  check('🔴 간접 신호가 둘 이상 겹치면 막는다',
    v('요즘 마음이', '자꾸 그런 생각이 들어요. 내가 없으면 애들은 누가 챙기나 싶고.') !== 'pass')
  check('🔴 명시 표현은 하나만 있어도 막는다',
    v('힘든 밤', '요즘 살기 싫다는 마음이 들어요.') !== 'pass')

  // ③ 🔴 실측 결함 — 의료 판단 요청이 통과했다
  const med = {
    title: '미레나 5년 채워야 한다고들 하는데, 진짜 그럼?',
    body: '2022년에 미레나 했어요. 다만 냉 분비물이 많아졌어요. 미레나 부작용일 수도 있겠다는 '
      + '생각은 들고요. 내년이면 딱 5년이 차는데 다들 5년 되면 꼭 교체해야 한다고 하더라고요. '
      + '계속 써도 괜찮은 건 아닐까요?',
  }
  check('🔴 부작용·교체·계속 사용 판단 요청은 HOLD', v(med.title, med.body) === 'hold')
  check('🔴 사유를 medicalDecisionRequest 로 적는다',
    codes(med.title, med.body).includes('medicalDecisionRequest'))

  // ④ 🔴 실측 결함 — 전언형 효능 주장이 통과했다
  const eff = {
    title: '무릎 안 아프고 숨 안 차는 운동 찾다가',
    body: '걸음으로 뛰니까 무릎에 무리가 없다고 하고, 숨도 그렇게 차지 않으면서 운동 효과는 본다고.',
  }
  check('🔴 전언형이어도 건강 효능 주장은 HOLD', v(eff.title, eff.body) === 'hold')
  check('🔴 사유를 healthEfficacyClaim 으로 적는다',
    codes(eff.title, eff.body).includes('healthEfficacyClaim'))

  /**
   * ⑤ 🔴 **소재를 막지 않는다** (§4-J). 갱년기 · 병원 경험 · 영양제 습관 ·
   *    예방 관리는 타겟 핏이 높은 생활 주제다. 여기가 닫히면 쓸 글이 없다.
   */
  check('🟢 갱년기 수면 경험 질문은 통과한다',
    v('갱년기 때문에 잠을 못 자는데 다들 어떤가요', '요즘 새벽에 자꾸 깨요. 다들 어떻게 지내세요?') === 'pass')
  check('🟢 스케일링 주기 질문은 기존 정본대로 통과한다',
    v('스케일링 몇 년에 한 번 받으세요?', '저는 작년에 받고 아직인데 다들 주기가 어떻게 되세요?') === 'pass')
  check('🟢 영양제 챙기는 습관 질문은 통과한다',
    v('영양제 챙겨 먹는 게 진짜 어렵네',
      '요즘 아침에 비타민 B, 루테인, 칼슘 이렇게 세 가지를 먹으려고 하는데 계속 까먹어요. '
      + '약통에 다 담아 놨는데도 자꾸 건너뛰게 되고. 다른 분들은 어떻게 습관 들이셨어요?') === 'pass')
  check('🟢 병원에 다녀온 경험 자체는 통과한다',
    v('건강검진 다녀왔어요', '아침 일찍 병원 가서 검진 받고 왔어요. 사람이 참 많더라고요.') === 'pass')
  // 🔴 제품명만 나오고 판단을 묻지 않으면 오탐이다
  check('🟢 의료 제품명만 등장하면 막지 않는다',
    v('친구가 미레나 했대요', '오랜만에 만난 친구가 미레나 했다고 하더라고요. 요즘 다들 그러나 봐요.') === 'pass')
  check('🟢 건강 대상어만 있고 효능 주장이 없으면 막지 않는다',
    v('무릎이 시큰거려요', '계단 내려올 때 무릎이 좀 시큰해요. 다들 어떠세요?') === 'pass')

  /**
   * ⑥ 🔴 **대상과 판단·효능 표현의 문장 관계를 본다** (2026-09-16 정정).
   *    낱말이 글 어딘가에 있다는 것만으로는 세지 않는다 —
   *    그러면 겪은 이야기와 무관한 문장까지 막힌다.
   */
  check('🟢 부작용 때문에 병원에 간 **경험담**은 판단 요청이 아니다',
    v('병원 다녀왔어요', '미레나 부작용 때문에 병원에 갔어요. 의사에게 설명 듣고 왔습니다.') === 'pass')
  check('🟢 건강 대상어와 무관한 문장의 "좋아져" 는 효능 주장이 아니다',
    v('무릎이 시큰거려요', '무릎이 시큰거려요. 그런데 날씨는 좋아져서 창문을 열었어요.') === 'pass')
  // 🔴 그렇다고 모든 부작용 경험을 허용하지도, 모든 건강 소재를 막지도 않는다
  check('🔴 같은 문장에서 판단을 물으면 그대로 막는다',
    v('인공관절 수술 얘기', '작년에 인공관절 수술 받았는데요. 계속 써도 괜찮을까요?') === 'hold')
  check('🔴 같은 문장의 효능 단정은 그대로 막는다',
    v('혈압에 좋다는 차', '이 차 마시면 혈압이 좋아진다고 하더라고요.') === 'hold')
  /**
   * 🔴 수술 **경험담**은 새 축(판단 요청)이 잡지 않는다.
   *    다만 기존 ④ `medicalClaim` 이 `수술 받` 을 이미 hold 로 본다 — 그것은 별개 축이고
   *    이 PR 이 바꾸지 않았다. 여기서는 **새 축이 더해지지 않았다**는 것만 확인한다.
   */
  check('🟢 수술 경험담에 새 축(판단 요청·효능 주장)이 붙지 않는다', (() => {
    const c = codes('인공관절 수술 받았어요', '작년에 수술 받고 재활 중이에요. 요즘 걷기 좋네요.')
    return !c.includes('medicalDecisionRequest') && !c.includes('healthEfficacyClaim')
  })())
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
