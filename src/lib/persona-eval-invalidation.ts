/**
 * 유료 회차 **영구 무효 기록** + reference manifest 계약 — 🔴 순수 판정
 *
 * 🔴 **왜 이 파일이 생겼나** (2026-09-10, 창업자 판정 P0-1·P0-2).
 *
 *    회차 `20260910-153254` 의 말투 근거에 **실제 닉네임이 섞여 있었다.**
 *    자산 파일 하나의 `comments` 가 닉네임과 댓글이 번갈아 든 평문 배열이었는데
 *    로더가 모든 문자열을 댓글로 받았다.
 *    공개 카페 **[작성자 식별자 예시 삭제]** 약 454건이 프롬프트에 실려 나갔다.
 *
 * 🔴 **실제 값을 여기 옮겨 적지 않는다.** 사고를 설명하려고 예시를 들면
 *    그 순간 추적 파일이 새 유출 지점이 된다 — 개수와 성격만 적는다.
 *
 * 🔴 **"외부에서 저장되지 않았다" 고 쓰지 않는다.**
 *    우리가 아는 것은 **보냈다**는 사실뿐이다. 받은 쪽이 무엇을 얼마나 보관하는지
 *    우리는 확인할 수 없다. 확인하지 못한 것을 "안전하다" 로 적으면
 *    다음 사람이 그 문장을 근거로 읽는다.
 *
 * 🔴 **원 artifact 는 고치지 않는다.** 무효는 **바깥의 기록**으로 남긴다 —
 *    표본을 지우면 무엇이 왜 잘못됐는지 볼 수 없게 된다.
 *    지우는 대신 **쓰지 못하게** 한다.
 */

export const INVALIDATION_REASONS = [
  /** 참고 댓글에 작성자 식별자(닉네임)가 섞여 외부 provider 로 전송됨 */
  'REFERENCE_IDENTITY_DISCLOSURE',
] as const
export type InvalidationReason = (typeof INVALIDATION_REASONS)[number]

export type InvalidatedRun = {
  runId: string
  reason: InvalidationReason
  /** 판정한 날 */
  decidedAt: string
  /** 🔴 무엇이 어디로 갔는가 — 추정하지 않고 아는 것만 적는다 */
  disclosure: string
  detail: string
}

/**
 * 🔴 **영구다.** 시간이 지나도 풀리지 않는다.
 *    되살리려면 이 목록에서 지우는 커밋이 있어야 하고, 그 커밋이 곧 기록이 된다.
 */
export const INVALIDATED_RUNS: readonly InvalidatedRun[] = [
  {
    runId: '20260910-153254',
    reason: 'REFERENCE_IDENTITY_DISCLOSURE',
    decidedAt: '2026-09-10',
    disclosure:
      '작성자 식별자(닉네임) 약 454건이 말투 근거로 프롬프트에 실려'
      + ' **Anthropic · Google 로 전송됨. 외부 보존 여부 미확인.**',
    detail:
      'tmp/voice-m3-review/_sample-corpus.json 의 comments 가 닉네임과 댓글이 번갈아 든'
      + ' 평문 문자열 배열인데 로더가 모든 문자열을 댓글로 받았다.'
      + ' 🔴 이 회차는 winner 선정 · 채점 · Queue 근거로 쓸 수 없다.'
      + ' 표본은 프롬프트 수정 효과(억지 생활 장면 0/20)의 관찰 자료로만 남긴다.',
  },
]

export function findInvalidation(runId: string): InvalidatedRun | null {
  return INVALIDATED_RUNS.find((r) => r.runId === runId) ?? null
}

// ─────────────────────────────────────────────────────────
// reference manifest — 🔴 이것이 없으면 회차를 믿을 근거가 없다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **sanitizer 판(版).** 규칙이 바뀌면 올린다.
 *    옛 판으로 만든 회차와 새 판으로 만든 회차를 섞어 비교하지 않기 위해서다.
 *
 *    v1  맨 문자열·body·text 를 전부 댓글로 받던 판 (🔴 닉네임 유입)
 *    v2  `{ content }` 만 받는 판 + 작성자 anchor 묶기
 */
