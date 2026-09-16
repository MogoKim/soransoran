/**
 * producer → auto-register 인계 — **완료 신호와 잠금을 잇는다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-16 무인 운영).
 *
 *    등록을 02:00 → **01:00** 으로 당긴다. producer(00:10)와의 간격이
 *    110분에서 50분으로 좁아진다. 옛 설계는 "시간이 충분하니 겹치지 않는다" 였다 —
 *    그 전제가 얇아지는 순간, producer 가 원고를 쓰는 중에 등록이 시작될 수 있다.
 *    같은 `drafts/{slug}/` 를 한쪽은 쓰고 한쪽은 읽는다.
 *
 *    시간 간격에 기대지 않는다. **producer 가 끝났다고 말할 때까지 기다린다.**
 *
 * 🔴 **무한 대기하지 않는다.** 정해진 시간까지만 기다리고, 그 뒤에는 판정을 내린다.
 *    기다리다 다음 회차(내일 00:10)를 만나면 그것이 더 큰 사고다.
 *
 * 🔴 **재시도하지 않는다.** 기다림은 한 번이다. producer 가 실패했으면
 *    "오늘은 새 원고가 없다" 로 끝내고, **이미 준비된 후보는 그대로 처리한다** —
 *    producer 실패가 재고 공급을 통째로 멈추면 안 된다.
 *
 * 🔴 파일을 쓰는 것은 `writeHandoff` 하나뿐이다. 판정은 전부 순수 함수다.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DRAFTS_DIR } from './magazine-load.mjs'

/** producer 가 회차 끝에 남기는 신호. `_runs/{date}/` 안이라 회차와 함께 보관된다 */
export const handoffPath = (date) => join(DRAFTS_DIR, '_runs', date, 'producer-handoff.json')

/**
 * 등록이 producer 를 기다리는 최대 시간.
 *
 * 🔴 01:00 + 40분 = 01:40. 실측 producer 회차는 8분이었고(선정·brief 5건·회수 5건),
 *    느린 날을 감안해도 40분이면 넉넉하다. 그 이상은 **기다릴 값어치가 없다** —
 *    producer 가 그때까지 안 끝났으면 무언가 잘못된 것이고, 등록은 이미 있는 것으로 돈다.
 */
export const MAX_WAIT_MS = 40 * 60 * 1000

/** 얼마나 자주 다시 보는가. 잦으면 로그만 시끄럽다 */
export const POLL_MS = 60 * 1000

/**
 * producer 가 회차 끝에 이것을 남긴다. **판정이 아니라 사실만 적는다.**
 *
 * @param {{date:string, verdict:string, code:number, ran:string[], finishedAt?:string}} p
 */
export function writeHandoff({ date, verdict, code, ran = [], finishedAt = new Date().toISOString() }) {
  const path = handoffPath(date)
  mkdirSync(dirname(path), { recursive: true })
  // 🔴 임시 파일 후 rename — 반쯤 쓰인 신호를 등록이 읽지 않게
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify({ date, verdict, code, ran, finishedAt }, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 신호를 읽는다. 없으면 null · 깨졌으면 `{}` */
export function readHandoff(date) {
  const path = handoffPath(date)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * 지금 등록을 시작해도 되는가. **아무것도 읽지 않는다 — 넘겨받은 값만 본다.**
 *
 * @param {object} p
 * @param {object|null} p.handoff        producer 신호 (없으면 null)
 * @param {boolean} p.producerLockHeld   producer lock 이 살아 있는가
 * @param {number} p.waitedMs            지금까지 기다린 시간
 * @param {number} [p.maxWaitMs]
 * @returns {{ready:boolean, wait:boolean, code:string, message:string}}
 */
export function judgeHandoff({ handoff, producerLockHeld, waitedMs, maxWaitMs = MAX_WAIT_MS }) {
  // 🔴 lock 이 살아 있으면 producer 가 **지금 쓰고 있다.** 신호가 있어도 기다린다.
  if (producerLockHeld) {
    if (waitedMs < maxWaitMs) {
      return { ready: false, wait: true, code: 'PRODUCER_RUNNING', message: `producer 가 아직 돌고 있다 (${Math.round(waitedMs / 60000)}분째 대기)` }
    }
    // 🔴 여기서 뺏지 않는다. producer 가 쓰는 중인 파일을 등록이 읽으면 반쯤 쓰인 원고를 받는다.
    return {
      ready: false,
      wait: false,
      code: 'PRODUCER_STUCK',
      message: `producer 가 ${Math.round(maxWaitMs / 60000)}분이 지나도 끝나지 않았다 — 이번 등록 회차는 건너뛴다 (재시도하지 않는다)`,
    }
  }

  if (handoff === null) {
    if (waitedMs < maxWaitMs) {
      return { ready: false, wait: true, code: 'HANDOFF_MISSING', message: `producer 완료 신호를 기다린다 (${Math.round(waitedMs / 60000)}분째)` }
    }
    // 🔴 **그래도 진행한다.** producer 가 안 돌았다고 등록까지 멈추면
    //    어제 준비된 후보가 있어도 재고가 늘지 않는다. 공급이 목적이다.
    return {
      ready: true,
      wait: false,
      code: 'HANDOFF_ABSENT_PROCEED',
      message: 'producer 신호가 없다 — 오늘 새 원고는 없지만 이미 준비된 후보로 진행한다',
    }
  }

  if (!handoff.finishedAt) {
    return { ready: true, wait: false, code: 'HANDOFF_CORRUPT_PROCEED', message: 'producer 신호를 읽지 못했다 — 준비된 후보로 진행한다' }
  }

  // 🔴 producer 가 실패했어도 진행한다. 실패는 producer 의 종료 코드가 이미 말했다.
  //    등록은 "지금 디스크에 있는 것" 으로 판단한다 — gate 가 brief·review 를 다시 본다.
  return {
    ready: true,
    wait: false,
    code: handoff.verdict === 'SYSTEM' ? 'PRODUCER_FAILED_PROCEED' : 'HANDOFF_OK',
    message:
      handoff.verdict === 'SYSTEM'
        ? `producer 가 실패했다(${handoff.verdict}) — 이미 준비된 후보로만 진행한다`
        : `producer 완료 확인 (${handoff.verdict})`,
  }
}

/**
 * 준비될 때까지 기다린다. **제한된 대기 · 재시도 없음.**
 *
 * @param {object} p
 * @param {() => object|null} p.getHandoff
 * @param {() => boolean} p.isProducerLockHeld
 * @param {(ms:number) => Promise<void>} p.sleep
 * @param {() => number} [p.now]
 */
export async function waitForProducer({
  getHandoff, isProducerLockHeld, sleep, now = () => Date.now(),
  maxWaitMs = MAX_WAIT_MS, pollMs = POLL_MS, log = () => {},
}) {
  const started = now()
  let last = null
  for (;;) {
    const waitedMs = now() - started
    const verdict = judgeHandoff({ handoff: getHandoff(), producerLockHeld: isProducerLockHeld(), waitedMs, maxWaitMs })
    if (!verdict.wait) return { ...verdict, waitedMs }
    if (verdict.code !== last) { log(`${verdict.code}: ${verdict.message}`); last = verdict.code }
    await sleep(pollMs)
  }
}
