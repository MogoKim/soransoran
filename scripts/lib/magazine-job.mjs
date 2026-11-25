/**
 * Magazine vNext S4 — Job 저장소 (runbook §0.0B.1 "Job — 글 하나의 실행 기록").
 *
 *   <jobsRoot>/<planHash>/job.json          magazine-job/1 — 파생할 수 없는 사실만 (상태는 jobState 가 계산한다)
 *   <jobsRoot>/<planHash>/request-<n>.key    요청 키 — O_EXCL 로 한 번만 생긴다(같은 키의 두 번째 전송 0)
 *   <jobsRoot>/<planHash>/raw-<n>.json       provider 응답 바이트 그대로(제출 · 회수) — 해석 전에 먼저 원자 저장한다
 *   <jobsRoot>/<planHash>/draft-<k>.json     작업 중 원고(수리 단계마다 새 파일)
 *   <jobsRoot>/<planHash>/manuscript.json    최종 채택 원고 1개 — release 가 읽는 계약(lib/magazine-release-candidates.mjs)
 *   <jobsRoot>/<planHash>/hero-source-<n>.bin · hero.webp
 *
 * 🔴 release 쪽 판독 계약(schemaVersion · planId · planHash · providerPlanHash · slugProposal · manuscript · validation · hero · hold)은
 *    lib/magazine-release-candidates.mjs 가 정본이다 — 여기서 이름을 바꾸지 않는다.
 * 🔴 쓰기는 전부 temp → fsync → rename(lib/magazine-release-journal.mjs 의 writeFileAtomic). 지우지 않는다(HOLD 도 기록으로 남긴다).
 */
import * as nodeFs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { recoverMagazineLock } from './magazine-lock-recovery.mjs'
import { JOB_SCHEMA } from './magazine-release-candidates.mjs'
import { writeFileAtomic } from './magazine-release-journal.mjs'

export { JOB_SCHEMA }
export const HEX64 = /^[0-9a-f]{64}$/
/** planHash 당 provider 요청 기록 상한 — 원고 1 + 재생성 1 + 수리 2 + 이미지 2 + 거절 재시도 여유. 넘으면 그 Job HOLD */
export const MAX_REQUESTS = 12
/** 사건 기록 상한 — 오래된 것부터 버리지 않고, 넘으면 더 적지 않는다(마지막 줄에 생략 수만 센다) */
export const MAX_EVENTS = 40
/** 진행 중으로 보는 요청 상태 — planHash 당 이 상태의 요청은 1개 이하다 */
export const OPEN_REQUEST = Object.freeze(['SUBMITTING', 'SUBMITTED', 'UNKNOWN'])

export class JobError extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; this.why = why }
}
const fail = (code, why) => { throw new JobError(code, why) }
export const sha256 = (b) => createHash('sha256').update(b).digest('hex')

export const jobDirOf = (jobsRoot, planHash) => {
  if (!HEX64.test(String(planHash))) fail('PLAN_HASH_INVALID', String(planHash))
  return join(jobsRoot, planHash)
}
const jobPathOf = (jobsRoot, planHash) => join(jobDirOf(jobsRoot, planHash), 'job.json')

/** 한 Job 판독 — 없으면 null · 깨졌으면 { broken } (지우지 않는다) */
export function readJob(jobsRoot, planHash, { fs = nodeFs } = {}) {
  let text
  try { text = fs.readFileSync(jobPathOf(jobsRoot, planHash), 'utf8') } catch (e) { if (e?.code === 'ENOENT') return null; return { broken: true, why: e?.code ?? 'READ_FAILED' } }
  try {
    const j = JSON.parse(text)
    if (j?.schemaVersion !== JOB_SCHEMA || j.planHash !== planHash || typeof j.planId !== 'string' || !Array.isArray(j.requests)) return { broken: true, why: 'SCHEMA' }
    return j
  } catch { return { broken: true, why: 'JSON' } }
}

/** 저장소의 Job 전부 — planHash 순. 64자리 hex 폴더만 본다(잠금 · 결과 폴더는 무시) */
export function listJobs(jobsRoot, { fs = nodeFs } = {}) {
  let dirs = []
  try { dirs = fs.readdirSync(jobsRoot) } catch (e) { if (e?.code === 'ENOENT') return []; fail('JOBS_UNREADABLE', e?.code ?? 'READ_FAILED') }
  return dirs.filter((d) => HEX64.test(d)).sort().map((planHash) => ({ planHash, job: readJob(jobsRoot, planHash, { fs }) })).filter((x) => x.job)
}

