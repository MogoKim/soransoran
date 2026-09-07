/**
 * 공급 러너 lock 행동 테스트 (§4-AU)
 *
 * 🔴 **이 테스트는 실제 러너를 돌리지 않는다.**
 *
 * 첫 판은 진짜 러너를 `--live` + 두 스위치 ON 으로 돌려 lock 삭제를 확인했다.
 * 그날은 재고가 차 있어 no-op 이었지만, **재고가 모자란 날 같은 테스트를 돌리면
 * 실제 수집·모델 호출·DB write 가 일어난다.** 테스트가 운영 공급을 발동하는 것이다.
 *
 * 그래서 판단을 `planStaleLock` 으로 떼어 내고, 삭제 함수는 주입받게 했다.
 * 이 테스트는 **임시 디렉터리의 임시 lock** 과 자기 삭제 함수만 쓴다 —
 * 실제 `.microseed-data` · DB · 네트워크 · 모델 · Queue 를 전혀 건드리지 않는다.
 *
 * 🔴 `DATABASE_URL` 이 없어도 돈다. CI 에서 그대로 실행된다.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  LOCK_FILE, LOCK_TTL_MS, lockDecision, mayWriteRunState,
  planStaleLock, applyStaleLockPlan,
} from '../src/lib/supply-autopilot'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

const NOW = new Date('2026-09-07T21:10:00.000Z')

/** 🔴 죽은 lock — TTL 을 넘겼고 pid 도 살아 있지 않다 */
function staleLockBody(): string {
  const old = new Date(NOW.getTime() - LOCK_TTL_MS - 60_000).toISOString()
  return `${JSON.stringify({ runId: 'STALE-TEST', pid: 0, startedAt: old })}\n`
}

/** 디렉터리 지문 — 목록 · 크기 · mtime */
function fingerprint(dir: string): string {
  if (!existsSync(dir)) return '(없음)'
  return readdirSync(dir).sort().map((f) => {
    const st = statSync(join(dir, f))
    return `${f}:${st.size}:${st.mtimeMs}`
  }).join('\n')
}

/**
 * 한 회차를 흉내 낸다 — 🔴 러너를 부르지 않는다.
 * 러너가 하는 것과 **같은 순서**로 판정 → 계획 → 집행을 거친다.
 */
function simulate(input: {
  dir: string; live: boolean; killOpen: boolean; childKillOpen: boolean
}): { removed: boolean; lines: string[]; canWrite: boolean } {
  const lockPath = join(input.dir, LOCK_FILE)
  const rec = JSON.parse(readFileSync(lockPath, 'utf-8')) as {
    runId: string; pid: number; startedAt: string
  }
  const decision = lockDecision(rec, NOW)
  const canWrite = mayWriteRunState({
    live: input.live, killOpen: input.killOpen, childKillOpen: input.childKillOpen,
  })
  const plan = planStaleLock({
    stale: decision === 'stale', canWrite, runId: rec.runId, pid: rec.pid,
  })
  // 🔴 삭제 함수를 주입한다 — 임시 파일만 지운다
  const r = applyStaleLockPlan(plan, () => { rmSync(lockPath, { force: true }) })
  return { removed: r.removed, lines: plan.lines, canWrite }
}

console.log('\n══ 공급 러너 lock 행동 테스트 (임시 디렉터리 전용) ══\n')

const ROOT = mkdtempSync(join(tmpdir(), 'soran-lock-'))
const OUTSIDE = fingerprint(process.cwd())

// ── 게이트 4조합 + dry-run 전수 ──
const cases: { name: string; live: boolean; kill: boolean; child: boolean; expectRemoved: boolean }[] = [
  { name: 'A dry-run · 스위치 OFF/OFF', live: false, kill: false, child: false, expectRemoved: false },
  { name: 'A dry-run · 스위치 ON/ON', live: false, kill: true, child: true, expectRemoved: false },
  { name: 'B live · OFF/OFF', live: true, kill: false, child: false, expectRemoved: false },
  { name: 'C live · ON/OFF', live: true, kill: true, child: false, expectRemoved: false },
  { name: 'C live · OFF/ON', live: true, kill: false, child: true, expectRemoved: false },
  { name: 'D live · ON/ON', live: true, kill: true, child: true, expectRemoved: true },
]

for (const c of cases) {
  const dir = mkdtempSync(join(ROOT, 'run-'))
  const lockPath = join(dir, LOCK_FILE)
  writeFileSync(lockPath, staleLockBody(), 'utf-8')
  const before = fingerprint(dir)
  const lockBefore = readFileSync(lockPath, 'utf-8')

  const r = simulate({ dir, live: c.live, killOpen: c.kill, childKillOpen: c.child })

  if (c.expectRemoved) {
    check(`🟢 [${c.name}] 죽은 lock 을 걷어낸다`, r.removed && !existsSync(lockPath))
    check(`🟢 [${c.name}] 화면이 "걷어낸다" 고 말한다`, r.lines.some((l) => l.includes('걷어낸다')))
  } else {
    check(`🔴 [${c.name}] lock 을 지우지 않는다`, !r.removed && existsSync(lockPath))
    check(`🔴 [${c.name}] lock 내용이 그대로다`, readFileSync(lockPath, 'utf-8') === lockBefore)
    check(`🔴 [${c.name}] 디렉터리가 그대로다 (write 0)`, fingerprint(dir) === before)
    check(`🔴 [${c.name}] 화면이 "지우지 않는다" 고 말한다`,
      r.lines.some((l) => l.includes('지우지 않는다')))
    check(`🔴 [${c.name}] 게이트가 닫혀 있다고 판정한다`, !r.canWrite)
  }
  rmSync(dir, { recursive: true, force: true })
}

