/**
 * topic-queue.ts **공용 writer 잠금** — G8 편입기 apply 와 M-AUTO 등록이 모두 지난다.
 *
 * 🔴 **왜 필요한가** (2026-10-06 · G8 2차 검토).
 *    G8 apply 는 자기 편입 장부 잠금만 쥐었고, M-AUTO 등록(`magazine-register.mjs applyWrite`)은 아무 잠금도
 *    쥐지 않았다. G8 이 큐를 읽은 뒤 쓰기 전에 등록이 한 행을 지우면, G8 이 옛 바이트 위에 써서
 *    **지운 행이 되살아났다** (실제 자식 프로세스로 재현). 큐를 쓰는 쪽은 전부 이 잠금 안에서
 *    **읽기·확인·쓰기**를 한 번에 한다.
 *
 * 🔴 잠금 구현은 격리 장부와 같다 (`withQuarantineLock`): `openSync wx` 로 만들고, 주인 pid 의
 *    시작 시각·명령줄이 기록과 **둘 다** 다를 때만 죽은 주인으로 보고 `.reclaim` 안에서 거둔다.
 *    살아 있는 주인의 잠금은 빼앗지 않는다.
 *
 * 🔴 잠금 파일은 **저장소 밖**에 둔다 — 운영 runtime 트리에 미추적 파일을 남기지 않는다.
 *    이름은 큐 파일의 실제 경로(realpath)에서 나온다. 같은 파일을 쓰는 프로세스는 같은 잠금을 본다.
 *
 * 🔴 **잠금 순서는 고정이다** — `QUEUE_LOCK_ORDER`. G8 은 queue → admission 순으로 쥐고,
 *    M-AUTO 등록은 queue 하나만 쥔다. 거꾸로 쥐는 경로가 없으므로 교착이 생기지 않는다.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { withQuarantineLock } from './magazine-quarantine.mjs'
import { parseQueueSource } from './magazine-load.mjs'

export const QUEUE_LOCK_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'queue-locks')
/** 🔴 실패 분류에서 INFRA 로 읽힌다 (`magazine-failure-kind.mjs`) — 원고 실패 횟수에 넣지 않는다 */
export const QUEUE_LOCKED_CODE = 'queue_writer_locked'
export const QUEUE_CHANGED_CODE = 'queue_changed_by_other_writer'
export const QUEUE_LOCK_ORDER = ['queue', 'admission']

/** 큐 파일의 정본 경로 — 폴더는 realpath 로 푼다 (macOS 의 /var → /private/var 같은 별칭을 하나로) */
function canonicalQueuePath(queuePath) {
  return join(realpathSync(dirname(queuePath)), basename(queuePath))
}

/** 잠금 기준 경로. 실제 잠금 파일은 `${이 값}.lock` 이다 */
export function queueLockBase(queuePath) {
  const key = createHash('sha256').update(canonicalQueuePath(queuePath)).digest('hex').slice(0, 32)
  return join(QUEUE_LOCK_DIR, `${key}.queue`)
}
export const queueLockFile = (queuePath) => `${queueLockBase(queuePath)}.lock`

/**
 * 큐 writer 잠금을 쥐고 `fn` 을 돌린다. **`fn` 은 동기여야 한다** — 돌아오는 순간 풀린다.
 * @returns {{ok:true, value:any}|{ok:false, code:string, why:string}}
 */
export function withQueueWriteLock(queuePath, fn, { waitMs = 0 } = {}) {
  let base
  try { base = queueLockBase(queuePath) } catch (e) {
    return { ok: false, code: QUEUE_LOCKED_CODE, why: `큐 잠금 경로를 정하지 못했다: ${e.message}` }
  }
  const r = withQuarantineLock(base, fn, { waitMs })
  return r.ok ? r : { ok: false, code: QUEUE_LOCKED_CODE, why: r.why }
}

/**
 * 등록이 큐에서 한 항목(day 블록)을 지운 결과. 등록 쓰기와 원복 대조가 **같은 함수**를 쓴다.
 * @returns {string|null} 블록을 못 찾으면 null
 */
export function removeQueueDay(queueSrc, day) {
  const re = new RegExp(`  \\{\\n    day: ${day},[\\s\\S]*?\\n  \\},\\n`, 'm')
  if (!re.test(queueSrc)) return null
  const next = queueSrc.replace(re, '')
  return next === queueSrc ? null : next
}

