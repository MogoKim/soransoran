#!/usr/bin/env tsx
/**
 * 홈 노출 예외 규칙 회귀 테스트.
 *
 * 🔴 DB 를 켜지 않는다. home-exposure-rules 는 순수 함수라 표본만으로 확인된다.
 *    켜야 확인되는 테스트는 아무도 돌리지 않는다.
 *
 * 🔴 규칙을 여기에 다시 적지 않는다 — 원본을 그대로 import 한다.
 *    복사본은 반드시 원본과 어긋난다.
 *
 * 이 테스트가 지키는 것
 *   ① PIN 이 자동 순서를 이긴다
 *   ② HIDE 가 PIN 을 이긴다 (부딪히면 안 보이는 쪽이 안전하다)
 *   ③ 자동 후보 **밖**의 글도 PIN 하면 맨 앞에 나온다 (pinnedPosts 로 넘어온 경우)
 *   ④ 그러나 discovery 조건을 못 지난 글은 어느 목록에도 없어 나가지 않는다
 *      — HIDDEN · Micro Seed · indexPromotionBlocked 가 새어 나가는 구멍을 막는다
 *   ⑤ HIDE 가 여러 건이어도 자리가 줄지 않는다 — 규칙 함수가 남은 자리를 자동 후보(rest)로 채운다
 *   ⑥ 만료된 예외는 무시된다
 *   ⑦ 오늘 자정 KST 가 UTC 로 맞게 저장된다
 *   ⑧ PIN 순서는 orderPinOverrides 하나 — 같은 position 도 행 순서와 무관하게 같은 결과
 *   ⑨ fill 이 무엇을 돌려줘도 HIDE·PIN·중복·후보 밖·초과 글은 거른다
 *
 * 사용법: npm run check:home-exposure
 * 종료 코드: FAIL 이 있으면 1
 */
import {
  applyHomeExposure,
  orderPinOverrides,
  isOverrideActive,
  resolveExpiresAt,
  type OverrideRow,
} from '../src/lib/home-exposure-rules'

let pass = 0
let fail = 0
function expect(label: string, actual: unknown, want: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(
    `  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`,
  )
  ok ? (pass += 1) : (fail += 1)
}

const post = (id: string) => ({ id })
/** 최종 목록만 — 대부분의 사례는 목록 순서를 본다 */
const apply = (a: Parameters<typeof applyHomeExposure<{ id: string }>>[0]) => applyHomeExposure(a).posts
const ids = (arr: { id: string }[]) => arr.map((p) => p.id)
const NOW = new Date('2026-09-01T05:00:00.000Z')

let rowSeq = 0
const row = () => ({ id: `row-${String((rowSeq += 1)).padStart(4, '0')}`, createdAt: new Date('2026-09-01T04:30:00.000Z') })
const pin = (postId: string, position: number, extra: Partial<OverrideRow> = {}): OverrideRow => ({
  ...row(),
  postId,
  action: 'PIN',
  position,
  isActive: true,
  expiresAt: null,
  ...extra,
})
const hide = (postId: string, extra: Partial<OverrideRow> = {}): OverrideRow => ({
  ...row(),
  postId,
  action: 'HIDE',
  position: null,
  isActive: true,
  expiresAt: null,
  ...extra,
})

console.log('\n══════ PIN — 자동 순서보다 앞에 온다')
expect(
  'PIN 이 맨 앞으로',
  ids(apply({ candidates: [post('a'), post('b'), post('c')], overrides: [pin('c', 0)], take: 3, now: NOW })),
  ['c', 'a', 'b'],
)
expect(
  'PIN 여러 건은 position 오름차순',
  ids(apply({ candidates: [post('a'), post('b'), post('c')], overrides: [pin('c', 1), pin('b', 0)], take: 3, now: NOW })),
  ['b', 'c', 'a'],
)
expect(
  'PIN 과 자동 후보가 겹쳐도 한 번만',
  ids(apply({ candidates: [post('a'), post('b')], overrides: [pin('a', 0)], take: 5, now: NOW })),
  ['a', 'b'],
)
expect(
  'position 이 없는 PIN 은 뒤로',
  ids(apply({ candidates: [post('a'), post('b'), post('c')], overrides: [pin('c', null as unknown as number), pin('b', 0)], take: 3, now: NOW })),
  ['b', 'c', 'a'],
)

console.log('\n══════ HIDE')
expect(
  'HIDE 는 자동 후보에서 빠진다',
  ids(apply({ candidates: [post('a'), post('b'), post('c')], overrides: [hide('b')], take: 5, now: NOW })),
  ['a', 'c'],
)
expect(
  'PIN 과 HIDE 가 부딪히면 빠진다',
  ids(apply({ candidates: [post('a'), post('b')], overrides: [pin('a', 0), hide('a')], take: 5, now: NOW })),
  ['b'],
)

