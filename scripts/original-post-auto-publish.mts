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
 *   … --apply --limit=1 --trigger=local --heartbeat   🔴 heartbeat 후보(설치 전) — 창 밖 생략 · 틱 잠금만 더한다
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
import { DAILY_PUBLISH_CAP, kstDayStart, NORMAL_NO_PUBLISH_CODES } from '../src/lib/original-post-publish'
import { applyScale, describeScale } from '../src/lib/scale-runtime'
import { judgeCatchUp, type TriggerKind } from '../src/lib/publish-slot-catchup'
import { judgeDayGuard } from '../src/lib/release-canary'
import { describePrepared } from '../src/lib/supply-candidates'
import { describeRelease } from '../src/lib/source-slot-release'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { loadPublishableStock, resolvePublishScale, planPublishBatch } from './lib/publishable-stock.mjs'
import { autoReadyEnabled, AUTO_DECIDER } from '../src/lib/auto-ready-v2'
import { authoritativeGate, selectAudits } from '../src/lib/auto-ready-repo'
// 🔴 판정 대기 시한(2026-09-27) — 정본 열림 판정 + 시한 초과 감사. 도장 회차도 시한을 먼저 본다
import { auditAwareGate, stampRoundAuditAware } from '../src/lib/auto-ready-audit-store'
import { HEARTBEAT_FLAG, stageInputsOf, describeStageInputs } from './lib/original-post-runner-template'
import { autoFirstNeeded, proofDayOf } from '../src/lib/stage-proof-day'
import { claimHeartbeatTick, heartbeatInWindow, heartbeatTickKey, HEARTBEAT_TICK_DIR } from './lib/publish-heartbeat-tick.mjs'

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

/**
 * 🔴 **이 회차의 시각 하나** (2026-09-24 마스터 지적). 조립·상한·판정·슬롯이 전부 이 값을 쓴다 —
 *    두 번 만들면 같은 회차 안에서 서로 다른 순간을 본다. 🔴 heartbeat 틱·창 판정도 이 값이다
 *    (2026-09-26) — 틱을 판정한 순간과 재고를 읽은 순간이 달라지지 않게 맨 위로 올렸다.
 */
const RUN_AT = new Date()
/**
 * 🔴 **heartbeat 모드** (2026-09-26 · 후보 — 설치는 별도 승인).
 *    launchd 가 운영 창 안에서 10분마다 깨운다. 깨운다는 것은 **물으러 간다**는 뜻일 뿐이다 —
 *    낼지·몇 건인지는 아래 발행 트랜잭션이 도래 슬롯 − 오늘 발행 수로 정한다(트리거와 무관).
 *    이 블록이 더하는 것은 **줄이는 것 둘**뿐이다 —
 *      ① 창 밖이면 DB 에 붙지 않고 끝낸다(트랜잭션도 SLOT_CLOSED 로 막을 자리다)
 *      ② 같은 10분 틱의 두 번째 wake 는 선택 단계 전에 물러난다(틱 잠금 · `--apply` 일 때만)
 *    🔴 둘 다 발행을 **여는** 길이 아니다. 정시판(플래그 없음)은 이 블록을 지나치고 이전과 같다.
 */
