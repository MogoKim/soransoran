#!/usr/bin/env tsx
/**
 * 매거진 launchd 설치 — 🔴 **기본은 dry-run. `--apply` 만 실제로 바꾼다.**
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 **왜 이 스크립트가 생겼나** (2026-09-15 장애).
 *
 *    옛 설치 절차는 `ln -s` 한 줄이었다. `~/Library/LaunchAgents` 에
 *    `~/Documents/soransoran/launchd/*.plist` 를 가리키는 symlink 를 두는 방식이다.
 *    macOS 의 Documents 접근 보호(TCC)가 `smd` 의 plist 읽기를 거부한다:
 *
 *      kernel [com.apple.sandbox.reporting:violation]
 *      System Policy: smd(…) deny(1) file-read-data
 *      /Users/…/Documents/soransoran/launchd/com.soransoran.magazine-producer.plist
 *
 *    읽지 못하니 서비스 등록 자체가 되지 않는다. 2026-09-03 재부팅 이후 두 job 이
 *    12일간 한 번도 돌지 않았고, 로그가 없으니 아무도 몰랐다.
 *    같은 기계의 D100 job 4개는 **실제 파일**로 깔려 있어 정상이었다 —
 *    그 패턴을 그대로 따른다 (`lib/launchd-install.mts`).
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 **이 스크립트는 `launchctl` 을 부르지 않는다.** 파일만 놓는다.
 *    bootstrap 은 사람이 runbook 을 보고 한다 —
 *    "설치" 와 "가동" 을 한 명령으로 묶으면 되돌릴 자리가 없어진다.
 *
 * 🔴 **supervised 영수증 없이는 --apply 를 받지 않는다.**
 *    경영 결정(2026-09-15)으로 "5일 관찰" 은 폐기됐고, 활성화 게이트는
 *    **supervised 1회 end-to-end 성공**이다. 그 증거가 없으면 설치하지 않는다.
 *    영수증: ~/Library/Application Support/soransoran/magazine-supervised-run.json
 *
 * 🔴 **퇴역 plist 는 지우지 않고 옮긴다.** 옛 symlink 도 마찬가지다 —
 *    보관소에 넣어 두어야 되돌릴 수 있다.
 *
 * 사용법
 *   npm run magazine:launchd-install              계획만 (변경 0)
 *   npm run magazine:launchd-install -- --apply   🔴 실제 설치
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  leftoverPlaceholders, plistFileOf, readInstalled, render, retireInstalled,
  rollbackDirOf, templatePathOf, writeInstalled,
} from './lib/launchd-install.mjs'

/** 🔴 매거진 전용 runtime worktree — D100 의 soransoran-runtime 과 **다른 저장소**다 */
export const MAGAZINE_RUNTIME = join(homedir(), 'Documents', 'soransoran-magazine-runtime')

/**
 * 🔴 **매거진 템플릿은 하위 디렉터리에 둔다.**
 *    `docs/operations/launchd/` 최상단은 D100 공급 레인의 자리다.
 *    `launchd-template-check.mts` 가 그 디렉터리를 훑어 "템플릿이 6개다 · 검사표가
 *    전부를 덮는다" 를 단언한다 — 매거진 것을 같이 두면 그 검사가 깨지고,
 *    매거진 job 이 D100 runtime 의 배포·격리 검사 대상인 것처럼 읽힌다.
 *    두 레인은 서로의 배포에 묶이지 않는다.
 */
export const MAGAZINE_TEMPLATE_DIR = join('docs', 'operations', 'launchd', 'magazine')

/** 🔴 예약 실행이 절대 물으면 안 되는 곳 — 개발 작업트리 */
export const FORBIDDEN_ROOTS = [
  join(homedir(), 'Documents', 'soransoran'),
  join(homedir(), 'Documents', 'soransoran-m0'),
  join(homedir(), 'Documents', 'soransoran-runtime'),
]

export const MAGAZINE_JOBS = [
  'com.soransoran.magazine-producer',
  'com.soransoran.magazine-auto-register',
] as const

const CANON_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
const AGENT_DIR = join(homedir(), 'Library', 'LaunchAgents')
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'soransoran')
const ROLLBACK_DIR = rollbackDirOf(CANON_DIR)

/** supervised 1회 실행 영수증 — 이것이 활성화 게이트다 */
export const SUPERVISED_RECEIPT = join(CANON_DIR, 'magazine-supervised-run.json')

