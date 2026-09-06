/**
 * 대기열 exact id 타깃팅 — 🔴 **지정한 것 외에는 손대지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AK
 *
 * 🔴 **왜 필요한가.** `match-assign` 과 `publish-live` 는 배치다 —
 *    조건에 맞는 것을 전부 모아 `--limit` 만큼 처리한다.
 *    그래서 **"이 글만"** 이 안 된다. 2026-09-06 에 그 때문에 멈췄다:
 *    발행하려는 글 하나를 위해 **내용을 모르는 글 두 개가 같이 대상에 들어왔다.**
 *
 * 🔴 **`--limit` 만으로는 못 고른다.** 정렬 순서에 걸린 것부터 잘리기 때문이다.
 *    잘라내는 것과 고르는 것은 다르다.
 *
 * 🔴 **기존 배치 동작을 바꾸지 않는다.** `--id` 가 하나도 없으면 지금까지와 똑같이 돈다.
 */

/** `--id=<cuid>` 와 `--id <cuid>` 를 모두 받는다 */
export function parseIdArgs(argv: readonly string[]): string[] {
  const out: string[] = []
  for (const [i, a] of argv.entries()) {
    if (a.startsWith('--id=')) {
      const v = a.slice(5).trim()
      if (v !== '') out.push(v)
      continue
    }
    if (a === '--id') {
      const v = (argv[i + 1] ?? '').trim()
      // 🔴 다음 토큰이 또 다른 플래그면 값이 아니다
      if (v !== '' && !v.startsWith('--')) out.push(v)
    }
  }
  // 🔴 중복은 한 번만 — 같은 id 를 두 번 적었다고 두 번 처리하지 않는다
  return [...new Set(out)]
}

/**
 * 지정한 id 만 남긴다 — 🔴 **id 가 없으면 원본을 그대로 돌려준다**(기존 배치 동작).
 *
 * 🔴 순서를 바꾸지 않는다. 호출부의 정렬(`createdAt asc` · `gateVerdict asc` 등)이
 *    dry-run 재현성의 근거이므로, 여기서 재정렬하면 그 보장이 깨진다.
 */
export function filterByIds<T extends { id: string }>(
  rows: readonly T[], ids: readonly string[],
): T[] {
  if (ids.length === 0) return [...rows]
  const want = new Set(ids)
  return rows.filter((r) => want.has(r.id))
}

/** 지정했는데 대상에 없던 id — 조용히 넘어가면 "왜 안 됐지" 를 알 수 없다 */
export function missingIds<T extends { id: string }>(
  rows: readonly T[], ids: readonly string[],
): string[] {
  if (ids.length === 0) return []
  const have = new Set(rows.map((r) => r.id))
  return ids.filter((i) => !have.has(i))
}

export type LimitCheck = { ok: true } | { ok: false; message: string }

/**
 * `--limit` 이 맞는지 본다 — 🔴 **id 를 줬으면 개수가 정확히 같아야 한다.**
 *
 * 배치에서는 `--limit` 이 "이만큼만 처리한다" 는 뜻이지만,
 * id 를 지정한 순간 그 뜻이 달라진다 — **"내가 무엇을 하는지 정확히 안다"** 는 확인이다.
 * 하나라도 어긋나면 멈춘다. 잘라내지 않는다.
 */
export function checkLimitAgainstIds(
  limit: number | null, ids: readonly string[], targetCount: number,
): LimitCheck {
  if (ids.length === 0) return { ok: true }
  if (limit === null || !Number.isInteger(limit)) {
    return { ok: false, message: `--id 를 줄 때는 --limit=${ids.length} 도 함께 있어야 합니다` }
  }
  if (limit !== ids.length) {
    return { ok: false, message: `--limit ${limit} 이 --id 개수 ${ids.length} 와 다릅니다` }
  }
  if (targetCount !== ids.length) {
    return {
      ok: false,
      message: `--id ${ids.length}건 중 처리 가능한 것이 ${targetCount}건입니다.`
        + ' 잘라내지 않고 멈춥니다 — 무엇이 빠졌는지 위 목록을 보세요',
    }
  }
  return { ok: true }
}

/** 화면에 쓰는 한 줄 */
export function describeIdTargeting(ids: readonly string[]): string {
  return ids.length === 0
    ? '  대상  배치 전체 (--id 없음)'
    : `  대상  🎯 지정한 ${ids.length}건만 (--id) — 그 외에는 손대지 않는다`
}
