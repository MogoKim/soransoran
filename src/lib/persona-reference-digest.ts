/**
 * 정본 자산 **digest 조회** — 🔴 파일만 읽는다. 판정은 부르는 쪽이 한다
 *
 * 🔴 **왜 `src/lib` 에 있나** (2026-09-10, P0-4).
 *
 *    `readConfirmedSelection` 이 회차 manifest 와 **지금 자산**을 대조해야 하는데,
 *    그 함수는 `src/lib` 에 있고 Next.js 경계상 `scripts/` 를 import 할 수 없다.
 *    묶음(bundle) digest 는 Persona 집합에 따라 달라져 읽기 경로가 알 수 없으므로,
 *    여기서는 **코퍼스 digest 만** 본다 — "회차 이후 자산이 바뀌었는가" 에 답하기에 충분하다.
 *
 * 🔴 **모르면 통과시키지 않는다.** 자산이 없거나 못 읽으면 `null` 이고,
 *    부르는 쪽은 그것을 provisional 로 처리한다(fail-closed).
 */
import { existsSync, readFileSync } from 'node:fs'
import { REFERENCE_MANIFEST_FILE } from './persona-reference-asset'

export type AssetDigests = {
  sanitizedCorpusDigest: string
  /** 🔴 자산 생성 당시 **실제 작성자명**으로 돌린 검사의 증거 */
  identityLeakCheck: { ran: boolean; hits: number; detail: string } | null
}

/** 🔴 못 읽으면 `null`. "없다" 와 "깨끗하다" 를 섞지 않는다 */
export function readAssetDigests(): AssetDigests | null {
  try {
    if (!existsSync(REFERENCE_MANIFEST_FILE)) return null
    const m = JSON.parse(readFileSync(REFERENCE_MANIFEST_FILE, 'utf-8')) as {
      sanitizedCorpusDigest?: unknown
      identityLeakCheck?: { ran?: unknown; hits?: unknown; detail?: unknown }
    }
    if (typeof m.sanitizedCorpusDigest !== 'string' || m.sanitizedCorpusDigest === '') return null
    const l = m.identityLeakCheck
    return {
      sanitizedCorpusDigest: m.sanitizedCorpusDigest,
      identityLeakCheck: l !== undefined
        && typeof l.ran === 'boolean' && typeof l.hits === 'number' && typeof l.detail === 'string'
        ? { ran: l.ran, hits: l.hits, detail: l.detail }
        : null,
    }
  } catch { return null }
}
