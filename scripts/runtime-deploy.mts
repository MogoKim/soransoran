#!/usr/bin/env tsx
/**
 * runtime 배포 — 🔴 **기본은 dry-run. `--apply --target=<40자리 SHA>` 만 실제로 바꾼다**
 *
 * 🔴 하는 것: 잠금을 잡고 → fetch 하고 → 예약 job 을 내리고(내려간 것을 확인하고) →
 *    그 SHA 로 옮기고 → offline 게이트를 돌리고 → manifest/pin 을 준비하고 → job 을 올리고
 *    (올라온 것을 확인하고) → **실제 loaded 경로**를 대조하고 →
 *    `runtime:isolation-check --require-runtime` 까지 통과해야 "배포 완료" 다.
 * 🔴 하나라도 실패하면 되돌린다. 되돌리다 하나가 실패해도 **나머지를 계속 시도**하고,
 *    남은 것을 그대로 적은 뒤 exit 1 한다.
 * 🔴 하지 않는 것: live crawl · DB write · 발행 · release 단계 변경 · cron/Variables 변경.
 *
 * 🔴 판단은 전부 `src/lib/runtime-deploy.ts` 의 `runDeploy` 에 있다.
 *    여기는 **진짜 명령을 붙이는 자리**다 — 그래야 fixture 가 가짜를 붙여 실패를 시험할 수 있다.
 *
 * 사용법
 *   npm run runtime:deploy                                   계획만
 *   npm run runtime:deploy -- --apply --target=<full sha>     🔴 실제 배포
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  DEPLOY_FORBIDDEN, DEPLOY_GATES, DEPLOY_STEPS, judgeDeploy, judgeDeployLock, judgeLockRelease,
  OFFLINE_GATES, runDeploy, type DeployEffects,
} from '../src/lib/runtime-deploy'
import { judgeJobState, parseLaunchctlPrint, type JobState } from '../src/lib/runtime-isolation'

const RUNTIME_ROOT = join(homedir(), 'Documents', 'soransoran-runtime')
/** 🔴 예약 실행이 절대 물으면 안 되는 곳 — 개발 작업트리들 */
const DEV_ROOTS = [join(homedir(), 'Documents', 'soransoran-m0')]
const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
export const MANIFEST_FILE = join(CANON_DIR, 'runtime-manifest.json')
const PIN_FILE = join(CANON_DIR, 'runtime-pinned-sha')
const LOCK_FILE = join(CANON_DIR, 'runtime-deploy.lock')
const JOBS = [
  'com.soransoran.navercafe-collect-remonterrace-multi',
  'com.soransoran.navercafe-collect-wgang-multi',
  'com.soransoran.supply-autopilot',
]
const AGENT_DIR = join(homedir(), 'Library', 'LaunchAgents')
const UID = process.getuid?.() ?? 0

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const TARGET = (argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? '').trim() || null

/** 🔴 성공하면 출력, 실패하면 null. **판단에 쓰는 읽기 전용 명령**에만 쓴다 */
const read = (cmd: string, args: readonly string[], cwd = RUNTIME_ROOT): string | null => {
  try { return execFileSync(cmd, [...args], { cwd, encoding: 'utf-8' }).trim() } catch { return null }
}
/** 🔴 side-effect 는 **성공 여부를 돌려준다**. null 로 삼키지 않는다 */
const act = (cmd: string, args: readonly string[], cwd = RUNTIME_ROOT): boolean => {
  try { execFileSync(cmd, [...args], { cwd, stdio: 'inherit' }); return true } catch { return false }
}
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

console.log(`\n══ runtime 배포 — ${APPLY ? '🔴 실제 적용' : 'dry-run (변경 0)'} ══\n`)
console.log(`  runtime  ${RUNTIME_ROOT}`)
if (!existsSync(RUNTIME_ROOT)) fail(`runtime worktree 가 없다 — ${RUNTIME_ROOT}`)

