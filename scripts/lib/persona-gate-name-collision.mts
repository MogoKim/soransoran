/**
 * Persona Safety Gate ⑥-B — displayName 충돌 판정부
 *
 * 정본: docs/operations/2026-08-31-persona-gate6-nickname-collision-design.md
 *
 * 🔴 ⑥ 은 두 갈래다. 이 파일은 **⑥-B(작명 충돌)** 만 본다.
 *
 *    ⑥-A 생성물 혼입   글·댓글 본문에 남의 닉네임이 섞였는가   생성마다  regenerate
 *    ⑥-B 작명 충돌     displayName 후보가 겹치는가            배정 1회  reject/review
 *
 *    입력도(긴 텍스트 vs 이름 하나) 주기도 실패 의미도 다르다.
 *    A 는 문장을 다시 쓰면 되지만 B 는 **이름 자체를 버려야** 한다.
 *
 * 🔴 순수 함수다. DB · LLM · 파일 IO · 네트워크 없음.
 *    대조 집합은 인자로 받는다 — 조회는 호출부의 책임이다.
 *    Gate ⑤ · ⑨ 가 순수 함수라 fixture 로 역검증이 가능했다.
 *    ⑥-B 는 외부 상태(회원 닉네임)에 의존하므로 그 분리가 더 중요하다.
 *
 * 🔴 반환값에 원문 문자열 필드를 두지 않는다.
 *    충돌을 설명하려면 이름을 말하고 싶어진다 — 그것이 이 판정부에서
 *    가장 깨지기 쉬운 원칙이다. 종류 · 단계 · 거리 · 참조 타입만 돌려준다.
 *    (B4 출처 marker 만 예외다. 개인 닉네임이 아니라 코드 상수의 집단 호칭이다)
 *
 * 🔴 이 파일이 하지 않는 것
 *      · DB 조회 (대조 집합을 만들지 않는다)
 *      · displayName 작명
 *      · ⑥-A 생성물 혼입 검사
 *      · authorHash 원문 복원 — 불가능하다. 해시는 일치 계열만 본다
 */
import { SOURCE_SPECIFIC_TERMS, SOURCE_CONTEXT_TERMS } from './voice-style-signals.mjs'

// ── 정규화 4단계 (설계 §5-1) ────────────────────────────────
//    🔴 N0·N1·N2 만 충돌 판정 키다. N3 는 review 참고 신호일 뿐이다.

/** N1 — trim + NFC + 소문자 */
export function normalizeN1(raw: string): string {
  return raw.trim().normalize('NFC').toLowerCase()
}

