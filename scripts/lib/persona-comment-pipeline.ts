/**
 * 댓글 후보 **생성·적재 파이프라인** — 🔴 provider 와 DB 를 **주입받는다**
 *
 * 🔴 **왜 주입인가.**
 *
 *    앞선 판의 Queue CLI 는 `void planEnqueue` 로 끝나는 stub 이었다.
 *    실제 경로를 만들되 진짜 provider·DB 를 붙들고 있으면
 *    "모델 미확정이면 부르지 않는다" · "중복이면 지고 만다" 같은 것을
 *    **행동으로** 시험할 수 없다. 그래서 둘 다 인터페이스로 뺀다.
 *
 * 🔴 흐름은 하나다.
 *    확정 모델 확인 → 대상 선정 → Persona-first 입력 → 개인정보 판정
 *    → provider → 기존 9관문 Gate → `planEnqueue` → `PENDING` create
 *
 *    어느 단계든 막히면 **그 자리에서 멈춘다.** 다음 단계로 넘어가지 않는다.
 */
import type { CommentInput } from '../../src/lib/persona-comment-input'
import {
  judgeModelGate, judgePostAuthor,
  type ModelSelection, type PostAuthorFacts,
} from '../../src/lib/persona-comment-release'
import {
  planEnqueue, type EnqueueFacts, type EnqueuePlan,
} from '../../src/lib/persona-comment-queue'
import type { GateLine } from '../../src/lib/persona-comment-gate-report'
import type { CandidateProvenance, ModelCanon } from '../../src/lib/persona-comment-provenance'
import { provenanceOf } from '../../src/lib/persona-comment-provenance'

/** 🔴 주입되는 provider. CI 는 가짜, 운영은 `callProvider` 를 감싼 것 */
export type PipelineProvider = (args: {
  model: string
  input: CommentInput
}) => Promise<{ ok: boolean; text: string | null; errorCode: string | null }>

/** 🔴 주입되는 Gate. 운영은 기존 `checkCommentCandidate` 정본을 감싼다 */
export type PipelineGate = (args: {
  input: CommentInput
  text: string
}) => { gates: GateLine[]; gateStatus: string; isBootstrap: boolean }

/** 🔴 주입되는 적재. `--apply` 가 없으면 호출부가 아예 넘기지 않는다 */
export type PipelineWriter = (args: {
  input: CommentInput
  text: string
  dedupKey: string
  gates: readonly GateLine[]
  gateStatus: string
  provenance: CandidateProvenance
}) => Promise<{ created: boolean; reason: string }>

export type PipelineTarget = {
  input: CommentInput
  author: PostAuthorFacts | null
  /** `planEnqueue` 가 요구하는 DB 실측 */
  facts: Omit<EnqueueFacts, 'text' | 'gates' | 'gateStatus' | 'isBootstrap' | 'modelConfirmed'>
}

export type PipelineStep =
  | 'MODEL_NOT_CONFIRMED'
  | 'AUTHOR_BLOCKED'
  | 'PROVIDER_FAILED'
  | 'PARSE_FAILED'
  | 'ENQUEUE_BLOCKED'
  | 'WRITE_SKIPPED'
  | 'WRITE_FAILED'
  | 'ENQUEUED'

export type PipelineOutcome = {
  postId: string
  personaCode: string
  step: PipelineStep
  reason: string
  plan: EnqueuePlan | null
}

export type PipelineResult = {
  /** 실제로 provider 를 부른 횟수 — 🔴 0 이어야 하는 회차가 있다 */
  providerCalls: number
  /** 실제로 create 한 수 */
  created: number
  outcomes: PipelineOutcome[]
  stoppedReason: string | null
}

/**
 * 🔴 **모델이 확정되지 않으면 한 번도 부르지 않는다.**
 *    루프 안에서 후보마다 확인하지 않고 **들어오기 전에** 막는다 —
 *    안에서 막으면 "한 건은 불렀다" 가 생긴다.
 */
