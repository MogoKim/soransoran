#!/usr/bin/env node
/**
 * 자동 PR 병합 — 🔴 **기본은 검증만. `--apply` 만 실제로 merge 한다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **경계**
 *    한다      검증 → squash merge → **배포 확인** → **예약 비공개 확인**
 *    안 한다   공개 앞당기기 · 사람 PR merge · HIGH 병합 · 재시도 · 보호규칙 우회
 *
 *    merge 해도 글은 `publishAt` 전까지 나오지 않는다. 이 스크립트가 마지막으로
 *    확인하는 것이 바로 그것이다 — **merge 했는데 즉시 공개되면 그것은 사고다.**
 *
 * 🔴 **모르면 막는다.** 확인하지 못한 항목이 하나라도 있으면 merge 하지 않는다.
 *    500 · 인증 리다이렉트 · 네트워크 실패는 **"비공개 성공" 이 아니다.**
 *
 * 🔴 **실행 전체가 주입 가능하다** (`runAutoMerge`). 회귀가 가짜 git·gh·배포·HTTP 로
 *    **이 함수를 통째로** 돌린다 — 파서와 판정을 따로 시험하는 것으로는
 *    "실제로 이어지는가" 를 보지 못한다 (2026-09-16 검토).
 *
 * 사용법
 *   node scripts/magazine-auto-merge.mjs              검증만 (변경 0)
 *   node scripts/magazine-auto-merge.mjs --apply      🔴 실제 merge
 *   node scripts/magazine-auto-merge.mjs --watch      publishAt 이후 공개 확인만
 *
 * 종료 코드: 성공했거나 할 것이 없으면 0 · 막혔으면 1
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRAFTS_DIR, parseArticlesSource, parseQueueSource } from './lib/magazine-load.mjs'
import { AUTO_BRANCH_PREFIX, OK_CONCLUSIONS, PR_FIELDS_ARG, REQUIRED_CHECKS, REQUIRED_CONCLUSIONS, judgeAutoMerge } from './lib/magazine-merge-gate.mjs'
import { buildMessage, send } from './lib/slack-notify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const stamp = () => `${new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)} KST`

/** 사이트 주소 — 공개 여부를 실제로 본다 */
export const SITE = 'https://soransoran.com'

// ─────────────────────────────────────────────────────────
// 제한 시간 — 🔴 전부 유한하다. 무한 대기 없음
// ─────────────────────────────────────────────────────────
export const CI_OBSERVE_MS = 12 * 60 * 1000
export const CI_POLL_MS = 30 * 1000
export const DEPLOY_OBSERVE_MS = 10 * 60 * 1000
export const DEPLOY_POLL_MS = 20 * 1000
/** 🔴 GitHub 은 mergeable 을 비동기로 계산한다. 잠깐 UNKNOWN 인 것은 정상이다 */
export const MERGEABLE_OBSERVE_MS = 3 * 60 * 1000
export const MERGEABLE_POLL_MS = 15 * 1000

// ─────────────────────────────────────────────────────────
// 판정 — 🔴 순수 함수
// ─────────────────────────────────────────────────────────

/**
 * merge 한 SHA 가 **실제로 운영에 나갔고**, 예약 글이 **아직 안 나왔는지** 본다.
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **커밋 합산 status 는 배포 확인이 아니다** (2026-09-16 재검토).
 *
 *    직전 판은 `commits/{sha}/status` 를 배포 상태로 썼다. 그것은 CI 판정에 쓰는
 *    바로 그 값이다 — 검사가 다 초록이면 success 가 된다. **운영 도메인이 아직
 *    옛 빌드를 서빙하고 있어도 success 다.** 즉 "배포를 확인했다" 고 적어 놓고
 *    실제로는 CI 를 한 번 더 본 것이었다.
 *
 * 🔴 **그래서 세 가지를 따로 본다.**
 *      ① Production 배포가 **그 SHA 로** 존재하는가   (GitHub Deployments API)
 *      ② 그 배포가 **READY 인가**                      (deployment status = success)
 *      ③ **운영 도메인이 그 배포를 서빙 중인가**        (soransoran.com 의 dpl_ 표식)
 *
 *    ③ 이 핵심이다. ①②만 보면 "배포는 됐는데 도메인은 구버전" 을 못 본다.
 *    Vercel 은 `next/image` URL 에 `dpl=dpl_<id>` 를 심고, 같은 id 가 그 커밋의
 *    Vercel status target_url 끝에 들어간다. 두 값을 맞춰 보면 도메인이 실제로
 *    무엇을 서빙 중인지 **추측 없이** 알 수 있다.
 *
 * 🔴 **모르면 막는다.** 읽지 못한 값은 통과가 아니다.
 * 🔴 500 · 인증 리다이렉트 · 네트워크 실패는 **"비공개 성공" 이 아니다.**
 *    비공개를 확인한 것은 오직 **404** 뿐이다.
 *
 * @param {object} p
 * @param {{found:boolean, state:string|null, sha:string|null, deploymentId:string|null}} p.deployment
 * @param {string|null} p.liveDeploymentId  운영 도메인이 서빙 중인 dpl_ id
 * @param {string} p.expectedSha            merge 커밋 SHA
 */
