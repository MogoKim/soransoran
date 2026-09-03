#!/usr/bin/env tsx
/**
 * scout 점수 계약 fixture — 🔴 브라우저 · 네트워크 · DB 없음 (PR-S2-b-11)
 *
 * 🔴 여기서 막는 사고
 *   ① hard exclude 된 행이 상위 후보에 섞이는 것
 *   ② 정규화 없이 절대 댓글수로만 줄 세우는 것 (= source-first 로 되돌아감)
 *   ③ 오래된 글이 절대 댓글수만으로 이기는 것
 *   ④ 댓글수를 못 읽은 행을 "댓글 0" 과 같이 취급하는 것
 *   ⑤ dry-run 이 live 크롤 · DB · Sheet 경로를 갖는 것
 *   ⑥ threshold 를 운영값으로 확정하는 것
 *
 * 사용법: npx tsx scripts/micro-seed-scout-score-check.mts
 */
import { readFileSync } from 'node:fs'
import {
  gateOf, scoreRows, rankShift, percentileIn, velocityOf, freshnessOf,
  groupKeyOf, topicHits, conversationHits, WEIGHTS, HOLD_FLAGS,
  toArticles, articleKeyOf,
  type ScoutRow,
} from './lib/micro-seed-scout-score.mjs'

let failed = 0
const ok = (l: string) => console.log(`  ✅ ${l}`)
const bad = (l: string, d: string) => { console.error(`  ❌ ${l}\n     ${d}`); failed += 1 }
const check = (l: string, c: boolean, d = '') => (c ? ok(l) : bad(l, d))

const RUNNER = readFileSync('scripts/micro-seed-score-scout-dry-run.mts', 'utf-8')
const LIB = readFileSync('scripts/lib/micro-seed-scout-score.mts', 'utf-8')
/** 🔴 부정 스캔은 주석을 걷어낸 코드에만 건다 — 이 저장소가 반복한 실수다 */
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const RUNNER_CODE = codeOf(RUNNER)
const LIB_CODE = codeOf(LIB)

const row = (o: Partial<ScoutRow>): ScoutRow => ({
  sourceSite: 'navercafe:remonterrace',
  sourceArticleId: '1',
  originalTitle: '오늘 저녁 뭐 먹을까요',
  sourceBoardName: '쫑알쫑알 게시판',
  sourceCommentCount: 5,
  sourceCommentCountRead: true,
  sourceViewCount: 100,
  sourceListedAt: '2026-09-03T07:00:00.000Z',
  sourcePostedAt: '2026-09-03T06:00:00.000Z',
  sourcePage: 2,
  sourceRankOnPage: 1,
  sourceRunId: '20260903-160000',
  sourceBoardKey: 'remonterrace:jjong',
  sourceExcludeReason: null,
  qualityFlags: [],
  ...o,
})

console.log('\nscout 점수 계약 fixture\n')

// ─────────────────────────────────────────────────────────
console.log('① 게이트 — 🔴 점수보다 먼저다')
// ─────────────────────────────────────────────────────────
check('politics → excluded', gateOf(row({ sourceExcludeReason: 'politics' })).verdict === 'excluded')
check('pinned → excluded', gateOf(row({ sourceExcludeReason: 'pinned' })).verdict === 'excluded')
check('publicFigure → excluded', gateOf(row({ sourceExcludeReason: 'publicFigure' })).verdict === 'excluded')
check('medicalOrAdLikely → hold', gateOf(row({ qualityFlags: ['medicalOrAdLikely'] })).verdict === 'hold')
check('publicFigureMention → hold', gateOf(row({ qualityFlags: ['publicFigureMention'] })).verdict === 'hold')
check('그 외 → candidate', gateOf(row({ qualityFlags: ['lowEngagement'] })).verdict === 'candidate')
check('사유가 남는다', gateOf(row({ sourceExcludeReason: 'politics' })).reason === 'politics')
check('🔴 판정을 다시 만들지 않고 sourceExcludeReason 을 쓴다',
  /row\.sourceExcludeReason === 'politics'/.test(LIB_CODE) && !/judgePoliticsTitle/.test(LIB_CODE),
  '두 곳에서 판정하면 언젠가 갈라진다 (PR-S2-b-8 이 하나로 합친 이유)')
