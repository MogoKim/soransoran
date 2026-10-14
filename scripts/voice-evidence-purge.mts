#!/usr/bin/env tsx
/** Dry-run by default. Add --execute to apply retention or an erasure request. */
import { purgeVoiceEvidence } from './lib/voice-evidence-retention.mjs'
import { voiceEvidenceDataDir } from './lib/voice-evidence-capture.mjs'

const argv = process.argv.slice(2)
const values = (name: string): string[] => argv
  .filter((value) => value.startsWith(`--${name}=`))
  .map((value) => value.slice(name.length + 3))
const execute = argv.includes('--execute')
const dataDir = values('data-dir')[0]
  ?? voiceEvidenceDataDir()
const speakerHashes = values('speaker-hash')
if (speakerHashes.some((value) => !/^vs1:[0-9a-f]{64}$/.test(value))) {
  console.error('\n--speaker-hash must be vs1:<64 lowercase hex>.\n')
  process.exit(1)
}

const result = purgeVoiceEvidence({ dataDir, now: new Date(), execute, speakerHashes })
console.log(`\nVoice evidence purge - ${execute ? 'execute' : 'dry-run (write 0)'}`)
console.log(`files ${result.totals.files} / lines ${result.totals.lines} / malformed ${result.totals.malformed}`
  + ` / expired ${result.totals.expired} / requested ${result.totals.requested}`)
for (const file of result.files.filter((entry) => entry.action !== 'keep')) {
  console.log(`${file.action} ${file.file} - malformed ${file.malformed} / expired ${file.expired}`
    + ` / requested ${file.requested} / keep ${file.keep}`)
}
if (!execute) console.log('Add --execute to apply this plan.')
