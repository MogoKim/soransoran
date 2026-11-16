#!/usr/bin/env tsx
/**
 * 답 기다리는 글 — 순수 판정 시험(R1~R17) + 정적 계약(S1~S5)
 *
 * 🔴 DB 를 켜지 않는다. 실제 조회·저장은 member-response-db-check · operator-compose-db-check 가 격리 Postgres 에서 본다.
 * 🔴 판정 모듈은 `MEMBER_RESPONSE_MODULE` 로 바꿔 끼울 수 있다 — 변이 하네스가 사본을 넣는다(기본은 실제 파일).
 *
 * 사용법: npm run check:member-response
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

type Row = {
  id: string
  postId: string
  parentId: string | null
  createdAt: Date
  isDeleted: boolean
  authorId: string | null
  commentOrigin: string
  personaId: string | null
  operatorWriterId: string | null
  authorBlocked: boolean | null
}
type Verdict = { state: string; firstResponseAt: Date | null; responderKind: string | null; waitedMs: number; personaPresent: boolean }
type Mod = {
  MEMBER_RESPONSE_TARGET_MS: number
  judgeMemberPostResponse: (p: { authorId: string; createdAt: Date }, c: Row[], b: ReadonlySet<string>, now: Date) => Verdict
  isDawnKst: (d: Date) => boolean
  summarizeMemberResponses: (v: Verdict[]) => {
    total: number
    answered: number
    answeredWithinTarget: number
    byResponder: { member: number; guest: number; operator: number }
    waiting: number
    overdue: number
    unknown: number
  }
}

const modulePath = process.env.MEMBER_RESPONSE_MODULE ?? new URL('../src/lib/member-response.ts', import.meta.url).pathname
const m = (await import(pathToFileURL(modulePath).href)) as Mod

let pass = 0
let fail = 0
const expect = (label: string, actual: unknown, want: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`}`)
  ok ? (pass += 1) : (fail += 1)
}

const NOW = new Date('2026-11-16T06:00:00Z') // KST 15:00
const H = 3_600_000
const AUTHOR = 'author'
const post = (ageMs: number) => ({ authorId: AUTHOR, createdAt: new Date(NOW.getTime() - ageMs) })
let seq = 0
const c = (over: Partial<Row>): Row => ({
  id: `c${(seq += 1)}`,
  postId: 'p',
  parentId: null,
  createdAt: new Date(NOW.getTime() - H),
  isDeleted: false,
  authorId: 'someone',
  commentOrigin: 'MEMBER',
  personaId: null,
  operatorWriterId: null,
  authorBlocked: false,
  ...over,
})
const judge = (rows: Row[], ageMs = 5 * H, blocked: string[] = []) => m.judgeMemberPostResponse(post(ageMs), rows, new Set(blocked), NOW)
const state = (rows: Row[], ageMs = 5 * H, blocked: string[] = []) => judge(rows, ageMs, blocked).state

console.log('\n① 판정 — 무엇이 답인가')
expect('R1 댓글 0 · 3h−1ms → 기다림', state([], 3 * H - 1), 'waiting')
expect('R1 댓글 0 · 3h 정각 → 기한 넘김(경계 포함)', state([], 3 * H), 'overdue')
expect('R1 목표 시간 = 3시간', m.MEMBER_RESPONSE_TARGET_MS, 3 * H)
expect('R2 글쓴이 본인 댓글(최상위·대댓글)만 → 답 아님', state([c({ authorId: AUTHOR }), c({ authorId: AUTHOR, parentId: 'x' })]), 'overdue')
const persona = judge([c({ commentOrigin: 'PERSONA', personaId: 'pz', authorId: 'pu' })])
expect('R3 Persona 자동 댓글만 → 답 아님 · 점검 신호', [persona.state, persona.personaPresent], ['overdue', true])
expect('R4 Micro Seed 원문 댓글만 → 답 아님', state([c({ commentOrigin: 'MICRO_SEED_VERBATIM', authorId: null })]), 'overdue')
expect('R5 운영 댓글이 지워졌으면 → 답 아님', state([c({ commentOrigin: 'OPERATOR', operatorWriterId: 'op', isDeleted: true })]), 'overdue')
expect('R6 운영 차단된 회원 댓글 → 답 아님', state([c({ authorBlocked: true })]), 'overdue')
expect('R6 작성자 상태를 모르는 회원 댓글 → 답 아님', state([c({ authorBlocked: null })]), 'overdue')
expect('R7 글쓴이가 차단한 회원 댓글 → 답 아님', state([c({ authorId: 'blocked-one' })], 5 * H, ['blocked-one']), 'overdue')
const guest = judge([c({ commentOrigin: 'GUEST', authorId: null, authorBlocked: null })])
expect('R8 손님 댓글 → 답함 · 손님', [guest.state, guest.responderKind], ['answered', 'guest'])
const op = judge([c({ commentOrigin: 'OPERATOR', operatorWriterId: 'op1', authorId: 'op-user', authorBlocked: null })])
expect('R9 운영자 이름 댓글 → 답함 · 운영', [op.state, op.responderKind], ['answered', 'operator'])
const voice = judge([c({ commentOrigin: 'OPERATOR', operatorWriterId: 'pv07', authorId: 'persona-user', personaId: null })])
expect('R9 Persona 목소리(OPERATOR · PV 작성자 · personaId 없음) → 답함 · 운영', [voice.state, voice.responderKind], ['answered', 'operator'])
expect('R10 운영 댓글인데 글쓴이가 그 이름을 차단 → 답 아님', state([c({ commentOrigin: 'OPERATOR', operatorWriterId: 'op1', authorId: 'op-user' })], 5 * H, ['op-user']), 'overdue')
expect('R11 탈퇴 회원(authorId 없음 · 상태 모름) → 답 아님', state([c({ authorId: null, authorBlocked: null })]), 'overdue')
expect('R12 판정 불가 행만(MEMBER 인데 personaId) → 판정 불가', state([c({ personaId: 'pz' })]), 'unknown')
expect('R12 판정 불가 행 + 유효한 손님 답 → 답함', state([c({ personaId: 'pz' }), c({ commentOrigin: 'GUEST', authorId: null })]), 'answered')
const t = (h: number) => new Date(NOW.getTime() - h * H)
const multi = judge([
  c({ createdAt: t(1), authorId: 'm2' }),
  c({ createdAt: t(4), commentOrigin: 'GUEST', authorId: null }),
  c({ createdAt: t(2), commentOrigin: 'OPERATOR', operatorWriterId: 'op1', authorId: 'op-user' }),
])
expect('R13 유효 답 여럿 → 첫 답 = 가장 이른 시각 · 그 작성자', [multi.firstResponseAt?.toISOString(), multi.responderKind, multi.waitedMs], [t(4).toISOString(), 'guest', H])
expect('R14 다른 회원의 대댓글이 유일한 답 → 답함 · 회원', [judge([c({ parentId: 'x', authorId: 'm9' })]).state, judge([c({ parentId: 'x', authorId: 'm9' })]).responderKind], ['answered', 'member'])
const future = m.judgeMemberPostResponse({ authorId: AUTHOR, createdAt: new Date(NOW.getTime() + 60_000) }, [], new Set(), NOW)
expect('R15 시계 차이로 미래 시각 글 → 기다림 · 0ms', [future.state, future.waitedMs], ['waiting', 0])

console.log('\n② 새벽 꼬리표 (KST 00:00~06:59)')
const kst = (hhmmss: string) => new Date(`2026-11-16T${hhmmss}+09:00`)
expect('R16 KST 23:59:59 / 00:00 / 06:59:59 / 07:00', ['23:59:59', '00:00:00', '06:59:59', '07:00:00'].map((x) => m.isDawnKst(kst(x))), [false, true, true, false])

console.log('\n③ 요약')
{
  const vs = [
    judge([c({ createdAt: new Date(NOW.getTime() - 4 * H) })], 5 * H), // 답함 · 1h 만에 · 회원
    judge([c({ commentOrigin: 'GUEST', authorId: null, createdAt: new Date(NOW.getTime() - H) })], 5 * H), // 답함 · 4h 만에 · 손님
    judge([], H), // 기다림
    judge([], 5 * H), // 기한 넘김
    judge([c({ personaId: 'pz' })]), // 판정 불가
  ]
  const s = m.summarizeMemberResponses(vs)
  expect('R17 합 = 전체 · 3h 안 답 ≤ 답함 · 응답자별', [s.total, s.answered, s.answeredWithinTarget, s.byResponder, s.waiting, s.overdue, s.unknown],
    [5, 2, 1, { member: 1, guest: 1, operator: 0 }, 1, 1, 1])
  expect('R17 빈 목록 → 0', m.summarizeMemberResponses([]).total, 0)
}

// 정적 계약 — 실제 저장소 파일을 읽는다(변이 하네스가 판정 모듈만 바꿔도 이 절은 그대로다)
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

console.log('\n④ 정적 계약')
{
  const q = code('src/lib/queries/member-response.ts')
  expect('S1 조회 — 실회원 정본 조각만 합성(새 정의 0) · 지운 댓글 제외 · Raw SQL·isMicroSeed 0',
    [/onboardedBaseWhere\(env\)/, /GENERAL_POST_WHERE, GREETING_POST_WHERE/, /\.\.\.NOT_MICRO_SEED_LANE_WHERE/, /OPERATOR_BOARDS/, /isBlocked: false/, /isDeleted: false/].map((r) => r.test(q))
      .concat([/\$queryRaw|\$executeRaw|isMicroSeed/.test(q)]),
    [true, true, true, true, true, true, false])
  const page = code('src/app/admin/(ops)/responses/page.tsx')
  expect('S2 화면 — 권한 확인 · 동적 · noindex · 로더만(직접 질의 0) · hex 0',
    [/await requireAdmin\(\)/.test(page), /dynamic = 'force-dynamic'/.test(page), /index: false/.test(page), /loadMemberResponseBoard\(prisma, now\)/.test(page), /prisma\.\w+\.(find|count|groupBy)/.test(page), /#[0-9a-fA-F]{3,8}\b/.test(page)],
    [true, true, true, true, false, false])
  const ops = code('src/components/admin/AdminOpsNav.tsx')
  const items = [...ops.matchAll(/\{ href: '([^']+)', label: '([^']+)' \}/g)].map((x) => x[1])
  expect('S3 운영 메뉴 8개 · 답 기다리는 글은 신고 바로 뒤', [items.length, items.indexOf('/admin/responses') - items.indexOf('/admin/reports')], [8, 1])
  expect('S3 사이드바 「콘텐츠 운영」 묶음에 포함', /ops\('\/admin\/reports', '\/admin\/responses', '\/admin\/content'\)/.test(code('src/components/admin/AdminNav.tsx')), true)
  // 🔴 git 추적 여부와 무관하게 파일을 직접 훑는다(커밋 전 새 파일도 본다)
  const { readdirSync } = await import('node:fs')
  const root = new URL('../', import.meta.url).pathname
  const customerImports = ['src/app', 'src/components']
    .flatMap((dir) => (readdirSync(root + dir, { recursive: true }) as string[]).map((f) => `${dir}/${f.split('\\').join('/')}`))
    .filter((f) => /\.(ts|tsx)$/.test(f) && /member-response/.test(readFileSync(root + f, 'utf8')))
    .sort()
  expect('S4 member-response 를 import 하는 화면은 운영 콘솔 /admin/responses 뿐', customerImports, ['src/app/admin/(ops)/responses/page.tsx'])
  const actions = code('src/lib/actions/operator-compose.ts')
  const compose = code('src/app/admin/(ops)/compose/page.tsx')
  const tx = code('src/lib/operator-compose-tx.ts')
  expect('S5 저장 뒤 목록 다시 그림(등록·수정/삭제 둘 다) · from 은 리터럴 비교만 · 저장 tx 의 글쓴이 차단 확인',
    [(actions.match(/revalidatePath\('\/admin\/responses'\)/g) ?? []).length, /from === 'responses'/.test(compose), /backHref: '\/admin\/responses'/.test(compose), /href=\{?from/.test(compose), /tx\.userBlock\.findUnique\(/.test(tx)],
    [2, true, true, false, true])
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
