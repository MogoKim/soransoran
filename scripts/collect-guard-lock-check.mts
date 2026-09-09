#!/usr/bin/env tsx
/**
 * 수집 차단기 잠금 fixture — 🔴 **실제 filesystem · 실제 OS 프로세스**
 *
 * 🔴 소스 문자열 검사로는 이 계약을 지킬 수 없다. 경쟁은 두 프로세스가 같은 순간에
 *    같은 파일을 볼 때만 드러나므로, 여기서는 `mkdtemp` 안에서 자식 프로세스를 띄운다.
 *
 * 🔴 **저장소의 `.microseed-data` 를 읽지도 쓰지도 않는다.** 모든 시험은 임시 디렉터리에서
 *    돌고, 마지막에 저장소가 손대지지 않았음을 확인한다.
 *
 * 🔴 **대조군을 함께 돌린다.** 같은 하네스로 "옛 프로토콜"(읽고 → 지우고 → 만든다)을
 *    시험해 `MAX_CONCURRENT=2` 가 나오는 것을 보인다 — 이 fixture 가 실제로
 *    경쟁을 잡아낼 힘이 있다는 증거다. 보호 로직을 지우면 이 값이 곧 본 시험의 값이 된다.
 */
import { spawn } from 'node:child_process'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { newGuardState } from '../src/lib/collect-guard'
import {
  LOCK_TTL_MS, REAPER_TTL_MS, guardPath, kstDayOf, lockPath, reaperPath,
  saveGuard, setGuardRoot, resetGuardRoot, withGuardLock, guardRoot,
} from './lib/collect-guard-store.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const STORE = join(REPO, 'scripts', 'lib', 'collect-guard-store.mjs')

let pass = 0
let failN = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${n}`) }
}

console.log('\n══ 수집 차단기 잠금 fixture (실제 프로세스) ══\n')

// 🔴 저장소가 손대지지 않았음을 마지막에 확인하기 위한 사전 스냅숏
const REPO_DATA = join(REPO, '.microseed-data')
const repoBefore = existsSync(REPO_DATA)
  ? readdirSync(REPO_DATA).filter((f) => f.startsWith('collect-guard')).sort().join()
  : '(없음)'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** mkdtemp 하나 — 반드시 지운다 */
function withTemp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'guardlock-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
async function withTempAsync<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'guardlock-'))
  try { return await fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** 그 임시 디렉터리를 잠금 뿌리로 삼는다 */
function rootOf(dir: string): string {
  const r = join(dir, 'state')
  mkdirSync(r, { recursive: true })
  return r
}

function plantStaleLock(root: string, ageMs: number): string {
  setGuardRoot(root)
  const p = lockPath('82cook')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ pid: 999_999, at: Date.now() - ageMs, host: 'local', token: 'dead' }))
  return p
}

// ─────────────────────────────────────────────────────────
// ① 하나의 stale lock 에 두 contender — maxConcurrent === 1
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **안무를 못박는다.** 경쟁을 운에 맡기면 시험이 통과해도 아무것도 증명하지 못한다.
 *
 *    두 역할을 준다.
 *      `fast` — stale 을 관측하고, 출발 신호에 곧바로 회수·획득한다
 *      `slow` — 같은 stale 을 **먼저 관측**해 두고, `fast` 가 successor 를 만든 **뒤에** 회수를 시도한다
 *
 *    이것이 결함이 사는 정확한 자리다: `slow` 의 관측은 낡았는데 그 낡은 관측으로 지운다.
 */
const CHILD_REAL = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setGuardRoot, withGuardLock } from ${JSON.stringify(STORE)}
setGuardRoot(process.env.GUARD_ROOT)
const LOCK = join(process.env.GUARD_ROOT, 'collect-guard-82cook.json.lock')
const ROLE = process.env.ROLE
// 🔴 두 역할 모두 **먼저 관측한다**
const observed = JSON.parse(readFileSync(LOCK, 'utf-8'))
writeFileSync(process.env.READY + '.' + ROLE, String(observed.at))
while (!existsSync(process.env.START)) { /* spin */ }
if (ROLE === 'slow') {
  // 🔴 fast 가 successor 를 세울 때까지 기다린다 — 그 뒤에 낡은 관측으로 덤빈다
  const t0 = Date.now()
  while (Date.now() - t0 < 3000) {
    try {
      const cur = JSON.parse(readFileSync(LOCK, 'utf-8'))
      if (cur.token !== observed.token) break
    } catch { /* 교체 중 */ }
  }
}
try {
  // 🔴 잠금 안은 **동기**다 — Promise 를 돌려주면 store 가 던진다
  await withGuardLock('82cook', () => {
    appendFileSync(process.env.OUT, JSON.stringify({ ev: 'enter', t: Date.now(), role: ROLE }) + '\\n')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    appendFileSync(process.env.OUT, JSON.stringify({ ev: 'exit', t: Date.now(), role: ROLE }) + '\\n')
  }, { waitMs: 700 })
} catch (e) {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'blocked', role: ROLE }) + '\\n')
}
`

