/**
 * Magazine vNext S4 — 생산기 (runbook §0.0B.1 Job · §0.0B.2 provider · §0.0B.3 검증 · §0.0B.9 실패 범위).
 *
 *   main(origin/main 바이트) → compile → admission → 후보 선택(targetCandidates 까지) → ProviderPlan
 *     → 원고 요청(background) → bounded polling → 응답 바이트 원자 저장 → 해시 → DELETE → 확인 기록
 *     → 결정론적 검증(FIXED 결정 삽입 · 칸/문장 수리 ≤2곳 · 전체 재생성 ≤1회) → hero 1장(16:9 · 실패 시 이미지만 1회 더)
 *     → magazine-job/1 (VALID · HERO_READY) — release writer(lib/magazine-release-candidates.mjs)가 읽는다
 *
 * 불변조건(§0.0B.1): planHash 당 진행 중 요청 ≤1 · 최종 채택 원고 1개 · 비용 상한 안.
 * 🔴 같은 요청 키는 한 번만 생긴다(O_EXCL). 전송 여부가 불명(SUBMISSION_UNKNOWN)이면 그 회차에 다시 보내지 않는다 —
 *    저장한 응답 바이트로 ID 를 되찾고, 못 찾으면 확인 창(reconcileAfterMs)이 지난 뒤에만 회수 불능으로 확정해 재생성 1회.
 * 🔴 상한을 넘을 요청은 보내지 않는다 — 전송 전 최악 추정치로 판정하고, 실제 usage 가 없으면 추정치를 그대로 센다.
 * 🔴 provider · 시계 · sleep · 파일 · main 판독은 전부 deps 로 받는다(fake 와 실제가 같은 경로를 지난다).
 * 🔴 이 모듈은 legacy(queue writer · register · 웹 UI 회수 · 격리 장부 · drafts)를 import 하지 않는다.
 */
import * as nodeFs from 'node:fs'
import { canonicalJson } from './magazine-content-plan-input.mjs'
import { admitContentPlans, compileContentPlans, parseArticleIdentityText, projectProviderPlan, providerPlanProblems } from './magazine-content-plan.mjs'
import { parseArticleRecordText } from './magazine-release.mjs'
import {
  JOB_SCHEMA, MAX_REQUESTS, acquireProduceLock, addEvent, artifactExists, createJob, createRequestKey, jobCostUsd, jobDirOf, jobState, kstMonthOf,
  listJobs, monthCostUsd, openRequestOf, readArtifact, readJob, sha256, stageCostUsd, writeArtifact, writeJob,
} from './magazine-job.mjs'
import {
  LIVE_TEXT_RATES, actualCostUsd, buildImageBody, buildManuscriptBody, buildRepairBody, estimateCostUsd, parseManuscriptText, parseRepairText, parseWire,
  imageUsageCost, readImage, readSubmit, readTerminal,
} from './magazine-provider.mjs'
import { QA_ID, REPAIR_LIMITS, applyFixedRepairs, applyReplacement, articleFromManuscript, claimRulesOf, repairTargetsOf, validateArticle } from './magazine-vnext-qa.mjs'
import { HERO_DUP_DISTANCE, dHash, heroFromSource, nearestHero } from './magazine-vnext-hero.mjs'
import { HERO_HEIGHT, HERO_WIDTH } from './magazine-qa-constants.mjs'

export const PRODUCE_SCHEMA = 'magazine-vnext-produce/1'
/** 예산(2026-11-03 · 11-09 창업자 결정) — 편당 hard cap · pilot 월 hard cap · S5 canary 총액 */
export const BUDGET_USD = Object.freeze({ article: 1, month: 30, canary: 5 })
export const PRODUCE_LIMITS = Object.freeze({
  imageAttempts: 2, pollIntervalMs: 15_000, pollOccupancyMs: 4 * 60_000, zdrWindowMs: 10 * 60_000,
  reconcileAfterMs: 15 * 60_000, pollErrorMax: 8, rejectRetryMs: 30 * 60_000, deleteNoticeAfter: 3, stepsPerJob: 30,
})
export const STAGES = Object.freeze(['S5_CANARY', 'S6_COMMISSIONING', 'PILOT', 'REHEARSAL'])
/** 회차가 막힌 것이 아닌 결과 */
export const OK_OUTCOMES = Object.freeze(['NOT_VNEXT', 'PLAN_ONLY', 'RAN', 'PRODUCE_LOCK_HELD', 'MONTH_CAP_REACHED', 'CANARY_CAP_REACHED'])

/** 예산 상한 정지는 새 호출만 막는다 — 이미 보낸 요청의 조회 · 저장 · 삭제는 계속한다. 그 밖의 정지(AUTH · 계약 충돌 · 단가 없음)는 전부 멈춘다 */
const halted = (ctx) => Boolean(ctx.stop) && !['MONTH_CAP_REACHED', 'CANARY_CAP_REACHED'].includes(ctx.stop.code)
const COUNTED = (r) => !r.retired && !['NOT_SENT', 'REJECTED'].includes(r.status)
const manuscriptCount = (job) => job.requests.filter((r) => r.kind === 'manuscript' && COUNTED(r)).length
const repairCount = (job) => job.requests.filter((r) => r.kind === 'repair' && COUNTED(r)).length
const imageCount = (job) => job.requests.filter((r) => r.kind === 'image' && COUNTED(r)).length

// ── 선택 ─────────────────────────────────────────────────────

/** 관계가 많은 plan 먼저 · 진행 중 Job 과 다른 cluster 우선 · 동률은 planId (결정적) */
function orderCandidates(cands, usedClusters) {
  const left = [...cands].sort((a, b) => b.relatedCount - a.relatedCount || (a.planId < b.planId ? -1 : 1))
  const out = [], used = new Set(usedClusters)
  while (left.length) {
    const i = Math.max(0, left.findIndex((c) => !used.has(c.cluster)))
    const [c] = left.splice(i, 1)
    out.push(c); used.add(c.cluster)
  }
  return out
}

// ── 회차 ─────────────────────────────────────────────────────

/**
 * @param {{ deps: object, mode: 'plan'|'run' }} p
 *   deps.jobsRoot · deps.now() · deps.sleep(ms) · deps.runId · deps.readRollout() · deps.readMain() · deps.provider(run 만) · deps.stage
 *   deps.publishedHeroes() → [{ name, bytes }] · deps.hooks?.at(point, ctx)(시험용 급사 주입) · deps.limits(시험용) · deps.fs
 */