/**
 * 🔴 **원복도 쓰기다.** auto-register 의 회차 스냅샷이 큐를 되돌릴 때, 그 사이 다른 writer(G8)가
 *    넣은 행을 옛 바이트로 덮으면 lost update 다. 큐에 행을 **더하는** writer 는 G8 하나뿐이고
 *    (M-AUTO 등록은 지우기만 한다 · auto-register 회차는 자기 잠금으로 하나씩 돈다), 잠금 안에서 지금 큐가
 *      ① 스냅샷 그대로면 할 일이 없고
 *      ② 읽히고, 스냅샷에 없던 slug 가 하나도 없으면 — 이 회차 등록의 제거나 부분 쓰기 잔여다 — 되돌리고
 *      ③ 스냅샷에 없던 slug 가 있거나(다른 writer 가 더했다) 큐를 읽을 수 없으면 덮지 않고 실패로 보고한다.
 *    (②가 「day 블록만 지운 바이트」보다 넓은 이유: register 내부 원복까지 실패해 남은 **잔여**도
 *     이 이중 방어가 지워야 한다 — m3a 반례9-C.)
 *
 * @param {{path:string, bytes:Buffer|null, existed:boolean, queueCas:{day:number}}} entry
 * @returns {{restored:boolean, failure:object|null}}
 */
export function restoreQueueSnapshot(entry, { writeFile = writeFileSync, waitMs = 2000 } = {}) {
  const locked = withQueueWriteLock(entry.path, () => {
    const now = existsSync(entry.path) ? readFileSync(entry.path) : null
    if (!entry.existed || entry.bytes === null) {
      return now === null ? { restored: false, failure: null }
        : { restored: false, failure: { path: entry.path, errorName: QUEUE_CHANGED_CODE, errorDetail: '스냅샷에 없던 큐가 생겼다 — 지우지 않는다' } }
    }
    if (now && now.equals(entry.bytes)) return { restored: false, failure: null }
    const conflict = (why) => ({ restored: false, failure: { path: entry.path, errorName: QUEUE_CHANGED_CODE,
      errorDetail: `${why} (day ${entry.queueCas.day}) — 다른 writer 의 행을 덮지 않는다` } })
    const text = now ? now.toString('utf8') : ''
    let nowRows
    try {
      if (!text.includes('export const TOPIC_QUEUE')) throw new Error('TOPIC_QUEUE 가 없다')
      nowRows = parseQueueSource(text)
    } catch (e) { return conflict(`지금 큐를 읽을 수 없다: ${e.message}`) }
    const snapSlugs = new Set(parseQueueSource(entry.bytes.toString('utf8')).map((r) => r.slug))
    const foreign = nowRows.filter((r) => !snapSlugs.has(r.slug)).map((r) => r.slug)
    if (foreign.length) return conflict(`회차 뒤 다른 writer 가 더한 행이 있다: ${foreign.join(', ')}`)
    writeFile(entry.path, entry.bytes)
    return { restored: true, failure: null }
  }, { waitMs })
  if (!locked.ok) return { restored: false, failure: { path: entry.path, errorName: QUEUE_LOCKED_CODE, errorDetail: locked.why } }
  return locked.value
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

/**
 * 🔴 **시험 전용 정지점** — 실제 자식 프로세스로 큐 경합을 재현하려고 둔다.
 *    `SORAN_MAGAZINE_TEST_MODE=1` 이 없으면 열리지 않고, 변수만 있으면 던진다(쓰기 0).
 */
export function queueTestPause(stage, env = process.env) {
  const want = env.SORAN_QUEUE_TEST_PAUSE_AT
  const gate = env.SORAN_QUEUE_TEST_GATE
  if (!want && !gate) return
  if (env.SORAN_MAGAZINE_TEST_MODE !== '1') throw new Error('SORAN_QUEUE_TEST_* 는 SORAN_MAGAZINE_TEST_MODE=1 에서만 쓴다 — 운영에서는 금지다')
  if (want !== stage) return
  writeFileSync(`${gate}.reached`, String(process.pid))
  while (!existsSync(`${gate}.go`)) sleepSync(20)
}
