/**
 * 발행 결과 정합 — 🔴 **단일 정본** (§4-AK · §4-AW)
 *
 * `original-post-publish-live --check` 안에 인라인으로 있던 판단을 떼어냈다.
 * 관제(`supply:health`)가 같은 것을 다시 구현하면 **두 곳이 서로 다른 말을 하게 된다** —
 * 한쪽만 고쳐지는 날이 오고, 그날 사람은 어느 쪽을 믿을지 모른다.
 *
 * 🔴 순수 함수다. DB 를 읽지 않고 받은 것만 본다.
 */

/**
 * 🔴 **3축 플래그를 직접 다루지 않는다.**
 *
 * `isMicroSeed` · `permanentNoindex` · `indexPromotionBlocked` 를 이 파일이 직접 읽으면
 * 노출 규칙이 두 곳에 생긴다 — 정본이 바뀌어도 여기는 그대로 남는다.
 * CI 의 노출 게이트가 그것을 막는다(C-2 · C-4).
 * 그래서 **판정 결과만** 받는다: `post-visibility` 의 게이트 함수를 부른 쪽이 넘겨준다.
 */
export type PostFacts = {
  status: string
  source: string
  boardType: string
  personaId: string | null
  /** `isSearchIndexable(post)` 의 결과 */
  searchIndexable: boolean
  /** `isDiscoveryEligible(post)` 의 결과 — 승격·추천 write-path 차단을 포함한다 */
  discoveryEligible: boolean
  sourceUrl: string | null
  sourceArticleId: string | null
  sheetCandidateId: string | null
}

export type PublishedRowFacts = {
  queueId: string
  queueStatus: string
  createdPostId: string | null
  /** 큐가 배정한 persona */
  queuePersonaId: string | null
  /** 연결된 Post. 없으면 null */
  post: PostFacts | null
  /** `kind='post' · targetId=postId · personaId` 로 센 수 — 🔴 정확히 1이어야 한다 */
  activityLogCount: number
}

/**
 * 한 행의 문제 목록 — 🔴 비어 있으면 정합이다.
 *
 * 검사 순서는 "무엇이 먼저 무너지는가" 순이다.
 * 연결이 끊긴 행은 그 뒤 검사가 의미 없으므로 거기서 멈춘다.
 */
export function verifyPublishedRow(r: PublishedRowFacts): string[] {
  const problems: string[] = []

  // ① 연결 자체
  if (r.queueStatus === 'PUBLISHED' && (r.createdPostId === null || r.createdPostId === '')) {
    problems.push('PUBLISHED 인데 createdPostId 가 없다')
    return problems
  }
  if ((r.createdPostId !== null && r.createdPostId !== '') && r.queueStatus !== 'PUBLISHED') {
    // 🔴 발행됐는데 큐가 그렇게 말하지 않는다 — 다음 회차가 같은 글을 또 낼 수 있다
    problems.push(`createdPostId 가 있는데 status=${r.queueStatus}`)
  }
  if (r.createdPostId === null || r.createdPostId === '') return problems

  if (r.post === null) {
    problems.push('연결된 Post 가 없다')
    return problems
  }

  // ② Post 가 이 레인이 만든 모습인가
  const p = r.post
  if (p.status !== 'PUBLISHED') problems.push(`Post status=${p.status}`)
  if (p.source !== 'SYSTEM') problems.push(`Post source=${p.source}`)
  if (p.boardType !== 'FREE') problems.push(`Post boardType=${p.boardType}`)
  if (p.personaId !== r.queuePersonaId) problems.push('persona 불일치')

  // ③ 🔴 색인 대상인가 — 이 레인의 존재 이유다.
  //    판정은 post-visibility 정본이 한다. 여기서는 그 결과만 본다
  if (!p.searchIndexable) problems.push('🔴 색인 대상이 아니다 (isSearchIndexable=false)')
  if (!p.discoveryEligible) problems.push('🔴 추천 표면에 오르지 못한다 (isDiscoveryEligible=false)')

  // ④ 🔴 출처가 붙지 않았는가 — 붙으면 남의 글 흔적이 우리 글에 남는다
  if (p.sourceUrl !== null) problems.push('🔴 sourceUrl 이 붙었다')
  if (p.sourceArticleId !== null) problems.push('🔴 sourceArticleId 가 붙었다')
  if (p.sheetCandidateId !== null) problems.push('🔴 sheetCandidateId 가 붙었다')

  // ⑤ 활동 기록 — 🔴 0 이면 페르소나가 쓴 적 없는 글이고, 2 면 두 번 센 것이다
  if (r.activityLogCount !== 1) problems.push(`ActivityLog ${r.activityLogCount}건 (1이어야 한다)`)

  return problems
}

/**
 * 🔴 **사람이 내린 글이 남기는 결과** (2026-09-21).
 *    Post 를 숨기면 status 와 색인·추천 플래그가 **따라서** 바뀐다.
 *    그 셋은 숨김의 **파생 결과**이지 연결 오류가 아니다.
 */
const TAKEDOWN_DERIVED = ['Post status=', '색인 대상이 아니다', '추천 표면에 오르지 못한다']

/** 🔴 이 행이 "사람이 내린 글" 인가 — Post 는 있고 상태만 숨김이다 */
function isTakenDown(r: PublishedRowFacts): boolean {
  return r.post !== null && (r.post.status === 'HIDDEN' || r.post.status === 'DELETED')
}

/**
 * 여러 행을 한 번에 — 🔴 **연결이 깨진 행과 사람이 내린 행을 가른다** (2026-09-21 실측 보정).
 *
 *    앞판은 둘을 모두 `bad` 로 넣었고 health 가 `PUBLISH_MISMATCH` CRITICAL 로 올렸다.
 *    실측 1건(`cmu0ov5b3…` → Post `cmu0sjyll…` HIDDEN)은 **운영 판단으로 내린 글**이었다 —
 *    `permanentNoindex` 도 `indexPromotionBlocked` 도 false 였다(콘텐츠 결함 표식이 아니다).
 *    그것을 데이터 손상처럼 부르면 **진짜 손상이 묻힌다.**
 *
 * 🔴 **경고를 숨기는 것이 아니다.** 내린 글은 `takenDown` 으로 계속 보고되고,
 *    숨김 때문이 아닌 문제가 하나라도 남아 있으면 그 행은 여전히 `bad` 다.
 */
export function verifyPublishedRows(rows: readonly PublishedRowFacts[]): {
  ok: boolean
  bad: { queueId: string; problems: string[] }[]
  takenDown: { queueId: string; problems: string[] }[]
} {
  const bad: { queueId: string; problems: string[] }[] = []
  const takenDown: { queueId: string; problems: string[] }[] = []
  for (const r of rows) {
    const problems = verifyPublishedRow(r)
    if (problems.length === 0) continue
    if (isTakenDown(r)) {
      // 🔴 숨김의 파생 결과를 걷어 내고 **남는 것**을 본다
      const rest = problems.filter((p) => !TAKEDOWN_DERIVED.some((d) => p.includes(d)))
      if (rest.length === 0) { takenDown.push({ queueId: r.queueId, problems }); continue }
      bad.push({ queueId: r.queueId, problems: rest })
      continue
    }
    bad.push({ queueId: r.queueId, problems })
  }
  return { ok: bad.length === 0, bad, takenDown }
}
