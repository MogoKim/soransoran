/**
 * 🔴 **무인 운영 한 화면 — 순수 판정. 파일·DB·launchctl 0** (2026-09-28)
 *
 *    supply · publish · comment · audit 네 레인의 "최근 성공 · 최근 실패 이유 · runtime SHA ·
 *    오늘 비용/상한" 을 한 모양으로 만든다. 읽기는 `scripts/ops-status.mts` 가 하고,
 *    이 파일은 **읽은 값을 판정만** 한다 — fixture 가 판정을 직접 물어볼 수 있게.
 *
 * 🔴 **새 문턱값을 만들지 않는다.** 비용 판정은 장부 정본(`llm-ledger`)의 막는 코드
 *    (`LEDGER_ERROR` · `SETTLE_ERROR` · `UNSETTLED_OVERRUN` · `DAILY_EXHAUSTED` · `NO_BUDGET`)를
 *    그대로 쓴다. 단계 controller 도 **이 함수**로 비용을 본다 — 화면과 결정이 갈리지 않게.
 */
import type { DayTally, BlockCode } from './llm-ledger'

/** 🔴 네 레인 — 순서가 화면 순서다 */
export const OPS_LANES = ['supply', 'publish', 'comment', 'audit'] as const
export type OpsLane = (typeof OPS_LANES)[number]

export type Health = 'ok' | 'bad' | 'unknown'

export type CostVerdict = {
  health: Health
  /** 오늘 쓴 금액 = 정산 + 미정산 예약(정본 `tallyOf` 가 여력에서 빼는 값) — 못 읽으면 null */
  spentUsd: number | null
  /** 하루 상한 — 설정이 없으면 null */
  capUsd: number | null
  /** 🔴 장부 정본의 코드 그대로 */
  codes: BlockCode[]
  reasons: string[]
}

/**
 * 🔴 **비용 판정 — 장부 정본의 막는 조건을 그대로 쓴다.**
 *    · 장부를 못 읽음      → `LEDGER_ERROR`       · bad (정본: 유료 요청 보류)
 *    · 정산 보류 표식       → `SETTLE_ERROR`       · bad
 *    · 실제 > 예약 건 있음   → `UNSETTLED_OVERRUN`  · bad
 *    · 쓴 금액 ≥ 하루 상한   → `DAILY_EXHAUSTED`    · bad
 *    · 상한 미설정         → `NO_BUDGET`          · unknown (상한과 견줄 수 없다 — 유료 호출도 0 이다)
 *    `uses` 가 false 면(유료 호출이 없는 레인 — 발행) 상한 없이 ok 다.
 */
export function judgeCost(input: {
  /** 유료 호출을 하는 레인인가 */
  uses: boolean
  /** 오늘 집계 — 장부를 못 읽었으면 null */
  tally: DayTally | null
  ledgerError: string | null
  settleHold: string | null
  capUsd: number | null
}): CostVerdict {
  if (!input.uses) {
    return { health: 'ok', spentUsd: 0, capUsd: null, codes: [], reasons: ['유료 호출이 없는 레인이다'] }
  }
  const codes: BlockCode[] = []
  const reasons: string[] = []
  if (input.tally === null || input.ledgerError !== null) {
    codes.push('LEDGER_ERROR')
    reasons.push(`장부를 읽지 못했다 — ${input.ledgerError ?? '집계 없음'}`)
    if (input.settleHold !== null) { codes.push('SETTLE_ERROR'); reasons.push(input.settleHold) }
    return { health: 'bad', spentUsd: null, capUsd: input.capUsd, codes, reasons }
  }
  const t = input.tally
  const spent = Math.round((t.settledUsd + t.openReservedUsd) * 1e6) / 1e6
  if (input.settleHold !== null) { codes.push('SETTLE_ERROR'); reasons.push(input.settleHold) }
  if (t.overruns > 0) { codes.push('UNSETTLED_OVERRUN'); reasons.push(`실제 사용량이 예약을 넘은 요청 ${t.overruns}건`) }
  if (input.capUsd !== null && spent >= input.capUsd) {
    codes.push('DAILY_EXHAUSTED')
    reasons.push(`오늘 $${spent.toFixed(4)} ≥ 상한 $${input.capUsd.toFixed(2)}`)
  }
  if (codes.length > 0) return { health: 'bad', spentUsd: spent, capUsd: input.capUsd, codes, reasons }
  if (input.capUsd === null) {
    return {
      health: 'unknown', spentUsd: spent, capUsd: null, codes: ['NO_BUDGET'],
      reasons: ['하루 상한이 설정되지 않았다 — 상한과 견줄 수 없다(정본: 유료 요청 보류)'],
    }
  }
  return { health: 'ok', spentUsd: spent, capUsd: input.capUsd, codes: [], reasons: [] }
}