const HEARTBEAT = argv.includes(HEARTBEAT_FLAG)
if (HEARTBEAT) {
  if (TRIGGER !== 'local') fail(`${HEARTBEAT_FLAG} 는 --trigger=local 과만 쓴다 — 지금 ${TRIGGER}`)
  console.log(`\n⓪-h heartbeat 틱 ${heartbeatTickKey(RUN_AT)} (${kst(RUN_AT)})`)
  if (!heartbeatInWindow(RUN_AT)) {
    console.log('   운영 창(08:00~22:00 KST) 밖 heartbeat — DB 0 · 발행 0 · 정상 종료\n')
    process.exit(0)
  }
  if (APPLY) {
    /** 🔴 시험만 다른 디렉터리를 준다 — 운영 plist 인자에는 없다 */
    const dir = argv.find((a) => a.startsWith('--heartbeat-tick-dir='))?.slice(21) ?? HEARTBEAT_TICK_DIR
    const claim = claimHeartbeatTick(dir, RUN_AT)
    if (!claim.ok) {
      if (claim.kind === 'UNWRITABLE') fail(`틱 잠금을 만들지 못했다 — 발행하지 않는다(fail-closed) · ${claim.reason}`)
      console.log(`   ⏭️  TICK_TAKEN — ${claim.reason}`)
      console.log('   🔴 DB 0 · 발행 0 · 정상 종료 — 같은 틱의 다른 wake 가 이미 물으러 갔다\n')
      process.exit(0)
    }
    console.log(`   틱 차지 ${claim.tick}${claim.pruned > 0 ? ` · 지난 날짜 표식 ${claim.pruned}개 정리` : ''}`)
  } else {
    console.log('   dry-run — 틱을 차지하지 않는다(실제 wake 를 막지 않기 위해)')
  }
}

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(APPLY ? '\n══ 🔴 실제 발행 (--apply) ══\n' : '\n══ dry-run (DB write 0 · Post 0) ══\n')
console.log(`  대상 조건  gate=${AUTO_GATE_VERDICT} · ${AUTO_PROMPT_VERSION} / ${AUTO_MODEL} · ${AUTO_SITE_PREFIX}*`)
console.log(`  안전 기본값 일 ${DAILY_PUBLISH_CAP}건 · persona 주 ${POST_CAP_PER_WEEK}건 · 최소 ${MIN_DAYS_BETWEEN_POSTS}일`)
console.log('  🔴 실제 상한은 아래 ③-c 에서 설치한다 — 설치 전에는 이 안전값이다\n')

// ── ① 후보 수집 — 🔴 읽기만 한다 ──
/**
 * 🔴 **조립은 공용 함수 하나가 한다** (2026-09-24 마스터 지적).
 *
 *    앞판은 여기서 직접 select · AutoRow 조립 · Persona 조립 · history 조립을 했고,
 *    관제(`stage:probe`)는 따로 조립했다. 그래서 두 경로가 **같은 DB 를 보고 다른 재고**를
 *    말했다 — probe 가 223건을 재고로 세어 d5 READY 라는 거짓 판정을 냈다.
 *    🔴 이제 러너와 probe 가 `loadPublishableStock` **하나**를 부른다.
 */
/** 🔴 이 회차의 시각은 맨 위 `RUN_AT` 하나다 — heartbeat 틱·창 판정도 같은 값을 쓴다 */
/**
 * 🔴 **자동 READY v2** (2026-09-25). 스위치 **기본 OFF** — 꺼져 있으면 감사 표를 읽지 않고
 *    도장도 찍지 않는다. 그래서 지금 운영 동작은 이 줄이 없던 때와 같다.
 *    켜져 있어도 증거 표본이 계약을 채우고 확정 결함이 0 일 때만 열린다.
 */
const AUTO_READY_ON = autoReadyEnabled(process.env)
/**
 * 🔴 **이 값은 화면·selector 용이다. 쓰기의 근거가 아니다.** 도장과 발행 트랜잭션은
 *    각자 자기 트랜잭션 안에서 스위치·DB 증거·확정 결함을 다시 판정한다.
 */
const autoOpen = await auditAwareGate(prisma, process.env, RUN_AT)
if (AUTO_READY_ON) {
  console.log(`\n⓪ 자동 READY ${autoOpen.open ? '🟢 열림' : '🔴 닫힘'}${autoOpen.reasons.length > 0 ? ` — ${autoOpen.reasons.join(' · ')}` : ''}`)
}
if (APPLY && autoOpen.open) {
  // 🔴 기계 도장 행만 — 한 행씩 조건부로 찍는다. 사람 결정 행은 건드리지 않는다
  const tally = await stampRoundAuditAware(prisma, { env: process.env, now: RUN_AT })
  console.log(`   도장 ${[...tally].map(([k, v]) => `${k} ${v}`).join(' · ') || '대상 없음'}`)
}
const stock = await loadPublishableStock(prisma, RUN_AT, { autoReadyOpen: autoOpen.open })
const targets = stock.targets
const rejected = stock.rejected
const codeOfPersonaId = stock.codeOfPersonaId
const personas = stock.personas as never[]

