#!/usr/bin/env node
/**
 * Micro Seed Sheet reader — fixture 자기검증
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-4 · §6-8 · §6-9
 *
 * 이 스크립트가 답하는 질문은 둘이다.
 *
 *   1. "시트 17열이 어긋났을 때 조용히 넘어가는가?"       → 넘어가면 안 된다
 *   2. "reader 가 만든 후보가 validator 를 그대로 통과하는가?" → 계약이 맞아야 한다
 *
 * 🔴 이 파일은 아무것도 발행하지 않고 아무 데도 접속하지 않는다
 *    Google Sheet API 없음 · DB 없음 · 네트워크 없음 · 파일 쓰기 없음.
 *    source 는 fixture 뿐이다 (scripts/lib/micro-seed-sheet.mjs § createFixtureSource).
 *
 * 사용법
 *   node scripts/micro-seed-read.mjs           fixture 자기검증
 *   node scripts/micro-seed-read.mjs --json    결과를 JSON 으로
 */
import {
  SHEET_HEADERS,
  SHEET_TAB_NAME,
  INJECTED_FIELDS,
  validateHeaders,
  mapRowToCandidate,
  readCandidates,
  createFixtureSource,
  createGoogleSheetSource,
  MICRO_SEED_SHEET_ID_ENV,
  SHEET_READONLY_SCOPE,
} from './lib/micro-seed-sheet.mjs'
import { validateBatch } from './micro-seed-validate.mjs'

/** 고정 시각. 테스트가 시간에 흔들리면 안 된다 (validator 와 같은 기준) */
const NOW = new Date('2026-08-25T00:00:00.000Z')

/** 17칸이 다 찬 정상 행. 여기서 한 칸씩 망가뜨려 negative 를 만든다 */
const ROW = [
  'c0000000-0000-4000-8000-000000000000',
  'PENDING',
  'free',
  '오늘 저녁 뭐 드셨어요',
  '오늘 저녁 뭐 드셨나요?',
  '2026-08-26 10:30',
  '82cook',
  'https://www.82cook.com/entiz/read.php?num=1',
  '1',
  '자유게시판',
  '12',
  '2026-08-24 09:00',
  'sha256:base',
  '',
  '',
  '',
  '',
]

/**
 * 시트에 없는 네 필드 — 주입되어야 게이트가 판정한다.
 *
 * dbDedupKey 는 ROW 의 M열(dedupKey)과 같은 값이다 = 위조 없음.
 * hasEverPublished 는 false = 발행 이력 없음(신규 후보).
 */
const INJECTIONS = {
  content: '오늘 저녁은 그냥 김치찌개 끓였어요. 다들 뭐 드셨는지 궁금하네요.',
  hasEverPublished: false,
  dbDedupKey: 'sha256:base',
  contentGuard: { ok: true },
}

const r = (over = {}) => {
  const row = [...ROW]
  for (const [index, value] of Object.entries(over)) row[Number(index)] = value
  return row
}

// ─────────────────────────────────────────────────────────
// 1. 헤더 검증 fixture — negative 가 본체다
// ─────────────────────────────────────────────────────────

const HEADER_FIXTURES = [
  {
    name: '정상 17열',
    headers: SHEET_HEADERS,
    expectOk: true,
    expectKinds: [],
  },
  {
    name: '필수 컬럼 누락 (dedupKey)',
    headers: SHEET_HEADERS.filter((h) => h !== 'dedupKey'),
    expectOk: false,
    expectKinds: ['MISSING'],
  },
  {
    name: '컬럼 순서 뒤바뀜 (status ↔ board)',
    headers: SHEET_HEADERS.map((h) => (h === 'status' ? 'board' : h === 'board' ? 'status' : h)),
    expectOk: false,
    expectKinds: ['ORDER'],
  },
  {
    name: '알 수 없는 컬럼 추가',
    headers: [...SHEET_HEADERS, 'aiSummary'],
    expectOk: false,
    expectKinds: ['UNKNOWN', 'WIDTH'],
  },
  {
    name: '헤더 중복',
    headers: SHEET_HEADERS.map((h, i) => (i === 4 ? 'status' : h)),
    expectOk: false,
    expectKinds: ['DUPLICATE', 'MISSING'],
  },
  {
    name: '헤더가 배열이 아님',
    headers: 'candidateId,status',
    expectOk: false,
    expectKinds: ['SHAPE'],
  },
  {
    name: '헤더 공백 padding 은 허용 (trim)',
    headers: SHEET_HEADERS.map((h) => ` ${h} `),
    expectOk: true,
    expectKinds: [],
  },
]

