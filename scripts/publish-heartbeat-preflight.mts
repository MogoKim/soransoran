#!/usr/bin/env tsx
/**
 * 발행 heartbeat **설치 전 preflight** — 🔴 dry-run 전용. launchctl 0 · LaunchAgents write 0 · DB 0 · 발행 0
 *
 * 🔴 **하는 일**
 *    ① 설치본(`~/Library/LaunchAgents/com.soransoran.original-post-runner.plist`)을 **읽기만** 한다
 *    ② 그 설치본의 경로(runtime · npx · 로그 · node bin)로 정시판·heartbeat 판을 렌더한다
 *    ③ 둘 다 **임시 파일**에 쓰고 `plutil -lint` 한다 — 설치 경로에는 쓰지 않는다
 *    ④ 정시판 렌더가 설치본과 바이트 단위로 같은지 본다(= rollback 대상이 지금 설치본이다)
 *    ⑤ 설치본 → heartbeat 차이를 줄 단위로 보인다(트리거만 달라야 한다)
 *    ⑥ 단계 입력 — 정본 env(단계 키 일곱 개만) vs GitHub Variables. 로컬 천장이 더 높으면 막는다
 *    ⑦ 기존 트리거 parity(capacity · release)도 그대로 본다 — 정시판 등록 게이트와 같은 판정이다
 *    ⑧ 설치·rollback 명령을 **출력만** 한다
 *
 * 🔴 **하지 않는 일** — launchctl bootstrap/bootout/load/unload · LaunchAgents 쓰기 · env 수정 ·
 *    GitHub Variables 수정 · runtime 작업트리 접근(경로 문자열만 쓴다).
 *
 *   npm run publish:heartbeat-preflight                      runtime 미관측(막힘으로 끝난다)
 *   npm run publish:heartbeat-preflight -- --check-runtime   설치 직전 — runtime 에 heartbeat 코드가 있는지 stat
 *
 * 종료 코드 — 0 이면 설치 가능 · 1 이면 막힘(이유 출력). 어느 쪽이든 아무것도 바꾸지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  CANONICAL_ENV_PATH, PUBLISH_RUNNER_LABEL, HEARTBEAT_INSTALL_STEPS, STAGE_INPUT_KEYS,
  renderRunnerPlistFor, parseInstalledRunnerPlist, heartbeatCommands, heartbeatWakeTimes, verifyHeartbeatGrid,
  judgeHeartbeatStageInputs, describeStageInputs, judgeTriggerParity, pickStageInputKeys,
  judgeRunnerSecrets, PUBLISH_REPO, type RunnerPlistInput,
} from './lib/original-post-runner-template'
import { CAPACITY_ENV, RELEASE_ENV } from '../src/lib/scale-profile'

const NOW = new Date()
const blockers: string[] = []
const AGENT = join(homedir(), 'Library', 'LaunchAgents', `${PUBLISH_RUNNER_LABEL}.plist`)

console.log('\n══ 발행 heartbeat preflight (dry-run · launchctl 0 · LaunchAgents write 0) ══\n')

// ── ① 설치본 — 읽기만 ──
let installed: string | null = null
try { installed = readFileSync(AGENT, 'utf-8') } catch { installed = null }
const parsed = installed === null ? null : parseInstalledRunnerPlist(installed)
const fallback: RunnerPlistInput = {
  runtimeRoot: join(homedir(), 'Documents', 'soransoran-runtime'),
  npxPath: join(dirname(process.execPath), 'npx'),
  logDir: join(homedir(), 'Library', 'Logs', 'soransoran'),
  nodeBinDir: dirname(process.execPath),
}
const input = parsed ?? fallback
console.log(`① 설치본  ${installed === null ? '🔴 없음' : AGENT}`)
console.log(`   렌더 입력 ${parsed === null ? '(설치본에서 못 읽음 — 기본값)' : '(설치본에서 되읽음)'}`
  + ` runtime=${input.runtimeRoot} · npx=${input.npxPath} · log=${input.logDir} · nodebin=${input.nodeBinDir}`)
if (installed === null) blockers.push('설치본이 없다 — 백업·rollback 대상이 없다')
else if (parsed === null) blockers.push('설치본에서 경로를 되읽지 못했다 — 추측으로 채워 설치하지 않는다')

/**
 * ── ①-b runtime 이 --heartbeat 를 아는가 ──
 * 🔴 옛 러너는 이 인자를 **조용히 무시**한다 — 틱 잠금·창 밖 생략 없이 매 틱 DB 에 붙는다.
 *    기본은 **관측하지 않는다**(runtime 작업트리를 건드리지 않는다). 설치 직전에 사람이
 *    `--check-runtime` 으로 존재만 확인한다(stat · 읽기·쓰기 0). 관측하지 않았으면 막는다(fail-closed).
 */
