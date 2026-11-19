/**
 * 네이버 카페 원천 규칙 — 🔴 순수 함수. DB · 네트워크 · 파일 없음
 *
 * 🔴 **왜 이 파일이 따로 있나** — "어떤 글의 본문을 열 것인가" 는 규칙이지 절차가 아니다.
 *    스크립트 안에 두면 브라우저 없이는 검증할 수 없다. fixture 가 직접 부른다
 *    (import 는 원천 순위 정본 `source-slot-release` 하나 — DB · 파일 · 네트워크 없음).
 * 🔴 한 바퀴에 몇 건을 여는지는 여기 없다 — 실행 때 `collect-sources.cycleDetailQuota` 가 정한다.
 */
import { sortBySourceRank } from '../../src/lib/source-slot-release'

// ─────────────────────────────────────────────────────────
// sourceSite 계약 (PR-S2-b-1)
// ─────────────────────────────────────────────────────────

/**
 * 네이버 카페 sourceSite 형태 — `navercafe:{cafeId}`.
 *
 * 🔴 **cafeId 를 sourceSite 에 넣는 이유**
 *    `dedupKey = sha256(sourceSite::sourceArticleId)` 이고 네이버 articleId 는
 *    **카페 안에서만** 유일하다. cafeId 가 빠지면 다른 카페의 같은 번호 글이
 *    같은 키가 되어 한쪽이 조용히 SKIP 된다.
 *
 * 🔴 **sourceSite 는 운영 단위이지 주제 라벨이 아니다.**
 *    카페마다 성격 경향은 있지만 그것을 고정 라벨로 굳히지 않는다 —
 *    주제·소재 판정은 **글 단위**로 한다(qualityFlags · Originality Gate).
 *    "이 카페는 갱년기 카페" 로 굳히면 그 카페의 다른 글을 잘못 읽고,
 *    다른 카페의 갱년기 글을 놓친다.
 *
 * 실측: Raw Vault 에 `navercafe:remonterrace` / articleId `34783204` 행이 이미 있다.
 *       이 계약은 새로 만드는 것이 아니라 **코드로 고정하는 것**이다.
 */
export const NAVERCAFE_PREFIX = 'navercafe:'

/** cafeId 는 네이버 카페 URL 의 영문 ID 다 (`cafe.naver.com/{cafeId}`) */
const CAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/i

export function isNaverCafeSource(sourceSite: string): boolean {
  if (!sourceSite.startsWith(NAVERCAFE_PREFIX)) return false
  return CAFE_ID_RE.test(sourceSite.slice(NAVERCAFE_PREFIX.length))
}

/** `navercafe:remonterrace` → `remonterrace`. 형태가 아니면 null */
export function cafeIdOf(sourceSite: string): string | null {
  if (!isNaverCafeSource(sourceSite)) return null
  return sourceSite.slice(NAVERCAFE_PREFIX.length)
}

// ─────────────────────────────────────────────────────────
// 자동 선별 (collect --auto)
// ─────────────────────────────────────────────────────────

/**
 * 🔴 자동 제외는 **두 단계**다. 한 목록에 섞어 두면 작동하지 않는 가드가 생긴다.
 *
 * ## 왜 나누는가 — 2026-09-03 실측 결함
 *
 * 처음엔 하나였다: `AUTO_SKIP_FLAGS = ['politicalOrPublicFigure', 'medicalOrAdLikely']`.
 * 그런데 **자동 선별은 목록 단계에서 일어난다.** 목록에는 제목과 댓글수뿐이다.
 *
 * `medicalOrAdLikely` 는 (시설|시술) **AND** 가격, 또는 상업유도 조합을 요구한다.
 * 제목만으로 그 조합이 성립하는 일은 사실상 없다 — 그래서 목록 단계에서 **한 번도 붙지 않았다.**
 *
 * 실측: `불안으로 정신과약 드셔본 분 계신가요`(4234890) ·
 *       `뇌MRI 사진에서 치매 및 어지럼증 같이 보일까요?`(4234897)
 *       → 목록 단계 플래그는 `highEngagement` 하나뿐. 자동 수집에 그대로 들어왔다.
 *
 * 🔴 **"목록에 있는 이름"과 "그 단계에서 실제로 붙는 플래그"는 다르다.**
 *    이름만 적어 두면 가드가 있는 것처럼 보이지만 아무것도 막지 않는다 —
 *    `noGoTopics` 0/28 히트와 같은 종류의 실패다.
 */

/**
 * ① 목록 단계 자동 제외 — **상세를 열기 전에** 뺀다.
 *
 * 🔴 여기에는 **제목만으로 판정되는 플래그만** 넣는다.
 *    fixture 가 "이 플래그가 제목 하나로 실제 발화하는가" 를 증명하고,
 *    증명하지 못하면 실패한다(구조 가드).
 *
 * 🔴 거부가 아니라 **자동으로 열지 않는 것**이다.
 *    목록 JSONL 에는 전부 남는다. 자동 경로에는 넘길 눈이 없기 때문에 그 경로만 좁힌다.
 */
