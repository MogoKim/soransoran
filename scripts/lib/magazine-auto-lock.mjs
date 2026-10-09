/**
 * 자동 레인 lock — 같은 회차가 겹쳐 돌지 않게 한다.
 *
 * 🔴 **왜 생겼나** (2026-09-15 진단).
 *    producer 에는 lock 이 있는데(`magazine-producer-plan.mjs`) 자동 등록 레인에는
 *    없었다. 사람이 손으로 `--write` 를 돌리는 중에 02:00 회차가 겹치면
 *    같은 `articles.ts` 와 같은 git 인덱스를 두 프로세스가 다툰다.
 *    preflight 의 `DIRTY_TREE` 가 사실상 2차 방어로 걸리긴 하지만 **보장이 아니다** —
 *    한쪽이 브랜치를 만든 직후 다른 쪽이 `NOT_ON_MAIN` 을 보고 멈추는 식이라
 *    "무엇 때문에 멈췄는지" 가 매번 달라진다. 자리를 정해 두고 거기서 막는다.
 *
 * 🔴 **producer lock 과 다른 파일이다.** 두 job 은 서로를 막지 않는다 —
 *    00:10 producer 와 02:00 auto-register 는 하는 일이 다르고, producer 가
 *    늦어져도 이 레인은 "오늘 할 것이 없다" 로 조용히 끝나야 한다.
 *    같은 lock 을 쓰면 producer 가 늦은 날 이 레인이 BLOCKED 로 시끄러워진다.
 *
 * 🔴 **재시도하지 않는다.** 살아 있는 lock 을 만나면 그 회차는 끝이다.
 *    기다렸다 다시 잡으면 02:00 회차가 사람 작업이 끝날 때까지 붙어 있게 되고,
 *    그것은 KeepAlive 를 넣지 않기로 한 결정과 같은 이유로 위험하다(폭주).
 *
 * 🔴 **판정은 순수 함수다.** `judgeLock` 은 파일을 읽지 않는다 —
 *    stale·경합·손상된 lock 을 실제 프로세스 없이 시험할 수 있어야 한다.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { DRAFTS_DIR } from './magazine-load.mjs'

/**
 * 🔴 producer 의 `_runs/{date}/.lock` 과 **다른 자리**다.
 *    날짜를 넣지 않는다 — 자정을 넘겨 도는 회차가 두 개의 lock 을 잡게 된다.
 */
export const LOCK_PATH = join(DRAFTS_DIR, '_runs', '.auto-register.lock')

/**
 * producer **회차 전체**의 잠금.
 *
 * 🔴 **왜 따로 필요한가** (2026-09-16 검토).
 *    `magazine-producer-plan.mjs` 에도 lock 이 있지만 그것은 **선정 구간만** 덮는다 —
 *    plan 이 끝나면서 풀린다. 그 뒤로 brief 생성(claude)과 원고 회수(ChatGPT)가
 *    수십 분 더 돈다. 등록이 01:00 으로 당겨졌으므로 **그 구간이 정확히 겹친다.**
 *    같은 `drafts/{slug}/` 를 한쪽은 쓰고 한쪽은 읽게 된다.
 *
 * 🔴 날짜를 넣지 않는다. 자정을 넘겨 도는 회차가 두 개의 lock 을 잡게 된다.
 */
export const PRODUCER_LOCK_PATH = join(DRAFTS_DIR, '_runs', '.producer.lock')

/**
 * 이 시간이 지난 lock 은 죽은 것으로 본다.
 *
 * 🔴 pid 확인만으로는 모자라다. pid 는 재사용되고, 맥이 잠들었다 깨면
 *    그 번호를 다른 프로세스가 쓰고 있을 수 있다. 시간과 pid 를 함께 본다.
 *    자동 레인 한 회차는 원고 회수·이미지 생성까지 포함해도 1시간을 넘지 않는다.
 */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000

/** 프로세스가 살아 있는가. 신호 0 은 보내지 않고 존재만 확인한다 */
export function defaultPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM = 남의 프로세스지만 살아는 있다
    return e?.code === 'EPERM'
  }
}

