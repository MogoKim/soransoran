#!/usr/bin/env node
/**
 * CTA 수리 transaction 진행 중 slug 의 전 경로 HOLD (2026-10-29 Codex P1).
 *
 * 🔴 CTA 수리가 canonical 을 떼어 낸 뒤 급사하면 draft.md 가 잠시 없다. producer plan 은 slug 폴더로 재사용을 정하고,
 *    run-targets 는 direct 행의 draft.md 부재를 회수 대상으로 본다 — 같은 글을 ChatGPT 에 다시 보낼 수 있었다.
 *    조각이 하나라도 남은 slug 는 planRun · fetchBatch · fetchSlug · recoverSlug · auto-register drive 가
 *    `ctaRepairPendingState` 하나로 HOLD 한다 — 판정 · lease · probe · Chrome · 전송 · 회수 · 재생성 · QA · 등록 · 쓰기 0.
 *
 * 🔴 상태는 실제 수리(`repairDraftCta`)를 그 단계에서 멈춰 만든다 — 실제 SIGKILL 이 같은 상태를 남기는 것은
 *    `magazine-draft-cta-repair-check.mjs` R17 이 증명한다. 소비자는 시험 대상 루트의 실제 모듈이다.
 *
 * 반례
 *   P01 journal 뒤 · 떼어 낸 뒤(draft.md 없음) · 설치 뒤 영수증 전 · 영수증 뒤 정리 전 · 외부 writer(RECOVERY_REQUIRED)
 *       각 상태에서 실제 planRun · fetchBatch · fetchSlug(--force · 재생성 패킷 포함) · recoverSlug · drive →
 *       그 slug 만 held/BLOCKED · 구조화 코드 · 판정 · lease · probe · Chrome · 전송 · 회수 · 재생성 · QA · 등록 0 ·
 *       조각 · 외부 writer 바이트 · 영수증 · 장부 불변 · run.json held · 운영 알림에 slug 와 코드
 *   P02 무관한 slug — 같은 회차에서 계속 처리된다 · 계획 결과가 조각 없는 기준 회차와 같다
 *   P03 CTA repair --write 가 lease 안에서 settle 한 뒤 — 조각 0 · 같은 소비자가 정상 경로로 돌아간다
 *   P04 정상 완료 영수증은 조각이 아니다 · legacy · 무관한 slug 의 판정은 pending:false
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeRoot, runCases } from './magazine-direct-topic-forbidden-check.mjs'
import { repairWorld } from './magazine-draft-cta-repair-check.mjs'

const SLUG = 'dtf-direct-01'
const DATE = '2026-10-28'
const NOW = Date.parse('2026-10-28T21:00:00+09:00')
const EXT = '외부 writer 가 쓴 원고\n'
const INVENTORY = () => ({ inventoryDays: 0, counts: { live: 0, scheduled: 0, blocked: 0 } })
const STATES = [
  ['journal:written', 'CTA_REPAIR_PENDING'],
  ['detached', 'CTA_REPAIR_PENDING'],
  ['installed', 'CTA_REPAIR_PENDING'],
  ['receipt:written', 'CTA_REPAIR_PENDING'],
  ['detached+external', 'CTA_REPAIR_RECOVERY_REQUIRED'],
]

const quietly = async (fn) => {
  const log = console.log; const err = console.error
  console.log = () => {}; console.error = () => {}
  try { return await fn() } finally { console.log = log; console.error = err }
}
const mod = (root, rel) => import(pathToFileURL(join(root, rel)).href)

/** 그 단계에서 멈춘 실제 수리 — 조각이 남는다. `+external` 이면 그 뒤 외부 writer 가 canonical 을 차지한다 */
async function pendingWorld(root, state) {
  const w = await repairWorld(root)
  if (state) {
    const stage = state.replace('+external', '')
    assert.throws(() => w.lib.repairDraftCta({ ...w.args, write: true,
      hooks: { fault: (s) => { if (s === stage) throw Object.assign(new Error(`CRASH@${s}`), { code: 'CRASH' }) } } }), /CRASH@/)
    if (state.endsWith('+external')) writeFileSync(w.draftPath, EXT)
  }
  const item = w.args.queue.find((q) => q.slug === SLUG)
  return { ...w, item,
    plan: await mod(root, 'scripts/magazine-producer-plan.mjs'),
    runner: await mod(root, 'scripts/magazine-webui-runner.mjs'),
    autoReg: await mod(root, 'scripts/magazine-auto-register.mjs'),
    notify: await mod(root, 'scripts/magazine-producer-notify.mjs'),
    S: await mod(root, 'scripts/lib/magazine-direct-spec-source.mjs'),
    directSourceDeps: { queue: () => w.args.queue, expectedGraphVersion: () => w.args.expectedGraphVersion, productRoot: () => root } }
}

