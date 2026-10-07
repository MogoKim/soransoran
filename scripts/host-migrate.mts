#!/usr/bin/env tsx
/**
 * 상시 실행 호스트 이전 묶음 — 🔴 **기본은 계획만(읽기 전용). `--apply` 만 launchctl·파일을 바꾼다**
 * 🔴 **범위는 D100 레인 하나** — `D100_LANE_LABELS`(scripts/lib/host-migrate.mts) 밖의 job 은 읽지도
 *    내리지도 옮기지도 않는다. 원 호스트의 매거진·개발 job 은 loaded 그대로, plist 제자리다.
 *
 *   npm run host:migrate                                             plan — 무엇을 싣고 무엇을 다시 찍는지
 *   npm run host:migrate -- export --out=<dir> [--cutover]           묶음 만들기 (저장소·git 작업트리 안 거부)
 *   npm run host:migrate -- verify --bundle=<dir>                    해시 · 권한 · 비밀 누출 검사
 *   npm run host:migrate -- install --bundle=<dir> --target-home=<홈> [--target-node-bin=<dir>] [--apply]
 *   npm run host:migrate -- rollback --bundle=<dir> --target-home=<홈> [--apply]     (대상)
 *   npm run host:migrate -- quiesce [--apply]                                         (원 호스트 · D100 만)
 *   npm run host:migrate -- unquiesce --bundle-id=<id> [--apply]                      (원 호스트 · D100 만)
 *
 * 🔴 판단은 `scripts/lib/host-migrate.mts` 에 있다. 여기는 진짜 명령을 붙이는 자리다.
 * 🔴 env 값·토큰·네이버 세션 내용은 **어떤 경로로도 화면에 찍지 않는다** — 모든 출력이 `redact` 를 지난다.
 * 🔴 하지 않는 것: DB write · prisma migrate · runtime:deploy · 단계 스위치 변경 · 클라우드 업로드.
 * 🔴 정본 설명: docs/operations/ALWAYS-ON-HOST.md
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync,
  renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { connect } from 'node:net'
import { homedir, userInfo } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import {
  BUNDLE_FORMAT_VERSION, BUNDLE_MANIFEST, CUTOVER_ORDER, D100_LANE_LABELS, HANDOFF_FILE, LABEL_PREFIX, LANE,
  MANUAL_REAUTH, OUT_OF_LANE_LABELS, OUT_OF_LANE_PATHS, OWNER_FILE, QUIESCE_DIR_NAME, ROLLBACK_ORDER,
  TARGET_ROLLBACK_DIR_NAME,
  classifyCanonEntry, classifyCanonEntryIn, foreignHomePaths, homePathKeys, hostPathsOf, isLaneLabel, isLaneLog, isTransientFile,
  judgeAutorestart, judgeBundleOut, judgeCutoverExport, judgeManifest, judgePower, judgeTargetInstall,
  judgeUnquiesce, lanePlistFiles, nodeBinsIn, parseEnv, parseLaunchctlList, parsePmsetBatt, planQuiesce,
  redact, renderAndJudge, rewriteEnvHome, runInstall, runQuiesce, runUnquiesce, scanForSecrets,
  secretValuesOf, targetRollbackLabels, templatizePlist,
  type BundleEntry, type BundleEntryKind, type BundleManifest, type ChildEntry, type EntryTree, type HostVars, type InstallEffects,
  type LeakHit, type RenderedPlist,
} from './lib/host-migrate.mjs'
import { plistFileOf, writeInstalled } from './lib/launchd-install.mjs'

const argv = process.argv.slice(2)
const CMD = argv[0] !== undefined && !argv[0].startsWith('--') ? argv[0] : 'plan'
const opt = (name: string): string | null => {
  const a = argv.find((x) => x.startsWith(`--${name}=`))
  return a === undefined ? null : a.slice(name.length + 3)
}
const APPLY = argv.includes('--apply')
const CUTOVER = argv.includes('--cutover')
/**
 * 🔴 `--source-home` 은 **검사용**이다 — 가짜 홈으로 plan·export 를 돌려 누출을 시험한다.
 *    진짜 홈이 아니면 launchctl 을 읽지 않고(관측 없음), 어떤 `--apply` 도 받지 않는다.
 */
const REAL_HOME = homedir()
const SOURCE_HOME = resolve(opt('source-home') ?? REAL_HOME)
const FIXTURE = SOURCE_HOME !== REAL_HOME
const SRC = hostPathsOf(SOURCE_HOME)

// ── 출력 — 🔴 전부 가림을 지난다 ──
let SECRETS: { key: string; value: string }[] = []
const addSecretsFrom = (file: string): void => {
  try { SECRETS = [...SECRETS, ...secretValuesOf(readFileSync(file, 'utf-8'))] } catch { /* 없으면 없다 */ }
}
const say = (m = ''): void => { console.log(redact(m, SECRETS)) }
const warn = (m: string): void => { console.error(redact(m, SECRETS)) }
function die(m: string, code = 1): never { warn(`\n🔴 중단: ${m}\n`); process.exit(code) }