export async function runEnqueuePipeline(args: {
  selection: ModelSelection | null
  canon: ModelCanon | null
  targets: readonly PipelineTarget[]
  provider: PipelineProvider
  gate: PipelineGate
  /** 🔴 없으면 dry-run 이다. 있으면 `--apply` 다 */
  writer?: PipelineWriter
  /** 이번 회차에 만들 최대 수 */
  limit: number
  /**
   * 🔴 **provider 를 부를 최대 횟수.**
   *
   *    옛 판은 `limit` 하나로 둘을 다 뜻했다. `--call` 처럼 "부르되 쓰지는 않는다"
   *    회차에서 `limit: 0` 을 넘기면 루프가 첫 줄에서 끊겨 **한 번도 부르지 않았다** —
   *    provider 를 켠 회차가 조용히 아무것도 하지 않았다.
   *    호출 상한과 write 상한은 다른 것이므로 따로 받는다.
   */
  providerCallLimit: number
  /**
   * 🔴 **유료 호출 앞의 마지막 관문.**
   *
   *    Gate 입력을 다 못 읽었거나, 분산 근거를 못 읽었거나,
   *    출처 문맥을 판정하지 못했으면 여기서 멈춘다 —
   *    부른 뒤에 "잴 수 없다" 를 알게 되면 돈은 이미 나갔고 표본도 못 쓴다.
   *
   *    이름이 `gateInputsComplete` 였을 때는 Gate 입력만 뜻하는 줄 알고
   *    분산 실패를 다른 데서 삼켰다. 막는 사유는 한 자리에 모은다.
   */
  preflightOk: boolean
  preflightBlockers?: readonly string[]
}): Promise<PipelineResult> {
  const outcomes: PipelineOutcome[] = []
  const modelGate = judgeModelGate({ selection: args.selection })

  if (!modelGate.canWriteQueue || args.canon === null) {
    return {
      providerCalls: 0, created: 0, outcomes,
      stoppedReason: args.canon === null
        ? '확정 정본이 없다 — provider 호출 0 · Queue write 0'
        : `모델 미확정 — ${modelGate.reason}`,
    }
  }
  if (!args.preflightOk) {
    const why = args.preflightBlockers ?? []
    return {
      providerCalls: 0, created: 0, outcomes,
      stoppedReason: 'Gate 입력이 갖춰지지 않았다 — provider 호출 0'
        + `${why.length === 0 ? '' : ` (${why.join(' · ')})`}`,
    }
  }
  const provenance = provenanceOf(args.canon)

  let providerCalls = 0
  let created = 0
  for (const t of args.targets) {
    // 🔴 두 상한을 각각 본다 — 호출 상한이 0 이면 부르지 않고, write 상한은 writer 가 있을 때만 센다
    if (providerCalls >= args.providerCallLimit) break
    if (args.writer !== undefined && created >= args.limit) break
    const at = (step: PipelineStep, reason: string, plan: EnqueuePlan | null = null): void => {
      outcomes.push({ postId: t.facts.postId, personaCode: t.facts.personaCode, step, reason, plan })
    }

    /**
     * 🔴 **개인정보 판정을 provider 앞에 둔다.**
     *    뒤에 두면 이미 보낸 뒤에 "보내면 안 됐다" 를 알게 된다.
     */
    const author = judgePostAuthor(t.author)
    if (!author.externalSendAllowed) {
      at('AUTHOR_BLOCKED', `${author.kind} — ${author.reason}`)
      continue
    }

    providerCalls += 1
    const res = await args.provider({ model: provenance.model, input: t.input })
    if (!res.ok) { at('PROVIDER_FAILED', res.errorCode ?? 'UNKNOWN'); continue }
    const text = (res.text ?? '').trim()
    if (text === '') { at('PARSE_FAILED', '본문을 얻지 못했다'); continue }

    // 🔴 기존 9관문 Gate 정본으로 넘긴다
    const g = args.gate({ input: t.input, text })
    const plan = planEnqueue({
      ...t.facts,
      text,
      gates: g.gates,
      gateStatus: g.gateStatus,
      isBootstrap: g.isBootstrap,
      modelConfirmed: true,
    })
    if (!plan.ok) {
      // 🔴 어느 관문이 막았는지 **코드로만** 남긴다 — 댓글 본문 · detail 은 싣지 않는다.
      //    (2026-09-28) 요약 한 줄만 남아 무엇이 막았는지 아무 기록에도 없었다
      const failed = plan.gates.filter((x) => x.outcome !== 'pass').map((x) => `${x.gate}:${x.outcome}`)
      const codes = plan.blocks.map((b) => b.code)
      at('ENQUEUE_BLOCKED', `${plan.summary} · 막힘 [${codes.join(',')}] · 관문 [${failed.join(',')}]`, plan)
      continue
    }

    if (args.writer === undefined) {
      // 🔴 dry-run — 여기까지 판정하고 멈춘다. DB write 0
      at('WRITE_SKIPPED', 'dry-run — create 하지 않는다', plan)
      continue
    }
    const w = await args.writer({
      input: t.input, text, dedupKey: plan.dedupKey,
      gates: g.gates, gateStatus: g.gateStatus, provenance,
    })
    if (!w.created) { at('WRITE_FAILED', w.reason, plan); continue }
    created += 1
    at('ENQUEUED', `${plan.status} 적재`, plan)
  }

  return { providerCalls, created, outcomes, stoppedReason: null }
}
