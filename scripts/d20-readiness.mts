#!/usr/bin/env tsx
/**
 * 🔴 **D20 준비도 — read-only** (2026-10-15 · CURRENT P20 · C20 · D20)
 *
 *   npm run d20:readiness                              # 지금 수치로 D20 preflight(오늘 증명일 슬롯 기준)
 *   npm run d20:readiness -- --date=YYYY-MM-DD         # 그 날짜를 증명일로 보고 판정
 *   npm run d20:readiness:next-day                     # 다음 자연 증명일을 명시해 전날 밤 리허설
 *   npm run d20:readiness -- --d10-date=YYYY-MM-DD     # + D10 증명일 실측으로 D20 추가 댓글 profile 후보 산출
 *   npm run d20:readiness -- ... --profile-out=<path>  # 후보(승인 전) JSON 을 그 경로에 쓴다 — 유일한 write
 *   npm run d20:readiness -- --json
 *
 * 🔴 **DB write 0 · provider 0 · env · job · stage 변경 0.** controller 와 **같은 판독기 · 같은 판정**을 d20 에 대고 부른다
 *    (`readPreflightFacts` · `judgeNextPreflight`). 새 문턱을 만들지 않는다.
 * 🔴 D10 증명일 운영 증거는 정본 read-only 명령(`stage:controller -- --evidence-date=<날짜> --json`)의 판정을 그대로 받는다 —
 *    StageDecision adapter 를 여기서 다시 import 하지 않는다(adapter 호출 자리는 잠겨 있다 · `stage:ladder-check`).
 * 🔴 profile 후보는 `deriveFollowupProfile` 하나가 만든다 — 승인칸이 비어 있어 설치해도 0건(fail-closed)이다.
 *    운영 장부 · 증거가 있는 보조 Mac runtime 에서 돌려야 실측이 선다. 다른 기계에서는 모름(UNKNOWN)으로 나온다.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

import { profileOf, releaseCapsOf } from '../src/lib/scale-profile'
import { kstDateString } from '../src/lib/release-canary'
import { isCalendarDate, previousKstDate } from '../src/lib/stage-decision-contract'
import { errorSignalOf } from '../src/lib/stage-controller'
import { auditAwareGate } from '../src/lib/auto-ready-audit-store'
import { judgeNextPreflight, slotTimesOn } from '../src/lib/stage-ladder-generic'
import { PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET } from '../src/lib/d100-capacity'
import { AUTO_PERSONA_COMMENTS_PER_POST_MAX } from '../src/lib/persona-comment-auto-lane'
import {
  FOLLOWUP_KEY_PREFIX, FOLLOWUP_PROFILE_ENV, readFollowupProfileRaw, validateFollowupProfile,
} from '../src/lib/persona-comment-followup'
import { deriveFollowupProfile, type FollowupMeasure } from '../src/lib/followup-profile-derive'
import type { LedgerEntry } from '../src/lib/llm-ledger'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { observeJob, publishFailing, readProcessRuns, supplyFailing, SUPPLY_DATA_DIR } from './lib/runner-health.mjs'
import { PUBLISH_RUN_MAX_AGE_MS, readPublishRunRecord } from './lib/publish-run-record.mjs'
import { fillDbConnection, readEnvKeys } from './lib/ops-signals.mjs'
import { readPreflightFacts, PREFLIGHT_ENV_KEYS, RUNNER_GRID } from './lib/stage-preflight-facts.mjs'
import { readContractValidPersonas } from './lib/persona-reserve-facts.mjs'
import { commentLoopLedgerDir } from './lib/persona-comment-loop.mjs'
import { ledgerPathOf, readLedgerDay } from './lib/llm-ledger-store.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const arg = (k: string): string | null => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null
const fail = (m: string): never => { console.error(`🔴 ${m}`); process.exit(1) }
if (argv.some((a) => a === '--apply' || a === '--write' || a === '--execute')) fail('이 도구는 읽기만 한다 — 적용 명령이 없다')
const JSON_OUT = argv.includes('--json')
const NOW = new Date()
const EXPLICIT_DATE = arg('date')
const NEXT_DAY = argv.includes('--next-day')
if (NEXT_DAY && EXPLICIT_DATE !== null) fail('--next-day 와 --date 는 함께 쓰지 않는다')
const nextCalendarDate = (date: string): string => {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const TODAY = kstDateString(NOW)
const DATE = EXPLICIT_DATE ?? (NEXT_DAY ? nextCalendarDate(TODAY) : TODAY)
const D10_DATE = arg('d10-date')
const PROFILE_OUT = arg('profile-out')
if (!isCalendarDate(DATE)) fail(`달력에 없는 날짜 — ${DATE}`)
if (D10_DATE !== null && !isCalendarDate(D10_DATE)) fail(`달력에 없는 날짜 — ${D10_DATE}`)
const TARGET = 'd20' as const

/** 🔴 controller 의 `observeErrors` 와 같은 관측 — launchctl 조회만(read-only) */
function runnerHealth(): ReturnType<typeof errorSignalOf> {
  const pub = observeJob('com.soransoran.original-post-runner')
  const sup = observeJob('com.soransoran.supply-process')
  return errorSignalOf([
    { label: pub.label, loaded: pub.state === 'loaded', failing: publishFailing(pub, readPublishRunRecord(), NOW, PUBLISH_RUN_MAX_AGE_MS) },
    { label: sup.label, loaded: sup.state === 'loaded', failing: supplyFailing(sup, readProcessRuns().runs) },
  ])
}