const kb = (n: number): string => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)}MB` : `${Math.ceil(n / 1024)}KB`)

/** 🔴 읽기 전용 명령 — 실패는 null. stderr 는 삼킨다(호출부가 말한다) */
const read = (cmd: string, args: readonly string[], cwd?: string): string | null => {
  try {
    return execFileSync(cmd, [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}
/** 🔴 바꾸는 명령 — 성공 여부만. 출력은 흘린다(값이 섞이지 않는 명령만 부른다) */
const act = (cmd: string, args: readonly string[], cwd?: string): boolean => {
  try { execFileSync(cmd, [...args], { cwd, stdio: 'inherit' }); return true } catch { return false }
}

// ── 파일 ──
type FileInfo = { rel: string; abs: string; size: number; mode: number }
/**
 * 🔴 심볼릭 링크는 따라가지 않는다 — 묶음 밖을 끌고 들어온다.
 * 🔴 `dropTransient` 는 **원 호스트를 읽을 때만** 켠다. verify 는 묶음 안 파일을 하나도 빼지 않고 봐야
 *    끼워 넣은 파일(EXTRA)을 잡는다.
 */
function walk(root: string, base = root, skipped: string[] = [], dropTransient = true): FileInfo[] {
  const out: FileInfo[] = []
  const st = lstatSync(root)
  if (st.isSymbolicLink()) { skipped.push(relative(base, root)); return out }
  if (st.isFile()) return [{ rel: relative(base, root), abs: root, size: st.size, mode: st.mode }]
  if (!st.isDirectory()) return out
  const top = relative(base, root).split('/')[0] || null
  for (const name of readdirSync(root).sort()) {
    if (dropTransient && isTransientFile(name, top)) continue
    out.push(...walk(join(root, name), base, skipped, dropTransient))
  }
  return out
}
/** 🔴 내용 규칙 판정용 — 이름과 종류만 본다(내용은 읽지 않는다 · 잠금도 빼지 않고 전부 센다) */
function entryTree(root: string): EntryTree {
  const typeOf = (p: string): ChildEntry['type'] => {
    const st = lstatSync(p)
    return st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other'
  }
  const children: ChildEntry[] = []
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      const type = typeOf(p)
      children.push({ rel: relative(root, p), type })
      if (type === 'dir') visit(p)
    }
  }
  const rootType = typeOf(root)
  if (rootType === 'dir') visit(root)
  return { rootType, children }
}
const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const isText = (buf: Buffer): boolean => !buf.subarray(0, 8192).includes(0)

function gitAncestorOf(p: string): string | null {
  let cur = p
  // 🔴 아직 없는 경로면 가장 가까운 조상의 실제 경로에서 본다(/tmp → /private/tmp 같은 링크 포함)
  while (!existsSync(cur) && dirname(cur) !== cur) cur = dirname(cur)
  try { cur = realpathSync(cur) } catch { /* 그대로 */ }
  for (;;) {
    if (existsSync(join(cur, '.git'))) return cur
    const up = dirname(cur)
    if (up === cur) return null
    cur = up
  }
}

// ── launchctl (읽기) ──
function ourJobs(): { label: string; pid: number | null }[] | null {
  if (FIXTURE) return null
  const out = read('launchctl', ['list'])
  return out === null ? null : parseLaunchctlList(out)
}
const installedPlists = (agentDir: string): string[] =>
  existsSync(agentDir) ? readdirSync(agentDir).filter((f) => f.startsWith(LABEL_PREFIX) && f.endsWith('.plist')).sort() : []

// ── 원 호스트 조사 ──
/** 🔴 D100 레인 handoff — 매거진은 이 표식과 무관하게 원 호스트에서 돈다 */
type Handoff = { lane: string; at: string; dir: string; loadedBefore: string[]; plists: string[]; bundleId: string | null }
const handoffPath = join(SRC.canonDir, HANDOFF_FILE)
const readHandoff = (): Handoff | null => {
  try { return JSON.parse(readFileSync(handoffPath, 'utf-8')) as Handoff } catch { return null }
}

type SourceSurvey = {
  entries: { name: string; kind: string; reason: string; files: FileInfo[] }[]
  plistDir: string
  /** 🔴 D100 allowlist 안 plist 만 — 나머지는 내용을 읽지도 않는다 */
  plistFiles: string[]
  /** allowlist 밖 plist 파일 이름 — plan 이 "건드리지 않음" 으로 보여 준다 */
  otherPlists: string[]
  /** allowlist 에 있지만 설치 plist 가 없는 label */
  laneMissing: string[]
  /** D100 loaded label (null = 관측 없음) */
  loaded: string[] | null
  otherLoaded: string[] | null
  nodeBin: string | null
  nodeBins: string[]
  envKeys: string[]
  envHomeKeys: string[]
  pinnedSha: string | null
  runtimeHead: string | null
  slackEnv: boolean
  logs: FileInfo[]
  skippedLinks: string[]
}

function surveySource(fromQuiesced: boolean): SourceSurvey {
  if (!existsSync(SRC.canonDir)) die(`운영 디렉터리가 없다 — ${SRC.canonDir}`)
  const skipped: string[] = []
  const entries = readdirSync(SRC.canonDir).sort().map((name) => {
    const byName = classifyCanonEntry(name)
    // 🔴 내용 규칙이 붙은 항목은 안을 보고 다시 판정한다 — 어긋나면 unclassified 로 export 가 멈춘다
    const rule = byName.contents === undefined ? byName : classifyCanonEntryIn(name, entryTree(join(SRC.canonDir, name)))
    const files = rule.kind === 'state' || rule.kind === 'secret' ? walk(join(SRC.canonDir, name), SRC.canonDir, skipped) : []
    return { name, kind: rule.kind, reason: rule.reason, files }
  })
  const handoff = readHandoff()
  const plistDir = fromQuiesced && handoff !== null ? handoff.dir : SRC.agentDir
  const allPlists = installedPlists(plistDir)
  // 🔴 allowlist 로 먼저 거른다 — 손상된 매거진 plist(23바이트 JSON 등)는 열어 보지도 않는다
  const plistFiles = lanePlistFiles(allPlists)
  const jobs = ourJobs()
  const loaded = fromQuiesced && handoff !== null ? handoff.loadedBefore.filter(isLaneLabel)
    : (jobs === null ? null : jobs.map((j) => j.label).filter(isLaneLabel))
  const present = new Set(plistFiles.map((f) => f.replace(/\.plist$/, '')))
  const bins = [...new Set(plistFiles.flatMap((f) => nodeBinsIn(readFileSync(join(plistDir, f), 'utf-8'))))]
  const envText = existsSync(join(SRC.canonDir, 'env.local')) ? readFileSync(join(SRC.canonDir, 'env.local'), 'utf-8') : ''
  const pin = ((): string | null => { try { return readFileSync(join(SRC.canonDir, 'runtime-pinned-sha'), 'utf-8').trim() } catch { return null } })()
  return {
    entries, plistDir, plistFiles, loaded,
    otherPlists: allPlists.filter((f) => !plistFiles.includes(f)),
    laneMissing: D100_LANE_LABELS.filter((l) => !present.has(l)),
    otherLoaded: jobs === null ? null : jobs.map((j) => j.label).filter((l) => !isLaneLabel(l)),
    nodeBin: bins[0] ?? null, nodeBins: bins,
    envKeys: [...parseEnv(envText).keys()],
    envHomeKeys: homePathKeys(envText, SOURCE_HOME),
    pinnedSha: pin,
    runtimeHead: existsSync(SRC.runtimeRoot) ? read('git', ['rev-parse', 'HEAD'], SRC.runtimeRoot) : null,
    slackEnv: existsSync(SRC.slackEnv),
    // 🔴 D100 job 의 로그만 — 매거진·82cook·모르는 로그는 싣지 않는다
    logs: existsSync(SRC.logDir) ? walk(SRC.logDir, SRC.logDir, skipped).filter((f) => !f.rel.includes('/') && isLaneLog(f.rel)) : [],
    skippedLinks: skipped,
  }
}

const sourceVars = (s: SourceSurvey): HostVars => ({ home: SOURCE_HOME, nodeBin: s.nodeBin ?? dirname(process.execPath) })

function templatesOf(s: SourceSurvey): { label: string; template: string; problems: string[] }[] {
  return s.plistFiles.map((f) => {
    const label = f.replace(/\.plist$/, '')
    const template = templatizePlist(readFileSync(join(s.plistDir, f), 'utf-8'), sourceVars(s))
    // 🔴 템플릿에 원 호스트 홈이 남으면 대상에서 다시 찍을 수 없다
    const left = foreignHomePaths(template, '__HOME__')
    const problems = left.length === 0 ? [] : [`템플릿화 못 한 경로 ${left.join(' ')}`]
    if (template.includes('__MAGAZINE_REPO__')) problems.push('매거진 runtime 을 가리킨다 — D100 레인에 싣지 않는다')
    return { label, template, problems }
  })
}

// ─────────────────────────────────────────────────────────
// plan
// ─────────────────────────────────────────────────────────
function cmdPlan(): void {
  addSecretsFrom(join(SRC.canonDir, 'env.local'))
  addSecretsFrom(SRC.slackEnv)
  const s = surveySource(false)
  say(`\n══ 상시 실행 호스트 이전 — ${LANE} 레인 계획 (읽기 전용 · 변경 0)${FIXTURE ? ' · 🟡 검사용 가짜 홈' : ''} ══\n`)
  say(`  원 호스트 홈  ${SOURCE_HOME}`)
  say(`  runtime pin   ${s.pinnedSha ?? '🔴 없음'}   runtime HEAD ${s.runtimeHead ?? '관측 없음'}${s.pinnedSha !== null && s.runtimeHead !== null && s.pinnedSha !== s.runtimeHead ? '  🔴 불일치' : ''}`)
  say(`  node          ${s.nodeBin ?? '(plist 에 nvm 경로 없음)'}${s.nodeBins.length > 1 ? `  🔴 서로 다른 node ${s.nodeBins.length}벌` : ''}`)

  say('\n  ── 운영 디렉터리 항목 (Application Support/soransoran)')
  let total = 0
  for (const e of s.entries) {
    const size = e.files.reduce((a, f) => a + f.size, 0)
    total += size
    const icon = e.kind === 'secret' ? '🔐' : e.kind === 'state' ? '📦' : e.kind === 'exclude' ? '⚪' : '🔴'
    say(`     ${icon} ${e.kind.padEnd(12)} ${e.name}${e.files.length > 0 ? `  (${e.files.length}개 · ${kb(size)})` : ''} — ${e.reason}`)
  }
  const unclassified = s.entries.filter((e) => e.kind === 'unclassified')
  say(`     합계 ${kb(total)}${unclassified.length > 0 ? `  🔴 미분류 ${unclassified.length}건 — export 가 거부한다` : ''}`)
  if (s.skippedLinks.length > 0) say(`     🟡 심볼릭 링크 ${s.skippedLinks.length}개는 싣지 않는다: ${s.skippedLinks.join(' ')}`)

  say('\n  ── env (🔴 키 이름만)')
  say(`     키 ${s.envKeys.length}개: ${s.envKeys.join(' ')}`)
  say(`     비밀로 가리는 값 ${SECRETS.length}개(키 이름 기준)`)
  say(`     대상 홈으로 바꿔 쓸 경로 키: ${s.envHomeKeys.length === 0 ? '없음' : s.envHomeKeys.join(' ')}`)
  say(`     slack.env (~/.config/soransoran): ${s.slackEnv ? '🔐 싣는다' : '없음'}`)

  say(`\n  ── launchd — ${LANE} 레인 allowlist ${D100_LANE_LABELS.length}개 중 설치본 ${s.plistFiles.length}개를 템플릿으로 되돌려 대상 홈·node 로 다시 찍는다`)
  const fakeTarget: HostVars = { home: '/Users/target', nodeBin: '/Users/target/.nvm/versions/node/vX/bin' }
  const loadedSet = new Set(s.loaded ?? [])
  for (const t of templatesOf(s)) {
    const r = renderAndJudge(t.label, t.template, fakeTarget)
    const bad = [...t.problems, ...r.problems]
    say(`     ${bad.length === 0 ? '🟢' : '🔴'} ${t.label}  ${s.loaded === null ? '(loaded 관측 없음)' : loadedSet.has(t.label) ? 'loaded' : 'unloaded'}${bad.length > 0 ? ` — ${bad.join(' · ')}` : ''}`)
  }
  for (const l of s.laneMissing) say(`     🟡 ${l}  설치 plist 없음 — 대상에도 없다`)
  say('\n  ── 건드리지 않는 job (원 호스트에서 그대로 돈다 · 내용도 읽지 않는다)')
  const why = new Map(OUT_OF_LANE_LABELS.map((x) => [x.label, x.why]))
  const others = [...new Set([...s.otherPlists.map((f) => f.replace(/\.plist$/, '')), ...(s.otherLoaded ?? [])])].sort()
  if (others.length === 0) say('     없음')
  for (const l of others) say(`     ⚪ ${l} — ${why.get(l) ?? '레인 allowlist 밖(기본 거부)'}`)
  say('\n  ── 싣지 않는 다른 레인 자격증명·작업트리 (원 호스트에 남는다)')
  for (const x of OUT_OF_LANE_PATHS) say(`     ⚪ ${x.what} — ~/${x.rel}${existsSync(join(SOURCE_HOME, x.rel)) ? '' : ' (없음)'}`)
  say(`\n  ── 로그 ${s.logs.length}개 · ${kb(s.logs.reduce((a, f) => a + f.size, 0))} (연속성용으로 싣는다)`)

  say('\n  ── 대상에서 사람이 다시 로그인할 것 (싣지 않는다)')
  for (const m of MANUAL_REAUTH) say(`     · ${m.what} — ${m.why} → ${m.how}`)
  say('\n  ── 대상 사전 점검 (install 이 확인한다)')
  for (const p of PREFLIGHT_DESC) say(`     · ${p}`)
  say('\n  ── 전환 순서')
  for (const l of CUTOVER_ORDER) say(`     ${l}`)
  say('\n  ── 되돌리기')
  for (const l of ROLLBACK_ORDER) say(`     ${l}`)
  say('')
}

const PREFLIGHT_DESC: readonly string[] = [
  'macOS 14 이상 · 대상 사용자로 로그인한 셸(홈 = --target-home)',
  'node — 원 호스트와 같은 major (nvm 경로 · --target-node-bin 으로 바꿀 수 있다)',
  'git · plutil · launchctl 존재',
  '디스크 여유 ≥ 묶음 × 3 + 3GB (runtime node_modules)',
  '네트워크 — GitHub · Supabase pooler(DATABASE_URL/DIRECT_URL 호스트) · Gemini · Anthropic · OpenAI · 네이버 카페 · Slack · Google Sheets (82cook 은 꺼 둔 job 이라 보지 않는다)',
  '전원 — AC 에 꽂혀 있을 것(기종 무관 · 배터리 있는 MacBook 도 AC 연결이면 통과 · 배터리로 돌고 있으면 실패) · pmset sleep 0 · 배터리 없는 Mac 은 autorestart 1',
  '로그인 — 자동 로그인 사용자 = 대상 사용자 (FileVault 켜져 있으면 재부팅 뒤 사람이 풀어야 한다)',
]

// ─────────────────────────────────────────────────────────
// export
// ─────────────────────────────────────────────────────────
function cmdExport(): void {
  addSecretsFrom(join(SRC.canonDir, 'env.local'))
  addSecretsFrom(SRC.slackEnv)
  const outArg = opt('out')
  if (outArg === null) die('--out=<dir> 이 필요하다')
  const out = resolve(outArg)
  const exists = existsSync(out)
  const verdict = judgeBundleOut({
    outAbs: out,
    gitAncestor: gitAncestorOf(out),
    forbiddenRoots: [SRC.canonDir, SRC.agentDir, SRC.logDir, SRC.repoRoot, SRC.runtimeRoot, SRC.magazineRuntimeRoot, process.cwd()],
    exists,
    empty: exists ? readdirSync(out).length === 0 : true,
  })
  if (!verdict.ok) die(`묶음 위치 거부 — ${verdict.reason}`)

  const handoff = readHandoff()
  if (CUTOVER) {
    if (FIXTURE) die('검사용 가짜 홈에서는 cutover 묶음을 만들지 않는다')
    const jobs = ourJobs()
    const g = judgeCutoverExport({
      loadedLabels: jobs === null ? null : jobs.map((j) => j.label),
      installedPlists: installedPlists(SRC.agentDir),
      handoffPresent: handoff !== null,
      handoffBundleId: handoff?.bundleId ?? null,
    })
    if (!g.ok) die(`cutover 묶음을 만들 수 없다\n   · ${g.problems.join('\n   · ')}`)
  }
  const s = surveySource(CUTOVER)
  const unclassified = s.entries.filter((e) => e.kind === 'unclassified').map((e) => e.name)
  if (unclassified.length > 0) die(`미분류 항목 ${unclassified.join(' ')} — scripts/lib/host-migrate.mts 에 분류를 적는다`)
  if (s.nodeBins.length > 1) die(`설치본이 서로 다른 node ${s.nodeBins.length}벌을 가리킨다 — 하나로 맞춘 뒤 옮긴다`)
  const templates = templatesOf(s)
  const badT = templates.filter((t) => t.problems.length > 0)
  if (badT.length > 0) die(`템플릿화 실패 ${badT.map((t) => `${t.label}: ${t.problems.join(' ')}`).join(' / ')}`)

  const bundleId = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomUUID().slice(0, 8)}`
  mkdirSync(out, { recursive: true, mode: 0o700 })
  chmodSync(out, 0o700)
  const entries: BundleEntry[] = []
  const put = (rel: string, from: string | null, text: string | null, kind: BundleEntryKind, srcMode: number): void => {
    const dst = join(out, rel)
    mkdirSync(dirname(dst), { recursive: true, mode: 0o700 })
    if (from !== null) copyFileSync(from, dst)
    else writeFileSync(dst, text ?? '')
    // 🔴 비밀은 0600. 나머지도 그룹·기타 쓰기는 뺀다
    const mode = kind === 'secret' ? 0o600 : (srcMode & 0o755) | 0o600
    chmodSync(dst, mode)
    const st = statSync(dst)
    entries.push({ path: rel, sha256: sha256(dst), size: st.size, mode: (st.mode & 0o777).toString(8), kind })
  }
  for (const e of s.entries) {
    for (const f of e.files) put(join('state', f.rel), f.abs, null, e.kind === 'secret' ? 'secret' : 'state', f.mode)
  }
  if (s.slackEnv) put('home/.config/soransoran/slack.env', SRC.slackEnv, null, 'secret', 0o600)
  for (const t of templates) put(`launchd/${t.label}.plist.template`, null, t.template, 'plist-template', 0o644)
  for (const f of s.logs) put(join('logs', f.rel), f.abs, null, 'log', f.mode)

  const manifest: BundleManifest = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    lane: LANE,
    bundleId,
    mode: CUTOVER ? 'cutover' : 'rehearsal',
    createdAt: new Date().toISOString(),
    source: {
      home: SOURCE_HOME, user: FIXTURE ? 'fixture' : userInfo().username,
      macos: read('sw_vers', ['-productVersion']), arch: process.arch,
      nodeBin: sourceVars(s).nodeBin, nodeVersion: /\/(v[\d.]+)\/bin$/.exec(sourceVars(s).nodeBin)?.[1] ?? process.version,
    },
    runtime: { pinnedSha: s.pinnedSha },
    envKeys: s.envKeys,
    envHomePathKeys: s.envHomeKeys,
    plists: templates.map((t) => ({
      label: t.label, file: `launchd/${t.label}.plist.template`,
      loadedAtExport: s.loaded === null ? null : s.loaded.includes(t.label),
    })),
    laneMissing: s.laneMissing,
    excluded: s.entries.filter((e) => e.kind === 'exclude').map((e) => ({ name: e.name, reason: e.reason })),
    quiesce: CUTOVER && handoff !== null ? { handoffAt: handoff.at, loadedBefore: handoff.loadedBefore } : null,
    entries,
  }
  writeFileSync(join(out, BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  if (CUTOVER && handoff !== null) {
    writeFileSync(handoffPath, `${JSON.stringify({ ...handoff, bundleId }, null, 2)}\n`, { mode: 0o600 })
  }
  const bytes = entries.reduce((a, e) => a + e.size, 0)
  say(`\n══ 묶음 만듦 — ${LANE} · ${manifest.mode} · ${bundleId} ══`)
  say(`  D100 job ${templates.length}개${s.laneMissing.length > 0 ? ` · 🟡 설치 plist 없음 ${s.laneMissing.join(' ')}` : ''} · 다른 레인 plist ${s.otherPlists.length}개는 싣지 않았다`)
  say(`  위치 ${out} (0700)`)
  for (const k of ['state', 'secret', 'plist-template', 'log'] as const) {
    const xs = entries.filter((e) => e.kind === k)
    say(`  ${k.padEnd(15)} ${xs.length}개 · ${kb(xs.reduce((a, e) => a + e.size, 0))}`)
  }
  say(`  합계 ${entries.length}개 · ${kb(bytes)}`)
  say(`  🔴 비밀이 들어 있다 — 옮긴 뒤 rm -rf ${out}`)
  const problems = verifyBundle(out, false)
  process.exit(problems === 0 ? 0 : 1)
}

// ─────────────────────────────────────────────────────────
// verify
// ─────────────────────────────────────────────────────────
function loadManifest(dir: string): BundleManifest {
  try { return JSON.parse(readFileSync(join(dir, BUNDLE_MANIFEST), 'utf-8')) as BundleManifest } catch {
    return die(`manifest 를 읽지 못했다 — ${join(dir, BUNDLE_MANIFEST)}`)
  }
}

/** 🔴 문제 수를 돌려준다. 0 이 아니면 설치하지 않는다 */
function verifyBundle(dir: string, loud = true): number {
  const m = loadManifest(dir)
  addSecretsFrom(join(dir, 'state', 'env.local'))
  addSecretsFrom(join(dir, 'home/.config/soransoran/slack.env'))
  const actual = new Map<string, { sha256: string; size: number; mode: number }>()
  const links: string[] = []
  for (const f of walk(dir, dir, links, false)) {
    if (f.rel === BUNDLE_MANIFEST) continue
    actual.set(f.rel, { sha256: sha256(f.abs), size: f.size, mode: f.mode })
  }
  const problems = judgeManifest({ manifest: m, actual })
  // 🔴 묶음 안 링크는 설치 때 묶음 밖을 가리킨다 — export 는 링크를 만들지 않는다
  for (const l of links) problems.push({ code: 'EXTRA', detail: `심볼릭 링크 ${l}` })
  const rootMode = statSync(dir).mode & 0o777
  if ((rootMode & 0o077) !== 0) problems.push({ code: 'PERM', detail: `묶음 디렉터리 ${rootMode.toString(8)} — 0700 이어야 한다` })
  const manMode = statSync(join(dir, BUNDLE_MANIFEST)).mode & 0o777
  if ((manMode & 0o077) !== 0) problems.push({ code: 'PERM', detail: `manifest ${manMode.toString(8)}` })

  // 🔴 비밀이 아닌 파일 + manifest 에 비밀 값·모양이 있으면 실패 — 이름만 적는다
  const leaks: LeakHit[] = [...scanForSecrets(BUNDLE_MANIFEST, readFileSync(join(dir, BUNDLE_MANIFEST), 'utf-8'), SECRETS)]
  for (const e of m.entries) {
    if (e.kind === 'secret') continue
    const p = join(dir, e.path)
    if (!existsSync(p)) continue
    const buf = readFileSync(p)
    if (!isText(buf)) continue
    leaks.push(...scanForSecrets(e.path, buf.toString('utf-8'), SECRETS))
  }
  for (const l of leaks) problems.push({ code: 'LEAK', detail: `${l.where} — ${l.what}` })

  // 🔴 템플릿이 원 호스트 값으로 다시 찍히는지(치환 누락 없음)
  for (const p of m.plists) {
    const f = join(dir, p.file)
    if (!existsSync(f)) continue
    const r = renderAndJudge(p.label, readFileSync(f, 'utf-8'), { home: m.source.home, nodeBin: m.source.nodeBin })
    for (const x of r.problems) problems.push({ code: 'PLIST', detail: `${p.label} ${x}` })
  }

  if (loud) {
    say(`\n══ 묶음 검사 — ${String(m.lane)} · ${m.mode} · ${m.bundleId} ══`)
    say(`  파일 ${m.entries.length}개 · 비밀 ${m.entries.filter((e) => e.kind === 'secret').length}개 · plist 템플릿 ${m.plists.length}개`)
  }
  for (const p of problems.slice(0, 40)) say(`  🔴 ${p.code} ${p.detail}`)
  if (problems.length > 40) say(`  … 외 ${problems.length - 40}건`)
  say(problems.length === 0 ? '  ✅ verify 통과 — 해시 · 권한 · 누출 0 · 템플릿' : `  🔴 verify 실패 ${problems.length}건`)
  return problems.length
}

function cmdVerify(): void {
  const b = opt('bundle')
  if (b === null) die('--bundle=<dir> 이 필요하다')
  process.exit(verifyBundle(resolve(b)) === 0 ? 0 : 1)
}

// ─────────────────────────────────────────────────────────
// 사전 점검 (대상)
// ─────────────────────────────────────────────────────────
type Check = { name: string; ok: boolean; detail: string }

const tcp = (host: string, port: number, ms = 3000): Promise<boolean> => new Promise((res) => {
  const sock = connect({ host, port })
  const done = (ok: boolean): void => { sock.destroy(); res(ok) }
  sock.setTimeout(ms, () => done(false))
  sock.once('connect', () => done(true))
  sock.once('error', () => done(false))
})

const PUBLIC_HOSTS: readonly string[] = [
  'github.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'api.openai.com',
  'cafe.naver.com', 'nid.naver.com', 'hooks.slack.com', 'sheets.googleapis.com', 'oauth2.googleapis.com',
]

async function preflight(m: BundleManifest, bundleDir: string, target: HostVars): Promise<Check[]> {
  const out: Check[] = []
  const macos = read('sw_vers', ['-productVersion'])
  out.push({ name: 'macOS ≥ 14', ok: macos !== null && Number(macos.split('.')[0]) >= 14, detail: macos ?? '관측 없음' })
  const nodeV = read(join(target.nodeBin, 'node'), ['--version'])
  const wantMajor = m.source.nodeVersion.replace(/^v/, '').split('.')[0]
  out.push({
    name: `node ${m.source.nodeVersion} (major ${wantMajor})`,
    ok: nodeV !== null && nodeV.replace(/^v/, '').split('.')[0] === wantMajor,
    detail: nodeV === null ? `없음 — ${target.nodeBin}/node` : nodeV,
  })
  for (const name of ['git', 'plutil', 'launchctl']) {
    const ok = read('/usr/bin/which', [name]) !== null
    out.push({ name, ok, detail: ok ? '있음' : '없음' })
  }
  let anc = target.home
  while (!existsSync(anc) && dirname(anc) !== anc) anc = dirname(anc)
  const df = read('df', ['-k', anc])
  const availKb = df === null ? null : Number(df.split('\n')[1]?.trim().split(/\s+/)[3])
  const bytes = m.entries.reduce((a, e) => a + e.size, 0)
  const needKb = Math.ceil((bytes * 3) / 1024) + 3 * 1024 * 1024
  out.push({ name: '디스크 여유', ok: availKb !== null && availKb >= needKb, detail: availKb === null ? '관측 없음' : `${kb(availKb * 1024)} (필요 ${kb(needKb * 1024)})` })

  const envText = existsSync(join(bundleDir, 'state', 'env.local')) ? readFileSync(join(bundleDir, 'state', 'env.local'), 'utf-8') : ''
  const env = parseEnv(envText)
  // 🔴 `--skip-network` 는 검사용이다 — 건너뛴 항목은 **미충족으로 센다**(적용이 열리지 않는다)
  if (argv.includes('--skip-network')) {
    out.push({ name: '네트워크', ok: false, detail: '건너뜀(--skip-network) — 적용 불가' })
  } else {
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const v = env.get(key)
    if (v === undefined) { out.push({ name: `${key} 호스트`, ok: false, detail: 'env 에 없음' }); continue }
    try {
      const u = new URL(v)
      const ok = await tcp(u.hostname, Number(u.port || 5432))
      // 🔴 호스트 이름도 찍지 않는다 — URL 의 일부다
      out.push({ name: `${key} 호스트 TCP`, ok, detail: ok ? '연결됨' : '연결 안 됨' })
    } catch { out.push({ name: `${key} 호스트`, ok: false, detail: 'URL 해석 실패' }) }
  }
  const results = await Promise.all(PUBLIC_HOSTS.map(async (h) => ({ h, ok: await tcp(h, 443) })))
  for (const r of results) out.push({ name: `${r.h}:443`, ok: r.ok, detail: r.ok ? '연결됨' : '연결 안 됨' })
  }

  // 🔴 상시 실행 조건 — 기종은 묻지 않는다. AC 에 꽂혀 있는가만 본다(배터리 있는 MacBook 도 AC 면 통과)
  const power = parsePmsetBatt(read('pmset', ['-g', 'batt']) ?? read('pmset', ['-g', 'ps']) ?? '')
  const pv = judgePower(power)
  out.push({ name: 'AC 전원 (배터리로 돌고 있으면 실패)', ok: pv.ok, detail: pv.detail })
  const pm = read('pmset', ['-g']) ?? ''
  const sleepV = /^\s*sleep\s+(\d+)/m.exec(pm)?.[1] ?? null
  out.push({ name: 'pmset sleep 0', ok: sleepV === '0', detail: sleepV ?? '관측 없음' })
  const custom = read('pmset', ['-g', 'custom']) ?? ''
  const ar = /autorestart\s+(\d)/.exec(custom)?.[1] ?? null
  const arv = judgeAutorestart(power, ar)
  out.push({ name: '정전 뒤 자동 켜짐 (배터리 없는 Mac 은 autorestart 1)', ok: arv.ok, detail: arv.detail })
  const auto = read('defaults', ['read', '/Library/Preferences/com.apple.loginwindow', 'autoLoginUser'])
  const targetUser = target.home.split('/').pop() ?? ''
  out.push({ name: '자동 로그인 = 대상 사용자', ok: auto === targetUser, detail: auto === null ? '설정 없음' : auto })
  const fv = read('fdesetup', ['status'])
  out.push({ name: 'FileVault 꺼짐(재부팅 뒤 무인 로그인)', ok: fv !== null && /Off/.test(fv), detail: fv ?? '관측 없음' })
  return out
}

