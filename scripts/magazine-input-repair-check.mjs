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
const PX = await import('./lib/magazine-producer-exit.mjs')
const HO = await import('./lib/magazine-handoff.mjs')
const PN = await import('./magazine-producer-notify.mjs')

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
const run = (q, ledger, f, max) => IR.runInputRepair({ draftsDir: D, queue: q, ledger: Q.readQuarantine(ledger), quarantinePath: ledger, deps: f.deps, tmpDir: path.join(T, 'tmp'), ...(max ? { max } : {}) })
const LIB = pathToFileURL(path.join(HERE, 'lib', 'magazine-input-repair.mjs')).href
/** 실제 자식 프로세스가 commitFiles 도중 SIGKILL 된다 — 진짜 journal 을 남긴다 */
function killAt({ draftsDir, slug, kind, files, phase }) {
  const child = path.join(T, `kill-${slug}-${phase}-${Math.random().toString(16).slice(2, 8)}.mjs`)
  fs.writeFileSync(child, `const IR = await import(${JSON.stringify(LIB)})
IR.commitFiles({ draftsDir: ${JSON.stringify(draftsDir)}, slug: ${JSON.stringify(slug)}, kind: ${JSON.stringify(kind)}, files: ${JSON.stringify(files)},
  phaseHook: (ph) => { if (ph === ${JSON.stringify(phase)}) process.kill(process.pid, 'SIGKILL') } })
`)
  return spawnSync(process.execPath, [child], { encoding: 'utf8', env: { ...process.env } })
}
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
  // 🔴 같은 지문은 장부에 영구 예약된다 — 다른 시나리오는 새 장부로 본다
  const L2 = seedLedger('b2')
  const f2 = fakeDeps({ ledger: L2, brief: () => ({ ok: true, briefText: GF_BAD_PAIR.brief, reviewText: GF_BAD_PAIR.review, calls: 1 }) })
  const r2 = byslug(await run([item(GRAY)], L2, f2), GRAY)
  check('② 후보가 형식 계약 위반(실제 GF 위반 쌍) → REJECTED · 두 파일 바이트 불변',
    r2?.outcome === 'REJECTED' && sha(read(p(GRAY, 'brief.md'))) === before[0] && sha(read(p(GRAY, 'review.ts'))) === before[1], `${r2?.outcome} · ${r2?.candidateViolations?.join(' / ')}`)
  const L2b = seedLedger('b2b')
  const f3 = fakeDeps({ ledger: L2b, brief: () => ({ ok: false, why: '시험: 생성 실패', calls: 2 }) })
  const r3 = byslug(await run([item(GRAY)], L2b, f3), GRAY)
  check('② 생성 실패 → FAILED · 바이트 불변', r3?.outcome === 'FAILED' && sha(read(p(GRAY, 'brief.md'))) === before[0])
}

// ── ③ ⑬ 쌍 교체 중 급사 → 다음 실행이 원복 ─────────────────
console.log('\n③ ⑬ 쌍 교체 중 SIGKILL · 쓰기 실패 → 다음 실행이 원복 · 잔여 0')
{
  for (const phase of ['prepared', 'committing-1']) {
    const slug = `kill-${phase}`
    const dir = path.join(T, slug)
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'brief.md'), 'OLD BRIEF\n')
    fs.writeFileSync(path.join(dir, 'review.ts'), 'OLD REVIEW\n')
    const k = killAt({ draftsDir: T, slug, kind: 'BRIEF', files: { brief: 'NEW BRIEF\n', review: 'NEW REVIEW\n' }, phase })
    const mid = [read(path.join(dir, 'brief.md')), read(path.join(dir, 'review.ts'))]
    check(`③ ${phase} 에서 실제 SIGKILL 됐다 (죽은 시험 아님)`, k.signal === 'SIGKILL' && fs.existsSync(path.join(dir, IR.JOURNAL_FILE)), `${k.signal} · ${mid.join('|')} · ${k.stderr.slice(0, 200)}`)
    const rec = IR.recoverJournal({ draftsDir: T, slug })
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
    IR.commitFiles({ draftsDir: T, slug: 'write-fail', kind: 'BRIEF', files: { brief: 'NEW\n', review: 'NEW\n' },
      phaseHook: (ph) => { if (ph === 'committing-1') throw new Error('시험: 두 번째 파일 쓰기 실패') } })
  } catch { threw = true }
  const rec = IR.recoverJournal({ draftsDir: T, slug: 'write-fail' })
  check('③ 두 번째 파일 쓰기 실패 → 다음 실행이 원복 (brief 도 원본)', threw && rec.recovered && read(path.join(dir, 'brief.md')) === 'OLD BRIEF\n' && fs.readdirSync(dir).length === 2)
  // runInputRepair 가 시작할 때 남은 journal 을 먼저 처리한다 — 실제 급사가 남긴 journal
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  killAt({ draftsDir: D, slug: GRAY, kind: 'BRIEF', files: { brief: 'HALF-WRITTEN\n', review: 'HALF REVIEW\n' }, phase: 'committing-1' })
  const L3 = seedLedger('b3')
  const rep = await run([item(GRAY)], L3, fakeDeps({ ledger: L3, brief: () => ({ ok: false, why: 'x' }) }))
  check('⑬ 회차 시작 시 남은 journal 을 원복하고 나서 수리한다', rep.recovered.some((x) => x.slug === GRAY && x.recovered) && read(p(GRAY, 'brief.md')) === GRAY_BRIEF && !fs.existsSync(path.join(D, GRAY, IR.JOURNAL_FILE)))
}

