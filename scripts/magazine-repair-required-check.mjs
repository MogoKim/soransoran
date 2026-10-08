#!/usr/bin/env node
/**
 * 입력 수리 필요(REPAIR_REQUIRED) 회계 검사 — brief 형식 계약 위반 · brief echo draft 는 **시도가 아니다**.
 *
 *    보내기 전에 막힌 후보가 CONTENT 로 세지면, 보내지도 않은 글이 회차 `attempted` 상한을 먹고,
 *    장부 attempts 가 오르고, 7일 격리에 들어가 뒤의 정상 후보가 볼 자리를 잃는다 (Codex 재검토 2026-10-08).
 *    실제 `processCandidates` → 실제 `drive` 로 돌린다. 바깥 프로세스(회수·변환·QA·hero·batch·등록)만 주입한다.
 *
 * 🔴 운영 Chrome·CDP·장부·원고에 닿지 않는다 — 원고 폴더·장부는 임시 폴더, 9333/9344 요청은 차단·계수.
 *
 * 사용: node scripts/magazine-repair-required-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const realCdpAttempts = []
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input)
  if (/^https?:\/\/(127\.0\.0\.1|localhost):(9333|9344)\b/.test(url)) {
    realCdpAttempts.push(url)
    throw new Error(`시험이 실제 CDP 에 닿으려 했다: ${url}`)
  }
  return realFetch(input, init)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)
const FX = path.join(HERE, 'fixtures', 'magazine-format-contract')
const fx = (name) => fs.readFileSync(path.join(FX, name), 'utf8')

// 🔴 실제 경로로 — macOS 임시 폴더는 /var → /private/var 링크라 변환기의 drafts/ 경로 검사가 갈라진다
const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-required-')))
const D = path.join(T, 'drafts', 'magazine')
fs.mkdirSync(D, { recursive: true })
process.env.SORAN_MAGAZINE_DRAFTS_DIR = D
process.env.SORAN_MAGAZINE_TEST_MODE = '1'
/**
 * 🔴 **HOME 을 임시 폴더로 고정한다 — magazine 모듈을 하나라도 읽기 전에** (2026-10-08 사고 · Codex 재검토).
 *    장부·패킷·잠금·lease 의 기본 경로는 전부 HOME 아래다. 주입을 하나 빠뜨려도 기본값이 임시 폴더를 가리키게 한다.
 *    운영 장부는 읽지도 쓰지도 않는다 — 상태를 재러 열어 보는 것도 하지 않는다.
 */
process.env.HOME = T
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }))

const Q = await import('./lib/magazine-quarantine.mjs')
/**
 * 🔴 **파일에 닿기 전에 확인한다** — 기본 장부 경로가 임시 HOME 아래가 아니면 여기서 끝낸다.
 *    (HOME 격리가 빠지면 이 줄이 먼저 실패한다. 그래도 지나가면 장부 lib 의 시험 모드 가드가 막는다)
 */