// ─────────────────────────────────────────────────────────
// install (대상)
// ─────────────────────────────────────────────────────────
async function cmdInstall(): Promise<void> {
  const b = opt('bundle'); const th = opt('target-home')
  if (b === null || th === null) die('--bundle=<dir> --target-home=<홈> 이 필요하다')
  const dir = resolve(b!); const H = resolve(th!)
  const m = loadManifest(dir)
  say(`\n══ 대상 설치 — ${APPLY ? '🔴 실제 적용' : 'dry-run (변경 0)'} · 묶음 ${m.mode} ${m.bundleId} ══`)
  const vp = verifyBundle(dir)
  const T = hostPathsOf(H)
  const target: HostVars = { home: H, nodeBin: resolve(opt('target-node-bin') ?? `${H}/.nvm/versions/node/${m.source.nodeVersion}/bin`) }
  say(`\n  대상 홈 ${H}\n  node   ${target.nodeBin}`)

  const rendered: RenderedPlist[] = m.plists.map((p) => renderAndJudge(p.label, readFileSync(join(dir, p.file), 'utf-8'), target))
  say(`\n  ── plist 다시 찍기 ${rendered.length}개 (원 홈 ${m.source.home} → ${H})`)
  for (const r of rendered) {
    const leftSrc = r.xml.includes(`${m.source.home}/`) && m.source.home !== H
    say(`     ${r.problems.length === 0 && !leftSrc ? '🟢' : '🔴'} ${r.label}${r.problems.length > 0 ? ` — ${r.problems.join(' · ')}` : ''}${leftSrc ? ' — 원 홈 경로 남음' : ''}`)
  }
  /**
   * 🔴 `--render-to` — 다시 찍은 plist 를 눈으로 보려고 쓴다(대상 LaunchAgents 가 아니다).
   *    묶음과 같은 규칙으로 git 작업트리·운영 경로 안에는 쓰지 않는다.
   */
  const renderTo = opt('render-to')
  if (renderTo !== null) {
    const rt = resolve(renderTo)
    const v = judgeBundleOut({
      outAbs: rt, gitAncestor: gitAncestorOf(rt),
      forbiddenRoots: [T.agentDir, SRC.agentDir, SRC.canonDir, process.cwd()],
      exists: existsSync(rt), empty: existsSync(rt) ? readdirSync(rt).length === 0 : true,
    })
    if (!v.ok) die(`--render-to 거부 — ${v.reason}`)
    mkdirSync(rt, { recursive: true, mode: 0o700 })
    for (const r of rendered) writeFileSync(join(rt, plistFileOf(r.label)), r.xml, { mode: 0o644 })
    say(`     다시 찍은 plist ${rendered.length}개 → ${rt} (확인용)`)
  }
  const loadLabels = m.plists.filter((p) => p.loadedAtExport === true).map((p) => p.label)
  say(`     bootstrap 할 job ${loadLabels.length}개 (내보낼 때 loaded 였던 것만)${m.plists.some((p) => p.loadedAtExport === null) ? ' · 🟡 loaded 관측 없는 항목 있음' : ''}`)
  say(`\n  ── env 홈 경로 키 바꿔 쓰기: ${m.envHomePathKeys.length === 0 ? '없음' : m.envHomePathKeys.join(' ')}`)

  const checks = await preflight(m, dir, target)
  say('\n  ── 사전 점검 (이 명령을 돌린 기계를 잰다)')
  for (const c of checks) say(`     ${c.ok ? '🟢' : '🔴'} ${c.name} — ${c.detail}`)
  const fails = checks.filter((c) => !c.ok).length

  const tJobs = FIXTURE || H !== REAL_HOME ? [] : (ourJobs() ?? null)
  // 🔴 묶음이 쓸 운영 항목(state 최상위 이름 · slack.env)이 대상에 이미 있으면 덮어쓰지 않는다
  const tops = [...new Set(m.entries.filter((e) => e.path.startsWith('state/')).map((e) => e.path.slice(6).split('/')[0]!))]
  const collisions = tops.filter((n) => existsSync(join(T.canonDir, n)))
  if (m.entries.some((e) => e.path === 'home/.config/soransoran/slack.env') && existsSync(T.slackEnv)) collisions.push('~/.config/soransoran/slack.env')
  const guard = judgeTargetInstall({
    bundleMode: m.mode, bundleLane: m.lane, verifyProblems: vp,
    targetPlists: installedPlists(T.agentDir),
    targetLoaded: tJobs === null ? null : tJobs.map((j) => j.label),
    targetOwnerPresent: existsSync(join(T.canonDir, OWNER_FILE)),
    targetCanonCollisions: collisions,
    targetRuntimeExists: existsSync(T.runtimeRoot),
    runningHome: REAL_HOME, targetHome: H, preflightFailures: fails,
  })

  say('\n  ── 적용하면 이 순서로 한다')
  const uid = process.getuid?.() ?? 0
  const steps = [
    `git clone https://github.com/MogoKim/soransoran.git ${T.repoRoot}`,
    `git -C ${T.repoRoot} worktree add --detach ${T.runtimeRoot} ${m.runtime.pinnedSha ?? '<pin 없음>'}`,
    '(runtime) npm ci && npx prisma generate   — 🔴 매거진 runtime 은 만들지 않는다',
    `state → ${T.canonDir} (0700) · 로그 → ${T.logDir}`,
    `env.local → ${T.canonDir}/env.local (0600 · 홈 경로 키만 바꿈) · ${T.runtimeRoot}/.env.local → 심볼릭 링크`,
    `D100 plist ${rendered.length}개 → ${T.agentDir} · plutil -lint`,
    `${LANE} 소유 표식 ${OWNER_FILE} (job 을 올리기 전에)`,
    `launchctl bootstrap gui/${uid} … ${loadLabels.length}개`,
    '(runtime) npm run runtime:isolation-check -- --require-runtime',
    '실패하면: 올린 job bootout → plist 를 host-migrate-rollback 으로 → 소유 표식 삭제',
  ]
  steps.forEach((x, i) => say(`     ${i + 1}. ${x}`))

  if (!guard.ok) {
    say(`\n  🔴 --apply 는 거부된다 (${guard.problems.length}건)`)
    for (const p of guard.problems) say(`     · ${p}`)
  } else say('\n  🟢 --apply 가능')
  if (!APPLY) { say('\n  dry-run — 아무것도 바꾸지 않았다\n'); process.exit(0) }
  if (FIXTURE || !guard.ok) die('적용하지 않는다 — 위 거부 사유')

  const backupDir = join(T.canonDir, TARGET_ROLLBACK_DIR_NAME, new Date().toISOString().replace(/[:.]/g, '-'))
  const fx: InstallEffects = {
    cloneRepo: () => existsSync(join(T.repoRoot, '.git')) || act('git', ['clone', 'https://github.com/MogoKim/soransoran.git', T.repoRoot]),
    addRuntime: (sha) => act('git', ['fetch', 'origin'], T.repoRoot) && act('git', ['worktree', 'add', '--detach', T.runtimeRoot, sha], T.repoRoot),
    installDeps: () => act('npm', ['ci'], T.runtimeRoot) && act('npx', ['prisma', 'generate'], T.runtimeRoot),
    restoreState: () => {
      try {
        mkdirSync(T.canonDir, { recursive: true, mode: 0o700 })
        mkdirSync(T.logDir, { recursive: true })
        for (const e of m.entries) {
          if (e.path === 'state/env.local') continue
          const dst = e.path.startsWith('state/') ? join(T.canonDir, e.path.slice(6))
            : e.path.startsWith('logs/') ? join(T.logDir, e.path.slice(5))
              : e.path.startsWith('home/') ? join(H, e.path.slice(5)) : null
          if (dst === null) continue
          mkdirSync(dirname(dst), { recursive: true, mode: 0o700 })
          copyFileSync(join(dir, e.path), dst)
          chmodSync(dst, parseInt(e.mode, 8))
        }
        return true
      } catch { return false }
    },
    writeEnv: () => {
      try {
        const text = rewriteEnvHome(readFileSync(join(dir, 'state', 'env.local'), 'utf-8'), m.source.home, H)
        writeFileSync(join(T.canonDir, 'env.local'), text, { mode: 0o600 })
        chmodSync(join(T.canonDir, 'env.local'), 0o600)
        const link = join(T.runtimeRoot, '.env.local')
        if (!existsSync(link)) symlinkSync(join(T.canonDir, 'env.local'), link)
        return true
      } catch { return false }
    },
    writePlist: (l, xml) => { mkdirSync(T.agentDir, { recursive: true }); return writeInstalled(T.agentDir, l, xml) },
    lintPlist: (l) => act('plutil', ['-lint', join(T.agentDir, plistFileOf(l))]),
    bootstrap: (l) => act('launchctl', ['bootstrap', `gui/${uid}`, join(T.agentDir, plistFileOf(l))]),
    isolationCheck: () => act('npx', ['tsx', 'scripts/runtime-isolation-check.mts', '--require-runtime'], T.runtimeRoot),
    writeOwner: () => {
      try {
        writeFileSync(join(T.canonDir, OWNER_FILE), `${JSON.stringify({ lane: LANE, bundleId: m.bundleId, at: new Date().toISOString(), home: H }, null, 2)}\n`, { mode: 0o600 })
        return true
      } catch { return false }
    },
    bootout: (l) => act('launchctl', ['bootout', `gui/${uid}/${l}`]),
    retirePlist: (l) => {
      const f = join(T.agentDir, plistFileOf(l))
      if (!existsSync(f)) return true
      try { mkdirSync(backupDir, { recursive: true }); renameSync(f, join(backupDir, plistFileOf(l))); return true } catch { return false }
    },
    removeOwner: () => { try { rmSync(join(T.canonDir, OWNER_FILE), { force: true }); return true } catch { return false } },
    log: (x) => say(`   ${x}`),
  }
  const r = runInstall({ pinnedSha: m.runtime.pinnedSha ?? '', plists: rendered, loadLabels }, fx)
  if (r.ok) { say(`\n✅ 설치 완료 — 묶음 ${m.bundleId}. 원 호스트 묶음·이 묶음을 지운다(비밀)\n`); process.exit(0) }
  warn(`\n🔴 설치 멈춤 — ${r.phase}`)
  if (r.rollback !== null) for (const x of r.rollback.residual) warn(`   · 남은 것: ${x}`)
  process.exit(1)
}

