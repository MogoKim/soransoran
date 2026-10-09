#!/usr/bin/env node
/**
 * 입력 수리 단계 검사 — 2026-10-10 자연 회차 REPAIR_REQUIRED 3건.
 *
 *   ① gray-hair-leave-as-is  BRIEF_FORMAT_CONTRACT   → brief·review 후보를 임시로 받아 검증 후 한 쌍 교체
 *   ② cold-weather-joint-pain DRAFT_INVALID(brief echo) → 전용 수리 요청 → 임시 후보 검증 후 draft 만 교체
 *   ③ autumn-low-mood         DRAFT_INVALID(brief echo) → 같은 경로
 *
 * 실제 운영 사본 fixture(gray brief · cold draft)와 실제 큐 행 · 실제 판정 함수로 돈다.
 * 🔴 운영 접근 0 — HOME·원고 폴더·장부는 임시 폴더, Claude·ChatGPT 는 가짜, 9333/9344 요청은 차단·계수.
 *    autumn 의 실제 draft 는 runtime 에만 있어(이번 작업은 runtime 을 읽지 않는다) 같은 모양의 brief echo 로 대신한다.
 *
 * 사용: node scripts/magazine-input-repair-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const realCdpAttempts = []
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input)
  if (/^https?:\/\/(127\.0\.0\.1|localhost):(9333|9344)\b/.test(url)) { realCdpAttempts.push(url); throw new Error(`시험이 실제 CDP 에 닿으려 했다: ${url}`) }
  return realFetch(input, init)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)
const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'input-repair-')))
const D = path.join(T, 'drafts', 'magazine')
fs.mkdirSync(D, { recursive: true })
// 🔴 magazine 모듈을 읽기 전에 HOME · 원고 폴더 · 시험 모드를 고정한다
process.env.HOME = T
process.env.SORAN_MAGAZINE_DRAFTS_DIR = D
process.env.SORAN_MAGAZINE_TEST_MODE = '1'
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }))

const Q = await import('./lib/magazine-quarantine.mjs')
if (!path.resolve(Q.QUARANTINE_PATH).startsWith(T + path.sep)) {
  console.log(`  ❌ 장부 기본 경로가 격리 HOME 밖이다 — 파일 접근 전에 멈춘다: ${Q.QUARANTINE_PATH}`)
  console.log('\n🔴 격리 실패 — 검사 0건 실행\n')
  process.exit(1)
}
const IR = await import('./lib/magazine-input-repair.mjs')
const DG = await import('./lib/magazine-delivery-gate.mjs')
const RG = await import('./lib/magazine-regen.mjs')
const MG = await import('./lib/magazine-manuscript-guard.mjs')
const L = await import('./lib/magazine-load.mjs')
const BA = await import('./magazine-brief-auto.mjs')
const PF = await import('./lib/magazine-producer-flow.mjs')
const WEBUI = await import('./magazine-webui-runner.mjs')
const SESS = await import('./lib/chatgpt-session.mjs')

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const finish = () => console.log(`\n${fail ? '🔴' : '✅'} 입력 수리 검사 ${pass}/${pass + fail}\n`)
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.stack ?? e}`); finish(); process.exit(1) })
process.on('unhandledRejection', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.stack ?? e}`); finish(); process.exit(1) })

// ── fixture ────────────────────────────────────────────────
const FX = path.join(HERE, 'fixtures', 'magazine-format-contract')
const fx = (n) => fs.readFileSync(path.join(FX, n), 'utf8')
const GRAY_BRIEF = fx('gray-hair-leave-as-is.brief.md')
const COLD_DRAFT = fx('cold-weather-joint-pain.draft.md')
const GOOD_BRIEF = fx('job-credentials.brief.md')
const tracked = (slug, f) => fs.readFileSync(path.join(REPO, 'drafts', 'magazine', slug, f), 'utf8')
const GOOD_PAIR = { brief: tracked('avoiding-gatherings', 'brief.md'), review: tracked('avoiding-gatherings', 'review.ts') }
const GF_BAD_PAIR = { brief: tracked('belly-fat-menopause', 'brief.md'), review: tracked('belly-fat-menopause', 'review.ts') }
const GOOD_DRAFT = tracked('job-credentials', 'draft.md')
const CLINIC_DRAFT = fx('clinic-booking-app.draft.md')
const QUEUE = L.loadQueue()
const item = (slug) => QUEUE.find((q) => q.slug === slug)
const GRAY = 'gray-hair-leave-as-is'
const COLD = 'cold-weather-joint-pain'
const AUTUMN = 'autumn-low-mood'
/** autumn 의 brief echo — 실제 큐 제목 + brief 섹션 그대로 (runtime 원본을 읽지 않고 같은 모양을 만든다) */
const AUTUMN_ECHO = `---\ntitle: ${item(AUTUMN)?.title}\ndescription: 가을에 마음이 내려앉는 이야기를 우리 또래와 함께 살펴봅니다\ncluster: ${item(AUTUMN)?.cluster}\n---\n\n## 검색 의도\n\n가을 우울을 검색하는 사람의 의도.\n\n## 대상 독자\n\n50대 여성.\n\n## 글 구조\n\n1. 가을에 마음이 내려앉는 이야기는 우리 또래에서 자주 오갑니다.\n\n[CTA] /community/menopause | 갱년기톡에 오늘 마음 남기기 | 남겨 주세요\n`
const sha = (t) => createHash('sha256').update(t).digest('hex')
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)
const p = (slug, f) => path.join(D, slug, f)
const HOLD_SLUGS = ['palpitations-menopause', 'dizziness-menopause', 'breast-exam-interval', 'clinic-or-wait', 'how-much-talk-with-husband', 'retirement-prep-status']

