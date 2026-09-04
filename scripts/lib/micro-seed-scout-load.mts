/**
 * scout JSONL 로더 — 🔴 **읽기 전용. 파일을 만들지도 고치지도 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-M
 *
 * 🔴 **이 모듈이 하지 않는 것**
 *    쓰기 · 네트워크 · 브라우저 · DB · Prisma · Sheet · LLM.
 *    `node:fs` 의 **읽기 함수만** 쓴다.
 *
 * 🔴 **legacy 제외 규칙을 여기 한 곳에 둔다.**
 *    `sourceRunId` 가 없는 PR-S2-b-8 이전 산출물에는 제외 판정도 메타도 없다.
 *    섞으면 백분위 · 비율 · 레인 분포가 통째로 거짓이 된다.
 *    다만 **조용히 버리지 않는다** — 몇 행 몇 파일을 뺐는지 호출자에게 돌려준다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ScoutRow } from './micro-seed-scout-score.mjs'

export const SCOUT_DATA_DIR = './.microseed-data'

export type LoadedFile = {
  file: string
  rows: ScoutRow[]
  /** 이 파일에서 sourceRunId 가 없어 뺀 행 수 */
  skippedLegacy: number
}

export type LoadResult = {
  loaded: LoadedFile[]
  /** 전체에서 legacy 로 뺀 행 수 */
  legacyRows: number
  /** 통째로 legacy 여서 아예 빠진 파일 */
  legacyFiles: string[]
}

/** 🔴 `sourceRunId` 를 가진 행만 유효 표본이다 */
export function hasRunId(row: ScoutRow): boolean {
  return typeof row.sourceRunId === 'string' && row.sourceRunId !== ''
}

export function parseJsonl(text: string): ScoutRow[] {
  return text
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as ScoutRow)
}

/**
 * `.microseed-data` 의 `*.list.jsonl` 을 읽는다.
 * @param onlyRun 특정 sourceRunId 만 볼 때. null 이면 전부.
 */
export function loadScoutRows(dir: string = SCOUT_DATA_DIR, onlyRun: string | null = null): LoadResult {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.list.jsonl'))
    .sort()

  const loaded: LoadedFile[] = []
  const legacyFiles: string[] = []
  let legacyRows = 0

  for (const f of files) {
    const all = parseJsonl(readFileSync(join(dir, f), 'utf-8'))
    const withRun = all.filter(hasRunId)
    const skipped = all.length - withRun.length
    legacyRows += skipped
    if (withRun.length === 0) {
      legacyFiles.push(f)
      continue
    }
    const rows = onlyRun === null ? withRun : withRun.filter((r) => r.sourceRunId === onlyRun)
    if (rows.length) loaded.push({ file: f, rows, skippedLegacy: skipped })
  }
  return { loaded, legacyRows, legacyFiles }
}
