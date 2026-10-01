/**
 * 🔴 **크롤 작가 해시 — 정본은 이 파일 하나다** (2026-10-01 · author-hash v2)
 *
 * 왜 바꾸나
 *    앞판은 적재 도구 · 배정 도구 11곳이 `sha256(salt::이름)` 을 **각자 인라인으로** 계산했고, salt 가 없으면
 *    **공개 기본값**으로 조용히 내려갔다. 계약 계기판만 그 기본값을 거부했다 — 같은 판정에 두 권위가 있었다.
 *    저장된 68,926행(`VoiceSource` · `VoiceCommentSignal` 의 `authorHash` · `authorHashNorm`)은 공개 기본값으로
 *    만들어졌을 가능성이 가장 크고(정본 env · 백업 16개 어디에도 salt 키가 없다), 공개 값이면 사전 대입으로 이름을 복원할 수 있다.
 *
 * 무엇으로 바꾸나 — 세대를 값에 적는다
 *    v1  `sha256:<hex64>`                  = sha256(LEGACY_V1_DOMAIN :: 값)          (옛 저장값 · 새로 쓰지 않는다)
 *    v2  `hmac-v2:<kid12>:<hex64>`          = HMAC-SHA256(key, v1 의 hex64)           (새 정본)
 *    🔴 v2 는 v1 을 **감싼다**. 같은 사람은 전환 전후에도 같은 값으로 비교된다 — 원문 없이 기존 이력을 옮길 수 있다.
 *    🔴 `LEGACY_V1_DOMAIN` 은 **v1 동일성 사슬의 첫 고리**다. key 가 없을 때 대신 쓰는 fallback 이 아니다 —
 *       key 가 없으면 이 파일의 모든 공개 함수가 실패한다. 이 상수는 이 파일 밖에 나오지 않는다(검사가 잠근다).
 *    🔴 `kid` 는 key 의 지문(HMAC(key, 고정 문자열) 앞 12자)이다 — 저장값이 **지금 key 로** 만든 것인지 가린다.
 *       다른 key 로 만든 v2 와 비교하면 전부 빗나가 거짓 통과가 되기 때문이다.
 *
 * Gate ⑥-B 가 쓸 수 있는 상태는 하나뿐이다 — 비교 집합이 **비어 있지 않고 전부 지금 key 의 v2** 일 때.
 *    key 없음 · 짧은 key · 비교 집합 없음 · v1 만(전환 필요) · 섞임 · 손상 · 다른 key → 쓸 수 없다(UNKNOWN / fail-closed).
 *
 * 🔴 이 파일은 해시 · 이름 · key 를 출력하지 않는다. 사유 코드와 수만 돌려준다.
 */
import { createHash, createHmac } from 'node:crypto'

import { readEnvKeys } from './canonical-env.mjs'

/** 정본 env 의 키 이름 — 읽는 곳은 `readAuthorHashKey` 하나다 */
export const AUTHOR_HASH_KEY_ENV = 'VOICE_AUTHOR_HASH_SALT'
/** 🔴 key 최소 길이 — 짧은 key 는 사전 대입을 막지 못한다 */
export const AUTHOR_HASH_KEY_MIN_LENGTH = 32

export const V1_PREFIX = 'sha256:'
export const V2_PREFIX = 'hmac-v2:'

/** 🔴 v1 동일성 사슬의 첫 고리 — fallback 이 아니다(머리말) */
const LEGACY_V1_DOMAIN = 'soransoran-voice-v1'
const KID_LABEL = 'soransoran-author-hash-kid'
const HEX64 = /^[0-9a-f]{64}$/
const KID = /^[0-9a-f]{12}$/

export type AuthorHashKey = { readonly kid: string; readonly mac: (hex: string) => string }
export type AuthorHashKeyRead =
  | { ok: true; key: AuthorHashKey }
  | { ok: false; code: 'KEY_MISSING' | 'KEY_TOO_SHORT' | 'ENV_UNREADABLE'; reason: string }

