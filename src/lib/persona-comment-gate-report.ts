/**
 * 9관문 **완전성 판정** — 🔴 순수 함수. DB · 네트워크 없음
 *
 * 🔴 **"9개 결과가 있다" 와 "9개가 실제로 돌았다" 는 다르다.**
 *
 *    `checkCommentCandidate` 는 입력과 무관하게 항상 ①~⑨ 각 1개를 돌려준다.
 *    그래서 `gates.length === 9` 는 아무것도 보장하지 않는다 —
 *    코퍼스가 없으면 ② 가 `notRun`, identity 가 없으면 ⑦ 이 `notRun` 인 채로
 *    9개가 채워진다. 그 상태에서 `status` 만 보면 **"9관문 통과"** 로 읽힌다.
 *
 *    실제로 첫 shadow 판이 그랬다. `toGateInput` 이 `knownNames` · `frequencyLookup` ·
 *    `identity` · `noGoTopics` · `priorTexts` 를 하나도 넘기지 않아
 *    여러 관문이 돌지 않은 채 `pass` 로 집계됐다.
 *
 * 🔴 그래서 **돌지 않은 관문을 세는 것**이 이 파일의 일이다.
 *    공개 Queue 에 갈 수 있는 후보는 필수 관문 `notRun` 이 0 이어야 한다.
 */

import {
  DEFAULT_FINGERPRINT_THRESHOLDS, gateEightCanRun, REQUIRED_PRIOR_TEXTS,
} from './persona-fingerprint-thresholds'

export const GATE_CODES = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'] as const
export type GateCode = (typeof GATE_CODES)[number]

export type GateOutcome = 'pass' | 'review' | 'regenerate' | 'reject' | 'notRun'

export type GateLine = { gate: string; outcome: string; detail?: string }

/**
 * 🔴 **공개 Queue 적재에 반드시 돌아야 하는 관문.**
 *
 *    ⑨(카페 운영 문맥)는 출처가 카페일 때만 의미가 있으므로 여기 넣지 않는다 —
 *    다만 그 값을 **명시적으로 넘겼는지**는 호출부가 책임진다.
 *    나머지 여덟은 입력만 갖추면 항상 돌 수 있고, 돌지 않았다면 입력이 빠진 것이다.
 */
export const REQUIRED_GATES: readonly GateCode[] = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

export type GateReport = {
  /** 9개 결과가 빠짐없이 왔는가 — 반환값의 형식 계약 */
  shaped: boolean
  /** 실제로 돌아간 관문 수 (notRun 이 아닌 것) */
  ran: number
  /** 돌지 않은 관문 코드 */
  notRun: GateCode[]
  /** 필수인데 돌지 않은 것 */
  missingRequired: GateCode[]
  /** 통과한 관문 수 — 🔴 notRun 은 세지 않는다 */
  passed: number
  /**
   * 🔴 **돌아간 관문만 봤을 때** 최악 상태가 pass 인가.
   *
   *    `checkCommentCandidate.status` 가 말하는 것이 이것이다.
   *    돌지 않은 관문은 이 판정에 들어가지 않으므로, 이것만 보고
   *    "9관문 통과" 라고 부르면 **보지 않은 것을 통과로 세는 것**이 된다.
   */
  statusPass: boolean
  /**
   * 🔴 **필수 관문이 하나도 빠짐없이 돌았고, 그 전부가 pass 인가.**
   *    "9관문 통과" 라고 부를 수 있는 것은 이것뿐이다.
   */
  fullGatePass: boolean
  /** 공개 Queue 에 적재해도 되는가 — `fullGatePass` 여야 한다 */
  queueEligible: boolean
  reason: string
}

/**
 * 🔴 `notRun` 을 `pass` 로 세지 않는다.
 *
 *    돌지 않은 검사는 "문제가 없었다" 가 아니라 **"보지 않았다"** 다.
 *    그 둘을 같이 세면 통과율이 거짓이 되고, 거짓 통과율 위에서 공개를 켠다.
 *
 * 🔴 `statusPass` 와 `fullGatePass` 를 **다른 필드로** 돌려준다.
 *    이름 하나(`gatePass`)로 두었더니 호출부가 `status === 'pass'` 만 보고
 *    ⑧ 이 notRun 인 20표본을 전부 "Gate pass" 로 셌다(2026-09-09 실측).
 */
