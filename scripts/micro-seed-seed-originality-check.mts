#!/usr/bin/env tsx
/**
 * Seed Originality dry-run fixture — 🔴 **네트워크·LLM 없이 계약을 검사한다**
 *
 * 🔴 이 fixture 가 막는 사고
 *    ① SEED 아닌 결정(APPROVE·HOLD·DROP·미선택)이 입력으로 새어 들어오는 것
 *    ② 원문 문장을 그대로 옮기는 것 (연속 겹침 · 낱말 유출)
 *    ③ 지역명·브랜드명·학년 표현이 초안에 남는 것
 *    ④ 분류하지 못한 행에 그럴듯한 문장을 지어내는 것
 *    ⑤ 정보글·SEO글 말투가 섞이는 것 (질문으로 끝나지 않는 초안)
 *    ⑥ 금지 호칭(시니어·어르신·노인·실버)이 들어가는 것
 *    ⑦ 산출물이 .microseed-data/ 밖으로 나가는 것
 *    ⑧ DB·Sheet·LLM·발행·네이버·82cook 이 들어오는 것
 */
import { readFileSync } from 'node:fs'
import {
  expandSeed, findMaterial, longestOverlap, tokenize, stems,
  TOPIC_RULES, TEMPLATES, TOPIC_LABEL, COMMON_WORDS,
  BANNED_HONORIFICS, MAX_SOURCE_OVERLAP, DRAFTS_PER_SOURCE, DRY_RUN_COLUMNS, DRY_RUN_NOTE,
  type TopicKey,
} from './lib/micro-seed-seed-originality.mjs'
import { seedRowsOf, readApprovals, assertInsideDataDir, toTsv, dryRunId, SEED_DATA_DIR } from './micro-seed-seed-originality-dry-run.mjs'

const LIB = readFileSync('scripts/lib/micro-seed-seed-originality.mts', 'utf-8')
const CLI = readFileSync('scripts/micro-seed-seed-originality-dry-run.mts', 'utf-8')
/** 🔴 부정 스캔 전에 주석을 지운다 — 이 저장소가 여러 번 반복한 실수다 */
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const LIB_CODE = codeOf(LIB)
const CLI_CODE = codeOf(CLI)

let pass = 0
let fail = 0
const check = (l: string, ok: boolean, why = ''): void => {
  if (ok) { pass++; console.log(`  ✅ ${l}`) } else { fail++; console.log(`  ❌ ${l}${why ? ` — ${why}` : ''}`) }
}

console.log('\nSeed Originality dry-run fixture')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 입력 — 🔴 SEED 행만 쓴다')
const rows = [
  { decision: 'APPROVE', sourceArticleId: 'a', title: '후라이팬 어때요' },
  { decision: 'SEED', sourceArticleId: 'b', title: '후라이팬 어때요' },
  { decision: 'HOLD', sourceArticleId: 'c', title: '후라이팬 어때요' },
  { decision: 'DROP', sourceArticleId: 'd', title: '후라이팬 어때요' },
  { decision: '', sourceArticleId: 'e', title: '후라이팬 어때요' },
]
check('SEED 1건만 남는다', seedRowsOf(rows).length === 1)
check('그 행이 b', seedRowsOf(rows)[0]?.sourceArticleId === 'b')
for (const d of ['APPROVE', 'HOLD', 'DROP', '']) {
  check(`🔴 ${d || '(미선택)'} 제외`, !seedRowsOf(rows).some((r) => r.decision === d))
}
check('🔴 빈 입력이면 빈 결과', seedRowsOf([]).length === 0)

console.log('\n② 소재 사전 — 🔴 일반화가 사전 구조로 이뤄진다')
check('리조트 → 숙소', findMaterial('초고 아이랑 갈만한 리조트나 호텔 추천부탁드려요').material === '숙소')
check('호텔 → 숙소', findMaterial('호텔 추천').material === '숙소')
check('펜션 → 숙소', findMaterial('펜션 어디가 좋을까요').material === '숙소')
check('맛집 → 맛집 (여행·먹거리)', findMaterial('통영분들^^ 맛집 추천 좀 부탁드려요').topic === 'travelFood')
check('프라이팬 → 후라이팬', findMaterial('프라이팬 어때요').material === '후라이팬')
check('🔴 브랜드가 붙어도 소재어만 쓴다', findMaterial('핀일로 후라이팬 어때요??').material === '후라이팬')
check('🔴 memo 를 인자로 받지 않는다 (타입에 없다)', findMaterial.length === 1, String(findMaterial.length))

