#!/usr/bin/env tsx
/**
 * Micro Seed 발행 판정 — live dry-run
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-8 · §6-9 · §12-2
 *
 * 실제 Google Sheet 와 실제 DB 원장을 읽어 후보가 PASS / HOLD / REJECT 인지 판정한다.
 *
 *   micro-seed:inventory      live Sheet 를 **세기만** 한다
 *   micro-seed:dry-run-live   live Sheet + DB 원장으로 **판정**한다   ← 이 파일
 *   micro-seed:plan           fixture 로 게이트 자체를 검증한다
 *
 * 🔴 발행하지 않는다
 *    DB write 없음 · Sheet write 없음 · Post.create 없음 · status 변경 없음.
 *    Sheet 는 spreadsheets.readonly 스코프라 **토큰 자체가 쓸 수 없고**,
 *    DB 는 select · count 만 부른다.
 *
 * 🔴 plan 결과를 신뢰하지 않는다
 *    guardMicroSeedCandidate 를 여기서 **직접 호출**한다. plan 은 guard 를 주입받는
 *    구조라 가짜 guard 를 넣으면 unchecked 가 빈 PASS 를 만들 수 있다.
 *
 * 🔴 PASS 는 "발행하라" 가 아니라 "지금 발행하면 막히지 않는다" 이다
 *    실제 발행은 publisher(PR-C2b)가 하고, 그때 같은 판정을 다시 한다.
 *
 * 사전 준비
 *   1. SA 의 [권한] 탭에 roles/iam.serviceAccountTokenCreator (로그인 계정 대상)
 *   2. gcloud auth application-default login \
 *        --impersonate-service-account=micro-seed-reader@project-8687edda-dc1b-4c7d-95a.iam.gserviceaccount.com
 *   3. .env.local 에 SORAN_MICRO_SEED_SHEET_ID · SORAN_MICRO_SEED_AUTHOR_ID · DATABASE_URL
 *
 * 사용법
 *   npm run micro-seed:dry-run-live
 *   npm run micro-seed:dry-run-live -- --json
 */
import { guardMicroSeedCandidate } from '../src/lib/micro-seed-guard'
import { getMicroSeedAuthorId, MICRO_SEED_AUTHOR_ENV } from '../src/lib/micro-seed-author'
import {
  requireCapContext,
  verifyPublishAuthor,
  verifyPublishablePlanRow,
} from '../src/lib/micro-seed-write-guard'
import { createGoogleSheetSource, readCandidates, SHEET_TAB_NAME, MICRO_SEED_SHEET_ID_ENV } from './lib/micro-seed-sheet.mjs'
import { createPrismaCandidateSource, loadInjections, PUBLISHABLE_ORIGINS } from './lib/micro-seed-db.mjs'
import { validateBatch } from './micro-seed-validate.mjs'

/**
 * 배치 판정에서 빼는 상태 — **이번에 발행될 수 없는 행**이다.
 *
 * 🔴 "terminal" 이라고 부르지 않는다. FAILED 는 attempt 상한 전이면 재시도 여지가 있어
 *    엄밀히 끝난 것이 아니다. 그래도 **지금 발행 대기는 아니므로** 여기 넣는다 —
 *    기준은 "끝났는가" 가 아니라 "이번에 발행되는가" 다.
 *
 * 🔴 FAILED 를 넣은 이유 (2026-08-26 보정)
 *    PENDING 이 아닌 행은 발행 게이트를 건너뛰어 "위반 없음 PASS" 가 된다.
 *    cap 오탐은 R10 수정이 막았지만, 리포트에는 **실패한 글이 PASS 로** 보였다.
 *    판정이 무의미한 행을 통과처럼 보여주면 읽는 사람이 잘못 믿는다.
 *
 * 🔴 db.mjs 의 TERMINAL_STATUSES 와 값이 같아졌지만 목적이 다르다.
 *    그쪽은 retentionUntil 계산용이다. 한쪽이 바뀌어도 다른 쪽이 따라가면 안 되므로 따로 둔다.
 */
const NON_AWAITING_STATUSES: readonly string[] = [
  'PUBLISHED', 'SKIPPED', 'DECLINED', 'TAKEDOWN', 'FAILED',
]

type Diagnostic = { kind: string; candidateId?: string; rowNumber?: number; column?: string; message: string }
type HeaderError = { kind: string; column?: string; message: string }

