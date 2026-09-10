/**
 * 댓글 생성 모델 **확정 판정** — 🔴 순수 함수. 파일·DB·네트워크 없음
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-10, 창업자 승인).
 *
 *    확정 정본(`persona-comment-model.json`)을 쓰는 일은 **되돌리기 어렵다.**
 *    한 번 쓰이면 health · Queue · runner · 발행 트랜잭션이 전부 그것을 읽고
 *    "이 모델로 공개해도 된다" 로 해석한다.
 *
 *    그래서 쓰기 전에 물어야 할 것을 **한 곳에 모으고 순수 함수로 만든다.**
 *    도구가 판정을 흩어 두면 어느 조건이 실제로 확인됐는지 알 수 없게 된다.
 *
 * 🔴 **이 파일은 아무것도 쓰지 않는다.** 판정만 낸다.
 *    쓰는 것은 `scripts/persona-comment-decide.mts` 가 `--apply` 와 함께 할 때뿐이다.
 *    (`persona-comment-canon` 은 artifact 를 옮기기만 한다 — winner 를 정하지 않는다)
 *
 * 🔴 **승인은 회차 하나에 대한 것이다.** 다른 회차를 넣으면 막힌다 —
 *    "승인받았다" 가 다음 회차로 번지지 않게 한다.
 */
import { findInvalidation } from './persona-eval-invalidation'
import { judgeExperienceGrounding } from './persona-experience-grounding'

/**
 * 🔴 **창업자가 승인한 결정 하나.**
 *
 *    값을 바꾸려면 이 상수를 고치는 커밋이 있어야 하고, 그 커밋이 곧 기록이 된다.
 *    명령줄 인자로 winner 를 받지 않는다 — 받으면 오타 하나가 다른 모델을 확정한다.
 */
export const APPROVED_DECISION = {
  runId: '20260910-215242',
  winner: 'gemini-3.7-flash',
  /** 🔴 탈락 근거로 기록하되 winner 로 고르지 않는다 */
  rejected: 'claude-haiku-4.5',
  decidedBy: 'founder',
  /** 승인 근거 — 사람이 읽고 확인한 사실 */
  basis: '근거 없는 자기 경험 0/9 · statusPass 6/9',
  rejectedBasis: '근거 없는 자기 경험 1/9 · statusPass 2/9',
  /** 🔴 winner 표본 수. 이 수가 아니면 다른 회차를 보고 있는 것이다 */
  expectedWinnerSamples: 9,
  /**
   * 🔴 **승인한 artifact 의 실제 SHA.**
   *
   *    형식(16자 hex) 검사는 승인 대조가 아니다 — 내용을 바꾸고 새 SHA 를 계산해
   *    넣어도 통과한다(실측). **승인한 그 파일인지**를 값으로 못 박는다.
   */
  artifactSha: {
    summary: '5d3b933f15932501',
    samples: 'f3c5ce4b78470c4e',
    key: '9f8ea80e872d7c72',
  },
  /** 🔴 승인 당시 정본 자산의 코퍼스 digest */
  referenceCorpusDigest: '56caff2e05d45ce4',
  /**
   * 🔴 **묶음 digest 도 결정에 명시한다** (2026-09-10 보강).
   *
   *    앞선 회차(`20260910-180719`)는 코퍼스 digest 는 같았는데 **묶음 digest 가 달라**
   *    승격에서 막혔다 — 회차를 만든 뒤 1인칭 판정 오탐을 고쳤고,
   *    그 수정이 경험형 참고 댓글 제외를 255→202 로 바꿔 묶음 구성이 달라졌기 때문이다.
   *    코퍼스가 같아도 **묶음이 다르면 그 회차는 재현되지 않는다.**
   *    그래서 승인 결정에 값으로 적고, 회차 manifest 의 실제 값과 대조한다.
   */
  referenceBundleDigest: 'bb3ee27d45f7c76c',
} as const

export type DecisionBlockCode =
  | 'RUN_NOT_APPROVED'
  | 'RUN_INVALIDATED'
  | 'WINNER_NOT_IN_KEY'
  | 'WINNER_NOT_APPROVED'
  | 'DECIDED_BY_NOT_FOUNDER'
  | 'ARTIFACT_SHA_MISMATCH'
  | 'REFERENCE_DIGEST_MISMATCH'
  | 'REFERENCE_DIGEST_UNAVAILABLE'
  | 'WINNER_SAMPLE_COUNT'
  | 'WINNER_UNGROUNDED_EXPERIENCE'
  | 'REJECTED_NOT_PRESENT'
  | 'ARTIFACT_UNREADABLE'