/**
 * 🔴 **로그에서 비밀값을 지운다.** 오류 줄에는 접속 주소·키가 섞일 수 있다(Prisma 오류는 host 를 찍는다).
 *    화면에 내기 전에 **항상** 이 함수를 지난다.
 */
export function redactSecrets(line: string): string {
  return line
    .replace(/\b(postgres(?:ql)?|mysql|redis|https?):\/\/[^\s'"]+/gi, '$1://[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/g, 'AIza[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    // 🔴 오류 문장 안의 접속 host(`db.example.com:6543`)도 지운다 — 주소 일부도 찍지 않는다
    .replace(/`[^`\s]*\.[a-z]{2,}(:\d+)?`/gi, '`[host]`')
}

/**
 * 🔴 **로그 끝에서 실패 이유 한 줄을 고른다.** 코드 발췌(`127   …` · `→ 130 …`)·stack 줄(`at …`)·
 *    빈 줄·node 버전 줄은 이유가 아니다 — Prisma 오류는 원본 코드 몇 줄을 함께 찍는데, 그 안의
 *    주석(🔴 …)을 이유로 고르면 화면이 거짓말을 한다(2026-09-28 실측).
 *    ① 원인 문장(연결 실패·권한·시간 초과) → ② `XxxError:` 머리 → ③ 일반 오류 낱말 순으로 찾는다.
 *    이유다운 줄이 없으면 `null` — 지어내지 않는다.
 */
const NOT_A_REASON = [
  /^at\s/, /^Node\.js v\d/, /^[{}]$/, /^\^+$/, /^\d+\s{2,}/, /^→\s*\d+/,
  /^(clientVersion|errorCode|retryable|code|meta)\s*:/, /^Please make sure/, /^Invalid `/, /^throw\s/,
]
const CAUSE = /Can't reach|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EACCES|EPERM|timed? ?out|denied|refused|No such file|not found|exit \d+|killed|SIGTERM|SIGKILL/i
const ERROR_HEAD = /^[A-Za-z]*(Error|Exception)\b\s*:?\s*\S/
const GENERIC = /error|fail|🔴|exception/i

export function lastFailureLine(logText: string): string | null {
  const lines = logText.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    .filter((l) => !NOT_A_REASON.some((re) => re.test(l)))
  for (const re of [CAUSE, ERROR_HEAD, GENERIC]) {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (re.test(lines[i]!)) return redactSecrets(lines[i]!).slice(0, 240)
    }
  }
  return null
}

export type LaneStatus = {
  lane: OpsLane
  label: string
  /** installed · loaded · unknown 을 합친 한 단어 */
  job: 'loaded' | 'unloaded' | 'notInstalled' | 'unknown'
  lastExitCode: number | null
  runs: number | null
  /** 마지막 성공 시각(ISO)과 그 근거 */
  lastSuccessAt: string | null
  lastSuccessBasis: string
  /** 마지막 실패 — 시각(ISO)·이유. 없으면 null */
  lastFailureAt: string | null
  lastFailureReason: string | null
  /** 그 job 이 도는 작업트리의 HEAD · 고정 pin · 회차가 남긴 SHA */
  runtimeSha: string | null
  cost: CostVerdict
  /** 이 레인 전체 판정 */
  health: Health
  notes: string[]
}

/**
 * 🔴 **레인 판정** — 실패가 이긴다. 모르는 것은 모른다.
 *    · 설치·load 안 됨 → bad(돌지 않는다) · 단, 정책상 아직 등록하지 않은 레인은 부르는 쪽이 note 로 남긴다
 *    · 마지막 종료가 0 이 아님 → bad
 *    · 비용 bad → bad
 *    · 마지막 실패가 마지막 성공보다 늦다 → bad
 */
export function laneHealth(s: Omit<LaneStatus, 'health'>): Health {
  if (s.job === 'unknown') return 'unknown'
  if (s.job !== 'loaded') return 'bad'
  if (s.lastExitCode !== null && s.lastExitCode !== 0) return 'bad'
  if (s.cost.health === 'bad') return 'bad'
  if (s.lastFailureAt !== null && (s.lastSuccessAt === null || s.lastFailureAt > s.lastSuccessAt)) return 'bad'
  if (s.lastSuccessAt === null) return 'unknown'
  if (s.cost.health === 'unknown') return 'unknown'
  return 'ok'
}
