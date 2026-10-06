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
 *
 * 🔴 **잠금 키는 경로가 아니라 논리 큐다** (2026-10-06 · G8 3차 검토).
 *    앞판은 topic-queue.ts 의 realpath 로 키를 만들었다. 그러면 g8-promoter worktree 와
 *    magazine-runtime worktree 가 **같은 소란소란 매거진 큐**를 다루면서도 서로 다른 잠금을 쥐어
 *    서로를 막지 못했다. 운영에서는 고정된 versioned scope(`QUEUE_LOCK_SCOPE`) 하나만 쓴다.
 *    시험 격리는 `SORAN_MAGAZINE_TEST_MODE=1` 에서만 `SORAN_MAGAZINE_QUEUE_LOCK_SCOPE=test-…` 로 연다.
 *    시험 모드 밖에서 그 변수가 보이면 잠금을 거부한다 — 말없이 운영 scope 로 돌아가지 않는다.
 *
 * 🔴 **잠금 순서는 고정이다** — `QUEUE_LOCK_ORDER`. G8 은 queue → admission 순으로 쥐고,
 *    M-AUTO 등록은 queue 하나만 쥔다. 거꾸로 쥐는 경로가 없으므로 교착이 생기지 않는다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { withQuarantineLock } from './magazine-quarantine.mjs'
import { parseArticlesSource, parseQueueSource } from './magazine-load.mjs'

export const QUEUE_LOCK_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'queue-locks')
/** 🔴 실패 분류에서 INFRA 로 읽힌다 (`magazine-failure-kind.mjs`) — 원고 실패 횟수에 넣지 않는다 */
export const QUEUE_LOCKED_CODE = 'queue_writer_locked'
export const QUEUE_CHANGED_CODE = 'queue_changed_by_other_writer'
export const QUEUE_LOCK_ORDER = ['queue', 'admission']
export const QUEUE_LOCK_SCOPE_BLOCKED_CODE = 'queue_lock_scope_blocked'

/** 🔴 운영의 유일한 논리 큐 scope. 큐의 의미가 바뀌면 판을 올린다 — 경로가 바뀌어도 그대로다 */
export const QUEUE_LOCK_SCOPE = 'soransoran-magazine-topic-queue-v1'

/**
 * 어느 논리 큐의 잠금을 쓸 것인가.
 * 🔴 주입은 시험 모드에서만, 그리고 `test-` 로 시작하는 이름만 받는다.
 */
export function resolveQueueLockScope(env = process.env) {
  const injected = env.SORAN_MAGAZINE_QUEUE_LOCK_SCOPE
  if (!injected) return { ok: true, scope: QUEUE_LOCK_SCOPE, injected: false }
  if (env.SORAN_MAGAZINE_TEST_MODE !== '1') {
    return { ok: false, why: 'SORAN_MAGAZINE_QUEUE_LOCK_SCOPE 는 SORAN_MAGAZINE_TEST_MODE=1 에서만 쓴다 — 운영에서는 금지다' }
  }
  if (!/^test-[a-z0-9-]{1,80}$/.test(injected)) return { ok: false, why: `시험 scope 는 test- 로 시작해야 한다: ${injected}` }
  return { ok: true, scope: injected, injected: true }
}

/**
 * 잠금 기준 경로. 실제 잠금 파일은 `${이 값}.lock` 이다.
 * 🔴 `queuePath` 는 키에 쓰지 않는다 — 호출부 호환과 오류 문구를 위해서만 받는다.
 */
export function queueLockBase(queuePath, env = process.env) {
  void queuePath
  const scope = resolveQueueLockScope(env)
  if (!scope.ok) throw Object.assign(new Error(scope.why), { code: QUEUE_LOCK_SCOPE_BLOCKED_CODE })
  return join(QUEUE_LOCK_DIR, `${scope.scope}.queue`)
}
export const queueLockFile = (queuePath, env = process.env) => `${queueLockBase(queuePath, env)}.lock`

