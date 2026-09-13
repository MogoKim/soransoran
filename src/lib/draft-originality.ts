/**
 * 독창성 — 🔴 **실질 복제만 막는다.** 순수 함수. 파일 · DB · 네트워크 없음
 *
 * 🔴 **왜 다시 썼나** (2026-09-13).
 *
 *    옛 기준은 `공백 제거 후 최장 공통 조각 >= 6자` 하나였다.
 *    한국어에서 6자는 **흔한 표현의 길이**다 —
 *      "그래서저는"(5) · "저희아이가"(5) · "요즘너무힘들어서"(8) · "갱년기증상이"(6)
 *    같은 소재로 글을 쓰면 이 정도는 저절로 겹친다. 그래서 이 기준은
 *    **베낀 글이 아니라 같은 주제의 글**을 걸렀다.
 *    실측(2026-09-11~12 24시간)에서 초안 최종 HOLD 15건 중 7건이 이 사유였다.
 *
 * 🔴 **고치는 방향은 숫자를 6에서 7로 올리는 것이 아니다.**
 *    단위가 틀렸다. 베낀 글의 표시는 "몇 글자가 같은가" 가 아니라
 *    **"문장이 통째로 넘어왔는가"** 다. 그래서 세 가지를 따로 잰다.
 *
 *      ① 어절 연속   — 띄어쓰기를 살린 채 **연속 어절**이 얼마나 이어지는가
 *      ② 글자 연속   — 띄어쓰기를 바꿔 가며 베끼는 것을 잡는 backstop
 *      ③ 덮인 비율   — 짧은 조각을 여러 개 이어 붙여 만든 모자이크 복제
 *
 *    셋 중 하나라도 넘으면 실질 복제다. 흔한 표현은 셋 다 한참 아래로 지나간다.
 *
 * 🔴 **금지 표현 목록을 만들지 않는다.** "이 말은 흔하다" 를 사람이 적기 시작하면
 *    목록은 반드시 낡고, 낡은 목록이 정상 문장을 막는다.
 *    길이와 비율만으로 가른다 — 그 편이 검증 가능하고 언어에 덜 의존한다.
 *
 * 🔴 **고유명사는 따로 다루지 않는다 — 다룰 필요가 없다** (2026-09-13 실측).
 *    사람 이름 · 프로그램 이름은 1~2어절이라 세 기준 어디에도 닿지 않는다.
 *    실측: `차태현` + `미운 우리 새끼` 만 겹치는 초안 → 2어절 · 6자 · 덮임 0% → 통과.
 *    같은 원문의 **제목을 통째로** 옮기면 → 9어절 · 27자 · 덮임 100% → 차단.
 *    이름을 지우는 규칙을 따로 만들면 그 규칙이 정상 문장을 잡기 시작한다.
 *
 * 🔴 **임계값은 관측이지 영구 정책이 아니다.** 아래 수는 2026-09-13 실측에서 나왔고,
 *    재료가 바뀌면 다시 잰다. 이 파일의 fixture 가 그 실측을 재현한다.
 */

/**
 * 🔴 원문의 **연속 어절**이 이만큼 이어지면 베낀 것이다.
 *
 * 흔한 연결어는 길어야 3~4어절이다 ("그래서 저는 요즘" · "저희 아이가 작년에").
 * 6어절이 통째로 같으려면 문장을 옮긴 것이다.
 */
export const COPY_RUN_WORDS = 6

/**
 * 🔴 띄어쓰기를 바꿔 가며 베끼는 것을 잡는 backstop — 공백을 지운 뒤 연속 글자.
 *
 * 25자면 한국어 한 문장 분량이다. 어절 단위를 피해 가려고 띄어쓰기를 흩어도
 * 글자 나열은 남는다.
 */
export const COPY_RUN_CHARS = 25