console.log(`① 대기열 ${stock.queueTotal}건 → 자동 발행 후보 ${targets.length}건`)
if (stock.rejectedByCode.length > 0) {
  const total = stock.rejectedByCode.reduce((n, r) => n + r.count, 0)
  console.log(`\n② 제외 ${total}건 — 🔴 legacy 글이 섞이지 않는다`)
  for (const r of stock.rejectedByCode) {
    console.log(`   ${String(r.count).padStart(2)}건  ${REJECT_LABEL[r.code as keyof typeof REJECT_LABEL] ?? r.code}`)
  }
}

/**
 * ── ②-b 🔴 **후보 준비 — 관제 · 공급 · preflight 와 같은 함수다** ──
 *    공개 가치 판정은 정본 `judgeSlotRelease` 하나다(`prepareCandidates` 안) — 이 회차 시각(= 채울 슬롯)으로 잰다.
 *    🔴 빠진 글은 매칭에 **들어가지 않는다** — persona 자리를 선점하지 못한다.
 */
/**
 * ── ③-c 🔴 **규모 설정 설치 — 결정 하나** ──
 *    consumer 가 그날 StageDecision 의 `release` · `capacity` 를 env 로 넣었다. 여기서 준비도 · canary · window 로
 *    다시 올리거나 깎지 않는다(2026-09-30 · 옛 권위 삭제). 설치는 이 러너에서 한 번뿐이다.
 */
const axisNow = RUN_AT
const resolved = resolvePublishScale({ env: process.env, loaded: stock, now: axisNow })
console.log(`\n③-s 단계 입력  ${describeStageInputs(stageInputsOf(process.env, axisNow))} · 트리거 ${TRIGGER}${HEARTBEAT ? ' · heartbeat' : ''}`)
applyScale(resolved.scale)
const scale = resolved.scale
const RELEASE_DAILY_CAP = resolved.dailyCap
const RELEASE_CAPS = resolved.caps
console.log(`\n③-c 규모 설정  ${describeScale(scale)}`)
for (const n of scale.notes) console.log(`     · ${n}`)
console.log(`     적용된 발행 상한  일 ${RELEASE_DAILY_CAP}건 · persona 주 ${RELEASE_CAPS.postsPerWeek}건`
  + ` · 최소 ${RELEASE_CAPS.minDaysBetween}일`)

/**
 * 🔴 **단계 증명일 — 목표 슬롯을 자동 target 이 먼저** (2026-09-29 마스터 결정 · `stage-proof-day`).
 */
const proofDay = proofDayOf(process.env, RUN_AT)
const proofAutoNeeded = autoFirstNeeded(proofDay, stock.autoTargetsToday ?? 0)
console.log(proofDay === null
  ? '\n③-p 단계 증명일 아님 — 기존 human/auto 공정성'
  : `\n③-p 단계 증명일 ${proofDay.stage} · 자동 target 오늘 ${stock.autoTargetsToday ?? 0}/${proofDay.target}`
    + (proofAutoNeeded > 0 ? ` · 🔴 자동 먼저(${proofAutoNeeded}건 더)` : ' · 목표를 채웠다 — 남는 슬롯은 기존 공정성'))

// ── ④ 오늘 상황 — 🔴 KST 자정은 기존 함수를 쓴다 ──
const dayStart = kstDayStart(RUN_AT)
const publishedToday = await prisma.personaActivityLog.count({ where: { kind: 'post', createdAt: { gte: dayStart } } })
const sw = await prisma.personaGlobalSwitch.findUnique({ where: { id: 'global' }, select: { enabled: true } })
const killed = sw?.enabled === true
console.log(`\n④ 오늘(${kst(RUN_AT)}) 발행 ${publishedToday} / ${RELEASE_DAILY_CAP}건 · 전체 중지 ${killed ? '🔴 켜짐' : '꺼짐'}`)

/**
 * 🔴 **"이 회차가 내 슬롯인가" 가 아니라 "밀린 슬롯이 있는가" 를 묻는다** (2026-09-14).
 */
