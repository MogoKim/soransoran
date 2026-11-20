#!/usr/bin/env tsx
/**
 * 네이버 카페 수집 바퀴 — 🔴 **원천 목록을 차례로 돈다. 기본은 dry-run**
 *
 * 왜 이 파일이 있는가:
 *   카페마다 launchd job 이 따로 있었고 수집기 잠금은 하나라, 두 카페를 같은 시각에 올리면 뒤쪽이
 *   `LOCK_BUSY` 로 실패했다. 그래서 job 하나(`com.soransoran.navercafe-collect`)가 바퀴 시각
 *   (`cycle-schedule.ts` 의 `CYCLES`)에 떠서 `collect-sources.ts` 의 카페를 **차례로** 부른다.
 *
 * 🔴 카페마다 수집기 프로세스를 새로 띄운다 — 한 카페가 실패(세션 · 차단 · 오류)해도 다음 카페는 돈다.
 *    실패는 숨기지 않는다: 하나라도 실패하면 exit 1 이다. 이 바퀴의 본문 수는 수집기가 목록을 본 뒤 정한다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-navercafe-run.mts          계획만
 *   npx tsx scripts/micro-seed-navercafe-run.mts --live   🔴 실제 수집
 */
import { spawnSync } from 'node:child_process'

import { COLLECT_SOURCES, overheadPerCycle, detailCeilingPerDay, ACCOUNT_DAILY_REQUESTS } from '../src/lib/collect-sources'
import { CYCLES, cycleLabel } from '../src/lib/cycle-schedule'

const LIVE = process.argv.slice(2).includes('--live')

console.log(`\n══ 네이버 카페 수집 바퀴 (${LIVE ? '🔴 실제 수집' : 'dry-run · 네트워크 0'}) ══\n`)
console.log(`  바퀴     하루 ${CYCLES.length}회 — ${CYCLES.map((c) => cycleLabel(c.minute)).join(' ')} (cycle-schedule)`)
console.log(`  계정     하루 요청 상한 ${ACCOUNT_DAILY_REQUESTS}건(모든 카페 합)`)
for (const s of COLLECT_SOURCES) {
  console.log(`  ${s.id.padEnd(13)} ${s.label} · ${s.boardLabel} · 목록 최대 ${s.maxListPages}쪽`
    + ` · 하루 ${s.dailyRequests}건(바퀴당 회원 확인·목록 최대 ${overheadPerCycle(s)} · 본문 상한 ${detailCeilingPerDay(s)}/day)`)
}

if (!LIVE) {
  console.log('\n🟡 dry-run 이다 — 네트워크 0 · DB 0 · 파일 write 0 · 실제로 돌리려면 --live\n')
  process.exit(0)
}

const failed: string[] = []
for (const s of COLLECT_SOURCES) {
  const args = ['tsx', 'scripts/micro-seed-collect-navercafe.mts', `--source=${s.id}`, '--live']
  console.log(`\n── ${s.id} 시작 — npx ${args.join(' ')}`)
  const r = spawnSync('npx', args, { stdio: 'inherit' })
  if (r.status !== 0) {
    failed.push(s.id)
    console.log(`\n🟡 ${s.id} 실패 (exit ${String(r.status)}) — 다음 카페는 계속한다`)
  }
}

console.log(`\n▸ 바퀴 끝 — 카페 ${COLLECT_SOURCES.length}곳 중 실패 ${failed.length}곳${failed.length > 0 ? ` (${failed.join(' · ')})` : ''}\n`)
process.exit(failed.length === 0 ? 0 : 1)
