#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY v2 — 그림자 측정 (read-only)** (2026-09-25)
 *
 * 🔴 DB write 0 · 네트워크 0(DB 읽기 제외) · LLM 0 · 발행 0 · 도장 0.
 *    운영 변수·flag 를 바꾸지 않는다. 자동 READY 는 **켜지 않은 채** 판정만 재 본다.
 *
 * 무엇을 재나
 *   ① 실제 도장 — `decidedBy = auto-ready:v1` 행 수 (그림자와 섞지 않는다)
 *   ② 그림자 판정 — 셀렉터가 `HUMAN_REVIEW_REQUIRED` 로 거른 기계 후보에 정본 규칙을 대 본다
 *      → 자동 대상 / 예외 묶음(사유별)
 *   ③ 증거 cohort — 사람이 이미 결정한 기계 후보 중 적격 표본 · 무수정 · 중대 결함 표식
 *   ④ D10 — (실제 재고 ∪ 그림자 자동 대상)을 D10 상한으로 배정하면
 *      발행 가능 글 · 서로 다른 Persona · 차단 사유(여력 / 생활사 / 말투 / 기타)
 *
 * 🔴 **그림자 수는 실제 READY 가 아니다.** 보고에서 둘을 같은 줄에 쓰지 않는다.
 */
import { PrismaClient } from '@prisma/client'

import {
  loadPublishableStock, queueCandidateOf, planPublishBatch, releaseCapsOf, resolvePublishScale,
  type LoadedStock,
} from './lib/publishable-stock.mjs'
import { AUTO_DECIDER, CONTRACT, eligibilityOf } from '../src/lib/auto-ready-v2'
import { evidenceFromDb, legacyEvidenceFromDb } from '../src/lib/auto-ready-repo'
import { describeCohort } from '../src/lib/auto-ready-quality-cohort'
import { profileOf } from '../src/lib/original-post-auto-publish'
import { PROFILES } from '../src/lib/scale-profile'
import { simulateStage } from '../src/lib/scale-readiness'
import { judgeOneDayCanary, slotsLeftToday, kstDateString } from '../src/lib/release-canary'

const NOW = new Date()