const RUNTIME_MARK = 'scripts/lib/publish-heartbeat-tick.mts'
if (process.argv.includes('--check-runtime')) {
  const known = existsSync(join(input.runtimeRoot, RUNTIME_MARK))
  console.log(`   runtime 이 heartbeat 를 아는가  ${known ? '✅' : '🔴 모른다'} (${RUNTIME_MARK} 존재 여부만 봤다)`)
  if (!known) blockers.push('runtime 이 --heartbeat 를 모른다 — 먼저 이 커밋 이상으로 runtime:deploy 한다')
} else {
  console.log('   runtime 이 heartbeat 를 아는가  미관측 — 설치 직전 `-- --check-runtime` 으로 본다')
  blockers.push('runtime 이 --heartbeat 를 아는지 관측하지 않았다(--check-runtime) — 미관측은 통과가 아니다')
}

// ── ② 렌더 ──
const fixed = renderRunnerPlistFor('fixed', input)
const heartbeat = renderRunnerPlistFor('heartbeat', input)
const grid = verifyHeartbeatGrid(heartbeatWakeTimes())
console.log(`\n② 렌더  정시판 ${(fixed.match(/<key>Hour<\/key>/g) ?? []).length}회 · heartbeat ${heartbeatWakeTimes().length}회(08:00~22:00 · 10분)`)
for (const g of grid) { console.log(`   🔴 ${g}`); blockers.push(g) }
for (const [name, xml] of [['정시판', fixed], ['heartbeat', heartbeat]] as const) {
  const sec = judgeRunnerSecrets(xml)
  if (!sec.ok) { blockers.push(...sec.problems.map((p) => `${name} ${p}`)) }
}

// ── ③ 임시 파일 + plutil -lint ──
const tmp = mkdtempSync(join(tmpdir(), 'soran-heartbeat-'))
const fixedPath = join(tmp, `${PUBLISH_RUNNER_LABEL}.fixed.plist`)
const heartbeatPath = join(tmp, `${PUBLISH_RUNNER_LABEL}.heartbeat.plist`)
writeFileSync(fixedPath, fixed)
writeFileSync(heartbeatPath, heartbeat)
console.log(`\n③ plutil -lint (임시 파일만 · ${tmp})`)
for (const p of [fixedPath, heartbeatPath]) {
  try {
    const out = execFileSync('plutil', ['-lint', p], { encoding: 'utf-8' }).trim()
    console.log(`   ✅ ${out}`)
  } catch (e) {
    const msg = `plutil -lint 실패 — ${p} · ${String((e as { stdout?: string }).stdout ?? e)}`
    console.log(`   🔴 ${msg}`)
    blockers.push(msg)
  }
}

// ── ④ 정시판 렌더 = 설치본 ──
const fixedMatches = installed !== null && installed === fixed
console.log(`\n④ 정시판 렌더 = 설치본  ${fixedMatches ? '✅ 바이트 단위로 같다 — rollback 대상이 지금 설치본이다' : '🔴 다르다'}`)
if (installed !== null && !fixedMatches) blockers.push('설치본이 정시판 렌더와 다르다 — 무엇이 깔려 있는지 모르는 채로 교체하지 않는다')

// ── ⑤ 설치본 → heartbeat 차이 ──
console.log('\n⑤ 설치본 → heartbeat 차이 (줄 단위)')
if (installed !== null) {
  const a = installed.split('\n')
  const b = heartbeat.split('\n')
  const onlyA = a.filter((l) => !b.includes(l))
  const onlyB = b.filter((l) => !a.includes(l))
  for (const l of onlyA) console.log(`   - ${l.trim()}`)
  const hourLines = onlyB.filter((l) => l.includes('<key>Hour</key>'))
  for (const l of onlyB.filter((x) => !x.includes('<key>Hour</key>'))) console.log(`   + ${l.trim()}`)
  if (hourLines.length > 0) console.log(`   + (StartCalendarInterval 항목 ${hourLines.length}개 추가 — 08:00 · 08:20 · … · 22:00)`)
  const outsideTrigger = [...onlyA, ...onlyB].filter((l) => !l.includes('<key>Hour</key>') && !l.includes('--heartbeat'))
  console.log(`   트리거 밖 차이 ${outsideTrigger.length}줄${outsideTrigger.length === 0 ? ' ✅' : ' 🔴'}`)
  if (outsideTrigger.length > 0) blockers.push('heartbeat 판이 트리거 밖(경로·PATH·로그·label)에서도 설치본과 다르다')
}

