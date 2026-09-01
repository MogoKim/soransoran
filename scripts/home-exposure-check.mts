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
 *   ③ 후보에 없는 글은 PIN 이어도 나가지 않는다
 *      — HIDDEN · Micro Seed · indexPromotionBlocked 가 새어 나가는 구멍을 막는다
 *   ④ 만료된 예외는 무시된다
 *   ⑤ 오늘 자정 KST 가 UTC 로 맞게 저장된다
 *
 * 사용법: npm run check:home-exposure
 * 종료 코드: FAIL 이 있으면 1
 */
import {
  applyHomeExposure,
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
const ids = (arr: { id: string }[]) => arr.map((p) => p.id)
const NOW = new Date('2026-09-01T05:00:00.000Z')

const pin = (postId: string, position: number, extra: Partial<OverrideRow> = {}): OverrideRow => ({
  postId,
  action: 'PIN',
  position,
  isActive: true,
  expiresAt: null,
  ...extra,
})
const hide = (postId: string, extra: Partial<OverrideRow> = {}): OverrideRow => ({
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
  ids(applyHomeExposure({ candidates: [post('a'), post('b'), post('c')], overrides: [pin('c', 0)], take: 3, now: NOW })),
  ['c', 'a', 'b'],
)
expect(
  'PIN 여러 건은 position 오름차순',
  ids(applyHomeExposure({ candidates: [post('a'), post('b'), post('c')], overrides: [pin('c', 1), pin('b', 0)], take: 3, now: NOW })),
  ['b', 'c', 'a'],
)
expect(
  'PIN 과 자동 후보가 겹쳐도 한 번만',
  ids(applyHomeExposure({ candidates: [post('a'), post('b')], overrides: [pin('a', 0)], take: 5, now: NOW })),
  ['a', 'b'],
)
expect(
  'position 이 없는 PIN 은 뒤로',
  ids(applyHomeExposure({ candidates: [post('a'), post('b'), post('c')], overrides: [pin('c', null as unknown as number), pin('b', 0)], take: 3, now: NOW })),
  ['b', 'c', 'a'],
)

console.log('\n══════ HIDE')
expect(
  'HIDE 는 자동 후보에서 빠진다',
  ids(applyHomeExposure({ candidates: [post('a'), post('b'), post('c')], overrides: [hide('b')], take: 5, now: NOW })),
  ['a', 'c'],
)
expect(
  'PIN 과 HIDE 가 부딪히면 빠진다',
  ids(applyHomeExposure({ candidates: [post('a'), post('b')], overrides: [pin('a', 0), hide('a')], take: 5, now: NOW })),
  ['b'],
)

console.log('\n══════ 후보에 없는 글은 PIN 이어도 나가지 않는다')
// 호출부가 DISCOVERY_ELIGIBLE_WHERE 로 조회하므로
// HIDDEN · Micro Seed · indexPromotionBlocked 글은 candidates 에 애초에 없다.
expect(
  'HIDDEN 글은 PIN 돼도 안 나온다',
  ids(applyHomeExposure({ candidates: [post('a')], overrides: [pin('hidden-post', 0)], take: 5, now: NOW })),
  ['a'],
)
expect(
  'Micro Seed 글은 PIN 돼도 안 나온다',
  ids(applyHomeExposure({ candidates: [post('a')], overrides: [pin('micro-seed-post', 0)], take: 5, now: NOW })),
  ['a'],
)
expect(
  'indexPromotionBlocked 글은 PIN 돼도 안 나온다',
  ids(applyHomeExposure({ candidates: [post('a')], overrides: [pin('promotion-blocked-post', 0)], take: 5, now: NOW })),
  ['a'],
)

console.log('\n══════ 만료')
expect(
  '만료된 PIN 은 무시된다',
  ids(applyHomeExposure({ candidates: [post('a'), post('c')], overrides: [pin('c', 0, { expiresAt: new Date('2026-09-01T04:00:00.000Z') })], take: 5, now: NOW })),
  ['a', 'c'],
)
expect(
  '살아 있는 PIN 은 반영된다',
  ids(applyHomeExposure({ candidates: [post('a'), post('c')], overrides: [pin('c', 0, { expiresAt: new Date('2026-09-01T06:00:00.000Z') })], take: 5, now: NOW })),
  ['c', 'a'],
)
expect(
  '만료된 HIDE 는 무시된다',
  ids(applyHomeExposure({ candidates: [post('a'), post('b')], overrides: [hide('b', { expiresAt: new Date('2026-09-01T04:00:00.000Z') })], take: 5, now: NOW })),
  ['a', 'b'],
)
expect(
  'isActive=false 는 무시된다',
  ids(applyHomeExposure({ candidates: [post('a'), post('b')], overrides: [hide('b', { isActive: false })], take: 5, now: NOW })),
  ['a', 'b'],
)
expect('isActive=false 는 죽은 것', isOverrideActive({ isActive: false, expiresAt: null }, NOW), false)
expect('expiresAt=null 은 살아 있다', isOverrideActive({ isActive: true, expiresAt: null }, NOW), true)

console.log('\n══════ 개수')
expect(
  'take 를 넘지 않는다',
  applyHomeExposure({ candidates: [post('a'), post('b'), post('c'), post('d')], overrides: [pin('d', 0)], take: 2, now: NOW }).length,
  2,
)
expect('take 0 이면 빈 배열', applyHomeExposure({ candidates: [post('a')], overrides: [], take: 0, now: NOW }), [])

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