function writeSlug(slug, { brief, review = 'export const REVIEW = { old: true }\n', draft = null }) {
  fs.rmSync(path.join(D, slug), { recursive: true, force: true })
  fs.mkdirSync(path.join(D, slug), { recursive: true })
  fs.writeFileSync(p(slug, 'brief.md'), brief)
  fs.writeFileSync(p(slug, 'review.ts'), review)
  if (draft !== null) fs.writeFileSync(p(slug, 'draft.md'), draft)
}
const holdRow = (fp = 'sha256:old') => ({ attempts: 2, delivery: { sent: null, messageFingerprint: fp, kind: 'DELIVERY_UNCERTAIN', reason: 'sending', stage: 'send', at: 1, runId: null, date: '2026-09-28', reservationId: 'r-old' } })
const seedLedger = (name, store = {}) => { const f = path.join(T, `${name}.json`); Q.saveQuarantine(store, f); return f }

/** 가짜 바깥 — 호출을 센다. 재전송은 실제 장부 예약을 지나게 한다(실제 자식과 같은 계약) */
function fakeDeps({ ledger, brief = () => ({ ok: true, briefText: GOOD_PAIR.brief, reviewText: GOOD_PAIR.review, calls: 1 }), reply = () => GOOD_DRAFT, rowFor = null, convert = null } = {}) {
  const calls = { generateBrief: [], runner: [], convert: 0 }
  return {
    calls,
    deps: {
      log: () => {},
      parseReview: BA.parseReview,
      generateBrief: async (t) => { calls.generateBrief.push(t.slug); return brief(t) },
      repairGate: ({ slug }) => ({ gate: DG.inputRepairGate({ slug, draftsDir: D, quarantinePath: ledger }) }),
      runRepairFetch: async ({ slug, draftOut }) => {
        calls.runner.push(slug)
        if (rowFor) return rowFor({ slug, draftOut })
        const gate = DG.inputRepairGate({ slug, draftsDir: D, quarantinePath: ledger })
        const reservationId = `r-${slug}-${calls.runner.length}`
        const u = Q.reserveDelivery({ slug, messageFingerprint: gate.messageFingerprint, reservationId, inputRepair: { fingerprint: gate.messageFingerprint }, path: ledger })
        if (!u.ok) return { slug, status: 'held', sent: false, errorDetail: u.why }
        fs.writeFileSync(draftOut, reply({ slug }))
        Q.releaseDeliveryReservation({ slug, reservationId, path: ledger })
        return { slug, status: 'ok', sent: true, conversationUrl: `https://chatgpt.com/c/fake-${slug}` }
      },
      convertCheck: convert ?? ((candidate) => {
        calls.convert += 1
        const r = spawnSync(process.execPath, [path.join(HERE, 'magazine-md-to-draft.mjs'), '--in', candidate], { cwd: T, encoding: 'utf8' })
        return r.status === 0 ? { ok: true } : { ok: false, why: r.stderr.slice(0, 200) }
      }),
    },
  }
}
const run = (q, ledger, f, max) => IR.runInputRepair({ draftsDir: D, queue: q, ledger: Q.readQuarantine(ledger), deps: f.deps, tmpDir: path.join(T, 'tmp'), ...(max ? { max } : {}) })
const byslug = (rep, slug) => rep.results.find((r) => r.slug === slug)

