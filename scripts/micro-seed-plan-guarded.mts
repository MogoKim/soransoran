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
import {
  ACQUIRE_CANDIDATE_SQL,
  MAX_ATTEMPT_COUNT,
  MICRO_SEED_POST_FLAGS,
  TimeoutRecoveryWithoutProbeError,
  buildMicroSeedPostData,
  interpretAcquireResult,
  isAttemptExhausted,
  resolvePublishableBoard,
  resolveTimeoutRecovery,
  verifyPublishAuthor,
  verifyPublishablePlanRow,
  verifyPublishableOrigin,
  SHEET_WRITABLE_COLUMNS,
  CapContextNotMeasuredError,
  PostDataBypassError,
  assertMicroSeedPostData,
  requireCapContext,
  verifySheetWriteColumns,
} from '../src/lib/micro-seed-write-guard'
import type { AuthorProbe, TimeoutProbe } from '../src/lib/micro-seed-write-guard'
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

  // ─────────────────────────────────────────────────────────
  // write-path 가드 (§6-3 · §6-9-C · §6-9-E · §6-10)
  //
  // 🔴 전부 순수 판정이다. DB 접속 · Sheet API · write 가 없다.
  //    실측값은 인자로 넘긴다 — 조회했는지를 사람이 기억하는 방식으로 두지 않는다.
  // ─────────────────────────────────────────────────────────

  // ── ⑫ 원자적 획득 결과 해석 (§6-10 1차) ─────────────────
  {
    const one = interpretAcquireResult(1)
    const zero = interpretAcquireResult(0)
    const many = interpretAcquireResult(2)
    const bad = interpretAcquireResult(-1)

    if (one.kind !== 'ACQUIRED') fail('acquire 1행 → 진행', `받은 값: ${one.kind}`)
    else pass('acquire 1행 → 진행', 'ACQUIRED')

    // 🔴 0행을 "다른 워커가 가져감" 으로 단정하지 않는다.
    //    WHERE 조건이 셋이라(id · status · attemptCount) 이유가 여럿이다.
    if (zero.kind !== 'NOT_ACQUIRED_NEEDS_RECLASSIFY') {
      fail('acquire 0행 → 이유 미확정 (재조회 필요)', `받은 값: ${zero.kind}`)
    } else {
      pass('acquire 0행 → 이유 미확정 (재조회 필요)', 'NOT_ACQUIRED_NEEDS_RECLASSIFY')
    }

    if (many.kind !== 'ABORT') fail('acquire 2행 이상 → 중단', `받은 값: ${many.kind}`)
    else pass('acquire 2행 이상 → 중단', 'ABORT (id 는 PK 다)')

    if (bad.kind !== 'ABORT') fail('acquire 비정상 행 수 → 중단', `받은 값: ${bad.kind}`)
    else pass('acquire 비정상 행 수 → 중단', 'ABORT')
  }

  // ── ⑬ 획득 SQL 에 attemptCount 상한이 들어 있는가 ────────
  {
    const hasStatus = /AND status = 'PENDING'/.test(ACQUIRE_CANDIDATE_SQL)
    const hasAttempt = new RegExp(`"attemptCount" < ${MAX_ATTEMPT_COUNT}`).test(ACQUIRE_CANDIDATE_SQL)
    const sameUpdate =
      /"processingStartedAt" = now\(\)/.test(ACQUIRE_CANDIDATE_SQL) &&
      /"processingBy" = /.test(ACQUIRE_CANDIDATE_SQL)
    if (hasStatus && hasAttempt && sameUpdate) {
      pass('획득 SQL — compare-and-set + attempt 상한 + 동시 기록', "status='PENDING' · attemptCount<3 · startedAt/By 동시")
    } else {
      fail(
        '획득 SQL — compare-and-set + attempt 상한 + 동시 기록',
        `status=${hasStatus} attempt=${hasAttempt} sameUpdate=${sameUpdate}`,
      )
    }
  }

  // ── ⑭ timeout: 실측 없이 복구하면 던진다 (§6-3) ──────────
  {
    try {
      resolveTimeoutRecovery({ hasPost: undefined, attemptCount: 0 })
      fail('timeout 실측 없음 → throw', '🔴 조용히 복구했다 — 이중 발행 경로가 열린다')
    } catch (e) {
      if (e instanceof TimeoutRecoveryWithoutProbeError) pass('timeout 실측 없음 → throw', 'TimeoutRecoveryWithoutProbeError')
      else fail('timeout 실측 없음 → throw', `예상치 못한 오류: ${String(e)}`)
    }
  }

  // ── ⑭-b 🔴 attemptCount 실측 누락도 던진다 ──────────────
  //    0 으로 보정하면 select 누락이 "아직 0 회" 로 둔갑해 상한이 영원히 오지 않는다.
  {
    const cases: Array<[string, unknown]> = [
      ['undefined', undefined],
      ['NaN', Number.NaN],
      ['문자열', '2'],
      ['음수', -1],
    ]
    const leaked: string[] = []
    for (const [label, value] of cases) {
      try {
        const r = resolveTimeoutRecovery({ hasPost: false, attemptCount: value } as unknown as TimeoutProbe)
        leaked.push(`${label} → ${r.nextStatus}`)
      } catch (e) {
        if (!(e instanceof TimeoutRecoveryWithoutProbeError)) leaked.push(`${label} → 다른 오류: ${String(e)}`)
      }
    }
    if (leaked.length === 0) pass('attemptCount 미실측 → throw', 'undefined · NaN · 문자열 · 음수 4종')
    else fail('attemptCount 미실측 → throw', `🔴 복구가 진행됐다: ${leaked.join(' / ')}`)
  }

  // ── ⑮ timeout + Post 존재 → PUBLISHED 또는 SKIPPED ──────
  {
    const linked = resolveTimeoutRecovery({ hasPost: true, postLinkedToCandidate: true, attemptCount: 1 })
    const other = resolveTimeoutRecovery({ hasPost: true, postLinkedToCandidate: false, attemptCount: 1 })
    if (linked.nextStatus === 'PUBLISHED' && other.nextStatus === 'SKIPPED') {
      pass('timeout + Post 존재 → PUBLISHED / SKIPPED', '연결됨=PUBLISHED · 다른 경로=SKIPPED')
    } else {
      fail('timeout + Post 존재 → PUBLISHED / SKIPPED', `${linked.nextStatus} / ${other.nextStatus}`)
    }
  }

  // ── ⑯ timeout + Post 부재 + attempt < 3 → HOLD + attempt+1 ──
  {
    const r = resolveTimeoutRecovery({ hasPost: false, attemptCount: 0 })
    if (r.nextStatus === 'HOLD' && r.nextAttemptCount === 1) {
      pass('timeout + Post 부재 + attempt<3 → HOLD + attempt+1', `HOLD · ${r.nextAttemptCount}/${MAX_ATTEMPT_COUNT}`)
    } else {
      fail('timeout + Post 부재 + attempt<3 → HOLD + attempt+1', `${r.nextStatus} · ${r.nextAttemptCount}`)
    }
  }

  // ── ⑰ timeout + Post 부재 + attempt >= 상한 → FAILED ─────
  {
    const r = resolveTimeoutRecovery({ hasPost: false, attemptCount: MAX_ATTEMPT_COUNT - 1 })
    const exhausted = isAttemptExhausted(MAX_ATTEMPT_COUNT)
    if (r.nextStatus === 'FAILED' && exhausted) {
      pass('timeout + Post 부재 + attempt 상한 → FAILED 고정', `FAILED · ${r.nextAttemptCount}/${MAX_ATTEMPT_COUNT}`)
    } else {
      fail('timeout + Post 부재 + attempt 상한 → FAILED 고정', `${r.nextStatus} · exhausted=${exhausted}`)
    }
  }

  // ── ⑱ 🔴 timeout 은 절대 PENDING 을 돌려주지 않는다 ──────
  //    PENDING 이면 worker 가 사람 승인 없이 다시 집는다 = 자동 재발행 (§5-4 · 정책 14).
  {
    const probes = [
      { hasPost: true, postLinkedToCandidate: true, attemptCount: 0 },
      { hasPost: true, postLinkedToCandidate: false, attemptCount: 0 },
      { hasPost: false, attemptCount: 0 },
      { hasPost: false, attemptCount: 1 },
      { hasPost: false, attemptCount: MAX_ATTEMPT_COUNT },
    ]
    const leaked = probes
      .map((p) => resolveTimeoutRecovery(p).nextStatus)
      .filter((s) => s === 'PENDING')
    if (leaked.length === 0) pass('timeout 은 PENDING 을 돌려주지 않는다', `${probes.length}종 전부 확인`)
    else fail('timeout 은 PENDING 을 돌려주지 않는다', '🔴 PENDING 반환 — 자동 재발행 경로')
  }

  // ── ⑲ 작성자 검증 3종 (§5-2A · §6-9-E) ─────────────────
  {
    const base = { id: 'micro-seed-system', exists: true, providerId: null, isBlocked: false }
    const okCase = verifyPublishAuthor(base)
    const missing = verifyPublishAuthor({ ...base, exists: false })
    const realMember = verifyPublishAuthor({ ...base, providerId: 'kakao-12345' })
    const blocked = verifyPublishAuthor({ ...base, isBlocked: true })
    const emptyId = verifyPublishAuthor({ ...base, id: '   ' })

    if (!okCase.ok) fail('정상 시스템 작성자 → 통과', okCase.reason)
    else pass('정상 시스템 작성자 → 통과', 'providerId=null · isBlocked=false')

    if (missing.ok) fail('작성자 User 없음 → 중단', '🔴 통과했다')
    else pass('작성자 User 없음 → 중단', missing.reason)

    if (realMember.ok) fail('작성자가 실회원(providerId 존재) → 중단', '🔴 실회원 이름으로 발행된다')
    else pass('작성자가 실회원(providerId 존재) → 중단', realMember.reason)

    if (blocked.ok) fail('작성자 isBlocked=true → 중단', '🔴 통과했다')
    else pass('작성자 isBlocked=true → 중단', blocked.reason)

    if (emptyId.ok) fail('작성자 ID 공백 → 중단', '🔴 통과했다')
    else pass('작성자 ID 공백 → 중단', emptyId.reason)
  }

  // ── ⑲-b 🔴 실측 누락을 통과시키지 않는다 ────────────────
  //    publisher 가 select 에서 빠뜨린 필드는 undefined 로 온다.
  //    "문제 없음" 으로 읽으면 조회하지 않은 채 발행하게 된다.
  {
    const base = { id: 'micro-seed-system', exists: true, providerId: null, isBlocked: false }
    const noProviderId = verifyPublishAuthor({ ...base, providerId: undefined } as unknown as AuthorProbe)
    const noBlocked = verifyPublishAuthor({ ...base, isBlocked: undefined } as unknown as AuthorProbe)
    const noExists = verifyPublishAuthor({ ...base, exists: undefined } as unknown as AuthorProbe)

    if (noProviderId.ok) fail('providerId 미실측 → 중단', '🔴 조회하지 않았는데 통과했다')
    else pass('providerId 미실측 → 중단', noProviderId.reason)

    if (noBlocked.ok) fail('isBlocked 미실측 → 중단', '🔴 조회하지 않았는데 통과했다')
    else pass('isBlocked 미실측 → 중단', noBlocked.reason)

    if (noExists.ok) fail('exists 미실측 → 중단', '🔴 조회하지 않았는데 통과했다')
    else pass('exists 미실측 → 중단', noExists.reason)
  }

  // ── ⑳ 3축 플래그는 입력과 무관하게 true (§6-9-C) ────────
  {
    const data = buildMicroSeedPostData({
      boardType: 'FREE',
      title: '오늘 저녁 뭐 드셨어요',
      content: '김치찌개 끓였어요.',
      authorId: 'micro-seed-system',
      sheetCandidateId: 'c1',
      sourceSite: '82cook',
      sourceUrl: 'https://example.com/1',
      sourceArticleId: '1',
      sourceCapturedAt: new Date('2026-08-24T00:00:00.000Z'),
      // 🔴 뒤집으려는 시도. 상수가 이겨야 한다.
      isMicroSeed: false,
      permanentNoindex: false,
      indexPromotionBlocked: false,
      source: 'USER',
      status: 'HIDDEN',
    })
    const forced =
      data.isMicroSeed === true &&
      data.permanentNoindex === true &&
      data.indexPromotionBlocked === true &&
      data.source === MICRO_SEED_POST_FLAGS.source
    if (forced) pass('3축 플래그는 입력으로 뒤집을 수 없다', 'isMicroSeed · permanentNoindex · indexPromotionBlocked = true · source=SYSTEM')
    else fail('3축 플래그는 입력으로 뒤집을 수 없다', `🔴 ${JSON.stringify({ m: data.isMicroSeed, n: data.permanentNoindex, i: data.indexPromotionBlocked, s: data.source })}`)

    // 🔴 status 도 상수다. HIDDEN 으로 만들면 커뮤니티 목록에 안 보여
    //    레인의 목적이 사라진다 (§4 축 1 · §12-0).
    if (data.status === 'PUBLISHED') pass('status 는 입력으로 뒤집을 수 없다 (PUBLISHED 고정)', `입력 HIDDEN → ${data.status}`)
    else fail('status 는 입력으로 뒤집을 수 없다 (PUBLISHED 고정)', `🔴 ${data.status}`)
  }

  // ── ㉑ board 화이트리스트 (§6-9-D) ──────────────────────
  {
    const free = resolvePublishableBoard('free')
    const meno = resolvePublishableBoard('menopause')
    const magazine = resolvePublishableBoard('magazine')
    const best = resolvePublishableBoard('best')
    const empty = resolvePublishableBoard('')
    const okBoth = free.ok && free.boardType === 'FREE' && meno.ok && meno.boardType === 'MENOPAUSE'
    const rejected = !magazine.ok && !best.ok && !empty.ok
    if (okBoth && rejected) pass('board 는 FREE · MENOPAUSE 만 허용', 'magazine · best · 빈값 거부')
    else fail('board 는 FREE · MENOPAUSE 만 허용', `free=${free.ok} meno=${meno.ok} magazine=${magazine.ok} best=${best.ok}`)
  }

  // ── ㉒ origin 은 live 만 (§10-1 · 정책 12) ───────────────
  {
    const live = verifyPublishableOrigin('live')
    const legacy = verifyPublishableOrigin('unao_legacy')
    const empty = verifyPublishableOrigin('')
    if (live.ok && !legacy.ok && !empty.ok) pass('origin 은 live 만 허용', legacy.ok ? '' : legacy.reason)
    else fail('origin 은 live 만 허용', `live=${live.ok} legacy=${legacy.ok} empty=${empty.ok}`)
  }

  // ─────────────────────────────────────────────────────────
  // write 직전 가드 (PR-C2a-2)
  //
  // 🔴 실제 write 는 없다. 판정만 검증한다.
  // ─────────────────────────────────────────────────────────

  // ── ㉔ Sheet 쓰기 열 화이트리스트 (§6-7-A) ──────────────
  {
    const allowed = verifySheetWriteColumns([...SHEET_WRITABLE_COLUMNS])
    const founderCol = verifySheetWriteColumns(['status', 'board'])
    const systemCol = verifySheetWriteColumns(['dedupKey'])
    const title = verifySheetWriteColumns(['founderTitle'])
    const empty = verifySheetWriteColumns([])
    const notArray = verifySheetWriteColumns('status')

    if (!allowed.ok) fail('허용 4열은 통과', allowed.reason)
    else pass('허용 4열은 통과', SHEET_WRITABLE_COLUMNS.join(' · '))

    // 🔴 창업자 칸을 시스템이 쓰면 창업자가 적은 값이 조용히 사라진다.
    if (founderCol.ok) fail('창업자 칸(board) write 거부', '🔴 통과했다')
    else pass('창업자 칸(board) write 거부', founderCol.reason)

    if (title.ok) fail('창업자 칸(founderTitle) write 거부', '🔴 통과했다')
    else pass('창업자 칸(founderTitle) write 거부', title.reason)

    // collector 가 적재한 값이다. publisher 가 고치면 원장과 갈라진다.
    if (systemCol.ok) fail('collector 칸(dedupKey) write 거부', '🔴 통과했다')
    else pass('collector 칸(dedupKey) write 거부', systemCol.reason)

    if (empty.ok) fail('빈 write 거부', '🔴 통과했다')
    else pass('빈 write 거부', empty.reason)

    if (notArray.ok) fail('배열 아닌 입력 거부', '🔴 통과했다')
    else pass('배열 아닌 입력 거부', notArray.reason)
  }

  // ── ㉕ cap 실측 강제 (§6-9-F) ───────────────────────────
  //    validateBatch 는 `?? false` · `?? 0` 으로 받는다.
  //    안 넘기면 first-run guard 와 daily cap 이 조용히 열린다.
  {
    const okCtx = requireCapContext({ isFirstRun: true, publishedToday: 0 })
    if (okCtx.isFirstRun === true && okCtx.publishedToday === 0) {
      pass('실측된 cap context 는 통과', 'isFirstRun=true · publishedToday=0')
    } else {
      fail('실측된 cap context 는 통과', JSON.stringify(okCtx))
    }

    const bad: Array<[string, unknown]> = [
      ['context 없음', undefined],
      ['isFirstRun undefined', { publishedToday: 0 }],
      ['isFirstRun null', { isFirstRun: null, publishedToday: 0 }],
      ['isFirstRun 문자열', { isFirstRun: 'true', publishedToday: 0 }],
      ['publishedToday undefined', { isFirstRun: false }],
      ['publishedToday null', { isFirstRun: false, publishedToday: null }],
      ['publishedToday NaN', { isFirstRun: false, publishedToday: Number.NaN }],
      ['publishedToday 음수', { isFirstRun: false, publishedToday: -1 }],
      ['publishedToday 문자열', { isFirstRun: false, publishedToday: '3' }],
    ]
    const leaked: string[] = []
    for (const [label, ctx] of bad) {
      try {
        const got = requireCapContext(ctx)
        leaked.push(`${label} → ${JSON.stringify(got)}`)
      } catch (e) {
        if (!(e instanceof CapContextNotMeasuredError)) leaked.push(`${label} → 다른 오류: ${String(e)}`)
      }
    }
    if (leaked.length === 0) {
      pass('cap 미실측 → throw (보정 금지)', `${bad.length}종 전부`)
    } else {
      fail('cap 미실측 → throw (보정 금지)', `🔴 보정되어 통과했다: ${leaked.join(' / ')}`)
    }
  }

  // ── ㉖ Post 생성 입구 단일화 (§6-9-C) ───────────────────
  //    함수가 있다는 것과 그 함수만 쓰인다는 것은 다르다.
  {
    const good = buildMicroSeedPostData({
      boardType: 'FREE',
      title: '오늘 저녁 뭐 드셨어요',
      content: '김치찌개 끓였어요.',
      authorId: 'micro-seed-system',
      sheetCandidateId: 'c1',
      sourceSite: '82cook',
      sourceUrl: 'https://example.com/1',
      sourceArticleId: '1',
      sourceCapturedAt: new Date('2026-08-24T00:00:00.000Z'),
    })
    try {
      assertMicroSeedPostData(good)
      pass('buildMicroSeedPostData 산출물은 통과', '3축 · source · status 일치')
    } catch (e) {
      fail('buildMicroSeedPostData 산출물은 통과', String(e))
    }

    // 🔴 게이트를 거치지 않고 직접 만든 payload — 우회 시도
    const bypasses: Array<[string, Record<string, unknown>]> = [
      ['3축 없음 (raw create)', { boardType: 'FREE', title: 't', content: 'c', authorId: 'a' }],
      ['isMicroSeed=false', { ...good, isMicroSeed: false }],
      ['permanentNoindex=false', { ...good, permanentNoindex: false }],
      ['indexPromotionBlocked=false', { ...good, indexPromotionBlocked: false }],
      ['source=USER', { ...good, source: 'USER' }],
      ['status=HIDDEN', { ...good, status: 'HIDDEN' }],
      ['null', null as unknown as Record<string, unknown>],
    ]
    const passed: string[] = []
    for (const [label, data] of bypasses) {
      try {
        assertMicroSeedPostData(data)
        passed.push(label)
      } catch (e) {
        if (!(e instanceof PostDataBypassError)) passed.push(`${label}(다른 오류: ${String(e)})`)
      }
    }
    if (passed.length === 0) {
      pass('게이트 우회 payload 는 전부 거부', `${bypasses.length}종`)
    } else {
      fail('게이트 우회 payload 는 전부 거부', `🔴 통과했다: ${passed.join(', ')}`)
    }
  }

  // ── ㉓ unchecked 가 있으면 발행 불가 ────────────────────
  {
    const clean = verifyPublishablePlanRow({ decision: 'PASS', unchecked: [] })
    const dirty = verifyPublishablePlanRow({ decision: 'PASS', unchecked: ['contentGuard'] })
    const notPass = verifyPublishablePlanRow({ decision: 'HOLD', rules: ['G-A'], unchecked: [] })
    if (clean.ok && !dirty.ok && !notPass.ok) {
      pass('unchecked 1건이라도 있으면 발행 불가', dirty.ok ? '' : dirty.reason)
    } else {
      fail('unchecked 1건이라도 있으면 발행 불가', `clean=${clean.ok} dirty=${dirty.ok} notPass=${notPass.ok}`)
    }
  }

  // ─────────────────────────────────────────────────────────
  // live dry-run 안전장치 (PR-B2·C2b 사이)
  //
  // 🔴 소스를 문자열로 읽어 검사한다. 실행하지 않는다 —
  //    "쓰지 않는다" 를 사람이 기억하는 방식으로 두지 않는다.
  // ─────────────────────────────────────────────────────────

  // ── ㉗ live 판정 경로가 write 를 쥐지 않는가 ──────────────
  {
    const { readFileSync } = await import('node:fs')
    const { join, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))

    // 🔴 Sheet lib 은 이제 write 함수를 **품는다** (PR-C2b 선행 · updateCandidateRow).
    //    그래서 "이 파일에 write 호출이 없다" 로는 더 이상 검사할 수 없다.
    //    지켜야 할 것은 파일의 순결이 아니라 **live 판정 경로가 쓰지 않는다** 이므로
    //    검사를 둘로 나눈다:
    //      · SHEET_LIB     — write 호출이 updateCandidateRow 본문 **안에만** 있는가
    //      · 나머지 live 파일 — write 호출이 아예 없는가 + write 함수를 손에 쥐지 않는가
    const SHEET_LIB = 'lib/micro-seed-sheet.mjs'
    const LIVE_FILES = [
      'lib/micro-seed-db.mjs',
      SHEET_LIB,
      'micro-seed-dry-run-live.mts',
      'micro-seed-inventory.mts',
    ]
    // 주석·문자열이 아니라 실제 호출만 본다.
    const DB_WRITE = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/
    const RAW_SQL = /\$(executeRaw|queryRaw)/
    const SHEET_WRITE = /values\.(update|append|batchUpdate)|values:batchUpdate|:append\b|method:\s*['"](PUT|POST|PATCH)/
    // live 판정 스크립트가 write 함수를 import 하면 한 줄만 더 쓰면 쓰이게 된다.
    const WRITE_FN = /\b(updateCandidateRow|planSheetWrite|SHEET_WRITE_SCOPE)\b/

    /** `export (async) function name(...)` 의 본문을 중괄호 균형으로 잘라낸다.
     *  파라미터 괄호를 먼저 닫는다 — 구조분해 파라미터의 `{` 를 본문으로 읽으면 안 된다. */
    const fnBody = (src: string, name: string): string | null => {
      const m = src.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*\\(`))
      if (!m || m.index === undefined) return null
      const open = src.indexOf('(', m.index)
      if (open === -1) return null
      let pd = 0
      let close = -1
      for (let j = open; j < src.length; j += 1) {
        if (src[j] === '(') pd += 1
        else if (src[j] === ')') {
          pd -= 1
          if (pd === 0) { close = j; break }
        }
      }
      if (close === -1) return null
      const start = src.indexOf('{', close)
      if (start === -1) return null
      let depth = 0
      for (let j = start; j < src.length; j += 1) {
        if (src[j] === '{') depth += 1
        else if (src[j] === '}') {
          depth -= 1
          if (depth === 0) return src.slice(start, j + 1)
        }
      }
      return null
    }

    const offenders: string[] = []
    for (const rel of LIVE_FILES) {
      let text: string
      try {
        text = readFileSync(join(here, rel), 'utf-8')
      } catch {
        offenders.push(`${rel} 를 읽지 못했다`)
        continue
      }
      // 주석 줄을 걷어낸다 — 설명에 등장하는 것까지 막으면 문서를 못 쓴다.
      const code = text
        .split('\n')
        .filter((l) => !/^\s*(\*|\/\/|--)/.test(l))
        .join('\n')

      if (DB_WRITE.test(code)) offenders.push(`${rel}: DB write 메서드`)
      if (RAW_SQL.test(code)) offenders.push(`${rel}: raw SQL 실행`)

      if (rel === SHEET_LIB) {
        // write 호출은 허용하되, updateCandidateRow 밖에 있으면 안 된다.
        const body = fnBody(code, 'updateCandidateRow')
        if (!body) {
          offenders.push(`${rel}: updateCandidateRow 본문을 찾지 못했다`)
        } else {
          const outside = code.replace(body, '')
          if (SHEET_WRITE.test(outside)) {
            offenders.push(`${rel}: Sheet write API 가 updateCandidateRow 밖에 있다`)
          }
        }
      } else {
        if (SHEET_WRITE.test(code)) offenders.push(`${rel}: Sheet write API`)
        if (WRITE_FN.test(code)) offenders.push(`${rel}: write 함수/스코프를 참조한다`)
      }
    }

    if (offenders.length === 0) {
      pass('live 판정 경로가 write 를 쥐지 않는다', `${LIVE_FILES.length}개 파일 검사`)
    } else {
      fail('live 판정 경로가 write 를 쥐지 않는다', `🔴 ${offenders.join(' / ')}`)
    }
  }

  // ── ㉘ legacy 본문은 조회 단계에서 배제된다 (§10-1) ──────
  //    rawBody 를 Candidate 조회에 넣지 않고 origin='live' 인 것만 별도로 가져오는지.
  {
    const { readFileSync } = await import('node:fs')
    const { join, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = dirname(fileURLToPath(import.meta.url))
    const dbSrc = readFileSync(join(here, 'lib/micro-seed-db.mjs'), 'utf-8')

    // Candidate 조회의 rawContent select 에 rawBody 가 없어야 한다.
    const candidateSelect = /rawContent:\s*\{\s*select:\s*\{([^}]*)\}/.exec(dbSrc)?.[1] ?? ''
    const bodyInCandidateQuery = /rawBody/.test(candidateSelect)
    // 별도 쿼리에 origin 필터가 있어야 한다.
    const separateQuery = /microSeedRawContent\.findMany[\s\S]{0,300}origin:/.test(dbSrc)

    if (!bodyInCandidateQuery && separateQuery) {
      pass('legacy 본문은 조회 단계에서 배제된다', 'Candidate select 에 rawBody 없음 · 별도 쿼리에 origin 필터')
    } else {
      fail(
        'legacy 본문은 조회 단계에서 배제된다',
        `🔴 candidate select 에 rawBody=${bodyInCandidateQuery} · origin 필터 쿼리=${separateQuery}`,
      )
    }
  }

  // ── ㉙ 작성자 미조회·부재면 발행 가능이 되지 않는다 ───────
  //    dry-run 은 planVerdict.ok && authorVerdict.ok 로 publishable 을 정한다.
  {
    const cleanRow = { decision: 'PASS', rules: [], unchecked: [] }
    const planOk = verifyPublishablePlanRow(cleanRow)

    const authorCases: Array<[string, AuthorProbe]> = [
      ['User 없음', { id: 'x', exists: false, providerId: null, isBlocked: false }],
      ['실회원', { id: 'x', exists: true, providerId: 'kakao-1', isBlocked: false }],
      ['차단됨', { id: 'x', exists: true, providerId: null, isBlocked: true }],
      ['providerId 미조회', { id: 'x', exists: true, providerId: undefined, isBlocked: false } as unknown as AuthorProbe],
      ['isBlocked 미조회', { id: 'x', exists: true, providerId: null, isBlocked: undefined } as unknown as AuthorProbe],
    ]
    const leaked: string[] = []
    for (const [label, probe] of authorCases) {
      const publishable = planOk.ok && verifyPublishAuthor(probe).ok
      if (publishable) leaked.push(label)
    }
    if (leaked.length === 0) {
      pass('작성자 문제면 후보가 PASS 여도 발행 불가', `${authorCases.length}종 전부`)
    } else {
      fail('작성자 문제면 후보가 PASS 여도 발행 불가', `🔴 발행 가능으로 나왔다: ${leaked.join(', ')}`)
    }
  }

  // ── ㉚ cap 미실측이면 판정 자체가 진행되지 않는다 ────────
  //    dry-run 은 requireCapContext 를 validateBatch 앞에 둔다. 던지면 그 뒤가 없다.
  {
    const notMeasured: unknown[] = [undefined, {}, { isFirstRun: true }, { publishedToday: 0 }]
    const leaked: string[] = []
    for (const ctx of notMeasured) {
      try {
        requireCapContext(ctx)
        leaked.push(JSON.stringify(ctx))
      } catch (e) {
        if (!(e instanceof CapContextNotMeasuredError)) leaked.push(`다른 오류: ${String(e)}`)
      }
    }
    if (leaked.length === 0) {
      pass('cap 미실측이면 판정 전에 멈춘다', `${notMeasured.length}종 전부 throw`)
    } else {
      fail('cap 미실측이면 판정 전에 멈춘다', `🔴 통과했다: ${leaked.join(' / ')}`)
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
