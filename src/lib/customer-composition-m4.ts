import { Prisma, PrismaClient } from '@prisma/client'

import { REAL_MEMBER_WHERE } from '@/lib/admin-format'
import { AGREEMENT_TYPE } from '@/lib/agreement-policy'
import {
  AGE_BAND_ORDER,
  FIFTIES_BANDS,
  kstBaseYear,
  parseBirthyear,
  parseEnvList,
  sumBands,
  totalOf,
  type AgeCounts,
} from '@/lib/customer-composition'
import {
  activeFemaleCustomerWhere,
  femaleCustomerWhere,
  loadCustomerComposition,
  onboardedBaseWhere,
  type CustomerComposition,
} from '@/lib/queries/customer-composition'

/**
 * 고객 구성 M4 — 운영 DB **읽기 전용** 정합성·성능 검사의 코어. 정본: MEMBER-CONVERSION-CANON.md (M4).
 *
 * CLI(scripts/customer-composition-db-check.mts)와 임시 Preview 진단 경로가 **이 파일 하나** 를 쓴다.
 * 판정·집계·불변식을 두 곳에 복사하지 않는다.
 *
 * 🔴 출력하지 않는다(console 없음) · 종료하지 않는다(process.exit 없음) · 환경을 직접 읽지 않는다(process.env 없음).
 *    호출자가 세 키(pickM4Env)만 골라 넘기고, 결과는 숫자와 정해진 상태 낱말만 담은 객체로 돌려받는다.
 * 🔴 연결 문자열·환경변수 값·회원 식별자·이메일·전화번호·개별 출생연도·동의 시각·글/댓글 원문·
 *    오류 원문(message·stack)은 결과 객체에 자리가 없다.
 * 🔴 운영 조회 구간(LIVE-READONLY 표시 사이)은 CLI 자기검사가 소스를 읽어 쓰기 문장·쓰기 메서드·순서를 확인한다.
 */

/** 소란소란 운영 Supabase 프로젝트. 🔴 이 값이 아니면 연결하지 않는다 */
export const M4_EXPECTED_PROJECT_REF = 'buougdxmfobjilgjonby'
export const M4_STATEMENT_TIMEOUT_MS = 10_000
/** 트랜잭션 전체 상한 — 문장 하나는 10초에 끊긴다. 측정이 끝나도록 여유만 둔다 */
const TX_TIMEOUT_MS = 30_000
const PERF_PASS_MS = 5_000
const PERF_FAIL_MS = 10_000
const MAX_PLAUSIBLE_AGE = 120

/** 결과·출력에 쓰는 정해진 낱말. 🔴 자유 문자열은 결과에 들어가지 않는다 */
export type M4Word =
  | 'PASS' | 'FAIL' | 'PARTIAL' | 'on' | 'off' | '확인' | '불일치' | '확인 불가' | '존재' | '없음'
  | '설정됨' | '설정됐지만 항목 0개' | '키 없음' | '연결함' | '연결 안 함' | 'DATA_POLICY_REVIEW' | '해당 없음'
  | 'M4 PASS' | 'M4 PARTIAL' | 'M4 PARTIAL_CONFIG_PARITY' | 'M4 FAIL' | 'M4 BLOCKED_CREDENTIALS'
  | 'STATEMENT_TIMEOUT' | 'TRANSACTION_TIMEOUT' | 'CONNECTION' | 'READ_ONLY_NOT_ON' | 'PROJECT_REF'
  | 'WRITE_METHOD_BLOCKED' | 'UNKNOWN_ERROR' | 'PRISMA_KNOWN' | 'PRISMA_INIT' | 'PRISMA_UNKNOWN'
  | 'DISCONNECT_FAILED'

export type M4Verdict = 'M4 PASS' | 'M4 PARTIAL' | 'M4 PARTIAL_CONFIG_PARITY' | 'M4 FAIL' | 'M4 BLOCKED_CREDENTIALS'

/** 코어가 읽는 환경 — 세 키뿐이다 */
export type M4Env = { DATABASE_URL?: string; SORAN_ADMIN_EMAILS?: string; SIGNUP_ALLOWLIST?: string }

const M4_ENV_KEYS = ['DATABASE_URL', 'SORAN_ADMIN_EMAILS', 'SIGNUP_ALLOWLIST'] as const

