/**
 * runtime 배포 판정 — 🔴 **순수 함수. git·launchctl·파일을 건드리지 않는다**
 *
 * 🔴 배포 명령을 사람이 매번 지어내면 순서를 빠뜨린다.
 *    무엇을 확인하고 어떤 순서로 바꿀지는 여기서 정하고, 도구는 그대로 따른다.
 */

import { judgeLoadedConfig, type EnvBlocker, type JobState, type LoadedJobConfig } from './runtime-isolation'

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
  /**
   * 🔴 **켜져 있어야 하는데 꺼져 있는 스위치.** 비어 있어야 통과다.
   *    plist 가 올라가도 스위치가 닫혀 있으면 그 job 은 아무것도 하지 않는다 —
   *    "파일이 있다" 를 "일한다" 로 읽으면 며칠 뒤 공급이 0 인 걸 발견하게 된다.
   */
  envBlockers?: readonly EnvBlocker[]
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
  /**
   * 🔴 **스위치를 마지막에 본다** — 되돌릴 수 없는 일을 하기 전이면 어디든 좋지만,
   *    앞의 검사들이 "배포할 대상이 옳은가" 이고 이것은 "배포해 봐야 일하는가" 다.
   *    🔴 배포는 env 를 **고치지 않는다.** 무엇이 없는지 정확히 말하고 멈춘다.
   */
  const blockers = input.envBlockers ?? []
  if (blockers.length > 0) {
    return {
      ok: false, code: 'ENV_NOT_READY',
      reason: `활성화 스위치가 준비되지 않았다 — ${blockers.map((b) => b.detail).join(' / ')}`
        + '  🔴 배포가 env 를 고치지 않는다. .env.local 을 사람이 켠 뒤 다시 돌린다',
    }
  }
  return { ok: true }
}

/** 🔴 배포 순서. 되돌릴 수 없는 일이 뒤에 오도록 정해 둔다 */
export const DEPLOY_STEPS: readonly string[] = [
  '① 배포 잠금을 잡는다 — 두 배포가 겹치면 어느 SHA 가 올라갔는지 알 수 없다',
  '② fetch 하고 preflight — 🔴 fetch 실패는 그 자리에서 멈춘다(오래된 ref 로 판단하지 않는다)',
  '②-b **활성화 스위치 확인** — plist 가 올라가도 스위치가 닫혀 있으면 그 job 은 일하지 않는다',
  '③ 현재 SHA·manifest·**설치 plist 원문·loaded 상태**를 보존한다 (되돌릴 곳)',
  '④ 예약 job 5개 + 퇴역 job 을 unload 하고 **하나씩 내려간 것을 확인**한다',
  '⑤ target SHA 로 checkout · npm ci · prisma generate',
  '⑥ **offline 게이트** — job 이 내려가 있어도 도는 것들만',
  '⑦ 🔴 **target commit 의 템플릿을 render 해 설치 plist 로 쓴다** —'
  + ' 지금 runtime 에 있는 파일을 읽으면 **옛 인자를 그대로 다시 설치**한다',
  '⑧ plutil 로 설치본을 검증한다 — 문법이 깨진 plist 는 load 가 조용히 실패한다',
  '⑨ 퇴역 job 의 설치 plist 를 보관소로 옮긴다 (unload 만으로는 재부팅 때 되살아난다)',
  '⑩ manifest·pin 을 준비하고 job 5개를 load 한 뒤 **하나씩 올라온 것을 확인**한다',
  '⑪ **실제 loaded 경로 + ProgramArguments** 대조 → runtime:isolation-check --require-runtime',
  '⑫ 여기까지 통과해야 "배포 완료" 다',
  '🔴 어느 단계든 실패하면 ⑬ 으로 간다',
  '⑬ rollback(best-effort): checkout · npm ci · prisma generate · manifest/pin 복원 ·'
  + ' **plist 원문 복원** · **원래 loaded 였던 job 만 재load** —'
  + ' 한 단계가 실패해도 **뒤 단계를 계속 시도**하고, 남은 것을 보고한다',
]