// ─────────────────────────────────────────────────────────
// rollback (대상)
// ─────────────────────────────────────────────────────────
function cmdRollback(): void {
  const b = opt('bundle'); const th = opt('target-home')
  if (b === null || th === null) die('--bundle=<dir> --target-home=<홈> 이 필요하다')
  const m = loadManifest(resolve(b!)); const H = resolve(th!); const T = hostPathsOf(H)
  const uid = process.getuid?.() ?? 0
  say(`\n══ 대상 되돌리기 (${LANE} 레인만) — ${APPLY ? '🔴 실제 적용' : 'dry-run'} · 묶음 ${m.bundleId} ══`)
  const dst = join(T.canonDir, TARGET_ROLLBACK_DIR_NAME, new Date().toISOString().replace(/[:.]/g, '-'))
  const labels = targetRollbackLabels(m.plists.map((p) => p.label))
  for (const l of labels) say(`   launchctl bootout gui/${uid}/${l} · ${plistFileOf(l)} → ${dst}`)
  say(`   rm ${join(T.canonDir, OWNER_FILE)}`)
  say(`\n   다음: 원 호스트에서 npm run host:migrate -- unquiesce --bundle-id=${m.bundleId} --apply`)
  if (!APPLY) { say('\n   dry-run — 아무것도 바꾸지 않았다\n'); return }
  if (FIXTURE || H !== REAL_HOME) die('대상 사용자 셸에서만 적용한다')
  const residual: string[] = []
  for (const l of labels) {
    act('launchctl', ['bootout', `gui/${uid}/${l}`])
    const f = join(T.agentDir, plistFileOf(l))
    if (existsSync(f)) {
      try { mkdirSync(dst, { recursive: true }); renameSync(f, join(dst, plistFileOf(l))) } catch { residual.push(l) }
    }
  }
  const after = ourJobs()
  const still = after === null ? ['관측 실패'] : after.map((j) => j.label).filter(isLaneLabel)
  if (still.length > 0) residual.push(`아직 loaded ${still.join(' ')}`)
  rmSync(join(T.canonDir, OWNER_FILE), { force: true })
  if (residual.length > 0) die(`남은 것 ${residual.join(' · ')}`)
  say(`\n✅ 대상 내림 완료 — bundle-id ${m.bundleId}\n`)
}