// ── ④ 판정 — 실제 cold draft 는 brief echo ────────────────
console.log('\n④ 대상 판정 — 실제 fixture · 실제 큐 행')
{
  check('④ 실제 큐에 세 글이 있고 자동 레인 대상이다', [GRAY, COLD, AUTUMN].every((s) => item(s)), [GRAY, COLD, AUTUMN].filter((s) => !item(s)).join(','))
  check('④ 실제 cold draft → brief echo 로 정확히 판정 (## 검색 의도 등)', MG.briefEchoHeadings(COLD_DRAFT).length > 0, MG.briefEchoHeadings(COLD_DRAFT).join(','))
  check('④ autumn 같은 모양 → brief echo', MG.briefEchoHeadings(AUTUMN_ECHO).length > 0)
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  writeSlug(AUTUMN, { brief: GOOD_BRIEF, draft: AUTUMN_ECHO })
  writeSlug('job-credentials', { brief: GOOD_BRIEF })
  writeSlug('avoiding-gatherings', { brief: GOOD_BRIEF, draft: GOOD_DRAFT })
  for (const s of HOLD_SLUGS) writeSlug(s, { brief: GRAY_BRIEF })
  const store = Object.fromEntries(HOLD_SLUGS.map((s) => [s, holdRow()]))
  const { targets, skipped } = IR.scanRepairTargets({ queue: QUEUE, draftsDir: D, store })
  const types = Object.fromEntries(targets.map((t) => [t.slug, t.type]))
  check('④ 대상 = gray(BRIEF) · cold · autumn(DRAFT_ECHO) 정확히 3건', targets.length === 3 && types[GRAY] === IR.REPAIR.BRIEF && types[COLD] === IR.REPAIR.DRAFT_ECHO && types[AUTUMN] === IR.REPAIR.DRAFT_ECHO,
    JSON.stringify(types))
  check('⑩ 정상 brief(job-credentials) · 정상 draft(avoiding-gatherings)는 대상이 아니다', !types['job-credentials'] && !types['avoiding-gatherings'])
  check('⑨ HOLD 6건은 대상이 아니라 DELIVERY_UNCERTAIN_HOLD 로 비켜 둔다', HOLD_SLUGS.every((s) => skipped.some((x) => x.slug === s && x.reason === 'DELIVERY_UNCERTAIN_HOLD')) && HOLD_SLUGS.every((s) => !types[s]),
    skipped.map((x) => x.slug).join(','))
  check('④ 순서는 큐 day → slug (결정적)', targets.map((t) => t.slug).join(',') === [...targets].sort((a, b) => a.item.day - b.item.day || a.slug.localeCompare(b.slug)).map((t) => t.slug).join(','))
}

// ── ① ② brief 수리 ────────────────────────────────────────
console.log('\n① ② gray brief 수리 — 임시 후보 검증 뒤 brief·review 한 쌍 교체 · 실패면 바이트 불변')
{
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  const L1 = seedLedger('b1')
  const f = fakeDeps({ ledger: L1 })
  const rep = await run([item(GRAY)], L1, f)
  const r = byslug(rep, GRAY)
  check('① gray → APPLIED · brief·review 가 후보로 한 쌍 교체', r?.outcome === 'APPLIED' && read(p(GRAY, 'brief.md')) === GOOD_PAIR.brief && read(p(GRAY, 'review.ts')) === GOOD_PAIR.review, `${r?.outcome} · ${r?.reason}`)
  check('① 교체 뒤 brief 가 형식 계약을 통과한다', (await import('./lib/magazine-manuscript-format.mjs')).judgeBriefFormatContract(read(p(GRAY, 'brief.md'))).ok)
  check('① journal · 사본 · staged 잔여 0', fs.readdirSync(path.join(D, GRAY)).every((n) => !n.includes('input-repair')), fs.readdirSync(path.join(D, GRAY)).join(','))
  check('① 결과에 slug · type · repairFingerprint · candidateApplied · violations 가 구조화돼 있다',
    r.type === IR.REPAIR.BRIEF && /^sha256:/.test(r.repairFingerprint) && r.candidateApplied === true && r.violations.length > 0 && r.sent === false)

  // ② 후보가 계약 위반 (실제 GF 위반 쌍) → 원본 두 파일 바이트 불변
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  const before = [sha(read(p(GRAY, 'brief.md'))), sha(read(p(GRAY, 'review.ts')))]
  const f2 = fakeDeps({ ledger: L1, brief: () => ({ ok: true, briefText: GF_BAD_PAIR.brief, reviewText: GF_BAD_PAIR.review, calls: 1 }) })
  const r2 = byslug(await run([item(GRAY)], L1, f2), GRAY)
  check('② 후보가 형식 계약 위반(실제 GF 위반 쌍) → REJECTED · 두 파일 바이트 불변',
    r2?.outcome === 'REJECTED' && sha(read(p(GRAY, 'brief.md'))) === before[0] && sha(read(p(GRAY, 'review.ts'))) === before[1], `${r2?.outcome} · ${r2?.candidateViolations?.join(' / ')}`)
  const f3 = fakeDeps({ ledger: L1, brief: () => ({ ok: false, why: '시험: 생성 실패', calls: 2 }) })
  const r3 = byslug(await run([item(GRAY)], L1, f3), GRAY)
  check('② 생성 실패 → FAILED · 바이트 불변', r3?.outcome === 'FAILED' && sha(read(p(GRAY, 'brief.md'))) === before[0])
}

