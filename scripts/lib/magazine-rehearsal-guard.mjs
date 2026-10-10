/**
 * 🔴 **rehearsal 경계 — 모든 node 자식이 `NODE_OPTIONS=--import` 로 먼저 읽는다** (2026-10-10).
 *
 *    rehearsal 은 실제 최상위 래퍼(producer-run · auto-register-run · auto-merge)를 그대로 돌린다.
 *    그 래퍼들은 운영 경로·네트워크·외부 명령을 기본값으로 갖고 있다. fixture 를 하나라도 빠뜨리면
 *    조용히 운영으로 새어 나간다. 그래서 **새기 전에 막고, 막은 사실을 남긴다.**
 *
 *      ① 쓰기    — 임시 루트 밖 경로에 쓰기·지우기·이름 바꾸기를 시도하면 즉시 예외 + 위반 기록
 *      ② 네트워크 — TCP 연결·DNS 조회·fetch 를 전부 막는다 (9333·9344 CDP · GitHub · Vercel · Slack 포함)
 *                   Slack webhook 만 fixture 가 받아 기록한다 (네트워크 0)
 *      ③ 외부 명령 — 허용 목록(node · 임시 bin 의 fixture · 읽기 전용 ps) 밖은 즉시 예외 + 위반 기록
 *      ④ 시계    — `SORAN_REHEARSAL_CLOCK` 고정 KST 시각 + 배속 (타이머도 같은 배속)
 *
 * 🔴 위반은 예외로 끝나지 않는다 — 래퍼가 예외를 삼켜도 기록이 남고, rehearsal 판정이 그 기록으로 FAIL 한다.
 * 🔴 이 파일은 rehearsal 밖에서 아무 일도 하지 않는다 — 필수 환경변수가 없으면 즉시 종료한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import dns from 'node:dns'
import cp from 'node:child_process'
import timers from 'node:timers'
import timersPromises from 'node:timers/promises'
import { syncBuiltinESMExports } from 'node:module'

const ENV = process.env
export const GUARD_ENV = Object.freeze({
  ROOT: 'SORAN_REHEARSAL_ROOT',
  CLOCK: 'SORAN_REHEARSAL_CLOCK',
  ROLE: 'SORAN_REHEARSAL_ROLE',
  REAL_GIT: 'SORAN_REHEARSAL_REAL_GIT',
  SLACK_HOOK: 'SORAN_REHEARSAL_SLACK_HOOK',
})

const rootRaw = ENV[GUARD_ENV.ROOT]
if (!rootRaw || !path.isAbsolute(rootRaw)) {
  process.stderr.write('REHEARSAL_GUARD_MISCONFIGURED — SORAN_REHEARSAL_ROOT 가 절대 경로가 아니다\n')
  process.exit(97)
}
const ROOT = fs.realpathSync(rootRaw)
const GUARD_DIR = path.join(ROOT, 'guard')
const BIN_DIR = path.join(ROOT, 'bin')

// ── 원본 보관 (기록은 원본으로만 한다) ──────────────────────
const O = {
  appendFileSync: fs.appendFileSync, mkdirSync: fs.mkdirSync, realpathSync: fs.realpathSync, existsSync: fs.existsSync,
  statSync: fs.statSync,
}
O.mkdirSync(GUARD_DIR, { recursive: true })
const LOG = path.join(GUARD_DIR, `events-${process.pid}.jsonl`)
const RealDate = Date

function record(kind, detail) {
  try {
    O.appendFileSync(LOG, `${JSON.stringify({ kind, pid: process.pid, role: ENV[GUARD_ENV.ROLE] ?? null, script: process.argv[1] ?? null, at: RealDate.now(), ...detail })}\n`)
  } catch { /* 기록 실패는 위반 판정을 바꾸지 않는다 — 예외는 그대로 던진다 */ }
}
function violate(kind, detail) {
  record('VIOLATION', { violation: kind, ...detail })
  const e = new Error(`REHEARSAL_GUARD ${kind} — ${JSON.stringify(detail).slice(0, 300)}`)
  e.code = 'REHEARSAL_GUARD'
  throw e
}