/** 🔴 key 값 → key 객체. 값 자체는 클로저 안에만 둔다(객체에 싣지 않는다) */
export function authorHashKeyOf(secret: unknown): AuthorHashKeyRead {
  const s = typeof secret === 'string' ? secret.trim() : ''
  if (s === '') return { ok: false, code: 'KEY_MISSING', reason: `${AUTHOR_HASH_KEY_ENV} 없음 — 공개 기본값으로 대신하지 않는다` }
  if (s.length < AUTHOR_HASH_KEY_MIN_LENGTH) {
    return { ok: false, code: 'KEY_TOO_SHORT', reason: `${AUTHOR_HASH_KEY_ENV} 가 ${AUTHOR_HASH_KEY_MIN_LENGTH}자보다 짧다` }
  }
  const mac = (hex: string): string => createHmac('sha256', s).update(hex, 'utf8').digest('hex')
  return { ok: true, key: { kid: createHmac('sha256', s).update(KID_LABEL, 'utf8').digest('hex').slice(0, 12), mac } }
}

/** 🔴 **key 를 읽는 유일한 곳** — 정본 env 파일만 본다(`process.env` · cwd `.env.local` 을 보지 않는다) */
export function readAuthorHashKey(envPath?: string): AuthorHashKeyRead {
  const env = envPath === undefined ? readEnvKeys([AUTHOR_HASH_KEY_ENV]) : readEnvKeys([AUTHOR_HASH_KEY_ENV], envPath)
  if (!env.ok) return { ok: false, code: 'ENV_UNREADABLE', reason: env.reason ?? '정본 env 를 읽지 못했다' }
  return authorHashKeyOf(env.values[AUTHOR_HASH_KEY_ENV])
}

/** v1 사슬 첫 고리(hex64) — 내보내지 않는다 */
const legacyHexOf = (value: string): string =>
  createHash('sha256').update(`${LEGACY_V1_DOMAIN}::${value}`, 'utf8').digest('hex')

/**
 * 🔴 **작가 해시(v2) — 새로 쓰는 값 · 후보 이름 비교 값은 이것 하나다.**
 *    원문 값(작가명 · N2 정규화 이름)을 받아 v1 사슬을 거쳐 v2 로 만든다.
 */
export function authorHashV2Of(value: string, key: AuthorHashKey): string {
  return `${V2_PREFIX}${key.kid}:${key.mac(legacyHexOf(value))}`
}

/**
 * 🔴 **v1 동일성 사슬 증명 probe — 수만 돌려준다.** 저장 v1 값이 정말 `LEGACY_V1_DOMAIN` 으로 만들어졌는지 보는 유일한 방법은
 *    이미 아는 이름(회원 · Persona 표시명)을 같은 사슬로 해시해 저장 집합에 **들어 있는지** 세는 것이다.
 *    hits > 0 이면 증명(다른 salt 로 만든 값이 우연히 맞을 확률은 무시할 만하다). hits = 0 이면 **증명하지 못한 것**이지 반증이 아니다.
 *    🔴 해시 · 이름을 돌려주지 않는다. v1 계산식을 이 파일 밖으로 내보내지 않기 위해 여기 둔다.
 */
export function legacyDomainProbe(
  names: Iterable<string>, storedV1: ReadonlySet<string>, normalize: (v: string) => string,
): { probeNames: number; hits: number } {
  let probeNames = 0
  let hits = 0
  for (const raw of names) {
    const n = raw.trim()
    if (n === '') continue
    probeNames += 1
    const z = normalize(n)
    if (storedV1.has(`${V1_PREFIX}${legacyHexOf(n)}`) || (z !== '' && storedV1.has(`${V1_PREFIX}${legacyHexOf(z)}`))) hits += 1
  }
  return { probeNames, hits }
}

/** 🔴 원본 대조 증명의 최소 표본 — 이보다 적게 맞으면 증명이 아니다 */
export const LEGACY_PROOF_MIN_SAMPLE = 100

export type LegacyDomainProof = {
  status: 'PROVEN' | 'UNKNOWN'
  /** 뽑은 행 수 */
  sample: number
  /** 원본 작가명이 있고 저장값이 v1 이라 대조한 행 수 · 그중 일치 */
  compared: number
  matched: number
  /** authorHashNorm 대조 수 · 일치 */
  normCompared: number
  normMatched: number
  reason: string
}

