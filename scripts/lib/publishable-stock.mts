/**
 * 🔴 **운영 재고 조립은 한 곳이다** (2026-09-24 마스터 지적)
 *
 *   앞판 `stage:probe` 는 APPROVED·미발행 223건을 **전부 `profile:'human'` 으로
 *   하드코딩**해 재고로 넣었다. 그래서 d5 지속 READY 가 나왔다.
 *   같은 시각 배포된 발행 러너의 실제 결과는 **최종 발행 가능 0건** 이었다:
 *   ```
 *   대기열 223 → profile 불일치 214 · 사람 미검토 기계 후보 5 · gate 탈락 3 → 적격 1
 *   남은 1건은 TTL 만료 → 발행 가능 0
 *   ```
 *   축약 조립은 실제보다 강했고, 그 위에서 만든 판정은 거짓이었다.
 *
 * 🔴 **그래서 러너와 probe 가 이 함수 하나를 쓴다.** select · AutoRow 조립 ·
 *    `selectAutoTargets` · 안전 재판정 · QueueCandidate 조립 · TTL · Persona 배정이
 *    전부 여기 있다. 호출부에서 다시 조립하지 않는다.
 *
 * 🔴 읽기만 한다 — DB write 0.
 */
import type { PrismaClient } from '@prisma/client'

import {
  selectAutoTargets, voiceInputOf, profileOf, machineReviewedByHuman, pickPublishTarget,
  type AutoRow, type Reject, type RejectCode,
} from '../../src/lib/original-post-auto-publish'
import { authoritativeGate } from '../../src/lib/auto-ready-repo'
import { prepareCandidates } from '../../src/lib/supply-candidates'
import type { HoldReason } from '../../src/lib/supply-freshness'
import {
  releaseCapsOf, PROFILES, RELEASE_STAGES,
  type ReleaseStage,
} from '../../src/lib/scale-profile'
// 🔴 `installFromEnv` 를 쓰지 않는다 — 그것은 module-global 을 바꾼다(아래 주석)
import { resolveScale } from '../../src/lib/scale-runtime'
import { stageVerdicts, simulateStage } from '../../src/lib/scale-readiness'
import {
  canaryAuthorization, judgeOneDayCanary, slotsLeftToday, windowAuthorization,
} from '../../src/lib/release-canary'
import { safetyFilter } from './micro-seed-safety-filter.mjs'
import { PERSONA_FOR_MATCH_SELECT, personaForMatchOf, judgeAutoAssignment } from '../../src/lib/persona-for-match'
import type { PersonaForMatch } from '../../src/lib/original-post-persona-match'
import { AUTO_DECIDER } from '../../src/lib/auto-ready-v2'
import type { QueueCandidate } from '../../src/lib/supply-candidates'

export type LoadedStock = {
  /** 대기열 전체 (APPROVED·EDITED · 미발행) */
  queueTotal: number
  /** 🔴 `selectAutoTargets` 를 통과한 자동 발행 후보 */
  targets: AutoRow[]
  /** 🔴 정본 `selectAutoTargets` 가 낸 제외 목록 그대로 — 러너가 그대로 소비한다 */
  rejected: Reject[]
  /** 제외 사유별 개수 — 값이다 */
  rejectedByCode: { code: string; count: number; ids: string[] }[]
  /** 정본과 같은 모양의 후보 — 여기서 profile 을 하드코딩하지 않는다 */
  queueCandidates: QueueCandidate[]
  /**
   * 🔴 **실제로 기계가 만든 행 수** — `decidedBy` 가 `machine:` 으로 시작한다.
   *    이것이 "기계가 만든 후보" 다.
   */
  machineDecided: number
  /**
   * 🔴 **machine profile 로 유효하게 분류된 행 수** — `profileOf(row) === 'machine'`.
   *    promptVersion·model·출처·gateResults 가 기계 계약에 맞는다는 뜻이지,
   *    그 행을 기계가 만들었다는 뜻이 **아니다**. 사람이 손으로 넣어도 여기 들어온다.
   *
   * 🔴 앞판은 이 값 하나를 `machineCandidates` 라 부르며 "기계가 만든 후보" 로
   *    보고했다(2026-09-24 마스터 지적). 두 수는 같지 않다 — 따로 낸다.
   */
  machineProfiled: number
  /** 🔴 사람이 검토를 마친 행 수 */
  humanReviewed: number
  personas: Record<string, unknown>[]
  history: { code: string; matchedAts: Date[] }[]
  publishedToday: number
  /** 🔴 이미 배정된 행을 code 로 바꾸는 표 — 러너가 쓰던 것과 같다 */
  codeOfPersonaId: Map<string, string>
  /**
   * 🔴 **셀렉터가 거른 행까지 포함한 전체 행** (2026-09-25 · auto-ready-v2).
   *    자동 READY 그림자 판정은 `HUMAN_REVIEW_REQUIRED` 로 거른 기계 후보를 봐야 한다.
   *    다시 읽으면 두 번째 조립이 생기므로 여기서 같이 돌려준다. 러너는 쓰지 않는다.
   */
  allRows: AutoRow[]
  /** 원천 수집 시각 — `queueCandidateOf` 가 쓴다 */
  capturedAtOf: Map<string, Date | null>
  /**
   * 🔴 **기존 배정 자동 행 → 그 Persona 의 지금 상태(자기 배정 제외)** (2026-09-25 마스터 P0).
   *    발행 트랜잭션과 같은 조립(`personaForMatchOf(…, { excludeQueueId })`)이다.
   *    Persona 가 없으면 `null`. 상한은 여기서 모른다(규모가 이 재고로 정해진다) —
   *    판정은 상한을 받는 `planPublishBatch` 가 `judgeAutoAssignment` 로 한다.
   */
  pinnedAutoPersona: Map<string, PersonaForMatch | null>
}

