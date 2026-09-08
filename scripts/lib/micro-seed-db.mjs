#!/usr/bin/env node
/**
 * Micro Seed DB 주입 — 원장에서 게이트 입력을 도출한다
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §6-8 (R9 · R11) · §6-9-A · §10-1 · §10-5
 *
 * 이 파일이 답하는 질문은 하나다.
 *
 *   "Sheet 17열에 없는 값을 DB 원장에서 어떻게 가져오는가?"
 *
 * Sheet 는 창업자 승인 UI 이고 DB 가 진실의 원장이다(정책 16). 발행 이력·원장 dedupKey·
 * 원문 본문은 Sheet 에 없거나 있어도 신뢰할 수 없으므로 여기서 도출해 주입한다.
 *
 * 🔴 이 파일은 DB 에 쓰지 않는다
 *    조회만 한다. write · upsert · delete 가 없다. 발행은 publisher(PR-C2)의 일이다.
 *
 * 🔴 3상태를 무너뜨리지 않는다 (§6-8)
 *      undefined = 조회하지 않았다 → 검사하지 않는다. "위반 없음" 이 아니다
 *      null      = DB 에 행이 없다 (신규 후보) → 정상
 *      값        = 원장 실측값 → 대조한다
 *    셋을 뭉뚱그리면 "조회에 실패했는데 통과" 가 된다. 그래서 조회 실패는
 *    빈 결과가 아니라 **throw** 다 — 빈 결과를 돌려주면 모든 게이트가 조용히 꺼진다.
 *
 * 🔴 tsx 를 쓰지 않는다
 *    Prisma 는 동적 import 로 가져온다(scripts/magazine-dashboard.mjs 선례).
 *    src/lib/*.ts 를 import 하지 않으므로 CI(Node 20)에서도 그대로 돈다.
 *    ⚠️ 그래서 contentGuard 는 여기서 만들지 않는다 — checkContent() 는 .ts 다.
 *       미주입으로 두고 reader 가 NOT_INJECTED 로 알린다 (PR-C2 전 별도 PR).
 */

/** 후보가 터미널 상태인지 — retentionUntil 산정 기준 (§10-3). 판정에는 쓰지 않는다 */
export const TERMINAL_STATUSES = ['PUBLISHED', 'DECLINED', 'SKIPPED', 'FAILED', 'TAKEDOWN']

/**
 * 발행 가능한 원문 출처. §10-5 는 Micro Seed 에만 Raw 예외를 허용한다.
 *
 * 🔴 unao_legacy 는 직접 발행 금지다 (정책 12 · §10-1).
 *    §10-1 은 "문서 규칙으로만 두지 않고 후보 쿼리에서 **코드로 배제**" 하라고 요구한다.
 *    여기가 그 지점이다 — legacy 원문의 본문은 content 로 주입되지 않는다.
 */
export const PUBLISHABLE_ORIGINS = ['live']

// ─────────────────────────────────────────────────────────
// source 어댑터
// ─────────────────────────────────────────────────────────

/**
 * @typedef {object} CandidateRow
 * @property {string}  id
 * @property {string=} dedupKey
 * @property {string|null=} createdPostId
 * @property {{ origin: string, rawBody: string }|null=} rawContent
 * @property {boolean=} hasPublishedHistory  history 에 toStatus='PUBLISHED' 가 있는가
 *
 * @typedef {{ describe(): string, fetchCandidates(ids: string[]): Promise<CandidateRow[]> }} CandidateSource
 */

/** fixture source — 네트워크·DB 없음. PR-C1 의 검증은 전부 이걸로 돈다 */
export function createFixtureCandidateSource(rows = []) {
  return {
    describe: () => 'fixture (DB 접속 없음)',
    async fetchCandidates(ids) {
      const wanted = new Set(ids)
      return rows.filter((r) => wanted.has(r.id))
    },
  }
}

/**
 * Prisma source — 실제 원장 조회.
 *
 * 🔴 조회 전용이다. select 만 하고 write 를 하지 않는다.
 * 🔴 호출자가 disconnect 를 책임진다 — 반환 객체의 disconnect() 를 finally 에서 부른다.
 *
 * ⚠️ PR-C1 은 이 source 를 기본으로 쓰지 않는다. plan 스크립트는 fixture 로만 돈다.
 *    실제 연결은 운영 경로(PR-C2 이후)에서 DATABASE_URL 이 있는 환경에서만 한다.
 */
