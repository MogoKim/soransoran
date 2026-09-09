/**
 * runtime 배포 판정 — 🔴 **순수 함수. git·launchctl·파일을 건드리지 않는다**
 *
 * 🔴 배포 명령을 사람이 매번 지어내면 순서를 빠뜨린다.
 *    무엇을 확인하고 어떤 순서로 바꿀지는 여기서 정하고, 도구는 그대로 따른다.
 */

import { judgeLoadedConfig, type JobState, type LoadedJobConfig } from './runtime-isolation'

/** 🔴 배포가 남기는 기록. 이것이 있어야 "언제 무엇을 올렸는가" 를 나중에 대조할 수 있다 */
export type RuntimeManifest = {
  sha: string
  /** ISO */
  deployedAt: string
  /** 어떤 게이트를 통과하고 올렸는가 */
  gates: readonly string[]
  /** 직전 SHA — 되돌릴 곳 */
  previousSha: string | null
}

export type DeployGate = { ok: true } | { ok: false; code: string; reason: string }

/**
 * 배포해도 되는가 — 🔴 **하나라도 어긋나면 시작하지 않는다.**
 *
 *    시작한 뒤 중간에 멈추면 예약 실행이 어중간한 상태로 남는다.
 *    그래서 되돌릴 수 없는 일(checkout·npm ci)을 하기 **전에** 전부 본다.
 */
export function judgeDeploy(input: {
  apply: boolean
  /** `--target=` 로 받은 값 */
  target: string | null
  /** 방금 fetch 한 origin/main 의 정확한 SHA */
  originMain: string | null
  /** target 이 origin/main 계보인가 */
  targetOnMain: boolean | null
  /** runtime 에 추적 파일 변경이 있는가 */
  runtimeDirty: boolean | null
  /** 지금 돌고 있는 예약 job 이 있는가 */
  jobsRunning: readonly string[]
}): DeployGate {
  if (!input.apply) return { ok: false, code: 'DRY_RUN', reason: 'dry-run — --apply 가 없다' }
  if (input.target === null || input.target.trim() === '') {
    return { ok: false, code: 'NO_TARGET', reason: '--target=<full SHA> 가 필요하다' }
  }
  // 🔴 축약 SHA 를 받지 않는다 — 사람이 붙여넣다 자른 것과 진짜를 구분할 수 없다
  if (!/^[0-9a-f]{40}$/.test(input.target)) {
    return { ok: false, code: 'SHORT_SHA', reason: '--target 은 40자리 전체 SHA 여야 한다 (축약 금지)' }
  }
  if (input.originMain === null) {
    return { ok: false, code: 'NO_ORIGIN', reason: 'origin/main 을 읽지 못했다 — fetch 부터 확인한다' }
  }
  if (input.target !== input.originMain) {
    return {
      ok: false, code: 'NOT_ORIGIN_MAIN',
      reason: `--target 이 방금 fetch 한 origin/main 과 다르다 (origin/main ${input.originMain.slice(0, 7)})`,
    }
  }
  if (input.targetOnMain !== true) {
    return { ok: false, code: 'NOT_ON_MAIN', reason: 'target 이 origin/main 계보가 아니다 — feature branch 는 배포하지 않는다' }
  }
  if (input.runtimeDirty !== false) {
    return {
      ok: false, code: 'RUNTIME_DIRTY',
      reason: input.runtimeDirty === null
        ? 'runtime 상태를 읽지 못했다(fail-closed)'
        : 'runtime 에 추적 파일 변경이 있다 — 먼저 사람이 확인한다',
    }
  }
  if (input.jobsRunning.length > 0) {
    return { ok: false, code: 'JOB_RUNNING', reason: `예약 job 이 돌고 있다 — ${input.jobsRunning.join(' · ')}` }
  }
  return { ok: true }
}

