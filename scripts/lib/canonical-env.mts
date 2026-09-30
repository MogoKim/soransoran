/**
 * 🔴 **정본 env 판독기 — 이 파일 하나다** (2026-10-01 `ops-signals` 에서 옮김 · 그쪽이 다시 내보낸다)
 *    정본 env 에는 API key 와 접속 주소가 함께 산다 — **이름을 못 박은 키**만 메모리에 올린다. 값을 찍지 않는다.
 *    🔴 의존성이 없다(node 내장만) — 어느 lib 가 불러도 순환 import 가 생기지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CANONICAL_ENV_FILE = join(homedir(), 'Library', 'Application Support', 'soransoran', 'env.local')

/** 🔴 정본 env 에서 **이 목록의 키만** 읽는다. 목록 밖의 값은 메모리에도 올리지 않는다 */
export function readEnvKeys(keys: readonly string[], path: string = CANONICAL_ENV_FILE): {
  ok: boolean; values: Record<string, string>; reason: string | null
} {
  if (!existsSync(path)) return { ok: false, values: {}, reason: `정본 env 가 없다 — ${path}` }
  let text: string
  try { text = readFileSync(path, 'utf-8') } catch (e) {
    return { ok: false, values: {}, reason: `정본 env 를 읽지 못했다 — ${(e as Error).name}` }
  }
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m === null || !keys.includes(m[1]!)) continue
    let v = m[2]!.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    values[m[1]!] = v
  }
  return { ok: true, values, reason: null }
}
