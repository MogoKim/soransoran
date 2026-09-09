/**
 * 댓글 **공개 release 계약** — 🔴 순수 함수. DB · 네트워크 없음
 *
 * 🔴 **켜는 조건을 한 곳에 모은다.**
 *
 *    지금까지 만든 것들(ratio governor · planner · input · Gate report · eval)은
 *    각자 옳지만 "그래서 지금 공개해도 되는가" 에는 아무도 답하지 않는다.
 *    조건이 흩어져 있으면 하나가 빠진 채로 켜지고, 빠진 것이 무엇인지 나중에 알게 된다.
 *
 * 🔴 **env 하나로 켜지지 않는다.** `release` 모드는 필요조건이지 충분조건이 아니다.
 *    모델 확정 · ratio 여유 · 사람 승인 · 트랜잭션 재검사가 **전부** 맞아야 한다.
 */

import { isExternalSourcedBody, type PostVisibilityInput } from './post-visibility'
import { judgeRealMember, type RealMemberProbe } from './real-member-gate'

// ─────────────────────────────────────────────────────────
// ① 모델 선택 계약
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **사람이 채점하기 전에는 winner 가 없다.**
 *
 *    parse율·Gate 통과율은 안전 지표이지 "그 사람 목소리인가" 를 재지 못한다.
 *    winner 가 없는데 provider 를 부르면, 어느 모델을 쓸지 정하지 않은 채
 *    돈을 쓰고 결과를 남기는 것이다. Queue 에 넣으면 그 결과가 사람 앞에 간다.
 */
export type ModelSelection = {
  status: 'confirmed' | 'provisional' | 'none'
  winner: string | null
}

/** 🔴 부를 수 있는 모델 — 여기 없는 이름은 모르는 모델이다 */
export const ALLOWED_MODELS: readonly string[] = [
  'claude-haiku-4.5', 'gpt-5-mini', 'gemini-3.7-flash',
]

export type ModelGateVerdict = {
  /** 실제 provider 를 불러도 되는가 */
  canCallProvider: boolean
  /** Queue 에 적재해도 되는가 */
  canWriteQueue: boolean
  reason: string
}

/**
 * 🔴 **winner 가 없으면 provider 호출도 Queue write 도 막는다.**
 *
 *    `provisional` 은 "아직 못 정했다" 이지 "일단 이걸로 하자" 가 아니다.
 *    모르는 모델 이름도 같다 — 오타 하나로 없는 모델에 돈을 쓴 적이 있다(2026-08-27 HTTP_404).
 */
export function judgeModelGate(input: {
  selection: ModelSelection | null
  /** 실제로 부르려는 모델 — 생략하면 winner 를 쓴다 */
  model?: string | null
}): ModelGateVerdict {
  const blocked = (reason: string): ModelGateVerdict =>
    ({ canCallProvider: false, canWriteQueue: false, reason })

  if (input.selection === null) {
    return blocked('모델 선택 결과가 없다 — 채점 전이다(fail-closed)')
  }
  if (input.selection.status !== 'confirmed') {
    return blocked(
      `모델이 확정되지 않았다 (${input.selection.status}) —`
      + ' blind 표본을 사람이 채점한 뒤에 정한다',
    )
  }
  const winner = input.selection.winner
  if (winner === null || winner.trim() === '') {
    return blocked('winner 가 없다 — confirmed 라도 이름이 없으면 부를 수 없다(fail-closed)')
  }
  const model = (input.model ?? winner).trim()
  if (model === '') return blocked('부를 모델 이름이 비어 있다')
  if (!ALLOWED_MODELS.includes(model)) {
    return blocked(`모르는 모델이다 — ${model} (등록: ${ALLOWED_MODELS.join(' · ')})`)
  }
  if (model !== winner) {
    // 🔴 확정된 것과 다른 모델을 부르면 비교 결과가 무의미해진다
    return blocked(`확정 모델(${winner})과 다른 모델(${model})을 부르려 한다`)
  }
  return { canCallProvider: true, canWriteQueue: true, reason: `확정 모델 ${winner}` }
}

// ─────────────────────────────────────────────────────────
// ② 대상 글 개인정보 계약
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **실회원이 쓴 글의 원문을 외부 모델로 보내지 않는다.**
 *
 *    `content.slice(0, 600)` 을 "요약" 이라 부른 적이 있다. 자르는 것은 요약이 아니고
 *    익명화도 아니다 — 실회원이 쓴 문장의 앞부분이 그대로 나가는 것이다.
 *
 * 🔴 허용되는 것은 **작성자 유형이 확인된** 글뿐이다.
 *    Persona 글 · 관리자 글 · 자동 생성 글은 사람의 사연이 아니다.
 *    확인하지 못하면 막는다 — 모르는 채로 내보내는 것이 가장 위험하다.
 */
export type PostAuthorKind = 'persona' | 'admin' | 'automated' | 'member' | 'unknown'

