#!/usr/bin/env tsx
/**
 * 🔴 **실제 운영 스냅샷 조립 — read-only** (2026-09-24 · 2026-09-30 source-slot-v1 재작성)
 *
 * 🔴 **발행 러너와 같은 함수만 부른다** — `loadPublishableStock` · `resolvePublishScale` · `stageStock`
 *    (안에서 정본 `judgeSlotRelease` · `planPublishBatch`). 이 명령은 **판정을 새로 만들지 않는다**.
 *
 * 🔴 **지운 옛 화면(2026-09-30)** — 14일 readiness(`stageVerdicts`) · 하루 시뮬레이션(`judgeOneDayCanary`) ·
 *    canary/window 허가 · env 단계로 결정을 흉내 내던 `planStageDecision(previousDecision: null)` 호출.
 *    단계 결정은 `npm run stage:controller`(dry-run) 하나가 보여 준다 — 같은 결정을 두 곳에서 계산하지 않는다.
 *
 * 🔴 DB write 0 · 네트워크 0 · LLM 0 · 발행 0 · 결정 저장 0.
 */
import { PrismaClient } from '@prisma/client'

import { kstDateString } from '../src/lib/release-canary'
import { RELEASE_REASON_LABEL, type ReleaseReason } from '../src/lib/source-slot-release'
import { loadPublishableStock, stageStock, resolvePublishScale } from './lib/publishable-stock.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const NOW = new Date()
const KST_DATE = kstDateString(NOW)

async function main(): Promise<void> {
  await loadEnvLocal()
  const prisma = new PrismaClient()
  console.log('\n══ 실제 운영 스냅샷 조립 (read-only · DB write 0) ══')
  console.log(`   기준 ${KST_DATE} · ${NOW.toISOString()}`)
  console.log('   🔴 발행 러너와 같은 함수(loadPublishableStock · planPublishBatch · judgeSlotRelease)로 조립한다\n')

  const s = await loadPublishableStock(prisma, NOW)
  const resolved = resolvePublishScale({ env: process.env, loaded: s, now: NOW })
  const RELEASE_CAPS = resolved.caps
  console.log(`   단계(결정 env)  release=${resolved.scale.releaseStage}`
    + ` · 준비=${resolved.scale.capacityStage} · 일 ${resolved.dailyCap}건`
    + ` · persona 주 ${RELEASE_CAPS.postsPerWeek}건 · 최소 ${RELEASE_CAPS.minDaysBetween}일`)

  const st = stageStock({ loaded: s, caps: RELEASE_CAPS, at: NOW })
  console.log('\n① 큐 단계 — 서로 다른 값이다')
  console.log(`   queueTotal            ${st.queueTotal}건`)
  console.log(`   selectorTargets       ${st.selectorTargets.count}건  ${st.selectorTargets.ids.join(' ')}`)
  console.log(`   releaseEligible       ${st.releaseEligible.count}건  ${st.releaseEligible.ids.join(' ')}  (source-slot-v1 · 지금 슬롯)`)
  console.log(`   successfullyAssigned  ${st.successfullyAssigned.count}건  ${st.successfullyAssigned.ids.join(' ')}`)
  console.log(`   🔴 assignmentReady     ${st.assignmentReady.count}건  ${st.assignmentReady.ids.join(' ')}`)
  console.log(`   🔴 nextPickedId        ${st.nextPickedId ?? '(없음)'}`)
  console.log('   🔴 위 둘은 실행 허가가 아니다 — 슬롯 · 일 상한 · kill switch · 그날 문 · 발행 트랜잭션 재판정이 따로 본다')
  if (st.brokenRecovery.length > 0) {
    console.log(`   🔴 배정 깨짐 ${st.brokenRecovery.length}건 — publisher 는 전체를 중단한다`)
    for (const b of st.brokenRecovery) console.log(`      ${b.id}  ${b.problem}`)
  }
  if (s.rejectedByCode.length > 0) {
    console.log('\n② selector 제외 사유별 (정본 selectAutoTargets)')
    for (const r of s.rejectedByCode) {
      console.log(`   ${String(r.count).padStart(3)}건  ${r.code}  ${r.ids.slice(0, 3).join(' ')}`)
    }
  }
  if (st.holdsByReason.length > 0) {
    console.log('\n③ 공개 판정 제외 사유별 (정본 judgeSlotRelease — 사람이 살리는 칸이 아니다)')
    for (const h of st.holdsByReason) {
      console.log(`   ${String(h.count).padStart(3)}건  ${h.reason} — ${RELEASE_REASON_LABEL[h.reason as ReleaseReason]}  ${h.ids.slice(0, 3).join(' ')}`)
    }
  }
  console.log(`\n④ 오늘(${KST_DATE}) 이미 낸 편수 ${s.publishedToday}건 · 자동 target ${s.autoTargetsToday ?? 0}건`)
  console.log('   🔴 단계 결정은 `npm run stage:controller`(dry-run) 가 보여 준다 — 이 명령은 결정을 계산하지 않는다')
  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 발행 0 · 결정 저장 0\n')
  await prisma.$disconnect()
}

await main()