/** 이 slug 의 모든 바이트 · 영수증 · 장부 · lease — 소비자가 아무것도 쓰거나 지우지 않았는지 본다 */
function snapshot(w) {
  const files = (d) => (existsSync(d) ? readdirSync(d).filter((f) => statSync(join(d, f)).isFile()).sort().map((f) => [f, readFileSync(join(d, f), 'base64')]) : [])
  const qd = dirname(w.quarantinePath)
  const leases = readdirSync(qd).filter((f) => f !== 'quarantine.json' && !f.includes('.')).flatMap((sub) => readdirSync(join(qd, sub)))
  return JSON.stringify({ slug: files(dirname(w.draftPath)), receipts: files(join(w.draftsDir, '_runs', DATE)), ledger: readFileSync(w.quarantinePath, 'utf8'), leases })
}

/** 가짜 ChatGPT — 연결 · 전송 · 대화 열기를 센다 (Chrome · CDP · 네트워크 0) */
function countingBrowser() {
  const m = { connect: 0, send: 0, tab: 0 }
  return { m, deps: { pollMs: 5, stablePolls: 2, timeoutMs: 500, connectTimeoutMs: 200, settleMs: 1,
    ensureTab: async () => { m.tab++; return { ok: true } },
    connect: async () => { m.connect++; throw new Error('연결 금지 — CTA 수리 HOLD 인데 브라우저에 붙었다') } } }
}

function runPlan(w, { runsDir = join(w.root, 'runs'), spy = {} } = {}) {
  const count = (k, fn) => (a) => { if ((a?.queueItem?.slug ?? a?.slug) === SLUG) spy[k] = (spy[k] ?? 0) + 1; return fn(a) }
  const out = w.plan.planRun({ today: DATE, now: NOW, runsDir, draftsDir: w.draftsDir,
    loadArticlesFn: () => [], loadQueueFn: () => structuredClone(w.args.queue), inventoryFn: INVENTORY,
    quarantinePath: w.quarantinePath, heroExists: () => false, log: () => {},
    productGraphVersionFn: () => w.args.expectedGraphVersion,
    directSourceFn: count('judge', (a) => w.S.verifyDirectSpecIdentity({ ...a, repoRoot: w.root, productRoot: w.root })),
    leaseFn: count('lease', () => { throw new Error('plan 이 CTA HOLD slug 의 lease 를 잡았다') }) })
  return { out, run: JSON.parse(readFileSync(join(runsDir, DATE, 'run.json'), 'utf8')), runsDir, spy }
}

/** 회수 회차 — 이 slug 와 무관한 slug 하나를 같이 싣는다 */
function writeFetchRun(w, unrelated) {
  const dir = join(w.draftsDir, '_runs', DATE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), `${JSON.stringify({ status: 'COMPLETED', inventoryDays: 0, selected: [w.item, unrelated], reusable: [] }, null, 2)}\n`)
}
/** 무관한 direct 행 — spec 이 없어 전송 관문이 그 slug 만 막는다(probe 0). 회차가 CTA HOLD 로 통째 멈추지 않는지 본다 */
const unrelatedItem = (w) => ({ ...w.item, slug: 'dtf-unrelated-02', title: '무관한 다른 글' })