/** 🔴 그날 댓글 장부의 한 레인 — 정산 줄 · 정산 합 · 열린 예약(reserved · usageUnknown). 못 읽으면 null */
function laneOf(entries: readonly LedgerEntry[] | null, stage: LedgerEntry['stage']): { settled: number; settledUsd: number; open: number } | null {
  if (entries === null) return null
  const xs = entries.filter((e) => e.stage === stage)
  return {
    settled: xs.filter((e) => e.status === 'settled' && e.settledUsd !== null).length,
    settledUsd: xs.reduce((n, e) => n + (e.status === 'settled' && e.settledUsd !== null ? e.settledUsd : 0), 0),
    open: xs.filter((e) => e.status === 'reserved' || e.status === 'usageUnknown').length,
  }
}

await loadEnvLocal()
if (!fillDbConnection()) fail('DATABASE_URL 이 없다')
const prisma = new PrismaClient()
const out: Record<string, unknown> = { date: DATE, target: TARGET }
try {
  // ── ① Persona ──
  const personas = await readContractValidPersonas(prisma, { now: NOW, repoRoot: process.cwd() })
  out.persona = { contractValid: personas, canaryFloor: PERSONA_CANARY_FLOOR[TARGET], sustainedTarget: PERSONA_SUSTAINED_TARGET[TARGET] }

  // ── ② D20 preflight — controller 와 같은 조립 ──
  const evidenceDate = previousKstDate(DATE) ?? fail('전날을 계산하지 못했다')
  const health = runnerHealth()
  const pe = readEnvKeys(PREFLIGHT_ENV_KEYS)
  const autoOpen = await auditAwareGate(prisma, pe.values, NOW)
  const stock = await loadPublishableStock(prisma, NOW, { autoReadyOpen: autoOpen.open })
  const prof = profileOf(TARGET)
  const r = await readPreflightFacts(prisma, {
    loaded: stock, autoOpen, proofSlots: slotTimesOn(DATE, prof), caps: releaseCapsOf(prof), evidenceDate,
    env: pe.values, dataDir: SUPPLY_DATA_DIR, now: NOW, runnerHealth: health.health,
    contractValidPersonas: async () => personas,
  })
  const pf = judgeNextPreflight(TARGET, r.facts, RUNNER_GRID)
  out.preflight = { verdict: pf.verdict, codes: pf.codes, counts: pf.counts, notes: r.notes }

  // ── ③ 추가 댓글 — 지금 설치된 profile · D20 후보 ──
  const env = readEnvKeys([FOLLOWUP_PROFILE_ENV])
  const { readFileSync } = await import('node:fs')
  const installed = readFollowupProfileRaw(env.values, (p) => readFileSync(p, 'utf-8'))
  const installedD20 = validateFollowupProfile(installed, TARGET)
  let measure: FollowupMeasure | null = null
  if (D10_DATE !== null) {
    // 🔴 그날 운영 증거 — 정본 read-only 명령의 판정을 그대로 받는다(못 읽으면 PASS 아님)
    const ev = spawnSync(process.execPath, [...process.execArgv, 'scripts/stage-controller.mts', `--evidence-date=${D10_DATE}`, '--evidence-stage=d10', '--json'], {
      cwd: process.cwd(), encoding: 'utf-8', timeout: 300_000,
    })
    let evidence: { verdict: string; counts?: Record<string, number> } = { verdict: 'UNREAD' }
    let decision: { release?: string } | null = null
    try {
      const j = JSON.parse(ev.stdout.slice(ev.stdout.indexOf('{'))) as { decision: { release?: string } | null; evidence: { verdict: string; counts?: Record<string, number> } }
      evidence = j.evidence
      decision = j.decision
    } catch { /* 판정을 읽지 못했다 — PASS 아님 */ }
    const day = readLedgerDay(ledgerPathOf(commentLoopLedgerDir(), D10_DATE))
    const entries = day.ok ? day.entries : null
    const gte = new Date(`${D10_DATE}T00:00:00+09:00`)
    const lt = new Date(gte.getTime() + 864e5)
    const queued = await prisma.personaApprovalQueue.findMany({
      where: { dedupKey: { startsWith: FOLLOWUP_KEY_PREFIX }, publishedCommentId: { not: null } },
      select: { publishedCommentId: true },
    })
    const ids = queued.map((q) => q.publishedCommentId).filter((x): x is string => x !== null)
    const accepted = ids.length === 0 ? 0 : await prisma.comment.count({ where: { id: { in: ids }, createdAt: { gte, lt } } })
    const fu = laneOf(entries, 'commentFollowupGen')
    const first = laneOf(entries, 'commentGen')
    measure = fu === null || first === null ? null : {
      stage: 'd10', kstDate: D10_DATE, evidenceVerdict: evidence.verdict, installedProfile: installed,
      followup: fu, first, acceptedFollowups: accepted,
      // 🔴 첫 댓글 단가의 분모 — 정본 증거의 실제 공개 첫 댓글 수(장부 요청 수가 아니다)
      acceptedFirstComments: typeof evidence.counts?.firstCommentOk === 'number' ? evidence.counts.firstCommentOk : null,
    }
    out.d10 = { date: D10_DATE, decision: decision?.release ?? null, evidence: evidence.verdict, ledgerRead: entries !== null, followup: fu, first, acceptedFollowups: accepted, acceptedFirstComments: evidence.counts?.firstCommentOk ?? null }
  }
  const derived = deriveFollowupProfile({
    measure, targetStage: TARGET, targetDailyPosts: prof.dailyTarget,
    commentRunsPerDay: RUNNER_GRID.commentSlots.length, contractValidPersonas: personas,
    commentDailyUsdCap: r.facts.commentDailyUsdCap,
  })
  out.followup = { installedD20: installedD20.ok, installedReason: installedD20.ok ? null : installedD20.reason, derive: derived }
  if (PROFILE_OUT !== null) {
    if (derived.candidate === null) fail(`후보가 서지 않았다 — ${derived.verdict} [${derived.codes.join(',')}] · 파일 0`)
    writeFileSync(PROFILE_OUT, `${JSON.stringify(derived.candidate, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    out.profileOut = PROFILE_OUT
  }
} finally {
  await prisma.$disconnect()
}

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2))
} else {
  const p = out.preflight as { verdict: string; codes: string[]; counts: Record<string, number>; notes: string[] }
  const per = out.persona as { contractValid: number | null; canaryFloor: number; sustainedTarget: number }
  const fu = out.followup as { installedD20: boolean; installedReason: string | null; derive: ReturnType<typeof deriveFollowupProfile> }
  const c = p.counts
  console.log(`\n══ D20 준비도 — read-only · 증명일 ${DATE} · DB write 0 ══`)
  console.log(`\n① Persona  계약 유효 ${String(per.contractValid)} · canary 하한 ${per.canaryFloor} · 지속 목표 ${per.sustainedTarget}`)
  console.log(`\n② D20 preflight ${p.verdict}${p.codes.length > 0 ? ` [${p.codes.join(',')}]` : ''}`)
  console.log(`   목표 ${c.target}/일 · 발행 용량 ${String(c.publishCapacity)} · slot-valid 기회 ${String(c.opportunities ?? '모름')}`)
  console.log(`   READY 필요 ${String(c.readyNeededMin ?? '모름')}~${String(c.readyNeededMax ?? '모름')} · 공급 용량 ${String(c.readyCapacity ?? '모름')}`
    + ` (= raw READY ${String(c.readyRaw ?? '?')} × 회차 묶음 × 하루 회차 / 원천 ${String(c.readySources ?? '?')})`)
  console.log(`   첫 댓글 ${c.firstComments} (= 목표 × ${AUTO_PERSONA_COMMENTS_PER_POST_MAX}) · 예산 가능 ${String(c.commentAffordable ?? '모름')} · 러너 용량 ${String(c.commentRunnerCapacity)}`)
  console.log(`   감사 ${c.auditExpected}건 · 공급 결과당 $${String(c.usdPerSlotValidResult ?? '모름')} · 하루 필요 $${String(c.supplyDailyUsdNeeded ?? '모름')}`)
  for (const n of p.notes) console.log(`   ⬚ ${n}`)
  console.log(`\n③ 추가 댓글 profile  설치된 D20 profile ${fu.installedD20 ? '✅' : `없음 — ${String(fu.installedReason)}`}`)
  if (out.d10 !== undefined) console.log(`   D10 실측 ${JSON.stringify(out.d10)}`)
  const d = fu.derive
  console.log(`   D20 후보 ${d.verdict}${d.codes.length > 0 ? ` [${d.codes.join(',')}]` : ''} · ${JSON.stringify(d.counts)}`)
  if (d.candidate !== null) console.log(`   후보(승인 전 — 설치해도 0건) ${JSON.stringify(d.candidate)}`)
  if (out.profileOut !== undefined) console.log(`   → ${String(out.profileOut)} (0600 · 승인칸 비어 있음)`)
  console.log('\n🟡 read-only — DB write 0 · provider 0 · env · job · stage 0\n')
}