/**
 * 🔴 **v1 사슬 원본 대조 증명 — 수만 돌려준다.** 저장 v1 값 옆에 그 행의 **원본 작가명**(우나어 read-only)을 놓고
 *    `LEGACY_V1_DOMAIN` 사슬로 다시 계산해 같은지 센다. 알려진 회원 이름 probe 와 달리 "그 행을 만든 바로 그 입력" 이라
 *    일치하면 증명, 어긋나면 사슬이 다르다는 뜻이다.
 *    PROVEN = 대조 ≥ `LEGACY_PROOF_MIN_SAMPLE` · 원본 해시 전부 일치 · 정규화 해시 전부 일치. 그 밖은 전부 UNKNOWN(우회 없음).
 *    🔴 이름 · 해시를 돌려주지 않는다.
 */
export function legacyDomainSampleProof(
  rows: Iterable<{ author: string | null; storedHash: string | null; storedNorm: string | null }>,
  normalize: (v: string) => string,
): LegacyDomainProof {
  let sample = 0, compared = 0, matched = 0, normCompared = 0, normMatched = 0
  for (const r of rows) {
    sample += 1
    const a = (r.author ?? '').trim()
    if (a === '') continue
    if (r.storedHash !== null && generationOf(r.storedHash).gen === 'v1') {
      compared += 1
      if (r.storedHash === `${V1_PREFIX}${legacyHexOf(a)}`) matched += 1
    }
    const z = normalize(a)
    if (z !== '' && r.storedNorm !== null && generationOf(r.storedNorm).gen === 'v1') {
      normCompared += 1
      if (r.storedNorm === `${V1_PREFIX}${legacyHexOf(z)}`) normMatched += 1
    }
  }
  const base = { sample, compared, matched, normCompared, normMatched }
  if (compared < LEGACY_PROOF_MIN_SAMPLE) {
    return { ...base, status: 'UNKNOWN', reason: `대조 표본 ${compared} < ${LEGACY_PROOF_MIN_SAMPLE} — 증명할 수 없다` }
  }
  if (matched !== compared) return { ...base, status: 'UNKNOWN', reason: `원본 해시 일치 ${matched}/${compared} — 저장값이 이 사슬로 만들어졌다고 말할 수 없다` }
  if (normMatched !== normCompared) return { ...base, status: 'UNKNOWN', reason: `정규화 해시 일치 ${normMatched}/${normCompared} — 정규화 사슬이 다르다` }
  return { ...base, status: 'PROVEN', reason: `원본 해시 ${matched}/${compared} · 정규화 해시 ${normMatched}/${normCompared} 일치` }
}

/** 🔴 저장된 v1 값을 v2 로 감싼다(원문 없이). v1 모양이 아니면 null — 추측으로 감싸지 않는다 */
export function wrapV1(stored: string, key: AuthorHashKey): string | null {
  if (!stored.startsWith(V1_PREFIX)) return null
  const hex = stored.slice(V1_PREFIX.length)
  return HEX64.test(hex) ? `${V2_PREFIX}${key.kid}:${key.mac(hex)}` : null
}

export type AuthorHashGeneration = { gen: 'v1' } | { gen: 'v2'; kid: string } | { gen: 'corrupt' }

/** 저장값 한 개의 세대 — 모양이 정확히 맞을 때만 v1 · v2 다 */
export function generationOf(stored: string): AuthorHashGeneration {
  if (stored.startsWith(V1_PREFIX)) return HEX64.test(stored.slice(V1_PREFIX.length)) ? { gen: 'v1' } : { gen: 'corrupt' }
  if (stored.startsWith(V2_PREFIX)) {
    const [kid, hex, ...rest] = stored.slice(V2_PREFIX.length).split(':')
    return rest.length === 0 && kid !== undefined && hex !== undefined && KID.test(kid) && HEX64.test(hex)
      ? { gen: 'v2', kid } : { gen: 'corrupt' }
  }
  return { gen: 'corrupt' }
}

export type AuthorHashCensus = { v1: number; v2Current: number; v2OtherKey: number; corrupt: number; total: number }

