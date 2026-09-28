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
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync,
  unlinkSync, writeFileSync, writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  DEPLOY_FORBIDDEN, DEPLOY_GATES, DEPLOY_STEPS, judgeDeploy, judgeDeployLock, judgeLockRelease,
  OFFLINE_GATES, runDeploy, type DeployEffects,
} from '../src/lib/runtime-deploy'
import {
  JOB_ENV_REQUIREMENTS, judgeJobEnv, judgeJobState, parseLaunchctlPrint,
  partitionJobsByEnv, RETIRED_JOBS, RUNTIME_JOBS, type JobState,
} from '../src/lib/runtime-isolation'
import { readRuntimeEnv as readEnvFile } from './lib/runtime-env.mjs'
import {
  leftoverPlaceholders, plistFileOf, programArguments, readInstalled, removeInstalled,
  render, retireInstalled, rollbackDirOf, templatePathOf, unretireInstalled, valueOf, writeInstalled,
} from './lib/launchd-install.mjs'
/**
 * 🔴 **잠시 멈출 job 의 정본은 `runtime-quiesce-jobs` 하나다** — 여기에 label 을 다시 적지 않는다.
 *    발행 러너·감사 러너는 공급 job 이 아니지만 **같은 runtime 작업 트리**에서 돌기 때문에,
 *    배포 동안만 잠시 멈춘다. `RUNTIME_JOBS` 에 넣지 않는 이유가 그것이다.
 */
import { DEPLOY_QUIESCE_JOBS } from './lib/runtime-quiesce-jobs'

const RUNTIME_ROOT = join(homedir(), 'Documents', 'soransoran-runtime')
/** 🔴 예약 실행이 절대 물으면 안 되는 곳 — 개발 작업트리들 */
const DEV_ROOTS = [join(homedir(), 'Documents', 'soransoran-m0')]
const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
export const MANIFEST_FILE = join(CANON_DIR, 'runtime-manifest.json')
const PIN_FILE = join(CANON_DIR, 'runtime-pinned-sha')
const LOCK_FILE = join(CANON_DIR, 'runtime-deploy.lock')
/** 🔴 정본은 `RUNTIME_JOBS` 하나다 — 여기에 label 을 다시 적지 않는다 */
const JOBS = RUNTIME_JOBS
/**
 * 🔴 **배포 동안만 멈춰 두는 job.** 공급 job 도 퇴역 job 도 아니다 —
 *    render·install·env 판정 어디에도 들어가지 않고, 잠시 내렸다 그대로 되올린다.
 *    🔴 설치되지 않은 job(감사 러너가 그렇다)은 끝까지 설치되지 않는다 — 배포는 설치하지 않는다.
 */
const QUIESCE_JOBS: readonly string[] = DEPLOY_QUIESCE_JOBS
const AGENT_DIR = join(homedir(), 'Library', 'LaunchAgents')
/**
 * 🔴 퇴역 plist 보관소 — 지우지 않고 옮긴다. 되돌릴 수 있어야 한다.
 *    🔴 이름은 `launchd-install` 정본에서 온다. 여기 문자열을 적지 않는다 —
 *    적었다가 격리 검사와 어긋나 PR #501 배포가 마지막 게이트에서 멈췄다.
 */
const ROLLBACK_DIR = rollbackDirOf(CANON_DIR)
const UID = process.getuid?.() ?? 0
/**
 * 🔴 **치환값.** 설치 절차(README)와 **같은 값**이어야 한다 —
 *    두 벌이면 사람이 손으로 깐 것과 배포가 깐 것이 달라진다.
 */
const RENDER_VARS = {
  npx: process.execPath.replace(/\/node$/, '/npx'),
  node: process.execPath,
  nodebin: dirname(process.execPath),
  repo: RUNTIME_ROOT,
  logdir: join(homedir(), 'Library', 'Logs', 'soransoran'),
}

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const TARGET = (argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? '').trim() || null

/**
 * 🔴 성공하면 출력, 실패하면 null. **판단에 쓰는 읽기 전용 명령**에만 쓴다.
 *
 * 🔴 stderr 를 삼킨다 — 실패는 `null` 로 돌려주고, **무엇이 잘못됐는지는 호출부가 말한다.**
 *    그러지 않으면 `git show` 의 `fatal: path ... does not exist` 가 화면에 섞여
 *    우리가 낸 "🔴 템플릿 없음" 옆에 같은 사실이 두 번 다른 말로 찍힌다.
 */
