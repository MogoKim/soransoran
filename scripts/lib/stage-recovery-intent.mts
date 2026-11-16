import { randomUUID } from 'node:crypto'
import {
  closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  ACTIVE_RECOVERY_DATE_ENV, ACTIVE_RECOVERY_DEADLINE_ENV, ACTIVE_RECOVERY_DEFICIT_ENV,
  ACTIVE_RECOVERY_COLLECTOR_MAX, ACTIVE_RECOVERY_MAX_DEFICIT,
  ACTIVE_RECOVERY_NONCE_ENV, ACTIVE_RECOVERY_VERSION, ACTIVE_RECOVERY_WORKSET_LIMIT,
  type ActiveRecoveryIntentState, type ActiveRecoveryPlan,
} from '../../src/lib/stage-active-recovery'
import type { RuntimeStage } from '../../src/lib/scale-profile'

export type StageRecoveryIntentState = ActiveRecoveryIntentState
export type StageRecoveryIntent = {
  version: typeof ACTIVE_RECOVERY_VERSION
  kstDate: string
  target: RuntimeStage
  deficit: number
  baselineReadyStock: number
  collectMax: number
  worksetLimit: number
  nonce: string
  state: StageRecoveryIntentState
  createdAt: string
  updatedAt: string
  message: string | null
}

export function stageRecoveryDir(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', 'soransoran', 'stage-active-recovery')
}

export function stageRecoveryIntentPath(kstDate: string, home?: string): string {
  return join(stageRecoveryDir(home), `${kstDate}.json`)
}

export function stageRecoveryLogPath(kstDate: string, home?: string): string {
  return join(stageRecoveryDir(home), `${kstDate}.log`)
}

export function stageRecoverySupplyReceiptPath(kstDate: string, home?: string): string {
  return join(stageRecoveryDir(home), `${kstDate}.supply-complete.json`)
}

const INTENT_UPDATE_LOCK_MAX_AGE_MS = 60_000

function withIntentUpdateLock<T>(kstDate: string, home: string | undefined, action: () => T): T {
  mkdirSync(stageRecoveryDir(home), { recursive: true, mode: 0o700 })
  const path = join(stageRecoveryDir(home), `${kstDate}.update.lock`)
  const acquire = (): number => openSync(path, 'wx', 0o600)
  let fd: number
  try {
    fd = acquire()
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error
    let stale = false
    try { stale = Date.now() - statSync(path).mtimeMs > INTENT_UPDATE_LOCK_MAX_AGE_MS } catch { /* 다음 acquire가 판정 */ }
    if (!stale) throw new Error('stage recovery intent 갱신이 이미 진행 중이다')
    try { unlinkSync(path) } catch { throw new Error('stale stage recovery intent lock을 해제하지 못했다') }
    fd = acquire()
  }
  try { return action() } finally {
    closeSync(fd)
    try { unlinkSync(path) } catch { /* 다음 갱신은 stale TTL 뒤 fail-closed */ }
  }
}

export function stageRecoveryLaunchClaimPath(kstDate: string, home?: string): string {
  return join(stageRecoveryDir(home), `${kstDate}.launch-claimed.json`)
}

export function stageRecoverySupplyStartClaimPath(kstDate: string, home?: string): string {
  return join(stageRecoveryDir(home), `${kstDate}.supply-started.json`)
}

const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const nonnegative = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0

export function parseStageRecoveryIntent(raw: string): StageRecoveryIntent | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (o.version !== ACTIVE_RECOVERY_VERSION || !validDate(o.kstDate)
    || typeof o.target !== 'string' || !/^d(?:20|30|50)$/.test(o.target)
    || !positive(o.deficit) || !nonnegative(o.baselineReadyStock)
    || !positive(o.collectMax) || !positive(o.worksetLimit)
    || Number(o.deficit) > ACTIVE_RECOVERY_MAX_DEFICIT
    || Number(o.collectMax) > ACTIVE_RECOVERY_COLLECTOR_MAX
    || Number(o.collectMax) !== ACTIVE_RECOVERY_COLLECTOR_MAX
    || Number(o.worksetLimit) !== ACTIVE_RECOVERY_WORKSET_LIMIT
    || typeof o.nonce !== 'string' || o.nonce === ''
    || !['requested', 'running', 'done', 'failed'].includes(String(o.state))
    || typeof o.createdAt !== 'string' || !Number.isFinite(Date.parse(o.createdAt))
    || typeof o.updatedAt !== 'string' || !Number.isFinite(Date.parse(o.updatedAt))
    || (o.message !== null && typeof o.message !== 'string')) return null
  return o as StageRecoveryIntent
}