/**
 * 🔴 **대조군** — 옛 프로토콜을 그대로 옮겼다.
 *    읽고(관측) → TTL 지났으면 지우고 → `wx` 로 만든다. 재판정도 직렬화도 없다.
 *    같은 안무에서 이쪽은 **두 주인**이 나온다. 그것이 이 시험의 검증력이다.
 */
const CHILD_LEGACY = `
import { appendFileSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
const LOCK = join(process.env.GUARD_ROOT, 'collect-guard-82cook.json.lock')
const TTL = ${LOCK_TTL_MS}
const ROLE = process.env.ROLE
const observed = JSON.parse(readFileSync(LOCK, 'utf-8'))
const observedStale = Date.now() - observed.at > TTL   // 🔴 이 판정을 끝까지 들고 간다
writeFileSync(process.env.READY + '.' + ROLE, String(observed.at))
while (!existsSync(process.env.START)) { /* spin */ }
if (ROLE === 'slow') {
  const t0 = Date.now()
  while (Date.now() - t0 < 3000) {
    try {
      const cur = JSON.parse(readFileSync(LOCK, 'utf-8'))
      if (cur.token !== observed.token) break
    } catch { /* 교체 중 */ }
  }
}
let got = false
const deadline = Date.now() + 700
while (!got && Date.now() < deadline) {
  try { writeFileSync(LOCK, JSON.stringify({ at: Date.now(), token: ROLE }), { flag: 'wx' }); got = true; break }
  catch (e) { if (e.code !== 'EEXIST') throw e }
  // 🔴 **낡은 관측으로 지운다** — 지금 그 자리에 누가 있는지 다시 보지 않는다
  if (observedStale) { rmSync(LOCK, { force: true }); continue }
  await new Promise((r) => setTimeout(r, 10))
}
if (got) {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'enter', t: Date.now(), role: ROLE }) + '\\n')
  await new Promise((r) => setTimeout(r, 250))
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'exit', t: Date.now(), role: ROLE }) + '\\n')
} else {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'blocked', role: ROLE }) + '\\n')
}
`

function runChild(dir: string, script: string, env: Record<string, string>): Promise<number> {
  return new Promise((res) => {
    const p = spawn('npx', ['tsx', script], {
      cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'],
    })
    p.on('close', (code) => res(code ?? -1))
  })
}