// ── ⑥ 단계 입력 — 정본 env(단계 키만) vs GitHub ──
let localEnv: Record<string, string> | null = null
try { localEnv = pickStageInputKeys(readFileSync(CANONICAL_ENV_PATH, 'utf-8')) } catch { localEnv = null }
const githubEnv: Record<string, string> | null = ((): Record<string, string> | null => {
  try {
    const out = execFileSync('gh', ['variable', 'list', '--repo', PUBLISH_REPO, '--json', 'name,value'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    const rows = JSON.parse(out.trim() === '' ? '[]' : out) as { name: string; value: string }[]
    if (!Array.isArray(rows)) return null
    const o: Record<string, string> = {}
    for (const r of rows) if (STAGE_INPUT_KEYS.includes(r.name)) o[r.name] = r.value
    return o
  } catch { return null }
})()
console.log(`\n⑥ 단계 입력 (정본 env · 단계 키 ${STAGE_INPUT_KEYS.length}개만 읽는다)`)
if (localEnv === null) {
  console.log(`   🔴 정본 env 를 읽지 못했다 — ${CANONICAL_ENV_PATH}`)
  blockers.push('정본 env 를 읽지 못했다(fail-closed)')
} else {
  const v = judgeHeartbeatStageInputs({ local: localEnv, github: githubEnv, now: NOW })
  console.log(`   local   ${describeStageInputs(v.local)}`)
  console.log(`   GitHub  ${v.github === null ? '🔴 읽지 못했다' : describeStageInputs(v.github)}`)
  for (const d of v.divergences) console.log(`   ⚠️ 분기 ${d}`)
  for (const b of v.blockers) { console.log(`   🔴 ${b}`); blockers.push(b) }
  // ── ⑦ 기존 parity(정시판 등록 게이트와 같은 판정) ──
  const parity = judgeTriggerParity({
    local: { capacity: localEnv[CAPACITY_ENV], release: localEnv[RELEASE_ENV] },
    github: githubEnv === null ? null : { capacity: githubEnv[CAPACITY_ENV], release: githubEnv[RELEASE_ENV] },
  })
  console.log(`\n⑦ capacity · release parity  ${parity.ok ? '🟢' : '🔴'} ${parity.reason}`)
  for (const b of parity.blockers) blockers.push(`parity — ${b}`)
}

// ── ⑧ 명령 — 출력만 ──
const stamp = NOW.toISOString().replace(/[:.]/g, '-')
const cmds = heartbeatCommands({
  agentPlist: AGENT, renderedHeartbeat: heartbeatPath, renderedFixed: fixedPath,
  backupPlist: join(homedir(), 'Library', 'Application Support', 'soransoran', 'publish-runner-rollback', `${PUBLISH_RUNNER_LABEL}.fixed.${stamp}.plist`),
})
console.log('\n⑧ 🔴 설치 명령 — **실행하지 않았다.** 별도 승인 뒤 사람이 순서대로 친다')
for (const s of HEARTBEAT_INSTALL_STEPS) console.log(`   ${s}`)
cmds.install.forEach((c) => console.log(`   $ ${c}`))
console.log('\n   🔴 rollback 명령 — 정시판(지금 설치본)으로 되돌린다')
cmds.rollback.forEach((c) => console.log(`   $ ${c}`))

console.log(`\n${blockers.length === 0 ? '🟢 설치 가능' : `🔴 막힘 ${blockers.length}건 — 설치 명령을 치지 않는다`}`)
for (const b of blockers) console.log(`   · ${b}`)
console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — launchctl 0 · LaunchAgents write 0 · env 0 · DB 0 · 발행 0\n')
process.exit(blockers.length === 0 ? 0 : 1)
