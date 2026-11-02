#!/usr/bin/env tsx
/**
 * D100 reliability replay 안전 실행기.
 *
 * characterization 하네스가 HOME 기반 runtime 파일을 잘못 만지더라도 실제 운영 HOME에
 * 닿지 않도록 매 실행마다 빈 임시 HOME을 만들고, 종료 결과와 무관하게 지운다.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalHome = process.env.HOME
const originalReplayHome = process.env.SORAN_D100_RELIABILITY_REPLAY_HOME
const replayHome = mkdtempSync(join(tmpdir(), 'soran-d100-reliability-home-'))

try {
  process.env.HOME = replayHome
  process.env.SORAN_D100_RELIABILITY_REPLAY_HOME = replayHome
  await import('./d100-reliability-replay-check.mjs')
} finally {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome

  if (originalReplayHome === undefined) delete process.env.SORAN_D100_RELIABILITY_REPLAY_HOME
  else process.env.SORAN_D100_RELIABILITY_REPLAY_HOME = originalReplayHome

  rmSync(replayHome, { recursive: true, force: true })
}
