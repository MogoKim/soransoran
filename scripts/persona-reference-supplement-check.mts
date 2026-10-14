#!/usr/bin/env tsx
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'persona-reference-supplement-'))
process.env.HOME = home

const {
  SUPPLEMENT_CORPUS_FILE, SUPPLEMENT_MANIFEST_FILE, judgeSupplementAsset,
  supplementFallbackPartition,
} = await import('../src/lib/persona-reference-supplement')
const { planSupplementSnapshot } = await import('./lib/persona-reference-supplement-plan.mjs')
const {
  assignmentDigest, mergeSupplementAssignment, readSupplementSnapshot, selectFrozenSupplementBundle,
  writeSupplementSnapshot,
} = await import('./lib/persona-reference-supplement-store.mjs')
const { planBundles } = await import('./lib/persona-reference-store.mjs')
type LocalComment = import('./lib/persona-reference-store.mjs').LocalComment

let pass = 0
let fail = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1; console.log(`  PASS ${name}`) }
  else { fail += 1; console.error(`  FAIL ${name}`) }
}
const rows = (prefix: string, speakers: number): LocalComment[] =>
  Array.from({ length: speakers }, (_, speaker) =>
    Array.from({ length: 3 }, (_, index) => ({
      speakerId: `${prefix}${String(speaker).padStart(3, '0')}`,
      text: `${prefix} 의견 ${speaker}-${index} 정말 그렇네요 반갑습니다`,
    }))).flat()