export const SANITIZER_VERSION = 'v2'

export type IdentityLeakCheck = {
  /** 검사를 실제로 돌렸는가 — 🔴 안 돌린 것을 통과로 세지 않는다 */
  ran: boolean
  /** 근거 텍스트와 정확히 같은 작성자 식별자가 몇 건 있었는가 */
  hits: number
  detail: string
}

export type ReferenceManifest = {
  sanitizerVersion: string
  /** 원본 자산의 digest (정제 전) */
  sourceDigest: string
  /** 정제 후 코퍼스의 digest */
  sanitizedCorpusDigest: string
  /** 정제 후 댓글 수 */
  commentCount: number
  /** Persona 묶음 전체의 digest */
  personaBundleDigest: string
  identityLeakCheck: IdentityLeakCheck
}

export type ManifestVerdict =
  | { ok: true; reason: string }
  | { ok: false; code: ManifestBlockCode; reason: string }

export type ManifestBlockCode =
  | 'MANIFEST_MISSING'
  | 'MANIFEST_FIELD_MISSING'
  | 'MANIFEST_SANITIZER_STALE'
  | 'MANIFEST_LEAK_CHECK_NOT_RUN'
  | 'MANIFEST_LEAK_FOUND'
  | 'MANIFEST_DIGEST_MISMATCH'
  | 'MANIFEST_VALUE_INVALID'

const REQUIRED_FIELDS: readonly (keyof ReferenceManifest)[] = [
  'sanitizerVersion', 'sourceDigest', 'sanitizedCorpusDigest',
  'commentCount', 'personaBundleDigest', 'identityLeakCheck',
]

/**
 * 🔴 **digest 는 정해진 모양이어야 한다** (2026-09-10, P0-3).
 *    앞선 판은 `typeof === 'string'` 만 봤다. 그러면 `''` 도 `'corp'` 도 통과한다 —
 *    "있다" 와 "맞다" 는 다르다. 16자 hex 로 못을 박는다.
 */
export const DIGEST_PATTERN = /^[0-9a-f]{16}$/

const isDigest = (v: unknown): boolean => typeof v === 'string' && DIGEST_PATTERN.test(v)
/** 🔴 양의 정수만. NaN · 소수 · 음수 · 0 을 전부 막는다 */
const isPositiveInt = (v: unknown): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const isZeroInt = (v: unknown): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v === 0

/**
 * 🔴 **manifest 가 없거나 어긋나면 승격하지 않는다.**
 *
 *    `expected` 를 주면 지금 자산으로 다시 낸 digest 와 대조한다 —
 *    회차가 저장된 뒤 자산이 바뀌었으면 그 회차의 근거는 더 이상 재현되지 않는다.
 */
