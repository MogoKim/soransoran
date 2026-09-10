/**
 * 확정 모델 **정본** — 🔴 gitignored tmp 를 runtime 근거로 쓰지 않는다
 *
 * 🔴 **왜 옮겼나** (2026-09-09).
 *
 *    앞선 판은 `tmp/persona-comment-eval/<runId>/summary.json` 의 `selection` 을
 *    winner 정본으로 읽었다. 그 디렉터리는 gitignored 이고 누구나 고칠 수 있으며
 *    회차를 지우면 사라진다 — **감사할 수 없는 값**으로 공개 발행을 여는 셈이다.
 *
 *    확정은 사람이 채점한 결과다. 그 결과를 옮길 때
 *    **어느 회차의 어느 artifact 를 읽고 정했는지**가 함께 남아야 한다.
 *
 * 🔴 지금은 아무도 채점하지 않았다. 그래서 정본 파일이 없고 winner 는 null 이다.
 *    이 파일은 "없다" 를 정확히 말하는 것이 일이다.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ModelSelection } from './persona-comment-release'

/**
 * 🔴 **채점 artifact 도 worktree 밖 공용 경로에 둔다** (2026-09-09 정정).
 *
 *    앞선 판은 `process.cwd()/tmp` 에서 읽었다. 그러면 runtime worktree 에서
 *    돌 때 그 경로가 **없거나 다른 것**이라 모델 확정을 재검증할 수 없다 —
 *    개발 트리에서만 통과하는 검증은 검증이 아니다.
 *
 *    canon 과 같은 자리에 두어 두 worktree 가 **같은 SHA** 를 본다.
 */
export const ARTIFACT_ROOT = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'persona-comment-eval',
)

/**
 * 🔴 정본은 **worktree 밖**에 둔다 — 코드와 함께 갈아 끼워지지 않게.
 *    env·상태 정본과 같은 자리다.
 */
export const MODEL_CANON_FILE = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'persona-comment-model.json',
)

/** 사람 채점 결과를 옮길 때 함께 남기는 것 */
export type ModelCanon = {
  /** 어느 유료 회차를 읽고 정했는가 */
  runId: string
  /** 🔴 그 회차 artifact 의 SHA — 나중에 대조할 수 있어야 한다 */
  artifactSha: { summary: string; samples: string; key: string }
  winner: string
  /** 누가 언제 정했는가 */
  decidedBy: string
  decidedAt: string
  /** 채점한 표본 수 */
  scoredSamples: number
}

export type CanonRead = {
  selection: ModelSelection | null
  canon: ModelCanon | null
  /** 사람이 읽을 상태 한 줄 */
  detail: string
}

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

/**
 * 🔴 **정본이 없으면 `provisional` · winner null 이다.**
 *    tmp 를 대신 읽지 않는다 — 읽으면 감사할 수 없는 값이 공개를 연다.
 */
export function readConfirmedSelection(input?: {
  file?: string
  /** 🔴 artifact 를 어디서 읽는가 — 시험용 주입 */
  readArtifacts?: (runId: string) => { summaryJson: string; samplesJson: string; keyJson: string } | null
}): CanonRead {
  const file = input?.file ?? MODEL_CANON_FILE
  if (!existsSync(file)) {
    return {
      selection: { status: 'provisional', winner: null },
      canon: null,
      detail: '확정 정본이 없다 — 사람 채점 전이다(provisional · winner null)',
    }
  }
  try {
    const raw = readFileSync(file, 'utf-8')
    const j = JSON.parse(raw) as Partial<ModelCanon>
    const okShape = typeof j.runId === 'string' && typeof j.winner === 'string'
      && typeof j.decidedBy === 'string' && typeof j.decidedAt === 'string'
      && typeof j.scoredSamples === 'number'
      && j.artifactSha !== undefined
      && typeof j.artifactSha.summary === 'string'
      && typeof j.artifactSha.samples === 'string'
      && typeof j.artifactSha.key === 'string'
    if (!okShape) {
      // 🔴 모양이 아니면 통과시키지 않는다. 손상된 정본으로 공개를 열지 않는다
      return {
        selection: { status: 'provisional', winner: null },
        canon: null,
        detail: '확정 정본의 모양이 아니다 — 통과시키지 않는다(fail-closed)',
      }
    }
    const canon = j as ModelCanon
    if (canon.winner.trim() === '' || canon.scoredSamples <= 0) {
      return {
        selection: { status: 'provisional', winner: null },
        canon: null,
        detail: 'winner 가 비었거나 채점 표본이 0 이다 — 확정으로 보지 않는다',
      }
    }

    /**
     * 🔴 **모양만 보고 공개를 열지 않는다** (2026-09-09 정정).
     *
     *    앞선 판은 JSON 필드가 있는지만 확인했다. 그러면 아무 값이나 적어 둔 파일이
     *    "확정" 이 된다 — 채점한 적 없는 winner 로 공개가 열린다.
     *    정본은 **어느 회차의 어느 artifact 를 읽고 정했는지**를 들고 있으므로,
     *    그 artifact 를 실제로 읽어 SHA 를 대조한다.
     */
    const read = input?.readArtifacts ?? defaultReadArtifacts
    const actual = read(canon.runId)
    if (actual === null) {
      return {
        selection: { status: 'provisional', winner: null },
        canon: null,
        detail: `채점 근거 회차(${canon.runId})의 artifact 를 읽지 못했다 — 확정으로 보지 않는다(fail-closed)`,
      }
    }
    const v = verifyCanonArtifacts(canon, actual)
    if (!v.ok) {
      return { selection: { status: 'provisional', winner: null }, canon: null, detail: v.reason }
    }

    return {
      selection: { status: 'confirmed', winner: canon.winner },
      canon,
      detail: `확정 ${canon.winner} · 회차 ${canon.runId} · ${canon.decidedBy} ${canon.decidedAt} · artifact 대조 통과`,
    }
  } catch {
    return {
      selection: { status: 'provisional', winner: null },
      canon: null,
      detail: '확정 정본을 읽지 못했다 — 통과시키지 않는다(fail-closed)',
    }
  }
}

