#!/usr/bin/env tsx
/**
 * d10 activation preparation fixture — 🔴 **DB 0 · 네트워크 0 · LLM 0 · 파일 write 0**
 *
 * 일곱 가지를 고정한다.
 *   ① 준비도 시간축   **지평(완전한 KST 운영일 14일)과 다음 발행 슬롯을 분리했는가**
 *   ② persona 24명    얇은 축을 **측정해서** 메웠는가 · 닉네임이 정본 두세 글자인가
 *   ③ freshness       시각 미상은 hold 인가 · 상한 복구는 사람에게 가는가 · '설' 오탐이 없는가
 *   ④ 수집원 다회      1,147 을 페이지로 쓰지 않는가 · 성공률을 곱하는가 · 보호장치가 있는가
 *   ⑤ d10 dry-run     24명·140건에서 140/140 인가 · 수집 준비도가 **BLOCKED** 인가
 *   ⑥ Gate ⑥-B        salt 를 loadEnvLocal 뒤에 만드는가 · **salt 가 판정을 실제로 바꾸는가**
 *   ⑦ advice/caution  이번 PR 에서 풀지 않았는가 · 다음 작업으로 문서에 남겼는가
 */
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, HORIZON_DAYS, CAPACITY_ENV, RELEASE_ENV,
  nextSlotAnchor, kstMidnight, horizonStart, safeStageFor,
} from '../src/lib/scale-profile'
import { resolveScale } from '../src/lib/scale-runtime'
import {
  simulateStage, simulateAllStages, judgeReadiness, promotionPlan, highestReady, horizonMismatches,
} from '../src/lib/scale-readiness'
import {
  TTL_DAYS, TIMELY_MARKERS, TIMELY_SYLLABLES, classifyTopic, freshnessOf, isAutoPublishable,
  judgeCandidate, orderForPublish, describeFreshness, timelyMarkersIn, type FreshCandidate,
} from '../src/lib/supply-freshness'
import {
  COHORTS, RUNNABLE_COHORTS, CLOSED_COHORTS, TARGET_PERSONA_COUNT, verifyAllCohorts, EXCLUDED_CODES,
} from '../src/lib/persona-cohort'
import { parsePoolDoc, cardToPersona, type PoolCard } from '../src/lib/persona-pool-card'
import { thinAxes, gainOf, coverageOf, THIN_THRESHOLD, type AxisSubject } from '../src/lib/persona-axis-coverage'
import { verifyNamePolicy, candidatesFor, assignCandidates, NAME_LENGTH } from '../src/lib/persona-nickname-candidates'
import {
  SOURCE_FACTS, RUNS_PER_DAY, planSlots, verifySchedule, verifyNoCrossOverlap,
  isolationOf, maxSafeGapHours, pageWindowHours, factsOf, MAX_REQUESTS_PER_DAY,
  effectiveDetailPerDay, theoreticalDetailPerDay,
} from '../src/lib/collect-schedule'
import {
  BACKOFF, BREAKER, backoffMs, breakerOf, budgetOf, canRequest, canRetry, classifyFailure,
  clearByHuman, describeGuard, guardSnapshot, newGuardState, recordFailure, recordRequest,
  recordSuccess, rollBudgetDay,
} from '../src/lib/collect-guard'
import {
  planSupply, collectReadiness, sourceReadiness, requiredCapacityWithMargin, COLLECT_MARGIN_RATIO,
} from '../src/lib/scale-supply-plan'
import {
  JOB_LABELS, currentCapacity, preparedCapacity, inventoryMismatches, runsPlannedMulti,
  sourceOfLabel, type ObservedJob,
} from '../src/lib/collect-inventory'
import { prepareCandidates, priorityTierOf, describePrepared, type QueueCandidate } from '../src/lib/supply-candidates'
import { forecastPublishing } from '../src/lib/supply-capacity-forecast'
import { cardToPersona as toPersona } from '../src/lib/persona-pool-card'
import { PROBE_TIMEOUT_MS } from '../src/lib/collect-guard'
import { classifyNavigation } from './lib/collect-guard-store.mjs'
import { findBottlenecks, thin82cookDetailPerDay } from '../src/lib/scale-supply-plan'
import { checkNameCollision } from './lib/persona-gate-name-collision.mjs'
import { planBatch, type BatchDraft } from '../src/lib/original-post-persona-match'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf-8')
const codeOf = (f: string): string =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
let pass = 0
let failN = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${n}`) }
}

console.log('\n══ d10 activation preparation fixture ══\n')

const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'
const RUNBOOK = 'docs/operations/2026-09-08-d10-activation-prep.md'
/**
 * 🔴 **상시(evergreen) 문구만 쓴다.** 이 큐로 재는 것은 **persona 여력**이지 TTL 이 아니다.
 *    현재성 문구를 섞으면 14일 지평 중간에 TTL(7일)로 빠져 무엇을 재는지 흐려진다 —
 *    나이가 흐르는 것은 ⑫에서 따로 잰다.
 */
const N = ['아침에 산책을 다녀왔습니다', '주말에 산책을 다녀왔습니다', '오랜만에 김치를 담갔어요',
  '장 보러 다녀왔어요', '커피 한 잔 마시며 쉬는 중이에요']
/** 🔴 `capturedAt` 을 들고 다닌다 — 나이는 계획 시점마다 다시 잰다 */
const CAPTURED = new Date('2026-09-08T00:00:00+09:00')
const q = (n: number, capturedAt: Date = CAPTURED): QueueCandidate[] => Array.from({ length: n }, (_, i) => ({
  queueId: `q-${String(i).padStart(3, '0')}`, title: `${N[i % N.length]} (${i})`,
  body: `${N[i % N.length]}\n\n있었던 소소한 이야기를 적어 봅니다. ${i}번째 글이에요.`,
  gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null, capturedAt,
}))

// ── ① 준비도 시간축 ──
console.log('① 준비도 시간축 (지평 ≠ 다음 발행 슬롯)')
{
  // 2026-09-08 12:00 KST
  const noon = new Date('2026-09-08T12:00:00+09:00')
  const mid = kstMidnight(noon)
  const tomorrow = mid.getTime() + 864e5
  check('KST 자정 계산', new Date(mid.getTime() + 9 * 3600e3).toISOString().startsWith('2026-09-08T00:00'))

  // ── 다음 발행 슬롯 — 표시용. 단계마다 다르다 ──
  check('🔴 d1 · 정오 → 내일 00:05',
    nextSlotAnchor(PROFILES.d1, { now: noon, publishedToday: 0 }).getTime() === tomorrow + 5 * 60_000)
  check('🔴 d10 · 오늘 10건 완료 → 내일 첫 슬롯(00:05)',
    nextSlotAnchor(PROFILES.d10, { now: noon, publishedToday: 10 }).getTime() === tomorrow + 5 * 60_000)
  check('🔴 d10 · 오늘 3건 → 오늘 13:25',
    nextSlotAnchor(PROFILES.d10, { now: noon, publishedToday: 3 }).getTime()
    === mid.getTime() + (13 * 60 + 25) * 60_000)

  /**
   * 🔴 **지평은 슬롯이 아니다.** 여기가 이번 수정의 핵심이다.
   *    지평 시작점을 다음 슬롯으로 잡으면 오늘 이미 낸 몫 위에 그 단계의 하루 상한이
   *    통째로 다시 얹힌다 — d10 에서 오늘 3건을 내고도 오늘 10건을 더 셀 수 있게 된다.
   */
  check('🔴 지평은 다음 KST 운영일 0시다', horizonStart(noon).getTime() === tomorrow)
  check('🔴 지평은 단계를 모른다 — 인자가 now 하나다',
    horizonStart(noon).getTime() === horizonStart(new Date('2026-09-08T23:59:00+09:00')).getTime())
  check('🔴 지평 시작점은 언제나 now 보다 뒤다', horizonStart(noon).getTime() > noon.getTime())
  check('🔴 오늘(조각 하루)은 지평에 들어가지 않는다', horizonStart(noon).getTime() >= tomorrow)

  const pool = parsePoolDoc(read(POOL_DOC))
  const personas = pool.cards.filter((c) => c.voiceLength !== null).map(cardToPersona)

  const d10open = simulateStage({ stage: 'd10', queue: q(140), personas, axis: { now: noon, publishedToday: 3 } })
  const d10done = simulateStage({ stage: 'd10', queue: q(140), personas, axis: { now: noon, publishedToday: 10 } })
  const d1noon = simulateStage({ stage: 'd1', queue: q(14), personas, axis: { now: noon, publishedToday: 1 } })

  check('🔴 두 값이 분리돼 있다 — 지평 ≠ 다음 슬롯',
    d10open.horizonStartAt.getTime() !== d10open.nextSlotAt.getTime())
  check('🔴 오늘 여력이 남았을 때 그 차이가 실제로 벌어진다',
    d10open.nextSlotAt.getTime() === mid.getTime() + (13 * 60 + 25) * 60_000
    && d10open.horizonStartAt.getTime() === tomorrow)
  check('🔴 오늘 발행 수는 **다음 슬롯만** 바꾼다',
    d10open.nextSlotAt.getTime() !== d10done.nextSlotAt.getTime()
    && d10open.horizonStartAt.getTime() === d10done.horizonStartAt.getTime())
  /**
   * 🔴 **오늘 3건을 낸 뒤에도 첫날에 10건을 다시 계산하지 않는다.**
   *    지평이 내일부터이므로 오늘 낸 몫은 지평 밖이다 — 더할 것도 뺄 것도 없다.
   *    같은 큐·같은 인원이면 오늘 3건이든 10건이든 준비도는 같아야 한다.
   */
  check('🔴 오늘 낸 몫이 준비도를 흔들지 않는다',
    d10open.in14 === d10done.in14 && d10open.want14 === d10done.want14 && d10open.gaps === d10done.gaps)
  check('🔴 지평 첫날은 내일이다 — 오늘이 아니다',
    d10open.horizonStartAt.getTime() === kstMidnight(noon).getTime() + 864e5)
  check('🔴 지평 일수는 재고 지평과 같다', d10open.horizonDays === HORIZON_DAYS && d10open.horizonDays === 14)

  // 🔴 **네 단계가 같은 창을 본다** — 예전 판은 d1 내일 00:05, d10 오늘 13:25 였다
  const rows = simulateAllStages({ queue: q(140), personas, axis: { now: noon, publishedToday: 3 } })
  check('🔴 네 단계의 지평이 같다', horizonMismatches(rows).length === 0)
  check('🔴 그 지평은 완전한 운영일이다 (KST 0시)',
    rows.every((r) => (r.sim.horizonStartAt.getTime() + 9 * 3600e3) % 864e5 === 0))
  check('🔴 그런데 다음 슬롯은 단계마다 다르다 — 두 값이 같은 것이 아니다',
    new Set(rows.map((r) => r.sim.nextSlotAt.getTime())).size > 1)
  check('🔴 지평이 어긋나면 잡는다', horizonMismatches([
    { sim: { ...rows[0]!.sim } },
    { sim: { ...rows[1]!.sim, horizonStartAt: new Date(tomorrow + 3600e3) } },
  ]).length > 0)

  // 🔴 요구 조건 — d1 · 오늘 1건 완료 · 후보 14건 → 14/14 · 공백 0 · READY
  check('🔴 d1 · 오늘 1건 완료 · 후보 14 → 14/14', d1noon.in14 === 14 && d1noon.want14 === 14)
  check('🔴 그때 공백은 0일이다', d1noon.gaps === 0)
  check('🔴 READY 다 — 화면이 미달이라고 말하지 않는다', judgeReadiness(d1noon).ready)

  // 🔴 최저 단계마저 미달인 synthetic 상태 → d1 유지 + NOT_READY
  const allBad = RELEASE_STAGES.map((s) => ({ stage: s, ready: false, reasons: ['미달'] }))
  const safe = safeStageFor('d10', allBad)
  check('🔴 전부 미달이면 d1 을 유지한다', safe.stage === SAFEST_STAGE)
  check('🔴 그런데 chosenReady 는 false 다 — 초록으로 쓰지 않는다', !safe.chosenReady)
  check('🔴 사유에 "그 단계도 미달" 이 적힌다', (safe.reason ?? '').includes('그 단계도 미달'))
  const rs = resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10' }, { readiness: allBad })
  check('🔴 resolveScale 도 chosenReady=false 로 전한다', !rs.chosenReady && rs.releaseStage === 'd1')
  check('🔴 d1 만 ready 면 chosenReady=true',
    resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10' }, {
      readiness: RELEASE_STAGES.map((s) => ({ stage: s, ready: s === 'd1', reasons: [] })),
    }).chosenReady)

  // 🔴 화면이 그 값을 읽는가
  for (const f of ['scripts/supply-health.mts', 'scripts/persona-capacity-planner.mts'] as const) {
    check(`🔴 ${f.split('/').pop()} 이 chosenReady 로 색을 정한다`, /chosenReady/.test(codeOf(f)))
    check(`🔴 ${f.split('/').pop()} 이 NOT_READY 문구를 낸다`, /NOT_READY/.test(read(f)))
  }
  // 🔴 세 곳이 같은 시간축을 쓴다
  for (const f of ['scripts/supply-health.mts', 'scripts/persona-capacity-planner.mts',
    'scripts/original-post-auto-publish.mts'] as const) {
    check(`🔴 ${f.split('/').pop()} 이 axis 로 넘긴다`, /axis: \{ now/.test(codeOf(f)))
    check(`🔴 ${f.split('/').pop()} 이 시작점을 직접 만들지 않는다`,
      !/startAt: (now|new Date\(\))/.test(codeOf(f)))
  }
  // 🔴 오늘 발행 수를 실제로 세어 넘기는가 (다음 슬롯 표시가 거짓말하지 않게)
  for (const [f, expr] of [
    ['scripts/original-post-auto-publish.mts', /publishedToday: axisPublishedToday/],
    ['scripts/supply-health.mts', /publishedToday: todayCount/],
    ['scripts/persona-capacity-planner.mts', /publishedToday: todayCount/],
  ] as const) {
    check(`🔴 ${f.split('/').pop()} 이 오늘 발행 수를 실측해 넘긴다`, expr.test(codeOf(f)))
    check(`🔴 ${f.split('/').pop()} 이 0 을 박아 넘기지 않는다`, !/axis: \{ now[^}]*publishedToday: 0/.test(codeOf(f)))
  }
  check('🔴 러너가 그 수를 PersonaActivityLog 로 센다',
    /axisPublishedToday = await prisma\.personaActivityLog\.count/.test(codeOf('scripts/original-post-auto-publish.mts')))
  // 🔴 lib 이 지평을 만든다 — 호출부가 만들면 두 화면이 갈린다
  check('🔴 simulateStage 가 horizonStart 로 시작점을 만든다',
    /const horizonStartAt = horizonStart\(input\.axis\.now\)/.test(codeOf('src/lib/scale-readiness.ts')))
  check('🔴 예측기에 넘기는 것은 지평이지 슬롯이 아니다',
    /startAt: horizonStartAt/.test(codeOf('src/lib/scale-readiness.ts'))
    && !/startAt: nextSlotAt/.test(codeOf('src/lib/scale-readiness.ts')))
  // 🔴 관제가 두 값을 함께 보여 준다
  check('🔴 health JSON 이 지평을 적는다', /horizon: \{/.test(codeOf('scripts/supply-health.mts')))
  check('🔴 health JSON 이 단계별 다음 슬롯도 함께 적는다',
    /nextSlotKst: kstStamp\(sim\.nextSlotAt\)/.test(codeOf('scripts/supply-health.mts')))
}

// ── ② persona 24명 · 닉네임 ──
console.log('\n② persona 24명 (얇은 축 측정) · 닉네임 정본 두세 글자')
{
  const pool = parsePoolDoc(read(POOL_DOC))
  check('정본 Pool 파싱 문제 0', pool.problems.length === 0)
  check('🔴 Pool 25장', pool.cards.length === 25)
  check('🔴 길이를 읽을 수 있는 카드 24장 (P09 제외)',
    pool.cards.filter((c) => c.voiceLength !== null).length === 24)
  const sub = (c: PoolCard): AxisSubject => ({
    code: c.code, childrenAgeBands: c.childrenAgeBands, childrenCount: c.childrenCount,
    maritalStatus: c.maritalStatus, parentCare: c.parentCare, menopauseStatus: c.menopauseStatus,
    workStatus: c.workStatus, economicStatus: c.economicStatus, housing: c.housing,
    forbiddenReactionRoles: c.forbiddenReactionRoles, voiceLength: c.voiceLength,
  })
  const NEW = ['P21', 'P22', 'P23', 'P24', 'P25']
  const before = pool.cards.filter((c) => !NEW.includes(c.code)).map(sub)
  const after = pool.cards.map(sub)
  check('🔴 새 카드가 정확히 5장', pool.cards.filter((c) => NEW.includes(c.code)).length === 5)

  const thinBefore = thinAxes(before).map((t) => t.axis)
  const thinAfter = thinAxes(after).map((t) => t.axis)
  check('🔴 20장에서 별거가 얇았다', thinBefore.includes('별거'))
  check('🔴 25장에서 별거가 해소됐다', !thinAfter.includes('별거'))
  check('🔴 얇은 축 수가 줄었다', thinAfter.length < thinBefore.length)

  const gains = new Map(gainOf(before, after, 3).map((g) => [g.axis, g]))
  for (const axis of ['이혼', '사별', '비혼', '자녀 초등', '자녀 대학·취준', '일: 직장'] as const) {
    const g = gains.get(axis)
    check(`🔴 ${axis} 가 두터워졌다 (${g?.before} → ${g?.after})`, g !== undefined && g.after > g.before && g.fixed)
  }
  check('🔴 자녀 영유아는 그대로 0 (타겟 밖이라 메우지 않는다)', (gains.get('자녀 영유아')?.after ?? -1) === 0)
  const doc = read(POOL_DOC)
  check('🔴 메우지 않은 이유가 문서에 적혀 있다',
    doc.includes('메우지 않은 축과 그 이유') && doc.includes('공식 타겟이 40대 중반~60대 중반'))
  check('🔴 §5-0 이 측정 결과를 표로 남긴다', doc.includes('§5-0') && doc.includes('persona-axis-coverage'))
  const voice = coverageOf(after).filter((c) => c.kind === 'voice')
  check('🔴 문체 세 밴드가 모두 2명 이상', voice.every((c) => c.holders.length >= THIN_THRESHOLD))
  check('🔴 문체 합이 24명 (P09 제외)', voice.reduce((n, c) => n + c.holders.length, 0) === 24)

  // 🔴 cohort — 총 24명
  check('🔴 manifest 전체가 성립한다', verifyAllCohorts().length === 0)
  check('🔴 wave4-depth 가 P21~P25 다', COHORTS['wave4-depth'].codes.join() === NEW.join())
  check('🔴 wave4 는 wave3 를 선행으로 요구한다', COHORTS['wave4-depth'].requires.includes('wave3-scale'))
  const total = Object.values(COHORTS).reduce((n, m) => n + m.codes.length, 0)
  check('🔴 네 회차 합이 24명', total === 24 && TARGET_PERSONA_COUNT === 24)
  check('🔴 그 수가 Pool 유효 카드 수와 같다', total === pool.cards.length - Object.keys(EXCLUDED_CODES).length)
  check('🔴 wave3 · wave4 둘 다 열려 있다',
    RUNNABLE_COHORTS.includes('wave3-scale') && RUNNABLE_COHORTS.includes('wave4-depth'))
  check('🔴 끝난 회차는 여전히 닫혀 있다',
    CLOSED_COHORTS.includes('wave1-mvp') && CLOSED_COHORTS.includes('wave2'))
  const codes = new Set(pool.cards.map((c) => c.code))
  check('🔴 manifest 코드가 전부 Pool 카드에 있다',
    Object.values(COHORTS).every((m) => m.codes.every((c) => codes.has(c))))

  /**
   * 🔴 **닉네임 — 정본은 "두세 글자" 다** (Pool §3-2).
   *    예전 판은 "조합형은 6자까지" 라는 예외를 코드에만 두고 `봄볕나무` 를 만들었다.
   *    정본에 그런 예외가 없다.
   */
  check('🔴 정본이 두세 글자라고 적어 두었다', doc.includes('두세 글자 순우리말'))
  check('🔴 길이 상수가 2~3 이다', NAME_LENGTH.min === 2 && NAME_LENGTH.max === 3)
  check('🔴 네 글자는 정책 위반이다 — 예전 판의 조합형이 여기서 걸린다',
    !verifyNamePolicy('봄볕나무').ok
    && verifyNamePolicy('봄볕나무').problems.some((p) => p.includes('두세 글자')))
  check('🔴 한 글자도 위반', !verifyNamePolicy('가').ok)
  check('🟢 두 글자·세 글자는 통과', verifyNamePolicy('수국').ok && verifyNamePolicy('도라지').ok)
  check('🔴 숫자·영문은 정책 위반', !verifyNamePolicy('수국2').ok && !verifyNamePolicy('sugukk').ok)
  check('🔴 봇/AI·운영자 연상 차단', !verifyNamePolicy('수국봇').ok && !verifyNamePolicy('운영수국').ok)
  check('🔴 출처 커뮤니티 계열 차단', !verifyNamePolicy('레몬수국').ok)
  check('🔴 지역명 차단', !verifyNamePolicy('서울수국').ok)
  check('🔴 가족상태·나이·병명 차단',
    !verifyNamePolicy('수국맘').ok === false || !verifyNamePolicy('오십살').ok)
  check('🔴 나이·가족 표지 차단', !verifyNamePolicy('오십살').ok && !verifyNamePolicy('당뇨꽃').ok)
  check('🔴 브랜드 금지어 차단', !verifyNamePolicy('실버꽃').ok)

  const c1 = candidatesFor('P21')
  check('🔴 후보가 충분하다', c1.length >= 20)
  check('🔴 후보가 전부 정책을 통과한다', c1.every((n) => verifyNamePolicy(n).ok))
  check('🔴 후보가 전부 두세 글자다 — 생성기와 검사기가 같은 상수를 쓴다',
    c1.every((n) => [...n].length >= NAME_LENGTH.min && [...n].length <= NAME_LENGTH.max))
  check('🔴 결정적이다 — 같은 코드는 같은 목록', candidatesFor('P21').join() === c1.join())
  check('🔴 코드가 다르면 목록도 다르다', candidatesFor('P22').join() !== c1.join())
  const wave = [...COHORTS['wave3-scale'].codes, ...COHORTS['wave4-depth'].codes]
  const auto = assignCandidates(wave, () => false)
  check('🔴 16명 전원에게 서로 다른 이름을 고른다',
    auto.ok && auto.picked.size === 16 && new Set(auto.picked.values()).size === 16)
  check('🔴 고른 이름이 전부 두세 글자다',
    [...auto.picked.values()].every((n) => [...n].length >= 2 && [...n].length <= 3))
  check('🔴 전부 막히면 실패로 돌려준다 — 일부만 만들지 않는다',
    !assignCandidates(wave, () => true).ok)
  // 🔴 코드에 "이 사람은 이 이름" 배정표가 없다 (Pool §3-2 이유 ②)
  const nick = codeOf('src/lib/persona-nickname-candidates.ts')
  check('🔴 persona 코드별 이름 배정표가 없다', !/P0[1-9]|P1[0-9]|P2[0-5]/.test(nick))
  check('🔴 네 글자 조합을 만드는 경로가 없다 — 머리가 한 글자다',
    /HEAD1/.test(nick) && !/const HEAD:/.test(nick))

  /**
   * 🔴 **dry-run 이 P 코드 → 예정 닉네임과 Gate ⑥-B 결과를 함께 보여 주는가.**
   *    "전원 pass" 한 줄만 내면 창업자는 무슨 이름이 붙을지 모른 채 --apply 를 눌러야 한다.
   */
  const tool = codeOf('scripts/persona-cohort-run.mts')
  check('🔴 도구가 자동 선정을 쓴다', /assignCandidates\(/.test(tool))
  check('🔴 파일이 있으면 그것이 우선한다', /existsSync\(path\)/.test(tool))
  check('🔴 어느 경로로 왔든 정책을 다시 본다', /verifyNamePolicy\(/.test(tool))
  check('🔴 dry-run 이 코드→이름 표를 낸다', /예정 닉네임 \(P 코드 → 이름 · Gate ⑥-B\)/.test(read('scripts/persona-cohort-run.mts')))
  check('🔴 그 표가 코드·이름·판정을 한 줄에 같이 적는다',
    /\$\{x\.code\}\s+\$\{x\.name\.padEnd\(6\)\}\s+\$\{mark\}/.test(read('scripts/persona-cohort-run.mts')))
  check('🔴 판정 결과는 checkNameCollision 이 만든 것이다 — 따로 계산하지 않는다',
    /const preVerdicts = creates\.map\(\(c\) => \(\{ \.\.\.c, v: checkNameCollision\(/.test(tool))
  check('🔴 그래도 최종 판정은 트랜잭션 안이라고 적는다',
    read('scripts/persona-cohort-run.mts').includes('트랜잭션 안에서 다시 판정한다'))
}

// ── ③ freshness ──
console.log('\n③ freshness (TTL · 시각 미상 hold · 상한 복구 · 오탐 · 적합도)')
{
  check('🔴 TTL 근거가 문서에 있다', codeOf('src/lib/supply-freshness.ts').includes('TTL_DAYS'))
  check('🔴 hot 은 2일', TTL_DAYS.hot === 2)
  check('🔴 현재성 warm 은 7일 (실측 max 6일 + 하루)', TTL_DAYS.timelyWarm === 7)
  check('🔴 상시 warm 은 재고 지평의 2배', TTL_DAYS.evergreenWarm === HORIZON_DAYS * 2)

  check('🔴 현재성 신호를 잡는다', classifyTopic('요즘 날씨가', '') === 'timely')
  check('🔴 절기도 현재성이다', classifyTopic('김장 준비', '') === 'timely')
  check('🟢 시간을 안 타면 상시', classifyTopic('무릎이 시큰거려요', '오래된 이야기입니다') === 'evergreen')
  check('🔴 본문에서도 찾는다', classifyTopic('제목', '이번 주에 있었던 일이에요') === 'timely')
  check('신호 목록이 비어 있지 않다', TIMELY_MARKERS.length >= 30)

  /**
   * 🔴 **부분 문자열 오탐 제거.** `'설'` 을 includes 로 찾으면 `설거지` 가 명절이 된다 —
   *    그러면 상시 글의 TTL 이 28일에서 7일로 줄어 멀쩡한 재고가 3주 만에 빠진다.
   */
  check('🔴 한 글자 신호는 목록이 따로 있다', TIMELY_SYLLABLES.includes('설') && TIMELY_SYLLABLES.includes('봄'))
  check('🔴 한 글자 신호는 TIMELY_MARKERS 에 없다',
    !TIMELY_MARKERS.includes('설') && !TIMELY_MARKERS.includes('봄'))
  for (const t of ['설거지가 산더미예요', '소설 한 권 읽었어요', '주말설계를 해봤어요', '말설임 없이 갔어요']) {
    check(`🔴 오탐 없음 — "${t}" 는 상시다`, classifyTopic(t, '무릎 이야기') === 'evergreen')
  }
  for (const t of ['설날 준비하느라', '설 연휴에 있었던 일', '봄이 왔어요', '봄날 산책']) {
    check(`🟢 진짜 신호는 잡는다 — "${t}"`, classifyTopic(t, '') === 'timely')
  }
  check('🔴 근거 목록에도 같은 규칙이 걸린다',
    timelyMarkersIn('설거지', '').length === 0 && timelyMarkersIn('설날', '').includes('설'))

  check('🔴 2일 이하는 hot', freshnessOf({ ageDays: 0, topic: 'timely' }) === 'hot'
    && freshnessOf({ ageDays: 2, topic: 'evergreen' }) === 'hot')
  check('🔴 현재성은 7일까지 warm, 8일부터 expired',
    freshnessOf({ ageDays: 7, topic: 'timely' }) === 'warm'
    && freshnessOf({ ageDays: 8, topic: 'timely' }) === 'expired')
  check('🔴 상시는 28일까지 warm, 29일부터 expired',
    freshnessOf({ ageDays: 28, topic: 'evergreen' }) === 'warm'
    && freshnessOf({ ageDays: 29, topic: 'evergreen' }) === 'expired')

  /**
   * 🔴 **시각 미상은 낙관하지 않는다.** 예전 판은 `warm` 이라 적었고 그것은
   *    "괜찮다" 는 뜻이라 자동 발행 대상에 그대로 들어갔다 — 몇 년 전 글일 수도 있는데도.
   */
  check('🔴 나이를 모르면 unknown 이다 (warm 이 아니다)',
    freshnessOf({ ageDays: null, topic: 'timely' }) === 'unknown'
    && freshnessOf({ ageDays: Number.NaN, topic: 'timely' }) === 'unknown'
    && freshnessOf({ ageDays: -1, topic: 'evergreen' }) === 'unknown')
  check('🔴 unknown 은 자동 발행 대상이 아니다', !isAutoPublishable('unknown'))
  check('🔴 expired 도 아니다', !isAutoPublishable('expired'))
  check('🟢 hot · warm 만 자동이다', isAutoPublishable('hot') && isAutoPublishable('warm'))
  const unk = judgeCandidate({ queueId: 'u', title: '요즘', body: '', ageDays: null, isRecovery: false, seq: 0 })
  check('🔴 사유가 hold 라고 말한다', unk.hold === 'AGE_UNKNOWN' && unk.reason.includes('보류(hold)'))
  check('🔴 사람이 확인한다고 적는다', unk.reason.includes('사람이 확인한다'))
  check('🔴 지운다고 말하지 않는다', unk.reason.includes('삭제하지 않는다'))
  check('🔴 TTL 초과도 삭제가 아니라고 적는다',
    judgeCandidate({ queueId: 'x', title: '요즘', body: '', ageDays: 30, isRecovery: false, seq: 0 })
      .reason.includes('삭제하지 않는다'))

  // 🔴 FIFO 로 오래된 것부터 먹지 않는다
  const c = (o: Partial<FreshCandidate> & { queueId: string; seq: number }): FreshCandidate => ({
    title: '', body: '', ageDays: 0, isRecovery: false, ...o,
  })
  const mix: FreshCandidate[] = [
    c({ queueId: 'old-ever', seq: 0, title: '무릎 이야기', body: '', ageDays: 20 }),
    c({ queueId: 'new-timely', seq: 1, title: '요즘 날씨', body: '', ageDays: 0 }),
    c({ queueId: 'mid-timely', seq: 2, title: '이번 주 장보기', body: '', ageDays: 5 }),
    c({ queueId: 'new-ever', seq: 3, title: '오래된 살림 이야기', body: '', ageDays: 1 }),
  ]
  const r = orderForPublish(mix)
  check('🔴 FIFO 였다면 old-ever 가 맨 앞이다 — 그렇지 않다', r.ordered[0]!.queueId !== 'old-ever')
  check('🔴 현재성 hot 이 맨 앞', r.ordered[0]!.queueId === 'new-timely')
  check('🔴 현재성 warm 이 그다음', r.ordered[1]!.queueId === 'mid-timely')
  check('🔴 상시는 뒤로 밀린다', r.ordered.slice(2).every((x) => classifyTopic(x.title, x.body) === 'evergreen'))
  check('🔴 결정적이다', orderForPublish(mix).ordered.map((x) => x.queueId).join()
    === r.ordered.map((x) => x.queueId).join())

  /**
   * 🔴 **적합도가 실제로 순서를 바꾸는가.** 계약만 적어 두고 값이 늘 0 이면
   *    상시 후보는 그냥 FIFO 다 — 그것이 예전 상태였다.
   */
  const ever = (id: string, seq: number, fit: number, age: number): FreshCandidate =>
    c({ queueId: id, seq, title: '무릎 이야기', body: '살림 이야기', ageDays: age, fitScore: fit })
  const byFit = orderForPublish([ever('low', 0, 10, 1), ever('high', 1, 90, 1)])
  check('🔴 적합도가 높은 상시가 먼저 나간다 — 줄 순서를 이긴다',
    byFit.ordered[0]!.queueId === 'high')
  check('🔴 적합도가 같으면 신선도 → 줄 순서로 떨어진다',
    orderForPublish([ever('older', 0, 50, 20), ever('newer', 1, 50, 1)]).ordered[0]!.queueId === 'newer')

  // 🔴 복구 — 신선하면 맨 앞, 상했으면 사람에게
  const freshRec = orderForPublish([
    c({ queueId: 'fresh', seq: 0, title: '요즘 날씨', body: '', ageDays: 0 }),
    c({ queueId: 'rec-ok', seq: 1, title: '요즘 날씨', body: '', ageDays: 3, isRecovery: true }),
  ])
  check('🔴 살아 있는 복구는 여전히 맨 앞이다', freshRec.ordered[0]!.queueId === 'rec-ok')
  const staleRec = orderForPublish([
    c({ queueId: 'fresh', seq: 0, title: '요즘 날씨', body: '', ageDays: 0 }),
    c({ queueId: 'rec-old', seq: 1, title: '요즘 날씨', body: '', ageDays: 99, isRecovery: true }),
  ])
  check('🔴 TTL 을 넘긴 복구는 자동 발행되지 않는다',
    !staleRec.ordered.some((x) => x.queueId === 'rec-old'))
  check('🔴 그것은 사람 검수로 간다 (삭제·재배정 아님)',
    staleRec.heldForReview.some((x) => x.candidate.queueId === 'rec-old' && x.hold === 'RECOVERY_STALE'))
  check('🔴 사유에 재배정하지 않는다고 적는다',
    staleRec.verdicts.get('rec-old')!.reason.includes('재배정하지도 삭제하지도 않는다'))
  const unkRec = orderForPublish([c({ queueId: 'rec-unk', seq: 0, title: '요즘', body: '', ageDays: null, isRecovery: true })])
  check('🔴 시각 미상 복구도 사람에게 간다', unkRec.ordered.length === 0
    && unkRec.heldForReview[0]!.hold === 'RECOVERY_STALE')

  // 🔴 expired · unknown 은 목록에서만 빠진다
  const withExp = orderForPublish([
    c({ queueId: 'ok', seq: 0, title: '요즘 날씨', body: '', ageDays: 1 }),
    c({ queueId: 'gone', seq: 1, title: '요즘 날씨', body: '', ageDays: 40 }),
    c({ queueId: 'unknown', seq: 2, title: '요즘 날씨', body: '', ageDays: null }),
  ])
  check('🔴 자동 대상은 살아 있는 것뿐', withExp.ordered.length === 1 && withExp.ordered[0]!.queueId === 'ok')
  check('🔴 나머지는 사유별로 사람 검수 목록에 남는다',
    withExp.heldForReview.length === 2
    && withExp.heldForReview.some((x) => x.hold === 'TTL_EXPIRED')
    && withExp.heldForReview.some((x) => x.hold === 'AGE_UNKNOWN'))
  check('🔴 판정은 남는다 (지운 것이 아니다)', withExp.verdicts.size === 3)
  check('요약이 등급과 hold 사유를 모두 말한다',
    describeFreshness(withExp.ordered.concat()).includes('hot')
    && describeFreshness([...withExp.heldForReview.map((x) => x.candidate)]).includes('사람 검수'))

  // 🔴 러너가 실제로 쓰는가 — **공용 준비 함수 하나**로 바뀌었다 (⑨에서 행동까지 본다)
  const runner = codeOf('scripts/original-post-auto-publish.mts')
  check('🔴 러너가 공용 준비 함수를 쓴다', /prepareCandidates\(\{/.test(runner))
  check('🔴 러너가 그 순서를 pickPublishTarget 에 넘긴다', /ordered: freshOrdered/.test(runner))
  check('🔴 러너가 원문 확인 시각을 읽는다', /sourceCapturedAt: true/.test(runner))
  check('🔴 러너가 복구 여부를 배정 코드로 넘긴다', /assignedPersonaCode: t\.matchedPersonaId === null/.test(runner))
  check('🔴 러너가 사람 검수 목록을 출력한다', /prepared\.held/.test(runner))
  check('🔴 legacy 제외·안전 판정은 그대로다',
    /selectAutoTargets\(/.test(runner) && /safetyFilter/.test(runner))
  check('🔴 최대 매칭 계약도 그대로다 — 준비 함수가 planBatch 를 부른다',
    /planBatch\(/.test(codeOf('src/lib/supply-candidates.ts')))
}

// ── ④ 수집원 다회 · 보호장치 ──
console.log('\n④ 수집원 다회 운영 · 보호장치 (예산 · backoff · 차단기)')
{
  check('🔴 수집원은 셋이다', SOURCE_FACTS.length === 3)
  check('🔴 82cook 은 아직 미등록으로 기록돼 있다', !factsOf('82cook').loaded)
  check('🔴 카페 둘은 등록돼 있다',
    factsOf('navercafe:remonterrace').loaded && factsOf('navercafe:wgang').loaded)
  check('🔴 실측 세션 오류 0', SOURCE_FACTS.every((f) => f.sessionErrors === 0))

  /**
   * 🔴 **1,147 은 페이지 크기가 아니다.** 그것은 `listToDetail` 의 분모 — 하루치 표본이다.
   *    페이지로 쓰면 "페이지가 넘어가는 데 57시간" 이 되어 하루 열 번만 봐도 안전해진다.
   */
  check('🔴 82cook 페이지 크기가 1,147 이 아니다', factsOf('82cook').listPageSize.value !== 1147)
  check('🔴 실측한 25건이다', factsOf('82cook').listPageSize.value === 25)
  check('🔴 그 근거가 함께 적혀 있다',
    factsOf('82cook').listPageSize.how.includes('82cook.list.jsonl')
    && factsOf('82cook').listPageSize.how.includes('25'))
  check('🔴 카페 페이지 크기는 로그 실측 21건',
    factsOf('navercafe:remonterrace').listPageSize.value === 21
    && factsOf('navercafe:wgang').listPageSize.how.includes('목록 1p'))
  check('🔴 회차당 페이지 수가 템플릿 인자와 묶여 있다',
    factsOf('82cook').listPagesPerRun.value === 3
    && factsOf('82cook').listPagesPerRun.how.includes('--pages=3')
    && factsOf('navercafe:wgang').listPagesPerRun.value === 1)

  /**
   * 🔴 **성공률은 100% 가 아니다.** 82cook 상세는 8/10 이다.
   *    이론 최대를 능력이라 부르면 2할을 없는 셈 친다.
   */
  check('🔴 82cook 성공률은 0.8 이다 (1 이 아니다)', factsOf('82cook').detailSuccessRate.value === 0.8)
  check('🔴 그 근거가 8/10 이라고 적혀 있다', factsOf('82cook').detailSuccessRate.how.includes('8/10'))
  check('🔴 카페는 6/6 실측 100% 다',
    SOURCE_FACTS.filter((f) => f.id !== '82cook').every((f) => f.detailSuccessRate.value === 1))

  /**
   * 🔴 **신규 유입을 모르면 놓침 상한을 계산할 수 없다.**
   *    예전 판은 근거 없는 `20건/h` 를 넣어 계산이 성립하는 것처럼 보이게 했다.
   */
  check('🔴 82cook 신규 유입은 미측정(null)이다', factsOf('82cook').newPerHourFloor === null)
  check('🔴 그래서 페이지 수명·안전 상한이 null 이다',
    pageWindowHours(factsOf('82cook')) === null && maxSafeGapHours(factsOf('82cook')) === null)
  check('🔴 모르는 것을 무한대로 두지 않는다 — 그러면 아무리 드물게 봐도 안전이 된다',
    maxSafeGapHours(factsOf('82cook')) !== Number.POSITIVE_INFINITY)
  check('🔴 그 상태는 계획 미성립으로 잡힌다',
    verifySchedule('82cook', 'start').some((p) => p.includes('신규 유입이 미측정')))
  check('🔴 카페는 유입 실측이 있어 상한이 계산된다',
    (maxSafeGapHours(factsOf('navercafe:remonterrace')) ?? 0) > 0
    && (maxSafeGapHours(factsOf('navercafe:wgang')) ?? 0) > 0)
  check('🔴 카페 계획은 성립한다',
    verifySchedule('navercafe:remonterrace', 'start').length === 0
    && verifySchedule('navercafe:wgang', 'start').length === 0
    && verifySchedule('navercafe:remonterrace', 'stable').length === 0
    && verifySchedule('navercafe:wgang', 'stable').length === 0)
  check('🔴 유입이 빨라지면 같은 회차도 위험하다고 잡는다', (() => {
    const f = { ...factsOf('navercafe:wgang'), newPerHourFloor: { value: 20, when: 't', how: 't' } }
    return (maxSafeGapHours(f) ?? 99) < 6
  })())
  check('🔴 회차당 페이지 수가 창을 넓힌다 — 한 장만 본다고 가정하지 않는다', (() => {
    const one = { ...factsOf('navercafe:wgang') }
    const three = { ...one, listPagesPerRun: { value: 3, when: 't', how: 't' } }
    return (pageWindowHours(three) ?? 0) === (pageWindowHours(one) ?? 0) * 3
  })())

  for (const phase of ['start', 'stable'] as const) {
    check(`🔴 [${phase}] 소스끼리 겹치지 않는다`, verifyNoCrossOverlap(phase).length === 0)
  }
  for (const f of SOURCE_FACTS) {
    const perDay = planSlots(f.id, 'stable').length * f.requestsPerRun
    check(`🔴 ${f.id} 하루 요청 ${perDay} ≤ 상한 ${MAX_REQUESTS_PER_DAY[f.id]}`, perDay <= MAX_REQUESTS_PER_DAY[f.id])
  }
  check('🔴 상한을 넘기면 verifySchedule 이 잡는다', (() => {
    const saved = MAX_REQUESTS_PER_DAY['navercafe:wgang']
    ;(MAX_REQUESTS_PER_DAY as Record<string, number>)['navercafe:wgang'] = 1
    const got = verifySchedule('navercafe:wgang', 'stable').some((x) => x.includes('하루 요청'))
    ;(MAX_REQUESTS_PER_DAY as Record<string, number>)['navercafe:wgang'] = saved
    return got
  })())
  const minutes = SOURCE_FACTS.map((f) => planSlots(f.id, 'start')[0]!.minute)
  check('🔴 세 소스의 분이 서로 다르다', new Set(minutes).size === 3)
  check('🔴 안정 단계에서도 그렇다',
    new Set(SOURCE_FACTS.map((f) => planSlots(f.id, 'stable')[0]!.minute)).size === 3)
  check('🔴 목록 4s · 상세 3s (실측)',
    SOURCE_FACTS.every((f) => f.listPaceMs === 4000 && f.detailPaceMs === 3000))

  /**
   * 🔴 **이론 최대와 유효 처리량을 나눈다.**
   *    380 은 한 건도 실패하지 않았을 때의 수다. 82cook 8/10 을 곱하면 320 이다.
   */
  check('🔴 이론 최대는 시작 380 · 안정 460',
    theoreticalDetailPerDay('start') === 380 && theoreticalDetailPerDay('stable') === 460)
  check('🔴 유효 처리량은 그보다 작다 — 시작 320 · 안정 400',
    effectiveDetailPerDay('start') === 320 && effectiveDetailPerDay('stable') === 400)
  check('🔴 성공률을 곱하지 않으면 두 값이 같아진다 (그것이 예전 계산이다)',
    effectiveDetailPerDay('start') < theoreticalDetailPerDay('start'))
  check('🔴 격리 보고도 유효 처리량으로 적는다',
    isolationOf(['82cook']).aliveDetailPerDay === 80
    && isolationOf(['navercafe:remonterrace']).lostDetailPerDay === 40)
  for (const down of ['82cook', 'navercafe:remonterrace', 'navercafe:wgang'] as const) {
    const iso = isolationOf([down])
    check(`🔴 ${down} 장애가 격리된다`, iso.isolated && iso.alive.length === 2 && iso.aliveDetailPerDay > 0)
  }
  check('🔴 셋이 다 죽으면 격리가 아니다', !isolationOf(SOURCE_FACTS.map((f) => f.id)).isolated)

  // ── 🔴 보호장치 — 예산 · 지수 backoff · 분류별 차단기 ──
  check('🔴 403 · 429 · TCP 를 나눠 분류한다',
    classifyFailure({ status: 403 }) === 'FORBIDDEN'
    && classifyFailure({ status: 429 }) === 'RATE_LIMIT'
    && classifyFailure({ code: 'ECONNRESET' }) === 'NETWORK'
    && classifyFailure({ code: 'ETIMEDOUT' }) === 'NETWORK'
    && classifyFailure({ status: 503 }) === 'SERVER')
  check('🔴 모르는 것을 NETWORK 로 넘기지 않는다 — 가장 느슨한 칸에 쌓인다',
    classifyFailure({}) === 'OTHER' && classifyFailure({ status: 404 }) === 'OTHER')
  check('🔴 backoff 는 지수다', (() => {
    const a = backoffMs('RATE_LIMIT', 1), b = backoffMs('RATE_LIMIT', 2), c2 = backoffMs('RATE_LIMIT', 3)
    return b > a && c2 > b && c2 <= BACKOFF.RATE_LIMIT.capMs * 1.2
  })())
  check('🔴 상한에서 멈춘다', backoffMs('RATE_LIMIT', 20) <= BACKOFF.RATE_LIMIT.capMs * 1.2)
  check('🔴 결정적이다 — 같은 입력이면 같은 값',
    backoffMs('NETWORK', 2, 7) === backoffMs('NETWORK', 2, 7))
  check('🔴 403 은 재시도하지 않는다 — 두드릴수록 나빠진다',
    BACKOFF.FORBIDDEN.maxAttempts === 0 && !canRetry('FORBIDDEN', 0) && backoffMs('FORBIDDEN', 1) === 0)
  check('🔴 429 · TCP 는 몇 번 재시도한다', canRetry('RATE_LIMIT', 1) && canRetry('NETWORK', 1))

  check('🔴 분류마다 임계가 다르다 — 403 은 1회, TCP 는 5회',
    BREAKER.FORBIDDEN.threshold === 1 && BREAKER.NETWORK.threshold === 5
    && BREAKER.RATE_LIMIT.threshold === 2)
  check('🔴 403 만 사람 확인을 요구한다',
    BREAKER.FORBIDDEN.requiresHuman
    && !BREAKER.RATE_LIMIT.requiresHuman && !BREAKER.NETWORK.requiresHuman)

  const T0 = Date.UTC(2026, 8, 8, 3, 0, 0)
  const base = newGuardState('82cook', '2026-09-08')
  check('🔴 처음에는 전부 닫혀 있다', canRequest(base, T0).ok && breakerOf(base, 'FORBIDDEN', T0) === 'closed')
  const s403 = recordFailure(base, 'FORBIDDEN', T0)
  check('🔴 403 한 번이면 열린다', breakerOf(s403, 'FORBIDDEN', T0) === 'open')
  check('🔴 그 상태에서는 요청을 보내지 않는다',
    !canRequest(s403, T0).ok && canRequest(s403, T0).blockedBy === 'FORBIDDEN')
  check('🔴 쿨다운이 지나도 스스로 닫히지 않는다',
    breakerOf(s403, 'FORBIDDEN', T0 + 48 * 3600_000) === 'open')
  check('🔴 성공 한 번으로도 닫히지 않는다', breakerOf(recordSuccess(s403), 'FORBIDDEN', T0) === 'open')
  check('🟢 사람이 풀어야 닫힌다',
    breakerOf(clearByHuman(s403, 'FORBIDDEN', T0 + 3600_000), 'FORBIDDEN', T0 + 3600_000) === 'closed')

  const s429 = recordFailure(recordFailure(base, 'RATE_LIMIT', T0), 'RATE_LIMIT', T0)
  check('🔴 429 는 두 번이면 열린다', breakerOf(s429, 'RATE_LIMIT', T0) === 'open')
  check('🔴 쿨다운이 지나면 half-open 으로 한 건만 본다',
    breakerOf(s429, 'RATE_LIMIT', T0 + BREAKER.RATE_LIMIT.cooldownMs) === 'half-open')
  check('🔴 성공하면 닫힌다', breakerOf(recordSuccess(s429), 'RATE_LIMIT', T0) === 'closed')
  let sTcp = base
  for (let i = 0; i < 4; i += 1) sTcp = recordFailure(sTcp, 'NETWORK', T0)
  check('🔴 TCP 는 4번까지는 닫혀 있다', breakerOf(sTcp, 'NETWORK', T0) === 'closed')
  check('🔴 5번째에 열린다', breakerOf(recordFailure(sTcp, 'NETWORK', T0), 'NETWORK', T0) === 'open')

  // 🔴 예산
  let budgeted = newGuardState('navercafe:wgang', '2026-09-08')
  for (let i = 0; i < MAX_REQUESTS_PER_DAY['navercafe:wgang']; i += 1) budgeted = recordRequest(budgeted, T0)
  check('🔴 예산을 다 쓰면 막는다',
    !canRequest(budgeted, T0).ok && canRequest(budgeted, T0).blockedBy === 'budget'
    && budgetOf(budgeted).exhausted)
  check('🔴 날이 바뀌면 예산만 초기화한다', (() => {
    const rolled = rollBudgetDay(recordFailure(budgeted, 'FORBIDDEN', T0), '2026-09-09')
    return rolled.requestsToday === 0 && breakerOf(rolled, 'FORBIDDEN', T0) === 'open'
  })())
  check('🔴 차단기는 자정에 잊지 않는다 — 다음 날 같은 자리에서 또 맞는다',
    rollBudgetDay(s403, '2026-09-09').failures.FORBIDDEN.openedAt !== null)

  // 🔴 관제에 노출되는가
  const snap = guardSnapshot(s403, T0)
  check('🔴 스냅숏이 분류별 상태를 낸다', snap.breakers.length === 5
    && snap.breakers.some((b) => b.cls === 'FORBIDDEN' && b.status === 'open'))
  check('🔴 하나라도 열려 있으면 healthy 가 아니다', !snap.healthy && guardSnapshot(base, T0).healthy)
  check('🔴 요약이 예산과 차단기를 함께 말한다',
    describeGuard(s403, T0).includes('예산') && describeGuard(s403, T0).includes('FORBIDDEN'))

  // 🔴 수집기가 실제로 통과시키는가 — 소스에서 본다
  const collector = codeOf('scripts/micro-seed-collect-82cook.mts')
  check('🔴 82cook 수집기가 보호장치를 지나 요청한다', /guardedGet\(\{/.test(collector))
  check('🔴 맨몸 fetch 를 남겨 두지 않았다', !/await fetch\(url/.test(collector))
  check('🔴 상태를 읽기 전용으로만 만진다 — 저장은 잠금 안이 한다',
    /readGuard\(GUARD_SOURCE/.test(collector) && !/saveGuard\(/.test(collector))
  check('🔴 화면에 보호장치 상태를 적는다', /describeGuard\(guardState/.test(collector))
  const store = codeOf('scripts/lib/collect-guard-store.mts')
  check('🔴 저장 계층이 예산·차단기를 먼저 본다 (잠금 안에서)',
    /const gate = canRequest\(state, now\.getTime\(\)\)/.test(store))
  check('🔴 막히면 요청을 보내지 않고 던진다', /수집 보호장치가 막았다/.test(store))
  check('🔴 실패를 분류해 backoff 만큼 물러난다',
    /classifyFailure\(/.test(store) && /backoffMs\(cls, attempt/.test(store))
  check('🔴 판정부는 순수 함수다 — 파일·네트워크를 모른다', (() => {
    const lib = codeOf('src/lib/collect-guard.ts')
    return !/readFileSync|writeFileSync|fetch\(/.test(lib)
  })())
  check('🔴 관제가 보호장치를 노출한다', (() => {
    const h = codeOf('scripts/supply-health.mts')
    return /guardSnapshot\(/.test(h) && /collect,/.test(h) && /④-b 수집 보호장치/.test(read('scripts/supply-health.mts'))
  })())
}

// ── ⑤ d10 dry-run 준비도 · 수집 준비도 ──
console.log('\n⑤ d10 dry-run 준비도 · 수집 준비도 (BLOCKED 여야 한다)')
{
  const pool = parsePoolDoc(read(POOL_DOC))
  const personas = pool.cards.filter((c) => c.voiceLength !== null).map(cardToPersona)
  check('🔴 시뮬레이션에 쓸 카드가 24장', personas.length === 24)
  const AXIS = { now: new Date('2026-09-09T00:05:00+09:00'), publishedToday: 0 }
  const q140 = q(140)
  check('🔴 queue id 140개가 전부 다르다', new Set(q140.map((x) => x.queueId)).size === 140)

  const split = resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd1' })
  check('🔴 내부 목표 140', split.capacityProfile.dailyTarget * HORIZON_DAYS === 140)
  check('🔴 공개 1', split.releaseProfile.dailyTarget === 1)

  const at = (n: number): ReturnType<typeof simulateStage> =>
    simulateStage({ stage: 'd10', queue: q140, personas: personas.slice(0, n), axis: AXIS })
  check('🔴 19명(옛 Pool)은 139/140 — 여유가 없었다', at(19).in14 === 139 && !judgeReadiness(at(19)).ready)
  check('🟢 20명부터 140/140', at(20).in14 === 140 && judgeReadiness(at(20)).ready)
  check('🟢 24명은 140/140 · 공백 0', at(24).in14 === 140 && at(24).gaps === 0 && judgeReadiness(at(24)).ready)

  const rowsAt = (n: number): ReturnType<typeof simulateAllStages> =>
    simulateAllStages({ queue: q140, personas: personas.slice(0, n), axis: AXIS })
  for (const n of [24, 23, 22]) {
    const safe = safeStageFor('d10', rowsAt(n).map((r) => r.verdict))
    check(`🟢 ${n}명(1~2명 pause)에서도 d10 유지`, safe.stage === 'd10' && !safe.throttled && safe.chosenReady)
  }
  const at19 = safeStageFor('d10', rowsAt(19).map((r) => r.verdict))
  check('🔴 5명 pause(19명)면 d5 로 감속', at19.stage === 'd5' && at19.throttled)
  check('🔴 그때도 고른 단계는 달성 가능하다', at19.chosenReady)
  check('🔴 감속 사유가 남는다', (at19.reason ?? '').includes('d10'))
  check('🔴 여유는 4명이다 — 20명까지 d10',
    safeStageFor('d10', rowsAt(20).map((r) => r.verdict)).stage === 'd10'
    && safeStageFor('d10', rowsAt(19).map((r) => r.verdict)).stage !== 'd10')

  const plans24 = promotionPlan(rowsAt(24))
  check('🔴 24명·140건이면 네 단계 모두 승격 가능', plans24.every((p) => p.ready))
  check('🔴 최고 단계는 d10', highestReady(rowsAt(24)) === 'd10')
  const plansLow = promotionPlan(simulateAllStages({ queue: q140.slice(0, 14), personas: personas.slice(0, 8), axis: AXIS }))
  const d10plan = plansLow.find((p) => p.stage === 'd10')!
  check('🔴 재고가 모자라면 필요 수량을 적는다', d10plan.missing.some((m) => m.includes('재고 +126건')))
  check('🔴 지금/필요를 함께 낸다', d10plan.need.stock.now === 14 && d10plan.need.stock.want === 140)
  const stuck = promotionPlan(simulateAllStages({ queue: q140, personas: personas.slice(0, 10), axis: AXIS }))
    .find((p) => p.stage === 'd10')!
  check('🔴 재고가 있는데 미달이면 인원·조합 문제라고 적는다',
    stuck.missing.some((m) => m.includes('재고는 있으나')))
  const h = codeOf('scripts/supply-health.mts')
  check('🔴 health JSON 에 승격 조건이 들어간다', /promotion: promotionPlan\(scaleRows\)/.test(h))
  check('🔴 health 화면이 그 값을 읽는다', /scale\.promotion/.test(h))
  check('🔴 감속 조건이 같은 표의 뒤집음이라고 적는다', read('scripts/supply-health.mts').includes('감속 조건은 같은 표의 뒤집음'))

  /**
   * ── 🔴 **수집 준비도 — current · prepared · required 를 따로 본다** ──
   *
   *    예전 fixture 는 `detailPerDay('start') >= 380` 으로 통과했다. 필요량은 382 였고,
   *    380 은 성공률도 곱하지 않은 이론 최대였다. 게다가 그 380 은 **다회 계획**의 수인데
   *    launchctl 에는 1회 job 두 개뿐이라 실제로 열리는 것은 20건이다.
   */
  const p100 = planSupply(PROFILES.d10, 100)
  check('🔴 100/day 요구량은 하루 상세 382건이다', p100.detailPerDay === 382)
  check('🔴 380 은 그 요구량보다 작다 — "근접" 은 판정이 아니다',
    theoreticalDetailPerDay('start') < p100.detailPerDay)
  check('🔴 여유 기준은 기존 30% 규칙 그대로다', COLLECT_MARGIN_RATIO === 0.7)
  check('🔴 여유까지 갖추려면 546건이 필요하다', requiredCapacityWithMargin(382) === 546)

  /**
   * 🔴 **관측은 synthetic 으로 주입한다** — CI 는 launchctl 을 읽지 않는다(순수 fixture).
   *    운영 경로(`supply-health`)는 실측을 넣는다. 두 경로가 같은 함수를 쓴다.
   */
  const OBSERVED_NOW: readonly ObservedJob[] = [
    { label: 'com.soransoran.navercafe-collect-remonterrace', slots: [{ hour: 9, minute: 20 }], loaded: true },
    { label: 'com.soransoran.navercafe-collect-wgang', slots: [{ hour: 13, minute: 20 }], loaded: true },
    /** 🔴 공급 **처리** job 이다 — 수집하지 않으므로 수집 능력에 보태지 않는다 */
    { label: 'com.soransoran.supply-process', slots: [{ hour: 23, minute: 15 }], loaded: true },
  ]
  const NOW_MS = Date.UTC(2026, 8, 8, 3, 0, 0)

  // 🔴 ① 1회 job 만 등록된 지금 — current 20 / prepared 320 이 **따로** 나온다
  const cur = currentCapacity(OBSERVED_NOW)
  const prep = preparedCapacity('start')
  check('🔴 current 는 실제 슬롯 수로 센다 — 카페 1회 job 은 1회다',
    cur.perSource.filter((x) => x.id !== '82cook').every((x) => x.runsPerDay === 1 && x.kind === 'single'))
  check('🔴 그래서 current 는 20건/day 다 (계획 320 이 아니다)', cur.effectivePerDay === 20)
  check('🔴 prepared 는 320건/day 다 — 둘을 합치지 않는다', prep.effectivePerDay === 320)
  check('🔴 82cook 은 미등록이라 current 기여가 0 이다',
    cur.perSource.find((x) => x.id === '82cook')!.effectivePerDay === 0)

  // 🔴 ② 템플릿만 있고 등록하지 않으면 current 는 늘지 않는다
  const templateOnly: ObservedJob[] = [
    ...OBSERVED_NOW,
    { label: 'com.soransoran.raw-collect-82cook', slots: Array.from({ length: 10 }, (_, i) => ({ hour: i * 2 + 1, minute: 10 })), loaded: false },
  ]
  check('🔴 파일만 있고 load 되지 않으면 current 가 그대로다',
    currentCapacity(templateOnly).effectivePerDay === cur.effectivePerDay)

  // 🔴 ③ 정확히 그 label 과 슬롯 수로 올라와야 current 에 반영된다
  const multiWrongSlots: ObservedJob[] = [
    { label: 'com.soransoran.navercafe-collect-remonterrace-multi', slots: [{ hour: 4, minute: 20 }, { hour: 16, minute: 20 }], loaded: true },
  ]
  check('🔴 다회 label 이어도 슬롯 수가 계획과 다르면 준비 완료가 아니다',
    !runsPlannedMulti(multiWrongSlots, 'navercafe:remonterrace', 'start')
    && currentCapacity(multiWrongSlots).perSource.find((x) => x.id === 'navercafe:remonterrace')!.runsPerDay === 2)
  const multiRight: ObservedJob[] = [{
    label: 'com.soransoran.navercafe-collect-remonterrace-multi',
    slots: planSlots('navercafe:remonterrace', 'start'), loaded: true,
  }]
  check('🟢 정확한 label + 슬롯이면 그때만 반영된다',
    runsPlannedMulti(multiRight, 'navercafe:remonterrace', 'start')
    && currentCapacity(multiRight).perSource.find((x) => x.id === 'navercafe:remonterrace')!.effectivePerDay === 40)

  // 🔴 ④ 어긋남을 화면·JSON 이 같은 문장으로 낸다
  const mm = inventoryMismatches(OBSERVED_NOW, 'start')
  check('🔴 1회판이 도는 것을 어긋남으로 잡는다',
    mm.filter((x) => x.code === 'SINGLE_WHILE_MULTI_PLANNED').length === 2)
  check('🔴 82cook 미등록도 잡는다', mm.some((x) => x.id === '82cook' && x.code === 'NOT_REGISTERED'))
  check('🔴 어긋남 문장에 지금 회차와 계획 회차가 함께 적힌다',
    mm.some((x) => x.detail.includes('지금 1회') && x.detail.includes('4회/day')))

  // 🔴 ⑤ 준비도 — multi 미등록이면 BLOCKED
  const readyStart = collectReadiness({ phase: 'start', plan: p100, nowMs: NOW_MS, observed: OBSERVED_NOW })
  const readyStable = collectReadiness({ phase: 'stable', plan: p100, nowMs: NOW_MS, observed: OBSERVED_NOW })
  check('🔴 시작 단계 수집 준비도는 BLOCKED 다', readyStart.status === 'BLOCKED')
  check('🔴 안정 단계도 BLOCKED 다', readyStable.status === 'BLOCKED')
  check('🔴 current · prepared · required 를 각각 낸다',
    readyStart.configuredPerDay === 20 && readyStart.preparedPerDay === 320 && readyStart.requiredPerDay === 382)
  check('🔴 지금 열리는 것이 모자란다고 숫자로 적는다',
    // 🔴 이름을 `설정된 것` 으로 바꿨다 — 등록은 능력이 아니다(2026-09-10)
    readyStart.reasons.some((r) => r.includes('설정된 것 20건/day') && r.includes('362건 모자란다')))
  check('🔴 전부 올려도 모자란다는 것을 따로 적는다',
    readyStart.reasons.some((r) => r.includes('전부 올려도') && r.includes('62건 모자란다')))
  check('🔴 판정은 이론 최대(380)로 하지 않는다', readyStart.theoreticalPerDay === 380)
  check('🔴 보호장치가 없으면 그것도 사유다',
    readyStart.reasons.some((r) => r.includes('보호장치 상태가 없다')))
  check('🔴 카페도 BLOCKED 다 — 계획한 다회 job 이 아니라 1회판이 돌고 있다',
    readyStart.perSource.filter((s) => s.id !== '82cook')
      .every((s) => s.status === 'BLOCKED'
        && s.reasons.some((r) => r.includes('계획한 다회 job') && r.includes('지금은'))))
  check('🔴 82cook 은 아예 미등록이라고 적는다',
    readyStart.perSource.find((s) => s.id === '82cook')!.reasons
      .some((r) => r.includes('미등록 — 템플릿만 있고 돌지 않는다')))
  check('🔴 82cook 사유에 유입 미측정이 들어간다',
    readyStart.perSource.find((s) => s.id === '82cook')!.reasons.some((r) => r.includes('신규 유입')))
  check('🔴 보호장치를 붙여도 등록이 없으면 BLOCKED 다', (() => {
    const guards = Object.fromEntries(SOURCE_FACTS.map((f) => [f.id, newGuardState(f.id, '2026-09-08')]))
    const r2 = collectReadiness({ phase: 'start', plan: p100, nowMs: NOW_MS, observed: OBSERVED_NOW, guards })
    return r2.status === 'BLOCKED' && !r2.reasons.some((x) => x.includes('보호장치 상태가 없다'))
      && r2.perSource.every((s) => s.status === 'BLOCKED')
  })())
  check('🔴 다회 job 을 전부 올려도 처리량이 모자라면 여전히 BLOCKED 다', (() => {
    const allMulti: ObservedJob[] = SOURCE_FACTS.map((f) => ({
      label: JOB_LABELS[f.id].multi, slots: planSlots(f.id, 'start'), loaded: true,
    }))
    const guards = Object.fromEntries(SOURCE_FACTS.map((f) => [f.id, newGuardState(f.id, '2026-09-08')]))
    const r3 = collectReadiness({ phase: 'start', plan: p100, nowMs: NOW_MS, observed: allMulti, guards })
    return r3.status === 'BLOCKED' && r3.configuredPerDay === 320
      && r3.reasons.some((x) => x.includes('전부 올려도'))
  })())
  check('🔴 current d1 운영과 d10 승격 준비도를 섞지 않는다 — d1 필요량은 지금 능력으로 충분하다', (() => {
    const p1 = planSupply(PROFILES.d1)
    return p1.detailPerDay <= currentCapacity(OBSERVED_NOW).effectivePerDay
  })())

  // 🔴 ⑥ 관제 화면과 JSON 이 같은 객체를 읽는가
  const hh = codeOf('scripts/supply-health.mts')
  check('🔴 health 가 launchctl 관측을 read-only 로 넣는다', /observeJobsSafe\(\)/.test(hh))
  check('🔴 health 가 정적 loaded 플래그로 능력을 세지 않는다',
    !/SOURCES\.filter\(\(s\) => s\.loaded\)/.test(hh))
  check('🔴 health JSON 이 current·prepared·required 를 따로 낸다',
    /configuredPerDay: cur\.effectivePerDay/.test(hh) && /preparedPerDay: prep\.effectivePerDay/.test(hh)
    && /requiredPerDay: plan\.detailPerDay/.test(hh))
  check('🔴 화면도 같은 객체를 읽는다', /collect\.capacity\.configuredPerDay/.test(hh))
  check('🔴 어긋남을 화면에 낸다', /collect\.start\.mismatches/.test(hh))
  check('🔴 준비도 두 호출 **모두** 실제 now 를 넘긴다',
    (hh.match(/collectReadiness\(\{[^}]*nowMs: now\.getTime\(\)/g) ?? []).length === 2
    && (hh.match(/collectReadiness\(\{/g) ?? []).length === 2)
  check('🔴 관측 실패를 "없음" 으로 읽지 않는다', /observeProblem/.test(hh))

  /**
   * 🔴 **다회 템플릿이 운영 경로다** (2026-09-11 정정).
   *    이 PR 을 쓰던 시점에는 1회판이 돌고 있었고, 여기서 "1회판은 그대로 1슬롯" 을 지켰다.
   *    지금은 `-multi` 둘이 등록돼 있고 1회판은 job 도 템플릿도 없다 —
   *    사라진 파일을 붙잡고 있으면 검사가 옛 운영 형태를 되살리라고 요구하게 된다.
   */
  for (const cafe of ['remonterrace', 'wgang'] as const) {
    check(`🔴 ${cafe} 다회 템플릿이 있다`,
      read(`docs/operations/launchd/com.soransoran.navercafe-collect-${cafe}-multi.plist.template`).includes('multi'))
    check(`🔴 ${cafe} 다회 템플릿이 하루 4슬롯이다`, (() => {
      const t = read(`docs/operations/launchd/com.soransoran.navercafe-collect-${cafe}-multi.plist.template`)
      return (t.match(/<key>Hour<\/key>/g) ?? []).length === 4
    })())
    check(`🔴 ${cafe} 옛 1회 템플릿이 없다`,
      !existsSync(`docs/operations/launchd/com.soransoran.navercafe-collect-${cafe}.plist.template`))
  }
}

// ── ⑥ Gate ⑥-B — salt 순서와 **행동** ──
console.log('\n⑥ Gate ⑥-B (salt 를 loadEnvLocal 뒤에 만드는가 · salt 가 판정을 바꾸는가)')
{
  const raw = read('scripts/persona-cohort-run.mts')
  const src = codeOf('scripts/persona-cohort-run.mts')
  const envAt = src.indexOf('await loadEnvLocal()')
  const saltAt = src.indexOf('const salt = ')
  const hashAt = src.indexOf('const hashOf = ')
  check('🔴 loadEnvLocal 을 부른다', envAt >= 0)
  check('🔴 salt 를 그 뒤에 만든다', saltAt > envAt)
  check('🔴 hashOf 도 그 뒤다', hashAt > envAt)
  check('🔴 형제 도구(persona-wave2-assign)와 같은 순서다', (() => {
    const w = codeOf('scripts/persona-wave2-assign.mts')
    return w.indexOf('const salt = ') > w.indexOf('await loadEnvLocal()')
  })())
  check('🔴 왜 순서가 중요한지 코드에 적혀 있다',
    raw.includes('뒤에 만든다') && raw.includes('조용히 전원 pass 로 통과한다'))
  check('🔴 죽은 변수(salt0)를 남기지 않았다', !/salt0/.test(src))
  /**
   * 🔴 **세 호출 전부**가 hashOf 를 받아야 한다. 하나만 검사하면 나머지에서 빼도 통과한다 —
   *    빠진 그 한 곳에서 B2(크롤 author) 갈래가 통째로 건너뛰어진다.
   */
  const collisionCalls = src.match(/checkNameCollision\([^;]*?\)/g) ?? []
  check('🔴 자동 선정 · 사전 검사 · 트랜잭션 재판정 셋 다 같은 함수다', collisionCalls.length === 3)
  check('🔴 세 호출 **전부** hashOf 를 넘긴다 — 하나라도 빠지면 그 자리에서 B2 가 사라진다',
    collisionCalls.length === 3 && collisionCalls.every((c) => c.includes('hashOf')))

  /**
   * 🔴 **행동 fixture — salt 가 다르면 Gate 결과가 실제로 달라지는가.**
   *
   *    순서만 검사하면 "그 줄을 옮겨도 아무 일 없다" 는 반론을 막지 못한다.
   *    적재 때 쓴 salt 로 만든 authorHash 집합에 대고, **다른 salt** 로 후보를 해시하면
   *    B2 대조가 한 건도 걸리지 않는다 — 즉 검사한 적이 없는데 pass 가 된다.
   */
  const hashWith = (salt: string) => (v: string): string =>
    `sha256:${createHash('sha256').update(`${salt}::${v}`, 'utf8').digest('hex')}`
  const REAL_SALT = 'soransoran-real-salt'
  const WRONG_SALT = 'soransoran-voice-v1'
  const CANDIDATE = '수국'
  const sets = {
    memberNames: [] as string[],
    personaNames: [] as string[],
    // 🔴 적재 때 쓴 salt 로 만든 집합이다 — 크롤 author 중 한 명이 이 이름을 쓴다
    authorHashes: new Set([hashWith(REAL_SALT)(CANDIDATE)]),
    authorHashNorms: new Set<string>(),
  }
  const right = checkNameCollision(CANDIDATE, sets, { hashOf: hashWith(REAL_SALT) })
  const wrong = checkNameCollision(CANDIDATE, sets, { hashOf: hashWith(WRONG_SALT) })
  const none = checkNameCollision(CANDIDATE, sets, {})
  check('🔴 맞는 salt 로는 크롤 author 충돌이 잡힌다',
    right.status === 'reject' && right.hits.some((x) => x.kind === 'B2_CRAWL_AUTHOR'))
  check('🔴 다른 salt 를 주입하면 **같은 이름이 통과한다** — 결과가 실제로 달라진다',
    wrong.status === 'pass' && !wrong.hits.some((x) => x.kind === 'B2_CRAWL_AUTHOR'))
  check('🔴 hashOf 를 아예 안 넘겨도 통과한다 — B2 가 통째로 건너뛰어진다', none.status === 'pass')
  check('🔴 즉 salt 를 늦게 읽으면 Gate 가 조용히 무력화된다 (세 결과가 다르다)',
    right.status !== wrong.status && wrong.status === none.status)
  check('🔴 다른 갈래(B1 회원)는 salt 와 무관하게 그대로 잡힌다', (() => {
    const withMember = { ...sets, memberNames: [CANDIDATE] }
    return checkNameCollision(CANDIDATE, withMember, { hashOf: hashWith(WRONG_SALT) }).status === 'reject'
  })())
}

// ── ⑦ advice · caution — 이번 PR 에서 풀지 않는다 ──
console.log('\n⑦ advice · caution (전면 해제하지 않는다)')
{
  const pool = parsePoolDoc(read(POOL_DOC))
  const doc = read(POOL_DOC)
  const sub = (c: PoolCard): AxisSubject => ({
    code: c.code, childrenAgeBands: c.childrenAgeBands, childrenCount: c.childrenCount,
    maritalStatus: c.maritalStatus, parentCare: c.parentCare, menopauseStatus: c.menopauseStatus,
    workStatus: c.workStatus, economicStatus: c.economicStatus, housing: c.housing,
    forbiddenReactionRoles: c.forbiddenReactionRoles, voiceLength: c.voiceLength,
  })
  const cov = new Map(coverageOf(pool.cards.map(sub)).map((x) => [x.axis, x]))
  check('🔴 advice 를 맡을 수 있는 카드가 0명이다 — 전면 금지가 유지된다',
    (cov.get('반응: advice')?.holders.length ?? -1) === 0)
  check('🔴 caution 도 0명이다', (cov.get('반응: caution')?.holders.length ?? -1) === 0)
  check('🔴 새 카드(P21~P25)가 그 금지를 풀지 않았다',
    pool.cards.filter((c) => ['P21', 'P22', 'P23', 'P24', 'P25'].includes(c.code))
      .every((c) => c.forbiddenReactionRoles.includes('advice') && c.forbiddenReactionRoles.includes('caution')))
  check('🔴 정본이 그 이유를 §5-1 ② 로 적어 두었다',
    doc.includes('advice(의료)는 전원 금지') && doc.includes('②가 이 Pool 설계에서 가장 중요한 제약'))
  check('🔴 건강·돈 축에서 advice 가 전원 금지라고 §6-1 에 적혀 있다',
    doc.includes('전원 `advice` · `information`') && doc.includes('전원 `advice`(재무)'))

  // 🔴 의료 단정은 안전 필터에서도 막힌다 — 이번 PR 이 그 규칙을 건드리지 않았다
  const safety = read('scripts/lib/micro-seed-safety-filter.mts')
  check('🔴 의료 단정·시술 유도가 hold 로 남아 있다',
    safety.includes("add('medicalClaim'") && safety.includes("'hold'"))
  check('🔴 그 규칙을 이번 PR 이 바꾸지 않았다', safety.includes('④ 의료 — 🔴 주제가 아니라 단정·시술 유도를 본다'))

  /**
   * 🔴 **scoped 금지(예: `advice(의료)` 만 금지)로 바꾸는 것은 다음 Conversation 작업이다.**
   *    파서가 역할 이름만 읽어 전면 금지로 기록하는 것은 안전한 쪽 오차이고,
   *    푸는 것은 창업자 결정 사항이다. 그 결정을 이 PR 이 대신하지 않는다.
   */
  /**
   * 🔴 **이월 항목은 제목·전제까지 남아 있어야 한다.** "다음에 하자" 한 줄만 남기면
   *    무엇이 끝나야 풀 수 있는지 사라지고, 다음 세션이 근거 없이 풀게 된다.
   */
  const rb = read(RUNBOOK)
  check('🔴 scoped 전환이 **별도 절**로 이월돼 있다',
    rb.includes('### 다음 Conversation 작업 (이 PR 밖)') && rb.includes('scoped 금지'))
  check('🔴 무엇이 끝나야 풀 수 있는지 전제가 남아 있다',
    rb.includes('파서가 괄호 안 영역을 읽어')
    && rb.includes('풀기 전후의 Pool 축 두께 재측정')
    && rb.includes('전면 금지를 유지한다'))
  check('🔴 그 결정이 창업자 몫이라고 적는다', rb.includes('창업자 결정 사항'))
  check('🔴 이번 PR 에서 풀지 않았다고 명시한다',
    read(RUNBOOK).includes('이번 PR 에서 전면 해제하지 않는다'))
  check('🔴 의료·법률·재무 단정 조언 차단 유지가 명시돼 있다',
    read(RUNBOOK).includes('의료 · 법률 · 재무 단정 조언 차단은 유지한다'))
}

// ── ⑧ 차단기 상태 전이 · 동시성 (P0-A) ──
console.log('\n⑧ 차단기 상태 전이 (half-open 재실패 · 시험 한 건) · 동시성')
{
  const T0 = Date.UTC(2026, 8, 8, 3, 0, 0)
  const CD = BREAKER.RATE_LIMIT.cooldownMs
  const open2 = (cls: 'RATE_LIMIT' | 'NETWORK' | 'SERVER' | 'OTHER', at: number): ReturnType<typeof newGuardState> => {
    let g = newGuardState('82cook', '2026-09-08')
    for (let i = 0; i < BREAKER[cls].threshold; i += 1) g = recordFailure(g, cls, at)
    return g
  }

  // 🔴 ① open → cooldown → half-open → 성공 → closed
  const s1 = open2('RATE_LIMIT', T0)
  check('🔴 임계에 닿으면 open', breakerOf(s1, 'RATE_LIMIT', T0) === 'open' && !canRequest(s1, T0).ok)
  check('🔴 쿨다운 직전까지 open', breakerOf(s1, 'RATE_LIMIT', T0 + CD - 1) === 'open')
  check('🟢 쿨다운이 지나면 half-open', breakerOf(s1, 'RATE_LIMIT', T0 + CD) === 'half-open'
    && canRequest(s1, T0 + CD).ok)
  const probed = recordRequest(s1, T0 + CD)
  check('🟢 시험 성공 → closed',
    breakerOf(recordSuccess(probed), 'RATE_LIMIT', T0 + CD) === 'closed'
    && canRequest(recordSuccess(probed), T0 + CD).ok)

  // 🔴 ② open → cooldown → half-open → 실패 → **즉시 open**
  const reFailed = recordFailure(probed, 'RATE_LIMIT', T0 + CD)
  check('🔴 시험 실패 → 즉시 open (half-open 유지가 아니다)',
    breakerOf(reFailed, 'RATE_LIMIT', T0 + CD) === 'open')
  check('🔴 재실패 직후 요청이 막힌다', !canRequest(reFailed, T0 + CD).ok)
  check('🔴 openedAt 이 **새 실패 시각**으로 갱신된다 — 쿨다운이 그때부터 다시 시작한다',
    reFailed.failures.RATE_LIMIT.openedAt === T0 + CD)
  /**
   * 🔴 **결과가 나왔으면 시험 표시를 지운다.** 매달아 두면 그 분류는 시험 시효(5분)가
   *    지날 때까지 "시험 중" 으로 남아, 열린 이유가 쿨다운인지 시험인지 구분되지 않는다.
   */
  check('🔴 시험 실패 뒤 시험 표시가 지워진다', reFailed.failures.RATE_LIMIT.probeStartedAt === null)
  check('🔴 그래서 사유가 "시험 중" 이 아니라 쿨다운이다',
    canRequest(reFailed, T0 + CD).reason.includes('쿨다운')
    && !canRequest(reFailed, T0 + CD).reason.includes('한 건만 시험한다'))
  check('🔴 시험 성공 뒤에도 표시가 남지 않는다',
    recordSuccess(probed).failures.RATE_LIMIT.probeStartedAt === null)
  check('🔴 새 쿨다운 직전까지 open', breakerOf(reFailed, 'RATE_LIMIT', T0 + CD + CD - 1) === 'open')
  check('🟢 새 쿨다운이 지나야 다시 half-open', breakerOf(reFailed, 'RATE_LIMIT', T0 + 2 * CD) === 'half-open')
  check('🔴 예전 동작(첫 실패 시각 유지)이면 재실패 직후에도 half-open 이었다',
    // 옛 규칙을 손으로 재현해 본다 — 지금 코드가 그 값을 내지 않는 것이 이 검사의 뜻이다
    (T0 + CD) - T0 >= CD && breakerOf(reFailed, 'RATE_LIMIT', T0 + CD) !== 'half-open')

  // 🔴 ③ 시험은 한 건이다
  check('🔴 시험 요청을 보내면 그 분류가 다시 열린다 — 두 번째 시험을 보내지 않는다',
    breakerOf(probed, 'RATE_LIMIT', T0 + CD) === 'open' && !canRequest(probed, T0 + CD).ok)
  check('🔴 그 사유가 "한 건만 시험한다" 라고 적힌다',
    canRequest(probed, T0 + CD).reason.includes('한 건만 시험한다'))
  check('🔴 버려진 시험은 시효 뒤에 풀린다 — 프로세스가 죽어도 영원히 막히지 않는다',
    breakerOf(probed, 'RATE_LIMIT', T0 + CD + PROBE_TIMEOUT_MS) === 'half-open')

  // 🔴 ④ 분류별 정책이 서로 분리돼 있다
  check('🔴 403 은 임계 1 · 사람 확인',
    BREAKER.FORBIDDEN.threshold === 1 && BREAKER.FORBIDDEN.requiresHuman)
  check('🔴 403 은 쿨다운으로 풀리지 않는다', (() => {
    let g = newGuardState('82cook', '2026-09-08')
    g = recordFailure(g, 'FORBIDDEN', T0)
    return breakerOf(g, 'FORBIDDEN', T0 + 10 * 24 * 3600_000) === 'open'
      && breakerOf(recordSuccess(g), 'FORBIDDEN', T0) === 'open'
      && breakerOf(clearByHuman(g, 'FORBIDDEN', T0 + 1000), 'FORBIDDEN', T0 + 1000) === 'closed'
  })())
  check('🔴 429 · TCP · SERVER · OTHER 는 임계와 쿨다운이 서로 다르다', (() => {
    const t = new Set([BREAKER.RATE_LIMIT.threshold, BREAKER.NETWORK.threshold, BREAKER.OTHER.threshold])
    const c = new Set([BREAKER.RATE_LIMIT.cooldownMs, BREAKER.NETWORK.cooldownMs, BREAKER.SERVER.cooldownMs])
    return t.size >= 2 && c.size >= 3
  })())
  check('🔴 한 분류가 열려도 다른 분류의 이력은 그대로다', (() => {
    let g = newGuardState('82cook', '2026-09-08')
    g = recordFailure(g, 'NETWORK', T0)
    g = open2('RATE_LIMIT', T0)
    return g.failures.NETWORK.consecutive === 0 || true
  })() && (() => {
    let g = newGuardState('82cook', '2026-09-08')
    g = recordFailure(g, 'NETWORK', T0)
    g = recordFailure(g, 'RATE_LIMIT', T0)
    return g.failures.NETWORK.consecutive === 1 && g.failures.RATE_LIMIT.consecutive === 1
  })())

  // 🔴 ⑤ 동시성 — 저장 계층이 읽고·판단하고·기록하는 것을 한 번에 하는가
  const store = codeOf('scripts/lib/collect-guard-store.mts')
  check('🔴 예약을 잠금 안에서 한다', /export async function reserveRequest/.test(store)
    && /return withGuardLock\(source, \(\) => \{[\s\S]*?canRequest\(/.test(store))
  check('🔴 결과 기록도 잠금 안이다', /export async function settleRequest/.test(store)
    && /withGuardLock\(source, \(\) => \{[\s\S]*?recordFailure\(/.test(store))
  check('🔴 잠금 밖 저장을 막는다', /잠금 없이 저장하려 했다/.test(store))
  check('🔴 잠금에 시효가 있다 — 죽은 프로세스가 영원히 잡고 있지 않는다',
    /LOCK_TTL_MS/.test(store) && /isStale\(held, nowMs, LOCK_TTL_MS\)/.test(store))
  check('🔴 잠금을 못 얻으면 요청하지 않는다 (fail-closed)',
    /이번 회차는 요청하지 않는다/.test(store))
  check('🔴 원자적 write — 임시 파일 + rename', /renameSync\(tmp, path\)/.test(store))
  check('🔴 읽기 전용 경로가 따로 있다 (dry-run · 관제)', /export function readGuard/.test(store))
  /**
   * 🔴 **수집기는 쓰기 경로를 아예 들고 있지 않다.**
   *    상태를 들고 다니며 저장하면 다른 job 이 올린 예산을 덮어쓴다.
   *    이름을 바꿔 들여오는 우회(`writeGuardAtomic as saveGuard`)도 막는다 —
   *    저장 계층에서 **읽기 함수 둘만** 가져오는지 import 문 자체를 본다.
   */
  check('🔴 수집기가 상태 저장 함수를 들여오지 않는다', (() => {
    const c = codeOf('scripts/micro-seed-collect-82cook.mts')
    const imp = /import \{([^}]*)\} from '\.\/lib\/collect-guard-store\.mjs'/.exec(c)
    if (imp === null) return false
    const names = imp[1]!.split(',').map((x) => x.trim()).filter((x) => x !== '')
    return names.length === 2 && names.includes('guardedGet') && names.includes('readGuard')
  })())
  check('🔴 실제 요청이 guardedGet 을 **await 한다** — 죽은 분기로 우회하지 않는다', (() => {
    const c = codeOf('scripts/micro-seed-collect-82cook.mts')
    return /const r = await guardedGet\(\{/.test(c)
      && /source: GUARD_SOURCE/.test(c)
      && !/if \(false\)/.test(c)
  })())
}

// ── ⑨ freshness 단일 계약 (P0-C) ──
console.log('\n⑨ freshness — 러너 · 관제 · 예측 · 준비도가 같은 함수를 쓴다')
{
  const pool = parsePoolDoc(read(POOL_DOC))
  const personas = pool.cards.filter((c) => c.voiceLength !== null).map(toPersona)
  const AT = new Date('2026-09-08T12:00:00+09:00')
  /** 🔴 나이를 직접 넣지 않는다 — `AT` 기준으로 `capturedAt` 을 거꾸로 만든다 */
  const mk = (id: string, title: string, age: number | null, assigned: string | null = null): QueueCandidate => ({
    // 🔴 본문에 현재성 낱말을 넣지 않는다 — 주제 판정은 **제목이 정하게** 둔다.
    //    본문에 `오늘` 이 들어가면 모든 후보가 timely 가 되어 무엇을 재는지 흐려진다
    queueId: id, title, body: `${title}\n\n있었던 소소한 이야기를 적어 봅니다.`,
    gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: assigned,
    capturedAt: age === null ? null : new Date(AT.getTime() - age * 864e5),
  })

  /**
   * 🔴 **사고 재현** — 후보 14건 중 1건이 시각 미상이다.
   *    예전에는 관제가 14건을 세어 READY 라 적고 러너만 13건을 냈다.
   */
  const fourteen: QueueCandidate[] = [
    ...Array.from({ length: 13 }, (_, i) => mk(`q-${i}`, `아침에 산책을 다녀왔습니다 (${i})`, 1)),
    mk('q-unknown', '오랜만에 김치를 담갔어요', null),
  ]
  const prep14 = prepareCandidates({ candidates: fourteen, personas, at: AT })
  check('🔴 자동 대상은 13건이다 (14건이 아니다)', prep14.auto.length === 13)
  check('🔴 빠진 1건은 시각 미상 hold 다',
    prep14.held.length === 1 && prep14.held[0]!.hold === 'AGE_UNKNOWN' && prep14.held[0]!.queueId === 'q-unknown')
  check('🔴 예측도 같은 목록을 센다 — 관제가 14를 세고 러너가 13을 내지 않는다', (() => {
    const f = forecastPublishing({
      // 🔴 거르지 않은 후보를 넘긴다 — 예측기가 그날 나이로 다시 판정한다
      queue: fourteen, personas, history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
      startAt: new Date('2026-09-09T00:00:00+09:00'), days: 14, dailyCap: 1,
      caps: { postsPerWeek: 1, minDaysBetween: 5 },
    })
    return f.in14 === 13
  })())
  check('🔴 준비도도 같은 목록을 센다', (() => {
    const sim = simulateStage({
      stage: 'd1', queue: fourteen, personas,
      axis: { now: new Date('2026-09-08T12:00:00+09:00'), publishedToday: 0 },
    })
    return sim.stock === 13 && sim.in14 === 13 && !judgeReadiness(sim).ready
  })())
  check('🔴 같은 입력이면 자동 대상 id 가 글자 그대로 같다',
    prepareCandidates({ candidates: fourteen, personas, at: AT }).auto.map((c) => c.queueId).join()
    === prep14.auto.map((c) => c.queueId).join())
  check('🔴 hold 사유도 같다',
    JSON.stringify(prepareCandidates({ candidates: fourteen, personas, at: AT }).held) === JSON.stringify(prep14.held))
  check('🔴 입력 순서를 뒤집어도 같은 결과다', (() => {
    const rev = prepareCandidates({ candidates: [...fourteen].reverse(), personas, at: AT })
    return rev.auto.length === 13 && rev.held.length === 1 && rev.held[0]!.queueId === 'q-unknown'
  })())

  /**
   * 🔴 **persona 자리가 하나뿐일 때 hot 이 이긴다.**
   *    예전 러너는 planBatch 를 먼저 돌리고 순서를 나중에 바꿔, 오래된 글이 자리를 쥐었다.
   */
  const onePersona = personas.slice(0, 1)
  const CAP1 = { postsPerWeek: 1, minDaysBetween: 1 }
  /**
   * 🔴 **두 후보가 같은 요건이라 같은 persona 한 명을 놓고 다툰다.**
   *    id 를 일부러 `a-ever` · `z-hot` 로 두어, 우선권이 없으면 사전순으로 상시가 이기게 만든다 —
   *    그래야 "우선권이 실제로 작동하는가" 를 이 검사 하나가 가른다.
   */
  const EV_BODY = '아침에 산책을 다녀왔습니다. 커피 한 잔 마시며 쉬는 중이에요. 소소한 이야기를 적어 봅니다.'
  const HOT_BODY = '요즘 날씨가 부쩍 서늘해졌어요. 커피 한 잔 마시며 쉬는 중이에요. 소소한 이야기를 적어 봅니다.'
  const race: QueueCandidate[] = [
    { queueId: 'a-ever', title: '아침에 산책을 다녀왔습니다', body: EV_BODY, gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null, capturedAt: new Date(AT.getTime() - 10 * 864e5) },
    { queueId: 'z-hot', title: '요즘 날씨가 부쩍 서늘해졌어요', body: HOT_BODY, gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null, capturedAt: AT },
  ]
  const raced = prepareCandidates({ candidates: race, personas: onePersona, caps: CAP1, at: AT })
  check('🔴 둘 다 자동 대상이다 — 진짜 자리 경쟁이다', raced.auto.length === 2)
  check('🔴 자리가 하나면 현재성 hot 이 먼저 선다', raced.auto[0]!.queueId === 'z-hot')
  const assignedIds = raced.batch.assignments.filter((a) => a.assigned !== null).map((a) => a.queueId)
  check('🔴 그 한 자리를 hot 이 가져간다', assignedIds.join() === 'z-hot')
  /**
   * 🔴 **대조군** — 우선권을 넘기지 않으면 같은 입력에서 상시가 자리를 가져간다.
   *    즉 이 검사는 "우선권이 실제로 결과를 바꾼다" 를 증명한다.
   */
  const noPriority = planBatch(raced.auto, onePersona, CAP1)
  check('🔴 우선권이 없으면 상시가 자리를 가져간다 (대조군)',
    noPriority.assignments.filter((a) => a.assigned !== null).map((a) => a.queueId).join() === 'a-ever')
  check('🔴 최대 매칭 총량은 그대로다 — 우선순위가 배정 수를 줄이지 않는다',
    noPriority.assignments.filter((a) => a.assigned !== null).length === assignedIds.length)
  check('🔴 입력 순서를 뒤집어도 hot 이 이긴다',
    prepareCandidates({ candidates: [...race].reverse(), personas: onePersona, caps: CAP1, at: AT })
      .batch.assignments.filter((a) => a.assigned !== null).map((a) => a.queueId).join() === 'z-hot')
  check('🔴 persona 주 상한을 넘기지 않는다', (() => {
    const load = new Map<string, number>()
    for (const a of raced.batch.assignments) {
      if (a.assigned !== null) load.set(a.assigned, (load.get(a.assigned) ?? 0) + 1)
    }
    return [...load.values()].every((n) => n <= CAP1.postsPerWeek)
  })())
  /**
   * 🔴 **상시끼리는 적합도가 순서를 가른다.** `fitScore` 를 0 으로 박으면 이 순서가 무너진다.
   */
  /**
   * 🔴 **상시끼리는 적합도가 순서를 가른다.**
   *    본문 길이가 그 persona 의 문체 밴드와 얼마나 맞느냐로 점수가 갈린다(95 vs 85 실측).
   *    낮은 점수 글을 **먼저** 넣어, 순서가 줄 순서가 아니라 점수로 정해지는지 본다.
   */
  check('🔴 상시 후보는 적합도 높은 쪽이 먼저 선다 (줄 순서를 이긴다)', (() => {
    const long = `${EV_BODY} ${'커피 한 잔 마시며 쉬는 중이에요. '.repeat(10)}`
    const evergreens: QueueCandidate[] = [
      // seq 0 · 점수 낮음(긴 본문)
      { queueId: 'ev-low', title: '아침에 산책을 다녀왔습니다', body: long, gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null, capturedAt: new Date(AT.getTime() - 10 * 864e5) },
      // seq 1 · 점수 높음(짧은 본문)
      { queueId: 'ev-high', title: '아침에 산책을 다녀왔습니다', body: EV_BODY, gateVerdict: 'PASS', createdAt: 1, assignedPersonaCode: null, capturedAt: new Date(AT.getTime() - 10 * 864e5) },
    ]
    const pr = prepareCandidates({ candidates: evergreens, personas: onePersona, caps: { postsPerWeek: 5, minDaysBetween: 1 }, at: AT })
    if (pr.auto.length !== 2) return false
    const scores = pr.auto.map((c) => pr.fitScoreOf(c.queueId))
    // 🔴 점수가 실제로 갈려야 이 검사가 뜻을 갖는다
    return new Set(scores).size > 1 && pr.auto[0]!.queueId === 'ev-high'
      && scores.every((v, i) => i === 0 || scores[i - 1]! >= v)
  })())

  // 🔴 상한 복구는 hold — 다른 글로 우회하지 않는다
  const stale = prepareCandidates({
    candidates: [mk('rec-stale', '요즘 날씨', 99, 'P01'), mk('fresh', '요즘 날씨', 0)],
    personas, at: AT,
  })
  check('🔴 상한 복구는 자동에서 빠진다', !stale.auto.some((c) => c.queueId === 'rec-stale'))
  check('🔴 사유가 RECOVERY_STALE 이다',
    stale.held.some((h) => h.queueId === 'rec-stale' && h.hold === 'RECOVERY_STALE'))
  check('🔴 재배정하지 않는다고 적는다',
    stale.held.find((h) => h.queueId === 'rec-stale')!.reason.includes('재배정하지도 삭제하지도 않는다'))

  // 🔴 깨진 복구는 전체 중단 — 우회 금지
  const broken = prepareCandidates({
    candidates: [mk('rec-broken', '요즘 날씨', 1, 'P99-없는사람'), mk('other', '요즘 날씨', 0)],
    personas, at: AT,
  })
  check('🔴 깨진 복구는 recoveryProblem 으로 잡힌다',
    broken.batch.assignments.some((a) => a.queueId === 'rec-broken' && a.recoveryProblem !== null))
  check('🔴 예측도 그때 발행 0 으로 멈춘다', (() => {
    const f = forecastPublishing({
      queue: [mk('rec-broken', '요즘 날씨', 1, 'P99-없는사람'), mk('other', '요즘 날씨', 0)],
      personas, history: personas.map((p) => ({ code: p.code, matchedAts: [] })),
      startAt: new Date('2026-09-09T00:00:00+09:00'), days: 3, dailyCap: 1,
    })
    return f.recoveryBroken.length > 0 && f.in14 === 0
  })())

  // 🔴 fitScore 는 실제 배정된 persona 의 점수다
  const fitCase = prepareCandidates({
    candidates: [mk('a', '무릎이 시큰거려요', 5), mk('b', '오래된 살림 이야기', 5)],
    personas, at: AT,
  })
  check('🔴 fitScore 가 배정된 persona 의 점수와 같다', (() => {
    for (const a of fitCase.batch.assignments) {
      if (a.assigned === null) continue
      const want = a.eligible.find((c) => c.code === a.assigned)?.score.total ?? -1
      if (fitCase.fitScoreOf(a.queueId) !== want) return false
    }
    return true
  })())
  check('🔴 우선순위 계층이 복구 → hot → warm → 상시 순이다', (() => {
    const t = (title: string, age: number, rec: boolean): number =>
      priorityTierOf(judgeCandidate({ queueId: 'x', title, body: '', ageDays: age, isRecovery: rec, seq: 0 }), rec)
    return t('요즘 날씨', 1, true) === 0 && t('요즘 날씨', 0, false) === 1
      && t('요즘 날씨', 5, false) === 2 && t('무릎 이야기', 5, false) === 3
  })())

  // 🔴 생산 경로가 그 함수를 실제로 부르는가
  const runner = codeOf('scripts/original-post-auto-publish.mts')
  const health = codeOf('scripts/supply-health.mts')
  check('🔴 러너가 prepareCandidates 결과를 **그대로** 쓴다 — 대체 경로를 두지 않는다',
    /\nconst prepared = prepareCandidates\(\{\n/.test(runner)
    && !/const prepared = [^\n]*\?\?/.test(runner))
  check('🔴 러너가 자체 planBatch 를 다시 돌리지 않는다', !/const batch = planBatch\(/.test(runner))
  check('🔴 관제도 같은 함수를 쓴다', /prepareCandidates\(\{/.test(health))
  check('🔴 관제가 예측에 **거르지 않은 후보**를 넘긴다 — 예측기가 날짜마다 다시 판정한다',
    /const forecastQueue = queueCandidates/.test(health))
  check('🔴 러너 stageVerdicts 도 거르지 않은 후보를 넘긴다 — 단계마다 그 cap 으로 다시 정한다',
    /queue: queueCandidates,/.test(runner))
  check('🔴 러너가 assignedPersonaCode 를 null 로 박지 않는다',
    !/assignedPersonaCode: null,\n\s*\}\)\),\n\s*personas: personas as never/.test(runner)
    && /assignedPersonaCode: t\.matchedPersonaId === null/.test(runner))
  check('🔴 관제 JSON 이 자동 대상·hold 를 낸다', /candidates: \{/.test(health) && /held: prepared\.held/.test(health))
  check('🔴 관제 화면도 같은 값을 읽는다', /describePrepared\(prepared\)/.test(health))
}

// ── ⑩ 차단기 관제 시각 (P1-D) ──
console.log('\n⑩ 차단기 관제 시각 — 준비도와 화면이 같은 시각을 본다')
{
  const OPENED = Date.UTC(2026, 8, 8, 0, 10, 0)
  const CD = BREAKER.RATE_LIMIT.cooldownMs
  let g = newGuardState('navercafe:wgang', '2026-09-08')
  for (let i = 0; i < BREAKER.RATE_LIMIT.threshold; i += 1) g = recordFailure(g, 'RATE_LIMIT', OPENED)
  const obs: ObservedJob[] = [{
    label: JOB_LABELS['navercafe:wgang'].multi, slots: planSlots('navercafe:wgang', 'start'), loaded: true,
  }]
  const before = OPENED + CD - 60_000
  const after = OPENED + CD + 60_000
  const rdy = (nowMs: number): ReturnType<typeof sourceReadiness> =>
    sourceReadiness({ id: 'navercafe:wgang', phase: 'start', nowMs, guard: g, observed: obs })
  check('🔴 쿨다운 직전에는 준비도가 open 을 사유로 적는다',
    rdy(before).reasons.some((r) => r.includes('RATE_LIMIT 차단기가 열려 있다')))
  check('🟢 쿨다운이 지나면 그 사유가 사라진다',
    !rdy(after).reasons.some((r) => r.includes('RATE_LIMIT 차단기가 열려 있다')))
  check('🔴 화면 snapshot 과 준비도가 같은 시각에 같은 말을 한다', (() => {
    const snapBefore = guardSnapshot(g, before).breakers.find((b) => b.cls === 'RATE_LIMIT')!
    const snapAfter = guardSnapshot(g, after).breakers.find((b) => b.cls === 'RATE_LIMIT')!
    return snapBefore.status === 'open' && snapAfter.status === 'half-open'
      && rdy(before).reasons.some((r) => r.includes('RATE_LIMIT'))
      && !rdy(after).reasons.some((r) => r.includes('RATE_LIMIT'))
  })())
  check('🔴 budgetDay 자정을 넣으면 두 화면이 갈린다 — 그래서 nowMs 를 받는다', (() => {
    const midnight = Date.parse('2026-09-08')
    // 자정은 openedAt 보다 앞이라 언제나 open 으로 읽힌다 — 실제로 half-open 인 시각에도
    return breakerOf(g, 'RATE_LIMIT', midnight) === 'open' && breakerOf(g, 'RATE_LIMIT', after) === 'half-open'
  })())
  const plan = codeOf('src/lib/scale-supply-plan.ts')
  check('🔴 준비도가 budgetDay 를 시각으로 쓰지 않는다', !/Date\.parse\(guard\.budgetDay\)/.test(plan))
  check('🔴 nowMs 를 필수로 받는다', /nowMs: number/.test(plan) && /breakerOf\(guard, cls, nowMs\)/.test(plan))
}

// ── ⑪ 403 사람 해제 도구 (P1-E) ──
console.log('\n⑪ 403 사람 해제 도구')
{
  const tool = codeOf('scripts/collect-guard-clear.mts')
  const raw = read('scripts/collect-guard-clear.mts')
  check('🔴 기본이 dry-run 이다', /const APPLY = argv\.includes\('--apply'\)/.test(tool)
    && /적용하지 않았습니다/.test(raw))
  check('🔴 source allowlist 를 요구한다',
    /SOURCES: readonly SourceId\[\] = SOURCE_FACTS/.test(tool)
    && /if \(!\(SOURCES as readonly string\[\]\)\.includes\(rawSource!\)\) \{\s*fail\(/.test(tool))
  check('🔴 source 가 없으면 멈춘다', /if \(rawSource === null\) fail\(/.test(tool))
  check('🔴 class 도 allowlist 다', /FAILURE_CLASSES as readonly string\[\]/.test(tool))
  check('🔴 --apply 에 --reason 을 요구한다', /--reason "\.\.\." 이 필요합니다/.test(raw))
  check('🔴 열리지 않은 차단기는 해제하지 않는다', /이미 닫혀 있습니다 — 해제할 것이 없습니다/.test(raw))
  check('🔴 현재 상태와 예정 상태를 함께 낸다', /지금 상태/.test(raw) && /적용 후/.test(raw))
  check('🔴 지정한 분류 하나만 손댄다', /clearByHuman\(fresh, CLS, now\.getTime\(\)\)/.test(tool)
    && /건드리지 않습니다/.test(raw))
  check('🔴 상태 파일을 지우지 않는다', !/unlinkSync|rmSync/.test(tool))
  check('🔴 원자적 write 를 쓰는 저장 계층을 통한다', /saveGuard\(/.test(tool) && /withGuardLock\(/.test(tool))
  check('🔴 해제 이력을 append-only 로 남긴다', /appendFileSync\(AUDIT_LOG/.test(tool))
  check('🔴 DB · 네트워크 호출이 없다', !/PrismaClient|fetch\(/.test(tool))
  check('🔴 예산을 건드리지 않는다 — 해제는 차단기만 연다', (() => {
    const T = Date.UTC(2026, 8, 8, 3, 0, 0)
    let g = recordRequest(newGuardState('82cook', '2026-09-08'), T)
    g = recordFailure(g, 'FORBIDDEN', T)
    const cleared = clearByHuman(g, 'FORBIDDEN', T + 1000)
    return cleared.requestsToday === g.requestsToday
      && breakerOf(cleared, 'FORBIDDEN', T + 1000) === 'closed'
  })())
  check('🔴 다른 분류는 그대로 남는다', (() => {
    const T = Date.UTC(2026, 8, 8, 3, 0, 0)
    let g = newGuardState('82cook', '2026-09-08')
    g = recordFailure(g, 'FORBIDDEN', T)
    for (let i = 0; i < BREAKER.RATE_LIMIT.threshold; i += 1) g = recordFailure(g, 'RATE_LIMIT', T)
    const cleared = clearByHuman(g, 'FORBIDDEN', T + 1000)
    return breakerOf(cleared, 'RATE_LIMIT', T + 1000) === 'open'
  })())
  check('🔴 status 명령이 사람 해제가 필요한 분류를 짚는다', (() => {
    const T = Date.UTC(2026, 8, 8, 3, 0, 0)
    const g = recordFailure(newGuardState('82cook', '2026-09-08'), 'FORBIDDEN', T)
    return guardSnapshot(g, T).needsHuman.join() === 'FORBIDDEN'
  })())
  // 🔴 네트워크 관측이 문서에 남았는가 — 403 과 TCP 를 같은 원인으로 합치지 않는다
  const rb = read(RUNBOOK)
  const ma = read('docs/operations/MASTER-OPERATING-SYSTEM.md')
  /** 🔴 세 망을 **모두** 적어야 "같은 기기인데 망만 다르다" 가 근거가 된다 */
  for (const [label, net] of [['runbook', rb], ['MASTER', ma]] as const) {
    check(`🔴 ${label} 에 세 망 관측이 모두 있다`,
      net.includes('도서관 Wi-Fi') && net.includes('스타벅스 Wi-Fi') && net.includes('집 Wi-Fi'))
    check(`🔴 ${label} 이 전역·기기·계정 차단 가능성이 낮다고 적는다`,
      net.includes('전역 차단') && net.includes('계정 차단') && net.includes('가능성은 낮다'))
    check(`🔴 ${label} 이 네트워크 경로 문제 가능성이 높다고 적는다`,
      net.includes('네트워크 경로 문제 가능성이 높다'))
    check(`🔴 ${label} 이 원인 미확정이라고 적는다`, net.includes('정확한 원인은 미확정이다'))
    check(`🔴 ${label} 이 도서관 live 수집 금지를 적는다`,
      /도서관 Wi-Fi\s?에서는 82cook live 수집을 하지 않는다/.test(net))
    check(`🔴 ${label} 이 403 과 TCP 를 합치지 않는다고 적는다`,
      net.includes('403 과 TCP 를 같은 원인으로 합치지 않는다')
      || net.includes('403과 TCP를 같은 원인으로 합치지 않는다'))
  }
  /** 🔴 `sourceCapturedAt` 의 뜻을 흐리지 않는다 */
  for (const [label, net] of [['runbook', rb], ['MASTER', ma]] as const) {
    check(`🔴 ${label} 이 sourceCapturedAt 을 관측 시각 proxy 로 적는다`,
      net.includes('관측 시각 proxy'))
    check(`🔴 ${label} 이 게시 시각이 아니라고 못박는다`, net.includes('게시 시각이 아니다'))
    check(`🔴 ${label} 이 완전한 실시간성 보장이 아니라고 적는다`,
      net.includes('완전한 실시간성 보장이 아니'))
  }
  /** 🔴 순간 낡는 값을 영구 정본에 두지 않는다 */
  check('🔴 MASTER 에 옛 main SHA 가 없다', !/7c6530e/.test(ma))
  /**
   * 🔴 "미커밋 변경" 은 **금지 규칙 줄에만** 남는다. 상태 서술로 쓰이면 merge 되는 순간 낡는다.
   */
  check('🔴 MASTER 가 "미커밋 변경" 을 상태로 쓰지 않는다', (() => {
    const lines = ma.split('\n').filter((l) => l.includes('미커밋 변경'))
    return lines.length === 1 && lines[0]!.includes('순간값을 적지 않는다')
  })())
  check('🔴 특정 브랜치를 상태로 지목하지 않는다',
    !/feat\/d10-activation-prep[^`]*는 main이 아니다/.test(ma))
  check('🔴 MASTER 가 SHA·PR 을 적지 않는다고 스스로 못박는다',
    ma.includes('SHA·PR 번호') && ma.includes('순간값을 적지 않는다'))
  check('🔴 MASTER 가 구현됨 / runtime 미활성 / 운영 미검증을 나눈다',
    ma.includes('| 구현됨 |') && ma.includes('| runtime 미활성 |') && ma.includes('| 운영 미검증 |'))
  check('🔴 그 구분이 실제 표로도 쓰인다',
    ma.includes('| 기능 | 구현 | runtime | 운영 검증 |'))
}

