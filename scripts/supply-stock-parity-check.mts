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
 *   ⑤ 옛 품질 계약 기계 초안 — 큐에 남고 · 자동 발행 0 · 지금 계약의 Persona WIP 0 (2026-09-28).
 *      지금 계약 검토 대기 · 발행 가능 · 사람이 검토한 옛 계약 행은 기존 뜻 그대로다.
 *
 *   실제 DB 로 부딪혀 보는 반례(공급 9 · 발행 0 / release d1 · capacity d5)는
 *   `supply:stock-parity-db-check`(격리 Postgres)가 맡는다.
 */
import { readFileSync } from 'node:fs'

import {
  classifyStock, STOCK_BUCKETS, STOCK_BUCKET_META,
  type LoadedStock, type PublishPlan, type StockBucket, type RecoveryOwner,
} from './lib/publishable-stock.mjs'
import { supplyPlanningProfile } from './supply-process.mjs'
import { resolveScale } from '../src/lib/scale-runtime'
import { PROFILES, RUNTIME_PROFILES, CAPACITY_ENV, RELEASE_ENV, RELEASE_STAGES } from '../src/lib/scale-profile'
import { pickDraft, DRAFT_REASON_LABEL } from '../src/lib/micro-seed-auto-draft'
import type { RejectCode } from '../src/lib/original-post-auto-publish'
import {
  currentQualityContract, readQualityContract, QUALITY_CONTRACT_KEY, QUALITY_CONTRACT_VERSION,
} from '../src/lib/quality-contract'
import { digestOf } from '../src/lib/auto-ready-v2'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
/**
 * 🔴 **프로필은 값으로 비교한다.** CI(Node 20)의 tsx 는 같은 파일을 ESM·CJS 두 인스턴스로 적재할 수 있어
 *    `===` 가 값이 같아도 거짓이 된다(PR #578 첫 CI 실측). 검사의 뜻은 "같은 눈금" 이지 "같은 객체" 가 아니다.
 */
const sameProfile = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

type ContractMark = 'current' | 'otherDigest' | 'otherVersion' | 'none'
/** 🔴 PR #591 에 기대지 않는다 — "지금 계약 ≠ 행의 계약" 을 행 쪽 표식으로 만든다 */
const gateOfMark = (m: ContractMark): Record<string, unknown> => {
  switch (m) {
    case 'current': return { holds: [], blocks: [], [QUALITY_CONTRACT_KEY]: currentQualityContract() }
    case 'otherDigest': return { holds: [], blocks: [], [QUALITY_CONTRACT_KEY]: { version: QUALITY_CONTRACT_VERSION, digest: digestOf('옛 게이트 · 옛 검수') } }
    case 'otherVersion': return { holds: [], blocks: [], [QUALITY_CONTRACT_KEY]: { version: 'quality-v0', digest: digestOf('옛 판') } }
    case 'none': return { holds: [], blocks: [] }
    default: {
      const never: never = m
      return never
    }
  }
}

