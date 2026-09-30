#!/usr/bin/env tsx
/**
 * D100 공급 계획 검사 — 🔴 read-only. DB 0 · 네트워크 0
 *
 * 🔴 **경계 행동만 잠근다.** 수치를 베껴 적는 fixture 는 만들지 않는다 —
 *    그런 검사는 코드를 복사한 두 번째 사본이 되고, 값이 바뀔 때마다 함께 고쳐야 한다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import * as stockPlan from '../src/lib/supply-stock-plan'
import {
  APPROVED_NET_PER_DAY, APPROVED_PER_DAY_TARGET, BASELINE_OBSERVED_AT, SOURCE_BASELINE,
  capacityOf, judgeSupplyGap, planSourceRequests,
} from '../src/lib/supply-stock-plan'
import { judgeJitDemand } from '../src/lib/supply-process'
import { collectArgsFor, planCafeRun } from './lib/navercafe-run-plan.mjs'
import { BOARD_TARGETS, pagesOf } from './lib/micro-seed-navercafe.mjs'
import { planAutoFetch } from './lib/micro-seed-supply.mjs'
import { MAX_REQUESTS_PER_DAY } from '../src/lib/collect-schedule'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}`) }
}

console.log('\n══ D100 공급 계획 검사 (🔴 DB 0 · 네트워크 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① 📜 옛 재고선(100/300/700)은 지웠다 — 보고 화면에도 남지 않는다 (2026-09-30)')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 앞판은 `STOCK_BANDS`(100/300/700) · `judgeStockBand`("700 미만이면 수집") · `stockEta`(재고선 도달 일수)를
 *    이 파일이 export 하고 `supply:d100-plan` 이 찍었다. 정본(Sep 30)은 fixed 700 finished-content target 을
 *    실행 게이트로도 보고 눈금으로도 두지 않는다 — 다시 들어오면 실패한다.
 */
