/**
 * 오리지널 초안 검수 대기열 — 적재 규칙 (순수 함수)
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
 *
 * 초안 파일(tmp/original-post-candidates.json)과 gate 판정을 받아
 * **무엇을 대기열에 넣을지** 정한다. DB 도 파일도 모른다 — 부르는 쪽의 일이다.
 *
 * 🔴 **BLOCK 은 넣지 않는다.**
 *    SOURCE_ECHO 로 막힌 초안은 곧 원문 조각이 든 레코드다. 그걸 DB 에 남기면
 *    파일에서 assertNoStoredSource 가 막아온 것을 **DB 로 우회**하게 된다.
 *    "나중에 분석하려면 남겨야지" 가 저장 금지 계약을 뚫는 경로다 —
 *    실패 이력은 로컬 JSON 과 검수 HTML 에 이미 있고, 여기서는 **실행 로그로만** 센다.
 *
 * 🔴 **원문을 담지 않는다.** sourceRawContentId 로만 잇는다.
 *    원문은 MicroSeedRawContent 에 원형으로 있다 — 두 벌 두지 않는다.
 *
 * 🔴 **PASS 는 승인이 아니다.** PASS 도 HOLD 도 똑같이 PENDING 으로 들어간다.
 *    등급은 "사람이 먼저 볼 것" 을 고르는 순서일 뿐, 통과 도장이 아니다.
 */
import { createHash } from 'node:crypto'
import type { GateResult } from './original-post-gate'

/** 대기열에 넣을 수 있는 판정. 🔴 BLOCK 은 없다 */
export const ENQUEUEABLE_VERDICTS = ['PASS', 'HOLD'] as const
export type EnqueueableVerdict = (typeof ENQUEUEABLE_VERDICTS)[number]

/** 적재 레코드 — 🔴 원문 본문 필드가 없다 */
export type QueueRecord = {
  sourceRawContentId: string
  draftTitle: string
  draftBody: string
  gateVerdict: EnqueueableVerdict
  /** 사유 코드 + 사람이 읽을 한 줄. 🔴 본문을 담지 않는다 */
  gateResults: { blocks: { code: string; detail: string }[]; holds: { code: string; detail: string }[] }
  promptVersion: string
  model: string
  dedupKey: string
}

export type SkipReason = 'BLOCKED' | 'ALREADY_QUEUED' | 'DUPLICATE_IN_BATCH'

export type EnqueuePlan = {
  /** 넣을 것 */
  enqueue: QueueRecord[]
  /** 넣지 않을 것 — 🔴 사유별로 센다. 조용히 사라지면 아무도 모른다 */
  skipped: { sourceRawContentId: string; reason: SkipReason; verdict: string }[]
}

/**
 * 🔴 같은 초안이 두 번 들어가지 않게 한다.
 *
 * 원문 id + 초안 본문 해시. 제목은 넣지 않는다 —
 * 같은 본문에 제목만 다듬은 것은 **같은 초안의 수정본**이지 새 후보가 아니다.
 *
 * 🔴 본문 원문을 키에 그대로 쓰지 않는다. 해시만 남긴다.
 */
export function queueDedupKey(sourceRawContentId: string, draftBody: string): string {
  const body = createHash('sha256').update(draftBody, 'utf8').digest('hex')
  return `sha256:${createHash('sha256').update(`${sourceRawContentId}::${body}`, 'utf8').digest('hex')}`
}

export type EnqueueInput = {
  drafts: ReadonlyArray<{
    sourceRawContentId: string
    title: string
    body: string
    gate: GateResult
  }>
  /** 이미 대기열에 있는 dedupKey — 멱등하게 만든다 */
  existingKeys: ReadonlySet<string>
  promptVersion: string
  model: string
}

/**
 * 무엇을 넣을지 고른다. 🔴 판정하지 않는다 — 판정은 gateDraft 가 이미 했다.
 *
 * 같은 명령을 두 번 돌려도 원장이 두 벌 생기지 않아야 한다(멱등).
 */
