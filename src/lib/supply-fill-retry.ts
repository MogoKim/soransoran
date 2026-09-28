/**
 * 공급 적재(fill) 재시도 · 이월 — 순수 판정 (2026-09-27)
 *
 * 🔴 **왜 생겼나** — 2026-09-27 14:15 KST 회차(`20260927-051506`)에서 판정·초안이 유료로 돌아
 *    후보 2건을 채택했는데, `fill` 이 Prisma `Can't reach database server` 로 죽었다.
 *    그 2건은 **아무도 다시 집지 않았다** — 다음 회차들은 자기 후보 파일만 적재한다(묶음 계약).
 *    유료로 만든 후보가 일시적인 연결 끊김 하나로 버려졌다.
 *
 * 🔴 **두 가지만 한다.**
 *    ① 회차 안 재시도 — **연결 계열 오류일 때만**, 몇 번만, 짧게 기다렸다가 같은 입력으로 다시 부른다.
 *       논리·검증·게이트 실패는 재시도하지 않는다(다시 돌려도 같은 답이 나오고, 가리는 것만 된다).
 *    ② 회차 사이 이월 — 앞 회차 중 **적재를 끝내지 못한** 후보 파일을 다음 회차 적재 입력에 얹는다.
 *       기한(24h)과 개수 상한이 있고, 품질 계약이 다른 파일은 **얹지 않는다**.
 *
 * 🔴 **중복 적재를 여기서 막지 않는다 — 적재기가 막는다.** 적재기(`micro-seed-supply-autofill`)는
 *    시도마다 큐를 **새로 읽고**, 이미 올라간 후보를 `provenanceKeyOf` 로 `ALREADY` 처리하며,
 *    건별 `$transaction` 으로 RawContent+Queue 를 함께 만든다(반쯤 들어간 건이 없다).
 *    그래서 커밋 직후 연결이 끊겨 "실패" 로 보인 시도를 다시 돌려도 그 건은 `ALREADY` 로 빠진다.
 *    같은 기계에서 두 처리기가 겹치지 않는 것은 러너의 lock 이 보장한다.
 *
 * 🔴 **보류·형제·계약·profile 관문은 그대로다.** 이월 파일도 적재기의 `planRefill` 을 똑같이 지난다.
 *    여기는 "무엇을 다시 먹일지" 만 정하고, "무엇을 넣을지" 는 정하지 않는다.
 */

import { qualityContractMismatch, type Envelope, type SkipCode } from './micro-seed-supply-autofill'

// ─────────────────────────────────────────────────────────
// ① 회차 안 재시도
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **일시적 DB 연결 오류의 정본** — Prisma 오류 코드와 그 코드가 찍는 문구.
 *
 *    `PrismaClientInitializationError` 는 `errorCode: undefined` 로 찍힐 때가 있다(2026-09-27 실측) —
 *    그래서 코드만 보지 않고 **Prisma 가 쓰는 고정 문구**도 함께 본다.
 *
 *    P1001  Can't reach database server
 *    P1002  The database server was reached but timed out
 *    P1008  Operations timed out
 *    P1017  Server has closed the connection
 *    P2024  Timed out fetching a new connection from the connection pool
 */