// ── ③ ⑬ 쌍 교체 중 급사 → 다음 실행이 원복 ─────────────────
console.log('\n③ ⑬ 쌍 교체 중 SIGKILL · 쓰기 실패 → 다음 실행이 원복 · 잔여 0')
{
  const LIB = pathToFileURL(path.join(HERE, 'lib', 'magazine-input-repair.mjs')).href
  for (const phase of ['prepared', 'committing-1']) {
    const dir = path.join(T, `kill-${phase}`)
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'brief.md'), 'OLD BRIEF\n')
    fs.writeFileSync(path.join(dir, 'review.ts'), 'OLD REVIEW\n')
    const child = path.join(T, `kill-${phase}.mjs`)
    fs.writeFileSync(child, `const IR = await import(${JSON.stringify(LIB)})
IR.commitFiles({ dir: ${JSON.stringify(dir)}, files: [{ path: ${JSON.stringify(path.join(dir, 'brief.md'))}, text: 'NEW BRIEF\\n' }, { path: ${JSON.stringify(path.join(dir, 'review.ts'))}, text: 'NEW REVIEW\\n' }],
  phaseHook: (ph) => { if (ph === ${JSON.stringify(phase)}) process.kill(process.pid, 'SIGKILL') } })
`)
    const k = spawnSync(process.execPath, [child], { encoding: 'utf8' })
    const mid = [read(path.join(dir, 'brief.md')), read(path.join(dir, 'review.ts'))]
    check(`③ ${phase} 에서 실제 SIGKILL 됐다 (죽은 시험 아님)`, k.signal === 'SIGKILL' && fs.existsSync(path.join(dir, IR.JOURNAL_FILE)), `${k.signal} · ${mid.join('|')}`)
    const rec = IR.recoverJournal(dir)
    check(`③ ${phase} 급사 → 다음 실행이 두 파일을 원본 바이트로 되돌린다`, rec.recovered && read(path.join(dir, 'brief.md')) === 'OLD BRIEF\n' && read(path.join(dir, 'review.ts')) === 'OLD REVIEW\n',
      `${JSON.stringify(rec)} · ${read(path.join(dir, 'brief.md'))}`)
    check(`⑬ ${phase} 원복 뒤 journal · 사본 · staged 잔여 0`, fs.readdirSync(dir).sort().join(',') === 'brief.md,review.ts', fs.readdirSync(dir).join(','))
  }
  // 두 번째 파일 쓰기 실패 — 첫 파일만 바뀐 채 예외 → 원복
  const dir = path.join(T, 'write-fail')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'brief.md'), 'OLD BRIEF\n')
  fs.writeFileSync(path.join(dir, 'review.ts'), 'OLD REVIEW\n')
  let threw = false
  try {
    IR.commitFiles({ dir, files: [{ path: path.join(dir, 'brief.md'), text: 'NEW\n' }, { path: path.join(dir, 'review.ts'), text: 'NEW\n' }],
      phaseHook: (ph) => { if (ph === 'committing-1') throw new Error('시험: 두 번째 파일 쓰기 실패') } })
  } catch { threw = true }
  const rec = IR.recoverJournal(dir)
  check('③ 두 번째 파일 쓰기 실패 → 다음 실행이 원복 (brief 도 원본)', threw && rec.recovered && read(path.join(dir, 'brief.md')) === 'OLD BRIEF\n' && fs.readdirSync(dir).length === 2)
  // runInputRepair 가 시작할 때 남은 journal 을 먼저 처리한다
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  fs.writeFileSync(path.join(D, GRAY, IR.JOURNAL_FILE), JSON.stringify({ version: 'input-repair-journal/1', phase: 'committing-1',
    files: [{ path: p(GRAY, 'brief.md'), existed: true, backup: `${p(GRAY, 'brief.md')}.bk`, staged: `${p(GRAY, 'brief.md')}.st` }] }))
  fs.writeFileSync(`${p(GRAY, 'brief.md')}.bk`, GRAY_BRIEF)
  fs.writeFileSync(p(GRAY, 'brief.md'), 'HALF-WRITTEN\n')
  const L3 = seedLedger('b3')
  const rep = await run([item(GRAY)], L3, fakeDeps({ ledger: L3, brief: () => ({ ok: false, why: 'x' }) }))
  check('⑬ 회차 시작 시 남은 journal 을 원복하고 나서 수리한다', rep.recovered.some((x) => x.slug === GRAY && x.recovered) && read(p(GRAY, 'brief.md')) === GRAY_BRIEF && !fs.existsSync(path.join(D, GRAY, IR.JOURNAL_FILE)))
}

