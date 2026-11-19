/**
 * 수집 원천 · 바퀴 몫 검사 — 🔴 동작을 잰다. 네트워크 0 · DB 0 · 카페 요청 0
 *
 *   ① 13바퀴를 어떻게 돌아도(최악 포함) 카페 하루 상한 · 계정 전체 상한을 넘지 않는다
 *   ② 몫은 새 글 수에 비례한다 — 새벽 바퀴는 작고, 마지막 바퀴는 남은 예산을 쓴다
 *   ③ 목록은 쪽이 전부 새 글일 때만 다음 쪽 · 날짜만 아는 새 글은 앞 목록 시각이 하한
 *   ④ 보호장치가 계정 전체 상한을 본다 · 403 · 429 · 로그인 화면이 각자의 코드로 남는다
 *   ⑤ 상세 원장의 사유 칸 — 옛 줄은 사유 없음으로 읽힌다
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ACCOUNT_DAILY_REQUESTS, COLLECT_SOURCES, cycleDetailQuota, cyclesAfterMinute, detailCeilingPerDay, expectedLaterNew,
  isNewSince, listMarkOf, overheadPerCycle, postedAfterOf, readNextPage, sourceIdOf, SOURCE_IDS,
} from '../src/lib/collect-sources'
import { CYCLES } from '../src/lib/cycle-schedule'
import { canRequest, newGuardState } from '../src/lib/collect-guard'
import { failureCodeOf, judgeRunHealth, type CollectRunRecord } from '../src/lib/collect-run-record'
import { guardedNavigate, GuardedNavigationError, readGuard, resetGuardRoot, setGuardRoot } from './lib/collect-guard-store.mjs'
import { readLedgerAt } from './lib/collect-run-store.mjs'
import { boardListUrl, isLoginWallUrl } from './lib/micro-seed-navercafe.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) pass += 1
  else { fail += 1; console.log(`  🔴 FAIL  ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}

console.log('\n══ 수집 원천 · 바퀴 몫 ══\n')

// ── 원천 목록 ──
check('원천 id 가 겹치지 않는다', new Set(COLLECT_SOURCES.map((s) => s.id)).size === COLLECT_SOURCES.length)
check('보호장치 이름은 원천 목록에서 만든다', SOURCE_IDS.length === COLLECT_SOURCES.length
  && COLLECT_SOURCES.every((s) => SOURCE_IDS.includes(sourceIdOf(s.id))))
check('카페 하루 상한 합이 계정 전체 상한 안이다', COLLECT_SOURCES.reduce((n, s) => n + s.dailyRequests, 0) <= ACCOUNT_DAILY_REQUESTS)
check('바퀴마다 목록을 다 읽어도 본문 몫이 남는다', COLLECT_SOURCES.every((s) => detailCeilingPerDay(s) > 0))
check('목록 주소가 원천 줄의 카페 번호 · 게시판을 쓴다',
  COLLECT_SOURCES.every((s) => boardListUrl(s, 2) === `https://cafe.naver.com/f-e/cafes/${s.cafeNo}/menus/${s.menuId}?viewType=L&page=2`))

// ── ① 하루 상한 — 13바퀴 시뮬레이션 ──
type Sim = { used: number; accountUsed: number; quotas: number[]; minLeftAtStart: number }
/**
 * 한 원천의 하루. 바퀴마다 회원 확인 + 목록(`pagesRead`)을 먼저 쓰고 몫을 정한다 — 수집기와 같은 순서다.
 * `extraBefore` 는 그 바퀴 전에 끼어든 요청(수동 실행 · 실패한 재시도)이다.
 */
