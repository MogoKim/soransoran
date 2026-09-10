/**
 * 채점 artifact **승격** — 🔴 개발 트리와 runtime 이 **같은 SHA** 를 보게 만든다
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-09).
 *
 *    확정 정본은 `~/Library/Application Support/soransoran/` 에 있는데
 *    채점 artifact 는 `process.cwd()/tmp` 에서 읽고 있었다.
 *    runtime worktree 에서 돌면 그 `tmp` 는 **없거나 다른 것**이라,
 *    정본이 가리키는 회차의 SHA 를 대조할 수 없었다 —
 *    개발 트리에서만 통과하는 검증은 검증이 아니다.
 *
 *    그래서 artifact 를 정본 옆 공용 경로로 **한 번에** 옮긴다.
 *
 * 🔴 **불변이다.** 이미 있는 회차는 덮어쓰지 않는다.
 *    내용이 같으면 "이미 같다" 로 성공하고, 다르면 실패한다 —
 *    유료 회차의 표본이 조용히 바뀌는 길을 두지 않는다.
 *
 * 🔴 **이 파일은 winner 를 정하지 않는다.** 옮기는 것과 정하는 것은 다른 일이고,
 *    정하는 것은 사람이 채점한 뒤의 결정이다.
 */
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import { ARTIFACT_ROOT } from '../../src/lib/persona-comment-provenance'
import { judgeRunUsable } from '../../src/lib/persona-eval-invalidation'
import { buildReferenceManifest, loadCanonAsset, planBundles } from './persona-reference-store.mjs'
import { EVAL_ROOT } from './persona-comment-eval-store'

export const ARTIFACT_FILES = ['summary.json', 'samples.json', 'key.json'] as const

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

/**
 * 🔴 지금 정본 자산으로 corpus·bundle digest 를 다시 낸다.
 *    자산이 없거나 묶음이 서지 않으면 `null` — 그러면 승격이 막힌다.
 */
function defaultExpectedDigests(): { sanitizedCorpusDigest: string; personaBundleDigest: string } | null {
  try {
    const canon = loadCanonAsset()
    if (!canon.ok || canon.rows.length === 0) return null
    const codes = [...new Set(canon.rows.map((r) => r.speakerId))].slice(0, 9)
      .map((_, i) => `S${String(i + 1).padStart(2, '0')}`)
    const plan = planBundles({ rows: canon.rows, personaCodes: codes })
    if (plan.bundles.length === 0) return null
    const m = buildReferenceManifest({
      sourceDigest: canon.sourceDigest ?? '', rows: canon.rows, bundles: plan.bundles,
    })
    return {
      sanitizedCorpusDigest: m.sanitizedCorpusDigest,
      personaBundleDigest: m.personaBundleDigest,
    }
  } catch { return null }
}

export type PromoteResult =
  | { ok: true; dir: string; hashes: Record<string, string>; already: boolean; reason: string }
  | { ok: false; reason: string }

/** 세 파일을 다 읽는다. 하나라도 없으면 `null` — 반쪽 회차는 옮기지 않는다 */
function readTriple(dir: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const name of ARTIFACT_FILES) {
    try { out[name] = readFileSync(join(dir, name), 'utf-8') } catch { return null }
  }
  return out
}

/**
 * 🔴 **원자적으로 옮긴다.** 임시 디렉터리에 세 파일을 다 쓴 뒤 `rename` 한 번으로 들여놓는다 —
 *    중간에 죽어도 반쯤 옮겨진 회차가 남지 않는다.
 */
