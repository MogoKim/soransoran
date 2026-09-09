/**
 * 모델 평가 artifact **저장소** — 🔴 유료 실행 결과를 덮어쓰지 않는다
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-09).
 *
 *    실제 20회 호출로 만든 표본을 **그 다음 dry-run 이 같은 경로에 덮어썼다.**
 *    남은 것은 `samples: []` 였다. 돈을 쓴 결과물이 돈을 쓰지 않은 실행에
 *    지워진 것이고, 그러면 사람이 채점할 것이 없다.
 *
 *    파일 이름 하나를 공유한 것이 원인이다. 그래서 경로를 나눈다 —
 *    유료 실행은 `<root>/<runId>/` 아래에 쓰고, dry-run 은 그 아래를 건드리지 않는다.
 *
 * 🔴 **기존 runId 디렉터리는 절대 덮어쓰지 않는다.** 이미 있으면 실패한다.
 * 🔴 `latest` 포인터는 **성공한 유료 실행 뒤에만** 원자적으로 갱신한다.
 */
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** 유료 실행 결과가 사는 곳 — 🔴 gitignored `tmp/` 아래다 */
export const EVAL_ROOT = 'tmp/persona-comment-eval'
export const LATEST_FILE = 'latest.json'

export type EvalArtifact = {
  /** 요약 — 모델별 실측 수치. 🔴 여기에도 모델명이 있으므로 blind 대상이 아니다 */
  summary: unknown
  /** 🔴 blind 표본 — 모델명이 어떤 필드로도 들어가면 안 된다 */
  samples: unknown
  /** 🔴 blindLabel → model 대응표. 채점 뒤에 연다 */
  key: unknown
}

export type SaveResult =
  | { ok: true; dir: string; files: string[]; hashes: Record<string, string> }
  | { ok: false; reason: string }

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)

/** `20260909-084801` — 사람이 읽고 정렬할 수 있는 형식 */
export function runIdOf(at: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`
    + `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
}

/**
 * 🔴 **유료 실행 결과만** 저장한다.
 *
 *    · `called === false` 면 저장하지 않는다 — dry-run 은 이 저장소에 들어오지 않는다
 *    · 같은 `runId` 디렉터리가 이미 있으면 **실패한다.** 덮어쓰지 않는다
 *    · 셋을 임시 디렉터리에 다 쓴 뒤 `rename` 으로 한 번에 들여놓는다 —
 *      중간에 죽어도 반쯤 쓰인 회차가 남지 않는다
 */
export function savePaidRun(input: {
  root?: string
  runId: string
  called: boolean
  artifact: EvalArtifact
}): SaveResult {
  const root = input.root ?? EVAL_ROOT
  if (!input.called) {
    return { ok: false, reason: 'dry-run 결과는 이 저장소에 넣지 않는다 (유료 실행만 보관한다)' }
  }
  if (!/^\d{8}-\d{6}$/.test(input.runId)) {
    return { ok: false, reason: `runId 형식이 아니다 — ${input.runId}` }
  }
  const dir = join(root, input.runId)
  // 🔴 이미 있으면 멈춘다. 같은 runId 에 두 번 쓰면 앞의 것이 사라진다
  if (existsSync(dir)) {
    return { ok: false, reason: `이미 있는 회차다 — ${dir} (덮어쓰지 않는다)` }
  }
  const staging = join(root, `.staging-${input.runId}-${process.pid}`)
  try {
    mkdirSync(staging, { recursive: true })
    const files: Record<string, unknown> = {
      'summary.json': input.artifact.summary,
      'samples.json': input.artifact.samples,
      'key.json': input.artifact.key,
    }
    const hashes: Record<string, string> = {}
    for (const [name, body] of Object.entries(files)) {
      const text = `${JSON.stringify(body, null, 2)}\n`
      writeFileSync(join(staging, name), text, { encoding: 'utf-8', mode: 0o600 })
      hashes[name] = sha(text)
    }
    // 🔴 한 번의 rename 으로 들여놓는다
    renameSync(staging, dir)
    return { ok: true, dir, files: Object.keys(files), hashes }
  } catch (e) {
    try { rmSync(staging, { recursive: true, force: true }) } catch { /* 이미 없다 */ }
    return { ok: false, reason: `저장 실패 — ${(e as Error).message}` }
  }
}

/**
 * 🔴 `latest` 포인터는 **성공한 유료 실행 뒤에만** 갱신한다.
 *    dry-run 이 latest 를 옮기면 채점하러 온 사람이 빈 회차를 연다.
 */
export function pointLatest(input: {
  root?: string
  runId: string
  called: boolean
}): { ok: boolean; reason: string } {
  const root = input.root ?? EVAL_ROOT
  if (!input.called) return { ok: false, reason: 'dry-run 은 latest 를 옮기지 않는다' }
  const dir = join(root, input.runId)
  if (!existsSync(dir)) return { ok: false, reason: `그 회차가 없다 — ${dir}` }
  const tmp = join(root, `.latest-${process.pid}.json`)
  try {
    writeFileSync(tmp, `${JSON.stringify({ runId: input.runId, at: new Date().toISOString() }, null, 2)}\n`,
      { encoding: 'utf-8', mode: 0o600 })
    renameSync(tmp, join(root, LATEST_FILE))
    return { ok: true, reason: `latest → ${input.runId}` }
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* 이미 없다 */ }
    return { ok: false, reason: `latest 갱신 실패 — ${(e as Error).message}` }
  }
}

/** 보관된 회차 목록 — 오래된 것부터 */
export function listRuns(root: string = EVAL_ROOT): string[] {
  try {
    return readdirSync(root).filter((n) => /^\d{8}-\d{6}$/.test(n)).sort()
  } catch { return [] }
}

/** 🔴 fixture 가 "그대로인가" 를 확인할 때 쓴다 */
export function hashRun(root: string, runId: string): Record<string, string> | null {
  const dir = join(root, runId)
  const out: Record<string, string> = {}
  for (const name of ['summary.json', 'samples.json', 'key.json']) {
    try { out[name] = sha(readFileSync(join(dir, name), 'utf-8')) } catch { return null }
  }
  return out
}