/** 🔴 배포 순서. 되돌릴 수 없는 일이 뒤에 오도록 정해 둔다 */
export const DEPLOY_STEPS: readonly string[] = [
  '① 배포 잠금을 잡는다 — 두 배포가 겹치면 어느 SHA 가 올라갔는지 알 수 없다',
  '② fetch 하고 preflight — 🔴 fetch 실패는 그 자리에서 멈춘다(오래된 ref 로 판단하지 않는다)',
  '③ 현재 SHA·manifest 를 보존한다 (되돌릴 곳)',
  '④ 예약 job 3개를 unload 하고 **하나씩 내려간 것을 확인**한다',
  '⑤ target SHA 로 checkout · npm ci · prisma generate',
  '⑥ **offline 게이트** — job 이 내려가 있어도 도는 것들만',
  '⑦ manifest·pin 을 준비하고 job 3개를 load 한 뒤 **하나씩 올라온 것을 확인**한다',
  '⑧ **실제 loaded 경로** 대조 → runtime:isolation-check --require-runtime',
  '⑨ 여기까지 통과해야 "배포 완료" 다',
  '🔴 어느 단계든 실패하면 ⑩ 로 간다',
  '⑩ rollback(best-effort): checkout · npm ci · prisma generate · manifest/pin 복원 · job 재load —'
  + ' 한 단계가 실패해도 **뒤 단계를 계속 시도**하고, 남은 것을 보고한다',
]

/**
 * 🔴 **job 이 내려가 있는 동안 돌리는 게이트.** 파일만 읽는 것들이다.
 *    `runtime:isolation-check --require-runtime` 은 **여기 넣지 않는다** —
 *    그 검사는 job 3개가 loaded 여야 통과하는데, 이 시점에는 우리가 내려 둔 상태다.
 *    (실측: 그 순서였던 첫 판은 정상 배포가 **구조적으로 실패**했다)
 */
export const OFFLINE_GATES: readonly string[] = [
  'supply:autopilot-check',
  'collect:guard-lock-check',
  'launchd:template-check',
]

/** 🔴 job 을 **다시 올린 뒤에만** 의미가 있는 검사 */
export const POST_LOAD_GATES: readonly string[] = [
  'runtime:isolation-check --require-runtime',
]

/** 예전 이름 — 화면 안내용으로 남긴다 */
export const DEPLOY_GATES: readonly string[] = [...OFFLINE_GATES, ...POST_LOAD_GATES]

/** 🔴 배포는 이것들을 **하지 않는다** */
export const DEPLOY_FORBIDDEN: readonly string[] = [
  'live crawl', 'DB write', '발행', 'release 단계 변경', 'GitHub Variables·cron 변경',
]


// ─────────────────────────────────────────────────────────
// 🔴 배포 오케스트레이션 — 실행 효과를 **주입**받는다
//
//    실제 git·launchctl·npm 을 붙들고 있으면 "실패했을 때 어떻게 되는가" 를
//    시험할 수 없다. 그래서 효과를 인터페이스로 빼고, fixture 가 가짜를 넣는다.
// ─────────────────────────────────────────────────────────

/**
 * 🔴 side-effect 는 **성공/실패를 돌려준다.** null 로 삼키지 않는다.
 *
 * 🔴 그리고 **명령의 반환값과 실제 상태는 다른 것**이다.
 *    `launchctl unload` 가 0 이 아닌 값으로 끝나도 job 은 내려가 있을 수 있고,
 *    0 으로 끝나도 안 내려가 있을 수 있다. 그래서 명령을 부른 뒤 **반드시 다시 관측**한다.
 */
export type DeployEffects = {
  /** 원격에서 최신 ref 를 가져온다. 실패하면 false */
  fetch: () => boolean
  currentSha: () => string | null
  originMain: () => string | null
  isAncestor: (sha: string) => boolean | null
  dirty: () => boolean | null
  /**
   * 지금 실행 중인 job. 🔴 **관측 실패를 "실행 중 0" 으로 통과시키지 않는다** —
   * 못 본 것은 `unknown` 으로 따로 돌려준다.
   */
  runningJobs: () => { running: string[]; unknown: string[] }

  unload: (label: string) => boolean
  /** 🔴 unload/load 뒤 **실제 상태**를 다시 본다 — loaded / unloaded / unknown */
  probeJob: (label: string) => JobState
  load: (label: string) => boolean

  checkout: (sha: string) => boolean
  install: () => boolean
  generate: () => boolean

  /** job 이 내려가 있어도 도는 게이트 */
  offlineGate: (name: string) => boolean
  /**
   * 🔴 `launchctl print` 원문에서 뽑은 **실제 loaded 설정**.
   *    판정은 `judgeLoadedConfig` 정본이 한다 — 여기서 따로 정규식을 쓰지 않는다.
   */
  loadedConfig: (label: string) => LoadedJobConfig
  /** runtime:isolation-check --require-runtime */
  isolationGate: () => boolean

  readManifest: () => string | null
  writeManifest: (json: string) => boolean
  removeManifest: () => boolean
  writePin: (sha: string) => boolean

  log: (m: string) => void
}

