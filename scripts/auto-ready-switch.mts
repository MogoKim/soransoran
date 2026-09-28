#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 스위치 — 한 명령으로 켜고 끈다** (quality-v4 · 2026-09-28)
 *
 *   npm run auto-ready:switch -- --off              계획만(dry-run)
 *   npm run auto-ready:switch -- --off --apply      🔴 정본 env 의 `SORAN_AUTO_READY_ENABLED` 한 줄만 지운다
 *   npm run auto-ready:switch -- --on  --apply      🔴 그 한 줄을 `on` 으로 쓴다
 *
 *   🔴 다른 키는 한 글자도 바꾸지 않는다 — 바꾼 뒤 다시 읽어 "그 키만 달라졌다" 를 확인하고, 아니면 되돌린다.
 *   🔴 바꾸기 전 원본을 `<env>.bak-auto-ready-<시각>` 으로 남긴다. 발행·도장 러너는 다음 회차에 env 를 새로 읽는다.
 *   🔴 DB · 네트워크 · launchd 를 건드리지 않는다. `--env=<path>` 는 검사용이다.
 */
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AUTO_READY_ENV } from '../src/lib/auto-ready-v2'

const argv = process.argv.slice(2)
const ENV = argv.find((a) => a.startsWith('--env='))?.slice(6)
  ?? join(homedir(), 'Library', 'Application Support', 'soransoran', 'env.local')
const want = argv.includes('--on') ? 'on' : argv.includes('--off') ? 'off' : null
const apply = argv.includes('--apply')
if (want === null || (argv.includes('--on') && argv.includes('--off'))) {
  console.error('🔴 --on 또는 --off 하나를 준다'); process.exit(2)
}
const KEY_RE = new RegExp(`^${AUTO_READY_ENV}=`)
const before = readFileSync(ENV, 'utf8')
const lines = before.split('\n')
const others = (ls: readonly string[]): string => ls.filter((l) => !KEY_RE.test(l)).join('\n')
const kept = lines.filter((l) => !KEY_RE.test(l))
const next = want === 'on'
  ? `${kept.join('\n').replace(/\n*$/, '')}\n${AUTO_READY_ENV}=on\n`
  : `${kept.join('\n').replace(/\n*$/, '')}\n`
const nowLine = lines.find((l) => KEY_RE.test(l)) ?? '(없음 — 꺼져 있다)'
console.log(`\n══ 자동 READY 스위치 ══\n   env ${ENV}\n   지금 ${nowLine}\n   바꿀 값 ${want === 'on' ? `${AUTO_READY_ENV}=on` : '(줄 삭제 — 꺼짐)'}`)
if (!apply) { console.log('   🔴 dry-run — 바꾸지 않았다. 적용: --apply\n'); process.exit(0) }
const bak = `${ENV}.bak-auto-ready-${new Date().toISOString().replace(/[:.]/g, '-')}`
copyFileSync(ENV, bak)
const tmp = `${ENV}.tmp-auto-ready`
writeFileSync(tmp, next, { mode: 0o600 })
renameSync(tmp, ENV)
const after = readFileSync(ENV, 'utf8')
const onNow = after.split('\n').some((l) => l.trim() === `${AUTO_READY_ENV}=on`)
const othersSame = others(after.split('\n')).replace(/\n*$/, '') === others(before.split('\n')).replace(/\n*$/, '')
if (!othersSame || onNow !== (want === 'on')) {
  copyFileSync(bak, ENV)
  console.error('🔴 다시 읽은 env 가 기대와 다르다 — 원본으로 되돌렸다'); process.exit(1)
}
console.log(`   ✅ ${want === 'on' ? '켰다' : '껐다'} · 다른 키 변화 0 · 백업 ${bak}\n`)