export async function runProduce({ deps, mode }) {
  const fs = deps.fs ?? nodeFs
  const L = { ...PRODUCE_LIMITS, ...(deps.limits ?? {}) }
  const report = { schemaVersion: PRODUCE_SCHEMA, mode, at: new Date(deps.now()).toISOString(), runId: deps.runId, provider: deps.provider?.kind ?? null,
    stage: deps.stage ?? null, rollout: null, baseSha: null, graphVersion: null, selected: [], jobs: [], notices: [], calls: { submit: 0, retrieve: 0, remove: 0, image: 0 }, stop: null, outcome: null }
  const ro = deps.readRollout()
  report.rollout = { code: ro.code, ...ro.effective }
  if (!(ro.code === 'VALID' && ro.effective.path === 'vnext')) return { ...report, outcome: 'NOT_VNEXT' }
  const main = deps.readMain()
  if (!main?.ok) return { ...report, outcome: 'MAIN_UNREADABLE', stop: { code: main?.code ?? 'MAIN_UNREADABLE', why: main?.why ?? null } }
  report.baseSha = main.baseSha ?? null
  let compiled
  try { compiled = compileContentPlans({ bundle: main.bundle }) } catch (e) {
    if (typeof e?.code === 'string') return { ...report, outcome: 'BUNDLE_HOLD', stop: { code: `BUNDLE_${e.code}`, why: e.why ?? e.message } }
    throw e
  }
  report.graphVersion = compiled.graphVersion
  const identity = parseArticleIdentityText(main.articlesText)
  const record = parseArticleRecordText(main.articlesText)
  if (!identity.ok || !record.ok) return { ...report, outcome: 'MAIN_UNREADABLE', stop: { code: 'ARTICLES_UNREADABLE', why: identity.code ?? record.code } }
  const releasedIntents = new Set(identity.rows.filter((r) => r.release).map((r) => r.release.intentId))
  const published = Object.entries(record.record).map(([slug, a]) => ({ slug, title: a.title, description: a.description }))
  const admissionBase = { bundle: main.bundle, controlText: main.controlText, articlesText: main.articlesText, legacyQueue: main.legacyQueue, nowMs: deps.now() }

  // 후보 — 이미 Job 이 있는 intent(어느 상태든 · HOLD 포함)는 IN_FLIGHT 로 다시 고르지 않는다(자동 재생성 0)
  const existing = listJobs(deps.jobsRoot, { fs })
  const unreadable = existing.find(({ job }) => job.broken || job.requests.some(r =>
    !Number.isFinite(r.costUsd) || r.costUsd < 0 || !Number.isFinite(Date.parse(r.createdAt))))
  if (unreadable) return { ...report, outcome: 'COST_LEDGER_UNREADABLE', stop: { code: 'COST_LEDGER_UNREADABLE', planHash: unreadable.planHash } }
  const jobIntents = existing.map((x) => x.job.intentId).filter(Boolean)
  const adm = admitContentPlans({ ...admissionBase, inFlightIntentIds: jobIntents })
  const cands = []
  for (const a of adm.admitted) {
    const plan = compiled.plans.find((p) => p.planId === a.planId)
    const pp = projectProviderPlan({ admission: admissionBase, planId: plan.planId, planHash: plan.planHash })
    const claims = claimRulesOf(plan)
    cands.push({ planId: plan.planId, planHash: plan.planHash, intentId: plan.intentId, cluster: plan.cluster, relatedCount: a.relatedPublic.length,
      providerPlanHash: pp.providerPlanHash, problems: [...new Set(pp.problems.map((p) => p.code))], unmappedClaims: claims.unmapped })
  }
  const active = existing.filter(({ job }) => !job.hold && !releasedIntents.has(job.intentId))
  const ordered = orderCandidates(cands.filter((c) => !c.problems.length && !c.unmappedClaims.length), active.map(({ job }) => job.cluster))
  const slots = Math.max(0, ro.effective.targetCandidates - active.length)
  report.selected = ordered.slice(0, slots).map(({ planId, intentId, cluster, providerPlanHash }) => ({ planId, intentId, cluster, providerPlanHash }))
  report.held = cands.filter((c) => c.problems.length || c.unmappedClaims.length).map((c) => ({ planId: c.planId, problems: c.problems, unmappedClaims: c.unmappedClaims }))

  if (mode === 'plan') {
    report.jobs = existing.map(({ job }) => summaryOf(job))
    return { ...report, outcome: 'PLAN_ONLY' }
  }
  if (!deps.provider) throw new Error('run 모드에는 provider 가 필요하다')
  const lock = acquireProduceLock({ jobsRoot: deps.lockRoot ?? deps.jobsRoot, fs, nowIso: report.at })
  if (!lock.ok) return { ...report, outcome: 'PRODUCE_LOCK_HELD', stop: { code: lock.code, why: lock.why } }
  const ctx = { deps, fs, L, report, compiled, admissionBase, published, releasedIntents, stop: null, notified: new Set() }
  try {
    for (const { planHash } of listJobs(deps.jobsRoot, { fs })) { if (halted(ctx)) break; await advanceJob(ctx, planHash) }
    for (const c of ordered.slice(0, slots)) {
      if (ctx.stop) break
      const plan = compiled.plans.find((p) => p.planId === c.planId)
      const nowIso = iso(ctx)
      if (readJob(deps.jobsRoot, plan.planHash, { fs })) continue
      createJob(deps.jobsRoot, { schemaVersion: JOB_SCHEMA, planId: plan.planId, planHash: plan.planHash, intentId: plan.intentId, cluster: plan.cluster,
        graphVersion: plan.graphVersion, providerPlanHash: c.providerPlanHash, contractHash: null, provider: { kind: deps.provider.kind, models: deps.provider.models },
        stage: deps.stage, slugProposal: null, heroScene: null, requests: [], draft: null, manuscript: null, validation: null, hero: null, hold: null,
        events: [{ code: 'JOB_CREATED', at: nowIso, runId: deps.runId }], reruns: [], createdAt: nowIso, updatedAt: nowIso }, { fs })
      await advanceJob(ctx, plan.planHash)
    }
  } finally { lock.release() }
  report.jobs = listJobs(deps.jobsRoot, { fs }).map(({ job }) => summaryOf(job))
  report.stop = ctx.stop
  return { ...report, outcome: ctx.stop?.outcome ?? 'RAN' }
}

const iso = (ctx) => new Date(ctx.deps.now()).toISOString()
const hook = async (ctx, point, info) => { await ctx.deps.hooks?.at?.(point, info) }
const notice = (ctx, code, info = {}) => { const k = `${code}:${info.planHash ?? ''}`; if (ctx.notified.has(k)) return; ctx.notified.add(k); ctx.report.notices.push({ code, ...info }) }

function summaryOf(job) {
  return { planHash: job.planHash, planId: job.planId, intentId: job.intentId, cluster: job.cluster, state: jobState(job), hold: job.hold ?? null,
    costUsd: Number(jobCostUsd(job).toFixed(6)), requests: job.requests.length, manuscript: job.manuscript?.sha256 ?? null, hero: job.hero?.sha256 ?? null,
    providerPlanHash: job.providerPlanHash, slugProposal: job.slugProposal }
}

function save(ctx, job) { return writeJob(ctx.deps.jobsRoot, job, { fs: ctx.fs, nowIso: iso(ctx) }) }
function event(ctx, job, code, info = {}) { return addEvent(job, { code, at: iso(ctx), ...info }) }
function hold(ctx, job, reason, detail = null) {
  const next = save(ctx, event(ctx, { ...job, hold: { reason, detail, at: iso(ctx) } }, 'HOLD', { reason, detail }))
  notice(ctx, 'JOB_HOLD', { planHash: job.planHash, reason })
  return next
}
const setRequest = (job, n, patch) => ({ ...job, requests: job.requests.map((r) => (r.n === n ? { ...r, ...patch } : r)) })
const reqOf = (job, n) => job.requests.find((r) => r.n === n)

