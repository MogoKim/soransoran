#!/usr/bin/env node
/**
 * LOW/MEDIUM 자동 발행 레인 — 후보 스캐너 · 일괄 실행 · 리포트.
 *
 *   00:10 KST  magazine-producer-run.mjs        선정 · brief · 원고 회수 · 알림
 *   02:00 KST  이 스크립트 (auto-register-run)  변환 · QA · batch-qa · hero · register · PR
 *
 * 🔴 기본이 dry-run 이다. --write 없이는 **repo 파일 변경 0건**이다.
 *    회수·변환·hero·register 어느 것도 쓰지 않고, 리포트 JSON 도 쓰지 않는다.
 *
 * 🔴 Slack 은 --notify-send 를 줬을 때만 실제로 나간다.
 *    --notify 는 보낼 문구를 만들어 콘솔에 보여주기만 한다(발송 0).
 *    plist 는 인자 없이 부르므로 **새벽 dry-run 회차는 Slack 을 보내지 않는다.**
 *    → 그래서 새벽 감시 기준은 **launchd 로그**다:
 *       ~/Library/Logs/soransoran/magazine-auto-register.log
 *       (--write 회차만 _runs/{date}/auto-register.json 을 남긴다)
 *
 * 🔴 write 는 깨끗한 main 에서만 시작한다 (magazine-auto-git.mjs preflight).
 *    현재 브랜치 main · origin/main 과 동기 · 추적 변경 0건. 하나라도 아니면 BLOCKED.
 *    미추적 파일은 판단 대상이 아니지만 **stage 에는 절대 넣지 않는다**.
 *
 * 🔴 PR 브랜치를 register write **앞에** 만든다.
 *    나중에 만들면 articles.ts 가 먼저 바뀐 뒤 브랜치 생성에 실패했을 때
 *    그 변경이 main 에 남는다. 순서를 뒤집으면 실패가 "아무 일도 없음"으로 끝난다.
 *
 * 🔴 HIGH · autoEligible=false · 큐에 없는 slug 는 gate 에서 끝난다 (magazine-auto-lane.mjs).
 * 🔴 register 에 --founder-approved 를 넘기지 않는다.
 *
 * 사용법
 *   node scripts/magazine-auto-register-ready.mjs --dry-run
 *   node scripts/magazine-auto-register-ready.mjs --dry-run --json
 *   node scripts/magazine-auto-register-ready.mjs --run YYYY-MM-DD --dry-run
 *   node scripts/magazine-auto-register-ready.mjs --write --pr
 *   node scripts/magazine-auto-register-ready.mjs --write --pr --notify-send
 *
 * 종료 코드: BLOCKED 가 있으면 1, 아니면 0
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadQueue, loadArticles, DRAFTS_DIR } from './lib/magazine-load.mjs'
import { gate, progress, paths } from './lib/magazine-auto-lane.mjs'
import { branchName, preflight, createBranch, assertOnBranch, stageCheck } from './lib/magazine-auto-git.mjs'
import { drive } from './magazine-auto-register.mjs'
import { buildMessage, send, webhookStatus } from './lib/slack-notify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 하루 1건. 첫 예약 후보일은 내일부터 본다 — 오늘 10:30 은 이미 지났을 수 있다 */
const SLOT_START_OFFSET_DAYS = 1

/** register 가 고치는 두 파일. stage 예상 목록의 고정 부분이다 */
const REGISTER_FILES = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts']

function kstDate(offsetDays = 0) {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10)
}

function exec(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' })
  if (r.error) return { code: 1, out: '', err: String(r.error.message ?? r.error) }
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
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

function kstDateAfter(date) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400 * 1000).toISOString().slice(0, 10)
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

/** producer 가 고른 것 (있으면) — 없으면 큐 전체를 훑는다 */
function slugsFromRun(date) {
  const file = join(DRAFTS_DIR, '_runs', date, 'run.json')
  if (!existsSync(file)) return null
  try {
    return (JSON.parse(readFileSync(file, 'utf8')).selected ?? []).map((s) => s.slug)
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
    if (g.ok) eligible.push({ slug, item: g.item, progress: progress(slug) })
    else skipped.push({ slug, riskLevel: g.item?.riskLevel ?? null, blockedBy: g.blockedBy })
  }
  return { source: fromRun ? `run:${runDate}` : 'queue', pool: pool.length, eligible, skipped }
}

// ── PR ─────────────────────────────────────────────────────

