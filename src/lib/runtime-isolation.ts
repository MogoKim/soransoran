/**
 * 예약 실행 격리 판정 — 🔴 **순수 함수. 파일·launchctl·네트워크를 건드리지 않는다**
 *
 * 🔴 **왜 필요한가** (2026-09-09 실측).
 *
 *    launchd plist 의 `ProgramArguments` 가 개발 작업트리
 *    `/Users/yanadoo/Documents/soransoran-m0/scripts/*.mts` 를 직접 가리키고 있었다.
 *    그 경로는 `origin/main` 이 아니라 **그 순간 checkout 된 파일**이다 —
 *    개발자가 feature branch 로 바꿔 두면 **밤 예약 회차가 그 브랜치 코드로 돈다.**
 *    실제로 Wave B 작업 중 그런 상태로 21:10 회차를 맞을 뻔했다.
 *
 *    그래서 예약 실행을 **main 에 고정된 전용 runtime worktree** 로 분리하고,
 *    분리가 유지되는지를 이 판정부가 지킨다.
 *
 * 🔴 판정만 한다. 실제 관측(plist 읽기 · launchctl · git)은 부르는 쪽이 해서 넘긴다 —
 *    그래야 CI 가 fixture 로 이 규칙을 시험할 수 있다.
 */

/** 🔴 예약 실행이 반드시 지나야 하는 job 세 개 */
export const RUNTIME_JOBS: readonly string[] = [
  'com.soransoran.navercafe-collect-remonterrace-multi',
  'com.soransoran.navercafe-collect-wgang-multi',
  'com.soransoran.supply-autopilot',
]

/**
 * 🔴 **더는 loaded 되어 있으면 안 되는 옛 job.** Wave B 에서 다회로 바꾼 1회판이다.
 *    old/new 가 같이 올라와 있으면 같은 source 를 두 배로 두드린다.
 */
export const RETIRED_JOBS: readonly string[] = [
  'com.soransoran.navercafe-collect-remonterrace',
  'com.soransoran.navercafe-collect-wgang',
]

export type PathVerdict = { ok: boolean; problems: string[] }

/**
 * job 하나의 실행 경로가 runtime 안인가.
 *
 * 🔴 `startsWith` 하나로 끝내지 않는다 — `/a/runtime` 과 `/a/runtime-dev` 를 구분하려면
 *    경계까지 봐야 한다. 그리고 **개발 경로를 명시적으로도** 막는다(둘 다 틀리면 이유가 둘 다 나온다).
 */
export function judgeJobPath(input: {
  label: string
  /** plist 가 실행하는 스크립트 절대경로 */
  programPath: string | null
  /** plist 의 WorkingDirectory */
  workingDirectory: string | null
  runtimeRoot: string
  /** 개발 작업트리들 — 하나라도 안에 있으면 실패다 */
  devRoots: readonly string[]
}): PathVerdict {
  const problems: string[] = []
  const under = (p: string, root: string): boolean => p === root || p.startsWith(`${root}/`)

  if (input.programPath === null || input.programPath.trim() === '') {
    problems.push(`${input.label}: 실행 스크립트 경로를 읽지 못했다`)
  } else {
    if (!under(input.programPath, input.runtimeRoot)) {
      problems.push(`${input.label}: 실행 경로가 runtime 밖이다 — ${input.programPath}`)
    }
    for (const dev of input.devRoots) {
      if (under(input.programPath, dev)) {
        problems.push(`${input.label}: 🔴 **개발 작업트리를 실행한다** — ${input.programPath}`)
      }
    }
  }
  if (input.workingDirectory === null || input.workingDirectory.trim() === '') {
    problems.push(`${input.label}: WorkingDirectory 가 없다 — .env.local · .microseed-data 를 못 찾는다`)
  } else if (!under(input.workingDirectory, input.runtimeRoot)) {
    problems.push(`${input.label}: WorkingDirectory 가 runtime 밖이다 — ${input.workingDirectory}`)
  }
  return { ok: problems.length === 0, problems }
}

export type ShaVerdict = { ok: boolean; problems: string[] }

/**
 * runtime worktree 가 **main 에 고정**돼 있는가.
 *
 * 🔴 세 가지를 함께 본다.
 *    ① `detached` — 브랜치를 물고 있으면 누군가 그 브랜치를 옮기는 순간 실행 코드가 바뀐다
 *    ② `head === pinned` — 운영이 검증한 그 SHA 그대로인가
 *    ③ `ancestorOfMain` — 그 SHA 가 **정말 main 계보**인가.
 *       feature branch 의 커밋을 detached 로 걸어 두면 ①②는 통과하지만 main 이 아니다.
 */