function simulate(s: (typeof COLLECT_SOURCES)[number], o: {
  newAt: (i: number) => number
  expected: (i: number) => number | null
  pagesRead?: (i: number) => number
  extraBefore?: (i: number) => number
  accountLimit?: number
  otherAccountUsed?: number
}): Sim {
  let used = 0
  let minLeft = Number.POSITIVE_INFINITY
  const quotas: number[] = []
  const accountLimit = o.accountLimit ?? ACCOUNT_DAILY_REQUESTS
  for (let i = 0; i < CYCLES.length; i += 1) {
    // 🔴 끼어든 요청도 보호장치를 지난다 — 상한을 넘는 요청은 나가지 않는다
    used += Math.min(o.extraBefore?.(i) ?? 0, Math.max(0, Math.min(s.dailyRequests, accountLimit - (o.otherAccountUsed ?? 0)) - used))
    const left = Math.min(s.dailyRequests - used, accountLimit - (o.otherAccountUsed ?? 0) - used)
    minLeft = Math.min(minLeft, left)
    // 🔴 수집기는 남은 예산이 바퀴 최소(회원 확인 · 목록 + 본문 1)보다 적으면 요청 0 으로 끝낸다
    if (left < overheadPerCycle(s) + 1) { quotas.push(0); continue }
    used += 1 + Math.min(s.maxListPages, o.pagesRead?.(i) ?? s.maxListPages)
    const q = cycleDetailQuota({
      dailyLimit: s.dailyRequests, usedToday: used, accountLimit, accountUsedToday: (o.otherAccountUsed ?? 0) + used,
      cyclesAfter: cyclesAfterMinute(CYCLES[i]!.minute + 1), overheadPerCycle: overheadPerCycle(s),
      newCount: o.newAt(i), expectedLater: o.expected(i),
    }).quota
    quotas.push(q)
    used += q
  }
  return { used, accountUsed: (o.otherAccountUsed ?? 0) + used, quotas, minLeftAtStart: minLeft }
}

for (const s of COLLECT_SOURCES) {
  const worst = [
    { name: '새 글이 늘 넘친다 · 어제 기록 없음', newAt: () => 999, expected: () => null },
    { name: '새 글이 넘치는데 "뒤에 새 글 없다" 고 믿는다', newAt: () => 999, expected: () => 0 },
    { name: '새 글이 넘치는데 뒤 예상이 터무니없이 크다', newAt: () => 999, expected: () => 1e9 },
    { name: '바퀴마다 끼어든 요청 5건', newAt: () => 999, expected: () => 0, extraBefore: () => 5 },
    { name: '목록 쪽을 다 읽지 않은 바퀴가 섞인다', newAt: (i: number) => (i % 2 === 0 ? 999 : 1), expected: () => null, pagesRead: (i: number) => (i % 3) + 1 },
  ]
  for (const w of worst) {
    const r = simulate(s, w)
    check(`🔴 [${s.id}] ${w.name} — 하루 ${r.used} ≤ 상한 ${s.dailyRequests}`, r.used <= s.dailyRequests, String(r.used))
  }
  // 🔴 남은 바퀴의 목록 몫을 먼저 뗐으므로, 끼어든 요청이 없으면 마지막 바퀴까지 목록을 읽을 수 있다
  const greedy = simulate(s, { newAt: () => 999, expected: () => 0 })
  check(`🔴 [${s.id}] 앞 바퀴가 몫을 다 써도 마지막 바퀴까지 목록을 읽고 하나는 열 예산이 남는다`,
    greedy.minLeftAtStart >= overheadPerCycle(s) + 1, String(greedy.minLeftAtStart))
  check(`[${s.id}] 끼어든 요청이 없으면 상한을 거의 다 쓴다(놀리지 않는다)`, greedy.used >= s.dailyRequests - 1, String(greedy.used))
  // 🔴 계정 전체 상한 — 다른 카페가 이미 많이 썼으면 이 카페 몫이 줄어든다
  const shared = simulate(s, { newAt: () => 999, expected: () => null, accountLimit: 200, otherAccountUsed: 120 })
  check(`🔴 [${s.id}] 계정 전체 상한(200 · 다른 카페 120)을 넘지 않는다 — ${shared.accountUsed}`, shared.accountUsed <= 200, String(shared.accountUsed))
}

