/**
 * 🔴 **목록 관측 읽기 — 원천 상대 반응 · 실제 반복 관측의 재료** (2026-09-30 · source-evidence-v1)
 *
 *   수집기는 회차마다 목록 전체를 `navercafe-<cafe>-<runId>.list.jsonl` 로 남긴다(A1 §4 — 같은 글이
 *   다른 회차에 다시 찍힌다). 그 파일이 두 가지의 유일한 재료다:
 *     · 같은 원천 · 같은 관측 나이 구간의 **비교 표본**(`sourceStatsSnapshot`)
 *     · 같은 글을 **실제로 다시 본** 관측(`observations`) — 두 번 이상일 때만 velocity 가 선다
 *
 * 🔴 읽기만 한다 — 파일 write 0 · DB 0 · 네트워크 0. 수 · 시각 · id 만 꺼낸다(제목 · 본문 · 닉네임 버림).
 * 🔴 고정글(`sourcePinned`)은 넣지 않는다 — 목록 자리가 반응이 아니다.
 * 🔴 판정은 하지 않는다 — 정본은 `src/lib/source-slot-release.ts` 다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  SOURCE_AGE_LIMIT_HOURS, sourceStatsSnapshot,
  type ListObservation, type SourceObservation, type SourceStatsSnapshot,
} from '../../src/lib/source-slot-release'

/** 🔴 목록 산출 파일 이름 — 수집기(`micro-seed-collect-navercafe`)가 쓰는 모양 그대로 */
export const LIST_FILE_RE = /^navercafe-[a-z0-9]+-(\d{8})-(\d{6})\.list\.jsonl$/

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 🔴 파일 이름의 회차 시각(UTC) — 창 밖 파일을 열지 않으려고 쓴다 */
function runAtOf(name: string): number | null {
  const m = LIST_FILE_RE.exec(name)
  if (m === null) return null
  const d = m[1]!
  const t = m[2]!
  const ms = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`)
  return Number.isFinite(ms) ? ms : null
}

export type ListObservationIndex = {
  /** 창 안의 모든 관측(고정글 제외) — 비교 표본 */
  sample: ListObservation[]
  /** `sourceKey::articleId` → 그 글의 관측(시각 오름차순) */
  byArticle: Map<string, ListObservation[]>
  files: number
  unreadable: number
}

export const articleKeyOf = (sourceKey: string, articleId: string): string => `${sourceKey}::${articleId}`

/**
 * 🔴 **창 `[at − 72h − 여유, at]` 의 목록 파일만 연다.** 이름의 회차 시각은 UTC 로 적힌다 — 여유 하루로
 *    시간대 해석 차이를 덮는다(표본에 들어갈지는 관측 시각으로 다시 거른다).
 *    못 읽는 줄 · 파일은 세기만 하고 건너뛴다 — 표본이 작아질 뿐 지어내지 않는다.
 */
export function readListObservations(dataDir: string, at: Date): ListObservationIndex {
  const sample: ListObservation[] = []
  const byArticle = new Map<string, ListObservation[]>()
  let files = 0
  let unreadable = 0
  if (!existsSync(dataDir)) return { sample, byArticle, files, unreadable }
  const fromMs = at.getTime() - (SOURCE_AGE_LIMIT_HOURS + 24) * 3_600_000
  for (const name of readdirSync(dataDir).sort()) {
    const runMs = runAtOf(name)
    if (runMs === null || runMs < fromMs || runMs > at.getTime() + 86_400_000) continue
    let raw: string
    try { raw = readFileSync(join(dataDir, name), 'utf-8') } catch { unreadable += 1; continue }
    files += 1
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (t === '') continue
      let r: Record<string, unknown>
      try { r = JSON.parse(t) as Record<string, unknown> } catch { unreadable += 1; continue }
      if (r.sourcePinned === true) continue
      const sourceKey = str(r.sourceSite)
      const id = str(r.sourceArticleId)
      const observedAt = str(r.sourceListedAt)
      if (sourceKey === '' || id === '' || observedAt === '' || !Number.isFinite(Date.parse(observedAt))) continue
      const o: ListObservation = {
        sourceKey, articleKey: articleKeyOf(sourceKey, id),
        postedAt: str(r.sourcePostedAt) === '' ? null : str(r.sourcePostedAt),
        observedAt: new Date(observedAt).toISOString(),
        views: count(r.sourceViewCount),
        // 🔴 댓글 수를 실제로 읽지 못한 줄은 0 이 아니라 모름이다
        comments: r.sourceCommentCountRead === false ? null : count(r.sourceCommentCount),
      }
      sample.push(o)
      const k = o.articleKey
      byArticle.set(k, [...(byArticle.get(k) ?? []), o])
    }
  }
  for (const xs of byArticle.values()) xs.sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  return { sample, byArticle, files, unreadable }
}

/**
 * 🔴 **한 글의 증거 재료** — 반복 관측과 원천 상대 스냅샷.
 *    · `observations` 는 그 글의 **서로 다른 회차** 관측 전부(시각이 `at` 이후인 것은 뺀다)
 *    · 스냅샷은 수집 때 본 수(`response`)를 같은 모집단에 놓는다 — 모집단이 없으면 null
 */
export function evidenceMaterialFor(idx: ListObservationIndex, input: {
  sourceKey: string; articleId: string; postedAt: string | null
  response: { comments: number | null; views: number | null; observedAt: string | null } | null
  at: Date
}): { observations: SourceObservation[]; sourceStats: SourceStatsSnapshot | null } {
  const mine = (idx.byArticle.get(articleKeyOf(input.sourceKey, input.articleId)) ?? [])
    .filter((o) => Date.parse(o.observedAt) <= input.at.getTime())
  const observations: SourceObservation[] = mine.map((o) => ({ observedAt: o.observedAt, views: o.views, comments: o.comments }))
  const r = input.response
  const sourceStats = r === null ? null : sourceStatsSnapshot({
    sourceKey: input.sourceKey, articleKey: articleKeyOf(input.sourceKey, input.articleId),
    postedAt: input.postedAt, observedAt: r.observedAt, comments: r.comments, views: r.views,
    sample: idx.sample, at: input.at,
  })
  return { observations, sourceStats }
}
