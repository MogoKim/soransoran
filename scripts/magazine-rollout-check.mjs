#!/usr/bin/env node
/**
 * Magazine rollout switch 검사 (①A · runbook §0.0B.5).
 *
 * 세 묶음이다.
 *   U  library · CLI 반례 — 경로는 전부 임시 폴더를 주입한다(DI). 운영 rollout 경로를 쓰지 않는다.
 *   P  producer 진입점 — 임시 origin · 작업 사본 · 임시 HOME · 자식 대역(plan·brief·repair·webui·notify)으로
 *      launchd 가 부르는 같은 entrypoint 를 돌린다. 기준판(guard 를 걷어 낸 같은 파일)과 후보판의
 *      종료 코드 · 자식 호출(인자) · handoff · _runs 산출 · 로그를 정규화해 바이트 대조한다.
 *   A  auto-register 진입점 — 같은 방식(ready·merge 대역).
 *
 * 🔴 기준판은 "후보 파일에서 rollout import 와 guard 블록을 정확히 걷어 낸 것" 이다 — 저장소 이력에 기대지 않는다(CI depth 1).
 * 🔴 운영 runtime · 운영 장부 · 운영 rollout 경로 · launchd · 네트워크 · Chrome · Slack 실제 발송 0.
 *
 * 사용법
 *   node scripts/magazine-rollout-check.mjs                  전체
 *   node scripts/magazine-rollout-check.mjs --only U3,P4      일부 (id 접두)
 *   node scripts/magazine-rollout-check.mjs --mutate <id>     변이 적용 후 실행 (magazine-rollout-mutation.mjs 가 부른다)
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const LIB_REL = 'scripts/lib/magazine-rollout.mjs'
const CLI_REL = 'scripts/magazine-rollout.mjs'
const PRODUCER_REL = 'scripts/magazine-producer-run.mjs'
const REGISTER_REL = 'scripts/magazine-auto-register-run.mjs'

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? onlyArg.split(',').filter(Boolean) : null
const MUTATE = argv.includes('--mutate') ? argv[argv.indexOf('--mutate') + 1] : null

const TMPS = []
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); TMPS.push(d); return d }

/**
 * 🔴 운영 rollout 경로는 읽지도 쓰지도 않는다 — 이 검사 프로세스의 HOME 을 시작하자마자 임시 폴더로 바꾼다.
 *    lib 의 기본 경로(`rolloutPath()`)도 이 HOME 을 따른다. 자식 프로세스는 전부 시나리오별 임시 HOME 으로 띄운다.
 */
const SAFE_HOME = tmp('rollout-home-')
process.env.HOME = SAFE_HOME

// ── 변이 정의 (magazine-rollout-mutation.mjs 와 같은 id) ──
const GUARD_P = "if (!ROLLOUT.proceed) { console.error(ROLLOUT.line); process.exit(ROLLOUT.exitCode) }\n"
export const MUTATIONS = {
  'fallback-vnext': [LIB_REL, "export const ROLLOUT_FALLBACK = Object.freeze({ path: 'legacy'", "export const ROLLOUT_FALLBACK = Object.freeze({ path: 'vnext'"],
  'invalid-accepted': [LIB_REL, "  if (!v.ok) return { code: 'INVALID', effective: { ...ROLLOUT_FALLBACK }, config: null, why: v.why, path }\n", ''],
  'strict-schema-removed': [LIB_REL, 'return got.length === want.length && got.every((k, i) => k === want[i])', 'return true'],
  'write-boundary-removed': [CLI_REL, "write: argv.includes('--write')", 'write: true'],
  'cas-removed': [LIB_REL, "lockFd = fs.openSync(lockPath, 'wx', 0o600)", "lockFd = fs.openSync(lockPath, 'w', 0o600)"],
  'atomic-removed': [LIB_REL, "tmp = `${path}.tmp-${process.pid}-${token}`\n    const fd = fs.openSync(tmp, 'wx', 0o600)", 'tmp = null\n    const fd = fs.openSync(path, \'w\', 0o600)'],
  'previous-unchecked': [LIB_REL, 'previous: { ...current.effective },', 'previous: { ...ROLLOUT_FALLBACK },'],
  'producer-guard-removed': [PRODUCER_REL, GUARD_P, ''],
  'register-guard-removed': [REGISTER_REL, GUARD_P, ''],
  'vnext-runs-legacy': [LIB_REL, "if (read.code === 'VALID' && read.effective.path === 'vnext') {", 'if (false) {'],
  'producer-guard-late': [PRODUCER_REL, GUARD_P, '', '// 🔴 **완료 신호를 남긴다**', `${GUARD_P}// 🔴 **완료 신호를 남긴다**`],
  'register-guard-late': [REGISTER_REL, GUARD_P, '', 'line(reason)\n', `line(reason)\n${GUARD_P}`],
  // legacy 동일성 대조의 검출력 — legacy 자식 인자를 바꾸면 기준판 대조가 잡아야 한다
  'producer-legacy-drift': [PRODUCER_REL, "spawnStage([INPUT_REPAIR, '--run', kstDate(), '--write', '--result-json', rj])", "spawnStage([INPUT_REPAIR, '--run', kstDate(), '--write', '--result-json', rj, '--drift'])"],
  'register-legacy-drift': [REGISTER_REL, "[MERGE, '--apply', '--notify-send', '--run-id', RUN_ID]", "[MERGE, '--apply', '--notify-send', '--run-id', RUN_ID, '--drift']"],
  'post-sync-bypass': [PRODUCER_REL, 'const ROLLOUT = rolloutGate(readRollout(), { warn: !POST_SYNC })', 'const ROLLOUT = POST_SYNC ? { proceed: true, warning: null } : rolloutGate(readRollout(), { warn: true })'],
}

