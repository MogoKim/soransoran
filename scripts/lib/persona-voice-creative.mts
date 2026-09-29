/**
 * Persona **creative 단계** — 제목·성격·noGo·variation (2026-09-29, Lane 3)
 *
 * 🔴 **유료 호출을 하지 않는다.** 이 파일에 있는 것은
 *      ① provider **인터페이스**
 *      ② **fixture** provider (결정론 · 비용 0 · 시험/격리 DB 전용 — origin=`fixture` 표식이 붙는다)
 *      ③ **예산 게이트** — 공급 장부와 같은 판정(`reserveOf` → `judgeSpend`)을 **부르기 전에** 건다
 *    live provider 는 자리만 있다. `generate` 는 언제나 던진다(`LIVE_CALL_NOT_EXECUTED`).
 *
 * 🔴 **예산 게이트가 먼저, 부르기는 나중.** 게이트가 막으면 provider 의 `generate` 는 **한 번도**
 *    불리지 않는다 — 시험이 호출 수를 센다. 게이트가 열려도 `liveEnabled` 가 참이 아니면 부르지 않는다.
 *    이 PR 의 어떤 CLI 도 `liveEnabled: true` 를 넘기지 않는다.
 *
 * 🔴 장부에 **쓰지 않는다.** 읽기(`readCreativeBudget`)만 한다 — 예약 줄을 남기는 것은 실제로 부를 때
 *    `SupplyLlmSession` 이 한다(그 단계 이름 추가는 장부 소유 레인의 일이다 — 이 PR 은 건드리지 않는다).
 *
 * 🔴 creative 입력에 **댓글 원문을 넣지 않는다.** 생활사 골격과 말투 관찰값(길이·높임·어미·이모티콘)뿐이다.
 */
import { randomUUID } from 'node:crypto'

import { checkContent } from '../../src/lib/content-guard'
import {
  classifyReservations, judgeSpend, ledgerDateOf, runPaidCountOf, tallyOf,
  type BlockCode, type BudgetLimits, type DayTally, type ReservationVerdict,
} from '../../src/lib/llm-ledger'
import { reserveOf, type CostVerdict } from '../../src/lib/llm-pricing'
import { VARIATION_MAX, VARIATION_MIN } from '../../src/lib/persona-card-verify'
import type { LifeSkeleton, PersonaCreative } from '../../src/lib/persona-autogen'
import {
  defaultLedgerDir, ledgerPathOf, pidAlive, readLedgerDay, readLedgerRun, readOpenReservations, readSettleHold,
} from './llm-ledger-store.mjs'

export type CreativeRequest = {
  code: string
  life: LifeSkeleton
  voiceCore: { length: string; register: string; ending: string; emoji: string }
}

export type CreativeOrigin = 'fixture' | 'live'

/** 🔴 provider 인터페이스 — 무엇이 creative 를 만드는가. 판정은 여기서 하지 않는다 */
export interface CreativeProvider {
  readonly kind: CreativeOrigin
  /** 🔴 단가표(`MODEL_PRICES`)의 내부 라벨 — 예약액을 여기서 낸다 */
  readonly model: string
  generate(req: CreativeRequest): Promise<PersonaCreative>
}

export const CREATIVE_OUTCOME_CODES = [
  'CREATIVE_BUDGET_BLOCKED', // 🔴 예산 게이트가 막았다 — provider 를 부르지 않았다
  'LIVE_CALL_NOT_EXECUTED',  // 🔴 게이트는 열렸지만 이 PR 은 유료 호출을 하지 않는다
  'CREATIVE_INVALID',        // 결과가 계약(칸·개수·가드)을 어긴다
  'CREATIVE_PROVIDER_ERROR', // provider 가 던졌다
] as const
export type CreativeOutcomeCode = (typeof CREATIVE_OUTCOME_CODES)[number]

export type CreativeOutcome =
  | { ok: true; creative: PersonaCreative; origin: CreativeOrigin }
  | { ok: false; code: CreativeOutcomeCode; blockCode: BlockCode | null; reason: string }

