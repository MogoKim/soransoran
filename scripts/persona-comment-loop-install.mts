#!/usr/bin/env tsx
/**
 * 무인 Persona 댓글 루프 **launchd 설치** — 🔴 기본은 계획만(변경 0). `--apply` 만 실제로 바꾼다.
 *
 * 🔴 **runtime worktree 에서만 설치한다.** 기대 원문은 그 트리의 템플릿(`renderCommentRunnerPlist`)이고,
 *    격리 검사(`runtime:isolation-check -- --require-runtime`)도 **같은 트리의 같은 함수**로 대조한다.
 *    개발 트리에서 설치하면 예약 회차가 그 순간 checkout 된 브랜치 코드로 돈다 — 그래서 거절한다.
 *
 * 🔴 `--apply` 가 하는 일(되돌릴 수 있는 순서):
 *      render → 남은 placeholder 0 확인 → LaunchAgents 에 임시 파일 후 rename → `plutil -lint`
 *      → `launchctl bootout`(이미 있으면) → `launchctl bootstrap` → `launchctl print` 로 인자·WD 대조
 *    🔴 RunAtLoad 는 false 다 — 올리는 순간 돌지 않는다. 첫 회차는 다음 예약 시각이다.
 *
 * 🔴 설치해도 단계가 `bootstrap-auto` 가 아니면 매 회차 provider 0 · write 0 으로 끝난다 —
 *    멈추는 가장 빠른 방법은 plist 가 아니라 `SORAN_PERSONA_COMMENT_STAGE` 를 내리는 것이다.
 *
 *   (runtime 에서) npm run persona:comment-loop-install              계획만
 *   (runtime 에서) npm run persona:comment-loop-install -- --apply   🔴 실제 설치
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { leftoverPlaceholders, programArguments, readInstalled, writeInstalled } from './lib/launchd-install.mjs'
import { parseLaunchctlPrint } from '../src/lib/runtime-isolation'
import {
  COMMENT_RUNNER_LABEL, COMMENT_RUNNER_SCRIPT, renderCommentRunnerPlist,
} from './lib/persona-comment-runner-template'

const APPLY = process.argv.includes('--apply')
const RUNTIME_ROOT = join(homedir(), 'Documents', 'soransoran-runtime')
const AGENT_DIR = join(homedir(), 'Library', 'LaunchAgents')
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'soransoran')
const PINNED_SHA_FILE = join(homedir(), 'Library', 'Application Support', 'soransoran', 'runtime-pinned-sha')

const run = (cmd: string, args: readonly string[], cwd?: string): { ok: boolean; out: string } => {
  try {
    return { ok: true, out: execFileSync(cmd, [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  } catch (e) {
    const x = e as { stdout?: string | Buffer; stderr?: string | Buffer }
    return { ok: false, out: `${String(x.stdout ?? '')}${String(x.stderr ?? '')}`.trim() }
  }
}
const real = (p: string): string | null => { try { return realpathSync(p) } catch { return null } }

function main(): number {
  console.log(`\n══ 댓글 루프 launchd 설치 — ${APPLY ? '🔴 실제 적용' : '계획만 (변경 0)'} ══\n`)
  const problems: string[] = []

  // ① runtime 트리에서 돌고 있는가
  const cwd = real(process.cwd())
  const rt = real(RUNTIME_ROOT)
  if (rt === null) problems.push(`runtime worktree 가 없다 — ${RUNTIME_ROOT}`)
  else if (cwd !== rt) problems.push(`runtime 트리에서 실행해야 한다 — 지금 ${process.cwd()}`)

  // ② runtime HEAD = 고정 SHA · 실행 스크립트가 그 SHA 에 추적된다
  const head = run('git', ['rev-parse', 'HEAD'], RUNTIME_ROOT)
  const pinned = run('cat', [PINNED_SHA_FILE])
  if (!head.ok) problems.push('runtime HEAD 를 읽지 못했다')
  else if (!pinned.ok || pinned.out !== head.out) problems.push(`runtime HEAD ${head.out.slice(0, 7)} 가 고정 SHA 와 다르다 — runtime:deploy 먼저`)
  if (head.ok && !run('git', ['cat-file', '-e', `${head.out}:${COMMENT_RUNNER_SCRIPT}`], RUNTIME_ROOT).ok) {
    problems.push(`${COMMENT_RUNNER_SCRIPT} 가 runtime HEAD 에 없다 — 이 코드가 든 SHA 로 배포하지 않았다`)
  }

  // ③ render — 격리 검사와 같은 입력(runtime 루트 · 지금 node 의 npx · Documents 밖 로그)
  const npxPath = join(dirname(process.execPath), 'npx')
  const xml = renderCommentRunnerPlist({
    runtimeRoot: RUNTIME_ROOT, npxPath, nodeBinDir: dirname(npxPath), logDir: LOG_DIR,
  })
  const left = leftoverPlaceholders(xml)
  if (left.length > 0) problems.push(`치환되지 않은 placeholder ${left.join(' ')}`)
  if (!existsSync(npxPath)) problems.push(`npx 가 없다 — ${npxPath}`)
  const current = readInstalled(AGENT_DIR, COMMENT_RUNNER_LABEL)
  console.log(`  label     ${COMMENT_RUNNER_LABEL}`)
  console.log(`  실행      ${npxPath} tsx ${RUNTIME_ROOT}/${COMMENT_RUNNER_SCRIPT} --live`)
  console.log(`  설치본    ${current === null ? '없음' : current === xml ? '최신' : '옛 내용 — 교체한다'}`)
  for (const p of problems) console.log(`  🔴 ${p}`)

  if (!APPLY) {
    console.log(`\n🟡 계획만 — 실제 설치는 --apply${problems.length > 0 ? ` (지금은 막힌 것 ${problems.length}건)` : ''}\n`)
    return problems.length === 0 ? 0 : 1
  }
  if (problems.length > 0) { console.log('\n🔴 중단 — 아무것도 바꾸지 않았다\n'); return 1 }

  mkdirSync(LOG_DIR, { recursive: true })
  if (!writeInstalled(AGENT_DIR, COMMENT_RUNNER_LABEL, xml)) { console.log('🔴 plist 를 쓰지 못했다'); return 1 }
  const plistPath = join(AGENT_DIR, `${COMMENT_RUNNER_LABEL}.plist`)
  const lint = run('plutil', ['-lint', plistPath])
  if (!lint.ok) { console.log(`🔴 plutil -lint 실패 — ${lint.out}`); return 1 }
  const domain = `gui/${process.getuid?.() ?? 0}`
  run('launchctl', ['bootout', `${domain}/${COMMENT_RUNNER_LABEL}`])
  const boot = run('launchctl', ['bootstrap', domain, plistPath])
  if (!boot.ok) { console.log(`🔴 launchctl bootstrap 실패 — ${boot.out}`); return 1 }
  const printed = run('launchctl', ['print', `${domain}/${COMMENT_RUNNER_LABEL}`])
  const cfg = parseLaunchctlPrint(printed.ok ? printed.out : null)
  const wantArgs = programArguments(xml)
  const argsOk = cfg.readable && JSON.stringify(cfg.args) === JSON.stringify(wantArgs)
  const wdOk = cfg.readable && cfg.workingDirectory === RUNTIME_ROOT
  console.log(`  🟢 설치 · lint · bootstrap 완료`)
  console.log(`  ${argsOk ? '🟢' : '🔴'} loaded 인자 = 설치본 인자`)
  console.log(`  ${wdOk ? '🟢' : '🔴'} WorkingDirectory = runtime`)
  console.log('\n  다음: npm run runtime:isolation-check -- --require-runtime\n')
  return argsOk && wdOk ? 0 : 1
}

process.exit(main())