export function planEnqueue(input: EnqueueInput): EnqueuePlan {
  const enqueue: QueueRecord[] = []
  const skipped: EnqueuePlan['skipped'] = []
  // 🔴 한 배치 안의 중복도 잡는다. existingKeys 만 보면 같은 파일에 든 쌍둥이가 통과한다
  const seen = new Set<string>()

  for (const d of input.drafts) {
    if (d.gate.verdict === 'BLOCK') {
      skipped.push({ sourceRawContentId: d.sourceRawContentId, reason: 'BLOCKED', verdict: 'BLOCK' })
      continue
    }
    const dedupKey = queueDedupKey(d.sourceRawContentId, d.body)
    if (input.existingKeys.has(dedupKey)) {
      skipped.push({ sourceRawContentId: d.sourceRawContentId, reason: 'ALREADY_QUEUED', verdict: d.gate.verdict })
      continue
    }
    if (seen.has(dedupKey)) {
      skipped.push({ sourceRawContentId: d.sourceRawContentId, reason: 'DUPLICATE_IN_BATCH', verdict: d.gate.verdict })
      continue
    }
    seen.add(dedupKey)
    enqueue.push({
      sourceRawContentId: d.sourceRawContentId,
      draftTitle: d.title,
      draftBody: d.body,
      gateVerdict: d.gate.verdict,
      // 🔴 blocks 는 비어 있다(BLOCK 은 위에서 걸렀다). 그래도 모양을 맞춰 둔다 —
      //    나중에 사유가 늘어도 스키마가 흔들리지 않는다
      gateResults: {
        blocks: d.gate.blocks.map((b) => ({ code: b.code, detail: b.detail })),
        holds: d.gate.holds.map((h) => ({ code: h.code, detail: h.detail })),
      },
      promptVersion: input.promptVersion,
      model: input.model,
      dedupKey,
    })
  }
  return { enqueue, skipped }
}

/**
 * 🔴 저장 직전 실측 방어. 타입으로 막았어도 한 번 더 본다 —
 *    타입은 이 파일을 거쳐 갈 때만 유효하고, 호출부가 객체를 직접 만들 수 있다.
 */
export function assertEnqueueable(records: readonly QueueRecord[]): void {
  for (const r of records) {
    if (!(ENQUEUEABLE_VERDICTS as readonly string[]).includes(r.gateVerdict)) {
      throw new Error(
        `대기열에 넣을 수 없는 판정이다: ${r.gateVerdict}\n` +
          '  BLOCK 초안은 DB 에 남기지 않는다 — 원문 조각이 든 레코드가 될 수 있다.',
      )
    }
    if (r.gateResults.blocks.length > 0) {
      throw new Error(
        `BLOCK 사유가 있는 레코드다 (${r.gateResults.blocks.map((b) => b.code).join(', ')}).\n` +
          '  판정이 PASS·HOLD 인데 blocks 가 차 있으면 gate 와 적재가 어긋난 것이다.',
      )
    }
  }
}

/** 화면 한 줄 요약. 🔴 본문을 담지 않는다 */
export function formatPlan(plan: EnqueuePlan): string {
  const by = (reason: SkipReason): number => plan.skipped.filter((s) => s.reason === reason).length
  return (
    `적재 ${plan.enqueue.length}건` +
    ` (PASS ${plan.enqueue.filter((e) => e.gateVerdict === 'PASS').length}` +
    ` · HOLD ${plan.enqueue.filter((e) => e.gateVerdict === 'HOLD').length})` +
    ` · 제외 ${plan.skipped.length}건` +
    ` (🔴 BLOCK ${by('BLOCKED')} · 이미 있음 ${by('ALREADY_QUEUED')} · 배치 내 중복 ${by('DUPLICATE_IN_BATCH')})`
  )
}
