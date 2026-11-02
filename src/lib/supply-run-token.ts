/**
 * 공급 실행 token — 🔴 **shadow 전용 순수 판정. 파일 · 프로세스 · env 읽기 0** (2026-10-12 Batch C1)
 *
 * 🔴 **무엇인가.** 커널 lease(`runner-lease`)를 증명한 공급 holder 가 회차(pass)마다 하나 발급하는 기록이다.
 *    "이 회차가 어떤 깨움으로 열렸고, 다음 단계의 예산 판정이라면 어느 창의 몫을 썼을 것인가" 를 남긴다.
 *
 * 🔴 **무엇이 아닌가 — 예산 허가가 아니다.** 지금 예산 판정은 `supply-scheduled-reserve` 그대로다
 *    (launchd 라벨 + 벽시계 45분 슬롯 창). 이 파일의 결과는 장부 줄과 회차 기록에 **나란히 적히기만** 한다.
 *    token 을 예산에 쓰는 것은 Batch C3 이고, 그 전에 shadow 기록으로 두 판정이 어디서 갈리는지 실측한다.
 *
 * 🔴 **검증은 다섯 칸을 전부 본다** — 하나라도 어긋나면 `ok: false` 와 그 코드다(추정하지 않는다).
 *    ① 이 프로세스가 공급 커널 lease 안이다(fd 9 증명 — 부르는 쪽이 넘긴다)
 *    ② token 파일이 있고 모양이 맞다
 *    ③ env 의 token id 와 파일의 id 가 같다
 *    ④ 파일에 적힌 잠금 identity(dev · ino)와 내 fd 9 의 identity 가 같다
 *    ⑤ 발급 시각 ≤ 지금 < 만료 시각
 */
import { SUPPLY_RUN_SLOTS_KST, SUPPLY_RUN_WINDOW_MS } from './supply-schedule-contract'

export const RUN_TOKEN_VERSION = 'supply-run-token-v1'

/**
 * 🔴 **token 수명 = 공급 회차 하나가 정상으로 살아 있을 수 있는 가장 긴 시간**(45분 · 정기 슬롯 창과 같은 값).
 *    잠들었다 깨어난 회차는 이 시각을 넘긴다 — 그 회차의 남은 요청은 shadow 에서 `TOKEN_EXPIRED` 다.
 */
export const RUN_TOKEN_TTL_MS = SUPPLY_RUN_WINDOW_MS

/** 🔴 발급 시각이 지금보다 이만큼 넘게 미래면 깨진 것으로 본다(시계 오차 흡수만) */
export const RUN_TOKEN_CLOCK_SKEW_MS = 60_000

export type RunTokenTrigger = 'scheduled' | 'event' | 'recovery' | 'manual' | 'unknown'
const TRIGGERS: readonly RunTokenTrigger[] = ['scheduled', 'event', 'recovery', 'manual', 'unknown']

export type LockIdentity = { dev: number; ino: number }

export type RunToken = {
  version: typeof RUN_TOKEN_VERSION
  tokenId: string
  /** 그 회차를 연 깨움 — 띄운 이유와 거둔 표식을 합친 값(`mergePassTrigger`) */
  trigger: RunTokenTrigger
  /** 이 프로세스를 띄운 이유 */
  launchTrigger: RunTokenTrigger
  /** 거둔 follow-up 표식의 trigger · 시각 — 없으면 null */
  absorbedTrigger: RunTokenTrigger | null
  absorbedAt: string | null
  /** 🔴 shadow — 이어 붙인 예산 창(설계 D1) 이름. 지금 예산 판정은 이 값을 읽지 않는다 */
  budgetWindowShadow: string
  issuedAt: string
  expiresAt: string
  lock: LockIdentity
  /** 회차 id — 그 회차의 회차 시각(`SORAN_RUN_AT`)에서 만든 값 */
  runId: string
  /** 0 = 첫 회차 · 1 = follow-up */
  pass: number
}

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3_600_000

function kstMidnightMs(t: number): number {
  const shifted = t + KST_OFFSET_MS
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - KST_OFFSET_MS
}

