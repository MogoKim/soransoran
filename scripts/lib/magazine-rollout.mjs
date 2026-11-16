/**
 * Magazine rollout switch — legacy 와 vNext 를 가르는 단일 설정 (runbook §0.0B.5 · milestone ①A).
 *
 * 🔴 이 모듈은 Node built-in 만 쓴다. graph · queue · Git · provider · runtime drafts 를 import 하지 않는다.
 * 🔴 읽기는 디스크에 아무것도 쓰지 않는다. 없음·손상·schema 불일치는 legacy fallback 이다.
 * 🔴 쓰기는 단일 owner CLI(`scripts/magazine-rollout.mjs`)만 한다 — O_EXCL 잠금 안에서 temp → fsync → rename.
 */
import * as nodeFs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const ROLLOUT_SCHEMA = 'magazine-rollout/1'
export const ROLLOUT_PATHS = Object.freeze(['legacy', 'vnext'])
export const ROLLOUT_RELEASES = Object.freeze(['draft', 'auto'])
/** 없음·손상·schema 불일치 때의 실효값 — 디스크에 쓰지 않는다 */
export const ROLLOUT_FALLBACK = Object.freeze({ path: 'legacy', release: 'draft', targetCandidates: 1 })

const TOP_KEYS = ['schemaVersion', 'path', 'release', 'targetCandidates', 'changedBy', 'changedAt', 'previous']
const PREV_KEYS = ['path', 'release', 'targetCandidates']

/** 정본 경로 — HOME 기준. 다른 경로는 이 모듈의 함수 인자(DI)로만 받는다 */
export function rolloutPath({ home = homedir() } = {}) {
  return join(home, 'Library', 'Application Support', 'soransoran', 'magazine-rollout.json')
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const exactKeys = (o, keys) => {
  const got = Object.keys(o).sort()
  const want = [...keys].sort()
  return got.length === want.length && got.every((k, i) => k === want[i])
}
const isTarget = (n) => Number.isSafeInteger(n) && n >= 1
/** ISO 8601 UTC 시각 — `Date#toISOString()` 이 만드는 모양과 그 왕복이 같아야 한다 */
const isIsoTimestamp = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s

function validateCore(o, where) {
  if (!ROLLOUT_PATHS.includes(o.path)) return `${where}path 는 ${ROLLOUT_PATHS.join(' | ')} 중 하나다`
  if (!ROLLOUT_RELEASES.includes(o.release)) return `${where}release 는 ${ROLLOUT_RELEASES.join(' | ')} 중 하나다`
  if (!isTarget(o.targetCandidates)) return `${where}targetCandidates 는 1 이상의 안전한 정수다`
  return null
}

/**
 * schema 판정 — 알 수 없는 필드 · 누락 필드 · 중첩 구조 불일치는 전부 INVALID.
 * @returns {{ok:true}|{ok:false, why:string}}
 */
export function validateRollout(value) {
  if (!isPlainObject(value)) return { ok: false, why: '최상위가 객체가 아니다' }
  if (!exactKeys(value, TOP_KEYS)) return { ok: false, why: `필드가 정확히 ${TOP_KEYS.join(', ')} 이어야 한다` }
  if (value.schemaVersion !== ROLLOUT_SCHEMA) return { ok: false, why: `schemaVersion 이 ${ROLLOUT_SCHEMA} 가 아니다` }
  const core = validateCore(value, '')
  if (core) return { ok: false, why: core }
  if (typeof value.changedBy !== 'string' || value.changedBy.trim() === '') return { ok: false, why: 'changedBy 가 비었다' }
  if (!isIsoTimestamp(value.changedAt)) return { ok: false, why: 'changedAt 이 유효한 ISO 시각이 아니다' }
  if (!isPlainObject(value.previous) || !exactKeys(value.previous, PREV_KEYS)) return { ok: false, why: `previous 는 정확히 ${PREV_KEYS.join(', ')} 를 가진 객체다` }
  const prev = validateCore(value.previous, 'previous.')
  if (prev) return { ok: false, why: prev }
  return { ok: true }
}

const effectiveOf = (o) => ({ path: o.path, release: o.release, targetCandidates: o.targetCandidates })

/**
 * 읽기 — 디스크에 쓰지 않는다.
 * @returns {{code:'MISSING'|'INVALID'|'VALID', effective:{path:string, release:string, targetCandidates:number}, config:object|null, why:string|null, path:string}}
 */
export function readRollout({ path = rolloutPath(), fs = nodeFs } = {}) {
  let text
  try {
    text = fs.readFileSync(path, 'utf8')
  } catch (e) {
    if (e?.code === 'ENOENT') return { code: 'MISSING', effective: { ...ROLLOUT_FALLBACK }, config: null, why: null, path }
    return { code: 'INVALID', effective: { ...ROLLOUT_FALLBACK }, config: null, why: `읽지 못했다 (${e?.code ?? e?.name ?? 'Error'})`, path }
  }
  let parsed
  try { parsed = JSON.parse(text) } catch { return { code: 'INVALID', effective: { ...ROLLOUT_FALLBACK }, config: null, why: 'JSON 이 아니다', path } }
  const v = validateRollout(parsed)
  if (!v.ok) return { code: 'INVALID', effective: { ...ROLLOUT_FALLBACK }, config: null, why: v.why, path }
  return { code: 'VALID', effective: effectiveOf(parsed), config: parsed, why: null, path }
}

/**
 * 진입점 판정 — ①A 판(vNext 세로 경로 없음).
 *   legacy · MISSING · INVALID → 기존 legacy 그대로 (INVALID 만 경고 1줄)
 *   VALID vnext               → VNEXT_NOT_IMPLEMENTED · 아무것도 시작하지 않는다
 * @param {{code:string, effective:{path:string}, why:string|null, path:string}} read
 * @param {{warn?:boolean}} [opts] warn=false 면 INVALID 경고를 내지 않는다 (같은 회차의 재실행 자식)
 */
export function rolloutGate(read, { warn = true } = {}) {
  if (read.code === 'VALID' && read.effective.path === 'vnext') {
    return {
      proceed: false,
      exitCode: 1,
      line: JSON.stringify({ code: 'VNEXT_NOT_IMPLEMENTED', rollout: read.effective, message: 'rollout 이 vnext 인데 이 코드 판에는 vNext 세로 경로가 없다 — 아무것도 시작하지 않는다 (legacy 로 대신 실행하지 않는다)' }),
    }
  }
  const warning = read.code === 'INVALID' && warn
    ? JSON.stringify({ code: 'MAGAZINE_ROLLOUT_INVALID', why: read.why, fallback: ROLLOUT_FALLBACK, message: 'rollout 설정이 손상됐거나 schema 와 다르다 — legacy 로 진행한다' })
    : null
  return { proceed: true, warning }
}

/** 실효값 비교 */
const sameEffective = (a, b) => a.path === b.path && a.release === b.release && a.targetCandidates === b.targetCandidates

export class RolloutWriteError extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; this.why = why }
}