/** 🔴 실제 artifact 를 읽는다. 하나라도 없으면 null — 대조할 수 없으면 확정이 아니다 */
function defaultReadArtifacts(runId: string): {
  summaryJson: string; samplesJson: string; keyJson: string
} | null {
  try {
    const dir = join(ARTIFACT_ROOT, runId)
    return {
      summaryJson: readFileSync(join(dir, 'summary.json'), 'utf-8'),
      samplesJson: readFileSync(join(dir, 'samples.json'), 'utf-8'),
      keyJson: readFileSync(join(dir, 'key.json'), 'utf-8'),
    }
  } catch { return null }
}

/**
 * 🔴 후보 하나가 들고 다니는 **생성 근거**.
 *    Queue 행에 저장하고, 발행 트랜잭션 안에서 다시 검증한다 —
 *    "누가 어느 모델로 만들었는가" 를 나중에 물을 수 있어야 한다.
 */
export type CandidateProvenance = {
  /** 이 후보를 만든 모델 (내부 라벨) */
  model: string
  /** 그때의 확정 정본 회차 */
  canonRunId: string
  /** 🔴 정본 자체의 digest — 정본이 바뀌면 이 후보의 근거도 바뀐 것이다 */
  canonDigest: string
  /** 그 회차 artifact 의 digest */
  artifactSha: ModelCanon['artifactSha']
}

/** 🔴 정본 하나에서 provenance 를 만든다. 손으로 조립하지 않는다 */
export function provenanceOf(canon: ModelCanon): CandidateProvenance {
  return {
    model: canon.winner,
    canonRunId: canon.runId,
    canonDigest: sha16(JSON.stringify({
      runId: canon.runId, winner: canon.winner,
      artifactSha: canon.artifactSha, decidedAt: canon.decidedAt,
    })),
    artifactSha: canon.artifactSha,
  }
}

/**
 * 🔴 **provenance 가 없는 후보는 자동 공개할 수 없다.**
 *    옛 경로로 들어간 Queue 행에는 이 값이 없다 — 어느 모델이 만들었는지 모른다.
 *    사람이 읽고 승인하는 것은 가능하지만, 자동 발행 대상은 아니다.
 */
export function verifyProvenance(input: {
  stored: unknown
  canon: ModelCanon | null
}): { ok: boolean; reason: string } {
  if (input.canon === null) {
    return { ok: false, reason: '확정 정본이 없다 — 후보 근거를 대조할 수 없다(fail-closed)' }
  }
  const p = input.stored
  if (p === null || typeof p !== 'object') {
    return { ok: false, reason: '후보에 생성 근거(provenance)가 없다 — 자동 공개 불가' }
  }
  const s = p as Partial<CandidateProvenance>
  if (typeof s.model !== 'string' || typeof s.canonRunId !== 'string' || typeof s.canonDigest !== 'string') {
    return { ok: false, reason: '후보의 생성 근거가 모양이 아니다(fail-closed)' }
  }
  const now = provenanceOf(input.canon)
  if (s.canonRunId !== now.canonRunId) {
    return { ok: false, reason: `후보가 다른 회차(${s.canonRunId})의 정본으로 만들어졌다 — 지금 정본은 ${now.canonRunId}` }
  }
  if (s.canonDigest !== now.canonDigest) {
    return { ok: false, reason: '정본이 바뀌었다 — 이 후보의 생성 근거가 더는 유효하지 않다' }
  }
  if (s.model !== now.model) {
    return { ok: false, reason: `후보를 만든 모델(${s.model})이 지금 확정 모델(${now.model})과 다르다` }
  }
  return { ok: true, reason: `근거 확인 — ${s.model} · 회차 ${s.canonRunId}` }
}

/**
 * 🔴 **승격 계약.** 사람이 채점한 뒤 이 모양으로 옮긴다.
 *    이 함수는 파일을 쓰지 않는다 — 쓰는 것은 사람의 결정이고,
 *    자동으로 쓰면 "아무도 채점하지 않았는데 확정됐다" 가 생긴다.
 */
export function buildCanonFromScoring(input: {
  runId: string
  summaryJson: string
  samplesJson: string
  keyJson: string
  winner: string
  decidedBy: string
  decidedAt: string
  scoredSamples: number
}): ModelCanon {
  return {
    runId: input.runId,
    artifactSha: {
      summary: sha16(input.summaryJson),
      samples: sha16(input.samplesJson),
      key: sha16(input.keyJson),
    },
    winner: input.winner,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
    scoredSamples: input.scoredSamples,
  }
}

/** 🔴 정본이 가리키는 회차의 artifact 가 그때 그것인가 */
export function verifyCanonArtifacts(canon: ModelCanon, actual: {
  summaryJson: string; samplesJson: string; keyJson: string
}): { ok: boolean; reason: string } {
  const now = {
    summary: sha16(actual.summaryJson),
    samples: sha16(actual.samplesJson),
    key: sha16(actual.keyJson),
  }
  const diff = (['summary', 'samples', 'key'] as const).filter((k) => now[k] !== canon.artifactSha[k])
  return diff.length === 0
    ? { ok: true, reason: `회차 ${canon.runId} artifact 가 채점 당시와 같다` }
    : { ok: false, reason: `🔴 artifact 가 바뀌었다 — ${diff.join('·')} (채점 근거가 사라졌다)` }
}
