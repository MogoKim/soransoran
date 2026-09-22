#!/usr/bin/env tsx
/**
 * 자동 발행 러너 — 🔴 **기본 dry-run. 실제 실행은 되돌릴 수 없다** (§4-AL)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AL
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   [발행 후보 파일] → [브리지] → 대기열(PENDING) → [사람 승인] → APPROVED
 *                                                    → **[여기] 배정 + 발행**
 *
 * 🔴 **사람이 매일 queue id 를 고르지 않아도 되게 하는 것**이 이 러너의 목적이다.
 *    그렇다고 아무거나 내지는 않는다 — 대상 조건 일곱 개를 전부 통과한
 *    **정확히 1건**일 때만 돈다(§4-AL ③).
 *
 * 🔴 **legacy 글은 절대 대상이 아니다.** 같은 대기열에 다른 레인이 만든 글이 산다.
 *    `promptVersion=publish-candidate-v1` · `model=human-curated` 로 못박는 이유다 —
 *    2026-09-06 에 그 구분이 없어 내용 모르는 글 둘이 발행 직전까지 갔다.
 *
 * 🔴 **하지 않는 것**
 *    상수 변경(DAILY_PUBLISH_CAP · POST_CAP_PER_WEEK · MIN_DAYS_BETWEEN_POSTS) ·
 *    Raw SQL · LLM · 네이버 접속 · Google Sheet · 마이그레이션 ·
 *    legacy 후보 발행 · 후보가 1건이 아닐 때의 발행.
 *
 * 사용법
 *   npx tsx scripts/original-post-auto-publish.mts                # dry-run
 *   npx tsx scripts/original-post-auto-publish.mts --apply --limit=1   🔴 실제 발행
 */
import { PrismaClient } from '@prisma/client'
import {
  selectAutoTargets, judgeApply, judgePublishDefects, verifyAfterPublish, pickPublishTarget, REJECT_LABEL,
  AUTO_PROMPT_VERSION, AUTO_MODEL, AUTO_SITE_PREFIX, AUTO_GATE_VERDICT,
  type AutoRow,
} from '../src/lib/original-post-auto-publish'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { planBatch, POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
// 🔴 생성 말투 → 최종 author. 러너 · 관제 · 예측 · 준비도가 이 함수 하나를 쓴다
import { voiceInputOf } from '../src/lib/original-post-auto-publish'
// 🔴 생성 말투 → 최종 author. 여기서 읽지 않으면 연결이 끊긴다

import { planStore } from '../src/lib/original-post-match-store'
import { DAILY_PUBLISH_CAP, kstDayStart } from '../src/lib/original-post-publish'
import { installFromEnv, activeScale, describeScale } from '../src/lib/scale-runtime'
import { judgeCatchUp, type TriggerKind } from '../src/lib/publish-slot-catchup'
import { stageVerdicts, simulateStage } from '../src/lib/scale-readiness'
import {
  canaryAuthorization, judgeOneDayCanary, slotsLeftToday,
  windowAuthorization, judgeDayGuard,
} from '../src/lib/release-canary'
import { effectiveWeeklyCap, RELEASE_STAGES, PROFILES, type ReleaseStage } from '../src/lib/scale-profile'

/** 🔴 단계의 하루 목표 — 러너가 숫자를 손으로 적지 않는다 */
const scaleTargetOf = (st: (typeof RELEASE_STAGES)[number]): number => PROFILES[st].dailyTarget
import { prepareCandidates, describePrepared, type QueueCandidate } from '../src/lib/supply-candidates'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const limitRaw = argv.find((a) => a.startsWith('--limit='))?.slice(8)
const LIMIT = limitRaw === undefined ? null : Number.parseInt(limitRaw, 10)
/**
 * 🔴 **이 run 을 띄운 예약 그 자체.** 워크플로우가 `github.event.schedule` 을 그대로 넘긴다.
 *    수동 실행에는 이 값이 없고, 없으면 발행하지 않는다(dry-run 이므로 어차피 막힌다).
 *
 * 🔴 **이제 이 값이 "발행 여부" 를 혼자 정하지 않는다** (2026-09-14).
 *    옛 판은 "이 cron 이 내 슬롯인가" 만 물었다. 그래서 예약 하나가 배달되지 않으면
 *    (2026-09-14 `30 0 * * *` 실측) 그날이 통째로 비었다. 지금은 `judgeCatchUp` 이
 *    **도래한 슬롯 수 − 오늘 발행 수** 로 판정하고, 이 값은 트리거 정체성과 로그에 쓰인다.
 */
const SLOT_CRON = argv.find((a) => a.startsWith('--slot-cron='))?.slice(12) ?? null
/**
 * 🔴 **누가 이 회차를 불렀는가** — `schedule`(GitHub 예약) · `local`(launchd 정시) · `manual`.
 *    주지 않으면 예약 문자열이 있을 때만 `schedule` 이고, 그 밖에는 `manual` 이다(fail-closed).
 */
const TRIGGER: TriggerKind = ((): TriggerKind => {
  const raw = argv.find((a) => a.startsWith('--trigger='))?.slice(10)?.trim()
  if (raw === 'schedule' || raw === 'local' || raw === 'manual') return raw
  if (raw !== undefined && raw !== '') return 'manual'
  return SLOT_CRON === null ? 'manual' : 'schedule'
})()
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }
const kst = (d: Date): string =>
  `${new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} KST`
