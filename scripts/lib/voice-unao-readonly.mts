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

/** 닉네임은 단방향 해시로만 다룬다. 우나어 닉네임은 3~7자라 원문을 두면 특정된다 */
export function authorHashOf(author: string, salt: string): string {
  return `sha256:${createHash('sha256').update(`${salt}::${author}`, 'utf8').digest('hex')}`
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
  /** 우나어가 이미 매긴 라벨. 재계산 비용 0 */
  legacyLabels: Record<string, unknown> | null
  legacyLabelVersion: string | null
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
  referenced: boolean
}

export function summarize(row: UnaoSourceRow, topCommentsCount: number): UnaoSourceSummary {
  return {
    sourceRef: row.sourceRef,
    contentLength: row.contentLength,
    commentCount: row.commentCount,
    topCommentsCount,
    hasLegacyLabels: row.legacyLabels !== null && Object.keys(row.legacyLabels).length > 0,
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
export function toSourceRow(raw: Record<string, unknown>, authorSalt: string): UnaoSourceRow {
  const content = typeof raw.content === 'string' ? raw.content : ''
  const author = typeof raw.author === 'string' ? raw.author.trim() : ''
  const labels: Record<string, unknown> = {}
  for (const k of LEGACY_LABEL_KEYS) {
    if (raw[k] !== undefined && raw[k] !== null) labels[k] = raw[k]
  }
  return {
    origin: 'unao_cafe',
    sourceRef: String(raw.id ?? ''),
    sourceSite: `navercafe:${String(raw.cafeId ?? '')}`,
    sourceUrl: String(raw.postUrl ?? ''),
    sourceBoardName: typeof raw.boardName === 'string' ? raw.boardName : null,
    authorHash: author ? authorHashOf(author, authorSalt) : null,
    postedAt: raw.postedAt instanceof Date ? raw.postedAt : null,
    capturedAt: raw.crawledAt instanceof Date ? raw.crawledAt : new Date(0),
    contentHash: content ? contentHashOf(content) : null,
    contentLength: content ? content.length : null,
    commentCount: typeof raw.commentCount === 'number' ? raw.commentCount : null,
    legacyLabels: Object.keys(labels).length ? labels : null,
    legacyLabelVersion: Object.keys(labels).length ? LEGACY_LABEL_VERSION : null,
    referencedAt: raw.usedAt instanceof Date ? raw.usedAt : null,
  }
}

/** topComments 배열 길이만 센다. 🔴 댓글 본문을 반환하지 않는다 */
export function countTopComments(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0
}