/** 지금 main 으로 다시 만든 ProviderPlan — 자기 intent 는 진행 중으로 세지 않는다(release 가 대조하는 값과 같은 입력) */
function providerPlanOf(ctx, job) {
  const plan = ctx.compiled.plans.find((p) => p.planId === job.planId)
  if (!plan) return { ok: false, code: 'PLAN_NOT_COMPILED' }
  const pp = projectProviderPlan({ admission: ctx.admissionBase, planId: job.planId, planHash: job.planHash })
  if (!pp.ok) return { ok: false, code: pp.problems.some((p) => p.code === 'PLAN_STALE') ? 'PLAN_STALE' : 'PROVIDER_PLAN_HOLD', detail: [...new Set(pp.problems.map((p) => p.code))].join('+') }
  const providerPlan = ctx.deps.mutateProviderPlan ? ctx.deps.mutateProviderPlan(structuredClone(pp.providerPlan)) : pp.providerPlan // 시험용 — 투영 회귀 주입
  return { ok: true, plan, providerPlan, providerPlanHash: pp.providerPlanHash }
}

// ── Job 한 편 진행 ───────────────────────────────────────────

async function advanceJob(ctx, planHash) {
  const { deps } = ctx
  let job = readJob(deps.jobsRoot, planHash, { fs: ctx.fs })
  if (!job || job.broken) { ctx.report.notices.push({ code: 'JOB_UNREADABLE', planHash, why: job?.why ?? 'MISSING' }); return }
  for (let step = 0; step < ctx.L.stepsPerJob; step++) {
    if (halted(ctx)) return
    if (job.hold || ctx.releasedIntents.has(job.intentId)) {
      await sweepDeletes(ctx, job)
      return
    }
    const open = openRequestOf(job)
    if (open) {
      const r = await settleRequest(ctx, job, open)
      job = r.job
      if (r.pending) return
      continue
    }
    const unconsumed = job.requests.find((r) => !r.consumed && !r.retired && ['COMPLETED', 'FAILED', 'UNRECOVERABLE', 'REJECTED', 'NOT_SENT'].includes(r.status))
    if (unconsumed) {
      if (unconsumed.status === 'REJECTED' && Date.parse(unconsumed.retryAfter) > deps.now()) return // 거절(429) — 정해진 시각까지 기다린다
      job = await consume(ctx, job, unconsumed)
      continue
    }
    job = await sweepDeletes(ctx, job)
    if (ctx.stop) return
    const pp = providerPlanOf(ctx, job)
    if (!pp.ok) { if (!job.manuscript) job = hold(ctx, job, pp.code, pp.detail ?? null); return }
    if (pp.providerPlanHash !== job.providerPlanHash) {
      // 아직 아무 원고도 받지 않은 Job(새 Job · rerun all 직후)만 지금 입력으로 다시 묶는다. 원고가 있으면 그 원고가 어떤 입력으로 쓰였는지 설명할 수 없다 → HOLD
      if (job.draft || job.manuscript || manuscriptCount(job) || repairCount(job)) { job = hold(ctx, job, 'PROVIDER_PLAN_DRIFT', `기록 ${String(job.providerPlanHash).slice(0, 12)} ≠ 지금 ${pp.providerPlanHash.slice(0, 12)}`); return }
      job = save(ctx, event(ctx, { ...job, providerPlanHash: pp.providerPlanHash }, 'PROVIDER_PLAN_REBOUND', { providerPlanHash: pp.providerPlanHash }))
    }

    if (job.validation?.verdict === 'VALID' && job.manuscript) {
      if (deps.stage === 'S5_CANARY' && deps.manuscriptOnly) return
      if (job.hero) return // HERO_READY — release 가 가져간다
      const h = await heroStep(ctx, job, pp)
      job = h.job
      if (h.stopJob) return
      continue
    }
    if (!job.draft) {
      if (manuscriptCount(job) >= 1 + REPAIR_LIMITS.regenerations) { job = hold(ctx, job, job.lastFailure ?? 'QA_REGEN_EXHAUSTED'); return }
      const body = buildManuscriptBody({ providerPlan: pp.providerPlan, model: deps.provider.models.manuscript, maxOutputTokens: deps.provider.maxOutputTokens })
      const s = await submit(ctx, job, pp, { kind: 'manuscript', purpose: manuscriptCount(job) === 0 ? 'INITIAL' : 'REGENERATE', ...body, maxOutputTokens: deps.provider.maxOutputTokens })
      job = s.job
      if (s.stopJob) return
      continue
    }
    // 원고 판정 — 같은 검증기로 매번 다시 본다
    const article = JSON.parse(readArtifact(deps.jobsRoot, planHash, job.draft.file, { fs: ctx.fs }).toString('utf8'))
    const v = validateArticle({ article, plan: pp.plan, published: ctx.published })
    const fixable = v.issues.filter((i) => i.class === 'FIXED')
    if (v.verdict !== 'VALID' && fixable.length) {
      const f = applyFixedRepairs(article, v.issues, pp.plan)
      if (f.blocked) { job = hold(ctx, job, f.blocked); return }
      if (f.applied.length) { job = writeDraft(ctx, event(ctx, job, 'FIXED_APPLIED', { codes: f.applied }), f.article, 'f'); continue }
    }
    if (v.verdict === 'VALID') {
      const bytes = `${JSON.stringify(article, null, 2)}\n`
      const m = writeArtifact(deps.jobsRoot, planHash, 'manuscript.json', bytes, { fs: ctx.fs })
      job = save(ctx, event(ctx, { ...job, manuscript: m, validation: { verdict: 'VALID', qa: QA_ID, at: iso(ctx), warnings: v.warnings, repairs: repairCount(job), regenerations: Math.max(0, manuscriptCount(job) - 1) } }, 'VALID', { sha256: m.sha256 }))
      continue
    }
    const codes = [...new Set(v.issues.map((i) => i.code))].sort()
    if (v.verdict === 'REGENERATE') {
      if (manuscriptCount(job) >= 1 + REPAIR_LIMITS.regenerations) { job = hold(ctx, job, 'QA_REGEN_EXHAUSTED', codes.join('+')); return }
      job = save(ctx, event(ctx, { ...job, draft: null, validation: { verdict: 'REGENERATE', issues: codes, at: iso(ctx) }, lastFailure: 'QA_REGEN_EXHAUSTED' }, 'REGENERATE', { codes }))
      continue
    }
    // NEEDS_REPAIR — 칸 · 문장 수리 (부분 수리 최대 2곳)
    const targets = repairTargetsOf(v.issues, article)
    const left = REPAIR_LIMITS.places - repairCount(job)
    if (targets.length > left) {
      if (manuscriptCount(job) >= 1 + REPAIR_LIMITS.regenerations) { job = hold(ctx, job, 'QA_REPAIR_EXHAUSTED', codes.join('+')); return }
      job = save(ctx, event(ctx, { ...job, draft: null, validation: { verdict: 'REGENERATE', issues: codes, at: iso(ctx) }, lastFailure: 'QA_REPAIR_EXHAUSTED' }, 'REPAIR_TO_REGENERATE', { codes, places: targets.length, left }))
      continue
    }
    const target = targets[0]
    const body = buildRepairBody({ providerPlan: pp.providerPlan, target, model: deps.provider.models.manuscript, maxOutputTokens: deps.provider.repairMaxOutputTokens })
    job = save(ctx, { ...job, validation: { verdict: 'NEEDS_REPAIR', issues: codes, at: iso(ctx) } })
    const s = await submit(ctx, job, pp, { kind: 'repair', purpose: 'REPAIR', ...body, maxOutputTokens: deps.provider.repairMaxOutputTokens, target })
    job = s.job
    if (s.stopJob) return
  }
  ctx.report.notices.push({ code: 'STEP_LIMIT', planHash })
}

