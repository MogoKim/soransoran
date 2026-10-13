#!/usr/bin/env tsx
/**
 * 홈 인기 점수 — Persona 댓글이 순위를 부풀리지 않는가.
 *
 * 🔴 DB 를 켜지 않는다. 점수·배분은 순수 함수라 표본으로 확인한다.
 *    where 조건이 실제로 무엇을 세는지는 격리 DB 검사(home-popularity-db-check.mts)가 본다.
 * 🔴 규칙을 여기 다시 적지 않는다 — 원본을 import 한다.
 *
 * 지키는 것
 *   ① 점수는 실반응 신호(realReactions)만 본다 — Persona 댓글이 많아도 점수가 같다
 *   ② 홈 배분(pickHomePopular)도 같은 축으로 고른다
 *   ③ 신호 = 실회원 사람 수 + min(비회원, /best GUEST_COMMENT_CAP) · where 는 MEMBER(실회원 relation)·GUEST 만 연다
 *   ④ 배선 — 점수 함수가 화면 숫자(_count)를 모르고, 홈 후보가 실반응 수를 붙인 뒤 점수를 매긴다
 *   ⑤ 화면 표시 숫자(POST_LIST_ITEM_SELECT)는 출처로 거르지 않는다 — 실제 개수 그대로
 *
 * 사용법: npm run check:home-popularity
 */
import { readFileSync } from 'node:fs'
import { pickHomePopular, popularityScore, type ScorablePost } from '../src/lib/popularity'
import { HOME_GUEST_COMMENT_WHERE, HOME_MEMBER_COMMENT_WHERE, homeReactionSignal } from '../src/lib/popularity-db'
import { BEST_REAL_MEMBER_WHERE } from '../src/lib/best-ranking-db'
import { GUEST_COMMENT_CAP } from '../src/lib/best-ranking'
import { POST_LIST_ITEM_SELECT } from '../src/lib/queries/post-list-item-select'