// ─────────────────────────────────────────────────────────
// ① 쓰기
// ─────────────────────────────────────────────────────────

const ALLOWED_DEVICES = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty'])

function toPath(p) {
  if (p instanceof URL) return p.protocol === 'file:' ? decodeURIComponent(p.pathname) : null
  if (Buffer.isBuffer(p)) return p.toString('utf8')
  return typeof p === 'string' ? p : null
}

/** 실제 위치 — 존재하는 가장 깊은 조상까지 symlink 를 푼다 (symlink 로 루트 밖에 쓰는 길을 막는다) */
function realLocation(abs) {
  let cur = abs
  const rest = []
  for (;;) {
    try { return path.join(O.realpathSync(cur), ...rest.reverse()) } catch { /* 없으면 위로 */ }
    const up = path.dirname(cur)
    if (up === cur) return abs
    rest.push(path.basename(cur))
    cur = up
  }
}

export function insideRoot(p) {
  const raw = toPath(p)
  if (raw === null) return true // fd 숫자 — 이미 열린 것은 open 에서 판정했다
  const abs = path.resolve(raw)
  if (ALLOWED_DEVICES.has(abs)) return true
  const loc = realLocation(abs)
  return loc === ROOT || loc.startsWith(ROOT + path.sep)
}

function checkWrite(op, ...paths) {
  for (const p of paths) {
    if (typeof p === 'number') continue
    if (!insideRoot(p)) violate('WRITE_OUTSIDE_ROOT', { op, path: toPath(p) })
  }
}

const WRITE_FLAGS = /[wa+]/
function openWrites(flags) {
  if (flags === undefined || flags === null) return false
  if (typeof flags === 'number') {
    const C = fs.constants
    return Boolean(flags & (C.O_WRONLY | C.O_RDWR | C.O_CREAT | C.O_APPEND | C.O_TRUNC))
  }
  return WRITE_FLAGS.test(String(flags))
}

/** 첫 인자(경로)만 쓰는 함수 */
const ONE = ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink', 'truncate', 'chmod', 'chown', 'lchown', 'utimes', 'lutimes', 'mkdtemp']
/** 두 경로 모두 쓰는 함수 (rename: 둘 다 · copy/link/symlink: 대상) */
const TWO_BOTH = ['rename']
const TWO_DEST = ['copyFile', 'cp', 'link', 'symlink']

function wrapSet(target, suffix) {
  for (const n of ONE) {
    const k = `${n}${suffix}`
    if (typeof target[k] !== 'function') continue
    const orig = target[k]
    target[k] = function guarded(p, ...a) { checkWrite(k, p); return orig.call(this, p, ...a) }
  }
  for (const n of TWO_BOTH) {
    const k = `${n}${suffix}`
    if (typeof target[k] !== 'function') continue
    const orig = target[k]
    target[k] = function guarded(a, b, ...r) { checkWrite(k, a, b); return orig.call(this, a, b, ...r) }
  }
  for (const n of TWO_DEST) {
    const k = `${n}${suffix}`
    if (typeof target[k] !== 'function') continue
    const orig = target[k]
    target[k] = function guarded(a, b, ...r) { checkWrite(k, b); return orig.call(this, a, b, ...r) }
  }
  const ok = `open${suffix}`
  if (typeof target[ok] === 'function') {
    const orig = target[ok]
    target[ok] = function guarded(p, flags, ...r) { if (openWrites(flags)) checkWrite(ok, p); return orig.call(this, p, flags, ...r) }
  }
}
wrapSet(fs, 'Sync')
wrapSet(fs, '')
{
  const orig = fs.createWriteStream
  fs.createWriteStream = function guarded(p, ...a) { checkWrite('createWriteStream', p); return orig.call(this, p, ...a) }
}
const promises = fs.promises
for (const n of [...ONE, ...TWO_BOTH, ...TWO_DEST]) {
  if (typeof promises[n] !== 'function') continue
  const orig = promises[n]
  const both = TWO_BOTH.includes(n)
  const dest = TWO_DEST.includes(n)
  promises[n] = function guarded(a, b, ...r) {
    if (both) checkWrite(`promises.${n}`, a, b)
    else if (dest) checkWrite(`promises.${n}`, b)
    else checkWrite(`promises.${n}`, a)
    return orig.call(this, a, b, ...r)
  }
}
{
  const orig = promises.open
  promises.open = function guarded(p, flags, ...r) { if (openWrites(flags)) checkWrite('promises.open', p); return orig.call(this, p, flags, ...r) }
}