/**
 * 쓰기 — 단일 owner. 잠금(`<path>.lock`, O_EXCL)을 쥔 채로 현재 값을 읽고, previous 를 그 실효값에서 계산해
 * temp(O_EXCL · 0600) → fsync → rename → 디렉터리 fsync 순서로 바꾼다. 실패하면 기존 바이트를 그대로 둔다.
 *
 * 같은 값 재실행: 현재 파일이 VALID 이고 실효값(path·release·targetCandidates)이 요청과 같으면 NO_CHANGE — 쓰기 0.
 *
 * @param {object} p
 * @param {{path:string, release:string, targetCandidates:number}} p.next
 * @param {string} p.changedBy
 * @param {boolean} [p.write=false] false 면 계획만 돌려준다 (쓰기 0)
 * @param {string} [p.path]
 * @param {() => Date} [p.now]
 * @param {object} [p.fs]         시험용 대역 — 단계별 실패 주입
 * @param {() => void} [p.holdInLock] 시험용 — 잠금을 쥔 채로 기다린다(동시 실행 반례)
 */
export function writeRollout({ next, changedBy, write = false, path = rolloutPath(), now = () => new Date(), fs = nodeFs, holdInLock = null }) {
  const core = validateCore(next ?? {}, '')
  if (core) throw new RolloutWriteError('INVALID_REQUEST', core)
  if (typeof changedBy !== 'string' || changedBy.trim() === '') throw new RolloutWriteError('INVALID_REQUEST', 'changedBy 가 필요하다')

  const plan = (current) => {
    if (current.code === 'VALID' && sameEffective(current.effective, next)) return { action: 'NO_CHANGE', current }
    const at = now()
    const doc = {
      schemaVersion: ROLLOUT_SCHEMA,
      path: next.path,
      release: next.release,
      targetCandidates: next.targetCandidates,
      changedBy: changedBy.trim(),
      changedAt: at.toISOString(),
      previous: { ...current.effective },
    }
    const v = validateRollout(doc)
    if (!v.ok) throw new RolloutWriteError('INVALID_REQUEST', v.why)
    return { action: 'WRITE', current, doc, text: `${JSON.stringify(doc, null, 2)}\n` }
  }

  if (!write) {
    const p = plan(readRollout({ path, fs }))
    return { ok: true, written: false, dryRun: true, action: p.action, from: p.current.effective, fromCode: p.current.code, to: p.doc ?? null, path }
  }

  const dir = dirname(path)
  // 🔴 새로 만드는 폴더만 0700 이다 — 이미 있는 폴더(다른 장부가 사는 곳)의 권한은 바꾸지 않는다
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const lockPath = `${path}.lock`
  const token = randomUUID()
  let lockFd
  try {
    lockFd = fs.openSync(lockPath, 'wx', 0o600)
  } catch (e) {
    if (e?.code === 'EEXIST') {
      let holder = null
      try { holder = fs.readFileSync(lockPath, 'utf8') } catch { holder = null }
      // 🔴 남의 잠금을 지우거나 덮지 않는다 — 주인 확인은 사람 몫이다
      throw new RolloutWriteError('LOCK_BUSY', `다른 writer 가 잠금을 쥐고 있다 (${lockPath}${holder ? ` · ${holder.trim()}` : ''}) — 자동으로 지우지 않는다`)
    }
    throw new RolloutWriteError('LOCK_FAILED', `잠금을 만들지 못했다 (${e?.code ?? e?.name})`)
  }
  let tmp = null
  let tokenWritten = false
  try {
    fs.writeSync(lockFd, `${JSON.stringify({ pid: process.pid, token, at: now().toISOString() })}\n`)
    tokenWritten = true
    fs.closeSync(lockFd); lockFd = null
    holdInLock?.()

    // 🔴 잠금 안에서 읽는다 — previous 는 바로 이 바이트의 실효값이다(사용자 입력이 아니다)
    const p = plan(readRollout({ path, fs }))
    if (p.action === 'NO_CHANGE') return { ok: true, written: false, dryRun: false, action: 'NO_CHANGE', from: p.current.effective, fromCode: p.current.code, to: null, path }

    tmp = `${path}.tmp-${process.pid}-${token}`
    const fd = fs.openSync(tmp, 'wx', 0o600)
    try {
      fs.writeSync(fd, p.text)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, path)
    tmp = null
    try {
      const dfd = fs.openSync(dir, 'r')
      try { fs.fsyncSync(dfd) } finally { fs.closeSync(dfd) }
    } catch { /* 디렉터리 fsync 를 지원하지 않는 파일시스템 — rename 은 이미 원자적이다 */ }
    return { ok: true, written: true, dryRun: false, action: 'WRITE', from: p.current.effective, fromCode: p.current.code, to: p.doc, path }
  } catch (e) {
    if (e instanceof RolloutWriteError) throw e
    throw new RolloutWriteError('WRITE_FAILED', `${e?.code ?? e?.name ?? 'Error'} — 기존 rollout 바이트는 그대로다`)
  } finally {
    if (lockFd != null) { try { fs.closeSync(lockFd) } catch { /* 이미 닫힘 */ } }
    if (tmp) { try { fs.rmSync(tmp, { force: true }) } catch { /* 내 temp 정리 실패 — 다음 쓰기와 무관(이름이 다르다) */ } }
    // 🔴 내 잠금일 때만 푼다 — 내 token 이 있거나, 내가 막 만들고 token 을 쓰지 못한 빈 잠금일 때
    try {
      const cur = fs.readFileSync(lockPath, 'utf8')
      if (cur.includes(token) || (!tokenWritten && cur === '')) fs.rmSync(lockPath, { force: true })
    } catch { /* 잠금이 이미 없다 */ }
  }
}