// ── ② 새 글 비례 ──
{
  // 시간대별 새 글(우아한 갱년기 7일 평균 · R1 §4-3) — 어제도 오늘도 같다고 둔다
  const arrivals = [24, 5, 2, 9, 22, 23, 17, 16, 33, 30, 12, 24, 21]
  const history = CYCLES.map((c, i) => ({ minute: c.minute + 1, newSincePrevious: arrivals[i]! }))
  const s = COLLECT_SOURCES.find((x) => x.id === 'wgang')!
  const r = simulate(s, { newAt: (i) => arrivals[i]!, expected: (i) => expectedLaterNew(history, CYCLES[i]!.minute + 1) })
  check('🔴 몫은 새 글 수를 넘지 않는다', r.quotas.every((q, i) => q <= arrivals[i]!), r.quotas.join(' '))
  check('🔴 새벽(04:00 · 06:30) 몫이 오후(15:20) 몫보다 작다', r.quotas[1]! < r.quotas[8]! && r.quotas[2]! < r.quotas[8]!, r.quotas.join(' '))
  check('🔴 간격 비례가 아니다 — 3시간 바퀴(04:00)가 1시간 바퀴(12:20)보다 적게 연다', r.quotas[1]! < r.quotas[6]!, r.quotas.join(' '))
  check('하루 상한 안이다', r.used <= s.dailyRequests, String(r.used))
  const last = cycleDetailQuota({ dailyLimit: 150, usedToday: 100, accountLimit: 300, accountUsedToday: 100, cyclesAfter: 0, overheadPerCycle: 4, newCount: 30, expectedLater: 999 })
  check('🔴 오늘 마지막 바퀴는 남은 예산을 쓴다(새 글 수까지)', last.quota === 30)
  check('새 글 0 이면 몫 0', cycleDetailQuota({ dailyLimit: 150, usedToday: 0, accountLimit: 300, accountUsedToday: 0, cyclesAfter: 5, overheadPerCycle: 2, newCount: 0, expectedLater: null }).quota === 0)
  check('새 글이 있고 예산이 있으면 적어도 1건', cycleDetailQuota({ dailyLimit: 150, usedToday: 0, accountLimit: 300, accountUsedToday: 0, cyclesAfter: 12, overheadPerCycle: 2, newCount: 1, expectedLater: 500 }).quota === 1)
  check('어제 기록이 없으면 null(고르게 나눈다)', expectedLaterNew([], 60) === null)
  check('오늘 마지막 바퀴 뒤 예상은 0', expectedLaterNew(history, 23 * 60) === 0)
  check('빠진 바퀴는 있는 바퀴 평균으로 채운다',
    expectedLaterNew([{ minute: CYCLES[11]!.minute + 2, newSincePrevious: 10 }], CYCLES[10]!.minute + 1) === 20)
}

// ── ③ 목록 · 새 글 · 게시 시각 하한 ──
{
  const mark = listMarkOf([{ sourceArticleId: '100' }, { sourceArticleId: '120' }, { sourceArticleId: '999', sourcePinned: true }], '2026-11-19T13:20:00.000Z')
  check('표식은 고정 글을 빼고 가장 큰 번호다', mark?.maxArticleId === 120)
  check('표식보다 큰 번호가 새 글이다', isNewSince({ sourceArticleId: '121' }, mark) && !isNewSince({ sourceArticleId: '120' }, mark))
  check('고정 글은 새 글이 아니다', !isNewSince({ sourceArticleId: '500', sourcePinned: true }, mark))
  check('표식이 없으면 새 글이라 말하지 않는다', !isNewSince({ sourceArticleId: '500' }, null))
  const page = (ids: string[]): { sourceArticleId: string }[] => ids.map((i) => ({ sourceArticleId: i }))
  check('🔴 쪽이 전부 새 글이면 다음 쪽을 읽는다', readNextPage({ pageRows: page(['130', '125']), mark, page: 1, maxPages: 3 }))
  check('🔴 앞 바퀴가 본 글이 하나라도 있으면 멈춘다', !readNextPage({ pageRows: page(['130', '119']), mark, page: 1, maxPages: 3 }))
  check('최대 쪽이면 멈춘다', !readNextPage({ pageRows: page(['130']), mark, page: 3, maxPages: 3 }))
  check('첫 회차(표식 없음)는 최대 쪽까지 읽는다', readNextPage({ pageRows: page(['1']), mark: null, page: 1, maxPages: 3 }))
  check('빈 쪽이면 멈춘다', !readNextPage({ pageRows: [], mark: null, page: 1, maxPages: 3 }))
  check('쫑알은 1쪽만 읽는다', !readNextPage({ pageRows: page(['999']), mark: null, page: 1, maxPages: COLLECT_SOURCES.find((s) => s.id === 'remonterrace')!.maxListPages }))
  check('🔴 날짜만 아는 새 글 → 앞 목록을 읽은 시각이 하한', postedAfterOf({ sourceArticleId: '130', sourcePostedDay: '2026-11-19' }, mark) === '2026-11-19T13:20:00.000Z')
  check('시각을 아는 글에는 하한을 붙이지 않는다', postedAfterOf({ sourceArticleId: '130', sourcePostedDay: null }, mark) === null)
  check('앞 바퀴가 본 글에는 하한을 붙이지 않는다', postedAfterOf({ sourceArticleId: '110', sourcePostedDay: '2026-11-19' }, mark) === null)
}

