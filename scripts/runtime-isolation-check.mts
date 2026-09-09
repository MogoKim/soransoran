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
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { statSync } from 'node:fs'

import {
  RUNTIME_JOBS, RETIRED_JOBS,
  judgeCanonicalMode, judgeJobPath, judgeJobState, judgeLoadedConfig, judgeLoadedJobs,
  judgeRuntimeClean, judgeRuntimeSetup, judgeRuntimeSha, parseLaunchctlPrint, type JobState,
} from '../src/lib/runtime-isolation'
import {
  judgeCheckpointFreshness, judgePromotionFreshness, judgeSlotEvidence, parseSuccessRuns, runIdToMs,
} from '../src/lib/runtime-evidence'
import {
  judgeDeploy, judgeDeployLock, judgeLockRelease, runDeploy, type DeployEffects,
} from '../src/lib/runtime-deploy'

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
  check('🟢 예약 job 셋만 loaded 면 통과', judgeLoadedJobs({ loaded: [...RUNTIME_JOBS] }).ok)
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
		${DEV}/scripts/supply-autopilot.mts
		--live
	}
	working directory = ${DEV}
`)
  check('🔴 launchctl 원문에서 실제 경로를 뽑는다', devLoaded.readable && devLoaded.programPath === `${DEV}/scripts/supply-autopilot.mts`)
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
  const dirty = judgeRuntimeClean({ porcelain: ' M scripts/supply-autopilot.mts' })
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
  check('🔴 job 이 돌고 있으면 막는다', !judgeDeploy({ ...base, jobsRunning: ['supply-autopilot'] }).ok)
  check('🔴 origin/main 을 못 읽으면 막는다', !judgeDeploy({ ...base, originMain: null }).ok)
}

{
  // 🔴 운영 판정이 이 스위치를 실제로 쓰는지 본다 — 안 쓰면 fail-open 이 되살아난다
  const waveC = readFileSync('scripts/wave-c-readiness.mts', 'utf-8')
  check('🔴 Wave C 판정이 --require-runtime 으로 관측을 요구한다',
    /runtime-isolation-check\.mts', '--require-runtime'/.test(waveC))
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
    const good = parseLaunchctlPrint(printSample('supply-autopilot', `${RTDIR}/scripts/supply-autopilot.mts`, RTDIR))
    check('🟢 [E] 정상 출력에 plist·log 경로가 있어도 loaded 설정은 PASS',
      judgeLoadedConfig({ label: 'x', loaded: good, runtimeRoot: RTDIR, devRoots: [DEVDIR] }).ok)
    check('🔴 [E] 파서가 program 은 .mts, wd 는 working directory 만 본다',
      good.programPath === `${RTDIR}/scripts/supply-autopilot.mts` && good.workingDirectory === RTDIR)
    const devProgram = parseLaunchctlPrint(printSample('x', `${DEVDIR}/scripts/supply-autopilot.mts`, RTDIR))
    check('🔴 [F] program 이 개발 트리면 FAIL',
      !judgeLoadedConfig({ label: 'x', loaded: devProgram, runtimeRoot: RTDIR, devRoots: [DEVDIR] }).ok)
    const devWd = parseLaunchctlPrint(printSample('x', `${RTDIR}/scripts/supply-autopilot.mts`, DEVDIR))
    check('🔴 [F] WorkingDirectory 가 개발 트리면 FAIL',
      !judgeLoadedConfig({ label: 'x', loaded: devWd, runtimeRoot: RTDIR, devRoots: [DEVDIR] }).ok)

    /**
     * 🔴 **옛 판이 왜 틀렸는지를 표본으로 못박는다.**
     *
     *    "출력에서 soransoran 이 들어간 절대경로를 모아 전부 runtime 아래인지" 보면
     *    plist·stdout·stderr 경로 때문에 **정상 job 이 실패한다.** 실측으로 3개 모두 false 였다.
     *    이 두 줄은 같은 입력에서 두 규칙이 반대 답을 낸다는 사실 자체를 기록한다.
     */
    const raw = printSample('supply-autopilot', `${RTDIR}/scripts/supply-autopilot.mts`, RTDIR)
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
    /** 처음부터 이 상태로 시작한다 */
    initial?: Readonly<Record<string, JobState>>
    /** 실제 loaded 설정이 개발 트리를 가리키는 job */
    devPathJobs?: readonly string[]
  }
  type World = {
    dir: string; manifestFile: string; pinFile: string
    sha: string; deps: string; state: Map<string, JobState>
    order: string[]; installs: number
    fx: DeployEffects
  }

  const worlds: string[] = []
  const makeWorld = (f: Fault = {}): World => {
    const dir = mkdtempSync(join(tmpdir(), 'soran-deploy-fx-'))
    worlds.push(dir)
    const manifestFile = join(dir, 'runtime-manifest.json')
    const pinFile = join(dir, 'runtime-pinned-sha')
    if (f.noPrevManifest !== true) writeFileSync(manifestFile, JSON.stringify({ sha: PREV }), 'utf-8')
    writeFileSync(pinFile, `${PREV}\n`, 'utf-8')

    const state = new Map<string, JobState>(J.map((l) => [l, f.initial?.[l] ?? 'loaded']))
    const w: World = {
      dir, manifestFile, pinFile,
      sha: PREV, deps: PREV, state,
      order: [], installs: 0, fx: {} as DeployEffects,
    }
    const rec = (m: string): void => { w.order.push(m) }
    let loads = 0
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
      runningJobs: () => ({ running: [], unknown: (f.probeUnknown ?? []).filter((l) => J.includes(l)) }),

      unload: (l) => {
        rec(`unload:${l}`)
        applyEffect(l, f.unloadEffect?.[l], 'unloaded')
        return f.unloadReturns?.[l] ?? true
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
      // 🔴 실제 launchctl 출력 형태를 그대로 파싱한다
      loadedConfig: (l) => {
        rec(`loaded-config:${l}`)
        const dev = (f.devPathJobs ?? []).includes(l)
        return parseLaunchctlPrint(printSample(l, `${dev ? DEVDIR : RTDIR}/scripts/${l}.mts`, RTDIR))
      },
      isolationGate: () => { rec('isolation-gate'); return f.isolation !== true },

      readManifest: () => (existsSync(manifestFile) ? readFileSync(manifestFile, 'utf-8') : null),
      writeManifest: (j) => { rec('write-manifest'); writeFileSync(manifestFile, j, 'utf-8'); return true },
      removeManifest: () => { rec('remove-manifest'); rmSync(manifestFile, { force: true }); return true },
      writePin: (sha) => { writeFileSync(pinFile, `${sha}\n`, 'utf-8'); return true },
      log: () => { /* fixture 는 조용히 */ },
    }
    return w
  }
  const deploy = async (w: World): Promise<Awaited<ReturnType<typeof runDeploy>>> =>
    runDeploy({
      target: NEXT, jobs: J, paths: PATHS,
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

  // ── [A] 정상 배포 ──
  {
    const w = makeWorld()
    const r = await deploy(w)
    check('🟢 [A] 정상 배포가 성공한다', r.ok)
    // 🔴 실제로 부른 명령의 순서로 본다 — 상태 머신이 적어 준 이름이 아니라
    check('🔴 [A] unload 3개가 checkout 보다 **먼저** 끝난다',
      J.every((l) => idx(w, `unload:${l}`) >= 0 && idx(w, `unload:${l}`) < idx(w, 'checkout')))
    check('🔴 [A] offline 게이트는 job 이 내려간 뒤·load 앞에서 돈다',
      idx(w, 'gate:gate1') > idx(w, 'unload:job-c') && idx(w, 'gate:gate2') < idx(w, 'load:job-a'))
    /**
     * 🔴 **이게 첫 판이 구조적으로 실패한 자리다.**
     *    `runtime:isolation-check --require-runtime` 은 job 3개가 loaded 여야 통과한다.
     *    그런데 옛 순서는 job 을 내려 둔 채 그것을 돌렸다 — 정상 배포가 항상 실패했다.
     */
    check('🔴 [A] 격리 검사는 job 을 **다시 올린 뒤에** 돈다',
      idx(w, 'isolation-gate') > idx(w, 'load:job-c'))
    check('🔴 [A] 실제 loaded 설정 대조가 격리 검사보다 앞에 있다',
      idx(w, 'loaded-config') > 0 && idx(w, 'loaded-config') < idx(w, 'isolation-gate'))
    check('🔴 [A] 끝난 뒤 3개가 모두 올라와 있다', allLoaded(w))
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
    check('🔴 [B] job 3개가 그대로 올라와 있고 SHA·manifest 도 그대로다',
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
    check('🔴 [C] 이미 내린 job 을 **다시 올린다** — 3개가 올라와 있다', allLoaded(w))
    check('🔴 [C] SHA·의존성은 직전 그대로다', w.sha === PREV && w.deps === PREV)
  }

  // ── [D] offline 게이트 실패 ──
  {
    const w = makeWorld({ gateFail: 'gate2' })
    const r = await deploy(w)
    check('🔴 [D] 게이트가 실패하면 배포하지 않는다', !r.ok && r.phase === 'offline-gate')
    check('🔴 [D] 직전 SHA·의존성으로 되돌아간다', w.sha === PREV && w.deps === PREV)
    check('🔴 [D] 직전 manifest·pin 이 복원된다', manifestSha(w) === PREV && pinOf(w) === PREV)
    check('🔴 [D] job 3개가 다시 올라온다', allLoaded(w))
    check('🔴 [D] 복구가 완전하다고 보고한다', r.rollback?.complete === true)
  }

  // ── [E] load 실패 ──
  {
    const w = makeWorld({ loadFailAt: 2 })
    const r = await deploy(w)
    check('🔴 [E] load 가 실패하면 배포 완료가 아니다', !r.ok && r.phase === 'load')
    check('🔴 [E] 되돌린 뒤 직전 job 3개가 올라와 있다', allLoaded(w))
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
    check('🔴 [G] 그래도 job 3개는 다시 올라온다', allLoaded(w))
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
    check('🔴 [I] 되돌린 뒤 직전 SHA·manifest·job 3개다',
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
    /** 🔴 게이트 실패는 unload 뒤라 3개가 다 내려가 있다. 그중 하나를 사람이 올려 둔 상황을 만든다 */
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

  // ── 경로 ──
  for (const label of RUNTIME_JOBS) {
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
  for (const label of RUNTIME_JOBS) {
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
  const jobs = judgeLoadedJobs({ loaded })
  check('🔴 예약 job 셋만 loaded 다 — 옛 job·중복 0', jobs.ok)
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