/**
 * 🔴 **이어 붙인 예산 창의 이름 (shadow · 설계 D1).** 정기 슬롯을 경계로 하루를 나눈다 —
 *    `[슬롯 i, 슬롯 i+1)` 은 슬롯 i 의 창, 첫 슬롯 전은 첫 슬롯의 창, 마지막 슬롯 뒤는 마지막 슬롯의 창.
 *    이름은 장부 `runSlot` 과 같은 모양(`YYYY-MM-DD HH:MM` KST)이다.
 */
export function budgetWindowShadowOf(at: Date, slots: readonly { hour: number; minute: number }[] = SUPPLY_RUN_SLOTS_KST): string {
  const t = at.getTime()
  const day0 = kstMidnightMs(t)
  const starts = slots.map((s) => ({ s, ms: day0 + (s.hour * 60 + s.minute) * 60_000 })).sort((a, b) => a.ms - b.ms)
  const hit = [...starts].reverse().find((x) => x.ms <= t) ?? starts[0]!
  const date = new Date(day0 + KST_OFFSET_MS).toISOString().slice(0, 10)
  return `${date} ${String(hit.s.hour).padStart(2, '0')}:${String(hit.s.minute).padStart(2, '0')}`
}

/**
 * 🔴 **공급 회차 id** — 회차 시각(UTC)의 `YYYYMMDD-HHMMSS`. 러너 회차 기록 · 장부 회차 id 의 뿌리다.
 *    holder 가 token 에 적는 값과 회차 자식이 기록에 쓰는 값이 **같은 함수**에서 나온다.
 */
export function supplyRunIdOf(d: Date): string {
  return `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}`
}

/** 🔴 장부 줄에 싣는 모양 — 짧은 칸만(본문 · 경로 없음). 판정은 이 칸을 읽지 않는다 */
export type RunTokenShadowTag = {
  ok: boolean
  code: RunTokenShadowCode | null
  tokenId: string | null
  trigger: RunTokenTrigger | null
  /** 실제 프로세스를 띄운 분류. 최종 trigger만으로 자연 회차를 증명하지 않는다. */
  launchTrigger: RunTokenTrigger | null
  /** 시작할 때 거둔 사건·복구 표식. 있으면 자연 예약 회차 증거로 쓰지 않는다. */
  absorbedTrigger: RunTokenTrigger | null
  /** 거둔 표식의 원래 요청 시각. 손상 trigger(`unknown`)는 시각도 모를 수 있다. */
  absorbedAt: string | null
  /** 0은 첫 holder 회차, 1 이상은 겹친 요청을 처리한 bounded follow-up이다. */
  pass: number | null
  budgetWindow: string | null
}
export function shadowTagOf(s: RunTokenShadow): RunTokenShadowTag {
  return s.ok
    ? {
        ok: true, code: null, tokenId: s.tokenId, trigger: s.trigger,
        launchTrigger: s.launchTrigger, absorbedTrigger: s.absorbedTrigger, absorbedAt: s.absorbedAt, pass: s.pass,
        budgetWindow: s.budgetWindowShadow,
      }
    : {
        ok: false, code: s.code, tokenId: s.tokenId, trigger: null,
        launchTrigger: null, absorbedTrigger: null, absorbedAt: null, pass: null, budgetWindow: null,
      }
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

/** 저장된 짧은 shadow tag의 모양을 엄격히 읽는다. 옛 불완전 tag는 추정하지 않는다. */
export function parseRunTokenShadowTag(value: unknown): RunTokenShadowTag | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (typeof o.ok !== 'boolean') return null
  if (o.ok) {
    if (o.code !== null || typeof o.tokenId !== 'string' || o.tokenId === ''
      || !isTrigger(o.trigger) || !isTrigger(o.launchTrigger)
      || (o.absorbedTrigger !== null && !isTrigger(o.absorbedTrigger))
      || (o.absorbedTrigger === null && o.absorbedAt !== null)
      || (o.absorbedTrigger !== null && o.absorbedTrigger !== 'unknown' && o.absorbedAt === null)
      || (o.absorbedAt !== null && !isCanonicalIso(o.absorbedAt))
      || !isInt(o.pass)
      || typeof o.budgetWindow !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o.budgetWindow)) return null
  } else if (typeof o.code !== 'string'
    || (o.tokenId !== null && typeof o.tokenId !== 'string')
    || o.trigger !== null || o.launchTrigger !== null || o.absorbedTrigger !== null
    || o.absorbedAt !== null || o.pass !== null || o.budgetWindow !== null) return null
  return o as RunTokenShadowTag
}