function writeDraft(ctx, job, article, tag) {
  const k = (job.draftSeq ?? 0) + 1
  const d = writeArtifact(ctx.deps.jobsRoot, job.planHash, `draft-${tag}${k}.json`, `${JSON.stringify(article, null, 2)}\n`, { fs: ctx.fs })
  return save(ctx, { ...job, draftSeq: k, draft: d, validation: null })
}

// ── 전송 ─────────────────────────────────────────────────────

/** 상한 판정 — 편당 · 월 · canary. 넘으면 보내지 않는다 */
// 첫 canary 두 건에는 캐시 쓰기 단가가 없었다. 보관한 응답 바이트로 재산정해 예산에 포함한다.
function budgetJobs(ctx, root) {
  const fs = ctx.fs
  const entries = listJobs(root, { fs })
  for (const { job, planHash } of entries) {
    if (job.broken || job.provider?.kind !== 'openai') continue
    for (const r of job.requests) {
      if (r.kind === 'image' || r.costBasis !== 'ACTUAL' || r.textRates?.cached !== undefined) continue
      try {
        const bytes = readArtifact(root, planHash, r.raw.final.file, { fs })
        const prices = LIVE_TEXT_RATES[job.provider.models.manuscript]
        if (!prices || sha256(bytes) !== r.raw.final.sha256) throw Error('응답 원본 또는 단가 미확인')
        r.costUsd = actualCostUsd({ usage: readTerminal(parseWire(bytes.toString('utf8'))).usage, prices })
      } catch { r.costUsd = null }
    }
  }
  return entries
}

function budgetBlock(ctx, job, estimateUsd) {
  const roots = ctx.deps.readBudgetRoots?.() ?? ctx.deps.budgetRoots ?? [ctx.deps.jobsRoot]
  const all = roots.flatMap(root => budgetJobs(ctx, root))
  if (!Number.isFinite(estimateUsd) || estimateUsd < 0 || all.some(({ job: entry }) => entry.broken ||
    entry.requests.some(r => !Number.isFinite(r.costUsd) || r.costUsd < 0 || !Number.isFinite(Date.parse(r.createdAt)) ||
      ['RESERVED_NO_USAGE', 'ESTIMATE_NO_USAGE'].includes(r.costBasis)))) {
    return { scope: 'ALL', code: 'COST_LEDGER_UNREADABLE', detail: '앞선 요청의 비용을 대조할 때까지 신규 호출 보류' }
  }
  const spentJob = all.filter(x => x.planHash === job.planHash).reduce((sum, x) => sum + jobCostUsd(x.job), 0)
  if (spentJob + estimateUsd > BUDGET_USD.article) return { scope: 'JOB', code: 'COST_CAP_ARTICLE', detail: `편당 $${BUDGET_USD.article}: 쓴 $${spentJob.toFixed(4)} + 이번 최악 $${estimateUsd.toFixed(4)}` }
  const month = monthCostUsd(all, kstMonthOf(iso(ctx)))
  if (month + estimateUsd > BUDGET_USD.month) return { scope: 'ALL', code: 'MONTH_CAP_REACHED', detail: `월 $${BUDGET_USD.month}: $${month.toFixed(4)} + $${estimateUsd.toFixed(4)}` }
  if (ctx.deps.stage === 'S5_CANARY') {
    const canary = stageCostUsd(all, 'S5_CANARY')
    if (canary + estimateUsd > BUDGET_USD.canary) return { scope: 'ALL', code: 'CANARY_CAP_REACHED', detail: `canary $${BUDGET_USD.canary}: $${canary.toFixed(4)} + $${estimateUsd.toFixed(4)}` }
  }
  return null
}

/** 실제로 나갈 바이트에서 ProviderPlan 을 다시 꺼내 같은 관문을 돈다(2차 방어) — 금지 필드 · PII · 기록한 해시와 다름이면 전송 0 */
function sentPlanProblems(kind, bodyText, providerPlanHash) {
  if (kind === 'image') return []
  let pp
  try { const text = JSON.parse(bodyText).input[0].content[0].text; pp = kind === 'repair' ? JSON.parse(text).providerPlan : JSON.parse(text) } catch { return ['SEND_BODY_UNREADABLE'] }
  const codes = [...new Set(providerPlanProblems(pp).map((p) => p.code))]
  if (sha256(canonicalJson(pp)) !== providerPlanHash) codes.push('SEND_PLAN_HASH_MISMATCH')
  return codes
}

/**
 * 요청 하나 — 상한 → 2차 방어 → 요청 키(O_EXCL) → Job 기록(SUBMITTING) → 전송 → 응답 바이트 저장 → 해석.
 * @returns {Promise<{ job: object, stopJob: boolean }>}
 */
async function submit(ctx, job, pp, { kind, purpose, bodyText, contractHash, maxOutputTokens = null, target = null }) {
  const { deps } = ctx
  if (ctx.stop) return { job, stopJob: true } // 정지 뒤 새 호출 0
  const prices = deps.provider.prices
  if (!prices) { ctx.stop = { scope: 'ALL', code: 'PRICE_UNKNOWN', outcome: 'PRICE_UNKNOWN' }; return { job, stopJob: true } }
  if (job.requests.length >= MAX_REQUESTS) return { job: hold(ctx, job, 'REQUEST_LIMIT', `${MAX_REQUESTS}건`), stopJob: true }
  const estimateUsd = kind === 'image' ? prices.image.perImage : estimateCostUsd({ bodyText, maxOutputTokens, prices: prices.manuscript })
  const blocked = budgetBlock(ctx, job, estimateUsd)
  if (blocked?.scope === 'JOB') return { job: hold(ctx, job, blocked.code, blocked.detail), stopJob: true }
  if (blocked) { ctx.stop = { ...blocked, outcome: blocked.code }; notice(ctx, blocked.code, { detail: blocked.detail }); return { job, stopJob: true } }
  const sendProblems = sentPlanProblems(kind, bodyText, pp.providerPlanHash)
  if (sendProblems.length) return { job: hold(ctx, job, 'PROVIDER_PLAN_FORBIDDEN', sendProblems.join('+')), stopJob: true }

  let n = job.requests.length + 1, keyFile
  for (;;) {
    try { keyFile = createRequestKey(deps.jobsRoot, job.planHash, n, { fs: ctx.fs, nowIso: iso(ctx), runId: deps.runId }); break } catch (e) {
      if (e?.code !== 'REQUEST_KEY_EXISTS') throw e
      // 앞 실행이 키만 만들고 Job 기록 전에 죽었다 — Job 기록이 전송보다 앞이므로 그 키로는 아무것도 나가지 않았다. 키를 다시 쓰지 않고 다음 번호로 간다
      job = save(ctx, { ...job, requests: [...job.requests, { n, kind, purpose, status: 'NOT_SENT', note: 'KEY_WITHOUT_RECORD', createdAt: iso(ctx), costUsd: 0, consumed: true }] })
      n += 1
      if (n > MAX_REQUESTS) return { job: hold(ctx, job, 'REQUEST_LIMIT'), stopJob: true }
    }
  }
  const request = { n, kind, purpose, requestKey: keyFile, contractHash, inputSha256: sha256(bodyText), stage: deps.stage, createdAt: iso(ctx), runId: deps.runId,
    status: 'SUBMITTING', responseId: null, store: null, mode: null, submittedAt: null, nextPollAt: null, pollErrors: 0, reconcileChecks: 0,
    model: kind === 'image' ? deps.provider.models.image : deps.provider.models.manuscript,
    textRates: kind === 'image' ? null : prices.manuscript,
    raw: null, usage: null, costUsd: estimateUsd, costBasis: 'RESERVED', deletion: null, error: null, target, consumed: false }
  job = save(ctx, event(ctx, { ...job, contractHash: kind === 'image' ? job.contractHash : contractHash, requests: [...job.requests, request] }, 'REQUEST', { n, kind, purpose }))
  await hook(ctx, 'after-request-recorded', { planHash: job.planHash, n, kind })
  if (kind === 'image') return imageCall(ctx, job, n, bodyText)

  let wire
  try { wire = await deps.provider.manuscript.submit(bodyText) } catch (e) {
    ctx.report.calls.submit++
    if (e?.code !== 'TRANSPORT') throw e
    job = save(ctx, event(ctx, setRequest(job, n, { status: 'UNKNOWN', unknownAt: iso(ctx), orphanPossible: true, error: `TRANSPORT:${e.causeName ?? ''}` }), 'SUBMISSION_UNKNOWN', { n }))
    notice(ctx, 'SUBMISSION_UNKNOWN', { planHash: job.planHash, n })
    return { job, stopJob: true }
  }
  ctx.report.calls.submit++
  const raw = writeArtifact(deps.jobsRoot, job.planHash, `raw-${n}-submit.json`, wire.bodyText, { fs: ctx.fs })
  job = save(ctx, setRequest(job, n, { raw: { submit: raw }, httpStatus: wire.httpStatus }))
  await hook(ctx, 'after-submit-raw', { planHash: job.planHash, n })
  return interpretSubmit(ctx, job, n, wire.httpStatus, wire.bodyText)
}

