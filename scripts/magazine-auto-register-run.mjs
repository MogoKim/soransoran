#!/usr/bin/env node
/**
 * launchd 진입점 — producer(00:10 KST) 다음 자리. 자동 레인을 돌리고 리포트한다.
 *
 *   00:10 KST  magazine-producer-run.mjs      선정 · brief · 원고 회수 · 알림
 *   02:00 KST  이 스크립트                    변환 · QA · batch-qa · hero · register · PR
 *
 *   (00:10 은 producer plist 의 실제 StartCalendarInterval 이다.
 *    02:00 은 producer 가 끝난 뒤라는 순서만 지키면 된다.)
 *
 * 🔴 기본이 dry-run 이다.
 *    plist 는 이 스크립트를 인자 없이 부른다 — 그러면 dry-run 리포트만 나간다.
 *    등록 write 를 무인으로 여는 것은 창업자가 plist 에 --write 를 넣는 순간뿐이다.
 *    "연결은 해 두되 write 는 사람이 켠다" 가 오늘의 선이다.
 *
 * 🔴 새벽 dry-run 회차는 Slack 을 보내지 않는다.
 *    여기서 붙이는 것은 --notify 다 — 보낼 문구를 만들어 로그에 남기기만 한다.
 *    실제 발송은 --notify-send 를 창업자가 넣어야 열린다.
 *    → **새벽 감시 기준은 launchd 로그다**:
 *       ~/Library/Logs/soransoran/magazine-auto-register.log
 *       리포트 JSON(_runs/{date}/auto-register.json)은 --write 회차만 남긴다.
 *
 * 🔴 **write 회차의 실패는 launchd 에 non-zero 로 넘긴다** (2026-09-15 복구).
 *    dry-run 은 예전 그대로 0 이다 — "오늘 태울 것이 없다" 는 매일 나오는 정상 상태라
 *    그것으로 launchd 를 붉게 만들면 다음 날 판단이 흐려진다.
 *    그러나 무인 등록·PR 회차가 실패했는데 last exit status 가 0 이면
 *    정상 회차와 구분되지 않는다. 그 구분이 없어서 진단에 12일이 걸렸다.
 *
 * 사용법
 *   node scripts/magazine-auto-register-run.mjs              dry-run + 로그 리포트 (발송 0)
 *   node scripts/magazine-auto-register-run.mjs --write --pr 실제 등록 + PR (사람이 켠다)
 *   node scripts/magazine-auto-register-run.mjs --notify-send  Slack 실제 발송까지
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exitCodeFor } from './lib/magazine-auto-exit.mjs'
import { readHandoff, waitForProducer } from './lib/magazine-handoff.mjs'
import { LOCK_PATH as AR_LOCK, defaultPidAlive, readLock } from './lib/magazine-auto-lock.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const NODE = process.execPath
const READY = join(ROOT, 'scripts/magazine-auto-register-ready.mjs')
const MERGE = join(ROOT, 'scripts/magazine-auto-merge.mjs')

function stamp() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' KST'
}
const line = (m) => console.log(`[${stamp()}] ${m}`)

const passthrough = process.argv.slice(2)
const write = passthrough.includes('--write')

/**
 * 🔴 **write 회차는 Slack 을 실제로 보낸다** (2026-09-15 복구).
 *
 *    옛 판은 언제나 `--notify` 만 붙였다. 문구를 만들어 로그에 남기고 발송은 0 이다.
 *    dry-run 시기에는 맞는 설계였다 — 매일 오는 알림은 곧 안 읽힌다.
 *    그러나 무인으로 `articles.ts` 를 고치고 PR 을 여는 회차가 **로그 파일 하나에만**
 *    남는 것은 다른 이야기다. 사람이 그 파일을 열어 보지 않으면 사고를 모른다.
 *    plist 에 `--notify-send` 가 빠져도 여기서 붙는다 — 설정 한 줄에 기대지 않는다.
 */