/** 후보 파일 내용 — 변이가 있으면 정확히 1곳에 적용한다(0곳·여러 곳이면 하네스 결함으로 멈춘다) */
function candidate(rel) {
  let text = readFileSync(join(ROOT, rel), 'utf8')
  if (MUTATE) {
    const m = MUTATIONS[MUTATE]
    if (!m) { console.log(`HARNESS 모르는 변이 ${MUTATE}`); process.exit(2) }
    if (m[0] === rel) {
      for (let i = 1; i < m.length; i += 2) {
        if (text.split(m[i]).length !== 2) { console.log(`HARNESS 변이 지점이 정확히 1곳이 아니다 — ${MUTATE} (${rel})`); process.exit(2) }
        text = text.replace(m[i], m[i + 1])
      }
    }
  }
  return text
}
if (MUTATE) { if (!MUTATIONS[MUTATE]) { console.log(`HARNESS 모르는 변이 ${MUTATE}`); process.exit(2) } candidate(MUTATIONS[MUTATE][0]); console.log(`MUTATION APPLIED ${MUTATE}`) }

/** 기준판 — rollout import 와 guard 블록을 정확히 걷어 낸다 */
const IMPORT_LINE = "import { readRollout, rolloutGate } from './lib/magazine-rollout.mjs'\n"
const GUARD_START = '\n/**\n * 🔴 **rollout 판정**'
const GUARD_END = 'if (ROLLOUT.warning) console.error(ROLLOUT.warning)\n'
function baseline(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8')
  if (text.split(IMPORT_LINE).length !== 2 || text.split(GUARD_START).length !== 2 || text.split(GUARD_END).length !== 2) throw new Error(`기준판을 만들 수 없다 — ${rel} 의 guard 모양이 바뀌었다 (하네스 결함)`)
  const t = text.replace(IMPORT_LINE, '')
  const start = t.indexOf(GUARD_START)
  const end = t.indexOf(GUARD_END, start)
  if (start === -1 || end === -1) throw new Error(`기준판을 만들 수 없다 — ${rel} (하네스 결함)`)
  return t.slice(0, start) + t.slice(end + GUARD_END.length)
}