/**
 * 🔴 **job 이 내려가 있는 동안 돌리는 게이트.** 파일만 읽는 것들이다.
 *    `runtime:isolation-check --require-runtime` 은 **여기 넣지 않는다** —
 *    그 검사는 예약 job 이 전부 loaded 여야 통과하는데, 이 시점에는 우리가 내려 둔 상태다.
 *    (실측: 그 순서였던 첫 판은 정상 배포가 **구조적으로 실패**했다)
 */
export const OFFLINE_GATES: readonly string[] = [
  'supply:process-check',
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
  /**
   * 🔴 예약 job 이 **일할 수 있는 상태인가** — runtime `.env.local` 을 읽어 판정한 결과.
   *    빈 배열이면 준비됐다는 뜻이다.
   */
  envBlockers: (jobs: readonly string[]) => readonly EnvBlocker[]

  unload: (label: string) => boolean
  /** 🔴 unload/load 뒤 **실제 상태**를 다시 본다 — loaded / unloaded / unknown */
  probeJob: (label: string) => JobState
  load: (label: string) => boolean

  checkout: (sha: string) => boolean
  install: () => boolean
  generate: () => boolean

  /** job 이 내려가 있어도 도는 게이트 */
  offlineGate: (name: string) => boolean

  // ── 🔴 plist cutover — 이것이 없으면 배포해도 **옛 인자가 그대로 돈다** ──
  /**
   * 설치된 plist 원문. 없으면 `null`.
   * 🔴 "없다"(null)와 "못 읽었다"는 다르다 — 읽기에 실패하면 던져서 배포를 멈춘다.
   */
  readInstalledPlist: (label: string) => string | null
  /**
   * 🔴 **`target` commit 의 템플릿을 render 한 설치본.** 없거나 치환이 남으면 `null`.
   *
   * 🔴 **`target` 을 인자로 받는 것이 이 계약의 전부다** (2026-09-11 재현).
   *    앞선 판은 `RUNTIME_ROOT` 의 **작업트리**에서 템플릿을 읽었다. 그 시점의 runtime 은
   *    아직 **옛 SHA 에 checkout 되어 있다** — 그래서 첫 cutover 가 구조적으로 불가능했다:
   *      · 네이버 2개 → 옛 템플릿을 render → **옛 인자를 그대로 다시 설치**
   *      · 새 job 2개 → 그 SHA 에 파일이 없음 → `render` 에서 중단
   *    실측(runtime 7049ddc): `supply-process` · `supply-collect-82cook-thin` 템플릿 없음,
   *    네이버는 `micro-seed-collect-navercafe.mts --pages=1 --max=10`.
   *
   *    **설치할 것은 target 의 템플릿이지 지금 거기 있는 파일이 아니다.**
   */
  renderPlist: (target: string, label: string) => string | null
  /** 설치 (원자적으로 쓰고 rename) */
  writePlist: (label: string, xml: string) => boolean
  /** 설치본 제거 — 원래 없던 job 을 되돌릴 때 쓴다 */
  removePlist: (label: string) => boolean
  /** 🔴 퇴역 job 의 설치본을 **보관소로 옮긴다.** 지우지 않는다 — 되돌릴 수 있어야 한다 */
  retirePlist: (label: string) => boolean
  /** `plutil -lint` — 문법이 깨진 plist 는 load 가 조용히 실패한다 */
  lintPlist: (label: string) => boolean
  /**
   * plist 원문에서 ProgramArguments 를 뽑는다 — 🔴 **파싱만** 한다. 파일을 읽지 않는다.
   *
   * 🔴 그래서 기대 인자는 **방금 render 한 그 문자열**에서 나온다.
   *    템플릿을 두 번 읽으면 두 번째가 다른 SHA 를 볼 수 있다 — 설치한 것과
   *    대조하는 것이 갈라지는 자리다. 입력을 하나로 묶어 그 틈을 없앤다.
   */
  argsOf: (xml: string) => readonly string[]
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
 *
 * 🔴 **plist cutover 가 이 안에 있다** (2026-09-11).
 *    앞선 판은 설치 plist 를 `unload` 하고 그대로 다시 `load` 했다. 그래서 저장소의
 *    새 템플릿이 설치본에 닿지 못했고, 배포를 몇 번 해도 네이버 job 은 옛 인자로 돌았다.
 *    창업자에게 `sed`·`plutil`·`launchctl` 을 손으로 치게 하는 절차만 문서에 남았다.
 *    **배포가 그 책임을 진다.**
 */
export async function runDeploy(input: {
  target: string
  /** 🔴 배포 후 올라와 있어야 하는 job — 정본은 `RUNTIME_JOBS` 다 */
  jobs: readonly string[]
  /** 🔴 내려가 있어야 하고 설치본도 없어야 하는 옛 job */
  retiredJobs?: readonly string[]
  /** 🔴 실제 loaded 경로를 판정할 기준 — runtime 안이어야 하는 것은 program 과 WorkingDirectory 뿐이다 */
  paths: PathContract
  offlineGates?: readonly string[]
  now?: () => string
}, fx: DeployEffects): Promise<DeployResult> {
  const steps: string[] = []
  const problems: string[] = []
  const gates = input.offlineGates ?? OFFLINE_GATES
  const now = input.now ?? ((): string => new Date().toISOString())
  const retired = input.retiredJobs ?? []
  /** unload 대상 — 🔴 퇴역 job 도 내린다. 남겨 두면 같은 원천을 두 번 연다 */
  const allJobs = [...input.jobs, ...retired]

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
    // 🔴 **job 을 내리기 전에** 본다 — 여기서 막으면 되돌릴 것이 없다
    envBlockers: fx.envBlockers(input.jobs),
  })
  steps.push('preflight')
  if (!gate.ok) {
    return { ok: false, phase: 'preflight', steps, problems: [`[${gate.code}] ${gate.reason}`], rollback: null }
  }
  if (prevSha === null) {
    return { ok: false, phase: 'preflight', steps, problems: ['현재 SHA 를 읽지 못했다'], rollback: null }
  }

  /**
   * 🔴 **render 를 unload 보다 먼저 한다.** 템플릿이 없거나 치환이 남아 있으면
   *    job 을 내리기 전에 멈춘다 — 내려놓고 나서야 "설치할 것이 없다" 를 알면
   *    되돌리는 일이 늘어난다.
   */
  steps.push('render')
  const rendered = new Map<string, string>()
  for (const l of input.jobs) {
    // 🔴 **target commit 에서** 읽는다. 지금 runtime 에 무엇이 checkout 돼 있든 상관없다
    const xml = fx.renderPlist(input.target, l)
    if (xml === null || xml.trim() === '') {
      return {
        ok: false, phase: 'render', steps,
        problems: [
          `${l}: target ${input.target.slice(0, 7)} 의 템플릿을 render 하지 못했다`
          + ' — 설치할 plist 가 없다 (job 은 건드리지 않았다)',
        ],
        rollback: null,
      }
    }
    rendered.set(l, xml)
  }

  // ── ③ 보존 — 🔴 SHA·manifest 만으로는 되돌릴 수 없다. plist 원문과 loaded 상태까지 ──
  const prevManifest = fx.readManifest()
  const prevPlists = new Map<string, string | null>()
  const prevLoaded = new Map<string, JobState>()
  for (const l of allJobs) {
    prevPlists.set(l, fx.readInstalledPlist(l))
    prevLoaded.set(l, fx.probeJob(l))
  }
  steps.push('save-previous')
  // 🔴 되돌릴 곳을 모르면 시작하지 않는다 — 상태를 못 본 job 이 하나라도 있으면 멈춘다
  const unseen = [...prevLoaded.entries()].filter(([, st]) => st === 'unknown').map(([l]) => l)
  if (unseen.length > 0) {
    return {
      ok: false, phase: 'save-previous', steps,
      problems: [`배포 전 상태를 확인하지 못한 job 이 있다(${unseen.join(' · ')}) — 되돌릴 곳을 모른 채 시작하지 않는다`],
      rollback: null,
    }
  }

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
   * 🔴 **복구 대상은 "성공했다고 적어 둔 목록" 이 아니라 배포 전의 실제 상태다.**
   *
   *    unload 가 false 를 돌려줬는데 실제로는 내려간 경우가 있다. 성공 목록만 되돌리면
   *    그 job 은 내려간 채로 남는다. 그래서 **배포 전에 관측해 둔 `prevLoaded`** 로 되돌린다.
   *    🔴 원래 내려가 있던 job(퇴역 대상 등)을 "복구" 한다며 올리지 않는다.
   */
  const restoreAll = (): string[] => {
    steps.push('restore-observe')
    const residual: string[] = []
    for (const l of allJobs) {
      const want = prevLoaded.get(l)
      if (want === 'loaded') {
        const why = ensureLoaded(l)
        if (why !== null) residual.push(why)
        continue
      }
      /**
       * 🔴 **원래 내려가 있던 job 은 다시 내린다.**
       *    배포 도중에 우리가 올린 job(첫 설치 대상 등)을 그대로 두면,
       *    배포는 실패했는데 **새 job 만 돌고 있는** 어중간한 상태가 남는다.
       */
      if (fx.probeJob(l) !== 'loaded') continue
      steps.push(`restore-unload:${l}`)
      fx.unload(l)
      if (fx.probeJob(l) === 'loaded') residual.push(`${l}: 배포 중 올린 job 을 다시 내리지 못했다`)
    }
    steps.push('restore-verify')
    for (const l of allJobs) {
      const want = prevLoaded.get(l)
      const nowState = fx.probeJob(l)
      if (want === 'loaded' && nowState !== 'loaded') {
        residual.push(`${l}: 최종 확인에서 loaded 가 아니다`)
      }
      if (want !== 'loaded' && nowState === 'loaded') {
        residual.push(`${l}: 최종 확인에서 배포 전과 달리 loaded 다`)
      }
    }
    return [...new Set(residual)]
  }

  /** 🔴 plist 를 **배포 전 원문 그대로** 되돌린다. 원래 없던 것은 지운다 */
  const restorePlists = (): string[] => {
    steps.push('rollback:plist')
    const residual: string[] = []
    for (const l of allJobs) {
      const before = prevPlists.get(l) ?? null
      if (before === null) {
        // 🔴 원래 없었다 — 새로 설치한 것을 지운다. 배포되지 않았는데 파일이 남으면 안 된다
        if (!fx.removePlist(l)) residual.push(`${l}: 새로 설치한 plist 제거 실패`)
        continue
      }
      if (!fx.writePlist(l, before)) residual.push(`${l}: 이전 plist 복원 실패`)
    }
    return residual
  }

  // ── ⑬ rollback — best-effort. 🔴 한 단계 실패가 뒤 단계를 건너뛰지 않게 한다 ──
  const rollbackAll = (): { attempted: boolean; complete: boolean; residual: string[] } => {
    const residual: string[] = []
    steps.push('rollback:checkout')
    if (!fx.checkout(prevSha)) residual.push(`이전 SHA(${prevSha.slice(0, 7)}) checkout 실패`)
    steps.push('rollback:install')
    if (!fx.install()) residual.push('npm ci 실패 — 의존성이 target 것으로 남아 있을 수 있다')
    steps.push('rollback:generate')
    if (!fx.generate()) residual.push('prisma generate 실패')
    // 🔴 plist 를 먼저 되돌린 뒤에 load 한다 — 순서가 바뀌면 새 plist 로 올라간다
    residual.push(...restorePlists())
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
    return { attempted: true, complete: residual.length === 0, residual: [...new Set(residual)] }
  }
  const failWith = (phase: string, why: string): DeployResult => {
    problems.push(why)
    const rb = rollbackAll()
    if (!rb.complete) problems.push(`🔴 복구가 완전하지 않다 — ${rb.residual.join(' / ')}`)
    return { ok: false, phase, steps, problems, rollback: rb }
  }

  // ── ④ unload + 하나씩 실제 상태 확인 ──
  for (const l of allJobs) {
    // 🔴 원래 내려가 있던 job 은 내릴 것이 없다 (퇴역 job 이 대개 그렇다)
    if (prevLoaded.get(l) !== 'loaded') continue
    steps.push(`unload:${l}`)
    const returned = fx.unload(l)
    const state = fx.probeJob(l)
    if (returned && state === 'unloaded') continue
    // 🔴 아직 checkout 도 plist 설치도 안 했다 — **코드·파일은 건드리지 않고** 상태만 되돌린다
    const why = !returned
      ? `${l} unload 명령이 실패했다`
      : state === 'unknown'
        ? `${l} unload 뒤 상태를 확인하지 못했다(fail-closed)`
        : `${l} unload 했는데 아직 내려가지 않았다`
    const residual = restoreAll()
    return {
      ok: false, phase: 'unload', steps,
      problems: [`${why} — 코드도 plist 도 건드리지 않았다`],
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

  /**
   * ── ⑦ 🔴 **plist cutover.** 여기가 없으면 배포해도 옛 인자가 그대로 돈다 ──
   *
   *    🔴 render 는 ②에서 이미 끝냈다(target checkout **전**의 저장소로 읽었다).
   *       그래서 여기서는 쓰기만 한다 — 쓰는 도중 실패해도 무엇을 쓰려 했는지 안다.
   */
  for (const l of input.jobs) {
    steps.push(`plist:${l}`)
    if (!fx.writePlist(l, rendered.get(l)!)) return failWith('plist-install', `${l}: plist 설치 실패`)
    steps.push(`lint:${l}`)
    // 🔴 문법이 깨진 plist 는 load 가 조용히 실패한다 — 쓰자마자 본다
    if (!fx.lintPlist(l)) return failWith('plist-lint', `${l}: plutil 검증 실패 — 설치본 문법이 깨졌다`)
  }
  steps.push('plist-installed')

  // ── ⑨ 퇴역 — 🔴 unload 만으로는 로그인·재부팅 때 되살아난다 ──
  for (const l of retired) {
    if (prevPlists.get(l) === null) continue
    steps.push(`retire:${l}`)
    if (!fx.retirePlist(l)) return failWith('retire', `${l}: 퇴역 plist 를 보관소로 옮기지 못했다`)
  }
  steps.push('retire-verified')

  // ── ⑩ manifest·pin 준비 후 load ──
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

  // ── ⑪ 🔴 여기서야 격리 검사를 돌린다 (job 이 올라와 있어야 의미가 있다) ──
  //
  //    🔴 **runtime 아래여야 하는 것은 `.mts` program 과 WorkingDirectory 뿐이다.**
  //       `launchctl print` 정상 출력에는 plist 경로와 로그 경로도 들어 있다.
  //    🔴 **그리고 ProgramArguments 를 값으로 대조한다.** 경로만 보면 runtime 밑의
  //       **옛 수집기를 옛 인자로** 돌리는 job 이 그대로 통과한다(실측).
  steps.push('loaded-paths')
  for (const l of input.jobs) {
    const v = judgeLoadedConfig({
      label: l, loaded: fx.loadedConfig(l),
      runtimeRoot: input.paths.runtimeRoot, devRoots: input.paths.devRoots,
      // 🔴 **방금 설치한 바로 그 문자열**에서 뽑는다 — 다시 읽지 않는다
      expectedArgs: fx.argsOf(rendered.get(l)!),
    })
    if (!v.ok) return failWith('post-load', `실제 loaded 설정이 계약과 다르다 — ${v.problems.join(' / ')}`)
  }
  // 🔴 퇴역 job 이 아직 올라와 있으면 실패다 — 같은 원천을 두 번 연다
  for (const l of retired) {
    if (fx.probeJob(l) === 'loaded') return failWith('post-load', `퇴역 job 이 아직 loaded 다 — ${l}`)
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