export function judgeDeploy({ deployment, liveDeploymentId, expectedSha, slugStatuses, now }) {
  const blockedBy = []
  const checked = []
  const block = (code, message) => blockedBy.push({ code, message })
  const d = deployment ?? { found: false }

  // ── ① Production 배포가 그 SHA 로 있는가 ────────────────
  if (!d.found) {
    block('DEPLOY_NOT_FOUND', `merge SHA(${String(expectedSha).slice(0, 7)}) 의 Production 배포를 찾지 못했다`)
  } else if (d.sha && expectedSha && d.sha !== expectedSha) {
    block('DEPLOY_SHA_MISMATCH', `Production 배포의 SHA 가 ${String(d.sha).slice(0, 7)} 다 — merge 한 것은 ${String(expectedSha).slice(0, 7)} 다`)
  } else checked.push(`Production 배포가 merge SHA 로 있다 (${String(expectedSha).slice(0, 7)})`)

  // ── ② READY 인가 ───────────────────────────────────────
  if (d.found) {
    if (d.state !== 'success') {
      block('DEPLOY_NOT_READY', `Production 배포 상태가 ${d.state ?? '알 수 없음'} 다 — 확인 전에 성공으로 끝내지 않는다`)
    } else checked.push('Production 배포 READY')
  }

  // ── ③ 운영 도메인이 그 배포를 서빙 중인가 ────────────────
  // 🔴 여기가 "커밋 status=success 인데 도메인은 구버전" 을 잡는 자리다.
  if (!d.deploymentId) {
    block('DEPLOY_ID_UNKNOWN', '배포 id 를 읽지 못했다 — 운영 도메인이 무엇을 서빙 중인지 대조할 수 없다')
  } else if (!liveDeploymentId) {
    block('PRODUCTION_UNVERIFIED', `${SITE} 에서 배포 표식을 읽지 못했다 — 운영 반영을 확인하지 못했다`)
  } else if (liveDeploymentId !== d.deploymentId) {
    block('PRODUCTION_STALE', `운영 도메인이 아직 다른 배포를 서빙 중이다 (도메인 ${liveDeploymentId} · merge ${d.deploymentId})`)
  } else checked.push(`운영 도메인이 그 배포를 서빙 중이다 (${d.deploymentId})`)

  // ── ④ 예약 글이 아직 안 나왔는가 ────────────────────────
  for (const s of slugStatuses ?? []) {
    const due = Date.parse(s.publishAt)
    const beforePublish = Number.isFinite(due) && due > now
    const code = s.httpStatus

    if (code === null || code === undefined) {
      block('CHECK_UNREACHABLE', `${s.slug} 의 공개 여부를 확인하지 못했다 (네트워크 실패) — 비공개 성공이 아니다`)
      continue
    }
    if (beforePublish) {
      if (code === 200) {
        // 🔴 최악의 사고 — 예약 글이 미리 나갔다
        block('PUBLISHED_EARLY', `${s.slug} 가 publishAt(${s.publishAt}) 전에 공개됐다`)
      } else if (code !== 404) {
        // 🔴 500·3xx 는 "숨겨짐" 이 아니다. 확인하지 못한 것이다.
        block('HIDDEN_UNCONFIRMED', `${s.slug} 가 HTTP ${code} 다 — 404 가 아니면 비공개를 확인한 것이 아니다`)
      } else checked.push(`${s.slug} 예약 비공개 확인 (404)`)
    } else if (code !== 200) {
      block('NOT_PUBLISHED', `${s.slug} 는 publishAt 이 지났는데 공개되지 않았다 (HTTP ${code})`)
    } else checked.push(`${s.slug} 공개 확인 (200)`)
  }
  return { ok: blockedBy.length === 0, blockedBy, checked }
}

/**
 * publishAt 이 지난 글이 **본문·이미지·목록** 세 곳에 다 나왔는가.
 *
 * 🔴 상세만 200 이면 모자라다. 목록에 없으면 독자가 찾아오지 못하고,
 *    이미지가 깨지면 그것도 공개 실패다.
 */
export function judgeWatch({ rows, now }) {
  const blockedBy = []
  const checked = []
  for (const r of rows ?? []) {
    const due = Date.parse(r.publishAt)
    if (!Number.isFinite(due) || due > now) { checked.push(`${r.slug} 아직 예약 전 — 건너뜀`); continue }
    if (r.article !== 200) blockedBy.push({ code: 'ARTICLE_MISSING', message: `${r.slug} 본문이 HTTP ${r.article} 다` })
    // 🔴 heroImage 자체가 없는 것과 URL 이 깨진 것을 구분해 적는다. 둘 다 실패다.
    if (r.image !== 200) {
      blockedBy.push({
        code: 'IMAGE_MISSING',
        message: r.image === null || r.image === undefined
          ? `${r.slug} 에 대표 이미지가 아예 없다 (heroImage 미설정)`
          : `${r.slug} 대표 이미지가 HTTP ${r.image} 다`,
      })
    }
    if (!r.inList) blockedBy.push({ code: 'LIST_MISSING', message: `${r.slug} 가 /magazine 목록에 없다` })
    if (r.article === 200 && r.image === 200 && r.inList) checked.push(`${r.slug} 본문·이미지·목록 확인`)
  }
  return { ok: blockedBy.length === 0, blockedBy, checked }
}

