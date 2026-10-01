/**
 * 🔴 **목록 관측 읽기 — 원천 반응의 정본 · 원천 상대 표본 · 실제 반복 관측의 재료** (2026-09-30 · source-evidence-v1)
 *
 *   수집기는 회차마다 목록 전체를 남긴다(A1 §4 — 같은 글이 다른 회차에 다시 찍힌다). 그 줄이 세 가지의 유일한 재료다:
 *     · 후보가 **수집 때 본 반응**(`response`) — 그 글의 목록 줄 중 `sourceListedAt` 이 같은 관측 하나
 *     · 같은 원천 · 같은 관측 나이 구간의 **비교 표본**(`sourceStatsSnapshot`)
 *     · 같은 글을 **실제로 다시 본** 관측(`observations`) — 두 번 이상일 때만 velocity 가 선다
 *
 * 🔴 **반응의 정본은 이 파일 하나다** (2026-09-30 Lane B). 앞판은 목록 수를 얇은 행 · 상세 행 · 생성 봉투로
 *    세 번 복사했고(두 번째 권위), 증거는 그 복사본을 읽었다 — 운영 artifact 205건 모두 조회수가 null 이었는데
 *    같은 목록 표본은 5928/5928 조회수를 들고 있었다. 네이버의 "댓글 수 못 읽음" 도 복사 중 0 으로 굳었다.
 *    이제 하류는 `sourceListedAt` 으로 목록 관측을 찾아 읽는다 — 복사본은 지웠다.
 *
 * 🔴 **원천마다 artifact 모양이 다르다 — 모양 표는 `LIST_ARTIFACT_FORMATS` 하나다.** 줄의 칸 이름은 같다
 *    (`sourceSite` · `sourceArticleId` · `sourceListedAt` · `sourcePostedAt` · `sourceCommentCount` ·
 *    `sourceCommentCountRead` · `sourceViewCount` · `sourcePage` · `sourceRankOnPage` · `sourcePinned`).
 *    관측 시각은 **줄의 `sourceListedAt`** 이다 — 파일 이름이 아니다(82cook 은 한 파일에 회차를 덧붙인다).
 *    표에 없는 이름의 `.list.jsonl` 은 열지 않고 센다(`ignoredFiles`) — 모르는 모양을 추측으로 읽지 않는다.
 *
 * 🔴 읽기만 한다 — 파일 write 0 · DB 0 · 네트워크 0. 수 · 시각 · id 만 꺼낸다(제목 · 본문 · 닉네임 버림).
 * 🔴 고정글(`sourcePinned`)은 넣지 않는다 — 목록 자리가 반응이 아니다.
 * 🔴 판정은 하지 않는다 — 정본은 `src/lib/source-slot-release.ts` 다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  normalizeEvidenceTime, SOURCE_AGE_LIMIT_HOURS, sourceStatsSnapshot,
  type ListObservation, type SourceObservation, type SourceResponse, type SourceStatsSnapshot,
} from '../../src/lib/source-slot-release'

/**
 * 🔴 **활성 · 예정 source connector 가 실제로 쓰는 목록 artifact 모양 — 전부 여기 있다.**
 *    · `runStamped` 는 파일 이름에 회차 시각이 있어 창 밖 파일을 열지 않아도 되는 모양이다(관측 시각은 여전히 줄에서 읽는다)
 */
export const LIST_ARTIFACT_FORMATS = [
  {
    kind: 'navercafe-run',
    connector: 'micro-seed-collect-navercafe (launchd navercafe-collect-{remonterrace,wgang}-multi · 활성)',
    re: /^navercafe-[a-z0-9]+-(\d{8})-(\d{6})\.list\.jsonl$/,
    runStamped: true,
  },
  {
    kind: '82cook-append',
    connector: 'micro-seed-collect-82cook --list (launchd raw-collect-82cook · 예정) — 회차마다 뒤에 덧붙인다',
    re: /^82cook\.list\.jsonl$/,
    runStamped: false,
  },
] as const

