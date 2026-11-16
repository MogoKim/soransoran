/**
 * 정본 자산 **digest 조회** — 🔴 파일만 읽는다. 판정은 부르는 쪽이 한다
 *
 * 🔴 **왜 `src/lib` 에 있나** (2026-09-10, P0-4).
 *
 *    `readConfirmedSelection` 이 회차 manifest 와 **지금 자산**을 대조해야 하는데,
 *    그 함수는 `src/lib` 에 있고 Next.js 경계상 `scripts/` 를 import 할 수 없다.
 *    runtime 재현에는 코퍼스와 그 의미를 설명하는 manifest 가 둘 다 필요하다.
 *    그래서 배포 식별자는 두 파일의 바이트를 함께 결속한다.
 *
 * 🔴 **모르면 통과시키지 않는다.** 자산이 없거나 못 읽으면 `null` 이고,
 *    부르는 쪽은 그것을 provisional 로 처리한다(fail-closed).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  judgeAssetShape, REFERENCE_CORPUS_FILE, REFERENCE_MANIFEST_FILE,
  type ReferenceAsset,
} from './persona-reference-asset'
import {
  activeSupplementPaths, judgeSupplementAsset, judgeSupplementManifest,
} from './persona-reference-supplement'

export type AssetDigests = {
  sanitizedCorpusDigest: string
  /** 🔴 자산 생성 당시 **실제 작성자명**으로 돌린 검사의 증거 */
  identityLeakCheck: { ran: boolean; hits: number; detail: string } | null
}

export type RuntimePersonaAssetIdentity = {
  /** 기본 말투 코퍼스 + manifest 파일 바이트를 함께 결속한 SHA-256 */
  referenceDigest: string
  /** 보충 말투 코퍼스 + manifest 결속 SHA-256. 두 파일이 모두 없는 정상 미도입 상태는 `null`. */
  supplementDigest: string | null
}

/**
 * runtime manifest 와 실제 파일을 대조하는 단일 정본.
 * 보충 자산의 정상 미도입(`null`)도 값의 일부이므로 느슨하게 비교하지 않는다.
 */
export function sameRuntimePersonaAssetIdentity(
  left: RuntimePersonaAssetIdentity,
  right: RuntimePersonaAssetIdentity,
): boolean {
  return left.referenceDigest === right.referenceDigest
    && left.supplementDigest === right.supplementDigest
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')
const sha16 = (text: string): string => sha256(text).slice(0, 16)
const HEX16 = /^[0-9a-f]{16}$/

/** 파일 경계까지 포함한다. 단순 문자열 이어붙이기로 생길 수 있는 경계 모호성을 피한다. */
const assetPairDigest = (corpusRaw: string, manifestRaw: string): string =>
  sha256(`${sha256(corpusRaw)}:${sha256(manifestRaw)}`)

/**
 * runtime 자산의 순수 판정. 실제 경로를 건드리지 않고도 manifest-only 변이까지 반례로 고정한다.
 * 보충 자산은 둘 다 `null`인 경우에만 정상 미도입이다.
 */
export function runtimePersonaAssetIdentityOf(input: {
  referenceRaw: string
  referenceManifestRaw: string
  supplementRaw: string | null
  supplementManifestRaw: string | null
}): RuntimePersonaAssetIdentity | null {
  try {
    const reference = JSON.parse(input.referenceRaw) as unknown
    const referenceShape = judgeAssetShape(reference)
    if (!referenceShape.ok) return null
    const referenceManifest = JSON.parse(input.referenceManifestRaw) as {
      sourceDigest?: unknown
      sanitizedCorpusDigest?: unknown
    }
    if (typeof referenceManifest.sourceDigest !== 'string' || !HEX16.test(referenceManifest.sourceDigest)
      || typeof referenceManifest.sanitizedCorpusDigest !== 'string' || !HEX16.test(referenceManifest.sanitizedCorpusDigest)
      || sha16(input.referenceRaw) !== referenceManifest.sourceDigest) return null
    const comments = (reference as ReferenceAsset).comments.map((comment) => comment.content).sort()
    if (sha16(JSON.stringify(comments)) !== referenceManifest.sanitizedCorpusDigest) return null

    if ((input.supplementRaw === null) !== (input.supplementManifestRaw === null)) return null
    let supplementDigest: string | null = null
    if (input.supplementRaw !== null && input.supplementManifestRaw !== null) {
      const supplementShape = judgeSupplementAsset(JSON.parse(input.supplementRaw) as unknown)
      if (!supplementShape.ok) return null
      const supplementManifestShape = judgeSupplementManifest(JSON.parse(input.supplementManifestRaw) as unknown)
      if (!supplementManifestShape.ok
        || sha256(input.supplementRaw) !== supplementManifestShape.manifest.assetDigest) return null
      supplementDigest = assetPairDigest(input.supplementRaw, input.supplementManifestRaw)
    }

    return {
      referenceDigest: assetPairDigest(input.referenceRaw, input.referenceManifestRaw),
      supplementDigest,
    }
  } catch { return null }
}

/**
 * 🔴 runtime manifest 에 결속할 실제 Persona 자산 두 벌의 식별자.
 *    manifest 문자열만 믿지 않고 파일을 다시 읽어 기존 자산 계약과 digest 를 모두 대조한다.
 *    기본 자산이 없거나 깨졌으면 `null` — 배포는 job 을 내리기 전에 멈춘다.
 *    보충 자산은 **두 파일 모두 없음**만 정상 부재(`supplementDigest:null`)다. 일부만 있거나 깨졌으면 `null`이다.
 */
export function readRuntimePersonaAssetIdentity(): RuntimePersonaAssetIdentity | null {
  try {
    if (![REFERENCE_CORPUS_FILE, REFERENCE_MANIFEST_FILE].every(existsSync)) return null
    const referenceRaw = readFileSync(REFERENCE_CORPUS_FILE, 'utf-8')
    const referenceManifestRaw = readFileSync(REFERENCE_MANIFEST_FILE, 'utf-8')
    const supplementPaths = activeSupplementPaths()
    const supplementFiles = [supplementPaths.corpus, supplementPaths.manifest].map(existsSync)
    if (supplementFiles[0] !== supplementFiles[1]) return null
    return runtimePersonaAssetIdentityOf({
      referenceRaw,
      referenceManifestRaw,
      supplementRaw: supplementFiles[0] ? readFileSync(supplementPaths.corpus, 'utf-8') : null,
      supplementManifestRaw: supplementFiles[1] ? readFileSync(supplementPaths.manifest, 'utf-8') : null,
    })
  } catch { return null }
}

/** 🔴 못 읽으면 `null`. "없다" 와 "깨끗하다" 를 섞지 않는다 */
export function readAssetDigests(): AssetDigests | null {
  try {
    if (!existsSync(REFERENCE_MANIFEST_FILE)) return null
    const m = JSON.parse(readFileSync(REFERENCE_MANIFEST_FILE, 'utf-8')) as {
      sanitizedCorpusDigest?: unknown
      identityLeakCheck?: { ran?: unknown; hits?: unknown; detail?: unknown }
    }
    if (typeof m.sanitizedCorpusDigest !== 'string' || m.sanitizedCorpusDigest === '') return null
    const l = m.identityLeakCheck
    return {
      sanitizedCorpusDigest: m.sanitizedCorpusDigest,
      identityLeakCheck: l !== undefined
        && typeof l.ran === 'boolean' && typeof l.hits === 'number' && typeof l.detail === 'string'
        ? { ran: l.ran, hits: l.hits, detail: l.detail }
        : null,
    }
  } catch { return null }
}