/** 덮인 비율을 셀 때 "조각" 으로 인정하는 최소 길이 — 이보다 짧으면 흔한 말이다 */
export const COVER_PIECE_CHARS = 12

/**
 * 🔴 초안 글자의 이만큼이 원문 조각으로 덮여 있으면 베낀 것이다.
 *
 * 한 조각 한 조각은 기준 아래인데 이어 붙이면 원문이 되는 경우를 잡는다.
 *
 * 🔴 **0.35 를 고른 근거는 관측 분리다** (2026-09-13 실측).
 *      · 자기 말로 쓴 긴 글          덮임 0.00
 *      · 흔한 표현만 겹치는 글       덮임 0.00
 *      · 두 문장을 이어 붙인 모자이크 덮임 0.44
 *      · 세 문장을 거의 그대로       덮임 0.88
 *    정상 글이 0 에 몰려 있어서 여유가 크다. 0.5 로 두면 0.44 짜리가 지나간다.
 *
 * 🔴 **네 예시가 아니라 실제 사람 글 562건으로 다시 쟀다** (2026-09-13).
 *    정본 말투 자산(외부 커뮤니티 댓글, 익명화)에서 40자 이상만 골라 대조했다.
 *      · 서로 다른 사람 글 1,680쌍 → 복제 판정 **0건** (오탐 0.00%)
 *      · 자기 자신 500건          → 놓친 것 **0건**
 *      · 앞 절반만 베낀 것 500건   → 놓친 것 **0건**
 */
export const COVER_RATIO = 0.35

/** 잰 값 — 🔴 **판정이 아니라 관측값이다.** 기준은 이 파일이 따로 갖는다 */
export type OriginalityMeasure = {
  /** 가장 길게 이어진 공통 어절 수 */
  runWords: number
  /** 공백을 지운 뒤 가장 길게 이어진 공통 글자 수 */
  runChars: number
  /** 초안 글자 중 원문 조각으로 덮인 비율 (0~1, 소수점 셋째 자리에서 버림) */
  coverRatio: number
}

export const COPY_REASONS = ['ok', 'runWords', 'runChars', 'cover'] as const
export type CopyReason = (typeof COPY_REASONS)[number]

export const COPY_REASON_LABEL: Record<CopyReason, string> = {
  ok: '통과',
  runWords: `🔴 원문의 연속 어절 ${COPY_RUN_WORDS}개 이상이 그대로다 — 문장을 옮겼다`,
  runChars: `🔴 공백을 빼고 ${COPY_RUN_CHARS}자 이상이 그대로 이어진다 — 문장을 옮겼다`,
  cover: `🔴 초안의 ${Math.round(COVER_RATIO * 100)}% 이상이 원문 조각으로 덮여 있다 — 이어 붙여 옮겼다`,
}

export type CopyVerdict = { copied: boolean; reason: CopyReason }

const S = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * 비교용으로 다듬는다 — 🔴 **띄어쓰기를 지우지 않는다.**
 *
 * 옛 기준의 실수가 여기 있었다. 공백을 지우면 어절 경계가 사라져서
 * "몇 낱말이 같은가" 를 물을 수 없게 되고, 남는 물음은 "몇 글자가 같은가" 뿐이다.
 */
export function normalizeWords(s: string): string[] {
  return S(s)
    .replace(/[.,!?~…"'"'()[\]{}<>·:;\-—]/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '')
}

/** 공백·기호를 모두 지운 글자열 — 글자 연속을 잴 때만 쓴다 */
export function normalizeChars(s: string): string {
  return S(s).replace(/[\s.,!?~…"'"'()[\]{}<>·:;\-—]/g, '')
}

/** 가장 길게 이어지는 공통 부분 수열 길이 — 어절 배열에도 글자열에도 같은 셈이다 */
function longestCommonRun<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length === 0 || b.length === 0) return 0
  let best = 0
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = (prev[j - 1] ?? 0) + 1
        if ((cur[j] ?? 0) > best) best = cur[j] ?? 0
      }
    }
    prev = cur
  }
  return best
}

