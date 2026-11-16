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
 *   ② 홈 배분(fillMenopauseMinimum)도 같은 축으로 고른다
 *   ③ 신호 = 실회원 사람 수 + min(비회원, /best GUEST_COMMENT_CAP) · where 는 MEMBER(실회원 relation)·GUEST 만 연다
 *   ④ 배선 — 점수 함수가 화면 숫자(_count)를 모르고, 홈 후보가 실반응 수를 붙인 뒤 점수를 매긴다
 *   ⑤ 화면 표시 숫자(POST_LIST_ITEM_SELECT)는 출처로 거르지 않는다 — 실제 개수 그대로
 *   ⑥ 홈 인기 편성 — mobile 은 갱년기톡 최소 7 을 **최종 목록**에서 지키고(끼워 넣는 글은 최근 14일),
 *      desktop 은 게시판별 10|10 이다. 배분 사례는 scripts/lib/home-popularity-cases.mts 가 정본(변이 하네스와 공유)
 *   ⑦ 편성 배선 — 한 now · 한 벌 후보 · 어드민은 손님 관점 · 읽기 전용 미리보기 · /best 는 홈 경로를 모른다
 *
 * 사용법: npm run check:home-popularity
 */
import { readFileSync } from 'node:fs'
import * as popularity from '../src/lib/popularity'
import { fillMenopauseMinimum, popularityScore, type ScorablePost } from '../src/lib/popularity'
import { HOME_GUEST_COMMENT_WHERE, HOME_MEMBER_COMMENT_WHERE, homeReactionSignal } from '../src/lib/popularity-db'
import { BEST_REAL_MEMBER_WHERE } from '../src/lib/best-ranking-db'
import { GUEST_COMMENT_CAP } from '../src/lib/best-ranking'
import { POST_LIST_ITEM_SELECT } from '../src/lib/queries/post-list-item-select'
import { pickBoardPopular } from '../src/lib/popularity'
import * as exposureRules from '../src/lib/home-exposure-rules'
import { type OverrideRow } from '../src/lib/home-exposure-rules'
import { composeHomePopularViews } from '../src/lib/home-popular-views'
import {
  HOME_POPULAR_CANDIDATES_PER_BOARD,
  HOME_POPULAR_COUNT,
  HOME_POPULAR_MENOPAUSE_FRESH_HOURS,
  HOME_POPULAR_MIN_MENOPAUSE,
  HOME_POPULAR_PER_BOARD,
} from '../src/lib/home-exposure'
import { CASE_FRESH_HOURS, CASE_MIN, CASE_TAKE, loaderProblems, runQuotaCases, type QuotaModule } from './lib/home-popularity-cases.mjs'

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
  const picked = fillMenopauseMinimum([...menopause, ...free], { slots: 5, pinned: [], minimum: 0, freshHours: HOME_POPULAR_MENOPAUSE_FRESH_HOURS, now: NOW }).map((p) => p.id)
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
  const mod = code('src/lib/home-popular-views.ts')
  const body = mod.slice(mod.indexOf('export async function loadHomePopularInputs'), mod.indexOf('export function composeHomePopularViews'))
  const compose = mod.slice(mod.indexOf('export function composeHomePopularViews'))
  expect('홈 후보가 실반응 신호를 붙인다', /withRealReactions\(db,\s*menopauseRows\)/.test(body) && /withRealReactions\(db,\s*freeRows\)/.test(body), true)
  const db = code('src/lib/popularity-db.ts')
  expect('비회원 상한을 따로 적지 않고 /best 정본을 가져온다', /import \{ GUEST_COMMENT_CAP \} from '@\/lib\/best-ranking'/.test(db) && !/Math\.min\([^)]*,\s*\d+\)/.test(db), true)
  expect('MEMBER 는 (글, 작성자) 짝으로 접는다', /by:\s*\['postId',\s*'authorId'\]/.test(db), true)
  expect('글쓴이 답글을 뺀다', /authorId === authorOf\.get\(postId\)/.test(db), true)
  expect('점수에는 붙인 묶음이 들어간다(원본 행이 아니다)',
    /return \{ menopause, free, pinnedPosts, overrides \}/.test(body) && /candidates: \[\.\.\.menopause, \.\.\.free\]/.test(compose) && !/menopauseRows\s*[,}]|freeRows\s*[,}]/.test(body.slice(body.indexOf('return {'))), true)
  const admin = code('src/app/admin/(ops)/home/page.tsx')
  expect('어드민 홈 노출이 실반응 수를 함께 보여준다', /post\.realReactions/.test(admin), true)
}