console.log('\n══════ 자동 후보 밖의 글도 PIN 하면 나온다')
// 🔴 이 레인의 핵심이다. 점수가 낮아 후보에 못 든 글을 고정했을 때
//    홈에 뜨지 않으면 "고정" 이라는 말이 거짓이 된다.
//    호출부가 discovery 조건으로 조회해 pinnedPosts 로 넘긴다.
expect(
  '후보 밖 글이 맨 앞에 온다',
  ids(
    apply({
      candidates: [post('a'), post('b')],
      pinnedPosts: [post('z')],
      overrides: [pin('z', 0)],
      take: 5,
      now: NOW,
    }),
  ),
  ['z', 'a', 'b'],
)
expect(
  '후보 밖 PIN 여러 건도 position 순으로',
  ids(
    apply({
      candidates: [post('a')],
      pinnedPosts: [post('y'), post('z')],
      overrides: [pin('z', 0), pin('y', 1)],
      take: 5,
      now: NOW,
    }),
  ),
  ['z', 'y', 'a'],
)

console.log('\n══════ discovery 조건을 못 지난 글은 PIN 이어도 나가지 않는다')
// 호출부가 자동 후보와 **똑같은 where** 로 PIN 글을 조회한다.
// HIDDEN · Micro Seed · indexPromotionBlocked 글은 pinnedPosts 에도 들어오지 않는다.
expect(
  'HIDDEN 글은 PIN 돼도 안 나온다',
  ids(apply({ candidates: [post('a')], pinnedPosts: [], overrides: [pin('hidden-post', 0)], take: 5, now: NOW })),
  ['a'],
)
expect(
  'Micro Seed 글은 PIN 돼도 안 나온다',
  ids(apply({ candidates: [post('a')], pinnedPosts: [], overrides: [pin('micro-seed-post', 0)], take: 5, now: NOW })),
  ['a'],
)
expect(
  'indexPromotionBlocked 글은 PIN 돼도 안 나온다',
  ids(apply({ candidates: [post('a')], pinnedPosts: [], overrides: [pin('promotion-blocked-post', 0)], take: 5, now: NOW })),
  ['a'],
)
expect(
  '차단 회원 글도 PIN 돼도 안 나온다',
  ids(apply({ candidates: [post('a')], pinnedPosts: [], overrides: [pin('blocked-author-post', 0)], take: 5, now: NOW })),
  ['a'],
)

console.log('\n══════ 만료')
expect(
  '만료된 PIN 은 무시된다',
  ids(apply({ candidates: [post('a'), post('c')], overrides: [pin('c', 0, { expiresAt: new Date('2026-09-01T04:00:00.000Z') })], take: 5, now: NOW })),
  ['a', 'c'],
)
expect(
  '살아 있는 PIN 은 반영된다',
  ids(apply({ candidates: [post('a'), post('c')], overrides: [pin('c', 0, { expiresAt: new Date('2026-09-01T06:00:00.000Z') })], take: 5, now: NOW })),
  ['c', 'a'],
)
expect(
  '만료된 HIDE 는 무시된다',
  ids(apply({ candidates: [post('a'), post('b')], overrides: [hide('b', { expiresAt: new Date('2026-09-01T04:00:00.000Z') })], take: 5, now: NOW })),
  ['a', 'b'],
)
expect(
  'isActive=false 는 무시된다',
  ids(apply({ candidates: [post('a'), post('b')], overrides: [hide('b', { isActive: false })], take: 5, now: NOW })),
  ['a', 'b'],
)
expect('isActive=false 는 죽은 것', isOverrideActive({ isActive: false, expiresAt: null }, NOW), false)
expect('expiresAt=null 은 살아 있다', isOverrideActive({ isActive: true, expiresAt: null }, NOW), true)

console.log('\n══════ PIN + HIDE 충돌 — HIDE 가 이긴다')
expect(
  '후보 밖 PIN 이어도 HIDE 가 걸리면 안 나온다',
  ids(
    apply({
      candidates: [post('a'), post('b')],
      pinnedPosts: [post('z')],
      overrides: [pin('z', 0), hide('z')],
      take: 5,
      now: NOW,
    }),
  ),
  ['a', 'b'],
)

console.log('\n══════ HIDE 때문에 자리가 줄지 않는다')
// 후보 6개 중 3개를 숨겨도, 남은 후보로 take(3)를 채운다.
const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(post)
expect(
  'HIDE 3건이어도 take 만큼 채운다',
  ids(
    apply({
      candidates: six,
      overrides: [hide('a'), hide('b'), hide('c')],
      take: 3,
      now: NOW,
    }),
  ),
  ['d', 'e', 'f'],
)
expect(
  'PIN 과 HIDE 가 섞여도 take 를 채운다',
  apply({
    candidates: six,
    pinnedPosts: [post('z')],
    overrides: [pin('z', 0), hide('a'), hide('b')],
    take: 4,
    now: NOW,
  }).length,
  4,
)
expect(
  '후보가 모자라면 있는 만큼만',
  ids(apply({ candidates: [post('a'), post('b')], overrides: [hide('a')], take: 5, now: NOW })),
  ['b'],
)

