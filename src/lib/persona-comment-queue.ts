/**
 * 댓글 후보 **Queue 적재 계약** — 🔴 순수 함수. DB · 네트워크 없음
 *
 * 🔴 **Gate 통과는 발행이 아니라 "대기열에 갈 자격" 이다.**
 *    적재는 사람이 읽는 화면에 무언가를 올리는 일이다. 잘못 올라간 것은
 *    사람의 시간을 쓰게 하고, 몇 번 반복되면 화면 자체를 안 보게 만든다.
 *
 * 🔴 여기서는 **판정만** 한다. write 는 호출부가 `--apply` 와 함께 한다.
 */

import {
  isGateEightColdStart, judgeBootstrapEligible, judgeGateReport,
  type GateLine, type GateReport,
} from './persona-comment-gate-report'
import { stagePowers, type CommentStage } from './persona-comment-stage'
import { PERSONA_COMMENTS_PER_POST_MAX } from './persona-target-rules'

/** 🔴 DB count 가 될 수 있는 값인가 */
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0

/** Queue 상태 전이 — 스키마의 `PersonaCandidateStatus` 와 같은 낱말을 쓴다 */
export type QueueStatus = 'PENDING' | 'APPROVED' | 'EDITED' | 'DECLINED' | 'PUBLISHED' | 'EXPIRED'

/**
 * 🔴 **적재는 `PENDING` 으로만 들어간다.**
 *    자동으로 `APPROVED` 를 만들지 않는다 — 그러면 사람 승인 단계가 사라진다.
 */
export const ENQUEUE_STATUS: QueueStatus = 'PENDING'

/** 🔴 이 상태의 행이 있으면 같은 자리에 또 넣지 않는다 */
export const OPEN_STATUSES: readonly QueueStatus[] = ['PENDING', 'APPROVED', 'EDITED']

export type EnqueueBlockCode =
  | 'GATE_NOT_FULL_PASS'
  | 'GATE_MISSING_REQUIRED'
  | 'BOOTSTRAP_NEEDS_HUMAN'
  | 'DUPLICATE_QUEUE'
  | 'POST_PERSONA_COMMENTS_FULL'
  | 'PERSONA_ALREADY_ON_POST'
  | 'POST_NOT_PUBLISHED'
  | 'POST_STATE_UNKNOWN'
  | 'PERSONA_NOT_ACTIVE'
  | 'PERSONA_REAL_MEMBER'
  | 'TEXT_EMPTY'
  | 'MODEL_NOT_CONFIRMED'
  | 'BOOTSTRAP_CLAIM_INVALID'
  | 'POST_ID_MISSING'

export type EnqueueBlock = { code: EnqueueBlockCode; message: string }

export type EnqueueFacts = {
  postId: string
  personaCode: string
  reactionRole: string
  /** 후보 본문 */
  text: string
  /** 9관문 결과 그대로 */
  gates: readonly GateLine[]
  /** `checkCommentCandidate.status` */
  gateStatus: string
  /** ⑧ 만 표본이 없어 사람 승인 전용인가 */
  isBootstrap: boolean
  /** 같은 (post, persona, role) 로 열려 있는 Queue 가 있는가. 🔴 모르면 null */
  hasOpenQueue: boolean | null
  /** 그 글에 살아 있는 Persona 댓글 수. 🔴 모르면 null */
  personaCommentsOnPost: number | null
  /**
   * 🔴 **이 Persona 가 그 글에 이미 댓글을 달았는가.** 모르면 null(fail-closed).
   *
   *    글당 5건을 연 대가로 반드시 지켜야 하는 쪽이 이것이다 —
   *    막아야 할 것은 "여럿이 말하는 것" 이 아니라 "한 사람이 여럿인 척하는 것" 이다.
   */
  personaAlreadyOnPost: boolean | null
  /** 글 상태. 🔴 모르면 null */
  postStatus: string | null
  personaActive: boolean
  /** 🔴 실회원이면(또는 판별 불가면) true */
  personaRealMember: boolean
  /** 모델이 확정됐는가 — `judgeModelGate.canWriteQueue` */
  modelConfirmed: boolean
}