export async function createPrismaCandidateSource() {
  // scripts/magazine-dashboard.mjs 와 같은 방식. tsx 없이 .mjs 에서 Prisma 를 쓴다.
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ log: ['error'] })

  return {
    describe: () => 'prisma (read-only)',

    /**
     * 후보 원장 조회.
     *
     * 🔴 rawBody 를 여기서 가져오지 않는다.
     *    Candidate 조회에서는 origin 만 보고, 본문은 origin='live' 인 것만 별도 쿼리로 받는다.
     *    §10-1 은 "후보 쿼리에서 코드로 배제" 하라고 요구한다 — 조회 후 거르는 것과
     *    애초에 가져오지 않는 것은 다르다. legacy 본문은 이 프로세스의 메모리에
     *    **들어오지 않는다.**
     *
     *    loadInjections 의 PUBLISHABLE_ORIGINS 방어는 그대로 둔다 (이중 방어).
     */
    async fetchCandidates(ids) {
      if (!ids.length) return []

      const rows = await prisma.microSeedCandidate.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          dedupKey: true,
          createdPostId: true,
          // origin 만. rawBody 는 아래에서 live 인 것만 가져온다.
          rawContent: { select: { id: true, origin: true } },
          // R9 는 "발행 이력이 있는가" 만 필요하다. 전체 이력을 끌어오지 않는다.
          history: { where: { toStatus: 'PUBLISHED' }, select: { id: true }, take: 1 },
        },
      })

      // 🔴 origin='live' 를 WHERE 에 넣는다. legacy 는 rawBody 가 조회되지 않는다.
      const liveRawIds = rows
        .filter((r) => r.rawContent && PUBLISHABLE_ORIGINS.includes(r.rawContent.origin))
        .map((r) => r.rawContent.id)

      const bodies = liveRawIds.length
        ? await prisma.microSeedRawContent.findMany({
            where: { id: { in: liveRawIds }, origin: { in: [...PUBLISHABLE_ORIGINS] } },
            select: { id: true, rawBody: true },
          })
        : []
      const bodyById = new Map(bodies.map((b) => [b.id, b.rawBody]))

      return rows.map((r) => ({
        id: r.id,
        dedupKey: r.dedupKey,
        createdPostId: r.createdPostId,
        // origin 은 그대로 넘긴다 — loadInjections 가 2차로 판정하고 진단을 남긴다.
        // legacy 면 rawBody 가 undefined 라 본문이 없다.
        rawContent: r.rawContent
          ? { origin: r.rawContent.origin, rawBody: bodyById.get(r.rawContent.id) }
          : null,
        hasPublishedHistory: r.history.length > 0,
      }))
    },

    /**
     * 시스템 작성자 실측 (§5-2A · §6-9-E).
     *
     * 🔴 `_count.accounts` 와 `providerId` 를 **둘 다** select 한다. 빠뜨리면 undefined 가 되고
     *    verifyPublishAuthor 가 "실측하지 못했다" 로 중단시킨다 — 그게 맞는 동작이다.
     *
     * 🔴 실회원 판별 **정본은 `Account`** 다 (2026-09-08). `User.providerId` 는
     *    NextAuth adapter 가 채우지 않는다 (`src/lib/auth.ts` §signIn).
     *    실측: User 9명 전원 providerId=null 인데 Account 3건이었다 —
     *    providerId 만 보는 가드는 한 번도 발동한 적이 없었다.
     */
    async fetchAuthor(id) {
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, providerId: true, isBlocked: true, _count: { select: { accounts: true } } },
      })
      return {
        id,
        exists: user !== null,
        providerId: user ? user.providerId : null,
        // 🔴 User 를 못 찾으면 null 이고 verifyPublishAuthor 가 fail-closed 로 막는다.
        //    0 으로 눙치면 "없는 계정" 이 실회원 검사를 통과한 것처럼 된다
        accountCount: user ? user._count.accounts : null,
        isBlocked: user ? user.isBlocked : false,
      }
    },

    /**
     * cap 실측 (§6-5 · §6-9-F).
     *
     * 🔴 안 넘기면 validateBatch 가 `?? false` · `?? 0` 으로 떨어져 cap 이 조용히 열린다.
     *    그래서 여기서 세고, requireCapContext 가 그 값이 실측된 것인지 확인한다.
     *
     * publishedToday 는 History 의 PUBLISHED 전이를 KST 오늘 기준으로 센다 —
     * 후보 테이블의 status 를 세면 오늘 발행 후 TAKEDOWN 된 건이 빠진다.
     */
    async measureCapContext(now = new Date()) {
      // KST 오늘 0시 = UTC 로 전날 15:00
      const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
      const startOfKstDay = Date.UTC(
        kstNow.getUTCFullYear(),
        kstNow.getUTCMonth(),
        kstNow.getUTCDate(),
      ) - 9 * 60 * 60 * 1000

      const [publishedCount, todayCount] = await Promise.all([
        prisma.microSeedCandidate.count({ where: { status: 'PUBLISHED' } }),
        prisma.microSeedCandidateHistory.count({
          where: { toStatus: 'PUBLISHED', at: { gte: new Date(startOfKstDay) } },
        }),
      ])

      return { isFirstRun: publishedCount === 0, publishedToday: todayCount }
    },

    async disconnect() {
      await prisma.$disconnect().catch(() => {})
    },
  }
}

