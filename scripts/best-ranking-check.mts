#!/usr/bin/env tsx
/**
 * /best 입성 기준(best-v2) — 순수 검사 · 쪽 계산 · 쓰기 경로 연결 · 옛 순위 정책 재유입 가드.
 *
 * 기준·가중치는 src/lib/best-ranking.ts 한 곳이다. 여기 숫자를 다시 적지 않는다 —
 * 기대값은 "제품 계약"(W=1 미진입 · W=2 진입 · 12개씩 제한 없음)으로 쓴다.
 *
 * DB 가 필요한 계약(무엇을 실반응으로 세는가 · 최초 1회 입성 · 트랜잭션 · 동시성 · 목록/개수)은
 * `npm run best:db-check`(격리 DB 전용)가 본다.
 */
import {
  BEST_ENTRY_WEIGHT,
  BEST_POLICY_VERSION,
  BEST_V2_UNUSED_COLUMNS,
  GUEST_COMMENT_CAP,
  meetsBestEntry,
  reactionWeight,
  type RealReactions,
} from '../src/lib/best-ranking'
import {
  BEST_PAGE_SIZE,
  buildListHref,
  isPageOutOfRange,
  lastPageOf,
  parsePageParam,
} from '../src/lib/list-query'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${!ok && detail ? ` — ${detail}` : ''}`)
}
const R = (likes: number, memberCommenters: number, guestComments: number): RealReactions => ({ likes, memberCommenters, guestComments })
const enters = (r: RealReactions) => meetsBestEntry(reactionWeight(r))

console.log('\n■ 1. 입성 기준 — W ≥ 2 (공감 1 · 댓글 단 실회원 1명 = 2 · 비회원 댓글 1건 = 2)')
check('입성 기준 값 = 2', BEST_ENTRY_WEIGHT === 2)
check('반응 0 → W 0 · 미진입', reactionWeight(R(0, 0, 0)) === 0 && !enters(R(0, 0, 0)))
check('실회원 공감 1 → W 1 · 미진입', reactionWeight(R(1, 0, 0)) === 1 && !enters(R(1, 0, 0)))
check('실회원 공감 2 → W 2 · 진입', reactionWeight(R(2, 0, 0)) === 2 && enters(R(2, 0, 0)))
check('댓글 단 실회원 1명 → W 2 · 진입', reactionWeight(R(0, 1, 0)) === 2 && enters(R(0, 1, 0)))
check('비회원 댓글 1건 → W 2 · 진입', reactionWeight(R(0, 0, 1)) === 2 && enters(R(0, 0, 1)))
check('공감 1 + 실회원 1명 + 비회원 1건 → W 5', reactionWeight(R(1, 1, 1)) === 5)
check(
  `비회원 댓글은 ${GUEST_COMMENT_CAP}건에서 멈춘다`,
  reactionWeight(R(0, 0, 1_000)) === reactionWeight(R(0, 0, GUEST_COMMENT_CAP)) && reactionWeight(R(0, 0, 1_000)) === 6,
)
const extremes = [NaN, Infinity, -Infinity, -5, 1e308, Number.MAX_SAFE_INTEGER, 1.9]
check(
  'NaN·Infinity·음수·1e308·소수 입력에서도 W 가 유한한 0 이상 정수',
  extremes.every((x) => {
    const w = reactionWeight(R(x, x, x))
    return Number.isInteger(w) && w >= 0
  }),
)
check('W 1.9 는 1 로 누른다 — 미진입', !meetsBestEntry(1.9) && meetsBestEntry(2) && !meetsBestEntry(NaN) && !meetsBestEntry(-3))
check('정책 판 = best-v2', BEST_POLICY_VERSION === 'best-v2')
check('best-v2 가 쓰지 않는 필수 칼럼은 0("해당 없음")', BEST_V2_UNUSED_COLUMNS.scoreAtEntry === 0 && BEST_V2_UNUSED_COLUMNS.peakRank === 0)

console.log('\n■ 2. 쪽 — 12는 쪽 크기다. 전체 상한이 없다')
check('쪽 크기 = 12', BEST_PAGE_SIZE === 12)
const pageOf = (nth: number) => Math.floor((nth - 1) / BEST_PAGE_SIZE) + 1
check('1·12번째 입성 글 → 1쪽 · 13번째 → 2쪽 · 24번째 → 2쪽 · 25번째 → 3쪽',
  [pageOf(1), pageOf(12), pageOf(13), pageOf(24), pageOf(25)].join() === '1,1,2,2,3')
check('기록 0 → 마지막 쪽 1 (빈 1쪽은 200, 2쪽은 404)',
  lastPageOf(0, BEST_PAGE_SIZE) === 1 && !isPageOutOfRange(1, 0, BEST_PAGE_SIZE) && isPageOutOfRange(2, 0, BEST_PAGE_SIZE))
check('기록 12·13·24·25 → 마지막 쪽 1·2·2·3',
  [12, 13, 24, 25].map((n) => lastPageOf(n, BEST_PAGE_SIZE)).join() === '1,2,2,3')
check('기록 1,000 → 마지막 쪽 84 · 84쪽은 4개 · 85쪽은 범위 밖',
  lastPageOf(1_000, BEST_PAGE_SIZE) === 84 && 1_000 - 83 * BEST_PAGE_SIZE === 4 &&
    !isPageOutOfRange(84, 1_000, BEST_PAGE_SIZE) && isPageOutOfRange(85, 1_000, BEST_PAGE_SIZE))
check('거대한 page 는 안전 정수로 눌려 범위 밖 → 404 (skip 을 만들지 않는다)',
  isPageOutOfRange(parsePageParam('999999999999999999999999'), 1_000_000, BEST_PAGE_SIZE))
const odd = ['0', '-1', '3.9', 'abc', '7abc', ' 7 ', '', undefined, ['2', '5']]
check('0·음수·소수·문자 섞임은 1쪽, 배열은 첫 값 (게시판과 같은 정규화)',
  odd.map((v) => parsePageParam(v as string | string[] | undefined)).join(',') === '1,1,1,1,1,1,1,1,2')
check("1쪽 주소는 '/best' — ?page=1 을 만들지 않는다", buildListHref('/best', { page: 1 }) === '/best')
check("2쪽 주소는 '/best?page=2'", buildListHref('/best', { page: 2 }) === '/best?page=2')

// ── 소스 검사 ───────────────────────────────────────────────────────
const files: string[] = []
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const f = join(d, n)
    if (statSync(f).isDirectory()) walk(f)
    else if (/\.(ts|tsx)$/.test(n)) files.push(f)
  }
}
walk('src')
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const code = (f: string) => strip(readFileSync(f, 'utf-8'))
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length
const db = code('src/lib/best-ranking-db.ts')
const body = (name: string) => {
  const at = db.indexOf(`export async function ${name}(`)
  const next = db.indexOf('\nexport ', at + 1)
  return at < 0 ? '' : db.slice(at, next < 0 ? undefined : next)
}

console.log('\n■ 3. 쓰기 경로 — syncBestEligibility(tx) 하나로 W 와 최초 입성을 함께 본다')
{
  /** 사건 → 파일 · 그 파일에서 tx 로 부르는 syncBestEligibility 수 */
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
    const viaTx = count(c, /\bsyncBestEligibility\(\s*tx\b/g)
    const any = count(c, /\bsyncBestEligibility\(/g)
    check(`${w.events}: syncBestEligibility(tx, …) ${w.calls}곳 · 트랜잭션 밖 호출 0`, viaTx === w.calls && any === w.calls, `tx ${viaTx} · 전체 ${any}`)
  }
  check('회원 차단·해제: applyMemberBlock 을 트랜잭션 안에서 부른다',
    /\$transaction\(\s*\(tx\)\s*=>\s*applyMemberBlock\(\s*tx\b/.test(code('src/lib/actions/admin.ts')))
  const outside = files.filter((f) => !f.endsWith('best-ranking-db.ts'))
  const callers = outside.filter((f) => /\bsyncBestEligibility\s*\(/.test(code(f))).sort()
  check('syncBestEligibility 를 부르는 파일 = 위 사건 목록 그대로 (새 호출부는 목록에 먼저 올린다)',
    callers.join() === WRITERS.map((w) => w.file).sort().join(), callers.join(', '))
  const block = body('applyMemberBlock')
  check('applyMemberBlock: 영향 글을 postId 순으로 하나씩 syncBestEligibility',
    /\]\.sort\(\)/.test(block) && /for \(const postId of postIds\)[\s\S]{0,80}syncBestEligibility\(db, postId\)/.test(block))
}

console.log('\n■ 4. 기록은 한 번 — 지우지 않고 고치지 않는다')
{
  const all = files.map(code).join('\n')
  check('src/ 에 BestSelection 을 고치거나 지우는 코드 0 (update · upsert · delete)',
    !/bestSelection\.(update|updateMany|upsert|delete|deleteMany)\b/.test(all))
  const sync = body('syncBestEligibility')
  check('syncBestEligibility: 그 글을 잠근 뒤 W 를 세고, 기준·공개 자격일 때만 기록',
    sync.indexOf('lockPost(') >= 0 && sync.indexOf('lockPost(') < sync.indexOf('countRealReactions(') &&
      /meetsBestEntry\(weight\)\s*&&\s*isBestPublic\(post\)/.test(sync))
  check('최초 입성 기록은 createMany + skipDuplicates (글당 한 행 · 충돌이 요청을 실패시키지 않는다)',
    /bestSelection\.createMany\(\{[\s\S]{0,200}skipDuplicates:\s*true/.test(db))
}

console.log('\n■ 5. 옛 순위 정책(best-v1)이 돌아오지 않는다')
{
  const all = files.map((f) => ({ f, c: code(f) }))
  const hit = (re: RegExp) => all.filter((x) => re.test(x.c)).map((x) => x.f)
  const sync = body('syncBestEligibility')
  check('입성 판정이 전역 글 목록을 읽지 않는다 — syncBestEligibility 안에 post.findMany 0',
    !/\.post\.findMany\(/.test(sync) && !/\.post\.findMany\(/.test(body('applyMemberBlock')))
  check('Post.bestRankScore 를 읽거나 쓰는 src 코드 0 (deprecated)', hit(/\bbestRankScore\b/).length === 0, hit(/\bbestRankScore\b/).join(', '))
  check('peakRank 는 "해당 없음" 상수 한 곳에서만 나온다 (갱신 코드 0)',
    hit(/\bpeakRank\b/).join() === 'src/lib/best-ranking.ts', hit(/\bpeakRank\b/).join(', '))
  const legacy = /\b(recordBestEntries|recomputePostRanking|syncBestRanking|BEST_RANK_ORDER|BEST_CURRENT_SIZE|BEST_GLOBAL_WHERE|hasValidReaction|sameRankScore|reactionBoostSeconds|bestLastPage)\b/
  check('옛 순위 심볼(전역 12개 기록 · 순위 키 · current/archive 쪽 계산) 0', hit(legacy).length === 0, hit(legacy).join(', '))
  const q = code('src/lib/queries/best.ts')
  check('목록 정렬 = firstEnteredAt desc · postId desc (입성 최신순 · 안정 키)',
    /orderBy:\s*\[\{\s*firstEnteredAt:\s*'desc'\s*\},\s*\{\s*postId:\s*'desc'\s*\}\]/.test(q))
  check('모든 쪽이 같은 계산 — skip = (page - 1) × 12 · current/archive 분기 0',
    /skip:\s*\(page - 1\) \* BEST_PAGE_SIZE/.test(q) && !/'current'|'archive'|kind:/.test(q))
  check('목록과 개수가 같은 where', /count\(\{\s*where\s*\}\)/.test(q) && /findMany\(\{\s*where,/.test(q))
  const page = code('src/app/best/page.tsx')
  check('/best 화면: 순위 숫자(rank=) 0 · "지난 베스트" 0 · <ol> 0', !/\brank=/.test(page) && !page.includes('지난 베스트') && !/<ol\b/.test(page))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} best-ranking-check: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