check('hold 플래그가 둘이다', HOLD_FLAGS.length === 2)

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 제외·보류가 상위 후보에 섞이지 않는다')
// ─────────────────────────────────────────────────────────
{
  const rows = [
    // 🔴 공지는 조회수가 압도적이다(실측 중앙 2,111 vs 321). 점수제면 이겼을 값
    row({ sourceArticleId: 'pin', sourceExcludeReason: 'pinned', sourceCommentCount: 500, sourceViewCount: 99999 }),
    row({ sourceArticleId: 'pol', sourceExcludeReason: 'politics', sourceCommentCount: 400, sourceViewCount: 9999 }),
    row({ sourceArticleId: 'pf', sourceExcludeReason: 'publicFigure', sourceCommentCount: 300, sourceViewCount: 8888 }),
    row({ sourceArticleId: 'med', qualityFlags: ['medicalOrAdLikely'], sourceCommentCount: 200, sourceViewCount: 7777 }),
    row({ sourceArticleId: 'ok1', sourceCommentCount: 10, sourceViewCount: 200 }),
    row({ sourceArticleId: 'ok2', sourceCommentCount: 2, sourceViewCount: 50 }),
  ]
  const { scored, excluded, held } = scoreRows(rows)
  const ids = scored.map((s) => s.row.sourceArticleId)
  check('후보는 둘뿐', scored.length === 2 && excluded.length === 3 && held.length === 1)
  check('🔴 pinned · politics · publicFigure 가 후보에 없다',
    !ids.includes('pin') && !ids.includes('pol') && !ids.includes('pf'),
    '공지는 조회수가 7배라 점수제였다면 상위를 먹었을 것이다')
  check('🔴 hold 도 후보에 없다', !ids.includes('med'))
  check('🔴 0점을 주는 것이 아니라 집합에서 빠진다',
    !/score: \{ *engagement: 0/.test(LIB_CODE) && /candidates\.map\(build\)/.test(LIB_CODE),
    '0점을 주면 언젠가 "0점도 후보" 가 된다')
  check('정규화 모집단이 후보뿐이다',
    /for \(const g of candidates\)/.test(LIB_CODE),
    '제외된 행을 넣으면 백분위가 통째로 눌린다 (PR-S2-b-9 착시와 같은 실수)')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ source normalization — 🔴 절대값으로 줄 세우지 않는다')
// ─────────────────────────────────────────────────────────
check('백분위 계산', percentileIn([1, 2, 3, 4], 3) === 0.625)
check('동점은 같은 값', percentileIn([5, 5, 5], 5) === 0.5)
check('🔴 표본 1건이면 0.5 (최상위를 주지 않는다)',
  percentileIn([7], 7) === 0.5,
  '1.0 을 주면 표본 1건짜리 소스가 최상위를 먹는다')
check('빈 배열은 0', percentileIn([], 3) === 0)
check('그룹 키가 run + board 다',
  groupKeyOf(row({ sourceRunId: 'R1', sourceBoardKey: 'B1' })) === 'R1|B1'
    && groupKeyOf(row({ sourceRunId: 'R1', sourceBoardKey: null })) === 'R1|navercafe:remonterrace')
check('🔴 run 이 다르면 다른 그룹',
  groupKeyOf(row({ sourceRunId: 'R1' })) !== groupKeyOf(row({ sourceRunId: 'R2' })),
  'run 이 다르면 시간대가 다르다 — 섞으면 정규화가 무의미해진다')
{
  // 활동량이 다른 두 소스: A 는 댓글이 크고 B 는 작다.
  // 🔴 절대값이면 A 가 독식한다. 정규화하면 각 그룹의 상위가 함께 올라와야 한다.
  const busy = [40, 60, 80, 100].map((c, i) =>
    row({ sourceArticleId: `a${i}`, sourceRunId: 'R', sourceBoardKey: 'busy', sourceCommentCount: c, sourceViewCount: c * 10 }))
  const quiet = [1, 2, 3, 20].map((c, i) =>
    row({ sourceArticleId: `b${i}`, sourceRunId: 'R', sourceBoardKey: 'quiet', sourceCommentCount: c, sourceViewCount: c * 10 }))
  const { scored } = scoreRows([...busy, ...quiet])
  const top4 = scored.slice(0, 4).map((s) => s.row.sourceBoardKey)
  check('🔴 활동량 많은 소스가 상위를 독식하지 않는다',
    top4.includes('quiet'),
    `상위 4: ${top4.join(',')} — 절대 임계값으로 자르면 활동량 많은 소스가 후보를 독식하고 source-first 로 되돌아간다`)
  const rs = rankShift(scored)
  check('🔴 정규화가 순위를 실제로 바꾼다',
    rs.moved > 0,
    '이동이 0 이면 정규화가 아무 일도 안 한 것이고, 그건 곧 단순 댓글수 정렬이다')
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 화제성 · 신선도 — 🔴 오래된 글이 절대수로 이기지 않는다')
// ─────────────────────────────────────────────────────────
check('속도 = 시간당 댓글', velocityOf(10, 60) === 10 && velocityOf(10, 120) === 5)
check('lag 을 모르면 속도 0', velocityOf(10, null) === 0)
check('lag 0 이하면 속도 0 (0으로 나누지 않는다)', velocityOf(10, 0) === 0 && velocityOf(10, -5) === 0)
check('신선도는 시간이 갈수록 준다', freshnessOf(0) === 1 && freshnessOf(360) === 0.5 && freshnessOf(720) === 0)
check('12시간 넘으면 0', freshnessOf(1000) === 0)
check('🔴 음수 lag(이상치)를 보상하지 않는다', freshnessOf(-100) === 0)
check('lag 모르면 신선도 0', freshnessOf(null) === 0)
{
  const old = row({ sourceArticleId: 'old', sourceCommentCount: 30, sourceViewCount: 300, sourcePostedAt: '2026-09-02T19:00:00.000Z' })
  const fresh = row({ sourceArticleId: 'new', sourceCommentCount: 25, sourceViewCount: 280, sourcePostedAt: '2026-09-03T06:30:00.000Z' })
  const { scored } = scoreRows([old, fresh])
  check('🔴 댓글이 적어도 반응이 빠른 글이 이길 수 있다',
    scored[0].row.sourceArticleId === 'new',
    `받은 순서: ${scored.map((s) => s.row.sourceArticleId).join(',')} — 절대 댓글수만 보면 오래된 글이 유리해진다`)
}
{
  const read = row({ sourceArticleId: 'r', sourceCommentCount: 20, sourceCommentCountRead: true })
  const unread = row({ sourceArticleId: 'u', sourceCommentCount: 20, sourceCommentCountRead: false })
  const { scored } = scoreRows([read, unread])
  check('🔴 댓글수를 못 읽은 행은 화제성을 깎는다',
    scored[0].row.sourceArticleId === 'r',
    '"댓글 0" 과 "못 읽었다" 는 다른 사실이다 (PR-S2-b-6)')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 타겟 핏 · 대화 가능성 · watch')
// ─────────────────────────────────────────────────────────
check('갱년기·몸 축', topicHits('요즘 갱년기라 잠을 못 자요', '').some((t) => t.label === '몸·갱년기'))
check('가족 축', topicHits('남편이랑 또 싸웠어요', '').some((t) => t.label === '가족'))
check('돈·노후 축', topicHits('노후 생활비 얼마나 드나요', '').some((t) => t.label === '돈·노후'))
check('게시판명도 본다', topicHits('제목', '갱년기 몸 증상').length > 0)
check('무관한 제목은 0', topicHits('ㅋㅋㅋ', '자유 주제').length === 0)
// 🔴 LIB 원문에 걸면 **금지를 설명하는 주석**이 잡힌다 — codeOf 를 지나야 한다.
//    이 저장소의 fixture 가 같은 실수를 여러 번 반복했다.
check('🔴 금지 어휘를 쓰지 않는다',
  !/시니어|어르신|노인|실버/.test(LIB_CODE),
  'CLAUDE.md 브랜드 규칙 — 대체 표현은 "우리 나이" · "40대 중반~60대 중반 여성"')
check('질문형', conversationHits('이거 어떻게 하나요?').some((c) => c.label === '질문'))
check('고민형', conversationHits('요즘 너무 힘들어요').some((c) => c.label === '고민'))
check('공감형', conversationHits('저만 그런가요 다들').some((c) => c.label === '공감'))
check('경험형', conversationHits('어제 다녀왔어요 후기').some((c) => c.label === '경험'))
{
  const { scored } = scoreRows([
    row({ sourceArticleId: 'w', sourceCommentCount: 1, sourcePostedAt: '2026-09-03T06:30:00.000Z' }),
    row({ sourceArticleId: 'o', sourceCommentCount: 1, sourcePostedAt: '2026-09-02T20:00:00.000Z' }),
    row({ sourceArticleId: 'z', sourceCommentCount: 0, sourcePostedAt: '2026-09-03T06:50:00.000Z' }),
  ])
  const w = new Map(scored.map((s) => [s.row.sourceArticleId, s.watch]))
  check('🔴 어린 글은 watch (다음 scout 에서 다시 본다)', w.get('w') === true)
  check('오래된 글은 watch 아님', w.get('o') === false)
  check('댓글 0 은 watch 아님', w.get('z') === false)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ dry-run — 🔴 read-only. 비용을 태우지 않는다')
// ─────────────────────────────────────────────────────────
for (const [label, code] of [['lib', LIB_CODE], ['runner', RUNNER_CODE]] as const) {
  check(`[${label}] 🔴 prisma 를 부르지 않는다`, !/prisma|PrismaClient/.test(code))
  check(`[${label}] 🔴 브라우저를 열지 않는다`, !/(playwright|chromium|\$\$eval|page\.goto)/.test(code))
  check(`[${label}] 🔴 Sheet · Candidate · Post · Queue 접근 0`,
    !/(googleapis|sheets\.|MicroSeedCandidate|MicroSeedRawContent|OriginalPostApprovalQueue)/.test(code))
  check(`[${label}] 🔴 파일을 쓰지 않는다`, !/(writeFileSync|appendFileSync|mkdirSync|unlinkSync)/.test(code))
}
check('🔴 runner 가 읽기만 한다', /readFileSync|readdirSync/.test(RUNNER_CODE))
// 🔴 PR-S2-b-11 보정에서 --show-title 이 생겼다. "절대 미출력" 은 더 이상 사실이 아니다 —
//    단정을 **"기본 미출력 + 옵션 안에서만"** 으로 옮긴다. 상세 검사는 ⑩ 이 한다.
//    약화가 아니라 축의 이동이다: 옵션 밖 참조가 하나라도 있으면 실패한다.
check('🔴 제목을 기본으로 출력하지 않는다 (옵션 밖 참조 0)',
  RUNNER_CODE.split('if (SHOW_TITLE)').filter((chunk, i) => i === 0 && /originalTitle/.test(chunk)).length === 0,
  '기본 실행은 매칭 라벨과 백분위만 찍는다')
check('추가 크롤 비용 0 임을 명시한다', /추가 크롤 비용 0/.test(RUNNER))

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 확정하지 않은 것들이 확정되지 않았는지')
// ─────────────────────────────────────────────────────────
check('가중치 합이 100', WEIGHTS.engagement + WEIGHTS.targetFit + WEIGHTS.conversation + WEIGHTS.freshness === 100)
check('🔴 가중치가 초안이라고 적혀 있다', /가중치는 \*\*초안\*\*이다|확정값이 아니다/.test(LIB))
check('🔴 threshold 운영값을 정하지 않았다',
  !/THRESHOLD_CANDIDATES/.test(LIB_CODE) && !/THRESHOLD_CANDIDATES/.test(RUNNER_CODE),
  'threshold A/B 는 scoring input 후보다 — 이 도구가 그것을 운영값으로 승격시키지 않는다')
check('🔴 자동 상세 fetch 기준을 만들지 않았다',
  !/autoFetch|shouldFetch|planAutoFetch/.test(RUNNER_CODE) && !/autoFetch|shouldFetch/.test(LIB_CODE))
check('🔴 소스 우열 결론을 내리지 않는다',
  /소스 우열이 아니라/.test(RUNNER) && /이 소스가 낫다" 로 읽지 않는다/.test(RUNNER),
  'post-score-first — 판단 단위는 게시글 1개다 (§4-F)')
check('🔴 구 데이터를 제외하고 건수를 보고한다',
  /sourceRunId/.test(RUNNER_CODE) && /구 데이터 제외/.test(RUNNER))

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 판단 단위는 row 가 아니라 게시글 1개다 (PR-S2-b-11 보정)')
// ─────────────────────────────────────────────────────────
{
  const obs = (run: string, listed: string, c: number, v: number) =>
    row({ sourceArticleId: 'A', sourceRunId: run, sourceListedAt: listed, sourceCommentCount: c, sourceViewCount: v })
  const rows = [
    obs('R1', '2026-09-03T05:00:00.000Z', 3, 100),
    obs('R3', '2026-09-03T09:00:00.000Z', 12, 400),   // 🔴 최신 (시각 기준)
    obs('R2', '2026-09-03T07:00:00.000Z', 7, 250),
    row({ sourceArticleId: 'B', sourceRunId: 'R1', sourceCommentCount: 5, sourceViewCount: 120 }),
  ]
  const arts = toArticles(rows)
  check('관측 4행 → 고유 글 2건', arts.length === 2)
  const a = arts.find((x) => x.latest.sourceArticleId === 'A')!
  check('🔴 최신 관측을 대표로 쓴다 (listedAt 기준)',
    a.latest.sourceRunId === 'R3' && a.latest.sourceCommentCount === 12,
    'runId 문자열 정렬은 자릿수가 바뀌면 깨진다 — 시각으로 정렬한다')
  check('seenCount', a.seenCount === 3)
  check('firstRunId · lastRunId', a.firstRunId === 'R1' && a.lastRunId === 'R3')
  check('🔴 commentDelta 는 첫 관측 대비 증가분', a.commentDelta === 9)
  check('🔴 viewDelta 도 계산된다', a.viewDelta === 300)
  check('1회만 본 글은 delta 0', arts.find((x) => x.latest.sourceArticleId === 'B')!.commentDelta === 0)
  check('조회수를 못 읽었으면 viewDelta 는 null',
    toArticles([row({ sourceArticleId: 'C', sourceViewCount: null }), row({ sourceArticleId: 'C', sourceListedAt: '2026-09-03T08:00:00.000Z' })])[0].viewDelta === null,
    '미지값을 0 으로 뭉개지 않는다')
  check('카페가 다르면 같은 articleId 도 별개',
    toArticles([row({ sourceArticleId: 'X' }), row({ sourceArticleId: 'X', sourceSite: 'navercafe:wgang' })]).length === 2,
    '네이버 articleId 는 카페 안에서만 유일하다')
  check('articleKeyOf 가 site + id', articleKeyOf(row({ sourceArticleId: '9' })) === 'navercafe:remonterrace|9')

  // 🔴 top 에 같은 글이 두 번 나오면 안 된다
  const { scored } = scoreRows(rows)
  const ids = scored.map((s) => s.row.sourceArticleId)
  check('🔴 top 에 같은 articleId 가 중복되지 않는다',
    ids.length === new Set(ids).size && ids.length === 2,
    `받은 값: ${ids.join(',')} — 실측 611 관측에 중복 49건이 있었다`)
  check('점수 행이 관측 이력을 들고 있다',
    scored.every((s) => s.obs.seenCount >= 1 && s.obs.latest === s.row))
  check('여러 번 본 글은 why 에 증가분이 붙는다',
    /관측 3회 · 댓글 \+9/.test(scored.find((s) => s.row.sourceArticleId === 'A')!.why))
  check('🔴 scoreRows 가 먼저 article 로 접는다',
    /const articles = toArticles\(rows\)/.test(LIB_CODE),
    '접지 않으면 top 에 같은 글이 중복으로 올라온다')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 비용 요약 — 🔴 절감률 분모는 고유 글이다')
// ─────────────────────────────────────────────────────────
check('observation rows 와 unique articles 를 나눠 찍는다',
  /observation rows/.test(RUNNER) && /unique articles/.test(RUNNER))
check('🔴 절감률 분모가 uniq 다',
  /\(\(uniq - top\.length\) \/ uniq\)/.test(RUNNER_CODE)
    && !/\(\(total - top\.length\) \/ total\)/.test(RUNNER_CODE),
  'row 기준으로 세면 같은 글을 여러 번 센 값이라 과장된다')
check('row 기준 수치가 과장임을 명시한다', /과장이다/.test(RUNNER))
check('watch·후보도 고유 글 기준임을 밝힌다', /전부 고유 글 기준/.test(RUNNER))
check('trend 를 출력한다 (미달 → 충족 추적)',
  /댓글이 늘어난 글/.test(RUNNER) && /commentDelta/.test(RUNNER_CODE))

// ─────────────────────────────────────────────────────────
console.log('\n⑩ --show-title — 🔴 기본 미출력 · 후보만 · 본문 절대 금지')
// ─────────────────────────────────────────────────────────
check('옵션이 있다', /--show-title/.test(RUNNER))
check('🔴 기본값이 false 다',
  /const SHOW_TITLE = argv\.includes\('--show-title'\)/.test(RUNNER_CODE),
  '기본으로 켜지면 소스 원문이 늘 로그에 남는다')
check('제목 출력이 옵션 안에만 있다',
  /if \(SHOW_TITLE\) \{[\s\S]{0,200}originalTitle/.test(RUNNER_CODE),
  'originalTitle 참조가 옵션 밖에 있으면 안 된다')
check('🔴 길이를 자른다', /TITLE_MAX/.test(RUNNER_CODE) && /const TITLE_MAX = 80/.test(RUNNER_CODE))
check('🔴 본문(rawBody)을 어디서도 출력하지 않는다',
  !/rawBody/.test(RUNNER_CODE) && !/rawBody/.test(LIB_CODE))
check('🔴 제외·보류 글 제목은 나오지 않는다 (구조로 보장)',
  /const top = scored\.slice\(0, TOP\)/.test(RUNNER_CODE)
    && !/excluded[\s\S]{0,120}originalTitle/.test(RUNNER_CODE)
    && !/held[\s\S]{0,120}originalTitle/.test(RUNNER_CODE),
  'top 은 scored(=candidate)에서만 나온다')
check('🔴 쿠키·세션·HTML 을 만지지 않는다',
  !/(cookie|storageState|innerHTML|outerHTML)/i.test(RUNNER_CODE) && !/(cookie|storageState|innerHTML)/i.test(LIB_CODE))

// ─────────────────────────────────────────────────────────
console.log(failed === 0
  ? '\n✅ 전부 통과 — 점수는 초안이고, 게이트는 점수보다 먼저다.\n'
  : `\n❌ ${failed}건 실패\n`)
process.exit(failed === 0 ? 0 : 1)