// ─────────────────────────────────────────────────────────
// 실행 — 🔴 전부 주입 가능하다
// ─────────────────────────────────────────────────────────

/**
 * 한 회차를 끝까지 몬다.
 *
 * @param {object} p
 * @param {boolean} p.apply
 * @param {object} p.deps  git·gh·http·clock 전부 주입
 */
export async function runAutoMerge({ apply = false, deps }) {
  const log = deps.log ?? (() => {})
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const report = { mode: apply ? 'apply' : 'verify', pr: null, baseSha: null, blockedBy: [], checked: [], merged: false }
  const fail = (code, message) => { report.blockedBy.push({ code, message }); return report }

  // ── ① 최신 origin/main 을 갱신하고 기준 SHA 를 기록한다 ───
  if (!deps.fetchMain()) return fail('FETCH_FAILED', 'origin/main 을 가져오지 못했다')
  report.baseSha = deps.readBaseSha()
  if (!report.baseSha) return fail('BASE_SHA_UNKNOWN', 'origin/main 의 SHA 를 읽지 못했다')
  log(`기준 origin/main: ${report.baseSha.slice(0, 7)}`)

  // ── ② 자동 PR ───────────────────────────────────────────
  const found = deps.listAutoPrs()
  if (!found.ok) return fail('PR_LOOKUP_FAILED', found.reason)
  if (found.prs.length === 0) { log('자동 PR 이 없다 — 할 것이 없다'); return report }
  // 🔴 둘 이상이면 고르지 않는다. 미해결 1건 계약이 이미 깨진 상태다.
  if (found.prs.length > 1) return fail('MULTIPLE_AUTO_PRS', `자동 PR 이 ${found.prs.length}건이다 — 1건 계약이 깨졌다`)

  const pr0 = found.prs[0]
  const sha = pr0.headRefOid
  report.pr = { number: pr0.number, url: pr0.url, head: sha, branch: pr0.headRefName }
  log(`대상: #${pr0.number} ${pr0.headRefName} (${String(sha).slice(0, 7)})`)

  // ── ③ CI 를 제한 시간 안에서 관찰 ─────────────────────────
  //    🔴 필수 검사가 **등록되기까지** 늦을 수 있다. 그것도 기다린다 — 유한하게.
  const ci = await observeCi({ sha, deps, now, sleep, log })
  log(`CI: ${ci.outcome} · ${ci.ciState} · 검사 ${ci.checks.length}개 (관찰 ${Math.round(ci.waitedMs / 1000)}초)`)
  report.ci = { outcome: ci.outcome, ciState: ci.ciState, waitedMs: ci.waitedMs, checks: ci.checks.length }
  // 🔴 실패와 시간 초과를 섞지 않는다 — 사람이 할 일이 다르다
  if (ci.outcome === 'TIMEOUT') {
    const pendingNames = ci.checks.filter((c) => c.status !== 'completed').map((c) => c.name)
    const missingNames = REQUIRED_CHECKS.filter((n) => !ci.checks.some((c) => c.name === n))
    const settledButNotGreen = missingNames.length === 0 && pendingNames.length === 0
    report.blockedBy.push({
      code: 'CI_OBSERVE_TIMEOUT',
      message: `${Math.round(CI_OBSERVE_MS / 60000)}분 안에 CI 가 초록이 되지 않았다 (합산 status=${ci.ciState})`
        + `${missingNames.length > 0 ? ` · 필수 검사 미등록: ${missingNames.join(', ')}` : ''}`
        + `${pendingNames.length > 0 ? ` · 아직 도는 중: ${pendingNames.join(', ')}` : ''}`
        // 🔴 check-run 은 다 끝났는데 합산이 안 붙는 경우 — 원인이 다르므로 따로 적는다
        + `${settledButNotGreen ? ' · 검사는 전부 끝났으나 합산 status 가 success 가 아니다' : ''}`
        + ' — 재실행하지 않는다',
    })
  }

  // ── ③-b mergeable 이 정해지기를 기다린다 — 🔴 유한하게 ────
  //    GitHub 은 이것을 비동기로 계산한다. 목록 조회 직후에는 UNKNOWN 이 흔하다.
  //    UNKNOWN 을 그대로 관문에 넣으면 정상 PR 이 매번 NOT_MERGEABLE 로 막힌다.
  const obs = await observeMergeable({ number: pr0.number, deps, now, sleep, log })
  if (!obs.pr) return fail('PR_REFETCH_FAILED', 'PR 을 다시 조회하지 못했다')
  const pr = obs.pr
  log(`mergeable: ${pr.mergeable} (관찰 ${Math.round(obs.waitedMs / 1000)}초)`)

  // ── ④ 소스 — 🔴 공용 로더로 읽는다 ───────────────────────
  let mainArticles; let branchArticles; let mainQueue; let branchQueue
  try {
    mainArticles = parseArticlesSource(deps.showFile(report.baseSha, 'src/content/magazine/articles.ts'), 'main:articles.ts')
    branchArticles = parseArticlesSource(deps.showFile(sha, 'src/content/magazine/articles.ts'), 'pr:articles.ts')
    mainQueue = parseQueueSource(deps.showFile(report.baseSha, 'drafts/magazine/topic-queue.ts'), 'main:topic-queue.ts')
    branchQueue = parseQueueSource(deps.showFile(sha, 'drafts/magazine/topic-queue.ts'), 'pr:topic-queue.ts')
  } catch (e) {
    return fail('SOURCE_PARSE_FAILED', `소스를 읽지 못했다: ${e?.message ?? e}`)
  }

  // 🔴 **전 필드를 넘긴다.** 관문이 남은 항목의 등급뿐 아니라 다른 필드까지 대조한다
  const bySlug = (rows) => Object.fromEntries(rows.map((q) => [q.slug, { ...q, autoEligible: q.autoEligible === true }]))
  const mainBySlug = new Map(mainArticles.map((a) => [a.slug, a]))
  const registered = branchArticles.filter((a) => !mainBySlug.has(a.slug))

  // ── ⑤ 기존 글 불변 — 🔴 자동 PR 은 **더하기만** 한다 ──────
  const touched = []
  for (const a of mainArticles) {
    const after = branchArticles.find((b) => b.slug === a.slug)
    if (!after) { touched.push(`${a.slug} 삭제됨`); continue }
    if (JSON.stringify(after) !== JSON.stringify(a)) touched.push(`${a.slug} 변경됨`)
  }
  if (touched.length > 0) {
    report.blockedBy.push({ code: 'EXISTING_ARTICLE_TOUCHED', message: `기존 글이 바뀌었다: ${touched.join(', ')} — 자동 PR 은 새 글만 더한다` })
  } else report.checked.push(`기존 글 ${mainArticles.length}건 불변`)

  // ── ⑥ 관문 ──────────────────────────────────────────────
  const verdict = judgeAutoMerge({
    pr, expectedSha: sha, files: deps.listPrFiles(pr0.number),
    ciState: ci.ciState, checks: ci.checks,
    registered, queueBySlug: bySlug(mainQueue), branchQueueBySlug: bySlug(branchQueue),
    mainSlugs: new Set(mainArticles.map((a) => a.slug)),
    mainDates: new Set(mainArticles.map((a) => String(a.publishAt ?? '').slice(0, 10)).filter(Boolean)),
    now: now(),
  })
  report.blockedBy.push(...verdict.blockedBy)
  report.checked.push(...verdict.checked)
  report.registered = registered.map((r) => ({ slug: r.slug, publishAt: r.publishAt }))

  // ── ⑦ 마지막 재조회 — 🔴 검증 뒤에 움직였는지 다시 본다 ──
  const fresh = deps.getPr(pr0.number)
  if (!fresh) report.blockedBy.push({ code: 'PR_REFETCH_FAILED', message: 'merge 직전 PR 재조회에 실패했다' })
  else {
    if (fresh.headRefOid !== sha) report.blockedBy.push({ code: 'SHA_DRIFTED_LATE', message: `검증 뒤 HEAD 가 ${String(fresh.headRefOid).slice(0, 7)} 로 바뀌었다` })
    if (fresh.baseRefName !== 'main') report.blockedBy.push({ code: 'BASE_NOT_MAIN', message: `base 가 ${fresh.baseRefName} 다` })
    if (fresh.mergeable !== 'MERGEABLE') report.blockedBy.push({ code: 'NOT_MERGEABLE_LATE', message: `merge 직전 mergeable=${fresh.mergeable}` })
    if (report.blockedBy.length === 0) report.checked.push('merge 직전 재조회 — HEAD·base·mergeable 확인')
  }

  for (const c of report.checked) log(`  ✅ ${c}`)
  for (const b of report.blockedBy) log(`  ⛔ ${b.code}: ${b.message}`)
  if (report.blockedBy.length > 0) return report
  if (!apply) { log('검증 통과 — 실제 merge 는 --apply'); return report }

  // ── ⑧ merge ─────────────────────────────────────────────
  const merged = deps.mergePr(pr0.number, sha)
  if (!merged.ok) return fail('MERGE_FAILED', merged.reason)
  report.merged = true
  report.mergeCommit = merged.mergeCommit ?? null
  log(`✅ merge 완료 — #${pr0.number} · ${String(report.mergeCommit ?? '?').slice(0, 7)}`)

  // ── ⑨ 배포 · 예약 비공개 — 🔴 확인 전에 성공으로 끝내지 않는다 ──
  const deploy = await observeDeploy({ sha: report.mergeCommit, deps, now, sleep, log })
  const slugStatuses = report.registered.map((r) => ({
    slug: r.slug, publishAt: r.publishAt, httpStatus: deps.httpStatus(`${SITE}/magazine/${r.slug}`),
  }))
  const dv = judgeDeploy({
    deployment: deploy.deployment,
    liveDeploymentId: deploy.live,
    expectedSha: report.mergeCommit,
    slugStatuses,
    now: now(),
  })
  report.deploy = {
    outcome: deploy.outcome,
    state: deploy.deployment?.state ?? null,
    deploymentId: deploy.deployment?.deploymentId ?? null,
    live: deploy.live,
    waitedMs: deploy.waitedMs,
    checked: dv.checked,
  }
  report.blockedBy.push(...dv.blockedBy)
  for (const c of dv.checked) log(`  ✅ ${c}`)
  for (const b of dv.blockedBy) log(`  ⛔ ${b.code}: ${b.message}`)

  return report
}

