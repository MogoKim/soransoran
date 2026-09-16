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

/**
 * 🔴 **예약 실행이 반드시 지나야 하는 job 다섯 개** (2026-09-11).
 *
 *    수집 넷 + 처리 하나다. 82cook 은 **두 job 이 필요하다** —
 *    `raw-collect-82cook` 이 목록(`82cook.list.jsonl`)을 만들고,
 *    `supply-collect-82cook-thin` 이 그 목록을 소비해 얇은 상세를 연다.
 *    thin 은 목록을 스스로 만들지 않으므로 raw 가 없으면 **열 대상이 0** 이다.
 *
 *    🔴 앞선 판은 82cook 두 job 을 "선택 사항" 으로 두고 셋만 요구했다.
 *       그러면 82cook 이 등록되지 않은 채로도 격리 검사가 초록이고,
 *       공급은 네이버 둘로만 돈다 — 100/day 는 그 구성으로 나오지 않는다.
 *
 *    🔴 `raw-import`(Raw Vault 적재)는 여기 없다. 공급 레인이 아니라 보관 레인이다.
 */
export const RUNTIME_JOBS: readonly string[] = [
  'com.soransoran.navercafe-collect-remonterrace-multi',
  'com.soransoran.navercafe-collect-wgang-multi',
  'com.soransoran.raw-collect-82cook',
  'com.soransoran.supply-collect-82cook-thin',
  'com.soransoran.supply-process',
]

/**
 * 🔴 **job 이 실제로 일하려면 켜져 있어야 하는 스위치** (2026-09-11).
 *
 *    plist 를 설치하고 load 해도 **kill switch 가 닫혀 있으면 그 job 은 아무것도 하지 않는다.**
 *    파일이 있는지만 보고 "배포 완료" 라고 적으면, 며칠 뒤 "등록은 됐는데 공급이 0" 이 된다 —
 *    이 저장소가 이미 두 번 겪은 모양이다.
 *
 *    실측(2026-09-11 runtime `.env.local`):
 *      SORAN_NAVERCAFE_COLLECT_ENABLED=true · SORAN_82COOK_COLLECT_ENABLED=true
 *      SORAN_82COOK_THIN_DETAIL_ENABLED=true · **SORAN_SUPPLY_PROCESS_ENABLED=unset**
 *    → 처리 job 을 올려도 매 회차 재고만 읽고 끝난다. 배포 전에 막아야 한다.
 *
 * 🔴 **배포는 env 를 고치지 않는다.** 무엇이 없는지 정확히 말하고 멈춘다 —
 *    스위치를 코드가 켜면 "사람이 내려 둔 것" 과 "아직 안 켠 것" 을 구분할 수 없다.
 */
export const JOB_ENV_REQUIREMENTS: Readonly<Record<string, string>> = {
  'com.soransoran.navercafe-collect-remonterrace-multi': 'SORAN_NAVERCAFE_COLLECT_ENABLED',
  'com.soransoran.navercafe-collect-wgang-multi': 'SORAN_NAVERCAFE_COLLECT_ENABLED',
  'com.soransoran.raw-collect-82cook': 'SORAN_82COOK_COLLECT_ENABLED',
  'com.soransoran.supply-collect-82cook-thin': 'SORAN_82COOK_THIN_DETAIL_ENABLED',
  'com.soransoran.supply-process': 'SORAN_SUPPLY_PROCESS_ENABLED',
}

export type EnvBlocker = { job: string; key: string; detail: string }

/**
 * 🔴 **사람이 내려 둔 job 과 아직 안 켠 job 은 다르다** (2026-09-14 실측).
 *
 *    82cook 두 job 은 수집 중단 결정에 따라 `false` 로 내려 두고 unload 해 두었다.
 *    그런데 배포 preflight 는 `RUNTIME_JOBS` 다섯 개 **전부** `true` 를 요구했다 —
 *    그래서 정상 운영 상태인데 `ENV_NOT_READY` 로 **배포 자체가 막혔다.**
 *    82cook 을 다시 켜는 것 말고는 통과할 길이 없었다(그것은 결정을 뒤집는 일이다).
 *
 * 🔴 그래서 `false` **하나만** "의도적으로 내려 둔 것" 으로 읽는다.
 *    `unset` · 빈 값 · 오타는 전부 active 로 남긴다 — `judgeJobEnv` 가 그대로 막는다.
 *    "아직 안 켠 것" 을 조용히 disabled 로 넘기면 공급이 0 인 채로 초록이 된다.
 *
 * 🔴 이 함수는 **나누기만 한다.** 스위치를 켜지도, launchctl 을 내리지도 않는다.
 */
export type JobEnvPartition = {
  /** 스위치가 꺼져 있지 않은 job — 🔴 기존 배포 검증을 그대로 받는다 */
  active: string[]
  /** 🔴 `false` 로 내려 둔 job — 설치하지 않고, **unloaded 여야 정상**이다 */
  disabled: string[]
}