/** 등록될 slug 들이 만들 파일 — stage 예상 목록. 이 밖의 것이 staged 면 커밋하지 않는다 */
function expectedFiles(slugs) {
  const files = [...REGISTER_FILES]
  for (const slug of slugs) {
    const p = paths(slug)
    for (const f of [p.draftMd, p.articleTs]) if (existsSync(f)) files.push(f.replace(`${ROOT}/`, ''))
    if (existsSync(join(ROOT, 'public/magazine', slug, 'hero.webp'))) files.push(`public/magazine/${slug}/hero.webp`)
  }
  return files
}

/**
 * register write 가 끝난 뒤 — 명시 stage · 검증 · commit · push · PR.
 * 🔴 `git add .` 을 쓰지 않는다. 파일 이름을 하나씩 넣고, staged 목록을 다시 확인한다.
 */
function finishPr(branch, doneSlugs) {
  if (doneSlugs.length === 0) return { made: false, branch, reason: '등록된 건이 없다' }

  const still = assertOnBranch(branch, { exec })
  if (!still.ok) return { made: false, branch, reason: still.blockedBy[0].message }

  const files = expectedFiles(doneSlugs).filter((f) => existsSync(join(ROOT, f)))
  const added = exec('git', ['add', ...files])
  if (added.code !== 0) return { made: false, branch, reason: `stage 실패: ${added.err.split('\n').pop()}` }

  const staged = exec('git', ['diff', '--cached', '--name-only'])
  const check = stageCheck(files, staged.out)
  if (!check.ok) {
    exec('git', ['restore', '--staged', ...check.staged])
    return { made: false, branch, reason: check.blockedBy[0].message, staged: check.staged }
  }

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
    `staged 파일: ${check.staged.join(', ')}`,
    '',
    '🔴 merge 는 창업자 승인 후에 한다.',
  ].join('\n')

  const committed = exec('git', ['commit', '-m', title.replace('[merge 금지] ', ''), '-m', body])
  if (committed.code !== 0) return { made: false, branch, reason: `commit 실패: ${committed.err.split('\n').pop()}` }

  const pushed = exec('git', ['push', '-u', 'origin', branch])
  if (pushed.code !== 0) return { made: false, branch, reason: `push 실패: ${pushed.err.split('\n').pop()}` }

  const pr = exec('gh', ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--head', branch])
  if (pr.code !== 0) return { made: false, branch, reason: `PR 생성 실패: ${pr.err.split('\n').pop()}` }
  return { made: true, branch, url: pr.out.split('\n').pop(), staged: check.staged }
}

// ── 리포트 ─────────────────────────────────────────────────

function reportPath(date) {
  return join(DRAFTS_DIR, '_runs', date, 'auto-register.json')
}