export function pendingCases({ root = () => makeRoot() } = {}) {
  return [
    ['P01 조각이 남은 네 단계 + 외부 writer — 실제 planRun · fetchBatch · fetchSlug · recoverSlug · drive 가 그 slug 만 HOLD · 전송 · 쓰기 0 · 조각 불변 · run.json · 알림에 코드', async () => {
      for (const [state, code] of STATES) {
        const w = await pendingWorld(root(), state)
        const p = w.lib.ctaRepairPendingState({ draftsDir: w.draftsDir, slug: SLUG })
        assert.equal(p.code, code, `${state}: 판정 ${p.code} ${p.why}`)
        const before = snapshot(w)
        if (state === 'detached') assert.equal(existsSync(w.draftPath), false, '반례 준비 실패 — draft.md 가 있다')

        // ── producer plan ──
        const pl = runPlan(w)
        const h = pl.run.held.find((x) => x.slug === SLUG)
        assert.equal(h?.code, code, `${state}: plan held ${JSON.stringify(h)}`)
        assert.deepEqual(h.ctaRepair?.fragments, p.fragments)
        assert.equal(pl.run.selected.some((x) => x.slug === SLUG) || pl.run.reusable.some((x) => x.slug === SLUG), false, `${state}: plan 이 선정 · 재사용했다`)
        assert.equal(existsSync(join(pl.runsDir, DATE, 'selected', SLUG)), false, `${state}: TODO 패키지를 썼다`)
        assert.equal(pl.spy.judge ?? 0, 0, `${state}: plan 이 direct 판정을 돌렸다`); assert.equal(pl.spy.lease ?? 0, 0)
        const alert = w.notify.composeDirectHoldAlert(pl.run)
        assert.ok(alert && alert.reason.includes(SLUG) && alert.reason.includes(code), `${state}: 운영 알림에 slug · 코드가 없다 ${JSON.stringify(alert)}`)
        assert.equal(snapshot(w), before, `${state}: plan 이 조각 · 원고 · 장부를 바꿨다`)

        // ── fetchBatch ──
        writeFetchRun(w, unrelatedItem(w))
        const before2 = snapshot(w)
        const fb = countingBrowser(); let probes = 0
        const rp = join(w.root, 'fetch-result.json')
        const out = await quietly(() => w.runner.fetchBatch({ date: DATE, dryRun: false, draftsDir: w.draftsDir, resultPath: rp, quarantinePath: w.quarantinePath,
          probeFn: async () => { probes++; throw new Error('probe 금지') }, browserDeps: fb.deps, directSourceDeps: w.directSourceDeps }))
        const row = out.results.find((x) => x.slug === SLUG)
        assert.equal(row?.status, 'held', `${state}: fetchBatch ${JSON.stringify(row)}`); assert.equal(row.reason, code); assert.equal(row.stage, 'cta-repair'); assert.equal(row.sent, false)
        assert.equal(out.planned.find((x) => x.slug === SLUG)?.action, 'hold:cta_repair')
        assert.equal(probes, 0); assert.equal(fb.m.connect + fb.m.send + fb.m.tab, 0); assert.equal(out.sentTotal, 0)
        assert.ok(out.results.some((x) => x.slug === 'dtf-unrelated-02' && x.reason !== code), `${state}: 무관한 slug 를 처리하지 않았다`)
        assert.equal(JSON.parse(readFileSync(rp, 'utf8')).results.find((x) => x.slug === SLUG)?.reason, code, '회수 결과 파일에 구조화 코드가 없다')
        assert.equal(snapshot(w), before2, `${state}: fetchBatch 가 바꿨다`)

        // ── fetchSlug (수동 단건 · --force · 재생성 패킷도 우회 못 한다) ──
        for (const extra of [{}, { force: true }, { regenPacket: join(w.root, 'no-such-packet.json') }]) {
          const fs1 = countingBrowser(); let access = 0
          const r = await quietly(() => w.runner.fetchSlug(SLUG, { draftsDir: w.draftsDir, quarantinePath: w.quarantinePath, browserDeps: fs1.deps,
            accessFn: async () => { access++; return { status: 'OK' } }, queueItem: w.item, directSourceDeps: w.directSourceDeps, ...extra }))
          assert.equal(r.status, 'held', `${state} ${JSON.stringify(extra)}: fetchSlug ${JSON.stringify(r).slice(0, 200)}`); assert.equal(r.reason, code); assert.equal(r.sent, false)
          assert.equal(access + fs1.m.connect + fs1.m.send + fs1.m.tab, 0)
        }
        // fetchOne(CLI 경로)도 같은 판정 — 종료 코드 1
        const one = await quietly(() => w.runner.fetchOne(SLUG, { force: true, quarantinePath: w.quarantinePath, draftsDir: w.draftsDir, queueItem: w.item,
          directSourceDeps: w.directSourceDeps, probeFn: async () => { throw new Error('probe 금지') }, browserDeps: countingBrowser().deps, exit: () => {} }))
        assert.equal(one.exitCode, 1); assert.equal(one.result.reason, code)

        // ── recoverSlug ──
        const rb = countingBrowser(); let raccess = 0
        const rr = await quietly(() => w.runner.recoverSlug(SLUG, { conversationUrl: 'https://chatgpt.com/c/0d5f48aa-0000-4000-8000-0000000000c1', date: DATE,
          resultPath: rp, quarantinePath: w.quarantinePath, draftsDir: w.draftsDir, browserDeps: rb.deps, accessFn: async () => { raccess++; return { status: 'OK' } },
          directSourceDeps: w.directSourceDeps }))
        assert.equal(rr.status, 'held', `${state}: recoverSlug ${JSON.stringify(rr).slice(0, 200)}`); assert.equal(rr.reason, code)
        assert.equal(raccess + rb.m.connect + rb.m.send + rb.m.tab, 0)

        // ── auto-register drive ──
        const calls = { queue: 0, run: 0, regen: 0, apply: 0 }
        const d = w.autoReg.drive(SLUG, { write: true, publishAt: '2026-10-30', autoLane: true }, {
          draftsDir: w.draftsDir, quarantinePath: w.quarantinePath, queueItem: w.item,
          loadQueue: () => { calls.queue++; return w.args.queue }, run: () => { calls.run++; return { code: 0, stdout: '', stderr: '' } },
          attemptRegeneration: () => { calls.regen++; return { ok: false } }, regenRunner: () => { calls.regen++; return { ok: false } },
          applyRegenCandidate: () => { calls.apply++; return { ok: false } }, heroFilePath: () => join(w.root, 'hero.webp'),
          progress: () => ({ hasDraftMd: true }), now: NOW })
        assert.equal(d.verdict, 'BLOCKED'); assert.equal(d.held, true, `${state}: drive 가 HOLD 로 표시하지 않았다 (시도 · 장부를 쓴다)`)
        assert.equal(d.blockedBy[0].code, code, JSON.stringify(d.blockedBy)); assert.deepEqual(d.blockedBy[0].ctaRepair?.fragments, p.fragments)
        assert.deepEqual(calls, { queue: 0, run: 0, regen: 0, apply: 0 }, `${state}: drive 가 하위 단계를 불렀다`)

        assert.equal(snapshot(w), before2, `${state}: 소비자가 조각 · 원고 · 영수증 · 장부 · lease 를 바꿨다`)
        if (state.endsWith('+external')) assert.equal(readFileSync(w.draftPath, 'utf8'), EXT)
      }
    }],
    ['P02 무관한 slug — 조각 없는 기준 회차와 계획 결과가 같다 (CTA HOLD 는 그 slug 만 뺀다)', async () => {
      const base = runPlan(await pendingWorld(root(), null))
      const pend = runPlan(await pendingWorld(root(), 'detached'))
      const others = (run, key) => JSON.stringify(run[key].filter((x) => x.slug !== SLUG).map((x) => ({ ...x, why: undefined })))
      for (const key of ['selected', 'reusable', 'held', 'skipped']) assert.equal(others(pend.run, key), others(base.run, key), `${key} 가 기준 회차와 다르다`)
      assert.ok(base.run.reusable.some((x) => x.slug === SLUG), '기준 회차에서 이 slug 가 재사용 후보가 아니다 — 반례 준비 실패')
      assert.ok(pend.run.selected.length + pend.run.held.length > 1, '무관한 행이 없다 — 반례 준비 실패')
    }],
    ['P03 CTA repair --write 가 lease 안에서 settle 한 뒤 — 조각 0 · 같은 소비자가 정상 경로로 돌아간다', async () => {
      for (const [state] of STATES.filter(([s]) => !s.endsWith('+external'))) {
        const w = await pendingWorld(root(), state)
        const r = w.lib.repairDraftCta({ ...w.args, write: true })
        assert.equal(r.ok, true, `${state}: ${r.code} ${r.why}`)
        assert.deepEqual(w.lib.ctaRepairPendingState({ draftsDir: w.draftsDir, slug: SLUG }), { pending: false })
        const pl = runPlan(w, { runsDir: join(w.root, 'runs-after') })
        assert.ok(pl.run.reusable.some((x) => x.slug === SLUG), `${state}: settle 뒤 재사용 후보로 돌아오지 않았다 ${JSON.stringify(pl.run.held.find((x) => x.slug === SLUG))}`)
        const fs1 = countingBrowser()
        const f = await quietly(() => w.runner.fetchSlug(SLUG, { draftsDir: w.draftsDir, quarantinePath: w.quarantinePath, browserDeps: fs1.deps,
          accessFn: async () => ({ status: 'OK' }), queueItem: w.item, directSourceDeps: w.directSourceDeps }))
        assert.equal(f.status, 'skipped', `${state}: ${JSON.stringify(f).slice(0, 200)}`); assert.equal(f.reason, 'draft_exists')
        const d = w.autoReg.drive(SLUG, { write: false, publishAt: '2026-10-30', autoLane: true }, {
          draftsDir: w.draftsDir, quarantinePath: w.quarantinePath, queueItem: w.item, loadQueue: () => w.args.queue,
          run: () => ({ code: 1, stdout: '', stderr: '' }), heroFilePath: () => join(w.root, 'hero.webp'), progress: () => ({ hasDraftMd: true }), now: NOW })
        assert.equal(d.blockedBy.some((x) => String(x.code).startsWith('CTA_REPAIR')), false, `${state}: settle 뒤에도 drive 가 CTA HOLD 다`)
        assert.ok(d.steps.some((s) => s.stage === 'gate' && s.status === 'ok'), `${state}: drive 가 gate 를 지나지 않았다 ${JSON.stringify(d.blockedBy)}`)
      }
    }],
    ['P04 정상 완료 영수증은 조각이 아니다 · 조각 없는 slug · legacy slug 는 pending:false', async () => {
      const w = await pendingWorld(root(), null)
      assert.deepEqual(w.lib.ctaRepairPendingState({ draftsDir: w.draftsDir, slug: SLUG }), { pending: false })
      const r = w.lib.repairDraftCta({ ...w.args, write: true }); assert.equal(r.ok, true, r.why)
      assert.ok(existsSync(r.receiptPath))
      assert.deepEqual(w.lib.ctaRepairPendingState({ draftsDir: w.draftsDir, slug: SLUG }), { pending: false }, '완료 영수증을 조각으로 읽었다')
      assert.deepEqual(w.lib.ctaRepairPendingState({ draftsDir: w.draftsDir, slug: 'legacy-no-such-dir' }), { pending: false })
      // 조각 하나만 있어도(journal 없음) RECOVERY_REQUIRED — 판정은 읽기만 한다
      writeFileSync(join(dirname(w.draftPath), '.cta-repair.new'), 'x')
      const p = w.lib.ctaRepairPendingState({ draftsDir: w.draftsDir, slug: SLUG })
      assert.equal(p.code, 'CTA_REPAIR_RECOVERY_REQUIRED'); assert.equal(readFileSync(join(dirname(w.draftPath), '.cta-repair.new'), 'utf8'), 'x')
    }],
  ]
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const r = await runCases(pendingCases())
  console.log(`\nCTA 수리 진행 중 slug 전 경로 HOLD 검사: ${r.pass} pass, ${r.fail} fail`)
  if (r.fail) process.exitCode = 1
}