const catchUp = judgeCatchUp({
  stage: scale.releaseStage,
  now: RUN_AT,
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
 * ── ⑤ 🔴 **선택 → 트랜잭션 → (만료면) 같은 회차에서 다음 후보로 교체** (2026-09-30 · source-slot-v1) ──
 *
 *    발행 트랜잭션이 같은 정본 판정을 트랜잭션 시계로 다시 부른다. 그 사이 원천 가치가 사라졌으면(나이 · 증거 모름)
 *    트랜잭션이 그 행만 EXPIRED 로 옮기고 `expired` 를 돌려준다 — Post · ActivityLog 0 · 슬롯은 소비되지 않았다.
 *    그러면 **그 행을 빼고 다시 계획해** 다음 순위 후보로 같은 슬롯을 채운다. 교체는 행마다 하나씩 줄어드는 유한 루프다.
 *    🔴 후보가 없으면 오래된 글로 채우지 않는다 — `SLOT_UNFILLED` 로 끝낸다(fail-closed · 원인 코드 · exit 0).
 *    🔴 이미 비용을 쓴 초안이라고 살리지 않는다.
 */
const replaced: { id: string; reasons: string[] }[] = []
const excluded = new Set<string>()
let res: Awaited<ReturnType<typeof publishOriginalPostTx>> | null = null
let target: AutoRow | null = null
let assignOf: ReturnType<typeof planPublishBatch>['assignOf'] = new Map()
for (let attempt = 0; attempt <= stock.targets.length; attempt += 1) {
  const view = excluded.size === 0 ? stock : {
    ...stock,
    targets: stock.targets.filter((t) => !excluded.has(t.id)),
    queueCandidates: stock.queueCandidates.filter((c) => !excluded.has(c.queueId)),
  }
  const plan = planPublishBatch({ loaded: view, caps: RELEASE_CAPS, at: axisNow, proofAutoNeeded })
  const prepared = plan.prepared
  assignOf = plan.assignOf
  if (attempt === 0) {
    for (const d of plan.autoDeferred) {
      console.log(`   ⏸️  자동 배정 유예  ${d.id}  [${d.codes.join(', ')}] — 시간 상한이 풀리면 다음 회차에 다시 본다`)
    }
    for (const e of plan.autoExceptions) {
      console.log(`   🔴 자동 배정 예외  ${e.id}  [${e.codes.join(', ')}] — 자동 발행에서 뺐다 · 다른 Persona 로 바꾸지 않는다`)
    }
    console.log(`\n③ persona 배정 가능성 (active ${personas.length}명)`)
    for (const t of view.targets) {
      const rec = assignOf.get(t.id)
      if (rec?.recovery === true) {
        console.log(rec.recoveryProblem === null
          ? `   ${t.id} → ${rec.assigned} (이미 배정돼 있다 — 재배정하지 않는다)`
          : `   ${t.id} — 🔴 ${rec.recoveryProblem}`)
        continue
      }
      const ps = planStore({
        status: t.status as never, createdPostId: t.createdPostId, seed: t.id,
        assigned: rec?.assigned ?? null, eligible: rec?.eligible ?? [], top: rec?.top ?? [], blockedCount: rec?.blocked.length ?? 0,
      })
      console.log(ps.ok ? `   ${t.id} → ${ps.personaCode} (${ps.meta.total}점)` : `   ${t.id} — 🔴 ${ps.reason}`)
    }
    console.log(`\n③-d 공개 가치  ${describePrepared(prepared)}`)
    for (const h of prepared.held) {
      console.log(`   ⌛ ${h.queueId}  [${h.hold}] ${h.expires ? '원천 가치 없음 — 만료 예정(사람이 살리는 칸이 아니다)' : h.reason}`)
    }
  }

  // ── ③-a 🔴 기존 배정이 깨졌으면 **여기서 멈춘다** ──
  if (plan.brokenRecovery.length > 0) {
    console.log(`\n🔴 기존 배정을 쓸 수 없습니다 — ${plan.brokenRecovery.length}건. 아무것도 발행하지 않습니다.`)
    for (const b of plan.brokenRecovery) console.log(`   ${b.id}  ${b.problem}`)
    await prisma.$disconnect()
    fail('배정 정합이 깨졌습니다 — 사람이 확인해야 합니다')
  }

  // ── ③-b 🔴 이번에 나갈 한 건 ──
  const { picked, recovered, skipped, waiting } = plan
  if (skipped.length > 0) {
    console.log(`\n   ⏭️  이번에 나가지 않는 앞줄 ${skipped.length}건 (상태 그대로 · 다음 회차 재시도)`)
    for (const sk of skipped) {
      const a = assignOf.get(sk.id)
      const why = a?.assigned != null ? '배정은 있으나 이번 회차는 복구가 먼저다'
        : (a?.eligible.length ?? 0) > 0 ? `후보 ${a?.eligible.length}명이 모두 이번 배치에서 소진됐다`
          : '생활사 조건에 맞는 persona 가 없다'
      console.log(`      ${sk.id}  ${why}`)
    }
  }
  if (picked !== null) {
    console.log(`\n   🎯 이번에 나갈 1건  ${picked.id} → ${assignOf.get(picked.id)?.assigned ?? '?'}`
      + `${recovered ? '  🔧 복구 — 이전 회차가 배정만 하고 발행하지 못한 행이다' : ''}`)
    console.log(`      제목 ${brief(picked.title)} · 본문 ${[...picked.body].length}자 · ${picked.sourceSite}`)
    console.log(`      공개 판정 ${prepared.verdicts.get(picked.id) === undefined ? '—' : describeRelease(prepared.verdicts.get(picked.id)!)}`)
  }
  if (waiting.length > 0) console.log(`   ⏳ 다음 회차 대기 ${waiting.length}건`)

  /**
   * 🔴 **그날 문 — 결함 전면 중단과 후보 부족을 가른다** (정본 `judgeDayGuard` · 언제나 돈다).
   *    · 결함(상한 초과 흔적 · 깨진 복구) → 그날 전면 중단
   *    · 낼 수 있는 후보 0 → 그만 낸다 — 슬롯이 도래했으면 `SLOT_UNFILLED` 원인 코드를 남긴다(오래된 글로 채우지 않는다)
   */
  const defects = judgePublishDefects({
    publishedToday, dailyCap: RELEASE_DAILY_CAP, recoveryBroken: plan.brokenRecovery.length, rejected,
  })
  const dayGuard = judgeDayGuard({
    publishedToday, dailyTarget: RELEASE_DAILY_CAP,
    publishable: picked === null ? 0 : plan.assignmentReady.length, hardDefects: defects.hardDefects,
  })
  const safetyRejects = rejected.filter((r) => r.code === 'SAFETY')
  if (safetyRejects.length > 0 && attempt === 0) {
    console.log(`   ⚠️ 안전 판정으로 제외된 후보 ${safetyRejects.length}건 — 그 행만 빠진다. 남은 후보의 발행은 막지 않는다`)
  }
  console.log(`   ②-g 그날 판정  ${dayGuard.allow ? 'GO' : '중단'}${dayGuard.halt ? ' 🔴 전면' : ''} — ${dayGuard.reason}`)

  const gate = judgeApply({ targets: view.targets, picked, apply: APPLY, limit: LIMIT, publishedToday, dailyCap: RELEASE_DAILY_CAP, killSwitchEnabled: killed, slot, dayGuard })
  if (!gate.ok) {
    console.log(`\n⑤ 발행하지 않는다 — ${gate.reason}`)
    /** 🔴 슬롯이 도래했는데 채울 slot-valid 후보가 없다 — 원인 코드를 값으로 남긴다(관제 · 증거가 읽는다) */
    if (slot.run && !killed && publishedToday < RELEASE_DAILY_CAP && !dayGuard.halt && picked === null) {
      const byReason = new Map<string, number>()
      for (const h of prepared.held) byReason.set(h.hold, (byReason.get(h.hold) ?? 0) + 1)
      console.log(`SLOT_UNFILLED ${JSON.stringify({
        at: RUN_AT.toISOString(), stage: scale.releaseStage, due: catchUp.dueCount, publishedToday,
        eligible: prepared.auto.length, replaced: replaced.length, held: Object.fromEntries(byReason),
      })}`)
      console.log('   🔴 오래된 글로 채우지 않는다 — 다음 공급(JIT)이 슬롯 시점 가치로 채운다')
    }
    if (!APPLY) console.log('   🟡 dry-run 입니다. DB write 0 · Post 0 · 실행하려면 --apply 와 --limit=1 을 둘 다 붙이세요.')
    console.log()
    await prisma.$disconnect()
    process.exit(0)
  }

  target = gate.target
  console.log(`\n⑤ 🔴 실행 — ${target.id}${attempt > 0 ? ` (교체 ${attempt}번째)` : ''}`)

  // ── ⑥ 배정 (없을 때만) ──
  const isAutoTarget = (target.decidedBy ?? '').trim() === AUTO_DECIDER
  let autoAssign: { personaId: string; matchMeta: unknown } | undefined
  if (target.matchedPersonaId === null && isAutoTarget) {
    const a = assignOf.get(target.id)
    const ps = planStore({
      status: target.status as never, createdPostId: target.createdPostId, seed: target.id,
      assigned: a?.assigned ?? null, eligible: a?.eligible ?? [], top: a?.top ?? [], blockedCount: a?.blocked.length ?? 0,
    })
    if (!ps.ok) { await prisma.$disconnect(); fail(`배정할 수 없습니다 — ${ps.reason}`) }
    const persona = await prisma.persona.findUniqueOrThrow({ where: { code: ps.personaCode }, select: { id: true } })
    autoAssign = { personaId: persona.id, matchMeta: ps.meta }
    console.log(`   ⏳ 배정 계획 ${ps.personaCode} — 발행 트랜잭션 안에서 쓴다`)
  } else if (target.matchedPersonaId === null) {
    const a = assignOf.get(target.id)
    const ps = planStore({
      status: target.status as never, createdPostId: target.createdPostId, seed: target.id,
      assigned: a?.assigned ?? null, eligible: a?.eligible ?? [], top: a?.top ?? [], blockedCount: a?.blocked.length ?? 0,
    })
    if (!ps.ok) { await prisma.$disconnect(); fail(`배정할 수 없습니다 — ${ps.reason}`) }
    const persona = await prisma.persona.findUniqueOrThrow({ where: { code: ps.personaCode }, select: { id: true } })
    // 🔴 조건부 UPDATE — 읽은 뒤 쓰는 사이에 누가 배정했으면 0건이 되어 멈춘다
    const u = await prisma.originalPostApprovalQueue.updateMany({
      where: { id: target.id, status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null, matchedPersonaId: null },
      data: { matchedPersonaId: persona.id, matchedAt: RUN_AT, matchMeta: ps.meta as never },
    })
    if (u.count !== 1) { await prisma.$disconnect(); fail('배정 중 상태가 바뀌었습니다. 아무것도 발행하지 않았습니다.') }
    console.log(`   ✅ 배정 ${ps.personaCode} (${ps.meta.total}점)`)
    // 🔴 트랜잭션이 이 행을 다시 읽는다 — 계획 스냅샷의 updatedAt 도 새 값이어야 결속된다
    const fresh = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: target.id }, select: { updatedAt: true } })
    target = { ...target, updatedAt: fresh.updatedAt }
  }

  // ── ⑦ 발행 — 🔴 되돌릴 수 없다 ──
  if (target.updatedAt === undefined) {
    await prisma.$disconnect()
    fail('선택기 스냅샷에 updatedAt 이 없다 — 계획을 트랜잭션에 결속할 수 없어 발행하지 않는다')
  }
  const planned = {
    queueId: target.id, status: target.status, createdPostId: target.createdPostId,
    updatedAt: target.updatedAt!, decidedBy: target.decidedBy,
  }
  res = await publishOriginalPostTx(prisma, {
    queueId: target.id, publishedToday,
    // 🔴 launchd(`local`)·GitHub 예약(`schedule`)만 무인 회차다 — `manual` 은 표식을 남기지 않는다
    mode: { kind: 'scheduled', releaseStage: scale.releaseStage, planned, unattended: TRIGGER === 'local' || TRIGGER === 'schedule' },
    // 🔴 자동 도장 행은 트랜잭션 안에서 스위치·도장·경고·DB 증거·결함을 다시 본다 · 단계 천장도 이 env 다
    autoReadyEnv: process.env,
    // 🔴 자동 행의 배정은 트랜잭션 안에서 쓴다(사람 행은 undefined)
    autoAssign,
  })
  if (res.kind === 'expired') {
    // 🔴 그 행만 EXPIRED 로 옮겨졌다(Post 0 · ActivityLog 0 · 슬롯 그대로) — 같은 회차에서 다음 후보로 교체한다
    console.log(`   ⌛ 만료 — ${res.queueId} [${res.reasons.join(',')}] · 원천 가치가 트랜잭션 시각에 사라졌다 → 다음 후보로 교체`)
    replaced.push({ id: res.queueId, reasons: [...res.reasons] })
    excluded.add(res.queueId)
    continue
  }
  break
}
if (res === null || target === null) {
  await prisma.$disconnect()
  fail('교체 루프가 후보 없이 끝났다 — 발행하지 않았다')
}
/**
 * 🔴 **슬롯 경쟁 패자는 정상 무발행이다 — exit 0.** 그 밖의 차단·오류는 기존처럼 실패다(non-zero).
 */
