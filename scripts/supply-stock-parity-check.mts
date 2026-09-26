#!/usr/bin/env tsx
/**
 * 🔴 **공급 capacity 준비 · 재고 분류 · Persona 여력 대기 — 순수 계약** (2026-09-26 · DB 0 · 네트워크 0)
 *
 *   ① 재고 분류(`classifyStock`) — 정본 결과를 칸으로 나누기만 한다. 칸은 겹치지 않고 빠지지 않는다.
 *      검토 대기는 publishable 이 아니고 WIP 에는 남는다. TTL 은 신선 재고가 아니다.
 *      깨진 복구가 있으면 러너는 전체를 멈추므로 발행 가능 0 이다.
 *   ② 공급 계획 눈금 — capacity. 발행 눈금 — release. 새 단계·새 숫자 없음.
 *   ③ Persona 여력 대기 — `noDraft`(초안 실패)가 아니라 `personaCapacityDeferred` 로 적는다.
 *   ④ 소비자 연결 — 공급 러너 · 보충기 · wave-c 가 공용 분류를 실제로 부른다.
 *
 *   실제 DB 로 부딪혀 보는 반례(공급 9 · 발행 0 / release d1 · capacity d5)는
 *   `supply:stock-parity-db-check`(격리 Postgres)가 맡는다.
 */
import { readFileSync } from 'node:fs'

import { classifyStock, STOCK_BUCKETS, type LoadedStock, type PublishPlan } from './lib/publishable-stock.mjs'
import { supplyPlanningProfile } from './supply-process.mjs'
import { resolveScale } from '../src/lib/scale-runtime'
import { PROFILES, CAPACITY_ENV, RELEASE_ENV, RELEASE_STAGES } from '../src/lib/scale-profile'
import { pickDraft, DRAFT_REASON_LABEL } from '../src/lib/micro-seed-auto-draft'
import type { RejectCode } from '../src/lib/original-post-auto-publish'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

/** 🔴 분류가 읽는 칸만 채운 입력 — 판정은 이미 끝난 값이다(정본이 낸 모양 그대로) */
function fixture(o: {
  rejected?: { id: string; code: RejectCode }[]
  targets?: string[]
  held?: { id: string; hold: 'TTL_EXPIRED' | 'AGE_UNKNOWN' | 'RECOVERY_STALE' }[]
  ready?: string[]
  deferred?: string[]
  exceptions?: string[]
  broken?: string[]
}): { loaded: LoadedStock; plan: PublishPlan } {
  const rejected = o.rejected ?? []
  const targets = (o.targets ?? []).map((id) => ({ id }))
  const loaded = { queueTotal: rejected.length + targets.length, rejected, targets } as unknown as LoadedStock
  const plan = {
    prepared: { held: (o.held ?? []).map((h) => ({ queueId: h.id, hold: h.hold, reason: '' })) },
    assignmentReady: o.ready ?? [],
    autoDeferred: (o.deferred ?? []).map((id) => ({ id, codes: ['TOO_SOON'] })),
    autoExceptions: (o.exceptions ?? []).map((id) => ({ id, codes: ['VOICE'] })),
    brokenRecovery: (o.broken ?? []).map((id) => ({ id, problem: 'x' })),
  } as unknown as PublishPlan
  return { loaded, plan }
}

console.log('\n══ 공급 capacity · 재고 분류 · 여력 대기 (DB 0 · 네트워크 0 · LLM 0) ══\n')

