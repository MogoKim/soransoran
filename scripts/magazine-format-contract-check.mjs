#!/usr/bin/env node
/**
 * 원고 형식 계약 · compose 진단 검사 — 2026-10-08 자연 회차 잔여 결함 2건.
 *
 *   ① producer: clinic-booking-app compose 클릭 30초 타임아웃 — 로그에 첫 줄만 남아 원인(덮개/숨김)을 몰랐다
 *   ② auto-register: clinic-booking-app CONVERT_FAILED — `72행: [CTA] 는 정확히 1개여야 한다` 대신
 *      사람용 안내문만 남았고, 이미 저장된 draft 는 스스로 회복하지 못했다
 *
 * 실제 운영 brief·원고(사본, `scripts/fixtures/magazine-format-contract/`)로 실제 함수를 돌린다.
 * 🔴 운영 Chrome·CDP·장부·원고에 닿지 않는다 — 원고 폴더·장부·패킷은 전부 임시 폴더이고,
 *    127.0.0.1·localhost 의 9333/9344 요청은 던지고 시도 자체를 FAIL 로 센다. 브라우저는 가짜다.
 *
 * 사용: node scripts/magazine-format-contract-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
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

// 🔴 원고 폴더를 임시로 돌린다 — 모듈을 읽기 **전에** 정해야 DRAFTS_DIR 이 따라온다 (운영 폴더 0)
// 🔴 실제 경로로 — macOS 임시 폴더는 /var → /private/var 링크라 변환기의 drafts/ 경로 검사가 갈라진다
const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'format-contract-')))
const D = path.join(T, 'drafts', 'magazine')
fs.mkdirSync(D, { recursive: true })
process.env.SORAN_MAGAZINE_DRAFTS_DIR = D
process.env.SORAN_MAGAZINE_TEST_MODE = '1'
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }))

const FMT = await import('./lib/magazine-manuscript-format.mjs')
const MG = await import('./lib/magazine-manuscript-guard.mjs')
const DG = await import('./lib/magazine-delivery-gate.mjs')
const Q = await import('./lib/magazine-quarantine.mjs')
const RG = await import('./lib/magazine-regen.mjs')
const SESS = await import('./lib/chatgpt-session.mjs')
const POLICY = await import('./lib/magazine-brief-policy.mjs')
const AR = await import('./magazine-auto-register.mjs')
const READY = await import('./magazine-auto-register-ready.mjs')
const WEBUI = await import('./magazine-webui-runner.mjs')

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const finish = () => console.log(`\n${fail ? '🔴' : '✅'} 원고 형식 계약 검사 ${pass}/${pass + fail}\n`)
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e.stack ?? e.message}`); finish(); process.exit(1) })
process.on('unhandledRejection', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.stack ?? e}`); finish(); process.exit(1) })

const sha = (t) => createHash('sha256').update(t).digest('hex')
const CLINIC = 'clinic-booking-app'
const GRAY = 'gray-hair-leave-as-is'
const CLINIC_BRIEF = fx(`${CLINIC}.brief.md`)
const CLINIC_DRAFT = fx(`${CLINIC}.draft.md`)
const GRAY_BRIEF = fx(`${GRAY}.brief.md`)
const CLINIC_VIOLATION = '72행: [CTA] 는 정확히 1개여야 한다 (현재 0개)'
const CLINIC_FIXED = CLINIC_DRAFT.replace('[병원 예약이나 접수 때문에 겪었던 이야기를 나눠보세요.](/community/free)',
  '[CTA] /community/free | 병원 예약 이야기 나누기 | 병원 예약이나 접수 때문에 겪었던 이야기를 나눠보세요.')
const SUCCESS = ['job-credentials', 'alone-pastime', 'retirement-others-what-work']

// ── 공통 ───────────────────────────────────────────────────
console.log('\n0. 실제 fixture 가 실제 운영 사본이다')
check('0. clinic draft 는 10/8 운영 원고와 같은 바이트다', sha(CLINIC_DRAFT) === '8e09c1b4880e4fb042a01688a1c91d12a879083f6ef345fcf75a929e8a8f4478')
check('0. clinic · gray brief 는 운영 brief 와 같은 바이트다',
  sha(CLINIC_BRIEF) === '32d0888d369d0fc9e29e9234420d8b258a27816dac76fe9c077a0dbbc5e4bc12'
  && sha(GRAY_BRIEF) === 'af1768482461ca79ec33dd624936c4b693f149e49153abfc5b9902fc37364cc9')
check('0. 고친 clinic 원고 fixture 는 CTA 줄만 다르다', CLINIC_FIXED !== CLINIC_DRAFT && CLINIC_FIXED.split('\n').length === CLINIC_DRAFT.split('\n').length)

// ── ① compose 오류 증거 ─────────────────────────────────────
console.log('\n① compose 클릭 실패 — 원인 분류 하나를 제한된 errorDetail 에 남긴다')
{
  const PW = JSON.parse(fx('playwright-click-timeouts.json'))
  const synthetic = (cause) => `locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#prompt-textarea').first()\n    - ${cause}\n`
  const briefPath = path.join(T, 'compose-brief.md')
  fs.writeFileSync(briefPath, '# brief\n')
  const runCompose = async (message, name = 'TimeoutError') => {
    let connects = 0
    const page = {
      async goto() {}, async waitForSelector() {}, async close() {}, async waitForTimeout() {}, async evaluate() { return null },
      keyboard: { async insertText() {}, async press() {} },
      locator: () => ({ first: () => ({ async click() { const e = new Error(message); e.name = name; throw e }, async innerText() { return '' } }) }),
    }
    const r = await SESS.fetchManuscript({
      briefPath, outPath: path.join(T, 'compose-out.md'), promptText: '시험', timeoutMs: 200, pollMs: 1, stablePolls: 1,
      ensureTab: async () => ({ ok: true }),
      connect: async () => { connects += 1; return { contexts: () => [{ newPage: async () => page, pages: () => [] }], async close() {} } },
    })
    return { r, connects }
  }
  const overlay = await runCompose(PW.overlay)
  check('① 실제 Playwright 덮개 문구 → stage compose · errorCause "intercepts pointer events"',
    overlay.r.reason === 'connect_failed' && overlay.r.stage === 'compose' && overlay.r.errorCause === 'intercepts pointer events',
    JSON.stringify({ reason: overlay.r.reason, stage: overlay.r.stage, cause: overlay.r.errorCause }))
  check('① errorDetail 에 원인이 실린다 · 200자 이하',
    /원인: intercepts pointer events$/.test(overlay.r.errorDetail ?? '') && overlay.r.errorDetail.length <= 200, overlay.r.errorDetail)
  check('① errorDetail 에 DOM·URL 이 실리지 않는다 (`<div` · modal · chatgpt.com · Call log 0)',
    !/<|modal|chatgpt\.com|Call log|prompt-textarea/.test(overlay.r.errorDetail ?? ''), overlay.r.errorDetail)
  check('① 보내지 않았다 (sent false)', overlay.r.sent === false && overlay.r.ok === false)
  const hidden = await runCompose(PW.hidden)
  const disabled = await runCompose(PW.disabled)
  check('① 실제 Playwright 숨김 · 비활성 문구 → not visible · disabled', hidden.r.errorCause === 'not visible' && disabled.r.errorCause === 'disabled',
    `${hidden.r.errorCause} · ${disabled.r.errorCause}`)
  const map = { 'element is not stable': 'not stable', 'element was detached from the DOM, retrying': 'detached', 'element is outside of the viewport': 'outside viewport' }
  for (const [line, want] of Object.entries(map)) {
    const x = await runCompose(synthetic(line))
    check(`① "${line}" → ${want}`, x.r.errorCause === want && x.r.errorDetail.endsWith(`원인: ${want}`), `${x.r.errorCause}`)
  }
  const plain = await runCompose('page.goto: net::ERR_ABORTED', 'Error')
  check('① 원인 줄이 없으면 첫 줄만 (기존과 같다)', plain.r.errorDetail === 'page.goto: net::ERR_ABORTED' && plain.r.errorCause === undefined, plain.r.errorDetail)
  check('① 원인 줄 "<div class=x> intercepts…" 의 DOM 은 분류어만 남긴다',
    SESS.playwrightActionCause('x\n  - <div class="secret-account-name"> intercepts pointer events') === 'intercepts pointer events')
  check('① 첫 줄의 "is visible, enabled and stable" 은 원인으로 오인하지 않는다',
    SESS.playwrightActionCause('x\n  - element is visible, enabled and stable\n  - scrolling into view if needed') === null)
  check('① 클릭 실패의 전역 실패 정책은 그대로다 (connect_failed = fatal)', SESS.isFatal('connect_failed') === true)
}

// ── ② brief 형식 계약 ───────────────────────────────────────
console.log('\n② brief 형식 계약 — 생성 검사(verifyBrief)와 일반 전송 직전(deliveryGate)이 같은 함수')
const writeSlug = (slug, { brief, draft = null, review = 'export const REVIEW = {}\n' }) => {
  fs.mkdirSync(path.join(D, slug), { recursive: true })
  fs.writeFileSync(path.join(D, slug, 'brief.md'), brief)
  fs.writeFileSync(path.join(D, slug, 'review.ts'), review)
  const dp = path.join(D, slug, 'draft.md')
  if (draft !== null) fs.writeFileSync(dp, draft)
  else fs.rmSync(dp, { force: true })
  fs.rmSync(path.join(D, slug, 'article-draft.ts'), { force: true })
}
{
  for (const s of SUCCESS) {
    const j = FMT.judgeBriefFormatContract(fx(`${s}.brief.md`))
    check(`② PR #670 성공 brief ${s} → 계약 통과`, j.ok, FMT.describeBriefViolations(j.violations))
  }
  const cj = FMT.judgeBriefFormatContract(CLINIC_BRIEF)
  const gj = FMT.judgeBriefFormatContract(GRAY_BRIEF)
  check('② clinic brief → CTA 지시 · 허용 표기 · 금지 규칙 모두 위반',
    ['BRIEF_CTA_DIRECTIVE', 'BRIEF_ALLOWED_NOTATION', 'BRIEF_FORBIDDEN_RULES'].every((c) => cj.violations.some((v) => v.code === c)), JSON.stringify(cj.violations.map((v) => v.code)))
  check('② gray brief → 허용 표기 · 금지 규칙 위반', !gj.ok && ['BRIEF_ALLOWED_NOTATION', 'BRIEF_FORBIDDEN_RULES'].every((c) => gj.violations.some((v) => v.code === c)),
    JSON.stringify(gj.violations.map((v) => v.code)))
  // 규칙 하나씩 — 성공 brief 에서 그 부분만 지운다
  const job = fx('job-credentials.brief.md')
  const noCta = job.split('\n').filter((l) => !l.trim().startsWith('[CTA]')).join('\n')
  const noTable = job.split('\n').filter((l) => !l.trim().startsWith('|')).join('\n')
  const noForbid = job.split('\n').filter((l) => !l.includes('🚫 표')).join('\n')
  const badCta = job.replace(/^\[CTA\] \/community\/free/m, '[CTA] https://example.com')
  const twoBoards = `${job}\n[CTA] /community/menopause | 갱년기톡 | 한 문장\n`
  check('② a. [CTA] 지시 줄을 지우면 BRIEF_CTA_DIRECTIVE', FMT.judgeBriefFormatContract(noCta).violations.map((v) => v.code).join() === 'BRIEF_CTA_DIRECTIVE')
  check('② a. href 가 /community/ 가 아니면 BRIEF_CTA_DIRECTIVE', FMT.judgeBriefFormatContract(badCta).violations.some((v) => v.code === 'BRIEF_CTA_DIRECTIVE'))
  check('② a. 서로 다른 게시판을 가리키면 BRIEF_CTA_DIRECTIVE', FMT.judgeBriefFormatContract(twoBoards).violations.some((v) => v.code === 'BRIEF_CTA_DIRECTIVE'))
  check('② b. 허용 표기 표를 지우면 BRIEF_ALLOWED_NOTATION', FMT.judgeBriefFormatContract(noTable).violations.map((v) => v.code).join() === 'BRIEF_ALLOWED_NOTATION')
  check('② c. 금지 규칙 줄을 지우면 BRIEF_FORBIDDEN_RULES', FMT.judgeBriefFormatContract(noForbid).violations.map((v) => v.code).join() === 'BRIEF_FORBIDDEN_RULES')
  // 정본 템플릿 판(🚫 여러 줄 · #### · `[CTA]` 두 줄)도 정상이다 — 실제로 원고를 받았던 판
  const tracked = path.join(REPO, 'drafts', 'magazine', 'after-holiday-body-ache', 'brief.md')
  if (fs.existsSync(tracked)) {
    check('② 옛 템플릿 판 brief(after-holiday-body-ache) 도 통과 — 🚫 여러 줄 · #### · CTA 두 줄', FMT.judgeBriefFormatContract(fs.readFileSync(tracked, 'utf8')).ok)
  }

  // verifyBrief — brief-auto 생성 검사가 같은 함수를 쓴다
  const gf = (text) => POLICY.verifyBrief({ briefText: text, review: null, queueItem: null }).results.find((r) => r.gate === 'GF')
  check('② verifyBrief GF — clinic · gray 거부 · 성공 3종 통과',
    gf(CLINIC_BRIEF)?.ok === false && gf(GRAY_BRIEF)?.ok === false && SUCCESS.every((s) => gf(fx(`${s}.brief.md`))?.ok === true),
    `${gf(CLINIC_BRIEF)?.detail?.slice(0, 60)}`)

  // deliveryGate — 일반 전송 직전
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  writeSlug(CLINIC, { brief: CLINIC_BRIEF })
  writeSlug('job-credentials', { brief: fx('job-credentials.brief.md') })
  const L = path.join(T, 'gate-ledger.json')
  Q.saveQuarantine({}, L)
  const gg = DG.deliveryGate({ slug: GRAY, draftsDir: D, quarantinePath: L })
  const gc = DG.deliveryGate({ slug: CLINIC, draftsDir: D, quarantinePath: L })
  const gjob = DG.deliveryGate({ slug: 'job-credentials', draftsDir: D, quarantinePath: L })
  check('② deliveryGate — gray · clinic 일반 전송 → BRIEF_FORMAT_CONTRACT (구조화된 위반 포함)',
    gg.ok === false && gg.code === 'BRIEF_FORMAT_CONTRACT' && gg.contractViolations?.length > 0 && gc.code === 'BRIEF_FORMAT_CONTRACT', `${gg.code} · ${gc.code}`)
  check('② deliveryGate — 계약을 지킨 brief 는 그대로 통과', gjob.ok === true && !gjob.hold, `${gjob.code ?? 'ok'}`)
  check('② 계약 실패에도 메시지·지문 계산은 그대로다 (판정만 더했다)',
    gg.messageFingerprint === Q.deliveryFingerprintOf(DG.plannedMessageFor(GRAY, D)), gg.messageFingerprint)

  // HOLD 가 먼저다 — 이미 보낸 글은 지금처럼 HOLD (재전송 0 · 분류 불변)
  const LH = path.join(T, 'hold-ledger.json')
  Q.saveQuarantine({ [GRAY]: { attempts: 1, delivery: { sent: null, messageFingerprint: gg.messageFingerprint, kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', at: 1, runId: null, date: '2026-09-28', reservationId: 'r-old' } } }, LH)
  const gh = DG.deliveryGate({ slug: GRAY, draftsDir: D, quarantinePath: LH })
  check('② 이미 보낸 글(HOLD)은 계약보다 HOLD 가 먼저다 — ok · hold', gh.ok === true && Boolean(gh.hold), `${gh.code ?? 'ok'} · hold ${Boolean(gh.hold)}`)

  // 실제 전송 경계 — fetchOne: probe · Chrome · 예약 · 전송 0
  let probes = 0
  let tabs = 0
  let connects = 0
  const browserDeps = { ensureTab: async () => { tabs += 1; return { ok: true } }, connect: async () => { connects += 1; throw new Error('시험: 연결하면 안 된다') } }
  const one = await WEBUI.fetchOne(GRAY, { quarantinePath: L, draftsDir: D, exit: () => {},
    probeFn: async () => { probes += 1; return { status: SESS.STATUS.OK } }, browserDeps })
  const after = Q.readQuarantine(L).store[GRAY]
  check('② fetchOne(gray) → BRIEF_FORMAT_CONTRACT · sent false', one.result.reason === 'BRIEF_FORMAT_CONTRACT' && one.result.sent === false, `${one.result.reason} · sent ${one.result.sent}`)
  check('② fetchOne(gray) → probe 0 · 탭 0 · 연결 0', probes === 0 && tabs === 0 && connects === 0, `probe ${probes} · tab ${tabs} · connect ${connects}`)
  check('② fetchOne(gray) → 장부 예약 0 (delivery 기록 없음)', !after?.delivery, JSON.stringify(after ?? null))
  const oneHeld = await WEBUI.fetchOne(GRAY, { quarantinePath: LH, draftsDir: D, exit: () => {},
    probeFn: async () => { probes += 1; return { status: SESS.STATUS.OK } }, browserDeps })
  check('② HOLD 글은 fetchOne 에서도 held · probe 0', oneHeld.result.status === 'held' && probes === 0, `${oneHeld.result.status} · probe ${probes}`)

  // 일괄 회수 — 계약 위반만 남으면 접근 확인(probe)·Chrome 도 0
  const DATE = '2026-10-08'
  fs.mkdirSync(path.join(D, '_runs', DATE), { recursive: true })
  fs.writeFileSync(path.join(D, '_runs', DATE, 'run.json'), JSON.stringify({ status: 'COMPLETED', selected: [], reusable: [{ slug: GRAY }, { slug: CLINIC }], inventoryDays: 0 }, null, 2))
  const LB = path.join(T, 'batch-ledger.json')
  Q.saveQuarantine({}, LB)
  let bprobes = 0
  const batch = await WEBUI.fetchBatch({ date: DATE, dryRun: false, limit: 0, draftsDir: D, resultPath: path.join(T, 'batch-result.json'),
    quarantinePath: LB, probeFn: async () => { bprobes += 1; return { status: SESS.STATUS.OK } }, browserDeps })
  const rows = batch?.results ?? JSON.parse(fs.readFileSync(path.join(T, 'batch-result.json'), 'utf8')).results
  const contractRows = rows.filter((r) => r.reason === 'BRIEF_FORMAT_CONTRACT')
  check('② fetchBatch — gray · clinic 계약 위반 2건 → probe 0 · 연결 0 · 전송 0',
    bprobes === 0 && connects === 0 && contractRows.length === 2 && rows.every((r) => r.sent !== true), `probe ${bprobes} · rows ${rows.map((r) => `${r.slug}:${r.reason}`).join(' ')}`)
  check('② fetchBatch 결과에 구조화된 위반이 남는다', contractRows.every((r) => Array.isArray(r.contractViolations) && r.contractViolations.length > 0))
}

// ── drive 공용 ──────────────────────────────────────────────
const ITEM = (slug) => ({
  day: 1, slug, title: '시험 고정 후보는 왜 그런가요', contentType: 'EVERGREEN', intent: '상황',
  cluster: 'clinic', target: '50대 전반', riskLevel: 'HIGH', reviewMode: 'FULL_REVIEW',
  imageMode: 'REQUIRED', autoEligible: false, validationProfile: 'MEDICAL',
  ctaBoard: '/community/free', internalLinks: [], whyNow: '시험', notes: '시험',
})
const MD2DRAFT = path.join(HERE, 'magazine-md-to-draft.mjs')
/** 🔴 변환기는 **실제 CLI** 를 돌린다 — 임시 루트를 cwd 로 줘서 --out 이 임시 drafts/ 안에 머문다 */
const realConvert = (args) => {
  const r = spawnSync(process.execPath, [MD2DRAFT, ...args], { cwd: T, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', json: null }
}
function makeDrive({ slug, ledger, runner = null, onQa = () => {} }) {
  const calls = { webui: 0, regen: 0, packets: [], messages: [], gates: [] }
  const dir = path.join(D, slug)
  fs.mkdirSync(path.join(T, 'cand'), { recursive: true })
  const deps = {
    paths: () => ({ dir, brief: path.join(dir, 'brief.md'), review: path.join(dir, 'review.ts'), draftMd: path.join(dir, 'draft.md'), articleTs: path.join(dir, 'article-draft.ts') }),
    heroFilePath: () => path.join(dir, 'hero.webp'),
    candidateDir: path.join(T, 'cand'),
    packetDir: path.join(T, 'packets'),
    fetchResultDir: path.join(T, 'fetch-results'),
    quarantinePath: ledger,
    draftsDir: D,
    loadQueue: () => [ITEM(slug)],
    firstFetchResult: null,
    run(file, args) {
      const name = path.basename(String(file))
      if (name === 'magazine-md-to-draft.mjs') return realConvert(args)
      if (name === 'magazine-qa.mjs') { onQa(); return { code: 0, stdout: 'QA FAIL 0', stderr: '', json: null } }
      if (name === 'magazine-webui-runner.mjs') { calls.webui += 1; return { code: 1, stdout: '', stderr: '시험: 일반 회수는 부르면 안 된다', json: null } }
      return { code: 1, stdout: '', stderr: '시험: 여기서 멈춘다', json: null }
    },
    regenRunner: (ctx) => {
      calls.regen += 1
      calls.packets.push(ctx.packet)
      calls.messages.push(DG.plannedMessageFor(ctx.slug, D, ctx.packet))
      calls.gates.push(DG.deliveryGate({ slug: ctx.slug, draftsDir: D, packet: ctx.packet, quarantinePath: ledger }))
      // 🔴 실제 자식처럼 send 직전 예약 · regenCalls 증가를 장부에서 한 번에 한다
      const reservationId = `fake-${ctx.packet.attemptId}`
      const u = Q.reserveDelivery({ slug: ctx.slug, messageFingerprint: `fake:${ctx.packet.attemptId}`, reservationId,
        regen: { attemptId: ctx.packet.attemptId, packetHash: RG.packetHashOf(ctx.packet) }, path: ledger })
      if (u.held) return { ok: false, sent: false, reason: Q.DELIVERY_HOLD_REASON, why: u.why }
      if (u.exhausted) return { ok: false, sent: false, reason: Q.REGEN_EXHAUSTED_REASON, why: u.why }
      if (!u.ok) return { ok: false, sent: false, reason: 'predelivery_record_failed', why: u.why }
      const r = runner(ctx)
      if (r?.ok) Q.releaseDeliveryReservation({ slug: ctx.slug, reservationId, path: ledger })
      return { attemptId: ctx.packet.attemptId, ...r }
    },
  }
  return { deps, calls }
}
const driveOpts = { write: true, pr: false, publishAt: '2027-01-05', alt: '시험 장면 속 50대 한국 여성', allowOptional: true, autoLane: true }
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)

// ── ③ 이미 저장된 invalid draft — 정확한 실패 패킷으로 재생성 ─────────
console.log('\n③ 기존 CONVERT_FAILED 자동 회복 — 현재 원고 + 정확한 위반으로 bounded regeneration')
{
  writeSlug(CLINIC, { brief: CLINIC_BRIEF, draft: CLINIC_DRAFT })
  const L = path.join(T, 'regen-ok.json')
  Q.saveQuarantine({}, L)
  const atQa = []
  const { deps, calls } = makeDrive({ slug: CLINIC, ledger: L,
    runner: (ctx) => { fs.writeFileSync(ctx.draftOut, CLINIC_FIXED); return { ok: true, sent: true, resultSource: 'file' } },
    onQa: () => atQa.push({ draft: read(path.join(D, CLINIC, 'draft.md')), article: read(path.join(D, CLINIC, 'article-draft.ts')) }) })
  const r = AR.drive(CLINIC, driveOpts, deps)
  const pk = calls.packets[0]
  check('③ 재생성 runner 정확히 1회 · 일반 회수(원래 brief 요청) 0회', calls.regen === 1 && calls.webui === 0, `regen ${calls.regen} · webui ${calls.webui}`)
  check(`③ 패킷 첫 실패가 정확히 "${CLINIC_VIOLATION}"`, pk?.failures?.[0]?.code === 'MANUSCRIPT_FORMAT' && pk.failures[0].label === CLINIC_VIOLATION,
    JSON.stringify(pk?.failures?.[0]))
  check('③ 패킷 지시문에 위반 줄과 표기 규칙이 있다', pk?.instruction?.includes(CLINIC_VIOLATION) && pk.instruction.includes('[CTA] /community/게시판 | 문구 | 앞 문장'))
  const msg = calls.messages[0] ?? ''
  check('③ 보낸 메시지는 재생성 메시지다 — 현재 원고 전문 + 위반 · 원래 brief 요청문이 아니다',
    msg.includes(DG.CURRENT_DRAFT_BEGIN) && msg.includes('[병원 예약이나 접수 때문에 겪었던 이야기를 나눠보세요.](/community/free)')
      && msg.includes(CLINIC_VIOLATION) && !msg.startsWith(DG.legacyManuscriptPromptText(null).slice(0, 30)))
  check('③ 재생성은 brief 형식 계약에 막히지 않는다 (위반과 규칙이 패킷에 있다)', calls.gates[0]?.ok === true && !calls.gates[0]?.hold, calls.gates[0]?.code)
  check('③ QA 시점의 draft.md 는 고친 원고 · article 은 실제 변환기로 만든 CTA 블록을 가진다',
    atQa[0]?.draft === CLINIC_FIXED && /type: 'cta'/.test(atQa[0]?.article ?? '') && /href: '\/community\/free'/.test(atQa[0]?.article ?? ''),
    `${atQa.length}회 · ${atQa[0]?.draft === CLINIC_FIXED}`)
  check('③ 재생성 기록이 APPLIED 다', r.regenHistory?.[0]?.outcome === 'APPLIED' && r.regenHistory[0].stage === 'article', JSON.stringify(r.regenHistory?.[0]))
  check('③ 재생성 예산을 장부가 센다 (regenCalls 1)', Q.readQuarantine(L).store[CLINIC]?.regenCalls === 1, JSON.stringify(Q.readQuarantine(L).store[CLINIC]))
}
{
  // 실패 3종 — 기존 draft/article 바이트 불변
  const cases = [
    ['재생성 원고도 CTA 0', (ctx) => { fs.writeFileSync(ctx.draftOut, CLINIC_DRAFT.replace('병원 예약', '병원 접수')); return { ok: true, sent: true, resultSource: 'file' } }, 'REGEN_CANDIDATE_INVALID'],
    ['runner 예외', () => { throw new Error('시험: 자식이 죽었다') }, 'REGEN_RUNNER_FAILED'],
  ]
  for (const [name, runner, code] of cases) {
    writeSlug(CLINIC, { brief: CLINIC_BRIEF, draft: CLINIC_DRAFT })
    const L = path.join(T, `regen-fail-${code}.json`)
    Q.saveQuarantine({}, L)
    const { deps } = makeDrive({ slug: CLINIC, ledger: L, runner })
    const r = AR.drive(CLINIC, driveOpts, deps)
    const msg = r.blockedBy?.map((b) => `${b.code}: ${b.message}`).join(' | ') ?? ''
    check(`③ ${name} → BLOCKED · CONVERT_FAILED · ${code}`, r.verdict === 'BLOCKED' && r.blockedBy?.[0]?.code === 'CONVERT_FAILED' && msg.includes(code), msg.slice(0, 160))
    check(`③ ${name} → draft.md 바이트 불변 · article 생성 0`,
      read(path.join(D, CLINIC, 'draft.md')) === CLINIC_DRAFT && !fs.existsSync(path.join(D, CLINIC, 'article-draft.ts')))
    check(`③ ${name} → 결과에 실제 위반(72행)이 구조화돼 남고 안내문은 없다`,
      msg.includes(CLINIC_VIOLATION) && r.formatViolations?.[0]?.line === 72 && !msg.includes('ChatGPT 에게 brief 의 마크다운 규칙을'), msg.slice(0, 160))
  }
  // 예산 소진 — runner 0 · 바이트 불변
  writeSlug(CLINIC, { brief: CLINIC_BRIEF, draft: CLINIC_DRAFT })
  const LX = path.join(T, 'regen-exhausted.json')
  Q.saveQuarantine({ [CLINIC]: { attempts: 1, regenCalls: Q.MAX_REGEN_CALLS } }, LX)
  const ex = makeDrive({ slug: CLINIC, ledger: LX, runner: () => ({ ok: true }) })
  const rx = AR.drive(CLINIC, driveOpts, ex.deps)
  check('③ 재생성 예산 소진 → runner 0 · REGEN_EXHAUSTED · 바이트 불변',
    ex.calls.regen === 0 && /REGEN_EXHAUSTED/.test(rx.blockedBy?.[0]?.message ?? '') && read(path.join(D, CLINIC, 'draft.md')) === CLINIC_DRAFT,
    `regen ${ex.calls.regen} · ${rx.blockedBy?.[0]?.message?.slice(0, 80)}`)
  // 교체 중 급사 — 저널 원복 (draft · article 둘 다 원본 바이트)
  writeSlug(CLINIC, { brief: CLINIC_BRIEF, draft: CLINIC_DRAFT })
  const art = path.join(D, CLINIC, 'article-draft.ts')
  const ART0 = "export const DRAFT = { title: '이전 변환본' }\n"
  fs.writeFileSync(art, ART0)
  const cand = path.join(T, 'crash-candidate.md')
  fs.writeFileSync(cand, CLINIC_FIXED)
  const crash = AR.applyRegenCandidate({ slug: CLINIC, candidatePath: cand, draftMd: path.join(D, CLINIC, 'draft.md'), articleTs: art,
    runFn: (file, args) => realConvert(args), verifyHero: () => ({ ok: false }),
    phaseHook: (phase) => { if (phase === 'draft-committed') throw new Error('시험: draft 만 바꾼 뒤 죽었다') } })
  check('③ 교체 중 급사 → 실패 · draft · article 원본 바이트 그대로',
    crash.ok === false && read(path.join(D, CLINIC, 'draft.md')) === CLINIC_DRAFT && read(art) === ART0, `${crash.code}`)
  fs.rmSync(art, { force: true })
}
{
  // brief echo 원고는 재생성하지 않는다 — "현재 원고" 가 원고가 아니다
  const COLD = 'cold-weather-joint-pain'
  writeSlug(COLD, { brief: fx('job-credentials.brief.md'), draft: fx(`${COLD}.draft.md`) })
  const L = path.join(T, 'echo.json')
  Q.saveQuarantine({}, L)
  const { deps, calls } = makeDrive({ slug: COLD, ledger: L, runner: () => ({ ok: true }) })
  const r = AR.drive(COLD, driveOpts, deps)
  check('③ brief echo 원고(cold-weather) → DRAFT_INVALID · 재생성 0 · 일반 회수 0',
    r.blockedBy?.[0]?.code === 'DRAFT_INVALID' && calls.regen === 0 && calls.webui === 0, `${r.blockedBy?.[0]?.code} · regen ${calls.regen}`)
}

// ── ④ 저장 전 판정 · CLI · 정본 하나 ──────────────────────────
console.log('\n④ 원고 형식 판정 정본 — md-to-draft CLI · 원고 관문 · auto-register 가 같은 함수')
{
  const j = FMT.judgeManuscriptFormat(CLINIC_DRAFT)
  check(`④ judgeManuscriptFormat(clinic) → 정확히 1건 "${CLINIC_VIOLATION}"`, j.violations.length === 1 && FMT.describeFormatViolation(j.violations[0]) === CLINIC_VIOLATION,
    j.violations.map(FMT.describeFormatViolation).join(' | '))
  const v = MG.validateManuscript(CLINIC_DRAFT)
  check('④ 원고 관문(clinic) → FORMAT_VIOLATION · 저장 금지', !v.ok && v.reasons.some((x) => x.code === 'FORMAT_VIOLATION' && x.why === CLINIC_VIOLATION))
  check('④ 원고 관문 결과에 구조화된 formatViolations 가 실린다', v.formatViolations?.[0]?.line === 72)
  const numbered = CLINIC_FIXED.replace('## ', '1. 첫째 항목입니다\n2. 둘째 항목입니다\n\n## ')
  const vn = MG.validateManuscript(numbered)
  check('④ 번호 목록 원고 → 저장 금지', !vn.ok && vn.reasons.some((x) => x.code === 'FORMAT_VIOLATION' && /번호 목록/.test(x.why)))
  check('④ 고친 clinic 원고는 관문 통과', MG.validateManuscript(CLINIC_FIXED).ok, MG.describeReasons(MG.validateManuscript(CLINIC_FIXED).reasons))
  const p = path.join(T, 'cli-clinic.md')
  fs.writeFileSync(p, CLINIC_DRAFT)
  const cli = spawnSync(process.execPath, [MD2DRAFT, '--in', p], { cwd: T, encoding: 'utf8' })
  check(`④ md-to-draft CLI 도 같은 판정 — exit 1 · "✗ ${CLINIC_VIOLATION}"`, cli.status === 1 && cli.stderr.includes(`✗ ${CLINIC_VIOLATION}`), cli.stderr.slice(0, 200))
  for (const s of SUCCESS) {
    const tp = path.join(REPO, 'drafts', 'magazine', s, 'draft.md')
    if (!fs.existsSync(tp)) { check(`④ PR #670 성공 원고 ${s} 가 저장소에 있다`, false); continue }
    const t = fs.readFileSync(tp, 'utf8')
    const ok = FMT.judgeManuscriptFormat(t).ok && MG.validateManuscript(t).ok
    const c = spawnSync(process.execPath, [MD2DRAFT, '--in', tp], { cwd: REPO, encoding: 'utf8' })
    check(`④ PR #670 성공 원고 ${s} → 판정 · 관문 · CLI 모두 통과 (회귀 0)`, ok && c.status === 0, `${MG.describeReasons(MG.validateManuscript(t).reasons)} · cli ${c.status}`)
  }
}

// ── ⑤ 실패 기록 — 구조화된 위반이 결과·장부에 ───────────────────
console.log('\n⑤ 실패 기록 — 사람용 안내문이 아니라 실제 위반을 결과와 장부에')
{
  writeSlug(CLINIC, { brief: CLINIC_BRIEF, draft: CLINIC_DRAFT })
  const L = path.join(T, 'ledger-record.json')
  Q.saveQuarantine({}, L)
  const { deps } = makeDrive({ slug: CLINIC, ledger: L, runner: () => ({ ok: false, sent: false, reason: 'composer_empty', why: '시험: 보내지 못했다', resultSource: 'file' }) })
  const report = { blocked: [], done: [] }
  READY.processCandidates({ write: true, wantPr: false, limit: 1, report, quarantinePath: L,
    scanFn: () => ({ source: 'fixture', pool: 1, eligible: [{ slug: CLINIC, item: ITEM(CLINIC), progress: { hasBrief: true, hasReview: true, hasDraftMd: true } }], skipped: [], quarantined: [] }),
    driveFn: (sl, o) => AR.drive(sl, o, deps) })
  const e = Q.readQuarantine(L).store[CLINIC] ?? {}
  check('⑤ 장부 항목에 formatViolations [{line:72, why}] 가 남는다',
    e.formatViolations?.[0]?.line === 72 && e.formatViolations[0].why === '[CTA] 는 정확히 1개여야 한다 (현재 0개)', JSON.stringify(e.formatViolations))
  check('⑤ 장부 사유 문장에 72행 위반이 있고 안내문은 없다',
    (e.reasons ?? []).some((x) => x.includes(CLINIC_VIOLATION)) && !(e.reasons ?? []).some((x) => x.includes('ChatGPT 에게 brief 의 마크다운 규칙을')), JSON.stringify(e.reasons)?.slice(0, 200))

  // brief 계약 위반 — drive 의 앞단 판정: 이 글만 막고 회차는 이어 간다
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  const LG = path.join(T, 'drive-gray.json')
  Q.saveQuarantine({}, LG)
  const g = makeDrive({ slug: GRAY, ledger: LG, runner: () => ({ ok: true }) })
  const rg = AR.drive(GRAY, driveOpts, g.deps)
  check('⑤ drive(gray, 원고 없음) → BRIEF_FORMAT_CONTRACT · runner 0 · 회차 전체 정지 아님 · sent false',
    rg.blockedBy?.[0]?.code === 'BRIEF_FORMAT_CONTRACT' && g.calls.webui === 0 && g.calls.regen === 0 && !rg.failClosed && rg.sent === false,
    `${rg.blockedBy?.[0]?.code} · webui ${g.calls.webui} · failClosed ${rg.failClosed}`)
  check('⑤ drive(gray) 결과에 구조화된 계약 위반이 남는다', rg.blockedBy?.[0]?.contractViolations?.length > 0)
}

// ── ⑥ 불변 — 전송 메시지 · 지문 · 재생성 지시문 ────────────────────
console.log('\n⑥ 불변 — 일반 전송 메시지 · 기존 지문 · QA 재생성 지시문은 그대로')
{
  const h = (t) => sha(t).slice(0, 16)
  check('⑥ legacyManuscriptPromptText 바이트 불변', h(DG.legacyManuscriptPromptText(null)) === '5bb6e6ccb4bb9d3f', h(DG.legacyManuscriptPromptText(null)))
  check('⑥ 일반 전송 프롬프트 = legacy 그대로', DG.manuscriptPromptText(null) === DG.legacyManuscriptPromptText(null))
  const pk = RG.buildFailurePacket({ slug: 'x', profile: 'STANDARD', failures: [{ code: 'QA_FAIL', label: 'magazine QA FAIL', sentence: 's' }], attempt: 1, attemptId: 'a' })
  check('⑥ QA 재생성 지시문 바이트 불변 (기존 재생성 HOLD 지문 보존)', h(pk.instruction) === 'aeea1a85dce887b0', h(pk.instruction))
}

check('실제 CDP 포트 요청 0 (운영 Chrome 에 닿지 않았다)', realCdpAttempts.length === 0, realCdpAttempts.join(' · '))
finish()
process.exitCode = fail ? 1 : 0