export type DecisionBlock = { code: DecisionBlockCode; message: string }

export type KeyDoc = { runId?: unknown; key?: unknown }
export type SampleRow = { id?: unknown; blindLabel?: unknown; text?: unknown; statusPass?: unknown }

export type DecisionEvidence = {
  runId: string
  winner: string
  rejected: string
  winnerSamples: number
  winnerUngrounded: number
  winnerStatusPass: number
  rejectedSamples: number
  rejectedUngrounded: number
  rejectedStatusPass: number
}

export type DecisionVerdict =
  | { ok: true; evidence: DecisionEvidence; blocks: [] }
  | { ok: false; evidence: DecisionEvidence | null; blocks: DecisionBlock[] }

const labelsOf = (keyDoc: KeyDoc): { blindLabel: string; model: string }[] => {
  if (!Array.isArray(keyDoc.key)) return []
  const out: { blindLabel: string; model: string }[] = []
  for (const k of keyDoc.key) {
    if (k === null || typeof k !== 'object') continue
    const o = k as { blindLabel?: unknown; model?: unknown }
    if (typeof o.blindLabel === 'string' && typeof o.model === 'string') {
      out.push({ blindLabel: o.blindLabel, model: o.model })
    }
  }
  return out
}

/**
 * 🔴 **확정해도 되는가.** 조건을 하나라도 못 지키면 `ok: false` 다.
 *
 *    조건을 **전부 모아서** 돌려준다 — 첫 실패에서 멈추면 사람이 고치고 다시 돌리기를
 *    반복하게 되고, 그 과정에서 무엇이 남았는지 놓친다.
 */