/**
 * 검사가 **다 끝날 때까지** — 🔴 유한하게. 재실행하지 않는다.
 *
 * 🔴 **종료 조건에 필수 검사가 들어간다** (2026-09-16 재검토).
 *    GitHub 은 검사를 **한꺼번에 등록하지 않는다.** 빠른 검사(Vercel Preview Comments 등)가
 *    먼저 붙어 완료되면, 그 순간 목록은 "비어 있지 않고 전부 completed" 다.
 *    아직 필수 검사가 **등록조차 안 됐는데** 관찰을 끝내고
 *    `REQUIRED_CHECK_MISSING` 으로 막았다 — 정상 회차가 매번 실패한다.
 *
 * 🔴 **check-run 이 다 끝나도 합산 status 가 pending 이면 기다린다** (2026-09-16 재검토).
 *    두 값은 다른 곳에서 온다. check-run 은 Actions 가, 합산 status 는 그 밖의
 *    Commit Status API 를 쓰는 것들(Vercel 등)이 올린다.
 *    check-run 이 전부 끝난 순간에도 합산은 아직 pending 일 수 있다.
 *    그때 관찰을 끝내면 관문이 `CI_NOT_GREEN` 으로 막는다 — **정상 회차가 실패한다.**
 *    그래서 `success` 를 볼 때까지 기다린다. 유한하게.
 *
 *    pending → success  진행
 *    failure · error     실패 (기다리지 않는다 — 이미 결론이 났다)
 *    unknown · 조회 실패  🔴 **성공이 아니다.** 계속 보다가 시간이 다하면 TIMEOUT
 *
 * 🔴 **실패와 시간 초과를 구분한다.** 둘 다 "merge 안 함" 이지만 사람이 할 일이 다르다.
 *    FAILED 는 검사를 고쳐야 하고, TIMEOUT 은 아직 도는 중일 수 있다.
 *
 * @returns {{ciState:string, checks:object[], waitedMs:number, outcome:'SETTLED'|'FAILED'|'TIMEOUT'}}
 */