export function judgeGateReport(input: {
  gates: readonly GateLine[]
  /** 가장 엄격한 **실행된** 관문 결과 — `checkCommentCandidate.status` */
  status?: string
  required?: readonly GateCode[]
}): GateReport {
  const required = input.required ?? REQUIRED_GATES
  const empty = (reason: string): GateReport => ({
    shaped: false, ran: 0, notRun: [], missingRequired: [...required], passed: 0,
    statusPass: false, fullGatePass: false, queueEligible: false, reason,
  })
  const byCode = new Map<string, string>()
  for (const g of input.gates) {
    // 🔴 같은 관문이 두 번 오면 더 엄격한 쪽이 아니라 **형식 위반**으로 본다
    if (byCode.has(g.gate)) return empty(`관문 ${g.gate} 이 두 번 왔다 — 반환값 형식이 깨졌다(fail-closed)`)
    byCode.set(g.gate, g.outcome)
  }
  const shaped = GATE_CODES.every((c) => byCode.has(c)) && byCode.size === GATE_CODES.length
  if (!shaped) {
    const missing = GATE_CODES.filter((c) => !byCode.has(c))
    return { ...empty(`9개 결과가 오지 않았다 — 빠진 관문 ${missing.join('')}(fail-closed)`), notRun: [...missing] }
  }

  const notRun = GATE_CODES.filter((c) => byCode.get(c) === 'notRun')
  const ran = GATE_CODES.length - notRun.length
  const passed = GATE_CODES.filter((c) => byCode.get(c) === 'pass').length
  const missingRequired = required.filter((c) => byCode.get(c) === 'notRun')
  const statusPass = input.status === 'pass'
  // 🔴 "9관문 통과" 는 **필수 관문이 다 돌았을 때만** 말할 수 있다
  const fullGatePass = missingRequired.length === 0
    && required.every((c) => byCode.get(c) === 'pass')
  const queueEligible = fullGatePass && statusPass

  return {
    shaped: true, ran, notRun: [...notRun], missingRequired: [...missingRequired], passed,
    statusPass, fullGatePass, queueEligible,
    reason: missingRequired.length > 0
      ? `필수 관문 ${missingRequired.join('')} 이 돌지 않았다 — 9관문 통과가 아니다`
      : fullGatePass
        ? `필수 관문 ${required.length}개가 모두 돌았고 전부 pass 다`
        : '필수 관문은 다 돌았지만 pass 가 아닌 것이 있다',
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 Gate ⑧ cold-start
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **첫 댓글을 영원히 시작할 수 없는 자리가 있다.**
 *
 *    ⑧ 은 "같은 Persona 의 이전 발화와 얼마나 닮았나" 를 본다. 그러려면 이전 발화가
 *    있어야 한다. 그런데 발화는 Queue 를 거쳐야 생기고, Queue 는 ⑧ 이 돌아야 통과한다 —
 *    닭과 달걀이다. 실측: 24명 중 자기 댓글이 있는 Persona 는 1명뿐이고,
 *    나머지 23명은 이대로면 **첫 댓글을 영원히 만들 수 없다.**
 *
 * 🔴 그렇다고 자동으로 통과시키지 않는다. 통과시키면 ⑧ 은 있으나 마나 한 관문이 된다.
 *    **별도 상태**로 뺀다 — 자동 공개는 불가하고, 사람 승인 Queue 로만 갈 수 있다.
 *
 * 🔴 bootstrap 은 **한시적**이다. 표본이 쌓이면 끝내고 ⑧ 완전 판정으로 돌아간다.
 */
/**
 * 🔴 **숫자를 여기 다시 적지 않는다.** Gate ⑧ 의 정본에서 파생한다.
 *
 *    옛 판은 종료 기준을 `2` 라고 손으로 적었는데 ⑧ 의 실제 기준은 `minSamples: 5` 였다.
 *    그래서 prior 가 1·2·3 건인 Persona 는 **bootstrap 도 막히고 ⑧ 도 돌지 않는**
 *    사각지대에 빠졌다 — 첫 댓글을 하나 만들고 나면 두 번째부터 아무 데로도 갈 수 없었다.
 */
export const BOOTSTRAP_EXIT_PRIOR_TEXTS = REQUIRED_PRIOR_TEXTS
/**
 * 🔴 총 상한도 파생한다. 이보다 작으면 Persona 가 필요한 prior 수에 **영영 닿지 못한다** —
 *    상한이 곧 새로운 사각지대가 된다.
 */
export const BOOTSTRAP_MAX_PER_PERSONA = REQUIRED_PRIOR_TEXTS
export const BOOTSTRAP_MAX_PER_DAY_PER_PERSONA = 1

export type BootstrapFacts = {
  report: GateReport
  /** 이 Persona 의 기존 발화 수 (승인·발행된 것) */
  priorTextCount: number
  /** 이 Persona 가 지금까지 쓴 bootstrap 건수 */
  bootstrapUsedTotal: number
  /** 오늘 쓴 bootstrap 건수 */
  bootstrapUsedToday: number
  /** Persona 가 active 인가 */
  personaActive: boolean
  /** 🔴 실회원이 아닌가 — `judgeRealMember` 결과를 그대로 받는다 */
  realMember: boolean
  /** seed·voice 가 완전한가 */
  seedComplete: boolean
  /** 생활사 충돌이 있는가 */
  lifeConflict: boolean
  /** ratio·일 cap·kill switch 가 정상인가 */
  governorOk: boolean
}

export type BootstrapVerdict = {
  /** 🔴 사람 승인 Queue 로 보낼 수 있는가 */
  bootstrapReviewEligible: boolean
  /** 🔴 언제나 false — bootstrap 은 자동 공개하지 않는다 */
  autoPublishAllowed: false
  blockers: string[]
  reason: string
}

/**
 * 🔴 **bootstrap 은 "⑧ 만 못 돈 경우" 에만 열린다.**
 *
 *    다른 관문이 하나라도 안 돌았으면 그것은 cold-start 가 아니라 **입력 누락**이다.
 *    그 둘을 섞으면 코퍼스를 못 읽은 회차까지 bootstrap 으로 새어 나간다.
 */
export function judgeBootstrapEligible(f: BootstrapFacts): BootstrapVerdict {
  const blockers: string[] = []
  const r = f.report

  if (!r.shaped) blockers.push('9관문 결과 형식이 깨졌다')
  // 🔴 ⑧ 하나만 빠진 경우가 아니면 bootstrap 이 아니다
  if (!(r.missingRequired.length === 1 && r.missingRequired[0] === '⑧')) {
    blockers.push(
      r.missingRequired.length === 0
        ? '⑧ 이 돌았다 — bootstrap 이 필요 없다(정상 판정 대상)'
        : `⑧ 외에도 돌지 않은 필수 관문이 있다 (${r.missingRequired.join('')}) — 입력 누락이지 cold-start 가 아니다`,
    )
  }
  // 🔴 ⑧ 을 뺀 나머지 필수가 전부 pass 여야 한다
  const othersPass = REQUIRED_GATES.filter((c) => c !== '⑧')
    .every((c) => r.notRun.includes(c) === false)
  if (!othersPass || !r.statusPass) {
    blockers.push('⑧ 을 뺀 나머지 필수 관문이 전부 pass 가 아니다')
  }
  /**
   * 🔴 **prior 가 있다고 bootstrap 이 끝나는 것이 아니다.**
   *    ⑧ 은 후보를 포함해 `minSamples` 건이 되어야 돈다 — 그 전까지는 여전히 cold-start 다.
   *    "1건이라도 있으면 막는다" 로 두었더니 1·2·3 건이 사각지대가 됐다.
   */
  if (bootstrapPhaseOver(f.priorTextCount)) {
    blockers.push(
      `이전 발화가 ${f.priorTextCount}건 있다 — ⑧ 을 정상 판정할 수 있다`
      + `(필요 ${REQUIRED_PRIOR_TEXTS}건)`,
    )
  }
  if (!f.personaActive) blockers.push('Persona 가 active 가 아니다')
  if (f.realMember) blockers.push('🔴 실회원 계정이 붙어 있다(또는 판별 불가)')
  if (!f.seedComplete) blockers.push('seed·voice 가 불완전하다')
  if (f.lifeConflict) blockers.push('생활사가 충돌한다')
  if (!f.governorOk) blockers.push('ratio·일 cap·kill switch 가 정상이 아니다')
  if (f.bootstrapUsedTotal >= BOOTSTRAP_MAX_PER_PERSONA) {
    blockers.push(`bootstrap 을 이미 ${f.bootstrapUsedTotal}건 썼다 — Persona 당 ${BOOTSTRAP_MAX_PER_PERSONA}건까지다`)
  }
  if (f.bootstrapUsedToday >= BOOTSTRAP_MAX_PER_DAY_PER_PERSONA) {
    blockers.push(`오늘 bootstrap 을 이미 ${f.bootstrapUsedToday}건 썼다 — 하루 ${BOOTSTRAP_MAX_PER_DAY_PER_PERSONA}건까지다`)
  }

  return {
    bootstrapReviewEligible: blockers.length === 0,
    // 🔴 값이 아니라 타입으로 못박는다 — 어떤 분기로도 true 가 되지 않는다
    autoPublishAllowed: false,
    blockers,
    reason: blockers.length === 0
      ? '⑧ 만 대조 표본이 없다 — 🔴 자동 공개는 불가하고 사람 승인 Queue 로만 간다'
      : blockers[0]!,
  }
}

/**
 * 🔴 표본이 쌓이면 bootstrap 을 끝낸다 — 예외가 영구 규칙이 되지 않게.
 *
 *    기준은 Gate ⑧ 이 실제로 돌 수 있는 시점과 **정확히 같다**.
 *    `gateEightCanRun` 과 어긋나면 사각지대가 다시 생긴다.
 */
export function bootstrapPhaseOver(priorTextCount: number): boolean {
  return gateEightCanRun(priorTextCount)
}

/**
 * 🔴 Gate 입력이 갖춰졌는가 — **돌리기 전에** 본다.
 *
 *    돌린 뒤 `notRun` 을 세는 것과, 돌리기 전에 "이건 못 돈다" 를 아는 것은 다르다.
 *    후자를 알면 코퍼스를 못 읽은 회차를 아예 후보로 만들지 않을 수 있다.
 *
 * 🔴 `knownNames` 는 **없는 것과 빈 배열이 다르다.**
 *    빈 배열은 "회원 표시명이 하나도 없다(조회했다)" 이고,
 *    `undefined` 는 "조회하지 않았다" 다 — 후자에서 ⑥-A 는 아무것도 막지 못한다.
 */
export function judgeGateInputs(input: {
  knownNames: readonly string[] | undefined
  hasFrequencyLookup: boolean
  corpusName: string | undefined
  identity: unknown
  noGoTopics: readonly string[] | undefined
  noGoExpressions: readonly string[] | undefined
  priorTexts: readonly string[] | undefined
  sourceTexts: readonly string[]
  forbiddenRoles: readonly string[] | undefined
  adviceForbidden: boolean | undefined
  sourceIsCafeOperational: boolean | undefined
}): {
  /** 🔴 **필드를 다 넘겼는가** — 관문이 실제로 도는가와 다른 질문이다 */
  fieldsComplete: boolean
  /** 🔴 채운 입력으로 필수 관문이 **실제로 돌 수 있는가** */
  ok: boolean
  missing: string[]
  willNotRun: GateCode[]
} {
  const missing: string[] = []
  const willNotRun: GateCode[] = []
  /** 🔴 필드는 왔지만 양이 모자라 관문이 못 도는 경우 — 위와 나눠 센다 */
  const shortOfSample: string[] = []

  if (input.sourceTexts.every((t) => t.trim() === '')) {
    missing.push('sourceTexts (① 유출 대조가 성립하지 않는다)')
    willNotRun.push('①')
  }
  if (!input.hasFrequencyLookup || input.corpusName === undefined) {
    missing.push('frequencyLookup·corpusName (② 코퍼스 빈도)')
    willNotRun.push('②')
  }
  // 🔴 `undefined` 만 잡는다. `[]` 는 "조회했는데 없었다" 라 정상이다
  if (input.knownNames === undefined) {
    missing.push('knownNames (⑥-A 회원 표시명 대조 — 빈 배열과 구별한다)')
    willNotRun.push('⑥')
  }
  if (input.identity === undefined || input.identity === null) {
    missing.push('identity (⑦ 설정 모순)')
    willNotRun.push('⑦')
  }
  if (input.noGoTopics === undefined || input.noGoExpressions === undefined) {
    missing.push('noGoTopics·noGoExpressions (⑦ No-Go)')
    if (!willNotRun.includes('⑦')) willNotRun.push('⑦')
  }
  if (input.priorTexts === undefined) {
    missing.push('priorTexts (⑧ 이전 발화·같은 배치 앞선 후보)')
    willNotRun.push('⑧')
  } else if (!gateEightCanRun(input.priorTexts.length)) {
    /**
     * 🔴 **필드가 왔다고 관문이 도는 것이 아니다.**
     *    ⑧ 은 후보를 포함해 `minSamples` 건이 되어야 돈다.
     *    `priorTexts: []` 를 "완비" 로 보면, 실제로는 notRun 인 것을 통과로 세게 된다.
     */
    shortOfSample.push(
      `priorTexts 가 ${input.priorTexts.length}건뿐이다 —`
      + ` 후보 포함 ${input.priorTexts.length + 1} < ${DEFAULT_FINGERPRINT_THRESHOLDS.minSamples} 라 ⑧ 이 돌지 않는다`,
    )
    willNotRun.push('⑧')
  }
  if (input.forbiddenRoles === undefined) {
    missing.push('forbiddenRoles (⑦ 역할 위반)')
  }
  // 🔴 ⑨ 는 값이 없으면 판단할 수 없다. "카페가 아니다" 를 명시해야 돈다
  if (input.sourceIsCafeOperational === undefined) {
    missing.push('sourceIsCafeOperational (⑨ 카페 운영 문맥 — 아니면 false 를 명시한다)')
    willNotRun.push('⑨')
  }
  if (input.adviceForbidden === undefined) {
    missing.push('adviceForbidden (조언 금지 글 유형인지 명시한다)')
  }

  return {
    fieldsComplete: missing.length === 0,
    // 🔴 필드가 다 와도 표본이 모자라면 관문은 돌지 않는다
    ok: missing.length === 0 && shortOfSample.length === 0,
    missing: [...missing, ...shortOfSample],
    willNotRun,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 실제 회원 글의 외부 전송 정책
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **실제 회원 글로 외부 모델을 부르지 않는다 (2026-09-09).**
 *
 *    옛 판은 `post.content.slice(0, 600)` 을 "요약" 이라 부르고 프롬프트에 실어
 *    외부 provider 로 보냈다. **자르는 것은 요약이 아니라 원문 일부**다.
 *    실회원이 쓴 글의 앞 600자가 그대로 나가는 것이고, 그것은 이 저장소가
 *    다른 모든 경로에서 지켜 온 원칙(원문 미전송)과 어긋난다.
 *
 * 🔴 이 상수를 스크립트가 아니라 여기 두는 이유: 스크립트 안의 플래그는
 *    fixture 가 볼 수 없다. 여기 있으면 값이 뒤집히는 순간 검사가 깨진다.
 *
 * 🔴 풀려면 별도 단계에서 PII 제거 · 대상 글 유형 · 보관 금지 ·
 *    provider 전송 계약을 먼저 확정해야 한다. 플래그 하나로 풀 일이 아니다.
 */
export const REAL_POST_EXTERNAL_CALL_ALLOWED = false

export function judgeRealPostExternalCall(input: {
  /** 사용자가 `--call` 을 붙였는가 */
  asked: boolean
  /** 정책이 허용하는가 — 생략하면 정본 상수를 쓴다 */
  policyAllows?: boolean
}): { allowed: boolean; reason: string } {
  const policy = input.policyAllows ?? REAL_POST_EXTERNAL_CALL_ALLOWED
  if (!policy) {
    return {
      allowed: false,
      reason: '실제 회원 글을 외부 모델로 보내지 않는다 — 자른 원문은 요약이 아니다'
        + ' (모델 비교는 합성 입력을 쓰는 persona:comment-eval 로 한다)',
    }
  }
  if (!input.asked) return { allowed: false, reason: '--call 이 없다' }
  return { allowed: true, reason: '정책이 허용하고 --call 이 있다' }
}