// ── dry-run 이면 여기서 계획만 보여 주고 끝낸다 (fetch 도 하지 않는다) ──
if (!APPLY) {
  const originMainDry = read('git', ['rev-parse', 'origin/main'])
  const gate = judgeDeploy({
    apply: false, target: TARGET, originMain: originMainDry,
    targetOnMain: TARGET === null ? null : read('git', ['merge-base', '--is-ancestor', TARGET, 'origin/main']) !== null,
    runtimeDirty: null, jobsRunning: [],
  })
  // 🔴 apply=false 면 judgeDeploy 는 반드시 막는다. 그래도 좁혀서 읽는다
  console.log(gate.ok ? '\n🟡 적용하지 않는다 — dry-run\n' : `\n🟡 적용하지 않는다 — [${gate.code}] ${gate.reason}\n`)
  console.log('  ── 배포하면 이 순서로 한다')
  for (const s of DEPLOY_STEPS) console.log(`     ${s}`)
  console.log('\n  ── 게이트')
  for (const g of OFFLINE_GATES) console.log(`     · npm run ${g}   (job 이 내려가 있어도 돈다)`)
  console.log('     · npm run runtime:isolation-check -- --require-runtime   🔴 job 을 다시 올린 뒤에만')
  console.log(`\n  🔴 배포가 하지 않는 것: ${DEPLOY_FORBIDDEN.join(' · ')}`)
  console.log(`\n  실제 배포: npm run runtime:deploy -- --apply --target=${originMainDry ?? '<full sha>'}\n`)
  process.exit(0)
}

// ── 🔴 배포 잠금 — 두 배포가 겹치면 어느 SHA 가 올라갔는지 알 수 없다 ──
//
//    🔴 잠금에 **내 token 을 적는다.** 그래야 먼저 죽은 배포의 뒷정리가
//       그 사이 시작한 다른 배포의 잠금을 지우지 못한다.
const MY_TOKEN = randomUUID()
const lock = ((): { ok: boolean; reason: string } => {
  try {
    // 🔴 만들기와 쓰기를 한 핸들로 — 만든 뒤 쓰기 전에 죽으면 빈 잠금이 남는다
    const fd = openSync(LOCK_FILE, 'wx', 0o600)
    try { writeSync(fd, `${MY_TOKEN}\n${process.pid} ${new Date().toISOString()}\n`) } finally { closeSync(fd) }
    return judgeDeployLock({ acquired: true })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    // 🔴 EEXIST 는 "누가 쥐고 있다", 그 밖은 "상태를 모른다" — 둘 다 통과시키지 않는다
    return judgeDeployLock({ acquired: false, unknown: code !== 'EEXIST' })
  }
})()
if (!lock.ok) fail(`${lock.reason}  (잠금 파일: ${LOCK_FILE})`)
const releaseLock = (): void => {
  const fileToken = ((): string | null => {
    try { return readFileSync(LOCK_FILE, 'utf-8').split('\n')[0]!.trim() } catch { return null }
  })()
  const v = judgeLockRelease({ fileToken, myToken: MY_TOKEN })
  // 🔴 내 것이 아니면 그대로 둔다. stale 잠금 자동 회수는 하지 않는다 — 사람이 본다
  if (v.release) { try { unlinkSync(LOCK_FILE) } catch { /* 이미 없다 */ } }
  else console.error(`   🟡 배포 잠금을 지우지 않았다 — ${v.reason}`)
}
process.on('exit', releaseLock)

const plistOf = (label: string): string => join(AGENT_DIR, `${label}.plist`)

/**
 * 🔴 launchctl 이 **지금 물고 있는** 설정을 본다 — plist 파일이 아니라.
 *    실패도 그대로 돌려준다. exit code 와 stderr 가 있어야
 *    "확실히 내려가 있다" 와 "못 봤다" 를 가를 수 있다.
 */
const probePrint = (label: string): { exitCode: number | null; stdout: string; stderr: string } => {
  try {
    const out = execFileSync('launchctl', ['print', `gui/${UID}/${label}`], { cwd: homedir(), encoding: 'utf-8' })
    return { exitCode: 0, stdout: out, stderr: '' }
  } catch (e) {
    const x = e as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer }
    return {
      exitCode: typeof x.status === 'number' ? x.status : null,
      stdout: String(x.stdout ?? ''), stderr: String(x.stderr ?? ''),
    }
  }
}
const stateOf = (label: string): JobState => judgeJobState(probePrint(label)).state