/** 🔴 분류가 읽는 칸만 채운 입력 — 판정은 이미 끝난 값이다(정본이 낸 모양 그대로) */
function fixture(o: {
  rejected?: { id: string; code: RejectCode }[]
  targets?: string[]
  held?: { id: string; hold: 'SOURCE_TOO_OLD_AT_SLOT' | 'POSTED_MISSING' | 'EVIDENCE_MISSING' }[]
  ready?: string[]
  deferred?: string[]
  exceptions?: string[]
  broken?: string[]
  /** 새 배정이 안 된 행 — 정본 `BatchAssignment` 의 `deferredBy` · `blocked` 그대로 */
  unassigned?: { id: string; deferredBy?: string[]; blocked?: { code: string; reasons: { code: string }[] }[] }[]
  /** 기계 글의 말투 — 주지 않으면 사람 profile(말투 없음)이다 */
  voiceOf?: Record<string, string>
  /**
   * 🔴 행에 저장된 품질 계약 표식 — 주지 않으면 **지금 계약**이다(`currentQualityContract()`).
   *    `otherDigest` 같은 판 다른 digest(계약을 올린 뒤의 옛 행) · `otherVersion` 옛 판 · `none` 표식 없음(legacy)
   */
  contractOf?: Record<string, ContractMark>
}): { loaded: LoadedStock; plan: PublishPlan } {
  const rejected = o.rejected ?? []
  const targets = (o.targets ?? []).map((id) => ({ id }))
  const queueCandidates = (o.targets ?? []).map((id) => {
    const v = o.voiceOf?.[id]
    return v === undefined
      ? { queueId: id, voice: null, profile: 'human' }
      : { queueId: id, voice: { personaCode: v, bundleDigest: `bd-${v}`, comments: 3 }, profile: 'machine' }
  })
  /** 🔴 분류가 읽는 저장값 — 정본 로더처럼 `allRows` 에 모든 행이 있다 */
  const allRows = [...rejected.map((r) => r.id), ...targets.map((t) => t.id)]
    .map((id) => ({ id, gateResults: gateOfMark(o.contractOf?.[id] ?? 'current') }))
  const loaded = { queueTotal: rejected.length + targets.length, rejected, targets, queueCandidates, allRows } as unknown as LoadedStock
  const assignOf = new Map((o.unassigned ?? []).map((u) => [u.id, {
    queueId: u.id, assigned: null, deferredBy: u.deferredBy ?? [], blocked: u.blocked ?? [], recoveryProblem: null,
  }]))
  const plan = {
    prepared: { held: (o.held ?? []).map((h) => ({ queueId: h.id, hold: h.hold, reason: '' })) },
    assignmentReady: o.ready ?? [],
    assignOf,
    autoDeferred: (o.deferred ?? []).map((id) => ({ id, codes: ['TOO_SOON'] })),
    autoExceptions: (o.exceptions ?? []).map((id) => ({ id, codes: ['VOICE_MISMATCH(x)'] })),
    brokenRecovery: (o.broken ?? []).map((id) => ({ id, problem: 'x' })),
  } as unknown as PublishPlan
  return { loaded, plan }
}
const wip = (c: ReturnType<typeof classifyStock>, id: string): boolean => c.personaWipIds.includes(id)

console.log('\n══ 공급 capacity · 재고 분류 · 여력 대기 (DB 0 · 네트워크 0 · LLM 0) ══\n')

