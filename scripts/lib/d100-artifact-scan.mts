/**
 * 산출물 **읽기** — 🔴 read-only. 파일을 세기만 한다. 쓰지도 지우지도 않는다
 *
 * 🔴 **줄 수는 "글 수" 가 아니다.** 목록 파일은 회차마다 같은 글을 다시 담는다 —
 *    그 합계를 "카페의 고유 신규 글 수" 라고 부르면 카페에 글이 넘치는 것처럼 보인다.
 *    여기서는 **무엇을 센 것인지**를 이름에 남긴다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR = join(
  homedir(), 'Library', 'Application Support', 'soransoran', 'microseed-data',
)

export type ScanResult = {
  /** 창 안의 파일 수 */
  files: number
  /** 🔴 창 안 파일의 **줄 합계**. 중복이 들어 있다 */
  lines: number
  /** 마지막 산출 시각(ms) — 창 밖이어도 낸다. 없으면 `null` */
  lastAtMs: number | null
}

/** 🔴 이름이 `prefix` 로 시작하고 `suffix` 로 끝나는 파일만 */
export function scanArtifacts(input: {
  dir?: string
  prefix: string
  suffix: string
  sinceMs: number
}): ScanResult {
  const dir = input.dir ?? DATA_DIR
  if (!existsSync(dir)) return { files: 0, lines: 0, lastAtMs: null }
  let files = 0
  let lines = 0
  let lastAtMs: number | null = null
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return { files: 0, lines: 0, lastAtMs: null } }
  for (const n of names) {
    if (!n.startsWith(input.prefix) || !n.endsWith(input.suffix)) continue
    const p = join(dir, n)
    let mtime = 0
    try { mtime = statSync(p).mtimeMs } catch { continue }
    if (lastAtMs === null || mtime > lastAtMs) lastAtMs = mtime
    if (mtime < input.sinceMs) continue
    files += 1
    try {
      for (const line of readFileSync(p, 'utf-8').split('\n')) if (line.trim() !== '') lines += 1
    } catch { /* 깨진 파일은 줄을 세지 않는다 — 파일 수에는 남는다 */ }
  }
  return { files, lines, lastAtMs }
}