/** 오늘 recovery 산출물 판독 — 손상을 없음으로 읽지 않는다(`ActiveRecoveryArtifact`의 실제 값). */
export type StageRecoveryArtifactRead =
  | { kind: 'absent' }
  | { kind: 'valid'; intent: StageRecoveryIntent }
  | { kind: 'corrupt'; reason: string }

const SOURCE_RECEIPT_NAME_RE = /^(\d{4}-\d{2}-\d{2})\.[0-9a-f]{16}\.sources\.json$/

const errorCode = (e: unknown): string | undefined => (e as { code?: string }).code

/** intent가 없을 때 남아 있으면 안 되는 같은 날짜의 실행권·시작 claim·완주 영수증·원천 영수증. */
function orphanArtifactsOf(kstDate: string, home?: string): { names: string[] } | { error: string } {
  const names: string[] = []
  for (const path of [
    stageRecoveryLaunchClaimPath(kstDate, home),
    stageRecoverySupplyStartClaimPath(kstDate, home),
    stageRecoverySupplyReceiptPath(kstDate, home),
  ]) {
    try {
      lstatSync(path)
      names.push(path.slice(path.lastIndexOf('/') + 1))
    } catch (e) {
      if (errorCode(e) !== 'ENOENT') return { error: `${path.slice(path.lastIndexOf('/') + 1)} 확인 실패 ${errorCode(e) ?? 'unknown'}` }
    }
  }
  let entries: string[]
  try { entries = readdirSync(stageRecoveryDir(home)) } catch (e) {
    if (errorCode(e) === 'ENOENT') return { names }
    return { error: `recovery 디렉터리 읽기 실패 ${errorCode(e) ?? 'unknown'}` }
  }
  for (const name of entries) {
    if (SOURCE_RECEIPT_NAME_RE.exec(name)?.[1] === kstDate) names.push(name)
  }
  return { names }
}

/**
 * 🔴 **recovery 판독의 유일한 문.** `absent`는 intent가 ENOENT이고 같은 날짜 claim·영수증도 없을 때뿐이다.
 *    다른 읽기 오류 · 파싱 실패 · 다른 날짜 본문 · intent 없이 남은 claim/영수증은 `corrupt`다.
 */
export function readStageRecoveryArtifact(kstDate: string, home?: string): StageRecoveryArtifactRead {
  let raw: string
  try {
    raw = readFileSync(stageRecoveryIntentPath(kstDate, home), 'utf-8')
  } catch (e) {
    if (errorCode(e) !== 'ENOENT') return { kind: 'corrupt', reason: `intent 읽기 실패 ${errorCode(e) ?? 'unknown'}` }
    const orphans = orphanArtifactsOf(kstDate, home)
    if ('error' in orphans) return { kind: 'corrupt', reason: orphans.error }
    if (orphans.names.length > 0) return { kind: 'corrupt', reason: `intent 없이 남은 산출물: ${orphans.names.join(',')}` }
    return { kind: 'absent' }
  }
  const intent = parseStageRecoveryIntent(raw)
  if (intent === null) return { kind: 'corrupt', reason: 'intent 형식이 계약과 다르다' }
  if (intent.kstDate !== kstDate) return { kind: 'corrupt', reason: `intent 날짜 ${intent.kstDate} ≠ ${kstDate}` }
  return { kind: 'valid', intent }
}

/** 상태 전이·실행권 검증처럼 정상 intent만 받는 내부 경로. 없음·손상은 모두 진행 불가다(fail-closed). */
function validIntentOf(kstDate: string, home?: string): StageRecoveryIntent | null {
  const read = readStageRecoveryArtifact(kstDate, home)
  return read.kind === 'valid' ? read.intent : null
}