/**
 * 지금 lock 을 잡아도 되는가. **파일을 만지지 않는다.**
 *
 * @param {object} p
 * @param {object|null} p.existing   읽어 둔 lock 내용. 없으면 null
 * @param {number} p.now             현재 시각 ms
 * @param {(pid:number)=>boolean} p.pidAlive
 * @param {number} [p.staleAfterMs]
 * @returns {{ok: boolean, code: string, message: string, takeover: boolean}}
 */
export function judgeLock({ existing, now, pidAlive, staleAfterMs = STALE_AFTER_MS }) {
  if (existing === null || existing === undefined) {
    return { ok: true, code: 'FREE', message: 'lock 이 없다', takeover: false }
  }

  // 🔴 손상된 lock 을 "없는 것" 으로 보지 않는다. 누가 쓰는 중일 수 있다.
  //    사람이 지우게 한다 — 자동으로 밀어 버리면 경합을 못 막는다.
  const pid = existing?.pid
  const startedAt = Number(existing?.startedAt)
  if (!Number.isInteger(pid) || !Number.isFinite(startedAt)) {
    return {
      ok: false,
      code: 'LOCK_CORRUPT',
      message: `lock 파일을 읽을 수 없다 — 사람이 확인하고 지운다: ${LOCK_PATH}`,
      takeover: false,
    }
  }

  const ageMs = now - startedAt
  const alive = pidAlive(pid)

  if (alive && ageMs < staleAfterMs) {
    return {
      ok: false,
      code: 'LOCK_HELD',
      message: `다른 회차가 돌고 있다 (pid ${pid} · ${Math.round(ageMs / 60000)}분째) — 이번 회차는 건너뛴다`,
      takeover: false,
    }
  }

  if (alive) {
    // 🔴 살아 있는데 너무 오래됐다. **뺏지 않는다.** 붙잡힌 프로세스를 죽이는 것은
    //    이 스크립트의 일이 아니고, 뺏으면 그쪽이 쓰는 중인 파일을 함께 건드린다.
    return {
      ok: false,
      code: 'LOCK_STUCK',
      message: `pid ${pid} 가 ${Math.round(ageMs / 60000)}분째 lock 을 쥐고 있다 — 사람이 확인한다`,
      takeover: false,
    }
  }

  return {
    ok: true,
    code: 'LOCK_STALE',
    message: `죽은 lock 을 걷어낸다 (pid ${pid} · ${Math.round(ageMs / 60000)}분 전)`,
    takeover: true,
  }
}

/** 디스크의 lock 원문. 없으면 null — 🔴 회수 직전 "본 것과 같은가" 를 바이트로 대조하는 데 쓴다 */
function readRaw(path) {
  try { return readFileSync(path, 'utf8') } catch (e) { return e?.code === 'ENOENT' ? null : '' }
}
const parseRaw = (raw) => {
  if (raw === null) return null
  try { return JSON.parse(raw) } catch { return {} }
}

/** 디스크의 lock 을 읽는다. 없으면 null · 깨졌으면 `{}` (판정이 LOCK_CORRUPT 를 낸다) */
export function readLock(path = LOCK_PATH) {
  return parseRaw(readRaw(path))
}

/**
 * 🔴 **잠금 파일은 `wx` 로만 만든다** (2026-10-09 Codex 재검토 P1).
 *    앞판은 `readLock` 으로 "없다" 를 본 뒤 일반 `writeFileSync` 로 썼다. 두 실제 프로세스가 동시에
 *    "없다" 를 보면 **둘 다** 쓰고 둘 다 진입했다. `wx` 는 이미 있으면 EEXIST 로 실패한다 — 한쪽만 이긴다.
 */
function createExclusive(path, body) {
  const fd = openSync(path, 'wx', 0o600)
  try { writeSync(fd, `${JSON.stringify(body, null, 2)}\n`) } finally { closeSync(fd) }
}

