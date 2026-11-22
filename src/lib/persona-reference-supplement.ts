/**
 * Append-only Persona voice bundle snapshot contract.
 *
 * The canonical corpus keeps the original production assignment stable. New
 * Persona codes receive immutable, derived bundles from this separate asset.
 * The asset contains no author identifiers, URLs, or source article data.
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'

import { isPersonaCode, sortPersonaCodes } from './persona-code'
import {
  REFERENCE_MIN_SAFE_TEXTS, judgeVoiceEvidence, type StyleVector,
  type VoiceReferenceBundle,
} from './persona-voice-reference'
import { REFERENCE_DIR } from './persona-reference-asset'

export const SUPPLEMENT_ASSET_VERSION = 1
/**
 * The first supplement migration freezes the production universe that existed
 * before wave6. If a required snapshot is absent or invalid after expansion,
 * only this prefix may use the legacy assignment; later codes fail closed.
 */
export const SUPPLEMENT_BASE_PERSONA_COUNT = 30

/**
 * 🔴 **이 코드가 아는 보충 세대** — append-only. 새 cohort 의 묶음은 다음 세대 하나로 쓴다
 *    (v1 wave6 · v2 wave7 · v3 wave8). 세대를 늘릴 때 고치는 곳은 이 목록 하나다 —
 *    기록 도구는 마지막 세대를 쓰고 그 직전 세대를 동결 입력으로 읽는다.
 *
 * 🔴 runtime 은 이 목록 밖 세대 파일을 읽지 않는다. 그래서 순서가 무결성이다:
 *    다음 세대 파일은 그 세대를 **모르는** runtime 이 돌 때 먼저 기록하고(옛 코드는 무시한다),
 *    그 세대를 아는 코드를 배포해야 배포기가 source · target Persona 자산 식별자를 각각 잰다.
 */
export const SUPPLEMENT_GENERATIONS = [1, 2, 3] as const
export type SupplementGeneration = (typeof SUPPLEMENT_GENERATIONS)[number]
export const SUPPLEMENT_LATEST_GENERATION: SupplementGeneration =
  SUPPLEMENT_GENERATIONS[SUPPLEMENT_GENERATIONS.length - 1]!

/** 바로 앞 세대 — 첫 세대면 null(그 앞은 정본 말뭉치뿐이다) */
export function previousSupplementGeneration(generation: SupplementGeneration): SupplementGeneration | null {
  const at = SUPPLEMENT_GENERATIONS.indexOf(generation)
  return at <= 0 ? null : SUPPLEMENT_GENERATIONS[at - 1]!
}

export function supplementPaths(generation: SupplementGeneration): { corpus: string; manifest: string } {
  return {
    corpus: join(REFERENCE_DIR, `supplement-v${generation}.json`),
    manifest: join(REFERENCE_DIR, `supplement-v${generation}-manifest.json`),
  }
}

/**
 * 🔴 가장 높은 세대의 파일이 하나라도 보이면 그 세대만 읽는다. 반쪽이면 앞 세대로 조용히 후퇴하지 않고
 *    호출부가 SUPPLEMENT_PARTIAL 로 막는다. 어느 세대 파일도 없을 때만 v1 경로(부재)를 돌려준다.
 */
export function activeSupplementPaths(): { generation: SupplementGeneration; corpus: string; manifest: string } {
  for (const generation of [...SUPPLEMENT_GENERATIONS].reverse()) {
    const paths = supplementPaths(generation)
    if (existsSync(paths.corpus) || existsSync(paths.manifest)) return { generation, ...paths }
  }
  return { generation: 1, ...supplementPaths(1) }
}

export type SupplementalReferenceAsset = {
  version: typeof SUPPLEMENT_ASSET_VERSION
  generatedAt: string
  baseSourceDigest: string
  baseCodes: string[]
  bundles: VoiceReferenceBundle[]
}

export type SupplementalReferenceManifest = {
  version: typeof SUPPLEMENT_ASSET_VERSION
  generatedAt: string
  assetDigest: string
  baseSourceDigest: string
  baseAssignmentDigest: string
  saltId: string
  reason: string
}

export function supplementFallbackPartition(
  productionCodes: readonly string[],
  baseCount = SUPPLEMENT_BASE_PERSONA_COUNT,
): { baseCodes: string[]; missingCodes: string[] } {
  const split = Math.min(Math.max(0, baseCount), productionCodes.length)
  return {
    baseCodes: [...productionCodes.slice(0, split)],
    missingCodes: [...productionCodes.slice(split)],
  }
}

const HEX16 = /^[0-9a-f]{16}$/
const HEX64 = /^[0-9a-f]{64}$/
const SALT_ID = /^[0-9a-f]{12}$/
const STYLE_KEYS: readonly (keyof StyleVector)[] =
  ['len', 'question', 'jamo', 'deco', 'yo', 'sentences']
const ASSET_KEYS = ['version', 'generatedAt', 'baseSourceDigest', 'baseCodes', 'bundles'] as const
const BUNDLE_KEYS = [
  'personaCode', 'comments', 'lengths', 'anchorCount', 'supplementCount', 'anchorRatio',
  'observedCount', 'styleOnlyCount', 'style',
] as const
const LENGTH_KEYS = ['count', 'min', 'p25', 'median', 'p75', 'p90', 'max'] as const
const MANIFEST_KEYS = [
  'version', 'generatedAt', 'assetDigest', 'baseSourceDigest', 'baseAssignmentDigest',
  'saltId', 'reason',
] as const

const exactKeys = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(',') === [...keys].sort().join(',')

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const sameSortedCodes = (codes: readonly string[]): boolean =>
  codes.length === new Set(codes).size
  && codes.every(isPersonaCode)
  && sortPersonaCodes(codes).join(',') === codes.join(',')

