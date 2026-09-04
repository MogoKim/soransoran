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
  groupKeyOf, topicHits, conversationHits, WEIGHTS, HOLD_FLAGS, PENALTIES, offTargetHit,
  toArticles, articleKeyOf, laneHintOf, LANE_LABEL, SHORT_TITLE_CHARS,
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
// 🔴 PR-S2-b-14 에서 축 이름이 '몸·갱년기' → '몸·건강' 으로 넓어졌다 (치아·시력·혈당 포함)
check('몸·건강 축', topicHits('요즘 갱년기라 잠을 못 자요', '').some((t) => t.label === '몸·건강'))
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
check('양수 축 가중치 합이 100', WEIGHTS.engagement + WEIGHTS.targetFit + WEIGHTS.conversation + WEIGHTS.freshness === 100)
check('🔴 화제성이 더 이상 단독 최대 축이 아니다',
  WEIGHTS.engagement < WEIGHTS.targetFit + WEIGHTS.conversation,
  '화제성 72% 획득 vs 타겟 핏 22% 라 연애·외모 글이 상위를 먹었다')
check('🔴 감점은 축 합에 포함되지 않는다 (제외가 아니라 감점)', PENALTIES.offTarget === 20)
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
console.log('\n⑪ laneHint — 🔴 "좋은 글인가" 가 아니라 "어느 레인에 좋은가" (PR-S2-b-12)')
// ─────────────────────────────────────────────────────────
{
  const lane = (title: string, o: Partial<ScoutRow> = {}) => {
    const r = row({ originalTitle: title, ...o })
    return laneHintOf(r, gateOf(r))
  }

  // ── 게이트가 레인보다 먼저다 ──
  check('🔴 정치 → exclude', lane('정치 얘기 좀', { sourceExcludeReason: 'politics' }).lane === 'exclude')
  check('🔴 공지·필독·추천 → exclude', lane('공지사항', { sourceExcludeReason: 'pinned' }).lane === 'exclude')
  check('🔴 실명·공인 → exclude', lane('누구누구 소식', { sourceExcludeReason: 'publicFigure' }).lane === 'exclude')
  check('🔴 medical/ad flag → hold',
    lane('영양제 효과 있나요', { qualityFlags: ['medicalOrAdLikely'] }).lane === 'hold')
  check('publicFigureMention → hold', lane('제목', { qualityFlags: ['publicFigureMention'] }).lane === 'hold')

  // ── 🔴 정치가 growth 보다 먼저다 ──
  check('🔴 정치 어휘 + 연예가 섞이면 exclude 가 이긴다',
    lane('정치인 드라마 출연 화제', { sourceExcludeReason: 'politics' }).lane === 'exclude',
    '순서를 바꾸면 "정치인 + 방송 출연" 글이 growth 로 새어 나간다')
  check('🔴 publicFigure 사유에 Growth 여지를 남긴다',
    /Growth 여지/.test(lane('배우 근황', { sourceExcludeReason: 'publicFigure' }).reason),
    '사유를 안 남기면 Growth 레인이 열릴 때 무엇을 되살릴지 알 수 없다')
  check('🔴 정치 사유는 어디에도 안 간다고 적는다',
    /어디에도 가지 않는다/.test(lane('x', { sourceExcludeReason: 'politics' }).reason))

  // ── 후보 레인 ──
  check('연예·방송·셀럽 → growthIssue',
    ['드라마 마지막회 보셨어요', '그 배우 결혼한대요', '예능 너무 웃겨요'].every((t) => lane(t).lane === 'growthIssue'))
  // 🔴 PR-S2-b-13 정정: 게시판명으로 growth 를 잡던 것을 **뺐다.**
  //    §4-A "주제 판정은 글 단위로 한다" 를 어겼고, 실측 Growth 31건 중 21건이
  //    게시판명 기반이었으며 그 다수가 연예 내용이 아니었다.
  check('🔴 게시판명으로는 growth 를 잡지 않는다',
    lane('제목만 평범', { sourceBoardName: 'TV / 연예인 / 영상' }).lane !== 'growthIssue',
    '게시판 하나가 통째로 Growth 로 굳으면 그 게시판의 생활글까지 새어 나간다')
  check('🔴 연예 게시판의 생활글은 Growth 가 아니다',
    ['정형외과: 많이 걷지 마세요', '알박기 시작된 여의도 불꽃축제', '북토크에 가야 하는데요']
      .every((t) => lane(t, { sourceBoardName: '유머,연예,가십' }).lane !== 'growthIssue'))

  check('🔴 냉장고·가전 추천 질문 → infoSeed (정보+질문)',
    lane('냉장고 추천 좀 해주세요').lane === 'infoSeed',
    '댓글에 정보가 모이는 글이다')
  check('병원·보험 질문도 infoSeed',
    lane('보험 어디가 괜찮을까요').lane === 'infoSeed' && lane('치과 추천해주세요').lane === 'infoSeed')

  check('🔴 짧은 질문 → microSeedQuestion',
    lane('저녁 뭐 쓰세요').lane === 'microSeedQuestion')
  check('추천 요청도 question',
    lane('여름 이불 어떤 게 나을까요').lane === 'microSeedQuestion')
  check('🔴 짧은 것이 결함이 아니라고 사유에 적는다',
    /짧은 것이 결함이 아니다/.test(lane('뭐 쓰세요').reason),
    '82cook 짧은 글도 테스트 대상이다 — 짧으면 감점이 아니라 레인이 다르다')

  check('🔴 "다들 어떠세요?" → participationSeed',
    lane('다들 요즘 어떠세요').lane === 'participationSeed')
  check('공감 유도형도 참여',
    lane('저만 그런가요').lane === 'participationSeed' && lane('여러분 주말에 뭐하세요').lane === 'participationSeed')
  check('🔴 참여 마커가 질문 어미보다 먼저다',
    lane('여러분 주말에 뭐하세요').lane === 'participationSeed',
    '다들·여러분·저만 은 커뮤니티에 던지는 말이다 — 질문 seed 로 보내면 성격을 잃는다')

  check('🔴 가족·관계 긴 고민 → originalRaw',
    lane('시어머니가 자꾸 저한테만 서운하다고 하셔서 너무 답답합니다').lane === 'originalRaw')
  check('고민 사유가 붙는다',
    /긴 사연으로 확장 가능/.test(lane('남편 때문에 너무 속상해요 어떡하죠').reason))
  check('평범한 생활 소재도 originalRaw', lane('오늘 김장 했어요').lane === 'originalRaw')

  // ── 라벨·상수 ──
  check('레인 7종에 라벨이 있다', Object.keys(LANE_LABEL).length === 7)
  check('짧은 글 기준이 노출돼 있다', SHORT_TITLE_CHARS === 25)
  check('signals 가 매칭 라벨만 담는다',
    lane('냉장고 추천').signals.every((x) => ['연예', '정보', '질문', '참여', '고민'].includes(x)),
    '제목 원문이 아니다')

  // ── 🔴 자동 라우팅이 아니다 ──
  check('🔴 lib 에 Sheet write 경로가 없다',
    !/(googleapis|sheets\.|spreadsheet|appendRow|values\.append)/i.test(LIB_CODE))
  check('🔴 runner 에 Sheet write 경로가 없다',
    !/(googleapis|sheets\.|spreadsheet|appendRow|values\.append)/i.test(RUNNER_CODE))
  check('🔴 laneHint 로 분기해 무언가를 실행하지 않는다',
    !/(if \(.*laneHint.*\)[\s\S]{0,120}(write|create|append|import|fetch))/i.test(RUNNER_CODE),
    'dry-run 은 표시만 한다')
  check('🔴 "자동 라우팅이 아니다" 를 출력한다', /자동 라우팅이 아니다/.test(RUNNER))
  check('🔴 네이버 → Sheet 자동 전송 금지를 출력한다',
    /Google Sheet 자동 전송은 미구현이며 별도 계약·승인 전까지 금지/.test(RUNNER))
  check('laneHint 별 count 를 요약한다', /laneAll/.test(RUNNER_CODE) && /laneTop/.test(RUNNER_CODE))
  check('🔴 짧은 글이 버려지지 않는다고 적는다', /버리는 글이 아니다/.test(RUNNER))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ 오분류 보정 — 🔴 한국어에 단어 경계가 없다 (PR-S2-b-13)')
// ─────────────────────────────────────────────────────────
{
  const lane2 = (title: string, o: Partial<ScoutRow> = {}) => {
    const r = row({ originalTitle: title, ...o })
    return laneHintOf(r, gateOf(r))
  }

  // ── ① 배우자 오탐 ──
  check('🔴 "배우자" 는 Growth 가 아니다',
    ['저는 무교인데 배우자가 천주교라면 종교강요 있나요?', '배우자는 어떻게 생각하세요', '배우자를 믿어야 할까요']
      .every((t) => lane2(t).lane !== 'growthIssue'),
    '한국어에 단어 경계가 없어 "배우" 가 부분문자열로 걸렸다')
  check('🔴 "배우다"(learn) 활용형도 Growth 가 아니다',
    ['영어 배우고 싶어요', '뜨개질 배우는 중이에요', '운전 배우려는데'].every((t) => lane2(t).lane !== 'growthIssue'))
  check('🔴 "드라마틱" 은 Growth 가 아니다',
    lane2('생리 전 후의 이 드라마틱한 컨디션이란').lane !== 'growthIssue')
  check('🔴 "방송통신대" 는 Growth 가 아니다',
    lane2('방송통신대 다니시는 분').lane !== 'growthIssue')

  // ── 진짜 연예는 유지 ──
  check('🟢 진짜 배우·드라마·예능은 Growth 유지',
    ['그 배우 결혼한대요', '드라마 구해줘2 도 볼만한가요?', '예능 너무 웃겨요', '가수 콘서트 다녀왔어요',
      '주연배우들이 한다는 타임슬립물'].every((t) => lane2(t).lane === 'growthIssue'))
  check('🔴 정치 + 방송/출연은 여전히 exclude 다',
    lane2('정치인 예능 출연 화제', { sourceExcludeReason: 'politics' }).lane === 'exclude',
    'exclude 가 growth 보다 먼저다 — 순서를 바꾸면 새어 나간다')

  // ── ② 질문 패턴 보강 ──
  check('🔴 "보험 어떻게 하세요" → infoSeed',
    lane2('보험 어떻게 하세요').lane === 'infoSeed',
    '앞 정규식이 `어떻게 ?해` 만 봐서 `어떻게 하세요`(하≠해)를 놓쳤다')
  check('"어떻게들 하세요" 도 잡는다', lane2('보험 어떻게들 하세요').lane === 'infoSeed')
  check('"뭐 하세요/드세요" 도 잡는다',
    lane2('주말에 뭐 하세요').lane === 'microSeedQuestion' && lane2('아침에 뭐 드세요').lane === 'microSeedQuestion')
  check('🟢 냉장고 추천 → infoSeed (정보+질문)', lane2('냉장고 추천해주세요').lane === 'infoSeed')
  check('🔴 정보+질문이 microSeedQuestion 보다 먼저다',
    lane2('병원 어디가 좋아요').lane === 'infoSeed',
    '댓글에 정보가 모이는 글이라 레인이 다르다')

  // ── ③ 깊은 고민 우선순위 ──
  check('🔴 "혼자 살아야 되는데 무섭고 불안" → originalRaw',
    lane2('아빠랑 같이살던 집에 혼자 살아야되는데 무섭고 불안하네요').lane === 'originalRaw',
    '`같이` 가 너무 넓어 참여형으로 샜다 — 실제로는 사연이다')
  check('🔴 고민이 질문보다 먼저다',
    lane2('시어머니 때문에 너무 힘든데 어떡하죠?').lane === 'originalRaw',
    '질문 형태를 띤 깊은 고민을 질문 seed 로 보내면 긴 사연 재료를 잃는다')
  // 🔴 `얼마` 는 INFO_TOPIC 에도 있어서(축의금·전기세 맥락) "얼마나 속상" 같은 부사가
  //    정보로 잡힌다. 그 상호작용은 별도 과제라 여기서는 얼마 없는 예로 축만 검사한다.
  check('🔴 고민이 참여보다 먼저다',
    lane2('다들 이렇게 서운할 때 어떻게 지내시나요').lane === 'originalRaw')
  check('🟢 순수 참여형은 participationSeed 유지',
    ['다들 어떠세요', '저만 그런가요', '여러분 주말에 계신가요'].every((t) => lane2(t).lane === 'participationSeed'))
  check('🔴 정보+질문은 고민보다 먼저다',
    lane2('냉장고 고민되는데 추천 좀').lane === 'infoSeed',
    '"냉장고 고민" 은 사연이 아니라 정보 요청이다')
  check('불안·걱정 어휘가 고민으로 잡힌다',
    ['너무 걱정돼요', '앞이 막막해요', '요즘 지쳤어요'].every((t) => /고민/.test(lane2(t).signals.join())))

  // ── ④ 짧은 글은 여전히 살아남는다 ──
  check('🔴 짧다는 이유로 탈락하지 않는다',
    ['뭐 쓰세요', '어디가 좋아요', '다들 어떠세요', '냉장고 추천']
      .every((t) => !['exclude', 'hold'].includes(lane2(t).lane)),
    '82cook 짧은 글도 테스트 대상이다')
  check('7자짜리도 레인이 붙는다', lane2('다들 어떠세요').lane === 'participationSeed')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑬ 가중치 재배분 · off-target 감점 (PR-S2-b-14)')
// ─────────────────────────────────────────────────────────
{
  check('🔴 자녀·교육 축이 생겼다',
    ['아이가 새벽 1~2시까지 학원 숙제 하는게 의미가 있을까요', '고3 원서 고민 이대 시립대',
      '초딩들 학원보내면 학원에 전화나 문자 얼마나하세요', '고등 영어 내신']
      .every((t) => topicHits(t, '').some((x) => x.label === '자녀·교육')),
    '검수 실측에서 이 글들이 전부 타겟 핏 0점을 받았다 — 핵심 화제인데 축이 없었다')
  check('가족 축이 조카·어머님·결혼·명절을 잡는다',
    ['조카한테 어머님 모시게', '결혼할때 한복', '다들 추석 계획 어떠세요']
      .every((t) => topicHits(t, '').some((x) => x.label === '가족')))
  check('돈 축이 금리·축의금을 잡는다',
    topicHits('금리 오른거 체감 되세요', '').some((x) => x.label === '돈·노후')
      && topicHits('축의금 얼마가 적당할까요', '').some((x) => x.label === '돈·노후'))
  check('몸·건강 축이 치아·혈당을 잡는다',
    topicHits('치아교정 초등때', '').some((x) => x.label === '몸·건강')
      && topicHits('공복혈당 130', '').some((x) => x.label === '몸·건강'))
  check('살림·생활 축이 운전·냉장고를 잡는다',
    topicHits('운전 포기할까요', '').some((x) => x.label === '살림·생활'))

  // ── off-target 감점 ──
  check('🔴 외모 평가는 감점 대상',
    ['여자가 피부 엄청 흰편인거는 좋은건가요', '뚱뚱이는 발레 다니기 좀 그렇죠',
      '이쁘다 소리 칭찬받을경우'].every(offTargetHit))
  check('🔴 썸·연애 눈치도 감점 대상',
    ['남사친이 보고싶다 말하는거 무슨 의미', '썸인가요', '소개팅 어땠어요'].every(offTargetHit))
  check('🟢 생활글은 감점되지 않는다',
    ['시댁 농산물 부치는', '갱년기 불면증', '고3 원서 고민', '냉장고 추천']
      .every((t) => !offTargetHit(t)))
  check('🔴 감점은 제외가 아니다 — 후보 집합에 남는다',
    (() => {
      const r = row({ originalTitle: '여자가 피부 엄청 흰편인거는 좋은건가요' })
      const { scored } = scoreRows([r, row({ sourceArticleId: '2', originalTitle: '평범한 생활글' })])
      return scored.some((s) => s.row.originalTitle.includes('피부'))
    })(),
    '사람이 골라 쓸 수는 있어야 한다')
  check('감점이 breakdown 에 음수로 남는다',
    (() => {
      const { scored } = scoreRows([row({ originalTitle: '남사친이 보고싶다 말하는거 무슨 의미' })])
      return scored[0].score.penalty === -PENALTIES.offTarget
    })())
  check('감점 사유가 why 에 표시된다',
    (() => {
      const { scored } = scoreRows([row({ originalTitle: '남사친이 보고싶다 말하는거' })])
      return /타겟 외 소재/.test(scored[0].why)
    })())
  check('🟢 감점 없는 글은 penalty 0',
    (() => {
      const { scored } = scoreRows([row({ originalTitle: '시댁 농산물 부치는' })])
      return scored[0].score.penalty === 0
    })())
}

// ─────────────────────────────────────────────────────────
console.log(failed === 0
  ? '\n✅ 전부 통과 — 점수는 초안이고, 게이트는 점수보다 먼저다.\n'
  : `\n❌ ${failed}건 실패\n`)
process.exit(failed === 0 ? 0 : 1)