/** 두 역할을 붙여 최대 동시 진입 수를 잰다 */
async function raceOnce(childSrc: string, trials: number): Promise<number> {
  let peak = 0
  for (let i = 0; i < trials; i += 1) {
    peak = Math.max(peak, await withTempAsync(async (dir) => {
      const root = rootOf(dir)
      plantStaleLock(root, LOCK_TTL_MS * 10)
      const script = join(dir, 'child.mts')
      writeFileSync(script, childSrc)
      const out = join(dir, 'ev.jsonl')
      writeFileSync(out, '')
      const start = join(dir, 'START')
      const ready = join(dir, 'READY')
      const base = { GUARD_ROOT: root, OUT: out, START: start, READY: ready }
      const running = [
        runChild(dir, script, { ...base, ROLE: 'fast' }),
        runChild(dir, script, { ...base, ROLE: 'slow' }),
      ]
      // 🔴 **둘 다 관측을 마친 뒤에** 출발시킨다 — 안무를 운에 맡기지 않는다
      const readyCount = (): number => readdirSync(dir).filter((f) => f.startsWith('READY.')).length
      for (let k = 0; k < 400 && readyCount() < 2; k += 1) await sleep(25)
      writeFileSync(start, 'go')
      await Promise.all(running)
      const evs = readFileSync(out, 'utf-8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l) as { ev: string; t: number })
        .sort((a2, b2) => a2.t - b2.t)
      let cur = 0
      let mx = 0
      for (const e of evs) {
        if (e.ev === 'enter') { cur += 1; mx = Math.max(mx, cur) }
        if (e.ev === 'exit') cur -= 1
      }
      return mx
    }))
  }
  return peak
}

console.log('① stale primary + reaper 없음 · 두 프로세스 (실제 spawn · 안무 고정)')
{
  const real = await raceOnce(CHILD_REAL, 3)
  console.log(`   지금 프로토콜  maxConcurrent = ${real}`)
  check(`🔴 동시 진입이 없다 — maxConcurrent === 1 (측정 ${real})`, real === 1)
  /**
   * 🔴 **대조군**: 같은 하네스·같은 안무로 옛 프로토콜을 돌린다.
   *    여기서 2가 나와야 이 시험이 경쟁을 실제로 잡아낸다는 뜻이다 —
   *    즉 보호 로직을 지우면 본 시험이 FAIL 한다는 증거다.
   */
  const legacy = await raceOnce(CHILD_LEGACY, 3)
  console.log(`   대조군(옛)     maxConcurrent = ${legacy}   ← 2 여야 이 시험에 검증력이 있다`)
  check(`🔴 대조군(옛 프로토콜)은 2가 나온다 — 시험에 검증력이 있다 (측정 ${legacy})`, legacy === 2)
}

// ─────────────────────────────────────────────────────────
// ①-B 두 프로세스가 **같은 stale reaper** 를 만났을 때 (실제 spawn)
//
//     🔴 2026-09-09 Codex 재현: 회수를 reaper 계층에 두면 같은 TOCTOU 가 그대로 재현된다.
//        A 가 reaper 를 교체하고 자기 token 을 확인한 **뒤** B 가 낡은 관측으로 다시 교체하면,
//        A 의 확인은 이미 지나갔다. 둘 다 primary 를 바꾸고 둘 다 들어간다(실측 2).
//     🔴 그래서 지금 계약은 **회수하지 않는다** — 둘 다 못 들어가고 reaper 는 그대로 남는다.
// ─────────────────────────────────────────────────────────

/** 지금 프로토콜: 그냥 잠금을 시도한다. stale reaper 앞에서는 못 들어가야 한다 */
const CHILD_REAPER_REAL = `
import { appendFileSync } from 'node:fs'
import { setGuardRoot, withGuardLock } from ${JSON.stringify(STORE)}
setGuardRoot(process.env.GUARD_ROOT)
const ROLE = process.env.ROLE
try {
  // 🔴 잠금 안은 **동기**다 — Promise 를 돌려주면 store 가 던진다
  await withGuardLock('82cook', () => {
    appendFileSync(process.env.OUT, JSON.stringify({ ev: 'enter', t: Date.now(), role: ROLE }) + '\\n')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    appendFileSync(process.env.OUT, JSON.stringify({ ev: 'exit', t: Date.now(), role: ROLE }) + '\\n')
  }, { waitMs: 900 })
} catch (e) {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'blocked', role: ROLE, why: String(e.message) }) + '\\n')
}
`

/**
 * 🔴 **대조군 — 회수를 되살린 reaper 프로토콜.**
 *    `wx` → `EEXIST` → stale 이면 rename 으로 교체 → 읽어서 내 token 인지 확인.
 *    Codex 가 보고한 순서를 안무로 못박으면 여기서 **두 주인**이 나온다.
 *    이 값이 2 여야 이 시험이 reaper 계층 경쟁을 잡아낼 힘이 있다는 뜻이다.
 */
const CHILD_REAPER_LEGACY = `
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = process.env.GUARD_ROOT, SYNC = process.env.SYNC, ROLE = process.env.ROLE
const LOCK = join(ROOT, 'collect-guard-82cook.json.lock')
const REAP = join(ROOT, 'collect-guard-82cook.json.reap')
const TTL = ${LOCK_TTL_MS}, RTTL = ${REAPER_TTL_MS}
const tok = ROLE + '-' + process.pid
const nap = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
const touch = (n) => { try { writeFileSync(join(SYNC, n), '1') } catch { /* noop */ } }
const wait = (n) => { const t0 = Date.now(); while (!existsSync(join(SYNC, n)) && Date.now() - t0 < 9000) nap(2) }

function acquireReaperLegacy() {
  try { writeFileSync(REAP, JSON.stringify({ at: Date.now(), token: tok }), { flag: 'wx' }); return true }
  catch (e) { if (e.code !== 'EEXIST') throw e }
  let cur
  try { cur = JSON.parse(readFileSync(REAP, 'utf-8')) } catch { return false }
  if (Date.now() - cur.at <= RTTL) return false
  // 🔴 여기가 결함이 사는 자리 — 관측(stale)과 교체 사이가 열려 있다
  if (ROLE === 'fast') wait('B-observed')
  else { touch('B-observed'); wait('A-armed') }
  const tmp = REAP + '.tmp-' + process.pid
  writeFileSync(tmp, JSON.stringify({ at: Date.now(), token: tok }))
  renameSync(tmp, REAP)
  return JSON.parse(readFileSync(REAP, 'utf-8')).token === tok   // 교체 후 읽기-확인
}

let got = false
if (acquireReaperLegacy()) {
  const held = JSON.parse(readFileSync(LOCK, 'utf-8'))
  const stale = Date.now() - held.at > TTL
  const stillMine = JSON.parse(readFileSync(REAP, 'utf-8')).token === tok   // stillHoldsReaper
  if (stale && stillMine) {
    // 🔴 A 는 여기까지 통과한 상태에서 B 에게 reaper 를 빼앗긴다
    if (ROLE === 'fast') { touch('A-armed'); wait('B-entered') }
    const tmp = LOCK + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify({ at: Date.now(), token: tok }))
    renameSync(tmp, LOCK)
    got = true
  }
}
if (got) {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'enter', t: Date.now(), role: ROLE }) + '\\n')
  if (ROLE === 'slow') touch('B-entered')
  await new Promise((r) => setTimeout(r, 250))
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'exit', t: Date.now(), role: ROLE }) + '\\n')
} else {
  appendFileSync(process.env.OUT, JSON.stringify({ ev: 'blocked', role: ROLE }) + '\\n')
}
`

/** stale primary + **stale reaper** 를 심고 두 프로세스를 붙인다 */
async function raceReaper(childSrc: string): Promise<{ peak: number; reaperToken: string | null }> {
  return withTempAsync(async (dir) => {
    const root = rootOf(dir)
    plantStaleLock(root, LOCK_TTL_MS * 10)
    const sync = join(dir, 'sync')
    mkdirSync(sync, { recursive: true })
    writeFileSync(reaperPath('82cook'), JSON.stringify({
      pid: 999_998, at: Date.now() - REAPER_TTL_MS * 10, host: 'local', token: 'dead-reaper',
    }))
    const script = join(dir, 'child.mts')
    writeFileSync(script, childSrc)
    const out = join(dir, 'ev.jsonl')
    writeFileSync(out, '')
    const base = { GUARD_ROOT: root, OUT: out, SYNC: sync }
    await Promise.all([
      runChild(dir, script, { ...base, ROLE: 'fast' }),
      runChild(dir, script, { ...base, ROLE: 'slow' }),
    ])
    const evs = readFileSync(out, 'utf-8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as { ev: string; t: number })
      .sort((a2, b2) => a2.t - b2.t)
    let cur = 0
    let mx = 0
    for (const e of evs) {
      if (e.ev === 'enter') { cur += 1; mx = Math.max(mx, cur) }
      if (e.ev === 'exit') cur -= 1
    }
    let reaperToken: string | null = null
    try { reaperToken = JSON.parse(readFileSync(reaperPath('82cook'), 'utf-8')).token as string } catch { /* 없다 */ }
    return { peak: mx, reaperToken }
  })
}

console.log('\n①-B stale primary + stale reaper 에 두 프로세스')
{
  const real = await raceReaper(CHILD_REAPER_REAL)
  console.log(`   지금 프로토콜  진입 = ${real.peak} · reaper token = ${real.reaperToken ?? '(사라짐)'}`)
  check(`🔴 stale reaper 앞에서는 **아무도** 들어가지 않는다 (측정 ${real.peak})`, real.peak === 0)
  check('🔴 stale reaper 를 다른 프로세스가 자동 교체하지 않는다 (token 그대로)',
    real.reaperToken === 'dead-reaper')

  const legacy = await raceReaper(CHILD_REAPER_LEGACY)
  console.log(`   대조군(회수판) 진입 = ${legacy.peak}   ← 2 여야 이 시험에 검증력이 있다`)
  check(`🔴 대조군(stale reaper 를 회수하는 판)은 2가 나온다 (측정 ${legacy.peak})`, legacy.peak === 2)
}

// ─────────────────────────────────────────────────────────
// ② 지연된 stale 관측자가 successor 를 지우지 못한다
// ─────────────────────────────────────────────────────────
console.log('\n② 지연된 관측자 vs successor')
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  plantStaleLock(root, LOCK_TTL_MS * 10)
  const lock = lockPath('82cook')

  /**
   * 🔴 자식이 stale 을 **관측만 하고** 멈춘 사이, 부모가 successor 가 된다.
   *    자식이 깨어나 회수를 시도하면 — 옛 코드는 그 자리에서 지웠다.
   *    지금은 reaper 를 잡아 **다시 읽어야** 하고, 그때 successor 는 갓 만들어져 stale 이 아니다.
   */
  const script = join(dir, 'observer.mts')
  writeFileSync(script, `
import { setGuardRoot, withGuardLock } from ${JSON.stringify(STORE)}
import { readFileSync, writeFileSync } from 'node:fs'
setGuardRoot(process.env.GUARD_ROOT)
// stale 을 한 번 본다(관측만)
writeFileSync(process.env.OBSERVED, readFileSync(process.env.LOCK, 'utf-8'))
// 부모가 successor 를 만들 때까지 기다린다
const { existsSync } = await import('node:fs')
while (!existsSync(process.env.SUCCESSOR)) { /* spin */ }
try {
  await withGuardLock('82cook', () => 'GOT', { waitMs: 400 })
  writeFileSync(process.env.RESULT, 'ENTERED')
} catch { writeFileSync(process.env.RESULT, 'BLOCKED') }
`)
  const observed = join(dir, 'observed')
  const successor = join(dir, 'SUCCESSOR')
  const result = join(dir, 'result')
  const child = runChild(dir, script, {
    GUARD_ROOT: root, LOCK: lock, OBSERVED: observed, SUCCESSOR: successor, RESULT: result,
  })
  // 자식이 stale 을 관측할 때까지 기다린다
  for (let i = 0; i < 400 && !existsSync(observed); i += 1) await sleep(25)
  check('🔴 자식이 stale 을 관측했다', existsSync(observed))

  // 부모가 successor 가 된다 (실제 코드로 회수)
  let successorToken = ''
  await withGuardLock('82cook', () => {
    successorToken = JSON.parse(readFileSync(lock, 'utf-8')).token as string
    writeFileSync(successor, 'go')
    // 🔴 잠금 안은 동기다 — 이벤트 루프를 놓지 않고 기다린다(자식은 별도 OS 프로세스다)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700)
    // 🔴 이 구간 내내 내 잠금이 그대로 남아 있어야 한다
    check('🔴 지연된 관측자가 successor 잠금을 지우지 못했다', existsSync(lock))
    check('🔴 그 잠금은 여전히 내 것이다 (token 유지)',
      existsSync(lock) && (JSON.parse(readFileSync(lock, 'utf-8')).token as string) === successorToken)
  }, { waitMs: 4000 })
  await child
  // 🔴 부모가 700ms 쥐고 있는 동안 자식의 마감(400ms)이 먼저 온다 —
  //    successor 를 지우고 들어오는 일이 없어야 한다
  check('🔴 자식은 successor 를 지우지 못하고 마감으로 끝났다',
    existsSync(result) && readFileSync(result, 'utf-8') === 'BLOCKED')
})

