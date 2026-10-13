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
 *   ⑥ 갱년기톡 최소 7 은 **최종 목록**(PIN·HIDE 뒤 take)에서 성립한다 — 필수 반례 7종 + 불변식
 *
 * 사용법: npm run check:home-popularity
 */
import { readFileSync } from 'node:fs'
import { createHomeAutoFill, pickHomePopular, popularityScore, type MenopauseQuota, type ScorablePost } from '../src/lib/popularity'
import { applyHomeExposure, type OverrideRow } from '../src/lib/home-exposure-rules'
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
  const load = posts.slice(posts.indexOf('async function loadHomePopularCandidates'), posts.indexOf('export async function getHomePopularPosts'))
  const home = posts.slice(posts.indexOf('export async function getHomePopularPosts'), posts.indexOf('export async function getPostDetail'))
  expect('홈 후보가 실반응 신호를 붙인다', /withRealReactions\(prisma,\s*menopauseRows\)/.test(load) && /withRealReactions\(prisma,\s*freeRows\)/.test(load), true)
  expect('후보 단계에서 take 로 자르거나 배분하지 않는다', /pickHomePopular|HEADROOM|take \*/.test(load + home), false)
  expect('배분은 PIN·HIDE 뒤 최종 자리에서 — applyHomeExposure 에 fillAuto: auto.fill', /applyHomeExposure\(\{[^}]*fillAuto:\s*auto\.fill[^}]*\}\)/.test(home), true)
  expect('진단은 최종 목록으로 — auto.diagnosis(posts)', /menopauseQuota:\s*auto\.diagnosis\(posts\)/.test(home), true)
  expect('홈 화면은 최종 목록(posts)만 그린다', /const \{ posts \} = await getHomePopularPosts\(/.test(code('src/app/page.tsx')), true)
  const db = code('src/lib/popularity-db.ts')
  expect('비회원 상한을 따로 적지 않고 /best 정본을 가져온다', /import \{ GUEST_COMMENT_CAP \} from '@\/lib\/best-ranking'/.test(db) && !/Math\.min\([^)]*,\s*\d+\)/.test(db), true)
  expect('MEMBER 는 (글, 작성자) 짝으로 접는다', /by:\s*\['postId',\s*'authorId'\]/.test(db), true)
  expect('글쓴이 답글을 뺀다', /authorId === authorOf\.get\(postId\)/.test(db), true)
  expect('점수에는 붙인 묶음이 들어간다(원본 행이 아니다)', /return \[\.\.\.menopause, \.\.\.free\]/.test(load), true)
  const admin = code('src/app/admin/(ops)/home/page.tsx')
  expect('어드민 홈 노출이 실반응 수를 함께 보여준다', /post\.realReactions/.test(admin), true)
  expect('어드민 홈 노출이 갱년기톡 부족분과 원인을 보여준다', /quota\.deficit/.test(admin) && /quota\.reasons/.test(admin), true)
}

console.log('\n⑤ 화면 숫자는 거짓으로 바꾸지 않는다')
{
  expect('POST_LIST_ITEM_SELECT 댓글 수 = 삭제만 뺀 실제 개수', POST_LIST_ITEM_SELECT._count, { select: { comments: { where: { isDeleted: false } } } })
}

