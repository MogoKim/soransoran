#!/usr/bin/env tsx
/**
 * /best 순위 식 — 순수 검사 · 트래픽 시뮬레이션 · 계수 비교표.
 *
 * 식·계수는 src/lib/best-ranking.ts 한 곳이다. 여기 숫자를 다시 적지 않는다 —
 * 기대값은 "성질"(어느 쪽이 위인가)과 "제품 기준"(아래 C1~C4)으로 쓴다.
 * 계수를 바꾸면 이 파일이 성질·기준이 깨졌는지 알려 준다.
 *
 * DB 가 필요한 계약(무엇을 실반응으로 세는가 · 조회수 무시 · 트랜잭션 · 동시성 · 목록/개수)은
 * `npm run best:db-check`(격리 DB 전용)가 본다.
 */
import {
  BEST_CURRENT_SIZE,
  GUEST_COMMENT_CAP,
  REACTION_BOOST_MAX_HOURS,
  REACTION_HOURS_PER_DOUBLING,
  bestRankScore,
  hasValidReaction,
  reactionBoostSeconds,
  reactionBoostSecondsWith,
  reactionWeight,
  type RealReactions,
} from '../src/lib/best-ranking'
import { BEST_PAGE_SIZE, bestLastPage, buildListHref, parsePageParam } from '../src/lib/list-query'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${!ok && detail ? ` — ${detail}` : ''}`)
}

const H = 3600_000
const NOW = new Date('2026-10-01T12:00:00Z').getTime()
const NONE: RealReactions = { likes: 0, memberCommenters: 0, guestComments: 0 }

type Fx = { id: string; label: string; ageH: number; r: RealReactions }
function score(fx: Fx): number {
  return bestRankScore({ createdAt: new Date(NOW - fx.ageH * H), weight: reactionWeight(fx.r) })
}
/** best-ranking-db.ts BEST_RANK_ORDER 와 같은 순서 — 점수 내림차순, 같으면 id 내림차순 */
function rank<T extends Fx>(list: T[]): T[] {
  return [...list].sort((a, b) => score(b) - score(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}
const above = (a: Fx, b: Fx) => rank([a, b])[0] === a
const fx = (id: string, ageH: number, r = NONE): Fx => ({ id, label: id, ageH, r })
const hours = (w: number) => reactionBoostSeconds(w) / 3600

console.log('\n■ 1. 여섯 글 비교 (지금 시각 기준)')
const six: Fx[] = [
  { id: 'a', label: '반응 0 · 1시간 전 새 글', ageH: 1, r: NONE },
  { id: 'b', label: '공감 1 · 12시간 전', ageH: 12, r: { ...NONE, likes: 1 } },
  { id: 'c', label: '댓글 단 실회원 2명 · 2일 전', ageH: 48, r: { ...NONE, memberCommenters: 2 } },
  { id: 'd', label: '조회만 10만 · 1일 전 (조회는 입력이 아니다)', ageH: 24, r: NONE },
  { id: 'e', label: 'Persona 댓글 10개만 · 6시간 전 (실반응 0)', ageH: 6, r: NONE },
  { id: 'f', label: '과거 인기(공감 30·실회원 20명) · 10일 전', ageH: 240, r: { likes: 30, memberCommenters: 20, guestComments: 0 } },
]
console.log('  | 순위 | 글 | 실반응 W | 반응 기여 | 기록 자격 |')
rank(six).forEach((f, i) => {
  const w = reactionWeight(f.r)
  console.log(`  | ${i + 1} | ${f.label} | ${w} | +${hours(w).toFixed(1)}h | ${hasValidReaction(w) ? '있음' : '없음'} |`)
})

console.log('\n■ 2. 반드시 성립해야 하는 결과')
check('반응이 모두 0 이면 최신 글 순', rank([fx('o', 30), fx('n', 1), fx('m', 7)]).map((f) => f.id).join('') === 'nmo')
check(`공감 1건의 기여 = ${REACTION_HOURS_PER_DOUBLING}시간`, hours(reactionWeight({ ...NONE, likes: 1 })) === REACTION_HOURS_PER_DOUBLING)
check(
  '실회원 댓글 작성자 1명의 기여 = 공감 1건보다 크고 하루보다 작다',
  hours(reactionWeight({ ...NONE, memberCommenters: 1 })) > REACTION_HOURS_PER_DOUBLING &&
    hours(reactionWeight({ ...NONE, memberCommenters: 1 })) < 24,
)
check('Persona 댓글 10건의 기여 = 0 (실반응 입력이 0 이다)', score(six[4]) === score(fx('e2', 6)))
check('조회수 10만의 기여 = 0 — 식에 조회 입력이 없다', score(six[3]) === score(fx('d2', 24)))
check('실반응 0 이면 기록 자격 없음', !hasValidReaction(reactionWeight(NONE)))
check('같은 시기면 공감 있는 글이 먼저', above(fx('l', 5, { ...NONE, likes: 1 }), fx('z', 5)))
check('같은 시기면 댓글 있는 글이 먼저', above(fx('c', 5, { ...NONE, memberCommenters: 1 }), fx('z', 5)))
check(`반응 기여는 최대 ${REACTION_BOOST_MAX_HOURS}시간`, hours(1e9) === REACTION_BOOST_MAX_HOURS)
const legend = fx('legend', 0, { likes: 10_000, memberCommenters: 10_000, guestComments: 10_000 })
check(
  `새 글이 계속 생기면 과거 인기 글이 내려간다 — ${REACTION_BOOST_MAX_HOURS}h 넘게 늦게 올라온 반응 0 글이 위`,
  above(fx('late', 0), { ...legend, ageH: REACTION_BOOST_MAX_HOURS + 0.01 }),
)
check(
  '새 글·새 반응이 없으면 순서 불변 — 식에 "지금" 이 없어 입력 순서와 무관하게 같다',
  rank(six).map((f) => f.id).join() === rank([...six].reverse()).map((f) => f.id).join(),
)
check('같은 입력은 같은 키', score(six[2]) === score({ ...six[2] }))
check('키가 같으면 id 가 큰 쪽이 위 (DB orderBy 와 같은 동점 규칙)', rank([fx('p1', 3), fx('p2', 3)])[0].id === 'p2')

console.log('\n■ 3. 극단값')
const extremes = [NaN, Infinity, -Infinity, -5, 1e308, Number.MAX_SAFE_INTEGER, 2.7]
check(
  'NaN·Infinity·음수·1e308·소수 입력에서도 가중치·키가 유한하고 음수가 아니다',
  extremes.every((x) => {
    const w = reactionWeight({ likes: x, memberCommenters: x, guestComments: x })
    const s = bestRankScore({ createdAt: new Date(NOW), weight: x })
    return Number.isFinite(w) && w >= 0 && Number.isFinite(s) && s >= NOW / 1000
  }),
)
check('잘못된 날짜도 NaN 이 되지 않는다', Number.isFinite(bestRankScore({ createdAt: new Date('x'), weight: 1 })))
check(
  `비회원 댓글은 ${GUEST_COMMENT_CAP}건에서 멈춘다`,
  reactionWeight({ ...NONE, guestComments: 1_000 }) === reactionWeight({ ...NONE, guestComments: GUEST_COMMENT_CAP }),
)

console.log('\n■ 4. 쪽')
check('1쪽 = 현재 베스트 12개 = BEST_PAGE_SIZE', BEST_PAGE_SIZE === 12 && BEST_CURRENT_SIZE === BEST_PAGE_SIZE)
check('기록 0건이면 마지막 쪽은 1 (빈 2쪽이 없다)', bestLastPage(0) === 1)
check('기록 1·12·13건 → 마지막 쪽 2·2·3', [bestLastPage(1), bestLastPage(12), bestLastPage(13)].join() === '2,2,3')
check('이상한 개수(NaN·음수)도 1쪽', bestLastPage(NaN) === 1 && bestLastPage(-3) === 1)
const odd = ['0', '-1', '3.9', 'abc', '7abc', ' 7 ', '', undefined, ['2', '5']]
check(
  '0·음수·소수·문자 섞임은 1쪽, 배열은 첫 값 (게시판과 같은 정규화)',
  odd.map((v) => parsePageParam(v as string | string[] | undefined)).join(',') === '1,1,1,1,1,1,1,1,2',
)
check('거대한 page 는 안전 정수로 눌려 마지막 쪽보다 크다 → 404', parsePageParam('999999999999999999999999') > bestLastPage(1e6))
check("1쪽 주소는 '/best' — ?page=1 을 만들지 않는다", buildListHref('/best', { page: 1 }) === '/best')
check("2쪽 주소는 '/best?page=2'", buildListHref('/best', { page: 2 }) === '/best?page=2')

// ── 시뮬레이션 ─────────────────────────────────────────────────────
function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
type Boost = (w: number) => number
type SimPost = { id: string; createdH: number; w: number }
/** 발행마다 12개를 다시 보고, 실반응이 있는 12위 안 글을 기록한다(쓰기 경로와 같은 판정) */
function simulate(perDay: number, reactProb: number, maxReactions: number, boost: Boost, days = 14) {
  const rnd = lcg(7)
  const total = perDay * days
  const posts: SimPost[] = []
  const recorded = new Set<string>()
  const seen = new Set<string>()
  let top: SimPost[] = []
  const key = (p: SimPost) => p.createdH * 3600 + boost(p.w)
  for (let i = 0; i < total; i += 1) {
    const n = rnd() < reactProb ? 1 + Math.floor(rnd() * maxReactions) : 0
    const r: RealReactions = { likes: Math.ceil(n * 0.6), memberCommenters: Math.floor(n * 0.4), guestComments: 0 }
    posts.push({ id: `p${String(i).padStart(6, '0')}`, createdH: (i * 24) / perDay, w: reactionWeight(r) })
    top = [...posts].sort((a, b) => key(b) - key(a) || (a.id < b.id ? 1 : -1)).slice(0, BEST_CURRENT_SIZE)
    for (const t of top) {
      seen.add(t.id)
      if (hasValidReaction(t.w)) recorded.add(t.id)
    }
  }
  const endH = ((total - 1) * 24) / perDay
  return {
    reactedPct: Math.round((posts.filter((p) => hasValidReaction(p.w)).length / total) * 100),
    everInTopPct: Math.round((seen.size / total) * 100),
    recordedPct: Math.round((recorded.size / total) * 100),
    reactedInTop: top.filter((t) => hasValidReaction(t.w)).length,
    oldestH: Math.round(Math.max(...top.map((t) => endH - t.createdH))),
  }
}
const TRAFFIC = [
  { name: '저트래픽', perDay: 3, p: 0.1, max: 3 },
  { name: '중간', perDay: 30, p: 0.25, max: 10 },
  { name: '고트래픽', perDay: 100, p: 0.4, max: 60 },
]

console.log('\n■ 5. 트래픽별 시뮬레이션 — 확정 계수 (결정적 난수 · 14일)')
console.log('  | 상황 | 하루 글 | 반응 받는 글 | 12위 안에 한 번이라도 | 과거 기록 | 끝 시점 12개 중 실반응 글 | 12개 중 가장 오래된 글 |')
const sim = TRAFFIC.map((s) => ({ s, r: simulate(s.perDay, s.p, s.max, reactionBoostSeconds) }))
for (const { s, r } of sim) {
  console.log(`  | ${s.name} | ${s.perDay} | ${r.reactedPct}% | ${r.everInTopPct}% | ${r.recordedPct}% | ${r.reactedInTop}/12 | ${r.oldestH}시간 |`)
}
check('과거 기록은 실제로 반응 받은 글 비율을 넘지 않는다 (반응 0 글은 12위에 들어도 기록되지 않는다)', sim.every(({ r }) => r.recordedPct <= r.reactedPct))
check('저트래픽: 12위 안에 드는 글은 100% 지만 기록은 반응 받은 글만', sim[0].r.everInTopPct === 100 && sim[0].r.recordedPct <= sim[0].r.reactedPct)
check('고트래픽: 12개 대부분이 실반응 글 (인기 글 목록이 된다)', sim[2].r.reactedInTop >= 8)

console.log('\n■ 6. 계수 비교 — 왜 8시간·72시간인가')
console.log('  제품 기준')
console.log('   C1 저트래픽(하루 3건 = 8시간 간격)에서 첫 실반응 하나가 적어도 한 칸 올린다   → 공감 1 기여 ≥ 8h')
console.log('   C2 반응 하나가 하루 넘게 새 글을 덮지 않는다                                   → 공감 1·댓글 1명 기여 < 24h')
console.log('   C3 고트래픽(하루 100건)에서 12개 안의 가장 오래된 글이 나흘을 넘지 않는다      → 고착 없음')
console.log('   C4 인기 글끼리 W=255(예: 공감 100 + 실회원 78명)까지는 구분된다               → 상한에 닿는 W ≥ 255')
console.log('  | 두 배당 | 상한 | 공감1 | 댓글1명 | 상한에 닿는 W | 고트래픽 최고령 | C1 | C2 | C3 | C4 |')
const PERS = [4, 6, 8, 12, 16]
const CAPS = [48, 72, 96]
const ok = new Map<string, boolean>()
for (const per of PERS) {
  for (const cap of CAPS) {
    const b: Boost = (w) => reactionBoostSecondsWith(w, per, cap)
    const like1 = b(1) / 3600
    const c1 = b(2) / 3600
    const wStar = Math.round(2 ** (cap / per) - 1)
    const hi = simulate(100, 0.4, 60, b, 7)
    const pass4 = [like1 >= 8, like1 < 24 && c1 < 24, hi.oldestH <= 96, wStar >= 255]
    ok.set(`${per}/${cap}`, pass4.every(Boolean))
    console.log(
      `  | ${per}h | ${cap}h | ${like1.toFixed(1)}h | ${c1.toFixed(1)}h | ${wStar} | ${hi.oldestH}h | ${pass4.map((x) => (x ? '✓' : '✗')).join(' | ')} |`,
    )
  }
}
const passing = [...ok.entries()].filter(([, v]) => v).map(([k]) => k)
console.log(`  네 기준을 모두 지나는 조합: ${passing.join(' · ')}`)
const chosen = `${REACTION_HOURS_PER_DOUBLING}/${REACTION_BOOST_MAX_HOURS}`
check(`확정 계수 ${chosen} 는 네 기준을 모두 지난다`, ok.get(chosen) === true)
const minPer = Math.min(...passing.map((k) => Number(k.split('/')[0])))
check('두 배당 시간은 기준을 지나는 값 중 가장 작다 (반응이 순위를 붙드는 시간을 최소로)', REACTION_HOURS_PER_DOUBLING === minPer)
const capsAtPer = passing.filter((k) => Number(k.split('/')[0]) === REACTION_HOURS_PER_DOUBLING).map((k) => Number(k.split('/')[1]))
check('상한은 그 두 배당 시간에서 기준을 지나는 값 중 가장 작다 (가장 빨리 내려간다)', REACTION_BOOST_MAX_HOURS === Math.min(...capsAtPer))

console.log('\n■ 7. 기록 연결 — 쓰기 경로는 syncBestRanking 하나로 순위와 기록을 함께 본다 (PR-B)')
{
  // 🔴 사건마다 전역 12개를 다시 보는 것이 기록 계약이다(best-ranking-db.ts 머리 주석).
  //    한 경로라도 재계산만 부르면 "점수는 올랐는데 12위 진입이 기록되지 않는" 구멍이 생기고,
  //    기록 판정만 따로 부르면 재계산 전의 12개를 기록한다. 그래서 호출을 **센다**.
  const files: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n)
      if (statSync(f).isDirectory()) walk(f)
      else if (/\.(ts|tsx)$/.test(n)) files.push(f)
    }
  }
  walk('src')
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const code = (f: string) => strip(readFileSync(f, 'utf-8'))
  const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

  /** 사건 → 파일 · 그 파일에서 tx 로 부르는 syncBestRanking 수 */
  const WRITERS: { file: string; events: string; calls: number }[] = [
    { file: 'src/lib/actions/likes.ts', events: '회원 공감 추가·취소', calls: 1 },
    { file: 'src/lib/actions/comments.ts', events: '회원 댓글 작성', calls: 1 },
    { file: 'src/lib/actions/guest-comments.ts', events: '비회원 댓글 작성·삭제', calls: 2 },
    { file: 'src/lib/actions/delete.ts', events: '회원 글 삭제 · 회원 댓글 삭제', calls: 2 },
    { file: 'src/lib/actions/admin.ts', events: '어드민 글 숨김·복구 · 댓글 숨김·복구', calls: 2 },
    { file: 'src/lib/operator-compose-tx.ts', events: '운영 글 숨김', calls: 1 },
  ]
  for (const w of WRITERS) {
    const c = code(w.file)
    const viaTx = count(c, /\bsyncBestRanking\(\s*tx\b/g)
    const any = count(c, /\bsyncBestRanking\(/g)
    check(`${w.events}: syncBestRanking(tx, …) ${w.calls}곳 · 트랜잭션 밖 호출 0`, viaTx === w.calls && any === w.calls, `tx ${viaTx} · 전체 ${any}`)
  }
  const admin = code('src/lib/actions/admin.ts')
  check('회원 차단·해제: applyMemberBlock 을 트랜잭션 안에서 부른다',
    /\$transaction\(\s*\(tx\)\s*=>\s*applyMemberBlock\(\s*tx\b/.test(admin))

  const outside = files.filter((f) => !f.endsWith('best-ranking-db.ts'))
  const directRecompute = outside.filter((f) => /\brecomputePostRanking\s*\(/.test(code(f)))
  check('src/ 의 쓰기 경로가 재계산(recomputePostRanking)만 따로 부르지 않는다', directRecompute.length === 0, directRecompute.join(', '))
  const directRecord = outside.filter((f) => /\brecordBestEntries\s*\(/.test(code(f)))
  check('src/ 의 쓰기 경로가 기록 판정(recordBestEntries)을 직접 부르지 않는다', directRecord.length === 0, directRecord.join(', '))
  const syncCallers = outside.filter((f) => /\bsyncBestRanking\s*\(/.test(code(f))).sort()
  check('syncBestRanking 을 부르는 파일 = 위 사건 목록 그대로 (새 호출부는 목록에 먼저 올린다)',
    syncCallers.join() === WRITERS.map((w) => w.file).sort().join(), syncCallers.join(', '))

  const db = code('src/lib/best-ranking-db.ts')
  const body = (name: string) => {
    const at = db.indexOf(`export async function ${name}(`)
    const next = db.indexOf('\nexport ', at + 1)
    return at < 0 ? '' : db.slice(at, next < 0 ? undefined : next)
  }
  const sync = body('syncBestRanking')
  check('syncBestRanking: 재계산 뒤에 기록 판정 (순서 · 각 1회)',
    count(sync, /\brecomputePostRanking\(/g) === 1 && count(sync, /\brecordBestEntries\(/g) === 1 &&
      sync.indexOf('recomputePostRanking(') < sync.indexOf('recordBestEntries('))
  const block = body('applyMemberBlock')
  const loopAt = block.search(/for \(const postId of postIds\)/)
  const recordAt = block.indexOf('recordBestEntries(')
  check('applyMemberBlock: 영향 글은 재계산만 · 기록 판정은 모든 재계산 뒤 정확히 1회',
    loopAt >= 0 && count(block, /\brecordBestEntries\(/g) === 1 && count(block, /\bsyncBestRanking\(/g) === 0 &&
      recordAt > loopAt && !/for \(const postId of postIds\)[^\n]*recordBestEntries/.test(block))
  check('best-ranking-db.ts 의 기록 판정 호출 = 정의 1 + sync 1 + 차단 1 + backfill 1',
    count(db, /\brecordBestEntries\s*\(/g) === 4)
  check('예전 이름 refreshBestRanking 이 남아 있지 않다', !/\brefreshBestRanking\b/.test(files.map(code).join('\n')))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} best-ranking-check: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
