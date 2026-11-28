#!/usr/bin/env tsx
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'persona-reference-supplement-'))
process.env.HOME = home

const {
  SUPPLEMENT_GENERATIONS, SUPPLEMENT_LATEST_GENERATION, activeSupplementPaths, judgeSupplementAsset,
  previousSupplementGeneration, supplementFallbackPartition, supplementPaths,
} = await import('../src/lib/persona-reference-supplement')
const SUPPLEMENT_CORPUS_FILE = supplementPaths(1).corpus
const SUPPLEMENT_MANIFEST_FILE = supplementPaths(1).manifest
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

  const first = writeSupplementSnapshot({ assetText: plan.assetText, manifestText: plan.manifestText, generation: 1 })
  check('first write succeeds', first.ok && first.action === 'write')
  check('files are mode 0600',
    (await import('node:fs')).statSync(SUPPLEMENT_CORPUS_FILE).mode % 0o1000 === 0o600
    && (await import('node:fs')).statSync(SUPPLEMENT_MANIFEST_FILE).mode % 0o1000 === 0o600)
  const loaded = read()
  check('written snapshot verifies', loaded.ok && loaded.byCode.size === 2)
  const again = writeSupplementSnapshot({ assetText: plan.assetText, manifestText: plan.manifestText, generation: 1 })
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
  const conflict = writeSupplementSnapshot({ assetText: changed.assetText, manifestText: changed.manifestText, generation: 1 })
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
  const bounded = (evidenceUntil: string | undefined, generatedAt: string) => planSupplementSnapshot({
    canonRows: canon, extraRows: extra, baseCodes, newCodes, baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12), generatedAt, reason: 'bounded', ...(evidenceUntil === undefined ? {} : { evidenceUntil }),
  })
  const untilDay = bounded('2026-11-23T03:00:00.000Z', '2026-11-23T04:00:00.000Z')
  const untilNight = bounded('2026-11-23T03:00:00.000Z', '2026-11-23T15:00:00.000Z')
  check('same evidence upper bound keeps the approval digest across day and night runs',
    untilDay.planDigest === untilNight.planDigest)
  check('evidence upper bound is bound into the approval digest',
    untilDay.planDigest !== plan.planDigest && untilDay.planDigest !== bounded('2026-11-23T05:00:00.000Z', '2026-11-23T04:00:00.000Z').planDigest)
  check('no evidence upper bound keeps the old approval digest shape',
    bounded(undefined, '2026-11-23T04:00:00.000Z').planDigest === plan.planDigest)

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

  const v2 = planSupplementSnapshot({
    canonRows: canon,
    extraRows: rows('v2', 2),
    baseCodes,
    newCodes: ['P36', 'P37'],
    baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12),
    generatedAt: '2026-11-14T00:00:00.000Z',
    reason: 'append generation two',
    frozenBundles: plan.asset.bundles,
  })
  check('v2 plan keeps both frozen v1 bundles and appends both new bundles',
    v2.ok && v2.asset.bundles.map((bundle) => bundle.personaCode).join(',') === 'P34,P35,P36,P37')
  check('v2 plan preserves frozen v1 bundle bytes',
    JSON.stringify(v2.asset.bundles.slice(0, 2)) === JSON.stringify(plan.asset.bundles))
  const sequentialCanon = rows('seq', 4)
  const sequentialV1 = planSupplementSnapshot({
    canonRows: sequentialCanon,
    extraRows: [],
    baseCodes,
    newCodes,
    baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12),
    generatedAt: '2026-11-14T00:00:00.000Z',
    reason: 'sequential generation one',
  })
  const sequentialV2 = planSupplementSnapshot({
    canonRows: sequentialCanon,
    extraRows: rows('seq-extra', 2),
    baseCodes,
    newCodes: ['P36', 'P37'],
    baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12),
    generatedAt: '2026-11-14T01:00:00.000Z',
    reason: 'sequential generation two',
    frozenBundles: sequentialV1.asset.bundles,
  })
  check('next generation allocates after frozen codes instead of reusing their canonical speakers',
    sequentialV1.ok && sequentialV2.ok
    && sequentialV2.problems.every((problem) => !problem.startsWith('FROZEN_BUNDLE_REUSE')))
  const v2Write = writeSupplementSnapshot({
    assetText: v2.assetText,
    manifestText: v2.manifestText,
    generation: 2,
  })
  check('v2 write succeeds without touching v1', v2Write.ok && v2Write.action === 'write')
  check('runtime selects complete v2 over v1', activeSupplementPaths().generation === 2)
  const v2Loaded = read()
  check('active v2 snapshot verifies and covers frozen plus appended bundles',
    v2Loaded.ok && v2Loaded.byCode.size === 4)
  const SUPPLEMENT_MANIFEST_FILE_V2 = supplementPaths(2).manifest
  const v2Manifest = readFileSync(SUPPLEMENT_MANIFEST_FILE_V2, 'utf8')
  rmSync(SUPPLEMENT_MANIFEST_FILE_V2)
  const partialV2 = read()
  check('partial v2 fails closed instead of silently falling back to v1',
    !partialV2.ok && partialV2.code === 'SUPPLEMENT_PARTIAL')
  writeFileSync(SUPPLEMENT_MANIFEST_FILE_V2, v2Manifest, { encoding: 'utf8', mode: 0o600 })

  // ── 세대는 목록 하나가 정한다 · 다음 세대는 직전 세대를 동결 입력으로 받는다 ──
  check('code knows generations 1..4 and the latest is 4',
    SUPPLEMENT_GENERATIONS.join(',') === '1,2,3,4' && SUPPLEMENT_LATEST_GENERATION === 4)
  check('previous generation is derived, the first has none',
    previousSupplementGeneration(4) === 3 && previousSupplementGeneration(3) === 2
    && previousSupplementGeneration(2) === 1 && previousSupplementGeneration(1) === null)
  check('generation paths follow one naming rule',
    SUPPLEMENT_GENERATIONS.every((g) => supplementPaths(g).corpus.endsWith(`supplement-v${g}.json`)
      && supplementPaths(g).manifest.endsWith(`supplement-v${g}-manifest.json`)))
  const v3 = planSupplementSnapshot({
    canonRows: canon,
    extraRows: rows('v3', 2),
    baseCodes,
    newCodes: ['P64', 'P100'],
    baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12),
    generatedAt: '2026-11-23T00:00:00.000Z',
    reason: 'append generation three',
    frozenBundles: v2.asset.bundles,
  })
  check('v3 plan keeps every frozen v2 bundle and appends after them in numeric code order',
    v3.ok && v3.asset.bundles.map((bundle) => bundle.personaCode).join(',') === 'P34,P35,P36,P37,P64,P100')
  check('v3 plan preserves frozen v2 bundle bytes',
    JSON.stringify(v3.asset.bundles.slice(0, 4)) === JSON.stringify(v2.asset.bundles))
  const v3Write = writeSupplementSnapshot({ assetText: v3.assetText, manifestText: v3.manifestText, generation: 3 })
  check('v3 write succeeds without touching v1 or v2', v3Write.ok && v3Write.action === 'write'
    && readFileSync(SUPPLEMENT_MANIFEST_FILE_V2, 'utf8') === v2Manifest)
  check('runtime selects complete v3 over v2', activeSupplementPaths().generation === 3)
  const v3Loaded = read()
  check('active v3 snapshot verifies and covers frozen plus appended bundles', v3Loaded.ok && v3Loaded.byCode.size === 6)
  const v3Corpus = readFileSync(supplementPaths(3).corpus, 'utf8')
  rmSync(supplementPaths(3).corpus)
  const partialV3 = read()
  check('partial v3 fails closed instead of silently falling back to v2',
    !partialV3.ok && partialV3.code === 'SUPPLEMENT_PARTIAL' && activeSupplementPaths().generation === 3)
  writeFileSync(supplementPaths(3).corpus, v3Corpus, { encoding: 'utf8', mode: 0o600 })
  const explicitV2 = readSupplementSnapshot({ baseSourceDigest: sourceDigest, baseAssignmentDigestFor: () => baseDigest, generation: 2 })
  check('an explicit generation read never falls back to another generation', explicitV2.ok && explicitV2.byCode.size === 4)

  // ── v4 (wave9) — v3 와 같은 계약: 동결 v3 바이트 그대로 + 숫자 코드순으로 뒤에 붙는다 ──
  //    🔴 기록 전 runtime 은 v3 를 읽는다(파일이 없는 세대는 고르지 않는다) — 순서 무결성(기록 → 배포)의 전제다.
  check('before v4 is written the runtime still selects complete v3', activeSupplementPaths().generation === 3)
  const v3Manifest = readFileSync(supplementPaths(3).manifest, 'utf8')
  const v4 = planSupplementSnapshot({
    canonRows: canon,
    extraRows: rows('v4', 2),
    baseCodes,
    newCodes: ['P107', 'P153'],
    baseSourceDigest: sourceDigest,
    saltId: 'b'.repeat(12),
    generatedAt: '2026-11-28T00:00:00.000Z',
    reason: 'append generation four',
    frozenBundles: v3.asset.bundles,
  })
  check('v4 plan keeps every frozen v3 bundle and appends after them in numeric code order',
    v4.ok && v4.asset.bundles.map((bundle) => bundle.personaCode).join(',') === 'P34,P35,P36,P37,P64,P100,P107,P153')
  check('v4 plan preserves frozen v3 bundle bytes',
    JSON.stringify(v4.asset.bundles.slice(0, 6)) === JSON.stringify(v3.asset.bundles))
  const v4Write = writeSupplementSnapshot({ assetText: v4.assetText, manifestText: v4.manifestText, generation: 4 })
  check('v4 write succeeds without touching v2 or v3', v4Write.ok && v4Write.action === 'write'
    && readFileSync(SUPPLEMENT_MANIFEST_FILE_V2, 'utf8') === v2Manifest
    && readFileSync(supplementPaths(3).manifest, 'utf8') === v3Manifest)
  check('runtime selects complete v4 over v3', activeSupplementPaths().generation === 4)
  const v4Loaded = read()
  check('active v4 snapshot verifies and covers frozen plus appended bundles', v4Loaded.ok && v4Loaded.byCode.size === 8)
  const v4Corpus = readFileSync(supplementPaths(4).corpus, 'utf8')
  rmSync(supplementPaths(4).corpus)
  const partialV4 = read()
  check('partial v4 fails closed instead of silently falling back to v3',
    !partialV4.ok && partialV4.code === 'SUPPLEMENT_PARTIAL' && activeSupplementPaths().generation === 4)
  writeFileSync(supplementPaths(4).corpus, v4Corpus, { encoding: 'utf8', mode: 0o600 })
  const explicitV3 = readSupplementSnapshot({ baseSourceDigest: sourceDigest, baseAssignmentDigestFor: () => baseDigest, generation: 3 })
  check('an explicit v3 read stays v3 after v4 exists', explicitV3.ok && explicitV3.byCode.size === 6)

  const cli = readFileSync(join(process.cwd(), 'scripts/persona-reference-supplement-build.mts'), 'utf8')
  check('production apply reads canonical DB addresses',
    /readEnvKeys\(\['DATABASE_URL', 'DIRECT_URL'\]\)/.test(cli))
  check('production apply discards shell DB addresses',
    /process\.env\.DATABASE_URL = canonical\.databaseUrl/.test(cli)
    && /process\.env\.DIRECT_URL = canonical\.directUrl/.test(cli))
  check('production apply rejects fixture and evidence directory overrides',
    /FIXTURE_ARG !== null/.test(cli) && /EVIDENCE_DIR_ARG !== null/.test(cli))
  const code = cli.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  check('build tool writes the latest known generation and freezes the one before it — no generation literal',
    /const WRITE_GENERATION = SUPPLEMENT_LATEST_GENERATION/.test(code)
    && /previousSupplementGeneration\(WRITE_GENERATION\)/.test(code)
    && /generation: FROZEN_GENERATION/.test(code)
    && /generation: WRITE_GENERATION/.test(code)
    && !/generation: \d/.test(code))
  check('build tool default fixture comes from the runnable cohort registry, not a path literal',
    /COHORT_EXPANSION_FIXTURES\[id\]/.test(code) && !/persona-expansion-d\d+\.json/.test(code))
  check('production apply verifies the registered fixture digest and cohort scope',
    /digest !== DEFAULT_FIXTURE\.sha256/.test(code) && /checkCohortKeys\(COHORTS\[DEFAULT_FIXTURE\.id\], newCodes\)/.test(code))
  check('build tool reads evidence with the shared upper bound and binds it into the digest',
    /parseEvidenceUntil\(arg\('evidence-until'\), NOW\)/.test(code)
    && /until: EVIDENCE_UNTIL\.until/.test(code)
    && /evidenceUntil: EVIDENCE_UNTIL\.iso/.test(code))
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(`\npersona-reference-supplement-check: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