/** 🔴 전문을 남기지 않는다 — 앞부분 + 길이 */
const brief = (v: string): string => `"${[...v][0] ?? ''}…" (${[...v].length}자)`

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(APPLY ? '\n══ 🔴 실제 발행 (--apply) ══\n' : '\n══ dry-run (DB write 0 · Post 0) ══\n')
console.log(`  대상 조건  gate=${AUTO_GATE_VERDICT} · ${AUTO_PROMPT_VERSION} / ${AUTO_MODEL} · ${AUTO_SITE_PREFIX}*`)
console.log(`  안전 기본값 일 ${DAILY_PUBLISH_CAP}건 · persona 주 ${POST_CAP_PER_WEEK}건 · 최소 ${MIN_DAYS_BETWEEN_POSTS}일`)
console.log('  🔴 실제 상한은 아래 ③-c 에서 설치한다 — 설치 전에는 이 안전값이다\n')

// ── ① 후보 수집 — 🔴 읽기만 한다 ──
const raw = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
  select: {
    id: true, status: true, createdPostId: true, gateVerdict: true,
    promptVersion: true, model: true, matchedPersonaId: true,
    draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
    // 🔴 기계 profile 은 게이트 기록까지 본다 — 큐 컬럼 셋만으로는 손으로 넣을 수 있다
    gateResults: true,
    // 🔴 **발행 판정이 이 값을 본다** — 기계 후보는 사람이 확인한 것만 나간다
    decidedBy: true,
    decidedAt: true, createdAt: true,
    // 🔴 신선도 판정 근거 — 원문을 언제 봤는가
    rawContent: { select: { sourceSite: true, sourceCapturedAt: true } },
  },
  orderBy: { createdAt: 'asc' },
})
const rows: AutoRow[] = raw.map((r) => ({
  id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
  promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
  // 🔴 수정본이 있으면 그것이 발행될 글이다
  gateResults: r.gateResults,
  title: r.editedTitle ?? r.draftTitle,
  body: r.editedBody ?? r.draftBody,
  sourceSite: r.rawContent.sourceSite,
  // 🔴 제목 복제 판정은 gateResults 의 **기록**이 한다 — 원문 제목도 해시도 저장하지 않는다.
  //    여기서는 "사람이 실제로 다시 지었는가" 를 물을 두 값만 넘긴다
  draftTitle: r.draftTitle,
  editedTitle: r.editedTitle,
  decidedBy: r.decidedBy,
  decidedAt: r.decidedAt, createdAt: r.createdAt,
}))

// ── ② 안전 재판정 — 🔴 저장된 값을 믿지 않는다 ──
const { targets, rejected } = selectAutoTargets(rows, (t, b) => safetyFilter({ title: t, body: b }).verdict)

