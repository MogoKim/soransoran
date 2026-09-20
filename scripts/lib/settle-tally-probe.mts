/**
 * 🔴 **시험 전용 탐침 — 정산 집계가 언제 올라가는지 실제 호출로 본다** (2026-09-20).
 *
 *    `supply-chain-e2e-check` 가 가짜 provider 훅과 함께 이 파일을 자식 프로세스로
 *    띄운다. 한 프로세스가 **유료 요청 1건**을 실제 `SupplyLlmSession` 으로 보내고,
 *    끝난 뒤 회차 집계를 JSON 한 줄로 찍는다.
 *
 * 🔴 **왜 소스 문자열 검사로 하지 않는가.** "집계 줄이 `clearOpen` 아래에 있다" 는
 *    정규식은 줄이 옮겨지면 같이 옮겨 가 늘 통과한다. 여기서는 **숫자를 직접 읽는다**.
 *
 * 🔴 운영 경로는 이 파일을 import 하지 않는다. 장부는 인자로 받은 임시 경로에만 쓴다.
 *
 * 사용:  tsx settle-tally-probe.mts <ledgerDir> <ok|settle-fail>
 */
import { REAL_LEDGER_IO, SupplyLlmSession, type LedgerIo } from './supply-llm-call.mjs'

const dir = process.argv[2] ?? ''
const mode = process.argv[3] ?? 'ok'
if (dir === '') throw new Error('장부 디렉터리를 주어야 한다')

/**
 * 🔴 정산 줄만 못 적는 저장소 — 사전 계산 줄(`countTokens`)과 예약 줄은 그대로 적힌다.
 *    그래야 "요청은 나갔는데 정산만 안 적힌" 상태가 만들어진다.
 */
const failingIo: LedgerIo = {
  ...REAL_LEDGER_IO,
  append: (path, entry) => {
    if (entry.stage === 'draftGen' && entry.status !== 'reserved' && entry.endedAt !== null) {
      throw new Error('probe: 정산 줄을 적지 못했다')
    }
    REAL_LEDGER_IO.append(path, entry)
  },
}

const session = new SupplyLlmSession({
  runId: 'PROBE',
  dir,
  limits: { dailyUsd: 1000, runRequestCap: 100, headroomMultiplier: 1.5 },
  ...(mode === 'settle-fail' ? { io: failingIo } : {}),
})

const res = await session.call({
  stage: 'draftGen',
  model: 'claude-haiku-4.5',
  systemPrompt: '탐침',
  userPayload: '탐침 요청',
  maxOutputTokens: 256,
  timeoutMs: 20_000,
})

const t = session.tally
console.log(JSON.stringify({
  ok: res.ok,
  errorCode: res.errorCode,
  settledUsdReturned: res.settledUsd,
  settlementRecorded: res.settlementRecorded,
  usageKnown: res.usageKnown,
  paid: t.paid,
  reservedUsd: t.reservedUsd,
  settledUsd: t.settledUsd,
  usageUnknown: t.usageUnknown,
  overruns: t.overruns,
  settleHeld: t.settleHeld,
  holdWriteFailed: t.holdWriteFailed,
}))
