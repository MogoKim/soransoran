#!/usr/bin/env tsx
/**
 * Micro Seed 발행 계획 — tsx 진입점
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-9-B
 *
 * 🔴 이 파일은 얇다. 로직을 두지 않는다.
 *    plan 로직은 scripts/micro-seed-plan.mjs 에 있고, 여기서 하는 일은 하나다 —
 *    **src/lib 의 진짜 guard 를 주입한다.**
 *
 *    .mjs 는 .ts 를 import 할 수 없다(CI 는 Node 20 이라 타입 스트리핑도 못 쓴다).
 *    그래서 tsx 로 실행되는 이 진입점이 경계를 넘는 유일한 지점이다.
 *
 * 🔴 guard 로직을 여기 두지 않는 이유
 *    tsconfig.json 이 "exclude": ["node_modules", "scripts"] 다.
 *    scripts/ 의 .ts 는 npm run typecheck 를 받지 않는다 —
 *    여기에 로직을 두면 타입 검사 없는 코드가 된다.
 *    그래서 판정은 src/lib/micro-seed-guard.ts 가 하고 여기서는 부르기만 한다.
 *
 * 사용법
 *   npm run micro-seed:plan
 *   npm run micro-seed:plan -- --json
 */
import { guardMicroSeedCandidate, checkMicroSeedContent } from '../src/lib/micro-seed-guard'
import { checkContent, BRAND_BANNED_WORDS } from '../src/lib/content-guard'
import {
  MICRO_SEED_AUTHOR_ENV,
  MicroSeedAuthorMissingError,
  hasMicroSeedAuthorId,
  resolveMicroSeedAuthorId,
} from '../src/lib/micro-seed-author'
// @ts-expect-error — .mjs 에는 타입 선언이 없다. 런타임 계약은 fixture 가 지킨다.
import { buildPlan, ROW, LEDGER, ledger, row } from './micro-seed-plan.mjs'
// @ts-expect-error — 위와 같다.
import { createFixtureSource } from './lib/micro-seed-sheet.mjs'
// @ts-expect-error — 위와 같다.
import { createFixtureCandidateSource } from './lib/micro-seed-db.mjs'

type Check = { ok: boolean; name: string; detail: string }

const report: Check[] = []
const pass = (name: string, detail: string) => report.push({ ok: true, name, detail })
const fail = (name: string, detail: string) => report.push({ ok: false, name, detail })

/** 브랜드 금지어가 든 본문. §6-9-B 는 "원문이 그랬다는 것은 근거가 되지 않는다" 고 한다 */
const BANNED_BODY = '어르신들도 편하게 드실 수 있는 김치찌개를 끓였어요. 다들 뭐 드셨는지 궁금하네요.'

async function planWith(ledgerRows: unknown[], sheetRows: unknown[] = [ROW]) {
  return buildPlan({
    sheetSource: createFixtureSource({ rows: sheetRows }),
    candidateSource: createFixtureCandidateSource(ledgerRows),
    guardCandidate: guardMicroSeedCandidate,
  })
}

