#!/usr/bin/env tsx
/**
 * 무인 Persona 댓글 루프 — 🔴 launchd 예약 진입점 (`com.soransoran.persona-comment-runner`)
 *
 * 🔴 **하는 일** — 한 회차에 대상 선정 → 생성 → 9관문 → PENDING 적재 → 발행을 끝까지 잇는다.
 *    사람 승인 단계는 없다. 대신 `SORAN_PERSONA_COMMENT_STAGE=bootstrap-auto` 일 때만 돈다 —
 *    그 값은 창업자가 올리는 것이다. 이 스크립트는 env 를 바꾸지 않는다.
 *
 * 🔴 **--live 가 없으면** provider 0 · DB write 0. 무엇을 할지만 찍는다.
 * 🔴 **공통 진입점** (2026-10-11 Batch A4) — 정기(launchd 슬롯) · 복구(`runner-recover` kickstart) · (다음) 사건 깨움이
 *    **이 진입점 하나**를 지난다. 같은 lease(`runner-lease` = `/usr/bin/lockf` 커널 잠금 · 죽으면 저절로 풀린다) ·
 *    같은 하루 예산(댓글 장부 하나) · 같은 멱등(PENDING 먼저 내기 · 글당 1건 · 조건부 UPDATE)이다.
 *    · lease 를 못 잡은 깨움은 follow-up 표식 하나로 합쳐 물러난다 — 주인이 끝낸 뒤 **한 번만** 더 돈다
 *    · holder 가 죽거나(SIGKILL · 전원 · 재부팅) 끝나면 커널이 잠금을 푼다 — 사람이 파일을 지울 일이 없다
 *    · 살아 있는 holder 는 시각 · PID · rename 으로 뺏지 않는다
 *    · lease · 예산은 provider 호출 · DB write **전에** 본다 — lease 가 먼저, 유료 생성 전에 예산
 *    기계 사이는 발행 트랜잭션(Serializable · 글당 1건 재검사)이 막는다.
 * 🔴 **비용** — 댓글 전용 장부(`persona-comment-ledger`) · 하루 상한 ≤ $0.20
 *    (`SORAN_PERSONA_COMMENT_DAILY_BUDGET_USD`, 코드 기본값 0.20 · 그 위로는 못 올린다).
 *
 * 종료 코드 — 0 정상(할 일이 없던 회차 포함) · 1 잠금/설정/예외 · 2 발행 오류(재시도 대상)가 남았다
 *
 *   npx tsx scripts/persona-comment-loop.mts            # dry-run
 *   npx tsx scripts/persona-comment-loop.mts --live     # 🔴 예약 실행과 같다
 */
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

import { readConfirmedSelection } from '../src/lib/persona-comment-provenance'
import { commentLoopLimitsFromEnv } from '../src/lib/persona-comment-auto-lane'
import { leaseEntry, stillInKernelLease, type LeaseProof } from './lib/runner-lease.mjs'
import { readCostSignals } from './lib/ops-signals.mjs'
import { COMMENT_RUNNER_LABEL } from './lib/persona-comment-runner-template'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { makeDbTargetSource } from './lib/persona-comment-source-db'
import { bundlesForPersonas } from './lib/persona-reference-store.mjs'
import { buildPromptFromInput } from './lib/persona-comment-bridge'
import { judgeCommentCall } from './lib/persona-comment-call.mjs'
import { SupplyLlmSession, missingBudgetEnvNames } from './lib/supply-llm-call.mjs'
import { type ProviderModel } from './lib/voice-m3-provider.mjs'
import {
  COMMENT_LOOP_LOCK_FILE, commentLoopLedgerDir, commentLoopLockDir,
  runCommentLoop, generationGateOf, type CommentGenerate, type SweepResult,
} from './lib/persona-comment-loop.mjs'

const LIVE = process.argv.includes('--live')

function sweepLine(label: string, s: SweepResult | null): string {
  return s === null ? `${label} —` : `${label} 본 ${s.seen} · 발행 ${s.published} · 닫음 ${s.expired} · 오류 ${s.errors}`
}