// ── ⑤ ⑥ draft echo 수리 ──────────────────────────────────
console.log('\n⑤ ⑥ cold · autumn — 전용 수리 응답이 정상 원고면 draft 만 원자 교체 · 아니면 불변')
{
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  writeSlug(AUTUMN, { brief: GOOD_BRIEF, draft: AUTUMN_ECHO })
  const L5 = seedLedger('d5', { [COLD]: { attempts: 2, regenCalls: 2, kind: 'CONTENT' } })
  const f = fakeDeps({ ledger: L5 })
  const rep = await run([item(COLD), item(AUTUMN)], L5, f)
  const rc = byslug(rep, COLD)
  check('⑤ cold → APPLIED · draft 만 교체 (brief 그대로)', rc?.outcome === 'APPLIED' && read(p(COLD, 'draft.md')) === GOOD_DRAFT && read(p(COLD, 'brief.md')) === GOOD_BRIEF, `${rc?.outcome} · ${rc?.reason}`)
  check('⑤ autumn → APPLIED', byslug(rep, AUTUMN)?.outcome === 'APPLIED')
  check('⑤ 실제 변환기 검사를 지났다 (2건)', f.calls.convert === 2)
  check('⑤ 결과에 sent · conversationUrl · repairFingerprint · candidateApplied', rc.sent === true && rc.conversationUrl === `https://chatgpt.com/c/fake-${COLD}` && /^sha256:/.test(rc.repairFingerprint) && rc.candidateApplied === true)
  const e = Q.readQuarantine(L5).store[COLD]
  check('C. 회계 — inputRepairCalls 1 · 수리 지문 기록 · attempts·regenCalls 불변 (재생성 예산 초기화 0)',
    e.inputRepairCalls === 1 && e.inputRepairFingerprints?.[0] === rc.repairFingerprint && e.attempts === 2 && e.regenCalls === 2 && e.kind === 'CONTENT', JSON.stringify(e))
  // ⑥ 응답도 brief echo · 형식 오류
  for (const [name, bad] of [['brief echo', COLD_DRAFT], ['CTA 0 형식 오류', CLINIC_DRAFT]]) {
    writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
    const L6 = seedLedger(`d6-${name.length}`)
    const r6 = byslug(await run([item(COLD)], L6, fakeDeps({ ledger: L6, reply: () => bad })), COLD)
    check(`⑥ 수리 응답이 ${name} → REJECTED · 기존 draft 바이트 불변`, r6?.outcome === 'REJECTED' && read(p(COLD, 'draft.md')) === COLD_DRAFT, `${r6?.outcome} · ${r6?.candidateViolations?.slice(0, 2).join(' / ')}`)
  }
}

