#!/usr/bin/env node
/**
 * LOW/MEDIUM 자동 발행 레인 — 후보 스캐너 · 일괄 실행 · 리포트.
 *
 *   producer(01:00) 다음에 이것이 돈다.
 *   producer 가 고른 것 또는 큐 전체에서 자동 레인 대상만 골라 끝까지 몰고 간다.
 *
 * 🔴 기본이 dry-run 이다. --write 없이는 파일 변경 0건이다.
 * 🔴 HIGH · autoEligible=false · 큐에 없는 slug 는 gate 에서 끝난다 (magazine-auto-lane.mjs).
 * 🔴 register 에 --founder-approved 를 넘기지 않는다.
 * 🔴 PR 은 --write --pr 를 함께 줬을 때만 만든다. 제목에 [merge 금지] 를 붙인다.
 * 🔴 Slack 은 --notify 를 줬을 때만 나간다. 없으면 콘솔·JSON 리포트로 끝난다.
 *
 * 사용법
 *   node scripts/magazine-auto-register-ready.mjs --dry-run
 *   node scripts/magazine-auto-register-ready.mjs --dry-run --json
 *   node scripts/magazine-auto-register-ready.mjs --run 2026-09-02 --dry-run
 *   node scripts/magazine-auto-register-ready.mjs --write --pr
 *   node scripts/magazine-auto-register-ready.mjs --write --pr --notify
 *   node scripts/magazine-auto-register-ready.mjs --dry-run --notify   리포트만 Slack
 *
 * 종료 코드: 진행 대상이 하나도 없으면 0, BLOCKED 가 있으면 1
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadQueue, loadArticles, DRAFTS_DIR } from './lib/magazine-load.mjs'
import { gate, progress, paths } from './lib/magazine-auto-lane.mjs'
import { drive } from './magazine-auto-register.mjs'
import { buildMessage, send, webhookStatus } from './lib/slack-notify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 하루 1건. 첫 예약 후보일은 내일부터 본다 — 오늘 10:30 은 이미 지났을 수 있다 */
const SLOT_START_OFFSET_DAYS = 1

function kstDate(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10)
}

/** 이미 잡힌 날짜. register.mjs 와 같은 규칙으로 읽는다 */
function takenDates() {
  const taken = new Set()
  for (const a of loadArticles()) {
    const iso = a.publishAt ?? (a.publishedAt ? `${a.publishedAt}T10:30:00+09:00` : null)
    if (!iso) continue
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) taken.add(new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10))
    if (typeof a.publishedAt === 'string') taken.add(a.publishedAt)
  }
  return taken
}

/**
 * 빈 슬롯을 앞에서부터 나눠 준다.
 * 🔴 여기서 고른 날짜가 틀려도 안전하다 — register 가 슬롯을 다시 보고 BLOCKED 를 낸다.
 */
function slotAllocator(from) {
  const taken = takenDates()
  let cursor = from
  return () => {
    while (taken.has(cursor)) cursor = kstDateAfter(cursor)
    const picked = cursor
    taken.add(picked)
    cursor = kstDateAfter(cursor)
    return picked
  }
}

function kstDateAfter(date) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400 * 1000).toISOString().slice(0, 10)
}

/** producer 가 고른 것 (있으면) — 없으면 큐 전체를 훑는다 */
function slugsFromRun(date) {
  const file = join(DRAFTS_DIR, '_runs', date, 'run.json')
  if (!existsSync(file)) return null
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return (j.selected ?? []).map((s) => s.slug)
  } catch {
    return null
  }
}

/** 자동 레인 후보 — gate 를 통과하고 brief 가 이미 있는 것만 */
export function scan({ runDate = null } = {}) {
  const queue = loadQueue()
  const fromRun = runDate ? slugsFromRun(runDate) : null
  const pool = fromRun ?? queue.map((q) => q.slug)

  const eligible = []
  const skipped = []
  for (const slug of pool) {
    const g = gate(slug, queue)
    if (g.ok) {
      eligible.push({ slug, item: g.item, progress: progress(slug) })
    } else {
      skipped.push({ slug, riskLevel: g.item?.riskLevel ?? null, blockedBy: g.blockedBy })
    }
  }
  return { source: fromRun ? `run:${runDate}` : 'queue', pool: pool.length, eligible, skipped }
}

// ── PR ─────────────────────────────────────────────────────

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' })
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

/**
 * 등록된 slug 들의 변경 파일만 명시 stage 해서 [merge 금지] PR 을 만든다.
 * 🔴 `git add .` 을 쓰지 않는다. 파일을 하나씩 이름으로 넣는다.
 */
