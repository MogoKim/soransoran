#!/usr/bin/env tsx
/** 단계 controller 스위치. 다른 env 줄은 바꾸지 않고 원본을 백업한다. */
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { CONTROLLER_ENV } from '../src/lib/stage-decision-store'

const argv = process.argv.slice(2)
const envPath = argv.find((a) => a.startsWith('--env='))?.slice(6)
  ?? join(homedir(), 'Library', 'Application Support', 'soransoran', 'env.local')
const want = argv.includes('--on') ? 'on' : argv.includes('--off') ? 'off' : null
const apply = argv.includes('--apply')
if (want === null || (argv.includes('--on') && argv.includes('--off'))) {
  console.error('🔴 --on 또는 --off 하나를 준다')
  process.exit(2)
}

const keyRe = new RegExp(`^${CONTROLLER_ENV}=`)
const before = readFileSync(envPath, 'utf8')
const withoutKey = (text: string): string => text.split('\n').filter((line) => !keyRe.test(line)).join('\n')
const kept = withoutKey(before).replace(/\n*$/, '')
const next = `${kept}\n${want === 'on' ? `${CONTROLLER_ENV}=on\n` : ''}`

console.log(`\n══ 단계 controller 스위치 ══`)
console.log(`   env ${envPath}`)
console.log(`   바꿀 값 ${want === 'on' ? `${CONTROLLER_ENV}=on` : '(줄 삭제 — 꺼짐)'}`)
if (!apply) {
  console.log('   🔴 dry-run — 바꾸지 않았다. 적용: --apply\n')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = `${envPath}.bak-stage-controller-${stamp}`
copyFileSync(envPath, backup)
const tmp = `${envPath}.tmp-stage-controller-${process.pid}`
writeFileSync(tmp, next, { mode: 0o600 })
renameSync(tmp, envPath)
const after = readFileSync(envPath, 'utf8')
const onNow = after.split('\n').some((line) => line.trim() === `${CONTROLLER_ENV}=on`)
const othersSame = withoutKey(after).replace(/\n*$/, '') === withoutKey(before).replace(/\n*$/, '')
if (!othersSame || onNow !== (want === 'on')) {
  copyFileSync(backup, envPath)
  console.error('🔴 다시 읽은 env 가 기대와 다르다 — 원본으로 되돌렸다')
  process.exit(1)
}
console.log(`   ✅ ${want === 'on' ? '켰다' : '껐다'} · 다른 키 변화 0 · 백업 ${backup}\n`)
