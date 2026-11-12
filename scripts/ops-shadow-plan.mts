#!/usr/bin/env tsx
/**
 * 🔴 **ops shadow 한 사이클 — 손 실행 진입점** (2026-11-11 · Phase 1 S1/S2 · 권위 0)
 *
 *   npm run ops:shadow-plan                 # 지금 관측으로 한 사이클 · 감사 장부에 한 줄
 *   npm run ops:shadow-plan -- --json       # 기록을 그대로 출력
 *   npm run ops:shadow-plan -- --dry        # 기록하지 않는다(출력만)
 *   npm run ops:shadow-plan -- --out-dir=<…/ops-shadow> --data-dir=<…>   # 시험용 경로
 *   npm run ops:shadow-plan -- --now=<ISO>  # 시험용 관측 시각 — 🔴 과거만 · 격리 시험 계약(격리 DB · 임시 HOME)에서만(기록에 clock: injected)
 *
 * 🔴 **아무것도 실행하지 않는다.** 가드를 먼저 건다 — fetch · 자식 프로세스는 던지고, DB 는 읽기 전용 프록시다.
 *    공급 · 수집 · 발행 · 댓글 · provider 호출, DB · stage · 장부 쓰기 0. 쓰는 것은 저장소 밖 감사 장부 한 줄뿐이다.
 * 🔴 관측 · 계획 · 기록 본문은 observer 와 같은 `runShadowCycle` 하나다(`scripts/lib/ops-shadow-cycle.mts`).
 * 🔴 하루 닫기(`dayClose`)는 시계가 아니라 **마지막 자연 공급 회차의 완료**가 트리거다(`writerDueOf`).
 */
import { defaultOpsShadowDir, injectedClockProblems, installShadowCallGuard } from './lib/ops-shadow-io.mjs'

const argv = process.argv.slice(2)
const flag = (name: string): string | null => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
if (argv.some((a) => a === '--apply' || a === '--execute' || a === '--call' || a === '--live')) {
  console.error('🔴 shadow 에는 실행 명령이 없다 — 관측·기록만 한다')
  process.exit(2)
}

// 🔴 가드를 **먼저** 건다 — 아래 import 가 모듈 초기화에서 무엇을 부르든 밖으로 나가지 못한다
installShadowCallGuard()

const { kstDateString } = await import('../src/lib/release-canary')
const { SUPPLY_DATA_DIR } = await import('./lib/runner-health.mjs')
const { runShadowCycle } = await import('./lib/ops-shadow-cycle.mjs')

const fail = (m: string, code: number): never => { console.error(`🔴 ${m}`); process.exit(code) }

const nowFlag = flag('now')
const realNow = new Date()
const now = nowFlag === null ? realNow : new Date(nowFlag)
if (nowFlag !== null && (Number.isNaN(now.getTime()) || now.toISOString() !== nowFlag || now.getTime() > realNow.getTime())) {
  fail('--now 는 지금보다 과거인 엄격 ISO 시각만 받는다', 2)
}
// 🔴 주입 시각은 버려도 되는 격리 시험에서만 — 운영 DB · 실제 장부 · StageDecision 으로 지난 관측 · dayClose 를 재구성하지 않는다
if (nowFlag !== null && injectedClockProblems(process.env).length > 0) {
  fail(`--now 는 격리 시험 계약에서만 받는다 — ${injectedClockProblems(process.env).join(' · ')}`, 2)
}
const r = await runShadowCycle({
  now, clock: nowFlag === null ? 'real' : 'injected', kstDate: kstDateString(now), source: { kind: 'manual' },
  dataDir: flag('data-dir') ?? SUPPLY_DATA_DIR, outDir: flag('out-dir') ?? defaultOpsShadowDir(),
  dry: argv.includes('--dry'), json: argv.includes('--json'), log: (l) => console.log(l),
})
if (!r.ok) fail('controller 결정을 읽지 못했다 — 기록 0', 3)