check('🔴 🔴 **supply-stock-plan 이 STOCK_BANDS · judgeStockBand · stockEta 를 내보내지 않는다**',
  !('STOCK_BANDS' in stockPlan) && !('judgeStockBand' in stockPlan) && !('stockEta' in stockPlan))
{
  const code = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  check('🔴 supply-stock-plan 코드(주석 제외)에 700 이 없다', !/\b700\b/.test(code('src/lib/supply-stock-plan.ts')))
  check('🔴 supply:d100-plan 코드(주석 제외)에 재고선 · 700 이 없다',
    !/STOCK_BANDS|stockEta|judgeStockBand|\b700\b|재고선/.test(code('scripts/supply-d100-plan.mts')))
  /**
   * 🔴 **보고용 lib 는 결정 경로가 읽지 않는다** — import 그래프로 본다.
   *    supply-stock-plan 을 읽어도 되는 것은 보고 화면과 그 검사뿐이다.
   */
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mts|mjs)$/.test(n) ? [p] : []
  })
  const ALLOWED = new Set(['scripts/supply-d100-plan.mts', 'scripts/supply-d100-plan-check.mts'])
  const importers = [...walk('src'), ...walk('scripts')]
    .filter((p) => /from '[^']*supply-stock-plan(\.mjs)?'/.test(readFileSync(p, 'utf8')))
  const stray = importers.filter((p) => !ALLOWED.has(p))
  check(`🔴 🔴 **supply-stock-plan 을 읽는 것은 보고 화면뿐이다** (${importers.length}곳)`, stray.length === 0)
  for (const p of stray) console.log(`     🔴 ${p}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 공급 수요는 JIT 하나다 — 700 은 공급 러너 · 적재기의 상한이 아니다 (2026-09-30)')
// ─────────────────────────────────────────────────────────
/**
 * 🔴 앞판은 700(`STOCK_BANDS.target`)을 적재 천장 · 모델 스위치로 썼다(`judgeBuffer`). 정본(Sep 30)은
 *    "다가오는 슬롯 − eligible READY" 만큼만 만든다. 재고선은 보고 화면에서도 지웠다(①).
 */
for (const usable of [0, 42, 100, 300, 699, 700, 5_000]) {
  const b = judgeJitDemand({ slots: 4, readyFilled: Math.min(usable, 4) })
  check(`🔴 형식 행 ${usable} 과 무관하게 수요는 슬롯 − READY 다`, b.upTo === 4 - Math.min(usable, 4))
}
check('🔴 🔴 **공급 러너 · 적재기가 STOCK_BANDS 를 읽지 않는다**', (() => {
  const strip = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  return ['scripts/micro-seed-supply-autofill.mts', 'scripts/supply-process.mts', 'src/lib/supply-process.ts']
    .every((f) => !/STOCK_BANDS|BUFFER_TARGET/.test(strip(f)))
})())

// ─────────────────────────────────────────────────────────
console.log('\n③ 관측과 미확인을 섞지 않는다')
// ─────────────────────────────────────────────────────────
check('🔴 baseline 에 관측 날짜가 붙어 있다',
  SOURCE_BASELINE.every((m) => m.observedAt === BASELINE_OBSERVED_AT && m.window.length > 0))
/**
 * 🔴 82cook 의 5 는 **잔여 목록**이지 하루 신규가 아니다.
 *    그것을 `thinNewPerDay` 로 부르면 없는 유량이 능력표에 들어간다.
 */
const cook = SOURCE_BASELINE.find((m) => m.id === '82cook')!
check('🔴 82cook 하루 신규 thin 은 미관측(null)이다', cook.thinNewPerDay === null)
check('🔴 82cook 의 5 는 잔여 목록 자리에 있다', cook.eligibleBacklog === 5)
check('🔴 미관측 source 는 능력으로 세지 않는다', capacityOf(cook).thinPerDay === null)
check('🔴 미관측이면 병목 여부도 단정하지 않는다', capacityOf(cook).throttled === null)
check('🔴 미관측 source 로는 역산하지 않는다', planSourceRequests(cook).detailPerRun === null)

/**
 * 🔴 **관측은 "1페이지만 읽던 조건" 의 것이다** (2026-09-11).
 *    앞선 판은 `newPerDay` 에 "페이지를 깊이 읽어도 늘지 않는다" 고 적어 두었다.
 *    그 관측은 전부 목록 1p 회차의 것이었다 — 1p 밖의 글은 관측될 기회조차 없었다.
 *    "안 보였다" 를 "없다" 로 바꾸면, 병목을 푼 뒤에도 늘지 않는다고 미리 적어 두는 셈이다.
 */
{
  const src = readFileSync('src/lib/supply-stock-plan.ts', 'utf8')
  check('🔴 "깊이 읽어도 늘지 않는다" 는 단정이 사라졌다',
    !/페이지를 깊이 읽어도 늘지 않는다/.test(src))
  check('🔴 관측 조건(pages)이 baseline 에 남아 있다',
    SOURCE_BASELINE.filter((m) => m.thinNewPerDay !== null).every((m) => m.pages === 1))
  check('🔴 관측치가 유량 상한이 아니라고 적는다',
    SOURCE_BASELINE.filter((m) => m.thinNewPerDay !== null)
      .every((m) => m.evidence.includes('상한이 아니다')))
  check('🔴 회차 이유에도 관측 조건이 붙는다',
    /목록 \$\{m\.pages \?\? '\?'\}p 조건/.test(src))
}

/**
 * 🔴 **미측정 전환율을 1.0 으로 곱하지 않는다** (2026-09-11).
 *    `detailToApproved: 1.0` 은 "7일 Raw 30건 : Queue 30건" 이라는 생성 건수 비였다.
 *    그것을 능력 계산에 곱하는 순간, 측정되지 않은 전환율이 1.0 인 척하며
 *    **thin 수가 APPROVED 수로 둔갑**한다.
 */
{
  const src = readFileSync('src/lib/supply-stock-plan.ts', 'utf8')
  check('🔴 detailToApproved 필드가 없다',
    !/^\s*detailToApproved:/m.test(src) && !('detailToApproved' in (cook as object)))
  check('🔴 thin 은 그대로 thin 으로 센다 — 전환율을 곱하지 않는다', (() => {
    const rem = SOURCE_BASELINE.find((m) => m.id === 'navercafe:remonterrace')!
    return capacityOf(rem).thinPerDay === rem.thinNewPerDay
      && planSourceRequests(rem).coversThinPerDay === rem.thinNewPerDay
  })())
  check('🔴 APPROVED 순증가는 타입이 null 로 말한다',
    APPROVED_NET_PER_DAY === null
    && capacityOf(cook).approvedPerDay === null)
}

{
  const gap = judgeSupplyGap(SOURCE_BASELINE, APPROVED_PER_DAY_TARGET)
  check('🔴 합계에 미확인이 들어가지 않는다', gap.unconfirmed.includes('82cook'))
  check('🔴 관측 합은 thin 이라고 이름 붙는다',
    gap.thinAllPerDay === 8 + 11 && gap.thinScheduledPerDay === 8 + 11)
  check('🔴 APPROVED/day 는 미측정이다', gap.approvedPerDay === null)
  /** 🔴 thin 은 APPROVED 의 **상한**이므로 부족분은 **하한**이다 */
  check('🔴 부족분을 하한으로만 말한다',
    gap.thinShortfallFloorPerDay === APPROVED_PER_DAY_TARGET - gap.thinAllPerDay
    && gap.reason.includes('최소'))
  check('🔴 두 수가 단위가 다르다고 적는다',
    gap.reason.includes('신규 thin') && gap.reason.includes('APPROVED 단위'))
  check('🔴 목표에 못 미친다는 사실을 반올림하지 않는다',
    gap.thinAllPerDay < APPROVED_PER_DAY_TARGET && gap.thinShortfallFloorPerDay > 0)
  check('🔴 잔여 목록은 유량과 따로 센다', gap.backlogOnce === 5)
}

// 🔴 러너 출력도 thin 과 APPROVED 를 갈라 적는다
{
  const plan = readFileSync('scripts/supply-d100-plan.mts', 'utf8')
  check('🔴 출력이 APPROVED 순증가를 미측정으로 적는다',
    /APPROVED 순증가\/day/.test(plan) && /\*\*미측정\*\*/.test(plan))
  check('🔴 출력이 부족분을 "최소" 로만 적는다', /부족분\s+최소 \$\{gap\.thinShortfallFloorPerDay\}/.test(plan))
  check('🔴 출력에 재고선 도달 표가 없다', !/stockEta|걸리는 날|건까지/.test(plan))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ workflow — 돌 수 있는 상태인가')
// ─────────────────────────────────────────────────────────
{
  const wf = readFileSync('.github/workflows/supply-collect.yml', 'utf8')
  /** 🔴 judge·draft 가 claude-haiku-4.5 를 부른다 — 키가 없으면 그 자리에서 죽는다 */
  check('🔴 ANTHROPIC_API_KEY 를 넘긴다', wf.includes('ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}'))
  check('🔴 82cook 수집 kill switch 를 넘긴다',
    wf.includes('SORAN_82COOK_THIN_DETAIL_ENABLED: ${{ vars.SORAN_82COOK_THIN_DETAIL_ENABLED }}'))
  check('🔴 처리 kill switch 를 넘긴다',
    wf.includes('SORAN_SUPPLY_PROCESS_ENABLED: ${{ vars.SORAN_SUPPLY_PROCESS_ENABLED }}'))
  /**
   * 🔴 **스위치가 둘이고 서로 다른 일을 끈다.** 하나로 묶으면 82cook 을 멈추려다
   *    공급 전체가 멈춘다 — 옛 구조의 실패가 그것이었다.
   */
  check('🔴 수집 스위치와 처리 스위치가 다른 이름이다',
    !wf.includes('SORAN_SUPPLY_AUTOPILOT_ENABLED'))
  check('🔴 DB 접속을 넘긴다', wf.includes('DATABASE_URL') && wf.includes('DIRECT_URL'))
  /** 🔴 하나씩 확인한다 — 없는 채로 남의 서버를 두드리지 않는다 */
  for (const k of ['DATABASE_URL', 'DIRECT_URL', 'ANTHROPIC_API_KEY',
    'SORAN_SUPPLY_PROCESS_ENABLED', 'SORAN_82COOK_THIN_DETAIL_ENABLED']) {
    check(`🔴 실행 전 ${k} 를 검증한다`, new RegExp(`missing[\\s\\S]{0,400}${k}`).test(wf))
  }
  const activeCron = wf.split('\n').filter((l) => /^\s{2,6}- cron:/.test(l))
  check('🔴 cron 이 활성화돼 있지 않다 (이번 PR 은 켜지 않는다)', activeCron.length === 0)
  check('🟢 수동 실행 경로는 있다', wf.includes('workflow_dispatch'))
  check('🔴 apply 없이는 수집하지 않는다', wf.includes("inputs.apply == 'true'"))
  check('🔴 네이버를 GHA 에서 열지 않는다 — 세션을 러너에 두지 않는다',
    !/scripts\/micro-seed-(collect-)?navercafe/.test(wf))
  /**
   * 🔴 **로컬 파일 잠금이 기계 사이를 막는다고 쓰지 않는다.**
   *    잠금 파일은 `.microseed-data/` 안에 있고 각 기계에 따로 있다.
   */
  check('🔴 잠금이 기계 사이를 막는다고 쓰지 않는다',
    !/잠금[^\n]{0,40}(기계|머신)[^\n]{0,20}사이/.test(wf))
  check('🔴 82cook owner 가 한쪽뿐이라고 적는다', wf.includes('owner'))
  /**
   * 🔴 **수집이 실패해도 처리는 돈다.** 두 step 이 순서대로 놓여 있을 뿐이고,
   *    처리 step 은 `always()` 다 — 묶여 있던 옛 구조로 돌아가지 않는다.
   */
  check('🔴 82cook 수집과 공급 처리가 다른 step 이다',
    /micro-seed-82cook-thin-detail\.mts/.test(wf) && /scripts\/supply-process\.mts/.test(wf))
  check('🔴 처리 step 이 수집 실패와 무관하게 돈다', /if: always\(\)[\s\S]{0,200}supply-process/.test(wf)
    || /always\(\)/.test(wf.split('공급 처리')[1] ?? ''))
  check('🔴 워크플로우가 옛 중앙 러너를 부르지 않는다', !/supply-autopilot/.test(wf))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 계획된 게시판이 실제 인자로 나간다')
// ─────────────────────────────────────────────────────────
{
  const rem = planCafeRun({ cafeId: 'remonterrace' })
  const keys = rem.boards.map((b) => b.key).join(',')
  check('🟢 remonterrace 계획에 jjong 과 humor 가 둘 다 있다',
    keys === 'remonterrace:jjong,remonterrace:humor')
  const jjong = rem.boards.find((b) => b.key === 'remonterrace:jjong')!
  check('🟢 jjong 이 2~16p 다', jjong.startPage === 2 && jjong.endPage === 16 && jjong.pages === 15)
  const humor = rem.boards.find((b) => b.key === 'remonterrace:humor')!
  check('🟢 humor 가 1p 다', humor.startPage === 1 && humor.endPage === 1)
  const wg = planCafeRun({ cafeId: 'wgang' })
  const all = wg.boards.find((b) => b.key === 'wgang:all')!
  check('🟢 wgang:all 이 1~5p 다', all.startPage === 1 && all.endPage === 5 && all.pages === 5)

  /** 🔴 **`--pages=1` 로 끝나면 실패다** — 계획이 인자에 닿는지 값으로 본다 */
  const args = rem.boards.map((b) => collectArgsFor(b, { live: true, thin: true }).join(' '))
  check('🔴 인자가 --board 를 쓴다', args.every((a) => a.includes('--board=')))
  check('🔴 인자에 --pages 가 없다', args.every((a) => !a.includes('--pages')))
  check('🔴 인자에 --cafe 가 없다', args.every((a) => !a.includes('--cafe=')))

  /** 🔴 하루 요청이 기존 상한 안이다 — 상한은 영구 안전장치다 */
  for (const p of [rem, wg]) {
    check(`🟢 ${p.cafeId} 하루 ${p.requestsPerDay}건 ≤ 상한 ${p.limitPerDay}건`,
      p.withinLimit && p.requestsPerDay <= MAX_REQUESTS_PER_DAY[p.source])
    check(`🔴 ${p.cafeId} 상세 몫이 0 이 아니다 — 목록만 읽고 끝나지 않는다`, p.detailPerRun > 0)
  }
  /** 🔴 숫자를 여기 복제하지 않았는지 — 정본에서 파생됐는가 */
  check('🔴 게시판 범위를 BOARD_TARGETS 에서 읽는다',
    rem.boards.every((b) => {
      const t = BOARD_TARGETS.find((x) => x.key === b.key)!
      return pagesOf(t).length === b.pages
    }))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 본문을 읽기 전에 후보를 버리지 않는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 실측: 후보 15건인데 상세가 2~4건에서 끝났다. 점수 하한이 상한보다 먼저 잘랐다.
   *    점수는 **여는 순서**여야 한다.
   */
  const rows = Array.from({ length: 15 }, (_, i) => ({
    sourceArticleId: `a${i}`, score: i < 3 ? 60 : 5, flags: [] as string[],
  }))
  const p = planAutoFetch(rows, { max: 10 })
  check('🟢 후보가 충분하면 상한까지 연다 — 낮은 점수만으로 0 이 되지 않는다', p.picked.length === 10)
  check('🟢 높은 점수가 먼저 열린다', p.picked.slice(0, 3).join(',') === 'a0,a1,a2')
  check('🔴 나머지는 버려진 것이 아니라 다음 회차로 밀린다',
    p.skipped.every((x) => x.reason === 'OVER_MAX'))
  /** 🔴 하드 차단은 그대로다 */
  const hard = planAutoFetch([
    { sourceArticleId: 'p1', score: 99, flags: ['politicalOrPublicFigure'] },
    { sourceArticleId: 'v1', score: 99, flags: [], alreadyInVault: true },
    { sourceArticleId: 'ok', score: 1, flags: [] },
  ], { max: 10 })
  check('🔴 정치·실명은 여전히 열지 않는다', !hard.picked.includes('p1'))
  check('🔴 이미 연 글은 여전히 열지 않는다', !hard.picked.includes('v1'))
  check('🟢 점수가 낮아도 막을 이유가 없으면 열린다', hard.picked.includes('ok'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 옛 운영 경로가 남아 있지 않다')
// ─────────────────────────────────────────────────────────
for (const cafe of ['remonterrace', 'wgang']) {
  const t = readFileSync(`docs/operations/launchd/com.soransoran.navercafe-collect-${cafe}-multi.plist.template`, 'utf8')
  /**
   * 🔴 **주석은 빼고 본다.** 옛 인자를 없앤 이유를 적으려면 그 문자열을 써야 하고,
   *    그것까지 금지하면 "왜 바꿨는지" 를 남길 수 없다 — 기록을 못 남기게 하는 검사는
   *    다음 사람이 같은 실수를 반복하게 만든다. 실제로 넘어가는 `<string>` 만 본다.
   */
  const block = /<key>ProgramArguments<\/key>[\s\S]*?<\/array>/.exec(t)?.[0] ?? ''
  const args = (block.match(/<string>[^<]*<\/string>/g) ?? []).join(' ')
  check(`🔴 ${cafe} template 이 --pages=1 로 끝나지 않는다`, !args.includes('--pages='))
  check(`🔴 ${cafe} template 이 옛 수집기를 직접 부르지 않는다`,
    !args.includes('micro-seed-collect-navercafe.mts'))
  check(`🟢 ${cafe} template 이 runner 를 부른다`, args.includes('micro-seed-navercafe-run.mts'))
  check(`🔴 ${cafe} template 에 --max 숫자를 손으로 적지 않는다`, !args.includes('--max='))
}
/** 🔴 정본 문서를 두 지침이 모두 가리킨다 */
for (const f of ['AGENTS.md', 'CLAUDE.md']) {
  const g = readFileSync(f, 'utf8')
  check(`🔴 ${f} 가 NORTH-STAR 를 가리킨다`, g.includes('docs/operations/NORTH-STAR.md'))
  check(`🔴 ${f} 가 CURRENT-MILESTONE 을 가리킨다`, g.includes('docs/operations/CURRENT-MILESTONE.md'))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