/** 🔴 차단 사유를 세 갈래로 — 무엇으로 풀리는지가 다르다 */
const CAPACITY = new Set(['WEEKLY_CAP', 'TOO_SOON'])
const LIFE = new Set([
  'NO_CHILDREN', 'CHILD_AGE_CONFLICT', 'CHILD_AGE_UNKNOWN', 'MARITAL_CONFLICT',
  'NO_PARENT_CARE', 'MENOPAUSE_NOT_YET',
])
const bucketOf = (code: string): '여력' | '생활사' | '말투' | '기타' =>
  CAPACITY.has(code) ? '여력' : LIFE.has(code) ? '생활사' : code === 'VOICE_MISMATCH' ? '말투' : '기타'

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY v2 — 그림자 측정 (read-only · DB write 0 · 도장 0) ══')
  console.log(`   기준 ${kstDateString(NOW)} · ${NOW.toISOString()}\n`)

  const s = await loadPublishableStock(prisma, NOW)

  /** ── ① 실제 도장 — 그림자와 섞지 않는다 ── */
  const stamped = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER } })
  const stampedPublished = await prisma.originalPostApprovalQueue.count({
    where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } },
  })
  console.log('① 실제 자동 READY 도장')
  console.log(`   decidedBy=${AUTO_DECIDER}  ${stamped}행 · 그중 발행 ${stampedPublished}행`)

  /** ── ② 그림자 판정 ── */
  const reviewIds = new Set(s.rejected.filter((r) => r.code === 'HUMAN_REVIEW_REQUIRED').map((r) => r.id))
  const shadowRows = s.allRows.filter((r) => reviewIds.has(r.id))
  const verdicts = shadowRows.map((r) => ({
    row: r,
    v: eligibilityOf({
      gateVerdict: r.gateVerdict, gateResults: r.gateResults,
      title: r.title, body: r.body, sourceCapturedAt: s.capturedAtOf.get(r.id) ?? null,
    }),
  }))
  const shadowAuto = verdicts.filter((x) => x.v.auto).map((x) => x.row)
  const exceptions = verdicts.filter((x) => !x.v.auto)
  console.log('\n② 그림자 판정 — 기계 후보(HUMAN_REVIEW_REQUIRED)에 정본 규칙을 대 봤다')
  console.log(`   대상 ${shadowRows.length}건 → 🟢 자동 대상 ${shadowAuto.length} · 🟡 예외 묶음 ${exceptions.length}`)
  const why = new Map<string, number>()
  for (const x of exceptions) for (const r of x.v.reasons) {
    const k = r.replace(/=".*"$/, '').replace(/^경고 .*/, (m) => m.split(',')[0] ?? m)
    why.set(k, (why.get(k) ?? 0) + 1)
  }
  for (const [k, v] of [...why].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(3)}  ${k}`)
  console.log('   🔴 그림자 수는 실제 READY 가 아니다 — 도장은 0 이다')

  /**
   * ── ③ 증거 cohort — **정본 `evidenceFromDb` → `cohortSampleOf` 하나를 부른다** ──
   *    (2026-09-25 마스터 지적) 앞판은 여기서 무수정·수정·폐기를 **따로** 셌다.
   *    런타임 게이트와 probe 가 다른 셈을 하면 "열린다" 는 말이 둘이 된다.
   *    🔴 DB 에 저장된 근거만 센다 — 로컬 artifact 복원 결과는 `auto-ready:evidence-scan` 이 따로 낸다.
   */
  const sample = await evidenceFromDb(prisma)
  console.log('\n③ 증거 cohort — 런타임 게이트와 같은 정본 계산 (DB 저장 근거만)')
  console.log(`   ${describeCohort(sample)}`)
  const legacy = await legacyEvidenceFromDb(prisma)
  console.log(`   legacy(판정 밖 · 감사 이력) 사람 표본 ${legacy.eligible} · 중대 결함 ${legacy.hardDefects === null ? `unmeasured(${legacy.hardDefectUnmeasured})` : legacy.hardDefects} — 지우지도 고치지도 않는다`)
  console.log(`   계약 충족 ${sample.meetsContract ? '🟢 예' : `🔴 아니오 — ${sample.reasons.join(' · ')}`}`)

  /** ── ④ D10 — 실제 재고 ∪ 그림자 자동 대상 ── */
  const d10caps = releaseCapsOf(PROFILES.d10)
  const pool = [...s.targets, ...shadowAuto]
  const poolStock: LoadedStock = {
    ...s,
    targets: pool,
    queueCandidates: pool.map((t, i) =>
      queueCandidateOf(t, i, s.codeOfPersonaId, s.capturedAtOf.get(t.id) ?? null)),
  }
  const plan = planPublishBatch({ loaded: poolStock, caps: d10caps, at: NOW })
  const assignedPersonas = new Set(plan.prepared.batch.assignments
    .filter((a) => a.assigned !== null && (a.recoveryProblem ?? null) === null)
    .map((a) => a.assigned))
  const sim = simulateStage({
    stage: 'd10', queue: poolStock.queueCandidates, personas: s.personas as never,
    history: s.history, axis: { now: NOW, publishedToday: s.publishedToday },
    days: 1, anchor: 'now', dailyCap: Math.max(0, PROFILES.d10.dailyTarget - s.publishedToday),
  })
  const day = judgeOneDayCanary(sim, {
    publishedToday: s.publishedToday, slotsLeft: slotsLeftToday('d10', NOW),
  })
  console.log('\n④ D10 — (실제 재고 ∪ 그림자 자동 대상)을 D10 상한으로 배정')
  console.log(`   상한  일 ${PROFILES.d10.dailyTarget}건 · persona 주 ${d10caps.postsPerWeek}건 · 최소 ${d10caps.minDaysBetween}일`)
  console.log(`   풀 ${pool.length}건 (실제 재고 ${s.targets.length} + 그림자 ${shadowAuto.length})`)
  console.log(`   신선도 통과 ${plan.prepared.auto.length}건 · hold ${plan.prepared.held.length}건`)
  console.log(`   🟢 배정 가능 글 ${plan.assignmentReady.length}건 · 서로 다른 Persona ${assignedPersonas.size}명`)
  console.log(`   하루 판정(d10) 목표 ${day.want} · 낼 수 있음 ${day.can} · ${day.ok ? 'GO' : 'NO-GO'}`)
  for (const r of day.reasons) console.log(`     🔴 ${r}`)

  /** Persona 차단 사유 — 신선도를 통과한 글 기준 */
  const freshIds = new Set(plan.prepared.auto.map((c) => c.queueId))
  const buckets = new Map<string, Map<string, number>>()
  for (const a of plan.prepared.batch.assignments) {
    if (!freshIds.has(a.queueId)) continue
    for (const b of a.blocked) for (const r of b.reasons) {
      const g = bucketOf(r.code)
      const m = buckets.get(g) ?? new Map<string, number>()
      m.set(r.code, (m.get(r.code) ?? 0) + 1)
      buckets.set(g, m)
    }
  }
  console.log('\n   Persona 차단 사유 (신선도 통과 글 × Persona 쌍)')
  if (buckets.size === 0) console.log('     (신선도를 통과한 글이 없어 잴 쌍이 없다)')
  for (const [g, m] of buckets) {
    const total = [...m.values()].reduce((a, b) => a + b, 0)
    console.log(`     ${g.padEnd(4)} ${String(total).padStart(4)}  ${[...m].map(([k, v]) => `${k}=${v}`).join(' · ')}`)
  }

  /**
   * 🔴 **부족량을 한 줄로 뭉개지 않는다** (2026-09-25 마스터 정정).
   *    앞판은 "Persona 병목 없음" 이라고 적었다. 틀렸다 — 신선한 글 중에서도 배정에서
   *    잃는 것이 있고, 아직 없는 글이 들어왔을 때 Persona 가 받을 수 있는지는 재지 않았다.
   *      1차  글 부족       목표 − 신선 글
   *      2차  배정 손실      신선 글 − 배정 가능 글  (지금 Persona 로 받지 못한 것)
   *      미측정  없는 글의 Persona 적합성 — 글이 없으니 잴 수 없다
   */
  const target = PROFILES.d10.dailyTarget
  const fresh = plan.prepared.auto.length
  const ready = plan.assignmentReady.length
  const short = Math.max(0, target - ready)
  const lackPosts = Math.max(0, target - fresh)
  const lostInAssign = Math.max(0, fresh - ready)
  console.log('\n⑤ D10 판정')
  if (short === 0) {
    console.log('   🟢 GO — 배정 가능 글이 하루 목표 이상이다')
  } else {
    console.log(`   🔴 NO-GO — 배정 가능 ${ready}건 / 목표 ${target}건 · **${short}건 부족**`)
    console.log(`     글 부족이 1차        ${lackPosts}건  (목표 ${target} − 신선 글 ${fresh})`)
    console.log(`     현재 배정 손실이 2차  ${lostInAssign}건  (신선 글 ${fresh} − 배정 가능 ${ready})`)
    // 🔴 목표까지 **더 필요한 배정 가능 글**은 short 건이다. 그 글들이 아직 없으니
    //    어떤 Persona 가 받을 수 있는지는 잴 수 없다(앞판은 lackPosts 로 적어 1 이 모자랐다)
    console.log(`     미래 ${short}건의 Persona 적합성은 미측정 — 목표까지 더 필요한 글이 아직 없다`)
  }

  /** 참고 — 지금 운영 상한 */
  const r = resolvePublishScale({ env: process.env, loaded: s, now: NOW })
  console.log(`\n   (참고) 지금 운영 release=${r.scale.releaseStage} · capacity=${r.scale.capacityStage}`)
  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 도장 0 · 발행 0 · 유료 호출 0\n')
  await prisma.$disconnect()
}

await main()
