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
 *      3  PARTIAL — 회수까지 돌았지만 입력 수리가 미해결로 남았다 (실패·REJECTED·전송불명·소진 · 2026-10-10)
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
import { composeProducerMessage, runProducerFlow } from './lib/magazine-producer-flow.mjs'
import { readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { writeHandoff } from './lib/magazine-handoff.mjs'
import { acquireLock, PRODUCER_LOCK_PATH } from './lib/magazine-auto-lock.mjs'
import { buildMessage, send } from './lib/slack-notify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const NODE = process.execPath // 지금 이 프로세스를 띄운 node. plist 와 경로가 어긋날 수 없다

const WEBUI = join(ROOT, 'scripts/magazine-webui-runner.mjs')
const BRIEF_AUTO = join(ROOT, 'scripts/magazine-brief-auto.mjs')
const INPUT_REPAIR = join(ROOT, 'scripts/magazine-input-repair.mjs')
const PLAN = join(ROOT, 'scripts/magazine-producer-plan.mjs')
const NOTIFY = join(ROOT, 'scripts/magazine-producer-notify.mjs')
/** 🔴 저장소 밖 — 입력 수리 CLI 의 TMP_DIR 과 같은 곳 */
const REPAIR_TMP_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'input-repair')

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

/** 자식 한 벌을 띄우고 **결과를 삼키지 않고** 돌려준다 */
const spawnStage = (args) => {
  const r = spawnSync(NODE, args, { cwd: ROOT, stdio: 'inherit' })
  return { spawnError: r.error ? (r.error.code ?? r.error.name) : null, status: r.status ?? null }
}

/**
 * 🔴 **알림은 여기 하나뿐이다.** `runProducerFlow` 의 finalize 가 한 번만 부른다.
 *
 *    두 갈래로 나뉜다.
 *      정상 회차   `magazine-producer-notify.mjs` 에 맡긴다 — run.json 을 읽어 판단한다
 *      중단 회차   run.json 이 아예 없다(plan 을 돌리지 않았다). 그래서 **직접 문구를 만들어** 보낸다
 *
 *    🔴 중단 회차를 notify 자식에게 맡기면 "run.json 이 없다" 만 말하게 된다.
 *       창업자가 알아야 하는 것은 **어느 PR 을 merge 해야 하는가** 다.
 */
async function notifyOnce({ verdict, outstanding, preflight: pf, dryRun: isDry, repair = null }) {
  const interrupted = Boolean((outstanding && !outstanding.ok) || (pf && !pf.ok))

  if (!interrupted) {
    // 🔴 입력 수리 미해결은 같은 notify 한 번에 실어 보낸다 — slug · 결과 코드 · 결과 파일
    const repairArgs = repair?.failures?.length
      ? ['--input-repair-summary', JSON.stringify({ resultFile: repair.resultFile, failures: repair.failures.map(({ slug, type, outcome }) => ({ slug, type, outcome })) })]
      : []
    const r = spawnSync(NODE, [NOTIFY, isDry ? '--dry-run' : '--send', ...repairArgs], { cwd: ROOT, stdio: 'inherit' })
    if (r.error) return { ok: false, reason: `notify 실행 실패 (${r.error.code ?? r.error.name})` }
    line(r.status === 1 ? '알릴 것이 있었다' : '알릴 것 없음')
    return { ok: true }
  }

  // 🔴 중단 회차 — PR 번호·URL 이 반드시 들어간다
  const msg = buildMessage(composeProducerMessage({ verdict, outstanding, preflight: pf }))
  // 🔴 dry-run 은 실제로 보내지 않는다
  const sent = await send(msg, { dryRun: isDry })
  line(sent.sent ? 'Slack 발송' : `Slack 미발송 — ${sent.reason}`)
  return { ok: sent.sent || isDry, reason: sent.reason }
}

line(`매거진 producer 시작${dryRun ? ' (dry-run)' : ''}`)

