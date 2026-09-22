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
  WINDOW_STAGE_ENV, WINDOW_FROM_ENV, WINDOW_UNTIL_ENV, WINDOW_MAX_DAYS,
} from '../src/lib/release-canary'
import { resolveScale } from '../src/lib/scale-runtime'
import { PROFILES, RELEASE_STAGES, type StageVerdict } from '../src/lib/scale-profile'
import { forecastPublishing } from '../src/lib/supply-capacity-forecast'
import {
  SUPPLY_RUNS_PER_DAY, SUPPLY_RUN_SLOTS_KST, SUPPLY_BUDGET_ENV_NAMES,
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_DAILY_USD_PROPOSED, SUPPLY_UNDETECTED_LIMITS,
  judgeProductionRate, AUTO_READY_CONTRACT, AUTO_READY_STEPS, describeSupplySchedule,
} from '../src/lib/supply-schedule-contract'
import {
  profileOf, selectAutoTargets, voiceInputOf, judgeApply,
  AUTO_GATE_VERDICT, MACHINE_REVIEWED_BY, type AutoRow,
} from '../src/lib/original-post-auto-publish'
import { reviewPatchOf } from '../src/lib/original-post-machine-review'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { checkVoiceFingerprint } from './lib/persona-gate-78.mjs'
import {
  MACHINE_PROFILE, MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX,
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
    check(`🔴 🔴 **${n}건 낸 뒤에도 그날 단계는 d3 로 고정된다**`,
      r.releaseStage === 'd3' && r.notes.some((x) => x.includes('고정')),
      `${r.releaseStage}`)
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
    promptVersion: 'human-curated-v1', model: 'human', matchedPersonaId: 'p',
    sourceSite: 'founder-curated:x', title: 't', body: 'b',
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
  check('🔴 🔴 **지금 템플릿에는 예산 env 가 없다 — 등록 전에 넣어야 한다**',
    SUPPLY_BUDGET_ENV_NAMES.every((n) => !tpl.includes(n)),
    SUPPLY_BUDGET_ENV_NAMES.filter((n) => tpl.includes(n)).join(','))
  check('🔴 🔴 **$0.30 은 미승인 제안값이다**',
    SUPPLY_DAILY_USD_APPROVED === null && SUPPLY_DAILY_USD_PROPOSED === 0.30)
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
