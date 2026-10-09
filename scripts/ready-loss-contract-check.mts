#!/usr/bin/env tsx
/**
 * 🔴 **실측 보충 계약 검사 — 필요 READY = 증명일 목표 슬롯 + 실측 손실 보충** (2026-10-04 · canon §3.1 · C-01 · C-02)
 *
 *   옛 판정은 `ceil(목표 × 1.2)` 를 필요 READY 로 썼다. D5 에서 목표 5 · 기회 5 · 실측 공급 5 인데
 *   `readyNeeded=6` 으로 영구 FAIL 이었다. P0-1 보정(같은 날)은 cohort 를 하나로 묶었다 —
 *   생산능력 · 손실률 · 공급 단가가 **같은 자동 READY 행 묶음 · 같은 창**(`readyCohort`)에서 나온다.
 *     ① 손실 0 이면 6번째 READY 를 요구하지 않는다 · 손실 1 이면 요구한다
 *     ② 공개 0 · 손실 > 0 은 UNKNOWN — 영구 불능 FAIL 이 아니다
 *     ③ 대기 행은 성공도 손실도 아니다 — 두 극단이 갈리면 UNKNOWN · 대기만 늘려 용량을 올릴 수 없다
 *     ④ 상세 원천 계획값은 preflight authority 가 아니다
 *     ⑤ 공급 비용은 처리량과 같은 필요 READY 구간 · 같은 cohort 단가를 쓴다 · raw 단가를 공개 단가로 부르지 않는다
 *     ⑥ 감사 retry · overdue · 확정 결함은 전역 quality gate 가 막는다 — READY 손실에 다시 더하지 않는다
 *     ⑦ 고정 할증 · 상세 계획값이 판정 경로로 돌아오지 않는다(소스 잠금)
 *
 * 🔴 DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.
 */
import { readFileSync } from 'node:fs'

import {
  judgeNextPreflight, replenishmentOf, type PreflightFacts, type PreflightVerdict, type ReadyCohortFact,
} from '../src/lib/stage-ladder-generic'
import { PERSONA_CANARY_FLOOR } from '../src/lib/d100-capacity'
import { SUPPLY_RUNS_PER_DAY, SUPPLY_WORKSET_PER_RUN } from '../src/lib/supply-schedule-contract'
import { qualitySignalOf } from '../src/lib/stage-controller'
import { RUNNER_GRID } from './lib/stage-preflight-facts.mjs'
import { cohortFatesOf } from '../src/lib/ready-fate'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v: PreflightVerdict): string => `${v.verdict} [${v.codes.join(',')}] ${JSON.stringify(v.counts)}`
const strip = (p: string): string => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

/** 🔴 하루 공급 묶음 원천 수 — 원천 수가 이 값이면 raw READY 수가 곧 하루 용량이다 */
const RUNS = SUPPLY_WORKSET_PER_RUN * SUPPLY_RUNS_PER_DAY
/** 🔴 cohort — 기본: 원천 RUNS · 공개 5 · 손실 0 · 예정 0 · 모름 0 · 결과당 비용 $0.01(완전 연결) */
const cohort = (o: Partial<ReadyCohortFact> = {}): ReadyCohortFact => ({
  sources: RUNS, published: 5, lost: 0, scheduled: 0, unknown: 0, usdPerSlotValidResult: 0.01, ...o,
})
/** 🔴 raw READY `raw` 건이 하루 용량 `cap` 이 되는 원천 수 */
const sourcesFor = (raw: number, cap: number): number => Math.floor((raw * RUNS) / cap)

