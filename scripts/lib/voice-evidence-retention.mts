/** Retention and erasure for supplemental voice-evidence JSONL files. */
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { VOICE_EVIDENCE_RETENTION_DAYS, VOICE_EVIDENCE_SUFFIX } from './voice-evidence-capture.mjs'

export const VOICE_EVIDENCE_FILE = /^navercafe-voice-[a-z0-9_-]+-.+\.voice-evidence\.jsonl$/i

export type PurgeFilePlan = {
  file: string
  lines: number
  malformed: number
  expired: number
  requested: number
  keep: number
  action: 'keep' | 'rewrite' | 'delete'
}

export type PurgeResult = {
  executed: boolean
  files: PurgeFilePlan[]
  totals: {
    files: number
    lines: number
    malformed: number
    expired: number
    requested: number
    deletedFiles: number
    rewrittenFiles: number
  }
}

export function purgeVoiceEvidence(input: {
  dataDir: string
  now: Date
  execute: boolean
  speakerHashes?: readonly string[]
  retentionDays?: number
}): PurgeResult {
  const cutoff = input.now.getTime() - (input.retentionDays ?? VOICE_EVIDENCE_RETENTION_DAYS) * 86_400_000
  const requested = new Set(input.speakerHashes ?? [])
  const files: PurgeFilePlan[] = []
  let deletedFiles = 0
  let rewrittenFiles = 0

  const names = (existsSync(input.dataDir) ? readdirSync(input.dataDir) : [])
    .filter((name) => name.endsWith(VOICE_EVIDENCE_SUFFIX) && VOICE_EVIDENCE_FILE.test(name))
    .sort()
  for (const name of names) {
    const path = join(input.dataDir, name)
    const stat = lstatSync(path)
    if (!stat.isFile()) continue
    const raw = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '')
    let expired = 0
    let malformed = 0
    let erased = 0
    const keep: string[] = []
    for (const line of raw) {
      let capturedAt = Number.NaN
      let speakerHash: unknown = null
      try {
        const parsed = JSON.parse(line) as { capturedAt?: unknown; speakerHash?: unknown }
        capturedAt = typeof parsed.capturedAt === 'string' ? Date.parse(parsed.capturedAt) : Number.NaN
        speakerHash = parsed.speakerHash
      } catch { /* handled below */ }
      if (Number.isNaN(capturedAt)) { malformed += 1; continue }
      if (capturedAt < cutoff) { expired += 1; continue }
      if (typeof speakerHash === 'string' && requested.has(speakerHash)) { erased += 1; continue }
      keep.push(line)
    }
    const action: PurgeFilePlan['action'] = keep.length === 0
      ? 'delete'
      : keep.length < raw.length ? 'rewrite' : 'keep'
    files.push({ file: name, lines: raw.length, malformed, expired, requested: erased, keep: keep.length, action })
    if (!input.execute || action === 'keep') continue
    if (action === 'delete') {
      unlinkSync(path)
      deletedFiles += 1
    } else {
      const temporary = `${path}.tmp-${process.pid}`
      writeFileSync(temporary, keep.map((line) => `${line}\n`).join(''), { encoding: 'utf8', mode: 0o600 })
      renameSync(temporary, path)
      rewrittenFiles += 1
    }
  }
  const sum = (key: 'lines' | 'malformed' | 'expired' | 'requested'): number =>
    files.reduce((total, file) => total + file[key], 0)
  return {
    executed: input.execute,
    files,
    totals: {
      files: files.length,
      lines: sum('lines'),
      malformed: sum('malformed'),
      expired: sum('expired'),
      requested: sum('requested'),
      deletedFiles,
      rewrittenFiles,
    },
  }
}