console.log('\n③ 버릴 낱말 — 🔴 지역·브랜드·학년 표현')
const m1 = findMaterial('통영분들^^ 맛집 추천 좀 부탁드려요')
check('🔴 지역명이 버릴 낱말에 든다', m1.dropped.some((t) => t.includes('통영')))
const m2 = findMaterial('핀일로 후라이팬 어때요??')
check('🔴 브랜드명이 버릴 낱말에 든다', m2.dropped.some((t) => t.includes('핀일로')))
const m3 = findMaterial('초고 아이랑 갈만한 리조트나 호텔 추천부탁드려요')
check('🔴 학년 표현이 버릴 낱말에 든다', m3.dropped.includes('초고'))
check('🟡 일상어는 버리지 않는다 (아이랑)', !m3.dropped.some((t) => t.startsWith('아이')))
check('🟡 소재어 자체는 버리지 않는다', !m3.dropped.some((t) => t.includes('리조트')))

console.log('\n④ 어간 — 🔴 조사 하나만 떼면 놓친다')
check('아이랑 → 아이 후보 있음', stems('아이랑').includes('아이'))
check('가족들은 → 가족들 후보 있음', stems('가족들은').includes('가족들'))
check('원형도 후보에 남는다', stems('통영').includes('통영'))
check('1글자로 줄어드는 후보는 버린다', !stems('아이랑').includes('아'))
check('일상어 목록이 좁게 유지된다 (40개 이하)', COMMON_WORDS.length <= 40, String(COMMON_WORDS.length))
// 🔴 접미사 휴리스틱을 쓰지 않는다 — "친구"(구) · "혹시"(시) 가 걸린다.
//    큐레이트된 목록이므로 **실제 식별어 표본이 들어있지 않은지**를 직접 본다.
const IDENTIFIER_SAMPLES = ['통영', '핀일로', '초고', '강남', '제주', '스타벅스', '다이슨']
check('🔴 일상어 목록에 식별어 표본이 없다',
  !IDENTIFIER_SAMPLES.some((w) => COMMON_WORDS.includes(w)),
  IDENTIFIER_SAMPLES.filter((w) => COMMON_WORDS.includes(w)).join(','))
// 🟡 "가족 · 친구 · 여행" 은 소재어이자 일상어다. **그래도 무해하다** —
//    양쪽 다 "버리지 않는다" 로 귀결되고, 소재 탐지는 사전이 먼저 본다.
//    겹침 자체를 금지하는 대신 **탐지가 막히지 않는지**를 기능으로 확인한다.
// 🔴 '아침' 은 material 이지만 **단독으로는 일부러 안 잡는다** — "아침에 일어나기 힘드네요"
//    같은 글까지 물기 때문이다. 규칙은 아침식사·아침밥·아침에 먹 만 본다.
const STANDALONE_EXEMPT = ['아침']
const overlapWords = TOPIC_RULES.filter((r) => COMMON_WORDS.includes(r.material))
  .map((r) => r.material).filter((w) => !STANDALONE_EXEMPT.includes(w))
check(`🟡 소재어이자 일상어인 말(${overlapWords.length}개)도 소재로 잡힌다`,
  overlapWords.every((w) => findMaterial(`${w} 얘기 좀 해요`).material !== null),
  overlapWords.filter((w) => findMaterial(`${w} 얘기 좀 해요`).material === null).join(','))
check('🔴 단독 매칭을 막은 말은 실제로 안 잡힌다 (넓어지지 않게)',
  STANDALONE_EXEMPT.every((w) => findMaterial(`${w} 얘기 좀 해요`).material === null))