console.log('① 재고 분류 — 정본 결과를 나누기만 한다')
{
  /** 🔴 운영 반례 모양: 검토 대기 8 · 사람 1(TTL) · legacy 1 · gate 1 */
  const review = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, code: 'HUMAN_REVIEW_REQUIRED' as const }))
  const f = fixture({
    rejected: [...review, { id: 'legacy', code: 'PROFILE' }, { id: 'gate', code: 'GATE' }],
    targets: ['ttl'], held: [{ id: 'ttl', hold: 'TTL_EXPIRED' }],
  })
  const c = classifyStock(f)
  check('🔴 🔴 **운영 반례 — 발행 가능 0** (앞판 공급 표시 9)', c.counts.publishableNow === 0)
  check('🔴 🔴 **검토 대기 8건은 humanReviewPending** — publishable 이 아니다',
    c.counts.humanReviewPending === 8 && !c.ids.publishableNow.some((id) => id.startsWith('m')))
  check('🔴 🔴 **검토 대기는 WIP 에 남는다**', review.every((r) => c.personaWipIds.includes(r.id)))
  check('🔴 TTL 만료는 ttlExpired — 신선 재고가 아니다', same(c.ids.ttlExpired, ['ttl']) && !c.ids.publishableNow.includes('ttl'))
  check('legacy → profileMismatch · gate → gateBlocked', same(c.ids.profileMismatch, ['legacy']) && same(c.ids.gateBlocked, ['gate']))
  check('🔴 legacy · gate 탈락은 WIP 가 아니다', !c.personaWipIds.includes('legacy') && !c.personaWipIds.includes('gate'))
  const total = STOCK_BUCKETS.reduce((n, b) => n + c.counts[b], 0)
  check('🔴 칸의 합 = 대기열 전체', total === c.queueTotal && total === 11)

  const g = classifyStock(fixture({
    targets: ['ok', 'far', 'age', 'pinned', 'odd'],
    held: [{ id: 'age', hold: 'AGE_UNKNOWN' }],
    ready: ['ok', 'pinned'], deferred: ['pinned'], exceptions: ['odd'],
  }))
  check('배정 성공만 publishableNow', same(g.ids.publishableNow, ['ok']))
  check('🔴 배정 실패 · 기존 배정 막힘(시간 상한 · 예외)은 assignmentBlocked',
    same(g.ids.assignmentBlocked, ['far', 'pinned', 'odd']))
  check('시각 미상은 freshnessHeld — TTL 칸과 섞지 않는다', same(g.ids.freshnessHeld, ['age']) && g.counts.ttlExpired === 0)

  const h = classifyStock(fixture({ targets: ['a', 'b'], ready: ['a', 'b'], broken: ['b'] }))
  check('🔴 깨진 복구가 하나라도 있으면 러너가 멈춘다 → 발행 가능 0', h.counts.publishableNow === 0
    && same(h.ids.assignmentBlocked, ['a', 'b']))

  const auto = classifyStock(fixture({
    rejected: [{ id: 'c', code: 'AUTO_READY_CLOSED' }, { id: 's', code: 'AUTO_READY_STALE' }, { id: 't', code: 'TITLE_COPIES_SOURCE' }],
  }))
  check('🔴 자동 도장이 닫혔거나 낡은 기계 초안도 검토 대기다', same(auto.ids.humanReviewPending, ['c', 's']))
  check('제목 복제는 gateBlocked', same(auto.ids.gateBlocked, ['t']))
}

console.log('\n② 공급은 capacity · 발행은 release — 정본 값을 읽기만 한다')
{
  for (const rel of RELEASE_STAGES) {
    for (const cap of RELEASE_STAGES) {
      const scale = resolveScale({ [RELEASE_ENV]: rel, [CAPACITY_ENV]: cap })
      const p = supplyPlanningProfile(scale)
      if (!(p.stage === scale.capacityStage && p.profile === scale.capacityProfile && p.profile === PROFILES[scale.capacityStage])) {
        check(`release ${rel} · capacity ${cap}`, false, `${p.stage}`)
      }
    }
  }
  check('🔴 모든 release × capacity 조합에서 공급 눈금 = capacity (새 단계 없음)', true)
  const s15 = resolveScale({ [RELEASE_ENV]: 'd1', [CAPACITY_ENV]: 'd5' })
  check('🔴 🔴 **release d1 · capacity d5 → 공급 d5 · 발행 d1**',
    supplyPlanningProfile(s15).stage === 'd5' && s15.releaseStage === 'd1' && s15.releaseProfile === PROFILES.d1)
}