export type EnqueuePlan = {
  ok: boolean
  /** 적재한다면 어떤 상태로 */
  status: QueueStatus
  /** 🔴 중복 방지 열쇠 — DB 의 `dedupKey @unique` 에 들어간다 */
  dedupKey: string
  report: GateReport
  /** 🔴 관문별 결과 원본 — 실패를 버리기 전에 사람이 볼 수 있어야 한다 */
  gates: readonly GateLine[]
  blocks: EnqueueBlock[]
  /** 사람이 읽을 한 줄 */
  summary: string
}

/**
 * 🔴 **중복 열쇠는 (글 · Persona · 역할) 이다.**
 *
 *    본문 해시로만 잡으면 같은 자리에 문장만 바꿔 계속 넣을 수 있다.
 *    "이 글에 이 사람이 이 역할로" 는 한 번뿐이어야 한다.
 */
export function dedupKeyOf(postId: string, personaCode: string, reactionRole: string): string {
  return `comment:${postId}:${personaCode}:${reactionRole}`
}

/**
 * 🔴 적재해도 되는가.
 *
 *    `notRun` 을 `pass` 로 세지 않는다 — 돌지 않은 검사는 "보지 않았다" 다.
 *    bootstrap 후보는 막지 않고 **사람 승인 전용**으로 표시해 통과시킨다 —
 *    그것이 cold-start 를 여는 유일한 길이고, 자동 공개는 release 층이 따로 막는다.
 */
