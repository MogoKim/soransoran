#!/usr/bin/env node
/**
 * Micro Seed 발행 계획 — dry-run plan
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-8 · §6-9 · §10-1
 *
 * Sheet reader → DB 주입 → validator 판정을 한 줄로 잇고, 그 결과를 사람이 보는
 * 계획표로 낸다. 이 스크립트가 답하는 질문은 하나다.
 *
 *   "지금 승인된 후보들을 발행하면 무엇이 나가고 무엇이 막히는가?"
 *
 * 🔴 이 스크립트는 아무것도 발행하지 않는다
 *    DB write 없음 · Sheet API 없음 · 네트워크 없음 · 파일 쓰기 없음.
 *    source 는 fixture 뿐이다. 실제 원장 조회는 운영 경로(PR-C2 이후)의 일이다.
 *
 * 🔴 PASS 는 "발행해도 된다" 가 아니다
 *    contentGuard 가 아직 주입되지 않는다(PR-C1 범위 밖). 즉 G-B 는 판정되지 않는다.
 *    비어 있는 것은 "위반 없음" 이 아니라 "검사하지 않음" 이다 — 리포트가 그 사실을 표시한다.
 *
 * 사용법
 *   node scripts/micro-seed-plan.mjs           fixture 자기검증
 *   node scripts/micro-seed-plan.mjs --json    결과를 JSON 으로
 */
import { SHEET_HEADERS, INJECTED_FIELDS, readCandidates, createFixtureSource } from './lib/micro-seed-sheet.mjs'
import { loadInjections, createFixtureCandidateSource, PUBLISHABLE_ORIGINS } from './lib/micro-seed-db.mjs'
import { validateBatch } from './micro-seed-validate.mjs'

/** 고정 시각 — validator·reader 와 같은 기준 */
const NOW = new Date('2026-08-25T00:00:00.000Z')

const ID_A = 'c0000000-0000-4000-8000-00000000000a'
const ID_B = 'c0000000-0000-4000-8000-00000000000b'