// ─────────────────────────────────────────────────────────
// ③ 새 빈 lock 을 stale 로 오판하지 않는다
// ─────────────────────────────────────────────────────────
console.log('\n③ 갓 만들어진 lock')
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  setGuardRoot(root)
  const p = lockPath('82cook')
  mkdirSync(dirname(p), { recursive: true })
  // 🔴 내용이 **비어 있는** 새 잠금 — 옛 판은 이것을 "죽은 것" 으로 보고 훔쳤다
  writeFileSync(p, '')
  let entered = false
  try { await withGuardLock('82cook', () => { entered = true }, { waitMs: 600 }) } catch { /* 기대한 실패 */ }
  check('🔴 빈 잠금을 훔치지 않는다', !entered)
  check('🔴 그 잠금은 그대로 남아 있다', existsSync(p))
})

// ─────────────────────────────────────────────────────────
// ④ 오래된 owner 가 새 owner 의 lock 을 지우지 못한다
// ─────────────────────────────────────────────────────────
console.log('\n④ 옛 owner 의 뒤늦은 해제')
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  setGuardRoot(root)
  const p = lockPath('82cook')
  mkdirSync(dirname(p), { recursive: true })
  let newOwnerToken = ''
  await withGuardLock('82cook', () => {
    // 잠금 안에서 **남이 뺏어간 것처럼** 파일을 바꿔 둔다
    newOwnerToken = 'other-owner'
    writeFileSync(p, JSON.stringify({ pid: 1, at: Date.now(), host: 'local', token: newOwnerToken }))
  }, { waitMs: 2000 })
  check('🔴 내 token 이 아니면 해제가 지우지 않는다', existsSync(p))
  check('🔴 새 owner 의 token 이 그대로다',
    existsSync(p) && (JSON.parse(readFileSync(p, 'utf-8')).token as string) === newOwnerToken)
})