// ── ⑦ ⑧ 지문 중복 · 전송불명 ────────────────────────────────
console.log('\n⑦ ⑧ 같은 수리 지문 재실행 · 전송불명 → runner 0 · 재전송 0')
{
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  const L7 = seedLedger('d7')
  const f1 = fakeDeps({ ledger: L7, reply: () => COLD_DRAFT }) // 1회차: 보냈지만 응답도 echo → REJECTED (정산됨)
  await run([item(COLD)], L7, f1)
  const f2 = fakeDeps({ ledger: L7 })
  const r2 = byslug(await run([item(COLD)], L7, f2), COLD)
  check('⑦ 같은 수리 지문 재실행 → HELD · runner 0 · 전송 0', r2?.outcome === 'HELD' && f2.calls.runner.length === 0 && read(p(COLD, 'draft.md')) === COLD_DRAFT, `${r2?.outcome} · runner ${f2.calls.runner.length}`)
  check('⑦ 장부의 수리 전송은 여전히 1회', Q.readQuarantine(L7).store[COLD].inputRepairCalls === 1)
  // ⑧ 실제 전송 경계 — 예약 뒤 send · 응답 확인 실패 → 전송불명 HOLD
  writeSlug(AUTUMN, { brief: GOOD_BRIEF, draft: AUTUMN_ECHO })
  const L8 = seedLedger('d8')
  const repairFp = DG.inputRepairGate({ slug: AUTUMN, draftsDir: D, quarantinePath: L8 }).messageFingerprint
  let typed = ''
  let sends = 0
  const page = {
    async goto() {}, async waitForSelector() {}, async close() {}, async waitForTimeout() {},
    keyboard: { async insertText(t) { typed += t }, async press() {} },
    locator: (sel) => { const send = /send-button|보내기|Send/.test(String(sel)); const o = { async click() { if (send) sends += 1 }, async innerText() { return typed } }; return { first: () => o, ...o } },
    async evaluate() { return { readOk: true, stop: false, units: [] } },
  }
  let probes = 0
  const out = path.join(T, 'repair-out.md')
  const one = await WEBUI.fetchOne(AUTUMN, { inputRepair: { type: 'BRIEF_ECHO' }, draftOut: out, quarantinePath: L8, draftsDir: D, exit: () => {},
    probeFn: async () => { probes += 1; return { status: SESS.STATUS.OK } },
    browserDeps: { ensureTab: async () => ({ ok: true }), connect: async () => ({ contexts: () => [{ newPage: async () => page, pages: () => [] }], async close() {} }), timeoutMs: 60, pollMs: 5, stablePolls: 2 } })
  const e8 = Q.readQuarantine(L8).store[AUTUMN]
  check('⑧ 실제 전송 경계 — 수리 지문으로 예약 · send 1 · 응답 미확인', sends === 1 && one.result.sent === true && e8?.delivery?.messageFingerprint === repairFp && e8.delivery.kind === 'DELIVERY_UNCERTAIN',
    `${one.result.reason} · sends ${sends} · ${JSON.stringify(e8?.delivery)}`)
  check('⑧ 보낸 것은 일반 최초 요청이 아니라 수리 메시지다 (지문이 다르다)',
    repairFp !== Q.deliveryFingerprintOf(DG.plannedMessageFor(AUTUMN, D)) && typed.startsWith('[입력 수리 요청]'), typed.slice(0, 40))
  check('⑧ 회계 — inputRepairCalls 1 · regenCalls·attempts 0', e8.inputRepairCalls === 1 && e8.regenCalls === undefined && (e8.attempts ?? 0) === 0, JSON.stringify(e8))
  check('⑧ 임시 경로에만 — draft.md 바이트 불변 · 임시 원고 0', read(p(AUTUMN, 'draft.md')) === AUTUMN_ECHO && !fs.existsSync(out))
  const f8 = fakeDeps({ ledger: L8 })
  const rep8 = await run([item(AUTUMN)], L8, f8)
  const s8 = rep8.skipped.find((x) => x.slug === AUTUMN)
  check('⑧ 다음 회차 — 전송불명이라 대상에서 비켜 둔다 (DELIVERY_UNCERTAIN_HOLD) · runner 0 · 재전송 0',
    !byslug(rep8, AUTUMN) && s8?.reason === 'DELIVERY_UNCERTAIN_HOLD' && f8.calls.runner.length === 0, `${JSON.stringify(s8)} · runner ${f8.calls.runner.length}`)
  const again = await WEBUI.fetchOne(AUTUMN, { inputRepair: { type: 'BRIEF_ECHO' }, draftOut: out, quarantinePath: L8, draftsDir: D, exit: () => {},
    probeFn: async () => { probes += 1; return { status: SESS.STATUS.OK } }, browserDeps: { ensureTab: async () => ({ ok: true }), connect: async () => { throw new Error('연결하면 안 된다') } } })
  check('⑧ 실제 전송 경계도 막는다 — held · probe 추가 0', again.result.status === 'held' && probes === 1, `${again.result.status} · probe ${probes}`)
  // 구조화 결과 — runner 가 결과 행을 못 남기면 전송불명
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  const L9 = seedLedger('d9')
  const r9 = byslug(await run([item(COLD)], L9, fakeDeps({ ledger: L9, rowFor: () => null })), COLD)
  check('⑧ 결과 행이 없다 → DELIVERY_UNCERTAIN (sent 모름 · 실패로 단정하지 않는다)', r9?.outcome === 'DELIVERY_UNCERTAIN' && r9.sent === null)
  const r10 = byslug(await run([item(COLD)], seedLedger('d10'), fakeDeps({ ledger: L9, rowFor: () => ({ status: 'failed', sent: true, reason: 'response_timeout' }) })), COLD)
  check('⑧ 보낸 뒤 응답 시간 초과 → DELIVERY_UNCERTAIN', r10?.outcome === 'DELIVERY_UNCERTAIN')
}