if (!path.resolve(Q.QUARANTINE_PATH).startsWith(T + path.sep)) {
  console.log(`  ❌ 장부 기본 경로가 격리 HOME 밖이다 — 파일 접근 전에 멈춘다: ${Q.QUARANTINE_PATH}`)
  console.log('\n🔴 격리 실패 — 검사 0건 실행\n')
  process.exit(1)
}
const FK = await import('./lib/magazine-failure-kind.mjs')
const AR = await import('./magazine-auto-register.mjs')
const READY = await import('./magazine-auto-register-ready.mjs')

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const finish = () => console.log(`\n${fail ? '🔴' : '✅'} 입력 수리 필요 회계 검사 ${pass}/${pass + fail}\n`)
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e.stack ?? e.message}`); finish(); process.exit(1) })

const GRAY_BRIEF = fx('gray-hair-leave-as-is.brief.md')
const GOOD_BRIEF = fx('job-credentials.brief.md')
const ECHO_DRAFT = fx('cold-weather-joint-pain.draft.md')
const CLINIC_DRAFT = fx('clinic-booking-app.draft.md')
const CLINIC_FIXED = CLINIC_DRAFT.replace('[병원 예약이나 접수 때문에 겪었던 이야기를 나눠보세요.](/community/free)',
  '[CTA] /community/free | 병원 예약 이야기 나누기 | 병원 예약이나 접수 때문에 겪었던 이야기를 나눠보세요.')
const GOOD_DRAFT = fs.readFileSync(path.join(REPO, 'drafts', 'magazine', 'job-credentials', 'draft.md'), 'utf8')

const writeSlug = (slug, { brief, draft = null }) => {
  fs.rmSync(path.join(D, slug), { recursive: true, force: true })
  fs.mkdirSync(path.join(D, slug), { recursive: true })
  fs.writeFileSync(path.join(D, slug, 'brief.md'), brief)
  fs.writeFileSync(path.join(D, slug, 'review.ts'), 'export const REVIEW = {}\n')
  if (draft !== null) fs.writeFileSync(path.join(D, slug, 'draft.md'), draft)
}
const ITEM = (slug, day) => ({
  day, slug, title: '시험 고정 후보는 왜 그런가요', contentType: 'EVERGREEN', intent: '상황',
  cluster: 'clinic', target: '50대 전반', riskLevel: 'HIGH', reviewMode: 'FULL_REVIEW',
  imageMode: 'REQUIRED', autoEligible: false, validationProfile: 'MEDICAL',
  ctaBoard: '/community/free', internalLinks: [], whyNow: '시험', notes: '시험',
})
const MD2DRAFT = path.join(HERE, 'magazine-md-to-draft.mjs')

/**
 * 한 회차 — 실제 processCandidates · 실제 drive. 바깥 프로세스만 가짜다.
 *   webui(일반 회수) · 재생성 runner 는 **부르면 센다** — 입력 수리 필요 후보에서는 0 이어야 한다.
 */
function runRound(slugs, ledger, { limit = 3, regenRunner = null } = {}) {
  const calls = { webui: 0, regen: 0, convert: 0, qa: 0, hero: 0, register: 0, drive: [] }
  fs.mkdirSync(path.join(T, 'cand'), { recursive: true })
  const queue = slugs.map((s, i) => ITEM(s, i + 1))
  const deps = {
    paths: (sl) => { const dir = path.join(D, sl); return { dir, brief: path.join(dir, 'brief.md'), review: path.join(dir, 'review.ts'), draftMd: path.join(dir, 'draft.md'), articleTs: path.join(dir, 'article-draft.ts') } },
    heroFilePath: (sl) => path.join(D, sl, 'hero.webp'),
    candidateDir: path.join(T, 'cand'),
    packetDir: path.join(T, 'packets'),
    fetchResultDir: path.join(T, 'fetch-results'),
    draftsDir: D,
    loadQueue: () => queue,
    firstFetchResult: null,
    run(file, args, opts) {
      const name = path.basename(String(file))
      if (name === 'magazine-md-to-draft.mjs') {
        calls.convert += 1
        const r = spawnSync(process.execPath, [MD2DRAFT, ...args], { cwd: T, encoding: 'utf8' })
        return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', json: null }
      }
      if (name === 'magazine-webui-runner.mjs') { calls.webui += 1; return { code: 1, stdout: '', stderr: '시험: 일반 회수', json: null } }
      if (name === 'magazine-qa.mjs') { calls.qa += 1; return { code: 0, stdout: 'PASS', stderr: '', json: null } }
      if (name === 'magazine-hero-runner.mjs') { calls.hero += 1; return { code: 0, stdout: 'hero', stderr: '', json: null } }
      if (name === 'magazine-batch-qa.mjs') {
        const slug = args[0]
        return { code: 0, stdout: '', stderr: '', json: [{ slug, verdict: 'READY_TO_SCHEDULE', checks: { heroOk: true }, blockedBy: [], reasons: [] }] }
      }
      if (name === 'magazine-register.mjs') { calls.register += 1; return { code: 0, stdout: '', stderr: '', json: { verdict: 'READY' } } }
      return { code: 0, stdout: '', stderr: '', json: null }
    },
    regenRunner: (ctx) => { calls.regen += 1; return regenRunner ? regenRunner(ctx) : { ok: false, why: '시험: 재생성 0 이어야 한다' } },
  }
  const report = { blocked: [], done: [] }
  const out = READY.processCandidates({ write: true, wantPr: false, limit, report, quarantinePath: ledger,
    scanFn: () => ({ source: 'fixture', pool: slugs.length, eligible: slugs.map((s, i) => ({ slug: s, item: queue[i], progress: { hasBrief: true, hasReview: true, hasDraftMd: fs.existsSync(path.join(D, s, 'draft.md')) } })), skipped: [], quarantined: [] }),
    // 🔴 processCandidates 가 넘기는 deps(장부 경로)를 버리지 않는다 — 버리면 drive 가 **운영 장부**를 기본값으로 쓴다
    driveFn: (sl, o, given = {}) => { calls.drive.push(sl); return AR.drive(sl, o, { ...deps, ...given, quarantinePath: ledger }) } })
  return { out, calls }
}
const ledgerBytes = (p) => fs.readFileSync(p)
const seedLedger = (name, store = {}) => { const p = path.join(T, `${name}.json`); Q.saveQuarantine(store, p); return p }

// ── 0. 분류 ─────────────────────────────────────────────────
console.log('\n0. 분류 — 입력 수리 필요는 CONTENT 도 INFRA 도 아니다 · 시도를 쓰지 않는다')
for (const code of ['BRIEF_FORMAT_CONTRACT', 'DRAFT_INVALID']) {
  const k = FK.classifyFailure({ code, message: `${code}: 시험`, sent: false })
  check(`0. ${code} → REPAIR_REQUIRED · attempts 소비 0`, k.kind === 'REPAIR_REQUIRED' && FK.consumesAttempt(k.kind) === false, k.kind)
  const rec = Q.recordFailure({ entry: { attempts: 1 }, now: 1, reasons: [`${code}: 시험`], sent: false })
  check(`0. ${code} 를 장부 기록기에 넣어도 attempts 그대로 · CONTENT 아님`, rec.attempts === 1 && rec.kind === 'REPAIR_REQUIRED', JSON.stringify(rec))
}
check('0. 실제 원고 형식 위반(MANUSCRIPT_FORMAT · FORMAT_VIOLATION)은 그대로 CONTENT',
  FK.classifyFailure({ code: 'MANUSCRIPT_FORMAT', sent: false }).kind === 'CONTENT' && FK.classifyFailure({ message: 'FORMAT_VIOLATION: x', sent: false }).kind === 'CONTENT')
check('0. 전송불명이 입력 수리보다 먼저다 (sent 모름)', FK.classifyFailure({ code: 'BRIEF_FORMAT_CONTRACT', sent: null }).kind === 'DELIVERY_UNCERTAIN')

// ── A. 잘못된 brief 9건 + 정상 후보 1건 ───────────────────────
console.log('\nA. 잘못된 brief 9건 + 정상 1건 — 앞 9건은 시도·장부 0 · 정상 후보까지 간다')
{
  const bad = Array.from({ length: 9 }, (_, i) => `bad-brief-${i + 1}`)
  for (const s of bad) writeSlug(s, { brief: GRAY_BRIEF })
  writeSlug('good-a', { brief: GOOD_BRIEF, draft: GOOD_DRAFT })
  const L = seedLedger('A')
  const { out, calls } = runRound([...bad, 'good-a'], L)
  const store = Q.readQuarantine(L).store
  check('A. 앞 9건 → 전부 repairRequired · BRIEF_FORMAT_CONTRACT',
    out.repair.length === 9 && out.repair.every((r) => r.blockedBy?.[0]?.code === 'BRIEF_FORMAT_CONTRACT'), `repair ${out.repair.length}`)
  check('A. runner(일반 회수) 0 · 재생성 0', calls.webui === 0 && calls.regen === 0, `webui ${calls.webui} · regen ${calls.regen}`)
  check('A. 잘못된 brief 9건의 장부 기록 0', bad.every((s) => store[s] === undefined), JSON.stringify(Object.keys(store)))
  check('A. 정상 후보까지 도달해 등록된다 (DONE)', calls.drive.includes('good-a') && out.done.some((r) => r.slug === 'good-a'), `drive ${calls.drive.length} · done ${out.done.map((r) => r.slug)}`)
  check('A. attempted = 1 (정상 후보만)', out.attempted === 1, `attempted ${out.attempted}`)
  check('A. 등록 한도 소비 = 1 (정상 후보만)', out.registered === 1, `registered ${out.registered}`)
  check('A. 회차 정지 없음 (budgetStop 없음)', out.budgetStop === null, JSON.stringify(out.budgetStop))
  check('A. 보고에 slug · code · 구조화된 위반', out.repair.every((r) => Array.isArray(r.blockedBy?.[0]?.contractViolations) && r.blockedBy[0].contractViolations.length > 0))
}

// ── B. 잘못된 brief 만 30건 ─────────────────────────────────
console.log('\nB. 잘못된 brief 만 30건 — 유한 종료 · 시도·등록·장부 0')
{
  const bad = Array.from({ length: 30 }, (_, i) => `only-bad-${i + 1}`)
  for (const s of bad) writeSlug(s, { brief: GRAY_BRIEF })
  const L = seedLedger('B', { 'other-slug': { attempts: 1, kind: 'CONTENT', lastAt: 5 } })
  const before = ledgerBytes(L)
  const t0 = Date.now()
  const { out, calls } = runRound(bad, L)
  check('B. 30건을 한 번씩 보고 끝난다 (유한 · 30 drive)', calls.drive.length === 30 && Date.now() - t0 < 60000, `drive ${calls.drive.length}`)
  check('B. attempted 0 · 등록 0', out.attempted === 0 && out.registered === 0, `attempted ${out.attempted} · registered ${out.registered}`)
  check('B. 장부 바이트 불변', ledgerBytes(L).equals(before))
  check('B. runner 0 · 재생성 0 · 변환 0', calls.webui === 0 && calls.regen === 0 && calls.convert === 0, JSON.stringify(calls).slice(0, 120))
  check('B. 30건 전부 repair-required 로 보고', out.repair.length === 30 && out.blocked.length === 30)
}

// ── C. brief echo draft + 정상 후보 ─────────────────────────
console.log('\nC. brief echo draft + 정상 후보 — echo 는 DRAFT_INVALID · 재생성 0 · 정상은 계속')
{
  writeSlug('echo-c', { brief: GOOD_BRIEF, draft: ECHO_DRAFT })
  writeSlug('good-c', { brief: GOOD_BRIEF, draft: GOOD_DRAFT })
  const L = seedLedger('C')
  const { out, calls } = runRound(['echo-c', 'good-c'], L)
  const echo = out.results.find((r) => r.slug === 'echo-c')
  check('C. echo → DRAFT_INVALID · repairRequired', echo?.blockedBy?.[0]?.code === 'DRAFT_INVALID' && echo.repairRequired === true, echo?.blockedBy?.[0]?.code)
  check('C. 재생성 0', calls.regen === 0, `regen ${calls.regen}`)
  check('C. attempted = 1 (정상만) · 정상 DONE', out.attempted === 1 && out.done.some((r) => r.slug === 'good-c'), `attempted ${out.attempted}`)
  check('C. echo 의 장부 기록 0', Q.readQuarantine(L).store['echo-c'] === undefined)
  check('C. echo 보고에 구조화된 형식 위반', (echo?.blockedBy?.[0]?.formatViolations ?? []).length > 0)
}

// ── D. 반복 회차 ────────────────────────────────────────────
console.log('\nD. 같은 invalid brief · echo draft 를 여러 회차 — 장부 바이트 불변 · attempts 0 · 격리 0')
{
  writeSlug('rep-brief', { brief: GRAY_BRIEF })
  writeSlug('rep-echo', { brief: GOOD_BRIEF, draft: ECHO_DRAFT })
  const L = seedLedger('D', { 'other-slug': { attempts: 2, kind: 'CONTENT', lastAt: 7 } })
  const before = ledgerBytes(L)
  let total = { webui: 0, regen: 0, attempted: 0 }
  for (let i = 0; i < 4; i++) {
    const { out, calls } = runRound(['rep-brief', 'rep-echo'], L)
    total = { webui: total.webui + calls.webui, regen: total.regen + calls.regen, attempted: total.attempted + out.attempted }
  }
  const store = Q.readQuarantine(L).store
  check('D. 4회차 뒤 장부 바이트 불변', ledgerBytes(L).equals(before))
  check('D. attempts 0 · CONTENT 격리 0 (두 slug 모두 장부에 없다)', store['rep-brief'] === undefined && store['rep-echo'] === undefined)
  check('D. runner · 재생성 · attempted 누적 0', total.webui === 0 && total.regen === 0 && total.attempted === 0, JSON.stringify(total))
}

// ── E. 입력 수정 후 회복 ─────────────────────────────────────
console.log('\nE. brief · draft 를 고치면 장부 손질 없이 다음 회차가 정상 경로로 들어간다')
{
  writeSlug('fix-brief', { brief: GRAY_BRIEF })
  writeSlug('fix-echo', { brief: GOOD_BRIEF, draft: ECHO_DRAFT })
  const L = seedLedger('E')
  const r1 = runRound(['fix-brief', 'fix-echo'], L)
  check('E. 고치기 전 — 둘 다 repair-required · 장부 0', r1.out.repair.length === 2 && Object.keys(Q.readQuarantine(L).store).length === 0)
  // 사람이 brief · draft 를 고친다 (장부는 건드리지 않는다)
  fs.writeFileSync(path.join(D, 'fix-brief', 'brief.md'), GOOD_BRIEF)
  fs.writeFileSync(path.join(D, 'fix-echo', 'draft.md'), GOOD_DRAFT)
  const r2 = runRound(['fix-brief', 'fix-echo'], L)
  check('E. 다음 회차 — brief 고친 글은 일반 회수 경로로 들어간다 (runner 1)', r2.calls.webui === 1 && r2.calls.drive.includes('fix-brief'), `webui ${r2.calls.webui}`)
  check('E. 다음 회차 — draft 고친 글은 변환·QA 를 지나 DONE', r2.out.done.some((r) => r.slug === 'fix-echo'), r2.out.results.map((r) => `${r.slug}:${r.verdict}`).join(' '))
  check('E. 다음 회차 repair-required 0 · attempted 2 (실제 시도만)', r2.out.repair.length === 0 && r2.out.attempted === 2, `repair ${r2.out.repair.length} · attempted ${r2.out.attempted}`)
  // 실제 scan 도 격리 없이 후보로 본다 — 장부에 아무것도 없으므로
  const j = Q.judgeQuarantine({ entry: Q.readQuarantine(L).store['fix-echo'], fingerprint: 'x', now: Date.now() })
  check('E. 격리 판정 — 고친 글은 격리 대상이 아니다 (skip false · CLEAR)', j?.skip === false && j.code === 'CLEAR', JSON.stringify(j))
}

// ── F. 기존 회귀 ────────────────────────────────────────────
console.log('\nF. 기존 회귀 — 실제 원고 형식 위반은 재생성 · HOLD 는 그대로')
{
  // 실제 원고 CTA 0 → 형식 재생성 (repair-required 아님 · 시도로 센다)
  writeSlug('cta0-f', { brief: fx('clinic-booking-app.brief.md'), draft: CLINIC_DRAFT })
  const L = seedLedger('F1')
  const { out, calls } = runRound(['cta0-f'], L, { regenRunner: (ctx) => {
    const reservationId = `fake-${ctx.packet.attemptId}`
    const u = Q.reserveDelivery({ slug: ctx.slug, messageFingerprint: `fake:${ctx.packet.attemptId}`, reservationId,
      regen: { attemptId: ctx.packet.attemptId, packetHash: 'h' }, path: L })
    if (!u.ok) return { ok: false, why: u.why }
    fs.writeFileSync(ctx.draftOut, CLINIC_FIXED)
    Q.releaseDeliveryReservation({ slug: ctx.slug, reservationId, path: L })
    return { ok: true, attemptId: ctx.packet.attemptId }
  } })
  const r = out.results[0]
  check('F. 원고 CTA 0 → 형식 재생성 1회 · 고친 원고로 교체 · DONE (repair-required 아님)',
    calls.regen === 1 && fs.readFileSync(path.join(D, 'cta0-f', 'draft.md'), 'utf8') === CLINIC_FIXED && r.verdict === 'DONE' && !r.repairRequired,
    `${r.verdict} · regen ${calls.regen}`)
  check('F. 실제 원고 형식 재생성은 시도로 센다 (attempted 1)', out.attempted === 1)
  // 재생성 실패 → 원본 바이트 불변 · CONTENT 장부 기록 (기존 계약)
  writeSlug('cta0-fail', { brief: fx('clinic-booking-app.brief.md'), draft: CLINIC_DRAFT })
  const L2 = seedLedger('F2')
  const f2 = runRound(['cta0-fail'], L2, { regenRunner: () => { throw new Error('시험: 자식이 죽었다') } })
  const e2 = Q.readQuarantine(L2).store['cta0-fail'] ?? {}
  check('F. 형식 재생성 실패 → draft 바이트 불변 · CONVERT_FAILED · CONTENT 로 기록 (기존 계약)',
    fs.readFileSync(path.join(D, 'cta0-fail', 'draft.md'), 'utf8') === CLINIC_DRAFT && f2.out.results[0].blockedBy?.[0]?.code === 'CONVERT_FAILED'
      && e2.kind === 'CONTENT' && e2.attempts === 1 && f2.out.attempted === 1, JSON.stringify({ kind: e2.kind, attempts: e2.attempts }))
  // DELIVERY_UNCERTAIN HOLD — 계약보다 먼저 · runner 0 · 장부 불변
  writeSlug('hold-f', { brief: GRAY_BRIEF })
  const DG = await import('./lib/magazine-delivery-gate.mjs')
  const fp = DG.deliveryGate({ slug: 'hold-f', draftsDir: D, quarantinePath: seedLedger('fp') }).messageFingerprint
  const LH = seedLedger('F3', { 'hold-f': { attempts: 2, delivery: { sent: null, messageFingerprint: fp, kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', at: 1, runId: null, date: '2026-09-28', reservationId: 'r-old' } } })
  const beforeH = ledgerBytes(LH)
  const fh = runRound(['hold-f'], LH)
  check('F. HOLD → held (계약보다 먼저) · runner 0 · 장부 바이트 불변 · repair 아님',
    fh.out.held.length === 1 && fh.out.repair.length === 0 && fh.calls.webui === 0 && ledgerBytes(LH).equals(beforeH), `held ${fh.out.held.length} · repair ${fh.out.repair.length}`)
}

// ── G. 시험 모드 운영 장부 가드 ─────────────────────────────
console.log('\nG. 시험 모드 + 운영 장부 경로 → 잠금·읽기·쓰기 전에 TEST_OPERATION_PATH_BLOCKED')
{
  // 🔴 진짜 운영 장부는 열지 않는다 — 경로 판정만 본다 (순수 함수 · 파일 접근 0)
  const realOps = Q.operationalQuarantinePaths({})
  check('G. 진짜 운영 장부 경로는 시험 모드에서 막힌다 (경로 판정만 · 파일 접근 0)',
    realOps.length > 0 && realOps.every((p) => p && Q.testOperationPathBlocked(p)?.code === 'TEST_OPERATION_PATH_BLOCKED'), realOps.join(' · '))
  check('G. 운영 실행(TEST_MODE 아님)은 같은 경로도 막지 않는다', realOps.every((p) => Q.testOperationPathBlocked(p, {}) === null))

  // 가짜 운영 위치 — 막을 위치를 하나 더 보탠다(가드를 끄지 못한다). 여기에 지켜볼 장부를 둔다
  const FAKE_OP_HOME = path.join(T, 'fake-operational-home')
  process.env.SORAN_MAGAZINE_GUARD_EXTRA_OPERATIONAL_HOME = FAKE_OP_HOME
  const OP = path.join(FAKE_OP_HOME, 'Library', 'Application Support', 'soransoran', 'magazine-quarantine.json')
  fs.mkdirSync(path.dirname(OP), { recursive: true })
  const SENTINEL = `${JSON.stringify({ sentinel: { attempts: 1 } }, null, 2)}\n`
  fs.writeFileSync(OP, SENTINEL)
  const past = new Date(Date.now() - 3600_000)
  fs.utimesSync(OP, past, past)
  const mtime0 = fs.statSync(OP).mtimeMs
  const dirBefore = fs.readdirSync(path.dirname(OP)).sort().join(',')
  let mutateCalls = 0
  let lockFnCalls = 0
  const u = Q.updateQuarantine((cur) => { mutateCalls += 1; return { ...cur, x: 1 } }, OP)
  const rd = Q.readQuarantine(OP)
  let saveErr = null
  try { Q.saveQuarantine({ x: 1 }, OP) } catch (e) { saveErr = e }
  const lk = Q.withQuarantineLock(OP, () => { lockFnCalls += 1; return 1 })
  const ls = Q.acquireManuscriptLease({ slug: 'g-slug', work: 'fetch', path: OP })
  const rs = Q.reserveDelivery({ slug: 'g-slug', messageFingerprint: 'sha256:g', reservationId: 'r-g', path: OP })
  check('G. updateQuarantine → TEST_OPERATION_PATH_BLOCKED · 갱신 함수 0회', u.ok === false && u.code === 'TEST_OPERATION_PATH_BLOCKED' && mutateCalls === 0, JSON.stringify(u))
  check('G. readQuarantine → TEST_OPERATION_PATH_BLOCKED · 내용을 돌려주지 않는다 (읽기 0)', rd.ok === false && rd.code === 'TEST_OPERATION_PATH_BLOCKED' && !rd.store.sentinel)
  check('G. saveQuarantine → TEST_OPERATION_PATH_BLOCKED 로 던진다', saveErr?.code === 'TEST_OPERATION_PATH_BLOCKED', saveErr?.message)
  check('G. withQuarantineLock → TEST_OPERATION_PATH_BLOCKED · 임계구역 0회', lk.ok === false && lk.code === 'TEST_OPERATION_PATH_BLOCKED' && lockFnCalls === 0)
  check('G. 원고 lease · 전송 예약도 막힌다', ls.ok === false && ls.code === 'TEST_OPERATION_PATH_BLOCKED' && rs.ok === false, `${ls.code} · ${rs.code ?? rs.why}`)
  check('G. 가짜 운영 장부 바이트·수정 시각 불변 · 잠금·tmp·lease 생성 0',
    fs.readFileSync(OP, 'utf8') === SENTINEL && fs.statSync(OP).mtimeMs === mtime0 && fs.readdirSync(path.dirname(OP)).sort().join(',') === dirBefore,
    fs.readdirSync(path.dirname(OP)).join(','))

  // 시험 모드 + 임시 HOME 기본 경로 → 정상 쓰기
  const d = Q.updateQuarantine((cur) => ({ ...cur, 'g-default': { attempts: 0 } }))
  check('G. 시험 모드 + 임시 HOME 기본 경로 → 정상 쓰기', d.ok === true && Q.readQuarantine().store['g-default']?.attempts === 0 && Q.QUARANTINE_PATH.startsWith(T + path.sep), JSON.stringify(d).slice(0, 80))
  // 시험 모드 + 명시적 임시 장부 → 정상 쓰기
  const EX = path.join(T, 'explicit-ledger.json')
  const e = Q.updateQuarantine((cur) => ({ ...cur, 'g-explicit': { attempts: 0 } }), EX)
  check('G. 시험 모드 + 명시적 임시 장부 → 정상 쓰기', e.ok === true && Q.readQuarantine(EX).store['g-explicit']?.attempts === 0)

  // 운영 실행 + 운영 기본 경로 → 기존 계약 (자식 프로세스 · HOME = 가짜 운영 위치 · TEST_MODE 없음)
  const QLIB = path.join(HERE, 'lib', 'magazine-quarantine.mjs')
  const childEnv = { PATH: process.env.PATH, HOME: FAKE_OP_HOME, SORAN_MAGAZINE_GUARD_EXTRA_OPERATIONAL_HOME: FAKE_OP_HOME }
  const prod = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const Q = await import(${JSON.stringify(QLIB)}); const u = Q.updateQuarantine((c) => ({ ...c, prod: { attempts: 0 } })); console.log(JSON.stringify({ ok: u.ok, path: Q.QUARANTINE_PATH, has: Q.readQuarantine().store.prod !== undefined }))`],
  { encoding: 'utf8', env: childEnv })
  const pj = (() => { try { return JSON.parse(prod.stdout.trim()) } catch { return null } })()
  check('G. 운영 실행 + 운영 기본 경로 → 기존대로 쓴다 (가드 없음)', pj?.ok === true && pj.has === true && path.resolve(pj.path) === path.resolve(OP), prod.stdout + prod.stderr)
  const tm = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const Q = await import(${JSON.stringify(QLIB)}); const u = Q.updateQuarantine((c) => c); console.log(JSON.stringify({ ok: u.ok, code: u.code }))`],
  { encoding: 'utf8', env: { ...childEnv, SORAN_MAGAZINE_TEST_MODE: '1' } })
  check('G. 같은 자식이 시험 모드면 막힌다', /TEST_OPERATION_PATH_BLOCKED/.test(tm.stdout), tm.stdout + tm.stderr)
  delete process.env.SORAN_MAGAZINE_GUARD_EXTRA_OPERATIONAL_HOME
}

check('실제 CDP 포트 요청 0 (운영 Chrome 에 닿지 않았다)', realCdpAttempts.length === 0, realCdpAttempts.join(' · '))
finish()
process.exitCode = fail ? 1 : 0