console.log('\n⑤ 확장 — 🔴 원문 body 없이 title·memo 만으로 동작한다')
const ex = expandSeed({ sourceArticleId: 'x', title: '핀일로 후라이팬 어때요??', memo: '살림 소재' })
check('body 를 주지 않아도 초안이 나온다', ex.drafts.length >= 2)
check(`초안 ${DRAFTS_PER_SOURCE}개`, ex.drafts.length === DRAFTS_PER_SOURCE, String(ex.drafts.length))
check('topic 이 붙는다', ex.topic === 'household')
check('🔴 브랜드명이 초안에 없다', !ex.drafts.some((d) => `${d.title}${d.body}`.includes('핀일로')))
check('🟢 소재어는 초안에 쓰인다', ex.drafts.some((d) => d.title.includes('후라이팬')))
check('🔴 유출 낱말 0', ex.drafts.every((d) => d.leakedTokens.length === 0))
check('🔴 원문 연속 겹침 6자 미만', ex.drafts.every((d) => d.overlap < MAX_SOURCE_OVERLAP))
check('🔴 금지 호칭 0', ex.drafts.every((d) => d.bannedHonorifics.length === 0))
check('🟢 safety pass', ex.drafts.every((d) => d.safety.verdict === 'pass'))
check('🟢 전부 ok', ex.drafts.every((d) => d.ok))

console.log('\n⑥ 분류 못 하면 — 🔴 지어내지 않는다')
const none = expandSeed({ sourceArticleId: 'y', title: '어제 그 일 말인데요' })
check('초안 0건', none.drafts.length === 0)
check('needsHuman 표시', none.needsHuman === true)
check('사람이 써야 한다고 말한다', none.direction.includes('사람이 직접'))
check('🔴 material 을 지어내지 않는다', none.material === null)

console.log('\n⑦ 말투 — 🔴 정보글·SEO글·뉴스글이 아니다')
const allTopics = Object.keys(TEMPLATES) as TopicKey[]
check(`토픽 ${allTopics.length}종 모두 템플릿 ${DRAFTS_PER_SOURCE}개`,
  allTopics.every((t) => TEMPLATES[t].length === DRAFTS_PER_SOURCE),
  allTopics.map((t) => `${t}=${TEMPLATES[t].length}`).join(','))
check('토픽 모두 라벨이 있다', allTopics.every((t) => (TOPIC_LABEL[t] ?? '').length > 0))
// 🔴 제목은 질문으로 끝나야 한다. 본문은 **물음표를 품기만** 하면 된다 —
//    공감형 마무리("…모르겠어요.")를 막으면 사람 말투가 아니게 된다.
const notQuestionTitle: string[] = []
const noAskBody: string[] = []
for (const t of allTopics) {
  for (const tpl of TEMPLATES[t]) {
    const title = tpl.title('소재')
    const body = tpl.body('소재')
    if (!/[?？]\s*$/.test(title.trim())) notQuestionTitle.push(`${t}:${title}`)
    if (!/[?？]/.test(body)) noAskBody.push(`${t}`)
  }
}
check('🔴 제목이 전부 질문으로 끝난다', notQuestionTitle.length === 0, notQuestionTitle.slice(0, 2).join(' / '))
check('🔴 본문이 전부 물음표를 품는다 (묻는 글이다)', noAskBody.length === 0, noAskBody.slice(0, 2).join(' / '))
const SEO_WORDS = ['총정리', 'BEST', '추천순위', 'TOP', '알아보자', '완벽 가이드', '핵심 정리']
check('🔴 SEO·정보글 상투어 없음',
  !allTopics.some((t) => TEMPLATES[t].some((tpl) =>
    SEO_WORDS.some((w) => `${tpl.title('소재')}${tpl.body('소재')}`.includes(w)))))
check('🔴 금지 호칭이 템플릿에 없음',
  !allTopics.some((t) => TEMPLATES[t].some((tpl) =>
    BANNED_HONORIFICS.some((w) => `${tpl.title('소재')}${tpl.body('소재')}`.includes(w)))))