console.log('\n⑥ 갱년기톡 최소 — 최종 목록 기준')
{
  type H = ScorablePost & { title: string }
  const BASE = NOW.getTime()
  /** 점수는 나이로만 정한다 — i 가 작을수록 최신·고점. 실반응은 0 으로 둬 순서가 i 하나로 정해진다 */
  const mk = (i: number, boardType: H['boardType']): H => ({ id: `${boardType[0]}${String(i).padStart(2, '0')}`, title: '', boardType, createdAt: new Date(BASE - (i + 1) * 0.37 * H), realReactions: 0 })
  /** i 번째(0부터)가 meno 집합에 있으면 갱년기톡, 아니면 자유게시판 */
  const pool = (n: number, meno: (i: number) => boolean) => Array.from({ length: n }, (_, i) => mk(i, meno(i) ? 'MENOPAUSE' : 'FREE'))
  const pin = (postId: string, position: number): OverrideRow => ({ postId, action: 'PIN', position, isActive: true, expiresAt: null })
  const hide = (postId: string): OverrideRow => ({ postId, action: 'HIDE', position: null, isActive: true, expiresAt: null })
  const score = (p: H) => popularityScore(p, NOW)

  /** posts.ts getHomePopularPosts 와 같은 조합 */
  function compose({ candidates, pinnedPosts = [], overrides = [], take = 20 }: { candidates: H[]; pinnedPosts?: H[]; overrides?: OverrideRow[]; take?: number }) {
    const auto = createHomeAutoFill<H>({ minMenopause: 7, now: NOW })
    const posts = applyHomeExposure({ candidates, pinnedPosts, overrides, take, now: NOW, fillAuto: auto.fill })
    return { posts, quota: auto.diagnosis(posts) }
  }
  const menoOf = (l: readonly H[]) => l.filter((p) => p.boardType === 'MENOPAUSE').length
  const ids = (l: readonly H[]) => l.map((p) => p.id)

  /** 모든 반례에 거는 불변식 */
  function invariants(label: string, input: Parameters<typeof compose>[0], out: { posts: H[]; quota: MenopauseQuota }) {
    const take = input.take ?? 20
    const hidden = new Set((input.overrides ?? []).filter((o) => o.action === 'HIDE').map((o) => o.postId))
    const pinOrder = (input.overrides ?? []).filter((o) => o.action === 'PIN' && !hidden.has(o.postId))
      .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9)).map((o) => o.postId)
      .filter((id) => [...input.candidates, ...(input.pinnedPosts ?? [])].some((p) => p.id === id))
      .filter((id, i, a) => a.indexOf(id) === i).slice(0, take)
    const autoPart = out.posts.slice(pinOrder.length)
    const autoScores = autoPart.map(score)
    // 자동 자리 = HIDE·PIN 을 뺀 후보 중 점수 상위. 갱년기톡 몫을 채우려 바꾼 것 외에는 게시판마다 점수 상위다
    const restBy = (b: H['boardType']) => input.candidates.filter((p) => p.boardType === b && !hidden.has(p.id) && !pinOrder.includes(p.id))
    const topOfBoard = (b: H['boardType']) => {
      const chosen = autoPart.filter((p) => p.boardType === b)
      const best = [...new Map(restBy(b).map((p) => [p.id, p])).values()].sort((x, y) => score(y) - score(x)).slice(0, chosen.length)
      return JSON.stringify(ids(chosen).sort()) === JSON.stringify(ids(best).sort())
    }
    const ok =
      out.posts.length <= take &&
      new Set(ids(out.posts)).size === out.posts.length &&
      !out.posts.some((p) => hidden.has(p.id)) &&
      JSON.stringify(ids(out.posts.slice(0, pinOrder.length))) === JSON.stringify(pinOrder) &&
      autoScores.every((v, i) => i === 0 || autoScores[i - 1] >= v) &&
      topOfBoard('MENOPAUSE') && topOfBoard('FREE') &&
      out.quota.shown === menoOf(out.posts) &&
      out.quota.shown >= out.quota.target &&
      // 결정적 — 입력 순서를 뒤집어도 같은 답
      JSON.stringify(ids(compose({ ...input, candidates: [...input.candidates].reverse() }).posts)) === JSON.stringify(ids(out.posts))
    expect(`  └ 불변식(길이≤take · 중복 0 · HIDE 0 · PIN 위치 · 점수순 · 게시판별 상위 · 결정적) — ${label}`, ok, true)
  }
  const run = (label: string, input: Parameters<typeof compose>[0]) => {
    const out = compose(input)
    invariants(label, input, out)
    return out
  }

  // 1. 40 후보 중 갱년기톡 7개가 점수 21~27위
  {
    const input = { candidates: pool(40, (i) => i >= 20 && i <= 26) }
    const out = run('21~27위', input)
    expect('① 갱년기톡이 21~27위여도 최종 20 에 7개', menoOf(out.posts), 7)
    expect('  └ 자유게시판은 상위 13개만 남는다(최소 교체)', ids(out.posts.filter((p) => p.boardType === 'FREE')), ids(input.candidates.slice(0, 13)))
    const legacy = applyHomeExposure({ candidates: pickHomePopular({ menopause: input.candidates.filter((p) => p.boardType === 'MENOPAUSE'), free: input.candidates.filter((p) => p.boardType === 'FREE'), take: 40, minMenopause: 7, now: NOW }), overrides: [], take: 20, now: NOW })
    expect('  └ 대조 — 옛 경로(40 에서 보장 → 20 으로 자름)는 0개였다', menoOf(legacy), 0)
  }
  // 2. 일부 HIDE → 다음 갱년기톡으로 대체
  {
    const candidates = pool(40, (i) => i >= 20 && i <= 30) // 갱년기톡 11개: M20..M30
    const out = run('HIDE 대체', { candidates, overrides: [hide('M20'), hide('M22')] })
    expect('② 갱년기톡 일부 HIDE → 다음 순위로 채워 7개', menoOf(out.posts), 7)
    expect('  └ 숨긴 글은 없고 M28 까지 내려가 채운다', ids(out.posts.filter((p) => p.boardType === 'MENOPAUSE')).sort(), ['M21', 'M23', 'M24', 'M25', 'M26', 'M27', 'M28'])
  }
  // 3. PIN 된 갱년기톡이 보장 수에 포함
  {
    const candidates = pool(40, (i) => i >= 20 && i <= 36)
    const out = run('PIN 갱년기톡', { candidates, overrides: [pin('M35', 0), pin('M36', 1)] })
    expect('③ PIN 갱년기톡 2 + 자동 5 = 7 (9 가 아니다)', [menoOf(out.posts), out.quota.pinned], [7, 2])
    expect('  └ PIN 이 맨 앞 자리 그대로', ids(out.posts.slice(0, 2)), ['M35', 'M36'])
  }
  // 4. 자유게시판 PIN 15 → 자동 자리 5
  {
    const candidates = pool(40, (i) => i >= 20 && i <= 30)
    const overrides = Array.from({ length: 15 }, (_, k) => pin(`F${String(k).padStart(2, '0')}`, k))
    const out = run('FREE PIN 15', { candidates, overrides })
    expect('④ 자동 자리 5 → 갱년기톡 최대 5', menoOf(out.posts), 5)
    expect('  └ 부족 2 · 원인 = PIN 이 자리를 차지(slots-short)', [out.quota.deficit, out.quota.reasons], [2, ['slots-short']])
    expect('  └ 목표 = min(7, 노출 가능 11, PIN 갱년기톡 0 + 자동 5) = 5', out.quota.target, 5)
  }
  // 5. PIN 과 자동 후보가 같은 글
  {
    const candidates = pool(30, (i) => i >= 20)
    const out = run('PIN=자동', { candidates, pinnedPosts: [candidates[0], candidates[25]], overrides: [pin(candidates[25].id, 0), pin(candidates[0].id, 1)] })
    expect('⑤ PIN 과 자동 후보가 같아도 중복 0', new Set(ids(out.posts)).size, out.posts.length)
    expect('  └ 두 글 모두 PIN 자리에 한 번씩', ids(out.posts.slice(0, 2)), [candidates[25].id, candidates[0].id])
  }
  // 6. take < 7
  {
    const candidates = pool(40, (i) => i >= 20 && i <= 30)
    const three = run('take 3', { candidates, take: 3 })
    expect('⑥ take 3 → 3개 · 전부 갱년기톡(목표 = min(7, 11, 3))', [three.posts.length, menoOf(three.posts), three.quota.target], [3, 3, 3])
    expect('  └ 부족 원인 = 자리 부족', three.quota.reasons, ['slots-short'])
    const zero = compose({ candidates, take: 0 })
    expect('  └ take 0 → 빈 목록 · 목표 0', [zero.posts.length, zero.quota.target, zero.quota.shown], [0, 0, 0])
    const allPinned = run('take 2 · PIN 2', { candidates, take: 2, overrides: [pin('F00', 0), pin('F01', 1)] })
    expect('  └ 자리를 PIN 이 다 차지하면 자동 0 · 진단은 PIN 기준', [ids(allPinned.posts), allPinned.quota.reasons], [['F00', 'F01'], ['slots-short']])
  }
  // 7. 노출 가능한 갱년기톡 7개 미만
  {
    const candidates = pool(40, (i) => i >= 30 && i <= 33)
    const out = run('갱년기톡 4개', { candidates })
    expect('⑦ 갱년기톡이 4개뿐이면 4개만', menoOf(out.posts), 4)
    expect('  └ 부족 3 · 원인 = 노출 가능한 글 부족(eligible-short)', [out.quota.deficit, out.quota.reasons], [3, ['eligible-short']])
    const hidden = run('4개 중 1 HIDE', { candidates, overrides: [hide('M30')] })
    expect('  └ 그중 1개를 숨기면 3개 · 숨긴 글을 되살리지 않는다', [menoOf(hidden.posts), hidden.posts.some((p) => p.id === 'M30')], [3, false])
  }
  // 정상 — 최소를 이미 넘으면 바꾸지 않는다
  {
    const candidates = pool(40, (i) => i % 2 === 0)
    const out = run('자연 충족', { candidates })
    expect('갱년기톡이 이미 최소 이상이면 순수 점수순 그대로', ids(out.posts), ids(candidates.slice(0, 20)))
    expect('  └ 부족 0 · 원인 없음', [out.quota.deficit, out.quota.reasons], [0, []])
  }
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
