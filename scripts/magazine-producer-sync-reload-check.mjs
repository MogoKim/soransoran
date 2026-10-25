#!/usr/bin/env node
/**
 * producer 회차 안의 코드 판(版) 경계 검사 + 변이 — sync 이전 래퍼 코드와 sync 이후 자식 코드가 섞이는가.
 *
 * 🔴 왜 생겼나 (2026-10-25 자연 회차 관측).
 *    `magazine-producer-run.mjs` 는 flow · 판정(exit) · handoff 를 **시작할 때** import 하고,
 *    그 뒤 `preflight` 가 origin/main 을 ff-only 로 따라붙는다. 그래서 sync 가 일어난 날에는
 *    자식(plan · brief · repair · fetch)은 새 HEAD 로, 래퍼의 판정 · 알림 · handoff 는 옛 HEAD 로 돈다.
 *    10/25 handoff 에 새 코드라면 반드시 있는 `fetch` 키가 없었다.
 *
 * 🔴 운영 모양으로 재현한다 — launchd 가 부르는 **같은 entrypoint 를 정확히 한 번** 실행한다.
 *    임시 폴더에 bare origin 과 작업 사본(git clone --shared)을 만든다.
 *      시작 HEAD  = 후보 코드 + 옛 판정(summarizeFetchStage → null · DIRECT 미해결을 PARTIAL 로 보지 않는다)
 *      새 HEAD    = 후보 코드 그대로(C — DIRECT 원고 미해결 PARTIAL · handoff.fetch)
 *    작업 사본은 시작 HEAD 에 두고 origin/main 만 새 HEAD 로 둔다 → entrypoint 의 preflight 가 ff 한다.
 *    자식 단계(plan · brief · repair · webui · notify)는 호출을 기록하는 대역이다 — AI · ChatGPT · Chrome · Slack 0.
 *    HOME · PATH(가짜 claude · gh) · origin 이 전부 임시다. 운영 runtime · 장부 · 큐 · launchd 접근 0.
 *
 * 사용법
 *   node scripts/magazine-producer-sync-reload-check.mjs              후보 = 이 작업 트리
 *   node scripts/magazine-producer-sync-reload-check.mjs --repro <ref> 후보 = <ref> 의 파일 (수정 전 재현 · 혼합이 보여야 한다)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const ENTRY_REL = 'scripts/magazine-producer-run.mjs'
const EXIT_REL = 'scripts/lib/magazine-producer-exit.mjs'
const reproRef = process.argv.includes('--repro') ? process.argv[process.argv.indexOf('--repro') + 1] : null

const TMPS = []
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.join(' ')} → ${r.status}: ${(r.stderr || r.stdout || '').slice(0, 300)}`)
  return r
}
const git = (cwd, ...args) => sh('git', args, { cwd }).stdout.trim()
const kstDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

/** 후보 코드의 파일 내용 — 이 작업 트리(기본) 또는 --repro ref */
const candidate = (rel, ref = reproRef) => (ref ? sh('git', ['show', `${ref}:${rel}`], { cwd: ROOT }).stdout : readFileSync(join(ROOT, rel), 'utf8'))
/** 후보가 이 작업 트리면 HEAD 와 다른 추적·신규 파일을 덮는다 (커밋 전에도 같은 코드로 시험한다) */
const overlayFiles = (ref) => {
  if (ref) return []
  const changed = sh('git', ['diff', '--name-only', 'HEAD'], { cwd: ROOT }).stdout.split('\n').filter(Boolean)
  const added = sh('git', ['ls-files', '--others', '--exclude-standard', 'scripts'], { cwd: ROOT }).stdout.split('\n').filter(Boolean)
  return [...new Set([...changed, ...added])].filter((f) => existsSync(join(ROOT, f)))
}

