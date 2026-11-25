#!/usr/bin/env tsx
/**
 * 🔴 첫 댓글 회차 안 재시도(라운드 2) 변이 시험 — 2026-11-25 (D50 첫 댓글 10분)
 *
 *   npm run check:first-comment-retry-mutation
 *
 * 현재 worktree 를 고치지 않고 OS 임시 사본에서 방어를 하나씩 지운다(`comment-daily-cap-mutation` 과 같은 방식).
 * 문법·적재 오류는 검출로 세지 않고, 겨냥한 정본 검사(`persona-comment-loop-check`)가 판정 FAIL 을 남겨야 통과다.
 * 🔴 변이 자리가 정확히 1곳이 아니면(0곳 = 문장이 옮겨졌다) FAIL 이다 — 지점 0곳은 죽은 방어다.
 *
 * 지점:
 *   ① 라운드 2 제거 — 후보가 모두 관문에 막힌 글이 다음 회차(20분 뒤)를 기다린다
 *   ② 재시도 대상에서 "적재 0" 조건 제거 — 라운드 1 에서 적재된 글에도 다시 보낸다
 *   ③ 시도 기억 다시 읽기 제거 — 라운드 1 이 보낸 조합을 모르는 기억으로 후보를 만든다
 *   ④ 라운드 1 이 멈춘(stoppedReason) 회차에도 재시도한다
 *   ⑤ 남은 호출에서 라운드 1 사용분을 빼지 않는다 — 두 라운드 합이 회차 상한을 넘는다
 *   ⑥ 첫 댓글 회차 상한 기본값이 옛 6 으로 돌아간다(한 벌 + 재시도 한 벌이 들어가지 않는다)
 *   🟡 오늘 자리(`readiness.allowance.remaining`) 상한은 DB 가 필요해 격리 DB 검사(`persona:comment-loop-db-check` 반례③)가 본다
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOOP = 'scripts/lib/persona-comment-loop.mts'
const LANE = 'src/lib/persona-comment-auto-lane.ts'
const LOOP_CHECK = 'scripts/persona-comment-loop-check.mts'

type Mutation = { name: string; file: string; from: string; to: string; check: string }
const mutations: readonly Mutation[] = [
  {
    name: '① 라운드 2 제거 — 모두 막힌 글이 다음 회차를 기다린다',
    file: LOOP, from: '    if (retryPostIds.size > 0) {', to: '    if (false) {', check: LOOP_CHECK,
  },
  {
    name: '② 재시도 대상에서 "적재 0" 조건 제거 — 적재된 글에도 다시 보낸다',
    file: LOOP, from: '  return new Set([...blocked].filter((id) => !enqueuedPosts.has(id)))', to: '  return new Set([...blocked])', check: LOOP_CHECK,
  },
  {
    name: '③ 시도 기억 다시 읽기 제거 — 라운드 1 의 낡은 기억으로 후보를 만든다',
    file: LOOP, from: 'limit: retryCallLimit, entries: memory2.entries,', to: 'limit: retryCallLimit, entries: memory.entries,', check: LOOP_CHECK,
  },
  {
    name: '④ 라운드 1 이 멈춘 회차에도 재시도한다',
    file: LOOP, from: "      const skip = result.stoppedReason !== null ? '라운드 1 이 멈췄다'", to: "      const skip = false ? '라운드 1 이 멈췄다'", check: LOOP_CHECK,
  },
  {
    name: '⑤ 남은 호출에서 라운드 1 사용분을 빼지 않는다 — 두 라운드 합이 회차 상한을 넘는다',
    file: LOOP, from: 'Math.min(limit - result.providerCalls, ', to: 'Math.min(limit, ', check: LOOP_CHECK,
  },
  {
    name: '⑥ 첫 댓글 회차 상한 기본값이 옛 6 으로 돌아간다',
    file: LANE, from: 'export const COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT = 10', to: 'export const COMMENT_LOOP_RUN_REQUEST_CAP_DEFAULT = 6', check: LOOP_CHECK,
  },
]

// 🔴가 포함된 통과 항목 이름이 있으므로 단어 검색을 하면 거짓 검출이 된다.
// 정본 검사가 마지막에 남기는 `N pass · M fail` 집계에서 실제 실패 개수만 읽는다.
const FAIL_SUMMARY = /(?:✅|🔴)\s+\d+\s+pass\s+·\s+([1-9]\d*)\s+fail/m
const dir = mkdtempSync(join(tmpdir(), 'first-comment-retry-mut-'))
const run = (check: string): { code: number; judged: boolean; tail: string } => {
  const r = spawnSync('npx', ['tsx', check], {
    cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000,
  })
  const stdout = r.stdout ?? ''
  const output = `${stdout}${r.stderr ?? ''}`
  return {
    code: r.status ?? 99,
    judged: FAIL_SUMMARY.test(stdout),
    tail: output.trim().split('\n').slice(-1)[0] ?? '',
  }
}

let failed = 0
try {
  for (const entry of readdirSync(root)) {
    if (entry === 'src' || entry === 'scripts' || entry === '.git' || entry === '.next') continue
    symlinkSync(join(root, entry), join(dir, entry))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })

  console.log('\n══ 첫 댓글 회차 안 재시도(라운드 2) 변이 시험 (worktree 변경 0) ══')
  for (const check of [...new Set(mutations.map((mutation) => mutation.check))]) {
    const result = run(check)
    console.log(`  ${result.code === 0 ? '✅' : '🔴'} 기준선 ${check} — exit ${result.code} (${result.tail})`)
    if (result.code !== 0) throw new Error(`기준선이 FAIL이다 — ${check}`)
  }

  for (const mutation of mutations) {
    const path = join(dir, mutation.file)
    const original = readFileSync(path, 'utf-8')
    const matches = original.split(mutation.from).length - 1
    if (matches !== 1) {
      failed += 1
      console.log(`  🔴 변이 자리 ${matches}곳(정확히 1곳이어야 함) — ${mutation.name}`)
      continue
    }
    writeFileSync(path, original.replace(mutation.from, mutation.to))
    try {
      const result = run(mutation.check)
      if (result.code === 0) {
        failed += 1
        console.log(`  🔴 살아남음 — ${mutation.name}`)
      } else if (!result.judged) {
        failed += 1
        console.log(`  🔴 로드 실패(검출 아님) — ${mutation.name} · ${result.tail}`)
      } else {
        console.log(`  ✅ 검출 — ${mutation.name}`)
      }
    } finally {
      writeFileSync(path, original)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? '✅ PASS' : `🔴 FAIL ${failed}건`} — 변이 ${mutations.length}개`)
process.exit(failed === 0 ? 0 : 1)