check('🟢 모든 토픽 초안이 safety pass',
  allTopics.every((t) => expandSeed({ sourceArticleId: 'z', title: TOPIC_RULES.find((r) => r.topic === t)!.material })
    .drafts.every((d) => d.safety.verdict === 'pass')))

console.log('\n⑧ 겹침 계산')
check('완전히 다른 문장은 겹침 0~1', longestOverlap('가나다라마', '바사아자차').len === 0)
// 🔴 공백을 지우고 세므로 "후라이팬 어때요" 는 7자다
check('같은 문장은 공백 제외 길이만큼 겹친다', longestOverlap('후라이팬 어때요', '후라이팬 어때요').len === 7)
check('부분 일치를 잡는다', longestOverlap('오늘 후라이팬 샀어요', '후라이팬 어때요').len >= 4)
check('낱말 쪼개기는 2글자 이상만', !tokenize('나 는 후라이팬').includes('나'))

console.log('\n⑨ 산출물 계약')
const EXPECTED = [
  'sourceArticleId', 'sourceTitle', 'topic', 'material', 'matched', 'generalized', 'direction',
  'draftNo', 'title', 'body', 'bodyLength',
  'safetyVerdict', 'safetyReasons', 'maxOverlapWithSourceTitle', 'leakedTokens', 'ok', 'note',
  // 🔴 §4-AC 간극 보강 — 맨 뒤에만 붙었다
  'sourceSite', 'generatedAt',
]
check(`컬럼 ${EXPECTED.length}개 순서까지 같다`, DRY_RUN_COLUMNS.join('|') === EXPECTED.join('|'))
const tsv = toTsv([ex])
check('TSV 헤더가 계약과 같다', tsv.split('\n')[0] === EXPECTED.join('\t'))
check('TSV 행 수 = 초안 수', tsv.trim().split('\n').length - 1 === ex.drafts.length)
check('TSV 셀 수가 컬럼 수와 같다',
  (tsv.split('\n')[1] ?? '').split('\t').length === EXPECTED.length)
check('🔴 본문의 개행이 셀 안에서 접힌다', !(tsv.split('\n')[1] ?? '').includes('\n'))
check('🔴 모든 행에 발행 아님 문구', tsv.split('\n').slice(1).filter((l) => l.trim()).every((l) => l.includes(DRY_RUN_NOTE)))
check('발행 아님 문구가 정의돼 있다', DRY_RUN_NOTE.includes('발행 아님') && DRY_RUN_NOTE.includes('초안'))

check('🔴 앞 17개 위치는 그대로다 (뒤에만 붙었다)',
  DRY_RUN_COLUMNS.slice(0, 17).join('|') === EXPECTED.slice(0, 17).join('|')
  && DRY_RUN_COLUMNS[17] === 'sourceSite' && DRY_RUN_COLUMNS[18] === 'generatedAt')

console.log('\n⑬ 간극 3필드 중 둘 — 🔴 행마다 있어야 한다 (§4-AC ③)')
const AT = '2026-09-05T00:00:00.000Z'
const withSite = expandSeed(
  { sourceArticleId: 's1', sourceSite: 'navercafe:test', title: '핀일로 후라이팬 어때요??' }, AT)
check('🔴 expansion 에 sourceSite 가 실린다', withSite.sourceSite === 'navercafe:test')
check('🔴 모든 draft 에 generatedAt 이 실린다', withSite.drafts.every((d) => d.generatedAt === AT))
check('🔴 한 회차는 같은 시각을 공유한다',
  new Set(withSite.drafts.map((d) => d.generatedAt)).size === 1)
check('🟡 sourceSite 가 없으면 빈 문자열 (추측하지 않는다)',
  expandSeed({ sourceArticleId: 's2', title: '후라이팬' }, AT).sourceSite === '')
check('🔴 분류 못 한 행도 sourceSite 를 잃지 않는다',
  expandSeed({ sourceArticleId: 's3', sourceSite: 'navercafe:test', title: '어제 그 일' }, AT).sourceSite === 'navercafe:test')
