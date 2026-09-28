#!/usr/bin/env tsx
/**
 * 🔴 **무인 운영 루프 plist 셋을 렌더한다 — 등록 0 · LaunchAgents 에 쓰지 않는다**
 *
 *   npx tsx scripts/ops-loop-render.mts --out=<디렉터리>
 *
 * 🔴 `--out` 이 LaunchAgents 면 거절한다. 설치는 사람이 `OPS_LOOP_INSTALL_STEPS` 순서로 한다.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  KEEP_AWAKE_LABEL, RUNNER_RECOVER_LABEL, STAGE_CONTROLLER_LABEL, OPS_LOOP_INSTALL_STEPS,
  renderKeepAwakePlist, renderRunnerRecoverPlist, renderStageControllerPlist,
} from './lib/ops-loop-templates'

const out = process.argv.slice(2).find((a) => a.startsWith('--out='))?.slice(6)
if (out === undefined || out === '') { console.error('🔴 --out=<디렉터리> 가 필요하다'); process.exit(2) }
const dir = resolve(out)
if (dir.startsWith(join(homedir(), 'Library', 'LaunchAgents'))) {
  console.error('🔴 LaunchAgents 에 직접 쓰지 않는다 — 임시 디렉터리에 렌더하고 사람이 설치한다')
  process.exit(2)
}
const runtimeRoot = join(homedir(), 'Documents', 'soransoran-runtime')
const nodeBinDir = dirname(process.execPath)
const input = { runtimeRoot, npxPath: join(nodeBinDir, 'npx'), logDir: join(homedir(), 'Library', 'Logs', 'soransoran'), nodeBinDir }
mkdirSync(dir, { recursive: true })
const files: [string, string][] = [
  [`${STAGE_CONTROLLER_LABEL}.plist`, renderStageControllerPlist(input)],
  [`${RUNNER_RECOVER_LABEL}.plist`, renderRunnerRecoverPlist(input)],
  [`${KEEP_AWAKE_LABEL}.plist`, renderKeepAwakePlist({ logDir: input.logDir })],
]
for (const [name, xml] of files) {
  writeFileSync(join(dir, name), xml)
  console.log(`   렌더 ${join(dir, name)}`)
}
console.log('\n설치 순서 (🔴 이 명령은 아무것도 등록하지 않았다)')
for (const s of OPS_LOOP_INSTALL_STEPS) console.log(`   ${s}`)