/**
 * 자연 증명에 쓸 수 있는 예약 요청의 provenance.
 * 첫 pass는 다른 요청을 흡수하지 않아야 한다. follow-up은 실제로 겹친 scheduled marker와
 * 그 원래 시각을 보존한 경우에만 자연 요청으로 인정한다. event·recovery·manual은 어느 pass에서도 제외한다.
 */
export function isNaturalScheduledRunTag(value: unknown): boolean {
  const tag = parseRunTokenShadowTag(value)
  if (tag?.ok !== true || tag.trigger !== 'scheduled' || tag.launchTrigger !== 'scheduled') return false
  if (tag.pass === 0) return tag.absorbedTrigger === null && tag.absorbedAt === null
  return tag.absorbedTrigger === 'scheduled' && tag.absorbedAt !== null
}

/**
 * 자연 예약 요청을 proof slot에 귀속할 시각.
 * follow-up의 프로세스 시작 시각은 holder가 끝난 뒤라 늦을 수 있으므로 marker 원시각을 쓴다.
 * marker가 실행 시작보다 미래면 손상으로 보고 증거로 쓰지 않는다.
 */
export function naturalScheduledRunEvidenceAt(value: unknown, startedAt: string): string | null {
  const tag = parseRunTokenShadowTag(value)
  if (tag === null || !isNaturalScheduledRunTag(tag) || !isCanonicalIso(startedAt)) return null
  if (tag.pass === 0) return startedAt
  if (tag.absorbedAt === null || Date.parse(tag.absorbedAt) > Date.parse(startedAt)) return null
  return tag.absorbedAt
}

/** 🔴 token 하나를 만든다 — 시각 · id · identity 는 부르는 쪽이 넘긴다(순수) */
export function buildRunToken(i: {
  tokenId: string; trigger: RunTokenTrigger; launchTrigger: RunTokenTrigger
  absorbedTrigger: RunTokenTrigger | null; absorbedAt: string | null
  issuedAt: Date; lock: LockIdentity; runId: string; pass: number
}): RunToken {
  return {
    version: RUN_TOKEN_VERSION,
    tokenId: i.tokenId, trigger: i.trigger, launchTrigger: i.launchTrigger,
    absorbedTrigger: i.absorbedTrigger, absorbedAt: i.absorbedAt,
    budgetWindowShadow: budgetWindowShadowOf(i.issuedAt),
    issuedAt: i.issuedAt.toISOString(),
    expiresAt: new Date(i.issuedAt.getTime() + RUN_TOKEN_TTL_MS).toISOString(),
    lock: i.lock, runId: i.runId, pass: i.pass,
  }
}

const isTrigger = (v: unknown): v is RunTokenTrigger => TRIGGERS.includes(v as RunTokenTrigger)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))

/** 🔴 파일 원문 → token. 칸 하나라도 모양이 틀리면 `null`(깨진 token) */
export function parseRunToken(raw: string): RunToken | null {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const lock = o.lock as Record<string, unknown> | null | undefined
  if (o.version !== RUN_TOKEN_VERSION) return null
  if (typeof o.tokenId !== 'string' || o.tokenId === '') return null
  if (!isTrigger(o.trigger) || !isTrigger(o.launchTrigger)) return null
  if (o.absorbedTrigger !== null && !isTrigger(o.absorbedTrigger)) return null
  if (o.absorbedTrigger === null && o.absorbedAt !== null) return null
  if (o.absorbedTrigger !== null && o.absorbedTrigger !== 'unknown' && o.absorbedAt === null) return null
  if (o.absorbedAt !== null && !isCanonicalIso(o.absorbedAt)) return null
  if (typeof o.budgetWindowShadow !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(o.budgetWindowShadow)) return null
  if (!isIso(o.issuedAt) || !isIso(o.expiresAt)) return null
  // 🔴 수명은 정해진 값 하나다 — 만료를 멀리 적은 token 은 깨진 것으로 본다
  if (Date.parse(o.expiresAt) - Date.parse(o.issuedAt) !== RUN_TOKEN_TTL_MS) return null
  if (typeof lock !== 'object' || lock === null || !isInt(lock.dev) || !isInt(lock.ino)) return null
  if (typeof o.runId !== 'string' || o.runId === '' || !isInt(o.pass)) return null
  return o as unknown as RunToken
}

