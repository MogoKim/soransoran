#!/usr/bin/env tsx
/**
 * 🔴 **실제 운영 스냅샷 조립 — read-only** (2026-09-24 재작성)
 *
 * 🔴 **발행 러너와 같은 함수를 쓴다** (`loadPublishableStock`).
 *    앞판은 APPROVED 223건을 전부 `profile:'human'` 으로 하드코딩해 재고로 넣었고,
 *    그래서 d5 지속 READY 라는 **거짓 판정**을 만들었다. 실제 러너는 같은 시각
 *    최종 발행 가능 **0건** 이었다.
 *
 * 🔴 **사전 판정과 사후 실적을 나눈다.** 이미 5건 내서 `need=0` 이라 나온 GO 를
 *    "아침에 D5 를 열 수 있었다" 는 증명으로 쓰지 않는다.
 *
 * 🔴 DB write 0 · 네트워크 0 · LLM 0 · 발행 0 · 결정 저장 0.
 */
import { PrismaClient } from '@prisma/client'

import { planStageDecision, type DatedCanary } from '../src/lib/stage-ladder'
import { PROFILES, RELEASE_STAGES, type ReleaseStage } from '../src/lib/scale-profile'
import { simulateStage, stageVerdicts } from '../src/lib/scale-readiness'
import { judgeOneDayCanary, kstDateString } from '../src/lib/release-canary'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const NOW = new Date()
const KST_DATE = kstDateString(NOW)
const argv = process.argv.slice(2)
const STAGE = (argv.find((a) => a.startsWith('--stage='))?.split('=')[1] ?? 'd5') as ReleaseStage