// ─────────────────────────────────────────────────────────
// ② 네트워크 — 전부 막는다
// ─────────────────────────────────────────────────────────

const SLACK_HOOK = ENV[GUARD_ENV.SLACK_HOOK] ?? null

function describeTarget(args) {
  const a0 = args[0]
  if (Array.isArray(a0)) return describeTarget(a0)
  if (a0 && typeof a0 === 'object') return { host: a0.host ?? a0.hostname ?? null, port: a0.port ?? null, path: a0.path ?? null }
  if (typeof a0 === 'number') return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: a0 }
  if (typeof a0 === 'string') return { path: a0 }
  return {}
}
{
  const orig = net.Socket.prototype.connect
  net.Socket.prototype.connect = function guarded(...args) {
    const t = describeTarget(args)
    record('NETWORK_ATTEMPT', t)
    violate(Number(t.port) === 9333 || Number(t.port) === 9344 ? 'CDP_CONNECT' : 'NETWORK_CONNECT', t)
    return orig.apply(this, args)
  }
}
for (const n of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  const orig = dns[n]
  if (typeof orig !== 'function') continue
  dns[n] = function guarded(host, ...r) { record('NETWORK_ATTEMPT', { dns: host }); violate('DNS_LOOKUP', { host }); return orig.call(this, host, ...r) }
}

/** Slack 은 fixture 가 받는다 — 요청 본문을 기록하고 200 을 돌려준다. 그 밖의 fetch 는 전부 위반이다 */
globalThis.fetch = async function guardedFetch(input, init = {}) {
  const url = String(input?.url ?? input)
  if (SLACK_HOOK && url === SLACK_HOOK) {
    let body = init?.body ?? null
    try { body = JSON.parse(String(body)) } catch { /* 문자열 그대로 */ }
    record('SLACK_FIXTURE', { body })
    return new Response('ok', { status: 200 })
  }
  record('NETWORK_ATTEMPT', { url })
  let port = null
  try { port = new URL(url).port } catch { /* 모양이 아니어도 위반이다 */ }
  violate(port === '9333' || port === '9344' ? 'CDP_FETCH' : 'NETWORK_FETCH', { url })
}

// ─────────────────────────────────────────────────────────
// ③ 외부 명령
// ─────────────────────────────────────────────────────────

/** 읽기 전용 시스템 명령 — 잠금 주인 확인(ps) 같은 것 */
const SYSTEM_READONLY = new Set(['ps'])
const SHIMS = new Set(['claude', 'gh', 'git', 'curl', 'vercel'])
const GIT_ROLES = new Set(['git-shim', 'gh-shim', 'curl-shim'])

function resolveCommand(cmd, envPath) {
  if (cmd.includes('/')) return path.resolve(cmd)
  for (const dir of String(envPath ?? '').split(path.delimiter)) {
    if (!dir) continue
    const f = path.join(dir, cmd)
    try { if (O.statSync(f).isFile()) return f } catch { /* 다음 */ }
  }
  return null
}

