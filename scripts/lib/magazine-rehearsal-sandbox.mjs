/**
 * 🔴 **rehearsal 임시 루트를 만든다** (2026-10-10).
 *
 *    <루트>/
 *      repo/        이 저장소의 작업 트리 사본 + runtime 의 큐·원고·run 자료·articles.ts·hero 이미지 (읽기만 해서 복사)
 *      origin.git/  임시 bare origin — push·merge 는 여기에만 닿는다
 *      home/        HOME (장부·잠금·lease·Slack 설정·git 설정 전부 여기)
 *      tmp/         TMPDIR
 *      bin/         claude·gh·git·curl·vercel fixture (magazine-rehearsal-bin.mjs)
 *      fixture/     시나리오 · GitHub 상태 · 호출 기록
 *      guard/       경계 기록 (쓰기·네트워크·외부 명령 위반)
 *      logs/        단계별 출력
 *
 * 🔴 runtime 은 **읽기만** 한다. 이 모듈은 runtime 경로에 쓰는 코드가 없다 — 복사는 runtime → 루트 한 방향이다.
 * 🔴 runtime 에서 추적되지 않는 파일은 루트 저장소에서도 추적하지 않는다 (producer 의 DIRTY_TREE · PR 파일 판정이 운영과 같게).
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const REAL_GIT = '/usr/bin/git'
export const FAKE_SLACK_HOOK = 'https://hooks.slack.com/services/REHEARSAL/FIXTURE/0000'
/** runtime 에서 rehearsal 로 복사하는 자료 — 이 밖은 runtime 에서 읽지 않는다 */
export const RUNTIME_DATA = Object.freeze(['drafts/magazine', 'src/content/magazine/articles.ts', 'public/magazine'])
const SHIMS = ['claude', 'gh', 'git', 'curl', 'vercel']

function git(args, cwd, { allowFail = false } = {}) {
  const r = spawnSync(REAL_GIT, args, { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } })
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} (${cwd}) 실패: ${r.stderr}`)
  return (r.stdout ?? '').trim()
}

/**
 * @param {{source:string, runtime:string, label:string, base?:string, prepare?:(repo:string)=>Promise<object>}} p
 *   prepare 시나리오 자료 다듬기 — 기준 커밋 **전에** 돈다 (다듬은 모양이 곧 그 회차의 main 이다)
 *   source  이 저장소 작업 트리 (코드)
 *   runtime magazine runtime (자료 · 읽기 전용)
 */
export async function buildSandbox({ source, runtime, label, base = tmpdir(), prepare = null }) {
  const root = realpathSync(mkdtempSync(join(base, `magazine-rehearsal-${label}-`)))
  const repo = join(root, 'repo')
  for (const d of ['repo', 'home', 'tmp', 'bin', 'fixture', 'guard', 'logs']) mkdirSync(join(root, d), { recursive: true })

  // ── 코드: 이 저장소 작업 트리 (추적 + 미추적 비무시) ──
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], source).split('\0').filter(Boolean)
  for (const f of files) {
    const from = join(source, f)
    if (!existsSync(from)) continue
    mkdirSync(dirname(join(repo, f)), { recursive: true })
    cpSync(from, join(repo, f), { dereference: false })
  }
  symlinkSync(join(source, 'node_modules'), join(repo, 'node_modules'))

  // ── 자료: runtime (읽기 전용 복사) ──
  const runtimeHead = git(['rev-parse', 'HEAD'], runtime)
  const untracked = new Set(git(['ls-files', '-z', '--others', '--exclude-standard', '--', ...RUNTIME_DATA], runtime).split('\0').filter(Boolean))
  for (const rel of RUNTIME_DATA) {
    const from = join(runtime, rel)
    if (!existsSync(from)) continue
    rmSync(join(repo, rel), { recursive: true, force: true })
    mkdirSync(dirname(join(repo, rel)), { recursive: true })
    cpSync(from, join(repo, rel), { recursive: true, dereference: false })
  }

  const prepared = prepare ? await prepare(repo) : null

  // ── git: 기준 커밋 · runtime 미추적은 미추적으로 ──
  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.name', 'rehearsal'], repo)
  git(['config', 'user.email', 'rehearsal@invalid'], repo)
  git(['config', 'commit.gpgsign', 'false'], repo)
  git(['add', '-A'], repo)
  for (const f of untracked) git(['rm', '-q', '--cached', '--ignore-unmatch', '--', f], repo, { allowFail: true })
  git(['commit', '-q', '-m', `rehearsal baseline (code ${git(['rev-parse', '--short', 'HEAD'], source)} · data ${runtimeHead.slice(0, 7)})`], repo)
  git(['clone', '-q', '--bare', repo, join(root, 'origin.git')], root)
  git(['remote', 'add', 'origin', join(root, 'origin.git')], repo)
  git(['fetch', '-q', 'origin'], repo)
  git(['branch', '-q', '--set-upstream-to', 'origin/main', 'main'], repo)

  // ── HOME: Slack 설정(가짜 hook) · git 설정 ──
  mkdirSync(join(root, 'home', '.config', 'soransoran'), { recursive: true })
  writeFileSync(join(root, 'home', '.config', 'soransoran', 'slack.env'), `SLACK_WEBHOOK_URL=${FAKE_SLACK_HOOK}\n`, { mode: 0o600 })
  writeFileSync(join(root, 'home', '.gitconfig'), '[user]\n\tname = rehearsal\n\temail = rehearsal@invalid\n[commit]\n\tgpgsign = false\n')

  // ── fixture 실행 파일 ──
  const dispatch = join(repo, 'scripts', 'lib', 'magazine-rehearsal-bin.mjs')
  for (const name of SHIMS) {
    const f = join(root, 'bin', name)
    writeFileSync(f, `#!/bin/sh\nexec "${process.execPath}" "${dispatch}" ${name} "$@"\n`)
    chmodSync(f, 0o755)
  }
  writeFileSync(join(root, 'fixture', 'github.json'), `${JSON.stringify({ nextPr: 1000, prs: [], nextDeployment: 1, deployments: [] }, null, 2)}\n`)
  writeFileSync(join(root, 'fixture', 'calls.jsonl'), '')
  return { root, repo, origin: join(root, 'origin.git'), runtimeHead, baseline: git(['rev-parse', 'HEAD'], repo), files: files.length, untracked: untracked.size, prepared }
}