function openPr(doneSlugs) {
  if (doneSlugs.length === 0) return { made: false, reason: '등록된 건이 없다' }

  const branch = `feat/magazine-auto-register-${kstDate()}`
  const created = sh('git', ['switch', '-c', branch])
  if (created.code !== 0 && !/already exists/.test(created.err)) {
    return { made: false, reason: `브랜치 생성 실패: ${created.err.split('\n').pop()}` }
  }

  const files = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts']
  for (const slug of doneSlugs) {
    const p = paths(slug)
    for (const f of [p.draftMd, p.articleTs]) if (existsSync(f)) files.push(f.replace(`${ROOT}/`, ''))
    const hero = join(ROOT, 'public/magazine', slug, 'hero.webp')
    if (existsSync(hero)) files.push(`public/magazine/${slug}/hero.webp`)
  }
  const added = sh('git', ['add', ...files])
  if (added.code !== 0) return { made: false, reason: `stage 실패: ${added.err.split('\n').pop()}` }

  const staged = sh('git', ['diff', '--cached', '--name-only'])
  if (!staged.out) return { made: false, reason: '변경 파일이 없다' }

  const title = `[merge 금지] feat(magazine): LOW/MEDIUM 자동 등록 ${doneSlugs.length}건 (${kstDate()})`
  const body = [
    '자동 레인(`magazine-auto-register-ready.mjs`)이 만든 등록 PR 이다.',
    '',
    `등록: ${doneSlugs.join(', ')}`,
    '',
    '게이트: topic-queue 정본 · riskLevel LOW/MEDIUM · autoEligible=true ·',
    'magazine QA FAIL 0 · batch-qa READY(--strict-auto) · register 통과.',
    'HIGH 와 autoEligible=false 는 gate 에서 제외됐다. --founder-approved 는 쓰지 않았다.',
    '',
    '🔴 merge 는 창업자 승인 후에 한다.',
  ].join('\n')

  const committed = sh('git', ['commit', '-m', title.replace('[merge 금지] ', ''), '-m', body])
  if (committed.code !== 0) return { made: false, reason: `commit 실패: ${committed.err.split('\n').pop()}` }

  const pushed = sh('git', ['push', '-u', 'origin', branch])
  if (pushed.code !== 0) return { made: false, reason: `push 실패: ${pushed.err.split('\n').pop()}` }

  const pr = sh('gh', ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--head', branch])
  if (pr.code !== 0) return { made: false, reason: `PR 생성 실패: ${pr.err.split('\n').pop()}`, branch }
  return { made: true, branch, url: pr.out.split('\n').pop() }
}

// ── 리포트 ─────────────────────────────────────────────────

function reportPath(date) {
  return join(DRAFTS_DIR, '_runs', date, 'auto-register.json')
}

function writeReport(report, { write }) {
  const date = kstDate()
  const dir = join(DRAFTS_DIR, '_runs', date)
  if (!write) return { written: false, path: reportPath(date), reason: 'dry-run' }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(reportPath(date), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { written: true, path: reportPath(date) }
}

function severityOf(report) {
  if (report.done.length > 0) return 'INFO'
  if (report.blocked.length > 0) return 'WARN'
  return 'INFO'
}

async function notifySlack(report, { dryRun }) {
  const done = report.done.length
  const blocked = report.blocked.length
  if (done === 0 && blocked === 0) return { sent: false, reason: '알릴 것 없음' }
  const msg = buildMessage({
    severity: severityOf(report),
    title: `매거진 자동 레인 — 등록 ${done}건 · 막힘 ${blocked}건${dryRun ? ' (dry-run)' : ''}`,
    reason: blocked ? report.blocked.map((b) => `${b.slug}: ${b.blockedBy[0]?.code ?? '-'}`).join(' / ') : null,
    next: report.pr?.url ?? (dryRun ? 'dry-run — 등록도 PR 도 하지 않았다' : null),
  })
  return await send(msg, { dryRun })
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`LOW/MEDIUM 자동 발행 레인 — 후보 스캔 · 일괄 실행

  node scripts/magazine-auto-register-ready.mjs --dry-run
  node scripts/magazine-auto-register-ready.mjs --dry-run --json
  node scripts/magazine-auto-register-ready.mjs --run YYYY-MM-DD --dry-run
  node scripts/magazine-auto-register-ready.mjs --write --pr
  node scripts/magazine-auto-register-ready.mjs --write --pr --notify

  --dry-run   파일 변경 0건 (기본)
  --write     회수·변환·hero·register 를 실제로 수행
  --pr        --write 와 함께일 때만 [merge 금지] PR 생성
  --notify    Slack 발송 (없으면 콘솔·JSON 리포트만)
  --limit N   한 번에 처리할 최대 건수 (기본 3)
  --run DATE  그날 producer 선정분만 (없으면 큐 전체)
  --json      리포트를 JSON 으로

🔴 HIGH · autoEligible=false · 큐에 없는 slug 는 gate 에서 제외된다.`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const arg = (n) => {
    const i = argv.indexOf(n)
    return i === -1 ? null : argv[i + 1]
  }
  const write = argv.includes('--write')
  if (!write && !argv.includes('--dry-run')) {
    console.error('  --dry-run 또는 --write 를 명시해야 한다')
    process.exit(2)
  }
  const limit = Number(arg('--limit') ?? 3)
  const wantPr = argv.includes('--pr')
  const asJson = argv.includes('--json')

  const scanned = scan({ runDate: arg('--run') })
  const nextSlot = slotAllocator(kstDate(SLOT_START_OFFSET_DAYS))

  const done = []
  const blocked = []
  const results = []
  for (const cand of scanned.eligible.slice(0, limit)) {
    const publishAt = nextSlot()
    const r = drive(cand.slug, { write, pr: wantPr, publishAt, alt: null, allowOptional: false })
    r.publishAt = publishAt
    results.push(r)
    if (r.verdict === 'BLOCKED') blocked.push(r)
    else if (r.verdict === 'DONE') done.push(r)
  }

  const report = {
    generatedAt: new Date().toISOString(),
    kstDate: kstDate(),
    mode: write ? 'write' : 'dry-run',
    source: scanned.source,
    pool: scanned.pool,
    eligible: scanned.eligible.length,
    processed: results.length,
    done: done.map((r) => ({ slug: r.slug, publishAt: r.publishAt })),
    blocked: blocked.map((r) => ({ slug: r.slug, blockedBy: r.blockedBy })),
    dryRunOk: results.filter((r) => r.verdict === 'DRY_RUN_OK').map((r) => r.slug),
    dryRunIncomplete: results.filter((r) => r.verdict === 'DRY_RUN_INCOMPLETE').map((r) => r.slug),
    gateSkipped: scanned.skipped.map((s) => ({ slug: s.slug, riskLevel: s.riskLevel, codes: s.blockedBy.map((b) => b.code) })),
    steps: results.map((r) => ({ slug: r.slug, verdict: r.verdict, steps: r.steps })),
    pr: null,
  }

  if (write && wantPr && done.length > 0) report.pr = openPr(done.map((r) => r.slug))

  const saved = writeReport(report, { write })
  report.reportPath = saved.path

  if (argv.includes('--notify')) {
    report.slack = await notifySlack(report, { dryRun: !write })
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('')
    console.log(`  매거진 자동 레인 — ${report.mode} · 출처 ${report.source}`)
    console.log(`  후보 ${report.pool}건 중 gate 통과 ${report.eligible}건 · 처리 ${report.processed}건`)
    console.log('')
    for (const r of results) {
      const mark = r.verdict === 'BLOCKED' ? '⛔' : r.verdict === 'DONE' ? '✅' : '·'
      console.log(`  ${mark} ${r.slug} — ${r.verdict} (publishAt ${r.publishAt})`)
      for (const s of r.steps) {
        const m = s.status === 'ok' ? '✅' : s.status === 'skip' ? '·' : '⛔'
        console.log(`       ${m} ${s.stage.padEnd(9)} ${s.detail}`)
      }
    }
    console.log('')
    const highSkipped = report.gateSkipped.filter((s) => s.codes.includes('RISK_LEVEL') || s.codes.includes('AUTO_INELIGIBLE'))
    console.log(`  gate 제외 ${report.gateSkipped.length}건 (등급·민감 사유 ${highSkipped.length}건)`)
    if (report.pr) console.log(`  PR: ${report.pr.made ? report.pr.url : `만들지 않음 — ${report.pr.reason}`}`)
    if (report.slack) console.log(`  Slack: ${report.slack.sent ? '발송' : `미발송 — ${report.slack.reason}`}`)
    console.log(`  리포트: ${saved.written ? saved.path : `${saved.path} (dry-run — 쓰지 않았다)`}`)
    console.log(`  webhook: ${webhookStatus().hint}`)
    console.log('')
  }

  process.exit(blocked.length > 0 ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-auto-register-ready.mjs')) main()
