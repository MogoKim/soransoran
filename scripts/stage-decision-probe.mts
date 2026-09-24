#!/usr/bin/env tsx
/**
 * 🔴 **실제 운영 스냅샷 조립 — read-only** (2026-09-24)
 *
 *    `stage-ladder-check` 의 9/24 검사는 `q(n)` fixture 로 만든 **구조 회귀**다.
 *    이 명령은 **운영 DB 를 실제로 읽어** 그날의 판정을 정본으로 조립하고,
 *    queue ID · Persona · history · TTL · 간격 결과를 값으로 출력한다.
 *
 * 🔴 **DB write 0 · 네트워크 0 · LLM 0 · 발행 0.** 읽기만 한다.
 * 🔴 결정을 저장하지 않는다 — 저장 경로는 아직 승인 전이다.
 */
import { PrismaClient } from '@prisma/client'

import { planStageDecision, type DatedCanary } from '../src/lib/stage-ladder'
import { PROFILES, RELEASE_STAGES, type ReleaseStage } from '../src/lib/scale-profile'
import { simulateStage, stageVerdicts } from '../src/lib/scale-readiness'
import { judgeOneDayCanary } from '../src/lib/release-canary'
import { kstDateString } from '../src/lib/release-canary'
import { parsePoolDoc, cardToPersona } from '../src/lib/persona-pool-card'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readFileSync } from 'node:fs'
import type { QueueCandidate } from '../src/lib/supply-candidates'

const NOW = new Date()
const KST_DATE = kstDateString(NOW)
const argv = process.argv.slice(2)
const STAGE = (argv.find((a) => a.startsWith('--stage='))?.split('=')[1] ?? 'd5') as ReleaseStage