export function createStageRecoveryIntent(i: {
  kstDate: string
  plan: Extract<ActiveRecoveryPlan, { kind: 'recover' }>
  now: Date
  home?: string
}): { created: boolean; intent: StageRecoveryIntent } {
  const dir = stageRecoveryDir(i.home)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const at = i.now.toISOString()
  const intent: StageRecoveryIntent = {
    version: ACTIVE_RECOVERY_VERSION, kstDate: i.kstDate,
    target: i.plan.target, deficit: i.plan.deficit, baselineReadyStock: i.plan.baselineReadyStock,
    collectMax: i.plan.collectMax,
    worksetLimit: i.plan.worksetLimit, nonce: randomUUID(), state: 'requested',
    createdAt: at, updatedAt: at, message: null,
  }
  const path = stageRecoveryIntentPath(i.kstDate, i.home)
  try {
    writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    return { created: true, intent }
  } catch (e) {
    if ((e as { code?: string }).code !== 'EEXIST') throw e
    const existing = readStageRecoveryArtifact(i.kstDate, i.home)
    if (existing.kind !== 'valid') throw new Error(`기존 stage recovery intent가 손상됐다 — ${existing.kind === 'corrupt' ? existing.reason : 'absent'}`)
    return { created: false, intent: existing.intent }
  }
}