// ─────────────────────────────────────────────────────────
// ⑤ EACCES · EISDIR · 손상 — absent 가 아니고 fail-closed
// ─────────────────────────────────────────────────────────
console.log('\n⑤ 읽을 수 없는 lock (EISDIR · EACCES · 손상)')
for (const [label, plant] of [
  ['EISDIR (디렉터리)', (p: string): void => { mkdirSync(p, { recursive: true }) }],
  ['EACCES (권한 없음)', (p: string): void => { writeFileSync(p, '{}'); chmodSync(p, 0o000) }],
  ['손상 (JSON 아님)', (p: string): void => { writeFileSync(p, 'not json at all') }],
] as const) {
  await withTempAsync(async (dir) => {
    const root = rootOf(dir)
    setGuardRoot(root)
    const p = lockPath('82cook')
    mkdirSync(dirname(p), { recursive: true })
    plant(p)
    const t0 = Date.now()
    let entered = false
    let threw = ''
    try { await withGuardLock('82cook', () => { entered = true }, { waitMs: 700 }) }
    catch (e) { threw = (e as Error).message }
    const took = Date.now() - t0
    check(`🔴 [${label}] 잠금을 얻지 않는다 (fail-closed)`, !entered)
    check(`🔴 [${label}] 마감 안에 명확한 오류로 끝난다 (${took}ms)`,
      threw.includes('얻지 못했다') && took >= 700 && took < 6_000)
    check(`🔴 [${label}] absent 로 읽지 않는다 — 무한 루프가 없다`, took < 6_000)
    if (label.startsWith('EACCES')) { try { chmodSync(p, 0o600) } catch { /* 정리용 */ } }
  })
}