console.log('\n⑤ 화면 숫자는 거짓으로 바꾸지 않는다')
{
  expect('POST_LIST_ITEM_SELECT 댓글 수 = 삭제만 뺀 실제 개수', POST_LIST_ITEM_SELECT._count, { select: { comments: { where: { isDeleted: false } } } })
}

// ── ⑥ 홈 인기 편성 ─────────────────────────────────────────────
type V = ScorablePost & { viewCount: number; tag?: string }
const vpost = (id: string, ageH: number, real: number, boardType: V['boardType'], extra: Partial<V> = {}): V => ({
  id, boardType, createdAt: new Date(NOW.getTime() - ageH * H), realReactions: real, viewCount: 0, ...extra,
})
let rowSeq = 0
const pin = (postId: string, position: number | null, extra: Partial<OverrideRow> = {}): OverrideRow =>
  ({ id: `row-${String((rowSeq += 1)).padStart(4, '0')}`, createdAt: new Date(NOW.getTime() - H), postId, action: 'PIN', position, isActive: true, expiresAt: null, ...extra })
const hide = (postId: string, extra: Partial<OverrideRow> = {}): OverrideRow =>
  ({ id: `row-${String((rowSeq += 1)).padStart(4, '0')}`, createdAt: new Date(NOW.getTime() - H), postId, action: 'HIDE', position: null, isActive: true, expiresAt: null, ...extra })
const ids = (l: readonly { id: string }[]) => l.map((p) => p.id)
const menoCount = (l: readonly V[]) => l.filter((p) => p.boardType === 'MENOPAUSE').length