export function planEnqueue(f: EnqueueFacts): EnqueuePlan {
  const blocks: EnqueueBlock[] = []
  const report = judgeGateReport({ gates: f.gates, status: f.gateStatus })
  const dedupKey = dedupKeyOf(f.postId, f.personaCode, f.reactionRole)

  /**
   * 🔴 **대상 글이 없는 후보는 만들지 않는다** (2026-09-21).
   *
   *    `PersonaApprovalQueue.targetPostId` 는 **nullable** 이다 — 스키마가
   *    막아 주지 않는다. 대상 글을 잃은 후보가 들어가면 어느 글에 붙일지
   *    알 수 없고, 어드민에서 승인해도 붙을 자리가 없다.
   *    🔴 `dedupKey` 도 `comment::<persona>:<role>` 이 되어 **글이 달라도 같은 열쇠**가 된다 —
   *    unique constraint 가 엉뚱한 글끼리 충돌시킨다.
   */
  if (f.postId.trim() === '') {
    blocks.push({ code: 'POST_ID_MISSING', message: '🔴 대상 글 id 가 없다 — 붙일 자리가 없는 후보다' })
  }
  if (f.text.trim() === '') blocks.push({ code: 'TEXT_EMPTY', message: '후보 본문이 비어 있다' })
  if (!f.modelConfirmed) {
    blocks.push({ code: 'MODEL_NOT_CONFIRMED', message: '모델이 확정되지 않았다 — 적재하지 않는다' })
  }

  /**
   * 🔴 Gate.
   *    bootstrap 은 "⑧ 만 표본이 없다" 는 특별한 상태다. 그것까지 막으면
   *    첫 댓글을 영원히 만들 수 없다 — 대신 사람 승인 전용으로 남긴다.
   */
  /**
   * 🔴 **호출자가 넘긴 `isBootstrap` 을 믿지 않는다** (2026-09-09 정정).
   *
   *    앞선 판은 그 boolean 만 보고 Gate 실패를 통과시켰다. 그래서
   *    **① 유출이 `reject` 인 후보도 `isBootstrap=true` 면 적재됐다**(실측).
   *    bootstrap 은 "⑧ 만 표본이 없다" 는 좁은 상태이지 Gate 면제가 아니다.
   *
   *    그래서 Gate 결과로 **다시 판정한다** — 호출자의 주장과 실제가 다르면 실제를 따른다.
   */
  const bootstrapShaped = isGateEightColdStart(f.gates, report)
  const bootstrapClaimed = f.isBootstrap
  const bootstrapReal = bootstrapClaimed && bootstrapShaped

  if (!report.fullGatePass) {
    if (bootstrapReal) {
      // 통과시키되 자동 공개 대상이 아님을 남긴다
      blocks.push({
        code: 'BOOTSTRAP_NEEDS_HUMAN',
        message: '⑧ 대조 표본이 없다 — 사람 승인 전용으로 적재한다(자동 공개 불가)',
      })
    } else if (bootstrapClaimed) {
      // 🔴 bootstrap 이라 주장했지만 Gate 가 그 모양이 아니다
      blocks.push({
        code: 'BOOTSTRAP_CLAIM_INVALID',
        message: '⑧ 만 못 돈 상태가 아니다 — bootstrap 이 아니라 Gate 실패다'
          + ` (미실행 ${report.missingRequired.join('') || '없음'} · ${report.reason})`,
      })
    } else if (report.missingRequired.length > 0) {
      blocks.push({
        code: 'GATE_MISSING_REQUIRED',
        message: `필수 관문 ${report.missingRequired.join('')} 이 돌지 않았다 — 통과로 세지 않는다`,
      })
    } else {
      blocks.push({
        code: 'GATE_NOT_FULL_PASS',
        message: `9관문을 전부 통과하지 못했다 (${report.reason})`,
      })
    }
  }

  // 🔴 상태를 모르면 막는다. 계획 시점과 적재 시점 사이에 글이 바뀔 수 있다
  if (f.hasOpenQueue === null) {
    blocks.push({ code: 'DUPLICATE_QUEUE', message: '기존 Queue 를 읽지 못했다 — 중복을 확인할 수 없다(fail-closed)' })
  } else if (f.hasOpenQueue) {
    blocks.push({ code: 'DUPLICATE_QUEUE', message: '같은 글·Persona·역할의 Queue 가 이미 열려 있다' })
  }
  if (f.personaCommentsOnPost === null) {
    blocks.push({ code: 'POST_PERSONA_COMMENTS_FULL', message: '그 글의 Persona 댓글 수를 읽지 못했다(fail-closed)' })
  } else if (f.personaCommentsOnPost >= PERSONA_COMMENTS_PER_POST_MAX) {
    blocks.push({
      code: 'POST_PERSONA_COMMENTS_FULL',
      message: `Persona 댓글이 ${f.personaCommentsOnPost}건이다 —`
        + ` 한 글에 ${PERSONA_COMMENTS_PER_POST_MAX}건까지다`,
    })
  }
  // 🔴 수가 남아 있어도 **같은 사람**이면 막는다. 모르면 막는다(fail-closed)
  if (f.personaAlreadyOnPost === null) {
    blocks.push({
      code: 'PERSONA_ALREADY_ON_POST',
      message: '이 Persona 가 그 글에 이미 달았는지 읽지 못했다(fail-closed)',
    })
  } else if (f.personaAlreadyOnPost) {
    blocks.push({
      code: 'PERSONA_ALREADY_ON_POST',
      message: '🔴 이 Persona 는 그 글에 이미 댓글이 있다 — 한 사람이 두 번 말하지 않는다',
    })
  }
  if (f.postStatus === null) {
    blocks.push({ code: 'POST_STATE_UNKNOWN', message: '글 상태를 읽지 못했다(fail-closed)' })
  } else if (f.postStatus !== 'PUBLISHED') {
    blocks.push({ code: 'POST_NOT_PUBLISHED', message: `글이 공개 상태가 아니다 (${f.postStatus})` })
  }
  if (!f.personaActive) blocks.push({ code: 'PERSONA_NOT_ACTIVE', message: 'Persona 가 active 가 아니다' })
  if (f.personaRealMember) {
    blocks.push({ code: 'PERSONA_REAL_MEMBER', message: '🔴 실회원 계정이 붙어 있다(또는 판별 불가)' })
  }

  // 🔴 bootstrap 표시는 "막힘" 이 아니라 "사람 승인 전용" 이다 — 적재 자체는 허용한다
  const blocking = blocks.filter((b) => b.code !== 'BOOTSTRAP_NEEDS_HUMAN')
  const ok = blocking.length === 0

  return {
    ok,
    status: ENQUEUE_STATUS,
    dedupKey,
    report,
    // 🔴 관문별 결과를 그대로 싣는다 — 버리기 전에 사람이 본다
    gates: f.gates,
    blocks,
    summary: ok
      ? `${ENQUEUE_STATUS} 로 적재 — ${bootstrapReal ? '🔴 사람 승인 전용(bootstrap)' : '9관문 통과'}`
      : `🔴 적재하지 않는다 — ${blocking[0]!.message}`,
  }
}

