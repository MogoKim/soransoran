#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 독립 감사 러너** (2026-09-27 · 규칙 무결성·안전 감사 + 의미 감사)
 *
 *   판정 전 감사(AutoReadyAudit.defect IS NULL)를 **전부** 읽고, 한 건마다
 *     ① 규칙 무결성·안전 감사(`auto-ready-rule-judge` — 모델 0)
 *     ② 의미 감사(`auto-ready-semantic-audit` — 발행 글 · 도장 · artifact 원문 근거 · Persona 카드를 묶어 판정)
 *   를 **둘 다** 돌리고, 하나라도 결함이면 결함 yes 로 기록한다(`recordCombinedAudit`).
 *   yes 가 기록되면 다음 도장·발행이 각자의 트랜잭션 안에서 닫힌다.
 *
 * 🔴 fail-closed — 근거·카드를 못 읽었거나 모델이 실패·오답 모양이면 그 감사는 yes 다(대기로 두지 않는다).
 * 🔴 유료 의미 감사는 **기본 OFF**(`SORAN_AUTO_READY_SEMANTIC_PAID`). 꺼져 있으면 측정 불가 → yes 다.
 *    켜도 공급 장부 예산 env 가 없으면 요청 전에 막힌다.
 * 🔴 판정 전 감사가 0 이면 **제공사를 만들지도 부르지도 않고** 끝난다.
 * 🔴 전용 잠금 — 같은 맥에서 두 회차가 겹치면 뒤 회차는 물러난다(exit 0). 잠금이 없어도 결과는
 *    감사마다 정확히 하나다 — 저장 경계가 `defect IS NULL` 일 때만 쓴다.
 * 🔴 스위치(`SORAN_AUTO_READY_ENABLED`) OFF 면 감사 표를 읽지 않고 끝난다.
 * 🔴 사람 기록(human:*)을 만들지 않는다 — 감사자는 `model:semantic-audit` 계열 기계 표식이다.
 * 🔴 launchd 템플릿은 `scripts/lib/auto-ready-audit-template.ts` 가 만든다 — **설치하지 않았다.**
 *
 *   npx tsx scripts/auto-ready-audit.mts            # dry-run — 판정 전 감사와 문맥만 보인다(제공사 0 · write 0)
 *   npx tsx scripts/auto-ready-audit.mts --apply    # 🔴 규칙 + 의미 감사 → 결과 기록
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

import { autoReadyEnabled, AUTO_READY_ENV } from '../src/lib/auto-ready-v2'
import { runCombinedAuditRound } from '../src/lib/auto-ready-audit-store'
import { SEMANTIC_AUDITOR } from '../src/lib/auto-ready-semantic-audit'
import { ruleAuditJudge } from './lib/auto-ready-rule-judge.mjs'
import { makeAuditContextLoader } from './lib/auto-ready-audit-context.mjs'
import { semanticProviderFromEnv } from './lib/auto-ready-semantic-provider.mjs'
import { acquireLock, releaseLock } from './lib/collect-lock.mjs'
import { AUDIT_LOCK_FILE, AUDIT_LOCK_TTL_MS, auditLockDir } from './lib/auto-ready-audit-template'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
/** 🔴 감사자 표식 — 비사람 종류(`model:semantic-audit`)에 러너 이름을 붙인다 */
const AUDITOR = `${SEMANTIC_AUDITOR}:runner`
const NOW = new Date()

async function main(): Promise<number> {
  await loadEnvLocal()
  if (!autoReadyEnabled(process.env)) {
    console.log(`자동 READY 감사 — ${AUTO_READY_ENV} 가 꺼져 있다. 감사 표를 읽지 않고 끝낸다.`)
    return 0
  }
  const lockDir = auditLockDir()
  try { mkdirSync(lockDir, { recursive: true, mode: 0o700 }) } catch (e) {
    console.error(`🔴 잠금 디렉터리를 만들지 못했다 — ${(e as { code?: string }).code ?? 'UNKNOWN'} · 감사하지 않는다`)
    return 1
  }
  const lock = acquireLock(join(lockDir, AUDIT_LOCK_FILE), NOW.getTime(), AUDIT_LOCK_TTL_MS)
  if (!lock.ok) {
    if (lock.kind === 'HELD') { console.log(`⏭️  LOCK_HELD — 다른 감사 회차가 돌고 있다 · ${lock.reason} · 이 회차는 물러난다`); return 0 }
    console.error(`🔴 감사 잠금 — ${lock.kind} · ${lock.reason}`)
    return 1
  }
  const prisma = new PrismaClient()
  try {
    if (!APPLY) {
      const pending = await prisma.autoReadyAudit.findMany({ where: { defect: null }, orderBy: { selectedAt: 'asc' } })
      console.log(`\n자동 READY 감사 (dry-run) — 판정 전 ${pending.length}건 · 제공사 호출 0 · write 0`)
      const load = makeAuditContextLoader(prisma)
      for (const a of pending) {
        const c = await load({ queueId: a.queueId, postId: a.postId })
        console.log(`   ${a.queueId} → 문맥 ${c.ok ? `artifact ${c.ctx.artifact.artifactId} · Persona ${c.ctx.persona.code}` : `🔴 ${c.code} — ${c.reason}`}`)
      }
      console.log('   🟡 dry-run — 기록하려면 --apply\n')
      return 0
    }
    const pendingCount = await prisma.autoReadyAudit.count({ where: { defect: null } })
    if (pendingCount === 0) {
      // 🔴 판정 전 0 — 제공사를 만들지도 부르지도 않는다
      console.log('자동 READY 감사 — 판정 전 0건 · 제공사 호출 0')
      return 0
    }
    const choice = semanticProviderFromEnv(process.env, `auto-ready-audit-${NOW.toISOString().replace(/[:.]/g, '')}`)
    console.log(`\n자동 READY 감사 — ${choice.describe}`)
    const r = await runCombinedAuditRound(prisma, {
      env: process.env, now: NOW, auditor: AUDITOR,
      ruleJudge: ruleAuditJudge, loadContext: makeAuditContextLoader(prisma), provider: choice.provider,
    })
    if (r.kind === 'off') { console.log('스위치가 꺼져 있다'); return 0 }
    console.log(`   AUDIT_ROUND pending=${r.pending} semanticCalls=${r.semanticCalls} · ${[...r.tally].map(([k, v]) => `${k} ${v}`).join(' · ') || '기록 0'}`)
    if (choice.session !== null) console.log(choice.session.describe())
    return 0
  } finally {
    await prisma.$disconnect()
    releaseLock(lock.handle)
  }
}

process.exit(await main())