/** 🔴 전체 환경을 넘기지 않는다. 세 키만, 키가 없으면 없는 대로 옮긴다(없음과 빈 값을 가르기 위해) */
export function pickM4Env(source: Record<string, string | undefined>): M4Env {
  const out: M4Env = {}
  for (const key of M4_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) out[key] = source[key]
  }
  return out
}

// ─────────── 순수 판정 ───────────

/**
 * Supabase project ref. 확인할 수 없으면 null — 🔴 null 이면 연결하지 않는다.
 *
 *   direct  postgres://postgres:…@db.<ref>.supabase.co:5432/postgres
 *   pooler  postgres://postgres.<ref>:…@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * 🔴 host 와 username 이 서로 다른 ref 를 말하면 null 이다. 둘 중 하나만 믿지 않는다.
 */
export function supabaseProjectRef(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return null
  const host = u.hostname.toLowerCase()
  let user: string
  try {
    user = decodeURIComponent(u.username)
  } catch {
    return null
  }
  const userRef = /^[a-z_]+\.([a-z0-9]{20})$/.exec(user)?.[1] ?? null
  const directRef = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host)?.[1] ?? null
  if (directRef) return userRef === null || userRef === directRef ? directRef : null
  if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) return userRef
  return null
}

export type EnvKeyState = { state: '설정됨' | '설정됐지만 항목 0개' | '키 없음'; items: number }

/** 🔴 키가 없는 것과 빈 값으로 주입된 것을 가른다. 없는 키를 "운영 설정이 비어 있다" 로 추정하지 않는다 */
export function envKeyState(env: Record<string, string | undefined>, key: string): EnvKeyState {
  if (!Object.prototype.hasOwnProperty.call(env, key) || env[key] === undefined) return { state: '키 없음', items: 0 }
  const items = parseEnvList(env[key]).length
  return { state: items > 0 ? '설정됨' : '설정됐지만 항목 0개', items }
}

export type LiveStart =
  | { ok: true; url: string }
  | { ok: false; verdict: 'M4 BLOCKED_CREDENTIALS' | 'M4 FAIL'; reason: 'CONNECTION' | 'PROJECT_REF' }

/** 연결을 시작해도 되는가 — DATABASE_URL 만 본다. 🔴 다른 연결 키로 대신하지 않는다 */
export function decideLiveStart(env: Record<string, string | undefined>): LiveStart {
  const url = env.DATABASE_URL
  if (!url) return { ok: false, verdict: 'M4 BLOCKED_CREDENTIALS', reason: 'CONNECTION' }
  if (supabaseProjectRef(url) !== M4_EXPECTED_PROJECT_REF) return { ok: false, verdict: 'M4 FAIL', reason: 'PROJECT_REF' }
  return { ok: true, url }
}

export type BirthyearQuality = {
  nullOrEmpty: number
  notFourDigits: number
  surroundingSpace: number
  leadingZero: number
  future: number
  over120: number
  /** parseBirthyear 가 미확인으로 돌리는 인원 — 화면의 연령 미확인과 같아야 한다 */
  unparseable: number
}

/** 출생연도 품질 — 🔴 원문은 여기서 범주 인원으로만 바뀌고 밖으로 나가지 않는다. 범주는 겹칠 수 있다 */
export function birthyearQuality(
  rows: readonly { birthyear: string | null; count: number }[],
  baseYear: number,
): BirthyearQuality {
  const q: BirthyearQuality = { nullOrEmpty: 0, notFourDigits: 0, surroundingSpace: 0, leadingZero: 0, future: 0, over120: 0, unparseable: 0 }
  for (const { birthyear: raw, count } of rows) {
    if (parseBirthyear(raw, baseYear) === null) q.unparseable += count
    const trimmed = raw?.trim() ?? ''
    if (trimmed === '') {
      q.nullOrEmpty += count
      continue
    }
    if (raw !== trimmed) q.surroundingSpace += count
    if (!/^\d{4}$/.test(trimmed)) {
      q.notFourDigits += count
      continue
    }
    if (trimmed.startsWith('0')) q.leadingZero += count
    const year = Number(trimmed)
    if (year > baseYear) q.future += count
    else if (baseYear - year > MAX_PLAUSIBLE_AGE) q.over120 += count
  }
  return q
}

export type Invariant = { label: string; ok: boolean }