async function main(): Promise<number> {
  await loadEnvLocal()
  const lockDir = commentLoopLockDir()
  try { mkdirSync(lockDir, { recursive: true, mode: 0o700 }) } catch (e) {
    console.error(`🔴 잠금 디렉터리를 만들지 못했다 — ${(e as { code?: string }).code ?? 'UNKNOWN'}`)
    return 1
  }
  /**
   * 🔴 **공통 진입 — 커널 lease 가 먼저다.** 바깥은 lockf 아래로 같은 스크립트를 다시 띄우기만 한다(DB · provider 0).
   *    안쪽은 커널 잠금 증명 뒤에만 DB 클라이언트를 만든다. 정기 · 복구 kickstart · (다음) 사건 · 수동이 같은 길이다.
   *    trigger 칸은 진단용이다 — 잠금 · 장부 · 상한은 회차 종류로 갈리지 않는다.
   */
  let prisma: PrismaClient | null = null
  try {
    return await leaseEntry({
      lockDir, lockFile: COMMENT_LOOP_LOCK_FILE, scriptPath: fileURLToPath(import.meta.url), argv: process.argv.slice(2),
      env: process.env, trigger: process.env.XPC_SERVICE_NAME === COMMENT_RUNNER_LABEL ? 'scheduled' : 'manual',
      log: (l) => console.log(l),
      pass: async (pass, proof) => {
        if (pass === 0) console.log(`\n══ 무인 Persona 댓글 루프 ${LIVE ? '(--live)' : '(dry-run)'} · 커널 lease 안 ══\n`)
        prisma ??= new PrismaClient()
        return runPass(prisma, new Date(), pass, proof)
      },
    })
  } catch (e) {
    console.error(`🔴 회차 예외 — ${e instanceof Error ? e.name : 'unknown'}`)
    return 1
  } finally {
    if (prisma !== null) await (prisma as PrismaClient).$disconnect().catch(() => undefined)
  }
}

/** 🔴 한 회차 — lease 를 쥔 채로만 부른다. 0 정상 · 1 예외 · 2 발행 오류가 남았다 */
async function runPass(prisma: PrismaClient, now: Date, pass: number, proof: LeaseProof): Promise<number> {
  try {
    const budget = commentLoopLimitsFromEnv(process.env)
    const missing = missingBudgetEnvNames(budget.limits)
    for (const n of budget.notes) console.log(`  예산  ${n}`)
    /**
     * 🔴 **예산 — 유료 생성 전에 본다**(정기 · 사건 · 복구가 같은 장부 · 같은 상한). 소진 · 보류 · 못 읽음이면
     *    provider 0(사전 계산 포함). 발행 sweep 은 돈다 — 이미 쓴 돈으로 만든 후보를 내는 데는 유료 호출이 없다.
     */
    const ledger = ((): Parameters<typeof generationGateOf>[0]['ledger'] => {
      try { return readCostSignals(now, process.env as Record<string, string>).commentLedger } catch { return null }
    })()
    const gate = generationGateOf({ missingEnv: missing, ledger })
    const session = new SupplyLlmSession({
      runId: `comment-loop-${now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}${pass === 0 ? '' : `-f${pass}`}`,
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
        // 🔴 유료 호출 직전 — 커널 잠금 증명을 다시 본다(lockf 가 죽었으면 잠금이 풀렸다 · 부르지 않는다)
        if (!stillInKernelLease(proof, process.env)) return { ok: false, text: null, errorCode: 'LEASE_LOST' }
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
      prisma, now, env: process.env, live: LIVE,
      source: makeDbTargetSource({ prisma, windowStart: new Date(now.getTime() - 7 * 86_400_000) }),
      canon,
      makeGenerate,
      generation: gate,
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
    console.log(`COMMENT_LOOP pass=${pass} outcome=${report.outcome} targets=${report.targets} providerCalls=${report.providerCalls}`
      + ` enqueued=${report.enqueued} | ${sweepLine('sweep①', report.sweepBefore)} | ${sweepLine('sweep②', report.sweepAfter)}\n`)
    const errors = (report.sweepBefore?.errors ?? 0) + (report.sweepAfter?.errors ?? 0)
    return errors > 0 || t.settleHeld > 0 ? 2 : 0
  } catch (e) {
    console.error(`🔴 회차 예외 — ${e instanceof Error ? e.name : 'unknown'}`)
    return 1
  }
}

process.exit(await main())
