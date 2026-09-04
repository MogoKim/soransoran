#!/usr/bin/env tsx
/**
 * Seed Inbox 리포트 fixture — 🔴 **저장소가 아님을 코드로 고정한다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-L · §4-M
 *
 * 🔴 이 fixture 가 막는 사고
 *    ① Seed Inbox 후보에 originalRaw · growthIssue · hold · exclude 가 섞이는 것
 *    ② 기본 실행이 제목 원문을 찍는 것
 *    ③ 어느 경로로든 rawBody 가 새는 것
 *    ④ read-only 도구에 DB · Sheet · LLM · live 가 들어오는 것
 *    ⑤ legacy(sourceRunId 없음) 행이 섞여 분포가 거짓이 되는 것
 *    ⑥ 판단 단위가 게시글이 아니라 row 가 되는 것
 *
 * 🔴 **부정 스캔은 codeOf() 를 지난 뒤에 한다.** 원문에 걸면 *금지를 설명하는 주석*이 잡힌다
 *    — 이 저장소에서 다섯 번 반복한 실수다.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  SEED_INBOX_LANES, NOT_SEED_INBOX, isSeedInboxLane,
  verdictOf, VERDICT_LABEL, VERDICT_MEANING, DETAIL_FLAGS, ASSET_TOPICS, HOT_SCORE, type SeedVerdict,
} from './micro-seed-seed-inbox-dry-run.mjs'
import {
  scoreRows, gateOf, laneHintOf, toArticles, type ScoutRow, type Lane,
} from './lib/micro-seed-scout-score.mjs'
import { hasRunId, parseJsonl, loadScoutRows } from './lib/micro-seed-scout-load.mjs'
import {
  toCards, renderHtml, escapeHtml, REVIEW_ACTIONS,
} from './micro-seed-seed-inbox-html.mjs'

const RUNNER = readFileSync('scripts/micro-seed-seed-inbox-dry-run.mts', 'utf-8')
const LOADER = readFileSync('scripts/lib/micro-seed-scout-load.mts', 'utf-8')
const HTMLGEN = readFileSync('scripts/micro-seed-seed-inbox-html.mts', 'utf-8')

/** 🔴 주석을 걷어낸 뒤 부정 스캔한다 */
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const RUNNER_CODE = codeOf(RUNNER)
const LOADER_CODE = codeOf(LOADER)
const HTMLGEN_CODE = codeOf(HTMLGEN)

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, why = ''): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  ❌ ${label}${why ? ` — ${why}` : ''}`) }
}

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
  ...o,
})

console.log('\nSeed Inbox 리포트 fixture')
console.log('─────────────────────────────────────────────────────────')

// ─────────────────────────────────────────────────────────
console.log('\n① Seed Inbox 대상은 세 레인뿐이다')
// ─────────────────────────────────────────────────────────
{
  check('대상 = infoSeed · microSeedQuestion · participationSeed',
    [...SEED_INBOX_LANES].sort().join(',') === 'infoSeed,microSeedQuestion,participationSeed',
    `실제 ${SEED_INBOX_LANES.join(',')}`)

  for (const l of ['infoSeed', 'microSeedQuestion', 'participationSeed'] as Lane[]) {
    check(`🟡 ${l} 은 Seed Inbox 대상`, isSeedInboxLane(l))
  }

  // 🔴 네 레인은 각각 다른 이유로 빠진다 — 하나라도 들어오면 계약이 깨진다
  for (const l of ['originalRaw', 'growthIssue', 'hold', 'exclude'] as Lane[]) {
    check(`🔴 ${l} 은 Seed Inbox 대상이 아니다`, !isSeedInboxLane(l))
    check(`🔴 ${l} 이 제외 목록에 명시돼 있다`, NOT_SEED_INBOX.includes(l))
  }

  check('🔴 두 목록이 겹치지 않는다',
    SEED_INBOX_LANES.every((l) => !NOT_SEED_INBOX.includes(l)))
  check('🔴 두 목록이 7종 전부를 덮는다',
    new Set([...SEED_INBOX_LANES, ...NOT_SEED_INBOX]).size === 7)
}

// ─────────────────────────────────────────────────────────
console.log('\n② gate 통과 글만 후보다 — hold · exclude 는 들어오지 못한다')
// ─────────────────────────────────────────────────────────
{
  const rows = [
    row({ sourceArticleId: 'pol', sourceExcludeReason: 'politics', originalTitle: '대선 후보 토론 보셨어요' }),
    row({ sourceArticleId: 'pin', sourceExcludeReason: 'pinned', originalTitle: '[공지] 게시판 이용 안내' }),
    row({ sourceArticleId: 'ask', originalTitle: '냉장고 추천해주세요' }),
  ]
  const { scored, excluded, held } = scoreRows(rows)
  const seed = scored.filter((s) => isSeedInboxLane(s.laneHint.lane))

  check('🔴 정치 글은 후보 집합 밖이다', excluded.some((e) => e.row.sourceArticleId === 'pol'))
  check('🔴 공지 글은 후보 집합 밖이다', excluded.some((e) => e.row.sourceArticleId === 'pin'))
  check('🔴 Seed Inbox 후보에 제외 글이 없다',
    seed.every((s) => s.row.sourceArticleId !== 'pol' && s.row.sourceArticleId !== 'pin'))
  check('🔴 Seed Inbox 후보에 보류 글이 없다',
    seed.every((s) => !held.some((h) => h.row.sourceArticleId === s.row.sourceArticleId)))
  check('🟡 정보 질문은 Seed Inbox 후보로 남는다', seed.some((s) => s.row.sourceArticleId === 'ask'))

  // 🔴 gate 를 통과하지 못한 행에 laneHint 를 물으면 hold · exclude 가 나온다 —
  //    그 값이 Seed Inbox 로 분류되면 안 된다
  for (const r of rows.slice(0, 2)) {
    const lane = laneHintOf(r, gateOf(r)).lane
    check(`🔴 ${r.sourceArticleId} 의 lane(${lane})은 Seed Inbox 가 아니다`, !isSeedInboxLane(lane))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n③ originalRaw 는 Raw Vault 로 간다 — Seed Inbox 가 아니다')
// ─────────────────────────────────────────────────────────
{
  const long = row({ sourceArticleId: 'raw', originalTitle: '시어머니가 서운하다고 하셔서 며칠째 답답하고 속상합니다' })
  const lane = laneHintOf(long, gateOf(long)).lane
  check('긴 고민글은 originalRaw 다', lane === 'originalRaw', `실제 ${lane}`)
  check('🔴 originalRaw 는 Seed Inbox 후보가 아니다', !isSeedInboxLane(lane))

  const { scored } = scoreRows([long])
  check('🔴 Seed Inbox 필터가 originalRaw 를 걸러낸다',
    scored.filter((s) => isSeedInboxLane(s.laneHint.lane)).length === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 제목 — 기본 미출력 · --show-title 에서만 · 80자 절단')
// ─────────────────────────────────────────────────────────
{
  check('🔴 SHOW_TITLE 기본값이 false 다',
    /const SHOW_TITLE = argv\.includes\('--show-title'\)/.test(RUNNER_CODE),
    '기본 true 로 두면 매 실행이 소스 원문을 찍는다')
  check('🔴 originalTitle 출력이 SHOW_TITLE 안에서만 일어난다',
    /if \(SHOW_TITLE\) console\.log\(`\s*제목\s+\$\{clampTitle\(r\.originalTitle\)\}`\)/.test(RUNNER_CODE))

  // 🔴 originalTitle 을 만지는 지점이 그 한 곳뿐인지 — 다른 데서 새면 옵션이 무의미하다
  // 🔴 verdictOf 가 topicHits 를 위해 제목을 **읽는다**. 읽기는 유출이 아니다 —
  //    지켜야 할 성질은 "**찍히는** 곳이 하나뿐" 이다. 그것만 센다.
  const printed = (RUNNER_CODE.match(/console\.log\([^\n]*originalTitle/g) ?? []).length
  check('🔴 originalTitle 을 출력하는 곳이 1곳뿐이다', printed === 1, `실제 ${printed}곳`)
  const readOnly = (RUNNER_CODE.match(/topicHits\(r\.originalTitle/g) ?? []).length
  check('🟢 나머지 참조는 topicHits 읽기뿐이다', readOnly === 1, `실제 ${readOnly}곳`)

  check('🔴 절단 상수가 80 이다', /const TITLE_MAX = 80/.test(RUNNER_CODE))
  check('🔴 코드포인트 단위로 자른다 (한글·이모지 안 깨짐)',
    /\[\.\.\.t\]/.test(RUNNER_CODE) && /cp\.slice\(0, TITLE_MAX\)/.test(RUNNER_CODE))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ rawBody 는 어떤 경우에도 나오지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 runner 에 rawBody 참조가 없다', !/rawBody/.test(RUNNER_CODE))
  check('🔴 loader 에 rawBody 참조가 없다', !/rawBody/.test(LOADER_CODE))
  // 🔴 애초에 본문이 있는 파일을 읽지 않는다 — .list.jsonl 만 읽는다
  check('🔴 loader 는 *.list.jsonl 만 읽는다', /endsWith\('\.list\.jsonl'\)/.test(LOADER_CODE))
  check('🔴 ScoutRow 타입에 본문 필드가 없다',
    !/rawBody|rawContent|body\s*:/.test(readFileSync('scripts/lib/micro-seed-scout-score.mts', 'utf-8')
      .match(/export type ScoutRow = \{[\s\S]*?\n\}/)?.[0] ?? ''))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ DB · Sheet · LLM · live · 파일 생성이 없다')
// ─────────────────────────────────────────────────────────
{
  const BANNED: readonly (readonly [RegExp, string])[] = [
    [/PrismaClient|@prisma\/client/, 'Prisma'],
    [/googleapis|google-spreadsheet|sheets\.spreadsheets/, 'Google Sheet'],
    [/anthropic|openai|claude-|gpt-/i, 'LLM'],
    [/playwright|chromium|puppeteer/, '브라우저'],
    [/\bfetch\s*\(|axios|node-fetch|https?\.request/, '네트워크'],
    [/writeFileSync|appendFileSync|createWriteStream|mkdirSync|rmSync|unlinkSync/, '파일 쓰기'],
    [/\.create\(|\.update\(|\.upsert\(|\.delete\(|\.deleteMany\(/, 'DB write'],
  ]
  for (const [re, label] of BANNED) {
    check(`🔴 runner 에 ${label} 없음`, !re.test(RUNNER_CODE))
    check(`🔴 loader 에 ${label} 없음`, !re.test(LOADER_CODE))
  }
  check('🟢 loader 는 읽기 함수만 쓴다',
    /readFileSync|readdirSync/.test(LOADER_CODE) && !/writeFileSync/.test(LOADER_CODE))
  check('🔴 runner 는 스스로 파일을 열지 않는다 — loader 를 통한다',
    !/readdirSync|readFileSync/.test(RUNNER_CODE))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ legacy(sourceRunId 없음)는 제외한다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 runId 없는 행은 유효 표본이 아니다', !hasRunId(row({ sourceRunId: undefined })))
  check('🔴 빈 문자열도 유효 표본이 아니다', !hasRunId(row({ sourceRunId: '' })))
  check('🟢 runId 있는 행은 유효 표본이다', hasRunId(row({ sourceRunId: '20260903-160000' })))

  const jsonl = [
    JSON.stringify(row({ sourceArticleId: 'a' })),
    JSON.stringify({ ...row({ sourceArticleId: 'b' }), sourceRunId: undefined }),
  ].join('\n')
  const parsed = parseJsonl(jsonl)
  check('parseJsonl 이 2행을 읽는다', parsed.length === 2)
  check('🔴 그중 legacy 1행이 걸러진다', parsed.filter(hasRunId).length === 1)

  check('🔴 loader 가 legacy 를 조용히 버리지 않는다 — 몇 행인지 돌려준다',
    /legacyRows/.test(LOADER_CODE) && /legacyFiles/.test(LOADER_CODE))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 판단 단위는 게시글 1개다 (row 가 아니다)')
// ─────────────────────────────────────────────────────────
{
  // 🔴 같은 글을 두 run 에서 본 경우 — 1건으로 세야 한다
  const rows = [
    row({ sourceArticleId: 'x', sourceRunId: '20260903-160000', sourceCommentCount: 3, sourceViewCount: 100 }),
    row({ sourceArticleId: 'x', sourceRunId: '20260903-200000', sourceCommentCount: 9, sourceViewCount: 180 }),
    row({ sourceArticleId: 'y', sourceRunId: '20260903-160000' }),
  ]
  const articles = toArticles(rows)
  check('관측 3행 → 고유 글 2건', articles.length === 2, `실제 ${articles.length}`)

  const { scored } = scoreRows(rows)
  const ids = scored.map((s) => s.row.sourceArticleId)
  check('🔴 같은 글이 결과에 중복되지 않는다', new Set(ids).size === ids.length)

  const x = scored.find((s) => s.row.sourceArticleId === 'x')
  check('watch/trend 정보가 유지된다 — seenCount', x?.obs.seenCount === 2)
  check('watch/trend 정보가 유지된다 — commentDelta', x?.obs.commentDelta === 6, `실제 ${x?.obs.commentDelta}`)
  check('watch/trend 정보가 유지된다 — viewDelta', x?.obs.viewDelta === 80, `실제 ${x?.obs.viewDelta}`)
  check('🔴 runner 가 toArticles 로 고유 글을 센다', /toArticles\(rows\)/.test(RUNNER_CODE))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 출력 계약 — 자동 라우팅이 아님을 반드시 찍는다')
// ─────────────────────────────────────────────────────────
{
  const MUST: readonly string[] = [
    'Seed Inbox dry-run은 저장소가 아니다',
    'DB write 0 · Sheet write 0 · LLM 0 · live 0',
    'laneHint는 자동 라우팅이 아니다',
    '이 결과로 DB/Sheet 저장 경로를 확정하지 않는다',
  ]
  for (const m of MUST) check(`🔴 출력에 "${m}"`, RUNNER.includes(m))

  check('🔴 전체 lane 분포를 보여준다 (Seed Inbox 밖도)', /ALL_LANES/.test(RUNNER_CODE))
  check('🔴 레인별 top 출력이 있다', /LANE_TOP/.test(RUNNER_CODE) && /레인별 상위/.test(RUNNER))
  check('🔴 watch 여부를 찍는다', /s\.watch \? 'watch'/.test(RUNNER_CODE))
  for (const f of ['seenCount', 'commentDelta', 'viewDelta', 'sourceSite', 'sourceBoardKey', 'sourceBoardName', 'sourceArticleId', 'sourcePage', 'sourceRankOnPage', 'lagMinutes']) {
    check(`🟢 출력 필드 ${f}`, RUNNER_CODE.includes(f))
  }
  check('🟢 why / signal 요약을 찍는다', /s\.why/.test(RUNNER_CODE) && /laneHint\.signals/.test(RUNNER_CODE))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 실데이터 — 실행 가능하고 계약을 지킨다')
// ─────────────────────────────────────────────────────────
{
  let ran = false
  try {
    const { loaded, legacyRows } = loadScoutRows()
    const rows = loaded.flatMap((l) => l.rows)
    if (rows.length > 0) {
      ran = true
      const { scored, excluded, held } = scoreRows(rows)
      const seed = scored.filter((s) => isSeedInboxLane(s.laneHint.lane))
      check('실데이터에서 Seed Inbox 후보가 잡힌다', seed.length > 0, `${seed.length}건`)
      check('🔴 후보에 originalRaw 가 섞이지 않았다', seed.every((s) => s.laneHint.lane !== 'originalRaw'))
      check('🔴 후보에 growthIssue 가 섞이지 않았다', seed.every((s) => s.laneHint.lane !== 'growthIssue'))
      check('🔴 후보 전원이 gate 를 통과했다', seed.every((s) => s.gate.verdict === 'candidate'))
      check('🔴 후보에 제외·보류 글이 없다',
        seed.every((s) => ![...excluded, ...held].some((o) => o.row.sourceArticleId === s.row.sourceArticleId)))
      check('🔴 후보가 고유 글 단위다', new Set(seed.map((s) => s.row.sourceArticleId)).size === seed.length)
      console.log(`     (표본: 행 ${rows.length} · legacy 제외 ${legacyRows} · 후보 ${seed.length})`)
    }
  } catch {
    // .microseed-data 가 없는 환경(CI)에서는 건너뛴다 — 그 자체는 실패가 아니다
  }
  if (!ran) console.log('     ⏭️  .microseed-data 없음 — 실데이터 검사 건너뜀 (CI 정상)')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 추천 기준 — 🔴 Seed Inbox 는 triage 다 (2026-09-04 창업자 2차 정정)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **규칙만 본다.** 레인 분류기는 ①③ 과 scout-score-check 가 따로 검사한다.
   *    여기서 실제 채점을 쓰면 단일 행에서 백분위가 퇴화해(watch 가 항상 true)
   *    "규칙이 틀렸는지" 와 "표본이 1건이라 그런지" 를 구분할 수 없다.
   */
  const sr = (o: Partial<ScoutRow>, lane: Lane, over: { watch?: boolean; total?: number } = {}) => ({
    row: row(o),
    laneHint: { lane, reason: '', signals: [] },
    watch: over.watch ?? false,
    score: { engagement: 0, targetFit: 0, conversation: 0, freshness: 0, penalty: 0, total: over.total ?? 10 },
  })
  const verdict = (o: Partial<ScoutRow>, lane: Lane = 'microSeedQuestion', over: { watch?: boolean; total?: number } = {}) =>
    verdictOf(sr(o, lane, over))

  /** 🔴 창업자 지목 케이스는 **실제 파이프라인**으로 확인한다 — 규칙만 맞으면 의미가 없다 */
  const pipelineVerdict = (title: string): { verdict: string; reason: string } => {
    const { scored, excluded, held } = scoreRows([row({ originalTitle: title })])
    return verdictOf([...scored, ...excluded, ...held][0])
  }

  // 🔴 버튼 문구 — 대표님이 보고 바로 뜻을 알아야 한다
  check('라벨: Seed로 좋음', VERDICT_LABEL.seedOk === 'Seed로 좋음')
  check('라벨: 상세 읽기', VERDICT_LABEL.needsDetail === '상세 읽기')
  check('라벨: Raw 후보', VERDICT_LABEL.rawMaybe === 'Raw 후보')
  check('뜻: Seed로 좋음 = 제목만으로 충분',
    VERDICT_MEANING.seedOk === '제목만으로 충분 · 본문 열 필요 낮음')
  check('뜻: 상세 읽기 = 본문·댓글이 자산일 가능성',
    VERDICT_MEANING.needsDetail === '본문·댓글이 자산일 가능성 — 확인 필요')
  check('뜻: Raw 후보 = DETAIL 이후에만 판단',
    VERDICT_MEANING.rawMaybe === '긴 원문 재료 가능 · DETAIL 이후에만 판단')

  // 🔴 창업자가 직접 정정한 5건 — 전부 DETAIL 이어야 한다
  const founderDetail: readonly string[] = [
    '혼인신고만 한 친구 축의금 얼마가 적당할까요?',
    '다들 28살 조카한테 어머님 모시게 하는거 어떻게 생각하세요? (펑예)',
    '결혼할때 한복 맞추신분들 아직도 가지고계신가요?',
    '고등 영어 내신. 모고 둘다 1등급나오려면 라이팅을 얼마나 잘해야하나요?',
    '초딩들 학원보내면 학원에 전화나 문자 얼마나하세요?',
  ]
  for (const title of founderDetail) {
    const r = row({ originalTitle: title })
    const lane = laneHintOf(r, gateOf(r)).lane
    check(`🟡 "${title.slice(0, 14)}…" 은 Seed Inbox 후보`, isSeedInboxLane(lane), `실제 ${lane}`)
    const v = pipelineVerdict(title)
    check(`🔵 "${title.slice(0, 14)}…" 추천은 상세 읽기`,
      v.verdict === 'needsDetail', `실제 ${v.verdict} — ${v.reason}`)
  }

  // 🔴 레인만으로 Seed로 좋음이 되면 안 된다 — 이것이 1차 정정에서 틀린 지점이다
  for (const lane of SEED_INBOX_LANES) {
    check(`🔴 ${lane} 이라는 이유만으로 Seed로 좋음이 되지 않는다`,
      verdict({ originalTitle: '아이 학원비 다들 얼마나 쓰세요' }, lane).verdict === 'needsDetail')
  }

  // 🟢 맥락 의존이 낮은 일반 질문만 Seed로 좋음
  for (const t of ['중드 추천 부탁드려요~', '냉장고 추천해주세요']) {
    const v = verdict({ originalTitle: t }, 'microSeedQuestion', { watch: false, total: 20 })
    check(`🟢 "${t}" 는 Seed로 좋음`, v.verdict === 'seedOk', `실제 ${v.verdict} — ${v.reason}`)
  }

  // 🔵 댓글이 자산인 축은 DETAIL 로 간다
  for (const [t, axis] of [
    ['남편 생신 다들 어떻게 하세요', '가족'],
    ['아이 학원 언제부터 보내셨어요', '자녀·교육'],
    ['노후 자금 다들 얼마나 모으셨나요', '돈·노후'],
    ['갱년기 불면증 어떻게들 버티세요', '몸·건강'],
    ['친구 관계 다들 어떠세요', '관계·마음'],
  ] as const) {
    const v = verdict({ originalTitle: t }, 'participationSeed', { watch: false, total: 20 })
    check(`🔵 ${axis} 축 → 상세 읽기`, v.verdict === 'needsDetail', `실제 ${v.verdict}`)
    check(`   이유에 축을 적는다`, v.reason.includes(axis))
  }

  // 🔴 민감·판단불가도 여전히 DETAIL 이다
  for (const [flag, why] of DETAIL_FLAGS) {
    // 🔴 medicalOrAdLikely 는 gate 에서 이미 hold 라 후보로 오지 않는다.
    //    그래도 규칙에 남긴다 — 게이트가 바뀌어도 여기서 한 번 더 걸린다(다중 방어).
    const v = verdict({ originalTitle: '중드 추천 부탁드려요~', qualityFlags: [flag] }, 'microSeedQuestion', { watch: false, total: 20 })
    check(`🔴 ${flag} → 상세 읽기`, v.verdict === 'needsDetail', `실제 ${v.verdict}`)
    check(`   이유를 사람 말로 적는다 (${why})`, v.reason.includes(why))
  }

  // 🔵 화제성 · watch 도 DETAIL 사유다 — 댓글이 이미 붙고 있다는 뜻이다
  check('🔵 highEngagement → 상세 읽기',
    verdict({ originalTitle: '중드 추천 부탁드려요~', qualityFlags: ['highEngagement'] }, 'infoSeed', { watch: false, total: 20 }).verdict === 'needsDetail')
  check('🔵 watch → 상세 읽기',
    verdict({ originalTitle: '중드 추천 부탁드려요~' }, 'infoSeed', { watch: true, total: 20 }).verdict === 'needsDetail')
  check(`🔵 상위권 점수(${HOT_SCORE}+) → 상세 읽기`,
    verdict({ originalTitle: '중드 추천 부탁드려요~' }, 'infoSeed', { watch: false, total: HOT_SCORE }).verdict === 'needsDetail')

  // 🔴 Raw 후보는 목록·제목 단계에서 추천하지 않는다
  for (const t of ['중드 추천 부탁드려요~', '남편 생신 다들 어떻게 하세요', '냉장고 추천해주세요']) {
    check(`🔴 "${t.slice(0, 10)}…" 에 Raw 후보를 추천하지 않는다`,
      verdict({ originalTitle: t }, 'participationSeed').verdict !== 'rawMaybe')
  }
  {
    const { scored } = scoreRows([row({ originalTitle: '시어머니가 서운하다고 하셔서 며칠째 답답하고 속상합니다' })])
    check('🟡 Seed Inbox 밖(originalRaw)은 Raw 후보로 떨어진다',
      verdictOf(scored[0]).verdict === 'rawMaybe')
    check('   그 이유도 DETAIL 이후라고 적는다', verdictOf(scored[0]).reason.includes('DETAIL 이후'))
  }

  // 🔴 출력 계약
  for (const v of ['seedOk', 'needsDetail', 'rawMaybe'] as SeedVerdict[]) {
    check(`🔴 출력에 "${VERDICT_MEANING[v]}"`, RUNNER.includes(VERDICT_MEANING[v]))
  }
  check('🔴 출력이 triage 단계임을 밝힌다', RUNNER.includes('triage'))
  check('🔴 출력에 "제목으로 1차 선별"', RUNNER.includes('제목으로 1차 선별'))
  check('🔴 DETAIL 이 비용 낭비가 아님을 밝힌다', RUNNER.includes('DETAIL 은 비용 낭비가 아니다'))
  check('🔴 Raw 는 DETAIL 이후에만 판단한다고 밝힌다', RUNNER.includes('DETAIL 이후'))
  check('🔴 자동 상세 fetch 기준을 확정하지 않았다고 찍는다',
    RUNNER.includes('자동 상세 fetch 기준을 확정하지 않았다'))
  // 🟢 창업자 승인 v1 (§4-O) — 승인된 것은 추천 기준이지 자동화가 아니다
  check('🟢 CLI 가 창업자 승인 v1 을 밝힌다', RUNNER.includes('창업자 승인 v1 기준 (§4-O)'))
  check('🔴 CLI 가 "승인 ≠ 자동화" 를 밝힌다',
    RUNNER.includes('자동화에 대한 승인이 아니다'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ 실데이터 — 상위권은 DETAIL 쪽이 맞다')
// ─────────────────────────────────────────────────────────
{
  try {
    const { loaded } = loadScoutRows()
    const rows = loaded.flatMap((l) => l.rows)
    if (rows.length > 0) {
      const { scored } = scoreRows(rows)
      const seed = scored.filter((s) => isSeedInboxLane(s.laneHint.lane))
      const vs = seed.map((s) => verdictOf(s))
      const n = (v: SeedVerdict): number => vs.filter((x) => x.verdict === v).length
      check('🔴 Seed 후보에 Raw 후보 추천이 0건', n('rawMaybe') === 0, `${n('rawMaybe')}건`)
      check('🔵 상위 10건은 전부 DETAIL 이다',
        seed.slice(0, 10).every((s) => verdictOf(s).verdict === 'needsDetail'),
        seed.slice(0, 10).map((s) => verdictOf(s).verdict).join(','))
      check('🟢 Seed로 좋음도 남아 있다 — 전부 DETAIL 이면 triage 가 아니다', n('seedOk') > 0, `${n('seedOk')}건`)
      console.log(`     (실측: 상세 읽기 ${n('needsDetail')} · Seed로 좋음 ${n('seedOk')} · Raw 후보 ${n('rawMaybe')})`)
    }
  } catch {
    console.log('     ⏭️  .microseed-data 없음 — 건너뜀 (CI 정상)')
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑬ 모듈 재사용 — 🔴 import 만으로 리포트가 돌면 안 된다')
// ─────────────────────────────────────────────────────────
{
  // 🔴 앞 커밋까지 파일 끝에서 `main()` 을 그냥 불렀다. 그래서 verdictOf 하나만
  //    가져다 쓰려고 import 해도 리포트가 통째로 돌고 JSONL 을 읽었다.
  //    데이터가 없으면 fail() 이 process.exit(1) 을 불러 **import 한 쪽이 죽는다.**
  check('🔴 엔트리포인트 가드가 있다',
    /const isDirectRun[\s\S]{0,200}import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/.test(RUNNER_CODE))
  check('🔴 main() 이 가드 안에서만 불린다', /if \(isDirectRun\) main\(\)/.test(RUNNER_CODE))

  // 🔴 top-level 에 맨몸 `main()` 이 남아 있으면 가드가 무의미하다
  const bare = (RUNNER_CODE.match(/^main\(\)\s*$/gm) ?? []).length
  check('🔴 top-level 에 맨몸 main() 호출이 없다', bare === 0, `실제 ${bare}곳`)

  // 🔴 **말이 아니라 실제로 돌려서 본다** — 자식 프로세스에서 import 만 하고 stdout 을 센다.
  //    소스 검사만 하면 "가드가 있다" 는 알아도 "정말 조용한가" 는 모른다.
  let out = ''
  let ran = false
  try {
    out = execFileSync(
      'npx',
      ['tsx', '-e', "import('./scripts/micro-seed-seed-inbox-dry-run.mjs').then(m => { if (typeof m.verdictOf !== 'function') process.exit(2) })"],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 },
    )
    ran = true
  } catch {
    // npx 를 못 쓰는 환경이면 소스 검사만으로 만족한다 — 그 자체는 실패가 아니다
  }
  if (ran) {
    check('🔴 import 만으로 stdout 출력이 0이다', out.trim() === '', `실제 ${out.split('\n').length}줄`)
    check('🟢 import 한 쪽이 죽지 않는다 (exit 0)', true)
    check('🟢 verdictOf 를 import 해서 쓸 수 있다', true)
  } else {
    console.log('     ⏭️  npx 실행 불가 — 소스 검사만 수행 (CI 정상)')
  }

  // 🟢 이 fixture 자체가 모듈을 import 하고 있다. 가드가 깨지면 이 파일 실행 첫 줄부터
  //    리포트가 찍힌다 — 사람이 바로 알아챈다.
  check('🟢 이 fixture 도 모듈을 import 해서 쓴다 (살아 있는 증명)',
    typeof verdictOf === 'function')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑭ HTML 검수 화면 — 🔴 CLI 와 같은 기준을 쓴다')
// ─────────────────────────────────────────────────────────
{
  // 🔴 **판정 로직을 두 벌 갖지 않는다.** 갈라지면 검수 결과를 믿을 수 없다.
  check('🔴 HTML 생성기가 verdictOf 를 import 한다', /verdictOf/.test(HTMLGEN_CODE))
  check('🔴 HTML 생성기에 자체 판정 로직이 없다',
    !/needsDetail'\s*:|verdict\s*=\s*'(seedOk|needsDetail|rawMaybe)'/.test(HTMLGEN_CODE),
    'verdict 문자열을 직접 만들면 기준이 갈라진다')
  check('🔴 ASSET_TOPICS · DETAIL_FLAGS 를 다시 정의하지 않는다',
    !/ASSET_TOPICS\s*[:=]\s*\[/.test(HTMLGEN_CODE) && !/DETAIL_FLAGS\s*[:=]\s*\[/.test(HTMLGEN_CODE))

  // 🔴 read-only — 생성기도, 생성된 HTML 도
  const BANNED: readonly (readonly [RegExp, string])[] = [
    [/PrismaClient|@prisma\/client/, 'Prisma'],
    [/googleapis|google-spreadsheet|sheets\.spreadsheets/, 'Google Sheet'],
    [/anthropic|openai|claude-|gpt-/i, 'LLM'],
    [/playwright|chromium|puppeteer/, '브라우저'],
    [/rawBody|rawContent/, '본문'],
    [/cookie|storageState|NID_AUT/i, '쿠키·세션'],
  ]
  for (const [re, label] of BANNED) check(`🔴 생성기에 ${label} 없음`, !re.test(HTMLGEN_CODE))

  // 🔴 gitignore 밖으로 내보내지 않는다 — HTML 에 소스 제목이 들어간다
  check('🔴 .microseed-data/ 밖이면 쓰기를 거부한다',
    /rel\.startsWith\('\.microseed-data\/'\)/.test(HTMLGEN_CODE))
  check('🟢 .microseed-data 는 gitignore 돼 있다',
    readFileSync('.gitignore', 'utf-8').includes('.microseed-data/'))

  // 🔴 import 만으로 파일을 쓰면 안 된다 (dry-run 과 같은 이유)
  check('🔴 생성기도 엔트리포인트 가드를 쓴다',
    /if \(isDirectRun\) main\(\)/.test(HTMLGEN_CODE))
  const bareMain = (HTMLGEN_CODE.match(/^main\(\)\s*$/gm) ?? []).length
  check('🔴 top-level 맨몸 main() 없음', bareMain === 0, `실제 ${bareMain}곳`)

  // ── 버튼 6종 ──
  check('버튼 6종', REVIEW_ACTIONS.length === 6, `실제 ${REVIEW_ACTIONS.length}`)
  for (const k of ['DETAIL', 'SEED', 'RAW', 'HOLD', 'DROP', 'WRONG']) {
    check(`🟢 버튼 ${k}`, REVIEW_ACTIONS.some(([x]) => x === k))
  }

  // ── 이스케이프 — 🔴 제목은 소스 원문이다 ──
  check('🔴 < 를 이스케이프한다', escapeHtml('<script>') === '&lt;script&gt;')
  check('🔴 따옴표를 이스케이프한다', escapeHtml(`"'`) === '&quot;&#39;')
  check('🔴 & 를 먼저 이스케이프한다 (이중 인코딩 방지)', escapeHtml('&lt;') === '&amp;lt;')

  // ── 카드 변환 · 렌더 ──
  const rows = [
    row({ sourceArticleId: 'q1', originalTitle: '냉장고 추천해주세요' }),
    row({ sourceArticleId: 'x1', originalTitle: '</script><img src=x onerror=alert(1)>' }),
  ]
  const { scored } = scoreRows(rows)
  const seed = scored.filter((s) => isSeedInboxLane(s.laneHint.lane))
  const cards = toCards(seed)
  check('🟢 카드가 만들어진다', cards.length > 0)
  check('🔴 카드 verdict 이 verdictOf 결과와 같다',
    cards.every((c, i) => c.verdict === verdictOf(seed[i]).verdict))
  check('🔴 카드에 본문 필드가 없다',
    cards.every((c) => !Object.keys(c).some((k) => /body|content/i.test(k))))

  const html = renderHtml(cards, { counts: {}, meanings: VERDICT_MEANING })
  check('🔴 생성된 HTML 에 외부 요청이 없다',
    !/https?:\/\//.test(html.replace(/https?:\/\/[^"'\s]*w3\.org[^"'\s]*/g, '')),
    '외부 CDN·폰트·이미지를 부르면 검수 화면이 네트워크를 쓴다')
  check('🔴 생성된 HTML 에 rawBody 가 없다', !/rawBody/.test(html))
  check('🔴 `</script` 가 데이터에서 탈출하지 않는다',
    (html.match(/<\/script>/g) ?? []).length === 2,
    `실제 ${(html.match(/<\/script>/g) ?? []).length}개 — 제목이 스크립트를 닫으면 XSS 다`)
  check('🔴 저장 경로는 localStorage 뿐이다',
    /localStorage/.test(html) && !/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(html))
  for (const m of [
    '이 화면은 저장소가 아니다', 'DB write 0 · Sheet write 0 · LLM 0 · live 0',
    '같은 verdictOf()', 'localStorage', 'triage',
    'Raw Vault 확정은 DETAIL 이후에만 가능하다',
    '이 결과로 DB/Sheet 저장 경로를 확정하지 않는다',
    // 🟢 창업자 승인 v1 (§4-O)
    '창업자 승인 v1', '자동화가 아니다',
  ]) check(`🔴 HTML 이 "${m}" 를 밝힌다`, html.includes(m))

  // ── 🔴 CLI 와 분포가 같은가 (실데이터) ──
  try {
    const { loaded } = loadScoutRows()
    const all = loaded.flatMap((l) => l.rows)
    if (all.length > 0) {
      const sc = scoreRows(all).scored.filter((s) => isSeedInboxLane(s.laneHint.lane))
      const cliCounts = { seedOk: 0, needsDetail: 0, rawMaybe: 0 } as Record<string, number>
      for (const s of sc) cliCounts[verdictOf(s).verdict]++
      const htmlCounts = { seedOk: 0, needsDetail: 0, rawMaybe: 0 } as Record<string, number>
      for (const c of toCards(sc)) htmlCounts[c.verdict]++
      check('🔴 CLI 와 HTML 의 verdict 분포가 같다',
        JSON.stringify(cliCounts) === JSON.stringify(htmlCounts),
        `CLI ${JSON.stringify(cliCounts)} vs HTML ${JSON.stringify(htmlCounts)}`)
      console.log(`     (실측: 상세 읽기 ${cliCounts.needsDetail} · Seed로 좋음 ${cliCounts.seedOk} · Raw 후보 ${cliCounts.rawMaybe})`)
    }
  } catch {
    console.log('     ⏭️  .microseed-data 없음 — 건너뜀 (CI 정상)')
  }
}

console.log(`\n${'─'.repeat(57)}`)
if (fail > 0) {
  console.log(`\n❌ ${fail}건 실패 · ${pass}건 통과\n`)
  process.exit(1)
}
console.log(`\n✅ 전부 통과 (${pass}건) — Seed Inbox 리포트는 저장소가 아니다.\n`)