/** 단계 하나의 환경 — 🔴 사용자 환경을 물려받지 않는다 (토큰·webhook·운영 경로가 새지 않게) */
export function stageEnv({ root, clock }) {
  const repo = join(root, 'repo')
  return {
    // 🔴 node 는 지금 이 프로세스의 node 하나만 (가드가 process.execPath 와 같은지 본다)
    PATH: `${join(root, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(root, 'home'),
    TMPDIR: join(root, 'tmp'),
    LANG: 'ko_KR.UTF-8',
    NODE_OPTIONS: `--import=${pathToFileURL(join(repo, 'scripts', 'lib', 'magazine-rehearsal-guard.mjs')).href}`,
    SORAN_REHEARSAL_ROOT: root,
    SORAN_REHEARSAL_CLOCK: `${clock.fakeMs}:${clock.realMs}:${clock.speed}`,
    SORAN_REHEARSAL_REAL_GIT: REAL_GIT,
    SORAN_REHEARSAL_SLACK_HOOK: FAKE_SLACK_HOOK,
    SORAN_MAGAZINE_TEST_MODE: '1',
    SORAN_MAGAZINE_TEST_FIXTURE: join(repo, 'scripts', 'lib', 'magazine-rehearsal-chatgpt.mjs'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'home', '.gitconfig'),
    GIT_TERMINAL_PROMPT: '0',
  }
}

/** 경계 기록 — 위반 · 네트워크 시도 · 외부 명령 · Slack */
export function readGuard(root) {
  const dir = join(root, 'guard')
  const events = []
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) if (line.trim()) { try { events.push(JSON.parse(line)) } catch { events.push({ kind: 'UNPARSEABLE', line }) } }
  }
  return events
}

export function readCalls(root) {
  return readFileSync(join(root, 'fixture', 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

export { git as sandboxGit }