function interpretSubmit(ctx, job, n, httpStatus, bodyText) {
  const json = parseWire(bodyText)
  if (httpStatus >= 200 && httpStatus < 300) {
    const s = readSubmit(json)
    if (!s) {
      job = save(ctx, event(ctx, setRequest(job, n, { status: 'UNKNOWN', unknownAt: iso(ctx), orphanPossible: true, error: 'SUBMIT_ID_MISSING' }), 'SUBMISSION_UNKNOWN', { n }))
      return { job, stopJob: true }
    }
    job = save(ctx, event(ctx, setRequest(job, n, { status: 'SUBMITTED', responseId: s.id, store: s.store, mode: s.store === false ? 'ZDR' : 'STORE', submittedAt: iso(ctx), nextPollAt: iso(ctx) }), 'SUBMITTED', { n, responseId: s.id, mode: s.store === false ? 'ZDR' : 'STORE' }))
    return { job, stopJob: false }
  }
  const err = json?.error?.code ?? json?.error?.type ?? null
  if (httpStatus === 401 || httpStatus === 403) {
    ctx.stop = { scope: 'ALL', code: 'AUTH', outcome: 'AUTH' }
    notice(ctx, 'AUTH', { httpStatus })
    return { job: save(ctx, setRequest(job, n, { status: 'FAILED', error: `HTTP_${httpStatus}`, costUsd: 0, costBasis: 'NOT_CREATED', consumed: true })), stopJob: true }
  }
  if (httpStatus === 429) {
    return { job: save(ctx, event(ctx, setRequest(job, n, { status: 'REJECTED', error: `HTTP_429:${err ?? ''}`, costUsd: 0, costBasis: 'NOT_CREATED', retryAfter: new Date(ctx.deps.now() + ctx.L.rejectRetryMs).toISOString() }), 'RATE_LIMITED', { n })), stopJob: true }
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    // 계약 거절(400 · 404 · 422) — schema · background · store 조합이 실제 provider 와 맞지 않는다. 브라우저로 강등하지 않고 회차를 멈춘다
    ctx.stop = { scope: 'ALL', code: 'DESIGN_CONTRACT_CONFLICT', outcome: 'DESIGN_CONTRACT_CONFLICT' }
    job = save(ctx, setRequest(job, n, { status: 'FAILED', error: `HTTP_${httpStatus}:${err ?? ''}`, costUsd: 0, costBasis: 'NOT_CREATED', consumed: true }))
    return { job: hold(ctx, job, 'DESIGN_CONTRACT_CONFLICT', `HTTP ${httpStatus} ${err ?? ''}`), stopJob: true }
  }
  // 5xx · 그 밖 — 만들어졌는지 모른다
  job = save(ctx, event(ctx, setRequest(job, n, { status: 'UNKNOWN', unknownAt: iso(ctx), orphanPossible: true, error: `HTTP_${httpStatus}` }), 'SUBMISSION_UNKNOWN', { n }))
  return { job, stopJob: true }
}

// ── 진행 중 요청 마무리 ──────────────────────────────────────