/** 🔴 D3 → D5 preflight — target 5 · opportunities 5. 나머지 칸(비용 · Persona · 러너 · 지연)은 GREEN */
const D5_FACTS = (o: Partial<PreflightFacts> = {}): PreflightFacts => ({
  slotValidOpportunities: 5, readyCohort: cohort(),
  latencyP50H: 20, latencyP90H: 40, contractValidPersonas: PERSONA_CANARY_FLOOR.d5,
  commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.2, auditUsdPerCall: 0.005, auditDailyUsdCap: 0.3,
  supplyDailyUsdCap: 0.5, runnerHealth: 'ok', ...o,
})
const d5 = (c: Partial<ReadyCohortFact> = {}, o: Partial<PreflightFacts> = {}): PreflightVerdict =>
  judgeNextPreflight('d5', D5_FACTS({ readyCohort: cohort(c), ...o }), RUNNER_GRID)

console.log('\n① 반례 1 · 2 — 손실 0 이면 목표만 · 손실 1 이면 +1 (대기 0)')
{
  const v = d5()
  check('🔴 반례1 공개 5 · 손실 0 · 대기 0 · 같은 cohort 용량 5 → PASS (6번째 READY 를 요구하지 않는다)',
    v.verdict === 'PASS' && v.counts.readyNeeded === 5 && v.counts.readyCapacity === 5, show(v))
  const v2 = d5({ lost: 1, sources: sourcesFor(6, 5) })
  check('🔴 반례2 공개 5 · 손실 1 → 필요 6 · 용량 5 → FAIL THROUGHPUT_SHORT',
    v2.verdict === 'FAIL' && v2.codes.includes('THROUGHPUT_SHORT') && v2.counts.readyNeeded === 6 && v2.counts.readyCapacity === 5, show(v2))
  const v3 = d5({ lost: 1, sources: sourcesFor(6, 6) })
  check('🔴 반례2 같은 손실 1 · 용량 6 → 처리량 PASS',
    v3.verdict === 'PASS' && v3.counts.readyNeeded === 6 && v3.counts.readyCapacity === 6, show(v3))
  const r = replenishmentOf(5, cohort({ published: 3, lost: 1 }))
  check('🔴 손실률은 같은 cohort 비율로 목표에 맞춘다 — 공개 3 · 손실 1 → D5 필요 5 + ceil(5/3) = 7',
    r.min === 7 && r.max === 7, JSON.stringify(r))
}

console.log('\n② 반례 3 — 공개 0 · 손실 > 0 → UNKNOWN (영구 불능 · 무조건 FAIL 금지)')
{
  // 🔴 slot-valid 결과 0 이면 결과당 비용도 없다(비용 귀속이 null) — 현실 모양 그대로
  const v = d5({ published: 0, lost: 3, sources: sourcesFor(3, 5), usdPerSlotValidResult: null })
  check('🔴 반례3 공개 0 · 손실 3 · 용량 5 → UNKNOWN READY_REQUIREMENT_UNKNOWN · FAIL 코드 없음',
    v.verdict === 'UNKNOWN' && v.codes.includes('READY_REQUIREMENT_UNKNOWN')
    && !v.codes.includes('THROUGHPUT_SHORT') && !v.codes.includes('SUPPLY_COST_SHORT'), show(v))
  check('🔴 반례3 공급 비용도 UNKNOWN (결과 0 → 결과당 비용 없음)', v.codes.includes('SUPPLY_COST_UNKNOWN'), show(v))
  const hard = d5({ published: 0, lost: 3, sources: sourcesFor(3, 4) })
  check('🔴 실제 hard failure 는 남는다 — 필요량은 목표 아래로 내려가지 않으므로 용량 4 < 목표 5 → FAIL',
    hard.verdict === 'FAIL' && hard.codes.includes('THROUGHPUT_SHORT'), show(hard))
  const none = d5({}, { readyCohort: null })
  check('🔴 cohort 모름 → THROUGHPUT_UNKNOWN · SUPPLY_COST_UNKNOWN (0 으로 읽지 않는다)',
    none.verdict === 'UNKNOWN' && none.codes.includes('THROUGHPUT_UNKNOWN') && none.codes.includes('SUPPLY_COST_UNKNOWN')
    && !('readyNeeded' in none.counts), show(none))
  const empty = d5({ published: 0, lost: 0, unknown: 0 })
  check('🔴 결말 0 · 대기 0(READY 0) → 용량 0 < 목표 → FAIL (관측된 0 생산)',
    empty.verdict === 'FAIL' && empty.codes.includes('THROUGHPUT_SHORT'), show(empty))
  check('🔴 손상된 사실(음수 · 소수)은 구간을 만들지 않는다',
    replenishmentOf(5, cohort({ published: -1 })).max === null && replenishmentOf(5, cohort({ unknown: 0.5 })).max === null)
}