/**
 * 큐 writer 잠금을 쥐고 `fn` 을 돌린다. **`fn` 은 동기여야 한다** — 돌아오는 순간 풀린다.
 * @returns {{ok:true, value:any}|{ok:false, code:string, why:string}}
 */
export function withQueueWriteLock(queuePath, fn, { waitMs = 0, env = process.env } = {}) {
  let base
  try { base = queueLockBase(queuePath, env) } catch (e) {
    return { ok: false, code: e.code ?? QUEUE_LOCKED_CODE, why: `큐 잠금을 정하지 못했다: ${e.message}` }
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
const readNow = (p) => (existsSync(p) ? readFileSync(p) : null)

/**
 * 큐를 스냅샷으로 되돌려도 되는가 — **판정만** 한다. 쓰지 않는다.
 * @returns {{action:'noop'|'restore'|'conflict', why?:string}}
 */
export function decideQueueRestore(entry, now) {
  if (!entry.existed || entry.bytes === null) {
    return now === null ? { action: 'noop' } : { action: 'conflict', why: '스냅샷에 없던 큐가 생겼다 — 지우지 않는다' }
  }
  if (now && now.equals(entry.bytes)) return { action: 'noop' }
  const text = now ? now.toString('utf8') : ''
  let nowRows
  try {
    if (!text.includes('export const TOPIC_QUEUE')) throw new Error('TOPIC_QUEUE 가 없다')
    nowRows = parseQueueSource(text)
  } catch (e) { return { action: 'conflict', why: `지금 큐를 읽을 수 없다: ${e.message}` } }
  const snapSlugs = new Set(parseQueueSource(entry.bytes.toString('utf8')).map((r) => r.slug))
  const foreign = nowRows.filter((r) => !snapSlugs.has(r.slug)).map((r) => r.slug)
  if (foreign.length) return { action: 'conflict', why: `회차 뒤 다른 writer 가 더한 행이 있다: ${foreign.join(', ')}` }
  return { action: 'restore' }
}

/**
 * articles.ts 를 스냅샷으로 되돌려도 되는가 — 이 회차 slug 말고 **다른 글이 더해졌으면** 다른 writer 의 것이다.
 * @returns {{action:'noop'|'restore'|'conflict', why?:string}}
 */
export function decideArticlesRestore(entry, now, slug) {
  if (!entry.existed || entry.bytes === null) {
    return now === null ? { action: 'noop' } : { action: 'conflict', why: '스냅샷에 없던 articles.ts 가 생겼다 — 지우지 않는다' }
  }
  if (now && now.equals(entry.bytes)) return { action: 'noop' }
  let nowSlugs
  try { nowSlugs = parseArticlesSource(now ? now.toString('utf8') : '').map((a) => a.slug) } catch (e) {
    return { action: 'conflict', why: `지금 articles.ts 를 읽을 수 없다: ${e.message}` }
  }
  const snapSlugs = new Set(parseArticlesSource(entry.bytes.toString('utf8')).map((a) => a.slug))
  const foreign = nowSlugs.filter((s) => !snapSlugs.has(s) && s !== slug)
  if (foreign.length) return { action: 'conflict', why: `회차 뒤 다른 writer 가 더한 글이 있다: ${foreign.join(', ')}` }
  return { action: 'restore' }
}

export function restoreQueueSnapshot(entry, { writeFile = writeFileSync, waitMs = 2000 } = {}) {
  const locked = withQueueWriteLock(entry.path, () => {
    const d = decideQueueRestore(entry, readNow(entry.path))
    if (d.action === 'noop') return { restored: false, failure: null }
    if (d.action === 'conflict') {
      return { restored: false, failure: { path: entry.path, errorName: QUEUE_CHANGED_CODE,
        errorDetail: `${d.why} (day ${entry.queueCas.day}) — 다른 writer 의 행을 덮지 않는다` } }
    }
    writeFile(entry.path, entry.bytes)
    return { restored: true, failure: null }
  }, { waitMs })
  if (!locked.ok) return { restored: false, failure: { path: entry.path, errorName: QUEUE_LOCKED_CODE, errorDetail: locked.why } }
  return locked.value
}

export const PAIR_REFUSED_CODE = 'queue_pair_restore_refused'
export const PAIR_FAILED_CODE = 'queue_pair_restore_failed'

/**
 * 🔴 **등록 쌍(articles.ts · topic-queue.ts) 원복은 한 임계구역에서 한다** (2026-10-06 · G8 3차 검토).
 *
 *    앞판은 articles.ts 를 먼저(잠금 없이) 되돌리고, 큐는 잠금 안에서 따로 판정했다. 큐에 다른 writer 의
 *    행이 생겨 큐 원복이 거부되면 **articles 에서는 글이 빠졌는데 큐에서도 행이 빠진** 상태 —
 *    주제가 양쪽에서 사라진 상태 — 가 남았다.
 *
 *    이제 큐 writer 잠금 안에서 **두 파일의 원복 가능 여부를 먼저 모두 판정**한다.
 *      · 하나라도 conflict 면 **둘 다 건드리지 않는다** (`queue_pair_restore_refused`)
 *      · 둘 다 가능하면 같은 임계구역에서 쓴다. 쓰다 실패하면 이미 쓴 파일을 원복 직전 바이트로 되돌리고
 *        `queue_pair_restore_failed` 에 무엇이 어디까지 됐는지 남긴다.
 *
 * @returns {{restored:string[], failures:object[]}}
 */
export function restoreRegisterPair({ articles, queue, slug }, { writeFile = writeFileSync, waitMs = 2000 } = {}) {
  const locked = withQueueWriteLock(queue.path, () => {
    const nowA = readNow(articles.path)
    const nowQ = readNow(queue.path)
    const da = decideArticlesRestore(articles, nowA, slug)
    const dq = decideQueueRestore(queue, nowQ)
    if (da.action === 'conflict' || dq.action === 'conflict') {
      return { restored: [], failures: [{ path: `${articles.path} + ${queue.path}`, errorName: PAIR_REFUSED_CODE,
        errorDetail: `${[da.why, dq.why].filter(Boolean).join(' · ')} — articles.ts · topic-queue.ts 둘 다 되돌리지 않았다 (slug ${slug})` }] }
    }
    const plan = [
      ...(da.action === 'restore' ? [{ path: articles.path, to: articles.bytes, from: nowA }] : []),
      ...(dq.action === 'restore' ? [{ path: queue.path, to: queue.bytes, from: nowQ }] : []),
    ]
    const done = []
    try {
      for (const step of plan) { writeFile(step.path, step.to); done.push(step) }
      return { restored: done.map((x) => x.path), failures: [] }
    } catch (e) {
      const undo = []
      for (const step of done.reverse()) {
        try { if (step.from === null) undo.push(`${step.path}: 원래 없던 파일 — 남겨 둠`); else { writeFileSync(step.path, step.from); undo.push(`${step.path}: 원복 직전으로 되돌림`) } }
        catch (u) { undo.push(`${step.path}: 되돌리기 실패 ${u.message}`) }
      }
      return { restored: [], failures: [{ path: `${articles.path} + ${queue.path}`, errorName: PAIR_FAILED_CODE,
        errorDetail: `쌍 원복 중 실패 — ${e.message} · ${undo.join(' · ') || '쓴 파일 없음'}` }] }
    }
  }, { waitMs })
  if (!locked.ok) {
    return { restored: [], failures: [{ path: `${articles.path} + ${queue.path}`, errorName: locked.code,
      errorDetail: `${locked.why} — 둘 다 되돌리지 않았다` }] }
  }
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