async function run() {
  // ── ① 실제 guard 로 정상 후보가 통과하는가 ────────────────
  {
    const plan = await planWith([LEDGER])
    const r = plan.rows[0]
    if (r.decision === 'PASS' && !r.unchecked.includes('contentGuard')) {
      pass('정상 본문 → G-B 통과 · contentGuard 주입됨', `${r.decision} · unchecked ${r.unchecked.length}건`)
    } else {
      fail('정상 본문 → G-B 통과 · contentGuard 주입됨', `${r.decision} · unchecked: ${r.unchecked.join(', ')}`)
    }
  }

  // ── ② 브랜드 금지어가 본문에 있으면 막는가 (§6-9-B) ───────
  {
    const plan = await planWith([ledger({ rawContent: { origin: 'live', rawBody: BANNED_BODY } })])
    const r = plan.rows[0]
    if (r.decision === 'HOLD' && r.rules.includes('G-B')) {
      pass('본문 브랜드 금지어 → G-B HOLD', `${r.decision} [${r.rules.join(', ')}]`)
    } else {
      fail('본문 브랜드 금지어 → G-B HOLD', `${r.decision} [${r.rules.join(', ')}]`)
    }
  }

  // ── ③ 제목에 있어도 막는가 ──────────────────────────────
  {
    const plan = await planWith([LEDGER], [row({ 3: '어르신 입맛에 맞는 저녁' })])
    const r = plan.rows[0]
    if (r.decision === 'HOLD' && r.rules.includes('G-B')) {
      pass('제목 브랜드 금지어 → G-B HOLD', `${r.decision} [${r.rules.join(', ')}]`)
    } else {
      fail('제목 브랜드 금지어 → G-B HOLD', `${r.decision} [${r.rules.join(', ')}]`)
    }
  }

  // ── ④ 금지어 4개 전부 잡히는가 ──────────────────────────
  {
    const missed = BRAND_BANNED_WORDS.filter((w) => checkMicroSeedContent(`${w} 이야기입니다`).ok)
    if (missed.length === 0) pass('금지어 4개 전부 차단', BRAND_BANNED_WORDS.join(' · '))
    else fail('금지어 4개 전부 차단', `놓친 단어: ${missed.join(', ')}`)
  }

  // ── ⑤ 🔴 사용자 글 경로는 바뀌지 않았는가 ────────────────
  //    checkContent 는 브랜드 금지어를 통과시켜야 한다. 여기가 막히면
  //    회원이 "어르신" 이라고 쓴 글이 거부된다 — 이 PR 이 건드리면 안 되는 지점이다.
  {
    const leaked = BRAND_BANNED_WORDS.filter((w) => !checkContent(`${w} 이야기입니다`).ok)
    if (leaked.length === 0) {
      pass('사용자 글 경로 무변경 (checkContent 는 브랜드어를 통과시킨다)', '4개 전부 통과 확인')
    } else {
      fail(
        '사용자 글 경로 무변경 (checkContent 는 브랜드어를 통과시킨다)',
        `🔴 사용자 글이 막힌다: ${leaked.join(', ')}`,
      )
    }
  }

  // ── ⑥ 기존 금칙어(욕설·연락처)는 그대로 잡히는가 ──────────
  {
    const spam = checkMicroSeedContent('카톡: abc123 으로 연락주세요')
    if (!spam.ok) pass('기존 금칙어도 계속 잡는다 (checkContent 재사용)', spam.reason)
    else fail('기존 금칙어도 계속 잡는다 (checkContent 재사용)', '연락처가 통과했다')
  }

  // ── ⑦ base 위반이면 사유를 덮어쓰지 않는가 ───────────────
  {
    const r = checkMicroSeedContent('카톡: abc123 어르신')
    const baseReason = checkContent('카톡: abc123 어르신')
    if (!r.ok && !baseReason.ok && r.reason === baseReason.reason) {
      pass('base 위반 사유를 덮어쓰지 않는다', r.reason)
    } else {
      fail('base 위반 사유를 덮어쓰지 않는다', `받은 사유: ${!r.ok ? r.reason : '(통과)'}`)
    }
  }

  // ─────────────────────────────────────────────────────────
  // 시스템 작성자 (§5-2A · §6-9-E)
  //
  // 🔴 순수 함수에 가짜 env 객체를 넘긴다. process.env 를 건드리지 않으므로
  //    이 검증이 실행 환경의 실제 설정에 영향을 주지 않는다.
  // ─────────────────────────────────────────────────────────

  // ── ⑧ env 부재 → 던진다 (폴백 없음) ──────────────────────
  {
    const cases: Array<[string, Record<string, string | undefined>]> = [
      ['미설정', {}],
      ['undefined', { [MICRO_SEED_AUTHOR_ENV]: undefined }],
      ['빈 문자열', { [MICRO_SEED_AUTHOR_ENV]: '' }],
      ['공백뿐', { [MICRO_SEED_AUTHOR_ENV]: '   ' }],
    ]
    const leaked: string[] = []
    for (const [label, env] of cases) {
      try {
        const got = resolveMicroSeedAuthorId(env)
        leaked.push(`${label} → "${got}"`)
      } catch (e) {
        if (!(e instanceof MicroSeedAuthorMissingError)) leaked.push(`${label} → 다른 오류: ${String(e)}`)
      }
    }
    if (leaked.length === 0) {
      pass('작성자 ID 부재 시 던진다 (폴백 없음)', '미설정 · undefined · 빈 문자열 · 공백 4종')
    } else {
      fail('작성자 ID 부재 시 던진다 (폴백 없음)', `🔴 값이 새어 나왔다: ${leaked.join(' / ')}`)
    }
  }

  // ── ⑨ 정상 값은 trim 해서 돌려준다 ──────────────────────
  {
    const got = resolveMicroSeedAuthorId({ [MICRO_SEED_AUTHOR_ENV]: '  micro-seed-system  ' })
    if (got === 'micro-seed-system') pass('작성자 ID 는 trim 해서 돌려준다', got)
    else fail('작성자 ID 는 trim 해서 돌려준다', `받은 값: "${got}"`)
  }

  // ── ⑩ 🔴 ID 를 코드에 하드코딩하지 않았는가 (§5-2A) ───────
  //    env 를 비워도 어떤 값이 나오면 어딘가에 박혀 있다는 뜻이다.
  {
    const empty = hasMicroSeedAuthorId({})
    const filled = hasMicroSeedAuthorId({ [MICRO_SEED_AUTHOR_ENV]: 'x' })
    if (!empty && filled) pass('ID 를 하드코딩하지 않았다 (env 로만 읽는다)', `${MICRO_SEED_AUTHOR_ENV} 단일 출처`)
    else fail('ID 를 하드코딩하지 않았다 (env 로만 읽는다)', `빈 env=${empty} · 채운 env=${filled}`)
  }

  // ── ⑪ 다른 이름의 env 를 읽지 않는가 ────────────────────
  {
    const others = {
      SORAN_ADMIN_EMAILS: 'admin@example.com',
      MICRO_SEED_AUTHOR_ID: 'wrong-name',
      SORAN_MICRO_SEED_AUTHOR: 'wrong-name-2',
    }
    if (!hasMicroSeedAuthorId(others)) {
      pass('지정된 env 이름 외에는 읽지 않는다', '유사 이름 3종 무시 확인')
    } else {
      fail('지정된 env 이름 외에는 읽지 않는다', '🔴 다른 이름에서 값을 가져왔다')
    }
  }

  return report
}