export type ListArtifactKind = (typeof LIST_ARTIFACT_FORMATS)[number]['kind']

/** 🔴 앞판 이름 — 네이버 카페 회차 파일. 표의 첫 모양과 같다(다른 검사가 읽는다) */
export const LIST_FILE_RE = LIST_ARTIFACT_FORMATS[0].re

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
/** 🔴 정규 ISO 로만 — 못 읽으면 null(관측이 아니다) */
const canonical = (v: unknown): string | null => {
  const n = normalizeEvidenceTime(v)
  return n !== null && Number.isFinite(Date.parse(n)) && new Date(n).toISOString() === n ? n : null
}

/** 🔴 파일 이름의 회차 시각(UTC) — 창 밖 파일을 열지 않으려고 쓴다(회차 파일 모양만) */
function runAtOf(name: string, re: RegExp): number | null {
  const m = re.exec(name)
  if (m === null || m[1] === undefined || m[2] === undefined) return null
  const d = m[1]
  const t = m[2]
  const ms = Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`)
  return Number.isFinite(ms) ? ms : null
}

/** 🔴 목록 관측 한 줄 + 자리(반응 기록에 옮긴다) */
export type ListObservationRow = ListObservation & { listRank: number | null; listPage: number | null }

export type ListObservationIndex = {
  /** 창 안의 모든 관측(고정글 제외) — 비교 표본 */
  sample: ListObservationRow[]
  /** `sourceKey::articleId` → 그 글의 관측(시각 오름차순 · 같은 시각은 하나) */
  byArticle: Map<string, ListObservationRow[]>
  files: number
  /** 🔴 모양 표에 없는 `.list.jsonl` — 열지 않았다 */
  ignoredFiles: number
  /** 🔴 모양별로 연 파일 수 */
  byFormat: Record<ListArtifactKind, number>
  unreadable: number
  /** 🔴 목록 시각이 없는 줄(옛 82cook 줄 등) — 관측이 아니다 */
  unobservable: number
}

export const articleKeyOf = (sourceKey: string, articleId: string): string => `${sourceKey}::${articleId}`

/**
 * 🔴 **창 `[at − 72h − 여유, at + 하루]` 의 관측만 모은다.** 여유 하루로 시간대 해석 차이를 덮는다
 *    (표본에 들어갈지는 `sourceStatsSnapshot` 이 관측 시각으로 다시 거른다).
 *    못 읽는 줄 · 파일은 세기만 하고 건너뛴다 — 표본이 작아질 뿐 지어내지 않는다.
 */
export function readListObservations(dataDir: string, at: Date): ListObservationIndex {
  const sample: ListObservationRow[] = []
  const byArticle = new Map<string, ListObservationRow[]>()
  const seen = new Set<string>()
  const byFormat = Object.fromEntries(LIST_ARTIFACT_FORMATS.map((f) => [f.kind, 0])) as Record<ListArtifactKind, number>
  let files = 0
  let ignoredFiles = 0
  let unreadable = 0
  let unobservable = 0
  const out = (): ListObservationIndex => ({ sample, byArticle, files, ignoredFiles, byFormat, unreadable, unobservable })
  if (!existsSync(dataDir)) return out()
  const fromMs = at.getTime() - (SOURCE_AGE_LIMIT_HOURS + 24) * 3_600_000
  const toMs = at.getTime() + 86_400_000
  for (const name of readdirSync(dataDir).sort()) {
    if (!name.endsWith('.list.jsonl')) continue
    const fmt = LIST_ARTIFACT_FORMATS.find((f) => f.re.test(name))
    if (fmt === undefined) { ignoredFiles += 1; continue }
    if (fmt.runStamped) {
      const runMs = runAtOf(name, fmt.re)
      if (runMs === null || runMs < fromMs || runMs > toMs) continue
    }
    let raw: string
    try { raw = readFileSync(join(dataDir, name), 'utf-8') } catch { unreadable += 1; continue }
    files += 1
    byFormat[fmt.kind] += 1
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (t === '') continue
      let parsed: unknown
      try { parsed = JSON.parse(t) } catch { unreadable += 1; continue }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { unreadable += 1; continue }
      const r = parsed as Record<string, unknown>
      if (r.sourcePinned === true) continue
      const sourceKey = str(r.sourceSite)
      const id = str(r.sourceArticleId)
      const observedAt = canonical(r.sourceListedAt)
      if (sourceKey === '' || id === '' || observedAt === null) { unobservable += 1; continue }
      const om = Date.parse(observedAt)
      if (om < fromMs || om > toMs) continue
      const k = articleKeyOf(sourceKey, id)
      // 🔴 같은 글 · 같은 회차는 한 번 — 사본 파일이 관측 수를 부풀리지 못한다
      if (seen.has(`${k}@${observedAt}`)) continue
      seen.add(`${k}@${observedAt}`)
      const o: ListObservationRow = {
        sourceKey, articleKey: k,
        postedAt: canonical(r.sourcePostedAt),
        observedAt,
        views: count(r.sourceViewCount),
        // 🔴 댓글 수를 실제로 읽지 못한 줄은 0 이 아니라 모름이다
        comments: r.sourceCommentCountRead === false ? null : count(r.sourceCommentCount),
        listRank: count(r.sourceRankOnPage),
        listPage: count(r.sourcePage),
      }
      sample.push(o)
      byArticle.set(k, [...(byArticle.get(k) ?? []), o])
    }
  }
  for (const xs of byArticle.values()) xs.sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  return out()
}

/**
 * 🔴 **한 글의 증거 재료** — 수집 때 본 반응 · 반복 관측 · 원천 상대 스냅샷.
 *    · `response` 는 그 글의 목록 줄 중 **`listedAt` 과 같은 시각의 관측 하나**다(수집이 본 그 목록).
 *      다른 회차 관측으로 메우지 않는다 — 없으면 null(`RESPONSE_UNOBSERVED`).
 *    · `observations` 는 그 글의 **서로 다른 회차** 관측 전부(시각이 `at` 이후인 것은 뺀다)
 *    · 스냅샷은 그 반응을 같은 원천 · 같은 관측 나이 구간 표본(자기 제외)에 놓는다 — 반응이 없으면 null
 */
export function evidenceMaterialFor(idx: ListObservationIndex, input: {
  sourceKey: string; articleId: string; postedAt: string | null
  /** 🔴 수집이 본 목록의 시각 — 목록 관측과 잇는 열쇠 */
  listedAt: string | null
  at: Date
}): { response: SourceResponse | null; observations: SourceObservation[]; sourceStats: SourceStatsSnapshot | null } {
  const mine = (idx.byArticle.get(articleKeyOf(input.sourceKey, input.articleId)) ?? [])
    .filter((o) => Date.parse(o.observedAt) <= input.at.getTime())
  const observations: SourceObservation[] = mine.map((o) => ({ observedAt: o.observedAt, views: o.views, comments: o.comments }))
  const listedAt = canonical(input.listedAt)
  const hit = listedAt === null ? undefined : mine.find((o) => o.observedAt === listedAt)
  const response: SourceResponse | null = hit === undefined || (hit.views === null && hit.comments === null) ? null : {
    views: hit.views, comments: hit.comments, listRank: hit.listRank, listPage: hit.listPage, observedAt: hit.observedAt,
  }
  const sourceStats = response === null ? null : sourceStatsSnapshot({
    sourceKey: input.sourceKey, articleKey: articleKeyOf(input.sourceKey, input.articleId),
    // 🔴 게시 시각은 후보가 실어 온 값 하나다 — 기록의 `postedAt` 과 같은 값이어야 구간이 판정과 맞는다
    postedAt: canonical(input.postedAt),
    observedAt: response.observedAt, comments: response.comments, views: response.views,
    sample: idx.sample, at: input.at,
  })
  return { response, observations, sourceStats }
}