// ── stale 이 아닌 lock 은 손대지 않는다 ──
{
  const dir = mkdtempSync(join(ROOT, 'fresh-'))
  const lockPath = join(dir, LOCK_FILE)
  const fresh = JSON.stringify({
    runId: 'ALIVE', pid: process.pid, startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  })
  writeFileSync(lockPath, `${fresh}\n`, 'utf-8')
  const before = fingerprint(dir)
  const r = simulate({ dir, live: true, killOpen: true, childKillOpen: true })
  check('🔴 살아 있는 lock 은 게이트가 열려 있어도 지우지 않는다', !r.removed && existsSync(lockPath))
  check('🟢 그 경우 화면에 아무 말도 하지 않는다', r.lines.length === 0)
  check('🟢 디렉터리가 그대로다', fingerprint(dir) === before)
  rmSync(dir, { recursive: true, force: true })
}

// ── 판정 함수 자체 ──
check('🟢 stale 이 아니면 action=none',
  planStaleLock({ stale: false, canWrite: true, runId: 'r', pid: 1 }).action === 'none')
check('🟢 stale + 쓸 수 있으면 remove',
  planStaleLock({ stale: true, canWrite: true, runId: 'r', pid: 1 }).action === 'remove')
check('🔴 stale + 쓸 수 없으면 preserve',
  planStaleLock({ stale: true, canWrite: false, runId: 'r', pid: 1 }).action === 'preserve')
check('🔴 preserve 는 삭제 함수를 부르지 않는다', (() => {
  let called = 0
  applyStaleLockPlan(
    planStaleLock({ stale: true, canWrite: false, runId: 'r', pid: 1 }),
    () => { called += 1 },
  )
  return called === 0
})())
check('🟢 remove 는 삭제 함수를 정확히 한 번 부른다', (() => {
  let called = 0
  applyStaleLockPlan(
    planStaleLock({ stale: true, canWrite: true, runId: 'r', pid: 1 }),
    () => { called += 1 },
  )
  return called === 1
})())
check('🔴 none 도 삭제 함수를 부르지 않는다', (() => {
  let called = 0
  applyStaleLockPlan(
    planStaleLock({ stale: false, canWrite: true, runId: 'r', pid: 1 }),
    () => { called += 1 },
  )
  return called === 0
})())

// ── 🔴 이 테스트가 운영을 건드리지 않는다는 것 자체를 고정한다 ──
// SELF_CHECK_BEGIN — 🔴 이 줄 아래는 자기 검사다. 위 스캔 대상에서 제외된다
{
  const self = readFileSync('scripts/supply-autopilot-lock-check.mts', 'utf-8')
  // 🔴 **자기 검사 블록은 스캔 대상에서 뺀다.** 금지 낱말을 찾는 정규식 리터럴이
  //    코드에 남아 자기 자신을 잡는다 — 이 함정에 이 저장소가 여러 번 걸렸다.
  const SELF_CHECK_MARK = 'SELF_CHECK_BEGIN'
  const body = self.slice(0, self.lastIndexOf(SELF_CHECK_MARK))
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check('🔴 실제 러너를 실행하지 않는다 — spawn · exec 계열 0',
    !/execFileSync|execSync|spawnSync|spawn\(|child_process/.test(code))
  check('🔴 --live 로 무엇도 부르지 않는다', !/'--live'|"--live"|--live/.test(code))
  check('🔴 환경 스위치를 켜지 않는다',
    !/SORAN_SUPPLY_AUTOPILOT_ENABLED|SORAN_82COOK_THIN_DETAIL_ENABLED/.test(code))
  check('🔴 DB 를 쓰지 않는다 — DATABASE_URL 없이도 돈다',
    !/PrismaClient|DATABASE_URL|loadEnvLocal/.test(code))
  check('🔴 네트워크로 나가지 않는다', !/\bfetch\(|https?:\/\/|playwright/i.test(code))
  check('🔴 실제 데이터 디렉터리를 건드리지 않는다', !/\.microseed-data/.test(code))
  check('🔴 임시 디렉터리만 쓴다', /mkdtempSync/.test(code) && /tmpdir\(\)/.test(code))
  // 🔴 지우는 것은 임시 디렉터리뿐이어야 한다
  const rms = [...code.matchAll(/rmSync\(([^,)]+)/g)].map((m) => m[1].trim())
  check('🔴 rmSync 대상이 임시 경로뿐이다',
    rms.length > 0 && rms.every((t) => t === 'dir' || t === 'ROOT' || t === 'lockPath'))
}

// ── 정리 ──
rmSync(ROOT, { recursive: true, force: true })
check('🟢 임시 디렉터리를 지웠다', !existsSync(ROOT))
check('🔴 임시 디렉터리 밖 파일이 하나도 바뀌지 않았다', fingerprint(process.cwd()) === OUTSIDE)

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