function bundleProblems(bundle: unknown): string[] {
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) return ['bundle-object']
  const b = bundle as Partial<VoiceReferenceBundle>
  const out: string[] = []
  if (!exactKeys(bundle, BUNDLE_KEYS)) out.push('bundle-shape')
  if (typeof b.personaCode !== 'string' || !isPersonaCode(b.personaCode)) out.push('bundle-code')
  if (!Array.isArray(b.comments) || b.comments.length < REFERENCE_MIN_SAFE_TEXTS) out.push('bundle-comments')
  else {
    if (b.comments.some((comment) => comment === null || typeof comment !== 'object'
      || Array.isArray(comment) || !exactKeys(comment, ['text']))) out.push('bundle-comment-shape')
    const texts = b.comments.map((comment) => comment?.text)
    if (texts.some((text) => typeof text !== 'string' || text.trim() === '')) out.push('bundle-comment-text')
    if (new Set(texts).size !== texts.length) out.push('bundle-comment-duplicate')
  }
  if (!Number.isInteger(b.anchorCount) || b.anchorCount !== b.comments?.length) out.push('bundle-anchor')
  if (b.supplementCount !== 0 || b.anchorRatio !== 1) out.push('bundle-single-speaker')
  if (!Number.isInteger(b.observedCount) || !Number.isInteger(b.styleOnlyCount)
    || (b.observedCount ?? -1) !== (b.anchorCount ?? 0) + (b.styleOnlyCount ?? 0)
    || !judgeVoiceEvidence({ observed: b.observedCount ?? 0, safeTexts: b.comments?.length ?? 0 }).ok) {
    out.push('bundle-evidence')
  }
  const lengths = b.lengths as Record<string, unknown> | undefined
  if (lengths === undefined || !exactKeys(lengths, LENGTH_KEYS)
    || LENGTH_KEYS.some((key) => !finite(lengths[key]))
    || lengths.count !== b.observedCount) out.push('bundle-lengths')
  const style = b.style as Record<string, unknown> | undefined
  if (style === undefined || !exactKeys(style, STYLE_KEYS)
    || STYLE_KEYS.some((key) => !finite(style[key]) || Number(style[key]) < 0 || Number(style[key]) > 1)) {
    out.push('bundle-style')
  }
  return out
}

export function judgeSupplementAsset(parsed: unknown):
  | { ok: true; asset: SupplementalReferenceAsset }
  | { ok: false; problems: string[] } {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, problems: ['asset-object'] }
  }
  const asset = parsed as Partial<SupplementalReferenceAsset>
  const problems: string[] = []
  if (!exactKeys(parsed, ASSET_KEYS)) problems.push('asset-shape')
  if (asset.version !== SUPPLEMENT_ASSET_VERSION) problems.push('asset-version')
  if (typeof asset.generatedAt !== 'string' || Number.isNaN(Date.parse(asset.generatedAt))) problems.push('asset-generatedAt')
  if (typeof asset.baseSourceDigest !== 'string' || !HEX16.test(asset.baseSourceDigest)) problems.push('asset-base-digest')
  if (!Array.isArray(asset.baseCodes) || !sameSortedCodes(asset.baseCodes)) problems.push('asset-base-codes')
  if (!Array.isArray(asset.bundles) || asset.bundles.length === 0) problems.push('asset-bundles')
  else {
    const codes = asset.bundles.map((bundle) => bundle?.personaCode ?? '')
    if (!sameSortedCodes(codes)) problems.push('asset-bundle-codes')
    if (asset.baseCodes?.some((code) => codes.includes(code))) problems.push('asset-code-overlap')
    const bundleBodies = asset.bundles.map((bundle) => JSON.stringify({
      comments: bundle?.comments, lengths: bundle?.lengths,
      anchorCount: bundle?.anchorCount, supplementCount: bundle?.supplementCount,
      anchorRatio: bundle?.anchorRatio, observedCount: bundle?.observedCount,
      styleOnlyCount: bundle?.styleOnlyCount, style: bundle?.style,
    }))
    if (new Set(bundleBodies).size !== bundleBodies.length) problems.push('asset-bundle-duplicate')
    for (const bundle of asset.bundles) {
      for (const problem of bundleProblems(bundle)) problems.push(`${bundle?.personaCode ?? '?'}:${problem}`)
    }
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, asset: asset as SupplementalReferenceAsset }
}

export function judgeSupplementManifest(parsed: unknown):
  | { ok: true; manifest: SupplementalReferenceManifest }
  | { ok: false; problems: string[] } {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, problems: ['manifest-object'] }
  }
  const manifest = parsed as Partial<SupplementalReferenceManifest>
  const problems: string[] = []
  if (!exactKeys(parsed, MANIFEST_KEYS)) problems.push('manifest-shape')
  if (manifest.version !== SUPPLEMENT_ASSET_VERSION) problems.push('manifest-version')
  if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) problems.push('manifest-generatedAt')
  if (typeof manifest.assetDigest !== 'string' || !HEX64.test(manifest.assetDigest)) problems.push('manifest-asset-digest')
  if (typeof manifest.baseSourceDigest !== 'string' || !HEX16.test(manifest.baseSourceDigest)) problems.push('manifest-base-digest')
  if (typeof manifest.baseAssignmentDigest !== 'string' || !HEX64.test(manifest.baseAssignmentDigest)) problems.push('manifest-assignment-digest')
  if (typeof manifest.saltId !== 'string' || !SALT_ID.test(manifest.saltId)) problems.push('manifest-salt')
  if (typeof manifest.reason !== 'string' || manifest.reason.trim() === '') problems.push('manifest-reason')
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, manifest: manifest as SupplementalReferenceManifest }
}
