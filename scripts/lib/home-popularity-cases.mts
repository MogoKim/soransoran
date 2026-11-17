/**
 * 홈 갱년기톡 최소 배분 — 순수 사례 묶음 (check:home-popularity · check:home-popularity-mutation 이 함께 쓴다)
 *
 * 🔴 규칙을 여기 다시 적지 않는다 — 검사할 함수를 **인자로 받는다**(`mod`).
 *    일반 검사는 실제 모듈을, 변이 검사는 한 군데를 바꾼 사본을 넣는다. 같은 사례가 둘 다를 판정해야
 *    "변이를 잡는 시험" 이 실제 시험과 같은 것이 된다.
 * 🔴 결과는 실패 라벨 목록이다. 빈 배열 = 전부 통과.
 * 🔴 편성 배선(composeHomePopularViews 가 이 함수들을 이렇게 잇는지)은 check:home-popularity ⑦ 이 정적으로 본다.
 *    여기서는 같은 배선(applyHomeExposure + fill = fillMenopauseMinimum → diagnoseMenopauseQuota)을 그대로 재현한다.
 */
import type { BoardType } from '@prisma/client'

type Post = { id: string; boardType: BoardType; createdAt: Date; realReactions: number }
type Override = {
  id: string
  createdAt: Date
  postId: string
  action: 'PIN' | 'HIDE'
  position: number | null
  isActive: boolean
  expiresAt: Date | null
}
type Quota = {
  shown: number
  pinned: number
  eligible: number
  freshEligible: number
  slots: number
  deficit: number
  reasons: string[]
  allocationDefect: boolean
}
type Seat = { posts: Post[]; pinned: Post[]; rest: Post[]; slots: number }

/** 검사 대상 — popularity.ts · home-exposure-rules.ts 의 export 와 같은 모양 */
export type QuotaModule = {
  popularityScore: (p: Post, now: Date) => number
  isWithinFreshWindow: (p: { createdAt: Date }, freshHours: number, now: Date) => boolean
  fillMenopauseMinimum: (
    rest: readonly Post[],
    ctx: { slots: number; pinned: readonly { boardType: BoardType }[]; minimum: number; freshHours: number; now: Date },
  ) => Post[]
  diagnoseMenopauseQuota: (seat: Seat, ctx: { minimum: number; freshHours: number; now: Date }) => Quota
  applyHomeExposure: (a: {
    candidates: readonly Post[]
    pinnedPosts?: readonly Post[]
    overrides: readonly Override[]
    take: number
    now?: Date
    fill?: (rest: readonly Post[], ctx: { slots: number; pinned: readonly Post[] }) => readonly Post[]
  }) => Seat
  orderPinOverrides: (a: Pick<Override, 'position' | 'createdAt' | 'id'>, b: Pick<Override, 'position' | 'createdAt' | 'id'>) => number
}

/** 사례 상수 — 정본 상수(home-exposure.ts)와 같은 값이어야 한다. check:home-popularity 가 둘을 대조한다 */
export const CASE_TAKE = 20
export const CASE_MIN = 7
export const CASE_FRESH_HOURS = 14 * 24

const NOW = new Date('2026-11-16T03:00:00Z')
const H = 3_600_000
const post = (id: string, ageH: number, real: number, boardType: BoardType): Post => ({
  id,
  boardType,
  createdAt: new Date(NOW.getTime() - ageH * H),
  realReactions: real,
})
let rowSeq = 0
const pin = (postId: string, position: number | null, extra: Partial<Override> = {}): Override => ({
  id: `row-${String((rowSeq += 1)).padStart(4, '0')}`,
  createdAt: new Date(NOW.getTime() - 10 * H),
  postId,
  action: 'PIN',
  position,
  isActive: true,
  expiresAt: null,
  ...extra,
})
const hide = (postId: string, extra: Partial<Override> = {}): Override => ({
  id: `row-${String((rowSeq += 1)).padStart(4, '0')}`,
  createdAt: new Date(NOW.getTime() - 10 * H),
  postId,
  action: 'HIDE',
  position: null,
  isActive: true,
  expiresAt: null,
  ...extra,
})
const ids = (l: readonly { id: string }[]) => l.map((p) => p.id)
const isM = (p: Post) => p.boardType === 'MENOPAUSE'
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** 신선 자유 n편 — 실반응 1, 1~n 시간 전 */
const freshFree = (n: number, prefix = 'f') => range(n).map((i) => post(`${prefix}${String(i).padStart(2, '0')}`, 1 + i, 1, 'FREE'))
/** 26일 넘은 갱년기톡 n편 — 실반응 0 */
const staleMeno = (n: number, prefix = 'old') => range(n).map((i) => post(`${prefix}${String(i).padStart(2, '0')}`, 26 * 24 + i, 0, 'MENOPAUSE'))
/** 신선하지만 점수가 낮은 갱년기톡 n편 — 100~ 시간 전, 실반응 0 */
const freshLowMeno = (n: number, prefix = 'fm') => range(n).map((i) => post(`${prefix}${String(i).padStart(2, '0')}`, 100 + i, 0, 'MENOPAUSE'))

