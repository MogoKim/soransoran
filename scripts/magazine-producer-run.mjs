#!/usr/bin/env node
/**
 * launchd 진입점 — producer 를 돌리고, 결과를 판정해 필요할 때만 Slack 으로 알린다.
 *
 *   00:10 KST → 이 스크립트
 *                 ├ magazine-producer-plan.mjs      오늘 무엇을 만들지 정한다
 *                 ├ magazine-brief-auto.mjs         선정분의 brief.md · review.ts 를 만든다
 *                 ├ magazine-webui-runner.mjs       선정분의 원고를 받아 draft.md 로 저장
 *                 └ magazine-producer-notify.mjs    알릴 것이 있으면 Slack
 *
 * 🔴 원고까지다. register 도 PR 도 부르지 않는다.
 *    articles.ts 와 topic-queue.ts 를 무인으로 고치지 않는다 — 사람이 diff 를 본 뒤에 한다.
 *
 * 🔴 producer 본체를 수정하지 않는다.
 *    검증이 끝난 스크립트다. 여기서 감싸기만 한다.
 *    import 가 아니라 자식 프로세스로 띄운다 — producer 가 죽어도 이 래퍼는 살아서
 *    "죽었다"는 사실을 알릴 수 있어야 한다.
 *
 * 🔴 Slack 은 회차 판정을 바꾸지 않는다 — **양방향으로**.
 *    알림 하나 때문에 launchd 가 실패로 기록되면 다음 날 판단이 흐려진다.
 *    반대로 **알림이 실패했다고 원래 실패가 성공이 되지도 않는다.**
 *    notify 의 종료 코드는 판정에 넣지 않되, 실패 회차에서도 **반드시 시도한다.**
 *
 * 🔴 secret 을 다루지 않는다.
 *    webhook 은 notify 가 ~/.config/soransoran/slack.env 에서 직접 읽는다.
 *    이 파일도, plist 도 secret 을 모른다.
 *
 * 사용법
 *   node scripts/magazine-producer-run.mjs            producer + brief 생성 + 원고 회수 + 알림
 *   node scripts/magazine-producer-run.mjs --dry-run  producer 실행 없이 판정만 (발송 0)
 *
 * 🔴 **종료 코드는 회차 전체의 판정이다** (2026-09-16 P0-2).
 *
 *    옛 판은 `planCode` 만 돌려줬다. brief 생성 실패와 원고 회수 실패를 **삼켰다.**
 *    그래서 ChatGPT 로그인이 만료돼 원고를 한 건도 못 받아도 exit 0 이었고,
 *    `launchctl print` 의 last exit status 만 보는 사람은 그것을 정상으로 읽었다.
 *
 *    지금은 plan · brief · fetch 의 결과를 각각 보존해
 *    `lib/magazine-producer-exit.mjs` 가 판정한다.
 *      0  정상 — 일부 slug 가 게이트에 막힌 것은 정상이다(CONTENT)
 *      0  HOLD — 미해결 자동 PR 을 기다리는 중. 실패가 아니다
 *      1  SYSTEM — 프로세스를 못 띄움 · 사용법 오류 · 회수기 전역 실패(ChatGPT·브라우저)
 *
 * 🔴 **미해결 자동 PR 이 있으면 아무것도 시작하지 않는다** (P0-1).
 *    PR 이 merge 되기 전에 다음 회차가 돌면 같은 slug 를 다시 선정하고
 *    같은 예약 슬롯으로 중복 PR 을 만든다 — main 의 articles.ts 에는 아직 없기 때문이다.
 *    판정은 `lib/magazine-outstanding.mjs` 에 있고 auto-register 와 **같은 함수**를 쓴다.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { preflight, preflightTools } from './lib/magazine-auto-git.mjs'
import { readOutstanding } from './lib/magazine-outstanding.mjs'
import { judgeProducerRun, stage } from './lib/magazine-producer-exit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const NODE = process.execPath // 지금 이 프로세스를 띄운 node. plist 와 경로가 어긋날 수 없다

const WEBUI = join(ROOT, 'scripts/magazine-webui-runner.mjs')
const BRIEF_AUTO = join(ROOT, 'scripts/magazine-brief-auto.mjs')
const PLAN = join(ROOT, 'scripts/magazine-producer-plan.mjs')
const NOTIFY = join(ROOT, 'scripts/magazine-producer-notify.mjs')

function stamp() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST'
}

function line(msg) {
  console.log(`[${stamp()}] ${msg}`)
}

/** auto-brief 가 읽을 _runs 디렉터리 이름. producer 가 만든 것과 같은 KST 날짜다 */
function kstDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const dryRun = process.argv.includes('--dry-run')