try {
  const canon = rows('ca', 2)
  const extra = rows('ex', 2)
  const baseCodes = ['P01', 'P02']
  const newCodes = ['P34', 'P35']
  const sourceDigest = 'a'.repeat(16)
  const plan = planSupplementSnapshot({
    canonRows: canon,
    extraRows: extra,
    baseCodes,
    newCodes,
    baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12),
    generatedAt: '2026-10-15T00:00:00.000Z',
    reason: 'fixture',
  })
  check('two append-only bundles are ready', plan.ok && plan.asset.bundles.length === 2)
  check('base assignment does not drift', plan.problems.every((problem) => !problem.startsWith('BASE_DRIFT')))
  check('new bundles come from supplemental rows', plan.fromExtra.join(',') === newCodes.join(','))
  check('asset has no speaker identifiers or source article data',
    !/speakerId|speakerHash|articleId|source|author|url/i.test(JSON.stringify(plan.asset.bundles)))
  check('asset shape passes', judgeSupplementAsset(plan.asset).ok)

  const base = planBundles({ rows: canon, personaCodes: baseCodes })
  const baseBy = new Map(base.bundles.map((bundle) => [bundle.personaCode, bundle]))
  const baseDigest = assignmentDigest(baseBy, baseCodes)
  const merged = mergeSupplementAssignment({
    productionCodes: [...baseCodes, ...newCodes],
    baseCodes,
    baseBundles: base.bundles,
    supplementByCode: new Map(plan.asset.bundles.map((bundle) => [bundle.personaCode, bundle])),
  })
  check('runtime overlay covers base and new codes', merged.byCode.size === 4 && merged.missing.length === 0)
  check('runtime overlay preserves base bundle bytes',
    assignmentDigest(merged.byCode, baseCodes) === baseDigest)
  const plannedReplacement = planBundles({ rows: rows('planned', 1), personaCodes: ['P34'] }).bundles[0]!
  const frozenP34 = plan.asset.bundles[0]!
  check('card generation selects the frozen bundle over a newly planned replacement',
    selectFrozenSupplementBundle({
      personaCode: 'P34',
      frozenByCode: new Map([['P34', frozenP34]]),
      plannedByCode: new Map([['P34', plannedReplacement]]),
    }) === frozenP34)
  check('card generation falls back to a planned bundle before any snapshot exists',
    selectFrozenSupplementBundle({
      personaCode: 'P34',
      frozenByCode: new Map(),
      plannedByCode: new Map([['P34', plannedReplacement]]),
    }) === plannedReplacement)
  const missingOverlay = mergeSupplementAssignment({
    productionCodes: [...baseCodes, ...newCodes, 'P36'],
    baseCodes,
    baseBundles: base.bundles,
    supplementByCode: new Map(plan.asset.bundles.map((bundle) => [bundle.personaCode, bundle])),
  })
  check('runtime overlay fails closed for an uncovered production code', missingOverlay.missing.join(',') === 'P36')
  const fallback = supplementFallbackPartition([...baseCodes, ...newCodes], baseCodes.length)
  const fallbackBase = planBundles({ rows: canon, personaCodes: fallback.baseCodes })
  check('missing or invalid snapshot preserves legacy bundle bytes',
    assignmentDigest(new Map(fallbackBase.bundles.map((bundle) => [bundle.personaCode, bundle])), baseCodes) === baseDigest)
  check('missing or invalid snapshot fails closed for every appended code',
    fallback.missingCodes.join(',') === newCodes.join(','))
  const read = (): ReturnType<typeof readSupplementSnapshot> => readSupplementSnapshot({
    baseSourceDigest: sourceDigest,
    baseAssignmentDigestFor: () => baseDigest,
  })

  const first = writeSupplementSnapshot({ assetText: plan.assetText, manifestText: plan.manifestText })
  check('first write succeeds', first.ok && first.action === 'write')
  check('files are mode 0600',
    (await import('node:fs')).statSync(SUPPLEMENT_CORPUS_FILE).mode % 0o1000 === 0o600
    && (await import('node:fs')).statSync(SUPPLEMENT_MANIFEST_FILE).mode % 0o1000 === 0o600)
  const loaded = read()
  check('written snapshot verifies', loaded.ok && loaded.byCode.size === 2)
  const again = writeSupplementSnapshot({ assetText: plan.assetText, manifestText: plan.manifestText })
  check('same snapshot is idempotent', again.ok && again.action === 'noop')

  const changed = planSupplementSnapshot({
    canonRows: canon,
    extraRows: extra.map((row, index) => index === 0 ? { ...row, text: `${row.text} 수정` } : row),
    baseCodes,
    newCodes,
    baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12),
    generatedAt: '2026-10-15T01:00:00.000Z',
    reason: 'changed',
  })
  const conflict = writeSupplementSnapshot({ assetText: changed.assetText, manifestText: changed.manifestText })
  check('different snapshot never overwrites', !conflict.ok)
  const auditOnly = planSupplementSnapshot({
    canonRows: canon,
    extraRows: extra,
    baseCodes,
    newCodes,
    baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12),
    generatedAt: '2026-10-16T01:00:00.000Z',
    reason: 'different audit text',
  })
  check('approval digest ignores audit time and reason', auditOnly.planDigest === plan.planDigest)
  check('semantic evidence change changes approval digest', changed.planDigest !== plan.planDigest)

  check('wrong base source fails closed', !readSupplementSnapshot({
    baseSourceDigest: 'c'.repeat(16), baseAssignmentDigestFor: () => baseDigest,
  }).ok)
  check('wrong base assignment fails closed', !readSupplementSnapshot({
    baseSourceDigest: sourceDigest, baseAssignmentDigestFor: () => 'd'.repeat(64),
  }).ok)

  const assetOriginal = readFileSync(SUPPLEMENT_CORPUS_FILE, 'utf8')
  writeFileSync(SUPPLEMENT_CORPUS_FILE, `${assetOriginal} `, 'utf8')
  check('asset digest tamper fails closed', !read().ok)
  writeFileSync(SUPPLEMENT_CORPUS_FILE, assetOriginal, 'utf8')
  chmodSync(SUPPLEMENT_CORPUS_FILE, 0o644)
  check('too-open snapshot fails closed', !read().ok)
  chmodSync(SUPPLEMENT_CORPUS_FILE, 0o600)

  const overlap = { ...plan.asset, baseCodes: ['P01', 'P34'] }
  check('base/new code overlap rejected', !judgeSupplementAsset(overlap).ok)
  const malformed = { ...plan.asset, bundles: [{ ...plan.asset.bundles[0], anchorRatio: 0.5 }] }
  check('non-single-speaker bundle rejected', !judgeSupplementAsset(malformed).ok)
  const duplicateBundle = {
    ...plan.asset,
    bundles: [plan.asset.bundles[0]!, { ...plan.asset.bundles[0]!, personaCode: 'P35' }],
  }
  check('same frozen bundle cannot represent two Persona codes', !judgeSupplementAsset(duplicateBundle).ok)
  const leakedField = {
    ...plan.asset,
    bundles: [{ ...plan.asset.bundles[0], author: 'must-not-exist' }],
  }
  check('unknown identity-shaped field rejected', !judgeSupplementAsset(leakedField).ok)

  const cli = readFileSync(join(process.cwd(), 'scripts/persona-reference-supplement-build.mts'), 'utf8')
  check('production apply reads canonical DB addresses',
    /readEnvKeys\(\['DATABASE_URL', 'DIRECT_URL'\]\)/.test(cli))
  check('production apply discards shell DB addresses',
    /process\.env\.DATABASE_URL = canonical\.databaseUrl/.test(cli)
    && /process\.env\.DIRECT_URL = canonical\.directUrl/.test(cli))
  check('production apply rejects fixture and evidence directory overrides',
    /FIXTURE_ARG !== null/.test(cli) && /EVIDENCE_DIR_ARG !== null/.test(cli))
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(`\npersona-reference-supplement-check: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