async function observeCi({ sha, deps, now, sleep, log }) {
  const started = now()
  let last = null
  let snap = { ciState: 'unknown', checks: [] }
  for (;;) {
    const r = deps.getChecks(sha)
    const waitedMs = now() - started
    if (r.ok) {
      snap = { ciState: r.ciState, checks: r.checks }
      const byName = new Map(r.checks.map((c) => [c.name, c]))
      const failed = r.checks.filter((c) => c.status === 'completed' && !OK_CONCLUSIONS.includes(c.conclusion ?? ''))
      // 🔴 필수 검사가 skipped·neutral 로 끝난 것도 결론이다 — 기다려도 바뀌지 않는다
      const requiredBad = REQUIRED_CHECKS.filter((n) => {
        const c = byName.get(n)
        return c && c.status === 'completed' && !REQUIRED_CONCLUSIONS.includes(c.conclusion ?? '')
      })
      // 🔴 실패는 기다릴 이유가 없다
      if (failed.length > 0 || requiredBad.length > 0) return { ...snap, waitedMs, outcome: 'FAILED' }
      if (r.ciState === 'failure' || r.ciState === 'error') return { ...snap, waitedMs, outcome: 'FAILED' }

      const requiredSettled = REQUIRED_CHECKS.every((n) => byName.get(n)?.status === 'completed')
      const allSettled = r.checks.length > 0 && r.checks.every((c) => c.status === 'completed')
      // 🔴 합산 status 가 success 일 때만 끝낸다. pending·unknown 은 아직 모르는 것이다.
      if (requiredSettled && allSettled && r.ciState === 'success') return { ...snap, waitedMs, outcome: 'SETTLED' }
    }
    if (waitedMs >= CI_OBSERVE_MS) return { ...snap, waitedMs, outcome: 'TIMEOUT' }

    let note
    if (!r.ok) note = '조회 실패 — 성공으로 보지 않는다'
    else {
      const missing = REQUIRED_CHECKS.filter((n) => !r.checks.some((c) => c.name === n))
      const pending = r.checks.filter((c) => c.status !== 'completed')
      if (missing.length > 0) note = `${r.ciState} · 검사 ${r.checks.length}개 · 필수 미등록 ${missing.join(', ')}`
      else if (pending.length > 0) note = `${r.ciState} · 아직 도는 중 ${pending.map((c) => c.name).join(', ')}`
      else note = `검사는 전부 끝났는데 합산 status 가 ${r.ciState} 다 — success 를 기다린다`
    }
    if (note !== last) { log(`CI 관찰: ${note}`); last = note }
    await sleep(CI_POLL_MS)
  }
}