// ── 자식 단계 대역 — 호출과 그때의 코드 표식을 HOME/calls.log 에 남긴다 ──
const RECORD = `const __rec = (stage, extra = {}) => {
  const { appendFileSync, readFileSync, existsSync } = require('node:fs'); const { join } = require('node:path')
  const id = readFileSync(join(process.cwd(), 'scripts/.sync-code-id'), 'utf8').trim()
  const lock = join(process.cwd(), 'drafts/magazine/_runs/.producer.lock')
  appendFileSync(join(process.env.HOME, 'calls.log'), JSON.stringify({ stage, id, lock: existsSync(lock) ? JSON.parse(readFileSync(lock, 'utf8')).pid : null, ppid: process.ppid, ...extra }) + '\\n')
}`
const stub = (body) => `import { createRequire } from 'node:module'\nconst require = createRequire(import.meta.url)\n${RECORD}\n${body}\n`
const KST = 'const kst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)'
const STUBS = {
  'scripts/magazine-producer-plan.mjs': stub(`${KST}
const { mkdirSync, writeFileSync } = require('node:fs'); const { join } = require('node:path')
__rec('plan')
const dir = join(process.cwd(), 'drafts/magazine/_runs', kst()); mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'run.json'), JSON.stringify({ schemaVersion: 'producer-run/2', date: kst(), status: 'COMPLETED',
  selected: [{ day: 1, slug: 'sync-canary', directSpec: { specHash: 'sha256:sync' } }], reusable: [], held: [] }))
process.exit(0)`),
  'scripts/magazine-brief-auto.mjs': stub(`__rec('brief'); process.exit(0)`),
  'scripts/magazine-input-repair.mjs': stub(`const { writeFileSync, mkdirSync } = require('node:fs'); const { dirname } = require('node:path')
__rec('repair')
const rj = process.argv[process.argv.indexOf('--result-json') + 1]; mkdirSync(dirname(rj), { recursive: true })
writeFileSync(rj, JSON.stringify({ ok: true, results: [], skipped: [], recovered: [], resultFile: rj })); process.exit(0)`),
  'scripts/magazine-webui-runner.mjs': `import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
${RECORD}
${KST}
import { writeFetchResults, fetchResultPath } from './lib/magazine-fetch-result.mjs'
__rec('fetch', { argv: process.argv.slice(2) })
writeFetchResults(fetchResultPath(kst()), { date: kst(), mode: 'fetch-run', sentTotal: 0,
  results: [{ slug: 'sync-canary', status: 'failed', reason: 'brief_missing', sent: false }] })
process.exit(0)
`,
  'scripts/magazine-producer-notify.mjs': stub(`__rec('notify', { argv: process.argv.slice(2) }); process.exit(1)`),
}
const OLD_JUDGE = ['export function summarizeFetchStage({ fetch, report = null, startedAt = null, directSlugs = [], draftExists = () => false, resultFile = null }) {\n',
  'export function summarizeFetchStage({ fetch, report = null, startedAt = null, directSlugs = [], draftExists = () => false, resultFile = null }) {\n  return null // SYNC-CHECK 옛 판정 — DIRECT 미해결을 보지 않는다\n']

/**
 * 한 시나리오 — 임시 origin · 작업 사본 · HOME 을 만들고 entrypoint 를 한 번 돌린다.
 * @param {object} o
 * @param {(text:string, rel:string) => string} [o.mutate]  후보 파일 변이 (시작·새 HEAD 모두)
 * @param {boolean} [o.ff]        origin/main 을 새 HEAD 로 둔다 (false 면 시작 HEAD 그대로)
 * @param {(rel:string) => string|null} [o.newOnly]  새 HEAD 에만 넣는 파일 변경 (entrypoint 자체 변경 등)
 * @param {(ctx:object) => void} [o.before]  실행 직전 상태 조작 (lock 선점 · dirty tree · 브랜치 이동 · origin 고장)
 * @param {string[]} [o.args]
 */