export type PostAuthorFacts = {
  /** 이 글을 쓴 Persona. 없으면 null */
  authorPersonaCode: string | null
  /** 글의 source 축 — `SYSTEM` 이면 자동 생성 경로다 */
  source: string | null
  /** 작성자 User 의 실회원 판별 입력. 🔴 모르면 필드를 비운다 */
  authorRealMember: RealMemberProbe | null
  /** 관리자 계정인가. 모르면 null */
  authorIsAdmin: boolean | null
  /**
   * 🔴 3축 판정 입력. **여기서 축을 직접 비교하지 않는다** —
   *    `isExternalSourcedBody` 정본이 답한다(정본 §3 C-2).
   *    읽지 못했으면 null 이고, 그때는 막는다.
   */
  visibility: PostVisibilityInput | null
}

export type AuthorVerdict = {
  kind: PostAuthorKind
  /** 🔴 이 글의 본문을 외부 provider 로 보내도 되는가 */
  externalSendAllowed: boolean
  reason: string
}

/**
 * 🔴 **모르면 막는다.** `unknown` 은 `member` 보다 안전한 상태가 아니다 —
 *    확인하지 못했다는 뜻이므로 실회원일 수도 있다.
 */
export function judgePostAuthor(f: PostAuthorFacts | null): AuthorVerdict {
  if (f === null) {
    return { kind: 'unknown', externalSendAllowed: false, reason: '글을 찾지 못했다(fail-closed)' }
  }

  /**
   * ① 🔴 **본문의 출처를 작성자보다 먼저 본다** (2026-09-09 정정).
   *
   *    앞선 판은 Persona 글이면 곧바로 통과시켰다. 그런데 Persona 가 쓴 글이라도
   *    본문이 micro seed 원문이면 **남의 커뮤니티 글이 그대로 외부 모델로 나간다** —
   *    실측에서 `authorPersonaCode='P01'` + `isMicroSeed=true` 가 통과했다.
   *
   *    "누가 올렸나" 와 "본문이 어디서 왔나" 는 다른 질문이고,
   *    전송 금지는 **본문** 쪽이 정한다. 그래서 순서를 뒤집는다.
   *    판정은 post-visibility 정본이 한다 — 축을 여기서 비교하지 않는다(C-2).
   */
  if (f.visibility === null) {
    return { kind: 'unknown', externalSendAllowed: false, reason: '글의 노출 축을 읽지 못했다(fail-closed)' }
  }
  if (isExternalSourcedBody(f.visibility)) {
    return {
      kind: 'automated', externalSendAllowed: false,
      reason: '외부 커뮤니티에서 가져온 본문이다 — 누가 올렸든 다시 외부로 보내지 않는다',
    }
  }

  // ② Persona 글 — 사람의 사연이 아니다
  if (f.authorPersonaCode !== null && f.authorPersonaCode.trim() !== '') {
    return {
      kind: 'persona', externalSendAllowed: true,
      reason: `Persona ${f.authorPersonaCode} 가 쓴 글이다`,
    }
  }
  // ③ 관리자 — 확인된 경우만
  if (f.authorIsAdmin === true) {
    return { kind: 'admin', externalSendAllowed: true, reason: '관리자가 쓴 글이다' }
  }
  if (f.authorIsAdmin === null) {
    return { kind: 'unknown', externalSendAllowed: false, reason: '관리자 여부를 읽지 못했다(fail-closed)' }
  }
  // ④ 실회원 판별 — 정본 하나로
  if (f.authorRealMember === null) {
    return { kind: 'unknown', externalSendAllowed: false, reason: '작성자 계정 정보를 읽지 못했다(fail-closed)' }
  }
  const real = judgeRealMember(f.authorRealMember)
  if (real.real) {
    // 🔴 `unknown` 이어도 `real` 이 true 다 — 모르는 것을 실회원으로 다룬다
    return real.unknown
      ? { kind: 'unknown', externalSendAllowed: false, reason: `작성자 유형 불명 — ${real.reason}` }
      : {
        kind: 'member', externalSendAllowed: false,
        reason: '🔴 실회원이 쓴 글이다 — 원문을 외부 모델로 보내지 않는다',
      }
  }
  // ⑤ 실회원도 Persona 도 관리자도 아닌 계정 — `source` 로 마지막 판단
  if (f.source === 'SYSTEM') {
    return { kind: 'automated', externalSendAllowed: true, reason: '자동 생성 경로(source=SYSTEM)로 만들어진 글이다' }
  }
  return {
    kind: 'unknown', externalSendAllowed: false,
    reason: '작성자 유형을 확정하지 못했다 — 보내지 않는다(fail-closed)',
  }
}

/**
 * 🔴 **이 금지를 푸는 것은 코드 변경이 아니라 정책 승인이다.**
 *    실회원 글을 모델에 보내려면 PII 제거 · 대상 글 유형 · 보관 금지 ·
 *    provider 전송 계약을 먼저 확정해야 한다. 플래그 하나로 풀 일이 아니다.
 */