if (res.kind === 'blocked' && (NORMAL_NO_PUBLISH_CODES as readonly string[]).includes(res.code)) {
  console.log(`\n⑤ 발행하지 않는다 — 정상 무발행 · ${res.code} · ${res.detail}`)
  console.log('   🔴 Post 0 · Queue 변화 0 · ActivityLog 0 — 슬롯은 트랜잭션 안에서 다시 셌다\n')
  await prisma.$disconnect()
  process.exit(0)
}
if (res.kind !== 'published') {
  await prisma.$disconnect()
  fail(res.kind === 'blocked' ? `발행이 막혔습니다 — ${res.code} · ${res.detail}`
    : res.kind === 'expired' ? `교체 한도를 넘었다 — 마지막 후보도 만료 [${res.reasons.join(',')}]`
      : `발행 오류 — ${res.message}`)
}
// 🔴 화면이 예고한 사람과 실제로 글을 쓴 사람이 같아야 한다
const announced = assignOf.get(target.id)?.assigned ?? null
if (announced !== null && res.personaCode !== announced) {
  await prisma.$disconnect()
  fail(`🔴 예고한 persona(${announced}) 와 발행된 persona(${res.personaCode}) 가 다릅니다`)
}
if (replaced.length > 0) console.log(`   🔁 같은 회차 교체 ${replaced.length}건 — ${replaced.map((r) => `${r.id}[${r.reasons.join(',')}]`).join(' · ')}`)
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

