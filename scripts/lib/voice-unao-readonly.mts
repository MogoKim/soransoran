/**
 * 우나어 legacy DB — read-only 커넥터 (VE-R1)
 *
 * 정본: docs/operations/2026-08-27-voice-engine-schema-strategy.md §1 · §5
 *       docs/operations/2026-08-27-voice-engine-legacy-data-strategy.md
 *
 * 이 파일이 답하는 질문은 하나다.
 *
 *   "우나어 원문 33,031건과 댓글 154,872개를 어떻게 안전하게 읽는가?"
 *
 * 🔴 이 파일은 아무것도 쓰지 않는다
 *    SELECT 만 한다. INSERT · UPDATE · DELETE · DDL 이 없다.
 *    안전은 세 겹으로 보장된다:
 *      ① role 권한   unao_voice_readonly 는 4테이블에 SELECT 만 갖는다
 *      ② 트랜잭션    default_transaction_read_only = on
 *      ③ 이 코드     SELECT 이외의 SQL 을 만들지 않는다 (fixture 가 잠근다)
 *    ①②는 DB 가 지키고 ③은 우리가 지킨다. 셋 중 하나가 뚫려도 나머지가 막는다.
 *
 * 🔴 소란소란 DB 에 연결하지 않는다
 *    UNAO_READONLY_DATABASE_URL 만 쓴다. DATABASE_URL · DIRECT_URL 을 참조하지 않는다 —
 *    한 파일에서 두 DB 를 다루면 실수로 반대쪽에 쓰는 순간이 온다.
 *
 * 🔴 원문을 로그로 흘리지 않는다
 *    반환 객체에는 본문이 들어갈 수 있다(해시 계산에 필요하다).
 *    그러나 이 파일은 본문을 console 에 찍지 않는다 —
 *    터미널 기록과 CI 로그는 우리가 통제하지 못하는 곳으로 남는다.
 */
import { createHash } from 'node:crypto'

import { authorHashV2Of, type AuthorHashKey } from './voice-author-hash.mjs'
import { readFileSync, existsSync } from 'node:fs'

/** 🔴 이 커넥터가 쓰는 유일한 환경변수 */
export const UNAO_READONLY_URL_ENV = 'UNAO_READONLY_DATABASE_URL'

/** role 이 SELECT 권한을 가진 테이블. 이 밖은 조회하지 않는다 */
export const UNAO_READABLE_TABLES = ['CafePost', 'Post', 'Comment', 'Like'] as const

/**
 * `usedAt` 을 어떻게 읽는가 — 🔴 계약이다.
 *
 * 우나어 `CafePost.usedAt` 6,494건 중 실제 발행으로 이어진 것은 13건(0.2%)뿐이고,
 * 스키마 주석도 "큐레이션 참조 시각" 이다.
 * `approved` 로 넣으면 "사람이 승인했다" 는 거짓 정답지가 만들어진다.
 */
export const USED_AT_DECISION = 'referenced' as const

/** 🔴 원문 컬럼 이름들. VoiceSource 에 이런 필드를 만들지 않는다 */
export const FORBIDDEN_VOICE_SOURCE_COLUMNS = ['content', 'body', 'rawBody', 'rawComments', 'topComments'] as const

/**
 * connection string 을 로그에 안전한 형태로 줄인다.
 *
 * 🔴 비밀번호는 어떤 형태로도 남기지 않는다. 길이조차 흘리지 않는다.
 */
export function maskConnectionString(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.hostname.length > 20
      ? `${u.hostname.slice(0, 10)}****${u.hostname.slice(-14)}`
      : `${u.hostname.slice(0, 4)}****`
    const user = u.username.length > 12 ? `${u.username.slice(0, 12)}****` : u.username
    return `${u.protocol}//${user}:****@${host}:${u.port}${u.pathname}`
  } catch {
    return '(파싱 불가 — 마스킹된 상태로 둔다)'
  }
}