// ── 결과 집계 ──
let pass = 0
let fail = 0
let ran = 0
const selected = (id) => !ONLY || ONLY.some((p) => id.startsWith(p))
async function test(id, name, fn) {
  if (!selected(id)) return
  ran++
  let ok = false
  let detail = ''
  try { const r = await fn(); ok = r === true || r?.ok === true; detail = r?.detail ?? '' } catch (e) { ok = false; detail = `예외 ${e?.message ?? e}` }
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${!ok && detail ? ` — ${String(detail).slice(0, 400)}` : ''}`)
}

// ─────────────────────────────────────────────────────────────
// U — library · CLI
// ─────────────────────────────────────────────────────────────
const UDIR = tmp('rollout-u-')
mkdirSync(join(UDIR, 'scripts', 'lib'), { recursive: true })
writeFileSync(join(UDIR, LIB_REL), candidate(LIB_REL))
writeFileSync(join(UDIR, CLI_REL), candidate(CLI_REL))
const L = await import(pathToFileURL(join(UDIR, LIB_REL)).href)

const ISO = '2026-11-03T05:00:00.000Z'
const doc = (over = {}) => ({ schemaVersion: 'magazine-rollout/1', path: 'legacy', release: 'draft', targetCandidates: 1, changedBy: 'test', changedAt: ISO, previous: { path: 'legacy', release: 'draft', targetCandidates: 1 }, ...over })
const fresh = () => { const d = tmp('rollout-f-'); return { dir: d, file: join(d, 'sub', 'magazine-rollout.json') } }
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const readAs = (text) => { const f = fresh(); put(f.file, text); return L.readRollout({ path: f.file }) }
const isLegacyFallback = (r) => r.effective.path === 'legacy' && r.effective.release === 'draft' && r.effective.targetCandidates === 1
const listAll = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).map(String).sort() : [])

await test('U1', '파일 없음 → MISSING · legacy fallback · 쓰기 0', () => {
  const f = fresh(); const before = listAll(f.dir)
  const r = L.readRollout({ path: f.file })
  return { ok: r.code === 'MISSING' && isLegacyFallback(r) && JSON.stringify(listAll(f.dir)) === JSON.stringify(before) && !existsSync(dirname(f.file)), detail: JSON.stringify(r) }
})
await test('U2', '정상 legacy/draft/1 · vnext/draft/1 · vnext/auto/7 → VALID · 실효값 그대로', () => {
  const a = readAs(JSON.stringify(doc()))
  const b = readAs(JSON.stringify(doc({ path: 'vnext' })))
  const c = readAs(JSON.stringify(doc({ path: 'vnext', release: 'auto', targetCandidates: 7 })))
  return { ok: a.code === 'VALID' && a.effective.path === 'legacy' && b.code === 'VALID' && b.effective.path === 'vnext' && b.effective.release === 'draft'
    && c.code === 'VALID' && c.effective.release === 'auto' && c.effective.targetCandidates === 7, detail: JSON.stringify([a.code, b.code, c.code]) }
})
const INVALIDS = {
  'JSON 손상': '{"schemaVersion": "magazine-rollout/1", "path": "vnext"',
  'schemaVersion 불일치': JSON.stringify(doc({ schemaVersion: 'magazine-rollout/2', path: 'vnext' })),
  '필드 누락(changedBy)': JSON.stringify((({ changedBy, ...rest }) => rest)(doc({ path: 'vnext' }))),
  '필드 추가': JSON.stringify(doc({ path: 'vnext', extra: 1 })),
  'previous 필드 추가': JSON.stringify(doc({ path: 'vnext', previous: { path: 'legacy', release: 'draft', targetCandidates: 1, note: 'x' } })),
  'previous 누락 필드': JSON.stringify(doc({ path: 'vnext', previous: { path: 'legacy', release: 'draft' } })),
  'previous 배열': JSON.stringify(doc({ path: 'vnext', previous: [] })),
  'path enum': JSON.stringify(doc({ path: 'direct' })),
  'release enum': JSON.stringify(doc({ path: 'vnext', release: 'manual' })),
  'previous.path enum': JSON.stringify(doc({ path: 'vnext', previous: { path: 'x', release: 'draft', targetCandidates: 1 } })),
  'changedAt 비 ISO': JSON.stringify(doc({ path: 'vnext', changedAt: '2026-11-03 05:00' })),
  'changedAt 없는 날짜': JSON.stringify(doc({ path: 'vnext', changedAt: '2026-13-40T05:00:00.000Z' })),
  'changedBy 빈 문자열': JSON.stringify(doc({ path: 'vnext', changedBy: '  ' })),
  'targetCandidates 0': JSON.stringify(doc({ path: 'vnext', targetCandidates: 0 })),
  'targetCandidates 소수': JSON.stringify(doc({ path: 'vnext', targetCandidates: 1.5 })),
  'targetCandidates 문자열': JSON.stringify(doc({ path: 'vnext', targetCandidates: '1' })),
  'targetCandidates 비안전 정수': JSON.stringify(doc({ path: 'vnext', targetCandidates: 2 ** 60 })),
  '최상위 배열': '[]',
}
await test('U3', `손상·schema 불일치 ${Object.keys(INVALIDS).length}종 → INVALID · legacy fallback`, () => {
  const bad = Object.entries(INVALIDS).filter(([, t]) => { const r = readAs(t); return !(r.code === 'INVALID' && isLegacyFallback(r) && r.why) }).map(([k]) => k)
  return { ok: bad.length === 0, detail: `통과해 버린 반례: ${bad.join(', ')}` }
})
await test('U4', 'gate — legacy·MISSING 진행·경고 0 · INVALID 진행·경고 1 · 자식(warn:false) 경고 0 · vnext 정지 non-zero', () => {
  const leg = L.rolloutGate(readAs(JSON.stringify(doc())))
  const mis = L.rolloutGate(L.readRollout({ path: fresh().file }))
  const inv = L.rolloutGate(readAs('{'))
  const invChild = L.rolloutGate(readAs('{'), { warn: false })
  const vn = L.rolloutGate(readAs(JSON.stringify(doc({ path: 'vnext' }))))
  const vnChild = L.rolloutGate(readAs(JSON.stringify(doc({ path: 'vnext' }))), { warn: false })
  return { ok: leg.proceed && !leg.warning && mis.proceed && !mis.warning && inv.proceed && /MAGAZINE_ROLLOUT_INVALID/.test(inv.warning ?? '')
    && invChild.proceed && !invChild.warning && !vn.proceed && vn.exitCode !== 0 && /VNEXT_NOT_IMPLEMENTED/.test(vn.line) && !vnChild.proceed,
  detail: JSON.stringify({ leg, mis, inv, vn }) }
})
const clock = (iso) => () => new Date(iso)
await test('U5', 'dry-run 쓰기 0 — 폴더도 만들지 않는다', () => {
  const f = fresh()
  const r = L.writeRollout({ path: f.file, next: { path: 'vnext', release: 'draft', targetCandidates: 1 }, changedBy: 'test', write: false, now: clock(ISO) })
  return { ok: r.dryRun && !r.written && r.action === 'WRITE' && !existsSync(dirname(f.file)), detail: JSON.stringify(r) }
})
await test('U6', 'write — 폴더 0700 · 파일 0600 · schema VALID · 첫 previous=legacy/draft/1 · changedAt=주입 시각', () => {
  const f = fresh()
  const r = L.writeRollout({ path: f.file, next: { path: 'vnext', release: 'draft', targetCandidates: 1 }, changedBy: 'founder', write: true, now: clock(ISO) })
  const back = L.readRollout({ path: f.file })
  const dmode = statSync(dirname(f.file)).mode & 0o777
  const fmode = statSync(f.file).mode & 0o777
  return { ok: r.written && back.code === 'VALID' && dmode === 0o700 && fmode === 0o600 && back.config.changedAt === ISO && back.config.changedBy === 'founder'
    && JSON.stringify(back.config.previous) === JSON.stringify({ path: 'legacy', release: 'draft', targetCandidates: 1 })
    && listAll(dirname(f.file)).length === 1, detail: JSON.stringify({ dmode: dmode.toString(8), fmode: fmode.toString(8), back, left: listAll(dirname(f.file)) }) }
})
await test('U7', '두 번째 write 의 previous = 디스크의 직전 실효값 · 같은 값 재실행 = NO_CHANGE(바이트 불변)', () => {
  const f = fresh()
  L.writeRollout({ path: f.file, next: { path: 'vnext', release: 'draft', targetCandidates: 1 }, changedBy: 'a', write: true, now: clock(ISO) })
  L.writeRollout({ path: f.file, next: { path: 'vnext', release: 'auto', targetCandidates: 3 }, changedBy: 'b', write: true, now: clock('2026-11-04T00:00:00.000Z') })
  const second = L.readRollout({ path: f.file })
  const bytes = readFileSync(f.file)
  const again = L.writeRollout({ path: f.file, next: { path: 'vnext', release: 'auto', targetCandidates: 3 }, changedBy: 'c', write: true, now: clock('2026-11-05T00:00:00.000Z') })
  return { ok: JSON.stringify(second.config.previous) === JSON.stringify({ path: 'vnext', release: 'draft', targetCandidates: 1 })
    && again.action === 'NO_CHANGE' && !again.written && Buffer.compare(bytes, readFileSync(f.file)) === 0, detail: JSON.stringify({ second: second.config, again }) }
})
await test('U8', '손상 파일 위 write → previous = legacy fallback (손상 바이트를 실효값으로 믿지 않는다)', () => {
  const f = fresh(); put(f.file, '{ broken')
  L.writeRollout({ path: f.file, next: { path: 'legacy', release: 'draft', targetCandidates: 1 }, changedBy: 'x', write: true, now: clock(ISO) })
  const back = L.readRollout({ path: f.file })
  return { ok: back.code === 'VALID' && JSON.stringify(back.config.previous) === JSON.stringify({ path: 'legacy', release: 'draft', targetCandidates: 1 }), detail: JSON.stringify(back) }
})
const realFs = await import('node:fs')
const faultyFs = (step) => ({ ...realFs, [step]: (...a) => { if (step === 'writeSync' && !String(a[1]).includes('schemaVersion')) return realFs.writeSync(...a); throw Object.assign(new Error(`주입 실패 ${step}`), { code: 'EIO' }) } })
for (const step of ['writeSync', 'fsyncSync', 'renameSync']) {
  await test(`U9-${step}`, `${step} 실패 → 기존 rollout 바이트 보존 · temp·잠금 잔여 0`, () => {
    const f = fresh()
    L.writeRollout({ path: f.file, next: { path: 'legacy', release: 'draft', targetCandidates: 1 }, changedBy: 'seed', write: true, now: clock(ISO) })
    const before = readFileSync(f.file)
    let code = null
    try { L.writeRollout({ path: f.file, next: { path: 'vnext', release: 'draft', targetCandidates: 1 }, changedBy: 'x', write: true, now: clock(ISO), fs: faultyFs(step) }) } catch (e) { code = e.code }
    return { ok: code === 'WRITE_FAILED' && Buffer.compare(before, readFileSync(f.file)) === 0 && JSON.stringify(listAll(dirname(f.file))) === JSON.stringify(['magazine-rollout.json']),
      detail: JSON.stringify({ code, left: listAll(dirname(f.file)) }) }
  })
}
await test('U10', '남의 잠금 → LOCK_BUSY · 잠금·파일 그대로 (자동 삭제 0)', () => {
  const f = fresh()
  L.writeRollout({ path: f.file, next: { path: 'legacy', release: 'draft', targetCandidates: 1 }, changedBy: 'seed', write: true, now: clock(ISO) })
  const before = readFileSync(f.file)
  writeFileSync(`${f.file}.lock`, '{"pid":1,"token":"other"}\n')
  let code = null
  try { L.writeRollout({ path: f.file, next: { path: 'vnext', release: 'draft', targetCandidates: 1 }, changedBy: 'x', write: true, now: clock(ISO) }) } catch (e) { code = e.code }
  return { ok: code === 'LOCK_BUSY' && readFileSync(`${f.file}.lock`, 'utf8') === '{"pid":1,"token":"other"}\n' && Buffer.compare(before, readFileSync(f.file)) === 0, detail: String(code) }
})

// CLI — 임시 HOME 으로 정본 경로가 임시 폴더 안을 가리킨다
const cli = (home, args, extraEnv = {}) => spawnSync(process.execPath, [join(UDIR, CLI_REL), ...args], { encoding: 'utf8', env: { HOME: home, PATH: process.env.PATH, ...extraEnv }, timeout: 30000 })
const homeRollout = (home) => join(home, 'Library', 'Application Support', 'soransoran', 'magazine-rollout.json')
await test('U11', 'CLI --help · 사용법 오류 · status · set(dry-run) → 쓰기 0', () => {
  const home = tmp('rollout-cli-')
  const h = cli(home, ['--help'])
  const bad = [['set', '--path', 'vnext'], ['set', '--path', 'x', '--release', 'draft', '--target-candidates', '1', '--changed-by', 'a'], ['set', '--path', 'vnext', '--release', 'draft', '--target-candidates', '0', '--changed-by', 'a'], ['bogus'], ['set', '--file', '/tmp/x'], ['status', '--write']].map((a) => cli(home, a).status)
  const st = cli(home, ['status'])
  const dry = cli(home, ['set', '--path', 'vnext', '--release', 'draft', '--target-candidates', '1', '--changed-by', 'a'])
  const hold = cli(home, ['status'], { SORAN_MAGAZINE_ROLLOUT_TEST_HOLD_MS: '10' })
  return { ok: h.status === 0 && bad.every((c) => c === 2) && st.status === 0 && JSON.parse(st.stdout).code === 'MISSING' && dry.status === 0 && JSON.parse(dry.stdout).dryRun === true
    && hold.status === 2 && listAll(home).length === 0, detail: JSON.stringify({ help: h.status, bad, st: st.status, dry: dry.stdout.slice(0, 200), hold: hold.status, left: listAll(home) }) }
})
await test('U12', 'CLI set --write → 0700/0600 · previous 정확 · 같은 값 재실행 NO_CHANGE', () => {
  const home = tmp('rollout-cli-')
  const w1 = cli(home, ['set', '--path', 'vnext', '--release', 'draft', '--target-candidates', '1', '--changed-by', 'founder', '--write'])
  const w2 = cli(home, ['set', '--path', 'vnext', '--release', 'draft', '--target-candidates', '1', '--changed-by', 'founder', '--write'])
  const f = homeRollout(home)
  const back = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
  return { ok: w1.status === 0 && JSON.parse(w1.stdout).written === true && w2.status === 0 && JSON.parse(w2.stdout).action === 'NO_CHANGE'
    && back?.path === 'vnext' && back?.previous?.path === 'legacy' && (statSync(f).mode & 0o777) === 0o600 && (statSync(dirname(f)).mode & 0o777) === 0o700,
  detail: JSON.stringify({ w1: w1.stdout.slice(0, 200), w2: w2.stdout.slice(0, 200), back }) }
})
await test('U13', '두 실제 자식 프로세스 동시 write → 정확히 하나만 성공 · 다른 하나 LOCK_BUSY · 파일 VALID', async () => {
  const home = tmp('rollout-race-')
  const { spawn } = await import('node:child_process')
  const run = (p) => new Promise((res) => {
    const c = spawn(process.execPath, [join(UDIR, CLI_REL), 'set', '--path', p, '--release', 'draft', '--target-candidates', '1', '--changed-by', `w-${p}`, '--write'],
      { env: { HOME: home, PATH: process.env.PATH, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_MAGAZINE_ROLLOUT_TEST_HOLD_MS: '1500' } })
    let out = ''; c.stdout.on('data', (d) => { out += d }); c.on('close', (code) => res({ code, out }))
  })
  const [a, b] = await Promise.all([run('vnext'), run('legacy')])
  const codes = [a, b].map((r) => { try { return JSON.parse(r.out).code ?? (JSON.parse(r.out).written ? 'WRITTEN' : 'OTHER') } catch { return `EXIT${r.code}` } })
  const back = L.readRollout({ path: homeRollout(home) })
  return { ok: codes.filter((c) => c === 'WRITTEN').length === 1 && codes.filter((c) => c === 'LOCK_BUSY').length === 1 && back.code === 'VALID' && !existsSync(`${homeRollout(home)}.lock`),
    detail: JSON.stringify({ codes, back: back.code }) }
})

// ─────────────────────────────────────────────────────────────
// P · A — 진입점 sandbox
// ─────────────────────────────────────────────────────────────
const kstDate = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(' ')} → ${r.status}: ${(r.stderr || r.stdout || '').slice(0, 300)}`)
  return r
}
const git = (cwd, ...args) => sh('git', args, { cwd }).stdout.trim()
const overlayFiles = () => {
  const changed = sh('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT }).stdout.split('\n').filter(Boolean)
  const added = sh('git', ['ls-files', '--others', '--exclude-standard', 'scripts'], { cwd: ROOT }).stdout.split('\n').filter(Boolean)
  return [...new Set([...changed, ...added])].filter((f) => existsSync(join(ROOT, f)))
}
const REC = `import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
const __rec = (stage, extra = {}) => appendFileSync(join(process.env.HOME, 'calls.log'), JSON.stringify({ stage, argv: process.argv.slice(2), ...extra }) + '\\n')
const kst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
`
const STUBS = {
  'scripts/magazine-producer-plan.mjs': `${REC}import { mkdirSync, writeFileSync } from 'node:fs'
__rec('plan')
const dir = join(process.cwd(), 'drafts/magazine/_runs', kst()); mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'run.json'), JSON.stringify({ schemaVersion: 'producer-run/2', date: kst(), status: 'COMPLETED', selected: [{ day: 1, slug: 'rollout-canary' }], reusable: [], held: [] }))
process.exit(0)`,
  'scripts/magazine-brief-auto.mjs': `${REC}__rec('brief'); process.exit(0)`,
  'scripts/magazine-input-repair.mjs': `${REC}import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
__rec('repair')
const rj = process.argv[process.argv.indexOf('--result-json') + 1]; mkdirSync(dirname(rj), { recursive: true })
writeFileSync(rj, JSON.stringify({ ok: true, results: [], skipped: [], recovered: [], resultFile: rj })); process.exit(0)`,
  'scripts/magazine-webui-runner.mjs': `${REC}import { writeFetchResults, fetchResultPath } from './lib/magazine-fetch-result.mjs'
__rec('fetch')
writeFetchResults(fetchResultPath(kst()), { date: kst(), mode: 'fetch-run', sentTotal: 0, results: [{ slug: 'rollout-canary', status: 'ok', sent: false }] })
process.exit(0)`,
  'scripts/magazine-producer-notify.mjs': `${REC}__rec('notify'); process.exit(0)`,
  'scripts/magazine-auto-register-ready.mjs': `${REC}import { mkdirSync, writeFileSync } from 'node:fs'
__rec('ready')
const runId = process.argv[process.argv.indexOf('--run-id') + 1]
if (process.argv.includes('--write')) { const d = join(process.cwd(), 'drafts/magazine/_runs', kst()); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'auto-register.json'), JSON.stringify({ runId, done: [], blocked: [], exitCode: 0 })) }
process.exit(0)`,
  'scripts/magazine-auto-merge.mjs': `${REC}import { mkdirSync, writeFileSync } from 'node:fs'
__rec('merge')
const runId = process.argv[process.argv.indexOf('--run-id') + 1]
const d = join(process.cwd(), 'drafts/magazine/_runs', kst()); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'auto-merge.json'), JSON.stringify({ runId, merged: false, prs: [] }))
process.exit(0)`,
}

/**
 * 한 회차 — 임시 origin · 작업 사본 · HOME 을 만들고 entrypoint 를 한 번 돌린다.
 * @param {{entry:string, entryText:string, rollout?:string|null, args?:string[], ff?:boolean, hook?:string|null, before?:Function}} o
 */
function scenario({ entry, entryText, rollout = null, args = [], ff = false, hook = null, before = null }) {
  const T = tmp('rollout-s-')
  const HOME = join(T, 'home'); mkdirSync(HOME, { recursive: true })
  const BIN = join(T, 'bin'); mkdirSync(BIN, { recursive: true })
  for (const [name, out] of [['claude', 'claude 0.0.0-rollout-check'], ['gh', 'gh version 0.0.0-rollout-check']]) { writeFileSync(join(BIN, name), `#!/bin/sh\necho "${out}"\n`); chmodSync(join(BIN, name), 0o755) }
  const ORIGIN = join(T, 'origin')
  sh('git', ['clone', '-q', '--shared', '--no-checkout', ROOT, ORIGIN])
  git(ORIGIN, 'checkout', '-q', '--orphan', 'rc-start', 'HEAD')
  git(ORIGIN, 'config', 'user.email', 'rollout-check@example.invalid'); git(ORIGIN, 'config', 'user.name', 'rollout-check')
  const putO = (rel, text) => { mkdirSync(dirname(join(ORIGIN, rel)), { recursive: true }); writeFileSync(join(ORIGIN, rel), text) }
  for (const rel of overlayFiles()) putO(rel, readFileSync(join(ROOT, rel), 'utf8'))
  putO(LIB_REL, candidate(LIB_REL))
  for (const [rel, text] of Object.entries(STUBS)) putO(rel, text)
  putO(entry, entryText)
  putO('scripts/.rollout-code-id', 'START\n')
  git(ORIGIN, 'add', '-A'); git(ORIGIN, 'commit', '-q', '--no-verify', '-m', 'rollout-check: 시작 HEAD')
  git(ORIGIN, 'branch', '-q', '-M', 'rc-start', 'main')
  const START = git(ORIGIN, 'rev-parse', 'HEAD')
  if (ff) { putO('scripts/.rollout-code-id', 'NEW\n'); git(ORIGIN, 'add', '-A'); git(ORIGIN, 'commit', '-q', '--no-verify', '-m', 'rollout-check: 새 HEAD') }
  git(ORIGIN, 'checkout', '-q', '--detach')
  const W = join(T, 'work')
  sh('git', ['clone', '-q', '--shared', '-b', 'main', ORIGIN, W])
  git(W, 'reset', '-q', '--hard', START)
  git(W, 'config', 'user.email', 'rollout-check@example.invalid'); git(W, 'config', 'user.name', 'rollout-check')
  if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(W, 'node_modules'))
  if (hook) { writeFileSync(join(W, '.git/hooks/post-merge'), hook); chmodSync(join(W, '.git/hooks/post-merge'), 0o755) }
  const RF = homeRollout(HOME)
  if (rollout !== null) { mkdirSync(dirname(RF), { recursive: true }); writeFileSync(RF, rollout) }
  before?.({ W, HOME, T })
  const rolloutBefore = existsSync(RF) ? readFileSync(RF) : null
  const runsBefore = listAll(join(W, 'drafts/magazine/_runs'))
  const env = { HOME, PATH: `${BIN}:${dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8', TZ: 'UTC' }
  const r = spawnSync(process.execPath, [join(W, entry), ...args], { cwd: W, env, encoding: 'utf8', timeout: 180000 })
  const calls = existsSync(join(HOME, 'calls.log')) ? readFileSync(join(HOME, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const runsDir = join(W, 'drafts/magazine/_runs')
  const runs = Object.fromEntries(listAll(runsDir).filter((p) => !statSync(join(runsDir, p)).isDirectory()).map((p) => [p, readFileSync(join(runsDir, p), 'utf8')]))
  const norm = (s) => String(s)
    .split(T).join('<T>')
    .replace(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} KST\]/g, '[TS]')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>')
    .replace(/\d{14}-\d+/g, '<RUNID>')
    .replace(/\b\d{9,}\b/g, '<N>')
    .replace(/-\d{3,7}-/g, '-<PID>-')
  return {
    status: r.status, signal: r.signal, stdout: norm(r.stdout), stderr: norm(r.stderr), out: `${r.stdout}${r.stderr}`,
    calls: norm(JSON.stringify(calls)), callCount: calls.length, stages: calls.map((c) => c.stage),
    runs: norm(JSON.stringify(runs)), runsBefore, runsAfter: listAll(runsDir),
    head: git(W, 'rev-parse', 'HEAD'), START,
    lockLeft: existsSync(join(W, 'drafts/magazine/_runs/.producer.lock')),
    rolloutSame: rolloutBefore === null ? !existsSync(RF) : existsSync(RF) && Buffer.compare(rolloutBefore, readFileSync(RF)) === 0,
    homeFiles: listAll(HOME).filter((p) => !p.startsWith('Library')),
  }
}
const VALID_LEGACY = JSON.stringify(doc())
const VALID_VNEXT = JSON.stringify(doc({ path: 'vnext' }))
const VALID_VNEXT_AUTO = JSON.stringify(doc({ path: 'vnext', release: 'auto', targetCandidates: 2 }))
const INVALID_TEXT = '{"schemaVersion":"magazine-rollout/1","path":"vnext"'

/** 기준판과 후보판이 같은가 — INVALID 는 후보 stderr 에 경고 정확히 1줄이 더 있어야 한다 */
function sameAsBaseline(base, cand, { invalid = false } = {}) {
  const warnLines = cand.stderr.split('\n').filter((l) => l.includes('MAGAZINE_ROLLOUT_INVALID'))
  const candStderr = cand.stderr.split('\n').filter((l) => !l.includes('MAGAZINE_ROLLOUT_INVALID')).join('\n')
  const diffs = []
  if (base.status !== cand.status) diffs.push(`status ${base.status}≠${cand.status}`)
  if (base.stdout !== cand.stdout) diffs.push('stdout')
  if (base.stderr !== candStderr) diffs.push('stderr')
  if (base.calls !== cand.calls) diffs.push(`calls ${base.calls.slice(0, 120)} ≠ ${cand.calls.slice(0, 120)}`)
  if (base.runs !== cand.runs) diffs.push('runs')
  if (base.lockLeft !== cand.lockLeft) diffs.push('lock')
  if (warnLines.length !== (invalid ? 1 : 0)) diffs.push(`경고 ${warnLines.length}줄`)
  if (!cand.rolloutSame) diffs.push('rollout 파일 변경')
  if (base.callCount === 0) diffs.push('기준판이 자식을 한 번도 부르지 않았다(대조 무의미)')
  return { ok: diffs.length === 0, detail: diffs.join(' · ') }
}
const noWork = (s) => s.callCount === 0 && JSON.stringify(s.runsAfter) === JSON.stringify(s.runsBefore) && !s.lockLeft && s.rolloutSame && !/Slack/.test(s.out) && !/인계/.test(s.out)

for (const [id, label, rollout, invalid] of [['P1', '파일 없음', null, false], ['P2', '정상 legacy', VALID_LEGACY, false], ['P3', '손상(INVALID)', INVALID_TEXT, true]]) {
  await test(id, `producer ${label} → 기준판과 종료 코드 · 자식 호출 · handoff · _runs · 로그 동일${invalid ? ' (+ 경고 1줄)' : ''}`, () => {
    const base = scenario({ entry: PRODUCER_REL, entryText: baseline(PRODUCER_REL), rollout })
    const cand = scenario({ entry: PRODUCER_REL, entryText: candidate(PRODUCER_REL), rollout })
    const r = sameAsBaseline(base, cand, { invalid })
    return { ok: r.ok && ['plan', 'repair', 'fetch', 'notify'].every((k) => cand.stages.includes(k)), detail: `${r.detail} · stages ${cand.stages.join(',')}` }
  })
}
await test('P4', 'producer vnext(draft) → VNEXT_NOT_IMPLEMENTED · non-zero · 자식·잠금·handoff·_runs·sync·Slack·rollout 변경 0', () => {
  const s = scenario({ entry: PRODUCER_REL, entryText: candidate(PRODUCER_REL), rollout: VALID_VNEXT, ff: true })
  return { ok: s.status !== 0 && /VNEXT_NOT_IMPLEMENTED/.test(s.out) && noWork(s) && s.head === s.START, detail: `status ${s.status} · calls ${s.stages.join(',')} · head ${s.head === s.START ? 'START' : 'MOVED'} · ${s.out.slice(-300)}` }
})
await test('P5', 'producer vnext(auto) --dry-run → 같은 fail-closed', () => {
  const s = scenario({ entry: PRODUCER_REL, entryText: candidate(PRODUCER_REL), rollout: VALID_VNEXT_AUTO, args: ['--dry-run'] })
  return { ok: s.status !== 0 && /VNEXT_NOT_IMPLEMENTED/.test(s.out) && noWork(s), detail: `status ${s.status} · ${s.out.slice(-200)}` }
})
await test('P6', 'producer --post-sync 직접 실행 + vnext → 잠금 확인 전에 fail-closed (우회 0)', () => {
  const s = scenario({ entry: PRODUCER_REL, entryText: candidate(PRODUCER_REL), rollout: VALID_VNEXT, args: ['--post-sync', '--expect-head', 'x'] })
  return { ok: s.status !== 0 && /VNEXT_NOT_IMPLEMENTED/.test(s.out) && !/LOCK_NOT_INHERITED/.test(s.out) && noWork(s), detail: s.out.slice(-300) }
})
await test('P7', 'producer 부모 legacy → sync 중 vnext 로 바뀜 → 재실행 자식이 fail-closed (자식 단계 0 · 잠금 잔여 0)', () => {
  // post-merge 훅: 부모의 ff 직후(자식 재실행 전) rollout 을 vnext 로 바꾼다
  const hook = `#!/bin/sh\nmkdir -p "$HOME/Library/Application Support/soransoran"\ncat > "$HOME/Library/Application Support/soransoran/magazine-rollout.json" <<'J'\n${VALID_VNEXT}\nJ\n`
  const s = scenario({ entry: PRODUCER_REL, entryText: candidate(PRODUCER_REL), rollout: VALID_LEGACY, ff: true, hook })
  return { ok: s.status !== 0 && /새 코드로 다시 띄운다/.test(s.out) && /VNEXT_NOT_IMPLEMENTED/.test(s.out) && s.callCount === 0 && !s.lockLeft,
    detail: `status ${s.status} · calls ${s.stages.join(',')} · ${s.out.slice(-400)}` }
})
await test('P8', 'producer 부모 INVALID + 재실행 자식 → 경고는 회차에 1줄', () => {
  const s = scenario({ entry: PRODUCER_REL, entryText: candidate(PRODUCER_REL), rollout: INVALID_TEXT, ff: true })
  const warns = (s.out.match(/MAGAZINE_ROLLOUT_INVALID/g) ?? []).length
  return { ok: warns === 1 && /새 코드로 다시 띄운다/.test(s.out) && s.stages.includes('plan'), detail: `warns ${warns} · stages ${s.stages.join(',')}` }
})

