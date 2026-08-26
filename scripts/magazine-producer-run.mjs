#!/usr/bin/env node
/**
 * launchd 진입점 — producer 를 돌리고, 결과를 판정해 필요할 때만 Slack 으로 알린다.
 *
 *   01:00 KST → 이 스크립트
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
 * 🔴 Slack 이 안 돼도 producer 는 성공으로 남는다.
 *    알림은 부가 기능이다. 알림 하나 때문에 launchd 가 실패로 기록되면
 *    다음 날 판단이 흐려진다. notify 의 종료 코드는 이 래퍼의 결과에 반영하지 않는다.
 *
 * 🔴 secret 을 다루지 않는다.
 *    webhook 은 notify 가 ~/.config/soransoran/slack.env 에서 직접 읽는다.
 *    이 파일도, plist 도 secret 을 모른다.
 *
 * 사용법
 *   node scripts/magazine-producer-run.mjs            producer + brief 생성 + 원고 회수 + 알림
 *   node scripts/magazine-producer-run.mjs --dry-run  producer 실행 없이 판정만 (발송 0)
 *
 * 종료 코드: producer 의 종료 코드를 그대로 넘긴다 (launchd last exit code 가 의미를 갖도록)
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

line(`매거진 producer 시작${dryRun ? ' (dry-run)' : ''}`)

// ── 1) producer ────────────────────────────────────────────
let planCode = 0
if (dryRun) {
  line('dry-run — producer 를 실행하지 않는다')
} else {
  const plan = spawnSync(NODE, [PLAN], { cwd: ROOT, stdio: 'inherit' })
  planCode = plan.status ?? 1
  if (plan.error) {
    line(`producer 실행 자체가 실패했다: ${plan.error.code ?? plan.error.name}`)
    planCode = 1
  }
  line(`producer 종료 코드 ${planCode}`)
}

// ── 2) brief 생성 ──────────────────────────────────────────
// 🔴 fetch 앞이다. brief.md 가 없으면 회수기가 brief_missing 으로 건너뛴다 —
//    2026-08-26 첫 무인 실행이 선정 3건 전부 그렇게 멈췄다.
//
// 🔴 실패해도 삼킨다. 게이트를 통과한 건만 파일이 되고, 나머지는 그대로 없는 상태다.
//    회수기가 알아서 건너뛰고 notify 가 brief_missing 으로 알린다.
//    여기서 멈추면 이미 brief 가 있던 slug 의 원고까지 못 받는다.
//
// 🔴 --write 를 여기서 준다. 기본은 dry-run 이라 명시하지 않으면 아무것도 쓰지 않는다.
if (dryRun) {
  line('dry-run — brief 생성을 실행하지 않는다')
} else if (planCode !== 0) {
  line('producer 가 실패해 brief 생성을 건너뛴다')
} else {
  const briefAuto = spawnSync(NODE, [BRIEF_AUTO, '--run', kstDate(), '--write'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (briefAuto.error) {
    line(`brief 생성 실행 실패 — 무시한다 (${briefAuto.error.code ?? briefAuto.error.name})`)
  } else {
    line(briefAuto.status === 0 ? 'brief 생성 완료' : 'brief 생성에 실패한 건이 있다 (Slack 이 알린다)')
  }
}

// ── 3) 원고 회수 ───────────────────────────────────────────
// producer 가 고른 것들의 원고를 받는다. Chrome 이 없으면 --auto-start 가 띄운다.
// 🔴 producer 가 실패했으면 건너뛴다 — 선정 결과가 없으면 받을 대상도 없다.
// 🔴 실패해도 삼킨다. 재고 계산은 이미 끝났고, 알림이 나가야 창업자가 원인을 안다.
if (dryRun) {
  line('dry-run — 원고 회수를 실행하지 않는다')
} else if (planCode !== 0) {
  line('producer 가 실패해 원고 회수를 건너뛴다')
} else {
  const fetchRun = spawnSync(NODE, [WEBUI, '--fetch-run'], { cwd: ROOT, stdio: 'inherit' })
  if (fetchRun.error) {
    line(`원고 회수 실행 실패 — 무시한다 (${fetchRun.error.code ?? fetchRun.error.name})`)
  } else {
    line(fetchRun.status === 0 ? '원고 회수 완료' : '원고 회수 중단 — 전역 실패 (Slack 이 알린다)')
  }
}

// ── 4) notify ──────────────────────────────────────────────
// producer 가 죽었어도 돌린다 — run.json 이 없으면 notify 가 "실행되지 않았다"로 잡는다.
const notifyArgs = [NOTIFY, dryRun ? '--dry-run' : '--send']
const notify = spawnSync(NODE, notifyArgs, { cwd: ROOT, stdio: 'inherit' })

if (notify.error) {
  // 🔴 삼킨다. 알림이 안 갔다고 producer 를 실패로 만들지 않는다.
  line(`알림 단계 실행 실패 — 무시한다 (${notify.error.code ?? notify.error.name})`)
} else {
  // notify 는 알림 대상이 있으면 1 로 끝난다. 그것은 실패가 아니다.
  line(notify.status === 1 ? '알릴 것이 있었다' : '알릴 것 없음')
}

line(`종료 (코드 ${planCode})`)
process.exit(planCode)