function scenario({ mutate = (t) => t, ff = true, newOnly = null, before = null, args = [], hook = null, ref = reproRef } = {}) {
  const T = mkdtempSync(join(tmpdir(), 'psr-')); TMPS.push(T)
  const HOME = join(T, 'home'); mkdirSync(HOME, { recursive: true })
  const BIN = join(T, 'bin'); mkdirSync(BIN, { recursive: true })
  for (const [name, out] of [['claude', 'claude 0.0.0-sync-check'], ['gh', 'gh version 0.0.0-sync-check']]) {
    writeFileSync(join(BIN, name), `#!/bin/sh\necho "${out}"\n`); chmodSync(join(BIN, name), 0o755)
  }
  /**
   * 🔴 저장소 이력에 기대지 않는다 — CI 는 depth 1 이다. origin 은 후보 트리로 만든 **고아 커밋**에서 시작하고
   *    (blob 은 alternates 로 이 저장소 것을 빌린다), 작업 사본은 그 origin 을 clone 한다.
   */
  const ORIGIN = join(T, 'origin')
  sh('git', ['clone', '-q', '--shared', '--no-checkout', ROOT, ORIGIN])
  git(ORIGIN, 'checkout', '-q', '--orphan', 'psr-start', ref ?? 'HEAD')
  git(ORIGIN, 'config', 'user.email', 'sync-check@example.invalid'); git(ORIGIN, 'config', 'user.name', 'sync-check')
  const put = (rel, text) => { mkdirSync(dirname(join(ORIGIN, rel)), { recursive: true }); writeFileSync(join(ORIGIN, rel), text) }
  // 후보 코드 + 대역 + 옛 판정 → 시작 HEAD
  for (const rel of overlayFiles(ref)) put(rel, readFileSync(join(ROOT, rel), 'utf8'))
  for (const rel of [ENTRY_REL, EXIT_REL, 'scripts/lib/magazine-producer-flow.mjs', 'scripts/lib/magazine-handoff.mjs']) put(rel, mutate(candidate(rel, ref), rel))
  for (const [rel, text] of Object.entries(STUBS)) put(rel, text)
  const exitNew = readFileSync(join(ORIGIN, EXIT_REL), 'utf8')
  if (exitNew.split(OLD_JUDGE[0]).length !== 2) throw new Error('옛 판정 지점이 정확히 1곳이 아니다 (하네스 결함)')
  put(EXIT_REL, exitNew.replace(OLD_JUDGE[0], OLD_JUDGE[1]))
  put('scripts/.sync-code-id', 'START\n')
  git(ORIGIN, 'add', '-A'); git(ORIGIN, 'commit', '-q', '--no-verify', '-m', 'sync-check: 시작 HEAD (옛 판정)')
  git(ORIGIN, 'branch', '-q', '-M', 'psr-start', 'main')
  const START = git(ORIGIN, 'rev-parse', 'HEAD')
  // 새 HEAD — 옛 판정을 걷어 낸 C · 코드 표식만 다르다
  put(EXIT_REL, exitNew); put('scripts/.sync-code-id', 'NEW\n')
  if (newOnly) { const t = newOnly(ENTRY_REL, readFileSync(join(ORIGIN, ENTRY_REL), 'utf8')); if (t !== null) put(ENTRY_REL, t) }
  git(ORIGIN, 'add', '-A'); git(ORIGIN, 'commit', '-q', '--no-verify', '-m', 'sync-check: 새 HEAD (C 판정)')
  const NEW = git(ORIGIN, 'rev-parse', 'HEAD')
  if (!ff) git(ORIGIN, 'reset', '-q', '--hard', START)
  // 🔴 origin 의 main 을 체크아웃하지 않은 채로 둔다 — 다른 회차(R7 훅)가 main 을 밀 수 있게
  git(ORIGIN, 'checkout', '-q', '--detach')
  const W = join(T, 'work')
  sh('git', ['clone', '-q', '--shared', '-b', 'main', ORIGIN, W])
  git(W, 'reset', '-q', '--hard', START)
  git(W, 'config', 'user.email', 'sync-check@example.invalid'); git(W, 'config', 'user.name', 'sync-check')
  if (existsSync(join(ROOT, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(W, 'node_modules'))
  const putW = (rel, text) => { mkdirSync(dirname(join(W, rel)), { recursive: true }); writeFileSync(join(W, rel), text) }
  if (hook) { putW('.git/hooks/post-merge', hook({ ORIGIN, W, T })); chmodSync(join(W, '.git/hooks/post-merge'), 0o755) }
  const ctx = { T, W, HOME, ORIGIN, START, NEW }
  before?.(ctx)
  const env = { HOME, PATH: `${BIN}:${dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8', TZ: 'UTC' }
  const r = spawnSync(process.execPath, [join(W, ENTRY_REL), ...args], { cwd: W, env, encoding: 'utf8', timeout: 120000 })
  const calls = existsSync(join(HOME, 'calls.log')) ? readFileSync(join(HOME, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  const hp = join(W, 'drafts/magazine/_runs', kstDate(), 'producer-handoff.json')
  const handoffRaw = existsSync(hp) ? readFileSync(hp, 'utf8') : null
  return {
    ...ctx, status: r.status, signal: r.signal, out: `${r.stdout}${r.stderr}`, calls,
    handoff: handoffRaw ? JSON.parse(handoffRaw) : null, handoffRaw,
    head: git(W, 'rev-parse', 'HEAD'),
    lockLeft: existsSync(join(W, 'drafts/magazine/_runs/.producer.lock')),
    count: (stage) => calls.filter((c) => c.stage === stage).length,
    reexecs: (`${r.stdout}${r.stderr}`.match(/새 코드로 다시 띄운다/g) ?? []).length,
  }
}

let pass = 0
let fail = 0
const report = (ok, name, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }
const brief = (s) => JSON.stringify({ status: s.status, verdict: s.handoff?.verdict, code: s.handoff?.code, fetch: s.handoff ? ('fetch' in s.handoff ? (s.handoff.fetch ? 'object' : 'null') : 'absent') : 'no-handoff',
  head: s.head === s.NEW ? 'NEW' : s.head === s.START ? 'START' : s.head.slice(0, 7), plan: s.count('plan'), fetchRuns: s.count('fetch'), reexec: s.reexecs })

// ── 수정 전 재현 모드 — 혼합이 **보여야** 한다 ──
if (reproRef) {
  const s = scenario()
  console.log(`재현 (${reproRef}) — ${brief(s)}`)
  const mixed = s.head === s.NEW && s.calls.every((c) => c.id === 'NEW') && s.handoff && s.handoff.verdict === 'OK' && s.status === 0 && !(s.handoff.fetch)
  report(mixed, '수정 전 재현 — ff 로 HEAD·자식은 새 코드인데 래퍼 판정·handoff 는 옛 코드 (OK/0 · fetch 없음)')
  console.log(`\nproducer sync-reload 재현: ${pass} pass, ${fail} fail`)
  process.exit(fail === 0 ? 0 : 1)
}

// ── 반례 ────────────────────────────────────────────────
const CASES = {
  'R1 같은 회차에 ff — 새 HEAD 판정 적용 · DIRECT 원고 0 → PARTIAL/3 · handoff.fetch · 재실행 1': (mut) => {
    const s = scenario({ mutate: mut })
    const f = s.handoff?.fetch
    return { s, ok: s.head === s.NEW && s.status === 3 && s.handoff?.verdict === 'PARTIAL' && s.handoff?.code === 3
      && f?.failures?.some((x) => x.slug === 'sync-canary' && x.outcome === 'DIRECT_MANUSCRIPT_MISSING') && f?.direct?.expected === 1
      && s.reexecs === 1 && ['plan', 'repair', 'fetch', 'notify'].every((k) => s.count(k) === 1) && s.count('brief') === 0
      && s.calls.every((c) => c.id === 'NEW') && !s.lockLeft }
  },
  'R2 회수 단계 동안 producer lock 은 부모 회차 것 하나 · 끝나면 풀린다 (이중 획득 0)': (mut) => {
    const s = scenario({ mutate: mut })
    const f = s.calls.find((c) => c.stage === 'fetch')
    return { s, ok: Boolean(f) && Number.isInteger(f.lock) && f.lock !== f.ppid && !s.lockLeft && !/LOCK_HELD|LOCK_NOT_INHERITED/.test(s.out) }
  },
  'R3 ff 없음 — 재실행 0 · 시작 HEAD 판정 그대로 (OK/0)': (mut) => {
    const s = scenario({ mutate: mut, ff: false })
    return { s, ok: s.head === s.START && s.reexecs === 0 && s.status === 0 && s.handoff?.verdict === 'OK'
      && ['plan', 'repair', 'fetch', 'notify'].every((k) => s.count(k) === 1) && s.calls.every((c) => c.id === 'START') && !s.lockLeft }
  },
  'R4 sync 가 entrypoint 자체를 바꿔도 새 entrypoint 가 정확히 한 번 돈다': (mut) => {
    const marker = "line('SYNC-CHECK 새 entrypoint')\n"
    const s = scenario({ mutate: mut, newOnly: (rel, t) => (t.includes("line(`매거진 producer 시작") ? t.replace("line(`매거진 producer 시작", `${marker}line(\`매거진 producer 시작`) : null) })
    return { s, ok: (s.out.match(/SYNC-CHECK 새 entrypoint/g) ?? []).length === 1 && s.status === 3 && s.reexecs === 1 }
  },
  'R5 동시 실행 — 살아 있는 회차가 lock 을 쥐면 두 번째는 lock 에서 멈춘다 (fetch·ff·plan 0)': (mut) => {
    let holder = null
    const s = scenario({ mutate: mut, before: ({ W }) => {
      holder = spawnSync('sh', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' }).stdout.trim()
      const dir = join(W, 'drafts/magazine/_runs'); mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, '.producer.lock'), JSON.stringify({ pid: Number(holder), startedAt: Date.now(), label: 'producer', token: 'other' }))
    } })
    try { process.kill(Number(holder)) } catch { /* 이미 끝났다 */ }
    return { s, ok: /LOCK_HELD/.test(s.out) && s.head === s.START && s.calls.length === 0 && s.status === 1 && s.reexecs === 0 }
  },
  'R6a sync 실패 — dirty tree → plan·brief·repair·fetch·notify 대역 0 · ff 0': (mut) => {
    const s = scenario({ mutate: mut, before: ({ W }) => writeFileSync(join(W, 'scripts/.sync-code-id'), 'DIRTY\n') })
    return { s, ok: /DIRTY_TREE/.test(s.out) && s.calls.length === 0 && s.head === s.START && s.status === 1 && s.reexecs === 0 }
  },
  'R6b sync 실패 — NOT_ON_MAIN → 자식 0 · ff 0': (mut) => {
    const s = scenario({ mutate: mut, before: ({ W }) => git(W, 'checkout', '-q', '-b', 'side') })
    return { s, ok: /NOT_ON_MAIN/.test(s.out) && s.calls.length === 0 && s.status === 1 && s.reexecs === 0 }
  },
  'R6c sync 실패 — fetch 실패 → 자식 0 · ff 0': (mut) => {
    const s = scenario({ mutate: mut, before: ({ W, T }) => git(W, 'remote', 'set-url', 'origin', join(T, 'missing.git')) })
    return { s, ok: /FETCH_FAILED/.test(s.out) && s.calls.length === 0 && s.head === s.START && s.status === 1 && s.reexecs === 0 }
  },
  'R6d sync 실패 — 갈라짐(ff-only 불가) → 자식 0': (mut) => {
    const s = scenario({ mutate: mut, before: ({ W }) => { writeFileSync(join(W, 'scripts/.local-only'), 'x\n'); git(W, 'add', 'scripts/.local-only'); git(W, 'commit', '-q', '-m', 'local') } })
    return { s, ok: /NOT_IN_SYNC/.test(s.out) && s.calls.length === 0 && s.status === 1 && s.reexecs === 0 }
  },
  'R7 부모 ff 직후 main 이 또 움직여도 자식은 다시 sync 하지 않는다 — 재실행 1 · HEAD 고정': (mut) => {
    const s = scenario({ mutate: mut, hook: ({ ORIGIN, T }) => `#!/bin/sh
d="${T}/again"; [ -e "$d" ] && exit 0
git clone -q --shared -b main "${ORIGIN}" "$d" && cd "$d" && git config user.email a@b.invalid && git config user.name x && echo AGAIN > scripts/.sync-code-id && git commit -qam again && git push -q origin HEAD:main
` })
    return { s, ok: s.reexecs === 1 && s.head === s.NEW && s.calls.every((c) => c.id === 'NEW') && s.status === 3 }
  },
  'R8 --post-sync 를 lock 없이 직접 부르면 멈춘다 — 자식 0 · handoff 덮어쓰기 0': (mut) => {
    const s = scenario({ mutate: mut, ff: false, args: ['--post-sync', '--expect-head', 'deadbeef'] })
    return { s, ok: s.calls.length === 0 && s.status === 1 && s.handoff === null && /LOCK_NOT_INHERITED/.test(s.out) }
  },
  'R9 dry-run — 잠금·sync·재실행·자식 0 (기존 계약)': (mut) => {
    const s = scenario({ mutate: mut, args: ['--dry-run'] })
    return { s, ok: s.head === s.START && s.reexecs === 0 && ['plan', 'brief', 'repair', 'fetch'].every((k) => s.count(k) === 0) && s.handoff === null && s.status === 0 }
  },
}