console.log('\n⑥ 홈 인기 편성 — mobile 은 최종 목록에서 갱년기톡 최소 7(끼워 넣는 글은 최근 14일) · desktop 은 게시판별')
{
  expect('개수 정본 — mobile 20 · 열 10 · 최소 7 · 신선 336h · 후보 60',
    [HOME_POPULAR_COUNT, HOME_POPULAR_PER_BOARD, HOME_POPULAR_MIN_MENOPAUSE, HOME_POPULAR_MENOPAUSE_FRESH_HOURS, HOME_POPULAR_CANDIDATES_PER_BOARD], [20, 10, 7, 336, 60])
  expect('사례 묶음 상수 = 정본 상수(사례가 다른 규칙을 시험하지 않는다)', [CASE_TAKE, CASE_MIN, CASE_FRESH_HOURS], [HOME_POPULAR_COUNT, HOME_POPULAR_MIN_MENOPAUSE, HOME_POPULAR_MENOPAUSE_FRESH_HOURS])
  const mod: QuotaModule = { ...popularity, ...exposureRules } as unknown as QuotaModule
  expect('배분 사례 T-P1~T-P17 (scripts/lib/home-popularity-cases.mts)', runQuotaCases(mod), [])

  // 편성 수준 — 실제 composeHomePopularViews 로 같은 결론이 나는가
  const strongFree = Array.from({ length: 15 }, (_, i) => vpost(`sf${i}`, 1 + i * 0.1, 5, 'FREE'))
  const weakFreshMeno = Array.from({ length: 12 }, (_, i) => vpost(`wm${i}`, 100 + i, 0, 'MENOPAUSE'))
  const v1 = composeHomePopularViews({ menopause: weakFreshMeno, free: strongFree, pinnedPosts: [], overrides: [] }, NOW)
  expect('최종 mobile 에 갱년기톡 7 (점수 약해도 · 최근 글이면 끼워 넣는다)', menoCount(v1.mobile), 7)
  expect('  └ 진단 — 부족 0 · 결함 0', [v1.mobileQuota.deficit, v1.mobileQuota.allocationDefect], [0, false])
  expect('desktop 갱년기톡 열 = 자기 게시판 상위 10(최소 보장으로 7 에 묶이지 않는다)', ids(v1.desktop.MENOPAUSE), ids(weakFreshMeno.slice(0, 10)))
  expect('desktop 자유게시판 열 = 자유게시판 상위 10(갱년기톡에 자리를 내주지 않는다)', ids(v1.desktop.FREE), ids(strongFree.slice(0, 10)))

  const staleMeno = Array.from({ length: 12 }, (_, i) => vpost(`st${i}`, 26 * 24 + i, 0, 'MENOPAUSE'))
  const free40 = Array.from({ length: 40 }, (_, i) => vpost(`f40-${i}`, 1 + i * 0.1, 5, 'FREE'))
  const vs = composeHomePopularViews({ menopause: staleMeno, free: free40, pinnedPosts: [], overrides: [] }, NOW)
  expect('오래된 갱년기톡만 → mobile 0 · 원인 신선한 갱년기톡 부족', [menoCount(vs.mobile), vs.mobileQuota.reasons], [0, ['fresh-short']])
  expect('  └ 열에는 그대로 뜬다(데스크톱 열은 신선도 상한이 없다)', ids(vs.desktop.MENOPAUSE), ids(staleMeno.slice(0, 10)))
  const hide25 = free40.slice(0, 25).map((p) => hide(p.id))
  const vh = composeHomePopularViews({ menopause: weakFreshMeno, free: free40, pinnedPosts: [], overrides: hide25 }, NOW)
  expect('자유 상위 25 HIDE 여도 mobile 20 · 갱년기톡 7 · HIDE 0', [vh.mobile.length, menoCount(vh.mobile), vh.mobile.some((p) => hide25.some((o) => o.postId === p.id))], [20, 7, false])

  const strongMeno = Array.from({ length: 25 }, (_, i) => vpost(`sm${i}`, 1 + i * 0.1, 5, 'MENOPAUSE'))
  const weakFree = Array.from({ length: 12 }, (_, i) => vpost(`wf${i}`, 100 + i, 0, 'FREE'))
  const v2 = composeHomePopularViews({ menopause: strongMeno, free: weakFree, pinnedPosts: [], overrides: [] }, NOW)
  expect('반대 — mobile 20 이 전부 갱년기톡이어도(독식은 막지 않는다)', v2.mobile.every((p) => p.boardType === 'MENOPAUSE'), true)
  expect('  └ desktop 자유게시판 열은 10 그대로', ids(v2.desktop.FREE), ids(weakFree.slice(0, 10)))

  // 부족분 — 있는 만큼만, 다른 게시판·최신 글로 채우지 않는다
  const few = [vpost('m1', 2, 1, 'MENOPAUSE'), vpost('m2', 5, 0, 'MENOPAUSE'), vpost('m3', 9, 0, 'MENOPAUSE')]
  const v3 = composeHomePopularViews({ menopause: few, free: strongFree, pinnedPosts: [], overrides: [] }, NOW)
  expect('갱년기톡 적격 3 → mobile 3 · 열 3 · 원인 노출 가능 부족', [menoCount(v3.mobile), ids(v3.desktop.MENOPAUSE), v3.mobileQuota.reasons], [3, ['m1', 'm2', 'm3'], ['eligible-short']])
  const v4 = composeHomePopularViews({ menopause: [], free: [], pinnedPosts: [], overrides: [] }, NOW)
  expect('후보 0 → 세 결과 모두 빈 배열', [v4.mobile.length, v4.desktop.MENOPAUSE.length, v4.desktop.FREE.length], [0, 0, 0])
  // 다른 게시판 글이 풀에 섞여 들어와도 열은 받지 않는다 · 매거진은 어디에도 없다(T-P10)
  const v5 = composeHomePopularViews({ menopause: [...few, vpost('stray-free', 1, 9, 'FREE')], free: [], pinnedPosts: [], overrides: [] }, NOW)
  expect('갱년기톡 풀에 섞인 자유게시판 글은 갱년기톡 열에 없다', ids(v5.desktop.MENOPAUSE), ['m1', 'm2', 'm3'])
  const mag = vpost('mag', 1, 50, 'MAGAZINE')
  const vm = composeHomePopularViews({ menopause: [mag], free: [mag, ...strongFree], pinnedPosts: [mag], overrides: [pin('mag', 0)] }, NOW)
  expect('T-P10 매거진 글은 후보·고정으로 들어와도 mobile·열 어디에도 없다', [...ids(vm.mobile), ...ids(vm.desktop.MENOPAUSE), ...ids(vm.desktop.FREE)].includes('mag'), false)

  // PIN — 자기 게시판 열 맨 위, 열 안에서 같은 PIN 순서 · 후보 밖 고정 글도 뜬다
  const outFree = vpost('pin-out-free', 300, 0, 'FREE')
  const pins = [pin('sf9', 2), pin('wm11', 1), pin('pin-out-free', 0), pin('sf3', 5)]
  const v6 = composeHomePopularViews({ menopause: weakFreshMeno, free: strongFree, pinnedPosts: [outFree, strongFree[9], weakFreshMeno[11], strongFree[3]], overrides: pins }, NOW)
  expect('자유게시판 열 = PIN position 0·2·5 순 → 나머지 점수순', ids(v6.desktop.FREE).slice(0, 4), ['pin-out-free', 'sf9', 'sf3', 'sf0'])
  expect('갱년기톡 열 = 자기 PIN(position 1) 이 맨 위', ids(v6.desktop.MENOPAUSE)[0], 'wm11')
  expect('mobile = 전 게시판 PIN position 순', ids(v6.mobile).slice(0, 4), ['pin-out-free', 'wm11', 'sf9', 'sf3'])
  expect('  └ 고정 갱년기톡 1 을 포함해 7 (8 이 아니다)', [menoCount(v6.mobile), v6.mobileQuota.pinned], [7, 1])
  expect('자유게시판 PIN 은 갱년기톡 열에 없다', ids(v6.desktop.MENOPAUSE).some((id) => id.startsWith('sf') || id === 'pin-out-free'), false)

  // HIDE — 세 결과 모두 · PIN 과 겹치면 빠진다 · 비적격 PIN 은 어디에도 없다
  const v7 = composeHomePopularViews({
    menopause: weakFreshMeno, free: strongFree,
    pinnedPosts: [strongFree[5]],
    overrides: [hide('sf0'), hide('wm0'), pin('sf5', 0), hide('sf5'), pin('micro-seed-or-blocked', 0)],
  }, NOW)
  const every = (v: typeof v7) => [...ids(v.mobile), ...ids(v.desktop.MENOPAUSE), ...ids(v.desktop.FREE)]
  expect('HIDE 글(sf0 · wm0)은 mobile·MENOPAUSE·FREE 어디에도 없다', every(v7).filter((id) => id === 'sf0' || id === 'wm0'), [])
  expect('PIN+HIDE 겹친 글은 빠진다', every(v7).includes('sf5'), false)
  expect('비적격 PIN(로더가 돌려주지 않은 글)은 통과 0', every(v7).includes('micro-seed-or-blocked'), false)
  expect('HIDE 뒤에도 열은 10 을 채운다(자르지 않고 전부 넘긴다)', [v7.desktop.FREE.length, v7.desktop.MENOPAUSE.length], [10, 10])

  // 하나의 now — 점수 순서 · 만료 · 신선도가 모두 넘겨받은 now 를 따른다(T-P14 포함)
  const PAST = new Date('2026-01-01T00:00:00Z')
  const at = (id: string, ageH: number, real: number, b: V['boardType']): V => ({ id, boardType: b, createdAt: new Date(PAST.getTime() - ageH * H), realReactions: real, viewCount: 0 })
  const timeInput = {
    menopause: [at('m-young', 1, 0, 'MENOPAUSE'), at('m-old', 30, 3, 'MENOPAUSE'), at('m-hid', 2, 0, 'MENOPAUSE')],
    free: [at('f-young', 1, 0, 'FREE'), at('f-old', 30, 3, 'FREE'), at('f-hid', 2, 0, 'FREE')],
    pinnedPosts: [],
    overrides: [hide('m-hid', { expiresAt: new Date(PAST.getTime() + H) }), hide('f-hid', { expiresAt: PAST })],
  }
  const vt = composeHomePopularViews(timeInput, PAST)
  expect('같은 now — 세 결과 모두 NOW 기준 순서 · 만료 전 HIDE 적용 · expiresAt = now 는 이미 만료',
    [ids(vt.mobile), ids(vt.desktop.MENOPAUSE), ids(vt.desktop.FREE)],
    // 같은 점수·같은 시각은 id 내림차순('m-…' > 'f-…')
    [['m-young', 'f-young', 'f-hid', 'm-old', 'f-old'], ['m-young', 'm-old'], ['f-young', 'f-hid', 'f-old']])
  const later = composeHomePopularViews(timeInput, new Date(PAST.getTime() + 30 * 24 * H))
  expect('  └ 대조 — now 를 한 달 뒤로 주면 순서가 뒤집히고 HIDE 가 풀린다(이 검사가 시계를 가른다)', [ids(later.desktop.FREE)[0], ids(later.mobile).includes('m-hid')], ['f-old', true])

  // 조회수는 점수에 들어가지 않는다
  const a = vpost('views-0', 5, 1, 'FREE', { viewCount: 0 })
  const b = vpost('views-9999', 5, 1, 'FREE', { viewCount: 9999 })
  expect('조회수 0 과 9999 의 점수가 같다', popularityScore(a, NOW), popularityScore(b, NOW))
  const older = vpost('older-viral', 6, 1, 'FREE', { viewCount: 100000 })
  const vv = composeHomePopularViews({ menopause: [], free: [older, a, b], pinnedPosts: [], overrides: [] }, NOW)
  expect('조회수 10만 글도 실반응·나이가 같으면 뒤 — 순서는 조회수를 모른다', ids(vv.desktop.FREE).at(-1), 'older-viral')
}