// ── ⑫ 러너 == forecast 실제 선택 (P0-A) ──
console.log('\n⑫ 러너와 예측이 같은 글·같은 persona 를 고르는가')
{
  const pool = parsePoolDoc(read(POOL_DOC))
  const personas = pool.cards.filter((c) => c.voiceLength !== null).map(toPersona)
  const one = personas.slice(0, 1)
  const AT = new Date('2026-09-08T12:00:00+09:00')
  const START = new Date('2026-09-09T00:00:00+09:00')
  const EV = '아침에 산책을 다녀왔습니다. 커피 한 잔 마시며 쉬는 중이에요. 소소한 이야기를 적어 봅니다.'
  const HOT = '요즘 날씨가 부쩍 서늘해졌어요. 커피 한 잔 마시며 쉬는 중이에요. 소소한 이야기를 적어 봅니다.'
  const CAP1 = { postsPerWeek: 1, minDaysBetween: 1 }
  /**
   * 🔴 id 를 `a-ever` · `z-hot` 으로 둔다 — 우선권이 없으면 사전순으로 **상시**가 이긴다.
   *    그래야 "우선권이 실제로 작동하는가" 를 이 검사 하나가 가른다.
   */
  const race: QueueCandidate[] = [
    { queueId: 'a-ever', title: '아침에 산책을 다녀왔습니다', body: EV, gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null, capturedAt: new Date(START.getTime() - 10 * 864e5) },
    { queueId: 'z-hot', title: '요즘 날씨가 부쩍 서늘해졌어요', body: HOT, gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null, capturedAt: START },
  ]
  const runner = prepareCandidates({ candidates: race, personas: one, caps: CAP1, at: START })
  const runnerPick = runner.batch.assignments.filter((a2) => a2.assigned !== null)
    .map((a2) => `${a2.queueId}→${a2.assigned}`).join()
  const fc = forecastPublishing({
    queue: race, personas: one, history: one.map((x) => ({ code: x.code, matchedAts: [] })),
    startAt: START, days: 1, dailyCap: 1, caps: CAP1,
  })
  const fcPick = fc.days[0]!.published.map((x) => `${x.queueId}→${x.persona}`).join()
  check('🔴 러너가 현재성 hot 을 고른다', runnerPick === 'z-hot→P01')
  /**
   * 🔴 **수만 맞추면 안 된다 — queueId 와 persona 까지 같아야 한다.**
   *    예전에는 러너 `z-hot`, 예측 `a-ever` 였다(같은 1건이라 수로는 구분되지 않았다).
   */
  check('🔴 예측도 **같은 글·같은 persona** 를 고른다', fcPick === runnerPick)
  check('🔴 예측이 고른 것이 상시가 아니다 (예전 동작)', fcPick !== 'a-ever→P01')
  // 🔴 대조군 — 우선권이 없으면 상시가 자리를 가져간다. 이 fixture 의 검증력이 여기서 드러난다
  check('🔴 우선권을 빼면 상시가 이긴다 (대조군)',
    planBatch(runner.auto, one, CAP1).assignments.filter((a2) => a2.assigned !== null)
      .map((a2) => a2.queueId).join() === 'a-ever')
  check('🔴 입력 순서를 뒤집어도 둘 다 같은 선택이다', (() => {
    const r2 = prepareCandidates({ candidates: [...race].reverse(), personas: one, caps: CAP1, at: START })
    const f2 = forecastPublishing({
      queue: [...race].reverse(), personas: one, history: one.map((x) => ({ code: x.code, matchedAts: [] })),
      startAt: START, days: 1, dailyCap: 1, caps: CAP1,
    })
    return r2.batch.assignments.filter((a2) => a2.assigned !== null).map((a2) => a2.queueId).join() === 'z-hot'
      && f2.days[0]!.published.map((x) => x.queueId).join() === 'z-hot'
  })())

  /**
   * 🔴 **d1 cap 으로 미리 정렬한 큐로 d10 을 계산하지 않는다.**
   *    persona 한 명 · 주 1건이면 d1 은 하루 1건뿐이지만 d10 은 주 5건까지 쓴다.
   *    단계마다 그 cap 으로 다시 계산해야 d10 실제 선택과 d10 준비도가 같아진다.
   */
  check('🔴 d10 준비도의 선택이 d10 실제 계획과 같다', (() => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      queueId: `m-${i}`, title: `아침에 산책을 다녀왔습니다 ${i}`, body: EV,
      gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null, capturedAt: START,
    }))
    const d10caps = { postsPerWeek: PROFILES.d10.postsPerWeek, minDaysBetween: PROFILES.d10.minDaysBetween }
    const plan = prepareCandidates({ candidates: many, personas: one, caps: d10caps, at: START })
    const f10 = forecastPublishing({
      queue: many, personas: one, history: one.map((x) => ({ code: x.code, matchedAts: [] })),
      startAt: START, days: 1, dailyCap: PROFILES.d10.dailyTarget, caps: d10caps,
    })
    const planIds = plan.batch.assignments.filter((a2) => a2.assigned !== null).map((a2) => a2.queueId)
    const fcIds = f10.days[0]!.published.map((x) => x.queueId)
    // d1 cap 에서는 1건뿐이지만 d10 cap 에서는 더 나간다 — 그것이 단계별 재계산의 뜻이다
    const d1caps = { postsPerWeek: PROFILES.d1.postsPerWeek, minDaysBetween: PROFILES.d1.minDaysBetween }
    const d1plan = prepareCandidates({ candidates: many, personas: one, caps: d1caps, at: START })
    const d1n = d1plan.batch.assignments.filter((a2) => a2.assigned !== null).length
    return fcIds.length > 0 && fcIds.every((id) => planIds.includes(id)) && planIds.length > d1n
  })())
  /**
   * 🔴 **단계별 cap 이 예측에 실제로 들어가는가.** 같은 큐·같은 한 명이라도
   *    d1(주 1건)과 d10(주 5건)은 14일 발행량이 달라야 한다. 같으면 cap 이 안 들어간 것이다.
   */
  check('🔴 같은 큐·같은 인원인데 단계마다 결과가 다르다 — cap 이 실제로 주입된다', (() => {
    const many: QueueCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      queueId: `s-${i}`, title: `아침에 산책을 다녀왔습니다 ${i}`, body: EV,
      gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null, capturedAt: START,
    }))
    const axis = { now: START, publishedToday: 0 }
    const d1 = simulateStage({ stage: 'd1', queue: many, personas: one, axis })
    const d10 = simulateStage({ stage: 'd10', queue: many, personas: one, axis })
    // d10 은 주 5건 · 최소 1일이라 같은 한 명으로도 더 많이 낸다
    return d10.in14 > d1.in14 && d1.in14 > 0
  })())
  check('🔴 준비도가 단계별 프로필을 예측에 넘긴다 — 코드로도 확인',
    /caps: \{ postsPerWeek: p\.postsPerWeek, minDaysBetween: p\.minDaysBetween \}/
      .test(codeOf('src/lib/scale-readiness.ts')))
  check('🔴 준비도의 재고도 그 단계 기준이다 — 필터 전 큐 길이가 아니다', (() => {
    const withUnknown: QueueCandidate[] = [
      ...race,
      { queueId: 'unknown', title: '아침에 산책을 다녀왔습니다', body: EV, gateVerdict: 'PASS', createdAt: 2, assignedPersonaCode: null, capturedAt: null },
    ]
    return simulateStage({ stage: 'd1', queue: withUnknown, personas: one, axis: { now: AT, publishedToday: 0 } }).stock === 2
  })())
}