// ── P0 위조·손상 journal · 급사 뒤 다른 writer ─────────────────
console.log('\nP0 journal 신원·충돌 — 위조 journal 은 아무것도 쓰거나 지우지 않는다')
{
  const FD = path.join(T, 'forge', 'drafts')
  const OUT = path.join(T, 'forge', 'outside')
  fs.mkdirSync(FD, { recursive: true })
  fs.mkdirSync(OUT, { recursive: true })
  /** 폴더 아래 모든 파일·symlink 의 바이트 지도 (symlink 는 링크 자체) */
  const snap = (root) => {
    const m = {}
    const walk = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); const st = fs.lstatSync(f)
      if (st.isSymbolicLink()) m[f] = `link:${fs.readlinkSync(f)}`; else if (st.isDirectory()) walk(f); else m[f] = sha(fs.readFileSync(f)) } }
    walk(root)
    return JSON.stringify(m)
  }
  const forgeRoot = path.join(T, 'forge')
  let n = 0
  /** 실제 급사가 남긴 BRIEF journal 을 만들고, 그 JSON 을 고친다 */
  const forged = (tamper, { phase = 'committing-1' } = {}) => {
    const slug = `forge-${++n}`
    const dir = path.join(FD, slug)
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'brief.md'), 'OLD BRIEF\n')
    fs.writeFileSync(path.join(dir, 'review.ts'), 'OLD REVIEW\n')
    fs.writeFileSync(path.join(OUT, `victim-${slug}.md`), `OUTSIDE ${slug}\n`)
    const k = killAt({ draftsDir: FD, slug, kind: 'BRIEF', files: { brief: 'NEW BRIEF\n', review: 'NEW REVIEW\n' }, phase })
    const jp = path.join(dir, IR.JOURNAL_FILE)
    const j = JSON.parse(fs.readFileSync(jp, 'utf8'))
    const t = tamper(j, { slug, dir, victim: path.join(OUT, `victim-${slug}.md`) })
    if (t !== undefined) fs.writeFileSync(jp, typeof t === 'string' ? t : JSON.stringify(t))
    return { slug, dir, jp, killed: k.signal === 'SIGKILL' }
  }
  const victimFile = ({ victim }) => victim
  const CASES = [
    ['외부 경로', (j, c) => { j.files[0].path = victimFile(c); return j }],
    ['상대 경로', (j) => { j.files[0].path = 'brief.md'; return j }],
    ['중복', (j) => { j.files[1] = { ...j.files[0] }; return j }],
    ['누락', (j) => { j.files = [j.files[0]]; return j }],
    ['추가', (j, c) => { j.files.push({ ...j.files[0], role: 'draft', path: path.join(c.dir, 'draft.md') }); return j }],
    ['잘못된 schema', (j) => { j.schema = 'input-repair-journal/1'; return j }],
    ['잘못된 kind', (j) => { j.kind = 'HERO'; return j }],
    ['DRAFT kind 에 brief·review', (j) => { j.kind = 'DRAFT'; return j }],
    ['잘못된 phase', (j) => { j.phase = 'committing-9'; return j }],
    ['잘못된 역할', (j) => { j.files[0].role = 'review'; j.files[1].role = 'brief'; return j }],
    ['다른 slug', (j) => { j.slug = 'gray-hair-leave-as-is'; return j }],
    ['backup 외부 경로', (j, c) => { j.files[0].backup = victimFile(c); return j }],
    ['staged 외부 경로', (j, c) => { j.files[1].staged = victimFile(c); return j }],
    ['before 원문과 beforeSha 불일치', (j) => { j.files[0].before = 'FORGED BEFORE\n'; return j }],
    ['JSON 아님', () => '{ not json'],
  ]
  for (const [name, tamper] of CASES) {
    const f = forged(tamper)
    const before = snap(forgeRoot)
    let rec
    try { rec = IR.recoverJournal({ draftsDir: FD, slug: f.slug }) } catch (e) { rec = { threw: String(e?.message ?? e) } }
    const after = snap(forgeRoot)
    check(`P0 ${name} → RECOVERY_IDENTITY · 대상·외부·backup·staged·journal 바이트 불변`,
      f.killed && rec.recovered === false && rec.code === 'RECOVERY_IDENTITY' && before === after && fs.existsSync(f.jp), `${JSON.stringify(rec)} · 변화 ${before !== after}`)
  }
  // symlink 탈출 — slug 폴더 자체가 바깥을 가리킨다
  {
    const realOut = path.join(OUT, 'escape-dir')
    fs.mkdirSync(realOut)
    fs.writeFileSync(path.join(realOut, 'brief.md'), 'OUTSIDE BRIEF\n')
    fs.writeFileSync(path.join(realOut, 'review.ts'), 'OUTSIDE REVIEW\n')
    fs.symlinkSync(realOut, path.join(FD, 'escape-link'))
    const j = { schema: IR.JOURNAL_SCHEMA, txId: 'a'.repeat(16), kind: 'BRIEF', slug: 'escape-link', phase: 'committing-1',
      files: [['brief', 'brief.md'], ['review', 'review.ts']].map(([role, nm]) => { const fp = path.join(FD, 'escape-link', nm)
        return { role, path: fp, before: 'X\n', beforeSha: sha('X\n'), afterSha: sha(`OUTSIDE ${nm === 'brief.md' ? 'BRIEF' : 'REVIEW'}\n`), backup: `${fp}.input-repair-backup-${'a'.repeat(16)}`, staged: `${fp}.input-repair-staged-${'a'.repeat(16)}` } }) }
    fs.writeFileSync(path.join(realOut, IR.JOURNAL_FILE), JSON.stringify(j))
    const before = snap(forgeRoot)
    const rec = IR.recoverJournal({ draftsDir: FD, slug: 'escape-link' })
    check('P0 symlink 탈출(slug 폴더가 바깥) → RECOVERY_IDENTITY · 바깥 파일 불변', rec.code === 'RECOVERY_IDENTITY' && snap(forgeRoot) === before && read(path.join(realOut, 'brief.md')) === 'OUTSIDE BRIEF\n', JSON.stringify(rec))
    // 대상 파일이 바깥을 가리키는 symlink
    const f = forged((jj) => jj)
    fs.rmSync(path.join(f.dir, 'review.ts'))
    fs.symlinkSync(path.join(OUT, `victim-${f.slug}.md`), path.join(f.dir, 'review.ts'))
    const b2 = snap(forgeRoot)
    const r2 = IR.recoverJournal({ draftsDir: FD, slug: f.slug })
    check('P0 대상 파일이 바깥 symlink → RECOVERY_IDENTITY · 바깥 파일 불변', r2.code === 'RECOVERY_IDENTITY' && snap(forgeRoot) === b2, JSON.stringify(r2))
  }
  // 급사 뒤 다른 writer 가 대상 파일을 바꿨다
  for (const [phase, victimRole] of [['committing-1', 'review'], ['committing-1', 'brief'], ['committed', 'brief'], ['prepared', 'brief']]) {
    const f = forged(() => undefined, { phase })
    const target = path.join(f.dir, victimRole === 'brief' ? 'brief.md' : 'review.ts')
    fs.writeFileSync(target, 'OTHER WRITER\n')
    const before = snap(forgeRoot)
    const rec = IR.recoverJournal({ draftsDir: FD, slug: f.slug })
    check(`P0 ${phase} 급사 뒤 다른 writer 가 ${victimRole} 변경 → RECOVERY_CONFLICT · 아무것도 덮지 않는다 · journal 유지`,
      f.killed && rec.code === 'RECOVERY_CONFLICT' && snap(forgeRoot) === before && read(target) === 'OTHER WRITER\n' && fs.existsSync(f.jp), JSON.stringify(rec))
  }
  // 정상 복구는 계속 통과한다 — initializing · prepared · committing-1 · committing-2 · committed
  for (const phase of ['initializing', 'prepared', 'committing-1', 'committing-2', 'committed']) {
    const f = forged(() => undefined, { phase })
    const rec = IR.recoverJournal({ draftsDir: FD, slug: f.slug })
    const want = phase === 'committed' ? ['NEW BRIEF\n', 'NEW REVIEW\n'] : ['OLD BRIEF\n', 'OLD REVIEW\n']
    check(`P0 정상 ${phase} 급사 → ${phase === 'committed' ? '새 쌍 유지·정리' : '원본 쌍으로 복구'} · 잔여 0`,
      f.killed && rec.recovered === true && read(path.join(f.dir, 'brief.md')) === want[0] && read(path.join(f.dir, 'review.ts')) === want[1] && fs.readdirSync(f.dir).sort().join(',') === 'brief.md,review.ts',
      `${JSON.stringify(rec)} · ${fs.readdirSync(f.dir).join(',')}`)
  }
  // 교체 함수도 정해진 역할 밖은 받지 않는다
  let refused = 0
  for (const files of [{ brief: 'x' }, { brief: 'x', review: 'y', draft: 'z' }, { draft: 'x', review: 'y' }]) {
    try { IR.commitFiles({ draftsDir: FD, slug: 'forge-1', kind: 'BRIEF', files }) } catch { refused++ }
  }
  try { IR.commitFiles({ draftsDir: FD, slug: '../outside', kind: 'DRAFT', files: { draft: 'x' } }) } catch { refused++ }
  check('P0 commitFiles — BRIEF 는 brief·review 정확히 2개 · 바깥 slug 거부', refused === 4, `거부 ${refused}/4`)
  // runInputRepair — 위조 journal 이 있는 slug 는 건드리지 않고 다른 후보는 계속한다
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  const victim = path.join(OUT, 'run-victim.md')
  fs.writeFileSync(victim, 'RUN VICTIM\n')
  const fp = p(GRAY, 'brief.md')
  fs.writeFileSync(path.join(D, GRAY, IR.JOURNAL_FILE), JSON.stringify({ schema: IR.JOURNAL_SCHEMA, txId: 'b'.repeat(16), kind: 'DRAFT', slug: GRAY, phase: 'prepared',
    files: [{ role: 'draft', path: victim, before: null, beforeSha: 'ABSENT', afterSha: sha('RUN VICTIM\n'), backup: `${fp}.input-repair-backup-${'b'.repeat(16)}`, staged: `${fp}.input-repair-staged-${'b'.repeat(16)}` }] }))
  const LJ = seedLedger('journal-run')
  const fj = fakeDeps({ ledger: LJ })
  const repJ = await run([item(GRAY), item(COLD)], LJ, fj)
  check('P0 회차 — 위조 journal(외부 파일 삭제 시도) → 외부 파일 보존 · RECOVERY_IDENTITY 기록 · 그 slug 는 RECOVERY_BLOCKED · provider 0',
    read(victim) === 'RUN VICTIM\n' && repJ.recovered.some((r) => r.slug === GRAY && r.code === 'RECOVERY_IDENTITY') && repJ.skipped.some((x) => x.slug === GRAY && x.reason === 'RECOVERY_BLOCKED') &&
    !fj.calls.generateBrief.includes(GRAY) && read(p(GRAY, 'brief.md')) === GRAY_BRIEF && fs.existsSync(path.join(D, GRAY, IR.JOURNAL_FILE)),
    `${JSON.stringify(repJ.recovered)} · ${JSON.stringify(repJ.skipped)} · ${read(victim)}`)
  check('P0 회차 — 다른 후보(cold)는 계속 APPLIED', byslug(repJ, COLD)?.outcome === 'APPLIED')
  check('P0 회차 — producer 요약에 RECOVERY_IDENTITY 미해결로 잡힌다', PX.summarizeRepairStage({ status: 0, report: repJ }).failures.some((f) => f.slug === GRAY && f.outcome === 'RECOVERY_IDENTITY'))
  fs.rmSync(path.join(D, GRAY, IR.JOURNAL_FILE))
}