function checkSpawn(op, cmd, opts) {
  const command = String(cmd)
  const envPath = opts?.env?.PATH ?? ENV.PATH
  const resolved = resolveCommand(command, envPath)
  const base = path.basename(command)
  let allowed = false
  if (resolved === process.execPath || command === process.execPath) allowed = true
  else if (resolved && resolved.startsWith(BIN_DIR + path.sep) && SHIMS.has(path.basename(resolved))) allowed = true
  // 🔴 실제 git 바이너리는 fixture(git·gh·curl) 안에서만 — 그 fixture 가 임시 루트·임시 origin 을 먼저 확인한다
  else if (GIT_ROLES.has(ENV[GUARD_ENV.ROLE]) && resolved && resolved === ENV[GUARD_ENV.REAL_GIT]) allowed = true
  else if (SYSTEM_READONLY.has(base) && resolved && /^\/(bin|usr\/bin)\//.test(resolved)) allowed = true
  record('SPAWN', { op, command, resolved, allowed })
  if (!allowed) violate('SPAWN_NOT_ALLOWED', { op, command, resolved })
  // 🔴 자식도 같은 경계 안에 있어야 한다 — env 를 통째로 바꾼 호출도 경계 변수를 잃지 않게
  if (opts?.env && !opts.env[GUARD_ENV.ROOT]) violate('SPAWN_ENV_DROPS_GUARD', { op, command })
}

const firstToken = (s) => String(s).trim().split(/\s+/)[0] ?? ''
for (const n of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const orig = cp[n]
  cp[n] = function guarded(cmd, args, opts, ...r) {
    const o = Array.isArray(args) ? opts : args
    checkSpawn(n, cmd, o && typeof o === 'object' ? o : null)
    return orig.call(this, cmd, args, opts, ...r)
  }
}
for (const n of ['exec', 'execSync']) {
  const orig = cp[n]
  cp[n] = function guarded(command, opts, ...r) {
    checkSpawn(n, firstToken(command), opts && typeof opts === 'object' ? opts : null)
    return orig.call(this, command, opts, ...r)
  }
}
{
  const orig = cp.fork
  cp.fork = function guarded(mod, ...r) { checkSpawn('fork', process.execPath, null); return orig.call(this, mod, ...r) }
}

// ─────────────────────────────────────────────────────────
// ④ 시계 — 고정 KST 시각 + 배속 (타이머도 같은 배속으로 줄인다)
//    `SORAN_REHEARSAL_CLOCK=<가짜 기준 ms>:<실제 기준 ms>:<배속>` — 모든 자식이 같은 값을 받아 같은 시계를 본다.
//    CI 30분 관찰 · 배포 10분 관찰 · handoff 40분 대기를 실제로 기다리지 않게 한다 (판정 로직은 그대로).
// ─────────────────────────────────────────────────────────

const clockRaw = ENV[GUARD_ENV.CLOCK]
let CLOCK = null
if (clockRaw) {
  const [fakeBase, realBase, speed] = clockRaw.split(':').map(Number)
  if (![fakeBase, realBase, speed].every(Number.isFinite) || speed <= 0) violate('CLOCK_MISCONFIGURED', { clock: clockRaw })
  CLOCK = { fakeBase, realBase, speed }
  const now = () => fakeBase + (RealDate.now() - realBase) * speed
  function FakeDate(...a) {
    if (!new.target) return new RealDate(now()).toString()
    return Reflect.construct(RealDate, a.length ? a : [now()], new.target)
  }
  FakeDate.prototype = RealDate.prototype
  Object.setPrototypeOf(FakeDate, RealDate)
  FakeDate.now = now
  FakeDate.parse = RealDate.parse
  FakeDate.UTC = RealDate.UTC
  globalThis.Date = FakeDate
  const scale = (ms) => Math.max(0, Number(ms ?? 0) / speed)
  const st = globalThis.setTimeout
  const si = globalThis.setInterval
  globalThis.setTimeout = function scaledTimeout(fn, ms, ...a) { return st(fn, scale(ms), ...a) }
  globalThis.setInterval = function scaledInterval(fn, ms, ...a) { return si(fn, scale(ms), ...a) }
  timers.setTimeout = globalThis.setTimeout
  timers.setInterval = globalThis.setInterval
  const ps = timersPromises.setTimeout
  const pi = timersPromises.setInterval
  timersPromises.setTimeout = function scaledPromiseTimeout(ms, ...a) { return ps(scale(ms), ...a) }
  timersPromises.setInterval = function scaledPromiseInterval(ms, ...a) { return pi(scale(ms), ...a) }
}

syncBuiltinESMExports()
record('GUARD_READY', { argv: process.argv.slice(1, 6), clock: CLOCK })