/**
 * 🔴 **회차 전체를 잠근다** (2026-09-16 검토).
 *
 *    plan 의 lock 은 선정 구간만 덮는다 — brief 생성과 원고 회수는 그 밖이다.
 *    등록이 01:00 으로 당겨졌으므로 그 구간이 겹칠 수 있다.
 *    이 lock 은 **선정 시작부터 회수 끝까지** 살아 있고, 01:00 등록이 그것을 본다.
 *
 * 🔴 dry-run 은 잠그지 않는다. 아무것도 쓰지 않는다.
 * 🔴 재시도하지 않는다. 다른 회차가 돌고 있으면 그대로 끝낸다.
 */
let producerLock = { ok: true, release: () => {} }

const result = await runProducerFlow({
  dryRun,
  deps: {
    log: line,
    // 🔴 회차 전체를 잠근다 — 선정 구간만 덮던 plan 의 lock 과 다르다.
    //    실패해도 finalize 를 지나므로 Slack 이 나간다.
    checkLock: () => { producerLock = acquireLock({ path: PRODUCER_LOCK_PATH, label: 'producer' }); return producerLock },
    // 🔴 gh 가 없으면 미해결 판정을 할 수 없다. "없다" 가 아니라 "모른다" 이므로 멈춘다.
    checkTools: () => preflightTools({ exec }),
    // 🔴 producer 는 drafts/magazine/{slug}/ 에 **추적 파일**을 쓴다.
    checkGit: () => preflight({ exec }),
    checkOutstanding: () => readOutstanding({ exec }),
    runPlan: () => spawnStage([PLAN]),
    /**
     * 🔴 producer 가 쓴 run.json 을 읽어 **공급 상태**를 알려 준다.
     *    selected 0 이어도 `reusable` 이 있으면 "할 일 없음" 이 아니다 (2026-09-28).
     */
    readSupply: () => {
      try {
        const j = JSON.parse(readFileSync(join(ROOT, 'drafts/magazine/_runs', kstDate(), 'run.json'), 'utf8'))
        return {
          selected: Array.isArray(j.selected) ? j.selected.length : null,
          reusable: Array.isArray(j.reusable) ? j.reusable.length : 0,
        }
      } catch { return { selected: null, reusable: 0 } }   // 🔴 모르면 옛 경로 그대로 간다
    },
    runBrief: () => spawnStage([BRIEF_AUTO, '--run', kstDate(), '--write']),
    // 🔴 입력 수리 — 잠금·미해결 검사 뒤 · 원고 회수 전 (2026-10-10)
    //    사람용 출력이 아니라 자식이 적은 구조화 결과(--result-json)를 읽어 판정·알림·handoff 로 넘긴다
    runRepair: () => {
      const rj = join(REPAIR_TMP_DIR, `producer-input-repair-${process.pid}-${Date.now()}.json`)
      const r = spawnStage([INPUT_REPAIR, '--run', kstDate(), '--write', '--result-json', rj])
      let report = null
      try { report = JSON.parse(readFileSync(rj, 'utf8')) } catch { report = null }
      rmSync(rj, { force: true })
      return { ...r, report }
    },
    runFetch: () => spawnStage([WEBUI, '--fetch-run']),
    notify: notifyOnce,
  },
})

// 🔴 **완료 신호를 남긴다** — 01:00 등록이 이것을 보고 시작한다 (무인 운영).
//    실패한 회차도 남긴다. "안 돌았다" 와 "돌았는데 실패했다" 는 대응이 다르다.
if (!dryRun) {
  try {
    const path = writeHandoff({ date: kstDate(), verdict: result.verdict, code: result.code, ran: result.ran ?? [], repair: result.repair ?? null })
    line(`인계 신호: ${path}`)
  } catch (e) {
    // 🔴 신호를 못 써도 회차 판정은 바꾸지 않는다. 등록은 제한 대기 후 진행한다.
    line(`인계 신호를 남기지 못했다 — 판정에 반영하지 않는다 (${e?.message ?? e})`)
  }
}

// 🔴 신호를 먼저 쓰고 그다음 잠금을 푼다.
//    순서를 뒤집으면 등록이 "lock 없음 + 신호 없음" 을 보고 먼저 출발한다.
producerLock.release()

if (result.failures?.length) for (const f of result.failures) line(`🔴 ${f}`)
line(`판정: ${result.verdict} — ${result.reason}`)
line(`종료 (코드 ${result.code})`)
process.exit(result.code)
