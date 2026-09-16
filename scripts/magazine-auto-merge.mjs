#!/usr/bin/env node
/**
 * 자동 PR 병합 — 🔴 **기본은 dry-run. `--apply` 만 실제로 merge 한다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **경계**
 *    한다      검증 → squash merge → 배포 확인 → **예약 상태 확인**
 *    안 한다   공개 앞당기기 · 사람 PR merge · HIGH 병합 · 실패 시 재시도
 *
 *    merge 해도 글은 `publishAt` 전까지 나가지 않는다. 이 스크립트가 마지막으로
 *    확인하는 것이 바로 그것이다 — **merge 했는데 즉시 공개되면 그것은 사고다.**
 *
 * 🔴 **모르면 막는다.** 확인하지 못한 항목이 하나라도 있으면 merge 하지 않는다.
 *    판정은 `lib/magazine-merge-gate.mjs` 에 있다.
 *
 * 🔴 **재시도하지 않는다.** 막히면 그 회차는 끝이다. 사유를 남기고 다음 회차를 기다린다.
 *
 * 사용법
 *   node scripts/magazine-auto-merge.mjs              검증만 (변경 0)
 *   node scripts/magazine-auto-merge.mjs --apply      🔴 실제 merge
 *   node scripts/magazine-auto-merge.mjs --json
 *
 * 종료 코드: merge 했거나 할 것이 없으면 0 · 막혔으면 1
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUTO_BRANCH_PREFIX, judgeAutoMerge } from './lib/magazine-merge-gate.mjs'
import { buildMessage, send } from './lib/slack-notify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const exec = (cmd, args) => {
  const r = spawnSync(cmd, [...args], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) return { code: 1, out: '', err: String(r.error.message ?? r.error) }
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

const stamp = () => `${new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)} KST`
const line = (m) => console.log(`[${stamp()}] ${m}`)

// ─────────────────────────────────────────────────────────
// 읽기 — 🔴 전부 읽기 전용이다
// ─────────────────────────────────────────────────────────

/** articles.ts 문자열에서 slug·예약일을 뽑는다. vm 을 쓰지 않는다 */
export function parseArticles(src) {
  const rows = []
  let cur = null
  for (const l of String(src ?? '').split('\n')) {
    const m = l.match(/^ {2}'([a-z0-9-]+)': \{/)
    if (m) { cur = { slug: m[1] }; rows.push(cur); continue }
    if (!cur) continue
    const g = (k) => (l.match(new RegExp(`^\\s+${k}: '([^']*)'`)) ?? [])[1]
    for (const k of ['publishedAt', 'publishAt', 'status']) {
      const v = g(k)
      if (v !== undefined && cur[k] === undefined) cur[k] = v
    }
  }
  return rows
}

/** 큐에서 slug → {riskLevel, autoEligible} */
export function parseQueue(src) {
  const out = {}
  const text = String(src ?? '')
  const re = /slug:\s*'([a-z0-9-]+)'/g
  let m
  while ((m = re.exec(text)) !== null) {
    const slug = m[1]
    const window = text.slice(m.index, m.index + 900)
    out[slug] = {
      riskLevel: (window.match(/riskLevel:\s*'([A-Z]+)'/) ?? [])[1] ?? null,
      autoEligible: /autoEligible:\s*true/.test(window),
    }
  }
  return out
}

function readAutoPr() {
  const r = exec('gh', ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,url,headRefName,headRefOid,state,mergeable,isDraft'])
  if (r.code !== 0) return { ok: false, reason: 'gh 로 PR 목록을 읽지 못했다' }
  let list = []
  try { list = JSON.parse(r.out || '[]') } catch { return { ok: false, reason: 'PR 목록을 해석하지 못했다' } }
  const auto = list.filter((p) => String(p.headRefName ?? '').startsWith(AUTO_BRANCH_PREFIX))
  if (auto.length === 0) return { ok: true, pr: null }
  // 🔴 둘 이상이면 고르지 않는다. 미해결 1건 계약이 이미 깨진 상태다.
  if (auto.length > 1) return { ok: false, reason: `자동 PR 이 ${auto.length}건이다 — 1건 계약이 깨졌다 (${auto.map((p) => `#${p.number}`).join(' ')})` }
  return { ok: true, pr: auto[0] }
}

/**
 * 고정 SHA 의 CI 를 제한 시간 동안 관찰한다.
 *
 * 🔴 **재실행하지 않는다.** 실패한 검사를 다시 돌리는 손잡이는 이 경로에 없다.
 * 🔴 **무한 대기하지 않는다.** 제한 시간이 지나면 그때의 상태로 판정한다 —
 *    아직 도는 중이면 관문이 `CHECK_PENDING` 으로 막는다.
 * 🔴 SHA 를 고정해 본다. 그 사이 커밋이 붙어도 우리가 보는 것은 검증한 커밋이다.
 */
export const CI_OBSERVE_MS = 12 * 60 * 1000
export const CI_POLL_MS = 30 * 1000

async function observeChecks(sha, { maxMs = CI_OBSERVE_MS, pollMs = CI_POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const started = Date.now()
  for (;;) {
    const statusRes = exec('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/status`, '--jq', '.state'])
    const ciState = statusRes.code === 0 ? statusRes.out.trim() : 'unknown'
    const checksRes = exec('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/check-runs`, '--jq', '[.check_runs[] | {name, status, conclusion}]'])
    let checks = []
    try { checks = JSON.parse(checksRes.out || '[]') } catch { checks = [] }
    // 🔴 조회 자체가 실패하면 목록을 비워 둔다 — 관문이 CHECKS_EMPTY 로 막는다
    if (checksRes.code !== 0) checks = []

    const waitedMs = Date.now() - started
    const settled = ciState !== 'pending' && checks.length > 0 && checks.every((c) => c.status === 'completed')
    if (settled || waitedMs >= maxMs) return { ciState, checks, waitedMs }
    await sleep(pollMs)
  }
}

/**
 * merge 한 SHA 가 **실제로 배포됐고**, 등록한 글이 **아직 안 나왔는지** 본다.
 *
 * 🔴 확인 전에 성공으로 끝내지 않는다. 배포가 안 됐거나 글이 벌써 보이면 그것은 사고다.
 * 🔴 제한 시간이 있다. 무한 대기하지 않는다.
 */
export function judgeDeploy({ deployState, slugStatuses, now }) {
  const blockedBy = []
  if (deployState !== 'success') {
    blockedBy.push({ code: 'DEPLOY_NOT_READY', message: `merge SHA 의 배포 상태가 ${deployState} 다` })
  }
  for (const s of slugStatuses ?? []) {
    const due = Date.parse(s.publishAt)
    const shouldBeHidden = Number.isFinite(due) && due > now
    if (shouldBeHidden && s.httpStatus === 200) {
      // 🔴 이것이 최악의 사고다 — 예약 글이 미리 나갔다
      blockedBy.push({ code: 'PUBLISHED_EARLY', message: `${s.slug} 가 publishAt(${s.publishAt}) 전에 공개됐다` })
    }
    if (!shouldBeHidden && s.httpStatus !== 200) {
      blockedBy.push({ code: 'NOT_PUBLISHED', message: `${s.slug} 는 publishAt 이 지났는데 공개되지 않았다 (HTTP ${s.httpStatus})` })
    }
  }
  return { ok: blockedBy.length === 0, blockedBy }
}

// ─────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const asJson = argv.includes('--json')
  const notifySend = argv.includes('--notify-send')
  const report = { mode: apply ? 'apply' : 'verify', pr: null, blockedBy: [], checked: [], merged: false }

  line(`자동 병합 ${apply ? '(🔴 실제 merge)' : '(검증만)'}`)

  const found = readAutoPr()
  if (!found.ok) {
    report.blockedBy = [{ code: 'PR_LOOKUP_FAILED', message: found.reason }]
    return finish(report, { apply, asJson, notifySend, code: 1 })
  }
  if (!found.pr) {
    line('자동 PR 이 없다 — 할 것이 없다')
    return finish(report, { apply, asJson, notifySend, code: 0 })
  }

  const pr = found.pr
  report.pr = { number: pr.number, url: pr.url, head: pr.headRefOid, branch: pr.headRefName }
  line(`대상: #${pr.number} ${pr.headRefName} (${String(pr.headRefOid).slice(0, 7)})`)

  // 변경 파일
  const filesRes = exec('gh', ['pr', 'view', String(pr.number), '--json', 'files'])
  let files = []
  try { files = (JSON.parse(filesRes.out || '{}').files ?? []).map((f) => f.path) } catch { files = [] }

  // ── CI — 🔴 **고정 HEAD** 의 필수 검사가 끝날 때까지 제한 시간 동안만 본다
  //
  //    무한 대기하지 않는다. 재실행하지 않는다. 보호 규칙을 우회하지 않는다.
  //    조회에 실패하면 'unknown' 이 되어 관문이 막는다 — fail closed.
  const { ciState, checks, waitedMs } = await observeChecks(pr.headRefOid)
  line(`CI: ${ciState} · 검사 ${checks.length}개 (관찰 ${Math.round(waitedMs / 1000)}초)`)

  // PR 브랜치와 main 의 내용
  const branchArticles = exec('git', ['show', `${pr.headRefOid}:src/content/magazine/articles.ts`])
  const mainArticles = exec('git', ['show', 'origin/main:src/content/magazine/articles.ts'])
  const branchQueue = exec('git', ['show', `${pr.headRefOid}:drafts/magazine/topic-queue.ts`])
  // 🔴 **등급 정본은 등록 전 큐(최신 main)다.** PR 의 큐에는 등록한 slug 가 **삭제돼 있다** —
  //    register 가 등록하면서 큐에서 빼기 때문이다(2026-09-16 실측).
  //    PR 쪽 큐에서 등급을 찾으면 언제나 NOT_IN_QUEUE 로 막히고,
  //    설령 찾더라도 **PR 이 스스로 등급을 낮춰 통과**할 수 있다.
  const mainQueue = exec('git', ['show', 'origin/main:drafts/magazine/topic-queue.ts'])
  if (branchArticles.code !== 0 || mainArticles.code !== 0 || mainQueue.code !== 0 || branchQueue.code !== 0) {
    report.blockedBy = [{ code: 'READ_FAILED', message: 'articles.ts · topic-queue.ts 를 읽지 못했다 (fetch 가 필요할 수 있다)' }]
    return finish(report, { apply, asJson, notifySend, code: 1 })
  }

  const mainRows = parseArticles(mainArticles.out)
  const branchRows = parseArticles(branchArticles.out)
  const mainSlugs = new Set(mainRows.map((r) => r.slug))
  const mainDates = new Set(mainRows.map((r) => String(r.publishAt ?? '').slice(0, 10)).filter(Boolean))
  // 🔴 이 PR 이 **새로 더하는** 것만 본다
  const registered = branchRows.filter((r) => !mainSlugs.has(r.slug))

  const verdict = judgeAutoMerge({
    pr, expectedSha: pr.headRefOid, files, ciState, checks,
    registered,
    queueBySlug: parseQueue(mainQueue.out),          // 🔴 등록 전 — 등급 정본
    branchQueueBySlug: parseQueue(branchQueue.out),  // PR 이 등급을 고쳤는지 대조
    mainSlugs, mainDates, now: Date.now(),
  })
  report.blockedBy = verdict.blockedBy
  report.checked = verdict.checked
  report.registered = registered.map((r) => ({ slug: r.slug, publishAt: r.publishAt }))

  for (const c of verdict.checked) line(`  ✅ ${c}`)
  for (const b of verdict.blockedBy) line(`  ⛔ ${b.code}: ${b.message}`)

  if (!verdict.ok) return finish(report, { apply, asJson, notifySend, code: 1 })
  if (!apply) {
    line('검증 통과 — 실제 merge 는 --apply')
    return finish(report, { apply, asJson, notifySend, code: 0 })
  }

  // ── merge ────────────────────────────────────────────────
  // 🔴 검증한 그 SHA 만. 그 사이 커밋이 붙었으면 gh 가 거부한다.
  const merged = exec('gh', ['pr', 'merge', String(pr.number), '--squash', '--match-head-commit', pr.headRefOid])
  if (merged.code !== 0) {
    report.blockedBy.push({ code: 'MERGE_FAILED', message: (merged.err || merged.out).split('\n').pop() })
    return finish(report, { apply, asJson, notifySend, code: 1 })
  }
  report.merged = true
  line(`✅ merge 완료 — #${pr.number}`)

  const after = exec('gh', ['pr', 'view', String(pr.number), '--json', 'state,mergeCommit', '--jq', '"\\(.state) \\(.mergeCommit.oid)"'])
  report.mergeCommit = after.out.split(' ')[1] ?? null
  line(`merge SHA: ${report.mergeCommit ?? '?'}`)

  return finish(report, { apply, asJson, notifySend, code: 0 })
}

async function finish(report, { apply, asJson, notifySend, code }) {
  // 🔴 실제 merge 회차는 반드시 알린다. 무인으로 main 이 바뀌는 자리다.
  if (apply) {
    const blocked = report.blockedBy.length
    const msg = buildMessage({
      severity: blocked ? 'ERROR' : 'INFO',
      title: report.merged
        ? `매거진 자동 병합 — #${report.pr?.number} merge 완료`
        : blocked ? '매거진 자동 병합 중단' : '매거진 자동 병합 — 할 것이 없다',
      reason: blocked ? report.blockedBy.map((b) => `${b.code}: ${b.message}`).join(' / ') : null,
      next: report.pr?.url ?? null,
    })
    const r = await send(msg, { dryRun: !notifySend })
    line(`Slack: ${r.sent ? '발송' : `미발송 — ${r.reason}`}`)
  }
  if (asJson) console.log(JSON.stringify(report, null, 2))
  line(`종료 (코드 ${code})`)
  process.exit(code)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-auto-merge.mjs')) main()
