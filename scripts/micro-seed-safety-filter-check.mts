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
  safetyFilter, passesSafety, isVolatile, NOTICE_LABELS,
  type SafetyInput, type SafetyReasonCode, type SafetyVerdict,
} from './lib/micro-seed-safety-filter.mjs'
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
  for (const t of ['대선 후보 토론 보셨어요', '이재명 대통령 발언 어떻게 보세요', '의료대란 언제 끝날까요']) {
    const v = verdict({ title: t })
    check(`🔴 "${t.slice(0, 14)}…" → hardExclude`, v === 'hardExclude', `실제 ${v}`)
  }
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
  check('🟡 publicFigureMention 플래그 → hold',
    verdict({ title: '평범한 제목', qualityFlags: ['publicFigureMention'] }) === 'hold')
  check('🔴 사유 코드가 personalIdentity 다', codes({ title: '주민번호 알려달래요' }).includes('personalIdentity'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 욕설 · 혐오 · 분쟁 유도 → drop')
// ─────────────────────────────────────────────────────────
{
  for (const t of ['진짜 병신같은 상황이에요', '맘충들 때문에 못 살겠어요', '고소각인가요']) {
    const v = verdict({ title: t })
    check(`🔴 "${t.slice(0, 12)}…" → drop`, v === 'drop', `실제 ${v}`)
  }
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
  check('🟢 import 는 quality lib 하나뿐이다',
    (CODE.match(/^import /gm) ?? []).length === 1, `${(CODE.match(/^import /gm) ?? []).length}개`)
  // 🔴 100자 판정도 레인 배정도 여기서 하지 않는다
  check('🔴 100자 기준을 여기서 정하지 않는다', !/100|shortRaw|SHORT_RAW/.test(CODE))
  check('🔴 레인 이름을 여기서 배정하지 않는다',
    !/seedOriginality|rawOriginality|Short Raw Noindex/.test(CODE))
}

console.log(`\n${'─'.repeat(57)}`)
if (fail > 0) {
  console.log(`\n❌ ${fail}건 실패 · ${pass}건 통과\n`)
  process.exit(1)
}
console.log(`\n✅ 전부 통과 (${pass}건) — 필터는 판정만 한다. 발행하지 않는다.\n`)
