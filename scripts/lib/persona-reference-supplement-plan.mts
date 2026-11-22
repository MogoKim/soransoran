import { sortPersonaCodes } from '../../src/lib/persona-code'
import {
  SUPPLEMENT_ASSET_VERSION, judgeSupplementAsset, judgeSupplementManifest,
  type SupplementalReferenceAsset, type SupplementalReferenceManifest,
} from '../../src/lib/persona-reference-supplement'
import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'
import {
  planAppendOnlyBundles, planBundles, type LocalComment, type VoiceBandCap,
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
  /** 이미 운영에서 동결된 append-only 묶음. 새 계획보다 항상 우선하고 다음 세대에 바이트 의미 그대로 포함한다. */
  frozenBundles?: readonly VoiceReferenceBundle[]
  /**
   * 🔴 증거 시각 상한(ISO) — 이 시각까지 수집된 근거만 계획에 들어왔다는 표시. 주면 승인 digest 에 들어간다:
   *    낮에 같은 상한으로 렌더한 카드 말투와 밤 apply 묶음이 같다는 것을 digest 하나로 확인한다.
   *    다른 상한으로 다시 계획하면 묶음이 우연히 같아도 digest 가 달라져 apply 가 멈춘다.
   */
  evidenceUntil?: string
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
  /** 새 묶음 voiceBand 상한 — 바꾼 자리 · 건너뛴 여분 · 남은 넘침(남으면 위 problems 에도 있다) */
  voiceBandCap: VoiceBandCap
} {
  const baseCodes = sortPersonaCodes(new Set(input.baseCodes))
  const newCodes = sortPersonaCodes(new Set(input.newCodes))
  const frozenBundles = [...(input.frozenBundles ?? [])]
  const frozenCodes = new Set(frozenBundles.map((bundle) => bundle.personaCode))
  const overlap = newCodes.filter((code) => frozenCodes.has(code))
  // 다음 세대는 base 바로 뒤가 아니라 이미 동결된 append-only 세대 뒤에서
  // 배정한다. frozen 코드를 빼고 다시 계획하면 P44부터가 P34부터의 화자를
  // 재사용해도 오직 사후 중복 검사에서만 드러난다.
  const occupiedCodes = sortPersonaCodes([...baseCodes, ...frozenCodes])
  const plan = planAppendOnlyBundles({
    canonRows: input.canonRows,
    extraRows: input.extraRows,
    productionCodes: occupiedCodes,
    newCodes,
    occupiedBundles: frozenBundles,
  })
  const problems: string[] = []
  if (overlap.length > 0) problems.push(`FROZEN_NEW_OVERLAP:${overlap.join(',')}`)
  if (plan.productionDrift.length > 0) problems.push(`BASE_DRIFT:${plan.productionDrift.join(',')}`)
  const missing = newCodes.filter((code) => !plan.byCode.has(code))
  if (missing.length > 0) problems.push(`BUNDLE_MISSING:${missing.join(',')}`)
  // 🔴 새 묶음 voiceBand 가 상한을 넘는 채로 남으면(바꿀 여분이 모자람) 동결하지 않는다 — 판정과 같은 식 · 같은 코드
  for (const p of plan.voiceBandCap.problems) problems.push(`${p.rule}:${p.detail}`)
  const plannedBundles = newCodes.flatMap((code) => {
    const bundle = plan.byCode.get(code)
    return bundle === undefined ? [] : [{ ...bundle, personaCode: code }]
  })
  const body = (bundle: VoiceReferenceBundle): string => JSON.stringify({
    comments: bundle.comments, lengths: bundle.lengths, anchorCount: bundle.anchorCount,
    supplementCount: bundle.supplementCount, anchorRatio: bundle.anchorRatio,
    observedCount: bundle.observedCount, styleOnlyCount: bundle.styleOnlyCount, style: bundle.style,
  })
  const frozenBodies = new Set(frozenBundles.map(body))
  const reused = plannedBundles.filter((bundle) => frozenBodies.has(body(bundle))).map((bundle) => bundle.personaCode)
  if (reused.length > 0) problems.push(`FROZEN_BUNDLE_REUSE:${reused.join(',')}`)
  const bundles = sortPersonaCodes([...frozenBundles.map((bundle) => bundle.personaCode), ...newCodes])
    .flatMap((code) => {
      const bundle = frozenBundles.find((candidate) => candidate.personaCode === code)
        ?? plannedBundles.find((candidate) => candidate.personaCode === code)
      return bundle === undefined ? [] : [bundle]
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
    // agree while preserving the exact semantic assignment. The evidence upper
    // bound is semantic input, so it is bound when present.
    planDigest: sha256(JSON.stringify({
      ...(input.evidenceUntil === undefined ? {} : { evidenceUntil: input.evidenceUntil }),
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
    voiceBandCap: plan.voiceBandCap,
  }
}