// 🔴 발행 대상은 **배정을 끝낸 뒤** 고른다 (③ 아래). 맨 앞 한 건을 미리 집으면,
//    그 글이 배정되지 않았을 때 뒤에 배정된 글이 있어도 하루를 통째로 버린다.
console.log(`① 대기열 ${rows.length}건 → 자동 발행 후보 ${targets.length}건`)
if (rejected.length > 0) {
  const by = new Map<string, number>()
  for (const r of rejected) by.set(r.code, (by.get(r.code) ?? 0) + 1)
  console.log(`\n② 제외 ${rejected.length}건 — 🔴 legacy 글이 섞이지 않는다`)
  for (const [code, n] of [...by].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(2)}건  ${REJECT_LABEL[code as keyof typeof REJECT_LABEL]}`)
  }
}

// 🔴 신선도 근거 — queueId → 원문 확인 시각
const capturedAtOf = new Map(raw.map((r) => [r.id, r.rawContent?.sourceCapturedAt ?? null]))

// ── ③ persona 배정 가능성 ──
const WEEK_AGO = new Date(Date.now() - 7 * 864e5)
const personaRows = await prisma.persona.findMany({
  where: { status: 'active' },
  select: { id: true, code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
            user: { select: { providerId: true, _count: { select: { accounts: true } } } } },
})
const personas = []
for (const r of personaRows) {
  const id = (r.identity ?? {}) as Record<string, unknown>
  const vc = (r.voiceCore ?? {}) as Record<string, unknown>
  const postsThisWeek = await prisma.originalPostApprovalQueue.count({
    where: { matchedPersona: { code: r.code }, matchedAt: { gte: WEEK_AGO } },
  })
  const last = await prisma.originalPostApprovalQueue.findFirst({
    where: { matchedPersona: { code: r.code } }, orderBy: { matchedAt: 'desc' }, select: { matchedAt: true },
  })
  personas.push({
    code: r.code, status: r.status,
    // 🔴 실계정이 붙은 페르소나는 쓰지 않는다 (REAL_MEMBER 차단의 입력)
    providerId: r.user?.providerId ?? null,
    // 🔴 실회원 판별 정본. 넘기지 않으면 hardFilter 가 fail-closed 로 막는다
    accountCount: r.user?._count.accounts ?? null,
    ageBand: typeof id.ageBand === 'string' ? id.ageBand : null,
    maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
    // 🔴 **이것이 빠지면 모든 persona 가 무자녀로 판정된다.**
    //    hardFilter 는 `p.childrenCount ?? 0` 로 읽으므로, 넘기지 않으면 0 이 되어
    //    자녀 글이 전부 NO_CHILDREN 으로 막힌다 — match-assign 은 넘기는데 여기만 빠져 있었다.
    //    2026-09-07 실측: "아이랑 같이 갈 숙소" 글에서 P10·P17 이 부당하게 차단됐다.
    childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
    ...(Array.isArray(id.childrenAgeBands) ? { childrenAgeBands: id.childrenAgeBands as never } : {}),
    parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
    menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
    workStatus: null, economicStatus: null, region: null,
    noGoTopics: r.noGoTopics,
    voiceLength: typeof vc.length === 'string' ? vc.length : null,
    postsThisWeek,
    daysSinceLastPost: last?.matchedAt == null ? null : Math.floor((Date.now() - last.matchedAt.getTime()) / 864e5),
  })
}
// 🔴 이미 배정된 행은 기존 배정이 정본이다 — id → code 로 바꿔 넘긴다.
//    넘기지 않으면 planBatch 가 그 행을 새로 매칭해 **다른 사람에게** 줄 수 있다
const codeOfPersonaId = new Map(personaRows.map((r) => [r.id, r.code]))

/**
 * ── ②-b 🔴 **후보 준비 — 관제·예측·준비도와 같은 함수다** (2026-09-08) ──
 *
 *    freshness hold 를 러너에만 넣었더니 화면은 필터 전 재고로 READY 라 적고
 *    러너는 hold 때문에 그날 한 건을 못 냈다. 이제 네 곳이 같은 함수를 부른다.
 *
 *    🔴 hold 된 글은 매칭에 **들어가지 않는다** — persona 자리를 선점하지 못한다.
 *       예전 러너는 planBatch 를 먼저 돌리고 순서를 나중에 바꿔, 상한 글이 자리를 쥐고 있었다.
 */
/**
 * 🔴 `capturedAt` 을 **그대로** 넘긴다 — 나이를 여기서 굳히지 않는다.
 *    예측은 하루씩 밀며 그날의 나이로 다시 판정해야 하므로 스냅숏을 주면 안 된다.
 */
const queueCandidates: QueueCandidate[] = targets.map((t, i) => ({
  queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: i,
  // 🔴 배정된 persona 를 못 찾으면 빈 문자열이 아니라 **모르는 코드**를 넘긴다 —
  //    planBatch 가 fail-closed 로 잡아 멈춘다. 조용히 재배정되면 안 된다
  assignedPersonaCode: t.matchedPersonaId === null
    ? null
    : (codeOfPersonaId.get(t.matchedPersonaId) ?? `__unknown:${t.matchedPersonaId}`),
  // 🔴 말투·profile 은 **정본 한 함수**가 만든다. 호출부마다 따로 부르면 한 곳이 빠진다
  ...voiceInputOf(t),
  capturedAt: capturedAtOf.get(t.id) ?? null,
}))

/**
 * ── ③-c 🔴 **규모 설정 설치** — `loadEnvLocal()` 뒤, 쓰기 판정 **앞**이다 ──
 *
 *    ① 지금 큐·지금 사람으로 각 단계가 14일을 버티는지 시뮬레이션하고
 *    ② 그 판정을 넘겨 `release` 단계를 **실제로** 낮춘다.
 *    화면 문구가 아니라 아래 `dailyCap`·`caps` 가 바뀐다 — 그것이 이 설치의 목적이다.
 */
const historyRows = await prisma.personaActivityLog.findMany({
  where: { kind: 'post' }, select: { createdAt: true, persona: { select: { code: true } } },
})
// 🔴 **시간축은 하나다** — `now` 와 오늘 발행 수만 넘기고 단계별 시작점은 lib 이 만든다.
//    러너와 관제가 각자 시작점을 정하면 같은 DB 를 보고 다른 준비도를 말한다
const axisNow = new Date()
const axisPublishedToday = await prisma.personaActivityLog.count({
  where: { kind: 'post', createdAt: { gte: kstDayStart(axisNow) } },
})
const readiness = stageVerdicts({
  // 🔴 **거르지 않은 후보**를 넘긴다 — 자동/hold 갈림과 배정을 단계마다 그 cap 으로 다시 정한다.
  //    d1 로 한 번 준비한 목록을 d10 계산에 돌려쓰면 cap 이 다른데도 같은 글이 빠진다
  queue: queueCandidates,
  personas: personas as never,
  history: personas.map((p) => ({
    code: p.code,
    matchedAts: historyRows.filter((l) => l.persona?.code === p.code).map((l) => l.createdAt),
  })),
  axis: { now: axisNow, publishedToday: axisPublishedToday },
})
/**
 * 🔴 **하루짜리 첫 시험 판정** (2026-09-21).
 *
 *    `readiness` 네 조건은 전부 14일 지속성이라 "내일 하루 3편을 안전하게 낼 수
 *    있는가" 를 묻는 자리가 없었다. 그래서 같은 `simulateStage` 를 **지평 1일**로
 *    한 번 더 돌린다 — 🔴 새 계산이 아니라 같은 함수에 다른 창을 준다.
 *
 * 🔴 허가된 단계에 대해서만 돌린다. 허가가 없으면 판정 자체를 만들지 않는다.
 */
/**
 * 🔴 **그날치 판정을 단계마다 같은 방식으로 만든다** (2026-09-22).
 *
 *    앞판은 하루짜리(canary)와 기간형(window)이 각자 `simulateStage` 를 불렀고,
 *    그러다 보니 **그날 실제로 설치된 단계**의 판정이 없는 경우가 생겼다.
 *    D3 기간 운영과 D5 하루 시험이 겹치면 단계는 d5 인데 판정은 d3 것이었다.
 */
const personasForSim = personas as never
const historyForSim = personas.map((p) => ({
  code: p.code,
  matchedAts: historyRows.filter((l) => l.persona?.code === p.code).map((l) => l.createdAt),
}))
/** 🔴 예측과 판정을 **함께** 낸다 — 결함 신호(`recoveryBroken`)는 예측 쪽에만 있다 */
const dayFor = (stage: ReleaseStage) => {
  const sim = simulateStage({
    stage,
    queue: queueCandidates,
    personas: personasForSim,
    history: historyForSim,
    axis: { now: axisNow, publishedToday: axisPublishedToday },
    /**
     * 🔴 **하루**다. 이 값이 14 가 되면 하루 판정이 14일 판정으로 바뀐다.
     * 🔴 **지금 이 순간부터** 본다 — 기본 지평은 다음 KST 자정이라
     *    그날 시험의 GO/NO-GO 가 이튿날 사정에 끌려갔다(2026-09-21 실측).
     */
    days: 1,
    anchor: 'now',
    /**
     * 🔴 **오늘 남은 발행분만큼만** 낸다고 본다. 프로필 상한을 그대로 쓰면
     *    이미 낸 몫 위에 하루 상한이 통째로 다시 얹힌다.
     */
    dailyCap: Math.max(0, scaleTargetOf(stage) - axisPublishedToday),
  })
  /**
   * 🔴 **오늘 이미 낸 수와 남은 슬롯을 넘긴다** (2026-09-21 보정).
   *    넘기지 않으면 회차마다 하루치 전체를 다시 요구해,
   *    마지막 슬롯에서 재고가 줄었다는 이유로 그날 목표를 못 채운다.
   */
  const verdict = judgeOneDayCanary(sim, {
    publishedToday: axisPublishedToday,
    slotsLeft: slotsLeftToday(stage, axisNow),
  })
  return { sim, verdict }
}

/**
 * 🔴 **하루짜리 첫 시험 판정** — 허가된 단계에 대해서만 만든다.
 *    허가가 없으면 판정 자체를 만들지 않는다.
 */
const canaryAuth = canaryAuthorization(process.env, axisNow, RELEASE_STAGES)
const canaryDay = canaryAuth.activeToday && canaryAuth.stage !== null ? dayFor(canaryAuth.stage) : null
const canaryVerdict = canaryDay?.verdict ?? null
/**
 * 🔴 **기간형 제한 운영** — 하루짜리와 같은 그날치 판정을 쓰되, 기간 안이면 켠다.
 */
const windowAuth = windowAuthorization(process.env, axisNow, RELEASE_STAGES)
const windowDay = windowAuth.activeToday && windowAuth.stage !== null ? dayFor(windowAuth.stage) : null
const windowVerdict = windowDay?.verdict ?? null
const scale = installFromEnv(process.env, {
  readiness,
  canary: { now: axisNow, verdict: canaryVerdict },
  window: {
    now: axisNow, verdict: windowVerdict, dayVerdict: windowVerdict,
    publishedToday: axisPublishedToday,
  },
})
// 🔴 여기서부터 쓰기 판정에 쓰이는 값은 전부 `scale` 에서 나온다
const RELEASE_DAILY_CAP = scale.releaseProfile.dailyTarget
const RELEASE_CAPS = {
  postsPerWeek: effectiveWeeklyCap(scale.releaseProfile.postsPerWeek, scale.releaseProfile.minDaysBetween),
  minDaysBetween: scale.releaseProfile.minDaysBetween,
}
console.log(`\n③-c 규모 설정  ${describeScale(scale)}`)
for (const n of scale.notes) console.log(`     · ${n}`)
console.log(`     적용된 발행 상한  일 ${RELEASE_DAILY_CAP}건 · persona 주 ${RELEASE_CAPS.postsPerWeek}건`
  + ` · 최소 ${RELEASE_CAPS.minDaysBetween}일`)
if (scale.throttledByReadiness) console.log('     🔴 준비도 미달로 감속됐다 — 이 값이 실제로 적용된다')
/**
 * 🔴 **시험 회차임을 숨기지 않는다.** 이 줄이 없으면 로그만 보고
 *    "d3 이 준비됐구나" 로 읽힌다 — 그것이 정확히 막으려는 오해다.
 */
if (canaryVerdict !== null) {
  console.log(`     ③-e 하루짜리 첫 시험 판정  ${canaryVerdict.stage}`
    + ` · 오늘 ${canaryVerdict.published}/${canaryVerdict.want}건 발행`
    + ` · 남은 슬롯 ${canaryVerdict.slotsLeft}`
    + ` · 이 회차 필요 ${canaryVerdict.need}건 · 낼 수 있는 것 ${canaryVerdict.can}건`
    + ` · ${canaryVerdict.ok ? 'GO' : '🔴 NO-GO'}`)
  for (const r of canaryVerdict.reasons) console.log(`        🔴 ${r}`)
}
if (windowVerdict !== null) {
  console.log(`     ②-w 기간형 판정  ${windowVerdict.stage} · ${windowAuth.from} ~ ${windowAuth.until}`
    + ` · 오늘 ${windowVerdict.published}/${windowVerdict.want}건 · 낼 수 있는 것 ${windowVerdict.can}건`)
  console.log('     🔴 기간형은 14일 지속 운영 기준을 충족했다는 뜻이 아니다')
}
if (scale.canaryStage) {
  console.log('     🔴 **이 회차는 하루짜리 첫 시험이다** — 지속 D3 승격이 아니다')
  console.log(`        14일 누적·공백·재고 조건은 그대로 미달이다 (허가 날짜 ${scale.canaryDate})`)
}

// 🔴 확정된 release cap · **지금 시각**으로 계획한다. 관제·예측이 부르는 함수와 같다
const prepared = prepareCandidates({
  candidates: queueCandidates, personas, caps: RELEASE_CAPS, at: axisNow,
})

/**
 * 🔴 **배정은 준비 함수가 이미 했다** — 우선순위(복구 → hot → warm → 상시 적합도)를
 *    반영한 최대 매칭이다. 여기서 다시 돌리면 hold 된 글이 자리를 선점한다.
 */
const batch = prepared.batch
const assignOf = new Map(batch.assignments.map((a) => [a.queueId, a]))

console.log(`\n③ persona 배정 가능성 (active ${personas.length}명)`)
for (const t of targets) {
  const rec = assignOf.get(t.id)
  if (rec?.recovery === true) {
    console.log(rec.recoveryProblem === null
      ? `   ${t.id} → ${rec.assigned} (이미 배정돼 있다 — 재배정하지 않는다)`
      : `   ${t.id} — 🔴 ${rec.recoveryProblem}`)
    continue
  }
  const a = assignOf.get(t.id)
  const plan = planStore({
    status: t.status as never, createdPostId: t.createdPostId,
    // 🔴 seed 는 queue id 다 — match-assign 과 같아야 같은 결과가 나온다
    seed: t.id,
    assigned: a?.assigned ?? null, eligible: a?.eligible ?? [], top: a?.top ?? [], blockedCount: a?.blocked.length ?? 0,
  })
  console.log(plan.ok
    ? `   ${t.id} → ${plan.personaCode} (${plan.meta.total}점)`
    : `   ${t.id} — 🔴 ${plan.reason}`)
}

/**
 * ── ③-d 🔴 **준비 결과를 화면에 적는다** (2026-09-08) ──
 *
 *    자동 대상 · hold 목록 · 순서는 위 ②-b 에서 이미 `prepareCandidates` 가 만들었다.
 *    러너가 여기서 다시 정하지 않는다 — 관제·예측과 갈리지 않기 위해서다.
 */
console.log(`\n③-d 신선도  ${describePrepared(prepared)}`)
// 🔴 뺀 것은 **사람 검수**로 간다. 지운 것도 상태를 바꾼 것도 아니다
for (const h of prepared.held) {
  console.log(`   ⏸️  ${h.queueId}  [${h.hold}] ${h.reason}`)
}
if (prepared.held.length > 0) {
  console.log('   🔴 위 행은 자동 발행에서만 빠졌다 — 큐에 그대로 있고 사람이 확인해야 한다')
}
const orderById = new Map(prepared.auto.map((c, i) => [c.queueId, i]))
const freshOrdered = targets
  .filter((t) => orderById.has(t.id))
  .sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!)

// ── ③-a 🔴 기존 배정이 깨졌으면 **여기서 멈춘다** ──
//    없는 persona · 비활성 · 실계정이 붙은 사람을 가리키는 배정은 조용히 바꾸지 않는다.
//    바꾸면 화면이 보여준 사람과 실제로 글을 쓴 사람이 달라진다
const brokenRecovery = targets
  .map((t) => ({ id: t.id, problem: assignOf.get(t.id)?.recoveryProblem ?? null }))
  .filter((x) => x.problem !== null)
if (brokenRecovery.length > 0) {
  console.log(`\n🔴 기존 배정을 쓸 수 없습니다 — ${brokenRecovery.length}건. 아무것도 발행하지 않습니다.`)
  for (const b of brokenRecovery) console.log(`   ${b.id}  ${b.problem}`)
  await prisma.$disconnect()
  fail('배정 정합이 깨졌습니다 — 사람이 확인해야 합니다')
}

// ── ③-b 🔴 이번에 나갈 한 건 — **복구가 먼저, 그다음 배정이 있는 첫 글** ──
const { picked, recovered, skipped, waiting } = pickPublishTarget({
  // 🔴 신선도로 다시 세운 줄이다 — 복구는 그 안에서도 맨 앞이다
  ordered: freshOrdered,
  assignedOf: (id) => assignOf.get(id)?.assigned ?? null,
  isRecovery: (id) => assignOf.get(id)?.recovery === true,
})
if (skipped.length > 0) {
  // 🔴 건너뛴 글을 숨기지 않는다. 지우지도 상태를 바꾸지도 않았고, 다음 회차에 다시 맨 앞이다
  console.log(`\n   ⏭️  이번에 나가지 않는 앞줄 ${skipped.length}건 (상태 그대로 · 다음 회차 재시도)`)
  for (const sk of skipped) {
    const a = assignOf.get(sk.id)
    const why = a?.assigned != null
      ? '배정은 있으나 이번 회차는 복구가 먼저다'
      : (a?.eligible.length ?? 0) > 0
        ? `후보 ${a?.eligible.length}명이 모두 이번 배치에서 소진됐다`
        : '생활사 조건에 맞는 persona 가 없다'
    console.log(`      ${sk.id}  ${why}`)
  }
}
if (picked !== null) {
  console.log(`\n   🎯 이번에 나갈 1건  ${picked.id} → ${assignOf.get(picked.id)?.assigned ?? '?'}`
    + `${recovered ? '  🔧 복구 — 이전 회차가 배정만 하고 발행하지 못한 행이다' : ''}`)
  console.log(`      제목 ${brief(picked.title)} · 본문 ${[...picked.body].length}자 · ${picked.sourceSite}`)
  console.log(`      줄 순서 기준 ${(picked.decidedAt ?? picked.createdAt).toISOString()}`)
}
if (waiting.length > 0) {
  console.log(`   ⏳ 다음 회차 대기 ${waiting.length}건 — 오래 기다린 순`)
}

// ── ④ 오늘 상황 ──
// 🔴 KST 자정은 기존 함수를 쓴다 (publish-live 와 같은 것) —
//    setUTCHours(-9) 는 UTC 15시 이후에 어제로 밀려 cap 을 잘못 센다
const dayStart = kstDayStart(new Date())
const publishedToday = await prisma.personaActivityLog.count({ where: { kind: 'post', createdAt: { gte: dayStart } } })
const sw = await prisma.personaGlobalSwitch.findUnique({ where: { id: 'global' }, select: { enabled: true } })
const killed = sw?.enabled === true
console.log(`\n④ 오늘(${kst(new Date())}) 발행 ${publishedToday} / ${RELEASE_DAILY_CAP}건 · 전체 중지 ${killed ? '🔴 켜짐' : '꺼짐'}`)

// ── ⑤ 실행 판정 ──
/**
 * 🔴 **"이 회차가 내 슬롯인가" 가 아니라 "밀린 슬롯이 있는가" 를 묻는다** (2026-09-14).
 *
 *    예약 하나가 배달되지 않으면 옛 질문으로는 그 사실을 영원히 알 수 없다 —
 *    물어볼 run 자체가 없기 때문이다. 실측으로 2026-09-14 에 그렇게 하루가 비었다.
 *    지금은 어느 run 이 오든 **도래한 슬롯 − 오늘 발행 수**를 보고 밀린 것을 메운다.
 */
const catchUp = judgeCatchUp({
  stage: scale.releaseStage,
  now: new Date(),
  trigger: TRIGGER,
  cron: SLOT_CRON,
  publishedToday,
})
const slot = { run: catchUp.run, reason: catchUp.reason }
console.log(`   트리거 ${TRIGGER} · 회차 ${catchUp.slotKst ?? '(정시)'}`
  + ` · 도래 ${catchUp.dueCount}건 · 발행 ${catchUp.publishedToday}건 · 밀림 ${catchUp.backlog}건`)
console.log(`   판정 ${catchUp.reason}`)
if (catchUp.due.length > 0) {
  console.log(`   도래한 슬롯  ${catchUp.due.map((d) => d.kst).join(' · ')}`)
}

/**
 * 🔴 **그날 문이 쓰는 판정은 "실제로 설치된 단계" 의 것이다** (2026-09-22 보정).
 *
 *    앞판은 언제나 `windowVerdict` 를 썼다. D3 기간 운영과 D5 하루 시험이 겹치면
 *    `resolveScale` 은 d5 를 설치하는데 문은 **d3 판정**(`can` 이 3−발행수)을 보고
 *    **4·5번째 글을 "재고가 없다" 로 막았다.** 상한은 5인데 3에서 멈추는 모양이다.
 *
 * 🔴 그래서 설치가 끝난 뒤 **그 단계로 다시 판정한다.** 판정을 만드는 함수는 하나뿐이라
 *    창이 달라지지 않는다. 허가가 하나도 없는 날에는 `null` 이고, 그때 동작은 이전과 같다.
 */
const effectiveDay = (canaryAuth.activeToday || windowAuth.activeToday)
  ? (scale.releaseStage === windowAuth.stage ? windowDay
    : scale.releaseStage === canaryAuth.stage ? canaryDay
      : dayFor(scale.releaseStage))
  : null
const effectiveVerdict = effectiveDay?.verdict ?? null

/**
 * 🔴 **그날 판정 — 로그가 아니라 문이다** (2026-09-22).
 *
 * 🔴 여기서 쓰는 발행 수는 위의 `axisPublishedToday` 가 아니라 **바로 위에서 DB 로 센**
 *    `publishedToday` 다. 상한을 지키는 값과 그날을 닫는 값이 다르면 둘 중 하나는 거짓말이다.
 *
 * 🔴 **후보별 제외와 배관 결함을 섞지 않는다** (2026-09-22 보정).
 *
 *    앞판은 `SAFETY` 로 빠진 행이 **한 건이라도** 있으면 그날을 전면 중단했다.
 *    그런데 안전 판정 실패는 **그 행 하나의 문제**다 — 이미 `selectAutoTargets` 가
 *    그 행만 빼고 나머지를 넘긴다. 그것을 다시 전면 중단으로 올리면
 *    **멀쩡한 다른 후보의 발행까지 한 줄 때문에 멎는다.** 공급이 조용히 0 이 되는 모양이다.
 *
 *    · 후보별 제외 (막지 않는다) — SAFETY · GATE · PROFILE · HUMAN_REVIEW_REQUIRED …
 *    · 배관 결함 (그날을 닫는다) — 상한을 이미 넘겨 버렸다 · 기배정 복구가 깨졌다
 *
 * 🔴 **정산 결함은 이 러너에서 관측되지 않는다** — LLM 장부는 공급 경로에 있고
 *    이 러너는 장부를 읽지 않는다. 여기서 "정산도 봤다" 고 적으면 거짓이 된다.
 */
/** 🔴 조립은 `src/lib` 한 함수가 한다 — 러너 안에 두면 검사가 닿지 않는다 */
const defects = judgePublishDefects({
  publishedToday, dailyCap: RELEASE_DAILY_CAP,
  recoveryBroken: effectiveDay?.sim.recoveryBroken ?? 0,
  rejected,
})
const hardDefects = defects.hardDefects
/** 🔴 안전 실패는 **세어서 보여 주되 막지 않는다** — 그 행은 이미 빠져 있다 */
const safetyRejects = rejected.filter((r) => r.code === 'SAFETY')
if (safetyRejects.length > 0) {
  console.log(`   ⚠️ 안전 판정으로 제외된 후보 ${safetyRejects.length}건`
    + ' — 그 행만 빠진다. 남은 후보의 발행은 막지 않는다')
}
const dayGuard = effectiveVerdict === null ? null : judgeDayGuard({
  publishedToday,
  dailyTarget: RELEASE_DAILY_CAP,
  publishable: effectiveVerdict.can,
  hardDefects,
})
if (dayGuard !== null) {
  console.log(`   ②-g 그날 판정  ${dayGuard.allow ? 'GO' : '중단'}${dayGuard.halt ? ' 🔴 전면' : ''}`
    + ` — ${dayGuard.reason}`)
  console.log('   🔴 정산 결함은 이 러너에서 보지 않는다 — 장부는 공급 경로에 있다')
}

const gate = judgeApply({ targets, picked, apply: APPLY, limit: LIMIT, publishedToday, dailyCap: RELEASE_DAILY_CAP, killSwitchEnabled: killed, slot, dayGuard })
if (!gate.ok) {
  console.log(`\n⑤ 발행하지 않는다 — ${gate.reason}`)
  if (!APPLY) console.log('   🟡 dry-run 입니다. DB write 0 · Post 0 · 실행하려면 --apply 와 --limit=1 을 둘 다 붙이세요.')
  console.log()
  await prisma.$disconnect()
  process.exit(0)
}

const target = gate.target
console.log(`\n⑤ 🔴 실행 — ${target.id}`)

// ── ⑥ 배정 (없을 때만) ──
// 🔴 기존 배정 행은 여기 들어오지 않는다 — matchedPersonaId · matchedAt · matchMeta 를 다시 쓰지 않는다.
//    다시 쓰면 matchedAt 이 밀려 주간 여력이 한 번 더 열리고, 이력이 두 번 세어진다
if (target.matchedPersonaId === null) {
  const a = assignOf.get(target.id)
  const plan = planStore({
    status: target.status as never, createdPostId: target.createdPostId,
    seed: target.id,
    assigned: a?.assigned ?? null, eligible: a?.eligible ?? [], top: a?.top ?? [], blockedCount: a?.blocked.length ?? 0,
  })
  if (!plan.ok) { await prisma.$disconnect(); fail(`배정할 수 없습니다 — ${plan.reason}`) }
  const persona = await prisma.persona.findUniqueOrThrow({ where: { code: plan.personaCode }, select: { id: true } })
  // 🔴 조건부 UPDATE — 읽은 뒤 쓰는 사이에 누가 배정했으면 0건이 되어 멈춘다
  const u = await prisma.originalPostApprovalQueue.updateMany({
    where: { id: target.id, status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null, matchedPersonaId: null },
    data: { matchedPersonaId: persona.id, matchedAt: new Date(), matchMeta: plan.meta as never },
  })
  if (u.count !== 1) { await prisma.$disconnect(); fail('배정 중 상태가 바뀌었습니다. 아무것도 발행하지 않았습니다.') }
  console.log(`   ✅ 배정 ${plan.personaCode} (${plan.meta.total}점)`)
}

// ── ⑦ 발행 — 🔴 되돌릴 수 없다 ──
// 🔴 상한을 주입한다 — 트랜잭션 안 재판정도 같은 값을 쓴다
const res = await publishOriginalPostTx(prisma, { queueId: target.id, publishedToday, dailyCap: RELEASE_DAILY_CAP })
if (res.kind !== 'published') {
  await prisma.$disconnect()
  fail(res.kind === 'blocked' ? `발행이 막혔습니다 — ${res.code} · ${res.detail}` : `발행 오류 — ${res.message}`)
}
// 🔴 화면이 예고한 사람과 실제로 글을 쓴 사람이 같아야 한다.
//    다르면 사람은 어느 쪽을 믿을지 모르고, 복구 계약이 조용히 깨진 것이다
const announced = assignOf.get(target.id)?.assigned ?? null
if (announced !== null && res.personaCode !== announced) {
  await prisma.$disconnect()
  fail(`🔴 예고한 persona(${announced}) 와 발행된 persona(${res.personaCode}) 가 다릅니다`)
}
console.log(`   ✅ Post ${res.postId} · ${res.personaCode} · ${res.boardType}`)
console.log(`   https://soransoran.com/community/free/${res.postId}`)
console.log('   🔴 이 글은 검색에 노출됩니다 — sitemap 에 실립니다')

// ── ⑧ 정합 확인 ──
const after = await prisma.originalPostApprovalQueue.findUniqueOrThrow({
  where: { id: target.id }, select: { status: true, createdPostId: true, matchedPersona: { select: { id: true } } },
})
const postExists = after.createdPostId !== null
  && (await prisma.post.count({ where: { id: after.createdPostId } })) === 1
const logCount = await prisma.personaActivityLog.count({
  where: { personaId: after.matchedPersona?.id, kind: 'post', createdAt: { gte: dayStart } },
})
const v = verifyAfterPublish({
  queueStatus: after.status, createdPostId: after.createdPostId, postExists, activityLogCount: logCount,
})
console.log(`\n⑥ 정합 ${v.ok ? '✅ 통과' : '🔴 이상'}`)
for (const p of v.problems) console.log(`   🔴 ${p}`)
console.log(`   Queue ${after.status} · createdPostId ${after.createdPostId} · ActivityLog ${logCount}건`)
console.log('\n   🔴 되돌리려면 내리는 것(status=HIDDEN)이지 없던 일이 되지 않습니다.\n')

await prisma.$disconnect()
process.exit(v.ok ? 0 : 1)
