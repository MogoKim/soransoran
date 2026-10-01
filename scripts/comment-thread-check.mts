#!/usr/bin/env tsx
/**
 * 댓글 대화 스레드 fixture — 🔴 DB · 세션 · 네트워크 · 브라우저 없음
 *
 * comment-thread.ts(루트 · 직접 대상 · 시간순 평면화 · 지움/차단 자리 · 관계 이상)와
 * comment-view.ts(화면으로 넘기기 전에 지움/차단 정보를 비우는 것)를 **실제 함수 그대로** 부른다.
 * DB 쓰기 경로(대상 확인 · 중복 · 부분 데이터)는 comment-thread-db-check.mts 가 격리 DB 로 본다.
 *
 *   npm run check:comment-thread
 */
import {
  authorKindOf,
  buildCommentThreads,
  conversationContextFor,
  type ContextRow,
  type ThreadRow,
} from '../src/lib/comment-thread'
import { countLiveComments, toThreadViews, type CommentSourceRow } from '../src/lib/comment-view'
import { THREAD_COLLAPSE_MIN_REPLIES, THREAD_PREVIEW_REPLIES } from '../src/lib/comment-policy'

type R = { name: string; ok: boolean; detail: string }
const report: R[] = []
let failures = 0
const ok = (name: string, detail: string) => report.push({ name, ok: true, detail })
const bad = (name: string, detail: string) => {
  failures++
  report.push({ name, ok: false, detail })
}
const check = (name: string, cond: boolean, detail: string) => (cond ? ok(name, detail) : bad(name, detail))

const POST = 'post-1'
const POST_AUTHOR = 'u-author'
let clock = Date.parse('2026-09-30T00:00:00Z')

type Row = CommentSourceRow & ContextRow
function row(id: string, parentId: string | null, over: Partial<Row> = {}): Row {
  clock += 60_000
  const authorId = over.authorId === undefined ? `u-${id}` : over.authorId
  return {
    id,
    postId: POST,
    parentId,
    createdAt: new Date(clock),
    isDeleted: false,
    authorId,
    content: `${id} 본문`,
    guestNickname: authorId === null ? `손님${id}` : null,
    likeCount: 0,
    author: authorId === null ? null : { id: authorId, name: null, nickname: `이름${id}`, image: null },
    commentOrigin: authorId === null ? 'GUEST' : 'MEMBER',
    personaId: null,
    operatorWriterId: null,
    ...over,
  }
}
const none = new Set<string>()
const build = (rows: Row[], blocked: ReadonlySet<string> = none) =>
  buildCommentThreads(rows, { postId: POST, blockedAuthorIds: blocked })
const views = (rows: Row[], blocked: ReadonlySet<string> = none) => toThreadViews(build(rows, blocked).threads, POST_AUTHOR)
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(',')

// ① 원댓글부터 5턴 이상 연속 답변 — 한 스레드 · 시간순 · 직접 대상
{
  const rows = [row('A', null), row('B', 'A'), row('C', 'B'), row('D', 'C'), row('E', 'D'), row('F', 'E')]
  const v = views(rows)
  check(
    '① 5턴 연속',
    v.length === 1 && ids(v[0].replies) === 'B,C,D,E,F' && v[0].replies.map((r) => r.replyTo?.id).join(',') === 'A,B,C,D,E',
    `스레드 ${v.length} · 답글 ${ids(v[0]?.replies ?? [])} · 대상 ${v[0]?.replies.map((r) => r.replyTo?.id).join(',')}`,
  )
}

// ② 회원·비회원 섞인 대화 · ③ 비회원이 답글에 다시 답함 · 분기(중간 댓글에 다시 답함)
{
  const rows = [
    row('A', null),
    row('B', 'A', { authorId: null }),
    row('C', 'B', { authorId: POST_AUTHOR }),
    row('D', 'C', { authorId: null }),
    row('E', 'B'),
  ]
  const [t] = views(rows)
  const d = t.replies.find((r) => r.id === 'D')
  const e = t.replies.find((r) => r.id === 'E')
  const c = t.replies.find((r) => r.id === 'C')
  check(
    '②③ 회원·비회원·분기',
    ids(t.replies) === 'B,C,D,E' &&
      d?.isGuest === true &&
      d.replyTo?.state === 'live' && d.replyTo.name === '이름C' && d.replyTo.isPostAuthor === true &&
      e?.replyTo?.state === 'live' && e.replyTo.isGuest === true &&
      c?.isPostAuthor === true && t.root.isPostAuthor === false,
    `D→C(글쓴이) · E→B(비회원) 분기 · 시간순 ${ids(t.replies)}`,
  )
}