// ─────────────────────────────────────────────────────────
// ⑥ 시효 — **primary 는 회수하고 reaper 는 회수하지 않는다**
//
//    🔴 예전 이 자리에는 "시효가 지난 reaper 도 회수된다" 가 🟢 로 있었다.
//       그 계약 자체가 reaper 계층 TOCTOU 의 원인이라 **지우고 아래로 바꾼다.**
// ─────────────────────────────────────────────────────────
console.log('\n⑥ 시효 — primary 만 회수한다')
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  plantStaleLock(root, LOCK_TTL_MS * 3)
  // 🔴 reaper 가 없을 때만 새 reaper 를 `wx` 로 얻어 stale primary 를 회수한다
  check('🔴 시작 시점에 reaper 가 없다', !existsSync(reaperPath('82cook')))
  let entered = false
  await withGuardLock('82cook', () => { entered = true }, { waitMs: 2000 })
  check('🟢 진짜 stale primary 는 회수한다', entered)
})
for (const [label, at, token] of [
  ['시효가 지난', Date.now() - REAPER_TTL_MS * 3, 'dead-reaper'],
  ['살아 있는', Date.now(), 'live-reaper'],
] as const) {
  await withTempAsync(async (dir) => {
    const root = rootOf(dir)
    plantStaleLock(root, LOCK_TTL_MS * 3)
    setGuardRoot(root)
    /**
     * 🔴 **살아 있든 시효가 지났든 똑같이 물러난다.** reaper 를 뺏는 길은 코드에 없다 —
     *    "시효가 지났으니 죽었겠지" 를 근거로 뺏는 순간 그 판정 자체가 다시 경쟁이 된다.
     */
    writeFileSync(reaperPath('82cook'),
      JSON.stringify({ pid: 999_999, at, host: 'local', token }))
    const before = readFileSync(reaperPath('82cook'), 'utf-8')
    let entered = false
    let threw = ''
    try { await withGuardLock('82cook', () => { entered = true }, { waitMs: 600 }) }
    catch (e) { threw = (e as Error).message }
    check(`🔴 [${label} reaper] 뺏지 않는다 — 이번 회차는 들어가지 않는다`, !entered)
    check(`🔴 [${label} reaper] 파일을 바꾸지도 지우지도 않는다`,
      existsSync(reaperPath('82cook')) && readFileSync(reaperPath('82cook'), 'utf-8') === before)
    check(`🔴 [${label} reaper] 마감을 넘기면 명확한 오류로 끝난다`, threw.includes('얻지 못했다'))
    if (label === '시효가 지난') {
      // 🔴 남은 reaper 는 **운영 이상**이다 — 오류가 그것과 사람 조치를 함께 말해야 한다
      check('🔴 오류가 남은 reaper 를 지목한다', threw.includes(reaperPath('82cook')))
      check('🔴 오류가 "자동으로 회수하지 않는다" 를 밝힌다', threw.includes('자동으로 회수하지 않는다'))
      check('🔴 오류가 사람 복구 절차를 준다 (job 정지 → 소유 프로세스 확인 → 삭제)',
        threw.includes('수집 job 을 모두 멈춘다')
        && threw.includes('소유 프로세스가 없음을 확인한다')
        && threw.includes('그 뒤에만 이 파일을 지운다'))
      check('🔴 오류가 회수 잠금에 막힌 횟수를 남긴다', /회수 잠금에 막힘 \d+회/.test(threw))
    } else {
      // 🔴 아직 시효 안이면 "이상" 으로 떠들지 않는다 — 정상 경합이다
      check('🔴 살아 있는 reaper 는 운영 이상으로 보고하지 않는다',
        !threw.includes('자동으로 회수하지 않는다'))
    }
  })
}

