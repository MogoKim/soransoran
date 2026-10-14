import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'

import { sortPersonaCodes } from '../../src/lib/persona-code'
import {
  REFERENCE_DIR, REFERENCE_DIR_MODE, REFERENCE_FILE_MODE, isTooOpen,
} from '../../src/lib/persona-reference-asset'
import {
  SUPPLEMENT_ASSET_VERSION, SUPPLEMENT_CORPUS_FILE, SUPPLEMENT_MANIFEST_FILE,
  judgeSupplementAsset, judgeSupplementManifest,
  type SupplementalReferenceAsset, type SupplementalReferenceManifest,
} from '../../src/lib/persona-reference-supplement'
import type { VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const stableBundle = (bundle: VoiceReferenceBundle): Record<string, unknown> => ({
  personaCode: bundle.personaCode,
  comments: bundle.comments.map((comment) => ({ text: comment.text })),
  lengths: bundle.lengths,
  anchorCount: bundle.anchorCount,
  supplementCount: bundle.supplementCount,
  anchorRatio: bundle.anchorRatio,
  observedCount: bundle.observedCount,
  styleOnlyCount: bundle.styleOnlyCount,
  style: bundle.style,
})

export function assignmentDigest(
  byCode: ReadonlyMap<string, VoiceReferenceBundle>,
  codes: readonly string[],
): string {
  return sha256(JSON.stringify(sortPersonaCodes(codes).map((code) => {
    const bundle = byCode.get(code)
    return bundle === undefined ? [code, null] : [code, stableBundle(bundle)]
  })))
}

export function mergeSupplementAssignment(input: {
  productionCodes: readonly string[]
  baseCodes: readonly string[]
  baseBundles: readonly VoiceReferenceBundle[]
  supplementByCode: ReadonlyMap<string, VoiceReferenceBundle>
}): {
  byCode: Map<string, VoiceReferenceBundle>
  missing: string[]
  baseOutside: string[]
} {
  const production = new Set(input.productionCodes)
  const baseOutside = input.baseCodes.filter((code) => !production.has(code))
  const byCode = new Map<string, VoiceReferenceBundle>()
  for (const bundle of input.baseBundles) {
    if (production.has(bundle.personaCode)) byCode.set(bundle.personaCode, bundle)
  }
  const missing: string[] = []
  for (const code of input.productionCodes) {
    if (byCode.has(code)) continue
    const bundle = input.supplementByCode.get(code)
    if (bundle === undefined) missing.push(code)
    else byCode.set(code, bundle)
  }
  return { byCode, missing, baseOutside }
}

export function serializeSupplementAsset(asset: SupplementalReferenceAsset): string {
  return `${JSON.stringify(asset, null, 2)}\n`
}

export function serializeSupplementManifest(manifest: SupplementalReferenceManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export type SupplementSnapshotRead =
  | {
    ok: true
    asset: SupplementalReferenceAsset
    manifest: SupplementalReferenceManifest
    byCode: Map<string, VoiceReferenceBundle>
  }
  | { ok: false; code: string; reason: string }

export function readSupplementSnapshot(input: {
  baseSourceDigest: string
  baseAssignmentDigestFor: (codes: readonly string[]) => string
}): SupplementSnapshotRead {
  if (!existsSync(SUPPLEMENT_CORPUS_FILE) && !existsSync(SUPPLEMENT_MANIFEST_FILE)) {
    return { ok: false, code: 'SUPPLEMENT_ABSENT', reason: '보충 말투 스냅샷이 없다' }
  }
  if (!existsSync(SUPPLEMENT_CORPUS_FILE) || !existsSync(SUPPLEMENT_MANIFEST_FILE)) {
    return { ok: false, code: 'SUPPLEMENT_PARTIAL', reason: '보충 말투 스냅샷 파일이 일부만 있다' }
  }
  for (const path of [SUPPLEMENT_CORPUS_FILE, SUPPLEMENT_MANIFEST_FILE]) {
    const stat = lstatSync(path)
    if (!stat.isFile() || isTooOpen(stat.mode)) {
      return { ok: false, code: 'SUPPLEMENT_MODE', reason: '보충 말투 스냅샷 권한·파일 모양이 정본이 아니다' }
    }
  }
  let assetRaw = ''
  let manifestRaw = ''
  let assetParsed: unknown
  let manifestParsed: unknown
  try {
    assetRaw = readFileSync(SUPPLEMENT_CORPUS_FILE, 'utf8')
    manifestRaw = readFileSync(SUPPLEMENT_MANIFEST_FILE, 'utf8')
    assetParsed = JSON.parse(assetRaw)
    manifestParsed = JSON.parse(manifestRaw)
  } catch {
    return { ok: false, code: 'SUPPLEMENT_PARSE', reason: '보충 말투 스냅샷을 읽지 못했다' }
  }
  const assetJudge = judgeSupplementAsset(assetParsed)
  if (!assetJudge.ok) {
    return { ok: false, code: 'SUPPLEMENT_SHAPE', reason: `보충 말투 스냅샷 모양 오류 ${assetJudge.problems.length}건` }
  }
  const manifestJudge = judgeSupplementManifest(manifestParsed)
  if (!manifestJudge.ok) {
    return { ok: false, code: 'SUPPLEMENT_MANIFEST', reason: `보충 말투 manifest 모양 오류 ${manifestJudge.problems.length}건` }
  }
  const { asset } = assetJudge
  const { manifest } = manifestJudge
  if (sha256(assetRaw) !== manifest.assetDigest) {
    return { ok: false, code: 'SUPPLEMENT_DIGEST', reason: '보충 말투 스냅샷 digest 가 manifest 와 다르다' }
  }
  if (asset.baseSourceDigest !== input.baseSourceDigest
    || manifest.baseSourceDigest !== input.baseSourceDigest) {
    return { ok: false, code: 'SUPPLEMENT_BASE_SOURCE', reason: '보충 말투 스냅샷의 정본 원천 digest 가 지금과 다르다' }
  }
  if (asset.generatedAt !== manifest.generatedAt) {
    return { ok: false, code: 'SUPPLEMENT_GENERATION', reason: '보충 말투 asset 과 manifest 생성 시각이 다르다' }
  }
  if (manifest.baseAssignmentDigest !== input.baseAssignmentDigestFor(asset.baseCodes)) {
    return { ok: false, code: 'SUPPLEMENT_BASE_ASSIGNMENT', reason: '보충 말투 스냅샷의 기존 Persona 배정이 지금과 다르다' }
  }
  return {
    ok: true,
    asset,
    manifest,
    byCode: new Map(asset.bundles.map((bundle) => [bundle.personaCode, bundle])),
  }
}

function sameOrMissing(path: string, expected: string): 'missing' | 'same' | 'conflict' {
  if (!existsSync(path)) return 'missing'
  return readFileSync(path, 'utf8') === expected ? 'same' : 'conflict'
}

export function writeSupplementSnapshot(input: {
  assetText: string
  manifestText: string
}): { ok: true; action: 'write' | 'noop' } | { ok: false; reason: string } {
  const assetState = sameOrMissing(SUPPLEMENT_CORPUS_FILE, input.assetText)
  const manifestState = sameOrMissing(SUPPLEMENT_MANIFEST_FILE, input.manifestText)
  if (assetState === 'conflict' || manifestState === 'conflict') {
    return { ok: false, reason: '기존 보충 말투 스냅샷과 내용이 다르다 — 덮어쓰지 않는다' }
  }
  if (assetState === 'same' && manifestState === 'same') return { ok: true, action: 'noop' }
  mkdirSync(REFERENCE_DIR, { recursive: true, mode: REFERENCE_DIR_MODE })
  chmodSync(REFERENCE_DIR, REFERENCE_DIR_MODE)
  const writes = [
    [SUPPLEMENT_CORPUS_FILE, input.assetText, assetState],
    [SUPPLEMENT_MANIFEST_FILE, input.manifestText, manifestState],
  ] as const
  const temps: string[] = []
  try {
    for (const [path, text, state] of writes) {
      if (state !== 'missing') continue
      const temp = `${path}.staging-${process.pid}`
      temps.push(temp)
      writeFileSync(temp, text, { encoding: 'utf8', mode: REFERENCE_FILE_MODE })
      chmodSync(temp, REFERENCE_FILE_MODE)
    }
    for (const [path, , state] of writes) {
      if (state !== 'missing') continue
      renameSync(`${path}.staging-${process.pid}`, path)
      chmodSync(path, REFERENCE_FILE_MODE)
    }
  } catch (error) {
    for (const temp of temps) rmSync(temp, { force: true })
    return { ok: false, reason: `보충 말투 스냅샷 기록 실패 — ${(error as Error).message}` }
  }
  return { ok: true, action: 'write' }
}