/** mergeable 이 UNKNOWN 을 벗어날 때까지 — 🔴 유한하게 */
async function observeMergeable({ number, deps, now, sleep, log }) {
  const started = now()
  for (;;) {
    const pr = deps.getPr(number)
    const waitedMs = now() - started
    if (!pr || pr.mergeable !== 'UNKNOWN' || waitedMs >= MERGEABLE_OBSERVE_MS) return { pr, waitedMs }
    log('mergeable 관찰: UNKNOWN — GitHub 이 아직 계산 중이다')
    await sleep(MERGEABLE_POLL_MS)
  }
}

/**
 * merge SHA 의 **Production 배포가 READY 가 되고 운영 도메인에 붙을 때까지** — 🔴 유한하게.
 *
 * 🔴 커밋 합산 status 를 보지 않는다. 그것은 CI 다.
 */
async function observeDeploy({ sha, deps, now, sleep, log }) {
  const started = now()
  let last = null
  let deployment = { found: false, state: null, sha: null, deploymentId: null }
  let live = null
  for (;;) {
    deployment = deps.getProductionDeployment(sha) ?? { found: false, state: null, sha: null, deploymentId: null }
    live = deps.liveDeploymentId()
    const waitedMs = now() - started
    const ready = deployment.found && deployment.state === 'success'
    const served = ready && deployment.deploymentId && live === deployment.deploymentId
    const dead = deployment.found && (deployment.state === 'failure' || deployment.state === 'error')
    if (served || dead || waitedMs >= DEPLOY_OBSERVE_MS) {
      return { deployment, live, waitedMs, outcome: served ? 'SERVED' : dead ? 'FAILED' : 'TIMEOUT' }
    }
    const note = `${deployment.found ? deployment.state : '배포 없음'} · 도메인 ${live ?? '읽지 못함'}`
    if (note !== last) { log(`배포 관찰: ${note}`); last = note }
    await sleep(DEPLOY_POLL_MS)
  }
}

/** publishAt 이 지난 글이 본문·이미지·목록에 다 나왔는가 */
export async function runWatch({ deps }) {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? (() => {})
  if (!deps.fetchMain()) return { ok: false, blockedBy: [{ code: 'FETCH_FAILED', message: 'origin/main 을 가져오지 못했다' }], checked: [] }
  const base = deps.readBaseSha()
  let articles
  try { articles = parseArticlesSource(deps.showFile(base, 'src/content/magazine/articles.ts'), 'main:articles.ts') } catch (e) {
    return { ok: false, blockedBy: [{ code: 'SOURCE_PARSE_FAILED', message: String(e?.message ?? e) }], checked: [] }
  }
  const listHtml = deps.httpBody(`${SITE}/magazine`)
  const rows = articles
    .filter((a) => a.publishAt && Date.parse(a.publishAt) <= now())
    // 🔴 최근 것만 본다. 전수 조회는 매 회차 수십 번의 요청이 된다
    .sort((a, b) => String(b.publishAt).localeCompare(String(a.publishAt)))
    .slice(0, 3)
    .map((a) => ({
      slug: a.slug,
      publishAt: a.publishAt,
      article: deps.httpStatus(`${SITE}/magazine/${a.slug}`),
      // 🔴 **heroImage 가 없으면 `null` 이다. 200 이 아니다** (2026-09-21 사고).
      //    옛 판은 `: 200` 이었다. 대표 이미지가 **아예 없는** 글을
      //    "이미지 확인" 으로 적어 초록으로 넘겼다 — 9/19·9/20 로그가 그 증거다.
      //
      //      ✅ how-long-did-menopause-last 본문·이미지·목록 확인   ← hero 가 없는 글이다
      //
      //    없는 것을 확인했다고 적는 검사는 검사가 아니라 **거짓 보증**이다.
      //    빠진 값은 언제나 실패 쪽으로 떨어뜨린다.
      image: a.heroImage?.src ? deps.httpStatus(`${SITE}${a.heroImage.src}`) : null,
      heroSrc: a.heroImage?.src ?? null,
      inList: typeof listHtml === 'string' && listHtml.includes(a.slug),
    }))
  const v = judgeWatch({ rows, now: now() })
  for (const c of v.checked) log(`  ✅ ${c}`)
  for (const b of v.blockedBy) log(`  ⛔ ${b.code}: ${b.message}`)
  return v
}

// ─────────────────────────────────────────────────────────
// 실제 실행기 — 🔴 여기서만 진짜 명령을 붙인다
// ─────────────────────────────────────────────────────────