export function updateStageRecoveryIntent(i: {
  intent: StageRecoveryIntent
  state: StageRecoveryIntentState
  now: Date
  message?: string | null
  home?: string
}): StageRecoveryIntent {
  return withIntentUpdateLock(i.intent.kstDate, i.home, () => {
    const current = validIntentOf(i.intent.kstDate, i.home)
    if (current === null || current.nonce !== i.intent.nonce) throw new Error('stage recovery intent 소유권이 달라졌다')
    const allowed = current.state === i.state
      || (current.state === 'requested' && (i.state === 'running' || i.state === 'failed'))
      || (current.state === 'running' && (i.state === 'done' || i.state === 'failed'))
    if (!allowed) throw new Error(`stage recovery 상태 전이가 잘못됐다: ${current.state}->${i.state}`)
    const next: StageRecoveryIntent = {
      ...current, state: i.state, updatedAt: i.now.toISOString(), message: i.message ?? null,
    }
    const path = stageRecoveryIntentPath(current.kstDate, i.home)
    const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`
    try {
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      renameSync(tmp, path)
    } finally {
      try { unlinkSync(tmp) } catch { /* 원자 교체 뒤 임시 파일 없음 */ }
    }
    return next
  })
}

export function stageRecoveryIntentMatchesPlan(
  intent: StageRecoveryIntent,
  plan: Extract<ActiveRecoveryPlan, { kind: 'recover' }>,
): boolean {
  return intent.target === plan.target
    && intent.deficit === plan.deficit
    && intent.baselineReadyStock === plan.baselineReadyStock
    && intent.collectMax === plan.collectMax
    && intent.worksetLimit === plan.worksetLimit
}

/**
 * 실행 중 원천이 늘어 부족분이 줄어드는 것은 정상 진전이다. 대상 단계·정본 묶음이 같고
 * 현재 부족분이 최초 intent보다 커지지만 않으면 같은 복구의 재판정으로 본다.
 */
export function stageRecoveryIntentCoversPlan(
  intent: StageRecoveryIntent,
  plan: Extract<ActiveRecoveryPlan, { kind: 'recover' }>,
): boolean {
  return intent.target === plan.target
    && intent.worksetLimit === plan.worksetLimit
    && plan.deficit <= intent.deficit
}

/**
 * controller가 겹쳐도 worker 실행권은 하루 한 프로세스만 얻는다. claim 생성과 intent
 * 전이 사이에 죽으면 재실행보다 안전 정지를 택한다. 07:55 controller와 07:58 fallback이 최종 결정을 맡는다.
 * 실행권이 이미 있을 때 intent를 다시 읽지 못하면 메모리의 옛 intent로 대신하지 않고 멈춘다.
 */
export function claimStageRecoveryLaunch(i: {
  intent: StageRecoveryIntent
  now: Date
  message: string
  home?: string
}): { claimed: boolean; intent: StageRecoveryIntent } {
  const path = stageRecoveryLaunchClaimPath(i.intent.kstDate, i.home)
  const claim = {
    version: ACTIVE_RECOVERY_VERSION,
    kstDate: i.intent.kstDate,
    nonce: i.intent.nonce,
    claimedAt: i.now.toISOString(),
  }
  try {
    writeFileSync(path, `${JSON.stringify(claim, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  } catch (e) {
    if ((e as { code?: string }).code !== 'EEXIST') throw e
    const current = readStageRecoveryArtifact(i.intent.kstDate, i.home)
    if (current.kind !== 'valid' || current.intent.nonce !== i.intent.nonce) {
      throw new Error(`stage recovery 실행권은 이미 있으나 intent를 확인하지 못했다 — ${current.kind === 'corrupt' ? current.reason : current.kind === 'absent' ? 'absent' : 'nonce 불일치'}`)
    }
    return { claimed: false, intent: current.intent }
  }
  try {
    return {
      claimed: true,
      intent: updateStageRecoveryIntent({
        intent: i.intent, state: 'running', now: i.now, message: i.message, home: i.home,
      }),
    }
  } catch (e) {
    throw new Error(`stage recovery 실행권은 얻었지만 running 전이에 실패했다: ${(e as Error).message}`)
  }
}

export type StageRecoveryClaim = { kstDate: string; nonce: string; deficit: number }

export function stageRecoveryClaimFromArgv(argv: readonly string[]): StageRecoveryClaim | null {
  const read = (name: string): string | null => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
  const kstDate = read('stage-recovery-date')
  const nonce = read('stage-recovery-nonce')
  const deficitRaw = read('stage-recovery-deficit')
  if (kstDate === null && nonce === null && deficitRaw === null) return null
  if (!validDate(kstDate) || nonce === null || nonce === '' || deficitRaw === null || !/^\d+$/.test(deficitRaw)) {
    throw new Error('stage recovery 인자가 불완전하다')
  }
  const deficit = Number(deficitRaw)
  if (!positive(deficit)) throw new Error('stage recovery 부족분이 잘못됐다')
  return { kstDate, nonce, deficit }
}

export function validateStageRecoveryClaim(claim: StageRecoveryClaim, home?: string): StageRecoveryIntent {
  const intent = validIntentOf(claim.kstDate, home)
  if (intent === null || intent.nonce !== claim.nonce || intent.deficit !== claim.deficit || intent.state !== 'running') {
    throw new Error('실행 중인 stage recovery intent와 인자가 일치하지 않는다')
  }
  return intent
}

/**
 * worker가 log open·deadline 계산처럼 본 실행 전 단계에서 실패해도 running intent를
 * 남기지 않는다. claim 소유권이 정확히 같은 active intent만 닫고, 위조·stale claim은
 * 다른 실행의 상태를 절대 바꾸지 않는다.
 */
export function failStageRecoveryClaimBestEffort(i: {
  claim: StageRecoveryClaim
  now: Date
  message: string
  home?: string
}): boolean {
  try {
    const current = validIntentOf(i.claim.kstDate, i.home)
    if (current === null || current.nonce !== i.claim.nonce || current.deficit !== i.claim.deficit) return false
    if (current.state === 'done' || current.state === 'failed') return true
    updateStageRecoveryIntent({
      intent: current, state: 'failed', now: i.now, message: i.message, home: i.home,
    })
    return true
  } catch {
    return false
  }
}

/** 공급 회차 id 모양(`supplyRunIdOf`) — 장부 줄의 `pipelineRunOfLedger`와 같은 값이다. */
const SUPPLY_RUN_ID_RE = /^\d{8}-\d{6}$/

export type StageRecoverySupplyStartClaim = {
  version: typeof ACTIVE_RECOVERY_VERSION
  kstDate: string
  nonce: string
  deficit: number
  /** 이 nonce의 공급 본체 회차 id — 첫 provider 요청 전에 기록돼 성공·실패 모두의 exact 비용 신원이 된다 */
  supplyRunId: string
  startedAt: string
}

/**
 * 같은 nonce의 공급 본체는 커널 lease 안에서도 단 한 번만 시작한다.
 * `main()`보다 먼저 `wx`로 쓰므로, 이 회차가 provider를 부르기 전에 runId 신원이 남는다.
 */
export function claimStageRecoverySupplyStart(i: {
  claim: StageRecoveryClaim
  supplyRunId: string
  now: Date
  home?: string
}): void {
  if (!SUPPLY_RUN_ID_RE.test(i.supplyRunId)) throw new Error(`stage recovery supply runId 모양이 잘못됐다: ${i.supplyRunId}`)
  const intent = validateStageRecoveryClaim(i.claim, i.home)
  mkdirSync(stageRecoveryDir(i.home), { recursive: true, mode: 0o700 })
  const path = stageRecoverySupplyStartClaimPath(i.claim.kstDate, i.home)
  const value: StageRecoverySupplyStartClaim = {
    version: ACTIVE_RECOVERY_VERSION,
    kstDate: intent.kstDate,
    nonce: intent.nonce,
    deficit: intent.deficit,
    supplyRunId: i.supplyRunId,
    startedAt: i.now.toISOString(),
  }
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  } catch (e) {
    if ((e as { code?: string }).code === 'EEXIST') {
      throw new Error('같은 stage recovery nonce의 공급 본체가 이미 시작됐다')
    }
    throw e
  }
}

/**
 * 시작 claim 판독 — 없음·정상·손상. 옛 형식(`supplyRunId` 없음)·다른 nonce/부족분·날짜 불일치는
 * 비용 신원을 증명하지 못하므로 손상이다. 정상 claim만 final 비용 cohort의 runId가 된다.
 */
export function readStageRecoverySupplyStartClaim(
  intent: Pick<StageRecoveryIntent, 'kstDate' | 'nonce' | 'deficit'>,
  home?: string,
): { kind: 'absent' } | { kind: 'valid'; claim: StageRecoverySupplyStartClaim } | { kind: 'corrupt'; reason: string } {
  let raw: string
  try { raw = readFileSync(stageRecoverySupplyStartClaimPath(intent.kstDate, home), 'utf-8') } catch (e) {
    return errorCode(e) === 'ENOENT' ? { kind: 'absent' }
      : { kind: 'corrupt', reason: `공급 시작 claim 읽기 실패 ${errorCode(e) ?? 'unknown'}` }
  }
  let value: unknown
  try { value = JSON.parse(raw) } catch { return { kind: 'corrupt', reason: '공급 시작 claim JSON 손상' } }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { kind: 'corrupt', reason: '공급 시작 claim 모양 손상' }
  const o = value as Record<string, unknown>
  if (o.version !== ACTIVE_RECOVERY_VERSION || !validDate(o.kstDate)
    || typeof o.nonce !== 'string' || o.nonce === '' || !positive(o.deficit)
    || typeof o.supplyRunId !== 'string' || !SUPPLY_RUN_ID_RE.test(o.supplyRunId)
    || typeof o.startedAt !== 'string' || !Number.isFinite(Date.parse(o.startedAt))) {
    return { kind: 'corrupt', reason: '공급 시작 claim이 옛 형식이거나 계약과 다르다' }
  }
  if (o.kstDate !== intent.kstDate || o.nonce !== intent.nonce || o.deficit !== intent.deficit) {
    return { kind: 'corrupt', reason: '공급 시작 claim이 오늘 intent와 다르다' }
  }
  return { kind: 'valid', claim: o as StageRecoverySupplyStartClaim }
}

/** provider 요청 경계가 intent 취소·nonce 위조·절대 마감을 매번 다시 확인한다. */
export function validateStageRecoveryRuntimeEnv(
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
  home?: string,
): StageRecoveryIntent | null {
  const kstDate = (env[ACTIVE_RECOVERY_DATE_ENV] ?? '').trim()
  if (kstDate === '') return null
  const nonce = (env[ACTIVE_RECOVERY_NONCE_ENV] ?? '').trim()
  const deficitRaw = (env[ACTIVE_RECOVERY_DEFICIT_ENV] ?? '').trim()
  const deadlineRaw = (env[ACTIVE_RECOVERY_DEADLINE_ENV] ?? '').trim()
  if (!validDate(kstDate) || nonce === '' || !/^\d+$/.test(deficitRaw) || deadlineRaw === '') {
    throw new Error('stage recovery runtime env가 불완전하다')
  }
  const deficit = Number(deficitRaw)
  const deadline = new Date(deadlineRaw)
  if (!positive(deficit) || !Number.isFinite(deadline.getTime()) || now.getTime() >= deadline.getTime()) {
    throw new Error('stage recovery 절대 마감이 끝났거나 runtime env가 잘못됐다')
  }
  return validateStageRecoveryClaim({ kstDate, nonce, deficit }, home)
}

/**
 * collector가 이미 본 원천의 영수증을 남길 때 쓰는 신원 검증이다. provider 경계와 달리
 * 현재 state·deadline은 요구하지 않는다. 상세 조회 뒤 intent가 취소되더라도 원천 hash를
 * 먼저 남겨 다음 자연 회차에서 새 원천으로 다시 세지 않는 것이 fail-closed다.
 */
export function validateStageRecoveryReceiptIdentityEnv(
  env: Readonly<Record<string, string | undefined>>,
  home?: string,
): StageRecoveryIntent | null {
  const kstDate = (env[ACTIVE_RECOVERY_DATE_ENV] ?? '').trim()
  if (kstDate === '') return null
  const nonce = (env[ACTIVE_RECOVERY_NONCE_ENV] ?? '').trim()
  const deficitRaw = (env[ACTIVE_RECOVERY_DEFICIT_ENV] ?? '').trim()
  if (!validDate(kstDate) || nonce === '' || !/^\d+$/.test(deficitRaw)) {
    throw new Error('stage recovery receipt identity env가 불완전하다')
  }
  const deficit = Number(deficitRaw)
  const intent = validIntentOf(kstDate, home)
  if (!positive(deficit) || intent === null || intent.nonce !== nonce || intent.deficit !== deficit) {
    throw new Error('stage recovery receipt identity가 intent와 일치하지 않는다')
  }
  return intent
}

export type StageRecoverySupplyReceipt = {
  version: typeof ACTIVE_RECOVERY_VERSION
  kstDate: string
  nonce: string
  deficit: number
  /** 이 복구가 실제로 실행한 supply-process 회차 id */
  supplyRunId: string
  completedAt: string
}

function parseSupplyReceipt(raw: string): StageRecoverySupplyReceipt | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (o.version !== ACTIVE_RECOVERY_VERSION || !validDate(o.kstDate)
    || typeof o.nonce !== 'string' || o.nonce === '' || !positive(o.deficit)
    || typeof o.supplyRunId !== 'string' || o.supplyRunId === ''
    || typeof o.completedAt !== 'string' || !Number.isFinite(Date.parse(o.completedAt))) return null
  return o as StageRecoverySupplyReceipt
}

/** 공급 본체가 실제로 완주했음을 worker 종료코드와 별도로 증명한다. */
export function writeStageRecoverySupplyReceipt(i: {
  claim: StageRecoveryClaim
  supplyRunId: string
  now: Date
  home?: string
}): void {
  if (i.supplyRunId.trim() === '') throw new Error('stage recovery supply runId가 비었다')
  const path = stageRecoverySupplyReceiptPath(i.claim.kstDate, i.home)
  const receipt: StageRecoverySupplyReceipt = {
    version: ACTIVE_RECOVERY_VERSION,
    kstDate: i.claim.kstDate,
    nonce: i.claim.nonce,
    deficit: i.claim.deficit,
    supplyRunId: i.supplyRunId,
    completedAt: i.now.toISOString(),
  }
  try {
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  } catch (e) {
    const existing = readStageRecoverySupplyReceipt(i.claim, i.home)
    if ((e as { code?: string }).code === 'EEXIST' && existing?.supplyRunId === i.supplyRunId) return
    throw e
  }
}

/** exact claim의 공급 완주 영수증. 다른 nonce·부족량·옛 형식은 인정하지 않는다. */
export function readStageRecoverySupplyReceipt(
  claim: StageRecoveryClaim, home?: string,
): StageRecoverySupplyReceipt | null {
  try {
    const receipt = parseSupplyReceipt(readFileSync(stageRecoverySupplyReceiptPath(claim.kstDate, home), 'utf-8'))
    return receipt !== null && receipt.kstDate === claim.kstDate
      && receipt.nonce === claim.nonce && receipt.deficit === claim.deficit ? receipt : null
  } catch { return null }
}

export function hasStageRecoverySupplyReceipt(claim: StageRecoveryClaim, home?: string): boolean {
  return readStageRecoverySupplyReceipt(claim, home) !== null
}