console.log('\nproducer sync-reload — 같은 회차는 동기화된 하나의 HEAD 코드로 판정한다\n')
const baseline = {}
for (const [name, run] of Object.entries(CASES)) {
  let r
  try { r = run((t) => t) } catch (e) { report(false, name, `하네스 오류: ${e.message.split('\n')[0]}`); continue }
  baseline[name] = r.s
  report(r.ok, name, r.ok ? '' : brief(r.s) + ` · ${r.s.out.split('\n').filter((l) => /판정|LOCK|NOT_|DIRTY|FETCH|코드/.test(l)).slice(-4).join(' | ').slice(0, 300)}`)
}

// ff 없는 회차는 수정 전 코드(merge-base 판)와 handoff 바이트 · 종료 코드 · 자식 호출 · 로그가 같다
{
  // 🔴 수정 전 판 — 로컬은 merge-base 의 실제 파일. CI(depth 1)는 merge-base 가 없으므로 후보에서 경계 코드만 뺀 판
  const mb = sh('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, allowFail: true })
  const base = mb.status === 0 ? mb.stdout.trim() : null
  const stripBoundary = (t, rel) => (rel === ENTRY_REL ? t.replace('    afterSync: dryRun || POST_SYNC ? undefined : afterSync,\n', '')
    : rel === 'scripts/lib/magazine-producer-flow.mjs' ? t.replace('      if (delegated?.delegated) return { ...delegated, ran }\n', '') : t)
  const norm = (s) => ({
    status: s.status,
    // 🔴 회차마다 다른 값(임시 폴더 · 수리 결과 파일의 pid·시각 · 끝난 시각)만 지운다
    handoff: (s.handoffRaw ?? '').replaceAll(s.T, '<T>').replace(/"finishedAt": "[^"]+"/, '"finishedAt": "<t>"').replace(/producer-input-repair-\d+-\d+\.json/g, 'producer-input-repair-<pid>-<t>.json'),
    calls: s.calls.map((c) => `${c.stage}:${c.id}:${c.lock === null ? 'nolock' : 'lock'}`).join(','),
    out: s.out.replaceAll(s.T, '<T>').replace(/\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d KST\]/g, '[t]').replace(/\d+분째|pid \d+/g, '<n>'),
  })
  try {
    const a = norm(base ? scenario({ ff: false, ref: base }) : scenario({ ff: false, mutate: stripBoundary }))
    const b = norm(scenario({ ff: false }))
    const diff = Object.keys(a).filter((k) => a[k] !== b[k])
    report(diff.length === 0, `R3b ff 없음 — 수정 전(${base ? base.slice(0, 7) : '경계 코드 제외 판'})과 handoff 바이트 · 종료 코드 · 자식 호출 · 로그 동일`, diff.map((k) => `${k}: ${JSON.stringify(a[k]).slice(0, 400)} ≠ ${JSON.stringify(b[k]).slice(0, 400)}`).join(' / '))
  } catch (e) { report(false, 'R3b ff 없음 — 수정 전과 동일', `하네스 오류: ${e.message.split('\n')[0]}`) }
}