const line = (m) => console.log(`[${stamp()}] ${m}`)

const exec = (cmd, args) => {
  const r = spawnSync(cmd, [...args], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) return { code: 1, out: '', err: String(r.error.message ?? r.error) }
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

/**
 * 실제 실행기를 만든다.
 *
 * 🔴 **`exec` 를 주입받는다** (2026-09-17).
 *    직전 판은 모듈 안의 `exec` 를 직접 썼다. 그래서 **실제로 어떤 gh 명령을
 *    조립하는지**를 시험할 방법이 없었고, 회귀의 가짜 `getPr` 이 실제보다
 *    풍부한 객체를 돌려주는 바람에 `headRefName` 누락을 아무도 못 봤다.
 *    이제 가짜 `exec` 로 **명령 인자와 응답 파싱까지** 시험한다.
 */
export function makeRealDeps(exec, { log: logFn = line } = {}) {
  return {
  log: logFn,
  fetchMain: () => exec('git', ['fetch', 'origin', 'main']).code === 0,
  readBaseSha: () => { const r = exec('git', ['rev-parse', 'origin/main']); return r.code === 0 ? r.out.trim() : null },
  showFile: (sha, path) => {
    const r = exec('git', ['show', `${sha}:${path}`])
    if (r.code !== 0) throw new Error(`git show ${String(sha).slice(0, 7)}:${path} 실패`)
    return r.out
  },
  listAutoPrs: () => {
    // 🔴 상세 조회와 **같은** 필드 계약을 쓴다
    const r = exec('gh', ['pr', 'list', '--state', 'open', '--limit', '50', '--json', PR_FIELDS_ARG])
    if (r.code !== 0) return { ok: false, reason: 'gh 로 PR 목록을 읽지 못했다' }
    try {
      const list = JSON.parse(r.out || '[]')
      return { ok: true, prs: list.filter((p) => String(p.headRefName ?? '').startsWith(AUTO_BRANCH_PREFIX)) }
    } catch { return { ok: false, reason: 'PR 목록을 해석하지 못했다' } }
  },
  getPr: (number) => {
    // 🔴 목록 조회와 **같은** 필드 계약을 쓴다 — 갈라지면 관문이 정상 PR 을 막는다
    const r = exec('gh', ['pr', 'view', String(number), '--json', PR_FIELDS_ARG])
    if (r.code !== 0) return null
    try { return JSON.parse(r.out) } catch { return null }
  },
  listPrFiles: (number) => {
    const r = exec('gh', ['pr', 'view', String(number), '--json', 'files'])
    if (r.code !== 0) return []
    try { return (JSON.parse(r.out || '{}').files ?? []).map((f) => f.path) } catch { return [] }
  },
  getChecks: (sha) => {
    const s = exec('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/status`, '--jq', '.state'])
    const c = exec('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/check-runs`, '--jq', '[.check_runs[] | {name, status, conclusion}]'])
    if (s.code !== 0 || c.code !== 0) return { ok: false, ciState: 'unknown', checks: [] }
    try { return { ok: true, ciState: s.out.trim(), checks: JSON.parse(c.out || '[]') } } catch { return { ok: false, ciState: 'unknown', checks: [] } }
  },
  mergePr: (number, sha) => {
    const r = exec('gh', ['pr', 'merge', String(number), '--squash', '--match-head-commit', sha])
    if (r.code !== 0) return { ok: false, reason: (r.err || r.out).split('\n').pop() }
    const after = exec('gh', ['pr', 'view', String(number), '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'])
    return { ok: true, mergeCommit: after.code === 0 ? after.out.trim() : null }
  },
  /**
   * 🔴 **커밋 합산 status 를 쓰지 않는다.** 그것은 CI 다 — 검사가 초록이면
   *    운영 도메인이 옛 빌드여도 success 가 된다.
   *    GitHub **Deployments API** 로 그 SHA 의 Production 배포와 상태를 읽고,
   *    Vercel status 의 target_url 에서 배포 id 를 뽑는다.
   *    (둘 다 이미 쓰고 있는 `gh` 읽기 권한이다 — 새 토큰도 과금도 없다)
   */
  getProductionDeployment: (sha) => {
    const miss = { found: false, state: null, sha: null, deploymentId: null }
    if (!sha) return miss
    const d = exec('gh', ['api', `repos/{owner}/{repo}/deployments?sha=${sha}&environment=Production&per_page=1`])
    if (d.code !== 0) return miss
    let dep
    try { dep = JSON.parse(d.out || '[]')[0] } catch { return miss }
    if (!dep) return miss

    const st = exec('gh', ['api', `repos/{owner}/{repo}/deployments/${dep.id}/statuses?per_page=1`, '--jq', '.[0].state'])
    const state = st.code === 0 ? st.out.trim() || null : null

    // 배포 id — Vercel 커밋 status 의 target_url 끝 조각이 그것이다
    const v = exec('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/status`, '--jq', '.statuses[] | select(.context == "Vercel") | .target_url'])
    const url = v.code === 0 ? v.out.trim().split('\n')[0] : ''
    const tail = (url.match(/\/([A-Za-z0-9]{20,})\s*$/) ?? [, null])[1]
    return { found: true, state, sha: dep.sha ?? null, deploymentId: tail ? `dpl_${tail}` : null }
  },

  /**
   * 🔴 **운영 도메인이 지금 서빙 중인 배포.** 추측하지 않고 표식을 읽는다 —
   *    Vercel 이 `next/image` URL 에 `dpl=dpl_<id>` 를 심는다.
   *    못 읽으면 null 이다. 판정이 `PRODUCTION_UNVERIFIED` 로 막는다.
   */
  liveDeploymentId: () => {
    for (const path of ['', '/magazine']) {
      const r = exec('curl', ['-s', '-L', '--max-time', '25', `${SITE}${path}`])
      if (r.code !== 0) continue
      const m = r.out.match(/dpl_[A-Za-z0-9]+/)
      if (m) return m[0]
    }
    return null
  },
  // 🔴 실패하면 null 이다. 404 로 속이지 않는다 — 판정이 CHECK_UNREACHABLE 로 막는다
  httpStatus: (url) => {
    const r = exec('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '25', url])
    if (r.code !== 0) return null
    const n = Number(r.out.trim())
    return Number.isFinite(n) && n > 0 ? n : null
  },
  httpBody: (url) => {
    const r = exec('curl', ['-s', '-L', '--max-time', '25', url])
    return r.code === 0 ? r.out : null
  },
  }
}

/** 실제 회차가 쓰는 실행기 */
export const realDeps = makeRealDeps(exec)

async function main() {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const asJson = argv.includes('--json')
  const notifySend = argv.includes('--notify-send')

  if (argv.includes('--watch')) {
    line('예약 공개 감시')
    const v = await runWatch({ deps: realDeps })
    /**
     * 🔴 **조용히 실패하지 않는다.** 예약한 글이 시간이 지나도 안 나오거나,
     *    대표 이미지가 깨졌거나, 목록에서 빠졌다면 그것은 독자가 먼저 겪는 사고다.
     *    무인 운영에서 그것을 알려 줄 사람은 이 알림밖에 없다.
     */
    if (!v.ok) {
      const r = await send(buildMessage({
        severity: 'ERROR',
        title: '매거진 공개 확인 실패 — 예약한 글이 제대로 안 보인다',
        reason: v.blockedBy.map((b) => `${b.code}: ${b.message}`).join(' / '),
        next: `${SITE}/magazine`,
      }), { dryRun: !notifySend })
      line(`Slack: ${r.sent ? '발송' : `미발송 — ${r.reason}`}`)
    }
    if (asJson) console.log(JSON.stringify(v, null, 2))
    line(`종료 (코드 ${v.ok ? 0 : 1})`)
    process.exit(v.ok ? 0 : 1)
  }

  line(`자동 병합 ${apply ? '(🔴 실제 merge)' : '(검증만)'}`)
  const report = await runAutoMerge({ apply, deps: realDeps })
  const code = report.blockedBy.length > 0 ? 1 : 0

  if (apply) {
    const msg = buildMessage({
      severity: code ? 'ERROR' : 'INFO',
      title: report.merged
        ? `매거진 자동 병합 — #${report.pr?.number} merge${code ? ' (확인 실패)' : ' 완료'}`
        : code ? '매거진 자동 병합 중단' : '매거진 자동 병합 — 할 것이 없다',
      reason: report.blockedBy.map((b) => `${b.code}: ${b.message}`).join(' / ') || null,
      next: report.pr?.url ?? null,
    })
    const r = await send(msg, { dryRun: !notifySend })
    line(`Slack: ${r.sent ? '발송' : `미발송 — ${r.reason}`}`)
  }
  /**
   * 🔴 **결과를 파일로 남긴다** (2026-09-17).
   *    부른 쪽이 종료 코드만 보고 "자동 병합 완료" 라고 적는 일을 없앤다.
   *    종료 코드 0 은 "할 일이 없었다" 도 포함한다 — 그것은 공급 성공이 아니다.
   */
  try {
    const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    const dir = join(DRAFTS_DIR, '_runs', date)
    mkdirSync(dir, { recursive: true })
    // 🔴 회차 식별자를 함께 남긴다. 없으면 부른 쪽이 **앞 회차 파일**을 이번 실적으로 읽는다.
    const stamped = { ...report, runId: argv.includes('--run-id') ? argv[argv.indexOf('--run-id') + 1] ?? null : null, writtenAt: new Date().toISOString() }
    writeFileSync(join(dir, 'auto-merge.json'), `${JSON.stringify(stamped, null, 2)}\n`, 'utf8')
  } catch (e) {
    line(`결과 파일을 남기지 못했다 (${e?.message ?? e}) — 판정은 그대로다`)
  }

  if (asJson) console.log(JSON.stringify(report, null, 2))
  line(`종료 (코드 ${code})`)
  process.exit(code)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-auto-merge.mjs')) main()