export function judgeCanonDecision(input: {
  runId: string
  /** 명령이 쓰려는 winner. 🔴 승인된 것과 달라도 여기서 막는다 */
  winner: string
  decidedBy: string
  summaryJson: string
  samplesJson: string
  keyJson: string
  /** 회차 artifact 의 실제 SHA (부르는 쪽이 잰 것) */
  actualSha: { summary: string; samples: string; key: string }
  /** 회차 manifest 가 적어 둔 코퍼스 digest */
  runCorpusDigest: string | null
  /** 지금 정본 자산의 코퍼스 digest. `null` 이면 대조 불가 */
  assetCorpusDigest: string | null
  /** 🔴 회차 manifest 가 적어 둔 **묶음** digest */
  runBundleDigest?: string | null
}): DecisionVerdict {
  const blocks: DecisionBlock[] = []

  // ── 승인 범위 ──
  if (input.runId !== APPROVED_DECISION.runId) {
    blocks.push({
      code: 'RUN_NOT_APPROVED',
      message: `승인된 회차가 아니다 — 받은 값 ${input.runId} · 승인 ${APPROVED_DECISION.runId}`,
    })
  }
  if (input.decidedBy !== APPROVED_DECISION.decidedBy) {
    blocks.push({
      code: 'DECIDED_BY_NOT_FOUNDER',
      message: `decidedBy 는 ${APPROVED_DECISION.decidedBy} 여야 한다 — 받은 값 ${input.decidedBy}`,
    })
  }
  const bad = findInvalidation(input.runId)
  if (bad !== null) {
    blocks.push({
      code: 'RUN_INVALIDATED',
      message: `🔴 ${input.runId} 는 영구 무효다 — ${bad.disclosure}`,
    })
  }

  // ── artifact 를 읽는다 ──
  let keyDoc: KeyDoc
  let samples: SampleRow[]
  try {
    keyDoc = JSON.parse(input.keyJson) as KeyDoc
    const s = JSON.parse(input.samplesJson) as { samples?: unknown }
    samples = Array.isArray(s.samples) ? (s.samples as SampleRow[]) : []
  } catch {
    return {
      ok: false,
      evidence: null,
      blocks: [...blocks, { code: 'ARTIFACT_UNREADABLE', message: 'artifact 를 JSON 으로 읽지 못했다' }],
    }
  }

  // ── winner 가 key.json 에 실제로 있는가 ──
  const pairs = labelsOf(keyDoc)
  const winnerPair = pairs.find((p) => p.model === input.winner)
  if (winnerPair === undefined) {
    blocks.push({
      code: 'WINNER_NOT_IN_KEY',
      message: `winner 가 key.json 에 없다 — ${input.winner}`
        + ` (있는 것: ${pairs.map((p) => p.model).join(' · ') || '없음'})`,
    })
  }
  if (input.winner !== APPROVED_DECISION.winner) {
    blocks.push({
      code: 'WINNER_NOT_APPROVED',
      message: `승인된 모델이 아니다 — 받은 값 ${input.winner} · 승인 ${APPROVED_DECISION.winner}`,
    })
  }
  const rejectedPair = pairs.find((p) => p.model === APPROVED_DECISION.rejected)
  if (rejectedPair === undefined) {
    blocks.push({
      code: 'REJECTED_NOT_PRESENT',
      message: `탈락 모델이 key.json 에 없다 — ${APPROVED_DECISION.rejected}`
        + ' (두 모델 비교 회차가 아니다)',
    })
  }

  // ── artifact 정합 — 🔴 SHA 는 부르는 쪽이 잰다. 여기서는 **내용이 그 회차인지**를 본다
  const summarySha = ((): string | null => {
    try {
      const j = JSON.parse(input.summaryJson) as { runId?: unknown }
      return typeof j.runId === 'string' ? j.runId : null
    } catch { return null }
  })()
  if (summarySha !== input.runId) {
    blocks.push({
      code: 'ARTIFACT_SHA_MISMATCH',
      message: `summary.json 의 runId 가 다르다 — ${String(summarySha)} ≠ ${input.runId}`,
    })
  }
  if (typeof keyDoc.runId === 'string' && keyDoc.runId !== input.runId) {
    blocks.push({
      code: 'ARTIFACT_SHA_MISMATCH',
      message: `key.json 의 runId 가 다르다 — ${keyDoc.runId} ≠ ${input.runId}`,
    })
  }
  /**
   * 🔴 **형식이 아니라 값을 본다.**
   *    16자 hex 검사만으로는 내용을 바꾸고 SHA 를 다시 계산해 넣으면 통과한다.
   */
  for (const name of ['summary', 'samples', 'key'] as const) {
    const got = input.actualSha[name]
    const want = APPROVED_DECISION.artifactSha[name]
    if (got !== want) {
      blocks.push({
        code: 'ARTIFACT_SHA_MISMATCH',
        message: `${name}.json SHA 가 승인한 값과 다르다 — 실측 ${got} · 승인 ${want}`,
      })
    }
  }

  // ── reference 자산 digest ──
  if (input.assetCorpusDigest === null) {
    blocks.push({
      code: 'REFERENCE_DIGEST_UNAVAILABLE',
      message: '지금 정본 자산의 digest 를 읽지 못했다 — 대조 없이 확정하지 않는다',
    })
  } else if (input.runCorpusDigest === null) {
    blocks.push({
      code: 'REFERENCE_DIGEST_UNAVAILABLE',
      message: '회차 manifest 에 코퍼스 digest 가 없다',
    })
  } else if (input.runCorpusDigest !== input.assetCorpusDigest) {
    blocks.push({
      code: 'REFERENCE_DIGEST_MISMATCH',
      message: `회차와 지금 자산의 코퍼스 digest 가 다르다`
        + ` — 회차 ${input.runCorpusDigest} · 지금 ${input.assetCorpusDigest}`,
    })
  } else if (input.runCorpusDigest !== APPROVED_DECISION.referenceCorpusDigest) {
    // 🔴 둘이 서로 같아도 **승인한 값**과 달라야 한다면 다른 자산이다
    blocks.push({
      code: 'REFERENCE_DIGEST_MISMATCH',
      message: `승인한 코퍼스 digest 가 아니다`
        + ` — 실측 ${input.runCorpusDigest} · 승인 ${APPROVED_DECISION.referenceCorpusDigest}`,
    })
  }

  /**
   * 🔴 **묶음 digest 도 본다.** 코퍼스가 같아도 묶음이 다르면 재현되지 않는다.
   */
  if (input.runBundleDigest === undefined || input.runBundleDigest === null) {
    blocks.push({
      code: 'REFERENCE_DIGEST_UNAVAILABLE',
      message: '회차 manifest 에 묶음 digest 가 없다',
    })
  } else if (input.runBundleDigest !== APPROVED_DECISION.referenceBundleDigest) {
    blocks.push({
      code: 'REFERENCE_DIGEST_MISMATCH',
      message: `승인한 묶음 digest 가 아니다`
        + ` — 실측 ${input.runBundleDigest} · 승인 ${APPROVED_DECISION.referenceBundleDigest}`,
    })
  }

  // ── 표본 근거 ──
  const rowsOf = (label: string | undefined): SampleRow[] =>
    label === undefined ? [] : samples.filter((s) => s.blindLabel === label)
  const countUngrounded = (rows: SampleRow[]): number =>
    rows.filter((s) => !judgeExperienceGrounding({
      text: typeof s.text === 'string' ? s.text : '', grounding: '',
    }).ok).length
  const countPass = (rows: SampleRow[]): number => rows.filter((s) => s.statusPass === true).length

  const wRows = rowsOf(winnerPair?.blindLabel)
  const rRows = rowsOf(rejectedPair?.blindLabel)
  const evidence: DecisionEvidence = {
    runId: input.runId,
    winner: input.winner,
    rejected: APPROVED_DECISION.rejected,
    winnerSamples: wRows.length,
    winnerUngrounded: countUngrounded(wRows),
    winnerStatusPass: countPass(wRows),
    rejectedSamples: rRows.length,
    rejectedUngrounded: countUngrounded(rRows),
    rejectedStatusPass: countPass(rRows),
  }

  if (wRows.length !== APPROVED_DECISION.expectedWinnerSamples) {
    blocks.push({
      code: 'WINNER_SAMPLE_COUNT',
      message: `winner 표본이 ${wRows.length}건 —`
        + ` ${APPROVED_DECISION.expectedWinnerSamples}건이어야 한다`,
    })
  }
  /** 🔴 **근거 없는 자기 경험이 하나라도 있으면 확정하지 않는다** */
  if (evidence.winnerUngrounded !== 0) {
    blocks.push({
      code: 'WINNER_UNGROUNDED_EXPERIENCE',
      message: `winner 표본에 근거 없는 자기 경험 ${evidence.winnerUngrounded}건`
        + ' — 0건이어야 확정한다',
    })
  }

  return blocks.length === 0
    ? { ok: true, evidence, blocks: [] }
    : { ok: false, evidence, blocks }
}