/**
 * launchd 가 쓸 PATH.
 *
 * 🔴 **`/opt/homebrew/bin` 이 반드시 들어간다.** `gh` 가 거기에만 있다.
 *    빠지면 PR 생성이 ENOENT 로 죽는데, 옛 순서에서는 그 사실을 push 뒤에 알았다.
 * 🔴 `~/.local/bin` 은 `claude` 다. 빠지면 producer 의 brief 생성이 통째로 죽는다.
 * 🔴 한 줄로 조립해 **한 번에** 치환한다 — 조각으로 두면 설치기마다 순서가 달라진다.
 */
export function launchdPath(nodebin: string, home: string = homedir()): string {
  return [
    join(home, '.local', 'bin'),
    nodebin,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':')
}

/**
 * runtime worktree 가 예약 실행에 쓸 수 있는 상태인가. **파일을 만지지 않는다.**
 *
 * 🔴 개발 작업트리를 가리키면 그날 누가 브랜치를 바꿨는지에 따라 결과가 달라진다.
 *    진단 시점의 대상 저장소는 `fix/write-guest-start-flow` 였다.
 */
export function judgeRuntime(
  { exists, branch, dirty, root }: { exists: boolean; branch: string | null; dirty: boolean; root: string },
): { ok: boolean; blockedBy: { code: string; message: string }[] } {
  const blockedBy: { code: string; message: string }[] = []
  const block = (code: string, message: string) => blockedBy.push({ code, message })

  if (FORBIDDEN_ROOTS.includes(root)) {
    block('RUNTIME_IS_DEV_TREE', `${root} 는 개발 작업트리다 — 예약 실행이 물면 안 된다`)
    return { ok: false, blockedBy }
  }
  if (!exists) {
    block('RUNTIME_MISSING', `runtime worktree 가 없다 — ${root}`)
    return { ok: false, blockedBy }
  }
  if (branch !== 'main') block('RUNTIME_NOT_ON_MAIN', `runtime 이 ${branch ?? '?'} 다 — main 이어야 한다`)
  if (dirty) block('RUNTIME_DIRTY', 'runtime 에 추적 변경이 있다 — 깨끗해야 한다')
  return { ok: blockedBy.length === 0, blockedBy }
}

/** supervised 영수증이 쓸 수 있는 모양인가 */
export function judgeReceipt(raw: unknown): { ok: boolean; message: string } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, message: 'supervised 실행 영수증이 없다 — 1회 end-to-end 성공이 활성화 게이트다' }
  }
  const r = raw as Record<string, unknown>
  if (r.result !== 'SUCCESS') return { ok: false, message: `영수증의 result 가 ${String(r.result)} 다 — SUCCESS 여야 한다` }
  if (typeof r.prUrl !== 'string' || !r.prUrl.startsWith('https://github.com/')) {
    return { ok: false, message: '영수증에 PR URL 이 없다 — PR 이 실제로 열린 회차여야 한다' }
  }
  if (typeof r.ranAt !== 'string') return { ok: false, message: '영수증에 ranAt 이 없다' }
  return { ok: true, message: `supervised 성공 확인 (${r.ranAt} · ${r.prUrl})` }
}

// ─────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')

