/**
 * 발행 **배치 진행** — 🔴 막힌 후보에서 회차가 끝나지 않게 한다
 *
 * 🔴 **왜 함수로 뺐나** (2026-09-09).
 *
 *    runner 는 `take: allowed` 로 딱 허용 수만큼만 읽고 그 자리에서 끝났다.
 *    허용이 1건일 때 맨 앞 후보가 막히면 뒤에 멀쩡한 것이 있어도 **0건 발행**이었고,
 *    다음 회차도 같은 후보를 맨 앞에서 다시 집으므로 사실상 영구히 막혔다.
 *
 *    그 진행 규칙을 스크립트 안에 두면 fixture 가 볼 수 없다. 그래서 함수다.
 *
 * 🔴 **무한 루프가 없다.** 배치는 유한하고, 한 후보는 한 번만 시도한다.
 */
export type BatchOutcome = 'published' | 'blocked' | 'error'

export type BatchResult<T> = {
  published: number
  blocked: number
  /** 실제로 시도한 수 — 🔴 허용치를 채우면 나머지는 시도하지 않는다 */
  attempted: number
  results: { item: T; outcome: BatchOutcome; detail: string }[]
  /** 배치를 다 보고도 허용치를 못 채웠는가 */
  shortOfAllowed: boolean
}

export async function publishBatch<T>(args: {
  /** 🔴 결정적으로 정렬된 유한 배치 */
  candidates: readonly T[]
  allowed: number
  publish: (item: T) => Promise<{ outcome: BatchOutcome; detail: string }>
}): Promise<BatchResult<T>> {
  const results: BatchResult<T>['results'] = []
  let published = 0
  let blocked = 0
  let attempted = 0

  for (const item of args.candidates) {
    // 🔴 **성공** 수로 센다. 시도 수로 세면 막힌 것이 자리를 먹는다
    if (published >= args.allowed) break
    attempted += 1
    const r = await args.publish(item)
    results.push({ item, outcome: r.outcome, detail: r.detail })
    if (r.outcome === 'published') published += 1
    else blocked += 1
  }

  return {
    published, blocked, attempted, results,
    // 🔴 못 채웠으면 사실대로 말한다. 배치를 늘려 다시 읽지 않는다
    shortOfAllowed: published < args.allowed,
  }
}

/** 🔴 배치 크기 — 허용치의 몇 배까지 볼 것인가. 상한이 있어야 한 회차가 끝난다 */
export const BATCH_MULTIPLIER = 5
export const BATCH_MAX = 25

export function batchSizeFor(allowed: number): number {
  return Math.max(1, Math.min(BATCH_MAX, allowed * BATCH_MULTIPLIER))
}
