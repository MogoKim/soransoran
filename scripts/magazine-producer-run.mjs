#!/usr/bin/env node
/**
 * launchd 진입점 — producer 를 돌리고, 결과를 판정해 필요할 때만 Slack 으로 알린다.
 *
 *   01:00 KST → 이 스크립트
 *                 ├ magazine-webui-runner.mjs       ChatGPT 에 닿는지 먼저 본다 (Chrome 자동 기동)
 *                 ├ magazine-producer-plan.mjs      오늘 무엇을 만들지 정한다
 *                 └ magazine-producer-notify.mjs    알릴 것이 있으면 Slack
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
 *   node scripts/magazine-producer-run.mjs            producer 실행 + 알림
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
const PLAN = join(ROOT, 'scripts/magazine-producer-plan.mjs')
const NOTIFY = join(ROOT, 'scripts/magazine-producer-notify.mjs')

function stamp() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST'
}

function line(msg) {
  console.log(`[${stamp()}] ${msg}`)
}

const dryRun = process.argv.includes('--dry-run')

line(`매거진 producer 시작${dryRun ? ' (dry-run)' : ''}`)

// ── 0) ChatGPT 접근 확인 (Chrome 자동 기동) ─────────────────
// 01:00 에는 사람이 창을 띄워 둘 수 없다. CDP 가 없으면 여기서 직접 띄운다.
// 🔴 실패해도 producer 는 돌린다 — 재고 계산과 선정은 ChatGPT 와 무관하고,
//    알림이 나가야 창업자가 로그인 만료를 안다.
const webui = spawnSync(NODE, [WEBUI, '--dry-run', '--probe', '--auto-start'], { cwd: ROOT, stdio: 'inherit' })
if (webui.error) {
  line(`ChatGPT 접근 확인 실행 실패 — 계속한다 (${webui.error.code ?? webui.error.name})`)
} else {
  line(webui.status === 0 ? 'ChatGPT 접근 정상' : 'ChatGPT 접근 불가 — 원고 단계는 건너뛴다')
}

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

// ── 2) notify ──────────────────────────────────────────────
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
