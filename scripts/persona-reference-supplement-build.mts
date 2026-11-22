#!/usr/bin/env tsx
/**
 * Freeze append-only voice bundles for the next Persona cohort.
 *
 * Default is read-only. Apply writes only the deploy-independent 0600 snapshot;
 * it never writes the DB, calls a provider, creates a Persona, or changes stage.
 *
 * Generation is not a literal here: it writes the latest generation this code
 * knows (`SUPPLEMENT_LATEST_GENERATION`) and freezes the one right before it.
 * The default fixture is the approved fixture of the single runnable cohort.
 * `--evidence-until=<ISO>` bounds the evidence exactly like `persona:expansion`.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

import { checkCohortKeys, COHORT_EXPANSION_FIXTURES, COHORTS, RUNNABLE_COHORTS } from '../src/lib/persona-cohort'
import {
  activeSupplementPaths, previousSupplementGeneration, SUPPLEMENT_LATEST_GENERATION,
} from '../src/lib/persona-reference-supplement'
import { loadExpansionFixture } from './lib/persona-expansion-gate.mjs'
import { readExpansionFacts } from './lib/persona-expansion-facts.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { fillDbConnection, readEnvKeys } from './lib/ops-signals.mjs'
import {
  parseEvidenceUntil, readEvidenceSalt, VOICE_EVIDENCE_SALT_ENV, voiceEvidenceDataDir,
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
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const NOW = new Date()

if (!has('--db')) fail('--db 가 필요하다 — 정확한 회원·Persona 제외 집합 없이 증거를 고정하지 않는다', 2)

/** 🔴 쓰는 세대 = 이 코드가 아는 마지막 세대 · 동결 입력 = 그 직전 세대(append-only) */
const WRITE_GENERATION = SUPPLEMENT_LATEST_GENERATION
const FROZEN_GENERATION = previousSupplementGeneration(WRITE_GENERATION)
  ?? fail(`v${WRITE_GENERATION} 앞에 동결 세대가 없다 — 첫 세대는 이 도구로 쓰지 않는다`, 2)
const until = parseEvidenceUntil(arg('evidence-until'), NOW)
const EVIDENCE_UNTIL = until.ok ? until : fail(until.reason, 2)
/** 🔴 기본 fixture — 승인 fixture 가 등록된 runnable cohort 가 정확히 하나일 때 그 fixture 다 */
const registeredFixtures = RUNNABLE_COHORTS.flatMap((id) => {
  const approved = COHORT_EXPANSION_FIXTURES[id]
  return approved === undefined ? [] : [{ id, ...approved }]
})
const DEFAULT_FIXTURE = registeredFixtures.length === 1 ? registeredFixtures[0]! : null
const FIXTURE = FIXTURE_ARG ?? DEFAULT_FIXTURE?.path
  ?? fail('--fixture=<path> 가 필요하다 — 승인 fixture 가 등록된 runnable cohort 가 하나가 아니다', 2)

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
  if (DEFAULT_FIXTURE === null) problems.push('운영 apply 는 승인 fixture 가 등록된 runnable cohort 하나가 있어야 한다')
  else {
    let digest: string | null = null
    try { digest = createHash('sha256').update(readFileSync(join(process.cwd(), DEFAULT_FIXTURE.path), 'utf-8')).digest('hex') }
    catch { digest = null }
    if (digest !== DEFAULT_FIXTURE.sha256) problems.push(`승인 fixture ${DEFAULT_FIXTURE.path} digest 가 등록값과 다르다`)
  }
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
// 읽기 전용 plan도 운영 확장 판정과 같은 canonical DB를 본다. 셸에 DB 주소가
// 없다는 이유로 plan만 실패하거나, 반대로 임의 셸 주소를 권위로 삼지 않는다.
if (!fillDbConnection()) fail('canonical env 에 DATABASE_URL 이 없다 — 보충 말투 plan 을 시작하지 않는다')
const salt = readEvidenceSalt({ ...process.env, ...readEnvKeys([VOICE_EVIDENCE_SALT_ENV]).values })
const validSalt = salt.ok ? salt : fail(`voice evidence salt: ${salt.code}`)
const canon = loadCanonAsset()
if (!canon.ok) fail(`canonical reference: ${canon.code}`)
const canonDigest = canon.sourceDigest ?? fail('canonical reference digest 가 없다')
const frozen = readSupplementSnapshot({
  baseSourceDigest: canonDigest,
  generation: FROZEN_GENERATION,
  baseAssignmentDigestFor: (codes) => {
    const base = planBundles({ rows: canon.rows, personaCodes: codes })
    return assignmentDigest(new Map(base.bundles.map((bundle) => [bundle.personaCode, bundle])), codes)
  },
})
const validFrozen = frozen.ok ? frozen : fail(`동결 v${FROZEN_GENERATION} supplement: ${frozen.code}`)
const fixture = loadExpansionFixture(process.cwd(), FIXTURE)
const validFixture = fixture.ok ? fixture.fixture : fail(`fixture: ${fixture.problems.join(' / ')}`)
const newCodes = validFixture.candidates.map((candidate) => candidate.code)
if (APPLY && DEFAULT_FIXTURE !== null) {
  // 🔴 운영 apply 의 새 묶음은 정확히 runnable cohort 전원이다 — 한 명이라도 다르면 쓰지 않는다
  if (validFixture.cohort !== DEFAULT_FIXTURE.id) fail(`fixture cohort ${validFixture.cohort} ≠ runnable ${DEFAULT_FIXTURE.id}`)
  const scope = checkCohortKeys(COHORTS[DEFAULT_FIXTURE.id], newCodes)
  if (scope.length > 0) fail(`fixture 범위가 runnable cohort 와 다르다 — ${scope.join(' / ')}`)
}