// ─────────────────────────────────────────────────────────
// 2. 행 매핑 fixture
// ─────────────────────────────────────────────────────────

const MAP_FIXTURES = [
  {
    name: '주입 4개 모두 있으면 진단 없음',
    row: ROW,
    injections: INJECTIONS,
    expect: (c, d) => {
      if (d.length) return `진단이 나오면 안 된다: ${d.map((x) => x.column).join(', ')}`
      if (c.content !== INJECTIONS.content) return 'content 주입이 반영되지 않았다'
      if (c.hasEverPublished !== false) return 'hasEverPublished 주입이 반영되지 않았다'
      if (c.dbDedupKey !== 'sha256:base') return 'dbDedupKey 주입이 반영되지 않았다'
      return null
    },
  },
  {
    name: '주입 없으면 NOT_INJECTED 4건 (조용히 통과 금지)',
    row: ROW,
    injections: {},
    expect: (c, d) => {
      const missing = d.filter((x) => x.kind === 'NOT_INJECTED').map((x) => x.column).sort()
      if (missing.join(',') !== [...INJECTED_FIELDS].sort().join(','))
        return `NOT_INJECTED 가 4건이어야 한다. 받은 값: ${missing.join(', ') || '(없음)'}`
      for (const f of INJECTED_FIELDS) {
        if (f in c) return `${f} 를 지어내면 안 된다 (undefined 로 남아야 한다)`
      }
      return null
    },
  },
  {
    // 🔴 false 는 "발행 이력 없음" 이라는 유효한 답이다. 미주입과 다르다.
    name: 'hasEverPublished=false 는 주입으로 인정된다 (미주입과 구분)',
    row: ROW,
    injections: { hasEverPublished: false },
    expect: (c, d) => {
      if (c.hasEverPublished !== false) return 'false 가 주입으로 인정되지 않았다'
      if (d.some((x) => x.kind === 'NOT_INJECTED' && x.column === 'hasEverPublished'))
        return 'false 를 미주입으로 오판했다'
      return null
    },
  },
  {
    // 🔴 null 은 "DB 에 행이 없다(신규 후보)" 라는 유효한 답이다.
    //    undefined(조회하지 않음)와 뭉뚱그리면 R11 이 조용히 꺼진다.
    name: 'dbDedupKey=null 은 주입으로 인정된다 (신규 후보)',
    row: ROW,
    injections: { dbDedupKey: null },
    expect: (c, d) => {
      if (c.dbDedupKey !== null) return 'null 이 주입으로 인정되지 않았다'
      if (d.some((x) => x.kind === 'NOT_INJECTED' && x.column === 'dbDedupKey'))
        return 'null 을 미주입으로 오판했다'
      return null
    },
  },
  {
    // R11 이 대조할 두 값이 reader 를 지나며 그대로 살아 있어야 한다.
    // 여기서 reader 가 Sheet 값을 DB 값으로 덮어쓰면 위조가 사라진다.
    name: 'dedupKey 위조 시 두 값을 모두 보존한다 (덮어쓰지 않는다)',
    row: r({ 12: 'sha256:손으로바꾼값' }),
    injections: { ...INJECTIONS, dbDedupKey: 'sha256:원장값' },
    expect: (c) => {
      if (c.dedupKey !== 'sha256:손으로바꾼값') return 'Sheet dedupKey 를 덮어썼다'
      if (c.dbDedupKey !== 'sha256:원장값') return 'DB dedupKey 가 보존되지 않았다'
      return null
    },
  },
  {
    name: 'status 소문자를 교정하지 않는다 (R1 이 잡아야 한다)',
    row: r({ 1: 'pending' }),
    injections: INJECTIONS,
    expect: (c) => (c.status === 'pending' ? null : `status 를 교정했다: ${c.status}`),
  },
  {
    name: 'board 대문자를 교정하지 않는다 (R2 가 잡아야 한다)',
    row: r({ 2: 'FREE' }),
    injections: INJECTIONS,
    expect: (c) => (c.board === 'FREE' ? null : `board 를 교정했다: ${c.board}`),
  },
  {
    name: 'sourceCommentCount 0 은 파싱 실패와 구분된다',
    row: r({ 10: '0' }),
    injections: INJECTIONS,
    expect: (c, d) => {
      if (c.sourceCommentCount !== 0) return `0 이어야 한다. 받은 값: ${c.sourceCommentCount}`
      if (d.some((x) => x.kind === 'TYPE')) return '0 은 타입 오류가 아니다'
      return null
    },
  },
  {
    name: 'sourceCommentCount 비숫자 → null + TYPE 진단',
    row: r({ 10: '열두개' }),
    injections: INJECTIONS,
    expect: (c, d) => {
      if (c.sourceCommentCount !== null) return '파싱 실패는 null 이어야 한다 (0 으로 떨어뜨리지 않는다)'
      if (!d.some((x) => x.kind === 'TYPE')) return 'TYPE 진단이 없다'
      return null
    },
  },
  {
    name: 'sourceCommentCount 음수 → null + TYPE 진단',
    row: r({ 10: '-3' }),
    injections: INJECTIONS,
    expect: (c, d) =>
      c.sourceCommentCount === null && d.some((x) => x.kind === 'TYPE')
        ? null
        : '음수는 거부되어야 한다',
  },
  {
    name: '칸이 부족한 짧은 행 → 빈 문자열로 채운다',
    row: ['c1', 'HOLD', 'free'],
    injections: INJECTIONS,
    expect: (c) => (c.updatedBySystemAt === '' ? null : '없는 칸은 빈 문자열이어야 한다'),
  },
  {
    name: 'Date 셀은 문자열로 바꾸지 않는다 (parseKst 가 Date 를 받는다)',
    row: r({ 5: new Date('2026-08-26T01:30:00.000Z') }),
    injections: INJECTIONS,
    expect: (c) =>
      c.scheduledPublishAt instanceof Date ? null : 'Date 를 문자열로 바꾸면 로케일이 끼어든다',
  },
  {
    name: 'sheetRowNumber 가 붙는다 (행 추적)',
    row: ROW,
    injections: INJECTIONS,
    rowNumber: 7,
    expect: (c) => (c.sheetRowNumber === 7 ? null : `행 번호가 틀렸다: ${c.sheetRowNumber}`),
  },
]