console.log('\n③ Persona 여력 대기 — 초안 실패가 아니다')
{
  const j = { sourceArticleId: '453182', decision: 'AUTO_SEED', semanticRisks: [] } as never
  const base = { judgement: j, drafts: [], seenTitles: new Set<string>(), seenBodies: new Set<string>(), sourceUsed: false }
  const deferred = pickDraft({ ...base, personaDeferred: true }, '2026-09-26T03:15:15Z')
  check('🔴 🔴 **화자가 없어 미룬 원천 → personaCapacityDeferred** (앞판: noDraft)',
    deferred.reason === 'personaCapacityDeferred' && deferred.decision === 'AUTO_HOLD' && deferred.draftNo === null)
  check('🔴 초안이 정말 없으면 여전히 noDraft — 둘을 가른다', pickDraft(base, '2026-09-26T03:15:15Z').reason === 'noDraft')
  check('판정 탈락이 먼저다 — 여력 대기가 notAutoSeed 를 덮지 않는다',
    pickDraft({ ...base, judgement: { ...(j as object), decision: 'AUTO_HOLD' } as never, personaDeferred: true }, 'x').reason === 'notAutoSeed')
  check('사람이 읽는 사유가 초안 실패가 아니라고 말한다', DRAFT_REASON_LABEL.personaCapacityDeferred.includes('초안 실패 아님'))

  const src = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  const at = src.indexOf('const slotCodes = slotOf.get(j.sourceArticleId) ?? []')
  const line = src.slice(at, src.indexOf('\n', src.indexOf('if (slotCodes.length === 0)', at)))
  check('🔴 🔴 **생성 러너가 빈 화자 묶음을 여력 대기로 적는다** (호출 전)',
    at > 0 && /if \(slotCodes\.length === 0\) \{ capacityDeferred \+= 1; holdPick\(\{ personaDeferred: true \}\); continue \}/.test(line),
    line.trim().slice(-120))
  check('holdPick 이 그 표식을 pickDraft 로 넘긴다',
    /personaDeferred: o\.personaDeferred === true/.test(src))
}

console.log('\n④ 소비자 연결 — 공용 분류를 실제로 부른다 · 거짓 문구가 없다')
{
  const proc = readFileSync('scripts/supply-process.mts', 'utf-8')
  const fill = readFileSync('scripts/micro-seed-supply-autofill.mts', 'utf-8')
  const wave = readFileSync('scripts/wave-c-readiness.mts', 'utf-8')
  const FALSE = /러너가 먹을 수 있는 것/
  /** 🔴 주석(앞판 기록)은 빼고 **찍히는 코드**만 본다 */
  const code = (t: string): string => t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*\*)/.test(l)).join('\n')
  check('🔴 공급 러너 snapshot 이 공용 분류를 부른다',
    /classification = \(await loadStockClassification\(prisma, opts\.env, opts\.now\)\)\.classification/.test(proc))
  check('🔴 공급 러너 화자 여력이 공용 분류와 capacity 눈금을 쓴다',
    /const planning = supplyPlanningProfile\(opts\.scale\)/.test(proc) && /classification\.personaWipIds/.test(proc)
    && /profileOf: \(\) => \(\{\s*dailyTarget: planning\.profile\.dailyTarget/.test(proc))
  check('🔴 공급 러너가 main 의 scale 을 넘긴다', /writeSpeakerLoad\(prisma, runId, scale\)/.test(proc))
  check('🔴 보충기가 공용 분류로 발행 가능 재고를 잰다',
    /loadStockClassification\(prisma, process\.env, new Date\(\)\)/.test(fill)
    && /stockBandOf\(publishableNow, LIMITS\)/.test(fill))
  check('🔴 wave-c 준비도가 publishableNow 로 잰다', /classification\.counts\.publishableNow/.test(wave) && !/readStock\(/.test(wave))
  check('🔴 🔴 **"러너가 먹을 수 있는 것" 이라는 거짓 문구가 없다**', !FALSE.test(code(proc)) && !FALSE.test(code(fill)))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0\n')
if (fail > 0) process.exit(1)