export const MEMBER_POST_EXTERNAL_SEND_POLICY =
  '실회원 글의 외부 전송은 별도 정책 승인이 필요하다 — PII 제거·대상 글 유형·보관 금지·provider 전송 계약'

// ─────────────────────────────────────────────────────────
// ③ 공개 release 조건
// ─────────────────────────────────────────────────────────

export type ReleaseFacts = {
  /** `readRunMode` 결과 */
  mode: 'inspect' | 'shadow' | 'release'
  /** governor 가 계산한 오늘 공개 허용 수 */
  publicAllowedToday: number
  /** 모델 선택 판정 */
  modelGate: ModelGateVerdict
  /** 사람이 승인한 Queue 후보 수 */
  approvedQueueCount: number
  /** 🔴 bootstrap 후보인가 — 자동 공개 대상이 아니다 */
  isBootstrap: boolean
  /** 트랜잭션 재검사를 실제로 붙였는가 */
  txRecheckWired: boolean
  /** runner 가 등록돼 있는가. 🔴 이번 PR 에서는 false 다 */
  runnerRegistered: boolean
}

export type ReleaseVerdict = {
  /** 🔴 지금 공개 댓글을 발행해도 되는가 */
  canPublishNow: boolean
  /** 몇 건까지 */
  allowed: number
  blockers: string[]
  /** 화면·JSON 이 같이 쓰는 한 줄 */
  summary: string
}

/**
 * 🔴 **하나라도 빠지면 0 이다.**
 *
 *    "거의 다 됐으니 일단 켜자" 가 가능한 구조를 만들지 않는다.
 *    빠진 것을 전부 나열해 — 무엇이 남았는지 사람이 한눈에 보게 한다.
 */
export function judgeRelease(f: ReleaseFacts): ReleaseVerdict {
  const blockers: string[] = []

  if (f.mode !== 'release') blockers.push(`${f.mode} 모드다 — 공개 발행 경로가 아니다`)
  if (!f.modelGate.canWriteQueue) blockers.push(`모델 미확정 — ${f.modelGate.reason}`)
  if (!Number.isInteger(f.publicAllowedToday) || f.publicAllowedToday <= 0) {
    blockers.push('오늘 공개 허용량이 0 이다 (ratio·일 cap·kill switch)')
  }
  if (!Number.isInteger(f.approvedQueueCount) || f.approvedQueueCount <= 0) {
    blockers.push('사람이 승인한 Queue 후보가 없다')
  }
  // 🔴 bootstrap 은 사람 승인 전용이다. 자동 공개 경로로 새어 나가지 않게 한다
  if (f.isBootstrap) blockers.push('bootstrap 후보다 — 자동 공개 대상이 아니다(사람 승인 전용)')
  if (!f.txRecheckWired) blockers.push('트랜잭션 재검사가 붙어 있지 않다(fail-closed)')
  if (!f.runnerRegistered) blockers.push('runner/schedule 이 등록돼 있지 않다')

  const allowed = blockers.length === 0 ? f.publicAllowedToday : 0
  return {
    canPublishNow: blockers.length === 0,
    allowed,
    blockers,
    summary: blockers.length === 0
      ? `공개 가능 — 오늘 ${allowed}건`
      : `🔴 공개 불가 — ${blockers.length}건 미충족: ${blockers[0]!}`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 capability — "붙어 있는가" 를 값으로 말한다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **소스에 그 문자열이 있는지로 배선을 판정하지 않는다.**
 *
 *    앞선 판은 `readFileSync(...).includes('recheckBeforePublish(')` 로 봤다.
 *    주석에 적어 두기만 해도 통과하고, 함수 이름이 바뀌면 조용히 거짓이 된다.
 *    배선은 **부르는 쪽이 스스로 선언**하고, fixture 가 그 선언이 참인지 확인한다.
 */
export type CommentCapabilities = {
  /** 발행 트랜잭션이 댓글 레인 재검사를 부른다 */
  txRecheck: boolean
  /** 발행 트랜잭션이 Serializable 격리를 쓴다 */
  serializable: boolean
  /** Queue CLI 가 실제 적재 경로를 갖는다 */
  enqueuePipeline: boolean
  /** runner 가 publishCandidateTx 를 부른다 */
  runnerPublishes: boolean
  /** 후보 provenance 를 저장하고 다시 검증한다 */
  provenance: boolean
}

/**
 * 🔴 이 값은 **코드가 스스로 선언한 것**이다.
 *    선언과 실제가 어긋나면 fixture 가 잡는다 — 그것이 이 파일의 계약이다.
 */
export const COMMENT_CAPABILITIES: CommentCapabilities = {
  txRecheck: true,
  serializable: true,
  enqueuePipeline: true,
  runnerPublishes: true,
  provenance: true,
}

/** 🔴 하나라도 빠지면 release 를 열 수 없다 */
export function capabilitiesReady(c: CommentCapabilities): { ok: boolean; missing: string[] } {
  const missing = (Object.keys(c) as (keyof CommentCapabilities)[]).filter((k) => !c[k])
  return { ok: missing.length === 0, missing }
}