export function promoteRun(input: {
  runId: string
  /** 유료 실행 결과가 있는 곳 (기본 `tmp/persona-comment-eval`) */
  fromRoot?: string
  /** 공용 정본 경로 (기본 Application Support) */
  toRoot?: string
  /** 🔴 지금 자산의 digest 를 내는 함수 — 시험용 주입. `null` 이면 승격 금지 */
  expectedDigests?: () => { sanitizedCorpusDigest: string; personaBundleDigest: string } | null
}): PromoteResult {
  const fromRoot = input.fromRoot ?? EVAL_ROOT
  const toRoot = input.toRoot ?? ARTIFACT_ROOT
  if (!/^\d{8}-\d{6}$/.test(input.runId)) {
    return { ok: false, reason: `runId 형식이 아니다 — ${input.runId}` }
  }
  const src = readTriple(join(fromRoot, input.runId))
  /**
   * 🔴 **무효 회차와 manifest 없는 회차는 승격하지 않는다** (2026-09-10, P0-1·P0-2).
   *
   *    옮기는 것은 값싼 일이라 막지 않으면 그대로 정본 옆에 놓인다.
   *    한 번 놓이면 다음 사람은 그것을 "확정된 근거" 로 읽는다.
   *    그래서 **옮기는 자리에서 막는다.**
   */
  {
    let manifest: unknown
    try {
      manifest = (JSON.parse(src?.['summary.json'] ?? '{}') as { referenceManifest?: unknown })
        .referenceManifest
    } catch { manifest = undefined }
    /**
     * 🔴 **지금 정본 자산으로 다시 낸 digest 와 실제로 대조한다** (2026-09-10, P0-3).
     *
     *    manifest 안의 값끼리만 보면 "적어 둔 대로 적었다" 를 확인할 뿐이다.
     *    회차가 저장된 뒤 자산이 바뀌었으면 그 회차의 근거는 재현되지 않는다.
     *
     * 🔴 **expected 를 구하지 못하면 승격하지 않는다.** 대조할 수 없는 것을
     *    "대조 통과" 로 세지 않는다(fail-closed).
     */
    const expected = (input.expectedDigests ?? defaultExpectedDigests)()
    if (expected === null) {
      return {
        ok: false,
        reason: '[REFERENCE_ASSET_UNAVAILABLE] 지금 정본 자산의 digest 를 구하지 못했다'
          + ' — 대조 없이 승격하지 않는다(fail-closed)',
      }
    }
    const usable = judgeRunUsable({ runId: input.runId, manifest, expected })
    if (!usable.usable) {
      return { ok: false, reason: `[${usable.code}] ${usable.reason}` }
    }
  }
  if (src === null) {
    return { ok: false, reason: `옮길 회차를 읽지 못했다 — ${join(fromRoot, input.runId)} (세 파일이 다 있어야 한다)` }
  }
  const hashes: Record<string, string> = {}
  for (const [name, text] of Object.entries(src)) hashes[name] = sha16(text)

  const dst = join(toRoot, input.runId)
  const existing = readTriple(dst)
  if (existing !== null) {
    // 🔴 같은 내용이면 다시 옮길 필요가 없다. 다르면 **덮어쓰지 않는다**
    const same = ARTIFACT_FILES.every((n) => sha16(existing[n] ?? '') === hashes[n])
    return same
      ? { ok: true, dir: dst, hashes, already: true, reason: '이미 같은 내용이 있다 — 아무것도 바꾸지 않았다' }
      : { ok: false, reason: `이미 있는 회차의 내용이 다르다 — ${dst} (불변이다. 덮어쓰지 않는다)` }
  }

  const staging = join(toRoot, `.staging-${input.runId}-${process.pid}`)
  try {
    mkdirSync(staging, { recursive: true })
    for (const [name, text] of Object.entries(src)) {
      writeFileSync(join(staging, name), text, { encoding: 'utf-8', mode: 0o600 })
    }
    renameSync(staging, dst)
    return { ok: true, dir: dst, hashes, already: false, reason: `승격 완료 — ${dst}` }
  } catch (e) {
    try { rmSync(staging, { recursive: true, force: true }) } catch { /* 이미 없다 */ }
    return { ok: false, reason: `승격 실패 — ${(e as Error).message}` }
  }
}

/** 공용 경로에 올라와 있는 회차 목록 — 오래된 것부터 */
export function listPromoted(root: string = ARTIFACT_ROOT): string[] {
  try {
    return readdirSync(root).filter((n) => /^\d{8}-\d{6}$/.test(n)).sort()
  } catch { return [] }
}

/**
 * 🔴 **두 트리가 같은 것을 보는가.**
 *    공용 경로의 SHA 만 낸다 — 어느 worktree 에서 실행해도 같은 값이어야 한다.
 *    다르면 그 자체가 사고다.
 */
export function hashPromoted(runId: string, root: string = ARTIFACT_ROOT): Record<string, string> | null {
  const t = readTriple(join(root, runId))
  if (t === null) return null
  const out: Record<string, string> = {}
  for (const [name, text] of Object.entries(t)) out[name] = sha16(text)
  return out
}

/** 🔴 승격 없이 상태만 본다 — 존재 여부와 SHA */
export function promotionStatus(runId: string, roots?: { fromRoot?: string; toRoot?: string }): {
  inLocal: Record<string, string> | null
  inShared: Record<string, string> | null
  same: boolean
} {
  const fromRoot = roots?.fromRoot ?? EVAL_ROOT
  const toRoot = roots?.toRoot ?? ARTIFACT_ROOT
  const local = readTriple(join(fromRoot, runId))
  const shared = readTriple(join(toRoot, runId))
  const hash = (t: Record<string, string> | null): Record<string, string> | null => {
    if (t === null) return null
    const o: Record<string, string> = {}
    for (const [n, s] of Object.entries(t)) o[n] = sha16(s)
    return o
  }
  const l = hash(local)
  const s = hash(shared)
  return {
    inLocal: l,
    inShared: s,
    same: l !== null && s !== null && ARTIFACT_FILES.every((n) => l[n] === s[n]),
  }
}
