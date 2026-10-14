/** Read-only inventory of supplemental voice evidence. */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { speakerSupply } from './persona-reference-store.mjs'
import type { LocalComment } from './persona-reference-store.mjs'
import {
  EVIDENCE_READ_DROP_CODES, rowsFromVoiceEvidence, VOICE_EVIDENCE_SUFFIX,
  type EvidenceReadDropCode, type EvidenceSalt,
} from './voice-evidence-capture.mjs'
import { VOICE_EVIDENCE_FILE } from './voice-evidence-retention.mjs'

export type VoiceEvidenceStatus = {
  files: number
  insecureFiles: number
  lines: number
  usableRows: number
  speakers: number
  eligible: number
  nearMiss: number
  dropped: Record<EvidenceReadDropCode, number>
}

export function readUsableVoiceEvidence(input: {
  dataDir: string
  salt: EvidenceSalt
  members: { memberNames: readonly string[]; personaNames?: readonly string[] } | null
  now: Date
}): { rows: LocalComment[]; status: VoiceEvidenceStatus } {
  const dropped = Object.fromEntries(EVIDENCE_READ_DROP_CODES.map((code) => [code, 0])) as Record<EvidenceReadDropCode, number>
  const lines: unknown[] = []
  let files = 0
  let insecureFiles = 0
  const names = existsSync(input.dataDir) ? readdirSync(input.dataDir).sort() : []
  for (const name of names) {
    if (!name.endsWith(VOICE_EVIDENCE_SUFFIX) || !VOICE_EVIDENCE_FILE.test(name)) continue
    const path = join(input.dataDir, name)
    const stat = lstatSync(path)
    if (!stat.isFile()) continue
    files += 1
    if ((stat.mode & 0o777) !== 0o600) { insecureFiles += 1; continue }
    for (const line of readFileSync(path, 'utf8').split('\n').filter((value) => value.trim() !== '')) {
      try { lines.push(JSON.parse(line) as unknown) } catch { lines.push(null) }
    }
  }
  const read = rowsFromVoiceEvidence(lines, { salt: input.salt, members: input.members, now: input.now })
  for (const code of EVIDENCE_READ_DROP_CODES) dropped[code] += read.dropped[code]
  const supply = speakerSupply(read.rows.map((row) => ({ speakerId: row.author ?? '', text: row.text })))
  return {
    rows: read.rows.map((row) => ({ speakerId: row.author ?? '', text: row.text })),
    status: {
      files, insecureFiles, lines: lines.length, usableRows: read.rows.length,
      speakers: supply.speakers, eligible: supply.eligible, nearMiss: supply.nearMiss, dropped,
    },
  }
}

export function readVoiceEvidenceStatus(input: {
  dataDir: string
  salt: EvidenceSalt
  members: { memberNames: readonly string[]; personaNames?: readonly string[] } | null
  now: Date
}): VoiceEvidenceStatus {
  return readUsableVoiceEvidence(input).status
}