/** 집계 불변식 — 숫자만 받는다 */
export function compositionInvariants(input: {
  femaleByAge: AgeCounts
  femaleBlocked: number
  eligible: AgeCounts
  generalPost: AgeCounts
  comment: AgeCounts
  postOrComment: AgeCounts
  greeting: AgeCounts
  boards: readonly { postAuthors: number; commentAuthors: number }[]
  sevenDay: { noBasis: number; observing: number; complete: AgeCounts; participated: AgeCounts }
  directFemaleCount: number
  directActiveCount: number
}): Invariant[] {
  const femaleTotal = totalOf(input.femaleByAge)
  const eligibleTotal = totalOf(input.eligible)
  const perBand = (part: AgeCounts, whole: AgeCounts) => AGE_BAND_ORDER.every((k) => part[k] <= whole[k])
  return [
    { label: '연령 구간 합계 = 실제 여성 고객 총수(직접 count)', ok: femaleTotal === input.directFemaleCount },
    { label: '참여 대상 합계 = 차단 아닌 여성 고객(직접 count)', ok: eligibleTotal === input.directActiveCount },
    { label: '여성 총수 − 차단 = 참여 대상', ok: femaleTotal - input.femaleBlocked === eligibleTotal },
    { label: '차단 ≤ 여성 총수', ok: input.femaleBlocked <= femaleTotal },
    { label: '연령대별 일반 글 ≤ 연령대별 대상', ok: perBand(input.generalPost, input.eligible) },
    { label: '연령대별 댓글 ≤ 연령대별 대상', ok: perBand(input.comment, input.eligible) },
    { label: '연령대별 글 또는 댓글 ≤ 연령대별 대상', ok: perBand(input.postOrComment, input.eligible) },
    { label: '연령대별 가입인사 ≤ 연령대별 대상', ok: perBand(input.greeting, input.eligible) },
    { label: '글 또는 댓글 ≥ 일반 글 · ≥ 댓글 (연령대별)', ok: AGE_BAND_ORDER.every((k) => input.postOrComment[k] >= Math.max(input.generalPost[k], input.comment[k])) },
    { label: '글 또는 댓글 ≤ 참여 대상', ok: totalOf(input.postOrComment) <= eligibleTotal },
    { label: '가입인사 ≤ 참여 대상', ok: totalOf(input.greeting) <= eligibleTotal },
    { label: '게시판별 고유 참여 ≤ 참여 대상', ok: input.boards.every((b) => b.postAuthors <= eligibleTotal && b.commentAuthors <= eligibleTotal) },
    { label: '7일 내 참여 ≤ 7일 관측 완료 (연령대별)', ok: perBand(input.sevenDay.participated, input.sevenDay.complete) },
    { label: '산정 불가 + 관측 중 + 관측 완료 = 참여 대상', ok: input.sevenDay.noBasis + input.sevenDay.observing + totalOf(input.sevenDay.complete) === eligibleTotal },
    { label: '50대 총수 = 50~54 + 55~59', ok: sumBands(input.femaleByAge, FIFTIES_BANDS) === input.femaleByAge['50-54'] + input.femaleByAge['55-59'] },
  ]
}

/** 집계 시간 판정 */
export function perfVerdict(ms: number): 'PASS' | 'PARTIAL' | 'FAIL' {
  if (ms <= PERF_PASS_MS) return 'PASS'
  if (ms <= PERF_FAIL_MS) return 'PARTIAL'
  return 'FAIL'
}

export class WriteBlocked extends Error {}
export class ReadOnlyNotOn extends Error {}

/**
 * 오류 종류 — 🔴 원문 메시지를 내보내지 않는다. 메시지에 host·credential·query parameter 가 섞일 수 있다.
 * 메시지는 분류에만 쓰고 버린다. Prisma 오류 코드(P0000 꼴)만 숫자로 함께 낸다.
 */
export function safeErrorKind(e: unknown): { kind: M4Word; code: number | null } {
  const msg = e instanceof Error ? e.message : ''
  const raw = (e as { code?: unknown } | null)?.code
  const code = typeof raw === 'string' && /^P\d{4}$/.test(raw) ? Number(raw.slice(1)) : null
  if (e instanceof WriteBlocked) return { kind: 'WRITE_METHOD_BLOCKED', code: null }
  if (e instanceof ReadOnlyNotOn) return { kind: 'READ_ONLY_NOT_ON', code: null }
  if (/statement timeout/i.test(msg)) return { kind: 'STATEMENT_TIMEOUT', code }
  if (code === 2028) return { kind: 'TRANSACTION_TIMEOUT', code }
  if (e instanceof Prisma.PrismaClientInitializationError) return { kind: 'PRISMA_INIT', code }
  if (e instanceof Prisma.PrismaClientKnownRequestError) return { kind: 'PRISMA_KNOWN', code }
  if (e instanceof Prisma.PrismaClientUnknownRequestError) return { kind: 'PRISMA_UNKNOWN', code }
  return { kind: 'UNKNOWN_ERROR', code }
}