const prisma = new PrismaClient()
let evidence: ReturnType<typeof readUsableVoiceEvidence>
try {
  const facts = await readExpansionFacts(prisma, { now: new Date(), repoRoot: process.cwd() })
  const members = facts.nameSets.memberNames ?? fail('회원 이름 대조 집합을 읽지 못했다')
  evidence = readUsableVoiceEvidence({
    dataDir: EVIDENCE_DIR_ARG ?? voiceEvidenceDataDir(),
    salt: validSalt,
    members: { memberNames: members, personaNames: facts.nameSets.personaNames ?? [] },
    now: NOW,
    until: EVIDENCE_UNTIL.until,
  })
} finally {
  await prisma.$disconnect()
}

if (evidence.status.insecureFiles > 0) fail(`권한이 느슨한 evidence 파일 ${evidence.status.insecureFiles}개`)
const generatedAt = new Date().toISOString()
const reasonText = REASON === '' ? 'dry-run' : REASON
const plan = planSupplementSnapshot({
  canonRows: canon.rows,
  extraRows: evidence.rows,
  baseCodes: validFrozen.asset.baseCodes,
  newCodes,
  frozenBundles: validFrozen.asset.bundles,
  baseSourceDigest: canonDigest,
  saltId: validSalt.saltId,
  generatedAt,
  // 🔴 manifest 사유에 상한을 남긴다 — 어떤 근거 창으로 묶음을 고정했는지가 기록에 남는다
  reason: EVIDENCE_UNTIL.iso === null ? reasonText : `${reasonText} · evidence-until=${EVIDENCE_UNTIL.iso}`,
  ...(EVIDENCE_UNTIL.iso === null ? {} : { evidenceUntil: EVIDENCE_UNTIL.iso }),
})

console.log('\nPersona reference supplement - read-only plan')
console.log(`generation active v${activeSupplementPaths().generation} / frozen v${FROZEN_GENERATION} / write v${WRITE_GENERATION}`)
console.log(`fixture ${FIXTURE} (${validFixture.cohort})`)
console.log(`base ${validFrozen.asset.baseCodes.length} / frozen ${validFrozen.asset.bundles.length} / new ${newCodes.length}`)
console.log(`evidence-until ${EVIDENCE_UNTIL.iso ?? '없음 — 지금까지 쌓인 근거 전부'}`)
console.log(`evidence files ${evidence.status.files} / usable ${evidence.status.usableRows} / after-until ${evidence.status.dropped.AFTER_EVIDENCE_UNTIL}`)
console.log(`speakers ${evidence.status.speakers} / eligible ${evidence.status.eligible} / near-miss ${evidence.status.nearMiss}`)
console.log(`bundles canon ${plan.fromCanon.length} / supplemental ${plan.fromExtra.length}`)
console.log(`digest ${plan.planDigest}`)
for (const problem of plan.problems) console.log(`BLOCK ${problem}`)

if (!plan.ok) fail(`${newCodes.length}명 전원의 안정 묶음이 서지 않았다`)
if (!APPLY) {
  console.log('DB write 0 / file write 0 / provider 0 / activation 0')
  console.log('apply requires clean merged main + matching digest + reason')
  process.exit(0)
}
if (APPROVED_DIGEST !== plan.planDigest) fail('승인 digest 가 지금 계획과 다르다')
const written = writeSupplementSnapshot({ assetText: plan.assetText, manifestText: plan.manifestText, generation: WRITE_GENERATION })
const completedWrite = written.ok ? written : fail(written.reason)
const verified = readSupplementSnapshot({
  baseSourceDigest: canonDigest,
  generation: WRITE_GENERATION,
  baseAssignmentDigestFor: (codes) => {
    const base = planBundles({ rows: canon.rows, personaCodes: codes })
    return assignmentDigest(new Map(base.bundles.map((bundle) => [bundle.personaCode, bundle])), codes)
  },
})
const completedRead = verified.ok ? verified : fail(`기록 후 검증 실패 ${verified.code}`)
console.log(`SNAPSHOT_${completedWrite.action.toUpperCase()} generation=v${WRITE_GENERATION} bundles=${completedRead.byCode.size} saltId=${completedRead.manifest.saltId}`)
console.log('DB write 0 / provider 0 / activation 0')
