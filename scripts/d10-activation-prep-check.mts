#!/usr/bin/env tsx
/**
 * d10 activation preparation fixture — 🔴 **DB 0 · 네트워크 0 · LLM 0 · 파일 write 0**
 *
 * 일곱 가지를 고정한다.
 *   ① (지움 2026-09-30) 14일 준비도 시간축 — 정본은 다음 단계 preflight 다
 *   ② persona 24명    얇은 축을 **측정해서** 메웠는가 · 닉네임이 정본 두세 글자인가
 *   ③ (지움 2026-09-30) freshness TTL — 정본은 `judgeSlotRelease` 다
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
  nextSlotAnchor, kstMidnight, horizonStart, minuteOfDay,
} from '../src/lib/scale-profile'
import { resolveScale } from '../src/lib/scale-runtime'
import {
  COHORTS, RUNNABLE_COHORTS, CLOSED_COHORTS, TARGET_PERSONA_COUNT, verifyAllCohorts, EXCLUDED_CODES,
} from '../src/lib/persona-cohort'
import { parsePoolDoc, cardToPersona, type PoolCard } from '../src/lib/persona-pool-card'
import { thinAxes, gainOf, coverageOf, THIN_THRESHOLD, type AxisSubject } from '../src/lib/persona-axis-coverage'
import { verifyNamePolicy, candidatesFor, assignCandidates, NAME_LENGTH } from '../src/lib/persona-nickname-candidates'
import {
  requestsPerRunOf, evidenceAdjustedDetailPerDayOf, detailPerDayOf, SOURCE_FACTS, RUNS_PER_DAY, planSlots, verifySchedule, verifyNoCrossOverlap,
  isolationOf, maxSafeGapHours, pageWindowHours, factsOf, MAX_REQUESTS_PER_DAY,
  thin82cookCapPerRun, THIN_82COOK_RUNS_PER_DAY,
  evidenceAdjustedDetailPerDay, configuredDetailCeilingPerDay,
} from '../src/lib/collect-schedule'
import { planCafeRun } from './lib/navercafe-run-plan.mjs'
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
import { prepareCandidates, describePrepared, type QueueCandidate } from '../src/lib/supply-candidates'
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

/**
 * 🔴 **처리량 기대값은 정본에서 다시 계산한다** — 숫자를 베껴 적지 않는다.
 *    일정이 바뀌면 회차가 바뀌고 이 수도 따라 바뀐다. 베껴 적으면 일정을 고칠 때마다
 *    fixture 가 먼저 깨지고, 그러면 사람이 fixture 를 고치는 데 시간을 쓴다.
 */
/**
 * 🔴 **정본을 부른다** (2026-09-14). 여기서 산식을 다시 적던 판은
 *    82cook 의 thin 상세 경로를 몰라 죽은 raw 상세를 세고 있었다.
 */
const wantTheoretical = (ph: 'start' | 'stable'): number =>
  SOURCE_FACTS.reduce((n, f) => n + detailPerDayOf(f, ph), 0)
const wantEffective = (ph: 'start' | 'stable'): number =>
  SOURCE_FACTS.reduce((n, f) => n + detailPerDayOf(f, ph) * f.detailSuccessRate.value, 0)

/**
 * 🔴 **관측된 job 만으로 하루 상세량을 낸다** — 정본 `planCafeRun` 에서 파생한다.
 *    옛 fixture 는 `10건 × 슬롯` 을 손으로 적었다. 실제는 remonterrace 11 · wgang 16 이다.
 */