/**
 * 초안 글자 중 원문 조각으로 덮인 비율.
 *
 * 🔴 **조각을 세지 않고 자리를 센다.** 같은 자리를 두 조각이 덮어도 한 번만 센다 —
 *    조각 수를 더하면 100% 를 넘는 수가 나오고, 넘는 수는 비율이 아니다.
 */
export function coveredRatio(draft: string, source: string): number {
  const a = normalizeChars(draft)
  const b = normalizeChars(source)
  if (a.length === 0 || b.length === 0) return 0
  const covered = new Array<boolean>(a.length).fill(false)
  for (let i = 0; i + COVER_PIECE_CHARS <= a.length; i += 1) {
    // 이 자리에서 시작하는 가장 긴 공통 조각을 찾는다
    let len = COVER_PIECE_CHARS
    if (!b.includes(a.slice(i, i + len))) continue
    while (i + len + 1 <= a.length && b.includes(a.slice(i, i + len + 1))) len += 1
    for (let k = i; k < i + len; k += 1) covered[k] = true
  }
  const hit = covered.filter(Boolean).length
  return Math.floor((hit / a.length) * 1000) / 1000
}

/** 초안과 원문을 재기만 한다 — 🔴 여기서 통과·탈락을 정하지 않는다 */
export function measureOriginality(draft: string, source: string): OriginalityMeasure {
  return {
    runWords: longestCommonRun(normalizeWords(draft), normalizeWords(source)),
    runChars: longestCommonRun([...normalizeChars(draft)], [...normalizeChars(source)]),
    coverRatio: coveredRatio(draft, source),
  }
}

/**
 * 잰 값을 판정으로 옮긴다 — 🔴 **생성 · 적재 · 발행 전 재검사가 이 함수 하나를 쓴다.**
 *
 * 옛 판에서는 생성 쪽이 `overlap < 6`, 적재 쪽이 `overlap > 6` 을 보고 있어서
 * 정확히 6자인 초안의 운명이 어느 단계를 지나느냐에 따라 달랐다(2026-09-07 실측).
 * 기준이 두 벌이면 반드시 그런 날이 온다.
 */
export function judgeCopy(m: OriginalityMeasure | null | undefined): CopyVerdict {
  // 🔴 **재지 않은 것은 통과가 아니다.** 잰 값이 없으면 근거가 없다는 뜻이다
  if (m === null || m === undefined) return { copied: true, reason: 'runWords' }
  if (!Number.isFinite(m.runWords) || !Number.isFinite(m.runChars) || !Number.isFinite(m.coverRatio)) {
    return { copied: true, reason: 'runWords' }
  }
  if (m.runWords >= COPY_RUN_WORDS) return { copied: true, reason: 'runWords' }
  if (m.runChars >= COPY_RUN_CHARS) return { copied: true, reason: 'runChars' }
  if (m.coverRatio >= COVER_RATIO) return { copied: true, reason: 'cover' }
  return { copied: false, reason: 'ok' }
}

/** 기록·화면용 한 줄 */
export function describeOriginality(m: OriginalityMeasure): string {
  return `연속 ${m.runWords}어절 · ${m.runChars}자 · 덮임 ${Math.round(m.coverRatio * 100)}%`
}

/** 파일에서 읽은 값을 잰 값으로 되돌린다 — 🔴 모양이 아니면 `null` 이다 */
export function readMeasure(v: unknown): OriginalityMeasure | null {
  if (v === null || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const w = Number(o.runWords)
  const c = Number(o.runChars)
  const r = Number(o.coverRatio)
  if (!Number.isFinite(w) || !Number.isFinite(c) || !Number.isFinite(r)) return null
  if (w < 0 || c < 0 || r < 0 || r > 1) return null
  return { runWords: w, runChars: c, coverRatio: r }
}