/** 판정에 쓰는 읽기 전용 실행기. stdout 을 잡아서 돌려준다 */
const exec = (cmd, args) => {
  const r = spawnSync(cmd, [...args], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) return { code: 1, out: '', err: String(r.error.message ?? r.error) }
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

line(`매거진 producer 시작${dryRun ? ' (dry-run)' : ''}`)

// ── 0) 시작 전 판정 — 🔴 **파일도 AI 호출도 시작하기 전에** ────
//
// 🔴 이 자리가 P0-1 · P0-2 의 공통 앞단이다.
//    ① 미해결 자동 PR 이 있으면 **같은 slug 를 다시 선정하지 않는다** (중복 PR 방지)
//    ② runtime 이 깨끗한 main 이 아니면 brief·원고를 쓰지 않는다
//    둘 다 `plan` 보다 앞이어야 한다 — plan 이 `_runs/{date}/` 를 만들고 lock 을 잡기 때문이다.
let outstanding = null
if (!dryRun) {
  // ── 실행 의존성 ──
  // 🔴 gh 가 없으면 미해결 판정을 할 수 없다. "없다" 가 아니라 "모른다" 이므로 멈춘다.
  const tools = preflightTools({ exec })
  if (!tools.ok) {
    for (const b of tools.blockedBy) line(`🔴 ${b.code}: ${b.message}`)
    line('종료 (코드 1)')
    process.exit(1)
  }

  // ── git 상태 ──
  // 🔴 producer 는 drafts/magazine/{slug}/ 에 **추적 파일**을 쓴다.
  //    더러운 트리나 남의 브랜치 위에 쓰면 그 변경이 섞인다.
  const git = preflight({ exec })
  if (!git.ok) {
    for (const b of git.blockedBy) line(`🔴 ${b.code}: ${b.message}`)
    line('  → 첫 write 전에 멈췄다. 파일 변경 0건.')
    line('종료 (코드 1)')
    process.exit(1)
  }
  line(`git: main · origin/main 동기${git.fastForwarded ? ' (ff-only 로 따라붙음)' : ''}`)

  // ── 미해결 자동 작업 ──
  outstanding = readOutstanding({ exec })
  if (!outstanding.ok) {
    line(`${outstanding.severity === 'HOLD' ? '⏸' : '🔴'} ${outstanding.code}: ${outstanding.message}`)
    line('  → 선정·brief·원고 회수를 시작하지 않는다. 파일 변경 0건 · AI 호출 0건.')
    // 🔴 알림은 반드시 시도한다. HOLD 든 실패든 사람이 알아야 한다.
    runNotify()
    const v = judgeProducerRun({
      plan: stage('plan', { skipped: true }),
      brief: stage('brief', { skipped: true }),
      fetch: stage('fetch', { skipped: true }),
      outstanding,
    })
    line(`종료 (코드 ${v.code} · ${v.verdict})`)
    process.exit(v.code)
  }
  line(`미해결 자동 작업: 없음 — ${outstanding.message}`)
}

// ── 1) producer ────────────────────────────────────────────
let planStage = stage('plan', { skipped: true })
if (dryRun) {
  line('dry-run — producer 를 실행하지 않는다')
} else {
  const plan = spawnSync(NODE, [PLAN], { cwd: ROOT, stdio: 'inherit' })
  planStage = stage('plan', {
    spawnError: plan.error ? (plan.error.code ?? plan.error.name) : null,
    status: plan.status ?? null,
  })
  if (plan.error) line(`producer 실행 자체가 실패했다: ${planStage.spawnError}`)
  else line(`producer 종료 코드 ${plan.status}`)
}
const planOk = planStage.skipped || (!planStage.spawnError && planStage.status === 0)

// ── 2) brief 생성 ──────────────────────────────────────────
// 🔴 fetch 앞이다. brief.md 가 없으면 회수기가 brief_missing 으로 건너뛴다 —
//    2026-08-26 첫 무인 실행이 선정 3건 전부 그렇게 멈췄다.
//
// 🔴 **여기서 멈추지는 않는다.** 게이트에 막힌 건이 있어도 이미 brief 가 있던 slug 의
//    원고는 받아야 한다. 다만 **결과를 삼키지 않고 보존한다** — 판정은 마지막에 한다.
//
// 🔴 --write 를 여기서 준다. 기본은 dry-run 이라 명시하지 않으면 아무것도 쓰지 않는다.
let briefStage = stage('brief', { skipped: true })
if (dryRun) {
  line('dry-run — brief 생성을 실행하지 않는다')
} else if (!planOk) {
  line('producer 가 실패해 brief 생성을 건너뛴다')
} else {
  const briefAuto = spawnSync(NODE, [BRIEF_AUTO, '--run', kstDate(), '--write'], { cwd: ROOT, stdio: 'inherit' })
  briefStage = stage('brief', {
    spawnError: briefAuto.error ? (briefAuto.error.code ?? briefAuto.error.name) : null,
    status: briefAuto.status ?? null,
  })
  if (briefAuto.error) line(`🔴 brief 생성을 실행하지 못했다 (${briefStage.spawnError}) — claude 가 PATH 에 없을 수 있다`)
  else if (briefAuto.status === 0) line('brief 생성 완료')
  else if (briefAuto.status === 2) line('🔴 brief 생성이 사용법/시스템 오류로 끝났다 (종료 코드 2)')
  else line('brief 게이트에 막힌 건이 있다 — 회차 자체는 계속한다')
}

// ── 3) 원고 회수 ───────────────────────────────────────────
// producer 가 고른 것들의 원고를 받는다. Chrome 이 없으면 --auto-start 가 띄운다.
// 🔴 producer 가 실패했으면 건너뛴다 — 선정 결과가 없으면 받을 대상도 없다.
// 🔴 회수기는 **전역 실패에만** 1 을 낸다(개별 skip 은 0). 그래서 1 은 곧 시스템 실패다.
let fetchStage = stage('fetch', { skipped: true })
if (dryRun) {
  line('dry-run — 원고 회수를 실행하지 않는다')
} else if (!planOk) {
  line('producer 가 실패해 원고 회수를 건너뛴다')
} else {
  const fetchRun = spawnSync(NODE, [WEBUI, '--fetch-run'], { cwd: ROOT, stdio: 'inherit' })
  fetchStage = stage('fetch', {
    spawnError: fetchRun.error ? (fetchRun.error.code ?? fetchRun.error.name) : null,
    status: fetchRun.status ?? null,
  })
  if (fetchRun.error) line(`🔴 원고 회수를 실행하지 못했다 (${fetchStage.spawnError})`)
  else if (fetchRun.status === 0) line('원고 회수 완료')
  else line('🔴 원고 회수 전역 실패 — ChatGPT 접근 또는 브라우저 시작에 실패했다')
}

// ── 4) notify ──────────────────────────────────────────────
// 🔴 producer 가 죽었어도 돌린다 — run.json 이 없으면 notify 가 "실행되지 않았다"로 잡는다.
// 🔴 **알림 결과는 회차 판정을 바꾸지 않는다.** 알림이 안 갔다고 실패가 성공이 되지도,
//    성공이 실패가 되지도 않는다.
function runNotify() {
  const notify = spawnSync(NODE, [NOTIFY, dryRun ? '--dry-run' : '--send'], { cwd: ROOT, stdio: 'inherit' })
  if (notify.error) line(`알림 단계 실행 실패 — 판정에 반영하지 않는다 (${notify.error.code ?? notify.error.name})`)
  else line(notify.status === 1 ? '알릴 것이 있었다' : '알릴 것 없음')
}
runNotify()

// ── 5) 판정 ────────────────────────────────────────────────
// 🔴 **여기가 P0-2 의 핵심이다.** 옛 판은 planCode 만 돌려줬다.
//    ChatGPT 로그인 만료로 원고를 한 건도 못 받아도 exit 0 이었다.
const verdict = judgeProducerRun({ plan: planStage, brief: briefStage, fetch: fetchStage, outstanding })
if (verdict.failures.length > 0) for (const f of verdict.failures) line(`🔴 ${f}`)
line(`판정: ${verdict.verdict} — ${verdict.reason}`)
line(`종료 (코드 ${verdict.code})`)
process.exit(verdict.code)