/** 읽기 메서드만 통과시키는 delegate. 🔴 쓰기 메서드는 부르는 순간 던진다(실행 중 방어) */
const READ_METHODS = new Set(['findMany', 'findFirst', 'findUnique', 'count', 'groupBy', 'aggregate'])

export function readOnlyDelegate<T extends object>(target: T, meter: { queries: number; rows: number }): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      if (typeof value !== 'function') return value
      if (typeof prop !== 'string' || !READ_METHODS.has(prop)) {
        return () => {
          throw new WriteBlocked()
        }
      }
      return async (...args: unknown[]) => {
        meter.queries += 1
        const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(obj, args)
        meter.rows += Array.isArray(result) ? result.length : 1
        return result
      }
    },
  })
}

// ─────────── 결과 ───────────

/**
 * M4 결과에 싣는 집계 필드 — 🔴 허용 목록이다.
 *
 * CustomerComposition 을 통째로 상속하거나 펼치지 않는다. 그러면 원본에 필드가 늘 때(예: measuredAt)
 * 그 필드가 Preview 응답에 저절로 따라 나간다. 여기 적은 이름만 실린다.
 */
export const M4_COMPOSITION_FIELDS = [
  'baseYear', 'onboarded', 'femaleByAge', 'femaleBlocked', 'participation', 'boards', 'sevenDay',
  'femaleTotal', 'eligibleTotal', 'fifties', 'onboardedNoTerms',
] as const

export type M4Composition = Pick<
  CustomerComposition,
  'baseYear' | 'onboarded' | 'femaleByAge' | 'femaleBlocked' | 'participation' | 'boards' | 'sevenDay'
> & {
  femaleTotal: number
  eligibleTotal: number
  fifties: number
  /** 가입 완료 대상 전체 중 TERMS 동의 기록 없음 */
  onboardedNoTerms: number
}

/** 원본 집계 → M4 결과용 집계. 🔴 이름을 하나씩 옮긴다 — 전개(...)로 복사하지 않는다 */
export function projectM4Composition(d: CustomerComposition, onboardedNoTerms: number): M4Composition {
  return {
    baseYear: d.baseYear,
    onboarded: d.onboarded,
    femaleByAge: d.femaleByAge,
    femaleBlocked: d.femaleBlocked,
    participation: d.participation,
    boards: d.boards,
    sevenDay: d.sevenDay,
    femaleTotal: totalOf(d.femaleByAge),
    eligibleTotal: totalOf(d.participation.eligible),
    fifties: sumBands(d.femaleByAge, FIFTIES_BANDS),
    onboardedNoTerms,
  }
}

export type M4Result = {
  verdict: M4Verdict
  /** 집계까지 끝났을 때의 판정 — 연결 종료가 실패하면 verdict 만 FAIL 로 바뀌고 이 값은 남는다 */
  analysisVerdict: M4Verdict | null
  exitCode: 0 | 1 | 3 | 4
  precondition: { databaseUrl: '존재' | '없음'; projectRef: '확인' | '불일치' | '확인 불가'; connected: '연결함' | '연결 안 함' }
  config: { admin: EnvKeyState; allow: EnvKeyState; parity: boolean } | null
  readOnly: { transactionReadOnly: 'on'; statementTimeoutMs: number } | null
  composition: M4Composition | null
  invariants: Invariant[]
  operatorCandidates: { isAdmin: number; adminEmail: number; allowlistEmail: number; allowlistAccount: number } | null
  birthyear: (BirthyearQuality & { review: 'DATA_POLICY_REVIEW' | '해당 없음' }) | null
  perf: { connectMs: number; aggregateMs: number; queries: number; rows: number; verdict: 'PASS' | 'PARTIAL' | 'FAIL' } | null
  error: { kind: M4Word; code: number | null } | null
  disconnect: 'OK' | 'DISCONNECT_FAILED' | 'NOT_CREATED'
}