// ── P1 brief 수리 실행권 — 같은 지문은 회차를 넘어 provider 0 ───────
console.log('\nP1 brief 수리 지문 — 운영 장부에 호출 전 영구 예약 · 다음 회차 provider 0')
{
  const entryOf = (L) => Q.readQuarantine(L).store[GRAY]
  // REJECTED 다음 회차
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  const LB = seedLedger('brief-persist', { [GRAY]: { attempts: 1, regenCalls: 1, kind: 'CONTENT', lastAt: 5 } })
  const f1 = fakeDeps({ ledger: LB, brief: () => ({ ok: true, briefText: GF_BAD_PAIR.brief, reviewText: GF_BAD_PAIR.review, calls: 2 }) })
  const r1 = byslug(await run([item(GRAY)], LB, f1), GRAY)
  const e1 = entryOf(LB)
  check('P1 1회차 REJECTED — 실행권 기록(지문·REJECTED·providerCalls 2) · briefRepairCalls 2', r1?.outcome === 'REJECTED' && f1.calls.generateBrief.length === 1 &&
    e1.briefRepairs?.length === 1 && e1.briefRepairs[0].fingerprint === r1.repairFingerprint && e1.briefRepairs[0].outcome === 'REJECTED' && e1.briefRepairs[0].providerCalls === 2 && e1.briefRepairCalls === 2, JSON.stringify(e1))
  check('P1 호출 수는 CONTENT attempts · QA regenCalls 에 들어가지 않는다', e1.attempts === 1 && e1.regenCalls === 1 && e1.kind === 'CONTENT' && e1.lastAt === 5, JSON.stringify(e1))
  const ledgerBytes = fs.readFileSync(LB)
  const f2 = fakeDeps({ ledger: LB })
  const r2 = byslug(await run([item(GRAY)], LB, f2), GRAY)
  check('P1 다음 회차 같은 지문 → REPAIR_EXHAUSTED · provider 호출 0 · brief 불변 · 장부 바이트 불변',
    r2?.outcome === 'REPAIR_EXHAUSTED' && f2.calls.generateBrief.length === 0 && r2.providerCalls === 0 && read(p(GRAY, 'brief.md')) === GRAY_BRIEF && fs.readFileSync(LB).equals(ledgerBytes),
    `${r2?.outcome} · provider ${f2.calls.generateBrief.length} · ${r2?.reason}`)
  // 생성 실패(FAILED) 다음 회차
  const LF2 = seedLedger('brief-failed')
  await run([item(GRAY)], LF2, fakeDeps({ ledger: LF2, brief: () => ({ ok: false, why: '시험', calls: 2 }) }))
  const f3 = fakeDeps({ ledger: LF2 })
  const r3 = byslug(await run([item(GRAY)], LF2, f3), GRAY)
  check('P1 생성 실패 다음 회차 → REPAIR_EXHAUSTED · provider 0', r3?.outcome === 'REPAIR_EXHAUSTED' && f3.calls.generateBrief.length === 0 && entryOf(LF2).briefRepairs[0].outcome === 'FAILED')
  // provider 예외(호출 여부 불명) 다음 회차
  const LE = seedLedger('brief-throw')
  await run([item(GRAY)], LE, fakeDeps({ ledger: LE, brief: () => { throw new Error('시험: 호출 중 예외') } }))
  const fe = fakeDeps({ ledger: LE })
  check('P1 provider 예외(호출 수 모름) 다음 회차 → REPAIR_EXHAUSTED · provider 0', byslug(await run([item(GRAY)], LE, fe), GRAY)?.outcome === 'REPAIR_EXHAUSTED' && fe.calls.generateBrief.length === 0 && entryOf(LE).briefRepairs[0].providerCalls === null)
  // 급사 — provider 호출 중 SIGKILL → RESERVED 가 남는다
  const LK = seedLedger('brief-kill')
  const QLIB = pathToFileURL(path.join(HERE, 'lib', 'magazine-quarantine.mjs')).href
  const child = path.join(T, 'brief-kill.mjs')
  fs.writeFileSync(child, `const IR = await import(${JSON.stringify(LIB)})
const Q = await import(${JSON.stringify(QLIB)})
await IR.runInputRepair({ draftsDir: ${JSON.stringify(D)}, queue: [${JSON.stringify(item(GRAY))}], ledger: Q.readQuarantine(${JSON.stringify(LK)}), quarantinePath: ${JSON.stringify(LK)}, tmpDir: ${JSON.stringify(path.join(T, 'tmp'))},
  deps: { log: () => {}, parseReview: () => ({}), generateBrief: async () => { process.kill(process.pid, 'SIGKILL') } } })
`)
  const kk = spawnSync(process.execPath, [child], { encoding: 'utf8', env: { ...process.env } })
  const ek = entryOf(LK)
  check('P1 provider 호출 중 SIGKILL → 장부에 RESERVED 가 남는다 (호출 여부 불명)', kk.signal === 'SIGKILL' && ek?.briefRepairs?.[0]?.outcome === 'RESERVED', `${kk.signal} · ${JSON.stringify(ek)} · ${kk.stderr.slice(0, 200)}`)
  const fk = fakeDeps({ ledger: LK })
  const rk = byslug(await run([item(GRAY)], LK, fk), GRAY)
  check('P1 급사 다음 회차 → 보수적으로 재호출 0 · REPAIR_EXHAUSTED (이전 RESERVED)', rk?.outcome === 'REPAIR_EXHAUSTED' && rk.priorOutcome === 'RESERVED' && fk.calls.generateBrief.length === 0, `${rk?.outcome} · ${rk?.priorOutcome}`)
  // 지문이 달라질 때만 새 실행권 — 원본 brief 변경 · 큐 행 변경
  writeSlug(GRAY, { brief: `${GRAY_BRIEF}\n<!-- 사람이 고쳤다 -->\n` })
  const fb = fakeDeps({ ledger: LB })
  const rb = byslug(await run([item(GRAY)], LB, fb), GRAY)
  check('P1 원본 brief 가 바뀌면 지문이 달라져 새 수리 1회 (provider 1)', rb?.outcome === 'APPLIED' && fb.calls.generateBrief.length === 1 && rb.repairFingerprint !== r1.repairFingerprint, `${rb?.outcome} · ${fb.calls.generateBrief.length}`)
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  const fq = fakeDeps({ ledger: LB })
  const rq = byslug(await run([{ ...item(GRAY), title: `${item(GRAY).title} ` }], LB, fq), GRAY)
  check('P1 큐 행이 바뀌면 새 수리 1회 · 같은 brief·같은 큐는 여전히 0', rq?.outcome === 'APPLIED' && fq.calls.generateBrief.length === 1, `${rq?.outcome}`)
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  const fz = fakeDeps({ ledger: LB })
  check('P1 원래 지문으로 돌아오면 다시 0', byslug(await run([item(GRAY)], LB, fz), GRAY)?.outcome === 'REPAIR_EXHAUSTED' && fz.calls.generateBrief.length === 0)
  // 장부를 못 쓰면 예약 실패 → provider 0
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  const LX = path.join(T, 'brief-bad-ledger.json')
  fs.writeFileSync(LX, '{ broken')
  const fx2 = fakeDeps({ ledger: LX })
  const rx = await IR.runInputRepair({ draftsDir: D, queue: [item(GRAY)], ledger: { ok: true, store: {} }, quarantinePath: LX, deps: fx2.deps, tmpDir: path.join(T, 'tmp') })
  check('P1 장부 예약 실패(손상) → FAILED · provider 0 (fail-closed)', byslug(rx, GRAY)?.outcome === 'FAILED' && fx2.calls.generateBrief.length === 0, JSON.stringify(byslug(rx, GRAY)))
  // HOLD 행에 직접 예약을 시도해도 바이트 불변
  const LHh = seedLedger('brief-hold', { [GRAY]: holdRow() })
  const hb = fs.readFileSync(LHh)
  const rh = Q.reserveBriefRepair({ slug: GRAY, fingerprint: 'sha256:x', path: LHh })
  check('P1 전송불명 HOLD 행 예약 → DELIVERY_UNCERTAIN_HOLD · 장부 바이트 불변', !rh.ok && rh.code === 'DELIVERY_UNCERTAIN_HOLD' && fs.readFileSync(LHh).equals(hb))
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

// ── producer 흐름 — 잠금·미해결 뒤 · 회수 전 · 미해결은 PARTIAL ──
console.log('\n흐름 — producer 안에서 잠금·미해결 검사 뒤 · 원고 회수 전 · 수리 미해결은 성공과 다른 판정')
const RESULT_FILE = path.join(D, '_runs', '2026-10-11', 'input-repair-001000-1-abcd1234.json')
const repReport = (results, extra = {}) => ({ ok: true, results, skipped: [], recovered: [], resultFile: RESULT_FILE, ...extra })
{
  const order = []
  const notes = []
  const flow = (repair) => PF.runProducerFlow({ dryRun: false, deps: {
    log: () => {}, checkLock: () => { order.push('lock'); return { ok: true } }, checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
    checkOutstanding: () => { order.push('outstanding'); return { ok: true, message: '0건' } },
    runPlan: () => { order.push('plan'); return { status: 0 } }, readSupply: () => ({ selected: 0, reusable: 3 }),
    runBrief: () => { order.push('brief'); return { status: 0 } },
    runRepair: () => { order.push('repair'); return repair },
    runFetch: () => { order.push('fetch'); return { status: 0 } },
    notify: async (ctx) => { notes.push(ctx); return { ok: true } } } })
  const ok = await flow({ status: 0, report: repReport([{ slug: COLD, type: IR.REPAIR.DRAFT_ECHO, outcome: 'APPLIED' }]) })
  check('흐름 — 잠금 → 미해결 → 선정 → 수리 → 회수 순서', order.join(',') === 'lock,outstanding,plan,repair,fetch', order.join(','))
  check('흐름 — 수리가 전부 적용되면 성공 회차 (OK · 0)', ok.verdict === 'OK' && ok.code === 0, `${ok.verdict} · ${ok.code} · ${ok.reason}`)
  // 🔴 앞판 시험("수리 실패여도 판정이 같다")을 뒤집는다 — 회수는 돌되 판정은 성공과 달라야 한다
  const cases = [
    ['REJECTED', { status: 0, report: repReport([{ slug: GRAY, type: IR.REPAIR.BRIEF, outcome: 'REJECTED', reason: '계약 위반' }]) }, GRAY],
    ['DELIVERY_UNCERTAIN', { status: 0, report: repReport([{ slug: AUTUMN, type: IR.REPAIR.DRAFT_ECHO, outcome: 'DELIVERY_UNCERTAIN' }]) }, AUTUMN],
    ['REPAIR_EXHAUSTED', { status: 0, report: repReport([{ slug: GRAY, type: IR.REPAIR.BRIEF, outcome: 'REPAIR_EXHAUSTED' }]) }, GRAY],
    ['FAILED', { status: 0, report: repReport([{ slug: COLD, type: IR.REPAIR.DRAFT_ECHO, outcome: 'FAILED' }]) }, COLD],
    ['QUARANTINE_UNREADABLE', { status: 1, report: { ok: false, code: 'QUARANTINE_UNREADABLE', why: '장부 손상', results: [], skipped: [], recovered: [], resultFile: RESULT_FILE } }, null],
    ['RECOVERY_IDENTITY', { status: 0, report: repReport([], { recovered: [{ slug: GRAY, recovered: false, code: 'RECOVERY_IDENTITY', why: '외부 경로' }] }) }, GRAY],
    ['REPAIR_RESULT_MISSING', { status: 1 }, null],
    ['REPAIR_STAGE_FAILED', { spawnError: 'ENOENT', status: null }, null],
  ]
  for (const [code, repair, slug] of cases) {
    order.length = 0
    notes.length = 0
    const bad = await flow(repair)
    const note = notes[0]
    check(`흐름 — 수리 ${code} → 회수는 돈다 · 판정은 PARTIAL(3) 로 성공과 다르다 · 이유에 slug·코드`,
      order.includes('fetch') && bad.verdict === 'PARTIAL' && bad.code === PX.PARTIAL_EXIT && bad.code !== ok.code && bad.reason.includes(code) && (!slug || bad.reason.includes(slug)),
      `${order.join(',')} · ${bad.verdict} · ${bad.code} · ${bad.reason}`)
    check(`흐름 — 수리 ${code} → 알림 정확히 1회 · 구조화된 수리 결과가 실린다`,
      notes.length === 1 && note.repair?.failures?.some((f) => f.outcome === code && (!slug || f.slug === slug)), JSON.stringify(note?.repair))
  }
  // 시스템 실패가 겹치면 SYSTEM 이 먼저 — 다만 수리 미해결도 이유에 남는다
  const both = PX.judgeProducerRun({ plan: PX.stage('plan', { status: 0 }), brief: PX.stage('brief', { status: 0 }), fetch: PX.stage('fetch', { status: 1 }),
    repair: PX.summarizeRepairStage({ status: 0, report: repReport([{ slug: GRAY, outcome: 'REJECTED' }]) }) })
  check('흐름 — 회수 전역 실패 + 수리 미해결 → SYSTEM(1) · 이유에 수리 미해결도 남는다', both.verdict === 'SYSTEM' && both.code === 1 && both.reason.includes(`${GRAY}(REJECTED)`), both.reason)
  // 알림 문구 — slug · 결과 코드 · 결과 파일 (notify 자식의 실제 judge)
  const sum = PX.summarizeRepairStage({ status: 0, report: repReport([{ slug: GRAY, type: IR.REPAIR.BRIEF, outcome: 'REPAIR_EXHAUSTED' }, { slug: AUTUMN, type: IR.REPAIR.DRAFT_ECHO, outcome: 'DELIVERY_UNCERTAIN' }]) })
  const alerts = PN.judge({ date: '2026-10-11', run: { status: 'COMPLETED', selected: [], inventoryDays: 30 }, runExists: true, repair: sum })
  const a = alerts.find((x) => /입력 수리/.test(x.title))
  check('알림 — notify 판정에 수리 미해결 알림 1건 · slug · 결과 코드 · 결과 파일 위치',
    alerts.length === 1 && a && `${a.reason} ${a.next}`.includes(GRAY) && a.reason.includes('REPAIR_EXHAUSTED') && a.reason.includes(AUTUMN) && a.reason.includes('DELIVERY_UNCERTAIN') && a.next.includes(RESULT_FILE),
    JSON.stringify(alerts))
  check('알림 — 미해결이 없으면 수리 알림 0 (정상 회차는 조용하다)', PN.judge({ date: '2026-10-11', run: { status: 'COMPLETED', selected: [], inventoryDays: 30 }, runExists: true, repair: PX.summarizeRepairStage({ status: 0, report: repReport([]) }) }).length === 0)
  // handoff — PARTIAL 과 수리 사실이 남고, 등록은 기존 정책대로 진행한다
  const hp = HO.writeHandoff({ date: '2026-10-11', verdict: 'PARTIAL', code: PX.PARTIAL_EXIT, ran: ['plan', 'repair', 'fetch'], repair: sum })
  const h = HO.readHandoff('2026-10-11')
  const hj = HO.judgeHandoff({ handoff: h, producerLockHeld: false, waitedMs: 0 })
  check('handoff — 격리 원고 폴더에 PARTIAL · 수리 slug·코드·결과 파일이 남는다', hp.startsWith(T + path.sep) && h.verdict === 'PARTIAL' && h.code === 3 && h.repair?.resultFile === RESULT_FILE &&
    h.repair.failures.some((f) => f.slug === GRAY && f.outcome === 'REPAIR_EXHAUSTED'), JSON.stringify(h))
  check('handoff — PARTIAL 이어도 auto-register 는 기존 정책대로 진행한다 (ready · SYSTEM 아님)', hj.ready === true && hj.code === 'HANDOFF_OK', JSON.stringify(hj))
  const holdOrder = []
  await PF.runProducerFlow({ dryRun: false, deps: { log: () => {}, checkLock: () => ({ ok: true }), checkTools: () => ({ ok: true }), checkGit: () => ({ ok: true }),
    checkOutstanding: () => ({ ok: false, code: 'OUTSTANDING', message: '미해결', severity: 'HOLD' }),
    runPlan: () => { holdOrder.push('plan'); return { status: 0 } }, runRepair: () => { holdOrder.push('repair'); return { status: 0 } },
    runFetch: () => { holdOrder.push('fetch'); return { status: 0 } }, runBrief: () => ({ status: 0 }), notify: async () => ({ ok: true }) } })
  check('흐름 — 미해결 작업이 있으면 수리도 돌지 않는다', holdOrder.length === 0, holdOrder.join(','))
}

// ── ENOTDIR — runtime 원고 폴더 모양 (topic-queue.ts 일반 파일) ─────────
console.log('\nENOTDIR — 원고 폴더의 일반 파일·숨김 파일·symlink 는 journal 후보가 아니다 · 대상 판정까지 실제로 간다')
{
  const OUTSIDE = path.join(T, 'enotdir-outside')
  fs.mkdirSync(OUTSIDE, { recursive: true })
  const extras = []
  const put = (rel, text) => { const f = path.join(D, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); extras.push(f) }
  // runtime 과 같은 모양: 큐 파일 · 숨김 파일 · _runs/_template 디렉터리(journal 없음) · 바깥을 가리키는 symlink 디렉터리
  put('topic-queue.ts', fs.readFileSync(path.join(REPO, 'drafts', 'magazine', 'topic-queue.ts'), 'utf8'))
  put('.DS_Store', 'binary-ish\n')
  put(path.join('_runs', '2026-10-10', 'run.json'), '{}\n')
  put(path.join('_template', 'review.ts'), 'export {}\n')
  fs.writeFileSync(path.join(OUTSIDE, 'brief.md'), 'OUTSIDE BRIEF\n')
  fs.writeFileSync(path.join(OUTSIDE, IR.JOURNAL_FILE), JSON.stringify({ schema: IR.JOURNAL_SCHEMA, txId: 'c'.repeat(16), kind: 'DRAFT', slug: 'linked-slug', phase: 'prepared',
    files: [{ role: 'draft', path: path.join(OUTSIDE, 'brief.md'), before: null, beforeSha: 'ABSENT', afterSha: sha('OUTSIDE BRIEF\n'), backup: 'x', staged: 'y' }] }))
  const link = path.join(D, 'linked-slug')
  fs.symlinkSync(OUTSIDE, link)
  extras.push(link)
  const outsideBefore = fs.readdirSync(OUTSIDE).sort().join(',') + sha(fs.readFileSync(path.join(OUTSIDE, 'brief.md')))
  // 정상 slug 의 유효 journal (실제 급사) · 위조 journal · 충돌 journal
  writeSlug(GRAY, { brief: GRAY_BRIEF })
  writeSlug(COLD, { brief: GOOD_BRIEF, draft: COLD_DRAFT })
  writeSlug(AUTUMN, { brief: GOOD_BRIEF, draft: AUTUMN_ECHO })
  const k1 = killAt({ draftsDir: D, slug: GRAY, kind: 'BRIEF', files: { brief: 'HALF\n', review: 'HALF\n' }, phase: 'committing-1' })
  const FORGED = 'enotdir-forged'
  writeSlug(FORGED, { brief: 'F\n' })
  fs.writeFileSync(path.join(D, FORGED, IR.JOURNAL_FILE), JSON.stringify({ schema: 'input-repair-journal/1', files: [] }))
  const CONFLICT = 'enotdir-conflict'
  writeSlug(CONFLICT, { brief: 'OLD\n', review: 'OLD R\n' })
  killAt({ draftsDir: D, slug: CONFLICT, kind: 'BRIEF', files: { brief: 'NEW\n', review: 'NEW R\n' }, phase: 'committing-1' })
  fs.writeFileSync(p(CONFLICT, 'review.ts'), 'OTHER WRITER\n')

  let rec
  let threw = null
  try { rec = IR.recoverAllJournals(D) } catch (e) { threw = e }
  const bySlug = Object.fromEntries((rec ?? []).map((r) => [r.slug, r]))
  check('ENOTDIR ① topic-queue.ts 일반 파일이 있어도 journal 스캔 예외 0', !threw, String(threw?.message ?? ''))
  check('ENOTDIR ② 일반 파일·숨김 파일·_runs·_template 는 후보가 아니다 (기록 0)', rec && !['topic-queue.ts', '.DS_Store', '_runs', '_template'].some((s) => bySlug[s]), JSON.stringify(Object.keys(bySlug)))
  check('ENOTDIR ③ symlink 디렉터리를 따라가지 않는다 — 기록 0 · 바깥 파일·journal 불변',
    rec && !bySlug['linked-slug'] && fs.readdirSync(OUTSIDE).sort().join(',') + sha(fs.readFileSync(path.join(OUTSIDE, 'brief.md'))) === outsideBefore, JSON.stringify(bySlug['linked-slug'] ?? null))
  check('ENOTDIR ④ 정상 slug 의 유효 journal(실제 SIGKILL)은 계속 원본으로 복구한다',
    k1.signal === 'SIGKILL' && bySlug[GRAY]?.recovered === true && read(p(GRAY, 'brief.md')) === GRAY_BRIEF && !fs.existsSync(path.join(D, GRAY, IR.JOURNAL_FILE)), JSON.stringify(bySlug[GRAY]))
  check('ENOTDIR ⑤ 손상·위조 journal 은 기존처럼 RECOVERY_IDENTITY · journal 유지', bySlug[FORGED]?.code === 'RECOVERY_IDENTITY' && fs.existsSync(path.join(D, FORGED, IR.JOURNAL_FILE)), JSON.stringify(bySlug[FORGED]))
  check('ENOTDIR ⑤ 다른 writer 충돌 journal 은 기존처럼 RECOVERY_CONFLICT · 덮지 않는다',
    bySlug[CONFLICT]?.code === 'RECOVERY_CONFLICT' && read(p(CONFLICT, 'review.ts')) === 'OTHER WRITER\n', JSON.stringify(bySlug[CONFLICT]))
  // readdir 와 lstat 사이에 디렉터리가 일반 파일로 바뀐 경합 — ENOTDIR 은 "journal 없음"
  let raced = null
  let racedOut = null
  try { racedOut = IR.recoverAllJournals(D, { list: () => [{ name: 'topic-queue.ts', isDirectory: () => true }] }) } catch (e) { raced = e }
  check('ENOTDIR ⑥ 순회 경계 경합(디렉터리였던 항목이 일반 파일) → 예외 0 · journal 없음', !raced && Array.isArray(racedOut) && racedOut.length === 0, String(raced?.message ?? JSON.stringify(racedOut)))
  // 회차 — journal 스캔 뒤 gray/cold/autumn 대상 판정까지 실제로 간다
  fs.rmSync(path.join(D, FORGED), { recursive: true, force: true })
  fs.rmSync(path.join(D, CONFLICT), { recursive: true, force: true })
  const LE = seedLedger('enotdir-run')
  const fe = fakeDeps({ ledger: LE, brief: () => ({ ok: false, why: '시험: 생성 안 함', calls: 1 }), rowFor: () => ({ status: 'failed', sent: false, reason: 'login_required' }) })
  let repE = null
  let thrownE = null
  try { repE = await run([item(GRAY), item(COLD), item(AUTUMN)], LE, fe) } catch (e) { thrownE = e }
  check('ENOTDIR ⑧ 회차가 예외 없이 gray(BRIEF)·cold·autumn(DRAFT_ECHO) 대상 판정과 수리 시도까지 간다',
    !thrownE && repE?.ok === true && [GRAY, COLD, AUTUMN].every((s) => byslug(repE, s)) && fe.calls.generateBrief.includes(GRAY) && fe.calls.runner.includes(COLD) && fe.calls.runner.includes(AUTUMN),
    thrownE ? String(thrownE.message) : JSON.stringify(repE?.results?.map((r) => `${r.slug}:${r.outcome}`)))
  for (const f of extras) fs.rmSync(f, { recursive: true, force: true })
}

// ── ENOTDIR 실제 CLI · producer wrapper — runtime 모양 임시 루트 ─────────
console.log('\nENOTDIR — runtime 모양 임시 루트에서 실제 input-repair CLI · producer wrapper (운영 HOME·runtime·Chrome·네트워크 0)')
{
  const M = path.join(T, 'mini')
  const R = path.join(M, 'repo')
  const sh = (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: path.join(M, 'home'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } })
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  for (const d of ['home', 'bin', 'tmp']) fs.mkdirSync(path.join(M, d), { recursive: true })
  for (const rel of ['scripts', 'drafts/magazine', 'src/content/magazine', '.gitignore', 'package.json']) {
    fs.mkdirSync(path.dirname(path.join(R, rel)), { recursive: true })
    fs.cpSync(path.join(REPO, rel), path.join(R, rel), { recursive: true, filter: (src) => !src.includes(`${path.sep}_runs${path.sep}`) })
  }
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(R, 'node_modules'))
  sh('git', ['init', '-q', '-b', 'main'], R)
  sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', 'add', '-A'], R)
  sh('git', ['-c', 'user.name=t', '-c', 'user.email=t@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'mini runtime'], R)
  sh('git', ['clone', '-q', '--bare', R, path.join(M, 'origin.git')], M)
  sh('git', ['remote', 'add', 'origin', path.join(M, 'origin.git')], R)
  sh('git', ['fetch', '-q', 'origin'], R)
  sh('git', ['branch', '-q', '--set-upstream-to', 'origin/main', 'main'], R)
  // runtime 처럼 미추적 원고 — gray(형식 계약 위반 brief) · cold·autumn(brief echo)
  const md = (slug, f, t) => { fs.mkdirSync(path.join(R, 'drafts', 'magazine', slug), { recursive: true }); fs.writeFileSync(path.join(R, 'drafts', 'magazine', slug, f), t) }
  md(GRAY, 'brief.md', GRAY_BRIEF); md(GRAY, 'review.ts', 'export const REVIEW = { old: true }\n')
  md(COLD, 'brief.md', GOOD_BRIEF); md(COLD, 'review.ts', 'export const REVIEW = { old: true }\n'); md(COLD, 'draft.md', COLD_DRAFT)
  md(AUTUMN, 'brief.md', GOOD_BRIEF); md(AUTUMN, 'review.ts', 'export const REVIEW = { old: true }\n'); md(AUTUMN, 'draft.md', AUTUMN_ECHO)
  check('mini ⓪ runtime 모양 — drafts/magazine/topic-queue.ts 가 일반 파일이다', fs.statSync(path.join(R, 'drafts', 'magazine', 'topic-queue.ts')).isFile())
  // 바깥 세계: claude 는 부르면 기록하고 실패 · gh 는 읽기만 · 네트워크·TCP·DNS 는 전부 기록 후 거부
  const NET_LOG = path.join(M, 'net.jsonl')
  const CLAUDE_LOG = path.join(M, 'claude.jsonl')
  fs.writeFileSync(NET_LOG, '')
  fs.writeFileSync(CLAUDE_LOG, '')
  const netGuard = path.join(M, 'net-guard.mjs')
  fs.writeFileSync(netGuard, `import fs from 'node:fs'; import net from 'node:net'; import dns from 'node:dns'
const rec = (e) => fs.appendFileSync(${JSON.stringify(NET_LOG)}, JSON.stringify({ pid: process.pid, script: process.argv[1], ...e }) + '\\n')
const oc = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...a) { rec({ connect: String(a[0]?.port ?? a[0]?.path ?? a[0]) }); throw new Error('NETWORK_BLOCKED') }
for (const n of ['lookup', 'resolve']) dns[n] = (h) => { rec({ dns: h }); throw new Error('NETWORK_BLOCKED') }
globalThis.fetch = async (u) => { rec({ fetch: String(u?.url ?? u) }); throw new Error('NETWORK_BLOCKED') }
void oc
`)
  const nodeShim = (name, body) => { const f = path.join(M, 'bin', name); fs.writeFileSync(f, `#!${process.execPath}\n${body}\n`); fs.chmodSync(f, 0o755) }
  nodeShim('claude', `const fs = require('node:fs'); const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('mini-claude'); process.exit(0) }
fs.appendFileSync(${JSON.stringify(CLAUDE_LOG)}, JSON.stringify({ args: a }) + '\\n'); console.error('mini claude: 생성하지 않는다'); process.exit(1)`)
  nodeShim('gh', `const a = process.argv.slice(2)
if (a[0] === '--version' || (a[0] === 'auth' && a[1] === 'status')) { console.log('mini-gh'); process.exit(0) }
if (a[0] === 'pr' && a[1] === 'list') { console.log('[]'); process.exit(0) }
console.error('mini gh: 지원하지 않는다 ' + a.join(' ')); process.exit(1)`)
  const fixture = path.join(M, 'chatgpt-fixture.mjs')
  fs.writeFileSync(fixture, `export default { probe: async () => ({ status: 'login_required' }) }\n`)
  const env = {
    PATH: `${path.join(M, 'bin')}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(M, 'home'), TMPDIR: path.join(M, 'tmp'),
    NODE_OPTIONS: `--import=${pathToFileURL(netGuard).href}`, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_TEST_FIXTURE: fixture,
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@invalid',
  }
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const rj = path.join(M, 'tmp', 'cli-result.json')
  const cli = spawnSync(process.execPath, [path.join(R, 'scripts', 'magazine-input-repair.mjs'), '--run', today, '--write', '--result-json', rj], { cwd: R, env, encoding: 'utf8', timeout: 240000 })
  let cliRep = null
  try { cliRep = JSON.parse(fs.readFileSync(rj, 'utf8')) } catch { cliRep = null }
  const cliSlugs = (cliRep?.results ?? []).map((r) => `${r.slug}:${r.outcome}`)
  check('mini ⑥ 실제 input-repair CLI(--write) — 종료 0 · 단계 예외 0 · ENOTDIR 0',
    cli.status === 0 && cliRep?.ok === true && !/ENOTDIR|REPAIR_STAGE_FAILED/.test(`${cli.stdout}${cli.stderr}`), `exit ${cli.status} · ${(cli.stdout + cli.stderr).split('\n').filter((l) => /⛔|예외|ENOTDIR/.test(l)).slice(0, 3).join(' / ')}`)
  check('mini ⑧ 실제 CLI 가 journal 스캔 뒤 gray·cold·autumn 대상 판정과 수리 시도까지 간다',
    [GRAY, COLD, AUTUMN].every((s) => cliSlugs.some((x) => x.startsWith(`${s}:`))) && fs.readFileSync(CLAUDE_LOG, 'utf8').trim().length > 0, cliSlugs.join(' '))
  // 같은 임시 루트에서 producer wrapper
  const prod = spawnSync(process.execPath, [path.join(R, 'scripts', 'magazine-producer-run.mjs')], { cwd: R, env, encoding: 'utf8', timeout: 480000 })
  let ho = null
  try { ho = JSON.parse(fs.readFileSync(path.join(R, 'drafts', 'magazine', '_runs', today, 'producer-handoff.json'), 'utf8')) } catch { ho = null }
  const failures = ho?.repair?.failures ?? null
  let prodRep = null
  try { prodRep = JSON.parse(fs.readFileSync(ho?.repair?.resultFile ?? '', 'utf8')) } catch { prodRep = null }
  check('mini ⑦ 실제 producer wrapper — 입력 수리 단계가 돌았고 REPAIR_STAGE_FAILED·ENOTDIR 0',
    Array.isArray(ho?.ran) && ho.ran.includes('repair') && Array.isArray(failures) && !failures.some((f) => f.outcome === 'REPAIR_STAGE_FAILED') && !/ENOTDIR/.test(`${prod.stdout}${prod.stderr}`),
    `exit ${prod.status} · ${ho?.verdict} · ${JSON.stringify(failures)} · ${(prod.stdout + prod.stderr).split('\n').filter((l) => /ENOTDIR|REPAIR_STAGE/.test(l)).slice(0, 2).join(' / ')}`)
  check('mini ⑧ producer 의 입력 수리 결과 파일에 gray·cold·autumn 이 실제로 판정돼 있다',
    [GRAY, COLD, AUTUMN].every((s) => (prodRep?.results ?? []).some((r) => r.slug === s)), JSON.stringify((prodRep?.results ?? []).map((r) => `${r.slug}:${r.outcome}`)))
  const netEvents = fs.readFileSync(NET_LOG, 'utf8').split('\n').filter(Boolean)
  check('mini ⑨ 네트워크·TCP(9333/9344 포함)·DNS 시도 0', netEvents.length === 0, netEvents.slice(0, 3).join(' · '))
  const homeFiles = []
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.lstatSync(f).isDirectory()) walk(f); else homeFiles.push(f) } }
  walk(path.join(M, 'home'))
  check('mini ⑨ 장부·잠금·로그는 임시 HOME 안에만 · 실제 Chrome 대신 시험 fixture(접근 확인 거부)',
    homeFiles.every((f) => f.startsWith(path.join(M, 'home') + path.sep)) && /login_required|로그인/.test(`${cli.stdout}${prod.stdout}`), `HOME 파일 ${homeFiles.length}`)
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