const notifyFlag = write ? '--notify-send' : '--notify'
const args = [READY, ...(write ? passthrough : ['--dry-run', ...passthrough]), notifyFlag]

line(`매거진 자동 레인 시작${write ? '' : ' (dry-run)'}`)

/**
 * 🔴 **producer 가 끝나기를 기다린다** (2026-09-16 무인 운영).
 *
 *    등록이 02:00 → 01:00 으로 당겨져 producer(00:10)와 50분 간격이다.
 *    시간 간격에 기대지 않고 **완료 신호와 잠금**을 본다.
 *    제한 시간까지만 기다리고, 재시도하지 않는다.
 *
 * 🔴 dry-run 은 기다리지 않는다. 아무것도 쓰지 않으므로 겹쳐도 안전하다.
 */
if (write) {
  const kst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const producerLockPath = AR_LOCK.replace('.auto-register.lock', '.lock')
  const handoff = await waitForProducer({
    getHandoff: () => readHandoff(kst()),
    isProducerLockHeld: () => {
      // producer 는 _runs/{date}/.lock 을 쓴다. 살아 있는 pid 일 때만 "도는 중" 이다
      const l = readLock(producerLockPath.replace('_runs/', `_runs/${kst()}/`))
      return Boolean(l?.pid && defaultPidAlive(l.pid))
    },
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    log: (m) => line(m),
  })
  line(`인계: ${handoff.code} — ${handoff.message}`)
  if (!handoff.ready) {
    // 🔴 재시도하지 않는다. 이번 회차는 여기서 끝이다.
    line('종료 (코드 1)')
    process.exit(1)
  }
}

const r = spawnSync(NODE, args, { cwd: ROOT, stdio: 'inherit' })

/**
 * 🔴 **write 회차의 실패는 launchd 에 그대로 넘긴다** (2026-09-15 복구).
 *
 *    옛 판은 무조건 `exit 0` 이었다. 그래서 `launchctl print` 의 last exit status 가
 *    언제나 0 이었고, PR 을 못 만든 회차와 정상 회차가 **구분되지 않았다.**
 *    dry-run 은 "리포트가 목적" 이라는 원래 이유가 아직 유효하므로 그대로 0 으로 넘긴다 —
 *    dry-run 의 BLOCKED 는 "오늘 태울 것이 없다" 와 같은 말이라 매일 나온다.
 *
 * 🔴 그래도 KeepAlive 는 넣지 않는다. non-zero 는 **기록**이지 재시도 신호가 아니다.
 */
if (r.error) line(`실행 실패 — ${r.error.code ?? r.error.name}`)
const { code, reason } = exitCodeFor({ write, spawnError: r.error ?? null, childStatus: r.status ?? null })
line(reason)

/**
 * 🔴 **자동 병합** (2026-09-16 · 완전 무인 운영).
 *
 *    `--merge` 를 줬을 때만 돈다. 등록이 실패한 회차에서는 부르지 않는다 —
 *    merge 할 것이 없거나, 있어도 그 회차의 판정을 신뢰할 수 없다.
 *
 * 🔴 병합 실패가 등록 회차의 판정을 덮지 않는다. 둘 중 나쁜 쪽을 남긴다.
 * 🔴 재시도하지 않는다.
 */
let finalCode = code
if (write && passthrough.includes('--merge')) {
  if (code !== 0) {
    line('등록 회차가 실패해 자동 병합을 건너뛴다')
  } else {
    const mergeArgs = [MERGE, '--apply', '--notify-send']
    const m = spawnSync(NODE, mergeArgs, { cwd: ROOT, stdio: 'inherit' })
    if (m.error) { line(`자동 병합을 띄우지 못했다 (${m.error.code ?? m.error.name})`); finalCode = 1 }
    else if (m.status !== 0) { line(`자동 병합이 막혔다 (종료 코드 ${m.status})`); finalCode = m.status ?? 1 }
    else line('자동 병합 완료')
  }
}

line(`종료 (코드 ${finalCode})`)
process.exit(finalCode)
