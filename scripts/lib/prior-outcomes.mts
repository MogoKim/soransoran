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
  artifactRecordOutcome, attributeRuns, runWindowOf, shadowRecordOutcome, worksetFileName, WORKSET_KIND,
  type PriorOutcome, type RunWindow, type WorksetCanon,
} from '../../src/lib/supply-workset'

/** 🔴 manifest 를 **찾는** 접두 — 회차는 안의 칸에서 읽는다 */
const WORKSET_FILE_PREFIX = worksetFileName('').replace(/\.json$/, '')
import type { ContractBase } from '../../src/lib/content-core/pipeline'
import { RUN_FILE_RE } from '../../src/lib/supply-process'

/** 🔴 생성 결과 파일 이름 — 판정 파일과 달리 접두사까지 정해져 있다 */
const ARTIFACT_FILE = /^auto-draft-.*\.artifacts\.json$/

export type PriorOutcomeRead = {
  dataDir: string
  /** 🔴 **이번 회차 대상 원천의 지금 입력 지문.** 여기 없는 id 는 보지 않는다 */
  hashOf: ReadonlyMap<string, string>
  /**
   * 🔴 **판정 canon — 없으면 판정 파일을 아예 읽지 않는다** (2026-09-23).
   *    생성 러너는 "지난 회차가 누구로 실패했나" 만 필요하고 그것은 artifact 에만 있다.
   *    canon 을 아무 값으로나 채워 넣으면 그 값이 맞는 척하는 기록이 된다.
   */
  canon?: WorksetCanon
  base: ContractBase
  artifactVersion: string
}

/**
 * 🔴 **공급 러너의 회차 기록 → 구간** (2026-09-28). 옛 판정 기록에 회차를 붙이는 근거다.
 *    기록 **안의 칸**(`runId`·`startedAt`·단계 구간)만 읽는다 — 파일 이름에서 회차를 읽지 않는다.
 *    못 읽는 기록은 건너뛴다 — 그 회차의 옛 판정은 자기 시각으로 남는다(앞판과 같다).
 */
export function readRunWindows(dataDir: string): RunWindow[] {
  let names: string[]
  try { names = readdirSync(dataDir) } catch { return [] }
  const readJson = (f: string): unknown => {
    try { return JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) } catch { return null }
  }
  /** 🔴 manifest 는 **안의 `runId` 칸**으로 묶는다 — 이름으로 짝짓지 않는다 */
  const manifests = new Map<string, unknown>()
  for (const f of names) {
    if (!f.startsWith(WORKSET_FILE_PREFIX) || !f.endsWith('.json')) continue
    const m = readJson(f)
    if (m === null || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    if (o.kind !== WORKSET_KIND || typeof o.runId !== 'string') continue
    manifests.set(o.runId, m)
  }
  const out: RunWindow[] = []
  for (const f of names) {
    if (!RUN_FILE_RE.test(f)) continue
    const raw = readJson(f)
    const runId = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).runId : undefined
    const w = runWindowOf(raw, typeof runId === 'string' ? manifests.get(runId) : undefined)
    if (w !== null) out.push(w)
  }
  return out
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
      const canon = o.canon
      // 🔴 canon 을 주지 않은 호출은 판정 결론을 보지 않겠다는 뜻이다
      if (canon === undefined) continue
      for (const line of raw.split('\n')) {
        if (line.trim() === '') continue
        let row: unknown
        try { row = JSON.parse(line) } catch { continue }
        if (typeof row !== 'object' || row === null) continue
        const s = shadowRecordOutcome(row as Record<string, unknown>, o.hashOf, canon)
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
  /**
   * 🔴 **같은 회차 안의 순서는 단계 순서다** (2026-09-28). 회차 칸이 없는 옛 판정 기록은
   *    회차 기록의 판정 구간으로 회차를 찾는다 — 그래야 같은 회차의 생성 결과가 판정에 가려지지 않는다.
   */
  return attributeRuns(out, readRunWindows(o.dataDir))
}