console.log('① 재고 분류 — 정본 결과를 나누기만 한다 · 칸마다 WIP 여부와 복구 주체')
{
  /** 🔴 마스터 계약 그대로 — 칸 표가 이 값과 다르면 빨갛다 */
  const EXPECT: Record<StockBucket, { wip: boolean; owner: RecoveryOwner }> = {
    publishableNow: { wip: true, owner: 'none' },
    haltedByBrokenRecovery: { wip: true, owner: 'human' },
    humanReviewPending: { wip: true, owner: 'human' },
    autoReadyClosed: { wip: true, owner: 'autoReadyGate' },
    autoReadyStale: { wip: true, owner: 'human' },
    assignmentDeferred: { wip: true, owner: 'time' },
    // 🔴 (2026-09-30) 원천 가치 없음 · 증거 모름 — 사람이 살리는 칸이 아니다(owner none · 트랜잭션이 EXPIRED)
    releaseIneligible: { wip: false, owner: 'none' },
    releaseUnknown: { wip: false, owner: 'none' },
    recoveryBroken: { wip: false, owner: 'human' },
    assignmentException: { wip: false, owner: 'human' },
    // 🔴 옛 품질 계약 기계 초안 — WIP 아님 · 사람 검토로만 나간다 (2026-09-28)
    qualityContractMismatch: { wip: false, owner: 'human' },
    profileMismatch: { wip: false, owner: 'none' },
    gateBlocked: { wip: false, owner: 'human' },
  }
  check('🔴 칸 표 = 계약 (WIP 여부 · 복구 주체)', STOCK_BUCKETS.length === Object.keys(EXPECT).length
    && STOCK_BUCKETS.every((b) => STOCK_BUCKET_META[b].wip === EXPECT[b].wip && STOCK_BUCKET_META[b].owner === EXPECT[b].owner),
    STOCK_BUCKETS.filter((b) => STOCK_BUCKET_META[b].wip !== EXPECT[b]?.wip || STOCK_BUCKET_META[b].owner !== EXPECT[b]?.owner).join(','))

  /** 🔴 운영 반례 모양: 검토 대기 8 · 사람 1(TTL) · legacy 1 · gate 1 */
  const review = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, code: 'HUMAN_REVIEW_REQUIRED' as const }))
  const f = fixture({
    rejected: [...review, { id: 'legacy', code: 'PROFILE' }, { id: 'gate', code: 'GATE' }],
    targets: ['ttl'], held: [{ id: 'ttl', hold: 'SOURCE_TOO_OLD_AT_SLOT' }],
  })
  const c = classifyStock(f)
  check('🔴 🔴 **운영 반례 — 발행 가능 0** (앞판 공급 표시 9)', c.counts.publishableNow === 0)
  check('🔴 🔴 **검토 대기 8건은 humanReviewPending** — publishable 이 아니다',
    c.counts.humanReviewPending === 8 && !c.ids.publishableNow.some((id) => id.startsWith('m')))
  check('🔴 🔴 **검토 대기는 WIP 에 남는다**', review.every((r) => wip(c, r.id)))
  check('🔴 슬롯에서 원문 72h 초과는 releaseIneligible — 발행 재고가 아니다', same(c.ids.releaseIneligible, ['ttl']) && !c.ids.publishableNow.includes('ttl'))
  check('🔴 🔴 **원천 가치 없는 행은 WIP 를 점유하지 않는다**', !wip(c, 'ttl'))
  check('legacy → profileMismatch · gate → gateBlocked', same(c.ids.profileMismatch, ['legacy']) && same(c.ids.gateBlocked, ['gate']))
  check('🔴 legacy · gate 탈락은 WIP 가 아니다', !wip(c, 'legacy') && !wip(c, 'gate'))
  const total = STOCK_BUCKETS.reduce((n, b) => n + c.counts[b], 0)
  check('🔴 칸의 합 = 대기열 전체', total === c.queueTotal && total === 11)

  const g = classifyStock(fixture({
    targets: ['ok', 'age', 'stale', 'pinT', 'pinX', 'seat', 'weekly', 'life'],
    held: [{ id: 'age', hold: 'POSTED_MISSING' }, { id: 'stale', hold: 'EVIDENCE_MISSING' }],
    ready: ['ok'], deferred: ['pinT'], exceptions: ['pinX'],
    unassigned: [
      { id: 'seat', deferredBy: ['P03'] },
      { id: 'weekly', blocked: [{ code: 'P01', reasons: [{ code: 'WEEKLY_CAP' }] }, { code: 'P02', reasons: [{ code: 'LIFE_HISTORY' }] }] },
      { id: 'life', blocked: [{ code: 'P01', reasons: [{ code: 'LIFE_HISTORY' }, { code: 'TOO_SOON' }] }] },
    ],
  }))
  check('배정 성공만 publishableNow · WIP', same(g.ids.publishableNow, ['ok']) && wip(g, 'ok'))
  check('🔴 🔴 **기존 배정 시간성 유예(route defer) → assignmentDeferred · WIP 유지**',
    g.ids.assignmentDeferred.includes('pinT') && wip(g, 'pinT'))
  check('🔴 🔴 **기존 배정 영구 예외(route exception) → WIP 점유 금지**',
    g.ids.assignmentException.includes('pinX') && !wip(g, 'pinX'))
  check('🔴 새 배정 — 자리가 없어 밀림(`deferredBy`) → 유예 · WIP', g.ids.assignmentDeferred.includes('seat') && wip(g, 'seat'))
  check('🔴 새 배정 — 시간성 사유만 가진 Persona 가 있다 → 유예 · WIP', g.ids.assignmentDeferred.includes('weekly') && wip(g, 'weekly'))
  check('🔴 🔴 **새 배정 — 시간이 풀지 않는 사유가 섞인 Persona 뿐 → 예외 · WIP 아님**',
    g.ids.assignmentException.includes('life') && !wip(g, 'life'))
  check('🔴 원천 증거 모름(게시 시각 없음 · 증거 없음) → releaseUnknown · WIP 아님',
    same(g.ids.releaseUnknown, ['age', 'stale']) && !wip(g, 'age') && !wip(g, 'stale'))

  /**
   * 🔴 **마스터 반례 (2026-09-26 3차)** — voice=P03 · 성인 딸 글 · P03 무자녀(NO_CHILDREN) ·
   *    P01·P02 는 자녀가 있지만 주간 상한 + 최소 간격 · deferredBy 없음.
   *    시간이 풀려도 P01·P02 는 남의 말투, P03 은 계속 무자녀 → **예외 · WIP 아님**.
   */
  const cx = classifyStock(fixture({
    targets: ['daughter'], voiceOf: { daughter: 'P03' },
    unassigned: [{ id: 'daughter', blocked: [
      { code: 'P01', reasons: [{ code: 'WEEKLY_CAP' }, { code: 'TOO_SOON' }] },
      { code: 'P02', reasons: [{ code: 'WEEKLY_CAP' }, { code: 'TOO_SOON' }] },
      { code: 'P03', reasons: [{ code: 'NO_CHILDREN' }] },
    ] }],
  }))
  check('🔴 🔴 **남의 말투 Persona 의 시간 코드로 유예를 추정하지 않는다 → 예외 · WIP 아님**',
    same(cx.ids.assignmentException, ['daughter']) && !wip(cx, 'daughter'))
  /** 🔴 같은 글쓴이의 리듬만 막힌 경우 — 유예 · WIP */
  const cy = classifyStock(fixture({
    targets: ['own'], voiceOf: { own: 'P01' },
    unassigned: [{ id: 'own', blocked: [
      { code: 'P01', reasons: [{ code: 'WEEKLY_CAP' }, { code: 'TOO_SOON' }] },
      { code: 'P03', reasons: [{ code: 'NO_CHILDREN' }] },
    ] }],
  }))
  check('🔴 🔴 **글쓴이 본인이 리듬(주간 상한 · 최소 간격)만 막혔다 → 유예 · WIP**',
    same(cy.ids.assignmentDeferred, ['own']) && wip(cy, 'own'))
  const cz = classifyStock(fixture({
    targets: ['mix'], voiceOf: { mix: 'P01' },
    unassigned: [{ id: 'mix', blocked: [{ code: 'P01', reasons: [{ code: 'WEEKLY_CAP' }, { code: 'NO_CHILDREN' }] }] }],
  }))
  check('🔴 글쓴이 본인에게 비시간성 사유가 섞였다 → 예외', same(cz.ids.assignmentException, ['mix']))

  const h = classifyStock(fixture({ targets: ['a', 'b'], ready: ['a'], broken: ['b'] }))
  check('🔴 깨진 복구가 있으면 러너가 멈춘다 → 발행 가능 0', h.counts.publishableNow === 0)
  check('🔴 🔴 **깨진 복구 행은 WIP 를 점유하지 않는다**', same(h.ids.recoveryBroken, ['b']) && !wip(h, 'b'))
  check('🔴 멈춤에 걸린 정상 행은 WIP 에 남는다 (그 행 탓이 아니다)', same(h.ids.haltedByBrokenRecovery, ['a']) && wip(h, 'a'))

  const auto = classifyStock(fixture({
    rejected: [{ id: 'c', code: 'AUTO_READY_CLOSED' }, { id: 's', code: 'AUTO_READY_STALE' }, { id: 't', code: 'TITLE_COPIES_SOURCE' }],
  }))
  check('🔴 🔴 **자동 도장 닫힘 · 낡음은 검토 대기와 다른 칸이다**',
    same(auto.ids.autoReadyClosed, ['c']) && same(auto.ids.autoReadyStale, ['s']) && auto.counts.humanReviewPending === 0)
  check('🔴 닫힘은 자동 READY 문이 풀고 · 낡음은 사람이 푼다 — 둘 다 WIP',
    STOCK_BUCKET_META.autoReadyClosed.owner === 'autoReadyGate' && STOCK_BUCKET_META.autoReadyStale.owner === 'human'
    && wip(auto, 'c') && wip(auto, 's'))
  check('제목 복제는 gateBlocked', same(auto.ids.gateBlocked, ['t']))
}

