#!/usr/bin/env tsx
/**
 * 🔴 **ops shadow observer — 자연 공급 회차가 끝나면 한 번 관측한다** (2026-11-11 · Phase 2 · 권위 0)
 *
 *   launchd `com.soransoran.ops-shadow-observer` 가 60초마다 깨운다(ops-loop 설치기 소유 · `StartInterval`).
 *   npm run ops:shadow-observer                       # 한 tick
 *   npm run ops:shadow-observer -- --data-dir=… --out-dir=…/ops-shadow --now=<과거 ISO>   # 🔴 격리 시험 계약(격리 DB · 임시 HOME)에서만
 *
 * 🔴 **공급 · controller · 발행 · 댓글을 부르지도 기다리지도 않는다.** 공급 회차 기록 파일과 감사 장부만 읽고,
 *    고른 회차가 있을 때만 공용 사이클(`runShadowCycle`)을 돈다. 고를 것이 없으면 DB 에 연결하지 않는다.
 *    가드를 먼저 건다 — fetch · 자식 프로세스 0 · DB 읽기 전용. 공급 lease 를 잡지 않는다.
 * 🔴 이 프로세스의 실패는 이 job 의 exit · log 에만 남는다 — 다른 job 의 exit · 권위는 바뀌지 않는다.
 * 🔴 무엇을 볼지는 `selectObserverWork` 하나가 정한다(자연 회차 · 회차 열쇠 · causal/backfill · stale).
 */
import { defaultOpsShadowDir, deployLockPresent, injectedClockProblems, installShadowCallGuard } from './lib/ops-shadow-io.mjs'

const argv = process.argv.slice(2)
const flag = (name: string): string | null => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
if (argv.some((a) => a === '--apply' || a === '--execute' || a === '--call' || a === '--live')) {
  console.error('🔴 observer 에는 실행 명령이 없다 — 관측·기록만 한다')
  process.exit(2)
}

// 🔴 가드를 **먼저** 건다
installShadowCallGuard()

// 🔴 배포 중이면 아무것도 하지 않는다 — 장부 디렉터리 · 잠금 · DB · 공급 기록 0
if (deployLockPresent()) {
  console.log('ops shadow observer · runtime 배포 중(runtime-deploy.lock) — 이번 tick 은 아무것도 하지 않는다')
  process.exit(0)
}

const { selectObserverWork } = await import('../src/lib/ops-shadow-observer')
const { SUPPLY_DATA_DIR } = await import('./lib/runner-health.mjs')
const { acquireObserverLock, readShadowCycleIds, readSupplyRuns } = await import('./lib/ops-shadow-io.mjs')
const { runShadowCycle } = await import('./lib/ops-shadow-cycle.mjs')

const nowFlag = flag('now')
const realNow = new Date()
const now = nowFlag === null ? realNow : new Date(nowFlag)
if (nowFlag !== null && (Number.isNaN(now.getTime()) || now.toISOString() !== nowFlag || now.getTime() > realNow.getTime())) {
  console.error('🔴 --now 는 지금보다 과거인 엄격 ISO 시각만 받는다')
  process.exit(2)
}
// 🔴 주입 시각은 버려도 되는 격리 시험에서만 — 지금 DB · 장부로 지난 관측을 재구성하지 않는다
if (nowFlag !== null && injectedClockProblems(process.env).length > 0) {
  console.error(`🔴 --now 는 격리 시험 계약에서만 받는다 — ${injectedClockProblems(process.env).join(' · ')}`)
  process.exit(2)
}
const dataDir = flag('data-dir') ?? SUPPLY_DATA_DIR
const outDir = flag('out-dir') ?? defaultOpsShadowDir()

// 🔴 단일 실행 — 진행 중인 causal 관측을 뒤 tick 의 backfill marker 가 앞지르지 못하게 tick 전체를 잠근다
const lock = acquireObserverLock(outDir)
if (!lock.acquired) {
  // 🔴 주인이 죽은 정리 claim 만 실패다(사람이 확인) — 나머지는 이번 tick 을 건너뛰고 다음 tick 이 잇는다
  const stranded = lock.reason === 'cleanupStranded'
  ;(stranded ? console.error : console.log)(`${stranded ? '🔴 ' : ''}ops shadow observer ${now.toISOString()} · 잠금 ${lock.reason}`
    + ` (pid ${lock.holderPid ?? '?'}) — 이번 tick 은 고르지 않는다${stranded ? ' · 정리 claim 을 확인하고 지운다' : ''}`)
  process.exit(stranded ? 1 : 0)
}
const exitCode = await (async (): Promise<number> => {
  const runRead = readSupplyRuns(dataDir)
  if (!runRead.readable) {
    console.error(`🔴 공급 회차 기록 디렉터리를 읽지 못했다 — ${dataDir}`)
    return 1
  }
  const KST_MS = 9 * 3_600_000
  const dates = runRead.runs.flatMap((r) => (r.naturalAt === null ? [] : [new Date(Date.parse(r.naturalAt) + KST_MS).toISOString().slice(0, 10)]))
  const seen = readShadowCycleIds(outDir, dates)
  const sel = selectObserverWork({ now, runs: runRead.runs, seenCycleIds: seen })
  const tally = new Map<string, number>()
  for (const c of sel.classes) tally.set(c.cls, (tally.get(c.cls) ?? 0) + 1)
  console.log(`ops shadow observer ${now.toISOString()} · 회차 ${runRead.runs.length} · 깨진 기록 ${runRead.malformed.length}`
    + ` · ${[...tally].map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'} · 이번 tick ${sel.work.length} · 미룸 ${sel.deferred}`)
  if (sel.work.length === 0) return 0

  let failed = 0
  for (const w of sel.work) {
    try {
      // 🔴 관측 시각은 이 tick 의 시각이다 — 회차 완료 시각(`completedAt`)은 출처로만 남는다.
      //    causal 만 지금 상태를 본다. backfill 은 결정 · 장부 · DB 를 읽지 않는 marker 한 줄이다(공용 사이클이 정한다).
      const base = { runId: w.runId, completedAt: w.completedAt, key: w.key, integrity: 'unknown' as const }
      const r = await runShadowCycle({
        now, clock: nowFlag === null ? 'real' : 'injected', kstDate: w.kstDate,
        source: w.mode === 'causal' ? { kind: 'naturalRun', ...base, mode: 'causal' } : { kind: 'naturalRun', ...base, mode: 'backfill' },
        dataDir, outDir, dry: false, json: false, log: (l) => console.log(l),
      })
      // 결정이 없으면(causal) 기록 0 — 다음 tick 이 다시 본다(지연을 넘기면 backfill marker 가 된다)
      if (!r.ok) console.log(`   🟡 ${w.runId} — ${r.code} · 기록 0 · 다음 tick 이 다시 본다`)
    } catch (e) {
      failed += 1
      console.error(`🔴 ${w.runId} 관측 실패 — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return failed === 0 ? 0 : 1
})().finally(() => lock.release())
process.exit(exitCode)