export function judgeRuntimeSha(input: {
  head: string | null
  pinned: string | null
  detached: boolean
  /** head 가 origin/main 의 조상인가 — 부르는 쪽이 `git merge-base --is-ancestor` 로 실측 */
  ancestorOfMain: boolean | null
}): ShaVerdict {
  const problems: string[] = []
  if (input.head === null || input.head.trim() === '') {
    problems.push('runtime HEAD 를 읽지 못했다')
    return { ok: false, problems }
  }
  if (!input.detached) {
    problems.push('runtime 이 브랜치를 물고 있다 — 브랜치가 움직이면 예약 실행 코드가 같이 움직인다')
  }
  if (input.pinned === null || input.pinned.trim() === '') {
    problems.push('고정 SHA 기록이 없다 — 무엇을 돌리기로 했는지 알 수 없다')
  } else if (input.head !== input.pinned) {
    problems.push(`runtime HEAD 가 고정 SHA 와 다르다 — head ${input.head.slice(0, 7)} · 고정 ${input.pinned.slice(0, 7)}`)
  }
  if (input.ancestorOfMain === null) {
    problems.push('main 계보인지 확인하지 못했다 — 확인 못 하면 통과시키지 않는다')
  } else if (!input.ancestorOfMain) {
    problems.push('🔴 runtime SHA 가 origin/main 계보가 아니다 — feature branch 코드를 예약 실행하고 있다')
  }
  return { ok: problems.length === 0, problems }
}

export type JobsVerdict = { ok: boolean; problems: string[] }

/**
 * loaded 된 job 목록이 계약과 같은가.
 *
 * 🔴 **없는 것보다 더 있는 것이 위험하다** — 옛 1회판이 같이 올라와 있으면
 *    같은 카페를 하루 5번 두드린다(4회 + 1회). 그래서 잔여 job 을 먼저 본다.
 */
export function judgeLoadedJobs(input: {
  loaded: readonly string[]
  expected?: readonly string[]
  retired?: readonly string[]
}): JobsVerdict {
  const expected = input.expected ?? RUNTIME_JOBS
  const retired = input.retired ?? RETIRED_JOBS
  const problems: string[] = []
  const loaded = [...input.loaded]

  for (const r of retired) {
    if (loaded.includes(r)) problems.push(`🔴 옛 job 이 아직 loaded 다 — ${r} (같은 source 를 두 배로 두드린다)`)
  }
  for (const e of expected) {
    if (!loaded.includes(e)) problems.push(`예약 job 이 loaded 가 아니다 — ${e}`)
  }
  // 🔴 같은 Label 이 두 번 잡히는 일은 없어야 한다
  const dupes = [...new Set(loaded.filter((l, i) => loaded.indexOf(l) !== i))]
  for (const d of dupes) problems.push(`🔴 같은 job 이 중복 loaded 다 — ${d}`)
  return { ok: problems.length === 0, problems }
}

export type RuntimeReadiness = { ok: boolean; problems: string[] }

/**
 * runtime 이 **혼자서도 돌 수 있는가.**
 *
 * 🔴 재부팅 뒤에도 돌아야 한다. 그래서 "지금 있는가" 가 아니라
 *    **그 자리에 계속 있을 것들**(자체 node_modules · Prisma client · env · 데이터 정본)을 본다.
 * 🔴 env 는 **평문 복제가 아니라 링크**여야 한다 — 비밀을 두 곳에 두지 않는다.
 */