/**
 * 🔴 **한 행 → 계획 입력 — 매핑은 여기 하나다** (2026-09-25).
 *    실제 재고(`queueCandidates`)와 자동 READY 그림자 재고가 **같은 함수**로 만들어진다.
 *    둘이 따로 조립하면 그림자 판정이 실제보다 강해진다.
 */
export function queueCandidateOf(
  t: AutoRow, order: number,
  codeOfPersonaId: ReadonlyMap<string, string>,
  capturedAt: Date | null,
): QueueCandidate {
  return {
    queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: order,
    assignedPersonaCode: t.matchedPersonaId === null
      ? null
      : (codeOfPersonaId.get(t.matchedPersonaId) ?? `__unknown:${t.matchedPersonaId}`),
    ...voiceInputOf(t),
    capturedAt,
  }
}

const kstDayStart = (now: Date): Date => {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000)
}

/**
 * 🔴 **발행 러너와 똑같이 읽고 똑같이 조립한다.**
 *    바꾸려면 이 한 곳을 바꾼다 — 그러면 러너와 probe 가 함께 바뀐다.
 */
export async function loadPublishableStock(
  prisma: PrismaClient, now: Date,
  /** 🔴 자동 READY 가 열려 있는가 — 부르는 쪽이 판정해 넘긴다. **기본 닫힘** */
  opts: { autoReadyOpen?: boolean } = {},
): Promise<LoadedStock> {
  const raw = await prisma.originalPostApprovalQueue.findMany({
    where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
    select: {
      id: true, status: true, createdPostId: true, gateVerdict: true,
      promptVersion: true, model: true, matchedPersonaId: true,
      draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
      gateResults: true, decidedBy: true, decidedAt: true, createdAt: true, editDiff: true, updatedAt: true,
      rawContent: { select: { sourceSite: true, sourceCapturedAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const rows: AutoRow[] = raw.map((r) => ({
    id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
    promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
    gateResults: r.gateResults,
    title: r.editedTitle ?? r.draftTitle,
    body: r.editedBody ?? r.draftBody,
    sourceSite: r.rawContent.sourceSite,
    draftTitle: r.draftTitle, editedTitle: r.editedTitle,
    decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt, editDiff: r.editDiff, updatedAt: r.updatedAt,
  }))

  // 🔴 안전 재판정 — 저장된 값을 믿지 않는다. 러너와 **같은 함수**다
  const { targets, rejected } = selectAutoTargets(
    rows, (t, b) => safetyFilter({ title: t, body: b }).verdict,
    { autoReadyOpen: opts.autoReadyOpen === true },
  )
  const byCode = new Map<string, string[]>()
  for (const r of rejected) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r.id])
  const rejectedByCode = [...byCode]
    .map(([code, ids]) => ({ code, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count)

  const capturedAtOf = new Map(raw.map((r) => [r.id, r.rawContent?.sourceCapturedAt ?? null]))

  const personaRows = await prisma.persona.findMany({
    where: { status: 'active' }, select: PERSONA_FOR_MATCH_SELECT,
  })
  const codeOfPersonaId = new Map(personaRows.map((r) => [r.id, r.code]))
  /**
   * 🔴 **조립은 `personaForMatchOf` 하나다** (2026-09-25). 발행 트랜잭션도 자동 행 배정 때
   *    같은 함수로 Persona 를 다시 조립한다 — 계획할 때와 쓸 때의 판정이 갈리지 않는다.
   */
  const personas: Record<string, unknown>[] = []
  for (const r of personaRows) personas.push(await personaForMatchOf(prisma, r, now) as unknown as Record<string, unknown>)

  /**
   * 🔴 **기존 배정 자동 행은 그 Persona 를 자기 배정을 빼고 다시 조립한다** (2026-09-25 마스터 P0).
   *    위 `personas` 는 Persona 당 한 번 조립한 값이라 **자기 배정도 센다** — 그대로 판정하면
   *    정상 행이 자기 `matchedAt` 으로 WEEKLY_CAP·TOO_SOON 이 된다. 비활성 Persona 도 읽는다.
   */
  const pinnedAutoPersona = new Map<string, PersonaForMatch | null>()
  for (const t of targets) {
    if ((t.decidedBy ?? '').trim() !== AUTO_DECIDER || t.matchedPersonaId === null) continue
    const pr = await prisma.persona.findUnique({ where: { id: t.matchedPersonaId }, select: PERSONA_FOR_MATCH_SELECT })
    pinnedAutoPersona.set(t.id, pr === null ? null : await personaForMatchOf(prisma, pr, now, { excludeQueueId: t.id }))
  }

  /** 🔴 말투·profile 은 정본 `voiceInputOf` 가 만든다 — 여기서 하드코딩하지 않는다 */
  const queueCandidates: QueueCandidate[] = targets.map((t, i) =>
    queueCandidateOf(t, i, codeOfPersonaId, capturedAtOf.get(t.id) ?? null))

  const historyRows = await prisma.personaActivityLog.findMany({
    where: { kind: 'post' }, select: { createdAt: true, persona: { select: { code: true } } },
  })
  const history = personas.map((p) => ({
    code: String(p.code),
    matchedAts: historyRows.filter((l) => l.persona?.code === p.code).map((l) => l.createdAt),
  }))
  const publishedToday = await prisma.personaActivityLog.count({
    where: { kind: 'post', createdAt: { gte: kstDayStart(now) } },
  })

  /**
   * 🔴 **사람 검토는 정본 계약으로 센다** (2026-09-24 마스터 지적).
   *    임의의 non-machine 문자열을 사람 검토로 세면 `null`·모르는 값까지 사람이 본 것이 된다.
   */
  const machineDecided = rows.filter((r) => (r.decidedBy ?? '').startsWith('machine:')).length
  const machineProfiled = rows.filter((r) => profileOf(r) === 'machine').length
  const humanReviewed = rows.filter((r) => machineReviewedByHuman(r.decidedBy)).length

  return {
    queueTotal: rows.length, targets, rejected, rejectedByCode, queueCandidates,
    machineDecided, machineProfiled, humanReviewed, personas, history, publishedToday,
    codeOfPersonaId, allRows: rows, capturedAtOf, pinnedAutoPersona,
  }
}

/**
 * 🔴 **재고를 단계로 나눈다** (2026-09-24 마스터 지적).
 *    `targets.length` 를 "실제 발행 가능 재고" 라고 부르지 않는다 —
 *    TTL·배정을 거쳐야 그날 낼 수 있는 수가 나온다.
 */
/**
 * 🔴 **발행 상한도 한 곳에서 만든다.** 러너와 probe 가 각자 계산하면
 *    같은 단계인데 다른 배정이 나온다 — 그것이 이 파일의 목적을 깬다.
 *    정본은 `src/lib/scale-profile.ts` 다 — 발행 트랜잭션도 같은 함수를 쓴다(2026-09-25).
 */
export { releaseCapsOf }

/**
 * 🔴 **publisher 의 실제 계약대로 센다** (2026-09-24 마스터 지적).
 *
 *    앞판은 `prepared.auto` 를 "publishable" 이라 불렀다. 그것은 **신선도 통과 목록**이지
 *    최종 발행 가능 목록이 아니다. 그리고 `batch.assignments` 에는 `assigned === null`
 *    행도 들어 있다 — 그것을 배정 성공으로 세면 재고가 부풀어 오른다.
 *
 * 🔴 publisher 가 실제로 하는 일:
 *    ```
 *    prepared.auto 로 freshOrdered 를 세우고
 *    brokenRecovery(=recoveryProblem !== null)가 하나라도 있으면 **전체 중단**
 *    pickPublishTarget(freshOrdered, assignedOf, isRecovery) → 이번에 나갈 한 건
 *    ```
 */
export type StockStages = {
  /** ① 전체 미발행 queue */
  queueTotal: number
  /** ② `selectAutoTargets` 통과 */
  selectorTargets: { count: number; ids: string[] }
  /** ③ 신선도 통과 — 🔴 `prepared.auto` 에서 **직접** 가져온다(정규식 분류 없음) */
  freshnessPassed: { count: number; ids: string[] }
  /** ④ 🔴 배정 **성공** — `assigned !== null` 이고 `recoveryProblem === null` 인 행만 */
  successfullyAssigned: { count: number; ids: string[] }
  /**
   * ⑤ 🔴 **배정까지 끝난 재고.** broken recovery 가 하나라도 있으면 publisher 는
   *    전체를 중단하므로 0 이다 — 배정이 아무리 많아도 그렇다.
   *
   * 🔴 **`runnableNow` 가 아니다** (2026-09-24 마스터 지적). 이 값은
   *    슬롯 · 일 상한 · kill switch · day guard · `--apply` 를 **하나도 보지 않는다.**
   *    그것들을 통과해야 실제로 실행된다 — 여기서 "지금 실행 가능" 이라 부르면
   *    단계 결정이 있지도 않은 실행 허가를 근거로 오른다.
   */
  assignmentReady: { count: number; ids: string[] }
  /**
   * 🔴 **재고 기준으로** 이번 회차에 집히는 한 건 — `pickPublishTarget` 결과다.
   *    🔴 이것도 실행 허가가 아니다. 실행 게이트는 러너의 `judgeApply` 가 따로 본다.
   */
  nextPickedId: string | null
  /** 🔴 전체 중단 사유 — 있으면 `runnableNow` 는 0 이다 */
  brokenRecovery: { id: string; problem: string }[]
  /** hold 사유별 — 🔴 닫힌 enum 값 그대로다 */
  holdsByReason: { reason: HoldReason; count: number; ids: string[] }[]
}

export function stageStock(input: {
  loaded: LoadedStock
  caps: Parameters<typeof prepareCandidates>[0]['caps']
  at: Date
}): StockStages {
  const { loaded } = input
  /** 🔴 러너와 **같은 `planPublishBatch`** 를 부른다 — 여기서 다시 판정하지 않는다 */
  const plan = planPublishBatch({ loaded, caps: input.caps, at: input.at })

  /** 🔴 `HoldReason` 은 닫힌 enum 이다 — 정규식으로 분류하지 않는다 */
  const holdIds = new Map<HoldReason, string[]>()
  for (const h of plan.prepared.held) {
    holdIds.set(h.hold, [...(holdIds.get(h.hold) ?? []), h.queueId])
  }
  const selectorIds = loaded.targets.map((t) => t.id)
  /** 🔴 신선도 통과는 `prepared.auto` 가 정본이다 */
  const freshIds = plan.prepared.auto.map((c) => c.queueId)
  const readyIds = plan.brokenRecovery.length > 0
    ? []
    : plan.freshOrdered.filter((t) => (plan.assignOf.get(t.id)?.assigned ?? null) !== null)
      .map((t) => t.id)

  return {
    queueTotal: loaded.queueTotal,
    selectorTargets: { count: selectorIds.length, ids: selectorIds },
    freshnessPassed: { count: freshIds.length, ids: freshIds },
    successfullyAssigned: { count: plan.assignmentReady.length, ids: plan.assignmentReady },
    assignmentReady: { count: readyIds.length, ids: readyIds },
    nextPickedId: plan.nextPickedId,
    brokenRecovery: plan.brokenRecovery,
    holdsByReason: [...holdIds]
      .map(([reason, ids]) => ({ reason, count: ids.length, ids }))
      .sort((a, b) => b.count - a.count),
  }
}

/**
 * ══ 🔴 **여기부터 — 러너의 판정 경로를 소비자 셋이 함께 부른다** (2026-09-24 5차) ══
 *
 * 🔴 **왜 옮기나.** 앞판은 probe 가 `installFromEnv(process.env)` 만 불렀다.
 *    러너는 거기에 **readiness · canary · window** 를 넣어 설치한다. 그래서
 *    bare env 가 d1 이어도 러너는 window 허가로 d3·d5 를 열 수 있고, 그때
 *    probe 는 여전히 d1 상한으로 배정해 **다른 재고·다른 picked** 를 냈다.
 *    오늘 둘 다 d1 이 나온 것은 허가가 꺼져 있었기 때문이지 같은 계산이어서가 아니다.
 *
 * 🔴 **검사 안에 러너 계산을 베껴 두지 않는다.** 베낀 사본은 러너가 바뀌어도
 *    같이 바뀌지 않아, 갈라진 순간부터 조용히 거짓 초록이 된다.
 */

/** 🔴 단계의 하루 목표 — 어느 소비자도 숫자를 손으로 적지 않는다 */
const dailyTargetOf = (st: ReleaseStage): number => PROFILES[st].dailyTarget

export type ResolvedScale = {
  /**
   * 🔴 readiness·canary·window 를 **넣어 계산한** 결과 — bare env 가 아니다.
   * 🔴 **계산했을 뿐 설치하지 않았다.** 설치는 publisher 만 한다(`applyScale`).
   */
  scale: ReturnType<typeof resolveScale>
  caps: { postsPerWeek: number; minDaysBetween: number }
  dailyCap: number
  readiness: ReturnType<typeof stageVerdicts>
  canaryVerdict: ReturnType<typeof judgeOneDayCanary> | null
  windowVerdict: ReturnType<typeof judgeOneDayCanary> | null
  canaryAuth: ReturnType<typeof canaryAuthorization>
  windowAuth: ReturnType<typeof windowAuthorization>
  /**
   * 🔴 **설치가 끝난 뒤 그 단계로 다시 낸 판정** — 이것이 실제로 문을 여닫는다.
   *    D3 기간 운영과 D5 하루 시험이 겹치면 설치는 d5 인데 판정은 d3 것이 된다.
   *    허가가 하나도 없는 날에는 `null` 이고, 그때 동작은 허가 이전과 같다.
   */
  effectiveVerdict: ReturnType<typeof judgeOneDayCanary> | null
  /** 🔴 그 단계 예측이 센 **깨진 복구 배정** 수 — 판정이 아니라 결함 신호다 */
  effectiveRecoveryBroken: number
}

/**
 * 🔴 **러너가 실제로 쓰는 상한을 만드는 유일한 경로.**
 *
 * 🔴 **정말로 순수하다** (2026-09-24 6차 · 마스터 지적).
 *    앞판은 "순수 함수다" 라고 적어 두고 `installFromEnv` 를 불렀다 —
 *    그 함수는 `applyScale` 을 거쳐 **module-global `installed` 를 바꾼다.**
 *    그래서 probe 를 한 번 돌리거나 fixture 검사를 돌리기만 해도
 *    그 프로세스의 `activeScale()` 이 조용히 바뀌었다. 계산과 설치를 섞은 것이다.
 *    🔴 지금은 `resolveScale` 만 쓴다. **설치는 publisher 가 한 번만 한다.**
 */
export function resolvePublishScale(input: {
  env: Readonly<Record<string, string | undefined>>
  loaded: LoadedStock
  now: Date
}): ResolvedScale {
  const { loaded, now, env } = input
  const axis = { now, publishedToday: loaded.publishedToday }
  const readiness = stageVerdicts({
    queue: loaded.queueCandidates, personas: loaded.personas as never,
    history: loaded.history, axis,
  })
  /** 🔴 러너의 `dayFor` 와 같은 계산이다 — 같은 함수에 지평 1일을 준다 */
  const dayFor = (stage: ReleaseStage): {
    sim: ReturnType<typeof simulateStage>; verdict: ReturnType<typeof judgeOneDayCanary>
  } => {
    const sim = simulateStage({
      stage, queue: loaded.queueCandidates, personas: loaded.personas as never,
      history: loaded.history, axis, days: 1, anchor: 'now',
      dailyCap: Math.max(0, dailyTargetOf(stage) - loaded.publishedToday),
    })
    const verdict = judgeOneDayCanary(sim, {
      publishedToday: loaded.publishedToday,
      slotsLeft: slotsLeftToday(stage, now),
    })
    return { sim, verdict }
  }
  const canaryAuth = canaryAuthorization(env as never, now, RELEASE_STAGES)
  const canaryDay = canaryAuth.activeToday && canaryAuth.stage !== null
    ? dayFor(canaryAuth.stage) : null
  const canaryVerdict = canaryDay?.verdict ?? null
  const windowAuth = windowAuthorization(env as never, now, RELEASE_STAGES)
  const windowDay = windowAuth.activeToday && windowAuth.stage !== null
    ? dayFor(windowAuth.stage) : null
  const windowVerdict = windowDay?.verdict ?? null

  const scale = resolveScale(env as never, {
    readiness,
    canary: { now, verdict: canaryVerdict },
    window: {
      now, verdict: windowVerdict, dayVerdict: windowVerdict,
      publishedToday: loaded.publishedToday,
    },
  })
  const effectiveDay = (canaryAuth.activeToday || windowAuth.activeToday)
    ? (scale.releaseStage === windowAuth.stage ? windowDay
      : scale.releaseStage === canaryAuth.stage ? canaryDay
        : dayFor(scale.releaseStage))
    : null
  return {
    scale, caps: releaseCapsOf(scale.releaseProfile),
    dailyCap: scale.releaseProfile.dailyTarget,
    readiness, canaryVerdict, windowVerdict, canaryAuth, windowAuth,
    effectiveVerdict: effectiveDay?.verdict ?? null,
    /** 🔴 `recoveryBroken` 은 판정이 아니라 예측 쪽에만 있다 — 결함 신호다 */
    effectiveRecoveryBroken: effectiveDay?.sim.recoveryBroken ?? 0,
  }
}

/**
 * 🔴 **배정 계획 — 러너의 ③ ~ ③-b 를 그대로 옮긴 순수 함수.**
 *    러너 · `stageStock`/probe · 실행 검사 셋이 **이 함수를 부른다.**
 *    러너에서 이 호출을 떼면 검사가 빨개진다(사본 비교가 아니라 실제 소비다).
 */
export type PublishPlan = {
  prepared: ReturnType<typeof prepareCandidates>
  assignOf: Map<string, ReturnType<typeof prepareCandidates>['batch']['assignments'][number]>
  /** 🔴 `prepared.auto` 순서로 세운 발행 줄 — DB 질의 순서가 아니다 */
  freshOrdered: AutoRow[]
  /** 🔴 하나라도 있으면 러너는 **전체 중단**한다 */
  brokenRecovery: { id: string; problem: string }[]
  /** 배정 성공 — `assigned !== null` 이고 `recoveryProblem === null` */
  assignmentReady: string[]
  /** 🔴 **재고 기준으로** 이번에 집히는 한 건. 실행 허가가 아니다 */
  nextPickedId: string | null
  picked: AutoRow | null
  recovered: boolean
  skipped: AutoRow[]
  waiting: AutoRow[]
  /**
   * 🔴 **기존 배정 자동 행 중 이번 회차에서 뺀 것** (2026-09-25 마스터 P0) — 발행 트랜잭션과
   *    같은 `judgeAutoAssignment` 가 막는 행이다. 🔴 재배정하지 않는다 · 큐 상태도 바꾸지 않는다.
   *    · `autoDeferred`   시간 상한(WEEKLY_CAP·TOO_SOON) — 풀리면 다음 회차에 다시 선두다
   *    · `autoExceptions` 말투·생활사·비활성·실회원·Persona 없음 — 자동 발행에서 빠진 예외다
   */
  autoDeferred: { id: string; codes: string[] }[]
  autoExceptions: { id: string; codes: string[] }[]
}

export function planPublishBatch(input: {
  loaded: LoadedStock
  caps: Parameters<typeof prepareCandidates>[0]['caps']
  at: Date
}): PublishPlan {
  const { loaded } = input
  /**
   * 🔴 **기존 배정 자동 행을 발행 트랜잭션과 같은 판정으로 먼저 본다** (2026-09-25 마스터 P0).
   *    막히는 행을 줄에 두면 "복구 먼저" 규칙이 그 행을 매 회차 선두에 세운다 —
   *    트랜잭션은 막고, 러너는 멈추고, 뒤의 정상 행은 영원히 나가지 못한다.
   *    그래서 그 행만 이번 줄에서 뺀다. 배정은 그대로 두고 다른 Persona 로 바꾸지 않는다.
   */
  const autoDeferred: { id: string; codes: string[] }[] = []
  const autoExceptions: { id: string; codes: string[] }[] = []
  for (const t of loaded.targets) {
    if (!loaded.pinnedAutoPersona.has(t.id)) continue
    const v = judgeAutoAssignment({
      persona: loaded.pinnedAutoPersona.get(t.id) ?? null, gateResults: t.gateResults,
      title: t.title, body: t.body, caps: input.caps ?? {},
    })
    if (!v.ok) (v.route === 'defer' ? autoDeferred : autoExceptions).push({ id: t.id, codes: v.codes })
  }
  const blocked = new Set([...autoDeferred, ...autoExceptions].map((x) => x.id))
  const targets = loaded.targets.filter((t) => !blocked.has(t.id))
  const prepared = prepareCandidates({
    candidates: loaded.queueCandidates.filter((c) => !blocked.has(c.queueId)), personas: loaded.personas as never,
    caps: input.caps, at: input.at,
  })
  const assignOf = new Map(prepared.batch.assignments.map((a) => [a.queueId, a]))
  const orderById = new Map(prepared.auto.map((c, i) => [c.queueId, i]))
  const freshOrdered = targets
    .filter((t) => orderById.has(t.id))
    .sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!)
  const brokenRecovery = targets
    .map((t) => ({ id: t.id, problem: assignOf.get(t.id)?.recoveryProblem ?? null }))
    .filter((x): x is { id: string; problem: string } => x.problem !== null)
  const assignmentReady = prepared.batch.assignments
    .filter((a) => a.assigned !== null && (a.recoveryProblem ?? null) === null)
    .map((a) => a.queueId)

  /** 🔴 배정이 깨졌으면 아무것도 집지 않는다 — 러너가 여기서 멈추기 때문이다 */
  const r = brokenRecovery.length > 0
    ? { picked: null, recovered: false, skipped: [] as AutoRow[], waiting: [] as AutoRow[] }
    : pickPublishTarget({
      ordered: freshOrdered,
      assignedOf: (id) => assignOf.get(id)?.assigned ?? null,
      isRecovery: (id) => assignOf.get(id)?.recovery === true,
    })
  return {
    prepared, assignOf, freshOrdered, brokenRecovery, assignmentReady,
    nextPickedId: r.picked?.id ?? null,
    picked: r.picked, recovered: r.recovered, skipped: r.skipped, waiting: r.waiting,
    autoDeferred, autoExceptions,
  }
}

/**
 * ══ 🔴 **재고 분류 — 공급과 발행이 같은 답을 쓴다** (2026-09-26) ══
 *
 * 🔴 **무엇이 틀렸나.** 공급 러너(`snapshot`)와 보충기(autofill)는 `readStock` 으로
 *    **형식(profile)만** 셌다. 같은 DB 에서 공급은 "러너가 먹을 수 있는 것 9건",
 *    발행 러너는 "자동 발행 후보 1건 → TTL 만료 → 0건" 이었다(실측 2026-09-26).
 *    9 중 8건은 사람 검토를 기다리는 기계 초안이었다 — 발행 가능 재고가 아니다.
 *
 * 🔴 **그래서 판정을 새로 적지 않는다.** 아래는 이미 계산된 정본 결과를 **나누기만** 한다.
 *    · profile · gate · 검토 — `selectAutoTargets` 가 낸 `rejected` 코드
 *    · 배정 예외 — `planPublishBatch` 의 `autoDeferred` · `autoExceptions`
 *    · TTL · 신선도 — `prepareCandidates` 의 `held`
 *    · 배정 — `batch.assignments` · `brokenRecovery`
 *    러너와 같은 `loaded` · 같은 `plan` 을 넣으면 러너와 같은 답이 나온다.
 *
 * 🔴 **칸은 겹치지 않고 빠지지 않는다** — 합이 `queueTotal` 이다. 검사가 그것을 단정한다.
 */
export type StockBucket =
  | 'publishableNow' | 'humanReviewPending' | 'ttlExpired' | 'freshnessHeld'
  | 'profileMismatch' | 'gateBlocked' | 'assignmentBlocked'

export const STOCK_BUCKETS: readonly StockBucket[] = [
  'publishableNow', 'humanReviewPending', 'ttlExpired', 'freshnessHeld',
  'profileMismatch', 'gateBlocked', 'assignmentBlocked',
]

export const STOCK_BUCKET_LABEL: Record<StockBucket, string> = {
  publishableNow: '지금 발행 가능 (배정까지 끝남)',
  humanReviewPending: '사람 검토 대기 (기계 초안)',
  ttlExpired: 'TTL 만료',
  freshnessHeld: '신선도 보류 (시각 미상 · 복구 글 상함)',
  profileMismatch: 'profile 불일치 (legacy)',
  gateBlocked: 'gate · 안전 · 제목 복제 · 빈 글',
  assignmentBlocked: 'Persona 배정 불가 (여력 · 생활사 · 복구 중단)',
}

/** 🔴 정본 거절 코드 → 칸. `switch` 라서 코드가 늘면 컴파일이 깨진다 */
function bucketOfReject(code: RejectCode): StockBucket {
  switch (code) {
    case 'PROFILE': case 'PROMPT_VERSION': case 'MODEL': case 'SITE':
      return 'profileMismatch'
    // 🔴 기계 초안인데 사람이 보지 않았다 — 자동 도장이 닫혔거나 낡은 것도 같은 처지다
    case 'HUMAN_REVIEW_REQUIRED': case 'AUTO_READY_CLOSED': case 'AUTO_READY_STALE':
      return 'humanReviewPending'
    case 'GATE': case 'SAFETY': case 'EMPTY': case 'TITLE_COPIES_SOURCE':
    case 'STATUS': case 'ALREADY_PUBLISHED':
      return 'gateBlocked'
    default: {
      const never: never = code
      return never
    }
  }
}

export type StockClassification = {
  queueTotal: number
  /** 칸별 행 id — 🔴 합이 `queueTotal` 이다 */
  ids: Record<StockBucket, string[]>
  counts: Record<StockBucket, number>
  /**
   * 🔴 **Persona 가 들고 있는 글(WIP)** — 공급이 같은 화자로 또 만들지 않게 센다.
   *    발행 가능 재고가 아니다. 🔴 검토 대기는 **여기 남는다** — 사람이 READY 로 정하는 순간
   *    그 화자의 자리를 차지한다. profile 불일치(legacy)와 gate 탈락은 영영 나가지 않으므로 빠진다.
   */
  personaWipIds: string[]
}

export function classifyStock(input: { loaded: LoadedStock; plan: PublishPlan }): StockClassification {
  const { loaded, plan } = input
  const ids = Object.fromEntries(STOCK_BUCKETS.map((b) => [b, [] as string[]])) as Record<StockBucket, string[]>
  for (const r of loaded.rejected) ids[bucketOfReject(r.code)].push(r.id)

  const pinnedBlocked = new Set([...plan.autoDeferred, ...plan.autoExceptions].map((x) => x.id))
  const heldOf = new Map(plan.prepared.held.map((h) => [h.queueId, h.hold]))
  const halted = plan.brokenRecovery.length > 0
  const ready = new Set(plan.assignmentReady)
  for (const t of loaded.targets) {
    if (pinnedBlocked.has(t.id)) { ids.assignmentBlocked.push(t.id); continue }
    const hold = heldOf.get(t.id)
    if (hold !== undefined) { (hold === 'TTL_EXPIRED' ? ids.ttlExpired : ids.freshnessHeld).push(t.id); continue }
    // 🔴 깨진 복구가 하나라도 있으면 러너는 전체를 멈춘다 — 배정이 있어도 지금 나갈 수 없다
    if (!halted && ready.has(t.id)) ids.publishableNow.push(t.id)
    else ids.assignmentBlocked.push(t.id)
  }
  const counts = Object.fromEntries(STOCK_BUCKETS.map((b) => [b, ids[b].length])) as Record<StockBucket, number>
  const personaWipIds = [
    ...ids.publishableNow, ...ids.humanReviewPending, ...ids.ttlExpired,
    ...ids.freshnessHeld, ...ids.assignmentBlocked,
  ]
  return { queueTotal: loaded.queueTotal, ids, counts, personaWipIds }
}

/** 사람이 읽는 줄 — 공급 러너 · 보충기가 같은 줄을 찍는다 */
export function describeStockClassification(c: StockClassification): string[] {
  return STOCK_BUCKETS.map((b) => `${String(c.counts[b]).padStart(3)}건  ${b} — ${STOCK_BUCKET_LABEL[b]}`)
}

/**
 * 🔴 **발행 러너가 보는 재고를 공급 쪽에서 똑같이 읽는다** — 조립 순서도 러너와 같다:
 *    `authoritativeGate` → `loadPublishableStock` → `resolvePublishScale` → `planPublishBatch`.
 *    🔴 발행 상한은 **release** 다(러너와 같다). 공급 준비의 capacity 눈금은 여기서 쓰지 않는다.
 *    🔴 읽기만 한다 — `applyScale` 을 부르지 않는다(module-global 불변) · DB write 0.
 */
export async function loadStockClassification(
  prisma: PrismaClient, env: Readonly<Record<string, string | undefined>>, now: Date,
): Promise<{ loaded: LoadedStock; resolved: ResolvedScale; plan: PublishPlan; classification: StockClassification }> {
  const autoOpen = await authoritativeGate(prisma, env as never)
  const loaded = await loadPublishableStock(prisma, now, { autoReadyOpen: autoOpen.open })
  const resolved = resolvePublishScale({ env, loaded, now })
  const plan = planPublishBatch({ loaded, caps: resolved.caps, at: now })
  return { loaded, resolved, plan, classification: classifyStock({ loaded, plan }) }
}