/**
 * ── ⑨ 🔴 **사후 감사 선정 — DB 에 남긴다** ──
 *    자동 도장으로 나간 글이 늘었으면 ceil(N×0.2) 까지 모자란 만큼 고른다.
 *    판정 **대기**는 다음 회차를 막지 않는다 — 확정 결함(yes)만 막는다.
 */
let auditIntegrityOk = true
if (AUTO_READY_ON) {
  const au = await selectAudits(prisma)
  console.log(au.kind === 'ok'
    ? `⑨ 감사 선정 — 자동 발행 ${au.n}건 · 목표 ${au.target} · 이번에 고른 ${au.picked.length}건`
    : `⑨ 감사 선정 — ${au.reason}`)
  /**
   * 🔴 **글이 사라진 자동 발행 행을 로그로만 흘리지 않는다** (2026-09-25 마스터 지적).
   *    열림 판정(`missingAutoPostCount`)이 같은 DB 상태를 다시 세서 다음 도장·발행을 닫는다.
   *    이 회차도 실패로 끝낸다 — 성공 종료로 보이면 아무도 보지 않는다.
   */
  if (au.kind === 'ok' && au.missingPost.length > 0) {
    auditIntegrityOk = false
    console.log(`   🔴 무결성 — 글이 사라진 자동 발행 ${au.missingPost.length}건: ${au.missingPost.join(', ')}`)
    const g = await authoritativeGate(prisma, process.env)
    console.log(`   🔴 열림 판정 ${g.open ? '열림 — 🔴 닫혀야 한다' : '닫힘'} · ${g.reasons.join(' · ')}`)
  }
}

await prisma.$disconnect()
process.exit(v.ok && auditIntegrityOk ? 0 : 1)
