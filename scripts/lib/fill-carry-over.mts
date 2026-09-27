/**
 * 🔴 **이월 판정의 입력을 디스크에서 읽는다** (2026-09-27) — 판정은 `src/lib/supply-fill-retry` 가 한다.
 *
 *    읽는 것  `.microseed-data` 의 `auto-draft-<runId>.candidates.json` (봉투 · 후보 수만)
 *             `supply-process-<runId>.run.json` (단계 상태 · 적재 기록만)
 *    쓰는 것  없다. 네트워크 0 · DB 0.
 *
 * 🔴 **기한 밖 파일은 열지 않는다.** 이름의 회차 시각으로 먼저 거른다 — 후보 파일은 쌓이기만 하므로
 *    매 회차 전부 열면 회차가 갈수록 느려진다. 기한 밖은 `STALE` 로만 센다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CARRY_OVER_LOOKBACK_MS, candidatesRunIdOf, runIdTimeMs, selectCarryOver,
  type CarryCandidateFile, type CarryRunRecord,
} from '../../src/lib/supply-fill-retry'
import { RUN_FILE_RE } from '../../src/lib/supply-process'
import type { Envelope } from '../../src/lib/micro-seed-supply-autofill'

const RUN_ID_OF_RUN_FILE = /^supply-process-(\d{8}-\d{6})\.run\.json$/

function inWindow(runId: string | null, nowMs: number, lookbackMs: number): boolean {
  if (runId === null) return false
  const t = runIdTimeMs(runId)
  return t !== null && t <= nowMs && nowMs - t <= lookbackMs
}

/** 기한 안의 후보 파일과 회차 기록을 읽는다 — 🔴 못 읽는 파일은 `envelope: null` 로 남긴다(지우지 않는다) */
export function readCarryOverState(dataDir: string, nowMs: number, lookbackMs: number = CARRY_OVER_LOOKBACK_MS): {
  files: CarryCandidateFile[]
  runs: CarryRunRecord[]
  staleNames: string[]
} {
  if (!existsSync(dataDir)) return { files: [], runs: [], staleNames: [] }
  const names = readdirSync(dataDir).sort()
  const files: CarryCandidateFile[] = []
  const staleNames: string[] = []
  for (const name of names) {
    const rid = candidatesRunIdOf(name)
    if (rid === null) continue
    if (!inWindow(rid, nowMs, lookbackMs)) { staleNames.push(name); continue }
    try {
      const j = JSON.parse(readFileSync(join(dataDir, name), 'utf-8')) as Record<string, unknown>
      const envelope: Envelope = {
        provenance: typeof j.provenance === 'string' ? j.provenance : undefined,
        ruleVersion: typeof j.ruleVersion === 'string' ? j.ruleVersion : undefined,
        promptVersion: typeof j.promptVersion === 'string' ? j.promptVersion : undefined,
        pipelineVersion: typeof j.pipelineVersion === 'string' ? j.pipelineVersion : undefined,
        stageModels: j.stageModels,
        qualityContractDigest: typeof j.qualityContractDigest === 'string' ? j.qualityContractDigest : undefined,
      }
      files.push({ name, envelope, candidateCount: Array.isArray(j.candidates) ? j.candidates.length : 0 })
    } catch {
      files.push({ name, envelope: null, candidateCount: 0 })
    }
  }
  const runs: CarryRunRecord[] = []
  for (const name of names) {
    if (!RUN_FILE_RE.test(name)) continue
    const m = RUN_ID_OF_RUN_FILE.exec(name)
    if (m === null || !inWindow(m[1]!, nowMs, lookbackMs)) continue
    try {
      const j = JSON.parse(readFileSync(join(dataDir, name), 'utf-8')) as CarryRunRecord
      if (typeof j.runId !== 'string' || !Array.isArray(j.stages)) continue
      runs.push({ runId: j.runId, stages: j.stages, ...(j.fill === undefined ? {} : { fill: j.fill }) })
    } catch { /* 못 읽는 기록은 증거가 아니다 — 그 회차 파일은 NO_RUN 으로 남는다 */ }
  }
  return { files, runs, staleNames }
}

/** 읽고 고른다 — 러너와 검사가 **같은 함수**를 부른다 */
export function planCarryOver(input: {
  dataDir: string; currentRunId: string; nowMs: number; lookbackMs?: number; maxFiles?: number
}): ReturnType<typeof selectCarryOver> & { staleCount: number } {
  const lookbackMs = input.lookbackMs ?? CARRY_OVER_LOOKBACK_MS
  const st = readCarryOverState(input.dataDir, input.nowMs, lookbackMs)
  const sel = selectCarryOver({
    files: st.files, runs: st.runs, currentRunId: input.currentRunId, nowMs: input.nowMs,
    lookbackMs, ...(input.maxFiles === undefined ? {} : { maxFiles: input.maxFiles }),
  })
  return { ...sel, staleCount: st.staleNames.length }
}