export function partitionJobsByEnv(input: {
  jobs: readonly string[]
  env: Readonly<Record<string, string | undefined>>
}): JobEnvPartition {
  const active: string[] = []
  const disabled: string[] = []
  for (const job of input.jobs) {
    const key = JOB_ENV_REQUIREMENTS[job]
    const raw = key === undefined ? undefined : input.env[key]
    if (raw !== undefined && raw.trim().toLowerCase() === 'false') disabled.push(job)
    else active.push(job)
  }
  return { active, disabled }
}

/**
 * 예약 job 이 **일할 수 있는 상태인가** — 🔴 `true` 하나만 통과다.
 *
 *    `unset` 과 `false` 를 구분해 적는다. 사람이 내려 둔 것(false)과
 *    아직 안 켠 것(unset)은 다음에 할 일이 다르다.
 */
export function judgeJobEnv(input: {
  jobs: readonly string[]
  /** runtime 의 `.env.local` 에서 읽은 값. 없는 키는 넣지 않는다 */
  env: Readonly<Record<string, string | undefined>>
}): EnvBlocker[] {
  const out: EnvBlocker[] = []
  const seen = new Set<string>()
  for (const job of input.jobs) {
    const key = JOB_ENV_REQUIREMENTS[job]
    if (key === undefined) continue
    // 🔴 같은 키를 두 job 이 쓰면 한 번만 적는다 — 같은 조치를 두 줄로 만들지 않는다
    if (seen.has(key)) continue
    const raw = input.env[key]
    if (raw === undefined) {
      seen.add(key)
      out.push({ job, key, detail: `${key} 가 없다 (unset) — 이 job 은 올라가도 아무것도 하지 않는다` })
      continue
    }
    if (raw.trim() !== 'true') {
      seen.add(key)
      out.push({ job, key, detail: `${key}=${raw.trim() || '(빈 값)'} — 'true' 여야 일한다` })
    }
  }
  return out
}

/**
 * 🔴 **더는 loaded 되어 있으면 안 되는 옛 job.** Wave B 에서 다회로 바꾼 1회판이다.
 *    old/new 가 같이 올라와 있으면 같은 source 를 두 배로 두드린다.
 */
export const RETIRED_JOBS: readonly string[] = [
  'com.soransoran.navercafe-collect-remonterrace',
  'com.soransoran.navercafe-collect-wgang',
  /**
   * 🔴 **중앙 공급 러너는 폐기됐다** (2026-09-11). 수집·판정·적재를 한 회차에 묶어서
   *    82cook 하나의 장애가 세 source 의 공급을 세웠다. 지금은 수집 job 셋과
   *    처리 job 하나로 나뉘어 있다 — 옛 job 이 아직 올라와 있으면 같은 원천을 두 번 연다.
   */
  'com.soransoran.supply-autopilot',
]

/**
 * 🔴 **unload 만으로는 되돌아온다.**
 *
 *    2026-09-09 실측: 은퇴시킨 1회판 job 2개가 다시 loaded 되어 있었고,
 *    `WorkingDirectory` 가 **개발 작업트리**였다(`runs = 0` 이라 실행 전에 잡았다).
 *    `launchctl unload` 는 지금 세션에서만 내린다 — plist 가 `~/Library/LaunchAgents`
 *    에 남아 있으면 로그인·재부팅 때 launchd 가 다시 등록한다.
 *
 *    그래서 계약은 "loaded 가 아니다" 가 아니라 **"그 자리에 파일이 없다"** 다.
 *    지우지는 않고 정본 밖 보관소로 옮긴다 — 되돌릴 수 있어야 한다.
 */
export function judgeRetiredPlists(input: {
  /** `~/Library/LaunchAgents` 안에 있는 파일 이름들 */
  agentFiles: readonly string[]
  /** 보관소 안에 있는 파일 이름들 — 옮겼는지 확인한다 */
  rollbackFiles?: readonly string[]
  retired?: readonly string[]
}): PathVerdict {
  return judgeLeftoverPlists({
    agentFiles: input.agentFiles, rollbackFiles: input.rollbackFiles,
    labels: input.retired ?? RETIRED_JOBS, what: '옛',
  })
}

/**
 * 🔴 **내려 둔 job 도 그 자리에 파일이 없어야 한다** (2026-09-16 실측).
 *
 *    스위치를 `false` 로 내리고 `launchctl` 에서 내려 두었는데, 이틀 뒤 두 job 이
 *    다시 `loaded` 였다 (`runs = 0` · `active count = 0` 이라 실행 전에 잡았다).
 *    원인은 퇴역 job 과 **정확히 같다** — `~/Library/LaunchAgents` 에 설치 plist 가
 *    남아 있었고, 로그인·재부팅 때 launchd 가 그 파일을 다시 등록했다.
 *
 *    그런데 `judgeRetiredPlists` 는 `RETIRED_JOBS` 만 봤다. 내려 둔 job 의 잔존 plist는
 *    **아무도 보지 않았다.** 그래서 "unloaded 다" 만 확인하는 검사는 매번 초록이었고,
 *    다음 로그인에 되살아났다.
 *
 * 🔴 **특정 label 을 박지 않는다.** 대상은 `partitionJobsByEnv` 의 `disabled` 집합이다 —
 *    스위치가 다시 `true` 가 되면 이 검사의 대상에서 저절로 빠진다.
 */