// ⑧ 지운 원댓글 + 살아 있는 후속 / 대답 없는 지운 원댓글은 사라진다
{
  const rows = [row('A', null, { isDeleted: true }), row('B', 'A'), row('X', null, { isDeleted: true })]
  const v = views(rows)
  check(
    '⑧ 지운 원댓글',
    v.length === 1 && v[0].root.id === 'A' && v[0].root.state === 'deleted' && v[0].replies[0]?.replyTo?.state === 'deleted',
    `스레드 ${ids(v.map((t) => t.root))} · A 자리 ${v[0]?.root.state} · 대답 없는 X 는 빠짐`,
  )
}

// ⑨ 지운 중간 댓글 + 살아 있는 후속 / 지운 끝 댓글 · 지운 것만 이어진 가지는 사라진다
{
  const rows = [
    row('A', null),
    row('B', 'A', { isDeleted: true }),
    row('C', 'B'),
    row('D', 'A', { isDeleted: true }),
    row('E', 'A', { isDeleted: true }),
    row('F', 'E', { isDeleted: true }),
  ]
  const [t] = views(rows)
  check(
    '⑨ 지운 중간 댓글',
    ids(t.replies) === 'B,C' && t.replies[0].state === 'deleted' && t.replies[1].replyTo?.state === 'deleted',
    `남은 자리 ${ids(t.replies)} (D · E→F 는 뒤에 살아 있는 대답이 없어 빠짐)`,
  )
}

// ⑩ 차단한 회원의 중간 댓글 + 살아 있는 후속 / 차단 끝 댓글은 사라진다 / 지움이 차단보다 앞선다
{
  const blocked = new Set(['u-bad'])
  const rows = [
    row('A', null),
    row('B', 'A', { authorId: 'u-bad' }),
    row('C', 'B'),
    row('D', 'A', { authorId: 'u-bad' }),
    row('E', 'A', { authorId: 'u-bad', isDeleted: true }),
    row('G', 'E'),
  ]
  const [t] = views(rows, blocked)
  const e = t.replies.find((r) => r.id === 'E')
  check(
    '⑩ 차단 중간 댓글',
    ids(t.replies) === 'B,C,E,G' && t.replies[0].state === 'blocked' && t.replies[1].replyTo?.state === 'blocked' && e?.state === 'deleted',
    `남은 자리 ${ids(t.replies)} · B=차단 · E=지움(지움 우선) · D 는 빠짐`,
  )
}

// 🔴 지움·차단 정보가 화면 값으로 새지 않는다 — 직렬화된 값 전체를 뒤진다
{
  const blocked = new Set(['u-bad'])
  const rows = [
    row('A', null),
    row('B', 'A', { authorId: 'u-bad', content: '차단된사람의비밀본문', author: { id: 'u-bad', name: '카카오실명', nickname: '차단된닉', image: null } }),
    row('C', 'B', { isDeleted: true, content: '지운사람의비밀본문', author: { id: 'u-del', name: null, nickname: '지운닉', image: null }, authorId: 'u-del' }),
    row('D', 'C', { authorId: null, guestNickname: '지운손님', isDeleted: true, content: '지운비회원본문' }),
    row('E', 'D'),
  ]
  const json = JSON.stringify(views(rows, blocked))
  const leaks = ['차단된사람의비밀본문', '카카오실명', '차단된닉', 'u-bad', '지운사람의비밀본문', '지운닉', 'u-del', '지운손님', '지운비회원본문'].filter((w) => json.includes(w))
  check('🔴 정보 새지 않음', leaks.length === 0, leaks.length ? `샌 값: ${leaks.join(', ')}` : '지움·차단 댓글의 이름·본문·작성자 id 0건')
}

// ⑬ 댓글 수 — 살아 있고 차단하지 않은 댓글만
{
  const rows = [row('A', null), row('B', 'A', { isDeleted: true }), row('C', 'B'), row('D', 'A', { authorId: 'u-bad' }), row('E', 'D')]
  const n = countLiveComments(views(rows, new Set(['u-bad'])))
  check('⑬ 댓글 수', n === 3, `A · C · E = ${n}`)
}