// ─────────────────────────────────────────────────────────
// 🔴 발행 트랜잭션 재검사 계약
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **계획 시점의 판정은 그 순간의 사진이다.**
 *
 *    적재와 발행 사이에 글이 지워지고, 사람이 댓글을 달고, Persona 가 멈추고,
 *    Account 가 붙을 수 있다. 그래서 **트랜잭션 안에서 다시 본다.**
 *    기존 `planPublish` 가 보는 축(상태·cap·kill switch)에 더해
 *    댓글 레인 고유의 축(ratio · 실회원 · 생활사 · Gate · bootstrap)을 여기서 본다.
 */
/**
 * 🔴 **누가 이 발행을 시켰는가.**
 *
 *    bootstrap 후보는 자동 runner 가 발행하면 안 되지만, 사람이 어드민에서
 *    누르는 것까지 막으면 **Queue 에는 들어가는데 어느 경로로도 나갈 수 없는
 *    dead-end** 가 된다. 실제로 그 상태였다 — 첫 댓글을 만들 길이 없었다.
 *
 *    그래서 주체를 나눈다. 판단 기준은 "누가 눌렀나" 이고,
 *    그 근거는 server action 의 **권한 확인**이다 — 문자열을 그대로 믿지 않는다.
 */
export type PublishActor =
  /** 🔴 어드민 화면에서 사람이 눌렀다. server action 이 권한을 확인한 뒤에만 준다 */
  | 'manual-admin'
  /** 🔴 runner·cron 등 자동 경로 */
  | 'automation'

export type TxRecheckFacts = {
  /** 🔴 이 발행의 주체. 없으면 automation 으로 본다(fail-closed) */
  actor?: PublishActor
  /** 트랜잭션 안에서 다시 읽은 값들 */
  postStatus: string | null
  personaActive: boolean
  /** 🔴 트랜잭션 안에서 다시 판정한 실회원 여부 */
  personaRealMember: boolean
  /** 그 글의 살아 있는 Persona 댓글 수 */
  personaCommentsOnPost: number | null
  /** 🔴 이 Persona 가 그 글에 이미 댓글을 달았는가. 모르면 null(fail-closed) */
  personaAlreadyOnPost: boolean | null
  /** 그 글의 살아 있는 회원 댓글 수 — 3건 이상이면 끼어들지 않는다 */
  memberCommentsOnPost: number | null
  /** 🔴 오늘 **총 상한**. 남은 수량이 아니다 — 사용량을 여기서 뺀다 */
  allowanceCap: number
  /**
   * 🔴 **운영 단계.** 공개가 열리지 않은 단계면 write 를 하지 않는다.
   *    env 를 트랜잭션 안에서 읽어 넘긴다 — 호출부가 주장하는 값을 믿지 않는다.
   *    `manual-admin` 도 이것을 우회하지 못한다.
   *
   * 🔴 옛 판은 `mode: 'inspect'|'shadow'|'release'` 였다. 그 축에는 `bootstrap-*` 이
   *    없어서 `readRunMode` 가 **모르는 값**으로 보고 `shadow` 로 내렸다 —
   *    단계를 `bootstrap-auto` 로 올려도 트랜잭션이 "shadow 모드다" 로 막았다(실측).
   *    축이 둘이면 반드시 한쪽이 다른 쪽을 모른다. 그래서 단계 하나로 합친다.
   */
  stage: CommentStage
  /**
   * 🔴 **이 트랜잭션 안에서 다시 센** 오늘의 Persona 댓글 수.
   *    밖에서 센 값은 다른 후보가 그 사이에 발행한 것을 모른다.
   */
  publishedTodayInTx: number
  /** 생활사·No-Go 충돌이 남아 있는가 */
  lifeConflict: boolean
  /** 저장된 Gate 결과를 다시 읽은 것 */
  gates: readonly GateLine[]
  gateStatus: string
  isBootstrap: boolean
  /** Queue 행의 지금 상태 */
  queueStatus: QueueStatus
  /** 이미 발행됐는가 */
  publishedCommentId: string | null
  /**
   * 🔴 후보의 생성 근거가 확인됐는가.
   *    `automation` 경로는 근거 없는 후보를 발행하지 않는다 —
   *    옛 경로로 들어간 행은 어느 모델이 만들었는지 모른다.
   */
  provenanceOk?: boolean
  provenanceReason?: string
  /** 🔴 bootstrap governor 입력 — 사람 수동 발행일 때 다시 본다 */
  bootstrapPriorTextCount?: number
  bootstrapUsedTotal?: number
  seedComplete?: boolean
}