console.log('\n⑦ 편성 배선 — 한 now · 한 벌 후보 · 손님 관점 미리보기 · /best 격리')
{
  const posts = code('src/lib/queries/posts.ts')
  const mod = code('src/lib/home-popular-views.ts')
  const loader = mod.slice(mod.indexOf('export async function loadHomePopularInputs'), mod.indexOf('export function composeHomePopularViews'))
  const compose = mod.slice(mod.indexOf('export function composeHomePopularViews'))
  const views = posts.slice(posts.indexOf('export async function getHomePopularViews'), posts.indexOf('export async function getGuestHomePopularViews'))
  const guest = posts.slice(posts.indexOf('export async function getGuestHomePopularViews'), posts.indexOf('export async function getPostDetail'))
  expect('ViewModel 이 같은 now 를 로더와 편성에 넘긴다(고객 — 세션 차단)',
    /loadHomePopularInputs\(prisma,\s*blockedIds,\s*now\)/.test(views) && /composeHomePopularViews\(inputs,\s*now\)/.test(views), true)
  expect('손님 관점 ViewModel — 차단 [] · 같은 로더·편성 · 세션·isAdmin 을 읽지 않는다',
    /loadHomePopularInputs\(prisma,\s*\[\],\s*now\)/.test(guest) && /composeHomePopularViews\(inputs,\s*now\)/.test(guest) && !/getBlockedUserIds|auth\(|isAdmin/.test(guest), true)
  expect('옛 래퍼 getHomePopularPosts 가 없다', /getHomePopularPosts/.test(posts) || /getHomePopularPosts/.test(code('src/app/page.tsx')), false)
  expect('로더·편성은 시계를 직접 읽지 않는다(new Date 0)', [/new Date\(/.test(loader), /new Date\(/.test(compose)], [false, false])
  expect('로더의 만료 판정은 넘겨받은 now 로', /isOverrideActive\(o,\s*now\)/.test(loader), true)
  expect('로더 정적 점검(discovery 2 · 가입인사 제외 2 · id 2차 키 · HEADROOM 0)', loaderProblems(readFileSync(new URL('../src/lib/home-popular-views.ts', import.meta.url), 'utf8')), [])
  // 괄호 짝으로 각 호출의 인자만 떼어 낸다 — 안쪽 호출의 인자는 지우고 본다(바깥이 now 를 빠뜨려도 안쪽 now 에 가려지지 않게)
  const argsOf = (src: string, at: number) => {
    let depth = 0
    for (let i = src.indexOf('(', at); i < src.length; i += 1) {
      if (src[i] === '(') depth += 1
      if (src[i] === ')' && (depth -= 1) === 0) return src.slice(src.indexOf('(', at) + 1, i)
    }
    return ''
  }
  const callArgs = [...compose.matchAll(/\b(applyHomeExposure|fillMenopauseMinimum|pickBoardPopular|diagnoseMenopauseQuota)\(/g)].map((m) => {
    const own = argsOf(compose, m.index)
    return { name: m[1], own: own.replace(/\b(fillMenopauseMinimum|pickBoardPopular)\([\s\S]*?\}\)/g, '') }
  })
  expect('편성의 배분·예외 호출(apply 2 · fill 1 · pickBoard 1 · diagnose 1) 각자 now 를 넘긴다',
    callArgs.map((c) => `${c.name}:${/\bnow\b/.test(c.own)}`).sort(),
    ['applyHomeExposure:true', 'applyHomeExposure:true', 'diagnoseMenopauseQuota:true', 'fillMenopauseMinimum:true', 'pickBoardPopular:true'])
  expect('편성 파일에서 applyHomeExposure 계열 호출은 compose 안에만(접미사 변형 포함)',
    [...mod.matchAll(/\bapplyHomeExposure\w*\(/g)].every((m) => m.index >= mod.indexOf('export function composeHomePopularViews')), true)
  expect('후보 조회는 게시판별 한 번씩(후보 findMany 1벌 + PIN 1) — 열마다 · 연결 파일에서 다시 조회하지 않는다',
    [(loader.match(/db\.post\.findMany\(/g) ?? []).length, (loader.match(/candidatesFor\('(MENOPAUSE|FREE)'\)/g) ?? []).length, (mod.match(/candidatesFor\(/g) ?? []).length, /homeExposureOverride|withRealReactions/.test(posts)],
    [2, 2, 2, false])

  const admin = code('src/app/admin/(ops)/home/page.tsx')
  const preview = admin.slice(admin.indexOf('데스크톱 게시판별 미리보기'), admin.indexOf('홈에 없는 글 찾기'))
  expect('어드민이 화면 now 로 손님 관점 ViewModel 을 부른다(운영자 본인 차단 목록 0)',
    [/getGuestHomePopularViews\(now\)/.test(admin), /getHomePopularViews\(/.test(admin), /getBlockedUserIds/.test(admin)], [true, false, false])
  expect('어드민 고정 번호 = 홈과 같은 comparePinRows', /\.sort\(comparePinRows\)/.test(admin), true)
  expect('어드민이 갱년기톡 진단(mobileQuota)을 보여 준다', /views\.mobileQuota/.test(admin) && /allocationDefect/.test(admin), true)
  expect('데스크톱 미리보기 안에 조작 폼·action·form 0', /AdminHomeOverrideForm|AdminHomeOverrideControls|<form|action=/.test(preview), false)
  expect('조작 폼은 기존 두 자리(홈 표 · 찾기 결과)만', (admin.match(/<AdminHomeOverrideForm\b/g) ?? []).length, 2)
  expect('미리보기가 MENOPAUSE · FREE 열을 모두 그린다', /\['MENOPAUSE',\s*'FREE'\]/.test(admin) && /views\.desktop\[boardType\]/.test(admin), true)

  const homeOnly = /getHomePopularViews|getGuestHomePopularViews|composeHomePopularViews|loadHomePopularInputs|applyHomeExposure|fillMenopauseMinimum|diagnoseMenopauseQuota|comparePinRows|pickBoardPopular|home-exposure|home-popular-views|['/]popularity['"]/
  expect('/best (page · queries/best · best-ranking) 는 홈 편성 경로를 모른다',
    ['src/app/best/page.tsx', 'src/lib/queries/best.ts', 'src/lib/best-ranking.ts', 'src/lib/best-ranking-db.ts'].filter((f) => homeOnly.test(code(f))), [])
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