/** 새 Job 폴더 — 이미 있으면 만들지 않는다(같은 planHash 의 두 번째 Job 0) */
export function createJob(jobsRoot, job, { fs = nodeFs } = {}) {
  fs.mkdirSync(jobsRoot, { recursive: true, mode: 0o700 })
  const dir = jobDirOf(jobsRoot, job.planHash)
  try { fs.mkdirSync(dir, { mode: 0o700 }) } catch (e) { if (e?.code === 'EEXIST') fail('JOB_EXISTS', job.planHash); throw e }
  return writeJob(jobsRoot, job, { fs })
}

export function writeJob(jobsRoot, job, { fs = nodeFs, nowIso = null } = {}) {
  const next = nowIso ? { ...job, updatedAt: nowIso } : job
  writeFileAtomic(jobPathOf(jobsRoot, job.planHash), `${JSON.stringify(next, null, 2)}\n`, { fs, tag: `job-${process.pid}`, mode: 0o600 })
  return next
}

/** 산출물 원자 저장 → 다시 읽어 해시 대조. 다르면 멈춘다(그 바이트를 기록하지 않는다) */
export function writeArtifact(jobsRoot, planHash, file, data, { fs = nodeFs } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(file)) fail('ARTIFACT_NAME_INVALID', file)
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
  const path = join(jobDirOf(jobsRoot, planHash), file)
  writeFileAtomic(path, bytes, { fs, tag: `art-${process.pid}`, mode: 0o600 })
  const back = sha256(fs.readFileSync(path))
  if (back !== sha256(bytes)) fail('ARTIFACT_VERIFY_FAILED', `${file} 를 다시 읽은 해시가 다르다`)
  return { file, sha256: back }
}

export const readArtifact = (jobsRoot, planHash, file, { fs = nodeFs } = {}) => fs.readFileSync(join(jobDirOf(jobsRoot, planHash), file))
export const artifactExists = (jobsRoot, planHash, file, { fs = nodeFs } = {}) => fs.existsSync(join(jobDirOf(jobsRoot, planHash), file))

/**
 * 요청 키 — 전송 직전에 O_EXCL 로 만든다. 이미 있으면 REQUEST_KEY_EXISTS(같은 요청을 두 번 보내지 않는다).
 * 키 이름에는 비밀이 없다. provider 로 보내지 않는다(로컬 신원일 뿐이다).
 */