/**
 * 사례 번호는 설계서(01-FINAL §6-1) 와 같다. T-P10(매거진 격리) · T-P14(하나의 now · 만료 경계)는 편성 함수
 * composeHomePopularViews 수준이라 여기(주입받는 순수 함수)에 없고 check:home-popularity ⑥ 이 실제 편성으로 본다.
 */
export function runQuotaCases(mod: QuotaModule): string[] {
  const failures: string[] = []
  const check = (label: string, ok: boolean) => {
    if (!ok) failures.push(label)
  }
  const mobile = (candidates: Post[], overrides: Override[] = [], pinnedPosts: Post[] = []) => {
    const seat = mod.applyHomeExposure({
      candidates,
      pinnedPosts,
      overrides,
      take: CASE_TAKE,
      now: NOW,
      fill: (rest, { slots, pinned }) =>
        mod.fillMenopauseMinimum(rest, { slots, pinned, minimum: CASE_MIN, freshHours: CASE_FRESH_HOURS, now: NOW }),
    })
    const quota = mod.diagnoseMenopauseQuota(seat, { minimum: CASE_MIN, freshHours: CASE_FRESH_HOURS, now: NOW })
    return { seat, quota, m: seat.posts.filter(isM) }
  }
  const scoreOrder = (l: readonly Post[]) => {
    const s = l.map((p) => mod.popularityScore(p, NOW))
    return s.every((v, i) => i === 0 || s[i - 1] >= v)
  }

  // T-P1 — 오래된 갱년기톡만 있으면 끼워 넣지 않는다 · 원인 = 신선한 갱년기톡 부족
  {
    const r = mobile([...freshFree(60), ...staleMeno(12)])
    check('T-P1 오래된 갱년기톡만 → 0편', r.m.length === 0 && r.seat.posts.length === 20)
    check('T-P1 원인 fresh-short 하나', JSON.stringify(r.quota.reasons) === '["fresh-short"]')
    check('T-P1 배분 결함 아님', r.quota.allocationDefect === false)
  }
  // T-P2 — 신선 3 + 오래된 12 → 3편 · 맨 아래 3칸
  {
    const r = mobile([...freshFree(60), ...freshLowMeno(3), ...staleMeno(12)])
    check('T-P2 신선 3 → 3편', r.m.length === 3)
    check('T-P2 보장분은 자기 점수 자리(18~20위)', ids(r.seat.posts).slice(17).every((id) => id.startsWith('fm')))
    check('T-P2 원인 fresh-short', JSON.stringify(r.quota.reasons) === '["fresh-short"]')
  }
  // T-P3 — 신선 10 + 오래된 12 → 7편, 전부 신선 · 남은 자유 = 자유 점수 상위 13
  {
    const free = freshFree(60)
    const r = mobile([...free, ...freshLowMeno(10), ...staleMeno(12)])
    check('T-P3 최소 7', r.m.length === 7)
    check('T-P3 보장분 전부 신선(신선 점수 상위 7)', JSON.stringify(ids(r.m).sort()) === JSON.stringify(ids(freshLowMeno(7)).sort()))
    check('T-P3 남은 자유 = 자유 점수 상위 13', JSON.stringify(ids(r.seat.posts.filter((p) => !isM(p)))) === JSON.stringify(ids(free.slice(0, 13))))
    check('T-P3 부족 0', r.quota.deficit === 0 && r.quota.reasons.length === 0 && !r.quota.allocationDefect)
  }
  // T-P4 — 경계: 336시간 정각은 신선 · 1ms 넘으면 아니다
  {
    const edge = { ...post('edge', 0, 0, 'MENOPAUSE'), createdAt: new Date(NOW.getTime() - CASE_FRESH_HOURS * H) }
    const over = { ...post('over', 0, 0, 'MENOPAUSE'), createdAt: new Date(NOW.getTime() - CASE_FRESH_HOURS * H - 1) }
    const r = mobile([...freshFree(60), edge, over])
    check('T-P4 336h 정각 글은 실린다', ids(r.seat.posts).includes('edge'))
    check('T-P4 336h+1ms 글은 안 실린다', !ids(r.seat.posts).includes('over'))
    check('T-P4 isWithinFreshWindow 경계 포함', mod.isWithinFreshWindow(edge, CASE_FRESH_HOURS, NOW) && !mod.isWithinFreshWindow(over, CASE_FRESH_HOURS, NOW))
  }
  // T-P5 — 점수로 1위인 오래된 갱년기톡은 막지 않고 7 에 센다
  {
    const viral = post('viral', 20 * 24, 400, 'MENOPAUSE')
    const r = mobile([...freshFree(60), viral, ...freshLowMeno(10)])
    check('T-P5 오래된 고반응 글 1위 유지', ids(r.seat.posts)[0] === 'viral')
    check('T-P5 합 7 (보장 6)', r.m.length === 7 && r.m.filter((p) => p.id.startsWith('fm')).length === 6)
  }
  // T-P6 — 고정 갱년기톡(오래돼도)은 7 에 포함 · 9 가 아니다
  {
    const p1 = post('pin-old-1', 700, 0, 'MENOPAUSE')
    const p2 = post('pin-old-2', 701, 0, 'MENOPAUSE')
    const r = mobile([...freshFree(60), ...freshLowMeno(10)], [pin('pin-old-1', 0), pin('pin-old-2', 1)], [p1, p2])
    check('T-P6 PIN 이 1·2위', JSON.stringify(ids(r.seat.posts).slice(0, 2)) === '["pin-old-1","pin-old-2"]')
    check('T-P6 합 7 (고정 2 + 보장 5)', r.m.length === 7 && r.quota.pinned === 2)
  }
  // T-P7 — 자유 PIN 15 → 남은 자리 5 → 5편 · 원인 slots-short
  {
    const free = freshFree(60)
    const pins = free.slice(40, 55).map((p, i) => pin(p.id, i))
    const r = mobile([...free, ...freshLowMeno(10)], pins, free.slice(40, 55))
    check('T-P7 남은 자리 5 를 전부 갱년기톡으로', r.m.length === 5 && r.quota.slots === 5)
    check('T-P7 원인 slots-short 하나', JSON.stringify(r.quota.reasons) === '["slots-short"]')
  }
  // T-P8 — 노출 가능 4, 그중 1 HIDE → 3편 · 원인 eligible-short · 숨긴 글 0
  {
    const meno = freshLowMeno(4)
    const r = mobile([...freshFree(60), ...meno], [hide(meno[0].id)])
    check('T-P8 3편', r.m.length === 3)
    check('T-P8 숨긴 글 0', !ids(r.seat.posts).includes(meno[0].id))
    check('T-P8 원인 eligible-short 하나', JSON.stringify(r.quota.reasons) === '["eligible-short"]')
  }
  // T-P9 — 자연 점수로 이미 7 이상이면 순수 점수순 그대로
  {
    const meno = range(10).map((i) => post(`hot${i}`, 1 + i * 0.1, 5, 'MENOPAUSE'))
    const rest = [...freshFree(60), ...meno]
    const got = mod.fillMenopauseMinimum(rest, { slots: 20, pinned: [], minimum: CASE_MIN, freshHours: CASE_FRESH_HOURS, now: NOW })
    const pure = [...rest]
      .sort((a, b) => mod.popularityScore(b, NOW) - mod.popularityScore(a, NOW) || b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, 20)
    check('T-P9 이미 7 이상 → 순수 점수순 상위 20 과 같다', JSON.stringify(ids(got)) === JSON.stringify(ids(pure)))
  }
  // T-P11 — 자유 상위 25 HIDE 여도 20 을 채운다(헤드룸 없음)
  {
    const free = range(40).map((i) => post(`h${String(i).padStart(2, '0')}`, 1 + i * 0.1, 5, 'FREE'))
    const r = mobile([...free, ...freshLowMeno(10)], free.slice(0, 25).map((p) => hide(p.id)))
    check('T-P11 HIDE 25 뒤에도 20', r.seat.posts.length === 20)
    check('T-P11 숨긴 글 0', !r.seat.posts.some((p) => free.slice(0, 25).some((q) => q.id === p.id)))
  }
  // T-P12 — 같은 시각·같은 실반응 3편: 입력 순서와 무관하게 id 내림차순
  {
    const base = new Date(NOW.getTime() - 5 * H)
    const trio = ['a', 'b', 'c'].map((id) => ({ id, boardType: 'FREE' as BoardType, createdAt: base, realReactions: 2 }))
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    const outs = new Set(perms.map((p) => JSON.stringify(ids(mod.fillMenopauseMinimum(p.map((i) => trio[i]), { slots: 3, pinned: [], minimum: 0, freshHours: CASE_FRESH_HOURS, now: NOW })))))
    check('T-P12 출력 하나', outs.size === 1)
    check('T-P12 id 내림차순', [...outs][0] === '["c","b","a"]')
  }
  // T-P13 — 같은 position PIN 두 행: 행 순서를 뒤집어도 같은 출력(먼저 고정한 글이 앞)
  {
    const a = post('pa', 3, 0, 'FREE')
    const b = post('pb', 4, 0, 'FREE')
    const ra = pin('pa', 1, { id: 'row-a', createdAt: new Date(NOW.getTime() - 5 * H) })
    const rb = pin('pb', 1, { id: 'row-b', createdAt: new Date(NOW.getTime() - 2 * H) })
    const one = mobile([a, b], [ra, rb], [a, b])
    const two = mobile([a, b], [rb, ra], [a, b])
    check('T-P13 행 순서 무관', JSON.stringify(ids(one.seat.posts)) === JSON.stringify(ids(two.seat.posts)))
    check('T-P13 먼저 고정한 글이 앞', ids(one.seat.posts)[0] === 'pa')
    const tie = pin('x', 1, { id: 'row-z', createdAt: ra.createdAt })
    check('T-P13 시각까지 같으면 행 id 오름차순', mod.orderPinOverrides(ra, tie) < 0 && mod.orderPinOverrides(tie, ra) > 0)
    check('T-P13 position 없는 행은 맨 뒤', mod.orderPinOverrides(pin('y', null), pin('z', 99)) > 0)
  }
  // T-P16 — fill 이 엉뚱한 글을 돌려줘도 규칙 함수가 거른다
  {
    const free = freshFree(10)
    const hidden = free[0]
    const pinned = free[1]
    const outside = post('outside', 1, 9, 'FREE')
    const seat = mod.applyHomeExposure({
      candidates: free,
      pinnedPosts: [pinned],
      overrides: [hide(hidden.id), pin(pinned.id, 0)],
      take: 5,
      now: NOW,
      fill: () => [hidden, outside, pinned, free[2], free[2], free[3], free[4], free[5], free[6], free[7]],
    })
    check('T-P16 HIDE·후보 밖·PIN·중복 거름 · 자리 수만큼', JSON.stringify(ids(seat.posts)) === JSON.stringify([pinned.id, free[2].id, free[3].id, free[4].id, free[5].id]))
    check('T-P16 slots·rest', seat.slots === 4 && !ids(seat.rest).includes(hidden.id) && !ids(seat.rest).includes(pinned.id))
  }
  // T-P17 — 진단은 같은 글을 두 번 세지 않는다(고정 글이 자동 후보에도 들어온 입력)
  {
    const m1 = post('dup-m1', 3, 0, 'MENOPAUSE')
    const m2 = post('dup-m2', 4, 0, 'MENOPAUSE')
    const q = mod.diagnoseMenopauseQuota({ posts: [m1, m2], pinned: [m1], rest: [m1, m2, m2], slots: 19 }, { minimum: CASE_MIN, freshHours: CASE_FRESH_HOURS, now: NOW })
    check('T-P17 노출 가능 = 고유 글 수(2)', q.eligible === 2 && q.pinned === 1 && q.freshEligible === 1)
  }
  // T-P15 — 무작위 1000회 불변식 (seed 고정)
  {
    let seed = 20261116
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const int = (n: number) => Math.floor(rnd() * n)
    const broken: string[] = []
    for (let run = 0; run < 1000 && broken.length < 3; run += 1) {
      const mk = (board: BoardType, n: number) =>
        range(n).map((i) => post(`${board[0]}${run}-${i}`, rnd() * 900, int(4) === 0 ? int(9) : 0, board))
      const pool = [...mk('MENOPAUSE', int(30)), ...mk('FREE', int(40))]
      const overrides: Override[] = []
      for (let k = int(6); k > 0 && pool.length; k -= 1) {
        const t = pool[int(pool.length)]
        overrides.push(int(3) === 0 ? hide(t.id) : pin(t.id, int(4) === 0 ? null : int(5)))
      }
      const pinIds = new Set(overrides.filter((o) => o.action === 'PIN').map((o) => o.postId))
      const r = mobile(pool, overrides, pool.filter((p) => pinIds.has(p.id)))
      const hidden = new Set(overrides.filter((o) => o.action === 'HIDE').map((o) => o.postId))
      const out = r.seat.posts
      const auto = out.slice(r.seat.pinned.length)
      const natural = new Set(
        ids(
          [...r.seat.rest]
            .sort((a, b) => mod.popularityScore(b, NOW) - mod.popularityScore(a, NOW) || b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
            .slice(0, r.seat.slots),
        ),
      )
      if (out.length !== Math.min(CASE_TAKE, r.seat.pinned.length + r.seat.rest.length)) broken.push(`run${run} 길이`)
      if (new Set(ids(out)).size !== out.length) broken.push(`run${run} 중복`)
      if (out.some((p) => hidden.has(p.id))) broken.push(`run${run} HIDE 노출`)
      if (JSON.stringify(ids(out.slice(0, r.seat.pinned.length))) !== JSON.stringify(ids(r.seat.pinned))) broken.push(`run${run} PIN 접두`)
      if (!scoreOrder(auto)) broken.push(`run${run} 자동부 점수순`)
      if (auto.some((p) => isM(p) && !natural.has(p.id) && !mod.isWithinFreshWindow(p, CASE_FRESH_HOURS, NOW))) broken.push(`run${run} 오래된 보장분`)
      if (r.quota.deficit > 0 && r.quota.reasons.length === 0) broken.push(`run${run} 원인 없는 부족`)
      if (r.quota.allocationDefect) broken.push(`run${run} 배분 결함`)
    }
    check(`T-P15 무작위 불변식${broken.length ? ` (${broken.join(', ')})` : ''}`, broken.length === 0)
  }
  return failures
}

/**
 * 로더 정적 점검 — home-popular-views.ts 원문을 받아 문제 목록을 돌려준다(주석을 지우고 본다).
 * 🔴 check:visibility 1-d 와 겹치는 항목이 있다. 그쪽은 CI 의 가드이고, 이쪽은 변이 하네스가 문자열 변이를 판정하는 기준이다.
 */
export function loaderProblems(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const start = code.indexOf('export async function loadHomePopularInputs')
  const end = code.indexOf('export type HomePopularViews')
  const loader = start >= 0 && end > start ? code.slice(start, end) : ''
  const count = (needle: string) => loader.split(needle).length - 1
  const problems: string[] = []
  if (loader === '') problems.push('로더를 찾지 못했다')
  if (count('...DISCOVERY_ELIGIBLE_WHERE') < 2) problems.push('discovery 조건 2곳 미만')
  if (count('AND: [EXCLUDE_GREETING]') < 2) problems.push('가입인사 제외 2곳 미만')
  if (!/\{\s*id:\s*['"]desc['"]\s*\}/.test(loader)) problems.push('후보 정렬에 id 2차 키 없음')
  if (/HEADROOM/.test(code)) problems.push('HEADROOM 이 남아 있다')
  return problems
}