export type RunTokenShadowCode =
  | 'NO_LEASE' | 'LEASE_NOT_PROVEN' | 'NO_TOKEN_ENV' | 'TOKEN_MISSING' | 'TOKEN_UNREADABLE' | 'TOKEN_CORRUPT'
  | 'TOKEN_ID_MISMATCH' | 'LOCK_IDENTITY_MISMATCH' | 'TOKEN_NOT_YET_VALID' | 'TOKEN_EXPIRED' | 'ERROR'

export type RunTokenShadow =
  | {
      ok: true; tokenId: string; trigger: RunTokenTrigger
      launchTrigger: RunTokenTrigger; absorbedTrigger: RunTokenTrigger | null
      absorbedAt: string | null
      budgetWindowShadow: string; pass: number; runId: string
    }
  | { ok: false; code: RunTokenShadowCode; tokenId: string | null }

/**
 * 🔴 **shadow 판정 — 다섯 칸 전부.** 입력은 이미 읽어 온 값이다(순수).
 *    `lease` — 이 프로세스의 공급 lease 증명. 표식 env 가 없으면 `absent`, 증명 실패면 `unproven`.
 *    `file`  — token 파일: 없음 `missing` · 못 읽음 `unreadable` · 원문.
 */
export function judgeRunTokenShadow(i: {
  lease: { kind: 'absent' } | { kind: 'unproven' } | { kind: 'proven'; identity: LockIdentity }
  envTokenId: string | null
  file: { kind: 'missing' } | { kind: 'unreadable' } | { kind: 'raw'; raw: string }
  now: Date
}): RunTokenShadow {
  const id = i.envTokenId === null || i.envTokenId === '' ? null : i.envTokenId
  if (i.lease.kind === 'absent') return { ok: false, code: 'NO_LEASE', tokenId: id }
  if (i.lease.kind === 'unproven') return { ok: false, code: 'LEASE_NOT_PROVEN', tokenId: id }
  if (id === null) return { ok: false, code: 'NO_TOKEN_ENV', tokenId: null }
  if (i.file.kind === 'missing') return { ok: false, code: 'TOKEN_MISSING', tokenId: id }
  if (i.file.kind === 'unreadable') return { ok: false, code: 'TOKEN_UNREADABLE', tokenId: id }
  const t = parseRunToken(i.file.raw)
  if (t === null) return { ok: false, code: 'TOKEN_CORRUPT', tokenId: id }
  if (t.tokenId !== id) return { ok: false, code: 'TOKEN_ID_MISMATCH', tokenId: id }
  if (t.lock.dev !== i.lease.identity.dev || t.lock.ino !== i.lease.identity.ino) {
    return { ok: false, code: 'LOCK_IDENTITY_MISMATCH', tokenId: id }
  }
  const now = i.now.getTime()
  if (Date.parse(t.issuedAt) > now + RUN_TOKEN_CLOCK_SKEW_MS) return { ok: false, code: 'TOKEN_NOT_YET_VALID', tokenId: id }
  if (now >= Date.parse(t.expiresAt)) return { ok: false, code: 'TOKEN_EXPIRED', tokenId: id }
  return {
    ok: true, tokenId: t.tokenId, trigger: t.trigger,
    launchTrigger: t.launchTrigger, absorbedTrigger: t.absorbedTrigger, absorbedAt: t.absorbedAt,
    budgetWindowShadow: t.budgetWindowShadow, pass: t.pass, runId: t.runId,
  }
}