// ── ⑨ HOLD 6건 ─────────────────────────────────────────────
console.log('\n⑨ HOLD 6건 — runner 0 · 전송 0 · attempts 불변 · 장부 쓰기 0')
{
  for (const s of HOLD_SLUGS) writeSlug(s, { brief: GRAY_BRIEF })
  const LH = seedLedger('h', Object.fromEntries(HOLD_SLUGS.map((s) => [s, holdRow()])))
  const before = fs.readFileSync(LH)
  const f = fakeDeps({ ledger: LH })
  const rep = await run(HOLD_SLUGS.map(item).filter(Boolean), LH, f)
  check('⑨ HOLD 6건 → 대상 0 · brief 생성 0 · runner 0', rep.results.length === 0 && f.calls.generateBrief.length === 0 && f.calls.runner.length === 0, JSON.stringify(rep.results.map((r) => r.slug)))
  check('⑨ 장부 바이트 불변 (attempts 불변)', fs.readFileSync(LH).equals(before))
  check('⑨ HOLD brief 는 손대지 않는다 (지문 불변 → HOLD 유지)', HOLD_SLUGS.every((s) => read(p(s, 'brief.md')) === GRAY_BRIEF))
}

// ── ⑪ ⑫ 실패 격리 · 회차 상한 ──────────────────────────────
console.log('\n⑪ ⑫ 한 후보 실패 뒤 계속 · 회차 최대 3건')
{
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  writeSlug(AUTUMN, { brief: GOOD_BRIEF, draft: AUTUMN_ECHO })
  const LF = seedLedger('f')
  const f = fakeDeps({ ledger: LF, brief: () => { throw new Error('시험: Claude 가 죽었다') } })
  const rep = await run([item(GRAY), item(COLD), item(AUTUMN)], LF, f)
  check('⑪ gray 예외 → FAILED · 원본 불변 · cold · autumn 은 계속 APPLIED',
    byslug(rep, GRAY)?.outcome === 'FAILED' && read(p(GRAY, 'brief.md')) === GRAY_BRIEF && byslug(rep, COLD)?.outcome === 'APPLIED' && byslug(rep, AUTUMN)?.outcome === 'APPLIED',
    rep.results.map((r) => `${r.slug}:${r.outcome}`).join(' '))
  // 상한 — 대상 5건
  const extra = QUEUE.filter((q) => ![GRAY, COLD, AUTUMN, ...HOLD_SLUGS].includes(q.slug) && fs.existsSync(path.join(REPO, 'drafts', 'magazine', q.slug)) === false).slice(0, 2)
  for (const q of extra) writeSlug(q.slug, { brief: GRAY_BRIEF })
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  writeSlug(AUTUMN, { brief: GOOD_BRIEF, draft: AUTUMN_ECHO })
  const LM = seedLedger('m')
  const fm = fakeDeps({ ledger: LM, brief: () => ({ ok: false, why: '시험' }) })
  const repM = await run([item(GRAY), item(COLD), item(AUTUMN), ...extra], LM, fm)
  check('⑫ 대상 5건 → 이번 회차 3건만 · 나머지 RUN_LIMIT', extra.length === 2 && repM.results.length === 3 && repM.skipped.filter((s) => s.reason === 'RUN_LIMIT').length === 2,
    `${repM.results.length} · ${repM.skipped.map((s) => s.reason).join(',')}`)
  check('⑫ 같은 대상은 한 번만 (무한 반복 0)', new Set(repM.results.map((r) => r.slug)).size === repM.results.length)
}

