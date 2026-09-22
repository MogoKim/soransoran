#!/usr/bin/env tsx
/**
 * 공급 자동화 계약 **행동 검사** — 🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0
 *
 * 🔴 **이 검사가 잠그는 것은 "자동화됐다" 는 말이 아니다.**
 *    무엇이 되고 무엇이 안 되는지를 값으로 고정한다 — 특히 안 되는 것을.
 */
import { readFileSync } from 'node:fs'

import {
  windowAuthorization, judgeDayGuard, judgeOneDayCanary,
  WINDOW_STAGE_ENV, WINDOW_FROM_ENV, WINDOW_UNTIL_ENV, WINDOW_MAX_DAYS, kstDateString,
} from '../src/lib/release-canary'
import { resolveScale } from '../src/lib/scale-runtime'
import { PROFILES, RELEASE_STAGES, type StageVerdict } from '../src/lib/scale-profile'
import { forecastPublishing } from '../src/lib/supply-capacity-forecast'
import {
  SUPPLY_RUNS_PER_DAY, SUPPLY_RUN_SLOTS_KST, SUPPLY_BUDGET_ENV_NAMES,
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_UNDETECTED_LIMITS, SUPPLY_REQUESTS_PER_RUN,
  SUPPLY_WORKSET_PER_RUN, SUPPLY_RESERVE_HEADROOM, SUPPLY_ENV_FILE_REL, SUPPLY_ENABLE_ENV,
  judgeProductionRate, AUTO_READY_CONTRACT, AUTO_READY_STEPS, describeSupplySchedule,
} from '../src/lib/supply-schedule-contract'
import { WORKSET_DEFAULT_LIMIT, WORKSET_TOTAL_PER_SOURCE } from '../src/lib/supply-workset'
import { sourceCapturedAtOf, SOURCE_CAPTURED_KNOWN_KEY } from '../src/lib/micro-seed-supply-autofill'
import { capturedAtOfRow, ageDaysAt } from '../src/lib/supply-candidates'
import { freshnessOf, isAutoPublishable } from '../src/lib/supply-freshness'
import { judgeSpend, judgeSettle, tallyOf, type DayTally } from '../src/lib/llm-ledger'
import {
  profileOf, selectAutoTargets, voiceInputOf, judgeApply, judgePublishDefects,
  AUTO_GATE_VERDICT, MACHINE_REVIEWED_BY, type AutoRow,
} from '../src/lib/original-post-auto-publish'
import { reviewPatchOf } from '../src/lib/original-post-machine-review'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { checkVoiceFingerprint } from './lib/persona-gate-78.mjs'
import {
  MACHINE_PROFILE, MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX,
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
} from '../src/lib/micro-seed-supply-autofill'
import type { QueueCandidate } from '../src/lib/supply-candidates'
import type { PersonaForMatch } from '../src/lib/original-post-persona-match'
import type { SimOutcome } from '../src/lib/scale-readiness'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, d = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else {
    fail += 1; console.log(`  🔴 FAIL ${n}${d === '' ? '' : ` — ${d}`}`)
  }
}
console.log('\n══ 공급 자동화 계약 검사 (🔴 DB 0 · 네트워크 0 · LLM 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① 🔴 🔴 공식 edit 뒤에도 machine profile · 화자 제약이 남는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측 상황.** P08 후보는 사진 없이는 성립하지 않아 사람이 문안을 고쳐야 한다.
   *    고친 뒤에도 **기계가 만든 글**이고 **P08 의 말투**라는 사실은 그대로다 —
   *    `editedBody` 가 채워졌다고 사람 글이 되거나 다른 화자가 될 수 없다.
   *
   * 🔴 여기서 쓰는 것은 흉내가 아니라 **공식 edit 경로 그 자체**다:
   *    `reviewPatchOf({ decision: 'edit' })` 가 낸 patch 를 행에 얹고,
   *    발행기(`selectAutoTargets`) · 말투 판정(`voiceInputOf`) · 예측(`forecastPublishing`)에 넣는다.
   */
  const DRAFT_TITLE = '딸이 버리려던 가죽자켓'
  const DRAFT_BODY = '딸이 버린다길래 가져왔어요. 이런 가죽쟈켓 어떤가요?'
  const before = {
    id: 'q-p08', status: 'APPROVED', createdPostId: null, gateVerdict: AUTO_GATE_VERDICT,
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    matchedPersonaId: null, sourceSite: `${MACHINE_SITE_PREFIX}navercafe`,
    gateResults: {
      autoDraft: {
        provenance: MACHINE_PROFILE.envelopeProvenance,
        sourceDecision: MACHINE_PROFILE.sourceDecision,
        draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
        voice: { personaCode: 'P08', comments: 3, bundleDigest: 'bd', sourceDigest: 'sd' },
      },
    },
    /** 🔴 아직 사람이 보지 않았다 */
    decidedBy: 'machine:auto-draft-v5', decidedAt: null, createdAt: new Date('2026-09-21T00:00:00.000Z'),
    draftTitle: DRAFT_TITLE, editedTitle: null,
    title: DRAFT_TITLE, body: DRAFT_BODY,
  } satisfies AutoRow

  /** 🔴 실제 러너와 **같은** 안전 판정을 쓴다 — 스텁을 쓰면 안전 게이트를 시험하지 않게 된다 */
  const safeAll = (t: string, b: string): string => safetyFilter({ title: t, body: b }).verdict
  check('🔴 고치기 전에도 machine profile 이다', profileOf(before) === 'machine', String(profileOf(before)))
  check('🔴 🔴 **사람이 보기 전에는 발행 대상이 아니다 — HUMAN_REVIEW_REQUIRED**', (() => {
    const s = selectAutoTargets([before], safeAll)
    return s.targets.length === 0 && s.rejected[0]?.code === 'HUMAN_REVIEW_REQUIRED'
  })(), JSON.stringify(selectAutoTargets([before], safeAll).rejected))

  /** 🔴 **공식 edit 경로** — 사람이 문안을 고치고 왜 고쳤는지를 남긴다 */
  const patch = reviewPatchOf({
    action: {
      decision: 'edit',
      edit: {
        title: '가죽자켓, 여러분이라면 입으시겠어요',
        body: '딸이 버린다길래 가져왔습니다. 제 나이에 어울릴지 모르겠어요.',
        note: '사진 없이 성립하도록 고쳐 씀',
      },
      gate: () => ({ ok: true, reason: '' }),
    },
    draftTitle: DRAFT_TITLE, draftBody: DRAFT_BODY,
  })
  check('🔴 🔴 **edit patch 는 판정 근거 칸을 건드리지 않는다**',
    !('promptVersion' in patch) && !('model' in patch)
    && !('gateResults' in patch) && !('sourceSite' in patch),
    Object.keys(patch).join(','))

  /** 🔴 patch 를 실제로 얹는다 — 발행기가 읽는 `title`/`body` 는 edited 값이 된다 */
  const after = {
    ...before,
    status: patch.status,
    editedTitle: patch.editedTitle ?? null,
    title: patch.editedTitle ?? before.title,
    body: patch.editedBody ?? before.body,
    decidedBy: MACHINE_REVIEWED_BY, decidedAt: new Date('2026-09-22T05:00:00.000Z'),
  } satisfies AutoRow
  check('🔴 공식 edit 은 EDITED 를 남긴다', after.status === 'EDITED', after.status)
  check('🔴 🔴 **공식 edit 뒤에도 machine profile 이다 — 사람 글이 되지 않는다**',
    profileOf(after) === 'machine', String(profileOf(after)))
  check('🔴 🔴 **고친 글은 발행 대상이 된다 (사람 도장이 붙었으므로)**', (() => {
    const s = selectAutoTargets([after], safeAll)
    return s.targets.length === 1 && s.rejected.length === 0
  })(), JSON.stringify(selectAutoTargets([after], safeAll).rejected))
  check('🔴 🔴 **말투 근거도 그대로다 — P08 · machine**', (() => {
    const v = voiceInputOf(after)
    return v.profile === 'machine' && v.voice?.personaCode === 'P08'
  })(), JSON.stringify(voiceInputOf(after)))

  /** 🔴 화자 제약 — 발행 예측이 여전히 P08 에게만 준다 */
  const cand = (speaker: string): QueueCandidate => ({
    queueId: after.id, title: after.title, body: after.body,
    gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null,
    capturedAt: new Date('2026-09-21T00:00:00.000Z'),
    voice: { personaCode: speaker, comments: 3, bundleDigest: 'bd', sourceDigest: 'sd' },
    profile: 'machine' as const,
  })
  const personaOf = (code: string): PersonaForMatch => ({
    code, status: 'active', providerId: null, accountCount: 0,
    maritalStatus: '사별', childrenCount: 2, childrenAgeBands: ['성인'],
    parentCare: '없음', menopauseStatus: '진행중', workStatus: null, economicStatus: null,
    region: null, noGoTopics: [] as string[], voiceLength: '중간',
    postsThisWeek: 0, daysSinceLastPost: null,
  } as unknown as PersonaForMatch)
  const START = new Date(Date.UTC(2026, 8, 22, 15, 0))
  const d3 = PROFILES.d3
  const f = forecastPublishing({
    queue: [cand('P08')], personas: [personaOf('P08'), personaOf('P02')],
    history: [{ code: 'P08', matchedAts: [] }, { code: 'P02', matchedAts: [] }],
    startAt: START, days: 1, dailyCap: d3.dailyTarget,
    caps: { postsPerWeek: d3.postsPerWeek, minDaysBetween: d3.minDaysBetween },
  })
  check('🔴 🔴 **고친 글도 원래 화자에게만 간다 — P08**',
    f.days[0]!.published.length === 1 && f.days[0]!.published[0]!.persona === 'P08',
    JSON.stringify(f.days[0]!.published))
  const orphan = forecastPublishing({
    queue: [cand('P08')], personas: [personaOf('P02')],
    history: [{ code: 'P02', matchedAts: [] }],
    startAt: START, days: 1, dailyCap: d3.dailyTarget,
    caps: { postsPerWeek: d3.postsPerWeek, minDaysBetween: d3.minDaysBetween },
  })
  check('🔴 🔴 **그 화자가 없으면 나가지 않는다 — 남의 이름을 붙이지 않는다**',
    orphan.days[0]!.published.length === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 기간형 D3 — 그날 단계 고정 · 재고는 멈춤 · 결함은 전면 중단')
// ─────────────────────────────────────────────────────────
{
  const NOW = new Date('2026-09-23T04:30:00.000Z') // 9/23 13:30 KST
  const envOf = (o: Record<string, string>) => o as NodeJS.ProcessEnv
  const WIN = {
    SORAN_CAPACITY_STAGE: 'd3',
    [WINDOW_STAGE_ENV]: 'd3', [WINDOW_FROM_ENV]: '2026-09-23', [WINDOW_UNTIL_ENV]: '2026-09-26',
  }
  const NOTHING: StageVerdict[] = RELEASE_STAGES.map((stage) => ({ stage, ready: false, reasons: ['재고'] }))
  const simOf = (can: number): SimOutcome => ({
    stage: 'd3', dates: ['2026-09-23'], in14: can, want14: 3, gaps: 0, recoveryBroken: 0,
    personas: 24, stock: can, horizonStartAt: NOW, nextSlotAt: NOW, horizonDays: 1,
  })
  const verdictAt = (published: number, can: number) =>
    judgeOneDayCanary(simOf(can), { publishedToday: published, slotsLeft: 3 - published })
  const at = (published: number, can: number) => resolveScale(envOf(WIN), {
    readiness: NOTHING,
    window: { now: NOW, verdict: verdictAt(published, can), dayVerdict: verdictAt(published, can), publishedToday: published },
  })

  check('🔴 허가·기간이 맞으면 켜진다',
    windowAuthorization(envOf(WIN), NOW, RELEASE_STAGES).activeToday === true)
  check('🔴 🔴 **세 값 중 하나라도 없으면 켜지지 않는다**',
    windowAuthorization(envOf({ [WINDOW_STAGE_ENV]: 'd3' }), NOW, RELEASE_STAGES).activeToday === false)
  check(`🔴 🔴 **${WINDOW_MAX_DAYS}일을 넘는 기간은 거부한다 — 잊고 두는 것을 막는다**`,
    windowAuthorization(envOf({ ...WIN, [WINDOW_UNTIL_ENV]: '2026-10-30' }), NOW, RELEASE_STAGES).activeToday === false)

  // ── 0/1/2/3건 발행 뒤 재판정 ──
  const r0 = at(0, 3)
  check('🔴 0건 — 켜진다 (3/3 가능)', r0.releaseStage === 'd3', r0.releaseStage)
  for (const n of [1, 2, 3]) {
    const r = at(n, 3 - n)
    check(`🔴 🔴 **${n}건 낸 뒤에도 그날 단계는 d3 다**`, r.releaseStage === 'd3', r.releaseStage)
  }
  /**
   * 🔴 **왜 d3 인지가 건수마다 다르다** — 그 차이가 이 보정의 핵심이다.
   *    1건: 기본 단계(d1) 상한 안이므로 **그날치 판정에 물어서** 연다
   *    2건 이상: 내리면 이미 낸 것이 상한 초과가 되므로 **고정**한다
   */
  check('🔴 🔴 **1건일 때는 판정에 물어서 연다 — 발행 수만으로 확정하지 않는다**',
    at(1, 2).notes.some((x) => x.includes('구분할 수 없다'))
    && !at(1, 2).notes.some((x) => x.includes('고정')),
    at(1, 2).notes.join(' | '))
  for (const n of [2, 3]) {
    check(`🔴 🔴 **${n}건일 때는 고정한다 — 내리면 이미 낸 것이 상한 초과다**`,
      at(n, 3 - n).notes.some((x) => x.includes('고정')), at(n, 3 - n).notes.join(' | '))
  }
  /** 🔴 재고가 0 이어도 이미 낸 날은 단계를 내리지 않는다 */
  const starved = at(2, 0)
  check('🔴 🔴 **재고가 0 이어도 단계를 내리지 않는다 — 이미 낸 것이 상한 초과가 되지 않게**',
    starved.releaseStage === 'd3', starved.releaseStage)
  check('🔴 🔴 **다만 더 내지는 않는다 (재고 부족 = 멈춤, 전면 중단 아님)**', (() => {
    const g = judgeDayGuard({ publishedToday: 2, dailyTarget: 3, publishable: 0, hardDefects: [] })
    return g.allow === false && g.halt === false && g.reason.includes('재고가 없어')
  })())
  check('🔴 🔴 **중복·정산·안전 결함은 전면 중단이다**', (() => {
    const g = judgeDayGuard({ publishedToday: 1, dailyTarget: 3, publishable: 3, hardDefects: ['중복 발행'] })
    return g.allow === false && g.halt === true && g.reason.includes('전면 중단')
  })())
  check('🔴 다 냈으면 더 내지 않되 중단은 아니다', (() => {
    const g = judgeDayGuard({ publishedToday: 3, dailyTarget: 3, publishable: 5, hardDefects: [] })
    return g.allow === false && g.halt === false
  })())

  // ── 날짜 만료 ──
  const after = resolveScale(envOf(WIN), {
    readiness: NOTHING,
    window: {
      now: new Date('2026-09-27T04:30:00.000Z'), verdict: verdictAt(0, 3),
      dayVerdict: verdictAt(0, 3), publishedToday: 0,
    },
  })
  check('🔴 🔴 **기간이 끝나면 아무도 끄지 않아도 기본 단계로 돌아온다**',
    after.releaseStage === 'd1' && after.canaryStage === false, after.releaseStage)

  // ── 늦은 cron — 실제 발행 경로 ──
  {
    const late = new Date('2026-09-23T07:40:00.000Z') // 16:40 KST · d3 슬롯 아님
    const v = judgeOneDayCanary(simOf(2), { publishedToday: 1, slotsLeft: 2 })
    const r = resolveScale(envOf(WIN), {
      readiness: NOTHING,
      window: { now: late, verdict: v, dayVerdict: v, publishedToday: 1 },
    })
    check('🔴 🔴 **늦은 cron 회차에서도 그날 단계가 유지된다**',
      r.releaseStage === 'd3', r.releaseStage)
  }
  check('🔴 🔴 **기간형이어도 준비됐다고 말하지 않는다**',
    r0.chosenReady === false && r0.readinessApplied === false)

  // ── 🔴 🔴 여기서부터는 **실제 쓰기 직전의 문**(`judgeApply`)을 통과시킨다 ──
  /**
   * 🔴 판정만 맞는 것은 소용이 없다. 앞판은 `judgeDayGuard` 를 부르고 결과를
   *    **로그로만** 내보냈다 — 재고가 0 이어도 발행은 그대로 나갔다.
   *    그래서 이 묶음은 판정이 아니라 **문**을 시험한다.
   */
  const row = (id: string): AutoRow => ({
    id, status: 'APPROVED', createdPostId: null, gateVerdict: AUTO_GATE_VERDICT,
    /** 🔴 사람 profile 정본값을 가져다 쓴다 — 손으로 적으면 갈라진다 */
    promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL, matchedPersonaId: 'p',
    sourceSite: `${AUTOFILL_SITE_PREFIX}sheet`, title: 't', body: 'b',
    decidedBy: 'founder', decidedAt: new Date('2026-09-23T00:00:00.000Z'),
    createdAt: new Date('2026-09-22T00:00:00.000Z'),
  })
  const openGate = (over: Partial<Parameters<typeof judgeApply>[0]>) => judgeApply({
    targets: [row('a')], picked: row('a'), apply: true, limit: 1,
    publishedToday: 0, dailyCap: 3, killSwitchEnabled: false,
    slot: { run: true, reason: '도래' }, dayGuard: null, ...over,
  })
  /** 🔴 닫힌 이유만 꺼낸다 — 열린 판정에는 이유 칸이 없다 */
  const why = (g: ReturnType<typeof judgeApply>): string => (g.ok ? '(열림)' : g.reason)
  check('🔴 기준선 — 막는 것이 없으면 문이 열린다', openGate({}).ok === true, why(openGate({})))
  check('🔴 🔴 **기간형이 아닌 날의 동작은 그대로다 (dayGuard 없음)**',
    openGate({ dayGuard: null }).ok === true)

  const guardAt = (published: number, publishable: number, defects: string[]) => judgeDayGuard({
    publishedToday: published, dailyTarget: 3, publishable, hardDefects: defects,
  })
  for (const n of [0, 1, 2]) {
    const g = guardAt(n, 3 - n, [])
    const res = openGate({ publishedToday: n, dayGuard: g })
    check(`🔴 🔴 **${n}건 낸 시점에 재고가 있으면 문이 열린다**`, res.ok === true, why(res))
  }
  {
    const res = openGate({ publishedToday: 3, dayGuard: guardAt(3, 3, []) })
    check('🔴 🔴 **3건을 다 내면 문이 닫힌다 — 전면 중단은 아니다**',
      res.ok === false && !res.reason.includes('전면'), why(res))
  }
  {
    /** 🔴 재고 0 — **더 내지 않는다**. 실제로 문이 닫혀야 한다 */
    const res = openGate({ publishedToday: 1, dayGuard: guardAt(1, 0, []) })
    check('🔴 🔴 **재고가 없으면 실제로 문이 닫힌다 (로그만이 아니다)**',
      res.ok === false && res.reason.includes('재고가 없어') && !res.reason.includes('전면'), why(res))
  }
  {
    /** 🔴 중복·안전 결함 — **전면 중단** */
    const res = openGate({ publishedToday: 1, dayGuard: guardAt(1, 3, ['중복 발행 흔적']) })
    check('🔴 🔴 **결함이 있으면 재고가 남아 있어도 전면 중단이다**',
      res.ok === false && res.reason.includes('전면 중단'), why(res))
  }
  {
    /** 🔴 늦은 cron 이라도 그날 문 판정은 같다 — 시각이 아니라 그날 상태로 연다 */
    const res = openGate({ publishedToday: 2, dayGuard: guardAt(2, 1, []), slot: { run: true, reason: '밀린 슬롯' } })
    check('🔴 🔴 **늦은 cron 으로 밀린 슬롯을 메울 때도 문이 열린다**', res.ok === true, why(res))
  }
  {
    /** 🔴 슬롯 판정이 막으면 그날 판정과 무관하게 닫힌다 — 문이 두 개가 되지 않는다 */
    const res = openGate({ dayGuard: guardAt(0, 3, []), slot: { run: false, reason: '내 회차가 아니다' } })
    check('🔴 그날 판정이 GO 여도 슬롯이 아니면 닫힌다', res.ok === false)
  }

  // ── 🔴 🔴 후보별 제외가 그날 전체를 막지 않는다 ──
  {
    /**
     * 🔴 **한 줄 때문에 멀쩡한 나머지가 멎으면 안 된다** (2026-09-22 보정).
     *
     *    앞판은 `SAFETY` 로 빠진 행이 한 건이라도 있으면 그날을 **전면 중단**했다.
     *    안전 판정 실패는 그 행 하나의 문제이고 `selectAutoTargets` 가 이미 빼 준다.
     *    그것을 전면 중단으로 올리면 공급이 조용히 0 이 된다.
     *
     * 🔴 그래서 **안전한 행 + 위험한 행을 섞어** 실제 발행 게이트까지 통과시킨다.
     */
    const safeRow = { ...row('safe'), title: '무릎이 시큰거려서요', body: '계단이 무서워졌습니다. 다들 어떠신가요.' }
    /** 🔴 실제 안전 판정이 잡는 문구를 쓴다 — 스텁이 아니다 */
    const riskyRow = {
      ...row('risky'), title: '이 약 드시면 낫습니다',
      body: '병원 가지 마시고 이 약만 드세요. 암도 완치됩니다. 계좌로 입금하시면 보내 드립니다.',
    }
    const realSafety = (t: string, b: string): string => safetyFilter({ title: t, body: b }).verdict
    const sel = selectAutoTargets([safeRow, riskyRow], realSafety)
    check('🔴 🔴 **위험한 행만 빠지고 안전한 행은 남는다**',
      sel.targets.length === 1 && sel.targets[0]!.id === 'safe'
      && sel.rejected.some((r) => r.id === 'risky' && r.code === 'SAFETY'),
      `${sel.targets.map((t) => t.id).join(',')} / ${JSON.stringify(sel.rejected)}`)

    /** 🔴 그 제외가 **그날 판정의 결함 목록에 들어가지 않는다** */
    const g = judgeDayGuard({
      publishedToday: 0, dailyTarget: 3, publishable: 1,
      // 🔴 후보별 제외는 여기 들어오지 않는다 — 러너가 넣지 않는 것을 검사도 넣지 않는다
      hardDefects: [],
    })
    const res = judgeApply({
      targets: sel.targets, picked: sel.targets[0] ?? null, apply: true, limit: 1,
      publishedToday: 0, dailyCap: 3, killSwitchEnabled: false,
      slot: { run: true, reason: '도래' }, dayGuard: g,
    })
    check('🔴 🔴 **위험한 행이 섞여 있어도 안전한 후보는 실제로 발행 게이트를 통과한다**',
      res.ok === true, why(res))

    /** 🔴 배관 결함은 여전히 그날을 닫는다 — 둘을 섞지 않았다는 증거 */
    const plumbing = judgeApply({
      targets: sel.targets, picked: sel.targets[0] ?? null, apply: true, limit: 1,
      publishedToday: 0, dailyCap: 3, killSwitchEnabled: false,
      slot: { run: true, reason: '도래' },
      dayGuard: judgeDayGuard({
        publishedToday: 4, dailyTarget: 3, publishable: 1,
        hardDefects: ['오늘 발행 4건이 상한 3건을 넘었다 — 중복 발행 흔적이다'],
      }),
    })
    check('🔴 🔴 **배관 결함(상한 초과)은 여전히 전면 중단이다**',
      plumbing.ok === false && plumbing.reason.includes('전면 중단'), why(plumbing))

    /**
     * 🔴 **결함 조립을 실제로 돌려 본다.** 러너 안에 조립이 있으면 검사가 닿지 않아
     *    "안전 제외를 넣지 않았다" 를 문자열로만 믿어야 했다 — 그 검사는 우회된다.
     */
    const d = judgePublishDefects({
      publishedToday: 1, dailyCap: 3, recoveryBroken: 0, rejected: sel.rejected,
    })
    check('🔴 🔴 **안전 제외가 있어도 전면 중단 사유는 0 이다**',
      d.hardDefects.length === 0 && d.perRowExcluded === 1, JSON.stringify(d))
    check('🔴 🔴 **상한 초과는 전면 중단 사유가 된다**',
      judgePublishDefects({ publishedToday: 4, dailyCap: 3, recoveryBroken: 0, rejected: sel.rejected })
        .hardDefects.length === 1)
    check('🔴 🔴 **복구 깨짐도 전면 중단 사유다**',
      judgePublishDefects({ publishedToday: 1, dailyCap: 3, recoveryBroken: 2, rejected: [] })
        .hardDefects.length === 1)
    check('🔴 러너가 그 함수를 쓴다 — 자기 자리에서 다시 조립하지 않는다', (() => {
      const rsrc = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
      return rsrc.includes('judgePublishDefects({')
        && !/hardDefects\.push\(/.test(rsrc)
    })())
  }

  // ── 🔴 러너가 그 문에 실제로 값을 넣는가 ──
  {
    const src = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
    check('🔴 🔴 **러너가 `dayGuard` 를 게이트에 넘긴다 — 로그로 끝내지 않는다**',
      /judgeApply\(\{[^}]*dayGuard\b/.test(src.replace(/\n/g, ' ')))
    check('🔴 🔴 **그날 판정이 DB 로 센 `publishedToday` 를 쓴다 — axis 값이 아니다**', (() => {
      const i = src.indexOf('const dayGuard =')
      const j = src.indexOf('const gate = judgeApply')
      const block = src.slice(i, j)
      return /publishedToday,/.test(block) && !/axisPublishedToday/.test(block)
    })())
    check('🔴 🔴 **관측되지 않는 정산 결함을 봤다고 적지 않는다**',
      src.includes('정산 결함은 이 러너에서'))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n②-w 🔴 🔴 기간 변수가 **실제 예약 job** 까지 닿는가 · 날짜 검증')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **라이브러리가 맞는 것과 운영에서 도는 것은 다르다** (2026-09-22 보정).
   *
   *    앞판은 `windowAuthorization` 을 fixture 로만 통과시켰다. 그런데
   *    `auto-publish.yml` 의 발행 job 에는 `SORAN_RELEASE_WINDOW_*` 세 줄이
   *    **아예 없었다.** 변수를 아무리 켜도 러너의 `process.env` 에 닿지 않는다 —
   *    기능 전체가 운영에서 죽은 채 검사만 초록이었다.
   */
  const yml = readFileSync('.github/workflows/auto-publish.yml', 'utf-8')
  /** 🔴 주석을 떼고 본다 — 주석에 적힌 이름이 배선을 대신하지 않는다 */
  const code = yml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const jobEnv = code.slice(code.indexOf('jobs:'), code.indexOf('    steps:'))
  for (const n of [WINDOW_STAGE_ENV, WINDOW_FROM_ENV, WINDOW_UNTIL_ENV]) {
    check(`🔴 🔴 **예약 job 이 ${n} 를 vars 에서 받는다**`,
      new RegExp(`^\\s*${n}:\\s*\\$\\{\\{\\s*vars\\.${n}\\s*\\}\\}\\s*$`, 'm').test(jobEnv))
  }
  check('🔴 🔴 **실제 발행 step 이 그 job 안에 있어 env 를 물려받는다**', (() => {
    const i = code.indexOf("if: github.event_name == 'schedule'")
    const j = code.indexOf('jobs:')
    return i > j && code.slice(i).includes('--apply --limit=1')
  })())
  check('🔴 하루짜리 허가 세 줄도 그대로 있다 — 기간형이 그것을 지우지 않았다',
    jobEnv.includes('vars.SORAN_RELEASE_CANARY_STAGE')
    && jobEnv.includes('vars.SORAN_RELEASE_CANARY_DATE')
    && jobEnv.includes('vars.SORAN_RELEASE_STAGE'))

  // ── 🔴 존재하지 않는 날짜 · 역순 · 7일 초과 · NaN 경계 ──
  const auth = (from: string, until: string, now = new Date('2026-09-23T04:30:00.000Z')) =>
    windowAuthorization(
      { [WINDOW_STAGE_ENV]: 'd3', [WINDOW_FROM_ENV]: from, [WINDOW_UNTIL_ENV]: until },
      now, RELEASE_STAGES,
    )
  check('🔴 정상 기간은 켜진다 (9/23~9/26)', auth('2026-09-23', '2026-09-26').activeToday === true)
  for (const [f, u, why] of [
    ['2026-02-30', '2026-03-02', '2월 30일은 없다'],
    ['2026-13-01', '2026-13-03', '13월은 없다'],
    ['2026-09-00', '2026-09-03', '0일은 없다'],
    ['2026-09-32', '2026-09-33', '32일은 없다'],
    ['2025-02-29', '2025-03-01', '2025년 2월 29일은 없다 (평년)'],
  ] as const) {
    const a = auth(f, u)
    check(`🔴 🔴 **없는 날짜는 켜지 않는다 — ${why}**`,
      a.activeToday === false && a.stage === null, `${a.note}`)
  }
  check('🔴 🔴 **NaN 으로 7일 상한을 우회할 수 없다**', (() => {
    /**
     * 🔴 앞판의 구멍: `Date.parse('2026-02-30...')` 가 NaN 이면
     *    `span < 0` 도 `span + 1 > 7` 도 둘 다 false 라 **몇 달짜리 기간이 열렸다.**
     */
    const a = auth('2026-02-30', '2026-09-30')
    return a.activeToday === false && a.stage === null
  })())
  check('🔴 🔴 **역순은 켜지 않는다**', (() => {
    const a = auth('2026-09-26', '2026-09-23')
    return a.activeToday === false && (a.note ?? '').includes('시작이 끝보다 뒤')
  })())
  check(`🔴 🔴 **${WINDOW_MAX_DAYS}일 초과는 켜지 않는다 (경계 ${WINDOW_MAX_DAYS + 1}일)**`, (() => {
    const a = auth('2026-09-23', '2026-09-30')
    return a.activeToday === false && (a.note ?? '').includes(`${WINDOW_MAX_DAYS}일`)
  })())
  check(`🔴 정확히 ${WINDOW_MAX_DAYS}일은 켜진다 — 경계를 한 칸 좁히지 않는다`,
    auth('2026-09-23', '2026-09-29').activeToday === true)
  check('🔴 윤년 2월 29일은 있는 날이다 — 막지 않는다',
    auth('2028-02-29', '2028-03-01', new Date('2028-02-29T04:30:00.000Z')).activeToday === true)

  // ── 🔴 9/23 시작 · 기간 중 · 종료 다음 날 (dry-run) ──
  const NOTHING: StageVerdict[] = RELEASE_STAGES.map((stage) => ({ stage, ready: false, reasons: ['재고'] }))
  const WIN = {
    SORAN_CAPACITY_STAGE: 'd3',
    [WINDOW_STAGE_ENV]: 'd3', [WINDOW_FROM_ENV]: '2026-09-23', [WINDOW_UNTIL_ENV]: '2026-09-26',
  }
  const dayRun = (iso: string, published: number) => {
    const now = new Date(iso)
    const sim: SimOutcome = {
      stage: 'd3', dates: [kstDateString(now)], in14: 3, want14: 3, gaps: 0, recoveryBroken: 0,
      personas: 24, stock: 3, horizonStartAt: now, nextSlotAt: now, horizonDays: 1,
    }
    const v = judgeOneDayCanary(sim, { publishedToday: published, slotsLeft: 3 - published })
    return resolveScale(WIN as NodeJS.ProcessEnv, {
      readiness: NOTHING,
      window: { now, verdict: v, dayVerdict: v, publishedToday: published },
    })
  }
  {
    const r = dayRun('2026-09-23T00:40:00.000Z', 0) // 9/23 09:40 KST · 아직 0건
    check('🔴 🔴 **9/23 기간 시작 — 아직 0건이면 d3 로 연다**',
      r.releaseStage === 'd3' && r.canaryStage === true, r.releaseStage)
  }
  {
    const r = dayRun('2026-09-24T08:40:00.000Z', 2) // 기간 중 · 늦은 예약
    check('🔴 🔴 **기간 중 예약 실행 — 2건 낸 뒤에도 d3 고정**',
      r.releaseStage === 'd3' && r.notes.some((n) => n.includes('고정')), r.releaseStage)
  }
  {
    const r = dayRun('2026-09-27T00:40:00.000Z', 0) // 종료 다음 날
    check('🔴 🔴 **종료 다음 날(9/27) — 아무도 끄지 않아도 d1 로 돌아온다**',
      r.releaseStage === 'd1' && r.canaryStage === false, r.releaseStage)
  }
  {
    /**
     * 🔴 #5 — **d1 로 이미 한 편이 나간 날 오후에 기간 변수를 켠 경우.**
     *
     *    앞판은 `publishedToday > 0` 하나만 보고 그날을 d3 로 **확정**했다.
     *    그날치 판정(재고·화자·신선도)을 한 번도 묻지 않고 두 편이 더 열렸다.
     *    그 한 편이 어느 단계에서 나갔는지는 기록에 없어 구분할 수 없다.
     */
    const noGo = (iso: string, published: number) => {
      const now = new Date(iso)
      /** 🔴 재고가 없어 그날치 판정이 NO-GO 인 상황 */
      const sim: SimOutcome = {
        stage: 'd3', dates: [kstDateString(now)], in14: 0, want14: 3, gaps: 0, recoveryBroken: 0,
        personas: 24, stock: 0, horizonStartAt: now, nextSlotAt: now, horizonDays: 1,
      }
      const v = judgeOneDayCanary(sim, { publishedToday: published, slotsLeft: 3 - published })
      return resolveScale(WIN as NodeJS.ProcessEnv, {
        readiness: NOTHING,
        window: { now, verdict: v, dayVerdict: v, publishedToday: published },
      })
    }
    const r = noGo('2026-09-23T05:40:00.000Z', 1) // 9/23 14:40 KST · 이미 1건 · 판정 NO-GO
    check('🔴 🔴 **발행 수만으로 D3 를 확정하지 않는다 — 판정이 NO-GO 면 열지 않는다**',
      r.releaseStage !== 'd3', r.releaseStage)
    check('🔴 🔴 **왜 안 열었는지를 적는다**',
      r.notes.some((n) => n.includes('켜지 않는다')), r.notes.join(' | '))

    /** 🔴 판정이 GO 면 연다 — 다만 구분할 수 없다는 사실을 기록에 남긴다 */
    const go = dayRun('2026-09-23T05:40:00.000Z', 1)
    check('🔴 🔴 **판정이 GO 면 열되, 구분할 수 없다는 사실을 남긴다**',
      go.releaseStage === 'd3' && go.notes.some((n) => n.includes('구분할 수 없다')),
      go.notes.join(' | '))

    /** 🔴 이미 기본 단계 상한을 넘긴 날은 판정과 무관하게 고정한다 */
    const over = noGo('2026-09-24T05:40:00.000Z', 2)
    check('🔴 🔴 **기본 상한을 넘긴 날은 NO-GO 여도 내리지 않는다 — 소급 초과를 만들지 않는다**',
      over.releaseStage === 'd3' && over.notes.some((n) => n.includes('고정')), over.releaseStage)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n②-d5 🔴 🔴 D3 기간 운영 + D5 하루 시험이 겹치는 날')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실제 결함이었다** (2026-09-22). 그날 문(`judgeDayGuard`)이 언제나
   *    **D3 판정**(`windowVerdict.can` = 3 − 발행수)을 봤다. D5 가 함께 켜진 날에는
   *    단계가 d5(상한 5)인데 문은 3에서 "재고가 없다" 로 닫혔다 — **4·5번째가 막혔다.**
   *
   * 🔴 고친 뒤: 문은 **실제로 설치된 단계**의 판정을 본다.
   */
  const ENVS = {
    SORAN_CAPACITY_STAGE: 'd10',
    [WINDOW_STAGE_ENV]: 'd3', [WINDOW_FROM_ENV]: '2026-09-24', [WINDOW_UNTIL_ENV]: '2026-09-25',
    SORAN_RELEASE_CANARY_STAGE: 'd5', SORAN_RELEASE_CANARY_DATE: '2026-09-24',
  } as unknown as NodeJS.ProcessEnv
  const NOTHING: StageVerdict[] = RELEASE_STAGES.map((stage) => ({ stage, ready: false, reasons: ['재고'] }))
  const NOW = new Date('2026-09-24T00:40:00.000Z') // 9/24 09:40 KST
  /** 🔴 단계마다 그날치 판정을 만드는 것은 러너와 같은 방식이다 — 남은 몫만큼만 본다 */
  const dayFor = (stage: 'd3' | 'd5', published: number, stock: number) => {
    const cap = Math.max(0, PROFILES[stage].dailyTarget - published)
    const can = Math.min(cap, stock)
    const sim: SimOutcome = {
      stage, dates: ['2026-09-24'], in14: can, want14: PROFILES[stage].dailyTarget,
      gaps: 0, recoveryBroken: 0, personas: 24, stock,
      horizonStartAt: NOW, nextSlotAt: NOW, horizonDays: 1,
    }
    return judgeOneDayCanary(sim, {
      publishedToday: published,
      slotsLeft: Math.max(0, PROFILES[stage].dailyTarget - published),
    })
  }
  const resolve = (published: number, stock: number) => resolveScale(ENVS, {
    readiness: NOTHING,
    window: {
      now: NOW, verdict: dayFor('d3', published, stock),
      dayVerdict: dayFor('d3', published, stock), publishedToday: published,
    },
    canary: { now: NOW, verdict: dayFor('d5', published, stock) },
  })
  /** 🔴 앞판이 쓰던 값 = D3 판정 · 고친 뒤 = 설치된 단계 판정 */
  const gateAt = (published: number, stock: number, useWindow: boolean) => {
    const r = resolve(published, stock)
    const installed = r.releaseStage as 'd3' | 'd5'
    const v = useWindow ? dayFor('d3', published, stock) : dayFor(installed, published, stock)
    const row: AutoRow = {
      id: `q${published}`, status: 'APPROVED', createdPostId: null, gateVerdict: AUTO_GATE_VERDICT,
      promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL, matchedPersonaId: 'p',
      sourceSite: `${AUTOFILL_SITE_PREFIX}sheet`, title: 't', body: 'b',
      decidedBy: 'founder', decidedAt: NOW, createdAt: NOW,
    }
    return {
      stage: installed,
      cap: PROFILES[installed].dailyTarget,
      gate: judgeApply({
        targets: [row], picked: row, apply: true, limit: 1,
        publishedToday: published, dailyCap: PROFILES[installed].dailyTarget,
        killSwitchEnabled: false, slot: { run: true, reason: '도래' },
        dayGuard: judgeDayGuard({
          publishedToday: published, dailyTarget: PROFILES[installed].dailyTarget,
          publishable: v.can, hardDefects: [],
        }),
      }),
    }
  }

  check('🔴 🔴 **겹치는 날 설치되는 단계는 d5 다 (높은 쪽)**',
    resolve(0, 5).releaseStage === 'd5', resolve(0, 5).releaseStage)
  check('🔴 🔴 **상한도 5다 — 3에서 멈추지 않는다**', gateAt(0, 5, false).cap === 5)

  // ── 🔴 실제 연속 0→5회 ──
  for (const n of [0, 1, 2, 3, 4]) {
    const r = gateAt(n, 5 - n, false)
    check(`🔴 🔴 **${n}건 낸 뒤 ${n + 1}번째가 열린다 (d5 · 상한 5)**`,
      r.stage === 'd5' && r.gate.ok === true, r.gate.ok ? '' : r.gate.reason)
  }
  check('🔴 🔴 **5건을 다 내면 닫힌다 — 6번째는 없다**', (() => {
    const r = gateAt(5, 0, false)
    return r.gate.ok === false && !r.gate.reason.includes('전면')
  })())

  /** 🔴 **앞판 결함 재현** — D3 판정을 쓰면 4번째가 막힌다 */
  check('🔴 🔴 **회귀 재현: D3 판정을 쓰면 4번째가 막힌다**', (() => {
    const bad = gateAt(3, 2, true)
    return bad.stage === 'd5' && bad.gate.ok === false && bad.gate.reason.includes('재고가 없어')
  })(), JSON.stringify(gateAt(3, 2, true).gate))

  // ── D5 NO-GO 이면 적격한 D3 를 유지한다 ──
  {
    /** 🔴 재고가 3건뿐이라 d5 는 NO-GO 이지만 d3 는 GO 다 */
    const r = resolveScale(ENVS, {
      readiness: NOTHING,
      window: { now: NOW, verdict: dayFor('d3', 0, 3), dayVerdict: dayFor('d3', 0, 3), publishedToday: 0 },
      canary: { now: NOW, verdict: dayFor('d5', 0, 3) },
    })
    check('🔴 🔴 **D5 가 NO-GO 면 d1 로 떨어지지 않고 적격한 D3 를 유지한다**',
      r.releaseStage === 'd3', r.releaseStage)
    check('🔴 왜 d5 를 안 켰는지 적는다',
      r.notes.some((n) => n.includes('d5')), r.notes.join(' | '))
  }
  check('🔴 🔴 **겹쳐도 준비됐다고 말하지 않는다**',
    resolve(0, 5).chosenReady === false && resolve(0, 5).readinessApplied === false)
  check('🔴 🔴 **capacity 를 넘는 단계는 시험이라도 열지 않는다**', (() => {
    const low = { ...ENVS, SORAN_CAPACITY_STAGE: 'd3' } as NodeJS.ProcessEnv
    const r = resolveScale(low, {
      readiness: NOTHING,
      window: { now: NOW, verdict: dayFor('d3', 0, 5), dayVerdict: dayFor('d3', 0, 5), publishedToday: 0 },
      canary: { now: NOW, verdict: dayFor('d5', 0, 5) },
    })
    return r.releaseStage === 'd3'
  })())

  // ── 🔴 러너가 설치된 단계의 판정을 쓰는가 ──
  {
    const src = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
    check('🔴 🔴 **러너의 그날 문이 설치된 단계 판정을 쓴다**',
      /publishable: effectiveVerdict\.can/.test(src) && !/publishable: windowVerdict\.can/.test(src))
    check('🔴 판정을 만드는 함수가 하나다 — 창이 달라지지 않는다',
      (src.match(/const dayFor = \(stage: ReleaseStage\)/g) ?? []).length === 1
      && (src.match(/anchor: 'now'/g) ?? []).length === 1)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n②-f 🔴 🔴 원천을 언제 봤는가 — 지어내지 않는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실측 결함** (2026-09-22). 적재기가 `MicroSeedRawContent.sourceCapturedAt` 에
   *    **검토 시각**(`reviewedAt`, 없으면 `new Date()`)을 넣었고, 발행기가 그 값으로
   *    TTL 을 쟀다. 큐 `cmuc80gx4…` 의 실제 원천은 **9/17** 인데 DB 는 9/22 14:15 였다.
   *    시의성 있는 소재라면 오래된 원천이 새 글로 그대로 나간다.
   *
   * 🔴 스키마는 바꾸지 않는다(컬럼 non-null · migration 금지).
   *    아는 값이면 그 값을 넣고, 모르면 `gateResults` 에 사실을 남겨 읽는 쪽이 `null` 로 돌린다.
   */
  const NOW = new Date('2026-09-22T05:15:00.000Z')
  const OLD = new Date('2026-09-17T00:00:00.000Z')

  check('🔴 🔴 **원천 시각을 알면 그 값을 그대로 쓴다**',
    sourceCapturedAtOf({ sourceCapturedAt: OLD.toISOString() })?.toISOString() === OLD.toISOString())
  check('🔴 🔴 **모르면 `null` 이다 — 오늘로 지어내지 않는다**',
    sourceCapturedAtOf({ sourceCapturedAt: null }) === null
    && sourceCapturedAtOf({}) === null
    && sourceCapturedAtOf({ sourceCapturedAt: '말이 안 되는 값' }) === null)

  const rowWith = (known: boolean, at: Date | null) => ({
    sourceCapturedAt: at,
    gateResults: { autoDraft: { [SOURCE_CAPTURED_KNOWN_KEY]: known } },
  })
  check('🔴 🔴 **안다고 적힌 행은 컬럼 값을 쓴다**',
    capturedAtOfRow(rowWith(true, OLD))?.toISOString() === OLD.toISOString())
  check('🔴 🔴 **모른다고 적힌 행은 `null` 이다 — 적재 시각이 나이가 되지 않는다**',
    capturedAtOfRow(rowWith(false, NOW)) === null)
  check('🔴 표식이 없는 옛 행·사람 후보는 지금 동작 그대로다', (() => {
    const legacy = capturedAtOfRow({ sourceCapturedAt: OLD, gateResults: { autoDraft: {} } })
    const human = capturedAtOfRow({ sourceCapturedAt: OLD })
    return legacy?.toISOString() === OLD.toISOString() && human?.toISOString() === OLD.toISOString()
  })())

  // ── 🔴 실제 신선도 판정까지 이어진다 ──
  const age = (at: Date | null) => ageDaysAt(at, NOW)
  check('🔴 🔴 **모르면 나이가 `null` 이고 판정은 `unknown` 이다**', (() => {
    const a = age(capturedAtOfRow(rowWith(false, NOW)))
    return a === null && freshnessOf({ ageDays: a, topic: 'timely' }) === 'unknown'
  })())
  check('🔴 🔴 **`unknown` 은 자동 발행 대상이 아니다 — 사람 검수로 간다**',
    isAutoPublishable('unknown') === false)
  check('🔴 🔴 **시의성 글의 5일 된 원천은 자동 발행에서 빠진다**', (() => {
    const a = age(capturedAtOfRow(rowWith(true, OLD)))
    const f = freshnessOf({ ageDays: a, topic: 'timely' })
    return a === 5 && f !== 'hot' && (f === 'expired' || !isAutoPublishable(f) || f === 'warm')
  })(), String(freshnessOf({ ageDays: age(capturedAtOfRow(rowWith(true, OLD))), topic: 'timely' })))
  check('🔴 🔴 **앞판 동작이면 같은 원천이 `hot` 으로 통과한다 (회귀 재현)**', (() => {
    /** 🔴 앞판: 컬럼에 적재 시각이 들어가고 표식이 없다 */
    const a = ageDaysAt(NOW, NOW)
    return a === 0 && freshnessOf({ ageDays: a, topic: 'timely' }) === 'hot'
  })())
  check('🔴 🔴 **상시 소재는 막지 않는다 — 오늘 수집분은 그대로 hot**', (() => {
    const a = age(capturedAtOfRow(rowWith(true, new Date(NOW.getTime() - 6 * 3600e3))))
    return a === 0 && isAutoPublishable(freshnessOf({ ageDays: a, topic: 'evergreen' }))
  })())

  // ── 🔴 적재기가 실제로 그 값을 쓰는가 ──
  {
    const src = readFileSync('scripts/micro-seed-supply-autofill.mts', 'utf-8')
    check('🔴 🔴 **적재기가 원천 수집 시각을 먼저 쓴다**',
      /const realCaptured = sourceCapturedAtOf\(c\)/.test(src)
      && /const at = realCaptured \?\?/.test(src))
    const run = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
    check('🔴 🔴 **발행 러너가 정본 함수로 읽는다 — 컬럼을 직접 쓰지 않는다**',
      /capturedAtOfRow\(\{/.test(run)
      && !/\[r\.id, r\.rawContent\?\.sourceCapturedAt \?\? null\]/.test(run))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 🔴 공급 회차 — 6회 · 예산 env 경로 · 못 잡는 것')
// ─────────────────────────────────────────────────────────
{
  const tpl = readFileSync('docs/operations/launchd/com.soransoran.supply-process.plist.template', 'utf-8')
  const hours = [...tpl.matchAll(/<key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer>/g)]
    .map((m) => ({ hour: Number(m[1]), minute: Number(m[2]) }))
  check('🔴 🔴 **정본 회차 수가 템플릿과 같다 — 6회**',
    hours.length === SUPPLY_RUNS_PER_DAY && SUPPLY_RUNS_PER_DAY === 6,
    `템플릿 ${hours.length} · 정본 ${SUPPLY_RUNS_PER_DAY}`)
  check('🔴 🔴 **슬롯 시각도 같다 — 2회라고 부르지 않는다**',
    JSON.stringify(hours) === JSON.stringify(SUPPLY_RUN_SLOTS_KST.map((s) => ({ hour: s.hour, minute: s.minute }))),
    JSON.stringify(hours))
  /**
   * 🔴 **두 번 틀렸던 자리다** (2026-09-22 2차 정정).
   *
   *    1차: "예산 env 가 **없어야** PASS" — 승인받아 넣는 순간 검사가 깨졌다.
   *    2차: "plist 에 들어가야 한다" — **위치가 틀렸다.** 러너는 `loadEnvLocal()` 로
   *         `process.cwd()/.env.local` 을 읽고, plist 의 `WorkingDirectory` 가
   *         runtime 작업트리이며 그곳의 `.env.local` 은 정본 env 파일로 걸린 심볼릭 링크다.
   *         plist 에 넣으면 값이 두 곳으로 갈라진다.
   *
   * 🔴 그래서 지금은 **정본 env 파일**을 본다. 값은 세 개만 읽고 **찍지 않는다** —
   *    같은 파일에 API 키가 있다.
   */
  const envPath = `${process.env.HOME ?? ''}/${SUPPLY_ENV_FILE_REL}`
  const envText = (() => { try { return readFileSync(envPath, 'utf-8') } catch { return null } })()
  const envOf = (k: string): string | null => {
    if (envText === null) return null
    const m = new RegExp(`^${k}=(.*)$`, 'm').exec(envText)
    return m === null ? null : (m[1] ?? '').trim()
  }
  /**
   * 🔴 **CI 러너에는 운영 env 가 없다.** 없다고 FAIL 로 만들면 검사가 CI 에서 늘 빨갛고,
   *    빨간 검사는 곧 지워진다. 그래서 **운영 기계인지 먼저 가른다.**
   *    🔴 다만 조용히 건너뛰지 않는다 — env 가 없으면 **설치본도 없어야 한다.**
   *    (env 없이 설치본만 있으면 그 기계는 예산 없이 도는 것이다.)
   */
  const operatorMachine = envText !== null
  console.log(`     정본 env ${operatorMachine ? '있음 — 운영 기계다' : '없음 — 운영 기계가 아니다(CI 등)'}`)
  const declared = SUPPLY_BUDGET_ENV_NAMES.filter((n) => envOf(n) !== null)
  console.log(`     정본 env 예산 선언 ${declared.length}/${SUPPLY_BUDGET_ENV_NAMES.length}`)
  check('🔴 🔴 **예산 env 는 셋 다이거나 하나도 없다 — 반쪽은 장부가 fail-closed 로 막는다**',
    declared.length === 0 || declared.length === SUPPLY_BUDGET_ENV_NAMES.length,
    `${declared.length}개`)
  check('🔴 🔴 **plist 에는 예산 env 를 넣지 않는다 — 두 곳으로 갈라지지 않게**',
    SUPPLY_BUDGET_ENV_NAMES.every((n) => !tpl.includes(n)),
    SUPPLY_BUDGET_ENV_NAMES.filter((n) => tpl.includes(n)).join(','))
  check('🔴 plist 의 WorkingDirectory 가 저장소라야 그 .env.local 을 읽는다',
    tpl.includes('<key>WorkingDirectory</key>'))


  /** 🔴 설치된 plist — 있으면 정본과 맞아야 한다 */
  const installed = (() => {
    const at = `${process.env.HOME ?? ''}/Library/LaunchAgents/com.soransoran.supply-process.plist`
    try { return { at, text: readFileSync(at, 'utf-8') } } catch { return null }
  })()
  const enabled = envOf(SUPPLY_ENABLE_ENV) === 'true'
  console.log(`     설치된 plist ${installed === null ? '없음' : '있음'} · 스위치 ${enabled ? 'true' : 'false/없음'}`)

  check('🔴 🔴 **정본 env 가 없는 기계에는 설치본도 없다 — 예산 없이 도는 기계를 막는다**',
    operatorMachine || installed === null)

  /** 🔴 승인 전 — 승인값이 없으면 **켜져 있어서는 안 된다**(fail-closed) */
  if (SUPPLY_DAILY_USD_APPROVED === null) {
    check('🔴 🔴 **하루 상한이 미승인이면 공급이 켜져 있지 않다**',
      installed === null && !enabled && declared.length === 0,
      '🔴 미승인인데 예산·스위치·설치본 중 무엇이 있다')
  } else {
    /**
     * 🔴 승인 후 — 값이 있으면 승인값 이하여야 하고, 없으면 아직 안 넣은 것이다.
     *    **둘 다 PASS 다.** 켜는 순간 깨지는 검사를 다시 만들지 않는다.
     */
    check('🔴 승인값은 0 보다 크다', SUPPLY_DAILY_USD_APPROVED > 0)
    if (declared.length === SUPPLY_BUDGET_ENV_NAMES.length) {
      const daily = Number(envOf('SORAN_LLM_DAILY_BUDGET_USD'))
      const cap = Number(envOf('SORAN_LLM_RUN_REQUEST_CAP'))
      const head = Number(envOf('SORAN_LLM_RESERVE_HEADROOM'))
      check('🔴 🔴 **하루 예산이 승인값 이하다**',
        Number.isFinite(daily) && daily <= SUPPLY_DAILY_USD_APPROVED,
        `${daily} / 승인 ${SUPPLY_DAILY_USD_APPROVED}`)
      check('🔴 🔴 **회차 요청 상한이 정본과 같다**',
        cap === SUPPLY_REQUESTS_PER_RUN, `${cap} / 정본 ${SUPPLY_REQUESTS_PER_RUN}`)
      check('🔴 🔴 **여유 배수가 정본과 같고 1 이상이다**',
        head === SUPPLY_RESERVE_HEADROOM && head >= 1, `${head} / 정본 ${SUPPLY_RESERVE_HEADROOM}`)
      check('🔴 🔴 **회차당 원천 × 원천당 요청 = 회차 요청 상한**',
        SUPPLY_WORKSET_PER_RUN * WORKSET_TOTAL_PER_SOURCE === SUPPLY_REQUESTS_PER_RUN,
        `${SUPPLY_WORKSET_PER_RUN}×${WORKSET_TOTAL_PER_SOURCE}`)
      check('🔴 정본 workset 기본값이 회차 계약과 같다',
        WORKSET_DEFAULT_LIMIT === SUPPLY_WORKSET_PER_RUN,
        `${WORKSET_DEFAULT_LIMIT} / ${SUPPLY_WORKSET_PER_RUN}`)
    } else {
      console.log('     🔴 예산 env 가 아직 없다 — 회차는 돌지만 유료 요청은 NO_BUDGET 으로 보류된다')
    }
    /** 🔴 스위치가 켜져 있으면 예산도 있어야 한다 — 돌면서 0건인 상태를 막는다 */
    check('🔴 🔴 **스위치가 켜져 있으면 예산 env 도 있다 — 돌면서 0건을 막는다**',
      !enabled || declared.length === SUPPLY_BUDGET_ENV_NAMES.length)
    check('🔴 🔴 **설치본이 있으면 스위치와 예산이 함께 있다**',
      installed === null || (enabled && declared.length === SUPPLY_BUDGET_ENV_NAMES.length))
  }
  if (installed !== null) {
    check('🔴 설치본도 6회다',
      (installed.text.match(/<key>Hour<\/key>/g) ?? []).length === SUPPLY_RUNS_PER_DAY)
    check('🔴 🔴 **설치본에 비밀값 리터럴이 없다**',
      !/postgresql:\/\/|AIza[0-9A-Za-z_-]{10,}|sk-[0-9A-Za-z]{10,}/.test(installed.text))
    check('🔴 🔴 **설치본에도 예산 env 를 넣지 않는다**',
      SUPPLY_BUDGET_ENV_NAMES.every((n) => !installed.text.includes(n)))
  }
  check('🔴 🔴 **템플릿에 비밀값 리터럴이 없다**',
    !/postgresql:\/\/|AIza[0-9A-Za-z_-]{10,}|sk-[0-9A-Za-z]{10,}/.test(tpl))

  // ── 🔴 🔴 장부가 승인 상한을 실제로 지키는가 ──
  {
    /**
     * 🔴 **$0.30 은 하루 총액이다** — 공급·판정·초안·댓글이 같은 장부를 쓴다.
     *    그날 이미 정산된 액수가 이 상한에 함께 든다. 회차마다 새로 $0.30 이 아니다.
     */
    const limits = {
      dailyUsd: SUPPLY_DAILY_USD_APPROVED,
      runRequestCap: SUPPLY_REQUESTS_PER_RUN,
      headroomMultiplier: SUPPLY_RESERVE_HEADROOM,
    }
    const tally = (o: Partial<DayTally>): DayTally => ({
      settledUsd: 0, openReservedUsd: 0, usageUnknownUsd: 0,
      paidRequests: 0, countTokensRequests: 0, blocked: 0, overruns: 0, ...o,
    })
    const spend = (t: DayTally, usd: number, extra: Partial<Parameters<typeof judgeSpend>[0]> = {}) =>
      judgeSpend({
        limits, tally: t, runPaid: 0, reserve: { known: true, usd, pricingVersion: 'v' },
        ledgerOk: true, settleHold: null, unresolved: [], ...extra,
      })

    check('🔴 여력 안이면 통과한다', spend(tally({ settledUsd: 0.05 }), 0.05).ok === true)
    check('🔴 🔴 **그날 이미 쓴 액수가 상한에 함께 든다 — 회차마다 새로 $0.30 이 아니다**', (() => {
      const v = spend(tally({ settledUsd: 0.28 }), 0.05)
      return !v.ok && v.code === 'DAILY_EXHAUSTED'
    })(), JSON.stringify(spend(tally({ settledUsd: 0.28 }), 0.05)))
    check('🔴 🔴 **열린 예약도 여력에서 뺀다 — 끝나지 않은 요청이 여력을 되돌려 주지 않는다**', (() => {
      const v = spend(tally({ settledUsd: 0.10, openReservedUsd: 0.19 }), 0.05)
      return !v.ok && v.code === 'DAILY_EXHAUSTED'
    })())
    check('🔴 🔴 **끝을 기록하지 못한 예약이 있으면 사람이 마감할 때까지 막는다**', (() => {
      const v = spend(tally({}), 0.01, {
        unresolved: [{
          code: 'ownerGone',
          reason: '주인 프로세스가 없다',
          reservation: { attemptId: 'a1', runId: 'r1', pid: 1, startedAt: '', reservedUsd: 0.01 },
        }] as never,
      })
      return !v.ok && v.code === 'UNRESOLVED_RESERVATION'
    })())
    check('🔴 🔴 **정산을 적지 못한 보류가 있으면 막는다**', (() => {
      const v = spend(tally({}), 0.01, { settleHold: '정산을 적지 못했다' })
      return !v.ok && v.code === 'SETTLE_ERROR'
    })())
    check('🔴 🔴 **실제가 예약을 넘은 건이 있으면 막는다**', (() => {
      const v = spend(tally({ overruns: 1 }), 0.01)
      return !v.ok && v.code === 'UNSETTLED_OVERRUN'
    })())
    check('🔴 🔴 **장부를 못 읽으면 막는다 — 모르면 쓰지 않는다**',
      spend(tally({}), 0.01, { ledgerOk: false }).ok === false)
    check('🔴 🔴 **회차 요청 상한에 닿으면 막는다**', (() => {
      const v = spend(tally({}), 0.01, { runPaid: SUPPLY_REQUESTS_PER_RUN })
      return !v.ok && v.code === 'RUN_CAP'
    })())
    check('🔴 🔴 **예산 env 가 없으면 무제한이 아니라 보류다**', (() => {
      const v = judgeSpend({
        limits: { dailyUsd: null, runRequestCap: null, headroomMultiplier: null },
        tally: tally({}), runPaid: 0, reserve: { known: true, usd: 0.01, pricingVersion: 'v' },
        ledgerOk: true, settleHold: null, unresolved: [],
      })
      return !v.ok && v.code === 'NO_BUDGET'
    })())
    /** 🔴 미상 사용량은 자동으로 풀리지 않는다 — 열린 예약으로 남는다 */
    check('🔴 🔴 **사용량을 모르면 예약을 풀지 않는다 (usageUnknown)**', (() => {
      const r = judgeSettle({ reservedUsd: 0.01, cost: { known: false, code: 'NO_USAGE', reason: '' } })
      return r.status === 'usageUnknown' && r.settledUsd === null
    })())
    /** 🔴 접은 장부에서 미상은 열린 예약에 들어간다 */
    check('🔴 🔴 **미상 사용량이 여력을 되돌려 주지 않는다**', (() => {
      const t = tallyOf([
        { attemptId: 'a', runId: 'r', stage: 'judge', status: 'usageUnknown',
          reservedUsd: 0.25, settledUsd: null, model: 'm', pricingVersion: 'v' },
      ] as never)
      return t.openReservedUsd === 0.25 && t.usageUnknownUsd === 0.25
        && spend(t, 0.1).ok === false
    })())
    check('🔴 🔴 **한 attemptId 의 마지막 줄이 이긴다 — 예약과 정산을 두 번 세지 않는다**', (() => {
      const t = tallyOf([
        { attemptId: 'a', runId: 'r', stage: 'judge', status: 'settled',
          reservedUsd: 0.02, settledUsd: 0.007, model: 'm', pricingVersion: 'v' },
      ] as never)
      return t.settledUsd === 0.007 && t.openReservedUsd === 0 && t.paidRequests === 1
    })())
  }

  check('🔴 🔴 **노트북 종료 한계를 출력한다**',
    describeSupplySchedule().includes('노트북 종료')
    && SUPPLY_UNDETECTED_LIMITS.some((x) => x.includes('catch-up 이 없다')))
  check('🔴 템플릿이 RunAtLoad=false 다 — 꺼진 시각은 건너뛴다',
    /<key>RunAtLoad<\/key>\s*<false\/>/.test(tpl))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 🔴 후보 수 ≠ 사람 검토 후 READY 순증가')
// ─────────────────────────────────────────────────────────
{
  const noRuns = judgeProductionRate(
    { candidates: 3, readyNetByCode: {}, scheduledRuns: 0 }, 2)
  check('🔴 🔴 **정기 회차 전에는 생산율이 unmeasured 다 — 0 이 아니다**',
    noRuns.readyNetPerDay === null && noRuns.candidatesPerDay === null
    && noRuns.note.includes('unmeasured'))
  const ran = judgeProductionRate(
    { candidates: 12, readyNetByCode: { P03: 2, P08: 1 }, scheduledRuns: 12 }, 2)
  check('🔴 🔴 **두 값을 따로 낸다 — 후보 6/day · READY 1.5/day**',
    ran.candidatesPerDay === 6 && ran.readyNetPerDay === 1.5 && ran.distinctSpeakers === 2,
    `${ran.candidatesPerDay}/${ran.readyNetPerDay}/${ran.distinctSpeakers}`)
  check('🔴 화자 수를 함께 센다 — D3 는 서로 다른 3명이 필요하다',
    judgeProductionRate({ candidates: 9, readyNetByCode: { P01: 3 }, scheduledRuns: 6 }, 1)
      .distinctSpeakers === 1)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 🔴 댓글 ⑧ — 축 이름만 남기고 본문은 남기지 않는다')
// ─────────────────────────────────────────────────────────
{
  const src = readFileSync('scripts/persona-comment-queue.mts', 'utf-8')
  check('🔴 🔴 **차단 기록에 축 이름(detail)이 실린다**',
    /gate: g\.gate, outcome: g\.outcome, detail: g\.detail/.test(src))
  check('🔴 🔴 **본문을 싣지 않는다**',
    !/candidateText|text: text|body: text/.test(src.slice(src.indexOf('gates: verdict.gates.map'), src.indexOf('gateStatus: verdict.status'))))
  /**
   * 🔴 **주석이 아니라 판정을 돌려 본다.** "본문을 안 담는다" 는 주석은
   *    코드가 담기 시작해도 그대로 남는다 — 실제 출력에서 확인한다.
   */
  const BODY = '무릎이 시큰거려서 계단이 무섭습니다 · 정형외과를 가야 할까요'
  const v = checkVoiceFingerprint(BODY, { tidyMarks: true, seedUseCount: 4 })
  check('🔴 축 이름이 남는다 — TIDY · SEED_REUSE', (() => {
    const a = new Set(v.axes)
    return a.has('TIDY') && a.has('SEED_REUSE')
  })(), v.axes.join(','))
  check('🔴 🔴 **판정 detail 에 본문 조각이 하나도 없다**', (() => {
    /** 🔴 본문의 모든 3자 조각을 넣어 본다 — 한 조각이라도 새면 잡힌다 */
    const flat = BODY.replace(/\s+/g, '')
    for (let i = 0; i + 3 <= flat.length; i++) {
      if (v.detail.includes(flat.slice(i, i + 3))) return false
    }
    return true
  })(), v.detail)
  check('🔴 표본이 모자라면 반복 축을 재지 않았다고 적는다 — 0 이라고 하지 않는다',
    v.detail.includes('반복 축 미실행'), v.detail)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 🔴 자동 READY 시험 계약 — 사람 승인이 최종 상태가 아니다')
// ─────────────────────────────────────────────────────────
{
  check('🔴 🔴 **표본 30건 · 무수정 정확도 90% · 중대 결함 0**',
    AUTO_READY_CONTRACT.reviewSampleMin === 30
    && AUTO_READY_CONTRACT.noEditAccuracyMin === 0.90
    && AUTO_READY_CONTRACT.hardDefectMax === 0)
  check('🔴 🔴 **경고 없는 글만 대상이다**', AUTO_READY_CONTRACT.eligible === 'warningsZero')
  check('🔴 열어도 표본 감사를 계속한다', AUTO_READY_CONTRACT.sampledAuditRatio > 0)
  check('🔴 🔴 **표본 없이 정확도를 말하지 않는다는 순서가 적혀 있다**',
    AUTO_READY_STEPS.some((s) => s.includes('표본 없이 정확도를 말하지 않는다')))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0 · 등록 0 · 변수 변경 0\n')
if (fail > 0) process.exit(1)