export const TRANSIENT_DB_SIGNATURES: readonly { code: string; re: RegExp }[] = [
  { code: 'P1001', re: /\bP1001\b|Can't reach database server/ },
  { code: 'P1002', re: /\bP1002\b|database server at .* was reached but timed out/ },
  { code: 'P1008', re: /\bP1008\b|Operations timed out after/ },
  { code: 'P1017', re: /\bP1017\b|Server has closed the connection/ },
  { code: 'P2024', re: /\bP2024\b|Timed out fetching a new connection from the connection pool/ },
]

/**
 * 🔴 **재시도하면 안 되는 표시** — 하나라도 있으면 연결 문구가 섞여 있어도 재시도하지 않는다.
 *
 *    `🔴 중단:`        적재기의 `fail()` — 입력 파일 없음 등 논리 실패
 *    `⑥ 정합 🔴 이상`  적재 뒤 수가 맞지 않는다 — 다시 돌리면 가려진다
 *    `FILL_REPORT`     적재기가 **끝까지 돌았다** — 그 뒤의 실패는 연결 탓이 아니다
 *    `PrismaClientValidationError` · 연결 계열이 아닌 `P2xxx` — 데이터·질의가 틀렸다
 */
export const FATAL_MARKERS: readonly { code: string; re: RegExp }[] = [
  { code: 'LOADER_ABORT', re: /🔴 중단:/ },
  { code: 'VERIFY_MISMATCH', re: /⑥ 정합 🔴 이상/ },
  { code: 'REPORTED', re: /^FILL_REPORT /m },
  { code: 'PRISMA_VALIDATION', re: /PrismaClientValidationError/ },
  { code: 'PRISMA_REQUEST', re: /\bP2(?!024\b)\d{3}\b/ },
]

export type FillAttemptResult = { code: number | null; out: string; spawnError: string }

export type FillAttemptKind =
  | { kind: 'ok' }
  | { kind: 'transient'; code: string }
  | { kind: 'fatal'; code: string }

/**
 * 한 번의 적재 시도를 분류한다 — 🔴 **모르면 재시도하지 않는다**(fail-closed).
 *
 *    재시도는 "연결 문구가 있고, 재시도 금지 표시가 없고, 프로세스가 정상적으로 떴다가
 *    비정상 종료했을 때" 뿐이다. 신호로 죽었거나(`code === null`) 뜨지 못했으면 재시도하지 않는다.
 */
export function classifyFillAttempt(r: FillAttemptResult): FillAttemptKind {
  if (r.code === 0 && r.spawnError === '') return { kind: 'ok' }
  if (r.spawnError !== '') return { kind: 'fatal', code: 'SPAWN' }
  if (r.code === null) return { kind: 'fatal', code: 'SIGNAL' }
  for (const m of FATAL_MARKERS) if (m.re.test(r.out)) return { kind: 'fatal', code: m.code }
  for (const s of TRANSIENT_DB_SIGNATURES) if (s.re.test(r.out)) return { kind: 'transient', code: s.code }
  return { kind: 'fatal', code: 'UNKNOWN' }
}

/**
 * 🔴 **재시도 상한** — 총 3회(재시도 2회) · 대기 30초 → 90초 · 적재 단계 전체 5분 안.
 *    lock TTL(45분) · 한 회차 실측(판정 12분)과 비교해 훨씬 작다. 끊김이 길면 **다음 회차의 이월**이 받는다.
 */
export const FILL_RETRY_POLICY = {
  maxAttempts: 3,
  delaysMs: [30_000, 90_000] as readonly number[],
  budgetMs: 5 * 60_000,
} as const

export type FillRetryPolicy = { maxAttempts: number; delaysMs: readonly number[]; budgetMs: number }

export type FillAttemptLog = {
  attempt: number
  exitCode: number | null
  kind: FillAttemptKind['kind']
  code: string
  /** 이 시도에서 적재기가 실제로 만든 큐 행 수 (`✅ queue=` 줄) */
  loaded: number
}

/** 적재기가 이 시도에서 실제로 만든 큐 행 수 — 🔴 커밋된 건마다 한 줄이 찍힌다 */
export function loadedLinesOf(out: string): number {
  return (out.match(/^\s*✅ queue=/gm) ?? []).length
}

export type FillRetryOutcome = {
  ok: boolean
  final: FillAttemptResult
  attempts: FillAttemptLog[]
  /** 재시도 횟수 (시도 수 − 1) */
  retries: number
  /** 🔴 모든 시도에서 실제로 커밋된 큐 행 합 */
  loadedAcrossAttempts: number
  /** 재시도를 멈춘 이유 — 성공이면 빈 문자열 */
  stopReason: string
}

/**
 * 적재를 돌리고, **일시적 연결 오류일 때만** 다시 돌린다.
 *
 * 🔴 입력·인자를 시도마다 바꾸지 않는다. `runOnce` 는 같은 명령을 다시 부를 뿐이다.
 * 🔴 대기·시계는 주입한다 — 검사가 실제로 기다리지 않고 경계를 잰다.
 */
export async function runFillWithRetry(input: {
  runOnce: (attempt: number) => Promise<FillAttemptResult>
  sleep: (ms: number) => Promise<void>
  nowMs: () => number
  policy?: FillRetryPolicy
  onRetry?: (a: FillAttemptLog, waitMs: number) => void
}): Promise<FillRetryOutcome> {
  const policy = input.policy ?? FILL_RETRY_POLICY
  const started = input.nowMs()
  const attempts: FillAttemptLog[] = []
  let final: FillAttemptResult = { code: null, out: '', spawnError: 'not-run' }
  let stopReason = ''
  for (let i = 1; i <= Math.max(1, policy.maxAttempts); i += 1) {
    final = await input.runOnce(i)
    const k = classifyFillAttempt(final)
    const log: FillAttemptLog = {
      attempt: i, exitCode: final.code, kind: k.kind,
      code: k.kind === 'ok' ? '' : k.code, loaded: loadedLinesOf(final.out),
    }
    attempts.push(log)
    if (k.kind === 'ok') { stopReason = ''; break }
    if (k.kind === 'fatal') { stopReason = `재시도하지 않는 실패(${k.code})`; break }
    if (i >= policy.maxAttempts) { stopReason = `재시도 상한 ${policy.maxAttempts}회에 닿았다(${k.code})`; break }
    const wait = policy.delaysMs[i - 1] ?? policy.delaysMs[policy.delaysMs.length - 1] ?? 0
    if (input.nowMs() - started + wait > policy.budgetMs) {
      stopReason = `적재 단계 시간 상한 ${Math.round(policy.budgetMs / 1000)}초를 넘긴다(${k.code})`
      break
    }
    input.onRetry?.(log, wait)
    await input.sleep(wait)
  }
  const last = attempts[attempts.length - 1]
  return {
    ok: last?.kind === 'ok',
    final, attempts,
    retries: Math.max(0, attempts.length - 1),
    loadedAcrossAttempts: attempts.reduce((n, a) => n + a.loaded, 0),
    stopReason,
  }
}

// ─────────────────────────────────────────────────────────
// 적재기 보고 — 🔴 파일별 결과가 "끝냈는가" 의 증거다
// ─────────────────────────────────────────────────────────

export const FILL_REPORT_PREFIX = 'FILL_REPORT '

/**
 * 적재기가 끝에 한 줄로 찍는 결과. 🔴 파일별로 센다 — 이월이 "그 파일을 끝냈는가" 를 여기서 읽는다.
 *
 *    `skipped`  적재기 관문의 코드(`SkipCode`) + 적재 직전 재검증(`RECHECK`) · payload 거절(`PAYLOAD`)
 *    `cut`      관문은 지났는데 **상한 때문에 이번에 넣지 못한** 수 — 0 이 아니면 그 파일은 안 끝났다
 */
export type FillSkipCode = SkipCode | 'RECHECK' | 'PAYLOAD'
export type FillReportFile = {
  name: string
  candidates: number
  loaded: number
  skipped: Partial<Record<FillSkipCode, number>>
  cut: number
}
export type FillReport = {
  applied: boolean
  loaded: number
  cut: number
  skipped: Partial<Record<FillSkipCode, number>>
  files: FillReportFile[]
}

/** 마지막 보고 한 줄을 읽는다 — 🔴 모양이 틀리면 `null`(모른다) */
export function parseFillReport(out: string): FillReport | null {
  const lines = out.split('\n').filter((l) => l.startsWith(FILL_REPORT_PREFIX))
  const last = lines[lines.length - 1]
  if (last === undefined) return null
  try {
    const j = JSON.parse(last.slice(FILL_REPORT_PREFIX.length)) as FillReport
    if (!Array.isArray(j.files) || typeof j.loaded !== 'number') return null
    return j
  } catch { return null }
}

// ─────────────────────────────────────────────────────────
// ② 회차 사이 이월
// ─────────────────────────────────────────────────────────

/** 🔴 이월 기한 — 하루. 그보다 오래된 후보는 시의성이 떨어진다 */
export const CARRY_OVER_LOOKBACK_MS = 24 * 3_600_000
/** 🔴 한 회차가 이월로 얹는 파일 수 상한 */
export const CARRY_OVER_MAX_FILES = 3

const CAND_RE = /^auto-draft-(\d{8}-\d{6})\.candidates\.json$/

/** `auto-draft-<runId>.candidates.json` → `<runId>` · 모양이 아니면 `null` */
export function candidatesRunIdOf(name: string): string | null {
  const m = CAND_RE.exec(name.split('/').pop() ?? name)
  return m === null ? null : m[1]!
}

/** 회차 id(`YYYYMMDD-HHMMSS`, UTC — 러너의 `runIdOf`) → 시각 */
export function runIdTimeMs(runId: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(runId)
  if (m === null) return null
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
  return Number.isNaN(t) ? null : t
}

/** 회차 기록 중 이월 판정이 읽는 칸만 */
export type CarryRunRecord = {
  runId: string
  stages: readonly { stage: string; status: string }[]
  fill?: {
    ok: boolean
    report: FillReport | null
    inputs: readonly string[]
  }
}

/** 후보 파일 한 장 — 봉투와 후보 수만 읽는다 */
export type CarryCandidateFile = {
  name: string
  envelope: Envelope | null
  candidateCount: number
  /**
   * 🔴 **후보들의 원천** (2026-09-28) — 사이트와 원문 id 만. 제목·본문은 읽지 않는다.
   *    이월로 적재될 원천을 이번 회차 묶음이 **다시 만들지 않게** 넘긴다(`selectWorkset` 의 `carriedOver`).
   */
  sources?: readonly CarrySource[]
}

export type CarrySource = { sourceSite: string; sourceArticleId: string }

export type CarryRejectCode =
  | 'CURRENT' | 'NAME' | 'NO_RUN' | 'DRAFT_NOT_OK' | 'COMPLETED' | 'STALE' | 'FUTURE'
  | 'UNREADABLE' | 'EMPTY' | 'CONTRACT' | 'OVER_MAX'

export const CARRY_REJECT_LABEL: Record<CarryRejectCode, string> = {
  CURRENT: '이번 회차 파일 — 이월이 아니다',
  NAME: '후보 파일 이름 모양이 아니다',
  NO_RUN: '만든 회차 기록이 없다 — 끝냈는지 알 수 없어 얹지 않는다',
  DRAFT_NOT_OK: '만든 회차의 초안 단계가 성공하지 않았다',
  COMPLETED: '적재를 이미 끝냈다',
  STALE: '이월 기한(24h)을 넘겼다',
  FUTURE: '회차 시각이 지금보다 뒤다',
  UNREADABLE: '파일을 읽지 못했다',
  EMPTY: '후보가 0건이다',
  CONTRACT: '🔴 품질 계약이 지금 코드와 다르다 — 다른(수정 전) 코드가 만든 파일이다',
  OVER_MAX: `한 회차 이월 상한(${CARRY_OVER_MAX_FILES}개)을 넘었다 — 다음 회차가 집는다`,
}

/**
 * 🔴 **"적재를 끝냈다" 의 정본** — 회차 기록에서만 읽는다.
 *
 *    새 기록(`fill` 칸이 있다): 적재가 성공했고(`ok`) 보고서에 그 파일이 있으며 `cut === 0`.
 *      보고서가 없으면 끝낸 것으로 보지 않는다 — 모르는 것을 안다고 하지 않는다.
 *    옛 기록(`fill` 칸이 없다 · 이 PR 전): 이월이 없던 시절이라 자기 파일만 먹었다 →
 *      자기 회차의 `fill` 단계가 `ok` 면 자기 파일을 끝낸 것이다.
 */
export function completedCandidateFiles(runs: readonly CarryRunRecord[]): Set<string> {
  const done = new Set<string>()
  for (const r of runs) {
    if (r.fill !== undefined) {
      if (!r.fill.ok || r.fill.report === null) continue
      for (const f of r.fill.report.files) if (f.cut === 0) done.add(f.name)
      continue
    }
    if (r.stages.some((s) => s.stage === 'fill' && s.status === 'ok')) {
      done.add(`auto-draft-${r.runId}.candidates.json`)
    }
  }
  return done
}

export type CarryPick = { name: string; runId: string; candidateCount: number; sources: readonly CarrySource[] }

/**
 * 이월할 후보 파일을 고른다 — 🔴 **순수 함수.**
 *
 *    얹는 조건(전부):
 *      · 이름이 `auto-draft-<runId>.candidates.json` 이고 이번 회차 파일이 아니다
 *      · 그 회차 기록이 있고 **초안 단계가 ok** 였다(초안이 실패한 회차의 파일은 믿지 않는다)
 *      · 어느 회차 기록도 그 파일을 **끝냈다고** 하지 않는다(`completedCandidateFiles`)
 *      · 기한 안이다(지금 − 24h ≤ 회차 시각 ≤ 지금)
 *      · 파일을 읽었고 후보가 1건 이상이다
 *      · 🔴 **품질 계약이 지금 코드와 같다** — 적재기와 **같은 함수**(`qualityContractMismatch`)로 본다.
 *        적재기의 `CONTRACT` 관문도 그대로 남는다(두 겹이다. 여기서 빼도 적재기가 막는다).
 *    오래된 것부터 `maxFiles` 개까지. 🔴 **적재 건수 상한은 여기서 늘리지 않는다** —
 *    적재기의 `--up-to` 는 이월이 있어도 이번 회차 상한 그대로다.
 */
export function selectCarryOver(input: {
  files: readonly CarryCandidateFile[]
  runs: readonly CarryRunRecord[]
  currentRunId: string
  nowMs: number
  lookbackMs?: number
  maxFiles?: number
}): { picked: CarryPick[]; rejected: { name: string; code: CarryRejectCode }[] } {
  const lookback = input.lookbackMs ?? CARRY_OVER_LOOKBACK_MS
  const maxFiles = input.maxFiles ?? CARRY_OVER_MAX_FILES
  const byRun = new Map(input.runs.map((r) => [r.runId, r]))
  const done = completedCandidateFiles(input.runs)
  const ok: CarryPick[] = []
  const rejected: { name: string; code: CarryRejectCode }[] = []
  for (const f of input.files) {
    const name = f.name.split('/').pop() ?? f.name
    const runId = candidatesRunIdOf(name)
    if (runId === null) { rejected.push({ name, code: 'NAME' }); continue }
    if (runId === input.currentRunId) { rejected.push({ name, code: 'CURRENT' }); continue }
    const t = runIdTimeMs(runId)
    if (t === null) { rejected.push({ name, code: 'NAME' }); continue }
    if (t > input.nowMs) { rejected.push({ name, code: 'FUTURE' }); continue }
    if (input.nowMs - t > lookback) { rejected.push({ name, code: 'STALE' }); continue }
    const run = byRun.get(runId)
    if (run === undefined) { rejected.push({ name, code: 'NO_RUN' }); continue }
    if (!run.stages.some((s) => s.stage === 'draft' && s.status === 'ok')) {
      rejected.push({ name, code: 'DRAFT_NOT_OK' }); continue
    }
    if (done.has(name)) { rejected.push({ name, code: 'COMPLETED' }); continue }
    if (f.envelope === null) { rejected.push({ name, code: 'UNREADABLE' }); continue }
    if (f.candidateCount < 1) { rejected.push({ name, code: 'EMPTY' }); continue }
    if (qualityContractMismatch(f.envelope).length > 0) { rejected.push({ name, code: 'CONTRACT' }); continue }
    ok.push({ name, runId, candidateCount: f.candidateCount, sources: f.sources ?? [] })
  }
  ok.sort((a, b) => a.runId.localeCompare(b.runId))
  const picked = ok.slice(0, Math.max(0, maxFiles))
  for (const x of ok.slice(picked.length)) rejected.push({ name: x.name, code: 'OVER_MAX' })
  return { picked, rejected }
}

// ─────────────────────────────────────────────────────────
// 적재 인자 — 🔴 `--input` 한 칸만 다룬다. 다른 인자는 계획이 정한 그대로다
// ─────────────────────────────────────────────────────────

/** `--input=a,b` → `[a, b]` */
export function fillInputsOf(args: readonly string[]): string[] {
  const hit = args.find((a) => a.startsWith('--input='))
  if (hit === undefined) return []
  return hit.slice('--input='.length).split(',').map((s) => s.trim()).filter((s) => s !== '')
}

/**
 * 🔴 **실행 직전에 없는 파일만 뺀다** — 이번 회차 초안이 보류돼 자기 후보 파일이 없어도
 *    이월 파일은 적재된다. 전부 없으면 계획 그대로 둔다(적재기가 "파일 없음" 으로 멈춘다 — 이 PR 전과 같다).
 */
export function resolveFillArgs(
  args: readonly string[], exists: (p: string) => boolean,
): { args: string[]; missing: string[] } {
  const inputs = fillInputsOf(args)
  if (inputs.length === 0) return { args: [...args], missing: [] }
  const present = inputs.filter((p) => exists(p))
  const missing = inputs.filter((p) => !exists(p))
  if (present.length === 0 || missing.length === 0) return { args: [...args], missing }
  return {
    args: args.map((a) => (a.startsWith('--input=') ? `--input=${present.join(',')}` : a)),
    missing,
  }
}

// ─────────────────────────────────────────────────────────
// 회차 기록 — 🔴 러너와 검사가 **같은 함수**로 만든다 (fixture 가 기록 모양을 지어내지 않게)
// ─────────────────────────────────────────────────────────

export type FillRecord = {
  /** 적재기에 실제로 넘긴 파일 (basename) */
  inputs: string[]
  /** 그중 앞 회차에서 이월한 파일 */
  carriedOver: string[]
  /** 이월 후보였지만 얹지 않은 파일과 이유 (끝낸 것 · 이번 회차 것은 뺀다) */
  carryRejected: { name: string; code: CarryRejectCode }[]
  /** 실행 직전에 없어 뺀 파일 */
  missing: string[]
  attempts: FillAttemptLog[]
  retries: number
  /** 모든 시도에서 실제로 커밋된 큐 행 합 */
  loadedAcrossAttempts: number
  ok: boolean
  stopReason: string
  /** 마지막 시도의 적재기 보고 — 없으면 `null`(끝냈는지 모른다) */
  report: FillReport | null
}

const baseName = (p: string): string => p.split('/').pop() ?? p

export function buildFillRecord(input: {
  args: readonly string[]
  missing: readonly string[]
  carryOverPaths: readonly string[]
  carryRejected: readonly { name: string; code: CarryRejectCode }[]
  outcome: FillRetryOutcome
}): FillRecord {
  const fed = fillInputsOf(input.args).map(baseName)
  const carried = new Set(input.carryOverPaths.map(baseName))
  return {
    inputs: fed,
    carriedOver: fed.filter((n) => carried.has(n)),
    carryRejected: input.carryRejected.filter((x) => x.code !== 'COMPLETED' && x.code !== 'CURRENT'),
    missing: input.missing.map(baseName),
    attempts: input.outcome.attempts,
    retries: input.outcome.retries,
    loadedAcrossAttempts: input.outcome.loadedAcrossAttempts,
    ok: input.outcome.ok,
    stopReason: input.outcome.stopReason,
    report: parseFillReport(input.outcome.final.out),
  }
}

/** 코드별 수를 한 줄로 — `ALREADY 2 · CONTRACT 1` */
export function describeSkips(s: Partial<Record<string, number>>): string {
  const parts = Object.entries(s).filter(([, n]) => (n ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, n]) => `${k} ${n}`)
  return parts.length === 0 ? '없음' : parts.join(' · ')
}