export const AUTO_SKIP_LIST_FLAGS = ['hanjaLanguageFit'] as const

/**
 * 🔴 **`AUTO_MIN_SCORE` 는 삭제했다** (2026-09-11).
 *
 *    점수 하한으로 본문을 열기 **전에** 후보를 버리던 값이다(20).
 *    실측: remonterrace 후보 15 → 상세 4, wgang 후보 15 → 상세 2 —
 *    상한이 10 인데 점수 때문에 빈손으로 끝났다. 점수는 관측값으로만 남기고,
 *    자동 상세 열기 순서는 실제 원문 게시 시각을 쓴다. 품질은 본문을 읽은 뒤 safety·judge·draft 가 본다.
 */

export type AutoFetchInput = {
  sourceArticleId: string
  score: number
  flags: readonly string[]
  /**
   * 🔴 **게시 시각의 가장 이른 끝**(ISO) — 정확한 시각이면 그 시각, 날짜만 알면 그날 00:00 KST, 모르면 null/생략.
   *    자동 상세 열기의 1순위다(최신이 먼저). 점수는 이 시각을 이기지 않는다.
   */
  postedFrom?: string | null
  /** 이미 Raw Vault 에 있는가 — 부르는 쪽이 실측해 넘긴다 */
  alreadyInVault?: boolean
}

export type AutoSkipReason = 'ALREADY_IN_VAULT' | 'SKIP_FLAG' | 'OVER_MAX'

export type AutoFetchPlan = {
  picked: string[]
  skipped: { sourceArticleId: string; reason: AutoSkipReason; detail: string }[]
}

// 🔴 2026-10-19 창업자/Codex — DIGITS 를 지웠다. 숫자 article id 를 source-time proxy 로 쓰지 않는다.
const postedMsOf = (r: AutoFetchInput): number | null => {
  const ms = typeof r.postedFrom === 'string' ? Date.parse(r.postedFrom) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}


/**
 * 목록에서 상세를 열 후보를 고른다.
 *
 * 🔴 순서가 규칙이다. 이미 있는 것을 **가장 먼저** 걸러낸다 —
 *    이미 연 글을 다시 여는 것은 카페에 부하만 주고 얻는 것이 없다.
 */
export function planAutoFetch(
  rows: readonly AutoFetchInput[],
  opts: { max: number },
): AutoFetchPlan {
  const max = opts.max
  const picked: string[] = []
  const skipped: AutoFetchPlan['skipped'] = []

  // 🔴 수집 전이라 수집 시각이 없다 — 게시 시각 최신 → 결정적 열쇠(글 번호, 코드 포인트)다.
  //    점수·주제·출처는 순위에 들어오지 않는다. 숫자 글 번호를 게시 시각 대용으로 쓰지 않는다.
  const ordered = sortBySourceRank(rows, (r) => ({ latestAtMs: postedMsOf(r), tieBreak: r.sourceArticleId }))

  for (const r of ordered) {
    if (r.alreadyInVault === true) {
      skipped.push({ sourceArticleId: r.sourceArticleId, reason: 'ALREADY_IN_VAULT', detail: '이미 Raw Vault 에 있다' })
      continue
    }
    const hit = r.flags.filter((f) => (AUTO_SKIP_LIST_FLAGS as readonly string[]).includes(f))
    if (hit.length > 0) {
      skipped.push({ sourceArticleId: r.sourceArticleId, reason: 'SKIP_FLAG', detail: `자동 제외 플래그 ${hit.join('·')}` })
      continue
    }
    /**
     * 🔴 **점수는 관측값이지 순서나 관문이 아니다** (2026-10-19).
     *
     *    옛 판은 `score < AUTO_MIN_SCORE` 면 **본문을 열기도 전에** 버렸다.
     *    실측: remonterrace 목록 23 → 후보 15 → 상세 **4**, wgang 21 → 15 → 상세 **2**.
     *    상한은 10 인데 점수 때문에 2~4 건만 열렸다 — 후보가 남아 있는데도 빈손으로 끝났다.
     *
     *    자동 상세 열기는 위에서 실제 원문 게시 시각 최신순으로 정렬했다. 상한(`max`)이 그 뒤를 자른다.
     *    품질은 본문을 읽은 뒤 safety·judge·draft 게이트가 판단한다 —
     *    읽지도 않고 버리면 그 게이트들이 볼 것이 없다.
     *
     * 🔴 이것을 대신할 새 관문을 만들지 않는다. 하드 차단으로 남는 것은
     *    위의 `ALREADY_IN_VAULT`(중복)와 `SKIP_FLAG`(언어 핏) 둘뿐이다.
     */
    if (picked.length >= max) {
      skipped.push({ sourceArticleId: r.sourceArticleId, reason: 'OVER_MAX', detail: `이 바퀴 몫 ${max}건 밖 — 다음 바퀴에서 열린다` })
      continue
    }
    picked.push(r.sourceArticleId)
  }

  return { picked, skipped }
}