/** 운영 경로가 쓰는 client 의 최소 모양 — 가짜 client 로 실패 경로를 시험할 수 있게 한다 */
export type M4LiveClient = Pick<PrismaClient, '$connect' | '$disconnect' | '$transaction'>
export type M4ClientFactory = (url: string) => M4LiveClient

/* LIVE-READONLY:BEGIN — 이 표시 사이가 운영 조회 경로다. 자기검사가 이 구간을 읽어 검사한다 */
/**
 * 실제 client 를 만드는 곳. 🔴 runM4Readonly 의 try 안에서만 불린다 — 생성 오류도 safeErrorKind 를 거친다.
 * created 는 자기검사가 "실제 client 0회" 를 확인하는 값이다. factory 는 같은 프로세스 안의 검사만 바꿀 수 있다.
 */
export const m4ClientRuntime: { factory: M4ClientFactory; created: number } = {
  factory: (url) => {
    m4ClientRuntime.created += 1
    return new PrismaClient({ datasourceUrl: url, log: [] })
  },
  created: 0,
}

/**
 * M4 읽기 전용 검사 한 번.
 *
 * 🔴 오류 원문은 어느 단계에서도 결과에 들어가지 않는다. 생성·연결·트랜잭션 오류는 catch 의 safeErrorKind 로,
 *    연결 종료 오류는 정해진 낱말로만 남긴다. 연결 종료가 실패해도 앞의 오류는 지우지 않고 판정만 FAIL 로 만든다.
 */