/**
 * `.env.local` 에서 read-only URL 을 읽는다.
 *
 * 🔴 없으면 즉시 실패한다. 기본값도 폴백도 두지 않는다 —
 *    폴백이 있으면 "어느 DB 에 붙었는지" 를 알 수 없게 된다.
 */
export function loadUnaoReadonlyUrl(envPath = '.env.local'): string {
  let url = process.env[UNAO_READONLY_URL_ENV] ?? ''
  if (!url && existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(new RegExp(`^\\s*${UNAO_READONLY_URL_ENV}\\s*=\\s*(.*)\\s*$`))
      if (m) url = m[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  if (!url) {
    throw new Error(
      `${UNAO_READONLY_URL_ENV} 가 없다. 우나어 legacy DB 는 read-only 전용 role 로만 읽는다.\n` +
        '  소란소란 DATABASE_URL 로 대신 붙지 않는다 — 그건 write 권한을 가진 다른 DB 다.',
    )
  }
  return url
}

/** 원문 스냅샷 — 🔴 본문 자체가 아니라 "그때 그 본문이었다" 의 증거 */
export function contentHashOf(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

/**
 * 닉네임은 단방향 해시로만 다룬다. 우나어 닉네임은 3~7자라 원문을 두면 특정된다.
 * 🔴 (2026-10-01 author-hash v2) 계산은 정본 `authorHashV2Of` 하나다 — 여기서 salt 로 따로 해시하지 않는다.
 */
export function authorHashOf(author: string, key: AuthorHashKey): string {
  return authorHashV2Of(author, key)
}

/**
 * VoiceSource 한 행이 될 값. 🔴 본문 · 댓글 원문이 없다.
 *
 * 원문은 우나어 DB 에 남고 여기에는 참조와 증거만 온다(schema-strategy §1).
 */
export type UnaoSourceRow = {
  /** 'unao_cafe' 고정 — VoiceSource.origin */
  origin: 'unao_cafe'
  /** CafePost.id — 🔴 FK 가 아니라 문자열 참조다 */
  sourceRef: string
  sourceSite: string
  sourceUrl: string
  sourceBoardName: string | null
  authorHash: string | null
  postedAt: Date | null
  capturedAt: Date
  contentHash: string | null
  contentLength: number | null
  commentCount: number | null
  /** 우나어가 이미 매긴 라벨. 재계산 비용 0 — 🔴 원문을 물고 온 키는 걸러진 뒤다 */
  legacyLabels: Record<string, unknown> | null
  legacyLabelVersion: string | null
  /**
   * 원문 누출로 버려진 라벨 **키 이름**. 🔴 값은 담기지 않는다.
   * VoiceSource 컬럼이 아니라 보고용이다 — 무엇이 걸러졌는지 사람이 보라고 남긴다.
   */
  droppedLabelKeys: string[]
  /** 🔴 usedAt 이 있으면 referenced 판단이 따라온다. approved 가 아니다 */
  referencedAt: Date | null
}

/** 로그에 찍어도 안전한 요약 — 🔴 본문 · 댓글 · 닉네임이 없다 */
export type UnaoSourceSummary = {
  sourceRef: string
  contentLength: number | null
  commentCount: number | null
  topCommentsCount: number
  hasLegacyLabels: boolean
  /** 🔴 원문 누출로 버려진 라벨 키 이름 (값 아님) */
  droppedLabelKeys: string[]
  referenced: boolean
}

export function summarize(row: UnaoSourceRow, topCommentsCount: number): UnaoSourceSummary {
  return {
    sourceRef: row.sourceRef,
    contentLength: row.contentLength,
    commentCount: row.commentCount,
    topCommentsCount,
    hasLegacyLabels: row.legacyLabels !== null && Object.keys(row.legacyLabels).length > 0,
    droppedLabelKeys: row.droppedLabelKeys,
    referenced: row.referencedAt !== null,
  }
}

/**
 * 우나어가 매긴 라벨을 그대로 담는다.
 *
 * 🔴 필드로 펼치지 않는다 — 우나어 스키마에 종속되면 그쪽이 바뀔 때 같이 깨진다.
 * ⚠️ `sentiment`(0%) 와 `topics`(1건)는 사실상 비어 있어 재계산 대상이다.
 */
export const LEGACY_LABEL_KEYS = [
  'desireCategory', 'desireType', 'psychInsight', 'urgencyLevel', 'communitySignal',
  'ageSignal', 'emotionTags', 'viralType', 'conflictTrigger', 'betrayalFactor',
  'emotionalPeak', 'commentSplit', 'qualityScore', 'killerScore',
] as const

export const LEGACY_LABEL_VERSION = 'unao-psych-analyzer-v2'

/**
 * 🔴 legacyLabels 경유 원문 누출 가드 (VE-R3.1)
 *
 * 100건 적재 검증에서 실제로 나온 문제다.
 * VoiceSource 는 `content` 를 저장하지 않는데, **라벨을 통해 원문이 새어 들어왔다** —
 * 우나어 psych 분석이 만든 `emotionalPeak` 39자 중 30자가 본문과 그대로 일치했다
 * (111건 중 1건, 원문 617자의 4.9%).
 *
 * 우리가 본문을 옮기지 않아도 **우나어가 만든 파생물이 본문을 물고 온다.**
 * 9,674건으로 늘리면 같은 비율로 수십 건이 쌓인다. 그래서 변환 시점에 끊는다.
 *
 * 🔴 키 이름 목록으로 잡지 않는다
 *    아래 KNOWN 목록은 **문서용**이고 판정 기준이 아니다.
 *    이름으로 잡으면 (a) 우나어가 새 라벨을 추가할 때 놓치고
 *    (b) `commentSplit` 처럼 이름만 원문스러운 숫자형을 잘못 버린다.
 *    실제로 이 프로젝트에서 `commentSplit` 은 `comments` 로 두 번 오인됐다.
 *    판정은 **값의 타입과 길이**로 한다 — 20자 이상 문자열만 검사 대상이다.
 *    숫자 · 불리언 · 짧은 분류값(`ageSignal` 3자 · `desireCategory` 9자)은 자동으로 빠진다.
 */
export const KNOWN_FREE_TEXT_LABEL_KEYS = [
  'psychInsight', 'emotionalPeak', 'betrayalFactor', 'conflictTrigger',
] as const

/**
 * 몇 자가 연속으로 겹치면 "원문을 물고 왔다" 로 보는가.
 *
 * 🔴 20자다. 한국어 20자면 한 문장에 가깝다 — 우연히 겹칠 길이가 아니다.
 *    실측 사례는 30자였고, 정상 라벨은 분석자가 쓴 요약이라
 *    본문과 20자씩 연속으로 겹치지 않는다(179개 중 178개가 그랬다).
 */
export const LEAK_RUN_MIN = 20

/** 공백 차이로 검사를 피해 가지 못하게 한다 */
function normalizeForLeak(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * `value` 안에 `haystack` 과 `minRun` 자 이상 **연속으로** 겹치는 구간이 있는가.
 *
 * 🔴 부분 일치가 아니라 연속 일치를 본다.
 *    낱말이 겹치는 것은 당연하다 — 같은 글을 요약했으니까.
 *    문제는 문장이 통째로 넘어오는 경우다.
 */
export function hasLeakingRun(value: string, haystack: string, minRun = LEAK_RUN_MIN): boolean {
  const v = normalizeForLeak(value)
  const h = normalizeForLeak(haystack)
  if (v.length < minRun || h.length < minRun) return false
  for (let i = 0; i + minRun <= v.length; i += 1) {
    if (h.includes(v.slice(i, i + minRun))) return true
  }
  return false
}

/**
 * 이 값이 원문성 검사 대상인가.
 *
 * 🔴 타입으로 가른다. 이름을 보지 않는다.
 *    - 20자 이상 문자열        → 검사한다 (자유서술 라벨)
 *    - 20자 이상 문자열의 배열 → 원소를 검사한다
 *    - 그 밖(숫자 · 불리언 · 짧은 문자열) → 검사하지 않는다
 */
export function isFreeTextLabelValue(value: unknown, minRun = LEAK_RUN_MIN): boolean {
  if (typeof value === 'string') return normalizeForLeak(value).length >= minRun
  if (Array.isArray(value)) return value.some((v) => isFreeTextLabelValue(v, minRun))
  return false
}

/** 검사 대상 값이 원문 · 댓글을 물고 왔는가 */
function labelValueLeaks(value: unknown, haystack: string, minRun: number): boolean {
  if (typeof value === 'string') return hasLeakingRun(value, haystack, minRun)
  if (Array.isArray(value)) return value.some((v) => labelValueLeaks(v, haystack, minRun))
  return false
}

export type SanitizedLabels = {
  labels: Record<string, unknown> | null
  /** 🔴 버려진 **키 이름**만 남긴다. 버려진 값(= 원문 조각)은 어디에도 남기지 않는다 */
  dropped: string[]
}

/**
 * 원문을 물고 온 라벨만 골라 버린다.
 *
 * 🔴 **키 단위로 버린다.** legacyLabels 전체를 버리지 않는다 —
 *    한 키가 오염됐다고 `ageSignal` · `qualityScore` 까지 잃으면
 *    우나어가 이미 계산해 둔 자산(재계산 비용 0)이 통째로 사라진다.
 *    실측에서도 오염은 179개 값 중 1개였다.
 *
 * 🔴 버린 값은 반환하지 않는다. `dropped` 는 키 이름뿐이다 —
 *    "무엇이 새었는지" 를 보고하려다 그 원문 조각을 로그로 흘리면 본말이 뒤집힌다.
 */
export function sanitizeLegacyLabels(
  labels: Record<string, unknown> | null,
  sourceTexts: readonly string[],
  minRun = LEAK_RUN_MIN,
): SanitizedLabels {
  if (!labels || Object.keys(labels).length === 0) return { labels: null, dropped: [] }
  const haystack = sourceTexts.filter((t) => typeof t === 'string' && t.length > 0).join('\n')
  if (!haystack) return { labels, dropped: [] }

  const kept: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(labels)) {
    if (isFreeTextLabelValue(value, minRun) && labelValueLeaks(value, haystack, minRun)) {
      dropped.push(key)
      continue
    }
    kept[key] = value
  }
  return { labels: Object.keys(kept).length ? kept : null, dropped }
}

/**
 * `topComments` 를 검사용 문자열로 편다.
 *
 * 🔴 반환값은 **가드 안에서만 쓰고 버린다.** 저장하지도 로그로 찍지도 않는다.
 *    댓글 인용을 잡으려면 댓글 원문을 봐야 한다 —
 *    그래서 이 함수의 결과가 어디로 가는지가 중요하다(`toSourceRow` 안에서 끝난다).
 */
/**
 * 댓글을 **필드별로 분리해서** 돌려준다 — 학습 추출 · 리뷰 표시 전용.
 *
 * 🔴 `topCommentsToText()` 와 용도가 다르다. 그쪽을 고치지 않고 이 함수를 새로 둔 이유:
 *    - `topCommentsToText()` 는 **유출 대조용**이다. 객체의 모든 문자열을 이어붙여
 *      대조 범위를 넓게 잡는다. author 가 섞여도 무해하고 **오히려 안전하다**
 *      (실측: author 포함 시 대조 문자열이 8.8% 넓어진다 — 유출을 놓칠 위험이 준다).
 *    - 반면 **학습 추출**에서 author 가 섞이면 닉네임을 문체로 배운다.
 *      리뷰 화면이 `topCommentsToText()` 를 그대로 쓰는 바람에 닉네임이 댓글처럼 보였다.
 *      함수의 결함이 아니라 **용도를 잘못 재사용한 것**이었다.
 *
 * 🔴 구조는 실측으로 확인했다 (댓글 항목 154,872개 전수)
 *    author · content · replies · likeCount 네 키가 **100% 존재**하고 빈값이 없다.
 *    author 길이 중앙 5자(닉네임) · content 길이 중앙 36자(본문).
 *    likeCount 는 **전부 0** 이라 쓸 수 없다(수집되지 않았다).
 *    replies 는 author · content 만 가진 같은 구조다.
 */
export type ParsedComment = {
  /** 🔴 닉네임. **학습에 쓰지 않는다.** 리뷰 화면에서만 분리 표시한다 */
  author: string
  /** 댓글 본문. 반응 · 정서 참고 대상 */
  content: string
  /** 대댓글. 🔴 1차 voice/style 학습에서는 보류한다 */
  replies: Array<{ author: string; content: string }>
}

export function parseTopComments(raw: unknown): ParsedComment[] {
  if (!Array.isArray(raw)) return []
  const out: ParsedComment[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const replies: Array<{ author: string; content: string }> = []
    if (Array.isArray(o.replies)) {
      for (const r of o.replies) {
        if (r === null || typeof r !== 'object') continue
        const ro = r as Record<string, unknown>
        replies.push({ author: String(ro.author ?? ''), content: String(ro.content ?? '') })
      }
    }
    out.push({ author: String(o.author ?? ''), content: String(o.content ?? ''), replies })
  }
  return out
}

/**
 * 학습에 넣을 댓글 본문만 뽑는다.
 *
 * 🔴 **`parseTopComments()` 를 부르지 않는다.** 그쪽은 author · replies 를 파싱하므로,
 *    결과에서 빼더라도 **닉네임이 메모리에 물질화된다.**
 *    "학습 경로는 author 를 읽지 않는다" 를 결과가 아니라 **접근 수준에서** 지키려면
 *    raw 에서 `content` 키 하나만 직접 읽어야 한다.
 *
 * 🔴 읽지 않는 것 — `author` · `replies`(1차 보류 정책) · `likeCount`(전부 0이라 무의미).
 *    fixture 가 이 함수 본문에 그 이름들이 등장하는지, parseTopComments 를 부르는지 검사한다.
 */
export function commentBodiesForLearning(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    // 🔴 content 키 하나만 읽는다
    const body = (item as Record<string, unknown>).content
    if (typeof body === 'string' && body.trim() !== '') out.push(body)
  }
  return out
}

export function topCommentsToText(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') { out.push(item); continue }
    if (item && typeof item === 'object') {
      for (const v of Object.values(item as Record<string, unknown>)) {
        if (typeof v === 'string') out.push(v)
      }
    }
  }
  return out.join('\n')
}

/**
 * 🔴 고품질 코퍼스 조건 (VE-R3) — 실측 9,674건.
 *
 *    전체 33,031 → isUsable 25,970 → ageSignal 50s/60s 19,593
 *    → 150자+ 11,535 → aiAnalyzed 11,522 → 댓글 有 **9,674**
 *
 *    전체를 넣지 않는 이유: ageSignal 70s+ 와 광고성 글이 섞여 있고
 *    VoiceDerived 계산 대상이 3.4배로 늘어난다.
 *
 * 🔴 이것은 SQL 문이 아니라 **WHERE 조각**이다. READ_QUERIES 에 넣지 않는다 —
 *    그 상수는 "전부 SELECT 로 시작한다" 를 fixture 가 검사하는 자리이고,
 *    조각을 섞으면 그 검사가 무의미해진다. (실제로 fixture 가 잡았다)
 */
export const HIGH_QUALITY_WHERE = `
       "isUsable" = true
       AND "ageSignal" IN ('50s','60s')
       AND length(content) >= 150
       AND "aiAnalyzed" = true
       AND jsonb_typeof("topComments"::jsonb) = 'array'
       AND jsonb_array_length("topComments"::jsonb) > 0`

/**
 * 🔴 이 커넥터가 만드는 유일한 SQL 들. 전부 SELECT 다.
 *
 * fixture 가 이 상수를 읽어 SELECT 로만 시작하는지 검사한다.
 * 쿼리를 문자열로 조립하지 않고 여기 모아 두는 이유가 그것이다 —
 * 흩어져 있으면 "전부 SELECT 인가" 를 확인할 방법이 없다.
 */
export const READ_QUERIES = {
  ping: 'SELECT 1 AS ok',
  whoami: 'SELECT current_user AS usr, current_database() AS db',
  countCafePost: 'SELECT COUNT(*)::int AS n FROM "CafePost"',
  /** 고품질 후보 — schema-strategy §3-1 기준 */
  sampleOne: `
    SELECT id, "cafeId", "boardName", "postUrl", author, "postedAt", "crawledAt",
           content, "commentCount", "topComments", "usedAt",
           "desireCategory", "desireType", "psychInsight", "urgencyLevel",
           "communitySignal", "ageSignal", "emotionTags", "viralType",
           "conflictTrigger", "betrayalFactor", "emotionalPeak", "commentSplit",
           "qualityScore", "killerScore"
      FROM "CafePost"
     WHERE "isUsable" = true
       AND "ageSignal" IN ('50s','60s')
       AND length(content) >= 150
       AND "aiAnalyzed" = true
       AND jsonb_typeof("topComments"::jsonb) = 'array'
       AND jsonb_array_length("topComments"::jsonb) > 0
     ORDER BY "commentCount" DESC
     LIMIT 1`,
  /**
   * 🔴 sourceRef 목록으로 본문을 되찾는다 (2026-09-01).
   *
   * 왜 필요한가 — voice engine 산출물(voice-gold.jsonl 등)에는 **본문이 없다.**
   * 26키가 전부 신호이고 VoiceSource 도 해시·길이만 남긴다. 설계상 그렇다:
   * *"원문을 복제하지 않는다"*. 그래서 말투 샘플이 필요한 순간마다 **여기로 다시 읽으러 온다.**
   *
   * 🔴 조건을 다시 걸지 않는다. 선별은 voice-sample-select 가 사람 판정까지 반영해 끝냈다 —
   *    여기서 HIGH_QUALITY_WHERE 를 한 번 더 걸면 "왜 이 글이 빠졌나" 를 두 곳에서 찾게 된다.
   *
   * 🔴 읽어 온 본문은 프롬프트에만 쓰고 저장하지 않는다. 호출부의 책임이다.
   */
  /**
   * 🔴 작가 해시 v1 사슬 원본 대조 증명(2026-10-01 author-hash v2) — sourceRef(= CafePost.id) 표본의 작가명만 읽는다.
   *    읽은 작가명은 그 자리에서 해시 대조에만 쓰고 출력 · 저장하지 않는다(`voice-author-hash-legacy-proof`).
   */
  authorsByIds: `
    SELECT id, author
      FROM "CafePost"
     WHERE id = ANY($1)
     ORDER BY id ASC`,
  bodiesBySourceRefs: `
    SELECT id, content, "boardName", "commentCount"
      FROM "CafePost"
     WHERE id = ANY($1)
     ORDER BY id ASC`,
} as const

/** 배치 조회 — 🔴 `SELECT` 다. 커서는 id 오름차순으로 고정한다(재개 가능) */
export function buildBatchQuery(afterId: string | null, batchSize: number): { text: string; values: unknown[] } {
  const cursor = afterId ? 'AND id > $1' : ''
  return {
    text: `
      SELECT id, "cafeId", "boardName", "postUrl", author, "postedAt", "crawledAt",
             content, "commentCount", "topComments", "usedAt",
             "desireCategory", "desireType", "psychInsight", "urgencyLevel",
             "communitySignal", "ageSignal", "emotionTags", "viralType",
             "conflictTrigger", "betrayalFactor", "emotionalPeak", "commentSplit",
             "qualityScore", "killerScore"
        FROM "CafePost"
       WHERE ${HIGH_QUALITY_WHERE}
         ${cursor}
       ORDER BY id ASC
       LIMIT ${Math.max(1, Math.min(batchSize, MAX_BATCH_SIZE))}`,
    values: afterId ? [afterId] : [],
  }
}

/** 고품질 대상 총 건수 — dry-run 보고용 */
export const COUNT_HIGH_QUALITY = `SELECT COUNT(*)::int AS n FROM "CafePost" WHERE ${HIGH_QUALITY_WHERE}`
/** usedAt 이 있는 것 — referenced 예정 수 */
export const COUNT_HIGH_QUALITY_REFERENCED =
  `SELECT COUNT(*)::int AS n FROM "CafePost" WHERE ${HIGH_QUALITY_WHERE} AND "usedAt" IS NOT NULL`

/**
 * 한 번에 읽는 최대 건수.
 * 🔴 상한을 두는 이유: --batch=100000 같은 값으로 33,031건을 한 번에 끌어오면
 *    메모리에 본문 전체가 올라온다. 본문은 해시 계산 직후 버려야 한다.
 */
export const MAX_BATCH_SIZE = 500
export const DEFAULT_BATCH_SIZE = 100

/** CafePost 한 행 → VoiceSource 후보. 🔴 본문을 옮기지 않고 해시만 남긴다 */
export function toSourceRow(raw: Record<string, unknown>, authorKey: AuthorHashKey): UnaoSourceRow {
  const content = typeof raw.content === 'string' ? raw.content : ''
  const author = typeof raw.author === 'string' ? raw.author.trim() : ''
  const labels: Record<string, unknown> = {}
  for (const k of LEGACY_LABEL_KEYS) {
    if (raw[k] !== undefined && raw[k] !== null) labels[k] = raw[k]
  }
  // 🔴 라벨이 원문 · 댓글을 물고 왔는지 여기서 끊는다 (VE-R3.1).
  //    본문과 댓글 원문은 이 검사에만 쓰이고 아래 반환값에는 들어가지 않는다.
  const { labels: safeLabels, dropped } = sanitizeLegacyLabels(
    Object.keys(labels).length ? labels : null,
    [content, topCommentsToText(raw.topComments)],
  )
  return {
    origin: 'unao_cafe',
    sourceRef: String(raw.id ?? ''),
    sourceSite: `navercafe:${String(raw.cafeId ?? '')}`,
    sourceUrl: String(raw.postUrl ?? ''),
    sourceBoardName: typeof raw.boardName === 'string' ? raw.boardName : null,
    authorHash: author ? authorHashOf(author, authorKey) : null,
    postedAt: raw.postedAt instanceof Date ? raw.postedAt : null,
    capturedAt: raw.crawledAt instanceof Date ? raw.crawledAt : new Date(0),
    contentHash: content ? contentHashOf(content) : null,
    contentLength: content ? content.length : null,
    commentCount: typeof raw.commentCount === 'number' ? raw.commentCount : null,
    legacyLabels: safeLabels,
    legacyLabelVersion: safeLabels ? LEGACY_LABEL_VERSION : null,
    droppedLabelKeys: dropped,
    referencedAt: raw.usedAt instanceof Date ? raw.usedAt : null,
  }
}

/** topComments 배열 길이만 센다. 🔴 댓글 본문을 반환하지 않는다 */
export function countTopComments(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0
}
