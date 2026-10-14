#!/usr/bin/env tsx
/**
 * Freeze append-only voice bundles for the next Persona cohort.
 *
 * Default is read-only. Apply writes only the deploy-independent 0600 snapshot;
 * it never writes the DB, calls a provider, creates a Persona, or changes stage.
 */
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
import { loadExpansionFixture } from './lib/persona-expansion-gate.mjs'
import { readExpansionFacts } from './lib/persona-expansion-facts.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readEnvKeys } from './lib/ops-signals.mjs'
import {
  readEvidenceSalt, voiceEvidenceDataDir,
} from './lib/voice-evidence-capture.mjs'
import { readUsableVoiceEvidence } from './lib/voice-evidence-status.mjs'
import { loadCanonAsset, planBundles } from './lib/persona-reference-store.mjs'
import { planSupplementSnapshot } from './lib/persona-reference-supplement-plan.mjs'
import {
  assignmentDigest, readSupplementSnapshot, writeSupplementSnapshot,
} from './lib/persona-reference-supplement-store.mjs'

const argv = process.argv.slice(2)
const has = (flag: string): boolean => argv.includes(flag)
const arg = (key: string): string | null => {
  const prefix = `--${key}=`
  const found = argv.find((value) => value.startsWith(prefix))
  return found === undefined ? null : found.slice(prefix.length) || null
}
const fail = (message: string, code = 1): never => {
  console.error(`\nREFUSE ${message} — write 0\n`)
  process.exit(code)
}
const APPLY = has('--apply')
const PRODUCTION = has('--production')
const TARGET = arg('target')
const APPROVED_DIGEST = arg('digest')
const REASON = (arg('reason') ?? '').trim()
const FIXTURE_ARG = arg('fixture')
const EVIDENCE_DIR_ARG = arg('voice-evidence-dir')
const FIXTURE = FIXTURE_ARG ?? 'scripts/__fixtures__/persona-expansion-canary.json'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

if (!has('--db')) fail('--db 가 필요하다 — 정확한 회원·Persona 제외 집합 없이 증거를 고정하지 않는다', 2)

function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], {
      cwd: SCRIPT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch { return null }
}

const localDb = (value: string): boolean =>
  /(?:localhost|127\.0\.0\.1|\[::1\]|soran_test)/i.test(value)

function guardProduction(): { databaseUrl: string; directUrl: string } {
  const problems: string[] = []
  if (!PRODUCTION) problems.push('--production 이 필요하다')
  if (TARGET === null || !/^[0-9a-f]{40}$/.test(TARGET)) problems.push('--target=<40자리 SHA> 가 필요하다')
  if (APPROVED_DIGEST === null || !/^[0-9a-f]{64}$/.test(APPROVED_DIGEST)) problems.push('--digest=<64자리> 가 필요하다')
  if (REASON === '') problems.push('--reason=<사유> 가 필요하다')
  if ((process.env.SORAN_ISOLATED_DB ?? '') !== '') problems.push('SORAN_ISOLATED_DB 가 설정돼 있다')
  if (FIXTURE_ARG !== null) problems.push('운영 apply 는 정본 fixture 만 쓴다')
  if (EVIDENCE_DIR_ARG !== null) problems.push('운영 apply 는 정본 evidence 디렉터리만 쓴다')
  const env = readEnvKeys(['DATABASE_URL', 'DIRECT_URL'])
  const databaseUrl = env.values.DATABASE_URL ?? ''
  const directUrl = env.values.DIRECT_URL ?? ''
  if (!env.ok) problems.push(`canonical env 를 읽지 못했다 — ${env.reason ?? '이유 모름'}`)
  if (databaseUrl === '' || directUrl === '') problems.push('canonical DB 주소 두 개가 모두 필요하다')
  if (localDb(databaseUrl) || localDb(directUrl)) problems.push('canonical DB 주소가 로컬·격리 DB 모양이다')
  const fetched = git(['fetch', '-q', 'origin', 'main']) !== null
  const head = git(['rev-parse', 'HEAD'])
  const main = fetched ? git(['rev-parse', 'refs/remotes/origin/main']) : null
  const dirty = git(['status', '--porcelain', '--untracked-files=no'])
  if (!fetched || main === null) problems.push('origin/main 을 fetch 하지 못했다')
  if (head === null) problems.push('HEAD 를 읽지 못했다')
  if (head !== null && main !== null && head !== main) problems.push('HEAD ≠ origin/main')
  if (head !== null && TARGET !== null && head !== TARGET) problems.push('HEAD ≠ target')
  if (dirty === null || dirty !== '') problems.push('tracked 변경이 있거나 상태를 읽지 못했다')
  const toolFiles = [
    'scripts/persona-reference-supplement-build.mts',
    'scripts/lib/persona-reference-supplement-plan.mts',
    'scripts/lib/persona-reference-supplement-store.mts',
    'src/lib/persona-reference-supplement.ts',
  ]
  for (const path of toolFiles) {
    if (git(['cat-file', '-e', `HEAD:${path}`]) === null) problems.push(`${path} 가 HEAD 에 없다`)
  }
  if (problems.length > 0) fail(problems.join(' / '), 2)
  return { databaseUrl, directUrl }
}

