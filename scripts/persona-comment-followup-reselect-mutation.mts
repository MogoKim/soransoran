#!/usr/bin/env tsx
/**
 * 추가 댓글 같은 회차 재선정 루프(`runFollowupGeneration`) **변이 시험** (2026-11-14 H1)
 *
 *   npx tsx --tsconfig tsconfig.ops.json scripts/persona-comment-followup-reselect-mutation.mts
 *
 * 🔴 worktree 를 고치지 않는다. run 모듈 사본을 OS 임시 디렉터리에 쓰고(상대 import 는 절대 경로로 바꾼다)
 *    `persona-comment-followup-reselect-check.mts` 에 `FOLLOWUP_RUN_MODULE` 로 주입한다.
 * 🔴 먼저 변이 없는 사본이 PASS 하는지 본다 — 하네스가 늘 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 * 순수 분류 · 격리 · 후보 함수의 변이는 `persona-comment-followup-mutation.mts` 가 맡는다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, 'lib')
const source = readFileSync(join(libDir, 'persona-comment-followup-run.mts'), 'utf-8')
  .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${join(libDir, p)}'`)

type Mutation = { name: string; from: string; to: string }
const MUTATIONS: Mutation[] = [
  { name: '🔴 실패 뒤 같은 글 재선정 안 함', from: "      if (code === 'FU_POST_DAY') break // 그 글만", to: "      break\n      if (code === 'FU_POST_DAY') break // 그 글만" },
  { name: '🔴 회차 격리 사본 갱신 제거', from: '      addFollowupIsolation(iso, facts, code)\n', to: '\n' },
  { name: '글 실패 뒤 같은 글에서 다시 고름', from: "      if (code === 'FU_POST_DAY') break // 그 글만", to: "      if (false) break // 그 글만" },
  { name: '🔴 일시 · 멈춤 실패에도 계속 호출', from: '      if (followupFailureHaltsRound(code)) {', to: '      if (false) {' },
  { name: '🔴 한 글 회차 시도 상한 제거', from: 'n < FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK; n++', to: 'n < 99; n++' },
  { name: '🔴 호출 예산 무시', from: 'report.providerCalls >= budget', to: 'false' },
  { name: '🔴 적재 상한 무시', from: 'report.created >= i.allowed || ', to: '' },
  { name: '🔴 FU 코드를 기억에 안 적음', from: '[...summary.blockCodes.slice(0, 31), code]', to: 'summary.blockCodes' },
  { name: '격리된 글 건너뛰기 제거', from: 'if (iso.postIds.has(slot.postId)) {', to: 'if (false) {' },
  { name: '기억이 막은 쌍을 회차 격리에 안 더함', from: '        iso.postPersonaKeys.add(postPersonaKeyOf(facts)) // 기억이', to: '        // 기억이' },
  { name: '🔴 이번 회차 적재 Persona 재사용', from: "if (o.step === 'ENQUEUED') usedPersonaIds.add(personaId)", to: "if (false) usedPersonaIds.add(personaId)" },
  { name: '🔴 첫 댓글 저장소를 받아도 진행', from: "if (i.store.lane !== 'followup') {", to: 'if (false) {' },
  { name: '🔴 결과 기록 실패에도 계속', from: "            halt('시도 결과 기록 실패 — 남은 provider 0')\n            break outer", to: "            halt('시도 결과 기록 실패 — 남은 provider 0')" },
  { name: '🔴 시작 기록 IO 실패에도 회차 계속', from: "stopRound: w.kind === 'IO' }", to: 'stopRound: false }' },
]

const dir = mkdtempSync(join(tmpdir(), 'fu-reselect-mut-'))
const run = (code: string, tag: string): number => {
  const file = join(dir, `run-${tag}.mts`)
  writeFileSync(file, code)
  const r = spawnSync('npx', ['tsx', '--tsconfig', join(here, '../tsconfig.ops.json'), join(here, 'persona-comment-followup-reselect-check.mts')], {
    env: { ...process.env, FOLLOWUP_RUN_MODULE: file }, encoding: 'utf-8',
  })
  return r.status ?? 99
}

let bad = 0
try {
  const base = run(source, 'base')
  console.log(`${base === 0 ? '✅' : '❌'} 변이 없는 사본 → PASS (exit ${base})`)
  if (base !== 0) bad++
  MUTATIONS.forEach((m, i) => {
    if (!source.includes(m.from)) {
      bad++
      console.log(`❌ [${m.name}] 변이 자리를 찾지 못했다 — 하네스가 낡았다`)
      return
    }
    const code = run(source.replace(m.from, m.to), String(i))
    const killed = code !== 0
    if (!killed) bad++
    console.log(`${killed ? '✅' : '❌'} [${m.name}] → ${killed ? '검사가 잡았다' : '🔴 살아남았다(죽은 게이트)'} (exit ${code})`)
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${bad === 0 ? '✅ PASS' : `❌ FAIL ${bad}건`} — 변이 ${MUTATIONS.length}개 · worktree 변경 0`)
process.exit(bad === 0 ? 0 : 1)
