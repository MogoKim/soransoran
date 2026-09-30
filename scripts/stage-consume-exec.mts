#!/usr/bin/env tsx
/**
 * 🔴 **단계 결정 consumer — 러너를 감싸 실행한다. 러너 코드는 한 줄도 바꾸지 않는다**
 *
 *   npx tsx scripts/stage-consume-exec.mts --by=publish -- npx tsx scripts/original-post-auto-publish.mts --apply …
 *   npx tsx scripts/stage-consume-exec.mts --by=supply --print     무엇을 넣을지 보여만 준다(실행 0)
 *
 * 🔴 **왜 감싸는가.** 러너는 `loadEnvLocal()` 로 `.env.local` 을 읽되 **이미 있는 값은 덮지 않는다.**
 *    실행 직전에 결정 값을 env 로 넣으면 그 값이 이긴다 — 발행·공급 러너 파일을 건드리지 않고 연결된다.
 *
 * 🔴 계약 (정본 `consumeStageDecision` 그대로)
 *    · 그날 결정이 검증을 통과했다 → 공개·천장 = 결정 · **표식**(`STAGE_DECISION_MARK_ENV` = 결정 날짜)을 함께 넣는다
 *    · 결정이 없다 · 깨졌다 · DB 를 못 읽었다 · `STAGE_CONTROLLER_ENABLED` 가 on 이 아니다(kill switch)
 *      → 가장 안전한 d1 (사후에 만들지 않는다)
 *
 * 🔴 **자동 실행의 유일한 문이다** (2026-09-30 · Lane A 단일 실행 authority).
 *    · 옛 legacy 경로(flag off → 아무것도 넣지 않고 `.env.local` 단계가 이기던 것)는 지웠다.
 *    · 러너를 이 파일 없이 부르면 단계 칸에 표식이 없어 `scale-runtime` 이 **읽지 않는다**(= d1).
 *    · 워크플로 · launchd 템플릿 · package.json 이 발행/공급 러너를 이 문 없이 부르면
 *      `stage-authority-graph`(runtime-isolation-check ⑦)가 CI 에서 막는다.
 *
 * 🔴 DB write 0. 읽기는 오늘 결정 한 행뿐이다.
 */
import { spawnSync } from 'node:child_process'

import { PrismaClient } from '@prisma/client'

import { kstDateString } from '../src/lib/release-canary'
import { consumeStageDecision, controllerEnabled, CONTROLLER_ENV, DECISION_CONSUMERS, type DecisionConsumer } from '../src/lib/stage-decision-store'
import { stageDecisionIo } from '../src/lib/stage-decision-repo'
import { validateStoredDecision } from '../src/lib/stage-decision-contract'
import { consumerEnvOf } from '../src/lib/stage-controller'
import { fillDbConnection, readEnvKeys } from './lib/ops-signals.mjs'
import { recordPublishRun } from './lib/publish-run-record.mjs'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const own = sep < 0 ? argv : argv.slice(0, sep)
const cmd = sep < 0 ? [] : argv.slice(sep + 1)
const PRINT = own.includes('--print')
const byRaw = own.find((a) => a.startsWith('--by='))?.slice(5) ?? ''
if (!(DECISION_CONSUMERS as readonly string[]).includes(byRaw)) {
  console.error(`🔴 --by 는 ${DECISION_CONSUMERS.join('|')} 중 하나다 — 받은 값 "${byRaw}"`)
  process.exit(2)
}
const BY = byRaw as DecisionConsumer
if (!PRINT && cmd.length === 0) {
  console.error('🔴 실행할 명령이 없다 — `-- <명령>` 을 붙인다')
  process.exit(2)
}

const NOW = new Date()
const today = kstDateString(NOW)
const flagOn = controllerEnabled(readEnvKeys([CONTROLLER_ENV]).values)

let overrides: Record<string, string>
let note: string
if (!flagOn) {
  // 🔴 kill switch — 결정을 읽지 않고 가장 안전한 단계를 **명시해서** 넣는다(env 파일 단계가 이기지 못한다)
  overrides = consumerEnvOf({ ok: false, code: 'NO_DECISION', fallback: 'safest', reason: `${CONTROLLER_ENV} off` })
  note = `${CONTROLLER_ENV} off — kill switch → safest`
} else {
  let prisma: PrismaClient | null = null
  try {
    const outcome = await consumeStageDecision({
      read: async () => {
        if (!fillDbConnection()) throw new Error('DATABASE_URL 없음')
        prisma = new PrismaClient()
        return stageDecisionIo(prisma, today).read()
      },
      validate: (row) => validateStoredDecision({ row, expectKstDate: today }),
      controllerOn: true, by: BY,
    })
    overrides = consumerEnvOf(outcome)
    note = outcome.ok
      ? `${today} 결정 ${outcome.decision.state} · 공개 ${outcome.decision.release} · 천장 ${outcome.decision.capacity}`
      : `${outcome.code} → ${outcome.fallback} — ${outcome.reason}`
  } catch (e) {
    // 🔴 못 읽었다 — 정본 fallback 과 같은 자리(가장 안전한 단계)로 간다
    overrides = consumerEnvOf({ ok: false, code: 'BROKEN', fallback: 'safest', reason: 'read failed' })
    note = `결정을 읽지 못했다(${(e as Error).name}) → safest`
  } finally {
    if (prisma !== null) await (prisma as PrismaClient).$disconnect()
  }
}

console.error(`[stage-consume ${BY}] ${note}`)
if (PRINT) {
  for (const [k, v] of Object.entries(overrides)) console.log(`${k}=${v}`)
  process.exit(0)
}
const startedAt = new Date()
const r = spawnSync(cmd[0]!, cmd.slice(1), { stdio: 'inherit', env: { ...process.env, ...overrides } })
if (r.error !== undefined) console.error(`🔴 실행하지 못했다 — ${r.error.message}`)
const exitCode = r.error !== undefined ? 127 : (r.status ?? 1)
/**
 * 🔴 발행 회차의 종료 값을 남긴다 — launchd 재등록 뒤에도 판정이 마지막 실제 회차를 읽는다.
 *    plist 에 명시한 실행 표식·label 이 정확한 회차만 남고(`publish-run-record`), 쓰기 실패는 종료 값을 바꾸지 않는다.
 */
if (BY === 'publish') {
  const rec = recordPublishRun({ env: process.env, startedAt, finishedAt: new Date(), exitCode })
  if (!rec.written) console.error(`[stage-consume publish] 회차 기록 ✕ — ${rec.reason}`)
}
process.exit(exitCode)