// ⑯ 순환 · 고아 · 자기 자신 · 다른 글 — 화면은 깨지지 않고 이상은 드러난다
{
  const loop = [row('A', 'B'), row('B', 'A'), row('C', 'B')]
  const r1 = build(loop)
  const all1 = r1.threads.flatMap((t) => [t.root.row.id, ...t.replies.map((e) => e.row.id)]).sort().join(',')
  check('⑯ 순환', r1.anomalies.some((a) => a.kind === 'cycle') && all1 === 'A,B,C', `이상 ${JSON.stringify(r1.anomalies)} · 댓글 ${all1} 모두 한 번씩`)

  const self = build([row('S', 'S'), row('T', 'S')])
  check('⑯ 자기 자신', self.anomalies.some((a) => a.kind === 'cycle' && a.commentId === 'S') && ids(self.threads.map((t) => t.root.row)) === 'S', `이상 ${JSON.stringify(self.anomalies)}`)

  const orphan = build([row('A', null), row('O', 'gone-id'), row('P', 'O')])
  check(
    '⑯ 고아',
    orphan.anomalies.some((a) => a.kind === 'missing-parent' && a.commentId === 'O') && orphan.threads.length === 2 && orphan.threads[1].replies[0]?.row.id === 'P',
    `O 는 시작점 · P 는 O 의 답글 · 이상 ${JSON.stringify(orphan.anomalies)}`,
  )

  const foreign = build([row('A', null), { ...row('Z', null), postId: 'other-post' }])
  check('⑯ 다른 글의 행', foreign.anomalies.some((a) => a.kind === 'foreign-post') && foreign.threads.length === 1, `이상 ${JSON.stringify(foreign.anomalies)} · 다른 글 행은 버림`)

  const clean = build([row('A', null), row('B', 'A')])
  check('⑯ 정상엔 이상 0', clean.anomalies.length === 0, '정상 관계에서 이상을 만들지 않는다')
}

// ⑮ 매우 긴 스레드 — 깊이 2,000 한 줄 · 넓이 2,000 — 재귀 없이 빠르게
{
  const deep: Row[] = [row('d0', null)]
  for (let i = 1; i < 2000; i++) deep.push(row(`d${i}`, `d${i - 1}`))
  const t0 = performance.now()
  const b = build(deep)
  const ms = performance.now() - t0
  const wide: Row[] = [row('w0', null)]
  for (let i = 1; i < 2000; i++) wide.push(row(`w${i}`, 'w0'))
  const bw = build(wide)
  check(
    '⑮ 매우 긴 스레드',
    b.threads.length === 1 && b.threads[0].replies.length === 1999 && bw.threads[0].replies.length === 1999 && ms < 500,
    `깊이 1,999 · 넓이 1,999 · ${ms.toFixed(1)}ms`,
  )
}

// 무한 들여쓰기 0 — 스레드는 두 층(원댓글 · 평면 후속)뿐이다
{
  const [t] = views([row('A', null), row('B', 'A'), row('C', 'B'), row('D', 'C')])
  const nested = t.replies.some((r) => 'replies' in (r as object))
  check('무한 들여쓰기 0', !nested && t.replies.length === 3, '후속 답변은 한 배열 — 깊이에 따른 중첩 구조가 없다')
}

// 접힘 기준 — 한 곳의 상수 · 앞 몇 개가 기준보다 작아야 접을 것이 생긴다
check(
  '접힘 기준',
  THREAD_PREVIEW_REPLIES >= 1 && THREAD_PREVIEW_REPLIES < THREAD_COLLAPSE_MIN_REPLIES,
  `답글 ${THREAD_COLLAPSE_MIN_REPLIES}개 이상이면 앞 ${THREAD_PREVIEW_REPLIES}개만 (comment-policy.ts 한 곳)`,
)

// 마지막 답글 — 살아 있는 것 중 가장 늦은 것
{
  const [t] = views([row('A', null), row('B', 'A'), row('C', 'B', { isDeleted: true }), row('D', 'C')])
  check('마지막 답글', t.lastReply?.name === '이름D', `lastReply=${t.lastReply?.name}`)
}

// Persona 연결 인터페이스 — 🔴 연결하지 않는다. 계약만 본다
{
  const rows: Row[] = [
    row('A', null),
    row('B', 'A', { personaId: 'p1', authorId: 'u-p1', commentOrigin: 'PERSONA' }),
    row('C', 'B', { authorId: null }),
    row('D', 'C', { personaId: 'p2', authorId: 'u-p2', commentOrigin: 'PERSONA' }),
    row('E', 'D', { operatorWriterId: 'o1', authorId: 'u-o1', commentOrigin: 'OPERATOR' }),
    row('F', 'A'),
  ]
  const c = conversationContextFor(rows, 'E', { postId: POST })
  check(
    'Persona 맥락',
    c.ok &&
      c.threadRootId === 'A' &&
      c.chain.map((t) => t.id).join(',') === 'A,B,C,D,E' &&
      c.thread.map((t) => t.id).join(',') === 'A,B,C,D,E,F' &&
      c.stats.trailingAutoTurns === 2 &&
      c.stats.autoTurnsInChain === 3 &&
      c.chain.map((t) => t.authorKind).join(',') === 'member,persona,guest,persona,operator',
    c.ok ? `루트 A · 연결 A→E · 끝의 자동 차례 ${c.stats.trailingAutoTurns} · 작성자 ${c.chain.map((t) => t.authorKind).join(',')}` : c.reason,
  )
  const del = conversationContextFor([row('A', null), row('B', 'A', { isDeleted: true })], 'B', { postId: POST })
  const blk = conversationContextFor([row('A', null), row('B', 'A', { authorId: 'u-bad' })], 'B', { postId: POST, blockedAuthorIds: new Set(['u-bad']) })
  const anom = conversationContextFor([row('A', 'B'), row('B', 'A')], 'A', { postId: POST })
  const other = conversationContextFor([row('A', null)], 'nope', { postId: POST })
  check(
    'Persona 맥락 거절',
    !del.ok && del.reason === 'target-deleted' && !blk.ok && blk.reason === 'target-blocked' && !anom.ok && anom.reason === 'relation-anomaly' && !other.ok && other.reason === 'not-found',
    '지운 대상 · 차단 대상 · 관계 이상 · 없는 대상은 맥락을 만들지 않는다',
  )
}

