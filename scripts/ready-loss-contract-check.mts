#!/usr/bin/env tsx
/**
 * 🔴 **실측 보충 계약 검사 — 필요 READY = 증명일 목표 슬롯 + 실측 손실 보충** (2026-10-04 · canon §3.1 · C-01 · C-02)
 *
 *   옛 판정은 `ceil(목표 × 1.2)` 를 필요 READY 로 썼다. D5 에서 목표 5 · 기회 5 · 실측 공급 5 인데
 *   `readyNeeded=6` 으로 영구 FAIL 이었다. 이 검사는 다음을 잠근다.
 *     ① 손실 0 이면 6번째 READY 를 요구하지 않는다 · 손실 1 이면 요구한다
 *     ② 손실 근거가 없으면 UNKNOWN — 0 으로 읽지 않는다
 *     ③ 상세 원천 계획값은 preflight authority 가 아니다 — 슬롯 기회 부족을 대신 통과시키지 않는다
 *     ④ 공급 비용 판정은 처리량과 같은 필요 READY 를 쓴다
 *     ⑤ 생산자(`readyLossOf`)는 결말 난 행만 센다 — 대기 행을 손실 0 으로 만들지 않는다
 *     ⑥ 고정 할증 · 상세 계획값이 판정 경로로 돌아오지 않는다(소스 잠금)
 *
 * 🔴 DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.
 */
import { readFileSync } from 'node:fs'

import {
  judgeNextPreflight, readyRequirementOf, type PreflightFacts, type PreflightVerdict,
} from '../src/lib/stage-ladder-generic'
import { PERSONA_CANARY_FLOOR } from '../src/lib/d100-capacity'
import { SUPPLY_RUNS_PER_DAY, SUPPLY_WORKSET_PER_RUN } from '../src/lib/supply-schedule-contract'
import { RUNNER_GRID, readyLossOf } from './lib/stage-preflight-facts.mjs'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v: PreflightVerdict): string => `${v.verdict} [${v.codes.join(',')}] ${JSON.stringify(v.counts)}`

/** 🔴 공급 용량이 정확히 `ready` 건이 되는 수율 — 경계값(넉넉한 값으로 PASS 를 만들지 않는다) */
const yieldFor = (ready: number): number => ready / (SUPPLY_WORKSET_PER_RUN * SUPPLY_RUNS_PER_DAY)

/**
 * 🔴 **10월 3일 D3 → D5 preflight 모양** — target 5 · opportunities 5 · readyCapacity 5.
 *    나머지 칸은 GREEN(비용 · Persona · 러너 · 지연)이다.
 */
const D5_FACTS = (o: Partial<PreflightFacts> = {}): PreflightFacts => ({
  slotValidOpportunities: 5, readyPerSource: yieldFor(5), readyLoss: { published: 5, lost: 0 },
  latencyP50H: 20, latencyP90H: 40, contractValidPersonas: PERSONA_CANARY_FLOOR.d5,
  commentUsdPerRequest: 0.001, commentDailyUsdCap: 0.2, auditUsdPerCall: 0.005, auditDailyUsdCap: 0.3,
  supplyUsdPerReady: 0.01, supplyDailyUsdCap: 0.5, runnerHealth: 'ok', ...o,
})
const d5 = (o: Partial<PreflightFacts> = {}): PreflightVerdict => judgeNextPreflight('d5', D5_FACTS(o), RUNNER_GRID)