export type TxRecheckVerdict = { ok: boolean; blockers: string[] }

/** 🔴 회원 댓글이 이만큼 있으면 끼어들지 않는다 (Architecture §8) */
export const MEMBER_COMMENT_LIMIT_ON_PUBLISH = 3

/**
 * 🔴 **하나라도 어긋나면 발행하지 않는다.**
 *    여기서 막는 것은 rollback 이 아니라 애초에 write 를 하지 않는 것이다.
 */
export function recheckBeforePublish(f: TxRecheckFacts): TxRecheckVerdict {
  const blockers: string[] = []

  /**
   * 🔴 **mode 를 트랜잭션 안에서 다시 본다** (2026-09-09 정정).
   *
   *    앞선 판은 `publishCandidateTx` 가 mode 를 아예 보지 않았다 —
   *    `judgeRelease` 는 화면 판정일 뿐이고, 실제 write 함수는 shadow 에서도 돌았다.
   *    server action·CLI·runner 어느 경로로 들어와도 여기서 막힌다.
   */
  const powers = stagePowers(f.stage)
  if (!powers.publishAllowed) {
    blockers.push(`${f.stage} 단계다 — 공개 Comment 를 쓰지 않는다(manual-admin 도 우회하지 못한다)`)
  }

  if (f.queueStatus !== 'APPROVED' && f.queueStatus !== 'EDITED') {
    blockers.push(`Queue 상태가 ${f.queueStatus} 다 — 사람이 승인한 것만 발행한다`)
  }
  if (f.publishedCommentId !== null) blockers.push('이미 발행된 후보다')

  if (f.postStatus === null) blockers.push('글 상태를 읽지 못했다(fail-closed)')
  else if (f.postStatus !== 'PUBLISHED') blockers.push(`글이 공개 상태가 아니다 (${f.postStatus})`)

  if (!f.personaActive) blockers.push('Persona 가 active 가 아니다')
  if (f.personaRealMember) blockers.push('🔴 실회원 계정이 붙었다(또는 판별 불가)')

  if (f.personaCommentsOnPost === null) blockers.push('Persona 댓글 수를 읽지 못했다(fail-closed)')
  else if (f.personaCommentsOnPost >= PERSONA_COMMENTS_PER_POST_MAX) {
    blockers.push(
      `그 사이 Persona 댓글이 ${f.personaCommentsOnPost}건이 됐다`
      + ` — 한 글에 ${PERSONA_COMMENTS_PER_POST_MAX}건까지다`,
    )
  }
  // 🔴 자리가 남아도 **같은 사람**이면 막는다. 적재와 발행 사이에 그 사람이 먼저 달았을 수 있다
  if (f.personaAlreadyOnPost === null) {
    blockers.push('이 Persona 가 그 글에 이미 달았는지 읽지 못했다(fail-closed)')
  } else if (f.personaAlreadyOnPost) {
    blockers.push('🔴 이 Persona 는 그 글에 이미 댓글이 있다 — 한 사람이 두 번 말하지 않는다')
  }

  if (f.memberCommentsOnPost === null) blockers.push('회원 댓글 수를 읽지 못했다(fail-closed)')
  else if (f.memberCommentsOnPost >= MEMBER_COMMENT_LIMIT_ON_PUBLISH) {
    blockers.push(`그 사이 회원 댓글이 ${f.memberCommentsOnPost}건이 됐다 — 끼어들지 않는다`)
  }

  /**
   * 🔴 **글로벌 상한은 "여유가 있나" 가 아니라 "내 자리가 있나" 로 본다** (2026-09-09 정정).
   *
   *    앞선 판은 `publicAllowedToday > 0` 만 봤다. 그래서 **서로 다른 글의 후보 2건**이
   *    같은 여유 1 을 읽고 둘 다 통과했다(실측) — 같은 후보의 경쟁은 조건부 UPDATE 가
   *    막지만, 다른 후보끼리는 막을 것이 없었다. 상한이 1 인데 2건이 나간다.
   *
   *    그래서 **이 트랜잭션 안에서 다시 센 오늘 발행 수**를 함께 받아
   *    `publishedToday < publicAllowedToday` 인지 본다.
   *    Serializable 격리에서 두 트랜잭션이 같은 카운트를 읽으면 뒤의 것이 직렬화 실패로
   *    되돌아간다 — 그 계약을 여기서 값으로 못박는다.
   */
  /**
   * 🔴 **트랜잭션은 "남은 수량" 만 본다** (2026-09-09 정정).
   *
   *    옛 판은 `publicAllowedToday`(이미 남은 수량)를 총 상한처럼 읽고
   *    오늘 사용량과 비교했다 — cap 2 에서 1건을 쓴 뒤 남은 1건이 있는데도 막혔다.
   *    이름이 두 뜻을 가지면 반드시 한쪽이 틀린다.
   *
   * 🔴 `remaining` 은 **트랜잭션 안에서 다시 센 사용량으로 계산한 값**이어야 한다.
   *    밖에서 센 값은 그 사이 다른 후보가 가져간 자리를 모른다.
   */
  if (!isCount(f.allowanceCap) || !isCount(f.publishedTodayInTx)) {
    blockers.push('트랜잭션 안에서 상한·사용량을 세지 못했다 — 상한을 지킬 수 없다(fail-closed)')
  } else {
    const remaining = f.allowanceCap - f.publishedTodayInTx
    if (remaining <= 0) {
      blockers.push(
        `오늘 상한 ${f.allowanceCap}건을 다 썼다 (사용 ${f.publishedTodayInTx}건)`
        + ' — 다른 후보가 먼저 자리를 가져갔다',
      )
    }
  }
  if (f.lifeConflict) blockers.push('생활사·No-Go 가 충돌한다')

  // 🔴 저장된 Gate 결과를 다시 읽는다 — 적재 당시 통과했다고 지금도 통과인 것이 아니다
  const report = judgeGateReport({ gates: f.gates, status: f.gateStatus })
  /**
   * 🔴 bootstrap 은 자동 발행 경로로 오지 않는다.
   *    호출자 주장과 **Gate 실제 모양**을 둘 다 본다 — 변조로 우회하지 못하게.
   */
  const bootstrapShaped = isGateEightColdStart(f.gates, report)
  /**
   * 🔴 **생성 근거가 없으면 자동 발행하지 않는다.**
   *    사람이 읽고 승인하는 것은 가능하다 — 근거가 없는 것은 "자동으로 내보내도 되는가" 의
   *    문제이지 "사람이 읽어도 되는가" 의 문제가 아니다.
   */
  const actorEarly: PublishActor = f.actor ?? 'automation'
  if (actorEarly === 'automation' && f.provenanceOk !== true) {
    blockers.push(`생성 근거를 확인하지 못했다 — 자동 발행 불가 (${f.provenanceReason ?? '근거 없음'})`)
  }

  const isBootstrapCandidate = f.isBootstrap || bootstrapShaped

  /**
   * 🔴 **Gate 재검사 — bootstrap 만 예외다.**
   *
   *    앞선 판은 `fullGatePass` 가 아니면 무조건 막았다. 그런데 bootstrap 후보는
   *    정의상 ⑧ 이 `notRun` 이라 **항상** 여기서 막혔다 — 사람이 눌러도 발행되지 않는
   *    dead-end 였다. Queue 에는 들어가는데 어느 경로로도 나갈 수 없었다.
   *
   *    그래서 "⑧ 만 못 돈 정확한 모양" 일 때만 이 검사를 통과시키고,
   *    그 뒤의 주체·governor 검사가 실제로 막는다. 예외는 하나이고 좁다.
   */
  if (!report.fullGatePass && !bootstrapShaped) {
    blockers.push(`Gate 재검사 실패 — ${report.reason}`)
  }
  // 🔴 주체를 안 넘겼으면 automation 으로 본다 — 모르는 것을 사람으로 보지 않는다
  const actor: PublishActor = actorEarly
  /**
   * 🔴 **Gate ⑧ cold-start 를 bootstrap 자동화의 영구 blocker 로 쓰지 않는다** (2026-09-11).
   *
   *    옛 판은 bootstrap 후보면 주체가 `manual-admin` 이 아닌 한 무조건 막았다.
   *    그런데 ⑧ 은 **이전 발화가 쌓이기 전에는 정의상 돌지 않는다** —
   *    즉 그 규칙은 "자동화는 첫 발화가 생긴 뒤에만 가능하다" 였고,
   *    첫 발화를 자동으로 만들 길이 없으니 **영원히 열리지 않는 문**이었다.
   *
   *    그래서 문을 **`bootstrap-auto` 단계 하나**에만 연다. 그 단계는 창업자가
   *    명시로 올린 자리이고, 옛 env 값이 그리로 승격되는 경로도 없다(`persona-comment-stage`).
   *
   * 🔴 **다른 Gate 실패는 그대로 막는다.** 여는 것은 "⑧ 만 notRun 이고 나머지 여덟이
   *    전부 pass" 라는 좁은 모양뿐이다(`isGateEightColdStart`). ① 유출이 reject 면
   *    `bootstrapShaped` 가 false 라 바로 위 Gate 재검사에서 막힌다.
   */
  const coldStartAutoOpen = f.stage === 'bootstrap-auto'
  if (isBootstrapCandidate && actor !== 'manual-admin' && !coldStartAutoOpen) {
    blockers.push(
      `bootstrap 후보다 — ${f.stage} 단계에서는 자동 발행 대상이 아니다(어드민 수동 발행만 가능)`,
    )
  }
  /**
   * 🔴 **주체와 무관하게 bootstrap governor 조건은 그대로 본다.**
   *    "사람이 눌렀으니 통과" 도, "자동 단계니 통과" 도 두지 않는다 —
   *    그러면 Persona 당 상한도 cold-start 종료 조건도 의미가 없어진다.
   */
  if (isBootstrapCandidate) {
    const boot = judgeBootstrapEligible({
      report,
      priorTextCount: f.bootstrapPriorTextCount ?? Number.NaN,
      bootstrapUsedTotal: f.bootstrapUsedTotal ?? Number.NaN,
      personaActive: f.personaActive,
      realMember: f.personaRealMember,
      seedComplete: f.seedComplete ?? false,
      lifeConflict: f.lifeConflict,
      governorOk: isCount(f.allowanceCap),
    })
    if (!boot.bootstrapReviewEligible) {
      blockers.push(`bootstrap 조건 미충족 — ${boot.reason}`)
    }
  }

  return { ok: blockers.length === 0, blockers }
}