console.log('\n③ 반례 4 · 5 — 대기 행은 성공도 손실도 아니다 (운영 10월 4일 모양)')
{
  const op = d5({ published: 4, lost: 0, unknown: 10, sources: 160 })
  check('🔴 🔴 반례4 공개 4 · 손실 0 · 대기 10 · 원천 160 → 용량 5 · 필요 5~18 → UNKNOWN (PASS 로 확정하지 않는다)',
    op.verdict === 'UNKNOWN' && op.codes.includes('READY_REQUIREMENT_UNKNOWN') && op.counts.readyCapacity === 5
    && op.counts.readyNeededMin === 5 && op.counts.readyNeededMax === 18 && !('readyNeeded' in op.counts), show(op))
  const base = d5({ published: 4, lost: 0, unknown: 0, sources: 160 })
  check('🔴 반례5 대기 0 이면 같은 원천에서 용량 1 → FAIL', base.verdict === 'FAIL' && base.codes.includes('THROUGHPUT_SHORT'), show(base))
  const inflated = [10, 100, 1000].map((pending) => d5({ published: 4, lost: 0, unknown: pending, sources: 160 }))
  check('🔴 🔴 반례5 대기만 늘려(10 · 100 · 1000) 용량을 올려도 PASS 가 되지 않는다',
    inflated.every((v) => v.verdict !== 'PASS' && v.codes.includes('READY_REQUIREMENT_UNKNOWN')),
    inflated.map((v) => `${v.verdict}:${v.counts.readyCapacity}`).join(','))
  const resolved = d5({ published: 14, lost: 0, unknown: 0, sources: 160 })
  check('🔴 같은 행이 전부 공개로 결말 나면(공개 14) PASS — 결말이 판정을 연다', resolved.verdict === 'PASS', show(resolved))
  const lostAll = d5({ published: 4, lost: 10, unknown: 0, sources: 160 })
  check('🔴 같은 행이 전부 손실로 결말 나면(손실 10) 필요 18 > 용량 5 → FAIL', lostAll.verdict === 'FAIL'
    && lostAll.counts.readyNeeded === 18, show(lostAll))
  const covered = d5({ published: 4, lost: 0, unknown: 10, sources: sourcesFor(14, 18) })
  check('🔴 대기를 전부 손실로 봐도 용량(18)이 채우면 대기는 결과를 못 바꾼다 → PASS (현재 증명된 것을 손실 처리하지 않는다)',
    covered.verdict === 'PASS' && covered.counts.readyCapacity === 18, show(covered))
  const opOpp = d5({ published: 4, lost: 0, unknown: 10, sources: 160 }, { slotValidOpportunities: 5 })
  check('🔴 현재 슬롯 기회 5 가 충분해도 보충 처리량 UNKNOWN 은 남는다 (기회 ≠ 지속 보충)',
    opOpp.verdict === 'UNKNOWN' && !opOpp.codes.includes('OPPORTUNITY_SHORT'), show(opOpp))
}