/** 🔴 dry-run 은 리포트도 쓰지 않는다 — repo 파일 변경 0건이 원칙이다 */
function writeReport(report, { write }) {
  const date = kstDate()
  if (!write) return { written: false, path: reportPath(date), reason: 'dry-run — 쓰지 않는다' }
  const dir = join(DRAFTS_DIR, '_runs', date)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(reportPath(date), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return { written: true, path: reportPath(date) }
}

/**
 * Slack — 문구는 --notify 로 만들고, 실제 발송은 --notify-send 로만 연다.
 * 🔴 --notify 만 있으면 한 건도 보내지 않는다.
 */
async function notifySlack(report, { actuallySend, dryRunLane }) {
  const done = report.done.length
  const blocked = report.blocked.length
  if (done === 0 && blocked === 0) return { composed: false, sent: false, reason: '알릴 것 없음' }
  const msg = buildMessage({
    severity: blocked > 0 ? 'WARN' : 'INFO',
    title: `매거진 자동 레인 — 등록 ${done}건 · 막힘 ${blocked}건${dryRunLane ? ' (dry-run)' : ''}`,
    reason: blocked ? report.blocked.map((b) => `${b.slug}: ${b.blockedBy[0]?.code ?? '-'}`).join(' / ') : null,
    next: report.pr?.url ?? (dryRunLane ? 'dry-run — 등록도 PR 도 하지 않았다' : null),
  })
  const r = await send(msg, { dryRun: !actuallySend })
  return { composed: true, text: msg.text, sent: r.sent, reason: r.reason }
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`LOW/MEDIUM 자동 발행 레인 — 후보 스캔 · 일괄 실행

  node scripts/magazine-auto-register-ready.mjs --dry-run
  node scripts/magazine-auto-register-ready.mjs --dry-run --json
  node scripts/magazine-auto-register-ready.mjs --run YYYY-MM-DD --dry-run
  node scripts/magazine-auto-register-ready.mjs --write --pr
  node scripts/magazine-auto-register-ready.mjs --write --pr --notify-send

  --dry-run       repo 파일 변경 0건 (기본). 리포트 JSON 도 쓰지 않는다
  --write         회수·변환·hero·register 를 실제로 수행 (깨끗한 main 에서만)
  --pr            register write 앞에 PR 브랜치를 만들고, 끝나면 [merge 금지] PR
  --notify        Slack 문구만 만들어 보여준다 (발송 0)
  --notify-send   Slack 실제 발송
  --limit N       한 번에 처리할 최대 건수 (기본 3)
  --run DATE      그날 producer 선정분만 (없으면 큐 전체)
  --json          리포트를 JSON 으로

🔴 HIGH · autoEligible=false · 큐에 없는 slug 는 gate 에서 제외된다.
🔴 새벽 dry-run 회차의 감시 기준은 launchd 로그다 (Slack 발송 없음).`)
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
  const wantNotify = argv.includes('--notify') || argv.includes('--notify-send')
  const notifySend = argv.includes('--notify-send')

  const report = {
    generatedAt: new Date().toISOString(),
    kstDate: kstDate(),
    mode: write ? 'write' : 'dry-run',
    git: null,
    branch: null,
    done: [],
    blocked: [],
    pr: null,
  }

  // ── write 전 git 안전장치 ────────────────────────────────
  // 🔴 여기서 막히면 회수도 변환도 register 도 시작하지 않는다.
  let branch = null
  if (write) {
    const pf = preflight({ exec })
    report.git = { ok: pf.ok, branch: pf.branch, blockedBy: pf.blockedBy }
    if (!pf.ok) {
      report.blocked.push({ slug: '(git)', blockedBy: pf.blockedBy })
      if (asJson) console.log(JSON.stringify(report, null, 2))
      else {
        console.log('')
        console.log('  ⛔ write 를 시작하지 않는다 — git 상태가 조건을 만족하지 않는다')
        for (const b of pf.blockedBy) console.log(`     ${b.code}: ${b.message}`)
        console.log('')
      }
      process.exit(1)
    }

    // 🔴 register write 앞에 브랜치를 만든다. 실패하면 아무것도 쓰지 않고 끝난다.
    if (wantPr) {
      const made = createBranch(branchName(), { exec })
      report.branch = made.name
      if (!made.ok) {
        report.blocked.push({ slug: '(branch)', blockedBy: made.blockedBy })
        if (asJson) console.log(JSON.stringify(report, null, 2))
        else {
          console.log('')
          console.log('  ⛔ PR 브랜치를 만들지 못했다 — 현재 브랜치에 커밋하지 않는다')
          for (const b of made.blockedBy) console.log(`     ${b.code}: ${b.message}`)
          console.log('')
        }
        process.exit(1)
      }
      branch = made.name
    }
  }

  // ── 처리 ─────────────────────────────────────────────────
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

  Object.assign(report, {
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
  })

  if (write && wantPr && branch) report.pr = finishPr(branch, done.map((r) => r.slug))

  const saved = writeReport(report, { write })
  report.reportPath = saved.path
  if (wantNotify) report.slack = await notifySlack(report, { actuallySend: notifySend, dryRunLane: !write })

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('')
    console.log(`  매거진 자동 레인 — ${report.mode} · 출처 ${report.source}`)
    console.log(`  후보 ${report.pool}건 중 gate 통과 ${report.eligible}건 · 처리 ${report.processed}건`)
    if (report.branch) console.log(`  PR 브랜치: ${report.branch} (register write 앞에 생성)`)
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
    const gradeSkipped = report.gateSkipped.filter((s) => s.codes.includes('RISK_LEVEL') || s.codes.includes('AUTO_INELIGIBLE'))
    console.log(`  gate 제외 ${report.gateSkipped.length}건 (등급·민감 사유 ${gradeSkipped.length}건)`)
    if (report.pr) console.log(`  PR: ${report.pr.made ? report.pr.url : `만들지 않음 — ${report.pr.reason}`}`)
    if (report.slack) {
      console.log(`  Slack: ${report.slack.sent ? '발송' : `미발송 — ${report.slack.reason}`}${report.slack.composed && !notifySend ? ' (--notify 는 문구만 만든다)' : ''}`)
    }
    console.log(`  리포트: ${saved.written ? saved.path : `${saved.path} (${saved.reason})`}`)
    console.log(`  webhook: ${webhookStatus().hint}`)
    console.log('')
  }

  process.exit(report.blocked.length > 0 ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-auto-register-ready.mjs')) main()