console.log('\n① 반례 1 · 2 — 손실 0 이면 목표만 · 손실 1 이면 +1')
{
  const v = d5()
  check('🔴 반례1 target 5 · opportunity 5 · capacity 5 · 실측 손실 0 → PASS (6번째 READY 를 요구하지 않는다)',
    v.verdict === 'PASS' && v.counts.readyNeeded === 5 && v.counts.readyCapacity === 5 && v.counts.opportunities === 5, show(v))
  const r = readyRequirementOf(5, { published: 5, lost: 1 })
  check('🔴 반례2 target 5 · 실측 손실 1(공개 5 · 손실 1) → required 6',
    r.kind === 'measured' && r.readyNeeded === 6 && r.lossNeeded === 1, JSON.stringify(r))
  const v2 = d5({ readyLoss: { published: 5, lost: 1 } })
  check('🔴 반례2 같은 공급 5 로는 손실 1 을 감당하지 못한다 → FAIL THROUGHPUT_SHORT (손실을 무시하지 않는다)',
    v2.verdict === 'FAIL' && v2.codes.includes('THROUGHPUT_SHORT') && v2.counts.readyNeeded === 6, show(v2))
  check('🔴 반례2 공급이 6 이면 손실 1 을 감당한다 → PASS',
    d5({ readyLoss: { published: 5, lost: 1 }, readyPerSource: yieldFor(6) }).verdict === 'PASS')
  const scaled = readyRequirementOf(5, { published: 3, lost: 1 })
  check('🔴 손실률은 같은 창 실측 비율로 목표에 맞춘다 — D3 실측(공개 3 · 손실 1) → D5 보충 ceil(5/3)=2',
    scaled.kind === 'measured' && scaled.lossNeeded === 2 && scaled.readyNeeded === 7, JSON.stringify(scaled))
  const ok0 = readyRequirementOf(100, { published: 37, lost: 0 })
  check('🔴 손실 0 이면 어느 단계에서도 보충 0 (d100 → 100)', ok0.kind === 'measured' && ok0.readyNeeded === 100)
}

console.log('\n② 반례 3 — 손실 근거 없음 → UNKNOWN (0 으로 읽지 않는다)')
{
  const v = d5({ readyLoss: null })
  check('🔴 반례3 readyLoss=null → UNKNOWN READY_LOSS_UNKNOWN · readyNeeded 를 만들지 않는다',
    v.verdict === 'UNKNOWN' && v.codes.includes('READY_LOSS_UNKNOWN') && !('readyNeeded' in v.counts), show(v))
  check('🔴 반례3 손실을 모르면 공급 비용도 모른다 → SUPPLY_COST_UNKNOWN', v.codes.includes('SUPPLY_COST_UNKNOWN'), show(v))
  const z = d5({ readyLoss: { published: 0, lost: 0 } })
  check('🔴 결말 난 행 0(공개 0 · 손실 0) → UNKNOWN (관측 없음 ≠ 손실 0)',
    z.verdict === 'UNKNOWN' && z.codes.includes('READY_LOSS_UNKNOWN'), show(z))
  check('🔴 손상된 사실(음수 · 소수)은 UNKNOWN',
    readyRequirementOf(5, { published: -1, lost: 0 }).kind === 'unknown'
    && readyRequirementOf(5, { published: 5, lost: 0.5 }).kind === 'unknown')
  const u = d5({ readyLoss: { published: 0, lost: 3 } })
  check('🔴 공개 0 · 손실 3 → 어떤 생산으로도 못 채운다 → FAIL (UNKNOWN 으로 숨기지 않는다)',
    u.verdict === 'FAIL' && u.codes.includes('THROUGHPUT_SHORT') && u.codes.includes('SUPPLY_COST_SHORT'), show(u))
  check('🔴 손실 UNKNOWN 이어도 다른 FAIL 은 FAIL 로 남는다(기회 4)',
    d5({ readyLoss: null, slotValidOpportunities: 4 }).verdict === 'FAIL')
}

console.log('\n③ 반례 4 · 5 — 상세 원천은 authority 가 아니다')
{
  const v = d5({ slotValidOpportunities: 4, readyPerSource: yieldFor(50) })
  check('🔴 반례4 상세·수율이 넉넉해도(공급 50) 슬롯 유효 기회 4 < 5 → FAIL OPPORTUNITY_SHORT',
    v.verdict === 'FAIL' && v.codes.includes('OPPORTUNITY_SHORT'), show(v))
  const strip = (p: string): string => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  const judgePaths = ['src/lib/stage-ladder-generic.ts', 'scripts/lib/stage-preflight-facts.mts']
  const detailAuthority = /PLANNED_DETAIL_PER_PUBLIC_POST|plannedDetailedSourcesPerDay|detailedSourcesRequiredPerDay|d100Plan\b|allD100Plans\b/
  check('🔴 반례5 preflight 판정·사실 경로가 상세 계획값(`PLANNED_DETAIL_PER_PUBLIC_POST` · `d100Plan`)을 읽지 않는다 — 계획값을 바꿔도 결과 불변',
    judgePaths.every((p) => !detailAuthority.test(strip(p))),
    judgePaths.filter((p) => detailAuthority.test(strip(p))).join(','))
  check('🔴 반례5 d100Plan 은 상세 계획값을 비권위 이름으로만 낸다(`detailedSourcesRequiredPerDay` 없음)',
    !/detailedSourcesRequiredPerDay\s*:/.test(strip('src/lib/d100-capacity.ts')))
}