/** 🔴 예산 게이트의 입력 — 전부 장부에서 **읽은** 값이다. 메모리 카운터가 아니다 */
export type CreativeBudget = {
  limits: BudgetLimits
  tally: DayTally
  runPaid: number
  ledgerOk: boolean
  settleHold: string | null
  unresolved: readonly ReservationVerdict[]
  /** 공식 사전 계산값 — 🔴 이 PR 은 네트워크를 쓰지 않으므로 운영에서는 늘 null(=`NO_COUNT`)이다 */
  countedInputTokens: number | null
  maxOutputTokens: number
}

/** 🔴 creative 한 명의 출력 상한 — 제목·성격·noGo·variation 을 담는 JSON 한 덩어리 */
export const CREATIVE_MAX_OUTPUT_TOKENS = 1_200

/**
 * 🔴 **요청 전 차단 — 공급 장부와 같은 판정.** 예산·단가·사전 계산·장부 상태 중 하나라도 모르면 막는다.
 */
export function judgeCreativeSpend(model: string, budget: CreativeBudget | null): ReturnType<typeof judgeSpend> {
  if (budget === null) {
    return { ok: false, code: 'NO_BUDGET', reason: '예산 입력이 없다 — 유료 요청을 보류한다' }
  }
  const reserve: CostVerdict = budget.countedInputTokens === null || budget.limits.headroomMultiplier === null
    ? { known: false, code: 'NO_USAGE', reason: '공식 사전 계산값이나 여유 배수가 없다' }
    : reserveOf({
      model, countedInputTokens: budget.countedInputTokens,
      maxOutputTokens: budget.maxOutputTokens, headroomMultiplier: budget.limits.headroomMultiplier,
    })
  return judgeSpend({
    limits: budget.limits, tally: budget.tally, runPaid: budget.runPaid, reserve,
    ledgerOk: budget.ledgerOk, settleHold: budget.settleHold, unresolved: budget.unresolved,
  })
}

/** 🔴 결과 계약 — 칸이 비거나 개수가 어긋나거나 글쓰기 가드(bot)를 못 넘으면 쓰지 않는다 */
export function creativeProblems(c: PersonaCreative): string[] {
  const out: string[] = []
  if (c.title.trim() === '') out.push('title 비어 있음')
  if (c.personality.length === 0) out.push('personality 비어 있음')
  if (c.noGoTopics.length === 0) out.push('noGoTopics 비어 있음')
  if (c.noGoExpressions.length === 0) out.push('noGoExpressions 비어 있음')
  if (c.noGoExpressions.some((e) => !/^".+"/.test(e.trim()))) out.push('noGoExpressions 는 따옴표로 시작해야 한다(카드 파서 계약)')
  if (c.variations.length < VARIATION_MIN || c.variations.length > VARIATION_MAX) {
    out.push(`variations ${c.variations.length}개 (${VARIATION_MIN}~${VARIATION_MAX})`)
  }
  const all = [c.title, ...c.personality, ...c.noGoTopics, ...c.noGoExpressions, ...c.variations]
  if (all.some((s) => !checkContent(s, { audience: 'bot' }).ok)) out.push('글쓰기 가드(bot) 비통과')
  return out
}

/**
 * 🔴 **creative 한 명.** fixture 는 게이트 없이 부른다(비용 0 · origin 표식).
 *    live 는 ① 예산 게이트 → ② `liveEnabled` → ③ 부르기 순서다. ①·② 중 하나라도 막히면 부르지 않는다.
 */
