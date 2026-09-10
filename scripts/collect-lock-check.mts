#!/usr/bin/env tsx
/**
 * 수집 락 **행동 검증** — 🔴 실제 OS 프로세스 · 강제 barrier · **대조군 포함**
 *
 * 🔴 **왜 대조군이 필요한가** (2026-09-10).
 *
 *    앞선 fixture 는 "인수가 끝난 **뒤** 옛 token 으로 release 만" 불렀다.
 *    그건 경쟁이 아니다 — 순서가 이미 정해져 있으니 무엇을 넣어도 통과한다.
 *
 *    진짜 물음은 이것이다: **A 와 B 가 같은 stale 을 보고 동시에 달려들면
 *    둘 다 들어가는가?** 그건 두 프로세스를 같은 순간에 출발시켜야만 드러난다.
 *
 *    그래서 **옛 rename 방식을 대조군으로 함께 돌린다.** 대조군이
 *    `maxConcurrent=2` 를 내야 이 검사에 판별력이 있다는 것이 증명된다.
 *
 * 🔴 `/tmp` 아래 임시 경로만 쓴다 — 운영 락을 건드리지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireLock, releaseLock, currentLockToken, lockAnomaly } from './lib/collect-lock.mjs'

let pass = 0
let fail = 0
const check = (label: string, okv: boolean, detail = ''): void => {
  if (okv) { pass += 1; console.log(`  ✅ ${label}`); return }
  fail += 1
  console.log(`  ❌ ${label}${detail === '' ? '' : `\n     ${detail}`}`)
}

const TTL = 30 * 60_000
const base = mkdtempSync(join(tmpdir(), 'soran-lock-'))
const REPO = process.cwd()

console.log('\n══ 수집 락 행동 검증 (🔴 실제 프로세스 경쟁 · 대조군 포함) ══\n')

/**
 * 🔴 두 프로세스를 띄워 barrier 를 기다리게 하고 **한꺼번에** 출발시킨다.
 *    `impl` 이 'new' 면 지금 구현, 'legacy-rename' 이면 옛 방식(대조군)이다.
 */
function race(opts: {
  name: string
  impl: 'new' | 'legacy-rename'
  /** 시작 상태를 만든다 (stale 락을 심는 등) */
  setup?: (lockPath: string) => void
}): { winners: number; results: string[]; holders: string[] } {
  const dir = mkdtempSync(join(base, `${opts.name}-`))
  const lockPath = join(dir, 'x.lock')
  const barrier = join(dir, 'go')
  opts.setup?.(lockPath)

  const worker = join(dir, 'w.mts')
  /**
   * 🔴 **획득에 성공하면 자기 token 을 out 에 적는다.**
   *    두 파일에 서로 다른 token 이 적히면 그 순간 두 주인이 있었다는 뜻이다.
   */
  const newImpl = `
import { acquireLock } from '${join(REPO, 'scripts/lib/collect-lock.mjs')}'
const r = acquireLock(path!, Date.now(), ${TTL})
writeFileSync(out!, r.ok ? 'WON:' + r.handle.token : 'LOST:' + r.kind, 'utf-8')
`
  /**
   * 🔴 **대조군 — 옛 판이 하던 그대로.** readLock → rename 으로 stale 을 인수한다.
   *    이 방식이 두 주인을 만든다는 것을 여기서 실제로 보인다.
   */
  const legacyImpl = `
import { readFileSync as rf, writeFileSync as wf, renameSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
const token = randomUUID()
const body = JSON.stringify({ token, pid: process.pid, at: new Date().toISOString() })
let won = false
try {
  wf(path!, body, { flag: 'wx' })
  won = true
} catch {
  // 🔴 옛 방식: stale 을 읽고 → (창) → rename 으로 갈아치운다
  let held = null
  try { held = JSON.parse(rf(path!, 'utf-8')) } catch { /* ignore */ }
  const at = held?.at ? Date.parse(held.at) : statSync(path!).mtimeMs
  if (Date.now() - at > ${TTL}) {
    const tmp = path! + '.take-' + process.pid
    wf(tmp, body, { flag: 'wx' })
    // 🔴 여기가 창이다 — 내가 본 stale 이 아직 그대로인지 확인한 "뒤" rename 한다
    let still = null
    try { still = JSON.parse(rf(path!, 'utf-8')) } catch { /* ignore */ }
    if ((still?.token ?? null) === (held?.token ?? null)) {
      // 🔴 워커마다 다른 지연 — 문서화된 순서를 강제한다:
      //    A 가 교체하고 확인을 통과한 **뒤에** B 가 과거 관측으로 다시 교체한다
      const hold = Number(process.argv[5] ?? '0')
      const until0 = Date.now() + hold
      while (Date.now() < until0) { /* 창을 벌린다 */ }
      renameSync(tmp, path!)
      let mine = null
      try { mine = JSON.parse(rf(path!, 'utf-8')) } catch { /* ignore */ }
      won = mine?.token === token
    }
  }
}
wf(out!, won ? 'WON:' + token : 'LOST:x', 'utf-8')
`
  const body = opts.impl === 'new' ? newImpl : legacyImpl
  writeFileSync(worker, `
import { existsSync, writeFileSync } from 'node:fs'
const [path, barrier, out] = process.argv.slice(2)
while (!existsSync(barrier!)) { /* spin */ }
${body}
`, 'utf-8')

  const out1 = join(dir, 'o1')
  const out2 = join(dir, 'o2')
  const sh = join(dir, 'race.sh')
  writeFileSync(sh, `#!/bin/sh
cd "${REPO}"
npx tsx "${worker}" "${lockPath}" "${barrier}" "${out1}" 100 &
P1=$!
npx tsx "${worker}" "${lockPath}" "${barrier}" "${out2}" 900 &
P2=$!
sleep 6
touch "${barrier}"
wait $P1 $P2
`, { encoding: 'utf-8', mode: 0o700 })
  execFileSync('/bin/sh', [sh], { timeout: 180_000, stdio: 'ignore' })

  const results = [out1, out2].map((p) => (existsSync(p) ? readFileSync(p, 'utf-8') : ''))
  const holders = results.filter((r) => r.startsWith('WON:')).map((r) => r.slice(4))
  return { winners: holders.length, results, holders }
}

