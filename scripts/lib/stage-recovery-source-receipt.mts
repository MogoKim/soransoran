import { createHash, randomUUID } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ACTIVE_RECOVERY_COLLECTOR_MAX } from '../../src/lib/stage-active-recovery'
import { stageRecoveryDir } from './stage-recovery-intent.mjs'

export const STAGE_RECOVERY_SOURCE_RECEIPT_VERSION = 'stage-recovery-source-receipt-v1' as const

type StageRecoverySourceReceipt = {
  version: typeof STAGE_RECOVERY_SOURCE_RECEIPT_VERSION
  kstDate: string
  nonce: string
  runId: string
  writtenAt: string
  sourceHashes: string[]
  digest: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const HASH_RE = /^[0-9a-f]{64}$/
const RECEIPT_RE = /^(\d{4}-\d{2}-\d{2})\.[0-9a-f]{16}\.sources\.json$/

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const digestOf = (hashes: readonly string[]): string => sha256(hashes.join('\n'))

export function stageRecoverySourceReceiptPath(kstDate: string, nonce: string, home?: string): string {
  return join(stageRecoveryDir(home), `${kstDate}.${sha256(nonce).slice(0, 16)}.sources.json`)
}

function parseReceipt(raw: string): StageRecoverySourceReceipt | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (o.version !== STAGE_RECOVERY_SOURCE_RECEIPT_VERSION || typeof o.kstDate !== 'string'
    || !DATE_RE.test(o.kstDate) || typeof o.nonce !== 'string' || o.nonce.length === 0
    || typeof o.runId !== 'string' || o.runId.length === 0 || typeof o.writtenAt !== 'string'
    || !Number.isFinite(Date.parse(o.writtenAt)) || !Array.isArray(o.sourceHashes)
    || o.sourceHashes.length > ACTIVE_RECOVERY_COLLECTOR_MAX || typeof o.digest !== 'string') return null
  const hashes = o.sourceHashes
  if (!hashes.every((hash): hash is string => typeof hash === 'string' && HASH_RE.test(hash))) return null
  const canonical = [...new Set(hashes)].sort()
  if (canonical.length !== hashes.length || canonical.some((hash, index) => hash !== hashes[index])
    || o.digest !== digestOf(canonical)) return null
  return { ...o, sourceHashes: canonical } as StageRecoverySourceReceipt
}

/**
 * 복구 수집 직후 남기는 최소 provenance. 원문 ID·본문은 쓰지 않고 정본 source identity hash만 쓴다.
 * 같은 nonce 재실행은 바이트가 같은 영수증만 멱등으로 인정한다.
 */
export function writeStageRecoverySourceReceipt(i: {
  kstDate: string
  nonce: string
  runId: string
  sourceHashes: readonly string[]
  now: Date
  home?: string
}): StageRecoverySourceReceipt {
  if (!DATE_RE.test(i.kstDate) || i.nonce.length === 0 || i.runId.length === 0
    || !Number.isFinite(i.now.getTime())) throw new Error('stage recovery source receipt identity가 잘못됐다')
  const sourceHashes = [...new Set(i.sourceHashes)].sort()
  if (sourceHashes.length > ACTIVE_RECOVERY_COLLECTOR_MAX || sourceHashes.some((hash) => !HASH_RE.test(hash))) {
    throw new Error('stage recovery source receipt hash가 잘못됐다')
  }
  const receipt: StageRecoverySourceReceipt = {
    version: STAGE_RECOVERY_SOURCE_RECEIPT_VERSION,
    kstDate: i.kstDate,
    nonce: i.nonce,
    runId: i.runId,
    writtenAt: i.now.toISOString(),
    sourceHashes,
    digest: digestOf(sourceHashes),
  }
  const body = `${JSON.stringify(receipt, null, 2)}\n`
  mkdirSync(stageRecoveryDir(i.home), { recursive: true, mode: 0o700 })
  const path = stageRecoverySourceReceiptPath(i.kstDate, i.nonce, i.home)
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    // 완성된 바이트만 정본 이름으로 보이게 한다. 같은 디렉터리 hard link는 기존 정본을 덮지 않는다.
    writeFileSync(tmpPath, body, { flag: 'wx', mode: 0o600 })
    try {
      linkSync(tmpPath, path)
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
      const existing = parseReceipt(readFileSync(path, 'utf-8'))
      if (existing === null || existing.kstDate !== receipt.kstDate || existing.nonce !== receipt.nonce
        || existing.runId !== receipt.runId || existing.digest !== receipt.digest) {
        throw new Error('기존 stage recovery source receipt가 다른 실행이거나 손상됐다')
      }
      return existing
    }
  } finally {
    try { unlinkSync(tmpPath) } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
  }
  return receipt
}

/**
 * 표본일 복구 원천 집합. 파일이 없으면 빈 집합이고, 그 날짜와 이름이 맞는 영수증 하나라도
 * 손상됐으면 `null`로 닫아 자연 유입을 부풀리지 않는다.
 */
export function readStageRecoverySourceHashes(kstDate: string, home?: string): Set<string> | null {
  if (!DATE_RE.test(kstDate)) return null
  const dir = stageRecoveryDir(home)
  if (!existsSync(dir)) return new Set()
  let names: string[]
  try { names = readdirSync(dir) } catch { return null }
  const hashes = new Set<string>()
  for (const name of names) {
    const match = RECEIPT_RE.exec(name)
    if (match === null || match[1] !== kstDate) continue
    let receipt: StageRecoverySourceReceipt | null
    try { receipt = parseReceipt(readFileSync(join(dir, name), 'utf-8')) } catch { return null }
    if (receipt === null || receipt.kstDate !== kstDate) return null
    for (const hash of receipt.sourceHashes) hashes.add(hash)
  }
  return hashes
}
