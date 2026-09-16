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
import { branchName, writePreflight, createBranch, assertOnBranch, stageCheck, returnToMain } from './lib/magazine-auto-git.mjs'
import { acquireLock } from './lib/magazine-auto-lock.mjs'
import { readOutstanding, SEVERITY } from './lib/magazine-outstanding.mjs'
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
export function slotAllocator(from) {
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
 *
 * 🔴 **실행기를 주입받는다** (2026-09-15 복구). 회귀 테스트가 실제 git·gh 를 부르지 않고
 *    "push 는 됐는데 PR 이 실패" 같은 부분 실패를 시험할 수 있어야 한다.
 *    그 조합이 정확히 우리가 당한 모양이다.
 *
 * 🔴 `gh` 가 없어서 실패하는 경우는 **여기까지 오지 않는다.**
 *    `writePreflight` 가 파일을 건드리기 전에 막는다. 그래도 여기서 실패하면
 *    `made:false` 와 사유를 남기고, 호출부가 그것을 BLOCKED 로 올린다.
 */
export function finishPr(branch, doneSlugs, { exec: run = exec } = {}) {
  if (doneSlugs.length === 0) return { made: false, branch, reason: '등록된 건이 없다', pushed: false }

  const still = assertOnBranch(branch, { exec: run })
  if (!still.ok) return { made: false, branch, reason: still.blockedBy[0].message, pushed: false }

  const files = expectedFiles(doneSlugs).filter((f) => existsSync(join(ROOT, f)))
  const added = run('git', ['add', ...files])
  if (added.code !== 0) return { made: false, branch, reason: `stage 실패: ${added.err.split('\n').pop()}`, pushed: false }

  const staged = run('git', ['diff', '--cached', '--name-only'])
  const check = stageCheck(files, staged.out)
  if (!check.ok) {
    run('git', ['restore', '--staged', ...check.staged])
    return { made: false, branch, reason: check.blockedBy[0].message, staged: check.staged, pushed: false }
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

  const committed = run('git', ['commit', '-m', title.replace('[merge 금지] ', ''), '-m', body])
  if (committed.code !== 0) return { made: false, branch, reason: `commit 실패: ${committed.err.split('\n').pop()}`, pushed: false }

  const pushed = run('git', ['push', '-u', 'origin', branch])
  if (pushed.code !== 0) return { made: false, branch, reason: `push 실패: ${pushed.err.split('\n').pop()}`, pushed: false }

  const pr = run('gh', ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--head', branch])
  if (pr.code !== 0) {
    // 🔴 **여기까지 오면 커밋은 이미 origin 에 있다.** 그 사실을 반드시 남긴다 —
    //    `pushed: true` 가 없으면 "PR 이 없다" 와 "아무 일도 없었다" 가 구분되지 않는다.
    return {
      made: false,
      branch,
      pushed: true,
      reason: `PR 생성 실패 (브랜치는 origin 에 올라가 있다 — 사람이 PR 을 연다): ${pr.err.split('\n').pop()}`,
    }
  }
  return { made: true, branch, pushed: true, url: pr.out.split('\n').pop(), staged: check.staged }
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

  // 🔴 **write 회차는 조용히 끝나지 않는다** (2026-09-15 복구).
  //    dry-run 은 예전처럼 알릴 것이 없으면 아무것도 보내지 않는다 — 매일 오는 알림은 안 읽힌다.
  //    그러나 write 회차는 성공도 알린다. 무인으로 articles.ts 를 고치고 PR 을 여는 회차가
  //    아무 흔적 없이 지나가면, 사고가 났을 때 "언제부터" 를 되짚을 수 없다.
  if (done === 0 && blocked === 0 && dryRunLane) return { composed: false, sent: false, reason: '알릴 것 없음' }

  const severity = blocked > 0 ? 'WARN' : 'INFO'
  const reasons = []
  if (blocked) reasons.push(report.blocked.map((b) => `${b.slug}: ${b.blockedBy[0]?.code ?? '-'}`).join(' / '))
  if (report.leftOnBranch) reasons.push(`남은 브랜치 ${report.leftOnBranch}`)

  const next = report.pr?.made
    ? report.pr.url
    : dryRunLane
      ? 'dry-run — 등록도 PR 도 하지 않았다'
      : (report.pr ? `PR 실패 — ${report.pr.reason}` : '등록 없음')

  const msg = buildMessage({
    severity,
    title: `매거진 자동 레인 — 등록 ${done}건 · 막힘 ${blocked}건${dryRunLane ? ' (dry-run)' : ''}`,
    reason: reasons.length ? reasons.join(' / ') : null,
    next,
    logPath: report.reportPath ?? null,
  })
  const r = await send(msg, { dryRun: !actuallySend })
  // 🔴 문구를 돌려주지 않는다. webhook·토큰이 섞일 자리를 애초에 만들지 않는다.
  return { composed: true, sent: r.sent, reason: r.reason }
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
    lock: null,
    tools: null,
    outstanding: null,
    git: null,
    branch: null,
    done: [],
    blocked: [],
    pr: null,
    returned: null,
    leftOnBranch: null,
  }

  /**
   * 🔴 **회차를 끝내는 자리는 여기 하나다.**
   *    write 회차는 어떤 경로로 끝나든 ① main 복귀 ② lock 해제 ③ Slack ④ 종료코드
   *    를 같은 순서로 거친다. 중간에서 `process.exit` 하던 옛 판은 그 셋을 건너뛰었다.
   */
  let lock = { ok: true, release: () => {} }

  /**
   * 🔴 **우리가 만든 브랜치일 때만 복귀한다.**
   *    이 플래그가 없으면, `NOT_ON_MAIN` 으로 막힌 회차가 "복귀" 하겠다며
   *    사람이 체크아웃해 둔 브랜치를 main 으로 바꿔 버린다.
   *    자동화는 자기가 옮겨 놓은 것만 되돌린다.
   */
  let movedOffMain = false

  const finish = async (exitCode) => {
    if (write && movedOffMain) {
      const back = returnToMain({ exec })
      report.returned = { ok: back.ok, code: back.code, message: back.message }
      if (!back.ok) {
        report.leftOnBranch = back.leftOnBranch
        report.blocked.push({ slug: '(return)', blockedBy: [{ code: back.code, message: back.message }] })
        // 🔴 복귀에 실패하면 그 회차는 실패다. 다음 회차가 NOT_ON_MAIN 으로 멈출 것이기 때문이다.
        exitCode = 1
      }
    }
    lock.release()

    if (wantNotify) report.slack = await notifySlack(report, { actuallySend: notifySend, dryRunLane: !write })
    if (asJson) console.log(JSON.stringify(report, null, 2))
    else printHuman(report, { write })
    process.exit(exitCode)
  }

  // ── write 전 안전장치 ────────────────────────────────────
  // 🔴 여기서 막히면 회수도 변환도 register 도 시작하지 않는다.
  let branch = null
  if (write) {
    // ① lock — 같은 레인의 두 회차가 겹치지 않게. producer lock 과는 다른 파일이다.
    lock = acquireLock({ label: 'auto-register' })
    report.lock = { ok: lock.ok, code: lock.code, message: lock.message }
    if (!lock.ok) {
      report.blocked.push({ slug: '(lock)', blockedBy: [{ code: lock.code, message: lock.message }] })
      // 🔴 lock 을 못 잡았으면 main 복귀도 하지 않는다 — 남의 회차가 쓰는 중일 수 있다.
      if (asJson) console.log(JSON.stringify(report, null, 2))
      else printHuman(report, { write })
      process.exit(1)
    }

    // ② 실행 의존성 · 인증 · push 자격 · git 상태 — 🔴 **파일을 하나도 건드리기 전에** 전부 본다.
    //    옛 판은 gh 가 없다는 사실을 commit·push 뒤에 알았다.
    const pf = writePreflight({ exec })
    report.tools = pf.tools
    report.git = pf.git ? { ok: pf.git.ok, branch: pf.git.branch, synced: pf.git.synced, fastForwarded: pf.git.fastForwarded } : null
    if (!pf.ok) {
      report.blocked.push({ slug: `(${pf.stage})`, blockedBy: pf.blockedBy })
      return finish(1)
    }

    // ③ 미해결 자동 작업 — 🔴 **브랜치 생성·원고 회수(AI 호출)보다 앞이다.**
    //
    //    PR 이 아직 merge 되지 않았는데 다음 회차가 돌면, main 의 articles.ts 에는
    //    그 등록이 없으므로 **같은 slug 를 같은 빈 슬롯으로 또 등록**한다.
    //    `register.mjs` 의 중복 가드는 main 만 보므로 이것을 막지 못한다.
    //    producer 와 **같은 함수**를 쓴다 (lib/magazine-outstanding.mjs).
    const out = readOutstanding({ exec })
    report.outstanding = { ok: out.ok, code: out.code, severity: out.severity, message: out.message, pr: out.pr }
    if (!out.ok) {
      report.blocked.push({ slug: '(outstanding)', blockedBy: [{ code: out.code, message: out.message }] })
      // 🔴 HOLD 는 정상이다 — 사람이 PR 을 처리하기를 기다릴 뿐이라 종료 코드 0.
      //    ORPHAN·조회 실패는 운영 이상이므로 non-zero 로 남긴다.
      return finish(out.severity === SEVERITY.HOLD ? 0 : 1)
    }

    // ④ register write 앞에 브랜치를 만든다. 실패하면 아무것도 쓰지 않고 끝난다.
    if (wantPr) {
      const made = createBranch(branchName(), { exec })
      report.branch = made.name
      if (!made.ok) {
        report.blocked.push({ slug: '(branch)', blockedBy: made.blockedBy })
        return finish(1)
      }
      branch = made.name
      movedOffMain = true // 🔴 여기서부터만 복귀가 우리 일이다
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

  if (write && wantPr && branch) {
    report.pr = finishPr(branch, done.map((r) => r.slug))
    // 🔴 **PR 을 못 만든 것은 실패다.** 옛 판은 `report.pr.made === false` 를
    //    조용히 흘려 종료 코드 0 으로 끝냈다 — push 는 됐는데 PR 이 없는 회차가
    //    아무 표시 없이 지나갔다. 등록된 건이 있는데 PR 이 없으면 반드시 시끄러워야 한다.
    if (!report.pr.made && done.length > 0) {
      report.blocked.push({ slug: '(pr)', blockedBy: [{ code: 'PR_NOT_CREATED', message: report.pr.reason }] })
      report.leftOnBranch = branch
    }
  }

  const saved = writeReport(report, { write })
  report.reportPath = saved.path
  report.results = results

  return finish(report.blocked.length > 0 ? 1 : 0)
}

/** 사람이 읽는 출력 — 🔴 로그가 새벽 감시의 유일한 기준이다. 빠뜨리면 안 보인다 */
function printHuman(report, { write }) {
  console.log('')
  console.log(`  매거진 자동 레인 — ${report.mode}${report.source ? ` · 출처 ${report.source}` : ''}`)
  if (report.lock && !report.lock.ok) console.log(`  🔒 ${report.lock.code}: ${report.lock.message}`)
  if (report.outstanding) {
    // 🔴 PR 번호·URL 을 로그에 남긴다. 사람이 그것을 처리해야 다음 회차가 돈다
    const o = report.outstanding
    console.log(`  미해결 자동 작업: ${o.ok ? '없음' : `${o.severity} ${o.code}`}${o.pr ? ` — PR #${o.pr.number} ${o.pr.url}` : ''}`)
    if (!o.ok) console.log(`     ${o.message}`)
  }
  if (report.tools) {
    const missing = Object.entries(report.tools).filter(([, v]) => v === null).map(([k]) => k)
    console.log(`  실행 의존성: ${missing.length === 0 ? '전부 확인' : `🔴 없음 — ${missing.join(', ')}`}`)
  }
  if (report.git) console.log(`  git: ${report.git.branch} · origin/main 동기 ${report.git.synced ? 'OK' : '아니오'}${report.git.fastForwarded ? ' (ff-only 로 따라붙음)' : ''}`)
  if (typeof report.pool === 'number') {
    console.log(`  후보 ${report.pool}건 중 gate 통과 ${report.eligible}건 · 처리 ${report.processed}건`)
  }
  if (report.branch) console.log(`  PR 브랜치: ${report.branch} (register write 앞에 생성)`)
  console.log('')
  for (const r of report.results ?? []) {
    const mark = r.verdict === 'BLOCKED' ? '⛔' : r.verdict === 'DONE' ? '✅' : '·'
    console.log(`  ${mark} ${r.slug} — ${r.verdict} (publishAt ${r.publishAt})`)
    for (const s of r.steps) {
      const m = s.status === 'ok' ? '✅' : s.status === 'skip' ? '·' : '⛔'
      console.log(`       ${m} ${s.stage.padEnd(9)} ${s.detail}`)
    }
  }
  if (report.results?.length) console.log('')
  if (report.gateSkipped) {
    const gradeSkipped = report.gateSkipped.filter((s) => s.codes.includes('RISK_LEVEL') || s.codes.includes('AUTO_INELIGIBLE'))
    console.log(`  gate 제외 ${report.gateSkipped.length}건 (등급·민감 사유 ${gradeSkipped.length}건)`)
  }
  if (report.done?.length) console.log(`  등록: ${report.done.map((d) => `${d.slug}(${d.publishAt})`).join(' · ')}`)
  if (report.pr) console.log(`  PR: ${report.pr.made ? report.pr.url : `🔴 만들지 않음 — ${report.pr.reason}`}`)

  // 🔴 막힌 단계를 **이름으로** 남긴다. "BLOCKED 가 있었다" 만으로는 로그에서 원인을 못 찾는다.
  for (const b of report.blocked ?? []) {
    const first = b.blockedBy?.[0]
    console.log(`  ⛔ ${b.slug} — ${first?.code ?? '?'}: ${first?.message ?? ''}`)
  }
  if (write) {
    console.log(`  복귀: ${report.returned ? `${report.returned.code} — ${report.returned.message}` : '필요 없음 — main 을 떠나지 않았다'}`)
    if (report.leftOnBranch) console.log(`  🔴 남은 브랜치: ${report.leftOnBranch} — 사람이 확인한다`)
  }
  if (report.slack) console.log(`  Slack: ${report.slack.sent ? '발송' : `미발송 — ${report.slack.reason}`}`)
  // 🔴 dry-run 은 리포트도 쓰지 않는다. 경로만 찍으면 "썼다" 로 읽힌다
  if (report.reportPath) console.log(`  리포트: ${report.reportPath}${write ? '' : ' (dry-run — 쓰지 않는다)'}`)
  console.log(`  webhook: ${webhookStatus().hint}`)
  console.log('')
}

if (process.argv[1] && process.argv[1].endsWith('magazine-auto-register-ready.mjs')) main()