// ─────────────────────────────────────────────────────────
// ⑦ 정상 경로 회귀 — 잠금은 풀리고 다음 사람이 바로 얻는다
// ─────────────────────────────────────────────────────────
console.log('\n⑦ 정상 획득·해제')
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  setGuardRoot(root)
  mkdirSync(dirname(lockPath('82cook')), { recursive: true })
  const order: string[] = []
  await withGuardLock('82cook', () => { order.push('a') }, { waitMs: 2000 })
  check('🔴 해제하면 잠금 파일이 사라진다', !existsSync(lockPath('82cook')))
  check('🔴 reaper 도 남기지 않는다', !existsSync(reaperPath('82cook')))
  await withGuardLock('82cook', () => { order.push('b') }, { waitMs: 2000 })
  check('🟢 다음 사람이 곧바로 얻는다', order.join() === 'a,b')
  // 🔴 상태 파일 경로가 주입된 뿌리 아래다
  check('🔴 잠금·상태가 주입된 뿌리 아래에 있다',
    guardPath('82cook').startsWith(root) && lockPath('82cook').startsWith(root))
})

// ─────────────────────────────────────────────────────────
// ⑨ saveGuard fencing — 🔴 **승계당한 옛 주인은 상태를 쓰지 못한다**
//
//    2026-09-09 재현: `lockedSources.has(source)` 만 보던 판은 승계당한 옛 owner 의
//    write 를 받아들였다(`staleOwnerWriteAccepted = true`). 예산·차단기가 덮였다.
// ─────────────────────────────────────────────────────────
console.log('\n⑨ saveGuard fencing')

/** 잠금 안에서 쓸 수 있는 최소 상태 하나 */
const stateWith = (requestsToday: number): ReturnType<typeof newGuardState> =>
  ({ ...newGuardState('82cook', kstDayOf(new Date())), requestsToday })

// ── ⑨-1 정상 owner 는 쓴다 (회귀) ──
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  setGuardRoot(root)
  mkdirSync(dirname(lockPath('82cook')), { recursive: true })
  await withGuardLock('82cook', () => { saveGuard(stateWith(7)) }, { waitMs: 2000 })
  check('🟢 정상 owner 의 save 는 성공한다', existsSync(guardPath('82cook')))
  check('🟢 쓴 값이 그대로 읽힌다',
    (JSON.parse(readFileSync(guardPath('82cook'), 'utf-8')).requestsToday as number) === 7)
  check('🔴 save 가 reaper 를 남기지 않는다', !existsSync(reaperPath('82cook')))
})

