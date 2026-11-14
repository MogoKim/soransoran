#!/usr/bin/env tsx
/**
 * D30 Persona 1회 투입 job 설치기 — 🔴 기본은 계획만(변경 0)
 *
 *   npx tsx scripts/persona-d30-oneshot-install.mts --date=2026-11-15            # 계획 — 렌더 결과만
 *   npx tsx scripts/persona-d30-oneshot-install.mts --date=2026-11-15 --apply    # 설치 + bootstrap + 값 대조
 *   npx tsx scripts/persona-d30-oneshot-install.mts --remove                     # bootout + 설치본을 보관소로(지우지 않는다)
 *
 * 🔴 runtime 트리에서만 · HEAD = pin 일 때만. 이미 다른 원문이 깔려 있으면 덮어쓰지 않는다.
 * 🔴 정본 예약 job(RUNTIME_JOBS · ops-loop)을 건드리지 않는다. 이 job 은 자기 Label 하나만 다룬다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { ONESHOT_LABEL, renderOneShotPlist } from './lib/persona-d30-oneshot.mjs'
import { rollbackDirOf } from './lib/launchd-install.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const REMOVE = argv.includes('--remove')
const DATE = (argv.find((a) => a.startsWith('--date=')) ?? '').split('=')[1] ?? ''
const RUNTIME_ROOT = join(homedir(), 'Documents', 'soransoran-runtime')
const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${ONESHOT_LABEL}.plist`)
const UID = process.getuid?.() ?? 0
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const run = (cmd: string, args: string[]): string | null => {
  try { return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch { return null }
}
const loaded = (): boolean => run('launchctl', ['print', `gui/${UID}/${ONESHOT_LABEL}`]) !== null

const real = (p: string): string => { try { return realpathSync(p) } catch { return p } }
if (real(process.cwd()) !== real(RUNTIME_ROOT)) fail(`runtime 트리에서 실행해야 한다 — 지금 ${process.cwd()}`)
const head = run('git', ['rev-parse', 'HEAD'])?.trim() ?? null
const pin = ((): string | null => { try { return readFileSync(join(CANON_DIR, 'runtime-pinned-sha'), 'utf-8').trim() } catch { return null } })()
if (head === null || head !== pin) fail(`HEAD(${head?.slice(0, 8)}) ≠ pin(${pin?.slice(0, 8)})`)

if (REMOVE) {
  if (loaded()) run('launchctl', ['bootout', `gui/${UID}/${ONESHOT_LABEL}`])
  if (loaded()) fail('bootout 뒤에도 loaded 다')
  if (existsSync(PLIST)) {
    const dir = rollbackDirOf(CANON_DIR)
    mkdirSync(dir, { recursive: true })
    renameSync(PLIST, join(dir, `${ONESHOT_LABEL}.${new Date().toISOString().replace(/[:.]/g, '-')}.plist`))
  }
  console.log(`✅ 제거 — unloaded · 설치본 보관소 이동 (${ONESHOT_LABEL})`)
  process.exit(0)
}

const xml = renderOneShotPlist({
  npx: process.execPath.replace(/\/node$/, '/npx'), nodebin: dirname(process.execPath),
  runtimeRoot: RUNTIME_ROOT, logdir: join(homedir(), 'Library', 'Logs', 'soransoran'), date: DATE,
})
console.log(`\n══ ${ONESHOT_LABEL} 설치 — ${APPLY ? '🔴 적용' : '계획만'} · runtime ${head!.slice(0, 12)} · 예정 ${DATE} 07:05 KST ══\n`)
console.log(xml)
const existing = existsSync(PLIST) ? readFileSync(PLIST, 'utf-8') : null
if (existing !== null && existing !== xml) fail('다른 원문의 설치본이 이미 있다 — 덮어쓰지 않는다(--remove 뒤 다시)')
if (!APPLY) { console.log('🟡 계획만 — 변경 0'); process.exit(0) }

if (existing === null) {
  const tmp = `${PLIST}.tmp-${process.pid}`
  writeFileSync(tmp, xml, { mode: 0o644 })
  if (run('plutil', ['-lint', tmp]) === null) fail('plutil -lint 실패')
  renameSync(tmp, PLIST)
}
if (!loaded()) run('launchctl', ['bootstrap', `gui/${UID}`, PLIST])
const print = run('launchctl', ['print', `gui/${UID}/${ONESHOT_LABEL}`])
if (print === null) fail('bootstrap 뒤 loaded 가 아니다')
const okArgs = print!.includes(`--date=${DATE}`) && print!.includes(`${RUNTIME_ROOT}/scripts/persona-d30-oneshot.mts`)
const okWd = print!.includes(`working directory = ${RUNTIME_ROOT}`)
if (!okArgs || !okWd) fail('loaded 설정이 렌더 원문과 다르다')
console.log(`✅ 설치 — loaded · 인자·WorkingDirectory 값 대조 일치 · 원문 sha256 ${execFileSync('shasum', ['-a', '256', PLIST], { encoding: 'utf-8' }).split(' ')[0]}`)