export async function runCreativeStep(
  provider: CreativeProvider,
  req: CreativeRequest,
  opts: { budget: CreativeBudget | null; liveEnabled: boolean },
): Promise<CreativeOutcome> {
  if (provider.kind === 'live') {
    const gate = judgeCreativeSpend(provider.model, opts.budget)
    if (!gate.ok) {
      return { ok: false, code: 'CREATIVE_BUDGET_BLOCKED', blockCode: gate.code, reason: gate.reason }
    }
    if (!opts.liveEnabled) {
      return {
        ok: false, code: 'LIVE_CALL_NOT_EXECUTED', blockCode: null,
        reason: '예산 게이트는 열렸지만 유료 호출은 이 PR 범위 밖이다 — 부르지 않았다',
      }
    }
  }
  let creative: PersonaCreative
  try {
    creative = await provider.generate(req)
  } catch (e) {
    return {
      ok: false, code: e instanceof Error && e.message === 'LIVE_CALL_NOT_EXECUTED' ? 'LIVE_CALL_NOT_EXECUTED' : 'CREATIVE_PROVIDER_ERROR',
      blockCode: null, reason: e instanceof Error ? e.message : 'unknown',
    }
  }
  const problems = creativeProblems(creative)
  if (problems.length > 0) return { ok: false, code: 'CREATIVE_INVALID', blockCode: null, reason: problems.join(' / ') }
  return { ok: true, creative, origin: provider.kind }
}

/**
 * 🔴 **live provider — 자리만 있다.** 부르면 던진다. 실제 호출 구현·단계 이름(`LEDGER_STAGES`) 추가·
 *    유료 승인은 이 PR 범위 밖이다(남은 blocker).
 */
export class LiveCreativeProvider implements CreativeProvider {
  readonly kind = 'live' as const
  constructor(readonly model: string) {}
  generate(): Promise<PersonaCreative> {
    return Promise.reject(new Error('LIVE_CALL_NOT_EXECUTED'))
  }
}

/**
 * 🔴 **fixture provider** — 생활사 골격에서 결정론으로 만든다. 사람다운 글자를 지어내는 척하지 않는다:
 *    제목·성격은 골격 칸을 그대로 풀어 쓴 것이고, 결과에는 origin=`fixture` 가 붙어 운영 적재를 막는다.
 *    🔴 fixture 가 실제보다 강하면 안 된다 — 운영 검증기(카드 파서·seed 검증·배정 판정)는 똑같이 통과해야 한다.
 */
export class FixtureCreativeProvider implements CreativeProvider {
  readonly kind = 'fixture' as const
  readonly model = 'fixture'
  calls = 0
  generate(req: CreativeRequest): Promise<PersonaCreative> {
    this.calls += 1
    const l = req.life
    const kids = l.childrenCount === 0 ? '아이 없이' : `아이 ${l.childrenCount}명 키우며`
    return Promise.resolve({
      title: `${l.region}에서 ${kids} ${l.workStatus} 하는 ${l.ageBand}`,
      personality: req.voiceCore.register === '존댓말' ? ['차분함', '듣는 편', '말 아낌'] : ['털털함', '말 짧음', '솔직함'],
      noGoTopics: ['금액 언급', '가족 험담'],
      noGoExpressions: ['"다 지나가요" 류'],
      variations: ['짧게 맞장구', '담백한 한마디', '되묻기', '무호칭', '한 줄 위로'],
    })
  }
}

/**
 * 🔴 **장부를 읽기만 한다** — 오늘 집계 · 이 회차 유료 수 · 열린 예약 · 보류 표식.
 *    읽지 못한 것이 하나라도 있으면 `ledgerOk=false` 다(게이트가 막는다). 쓰지 않는다.
 */
export function readCreativeBudget(input: {
  limits: BudgetLimits
  runId: string
  now: Date
  dir?: string
}): CreativeBudget {
  const dir = input.dir ?? defaultLedgerDir()
  const date = ledgerDateOf(input.now)
  const day = readLedgerDay(ledgerPathOf(dir, date))
  const run = readLedgerRun(dir, date, input.runId)
  const open = readOpenReservations(dir)
  const split = classifyReservations({
    open: open.ok ? open.list : [], now: input.now, sessionId: randomUUID(), pid: process.pid, pidAlive,
  })
  return {
    limits: input.limits,
    tally: day.ok ? tallyOf(day.entries) : tallyOf([]),
    runPaid: run.ok ? runPaidCountOf(run.entries, input.runId) : 0,
    ledgerOk: day.ok && run.ok && open.ok,
    settleHold: readSettleHold(dir),
    unresolved: split.unresolved,
    countedInputTokens: null,
    maxOutputTokens: CREATIVE_MAX_OUTPUT_TOKENS,
  }
}