// ── 변이 — 후보 파일(시작·새 HEAD 양쪽)에만 적용한다. 저장소 파일 불변 ──
const MUTATIONS = [
  ['MS1', '재실행 경계 제거 — sync 뒤에도 같은 프로세스에서 계속 (옛 혼합 동작)', ENTRY_REL, "    afterSync: dryRun || POST_SYNC ? undefined : afterSync,\n", "    afterSync: undefined,\n"],
  ['MS2', 'flow 가 afterSync 위임을 무시한다', 'scripts/lib/magazine-producer-flow.mjs', '      if (delegated?.delegated) return { ...delegated, ran }\n', ''],
  ['MS3', '자식이 lock 을 새로 잡는다 (이중 획득)', ENTRY_REL, '    checkLock: () => (POST_SYNC ? adoptLock() : acquireProducerLock()),\n', '    checkLock: () => acquireProducerLock(),\n'],
  ['MS4', '자식이 다시 fetch·ff 하고 재실행한다 (재귀)', ENTRY_REL, '    checkGit: () => (POST_SYNC ? pinnedHead() : preflight({ exec })),\n', '    checkGit: () => preflight({ exec }),\n'],
  ['MS6', '부모가 자식 handoff 를 덮어쓴다 (이중 기록)', ENTRY_REL, '  if (!childWroteHandoff(result.startedAt)) {\n', '  if (true) {\n'],
  ['MS7', '부모가 자식이 끝나기 전에 lock 을 푼다', ENTRY_REL, '  const r = spawnSync(NODE, [entry, \'--post-sync\', \'--expect-head\', head], {\n', '  producerLock.release()\n  const r = spawnSync(NODE, [entry, \'--post-sync\', \'--expect-head\', head], {\n'],
  ['MS8', '적재한 코드의 HEAD 기준을 잃는다 — ff 없어도 재실행 · 자식 HEAD 확인 불능', ENTRY_REL, "const BOOT_HEAD = exec('git', ['rev-parse', 'HEAD']).out\n", "let BOOT_HEAD = null\n"],
]
console.log('\n── 변이 — 각 변이를 위 반례 중 하나가 잡아야 한다')
for (const [id, label, rel, from, to] of MUTATIONS) {
  const src = candidate(rel)
  const n = src.split(from).length - 1
  if (n !== 1) { report(false, `${id} ${label}`, `변이 지점이 ${n}곳이다 — 정확히 1곳이어야 한다 (하네스 결함)`); continue }
  const mut = (t, r) => (r === rel ? t.replace(from, to) : t)
  const caught = []
  for (const [name, run] of Object.entries(CASES)) {
    try { if (!run(mut).ok) caught.push(name.split(' ')[0]) } catch (e) { caught.push(`${name.split(' ')[0]}!`) }
    if (caught.length) break
  }
  report(caught.length > 0, `${id} ${label} → 잡혔다`, caught.join(',') || '모든 반례가 통과했다')
}

console.log(`\nproducer sync-reload: ${pass} pass, ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
