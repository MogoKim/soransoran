/**
 * producer 회차 파일(`_runs/<date>/run.json`)의 **판(schema) 계약** — 읽기·판정·보존·원자적 쓰기.
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-28 운영 사고).
 *    배포 전 옛 코드가 00:10 에 만든 run.json 은 `COMPLETED · selected 0` 이었고
 *    `reusable` 필드 자체가 없었다(그 개념이 생기기 전 코드다). 배포 뒤 새 코드는
 *    같은 날 COMPLETED 를 **무조건 완료로 인정하고** 종료했다 — 재료 17건이 있는 날
 *    회수·등록 대상이 0 이 됐다.
 *
 * 🔴 **그렇다고 판이 다르면 다 다시 계산하지 않는다.** 이미 처리한 글을 다시 보낼 수 있다.
 *    다시 계산하는 것은 **인식 가능한 구버전 빈 계획**(LEGACY_EMPTY) 하나뿐이다:
 *      status COMPLETED · dryRun false · selected 빈 배열 · `reusable` 프로퍼티 없음 ·
 *      키가 명시적으로 지원하는 v0 형식 안에 있음 · 선정 패키지(selected/) 없음.
 *    그날 이미 한 후속 작업(전송·이미지·처리)은 회차 전체를 막지 않는다 —
 *    **slug 별 멱등성**으로 다룬다 (producer-plan 의 `reuseVerdict` · 전송 경계 · hero 재사용).
 *
 * 🔴 **모르는 판은 추측하지 않는다** — UNKNOWN_SCHEMA 로 멈춘다 (전송 0).
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync, copyFileSync, constants as FS, existsSync, openSync, readFileSync, readdirSync,
  renameSync, rmSync, writeFileSync, writeSync, fsyncSync,
} from 'node:fs'
import { join } from 'node:path'

/** 🔴 지금 판. 이 값으로 쓴 COMPLETED 는 같은 날 다시 계산하지 않는다 */
export const RUN_SCHEMA_VERSION = 'producer-run/2'

/**
 * 🔴 **명시적으로 지원하는 옛 판** — `schemaVersion` 이 없던 시절의 키 집합.
 *    v0: `reusable` 개념이 생기기 전 (2026-09-28 00:10 이전 코드)
 *    v1: `reusable` 이 생긴 뒤, 판 표식이 생기기 전 (PR #595 코드)
 *    이 집합 밖의 키가 있으면 옛 판이라고 **추측하지 않는다.**
 */
const V0_KEYS = new Set(['date', 'startedAt', 'finishedAt', 'status', 'dryRun', 'inventoryDays',
  'produceCount', 'reviewCount', 'counts', 'selected', 'skipped', 'abortReason', 'previousLock'])
const V1_KEYS = new Set([...V0_KEYS, 'reusable'])

/**
 * 기존 run.json 의 뜻.
 *
 * @returns {{kind:'NONE'|'BROKEN'|'CURRENT_COMPLETED'|'RERUNNABLE'|'LEGACY_EMPTY'|'LEGACY_COMPLETED'|'UNKNOWN_SCHEMA',
 *            why:string, run?:object}}
 *   NONE              파일이 없다 — 새로 계산한다
 *   BROKEN            JSON 이 아니다 — 보존한 뒤 새로 계산한다 (옛 동작: 덮어썼다)
 *   CURRENT_COMPLETED 지금 판 COMPLETED — **즉시 종료** (다시 계산하지 않는다)
 *   RERUNNABLE        지금 판 또는 지원 옛 판의 COMPLETED 아닌 상태(PARTIAL·ABORTED) — 옛 동작대로 다시 계산
 *   LEGACY_EMPTY      인식 가능한 구버전 빈 계획 — **보존한 뒤 다시 계산한다**
 *   LEGACY_COMPLETED  옛 판이지만 비어 있지 않거나(선정 있음·패키지 있음) v1 COMPLETED — **다시 계산하지 않는다**
 *   UNKNOWN_SCHEMA    모르는 판·형식 — **fail-closed**
 */