console.log('\n④ 반례 6 — 공급 비용은 처리량과 같은 필요 READY 를 쓴다')
{
  const cost = (lost: number): PreflightVerdict => d5({
    readyLoss: { published: 5, lost }, readyPerSource: yieldFor(50), supplyUsdPerReady: 0.1, supplyDailyUsdCap: 0.55,
  })
  const a = cost(0)
  check('🔴 반례6 손실 0 → 필요 5 × $0.10 = $0.50 ≤ $0.55 → 비용 GREEN (고정 6 × $0.10 = $0.60 이면 FAIL 이었다)',
    a.verdict === 'PASS' && a.counts.readyNeeded === 5, show(a))
  const b = cost(1)
  check('🔴 반례6 손실 1 → 필요 6 × $0.10 = $0.60 > $0.55 → SUPPLY_COST_SHORT (처리량과 같은 6)',
    b.codes.includes('SUPPLY_COST_SHORT') && !b.codes.includes('THROUGHPUT_SHORT') && b.counts.readyNeeded === 6, show(b))
}

console.log('\n⑤ 생산자 — 결말 난 행만 센다')
{
  const r = readyLossOf([
    { status: 'PUBLISHED', count: 5 }, { status: 'EXPIRED', count: 1 }, { status: 'DECLINED', count: 1 },
    { status: 'APPROVED', count: 4 }, { status: 'EDITED', count: 1 },
  ])
  check('🔴 PUBLISHED → 공개 · EXPIRED · DECLINED → 손실 · APPROVED · EDITED → 대기(어느 쪽에도 넣지 않는다)',
    r.fact !== null && r.fact.published === 5 && r.fact.lost === 2 && r.pending === 5, JSON.stringify(r))
  const p = readyLossOf([{ status: 'APPROVED', count: 7 }])
  check('🔴 대기 행만 있으면 null(UNKNOWN) — 손실 0 으로 만들지 않는다', p.fact === null && p.pending === 7, JSON.stringify(p))
  check('🔴 행이 없으면 null(UNKNOWN)', readyLossOf([]).fact === null)
  const facts = readFileSync('scripts/lib/stage-preflight-facts.mts', 'utf-8')
  check('🔴 생산자는 수율과 같은 창 · 같은 자동 도장(AUTO_DECIDER)으로 결말을 읽는다',
    /groupBy\(\{\s*by: \['status'\],\s*where: \{ decidedBy: AUTO_DECIDER, decidedAt: \{ gte: windowFrom, lt: windowTo \} \}/.test(facts)
    && /readyLoss,\n/.test(facts))
}

console.log('\n⑥ 소스 잠금 — 고정 할증이 판정 경로로 돌아오지 않는다')
{
  const strip = (p: string): string => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  const paths = [
    'src/lib/stage-ladder-generic.ts', 'src/lib/d100-capacity.ts', 'scripts/lib/stage-preflight-facts.mts',
    'scripts/stage-controller.mts', 'scripts/d100-master-readiness.mts',
  ]
  const margin = /READY_NET_MARGIN|readyQualifiedRequiredPerDay|\*\s*1\.2\b|\b1\.2\s*\*/
  check('🔴 판정·보고 경로 어디에도 READY 고정 할증(1.2 · READY_NET_MARGIN)이 없다',
    paths.every((p) => !margin.test(strip(p))), paths.filter((p) => margin.test(strip(p))).join(','))
  const judge = strip('src/lib/stage-ladder-generic.ts')
  check('🔴 처리량과 공급 비용이 같은 `readyRequirementOf` 결과(req)를 쓴다 — 두 번째 필요량 계산 없음',
    (judge.match(/[=(]\s*readyRequirementOf\(/g) ?? []).length === 1 && /capacity < req\.readyNeeded/.test(judge)
    && /req\.readyNeeded \* facts\.supplyUsdPerReady/.test(judge))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · 파일 write 0 · LLM 0.')
if (fail > 0) process.exit(1)