export async function runM4Readonly(makeClient: M4ClientFactory, env: M4Env, now: Date): Promise<M4Result> {
  const r: M4Result = {
    verdict: 'M4 FAIL',
    analysisVerdict: null,
    exitCode: 1,
    precondition: { databaseUrl: env.DATABASE_URL ? '존재' : '없음', projectRef: '확인 불가', connected: '연결 안 함' },
    config: null,
    readOnly: null,
    composition: null,
    invariants: [],
    operatorCandidates: null,
    birthyear: null,
    perf: null,
    error: null,
    disconnect: 'NOT_CREATED',
  }
  const start = decideLiveStart(env)
  if (!start.ok) {
    r.precondition.projectRef = start.reason === 'PROJECT_REF' ? '불일치' : '확인 불가'
    r.verdict = start.verdict
    r.exitCode = start.verdict === 'M4 BLOCKED_CREDENTIALS' ? 3 : 1
    return r
  }
  r.precondition.projectRef = '확인'
  const admin = envKeyState(env, 'SORAN_ADMIN_EMAILS')
  const allow = envKeyState(env, 'SIGNUP_ALLOWLIST')
  r.config = { admin, allow, parity: admin.state !== '키 없음' && allow.state !== '키 없음' }

  let client: M4LiveClient | null = null
  try {
    client = makeClient(start.url)
    const t0 = performance.now()
    await client.$connect()
    const connectMs = Math.round(performance.now() - t0)

    const result = await client.$transaction(
      async (tx) => {
        // 🔴 다른 어떤 조회보다 먼저 — 순서가 곧 안전장치다
        await tx.$executeRaw`SET TRANSACTION READ ONLY`
        await tx.$executeRaw`SET LOCAL statement_timeout = '10000ms'`
        const ro = await tx.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`
        if (ro[0]?.transaction_read_only !== 'on') throw new ReadOnlyNotOn()

        const meter = { queries: 0, rows: 0 }
        const db = {
          user: readOnlyDelegate(tx.user, meter),
          post: readOnlyDelegate(tx.post, meter),
          comment: readOnlyDelegate(tx.comment, meter),
        }
        const a0 = performance.now()
        const data = await loadCustomerComposition(db as unknown as PrismaClient, now, env)
        const aggregateMs = Math.round(performance.now() - a0)
        const aggregateMeter = { ...meter }

        // 같은 스냅샷에서 직접 센다 — REPEATABLE READ
        const onboarded = onboardedBaseWhere(env)
        const operatorCandidates = { ...REAL_MEMBER_WHERE, isOnboarded: true }
        const adminEmails = parseEnvList(env.SORAN_ADMIN_EMAILS)
        const allowlist = parseEnvList(env.SIGNUP_ALLOWLIST)
        const emailMatch = (list: string[]): Prisma.UserWhereInput =>
          ({ OR: list.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) })
        const [
          directFemale, directActive, isAdminMatches, adminEmailMatches, allowEmailMatches, allowAccountMatches,
          onboardedNoTerms, ageRows,
        ] = await Promise.all([
          db.user.count({ where: femaleCustomerWhere(env) }),
          db.user.count({ where: activeFemaleCustomerWhere(env) }),
          db.user.count({ where: { ...operatorCandidates, isAdmin: true } }),
          adminEmails.length ? db.user.count({ where: { ...operatorCandidates, ...emailMatch(adminEmails) } }) : 0,
          allowlist.length ? db.user.count({ where: { ...operatorCandidates, ...emailMatch(allowlist) } }) : 0,
          allowlist.length
            ? db.user.count({ where: { ...operatorCandidates, accounts: { some: { provider: 'kakao', providerAccountId: { in: allowlist } } } } })
            : 0,
          db.user.count({ where: { ...onboarded, agreements: { none: { type: AGREEMENT_TYPE.terms } } } }),
          db.user.groupBy({ by: ['birthyear'], where: femaleCustomerWhere(env), _count: { _all: true } }),
        ])
        const quality = birthyearQuality(
          ageRows.map((row) => ({ birthyear: row.birthyear, count: row._count._all })),
          kstBaseYear(now),
        )
        return {
          data, connectMs, aggregateMs, aggregateMeter, directFemale, directActive, isAdminMatches, adminEmailMatches,
          allowEmailMatches, allowAccountMatches, onboardedNoTerms, quality,
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: TX_TIMEOUT_MS, maxWait: 10_000 },
    )

    const d = result.data
    const p = d.participation
    const invariants = compositionInvariants({
      femaleByAge: d.femaleByAge, femaleBlocked: d.femaleBlocked, eligible: p.eligible,
      generalPost: p.generalPost, comment: p.comment, postOrComment: p.postOrComment, greeting: p.greeting,
      boards: d.boards, sevenDay: d.sevenDay, directFemaleCount: result.directFemale, directActiveCount: result.directActive,
    })
    invariants.push({ label: '출생연도 미확인(품질 진단) = 연령 미확인(화면)', ok: result.quality.unparseable === d.femaleByAge.unknown })
    const perf = perfVerdict(result.aggregateMs)

    r.precondition.connected = '연결함'
    r.readOnly = { transactionReadOnly: 'on', statementTimeoutMs: M4_STATEMENT_TIMEOUT_MS }
    r.composition = projectM4Composition(d, result.onboardedNoTerms)
    r.invariants = invariants
    r.operatorCandidates = {
      isAdmin: result.isAdminMatches,
      adminEmail: result.adminEmailMatches,
      allowlistEmail: result.allowEmailMatches,
      allowlistAccount: result.allowAccountMatches,
    }
    r.birthyear = { ...result.quality, review: result.quality.over120 > 0 ? 'DATA_POLICY_REVIEW' : '해당 없음' }
    r.perf = {
      connectMs: result.connectMs,
      aggregateMs: result.aggregateMs,
      queries: result.aggregateMeter.queries,
      rows: result.aggregateMeter.rows,
      verdict: perf,
    }
    r.verdict = !invariants.every((i) => i.ok) || perf === 'FAIL'
      ? 'M4 FAIL'
      : !r.config.parity
        ? 'M4 PARTIAL_CONFIG_PARITY'
        : result.quality.over120 > 0 || perf === 'PARTIAL'
          ? 'M4 PARTIAL'
          : 'M4 PASS'
    r.analysisVerdict = r.verdict
    r.exitCode = r.verdict === 'M4 PASS' ? 0 : r.verdict === 'M4 FAIL' ? 1 : 4
  } catch (e) {
    r.error = safeErrorKind(e)
    r.verdict = 'M4 FAIL'
    r.exitCode = 1
  } finally {
    if (client !== null) {
      try {
        await client.$disconnect()
        r.disconnect = 'OK'
      } catch {
        // 🔴 오류 객체를 묶지 않는다 — 원문을 읽을 길 자체를 두지 않는다. 앞의 r.error 는 그대로 둔다
        r.disconnect = 'DISCONNECT_FAILED'
        r.verdict = 'M4 FAIL'
        r.exitCode = 1
      }
    }
  }
  return r
}
/* LIVE-READONLY:END */