// 작성자 종류 — commentOrigin 이 정본이다. authorId 로 회원/비회원을 짐작하지 않는다
{
  const kind = (over: Partial<Row>) => authorKindOf(row('K', null, over))
  const show = (k: ReturnType<typeof authorKindOf>) => (k.ok ? k.kind : `거절:${k.reason}`)
  const cases: [string, Partial<Row>, string][] = [
    ['회원', { commentOrigin: 'MEMBER' }, 'member'],
    ['탈퇴 회원(authorId 없음)', { commentOrigin: 'MEMBER', authorId: null, guestNickname: null }, 'member'],
    ['비회원', { commentOrigin: 'GUEST', authorId: null }, 'guest'],
    ['Persona', { commentOrigin: 'PERSONA', personaId: 'p1' }, 'persona'],
    ['Operator', { commentOrigin: 'OPERATOR', operatorWriterId: 'o1' }, 'operator'],
    ['Micro Seed', { commentOrigin: 'MICRO_SEED_VERBATIM' }, 'micro-seed'],
    ['Micro Seed(authorId 없음)', { commentOrigin: 'MICRO_SEED_VERBATIM', authorId: null }, 'micro-seed'],
    ['모순: GUEST 인데 authorId', { commentOrigin: 'GUEST', authorId: 'u-x' }, '거절'],
    ['모순: PERSONA 인데 personaId 없음', { commentOrigin: 'PERSONA' }, '거절'],
    ['모순: MEMBER 인데 personaId', { commentOrigin: 'MEMBER', personaId: 'p1' }, '거절'],
    ['모순: OPERATOR + personaId', { commentOrigin: 'OPERATOR', operatorWriterId: 'o1', personaId: 'p1' }, '거절'],
    ['모순: MICRO_SEED + operator', { commentOrigin: 'MICRO_SEED_VERBATIM', operatorWriterId: 'o1' }, '거절'],
    ['모름: 알 수 없는 출처', { commentOrigin: 'SOMETHING_NEW' }, '거절'],
  ]
  const wrong = cases.filter(([, over, want]) => !show(kind(over)).startsWith(want)).map(([n, over, want]) => `${n}: ${show(kind(over))} (기대 ${want})`)
  check('작성자 종류 엄격 판정', wrong.length === 0, wrong.length ? wrong.join(' / ') : `${cases.length}가지 — 탈퇴 회원은 회원 · Micro Seed 는 따로 · 모순은 거절`)

  // Micro Seed 는 자동 차례로 센다 · 모순 행이 대화에 있으면 맥락 전체를 만들지 않는다(fail-closed)
  const seedCtx = conversationContextFor(
    [row('A', null), row('B', 'A', { commentOrigin: 'MICRO_SEED_VERBATIM' }), row('C', 'B', { commentOrigin: 'PERSONA', personaId: 'p1' })],
    'C',
    { postId: POST },
  )
  const badCtx = conversationContextFor(
    [row('A', null), row('B', 'A', { commentOrigin: 'GUEST', authorId: 'u-x' }), row('C', 'B')],
    'C',
    { postId: POST },
  )
  check(
    'Persona 맥락 · Micro Seed · 모순',
    seedCtx.ok && seedCtx.chain.map((t) => t.authorKind).join(',') === 'member,micro-seed,persona' && seedCtx.stats.trailingAutoTurns === 2 &&
      !badCtx.ok && badCtx.reason === 'author-contradiction',
    `${seedCtx.ok ? seedCtx.chain.map((t) => t.authorKind).join('→') + ` · 끝의 자동 차례 ${seedCtx.stats.trailingAutoTurns}` : seedCtx.reason} · 모순 행 → ${badCtx.ok ? '맥락을 만들었다!' : badCtx.reason}`,
  )
}

console.log('\n댓글 대화 스레드 fixture')
console.log('  네트워크 · DB · 세션 · 브라우저를 타지 않는다\n')
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(16)} → ${r.detail}`)
if (failures > 0) {
  console.log(`\n🔴 ${failures}건 실패\n`)
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치\n`)