/** 🔴 시험 전용 — 판정과 생성 사이를 벌려 실제 경합을 재현한다 (SORAN_MAGAZINE_TEST_MODE=1 일 때만) */
function racePause() {
  if (process.env.SORAN_MAGAZINE_TEST_MODE !== '1') return
  const ms = Number(process.env.SORAN_LOCK_RACE_PAUSE_MS || 0)
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 🔴 **owner token 이 내 것일 때만 지운다.** pid 만 보면 같은 pid 를 재사용한 남의 잠금을 지운다.
 * @returns {'RELEASED'|'NOT_MINE'|'ABSENT'}
 */
export function releaseIfMine(path, token) {
  const cur = parseRaw(readRaw(path))
  if (cur === null) return 'ABSENT'
  if (!token || cur?.token !== token) return 'NOT_MINE'
  rmSync(path, { force: true })
  return 'RELEASED'
}

/**
 * 🔴 **죽은 잠금 회수는 별도의 원자적 소유권 아래에서만** (2026-10-09 Codex 재검토 P1).
 *    `${path}.reclaim` 을 `wx` 로 잡은 쪽만 회수한다. 잡은 뒤 **잠금 원문을 다시 읽어** 판정 때 본 것과
 *    바이트까지 같고 여전히 죽은 잠금일 때만 지운다. 그 사이 누가 새 잠금을 잡았으면 손대지 않는다.
 *    회수 소유권을 못 잡으면(다른 회차가 회수 중) 막는다 — fail-closed.
 */
function reclaimDeadLock(path, seenRaw, { now, pidAlive }) {
  const reclaim = `${path}.reclaim`
  try { createExclusive(reclaim, { pid: process.pid, startedAt: now, token: randomUUID() }) } catch (e) {
    if (e?.code === 'EEXIST') {
      return { ok: false, code: 'LOCK_RECLAIM_BUSY', message: `다른 회차가 죽은 잠금을 회수하는 중이다 — 이번 회차는 건너뛴다 (${reclaim})` }
    }
    return { ok: false, code: 'LOCK_ERROR', message: `회수 소유권을 만들지 못했다: ${e?.message ?? e}` }
  }
  try {
    const nowRaw = readRaw(path)
    if (nowRaw !== seenRaw) return { ok: false, code: 'LOCK_HELD', message: '회수하려던 사이 잠금이 바뀌었다 — 이번 회차는 건너뛴다' }
    const again = judgeLock({ existing: parseRaw(nowRaw), now, pidAlive })
    if (!again.ok || !again.takeover) return { ok: false, code: again.code, message: again.message }
    rmSync(path, { force: true })
    return { ok: true }
  } finally {
    rmSync(reclaim, { force: true })
  }
}

/**
 * lock 을 잡는다.
 *
 * 🔴 판정(`judgeLock`)은 그대로다 — 살아 있는 주인·손상·LOCK_STUCK 은 계속 막는다.
 *    바뀐 것은 **생성이 원자적**이고, **owner token** 을 남기고, 해제·회수가 그 token·원문을 대조한다는 것이다.
 * @returns {{ok: boolean, code: string, message: string, token?: string, release: (() => void)}}
 */
export function acquireLock({ path = LOCK_PATH, now = Date.now(), pidAlive = defaultPidAlive, label = 'auto-register' } = {}) {
  const none = () => {}
  try { mkdirSync(dirname(path), { recursive: true }) } catch (e) {
    return { ok: false, code: 'LOCK_ERROR', message: `잠금 폴더를 만들지 못했다: ${e?.message ?? e}`, takeover: false, release: none }
  }
  const seenRaw = readRaw(path)
  const verdict = judgeLock({ existing: parseRaw(seenRaw), now, pidAlive })
  if (!verdict.ok) return { ...verdict, release: none }
  racePause()
  if (verdict.takeover) {
    const r = reclaimDeadLock(path, seenRaw, { now, pidAlive })
    if (!r.ok) return { ok: false, code: r.code, message: r.message, takeover: false, release: none }
  }
  const token = randomUUID()
  try {
    createExclusive(path, { pid: process.pid, startedAt: now, label, token })
  } catch (e) {
    if (e?.code === 'EEXIST') {
      return { ok: false, code: 'LOCK_HELD', message: '다른 회차가 방금 잠금을 잡았다 — 이번 회차는 건너뛴다', takeover: false, release: none }
    }
    return { ok: false, code: 'LOCK_ERROR', message: `잠금을 만들지 못했다: ${e?.message ?? e}`, takeover: false, release: none }
  }

  let released = false
  return {
    ...verdict,
    token,
    release: () => {
      if (released) return
      released = true
      // 🔴 내 token 일 때만 지운다. 뺏긴 lock 을 지우면 남의 회차를 무방비로 만든다.
      releaseIfMine(path, token)
    },
  }
}
