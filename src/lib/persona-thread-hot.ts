/**
 * **뜨거운 글 판독** — 🔴 순수 함수와 조회 모양 상수뿐. DB · 시계 · 네트워크 0 (2026-11-25 밤 4 · 판정서 §2.3)
 *
 * 원천에서 댓글이 많이 달린 글(같은 원천 · 같은 관측 구간 안 댓글 수 상대 위치가 문턱 이상)은 대화를 더 길게 계획한다
 * (`persona-thread-plan` 의 `threadPlanOf(…, hot)`). 이 파일은 "이 글이 뜨거운가" 하나만 판독한다.
 *
 * 🔴 **고객 번들에 들어가지 않는 파일이다.** 원천 판독기(`source-slot-release`)가 `node:crypto` 를 쓰므로
 *    고객·운영 화면이 읽는 목표 숫자 파일(`persona-thread-target` · import 0)에 두지 않았다.
 *    `import 'server-only'` 는 쓰지 않는다 — 댓글 러너는 `npx tsx` 로 돌고 그 표식 패키지를 풀지 못한다(러너가 import 에서 죽는다).
 *    대신 `persona-comment-followup-check` 가 `src/app` · `src/components` 의 어떤 파일도 이 파일을 import 하지 않는지 잰다.
 *
 * 🔴 **세 곳이 같은 조회 · 같은 판독을 쓴다** — 추가 댓글 러너(생성 판정) · 발행 트랜잭션(재판정) · 단계 증거(재기만).
 *    러너와 트랜잭션이 다르게 읽으면 트랜잭션이 보통 글 크기에서 STOP 해 이미 돈을 쓴 댓글이 닫힌다.
 */
import { readSourceEvidence } from './source-slot-release'
import { threadHotAt } from './persona-thread-target'

/**
 * 🔴 **조회 모양 — 그 글을 낸 원글 큐 행(공개됨)의 원천 증거.** 러너와 발행 트랜잭션이 이 두 상수로 같은 행을 읽는다.
 *    `createdPostId` 는 unique 라 글당 많아야 한 행이다. 큐 행이 없는 글(사람이 직접 쓴 Persona 글)은 뜨겁지 않다.
 */
export const HOT_QUEUE_SELECT = { createdPostId: true, gateResults: true } as const
export const hotQueueWhereOf = (postIds: readonly string[]) => ({ createdPostId: { in: [...postIds] }, status: 'PUBLISHED' as const })

/**
 * 🔴 **이 글이 뜨거운가.** 아래가 **전부** 맞을 때만 true 다. 하나라도 모르면 false(근거 없는 승격 0):
 *    · 공개 시각을 안다 · 그 시각에 효력이 있던 목표 줄에 `hot` 칸이 있다(옛 글 소급 0)
 *    · 원천 증거를 읽었다(`readSourceEvidence` ok) · 원천 통계가 있고 `commentsPct` 가 유한한 숫자다
 *    · `commentsPct ≥ commentsPctMin`
 *    🔴 조회 백분위(`viewsPct`)로 대신하지 않는다 — 공개 판정은 둘 중 하나만 있어도 통과하지만 뜨거움은 댓글만 본다.
 */
export function isHotThread(gateResults: unknown, publishedAtMs: number | null): boolean {
  if (publishedAtMs === null || !Number.isFinite(publishedAtMs)) return false
  const hot = threadHotAt(publishedAtMs)
  if (hot === null) return false
  const read = readSourceEvidence(gateResults)
  if (!read.ok || read.record.sourceStats === null) return false
  const pct = read.record.sourceStats.commentsPct
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= hot.commentsPctMin
}

/** 조회한 큐 행 → 글 id 별 원천 기록(gateResults). 같은 글에 행이 둘 이상이면(unique 가 깨진 모양) 그 글은 모름 → 뜨겁지 않다 */
export function hotSourceByPost(rows: readonly { createdPostId: string | null; gateResults: unknown }[]): ReadonlyMap<string, unknown> {
  const seen = new Map<string, unknown>()
  const dup = new Set<string>()
  for (const r of rows) {
    if (r.createdPostId === null) continue
    if (seen.has(r.createdPostId)) dup.add(r.createdPostId)
    seen.set(r.createdPostId, r.gateResults)
  }
  for (const id of dup) seen.set(id, null)
  return seen
}