const freshHandoff = ({ W }) => {
  const d = join(W, 'drafts/magazine/_runs', kstDate()); mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'producer-handoff.json'), JSON.stringify({ date: kstDate(), verdict: 'OK', code: 0, ran: ['plan'], repair: null, fetch: null, finishedAt: new Date().toISOString() }))
}
for (const [id, label, rollout, args, invalid] of [
  ['A1', '파일 없음 · dry-run', null, [], false],
  ['A2', '정상 legacy · --write --pr --merge', VALID_LEGACY, ['--write', '--pr', '--merge'], false],
  ['A3', '손상(INVALID) · --write --pr --merge', INVALID_TEXT, ['--write', '--pr', '--merge'], true],
]) {
  await test(id, `auto-register ${label} → 기준판과 종료 코드 · 자식 호출 · _runs · 로그 동일${invalid ? ' (+ 경고 1줄)' : ''}`, () => {
    const base = scenario({ entry: REGISTER_REL, entryText: baseline(REGISTER_REL), rollout, args, before: freshHandoff })
    const cand = scenario({ entry: REGISTER_REL, entryText: candidate(REGISTER_REL), rollout, args, before: freshHandoff })
    const r = sameAsBaseline(base, cand, { invalid })
    const need = args.includes('--merge') ? ['ready', 'merge'] : ['ready']
    return { ok: r.ok && need.every((k) => cand.stages.includes(k)), detail: `${r.detail} · stages ${cand.stages.join(',')}` }
  })
}
for (const [id, args] of [['A4', ['--write', '--pr', '--merge']], ['A5', []]]) {
  await test(id, `auto-register vnext ${args.join(' ') || 'dry-run'} → VNEXT_NOT_IMPLEMENTED · non-zero · 인계 대기·ready·merge·_runs·Slack·rollout 변경 0`, () => {
    const s = scenario({ entry: REGISTER_REL, entryText: candidate(REGISTER_REL), rollout: VALID_VNEXT_AUTO, args, before: freshHandoff })
    return { ok: s.status !== 0 && /VNEXT_NOT_IMPLEMENTED/.test(s.out) && noWork(s) && !/회차 식별자/.test(s.out), detail: `status ${s.status} · calls ${s.stages.join(',')} · ${s.out.slice(-300)}` }
  })
}

await test('H0', '기준판 = guard 를 넣기 전 원본 (HEAD 에 guard 가 없을 때만 대조 · 있으면 모양만 확인)', () => {
  const bad = []
  for (const rel of [PRODUCER_REL, REGISTER_REL]) {
    const head = spawnSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf8' }).stdout
    if (!head.includes(IMPORT_LINE) && baseline(rel) !== head) bad.push(rel)
    if (baseline(rel).includes('ROLLOUT')) bad.push(`${rel}(guard 잔존)`)
  }
  return { ok: bad.length === 0, detail: bad.join(', ') }
})
await test('Z1', '운영 rollout 경로 접근 0 — 이 프로세스의 기본 경로가 임시 HOME 안이다', () => ({ ok: L.rolloutPath().startsWith(SAFE_HOME) && !L.rolloutPath().startsWith(join('/Users', 'yanadoo', 'Library')), detail: L.rolloutPath() }))

console.log(`\nmagazine rollout 검사: ${pass} pass, ${fail} fail (실행 ${ran})`)
if (ran === 0) { console.log('HARNESS 실행된 반례가 없다'); process.exit(2) }
process.exit(fail === 0 ? 0 : 1)
