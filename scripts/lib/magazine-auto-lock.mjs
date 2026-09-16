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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/** 디스크의 lock 을 읽는다. 없으면 null · 깨졌으면 `{}` (판정이 LOCK_CORRUPT 를 낸다) */
export function readLock(path = LOCK_PATH) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * lock 을 잡는다.
 * @returns {{ok: boolean, code: string, message: string, release: (() => void)}}
 */
export function acquireLock({ path = LOCK_PATH, now = Date.now(), pidAlive = defaultPidAlive, label = 'auto-register' } = {}) {
  const verdict = judgeLock({ existing: readLock(path), now, pidAlive })
  if (!verdict.ok) return { ...verdict, release: () => {} }

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ pid: process.pid, startedAt: now, label }, null, 2)}\n`, 'utf8')

  let released = false
  return {
    ...verdict,
    release: () => {
      if (released) return
      released = true
      // 🔴 내 것일 때만 지운다. 뺏긴 lock 을 지우면 남의 회차를 무방비로 만든다.
      const current = readLock(path)
      if (current?.pid === process.pid) rmSync(path, { force: true })
    },
  }
}
