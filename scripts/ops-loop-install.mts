#!/usr/bin/env tsx
/**
 * 무인 운영 루프 공식 설치기. 기본은 계획만이며 `--apply`만 변경한다.
 * 발행 러너의 현재 trigger(fixed/heartbeat)를 보존하고 controller·recover·keep-awake를 설치한다.
 * 판정·적용 순서는 `lib/ops-loop-install-core.mts` 에 있다(검사가 가짜 launchctl 로 실행해 본다).
 * 공급 job은 runtime deploy가 설치한 stage consumer 배선을 읽기 전용으로 검증한다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  leftoverPlaceholders, programArguments, readInstalled, removeInstalled, render, templatePathOf, writeInstalled,
} from './lib/launchd-install.mjs'
import { applyInstall, desiredPlists, runningBlockers } from './lib/ops-loop-install-core.mjs'
import {
  PUBLISH_HEARTBEAT_ARGS, PUBLISH_RUNNER_ARGS, PUBLISH_RUNNER_LABEL, type RunnerTriggerMode,
  judgeLaunchdRunMarker, plistEnvironmentOf,
} from './lib/original-post-runner-template'

type SnapshotRow = { label: string; installed: boolean; loaded: boolean; file: string | null }
type Snapshot = { createdAt: string; rows: SnapshotRow[] }

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const rollbackArg = argv.find((a) => a.startsWith('--rollback='))?.slice('--rollback='.length) ?? null
if (apply && rollbackArg !== null) {
  console.error('🔴 --apply와 --rollback은 함께 쓸 수 없다')
  process.exit(2)
}

const home = homedir()
const runtimeRoot = join(home, 'Documents', 'soransoran-runtime')
const agentDir = join(home, 'Library', 'LaunchAgents')
const logDir = join(home, 'Library', 'Logs', 'soransoran')
const canonDir = join(home, 'Library', 'Application Support', 'soransoran')
const pinFile = join(canonDir, 'runtime-pinned-sha')
const backupRoot = join(canonDir, 'ops-loop-rollback')
const uid = process.getuid?.() ?? 0
const domain = `gui/${uid}`

const run = (cmd: string, args: readonly string[], cwd = runtimeRoot): { ok: boolean; out: string } => {
  try {
    return { ok: true, out: execFileSync(cmd, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  } catch (error) {
    const e = error as { stdout?: string | Buffer; stderr?: string | Buffer }
    return { ok: false, out: `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`.trim() }
  }
}
const real = (path: string): string | null => { try { return realpathSync(path) } catch { return null } }
const samePlist = (installed: string | null, expected: string): boolean =>
  installed !== null && installed.trimEnd() === expected.trimEnd()
const plistPath = (label: string): string => join(agentDir, `${label}.plist`)
const loaded = (label: string): boolean => run('launchctl', ['print', `${domain}/${label}`], home).ok
const running = (label: string): boolean => {
  const p = run('launchctl', ['print', `${domain}/${label}`], home)
  return p.ok && /\bstate = running\b/.test(p.out)
}
const bootout = (label: string): void => { run('launchctl', ['bootout', `${domain}/${label}`], home) }
const bootstrap = (label: string): boolean => run('launchctl', ['bootstrap', domain, plistPath(label)], home).ok

function restore(snapshotDir: string): boolean {
  const manifestPath = join(snapshotDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    console.error(`🔴 rollback manifest가 없다 — ${manifestPath}`)
    return false
  }
  const snapshot = JSON.parse(readFileSync(manifestPath, 'utf8')) as Snapshot
  let ok = true
  for (const row of snapshot.rows) bootout(row.label)
  for (const row of snapshot.rows) {
    if (row.installed && row.file !== null) {
      const xml = readFileSync(join(snapshotDir, row.file), 'utf8')
      ok = writeInstalled(agentDir, row.label, xml) && ok
    } else {
      ok = removeInstalled(agentDir, row.label) && ok
    }
  }
  for (const row of snapshot.rows) {
    if (row.loaded && row.installed) ok = bootstrap(row.label) && ok
  }
  console.log(`${ok ? '✅' : '🔴'} rollback ${snapshotDir}`)
  return ok
}

if (rollbackArg !== null) process.exit(restore(resolve(rollbackArg)) ? 0 : 1)

console.log(`\n══ 무인 운영 루프 설치 — ${apply ? '🔴 실제 적용' : '계획만 (변경 0)'} ══\n`)
const problems: string[] = []
if (real(process.cwd()) !== real(runtimeRoot)) problems.push(`runtime 트리에서 실행해야 한다 — 지금 ${process.cwd()}`)
const head = run('git', ['rev-parse', 'HEAD'])
const pinned = run('cat', [pinFile], home)
if (!head.ok || !pinned.ok || head.out !== pinned.out) problems.push('runtime HEAD와 pin이 다르다 — runtime:deploy 먼저')
if (!run('git', ['diff', '--quiet']).ok) problems.push('runtime 작업 트리가 dirty다')

const npxPath = join(dirname(process.execPath), 'npx')
const input = { runtimeRoot, npxPath, nodeBinDir: dirname(process.execPath), logDir }
if (!existsSync(npxPath)) problems.push(`npx가 없다 — ${npxPath}`)

const installedPublish = readInstalled(agentDir, PUBLISH_RUNNER_LABEL)
const installedPublishArgs = installedPublish === null ? [] : programArguments(installedPublish)
const heartbeat = installedPublishArgs.includes(PUBLISH_HEARTBEAT_ARGS[PUBLISH_HEARTBEAT_ARGS.length - 1]!)
const fixedShape = PUBLISH_RUNNER_ARGS.every((arg) => installedPublishArgs.includes(arg))
const publishMode: RunnerTriggerMode = heartbeat ? 'heartbeat' : 'fixed'
if (installedPublish === null) problems.push('발행 러너 설치본이 없다')
else if (!fixedShape) problems.push('발행 러너 인자를 알아볼 수 없다 — trigger를 추측하지 않는다')

const desired = desiredPlists(publishMode, input)
for (const [label, xml] of desired) {
  const left = leftoverPlaceholders(xml)
  if (left.length > 0) problems.push(`${label} placeholder가 남았다 — ${left.join(', ')}`)
}
// 🔴 발행 job 은 launchd 실행 표식·label 을 plist 에 명시해야 한다 — 회차 기록이 이것으로만 남는다
for (const p of judgeLaunchdRunMarker(plistEnvironmentOf(desired.get(PUBLISH_RUNNER_LABEL)!)).problems) {
  problems.push(`발행 러너 렌더 ${p}`)
}

const supplyLabel = 'com.soransoran.supply-process'
const supplyTemplate = readFileSync(templatePathOf(supplyLabel), 'utf8')
const expectedSupply = render(supplyTemplate, {
  npx: npxPath, node: process.execPath, repo: runtimeRoot, nodebin: dirname(process.execPath), logdir: logDir,
})
const installedSupply = readInstalled(agentDir, supplyLabel)
if (!samePlist(installedSupply, expectedSupply)) problems.push('공급 job이 stage consumer 배선이 아니다 — 이 runtime으로 deploy 먼저')

// 🔴 회차가 돌고 있는 job 위로 내리지 않는다 — 늘 떠 있는 keep-awake 만 예외(판정은 ops-loop-install-core)
problems.push(...runningBlockers(desired.keys(), running))

console.log(`   runtime ${head.ok ? head.out.slice(0, 7) : '읽기 실패'} · publish ${publishMode}`)
console.log(`   supply consumer ${samePlist(installedSupply, expectedSupply) ? '✅' : '🔴'}`)
for (const [label, xml] of desired) {
  const current = readInstalled(agentDir, label)
  console.log(`   ${label.padEnd(42)} ${current === null ? '신규' : current === xml ? '최신' : '교체'}`)
}
for (const problem of problems) console.log(`   🔴 ${problem}`)
if (!apply) {
  console.log(`\n${problems.length === 0 ? '🟢 적용 가능' : `🔴 막힘 ${problems.length}건`} · 실제 적용은 --apply\n`)
  process.exit(problems.length === 0 ? 0 : 1)
}
if (problems.length > 0) {
  console.log('\n🔴 중단 — 아무것도 바꾸지 않았다\n')
  process.exit(1)
}

mkdirSync(logDir, { recursive: true })
mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDir = join(backupRoot, stamp)
mkdirSync(backupDir, { mode: 0o700 })
const rows: SnapshotRow[] = []
for (const label of desired.keys()) {
  const current = readInstalled(agentDir, label)
  const file = current === null ? null : `${label}.plist`
  if (file !== null && current !== null) writeFileSync(join(backupDir, file), current, { mode: 0o600 })
  rows.push({ label, installed: current !== null, loaded: loaded(label), file })
}
writeFileSync(join(backupDir, 'manifest.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), rows } satisfies Snapshot, null, 2)}\n`, { mode: 0o600 })

const outcome = applyInstall(desired, runtimeRoot, {
  bootout,
  write: (label, xml) => writeInstalled(agentDir, label, xml),
  lint: (label) => run('plutil', ['-lint', plistPath(label)], home).ok,
  bootstrap,
  print: (label) => {
    const p = run('launchctl', ['print', `${domain}/${label}`], home)
    return p.ok ? p.out : null
  },
  restore: () => restore(backupDir),
  log: (line) => console.log(line),
})
if (!outcome.ok) process.exit(outcome.restored ? 1 : 2)
console.log(`\n✅ 설치 완료 · rollback: npm run ops:loop-install -- --rollback=${backupDir}\n`)