if (APPLY) {
  const canonical = guardProduction()
  // Production apply never inherits a shell-provided database target.
  process.env.DATABASE_URL = canonical.databaseUrl
  process.env.DIRECT_URL = canonical.directUrl
}
else if (PRODUCTION || TARGET !== null || APPROVED_DIGEST !== null) {
  fail('--production/--target/--digest 는 --apply 와 함께만 쓴다', 2)
}

await loadEnvLocal()
const salt = readEvidenceSalt(process.env)
const validSalt = salt.ok ? salt : fail(`voice evidence salt: ${salt.code}`)
const canon = loadCanonAsset()
if (!canon.ok) fail(`canonical reference: ${canon.code}`)
const canonDigest = canon.sourceDigest ?? fail('canonical reference digest 가 없다')
const fixture = loadExpansionFixture(process.cwd(), FIXTURE)
const validFixture = fixture.ok ? fixture.fixture : fail(`fixture: ${fixture.problems.join(' / ')}`)
const newCodes = validFixture.candidates.map((candidate) => candidate.code)

const prisma = new PrismaClient()
let evidence: ReturnType<typeof readUsableVoiceEvidence>
try {
  const facts = await readExpansionFacts(prisma, { now: new Date(), repoRoot: process.cwd() })
  const members = facts.nameSets.memberNames ?? fail('회원 이름 대조 집합을 읽지 못했다')
  evidence = readUsableVoiceEvidence({
    dataDir: EVIDENCE_DIR_ARG ?? voiceEvidenceDataDir(),
    salt: validSalt,
    members: { memberNames: members, personaNames: facts.nameSets.personaNames ?? [] },
    now: new Date(),
  })
} finally {
  await prisma.$disconnect()
}

if (evidence.status.insecureFiles > 0) fail(`권한이 느슨한 evidence 파일 ${evidence.status.insecureFiles}개`)
const generatedAt = new Date().toISOString()
const plan = planSupplementSnapshot({
  canonRows: canon.rows,
  extraRows: evidence.rows,
  baseCodes: PRODUCTION_PERSONA_CODES,
  newCodes,
  baseSourceDigest: canonDigest,
  saltId: validSalt.saltId,
  generatedAt,
  reason: REASON === '' ? 'dry-run' : REASON,
})

console.log('\nPersona reference supplement - read-only plan')
console.log(`base ${PRODUCTION_PERSONA_CODES.length} / new ${newCodes.length}`)
console.log(`evidence files ${evidence.status.files} / usable ${evidence.status.usableRows}`)
console.log(`speakers ${evidence.status.speakers} / eligible ${evidence.status.eligible} / near-miss ${evidence.status.nearMiss}`)
console.log(`bundles canon ${plan.fromCanon.length} / supplemental ${plan.fromExtra.length} / missing ${newCodes.length - plan.asset.bundles.length}`)
console.log(`digest ${plan.planDigest}`)
for (const problem of plan.problems) console.log(`BLOCK ${problem}`)

if (!plan.ok) fail('10명 전원의 안정 묶음이 서지 않았다')
if (!APPLY) {
  console.log('DB write 0 / file write 0 / provider 0 / activation 0')
  console.log('apply requires clean merged main + matching digest + reason')
  process.exit(0)
}
if (APPROVED_DIGEST !== plan.planDigest) fail('승인 digest 가 지금 계획과 다르다')
const written = writeSupplementSnapshot({ assetText: plan.assetText, manifestText: plan.manifestText })
const completedWrite = written.ok ? written : fail(written.reason)
const verified = readSupplementSnapshot({
  baseSourceDigest: canonDigest,
  baseAssignmentDigestFor: (codes) => {
    const base = planBundles({ rows: canon.rows, personaCodes: codes })
    return assignmentDigest(new Map(base.bundles.map((bundle) => [bundle.personaCode, bundle])), codes)
  },
})
const completedRead = verified.ok ? verified : fail(`기록 후 검증 실패 ${verified.code}`)
console.log(`SNAPSHOT_${completedWrite.action.toUpperCase()} bundles=${completedRead.byCode.size} saltId=${completedRead.manifest.saltId}`)
console.log('DB write 0 / provider 0 / activation 0')