async function loadEnvLocal() {
  // dotenv 의존성을 더하지 않는다 — 이 스크립트 하나 때문에 공용 package.json 을 늘리지 않는다.
  const { readFileSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, key, rawValue] = m
    if (process.env[key] !== undefined) continue // 실제 env 가 이긴다
    process.env[key] = rawValue.replace(/^["']|["']$/g, '')
  }
}

async function main() {
  await loadEnvLocal()

  // ── ① live Sheet ────────────────────────────────────────
  const sheetSource = await createGoogleSheetSource()

  // ── ② 헤더 검증 + 매핑 (주입 없이 후보 목록만) ───────────
  const firstPass = await readCandidates(sheetSource)
  if (!firstPass.ok) {
    console.error('\n❌ 시트 헤더가 정본 17열과 다르다\n')
    for (const e of firstPass.headerErrors as HeaderError[]) console.error(`  · [${e.kind}] ${e.message}`)
    console.error('\n헤더를 고치기 전에는 판정하지 않는다.\n')
    process.exit(1)
  }

  const candidates = firstPass.candidates as Array<Record<string, unknown>>
  // ── ③ candidateId 추출 ──────────────────────────────────
  const ids = candidates.map((c) => c.candidateId).filter(Boolean) as string[]

  // ── ④ live DB 원장 ──────────────────────────────────────
  const candidateSource = await createPrismaCandidateSource()

  try {
    // ── ⑨ 작성자 실측 (판정 대상이 없어도 확인한다 — 설정 문제를 미리 드러낸다)
    const authorId = getMicroSeedAuthorId()
    const authorProbe = await candidateSource.fetchAuthor(authorId)
    const authorVerdict = verifyPublishAuthor(authorProbe)

    // ── ⑦ cap 실측 ────────────────────────────────────────
    const capMeasured = await candidateSource.measureCapContext()
    const cap = requireCapContext(capMeasured)

    // ── 판정 대상이 없으면 여기서 끝낸다 (실패가 아니다) ────
    if (ids.length === 0) {
      report({
        tab: SHEET_TAB_NAME,
        candidates: [],
        excluded: [],
        diagnostics: [],
        cap,
        author: { ...authorProbe, verdict: authorVerdict },
        batchDecision: null,
      })
      return
    }

    // ── ⑤ 주입 도출 ───────────────────────────────────────
    const { injectionsBy, diagnostics: dbDiagnostics } = (await loadInjections(ids, candidateSource)) as {
      injectionsBy: Record<string, Record<string, unknown>>
      diagnostics: Diagnostic[]
    }

    // ── ⑥ guard 직접 호출 ─────────────────────────────────
    //    🔴 plan 을 거치지 않는다. 여기서 진짜 guard 를 부른다.
    const guardDiagnostics: Diagnostic[] = []
    for (const c of candidates) {
      const id = c.candidateId as string
      const inj = injectionsBy[id]
      if (!inj) continue

      // 본문이 없으면 검사하지 않는다 — 제목만 보고 ok 를 내면
      // "본문은 안 봤는데 G-B 통과" 가 기록에 남는다.
      if (typeof inj.content !== 'string' || !inj.content.trim()) {
        guardDiagnostics.push({
          kind: 'GUARD_SKIPPED_NO_CONTENT',
          candidateId: id,
          message: '본문이 없어 contentGuard 를 검사하지 않는다 (G-B 는 판정하지 않음)',
        })
        continue
      }
      inj.contentGuard = guardMicroSeedCandidate({
        founderTitle: c.founderTitle as string,
        content: inj.content,
      })
    }

    // 주입을 얹어 다시 읽는다 — reader 가 미주입을 NOT_INJECTED 로 표시한다.
    const second = await readCandidates(sheetSource, { injectionsBy })

    // ── ⑦-B 발행 대기가 아닌 행을 배치에서 뺀다 ───────────
    //
    // 🔴 왜 빼는가
    //    validateCandidate 는 PENDING 이 아닌 행의 발행 게이트를 건너뛴다.
    //    그래서 이미 발행이 끝난 PUBLISHED 행도 "위반 없음 PASS" 로 나오고,
    //    R10 cap 이 그것까지 세어 **발행 대기가 1건인데 REJECT** 를 낸다(2026-08-26 실측).
    //
    //    R10 자체는 validate.mjs 에서 "발행 대기(PENDING)만 센다" 로 고쳤다.
    //    여기서 한 번 더 빼는 것은 **판정 대상 자체를 좁혀** 리포트를 읽기 쉽게 하려는 것이다 —
    //    발행되지 않을 행에 대한 PASS/REJECT 는 의미가 없고, PASS 로 보이면 오해를 만든다.
    //
    // 🔴 숨기지는 않는다. excluded 로 집계해 "몇 건이 왜 빠졌는지" 를 남긴다.
    const nonAwaitingRows = second.candidates.filter((c: Record<string, unknown>) =>
      NON_AWAITING_STATUSES.includes(String(c.status ?? '').trim()),
    )
    const activeRows = second.candidates.filter(
      (c: Record<string, unknown>) => !NON_AWAITING_STATUSES.includes(String(c.status ?? '').trim()),
    )

    // ── ⑧ 판정 ────────────────────────────────────────────
    const batch = validateBatch(activeRows, {
      isFirstRun: cap.isFirstRun,
      publishedToday: cap.publishedToday,
    })

    // ── ⑩ 발행 가능 최종 판정 ─────────────────────────────
    const rows = batch.results.map((r: Record<string, unknown>, i: number) => {
      const sheetRowNumber = (activeRows[i]?.sheetRowNumber ?? null) as number | null
      const unchecked = (second.diagnostics as Diagnostic[])
        .filter((d) => d.kind === 'NOT_INJECTED' && d.rowNumber === sheetRowNumber)
        .map((d) => d.column as string)

      const decision = r.decision as string
      const rules = [...new Set((r.violations as Array<{ rule: string }>).map((v) => v.rule))]
      const planVerdict = verifyPublishablePlanRow({ decision, rules, unchecked })

      // 🔴 승인 전(HOLD)은 판정이 통과여도 발행 대상이 아니다.
      //    HOLD 는 발행 게이트를 건너뛰어 PASS 로 나오는데, 그걸 "발행 가능" 으로
      //    세면 창업자가 승인하지도 않은 글이 나갈 준비가 된 것처럼 보인다.
      //    판정 결과(decision)는 그대로 보여주되, publishable 은 분리한다.
      const status = String(activeRows[i]?.status ?? '').trim()
      const awaiting = status === 'PENDING'

      // 🔴 후보가 통과해도 작성자가 막히면 발행 불가다.
      const publishable = awaiting && planVerdict.ok && authorVerdict.ok
      const blockedBy = !awaiting
        ? `발행 대기가 아니다 (status=${status || '(빈 값)'}). 승인은 Sheet 에서 사람이 한다`
        : !planVerdict.ok
          ? planVerdict.reason
          : !authorVerdict.ok
            ? `작성자: ${authorVerdict.reason}`
            : null

      return { candidateId: r.candidateId as string, decision, rules, sheetRowNumber, unchecked, publishable, blockedBy }
    })

    report({
      tab: SHEET_TAB_NAME,
      candidates: rows,
      excluded: nonAwaitingRows.map((c: Record<string, unknown>) => ({
        candidateId: String(c.candidateId ?? ''),
        status: String(c.status ?? ''),
        sheetRowNumber: (c.sheetRowNumber ?? null) as number | null,
      })),
      diagnostics: [...(dbDiagnostics as Diagnostic[]), ...guardDiagnostics, ...(second.diagnostics as Diagnostic[])],
      cap,
      author: { ...authorProbe, verdict: authorVerdict },
      batchDecision: batch.batchDecision as string,
    })
  } finally {
    // 🔴 조회만 했어도 연결은 닫는다.
    await candidateSource.disconnect?.()
  }
}

type Excluded = { candidateId: string; status: string; sheetRowNumber: number | null }

type Report = {
  tab: string
  candidates: Array<Record<string, unknown>>
  /** 발행 대기가 아닌 행 — 판정 대상에서 뺐지만 숨기지 않는다 */
  excluded: Excluded[]
  diagnostics: Diagnostic[]
  cap: { isFirstRun: boolean; publishedToday: number }
  author: Record<string, unknown>
  batchDecision: string | null
}

function report(r: Report) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2))
    return
  }

  console.log('\nMicro Seed 발행 판정 — live dry-run')
  console.log(`  탭: ${r.tab} · 발행 가능 origin: ${PUBLISHABLE_ORIGINS.join(' · ')}`)
  console.log('  🔴 DB write · Sheet write · Post 생성 · status 변경 없음. 판정만 한다\n')

  // 작성자
  const a = r.author
  const v = a.verdict as { ok: boolean; reason?: string }
  console.log('  작성자 (§5-2A)')
  console.log(`    ${v.ok ? '✅' : '❌'} ${a.id}`)
  console.log(`       exists=${a.exists} · providerId=${JSON.stringify(a.providerId)} · isBlocked=${a.isBlocked}`)
  if (!v.ok) console.log(`       🔴 ${v.reason}`)

  // cap
  console.log('\n  cap (§6-9-F)')
  console.log(`    isFirstRun=${r.cap.isFirstRun} · publishedToday=${r.cap.publishedToday}`)

  // 발행 대기가 아닌 행 — 판정 대상은 아니지만 몇 건이 왜 빠졌는지는 남긴다
  if (r.excluded.length) {
    console.log(`\n  판정 제외 ${r.excluded.length}건 (발행 대기가 아니다 — cap 에 세지 않는다)`)
    for (const e of r.excluded) {
      console.log(`    ⏹️  행 ${e.sheetRowNumber ?? '?'} · ${e.status} · ${e.candidateId}`)
    }
  }

  // 후보
  console.log(`\n  판정 대상 ${r.candidates.length}건`)
  if (r.candidates.length === 0) {
    console.log('    (시트에 후보가 없다. 오류가 아니다 — 넣을 때까지 판정할 것이 없다)')
  }
  for (const c of r.candidates) {
    // 🔴 publishable 이 아니면 ✅ 를 쓰지 않는다. 승인 전 후보가 통과처럼 보이면 안 된다.
    const mark = c.publishable ? '✅' : '⏳'
    const rules = (c.rules as string[]).length ? ` [${(c.rules as string[]).join(', ')}]` : ''
    console.log(`    ${mark} 행 ${c.sheetRowNumber} · ${c.candidateId}`)
    console.log(`       ${c.decision}${rules}`)
    if ((c.unchecked as string[]).length) console.log(`       판정 안 함: ${(c.unchecked as string[]).join(', ')}`)
    if (c.blockedBy) console.log(`       🔴 ${c.blockedBy}`)
  }

  if (r.batchDecision) console.log(`\n  배치 판정: ${r.batchDecision}`)

  // 진단 — NOT_INJECTED 는 위 unchecked 에서 이미 보여줬다
  const real = r.diagnostics.filter((d) => d.kind !== 'NOT_INJECTED')
  console.log(`\n  진단 ${real.length}건`)
  for (const d of real.slice(0, 20)) {
    const where = d.candidateId ?? (d.rowNumber ? `행 ${d.rowNumber}` : '')
    console.log(`    · [${d.kind}] ${where} ${d.message}`)
  }
  if (real.length > 20) console.log(`    … 외 ${real.length - 20}건`)

  const publishable = r.candidates.filter((c) => c.publishable).length
  console.log(`\n  발행 가능 ${publishable}건 / ${r.candidates.length}건`)
  console.log('  🔴 PASS 는 "발행하라" 가 아니라 "지금 발행하면 막히지 않는다" 이다.')
  console.log('     실제 발행은 publisher(PR-C2b)가 하고 그때 같은 판정을 다시 한다.\n')
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  console.error(`\n❌ dry-run 실패: ${message}\n`)
  if (message.includes(MICRO_SEED_SHEET_ID_ENV)) {
    console.error(`  ${MICRO_SEED_SHEET_ID_ENV} 를 .env.local 에 넣었는지 확인한다.\n`)
  } else if (message.includes(MICRO_SEED_AUTHOR_ENV)) {
    console.error(`  ${MICRO_SEED_AUTHOR_ENV} 를 .env.local 에 넣었는지 확인한다 (§6-9-E).\n`)
  } else if (/scope/i.test(message)) {
    console.error('  토큰에 Sheets 스코프가 없다. 임퍼소네이션으로 다시 로그인한다:\n')
    console.error('    gcloud auth application-default login \\')
    console.error('      --impersonate-service-account=micro-seed-reader@project-8687edda-dc1b-4c7d-95a.iam.gserviceaccount.com\n')
  } else if (/DATABASE_URL|P1001|P1012|connect/i.test(message)) {
    console.error('  DATABASE_URL 이 .env.local 에 있는지, DB 에 닿는지 확인한다.\n')
  } else if (/credential|ADC|authentic|permission|denied|forbidden/i.test(message)) {
    console.error('  1. SA 의 [권한] 탭에 roles/iam.serviceAccountTokenCreator 가 있는가')
    console.error('  2. impersonation 으로 로그인했는가')
    console.error('  3. sheets.googleapis.com 이 활성화됐는가')
    console.error('  4. 그 SA 가 시트에 공유돼 있는가 (뷰어면 충분하다)\n')
  }
  process.exit(1)
})
