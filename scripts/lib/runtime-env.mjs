/**
 * runtime `.env.local` 읽기 — 🔴 **읽기만 한다. 아무것도 켜지 않는다**
 *
 * 🔴 **정본이 하나여야 하는 이유** (2026-09-14).
 *    배포기와 격리 검사가 각자 파서를 들고 있으면, 같은 파일을 보고도
 *    "이 job 은 꺼져 있다" 를 서로 다르게 읽을 수 있다. 그러면 배포는 통과하는데
 *    격리 검사는 막는(또는 그 반대) 상태가 생긴다. 파서는 여기 하나뿐이다.
 *
 * 🔴 값은 부르는 쪽이 **스위치 판정에만** 쓴다. 이 파일에는 DATABASE_URL · API key 가
 *    함께 살기 때문에, 읽은 것을 그대로 찍지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** @param {string} runtimeRoot @returns {Record<string, string>} */
export function readRuntimeEnv(runtimeRoot) {
  /** @type {Record<string, string>} */
  const out = {}
  const f = join(runtimeRoot, '.env.local')
  if (!existsSync(f)) return out
  try {
    for (const line of readFileSync(f, 'utf-8').split('\n')) {
      const t = line.trim()
      if (t === '' || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch { /* 못 읽으면 빈 것으로 — judgeJobEnv 가 unset 으로 막는다 */ }
  return out
}
