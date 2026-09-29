#!/usr/bin/env tsx
/**
 * 발행 heartbeat 후보 fixture — 🔴 **DB 0 · 네트워크 0 · launchctl 0.** 파일 쓰기는 mkdtemp 안에서만
 *
 * 🔴 **이 fixture 가 지키는 것**
 *    ① 정시판이 여전히 기본값이고 바이트 단위로 그대로다(rollback 대상)
 *    ② heartbeat 판은 **트리거만** 다르다 — 10분 격자 · 운영 창 안 · 슬롯 전부 격자 위 · `--heartbeat` 하나
 *    ③ 10분 wake 로 하루를 돌려도 첫 슬롯 전에는 0 · 도래 수를 넘지 않는다 · 천장까지만 낸다
 *       (트랜잭션이 부르는 것과 같은 `judgeCatchUp` — 실제 트랜잭션 판은 `publish:heartbeat-db-check`)
 *    ④ 절전 뒤 catch-up 은 같은 KST 날짜 · 운영 창 안에서만이다
 *    ⑤ 같은 틱 두 번째 wake 는 물러난다 — 실제 다중 프로세스 경쟁으로 본다
 *    ⑥ 로컬/GitHub 단계 입력 분기는 값으로 드러나고, 로컬이 더 넓으면 막는다(fail-closed)
 *    ⑦ 러너 배선 — 창 밖 생략·틱 잠금이 DB 연결 **앞**에 있고, 발행 권한은 트랜잭션 그대로다
 *    ⑧ GitHub Actions 예약 수 불변 — heartbeat 는 어느 워크플로우에도 없다
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  PUBLISH_RUNNER_ARGS, PUBLISH_HEARTBEAT_ARGS, HEARTBEAT_FLAG, HEARTBEAT_INTERVAL_MINUTES,
  DEFAULT_RUNNER_TRIGGER_MODE, PUBLISH_RUNNER_LABEL, HEARTBEAT_INSTALL_STEPS,
  renderPublishRunnerPlist, renderPublishHeartbeatPlist, renderRunnerPlistFor, publishRunnerSlots,
  heartbeatWakeTimes, verifyHeartbeatGrid, parseInstalledRunnerPlist, heartbeatCommands,
  stageInputsOf, describeStageInputs, judgeHeartbeatStageInputs, pickStageInputKeys,
  judgeRunnerSecrets, type RunnerTriggerMode,
} from './lib/original-post-runner-template'
import { claimHeartbeatTick, heartbeatTickKey, heartbeatInWindow, pruneOldTicks } from './lib/publish-heartbeat-tick.mjs'
import {
  simulateDay, catchUpDailyCeiling, dueCountAt, kstMinuteOfDay,
  PUBLISH_WINDOW_START_MINUTE, PUBLISH_WINDOW_END_MINUTE,
} from '../src/lib/publish-slot-catchup'
import { PROFILES, RELEASE_STAGES, minuteOfDay } from '../src/lib/scale-profile'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const codeOf = (p: string): string => readFileSync(p, 'utf-8')
const K = (s: string): Date => new Date(`${s}+09:00`)
const at = (day: string, m: number): Date =>
  K(`${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`)
const INPUT = {
  runtimeRoot: '/Users/x/Documents/soransoran-runtime', npxPath: '/Users/x/.nvm/versions/node/v24.14.0/bin/npx',
  logDir: '/Users/x/Library/Logs/soransoran', nodeBinDir: '/Users/x/.nvm/versions/node/v24.14.0/bin',
}

console.log('\n══ 발행 heartbeat 후보 fixture (DB 0 · launchctl 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① 정시판은 기본값이고 그대로다 (rollback 대상)')
// ─────────────────────────────────────────────────────────
const fixed = renderPublishRunnerPlist(INPUT)
{
  check('🔴 기본 모드는 fixed 다 — heartbeat 는 명시할 때만', DEFAULT_RUNNER_TRIGGER_MODE === 'fixed')
  check('🔴 정시판 인자는 그대로다 (--apply --limit=1 --trigger=local)', PUBLISH_RUNNER_ARGS.join(' ') === '--apply --limit=1 --trigger=local')
  check('🔴 정시판에 --heartbeat 가 없다', !fixed.includes(HEARTBEAT_FLAG))
  check('🔴 정시판 슬롯 10개 그대로', (fixed.match(/<key>Hour<\/key>/g) ?? []).length === 10)
  check('🔴 renderRunnerPlistFor(fixed) = renderPublishRunnerPlist', renderRunnerPlistFor('fixed', INPUT) === fixed)
  check('🔴 모르는 모드는 정시판으로 떨어지지 않고 오류다', (() => {
    try { renderRunnerPlistFor('hourly' as RunnerTriggerMode, INPUT); return false } catch { return true }
  })())
  const back = parseInstalledRunnerPlist(fixed)
  check('🔴 설치본 되읽기 → 다시 렌더하면 바이트 단위로 같다', back !== null && renderPublishRunnerPlist(back) === fixed)
  check('🔴 되읽기가 반쪽이면 null 이다(추측으로 채우지 않는다)', parseInstalledRunnerPlist(fixed.replace(/<key>WorkingDirectory<\/key>.*\n/, '')) === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n② heartbeat 판 — 트리거만 다르다')
// ─────────────────────────────────────────────────────────
const hb = renderPublishHeartbeatPlist(INPUT)
const wakes = heartbeatWakeTimes()
{
  check('🔴 간격은 10분이다', HEARTBEAT_INTERVAL_MINUTES === 10)
  check('🔴 깨우는 시각 85개 — 08:00 부터 22:00 까지', wakes.length === 85
    && minuteOfDay(wakes[0]!) === PUBLISH_WINDOW_START_MINUTE && minuteOfDay(wakes.at(-1)!) === PUBLISH_WINDOW_END_MINUTE)
  check('🔴 격자 판정 문제 0 — 10분 간격 · 슬롯 전부 격자 위 · 창 안', verifyHeartbeatGrid(wakes).length === 0, verifyHeartbeatGrid(wakes).join(' / '))
  check('🔴 정시 슬롯 10개가 전부 heartbeat 시각이다(지연 0)',
    publishRunnerSlots().every((s) => wakes.some((w) => minuteOfDay(w) === minuteOfDay(s))))
  check('🔴 [반례] 슬롯 하나가 격자에서 빠지면 잡는다',
    verifyHeartbeatGrid(wakes.filter((w) => minuteOfDay(w) !== 9 * 60 + 30)).some((p) => p.includes('09:30')))
  check('🔴 [반례] 창 밖 시각을 넣으면 잡는다',
    verifyHeartbeatGrid([...wakes, { hour: 22, minute: 10, count: 0 }]).length > 0)
  check('🔴 heartbeat 인자 = 정시판 인자 + --heartbeat 하나',
    PUBLISH_HEARTBEAT_ARGS.join(' ') === `${PUBLISH_RUNNER_ARGS.join(' ')} ${HEARTBEAT_FLAG}`)
  check('🔴 시험용 틱 디렉터리 인자는 운영 인자에 없다', !PUBLISH_HEARTBEAT_ARGS.some((a) => a.startsWith('--heartbeat-tick-dir')))
  check('🔴 label 이 정시판과 같다 — 둘이 동시에 등록되는 길이 없다', hb.includes(`<string>${PUBLISH_RUNNER_LABEL}</string>`))
  check('🔴 RunAtLoad 는 false 그대로', hb.includes('<key>RunAtLoad</key><false/>'))
  check('🔴 StartInterval 을 쓰지 않는다(위상이 load 시각에 묶인다)', !hb.includes('StartInterval</key>'))
  check('🔴 비밀값 없음', judgeRunnerSecrets(hb).ok)
  const a = fixed.split('\n')
  const b = hb.split('\n')
  const diff = [...a.filter((l) => !b.includes(l)), ...b.filter((l) => !a.includes(l))]
  check('🔴 정시판과의 차이는 달력 항목과 --heartbeat 뿐이다',
    diff.length > 0 && diff.every((l) => l.includes('<key>Hour</key>') || l.includes(HEARTBEAT_FLAG)), diff.filter((l) => !l.includes('<key>Hour</key>')).join(' | '))
  const cmds = heartbeatCommands({ agentPlist: '/A/x.plist', renderedHeartbeat: '/T/h.plist', renderedFixed: '/T/f.plist', backupPlist: '/B/f.plist' })
  check('🔴 설치 명령은 백업을 먼저 한다', cmds.install[1]!.startsWith('cp -p "/A/x.plist" "/B/f.plist"')
    && cmds.install.findIndex((c) => c.includes('bootout')) > 1)
  check('🔴 설치 명령에 lint 가 bootstrap 앞에 있다',
    cmds.install.findIndex((c) => c.startsWith('plutil -lint')) < cmds.install.findIndex((c) => c.includes('bootstrap')))
  check('🔴 rollback 은 백업을 같은 자리에 되돌린다', cmds.rollback.some((c) => c.startsWith('cp "/B/f.plist" "/A/x.plist"')))
  check('🔴 설치 절차가 GitHub 예약을 끄지 않는다고 적는다', HEARTBEAT_INSTALL_STEPS.some((s) => s.includes('GitHub 예약은 **끄지 않는다**')))
  const tpl = codeOf('scripts/lib/original-post-runner-template.ts')
  check('🔴 템플릿은 여전히 파일을 쓰지 않는다', !/writeFileSync|mkdirSync|execFileSync|execSync/.test(tpl))
  const pre = codeOf('scripts/publish-heartbeat-preflight.mts')
  check('🔴 preflight 는 launchctl 을 **부르지 않는다**(명령 문자열만 출력)',
    !/execFileSync\('launchctl'|spawn(Sync)?\('launchctl'/.test(pre) && !/LaunchAgents[^\n]*writeFileSync|writeFileSync\(AGENT/.test(pre))
  check('🔴 preflight 는 lint 를 임시 디렉터리에서만 한다', /mkdtempSync\(join\(tmpdir\(\)/.test(pre) && /'plutil', \['-lint'/.test(pre))
  check('🔴 preflight 는 runtime 미관측을 통과로 세지 않는다', /미관측은 통과가 아니다/.test(pre))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 10분 wake 로 하루 — 첫 슬롯 전 0 · 도래 수 이하 · 천장까지')
// ─────────────────────────────────────────────────────────
const DAY = '2026-10-01'
for (const stage of RELEASE_STAGES) {
  const arrivals = wakes.map((w) => at(DAY, minuteOfDay(w)))
  const sim = simulateDay({ stage, arrivals, trigger: 'local' })
  const first = Math.min(...PROFILES[stage].slots.map(minuteOfDay))
  let cum = 0
  let overDue = false
  let early = false
  for (const t of sim.perTrigger) {
    const [h, m] = t.atKst.split(':').map(Number) as [number, number]
    const mm = h * 60 + m
    if (t.allowed > 0 && mm < first) early = true
    cum += t.allowed
    if (cum > dueCountAt(stage, mm)) overDue = true
  }
  const publishTimes = sim.perTrigger.filter((t) => t.allowed > 0).map((t) => t.atKst)
  const slotTimes = [...PROFILES[stage].slots].sort((a, b) => minuteOfDay(a) - minuteOfDay(b))
    .map((s) => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`)
  check(`🔴 ${stage} — 첫 슬롯 전 발행 0 · 누적이 도래 수를 넘지 않는다 · 하루 ${sim.published}/${catchUpDailyCeiling(stage)}`,
    !early && !overDue && sim.published === catchUpDailyCeiling(stage), `early=${early} over=${overDue} pub=${sim.published}`)
  check(`🔴 ${stage} — 발행 시각 = 슬롯 시각 (지연 0) ${publishTimes.join(',')}`,
    publishTimes.join(',') === slotTimes.join(','), `${publishTimes.join(',')} vs ${slotTimes.join(',')}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 절전 뒤 catch-up — 같은 KST 날짜 · 운영 창 안에서만')
// ─────────────────────────────────────────────────────────
{
  // 09:00~14:59 절전 · 15:07 wake(합쳐진 1회) · 이후 10분 틱
  const awake = wakes.map((w) => minuteOfDay(w)).filter((m) => m < 9 * 60 || m >= 15 * 60 + 10)
  const arrivals = [...awake.map((m) => at(DAY, m)), at(DAY, 15 * 60 + 7)]
  const sim = simulateDay({ stage: 'd10', arrivals, trigger: 'local' })
  const pubs = sim.perTrigger.filter((t) => t.allowed > 0).map((t) => t.atKst)
  check('🔴 d10 — 15:07 wake 부터 한 틱에 1건씩 메운다(한 번에 쏟지 않는다)',
    sim.perTrigger.every((t) => t.allowed <= 1) && pubs.slice(0, 6).join(',') === '08:10,15:07,15:10,15:20,15:30,15:40', pubs.join(','))
  check('🔴 d10 — 창이 끝나기 전에 하루 10건을 다 채운다', sim.published === 10, String(sim.published))
  // 18:00 부터 절전(17:30 까지 8건) · 23:40 wake → 창 밖이라 0 · 다음 날 07:55 wake 도 0 · 08:10 에 그날 몫 1건만
  const d1 = simulateDay({ stage: 'd10', trigger: 'local', arrivals: [...wakes.map((w) => minuteOfDay(w)).filter((m) => m < 18 * 60).map((m) => at(DAY, m)), at(DAY, 23 * 60 + 40)] })
  const late = d1.perTrigger.at(-1)!
  check('🔴 22:00 넘어 깬 wake 는 밀린 것을 메우지 않는다', late.atKst === '23:40' && late.allowed === 0 && d1.published === 8, `${late.atKst}/${late.allowed}/${d1.published}`)
  const next = simulateDay({ stage: 'd10', trigger: 'local', arrivals: [K('2026-10-02T07:55:00'), K('2026-10-02T08:10:00'), K('2026-10-02T08:20:00')] })
  check('🔴 다음 날 — 전날 backlog 를 가져오지 않는다(07:55 0 · 08:10 1 · 08:20 0)',
    next.perTrigger.map((t) => t.allowed).join(',') === '0,1,0', next.perTrigger.map((t) => `${t.atKst}:${t.allowed}`).join(','))
  check('🔴 창 밖 판정 — 07:59 · 22:01 은 밖 · 08:00 · 22:00 은 안',
    !heartbeatInWindow(K('2026-10-01T07:59:00')) && !heartbeatInWindow(K('2026-10-01T22:01:00'))
    && heartbeatInWindow(K('2026-10-01T08:00:00')) && heartbeatInWindow(K('2026-10-01T22:00:00')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 틱 잠금 — 같은 틱 두 번째 wake 는 물러난다')
// ─────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'soran-hb-check-'))
{
  check('🔴 틱 키 — 16:53 은 16:50 틱', heartbeatTickKey(K('2026-10-01T16:53:00')) === '2026-10-01T16-50')
  check('🔴 틱 키 — UTC 15:05(= KST 다음 날 00:05)는 다음 날 00:00 틱', heartbeatTickKey(new Date('2026-10-01T15:05:00Z')) === '2026-10-02T00-00')
  const dir = join(tmp, 'a')
  const c1 = claimHeartbeatTick(dir, K('2026-10-01T16:53:00'))
  const c2 = claimHeartbeatTick(dir, K('2026-10-01T16:57:00'))
  const c3 = claimHeartbeatTick(dir, K('2026-10-01T17:00:00'))
  check('🔴 첫 wake 차지 · 같은 틱 두 번째 TICK_TAKEN · 다음 틱은 다시 차지',
    c1.ok && !c2.ok && c2.kind === 'TICK_TAKEN' && c3.ok, JSON.stringify([c1, c2, c3]))
  check('🔴 쥔 채로 죽어도 그 틱 하나만 잃는다 — 다음 틱은 다른 파일이다', c1.ok && c3.ok && c1.path !== c3.path)
  // 지난 날짜 표식만 정리
  writeFileSync(join(dir, 'tick-2026-09-30T21-50.lock'), '{}')
  writeFileSync(join(dir, 'unrelated.txt'), 'x')
  const pruned = pruneOldTicks(dir, K('2026-10-01T17:10:00'))
  const left = readdirSync(dir).sort()
  check('🔴 지난 날짜 표식만 지운다 — 오늘 것 · 모르는 파일은 그대로',
    pruned === 1 && left.includes('unrelated.txt') && left.includes('tick-2026-10-01T16-50.lock') && !left.includes('tick-2026-09-30T21-50.lock'), left.join(','))
  // 디렉터리를 만들 수 없는 자리 → UNWRITABLE (발행하지 않고 실패)
  writeFileSync(join(tmp, 'file'), 'x')
  const bad = claimHeartbeatTick(join(tmp, 'file', 'sub'), K('2026-10-01T16:53:00'))
  check('🔴 쓸 수 없는 자리 → UNWRITABLE (TICK_TAKEN 으로 삼키지 않는다)', !bad.ok && bad.kind === 'UNWRITABLE', JSON.stringify(bad))
}

/** 🔴 실제 다중 프로세스 — 같은 순간 8개가 같은 틱을 노린다 */
async function race(n: number): Promise<number> {
  const dir = join(tmp, 'race')
  const mod = join(process.cwd(), 'scripts/lib/publish-heartbeat-tick.mts')
  const code = `import { claimHeartbeatTick } from ${JSON.stringify(mod)}; const r = claimHeartbeatTick(${JSON.stringify(dir)}, new Date('2026-10-01T16:53:00+09:00')); console.log(r.ok ? 'WON' : r.kind)`
  const runs = Array.from({ length: n }, () => new Promise<string>((resolve) => {
    const c = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code])
    let out = ''
    c.stdout.on('data', (d: Buffer) => { out += d.toString() })
    c.on('close', () => resolve(out.trim()))
  }))
  const outs = await Promise.all(runs)
  console.log(`     경쟁 결과 ${outs.join(' · ')}`)
  return outs.filter((o) => o === 'WON').length === 1 && outs.filter((o) => o === 'TICK_TAKEN').length === n - 1 ? 1 : 0
}
check('🔴 🔴 **8 프로세스 동시 — 정확히 1개만 차지 · 나머지 7개 TICK_TAKEN**', (await race(8)) === 1)

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 로컬/GitHub 단계 입력 분기 — 값으로 · fail-closed')
// ─────────────────────────────────────────────────────────
{
  const NOW = K('2026-09-26T16:00:00')
  const local = { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' }
  const github = { ...local, SORAN_RELEASE_WINDOW_STAGE: 'd3', SORAN_RELEASE_WINDOW_FROM: '2026-09-23', SORAN_RELEASE_WINDOW_UNTIL: '2026-09-29' }
  const li = stageInputsOf(local, NOW)
  check('🔴 기간 변수 없는 로컬 — 천장 d1 · 하루 1', li.ceiling === 'd1' && li.ceilingDailyTarget === 1 && li.window.stage === null)
  check('🔴 로그 한 줄에 천장이 값으로 찍힌다', describeStageInputs(li).includes('천장 d1 (하루 1건)') && describeStageInputs(li).includes('window=(없음)'))
  const gi = stageInputsOf(github, NOW)
  check('🟢 GitHub(기간 d3 · 오늘 유효) — 천장 d3', gi.ceiling === 'd3' && gi.window.activeToday)
  const v = judgeHeartbeatStageInputs({ local, github, now: NOW })
  check('🔴 🔴 **로컬 d1 < GitHub d3 — 막는다(설치 목적을 이루지 못한다) · 분기는 값으로 적는다**',
    !v.ok && v.blockers.some((b) => b.includes('local d1') && b.includes('GitHub d3'))
    && v.divergences.some((d) => d.includes('SORAN_RELEASE_WINDOW_STAGE')))
  const flip = judgeHeartbeatStageInputs({ local: github, github: local, now: NOW })
  check('🔴 🔴 **로컬 > GitHub — 막는다(자주 깨는 쪽이 더 넓으면 fail-open)**', !flip.ok && flip.blockers.some((b) => b.includes('fail-open')))
  const both3 = judgeHeartbeatStageInputs({ local: github, github, now: NOW })
  check('🟢 실효 천장이 같으면(d3 · d3) 통과', both3.ok && both3.blockers.length === 0)
  const none = judgeHeartbeatStageInputs({ local, github: null, now: NOW })
  check('🔴 GitHub 을 못 읽으면 막는다', !none.ok)
  check('🟢 기간이 끝난 날은 GitHub 도 d1 — 분기 없이 같은 천장',
    stageInputsOf(github, K('2026-09-30T10:00:00')).ceiling === 'd1')
  const picked = pickStageInputKeys('DATABASE_URL=postgres://secret\nSORAN_RELEASE_STAGE=d1\nSORAN_RELEASE_WINDOW_STAGE="d3"\nGEMINI_API_KEY=x')
  check('🔴 정본 env 에서 단계 키만 뽑는다 — 비밀값 키는 메모리에도 없다',
    Object.keys(picked).sort().join(',') === 'SORAN_RELEASE_STAGE,SORAN_RELEASE_WINDOW_STAGE' && picked.SORAN_RELEASE_WINDOW_STAGE === 'd3')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥-b 🔴 실행 반례 — 실제 preflight 프로세스(`--stage-only`)의 종료 코드')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 판정 함수가 아니라 **preflight 프로세스**를 띄워 종료 코드를 본다. 단계 게이트는 전체 실행과
   *    같은 함수(`stageGate`)다. 입력은 임시 파일 — 정본 env · gh 를 읽지 않는다.
   */
  const dir = mkdtempSync(join(tmpdir(), 'soran-hb-stage-'))
  const envFile = (name: string, kv: Record<string, string>): string => {
    const f = join(dir, `${name}.env`)
    writeFileSync(f, Object.entries(kv).map(([k, v]) => `${k}=${v}`).join('\n') + '\nDATABASE_URL=must-not-be-read\n')
    return f
  }
  const ghFile = (name: string, kv: Record<string, string>): string => {
    const f = join(dir, `${name}.json`)
    writeFileSync(f, JSON.stringify(Object.entries(kv).map(([k, v]) => ({ name: k, value: v }))))
    return f
  }
  const AT = '2026-09-26T07:00:00Z'
  const base = { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' }
  const w3 = { SORAN_RELEASE_WINDOW_STAGE: 'd3', SORAN_RELEASE_WINDOW_FROM: '2026-09-23', SORAN_RELEASE_WINDOW_UNTIL: '2026-09-29' }
  const w5 = { SORAN_RELEASE_WINDOW_STAGE: 'd5', SORAN_RELEASE_WINDOW_FROM: '2026-09-23', SORAN_RELEASE_WINDOW_UNTIL: '2026-09-29' }
  const oldCanary = { SORAN_RELEASE_CANARY_STAGE: 'd5', SORAN_RELEASE_CANARY_DATE: '2026-09-24' }
  const run = (local: string, gh: string): { code: number | null; out: string } => {
    const r = spawnSync(process.execPath, [...process.execArgv, 'scripts/publish-heartbeat-preflight.mts',
      '--stage-only', `--local-env-file=${local}`, `--github-vars-file=${gh}`, `--now=${AT}`], { encoding: 'utf-8' })
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }
  const c1 = run(envFile('l1', base), ghFile('g1', { ...base, ...w3, ...oldCanary }))
  check('🔴 🔴 **① 실측 모양 local d1 / GitHub d3 → exit 1**', c1.code === 1 && c1.out.includes('실효 천장 불일치 — local d1'), `exit ${c1.code}`)
  const c2 = run(envFile('l2', { ...base, ...w3 }), ghFile('g2', { ...base, ...w3 }))
  check('🟢 ② local d3 / GitHub d3 → exit 0', c2.code === 0 && c2.out.includes('🟢 같다'), `exit ${c2.code}`)
  const c3 = run(envFile('l3', { ...base, ...w3 }), ghFile('g3', { ...base, ...w5 }))
  check('🔴 🔴 **③ local d3 / GitHub d5 → exit 1**', c3.code === 1 && c3.out.includes('local d3') && c3.out.includes('GitHub d5'), `exit ${c3.code}`)
  const c4 = run(envFile('l4', { ...base, ...w3 }), ghFile('g4', { ...base, ...w3, ...oldCanary }))
  check('🟢 ④ 지난 canary 문자열만 다르고 양쪽 천장 d3 → 분기 표시 · exit 0',
    c4.code === 0 && c4.out.includes('분기 SORAN_RELEASE_CANARY_STAGE') && !c4.out.includes('실효 천장 불일치'), `exit ${c4.code}`)
  const c5 = run(envFile('l5', { ...base, ...w3 }), join(dir, 'missing.json'))
  check('🔴 ⑤ GitHub 을 못 읽으면 → exit 1 (fail-closed)', c5.code === 1 && c5.out.includes('읽지 못했다'), `exit ${c5.code}`)
  check('🔴 단계 게이트는 env 에서 단계 키만 읽는다 — 비밀값 줄이 출력에 없다', ![c1, c2, c3, c4, c5].some((c) => c.out.includes('must-not-be-read')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 러너 배선 — 줄이는 것만 · 발행 권한은 트랜잭션 그대로')
// ─────────────────────────────────────────────────────────
{
  const r = codeOf('scripts/original-post-auto-publish.mts')
  const iPrisma = r.indexOf('const prisma = new PrismaClient()')
  const iWindow = r.indexOf('if (!heartbeatInWindow(RUN_AT))')
  const iClaim = r.indexOf('claimHeartbeatTick(dir, RUN_AT)')
  check('🔴 러너가 --heartbeat 를 읽는다', /const HEARTBEAT = argv\.includes\(HEARTBEAT_FLAG\)/.test(r))
  check('🔴 창 밖 생략이 DB 연결 **앞**이다', iWindow > 0 && iWindow < iPrisma)
  check('🔴 틱 잠금이 DB 연결 **앞**이다(선택 단계에 들어가기 전)', iClaim > 0 && iClaim < iPrisma)
  check('🔴 틱 잠금은 --apply 에서만 — dry-run 이 실제 wake 를 막지 않는다', /if \(APPLY\) \{\s*\n\s*\/\*\*[^]*?claimHeartbeatTick/.test(r))
  check('🔴 쓰기 불가는 실패로 끝난다(fail-closed)', /claim\.kind === 'UNWRITABLE'\) fail\(/.test(r))
  check('🔴 heartbeat 는 --trigger=local 에서만', /TRIGGER !== 'local'\) fail\(/.test(r))
  check('🔴 단계 입력을 값으로 로그한다', /describeStageInputs\(stageInputsOf\(process\.env, axisNow\)\)/.test(r))
  check('🔴 발행은 여전히 scheduled 트랜잭션이다 — 트리거가 건수를 정하지 않는다',
    /mode: \{ kind: 'scheduled', releaseStage: scale\.releaseStage, planned, unattended: TRIGGER === 'local' \|\| TRIGGER === 'schedule' \}/.test(r) && !/HEARTBEAT[^\n]*dailyCap|dailyCap[^\n]*HEARTBEAT/.test(r))
  check('🔴 러너의 시계는 하나다 — 틱·창 판정도 RUN_AT', r.split('\n').filter((l) => /new Date\(\)/.test(l)).length === 1
    && r.indexOf('const RUN_AT = new Date()') < r.indexOf('const HEARTBEAT = '))
  check('🔴 러너가 트랜잭션 시계를 주입하지 않는다', !/publishOriginalPostTx\([^)]*\{\s*now:/.test(r))
  const tx = codeOf('src/lib/original-post-publish-tx.ts')
  check('🔴 트랜잭션은 트리거 종류와 무관하게 local 계약으로 슬롯을 다시 센다',
    /judgeCatchUp\(\{ stage, now: txNow, trigger: 'local', cron: null, publishedToday: publishedTodayInTx \}\)/.test(tx)
    && /Math\.min\(slot\.dueCount, target\)/.test(tx))
  check('🔴 트랜잭션은 heartbeat 를 모른다(분기 없음)', !/heartbeat/i.test(tx))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ GitHub Actions 사용량 — 예약 변화 0')
// ─────────────────────────────────────────────────────────
{
  const wfDir = '.github/workflows'
  const files = readdirSync(wfDir).filter((f) => f.endsWith('.yml'))
  const withHb = files.filter((f) => codeOf(join(wfDir, f)).includes(HEARTBEAT_FLAG))
  check('🔴 어느 워크플로우도 --heartbeat 로 러너를 부르지 않는다', withHb.length === 0, withHb.join(','))
  const cronsOf = (f: string): number => codeOf(join(wfDir, f)).split('\n').filter((l) => /^\s*-\s*cron:/.test(l)).length
  check('🔴 auto-publish 예약은 10개 그대로다(GitHub 백업 wake 유지 · 늘리지 않음)', cronsOf('auto-publish.yml') === 10)
  check('🔴 visibility-guard 예약은 하루 1개 그대로다', cronsOf('visibility-guard.yml') === 1)
  const total = files.reduce((n, f) => n + cronsOf(f), 0)
  console.log(`     워크플로우 ${files.length}개 · cron 줄 합계 ${total} (이 변경은 cron 을 더하지도 빼지도 않는다)`)
}

// 🔴 KST 분 계산이 러너·트랜잭션과 같은 함수인지 — 다른 시계로 틱을 세지 않는다
check('🔴 틱 키와 창 판정이 catch-up 의 kstMinuteOfDay 를 쓴다',
  /kstMinuteOfDay\(now\)/.test(codeOf('scripts/lib/publish-heartbeat-tick.mts')) && kstMinuteOfDay(K('2026-10-01T16:53:00')) === 1013)

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