const read = (cmd: string, args: readonly string[], cwd = RUNTIME_ROOT): string | null => {
  try {
    return execFileSync(cmd, [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}
/** 🔴 side-effect 는 **성공 여부를 돌려준다**. null 로 삼키지 않는다 */
const act = (cmd: string, args: readonly string[], cwd = RUNTIME_ROOT): boolean => {
  try { execFileSync(cmd, [...args], { cwd, stdio: 'inherit' }); return true } catch { return false }
}
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

console.log(`\n══ runtime 배포 — ${APPLY ? '🔴 실제 적용' : 'dry-run (변경 0)'} ══\n`)
console.log(`  runtime  ${RUNTIME_ROOT}`)
if (!existsSync(RUNTIME_ROOT)) fail(`runtime worktree 가 없다 — ${RUNTIME_ROOT}`)

/**
 * 🔴 launchctl 이 **지금 물고 있는** 설정을 본다 — plist 파일이 아니라.
 *    실패도 그대로 돌려준다. exit code 와 stderr 가 있어야
 *    "확실히 내려가 있다" 와 "못 봤다" 를 가를 수 있다.
 */
const probePrint = (label: string): { exitCode: number | null; stdout: string; stderr: string } => {
  try {
    // 🔴 stderr 를 **잡아서** 판정에 넘긴다 — 흘리면 "Could not find service" 가
    //    우리가 낸 🟢 줄 옆에 섞여, 정상 상태가 사고처럼 읽힌다
    const out = execFileSync('launchctl', ['print', `gui/${UID}/${label}`], {
      cwd: homedir(), encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
    })
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
  /**
   * 🔴 **계획도 target 의 템플릿으로 찍는다.**
   *    지금 runtime 에 있는 파일로 찍으면 화면이 옛 인자를 보여주고,
   *    사람은 그것이 설치될 것이라고 읽는다 — 실제로 설치될 것과 다르다.
   */
  const planTarget = TARGET ?? originMainDry
  console.log(`\n  ── 설치될 job (🔴 정본은 **target commit 의** 템플릿이다)`)
  if (planTarget === null) {
    console.log('     🟡 target 을 모른다 — `--target=<full sha>` 를 주면 그 commit 의 계획을 찍는다')
  } else {
    console.log(`     기준 ${planTarget.slice(0, 7)}`)
    let missing = 0
    for (const l of partitionJobsByEnv({ jobs: JOBS, env: readRuntimeEnv() }).active) {
      const xml = renderFromTarget(planTarget, l)
      const args = xml === null ? [] : programArguments(xml)
      if (args.length === 0) missing += 1
      console.log(`     ${args.length === 0 ? '🔴 템플릿 없음' : '🟢'} ${l}`)
      if (args.length > 0) console.log(`        ${args.join(' ')}`)
    }
    if (missing > 0) {
      console.log(`\n     🔴 템플릿 없음 ${missing}건 — 이 target 으로는 배포가 render 에서 멈춘다`)
    }
  }
  console.log('\n  ── 퇴역될 job (unload + 설치본을 보관소로 이동)')
  for (const l of RETIRED_JOBS) {
    console.log(`     ${existsSync(join(AGENT_DIR, plistFileOf(l))) ? '🟡 설치본 있음' : '🟢 없음'} ${l}`)
  }
  /**
   * 🔴 **스위치를 함께 찍는다.** plist 가 올라가도 스위치가 닫혀 있으면 그 job 은
   *    아무것도 하지 않는다 — "등록은 됐는데 공급이 0" 이 그렇게 만들어진다.
   */
  console.log('\n  ── 활성화 스위치 (🔴 배포는 이것을 고치지 않는다)')
  {
    const env = readRuntimeEnv()
    const { active, disabled } = partitionJobsByEnv({ jobs: JOBS, env })
    // 🔴 스위치 요구는 **active job 에만** 건다 — 내려 둔 job 은 내려가 있는 것이 정상이다
    const blockers = judgeJobEnv({ jobs: active, env })
    const keys = [...new Set(active.map((l) => JOB_ENV_REQUIREMENTS[l]).filter((k): k is string => k !== undefined))]
    for (const k of keys) {
      const bad = blockers.find((b) => b.key === k)
      console.log(`     ${bad === undefined ? '🟢' : '🔴'} ${k}${bad === undefined ? '=true' : ` — ${bad.detail}`}`)
    }
    if (blockers.length > 0) {
      console.log(`\n     🔴 blocker ${blockers.length}건 — .env.local 을 사람이 켠 뒤 배포한다`)
    }
    /**
     * 🔴 **내려 둔 job 을 숨기지 않는다.** 화면에서 사라지면 "왜 3개만 도는가" 를
     *    다음 사람이 다시 조사하게 된다. 배포가 무엇을 하지 않는지 함께 적는다.
     */
    if (disabled.length > 0) {
      console.log('\n  ── 내려 둔 job (🔴 설치·load 하지 않는다 · 스위치도 launchctl 도 건드리지 않는다)')
      for (const l of disabled) {
        const st = stateOf(l)
        console.log(`     ${st === 'unloaded' ? '🟢' : st === 'loaded' ? '🔴 아직 loaded' : '🟡 관측 불가'} ${l}`
          + ` — ${JOB_ENV_REQUIREMENTS[l] ?? '(스위치 없음)'}=false`)
      }
    }
    // 🔴 퇴역 job 의 스위치는 blocker 가 아니다. 다만 남아 있으면 알려 준다
    const deadSwitch = 'SORAN_SUPPLY_AUTOPILOT_ENABLED'
    if (env[deadSwitch] !== undefined) {
      console.log(`     🟡 ${deadSwitch} 가 남아 있다 — 퇴역 job 의 스위치다. 배포 뒤 지워도 된다`)
    }
  }
  /**
   * 🔴 **잠시 멈출 job 을 함께 찍는다** — 관측만 한다(`launchctl print`). 내리지도 올리지도 않는다.
   *    설치되지 않은 job 은 배포 뒤에도 설치되지 않는다 — 그것을 화면에 그대로 적는다.
   */
  console.log('\n  ── 배포 동안만 잠시 멈출 job (🔴 idle 이면 내렸다 배포 전 상태 그대로 되올린다 · 돌고 있으면 배포하지 않는다)')
  for (const l of QUIESCE_JOBS) {
    const st = stateOf(l)
    const installed = existsSync(join(AGENT_DIR, plistFileOf(l)))
    const what = st === 'unknown' ? '🔴 관측 불가 — 배포가 멈춘다(fail-closed)'
      : st === 'loaded' ? '🟢 loaded — 내렸다 되올린다'
        : installed ? '🟡 설치본은 있는데 unloaded — 그대로 둔다' : '⚪ 미설치 — 건드리지 않는다 · 설치하지 않는다'
    console.log(`     ${what} ${l}`)
  }
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
 * 🔴 **target commit 에서 직접 읽는다.** 작업트리를 읽지 않는다.
 *
 *    배포 시점의 runtime 은 아직 **옛 SHA 에 checkout 되어 있다**.
 *    거기서 템플릿을 읽으면 첫 cutover 가 구조적으로 불가능하다 —
 *    실측(runtime 7049ddc): 새 job 2개 템플릿 없음, 네이버는
 *    `micro-seed-collect-navercafe.mts --pages=1 --max=10`.
 *    **설치할 것은 target 의 템플릿이지 지금 거기 있는 파일이 아니다.**
 *
 * 🔴 `git show <target>:<path>` 는 checkout 하지 않고 그 commit 의 blob 만 꺼낸다 —
 *    job 을 내리기 전에 불러도 작업트리를 바꾸지 않는다.
 */
function renderFromTarget(target: string, label: string): string | null {
  const raw = read('git', ['show', `${target}:${templatePathOf(label)}`])
  if (raw === null || raw.trim() === '') return null
  const out = render(raw, RENDER_VARS)
  // 🔴 치환이 하나라도 남으면 쓰지 않는다 — launchd 는 `__REPO__` 를 경로로 알고 그대로 죽는다
  return leftoverPlaceholders(out).length === 0 ? out : null
}

/**
 * 🔴 runtime 의 `.env.local` — **읽기만 한다.** 배포는 스위치를 켜지 않는다.
 *    코드가 켜면 "사람이 내려 둔 것" 과 "아직 안 켠 것" 을 구분할 수 없다.
 */
function readRuntimeEnv(): Record<string, string> {
  return readEnvFile(RUNTIME_ROOT)
}

const fx: DeployEffects = {
  fetch: () => act('git', ['fetch', 'origin', 'main']),
  currentSha: () => read('git', ['rev-parse', 'HEAD']),
  originMain: () => read('git', ['rev-parse', 'origin/main']),
  isAncestor: (sha) => read('git', ['merge-base', '--is-ancestor', sha, 'origin/main']) !== null,
  dirty: () => { const d = read('git', ['status', '--porcelain', '--untracked-files=no']); return d === null ? null : d !== '' },
  runningJobs: () => {
    const running: string[] = []
    const unknown: string[] = []
    // 🔴 퇴역 job 도 본다 — 돌고 있는 옛 job 위로 배포하면 그 회차가 반쯤 잘린다
    // 🔴 잠시 멈출 job 도 본다 — 돌고 있는 발행·감사 회차 위로 checkout 하면 그 회차가 반쯤 잘린다
    for (const l of [...JOBS, ...RETIRED_JOBS, ...QUIESCE_JOBS]) {
      const probe = probePrint(l)
      const { state } = judgeJobState(probe)
      // 🔴 못 본 job 을 "실행 중 아님" 으로 통과시키지 않는다
      if (state === 'unknown') { unknown.push(l); continue }
      if (state === 'loaded' && /state = running/.test(probe.stdout)) running.push(l)
    }
    return { running, unknown }
  },

  unload: (l) => act('launchctl', ['unload', plistOf(l)], homedir()),
  /**
   * 🔴 **label 기반 정지.** plist 파일이 없어도 내려간다 —
   *    rollback 이 파일을 건드리기 전에 이것으로 먼저 전부 내린다.
   */
  bootout: (l) => act('launchctl', ['bootout', `gui/${UID}/${l}`], homedir()),
  probeJob: (l) => stateOf(l),
  load: (l) => act('launchctl', ['load', plistOf(l)], homedir()),

  checkout: (sha) => act('git', ['checkout', '--detach', sha]),
  install: () => act('npm', ['ci']),
  generate: () => act('npx', ['prisma', 'generate']),

  offlineGate: (g) => {
    const a = g.split(' ')
    return act('npm', ['run', a[0]!, ...(a.length > 1 ? ['--', ...a.slice(1)] : [])])
  },

  envBlockers: (jobs) => judgeJobEnv({ jobs, env: readRuntimeEnv() }),

  // ── 🔴 plist cutover — **target commit 의** 템플릿을 실제 설치본으로 옮긴다 ──
  readInstalledPlist: (l) => readInstalled(AGENT_DIR, l),
  renderPlist: (target, l) => renderFromTarget(target, l),
  argsOf: (xml) => programArguments(xml),
  workingDirOf: (xml) => valueOf(xml, 'WorkingDirectory'),
  writePlist: (l, xml) => writeInstalled(AGENT_DIR, l, xml),
  removePlist: (l) => removeInstalled(AGENT_DIR, l),
  retirePlist: (l) => {
    try { mkdirSync(ROLLBACK_DIR, { recursive: true }) } catch { return false }
    return retireInstalled(AGENT_DIR, ROLLBACK_DIR, l)
  },
  unretirePlist: (l) => unretireInstalled(AGENT_DIR, ROLLBACK_DIR, l),
  lintPlist: (l) => act('plutil', ['-lint', join(AGENT_DIR, plistFileOf(l))], homedir()),
  /**
   * 🔴 실제 loaded 설정을 **정본 파서**로 뽑는다.
   *
   *    옛 판은 출력에서 soransoran 이 들어간 절대경로를 전부 모아 runtime 밑을 요구했다.
   *    그런데 정상 출력에는 plist(`~/Library/LaunchAgents/…`)와 로그(`~/Library/Logs/soransoran/…`)도
   *    들어 있다 — **정상 job 이 전부 실패했다**(실측). 판정은 judgeLoadedConfig 가 한다.
   */
  loadedConfig: (l) => parseLaunchctlPrint(probePrint(l).exitCode === 0 ? probePrint(l).stdout : null),
  isolationGate: () => act('npx', ['tsx', 'scripts/runtime-isolation-check.mts', '--require-runtime']),

  readManifest: () => (existsSync(MANIFEST_FILE) ? readFileSync(MANIFEST_FILE, 'utf-8') : null),
  readPin: () => { try { return readFileSync(PIN_FILE, 'utf-8').trim() } catch { return null } },
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

/**
 * 🔴 **내려 둔 job 은 배포 대상이 아니다.** 설치도 load 도 하지 않고,
 *    `runDeploy` 는 그것이 **아직 내려가 있는지만** 확인한다.
 */
const { active: ACTIVE_JOBS, disabled: DISABLED_JOBS } = partitionJobsByEnv({
  jobs: JOBS, env: readRuntimeEnv(),
})
if (DISABLED_JOBS.length > 0) {
  console.log(`\n  🟡 내려 둔 job ${DISABLED_JOBS.length}개는 건드리지 않는다 — ${DISABLED_JOBS.join(' · ')}`)
}
const result = await runDeploy({
  target: TARGET ?? '', jobs: ACTIVE_JOBS, retiredJobs: RETIRED_JOBS,
  disabledJobs: DISABLED_JOBS, quiesceJobs: QUIESCE_JOBS,
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
    ? '   ✅ 직전 상태로 되돌렸다 — SHA · plist 원문 · loaded 상태 전부'
    : '   🔴 되돌리지 못하고 남은 것:')
  for (const r of result.rollback.residual) console.error(`      · ${r}`)
}
console.error('')
process.exit(1)