async function main(): Promise<void> {
  await loadEnvLocal()
  const prisma = new PrismaClient()
  console.log(`\n══ 실제 운영 스냅샷 조립 (read-only · DB write 0) ══`)
  console.log(`   기준 ${KST_DATE} · ${NOW.toISOString()} · 시험 대상 ${STAGE}\n`)

  /** 🔴 아직 발행되지 않은 승인 재고 — 러너가 보는 것과 같은 조건 */
  const rows = await prisma.originalPostApprovalQueue.findMany({
    where: { status: 'APPROVED', createdPostId: null },
    select: {
      id: true, createdAt: true, draftTitle: true, draftBody: true,
      editedTitle: true, editedBody: true, gateVerdict: true,
      matchedPersona: { select: { code: true } }, decidedBy: true,
      rawContent: { select: { sourceCapturedAt: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const queue: QueueCandidate[] = rows.map((r, i) => ({
    queueId: r.id, title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
    gateVerdict: r.gateVerdict, createdAt: i,
    assignedPersonaCode: r.matchedPersona?.code ?? null,
    voice: null, profile: 'human' as const,
    capturedAt: r.rawContent.sourceCapturedAt ?? null,
  }))
  console.log(`① 재고 ${queue.length}건 (APPROVED · 미발행)`)
  for (const c of queue.slice(0, 8)) {
    console.log(`   ${c.queueId}  배정=${c.assignedPersonaCode ?? '(없음)'}`
      + `  capturedAt=${c.capturedAt?.toISOString().slice(0, 16) ?? '(없음 → TTL 판정 불가)'}`)
  }
  if (queue.length > 8) console.log(`   … 외 ${queue.length - 8}건`)
  const noCaptured = queue.filter((c) => c.capturedAt === null).length
  console.log(`   🔴 capturedAt 없음 ${noCaptured}건 — 그 건은 TTL 로 hold 된다`)

  /** 🔴 Persona 와 최근 발행 이력 — 주 cap·최소 간격 판정의 근거 */
  const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
  const cards = pool.cards.filter((c) => c.voiceLength !== null)
  const since = new Date(NOW.getTime() - 14 * 86_400_000)
  const logs = await prisma.personaActivityLog.findMany({
    where: { kind: 'post', createdAt: { gte: since } },
    select: { createdAt: true, persona: { select: { code: true } } },
  })
  const byCode = new Map<string, number[]>()
  for (const l of logs) {
    const code = l.persona?.code
    if (code === undefined || code === null) continue
    const arr = byCode.get(code) ?? []
    arr.push(l.createdAt.getTime())
    byCode.set(code, arr)
  }
  const personas = cards.map((c) => {
    const ms = (byCode.get(c.code) ?? []).sort((a, b) => b - a)
    const weekAgo = NOW.getTime() - 7 * 86_400_000
    return {
      ...cardToPersona(c),
      postsThisWeek: ms.filter((m) => m >= weekAgo).length,
      daysSinceLastPost: ms.length === 0 ? null
        : Math.floor((NOW.getTime() - ms[0]!) / 86_400_000),
    }
  })
  console.log(`\n② Persona ${personas.length}명 · 최근 14일 발행 로그 ${logs.length}건`)
  for (const p of personas.filter((x) => x.postsThisWeek > 0 || x.daysSinceLastPost !== null).slice(0, 10)) {
    console.log(`   ${p.code}  주 발행 ${p.postsThisWeek}건  마지막 ${p.daysSinceLastPost ?? '-'}일 전`)
  }

  /** 🔴 오늘 이미 낸 편수 — 러너와 같은 경계(KST) */
  const kstMid = new Date(Date.parse(`${KST_DATE}T00:00:00+09:00`))
  const publishedToday = await prisma.post.count({ where: { createdAt: { gte: kstMid } } })
  console.log(`\n③ 오늘(${KST_DATE}) 이미 낸 편수 ${publishedToday}건`)

  const axis = { now: NOW, publishedToday }
  const verdicts = stageVerdicts({ queue, personas, axis })
  console.log('\n④ 지속 14일 readiness (정본 stageVerdicts — 실제 배정 시뮬레이션)')
  for (const v of verdicts) {
    console.log(`   ${v.stage}  ${v.ready ? '🟢 READY' : `🔴 ${v.reasons.join(' / ')}`}`)
  }

  const slotsLeft = Math.max(0, PROFILES[STAGE].dailyTarget - publishedToday)
  const sim1 = simulateStage({
    stage: STAGE, queue, personas, axis, days: 1, anchor: 'now', dailyCap: slotsLeft,
  })
  const daily: DatedCanary = {
    kstDate: KST_DATE, stage: STAGE, builtAt: NOW.toISOString(),
    verdict: judgeOneDayCanary(sim1, { publishedToday, slotsLeft }),
  }
  console.log(`\n⑤ 하루 판정 (정본 judgeOneDayCanary · ${STAGE})`)
  console.log(`   목표 ${daily.verdict.want} · 이미 ${daily.verdict.published}`
    + ` · 남은 슬롯 ${daily.verdict.slotsLeft} · 더 필요 ${daily.verdict.need}`
    + ` · 낼 수 있음 ${daily.verdict.can}`)
  console.log(`   ${daily.verdict.ok ? '🟢 GO' : `🔴 NO-GO — ${daily.verdict.reasons.join(' / ')}`}`)

  /**
   * 🔴 **승인 천장은 운영 승인 값이다 — 여기서 만들지 않는다.**
   *    지금은 canonical env 의 `SORAN_CAPACITY_STAGE` 를 그대로 읽는다.
   */
  const ceiling = (process.env.SORAN_CAPACITY_STAGE ?? 'd1') as ReleaseStage
  const sustained = (process.env.SORAN_RELEASE_STAGE ?? 'd1') as ReleaseStage
  const ok = (s: string): s is ReleaseStage => (RELEASE_STAGES as readonly string[]).includes(s)
  console.log(`\n⑥ 입력 세 가지`)
  console.log(`   sustainedRelease          ${sustained}${ok(sustained) ? '' : ' 🔴 모르는 값'}`)
  console.log(`   authorizedCapacityCeiling ${ceiling}${ok(ceiling) ? '' : ' 🔴 모르는 값'}`)
  console.log(`   dailyDecision             ${KST_DATE} · ${STAGE} · ${daily.verdict.ok ? 'GO' : 'NO-GO'}`)

  const decision = planStageDecision({
    kstDate: KST_DATE,
    sustainedRelease: ok(sustained) ? sustained : 'd1',
    authorizedCapacityCeiling: ok(ceiling) ? ceiling : 'd1',
    verdicts, daily,
    // 🔴 judgePromotion 입력은 이 명령이 재지 않는다 — 재지 않은 것을 지어내지 않는다
    promotion: null,
    publishedToday, decidedAt: NOW.toISOString(),
  })
  console.log(`\n⑦ 결정`)
  console.log(`   state    ${decision.state}`)
  console.log(`   release  ${decision.release}   capacity(승인 천장) ${decision.capacity}`)
  console.log(`   dayPinned ${decision.dayPinned}`)
  for (const r of decision.reasons) console.log(`   · ${r}`)
  for (const b of decision.blocks) console.log(`   🔴 ${b.code}: ${b.reason}`)
  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 발행 0 · 결정 저장 0\n')
  await prisma.$disconnect()
}

await main()
