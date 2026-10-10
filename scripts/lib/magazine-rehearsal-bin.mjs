#!/usr/bin/env node
/**
 * 🔴 **rehearsal 의 바깥 세계 — 결정론 fixture** (2026-10-10).
 *
 *    임시 루트의 `bin/{claude,gh,git,curl,vercel}` 가 이 파일을 부른다:
 *      node magazine-rehearsal-bin.mjs <이름> ...인자
 *
 *    claude  brief-auto 의 `claude -p` — 저장소 합격 brief 뼈대 + 큐 행 (시나리오가 형식 위반을 고를 수 있다)
 *    gh      PR·CI·merge·배포 상태를 `fixture/github.json` 에 둔다. merge 는 임시 bare origin 에 실제 squash 커밋을 만든다
 *    git     실제 git 을 부르되 임시 루트 안 · 원격은 임시 bare origin 하나만 (GitHub push 0)
 *    curl    soransoran.com 응답 — 살아 있는 가짜 배포의 articles.ts 로 공개 여부를 판정한다 (네트워크 0)
 *    vercel  쓰지 않는다 — 부르면 기록하고 거부한다
 *
 * 🔴 모든 호출을 `fixture/calls.jsonl` 에 남긴다. 이 파일도 rehearsal guard 아래에서 돈다.
 */
import { appendFileSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ENV = process.env
const ROOT = realpathSync(ENV.SORAN_REHEARSAL_ROOT)
const REPO = join(ROOT, 'repo')
const ORIGIN = join(ROOT, 'origin.git')
const FIX = join(ROOT, 'fixture')
const REAL_GIT = ENV.SORAN_REHEARSAL_REAL_GIT
const SITE = 'https://soransoran.com'
const REQUIRED_CHECK = 'Micro Seed 3축 게이트'

const [, , tool, ...args] = process.argv
ENV.SORAN_REHEARSAL_ROLE = `${tool}-shim`

const nowIso = () => new Date().toISOString()
const scenario = () => JSON.parse(readFileSync(join(FIX, 'scenario.json'), 'utf8'))
function log(entry) { appendFileSync(join(FIX, 'calls.jsonl'), `${JSON.stringify({ tool, at: nowIso(), ...entry })}\n`) }
function writeJson(file, value) { const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); renameSync(tmp, file) }
function out(text, code = 0) { if (text) process.stdout.write(text.endsWith('\n') ? text : `${text}\n`); process.exit(code) }
function fail(text, code = 1) { process.stderr.write(`${text}\n`); process.exit(code) }

function git(argv, { cwd = REPO, gitDir = null, input } = {}) {
  const full = gitDir ? ['--git-dir', gitDir, ...argv] : argv
  const r = spawnSync(REAL_GIT, full, { cwd, encoding: 'utf8', input, env: gitEnv() })
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}
function gitEnv() {
  return { ...ENV, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(ROOT, 'home', '.gitconfig'), GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'rehearsal', GIT_AUTHOR_EMAIL: 'rehearsal@invalid', GIT_COMMITTER_NAME: 'rehearsal', GIT_COMMITTER_EMAIL: 'rehearsal@invalid' }
}
const inside = (p) => { try { const r = realpathSync(p); return r === ROOT || r.startsWith(ROOT + sep) } catch { return false } }