const fx: DeployEffects = {
  fetch: () => act('git', ['fetch', 'origin', 'main']),
  currentSha: () => read('git', ['rev-parse', 'HEAD']),
  originMain: () => read('git', ['rev-parse', 'origin/main']),
  isAncestor: (sha) => read('git', ['merge-base', '--is-ancestor', sha, 'origin/main']) !== null,
  dirty: () => { const d = read('git', ['status', '--porcelain', '--untracked-files=no']); return d === null ? null : d !== '' },
  runningJobs: () => {
    const running: string[] = []
    const unknown: string[] = []
    for (const l of JOBS) {
      const probe = probePrint(l)
      const { state } = judgeJobState(probe)
      // 🔴 못 본 job 을 "실행 중 아님" 으로 통과시키지 않는다
      if (state === 'unknown') { unknown.push(l); continue }
      if (state === 'loaded' && /state = running/.test(probe.stdout)) running.push(l)
    }
    return { running, unknown }
  },

  unload: (l) => act('launchctl', ['unload', plistOf(l)], homedir()),
  probeJob: (l) => stateOf(l),
  load: (l) => act('launchctl', ['load', plistOf(l)], homedir()),

  checkout: (sha) => act('git', ['checkout', '--detach', sha]),
  install: () => act('npm', ['ci']),
  generate: () => act('npx', ['prisma', 'generate']),

  offlineGate: (g) => {
    const a = g.split(' ')
    return act('npm', ['run', a[0]!, ...(a.length > 1 ? ['--', ...a.slice(1)] : [])])
  },
  /**
   * 🔴 실제 loaded 설정을 **정본 파서**로 뽑는다.
   *
   *    옛 판은 출력에서 soransoran 이 들어간 절대경로를 전부 모아 runtime 밑을 요구했다.
   *    그런데 정상 출력에는 plist(`~/Library/LaunchAgents/…`)와 로그(`~/Library/Logs/soransoran/…`)도
   *    들어 있다 — **정상 job 3개가 전부 실패했다**(실측). 판정은 judgeLoadedConfig 가 한다.
   */
  loadedConfig: (l) => parseLaunchctlPrint(probePrint(l).exitCode === 0 ? probePrint(l).stdout : null),
  isolationGate: () => act('npx', ['tsx', 'scripts/runtime-isolation-check.mts', '--require-runtime']),

  readManifest: () => (existsSync(MANIFEST_FILE) ? readFileSync(MANIFEST_FILE, 'utf-8') : null),
  writeManifest: (json) => {
    try {
      // 🔴 원자적으로 쓴다 — 반쯤 쓰인 manifest 를 다음 검사가 읽지 않게
      const tmp = `${MANIFEST_FILE}.tmp-${process.pid}`
      writeFileSync(tmp, `${json}\n`, { encoding: 'utf-8', mode: 0o600 })
      renameSync(tmp, MANIFEST_FILE)
      return true
    } catch { return false }
  },
  removeManifest: () => { try { rmSync(MANIFEST_FILE, { force: true }); return true } catch { return false } },
  writePin: (sha) => { try { writeFileSync(PIN_FILE, `${sha}\n`, { encoding: 'utf-8', mode: 0o600 }); return true } catch { return false } },

  log: (m) => console.log(`   ${m}`),
}

const result = await runDeploy({
  target: TARGET ?? '', jobs: JOBS,
  paths: { runtimeRoot: RUNTIME_ROOT, devRoots: DEV_ROOTS },
}, fx)

console.log('\n  ── 실행한 단계')
for (const s of result.steps) console.log(`     ${s}`)

if (result.ok) {
  console.log(`\n✅ 배포 완료 — ${TARGET!.slice(0, 7)}`)
  console.log(`   게이트: ${DEPLOY_GATES.join(' · ')}`)
  console.log(`   🔴 하지 않은 것: ${DEPLOY_FORBIDDEN.join(' · ')}\n`)
  process.exit(0)
}

console.error(`\n🔴 배포하지 않았다 — ${result.phase} 에서 멈췄다`)
for (const p of result.problems) console.error(`   · ${p}`)
if (result.rollback !== null) {
  console.error(result.rollback.complete
    ? '   ✅ 직전 상태로 되돌렸고 job 3개가 다시 올라왔다'
    : '   🔴 되돌리지 못하고 남은 것:')
  for (const r of result.rollback.residual) console.error(`      · ${r}`)
}
console.error('')
process.exit(1)
