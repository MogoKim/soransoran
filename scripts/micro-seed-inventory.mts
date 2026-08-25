#!/usr/bin/env tsx
/**
 * Micro Seed Sheet inventory — read-only
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §12-2 · §6-7 · §6-9-F
 *
 * §12-2 자동화 개방 순서의 **첫 칸**이다.
 *
 *   read-only inventory → dry-run → HOLD append → founder PENDING → 1건 publish → limited publish
 *
 * 이 스크립트가 답하는 질문은 하나다.
 *
 *   "지금 시트에 무엇이 들어 있는가?"
 *
 * 🔴 아무것도 쓰지 않는다
 *    Sheet write 없음 · DB 접속 없음 · 발행 없음 · 파일 쓰기 없음.
 *    스코프가 spreadsheets.readonly 라 **토큰 자체가 쓸 수 없다** —
 *    실수로 write 를 부르는 코드를 짜도 API 가 거부한다.
 *
 * 🔴 발행 판단을 하지 않는다
 *    후보가 발행 가능한지는 validator·guard 가 판정한다(micro-seed:plan).
 *    여기서는 세기만 한다 — inventory 가 판정까지 하면 "봤으니 됐다" 가 되어
 *    게이트를 건너뛰는 경로가 생긴다.
 *
 * 🔴 M1 은 자동화하지 않는다 (§6-9-F · §12-2)
 *    cron · workflow 를 붙이지 않는다. 사람이 손으로 부른다.
 *    CI 에도 넣지 않는다 — live Sheet 호출이 매 push 마다 도는 것은 M1 범위가 아니다.
 *
 * 사전 준비
 *   1. SA 의 [권한] 탭에 roles/iam.serviceAccountTokenCreator (로그인 계정 대상)
 *      🔴 프로젝트 IAM 이 아니다. 프로젝트에 걸면 모든 SA 를 가장할 수 있게 된다
 *   2. gcloud auth application-default login \
 *        --impersonate-service-account=micro-seed-reader@project-8687edda-dc1b-4c7d-95a.iam.gserviceaccount.com
 *      🔴 --scopes 를 붙이지 않는다. 사용자 동의로 Sheets 스코프를 요청하면
 *         Google 이 "차단된 앱" 으로 막는다 — Sheets 스코프는 SA 토큰이 갖는다
 *   3. GCP 에서 sheets.googleapis.com 활성화
 *   4. .env.local 에 SORAN_MICRO_SEED_SHEET_ID
 *
 * 사용법
 *   npm run micro-seed:inventory
 *   npm run micro-seed:inventory -- --json
 */
import { createGoogleSheetSource, readCandidates, SHEET_HEADERS, SHEET_TAB_NAME, MICRO_SEED_SHEET_ID_ENV, SHEET_READONLY_SCOPE } from './lib/micro-seed-sheet.mjs'
import { CANDIDATE_STATUSES } from './micro-seed-validate.mjs'

/**
 * 안내 문구에만 쓰는 SA 이메일.
 * 🔴 인증에 쓰이지 않는다 — 임퍼소네이션 대상은 ADC 파일이 갖고 있고,
 *    이 값은 실패했을 때 사람에게 보여줄 명령을 만들기 위한 것이다.
 */
const MICRO_SEED_SA = 'micro-seed-reader@project-8687edda-dc1b-4c7d-95a.iam.gserviceaccount.com'

type Diagnostic = { kind: string; rowNumber?: number; column?: string; message: string }
type HeaderError = { kind: string; column?: string; message: string }