/** 17칸이 다 찬 정상 Sheet 행 */
const ROW = [
  ID_A,
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

const row = (over = {}) => {
  const r = [...ROW]
  for (const [i, v] of Object.entries(over)) r[Number(i)] = v
  return r
}

/** 원장 1행 — 정상 후보 */
const LEDGER = {
  id: ID_A,
  dedupKey: 'sha256:base',
  createdPostId: null,
  rawContent: { origin: 'live', rawBody: '오늘 저녁은 그냥 김치찌개 끓였어요. 다들 뭐 드셨는지 궁금하네요.' },
  hasPublishedHistory: false,
}

const ledger = (over = {}) => ({ ...LEDGER, ...over })

// ─────────────────────────────────────────────────────────
// plan
// ─────────────────────────────────────────────────────────

/**
 * Sheet → DB 주입 → validator 판정.
 *
 * @param sheetSource      SheetSource (fixture)
 * @param candidateSource  CandidateSource (fixture)
 */
export async function buildPlan({ sheetSource, candidateSource, now = NOW }) {
  // ① Sheet 를 먼저 읽는다. 주입 없이 후보 목록만 얻는다 —
  //    누구를 조회할지 알아야 원장을 볼 수 있기 때문이다.
  const firstPass = await readCandidates(sheetSource)
  if (!firstPass.ok) {
    return { ok: false, headerErrors: firstPass.headerErrors, rows: [], diagnostics: [] }
  }

  const ids = firstPass.candidates.map((c) => c.candidateId).filter(Boolean)

  // ② 원장에서 주입값을 도출한다. 조회 실패는 throw 로 올라간다 (삼키지 않는다).
  const { injectionsBy, diagnostics: dbDiagnostics } = await loadInjections(ids, candidateSource)

  // ③ 주입을 얹어 다시 읽는다. reader 가 미주입을 NOT_INJECTED 로 표시한다.
  const second = await readCandidates(sheetSource, { injectionsBy })

  // ④ 판정
  const batch = validateBatch(second.candidates, { now })

  const rows = batch.results.map((r, i) => ({
    candidateId: r.candidateId,
    decision: r.decision,
    rules: [...new Set(r.violations.map((v) => v.rule))],
    sheetRowNumber: second.candidates[i]?.sheetRowNumber ?? null,
    /** 🔴 이 후보에 대해 판정되지 않은 게이트 — PASS 를 "발행 가능" 으로 읽지 않게 한다 */
    unchecked: second.diagnostics
      .filter((d) => d.kind === 'NOT_INJECTED' && d.rowNumber === second.candidates[i]?.sheetRowNumber)
      .map((d) => d.column),
  }))

  return {
    ok: true,
    headerErrors: [],
    batchDecision: batch.batchDecision,
    capViolations: batch.capViolations,
    rows,
    diagnostics: [...dbDiagnostics, ...second.diagnostics],
  }
}

// ─────────────────────────────────────────────────────────
// fixture — negative 가 본체다
// ─────────────────────────────────────────────────────────

const FIXTURES = [
  {
    name: '정상 후보 — content 주입 → PASS',
    rows: [ROW],
    ledger: [LEDGER],
    expect: { decisions: ['PASS'], rules: [], diagnostics: [] },
  },
  {
    name: 'legacy 원문 → content 미주입 + G-A HOLD (§10-1 코드 배제)',
    rows: [ROW],
    ledger: [ledger({ rawContent: { origin: 'unao_legacy', rawBody: '우나어 원문' } })],
    expect: { decisions: ['HOLD'], rules: ['G-A'], diagnostics: ['LEGACY_EXCLUDED'] },
  },
  {
    name: '원장에 없는 후보 → dbDedupKey null · hasEverPublished false',
    rows: [ROW],
    ledger: [],
    expect: { decisions: ['HOLD'], rules: ['G-A'], diagnostics: ['NOT_IN_LEDGER'] },
  },
  {
    name: '원문 미연결 → content 미주입',
    rows: [ROW],
    ledger: [ledger({ rawContent: null })],
    expect: { decisions: ['HOLD'], rules: ['G-A'], diagnostics: ['NO_RAW_CONTENT'] },
  },
  {
    name: 'Sheet dedupKey 위조 → R11 REJECT',
    rows: [row({ 12: 'sha256:손으로바꾼값' })],
    ledger: [LEDGER],
    expect: { decisions: ['REJECT'], rules: ['R11'], diagnostics: [] },
  },
  {
    name: 'createdPostId 만 있는 발행 이력 → R9 REJECT',
    rows: [ROW],
    ledger: [ledger({ createdPostId: 'post-1' })],
    expect: { decisions: ['REJECT'], rules: ['R9'], diagnostics: ['PUBLISH_TRACE_MISMATCH'] },
  },
  {
    name: 'history 만 있는 발행 이력 → R9 REJECT',
    rows: [ROW],
    ledger: [ledger({ hasPublishedHistory: true })],
    expect: { decisions: ['REJECT'], rules: ['R9'], diagnostics: ['PUBLISH_TRACE_MISMATCH'] },
  },
  {
    name: '발행 흔적 둘 다 있으면 불일치 진단 없음',
    rows: [ROW],
    ledger: [ledger({ createdPostId: 'post-1', hasPublishedHistory: true })],
    expect: { decisions: ['REJECT'], rules: ['R9'], diagnostics: [] },
  },
  {
    name: '발행 이력이 있어도 TAKEDOWN 은 통과 (§6-6)',
    rows: [row({ 1: 'TAKEDOWN' })],
    ledger: [ledger({ createdPostId: 'post-1', hasPublishedHistory: true })],
    expect: { decisions: ['PASS'], rules: [], diagnostics: [] },
  },
]

// ─────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────

async function run() {
  const report = []
  const failures = []
  const ok = (name, detail) => report.push({ ok: true, name, detail })
  const bad = (name, msg) => {
    report.push({ ok: false, name, detail: msg })
    failures.push(`${name} — ${msg}`)
  }

  for (const fx of FIXTURES) {
    const plan = await buildPlan({
      sheetSource: createFixtureSource({ rows: fx.rows }),
      candidateSource: createFixtureCandidateSource(fx.ledger),
    })

    if (!plan.ok) {
      bad(fx.name, `헤더 검증에서 멈췄다: ${plan.headerErrors.map((e) => e.kind).join(', ')}`)
      continue
    }

    const decisions = plan.rows.map((r) => r.decision)
    if (decisions.join(',') !== fx.expect.decisions.join(',')) {
      bad(fx.name, `판정 ${decisions.join(', ')} (기대 ${fx.expect.decisions.join(', ')})`)
      continue
    }

    const rules = [...new Set(plan.rows.flatMap((r) => r.rules))]
    const missingRules = fx.expect.rules.filter((r) => !rules.includes(r))
    if (missingRules.length) {
      bad(fx.name, `규칙 ${missingRules.join(', ')} 미발동 (받은 규칙: ${rules.join(', ') || '없음'})`)
      continue
    }

    const kinds = [...new Set(plan.diagnostics.map((d) => d.kind))]
    const missingDiag = fx.expect.diagnostics.filter((k) => !kinds.includes(k))
    if (missingDiag.length) {
      bad(fx.name, `진단 ${missingDiag.join(', ')} 없음 (받은 진단: ${kinds.join(', ') || '없음'})`)
      continue
    }
    // 기대하지 않은 DB 진단이 섞이면 그것도 실패다 — 조용한 오작동을 막는다.
    const dbKinds = kinds.filter((k) =>
      ['NOT_IN_LEDGER', 'NO_RAW_CONTENT', 'LEGACY_EXCLUDED', 'PUBLISH_TRACE_MISMATCH'].includes(k),
    )
    const unexpected = dbKinds.filter((k) => !fx.expect.diagnostics.includes(k))
    if (unexpected.length) {
      bad(fx.name, `기대하지 않은 진단: ${unexpected.join(', ')}`)
      continue
    }

    ok(fx.name, `${decisions.join(', ')} [${rules.join(', ') || '위반 없음'}]${dbKinds.length ? ' · ' + dbKinds.join(', ') : ''}`)
  }

  // ── 조회 실패는 빈 결과가 아니라 throw 여야 한다 ──────────
  const throwingSource = {
    describe: () => 'throwing',
    async fetchCandidates() {
      throw new Error('connection refused')
    },
  }
  try {
    await loadInjections([ID_A], throwingSource)
    bad('원장 조회 실패는 throw 한다', '조용히 통과했다 — 빈 결과를 돌려주면 게이트가 전부 꺼진다')
  } catch (e) {
    if (String(e.message).includes('원장 조회 실패')) ok('원장 조회 실패는 throw 한다', 'throw 확인')
    else bad('원장 조회 실패는 throw 한다', `예상치 못한 오류: ${e.message}`)
  }

  // ── source 없이 부르면 거부한다 ─────────────────────────
  try {
    await loadInjections([ID_A], null)
    bad('source 없이 주입하지 않는다', '호출이 성공했다')
  } catch (e) {
    if (String(e.message).includes('CandidateSource')) ok('source 없이 주입하지 않는다', '거부 확인')
    else bad('source 없이 주입하지 않는다', `예상치 못한 오류: ${e.message}`)
  }

  // ── contentGuard 는 PR-C1 에서 주입하지 않는다 ──────────
  const plan = await buildPlan({
    sheetSource: createFixtureSource({ rows: [ROW] }),
    candidateSource: createFixtureCandidateSource([LEDGER]),
  })
  const unchecked = plan.rows[0]?.unchecked ?? []
  if (unchecked.includes('contentGuard')) {
    ok('contentGuard 미판정이 리포트에 드러난다', `unchecked: ${unchecked.join(', ')}`)
  } else {
    bad('contentGuard 미판정이 리포트에 드러난다', `unchecked 에 contentGuard 가 없다: ${unchecked.join(', ') || '(없음)'}`)
  }

  // ── 배치 안에서 서로 다른 후보가 각자의 원장값을 받는지 ──
  const twoRows = [ROW, row({ 0: ID_B, 12: 'sha256:other' })]
  const twoLedger = [LEDGER, ledger({ id: ID_B, dedupKey: 'sha256:other' })]
  const twoPlan = await buildPlan({
    sheetSource: createFixtureSource({ rows: twoRows }),
    candidateSource: createFixtureCandidateSource(twoLedger),
  })
  // 둘 다 PASS 면 R10 burst cap(1건)에 걸려 전부 REJECT 가 정상이다.
  if (twoPlan.rows.every((r) => r.decision === 'REJECT') && twoPlan.capViolations.length) {
    ok('후보마다 자기 원장값을 받는다 (R11 오탐 없음)', 'R10 까지 도달 — R11 에 걸리지 않았다')
  } else {
    bad(
      '후보마다 자기 원장값을 받는다 (R11 오탐 없음)',
      `판정 ${twoPlan.rows.map((r) => `${r.decision}[${r.rules.join(',')}]`).join(' · ')}`,
    )
  }

  return { report, failures }
}

const isMain = process.argv[1] && process.argv[1].endsWith('micro-seed-plan.mjs')
if (isMain) {
  const { report, failures } = await run()

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ report, failed: failures.length }, null, 2))
    process.exit(failures.length ? 1 : 0)
  }

  console.log('\nMicro Seed 발행 계획 — dry-run plan')
  console.log(`  Sheet 17열 → 원장 주입 → R1~R11 · G-A · G-B 판정`)
  console.log(`  발행 가능 origin: ${PUBLISHABLE_ORIGINS.join(' · ')} (unao_legacy 는 코드로 배제)`)
  console.log(`  주입 필드: ${INJECTED_FIELDS.join(' · ')}`)
  console.log('  🔴 contentGuard 는 PR-C1 에서 주입하지 않는다 — PASS 는 "발행 가능" 이 아니다')
  console.log('  DB write · Sheet API · 네트워크 접근 없음\n')

  for (const x of report) {
    console.log(`  ${x.ok ? '✅' : '❌'} ${x.name.padEnd(54)} → ${x.detail}`)
  }

  if (failures.length) {
    console.error(`\n❌ fixture ${failures.length}건 실패\n`)
    for (const m of failures) console.error(`  · ${m}\n`)
    process.exit(1)
  }

  console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — 원장 주입이 설계대로 게이트를 채운다\n`)
}

export { run }