export function classifyExistingRun({ runDir, today, read = readFileSync, exists = existsSync, list = readdirSync }) {
  const file = join(runDir, 'run.json')
  if (!exists(file)) return { kind: 'NONE', why: 'run.json 이 없다' }
  let run
  try { run = JSON.parse(read(file, 'utf8')) }
  catch (e) { return { kind: 'BROKEN', why: `run.json 이 JSON 이 아니다: ${e.message}` } }
  if (!run || typeof run !== 'object' || Array.isArray(run)) return { kind: 'UNKNOWN_SCHEMA', why: 'run.json 이 객체가 아니다', run }

  if (Object.prototype.hasOwnProperty.call(run, 'schemaVersion')) {
    if (run.schemaVersion !== RUN_SCHEMA_VERSION) {
      return { kind: 'UNKNOWN_SCHEMA', why: `모르는 run 판이다 (${JSON.stringify(run.schemaVersion)} ≠ ${RUN_SCHEMA_VERSION})`, run }
    }
    return run.status === 'COMPLETED'
      ? { kind: 'CURRENT_COMPLETED', why: `오늘(${today}) run 은 이미 COMPLETED (${RUN_SCHEMA_VERSION})`, run }
      : { kind: 'RERUNNABLE', why: `지금 판 ${run.status} — 다시 계산한다`, run }
  }

  const keys = Object.keys(run)
  const hasReusable = Object.prototype.hasOwnProperty.call(run, 'reusable')
  const allowed = hasReusable ? V1_KEYS : V0_KEYS
  const foreign = keys.filter((k) => !allowed.has(k))
  if (foreign.length) {
    return { kind: 'UNKNOWN_SCHEMA', why: `판 표식이 없는데 지원하는 옛 형식도 아니다 (모르는 키: ${foreign.join(', ')})`, run }
  }
  if (run.status !== 'COMPLETED') return { kind: 'RERUNNABLE', why: `옛 판 ${run.status} — 다시 계산한다`, run }
  if (hasReusable) return { kind: 'LEGACY_COMPLETED', why: '옛 판(v1 · reusable 있음) COMPLETED — 다시 계산하지 않는다', run }

  // ── v0 COMPLETED — 빈 계획인가 ──
  if (run.date !== today) return { kind: 'LEGACY_COMPLETED', why: `날짜가 다르다 (${run.date} ≠ ${today}) — 다시 계산하지 않는다`, run }
  if (run.dryRun !== false) return { kind: 'LEGACY_COMPLETED', why: 'dry-run 기록이다 — 다시 계산하지 않는다', run }
  if (!Array.isArray(run.selected)) return { kind: 'UNKNOWN_SCHEMA', why: 'selected 가 배열이 아니다', run }
  if (run.selected.length > 0) {
    return { kind: 'LEGACY_COMPLETED', why: `옛 판이지만 선정 ${run.selected.length}건이 있다 — 다시 계산하지 않는다`, run }
  }
  const pkgDir = join(runDir, 'selected')
  let packages = []
  try { packages = exists(pkgDir) ? list(pkgDir) : [] } catch { packages = ['(읽지 못함)'] }
  if (packages.length) {
    return { kind: 'LEGACY_COMPLETED', why: `옛 판 빈 계획이지만 선정 패키지 ${packages.length}건이 있다 — 다시 계산하지 않는다`, run }
  }
  return { kind: 'LEGACY_EMPTY', why: '인식 가능한 구버전 빈 계획 (v0 · COMPLETED · selected 0 · reusable 없음 · 패키지 없음)', run }
}

/** 원자적으로 쓴다 — 반쪽 파일을 남기지 않는다. 쓴 뒤 다시 읽어 확인한다 */
export function writeFileAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
  if (readFileSync(path, 'utf8') !== text) throw new Error(`원자적 쓰기 확인 실패: ${path}`)
}

/**
 * 🔴 **지우지 않고 고유 이름으로 보존한다.** `COPYFILE_EXCL` — 같은 이름이 있으면 덮지 않고 실패한다.
 * @returns {string[]} 보존한 파일 이름
 */
export function preserveRunFiles(runDir, label) {
  const stamp = `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z-${process.pid}-${randomUUID().slice(0, 6)}`
  const kept = []
  for (const [name, ext] of [['run', 'json'], ['report', 'md']]) {
    const src = join(runDir, `${name}.${ext}`)
    if (!existsSync(src)) continue
    const dst = join(runDir, `${name}.${label}-${stamp}.${ext}`)
    copyFileSync(src, dst, FS.COPYFILE_EXCL)
    kept.push(`${name}.${label}-${stamp}.${ext}`)
  }
  return kept
}

/**
 * 회차 잠금 — 🔴 `openSync wx`. 판정·보존·새 run 생성은 전부 이 안에서 한다.
 * @returns {{ok:true, release:()=>void}|{ok:false, holder:object|null, alive:boolean}}
 */
export function acquireRunLock(lockFile, { pidAlive }) {
  const me = { pid: process.pid, startedAt: new Date().toISOString(), token: randomUUID() }
  try {
    const fd = openSync(lockFile, 'wx', 0o600)
    try { writeSync(fd, `${JSON.stringify(me)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e
    let holder = null
    try { holder = JSON.parse(readFileSync(lockFile, 'utf8')) } catch { holder = null }
    // 🔴 내용을 못 읽으면(막 만들어진 중) 살아 있는 것으로 본다 — 빼앗지 않는다
    const alive = holder ? pidAlive(holder.pid) : true
    return { ok: false, holder, alive }
  }
  return {
    ok: true,
    release: () => {
      try {
        const cur = JSON.parse(readFileSync(lockFile, 'utf8'))
        if (cur?.token === me.token) rmSync(lockFile, { force: true })
      } catch { /* 이미 없다 */ }
    },
  }
}
