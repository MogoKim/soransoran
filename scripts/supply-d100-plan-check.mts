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
import { planAutoFetch } from './lib/micro-seed-supply.mjs'

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
  const b = judgeJitDemand({ slots: 4, readyFilled: Math.min(usable, 4), writable: 4 })
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

// 🔴 ④ 82cook GHA 워크플로 · ⑤ 회차 계획(planCafeRun) 은 지웠다 — 82cook 수집이 끝났고 바퀴 몫은
//    실행 때 정한다(`collect-sources.cycleDetailQuota` · 검사는 collect:sources-check)

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 본문을 읽기 전에 후보를 버리지 않는다 — 신선도 1순위 (2026-10-19 창업자 결정)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 실측: 후보 15건인데 상세가 2~4건에서 끝났다. 점수 하한이 상한보다 먼저 잘랐다.
   *    점수는 더 이상 "여는 순서" 가 아니다 — 2026-10-19 창업자 결정으로 신선도 1순위로 바뀌었다.
   *    점수는 하드 차단이 아니라는 사실만 그대로 유지된다.
   */
  const base = Date.UTC(2026, 9, 12, 0)
  const rows = Array.from({ length: 15 }, (_, i) => ({
    sourceArticleId: `a${i}`, score: i < 3 ? 60 : 5, flags: [] as string[],
    // 🔴 신선도 — a0 가 가장 최근(0h), a14 가 가장 오래(14h)
    postedFrom: new Date(base - i * 3_600_000).toISOString(),
  }))
  const p = planAutoFetch(rows, { max: 10 })
  check('🟢 후보가 충분하면 상한까지 연다 — 낮은 점수만으로 0 이 되지 않는다', p.picked.length === 10)
  check('🟢 가장 신선한 글이 1순위 — 점수가 섞여 있어도 신선도 순서를 지킨다',
    p.picked.slice(0, 3).join(',') === 'a0,a1,a2')
  check('🔴 나머지는 버려진 것이 아니라 다음 회차로 밀린다',
    p.skipped.every((x) => x.reason === 'OVER_MAX'))
  /** 🔴 하드 차단은 그대로다 */
  const hard = planAutoFetch([
    { sourceArticleId: 'p1', score: 99, flags: ['hanjaLanguageFit'] },
    { sourceArticleId: 'v1', score: 99, flags: [], alreadyInVault: true },
    { sourceArticleId: 'ok', score: 1, flags: [] },
  ], { max: 10 })
  check('🔴 언어 핏(한자 제목)은 여전히 열지 않는다', !hard.picked.includes('p1'))
  check('🔴 이미 연 글은 여전히 열지 않는다', !hard.picked.includes('v1'))
  check('🟢 점수가 낮아도 막을 이유가 없으면 열린다', hard.picked.includes('ok'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 옛 운영 경로가 남아 있지 않다')
// ─────────────────────────────────────────────────────────
{
  const t = readFileSync('docs/operations/launchd/com.soransoran.navercafe-collect.plist.template', 'utf8')
  // 🔴 주석은 빼고 실제로 넘어가는 `<string>` 만 본다
  const block = /<key>ProgramArguments<\/key>[\s\S]*?<\/array>/.exec(t)?.[0] ?? ''
  const args = (block.match(/<string>[^<]*<\/string>/g) ?? []).join(' ')
  check('🔴 수집 template 이 --pages · --max 를 손으로 적지 않는다', !args.includes('--pages=') && !args.includes('--max='))
  check('🔴 수집 template 이 수집기를 직접 부르지 않는다', !args.includes('micro-seed-collect-navercafe.mts'))
  check('🟢 수집 template 이 runner 를 부른다', args.includes('micro-seed-navercafe-run.mts'))
}
/** 🔴 정본 문서를 두 지침이 모두 가리킨다 */
for (const f of ['AGENTS.md', 'CLAUDE.md']) {
  const g = readFileSync(f, 'utf8')
  check(`🔴 ${f} 가 NORTH-STAR 를 가리킨다`, g.includes('docs/operations/NORTH-STAR.md'))
  check(`🔴 ${f} 가 CURRENT-MILESTONE 을 가리킨다`, g.includes('docs/operations/CURRENT-MILESTONE.md'))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