/** 🔴 실제 loaded 경로를 판정할 때 쓰는 기준 경로들 */
export type PathContract = { runtimeRoot: string; devRoots: readonly string[] }

export type DeployResult = {
  ok: boolean
  /** 어디까지 갔는가 */
  phase: string
  /** 실제로 실행된 단계 이름 — 🔴 fixture 가 **순서**를 본다 */
  steps: string[]
  problems: string[]
  rollback: null | { attempted: boolean; complete: boolean; residual: string[] }
}

/**
 * 🔴 배포 한 회차. **post-load 검증까지 통과해야 완료다.**
 *
 *    실패하면 어디서 실패했든 rollback 을 **끝까지 시도**한다 —
 *    한 명령이 죽었다고 job 을 내려둔 채 끝내지 않는다.
 */
export async function runDeploy(input: {
  target: string
  jobs: readonly string[]
  /** 🔴 실제 loaded 경로를 판정할 기준 — runtime 안이어야 하는 것은 program 과 WorkingDirectory 뿐이다 */
  paths: PathContract
  offlineGates?: readonly string[]
  now?: () => string
}, fx: DeployEffects): Promise<DeployResult> {
  const steps: string[] = []
  const problems: string[] = []
  const gates = input.offlineGates ?? OFFLINE_GATES
  const now = input.now ?? ((): string => new Date().toISOString())

  // ── ② preflight — 🔴 fetch 실패는 그 자리에서 멈춘다 ──
  steps.push('fetch')
  if (!fx.fetch()) {
    return {
      ok: false, phase: 'preflight', steps,
      problems: ['git fetch 실패 — 오래된 ref 로 배포 대상을 판단하지 않는다'],
      rollback: null,
    }
  }
  const prevSha = fx.currentSha()
  const running = fx.runningJobs()
  // 🔴 못 본 job 을 "실행 중 0" 으로 통과시키지 않는다 — 배포 중에 회차가 시작될 수 있다
  if (running.unknown.length > 0) {
    return {
      ok: false, phase: 'preflight', steps,
      problems: [`job 실행 여부를 확인하지 못했다(${running.unknown.join(' · ')}) — 통과시키지 않는다(fail-closed)`],
      rollback: null,
    }
  }
  const gate = judgeDeploy({
    apply: true, target: input.target, originMain: fx.originMain(),
    targetOnMain: input.target === '' ? null : fx.isAncestor(input.target),
    runtimeDirty: fx.dirty(), jobsRunning: running.running,
  })
  steps.push('preflight')
  if (!gate.ok) {
    return { ok: false, phase: 'preflight', steps, problems: [`[${gate.code}] ${gate.reason}`], rollback: null }
  }
  if (prevSha === null) {
    return { ok: false, phase: 'preflight', steps, problems: ['현재 SHA 를 읽지 못했다'], rollback: null }
  }

  // ── ③ 보존 ──
  const prevManifest = fx.readManifest()
  steps.push('save-previous')

  /**
   * 🔴 **멱등 load.** 이미 올라와 있으면 다시 부르지 않는다.
   *
   *    `launchctl load` 는 이미 loaded 인 job 에 대해 실패를 돌려준다("already loaded").
   *    반환값만 보고 복구 실패로 적으면, **실제로는 정상인 상태**를 고장이라고 보고하게 된다.
   *    그래서 먼저 관측하고, 내려가 있을 때만 올린다.
   */
  const ensureLoaded = (label: string): string | null => {
    const before = fx.probeJob(label)
    if (before === 'loaded') return null
    if (before === 'unknown') return `${label}: 상태를 확인하지 못했다 — 올라왔는지 알 수 없다(fail-closed)`
    steps.push(`load:${label}`)
    fx.load(label)
    // 🔴 반환값이 아니라 **다시 관측한 상태**로 판정한다
    const after = fx.probeJob(label)
    if (after === 'loaded') return null
    return after === 'unknown'
      ? `${label}: load 뒤 상태를 확인하지 못했다(fail-closed)`
      : `${label}: load 했는데 올라오지 않았다`
  }

  /**
   * 🔴 **복구 대상은 "성공했다고 적어 둔 목록" 이 아니라 지금의 실제 상태다.**
   *
   *    unload 가 false 를 돌려줬는데 실제로는 내려간 경우가 있다. 성공 목록만 되돌리면
   *    그 job 은 내려간 채로 남는다. 그래서 expected 3개를 **전부 다시 관측**한다.
   */
  const restoreAll = (): string[] => {
    steps.push('restore-observe')
    const residual: string[] = []
    for (const l of input.jobs) {
      const why = ensureLoaded(l)
      if (why !== null) residual.push(why)
    }
    // 🔴 마지막에 3개가 모두 loaded 인지 다시 본다
    steps.push('restore-verify')
    for (const l of input.jobs) {
      if (fx.probeJob(l) !== 'loaded') residual.push(`${l}: 최종 확인에서 loaded 가 아니다`)
    }
    return [...new Set(residual)]
  }

  // ── ⑩ rollback — best-effort. 🔴 한 단계 실패가 뒤 단계를 건너뛰지 않게 한다 ──
  const rollbackAll = (): { attempted: boolean; complete: boolean; residual: string[] } => {
    const residual: string[] = []
    steps.push('rollback:checkout')
    if (!fx.checkout(prevSha)) residual.push(`이전 SHA(${prevSha.slice(0, 7)}) checkout 실패`)
    steps.push('rollback:install')
    if (!fx.install()) residual.push('npm ci 실패 — 의존성이 target 것으로 남아 있을 수 있다')
    steps.push('rollback:generate')
    if (!fx.generate()) residual.push('prisma generate 실패')
    steps.push('rollback:manifest')
    if (prevManifest === null) {
      // 🔴 원래 없었으면 **새로 쓴 것을 지운다** — 성공하지 않았는데 기록이 남으면 안 된다
      if (!fx.removeManifest()) residual.push('새 manifest 제거 실패 — 배포되지 않았는데 기록이 남았다')
    } else if (!fx.writeManifest(prevManifest)) {
      residual.push('이전 manifest 복원 실패')
    }
    if (!fx.writePin(prevSha)) residual.push('pin 복원 실패')
    steps.push('rollback:load')
    residual.push(...restoreAll())
    // 🔴 사후 대조 — 정말 돌아왔는가
    if (fx.currentSha() !== prevSha) residual.push('사후 대조: SHA 가 이전 값이 아니다')
    return { attempted: true, complete: residual.length === 0, residual }
  }
  const failWith = (phase: string, why: string): DeployResult => {
    problems.push(why)
    const rb = rollbackAll()
    if (!rb.complete) problems.push(`🔴 복구가 완전하지 않다 — ${rb.residual.join(' / ')}`)
    return { ok: false, phase, steps, problems, rollback: rb }
  }

  // ── ④ unload + 하나씩 실제 상태 확인 ──
  for (const l of input.jobs) {
    steps.push(`unload:${l}`)
    const returned = fx.unload(l)
    const state = fx.probeJob(l)
    if (returned && state === 'unloaded') continue
    // 🔴 아직 checkout 도 안 했다 — **코드는 건드리지 않고** 실제 상태만 되돌린다
    const why = !returned
      ? `${l} unload 명령이 실패했다`
      : state === 'unknown'
        ? `${l} unload 뒤 상태를 확인하지 못했다(fail-closed)`
        : `${l} unload 했는데 아직 내려가지 않았다`
    const residual = restoreAll()
    return {
      ok: false, phase: 'unload', steps,
      problems: [`${why} — 코드는 건드리지 않았다`],
      rollback: { attempted: true, complete: residual.length === 0, residual },
    }
  }
  steps.push('unload-verified')

  // ── ⑤ checkout · 설치 ──
  steps.push('checkout')
  if (!fx.checkout(input.target)) return failWith('checkout', 'checkout 실패')
  steps.push('install')
  if (!fx.install()) return failWith('install', 'npm ci 실패')
  steps.push('generate')
  if (!fx.generate()) return failWith('generate', 'prisma generate 실패')

  // ── ⑥ offline 게이트 ──
  for (const g of gates) {
    steps.push(`gate:${g}`)
    if (!fx.offlineGate(g)) return failWith('offline-gate', `게이트 실패 — ${g}`)
  }

  // ── ⑦ manifest·pin 준비 후 load ──
  const manifest: RuntimeManifest = {
    sha: input.target, deployedAt: now(), gates: [...gates, ...POST_LOAD_GATES], previousSha: prevSha,
  }
  steps.push('write-manifest')
  if (!fx.writeManifest(JSON.stringify(manifest, null, 2))) return failWith('manifest', 'manifest 기록 실패')
  if (!fx.writePin(input.target)) return failWith('manifest', 'pin 기록 실패')

  for (const l of input.jobs) {
    const why = ensureLoaded(l)
    if (why !== null) return failWith('load', why)
  }
  steps.push('load-verified')

  // ── ⑧ 🔴 여기서야 격리 검사를 돌린다 (job 이 올라와 있어야 의미가 있다) ──
  //
  //    🔴 **runtime 아래여야 하는 것은 `.mts` program 과 WorkingDirectory 뿐이다.**
  //       `launchctl print` 정상 출력에는 plist 경로(`~/Library/LaunchAgents/…`)와
  //       로그 경로(`~/Library/Logs/soransoran/…`)도 들어 있다. 이름에 soransoran 이 있다고
  //       전부 runtime 밑을 요구하면 **정상 job 3개가 전부 실패한다**(실측).
  //       판정은 `judgeLoadedConfig` 정본 하나만 쓴다.
  steps.push('loaded-paths')
  for (const l of input.jobs) {
    const v = judgeLoadedConfig({
      label: l, loaded: fx.loadedConfig(l),
      runtimeRoot: input.paths.runtimeRoot, devRoots: input.paths.devRoots,
    })
    if (!v.ok) return failWith('post-load', `실제 loaded 설정이 계약과 다르다 — ${v.problems.join(' / ')}`)
  }
  steps.push('isolation-gate')
  if (!fx.isolationGate()) return failWith('post-load', 'runtime:isolation-check --require-runtime 실패')

  steps.push('done')
  fx.log(`배포 완료 — ${prevSha.slice(0, 7)} → ${input.target.slice(0, 7)}`)
  return { ok: true, phase: 'done', steps, problems: [], rollback: null }
}

