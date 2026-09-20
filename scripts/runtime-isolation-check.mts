#!/usr/bin/env tsx
/**
 * 예약 실행 격리 검사 — 🔴 **read-only. DB 0 · 네트워크 0 · launchctl 변경 0**
 *
 * 🔴 두 층을 함께 본다.
 *    ① **행동 fixture** — 판정 규칙이 실제로 잡는지 (CI 어디서나 돈다)
 *    ② **실제 관측** — 이 기계의 launchd·worktree 가 계약대로인지
 *       (runtime 이 없는 기계에서는 관측을 건너뛰고 fixture 만 본다)
 *
 * 🔴 관측을 건너뛰는 것과 통과시키는 것은 다르다 — 건너뛰면 화면에 그렇게 적는다.
 */
import { execFileSync } from 'node:child_process'
import {
  closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync,
  readdirSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { statSync } from 'node:fs'

import {
  JOB_ENV_REQUIREMENTS, judgeJobEnv, partitionJobsByEnv,
  RUNTIME_JOBS, RETIRED_JOBS,
  judgeCanonicalMode, judgeJobPath, judgeJobState, judgeLoadedConfig, judgeLoadedJobs,
  judgeRuntimeClean, judgeRuntimeSetup, judgeRuntimeSha, judgeRetiredPlists, judgeDisabledPlists,
  parseLaunchctlPrint, type JobState,
} from '../src/lib/runtime-isolation'
import {
  judgeCheckpointFreshness, judgePromotionFreshness, judgeSlotEvidence, parseSuccessRuns, runIdToMs,
} from '../src/lib/runtime-evidence'
import {
  judgeDeploy, judgeDeployLock, judgeLockRelease, runDeploy, type DeployEffects,
} from '../src/lib/runtime-deploy'
/** 🔴 보관소 이름의 정본 — 배포기와 **같은 상수**를 쓴다. 문자열을 다시 적지 않는다 */
import { rollbackDirOf, sameArgs } from './lib/launchd-install.mjs'
/** 🔴 발행 러너 label 의 정본 — 여기에 문자열을 다시 적지 않는다 */
import { PUBLISH_RUNNER_LABEL } from './lib/original-post-runner-template'
import { readRuntimeEnv } from './lib/runtime-env.mjs'

/** 🔴 예약 실행 전용 worktree — 개발 작업트리와 **다른 곳**이다 */
export const RUNTIME_ROOT = join(homedir(), 'Documents', 'soransoran-runtime')
/** 🔴 코드가 아닌 것(비밀·상태)의 정본. 어느 worktree 에도 속하지 않는다 */
export const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
export const PINNED_SHA_FILE = join(CANON_DIR, 'runtime-pinned-sha')
const AGENT_DIR = join(homedir(), 'Library', 'LaunchAgents')

/**
 * 🔴 **관측을 건너뛴 것을 "통과" 로 쓰지 않기 위한 스위치.**
 *
 *    CI 에는 runtime worktree 가 없다. 거기서는 규칙(fixture)만 시험하는 것이 맞다.
 *    그런데 **운영 판정**(Wave C 준비도)이 같은 exit code 를 믿으면,
 *    runtime 이 아예 없는 기계에서도 "격리 성립" 이 되어 버린다 — fail-open 이다.
 *    그래서 운영 경로는 `--require-runtime` 을 붙여 **관측 없으면 실패**하게 한다.
 */
const REQUIRE_RUNTIME = process.argv.includes('--require-runtime')

let pass = 0
let failN = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${n}`) }
}

console.log('\n══ 예약 실행 격리 검사 (read-only) ══\n')

// ─────────────────────────────────────────────────────────
// ① 행동 fixture — 규칙이 실제로 잡는가
// ─────────────────────────────────────────────────────────
console.log('① 판정 규칙 (행동)')
const RT = '/Users/x/Documents/soransoran-runtime'
const DEV = '/Users/x/Documents/soransoran-m0'

{
  const good = judgeJobPath({
    label: 'j', programPath: `${RT}/scripts/a.mts`, workingDirectory: RT,
    runtimeRoot: RT, devRoots: [DEV],
  })
  check('🟢 runtime 경로를 실행하면 통과한다', good.ok)

  const dev = judgeJobPath({
    label: 'j', programPath: `${DEV}/scripts/a.mts`, workingDirectory: DEV,
    runtimeRoot: RT, devRoots: [DEV],
  })
  check('🔴 개발 작업트리를 실행하면 FAIL 한다', !dev.ok)
  check('🔴 그 이유를 개발 작업트리라고 말한다',
    dev.problems.some((p) => p.includes('개발 작업트리를 실행한다')))

  // 🔴 접두 일치만 보면 `-dev` 같은 이웃 경로가 통과한다
  const neighbour = judgeJobPath({
    label: 'j', programPath: `${RT}-dev/scripts/a.mts`, workingDirectory: `${RT}-dev`,
    runtimeRoot: RT, devRoots: [DEV],
  })
  check('🔴 이름이 비슷한 이웃 경로를 runtime 으로 착각하지 않는다', !neighbour.ok)

  const noWd = judgeJobPath({
    label: 'j', programPath: `${RT}/scripts/a.mts`, workingDirectory: null,
    runtimeRoot: RT, devRoots: [DEV],
  })
  check('🔴 WorkingDirectory 가 없으면 FAIL — env·데이터를 못 찾는다', !noWd.ok)

  const wdDev = judgeJobPath({
    label: 'j', programPath: `${RT}/scripts/a.mts`, workingDirectory: DEV,
    runtimeRoot: RT, devRoots: [DEV],
  })
  check('🔴 스크립트는 runtime 인데 WorkingDirectory 가 개발이면 FAIL', !wdDev.ok)
}

{
  const pinned = 'a'.repeat(40)
  const ok = judgeRuntimeSha({ head: pinned, pinned, detached: true, ancestorOfMain: true })
  check('🟢 detached · 고정 SHA 일치 · main 계보면 통과', ok.ok)
  check('🔴 브랜치를 물고 있으면 FAIL — 브랜치가 움직이면 실행 코드가 바뀐다',
    !judgeRuntimeSha({ head: pinned, pinned, detached: false, ancestorOfMain: true }).ok)
  check('🔴 고정 SHA 와 다르면 FAIL',
    !judgeRuntimeSha({ head: 'b'.repeat(40), pinned, detached: true, ancestorOfMain: true }).ok)
  const notMain = judgeRuntimeSha({ head: pinned, pinned, detached: true, ancestorOfMain: false })
  check('🔴 main 계보가 아니면 FAIL — feature branch 커밋을 고정해도 잡힌다', !notMain.ok)
  check('🔴 그 이유를 feature branch 라고 말한다',
    notMain.problems.some((p) => p.includes('feature branch')))
  check('🔴 계보를 확인하지 못하면 통과시키지 않는다 (fail-closed)',
    !judgeRuntimeSha({ head: pinned, pinned, detached: true, ancestorOfMain: null }).ok)
  check('🔴 고정 기록이 없으면 FAIL',
    !judgeRuntimeSha({ head: pinned, pinned: null, detached: true, ancestorOfMain: true }).ok)
}

{
  check(`🟢 예약 job ${RUNTIME_JOBS.length}개만 loaded 면 통과`, judgeLoadedJobs({ loaded: [...RUNTIME_JOBS] }).ok)
  const retired = judgeLoadedJobs({ loaded: [...RUNTIME_JOBS, RETIRED_JOBS[0]!] })
  check('🔴 옛 1회판이 같이 loaded 면 FAIL', !retired.ok)
  check('🔴 그 이유를 "두 배로 두드린다" 로 말한다',
    retired.problems.some((p) => p.includes('두 배로')))
  check('🔴 같은 job 이 중복 loaded 면 FAIL',
    !judgeLoadedJobs({ loaded: [...RUNTIME_JOBS, RUNTIME_JOBS[0]!] }).ok)
  check('🔴 예약 job 이 빠지면 FAIL',
    !judgeLoadedJobs({ loaded: RUNTIME_JOBS.slice(1) }).ok)
}

{
  const full = {
    hasNodeModules: true, hasPrismaClient: true, hasEnvLocal: true, envIsLink: true,
    hasDataDir: true, dataIsLink: true, dataSharedWithDev: true,
  }
  check('🟢 전부 갖추면 통과', judgeRuntimeSetup(full).ok)
  check('🔴 node_modules 가 없으면 FAIL', !judgeRuntimeSetup({ ...full, hasNodeModules: false }).ok)
  check('🔴 Prisma client 가 없으면 FAIL', !judgeRuntimeSetup({ ...full, hasPrismaClient: false }).ok)
  check('🔴 .env.local 이 없으면 FAIL', !judgeRuntimeSetup({ ...full, hasEnvLocal: false }).ok)
  const copied = judgeRuntimeSetup({ ...full, envIsLink: false })
  check('🔴 env 를 평문으로 복제하면 FAIL', !copied.ok)
  check('🔴 그 이유를 "두 곳에 두지 않는다" 로 말한다',
    copied.problems.some((p) => p.includes('두 곳에 두지 않는다')))
  const split = judgeRuntimeSetup({ ...full, dataSharedWithDev: false })
  check('🔴 데이터 원장이 갈라지면 FAIL', !split.ok)
  check('🔴 그 이유를 "예산이 둘로 갈라져" 로 말한다',
    split.problems.some((p) => p.includes('예산이 둘로 갈라져')))
}

{
  // 🔴 **설치 plist 는 runtime 인데 실제 loaded 는 개발 경로** (P0-4)
  const devLoaded = parseLaunchctlPrint(`	path = /x.plist
	state = not running
	program = /usr/bin/npx
	arguments = {
		/usr/bin/npx
		tsx
		${DEV}/scripts/supply-process.mts
		--live
	}
	working directory = ${DEV}
`)
  check('🔴 launchctl 원문에서 실제 경로를 뽑는다', devLoaded.readable && devLoaded.programPath === `${DEV}/scripts/supply-process.mts`)
  check('🔴 파일은 runtime 인데 loaded 가 개발 경로면 FAIL',
    !judgeLoadedConfig({ label: 'j', loaded: devLoaded, runtimeRoot: RT, devRoots: [DEV] }).ok)
  const rtLoaded = parseLaunchctlPrint(`	arguments = {\n\t\ttsx\n\t\t${RT}/scripts/a.mts\n\t}\nworking directory = ${RT}\n`)
  check('🟢 loaded 도 runtime 이면 통과',
    judgeLoadedConfig({ label: 'j', loaded: rtLoaded, runtimeRoot: RT, devRoots: [DEV] }).ok)
  const unread = judgeLoadedConfig({ label: 'j', loaded: parseLaunchctlPrint(null), runtimeRoot: RT, devRoots: [DEV] })
  check('🔴 launchctl 관측 실패는 통과가 아니다 (fail-closed)', !unread.ok)
  check('🔴 그때 이유를 "실제 설정을 읽지 못했다" 로 말한다 — 경로 문제와 구분한다',
    unread.problems.some((x) => x.includes('실제 설정을 읽지 못했다')))

  // 🔴 runtime 손댐 (P1-1)
  check('🟢 추적 변경이 없으면 통과', judgeRuntimeClean({ porcelain: '' }).ok)
  const dirty = judgeRuntimeClean({ porcelain: ' M scripts/supply-process.mts' })
  check('🔴 runtime 의 추적 파일이 바뀌면 FAIL', !dirty.ok)
  check('🔴 그 이유를 "손대졌다" 로 말한다', dirty.problems.some((x) => x.includes('손대졌다')))
  check('🔴 git 상태를 못 읽으면 FAIL (fail-closed)', !judgeRuntimeClean({ porcelain: null }).ok)

  // 🔴 정본 권한 (P1-3)
  const ok600 = judgeCanonicalMode({ label: 'env', actual: { exists: true, mode: 0o600, uid: 501 }, maxMode: 0o600, currentUid: 501 })
  check('🟢 600 · 소유자 일치면 통과', ok600.ok)
  check('🔴 644 면 FAIL — 같은 기계의 다른 계정이 읽는다',
    !judgeCanonicalMode({ label: 'env', actual: { exists: true, mode: 0o644, uid: 501 }, maxMode: 0o600, currentUid: 501 }).ok)
  check('🔴 755 디렉터리면 FAIL',
    !judgeCanonicalMode({ label: 'dir', actual: { exists: true, mode: 0o755, uid: 501 }, maxMode: 0o700, currentUid: 501 }).ok)
  // 🔴 maxMode 로는 안 잡히는 자리 — 소유자 권한은 0 인데 group 만 열린 경우
  check('🔴 group 에만 권한이 열려도 FAIL (maxMode 비교로는 못 잡는다)',
    !judgeCanonicalMode({ label: 'env', actual: { exists: true, mode: 0o060, uid: 501 }, maxMode: 0o600, currentUid: 501 }).ok)
  check('🔴 소유자가 다르면 FAIL',
    !judgeCanonicalMode({ label: 'env', actual: { exists: true, mode: 0o600, uid: 999 }, maxMode: 0o600, currentUid: 501 }).ok)
  check('🔴 정본이 없으면 FAIL',
    !judgeCanonicalMode({ label: 'env', actual: { exists: false, mode: 0, uid: 0 }, maxMode: 0o600, currentUid: 501 }).ok)

  // 🔴 격리 ≠ 최신
  const behind = judgePromotionFreshness({ runtimeSha: 'a'.repeat(40), originMainSha: 'b'.repeat(40), lag: 3 })
  check('🔴 뒤처진 것은 승격 불가지만 **격리 실패가 아니다**', !behind.fresh && behind.detail.includes('격리는 성립'))
  check('🟢 origin/main 과 같으면 승격 가능',
    judgePromotionFreshness({ runtimeSha: 'a'.repeat(40), originMainSha: 'a'.repeat(40), lag: 0 }).fresh)
  check('🔴 SHA 를 못 읽으면 승격 불가 (fail-closed)',
    !judgePromotionFreshness({ runtimeSha: null, originMainSha: 'a'.repeat(40), lag: null }).fresh)
}

{
  // ── 🔴 Naver 슬롯 증거 (P0-1 · P0-2) ──
  const SLOTS = [{ hour: 4, minute: 20 }, { hour: 10, minute: 20 }, { hour: 16, minute: 20 }, { hour: 22, minute: 20 }]
  const line = (id: string): string => `  → ./x/navercafe-thin-a-${id}.thin-detail.jsonl (2건 · run ${id})\n`
  const since = runIdToMs('20260909-133000')!
  const now2 = runIdToMs('20260910-110000')!
  const ev = (body: string, at = now2): ReturnType<typeof judgeSlotEvidence> =>
    judgeSlotEvidence({ runs: parseSuccessRuns(body), slots: SLOTS, since, now: at })

  // A. 전환 이전 10회 + 이후 0회
  const past = Array.from({ length: 10 }, (_, i) => line(`2026090${(i % 8) + 1}-092004`)).join('')
  check('🔴 [A] 전환 이전 회차는 세지 않는다 (옛 방식은 10 이었다)', ev(past).succeeded === 0)
  // B. 같은 runId 4줄
  check('🔴 [B] 같은 runId 는 한 회차다', ev(line('20260909-162004').repeat(4)).succeeded === 1)
  check('🔴 [B] 파서가 중복을 **한 건으로** 돌려준다 (슬롯 매칭에 기대지 않는다)',
    parseSuccessRuns(line('20260909-162004').repeat(4)).length === 1)
  // C. 자정을 가로지른 4회
  const across = ['20260909-162004', '20260909-222005', '20260910-042003', '20260910-102004'].map(line).join('')
  check('🔴 [C] 자정을 넘겨도 최근 4슬롯 증거가 유지된다', ev(across).succeeded === 4)
  // D. 하나 누락
  const missing = ['20260909-162004', '20260910-042003', '20260910-102004'].map(line).join('')
  check('🔴 [D] 슬롯 하나가 비면 3/4', ev(missing).succeeded === 3)
  // E. 실패·중단 출력
  check('🔴 [E] 시작 줄·중단 출력은 성공이 아니다',
    ev('  🔴 실제 수집 · run 20260909-162004\n  🔴 중단: 세션 만료\n').succeeded === 0)
  check('🔴 아직 4슬롯이 지나지 않았으면 판정할 수 없다고 말한다',
    ev(across, runIdToMs('20260909-170000')!).detail.includes('지나야 판정할 수 있다'))
  check('🔴 배포 기록이 없으면 아무 회차도 인정하지 않는다',
    judgeSlotEvidence({ runs: parseSuccessRuns(across), slots: SLOTS, since: Number.MAX_SAFE_INTEGER, now: now2 }).succeeded === 0)
  /**
   * 🔴 **전환 직전 회차가 슬롯에 가까우면** 시각만으로는 구분되지 않는다 —
   *    `since` 필터가 실제로 일을 해야 잡힌다.
   */
  const justBefore = judgeSlotEvidence({
    // 🔴 22:20 슬롯 **10분 전**에 돈 회차 — 전환은 그 5분 뒤였다.
    //    `since` 필터가 없으면 이 회차가 22:20 슬롯을 채워 버린다
    runs: parseSuccessRuns(line('20260909-221000')),
    slots: SLOTS, since: runIdToMs('20260909-221500')!, now: runIdToMs('20260909-230000')!, expected: 1,
  })
  check('🔴 전환 **직전**(슬롯 바로 앞) 회차도 세지 않는다', justBefore.succeeded === 0)
  /**
   * 🔴 한 회차가 **여러 슬롯을 채우지 못한다** — 슬롯이 가까울 때만 드러난다
   */
  const closeSlots = [{ hour: 16, minute: 0 }, { hour: 16, minute: 30 }]
  const one = judgeSlotEvidence({
    runs: parseSuccessRuns(line('20260909-161500')),
    slots: closeSlots, since, now: now2, expected: 2,
  })
  check('🔴 한 회차는 슬롯 하나에만 붙는다 (가까운 슬롯 2개 · 회차 1개 → 1/2)', one.succeeded === 1)

  /**
   * 🔴 **창은 한 방향이다 — 슬롯 이후 tolerance 안.**
   *
   *    옛 판은 `Math.abs(run - slot) <= 90분` 이었다. 그래서 **13:20 에 손으로 돌린 회차가
   *    14:50 예약 슬롯을 채웠다.** 예약이 돌았다는 증거를 손으로 만든 증거가 대신할 수 없다 —
   *    슬롯보다 먼저 끝난 회차는 그 슬롯이 돌았는지에 대해 아무것도 말해 주지 않는다.
   */
  const wgang = [{ hour: 14, minute: 50 }]
  const at = (id: string, sl: readonly { hour: number; minute: number }[], nowId: string): number =>
    judgeSlotEvidence({
      runs: parseSuccessRuns(line(id)), slots: sl,
      since: runIdToMs('20260909-000000')!, now: runIdToMs(nowId)!, expected: 1,
    }).succeeded
  check('🔴 13:20 수동 회차는 14:50 슬롯을 채우지 못한다 (옛 판은 1/1 이었다)',
    at('20260909-132000', wgang, '20260909-180000') === 0)
  check('🟢 슬롯 정각 회차는 그 슬롯의 것이다', at('20260909-145000', wgang, '20260909-180000') === 1)
  check('🟢 슬롯 뒤 89분 지연도 그 슬롯의 것이다', at('20260909-161900', wgang, '20260909-180000') === 1)
  check('🔴 슬롯 뒤 91분이면 그 슬롯의 것이 아니다', at('20260909-162100', wgang, '20260909-180000') === 0)
  check('🔴 슬롯 1분 전 회차도 채우지 못한다', at('20260909-144900', wgang, '20260909-180000') === 0)

  /** 🔴 로그의 runId 는 그냥 글자다 — 앞당겨 적힌 **미래 회차**를 증거로 쓰지 않는다 */
  check('🔴 now 이후의 미래 회차는 세지 않는다',
    at('20260910-145000', wgang, '20260909-180000') === 0)
  /** 🔴 없는 날짜는 굴러가서 **다음 날 슬롯**을 채운다 — 되읽기 대조로 막는다 */
  check('🔴 9월 31일 같은 없는 날짜 runId 는 회차로 읽지 않는다',
    runIdToMs('20260931-145000') === null && parseSuccessRuns(line('20260931-145000')).length === 0)
  check('🔴 2월 30일 · 25시도 마찬가지다',
    runIdToMs('20260230-120000') === null && runIdToMs('20260909-250000') === null)

  // ── 🔴 checkpoint 신선도 (P0-3) ──
  //
  //    🔴 시각은 **로컬 시각 문자열**로 적는다 (Z 없이). 슬롯 대조가 로컬 시각이라
  //       UTC 로 적으면 기계 시간대에 따라 판정이 달라진다.
  const dep = Date.parse('2026-09-09T04:22:00.000Z')
  const NOWMS = Date.parse('2026-09-10T01:00:00.000Z')
  const SHA_RT = 'a'.repeat(40)
  /** 공급 회차의 예약 슬롯 — 21:10 */
  const SUP = [{ hour: 21, minute: 10 }]
  const cpAt = (startedAt: string, completedAt: string | null, over: Record<string, unknown> = {}): {
    status: string | null; startedAt: string | null; completedAt: string | null; runtimeSha?: string | null
  } => ({ status: 'done', startedAt, completedAt, runtimeSha: SHA_RT, ...over })
  const judgeCp = (cp: Parameters<typeof judgeCheckpointFreshness>[0]['cp'], over: Record<string, unknown> = {}): { ok: boolean; reason: string } =>
    judgeCheckpointFreshness({ cp, deployedAt: dep, runtimeSha: SHA_RT, now: NOWMS, slots: SUP, ...over })

  const cpOk = judgeCp(cpAt('2026-09-09T21:12:00', '2026-09-09T21:20:00'))
  check('🟢 전환 이후 · SHA 일치 · 21:10 슬롯 회차면 통과', cpOk.ok)

  /**
   * 🔴 **runtimeSha 가 없으면 막는다.**
   *
   *    옛 판은 "전환 이전 회차엔 없을 수 있다" 며 없는 것을 통과시켰다. 그런데
   *    전환 이전 회차는 `deployedAt` 에서 이미 걸러진다 — 그 허용은 구멍일 뿐이었다.
   *    실제로 이 입력은 옛 판에서 ok=true 가 나왔다.
   */
  const cpNoSha = judgeCp(cpAt('2026-09-09T21:12:00', '2026-09-09T21:20:00', { runtimeSha: undefined }))
  check('🔴 checkpoint 에 runtimeSha 가 없으면 막는다', !cpNoSha.ok && cpNoSha.reason.includes('runtimeSha'))
  check('🔴 빈 문자열 runtimeSha 도 없는 것으로 본다',
    !judgeCp(cpAt('2026-09-09T21:12:00', '2026-09-09T21:20:00', { runtimeSha: '' })).ok)
  check('🔴 다른 runtime SHA 에서 돈 회차는 막는다',
    !judgeCp(cpAt('2026-09-09T21:12:00', '2026-09-09T21:20:00', { runtimeSha: 'b'.repeat(40) })).ok)
  check('🔴 지금 runtime SHA 를 모르면 막는다 (fail-closed)',
    !judgeCp(cpAt('2026-09-09T21:12:00', '2026-09-09T21:20:00'), { runtimeSha: null }).ok)

  const cpOld = judgeCp(cpAt('2026-09-08T21:12:00', '2026-09-08T21:20:00'))
  check('🔴 전환 이전 done 은 증거가 아니다', !cpOld.ok && cpOld.reason.includes('이전'))
  check('🔴 running 은 막는다', !judgeCp(cpAt('2026-09-09T21:12:00', null, { status: 'running' })).ok)
  check('🔴 failed 는 막는다', !judgeCp(cpAt('2026-09-09T21:12:00', null, { status: 'failed' })).ok)
  const noStart = judgeCp(cpAt('2026-09-09T21:12:00', '2026-09-09T21:20:00', { startedAt: null }))
  check('🔴 startedAt 이 없으면 막는다 (fail-closed)', !noStart.ok && noStart.reason.includes('startedAt'))
  const noEnd = judgeCp(cpAt('2026-09-09T21:12:00', null))
  check('🔴 done 인데 completedAt 이 없으면 막는다', !noEnd.ok && noEnd.reason.includes('completedAt'))
  check('🔴 시각이 손상되면 막는다', !judgeCp(cpAt('not-a-date', '2026-09-09T21:20:00')).ok)
  const rev = judgeCp(cpAt('2026-09-09T21:20:00', '2026-09-09T21:12:00'))
  check('🔴 completedAt 이 startedAt 보다 이르면 막는다 (손상)', !rev.ok && rev.reason.includes('이르다'))
  const future = judgeCp(cpAt('2026-09-11T21:12:00', '2026-09-11T21:20:00'))
  check('🔴 미래 시각 회차는 막는다', !future.ok)
  check('🔴 배포 기록이 없으면 막는다', !judgeCp(cpAt('2026-09-09T21:12:00', '2026-09-09T21:20:00'), { deployedAt: null }).ok)

  /**
   * 🔴 **손으로 돌린 회차는 정기 회차 증거가 아니다.**
   *    20:00 에 사람이 돌려 done 이 되어도 21:10 예약이 돌았다는 말은 아니다.
   *    🔴 **슬롯보다 먼저** 끝난 회차라 방향을 열어 두면 이게 통과한다.
   */
  const manual = judgeCp(cpAt('2026-09-09T20:00:00', '2026-09-09T20:10:00'))
  check('🔴 슬롯 직전 20:00 수동 회차는 21:10 슬롯 증거가 아니다', !manual.ok && manual.reason.includes('예약 슬롯'))
  check('🔴 슬롯과 상관없는 18:20 회차도 막는다',
    !judgeCp(cpAt('2026-09-09T18:20:00', '2026-09-09T18:30:00')).ok)
  check('🟢 슬롯 뒤 80분 지연 시작은 그 슬롯의 회차다',
    judgeCp(cpAt('2026-09-09T22:30:00', '2026-09-09T22:40:00')).ok)
  check('🔴 슬롯 뒤 100분이면 그 슬롯의 회차가 아니다',
    !judgeCp(cpAt('2026-09-09T22:50:00', '2026-09-09T23:00:00')).ok)
  // 🔴 자정을 넘긴 회차는 **전날** 슬롯의 것일 수 있다 — 같은 날만 보면 이걸 놓친다
  check('🟢 23:40 슬롯의 00:20 회차는 전날 슬롯의 것이다',
    judgeCp(cpAt('2026-09-10T00:20:00', '2026-09-10T00:30:00'),
      { slots: [{ hour: 23, minute: 40 }], now: Date.parse('2026-09-10T02:00:00') }).ok)

  // ── 🔴 배포 게이트 (P1-2) ──
  const SHA_A = 'a'.repeat(40)
  const base = { apply: true, target: SHA_A, originMain: SHA_A, targetOnMain: true, runtimeDirty: false, jobsRunning: [] as string[] }
  check('🟢 조건이 다 맞으면 배포 가능', judgeDeploy(base).ok)
  check('🔴 기본은 dry-run — --apply 없으면 막는다', !judgeDeploy({ ...base, apply: false }).ok)
  check('🔴 축약 SHA 는 받지 않는다', !judgeDeploy({ ...base, target: 'aaaaaaa' }).ok)
  // 🔴 origin/main 비교로는 안 잡히는 자리 — 둘 다 축약이면 같아 보인다
  check('🔴 origin/main 과 "같아 보여도" 40자리가 아니면 막는다',
    !judgeDeploy({ ...base, target: 'aaaaaaa', originMain: 'aaaaaaa' }).ok)
  check('🔴 origin/main 과 다른 SHA 는 막는다', !judgeDeploy({ ...base, target: 'b'.repeat(40) }).ok)
  check('🔴 main 계보가 아니면 막는다 (feature branch)', !judgeDeploy({ ...base, targetOnMain: false }).ok)
  check('🔴 runtime 이 dirty 면 막는다', !judgeDeploy({ ...base, runtimeDirty: true }).ok)
  check('🔴 runtime 상태를 못 읽으면 막는다 (fail-closed)', !judgeDeploy({ ...base, runtimeDirty: null }).ok)
  check('🔴 job 이 돌고 있으면 막는다', !judgeDeploy({ ...base, jobsRunning: ['supply-process'] }).ok)
  check('🔴 origin/main 을 못 읽으면 막는다', !judgeDeploy({ ...base, originMain: null }).ok)
}

{
  // 🔴 운영 판정이 이 스위치를 실제로 쓰는지 본다 — 안 쓰면 fail-open 이 되살아난다
  const waveC = readFileSync('scripts/wave-c-readiness.mts', 'utf-8')
  check('🔴 Wave C 판정이 --require-runtime 으로 관측을 요구한다',
    /runtime-isolation-check\.mts', '--require-runtime'/.test(waveC))
}

{
  // ── 🔴 옛 plist 재등록 방지 (2026-09-09) ──
  const files = RETIRED_JOBS.map((l) => `${l}.plist`)
  /** 🔴 지금 살아 있어야 하는 것 — 폐기 목록과 겹치면 안 된다 */
  const alive = ['com.soransoran.supply-process.plist']
  check('🟢 옛 plist 가 LaunchAgents 에 없고 보관본이 있으면 통과',
    judgeRetiredPlists({ agentFiles: alive, rollbackFiles: files }).ok)
  /**
   * 🔴 **unload 만으로는 되돌아온다.** 파일이 그 자리에 있으면 로그인·재부팅 때
   *    launchd 가 다시 등록한다 — 실제로 그렇게 2개가 되살아났다.
   */
  const left = judgeRetiredPlists({ agentFiles: [...alive, files[0]!], rollbackFiles: files })
  check('🔴 옛 plist 가 LaunchAgents 에 남아 있으면 막는다', !left.ok)
  check('🔴 그 이유를 "다시 등록된다" 로 말한다',
    left.problems.some((p) => p.includes('다시 등록된다')))
  check('🔴 보관본이 없으면 알린다 (되돌릴 수 없다)',
    !judgeRetiredPlists({ agentFiles: alive, rollbackFiles: [] }).ok)
  check('🟢 보관소를 안 넘기면 존재 여부만 본다',
    judgeRetiredPlists({ agentFiles: alive }).ok)
}

// ─────────────────────────────────────────────────────────
// 🔴 배포 행동 fixture (P1-3) — A~I
//
//    🔴 **문자열 검사가 아니라 행동**을 본다. 가짜 명령 세계를 만들고
//       실행 **순서**와 **끝난 뒤의 상태**(SHA·의존성·manifest·pin·올라온 job)를 확인한다.
//       진짜 launchctl·git·npm 은 하나도 부르지 않는다.
// ─────────────────────────────────────────────────────────
console.log('\n🔴 배포 행동 fixture (가짜 명령 · 실제 launchctl 0)')
{
  const J = ['job-a', 'job-b', 'job-c']
  /** 🔴 퇴역 job — unload 하고 설치본도 보관소로 옮겨야 한다 */
  const RETIRED = ['job-old']
  /**
   * 🔴 **배포 동안만 멈춰 두는 job** — 공급 job 이 아니지만 같은 runtime 트리에서 돈다.
   *    운영에서는 `com.soransoran.original-post-runner` 다.
   */
  const QJOB = 'job-publish'
  // 🔴 40자리 **hex** 여야 한다 — judgeDeploy 가 축약·비-SHA 를 막는다
  const PREV = 'c'.repeat(40)
  const NEXT = 'd'.repeat(40)
  const RTDIR = '/Users/x/Documents/soransoran-runtime'
  const DEVDIR = '/Users/x/Documents/soransoran-m0'
  const PATHS = { runtimeRoot: RTDIR, devRoots: [DEVDIR] }

  /**
   * 🔴 **실제 `launchctl print` 출력 형태 그대로.**
   *
   *    정상 출력에는 runtime 밖 경로가 셋 들어 있다 — plist · stdout log · stderr log.
   *    이것들은 runtime 아래일 필요가 **없다**. 이 표본이 없으면
   *    "soransoran 이 들어간 경로는 전부 runtime 밑" 같은 판정이 통과해 버린다
   *    (그 판정으로 실제 정상 job 3개가 전부 실패했다).
   */
  const printSample = (label: string, program: string, wd: string): string =>
    `gui/501/com.soransoran.${label} = {\n`
    + '\tactive count = 0\n'
    + `\tpath = /Users/x/Library/LaunchAgents/com.soransoran.${label}.plist\n`
    + '\ttype = LaunchAgent\n'
    + '\tstate = not running\n\n'
    + '\tprogram = /Users/x/.nvm/versions/node/v24.14.0/bin/npx\n'
    + '\targuments = {\n'
    + '\t\t/Users/x/.nvm/versions/node/v24.14.0/bin/npx\n'
    + '\t\ttsx\n'
    + `\t\t${program}\n`
    + '\t\t--live\n'
    + '\t}\n\n'
    + `\tworking directory = ${wd}\n\n`
    + `\tstdout path = /Users/x/Library/Logs/soransoran/${label}.log\n`
    + `\tstderr path = /Users/x/Library/Logs/soransoran/${label}-error.log\n`
    + '\tinherited environment = {\n'
    + '\t\tSSH_AUTH_SOCK => /private/tmp/com.apple.launchd.Kp6Fop8NYu/Listeners\n'
    + '\t}\n}\n'

  // ── 🔴 tri-state 판정 자체 (실측 exit code·문구 그대로) ──
  check('🟢 exit 0 은 loaded',
    judgeJobState({ exitCode: 0, stdout: printSample('x', `${RTDIR}/scripts/x.mts`, RTDIR), stderr: '' }).state === 'loaded')
  check('🔴 "Could not find service" 만 unloaded 로 인정한다',
    judgeJobState({
      exitCode: 113, stdout: '',
      stderr: 'Bad request.\nCould not find service "com.soransoran.x" in domain for user gui: 501',
    }).state === 'unloaded')
  const dom = judgeJobState({
    exitCode: 125, stdout: '', stderr: 'Could not print domain: 125: Domain does not support specified action',
  })
  check('🔴 도메인 오류는 unloaded 가 아니라 unknown 이다', dom.state === 'unknown')
  check('🔴 그때 무엇 때문인지 말한다', dom.reason.includes('125'))
  check('🔴 launchctl 을 아예 못 돌리면 unknown',
    judgeJobState({ exitCode: null, stdout: '', stderr: '' }).state === 'unknown')
  check('🔴 exit code 만으로 가르지 않는다 (113 이어도 문구가 없으면 unknown)',
    judgeJobState({ exitCode: 113, stdout: '', stderr: 'Bad request.' }).state === 'unknown')

  // ── 🔴 실제 출력에서 계약을 뽑아 판정한다 ──
  {
    const good = parseLaunchctlPrint(printSample('supply-process', `${RTDIR}/scripts/supply-process.mts`, RTDIR))
    check('🟢 [E] 정상 출력에 plist·log 경로가 있어도 loaded 설정은 PASS',
      judgeLoadedConfig({ label: 'x', loaded: good, runtimeRoot: RTDIR, devRoots: [DEVDIR] }).ok)
    check('🔴 [E] 파서가 program 은 .mts, wd 는 working directory 만 본다',
      good.programPath === `${RTDIR}/scripts/supply-process.mts` && good.workingDirectory === RTDIR)
    const devProgram = parseLaunchctlPrint(printSample('x', `${DEVDIR}/scripts/supply-process.mts`, RTDIR))
    check('🔴 [F] program 이 개발 트리면 FAIL',
      !judgeLoadedConfig({ label: 'x', loaded: devProgram, runtimeRoot: RTDIR, devRoots: [DEVDIR] }).ok)
    const devWd = parseLaunchctlPrint(printSample('x', `${RTDIR}/scripts/supply-process.mts`, DEVDIR))
    check('🔴 [F] WorkingDirectory 가 개발 트리면 FAIL',
      !judgeLoadedConfig({ label: 'x', loaded: devWd, runtimeRoot: RTDIR, devRoots: [DEVDIR] }).ok)

    /**
     * 🔴 **옛 판이 왜 틀렸는지를 표본으로 못박는다.**
     *
     *    "출력에서 soransoran 이 들어간 절대경로를 모아 전부 runtime 아래인지" 보면
     *    plist·stdout·stderr 경로 때문에 **정상 job 이 실패한다.** 실측으로 3개 모두 false 였다.
     *    이 두 줄은 같은 입력에서 두 규칙이 반대 답을 낸다는 사실 자체를 기록한다.
     */
    const raw = printSample('supply-process', `${RTDIR}/scripts/supply-process.mts`, RTDIR)
    const adHoc = ((): boolean => {
      const paths = [...raw.matchAll(/(?:^|\s)(\/[^\s"]+)/g)].map((m) => m[1]!).filter((x) => x.includes('soransoran'))
      return paths.length > 0 && paths.every((x) => x.startsWith(RTDIR))
    })()
    check('🔴 원문 전체 경로 규칙은 **정상 출력에서 실패한다** (그래서 버렸다)', !adHoc)
    check('🔴 runtime 밖 경로 3종이 정상 출력에 실제로 들어 있다',
      raw.includes('/Library/LaunchAgents/') && raw.includes('/Library/Logs/soransoran/')
      && raw.includes('-error.log'))
  }

  /**
   * 🔴 배포 도구가 **정본 파서**를 쓰는지 본다.
   *    판정이 두 벌이 되는 순간 하나가 조용히 낡는다 — 그게 이번 결함이었다.
   */
  {
    const src = readFileSync('scripts/runtime-deploy.mts', 'utf-8')
    check('🔴 배포 도구가 parseLaunchctlPrint 정본을 쓴다', /parseLaunchctlPrint\(/.test(src))
    check('🔴 배포 도구가 launchctl 원문에서 경로를 직접 긁지 않는다',
      !/matchAll\(\/.*\\\/\[\^/.test(src) && !/includes\('soransoran'\)/.test(src))
    check('🔴 배포 도구가 tri-state 판정을 쓴다', /judgeJobState\(/.test(src))
    check('🔴 배포 도구가 잠금 소유권을 확인하고 푼다', /judgeLockRelease\(/.test(src))
  }

  type Fault = {
    fetch?: boolean
    checkout?: boolean
    install?: boolean
    gateFail?: string
    isolation?: boolean
    rollbackInstall?: boolean
    noPrevManifest?: boolean
    /** 🔴 명령 반환값과 실제 상태 변화를 **따로** 정한다 */
    unloadReturns?: Readonly<Record<string, boolean>>
    unloadEffect?: Readonly<Record<string, JobState | 'keep'>>
    loadReturns?: Readonly<Record<string, boolean>>
    loadEffect?: Readonly<Record<string, JobState | 'keep'>>
    /**
     * 🔴 **한 번만** 실패하는 load. n번째 호출이 실패하고 상태도 안 바뀐다.
     *    `loadReturns` 는 그 job 에 대해 **계속** 실패한다 — 둘은 다른 상황이다
     *    (일시적 실패는 되돌리기가 성공해야 하고, 영구적 실패는 그러지 못한다).
     */
    loadFailAt?: number
    /** 관측 자체가 실패하는 job */
    probeUnknown?: readonly string[]
    /** 🔴 처음부터 **돌고 있는** job */
    running?: readonly string[]
    /** 🔴 preflight 뒤(=checkout 직전 재관측부터) 돌기 시작한 job */
    runningLater?: readonly string[]
    /** 🔴 checkout 직전 재관측에서 실행 여부를 알 수 없는 job */
    runningUnknownLater?: readonly string[]
    /** 🔴 되올린 job 의 WorkingDirectory 가 설치본과 다른 상태 */
    wdMismatch?: boolean
    /** 처음부터 이 상태로 시작한다 */
    initial?: Readonly<Record<string, JobState>>
    /** 실제 loaded 설정이 개발 트리를 가리키는 job */
    devPathJobs?: readonly string[]
    // ── 🔴 plist cutover 결함 주입 ──
    /** 템플릿을 render 하지 못하는 job (치환이 남았거나 파일이 없다) */
    renderFail?: readonly string[]
    /** 설치(write)가 실패하는 job */
    plistWriteFail?: readonly string[]
    /** plutil 검증이 실패하는 job */
    lintFail?: readonly string[]
    /** 퇴역 이동이 실패하는 job */
    retireFail?: readonly string[]
    /** 🔴 **배포 전에 설치본이 아예 없는** job — 첫 설치를 시험한다 */
    noInstalledPlist?: readonly string[]
    /** rollback 중 plist 복원이 실패하는 job */
    restorePlistFail?: readonly string[]
    /** loaded 인자가 템플릿과 다른 job (옛 인자로 도는 상태) */
    staleArgsJobs?: readonly string[]
    /**
     * 🔴 **이전 runtime(옛 SHA)에 템플릿이 없는 job.**
     *    첫 cutover 가 바로 이 상황이다 — 새 job 의 템플릿은 target 에만 있다.
     */
    missingInOldRuntime?: readonly string[]
    /** 🔴 배포기가 **옛 runtime 작업트리**에서 읽도록 되돌린 상태(회귀 재주입) */
    renderFromOldRuntime?: boolean
    /** 활성화 스위치가 막는 job */
    envBlocked?: readonly string[]
    /**
     * 🔴 **옛 rollback 순서를 재주입한다** — plist 를 먼저 지우고 그 다음 unload.
     *    이것이 PR #501 배포에서 새 job 3개를 남긴 순서다.
     *    되돌리면 [R-2] 가 깨져야 한다 — 그것이 이 fixture 의 검증력이다.
     */
    legacyRollbackOrder?: boolean
    /**
     * 🔴 **bootout 이 먹히지 않는 job** — 명령은 돌지만 상태가 그대로다.
     *    "명령을 보냈다" 를 "내려갔다" 로 읽으면 안 된다는 것을 이 주입기가 증명한다.
     */
    bootoutNoop?: readonly string[]
    /**
     * 🔴 **옮겼다고 하는데 파일이 그대로인 job** — 명령은 성공을 돌려주고
     *    설치본은 그 자리에 남는다. 로그인 재등록이 남긴 결과와 같은 모양이다.
     *    배포는 명령의 반환값이 아니라 **다시 읽은 파일**로 판정해야 한다.
     */
    retireNoop?: readonly string[]
  }
  type World = {
    dir: string; manifestFile: string; pinFile: string
    sha: string; deps: string; state: Map<string, JobState>
    /** 🔴 설치된 plist 원문 — 실제 파일처럼 다룬다 */
    plists: Map<string, string>
    /** 🔴 퇴역 보관소 */
    retiredStore: Map<string, string>
    order: string[]; installs: number
    fx: DeployEffects
  }
  /** 🔴 **target** 템플릿을 render 한 결과 — 새 인자가 값으로 들어 있다 */
  const ARGS_OF = (l: string): string[] => ['/nvm/bin/npx', 'tsx', `${RTDIR}/scripts/${l}.mts`, '--live']
  const RENDERED = (l: string): string => `<plist>${l}:new:${ARGS_OF(l).join(' ')}</plist>`
  /**
   * 🔴 **옛 runtime 작업트리**의 템플릿을 render 한 결과 — 옛 인자다.
   *    이것이 설치되면 배포는 "성공" 이라고 적으면서 아무것도 고치지 않은 것이다.
   */
  const OLD_ARGS_OF = (l: string): string[] =>
    ['/nvm/bin/npx', 'tsx', `${RTDIR}/scripts/${l}.mts`, '--pages=1', '--max=10']
  const OLD_RENDERED = (l: string): string => `<plist>${l}:stale:${OLD_ARGS_OF(l).join(' ')}</plist>`
  /** 🔴 배포 전 설치본 — **옛 인자**가 들어 있다. 되돌리면 이 인자로 돌아와야 한다 */
  const OLD_PLIST = (l: string): string => `<plist>${l}:stale:${OLD_ARGS_OF(l).join(' ')}</plist>`
  /** 설치본에서 인자를 되꺼낸다 — fixture 안의 `argsOf` 정본 */
  const PARSE_ARGS = (xml: string): string[] => {
    const m = /:(?:new|stale):([^<]*)</.exec(xml)
    return m === null ? [] : m[1]!.split(' ').filter((x) => x !== '')
  }

  const worlds: string[] = []
  const makeWorld = (f: Fault = {}): World => {
    const dir = mkdtempSync(join(tmpdir(), 'soran-deploy-fx-'))
    worlds.push(dir)
    const manifestFile = join(dir, 'runtime-manifest.json')
    const pinFile = join(dir, 'runtime-pinned-sha')
    if (f.noPrevManifest !== true) writeFileSync(manifestFile, JSON.stringify({ sha: PREV }), 'utf-8')
    writeFileSync(pinFile, `${PREV}\n`, 'utf-8')

    const state = new Map<string, JobState>(
      [...J, ...RETIRED, QJOB].map((l) =>
        [l, f.initial?.[l] ?? (J.includes(l) || l === QJOB ? 'loaded' : 'unloaded')]),
    )
    // 🔴 배포 전 설치본 — 옛 내용이 들어 있다. `noInstalledPlist` 면 아예 없다
    const plists = new Map<string, string>()
    for (const l of [...J, ...RETIRED, QJOB]) {
      if ((f.noInstalledPlist ?? []).includes(l)) continue
      plists.set(l, OLD_PLIST(l))
    }
    const w: World = {
      dir, manifestFile, pinFile,
      sha: PREV, deps: PREV, state, plists, retiredStore: new Map(),
      order: [], installs: 0, fx: {} as DeployEffects,
    }
    const rec = (m: string): void => { w.order.push(m) }
    let loads = 0
    /** 🔴 `runningJobs` 관측 횟수 — preflight 와 checkout 직전을 가른다 */
    let probes = 0
    /** 🔴 명령이 실제로 상태를 바꿨는가 — 반환값과 독립이다 */
    const applyEffect = (l: string, eff: JobState | 'keep' | undefined, fallback: JobState): void => {
      const e = eff ?? fallback
      if (e !== 'keep') state.set(l, e)
    }
    w.fx = {
      fetch: () => { rec('fetch'); return f.fetch !== true },
      currentSha: () => w.sha,
      originMain: () => NEXT,
      isAncestor: () => true,
      dirty: () => false,
      // 🔴 실제 배포기와 같게 — 퇴역 job 도 본다 (돌고 있는 옛 job 위로 배포하지 않는다)
      /**
       * 🔴 실제 배포기와 같게 — 퇴역 job 과 **잠시 멈출 job** 도 본다.
       *    🔴 `runningLater` 는 **두 번째 관측부터** 돌기 시작한 회차를 재현한다 —
       *       preflight 와 unload 사이의 틈이 그것이다.
       */
      runningJobs: () => {
        probes += 1
        const later = probes >= 2 ? (f.runningLater ?? []) : []
        return {
          running: [...(f.running ?? []), ...later],
          unknown: [
            ...(f.probeUnknown ?? []).filter((l) => [...J, ...RETIRED, QJOB].includes(l)),
            ...(probes >= 2 ? (f.runningUnknownLater ?? []) : []),
          ],
        }
      },

      /**
       * 🔴 **실제 `launchctl unload <plist>` 를 그대로 흉내낸다** (2026-09-11).
       *
       *    앞선 fixture 는 plist 유무와 무관하게 성공했다. 그래서 "plist 를 먼저 지우고
       *    그 다음 unload" 라는 **실제로 불가능한 순서**를 통과시켰다 —
       *    운영에서 새 job 3개가 내려가지 않고 남은 것이 그 결함이다.
       *    파일이 없으면 unload 는 실패하고 상태도 바뀌지 않는다.
       */
      unload: (l) => {
        rec(`unload:${l}`)
        if (!plists.has(l)) return false
        applyEffect(l, f.unloadEffect?.[l], 'unloaded')
        return f.unloadReturns?.[l] ?? true
      },
      /**
       * 🔴 **label 기반 정지** — 파일에 의존하지 않는다.
       *    `legacyRollbackOrder` 면 옛 판을 재주입한다: bootout 이 없던 시절처럼
       *    **plist 경로에 의존**하게 만들어, 파일이 지워진 뒤에는 내려가지 않게 한다.
       */
      /**
       * 🔴 **label 기반 정지.** 파일에 의존하지 않는다.
       *
       *    `legacyRollbackOrder` 는 **이 수단이 없던 옛 판**을 재주입한다 —
       *    그때는 정지가 `launchctl unload <plist>` 뿐이었고, rollback 이 파일을
       *    먼저 지운 뒤라 전부 실패했다. 그 상태에서는 복구가 불완전해야 한다.
       */
      bootout: (l) => {
        rec(`bootout:${l}`)
        if (f.legacyRollbackOrder === true) return false
        // 🔴 반환값은 성공인데 상태는 그대로 — 실제로 겪는 모양이다
        if ((f.bootoutNoop ?? []).includes(l)) return true
        state.set(l, 'unloaded')
        return true
      },
      probeJob: (l) => ((f.probeUnknown ?? []).includes(l) ? 'unknown' : state.get(l)!),
      load: (l) => {
        rec(`load:${l}`); loads += 1
        if (f.loadFailAt === loads) return false
        applyEffect(l, f.loadEffect?.[l], 'loaded')
        return f.loadReturns?.[l] ?? true
      },

      checkout: (sha) => {
        rec(`checkout:${sha === PREV ? 'prev' : 'target'}`)
        if (f.checkout === true && sha === NEXT) return false
        w.sha = sha; return true
      },
      install: () => {
        w.installs += 1; rec('install')
        if (f.install === true && w.installs === 1) return false
        // 🔴 rollback 중 npm ci 가 죽어도 **뒤 단계를 계속 시도**해야 한다
        if (f.rollbackInstall === true && w.installs >= 2) return false
        w.deps = w.sha; return true
      },
      generate: () => { rec('generate'); return true },

      offlineGate: (g) => { rec(`gate:${g}`); return f.gateFail !== g },

      // ── 🔴 plist cutover ──
      readInstalledPlist: (l) => plists.get(l) ?? null,
      /**
       * 🔴 **target 을 받는다.** `renderFromOldRuntime` 이면 옛 작업트리를 읽는 회귀를 재현한다 —
       *    그때 새 job 은 템플릿이 없고, 옛 job 은 옛 인자가 나온다.
       */
      renderPlist: (target, l) => {
        rec(`render:${l}`)
        if ((f.renderFail ?? []).includes(l)) return null
        if (f.renderFromOldRuntime === true) {
          // 🔴 옛 runtime 에 없는 템플릿은 못 읽는다
          if ((f.missingInOldRuntime ?? []).includes(l)) return null
          return OLD_RENDERED(l)
        }
        // 🔴 target 에는 전부 있다 — 그것이 이 배포가 설치하려는 것이다
        return target === NEXT ? RENDERED(l) : OLD_RENDERED(l)
      },
      argsOf: (xml) => PARSE_ARGS(xml),
      // 🔴 설치본의 WorkingDirectory — fixture plist 는 runtime 을 가리킨다
      workingDirOf: () => (f.wdMismatch === true ? `${RTDIR}-other` : RTDIR),
      envBlockers: (jobs) => (f.envBlocked ?? [])
        .filter((l) => jobs.includes(l))
        .map((l) => ({ job: l, key: `SWITCH_${l}`, detail: `SWITCH_${l} 가 없다 (unset)` })),
      writePlist: (l, xml) => {
        rec(`write-plist:${l}`)
        // 🔴 rollback(옛 내용 복원)과 설치(새 내용)를 **따로** 실패시킬 수 있어야 한다
        const restoring = xml !== RENDERED(l)
        if (restoring && (f.restorePlistFail ?? []).includes(l)) return false
        if (!restoring && (f.plistWriteFail ?? []).includes(l)) return false
        plists.set(l, xml)
        return true
      },
      removePlist: (l) => {
        rec(`remove-plist:${l}`)
        if ((f.restorePlistFail ?? []).includes(l)) return false
        plists.delete(l); return true
      },
      retirePlist: (l) => {
        rec(`retire:${l}`)
        if ((f.retireFail ?? []).includes(l)) return false
        if ((f.retireNoop ?? []).includes(l)) return true
        const cur = plists.get(l)
        if (cur !== undefined) { w.retiredStore.set(l, cur); plists.delete(l) }
        return true
      },
      unretirePlist: (l) => {
        rec(`unretire:${l}`)
        const kept = w.retiredStore.get(l)
        if (kept === undefined) return true
        plists.set(l, kept); w.retiredStore.delete(l)
        return true
      },
      lintPlist: (l) => { rec(`lint:${l}`); return !(f.lintFail ?? []).includes(l) },
      // 🔴 실제 launchctl 출력 형태를 그대로 파싱한다
      /**
       * 🔴 **실제 launchctl 처럼 "지금 물고 있는" 설정을 돌려준다.**
       *
       *    launchd 는 load 시점의 plist 를 들고 있다. 그래서 fixture 도
       *    **현재 설치된 plist 에서** 인자를 뽑아야 한다 —
       *    항상 새 인자를 돌려주면 "plist 는 옛것인데 인자는 새것" 인 상태를 못 잡는다.
       */
      loadedConfig: (l) => {
        rec(`loaded-config:${l}`)
        const dev = (f.devPathJobs ?? []).includes(l)
        const base = parseLaunchctlPrint(printSample(l, `${dev ? DEVDIR : RTDIR}/scripts/${l}.mts`, RTDIR))
        if ((f.staleArgsJobs ?? []).includes(l)) {
          // 🔴 옛 인자로 도는 job 재현 — 경로만 보면 이것이 통과한다
          return { ...base, args: ['/nvm/bin/npx', 'tsx', `${RTDIR}/scripts/${l}.mts`, '--pages=1', '--max=10'] }
        }
        const xml = plists.get(l)
        return { ...base, args: xml === undefined ? [] : PARSE_ARGS(xml) }
      },
      isolationGate: () => { rec('isolation-gate'); return f.isolation !== true },

      readManifest: () => (existsSync(manifestFile) ? readFileSync(manifestFile, 'utf-8') : null),
      readPin: () => { try { return readFileSync(pinFile, 'utf-8').trim() } catch { return null } },
      writeManifest: (j) => { rec('write-manifest'); writeFileSync(manifestFile, j, 'utf-8'); return true },
      removeManifest: () => { rec('remove-manifest'); rmSync(manifestFile, { force: true }); return true },
      writePin: (sha) => { writeFileSync(pinFile, `${sha}\n`, 'utf-8'); return true },
      log: () => { /* fixture 는 조용히 */ },
    }
    return w
  }
  const deploy = async (
    w: World, disabledJobs: readonly string[] = [],
    quiesceJobs: readonly string[] = [QJOB],
  ): Promise<Awaited<ReturnType<typeof runDeploy>>> =>
    runDeploy({
      // 🔴 내려 둔 job 은 배포 대상에서 빠진다 — 실제 배포기가 넘기는 모양 그대로다
      target: NEXT, jobs: J.filter((l) => !disabledJobs.includes(l)),
      retiredJobs: RETIRED, disabledJobs, quiesceJobs, paths: PATHS,
      offlineGates: ['gate1', 'gate2'], now: () => '2026-09-09T00:00:00.000Z',
    }, w.fx)
  const idx = (w: World, m: string): number => w.order.findIndex((x) => x === m || x.startsWith(m))
  const countOf = (w: World, m: string): number => w.order.filter((x) => x === m).length
  const allLoaded = (w: World): boolean => J.every((l) => w.state.get(l) === 'loaded')
  const pinOf = (w: World): string => readFileSync(w.pinFile, 'utf-8').trim()
  const manifestSha = (w: World): string | null => {
    if (!existsSync(w.manifestFile)) return null
    try { return (JSON.parse(readFileSync(w.manifestFile, 'utf-8')) as { sha?: string }).sha ?? null } catch { return null }
  }


  // ─────────────────────────────────────────────────────────
  // 🔴 [P] plist cutover — **배포가 실제로 설치본을 바꾸는가**
  //
  //    2026-09-11 재현: 배포기는 기존 설치 plist 를 unload 하고 그대로 다시 load 했다.
  //    그래서 저장소의 새 템플릿이 설치본에 닿지 못했고, 네이버 job 은 배포를 몇 번 해도
  //    옛 `--pages=1 --max=10` 을 계속 돌았다. 새 job 은 영영 등록되지 않았다.
  //    아래는 그 결함이 되살아나면 **전부 빨개지는** 자리다.
  // ─────────────────────────────────────────────────────────
  {
    const w = makeWorld()
    const r = await deploy(w)
    check('🟢 [P] 정상 배포가 성공한다 (plist 설치 포함)', r.ok)
    check('🔴 [P] 예약 job 의 설치본이 **템플릿 render 결과로 바뀐다**',
      J.every((l) => w.plists.get(l) === RENDERED(l)))
    check('🔴 [P] 옛 설치본이 남아 있지 않다',
      J.every((l) => w.plists.get(l) !== OLD_PLIST(l)))
    // 🔴 순서: 설치는 게이트 뒤, load 앞이어야 한다 — 순서가 뒤집히면 옛 plist 로 올라간다
    check('🔴 [P] plist 설치가 offline 게이트 **뒤**, load **앞**이다',
      J.every((l) => idx(w, `write-plist:${l}`) > idx(w, 'gate:gate2')
        && idx(w, `write-plist:${l}`) < idx(w, 'load:job-a')))
    check('🔴 [P] plutil 검증이 설치 **직후**에 돈다',
      J.every((l) => idx(w, `lint:${l}`) > idx(w, `write-plist:${l}`)))
    check('🔴 [P] render 는 unload **앞**에서 한다 — 설치할 것이 없으면 job 을 내리지 않는다',
      J.every((l) => idx(w, `render:${l}`) < idx(w, 'unload:job-a')))
    // 🔴 퇴역 — unload 만으로는 재부팅 때 되살아난다. 파일이 그 자리에 없어야 한다
    check('🔴 [P] 퇴역 job 의 설치본이 사라진다', !w.plists.has('job-old'))
    check('🔴 [P] 퇴역 설치본은 **보관소로 옮겨진다** (지우지 않는다)',
      w.retiredStore.get('job-old') === OLD_PLIST('job-old'))
  }

  // ── [P-1] 🔴 **처음부터 설치본이 없던 job** — 첫 설치 ──
  {
    const w = makeWorld({ noInstalledPlist: ['job-b'], initial: { 'job-b': 'unloaded' } })
    const r = await deploy(w)
    check('🟢 [P-1] 설치본이 없던 job 도 배포가 설치한다', r.ok && w.plists.get('job-b') === RENDERED('job-b'))
    check('🔴 [P-1] 없던 job 을 내리려 하지 않는다 — unload 를 부르지 않는다', idx(w, 'unload:job-b') === -1)
    check('🟢 [P-1] 그 job 이 끝에는 올라와 있다', w.state.get('job-b') === 'loaded')
  }

  // ── [P-2] 🔴 템플릿을 render 하지 못하면 **job 을 내리기 전에** 멈춘다 ──
  {
    const w = makeWorld({ renderFail: ['job-c'] })
    const r = await deploy(w)
    check('🔴 [P-2] render 실패면 배포하지 않는다', !r.ok && r.phase === 'render')
    check('🔴 [P-2] job 을 하나도 내리지 않았다', idx(w, 'unload:job-a') === -1)
    check('🔴 [P-2] 설치본도 그대로다', J.every((l) => w.plists.get(l) === OLD_PLIST(l)))
    check('🔴 [P-2] SHA 도 그대로다', w.sha === PREV)
  }

  // ── [P-3] 🔴 설치 도중 실패 → **plist 원문까지 되돌린다** ──
  {
    const w = makeWorld({ plistWriteFail: ['job-c'] })
    const r = await deploy(w)
    check('🔴 [P-3] 설치 실패면 배포하지 않는다', !r.ok && r.phase === 'plist-install')
    check('🔴 [P-3] 이미 바꾼 설치본이 **옛 내용으로 복원된다**',
      J.every((l) => w.plists.get(l) === OLD_PLIST(l)))
    check('🔴 [P-3] SHA 가 이전으로 돌아간다', w.sha === PREV)
    check('🔴 [P-3] 예약 job 이 다시 올라온다', allLoaded(w))
    check('🟢 [P-3] 복구가 완전하다고 보고한다', r.rollback?.complete === true)
  }

  // ── [P-4] 🔴 plutil 이 거절하면 멈추고 되돌린다 ──
  {
    const w = makeWorld({ lintFail: ['job-b'] })
    const r = await deploy(w)
    check('🔴 [P-4] plutil 실패면 배포하지 않는다', !r.ok && r.phase === 'plist-lint')
    check('🔴 [P-4] 문법이 깨진 설치본을 남기지 않는다',
      J.every((l) => w.plists.get(l) === OLD_PLIST(l)))
    check('🔴 [P-4] 예약 job 이 다시 올라온다', allLoaded(w))
  }

  // ── [P-5] 🔴 **원래 없던 설치본은 되돌릴 때 지운다** ──
  {
    const w = makeWorld({ noInstalledPlist: ['job-b'], initial: { 'job-b': 'unloaded' }, isolation: true })
    const r = await deploy(w)
    check('🔴 [P-5] post-load 게이트 실패면 배포하지 않는다', !r.ok)
    check('🔴 [P-5] 원래 없던 설치본이 **지워진다** — 배포 안 했는데 파일이 남으면 안 된다',
      !w.plists.has('job-b'))
    check('🔴 [P-5] 원래 있던 것은 옛 내용으로 돌아간다',
      w.plists.get('job-a') === OLD_PLIST('job-a') && w.plists.get('job-c') === OLD_PLIST('job-c'))
    check('🔴 [P-5] 원래 내려가 있던 job 을 "복구" 한다며 올리지 않는다', w.state.get('job-b') === 'unloaded')
  }

  // ── [P-6] 🔴 **loaded 상태까지 원래대로** — 퇴역 job 이 원래 올라가 있었다면 되돌린다 ──
  {
    const w = makeWorld({ initial: { 'job-old': 'loaded' }, isolation: true })
    const r = await deploy(w)
    check('🔴 [P-6] 실패하면 퇴역 job 의 설치본도 되살린다',
      !r.ok && w.plists.get('job-old') === OLD_PLIST('job-old'))
    check('🔴 [P-6] 원래 loaded 였던 퇴역 job 이 다시 올라온다', w.state.get('job-old') === 'loaded')
  }

  // ── [P-7] 🔴 퇴역 job 이 돌고 있으면 **배포를 시작하지 않는다** ──
  {
    const w = makeWorld({ initial: { 'job-old': 'loaded' }, probeUnknown: ['job-old'] })
    const r = await deploy(w)
    check('🔴 [P-7] 퇴역 job 상태를 못 보면 시작하지 않는다(fail-closed)', !r.ok && r.phase === 'preflight')
    check('🔴 [P-7] 아무것도 건드리지 않았다',
      w.sha === PREV && J.every((l) => w.plists.get(l) === OLD_PLIST(l)))
  }

  // ── [P-8] 🔴 퇴역 이동이 실패하면 멈추고 되돌린다 ──
  {
    const w = makeWorld({ initial: { 'job-old': 'loaded' }, retireFail: ['job-old'] })
    const r = await deploy(w)
    check('🔴 [P-8] 퇴역 실패면 배포하지 않는다', !r.ok && r.phase === 'retire')
    check('🔴 [P-8] 예약 job 설치본이 옛 내용으로 돌아간다',
      J.every((l) => w.plists.get(l) === OLD_PLIST(l)))
  }

  // ── [P-9] 🔴 **옛 인자로 도는 job 을 잡는다** — 경로만 보면 통과한다 ──
  {
    const w = makeWorld({ staleArgsJobs: ['job-a'] })
    const r = await deploy(w)
    check('🔴 [P-9] loaded 인자가 템플릿과 다르면 실패한다', !r.ok && r.phase === 'post-load')
    check('🔴 [P-9] 이유에 ProgramArguments 가 적힌다',
      r.problems.some((x) => x.includes('ProgramArguments')))
    /**
     * 🔴 **대조군** — 인자를 대조하지 않으면 같은 상태가 통과한다.
     *    이 줄이 초록이어야 위 검사에 검증력이 있다는 뜻이다.
     */
    const loose = judgeLoadedConfig({
      label: 'job-a',
      loaded: { ...parseLaunchctlPrint(printSample('job-a', `${RTDIR}/scripts/job-a.mts`, RTDIR)),
        args: ['/nvm/bin/npx', 'tsx', `${RTDIR}/scripts/job-a.mts`, '--pages=1', '--max=10'] },
      runtimeRoot: RTDIR, devRoots: [DEVDIR],
    })
    check('🔴 인자를 안 보면 옛 인자 job 이 통과한다 — 그래서 대조가 필요하다', loose.ok)
  }

  // ── [P-10] 🔴 rollback 중 plist 복원이 실패해도 **뒤 단계를 계속 시도**한다 ──
  {
    const w = makeWorld({ isolation: true, restorePlistFail: ['job-b'] })
    const r = await deploy(w)
    check('🔴 [P-10] 복구가 완전하지 않다고 보고한다', !r.ok && r.rollback?.complete === false)
    check('🔴 [P-10] 남은 것에 그 job 이 적힌다',
      (r.rollback?.residual ?? []).some((x) => x.includes('job-b')))
    check('🔴 [P-10] 그래도 나머지 plist 는 복원했다',
      w.plists.get('job-a') === OLD_PLIST('job-a') && w.plists.get('job-c') === OLD_PLIST('job-c'))
    check('🔴 [P-10] 그래도 SHA 는 되돌렸다', w.sha === PREV)
    check('🔴 [P-10] 그래도 job 은 다시 올렸다', allLoaded(w))
  }


  // ─────────────────────────────────────────────────────────
  // 🔴 [T] **첫 cutover** — target commit 의 템플릿을 읽는가
  //
  //    2026-09-11 실측 재현: 배포기가 `RUNTIME_ROOT` **작업트리**에서 템플릿을 읽었다.
  //    그 시점 runtime 은 아직 옛 SHA(7049ddc)에 checkout 되어 있고, 거기에는
  //      · `supply-process` · `supply-collect-82cook-thin` 템플릿이 **없고**
  //      · 네이버 템플릿은 `micro-seed-collect-navercafe.mts --pages=1 --max=10` 이다.
  //    → 새 job 은 render 에서 멈추고, 네이버는 **옛 인자를 그대로 다시 설치**한다.
  //    **첫 cutover 가 구조적으로 불가능했다.**
  // ─────────────────────────────────────────────────────────
  {
    // 🔴 이전 runtime 에 **새 템플릿이 하나도 없다** — 첫 cutover 의 실제 상황
    const w = makeWorld({
      missingInOldRuntime: J,
      noInstalledPlist: ['job-b', 'job-c'],
      initial: { 'job-b': 'unloaded', 'job-c': 'unloaded' },
    })
    const r = await deploy(w)
    check('🟢 [T] 이전 runtime 에 새 템플릿이 0개여도 첫 cutover 가 성공한다', r.ok)
    check('🔴 [T] 설치본이 **target 템플릿** 결과다 (옛 작업트리 것이 아니다)',
      J.every((l) => w.plists.get(l) === RENDERED(l)))
    check('🔴 [T] 옛 인자가 설치되지 않았다',
      J.every((l) => w.plists.get(l) !== OLD_RENDERED(l)))
    check('🟢 [T] 원래 없던 job 도 설치되고 올라온다',
      w.plists.has('job-b') && w.state.get('job-b') === 'loaded'
      && w.plists.has('job-c') && w.state.get('job-c') === 'loaded')
  }

  /**
   * 🔴 **회귀 재주입** — 옛 runtime 작업트리를 읽도록 되돌리면 **이 fixture 가 실패해야 한다.**
   *    그래야 이 검사가 결함을 실제로 잡는다는 뜻이다.
   */
  {
    const w = makeWorld({ renderFromOldRuntime: true, missingInOldRuntime: J })
    const r = await deploy(w)
    check('🔴 [T-회귀] 옛 runtime 을 읽으면 첫 cutover 가 render 에서 멈춘다',
      !r.ok && r.phase === 'render')
    check('🔴 [T-회귀] 그때 job 을 하나도 내리지 않는다', idx(w, 'unload:job-a') === -1)
    check('🔴 [T-회귀] 이유에 target 이 적힌다',
      r.problems.some((x) => x.includes(NEXT.slice(0, 7))))
  }
  {
    /**
     * 🔴 **옛 runtime 에 템플릿이 있으면 post-load 대조로는 잡지 못한다** (2026-09-11 정정).
     *
     *    기대 인자(`expectedArgs`)는 **방금 render 한 그 문자열**에서 나온다.
     *    옛 템플릿을 render 해서 설치하면 설치한 것과 기대가 **같아지므로** 대조는 통과한다.
     *    앞선 fixture 는 `loadedConfig` 가 plist 와 무관하게 늘 새 인자를 돌려줘서
     *    이 검사가 **우연히** 초록이었다 — 허구였다.
     *
     *    🔴 그래서 **유일한 방어는 render 를 target commit 에서 하는 것**이다([T] 참조).
     *    아래는 그 사실 자체를 기록한다 — 다음 사람이 post-load 대조를 믿지 않도록.
     */
    const w = makeWorld({ renderFromOldRuntime: true })
    const r = await deploy(w)
    check('🔴 [T-회귀] 옛 템플릿이 설치되면 배포는 "성공" 으로 끝난다 — 대조로는 못 잡는다', r.ok)
    check('🔴 [T-회귀] 그때 설치본이 옛 인자다 (그래서 render 출처가 유일한 방어다)',
      J.every((l) => PARSE_ARGS(w.plists.get(l)!).join(' ') === OLD_ARGS_OF(l).join(' ')))
  }

  /** 🔴 render 와 기대 인자가 **같은 문자열 하나**에서 나온다 — 두 번 읽지 않는다 */
  {
    const w = makeWorld()
    const r = await deploy(w)
    check('🟢 [T] render 결과와 대조 기준이 같은 target 산출물이다', r.ok
      && J.every((l) => PARSE_ARGS(w.plists.get(l)!).join(' ') === ARGS_OF(l).join(' ')))
    const src = readFileSync('src/lib/runtime-deploy.ts', 'utf-8')
    check('🔴 대조 기준을 템플릿에서 **다시 읽지 않는다**',
      /expectedArgs: fx\.argsOf\(rendered\.get\(l\)!\)/.test(src)
      && !/expectedArgs: fx\.expectedArgs/.test(src))
    check('🔴 배포기가 target 을 넘겨 render 한다',
      /fx\.renderPlist\(input\.target, l\)/.test(src))
  }

  /** 🔴 실제 배포 도구가 **작업트리가 아니라 target commit** 에서 읽는지 소스로 본다 */
  {
    const tool = readFileSync('scripts/runtime-deploy.mts', 'utf-8')
    check('🔴 배포 도구가 git show <target>:<path> 로 읽는다',
      /read\('git', \['show', `\$\{target\}:\$\{templatePathOf\(label\)\}`\]\)/.test(tool))
    check('🔴 배포 도구가 RUNTIME_ROOT 의 템플릿 파일을 읽지 않는다',
      !/readFileSync\(\s*join\(RUNTIME_ROOT, templatePathOf/.test(tool))
    check('🔴 dry-run 계획도 target 템플릿으로 찍는다', /renderFromTarget\(planTarget, l\)/.test(tool))
  }

  // ─────────────────────────────────────────────────────────
  // 🔴 [E] 활성화 스위치 — **파일이 있는 것과 일하는 것은 다르다**
  //
  //    실측(runtime .env.local): SORAN_SUPPLY_PROCESS_ENABLED 가 **unset** 이다.
  //    plist 를 올려도 처리기는 매 회차 재고만 읽고 끝난다.
  // ─────────────────────────────────────────────────────────
  {
    const w = makeWorld({ envBlocked: ['job-c'] })
    const r = await deploy(w)
    check('🔴 [E] 스위치가 닫혀 있으면 배포하지 않는다', !r.ok && r.phase === 'preflight')
    check('🔴 [E] **job 을 내리기 전에** 막는다 — 되돌릴 것이 없다',
      idx(w, 'unload:job-a') === -1 && w.sha === PREV)
    check('🔴 [E] 설치본도 건드리지 않는다', J.every((l) => w.plists.get(l) === OLD_PLIST(l)))
    check('🔴 [E] 어떤 스위치인지 이름을 적는다', r.problems.some((x) => x.includes('SWITCH_job-c')))
    check('🔴 [E] env 를 고치라고만 하고 스스로 고치지 않는다',
      r.problems.some((x) => x.includes('배포가 env 를 고치지 않는다')))
  }
  {
    // 🔴 하나씩 빠뜨려도 전부 막힌다
    for (const l of J) {
      const w = makeWorld({ envBlocked: [l] })
      const r = await deploy(w)
      check(`🔴 [E] ${l} 스위치 하나만 없어도 배포하지 않는다`, !r.ok && r.phase === 'preflight')
    }
  }
  {
    const w = makeWorld({ envBlocked: [] })
    const r = await deploy(w)
    check('🟢 [E] 스위치가 전부 열려 있으면 통과한다', r.ok)
  }

  // ─────────────────────────────────────────────────────────
  // 🔴 [D] 의도적으로 내려 둔 job — **없는 것이 정상이다**
  //
  //    2026-09-14 실측: 82cook 두 job 을 수집 중단 결정에 따라 `false` 로 내려 두고
  //    unload 했다. 그런데 preflight 가 `RUNTIME_JOBS` 다섯 개 전부에 `true` 를
  //    요구해 `ENV_NOT_READY` 로 **배포가 막혔다** — 82cook 을 다시 켜는 것 말고는
  //    통과할 길이 없었다. 아래는 그 오판정이 되살아나면 전부 빨개지는 자리다.
  // ─────────────────────────────────────────────────────────
  {
    /** 🔴 job-c 를 "내려 둔 job" 으로 둔다 — 스위치 false + 이미 unloaded */
    const DIS = ['job-c']
    const ACT = J.filter((l) => !DIS.includes(l))

    // ① false + unloaded + plist 존재 → 배포는 통과하고 **설치본을 보관소로 옮긴다**
    {
      const w = makeWorld({ initial: { 'job-c': 'unloaded' }, envBlocked: DIS })
      const r = await deploy(w, DIS)
      check('🟢 [D] 내려 둔 job 이 unloaded 면 배포가 통과한다', r.ok)
      check('🔴 [D] 내려 둔 job 을 render 조차 하지 않는다', idx(w, 'render:job-c') === -1)
      check('🔴 [D] 내려 둔 job 을 설치하지 않는다',
        w.plists.get('job-c') !== RENDERED('job-c'))
      check('🔴 [D] 내려 둔 job 을 load 하지 않는다', idx(w, 'load:job-c') === -1)
      check('🔴 [D] 이미 내려가 있으면 bootout 하지 않는다', idx(w, 'bootout:job-c') === -1)
      check('🔴 [D] 내려 둔 job 을 unload 하지도 않는다', idx(w, 'unload:job-c') === -1)
      check('🔴 [D] 배포 뒤에도 내려 둔 job 은 unloaded 그대로다',
        w.state.get('job-c') === 'unloaded')
      /**
       * 🔴 **여기가 2026-09-16 실측 결함의 자리다.** 옛 판은 설치본을 그대로 두었고,
       *    로그인·재부팅 때 launchd 가 그 파일을 다시 등록해 job 이 되살아났다.
       */
      check('🔴 [D] 내려 둔 job 의 설치본이 LaunchAgents 에서 사라진다',
        !w.plists.has('job-c'))
      check('🔴 [D] 지우지 않고 보관소로 옮긴다 — 되돌릴 수 있다',
        w.retiredStore.get('job-c') === OLD_PLIST('job-c'))
      // 🔴 활성 job 의 기존 검증은 그대로여야 한다
      check('🔴 [D] 활성 job 은 전부 새 설치본으로 바뀐다',
        ACT.every((l) => w.plists.get(l) === RENDERED(l)))
      check('🔴 [D] 활성 job 은 전부 loaded 다',
        ACT.every((l) => w.state.get(l) === 'loaded'))
      check('🔴 [D] 활성 job 마다 lint 를 거친다',
        ACT.every((l) => idx(w, `lint:${l}`) !== -1))
      check('🔴 [D] offline 게이트는 그대로 돈다',
        idx(w, 'gate:gate1') !== -1 && idx(w, 'gate:gate2') !== -1)
      check('🔴 [D] 격리 게이트도 그대로 돈다', idx(w, 'isolation-gate') !== -1)
      check('🔴 [D] pin·manifest 는 target 으로 간다',
        pinOf(w) === NEXT && manifestSha(w) === NEXT)
    }

    // ② false + loaded + plist 존재 → bootout → unloaded 재확인 → 보관소 이동
    {
      const w = makeWorld({ initial: { 'job-c': 'loaded' }, envBlocked: DIS })
      const r = await deploy(w, DIS)
      check('🟢 [D] 되살아난 job 은 배포가 내리고 계속 간다', r.ok)
      check('🔴 [D] label 기반으로 내린다 — plist 경로에 기대지 않는다',
        idx(w, 'bootout:job-c') !== -1 && idx(w, 'unload:job-c') === -1)
      check('🔴 [D] 내린 뒤 **다시 관측**해서 unloaded 를 확인한다',
        w.state.get('job-c') === 'unloaded')
      check('🔴 [D] 되살아난 job 의 설치본도 보관소로 옮긴다',
        !w.plists.has('job-c') && w.retiredStore.get('job-c') === OLD_PLIST('job-c'))
      check('🔴 [D] 내리면서도 render·install·load 는 하지 않는다',
        idx(w, 'render:job-c') === -1 && idx(w, 'load:job-c') === -1
        && w.plists.get('job-c') !== RENDERED('job-c'))
      check('🔴 [D] 활성 job 은 영향받지 않는다',
        ACT.every((l) => w.state.get(l) === 'loaded' && w.plists.get(l) === RENDERED(l)))
    }

    // ③ false + unloaded + plist 없음 → 옮길 것이 없다. 그대로 통과한다
    {
      const w = makeWorld({
        initial: { 'job-c': 'unloaded' }, envBlocked: DIS, noInstalledPlist: ['job-c'],
      })
      const r = await deploy(w, DIS)
      check('🟢 [D] 내려 둠 + 설치본 없음이면 그대로 통과한다', r.ok)
      check('🔴 [D] 없는 설치본을 옮기려 들지 않는다', idx(w, 'retire:job-c') === -1)
      check('🔴 [D] 보관소에 없던 것을 만들어 넣지 않는다', !w.retiredStore.has('job-c'))
      check('🔴 [D] 그래도 job 은 unloaded 그대로다', w.state.get('job-c') === 'unloaded')
    }

    // ②-b bootout 을 보냈는데도 안 내려가면 **막는다** (fail-closed)
    {
      const w = makeWorld({
        initial: { 'job-c': 'loaded' }, envBlocked: DIS, bootoutNoop: ['job-c'],
      })
      const r = await deploy(w, DIS)
      check('🔴 [D] 내리려 했는데 그대로면 배포를 막는다', !r.ok)
      check('🔴 [D] preflight 에서 막는다 — 되돌릴 것이 없다', r.phase === 'preflight')
      check('🔴 [D] 이유를 DISABLED_JOB_LOADED 로 적는다',
        r.problems.some((x) => x.includes('DISABLED_JOB_LOADED')))
      check('🔴 [D] 명령 반환값이 아니라 **관측한 상태**로 판정한다',
        idx(w, 'bootout:job-c') !== -1 && w.state.get('job-c') === 'loaded')
      check('🔴 [D] 막을 때 코드도 건드리지 않는다 (checkout 0)',
        idx(w, 'checkout:target') === -1)
      check('🔴 [D] 막을 때 설치본을 옮기지 않는다 — 되돌릴 것을 늘리지 않는다',
        w.plists.has('job-c') && !w.retiredStore.has('job-c'))
    }

    /**
     * ⑦ 🔴 **다시 켜면 되돌아온다.** 스위치가 `true` 가 되면 `partitionJobsByEnv` 가
     *    active 로 넘기고, 배포가 **새 plist 를 render·설치·load** 한다.
     *    격리가 되돌릴 수 없는 길이면 그것은 격리가 아니라 폐기다.
     */
    {
      // 🔴 앞선 격리로 설치본이 보관소에 가 있는 상태 그대로에서 시작한다
      const w = makeWorld({ initial: { 'job-c': 'unloaded' }, noInstalledPlist: ['job-c'] })
      const r = await deploy(w, [])
      check('🟢 [D] 다시 켠 뒤 배포가 통과한다', r.ok)
      check('🔴 [D] 새 plist 를 render 한다', idx(w, 'render:job-c') !== -1)
      check('🔴 [D] 보관소의 옛 사본이 아니라 **새 설치본**이 들어간다',
        w.plists.get('job-c') === RENDERED('job-c'))
      check('🔴 [D] 문법 검증을 거친다', idx(w, 'lint:job-c') !== -1)
      check('🔴 [D] load 되어 loaded 가 된다',
        idx(w, 'load:job-c') !== -1 && w.state.get('job-c') === 'loaded')
      check('🔴 [D] 다시 켠 job 을 보관소로 옮기지 않는다', !w.retiredStore.has('job-c'))
    }

    /**
     * ⑧ 🔴 **rollback 이 내려 둔 job 을 되살리면 안 된다.**
     *    배포가 실패하면 활성 job 은 배포 전으로 돌아가야 하지만,
     *    내려 둔 job 까지 돌려놓으면 격리가 배포 실패 한 번에 풀린다.
     */
    {
      const w = makeWorld({ initial: { 'job-c': 'loaded' }, envBlocked: DIS, gateFail: 'gate2' })
      const r = await deploy(w, DIS)
      check('🔴 [D] 게이트 실패로 배포가 멈춘다', !r.ok && r.rollback?.attempted === true)
      check('🔴 [D] rollback 이 내려 둔 job 을 다시 올리지 않는다',
        w.state.get('job-c') === 'unloaded' && idx(w, 'load:job-c') === -1)
      check('🔴 [D] rollback 이 보관소의 사본을 제자리로 되돌리지 않는다',
        !w.plists.has('job-c'))
      check('🔴 [D] 활성 job 은 배포 전 설치본·상태로 돌아간다',
        ACT.every((l) => w.plists.get(l) === OLD_PLIST(l) && w.state.get(l) === 'loaded'))
      check('🔴 [D] 복구가 완전하다', r.rollback?.complete === true)
    }

    /**
     * 🔴 **"옮겼다" 는 말이 아니라 파일로 확인한다.** 배포 끝에 다시 읽어서
     *    아직 그 자리에 있으면 실패다 — 그대로 두면 다음 로그인에 되살아난다.
     */
    {
      const w = makeWorld({
        initial: { 'job-c': 'unloaded' }, envBlocked: DIS, retireNoop: ['job-c'],
      })
      const r = await deploy(w, DIS)
      check('🔴 [D] 옮겼다는 반환값만 믿지 않는다 — 파일이 남으면 실패다', !r.ok)
      check('🔴 [D] post-load 에서 잡는다', r.phase === 'post-load')
      check('🔴 [D] 되살아나는 이유를 적는다',
        r.problems.some((x) => x.includes('LaunchAgents') && x.includes('재부팅')))
    }

    // ③ 관측 불가는 통과시키지 않는다 (fail-closed)
    {
      const w = makeWorld({ initial: { 'job-c': 'unloaded' }, probeUnknown: ['job-c'], envBlocked: DIS })
      const r = await deploy(w, DIS)
      check('🔴 [D] 내려 둔 job 의 상태를 못 보면 통과시키지 않는다', !r.ok)
    }

    // ④ 판정부 — 정본 스위치 이름으로 82cook 만 갈린다
    {
      const env: Record<string, string> = {
        SORAN_NAVERCAFE_COLLECT_ENABLED: 'true',
        SORAN_SUPPLY_PROCESS_ENABLED: 'true',
        SORAN_82COOK_COLLECT_ENABLED: 'false',
        SORAN_82COOK_THIN_DETAIL_ENABLED: 'false',
      }
      const part = partitionJobsByEnv({ jobs: RUNTIME_JOBS, env })
      check('🔴 [D] 실측 env 에서 82cook 두 job 만 내려 둔 것으로 갈린다',
        part.disabled.length === 2
        && part.disabled.every((l) => l.includes('82cook'))
        && part.active.length === 3)
      check('🔴 [D] 내려 둔 job 을 뺀 나머지는 blocker 0 — 배포가 열린다',
        judgeJobEnv({ jobs: part.active, env }).length === 0)
      /** 🔴 `unset` 을 disabled 로 넘기면 "등록만 되고 공급 0" 이 초록이 된다 */
      const unset = { ...env }
      delete unset.SORAN_SUPPLY_PROCESS_ENABLED
      const p2 = partitionJobsByEnv({ jobs: RUNTIME_JOBS, env: unset })
      check('🔴 [D] unset 은 disabled 가 아니다 — 그대로 blocker 로 막힌다',
        p2.disabled.length === 2
        && judgeJobEnv({ jobs: p2.active, env: unset }).length === 1)
      check('🔴 [D] 빈 값도 disabled 가 아니다',
        partitionJobsByEnv({
          jobs: RUNTIME_JOBS, env: { ...env, SORAN_SUPPLY_PROCESS_ENABLED: '' },
        }).disabled.length === 2)
      check('🔴 [D] 오타(FALSEY)는 disabled 가 아니다',
        partitionJobsByEnv({
          jobs: RUNTIME_JOBS, env: { ...env, SORAN_SUPPLY_PROCESS_ENABLED: 'FALSEY' },
        }).disabled.length === 2)
      check('🔴 [D] 대소문자는 가리지 않는다 (False)',
        partitionJobsByEnv({
          jobs: RUNTIME_JOBS, env: { ...env, SORAN_SUPPLY_PROCESS_ENABLED: 'False' },
        }).disabled.length === 3)
      /** 🔴 격리 검사도 같은 계약이어야 한다 — 활성만 loaded 를 요구한다 */
      check('🔴 [D] 활성 3개만 loaded 면 격리 판정이 통과한다',
        judgeLoadedJobs({ loaded: part.active, expected: part.active }).ok)
      check('🔴 [D] 내려 둔 job 이 올라와 있으면 격리 판정이 막는다',
        !judgeLoadedJobs({
          loaded: [...part.active, part.disabled[0]!],
          expected: part.active, disabled: part.disabled,
        }).ok)
    /**
     * 🔴 **로그인·재부팅 재등장** (2026-09-16 실측).
     *    `false` 로 내리고 unload 했는데 이틀 뒤 두 job 이 다시 loaded 였다.
     *    원인은 `~/Library/LaunchAgents` 에 남은 설치 plist 다 —
     *    그 자리에 파일이 있으면 "내려 두었다" 는 다음 로그인까지만 참이다.
     */
    {
      const dis = ['com.soransoran.raw-collect-82cook', 'com.soransoran.supply-collect-82cook-thin']
      const files = dis.map((l) => `${l}.plist`)
      const alive = RUNTIME_JOBS.filter((l) => !dis.includes(l)).map((l) => `${l}.plist`)
      check('🟢 [D] 설치본이 보관소로 옮겨졌으면 통과한다',
        judgeDisabledPlists({ agentFiles: alive, rollbackFiles: files, disabled: dis }).ok)
      const back = judgeDisabledPlists({
        agentFiles: [...alive, files[0]!], rollbackFiles: files, disabled: dis,
      })
      check('🔴 [D] plist 가 LaunchAgents 에 재등장하면 격리가 막는다', !back.ok)
      check('🔴 [D] 어느 파일인지 이름으로 적는다',
        back.problems.some((x) => x.includes(files[0]!)))
      check('🔴 [D] 보관본이 없으면 되돌릴 수 없다고 적는다',
        !judgeDisabledPlists({ agentFiles: alive, rollbackFiles: [], disabled: dis }).ok)
      check('🔴 [D] 보관소를 못 읽으면 잔존 여부만 본다',
        judgeDisabledPlists({ agentFiles: alive, disabled: dis }).ok)
      /** 🔴 스위치가 다시 `true` 가 되면 대상에서 저절로 빠진다 — 이름을 박지 않았다 */
      check('🔴 [D] disabled 가 비면 검사할 것이 없다',
        judgeDisabledPlists({ agentFiles: [...alive, ...files], disabled: [] }).ok)
    }

    /** 🔴 특정 job 이름을 판정부에 박지 않았다 — 대상은 언제나 `disabled` 집합이다 */
    {
      const iso = readFileSync('src/lib/runtime-isolation.ts', 'utf-8')
      const dep = readFileSync('src/lib/runtime-deploy.ts', 'utf-8')
      /**
       * 🔴 이름이 **명부와 스위치 표**에 있는 것은 정상이다 — 거기가 정본이다.
       *    막아야 하는 것은 **격리 로직이 특정 label 로 분기하는 것**이다.
       */
      const noLabel = (src: string, from: string, to: string): boolean =>
        !/82cook|navercafe|supply-process/.test(src.slice(src.indexOf(from), src.indexOf(to)))
      check('🔴 [D] 내려 둔 job 판정부가 label 로 분기하지 않는다',
        noLabel(iso, 'export function judgeDisabledPlists', 'function judgeLeftoverPlists'))
      check('🔴 [D] 공통 잔존 plist 판정부도 label 로 분기하지 않는다',
        noLabel(iso, 'function judgeLeftoverPlists', 'export type PathVerdict'))
      check('🔴 [D] 배포기의 내려 둔 job 격리 구간이 label 로 분기하지 않는다',
        noLabel(dep, 'const disabledLoaded: string[] = []', 'const gate = judgeDeploy(')
        && noLabel(dep, '  for (const l of disabled) {\n    if (fx.readInstalledPlist(l) === null)', "steps.push('retire-verified')"))
      check('🔴 [D] 배포 판정부 전체에 실행되는 82cook 분기가 없다',
        !/if\s*\([^)]*82cook/.test(dep) && !/includes\('com\.soransoran\./.test(dep))
      check('🔴 [D] 내려 둔 job 판정은 `disabled` 를 인자로 받는다',
        /judgeDisabledPlists\(input: \{[\s\S]{0,400}?disabled: readonly string\[\]/.test(iso))
    }

      check('🔴 [D] 내려 둔 job 이 빠져 있는 것은 실패가 아니다',
        judgeLoadedJobs({ loaded: part.active, expected: part.active, disabled: part.disabled }).ok)
    }

    // ⑤ 🔴 배포 전체에서 **82cook 쪽으로 나가는 요청이 0** 이다
    {
      const w = makeWorld({ initial: { 'job-c': 'unloaded' }, envBlocked: DIS })
      const r = await deploy(w, DIS)
      check('🟢 [D] 배포는 성공하고', r.ok)
      /**
       * 🔴 **격리 말고는 아무것도 하지 않는다.** 실행 기록에 남아도 되는 것은
       *    내리기(`bootout`)와 설치본 옮기기(`retire`) 둘뿐이다 —
       *    render·install·load·unload 는 하나도 없어야 한다.
       */
      check('🔴 [D] 실행 기록에 내려 둔 job 의 render·install·load 가 0 이다',
        w.order.every((x) => !/^(render|load|write-plist|lint|unload):job-c$/.test(x)))
      check('🔴 [D] 남는 것은 격리 흔적뿐이다',
        w.order.filter((x) => x.endsWith(':job-c'))
          .every((x) => x.startsWith('bootout:') || x.startsWith('retire:')))
    }
  }

  /** 🔴 판정부 — `unset` 과 `false` 를 구분해 적는다. 다음에 할 일이 다르다 */
  {
    const JOBS5 = [...RUNTIME_JOBS]
    const full: Record<string, string> = {}
    for (const l of JOBS5) {
      const k = JOB_ENV_REQUIREMENTS[l]
      if (k !== undefined) full[k] = 'true'
    }
    check('🟢 [E] 5개 job 의 스위치가 전부 true 면 blocker 0',
      judgeJobEnv({ jobs: JOBS5, env: full }).length === 0)
    /** 🔴 실측 상태 그대로 — 처리기 스위치만 unset */
    const measured = { ...full }
    delete measured.SORAN_SUPPLY_PROCESS_ENABLED
    const b = judgeJobEnv({ jobs: JOBS5, env: measured })
    check('🔴 [E] 실측(.env.local)에서 처리기 스위치가 blocker 로 잡힌다',
      b.length === 1 && b[0]!.key === 'SORAN_SUPPLY_PROCESS_ENABLED')
    check('🔴 [E] unset 이라고 적는다', b[0]!.detail.includes('unset'))
    const off = { ...full, SORAN_SUPPLY_PROCESS_ENABLED: 'false' }
    const b2 = judgeJobEnv({ jobs: JOBS5, env: off })
    check('🔴 [E] false 는 unset 과 다르게 적는다',
      b2.length === 1 && b2[0]!.detail.includes('false') && !b2[0]!.detail.includes('unset'))
    check('🔴 [E] 빈 값도 막는다',
      judgeJobEnv({ jobs: JOBS5, env: { ...full, SORAN_SUPPLY_PROCESS_ENABLED: '' } }).length === 1)
    check('🔴 [E] 같은 스위치를 쓰는 두 job 은 한 줄로만 적는다', (() => {
      const noNaver = { ...full }
      delete noNaver.SORAN_NAVERCAFE_COLLECT_ENABLED
      return judgeJobEnv({ jobs: JOBS5, env: noNaver }).length === 1
    })())
    check('🔴 [E] 5개 job 전부 필요한 스위치가 정의돼 있다',
      JOBS5.every((l) => JOB_ENV_REQUIREMENTS[l] !== undefined))
    /** 🔴 퇴역 job 의 스위치는 요구하지 않는다 — 그 job 은 없어질 것이다 */
    check('🔴 [E] 퇴역 job 의 스위치를 요구하지 않는다',
      !Object.values(JOB_ENV_REQUIREMENTS).includes('SORAN_SUPPLY_AUTOPILOT_ENABLED'))
  }


  // ─────────────────────────────────────────────────────────
  // 🔴 [Q] **배포 동안만 멈추는 발행 러너** — 사람이 예약 시각을 피해 기다리던 병목
  //
  //    2026-09-20 실측: `com.soransoran.original-post-runner` 는 공급 job 이 아니지만
  //    같은 runtime 작업 트리에서 돈다. 그런데 배포의 관측·정지·복구 어디에도 없어,
  //    16:10 발행 슬롯이 checkout·npm ci 중에 뜨면 **반쯤 바뀐 트리**를 읽을 수 있었다.
  //    그때는 사람이 시각을 보고 기다려서 피했다.
  //
  //    🔴 배포가 이 job 에 하는 일은 **잠시 내렸다 그대로 되올리는 것뿐**이다 —
  //       render ✗ · write ✗ · retire ✗ · env 판정 ✗.
  // ─────────────────────────────────────────────────────────
  {
    // ── ① 돌고 있으면 아무것도 건드리지 않고 멈춘다 ──
    {
      const w = makeWorld({ running: [QJOB] })
      const r = await deploy(w)
      check('🔴 [Q] 발행 러너가 돌고 있으면 배포하지 않는다', !r.ok && r.phase === 'preflight')
      check('🔴 [Q] 🔴 **write 0** — plist 를 건드리지 않았다', countOf(w, `write-plist:${QJOB}`) === 0)
      check('🔴 [Q] 🔴 **unload 0** — 돌고 있는 회차를 자르지 않았다',
        idx(w, `unload:${QJOB}`) === -1 && !r.steps.includes(`quiesce-unload:${QJOB}`))
      check('🔴 [Q] 🔴 **checkout 0** — 코드도 그대로다', idx(w, 'checkout:target') === -1)
      check('🔴 [Q] 발행 러너는 그대로 loaded 다', w.state.get(QJOB) === 'loaded')
    }

    // ── ② loaded 지만 idle 이면 checkout 전에 내리고, 성공 후 되올린다 ──
    {
      const w = makeWorld()
      const r = await deploy(w)
      check('🟢 [Q] 정상 배포가 통과한다', r.ok, )
      check('🔴 [Q] 🔴 **checkout 전에 내려간다**',
        r.steps.includes(`quiesce-unload:${QJOB}`)
        && idx(w, `unload:${QJOB}`) !== -1
        && idx(w, `unload:${QJOB}`) < idx(w, 'checkout:target'))
      check('🔴 [Q] 🔴 **성공 뒤 다시 올라온다**', w.state.get(QJOB) === 'loaded')
      check('🔴 [Q] 되올린 단계가 기록에 남는다', r.steps.includes('quiesce-restored'))
      check('🔴 [Q] 🔴 **성공 배포에서도 plist 를 render·write 하지 않는다**',
        countOf(w, `render:${QJOB}`) === 0 && countOf(w, `write-plist:${QJOB}`) === 0)
      check('🔴 [Q] 🔴 **퇴역시키지도 않는다**',
        countOf(w, `retire:${QJOB}`) === 0 && countOf(w, `remove-plist:${QJOB}`) === 0)
      check('🔴 [Q] 🔴 **plist 원문이 배포 전과 같다**', w.plists.get(QJOB) === OLD_PLIST(QJOB))
      check('🔴 [Q] 🔴 **되올린 인자가 설치본과 같다**',
        sameArgs(PARSE_ARGS(w.plists.get(QJOB)!), w.fx.loadedConfig(QJOB).args))
      check('🔴 [Q] 🔴 **WorkingDirectory 가 runtime 을 가리킨다**',
        w.fx.loadedConfig(QJOB).workingDirectory === RTDIR)
    }

    // ── ③ 원래 내려가 있었으면 끝까지 내려가 있다 ──
    {
      const w = makeWorld({ initial: { [QJOB]: 'unloaded' } })
      const r = await deploy(w)
      check('🟢 [Q] 원래 내려가 있어도 배포는 통과한다', r.ok)
      check('🔴 [Q] 🔴 **내리지도 올리지도 않는다**',
        idx(w, `unload:${QJOB}`) === -1 && idx(w, `load:${QJOB}`) === -1
        && !r.steps.includes(`quiesce-unload:${QJOB}`))
      check('🔴 [Q] 🔴 **끝까지 unloaded 다** — 배포가 운영 상태를 바꾸지 않는다',
        w.state.get(QJOB) === 'unloaded')
    }

    // ── ④ unload 가 안 되면 checkout 0 ──
    {
      const w = makeWorld({ unloadEffect: { [QJOB]: 'keep' } })
      const r = await deploy(w)
      check('🔴 [Q] 🔴 **내려가지 않으면 배포하지 않는다**', !r.ok && r.phase === 'unload')
      check('🔴 [Q] 🔴 **checkout 0 · write 0**',
        idx(w, 'checkout:target') === -1 && countOf(w, `write-plist:${QJOB}`) === 0)
      check('🔴 [Q] 원래 loaded 였던 것은 되돌아온다', w.state.get(QJOB) === 'loaded')
    }
    {
      const w = makeWorld({ probeUnknown: [QJOB] })
      const r = await deploy(w)
      check('🔴 [Q] 🔴 **상태를 모르면 통과시키지 않는다(fail-closed)**',
        !r.ok && idx(w, 'checkout:target') === -1)
    }

    // ── ⑤ preflight 와 unload 사이에 시작한 회차 — checkout 직전에 잡는다 ──
    {
      const w = makeWorld({ runningLater: [QJOB] })
      const r = await deploy(w)
      check('🔴 [Q] 🔴 **checkout 직전 재관측이 그 틈을 잡는다**',
        !r.ok && r.phase === 'pre-checkout-recheck', )
      check('🔴 [Q] 🔴 **그때도 checkout 0 · write 0**',
        idx(w, 'checkout:target') === -1 && countOf(w, `write-plist:${QJOB}`) === 0)
      check('🔴 [Q] 재관측 실패 뒤 원래 loaded 상태로 돌아온다', w.state.get(QJOB) === 'loaded')
    }
    {
      const w = makeWorld({ runningUnknownLater: [QJOB] })
      const r = await deploy(w)
      check('🔴 [Q] 재관측에서 알 수 없으면 멈춘다(fail-closed)',
        !r.ok && r.phase === 'pre-checkout-recheck' && idx(w, 'checkout:target') === -1)
    }

    // ── ⑥ 실패하면 loaded 상태와 plist 원문이 배포 전으로 ──
    for (const [name, fault] of [
      ['checkout 실패', { checkout: true }],
      ['offline 게이트 실패', { gateFail: 'gate2' }],
    ] as const) {
      const w = makeWorld(fault)
      const r = await deploy(w)
      check(`🔴 [Q] ${name} 이면 배포가 멈춘다`, !r.ok)
      check(`🔴 [Q] 🔴 **${name} 뒤 발행 러너가 원래대로 loaded 다**`,
        w.state.get(QJOB) === 'loaded', )
      check(`🔴 [Q] ${name} 뒤에도 plist 원문이 그대로다`, w.plists.get(QJOB) === OLD_PLIST(QJOB))
      check(`🔴 [Q] ${name} 복구가 완전하다`, r.rollback?.complete === true,
      )
    }

    // ── ⑦ 되올렸는데 설정이 설치본과 다르면 성공으로 보고하지 않는다 ──
    {
      const w = makeWorld({ wdMismatch: true })
      const r = await deploy(w)
      check('🔴 [Q] 🔴 **WorkingDirectory 가 설치본과 다르면 실패다**',
        !r.ok && r.phase === 'quiesce-restore')
    }

    // ── ⑧ 공급 job 계약은 그대로다 ──
    check('🔴 [Q] 🔴 **발행 러너를 RUNTIME_JOBS 에 넣지 않았다**',
      !RUNTIME_JOBS.includes(PUBLISH_RUNNER_LABEL) && RUNTIME_JOBS.length === 5)
    check('🔴 [Q] 🔴 **퇴역 job 으로 취급하지 않는다**', !RETIRED_JOBS.includes(PUBLISH_RUNNER_LABEL))
    check('🔴 [Q] 🔴 **활성화 스위치를 요구하지 않는다**',
      !Object.keys(JOB_ENV_REQUIREMENTS).includes(PUBLISH_RUNNER_LABEL))
    check('🔴 [Q] 🔴 **label 을 새로 적지 않고 정본을 쓴다**', (() => {
      const src = readFileSync('scripts/runtime-deploy.mts', 'utf-8')
      return /import \{ PUBLISH_RUNNER_LABEL \}/.test(src)
        && /QUIESCE_JOBS: readonly string\[\] = \[PUBLISH_RUNNER_LABEL\]/.test(src)
        && !/'com\.soransoran\.original-post-runner'/.test(src)
    })())
    check('🔴 [Q] 🔴 **매거진 job 은 대상이 아니다** — 다른 runtime 을 쓴다', (() => {
      const src = readFileSync('scripts/runtime-deploy.mts', 'utf-8')
      return !/magazine/.test(src)
    })())
  }


  // ─────────────────────────────────────────────────────────
  // 🔴 [R] **PR #501 배포를 막은 두 결함** — 실제 실패를 그대로 재현한다
  //
  //    2026-09-11 실측: 배포가 loaded-paths 까지 전부 통과하고 마지막
  //    `isolation-gate` 한 줄에서 멈췄다(266 pass · 1 fail).
  //      · 결함 ① 보관소 이름이 두 벌 — 배포기는 옮겼는데 검사는 다른 폴더를 봤다
  //      · 결함 ② rollback 이 plist 를 먼저 지우고 unload 해서 새 job 3개가 남았다
  // ─────────────────────────────────────────────────────────

  /**
   * 🔴 ① 보관소 경로는 **한 곳에서만** 나온다.
   *
   *    🔴 검사 대상은 **운영 코드**다(배포기 · 정본 모듈). 이 fixture 자신은 제외한다 —
   *    결함을 설명하려면 그 문자열을 써야 하고, 그것까지 금지하면 왜 고쳤는지 남길 수 없다.
   */
  {
    const deploy = readFileSync('scripts/runtime-deploy.mts', 'utf-8')
    const lib = readFileSync('scripts/lib/launchd-install.mts', 'utf-8')
    /** 🔴 이름의 정본은 상수 선언 한 줄뿐이다 */
    check('🔴 [R-1] 보관소 이름이 정본 모듈에 상수로 한 번만 선언된다',
      (lib.match(/export const ROLLBACK_DIR_NAME = '[a-z-]+'/g) ?? []).length === 1)
    check('🔴 [R-1] 배포기가 보관소 이름을 스스로 적지 않는다',
      !/['"]launchd-rollback['"]|['"]launchagents-rollback['"]/.test(deploy))
    check('🔴 [R-1] 배포기가 정본 함수를 쓴다', /rollbackDirOf\(CANON_DIR\)/.test(deploy))
    /** 🔴 **같은 함수에서 나오므로 값이 갈라질 수 없다** — 그것이 이 수정의 전부다 */
    check('🔴 [R-1] 배포기와 격리 검사가 같은 정본 함수를 import 한다', (() => {
      const isol = readFileSync('scripts/runtime-isolation-check.mts', 'utf-8')
      const imported = (src: string): boolean =>
        /import \{[^}]*rollbackDirOf[^}]*\} from '\.\/lib\/launchd-install\.mjs'/.test(src)
      return imported(deploy) && imported(isol) && /rollbackDirOf\(CANON_DIR\)/.test(isol)
    })())
    /**
     * 🔴 옛 이름이 **실행되는 코드**에 남아 있지 않다 — 남으면 다음 사람이 그걸 쓴다.
     *    🔴 주석은 뺀다. 왜 바뀌었는지 적으려면 그 이름을 써야 하고,
     *    그것까지 금지하면 다음 사람이 같은 실수를 반복한다.
     */
    const codeOnly = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    check('🔴 [R-1] 옛 이름(launchagents-rollback)이 실행 코드에 0건이다',
      !codeOnly(deploy).includes('launchagents-rollback')
      && !codeOnly(lib).includes('launchagents-rollback'))
  }

  /**
   * 🔴 ② **실제 실패 시나리오 그대로.**
   *
   *    이전: 네이버 2개 + supply-autopilot loaded (새 3개는 plist 도 없다)
   *    배포: 새 5개 설치·load · supply-autopilot 퇴역
   *    실패: isolation-gate
   *    복구: 네이버 2개 + supply-autopilot 만 **옛 인자로** loaded ·
   *          새 3개는 unloaded 이고 plist 도 없다 · SHA·pin·manifest·plist bytes 원복
   */
  {
    const w = makeWorld({
      isolation: true,
      // 🔴 새 job 3개는 배포 전에 plist 도 없고 내려가 있었다
      noInstalledPlist: ['job-b', 'job-c'],
      initial: { 'job-b': 'unloaded', 'job-c': 'unloaded', 'job-old': 'loaded' },
    })
    const r = await deploy(w)
    check('🔴 [R-2] isolation-gate 실패로 배포하지 않는다', !r.ok && r.phase === 'post-load')

    // ── 복구 결과 ──
    check('🔴 [R-2] 배포 중 올린 새 job 이 전부 내려간다',
      w.state.get('job-b') === 'unloaded' && w.state.get('job-c') === 'unloaded')
    check('🔴 [R-2] 원래 없던 plist 가 남지 않는다',
      !w.plists.has('job-b') && !w.plists.has('job-c'))
    check('🔴 [R-2] 배포 전 loaded 였던 job 만 다시 올라온다',
      w.state.get('job-a') === 'loaded' && w.state.get('job-old') === 'loaded')
    check('🔴 [R-2] 그 job 들이 **옛 plist 원문**으로 돌아온다',
      w.plists.get('job-a') === OLD_PLIST('job-a')
      && w.plists.get('job-old') === OLD_PLIST('job-old'))
    check('🔴 [R-2] 퇴역했던 plist 가 보관소에서 제자리로 돌아온다', !w.retiredStore.has('job-old'))
    check('🔴 [R-2] SHA · pin · manifest 가 배포 전 값이다',
      w.sha === PREV && pinOf(w) === PREV && manifestSha(w) === PREV)
    check('🟢 [R-2] 복구가 완전하다고 보고한다', r.rollback?.complete === true)

    /**
     * 🔴 **순서를 값으로 못박는다.** 정지가 **가장 먼저**, 그 다음 파일 복원, 그 다음 load.
     *    "plist 를 먼저 지우고 unload" 로 되돌아가면 여기가 깨진다.
     */
    // 🔴 `steps` 는 runDeploy 가 남긴 단계 이름이다 — 순서를 값으로 본다
    const st = (m: string): number => r.steps.findIndex((x) => x === m || x.startsWith(m))
    const iStop = st('rollback:stop')
    const iPlist = st('rollback:plist')
    const iLoad = st('rollback:load')
    if (iStop < 0 || iPlist < 0 || iLoad < 0) console.log(`      steps: ${r.steps.join(' → ')}`)
    check('🔴 [R-2] 정지가 plist 복원보다 **먼저**다', iStop >= 0 && iStop < iPlist)
    check('🔴 [R-2] plist 복원이 load 보다 **먼저**다', iPlist >= 0 && iLoad >= 0 && iPlist < iLoad)
    check('🔴 [R-2] 정지는 label 기반 bootout 으로 한다 — plist 경로에 의존하지 않는다',
      w.order.some((x) => x.startsWith('bootout:')))
    if (r.rollback?.complete !== true) {
      console.log(`      residual: ${(r.rollback?.residual ?? []).join(' / ')}`)
    }
  }

  /**
   * 🔴 **실패 재주입** — 옛 순서로 되돌리면 이 fixture 가 깨진다는 것을 증명한다.
   *    plist 를 먼저 지우면 `launchctl unload <없는 파일>` 이 실패하고 job 이 남는다.
   */
  {
    const w = makeWorld({
      isolation: true,
      noInstalledPlist: ['job-b', 'job-c'],
      initial: { 'job-b': 'unloaded', 'job-c': 'unloaded', 'job-old': 'loaded' },
      legacyRollbackOrder: true,
    })
    const r = await deploy(w)
    check('🔴 [R-3] label 기반 정지가 없으면 복구가 불완전하다고 보고한다',
      r.rollback?.complete === false)
    check('🔴 [R-3] 그때 새 job 이 loaded 로 남는다',
      w.state.get('job-b') === 'loaded' || w.state.get('job-c') === 'loaded')
    check('🔴 [R-3] residual 이 "정지하지 못했다" 를 정확히 적는다',
      (r.rollback?.residual ?? []).some((x) => x.includes('정지하지 못했다')))
  }

  // ── [A] 정상 배포 ──
  {
    const w = makeWorld()
    const r = await deploy(w)
    check('🟢 [A] 정상 배포가 성공한다', r.ok)
    // 🔴 실제로 부른 명령의 순서로 본다 — 상태 머신이 적어 준 이름이 아니라
    check('🔴 [A] 예약 job unload 가 checkout 보다 **먼저** 끝난다',
      J.every((l) => idx(w, `unload:${l}`) >= 0 && idx(w, `unload:${l}`) < idx(w, 'checkout')))
    check('🔴 [A] offline 게이트는 job 이 내려간 뒤·load 앞에서 돈다',
      idx(w, 'gate:gate1') > idx(w, 'unload:job-c') && idx(w, 'gate:gate2') < idx(w, 'load:job-a'))
    /**
     * 🔴 **이게 첫 판이 구조적으로 실패한 자리다.**
     *    `runtime:isolation-check --require-runtime` 은 예약 job 이 전부 loaded 여야 통과한다.
     *    그런데 옛 순서는 job 을 내려 둔 채 그것을 돌렸다 — 정상 배포가 항상 실패했다.
     */
    check('🔴 [A] 격리 검사는 job 을 **다시 올린 뒤에** 돈다',
      idx(w, 'isolation-gate') > idx(w, 'load:job-c'))
    check('🔴 [A] 실제 loaded 설정 대조가 격리 검사보다 앞에 있다',
      idx(w, 'loaded-config') > 0 && idx(w, 'loaded-config') < idx(w, 'isolation-gate'))
    check('🔴 [A] 끝난 뒤 예약 job 이 모두 올라와 있다', allLoaded(w))
    check('🔴 [A] SHA·의존성·manifest·pin 이 새 것이다',
      w.sha === NEXT && w.deps === NEXT && manifestSha(w) === NEXT && pinOf(w) === NEXT)
  }

  // ── [B] fetch 실패 ──
  {
    const w = makeWorld({ fetch: true })
    const r = await deploy(w)
    check('🔴 [B] fetch 가 실패하면 배포하지 않는다', !r.ok && r.phase === 'preflight')
    check('🔴 [B] unload 도 checkout 도 하지 않는다',
      idx(w, 'unload') === -1 && idx(w, 'checkout') === -1)
    check('🔴 [B] 예약 job 이 그대로 올라와 있고 SHA·manifest 도 그대로다',
      allLoaded(w) && w.sha === PREV && manifestSha(w) === PREV)
  }

  /**
   * ── [C-old] 두 번째 unload 실패 (반환값·실제 상태가 함께 실패) ──
   */
  {
    const w = makeWorld({ unloadReturns: { 'job-b': false }, unloadEffect: { 'job-b': 'keep' } })
    const r = await deploy(w)
    check('🔴 [C] unload 하나가 실패하면 배포하지 않는다', !r.ok && r.phase === 'unload')
    check('🔴 [C] 코드는 건드리지 않는다 (checkout 0)', idx(w, 'checkout') === -1)
    check('🔴 [C] 이미 내린 job 을 **다시 올린다** — 전부 올라와 있다', allLoaded(w))
    check('🔴 [C] SHA·의존성은 직전 그대로다', w.sha === PREV && w.deps === PREV)
  }

  // ── [D] offline 게이트 실패 ──
  {
    const w = makeWorld({ gateFail: 'gate2' })
    const r = await deploy(w)
    check('🔴 [D] 게이트가 실패하면 배포하지 않는다', !r.ok && r.phase === 'offline-gate')
    check('🔴 [D] 직전 SHA·의존성으로 되돌아간다', w.sha === PREV && w.deps === PREV)
    check('🔴 [D] 직전 manifest·pin 이 복원된다', manifestSha(w) === PREV && pinOf(w) === PREV)
    check('🔴 [D] 예약 job 이 다시 올라온다', allLoaded(w))
    check('🔴 [D] 복구가 완전하다고 보고한다', r.rollback?.complete === true)
  }

  // ── [E] load 실패 ──
  {
    const w = makeWorld({ loadFailAt: 2 })
    const r = await deploy(w)
    check('🔴 [E] load 가 실패하면 배포 완료가 아니다', !r.ok && r.phase === 'load')
    check('🔴 [E] 되돌린 뒤 직전 예약 job 이 올라와 있다', allLoaded(w))
    check('🔴 [E] SHA·manifest 가 직전 것이다', w.sha === PREV && manifestSha(w) === PREV)
  }

  // ── [F] rollback 중 npm ci 실패 ──
  {
    const w = makeWorld({ gateFail: 'gate1', rollbackInstall: true })
    const r = await deploy(w)
    check('🔴 [F] 되돌리다 npm ci 가 죽어도 **뒤 단계를 계속 시도한다**',
      idx(w, 'generate') > idx(w, 'install') && r.rollback?.attempted === true)
    check('🔴 [F] manifest 복원과 job 재load 까지 간다', manifestSha(w) === PREV && allLoaded(w))
    check('🔴 [F] 그래도 "완전히 복구했다" 고 말하지 않는다', r.rollback?.complete === false)
    check('🔴 [F] 무엇이 남았는지 그대로 적는다',
      (r.rollback?.residual ?? []).some((x) => x.includes('npm ci')))
  }

  // ── [G] 직전 manifest 가 없었다 ──
  {
    /**
     * 🔴 **새 manifest 를 이미 쓴 뒤에 실패해야** 이 보호장치가 시험된다.
     *    게이트 단계에서 실패시키면 manifest 를 쓰기 전이라 아무것도 증명하지 못한다.
     */
    const w = makeWorld({ noPrevManifest: true, loadFailAt: 1 })
    const r = await deploy(w)
    check('🔴 [G] 새 manifest 를 쓴 뒤 실패했다', !r.ok && idx(w, 'write-manifest') >= 0)
    check('🔴 [G] 원래 manifest 가 없었으면 되돌린 뒤에도 **없다**', !existsSync(w.manifestFile))
    check('🔴 [G] 배포하지 않았는데 새 manifest 가 남지 않는다', manifestSha(w) === null)
    check('🔴 [G] 그래도 예약 job 은 다시 올라온다', allLoaded(w))
    const w2 = makeWorld({ noPrevManifest: true, gateFail: 'gate1' })
    await deploy(w2)
    check('🔴 [G] 게이트 단계에서 실패해도 manifest 는 생기지 않는다', !existsSync(w2.manifestFile))
  }

  // ── [H] 배포 두 개가 겹친다 · 잠금 소유권 ──
  {
    const dir = mkdtempSync(join(tmpdir(), 'soran-deploy-lock-'))
    worlds.push(dir)
    const lockFile = join(dir, 'runtime-deploy.lock')
    const tryLock = (token: string): { ok: boolean; reason: string } => {
      try {
        const fd = openSync(lockFile, 'wx', 0o600)
        try { writeSync(fd, `${token}\n1 iso\n`) } finally { closeSync(fd) }
        return judgeDeployLock({ acquired: true })
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        return judgeDeployLock({ acquired: false, unknown: code !== 'EEXIST' })
      }
    }
    const readToken = (): string | null => {
      try { return readFileSync(lockFile, 'utf-8').split('\n')[0]!.trim() } catch { return null }
    }
    check('🟢 [H] 먼저 온 배포가 잠금을 잡는다', tryLock('tok-1').ok)
    const second = tryLock('tok-2')
    check('🔴 [H] 두 번째 배포는 들어오지 못한다', !second.ok && second.reason.includes('진행 중'))
    check('🔴 [H] 잠금 상태를 못 읽으면 통과시키지 않는다 (fail-closed)',
      !judgeDeployLock({ acquired: true, unknown: true }).ok)

    /**
     * 🔴 **옛 프로세스의 뒷정리가 새 배포의 잠금을 지우면 안 된다.**
     *    무조건 unlink 하면, 먼저 죽은 배포가 그 사이 시작한 배포의 잠금을 날린다.
     */
    check('🔴 [H] 내 token 이면 지운다', judgeLockRelease({ fileToken: 'tok-1', myToken: 'tok-1' }).release)
    const other = judgeLockRelease({ fileToken: readToken(), myToken: 'tok-옛것' })
    check('🔴 [H] 남의 token 이면 지우지 않는다', !other.release && other.reason.includes('다른 배포'))
    check('🔴 [H] 잠금 파일을 읽지 못하면 지우지 않는다',
      !judgeLockRelease({ fileToken: null, myToken: 'tok-1' }).release)
    // 🔴 그래서 잠금은 그대로 남아 있고, 뒤에 온 배포는 여전히 막힌다
    rmSync(lockFile, { force: true })
    check('🔴 [H] stale 잠금을 스스로 회수하지 않는다 (사람이 지운다)',
      !judgeLockRelease({ fileToken: 'tok-남의것', myToken: 'tok-내것' }).release)
  }

  // ── [I] load 뒤 실제 설정이 개발 트리 ──
  {
    const w = makeWorld({ devPathJobs: ['job-b'] })
    const r = await deploy(w)
    check('🔴 [I] 올라온 설정이 개발 트리면 배포 완료가 아니다', !r.ok && r.phase === 'post-load')
    check('🔴 [I] 그때 격리 검사까지 가지 않는다', idx(w, 'isolation-gate') === -1)
    check('🔴 [I] 되돌린 뒤 직전 SHA·manifest·예약 job 이다',
      w.sha === PREV && manifestSha(w) === PREV && allLoaded(w))
    const w2 = makeWorld({ isolation: true })
    const r2 = await deploy(w2)
    check('🔴 [I] 최종 격리 검사가 실패해도 되돌린다', !r2.ok && w2.sha === PREV && allLoaded(w2))

    // 🔴 일시적 실패와 달리 **계속** 실패하는 load 는 복구가 완전할 수 없다 — 그렇게 적어야 한다
    const w3 = makeWorld({ loadReturns: { 'job-b': false }, loadEffect: { 'job-b': 'keep' } })
    const r3 = await deploy(w3)
    check('🔴 [I] load 가 계속 실패하면 "복구했다" 고 말하지 않는다', r3.rollback?.complete === false)
    check('🔴 [I] 어느 job 이 내려간 채인지 적는다',
      (r3.rollback?.residual ?? []).some((x) => x.includes('job-b')))
    check('🔴 [I] 그래도 나머지 2개는 올려 둔다',
      w3.state.get('job-a') === 'loaded' && w3.state.get('job-c') === 'loaded')
  }

  // ─────────────────────────────────────────────────────────
  // 🔴 실제 연결부 fixture A~G — 명령 반환값과 실제 상태가 어긋날 때
  // ─────────────────────────────────────────────────────────

  // ── [실A] unload 가 false 를 돌려줬는데 **실제로는 내려갔다** ──
  {
    /**
     * 🔴 반환값만 믿고 "성공한 것만" 되돌리면 이 job 은 내려간 채 남는다.
     *    복구 대상은 목록이 아니라 **지금의 실제 상태**여야 한다.
     */
    const w = makeWorld({ unloadReturns: { 'job-b': false }, unloadEffect: { 'job-b': 'unloaded' } })
    const r = await deploy(w)
    check('🔴 [실A] 반환값이 실패면 배포하지 않는다', !r.ok && r.phase === 'unload')
    check('🔴 [실A] 실제로 내려간 job-b 까지 복구한다 — 최종 3/3', allLoaded(w))
    check('🔴 [실A] 복구가 완전하다고 보고한다', r.rollback?.complete === true)
    check('🔴 [실A] 코드는 건드리지 않았다', idx(w, 'checkout') === -1)
  }

  // ── [실B] unload 가 false 이고 **실제로도 안 내려갔다** ──
  {
    const w = makeWorld({ unloadReturns: { 'job-b': false }, unloadEffect: { 'job-b': 'keep' } })
    const r = await deploy(w)
    check('🔴 [실B] 최종 3/3 이다', !r.ok && allLoaded(w))
    /** 🔴 이미 loaded 인 job 에 `launchctl load` 를 다시 부르면 "already loaded" 로 실패한다 */
    check('🔴 [실B] 이미 올라와 있는 job-b·job-c 에 load 를 다시 부르지 않는다',
      countOf(w, 'load:job-b') === 0 && countOf(w, 'load:job-c') === 0)
    check('🔴 [실B] 내려간 job-a 만 다시 올린다', countOf(w, 'load:job-a') === 1)
  }

  // ── [실C] 관측이 unknown ──
  {
    const w = makeWorld({ probeUnknown: ['job-b'] })
    const r = await deploy(w)
    check('🔴 [실C] preflight 에서 관측 실패는 "실행 중 0" 이 아니다', !r.ok && r.phase === 'preflight')
    check('🔴 [실C] 무엇을 못 봤는지 적는다', r.problems.some((x) => x.includes('job-b')))
    check('🔴 [실C] 그때 unload 도 checkout 도 하지 않는다',
      idx(w, 'unload') === -1 && idx(w, 'checkout') === -1)

    // 🔴 unload 뒤 관측이 unknown 이면 성공이 아니다
    const w2 = makeWorld()
    let unloaded = 0
    const baseUnload = w2.fx.unload
    w2.fx.unload = (l): boolean => { unloaded += 1; return baseUnload(l) }
    const baseProbe = w2.fx.probeJob
    w2.fx.probeJob = (l): JobState => (l === 'job-b' && unloaded >= 2 ? 'unknown' : baseProbe(l))
    const r2 = await deploy(w2)
    check('🔴 [실C] unload 뒤 unknown 은 성공이 아니다', !r2.ok && r2.phase === 'unload')
    check('🔴 [실C] 상태 불명을 그대로 적는다',
      r2.problems.some((x) => x.includes('확인하지 못했다'))
      || (r2.rollback?.residual ?? []).some((x) => x.includes('확인하지 못했다')))
  }

  // ── [실D] rollback 시작 시 일부 job 이 이미 loaded ──
  {
    /** 🔴 게이트 실패는 unload 뒤라 예약 job 이 다 내려가 있다. 그중 하나를 사람이 올려 둔 상황을 만든다 */
    const w = makeWorld({ gateFail: 'gate1', unloadEffect: { 'job-c': 'keep' } })
    // job-c 는 unload 명령이 성공을 돌려주지만 실제로는 loaded 로 남는다 → unload 단계에서 잡힌다
    const r = await deploy(w)
    check('🔴 [실D] unload 했는데 안 내려간 것도 잡는다', !r.ok && r.phase === 'unload')
    check('🔴 [실D] 최종 3/3 · 이미 loaded 인 job-c 에 중복 load 없음',
      allLoaded(w) && countOf(w, 'load:job-c') === 0)
    check('🔴 [실D] 복구가 완전하다고 보고한다', r.rollback?.complete === true)
  }

  // ── [실G] load 명령은 성공했는데 관측이 unknown ──
  {
    const w = makeWorld()
    const baseProbe = w.fx.probeJob
    let loaded = 0
    const baseLoad = w.fx.load
    w.fx.load = (l): boolean => { loaded += 1; return baseLoad(l) }
    w.fx.probeJob = (l): JobState => (l === 'job-b' && loaded >= 2 ? 'unknown' : baseProbe(l))
    const r = await deploy(w)
    check('🔴 [실G] load 뒤 관측이 unknown 이면 완료하지 않는다', !r.ok && r.phase === 'load')
    check('🔴 [실G] 격리 검사까지 가지 않는다', idx(w, 'isolation-gate') === -1)
    check('🔴 [실G] 상태 불명을 복구 잔여로 남긴다',
      (r.rollback?.residual ?? []).some((x) => x.includes('확인하지 못했다')))
  }

  for (const d of worlds) rmSync(d, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────
// ② 실제 관측 — 이 기계가 계약대로인가
// ─────────────────────────────────────────────────────────
console.log('\n② 이 기계의 실제 상태')

const git = (args: readonly string[], cwd: string): string | null => {
  try { return execFileSync('git', [...args], { cwd, encoding: 'utf-8' }).trim() } catch { return null }
}
const valueOf = (xml: string, key: string): string | null => {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)
  return m === null ? null : m[1]!
}
const programOf = (xml: string): string | null => {
  const m = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)
  if (m === null) return null
  const args = [...m[1]!.matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1]!)
  return args.find((a) => a.endsWith('.mts')) ?? null
}
const isLink = (p: string): boolean => { try { return lstatSync(p).isSymbolicLink() } catch { return false } }
const real = (p: string): string | null => { try { return realpathSync(p) } catch { return null } }

if (!existsSync(RUNTIME_ROOT)) {
  console.log(`   ⚪ runtime worktree 가 없다 (${RUNTIME_ROOT}) — 이 기계는 예약 실행 기계가 아니다`)
  console.log('   🔴 관측을 건너뛴다. 건너뛴 것은 통과가 아니다')
  // 🔴 운영 판정은 관측 없이는 통과할 수 없다
  check('🔴 [--require-runtime] 관측 없이 격리를 주장하지 않는다', !REQUIRE_RUNTIME)
} else {
  const DEV_ROOTS = (git(['worktree', 'list', '--porcelain'], RUNTIME_ROOT) ?? '')
    .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length))
    .filter((p) => p !== RUNTIME_ROOT)
  console.log(`   runtime  ${RUNTIME_ROOT}`)
  console.log(`   개발 트리 ${DEV_ROOTS.length}개 — 이 중 어느 것도 실행되면 안 된다`)

  /**
   * 🔴 **내려 둔 job 은 "없어야 정상" 이다** (2026-09-14).
   *    앞선 판은 `RUNTIME_JOBS` 다섯 개가 전부 loaded 여야 통과했다. 그래서
   *    82cook 을 결정에 따라 내려 둔 정상 상태가 **격리 실패**로 찍혔고,
   *    같은 이유로 배포 preflight 도 막혔다. 스위치가 `false` 인 job 은
   *    **등록되지 않은 것이 계약**이고, 올라와 있으면 그때가 실패다.
   */
  const RT_ENV = readRuntimeEnv(RUNTIME_ROOT)
  const { active: ACTIVE_JOBS, disabled: DISABLED_JOBS } = partitionJobsByEnv({
    jobs: RUNTIME_JOBS, env: RT_ENV,
  })
  console.log(`   예약 job  활성 ${ACTIVE_JOBS.length}개`
    + (DISABLED_JOBS.length > 0 ? ` · 🟡 내려 둠 ${DISABLED_JOBS.length}개 (${DISABLED_JOBS.join(' · ')})` : ''))

  // ── 경로 ──
  for (const label of ACTIVE_JOBS) {
    const plist = join(AGENT_DIR, `${label}.plist`)
    if (!existsSync(plist)) { check(`🔴 ${label} plist 가 있다`, false); continue }
    const xml = readFileSync(plist, 'utf-8')
    const v = judgeJobPath({
      label, programPath: programOf(xml), workingDirectory: valueOf(xml, 'WorkingDirectory'),
      runtimeRoot: RUNTIME_ROOT, devRoots: DEV_ROOTS,
    })
    check(`🔴 ${label} 이 runtime 만 가리킨다`, v.ok)
    for (const p of v.problems) console.log(`      ${p}`)
  }

  // ── 🔴 실제 loaded 설정 대조 (파일만 고치고 load 를 안 한 상태를 잡는다) ──
  for (const label of ACTIVE_JOBS) {
    const out = ((): string | null => {
      try { return execFileSync('launchctl', ['print', `gui/${process.getuid?.() ?? 0}/${label}`], { encoding: 'utf-8' }) }
      catch { return null }
    })()
    const v = judgeLoadedConfig({
      label, loaded: parseLaunchctlPrint(out), runtimeRoot: RUNTIME_ROOT, devRoots: DEV_ROOTS,
    })
    // 🔴 관측 실패는 --require-runtime 에서만 실패로 본다 (평소엔 launchctl 이 없을 수 있다)
    if (!v.ok && !REQUIRE_RUNTIME && out === null) {
      console.log(`   ⚪ ${label}: launchctl 관측 불가 — --require-runtime 에서만 막는다`)
    } else {
      check(`🔴 ${label} 의 **실제 loaded** 설정도 runtime 이다`, v.ok)
      for (const p of v.problems) console.log(`      ${p}`)
    }
  }

  // ── loaded 목록 ──
  const loadedRaw = ((): string => { try { return execFileSync('launchctl', ['list'], { encoding: 'utf-8' }) } catch { return '' } })()
  const loaded = loadedRaw.split('\n').map((l) => l.trim().split(/\s+/).pop() ?? '')
    .filter((l) => l.startsWith('com.soransoran.'))
  // 🔴 내려 둔 job 은 **올라와 있으면 실패**다 — 같은 판정부가 함께 본다
  const jobs = judgeLoadedJobs({ loaded, expected: ACTIVE_JOBS, disabled: DISABLED_JOBS })
  check(`🔴 활성 예약 job ${ACTIVE_JOBS.length}개만 loaded 다 — 옛 job·내려 둔 job·중복 0`, jobs.ok)
  for (const p of jobs.problems) console.log(`      ${p}`)

  // ── SHA 고정 ──
  const head = git(['rev-parse', 'HEAD'], RUNTIME_ROOT)
  const detached = git(['symbolic-ref', '-q', 'HEAD'], RUNTIME_ROOT) === null
  const pinned = existsSync(PINNED_SHA_FILE) ? readFileSync(PINNED_SHA_FILE, 'utf-8').trim() : null
  const ancestor = head === null ? null
    : git(['merge-base', '--is-ancestor', head, 'origin/main'], RUNTIME_ROOT) !== null
  const sha = judgeRuntimeSha({ head, pinned, detached, ancestorOfMain: ancestor })
  check('🔴 runtime 이 main 계보의 고정 SHA 에 detached 로 묶여 있다', sha.ok)
  for (const p of sha.problems) console.log(`      ${p}`)
  console.log(`   고정 SHA ${(pinned ?? '(없음)').slice(0, 7)} · HEAD ${(head ?? '?').slice(0, 7)}`
    + ` · detached ${detached ? 'yes' : 'no'} · main 계보 ${ancestor === null ? '확인 못함' : ancestor ? 'yes' : 'no'}`)

  // ── 자립성 ──
  const devData = DEV_ROOTS.map((d) => real(join(d, '.microseed-data'))).filter((x): x is string => x !== null)
  const rtData = real(join(RUNTIME_ROOT, '.microseed-data'))
  const setup = judgeRuntimeSetup({
    hasNodeModules: existsSync(join(RUNTIME_ROOT, 'node_modules')),
    hasPrismaClient: existsSync(join(RUNTIME_ROOT, 'node_modules', '.prisma', 'client')),
    hasEnvLocal: existsSync(join(RUNTIME_ROOT, '.env.local')),
    envIsLink: isLink(join(RUNTIME_ROOT, '.env.local')),
    hasDataDir: existsSync(join(RUNTIME_ROOT, '.microseed-data')),
    dataIsLink: isLink(join(RUNTIME_ROOT, '.microseed-data')),
    // 🔴 개발 트리가 하나도 없으면 "갈라질 것" 자체가 없다 — 그때는 참으로 본다
    dataSharedWithDev: devData.length === 0 || (rtData !== null && devData.every((d) => d === rtData)),
  })
  check('🔴 runtime 이 혼자서도 돈다 (node_modules · Prisma · env 링크 · 데이터 정본 공유)', setup.ok)
  for (const p of setup.problems) console.log(`      ${p}`)
  console.log(`   데이터 정본 ${rtData ?? '(없음)'}`)

  // ── 🔴 runtime 이 손대지지 않았는가 ──
  const clean = judgeRuntimeClean({ porcelain: git(['status', '--porcelain', '--untracked-files=no'], RUNTIME_ROOT) })
  check('🔴 runtime 에 추적 파일 변경이 없다', clean.ok)
  for (const p of clean.problems) console.log(`      ${p}`)

  // ── 🔴 정본 권한 — 값·해시는 찍지 않는다. 권한만 본다 ──
  const uid = process.getuid?.() ?? -1
  const modeOf = (p: string): { exists: boolean; mode: number; uid: number } => {
    // 🔴 링크가 아니라 **최종 실체**를 본다
    try { const st = statSync(p); return { exists: true, mode: st.mode, uid: st.uid } }
    catch { return { exists: false, mode: 0, uid: -1 } }
  }
  for (const [label, path, max] of [
    ['정본 디렉터리', CANON_DIR, 0o700],
    ['비밀(env)', join(CANON_DIR, 'env.local'), 0o600],
    ['상태(data)', join(CANON_DIR, 'microseed-data'), 0o700],
  ] as const) {
    const v = judgeCanonicalMode({ label, actual: modeOf(path), maxMode: max, currentUid: uid })
    check(`🔴 ${label} 권한이 닫혀 있다 (${max.toString(8)} 이하 · group/other 0)`, v.ok)
    for (const p of v.problems) console.log(`      ${p}`)
  }

  // ── 🔴 옛 plist 가 그 자리에 없는가 — unload 는 지금 세션만 내린다 ──
  const agentFiles = ((): string[] => {
    try { return readdirSync(AGENT_DIR) } catch { return [] }
  })()
  const rollbackFiles = ((): string[] => {
    try { return readdirSync(rollbackDirOf(CANON_DIR)) } catch { return [] }
  })()
  const retiredPlists = judgeRetiredPlists({ agentFiles, rollbackFiles })
  check('🔴 옛 1회판 plist 가 LaunchAgents 에 없다 (재부팅 재등록 차단)', retiredPlists.ok)
  for (const msg of retiredPlists.problems) console.log(`      ${msg}`)

  /**
   * 🔴 **내려 둔 job 의 설치본도 그 자리에 없어야 한다** (2026-09-16 실측).
   *    `false` 로 내리고 unload 했는데 이틀 뒤 두 job 이 다시 loaded 였다 —
   *    파일이 남아 있어 로그인·재부팅 때 launchd 가 다시 등록했다.
   *    🔴 대상은 `partitionJobsByEnv` 의 `disabled` 집합이다 — 이름을 박지 않는다.
   */
  const disabledPlists = judgeDisabledPlists({
    agentFiles, rollbackFiles, disabled: DISABLED_JOBS,
  })
  check('🔴 내려 둔 job 의 plist 가 LaunchAgents 에 없다 (로그인 재등록 차단)', disabledPlists.ok)
  for (const msg of disabledPlists.problems) console.log(`      ${msg}`)

  // ── 🔴 격리 ≠ 최신 — lag 는 알리되 격리 실패로 세지 않는다 ──
  const originMain = git(['rev-parse', 'origin/main'], RUNTIME_ROOT)
  const lagRaw = head === null || originMain === null ? null
    : git(['rev-list', '--count', `${head}..${originMain}`], RUNTIME_ROOT)
  const fresh = judgePromotionFreshness({
    runtimeSha: head, originMainSha: originMain, lag: lagRaw === null ? null : Number(lagRaw),
  })
  console.log(`   승격 신선도 ${fresh.fresh ? '🟢 최신' : '🟡 뒤처짐'} — ${fresh.detail}`)
  console.log('   🔴 뒤처짐은 격리 실패가 아니다 — Wave C 승격 때만 막는다')
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