async function settleRequest(ctx, job, r) {
  const { deps, L } = ctx
  const pending = (j) => ({ job: j, pending: true })
  if (r.kind === 'image' && ['SUBMITTING', 'UNKNOWN'].includes(r.status)) {
    const next = setRequest(job, r.n, { status: 'UNRECOVERABLE', consumed: true, orphanPossible: true })
    return { job: hold(ctx, next, 'IMAGE_SUBMISSION_UNKNOWN'), pending: true }
  }
  if (r.status === 'SUBMITTING') {
    // 앞 실행이 기록 뒤에 죽었다 — 저장된 제출 응답이 있으면 그 바이트로 해석한다(다시 보내지 않는다)
    const file = `raw-${r.n}-submit.json`
    if (artifactExists(deps.jobsRoot, job.planHash, file, { fs: ctx.fs })) {
      const text = readArtifact(deps.jobsRoot, job.planHash, file, { fs: ctx.fs }).toString('utf8')
      const res = interpretSubmit(ctx, job, r.n, r.httpStatus ?? 200, text)
      return { job: res.job, pending: false }
    }
    job = save(ctx, event(ctx, setRequest(job, r.n, { status: 'UNKNOWN', unknownAt: iso(ctx), orphanPossible: true, error: 'DIED_BEFORE_RESPONSE' }), 'SUBMISSION_UNKNOWN', { n: r.n }))
    notice(ctx, 'SUBMISSION_UNKNOWN', { planHash: job.planHash, n: r.n })
    return pending(job)
  }
  if (r.status === 'UNKNOWN') {
    // 상한 있는 확인 — 응답 기록으로 ID 를 되찾는다. 못 찾으면 확인 창이 지나고 한 번 이상 다시 본 뒤에만 회수 불능으로 확정
    const file = `raw-${r.n}-submit.json`
    if (artifactExists(deps.jobsRoot, job.planHash, file, { fs: ctx.fs })) {
      const text = readArtifact(deps.jobsRoot, job.planHash, file, { fs: ctx.fs }).toString('utf8')
      const s = readSubmit(parseWire(text))
      if (s) return { job: interpretSubmit(ctx, job, r.n, 200, text).job, pending: false }
    }
    const waited = deps.now() - Date.parse(r.unknownAt)
    if (r.reconcileChecks >= 1 && waited >= L.reconcileAfterMs) {
      job = save(ctx, event(ctx, setRequest(job, r.n, { status: 'UNRECOVERABLE', error: `${r.error ?? 'UNKNOWN'}→UNRECOVERABLE` }), 'UNRECOVERABLE', { n: r.n, orphanPossible: true }))
      return { job, pending: false }
    }
    return pending(save(ctx, setRequest(job, r.n, { reconcileChecks: r.reconcileChecks + 1 })))
  }
  // SUBMITTED — bounded polling
  if (r.mode === 'ZDR' && r.runId !== deps.runId) {
    // store:false — 원격 보존이 없다. 프로세스가 바뀌었으면 회수 불능으로 확정한다
    return { job: save(ctx, event(ctx, setRequest(job, r.n, { status: 'UNRECOVERABLE', error: 'ZDR_PROCESS_RESTARTED' }), 'UNRECOVERABLE', { n: r.n })), pending: false }
  }
  if (r.nextPollAt && Date.parse(r.nextPollAt) > deps.now()) return pending(job)
  const deadline = r.mode === 'ZDR' ? Date.parse(r.submittedAt) + L.zdrWindowMs : deps.now() + L.pollOccupancyMs
  for (;;) {
    let wire
    try { wire = await deps.provider.manuscript.retrieve(r.responseId); ctx.report.calls.retrieve++ } catch (e) {
      ctx.report.calls.retrieve++
      if (e?.code !== 'TRANSPORT') throw e
      wire = null
    }
    if (wire?.httpStatus === 404) {
      // 원격에 없다 — 앞 실행이 저장 · 삭제까지 하고 기록 전에 죽었을 수 있다. 저장본이 있으면 그것이 정본이다
      const local = localFinal(ctx, job, r)
      if (local) return { job: local, pending: false }
      return { job: save(ctx, event(ctx, setRequest(job, r.n, { status: 'UNRECOVERABLE', error: 'REMOTE_GONE_404', deletion: { at: iso(ctx), result: 'NOT_FOUND', attempts: 0 } }), 'UNRECOVERABLE', { n: r.n })), pending: false }
    }
    if (wire && (wire.httpStatus === 401 || wire.httpStatus === 403)) { ctx.stop = { scope: 'ALL', code: 'AUTH', outcome: 'AUTH' }; notice(ctx, 'AUTH', {}); return pending(job) }
    const t = wire && wire.httpStatus >= 200 && wire.httpStatus < 300 ? readTerminal(parseWire(wire.bodyText)) : null
    if (!t) {
      const errors = (reqOf(job, r.n).pollErrors ?? 0) + 1
      if (errors >= L.pollErrorMax) { job = save(ctx, setRequest(job, r.n, { pollErrors: errors })); return { job: hold(ctx, job, 'POLL_ERRORS', `${errors}회`), pending: true } }
      return pending(save(ctx, setRequest(job, r.n, { pollErrors: errors, nextPollAt: new Date(deps.now() + L.pollIntervalMs).toISOString() })))
    }
    if (t.terminal) return { job: await finalize(ctx, job, r, wire.bodyText, t), pending: false }
    if (deps.now() + L.pollIntervalMs > deadline) {
      if (r.mode === 'ZDR') return { job: save(ctx, event(ctx, setRequest(job, r.n, { status: 'UNRECOVERABLE', error: 'ZDR_WINDOW_PASSED' }), 'UNRECOVERABLE', { n: r.n })), pending: false }
      // 점유 상한 — 생성 실패가 아니다. 다음 회차가 같은 ID 로 이어 본다
      return pending(save(ctx, setRequest(job, r.n, { nextPollAt: new Date(deps.now() + L.pollIntervalMs).toISOString() })))
    }
    await deps.sleep(L.pollIntervalMs)
  }
}

function localFinal(ctx, job, r) {
  const file = `raw-${r.n}-final.json`
  if (!artifactExists(ctx.deps.jobsRoot, job.planHash, file, { fs: ctx.fs })) return null
  const text = readArtifact(ctx.deps.jobsRoot, job.planHash, file, { fs: ctx.fs }).toString('utf8')
  const t = readTerminal(parseWire(text))
  if (!t.terminal) return null
  return recordTerminal(ctx, job, r, { file, sha256: sha256(Buffer.from(text, 'utf8')) }, t, { result: 'NOT_FOUND', at: iso(ctx), attempts: 0 })
}

/** terminal — 응답 바이트 원자 저장 → 해시 검증 → Job 기록 → DELETE → 확인 기록 */
async function finalize(ctx, job, r, bodyText, t) {
  const raw = writeArtifact(ctx.deps.jobsRoot, job.planHash, `raw-${r.n}-final.json`, bodyText, { fs: ctx.fs })
  await hook(ctx, 'after-final-raw', { planHash: job.planHash, n: r.n })
  job = recordTerminal(ctx, job, r, raw, t, null)
  await hook(ctx, 'before-delete', { planHash: job.planHash, n: r.n })
  return deleteRemote(ctx, job, r.n)
}

function recordTerminal(ctx, job, r, raw, t, deletion) {
  const prices = r.textRates ?? ctx.deps.provider.prices.manuscript
  const ok = t.status === 'completed' && typeof t.outputText === 'string' && !t.refusal
  const usd = actualCostUsd({ usage: t.usage, prices })
  const cost = usd === null ? { costBasis: 'ESTIMATE_NO_USAGE' } : { costUsd: usd, costBasis: 'ACTUAL' }
  const mode = t.store === false ? 'ZDR' : r.mode
  return save(ctx, event(ctx, setRequest(job, r.n, { status: ok ? 'COMPLETED' : 'FAILED', terminalStatus: t.status, raw: { ...(reqOf(job, r.n).raw ?? {}), final: raw },
    usage: t.usage, ...cost, mode, nextPollAt: null, error: ok ? null : (t.refusal ? 'REFUSAL' : t.incompleteReason ?? t.error ?? t.status),
    ...(mode === 'ZDR' ? { deletion: { at: iso(ctx), result: 'SKIPPED_ZDR', attempts: 0 } } : deletion ? { deletion } : {}) }), 'TERMINAL', { n: r.n, status: t.status }))
}

async function deleteRemote(ctx, job, n) {
  const r = reqOf(job, n)
  if (!r.responseId || r.mode !== 'STORE' || ['DELETED', 'NOT_FOUND'].includes(r.deletion?.result)) return job
  let result = 'FAILED', verifyStatus = null
  try {
    const w = await ctx.deps.provider.manuscript.remove(r.responseId)
    const receipt = parseWire(w.bodyText)
    if (w.httpStatus === 404) result = 'NOT_FOUND'
    else if (w.httpStatus === 200 && receipt?.deleted === true && receipt.id === r.responseId) {
      result = 'DELETED'
      if (ctx.deps.stage === 'S5_CANARY' && ctx.deps.provider.kind === 'openai') {
        result = 'FAILED'
        ctx.report.calls.retrieve++
        verifyStatus = (await ctx.deps.provider.manuscript.retrieve(r.responseId)).httpStatus
        if (verifyStatus === 404) result = 'DELETED'
      }
    }
  } catch (e) { if (e?.code !== 'TRANSPORT') throw e }
  ctx.report.calls.remove++
  const attempts = (r.deletion?.attempts ?? 0) + 1
  // sweptBy — 같은 회차에 같은 ID 를 두 번 지우려 하지 않는다(실패는 다음 회차 sweeper 가 다시 본다)
  job = save(ctx, event(ctx, setRequest(job, n, { deletion: { at: iso(ctx), result, verifyStatus, attempts, sweptBy: ctx.deps.runId } }), 'DELETE', { n, result }))
  if (result === 'FAILED' && attempts >= ctx.L.deleteNoticeAfter) notice(ctx, 'DELETE_REPEATED_FAILURE', { planHash: job.planHash, n, attempts })
  return job
}