const tsvSite = toTsv([withSite]).split('\n')
check('🔴 TSV 마지막 두 칸이 sourceSite · generatedAt',
  (tsvSite[1] ?? '').split('\t')[17] === 'navercafe:test' && (tsvSite[1] ?? '').split('\t')[18] === AT)

console.log('\n⑭ 🔴 memo 오염 차단 (2026-09-05 사고)')
// 🔴 사고: 검수 메모에 "남의 가족 사정이 있다" 고 적었더니 그 "가족" 이 소재 사전에 걸려
//    간병 글이 가족 일반론 초안 3건으로 바뀌었다. memo 는 판정 근거지 소재가 아니다.
const MEMO_FAMILY = '원문에 병원 실명과 남의 가족 사정이 있다. 소재(부모 간병)는 우리 또래 핵심이다'
type SeedRow = Parameters<typeof expandSeed>[0]
const withMemo = (o: Record<string, unknown>): SeedRow => o as unknown as SeedRow
// 🟡 사고 당시 제목이던 "간병인 추천…" 은 **이제 사전에 있어서** 정상 분류된다(2026-09-06 확장).
//    그래서 memo 오염 검사는 **여전히 소재가 없는 제목**으로 한다 — 검사의 뜻은 그대로다.
const care = expandSeed(withMemo({ sourceArticleId: 'c1', title: '어제 그 일 말인데요', memo: MEMO_FAMILY }))
check('🔴 title 에 소재가 없으면 memo 에 "가족" 이 있어도 needsHuman', care.needsHuman === true)
check('🔴 family 초안을 만들지 않는다', care.drafts.length === 0, String(care.drafts.length))
check('🔴 material 을 지어내지 않는다', care.material === null)
check('🟡 사고 당시 제목은 이제 memo 없이도 간병으로 분류된다 (사전 확장 결과)',
  expandSeed({ sourceArticleId: 'c0', title: '간병인 추천 부탁드립니다.' }).topic === 'careParent')
check('🔴 그때도 memo 의 "가족" 이 topic 을 바꾸지 않는다',
  expandSeed(withMemo({ sourceArticleId: 'c0b', title: '간병인 추천 부탁드립니다.', memo: MEMO_FAMILY })).topic === 'careParent')
for (const [w, memo] of [['여행', '여행지 맛집 소재로 확장 가능'], ['살림', '후라이팬 살림 소재'], ['가족', '가족 여행 숙소 얘기']]) {
  const e = expandSeed(withMemo({ sourceArticleId: 'c2', title: '어제 그 일 말인데요', memo }))
  check(`🔴 memo 의 "${w}" 키워드가 소재로 새지 않는다`, e.needsHuman === true && e.drafts.length === 0)
}
check('🟢 title 에 소재가 있으면 memo 와 무관하게 분류된다',
  expandSeed(withMemo({ sourceArticleId: 'c3', title: '후라이팬 어때요', memo: MEMO_FAMILY })).topic === 'household')
check('🔴 lib 코드에 memo 참조가 없다', !/\bmemo\b/.test(LIB_CODE))

console.log('\n⑮ 🔴 산출물 파일명 — 같은 날 두 번 돌려도 덮어쓰지 않는다')
const t1 = new Date('2026-09-05T13:05:38')
const t2 = new Date('2026-09-05T23:18:18')
check('runId 형식 YYYYMMDD-HHMMSS', /^\d{8}-\d{6}$/.test(dryRunId(t1)), dryRunId(t1))
check('🔴 같은 날 다른 시각 → 다른 이름', dryRunId(t1) !== dryRunId(t2), `${dryRunId(t1)} vs ${dryRunId(t2)}`)
check('🔴 날짜만 쓰던 옛 이름과 다르다', dryRunId(t1) !== '20260905')
check('🟢 이름이 시간순으로 정렬된다 (최신을 이름만으로 고른다)', dryRunId(t1) < dryRunId(t2))
check('🔴 CLI 가 날짜만 쓰는 stamp 를 더는 만들지 않는다',
  !/toISOString\(\)\.slice\(0, 10\)/.test(CLI_CODE))
