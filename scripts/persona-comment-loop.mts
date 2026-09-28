#!/usr/bin/env tsx
/**
 * 무인 Persona 댓글 루프 — 🔴 launchd 예약 진입점 (`com.soransoran.persona-comment-runner`)
 *
 * 🔴 **하는 일** — 한 회차에 대상 선정 → 생성 → 9관문 → PENDING 적재 → 발행을 끝까지 잇는다.
 *    사람 승인 단계는 없다. 대신 `SORAN_PERSONA_COMMENT_STAGE=bootstrap-auto` 일 때만 돈다 —
 *    그 값은 창업자가 올리는 것이다. 이 스크립트는 env 를 바꾸지 않는다.
 *
 * 🔴 **--live 가 없으면** provider 0 · DB write 0. 무엇을 할지만 찍는다.
 * 🔴 **동시 실행** — 같은 기계에서는 잠금(`wx`)이, 기계 사이에서는 발행 트랜잭션(Serializable ·
 *    글당 1건 재검사)이 막는다. 잠금을 쥔 채 죽으면 자동으로 뺏지 않는다(다음 회차는 물러난다).
 * 🔴 **비용** — 댓글 전용 장부(`persona-comment-ledger`) · 하루 상한 ≤ $0.20
 *    (`SORAN_PERSONA_COMMENT_DAILY_BUDGET_USD`, 코드 기본값 0.20 · 그 위로는 못 올린다).
 *
 * 종료 코드 — 0 정상(할 일이 없던 회차 포함) · 1 잠금/설정/예외 · 2 발행 오류(재시도 대상)가 남았다
 *
 *   npx tsx scripts/persona-comment-loop.mts            # dry-run
 *   npx tsx scripts/persona-comment-loop.mts --live     # 🔴 예약 실행과 같다
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { readConfirmedSelection } from '../src/lib/persona-comment-provenance'
import { commentLoopLimitsFromEnv } from '../src/lib/persona-comment-auto-lane'
import { acquireLock, releaseLock } from './lib/collect-lock.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { makeDbTargetSource } from './lib/persona-comment-source-db'
import { bundlesForPersonas } from './lib/persona-reference-store.mjs'
import { buildPromptFromInput } from './lib/persona-comment-bridge'
import { judgeCommentCall } from './lib/persona-comment-call.mjs'
import { SupplyLlmSession, missingBudgetEnvNames } from './lib/supply-llm-call.mjs'
import { type ProviderModel } from './lib/voice-m3-provider.mjs'
import {
  COMMENT_LOOP_LOCK_FILE, COMMENT_LOOP_LOCK_TTL_MS, commentLoopLedgerDir, commentLoopLockDir,
  runCommentLoop, type CommentGenerate, type SweepResult,
} from './lib/persona-comment-loop.mjs'

const LIVE = process.argv.includes('--live')
const NOW = new Date()

function sweepLine(label: string, s: SweepResult | null): string {
  return s === null ? `${label} —` : `${label} 본 ${s.seen} · 발행 ${s.published} · 닫음 ${s.expired} · 오류 ${s.errors}`
}

async function main(): Promise<number> {
  await loadEnvLocal()
  console.log(`\n══ 무인 Persona 댓글 루프 ${LIVE ? '(--live)' : '(dry-run)'} ══\n`)

  const lockDir = commentLoopLockDir()
  try { mkdirSync(lockDir, { recursive: true, mode: 0o700 }) } catch (e) {
    console.error(`🔴 잠금 디렉터리를 만들지 못했다 — ${(e as { code?: string }).code ?? 'UNKNOWN'}`)
    return 1
  }
  const lock = acquireLock(join(lockDir, COMMENT_LOOP_LOCK_FILE), NOW.getTime(), COMMENT_LOOP_LOCK_TTL_MS)
  if (!lock.ok) {
    if (lock.kind === 'HELD') { console.log(`⏭️  LOCK_HELD — 다른 회차가 돌고 있다 · ${lock.reason} · 물러난다`); return 0 }
    console.error(`🔴 잠금 — ${lock.kind} · ${lock.reason}`)
    return 1
  }

  const prisma = new PrismaClient()
  try {
    const budget = commentLoopLimitsFromEnv(process.env)
    const missing = missingBudgetEnvNames(budget.limits)
    for (const n of budget.notes) console.log(`  예산  ${n}`)
    const session = new SupplyLlmSession({
      runId: `comment-loop-${NOW.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`,
      limits: budget.limits,
      dir: commentLoopLedgerDir(),
    })

    const makeGenerate = (personaCodes: readonly string[]): CommentGenerate => {
      // 🔴 말투 근거 — Queue CLI 와 같은 규칙: 자산이 있으면 강제, 없으면 buildPrompt 가 판단한다
      const reference = bundlesForPersonas({ repoRoot: process.cwd(), personaCodes })
      return async ({ model, input, recentTexts }) => {
        const prompt = buildPromptFromInput(input, recentTexts, reference.byCode.get(input.personaCode),
          { requireReference: reference.byCode.size > 0 })
        if (!prompt.ok) return { ok: false, text: null, errorCode: 'PROMPT_BLOCKED' }
        // 🔴 장부를 지나서만 부른다 — 계산 → 예약 → 요청 → 정산
        const res = await session.call({
          stage: 'commentGen',
          model: model as ProviderModel,
          systemPrompt: prompt.prompt.systemPrompt,
          userPayload: prompt.prompt.userPayload,
          maxOutputTokens: prompt.prompt.maxOutputTokens,
          timeoutMs: 60_000,
        })
        return judgeCommentCall(res)
      }
    }

    const canon = readConfirmedSelection()
    const report = await runCommentLoop({
      prisma, now: NOW, env: process.env, live: LIVE,
      source: makeDbTargetSource({ prisma, windowStart: new Date(NOW.getTime() - 7 * 86_400_000) }),
      canon,
      makeGenerate,
      generation: missing.length > 0
        ? { ok: false, reason: `예산 env 를 읽지 못했다 — ${missing.join(' · ')}` }
        : { ok: true, reason: '' },
      runRequestCap: budget.limits.runRequestCap ?? 0,
    })

    console.log(`  단계  ${report.stage} — ${report.reason}`)
    console.log(`  모델  ${canon.selection?.winner ?? '(없음)'} · ${canon.detail}`)
    for (const l of report.lines) console.log(`  ${l}`)
    for (const s of [report.sweepBefore, report.sweepAfter]) for (const l of s?.lines ?? []) console.log(`     ${l}`)
    if (report.generationSkipped !== null) console.log(`  생성 건너뜀 — ${report.generationSkipped}`)
    const t = session.tally
    console.log(`  비용  유료 ${t.paid}회 · 막힘 ${t.blocked}회 · 예약 $${t.reservedUsd.toFixed(6)} · 정산 $${t.settledUsd.toFixed(6)}`
      + `${t.usageUnknown > 0 ? ` · 🔴 사용량 미상 ${t.usageUnknown}` : ''}${t.settleHeld > 0 ? ` · 🔴 정산 보류 ${t.settleHeld}` : ''}`)
    // 🔴 한 줄 요약 — launchd 로그를 grep 하는 자리
    console.log(`COMMENT_LOOP outcome=${report.outcome} targets=${report.targets} providerCalls=${report.providerCalls}`
      + ` enqueued=${report.enqueued} | ${sweepLine('sweep①', report.sweepBefore)} | ${sweepLine('sweep②', report.sweepAfter)}\n`)
    const errors = (report.sweepBefore?.errors ?? 0) + (report.sweepAfter?.errors ?? 0)
    return errors > 0 || t.settleHeld > 0 ? 2 : 0
  } catch (e) {
    console.error(`🔴 회차 예외 — ${e instanceof Error ? e.name : 'unknown'}`)
    return 1
  } finally {
    await prisma.$disconnect().catch(() => undefined)
    releaseLock(lock.handle)
  }
}

process.exit(await main())