// ─────────────────────────────────────────────────────────
// 쓰기 판정 — 🔴 덮어쓰지 않는다
// ─────────────────────────────────────────────────────────

export type WriteAction = 'WRITE' | 'IDENTICAL' | 'CONFLICT'

/**
 * 🔴 **이미 있는 확정 정본을 덮어쓰지 않는다.**
 *
 *    같은 내용이면 **멱등 성공**(`IDENTICAL`)이고,
 *    다르면 **중단**(`CONFLICT`)이다 — 사람이 보고 정할 일이지 도구가 갈아 끼울 일이 아니다.
 */
export function judgeCanonWrite(input: {
  existingJson: string | null
  nextJson: string
}): { action: WriteAction; reason: string } {
  if (input.existingJson === null) {
    return { action: 'WRITE', reason: '확정 정본이 없다 — 새로 쓴다' }
  }
  /**
   * 🔴 **`decidedAt` 만 다른 것은 같은 결정이다** (2026-09-10 보강).
   *
   *    앞선 판은 JSON 전체를 비교해서, 같은 명령을 두 번 돌리면
   *    **기록 시각이 달라 늘 `CONFLICT`** 였다 — 멱등이 아니었다(실측).
   *    무엇을 정했는가는 `runId · winner · artifactSha · scoredSamples · decidedBy` 다.
   *    언제 적었는가는 결정의 내용이 아니다.
   *
   * 🔴 그 다섯 중 하나라도 다르면 여전히 `CONFLICT` 다 — 덮어쓰지 않는다.
   */
  const identityOf = (raw: string): string | null => {
    try {
      const j = JSON.parse(raw) as Record<string, unknown>
      const sha = (j.artifactSha ?? {}) as Record<string, unknown>
      return JSON.stringify({
        runId: j.runId,
        winner: j.winner,
        decidedBy: j.decidedBy,
        scoredSamples: j.scoredSamples,
        artifactSha: { summary: sha.summary, samples: sha.samples, key: sha.key },
      })
    } catch { return null }
  }
  const a = identityOf(input.existingJson)
  const b = identityOf(input.nextJson)
  if (a === null || b === null) {
    // 🔴 읽지 못하면 같다고 하지 않는다
    return {
      action: 'CONFLICT',
      reason: '확정 정본을 읽지 못했다 — 같은지 알 수 없으므로 덮어쓰지 않는다',
    }
  }
  if (a === b) {
    return {
      action: 'IDENTICAL',
      reason: '같은 결정이 이미 기록돼 있다 — 파일을 바꾸지 않는다(멱등)'
        + ' · 🔴 decidedAt 만 다른 것은 같은 결정으로 본다',
    }
  }
  return {
    action: 'CONFLICT',
    reason: '확정 정본이 이미 있고 결정 내용이 다르다 — 🔴 덮어쓰지 않는다. 사람이 확인한다',
  }
}