// ── ⑨-2 🔴 **실제 프로세스가 잠금을 승계한 뒤** 옛 주인이 쓰려 한다 ──
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  setGuardRoot(root)
  mkdirSync(dirname(lockPath('82cook')), { recursive: true })

  /**
   * 🔴 자식은 **실제 코드로** 승계한다 — reaper 를 `wx` 로 얻어 stale primary 를 rename 교체한다.
   *    합성 파일 조작이 아니라 운영 경로 그대로다.
   */
  const script = join(dir, 'taker.mts')
  writeFileSync(script, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { lockPath, setGuardRoot, withGuardLock } from ${JSON.stringify(STORE)}
setGuardRoot(process.env.GUARD_ROOT)
const nap = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
writeFileSync(process.env.READY, '1')
while (!existsSync(process.env.GO)) nap(2)
await withGuardLock('82cook', () => {
  writeFileSync(process.env.TOOK, readFileSync(lockPath('82cook'), 'utf-8'))
  nap(900)   // 옛 주인이 save 를 시도하는 동안 계속 쥐고 있는다
}, { waitMs: 6000 })
`)
  const ready = join(dir, 'READY')
  const go = join(dir, 'GO')
  const took = join(dir, 'TOOK')
  const child = runChild(dir, script, { GUARD_ROOT: root, READY: ready, GO: go, TOOK: took })
  for (let i = 0; i < 400 && !existsSync(ready); i += 1) await sleep(25)
  check('🔴 승계 프로세스가 준비됐다', existsSync(ready))

  let saveThrew = ''
  let successorToken = ''
  let lockAfterSave = ''
  let stateFileAfterSave = true
  const nap = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }
  // 🔴 내 잠금이 **시효를 넘긴 것처럼** 보이게 해 자식이 정상 경로로 승계하게 한다
  const past = (): Date => new Date(Date.now() - LOCK_TTL_MS * 10)
  await withGuardLock('82cook', () => {
    writeFileSync(go, '1')
    for (let i = 0; i < 400 && !existsSync(took); i += 1) nap(20)
    successorToken = existsSync(took)
      ? (JSON.parse(readFileSync(took, 'utf-8')).token as string)
      : ''
    // 🔴 이 시점의 나는 이미 **옛 주인**이다. 그래도 쓰려고 시도한다
    try { saveGuard(stateWith(999)); saveThrew = '' }
    catch (e) { saveThrew = (e as Error).message }
    // 🔴 **판정은 여기서 한다** — 자식이 아직 쥐고 있는 동안이다.
    //    자식이 정상 해제한 뒤에 보면 "잠금이 없다" 가 되어 아무것도 증명하지 못한다
    lockAfterSave = existsSync(lockPath('82cook'))
      ? (JSON.parse(readFileSync(lockPath('82cook'), 'utf-8')).token as string)
      : '(사라짐)'
    stateFileAfterSave = existsSync(guardPath('82cook'))
  }, { now: past, waitMs: 5000 })
  await child

  check('🔴 자식이 실제 코드로 잠금을 승계했다', successorToken !== '' && successorToken !== 'dead')
  check('🔴 승계당한 옛 주인의 saveGuard 가 던진다', saveThrew.includes('넘어갔다'))
  check('🔴 그 오류가 fail-closed 라고 밝힌다', saveThrew.includes('fail-closed'))
  check('🔴 상태 파일 write 0 — 예산·차단기를 덮지 못했다', !stateFileAfterSave)
  check('🔴 save 시도 뒤에도 successor 잠금이 그대로다', lockAfterSave === successorToken)
  check('🔴 실패한 save 도 reaper 를 남기지 않는다', !existsSync(reaperPath('82cook')))
})

// ── ⑨-3 잠금이 사라졌거나 읽을 수 없으면 쓰지 않는다 ──
for (const [label, sabotage] of [
  ['잠금이 사라짐', (p: string): void => { rmSync(p, { force: true }) }],
  ['잠금이 손상됨', (p: string): void => { writeFileSync(p, 'not json at all') }],
] as const) {
  await withTempAsync(async (dir) => {
    const root = rootOf(dir)
    setGuardRoot(root)
    mkdirSync(dirname(lockPath('82cook')), { recursive: true })
    let threw = ''
    await withGuardLock('82cook', () => {
      sabotage(lockPath('82cook'))
      try { saveGuard(stateWith(5)) } catch (e) { threw = (e as Error).message }
    }, { waitMs: 2000 })
    check(`🔴 [${label}] saveGuard 가 던진다`, threw.includes('확인할 수 없다'))
    check(`🔴 [${label}] 상태 파일 write 0`, !existsSync(guardPath('82cook')))
  })
}

// ── ⑨-4 reaper 를 못 얻으면 쓰지 않는다 (회수 금지 계약과 같은 결) ──
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  setGuardRoot(root)
  mkdirSync(dirname(lockPath('82cook')), { recursive: true })
  let threw = ''
  await withGuardLock('82cook', () => {
    // 🔴 잠금을 쥔 뒤 남이 reaper 를 잡은 상황 — 뺏지 않고 쓰지도 않는다
    writeFileSync(reaperPath('82cook'),
      JSON.stringify({ pid: 999_999, at: Date.now(), host: 'local', token: 'other-reaper' }))
    try { saveGuard(stateWith(5)) } catch (e) { threw = (e as Error).message }
  }, { waitMs: 2000 })
  check('🔴 reaper 를 못 얻으면 saveGuard 가 던진다', threw.includes('회수 잠금을 얻지 못했다'))
  check('🔴 그때도 상태 파일 write 0', !existsSync(guardPath('82cook')))
  check('🔴 남의 reaper 를 뺏지 않는다',
    (JSON.parse(readFileSync(reaperPath('82cook'), 'utf-8')).token as string) === 'other-reaper')
  rmSync(reaperPath('82cook'), { force: true })
})

// ── ⑨-5 잠금 안에서 Promise 를 돌려주면 거부한다 (TTL 초과 callback 봉쇄) ──
await withTempAsync(async (dir) => {
  const root = rootOf(dir)
  setGuardRoot(root)
  mkdirSync(dirname(lockPath('82cook')), { recursive: true })
  let threw = ''
  try {
    await withGuardLock('82cook',
      (() => Promise.resolve('늦게 온다')) as unknown as () => string, { waitMs: 2000 })
  } catch (e) { threw = (e as Error).message }
  check('🔴 잠금 안에서 Promise 를 돌려주면 던진다', threw.includes('동기여야 한다'))
  check('🔴 그래도 잠금은 풀린다', !existsSync(lockPath('82cook')))
})

resetGuardRoot()
check('🔴 뿌리를 되돌리면 운영 기본 경로다', guardRoot() === './.microseed-data')

// ─────────────────────────────────────────────────────────
// ⑧ 저장소를 건드리지 않았다
// ─────────────────────────────────────────────────────────
console.log('\n⑧ 저장소 불변')
{
  const repoAfter = existsSync(REPO_DATA)
    ? readdirSync(REPO_DATA).filter((f) => f.startsWith('collect-guard')).sort().join()
    : '(없음)'
  check('🔴 저장소 .microseed-data 의 잠금·상태 파일이 그대로다', repoBefore === repoAfter)
  check('🔴 이 fixture 가 저장소에 잠금을 만들지 않았다',
    !existsSync(join(REPO_DATA, 'collect-guard-82cook.json.lock')))
  void statSync
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
