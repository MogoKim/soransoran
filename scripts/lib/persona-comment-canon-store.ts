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
import { EVAL_ROOT } from './persona-comment-eval-store'

export const ARTIFACT_FILES = ['summary.json', 'samples.json', 'key.json'] as const

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

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
}): PromoteResult {
  const fromRoot = input.fromRoot ?? EVAL_ROOT
  const toRoot = input.toRoot ?? ARTIFACT_ROOT
  if (!/^\d{8}-\d{6}$/.test(input.runId)) {
    return { ok: false, reason: `runId 형식이 아니다 — ${input.runId}` }
  }
  const src = readTriple(join(fromRoot, input.runId))
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