export function judgeDisabledPlists(input: {
  agentFiles: readonly string[]
  rollbackFiles?: readonly string[]
  /** 🔴 `partitionJobsByEnv(...).disabled` 를 그대로 넘긴다 */
  disabled: readonly string[]
}): PathVerdict {
  return judgeLeftoverPlists({
    agentFiles: input.agentFiles, rollbackFiles: input.rollbackFiles,
    labels: input.disabled, what: '내려 둔 job 의',
  })
}

/** 🔴 두 판정의 계약은 같다 — 문구만 다르다. 규칙을 두 벌로 두지 않는다 */
function judgeLeftoverPlists(input: {
  agentFiles: readonly string[]
  rollbackFiles?: readonly string[]
  labels: readonly string[]
  what: string
}): PathVerdict {
  const problems: string[] = []
  for (const label of input.labels) {
    const file = `${label}.plist`
    if (input.agentFiles.includes(file)) {
      problems.push(
        `🔴 ${input.what} plist 가 LaunchAgents 에 남아 있다 — ${file}`
        + ' (unload 해도 로그인·재부팅 때 다시 등록된다)',
      )
    } else if (input.rollbackFiles !== undefined && !input.rollbackFiles.includes(file)) {
      // 🔴 옮긴 것과 그냥 사라진 것은 다르다. 보관본이 없으면 되돌릴 수 없다
      problems.push(`🟡 ${input.what} plist 보관본이 없다 — ${file} (되돌릴 수 없다)`)
    }
  }
  return { ok: problems.length === 0, problems }
}

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
  /**
   * 🔴 **의도적으로 스위치를 내려 둔 job.** 올라와 있으면 실패다 —
   *    "수집하지 않기로 했다" 는 결정이 실제로는 지켜지지 않고 있다는 뜻이다.
   *    빠져 있는 것은 실패가 아니다. 그것이 계약이다.
   */
  disabled?: readonly string[]
}): JobsVerdict {
  const expected = input.expected ?? RUNTIME_JOBS
  const retired = input.retired ?? RETIRED_JOBS
  const problems: string[] = []
  const loaded = [...input.loaded]

  for (const r of retired) {
    if (loaded.includes(r)) problems.push(`🔴 옛 job 이 아직 loaded 다 — ${r} (같은 source 를 두 배로 두드린다)`)
  }
  for (const d of input.disabled ?? []) {
    if (loaded.includes(d)) {
      problems.push(`🔴 내려 두기로 한 job 이 loaded 다 — ${d} (스위치는 false 인데 job 이 돈다)`)
    }
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
  /**
   * 🔴 **인자 전부.** 경로만 보면 **옛 인자로 도는 job 이 통과한다** —
   *    실제로 네이버 job 이 runtime 밑의 옛 수집기를 `--pages=1 --max=10` 으로 돌고 있었고
   *    경로 검사는 전부 초록이었다. 무엇을 실행하는가는 인자가 말한다.
   */
  args: readonly string[]
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
  /**
   * 🔴 저장소 템플릿을 render 한 **기대 인자**. 주면 값으로 대조한다.
   *    주지 않으면 경로만 본다 — 그 경우 **옛 인자로 도는 job 을 잡지 못한다**는 뜻이고,
   *    운영 경로(`--require-runtime`)는 반드시 준다.
   */
  expectedArgs?: readonly string[]
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
  const problems = [...v.problems]
  if (input.expectedArgs !== undefined) {
    const want = [...input.expectedArgs]
    const got = [...input.loaded.args]
    if (want.length === 0) {
      problems.push(`${input.label}(loaded): 기대 인자가 비어 있다 — 템플릿을 읽지 못했다(fail-closed)`)
    } else if (want.length !== got.length || want.some((x, i) => x !== got[i])) {
      problems.push(
        `${input.label}(loaded): ProgramArguments 가 템플릿과 다르다`
        + `\n        기대: ${want.join(' ')}`
        + `\n        실제: ${got.join(' ')}`,
      )
    }
  }
  return { ok: problems.length === 0, problems }
}

/** `launchctl print` 원문에서 실제 설정을 뽑는다 — 🔴 순수 함수. 명령은 부르는 쪽이 돌린다 */
export function parseLaunchctlPrint(out: string | null): LoadedJobConfig {
  if (out === null || out.trim() === '') {
    return { readable: false, programPath: null, workingDirectory: null, args: [] }
  }
  const argsBlock = /arguments = \{([\s\S]*?)\n\t\}/.exec(out)
  const args = argsBlock === null ? [] : argsBlock[1]!.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const wd = /working directory = (.+)/.exec(out)
  return {
    readable: true,
    programPath: args.find((a) => a.endsWith('.mts')) ?? null,
    workingDirectory: wd === null ? null : wd[1]!.trim(),
    args,
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