/** 🔴 시효가 지난 stale 락을 심는다 */
const plantStale = (lockPath: string): void => {
  writeFileSync(lockPath, JSON.stringify({
    token: 'stale-token', pid: 999_999,
    at: new Date(Date.now() - TTL * 3).toISOString(),
  }), { encoding: 'utf-8', mode: 0o600 })
}

try {
  // ── ① 빈자리 동시 획득 — 승자는 정확히 1명 ──
  {
    const r = race({ name: 'absent', impl: 'new' })
    check(`빈자리 동시 획득: maxConcurrent=1 (얻은 값 ${r.winners}) — ${r.results.join(' , ')}`,
      r.winners === 1)
    check('진 쪽은 LOST 를 받는다', r.results.filter((x) => x.startsWith('LOST')).length === 1)
  }

  /**
   * ── ② 🔴 **같은 stale 을 둘이 함께 보고 달려든다**
   *    지금 구현은 아무도 뺏지 않는다 → 승자 0 (fail-closed).
   *    중요한 것은 **두 주인이 생기지 않는 것**이다.
   */
  {
    const r = race({ name: 'stale-new', impl: 'new', setup: plantStale })
    check(`stale 동시 인수 시도: maxConcurrent ≤ 1 (얻은 값 ${r.winners}) — ${r.results.join(' , ')}`,
      r.winners <= 1)
    check('🔴 자동으로 뺏지 않는다 — 승자 0 (fail-closed)', r.winners === 0)
    check('둘 다 STALE_HELD 를 받는다',
      r.results.every((x) => x.includes('STALE_HELD')), r.results.join(' , '))
  }

  /**
   * ── ③ 🔴 **대조군 — 옛 rename 방식**
   *    같은 시나리오에서 두 주인이 생겨야 한다. 그래야 위 검사에 판별력이 있다.
   */
  {
    const r = race({ name: 'stale-legacy', impl: 'legacy-rename', setup: plantStale })
    check(`대조군(옛 rename): maxConcurrent=2 가 나온다 (얻은 값 ${r.winners}) — ${r.results.join(' , ')}`,
      r.winners === 2,
      '대조군이 2를 내지 못하면 이 fixture 는 아무것도 증명하지 못한다')
    check('대조군의 두 주인은 서로 다른 token 이다',
      r.holders.length === 2 && r.holders[0] !== r.holders[1])
  }

  // ── ④ 살아 있는 락은 뺏기지 않는다 ──
  {
    const path = join(base, 'live.lock')
    const held = acquireLock(path, Date.now(), TTL)
    if (!held.ok) throw new Error('setup')
    const second = acquireLock(path, Date.now(), TTL)
    check('살아 있는 락은 두 번째가 진다', !second.ok && second.kind === 'HELD')
    check('원 owner 는 그대로다', currentLockToken(path) === held.handle.token)
    releaseLock(held.handle)
  }

  // ── ⑤ token 대조 해제 ──
  {
    const path = join(base, 'tok.lock')
    const mine = acquireLock(path, Date.now(), TTL)
    if (!mine.ok) throw new Error('setup')
    const before = currentLockToken(path)
    check('잘못된 token release 는 NOT_MINE 이다',
      releaseLock({ path, token: 'not-mine' }) === 'NOT_MINE')
    check('그때 락은 변하지 않는다', currentLockToken(path) === before && existsSync(path))
    check('올바른 token 은 해제된다',
      releaseLock(mine.handle) === 'RELEASED' && !existsSync(path))
    check('없는 락 해제는 ABSENT 다', releaseLock({ path, token: 'x' }) === 'ABSENT')
  }

  /**
   * ── ⑥ 🔴 **옛 owner 가 후임을 지울 수 없다**
   *    자동 회수를 없앴으므로 내가 쥔 동안 남이 그 자리를 비울 수 없다 —
   *    그래서 후임이 생기는 상황 자체가 만들어지지 않는다.
   *    그래도 옛 token 을 들고 오면 아무 일도 없어야 한다.
   */
  {
    const path = join(base, 'succ.lock')
    const first = acquireLock(path, Date.now(), TTL)
    if (!first.ok) throw new Error('setup')
    releaseLock(first.handle)
    const second = acquireLock(path, Date.now(), TTL)
    if (!second.ok) throw new Error('setup')
    const secondToken = currentLockToken(path)
    check('옛 owner 의 늦은 release 는 NOT_MINE 이다',
      releaseLock(first.handle) === 'NOT_MINE')
    check('후임 락이 그대로 남아 있다',
      currentLockToken(path) === secondToken && existsSync(path))
    releaseLock(second.handle)
  }

  // ── ⑦ 남은 죽은 락은 사람이 봐야 할 이상으로 나온다 ──
  {
    const path = join(base, 'anom.lock')
    plantStale(path)
    const a = lockAnomaly(path, Date.now(), TTL)
    check('죽은 락을 이상으로 낸다', a !== null && (a.ageMs ?? 0) > TTL)
    const fresh = join(base, 'fresh.lock')
    const h = acquireLock(fresh, Date.now(), TTL)
    check('살아 있는 락은 이상이 아니다', lockAnomaly(fresh, Date.now(), TTL) === null)
    if (h.ok) releaseLock(h.handle)
    /**
     * 🔴 내용이 깨졌어도 **mtime 으로 나이는 알 수 있다** — 그건 미상이 아니다.
     *    미상은 파일 자체를 못 읽을 때다. 깨진 최신 파일은 살아 있다고 본다(fail-closed).
     */
    const bad = join(base, 'bad.lock')
    writeFileSync(bad, 'not json', 'utf-8')
    check('내용이 깨진 최신 락은 살아 있다고 본다', lockAnomaly(bad, Date.now(), TTL) === null)
    check('그때 획득도 막힌다 (fail-closed)', (() => {
      const r = acquireLock(bad, Date.now(), TTL)
      return !r.ok && (r.kind === 'HELD' || r.kind === 'UNREADABLE')
    })())
    check('내용이 깨졌고 오래됐으면 이상이다',
      lockAnomaly(bad, Date.now() + TTL * 3, TTL) !== null)
  }


  /**
   * ── ⑨ 🔴 **락은 결과가 확정될 때까지 유지된다**
   *
   *    A 가 상세를 읽고 **저장·원장 확정 전에** 락을 놓으면,
   *    그 틈에 들어온 B 가 같은 글을 다시 상세 조회한다.
   *    요청은 두 배로 나가고 원장에는 한 번만 남는다.
   *
   *    실제 프로세스로 재현한다: A 는 상세 카운터를 올린 뒤 barrier 에서 멈추고,
   *    그동안 B·C·D 셋이 같은 source 에 진입을 시도한다.
   */
  {
    const dir = mkdtempSync(join(base, 'scope-'))
    const lockPath = join(dir, 'x.lock')
    const hold = join(dir, 'hold')      // A 를 세워 두는 barrier
    const go = join(dir, 'go')          // 모두의 출발 barrier
    const detailLog = join(dir, 'detail.log')   // 상세 진입 기록 (append)
    const ledger = join(dir, 'ledger.jsonl')

    /**
     * 🔴 **수집기와 같은 순서**를 최소로 흉내 낸다:
     *    락 획득 → 상세 진입 기록 → (저장 전 대기) → 산출·원장 확정 → 락 해제.
     *    `RELEASE_EARLY=1` 이면 옛 판처럼 **확정 전에** 놓는다(대조군).
     */
    const worker = join(dir, 'w.mts')
    writeFileSync(worker, `
import { existsSync, appendFileSync, readFileSync, writeFileSync as wf } from 'node:fs'
import { acquireLock, releaseLock } from '${join(REPO, 'scripts/lib/collect-lock.mjs')}'
const [lockPath, go, hold, detailLog, ledger, name, early] = process.argv.slice(2)
// 🔴 워커마다 다른 출발 barrier — A 가 먼저 잡는 것을 **보장**한다.
//    출발을 같게 두면 누가 먼저 잡을지 운에 달리고, 검사가 흔들린다.
while (!existsSync(go!)) { /* spin */ }
/**
 * 🔴 A 는 곧바로 잡고, 뒤따르는 실행(B·C)은 **잠시 기다렸다 다시 시도**한다.
 *    실제 예약 회차도 한 번 지고 끝나지 않고 다음 슬롯에 다시 온다 —
 *    한 번만 시도하면 "A 가 조기 해제한 틈" 이 실험에 잡히지 않는다.
 */
let r = acquireLock(lockPath!, Date.now(), ${TTL})
if (!r.ok && name !== 'A') {
  const until = Date.now() + 8000
  while (!r.ok && Date.now() < until) {
    const t = Date.now() + 120
    while (Date.now() < t) { /* backoff */ }
    r = acquireLock(lockPath!, Date.now(), ${TTL})
  }
}
if (!r.ok) { process.stdout.write('LOST:' + r.kind); process.exit(0) }
try {
  // 🔴 이미 확정된 글은 다시 열지 않는다 (원장을 본다)
  let done = new Set()
  try {
    for (const l of readFileSync(ledger!, 'utf-8').split('\\n')) {
      if (l.trim()) done.add(JSON.parse(l).articleId)
    }
  } catch { /* 아직 없다 */ }
  if (!done.has('A1')) {
    // 🔴 상세 진입 — 이 줄 수가 곧 "몇 번 열었나" 다
    appendFileSync(detailLog!, name + '\\n', 'utf-8')
    if (early === '1') {
      // 🔴 대조군: 확정 전에 락을 놓는다
      releaseLock(r.handle)
    }
    // 저장 직전에 멈춘다 (A 만 hold 를 기다린다)
    if (name === 'A') { while (!existsSync(hold!)) { /* spin */ } }
    appendFileSync(ledger!, JSON.stringify({ articleId: 'A1', outcome: 'kept', by: name }) + '\\n', 'utf-8')
  }
} finally {
  releaseLock(r.handle)
}
process.stdout.write('WON')
`, 'utf-8')

    const run = (early: '0' | '1'): { detailEntries: number; ledgerRows: number } => {
      const d = mkdtempSync(join(dir, `r${early}-`))
      const lp = join(d, 'x.lock')
      const dl = join(d, 'detail.log')
      const lg = join(d, 'ledger.jsonl')
      const g = join(d, 'go')
      const h = join(d, 'hold')
      const sh = join(d, 'run.sh')
      const g2 = join(d, 'go2')
      writeFileSync(sh, `#!/bin/sh
cd "${REPO}"
npx tsx "${worker}" "${lp}" "${g}" "${h}" "${dl}" "${lg}" A ${early} &
PA=$!
npx tsx "${worker}" "${lp}" "${g2}" "${h}" "${dl}" "${lg}" B ${early} &
PB=$!
npx tsx "${worker}" "${lp}" "${g2}" "${h}" "${dl}" "${lg}" C ${early} &
PC=$!
sleep 6
# 🔴 A 를 먼저 출발시켜 락을 잡게 한다 (누가 먼저인지 운에 맡기지 않는다)
touch "${g}"
sleep 2
# 🔴 A 가 상세를 읽고 저장 전에 멈춰 있는 동안 B·C 가 달려든다
touch "${g2}"
sleep 3
touch "${h}"
wait $PA $PB $PC
`, { encoding: 'utf-8', mode: 0o700 })
      const out = execFileSync('/bin/sh', [sh], { timeout: 180_000, encoding: 'utf-8' })
      if (process.env.LOCK_DEBUG === '1') {
        console.log(`     [debug early=${early}] stdout=${JSON.stringify(out)}`)
        console.log(`     [debug] detail=${existsSync(dl) ? JSON.stringify(readFileSync(dl, 'utf-8')) : '(none)'}`)
      }
      const detailEntries = existsSync(dl)
        ? readFileSync(dl, 'utf-8').split('\n').filter((x) => x.trim() !== '').length : 0
      const ledgerRows = existsSync(lg)
        ? readFileSync(lg, 'utf-8').split('\n').filter((x) => x.trim() !== '').length : 0
      return { detailEntries, ledgerRows }
    }

    const keep = run('0')
    check(`락을 확정까지 쥐면 상세 진입은 1회뿐이다 (얻은 값 ${keep.detailEntries})`,
      keep.detailEntries <= 1)
    check(`그때 원장도 1행이다 (얻은 값 ${keep.ledgerRows})`, keep.ledgerRows === 1)

    /** 🔴 대조군 — 확정 전에 놓으면 같은 글을 여러 번 연다 */
    const early = run('1')
    check(`대조군(확정 전 해제): 상세 진입이 2회 이상이다 (얻은 값 ${early.detailEntries})`,
      early.detailEntries >= 2,
      '대조군이 늘지 않으면 이 검사는 아무것도 증명하지 못한다')

    void lockPath; void hold; void go; void detailLog; void ledger
  }

  /**
   * ── ⑩ 🔴 **stale 에서는 외부 요청 0 · 자동 삭제 0**
   */
  {
    const dir = mkdtempSync(join(base, 'stale-ops-'))
    const path = join(dir, 'x.lock')
    plantStale(path)
    const before = readFileSync(path, 'utf-8')
    const r = acquireLock(path, Date.now(), TTL)
    check('stale 이면 획득하지 못한다', !r.ok && r.kind === 'STALE_HELD')
    check('🔴 락 파일을 자동으로 지우지 않는다', existsSync(path))
    check('🔴 내용도 바꾸지 않는다', readFileSync(path, 'utf-8') === before)
    check('🔴 사람 확인이 필요하다고 말한다', !r.ok && r.reason.includes('사람이 치운다'))
    check('🔴 "다음 회차가 치운다" 고 말하지 않는다',
      !r.ok && !r.reason.includes('다음 회차'))
    const a = lockAnomaly(path, Date.now(), TTL)
    check('🔴 운영 이상으로 드러난다', a !== null)
  }

  // ── ⑧ 🔴 rename 인수 코드가 라이브러리에 없다 ──
  {
    const lib = readFileSync('scripts/lib/collect-lock.mts', 'utf-8')
    const code = lib.split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
    check('🔴 rename 으로 락을 인수하지 않는다', !/renameSync/.test(code))
    check('🔴 남의 락을 지우는 경로가 없다',
      // 🔴 import 줄이 아니라 **호출**만 센다
      (code.match(/unlinkSync\(/g) ?? []).length === 1
      && /held\.token !== handle\.token/.test(code))
    check('🟢 획득은 wx 하나뿐이다',
      (code.match(/flag: 'wx'/g) ?? []).length === 1)
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}

console.log(`\n  ${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('  🔴 운영 락(/tmp/soransoran-navercafe.lock)은 건드리지 않았다\n')
process.exit(fail === 0 ? 0 : 1)
