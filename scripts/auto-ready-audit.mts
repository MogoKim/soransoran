#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 감사 회차 — 지금 감사자는 규칙 기반 "무결성·안전 감사" 다** (2026-09-25)
 *    독립 **의미** 감사(모델)는 활성화 전 별도 작업이다 — 이 스크립트는 모델을 부르지 않는다.
 *
 *   판정 전 감사(AutoReadyAudit.defect IS NULL)를 **전부** 읽고 → 발행된 Post 를
 *   감사자(지금은 규칙 무결성·안전 감사자)에게 보이고 → 결과를 묶음 대조 뒤 DB 에 기록한다.
 *   `yes` 가 하나라도 기록되면 다음 자동 도장과 발행이 **각자의 트랜잭션 안에서** 닫힌다.
 *
 * 🔴 스위치 기본 OFF — 꺼져 있으면 감사 표를 읽지도 않고 끝난다.
 * 🔴 `--apply` 없으면 쓰지 않는다(dry-run 은 무엇을 판정할지만 보인다).
 * 🔴 운영 스케줄에 연결하지 않았다. 모델을 부르지 않는다 — 유료 호출 0.
 * 🔴 개수 제한·사람 허가·대기 기간을 두지 않는다.
 *
 *   npx tsx scripts/auto-ready-audit.mts            # dry-run
 *   npx tsx scripts/auto-ready-audit.mts --apply    # 🔴 결과 기록
 */
import { PrismaClient } from '@prisma/client'

import { autoReadyEnabled, readStamp, AUTO_READY_ENV } from '../src/lib/auto-ready-v2'
import { runAuditRound } from '../src/lib/auto-ready-repo'
import { ruleAuditJudge, RULE_JUDGE_MODEL } from './lib/auto-ready-rule-judge.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const APPLY = process.argv.includes('--apply')
const AUDITOR = `${RULE_JUDGE_MODEL}:runner`
const NOW = new Date()

async function main(): Promise<void> {
  await loadEnvLocal()
  if (!autoReadyEnabled(process.env)) {
    console.log(`자동 READY 감사 — ${AUTO_READY_ENV} 가 꺼져 있다. 감사 표를 읽지 않고 끝낸다.`)
    return
  }
  const prisma = new PrismaClient()
  if (!APPLY) {
    const pending = await prisma.autoReadyAudit.findMany({ where: { defect: null }, orderBy: { selectedAt: 'asc' } })
    console.log(`\n자동 READY 감사 (dry-run) — 판정 전 ${pending.length}건`)
    for (const a of pending) {
      const post = await prisma.post.findUnique({ where: { id: a.postId }, select: { title: true, content: true } })
      const q = await prisma.originalPostApprovalQueue.findUnique({ where: { id: a.queueId }, select: { editDiff: true } })
      if (post === null || q === null) { console.log(`   ${a.queueId} — 글이 없다`); continue }
      const v = await ruleAuditJudge({ queueId: a.queueId, postId: a.postId, title: post.title, body: post.content, stamp: readStamp(q.editDiff) })
      console.log(`   ${a.queueId} → ${v.defect}${v.reasons.length > 0 ? ` (${v.reasons.join(' · ')})` : ''}`)
    }
    console.log('   🟡 dry-run — 기록하지 않았다. 기록하려면 --apply\n')
    await prisma.$disconnect()
    return
  }
  const r = await runAuditRound(prisma, { env: process.env, judge: ruleAuditJudge, auditor: AUDITOR, now: NOW })
  if (r.kind === 'off') console.log('스위치가 꺼져 있다')
  else console.log(`\n자동 READY 감사 — 판정 전 ${r.pending}건 · ${[...r.tally].map(([k, v]) => `${k} ${v}`).join(' · ') || '기록 0'}\n`)
  await prisma.$disconnect()
}

await main()