async function main(): Promise<void> {
  await loadEnvLocal()
  const prisma = new PrismaClient()
  console.log('\n══ 실제 운영 스냅샷 조립 (read-only · DB write 0) ══')
  console.log(`   기준 ${KST_DATE} · ${NOW.toISOString()} · 시험 대상 ${STAGE}`)
  console.log('   🔴 발행 러너와 같은 함수(loadPublishableStock)로 조립한다\n')

  const s = await loadPublishableStock(prisma, NOW)

  console.log('① 재고 — 네 수는 서로 다른 값이다')
  console.log(`   대기열(APPROVED·EDITED·미발행)   ${s.queueTotal}건`)
  console.log(`   기계가 만든 후보                 ${s.machineCandidates}건`)
  console.log(`   사람이 검토를 마친 행            ${s.humanReviewed}건`)
  console.log(`   🔴 **실제 발행 가능 재고**       ${s.targets.length}건`)
  if (s.rejectedByCode.length > 0) {
    console.log('\n② 제외 사유별 (정본 selectAutoTargets)')
    for (const r of s.rejectedByCode) console.log(`   ${String(r.count).padStart(3)}건  ${r.code}`)
  }
  console.log('\n③ 발행 후보 ID')
  if (s.targets.length === 0) console.log('   (없음)')
  for (const t of s.targets.slice(0, 10)) {
    console.log(`   ${t.id}  persona=${t.matchedPersonaId ?? '미배정'}  decidedBy=${String(t.decidedBy ?? '')}`)
  }

  const ceiling = (process.env.SORAN_CAPACITY_STAGE ?? 'd1') as ReleaseStage
  const sustained = (process.env.SORAN_RELEASE_STAGE ?? 'd1') as ReleaseStage
  /** 🔴 시험 기반 = 지속 공개 단계. 대상은 그 바로 다음 칸이어야 한다 */
  const TRIAL_BASE = ((RELEASE_STAGES as readonly string[]).includes(sustained)
    ? sustained : 'd1') as ReleaseStage

  const axis = { now: NOW, publishedToday: s.publishedToday }
  console.log(`\n④ 오늘(${KST_DATE}) 이미 낸 편수 ${s.publishedToday}건`)

  /** 🔴 **사후 스냅샷** — 지금 시각 기준 */
  const verdicts = stageVerdicts({
    queue: s.queueCandidates, personas: s.personas as never, history: s.history, axis,
  })
  console.log('\n⑤ 지속 14일 readiness (정본 stageVerdicts · 실제 배정 시뮬레이션)')
  for (const v of verdicts) {
    console.log(`   ${v.stage}  ${v.ready ? '🟢 READY' : `🔴 ${v.reasons.join(' / ')}`}`)
  }

  const canaryOf = (publishedToday: number, label: string): DatedCanary => {
    const slotsLeft = Math.max(0, PROFILES[STAGE].dailyTarget - publishedToday)
    const sim = simulateStage({
      stage: STAGE, queue: s.queueCandidates, personas: s.personas as never,
      history: s.history, axis: { now: NOW, publishedToday },
      days: 1, anchor: 'now', dailyCap: slotsLeft,
    })
    const v = judgeOneDayCanary(sim, { publishedToday, slotsLeft })
    console.log(`   ${label}: 목표 ${v.want} · 이미 ${v.published} · 남은 슬롯 ${v.slotsLeft}`
      + ` · 더 필요 ${v.need} · 낼 수 있음 ${v.can} → ${v.ok ? '🟢 GO' : `🔴 NO-GO (${v.reasons.join(' / ')})`}`)
    return {
      kstDate: KST_DATE, stage: STAGE, builtAt: NOW.toISOString(),
      // 🔴 시험 기반은 지속 공개 단계다 — 임의 기반을 실어 점프하지 않는다
      trialBase: TRIAL_BASE, verdict: v,
    }
  }
  console.log(`\n⑥ 하루 판정 (정본 judgeOneDayCanary · ${STAGE}) — 🔴 사전/사후를 나눈다`)
  /**
   * 🔴 **사전 판정**: 그날 아직 아무것도 내지 않았다고 보고 묻는다.
   *    "아침에 이 단계를 열 수 있었는가" 는 이 값으로만 말할 수 있다.
   */
  const before = canaryOf(0, '사전(첫 발행 전 · publishedToday=0)')
  /** 🔴 **사후 실적**: 지금 상태. `need=0` 이면 "할 일이 끝났다" 이지 개방 근거가 아니다 */
  const after = canaryOf(s.publishedToday, '사후(현재)')
  if (after.verdict.need === 0 && after.verdict.ok) {
    console.log('   🔴 사후 GO 는 `need=0`(할 일이 끝났다) 이다 — 개방 가능 증명으로 쓰지 않는다')
  }

  const ok = (x: string): x is ReleaseStage => (RELEASE_STAGES as readonly string[]).includes(x)
  console.log('\n⑦ 입력 세 가지')
  console.log(`   sustainedRelease          ${sustained}${ok(sustained) ? '' : ' 🔴 모르는 값'}`)
  console.log(`   authorizedCapacityCeiling ${ceiling}${ok(ceiling) ? '' : ' 🔴 모르는 값'}`)
  console.log(`   dailyDecision(사전)       ${KST_DATE} · ${STAGE} · ${before.verdict.ok ? 'GO' : 'NO-GO'}`)

  const decide = (daily: DatedCanary, publishedToday: number, label: string): void => {
    const d = planStageDecision({
      kstDate: KST_DATE,
      sustainedRelease: ok(sustained) ? sustained : 'd1',
      authorizedCapacityCeiling: ok(ceiling) ? ceiling : 'd1',
      verdicts, daily,
      // 🔴 `judgePromotion` 입력을 이 명령이 재지 않는다 — 재지 않은 것을 지어내지 않는다
      promotion: null,
      publishedToday, decidedAt: NOW.toISOString(),
    })
    console.log(`\n   ▸ ${label}: state=${d.state} · release=${d.release} · 천장=${d.capacity}`
      + ` · dayPinned=${d.dayPinned}`)
    for (const r of d.reasons) console.log(`      · ${r}`)
    for (const b of d.blocks) console.log(`      🔴 ${b.code}: ${b.reason}`)
  }
  console.log('\n⑧ 결정')
  decide(before, 0, '사전(첫 발행 전)')
  decide(after, s.publishedToday, '사후(현재)')

  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 발행 0 · 결정 저장 0\n')
  await prisma.$disconnect()
}

await main()