console.log('\n② 공급은 capacity · 발행은 release — 정본 값을 읽기만 한다')
{
  for (const rel of RELEASE_STAGES) {
    for (const cap of RELEASE_STAGES) {
      const scale = resolveScale({ [RELEASE_ENV]: rel, [CAPACITY_ENV]: cap })
      const p = supplyPlanningProfile(scale)
      if (!(p.stage === scale.capacityStage && sameProfile(p.profile, scale.capacityProfile)
        && sameProfile(p.profile, RUNTIME_PROFILES[scale.capacityStage]))) {
        check(`release ${rel} · capacity ${cap}`, false, `${p.stage}`)
      }
    }
  }
  check('🔴 모든 release × capacity 조합에서 공급 눈금 = capacity (새 단계 없음)', true)
  const s15 = resolveScale({ [RELEASE_ENV]: 'd1', [CAPACITY_ENV]: 'd5' })
  check('🔴 🔴 **release d1 · capacity d5 → 공급 d5 · 발행 d1**',
    supplyPlanningProfile(s15).stage === 'd5' && s15.releaseStage === 'd1' && sameProfile(s15.releaseProfile, PROFILES.d1))
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
    /const view = await loadStockClassification\(prisma, opts\.env, opts\.now\)\s*\n\s*classification = view\.classification/.test(proc))
  check('🔴 공급 러너 화자 여력이 공용 분류와 capacity 눈금을 쓴다',
    /const planning = supplyPlanningProfile\(opts\.scale\)/.test(proc) && /classification\.personaWipIds/.test(proc)
    && /profileOf: \(\) => \(\{\s*dailyTarget: planning\.profile\.dailyTarget/.test(proc))
  check('🔴 공급 러너가 main 의 scale 을 넘긴다', /writeSpeakerLoad\(prisma, runId, scale\)/.test(proc))
  check('🔴 🔴 **공급 러너 main 의 회차 id 가 RUN_AT 에서 나온다** (다시 new Date() 를 만들지 않는다)',
    /const now = RUN_AT\n\s*const runId = runIdOf\(now\)/.test(proc))
  check('🔴 공급 러너 RUN_AT 은 자식과 같은 규칙(runClockFrom)으로 읽는다',
    /export const RUN_CLOCK = runClockFrom\(process\.env\)/.test(proc))
  check('🔴 보충기가 공용 분류로 발행 가능 재고를 잰다',
    /loadStockClassification\(prisma, process\.env, new Date\(\)\)/.test(fill)
    // 🔴 (2026-09-30) 재고 눈금(stockBandOf · 700 LIMITS)은 지웠다 — 적재 상한은 `--up-to` 하나다
    && !/stockBandOf|LIMITS|STOCK_BANDS/.test(code(fill)))
  check('🔴 wave-c 준비도가 publishableNow 로 잰다', /classification\.counts\.publishableNow/.test(wave) && !/readStock\(/.test(wave))
  check('🔴 🔴 **"러너가 먹을 수 있는 것" 이라는 거짓 문구가 없다**', !FALSE.test(code(proc)) && !FALSE.test(code(fill)))
}

console.log('\n⑤ 🔴 옛 품질 계약 기계 초안 — 큐에 남고 · 자동 발행 0 · 지금 계약의 Persona WIP 0')
{
  /**
   * 🔴 반례 ① — 운영 모양: 옛 계약 기계 초안 46건(검토 대기) · 지금 계약이 올라갔다(digest 다름).
   *    판 같고 digest 다름 · 옛 판 · 표식 없음(legacy) 셋을 섞는다 — 셋 다 정본상 "지금 계약 아님" 이다.
   */
  const marks: ContractMark[] = ['otherDigest', 'otherVersion', 'none']
  const old = Array.from({ length: 46 }, (_, i) => ({ id: `v1-${i}`, code: 'HUMAN_REVIEW_REQUIRED' as const }))
  const contractOf = Object.fromEntries(old.map((r, i) => [r.id, marks[i % 3]!])) as Record<string, ContractMark>
  const c = classifyStock(fixture({ rejected: old, contractOf }))
  check('🔴 🔴 **옛 계약 46건 → 전부 qualityContractMismatch** (앞판: humanReviewPending)',
    c.counts.qualityContractMismatch === 46 && c.counts.humanReviewPending === 0, JSON.stringify(c.counts))
  check('🔴 🔴 **지금 계약의 Persona WIP 점유 0** (앞판: 46)', c.personaWipIds.length === 0, String(c.personaWipIds.length))
  check('🔴 자동 발행 가능 0', c.counts.publishableNow === 0)
  check('🔴 큐에서 빠지지 않는다 — 칸의 합 = 대기열 46', STOCK_BUCKETS.reduce((n, b) => n + c.counts[b], 0) === 46 && c.queueTotal === 46)
  check('fixture 표식은 모양이 온전하다 — 같은 판 · digest 만 다르다(모양 탓 legacy 가 아니다)',
    readQualityContract(gateOfMark('otherDigest'))?.version === QUALITY_CONTRACT_VERSION
    && readQualityContract(gateOfMark('otherVersion')) !== null && readQualityContract(gateOfMark('none')) === null)
  check('🔴 표식 없음(legacy) · 옛 판 · 같은 판 다른 digest 가 모두 불일치다',
    marks.every((m) => old.some((r) => contractOf[r.id] === m && c.ids.qualityContractMismatch.includes(r.id))))

  /** 🔴 반례 ② ③ ④ — 지금 계약 검토 대기 · 발행 가능 · 사람이 검토한 옛 계약 행 */
  const mix = classifyStock(fixture({
    rejected: [
      { id: 'curReview', code: 'HUMAN_REVIEW_REQUIRED' },
      { id: 'oldReview', code: 'HUMAN_REVIEW_REQUIRED' },
      { id: 'oldAuto', code: 'QUALITY_CONTRACT_MISMATCH' },
      { id: 'curClosed', code: 'AUTO_READY_CLOSED' },
    ],
    targets: ['curReady', 'humanOld', 'humanOldDeferred'],
    ready: ['curReady', 'humanOld'],
    unassigned: [{ id: 'humanOldDeferred', deferredBy: ['P03'] }],
    contractOf: { oldReview: 'otherDigest', oldAuto: 'otherDigest', humanOld: 'otherDigest', humanOldDeferred: 'none' },
  }))
  check('🔴 🔴 **지금 계약 검토 대기는 WIP 에 남는다** (humanReviewPending)',
    same(mix.ids.humanReviewPending, ['curReview']) && wip(mix, 'curReview'))
  check('🔴 🔴 **지금 계약 발행 가능 행은 기존 뜻 그대로** (publishableNow · WIP)',
    mix.ids.publishableNow.includes('curReady') && wip(mix, 'curReady'))
  check('🔴 🔴 **사람이 검토한 옛 계약 행은 제외하지 않는다** — selector 대상이면 배정 규칙이 정한다',
    mix.ids.publishableNow.includes('humanOld') && mix.ids.assignmentDeferred.includes('humanOldDeferred')
    && wip(mix, 'humanOld') && wip(mix, 'humanOldDeferred') && !mix.ids.qualityContractMismatch.includes('humanOld'))
  check('🔴 🔴 **옛 계약 자동 도장 행(QUALITY_CONTRACT_MISMATCH) → 불일치 칸 · WIP 아님**',
    mix.ids.qualityContractMismatch.includes('oldAuto') && !wip(mix, 'oldAuto'))
  check('🔴 지금 계약 자동 도장 닫힘은 그대로 autoReadyClosed · WIP', same(mix.ids.autoReadyClosed, ['curClosed']) && wip(mix, 'curClosed'))
  check('옛 계약 검토 대기 → 불일치 칸 · WIP 아님', mix.ids.qualityContractMismatch.includes('oldReview') && !wip(mix, 'oldReview'))
  check('🔴 사람 검토로만 풀린다 — 복구 주체 human · 자동 READY 문이 아니다',
    STOCK_BUCKET_META.qualityContractMismatch.owner === 'human' && STOCK_BUCKET_META.qualityContractMismatch.wip === false)

  /** 🔴 회귀 ⑨ — 계약 칸이 생겨도 TTL · 배정 · 복구 칸은 그대로다(모든 행이 옛 계약이어도) */
  const allOld = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'otherDigest' as const]))
  const r = classifyStock(fixture({
    targets: ['ttl', 'age', 'pinT', 'pinX', 'b', 'a'], held: [{ id: 'ttl', hold: 'SOURCE_TOO_OLD_AT_SLOT' }, { id: 'age', hold: 'POSTED_MISSING' }],
    deferred: ['pinT'], exceptions: ['pinX'], broken: ['b'], ready: ['a'],
    contractOf: allOld(['ttl', 'age', 'pinT', 'pinX', 'b', 'a']),
  }))
  check('🔴 🔴 **원천 판정 · 기존 배정 유예/예외 · 깨진 복구 분류는 계약과 무관하게 그대로** (selector 대상 행)',
    same(r.ids.releaseIneligible, ['ttl']) && same(r.ids.releaseUnknown, ['age']) && same(r.ids.assignmentDeferred, ['pinT'])
    && same(r.ids.assignmentException, ['pinX']) && same(r.ids.recoveryBroken, ['b']) && same(r.ids.haltedByBrokenRecovery, ['a'])
    && r.counts.qualityContractMismatch === 0)
  const g = classifyStock(fixture({
    rejected: [{ id: 'p', code: 'PROFILE' }, { id: 'gt', code: 'GATE' }, { id: 'st', code: 'AUTO_READY_STALE' }],
    contractOf: allOld(['p', 'gt', 'st']),
  }))
  check('🔴 profile · gate · 도장 낡음 칸도 그대로 (계약 칸이 가로채지 않는다)',
    same(g.ids.profileMismatch, ['p']) && same(g.ids.gateBlocked, ['gt']) && same(g.ids.autoReadyStale, ['st']))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0\n')
if (fail > 0) process.exit(1)
