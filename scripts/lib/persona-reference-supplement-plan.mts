import { sortPersonaCodes } from '../../src/lib/persona-code'
import {
  SUPPLEMENT_ASSET_VERSION, judgeSupplementAsset, judgeSupplementManifest,
  type SupplementalReferenceAsset, type SupplementalReferenceManifest,
} from '../../src/lib/persona-reference-supplement'
import {
  planAppendOnlyBundles, planBundles, type LocalComment,
} from './persona-reference-store.mjs'
import {
  assignmentDigest, serializeSupplementAsset, serializeSupplementManifest, sha256,
} from './persona-reference-supplement-store.mjs'

export function planSupplementSnapshot(input: {
  canonRows: readonly LocalComment[]
  extraRows: readonly LocalComment[]
  baseCodes: readonly string[]
  newCodes: readonly string[]
  baseSourceDigest: string
  saltId: string
  generatedAt: string
  reason: string
}): {
  ok: boolean
  problems: string[]
  asset: SupplementalReferenceAsset
  manifest: SupplementalReferenceManifest
  assetText: string
  manifestText: string
  planDigest: string
  fromCanon: string[]
  fromExtra: string[]
} {
  const baseCodes = sortPersonaCodes(new Set(input.baseCodes))
  const newCodes = sortPersonaCodes(new Set(input.newCodes))
  const plan = planAppendOnlyBundles({
    canonRows: input.canonRows,
    extraRows: input.extraRows,
    productionCodes: baseCodes,
    newCodes,
  })
  const problems: string[] = []
  if (plan.productionDrift.length > 0) problems.push(`BASE_DRIFT:${plan.productionDrift.join(',')}`)
  const missing = newCodes.filter((code) => !plan.byCode.has(code))
  if (missing.length > 0) problems.push(`BUNDLE_MISSING:${missing.join(',')}`)
  const bundles = newCodes.flatMap((code) => {
    const bundle = plan.byCode.get(code)
    return bundle === undefined ? [] : [{ ...bundle, personaCode: code }]
  })
  const asset: SupplementalReferenceAsset = {
    version: SUPPLEMENT_ASSET_VERSION,
    generatedAt: input.generatedAt,
    baseSourceDigest: input.baseSourceDigest,
    baseCodes,
    bundles,
  }
  const assetText = serializeSupplementAsset(asset)
  const basePlan = planBundles({ rows: input.canonRows, personaCodes: baseCodes })
  const baseByCode = new Map(basePlan.bundles.map((bundle) => [bundle.personaCode, bundle]))
  const manifest: SupplementalReferenceManifest = {
    version: SUPPLEMENT_ASSET_VERSION,
    generatedAt: input.generatedAt,
    assetDigest: sha256(assetText),
    baseSourceDigest: input.baseSourceDigest,
    baseAssignmentDigest: assignmentDigest(baseByCode, baseCodes),
    saltId: input.saltId,
    reason: input.reason.trim(),
  }
  const manifestText = serializeSupplementManifest(manifest)
  const judgedAsset = judgeSupplementAsset(asset)
  if (!judgedAsset.ok) problems.push(...judgedAsset.problems.map((problem) => `ASSET:${problem}`))
  const judgedManifest = judgeSupplementManifest(manifest)
  if (!judgedManifest.ok) problems.push(...judgedManifest.problems.map((problem) => `MANIFEST:${problem}`))
  return {
    ok: problems.length === 0,
    problems,
    asset,
    manifest,
    assetText,
    manifestText,
    // Approval digest excludes audit-only time/reason so dry-run and apply can
    // agree while preserving the exact semantic assignment.
    planDigest: sha256(JSON.stringify({
      asset: {
        version: asset.version,
        baseSourceDigest: asset.baseSourceDigest,
        baseCodes: asset.baseCodes,
        bundles: asset.bundles,
      },
      manifest: {
        version: manifest.version,
        baseSourceDigest: manifest.baseSourceDigest,
        baseAssignmentDigest: manifest.baseAssignmentDigest,
        saltId: manifest.saltId,
      },
    })),
    fromCanon: plan.fromCanon,
    fromExtra: plan.fromExtra,
  }
}