// ── ⑬ 예측에서 나이가 흐른다 (P0-B) ──
console.log('\n⑬ 예측일마다 나이를 다시 잰다')
{
  const pool = parsePoolDoc(read(POOL_DOC))
  const personas = pool.cards.filter((c) => c.voiceLength !== null).map(toPersona)
  const START = new Date('2026-09-09T00:00:00+09:00')
  const hist = personas.map((x) => ({ code: x.code, matchedAts: [] as Date[] }))
  const TIMELY_BODY = '커피 한 잔 마시며 쉬는 중이에요. 소소한 이야기를 적어 봅니다.'
  /** 🔴 지금 나이 2일인 현재성 후보 14건 — 지금은 전부 hot 이다 */
  const timely14: QueueCandidate[] = Array.from({ length: 14 }, (_, i) => ({
    queueId: `t-${i}`, title: `요즘 날씨가 부쩍 서늘해졌어요 ${i}`, body: TIMELY_BODY,
    gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null,
    capturedAt: new Date(START.getTime() - 2 * 864e5),
  }))
  check('🔴 지금은 14건 전부 자동 대상이다',
    prepareCandidates({ candidates: timely14, personas, at: START }).auto.length === 14)
  const f = forecastPublishing({
    queue: timely14, personas, history: hist, startAt: START, days: 14, dailyCap: 1,
    caps: { postsPerWeek: 1, minDaysBetween: 5 },
  })
  /**
   * 🔴 **14건이 전부 나가면 안 된다.** timelyWarm 은 7일이고 후보는 이미 2일 됐다.
   *    START 를 0일차로 보면 5일차에 나이가 7일 = 아직 warm, 6일차에 8일 = expired.
   *    즉 0~5일차 여섯 번만 나갈 수 있다.
   */
  check('🔴 나이가 흘러 TTL 을 넘긴 후보는 빠진다 — 14건이 아니다', f.in14 < 14)
  check('🔴 만료 경계가 정확하다 — 0~5일차 6건', f.in14 === 6)
  check('🔴 6일차부터는 발행이 없다',
    f.days.slice(0, 6).every((d) => d.published.length === 1)
    && f.days.slice(6).every((d) => d.published.length === 0))
  check('🔴 그 뒤 사유는 후보 없음이다 — 자리 경쟁에서도 빠졌다',
    f.days[6]!.blockedReason === 'NO_CANDIDATE')
  /** 🔴 상시 28일 경계 — 같은 방식으로 잰다 */
  const EVER_BODY = '커피 한 잔 마시며 쉬는 중이에요. 소소한 이야기를 적어 봅니다.'
  const ever: QueueCandidate[] = Array.from({ length: 14 }, (_, i) => ({
    queueId: `e-${i}`, title: `아침에 산책을 다녀왔습니다 ${i}`, body: EVER_BODY,
    gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null,
    capturedAt: new Date(START.getTime() - 25 * 864e5),
  }))
  const fe = forecastPublishing({
    queue: ever, personas, history: hist, startAt: START, days: 14, dailyCap: 1,
    caps: { postsPerWeek: 1, minDaysBetween: 5 },
  })
  check('🔴 상시 28일 경계 — 25일 된 후보는 0~3일차 4건만', fe.in14 === 4)
  check('🔴 상시는 현재성보다 오래 버틴다', TTL_DAYS.evergreenWarm > TTL_DAYS.timelyWarm)
  /** 🔴 시각 미상은 첫날부터 빠진다 */
  const unknown: QueueCandidate[] = [{
    queueId: 'u', title: '아침에 산책을 다녀왔습니다', body: EVER_BODY,
    gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null, capturedAt: null,
  }]
  check('🔴 시각 미상은 예측 첫날부터 빠진다', forecastPublishing({
    queue: unknown, personas, history: hist, startAt: START, days: 3, dailyCap: 1,
  }).in14 === 0)
  // 🔴 계약이 코드에 남아 있는가
  const fcSrc = codeOf('src/lib/supply-capacity-forecast.ts')
  check('🔴 예측기가 공용 계획 함수를 그날 시각으로 부른다',
    /prepareCandidates\(\{\s*candidates: remaining, personas: personasNow, caps: input\.caps \?\? \{\}, at,/.test(fcSrc))
  check('🔴 예측기가 planBatch 를 직접 부르지 않는다', !/planBatch\(/.test(fcSrc))
  check('🔴 준비 함수가 나이를 인자 시각으로 잰다',
    /ageDays: ageDaysAt\(c\.capturedAt, at\)/.test(codeOf('src/lib/supply-candidates.ts')))
  check('🔴 QueueCandidate 가 ageDays 스냅숏을 들고 다니지 않는다',
    !/ageDays: number \| null/.test(codeOf('src/lib/supply-candidates.ts')))
}

// ── ⑭ 잠금 프로토콜 구조 (P0-C · 행동은 collect:guard-lock-check 가 본다) ──
console.log('\n⑭ 잠금 프로토콜 — 회수는 reaper 뒤로 · reaper 자체는 회수하지 않는다')
{
  const store = codeOf('scripts/lib/collect-guard-store.mts')
  /**
   * 🔴 **여기서는 구조만 본다.** 실제 경쟁은 두 프로세스가 같은 순간에 같은 파일을 볼 때만
   *    드러나므로 `collect:guard-lock-check` 가 **실제 spawn** 으로 확인한다.
   *    문자열 검사로 "다 고쳤다" 고 말하지 않는다 — 그 fixture 가 정본이다.
   */
  check('🔴 행동 fixture 가 존재하고 CI 에 걸려 있다',
    /npm run collect:guard-lock-check/.test(read('.github/workflows/visibility-guard.yml'))
    && /"collect:guard-lock-check"/.test(read('package.json')))
  check('🔴 그 fixture 는 실제 프로세스를 띄운다',
    /spawn\('npx', \['tsx', script\]/.test(codeOf('scripts/collect-guard-lock-check.mts')))
  check('🔴 그 fixture 는 mkdtemp 안에서만 돈다',
    /mkdtempSync\(join\(tmpdir\(\)/.test(codeOf('scripts/collect-guard-lock-check.mts')))
  check('🔴 그 fixture 에 대조군이 있고 실제로 돌린다 — 검증력이 있다는 증거', (() => {
    const f = codeOf('scripts/collect-guard-lock-check.mts')
    return /const CHILD_LEGACY = `/.test(f) && /raceOnce\(CHILD_LEGACY, \d+\)/.test(f)
  })())
  /**
   * 🔴 **reaper 계층에도 대조군이 있어야 한다.** primary 계층 대조군만으로는
   *    "reaper 회수를 되살리면 잡힌다" 를 증명하지 못한다 — 2026-09-09 재현이 그 자리였다.
   */
  check('🔴 그 fixture 에 **reaper 계층** 대조군이 있고 실제로 돌린다', (() => {
    const f = codeOf('scripts/collect-guard-lock-check.mts')
    return /const CHILD_REAPER_LEGACY = `/.test(f)
      && /raceReaper\(CHILD_REAPER_LEGACY\)/.test(f)
      && /raceReaper\(CHILD_REAPER_REAL\)/.test(f)
  })())
  check('🔴 그 fixture 가 stale reaper 앞에서 "진입 0" 과 "token 유지" 를 함께 본다', (() => {
    const f = codeOf('scripts/collect-guard-lock-check.mts')
    return /real\.peak === 0/.test(f) && /real\.reaperToken === 'dead-reaper'/.test(f)
  })())
  check('🔴 옛 계약("시효가 지난 reaper 도 회수된다") fixture 는 사라졌다',
    !/시효가 지난 reaper 도 회수된다/.test(codeOf('scripts/collect-guard-lock-check.mts')))

  // ── 구조 ──
  check('🔴 회수 전용 reaper 잠금이 있다',
    /export function reaperPath\(source: SourceId\): string \{/.test(store)
    && /REAPER_TTL_MS/.test(store)
    && /tryAcquireReaper\(source, nowMs\)/.test(store))
  check('🔴 잠금 획득이 한 번의 원자적 write 다 — 만들기와 쓰기가 나뉘지 않는다',
    /\{ flag: 'wx' \}/.test(store) && !/openSync\(path, 'wx'\)/.test(store))
  /**
   * 🔴 **stale 회수는 "지우고 만들기" 가 아니라 `rename` 한 번의 교체다.**
   *    지우는 순간 경로가 비고, 그 틈에 빠른 길이 끼어들면 우리가 그 새 잠금을 덮는다.
   */
  check('🔴 stale 회수가 원자적 교체다 — 비는 순간이 없다', (() => {
    // 🔴 `withGuardLock` 안의 회수 지점만 본다. `writeGuardAtomic` 에도 rename 이 있어
    //    파일 전체에서 찾으면 회수를 지우고-만들기로 바꿔도 통과한다
    const fn = store.slice(store.indexOf('export async function withGuardLock'),
      store.indexOf('async function releasePrimary'))
    return /writeFileSync\(tmp, body\(\)\)\s*\n\s*renameSync\(tmp, path\)/.test(fn)
      && !/rmSync\(path/.test(fn)
  })())
  check('🔴 파괴적 조작 직전마다 내 reaper token 을 다시 확인한다', (() => {
    // 🔴 세 자리 전부다 — 생성(absent) · 회수(stale) · 해제. 하나라도 빠지면 도둑맞은 reaper 로 쓴다
    const n = (store.match(/stillHoldsReaper\(source, reap/g) ?? []).length
    return n >= 3
      && /isStale\(held, nowMs, LOCK_TTL_MS\) && stillHoldsReaper\(source, reap, nowMs\)/.test(store)
  })())
  check('🔴 해제도 reaper 안에서 한다 — 회수자 눈앞에서 경로가 비지 않는다',
    /async function releasePrimary[\s\S]*?tryAcquireReaper\(source/.test(store))
  check('🔴 해제는 내 token 일 때만 지운다',
    /cur\.kind === 'info' && cur\.info\.token === token\) rmSync\(lockPath\(source\)/.test(store))
  /**
   * 🔴 **stale reaper 자동 회수는 제거됐다** (2026-09-09).
   *    "교체하고 읽어서 확인" 은 확인과 다음 조작 사이가 다시 열려 같은 TOCTOU 를 만든다.
   *    획득 경로에 관측→조작 쌍이 **아예 없어야** 한다.
   */
  check('🔴 reaper 획득은 `wx` 하나뿐이다 — 관측→조작 쌍이 없다', (() => {
    const fn = store.slice(store.indexOf('function tryAcquireReaper'),
      store.indexOf('export type ReaperAnomaly'))
    return /\{ flag: 'wx' \}/.test(fn)
      && /if \(errnoOf\(e\) !== 'EEXIST'\) throw e/.test(fn)
      && /return null/.test(fn)
      && !/renameSync/.test(fn) && !/rmSync/.test(fn)
      && !/isStale/.test(fn) && !/readLockAt/.test(fn)
  })())
  check('🔴 reaper 를 시효로 뺏는 코드가 파일 어디에도 없다',
    !/isStale\([^)]*REAPER_TTL_MS/.test(store))
  check('🔴 reaper 경로를 rename 하는 코드가 없다', (() => {
    // 🔴 rename 은 두 곳뿐이다 — 상태 파일 원자적 write · primary 회수. 둘 다 reaper 가 아니다
    const n = (store.match(/renameSync\(/g) ?? []).length
    return n === 2 && !/renameSync\([^)]*reaper/i.test(store)
  })())
  check('🔴 reaper 를 지우는 길은 **주인의 token 대조 삭제** 하나뿐이다', (() => {
    const n = (store.match(/rmSync\(reaperPath\(source\)/g) ?? []).length
    return n === 1
      && /if \(stillHoldsReaper\(source, token, nowMs\)\) rmSync\(reaperPath\(source\), \{ force: true \}\)/.test(store)
  })())
  check('🔴 EEXIST 면 살아 있든 시효가 지났든 물러난다 (fail-closed)',
    /if \(reap === null\) \{/.test(store) && /reaperBusy \+= 1/.test(store))

  // ── 남은 reaper 를 운영 이상으로 드러낸다 ──
  check('🔴 남은 reaper 를 운영 이상으로 계산하는 함수가 있다',
    /export function reaperAnomaly\(source: SourceId, nowMs: number\): ReaperAnomaly \| null/.test(store)
    && /export function reaperAnomalyMessage\(a: ReaperAnomaly\): string/.test(store))
  check('🔴 그 문구가 "자동으로 회수하지 않는다" 와 사람 복구 3단계를 담는다',
    /자동으로 회수하지 않는다/.test(store)
    && /수집 job 을 모두 멈춘다/.test(store)
    && /소유 프로세스가 없음을 확인한다/.test(store)
    && /그 뒤에만 이 파일을 지운다/.test(store))
  check('🔴 나이를 모르는(opaque) reaper 는 **항상** 이상으로 본다',
    /if \(cur\.kind === 'opaque'\) return \{ path, ageMs: null/.test(store))
  check('🔴 마감 초과 오류가 남은 reaper 와 막힌 횟수를 함께 말한다', (() => {
    const fn = store.slice(store.indexOf('export async function withGuardLock'),
      store.indexOf('async function releasePrimary'))
    return /const anomaly = reaperAnomaly\(source, now\(\)\.getTime\(\)\)/.test(fn)
      && /reaperAnomalyMessage\(anomaly\)/.test(fn)
      && /회수 잠금에 막힘 \$\{reaperBusy\}회/.test(fn)
  })())
  check('🔴 해제를 못 해도 강제로 지우지 않고 왜 못 했는지 남긴다', (() => {
    const fn = store.slice(store.indexOf('async function releasePrimary'))
    return /process\.stderr\.write\(/.test(fn)
      && /reaperAnomalyMessage\(anomaly\)/.test(fn)
      && (fn.match(/rmSync\(lockPath\(source\)/g) ?? []).length === 1
  })())
  /**
   * 🔴 **"TTL 뒤에 알아서 회수된다" 고 적지 않는다.** reaper 가 남아 있으면 그 문장은 거짓이고,
   *    그것을 믿은 사람은 멈춘 수집을 방치한다.
   */
  check('🔴 해제 실패 안내가 reaper 유무를 구분해 말한다', (() => {
    const fn = store.slice(store.indexOf('async function releasePrimary'))
    return /existsSync\(reaperPath\(source\)\)/.test(fn)
      && /자동으로 회수되지 않는다/.test(fn)
      && /아직 시효 전/.test(fn)
      && /회수 잠금은 없다 — TTL 뒤/.test(fn)
  })())
  check('🔴 releasePrimary 주석이 reaper 가 남은 경우를 거짓으로 적지 않는다', (() => {
    // 🔴 주석을 보는 검사라 `codeOf`(주석 제거본)가 아니라 **원문**을 읽는다
    const raw = read('scripts/lib/collect-guard-store.mts')
    const doc = raw.slice(0, raw.indexOf('async function releasePrimary')).slice(-1200)
    return /reaper 가 남았다 → 자동 회수는 없다/.test(doc)
      && !/TTL 이 지나면 다른 프로세스가 회수한다\(fail-closed\)/.test(doc)
  })())

  // ── 🔴 saveGuard fencing (2026-09-09 재현: 승계당한 옛 주인의 write 가 통과했다) ──
  check('🔴 상태를 쓰는 길은 saveGuard 하나뿐이다', (() => {
    // 🔴 writeGuardAtomic 을 직접 부르는 곳은 saveGuard 안 한 곳뿐이어야 한다
    const calls = (store.match(/[^n] writeGuardAtomic\(state\)/g) ?? []).length
    const outside = /saveGuard[\s\S]*?writeGuardAtomic\(state\)/.test(store)
    return calls === 1 && outside
  })())
  check('🔴 saveGuard 가 잠금 보유만이 아니라 **내 token** 을 요구한다',
    /const token = myToken\.get\(source\)/.test(store)
    && /내 잠금 token 이 없다/.test(store))
  check('🔴 saveGuard 가 write 전에 새 reaper 를 wx 로 얻는다', (() => {
    const fn = store.slice(store.indexOf('export function saveGuard'),
      store.indexOf('export type Reservation'))
    return /const reap = tryAcquireReaper\(source, nowMs\)/.test(fn)
      && /if \(reap === null\)/.test(fn)
      && /회수 잠금을 얻지 못했다/.test(fn)
  })())
  check('🔴 token 대조와 write 가 **같은 reaper 구간 안**이다 (TOCTOU 없음)', (() => {
    const fn = store.slice(store.indexOf('export function saveGuard'),
      store.indexOf('export type Reservation'))
    const open = fn.indexOf('const reap = tryAcquireReaper')
    const cmp = fn.indexOf('held.info.token !== token')
    const write = fn.indexOf('writeGuardAtomic(state)')
    const rel = fn.indexOf('releaseReaper(source, reap')
    return open > 0 && cmp > open && write > cmp && rel > write
  })())
  check('🔴 token 이 다르거나 잠금을 못 읽으면 쓰지 않고 던진다', (() => {
    const fn = store.slice(store.indexOf('export function saveGuard'),
      store.indexOf('export type Reservation'))
    return /if \(held\.kind !== 'info'\)[\s\S]{0,200}?throw new Error/.test(fn)
      && /if \(held\.info\.token !== token\)[\s\S]{0,200}?throw new Error/.test(fn)
      && /넘어갔다/.test(fn)
  })())
  check('🔴 saveGuard 가 자기 reaper 만 finally 에서 푼다', (() => {
    const fn = store.slice(store.indexOf('export function saveGuard'),
      store.indexOf('export type Reservation'))
    return /\} finally \{\s*\n\s*releaseReaper\(source, reap, Date\.now\(\)\)/.test(fn)
  })())
  check('🔴 fencing 이 stale reaper 회수 금지 계약을 깨지 않는다', (() => {
    const fn = store.slice(store.indexOf('export function saveGuard'),
      store.indexOf('export type Reservation'))
    return !/renameSync/.test(fn) && !/rmSync/.test(fn) && !/isStale/.test(fn)
  })())
  check('🔴 reserveRequest·settleRequest·사람 해제가 모두 같은 fencing 을 지난다', (() => {
    const clear = codeOf('scripts/collect-guard-clear.mts')
    return /export async function reserveRequest[\s\S]*?saveGuard\(next\)/.test(store)
      && /export async function settleRequest[\s\S]*?saveGuard\(next\)/.test(store)
      && /withGuardLock\(SOURCE, \(\) => \{[\s\S]*?saveGuard\(/.test(clear)
      && !/writeGuardAtomic\(/.test(clear)
  })())

  // ── 🔴 잠금 안은 동기다 — TTL 넘긴 옛 callback 이 부작용을 만들지 못한다 ──
  check('🔴 withGuardLock callback 타입이 Promise 를 약속하지 않는다',
    /fn: \(\) => T,/.test(store) && !/fn: \(\) => T \| Promise<T>/.test(store))
  check('🔴 Promise 를 돌려주면 실행 중에 던진다 (타입만 믿지 않는다)', (() => {
    const fn = store.slice(store.indexOf('export async function withGuardLock'),
      store.indexOf('async function releasePrimary'))
    return /\?\.then === 'function'/.test(fn) && /동기여야 한다/.test(fn)
  })())
  check('🔴 잠금 안에서 await 하는 생산 호출부가 없다', (() => {
    const prod = [store, codeOf('scripts/collect-guard-clear.mts')].join('\n')
    return !/withGuardLock\([^,]+, async /.test(prod)
  })())
  check('🔴 fixture 도 동기 callback 으로 잠금을 쥔다',
    !/withGuardLock\([^,]+, async /.test(codeOf('scripts/collect-guard-lock-check.mts')))

  // ── fencing 행동 fixture ──
  check('🔴 fencing 을 **실제 승계 프로세스**로 시험한다', (() => {
    const f = codeOf('scripts/collect-guard-lock-check.mts')
    return /⑨ saveGuard fencing/.test(f)
      && /taker\.mts/.test(f)
      && /saveThrew\.includes\('넘어갔다'\)/.test(f)
      && /lockAfterSave === successorToken/.test(f)
  })())
  check('🔴 그 fixture 가 write 0 을 **save 시도 시점에** 확인한다', (() => {
    const f = codeOf('scripts/collect-guard-lock-check.mts')
    return /stateFileAfterSave = existsSync\(guardPath\('82cook'\)\)/.test(f)
      && /!stateFileAfterSave/.test(f)
  })())
  check('🔴 정상 owner save 회귀와 reaper 미잔류도 본다', (() => {
    const f = codeOf('scripts/collect-guard-lock-check.mts')
    return /🟢 정상 owner 의 save 는 성공한다/.test(f)
      && /🔴 save 가 reaper 를 남기지 않는다/.test(f)
  })())

  // ── P1: 오류 분류 ──
  check('🔴 absent 는 ENOENT 하나뿐이다',
    /if \(code === 'ENOENT'\) return \{ kind: 'absent' \}/.test(store))
  check('🔴 읽지 못한 잠금은 unreadable — mtime 으로 나이를 잰다',
    /kind: 'unreadable'; code: string; ageMs: number/.test(store) && /statSync\(path\)\.mtimeMs/.test(store))
  check('🔴 나이조차 모르면 opaque 이고 **절대 회수하지 않는다**',
    /kind: 'opaque'/.test(store) && /if \(held\.kind === 'unreadable'\) return held\.ageMs > ttlMs\s*\n\s*return false/.test(store))
  check('🔴 모든 실패 경로가 마감·대기를 지난다 — continue 로 건너뛰지 않는다',
    !/\n\s*continue\n/.test(store) && /await sleep\(pollDelayMs\(attempt, remaining\)\)/.test(store))
  check('🔴 마감을 넘기면 실제로 던진다 — 검사가 살아 있다', (() => {
    // 🔴 `if (false)` 로 무력화해도 문자열 검사가 통과하면 안 된다
    const both = (store.match(/if \(remaining <= 0\)/g) ?? []).length
    const fn = store.slice(store.indexOf('export async function withGuardLock'),
      store.indexOf('async function releasePrimary'))
    return both === 2 && /if \(remaining <= 0\) \{[\s\S]{0,300}?throw new Error\(/.test(fn)
  })())
  check('🔴 backoff 는 지수이고 마감을 넘겨 자지 않는다',
    /Math\.min\(LOCK_POLL_MAX_MS, LOCK_POLL_MS \* 2 \*\* Math\.max\(0, attempt - 1\)\)/.test(store)
    && /Math\.min\(raw, remainingMs\)/.test(store))
  check('🔴 잠금 뿌리를 주입할 수 있고 기본값은 운영 경로 그대로다',
    /export function setGuardRoot\(dir: string\): void \{ ROOT = dir \}/.test(store)
    && /const DEFAULT_ROOT = '\.\/\.microseed-data'/.test(store)
    && /join\(ROOT, `collect-guard-/.test(store))
  check('🔴 예산 예약과 시험은 여전히 잠금 안이다',
    /export async function reserveRequest[\s\S]*?withGuardLock\(source/.test(store)
    && /export async function settleRequest[\s\S]*?withGuardLock\(source/.test(store))
}

// ── ⑮ Naver 보호장치 (P1-D) ──
console.log('\n⑮ Naver 수집기도 같은 보호장치를 지난다')
{
  const nav = codeOf('scripts/micro-seed-collect-navercafe.mts')
  const store = codeOf('scripts/lib/collect-guard-store.mts')
  check('🔴 목록·상세 이동이 guardedNavigate 를 지난다',
    (nav.match(/guardedNavigate\(\{/g) ?? []).length === 2)
  /**
   * 🔴 **모든 `page.goto` 가 `guardedNavigate` 의 콜백 안에 있어야 한다.**
   *    하나라도 밖에 있으면 그 요청만 보호장치를 우회한다 — 그 상태로 "구현 완료" 라고 적으면
   *    문서가 거짓이 된다.
   */
  check('🔴 맨몸 page.goto 가 없다 — 전부 guardedNavigate 콜백 안이다', (() => {
    const gotos = [...nav.matchAll(/page\.goto\(/g)].map((m) => m.index ?? 0)
    if (gotos.length !== 2) return false
    return gotos.every((idx) => /goto: async \(u\) => \(await $/.test(nav.slice(Math.max(0, idx - 30), idx)))
  })())
  check('🔴 source 는 그 카페의 sourceSite 다 — 82cook 것을 쓰지 않는다',
    /const GUARD_SOURCE = sourceSiteOf\(cafe!\.cafeId\) as SourceId/.test(nav))
  check('🔴 화면에 보호장치 상태를 적는다', /describeGuard\(g, Date\.now\(\)\)/.test(nav))
  check('🔴 상태를 읽기 전용으로만 만진다', /readGuard\(GUARD_SOURCE/.test(nav) && !/saveGuard\(/.test(nav))
  check('🔴 이동도 예약·기록을 잠금 안에서 한다',
    /export async function guardedNavigate[\s\S]*?reserveRequest\(input\.source/.test(store))
  /**
   * 🔴 **던지기 전에 반드시 기록한다.** 기록 없이 throw 하면 실패가 차단기에 세어지지 않아
   *    같은 자리에서 영원히 다시 시도한다.
   */
  check('🔴 이동이 예외로 끝나도 실패를 기록한다', (() => {
    const m = /\} catch \(e\) \{([\s\S]*?)\n  \}/.exec(
      store.slice(store.indexOf('export async function guardedNavigate')))
    const body = m?.[1] ?? ''
    return /classifyNavigation\(\{ error: e \}\)/.test(body)
      && /settleRequest\(input\.source, input\.now\(\), \{ ok: false, cls \}\)/.test(body)
  })())
  check('🔴 성공·실패 응답도 각각 기록한다',
    /\? await settleRequest\(input\.source, input\.now\(\), \{ ok: true \}\)/.test(store)
    && /: await settleRequest\(input\.source, input\.now\(\), \{ ok: false, cls \}\)/.test(store))
  // 🔴 403 과 TCP 를 나눠 분류하는가 — **live 요청 없이** synthetic 으로 본다
  check('🔴 403 응답을 FORBIDDEN 으로 분류한다', classifyNavigation({ status: 403 }) === 'FORBIDDEN')
  check('🔴 429 는 RATE_LIMIT', classifyNavigation({ status: 429 }) === 'RATE_LIMIT')
  check('🔴 5xx 는 SERVER', classifyNavigation({ status: 503 }) === 'SERVER')
  check('🔴 TCP 오류는 NETWORK', classifyNavigation({ error: { code: 'ECONNRESET' } }) === 'NETWORK')
  check('🔴 Playwright timeout 도 NETWORK 다 — 403 과 합치지 않는다',
    classifyNavigation({ error: new Error('page.goto: Timeout 20000ms exceeded') }) === 'NETWORK')
  check('🟢 2xx·3xx 는 실패가 아니다',
    classifyNavigation({ status: 200 }) === null && classifyNavigation({ status: 302 }) === null)
  check('🔴 응답을 못 받은 경우(null)는 실패로 세지 않는다 — 오류가 따로 온다',
    classifyNavigation({ status: null }) === null)
  // 🔴 실제 동작 — 가짜 goto 로 예산·차단기가 도는지 본다 (네트워크 0)
  check('🔴 이동이 예산을 쓰고 성공하면 차단기가 닫힌 채로 남는다', (() => {
    const T = Date.UTC(2026, 8, 8, 3, 0, 0)
    let g = newGuardState('navercafe:wgang', '2026-09-08')
    g = recordRequest(g, T)
    g = recordSuccess(g)
    return g.requestsToday === 1 && breakerOf(g, 'FORBIDDEN', T) === 'closed'
  })())
  check('🔴 403 을 한 번 맞으면 다음 이동이 막힌다', (() => {
    const T = Date.UTC(2026, 8, 8, 3, 0, 0)
    let g = newGuardState('navercafe:wgang', '2026-09-08')
    g = recordFailure(recordRequest(g, T), 'FORBIDDEN', T)
    return !canRequest(g, T).ok && canRequest(g, T).blockedBy === 'FORBIDDEN'
  })())
  // 🔴 문서가 "구현 완료" 라고 적으려면 세 소스가 전부 연결돼 있어야 한다
  check('🔴 세 수집원이 모두 보호장치를 지난다',
    /guardedGet\(\{/.test(codeOf('scripts/micro-seed-collect-82cook.mts'))
    && (nav.match(/guardedNavigate\(\{/g) ?? []).length === 2)
  check('🔴 NAVER_GUARD_NOT_IMPLEMENTED 를 남겨 두지 않았다 — 실제로 연결했다',
    !/NAVER_GUARD_NOT_IMPLEMENTED/.test(codeOf('src/lib/scale-supply-plan.ts'))
    && !read(RUNBOOK).includes('NAVER_GUARD_NOT_IMPLEMENTED'))
}

// ── ⑯ current 능력 정본 하나 (P1-E) ──
console.log('\n⑯ current 수집 능력의 정본은 관측 하나뿐')
{
  const plan = codeOf('src/lib/scale-supply-plan.ts')
  check('🔴 정적 loaded 기반 supplyCapacity 가 없다', !/export function supplyCapacity/.test(plan))
  check('🔴 병목 판정이 관측을 쓴다', /const cur = currentCapacity\(observed\)/.test(plan))
  check('🔴 정적 loaded 로 등록 수를 세지 않는다', !/SOURCES\.filter\(\(s\) => s\.loaded\)/.test(plan))
  const OBS: readonly ObservedJob[] = [
    { label: 'com.soransoran.navercafe-collect-remonterrace', slots: [{ hour: 9, minute: 20 }], loaded: true },
    { label: 'com.soransoran.navercafe-collect-wgang', slots: [{ hour: 13, minute: 20 }], loaded: true },
    { label: 'com.soransoran.supply-process', slots: [{ hour: 23, minute: 15 }], loaded: true },
  ]
  check('🔴 current 는 20건/day 다 (60 이 아니다)', currentCapacity(OBS).effectivePerDay === 20)
  /**
   * 🔴 **처리 job 은 수집 능력이 아니다** (2026-09-11).
   *    옛 중앙 러너는 재고가 모자랄 때만 82cook 을 열었고, 그 조건부 몫까지 합쳐 60건이
   *    "지금 열리는 능력" 으로 적혔다. 지금 82cook 몫은 예약 job 의 슬롯에서만 나온다.
   */
  check('🔴 처리 job 이 올라와 있어도 수집 능력은 그대로다',
    currentCapacity(OBS).effectivePerDay === 20)
  check('🔴 82cook 얇은 상세 job 이 미등록이면 그 몫은 0 이다', thin82cookDetailPerDay(OBS) === 0)
  const p100 = planSupply(PROFILES.d10, 100)
  check('🔴 병목이 관측 능력(20)으로 BLOCK 을 적는다',
    findBottlenecks(p100, undefined, OBS).some((b) => b.stage === 'collect' && b.severity === 'BLOCK'
      && b.detail.includes('20건')))
  check('🔴 관측을 넘기지 않으면 능력 0 으로 본다 — 조용히 낙관하지 않는다',
    findBottlenecks(p100).some((b) => b.stage === 'collect' && b.severity === 'BLOCK' && b.detail.includes('0건')))
  // 🔴 화면·JSON 이 같은 정본을 쓴다
  const hh = codeOf('scripts/supply-health.mts')
  check('🔴 health 가 current 와 prepared 를 따로 낸다',
    /configuredPerDay: cur\.effectivePerDay/.test(hh) && /preparedPerDay: prep\.effectivePerDay/.test(hh))
  check('🔴 조건부 몫이라는 이름이 화면에서 사라졌다',
    !/조건부|onDemandPotential/.test(read('scripts/supply-health.mts')))
}

// ── ⑰ 문서가 실제 계산과 어긋나지 않는다 (P2) ──
console.log('\n⑰ 문서 정합 — 낡은 숫자·낡은 절차를 남기지 않는다')
{
  const sched = read('src/lib/collect-schedule.ts')
  const rb = read(RUNBOOK)
  const ma = read('docs/operations/MASTER-OPERATING-SYSTEM.md')

  /**
   * 🔴 **주석의 수집량이 실제 계산과 같아야 한다.** 옛 주석은 "지금 등록된 것은 하루 70건"
   *    이라고 적었는데, 그 70 은 미등록 job 과 조건부 수집 몫을 합치고 성공률도 곱하지 않은 값이다.
   */
  check('🔴 collect-schedule 주석이 옛 70건을 말하지 않는다', !/하루 70건/.test(sched))
  check('🔴 조건부 몫을 능력으로 세지 않는다고 적는다', /조건부 몫을 능력에 합치지 않는다/.test(sched))
  check('🔴 required 382 를 적는다', /382건/.test(sched))
  check('🔴 그 숫자가 실제 계산과 같다', (() => {
    const OBS: readonly ObservedJob[] = [
      { label: 'com.soransoran.navercafe-collect-remonterrace', slots: [{ hour: 9, minute: 20 }], loaded: true },
      { label: 'com.soransoran.navercafe-collect-wgang', slots: [{ hour: 13, minute: 20 }], loaded: true },
      { label: 'com.soransoran.supply-process', slots: [{ hour: 23, minute: 15 }], loaded: true },
    ]
    return currentCapacity(OBS).effectivePerDay === 20
      && thin82cookDetailPerDay(OBS) === 0
      && planSupply(PROFILES.d10, 100).detailPerDay === 382
  })())

  /**
   * 🔴 **변동 수치를 문서에 박지 않는다.** 검사를 하나 더할 때마다 낡는다.
   */
  check('🔴 runbook 에 고정된 pass 개수가 없다', !/# *[0-9]+ pass/.test(rb))
  check('🔴 대신 0 fail 을 계약으로 적는다', /# 0 fail/.test(rb))
  check('🔴 잠금 fixture 도 검증 목록에 있다', /collect:guard-lock-check/.test(rb))

  /**
   * 🔴 **핫스팟은 필수 다음 단계가 아니다.** 같은 Mac 에서 정상 망 둘을 이미 확인했다.
   */
  for (const [label, doc] of [['MASTER', ma], ['runbook', rb]] as const) {
    check(`🔴 ${label} 이 핫스팟을 필수 단계로 두지 않는다`,
      /핫스팟 확인은 필수 다음 단계가 아니다|핫스팟 확인을 필수 다음 단계로 두지 않는다/.test(doc))
    check(`🔴 ${label} 이 도서관 망 자체를 봐야 한다고 적는다`,
      /도서관 망 자체를 보는 관측/.test(doc))
    check(`🔴 ${label} 이 도서관 live 수집 금지를 유지한다`,
      /도서관 Wi-Fi\s?에서는 82cook live 수집을 하지 않는다/.test(doc))
    check(`🔴 ${label} 이 원인 미확정을 유지한다`, /미확정/.test(doc))
    check(`🔴 ${label} 이 403 과 TCP 를 합치지 않는다`,
      /403 과 TCP 를 같은 원인으로 합치지 않는다|403과 TCP를 같은 원인으로 합치지 않는다/.test(doc))
  }
  check('🔴 MASTER 가 세 망 관측을 모두 적는다',
    ma.includes('도서관 Wi-Fi') && ma.includes('스타벅스 Wi-Fi') && ma.includes('집 Wi-Fi'))
  check('🔴 우회 금지가 남아 있다', /VPN.*프록시.*UA 위장.*IP 회전/.test(ma.replace(/\n/g, ' ')))

  /**
   * 🔴 **reaper 회수 계약이 문서에도 있어야 한다.** 코드만 고치고 문서가 "시효가 지나면 뺏는다"
   *    로 남아 있으면, 다음 사람이 문서를 근거로 회수를 되살린다.
   */
  check('🔴 MASTER 가 primary 와 reaper 를 나눠 적는다',
    /### 8\.4 잠금 회수 계약/.test(ma)
    && /reaper\) \| 🔴 \*\*절대 뺏지 않는다\*\*/.test(ma))
  check('🔴 MASTER 가 "시효가 지나면 뺏는다" 를 reaper 에 적용하지 않는다',
    !/잠금은 시효\(60초\)가 지나면 뺏고/.test(ma)
    && /reaper는 시효가 지나도 자동 회수하지 않는다/.test(ma))
  check('🔴 MASTER 가 재현 사실(MAX_CONCURRENT=2)과 재확인·token·rename 무용을 적는다',
    /MAX_CONCURRENT=2/.test(ma) && /재확인·token·rename/.test(ma))
  check('🔴 MASTER 가 대가(그 source 의 수집이 멈춘다)를 숨기지 않는다',
    /수집이 멈춘다/.test(ma))
  check('🔴 runbook 에 사람 복구 절차 §12 가 있다',
    /## §12 회수 잠금\(reaper\) 이 남았을 때/.test(rb))
  check('🔴 그 절차가 "job 정지 → 소유 프로세스 부재 확인 → 그 뒤 삭제" 순서다', (() => {
    const s = rb.slice(rb.indexOf('## §12'))
    const stop = s.indexOf('수집 job 을 전부 멈춘다')
    const noOwner = s.indexOf('소유 프로세스가 없음을 확인한다')
    const del = s.indexOf('그 뒤에만')
    return stop > 0 && noOwner > stop && del > noOwner
  })())
  check('🔴 그 절차가 "이 PR 에서는 실행 0" 을 명시한다',
    /이 PR 에서는 job 정지·파일 삭제·live 수집을 \*\*하지 않았다\.\*\*/.test(rb))
  check('🔴 MASTER 와 runbook 이 서로를 가리킨다',
    ma.includes('2026-09-08-d10-activation-prep.md') && rb.includes('MASTER §8.4'))
  /**
   * 🔴 **fencing 계약도 문서에 있어야 한다.** 코드만 고치고 문서가 "잠금 안이면 쓴다" 로
   *    남아 있으면, 다음 사람이 문서를 근거로 fencing 을 지운다.
   */
  check('🔴 MASTER 8.5 가 fencing 4단계를 적는다',
    /### 8\.5 상태 write는 fencing한다/.test(ma)
    && /`wx`로 \*\*새 reaper\*\*를 얻는다/.test(ma)
    && /내 token\*\*인지 확인한다/.test(ma)
    && /finally`에서 \*\*내 reaper만\*\* 푼다/.test(ma))
  check('🔴 MASTER 가 "token 읽고 바로 쓰기" 를 금지로 못박는다',
    /"token을 읽고 바로 쓴다"는 다시 TOCTOU다/.test(ma)
    && /같은 reaper 구간 안\*\*에 두어야/.test(ma))
  check('🔴 MASTER 가 세 호출부가 같은 관문을 지난다고 적는다',
    /`reserveRequest`·`settleRequest`·사람 해제\(`collect:guard-clear`\)가 모두 이 한 관문을 지난다/.test(ma))
  check('🔴 MASTER 가 잠금 안 동기 계약을 적는다',
    /잠금 안은 동기다/.test(ma) && /Promise를 돌려주면 실행 중에 던진다/.test(ma))
  check('🔴 MASTER 가 "TTL 뒤 알아서 풀린다" 를 거짓으로 못박는다',
    /"TTL이 지나면 알아서 풀린다"고 적지 않는다/.test(ma))
  check('🔴 runbook §13 이 fencing 운영 안내를 담는다', (() => {
    const s = rb.slice(rb.indexOf('## §13'))
    return /## §13 상태 write fencing/.test(rb)
      && /승계당한 옛 주인은 상태를 쓰지 않는다/.test(s)
      && /회수 잠금을 얻지 못했다/.test(s)
      && /잠금 안에서 `await` 하지 않는다/.test(s)
      && /이 PR 에서 job 정지·파일 삭제·live 수집은 \*\*하지 않았다\.\*\*/.test(s)
  })())
  check('🔴 관제 화면(collect:guard-status)이 남은 reaper 를 보여준다', (() => {
    const c = codeOf('scripts/collect-guard-clear.mts')
    return /reaperAnomaly\(id, now\.getTime\(\)\)/.test(c)
      && /회수 잠금\(reaper\) 남음/.test(c)
      && /reaperAnomalyMessage\(anomaly\)/.test(c)
  })())
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
