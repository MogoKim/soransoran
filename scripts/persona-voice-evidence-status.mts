#!/usr/bin/env tsx
/** Production evidence inventory. Read-only: DB read, file read, network 0, provider 0. */
import { loadNameCollisionSets } from './lib/persona-name-collision-sets.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readEvidenceSalt, voiceEvidenceDataDir } from './lib/voice-evidence-capture.mjs'
import { readVoiceEvidenceStatus } from './lib/voice-evidence-status.mjs'

const argv = process.argv.slice(2)
const arg = (name: string): string | null => {
  const found = argv.find((value) => value.startsWith(`--${name}=`))
  return found === undefined ? null : found.slice(name.length + 3)
}
if (argv.some((value) => value === '--apply' || value === '--execute' || value === '--write')) {
  console.error('\nThis command is read-only.\n')
  process.exit(2)
}
if (!argv.includes('--db')) {
  console.error('\n--db is required so real member and Persona names can be excluded fail-closed.\n')
  process.exit(2)
}

await loadEnvLocal()
const salt = readEvidenceSalt(process.env)
if (!salt.ok) {
  console.error(`\nVoice evidence is OFF: ${salt.code}. DB connection 0.\n`)
  process.exit(2)
}
const dataDir = arg('data-dir')
  ?? voiceEvidenceDataDir()
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
try {
  const members = await loadNameCollisionSets(prisma)
  if (members.memberNames === undefined) {
    console.error('\nMember comparison set is unavailable. Evidence remains unusable.\n')
    process.exitCode = 2
  } else {
    const status = readVoiceEvidenceStatus({
      dataDir, salt,
      members: { memberNames: members.memberNames, personaNames: members.personaNames },
      now: new Date(),
    })
    const drops = Object.entries(status.dropped).filter(([, count]) => count > 0)
      .map(([code, count]) => `${code} ${count}`).join(' / ')
    console.log('\nPersona voice evidence - read-only')
    console.log(`files ${status.files} / insecure ${status.insecureFiles} / lines ${status.lines} / usable ${status.usableRows}`)
    console.log(`speakers ${status.speakers} / eligible ${status.eligible} / near-miss ${status.nearMiss}`)
    console.log(`dropped ${drops === '' ? '0' : drops}`)
    console.log('DB write 0 / file write 0 / provider 0')
  }
} finally {
  await prisma.$disconnect()
}