export function judgeRuntimeSetup(input: {
  hasNodeModules: boolean
  hasPrismaClient: boolean
  hasEnvLocal: boolean
  envIsLink: boolean
  hasDataDir: boolean
  dataIsLink: boolean
  /** 개발 작업트리와 **같은 실체**를 가리키는가 — 원장이 하나여야 한다 */
  dataSharedWithDev: boolean
}): RuntimeReadiness {
  const problems: string[] = []
  if (!input.hasNodeModules) problems.push('runtime 에 node_modules 가 없다 — 예약 실행이 뜨지 못한다')
  if (!input.hasPrismaClient) problems.push('runtime 에 Prisma client 가 없다 — DB 를 쓰는 단계가 죽는다')
  if (!input.hasEnvLocal) problems.push('runtime 에 .env.local 이 없다 — kill switch·세션·DB 설정을 못 읽는다')
  if (input.hasEnvLocal && !input.envIsLink) {
    problems.push('🔴 .env.local 이 링크가 아니다 — 비밀을 평문으로 두 곳에 두지 않는다')
  }
  if (!input.hasDataDir) problems.push('runtime 에 .microseed-data 가 없다')
  if (input.hasDataDir && !input.dataIsLink) {
    problems.push('🔴 .microseed-data 가 링크가 아니다 — 원장이 갈라진다')
  }
  if (!input.dataSharedWithDev) {
    problems.push('🔴 데이터 정본이 개발 작업트리와 다르다 — 보호장치 예산이 둘로 갈라져 같은 source 를 두 배로 두드린다')
  }
  return { ok: problems.length === 0, problems }
}

// ─────────────────────────────────────────────────────────
// 🔴 실제 loaded 설정 대조 (P0-4)
//
//    설치 plist 만 읽으면 **파일은 고쳤는데 load 를 안 한 상태**를 통과시킨다.
//    launchd 는 load 시점의 설정을 들고 있으므로, 파일과 loaded 를 **둘 다** 본다.
// ─────────────────────────────────────────────────────────

/** `launchctl print` 에서 뽑아낸 **실제 loaded** 설정 */
export type LoadedJobConfig = {
  /** 관측 자체에 실패했는가 — 🔴 실패를 "정상" 으로 삼키지 않는다 */
  readable: boolean
  /** arguments 중 `.mts` 로 끝나는 것 */
  programPath: string | null
  workingDirectory: string | null
}

/**
 * 설치 plist 와 **실제 loaded** 가 둘 다 runtime 인가.
 *
 * 🔴 관측 실패는 통과가 아니다 — `--require-runtime` 경로에서는 그대로 실패다.
 */
export function judgeLoadedConfig(input: {
  label: string
  loaded: LoadedJobConfig
  runtimeRoot: string
  devRoots: readonly string[]
}): PathVerdict {
  if (!input.loaded.readable) {
    return { ok: false, problems: [`${input.label}: launchctl 실제 설정을 읽지 못했다 — 통과시키지 않는다(fail-closed)`] }
  }
  const v = judgeJobPath({
    label: `${input.label}(loaded)`,
    programPath: input.loaded.programPath,
    workingDirectory: input.loaded.workingDirectory,
    runtimeRoot: input.runtimeRoot,
    devRoots: input.devRoots,
  })
  return v
}

