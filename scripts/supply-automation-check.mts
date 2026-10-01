#!/usr/bin/env tsx
/**
 * 공급 자동화 계약 **행동 검사** — 🔴 DB 0 · 네트워크 0 · LLM 0 · 파일 write 0
 *
 * 🔴 **이 검사가 잠그는 것은 "자동화됐다" 는 말이 아니다.**
 *    무엇이 되고 무엇이 안 되는지를 값으로 고정한다 — 특히 안 되는 것을.
 */
import { readFileSync } from 'node:fs'

import { resolveScale } from '../src/lib/scale-runtime'
import { PROFILES } from '../src/lib/scale-profile'
import { prepareCandidates } from '../src/lib/supply-candidates'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import {
  SUPPLY_RUNS_PER_DAY, SUPPLY_RUN_SLOTS_KST, SUPPLY_BUDGET_ENV_NAMES,
  SUPPLY_DAILY_USD_APPROVED, SUPPLY_UNDETECTED_LIMITS, SUPPLY_REQUESTS_PER_RUN,
  SUPPLY_WORKSET_PER_RUN, SUPPLY_RESERVE_HEADROOM, SUPPLY_ENV_FILE_REL, SUPPLY_ENABLE_ENV,
  SUPPLY_JUDGE_REQUESTS_PER_RUN, SUPPLY_DRAFT_REQUESTS_PER_RUN, estimateSupplySpend,
  judgeProductionRate, AUTO_READY_CONTRACT, AUTO_READY_STEPS, describeSupplySchedule,
} from '../src/lib/supply-schedule-contract'
import {
  WORKSET_DEFAULT_LIMIT, WORKSET_MAX_LIMIT, WORKSET_STAGE_PER_SOURCE, WORKSET_TOTAL_PER_SOURCE,
  judgeStageBudget, resolveWorksetLimit,
} from '../src/lib/supply-workset'
import {
  FILL_ROUND_CAP, fillUpToOf, planBoundedCommonPhase, planCarryOverFill, type Pending,
} from '../src/lib/supply-process'
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
import { markedStageEnv } from './lib/stage-decision-fixture'

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

  /** 🔴 화자 제약 — 발행 계획(정본 `prepareCandidates`)이 여전히 P08 에게만 준다 */
  const START = new Date(Date.UTC(2026, 8, 22, 15, 0))
  const cand = (speaker: string): QueueCandidate => ({
    queueId: after.id, title: after.title, body: after.body,
    gateVerdict: 'PASS', createdAt: 0, assignedPersonaCode: null,
    gateResults: fakeEvidenceGate(START, { id: after.id }),
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
  const d3 = PROFILES.d3
  const caps = { postsPerWeek: d3.postsPerWeek, minDaysBetween: d3.minDaysBetween }
  const assignedOf = (personas: PersonaForMatch[]): string | null => {
    const prep = prepareCandidates({ candidates: [cand('P08')], personas, caps, at: START })
    return prep.batch.assignments.find((x) => x.queueId === after.id)?.assigned ?? null
  }
  check('🔴 🔴 **고친 글도 원래 화자에게만 간다 — P08**',
    assignedOf([personaOf('P08'), personaOf('P02')]) === 'P08', String(assignedOf([personaOf('P08'), personaOf('P02')])))
  check('🔴 🔴 **그 화자가 없으면 나가지 않는다 — 남의 이름을 붙이지 않는다**',
    assignedOf([personaOf('P02')]) === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 (2026-09-30) 기간형(window) · 하루 canary 경로는 지웠다 — 단계는 StageDecision 하나')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 앞판 ② · ②-w · ②-d5 는 `SORAN_RELEASE_WINDOW_*` 기간 허가와 하루 canary 가 겹치는 날을 잠갔다.
   *    그 권위를 지웠으므로 여기서는 **그 키가 죽은 입력인지**만 본다. 하루 보호장치(`judgeDayGuard`)는
   *    `release:canary-check` ② 가, 단계 결정은 `stage:scheduler-check` 가 본다.
   */
  const base = markedStageEnv({ SORAN_CAPACITY_STAGE: 'd3', SORAN_RELEASE_STAGE: 'd1' })
  const withWindow = { ...base, SORAN_RELEASE_WINDOW_STAGE: 'd3', SORAN_RELEASE_WINDOW_FROM: '2026-09-23', SORAN_RELEASE_WINDOW_UNTIL: '2026-09-26',
    SORAN_RELEASE_CANARY_STAGE: 'd5', SORAN_RELEASE_CANARY_DATE: '2026-09-23' }
  check('🔴 🔴 **기간 · canary 키를 실어도 공개 단계는 결정 env(d1) 그대로**',
    resolveScale(withWindow as NodeJS.ProcessEnv).releaseStage === 'd1' && resolveScale(base as NodeJS.ProcessEnv).releaseStage === 'd1')
  const runtimeSrc = readFileSync('src/lib/scale-runtime.ts', 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  check('🔴 규모 해석이 기간 · canary 키를 읽지 않는다', !/WINDOW|CANARY/.test(runtimeSrc))
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
      /**
       * 🔴 **env 상한은 손으로 부른 단독 실행의 상한이다** (2026-09-28). 공급 러너의 자식은 이 값을 보지 않는다 —
       *    단계 env(judge 10 · draft 30)가 덮는다(아래 ③-b 가 실제 계획으로 본다). 그래서 **정본 합 이하의 양의 정수**면 된다.
       *    🔴 운영 값(20)을 이 PR 이 바꾸지 않는다.
       */
      check('🔴 🔴 **env 회차 요청 상한은 양의 정수이고 정본 합 이하다 — 무제한이 아니다**',
        Number.isInteger(cap) && cap > 0 && cap <= SUPPLY_REQUESTS_PER_RUN, `${cap} / 정본 합 ${SUPPLY_REQUESTS_PER_RUN}`)
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
    /**
     * 🔴 **장부는 env 값으로 막는다** — 운영 env 는 $0.30 (계약 천장 $0.50 이하, 2026-09-28).
     *    아래 사례의 금액(0.28 · 0.19 …)은 그 운영 값 기준이다.
     */
    const OPERATING_DAILY_USD = 0.30
    const limits = {
      dailyUsd: OPERATING_DAILY_USD,
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
console.log('\n③-b 🔴 🔴 회차 상한 정합 — 묶음 10 · judge 10 · draft 30 · 합 40 · 적재 10 (CI 에서도 돈다)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **앞판은 이 대조를 운영 env 가 있을 때만 했다** — CI 에서는 상수끼리 어긋나도 초록이었다.
   *    이제 어디서나 돈다. 하나라도 어긋나면(예: judge 10 인데 draft 15 · 합 20) 여기서 깨진다.
   */
  check('🔴 🔴 **묶음 크기 — 계약 · 기본값 · 천장이 모두 10**',
    SUPPLY_WORKSET_PER_RUN === 10 && WORKSET_DEFAULT_LIMIT === SUPPLY_WORKSET_PER_RUN
    && WORKSET_MAX_LIMIT === SUPPLY_WORKSET_PER_RUN && resolveWorksetLimit([]) === SUPPLY_WORKSET_PER_RUN,
    `${SUPPLY_WORKSET_PER_RUN}/${WORKSET_DEFAULT_LIMIT}/${WORKSET_MAX_LIMIT}`)
  const b = judgeStageBudget(SUPPLY_WORKSET_PER_RUN)
  check('🔴 🔴 **정본 계산(judgeStageBudget) = 계약 상수 — judge 10 · draft 30 · 합 40**',
    b.ok && b.perStage.judge === SUPPLY_JUDGE_REQUESTS_PER_RUN && b.perStage.draft === SUPPLY_DRAFT_REQUESTS_PER_RUN
    && b.total === SUPPLY_REQUESTS_PER_RUN
    && SUPPLY_JUDGE_REQUESTS_PER_RUN === 10 && SUPPLY_DRAFT_REQUESTS_PER_RUN === 30 && SUPPLY_REQUESTS_PER_RUN === 40,
    b.ok ? `${b.perStage.judge}/${b.perStage.draft}/${b.total}` : b.reason)
  check('🔴 🔴 **단계 합 = 회차 합 · 원천당 1+3=4**',
    SUPPLY_JUDGE_REQUESTS_PER_RUN + SUPPLY_DRAFT_REQUESTS_PER_RUN === SUPPLY_REQUESTS_PER_RUN
    && SUPPLY_WORKSET_PER_RUN * WORKSET_TOTAL_PER_SOURCE === SUPPLY_REQUESTS_PER_RUN
    && SUPPLY_WORKSET_PER_RUN * WORKSET_STAGE_PER_SOURCE.judge === SUPPLY_JUDGE_REQUESTS_PER_RUN
    && SUPPLY_WORKSET_PER_RUN * WORKSET_STAGE_PER_SOURCE.draft === SUPPLY_DRAFT_REQUESTS_PER_RUN)
  check('🔴 🔴 **천장 위(11 · 100)는 실행 전에 거부 — 무제한 호출 없음**',
    !judgeStageBudget(SUPPLY_WORKSET_PER_RUN + 1).ok && !judgeStageBudget(100).ok
    && resolveWorksetLimit([`--workset-limit=${SUPPLY_WORKSET_PER_RUN + 1}`]) === -1)

  /** 🔴 러너가 실제로 만드는 계획 — 단계 env 와 적재 상한을 값으로 본다 */
  const pending: Pending = { rawCafe: {}, thin: {}, detail: ['a.detail.jsonl'], shadow: [], candidates: ['x.candidates.json'] }
  const policy = { llm: true, fill: true, upTo: 700, reason: '' }
  const carry = ['/d/auto-draft-a.candidates.json', '/d/auto-draft-b.candidates.json', '/d/auto-draft-c.candidates.json']
  const plans = b.ok ? planBoundedCommonPhase(pending, policy, { kind: 'ready', snapshotPath: '/d/s.json', runId: 'R' }, {
    manifestPath: '/d/w.json', shadowPath: '/d/s.shadow.jsonl', candidatesPath: '/d/c.candidates.json',
    limit: SUPPLY_WORKSET_PER_RUN, perStage: b.perStage, carryOverPaths: carry,
  }) : []
  const of = (st: string) => plans.find((p) => p.stage === st)
  check('🔴 🔴 **러너 단계 env — judge 10 · draft 30 (자식에게만 · 장부 id 가 단계별)**',
    of('judge')?.env?.SORAN_LLM_RUN_REQUEST_CAP === String(SUPPLY_JUDGE_REQUESTS_PER_RUN)
    && of('draft')?.env?.SORAN_LLM_RUN_REQUEST_CAP === String(SUPPLY_DRAFT_REQUESTS_PER_RUN),
    `${of('judge')?.env?.SORAN_LLM_RUN_REQUEST_CAP}/${of('draft')?.env?.SORAN_LLM_RUN_REQUEST_CAP}`)
  check('🔴 🔴 **모델 단계는 모두 요청 상한 env 를 받는다 — 상한 없는 유료 단계가 없다**',
    plans.filter((p) => p.llm).length === 2
    && plans.filter((p) => p.llm).every((p) => Number.isInteger(Number(p.env?.SORAN_LLM_RUN_REQUEST_CAP))
      && Number(p.env?.SORAN_LLM_RUN_REQUEST_CAP) > 0))
  check('🔴 🔴 **적재 — 버퍼 700 · 이월 3파일이 있어도 --up-to=10 (회차 천장)**',
    FILL_ROUND_CAP === SUPPLY_WORKSET_PER_RUN
    && of('fill')?.args.filter((a) => a.startsWith('--up-to=')).join() === `--up-to=${SUPPLY_WORKSET_PER_RUN}`
    && (of('fill')?.args.find((a) => a.startsWith('--input='))?.split(',').length ?? 0) === 4,
    of('fill')?.args.join(' '))
  check('🔴 🔴 **새 묶음 없는 회차의 이월 적재도 10 을 넘지 않는다 — 묶음 크기를 크게 줘도**',
    planCarryOverFill(policy, carry, SUPPLY_WORKSET_PER_RUN)[0]?.args.includes(`--up-to=${SUPPLY_WORKSET_PER_RUN}`) === true
    && planCarryOverFill(policy, carry, 50)[0]?.args.includes(`--up-to=${FILL_ROUND_CAP}`) === true
    && fillUpToOf(700, 50) === FILL_ROUND_CAP && fillUpToOf(3, 10) === 3 && fillUpToOf(0, 10) === 0)
  {
    const runner = readFileSync('scripts/supply-process.mts', 'utf-8')
    const tplP = readFileSync('docs/operations/launchd/com.soransoran.supply-process.plist.template', 'utf-8')
    check('🔴 러너가 정본 해석(resolveWorksetLimit)과 예산 거부를 쓴다',
      /const WORKSET_LIMIT = resolveWorksetLimit\(process\.argv\.slice\(2\)\)/.test(runner)
      && /const budget = judgeStageBudget\(WORKSET_LIMIT\)[\s\S]{0,120}if \(!budget\.ok\)/.test(runner))
    check('🔴 🔴 **launchd 템플릿은 --workset-limit 를 덮어쓰지 않는다 — 계약 기본값(10)이 돈다**',
      !tplP.includes('--workset-limit') && /<string>--live<\/string>/.test(tplP))
    check('🔴 설명 문구가 10 · 40 · judge 10 · draft 30 을 말한다',
      describeSupplySchedule().includes('회차당 원천 10 · 요청 40 (judge 10 · draft 30)'))
  }

  // ── 🔴 하루 비용 — 계약 천장 $0.50 · 운영 env 0.30 ──
  const e10 = estimateSupplySpend(SUPPLY_WORKSET_PER_RUN)
  const e5 = estimateSupplySpend(5)
  console.log(`     실측 단가 추정 — 묶음 5: 회차 $${e5.expectedPerRun.toFixed(4)} · 하루 $${e5.expectedPerDay.toFixed(4)}`
    + `  |  묶음 10: 회차 $${e10.expectedPerRun.toFixed(4)} · 하루 $${e10.expectedPerDay.toFixed(4)}`
    + ` · 상한 전부 사용 시 회차 $${e10.capPerRun.toFixed(4)} · 하루 $${e10.capPerDay.toFixed(4)}`)
  check('🔴 🔴 **계약 천장은 $0.50 — 운영 env 는 그 이하여야 한다(지금 0.30)**',
    SUPPLY_DAILY_USD_APPROVED === 0.50)
  check('🔴 🔴 **묶음 10 의 실측 기대 하루 지출이 천장 안이다** (공급만 · 장부는 댓글과 함께 쓴다)',
    SUPPLY_DAILY_USD_APPROVED !== null && e10.expectedPerDay <= SUPPLY_DAILY_USD_APPROVED
    && Math.abs(e10.expectedPerRun - 2 * e5.expectedPerRun) < 1e-9, `$${e10.expectedPerDay.toFixed(4)}`)
  {
    /**
     * 🔴 **0.30 에서는 늦은 회차가 막힐 수 있다** — 장부가 fail-closed 로 막는 것을 값으로 본다.
     *    상한을 전부 쓰는 회차 둘이면 0.30 을 넘는다. 0.50 이었다면 세 번째 회차 첫 요청까지 들어간다.
     */
    const limits = (daily: number) => ({ dailyUsd: daily, runRequestCap: SUPPLY_JUDGE_REQUESTS_PER_RUN, headroomMultiplier: 1.2 })
    const t = (settled: number): DayTally => ({
      settledUsd: settled, openReservedUsd: 0, usageUnknownUsd: 0, paidRequests: 0, countTokensRequests: 0, blocked: 0, overruns: 0,
    })
    const req = { known: true as const, usd: 0.005, pricingVersion: 'v' }
    const at30 = judgeSpend({ limits: limits(0.30), tally: t(2 * e10.capPerRun), runPaid: 0, reserve: req, ledgerOk: true, settleHold: null, unresolved: [] })
    const at50 = judgeSpend({ limits: limits(0.50), tally: t(2 * e10.capPerRun), runPaid: 0, reserve: req, ledgerOk: true, settleHold: null, unresolved: [] })
    check('🔴 🔴 **운영 0.30 — 상한을 다 쓴 회차 둘 뒤 다음 요청은 DAILY_EXHAUSTED (fail-closed)**',
      !at30.ok && at30.code === 'DAILY_EXHAUSTED' && at50.ok, `${JSON.stringify(at30)}`)
    check('🔴 기대 지출이면 0.30 에서도 6회가 들어간다 (공급만 볼 때) — 다른 사용량이 있으면 늦은 회차부터 막힌다',
      e10.expectedRunsWithin(0.30) === SUPPLY_RUNS_PER_DAY && estimateSupplySpend(SUPPLY_WORKSET_PER_RUN).capPerDay > 0.30,
      `${e10.expectedRunsWithin(0.30)}회`)
  }
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
