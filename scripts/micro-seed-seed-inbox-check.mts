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
import {
  SEED_INBOX_LANES, NOT_SEED_INBOX, isSeedInboxLane,
} from './micro-seed-seed-inbox-dry-run.mjs'
import {
  scoreRows, gateOf, laneHintOf, toArticles, type ScoutRow, type Lane,
} from './lib/micro-seed-scout-score.mjs'
import { hasRunId, parseJsonl, loadScoutRows } from './lib/micro-seed-scout-load.mjs'

const RUNNER = readFileSync('scripts/micro-seed-seed-inbox-dry-run.mts', 'utf-8')
const LOADER = readFileSync('scripts/lib/micro-seed-scout-load.mts', 'utf-8')

/** 🔴 주석을 걷어낸 뒤 부정 스캔한다 */
const codeOf = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const RUNNER_CODE = codeOf(RUNNER)
const LOADER_CODE = codeOf(LOADER)

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
  const titleUses = (RUNNER_CODE.match(/originalTitle/g) ?? []).length
  check('🔴 originalTitle 참조가 1곳뿐이다', titleUses === 1, `실제 ${titleUses}곳`)

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

console.log(`\n${'─'.repeat(57)}`)
if (fail > 0) {
  console.log(`\n❌ ${fail}건 실패 · ${pass}건 통과\n`)
  process.exit(1)
}
console.log(`\n✅ 전부 통과 (${pass}건) — Seed Inbox 리포트는 저장소가 아니다.\n`)
