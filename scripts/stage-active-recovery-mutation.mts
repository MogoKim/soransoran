#!/usr/bin/env tsx
/**
 * 단계 제한 복구 변이 시험 (2026-11-05)
 *
 *   npx tsx scripts/stage-active-recovery-mutation.mts
 *
 * 보호 단언을 하나씩 지운 코드로 `stage-active-recovery-check`를 다시 돌려 **FAIL로 잡는지** 본다.
 * 🔴 작업 트리를 고치지 않는다. `src`·`scripts`를 임시 디렉터리로 복사하고 그 사본만 바꾼다.
 *    `node_modules`는 이 작업 트리의 것을 가리키는 링크다(설치·생성·build 0).
 * 🔴 잡았다 = 종료 1 + 검사 줄 `  FAIL`. 로드·문법 실패(FAIL 줄 없음)는 잡은 것이 아니다.
 * 🔴 변이마다 사본을 원본 바이트로 되돌려 해시를 대조하고, 끝에 작업 트리 대상 파일 해시가 그대로인지 다시 본다.
 * DB·네트워크·launchctl·provider 0.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type Mutation = { name: string; file: string; find: string; replace: string }

const MUTATIONS: Mutation[] = [
  {
    name: 'done/failed intent를 중간 슬롯에서 즉시 결정한다(F1 회귀)',
    file: 'src/lib/stage-active-recovery.ts',
    find: "  if (a.state === 'requested' || a.state === 'running') {\n",
    replace: "  if (a.state === 'done' || a.state === 'failed') return { kind: 'decide-now' }\n"
      + "  if (a.state === 'requested' || a.state === 'running') {\n",
  },
  {
    name: '건강 판정이 손상된 recovery 유사 tag까지 recovery로 빼 준다(permissive exclusion 회귀)',
    file: 'src/lib/job-health.ts',
    find: "    ? 'recovery-like-malformed' : 'other'",
    replace: "    ? 'valid-recovery' : 'other'",
  },
  {
    name: '장부 recovery 회차 ⊆ claim 이 아니라 = claim 을 요구한다(subset→equality 회귀)',
    file: 'scripts/lib/stage-preflight-facts.mts',
    find: '  const outside = [...runs].filter((run) => run !== input.claimRunId)\n',
    replace: "  const outside = runs.size === 0 && input.claimRunId !== null ? ['(장부 없음)']\n"
      + '    : [...runs].filter((run) => run !== input.claimRunId)\n',
  },
  {
    name: '중간 슬롯이 recovery 비용을 cohort에 넣는다(자기 취소 회귀)',
    file: 'scripts/lib/stage-controller-recovery-step.mts',
    find: "  if (!mode.final) return { kind: 'known', claimRunId, includeCost: false }\n",
    replace: "  if (!mode.final) return { kind: 'known', claimRunId, includeCost: true }\n",
  },
  {
    name: '파싱이 깨진 intent를 없음으로 읽는다(손상→absent 회귀)',
    file: 'scripts/lib/stage-recovery-intent.mts',
    find: "  if (intent === null) return { kind: 'corrupt', reason: 'intent 형식이 계약과 다르다' }\n",
    replace: "  if (intent === null) return { kind: 'absent' }\n",
  },
]

const ROOT = process.cwd()
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const targets = [...new Set(MUTATIONS.map((m) => m.file))]
const WORKTREE_HASH = new Map(targets.map((f) => [f, sha(readFileSync(join(ROOT, f), 'utf-8'))]))

const sandbox = mkdtempSync(join(tmpdir(), 'soran-stage-recovery-mutation-'))
const cleanup = (): void => { rmSync(sandbox, { recursive: true, force: true }) }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { cleanup(); process.exit(130) })

let exitCode = 0
try {
  for (const dir of ['src', 'scripts']) cpSync(join(ROOT, dir), join(sandbox, dir), { recursive: true })
  for (const f of ['package.json', 'tsconfig.json', 'tsconfig.ops.json']) copyFileSync(join(ROOT, f), join(sandbox, f))
  symlinkSync(resolve(ROOT, 'node_modules'), join(sandbox, 'node_modules'), 'dir')

  const ORIGINAL = new Map(targets.map((f) => [f, readFileSync(join(sandbox, f), 'utf-8')]))
  const restore = (): void => { for (const [f, s] of ORIGINAL) writeFileSync(join(sandbox, f), s) }
  const runCheck = (): { status: number | null; fails: string[] } => {
    const r = spawnSync(process.execPath, [...process.execArgv, join(sandbox, 'scripts/stage-active-recovery-check.mts')], {
      cwd: sandbox, encoding: 'utf-8', timeout: 600_000,
    })
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
    return { status: r.status, fails: text.split('\n').filter((l) => l.startsWith('  FAIL ')).map((l) => l.trim()) }
  }

  const baseline = runCheck()
  if (baseline.status !== 0 || baseline.fails.length > 0) {
    console.error(`🔴 변이 전 기준 검사부터 실패한다 — exit ${baseline.status} ${baseline.fails.slice(0, 3).join(' | ')}`)
    exitCode = 2
  } else {
    console.log('✅ 기준: 변이 전 사본에서 stage-active-recovery-check 통과')
    for (const m of MUTATIONS) {
      const original = ORIGINAL.get(m.file)!
      const count = original.split(m.find).length - 1
      if (count !== 1) {
        console.error(`🔴 변이 지점이 정확히 한 번이 아니다(${count}회) — ${m.name} · ${m.file}`)
        exitCode = 2
        continue
      }
      writeFileSync(join(sandbox, m.file), original.replace(m.find, m.replace))
      const r = runCheck()
      restore()
      const restored = sha(readFileSync(join(sandbox, m.file), 'utf-8')) === sha(original)
      const caught = r.status === 1 && r.fails.length > 0
      console.log(`${caught ? '✅ 잡았다' : '🔴 놓쳤다'} — ${m.name}`)
      if (caught) console.log(`     ${r.fails[0]}`)
      else console.log(`     exit ${r.status} · FAIL 줄 ${r.fails.length}`)
      if (!restored) { console.error(`🔴 사본 원복 실패 — ${m.file}`); exitCode = 2 }
      if (!caught && exitCode === 0) exitCode = 1
    }
  }
} finally {
  cleanup()
}

const untouched = targets.every((f) => sha(readFileSync(join(ROOT, f), 'utf-8')) === WORKTREE_HASH.get(f))
if (!untouched) {
  console.error('🔴 작업 트리 대상 파일 해시가 바뀌었다 — 이 하네스는 작업 트리를 고치면 안 된다')
  exitCode = 2
} else {
  console.log(`✅ 작업 트리 대상 ${targets.length}개 파일 해시 불변 · 임시 사본 삭제`)
}
console.log(`\nstage active recovery mutation: ${exitCode === 0 ? `${MUTATIONS.length}/${MUTATIONS.length} 잡음` : '실패'}`)
process.exit(exitCode)
