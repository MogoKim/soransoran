#!/usr/bin/env tsx
/**
 * Scale Foundation fixture — 🔴 **DB 0 · 네트워크 0 · LLM 0 · 파일 write 0**
 *
 * 🔴 가장 중요한 것은 **회귀 0** 이다. 프로필에서 파생한 값이 옛 하드코딩과
 *    하나라도 다르면 지금 도는 1/day 가 조용히 달라진다.
 *
 * 🔴 두 번째는 **실제 파일과 대조**하는 것이다. 손으로 적은 숫자끼리만 맞춰 보면
 *    launchd 템플릿·워크플로우가 바뀌어도 이 fixture 는 계속 통과한다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PROFILES, RELEASE_STAGES, SAFEST_STAGE, HORIZON_DAYS, MAX_DAILY_TARGET,
  RELEASE_ENV, CAPACITY_ENV, derive, verifyProfile, describeProfile,
  maxPostsPerWeek, effectiveWeeklyCap, minuteOfDay, slotLabel, slotCronUtc,
  expandSlots, resolveStage, stageRank, horizonStart,
} from '../src/lib/scale-profile'
import {
  resolveScale, installFromEnv, activeScale, resetScale, describeScale, SAFEST_SCALE,
} from '../src/lib/scale-runtime'
import {
  planSupply, findBottlenecks, requiredRuns, estimateCost, readPricing,
  YIELD, YIELD_EVIDENCE, ASSUMED_STAGES, SOURCES, THIN_82COOK_JOB, thin82cookDetailPerDay, rateOf, COST_ENV,
  detailPerQueueItem,
} from '../src/lib/scale-supply-plan'
import {
  renderSlots, cronLines, parseCronLines, compareWorkflow, dailyCeiling, verifySlotRenderable,
  allStageCronLines, judgeSlotRun, slotOfCron, scheduledRunsPerDay, actualDailyPublishable,
} from '../src/lib/scale-workflow-render'
// 🔴 댓글 슬롯의 정본 — 여기서 시각을 다시 적지 않는다
import {
  planCommentLoopSchedule, FIRST_COMMENT_MAX_MINUTES,
  RUNNER_WINDOW_START_HOUR, RUNNER_WINDOW_END_HOUR,
} from './lib/persona-comment-runner-template'
import { BOOTSTRAP_DAILY_MAX } from '../src/lib/persona-comment-bootstrap-budget'
import { judgeReadiness, safeStageFor, simulateStage, simulateAllStages, stageVerdicts } from '../src/lib/scale-readiness'
import {
  COHORTS, EXCLUDED_CODES, cohortOf, verifyManifest, verifyAllCohorts, stageOf,
  judgeCreate, judgeSeed, judgeActivate, judgePause, judgePrerequisites, judgeArgs,
  judgeCohortArg, judgeStepArg, requiresActor, checkCohortKeys,
  displayNamePathOf, seedPathOf, RUNNABLE_COHORTS, CLOSED_COHORTS, COHORT_STEPS,
  type CohortMemberState, type CohortId,
} from '../src/lib/persona-cohort'
import { parsePoolDoc, cardToPersona } from '../src/lib/persona-pool-card'
import { planCafeRun } from './lib/navercafe-run-plan.mjs'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
import { POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import type { QueueCandidate } from '../src/lib/supply-candidates'
import { currentCapacity, preparedCapacity, type ObservedJob } from '../src/lib/collect-inventory'
import { STOCK_TARGET, STOCK_MIN, STOCK_WARN } from '../src/lib/micro-seed-supply-autofill'
import {
  RUNS_PER_DAY, THIN_82COOK_RUNS_PER_DAY, THIN_82COOK_SLOTS, thin82cookCapPerRun,
} from '../src/lib/collect-schedule'
import {
  judgePublish, judgeManualLimit, MANUAL_PUBLISH_CAP, type PublishCandidate,
} from '../src/lib/original-post-publish'
import {
  buildReport, judgeSupply, judgePublish as judgePublishHealth,
} from '../src/lib/supply-health'
import {
  personaAvailableAt, availablePersonasAt, capacityOf, personasNeededFor,
} from '../src/lib/supply-capacity-forecast'
import { readStock, judgeApply as judgeFill, SAFEST_STOCK_LIMITS } from '../src/lib/micro-seed-supply-autofill'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf-8')
/**
 * 🔴 **주석을 지우고 본다.** 주석에 적힌 예시 코드가 검사를 통과시키면
 *    "안 부른다" 를 확인하려던 검사가 조용히 무력해진다 — 실제로 그랬다.
 */