/** 🔴 세대 집계 — key 가 없으면 v2 를 지금 key 것인지 가를 수 없어 전부 `v2OtherKey` 로 센다(fail-closed) */
export function censusOf(values: Iterable<string>, key: AuthorHashKey | null): AuthorHashCensus {
  const c: AuthorHashCensus = { v1: 0, v2Current: 0, v2OtherKey: 0, corrupt: 0, total: 0 }
  for (const v of values) {
    c.total += 1
    const g = generationOf(v)
    if (g.gen === 'v1') c.v1 += 1
    else if (g.gen === 'corrupt') c.corrupt += 1
    else if (key !== null && g.kid === key.kid) c.v2Current += 1
    else c.v2OtherKey += 1
  }
  return c
}

export type AuthorHashSetState =
  | 'v2-ready' | 'needs-migration' | 'mixed' | 'corrupt' | 'key-mismatch' | 'empty'

/**
 * 🔴 **비교 집합의 상태 — 판정은 이 함수 하나.**
 *    비었다 → empty(PASS 금지) · 손상 1건이라도 → corrupt · 다른 key 의 v2 → key-mismatch ·
 *    v1 과 v2 가 섞였다 → mixed · 전부 v1 → needs-migration(새 key 만 있고 저장값은 옛 세대) · 전부 지금 key 의 v2 → v2-ready
 */
export function setStateOf(c: AuthorHashCensus): AuthorHashSetState {
  if (c.total === 0) return 'empty'
  if (c.corrupt > 0) return 'corrupt'
  if (c.v2OtherKey > 0) return 'key-mismatch'
  if (c.v1 > 0 && c.v2Current > 0) return 'mixed'
  if (c.v1 === c.total) return 'needs-migration'
  return 'v2-ready'
}

export const SET_STATE_REASON: Readonly<Record<AuthorHashSetState, string>> = {
  'v2-ready': '비교 가능',
  'needs-migration': '저장 작가 해시가 옛 세대(v1)다 — v2 전환 전에는 대조하지 않는다',
  mixed: '저장 작가 해시에 v1 · v2 가 섞여 있다 — 대조하지 않는다',
  corrupt: '저장 작가 해시 모양이 손상됐다 — 대조하지 않는다',
  'key-mismatch': '저장 작가 해시가 지금 key 로 만든 값이 아니다 — 대조하지 않는다',
  empty: '비교할 작가 해시 집합이 비었다 — 통과로 읽지 않는다',
}

export type AuthorGate =
  | { ok: true; hashOf: (value: string) => string }
  | { ok: false; code: 'KEY_MISSING' | 'KEY_TOO_SHORT' | 'ENV_UNREADABLE' | AuthorHashSetState; reason: string }

/**
 * 🔴 **Gate ⑥-B B2 에 넘길 수 있는 유일한 해시 함수를 만든다.**
 *    key 가 있고 두 비교 집합(원본 · N2)을 합친 상태가 `v2-ready` 일 때만 `hashOf` 를 준다.
 *    그 밖에는 이유와 함께 거절한다 — 부르는 쪽은 UNKNOWN(계기판) 또는 중단(배정 도구)으로 읽는다.
 */
export function authorGateOf(
  keyRead: AuthorHashKeyRead,
  sets: { authorHashes: ReadonlySet<string>; authorHashNorms: ReadonlySet<string> },
): AuthorGate {
  if (!keyRead.ok) return { ok: false, code: keyRead.code, reason: keyRead.reason }
  const key = keyRead.key
  const state = setStateOf(censusOf([...sets.authorHashes, ...sets.authorHashNorms], key))
  if (state !== 'v2-ready') return { ok: false, code: state, reason: SET_STATE_REASON[state] }
  return { ok: true, hashOf: (value: string) => authorHashV2Of(value, key) }
}

/**
 * 🔴 **새 작가 해시를 쓸 수 있는가** — 적재 도구가 쓰기 전에 부른다.
 *    비었거나(새 DB) 전부 지금 key 의 v2 일 때만 쓴다. 옛 세대 위에 v2 를 섞어 쓰지 않는다.
 */
export function writableStateOf(c: AuthorHashCensus): { ok: true } | { ok: false; state: AuthorHashSetState; reason: string } {
  const state = setStateOf(c)
  return state === 'v2-ready' || state === 'empty' ? { ok: true } : { ok: false, state, reason: SET_STATE_REASON[state] }
}