export function judgeReferenceManifest(input: {
  manifest: unknown
  expected?: { sanitizedCorpusDigest?: string; personaBundleDigest?: string }
}): ManifestVerdict {
  const m = input.manifest
  if (m === null || typeof m !== 'object') {
    return {
      ok: false, code: 'MANIFEST_MISSING',
      reason: 'reference manifest 가 없다 — 무엇을 근거로 만든 회차인지 알 수 없다',
    }
  }
  const o = m as Partial<ReferenceManifest>
  const missing = REQUIRED_FIELDS.filter((k) => o[k] === undefined || o[k] === null)
  if (missing.length > 0) {
    return {
      ok: false, code: 'MANIFEST_FIELD_MISSING',
      reason: `manifest 항목이 빠졌다 — ${missing.join(' · ')}`,
    }
  }
  if (o.sanitizerVersion !== SANITIZER_VERSION) {
    return {
      ok: false, code: 'MANIFEST_SANITIZER_STALE',
      reason: `sanitizer 판이 다르다 — 회차 ${String(o.sanitizerVersion)} · 현재 ${SANITIZER_VERSION}`,
    }
  }
  // 🔴 값까지 본다 — 있다는 것과 맞다는 것은 다르다
  for (const [name, v] of [
    ['sourceDigest', o.sourceDigest],
    ['sanitizedCorpusDigest', o.sanitizedCorpusDigest],
    ['personaBundleDigest', o.personaBundleDigest],
  ] as const) {
    if (!isDigest(v)) {
      return {
        ok: false, code: 'MANIFEST_VALUE_INVALID',
        reason: `${name} 가 digest 모양이 아니다 — 16자 hex 여야 한다`,
      }
    }
  }
  if (!isPositiveInt(o.commentCount)) {
    return {
      ok: false, code: 'MANIFEST_VALUE_INVALID',
      reason: 'commentCount 가 양의 정수가 아니다',
    }
  }
  const leak = o.identityLeakCheck as Partial<IdentityLeakCheck>
  if (leak.ran !== true) {
    return {
      ok: false, code: 'MANIFEST_LEAK_CHECK_NOT_RUN',
      // 🔴 "돌지 않았다" 를 "깨끗하다" 로 세지 않는다
      reason: '식별자 유출 검사를 돌리지 않았다 — 돌지 않은 것을 통과로 보지 않는다',
    }
  }
  if (!isZeroInt(leak.hits)) {
    return {
      ok: false,
      code: isPositiveInt(leak.hits) ? 'MANIFEST_LEAK_FOUND' : 'MANIFEST_VALUE_INVALID',
      reason: isPositiveInt(leak.hits)
        ? `식별자 유출 ${String(leak.hits)}건 — ${String(leak.detail ?? '')}`
        : 'identityLeakCheck.hits 가 0 인 정수가 아니다',
    }
  }
  if (typeof leak.detail !== 'string' || leak.detail.trim() === '') {
    return {
      ok: false, code: 'MANIFEST_VALUE_INVALID',
      reason: 'identityLeakCheck.detail 이 비어 있다 — 무엇을 확인했는지 적혀 있어야 한다',
    }
  }
  const exp = input.expected
  if (exp?.sanitizedCorpusDigest !== undefined
    && exp.sanitizedCorpusDigest !== o.sanitizedCorpusDigest) {
    return {
      ok: false, code: 'MANIFEST_DIGEST_MISMATCH',
      reason: `코퍼스 digest 가 다르다 — 회차 ${String(o.sanitizedCorpusDigest)} · 지금 ${exp.sanitizedCorpusDigest}`,
    }
  }
  if (exp?.personaBundleDigest !== undefined
    && exp.personaBundleDigest !== o.personaBundleDigest) {
    return {
      ok: false, code: 'MANIFEST_DIGEST_MISMATCH',
      reason: `묶음 digest 가 다르다 — 회차 ${String(o.personaBundleDigest)} · 지금 ${exp.personaBundleDigest}`,
    }
  }
  return { ok: true, reason: `manifest 확인 — ${o.commentCount}건 · sanitizer ${SANITIZER_VERSION}` }
}

export function judgeRunUsable(input: {
  runId: string
  manifest?: unknown
  expected?: { sanitizedCorpusDigest?: string; personaBundleDigest?: string }
}): { usable: boolean; code: string; reason: string } {
  const bad = findInvalidation(input.runId)
  if (bad !== null) {
    return {
      usable: false,
      code: bad.reason,
      reason: `🔴 ${input.runId} 는 영구 무효다 — ${bad.disclosure} · ${bad.detail}`,
    }
  }
  const mv = judgeReferenceManifest({ manifest: input.manifest, expected: input.expected })
  if (!mv.ok) return { usable: false, code: mv.code, reason: mv.reason }
  return { usable: true, code: 'OK', reason: mv.reason }
}
