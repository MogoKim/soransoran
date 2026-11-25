#!/usr/bin/env node
/**
 * vNext S4 생산기 검사 — production-shaped rehearsal(runbook §0.0B.8)의 생산 쪽 반례를 fake provider 로 주입한다.
 *
 *   node scripts/magazine-vnext-produce-check.mjs                 전체
 *   node scripts/magazine-vnext-produce-check.mjs --only E3,E5    일부(id 접두)
 *   node scripts/magazine-vnext-produce-check.mjs --mutate <id>   변이 사본으로 실행(magazine-vnext-produce-mutation.mjs 가 부른다)
 *
 * 입력은 이 작업 트리의 **실제** main 바이트(control · Bundle · articles · legacy queue · 결속)다 — 후보는 compiler · admission 이 고른다.
 * 소비 쪽은 release writer 의 실제 함수(readReleaseCandidates · assembleRelease · applyReleaseFiles · judgeReleaseContent)다.
 * 🔴 운영 HOME · 운영 Job 저장소 · rollout · live 설정 · 네트워크 · 키 · git 쓰기 0. 모든 저장소는 OS 임시 폴더다.
 * 마지막 줄: `vNext 생산기 검사: <n> pass, <n> fail`
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null
const MUTATE = argv.includes('--mutate') ? argv[argv.indexOf('--mutate') + 1] : null

const TMPS = []
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
const tmp = (p = 'vp-') => { const d = mkdtempSync(join(tmpdir(), p)); TMPS.push(d); return d }
// 🔴 운영 경로를 기본값으로 쓰는 코드가 있어도 닿지 않게 — 이 프로세스의 HOME 을 먼저 임시 폴더로 바꾼다
process.env.HOME = tmp('vp-home-')

// ── 변이 (magazine-vnext-produce-mutation.mjs 와 같은 id) ──
const PRODUCE = 'scripts/lib/magazine-vnext-produce.mjs'
export const MUTATIONS = {
  'request-key-not-exclusive': ['scripts/lib/magazine-job.mjs', "try { fd = fs.openSync(path, 'wx', 0o600) } catch (e) { if (e?.code === 'EEXIST') fail('REQUEST_KEY_EXISTS'", "try { fd = fs.openSync(path, 'w', 0o600) } catch (e) { if (e?.code === 'EEXIST') fail('REQUEST_KEY_EXISTS'"],
  'budget-removed': [PRODUCE, '  const blocked = budgetBlock(ctx, job, estimateUsd)\n', '  const blocked = null\n'],
  'send-scan-removed': [PRODUCE, '  const sendProblems = sentPlanProblems(kind, bodyText, pp.providerPlanHash)\n', '  const sendProblems = []\n'],
  'unknown-resend-early': [PRODUCE, '    if (r.reconcileChecks >= 1 && waited >= L.reconcileAfterMs) {', '    if (true) {'],
  'delete-skipped': [PRODUCE, 'const w = await ctx.deps.provider.manuscript.remove(r.responseId)', "const w = { httpStatus: 404, bodyText: '{}' }"],
  'hero-ratio-unchecked': ['scripts/lib/magazine-vnext-hero.mjs', '  if (loss > HERO_MAX_CROP_LOSS) return', '  if (false) return'],
  'qa-backstop-removed': ['scripts/lib/magazine-vnext-qa.mjs', "  if (!issues.length && backstop.length) add('QA_CORE_UNCLASSIFIED'", "  if (false) add('QA_CORE_UNCLASSIFIED'"],
  'zdr-restart-trusted': [PRODUCE, "  if (r.mode === 'ZDR' && r.runId !== deps.runId) {", "  if (false) {"],
  'regen-cap-raised': ['scripts/lib/magazine-vnext-qa.mjs', 'Object.freeze({ places: 2, regenerations: 1 })', 'Object.freeze({ places: 2, regenerations: 3 })'],
  'produce-lane-removed': ['scripts/magazine-producer-run.mjs', "vnextLane: POST_SYNC ? null : 'produce'", 'vnextLane: null'],
  'live-default-on': [PRODUCE, "  return { code: 'VALID', on: c.enabled === true, config: c, why: null }", "  return { code: 'VALID', on: true, config: c, why: null }"],
  'image-failure-regenerates': [PRODUCE, "  const fail = (j, code, patch = {}) => ({ job: save(ctx, event(ctx, { ...setRequest(j, n, { consumed: true, ...patch }), lastHeroFailure: code }",
    "  const fail = (j, code, patch = {}) => ({ job: save(ctx, event(ctx, { ...setRequest(j, n, { consumed: true, ...patch }), lastHeroFailure: code, draft: null, manuscript: null, validation: null }"],
  'local-final-ignored': [PRODUCE, '      const local = localFinal(ctx, job, r)\n', '      const local = null\n'],
}

if (argv.includes('--list')) { console.log(Object.keys(MUTATIONS).join('\n')); process.exit(0) }

let LIBROOT = ROOT
if (MUTATE) {
  const m = MUTATIONS[MUTATE]
  if (!m) { console.log(`HARNESS 모르는 변이 ${MUTATE}`); process.exit(2) }
  const M = tmp('vp-mut-')
  cpSync(join(ROOT, 'scripts'), join(M, 'scripts'), { recursive: true, filter: (p) => !p.includes('/.') })
  mkdirSync(join(M, 'src/lib'), { recursive: true })
  cpSync(join(ROOT, 'src/lib/magazine-provenance-rule.mjs'), join(M, 'src/lib/magazine-provenance-rule.mjs'))
  symlinkSync(join(ROOT, 'node_modules'), join(M, 'node_modules'))
  const f = join(M, m[0])
  const text = readFileSync(f, 'utf8')
  if (text.split(m[1]).length !== 2) { console.log(`HARNESS 변이 지점이 정확히 1곳이 아니다 — ${MUTATE}`); process.exit(2) }
  writeFileSync(f, text.replace(m[1], m[2]))
  LIBROOT = M
  console.log(`MUTATION APPLIED ${MUTATE}`)
}
const imp = (rel) => import(pathToFileURL(join(LIBROOT, rel)).href)
const P = await imp(PRODUCE)
const J = await imp('scripts/lib/magazine-job.mjs')
const F = await imp('scripts/lib/magazine-provider-fake.mjs')
const PV = await imp('scripts/lib/magazine-provider.mjs')
const Q = await imp('scripts/lib/magazine-vnext-qa.mjs')
const H = await imp('scripts/lib/magazine-vnext-hero.mjs')
const RC = await imp('scripts/lib/magazine-release-candidates.mjs')
const RL = await imp('scripts/lib/magazine-release.mjs')
const RO = await imp('scripts/lib/magazine-rollout.mjs')
const CP = await imp('scripts/lib/magazine-content-plan.mjs')
const RH = await imp('scripts/magazine-vnext-rehearsal.mjs')

// ── 공통 ──
let pass = 0, fail = 0
async function test(id, name, fn) {
  if (ONLY && !ONLY.some((p) => id.startsWith(p))) return
  let ok = false, detail = ''
  try { const r = await fn(); ok = r === true || r?.ok === true; detail = r?.detail ?? '' } catch (e) { detail = `예외 ${e?.code ?? ''} ${e?.message ?? e}`.slice(0, 400) }
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${!ok && detail ? ` — ${String(detail).slice(0, 500)}` : ''}`)
}
const MAIN = RH.readWorktreeMain(ROOT)
if (!MAIN.ok) { console.log(`HARNESS main 바이트를 읽지 못했다 — ${MAIN.why}`); process.exit(2) }
const COMPILED = CP.compileContentPlans({ bundle: MAIN.bundle })
const planOf = (intentId) => COMPILED.plans.find((p) => p.intentId === intentId)
const RESUME = planOf('I-T6-03'), FAMILY = planOf('I-T3-47')
const Q_RESUME = RESUME.primaryQuery, Q_FAMILY = FAMILY.primaryQuery
const HEROES = await Promise.all(readdirSync(join(ROOT, 'public/magazine')).filter((s) => existsSync(join(ROOT, 'public/magazine', s, 'hero.webp')))
  .map(async (s) => ({ name: s, hash: await H.dHash(readFileSync(join(ROOT, 'public/magazine', s, 'hero.webp'))) })))
const T0 = Date.parse('2026-11-25T01:00:00.000Z')
const rolloutOf = (target, path = 'vnext') => ({ code: 'VALID', effective: { path, release: 'draft', targetCandidates: target } })

function env({ target = 1, faults = {}, stage = 'REHEARSAL', prices = RH.FAKE_PRICES, limits = {}, hooks = null, mutateProviderPlan = null, rollout = null, main = MAIN, remote = F.makeRemote(),
  jobsRoot = join(tmp('vp-jobs-'), 'jobs'), clock = { t: T0 } } = {}) {
  const provider = { ...F.makeFakeProviders({ remote, faults }), models: { manuscript: 'fake-manuscript/1', image: 'fake-image/1' }, maxOutputTokens: 6000, repairMaxOutputTokens: 800, imageSize: '1536x1024', prices }
  const deps = (runId) => ({ jobsRoot, now: () => clock.t, sleep: async (ms) => { clock.t += ms }, runId, readRollout: () => rollout ?? rolloutOf(target), readMain: () => main,
    provider, stage, publishedHeroes: () => HEROES, hooks, limits, mutateProviderPlan })
  let seq = 0
  return { jobsRoot, remote, clock, run: (mode = 'run', runId = `r${++seq}`) => P.runProduce({ deps: deps(runId), mode }), advance: (min) => { clock.t += min * 60_000 } }
}
const jobsOf = (e) => J.listJobs(e.jobsRoot).map((x) => x.job)
const jobOf = (e, intentId) => jobsOf(e).find((j) => j.intentId === intentId)
const submits = (e, q = null) => e.remote.calls.submit.filter((c) => !q || c.query === q).length
const state = (j) => (j ? J.jobState(j) : 'NONE')
const consumeRelease = (e, target) => {
  const cand = RC.readReleaseCandidates({ jobsRoot: e.jobsRoot })
  const rel = RL.assembleRelease({ bundle: MAIN.bundle, controlText: MAIN.controlText, articlesText: MAIN.articlesText, legacyQueue: MAIN.legacyQueue, nowMs: e.clock.t,
    candidates: cand.candidates, slugRecords: {}, occupied: { dates: [], slugs: [] }, existingHeroSlugs: readdirSync(join(ROOT, 'public/magazine')), targetCandidates: target, inFlightIntentIds: [], baseSha: null })
  return { cand, rel }
}

// ── E — 선택 · 경계 ──
await test('E1', '계획만 — target 1 은 이력서(I-T6-03) · target 2 는 이력서 + 가족(I-T3-47) · 쓰기 0 · 호출 0', async () => {
  const a = env({ target: 1 }), b = env({ target: 2 })
  const ra = await a.run('plan'), rb = await b.run('plan')
  const ok = ra.outcome === 'PLAN_ONLY' && ra.selected.map((s) => s.intentId).join() === 'I-T6-03' && rb.selected.map((s) => s.intentId).join() === 'I-T6-03,I-T3-47'
    && !existsSync(a.jobsRoot) && !existsSync(b.jobsRoot) && submits(a) + submits(b) === 0
  return { ok, detail: JSON.stringify({ a: ra.selected, b: rb.selected, held: rb.held }) }
})
await test('E2', 'rollout legacy · 없음 · 손상 → NOT_VNEXT · 저장소 생성 0', async () => {
  const rs = [rolloutOf(1, 'legacy'), { code: 'MISSING', effective: { path: 'legacy', release: 'draft', targetCandidates: 1 } }, { code: 'INVALID', effective: { path: 'legacy', release: 'draft', targetCandidates: 1 } }]
  const out = []
  for (const rollout of rs) { const e = env({ rollout }); const r = await e.run(); out.push([r.outcome, existsSync(e.jobsRoot), submits(e)]) }
  return { ok: out.every(([o, ex, s]) => o === 'NOT_VNEXT' && !ex && s === 0), detail: JSON.stringify(out) }
})
await test('E3', '정상 2편(다른 cluster) — 원고 요청 planHash 당 1 · 삭제 확인 · manuscript 계약 · readReleaseCandidates → assembleRelease 2편 다른 날짜 · 재실행 호출 0', async () => {
  const e = env({ target: 2 })
  const r1 = await e.run()
  const js = jobsOf(e)
  const del = js.flatMap((j) => j.requests.filter((r) => r.kind === 'manuscript').map((r) => r.deletion?.result))
  const contract = js.every((j) => RL.articleProblems(JSON.parse(J.readArtifact(e.jobsRoot, j.planHash, j.manuscript.file).toString('utf8')), planOf(j.intentId)).length === 0)
  const before = { s: submits(e), i: e.remote.calls.image.length }
  const r2 = await e.run()
  const { cand, rel } = consumeRelease(e, 2)
  const days = new Set(rel.members?.map((m) => m.publishAt))
  const ok = r1.outcome === 'RAN' && js.length === 2 && js.every((j) => state(j) === 'HERO_READY') && submits(e, Q_RESUME) === 1 && submits(e, Q_FAMILY) === 1
    && del.every((d) => d === 'DELETED') && contract && cand.candidates.length === 2 && cand.skipped.length === 0 && rel.ok && rel.members.length === 2 && days.size === 2
    && submits(e) === before.s && e.remote.calls.image.length === before.i && r2.outcome === 'RAN'
  return { ok, detail: JSON.stringify({ states: js.map(state), del, contract, cand: cand.candidates.length, skipped: cand.skipped, rel: rel.code, withdrawn: rel.withdrawn, s: submits(e) }) }
})
await test('E3b', '리허설 끝까지 — applyReleaseFiles(CAS · journal) · judgeReleaseContent(merge 직전 관문) 통과 · 미리보기에 fake 표식', async () => {
  const out = join(tmp('vp-rh-'), 'out')
  const r = await RH.rehearse({ root: ROOT, out, target: 2 })
  const html = r.preview ? readFileSync(r.preview, 'utf8') : ''
  return { ok: r.ok && r.gate.ok && r.release.members.length === 2 && html.includes('fake provider 리허설 산출') && html.includes('noindex'), detail: JSON.stringify({ code: r.code, gate: r.gate, rel: r.release?.code }) }
})

// ── 재개 · 중복 금지 ──
await test('E4', '급사(제출 응답 저장 직후) → 다음 회차가 저장된 바이트로 같은 responseId 를 이어 본다 · 재전송 0', async () => {
  let armed = true
  const e = env({ hooks: { at: (p) => { if (armed && p === 'after-submit-raw') { armed = false; throw new Error('SIMULATED_CRASH') } } } })
  await e.run().catch(() => null)
  const mid = jobOf(e, 'I-T6-03').requests[0]
  e.advance(1)
  await e.run()
  const j = jobOf(e, 'I-T6-03')
  return { ok: mid.status === 'SUBMITTING' && submits(e) === 1 && j.requests[0].responseId === 'resp_fake_0001' && state(j) === 'HERO_READY', detail: JSON.stringify({ mid: mid.status, s: submits(e), st: state(j) }) }
})
await test('E5', '급사(요청 기록 뒤 · 전송 전) → SUBMISSION_UNKNOWN · 확인 창 전 재전송 0 · 창 뒤 회수 불능 확정 → 재생성 1회 · 채택 원고 1', async () => {
  let armed = true
  const e = env({ hooks: { at: (p) => { if (armed && p === 'after-request-recorded') { armed = false; throw new Error('SIMULATED_CRASH') } } } })
  await e.run().catch(() => null)
  e.advance(1); await e.run()
  const a = { s: submits(e), st: jobOf(e, 'I-T6-03').requests[0].status }
  e.advance(1); await e.run()
  const b = submits(e)
  e.advance(16); await e.run()
  const j = jobOf(e, 'I-T6-03')
  const ok = a.s === 0 && a.st === 'UNKNOWN' && b === 0 && submits(e) === 1 && j.requests[0].status === 'UNRECOVERABLE' && j.requests[0].orphanPossible === true
    && state(j) === 'HERO_READY' && j.validation.regenerations === 1 && j.manuscript.file === 'manuscript.json'
  return { ok, detail: JSON.stringify({ a, b, s: submits(e), st: state(j), r: j.requests.map((r) => `${r.kind}:${r.status}`) }) }
})
await test('E6', '전송 중 끊김(TRANSPORT — 원격은 받음) → 그 회차 · 확인 창 안 재전송 0 · 창 뒤 재생성 1회 · 고아 가능성 기록', async () => {
  const e = env({ faults: { [Q_RESUME]: { submit: ['TRANSPORT'] } } })
  const r1 = await e.run()
  const s1 = submits(e)
  e.advance(5); await e.run()
  const s2 = submits(e)
  e.advance(16); await e.run()
  const j = jobOf(e, 'I-T6-03')
  return { ok: s1 === 1 && s2 === 1 && submits(e) === 2 && j.requests[0].orphanPossible && state(j) === 'HERO_READY' && r1.notices.some((n) => n.code === 'SUBMISSION_UNKNOWN'),
    detail: JSON.stringify({ s1, s2, s: submits(e), st: state(j) }) }
}
)
await test('E7', 'bounded polling — 점유 상한에서 nextPollAt 을 쓰고 끝냄 · 그 전 회차는 조회 0 · 같은 ID 로 완료', async () => {
  const e = env({ faults: { [Q_RESUME]: { poll: ['SLOW:4'] } }, limits: { pollOccupancyMs: 20_000, pollIntervalMs: 15_000 } })
  await e.run()
  const j1 = jobOf(e, 'I-T6-03'), polls1 = e.remote.calls.retrieve.length
  await e.run()
  const polls2 = e.remote.calls.retrieve.length
  e.advance(1); await e.run(); e.advance(1); await e.run()
  const j = jobOf(e, 'I-T6-03')
  return { ok: j1.requests[0].status === 'SUBMITTED' && j1.requests[0].nextPollAt && polls2 === polls1 && submits(e) === 1 && state(j) === 'HERO_READY',
    detail: JSON.stringify({ polls1, polls2, st: state(j), s: submits(e) }) }
})
await test('E8', '회수 불능(404) → 재생성 1회 · 두 번 다 404 → 그 Job 만 HOLD · 다른 cluster Job 은 HERO_READY', async () => {
  const a = env({ faults: { [Q_RESUME]: { poll: ['GONE'] } } })
  await a.run()
  const b = env({ target: 2, faults: { [Q_RESUME]: { poll: ['GONE', 'GONE'] } } })
  await b.run()
  const ja = jobOf(a, 'I-T6-03'), jb = jobOf(b, 'I-T6-03'), jf = jobOf(b, 'I-T3-47')
  return { ok: state(ja) === 'HERO_READY' && submits(a) === 2 && jb.hold?.reason === 'REMOTE_UNRECOVERABLE' && state(jf) === 'HERO_READY',
    detail: JSON.stringify({ a: state(ja), sa: submits(a), b: jb.hold, f: state(jf) }) }
})
await test('E9', 'DELETE 실패는 진행을 막지 않는다 · 다음 회차 sweeper 가 같은 ID 로 재시도 → 확인 기록 · 404 는 완료', async () => {
  const e = env({ faults: { __remove: ['HTTP_500', 'HTTP_500'] } })
  await e.run()
  const d1 = jobOf(e, 'I-T6-03').requests[0].deletion, st1 = state(jobOf(e, 'I-T6-03'))
  await e.run()
  const d2 = jobOf(e, 'I-T6-03').requests[0].deletion
  await e.run()
  const d3 = jobOf(e, 'I-T6-03').requests[0].deletion
  const g = env({ faults: { __remove: ['HTTP_404'] } })
  await g.run()
  const dg = jobOf(g, 'I-T6-03').requests[0].deletion
  return { ok: st1 === 'HERO_READY' && d1.result === 'FAILED' && d2.result === 'FAILED' && d2.attempts === 2 && d3.result === 'DELETED' && d3.attempts === 3 && dg.result === 'NOT_FOUND',
    detail: JSON.stringify({ st1, d1, d2, d3, dg }) }
})
await test('E10', '로컬 저장 뒤 원격이 사라짐(급사 · 만료) → 저장본이 정본 · 재생성 0', async () => {
  let armed = true
  const remote = F.makeRemote()
  const e = env({ remote, hooks: { at: (p) => { if (armed && p === 'after-final-raw') { armed = false; for (const r of Object.values(remote.responses)) r.deleted = true; throw new Error('SIMULATED_CRASH') } } } })
  await e.run().catch(() => null)
  await e.run()
  const j = jobOf(e, 'I-T6-03')
  return { ok: submits(e) === 1 && j.requests[0].status === 'COMPLETED' && j.requests[0].deletion?.result === 'NOT_FOUND' && state(j) === 'HERO_READY', detail: JSON.stringify({ s: submits(e), r: j.requests[0].status, st: state(j) }) }
})
await test('E11', '동시 실행 — 생산 잠금 하나 · 요청 키 O_EXCL · 같은 planHash Job 두 번 0', async () => {
  const e = env()
  const [a, b] = await Promise.all([e.run(), e.run()])
  const outcomes = [a.outcome, b.outcome].sort()
  const j = jobOf(e, 'I-T6-03')
  let keyDup = null, jobDup = null
  try { J.createRequestKey(e.jobsRoot, j.planHash, 1, { nowIso: 'x', runId: 'x' }) } catch (x) { keyDup = x.code }
  try { J.createJob(e.jobsRoot, j) } catch (x) { jobDup = x.code }
  return { ok: outcomes.join() === 'PRODUCE_LOCK_HELD,RAN' && submits(e) === 1 && keyDup === 'REQUEST_KEY_EXISTS' && jobDup === 'JOB_EXISTS', detail: JSON.stringify({ outcomes, s: submits(e), keyDup, jobDup }) }
})

// ── hero ──
await test('E12', '이미지 실패 → 이미지만 1회 더(원고 재생성 0) · 두 번 실패 → HERO_FAILED HOLD 원고 보존 · rerun hero → 이미지만', async () => {
  const a = env({ faults: { __image: ['HTTP_500'] } })
  await a.run()
  const b = env({ faults: { __image: ['HTTP_500', 'SQUARE'] } })
  await b.run()
  const held = jobOf(b, 'I-T6-03')
  const rr = P.rerunJob({ jobsRoot: b.jobsRoot, planHash: held.planHash, scope: 'hero', by: 'check', nowIso: new Date(b.clock.t).toISOString() })
  await b.run()
  const jb = jobOf(b, 'I-T6-03')
  return { ok: state(jobOf(a, 'I-T6-03')) === 'HERO_READY' && submits(a) === 1 && held.hold?.reason === 'HERO_FAILED' && held.validation?.verdict === 'VALID' && held.manuscript
    && rr.ok && state(jb) === 'HERO_READY' && submits(b) === 1 && jb.manuscript.sha256 === held.manuscript.sha256 && b.remote.calls.image.length === 3,
  detail: JSON.stringify({ a: state(jobOf(a, 'I-T6-03')), held: held.hold, rr, b: state(jb), s: submits(b), img: b.remote.calls.image.length }) }
})
await test('E13', 'hero — 1200×675 WebP · 16:9 잘라 맞춤(늘림 0) · 정사각 · 작은 원본 거부 · 지각 해시 중복 거부 뒤 재시도', async () => {
  const sharp = (await import(pathToFileURL(join(ROOT, 'node_modules/sharp/lib/index.js')).href)).default
  const png = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 80, b: 40 } } }).png().toBuffer()
  const wide = await H.heroFromSource(await png(1536, 1024)), sq = await H.heroFromSource(await png(1024, 1024)), small = await H.heroFromSource(await png(960, 640))
  const meta = wide.ok ? await sharp(wide.webp).metadata() : {}
  const e = env({ target: 2, faults: { __image: ['OK', 'DUP'] } })
  await e.run()
  const js = jobsOf(e)
  const dupEvent = js.some((j) => j.requests.some((r) => r.duplicateOf))
  return { ok: wide.ok && meta.format === 'webp' && meta.width === 1200 && meta.height === 675 && wide.crop.height === 864 && !sq.ok && sq.code === 'IMAGE_RATIO_FAR' && !small.ok && small.code === 'IMAGE_TOO_SMALL'
    && js.every((j) => state(j) === 'HERO_READY') && dupEvent && js[0].hero.sha256 !== js[1].hero.sha256, detail: JSON.stringify({ wide: wide.crop, sq: sq.code, small: small.code, states: js.map(state), dupEvent }) }
})

// ── 검증 · 수리 ──
const qaRun = async (output, { target = 1 } = {}) => { const e = env({ target, faults: { [Q_RESUME]: { output } } }); await e.run(); return { e, j: jobOf(e, 'I-T6-03') } }
await test('E14', '메타 칸(description) → 그 칸만 수리 1곳 · 같은 검증기 재판정 → VALID', async () => {
  const { e, j } = await qaRun(['META_DESCRIPTION'])
  const rep = j.requests.filter((r) => r.kind === 'repair')
  return { ok: state(j) === 'HERO_READY' && rep.length === 1 && rep[0].target.field === 'description' && j.validation.repairs === 1 && submits(e) === 2, detail: JSON.stringify({ st: state(j), rep: rep.map((r) => r.target), v: j.validation }) }
})
await test('E15', '금지 호칭 문장 → 그 문장만 재작성 · 면책 문장(다루지 않는 주제 고지)은 면제 · 수리 0', async () => {
  const a = await qaRun(['BANNED_SENTENCE']), b = await qaRun(['DISCLAIMER'])
  const ra = a.j.requests.filter((r) => r.kind === 'repair')
  const art = JSON.parse(J.readArtifact(b.e.jobsRoot, b.j.planHash, 'manuscript.json').toString('utf8'))
  const kept = art.body.some((x) => x.text?.includes('이 글에서 다루지 않습니다'))
  return { ok: state(a.j) === 'HERO_READY' && ra.length === 1 && ra[0].target.kind === 'sentence' && state(b.j) === 'HERO_READY' && b.j.validation.repairs === 0 && kept,
    detail: JSON.stringify({ a: state(a.j), ra: ra.map((r) => r.target), b: b.j.validation, kept }) }
})
await test('E16', '사실 오류(출처 없는 수치) → 문장 수리로 덮지 않고 전체 재생성 1회 · 두 번이면 QA_REGEN_EXHAUSTED HOLD', async () => {
  const a = await qaRun(['FACT_STAT']), b = await qaRun(['FACT_STAT', 'FACT_STAT'])
  return { ok: state(a.j) === 'HERO_READY' && a.j.validation.regenerations === 1 && !a.j.requests.some((r) => r.kind === 'repair') && b.j.hold?.reason === 'QA_REGEN_EXHAUSTED' && submits(b.e) === 2,
    detail: JSON.stringify({ a: a.j.validation, b: b.j.hold, sb: submits(b.e) }) }
})
await test('E17', '고정 문장(CTA 누락 · 마크다운) → 결정적 삽입 · provider 호출 0 · 수리 3곳 이상 → 재생성 · 구조 붕괴 → 재생성', async () => {
  const a = await qaRun(['CTA_MISSING']), m = await qaRun(['MARKDOWN']), c = await qaRun(['MANY_BANNED']), s = await qaRun(['STRUCTURE'])
  const art = JSON.parse(J.readArtifact(a.e.jobsRoot, a.j.planHash, 'manuscript.json').toString('utf8'))
  const cta = art.body.filter((x) => x.type === 'cta')
  return { ok: state(a.j) === 'HERO_READY' && submits(a.e) === 1 && cta.length === 1 && cta[0].href === RESUME.cta.communityDestination && cta[0].label === Q.CANONICAL_CTA[RESUME.cta.communityDestination].label
    && state(m.j) === 'HERO_READY' && submits(m.e) === 1 && state(c.j) === 'HERO_READY' && c.j.validation.regenerations === 1 && (c.j.events ?? []).some((x) => x.code === 'REPAIR_TO_REGENERATE')
    && state(s.j) === 'HERO_READY' && s.j.validation.regenerations === 1,
  detail: JSON.stringify({ a: [state(a.j), submits(a.e), cta], m: state(m.j), c: c.j.validation, s: s.j.validation }) }
})
await test('E18', '분류 못 한 QA FAIL(backstop) → 재생성 · 진료 안내 누락(medical cluster) → 정본 문장 결정 삽입', async () => {
  const pp = CP.projectProviderPlan({ admission: { bundle: MAIN.bundle, controlText: MAIN.controlText, articlesText: MAIN.articlesText, legacyQueue: MAIN.legacyQueue, nowMs: T0 }, planId: RESUME.planId, planHash: RESUME.planHash })
  const base = Q.articleFromManuscript(F.composeFakeManuscript(pp.providerPlan), RESUME)
  const heal = structuredClone(base); heal.body.splice(1, 0, { type: 'p', text: '치료하면 낫습니다.' })
  const vh = Q.validateArticle({ article: heal, plan: RESUME, published: [] })
  const sleepPlan = { ...RESUME, cluster: 'sleep' }
  const med = { ...structuredClone(base), medical: true }
  const vm = Q.validateArticle({ article: med, plan: sleepPlan, published: [] })
  const fixed = Q.applyFixedRepairs(med, vm.issues, sleepPlan)
  const vm2 = Q.validateArticle({ article: fixed.article, plan: sleepPlan, published: [] })
  return { ok: vh.verdict === 'REGENERATE' && vh.issues.some((i) => i.code === 'QA_CORE_UNCLASSIFIED') && vm.issues.some((i) => i.code === 'CARE_LINE_MISSING') && fixed.applied.includes('CARE_LINE_MISSING') && vm2.verdict === 'VALID',
    detail: JSON.stringify({ vh: vh.issues.map((i) => i.code), vm: vm.issues.map((i) => i.code), vm2: [vm2.verdict, vm2.issues.map((i) => i.code), vm2.backstop] }) }
})

// ── 비용 · ProviderPlan · 계약 ──
await test('E19', '비용 상한 — 편당 초과 예상 → 전송 0 HOLD · 월 $30 도달 → 새 호출 0(검증된 후보 release 판독은 계속) · canary $5', async () => {
  const a = env({ prices: { manuscript: { inputPer1M: 1, outputPer1M: 1e6 }, image: { perImage: 0.04 } } })
  await a.run()
  const b = env({ target: 2 })
  await b.run() // 2편 HERO_READY
  const ja = jobOf(a, 'I-T6-03')
  // 같은 달에 $29.99 를 이미 쓴 Job 을 하나 더 둔다 → 세 번째 plan(I-T6-11)은 호출 0
  const seed = (root, tag, req) => J.createJob(root, { schemaVersion: 'magazine-job/1', planId: tag, planHash: createHash('sha256').update(tag).digest('hex'), intentId: tag, cluster: 'x', requests: [{ n: 1, kind: 'manuscript', status: 'COMPLETED', consumed: true, ...req }], hold: { reason: 'SEED' } })
  seed(b.jobsRoot, 'month-seed', { createdAt: new Date(b.clock.t).toISOString(), costUsd: 29.99 })
  const before = submits(b)
  const r = await env({ target: 4, stage: 'PILOT', jobsRoot: b.jobsRoot, remote: b.remote, clock: b.clock }).run()
  const cand = RC.readReleaseCandidates({ jobsRoot: b.jobsRoot })
  const c = env({ stage: 'S5_CANARY' })
  seed(c.jobsRoot, 'canary-seed', { stage: 'S5_CANARY', createdAt: '2026-10-01T00:00:00.000Z', costUsd: 4.999 })
  const rc = await c.run()
  return { ok: ja.hold?.reason === 'COST_CAP_ARTICLE' && submits(a) === 0 && r.outcome === 'MONTH_CAP_REACHED' && submits(b) === before && cand.candidates.length === 2 && rc.outcome === 'CANARY_CAP_REACHED' && submits(c) === 0,
    detail: JSON.stringify({ a: ja.hold, month: r.outcome, s: [before, submits(b)], cand: cand.candidates.length, canary: rc.outcome }) }
})
await test('E20', 'ProviderPlan 2차 방어 — 투영이 회귀해 PII · 금지 필드가 실려도 실제 전송 바이트에서 잡아 전송 0 HOLD', async () => {
  const a = env({ mutateProviderPlan: (pp) => ({ ...pp, audienceSituation: `${pp.audienceSituation} 연락처 010-1234-5678` }) })
  await a.run()
  const b = env({ mutateProviderPlan: (pp) => ({ ...pp, memberNickname: '회원' }) })
  await b.run()
  const ha = jobOf(a, 'I-T6-03').hold, hb = jobOf(b, 'I-T6-03').hold
  return { ok: submits(a) === 0 && submits(b) === 0 && ha?.reason === 'PROVIDER_PLAN_FORBIDDEN' && /PII_PHONE/.test(ha.detail) && /SEND_PLAN_HASH_MISMATCH/.test(ha.detail) && hb?.reason === 'PROVIDER_PLAN_FORBIDDEN' && /UNKNOWN_KEY/.test(hb.detail),
    detail: JSON.stringify({ ha, hb }) }
})
await test('E21', 'Bundle 해시 불일치 → 그 판 컴파일 0 · Job 0 · 호출 0', async () => {
  const tampered = { ...MAIN, bundle: MAIN.bundle.replace('"이 나이에 이력서를 어떻게 쓰나요"', '"이 나이에 이력서를 어떻게 쓰나"') }
  const e = env({ main: tampered })
  const r = await e.run()
  return { ok: tampered.bundle !== MAIN.bundle && r.outcome === 'BUNDLE_HOLD' && /HASH_MISMATCH/.test(r.stop.code) && !existsSync(e.jobsRoot) && submits(e) === 0, detail: JSON.stringify(r.stop) }
})
await test('E22', '계약 충돌(strict 출력 아님 · 400) → DESIGN_CONTRACT_CONFLICT · 그 회차 정지(다른 Job 호출 0 · 브라우저 강등 0)', async () => {
  const a = env({ target: 2, faults: { [Q_RESUME]: { output: ['NOT_JSON'] } } })
  const ra = await a.run()
  const b = env({ faults: { [Q_RESUME]: { submit: ['HTTP_400'] } } })
  const rb = await b.run()
  return { ok: ra.outcome === 'DESIGN_CONTRACT_CONFLICT' && jobOf(a, 'I-T6-03').hold?.reason === 'DESIGN_CONTRACT_CONFLICT' && submits(a, Q_FAMILY) === 0 && rb.outcome === 'DESIGN_CONTRACT_CONFLICT' && submits(b) === 1,
    detail: JSON.stringify({ ra: ra.outcome, fam: submits(a, Q_FAMILY), rb: rb.outcome }) }
})
await test('E23', 'store:false(ZDR) — 프로세스가 바뀌면 회수 불능 확정 → 재생성 1회 · 삭제 생략 기록', async () => {
  let armed = true
  const e = env({ faults: { [Q_RESUME]: { submit: ['ZDR'] } }, hooks: { at(point) {
    if (armed && point === 'after-submit-raw') { armed = false; throw Error('SIMULATED_CRASH') }
  } } })
  await e.run().catch(() => null)
  await e.run()
  const j = jobOf(e, 'I-T6-03')
  return { ok: j.requests[0].error === 'ZDR_PROCESS_RESTARTED' && submits(e) === 2 && state(j) === 'HERO_READY' && j.requests[1].deletion?.result === 'DELETED', detail: JSON.stringify(j.requests.map((r) => [r.kind, r.status, r.mode, r.error, r.deletion?.result])) }
})
await test('E24', 'AUTH(401) → 회차 정지 · 다른 Job 호출 0 · 429 → 정해진 시각까지 대기 뒤 새 요청(재생성 예산 소모 0)', async () => {
  const a = env({ target: 2, faults: { [Q_RESUME]: { submit: ['HTTP_401'] } } })
  const ra = await a.run()
  const b = env({ faults: { [Q_RESUME]: { submit: ['HTTP_429'] } } })
  await b.run(); b.advance(5); await b.run()
  const mid = submits(b)
  b.advance(31); await b.run()
  const jb = jobOf(b, 'I-T6-03')
  return { ok: ra.outcome === 'AUTH' && submits(a) === 1 && mid === 1 && submits(b) === 2 && state(jb) === 'HERO_READY' && jb.validation.regenerations === 0, detail: JSON.stringify({ ra: ra.outcome, sa: submits(a), mid, sb: submits(b), v: jb.validation }) }
})

// ── 진입 · 스위치 · 경계 ──
await test('E25', 'live 스위치 기본 OFF — 없음 · 손상 · enabled:false · 단가 0 은 OFF · 정상 enabled:true 만 ON', async () => {
  const d = tmp('vp-live-')
  const put = (name, v) => { const p = join(d, name); writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); return p }
  const good = { schemaVersion: 'magazine-provider-live/1', enabled: true, stage: 'S5_CANARY', manuscript: { model: 'gpt-6-luna', maxOutputTokens: 6000, repairMaxOutputTokens: 800, inputPer1M: 0.1, outputPer1M: 0.4 },
    image: { model: 'gpt-image-2.5-flare', size: '1536x1024', perImage: 0.02 }, keychain: { service: 'svc', account: 'acct' }, changedBy: 'founder', changedAt: '2026-11-26T00:00:00.000Z' }
  const r = {
    missing: P.readLiveConfig({ path: join(d, 'none.json') }), broken: P.readLiveConfig({ path: put('b.json', '{') }), off: P.readLiveConfig({ path: put('o.json', { ...good, enabled: false }) }),
    zero: P.readLiveConfig({ path: put('z.json', { ...good, image: { ...good.image, perImage: 0 } }) }), extra: P.readLiveConfig({ path: put('x.json', { ...good, apiKey: 'sk-x' }) }), on: P.readLiveConfig({ path: put('g.json', good) }),
  }
  return { ok: !r.missing.on && !r.broken.on && !r.off.on && r.off.code === 'VALID' && !r.zero.on && !r.extra.on && r.on.on, detail: JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.code, v.on, v.why]]))) }
})
await test('E26', '00:10 진입 — producer-run 은 vnext 에서 생산기(--launcher)만 부른다 · sync 뒤 재실행 자식은 fail-closed · rolloutGate produce lane', async () => {
  const pr = readFileSync(join(LIBROOT, 'scripts/magazine-producer-run.mjs'), 'utf8')
  const g = RO.rolloutGate({ code: 'VALID', effective: { path: 'vnext', release: 'draft', targetCandidates: 1 }, why: null, path: 'x' }, { vnextLane: 'produce' })
  const child = RO.rolloutGate({ code: 'VALID', effective: { path: 'vnext', release: 'draft', targetCandidates: 1 }, why: null, path: 'x' }, { vnextLane: null })
  const leg = RO.rolloutGate({ code: 'MISSING', effective: { path: 'legacy', release: 'draft', targetCandidates: 1 }, why: null, path: 'x' }, { vnextLane: 'produce' })
  const guard = pr.slice(pr.indexOf('const ROLLOUT = rolloutGate('), pr.indexOf('if (ROLLOUT.warning)'))
  return { ok: /vnextLane: POST_SYNC \? null : 'produce'/.test(guard) && guard.includes("'scripts/magazine-vnext-produce.mjs'), '--launcher'") && g.lane === 'produce' && !g.proceed && /VNEXT_PRODUCE_LANE/.test(g.line)
    && !child.proceed && /VNEXT_NOT_IMPLEMENTED/.test(child.line) && leg.proceed, detail: JSON.stringify({ g, child: child.line, leg }) }
})
await test('E27', '명시적 재호출 — 이름 필수 · 진행 중 요청이면 거부 · all 은 요청 은퇴 · 편당 비용은 은퇴분까지 계속 센다', async () => {
  const e = env({ faults: { [Q_RESUME]: { output: ['FACT_STAT', 'FACT_STAT'] } } })
  await e.run()
  const j = jobOf(e, 'I-T6-03')
  const noBy = P.rerunJob({ jobsRoot: e.jobsRoot, planHash: j.planHash, scope: 'all', by: '', nowIso: 'x' })
  const cost0 = J.jobCostUsd(j)
  const ok1 = P.rerunJob({ jobsRoot: e.jobsRoot, planHash: j.planHash, scope: 'all', by: 'founder', nowIso: new Date(e.clock.t).toISOString() })
  await e.run()
  const j2 = jobOf(e, 'I-T6-03')
  const t = env({ faults: { [Q_RESUME]: { poll: ['SLOW:9'] } }, limits: { pollOccupancyMs: 1, pollIntervalMs: 15_000 } })
  await t.run()
  const inflight = P.rerunJob({ jobsRoot: t.jobsRoot, planHash: jobOf(t, 'I-T6-03').planHash, scope: 'all', by: 'founder', nowIso: 'x' })
  return { ok: noBy.code === 'BY_REQUIRED' && ok1.ok && state(j2) === 'HERO_READY' && J.jobCostUsd(j2) > cost0 && j2.reruns.length === 1 && submits(e) === 3 && inflight.code === 'REQUEST_IN_FLIGHT',
    detail: JSON.stringify({ noBy, ok1, st: state(j2), cost: [cost0, J.jobCostUsd(j2)], s: submits(e), inflight }) }
})
await test('E28', '격리 — 리허설은 저장소 안 · 운영 상태 폴더(~/Library/Application Support/soransoran) 안 출력을 거부한다', async () => {
  const a = await RH.rehearse({ root: ROOT, out: join(ROOT, '.vnext-rehearsal-out') })
  const b = await RH.rehearse({ root: ROOT, out: join(process.env.HOME, 'Library', 'Application Support', 'soransoran', 'x') })
  return { ok: a.code === 'OUT_NOT_ISOLATED' && b.code === 'OUT_NOT_ISOLATED' && !existsSync(join(ROOT, '.vnext-rehearsal-out')), detail: JSON.stringify([a.code, b.code]) }
})
await test('E29', '실제 adapter wire — POST /responses background·store:true · previous_response_id 0 · metadata 0 · 키는 헤더에만 · 끊김은 TRANSPORT', async () => {
  const seen = []
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { status: 200, text: async () => JSON.stringify({ id: 'resp_x', status: 'queued', store: true }) } }
  const key = `sk-test-${'k'.repeat(30)}`
  const ad = PV.makeOpenAiProviders({ apiKey: key, fetchImpl, baseUrl: 'https://example.invalid/v1' })
  const pp = CP.projectProviderPlan({ admission: { bundle: MAIN.bundle, controlText: MAIN.controlText, articlesText: MAIN.articlesText, legacyQueue: MAIN.legacyQueue, nowMs: T0 }, planId: RESUME.planId, planHash: RESUME.planHash })
  const { bodyText } = PV.buildManuscriptBody({ providerPlan: pp.providerPlan, model: 'm', maxOutputTokens: 6000 })
  const w = await ad.manuscript.submit(bodyText)
  await ad.manuscript.retrieve('resp_x'); await ad.manuscript.remove('resp_x')
  const body = JSON.parse(seen[0].init.body)
  let transport = null
  try { await PV.makeOpenAiProviders({ apiKey: key, fetchImpl: async () => { throw new Error('boom') } }).manuscript.submit('{}') } catch (e) { transport = e.code }
  const sentPlan = JSON.parse(body.input[0].content[0].text)
  return { ok: seen[0].url.endsWith('/responses') && seen[0].init.method === 'POST' && body.background === true && body.store === true && !('previous_response_id' in body) && !('metadata' in body)
    && seen[0].init.headers.Authorization === `Bearer ${key}` && !JSON.stringify(w).includes(key) && !seen[0].init.body.includes(key) && seen[1].init.method === 'GET' && seen[2].init.method === 'DELETE'
    && transport === 'TRANSPORT' && JSON.stringify(sentPlan) === JSON.stringify(pp.providerPlan) && body.text.format.strict === true, detail: JSON.stringify({ urls: seen.map((s) => `${s.init.method} ${s.url}`), keys: Object.keys(body), transport }) }
})
await test('E31', '실제 캐시 쓰기·읽기 단가와 불완전한 영수증을 구분한다', () => {
  const usage = { inputTokens: 1162, outputTokens: 1822, details: { cached_tokens: 0, cache_write_tokens: 1159,
    cache_write_tokens_details: { ttl_30m_tokens: 1159, ttl_12h_tokens: 0 } } }
  const prices = PV.LIVE_TEXT_RATES['gpt-6.1-terra']
  return PV.actualCostUsd({ usage, prices }) === 0.01056175 &&
    PV.actualCostUsd({ usage: { ...usage, details: { cache_write_tokens: 1159 } }, prices }) === null
})
await test('E32', 'dry-run과 유료 실행을 혼합하면 설정·키 조회 전에 사용법 오류로 끝난다', () => {
  const file = join(LIBROOT, 'scripts/magazine-vnext-produce.mjs')
  return [['--live', '--dry-run'], ['--live', '--plan'], ['--rerun', 'bad', '--live']].every(args =>
    spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' }).status === 2)
})
await test('E30', 'vNext 생산 진입점의 legacy 모듈 도달 0 (정적 import 폐포)', async () => {
  const LEGACY = /magazine-(load|hero|hero-webp|hero-runner|quarantine|webui-runner|register|queue-lock|direct-spec[\w-]*|brief[\w-]*|producer-(plan|flow|exit|notify)|regen|handoff|fetch-result|delivery-gate|merge-gate|auto-[\w-]+|input-repair|outstanding|manuscript-guard|rehearsal-[\w-]+)\.mjs$/
  const seen = new Set(), queue = ['scripts/magazine-vnext-produce.mjs', 'scripts/magazine-vnext-rehearsal.mjs'], hits = []
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f)) continue
    seen.add(f)
    const src = readFileSync(join(LIBROOT, f), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
    for (const m of src.matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const t = join(dirname(f), m[1]).split('\\').join('/')
      if (LEGACY.test(t)) hits.push(`${f} → ${t}`)
      queue.push(t)
    }
  }
  return { ok: hits.length === 0 && seen.size > 10, detail: `${seen.size} 모듈 · ${hits.join(' | ')}` }
})

console.log(`\nvNext 생산기 검사: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