async function loadEnvLocal() {
  // .env.local 을 읽는다. dotenv 의존성을 더하지 않으려고 직접 파싱한다 —
  // 이 스크립트 하나 때문에 공용 package.json 을 늘리지 않는다.
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

  const source = await createGoogleSheetSource()
  const read = await readCandidates(source)

  // ── 헤더가 틀리면 여기서 멈춘다 ──────────────────────────
  //    순서가 밀린 채 세면 "무엇을 셌는지" 를 알 수 없다.
  if (!read.ok) {
    console.error('\n❌ 시트 헤더가 정본 17열과 다르다\n')
    for (const e of read.headerErrors as HeaderError[]) {
      console.error(`  · [${e.kind}] ${e.message}`)
    }
    console.error('\n헤더를 고치기 전에는 후보를 세지 않는다.\n')
    process.exit(1)
  }

  const candidates = read.candidates as Array<Record<string, unknown>>
  const diagnostics = read.diagnostics as Diagnostic[]

  // ── 상태별 집계 ─────────────────────────────────────────
  //    8상태를 전부 0 으로 초기화한다. 0 건인 상태도 보여야
  //    "PENDING 이 0 이다" 와 "PENDING 칸을 못 읽었다" 가 구분된다.
  const byStatus: Record<string, number> = {}
  for (const s of CANDIDATE_STATUSES as string[]) byStatus[s] = 0
  const unknownStatuses: Record<string, number> = {}

  for (const c of candidates) {
    const status = typeof c.status === 'string' ? c.status.trim() : ''
    if (status in byStatus) byStatus[status] += 1
    else unknownStatuses[status || '(빈칸)'] = (unknownStatuses[status || '(빈칸)'] ?? 0) + 1
  }

  // 주입 필드는 여기서 채우지 않으므로 NOT_INJECTED 는 정상이다. 세지 않는다.
  const realDiagnostics = diagnostics.filter((d) => d.kind !== 'NOT_INJECTED')

  const summary = {
    tab: SHEET_TAB_NAME,
    columns: SHEET_HEADERS.length,
    candidates: candidates.length,
    skippedBlankRows: read.skippedBlankRows,
    byStatus,
    unknownStatuses,
    diagnostics: realDiagnostics,
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  console.log('\nMicro Seed Sheet inventory — read-only')
  console.log(`  탭: ${SHEET_TAB_NAME} · 헤더 ${SHEET_HEADERS.length}열 ✅`)
  console.log(`  스코프: ${SHEET_READONLY_SCOPE}`)
  console.log('  🔴 Sheet write · DB · 발행 없음. 세기만 한다\n')

  console.log(`  후보 ${candidates.length}건 (빈 행 ${read.skippedBlankRows}건 제외)\n`)

  console.log('  상태별')
  for (const [status, n] of Object.entries(byStatus)) {
    const mark = n > 0 ? '  ' : '  '
    console.log(`  ${mark}${status.padEnd(12)} ${n}`)
  }

  const unknownEntries = Object.entries(unknownStatuses)
  if (unknownEntries.length) {
    // 🔴 8상태 밖의 값은 그 자체가 사고 신호다 (R1 이 HOLD 로 눌러야 한다).
    console.log('\n  🔴 알 수 없는 status')
    for (const [status, n] of unknownEntries) console.log(`    ${status.padEnd(12)} ${n}`)
  }

  if (realDiagnostics.length) {
    console.log(`\n  진단 ${realDiagnostics.length}건`)
    for (const d of realDiagnostics.slice(0, 20)) {
      const where = d.rowNumber ? `행 ${d.rowNumber}` : ''
      console.log(`    · [${d.kind}] ${where} ${d.message}`)
    }
    if (realDiagnostics.length > 20) console.log(`    … 외 ${realDiagnostics.length - 20}건`)
  } else {
    console.log('\n  진단 0건')
  }

  console.log('\n  다음: npm run micro-seed:plan (판정) — inventory 는 판정하지 않는다\n')
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  console.error(`\n❌ inventory 실패: ${message}\n`)
  if (message.includes(MICRO_SEED_SHEET_ID_ENV)) {
    console.error(`  ${MICRO_SEED_SHEET_ID_ENV} 를 .env.local 에 넣었는지 확인한다.\n`)
  } else if (/scope/i.test(message)) {
    // 🔴 토큰에 Sheets 스코프가 없다. 사용자 계정 ADC 로 로그인했을 때 이렇게 된다 —
    //    코드의 scopes 는 임퍼소네이션일 때만 적용된다.
    console.error('  토큰에 Sheets 스코프가 없다. 임퍼소네이션으로 다시 로그인한다:\n')
    console.error('    gcloud auth application-default login \\')
    console.error(`      --impersonate-service-account=${MICRO_SEED_SA}\n`)
    console.error('  🔴 --scopes 를 붙이지 않는다. 사용자 동의로 Sheets 스코프를 요청하면')
    console.error('     Google 이 "차단된 앱" 으로 막는다.\n')
  } else if (/credential|ADC|authentic|permission|denied|forbidden/i.test(message)) {
    console.error('  아래를 순서대로 확인한다.\n')
    console.error('    1. SA 의 [권한] 탭에 roles/iam.serviceAccountTokenCreator 가 있는가')
    console.error('       (프로젝트 IAM 이 아니라 SA 자신의 권한 탭이다)')
    console.error('    2. 아래로 로그인했는가')
    console.error('         gcloud auth application-default login \\')
    console.error(`           --impersonate-service-account=${MICRO_SEED_SA}`)
    console.error('    3. GCP 에서 sheets.googleapis.com 이 활성화됐는가')
    console.error('    4. 그 SA 가 시트에 공유돼 있는가 (뷰어면 충분하다)\n')
  }
  process.exit(1)
})