// ─────────────────────────────────────────────────────────
// 3. reader → validator 연결 fixture
// ─────────────────────────────────────────────────────────

const PIPE_FIXTURES = [
  {
    name: '완전한 행 + 주입 → PASS',
    rows: [ROW],
    injectionsBy: { 'c0000000-0000-4000-8000-000000000000': INJECTIONS },
    expectDecisions: ['PASS'],
  },
  {
    name: 'content 미주입 PENDING → G-A HOLD (검사 안 함이 통과로 보이지 않는다)',
    rows: [ROW],
    injectionsBy: {},
    expectDecisions: ['HOLD'],
    expectRules: ['G-A'],
  },
  {
    // 🔴 R11 — Sheet M열을 손으로 고쳐 R7 을 우회하려는 시도가
    //    reader 를 지나 validator 까지 살아서 도달하는지 본다.
    name: 'Sheet dedupKey 수동 변경 → R11 REJECT',
    rows: [r({ 12: 'sha256:손으로바꾼값' })],
    injectionsBy: {
      'c0000000-0000-4000-8000-000000000000': { ...INJECTIONS, dbDedupKey: 'sha256:원장값' },
    },
    expectDecisions: ['REJECT'],
    expectRules: ['R11'],
  },
  {
    // 🔴 R9 — PUBLISHED → TAKEDOWN → PENDING 경유 우회.
    //    옛 R9(previousStatus 단일 비교)라면 직전 상태가 TAKEDOWN 이라 통과했다.
    name: 'PUBLISHED → TAKEDOWN → PENDING 우회 → R9 REJECT',
    rows: [ROW],
    injectionsBy: {
      'c0000000-0000-4000-8000-000000000000': { ...INJECTIONS, hasEverPublished: true },
    },
    expectDecisions: ['REJECT'],
    expectRules: ['R9'],
  },
  {
    // 발행된 글을 내리는 경로는 열려 있어야 한다 (§6-6 takedown).
    name: '발행 이력이 있어도 TAKEDOWN 은 통과',
    rows: [r({ 1: 'TAKEDOWN' })],
    injectionsBy: {
      'c0000000-0000-4000-8000-000000000000': { ...INJECTIONS, hasEverPublished: true },
    },
    expectDecisions: ['PASS'],
  },
  {
    // 신규 후보 — DB 에 행이 없으니 대조할 원장값도 없다. 위조가 아니다.
    name: '신규 후보 (dbDedupKey null) → PASS',
    rows: [ROW],
    injectionsBy: {
      'c0000000-0000-4000-8000-000000000000': { ...INJECTIONS, dbDedupKey: null },
    },
    expectDecisions: ['PASS'],
  },
  {
    name: 'status 소문자 → R1 HOLD',
    rows: [r({ 1: 'pending' })],
    injectionsBy: { 'c0000000-0000-4000-8000-000000000000': INJECTIONS },
    expectDecisions: ['HOLD'],
    expectRules: ['R1'],
  },
  {
    name: 'board 가 magazine → R2 HOLD (매거진 침범 차단)',
    rows: [r({ 2: 'magazine' })],
    injectionsBy: { 'c0000000-0000-4000-8000-000000000000': INJECTIONS },
    expectDecisions: ['HOLD'],
    expectRules: ['R2'],
  },
  {
    name: 'candidateId 빈칸 → R6 REJECT',
    rows: [r({ 0: '' })],
    injectionsBy: {},
    expectDecisions: ['REJECT'],
    expectRules: ['R6'],
  },
  {
    name: '과거 예약 시각 → R5 HOLD',
    rows: [r({ 5: '2026-08-01 10:30' })],
    injectionsBy: { 'c0000000-0000-4000-8000-000000000000': INJECTIONS },
    expectDecisions: ['HOLD'],
    expectRules: ['R5'],
  },
  {
    name: 'contentGuard 위반 주입 → G-B HOLD',
    rows: [ROW],
    injectionsBy: {
      'c0000000-0000-4000-8000-000000000000': {
        ...INJECTIONS,
        contentGuard: { ok: false, reason: '사용할 수 없는 표현이 있습니다' },
      },
    },
    expectDecisions: ['HOLD'],
    expectRules: ['G-B'],
  },
  {
    name: '빈 행은 후보로 세지 않는다',
    rows: [ROW, ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']],
    injectionsBy: { 'c0000000-0000-4000-8000-000000000000': INJECTIONS },
    expectDecisions: ['PASS'],
    expectBlankSkipped: 1,
  },
  {
    name: 'burst cap — PASS 2건이면 R10 으로 전부 REJECT (all-or-nothing)',
    rows: [ROW, r({ 0: 'c0000000-0000-4000-8000-000000000001', 12: 'sha256:other' })],
    injectionsBy: {
      'c0000000-0000-4000-8000-000000000000': INJECTIONS,
      // 🔴 dbDedupKey 는 행마다 그 행의 원장값이어야 한다.
      //    INJECTIONS 를 그대로 재사용하면 dedupKey 가 다른 행에서 R11 이 걸려
      //    정작 검증하려던 R10 에 도달하지 못한다.
      'c0000000-0000-4000-8000-000000000001': { ...INJECTIONS, dbDedupKey: 'sha256:other' },
    },
    expectDecisions: ['REJECT', 'REJECT'],
    expectRules: ['R10'],
  },
]

// ─────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────

async function run() {
  const report = []
  const failures = []

  const ok = (name, kind, detail) => report.push({ ok: true, kind, name, detail })
  const bad = (name, kind, message) => {
    report.push({ ok: false, kind, name, detail: message })
    failures.push(`${name} — ${message}`)
  }

  // ── 1. 헤더 ──
  for (const fx of HEADER_FIXTURES) {
    const res = validateHeaders(fx.headers)
    const kinds = [...new Set(res.errors.map((e) => e.kind))].sort()
    if (res.ok !== fx.expectOk) {
      bad(fx.name, 'header', `ok=${res.ok} 를 받았다 (기대 ${fx.expectOk}) — ${kinds.join(', ')}`)
      continue
    }
    const wanted = [...fx.expectKinds].sort()
    if (wanted.join(',') !== kinds.join(',')) {
      bad(fx.name, 'header', `오류 종류 불일치: ${kinds.join(', ') || '(없음)'} (기대 ${wanted.join(', ') || '(없음)'})`)
      continue
    }
    ok(fx.name, 'header', kinds.join(', ') || 'ok')
  }

  // ── 2. 매핑 ──
  for (const fx of MAP_FIXTURES) {
    const { candidate, diagnostics } = mapRowToCandidate(fx.row, fx.rowNumber ?? 2, fx.injections)
    const problem = fx.expect(candidate, diagnostics)
    if (problem) bad(fx.name, 'map', problem)
    else ok(fx.name, 'map', `진단 ${diagnostics.length}건`)
  }

  // ── 3. reader → validator ──
  for (const fx of PIPE_FIXTURES) {
    const source = createFixtureSource({ rows: fx.rows })
    const read = await readCandidates(source, { injectionsBy: fx.injectionsBy })

    if (!read.ok) {
      bad(fx.name, 'pipe', `헤더 검증에서 멈췄다: ${read.headerErrors.map((e) => e.kind).join(', ')}`)
      continue
    }
    if (fx.expectBlankSkipped !== undefined && read.skippedBlankRows !== fx.expectBlankSkipped) {
      bad(fx.name, 'pipe', `빈 행 스킵 ${read.skippedBlankRows}건 (기대 ${fx.expectBlankSkipped})`)
      continue
    }

    const batch = validateBatch(read.candidates, { now: NOW })
    const decisions = batch.results.map((x) => x.decision)
    if (decisions.join(',') !== fx.expectDecisions.join(',')) {
      bad(fx.name, 'pipe', `판정 ${decisions.join(', ')} (기대 ${fx.expectDecisions.join(', ')})`)
      continue
    }

    const rules = [
      ...new Set([
        ...batch.results.flatMap((x) => x.violations.map((v) => v.rule)),
        ...batch.capViolations.map((v) => v.rule),
      ]),
    ]
    if (fx.expectRules) {
      const missing = fx.expectRules.filter((rule) => !rules.includes(rule))
      if (missing.length) {
        bad(fx.name, 'pipe', `규칙 ${missing.join(', ')} 가 발동하지 않았다 (받은 규칙: ${rules.join(', ') || '없음'})`)
        continue
      }
    }
    ok(fx.name, 'pipe', `${decisions.join(', ')} [${rules.join(', ') || '위반 없음'}]`)
  }

  // ── 4. live source 는 sheetId 없이 만들어지지 않는다 ──
  //    어떤 시트를 읽는지 모르는 채로 진행하면 엉뚱한 시트를 읽고도 알 수 없다.
  //    🔴 이 fixture 는 네트워크를 타지 않는다 — sheetId 검증이 auth·fetch 보다 먼저다.
  try {
    await createGoogleSheetSource({ sheetId: '   ' })
    bad('live source 는 sheetId 없이 만들지 않는다', 'guard', '호출이 성공했다')
  } catch (e) {
    if (String(e.message).includes(MICRO_SEED_SHEET_ID_ENV)) {
      ok('live source 는 sheetId 없이 만들지 않는다', 'guard', `${MICRO_SEED_SHEET_ID_ENV} 요구`)
    } else {
      bad('live source 는 sheetId 없이 만들지 않는다', 'guard', `예상치 못한 오류: ${e.message}`)
    }
  }

  // ── 5. 읽기 전용 스코프만 쓴다 (§12-2) ──
  //    write 스코프를 미리 얻어 두면 "잘못 부르면 쓰이는" 경로가 생긴다.
  //    쓸 수 없는 토큰이면 실수해도 쓰이지 않는다.
  if (SHEET_READONLY_SCOPE.endsWith('/spreadsheets.readonly')) {
    ok('Sheet 스코프는 readonly 뿐이다', 'guard', SHEET_READONLY_SCOPE)
  } else {
    bad('Sheet 스코프는 readonly 뿐이다', 'guard', `🔴 write 가능 스코프다: ${SHEET_READONLY_SCOPE}`)
  }

  return { report, failures }
}

const isMain = process.argv[1] && process.argv[1].endsWith('micro-seed-read.mjs')
if (isMain) {
  const { report, failures } = await run()

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ report, failed: failures.length }, null, 2))
    process.exit(failures.length ? 1 : 0)
  }

  console.log('\nMicro Seed Sheet reader — fixture 자기검증')
  console.log(`  탭: ${SHEET_TAB_NAME} · 컬럼 ${SHEET_HEADERS.length}개`)
  console.log(`  주입 필드(시트에 없음): ${INJECTED_FIELDS.join(' · ')}`)
  console.log('  이 fixture 는 Google Sheet API · DB · 네트워크를 타지 않는다\n')

  const label = { header: '[헤더]  ', map: '[매핑]  ', pipe: '[연결]  ', guard: '[가드]  ' }
  for (const x of report) {
    console.log(`${x.ok ? '  ✅' : '  ❌'} ${label[x.kind]} ${x.name.padEnd(52)} → ${x.detail}`)
  }

  if (failures.length) {
    console.error(`\n❌ fixture ${failures.length}건 실패\n`)
    for (const m of failures) console.error(`  · ${m}\n`)
    process.exit(1)
  }

  console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — 17열 검증 · 매핑 · validator 연결이 설계대로 막는다\n`)
}

export { run }
