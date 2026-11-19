#!/usr/bin/env tsx
/**
 * 🔴 **사다리 정책 — 변이 시험** (2026-11-19 사다리 재설계)
 *
 *   npx tsx scripts/ladder-policy-mutation.mts
 *
 *   표의 숫자 한 칸 · 올림 조건 한 줄을 바꾸면 `ladder-policy-check` 가 반드시 FAIL 해야 한다.
 *   한 변이라도 살아남으면 exit 1. 판정 본체(수·결 통과선)의 변이는 `stage-evidence-followup-mutation` 이 든다.
 *
 * 🔴 worktree 를 고치지 않는다. `src` · `scripts` 를 OS 임시 디렉터리에 복사하고 나머지는 symlink 로 잇는다.
 * 🔴 먼저 변이 없는 사본이 PASS 하는지 본다 — 기준선이 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TABLE = 'src/lib/ladder-table.ts'
const LADDER = 'src/lib/stage-ladder.ts'
const CONTROLLER = 'src/lib/stage-controller.ts'
const CHECK = 'scripts/ladder-policy-check.mts'

type Mutation = { name: string; file: string; from: string; to: string }
const M = (name: string, file: string, from: string, to: string): Mutation => ({ name, file, from, to })
const MUTATIONS: Mutation[] = [
  // 표 — 숫자 한 칸
  M('수 통과선을 목표의 절반으로', TABLE, 'countRatio: 0.9,', 'countRatio: 0.5,'),
  M('하루 통과로 올림', TABLE, 'consecutiveDays: 2,', 'consecutiveDays: 1,'),
  M('첫 댓글 비율을 절반으로', TABLE, 'firstCommentRatio: 0.95,', 'firstCommentRatio: 0.5,'),
  M('첫 댓글 창을 처리 여유 10분으로', TABLE, 'FIRST_COMMENT_DELAY_MAX_MS + 60_000,', 'FIRST_COMMENT_DELAY_MAX_MS + 600_000,'),
  M('수집→공개를 막는 칸으로 켬', TABLE, 'gate: false as boolean', 'gate: true as boolean'),
  // 사다리 — 올림 조건
  M('다른 단계의 통과를 연속으로 셈', LADDER, 'if (d.kstDate !== expect || d.release !== open) break', 'if (d.kstDate !== expect) break'),
  M('통과가 아닌 날도 연속으로 셈', LADDER, "if (e === null || e.verdict !== 'PASS' || e.kstDate !== d.kstDate || e.stage !== d.release) break",
    'if (e === null || e.kstDate !== d.kstDate || e.stage !== d.release) break'),
  M('연속 통과 없이 올림', LADDER, '} else if (adjacentPrev === null || input.passDays < need) {', '} else if (adjacentPrev === null) {'),
  M('올라갈 칸 관문이 막아도 올림', LADDER, 'if (gate.length > 0) {', 'if (false) {'),
  // controller — 열린 단계와 브레이크
  M('배포 첫날 이틀 전 열린 단계를 되찾지 않음', CONTROLLER, 'return higher(held, openStageHeldBy(dayBefore))', 'return held'),
  M('낮춘 날 인증 칸을 쓰지 않음', CONTROLLER, "stageRank(certified) > stageRank(release) ? { kind: 'CERTIFIED', certified } : null", 'null'),
  M('브레이크가 감속하지 않음', CONTROLLER, 'const target = lower(planned.release, previousStage(sustained))', 'const target = planned.release'),
]

const dir = mkdtempSync(join(tmpdir(), 'ladder-policy-mut-'))
const run = (): { ok: boolean; tail: string } => {
  const r = spawnSync('npx', ['tsx', CHECK], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return { ok: r.status === 0, tail: out.trim().split('\n').slice(-1)[0] ?? '' }
}
let survived = 0
try {
  for (const e of readdirSync(root)) {
    if (e === 'src' || e === 'scripts' || e === '.git' || e === '.next') continue
    symlinkSync(join(root, e), join(dir, e))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })

  console.log('\n══ 사다리 정책 변이 시험 (worktree 변경 0) ══')
  const base = run()
  console.log(`  ${base.ok ? '✅' : '🔴'} 변이 없는 사본 — 정책 검사 ${base.ok ? 'PASS' : 'FAIL'} (${base.tail})`)
  if (!base.ok) throw new Error('하네스 기준선이 FAIL 이다 — 변이 시험이 아무것도 증명하지 않는다')
  for (const m of MUTATIONS) {
    const path = join(dir, m.file)
    const orig = readFileSync(path, 'utf-8')
    const n = orig.split(m.from).length - 1
    if (n !== 1) throw new Error(`변이 대상이 정확히 한 곳이 아니다(${n}) — ${m.name}`)
    writeFileSync(path, orig.replace(m.from, m.to))
    try {
      const r = run()
      if (r.ok) { survived += 1; console.log(`  🔴 살아남음 ${m.name}`) } else console.log(`  ✅ 잡힘 ${m.name}`)
    } finally {
      writeFileSync(path, orig)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${survived === 0 ? '✅' : '🔴'} 변이 ${MUTATIONS.length - survived}/${MUTATIONS.length} 잡힘`)
process.exit(survived === 0 ? 0 : 1)