check('🔴 CLI 산출물 이름이 runId 를 쓴다', /seed-originality-dry-run-\$\{runId\}/.test(CLI_CODE))
check('🔴 CLI 가 expandSeed 에 memo 를 넘기지 않는다', !/memo:\s*String\(r\.memo/.test(CLI_CODE))

console.log('\n⑯ 🔴 소재 사전 1차 확장 — 간병 · 아침 (2026-09-06)')
const care2 = expandSeed({ sourceArticleId: 'k1', sourceSite: 'navercafe:wgang', title: '간병인 추천 부탁드립니다.' })
check('🟢 간병 유형 → 초안 생성', care2.drafts.length === DRAFTS_PER_SOURCE && care2.needsHuman === false)
check('🟢 topic=careParent · 소재 간병', care2.topic === 'careParent' && care2.material === '간병')
const careText = care2.drafts.map((d) => `${d.title} ${d.body}`).join(' ')
// 🔴 원문의 병원명·입원·개인 가족 사정·추천 요청이 초안에 없어야 한다
for (const w of ['서울성모', '성모병원', '병원', '입원', '엄마가', '추천해주실', '추천 부탁']) {
  check(`🔴 간병 초안에 "${w}" 없음`, !careText.includes(w))
}
// 🔴 알선·중개로 읽히는 문장을 만들지 않는다
for (const w of ['간병인 추천', '간병인 소개', '구합니다', '알선', '중개', '연락처', '모십니다']) {
  check(`🔴 간병 초안에 알선 문구 "${w}" 없음`, !careText.includes(w))
}
// 🔴 의료 조언·치료·효능 단정을 하지 않는다
for (const w of ['치료', '완치', '효과가', '드시면 좋', '처방', '진단', '증상']) {
  check(`🔴 간병 초안에 의료 단정 "${w}" 없음`, !careText.includes(w))
}
check('🟢 간병 초안 safety pass · 유출 0 · 겹침 6자 미만',
  care2.drafts.every((d) => d.safety.verdict === 'pass' && d.leakedTokens.length === 0 && d.overlap < MAX_SOURCE_OVERLAP))

const morn = expandSeed({ sourceArticleId: 'k2', sourceSite: 'navercafe:remonterrace', title: '스벅 견과류 아침에 먹기 어때요?' })
check('🟢 아침 유형 → 초안 생성', morn.drafts.length === DRAFTS_PER_SOURCE && morn.needsHuman === false)
check('🟢 topic=morningBite · 소재 아침 (견과류 → 아침 일반화)',
  morn.topic === 'morningBite' && morn.material === '아침' && morn.matched === '견과류')
const mornText = morn.drafts.map((d) => `${d.title} ${d.body}`).join(' ')
for (const w of ['스벅', '스타벅스', '견과류']) {
  check(`🔴 아침 초안에 "${w}" 없음`, !mornText.includes(w))
}
check('🟢 아침 초안 safety pass · 유출 0 · 겹침 6자 미만',
  morn.drafts.every((d) => d.safety.verdict === 'pass' && d.leakedTokens.length === 0 && d.overlap < MAX_SOURCE_OVERLAP))

console.log('\n⑰ 🔴 확장이 넓어지지 않았나 · 회귀 없나')
// 🔴 '요양' 단독·'입원' 은 일부러 뺐다 — 요양원 홍보글과 의료 상황을 물지 않게
check('🔴 "요양원 추천해주세요" 는 간병으로 잡히지 않는다',
  expandSeed({ sourceArticleId: 'k3', title: '요양원 추천해주세요' }).topic !== 'careParent')
check('🔴 "입원했어요" 만으로는 간병이 아니다',
  expandSeed({ sourceArticleId: 'k4', title: '입원했어요' }).needsHuman === true)
check('🔴 "아침" 단독은 소재가 아니다 (너무 넓다)',
  expandSeed({ sourceArticleId: 'k5', title: '아침에 일어나기가 힘드네요' }).topic !== 'morningBite')
check('🟢 기존 3건 회귀 없음 — 맛집 · 후라이팬 · 숙소',
  [['통영분들^^ 맛집 추천 좀 부탁드려요', 'travelFood'],
   ['핀일로 후라이팬 어때요??', 'household'],
   ['초고 아이랑 갈만한 리조트나 호텔  추천부탁드려요', 'travelStay']]
    .every(([t, topic]) => {
      const e = expandSeed({ sourceArticleId: 'r', title: t })
      return e.topic === topic && e.drafts.length === DRAFTS_PER_SOURCE && e.drafts.every((d) => d.ok)
    }))
check('🔴 분류 실패는 여전히 needsHuman',
  expandSeed({ sourceArticleId: 'k6', title: '어제 그 일 말인데요' }).needsHuman === true)
check('🔴 memo 기반 분류 재발 없음 (새 축에서도)',
  expandSeed(withMemo({ sourceArticleId: 'k7', title: '어제 그 일 말인데요', memo: '간병 아침 간식 소재' })).needsHuman === true)
check(`🟢 새 토픽도 템플릿 ${DRAFTS_PER_SOURCE}개 · 제목이 질문으로 끝난다`,
  (['careParent', 'morningBite'] as TopicKey[]).every((t) =>
    TEMPLATES[t].length === DRAFTS_PER_SOURCE && TEMPLATES[t].every((tpl) => /[?？]\s*$/.test(tpl.title('소재').trim()))))
check('🟢 새 토픽 라벨·방향이 있다',
  (['careParent', 'morningBite'] as TopicKey[]).every((t) => (TOPIC_LABEL[t] ?? '').length > 0))
check('🟡 사전이 좁게 유지된다 (규칙 20개 이하)', TOPIC_RULES.length <= 20, String(TOPIC_RULES.length))

console.log('\n⑱ 🔴 원천당 초안 2개 (2026-09-06, 3개에서 줄임)')
check('DRAFTS_PER_SOURCE 는 2', DRAFTS_PER_SOURCE === 2, String(DRAFTS_PER_SOURCE))
check('🔴 모든 토픽이 정확히 2개', allTopics.every((t) => TEMPLATES[t].length === DRAFTS_PER_SOURCE))
// 🔴 실측이 있는 5개 소재 — 전부 2개씩 나와야 한다
const FIVE: [string, string][] = [
  ['통영분들^^ 맛집 추천 좀 부탁드려요', 'travelFood'],
  ['핀일로 후라이팬 어때요??', 'household'],
  ['초고 아이랑 갈만한 리조트나 호텔  추천부탁드려요', 'travelStay'],
  ['간병인 추천 부탁드립니다.', 'careParent'],
  ['스벅 견과류 아침에 먹기 어때요?', 'morningBite'],
]
for (const [title, topic] of FIVE) {
  const e = expandSeed({ sourceArticleId: 'p', sourceSite: 'navercafe:test', title })
  check(`🟢 ${topic}: 초안 ${DRAFTS_PER_SOURCE}개 · safety pass · 유출 0 · 겹침 ${MAX_SOURCE_OVERLAP}자 미만`,
    e.topic === topic && e.drafts.length === DRAFTS_PER_SOURCE
    && e.drafts.every((d) => d.safety.verdict === 'pass' && d.leakedTokens.length === 0
      && d.overlap < MAX_SOURCE_OVERLAP && d.bannedHonorifics.length === 0),
    `${e.topic}/${e.drafts.length}`)
  check(`  🔴 ${topic}: 두 초안의 제목이 서로 다르다`,
    new Set(e.drafts.map((d) => d.title)).size === DRAFTS_PER_SOURCE)
}
// 🔴 morningBite 만 3번이 아니라 2번을 뺐다 — 3번(간식)이 채택된 초안이었다
const mornKept = expandSeed({ sourceArticleId: 'p2', title: '스벅 견과류 아침에 먹기 어때요?' })
check('🔴 morningBite 는 채택됐던 "간식" 초안을 남겼다',
  mornKept.drafts.some((d) => d.title.includes('간식')), mornKept.drafts.map((d) => d.title).join(' / '))
check('🔴 morningBite 는 중복이던 "챙겨 드시는" 초안을 뺐다',
  !mornKept.drafts.some((d) => d.title.includes('챙겨 드시는')))
check('🟢 sourceSite · generatedAt 은 그대로 행마다',
  expandSeed({ sourceArticleId: 'p3', sourceSite: 'navercafe:test', title: '후라이팬 어때요' }, '2026-09-06T00:00:00.000Z')
    .drafts.every((d) => d.generatedAt === '2026-09-06T00:00:00.000Z'))
check('🟢 needsHuman 동작 유지', expandSeed({ sourceArticleId: 'p4', title: '어제 그 일 말인데요' }).needsHuman === true)

console.log('\n⑩ 경로 가드 — 🔴 .microseed-data/ 밖으로 나가지 않는다')
check(`기본 디렉터리는 ${SEED_DATA_DIR}`, SEED_DATA_DIR === '.microseed-data')
const origExit = process.exit
let exited = 0
process.exit = ((): never => { exited++; throw new Error('exit') }) as typeof process.exit
const guarded = (p: string): boolean => { try { assertInsideDataDir(p); return false } catch { return true } }
const outside = guarded('/tmp/x.json')
const inside = guarded('.microseed-data/x.json')
process.exit = origExit
check('🔴 밖은 거부', outside && exited === 1)
check('🟢 안은 통과', !inside)
check('🔴 엔트리포인트 가드가 있다', /if \(isDirectRun\) main\(\)/.test(CLI_CODE))
check('🔴 writeFileSync 는 가드 뒤에만', CLI_CODE.indexOf('assertInsideDataDir(tsvPath)') < CLI_CODE.indexOf('writeFileSync(tsvPath'))

console.log('\n⑪ 금지 경로 — 🔴 코드에 없어야 한다 (주석 제거 후)')
const BANNED: readonly (readonly [string, RegExp])[] = [
  ['prisma / DB write', /prisma|PrismaClient|\.create\(|\.upsert\(/],
  ['Google Sheet', /googleapis|spreadsheet/i],
  ['LLM 호출', /openai|anthropic|claude-|gpt-|messages\.create/i],
  ['브라우저 · live fetch', /chromium|playwright|page\.goto|newContext/],
  ['네트워크 요청', /\bfetch\(|axios|https?\.request/],
  ['자동 발행', /publishPost|publishLive|autoPublish|deployNoindex/],
  ['82cook adapter', /82cook|import82/i],
  ['Raw Vault 적재', /MicroSeedRawContent|rawVault/i],
  ['네이버 재접속', /cafe\.naver|navercafe.*live/i],
]
for (const [label, re] of BANNED) {
  check(`🔴 lib 에 ${label} 없음`, !re.test(LIB_CODE))
  check(`🔴 CLI 에 ${label} 없음`, !re.test(CLI_CODE))
}
check('🔴 lib 은 파일 I/O 를 하지 않는다', !/readFileSync|writeFileSync|node:fs/.test(LIB_CODE))

console.log('\n⑫ 실제 승인 파일이 있으면 함께 본다 (없으면 건너뛴다)')
try {
  const real = readApprovals('.microseed-data/srn-approvals-20260905.json')
  const seeds = seedRowsOf(real)
  check(`실 파일 SEED ${seeds.length}건`, seeds.length > 0)
  check('🔴 SEED 아닌 결정이 섞이지 않았다', seeds.every((r) => r.decision === 'SEED'))
  const exps = seeds.map((r) => expandSeed({
    sourceArticleId: String(r.sourceArticleId ?? ''), title: String(r.title ?? ''), memo: String(r.memo ?? ''),
  }))
  check('🔴 모든 초안 유출 0 · 겹침 6자 미만 · safety pass',
    exps.every((e) => e.drafts.every((d) => d.ok)))
  check('🔴 원문 고유명사가 초안에 없다',
    !exps.some((e) => e.drafts.some((d) => /통영|핀일로|초고/.test(`${d.title}${d.body}`))))
} catch {
  console.log('  🟡 .microseed-data/srn-approvals-20260905.json 없음 — 건너뜀')
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