// ─────────────────────────────────────────────────────────
// git — 실제 git · 임시 루트 안 · 원격은 임시 origin 하나
// ─────────────────────────────────────────────────────────
function runGit() {
  const cwdArgs = []
  for (let i = 0; i < args.length; i++) if (args[i] === '-C') cwdArgs.push(args[i + 1])
  for (const d of [process.cwd(), ...cwdArgs.map((d) => resolve(d))]) {
    if (!inside(d)) { log({ args, refused: 'OUTSIDE_ROOT', cwd: d }); fail(`rehearsal git: 임시 루트 밖 작업 거부 (${d})`, 128) }
  }
  const sub = args.find((a) => !a.startsWith('-') && !cwdArgs.includes(a))
  if (['clone', 'submodule'].includes(sub)) { log({ args, refused: 'SUBCOMMAND' }); fail(`rehearsal git: ${sub} 거부`, 128) }
  if (sub === 'remote' && args.some((a) => ['add', 'set-url', 'rename', 'remove'].includes(a))) { log({ args, refused: 'REMOTE_EDIT' }); fail('rehearsal git: 원격 변경 거부', 128) }
  if (['push', 'fetch', 'pull', 'ls-remote'].includes(sub)) {
    const rest = args.slice(args.indexOf(sub) + 1).filter((a) => !a.startsWith('-'))
    const remote = rest[0] ?? 'origin'
    const url = git(['remote', 'get-url', remote], { cwd: process.cwd() }).out
    if (remote !== 'origin' || !url || resolve(process.cwd(), url) !== ORIGIN) {
      log({ args, refused: 'REMOTE_NOT_REHEARSAL_ORIGIN', remote, url })
      fail(`rehearsal git: 원격 ${remote} (${url}) 은 rehearsal origin 이 아니다 — 거부`, 128)
    }
  }
  log({ args, cwd: process.cwd() })
  const r = spawnSync(REAL_GIT, args, { stdio: 'inherit', env: gitEnv() })
  process.exit(r.status ?? 1)
}