console.log('\n══════ 개수')
expect(
  'take 를 넘지 않는다',
  apply({ candidates: [post('a'), post('b'), post('c'), post('d')], overrides: [pin('d', 0)], take: 2, now: NOW }).length,
  2,
)
expect('take 0 이면 빈 결과', applyHomeExposure({ candidates: [post('a')], overrides: [], take: 0, now: NOW }), { posts: [], pinned: [], rest: [], slots: 0 })
expect('PIN 이 take 보다 많으면 take 에서 멈춘다(자동 자리 0)',
  (({ posts, slots }) => [ids(posts), slots])(applyHomeExposure({ candidates: [post('a')], pinnedPosts: [post('x'), post('y'), post('z')], overrides: [pin('x', 0), pin('y', 1), pin('z', 2)], take: 2, now: NOW })),
  [['x', 'y'], 0])

console.log('\n══════ PIN 순서 — orderPinOverrides 하나')
{
  const early = pin('p', 1, { id: 'row-b', createdAt: new Date('2026-09-01T01:00:00.000Z') })
  const late = pin('q', 1, { id: 'row-a', createdAt: new Date('2026-09-01T02:00:00.000Z') })
  const run = (o: OverrideRow[]) => ids(apply({ candidates: [post('p'), post('q'), post('r')], overrides: o, take: 3, now: NOW }))
  expect('같은 position — 행 순서를 뒤집어도 같은 출력', [run([early, late]), run([late, early])], [['p', 'q', 'r'], ['p', 'q', 'r']])
  expect('같은 position — 먼저 고정한 글이 앞(행 id 와 무관)', orderPinOverrides(early, late) < 0, true)
  const twin = pin('s', 1, { id: 'row-c', createdAt: early.createdAt })
  expect('시각까지 같으면 행 id 오름차순', [orderPinOverrides(early, twin) < 0, orderPinOverrides(twin, early) > 0], [true, true])
}

console.log('\n══════ fill — 결과를 믿지 않는다')
{
  const cands = ['a', 'b', 'c', 'd', 'e'].map(post)
  const r = applyHomeExposure({
    candidates: cands,
    pinnedPosts: [post('z')],
    overrides: [pin('z', 0), hide('a')],
    take: 4,
    now: NOW,
    fill: () => [post('a'), post('outside'), post('z'), post('d'), post('d'), post('b'), post('c'), post('e')],
  })
  expect('HIDE · 후보 밖 · PIN · 중복을 거르고 자리 수(3)만큼', ids(r.posts), ['z', 'd', 'b', 'c'])
  expect('rest = HIDE·PIN 뺀 후보 · slots = take − PIN', [ids(r.rest), r.slots, ids(r.pinned)], [['b', 'c', 'd', 'e'], 3, ['z']])
  expect('기본 fill = 자동 순서 앞에서부터', ids(apply({ candidates: cands, overrides: [hide('a')], take: 2, now: NOW })), ['b', 'c'])
}

console.log('\n══════ 시간 정책')
expect('수동 해제는 null', resolveExpiresAt('MANUAL', NOW), null)
expect('4시간은 now + 4h', resolveExpiresAt('FOUR_HOURS', NOW)?.toISOString(), '2026-09-01T09:00:00.000Z')
// NOW = 2026-09-01 05:00 UTC = 2026-09-01 14:00 KST
// 오늘(한국 날짜 9/1) 자정 = 9/1 23:59:59.999 KST = 9/1 14:59:59.999 UTC
expect('오늘 자정 KST → UTC', resolveExpiresAt('TODAY_KST', NOW)?.toISOString(), '2026-09-01T14:59:59.999Z')
// UTC 로는 이미 다음 날에 가깝지만 한국은 벌써 9/2 인 시각
const lateUtc = new Date('2026-09-01T16:30:00.000Z') // KST 9/2 01:30
expect(
  'UTC 가 날을 넘기기 전이어도 한국 날짜 기준',
  resolveExpiresAt('TODAY_KST', lateUtc)?.toISOString(),
  '2026-09-02T14:59:59.999Z',
)
expect('오늘 자정은 지금보다 뒤다', (resolveExpiresAt('TODAY_KST', NOW) as Date).getTime() > NOW.getTime(), true)

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} PASS · ${fail} FAIL\n`)
process.exit(fail === 0 ? 0 : 1)