// ── ④ 보호장치 · 차단 코드 ──
{
  const g = newGuardState('navercafe:wgang', '2026-11-19')
  check('🔴 계정 전체 사용량이 상한이면 요청을 막는다', canRequest(g, 0, { accountUsedToday: ACCOUNT_DAILY_REQUESTS }).blockedBy === 'accountBudget')
  check('계정 전체 사용량이 상한 아래면 통과', canRequest(g, 0, { accountUsedToday: ACCOUNT_DAILY_REQUESTS - 1 }).ok)
  check('카페 상한은 원천 줄에서 온다', !canRequest({ ...g, requestsToday: 150 }, 0).ok && canRequest({ ...g, requestsToday: 149 }, 0).ok)
  check('403 → HTTP_403', failureCodeOf({ blockedBy: 'FORBIDDEN', message: 'x' }) === 'HTTP_403')
  check('429 → HTTP_429', failureCodeOf({ blockedBy: 'RATE_LIMIT', message: 'x' }) === 'HTTP_429')
  check('로그인 화면 → LOGIN_WALL', failureCodeOf({ loginWall: true, blockedBy: 'FORBIDDEN', message: 'x' }) === 'LOGIN_WALL')
  check('목록 0건 → SELECTOR', failureCodeOf({ message: '목록이 비었다 [SELECTOR_ZERO]' }) === 'SELECTOR')
  check('로그인 화면 주소를 알아본다', isLoginWallUrl('https://nid.naver.com/nidlogin.login?url=x') && !isLoginWallUrl('https://cafe.naver.com/wgang/1'))
  const rec = (code: CollectRunRecord['code']): CollectRunRecord => ({
    runId: 'r1', source: 'navercafe:wgang', trigger: 'schedule', mode: 'detail', status: 'failed', startedAt: '2026-11-19T00:00:00.000Z',
    endedAt: '2026-11-19T00:01:00.000Z', code, listRows: 0, detailRequests: 0, bodyRows: 0, thinRows: 0, skippedSeen: 0, repeatedRows: 0, newUniqueThinRows: 0,
  })
  check('🔴 403 회차는 관제에 CRITICAL 로 오른다', judgeRunHealth([rec('HTTP_403')]).code === 'RUN_HTTP_403' && judgeRunHealth([rec('HTTP_403')]).level === 'CRITICAL')

  // 🔴 실제 보호장치 경로 — 403 응답이 분류값을 실은 오류로 나오고, 다음 요청은 차단기가 막는다
  const root = mkdtempSync(join(tmpdir(), 'collect-sources-check-'))
  setGuardRoot(root)
  try {
    const now = (): Date => new Date('2026-11-19T03:00:00.000Z')
    let first: unknown = null
    try { await guardedNavigate({ url: 'https://cafe.naver.com/x', source: 'navercafe:wgang', now, goto: async () => ({ status: () => 403 }) }) } catch (e) { first = e }
    check('🔴 403 이면 FORBIDDEN 을 실은 오류', first instanceof GuardedNavigationError && first.blockedBy === 'FORBIDDEN')
    let second: unknown = null
    try { await guardedNavigate({ url: 'https://cafe.naver.com/x', source: 'navercafe:wgang', now, goto: async () => ({ status: () => 200 }) }) } catch (e) { second = e }
    check('🔴 403 뒤 다음 요청은 차단기가 막고, 막은 이유도 FORBIDDEN 이다', second instanceof GuardedNavigationError && second.blockedBy === 'FORBIDDEN')
    check('막힌 요청은 예산을 쓰지 않는다', readGuard('navercafe:wgang', now()).requestsToday === 1)
  } finally { resetGuardRoot(); rmSync(root, { recursive: true, force: true }) }
}

// ── ⑤ 상세 원장 사유 칸 ──
{
  const dir = mkdtempSync(join(tmpdir(), 'collect-ledger-'))
  try {
    const p = join(dir, 'l.jsonl')
    const old = { articleId: '1', outcome: 'dropped', at: '2026-11-01T00:00:00.000Z', runId: 'r', attempts: 1 }
    writeFileSync(p, `${JSON.stringify(old)}\n${JSON.stringify({ ...old, articleId: '2', reasons: ['DROP', 'imageDependent'] })}\n`)
    const r = readLedgerAt(p)
    check('🔴 옛 줄(사유 없음)과 새 줄이 섞여도 읽힌다', r.ok && r.entries.size === 2)
    check('옛 줄은 사유 없음으로 읽힌다', r.ok && r.entries.get('1')?.reasons === undefined)
    check('새 줄의 사유가 남는다', r.ok && r.entries.get('2')?.reasons?.join() === 'DROP,imageDependent')
    writeFileSync(p, `${JSON.stringify({ ...old, reasons: 'DROP' })}\n`)
    check('사유 칸 모양이 틀리면 멈춘다(이미 본 글을 모르면 다시 연다)', !readLedgerAt(p).ok)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
process.exit(fail === 0 ? 0 : 1)
