/**
 * 🔴 **지난 회차의 결과를 읽는 한 곳** (2026-09-20)
 *
 *    공급 러너가 "이 원천은 끝났는가" 를 판단하려면 데이터 폴더의 판정 파일과
 *    artifact 파일을 읽어야 한다. 🔴 **읽는 코드를 러너와 검사가 따로 두면**
 *    검사는 구현을 흉내 낸 것이 되고, 러너만 틀려도 검사는 통과한다.
 *    그래서 파일 목록·해석·실패 처리를 전부 여기 하나에 둔다.
 *
 * 🔴 **못 읽는 파일·못 읽는 줄은 결론으로 세지 않는다.** 건너뛸 뿐 영구 제외를
 *    만들지 않는다 — 깨진 파일 하나가 원천을 영영 굶기면 안 된다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  artifactRecordOutcome, shadowRecordOutcome,
  type PriorOutcome, type WorksetCanon,
} from '../../src/lib/supply-workset'
import type { ContractBase } from '../../src/lib/content-core/pipeline'

/** 🔴 생성 결과 파일 이름 — 판정 파일과 달리 접두사까지 정해져 있다 */
const ARTIFACT_FILE = /^auto-draft-.*\.artifacts\.json$/

export type PriorOutcomeRead = {
  dataDir: string
  /** 🔴 **이번 회차 대상 원천의 지금 입력 지문.** 여기 없는 id 는 보지 않는다 */
  hashOf: ReadonlyMap<string, string>
  canon: WorksetCanon
  base: ContractBase
  artifactVersion: string
}

export function readPriorOutcomes(o: PriorOutcomeRead): PriorOutcome[] {
  const out: PriorOutcome[] = []
  let names: string[]
  try { names = readdirSync(o.dataDir) } catch { return out }
  for (const f of names) {
    const isShadow = f.endsWith('.shadow.jsonl')
    if (!isShadow && !ARTIFACT_FILE.test(f)) continue
    let raw: string
    try { raw = readFileSync(join(o.dataDir, f), 'utf-8') } catch { continue }
    if (isShadow) {
      for (const line of raw.split('\n')) {
        if (line.trim() === '') continue
        let row: unknown
        try { row = JSON.parse(line) } catch { continue }
        if (typeof row !== 'object' || row === null) continue
        const s = shadowRecordOutcome(row as Record<string, unknown>, o.hashOf, o.canon)
        if (s !== null) out.push(s)
      }
      continue
    }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { continue }
    if (!Array.isArray(parsed)) continue
    for (const a of parsed) {
      if (typeof a !== 'object' || a === null) continue
      const s = artifactRecordOutcome(
        a as Record<string, unknown>, o.hashOf, o.base, o.artifactVersion,
      )
      if (s !== null) out.push(s)
    }
  }
  return out
}