// ─────────────────────────────────────────────────────────
// 주입 도출
// ─────────────────────────────────────────────────────────

/**
 * 후보 id 목록 → validator 주입값.
 *
 * 반환 injectionsBy 는 reader 의 readCandidates({ injectionsBy }) 에 그대로 넘긴다.
 *
 * @param ids     Sheet 에서 읽은 candidateId 목록
 * @param source  CandidateSource
 * @returns {Promise<{ injectionsBy: object, diagnostics: object[] }>}
 */
export async function loadInjections(ids, source) {
  if (!source || typeof source.fetchCandidates !== 'function') {
    throw new Error('loadInjections: CandidateSource 가 필요하다. 조회 없이 주입할 수 없다.')
  }

  const uniqueIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.trim()))]

  // 🔴 조회 실패를 빈 결과로 삼키지 않는다.
  //    삼키면 모든 후보가 "주입 없음" 이 되고 R9·R11·G-A 가 한꺼번에 조용히 꺼진다.
  //    부르는 쪽이 실패를 알아야 한다.
  let rows
  try {
    rows = await source.fetchCandidates(uniqueIds)
  } catch (e) {
    throw new Error(`loadInjections: 원장 조회 실패 — ${e.message}`)
  }

  const byId = new Map(rows.map((r) => [r.id, r]))
  const injectionsBy = {}
  const diagnostics = []

  for (const id of uniqueIds) {
    const row = byId.get(id)

    // ── DB 에 행이 없다 = 신규 후보 ──────────────────────
    // dbDedupKey null 은 "대조할 원장값이 없다" 는 뜻이고 R11 은 통과시킨다.
    // hasEverPublished false 는 단정해도 된다 — DB 가 원장이므로 행이 없으면 발행된 적 없다.
    // content 는 지어내지 않는다. undefined 로 두면 G-A 가 "검사하지 않음" 으로 남는다.
    if (!row) {
      injectionsBy[id] = { dbDedupKey: null, hasEverPublished: false }
      diagnostics.push({
        kind: 'NOT_IN_LEDGER',
        candidateId: id,
        message: '원장에 없는 후보다 (신규). dbDedupKey=null · hasEverPublished=false',
      })
      continue
    }

    const injections = {}

    // ── R11 — 원장 dedupKey ─────────────────────────────
    injections.dbDedupKey = typeof row.dedupKey === 'string' ? row.dedupKey : null

    // ── R9 — 발행 이력 ──────────────────────────────────
    // 🔴 OR 인 이유: §5-4 사고 경로(DB 발행 성공 → Sheet 갱신 실패)에서 한쪽만 남을 수 있다.
    //    한쪽만 보면 그 경로에서 R9 가 꺼진다.
    const byPost = row.createdPostId != null
    const byHistory = row.hasPublishedHistory === true
    injections.hasEverPublished = byPost || byHistory

    if (byPost !== byHistory) {
      // 둘이 어긋나는 것 자체가 §5-4 가 경고한 상태다. 판정은 OR 로 이미 안전하지만
      // 사람이 볼 수 있게 남긴다.
      diagnostics.push({
        kind: 'PUBLISH_TRACE_MISMATCH',
        candidateId: id,
        message: `발행 흔적 불일치 — createdPostId=${byPost} · history=${byHistory}. OR 로 발행 이력 있음으로 판정한다`,
      })
    }

    // ── G-A — 본문 ──────────────────────────────────────
    const raw = row.rawContent
    if (!raw) {
      diagnostics.push({
        kind: 'NO_RAW_CONTENT',
        candidateId: id,
        message: '원문이 연결되지 않았다. content 를 주입하지 않는다 (G-A 는 판정하지 않음)',
      })
    } else if (!PUBLISHABLE_ORIGINS.includes(raw.origin)) {
      // 🔴 §10-1 · 정책 12 — legacy 는 학습 자산이지 발행 소스가 아니다.
      //    본문을 주입하지 않는 것으로 코드에서 배제한다.
      diagnostics.push({
        kind: 'LEGACY_EXCLUDED',
        candidateId: id,
        message: `origin='${raw.origin}' 은 직접 발행 금지다 (정책 12 · §10-1). content 를 주입하지 않는다`,
      })
    } else {
      injections.content = raw.rawBody
    }

    // 🚫 contentGuard 는 주입하지 않는다 (PR-C1 범위 밖).
    //    checkContent() 는 src/lib/content-guard.ts 이고 이 파일은 .ts 를 import 하지 않는다.
    //    reader 가 NOT_INJECTED 로 알린다 — 비어 있는 것은 "위반 없음" 이 아니라 "검사하지 않음" 이다.

    injectionsBy[id] = injections
  }

  return { injectionsBy, diagnostics }
}