/** 🔴 배포 잠금 — 두 배포가 겹치면 어느 SHA 가 올라갔는지 알 수 없다 */
export function judgeDeployLock(input: {
  /** 잠금 파일을 `wx` 로 만들었는가. 실패면 이미 누가 쥐고 있다 */
  acquired: boolean
  /** 잠금 상태를 읽지 못했는가 */
  unknown?: boolean
}): { ok: boolean; reason: string } {
  if (input.unknown === true) return { ok: false, reason: '배포 잠금 상태를 읽지 못했다 — 통과시키지 않는다(fail-closed)' }
  if (!input.acquired) return { ok: false, reason: '다른 배포가 진행 중이다 — 겹쳐 돌리지 않는다' }
  return { ok: true, reason: '' }
}

/**
 * 🔴 **남의 잠금을 지우지 않는다.**
 *
 *    옛 판은 프로세스가 끝날 때 잠금 파일을 무조건 `unlink` 했다. 그러면
 *    먼저 죽은 배포의 뒷정리가 **그 사이 새로 시작한 배포의 잠금**을 지운다 —
 *    잠금이 있으나 마나가 된다. 그래서 잠금에 token 을 적고,
 *    풀 때 파일에 적힌 token 이 내 것일 때만 지운다.
 *
 * 🔴 stale 잠금 자동 회수는 하지 않는다 — 기존 fail-closed 정책 그대로다.
 *    남은 잠금은 사람이 보고 지운다.
 */
export function judgeLockRelease(input: {
  /** 잠금 파일에서 읽은 token — 읽지 못했으면 null */
  fileToken: string | null
  /** 내가 쓴 token */
  myToken: string
}): { release: boolean; reason: string } {
  if (input.fileToken === null) {
    return { release: false, reason: '잠금 파일을 읽지 못했다 — 남의 잠금일 수 있어 지우지 않는다' }
  }
  if (input.fileToken !== input.myToken) {
    return { release: false, reason: '잠금이 다른 배포의 것이다 — 지우지 않는다' }
  }
  return { release: true, reason: '' }
}