const read = (cmd: string, args: readonly string[], cwd: string): string | null => {
  try {
    return execFileSync(cmd, [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}

function main(): void {
  console.log(`\n══ 매거진 launchd 설치 — ${APPLY ? '🔴 실제 적용' : 'dry-run (변경 0)'} ══\n`)
  console.log(`  runtime   ${MAGAZINE_RUNTIME}`)
  console.log(`  agents    ${AGENT_DIR}`)
  console.log(`  logs      ${LOG_DIR}`)

  let failed = 0
  const fail = (m: string) => { console.log(`  🔴 ${m}`); failed += 1 }
  const ok = (m: string) => console.log(`  🟢 ${m}`)

  // ── ① runtime worktree ──────────────────────────────────
  const exists = existsSync(MAGAZINE_RUNTIME)
  const branch = exists ? read('git', ['rev-parse', '--abbrev-ref', 'HEAD'], MAGAZINE_RUNTIME) : null
  const dirty = exists ? Boolean(read('git', ['status', '--porcelain', '--untracked-files=no'], MAGAZINE_RUNTIME)) : false
  const runtime = judgeRuntime({ exists, branch, dirty, root: MAGAZINE_RUNTIME })
  console.log('\n── runtime worktree')
  if (runtime.ok) ok(`main · 깨끗함`)
  else {
    for (const b of runtime.blockedBy) fail(`${b.code}: ${b.message}`)
    if (!exists) {
      console.log('\n     만드는 법 (사람이 한 번 한다):')
      console.log(`       git -C ${join(homedir(), 'Documents', 'soransoran')} worktree add ${MAGAZINE_RUNTIME} main`)
    }
  }

  // ── ② supervised 영수증 ─────────────────────────────────
  console.log('\n── 활성화 게이트 — supervised 1회 end-to-end 성공')
  let receipt: unknown = null
  try { receipt = JSON.parse(readFileSync(SUPERVISED_RECEIPT, 'utf-8')) } catch { receipt = null }
  const gate = judgeReceipt(receipt)
  if (gate.ok) ok(gate.message)
  else fail(`${gate.message}\n       영수증 자리: ${SUPERVISED_RECEIPT}`)

  // ── ③ 템플릿 렌더 ───────────────────────────────────────
  console.log('\n── plist')
  const nodebin = dirname(process.execPath)
  const vars = {
    npx: process.execPath.replace(/\/node$/, '/npx'),
    node: process.execPath,
    nodebin,
    repo: MAGAZINE_RUNTIME,
    logdir: LOG_DIR,
    extra: { __PATH__: launchdPath(nodebin), __HOME__: homedir() },
  }

  const rendered = new Map<string, string>()
  for (const label of MAGAZINE_JOBS) {
    const tpl = templatePathOf(label, MAGAZINE_TEMPLATE_DIR)
    if (!existsSync(tpl)) { fail(`템플릿이 없다: ${tpl}`); continue }
    const xml = render(readFileSync(tpl, 'utf-8'), vars)
    const left = leftoverPlaceholders(xml)
    if (left.length > 0) { fail(`${label}: 치환되지 않은 placeholder ${left.join(' ')}`); continue }
    rendered.set(label, xml)

    const installedPath = join(AGENT_DIR, plistFileOf(label))
    const isSymlink = existsSync(installedPath) && lstatSync(installedPath).isSymbolicLink()
    const current = readInstalled(AGENT_DIR, label)
    const state = isSymlink ? '🔴 symlink (TCC 로 읽히지 않는다)' : current === null ? '없음' : current === xml ? '최신' : '옛 내용'
    console.log(`  · ${label} — 설치본: ${state}`)
  }

  // ── ④ 적용 ──────────────────────────────────────────────
  if (!APPLY) {
    console.log(`\n🟡 적용하지 않는다 — dry-run. 실제 설치는 --apply${failed ? ` (지금은 막힌 것 ${failed}건)` : ''}\n`)
    process.exit(failed === 0 ? 0 : 1)
  }
  if (failed > 0) {
    console.log(`\n🔴 중단 — 막힌 것 ${failed}건. 아무것도 설치하지 않았다.\n`)
    process.exit(1)
  }

  mkdirSync(ROLLBACK_DIR, { recursive: true })
  mkdirSync(LOG_DIR, { recursive: true })
  console.log('\n── 설치')
  for (const [label, xml] of rendered) {
    const installedPath = join(AGENT_DIR, plistFileOf(label))
    // 🔴 옛 symlink 를 지우지 않고 보관소로 옮긴다. 되돌릴 수 있어야 한다.
    if (existsSync(installedPath) && lstatSync(installedPath).isSymbolicLink()) {
      if (retireInstalled(AGENT_DIR, ROLLBACK_DIR, label)) ok(`${label}: 옛 symlink 를 보관소로 옮겼다`)
      else { fail(`${label}: symlink 를 옮기지 못했다`); continue }
    }
    if (writeInstalled(AGENT_DIR, label, xml)) ok(`${label}: 실제 파일로 설치했다`)
    else fail(`${label}: 설치하지 못했다`)
  }

  console.log('\n🟢 파일 설치 완료. 🔴 아직 가동되지 않았다.')
  console.log('   bootstrap 은 사람이 한다 — docs/operations/magazine-automation-runbook.md §가동\n')
  process.exit(failed === 0 ? 0 : 1)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-launchd-install.mts')) main()