/** N2 — N1 + 공백·기호 제거. 🔴 판정 경계는 여기까지다 */
export function normalizeN2(raw: string): string {
  return normalizeN1(raw).replace(/[\s._\-~·♡★☆!@#$%^&*()+=|\\/[\]{}<>?,;:'"`]/g, '')
}

/**
 * N3 — N2 + 숫자·영문 제거.
 *
 * 🔴 충돌 판정 키가 아니다. 실측(설계 §6-4):
 *      N3 결과가 빈 문자열      10.4~10.5%   한글 없는 이름이 전부 같아진다
 *      N3 에서 고유 개수 감소   12.2~13.4%   서로 다른 이름이 뭉친다
 *    reject 로 쓰면 열에 하나가 근거 없이 걸린다.
 */
export function normalizeN3(raw: string): string {
  return normalizeN2(raw).replace(/[0-9a-z]/g, '')
}

/** 반복 문자 축약 — 3회 이상 연속을 1회로 (설계 §5-2) */
function collapseRepeats(value: string): string {
  return value.replace(/(.)\1{2,}/gu, '$1')
}

const charLength = (value: string): number => [...value].length

/** 편집 거리 (Levenshtein) */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const x = [...a]
  const y = [...b]
  if (x.length === 0) return y.length
  if (y.length === 0) return x.length
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const cur: number[] = [i]
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[y.length]
}

// ── 판정 대상 · 결과 타입 ────────────────────────────────────

/** 대조 대상 (설계 §3) */
export type CollisionKind =
  | 'B1_MEMBER'        // 실회원 표시명 — User.nickname ∪ User.name
  | 'B2_CRAWL_AUTHOR'  // 크롤 author — 🔴 해시. 일치 계열만
  | 'B3_PERSONA'       // 기존 persona displayName (retired·paused 포함)
  | 'B4_SOURCE_MARKER' // 출처 커뮤니티 marker — 코드 상수
  | 'B5_OPERATOR_AI'   // 운영자 / AI 느낌
  | 'B6_IDENTIFYING'   // 나이 · 지역 · 병명 · 가족상태 노출

/** 어느 정규화 단계에서 걸렸는가 */
export type NormalizeStage = 'N0' | 'N1' | 'N2' | 'N3'

export type NameCollisionStatus = 'pass' | 'review' | 'regenerate' | 'reject'

/**
 * 충돌 1건.
 * 🔴 원문 문자열이 없다. `term` 은 B4·B5·B6 에서만 채워지며 코드 상수/규칙 이름이다.
 */
export type NameCollisionHit = {
  kind: CollisionKind
  /** 규칙 위반(B5·B6)에는 정규화 단계가 없다 */
  stage?: NormalizeStage
  /** 편집 거리. 완전 일치는 0 */
  distance?: number
  /** 대조 대상의 참조 타입 — 값이 아니라 종류다 */
  refType?: 'userId' | 'personaId' | 'authorHash' | 'authorHashNorm'
  /** 🔴 코드 상수 또는 규칙 이름만. 개인 닉네임은 절대 담지 않는다 */
  term?: string
}

export type NameCollisionVerdict = {
  status: NameCollisionStatus
  hits: NameCollisionHit[]
  /** 후보 이름의 글자 수 — 길이 구간 판정 근거 (원문 아님) */
  candidateLength: number
  /** 🔴 원문 조각을 담지 않는다. 종류 · 단계 · 거리만 적는다 */
  reason: string
}

/**
 * 대조 집합. 🔴 호출부가 조회해서 넣는다 — 이 파일은 DB 를 모른다.
 */
export type NameCollisionSets = {
  /** 실회원 표시명 — 🔴 User.nickname ∪ User.name 둘 다 (설계 §4-1) */
  memberNames?: readonly string[]
  /** 기존 persona displayName — 🔴 retired·paused 포함 전부 */
  personaNames?: readonly string[]
  /** 크롤 author 원본 해시 — VoiceSource·VoiceCommentSignal */
  authorHashes?: ReadonlySet<string>
  /** 크롤 author N2 정규화 해시 */
  authorHashNorms?: ReadonlySet<string>
}

export type NameCollisionOptions = {
  /**
   * 후보를 해시하는 함수. 🔴 호출부가 salt 를 쥔다 —
   * 판정부가 salt 를 알면 순수 함수가 아니게 되고 fixture 가 환경에 묶인다.
   */
  hashOf?: (value: string) => string
}

// ── 길이 구간 (설계 §6-2) ────────────────────────────────────
//    🔴 짧은 이름에서 절대 거리는 의미가 달라진다.
//       거리 1 = 3자 중 1자(33% 다름) vs 7자 중 1자(14% 다름).
//
//    🔴 이 수치는 잠정값이다. 회원 표시명 표본이 6개뿐이라
//       확정할 수 없다(설계 §6-4). 회원이 늘면 재측정해서 고친다.
const LENGTH_MIN_FOR_SIMILARITY = 3   // 2자 이하는 완전 일치만 본다
const LENGTH_STRICT_FROM = 5          // 5자 이상은 거리 1 도 reject

// ── B5 운영자 / AI 느낌 (설계 §5-4) ──────────────────────────
const OPERATOR_PATTERNS: ReadonlyArray<{ term: string; re: RegExp }> = [
  { term: 'OPERATOR_지기', re: /지기$/u },
  { term: 'OPERATOR_관리', re: /관리/u },
  { term: 'OPERATOR_운영', re: /운영/u },
  { term: 'OPERATOR_매니저', re: /매니저/u },
  { term: 'OPERATOR_운영자', re: /운영자/u },
]
const AI_PATTERNS: ReadonlyArray<{ term: string; re: RegExp }> = [
  { term: 'AI_어휘', re: /(ai|gpt|bot|봇)/iu },
  { term: 'AI_숫자접미', re: /[0-9]+$/u },
  { term: 'AI_영문혼용', re: /[a-z]/iu },
]

// ── B6 식별 정보 노출 (설계 §5-5) ────────────────────────────
//    🔴 Gate ③ 과 다르다. ③ 은 본문을, B6 은 이름 하나를 본다.
//       이름은 모든 글에 반복 노출되므로 기준이 더 엄격하다.
const IDENTIFYING_PATTERNS: ReadonlyArray<{ term: string; re: RegExp }> = [
  { term: 'ID_나이', re: /[0-9]{2}\s*(세|대)/u },
  { term: 'ID_지역', re: /[가-힣]{2,4}(시|구|동|읍|면)$/u },
  { term: 'ID_병명', re: /(당뇨|고혈압|갑상선|류마티스|우울증|치매|골다공증|디스크|협심증|뇌졸중|백내장|녹내장|공황장애)/u },
  { term: 'ID_가족', re: /^(엄마|아빠|며느리|시어머니|시엄마|남편|아내|딸|아들)$/u },
]

// ── 판정 ─────────────────────────────────────────────────────

/** 상태의 엄격도. 🔴 가장 엄격한 쪽을 따른다 (설계 §7) */
const SEVERITY: Record<NameCollisionStatus, number> = {
  pass: 0, review: 1, regenerate: 2, reject: 3,
}
const stricter = (a: NameCollisionStatus, b: NameCollisionStatus): NameCollisionStatus =>
  SEVERITY[a] >= SEVERITY[b] ? a : b

function matchRules(
  candidate: string,
  rules: ReadonlyArray<{ term: string; re: RegExp }>,
  kind: CollisionKind,
): NameCollisionHit[] {
  return rules.filter((r) => r.re.test(candidate)).map((r) => ({ kind, term: r.term }))
}

/** B4 — 출처 커뮤니티 marker. 🔴 term 을 그대로 남긴다(코드 상수의 집단 호칭) */
function matchSourceMarker(candidate: string): NameCollisionHit[] {
  const n2 = normalizeN2(candidate)
  const hits: NameCollisionHit[] = []
  for (const { term } of SOURCE_SPECIFIC_TERMS) {
    if (n2.includes(normalizeN2(term))) hits.push({ kind: 'B4_SOURCE_MARKER', term })
  }
  for (const { term } of SOURCE_CONTEXT_TERMS) {
    if (n2.includes(normalizeN2(term))) hits.push({ kind: 'B4_SOURCE_MARKER', term })
  }
  return hits
}

/**
 * 이름 대조 — B1(회원) · B3(persona).
 * 🔴 원문 접근이 가능한 갈래라 유사도까지 본다.
 */
function matchNames(
  candidate: string,
  names: readonly string[],
  kind: CollisionKind,
  refType: 'userId' | 'personaId',
): NameCollisionHit[] {
  const hits: NameCollisionHit[] = []
  const cLen = charLength(candidate)

  const stages: ReadonlyArray<{ stage: NormalizeStage; fn: (v: string) => string }> = [
    { stage: 'N0', fn: (v) => v },
    { stage: 'N1', fn: normalizeN1 },
    { stage: 'N2', fn: normalizeN2 },
  ]

  for (const name of names) {
    // ── 완전 일치 계열 (N0 · N1 · N2) — 걸린 첫 단계만 남긴다
    let exact: NormalizeStage | null = null
    for (const { stage, fn } of stages) {
      const a = fn(candidate)
      const b = fn(name)
      if (a !== '' && a === b) { exact = stage; break }
    }
    if (exact !== null) {
      hits.push({ kind, stage: exact, distance: 0, refType })
      continue
    }

    // ── 반복 문자 축약 후 재대조 (설계 §5-2)
    if (collapseRepeats(normalizeN2(candidate)) === collapseRepeats(normalizeN2(name))) {
      hits.push({ kind, stage: 'N2', distance: 0, refType })
      continue
    }

    // ── 유사도 — 🔴 짧은 이름에서는 하지 않는다 (설계 §6-2)
    const nLen = charLength(name)
    if (cLen >= LENGTH_MIN_FOR_SIMILARITY && nLen >= LENGTH_MIN_FOR_SIMILARITY) {
      const d = editDistance(normalizeN2(candidate), normalizeN2(name))
      if (d > 0 && d <= 2) hits.push({ kind, stage: 'N2', distance: d, refType })
    }

    // ── N3 — 🔴 reject 키가 아니다. review 참고 신호로만 남긴다
    //    N3 결과가 빈 문자열이면 비교 자체를 하지 않는다
    const c3 = normalizeN3(candidate)
    const n3 = normalizeN3(name)
    if (c3 !== '' && n3 !== '' && c3 === n3) {
      hits.push({ kind, stage: 'N3', distance: 0, refType })
    }
  }
  return hits
}

/**
 * B2 — 크롤 author.
 * 🔴 해시는 부분 문자열도 거리도 보존하지 않는다. **일치 계열만** 본다.
 *    여기서 유사도를 하겠다고 쓰면 그것은 거짓 설계다(설계 §4-2).
 */
function matchAuthorHashes(
  candidate: string,
  sets: NameCollisionSets,
  hashOf?: (value: string) => string,
): NameCollisionHit[] {
  if (hashOf === undefined) return []
  const hits: NameCollisionHit[] = []

  if (sets.authorHashes !== undefined && sets.authorHashes.has(hashOf(candidate))) {
    hits.push({ kind: 'B2_CRAWL_AUTHOR', stage: 'N0', distance: 0, refType: 'authorHash' })
  }
  const n2 = normalizeN2(candidate)
  if (n2 !== '' && sets.authorHashNorms !== undefined && sets.authorHashNorms.has(hashOf(n2))) {
    hits.push({ kind: 'B2_CRAWL_AUTHOR', stage: 'N2', distance: 0, refType: 'authorHashNorm' })
  }
  return hits
}

/** 이름 충돌 hit 하나의 상태 — 길이 구간에 따라 다르다 (설계 §6-2) */
function statusOfNameHit(hit: NameCollisionHit, candidateLength: number): NameCollisionStatus {
  // 🔴 N3 는 어떤 경우에도 reject 가 아니다
  if (hit.stage === 'N3') return 'review'
  if (hit.distance === 0) return 'reject'
  if (hit.distance === 1) return candidateLength >= LENGTH_STRICT_FROM ? 'reject' : 'review'
  return 'review'
}

/**
 * displayName 후보가 남의 이름과 충돌하는지 판정한다.
 *
 * 🔴 순수 함수다. 대조 집합은 인자로 받는다.
 */
export function checkNameCollision(
  candidateName: string,
  sets: NameCollisionSets = {},
  opts: NameCollisionOptions = {},
): NameCollisionVerdict {
  const candidate = (candidateName ?? '').trim()
  const candidateLength = charLength(candidate)

  if (candidate === '') {
    return {
      status: 'regenerate',
      hits: [],
      candidateLength: 0,
      reason: '후보가 비어 있다',
    }
  }

  // ── 싼 검사부터 (설계 §7 판정 순서) ──
  const ruleHits: NameCollisionHit[] = [
    ...matchSourceMarker(candidate),
    ...matchRules(candidate, OPERATOR_PATTERNS, 'B5_OPERATOR_AI'),
    ...matchRules(candidate, AI_PATTERNS, 'B5_OPERATOR_AI'),
    ...matchRules(candidate, IDENTIFYING_PATTERNS, 'B6_IDENTIFYING'),
  ]

  const nameHits: NameCollisionHit[] = [
    ...matchNames(candidate, sets.personaNames ?? [], 'B3_PERSONA', 'personaId'),
    ...matchNames(candidate, sets.memberNames ?? [], 'B1_MEMBER', 'userId'),
    ...matchAuthorHashes(candidate, sets, opts.hashOf),
  ]

  const hits = [...ruleHits, ...nameHits]

  let status: NameCollisionStatus = 'pass'
  for (const hit of ruleHits) {
    // B4 는 남의 것이라 reject · B5·B6 은 짓는 방식 문제라 regenerate (설계 §3 · §7)
    status = stricter(status, hit.kind === 'B4_SOURCE_MARKER' ? 'reject' : 'regenerate')
  }
  for (const hit of nameHits) {
    status = stricter(status, statusOfNameHit(hit, candidateLength))
  }

  return { status, hits, candidateLength, reason: describe(hits) }
}

/** 🔴 원문 조각을 담지 않는다 — 종류 · 단계 · 거리 · 참조 타입만 */
function describe(hits: NameCollisionHit[]): string {
  if (hits.length === 0) return '충돌 없음'
  const byKind = new Map<CollisionKind, NameCollisionHit[]>()
  for (const h of hits) {
    const list = byKind.get(h.kind)
    if (list === undefined) byKind.set(h.kind, [h]); else list.push(h)
  }
  const parts: string[] = []
  for (const [kind, list] of byKind) {
    const terms = list.map((h) => h.term).filter((t): t is string => t !== undefined)
    if (terms.length > 0) { parts.push(`${kind} ${terms.join(' · ')}`); continue }
    const detail = list
      .map((h) => `${h.stage ?? '-'}${h.distance !== undefined ? `/d${h.distance}` : ''}`)
      .join(' · ')
    parts.push(`${kind} ${list.length}건 (${detail})`)
  }
  return parts.join(' / ')
}

/** 어드민이 보는 요약. 🔴 여기에도 원문이 없다 */
export function summarizeForAdmin(verdict: NameCollisionVerdict): {
  status: NameCollisionStatus
  counts: Record<CollisionKind, number>
  stages: Record<NormalizeStage, number>
  minDistance: number | null
} {
  const counts = {
    B1_MEMBER: 0, B2_CRAWL_AUTHOR: 0, B3_PERSONA: 0,
    B4_SOURCE_MARKER: 0, B5_OPERATOR_AI: 0, B6_IDENTIFYING: 0,
  } satisfies Record<CollisionKind, number>
  const stages = { N0: 0, N1: 0, N2: 0, N3: 0 } satisfies Record<NormalizeStage, number>
  let minDistance: number | null = null
  for (const h of verdict.hits) {
    counts[h.kind]++
    if (h.stage !== undefined) stages[h.stage]++
    if (h.distance !== undefined && (minDistance === null || h.distance < minDistance)) {
      minDistance = h.distance
    }
  }
  return { status: verdict.status, counts, stages, minDistance }
}

/** 길이 구간 임계 — 🔴 잠정값이다 (설계 §6-4: 회원 표본 6개) */
export const NAME_COLLISION_THRESHOLDS = {
  minLengthForSimilarity: LENGTH_MIN_FOR_SIMILARITY,
  strictRejectFromLength: LENGTH_STRICT_FROM,
  maxReviewDistance: 2,
} as const