/**
 * 🔴 top-level await 를 쓰지 않는다.
 *    package.json 에 "type": "module" 이 없어 tsx 가 이 파일을 CJS 로 변환한다.
 *    "type" 을 바꾸면 기존 .mjs · .js 스크립트의 해석이 함께 달라지므로
 *    이 PR 의 범위를 넘는다 — 대신 main() 으로 감싼다.
 */
async function main() {
  const rows = await run()
  const failed = rows.filter((r) => !r.ok)

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ report: rows, failed: failed.length }, null, 2))
    process.exit(failed.length ? 1 : 0)
  }

  console.log('\nMicro Seed 발행 계획 — 실제 guard 주입 검증 (tsx)')
  console.log('  guard: src/lib/micro-seed-guard.ts (checkContent + 브랜드 금지어)')
  console.log(`  브랜드 금지어: ${BRAND_BANNED_WORDS.join(' · ')} — Micro Seed 후보에만 적용`)
  console.log('  🔴 사용자 글·댓글·매거진에는 적용하지 않는다')
  console.log('  DB write · Sheet API · 네트워크 접근 없음\n')

  for (const r of rows) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(52)} → ${r.detail}`)
  }

  if (failed.length) {
    console.error(`\n❌ ${failed.length}건 실패\n`)
    for (const r of failed) console.error(`  · ${r.name} — ${r.detail}\n`)
    process.exit(1)
  }

  console.log(`\n✅ ${rows.length}건 전부 기대와 일치 — G-B 가 실제 guard 로 판정된다\n`)
}

main()