/** `launchctl print` 원문에서 실제 설정을 뽑는다 — 🔴 순수 함수. 명령은 부르는 쪽이 돌린다 */
export function parseLaunchctlPrint(out: string | null): LoadedJobConfig {
  if (out === null || out.trim() === '') return { readable: false, programPath: null, workingDirectory: null }
  const argsBlock = /arguments = \{([\s\S]*?)\n\t\}/.exec(out)
  const args = argsBlock === null ? [] : argsBlock[1]!.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const wd = /working directory = (.+)/.exec(out)
  return {
    readable: true,
    programPath: args.find((a) => a.endsWith('.mts')) ?? null,
    workingDirectory: wd === null ? null : wd[1]!.trim(),
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 launchctl 상태는 **세 가지**다 (loaded / unloaded / unknown)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **"확실히 내려가 있다" 와 "못 봤다" 는 다르다.**
 *
 *    옛 판은 `launchctl print` 가 실패하면 곧바로 `isLoaded=false` 로 읽었다.
 *    그래서 권한 오류·도메인 오류·명령 자체 실패가 전부 "내려가 있다" 가 되었고,
 *    배포는 **아무것도 확인하지 못한 채** 다음 단계로 갔다.
 */
export type JobState = 'loaded' | 'unloaded' | 'unknown'

/** `launchctl print` 를 한 번 돌린 결과 그대로 */
export type LaunchctlProbe = {
  /** 명령을 아예 못 돌렸으면 null */
  exitCode: number | null
  stdout: string
  stderr: string
}

/**
 * 🔴 **`unloaded` 로 인정하는 근거는 하나뿐이다** — launchctl 이 그 이름의 서비스를
 *    도메인에서 **찾지 못했다고 말한 경우**.
 *
 *    실측(macOS 15.6 · gui/501):
 *      · 정상 job            exit 0
 *      · 없는 job            exit 113 · stderr `Could not find service "…" in domain for user gui: 501`
 *      · 접근 못 하는 도메인  exit 125 · stderr `Could not print domain: 125: Domain does not support specified action`
 *
 *    exit code 만으로 가르지 않는다 — 113 은 "Bad request" 계열의 넓은 코드라
 *    다른 이유로도 나올 수 있다. **찾지 못했다는 말**이 있을 때만 unloaded 다.
 *    나머지는 전부 `unknown` 이고, 배포의 모든 단계에서 fail-closed 로 다룬다.
 */
export function judgeJobState(probe: LaunchctlProbe): { state: JobState; reason: string } {
  if (probe.exitCode === 0) return { state: 'loaded', reason: '' }
  const said = `${probe.stderr}\n${probe.stdout}`
  if (probe.exitCode !== null && /Could not find service/.test(said)) {
    return { state: 'unloaded', reason: 'launchctl 이 그 이름의 서비스를 도메인에서 찾지 못했다' }
  }
  if (probe.exitCode === null) {
    return { state: 'unknown', reason: 'launchctl 을 돌리지 못했다' }
  }
  const first = said.split('\n').map((l) => l.trim()).filter((l) => l !== '')[0] ?? ''
  return { state: 'unknown', reason: `launchctl 이 exit ${probe.exitCode} 로 끝났다 — ${first}` }
}

// ─────────────────────────────────────────────────────────
// 🔴 runtime 이 손대지지 않았는가 (P1-1)
// ─────────────────────────────────────────────────────────

/**
 * runtime worktree 에 **추적 파일 변경**이 있으면 실패다.
 *
 * 🔴 `node_modules` · `.env.local` · `.microseed-data` 링크는 **비추적**이라 여기 안 잡힌다 —
 *    그래서 `--untracked-files=no` 로 본다. 정상 구성물과 손댐을 섞지 않기 위해서다.
 */
export function judgeRuntimeClean(input: { porcelain: string | null }): { ok: boolean; problems: string[] } {
  if (input.porcelain === null) {
    return { ok: false, problems: ['runtime 의 git 상태를 읽지 못했다 — 통과시키지 않는다(fail-closed)'] }
  }
  const lines = input.porcelain.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length === 0) return { ok: true, problems: [] }
  return {
    ok: false,
    problems: [`🔴 runtime 에 추적 파일 변경이 ${lines.length}건 있다 — 예약 실행 코드가 손대졌다: ${lines.slice(0, 3).join(' / ')}`],
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 비밀·상태 정본의 권한 (P1-3)
// ─────────────────────────────────────────────────────────

export type PathMode = {
  /** 심볼릭 링크를 따라간 **최종 실체**의 값이어야 한다 */
  exists: boolean
  /** 8진수 하위 3자리 (예: 0o600 → 384) */
  mode: number
  /** 소유자 uid */
  uid: number
}

/**
 * 정본 경로의 권한 — 🔴 **group·other 에 아무 권한도 없어야 한다.**
 *
 *    비밀이 644 면 같은 기계의 다른 계정이 읽는다. 상태가 755 면 남이 고칠 수 있고,
 *    보호장치 예산을 지우면 그날 요청 상한이 사라진다.
 * 🔴 값이나 해시를 로그에 찍지 않는다 — 여기서는 **권한만** 본다.
 */
export function judgeCanonicalMode(input: {
  label: string
  actual: PathMode
  /** 허용 최대 권한 (예: 파일 0o600 · 디렉터리 0o700) */
  maxMode: number
  currentUid: number
}): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (!input.actual.exists) {
    problems.push(`${input.label}: 정본이 없다`)
    return { ok: false, problems }
  }
  if (input.actual.uid !== input.currentUid) {
    problems.push(`${input.label}: 소유자가 지금 사용자와 다르다`)
  }
  // 🔴 group·other 비트가 하나라도 서 있으면 실패다
  if ((input.actual.mode & 0o077) !== 0) {
    problems.push(`${input.label}: group/other 권한이 열려 있다 (${(input.actual.mode & 0o777).toString(8)})`)
  }
  if ((input.actual.mode & 0o777) > input.maxMode) {
    problems.push(`${input.label}: 권한이 ${(input.actual.mode & 0o777).toString(8)} 다 — ${input.maxMode.toString(8)} 이하여야 한다`)
  }
  return { ok: problems.length === 0, problems }
}