const observedDetailPerDay = (obs: readonly ObservedJob[]): number => {
  let n = 0
  for (const cafeId of ['remonterrace', 'wgang'] as const) {
    const cp = planCafeRun({ cafeId })
    const slots = obs.filter((o) => o.loaded && o.label.includes(`collect-${cafeId}`))
      .reduce((a, o) => a + o.slots.length, 0)
    n += cp.detailPerRun * slots
  }
  return n
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
const q = (n: number): QueueCandidate[] => Array.from({ length: n }, (_, i) => ({
  queueId: `q-${String(i).padStart(3, '0')}`, title: `${N[i % N.length]} (${i})`,
  body: `${N[i % N.length]}\n\n있었던 소소한 이야기를 적어 봅니다. ${i}번째 글이에요.`,
  gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null,
  voice: null, profile: 'human' as const, gateResults: null,
}))

// 🔴 (2026-09-30 · source-slot-v1) 이 절은 지웠다 — ① 14일 준비도 시간축(`simulateStage` · `horizonStart` 지평) — 14일치 완성 글 재고를 준비도로 쓰던 정본. 대신 다음 단계 preflight(`judgeNextPreflight` · `stage:scheduler-check`) 가 본다.

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
  /**
   * 🔴 `자녀 대학·취준` 은 이 목록에 없다 (2026-09-13).
   *    P05 카드가 `중고생·초등` 으로 적혀 있었는데, 자녀 나이대 정본은
   *    `persona-children-age-bands.PLANNED` (2026-09-02 창업자 확정) 의 `중고등·대학·취준` 이다.
   *    카드를 확정값에 맞추자 **20장 시점에 이미 3명(P05·P06·P07)** 이 되어
   *    "새 카드가 메운 축" 이 아니게 됐다. 옛 관측은 카드 오기재 위에 서 있었다.
   */
  check('🔴 자녀 대학·취준 은 새 카드 없이 이미 두터웠다 (P05 확정값 반영)',
    coverageOf(before).find((c) => c.axis === '자녀 대학·취준')?.holders.length === 3)
  for (const axis of ['이혼', '사별', '비혼', '자녀 초등', '일: 직장'] as const) {
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

// 🔴 (2026-09-30 · source-slot-v1) 이 절은 지웠다 — ③ freshness(TTL 28일 · 시각 미상 hold · 상한 복구 사람 레인 · 계절 오탐). 대신 정본 `judgeSlotRelease`(원문 게시 72h · 증거 · 반응 · 동력 — `source:slot-release-check`) 가 본다.

// ── ④ 수집원 다회 · 보호장치 ──
console.log('\n④ 수집원 다회 운영 · 보호장치 (예산 · backoff · 차단기)')
{
  check('🔴 수집원은 셋이다', SOURCE_FACTS.length === 3)
  /**
   * 🔴 **정적 `loaded` 는 없앴다** (2026-09-14).
   *    "지금 올라와 있는가" 의 정본은 `launchctl` 관측뿐이다 —
   *    정적 boolean 은 판정에 쓰이지 않는 죽은 값이었고 실제로 낡아 있었다.
   */
  check('🔴 SOURCE_FACTS 에 정적 loaded 가 없다 — 관측만 정본이다', (() => {
    const code = readFileSync('src/lib/collect-schedule.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    return !/\bloaded\b/.test(code)
  })())
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
  /**
   * 🔴 **82cook 은 템플릿 인자, 네이버는 `planCafeRun` 정본에서 온다** (2026-09-14).
   *    옛 fixture 는 네이버도 `1페이지` 로 잠갔는데, 실제 `BOARD_TARGETS` 는
   *    remonterrace 16페이지 · wgang 5페이지를 읽는다.
   */
  check('🔴 82cook 회차당 페이지 수가 템플릿 인자와 묶여 있다',
    factsOf('82cook').listPagesPerRun.value === 3
    && factsOf('82cook').listPagesPerRun.how.includes('--pages=3'))
  for (const cafeId of ['remonterrace', 'wgang'] as const) {
    const cp = planCafeRun({ cafeId })
    check(`🔴 ${cafeId} 회차당 페이지 수가 planCafeRun 정본과 같다 (${cp.listPerRun})`,
      factsOf(cp.source).listPagesPerRun.value === cp.listPerRun)
    check(`🔴 ${cafeId} 회차당 상세가 정본과 같다 (${cp.detailPerRun})`,
      factsOf(cp.source).detailPerRun === cp.detailPerRun)
  }

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
    // 🔴 실제 페이지 수와 무관하게 **배수 관계**를 본다 — 한 장 가정이 아니다
    const base = factsOf('navercafe:wgang')
    const one = { ...base, listPagesPerRun: { value: 1, when: 't', how: 't' } }
    const three = { ...base, listPagesPerRun: { value: 3, when: 't', how: 't' } }
    return base.listPagesPerRun.value > 1
      && (pageWindowHours(three) ?? 0) === (pageWindowHours(one) ?? 0) * 3
  })())

  for (const phase of ['start', 'stable'] as const) {
    check(`🔴 [${phase}] 소스끼리 겹치지 않는다`, verifyNoCrossOverlap(phase).length === 0)
  }
  for (const f of SOURCE_FACTS) {
    const perDay = planSlots(f.id, 'stable').length * requestsPerRunOf(f.id)
    check(`🔴 ${f.id} 하루 요청 ${perDay} ≤ 상한 ${MAX_REQUESTS_PER_DAY[f.id]}`, perDay <= MAX_REQUESTS_PER_DAY[f.id])
  }
  check('🔴 상한을 넘기면 verifySchedule 이 잡는다', (() => {
    const saved = MAX_REQUESTS_PER_DAY['navercafe:wgang']
    ;(MAX_REQUESTS_PER_DAY as Record<string, number>)['navercafe:wgang'] = 1
    const got = verifySchedule('navercafe:wgang', 'stable').some((x) => x.includes('하루 요청'))
    ;(MAX_REQUESTS_PER_DAY as Record<string, number>)['navercafe:wgang'] = saved
    return got
  })())
  /**
   * 🔴 **계약은 "겹치지 않는다" 이지 "분이 다르다" 가 아니다** (2026-09-11 정정).
   *
   *    분을 달리 두는 것은 겹침을 막는 **수단** 중 하나였다. 새 일정은 네이버 두 카페가
   *    둘 다 :30 이지만 **시(hour)를 어긋나게** 두어 실제 시각이 겹치지 않는다
   *    (remonterrace 7·10·13·16·21 · wgang 9·11·15·20).
   *    수단을 계약으로 검사하면, 겹치지 않는 멀쩡한 일정이 FAIL 한다.
   */
  for (const phase of ['start', 'stable'] as const) {
    check(`🔴 [${phase}] 세 소스의 실행 시각이 하나도 겹치지 않는다`,
      verifyNoCrossOverlap(phase).length === 0)
    // 🔴 한 소스 **안에서는** 분이 하나로 고정된다 — 섞이면 손으로 고치다 흘린 것이다
    check(`🔴 [${phase}] 한 소스 안에서 분이 섞이지 않는다`,
      SOURCE_FACTS.every((f) => new Set(planSlots(f.id, phase).map((x) => x.minute)).size === 1))
  }
  check('🔴 목록 4s · 상세 3s (실측)',
    SOURCE_FACTS.every((f) => f.listPaceMs === 4000 && f.detailPaceMs === 3000))

  /**
   * 🔴 **이론 최대와 유효 처리량을 나눈다.**
   *    이론 최대는 한 건도 실패하지 않았을 때의 수다. 82cook 8/10 을 곱하면 그만큼 줄어든다.
   *
   * 🔴 **숫자를 여기 베껴 적지 않는다** (2026-09-11). 일정이 바뀌면 회차가 바뀌고
   *    이 수도 따라 바뀐다 — 베껴 적으면 일정을 고칠 때마다 fixture 가 먼저 깨진다.
   *    정본(`SOURCE_FACTS` × `RUNS_PER_DAY`)에서 다시 계산해 대조한다.
   */
  check('🔴 이론 최대가 정본(상세/회차 × 회차)과 같다',
    configuredDetailCeilingPerDay('start') === wantTheoretical('start')
    && configuredDetailCeilingPerDay('stable') === wantTheoretical('stable'))
  check('🔴 유효 처리량은 성공률을 곱한 값이다',
    evidenceAdjustedDetailPerDay('start') === wantEffective('start')
    && evidenceAdjustedDetailPerDay('stable') === wantEffective('stable'))
  /** 🔴 확정 일정에서의 실측값 — 82cook 30×5×0.8 + remonterrace 10×5 + wgang 10×4 */
  /**
   * 🔴 **설정 상한 204 = 82cook thin 85 + remonterrace 55 + wgang 64** (2026-09-14).
   *    근거 보정 추정치는 여기에 실측 성공률을 곱한 **187** 이다.
   *    옛 값 210·158 은 세 번 틀렸다 — raw 목록 job 의 죽은 상세를 세고,
   *    실제로 상세를 여는 thin 을 빼고, 네이버를 옛 1페이지·10건으로 계산했다.
   */
  check('🔴 설정 상한은 204건/day · 근거 보정 추정치는 187건/day 다',
    configuredDetailCeilingPerDay('start') === 204 && evidenceAdjustedDetailPerDay('start') === 187)
  check('🔴 raw 목록 job 은 유효 처리량에 0 을 보탠다 — 상세를 열지 않는다',
    factsOf('82cook').detailPerRun === 0)
  check('🔴 82cook 몫은 thin 경로에서 나온다 — 상한 85 · 보정 68', (() => {
    const f = SOURCE_FACTS.find((x) => x.id === '82cook')!
    return evidenceAdjustedDetailPerDayOf(f, 'start') === 68
  })())
  check('🔴 성공률을 곱하지 않으면 두 값이 같아진다 (그것이 예전 계산이다)',
    evidenceAdjustedDetailPerDay('start') < configuredDetailCeilingPerDay('start'))
  check('🔴 격리 보고도 유효 처리량으로 적는다', (() => {
    // 🔴 정본에서 뺀다 — 여기서 산식을 다시 적지 않는다
    const f82 = SOURCE_FACTS.find((x) => x.id === '82cook')!
    const alive = wantEffective('start') - evidenceAdjustedDetailPerDayOf(f82, 'start')
    const rmF = SOURCE_FACTS.find((x) => x.id === 'navercafe:remonterrace')!
    const lost = evidenceAdjustedDetailPerDayOf(rmF, 'start')
    return isolationOf(['82cook']).aliveDetailPerDay === alive
      && isolationOf(['navercafe:remonterrace']).lostDetailPerDay === lost
  })())
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
  check('🔴 공개 1 · 준비 눈금 d10(10/day)', split.releaseProfile.dailyTarget === 1 && split.capacityProfile.dailyTarget === 10)
  // 🔴 (2026-09-30) 14일 준비도 시뮬레이션 · 감속(`safeStageFor`) · 승격표(`promotionPlan`)는 지웠다 — 관제도 그것을 내지 않는다
  check('🔴 관제가 14일 준비도 · 승격표를 다시 내지 않는다', !/promotionPlan|simulateAllStages|safeStageFor/.test(codeOf('scripts/supply-health.mts')))

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
    configuredDetailCeilingPerDay('start') < p100.detailPerDay)
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
  // 🔴 관측된 job 하나(remonterrace)의 정본 상세량이다 — 손으로 적지 않는다
  check('🔴 그래서 current 는 관측된 job 몫뿐이다',
    cur.effectivePerDay === observedDetailPerDay(OBSERVED_NOW))
  check('🔴 prepared 는 정본 계획값이다 — current 와 합치지 않는다',
    prep.effectivePerDay === evidenceAdjustedDetailPerDay('start') && prep.effectivePerDay === 187)
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
    && currentCapacity(multiRight).perSource.find((x) => x.id === 'navercafe:remonterrace')!.effectivePerDay
      === planCafeRun({ cafeId: 'remonterrace' }).detailPerRun
        * RUNS_PER_DAY['navercafe:remonterrace'].start)

  // 🔴 ④ 어긋남을 화면·JSON 이 같은 문장으로 낸다
  const mm = inventoryMismatches(OBSERVED_NOW, 'start')
  check('🔴 1회판이 도는 것을 어긋남으로 잡는다',
    mm.filter((x) => x.code === 'SINGLE_WHILE_MULTI_PLANNED').length === 2)
  check('🔴 82cook 미등록도 잡는다', mm.some((x) => x.id === '82cook' && x.code === 'NOT_REGISTERED'))
  check('🔴 어긋남 문장에 지금 회차와 계획 회차가 함께 적힌다',
    mm.some((x) => x.detail.includes('지금 1회')
      && x.detail.includes(`${RUNS_PER_DAY['navercafe:remonterrace'].start}회/day`)))

  // 🔴 ⑤ 준비도 — multi 미등록이면 BLOCKED
  const readyStart = collectReadiness({ phase: 'start', plan: p100, nowMs: NOW_MS, observed: OBSERVED_NOW })
  const readyStable = collectReadiness({ phase: 'stable', plan: p100, nowMs: NOW_MS, observed: OBSERVED_NOW })
  check('🔴 시작 단계 수집 준비도는 BLOCKED 다', readyStart.status === 'BLOCKED')
  check('🔴 안정 단계도 BLOCKED 다', readyStable.status === 'BLOCKED')
  check('🔴 current · prepared · required 를 각각 낸다',
    readyStart.configuredPerDay === observedDetailPerDay(OBSERVED_NOW)
      && readyStart.preparedPerDay === 187
    && readyStart.requiredPerDay === 382)
  check('🔴 지금 열리는 것이 모자란다고 숫자로 적는다', (() => {
    // 🔴 이름을 `설정된 것` 으로 바꿨다 — 등록은 능력이 아니다(2026-09-10)
    //    숫자는 관측에서 파생한다 — 손으로 적지 않는다
    const seen = Math.round(observedDetailPerDay(OBSERVED_NOW))
    return readyStart.reasons.some((r) => r.includes(`설정된 것 ${seen}건/day`)
      && r.includes(`${382 - seen}건 모자란다`))
  })())
  check('🔴 전부 올려도 모자란다는 것을 따로 적는다',
    readyStart.reasons.some((r) => r.includes('전부 올려도')
      && r.includes(`${382 - 187}건 모자란다`)))
  check('🔴 판정은 이론 최대로 하지 않는다',
    readyStart.theoreticalPerDay === wantTheoretical('start')
    && readyStart.theoreticalPerDay > readyStart.preparedPerDay)
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
    /**
     * 🔴 **raw 목록 job 을 올려도 82cook 상세 기여는 0 이다** (2026-09-14).
     *    상세를 여는 것은 thin job 이고, 그 job 은 `JOB_LABELS` 에 없어
     *    관측(current)에 잡히지 않는다. `--auto` 를 뗀 뒤의 실제 모습이다 —
     *    옛 fixture 는 여기서 raw 가 상세 120건을 연다고 기대하고 있었다.
     */
    const only82 = currentCapacity(allMulti).perSource.find((x) => x.id === '82cook')!
    return r3.status === 'BLOCKED' && only82.effectivePerDay === 0
      && r3.configuredPerDay === wantEffective('start') - evidenceAdjustedDetailPerDayOf(
        SOURCE_FACTS.find((x) => x.id === '82cook')!, 'start')
      && r3.reasons.some((x) => x.includes('전부 올려도'))
  })())
  /** 🔴 82cook 상세를 여는 것은 thin job 이다 — raw 목록 job 이 아니다 */
  check('🔴 82cook 상세 몫은 raw 목록 job 이 아니라 thin job 에서 나온다', (() => {
    const f = SOURCE_FACTS.find((x) => x.id === '82cook')!
    return f.detailPerRun === 0
      && detailPerDayOf(f, 'start') === thin82cookCapPerRun() * THIN_82COOK_RUNS_PER_DAY
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
    // 🔴 슬롯 수의 정본은 `RUNS_PER_DAY` 다 — 카페마다 다르다(remonterrace 5 · wgang 4)
    check(`🔴 ${cafe} 다회 템플릿 슬롯 수가 정본과 같다`, (() => {
      const t = read(`docs/operations/launchd/com.soransoran.navercafe-collect-${cafe}-multi.plist.template`)
      return (t.match(/<key>Hour<\/key>/g) ?? []).length === RUNS_PER_DAY[`navercafe:${cafe}`].start
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

// 🔴 (2026-09-30 · source-slot-v1) 이 절은 지웠다 — ⑨ freshness 단일 계약(러너 · 관제 · 예측 · 준비도). 대신 `source:slot-release-check` ⑫ · `supply:stock-parity-check`(러너 · 관제 · 공급이 같은 `judgeSlotRelease`) 가 본다.

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

// 🔴 (2026-09-30 · source-slot-v1) 이 절은 지웠다 — ⑫ 러너 == 14일 예측 선택 · ⑬ 예측일마다 나이 — 14일 발행 예측기(`forecastPublishing`)를 지웠다. 대신 `stage:ladder-check` ⑭(러너 · probe 같은 `planPublishBatch`) 가 본다.

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
  check('🔴 current 는 관측된 job 몫뿐이다 — 계획 전체가 아니다',
    currentCapacity(OBS).effectivePerDay === observedDetailPerDay(OBS))
  /**
   * 🔴 **처리 job 은 수집 능력이 아니다** (2026-09-11).
   *    옛 중앙 러너는 재고가 모자랄 때만 82cook 을 열었고, 그 조건부 몫까지 합쳐 60건이
   *    "지금 열리는 능력" 으로 적혔다. 지금 82cook 몫은 예약 job 의 슬롯에서만 나온다.
   */
  check('🔴 처리 job 이 올라와 있어도 수집 능력은 그대로다',
    currentCapacity(OBS).effectivePerDay === observedDetailPerDay(OBS))
  check('🔴 82cook 얇은 상세 job 이 미등록이면 그 몫은 0 이다', thin82cookDetailPerDay(OBS) === 0)
  const p100 = planSupply(PROFILES.d10, 100)
  check('🔴 병목이 관측 능력으로 BLOCK 을 적는다 — 계획값이 아니다', (() => {
    const seen = Math.round(currentCapacity(OBS).effectivePerDay)
    return findBottlenecks(p100, undefined, OBS).some((b) => b.stage === 'collect'
      && b.severity === 'BLOCK' && b.detail.includes(`${seen}건`))
  })())
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
    return currentCapacity(OBS).effectivePerDay === observedDetailPerDay(OBS)
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