let pass = 0
let fail = 0
function expect(label: string, actual: unknown, want: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`)
  ok ? (pass += 1) : (fail += 1)
}

const NOW = new Date('2026-10-13T12:00:00Z')
const H = 3_600_000
type P = ScorablePost & { _count: { comments: number } }
const post = (id: string, ageH: number, real: number, shown: number, boardType: P['boardType'] = 'FREE'): P => ({
  id,
  boardType,
  createdAt: new Date(NOW.getTime() - ageH * H),
  realReactions: real,
  _count: { comments: shown },
})

console.log('\n① 점수는 실반응 댓글만 본다')
{
  const personaHeavy = post('persona', 2, 0, 30) // 화면 댓글 30 · 전부 Persona
  const quiet = post('quiet', 2, 0, 0)
  const realOne = post('real', 2, 1, 1)
  expect('Persona 댓글 30 = 댓글 0 과 같은 점수', popularityScore(personaHeavy, NOW), popularityScore(quiet, NOW))
  expect('실반응 1 이 Persona 30 을 이긴다', popularityScore(realOne, NOW) > popularityScore(personaHeavy, NOW), true)
  const mixed = post('mixed', 2, 2, 12) // 실반응 2 + Persona 10
  expect('섞인 글은 실반응 2 만큼만 센다', popularityScore(mixed, NOW), popularityScore(post('x', 2, 2, 2), NOW))
}

console.log('\n② 홈 배분도 같은 축이다')
{
  // 옛 축(화면 댓글 수)이면 persona-a 가 1위였다
  const free = [post('persona-a', 1, 0, 20), post('real-b', 3, 2, 2), post('quiet-c', 0.5, 0, 0)]
  const menopause = [post('persona-m', 1.2, 0, 15, 'MENOPAUSE'), post('real-m', 5, 3, 4, 'MENOPAUSE')]
  const picked = pickHomePopular({ menopause, free, take: 5, minMenopause: 0, now: NOW }).map((p) => p.id)
  // real-m 4/9^0.8=0.690 · real-b 3/7^0.8=0.633 · quiet-c 1/4.5^0.8=0.300 · persona-a 1/5^0.8=0.276 · persona-m 1/5.2^0.8=0.268
  expect('실반응 글이 위 · Persona 댓글 글은 최신성만으로 겨룬다', picked, ['real-m', 'real-b', 'quiet-c', 'persona-a', 'persona-m'])
  const old = [...free, ...menopause]
    .sort((a, b) => popularityScore({ ...b, realReactions: b._count.comments }, NOW) - popularityScore({ ...a, realReactions: a._count.comments }, NOW))
    .map((p) => p.id)
  expect('대조 — 화면 숫자로 매기면 Persona 글이 1·2위였다(이 검사가 둘을 가른다)', old.slice(0, 2), ['persona-a', 'persona-m'])
}

console.log('\n③ 신호와 where')
{
  expect('같은 회원 10건은 호출부가 1명으로 접어 넘긴다 → 1', homeReactionSignal({ memberCommenters: 1, guestComments: 0 }), 1)
  expect('서로 다른 실회원 2명 = 2', homeReactionSignal({ memberCommenters: 2, guestComments: 0 }), 2)
  expect('비회원 100건 = 상한 3', homeReactionSignal({ memberCommenters: 0, guestComments: 100 }), 3)
  expect('비회원 상한은 /best 정본(GUEST_COMMENT_CAP)과 같다', GUEST_COMMENT_CAP, 3)
  expect('실회원 2 + 비회원 5 = 5', homeReactionSignal({ memberCommenters: 2, guestComments: 5 }), 5)
  expect('음수·NaN 은 0', homeReactionSignal({ memberCommenters: -1, guestComments: Number.NaN }), 0)
  for (const [name, w] of [['MEMBER', HOME_MEMBER_COMMENT_WHERE], ['GUEST', HOME_GUEST_COMMENT_WHERE]] as const) {
    // 🔴 키가 있는지부터 본다 — JSON.stringify 는 배열 안 undefined 를 null 로 바꿔 "키 없음" 을 놓친다
    const axes = (['isDeleted', 'personaId', 'operatorWriterId'] as const).map((k) => (k in w ? (w as Record<string, unknown>)[k] : 'MISSING'))
    expect(`${name} — 삭제 제외 · Persona 축 · 운영 축 차단`, axes, [false, null, null])
  }
  expect('레인은 MEMBER 와 GUEST 하나씩', [HOME_MEMBER_COMMENT_WHERE.commentOrigin, HOME_GUEST_COMMENT_WHERE.commentOrigin], ['MEMBER', 'GUEST'])
  expect('MEMBER 는 작성자 relation 으로 실회원을 확인한다(/best 와 같은 기준)', HOME_MEMBER_COMMENT_WHERE.author, { is: BEST_REAL_MEMBER_WHERE })
}

/** 주석을 지운 소스 — 주석에 적힌 이름을 배선으로 오인하지 않게 한다 */
const code = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

console.log('\n④ 배선')
{
  const pop = code('src/lib/popularity.ts')
  expect('popularity.ts 가 화면 숫자(_count)를 읽지 않는다', /_count/.test(pop), false)
  const posts = code('src/lib/queries/posts.ts')
  const body = posts.slice(posts.indexOf('async function pickPopularByScore'), posts.indexOf('export async function getHomePopularPosts'))
  expect('홈 후보가 실반응 신호를 붙인다', /withRealReactions\(prisma,\s*menopauseRows\)/.test(body) && /withRealReactions\(prisma,\s*freeRows\)/.test(body), true)
  const db = code('src/lib/popularity-db.ts')
  expect('비회원 상한을 따로 적지 않고 /best 정본을 가져온다', /import \{ GUEST_COMMENT_CAP \} from '@\/lib\/best-ranking'/.test(db) && !/Math\.min\([^)]*,\s*\d+\)/.test(db), true)
  expect('MEMBER 는 (글, 작성자) 짝으로 접는다', /by:\s*\['postId',\s*'authorId'\]/.test(db), true)
  expect('글쓴이 답글을 뺀다', /authorId === authorOf\.get\(postId\)/.test(db), true)
  expect('점수에는 붙인 묶음이 들어간다(원본 행이 아니다)', /pickHomePopular\(\{\s*menopause,\s*free,/.test(body) && !/menopause:\s*menopauseRows|free:\s*freeRows/.test(body), true)
  const admin = code('src/app/admin/(ops)/home/page.tsx')
  expect('어드민 홈 노출이 실반응 수를 함께 보여준다', /post\.realReactions/.test(admin), true)
}

console.log('\n⑤ 화면 숫자는 거짓으로 바꾸지 않는다')
{
  expect('POST_LIST_ITEM_SELECT 댓글 수 = 삭제만 뺀 실제 개수', POST_LIST_ITEM_SELECT._count, { select: { comments: { where: { isDeleted: false } } } })
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
