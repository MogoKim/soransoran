#!/usr/bin/env tsx
/**
 * 네이버 카페 회차 runner — 🔴 **기본은 dry-run. 네트워크 0 · DB 0**
 *
 * 🔴 **이 파일은 새 수집기가 아니다.** `BOARD_TARGETS` 가 정한 게시판을 순서대로
 *    기존 수집기(`micro-seed-collect-navercafe.mts`)에 넘길 뿐이다.
 *    요청 간격 · 세션 · 403/429 차단기 · 중복 방지 · 저장 계약은 전부 그쪽에 이미 있다.
 *
 * 🔴 **왜 필요한가.** launchd 가 `--cafe=remonterrace --pages=1 --max=10` 으로 돌고 있었다.
 *    `BOARD_TARGETS` 에 적힌 `jjong 2~16p` · `humor 1p` 는 코드에만 있고 실행되지 않았다.
 *    게시판이 여럿이면 인자 한 줄로는 표현할 수 없다 — 그래서 runner 가 필요하다.
 *
 * 🔴 **중복 상세 요청을 만들지 않는다.** 게시판을 **순차로** 돌린다.
 *    수집기는 시작할 때 thin 산출물과 원장에서 이미 연 `sourceArticleId` 를 읽으므로,
 *    앞 게시판이 연 글은 뒤 게시판 회차에서 자동으로 빠진다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-navercafe-run.mts --cafe=remonterrace            계획만
 *   npx tsx scripts/micro-seed-navercafe-run.mts --cafe=remonterrace --thin --live   🔴 실제 수집
 */
import { spawnSync } from 'node:child_process'

import { collectArgsFor, planCafeRun } from './lib/navercafe-run-plan.mjs'
import type { Phase } from '../src/lib/collect-schedule'

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit === undefined ? undefined : hit.slice(n.length + 3)
}
const CAFE = (arg('cafe') ?? '').trim()
const PHASE = ((arg('phase') ?? 'start').trim() as Phase)
const LIVE = argv.includes('--live')
const THIN = argv.includes('--thin')

if (CAFE === '') {
  console.error('\n🔴 --cafe=<id> 가 필요하다 (예: --cafe=remonterrace)\n')
  process.exit(1)
}

const plan = planCafeRun({ cafeId: CAFE, phase: PHASE })

console.log(`\n══ 네이버 카페 회차 — ${plan.cafeId} (${LIVE ? '🔴 실제 수집' : 'dry-run · 네트워크 0'}) ══\n`)
console.log(`  source   ${plan.source} · phase ${plan.phase} · 하루 ${plan.runsPerDay}회`)
console.log(`  게시판   ${plan.boards.length}개 (🔴 BOARD_TARGETS 정본)`)
for (const b of plan.boards) {
  console.log(`     ${b.key.padEnd(24)} ${b.label.padEnd(14)}`
    + ` ${String(b.startPage).padStart(2)}~${String(b.endPage).padStart(2)}p (${b.pages}장)`
    + ` · 상세 최대 ${b.detailMax}건`)
}
console.log(`\n  회차당   목록 ${plan.listPerRun}건 · 상세 ${plan.detailPerRun}건`)
console.log(`  하루     ${plan.requestsPerDay + plan.memberCheckPerDay}건 (회원 확인 ${plan.memberCheckPerDay} 포함) / 상한 ${plan.limitPerDay}건`)
console.log(`  판정     ${plan.withinLimit ? '🟢' : '🔴'} ${plan.reason}`)

if (!plan.withinLimit) {
  console.error('\n🔴 중단 — 하루 요청 상한을 넘거나 상세 몫이 0 이다. 게시판·회차를 먼저 조정한다.\n')
  process.exit(1)
}

console.log('\n  ── 실제로 넘길 인자')
for (const b of plan.boards) {
  console.log(`     ${b.key}  →  ${collectArgsFor(b, { live: LIVE, thin: THIN }).join(' ')}`)
}

if (!LIVE) {
  console.log('\n🟡 dry-run 이다 — 네트워크 0 · DB 0 · 파일 write 0')
  console.log('   실제로 돌리려면 --thin --live 를 붙인다\n')
  process.exit(0)
}

/**
 * 🔴 **게시판 하나가 막혀도 나머지를 세우지 않는다.**
 *    한 게시판의 실패는 그 게시판의 사정이다 — 다른 게시판의 새 글까지 놓칠 이유가 없다.
 *    🔴 다만 실패는 **숨기지 않는다.** 하나라도 실패하면 exit 1 이다.
 */
let failed = 0
for (const b of plan.boards) {
  const args = ['tsx', 'scripts/micro-seed-collect-navercafe.mts', ...collectArgsFor(b, { live: true, thin: THIN })]
  console.log(`\n── ${b.key} 시작 — npx ${args.join(' ')}`)
  const r = spawnSync('npx', args, { stdio: 'inherit' })
  if (r.status !== 0) {
    failed += 1
    console.log(`\n🟡 ${b.key} 실패 (exit ${String(r.status)}) — 다음 게시판은 계속한다`)
  }
}

console.log(`\n게시판 ${plan.boards.length}개 중 실패 ${failed}개\n`)
process.exit(failed === 0 ? 0 : 1)