const codeOf = (f: string): string =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
let pass = 0
let failN = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${n}`) }
}

console.log('\n══ Scale Foundation fixture ══\n')

// ── ① 🔴 회귀 0 — 파생값이 옛 하드코딩과 같다 ──
console.log('① 회귀 0 (env 없음 → d1 · 옛 하드코딩과 동일)')
{
  const d1 = PROFILES.d1
  const d = derive(d1)
  // 🔴 **값으로** 본다. 소스 문자열을 보면 파생 방식이 바뀔 때마다 fixture 를 고치게 된다
  check('🔴 DAILY_PUBLISH_CAP = 1', DAILY_PUBLISH_CAP === 1 && d.dailyPublishCap === 1)
  check('🔴 POST_CAP_PER_WEEK = 1', POST_CAP_PER_WEEK === 1)
  check('🔴 MIN_DAYS_BETWEEN_POSTS = 5', MIN_DAYS_BETWEEN_POSTS === 5 && d1.minDaysBetween === 5)
  check('🔴 STOCK_TARGET = 14', STOCK_TARGET === 14 && d.stockTarget === 14)
  check('🔴 STOCK_MIN = 5', STOCK_MIN === 5 && d.stockMin === 5)
  check('🔴 STOCK_WARN = 3', STOCK_WARN === 3 && d.stockWarn === 3)
  check('지평은 14일', HORIZON_DAYS === 14)
  // 🔴 지금 도는 발행 시각은 09:30 KST 다 — 분 단위라야 적을 수 있다.
  //    (2026-09-12 이전에는 00:05 였다. 댓글 창 밖이라 첫 댓글이 8시간 넘게 걸렸다)
  check('🔴 d1 슬롯이 정확히 09:30 KST 1건', d1.slots.length === 1
    && d1.slots[0]!.hour === 9 && d1.slots[0]!.minute === 30 && d1.slots[0]!.count === 1)
  check('🔴 가장 안전한 단계는 d1', SAFEST_STAGE === 'd1')
}

// ── ② 프로필 계산 · 🔴 rolling 7일 경계 ──
console.log('\n② 프로필 계산 · rolling 7일 경계')
{
  // 🔴 옛 검사는 `간격 × 주건수 > 7` 이라 주 3건·3일 간격을 잘못 거부했다.
  //    실제 경계는 **첫 글 이후 6일 안에 몇 번 더 쓸 수 있는가** 다
  check('🔴 간격 1일 → 주 7건', maxPostsPerWeek(1) === 7)
  check('🔴 간격 2일 → 주 4건', maxPostsPerWeek(2) === 4)
  check('🔴 간격 3일 → 주 3건 (옛 검사는 이것을 거부했다)', maxPostsPerWeek(3) === 3)
  check('🔴 간격 5일 → 주 2건', maxPostsPerWeek(5) === 2)
  check('🔴 간격 7일 → 주 1건', maxPostsPerWeek(7) === 1)
  check('간격 0 은 무제한', maxPostsPerWeek(0) === Number.POSITIVE_INFINITY)
  check('🔴 음수·소수는 0 (fail-closed)', maxPostsPerWeek(-1) === 0 && maxPostsPerWeek(1.5) === 0)
  check('🔴 주 3건 · 3일 간격은 **가능하다** — 거부하지 않는다',
    verifyProfile({ dailyTarget: 3, postsPerWeek: 3, minDaysBetween: 3, slots: [{ hour: 0, minute: 5, count: 3 }] })
      .every((x) => !x.includes('도달할 수 없다')))
  check('🔴 주 4건 · 3일 간격은 불가능 — 잡는다',
    verifyProfile({ dailyTarget: 1, postsPerWeek: 4, minDaysBetween: 3, slots: [{ hour: 0, minute: 5, count: 1 }] })
      .some((x) => x.includes('도달할 수 없다')))
  check('effectiveWeeklyCap 은 둘 중 작은 값', effectiveWeeklyCap(5, 3) === 3 && effectiveWeeklyCap(2, 1) === 2)

  for (const key of RELEASE_STAGES) {
    const p = PROFILES[key]
    check(`${key} 프로필이 자기모순이 아니다`, verifyProfile(p).length === 0)
    const d = derive(p)
    check(`${key} 재고 = 목표 × ${HORIZON_DAYS}`, d.stockTarget === p.dailyTarget * HORIZON_DAYS)
    check(`${key} 슬롯 합 = 목표`, p.slots.reduce((n, s) => n + s.count, 0) === p.dailyTarget)
    // 🔴 산술 인원은 **주 cap 과 간격 중 실제로 가능한 최대**로 나눈다
    check(`${key} 산술 인원 = ceil(목표×7 / 실효 주cap)`,
      d.personasNeededArithmetic === Math.ceil(p.dailyTarget * 7 / effectiveWeeklyCap(p.postsPerWeek, p.minDaysBetween)))
  }
  check('🔴 범위 밖 목표를 거부', verifyProfile({ ...PROFILES.d1, dailyTarget: 0 }).length > 0
    && verifyProfile({ ...PROFILES.d1, dailyTarget: MAX_DAILY_TARGET + 1 }).length > 0)
  check('🔴 슬롯 시각 중복을 거부', verifyProfile({
    dailyTarget: 2, postsPerWeek: 2, minDaysBetween: 1,
    slots: [{ hour: 0, minute: 5, count: 1 }, { hour: 0, minute: 5, count: 1 }],
  }).some((x) => x.includes('두 번')))
  check('🔴 분 범위 밖을 거부', verifyProfile({
    dailyTarget: 1, postsPerWeek: 1, minDaysBetween: 1, slots: [{ hour: 0, minute: 60, count: 1 }],
  }).length > 0)
  check('d10 슬롯이 고르다 (최대-최소 ≤ 1)', (() => {
    const c = PROFILES.d10.slots.map((s) => s.count)
    return Math.max(...c) - Math.min(...c) <= 1
  })())
  check('요약 문장이 목표를 말한다', describeProfile(PROFILES.d10).includes('10/day'))
  check('🔴 1~100/day 를 표현할 수 있다', MAX_DAILY_TARGET === 100
    && verifyProfile({
      dailyTarget: 100, postsPerWeek: 7, minDaysBetween: 1,
      slots: Array.from({ length: 100 }, (_, i) => ({ hour: Math.floor(i * 14 / 100), minute: i % 60, count: 1 })),
    }).filter((x) => x.includes('표현')).length === 0)
}

// ── ③ 🔴 capacity 와 public release 를 나눈다 ──
console.log('\n③ capacity vs release 분리 · 감속 강제')
{
  const none = resolveScale({})
  check('🔴 설정이 없으면 d1 (fail-closed)', none.releaseStage === 'd1' && none.capacityStage === 'd1')
  check('설정 없음을 사유로 남긴다', none.notes.length >= 2)

  // 🔴 **P0-2 — 두 프로필이 실제로 다르다**
  const split = resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd1' })
  check('🔴 capacity=d10 · release=d1 → 내부 재고 목표는 140', derive(split.capacityProfile).stockTarget === 140)
  check('🔴 같은 설정에서 공개 하루 상한은 1', split.releaseProfile.dailyTarget === 1)
  check('🔴 공개 주 cap 1 · 간격 5일 (d1 기준)',
    effectiveWeeklyCap(split.releaseProfile.postsPerWeek, split.releaseProfile.minDaysBetween) === 1
    && split.releaseProfile.minDaysBetween === 5)
  check('🔴 공개 슬롯도 d1 기준 1개', split.releaseProfile.slots.length === 1)
  check('🔴 내부 재고 최소·경고도 capacity 기준',
    derive(split.capacityProfile).stockMin === 50 && derive(split.capacityProfile).stockWarn === 30)
  check('🔴 두 프로필이 같은 객체가 아니다', split.capacityProfile !== split.releaseProfile)

  const ok2 = resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd3' })
  check('🟢 capacity 안쪽이면 그대로', ok2.releaseStage === 'd3' && !ok2.throttledByCapacity)
  const over = resolveScale({ [CAPACITY_ENV]: 'd3', [RELEASE_ENV]: 'd10' })
  check('🔴 capacity 를 넘으면 감속', over.releaseStage === 'd3' && over.throttledByCapacity)
  check('감속 사유가 남는다', over.notes.some((x) => x.includes('d10') && x.includes('d3')))
  const bad = resolveScale({ [CAPACITY_ENV]: 'nope', [RELEASE_ENV]: 'd10' })
  check('🔴 못 읽는 값은 가장 안전한 단계로 (fail-closed)', bad.capacityStage === SAFEST_STAGE && bad.releaseStage === SAFEST_STAGE)
  check('🔴 빈 문자열도 fail-closed', resolveStage('   ').stage === SAFEST_STAGE)
  check('단계 순서가 d1 < d3 < d5 < d10', stageRank('d1') < stageRank('d3')
    && stageRank('d3') < stageRank('d5') && stageRank('d5') < stageRank('d10'))

  // 🔴 **P0-1 — 준비도 감속이 실제 프로필을 낮춘다**
  const notReady = RELEASE_STAGES.map((st) => ({ stage: st, ready: st === 'd1', reasons: st === 'd1' ? [] : ['미달'] }))
  const forced = resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10' }, { readiness: notReady })
  check('🔴 준비되지 않으면 releaseStage 가 실제로 내려간다', forced.releaseStage === 'd1')
  check('🔴 그때 releaseProfile 도 d1 이다 — 표시만 바뀌는 것이 아니다', forced.releaseProfile.dailyTarget === 1)
  check('🔴 감속 사실이 플래그로 남는다', forced.throttledByReadiness && forced.readinessApplied)
  check('🔴 그래도 capacity 는 d10 이다 — 내부 준비를 줄이지 않는다',
    forced.capacityStage === 'd10' && derive(forced.capacityProfile).stockTarget === 140)
  const readyAll = RELEASE_STAGES.map((st) => ({ stage: st, ready: true, reasons: [] as string[] }))
  check('🟢 전부 준비되면 그대로', resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10' }, { readiness: readyAll }).releaseStage === 'd10')
  check('🔴 판정을 안 넘기면 "적용 안 됨" 을 숨기지 않는다',
    !ok2.readinessApplied && ok2.notes.some((x) => x.includes('준비도 판정을 받지 않았다')))

  // 🔴 코드를 고치지 않고 1→3→5→10 을 오간다
  for (const st of RELEASE_STAGES) {
    const r = resolveScale({ [CAPACITY_ENV]: st, [RELEASE_ENV]: st })
    check(`🔴 env 만으로 ${st} 가 된다 — 코드·fixture 수정 0`, r.releaseProfile.dailyTarget === PROFILES[st].dailyTarget)
  }
  check('요약 문장이 두 단계를 모두 말한다', describeScale(split).includes('capacity=d10') && describeScale(split).includes('release=d1'))
}

// ── ③-A~G 🔴 **필수 행동** — Codex 가 실행해 확인한 결함들 ──
console.log('\n③-A~G 필수 행동 (설치·주입·강제)')
{
  resetScale()
  // ── A. requested d10 + readiness d1 → 실제 publisher config 도 dailyCap=1 ──
  const readinessD1 = RELEASE_STAGES.map((st) => ({ stage: st, ready: st === 'd1', reasons: st === 'd1' ? [] : ['미달'] }))
  const a = installFromEnv({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10' }, { readiness: readinessD1 })
  check('A 🔴 요청 d10 · 준비 d1 → 설치된 공개 상한이 1', a.releaseProfile.dailyTarget === 1)
  check('A 🔴 activeScale 도 같은 값이다', activeScale().releaseProfile.dailyTarget === 1)
  const cand = (): PublishCandidate => ({
    status: 'APPROVED', createdPostId: null, gateVerdict: 'PASS',
    matchedPersonaCode: 'P05', personaStatus: 'active', personaProviderId: null, personaAccountCount: 0,
  })
  const cap1 = judgePublish(cand(), {
    killSwitchEnabled: false, publishedToday: 1, dailyCap: activeScale().releaseProfile.dailyTarget,
  })
  check('A 🔴 그 상한이 **실제 발행 판정을 막는다** (1건 나간 뒤 두 번째 차단)',
    !cap1.ok && cap1.code === 'DAILY_CAP')
  check('A 🔴 감속이 없었다면 통과했을 상황이다 (대조)',
    judgePublish(cand(), { killSwitchEnabled: false, publishedToday: 1, dailyCap: 10 }).ok)

  // ── B. capacity d10 + release d1 → stockTarget=140, public dailyCap=1 ──
  const b = installFromEnv({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd1' })
  const bCap = derive(b.capacityProfile)
  check('B 🔴 내부 재고 목표 140', bCap.stockTarget === 140)
  check('B 🔴 공개 하루 상한 1', b.releaseProfile.dailyTarget === 1)
  // 🔴 그 값이 **실제 재고 판정에 쓰인다**
  // 🔴 러너가 실제로 재고로 인정하는 모양이어야 한다 (`queueProfileOf` = human)
  const rows = Array.from({ length: 20 }, () => ({
    status: 'APPROVED', createdPostId: null,
    promptVersion: 'publish-candidate-v1', model: 'human-curated',
    sourceSite: 'publish-candidate:x', gateResults: null,
  })) as never[]
  const stockCap = readStock(rows, { warn: bCap.stockWarn, min: bCap.stockMin, target: bCap.stockTarget })
  const stockSafe = readStock(rows, SAFEST_STOCK_LIMITS)
  check('B 🔴 재고 20건이 실제로 세어진다 (모양이 맞다)', stockCap.usable === 20 && stockSafe.usable === 20)
  check('B 🔴 capacity 기준 부족분 120건', stockCap.shortfall === 140 - 20 && stockCap.shortfall === 120)
  check('B 🔴 안전 기본값이면 0건 — 두 값이 실제로 다르다', stockSafe.shortfall === 0)
  check('B 🔴 capacity 기준에서는 재고 20건이 critical 이다', stockCap.level === 'critical' && stockSafe.level === 'ok')
  check('B 🔴 보충 게이트도 capacity 목표를 쓴다',
    judgeFill({ targets: [{}] as never[], apply: true, limit: 1, usable: 20, target: bCap.stockTarget }).ok
    && !judgeFill({ targets: [{}] as never[], apply: true, limit: 1, usable: 20 }).ok)

  // ── C. 시작 후에 읽은 env 도 실제 config 에 반영 ──
  //    🔴 이 fixture 자신이 증거다 — 아래 상수들은 **이 파일이 import 될 때** 굳었고,
  //       env 는 그 뒤에 들어왔다. 그런데도 설치된 값은 바뀐다.
  check('C 🔴 모듈 상수는 안전 기본값 그대로다 (import 시점에 굳었다)',
    DAILY_PUBLISH_CAP === 1 && POST_CAP_PER_WEEK === 1 && STOCK_TARGET === 14)
  const late = { ...process.env, [CAPACITY_ENV]: 'd5', [RELEASE_ENV]: 'd5' }
  const c = installFromEnv(late)
  check('C 🔴 시작 뒤에 읽은 설정이 반영된다', c.releaseProfile.dailyTarget === 5 && activeScale().releaseStage === 'd5')
  check('C 🔴 그래도 모듈 상수는 안전값이다 — 주입을 잊으면 1건이다', DAILY_PUBLISH_CAP === 1)
  resetScale()
  check('C 🔴 설치 전 기본은 가장 안전한 값', activeScale().releaseProfile.dailyTarget === 1
    && activeScale().source === 'default-safest' && activeScale() === SAFEST_SCALE)
  // 🔴 운영 스크립트가 **loadEnvLocal 뒤에** 설치하는가 — 순서를 소스로 본다
  for (const f of ['scripts/original-post-auto-publish.mts',
    'scripts/supply-process.mts', 'scripts/micro-seed-supply-autofill.mts'] as const) {
    // 🔴 주석 제거본으로 본다 — 주석 속 예시가 순서 검사를 통과시키면 안 된다
    const src = codeOf(f)
    const envAt = src.indexOf('await loadEnvLocal()')
    /**
     * 🔴 발행 러너는 `installFromEnv`(계산+설치) 대신 `resolvePublishScale`(계산) 뒤
     *    `applyScale`(설치) 로 나뉘었다(2026-09-24) — 관제가 전역을 바꾸지 않게 하려고 뺐다.
     *    🔴 **지키는 것은 같다: env 를 읽은 뒤에 설치한다.**
     */
    const instAt = Math.max(src.indexOf('installFromEnv('), src.indexOf('applyScale('))
    check(`C 🔴 ${f.split('/').pop()} 은 loadEnvLocal 뒤에 설치한다`, envAt >= 0 && instAt > envAt)
  }
  // 🔴 수동 발행기는 **설치하지 않는 것이 정상**이다 (H 에서 이유를 검사한다)
  check('C 🔴 수동 발행기는 규모를 설치하지 않는다', !codeOf('scripts/original-post-publish-live.mts').includes('installFromEnv('))
  check('C 🔴 scale-runtime 은 import 시점에 env 를 읽지 않는다', (() => {
    const src = read('src/lib/scale-runtime.ts').replace(/\/\*[\s\S]*?\*\//g, '')
    // process.env 는 어디에도 없다 — env 는 **인자로만** 들어온다
    return !src.includes('process.env')
  })())

  // ── D. GHA vars 누락/invalid → d1, 정상 d5 → workflow·runner 모두 d5 ──
  const wf = read('.github/workflows/auto-publish.yml')
  check('D 🔴 워크플로우가 두 vars 를 러너에 전달한다',
    /SORAN_CAPACITY_STAGE:\s*\$\{\{\s*vars\.SORAN_CAPACITY_STAGE\s*\}\}/.test(wf)
    && /SORAN_RELEASE_STAGE:\s*\$\{\{\s*vars\.SORAN_RELEASE_STAGE\s*\}\}/.test(wf))
  check('D 🔴 워크플로우에 설정 확인 스텝이 있다', /name:\s*규모 설정 확인/.test(wf))
  check('D 🔴 누락이면 d1', resolveScale({}).releaseStage === 'd1'
    && resolveScale({ [CAPACITY_ENV]: '', [RELEASE_ENV]: '' }).releaseStage === 'd1')
  // 🔴 앞뒤 공백은 **의도적으로 다듬는다** — GH vars 에 흔한 실수이고, 다듬는 쪽이 안전하다
  check('D 🟢 "d10 " 은 공백만 다듬어 d10 으로 읽는다', resolveStage('d10 ').stage === 'd10')
  for (const bogus of ['d2', 'D5', 'd 10', 'daily', '5', 'true', 'd10;d1']) {
    const r = resolveScale({ [CAPACITY_ENV]: bogus, [RELEASE_ENV]: bogus })
    check(`D 🔴 허용 밖 "${bogus}" → d1`, r.releaseStage === 'd1' && r.capacityStage === 'd1')
  }
  const d5 = resolveScale({ [CAPACITY_ENV]: 'd5', [RELEASE_ENV]: 'd5' })
  check('D 🟢 정상 d5 → 러너가 d5 를 쓴다', d5.releaseProfile.dailyTarget === 5
    && effectiveWeeklyCap(d5.releaseProfile.postsPerWeek, d5.releaseProfile.minDaysBetween) === 4)
  check('D 🟢 그때 워크플로우가 내야 할 cron 은 5줄이다', cronLines(d5.releaseProfile).length === 5)
  // 🔴 이제 yml 은 **모든 단계의 합집합**을 예약한다 — d5 슬롯이 전부 들어 있어야 한다
  check('D 🟢 yml 에 d5 슬롯이 하나도 빠지지 않았다',
    compareWorkflow(d5.releaseProfile, wf).filter((m) => m.kind === 'missing').length === 0)
  check('D 🟢 d5 는 실제로 하루 5번 불린다', scheduledRunsPerDay('d5', wf) === 5)

  // ── E. 위험한 persona 도 pause 는 되고 activate 는 안 된다 ──
  const m3 = COHORTS['wave3-scale']
  const unsafe = m3.codes.map((code) => ({
    code, exists: true, status: 'active', hasNickname: true, seeded: false,
    // 🔴 실회원 계정이 붙었고 seed 도 비었다 — 가장 위험한 상태다
    accountCount: 3, providerId: 'kakao_x',
  }))
  check('E 🔴 실계정이 붙은 active 도 **pause 는 된다** (비상 조치를 막지 않는다)', judgePause(unsafe).ok)
  check('E 🔴 같은 사람을 activate 하는 것은 막힌다',
    !judgeActivate(unsafe.map((x) => ({ ...x, status: 'draft' })), m3).ok)
  check('E 🔴 seed 도 막힌다', !judgeSeed(unsafe, m3).ok)
  check('E 🔴 생성도 막힌다 (이미 있다)', !judgeCreate(unsafe, m3).ok)
  check('E 🔴 없는 사람은 pause 할 수 없다', !judgePause(unsafe.map((x) => ({ ...x, exists: false, status: null }))).ok)
  check('E 🔴 active 가 아니면 pause 할 수 없다', !judgePause(unsafe.map((x) => ({ ...x, status: 'draft' }))).ok)
  // 🔴 도구의 pause 경로가 실회원·seed 검사를 부르지 않는가 — 소스로 본다
  const toolSrc = read('scripts/persona-cohort-run.mts')
  const txAt = toolSrc.indexOf('await prisma.$transaction')
  const pauseBranch = toolSrc.slice(toolSrc.indexOf("if (STEP === 'pause') {", txAt), toolSrc.indexOf('} else {', txAt))
  check('E 🔴 pause 분기가 preflightAll 을 부르지 않는다', !pauseBranch.includes('preflightAll'))
  check('E 🔴 pause 분기가 실회원 판정을 부르지 않는다', !pauseBranch.includes('judgeRealMember'))
  check('E 🔴 그래도 대상 존재·active 는 본다',
    pauseBranch.includes('대상이 없다') && pauseBranch.includes('active 가 아니다'))
  check('E 🔴 activate 경로는 여전히 실회원을 막는다', /judgeRealMember/.test(toolSrc) && /실회원 계정에 연결된/.test(toolSrc))

  // ── F. 트랜잭션 진입 후 생긴 충돌 → create 전원 rollback ──
  const txBlock = toolSrc.slice(txAt, toolSrc.indexOf("isolationLevel: 'Serializable'"))
  check('F 🔴 Gate ⑥-B 대조를 **트랜잭션 안에서** 다시 한다',
    txBlock.includes('loadNameCollisionSets(tx)') && txBlock.includes('checkNameCollision'))
  check('F 🔴 그 재판정에 authorHash salt 를 넘긴다', /checkNameCollision\([^)]*\{ hashOf \}\)/.test(txBlock))
  check('F 🔴 걸리면 **throw** 한다 — 로그만 남기지 않는다 (전원 롤백)',
    /throw new Error\('트랜잭션 안 Gate ⑥-B 재판정 실패/.test(txBlock))
  check('F 🔴 재판정은 사전 검사와 **같은 판정 함수**를 쓴다 — 두 규칙이 갈리지 않는다',
    (txBlock.match(/checkNameCollision\(/g) ?? []).length === 1
    // 도구 전체에서는 세 번 쓴다 — 자동 선정 · 사전 검사 · 트랜잭션 재판정.
    // 🔴 셋 다 **같은 함수**다. 규칙이 갈리지 않는다
    && (toolSrc.match(/checkNameCollision\(/g) ?? []).length === 3)
  check('F 🔴 트랜잭션 밖 검사는 "안내" 로 격하됐다',
    toolSrc.includes('사전 검사는 안내다') && toolSrc.includes('사전 검사 전원 pass'))
  check('F 🔴 대조 함수가 트랜잭션 클라이언트를 받는다',
    /type Reader = PrismaClient \| Prisma\.TransactionClient/.test(read('scripts/lib/persona-name-collision-sets.mts')))

  // ── G. health · planner · publisher · supply 가 같은 resolved config 를 쓴다 ──
  const users = {
    'supply-health': read('scripts/supply-health.mts'),
    planner: read('scripts/persona-capacity-planner.mts'),
    'auto-publish': read('scripts/original-post-auto-publish.mts'),
    'supply-process': read('scripts/supply-process.mts'),
    'supply-autofill': read('scripts/micro-seed-supply-autofill.mts'),
  }
  for (const [name, src] of Object.entries(users)) {
    /**
     * 🔴 발행 러너만 계산(`resolvePublishScale`)과 설치(`applyScale`)를 나눴다 —
     *    관제·검사가 그 계산을 불러도 전역이 바뀌지 않게 하려는 것이다.
     *    나머지는 여전히 편의 함수 하나를 쓴다. **설치한다는 사실은 같다.**
     */
    check(`G 🔴 ${name} 이 규모를 설치한다`,
      src.includes('installFromEnv(') || /applyScale\(resolved\.scale\)/.test(src))
    check(`G 🔴 ${name} 이 스스로 단계를 정하지 않는다`, !/resolveStage\(/.test(src) && !/safeStageFor\(/.test(src))
  }
  check('G 🔴 발행 러너는 설치된 release 프로필로 상한을 만든다',
    /const RELEASE_DAILY_CAP = resolved\.dailyCap/.test(users['auto-publish'])
    && /applyScale\(resolved\.scale\)/.test(users['auto-publish']))
  /** 🔴 **계산만 하는 함수가 전역을 바꾸지 않는다** — 관제가 돌아도 운영 값이 안 흔들린다 */
  check('G 🔴 🔴 **공용 조립은 resolveScale 만 쓴다 (installFromEnv 아님)**', (() => {
    const stock = codeOf('scripts/lib/publishable-stock.mts')
    return !/installFromEnv\(/.test(stock) && /resolveScale\(/.test(stock)
  })())
  /**
   * 🔴 **예약 러너는 숫자 상한이 아니라 단계를 넘긴다** (2026-09-26 마스터 P0 · 예약 지연).
   *    트랜잭션이 그 단계를 env 천장으로 누르고, 하루 목표·도래 슬롯을 트랜잭션 시계로 다시 센다.
   *    설치된 단계가 write 경로에 도달해야 한다는 원래 목적은 그대로다 — 값이 숫자에서 단계로 바뀌었다.
   */
  // 🔴 (2026-09-29) 무인 표식 — launchd·GitHub 예약 회차만 unattended 다(단계 증거가 이 표식으로 물량을 센다)
  check('G 🔴 발행 러너가 설치된 단계를 write 경로에 넘긴다 (scheduled · 무인 표식은 트리거로만)',
    /publishOriginalPostTx\(prisma, \{\s*queueId: target\.id, publishedToday,\s*(?:\/\/[^\n]*\n\s*)*mode: \{ kind: 'scheduled', releaseStage: scale\.releaseStage, planned, unattended: TRIGGER === 'local' \|\| TRIGGER === 'schedule' \},/
      .test(users['auto-publish']))
  // 🔴 러너는 이제 공용 준비 함수(`prepareCandidates`)를 통해 매칭한다.
  //    **주입 자체가 사라지면 안 된다** — 그 함수가 caps 를 planBatch 로 넘기는지도 함께 본다
  check('G 🔴 발행 러너가 매칭 경로에 release cap 을 넘긴다',
    /caps: RELEASE_CAPS/.test(users['auto-publish']))
  check('G 🔴 공용 준비 함수가 그 cap 을 planBatch 로 넘긴다', (() => {
    const lib = read('src/lib/supply-candidates.ts')
    return /planBatch\(keep\.map\(draftOf\), input\.personas, caps\)/.test(lib)
      && /planBatch\(autoDrafts, input\.personas, caps, \{/.test(lib)
  })())
  check('G 🔴 공급 러너는 capacity 프로필로 재고 기준을 만든다',
    /scale\.capacityProfile/.test(users['supply-process']) && /scale\.capacityProfile/.test(users['supply-autofill']))
  check('G 🔴 health 가 capacity 와 release 를 따로 보여 준다',
    /capacity: \{/.test(users['supply-health']) && /release: \{/.test(users['supply-health']))
  check('G 🔴 write 경로가 모듈 상수를 상한으로 쓰지 않는다',
    !/dailyCap: DAILY_PUBLISH_CAP/.test(users['auto-publish'])
    && !/dailyCap: DAILY_PUBLISH_CAP/.test(read('scripts/original-post-publish-live.mts')))
  check('G 🔴 트랜잭션 write — 예약은 정본 단계 목표 · 수동 단건은 주입값',
    /dailyCap = target/.test(read('src/lib/original-post-publish-tx.ts'))
    && /dailyCap = input\.mode\.dailyCap/.test(read('src/lib/original-post-publish-tx.ts')))
  resetScale()
}

// ── ③-H 🔴 **행동으로 검증한다** — 필드 존재가 아니라 실제 판정 결과다 ──
console.log('\n③-H 수동 발행기 상한 · health 판정 (행동)')
{
  resetScale()
  // ── 수동 발행기는 규모 확장 경로가 아니다 ──
  check('H 🔴 수동 상한은 항상 1건 — 가장 안전한 값이다', MANUAL_PUBLISH_CAP === 1)
  check('H 🟢 --limit=1 은 통과', judgeManualLimit(1).ok)
  for (const n of [2, 3, 10, 100]) {
    check(`H 🔴 --limit=${n} 은 write 전에 거부`, !judgeManualLimit(n).ok)
  }
  check('H 🔴 거부 사유가 "긴급 단건 전용" 을 말한다', judgeManualLimit(10).reason.includes('긴급 단건'))
  check('H 🔴 자동 레인으로 안내한다', judgeManualLimit(10).reason.includes('original-post-auto-publish'))
  check('H 🔴 --limit 없음·0·소수도 거부',
    !judgeManualLimit(null).ok && !judgeManualLimit(0).ok && !judgeManualLimit(1.5).ok)
  // 🔴 **환경이 d10 이어도 수동 상한은 안 바뀐다** — env 는 인자로만 들어오므로 값이 고정이다
  const envD10 = resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10' })
  check('H 🔴 env 가 d10 이어도 수동 상한은 1', envD10.releaseProfile.dailyTarget === 10 && MANUAL_PUBLISH_CAP === 1)
  check('H 🔴 수동 도구는 설치하지 않는다 (readiness 우회 금지)', (() => {
    const src = codeOf('scripts/original-post-publish-live.mts')
    return !src.includes('installFromEnv(') && src.includes('SAFEST_SCALE')
  })())
  check('H 🔴 수동 도구가 상한을 스스로 만들지 않는다 — MANUAL_PUBLISH_CAP 정본을 쓴다',
    /RELEASE_DAILY_CAP = MANUAL_PUBLISH_CAP/.test(codeOf('scripts/original-post-publish-live.mts')))
  check('H 🔴 수동 도구가 판정도 정본(judgeManualLimit)을 쓴다',
    /judgeManualLimit\(LIMIT\)/.test(codeOf('scripts/original-post-publish-live.mts')))
  // 🔴 자동 레인은 준비되면 d10 을 받는다 — 확장 경로가 막힌 것이 아니다
  const allReady = RELEASE_STAGES.map((st) => ({ stage: st, ready: true, reasons: [] as string[] }))
  check('H 🟢 자동 레인은 준비도 충족 시 d10 을 받는다',
    resolveScale({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10' }, { readiness: allReady })
      .releaseProfile.dailyTarget === 10)
  // 🔴 트랜잭션 재판정은 그대로다
  check('H 🔴 트랜잭션 재판정 — 수동 단건(manual-live)은 주입 상한 · 예약은 단계 목표로 다시 판정한다',
    /dailyCap = input\.mode\.dailyCap/.test(read('src/lib/original-post-publish-tx.ts'))
    && /const target = profileOf\(stage\)\.dailyTarget/.test(read('src/lib/original-post-publish-tx.ts')))

  // ── health 판정을 **실제 함수로** 구성해 본다 ──
  //    🔴 필드 존재가 아니라 level·target·dailyCap 이 맞는지 본다
  const healthOf = (env: Record<string, string>, usable: number, readiness?: readonly {
    stage: typeof RELEASE_STAGES[number]; ready: boolean; reasons: string[]
  }[]): { level: string; target: number; dailyCap: number; stockTarget: number; notes: readonly string[] } => {
    const r = resolveScale(env, readiness === undefined ? {} : { readiness })
    const capD = derive(r.capacityProfile)
    const dailyCap = r.releaseProfile.dailyTarget
    const supply = judgeSupply({
      usable, human: usable, machine: 0, legacyExcluded: 0, pendingThin: 0, historicRawNoop: 0,
      runningCheckpoints: 0, failedCheckpoints: 0, lock: 'free',
      lastSupplyOkAt: new Date('2026-09-08T00:00:00Z'), now: new Date('2026-09-08T01:00:00Z'),
      staleAfterMs: 86_400_000,
      stockMin: capD.stockMin, stockTarget: capD.stockTarget,
    })
    const publish = judgePublishHealth({
      todayCount: 1, dailyCap, afterPublishGrace: false, mismatched: 0,
      legacyPublishedToday: 0, historicUnknownProfile: 0, candidates: usable,
      now: new Date('2026-09-08T01:00:00Z'),
    })
    const rep = buildReport({ sources: [], supply, publish })
    return { level: rep.level, target: capD.stockTarget, dailyCap, stockTarget: capD.stockTarget, notes: r.notes }
  }
  const notReadyD1 = RELEASE_STAGES.map((st) => ({ stage: st, ready: st === 'd1', reasons: st === 'd1' ? [] : ['미달'] }))

  // A. d10/d10 + 재고 14 → WARNING · target 140 · dailyCap 1 · 감속 사유 존재
  const A = healthOf({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd10' }, 14, notReadyD1)
  check('A 🔴 level=WARNING', A.level === 'WARNING')
  check('A 🔴 numbers.target=140', A.target === 140)
  check('A 🔴 numbers.dailyCap=1', A.dailyCap === 1)
  check('A 🔴 scale.capacity.stockTarget=140', A.stockTarget === 140)
  check('A 🔴 감속 사유가 있다', A.notes.some((n) => n.includes('감속') || n.includes('안전한')))

  // B. d10/d1 + 재고 14 → 내부 재고 부족 WARNING · 공개 dailyCap 1
  const B2 = healthOf({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd1' }, 14)
  check('B 🔴 내부 재고 부족으로 WARNING', B2.level === 'WARNING' && B2.target === 140)
  check('B 🔴 공개 dailyCap=1', B2.dailyCap === 1)

  // C. env 없음 → 기존 d1 HEALTHY 회귀
  const C2 = healthOf({}, 14)
  check('C 🔴 env 없으면 HEALTHY 회귀', C2.level === 'HEALTHY')
  check('C 🔴 target 14 · dailyCap 1', C2.target === 14 && C2.dailyCap === 1)
  // 🔴 capacity 를 올렸을 뿐인데 초록이 유지되면 그것이 P1 결함이었다
  check('🔴 같은 재고 14건이 capacity 에 따라 판정이 갈린다', C2.level === 'HEALTHY' && B2.level === 'WARNING')
  // 🔴 재고가 capacity 목표를 채우면 다시 HEALTHY
  check('🟢 재고 140이면 d10 capacity 에서도 HEALTHY',
    healthOf({ [CAPACITY_ENV]: 'd10', [RELEASE_ENV]: 'd1' }, 140).level === 'HEALTHY')
  // 🔴 상한 초과 발행은 release 기준으로 잡힌다
  check('🔴 release=d1 에서 오늘 2건이면 CRITICAL', (() => {
    const p = judgePublishHealth({
      todayCount: 2, dailyCap: 1, afterPublishGrace: false, mismatched: 0,
      legacyPublishedToday: 0, historicUnknownProfile: 0, candidates: 5, now: new Date('2026-09-08T01:00:00Z'),
    })
    return p.some((x) => x.code === 'PUBLISH_OVER_CAP' && x.level === 'CRITICAL')
  })())
  check('🟢 release=d10 이면 같은 2건이 정상', (() => {
    const p = judgePublishHealth({
      todayCount: 2, dailyCap: 10, afterPublishGrace: false, mismatched: 0,
      legacyPublishedToday: 0, historicUnknownProfile: 0, candidates: 5, now: new Date('2026-09-08T01:00:00Z'),
    })
    return !p.some((x) => x.code === 'PUBLISH_OVER_CAP')
  })())
  /**
   * 🔴 **여력·필요인원 계산도 주입 cap 을 따른다** — 행동으로 본다.
   *    안 따르면 `release=d5` 인데 "주 1건" 으로 계산해 필요 인원이 5배로 부풀고,
   *    관제가 "35명 부족" 같은 숫자를 내놓는다.
   */
  const hist = { code: 'X', matchedAts: [
    new Date('2026-09-06T00:00:00Z'), new Date('2026-09-07T00:00:00Z'),
  ] }
  const at = new Date('2026-09-08T00:00:00Z')
  check('🔴 주 2건 쓴 사람은 안전 기본값(주 1건)에서는 못 쓴다', !personaAvailableAt(hist, at))
  check('🔴 주입 cap(주 5건 · 간격 1일)이면 쓸 수 있다',
    personaAvailableAt(hist, at, { postsPerWeek: 5, minDaysBetween: 1 }))
  check('🔴 간격만 늘리면 다시 막힌다',
    !personaAvailableAt(hist, at, { postsPerWeek: 5, minDaysBetween: 5 }))
  check('🔴 availablePersonasAt 도 같은 cap 을 쓴다',
    availablePersonasAt([hist], at).length === 0
    && availablePersonasAt([hist], at, { postsPerWeek: 5, minDaysBetween: 1 }).length === 1)
  check('🔴 capacityOf 가 주입 주 cap 을 쓴다',
    capacityOf({ activePersonas: 10, lifeBlockRate: 0 }).theoreticalPerWeek === 10
    && capacityOf({ activePersonas: 10, lifeBlockRate: 0, weeklyCap: 5 }).theoreticalPerWeek === 50)
  check('🔴 personasNeededFor 가 주입 주 cap 을 쓴다',
    personasNeededFor({ targetPerDay: 10, lifeBlockRate: 0, activePersonas: 0 }).min === 70
    && personasNeededFor({ targetPerDay: 10, lifeBlockRate: 0, activePersonas: 0, weeklyCap: 5 }).min === 14)
  check('🔴 부족 인원도 그만큼 달라진다',
    personasNeededFor({ targetPerDay: 10, lifeBlockRate: 0, activePersonas: 8, weeklyCap: 5 }).shortfallMin === 6)

  // 🔴 health 가 규모 확정 **뒤에** 판정하는가 — 순서를 소스로 확인한다(행동 검사의 보조)
  const h = read('scripts/supply-health.mts')
  check('🔴 health 는 규모 확정 뒤에 재고를 판정한다',
    h.indexOf('const resolved = installFromEnv') < h.indexOf('const stock = readStock(mapped, CAPACITY_LIMITS)'))
  check('🔴 health 는 규모 확정 뒤에 발행을 판정한다',
    h.indexOf('const resolved = installFromEnv') < h.indexOf('const publish = judgePublish({'))
  check('🔴 health 가 모듈 안전 상수를 운영 숫자로 쓰지 않는다',
    !/dailyCap: DAILY_PUBLISH_CAP/.test(h) && !/target: STOCK_TARGET/.test(h))
  // 🔴 여력·필요인원·예측에 release cap 을 실제로 넘기는가
  check('🔴 health 가 forecast 에 release cap 을 넘긴다', /caps: RELEASE_CAPS/.test(codeOf('scripts/supply-health.mts')))
  // 🔴 **호출부마다** 확인한다 — 총 개수를 세면 JSON 필드 같은 무관한 등장까지 세어져
  //    한 호출부가 빠져도 통과한다
  const hc = codeOf('scripts/supply-health.mts')
  check('🔴 health 가 capacityOf 에 주 cap 을 넘긴다',
    /capacityOf\(\{[\s\S]{0,200}?weeklyCap: RELEASE_CAPS\.postsPerWeek/.test(hc))
  check('🔴 health 가 personasNeededFor 에 주 cap 을 넘긴다',
    /personasNeededFor\(\{[\s\S]{0,200}?weeklyCap: RELEASE_CAPS\.postsPerWeek/.test(hc))
  resetScale()
}

// ── ④ 슬롯 · 워크플로우 렌더 (🔴 실제 yml 대조) ──
console.log('\n④ 슬롯 → 워크플로우')
{
  check('분 단위 계산', minuteOfDay({ hour: 1, minute: 30 }) === 90)
  check('KST 표기', slotLabel({ hour: 0, minute: 5 }) === '00:05')
  // 🔴 GH Actions cron 은 UTC 다. 00:05 KST = 15:05 UTC (전날)
  check('🔴 00:05 KST → cron 5 15', slotCronUtc({ hour: 0, minute: 5 }) === '5 15 * * *')
  check('🔴 13:20 KST → cron 20 4', slotCronUtc({ hour: 13, minute: 20 }) === '20 4 * * *')
  check('🔴 09:20 KST → cron 20 0', slotCronUtc({ hour: 9, minute: 20 }) === '20 0 * * *')
  check('슬롯 전개 수 = 목표', expandSlots(PROFILES.d10).length === PROFILES.d10.dailyTarget)
  check('렌더는 시각순', renderSlots(PROFILES.d10).map((r) => r.kst).join() === [...renderSlots(PROFILES.d10)].map((r) => r.kst).sort().join())
  check('🔴 슬롯 표현 가능성 검사', verifySlotRenderable({ hour: 24, minute: 0, count: 1 }).length > 0
    && verifySlotRenderable({ hour: 0, minute: 5, count: 1 }).length === 0)

  const yml = read('.github/workflows/auto-publish.yml')
  const have = parseCronLines(yml)
  // 🔴 **yml 은 모든 단계 슬롯의 합집합을 예약한다** (2026-09-12).
  //    옛 판은 cron 이 하나(00:05 KST)뿐이었다. 그래서 단계를 d10 으로 올려도 하루 한 번만
  //    러너가 불렸고, 러너는 호출당 1건이므로 실제로는 1건/day 였다.
  //    cron 은 파일 고정이라 변수로 못 바꾼다 — 합집합을 예약하고 러너가 자기 회차를 고른다.
  // 🔴 **계약은 "빠짐없이 담는다" 다.** 슬롯을 바꾸면 yml 을 함께 갱신하면 된다 —
  //    포함 관계나 개수를 여기서 고정하지 않는다.
  check('🔴 yml 이 allStageCronLines() 를 빠짐없이 담는다 (주석은 세지 않는다)',
    allStageCronLines().every((c) => have.includes(c)))
  check('🔴 계획에 없는 회차를 예약하지 않는다', have.every((c) => allStageCronLines().includes(c)))

  // 🔴 **각 단계가 실제로 하루 몇 건 낼 수 있는가** — yml 을 근거로 센다.
  //    이것이 이 파일에서 가장 중요한 줄이다. 프로필만 고치고 yml 을 두면 여기서 걸린다.
  for (const stage of RELEASE_STAGES) {
    check(`🔴 ${stage} 는 실제로 하루 ${PROFILES[stage].dailyTarget}건 가능하다`,
      actualDailyPublishable(stage, yml) === PROFILES[stage].dailyTarget)
    check(`🔴 ${stage} 는 자기 슬롯 ${PROFILES[stage].slots.length}개에서만 돈다`,
      scheduledRunsPerDay(stage, yml) === PROFILES[stage].slots.length)
    check(`🔴 ${stage} 프로필과 yml 이 어긋나지 않는다`,
      compareWorkflow(PROFILES[stage], yml).filter((m) => m.kind === 'missing').length === 0)
  }

  // 🔴 지금 단계에 없는 회차는 돌지 않는다
  check('🔴 d1 운영 중 13:30 회차는 쉰다',
    !judgeSlotRun({ stage: 'd1', cron: slotCronUtc({ hour: 13, minute: 30 }) }).run)
  check('🟢 d3 운영 중 13:30 회차는 돈다',
    judgeSlotRun({ stage: 'd3', cron: slotCronUtc({ hour: 13, minute: 30 }) }).run)
  check('🔴 d1 은 10번 불려도 자기 슬롯은 1개뿐이다', scheduledRunsPerDay('d1', yml) === 1)

  // 🔴 **지연에 흔들리지 않는다** — 판정 입력은 시계가 아니라 예약 cron 이다
  check('🔴 판정은 wall clock 을 쓰지 않는다 — 같은 예약은 언제 불려도 같은 회차다', (() => {
    const cron = slotCronUtc({ hour: 9, minute: 30 })
    const a = judgeSlotRun({ stage: 'd3', cron })
    const b = judgeSlotRun({ stage: 'd3', cron })
    return a.run && b.run && a.kst === '09:30' && b.kst === '09:30'
  })())
  check('🔴 예약 cron 을 못 받으면 내보내지 않는다', !judgeSlotRun({ stage: 'd10', cron: null }).run)
  check('🔴 슬롯으로 읽을 수 없는 cron 이면 내보내지 않는다',
    !judgeSlotRun({ stage: 'd10', cron: '*/5 * * * *' }).run)
  check('🔴 cron → KST 변환이 slotCronUtc 의 역이다',
    RELEASE_STAGES.every((st) => PROFILES[st].slots.every((s) => {
      const back = slotOfCron(slotCronUtc(s))
      return back !== null && back.hour === s.hour && back.minute === s.minute
    })))

  // ─────────────────────────────────────────────────────────
  // 🔴 **모든 공개 슬롯이 댓글 운영 창 안에 있고, 첫 댓글이 60분 안에 붙는가**
  //
  //    §9.5-g 확정 계약: 댓글 창 08:00~22:00 · 첫 댓글 60분 이내 ·
  //    관리형 글도 같은 창 안에 발행. 창 밖 발행은 계약 위반이다.
  //    옛 판은 네 단계 전부 00:05 를 포함해 첫 댓글까지 8시간 넘게 걸렸다.
  //
  //    🔴 **시각을 여기 복제하지 않는다.** PROFILES 와 planRunnerSchedule 이 각각 정본이고
  //       이 블록은 둘을 대조만 한다.
  // ─────────────────────────────────────────────────────────
  {
    const runner = planCommentLoopSchedule(BOOTSTRAP_DAILY_MAX)
    const commentMins = runner.slots.map(minuteOfDay).sort((a, b) => a - b)
    const WIN_START = RUNNER_WINDOW_START_HOUR * 60
    const WIN_END = RUNNER_WINDOW_END_HOUR * 60

    check('🔴 댓글 runner 슬롯이 실제로 있다 (대조 대상이 비면 시험이 성립하지 않는다)',
      commentMins.length > 0)

    for (const stage of RELEASE_STAGES) {
      const slots = PROFILES[stage].slots.map(minuteOfDay)
      check(`🔴 ${stage} 슬롯이 전부 댓글 창 ${RUNNER_WINDOW_START_HOUR}:00~${RUNNER_WINDOW_END_HOUR}:00 안이다`,
        slots.every((m) => m >= WIN_START && m <= WIN_END))
      check(`🔴 ${stage} 모든 글의 첫 댓글이 ${FIRST_COMMENT_MAX_MINUTES}분 안에 붙는다`,
        slots.every((m) => {
          const next = commentMins.find((c) => c >= m)
          return next !== undefined && next - m <= FIRST_COMMENT_MAX_MINUTES
        }))
      check(`🔴 ${stage} 에 다음 날로 넘어가는 글이 0건이다`,
        slots.every((m) => commentMins.some((c) => c >= m)))
    }

    /**
     * 🔴 **슬롯 사이의 포함 관계는 계약이 아니다** (2026-09-12 정정).
     *
     *    앞선 판은 "d1·d3·d5 는 d10 의 부분집합이어야 한다" · "합집합은 d10 과 같아야 한다" ·
     *    "연쇄는 거짓이어야 한다" 를 **검사로 굳혔다.** 그것은 지금 스케줄의 **관측값**이지
     *    제품 계약이 아니다. 그대로 두면 앞으로 유효한 시간 조정 — 창 안이고 댓글 간격을
     *    지키고 슬롯 수가 맞는 변경 — 이 포함 관계 때문에 막힌다.
     *
     *    🔴 지켜야 할 것은 아래 넷이다: 슬롯 수 = dailyTarget · 창 08~22 ·
     *       다음 댓글 회차까지 60분 · yml 이 `allStageCronLines()` 를 빠짐없이 담는다.
     *       유효한 슬롯 변경은 yml 을 함께 갱신하면 통과해야 한다.
     */
    check(`🟢 [현재값] 합집합 슬롯 ${allStageCronLines().length}개 — 계약이 아니라 지금 값이다`,
      allStageCronLines().length === new Set(
        RELEASE_STAGES.flatMap((st) => PROFILES[st].slots.map(minuteOfDay)),
      ).size)

    /**
     * 🔴 **유효한 슬롯 변경은 통과해야 한다.**
     *
     *    계약(슬롯 수 = dailyTarget · 창 08~22 · 다음 댓글 회차 60분)만 만족하면
     *    포함 관계가 깨져도 막지 않는다. 앞선 판은 "d5 에 09:30 을 넣는 것" 자체를
     *    결함으로 봤는데, 그것은 창 안이고 댓글 간격도 지키는 **유효한 배치**다.
     */
    const satisfiesContract = (slots: readonly { hour: number; minute: number }[], target: number): boolean => {
      if (slots.length !== target) return false
      const mins = slots.map(minuteOfDay)
      if (!mins.every((m) => m >= WIN_START && m <= WIN_END)) return false
      return mins.every((m) => {
        const next = commentMins.find((c) => c >= m)
        return next !== undefined && next - m <= FIRST_COMMENT_MAX_MINUTES
      })
    }
    check('🟢 지금 승인된 슬롯은 계약을 만족한다',
      RELEASE_STAGES.every((st) => satisfiesContract(PROFILES[st].slots, PROFILES[st].dailyTarget)))
    check('🟢 포함 관계를 깨는 유효한 배치도 허용된다 (d5 에 09:30 을 넣은 가상 배치)',
      satisfiesContract([
        { hour: 8, minute: 10 }, { hour: 9, minute: 30 }, { hour: 12, minute: 10 },
        { hour: 16, minute: 10 }, { hour: 19, minute: 0 },
      ], 5))
    check('🔴 창 밖 배치는 여전히 막는다',
      !satisfiesContract([{ hour: 23, minute: 0 }], 1))
    check('🔴 슬롯 수가 dailyTarget 과 다르면 막는다',
      !satisfiesContract([{ hour: 9, minute: 30 }], 3))
  }

  check('cron 목록에 중복이 없다', new Set(cronLines(PROFILES.d10)).size === cronLines(PROFILES.d10).length)
  check('합집합 cron 에 중복이 없다',
    new Set(allStageCronLines()).size === allStageCronLines().length)
  // 🔴 슬롯이 두 번 돌아도 하루 상한을 넘지 않는다 — 상한은 러너가 지킨다
  check('🔴 중복 실행에도 하루 상한이 지켜진다', dailyCeiling(PROFILES.d10, 2) === 10 && dailyCeiling(PROFILES.d1, 5) === 1)
  // 🔴 워크플로우가 예약을 러너에 그대로 넘긴다 — 이것이 없으면 슬롯 판정이 불가능하다
  check('🔴 yml 이 github.event.schedule 을 러너에 넘긴다',
    /SLOT_CRON:\s*\$\{\{\s*github\.event\.schedule\s*\}\}/.test(yml)
    && /--slot-cron=/.test(yml))
  // 🔴 수동 실행은 여전히 dry-run 이다
  // 🔴 발행 명령이 붙은 줄이 **어느 조건 아래**에 있는가 — 줄 단위로 본다
  const runLines = yml.split('\n')
  const condOfPublishLines = runLines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.includes('original-post-auto-publish.mts'))
    .map(({ i }) => {
      // 위로 올라가며 가장 가까운 `if:` 를 찾는다
      for (let k = i; k >= 0; k -= 1) {
        const m = /if:\s*github\.event_name == '(\w+)'/.exec(runLines[k] ?? '')
        if (m?.[1] !== undefined) return { cond: m[1], line: runLines[i] ?? '' }
      }
      return { cond: '(없음)', line: runLines[i] ?? '' }
    })
  check('🔴 러너를 부르는 곳은 두 군데다 — 수동·스케줄', condOfPublishLines.length === 2)
  check('🔴 수동 실행(workflow_dispatch)은 --apply 를 붙이지 않는다',
    condOfPublishLines.filter((x) => x.cond === 'workflow_dispatch')
      .every((x) => !x.line.includes('--apply')))
  check('🔴 실제 발행은 schedule 경로에서만 --apply --limit=1 한다', (() => {
    const sched = condOfPublishLines.filter((x) => x.cond === 'schedule')
    return sched.length === 1 && sched[0]!.line.includes('--apply')
      && sched[0]!.line.includes('--limit=1') && sched[0]!.line.includes('--slot-cron=')
  })())
}

// ── ⑤ 공급 모델 (🔴 근거·실제 plist 대조) ──
console.log('\n⑤ 공급 역산 · 수집원 · 비용')
{
  // 🔴 통과율은 근거에서 계산한다 — 주석과 숫자가 어긋나지 않게
  const list = YIELD_EVIDENCE.find((e) => e.stage === 'listToDetail')!
  check('🔴 목록 통과율 근거는 1,147 → 10', list.observed?.of === 1147 && list.observed.n === 10)
  check('🔴 그 비율은 0.87% 다 (옛 값 5% 는 6배 틀렸다)', Math.abs(YIELD.listToDetail - 10 / 1147) < 1e-12
    && Math.abs(YIELD.listToDetail - 0.0087) < 0.0002)
  check('🔴 비율은 전부 근거에서 계산된다', YIELD_EVIDENCE.every((e) => YIELD[e.stage] === rateOf(e)))
  check('통과율이 0~1 이다', Object.values(YIELD).every((v) => v > 0 && v <= 1))
  check('🔴 근거 없는 단계는 assumed 로 표시된다', ASSUMED_STAGES.length === 2
    && ASSUMED_STAGES.includes('judgePass') && ASSUMED_STAGES.includes('draftPass'))

  const p10 = planSupply(PROFILES.d10)
  check('🔴 단계가 뒤로 갈수록 많아진다', p10.listPerDay > p10.detailPerDay
    && p10.detailPerDay > p10.judgePerDay && p10.judgePerDay > p10.draftPerDay && p10.draftPerDay >= p10.queuePerDay)
  check('d10 재고 목표 140', p10.stockTarget === 140)
  check('🔴 가정이 섞였으므로 proven=false — 이 숫자로 READY 라 하지 않는다', !p10.proven)

  const p100 = planSupply(PROFILES.d10, 100)
  check('🔴 내부 100/day 를 공개 10/day 와 따로 계산한다', p100.queuePerDay === 100 && p100.dailyTarget === 10)
  check('LLM 호출이 judge+draft 합이다', p100.llmCallsPerDay === p100.judgePerDay + p100.draftPerDay)
  check('🔴 밖으로 나가는 상세 요청 수를 따로 낸다', p100.externalDetailRequestsPerDay === p100.detailPerDay)
  // 🔴 0.87% 로 역산하면 목록은 3만 건이 넘는다 — 5% 로 계산했을 때와 자릿수가 다르다
  check('🔴 100/day 목록 요구량이 3만 건대다', p100.listPerDay > 30000 && p100.listPerDay < 50000)

  // 🔴 수집원 — **실제 launchd 템플릿과 대조**한다
  /**
   * 🔴 **현재 능력의 정본은 관측 하나뿐이다** (2026-09-08).
   *    정적 `SOURCES[].loaded` 로 세던 `supplyCapacity()` 를 지웠다 —
   *    아무도 등록하지 않은 job 과 조건부로만 열리던 몫이 "지금 열리는 능력" 으로 세어졌다.
   */
  /**
   * 🔴 **2026-09-11 `launchctl list` 실측.** 네이버 두 카페는 `-multi` 4슬롯이 돌고 있고
   *    1회판 job 은 없다. 옛 판은 여기에 `09:20` · `13:20` 1슬롯을 적어 두어,
   *    fixture 가 **이미 사라진 운영 형태**를 현재 능력으로 못박고 있었다.
   */
  const OBSERVED: readonly ObservedJob[] = [
    {
      label: 'com.soransoran.navercafe-collect-remonterrace-multi',
      slots: [{ hour: 4, minute: 20 }, { hour: 10, minute: 20 }, { hour: 16, minute: 20 }, { hour: 22, minute: 20 }],
      loaded: true,
    },
    {
      label: 'com.soransoran.navercafe-collect-wgang-multi',
      slots: [{ hour: 2, minute: 50 }, { hour: 8, minute: 50 }, { hour: 14, minute: 50 }, { hour: 20, minute: 50 }],
      loaded: true,
    },
    /** 🔴 공급 **처리** job 이다 — 수집하지 않으므로 수집 능력에 한 건도 보태지 않는다 */
    { label: 'com.soransoran.supply-process', slots: [{ hour: 23, minute: 15 }], loaded: true },
  ]
  const cap = currentCapacity(OBSERVED)
  for (const s of SOURCES) {
    const t = read(join('docs/operations/launchd', s.template))
    const slots = (t.match(/<key>Hour<\/key>/g) ?? []).length
    check(`🔴 [${s.id}] 회차 수가 템플릿과 같다`, slots === s.runsPerDay)
    /**
     * 🔴 회차 상한의 출처가 소스마다 다르다 — **있지도 않은 인자를 찾지 않는다.**
     *    82cook 은 템플릿 인자에 박혀 있고, 네이버는 runner 가 역산한다.
     */
    const cafe = /navercafe:(\w+)/.exec(s.id)?.[1]
    // 🔴 **주석이 아니라 실제로 넘기는 인자만 본다.** XML 주석에는 옛 인자가 역사로 남아 있다
    const passedArgs = (t.replace(/<!--[\s\S]*?-->/g, '').match(/<string>([^<]*)<\/string>/g) ?? []).join(' ')
    if (cafe === undefined) {
      // 🔴 82cook 얇은 상세 job 은 `--cap=` 으로 받는다. 인자 이름을 여기서 지어내지 않는다
      const maxArg = /--(?:auto-max|max|cap)=(\d+)/.exec(passedArgs)
      check(`🔴 [${s.id}] 회차 상한이 템플릿 인자와 같다`, Number(maxArg?.[1] ?? -1) === s.maxPerRun)
    } else {
      check(`🔴 [${s.id}] 회차 상한이 runner 역산값과 같다`,
        planCafeRun({ cafeId: cafe, phase: 'start' }).detailPerRun === s.maxPerRun)
      check(`🔴 [${s.id}] 실제 인자에 --max 숫자를 손으로 적지 않는다`, !/--max=/.test(passedArgs))
    }
  }
  /**
   * 🔴 **옛 판은 "82cook 은 미등록" 을 계약으로 박고 있었다** (2026-09-13 교체).
   *
   *    2026-09-11 에 세 job 이 모두 등록됐는데 이 fixture 때문에 메모를 고칠 수 없었다 —
   *    고치면 CI 가 깨지는 구조였다. **관측이 바뀌면 메모도 바뀌어야 한다.**
   *    지켜야 하는 계약은 "정적 메모를 판정 근거로 쓰지 않는다" 다.
   */
  check('🔴 D100 수집원은 실제로 D100 경로에 들어가는 job 을 가리킨다',
    SOURCES.every((s) => s.template.includes('supply-collect') || s.template.includes('navercafe-collect')))
  check('🔴 82cook 항목이 목록 job 이 아니라 얇은 상세 job 이다', (() => {
    const c = SOURCES.find((s) => s.id === '82cook')
    return c !== undefined && c.template.includes('supply-collect-82cook-thin')
      && !c.template.includes('raw-collect')
  })())
  /**
   * 🔴 **1회판은 운영 경로에서 사라졌다** (2026-09-11).
   *    실행 가능한 옛 템플릿을 남겨 두면 누군가 그것을 load 한다.
   *    `JOB_LABELS[].single` 만 남긴다 — 그건 "혹시 올라와 있으면 1회판이라고 부른다" 는
   *    **호환 판정용 이름**이지 실행 경로가 아니다.
   */
  for (const cafe of ['remonterrace', 'wgang'] as const) {
    check(`🔴 [${cafe}] 옛 1회판 템플릿이 저장소에 없다`,
      !existsSync(join('docs/operations/launchd', `com.soransoran.navercafe-collect-${cafe}.plist.template`)))
    check(`🔴 [${cafe}] SOURCES 가 -multi 를 가리킨다`,
      SOURCES.some((s) => s.id === `navercafe:${cafe}` && s.template.includes('-multi')
        && s.runsPerDay === RUNS_PER_DAY[`navercafe:${cafe}`].start && s.loaded))
  }
  check('🔴 SOURCES note 에 옛 09:20/13:20 1회 운영이 남아 있지 않다',
    SOURCES.every((s) => !s.note.includes('09:20') && !s.note.includes('13:20')))
  check('🔴 현재 능력 < 준비 능력 — 둘을 합치지 않는다',
    cap.effectivePerDay < preparedCapacity('start').effectivePerDay)
  /**
   * 🔴 **관측된 슬롯 수 × 정본 상세량**으로 센다 (2026-09-14).
   *    옛 fixture 는 `회차당 10건` 을 손으로 적었다. 실제는 `planCafeRun` 정본이
   *    remonterrace 11 · wgang 16 을 낸다 — 옛 값으로 현재 능력을 계산하지 않는다.
   */
  const wantObservedCap = (): number => {
    let n = 0
    for (const cafeId of ['remonterrace', 'wgang'] as const) {
      const cp = planCafeRun({ cafeId })
      const slots = OBSERVED.filter((o) => o.loaded && o.label.includes(`collect-${cafeId}`))
        .reduce((a, o) => a + o.slots.length, 0)
      n += cp.detailPerRun * slots
    }
    return n
  }
  check('🔴 현재 능력은 등록된 것만 · 관측 슬롯 수로 센다', cap.effectivePerDay === wantObservedCap())
  check('🔴 등록된 것은 -multi 로 읽힌다',
    cap.perSource.filter((x) => x.kind === 'multi').length === 2
    && cap.perSource.every((x) => x.kind !== 'single'))
  /**
   * 🔴 **처리 job 은 수집 능력이 아니다** (2026-09-11).
   *    옛 중앙 러너는 "재고가 모자랄 때만" 82cook 을 열었고, 그 조건부 몫이 능력으로
   *    세어져 화면은 초록인데 실제 신규는 며칠씩 0 이었다. 지금 처리 job 은 수집하지 않고,
   *    82cook 몫은 **예약 job 의 슬롯**에서만 나온다.
   */
  check('🔴 처리 job 이 올라와 있어도 수집 능력은 늘지 않는다', cap.effectivePerDay === wantObservedCap())
  check('🔴 82cook 얇은 상세 job 이 미등록이면 그 몫은 0 이다',
    thin82cookDetailPerDay(OBSERVED) === 0)
  check('🟢 등록되면 관측 슬롯 수 × 회차 상한 × 성공률로 센다', (() => {
    const on = [...OBSERVED, {
      label: THIN_82COOK_JOB,
      slots: [...THIN_82COOK_SLOTS],
      loaded: true,
    }]
    return thin82cookDetailPerDay(on) === thin82cookCapPerRun() * THIN_82COOK_RUNS_PER_DAY * 0.8
  })())
  check('🔴 정적 loaded 계산기(supplyCapacity)가 사라졌다',
    !/export function supplyCapacity/.test(read('src/lib/scale-supply-plan.ts')))
  check('🔴 병목 판정도 관측을 쓴다',
    /const cur = currentCapacity\(observed\)/.test(read('src/lib/scale-supply-plan.ts')))
  // 🔴 수집 배수를 통과율에 연결했다 — 리터럴 4 를 지웠고, 값은 그대로 4 다 (회귀 0)
  check('🔴 수집 배수 = ceil(1 / (detail→judge × judge → draft × draft 통과))',
    detailPerQueueItem() === Math.ceil(1 / (YIELD.detailToJudge * YIELD.judgePass * YIELD.draftPass)))
  check('🔴 그 값은 여전히 4 다 (회귀 0)', detailPerQueueItem() === 4)

  // 🔴 필요 회차 — "몇 번 더 돌려야 하는가"
  const runs = requiredRuns(p100)
  check('🔴 수집원별 필요 회차를 낸다', runs.length === SOURCES.length
    && runs.every((r) => r.runsNeededAlone === Math.ceil(p100.detailPerDay / r.maxPerRun)))
  /**
   * 🔴 **동작을 본다 — 특정 source 가 미등록이라는 사실에 기대지 않는다** (2026-09-13).
   *    옛 판은 82cook 이 `loaded: false` 인 것을 빌려 이 규칙을 증명했다.
   *    그래서 82cook 을 등록한 날 이 검사가 깨졌고, 고치려면 사실을 되돌려야 했다.
   */
  check('🔴 등록된 수집원은 자기 회차 수를 센다',
    runs.filter((r) => SOURCES.find((s) => s.id === r.id)?.loaded === true)
      .every((r) => r.runsNow > 0))
  check('🔴 등록되지 않은 수집원은 0 회차다', requiredRuns(p100, [
    { id: 'synthetic:unloaded', maxPerRun: 10, runsPerDay: 5, loaded: false },
  ]).every((r) => r.runsNow === 0))

  // 🔴 병목 — limits 를 넘기지 않으면 **실제 상수**로 본다
  const now = findBottlenecks(p100, undefined, OBSERVED)
  check('🔴 실제 상한으로 100/day 는 BLOCK', now.some((b) => b.stage === 'collect' && b.severity === 'BLOCK'))
  check('🔴 미등록 수집원을 경고한다', now.some((b) => b.stage === 'source' && b.detail.includes('82cook')))
  check('🔴 통과율 가정도 병목으로 적는다', now.some((b) => b.stage === 'yield'))
  const fixed = findBottlenecks(p100, { collectCapMax: 500, runsPerDay: 10, registeredSources: 3 })
  check('🔴 상한을 올리면 collect BLOCK 이 사라진다', !fixed.some((b) => b.stage === 'collect' && b.severity === 'BLOCK'))
  check('🟢 지금 운영(d1)은 BLOCK 이 없다',
    !findBottlenecks(planSupply(PROFILES.d1), undefined, OBSERVED).some((b) => b.severity === 'BLOCK'))

  // 🔴 비용 — 단가를 모르면 계산하지 않는다
  check('🔴 단가 없으면 비용 unknown (추정 금지)', (() => {
    const c = estimateCost(p100, readPricing({}))
    return !c.known && c.dailyUsd === null && c.reason.includes(COST_ENV.perJudge)
  })())
  check('🔴 숫자가 아니면 unknown', readPricing({ [COST_ENV.perJudge]: 'x', [COST_ENV.perDraft]: '0.01' }) === null)
  const priced = readPricing({ [COST_ENV.perJudge]: '0.01', [COST_ENV.perDraft]: '0.02', [COST_ENV.dailyBudget]: '10' })!
  const cost = estimateCost(p100, priced)
  check('🔴 비용 = judge×단가 + draft×단가', cost.known
    && Math.abs(cost.dailyUsd! - (p100.judgePerDay * 0.01 + p100.draftPerDay * 0.02)) < 1e-9)
  check('🔴 예산이 넉넉하면 안전 상한이 목표보다 높다', (cost.safeQueuePerDay ?? 0) > p100.queuePerDay)
  check('🔴 예산이 빠듯하면 안전 상한이 목표 아래로 내려온다', (() => {
    const tight = estimateCost(p100, { ...priced, dailyBudgetUsd: 1 })
    return (tight.safeQueuePerDay ?? 0) > 0 && tight.safeQueuePerDay! < p100.queuePerDay
  })())
  check('예산 없으면 상한 없음', estimateCost(p100, { ...priced, dailyBudgetUsd: null }).safeQueuePerDay === null)
}

// ── ⑥ 🔴 준비도 — 산술이 아니라 **시뮬레이션**이 판정한다 ──
console.log('\n⑥ 준비도 (140행 고유 queue id 시뮬레이션)')
{
  const pool = parsePoolDoc(read('docs/operations/2026-08-30-persona-pool-design.md'))
  check('정본 Pool 파싱 문제 0', pool.problems.length === 0)
  const usable = pool.cards.filter((c) => c.voiceLength !== null)
  // 🔴 Pool 이 25장으로 늘었다 (P21~P25 · 얇은 축 보강). P09 만 길이 미상이다
  check('🔴 길이를 읽을 수 있는 카드 24장 (Pool 25 - P09)', usable.length === 24)
  const personas = usable.map(cardToPersona)

  // 🔴 **재현 가능한 fixture** — 시각 · 난수 · DB 없이 같은 결과가 나온다
  const START = new Date('2026-09-09T00:05:00+09:00')
  /**
   * 🔴 **상시(evergreen) 문구만 쓴다.** 이 큐로 재는 것은 **persona 여력**이지 TTL 이 아니다.
   *    현재성 문구를 섞으면 14일 지평 중간에 TTL(7일)로 빠져 무엇을 재는지 흐려진다 —
   *    나이가 흐르는 것은 `d10:prep-check ⑬` 이 따로 잰다.
   */
  const NEUTRAL = ['아침에 산책을 다녀왔습니다', '주말에 산책을 다녀왔습니다', '오랜만에 김치를 담갔어요',
    '장 보러 다녀왔어요', '커피 한 잔 마시며 쉬는 중이에요']
  const q = (n: number): QueueCandidate[] => Array.from({ length: n }, (_, i) => ({
    queueId: `q-${String(i).padStart(3, '0')}`,
    title: `${NEUTRAL[i % NEUTRAL.length]} (${i})`,
    body: `${NEUTRAL[i % NEUTRAL.length]}\n\n있었던 소소한 이야기를 적어 봅니다. ${i}번째 글이에요.`,
    gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null,
    // 🔴 나이는 계획 시점마다 다시 잰다 — 갓 수집된 글로 둔다
    voice: null, profile: 'human' as const, capturedAt: START,
  }))
  const q140 = q(140)
  check('🔴 queue id 140개가 전부 다르다', new Set(q140.map((x) => x.queueId)).size === 140)

  // 🔴 시작점을 직접 주지 않는다 — 단계별 anchor 는 lib 이 만든다
  const AXIS = { now: START, publishedToday: 0 }
  const sim = (stage: 'd1' | 'd3' | 'd5' | 'd10', ps = personas, queue = q140): ReturnType<typeof simulateStage> =>
    simulateStage({ stage, queue, personas: ps, axis: AXIS })

  // 🔴 산술 최소 인원만으로는 채우지 못한다 — 이것이 이번 수정의 핵심 근거다
  const arithmetic = derive(PROFILES.d10).personasNeededArithmetic
  check('🔴 d10 산술 최소는 14명', arithmetic === 14)
  const at14 = sim('d10', personas.slice(0, 14))
  check('🔴 그 14명으로 돌리면 129/140 — 산술만 보고 READY 라 하면 안 된다', at14.in14 === 129)
  check('🔴 14명 d10 은 not-ready', !judgeReadiness(at14).ready)
  check('🔴 not-ready 사유에 미달 건수가 적힌다', judgeReadiness(at14).reasons.some((r) => r.includes('11건 미달')))
  check('🔴 산술값은 참고로만 적는다', judgeReadiness(at14).arithmeticPersonas === 14)

  // 🔴 옛 Pool(19명)은 미달이었다 — 그래서 얇은 축을 메웠다
  const at19 = sim('d10', personas.slice(0, 19))
  check('🔴 옛 Pool 19명은 139/140 — 여유가 없었다', at19.in14 === 139 && !judgeReadiness(at19).ready)
  const at24 = sim('d10')
  check('🟢 24명이면 140/140 — 얇은 축 보강의 결과다', at24.in14 === 140 && judgeReadiness(at24).ready)
  check('🔴 공백 0일 · 복구 깨짐 0 (막힌 것이 아니라 모자란 것이다)', at19.gaps === 0 && at19.recoveryBroken === 0)
  check('🔴 24명에서도 공백 0 · 복구 깨짐 0', at24.gaps === 0 && at24.recoveryBroken === 0)

  const d5at19 = sim('d5', personas, q(70))
  check('🟢 d5 는 19명 · 재고 70 이면 70/70 · 공백 0 → READY', d5at19.in14 === 70 && d5at19.gaps === 0
    && judgeReadiness(d5at19).ready)
  const d3at19 = sim('d3', personas, q(42))
  check('🟢 d3 도 READY', judgeReadiness(d3at19).ready)
  const d1at19 = sim('d1', personas, q(14))
  check('🟢 d1 은 14/14 · 공백 0 → READY', d1at19.in14 === 14 && judgeReadiness(d1at19).ready)

  /**
   * 🔴 persona 가 줄면 자동으로 낮춘다.
   *
   *    🔴 경계가 11명 → **10명**으로 내려갔다. 예측이 이제 러너와 **같은 발행 순서**
   *    (복구 → 현재성 → 상시 적합도)를 쓰기 때문이다 — 자리 경쟁에서 더 잘 맞는 사람이
   *    먼저 앉으므로 같은 인원으로 더 많이 나간다. 값이 흔들린 것이 아니라 **정확해진 것**이다.
   */
  const d5at10 = sim('d5', personas.slice(0, 10), q(70))
  const d5at9 = sim('d5', personas.slice(0, 9), q(70))
  check('🟢 d5 는 10명이면 70/70', d5at10.in14 === 70 && judgeReadiness(d5at10).ready)
  check('🔴 한 명이 멈춰 9명이 되면 66/70 — not-ready', d5at9.in14 === 66 && !judgeReadiness(d5at9).ready)
  const throttled = safeStageFor('d5', [
    judgeReadiness(sim('d1', personas.slice(0, 9), q(14))),
    judgeReadiness(sim('d3', personas.slice(0, 9), q(42))),
    judgeReadiness(d5at9),
    judgeReadiness(sim('d10', personas.slice(0, 9))),
  ])
  check('🔴 자동으로 아래 단계로 감속한다', throttled.throttled && stageRank(throttled.stage) < stageRank('d5'))
  check('🔴 감속 사유에 어느 단계가 미달인지 적는다', (throttled.reason ?? '').includes('d5'))

  // 🔴 재고가 모자라면 그것도 not-ready 다
  const lowStock = sim('d10', personas, q(100))
  check('🔴 재고 100건이면 100/140 · 공백 4일', lowStock.in14 === 100 && lowStock.gaps === 4)
  check('🔴 재고 부족 사유가 적힌다', judgeReadiness(lowStock).reasons.some((r) => r.includes('재고')))

  // 🔴 생활사 쏠림 — **큐가 한 축을 요구할 때** 인원 수는 답이 아니다.
  //    아래 큐는 전부 "중학생 아이" 이야기다. `hardFilter` 는 그 축을 가진 사람만 통과시킨다
  const kidQ = Array.from({ length: 140 }, (_, i) => ({
    queueId: `k-${String(i).padStart(3, '0')}`,
    // 🔴 현재성 낱말을 넣지 않는다 — 이 큐가 재는 것은 **생활사 축 쏠림**이다
    title: `중학생 아이 시험 때문에 잠을 못 잡니다 (${i})`,
    body: `중학생 아이 시험 준비로 온 집이 예민해요. 저녁마다 학원 데려다주고 오면 하루가 다 갑니다. ${i}`,
    gateVerdict: 'PASS', createdAt: i, assignedPersonaCode: null, voice: null, profile: 'human' as const, capturedAt: START,
  }))
  const kidDiverse = sim('d10', personas, kidQ)
  check('🔴 큐가 한 축으로 쏠리면 19명이어도 40/140 뿐이다', kidDiverse.in14 === 40 && kidDiverse.gaps === 4)
  check('🔴 그때 READY 라고 하지 않는다', !judgeReadiness(kidDiverse).ready)
  // 🔴 축이 맞지 않는 사람만 19명이면 **0건**이다 — 인원을 늘려도 소용없다
  const wrongAxis = pool.cards.find((c) => c.code === 'P02')!
  const kidNone = sim('d10', Array.from({ length: 19 }, (_, i) => ({ ...cardToPersona(wrongAxis), code: `X${i}` })), kidQ)
  check('🔴 축이 맞지 않는 19명은 0/140 · 공백 14일', kidNone.in14 === 0 && kidNone.gaps === 14)
  check('🔴 산술 인원은 이 상황을 전혀 모른다',
    judgeReadiness(kidNone).arithmeticPersonas === 14 && !judgeReadiness(kidNone).ready)
  // 🔴 축이 맞는 사람만 19명이면 140/140 — 같은 인원인데 결과가 갈린다
  const rightAxis = pool.cards.find((c) => c.code === 'P01')!
  const kidAll = sim('d10', Array.from({ length: 19 }, (_, i) => ({ ...cardToPersona(rightAxis), code: `Y${i}` })), kidQ)
  check('🔴 축이 맞는 19명은 140/140 — 인원이 아니라 조합이 정한다', kidAll.in14 === 140 && kidAll.gaps === 0)

  // 🔴 **판정 분기를 직접 시험한다.** 시뮬레이션만 돌리면 그 분기가 한 번도 안 켜져
  //    가드를 지워도 fixture 가 통과한다 — 실제로 그랬다(복구 깨짐 가드).
  const synth = (o: Partial<ReturnType<typeof simulateStage>> = {}): ReturnType<typeof simulateStage> => ({
    stage: 'd1', dates: [], in14: 14, want14: 14, gaps: 0, recoveryBroken: 0, personas: 19, stock: 14,
    // 🔴 지평 시작점과 다음 슬롯은 **다른 값**이다 — 판정 분기 시험에는 둘 다 필요하다
    horizonStartAt: horizonStart(START), nextSlotAt: START, horizonDays: 14, ...o,
  })
  check('🟢 아무 문제 없으면 READY', judgeReadiness(synth()).ready)
  check('🔴 복구 깨짐이 1건이라도 있으면 not-ready — 레인이 멈춘 것이다',
    !judgeReadiness(synth({ recoveryBroken: 1 })).ready
    && judgeReadiness(synth({ recoveryBroken: 1 })).reasons.some((r) => r.includes('복구')))
  check('🔴 미달이면 not-ready', !judgeReadiness(synth({ in14: 13 })).ready
    && judgeReadiness(synth({ in14: 13 })).reasons.some((r) => r.includes('1건 미달')))
  check('🔴 공백이 있으면 not-ready', !judgeReadiness(synth({ gaps: 1 })).ready
    && judgeReadiness(synth({ gaps: 1 })).reasons.some((r) => r.includes('공백')))
  check('🔴 재고가 목표보다 적으면 not-ready', !judgeReadiness(synth({ stock: 13 })).ready
    && judgeReadiness(synth({ stock: 13 })).reasons.some((r) => r.includes('재고')))
  check('🔴 사유가 여러 개면 전부 적는다',
    judgeReadiness(synth({ in14: 0, gaps: 14, stock: 0, recoveryBroken: 2 })).reasons.length === 4)
  check('🔴 복구가 깨진 단계는 감속 대상에서 빠진다', safeStageFor('d3', [
    judgeReadiness(synth({ stage: 'd1', recoveryBroken: 1 })),
    judgeReadiness(synth({ stage: 'd3', in14: 0, want14: 42 })),
  ]).stage === SAFEST_STAGE)

  // 🔴 아무 단계도 준비되지 않으면 가장 안전한 단계로
  const none = safeStageFor('d10', RELEASE_STAGES.map((s) => ({
    stage: s, ready: false, reasons: ['x'], arithmeticPersonas: 1,
  })))
  check('🔴 전부 not-ready 면 d1 로 내린다', none.stage === SAFEST_STAGE && none.throttled)
  check('🟢 요청 단계가 ready 면 그대로', safeStageFor('d3', [judgeReadiness(d3at19)]).throttled === false)

  // 🔴 네 단계를 한 번에 — planner 와 같은 함수다
  const all = simulateAllStages({ queue: q140, personas, axis: AXIS })
  check('네 단계를 모두 판정한다', all.length === 4)
  // 🔴 24명·재고 140 이면 네 단계가 전부 ready 다 — 그것이 이번 보강의 목적이다
  check('🔴 24명·재고 140 이면 네 단계 모두 ready', all.every((x) => x.verdict.ready))
  check('🔴 19명이면 d10 만 not-ready 다', simulateAllStages({
    queue: q140, personas: personas.slice(0, 19), axis: AXIS,
  }).filter((x) => !x.verdict.ready).map((x) => x.sim.stage).join() === 'd10')
}

// ── ⑦ cohort manifest ──
console.log('\n⑦ cohort manifest')
{
  check('🔴 manifest 전체가 성립한다', verifyAllCohorts().length === 0)
  check('wave3 는 11명이다', COHORTS['wave3-scale'].codes.length === 11)
  check('🔴 P09 가 어느 cohort 에도 없다', Object.values(COHORTS).every((m) => !m.codes.includes('P09')))
  check('🔴 P09 제외 이유가 코드에 적혀 있다', (EXCLUDED_CODES.P09 ?? '').includes('readLengthBand'))
  check('🔴 네 cohort 합이 24명 (Pool 25 - P09)',
    Object.values(COHORTS).reduce((n, m) => n + m.codes.length, 0) === 24)
  check('wave3 는 선행 두 개를 요구한다', COHORTS['wave3-scale'].requires.length === 2)
  check('알 수 없는 id 는 null', cohortOf('nope') === null)
  check('🔴 제외 대상이 들어가면 잡는다',
    verifyManifest({ id: 'wave2', purpose: 'x', codes: ['P09'], requires: [] }).some((x) => x.includes('제외 대상')))
  check('🔴 중복 코드를 잡는다',
    verifyManifest({ id: 'wave2', purpose: 'x', codes: ['P01', 'P01'], requires: [] }).some((x) => x.includes('중복')))
  check('🔴 코드순이 아니면 잡는다',
    verifyManifest({ id: 'wave2', purpose: 'x', codes: ['P02', 'P01'], requires: [] }).some((x) => x.includes('코드순')))
  check('🔴 형식 밖 코드를 잡는다',
    verifyManifest({ id: 'wave2', purpose: 'x', codes: ['P99'], requires: [] }).some((x) => x.includes('형식')))
  /**
   * 🔴 **다음 회차는 총 24명까지 간다** (2026-09-08 결정).
   *    그때 정규식을 고치게 하지 않는다 — manifest 계약이 미리 그 범위를 받아야 한다.
   *    범위를 넓혀도 안전한 이유: 도구가 **정본 Pool 에 카드가 없는 코드를 거부**한다.
   */
  check('🔴 P21~P24 를 형식으로 거부하지 않는다 — 24명 확장 계약',
    verifyManifest({ id: 'wave3-scale', purpose: 'x', codes: ['P21', 'P22', 'P23', 'P24'], requires: [] })
      .every((x) => !x.includes('형식')))
  check('🔴 그래도 P51 은 형식 밖이다 (범위는 P01~P50)',
    verifyManifest({ id: 'wave3-scale', purpose: 'x', codes: ['P51'], requires: [] }).some((x) => x.includes('형식')))
  check('🔴 도구가 Pool 카드 없는 코드를 거부한다 — 범위 확장의 안전장치',
    /정본 Pool 에 카드가 없는 대상/.test(read('scripts/persona-cohort-run.mts')))
  // 🔴 회차 전용 입력 파일 — 다른 회차 파일을 덮어쓰지 않는다
  check('🔴 회차마다 입력 파일이 다르다',
    displayNamePathOf('wave3-scale') !== displayNamePathOf('wave2')
    && seedPathOf('wave3-scale') !== seedPathOf('wave2')
    && displayNamePathOf('wave3-scale').startsWith('tmp/'))
  check('🔴 입력 키가 회차 전원과 정확히 같아야 한다',
    checkCohortKeys(COHORTS['wave3-scale'], COHORTS['wave3-scale'].codes).length === 0
    && checkCohortKeys(COHORTS['wave3-scale'], ['P03']).length > 0
    && checkCohortKeys(COHORTS['wave3-scale'], [...COHORTS['wave3-scale'].codes, 'P01']).length > 0)
}

// ── ⑧ cohort 단계 게이트 ──
console.log('\n⑧ 단계 게이트 (fail-closed)')
{
  const m = COHORTS['wave3-scale']
  const S = (o: Partial<CohortMemberState> = {}): CohortMemberState => ({
    code: 'P03', exists: true, status: 'draft', hasNickname: true, seeded: true,
    accountCount: 0, providerId: null, ...o,
  })
  const all = (o: Partial<CohortMemberState> = {}): CohortMemberState[] => m.codes.map((code) => S({ code, ...o }))

  check('없으면 absent', stageOf(S({ exists: false, status: null })) === 'absent')
  check('seed 없으면 draft-no-seed', stageOf(S({ seeded: false })) === 'draft-no-seed')
  check('전부 갖추면 draft-seeded', stageOf(S()) === 'draft-seeded')
  check('active 면 active', stageOf(S({ status: 'active' })) === 'active')

  check('🟢 없으면 생성 가능', judgeCreate(all({ exists: false, status: null }), m).ok)
  check('🔴 이미 있으면 생성 거부', !judgeCreate(all(), m).ok)
  check('🔴 만들지 않았는데 seed 거부', !judgeSeed(all({ exists: false, status: null }), m).ok)
  check('🟢 draft 면 seed 가능', judgeSeed(all({ seeded: false }), m).ok)
  for (const bad of ['active', 'paused', 'retired'] as const) {
    check(`🔴 seed 는 ${bad} 를 거부`, !judgeSeed(all({ status: bad }), m).ok)
  }
  check('🟢 전부 갖추면 활성화 가능', judgeActivate(all(), m).ok)
  check('🔴 seed 가 비면 활성화 거부', !judgeActivate(all({ seeded: false }), m).ok)
  check('🔴 닉네임이 없으면 거부', !judgeActivate(all({ hasNickname: false }), m).ok)
  check('🔴 한 명만 어긋나도 전부 거부', !judgeActivate([...all().slice(0, -1), S({ code: 'P20', seeded: false })], m).ok)
  check('🔴 대상이 빠지면 거부', !judgeActivate(all().slice(0, 3), m).ok)
  check('🟢 active 만 멈춘다', judgePause(all({ status: 'active' })).ok)
  check('🔴 draft 는 멈출 수 없다', !judgePause(all()).ok)

  const done = new Map<CohortId, readonly string[]>([
    ['wave1-mvp', COHORTS['wave1-mvp'].codes], ['wave2', COHORTS['wave2'].codes],
  ])
  check('🟢 선행이 전부 active 면 통과', judgePrerequisites(m, done).ok)
  check('🔴 선행이 반쯤이면 거부', !judgePrerequisites(m, new Map([['wave1-mvp', COHORTS['wave1-mvp'].codes], ['wave2', ['P01']]])).ok)
  check('🔴 선행이 없으면 거부', !judgePrerequisites(m, new Map()).ok)
}

// ── ⑨ 실행 게이트 ──
console.log('\n⑨ 실행 게이트 (--cohort · --step · --apply · --limit)')
{
  const n = COHORTS['wave3-scale'].codes.length
  const base = { apply: true, limit: n, actorUserId: 'u_1', reason: 'x', cohortSize: n, requireActor: true }
  check('🟢 넷을 다 주면 통과', judgeArgs(base).ok)
  check('🔴 --apply 없으면 거부', !judgeArgs({ ...base, apply: false }).ok)
  check('🔴 --limit 이 다르면 거부 — 일부만 처리하지 않는다', !judgeArgs({ ...base, limit: n - 1 }).ok)
  check('🔴 --limit 없으면 거부', !judgeArgs({ ...base, limit: null }).ok)
  check('🔴 actor 없으면 거부', !judgeArgs({ ...base, actorUserId: null }).ok)
  check('🔴 공백 actor 거부', !judgeArgs({ ...base, actorUserId: '  ' }).ok)
  check('🔴 reason 없으면 거부', !judgeArgs({ ...base, reason: null }).ok)
  check('생성·seed 는 actor 를 요구하지 않는다', judgeArgs({ ...base, actorUserId: null, reason: null, requireActor: false }).ok)

  // 🔴 --cohort allowlist
  check('🟢 wave3-scale 은 열려 있다', judgeCohortArg('wave3-scale').ok)
  check('🔴 끝난 회차는 거부', !judgeCohortArg('wave2').ok && !judgeCohortArg('wave1-mvp').ok)
  check('🔴 없는 id 는 거부', !judgeCohortArg('wave9').ok)
  check('🔴 비면 거부 (fail-closed)', !judgeCohortArg(null).ok && !judgeCohortArg('  ').ok)
  check('🔴 allowlist 와 끝난 회차가 겹치지 않는다', RUNNABLE_COHORTS.every((c) => !CLOSED_COHORTS.includes(c)))
  check('🔴 모든 cohort 가 둘 중 하나에 속한다',
    Object.keys(COHORTS).every((c) => RUNNABLE_COHORTS.includes(c as CohortId) || CLOSED_COHORTS.includes(c as CohortId)))

  // 🔴 --step
  check('🟢 다섯 단계를 받는다', COHORT_STEPS.length === 5 && COHORT_STEPS.every((s) => judgeStepArg(s).ok))
  check('🔴 모르는 단계는 거부', !judgeStepArg('delete').ok && !judgeStepArg(null).ok)
  check('🔴 활성화·중지만 actor 를 요구한다', requiresActor('activate') && requiresActor('pause')
    && !requiresActor('create') && !requiresActor('seed') && !requiresActor('check'))
}

// ── ⑩ 소스 계약 ──
console.log('\n⑩ 소스 계약')
{
  const code = (f: string): string => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // 🔴 상수를 다시 하드코딩하지 않았는가 — **값**으로 이미 봤고, 여기서는 파생 경로를 본다
  // 🔴 상수는 **가장 안전한 프로필**에서 온다. 실제 값은 러너가 주입한다 (P0-3)
  check('🔴 DAILY_PUBLISH_CAP 이 안전 프로필에서 온다',
    /DAILY_PUBLISH_CAP\s*=\s*derive\(SAFEST_PROFILE\)/.test(code('src/lib/original-post-publish.ts')))
  check('🔴 STOCK_TARGET 이 안전 프로필에서 온다',
    /STOCK_TARGET\s*=\s*derive\(SAFEST_PROFILE\)/.test(code('src/lib/micro-seed-supply-autofill.ts')))
  check('🔴 POST_CAP_PER_WEEK 이 안전 프로필에서 온다',
    /POST_CAP_PER_WEEK\s*=\s*effectiveWeeklyCap\(SAFEST_PROFILE/.test(code('src/lib/original-post-persona-match.ts')))
  // 🔴 lib 어디에서도 module-load 시점에 env 를 읽지 않는다
  for (const f of ['src/lib/scale-profile.ts', 'src/lib/scale-runtime.ts', 'src/lib/scale-readiness.ts',
    'src/lib/original-post-publish.ts', 'src/lib/original-post-persona-match.ts',
    'src/lib/micro-seed-supply-autofill.ts', 'src/lib/scale-supply-plan.ts'] as const) {
    check(`🔴 ${f.split('/').pop()} 에 process.env 가 없다`, !code(f).includes('process.env'))
  }
  // 🔴 scale-profile 은 순수해야 한다 — env 도 읽지 않는다(읽는 곳은 scale-runtime 하나뿐)
  const sp = code('src/lib/scale-profile.ts')
  for (const k of ['PrismaClient', 'prisma.', 'fetch(', 'node:fs', 'process.env', 'Math.random', 'Date.now']) {
    check(`🔴 scale-profile 에 ${k} 가 없다`, !sp.includes(k))
  }
  check('🔴 scale-profile 이 import 하지 않는다', !/^import /m.test(sp))
  check('🔴 env 는 **인자로만** 들어온다 — lib 은 아무도 직접 읽지 않는다', (() => {
    const rt = code('src/lib/scale-runtime.ts')
    return !rt.includes('process.env') && /env: Readonly<Record<string, string \| undefined>>/.test(rt)
  })())
  // 🔴 옛 계약이 사라졌는가 — 규모를 올릴 때마다 fixture 를 함께 고치게 만들던 리터럴이다
  for (const f of ['src/lib/scale-profile.ts', 'src/lib/scale-runtime.ts', 'src/lib/scale-readiness.ts',
    'src/lib/original-post-publish.ts', 'src/lib/micro-seed-supply-autofill.ts', 'src/lib/original-post-persona-match.ts']) {
    check(`🔴 ${f} 코드에 ACTIVE_PROFILE 이 없다`, !code(f).includes('ACTIVE_PROFILE'))
  }
  // 🔴 cohort 도구가 --code 를 받지 않는다
  const tool = code('scripts/persona-cohort-run.mts')
  check('🔴 cohort 도구가 --code 인자를 파싱하지 않는다', !/arg\('code'\)/.test(tool) && !/--code=/.test(tool))
  check('🔴 cohort 도구가 Serializable 을 쓴다', /isolationLevel:\s*'Serializable'/.test(tool))
  check('🔴 cohort 도구가 조건부 updateMany 를 쓴다', /updateMany\(\{\s*where:\s*\{\s*code,\s*status:\s*expect\s*\}/.test(tool))
  check('🔴 cohort 도구가 count !== 1 을 막는다', /u\.count\s*!==\s*1/.test(tool))
  check('🔴 cohort 도구가 authorHash salt 를 넘긴다',
    /VOICE_AUTHOR_HASH_SALT/.test(tool) && /checkNameCollision\([^)]*hashOf/.test(tool))
  check('🔴 cohort 도구가 실회원 정본을 쓴다', /judgeRealMember/.test(tool))
  check('🔴 cohort 도구가 전체 seed 정합을 본다', /verifyPersonaSeed/.test(tool) && /verifySeedCard/.test(tool))
  check('🔴 cohort 도구가 불변 테이블을 대조한다',
    /post\.count/.test(tool) && /comment\.count/.test(tool)
    && /originalPostApprovalQueue\.count/.test(tool) && /personaActivityLog\.count/.test(tool)
    && /microSeedRawContent\.count/.test(tool))
  check('🔴 cohort 도구가 Raw SQL 을 쓰지 않는다', !/\$queryRaw|\$executeRaw/.test(tool))
  /**
   * 🔴 **트랜잭션 마감을 회차 크기에 맞춰 명시한다** (2026-09-09 실측 재현).
   *    Prisma 기본 마감은 5초다. 회차 전원을 한 트랜잭션으로 묶는 계약이라
   *    왕복이 인원에 비례하고, 원격 DB(왕복 220~290ms)에서 11명 activate 가 5초를 넘겨
   *    `Transaction not found` 로 전원 롤백했다. create·seed 는 이미 커밋된 뒤라
   *    회차가 `draft-seeded` 에 멈춰 선다 — 데이터는 안전하지만 운영이 진행되지 않는다.
   */
  check('🔴 cohort 트랜잭션이 마감을 명시한다 — 기본 5초에 기대지 않는다',
    /timeout: TX_TIMEOUT_MS/.test(tool) && /maxWait: TX_MAX_WAIT_MS/.test(tool))
  check('🔴 그 마감이 **회차 인원에 비례**한다 (고정 상수가 아니다)',
    /const TX_TIMEOUT_MS = Math\.max\(60_000, M\.codes\.length \* 3_000\)/.test(tool))
  check('🔴 사람마다 id 를 다시 묻지 않는다 — 왕복이 인원에 비례해 늘지 않는다',
    !/findUniqueOrThrow\(\{ where: \{ code \}/.test(tool)
    && /const idRows = await tx\.persona\.findMany\(\{ where: \{ code: \{ in: \[\.\.\.M\.codes\] \} \}/.test(tool))
  check('🔴 id 를 못 찾으면 전원 롤백한다 — 조용히 건너뛰지 않는다',
    /id 를 찾지 못했다/.test(tool))
  check('🔴 공급 계획에 배수 리터럴이 남아 있지 않다',
    !/shortfall \* 4/.test(code('src/lib/scale-supply-plan.ts'))
    && !/shortfall \* 4/.test(code('src/lib/supply-process.ts')))
  // 🔴 planner 가 낡은 문구를 쓰지 않는다
  const planner = code('scripts/persona-capacity-planner.mts')
  check('🔴 planner 에 "현재 5명" 이 없다', !/현재 5명/.test(planner))
  check('🔴 planner 가 실제 active 수를 쓴다', /지금 active \$\{active\.length\}명/.test(planner))

  // 🔴 **화면과 JSON 이 같은 값을 본다** — 두 번 계산하면 언젠가 한쪽만 고쳐진다
  for (const [label, src] of [['planner', planner], ['supply-health', code('scripts/supply-health.mts')]] as const) {
    const calls = (src.match(/simulateAllStages\(/g) ?? []).length
    check(`🔴 ${label} 이 규모 시뮬레이션을 한 번만 돌린다`, calls === 1)
    // 🔴 감속은 `resolveScale` 안에서 한 번만 일어난다 — 화면이 따로 감속하지 않는다
    check(`🔴 ${label} 이 스스로 감속하지 않는다`, !/safeStageFor\(/.test(src))
    check(`🔴 ${label} 이 설치 결과를 그대로 쓴다`, /installFromEnv\(/.test(src))
  }
  check('🔴 planner 화면이 payload.scale 을 읽는다 (다시 계산하지 않는다)',
    /payload\.scale\.stages/.test(planner) && /payload\.scale\.releaseStage/.test(planner))
  const health = code('scripts/supply-health.mts')
  check('🔴 health JSON 에 scale 이 들어간다', /\n\s*scale,/.test(health))
  check('🔴 health 화면이 같은 scale 객체를 읽는다',
    /scale\.stages/.test(health) && /scale\.throttledByReadiness/.test(health))
  check('🔴 health 가 설정 불일치를 화면에 적는다', /configMismatch/.test(health)
    && /설정 불일치/.test(read('scripts/supply-health.mts')))
  check('🔴 health 가 감속 사유를 화면에 적는다', /자동 감속/.test(read('scripts/supply-health.mts')))
  /**
   * 🔴 **워크플로는 모든 단계의 합집합이다** (2026-09-21 보정).
   *    활성 단계 프로필과 견주면 d1 에서 10개 중 9개가 거짓 경보로 잡혔다(실측).
   *    이제 `compareWorkflowSuperset` 으로 본다 — 빠진 단계 슬롯과 계획에 없는 cron 만 잡는다.
   */
  check('🔴 health 가 워크플로우 어긋남을 본다 — 합집합 기준으로',
    /compareWorkflowSuperset\(/.test(health) && /workflowMismatch/.test(health)
    && /워크플로우 불일치/.test(read('scripts/supply-health.mts')))
  check('🔴 🔴 **활성 단계 프로필로 견주던 옛 판이 돌아오지 않았다**',
    !/compareWorkflow\(resolved\.releaseProfile/.test(health))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