// ─────────────────────────────────────────────────────────
// gh — PR·CI·merge·배포
// ─────────────────────────────────────────────────────────
const GH_FILE = join(FIX, 'github.json')
const ghState = () => JSON.parse(readFileSync(GH_FILE, 'utf8'))
const saveGh = (s) => writeJson(GH_FILE, s)
const deployIdOf = (sha) => `R${sha.slice(0, 23)}`
const originSha = (ref) => git(['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], { gitDir: ORIGIN }).out || null

function prView(pr) {
  const head = pr.state === 'OPEN' ? originSha(pr.headRefName) ?? pr.headRefOid : pr.headRefOid
  let mergeable = 'UNKNOWN'
  if (pr.state === 'OPEN') {
    const t = git(['merge-tree', '--write-tree', 'refs/heads/main', head], { gitDir: ORIGIN })
    mergeable = t.code === 0 ? 'MERGEABLE' : 'CONFLICTING'
  }
  const files = pr.state === 'OPEN'
    ? git(['diff', '--name-only', `refs/heads/main...${head}`], { gitDir: ORIGIN }).out.split('\n').filter(Boolean)
    : pr.files ?? []
  return { number: pr.number, url: `https://github.com/MogoKim/soransoran/pull/${pr.number}`, title: pr.title, body: pr.body,
    headRefName: pr.headRefName, headRefOid: head, baseRefName: 'main', state: pr.state, isDraft: false, mergeable,
    mergeCommit: pr.mergeCommit ?? null, files: files.map((path) => ({ path, additions: 1, deletions: 0 })) }
}
const pick = (o, fields) => (fields ? Object.fromEntries(fields.split(',').map((f) => [f, o[f]])) : o)
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null }

/** 이 SHA 의 검사 — 시나리오의 ci 정책 (`pendingUntil` 전이면 도는 중) */
function checksFor(sha) {
  const s = ghState()
  const pr = s.prs.find((p) => p.headRefOid === sha || originSha(p.headRefName) === sha)
  if (!pr) return { known: false, checks: [], state: 'pending' }
  const ci = scenario().ci ?? {}
  const pending = ci.pendingUntil && Date.now() < Date.parse(ci.pendingUntil)
  const conclusion = ci.conclusion ?? 'success'
  const checks = [
    { name: REQUIRED_CHECK, status: pending ? 'in_progress' : 'completed', conclusion: pending ? null : conclusion },
    { name: 'Vercel Preview Comments', status: 'completed', conclusion: 'success' },
  ]
  const state = pending ? 'pending' : conclusion === 'success' ? 'success' : 'failure'
  return { known: true, checks, state }
}

const JQ = {
  '.mergeCommit.oid': (v) => v?.mergeCommit?.oid ?? '',
  '.[0].state': (v) => v?.[0]?.state ?? '',
  '.sha': (v) => v?.sha ?? '',
  '.state': (v) => v?.state ?? '',
  '.statuses[] | select(.context == "Vercel") | .target_url': (v) => (v?.statuses ?? []).filter((x) => x.context === 'Vercel').map((x) => x.target_url).join('\n'),
  '[.check_runs[] | {name, status, conclusion}]': (v) => JSON.stringify((v?.check_runs ?? []).map(({ name, status, conclusion }) => ({ name, status, conclusion }))),
}
function emit(value) {
  const jq = opt('--jq')
  if (jq === null) return out(JSON.stringify(value))
  const f = JQ[jq]
  if (!f) { log({ args, refused: 'JQ_UNSUPPORTED' }); fail(`rehearsal gh: 모르는 --jq (${jq})`) }
  return out(String(f(value)))
}

function runGh() {
  const [a, b] = args
  if (a === '--version') { log({ args }); return out('gh version 0.0.0-rehearsal (fixture)') }
  if (a === 'auth' && b === 'status') { log({ args }); return out('github.com\n  ✓ Logged in (rehearsal fixture)') }
  if (a === 'pr' && b === 'list') {
    const s = ghState()
    const state = (opt('--state') ?? 'open').toUpperCase()
    const head = opt('--head')
    const rows = s.prs.filter((p) => (state === 'ALL' || p.state === state) && (!head || p.headRefName === head)).map(prView)
    log({ args, count: rows.length })
    return emit(rows.map((r) => pick(r, opt('--json'))))
  }
  if (a === 'pr' && b === 'view') {
    const pr = ghState().prs.find((p) => p.number === Number(args[2]))
    if (!pr) { log({ args, error: 'NO_PR' }); fail('no pull requests found') }
    log({ args })
    return emit(pick(prView(pr), opt('--json')))
  }
  if (a === 'pr' && b === 'create') {
    const head = opt('--head')
    const sha = head ? originSha(head) : null
    if (!sha) { log({ args, error: 'HEAD_NOT_PUSHED' }); fail(`rehearsal gh: ${head} 가 origin 에 없다`) }
    const s = ghState()
    const number = s.nextPr++
    s.prs.push({ number, title: opt('--title'), body: opt('--body'), headRefName: head, headRefOid: sha, state: 'OPEN', createdAt: nowIso() })
    saveGh(s)
    log({ args: ['pr', 'create', '--head', head], number, sha })
    return out(`https://github.com/MogoKim/soransoran/pull/${number}`)
  }
  if (a === 'pr' && b === 'merge') return mergePr(Number(args[2]))
  if (a === 'api') return api(b)
  log({ args, refused: 'UNSUPPORTED' })
  return fail(`rehearsal gh: 지원하지 않는 명령 (${args.join(' ')})`)
}

function mergePr(number) {
  const s = ghState()
  const pr = s.prs.find((p) => p.number === number)
  if (!pr || pr.state !== 'OPEN') { log({ args, error: 'NOT_OPEN' }); return fail('Pull request is not open') }
  const head = originSha(pr.headRefName)
  const match = opt('--match-head-commit')
  if (match && match !== head) { log({ args, error: 'HEAD_MISMATCH', head }); return fail('Head branch was modified') }
  const ci = checksFor(head)
  // 🔴 실제 저장소와 같게 — 필수 검사가 끝나지 않았으면 GitHub 이 merge 를 거부한다
  if (ci.state !== 'success') { log({ args, error: 'CHECKS_NOT_GREEN', state: ci.state }); return fail('Required status check "Micro Seed 3축 게이트" is expected') }
  const main = originSha('main')
  const tree = git(['merge-tree', '--write-tree', main, head], { gitDir: ORIGIN })
  if (tree.code !== 0) { log({ args, error: 'CONFLICT' }); return fail('Pull request is not mergeable') }
  const commit = git(['commit-tree', tree.out.split('\n')[0], '-p', main, '-m', `${pr.title} (#${number})`], { gitDir: ORIGIN })
  if (commit.code !== 0) return fail(commit.err)
  const upd = git(['update-ref', 'refs/heads/main', commit.out, main], { gitDir: ORIGIN })
  if (upd.code !== 0) return fail(upd.err)
  pr.files = git(['diff', '--name-only', `${main}...${head}`], { gitDir: ORIGIN }).out.split('\n').filter(Boolean)
  Object.assign(pr, { state: 'MERGED', headRefOid: head, mergeCommit: { oid: commit.out }, mergedAt: nowIso() })
  const dep = scenario().deploy ?? {}
  s.deployments.push({ id: s.nextDeployment++, sha: commit.out, environment: 'Production', state: dep.state ?? 'success', createdAt: nowIso() })
  saveGh(s)
  log({ args, merged: commit.out })
  return out(`✓ Squashed and merged pull request #${number}`)
}

function api(path) {
  const p = String(path ?? '').replace(/^repos\/\{owner\}\/\{repo\}\//, '')
  let m
  if ((m = /^contents\/(.+)\?ref=([0-9a-f]{7,40})$/.exec(p))) {
    const r = git(['rev-parse', `${m[2]}:${m[1]}`], { gitDir: ORIGIN })
    log({ args, found: r.code === 0 })
    return r.code === 0 ? emit({ sha: r.out }) : fail('Not Found (HTTP 404)')
  }
  if ((m = /^commits\/([0-9a-f]{7,40})\/check-runs$/.exec(p))) {
    const c = checksFor(m[1])
    log({ args, state: c.state })
    return emit({ total_count: c.checks.length, check_runs: c.checks })
  }
  if ((m = /^commits\/([0-9a-f]{7,40})\/status$/.exec(p))) {
    const s = ghState()
    const dep = s.deployments.find((d) => d.sha === m[1])
    const c = checksFor(m[1])
    const statuses = dep ? [{ context: 'Vercel', state: 'success', target_url: `https://vercel.com/soransoran/soransoran/${deployIdOf(dep.sha)}` }] : []
    log({ args, state: dep ? 'success' : c.state })
    return emit({ state: dep ? 'success' : c.state, statuses })
  }
  if ((m = /^deployments\?sha=([0-9a-f]{7,40})&environment=Production/.exec(p))) {
    const rows = ghState().deployments.filter((d) => d.sha === m[1]).reverse().map(({ id, sha, environment }) => ({ id, sha, environment }))
    log({ args, count: rows.length })
    return emit(rows.slice(0, 1))
  }
  if ((m = /^deployments\/(\d+)\/statuses/.exec(p))) {
    const d = ghState().deployments.find((x) => x.id === Number(m[1]))
    log({ args, state: d?.state ?? null })
    return emit(d ? [{ state: d.state }] : [])
  }
  log({ args, refused: 'API_UNSUPPORTED' })
  return fail(`rehearsal gh: 지원하지 않는 api (${p})`)
}

// ─────────────────────────────────────────────────────────
// curl — soransoran.com (살아 있는 가짜 배포 기준)
// ─────────────────────────────────────────────────────────
async function runCurl() {
  const url = args.find((a) => /^https?:\/\//.test(a))
  const o = opt('-o')
  const w = opt('-w')
  if (o && o !== '/dev/null' && !inside(resolve(o))) { log({ args, refused: 'OUTPUT_OUTSIDE' }); fail('rehearsal curl: -o 거부', 23) }
  if (!url || !url.startsWith(SITE)) { log({ args, refused: 'HOST' }); fail(`rehearsal curl: ${url} 은 fixture 밖이다 (네트워크 0)`, 6) }
  const s = ghState()
  const live = [...s.deployments].reverse().find((d) => d.state === 'success') ?? null
  const liveSha = live?.sha ?? git(['rev-parse', 'refs/heads/main'], { gitDir: ORIGIN }).out
  const path = url.slice(SITE.length).replace(/\?.*$/, '') || '/'
  let status = 404
  let body = '<!doctype html><title>404</title>'
  // 🔴 공개 여부는 살아 있는 배포의 articles.ts 와 실제 공개 관문(앱 정본과 동기화 검사되는 magazine-gate)으로만 정한다
  const publicArticles = async () => {
    const src = git(['show', `${liveSha}:src/content/magazine/articles.ts`], { gitDir: ORIGIN }).out
    const L = await import(pathToFileURL(join(REPO, 'scripts/lib/magazine-load.mjs')).href)
    const G = await import(pathToFileURL(join(REPO, 'scripts/lib/magazine-gate.mjs')).href)
    return L.parseArticlesSource(src).filter((a) => G.isPublic(a, Date.now()))
  }
  const dpl = `dpl_${live ? deployIdOf(live.sha) : 'BASELINE00000000000000000'}`
  if (path === '/' || path === '/magazine') {
    status = 200
    const list = path === '/magazine' ? (await publicArticles()).map((a) => `<a href="/magazine/${a.slug}">${a.title}</a>`).join('') : ''
    body = `<!doctype html><title>소란소란</title><img src="/_next/image?url=%2Flogo.webp&amp;w=64&amp;q=75&amp;dpl=${dpl}">${list}`
  } else if (path === '/sitemap.xml') {
    status = 200
    body = `<?xml version="1.0"?><urlset>${(await publicArticles()).map((a) => `<url><loc>${SITE}/magazine/${a.slug}</loc></url>`).join('')}</urlset>`
  } else if (path.startsWith('/magazine/') && !/\.\w+$/.test(path)) {
    const slug = path.slice('/magazine/'.length)
    const a = (await publicArticles()).find((x) => x.slug === slug)
    if (a) { status = 200; body = `<!doctype html><title>${a.title}</title><h1>${a.title}</h1>` }
  } else if (/\.\w+$/.test(path)) {
    status = git(['cat-file', '-e', `${liveSha}:public${path}`], { gitDir: ORIGIN }).code === 0 ? 200 : 404
    body = status === 200 ? 'IMAGE' : body
  }
  log({ args, path, status, liveSha })
  if (w === '%{http_code}') return out(String(status))
  return out(body)
}

// ─────────────────────────────────────────────────────────
// claude — brief-auto 의 `claude -p`
// ─────────────────────────────────────────────────────────
async function runClaude() {
  if (args.includes('--version')) { log({ args }); return out('rehearsal-claude 0.0.0 (fixture)') }
  const prompt = readFileSync(0, 'utf8')
  const L = await import(pathToFileURL(join(REPO, 'scripts/lib/magazine-load.mjs')).href)
  const C = await import(pathToFileURL(join(REPO, 'scripts/lib/magazine-rehearsal-content.mjs')).href)
  const queue = L.loadQueue()
  const hits = queue.filter((q) => prompt.includes(q.slug) || prompt.includes(q.title))
  const item = hits.find((q) => prompt.includes(q.title)) ?? hits[0]
  if (!item) { log({ args, error: 'SLUG_UNKNOWN' }); return fail('rehearsal claude: 프롬프트에서 큐 항목을 찾지 못했다') }
  const st = scenario()
  const counts = st.claudeCalls ?? {}
  counts[item.slug] = (counts[item.slug] ?? 0) + 1
  writeJson(join(FIX, 'scenario.json'), { ...st, claudeCalls: counts })
  const plan = st.claude?.[item.slug] ?? []
  const mode = plan[counts[item.slug] - 1] ?? 'good'
  log({ args: ['-p'], slug: item.slug, call: counts[item.slug], mode })
  return out(C.claudeBriefOutput({ repo: REPO, item, mode }))
}

if (tool === 'git') runGit()
else if (tool === 'gh') runGh()
else if (tool === 'curl') await runCurl()
else if (tool === 'claude') await runClaude()
else { log({ args, refused: 'TOOL' }); fail(`rehearsal: ${tool} 는 fixture 가 없다 — 거부`, 127) }