console.log('\n④ 반례 6 — 상세 원천은 authority 가 아니다')
{
  const v = d5({ sources: sourcesFor(5, 50) }, { slotValidOpportunities: 4 })
  check('🔴 공급 용량 50 이어도 슬롯 유효 기회 4 < 5 → FAIL OPPORTUNITY_SHORT',
    v.verdict === 'FAIL' && v.codes.includes('OPPORTUNITY_SHORT'), show(v))
  const judgePaths = ['src/lib/stage-ladder-generic.ts', 'scripts/lib/stage-preflight-facts.mts']
  const detailAuthority = /PLANNED_DETAIL_PER_PUBLIC_POST|plannedDetailedSourcesPerDay|detailedSourcesRequiredPerDay|d100Plan\b|allD100Plans\b/
  check('🔴 반례6 preflight 판정·사실 경로가 상세 계획값을 읽지 않는다 — 계획값을 바꿔도 결과 불변',
    judgePaths.every((p) => !detailAuthority.test(strip(p))), judgePaths.filter((p) => detailAuthority.test(strip(p))).join(','))
}

console.log('\n⑤ 반례 7 · 8 — 비용: 하루 필요 = 목표 × 완전 연결 결과당 비용 · raw 단가 authority 없음')
{
  const ok = d5({ usdPerSlotValidResult: 0.09 })
  check('🔴 반례8 결과당 $0.09 × 목표 5 = $0.45 ≤ $0.50 → 비용 GREEN (상한은 소비 목표가 아니다)',
    ok.verdict === 'PASS' && Math.abs((ok.counts.supplyDailyUsdNeeded ?? 0) - 0.45) < 1e-12, show(ok))
  const short = d5({ usdPerSlotValidResult: 0.11 })
  check('🔴 반례8 결과당 $0.11 × 목표 5 = $0.55 > $0.50 → SUPPLY_COST_SHORT', short.codes.includes('SUPPLY_COST_SHORT'), show(short))
  const lossy = d5({ lost: 1, sources: sourcesFor(6, 50), usdPerSlotValidResult: 0.09 })
  check('🔴 🔴 결과당 비용에 손실이 이미 들어 있다 — 손실 1 이어도 비용은 목표 5 × $0.09 (필요 READY 6 을 다시 곱하지 않는다)',
    lossy.counts.readyNeeded === 6 && Math.abs((lossy.counts.supplyDailyUsdNeeded ?? 0) - 0.45) < 1e-12
    && !lossy.codes.includes('SUPPLY_COST_SHORT'), show(lossy))
  const unknown = d5({ unknown: 10, published: 4, sources: sourcesFor(14, 18), usdPerSlotValidResult: null })
  check('🔴 🔴 반례7 결과당 비용 모름(legacy-only · 미연결 · 미정산 · 확인 결과 0) → SUPPLY_COST_UNKNOWN — raw 단가로 GREEN/FAIL 하지 않는다',
    unknown.codes.includes('SUPPLY_COST_UNKNOWN') && !unknown.codes.includes('SUPPLY_COST_SHORT')
    && !('rawReadyUsd' in unknown.counts) && !('publicPostUsd' in unknown.counts), show(unknown))
  const judge = strip('src/lib/stage-ladder-generic.ts')
  check('🔴 처리량은 replenishmentOf 구간 하나 · 비용은 목표 × 결과당 비용 하나 — raw 단가 계산 없음',
    (judge.match(/[=(]\s*replenishmentOf\(/g) ?? []).length === 1
    && /judgeAgainst\(req, \(need\) => capacity >= need\)/.test(judge)
    && /else if \(n \* perResult > facts\.supplyDailyUsdCap\) codes\.add\('SUPPLY_COST_SHORT'\)/.test(judge)
    && !/rawUnit|supplyUsd\b/.test(judge))
}

console.log('\n⑥ 생산자 · 감사 경계 — 결말만 분류 · 감사는 전역 gate')
{
  const r = cohortFatesOf([
    ...Array.from({ length: 5 }, () => ({ status: 'PUBLISHED', fate: null })),
    { status: 'EXPIRED', fate: null }, { status: 'DECLINED', fate: null },
    { status: 'APPROVED', fate: 'scheduled' as const }, { status: 'APPROVED', fate: 'lost' as const },
    { status: 'EDITED', fate: 'unknown' as const }, { status: 'PENDING', fate: null },
  ])
  check('🔴 PUBLISHED → 공개 · EXPIRED · DECLINED · 손실 확정 대기 → 손실 · 예정 대기 → 예정 · 나머지 대기 → 모름',
    r.published === 5 && r.lost === 3 && r.scheduled === 1 && r.unknown === 2, JSON.stringify(r))
  const facts = strip('scripts/lib/stage-preflight-facts.mts')
  check('🔴 생산능력 · 결말이 한 번의 조회(창 시작 이후 적재 · 자동 READY 경로 · 회차 소속) — 별도 count 로 raw 를 따로 세지 않는다',
    /findMany\(\{\s*where: \{ createdAt: \{ gte: i\.windowFrom \} \}/.test(facts)
    && /r\.decidedBy === AUTO_DECIDER\s*\|\| \(\(r\.decidedBy \?\? ''\)\.startsWith\('machine:'\)/.test(facts)
    && !/originalPostApprovalQueue\.count\(/.test(facts)
    && /readyCount = fates === null \? null : fates\.published \+ fates\.lost \+ fates\.scheduled \+ fates\.unknown/.test(facts))
  check('🔴 비용은 같은 cohort 의 완전 연결 결과당 비용 하나로 사실에 담긴다 — raw 정산 ÷ 행 수 없음',
    /\{ sources: worksetSources, \.\.\.fates, usdPerSlotValidResult: costAttribution\?\.usdPerSlotValidResult \?\? null \}/.test(facts)
    && !/supplyUsdPerReady|supplyUsd: spent/.test(facts))
  check('🔴 감사 retry · overdue · 확정 결함은 전역 quality signal 이 막는다',
    qualitySignalOf({ unresolvedDefects: 1, missingPosts: 0, retryableFailures: 0, overdueAudits: 0 }).health === 'bad'
    && qualitySignalOf({ unresolvedDefects: 0, missingPosts: 0, retryableFailures: 1, overdueAudits: 0 }).health === 'bad'
    && qualitySignalOf({ unresolvedDefects: 0, missingPosts: 0, retryableFailures: 0, overdueAudits: 1 }).health === 'bad')
  check('🔴 READY cohort 는 감사 표를 읽지 않는다 — 감사 상태를 손실에 다시 더하지 않는다(이중 계산 없음)',
    !/autoReadyAudit|AutoReadyAudit|retryableFailure|overdueAudit|unresolvedDefect/.test(facts)
    && !/audit/i.test(strip('src/lib/stage-ladder-generic.ts').slice(
      strip('src/lib/stage-ladder-generic.ts').indexOf('export function replenishmentOf'),
      strip('src/lib/stage-ladder-generic.ts').indexOf('export type PreflightVerdict'))))
}

console.log('\n⑦ 소스 잠금 — 고정 할증 · 옛 단일 사실이 판정 경로로 돌아오지 않는다')
{
  const paths = [
    'src/lib/stage-ladder-generic.ts', 'src/lib/d100-capacity.ts', 'scripts/lib/stage-preflight-facts.mts',
    'scripts/stage-controller.mts', 'scripts/d100-master-readiness.mts',
  ]
  const margin = /READY_NET_MARGIN|readyQualifiedRequiredPerDay|\*\s*1\.2\b|\b1\.2\s*\*/
  check('🔴 판정·보고 경로 어디에도 READY 고정 할증(1.2 · READY_NET_MARGIN)이 없다',
    paths.every((p) => !margin.test(strip(p))), paths.filter((p) => margin.test(strip(p))).join(','))
  check('🔴 옛 사실(readyPerSource · readyLoss · supplyUsdPerReady) · unbounded 판정이 판정 함수에 없다',
    !/readyPerSource|readyLoss\b|supplyUsdPerReady|unbounded/.test(strip('src/lib/stage-ladder-generic.ts')))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.')
if (fail > 0) process.exit(1)