export function createRequestKey(jobsRoot, planHash, n, { fs = nodeFs, nowIso, runId } = {}) {
  const file = `request-${n}.key`
  const path = join(jobDirOf(jobsRoot, planHash), file)
  let fd
  try { fd = fs.openSync(path, 'wx', 0o600) } catch (e) { if (e?.code === 'EEXIST') fail('REQUEST_KEY_EXISTS', `${planHash.slice(0, 12)} 요청 ${n} 은 이미 만들어졌다 — 다시 보내지 않는다`); throw e }
  try { fs.writeSync(fd, `${JSON.stringify({ planHash, n, runId, at: nowIso, nonce: randomUUID() })}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  return file
}

// ── 사건 · 상태 · 비용 ───────────────────────────────────────

/** 사건 한 줄 — 상한을 넘으면 마지막 줄의 생략 수만 늘린다 */
export function addEvent(job, event) {
  const events = [...(job.events ?? [])]
  if (events.length < MAX_EVENTS - 1) events.push(event)
  else if (events.length === MAX_EVENTS - 1) events.push({ code: 'EVENTS_TRUNCATED', omitted: 1 })
  else events[events.length - 1] = { ...events[events.length - 1], omitted: (events[events.length - 1].omitted ?? 0) + 1 }
  return { ...job, events }
}

export const openRequestOf = (job) => {
  const open = (job.requests ?? []).filter((r) => OPEN_REQUEST.includes(r.status))
  if (open.length > 1) fail('MULTIPLE_OPEN_REQUESTS', `${job.planHash.slice(0, 12)} 에 진행 중 요청이 ${open.length}개다`)
  return open[0] ?? null
}

/**
 * 파생 상태 — 저장하지 않는다 (runbook §0.0B.1 상태도).
 * HOLD > IN_RELEASE 류는 release 가 판정한다(여기는 생성 쪽 상태까지).
 */
export function jobState(job) {
  if (job.hold) return 'HOLD'
  const open = (job.requests ?? []).find((r) => OPEN_REQUEST.includes(r.status))
  if (open) return open.status === 'UNKNOWN' ? 'SUBMISSION_UNKNOWN' : open.status === 'SUBMITTING' ? 'SUBMISSION_UNKNOWN' : 'SUBMITTED'
  if (job.validation?.verdict === 'VALID' && job.hero && job.manuscript) return 'HERO_READY'
  if (job.validation?.verdict === 'VALID') return 'VALID'
  if (job.draft) {
    const pendingDelete = (job.requests ?? []).some((r) => r.status === 'COMPLETED' && r.mode === 'STORE' && !['DELETED', 'NOT_FOUND'].includes(r.deletion?.result))
    if (job.validation?.verdict === 'NEEDS_REPAIR') return 'NEEDS_REPAIR'
    return pendingDelete ? 'GENERATED' : 'REMOTE_DELETED'
  }
  return 'PLANNED'
}

/** 그 Job 의 비용 합계(USD) — 실제 값이 없으면 예약한 최악 추정치를 그대로 센다(낮춰 잡지 않는다) */
export const jobCostUsd = (job) => (job.requests ?? []).reduce((s, r) => s + (Number.isFinite(r.costUsd) ? r.costUsd : 0), 0)

/** KST 달(YYYY-MM)의 비용 합계 — 모든 Job 의 요청 중 그 달에 만든 것 */
export const kstMonthOf = (iso) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 7)
export function monthCostUsd(jobs, month) {
  let s = 0
  for (const { job } of jobs) for (const r of job?.requests ?? []) if (r.createdAt && kstMonthOf(r.createdAt) === month && Number.isFinite(r.costUsd)) s += r.costUsd
  return s
}
/** canary 단계 비용 합계 — 단계 표식이 S5_CANARY 인 요청 전부(달과 무관) */
export function stageCostUsd(jobs, stage) {
  let s = 0
  for (const { job } of jobs) for (const r of job?.requests ?? []) if (r.stage === stage && Number.isFinite(r.costUsd)) s += r.costUsd
  return s
}

// ── 생산기 잠금 — 한 저장소에 생산 회차는 하나 ─────────────────

const pidAliveDefault = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' } }

/**
 * `<jobsRoot>/.produce.lock` 을 O_EXCL 로 쥔다. 살아 있는 pid 면 PRODUCE_LOCK_HELD — 기다리지도 지우지도 않는다.
 * 죽은 pid의 잠금은 커널 잠금 아래서 현재 소유자를 대조한 뒤 회수한다. 판독 불가 잠금은 사람 몫이다.
 */
export function acquireProduceLock({ jobsRoot, fs = nodeFs, pid = process.pid, pidAlive = pidAliveDefault, nowIso }) {
  fs.mkdirSync(jobsRoot, { recursive: true, mode: 0o700 })
  const path = join(jobsRoot, '.produce.lock')
  const token = `${pid}-${randomUUID()}`
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(path, 'wx', 0o600)
      try { fs.writeSync(fd, `${JSON.stringify({ pid, token, at: nowIso })}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      return { ok: true, release: () => { try { if (fs.readFileSync(path, 'utf8').includes(token)) fs.rmSync(path, { force: true }) } catch { /* 이미 없다 */ } } }
    } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false, code: 'PRODUCE_LOCK_FAILED', why: e?.code ?? 'OPEN_FAILED' }
      let holder = null
      try { holder = JSON.parse(fs.readFileSync(path, 'utf8')) } catch { holder = null }
      if (!holder || !Number.isSafeInteger(holder.pid)) return { ok: false, code: 'PRODUCE_LOCK_CORRUPT', why: `${path} 를 읽지 못했다 — 자동으로 지우지 않는다` }
      if (pidAlive(holder.pid)) return { ok: false, code: 'PRODUCE_LOCK_HELD', why: `생산 회차(pid ${holder.pid})가 이미 돈다` }
      try {
        if (recoverMagazineLock({ fs, path, observed: holder, pidAlive })) continue
      } catch (e) {
        if (e.code !== 'ENOENT') return { ok: false, code: 'PRODUCE_LOCK_FAILED', why: e.code ?? 'RECOVERY_FAILED' }
      }
      return { ok: false, code: 'PRODUCE_LOCK_HELD', why: '다른 회차가 잠금을 회수 중이다' }
    }
  }
  return { ok: false, code: 'PRODUCE_LOCK_HELD', why: '잠금을 얻지 못했다' }
}