// ─────────────────────────────────────────────────────────
// quiesce / unquiesce (원 호스트)
// ─────────────────────────────────────────────────────────
function cmdQuiesce(): void {
  const uid = process.getuid?.() ?? 0
  const rows = ourJobs()
  say(`\n══ 원 호스트 내리기 (${LANE} 레인만) — ${APPLY ? '🔴 실제 적용' : 'dry-run'} ══`)
  if (rows === null) die('launchctl 을 읽지 못했다 (또는 검사용 가짜 홈)')
  // 🔴 거르는 것은 planQuiesce 다 — 매거진·개발·모르는 job 은 bootout 도 이동도 하지 않는다
  const plan = planQuiesce({ rows: rows!, plistFiles: installedPlists(SRC.agentDir) })
  say(`   D100 loaded ${plan.bootout.length}개 · D100 plist ${plan.move.length}개 · 실행 중 ${plan.busy.length}개`)
  const dir = join(SRC.canonDir, QUIESCE_DIR_NAME, new Date().toISOString().replace(/[:.]/g, '-'))
  for (const l of plan.bootout) say(`   launchctl bootout gui/${uid}/${l}`)
  for (const f of plan.move) say(`   ${f} → ${dir}`)
  say(`   ⚪ 그대로 둔다 — loaded ${plan.untouchedLoaded.length}개 · plist ${plan.untouchedPlists.length}개: ${[...new Set([...plan.untouchedLoaded, ...plan.untouchedPlists.map((f) => f.replace(/\.plist$/, ''))])].sort().join(' ') || '없음'}`)
  if (plan.busy.length > 0) say(`   🔴 실행 중인 회차 위로는 내리지 않는다: ${plan.busy.join(' ')} — 끝난 뒤 다시`)
  if (!APPLY) { say('\n   dry-run — 아무것도 바꾸지 않았다\n'); return }
  if (plan.busy.length > 0) die('실행 중 회차가 있다')
  if (readHandoff() !== null) die(`이미 ${LANE} handoff 표식이 있다 — ${handoffPath}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const r = runQuiesce(plan, {
    bootout: (l) => act('launchctl', ['bootout', `gui/${uid}/${l}`]),
    movePlist: (f) => { try { renameSync(join(SRC.agentDir, f), join(dir, f)); return true } catch { return false } },
    loadedAfter: () => { const x = ourJobs(); return x === null ? null : x.map((j) => j.label) },
  })
  const h = { lane: LANE, at: new Date().toISOString(), dir, loadedBefore: plan.bootout, plists: r.moved, bundleId: null }
  writeFileSync(handoffPath, `${JSON.stringify(h, null, 2)}\n`, { mode: 0o600 })
  if (!r.ok) die(`D100 이 완전히 내려가지 않았다 — ${r.residual.join(' · ')}. unquiesce --apply 로 되돌린다`)
  say(`\n✅ 원 호스트 D100 내림 완료 — 매거진·개발 job 은 그대로다. 다음: export --cutover --out=<dir>\n`)
}

function cmdUnquiesce(): void {
  const uid = process.getuid?.() ?? 0
  const h = readHandoff()
  say(`\n══ 원 호스트 되살리기 (${LANE} 레인만) — ${APPLY ? '🔴 실제 적용' : 'dry-run'} ══`)
  if (h === null) die(`${LANE} handoff 표식이 없다 — ${handoffPath}`)
  const g = judgeUnquiesce({ handoffBundleId: h!.bundleId, givenBundleId: opt('bundle-id') })
  for (const f of lanePlistFiles(h!.plists)) say(`   ${join(h!.dir, f)} → ${SRC.agentDir}`)
  for (const l of h!.loadedBefore.filter(isLaneLabel)) say(`   launchctl bootstrap gui/${uid} ${join(SRC.agentDir, plistFileOf(l))}`)
  if (!g.ok) say(`   🔴 ${g.problems.join(' · ')}`)
  if (!APPLY) { say('\n   dry-run — 아무것도 바꾸지 않았다\n'); return }
  if (!g.ok || FIXTURE) die('적용하지 않는다')
  const r = runUnquiesce(h!, {
    restorePlist: (f) => { try { renameSync(join(h!.dir, f), join(SRC.agentDir, f)); return true } catch { return false } },
    bootstrap: (l) => act('launchctl', ['bootstrap', `gui/${uid}`, join(SRC.agentDir, plistFileOf(l))]),
  })
  renameSync(handoffPath, join(SRC.canonDir, `host-handoff-${LANE}.undone-${Date.now()}.json`))
  if (!r.ok) die(`남은 것 ${r.residual.join(' · ')}`)
  say('\n✅ 원 호스트 D100 되살림 — npm run runtime:isolation-check -- --require-runtime 로 확인한다\n')
}

switch (CMD) {
  case 'plan': cmdPlan(); break
  case 'export': cmdExport(); break
  case 'verify': cmdVerify(); break
  case 'install': await cmdInstall(); break
  case 'rollback': cmdRollback(); break
  case 'quiesce': cmdQuiesce(); break
  case 'unquiesce': cmdUnquiesce(); break
  default: die(`모르는 명령 ${CMD} — plan · export · verify · install · rollback · quiesce · unquiesce`, 2)
}