// ── producer 흐름 — 잠금·미해결 뒤 · 회수 전 · 실패해도 회수 계속 ──
console.log('\n흐름 — producer 안에서 잠금·미해결 검사 뒤 · 원고 회수 전 · 실패는 회차를 막지 않는다')
{
  const order = []
  const flow = (repairStatus) => PF.runProducerFlow({ dryRun: false, deps: {
    log: () => {}, checkLock: () => { order.push('lock'); return { ok: true } }, checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
    checkOutstanding: () => { order.push('outstanding'); return { ok: true, message: '0건' } },
    runPlan: () => { order.push('plan'); return { status: 0 } }, readSupply: () => ({ selected: 0, reusable: 3 }),
    runBrief: () => { order.push('brief'); return { status: 0 } },
    runRepair: () => { order.push('repair'); return { status: repairStatus } },
    runFetch: () => { order.push('fetch'); return { status: 0 } },
    notify: async () => ({ ok: true }) } })
  const ok = await flow(0)
  check('흐름 — 잠금 → 미해결 → 선정 → 수리 → 회수 순서', order.join(',') === 'lock,outstanding,plan,repair,fetch', order.join(','))
  order.length = 0
  const bad = await flow(1)
  check('흐름 — 수리 실패(종료 1)여도 회수는 돌고 회차 판정은 같다', order.includes('fetch') && bad.verdict === ok.verdict && bad.code === ok.code, `${order.join(',')} · ${bad.verdict}`)
  const holdOrder = []
  await PF.runProducerFlow({ dryRun: false, deps: { log: () => {}, checkLock: () => ({ ok: true }), checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
    checkOutstanding: () => ({ ok: false, code: 'OUTSTANDING', message: '미해결', severity: 'HOLD' }),
    runPlan: () => { holdOrder.push('plan'); return { status: 0 } }, runRepair: () => { holdOrder.push('repair'); return { status: 0 } },
    runFetch: () => { holdOrder.push('fetch'); return { status: 0 } }, runBrief: () => ({ status: 0 }), notify: async () => ({ ok: true }) } })
  check('흐름 — 미해결 작업이 있으면 수리도 돌지 않는다', holdOrder.length === 0, holdOrder.join(','))
}

// ── 불변 — 일반 요청 · QA 재생성 지문 ─────────────────────────
console.log('\n불변 — 일반 원고 요청 · QA 재생성 프롬프트와 지문은 그대로')
{
  const h = (t) => sha(t).slice(0, 16)
  check('불변 — legacyManuscriptPromptText 바이트 불변', h(DG.legacyManuscriptPromptText(null)) === '5bb6e6ccb4bb9d3f', h(DG.legacyManuscriptPromptText(null)))
  const pk = RG.buildFailurePacket({ slug: 'x', profile: 'STANDARD', failures: [{ code: 'QA_FAIL', label: 'magazine QA FAIL', sentence: 's' }], attempt: 1, attemptId: 'a' })
  check('불변 — QA 재생성 지시문 바이트 불변', h(pk.instruction) === 'aeea1a85dce887b0', h(pk.instruction))
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  const normal = Q.deliveryFingerprintOf(DG.plannedMessageFor(COLD, D))
  const repair = DG.inputRepairGate({ slug: COLD, draftsDir: D, quarantinePath: seedLedger('fp') }).messageFingerprint
  check('불변 — 수리 지문은 일반 요청 지문과 다르다', normal && repair && normal !== repair)
}

check('운영 장부 기본 경로는 끝까지 격리 HOME 아래', path.resolve(Q.QUARANTINE_PATH).startsWith(T + path.sep))
check('실제 CDP 포트 요청 0 (운영 Chrome 에 닿지 않았다)', realCdpAttempts.length === 0, realCdpAttempts.join(' · '))
void spawn
finish()
process.exitCode = fail ? 1 : 0