/** 삭제 sweeper — 확인되지 않은 삭제를 회차마다 한 번씩 다시 시도한다(진행을 막지 않는다) */
async function sweepDeletes(ctx, job) {
  for (const r of job.requests) {
    if (halted(ctx)) return job
    if (r.responseId && r.mode === 'STORE' && ['COMPLETED', 'FAILED'].includes(r.status) && !['DELETED', 'NOT_FOUND'].includes(r.deletion?.result) && r.deletion?.sweptBy !== ctx.deps.runId) {
      job = await deleteRemote(ctx, job, r.n)
    }
  }
  return job
}

// ── terminal 소비 ────────────────────────────────────────────

async function consume(ctx, job, r) {
  const consumed = j => setRequest(j, r.n, { consumed: true })
  const done = j => save(ctx, consumed(j))
  const text = r.raw?.final ? readArtifact(ctx.deps.jobsRoot, job.planHash, r.raw.final.file, { fs: ctx.fs }).toString('utf8') : null
  const t = text ? readTerminal(parseWire(text)) : null
  if (r.status === 'REJECTED' || r.status === 'NOT_SENT') return done(job)
  if (r.kind === 'manuscript') {
    if (r.status !== 'COMPLETED') {
      const reason = r.status === 'UNRECOVERABLE' ? (r.error?.startsWith('REMOTE_GONE') || r.error?.startsWith('ZDR') ? 'REMOTE_UNRECOVERABLE' : 'SUBMISSION_UNRECOVERABLE') : `PROVIDER_${String(r.error ?? r.terminalStatus ?? 'FAILED').toUpperCase()}`
      return done({ ...job, lastFailure: reason, draft: null })
    }
    const parsed = parseManuscriptText(t?.outputText)
    if (!parsed.ok) {
      // strict structured output 이 지켜지지 않았다 — 계약 충돌. 그 회차를 멈춘다(브라우저 강등 0)
      ctx.stop = { scope: 'ALL', code: 'DESIGN_CONTRACT_CONFLICT', outcome: 'DESIGN_CONTRACT_CONFLICT' }
      return hold(ctx, done(job), 'DESIGN_CONTRACT_CONFLICT', parsed.code)
    }
    const plan = ctx.compiled.plans.find((p) => p.planId === job.planId)
    const article = articleFromManuscript(parsed.value, plan)
    job = consumed({ ...job, slugProposal: parsed.value.slugProposal.trim(), heroScene: parsed.value.heroScene.trim() })
    return writeDraft(ctx, event(ctx, job, 'DRAFT', { n: r.n }), article, 'm')
  }
  if (r.kind === 'repair') {
    if (r.status !== 'COMPLETED') return done(event(ctx, job, 'REPAIR_FAILED', { n: r.n, error: r.error }))
    const parsed = parseRepairText(t?.outputText)
    if (!parsed.ok) { ctx.stop = { scope: 'ALL', code: 'DESIGN_CONTRACT_CONFLICT', outcome: 'DESIGN_CONTRACT_CONFLICT' }; return hold(ctx, done(job), 'DESIGN_CONTRACT_CONFLICT', parsed.code) }
    const article = JSON.parse(readArtifact(ctx.deps.jobsRoot, job.planHash, job.draft.file, { fs: ctx.fs }).toString('utf8'))
    const applied = applyReplacement(article, r.target, parsed.replacement)
    job = consumed(event(ctx, job, applied.ok ? 'REPAIRED' : 'REPAIR_NOT_APPLIED', { n: r.n, target: r.target.kind === 'field' ? r.target.field : r.target.path.join('.') }))
    return applied.ok ? writeDraft(ctx, job, applied.article, 'r') : save(ctx, job)
  }
  if (r.kind === 'image' && r.status === 'COMPLETED' && r.raw?.source) {
    const bytes = readArtifact(ctx.deps.jobsRoot, job.planHash, r.raw.source.file, { fs: ctx.fs })
    if (sha256(bytes) !== r.raw.source.sha256) return hold(ctx, job, 'HERO_SOURCE_MISMATCH')
    return (await finishHero(ctx, job, r.n, bytes)).job
  }
  return done(job)
}

// ── hero ─────────────────────────────────────────────────────

async function heroStep(ctx, job, pp) {
  if (imageCount(job) >= ctx.L.imageAttempts) return { job: hold(ctx, job, 'HERO_FAILED', job.lastHeroFailure ?? null), stopJob: true }
  if (!job.heroScene) return { job: hold(ctx, job, 'HERO_SCENE_MISSING'), stopJob: true }
  const body = buildImageBody({ heroScene: job.heroScene, model: ctx.deps.provider.models.image, size: ctx.deps.provider.imageSize })
  return submit(ctx, job, pp, { kind: 'image', purpose: 'HERO', ...body })
}

/** 이미지 — 동기 호출. 원본을 먼저 저장하고 16:9 · 크기 · 중복을 본다. 실패는 이미지만 다시(원고 재생성 0) */
function rejectHero(ctx, job, n, code, patch = {}) {
  const next = { ...setRequest(job, n, { consumed: true, ...patch }), lastHeroFailure: code }
  return { job: save(ctx, event(ctx, next, 'HERO_REJECTED', { n, reason: code })), stopJob: false }
}

async function imageCall(ctx, job, n, bodyText) {
  const { deps } = ctx
  let wire
  try { wire = await deps.provider.image.generate(bodyText) } catch (e) {
    ctx.report.calls.image++
    if (e?.code !== 'TRANSPORT') throw e
    job = setRequest(job, n, { status: 'UNRECOVERABLE', error: 'TRANSPORT', orphanPossible: true, consumed: true })
    return { job: hold(ctx, job, 'IMAGE_SUBMISSION_UNKNOWN'), stopJob: true }
  }
  ctx.report.calls.image++
  if (wire.httpStatus === 401 || wire.httpStatus === 403) { ctx.stop = { scope: 'ALL', code: 'AUTH', outcome: 'AUTH' }; return { job: save(ctx, setRequest(job, n, { status: 'FAILED', error: `HTTP_${wire.httpStatus}`, costUsd: 0, costBasis: 'NOT_CREATED', consumed: true })), stopJob: true } }
  if (wire.httpStatus < 200 || wire.httpStatus >= 300) return rejectHero(ctx, job, n, 'IMAGE_PROVIDER_FAILED', { status: 'FAILED', error: `HTTP_${wire.httpStatus}`, ...(wire.httpStatus < 500 ? { costUsd: 0, costBasis: 'NOT_CREATED' } : {}) })
  const response = parseWire(wire.bodyText)
  const img = readImage(response)
  if (!img.ok) return rejectHero(ctx, job, n, img.code, { status: 'FAILED', error: img.code })
  const src = writeArtifact(deps.jobsRoot, job.planHash, `hero-source-${n}.bin`, img.bytes, { fs: ctx.fs })
  const metered = deps.provider.kind === 'openai'
  const usage = response.usage ?? null
  const actual = metered ? imageUsageCost(deps.provider.models.image, usage) : null
  const costUsd = actual ?? reqOf(job, n).costUsd
  job = save(ctx, setRequest(job, n, { status: 'COMPLETED', raw: { source: src }, usage, costUsd,
    costBasis: actual !== null ? 'USAGE' : metered ? 'RESERVED_NO_USAGE' : 'REHEARSAL', consumed: false }))
  if (metered && actual === null) {
    ctx.stop = { scope: 'ALL', code: 'IMAGE_USAGE_UNKNOWN', outcome: 'IMAGE_USAGE_UNKNOWN' }
    return { job: hold(ctx, job, 'IMAGE_USAGE_UNKNOWN'), stopJob: true }
  }
  await hook(ctx, 'after-hero-source', { planHash: job.planHash, n })
  return finishHero(ctx, job, n, img.bytes)
}

