#!/usr/bin/env node
/**
 * Magazine rollout switch 변이 시험 (①A).
 *
 * 각 변이를 `magazine-rollout-check.mjs --mutate <id> --only <반례>` 로 돌린다. 저장소 파일을 고치지 않는다 —
 * 검사가 후보 파일을 임시 사본·sandbox 에 옮길 때만 변이를 적용한다.
 *
 * 🔴 검출 조건(셋 다): 검사가 `MUTATION APPLIED <id>` 를 찍었다 · 종료 코드 1 · 기대한 반례 중 하나 이상이 `FAIL` 이다.
 *    검사가 반례를 하나도 돌리지 않았거나(실행 0) 변이 지점을 못 찾았거나(종료 2) 종료 0 이면 검출로 세지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECK = join(dirname(fileURLToPath(import.meta.url)), 'magazine-rollout-check.mjs')

/** 변이 → 그것을 잡아야 하는 반례 id */
const PLAN = {
  'fallback-vnext': ['U1'],
  'invalid-accepted': ['U3'],
  'strict-schema-removed': ['U3'],
  'write-boundary-removed': ['U11'],
  'cas-removed': ['U10', 'U13'],
  'atomic-removed': ['U6', 'U9-fsyncSync'],
  'previous-unchecked': ['U7'],
  'producer-guard-removed': ['P4'],
  'register-guard-removed': ['A4'],
  'vnext-runs-legacy': ['U4', 'P4', 'A4'],
  'producer-guard-late': ['P4'],
  'register-guard-late': ['A4'],
  'post-sync-bypass': ['P6', 'P7'],
  'producer-legacy-drift': ['P1'],
  'register-legacy-drift': ['A2'],
}

let detected = 0
let missed = 0
for (const [id, cases] of Object.entries(PLAN)) {
  const r = spawnSync(process.execPath, [CHECK, '--mutate', id, '--only', cases.join(',')], { encoding: 'utf8', timeout: 600000 })
  const out = `${r.stdout}${r.stderr}`
  const applied = out.includes(`MUTATION APPLIED ${id}`)
  const ranLine = /\(실행 (\d+)\)/.exec(out)
  const ran = ranLine ? Number(ranLine[1]) : 0
  const failedCases = cases.filter((c) => new RegExp(`^FAIL ${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `, 'm').test(out))
  const ok = applied && r.status === 1 && ran > 0 && failedCases.length > 0
  if (ok) detected++; else missed++
  console.log(`${ok ? 'DETECTED' : 'MISSED  '} ${id} — 검출 반례 ${failedCases.join(',') || '없음'} · 종료 ${r.status} · 실행 ${ran}${applied ? '' : ' · 변이 미적용'}`)
}
console.log(`\nmagazine rollout 변이: ${detected} detected, ${missed} missed (전체 ${Object.keys(PLAN).length})`)
process.exit(missed === 0 ? 0 : 1)
