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

  // CI
  const statusRes = exec('gh', ['api', `repos/{owner}/{repo}/commits/${pr.headRefOid}/status`, '--jq', '.state'])
  const ciState = statusRes.code === 0 ? statusRes.out.trim() : 'unknown'
  const checksRes = exec('gh', ['api', `repos/{owner}/{repo}/commits/${pr.headRefOid}/check-runs`, '--jq', '[.check_runs[] | {name, status, conclusion}]'])
  let checks = []
  try { checks = JSON.parse(checksRes.out || '[]') } catch { checks = [] }

  // PR 브랜치와 main 의 내용
  const branchArticles = exec('git', ['show', `${pr.headRefOid}:src/content/magazine/articles.ts`])
  const mainArticles = exec('git', ['show', 'origin/main:src/content/magazine/articles.ts'])
  const branchQueue = exec('git', ['show', `${pr.headRefOid}:drafts/magazine/topic-queue.ts`])
  if (branchArticles.code !== 0 || mainArticles.code !== 0) {
    report.blockedBy = [{ code: 'READ_FAILED', message: 'articles.ts 를 읽지 못했다 (fetch 가 필요할 수 있다)' }]
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
    registered, queueBySlug: parseQueue(branchQueue.out), mainSlugs, mainDates, now: Date.now(),
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