async function finishHero(ctx, job, n, bytes) {
  const { deps } = ctx
  const h = await heroFromSource(bytes)
  if (!h.ok) return rejectHero(ctx, job, n, h.code)
  const hash = await dHash(h.webp)
  const others = [...(deps.publishedHeroes?.() ?? []), ...listJobs(deps.jobsRoot, { fs: ctx.fs }).filter((x) => x.planHash !== job.planHash && x.job.hero)
    .map((x) => ({ name: `job:${x.planHash.slice(0, 12)}`, hash: x.job.hero.dhash ?? null, bytes: readArtifact(deps.jobsRoot, x.planHash, x.job.hero.file, { fs: ctx.fs }) }))]
  const near = await nearestHero(hash, others)
  if (near && near.distance <= HERO_DUP_DISTANCE) return rejectHero(ctx, job, n, 'HERO_DUPLICATE', { duplicateOf: near.name, distance: near.distance })
  const hero = writeArtifact(deps.jobsRoot, job.planHash, 'hero.webp', h.webp, { fs: ctx.fs })
  job = save(ctx, event(ctx, { ...setRequest(job, n, { consumed: true }), hero: { ...hero, width: HERO_WIDTH, height: HERO_HEIGHT, dhash: hash, fromRequest: n, crop: h.crop, source: h.source, nearest: near } }, 'HERO_READY', { n }))
  return { job, stopJob: true }
}

// ── live 설정 — 실제 provider 호출 스위치(기본 OFF) ──────────────

export const LIVE_SCHEMA = 'magazine-provider-live/1'
/** runtime · 저장소 밖. 없음 · 손상 · schema 불일치 · enabled:false 는 전부 OFF(계획만 · 쓰기 0 · 호출 0) */
export const liveConfigPath = ({ home }) => `${home}/Library/Application Support/soransoran/magazine-provider-live.json`
const LIVE_KEYS = ['changedAt', 'changedBy', 'enabled', 'image', 'keychain', 'manuscript', 'schemaVersion', 'stage']
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join()
const posInt = (n, max) => Number.isSafeInteger(n) && n > 0 && n <= max
const price = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0
const name = (s) => typeof s === 'string' && /^[A-Za-z0-9._:-]{2,80}$/.test(s)

/**
 * S5 canary · S6 commissioning 직전에 사람이 만든다(창업자 승인 · 키 발급 뒤). 이 코드는 읽기만 한다.
 * 🔴 단가는 S5 직전 공식 가격 페이지로 대조한 값을 사람이 적는다 — 코드에 단가를 두지 않는다(지어내지 않는다). 0 이하는 판독 불가다.
 */
export function readLiveConfig({ path, fs = nodeFs }) {
  let text
  try { text = fs.readFileSync(path, 'utf8') } catch (e) { return { code: e?.code === 'ENOENT' ? 'MISSING' : 'INVALID', on: false, config: null, why: e?.code ?? null } }
  let c
  try { c = JSON.parse(text) } catch { return { code: 'INVALID', on: false, config: null, why: 'JSON' } }
  const bad = (why) => ({ code: 'INVALID', on: false, config: null, why })
  if (!exact(c, LIVE_KEYS) || c.schemaVersion !== LIVE_SCHEMA) return bad('필드 · schemaVersion')
  if (typeof c.enabled !== 'boolean' || !['S5_CANARY', 'S6_COMMISSIONING', 'PILOT'].includes(c.stage)) return bad('enabled · stage')
  if (!exact(c.manuscript, ['inputPer1M', 'maxOutputTokens', 'model', 'outputPer1M', 'repairMaxOutputTokens']) || !name(c.manuscript.model)
    || !posInt(c.manuscript.maxOutputTokens, 32000) || !posInt(c.manuscript.repairMaxOutputTokens, 4000) || !price(c.manuscript.inputPer1M) || !price(c.manuscript.outputPer1M)) return bad('manuscript')
  if (!exact(c.image, ['model', 'perImage', 'size']) || !name(c.image.model) || !/^\d{3,4}x\d{3,4}$/.test(c.image.size) || !price(c.image.perImage)) return bad('image')
  if (!exact(c.keychain, ['account', 'service']) || !name(c.keychain.service) || !name(c.keychain.account)) return bad('keychain')
  if (typeof c.changedBy !== 'string' || !c.changedBy.trim() || Number.isNaN(Date.parse(c.changedAt))) return bad('changedBy · changedAt')
  return { code: 'VALID', on: c.enabled === true, config: c, why: null }
}

// ── 명시적 재호출 ────────────────────────────────────────────

/**
 * HOLD(또는 창업자 '아니오') 뒤 같은 ContentPlan 을 다시 돌릴 수 있게 표시한다 — **provider 호출 0**. 다음 생산 회차가 이어 간다.
 *   scope 'hero'  검증된 원고는 그대로 · 이미지 요청만 은퇴(원고 재생성 0)
 *   scope 'all'   원고 · 수리 · 이미지 요청을 전부 은퇴 — 시스템을 고친 뒤 처음부터. 🔴 편당 비용은 은퇴한 요청까지 계속 센다
 * 기록은 지우지 않는다(retired 표식 · reruns[]).
 */
export function rerunJob({ jobsRoot, planHash, scope, by, nowIso, fs = nodeFs }) {
  if (!['hero', 'all'].includes(scope)) return { ok: false, code: 'SCOPE_INVALID' }
  if (typeof by !== 'string' || !by.trim()) return { ok: false, code: 'BY_REQUIRED' }
  if (!/^[a-f0-9]{64}$/.test(planHash)) return { ok: false, code: 'PLAN_HASH_INVALID' }
  const lock = acquireProduceLock({ jobsRoot, fs, nowIso })
  if (!lock.ok) return { ok: false, code: lock.code }
  try { return markRerun({ jobsRoot, planHash, scope, by, nowIso, fs }) } finally { lock.release() }
}

function markRerun({ jobsRoot, planHash, scope, by, nowIso, fs }) {
  const job = readJob(jobsRoot, planHash, { fs })
  if (!job || job.broken) return { ok: false, code: 'JOB_UNREADABLE' }
  if (job.requests.some((r) => ['SUBMITTING', 'SUBMITTED', 'UNKNOWN'].includes(r.status))) return { ok: false, code: 'REQUEST_IN_FLIGHT' }
  if (scope === 'hero' && !(job.validation?.verdict === 'VALID' && job.manuscript)) return { ok: false, code: 'NO_VALID_MANUSCRIPT' }
  if (!job.hold && scope === 'hero') return { ok: false, code: 'NOT_HELD' }
  const retire = (r) => (scope === 'all' || r.kind === 'image' ? { ...r, retired: true, consumed: true } : r)
  const base = { ...job, hold: null, requests: job.requests.map(retire), reruns: [...(job.reruns ?? []), { at: nowIso, by: by.trim(), scope, hold: job.hold ?? null }], lastHeroFailure: null }
  const next = scope === 'all' ? { ...base, draft: null, manuscript: null, validation: null, hero: null, slugProposal: null, heroScene: null, lastFailure: null } : { ...base, hero: null }
  writeJob(jobsRoot, addEvent(next, { code: 'RERUN', at: nowIso, by: by.trim(), scope }), { fs, nowIso })
  return { ok: true, planHash, scope, state: jobState(next), costUsd: jobCostUsd(next) }
}

export { jobDirOf }
