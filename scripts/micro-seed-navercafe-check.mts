#!/usr/bin/env tsx
/**
 * 네이버 카페 수집 계약 fixture — 🔴 브라우저 · 네트워크 · DB 없음
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-A · §5-A~D
 *
 * 🔴 **live 없이 전부 검증된다.** Playwright 가 설치돼 있지 않아도 돈다 —
 *    lib 는 네트워크를 타지 않고, collector 는 소스 스캔으로만 본다.
 *
 * 🔴 여기서 막는 사고
 *    ① 우나어 세션을 재사용해 한쪽이 막히면 둘 다 멈추는 것
 *    ② 네이버 원문이 Candidate · Sheet · Post · Queue 로 새는 것
 *    ③ articleId 파싱이 URL 형태 하나만 처리해 나머지가 조용히 사라지는 것
 *    ④ 카페별 주제를 고정 라벨로 굳혀 글 단위 판정을 대체하는 것
 *    ⑤ quota 가 82cook 과 같아져 계정 위험을 과소평가하는 것
 *
 * 사용법: npx tsx scripts/micro-seed-navercafe-check.mts
 */
import { readFileSync } from 'node:fs'
import {
  CAFES, findCafe, sourceSiteOf, slotQuota, buildCollected, assertNaverCandidate,
  judgeSession, judgeLock, randomDelay, parseArticleId, computeDedupKey,
  LIST_URL, ARTICLE_URL, DELAY_LIST_MS, DELAY_ARTICLE_MS,
  LOCK_MAX_AGE_MS, RUN_TIMEOUT_MS, FIRST_LIVE_CAFE_ID, FIRST_LIVE_PAGES, FIRST_LIVE_ARTICLES,
  SESSION_PATH_ENV, KILL_SWITCH_ENV,
  DEFAULT_SESSION_PATH, PLAYWRIGHT_SPECS, BROWSER_CHANNEL_ENV, DEFAULT_BROWSER_CHANNEL,
  browserLaunchOptions, isUnaoSessionPath, isSessionPathIgnored, summarizeCookies, AUTH_COOKIE_NAMES,
  parsePostedLabel, normalizeCount,
  safeFrameLabel, diagnoseEmptyList, summarizeProbes, judgeLockRelease,
  LOCK_MAX_AGE_MS as LOCK_TTL, type FrameProbe,
  LIST_SELECTORS, runIdOf, runOutputPath,
  BOARD_TARGETS, findBoard, boardListUrl, pagesOf, activeCafes,
  detectRowLabel, judgePoliticsTitle, SCOUT_MAX_PAGES, DETAIL_MAX_PAGES, maxPagesFor,
  judgeExcludeReason, dedupeListRows, THRESHOLD_CANDIDATES, passesThreshold, thresholdBasis,
  type CollectedCandidate,
} from './lib/micro-seed-navercafe.mjs'
import { isNaverCafeSource, judgeSourceSite, SLOT_QUOTA } from './lib/micro-seed-supply.mjs'

let failed = 0
const ok = (l: string) => console.log(`  ✅ ${l}`)
const bad = (l: string, d: string) => { console.error(`  ❌ ${l}\n     ${d}`); failed += 1 }
const check = (l: string, c: boolean, d = '') => (c ? ok(l) : bad(l, d))

const COLLECTOR = readFileSync('scripts/micro-seed-collect-navercafe.mts', 'utf-8')
const LIB = readFileSync('scripts/lib/micro-seed-navercafe.mts', 'utf-8')
const SETUP = readFileSync('scripts/navercafe-session-setup.mts', 'utf-8')
const IMPORTER = readFileSync('scripts/micro-seed-import-82cook-live.mts', 'utf-8')
const SUPPLY_DOC = readFileSync('docs/operations/2026-09-03-raw-supply-chain-design.md', 'utf-8')
const GITIGNORE = readFileSync('.gitignore', 'utf-8')

/**
 * 🔴 주석을 걷어낸 **코드만** 남긴다.
 *
 *    "없어야 한다" 를 원문에 대고 검사하면 그것을 설명하는 주석이 걸린다 —
 *    이 저장소의 fixture 가 같은 실수를 네 번 반복했다
 *    (`createdPostId:` · `--apply` · `personaGlobalSwitch` · `SOURCE_SITE`).
 *    부정 스캔은 반드시 이 함수를 지난다.
 */
const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const COLLECTOR_CODE = codeOf(COLLECTOR)
const LIB_CODE = codeOf(LIB)
const SETUP_CODE = codeOf(SETUP)
const IMPORTER_CODE = codeOf(IMPORTER)

console.log('\n네이버 카페 수집 계약 fixture\n')

// ─────────────────────────────────────────────────────────
console.log('① sourceSite · dedupKey 계약 (PR-S2-b-1 과 동일해야 한다)')
// ─────────────────────────────────────────────────────────
check('sourceSiteOf 가 navercafe:{cafeId} 를 만든다', sourceSiteOf('remonterrace') === 'navercafe:remonterrace')
for (const c of CAFES) {
  check(`[${c.cafeId}] supply 의 형태 검사를 통과한다`, isNaverCafeSource(sourceSiteOf(c.cafeId)))
  check(`[${c.cafeId}] 🔴 raw-only 는 받고 micro-seed 는 거부한다`,
    judgeSourceSite(sourceSiteOf(c.cafeId), 'raw-only').ok
      && !judgeSourceSite(sourceSiteOf(c.cafeId), 'micro-seed').ok)
}
{
  const a = computeDedupKey('navercafe:remonterrace', '34783204')
  check('dedupKey 는 sha256:{hex}', /^sha256:[0-9a-f]{64}$/.test(a))
  check('🔴 카페가 다르면 키가 다르다',
    a !== computeDedupKey('navercafe:wgang', '34783204'),
    '네이버 articleId 는 카페 안에서만 유일하다 — cafeId 가 빠지면 한쪽이 조용히 SKIP 된다')
  check('실측 행과 같은 값이 나온다 (navercafe:remonterrace · 34783204)',
    computeDedupKey(sourceSiteOf('remonterrace'), '34783204') === a)
}

// ─────────────────────────────────────────────────────────
console.log('\n② articleId 파싱 — 🔴 URL 형태가 여러 가지다')
// ─────────────────────────────────────────────────────────
const URLS: [string, string | null][] = [
  ['https://cafe.naver.com/remonterrace/34783204', '34783204'],
  ['https://cafe.naver.com/f-e/cafes/10298136/articles/34783204', '34783204'],
  ['/ArticleRead.nhn?clubid=10298136&articleid=34783204', '34783204'],
  ['https://cafe.naver.com/wgang/12345?page=2', '12345'],
  ['https://cafe.naver.com/x/ArticleList.nhn?search.menuid=0', null],
  ['https://cafe.naver.com/remonterrace', null],
  ['', null],
]
for (const [url, want] of URLS) {
  check(`파싱 ${url.slice(0, 46) || '(빈 문자열)'} → ${want ?? 'null'}`, parseArticleId(url) === want, String(parseArticleId(url)))
}
check('🔴 목록 URL 을 글 URL 로 오인하지 않는다', parseArticleId(LIST_URL('wgang', 1)) === null, parseArticleId(LIST_URL('wgang', 1)) ?? '')
check('ARTICLE_URL 은 다시 파싱된다', parseArticleId(ARTICLE_URL('wgang', '999')) === '999')

// ─────────────────────────────────────────────────────────
console.log('\n③ quota — 🔴 82cook 과 달라야 한다 (계정 정지는 비가역)')
// ─────────────────────────────────────────────────────────
for (const c of CAFES) check(`[${c.cafeId}] 슬롯 quota 10`, slotQuota(c.cafeId) === 10, String(slotQuota(c.cafeId)))
check('🔴 82cook(30) 보다 작다', slotQuota('remonterrace') < SLOT_QUOTA['82cook'])
check('🔴 우나어의 카페당 80 을 쓰지 않는다', slotQuota('remonterrace') <= 10)
check('첫 live 기본값이 작다 — 1카페 · 1p · 3건',
  FIRST_LIVE_CAFE_ID === 'remonterrace' && FIRST_LIVE_PAGES === 1 && FIRST_LIVE_ARTICLES === 3)
check('🔴 collector 가 quota 를 상한으로 강제한다', /--max 는 1~\$\{QUOTA\}/.test(COLLECTOR))
check('🔴 quota 숫자를 lib 에서 다시 적지 않는다 (supply 경유)',
  /slotQuotaOf\(sourceSiteOf\(cafeId\)\)/.test(LIB) && !/navercafe['"]?\s*:\s*\d+/.test(LIB_CODE),
  '두 곳에 적으면 갈라진다')

// ─────────────────────────────────────────────────────────
console.log('\n④ pacing — 🔴 사람 속도 (82cook 고정 2초와 다르다)')
// ─────────────────────────────────────────────────────────
check('목록 간격이 82cook(2000) 보다 느리다', DELAY_LIST_MS > 2000)
check('상세 간격도 느리다', DELAY_ARTICLE_MS > 2000)
check('randomDelay 하한 = base×0.8', randomDelay(1000, 0.8, 1.5, () => 0) === 800)
check('randomDelay 상한 ≈ base×1.5', randomDelay(1000, 0.8, 1.5, () => 1) === 1500)
check('중간값이 범위 안', (() => { const v = randomDelay(4000, 0.8, 1.5, () => 0.5); return v >= 3200 && v <= 6000 })())
check('🔴 jitter 가 실제로 있다 (고정이 아니다)',
  randomDelay(1000, 0.8, 1.5, () => 0) !== randomDelay(1000, 0.8, 1.5, () => 1))
check('🔴 collector 가 매 요청에 randomDelay 를 쓴다',
  (COLLECTOR.match(/sleep\(randomDelay\(/g) ?? []).length >= 3)
check('🔴 UA 위장을 하지 않는다',
  !/Mozilla|Chrome\/|userAgent/i.test(COLLECTOR_CODE) && !/Mozilla|Chrome\//i.test(LIB_CODE),
  '자연화는 사람 속도이지 신원 위장이 아니다')

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 세션 — 🔴 우나어 재사용 금지')
// ─────────────────────────────────────────────────────────
{
  const base = { exists: true, halted: false }
  check('🔴 우나어 세션 경로를 거부한다',
    judgeSession({ ...base, sessionPath: '/Users/x/Documents/unao-prod/agents/cafe/storage-state.json' }).ok === false)
  check('🔴 unao 문자열이 든 경로를 거부한다',
    judgeSession({ ...base, sessionPath: '/tmp/unao-session.json' }).ok === false)
  {
    const v = judgeSession({ ...base, sessionPath: '/Users/x/unao-main/agents/cafe/storage-state.json' })
    check('거부 코드가 UNAO_SESSION_REUSE 다', !v.ok && v.code === 'UNAO_SESSION_REUSE', !v.ok ? v.code : '')
    check('사유가 이유를 설명한다', !v.ok && v.detail.includes('둘 다 멈춘다'))
  }
  check('🔴 재사용 검사가 파일 존재보다 먼저다 (존재해도 거부)',
    judgeSession({ sessionPath: '/x/unao/storage-state.json', exists: true, halted: false }).ok === false,
    '우나어 파일은 실제로 존재한다 — 존재 검사를 먼저 하면 통과해 버린다')
  check('경로가 없으면 거부', judgeSession({ ...base, sessionPath: null }).ok === false)
  check('빈 문자열도 거부', judgeSession({ ...base, sessionPath: '   ' }).ok === false)
  check('파일이 없으면 거부',
    judgeSession({ sessionPath: '/tmp/soran-session.json', exists: false, halted: false }).ok === false)
  check('🔴 HALTED 면 무엇보다 먼저 멈춘다',
    judgeSession({ sessionPath: '/tmp/soran-session.json', exists: true, halted: true }).ok === false)
  check('전용 세션은 통과한다',
    judgeSession({ sessionPath: '/Users/x/.soransoran/navercafe-session.json', exists: true, halted: false }).ok)
  check('세션 경로를 env 로만 받는다 (코드에 계정 없음)',
    /SORAN_NAVERCAFE_SESSION_PATH/.test(LIB)
      && !/password|passwd/i.test(LIB_CODE) && !/password|passwd/i.test(COLLECTOR_CODE))
  check('🔴 collector 가 브라우저보다 세션을 먼저 본다',
    COLLECTOR_CODE.indexOf('judgeSession(') < COLLECTOR_CODE.indexOf('loadChromium('),
    '브라우저를 먼저 열면 우나어 세션으로도 창이 뜬다')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 락 — 🔴 TTL 이 실행 timeout 보다 길다')
// ─────────────────────────────────────────────────────────
check('🔴 락 TTL > 실행 timeout', LOCK_MAX_AGE_MS > RUN_TIMEOUT_MS,
  '짧으면 아직 도는 작업을 죽은 것으로 보고 같은 회차가 두 번 돈다 (우나어 2026-07-27 실측)')
check('락이 없으면 진행', judgeLock(null, Date.now()).ok)
check('🔴 최근 락이면 멈춘다', judgeLock(Date.now() - 60_000, Date.now()).ok === false)
check('오래된 락은 STALE 로 통과', (() => {
  const v = judgeLock(Date.now() - LOCK_MAX_AGE_MS - 1000, Date.now())
  return v.ok && v.reason === 'STALE'
})())
check('경계 직전은 아직 잡혀 있다', judgeLock(Date.now() - LOCK_MAX_AGE_MS + 1000, Date.now()).ok === false)

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 산출물 — 🔴 82cook 과 같은 스키마 (importer 가 같은 코드로 읽는다)')
// ─────────────────────────────────────────────────────────
{
  const row = buildCollected('remonterrace', {
    sourceArticleId: '34783204',
    sourceUrl: ARTICLE_URL('remonterrace', '34783204'),
    originalTitle: '아이 다 키우고 나니 허전하네요',
    sourceCommentCount: 7,
  }, '아이들 대학 보내고 나니 집이 조용해서 적응이 안 되네요. 낮에는 라디오라도 틀어놔야 견딥니다.', new Date().toISOString())

  // 🔴 필드 **수**를 세지 않는다. 세면 메타를 하나 더할 때마다 이 단정이 깨지고,
  //    깨진 김에 느슨하게 고치게 된다. 봐야 하는 것은 "importer 가 읽는 키가 다 있는가" 다.
  //    추가 키의 안전성은 ⑮ 가 importer 쪽에서 따로 본다 (PR-S2-b-4).
  const WANT = ['sourceSite','sourceUrl','sourceArticleId','sourceBoardName','sourceCommentCount',
    'originalTitle','rawBody','sourceCapturedAt','dedupKey','qualityFlags','qualitySignals']
  check('importer 가 읽는 키가 전부 있다 (82cook 과 동일)', WANT.every((k) => k in row),
    `빠진 키: ${WANT.filter((k) => !(k in row)).join(',')}`)
  check('🔴 82cook 산출물의 상위집합이다 (필수 키를 빼지 않았다)',
    WANT.every((k) => row[k as keyof CollectedCandidate] !== undefined))
  check('sourceSite 가 navercafe:remonterrace', row.sourceSite === 'navercafe:remonterrace')
  check('dedupKey 가 재계산과 같다', row.dedupKey === computeDedupKey(row.sourceSite, row.sourceArticleId))
  check('qualityFlags 가 붙는다 (글 단위 판정)', Array.isArray(row.qualityFlags))
  check('assertNaverCandidate 를 통과한다', (() => { try { assertNaverCandidate(row); return true } catch { return false } })())

  const broken = (m: Partial<CollectedCandidate>) => {
    try { assertNaverCandidate({ ...row, ...m }); return false } catch { return true }
  }
  check('🔴 sourceSite 가 82cook 이면 거부', broken({ sourceSite: '82cook' }))
  check('🔴 articleId 가 숫자가 아니면 거부', broken({ sourceArticleId: 'abc' }))
  check('🔴 dedupKey 가 어긋나면 거부', broken({ dedupKey: 'sha256:0' }))
  check('🔴 카페 주소가 아니면 거부', broken({ sourceUrl: 'https://www.82cook.com/x' }))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 소스 스캔 — 🔴 Candidate · Sheet · Post · Queue 로 새지 않는다')
// ─────────────────────────────────────────────────────────
for (const [name, src] of [['collector', COLLECTOR_CODE], ['lib', LIB_CODE]] as const) {
  check(`[${name}] 🔴 prisma 를 import 하지 않는다`, !/from '@prisma\/client'|PrismaClient/.test(src))
  check(`[${name}] 🔴 Sheet 를 부르지 않는다`, !/micro-seed-sheet|createGoogleSheetSource|updateCandidateRow/.test(src))
  check(`[${name}] 🔴 Candidate 를 만들지 않는다`, !/microSeedCandidate|MicroSeedCandidate/.test(src))
  check(`[${name}] 🔴 Post 를 만들지 않는다`, !/\.post\.create|prisma\.post/.test(src))
  check(`[${name}] 🔴 Queue 를 건드리지 않는다`, !/originalPostApprovalQueue|OriginalPostApprovalQueue/.test(src))
  check(`[${name}] 🔴 발행 상태 전환이 없다`, !/'PENDING'|'PUBLISHED'|'APPROVED'/.test(src))
}
check('🔴 collector 가 Raw Vault 에 적재하지 않는다 (importer 로 넘긴다)',
  /적재는 importer 가 한다/.test(COLLECTOR) && /--raw-only --batch=/.test(COLLECTOR))
check('🔴 popular-sync 를 이식하지 않았다',
  !/popular[-_]?sync/i.test(COLLECTOR_CODE) && !/popular[-_]?sync/i.test(LIB_CODE),
  '우나어의 인기글 전용 슬롯은 82cook 수집 슬롯이 대신한다')
check('🔴 GHA 에서 돌지 않는다고 명시한다', /LOCAL ONLY/.test(COLLECTOR) && /GHA 에서 돌리지 않는다/.test(COLLECTOR))
check('🔴 dry-run 이 기본이다', /const LIVE = argv\.includes\('--live'\)/.test(COLLECTOR) && /const live = LIVE && enabled/.test(COLLECTOR))
check(`🔴 kill switch 가 --live 를 무시할 수 있다`, new RegExp(KILL_SWITCH_ENV).test(COLLECTOR))
check('🔴 Playwright 를 정적으로 import 하지 않는다',
  !/^import .*from ['"]playwright(-core)?['"]/m.test(COLLECTOR_CODE) && /await import\(/.test(COLLECTOR_CODE),
  'dry-run · fixture · typecheck 가 브라우저 없이 돌아야 한다')
check('🔴 모듈을 못 찾으면 조용히 넘어가지 않고 안내하며 멈춘다',
  /Playwright 를 찾지 못했다/.test(COLLECTOR) && /playwright-core/.test(COLLECTOR),
  '안내가 없으면 실패 원인이 브라우저인지 세션인지 알 수 없다')
check('🔴 댓글 본문 · 이미지를 수집하지 않는다',
  /댓글 본문 미수집/.test(COLLECTOR) && /이미지를 가져오지 않는다|이미지 미수집/.test(COLLECTOR))

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 카페 설정 — 🔴 주제를 고정 라벨로 굳히지 않는다')
// ─────────────────────────────────────────────────────────
check(`카페 ${CAFES.length}곳이 등록돼 있다`, CAFES.length >= 5)
check('cafeId 가 중복되지 않는다', new Set(CAFES.map((c) => c.cafeId)).size === CAFES.length)
check('첫 live 카페가 목록에 있다', findCafe(FIRST_LIVE_CAFE_ID) !== null)
check('모르는 카페는 null', findCafe('nosuchcafe') === null)
// 🔴 PR-S2-b-7 에서 shadow → excluded 로 바뀌었다. 뷰티 축이라는 성격은 그대로이고,
//    "이번 라운드에 쓰지 않는다" 가 더해진 것이다 — 단정을 사실에 맞춘다.
check('🔴 여우야는 이번 라운드 제외 (뷰티·미용 성격은 유지)',
  findCafe('yeowooya')?.stage === 'excluded' && /뷰티|미용/.test(findCafe('yeowooya')?.note ?? ''))
check('🔴 여우야 메모가 "바로 쓰지 않는다" 를 적고 있다',
  /바로 쓰지 않는다/.test(findCafe('yeowooya')?.note ?? ''))
check('우갱·레몬테라스가 같은 축이다 (둘 다 production)',
  findCafe('wgang')?.stage === 'production' && findCafe('remonterrace')?.stage === 'production')
check('은퇴 후 50년 메모가 노후·돈 축을 적고 있다',
  /노후|은퇴|돈/.test(findCafe('dlxogns01')?.note ?? ''))
check('🔴 note 를 판정에 쓰지 않는다 (사람이 읽는 메모)',
  !/\.note\s*[.=!]==|includes\(.*\.note|\.note\)/.test(COLLECTOR_CODE.replace(/console\.log[^\n]*/g, '')),
  '주제 판정은 글 단위(qualityFlags · Originality Gate)로 한다')
check('🔴 stage 별 주제 분기가 없다',
  !/stage === '(production|core)'/.test(COLLECTOR_CODE),
  'stage 는 얼마나 조심할 것인가이지 주제가 아니다')

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 세션 파일 보호 — 🔴 쿠키가 git 에 들어가면 되돌릴 수 없다 (PR-S2-b-3)')
// ─────────────────────────────────────────────────────────
check(`권장 경로가 .gitignore 로 막혀 있다 (${DEFAULT_SESSION_PATH})`,
  isSessionPathIgnored(DEFAULT_SESSION_PATH, GITIGNORE),
  '이 저장소의 .gitignore 가 세션 파일을 막지 못한다')
check('🔴 디렉터리째 막혀 있다 — 같은 폴더의 다른 세션 파일도 함께 막힌다',
  isSessionPathIgnored('.naver-session/anything.json', GITIGNORE))
check('storage-state 라는 이름이면 다른 위치여도 막힌다',
  isSessionPathIgnored('scripts/soransoran-storage-state.json', GITIGNORE))
check('🔴 무관한 소스 파일까지 막지는 않는다',
  !isSessionPathIgnored('scripts/lib/micro-seed-navercafe.mts', GITIGNORE)
    && !isSessionPathIgnored('src/lib/post-visibility.ts', GITIGNORE),
  '너무 넓은 규칙은 추적돼야 할 파일을 조용히 빠뜨린다')
check('막히지 않은 경로는 false 로 답한다 (보수적)',
  !isSessionPathIgnored('session.json', '# 주석뿐\n'))
check('🔴 부정(!) 규칙을 보호로 착각하지 않는다',
  !isSessionPathIgnored('a/b.json', '!a/b.json\n'))

// ─────────────────────────────────────────────────────────
console.log('\n⑪ 세션 발급 헬퍼 — 🔴 자격증명·쿠키 값을 만지지 않는다')
// ─────────────────────────────────────────────────────────
check('우나어 경로를 거부한다 (agents/cafe/storage-state.json)',
  isUnaoSessionPath('/Users/yanadoo/Documents/unao-prod/agents/cafe/storage-state.json'))
check('🔴 경로에 unao 가 들어가면 거부한다',
  isUnaoSessionPath('/tmp/unao-session.json') && isUnaoSessionPath('./UNAO/state.json'))
check('소란소란 전용 경로는 통과한다',
  !isUnaoSessionPath(DEFAULT_SESSION_PATH),
  '권장 경로가 스스로의 가드에 걸리면 발급 자체가 막힌다')
check('judgeSession 과 같은 규칙을 쓴다',
  !judgeSession({ sessionPath: '/x/unao/s.json', exists: true, halted: false }).ok
    && isUnaoSessionPath('/x/unao/s.json'))

check('🔴 헬퍼가 비밀번호·아이디를 코드에서 다루지 않는다',
  !/(password|passwd|\bpw\b|NAVER_ID|NAVER_PW|login_id)/i.test(SETUP_CODE),
  '자격증명이 코드에 들어오는 순간 로그·셸 히스토리로 샌다')
check('🔴 헬퍼가 쿠키 값을 읽지 않는다',
  !/\.value/.test(SETUP_CODE),
  'summarizeCookies 의 입력 타입에는 value 가 없다 — 코드에서도 만지지 않아야 한다')
check('🔴 헬퍼가 자동 로그인(타이핑)을 하지 않는다',
  !/(page\.fill|page\.type|\.press\(|keyboard)/.test(SETUP_CODE),
  '로그인은 사람이 한다')
check('🔴 헬퍼가 DB · Sheet 를 건드리지 않는다',
  !/(prisma|PrismaClient|googleapis|sheets|Candidate|MicroSeedRawContent)/.test(SETUP_CODE))
check('🔴 헬퍼가 카페 글을 읽지 않는다 (로그인 페이지만 연다)',
  !/(cafe\.naver\.com|ARTICLE_URL|LIST_URL)/.test(SETUP_CODE))
check('headed 로 연다 (headless: false)',
  /headless:\s*false/.test(SETUP_CODE),
  'headless 로는 2단계 인증을 사람이 통과할 수 없다')
check('저장 후 권한 600 을 건다', /chmodSync\([^)]*0o600\)/.test(SETUP_CODE))
check('🔴 loadEnvLocal 을 await 한다',
  /await loadEnvLocal\(\)/.test(SETUP_CODE) && !/^\s*loadEnvLocal\(\)/m.test(SETUP_CODE),
  'async 인데 await 를 빠뜨리면 .env.local 의 세션 경로가 조용히 무시되고 기본 경로로 저장된다')
check('🔴 저장 전에 gitignore 를 본다 (저장 후가 아니라)',
  SETUP_CODE.indexOf('isSessionPathIgnored') < SETUP_CODE.indexOf('storageState'),
  '저장하고 확인하면 이미 워킹트리에 쿠키가 놓인 뒤다')

{
  const sum = summarizeCookies([
    { name: 'NID_AUT', domain: '.naver.com', expires: 1788000000 },
    { name: 'NID_SES', domain: '.naver.com', expires: -1 },
    { name: 'other', domain: '.example.com' },
  ])
  check('쿠키 요약이 개수를 센다', sum.total === 3 && sum.naverDomain === 2)
  check('로그인 쿠키 둘이 다 있으면 hasAuth', sum.hasAuth)
  check('세션 쿠키(expires<=0)는 만료일 null', sum.auth.find((a) => a.name === 'NID_SES')?.expiresAt === null)
  check('🔴 요약 결과에 값이 들어갈 자리가 없다',
    !JSON.stringify(sum).includes('value'))
  check('로그인 쿠키가 빠지면 hasAuth 가 false',
    !summarizeCookies([{ name: 'NID_AUT', domain: '.naver.com' }]).hasAuth,
    '로그인이 안 잡힌 세션을 저장하고 성공으로 보고하면 첫 live 가 0건으로 끝난다')
  check('감시 대상 쿠키가 둘이다', AUTH_COOKIE_NAMES.length === 2)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑫ Playwright — 🔴 playwright-core 가 이미 있다 (PR-S2-b-3 정정)')
// ─────────────────────────────────────────────────────────
check('모듈 후보에 playwright-core 가 있다', PLAYWRIGHT_SPECS.includes('playwright-core'))
check('playwright 를 먼저 본다', PLAYWRIGHT_SPECS[0] === 'playwright')
check('🔴 collector 가 playwright 만 찾지 않는다',
  /PLAYWRIGHT_SPECS/.test(COLLECTOR_CODE) && !/const spec = 'playwright'/.test(COLLECTOR_CODE),
  '있는 모듈을 없다고 말하던 코드다')
check('헬퍼도 같은 후보 목록을 쓴다', /PLAYWRIGHT_SPECS/.test(SETUP_CODE))
check('🔴 설치 안내가 브라우저 바이너리를 강요하지 않는다',
  !/playwright install chromium/.test(COLLECTOR_CODE) && !/playwright install chromium/.test(SETUP_CODE),
  '기본은 설치된 Chrome 이라 다운로드가 필요 없다')
{
  const d = browserLaunchOptions({ channel: null, headless: true })
  check(`기본 채널이 ${DEFAULT_BROWSER_CHANNEL} 다`, d.channel === DEFAULT_BROWSER_CHANNEL && d.headless)
  check('🔴 chromium 을 주면 채널을 넘기지 않는다 (번들 브라우저)',
    browserLaunchOptions({ channel: 'chromium', headless: false }).channel === undefined)
  check('빈 문자열은 기본값으로 떨어진다',
    browserLaunchOptions({ channel: '  ', headless: true }).channel === DEFAULT_BROWSER_CHANNEL)
  check('headless 는 부르는 쪽이 정한다',
    browserLaunchOptions({ channel: null, headless: false }).headless === false)
  check('채널 env 이름이 노출돼 있다', BROWSER_CHANNEL_ENV === 'SORAN_BROWSER_CHANNEL')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑬ 작성 시각 라벨 파싱 — 🔴 애매하면 null (PR-S2-b-4)')
// ─────────────────────────────────────────────────────────
{
  // 기준시각: 2026-09-03 15:00 KST = 2026-09-03T06:00Z
  const now = new Date('2026-09-03T06:00:00.000Z')
  const kstDate = (iso: string | null) =>
    iso === null ? null : new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16)

  check('오늘 HH:mm → 목록을 본 날의 그 시각 (KST)',
    kstDate(parsePostedLabel('15:32', now)) === '2026-09-03T15:32',
    `받은 값: ${kstDate(parsePostedLabel('15:32', now))}`)
  check('🔴 자정 직후도 같은 날로 본다 (00:05)',
    kstDate(parsePostedLabel('00:05', now)) === '2026-09-03T00:05')
  check('YYYY.MM.DD. → 그 날 00:00 KST',
    kstDate(parsePostedLabel('2026.09.01.', now)) === '2026-09-01T00:00')
  check('YYYY-MM-DD 형태도 받는다',
    kstDate(parsePostedLabel('2026-09-01', now)) === '2026-09-01T00:00')
  check('MM.DD. → 올해로 본다',
    kstDate(parsePostedLabel('09.01.', now)) === '2026-09-01T00:00')
  check('🔴 MM.DD. 가 미래면 작년이다 (연말연시 사고 방지)',
    kstDate(parsePostedLabel('12.31.', now)) === '2025-12-31T00:00',
    '올해로 두면 12월 글이 "3개월 뒤에 쓰인 글" 이 된다')
  check('상대시각 3시간 전',
    parsePostedLabel('3시간 전', now) === new Date(now.getTime() - 3 * 3600_000).toISOString())
  check('상대시각 5분 전',
    parsePostedLabel('5분 전', now) === new Date(now.getTime() - 5 * 60_000).toISOString())
  check('"방금 전" 은 지금', parsePostedLabel('방금 전', now) === now.toISOString())

  const unparsable = ['', '  ', '어제', '25:99', '99:99', 'yesterday', '새글', '2026.13.45.abc', 'N']
  check('🔴 해석 못 하는 라벨은 전부 null',
    unparsable.every((l) => parsePostedLabel(l, now) === null),
    `null 이 아닌 것: ${unparsable.filter((l) => parsePostedLabel(l, now) !== null).join(' · ')}`)
  check('null · undefined · 숫자도 null',
    parsePostedLabel(null, now) === null && parsePostedLabel(undefined, now) === null)
  check('🔴 추측하지 않는다 — 시/분 범위를 넘으면 null',
    parsePostedLabel('24:00', now) === null && parsePostedLabel('12:60', now) === null,
    'time lag 측정에 추측값이 섞이면 그 측정이 통째로 못 쓰게 된다')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑭ 숫자 정규화 — 🔴 모르면 0 이 아니라 null')
// ─────────────────────────────────────────────────────────
check('쉼표를 걷어낸다', normalizeCount('1,234') === 1234)
check('접두 문자열이 붙어도 숫자를 찾는다', normalizeCount('조회 34') === 34)
check('만 단위', normalizeCount('1.2만') === 12000 && normalizeCount('3만') === 30000)
check('천 단위', normalizeCount('2천') === 2000)
check('숫자 타입도 받는다', normalizeCount(12) === 12 && normalizeCount(0) === 0)
check('🔴 빈 문자열 · null · undefined 는 null (0 이 아니다)',
  normalizeCount('') === null && normalizeCount('   ') === null
    && normalizeCount(null) === null && normalizeCount(undefined) === null,
  '"댓글 0개" 와 "댓글 수를 못 읽었다" 는 다른 사실이다 — 0 으로 뭉개면 lowEngagement 통계가 거짓말한다')
check('숫자가 없는 문자열은 null', normalizeCount('없음') === null)
check('음수·NaN 은 null', normalizeCount(-1) === null && normalizeCount(NaN) === null)

// ─────────────────────────────────────────────────────────
console.log('\n⑮ 목록 메타가 산출물에 남는가 · importer 계약은 그대로인가')
// ─────────────────────────────────────────────────────────
{
  // 🔴 string 으로 명시한다. 리터럴 타입으로 좁혀지면 아래 !== 비교를
  //    TS 가 "겹치지 않는다" 며 막는다 — 검사하려는 것은 런타임 값이다.
  const listedAt: string = '2026-09-03T06:00:00.000Z'
  const capturedAt: string = '2026-09-03T06:17:00.000Z'
  const full = buildCollected('remonterrace', {
    sourceArticleId: '34998655', sourceUrl: ARTICLE_URL('remonterrace', '34998655'),
    originalTitle: '맛있는 반찬 이야기', sourceCommentCount: 3,
    sourcePostedLabel: '15:32', sourceViewCount: 1240,
    sourceBoardName: '자유게시판', sourcePage: 2, sourceRankOnPage: 7,
  }, '본문'.repeat(60), capturedAt, listedAt)

  check('sourcePage · sourceRankOnPage 가 남는다', full.sourcePage === 2 && full.sourceRankOnPage === 7)
  check('sourceViewCount 가 남는다', full.sourceViewCount === 1240)
  check('sourceBoardName 이 목록 값을 쓴다', full.sourceBoardName === '자유게시판')
  check('sourcePostedLabel 원문이 남는다', full.sourcePostedLabel === '15:32')
  check('🔴 sourcePostedAt 은 목록을 본 시각 기준으로 해석한다',
    full.sourcePostedAt === '2026-09-03T06:32:00.000Z',
    `받은 값: ${full.sourcePostedAt} — "15:32" 는 목록을 본 날의 15:32 다`)
  check('sourceListedAt 은 상세 시각과 다르다 (time lag 조사의 근거)',
    full.sourceListedAt === listedAt && full.sourceCapturedAt === capturedAt
      && full.sourceListedAt !== full.sourceCapturedAt)
  check('assertNaverCandidate 통과', (() => { try { assertNaverCandidate(full); return true } catch { return false } })())

  // 메타가 하나도 없는 경우 — 첫 live 이전 형태
  const bare = buildCollected('remonterrace', {
    sourceArticleId: '34998655', sourceUrl: ARTICLE_URL('remonterrace', '34998655'),
    originalTitle: '제목', sourceCommentCount: 0,
  }, '본문'.repeat(60), capturedAt)
  check('🔴 메타가 없으면 전부 null — 0 이나 추측값이 아니다',
    bare.sourcePostedLabel === null && bare.sourcePostedAt === null
      && bare.sourcePage === null && bare.sourceRankOnPage === null && bare.sourceViewCount === null)
  check('게시판명은 못 읽으면 기본값', bare.sourceBoardName === '전체글보기')
  check('listedAt 생략 시 capturedAt 과 같다', bare.sourceListedAt === capturedAt)
  check('메타 없이도 assertNaverCandidate 통과',
    (() => { try { assertNaverCandidate(bare); return true } catch { return false } })())

  // 🔴 근거 없는 시각을 막는다
  check('🔴 라벨 없이 sourcePostedAt 만 있으면 거부한다',
    (() => { try { assertNaverCandidate({ ...bare, sourcePostedAt: capturedAt }); return false } catch { return true } })(),
    '라벨이 없는 시각은 어디서 왔는지 답할 수 없다')
  check('🔴 sourcePostedAt 이 ISO 가 아니면 거부한다',
    (() => { try { assertNaverCandidate({ ...full, sourcePostedAt: '오늘' }); return false } catch { return true } })())
  check('🔴 음수 page/rank/view 는 거부한다',
    (() => { try { assertNaverCandidate({ ...full, sourcePage: -1 }); return false } catch { return true } })())

  // ── 필수 키 계약 (기존) ──
  const required = ['sourceSite', 'sourceArticleId', 'sourceUrl', 'originalTitle', 'rawBody', 'sourceCapturedAt'] as const
  check('🔴 기존 필수 키가 전부 그대로다',
    required.every((k) => full[k] !== undefined && full[k] !== ''),
    `빠진 키: ${required.filter((k) => full[k] === undefined || full[k] === '').join(', ')}`)
}

// importer 가 추가 키를 무시하는가 — 🔴 명시 필드만 쓴다
check('🔴 importer 의 RawContent create 가 명시 필드만 쓴다 (스프레드 없음)',
  !/microSeedRawContent\.create\(\{[\s\S]{0,400}\.\.\.row/.test(IMPORTER_CODE),
  '...row 를 펼치면 새 키가 그대로 DB 로 가려다 터진다')
check('🔴 importer 가 새 메타 키를 읽지 않는다',
  !/row\.(sourcePostedAt|sourcePostedLabel|sourcePage|sourceRankOnPage|sourceViewCount|sourceListedAt)/.test(IMPORTER_CODE),
  'importer 는 이 PR 로 바뀌지 않아야 한다')
check('🔴 DB 컬럼을 새로 만들지 않았다 (schema 미변경 전제)',
  !/dedupKey:\s*row\.dedupKey/.test(IMPORTER_CODE.split('microSeedRawContent.create')[1] ?? ''),
  'dedupKey 는 DB 컬럼이 아니다 — JSONL 단계 중복 제거용이고 DB 방어는 @@unique 다')

// ── 문서 원칙이 훼손되지 않았는가 ──
check('🔴 정치 · 진영 제외 원칙이 문서에 남아 있다',
  /정치 · 진영 이슈는 소란소란이 가져가지 않는다/.test(SUPPLY_DOC)
    && /🚫 \*\*제외\*\* — 레인 없음/.test(SUPPLY_DOC))
check('🔴 Growth Issue 는 연예 · 방송 · 셀럽 한정이다',
  /Growth Issue 후보 = 연예 · 방송 · 셀럽 이슈 \*\*로 한정\*\*/.test(SUPPLY_DOC))
check('🔴 lowEngagement 를 품질 실패로 읽지 않는다는 원칙이 남아 있다',
  /`lowEngagement` 는 품질이 아니라/.test(SUPPLY_DOC))
check('🔴 이미지는 여전히 향후 설계 항목이다',
  /이미지 — \*\*향후 설계 항목\. 지금 구현하지 않는다\*\*/.test(SUPPLY_DOC))
check('🔴 collector 는 여전히 이미지를 가져오지 않는다',
  /이미지를 가져오지 않는다/.test(COLLECTOR) && !/(img|image|\.src)/i.test(COLLECTOR_CODE))

// ─────────────────────────────────────────────────────────
console.log('\n⑯ 목록 0건 진단 — 🔴 실패를 삼키지 않는다 (PR-S2-b-5)')
// ─────────────────────────────────────────────────────────
{
  const probe = (o: Partial<FrameProbe>): FrameProbe =>
    ({ frame: '(top)', linkHits: 0, rows: 0, items: 0, error: null, ...o })

  check('항목이 있으면 OK', diagnoseEmptyList([probe({ linkHits: 30, rows: 30, items: 22 })]).code === 'OK')
  check('🔴 콜백 예외를 0건으로 삼키지 않는다',
    diagnoseEmptyList([probe({ error: 'sel is not a function' })]).code === 'CALLBACK_ERROR',
    '이것을 구분 못 해서 22건 → 0건 회귀의 원인을 못 짚었다 (2026-09-03)')
  check('링크 0개 → SELECTOR_ZERO (로그인·DOM 변화)',
    diagnoseEmptyList([probe({ linkHits: 0 })]).code === 'SELECTOR_ZERO')
  check('🔴 링크는 있는데 0건 → PARSE_ZERO (articleId 파싱 실패)',
    diagnoseEmptyList([probe({ linkHits: 30, rows: 30, items: 0 })]).code === 'PARSE_ZERO',
    '셀렉터 문제와 파싱 문제는 고칠 곳이 다르다')
  check('프레임이 없으면 NO_FRAME', diagnoseEmptyList([]).code === 'NO_FRAME')
  check('🔴 예외가 링크 0개보다 우선한다',
    diagnoseEmptyList([probe({ linkHits: 0 }), probe({ error: 'boom' })]).code === 'CALLBACK_ERROR',
    '우리 코드가 터진 것이 먼저 고칠 일이다')
  check('한 프레임이라도 성공하면 OK',
    diagnoseEmptyList([probe({ error: 'boom' }), probe({ linkHits: 5, rows: 5, items: 5 })]).code === 'OK')
  check('진단에 무엇을 고칠지가 들어 있다',
    /parseArticleId/.test(diagnoseEmptyList([probe({ linkHits: 9, rows: 9 })]).detail))

  // 🔴 URL 에 세션 토큰이 실릴 수 있다
  check('🔴 프레임 라벨이 쿼리를 떼어낸다',
    safeFrameLabel('https://cafe.naver.com/x?token=SECRET&a=1') === 'https://cafe.naver.com/x',
    '로그에 세션 토큰을 남기지 않는다')
  check('해시도 떼어낸다', safeFrameLabel('https://cafe.naver.com/x#SECRET') === 'https://cafe.naver.com/x')
  check('아주 긴 URL 은 자른다', safeFrameLabel(`https://cafe.naver.com/${'a'.repeat(300)}`).length <= 120)

  const lines = summarizeProbes([probe({ linkHits: 30, rows: 30, items: 0, error: 'x is not a function' })])
  check('요약이 링크·행·항목·예외를 전부 담는다',
    /링크 30/.test(lines[0]) && /행 30/.test(lines[0]) && /항목 0/.test(lines[0]) && /예외/.test(lines[0]))
  check('🔴 요약에 HTML 이 들어가지 않는다',
    !/[<>]/.test(lines.join(' ')),
    '원문 HTML 을 로그에 흘리지 않는다')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑰ 락 해제 — 🔴 finally 에서 풀되 원래 에러를 가리지 않는다')
// ─────────────────────────────────────────────────────────
check('🔴 collector 가 finally 에서 락을 지운다',
  /finally\s*\{[\s\S]{0,600}unlinkSync\(LOCK_PATH\)/.test(COLLECTOR_CODE),
  '실패 후 TTL 30분을 기다려야 하면 원인을 좁힐 기회가 사라진다')
check('정상 해제면 경고 없음', judgeLockRelease(true, null).released && judgeLockRelease(true, null).warning === null)
check('락이 없었으면 해제도 경고도 없다',
  !judgeLockRelease(false, null).released && judgeLockRelease(false, null).warning === null)
{
  const v = judgeLockRelease(true, new Error('EPERM'))
  check('🔴 해제 실패는 경고만 낸다 (throw 하지 않는다)', !v.released && v.warning !== null)
  check('경고에 TTL 안내가 있다', /TTL 30분/.test(v.warning ?? ''))
  check('🔴 collector 가 해제 실패 시 throw 하지 않는다',
    /console\.warn\(`  ⚠️ \$\{rel\.warning\}`\)/.test(COLLECTOR_CODE),
    '수집이 왜 실패했는지가 본론이고 락은 곁가지다')
}
check('🔴 stale lock 처리는 그대로다', judgeLock(Date.now() - LOCK_TTL - 1000, Date.now()).ok)
check('🔴 살아 있는 락은 여전히 막는다', !judgeLock(Date.now() - 60_000, Date.now()).ok)
check('🔴 LOCK_MAX_AGE_MS > RUN_TIMEOUT_MS 유지', LOCK_TTL > RUN_TIMEOUT_MS)

// ── 메타 optional 화 — 링크 수집이 살아남는가 ──
check('🔴 링크 셀렉터가 메타와 분리돼 있다',
  // String() 으로 리터럴 좁힘을 푼다 — 검사하려는 것은 런타임 값이다
  /LIST_SELECTORS\.link/.test(COLLECTOR_CODE) && String(LIST_SELECTORS.link) !== String(LIST_SELECTORS.date),
  '메타 셀렉터 하나가 터져서 링크 수집이 죽으면 안 된다 (상수는 PR-S2-b-6 에서 lib 로 옮겼다)')
check('🔴 메타 추출이 콜백 안에서 try 로 감싸져 있다',
  /try \{[\s\S]{0,200}const near = a\.closest/.test(COLLECTOR_CODE))
// 🔴 앞 단정("pick 각각도 try 로 감싸져 있다")을 지웠다.
//    그 pick 이 바로 __name 을 부른 코드였다 — 단정이 **버그 원인을 요구**하고 있었다.
//    이제 querySelector 를 옵셔널 체이닝으로 직접 부르고, 행 전체를 try 가 감싼다.
check('🔴 메타를 옵셔널 체이닝으로 직접 읽는다 (중간 함수 없음)',
  /near\?\.querySelector\(sel\.date\)\?\.textContent\?\.trim\(\) \?\? ''/.test(COLLECTOR_CODE),
  '중간에 이름 있는 헬퍼를 두면 esbuild 가 __name 을 씌운다')
{
  // 🔴 readList 의 catch 만 본다. loadChromium 의 빈 catch 는 다음 후보로 넘어가는
  //    의도된 루프이고, 마지막에 fail() 로 크게 실패한다 — 삼키는 것이 아니다.
  const readListCode = COLLECTOR_CODE.slice(
    COLLECTOR_CODE.indexOf('async function readList'),
    COLLECTOR_CODE.indexOf('async function readArticleBody'),
  )
  check('🔴 readList 의 바깥 catch 가 더 이상 비어 있지 않다',
    !/\} catch \{\s*\n\s*\}/.test(readListCode) && /error: e instanceof Error \? e\.message/.test(readListCode))
  check('🔴 readArticleBody 도 실패를 삼키지 않는다',
    /errors\.push\(e instanceof Error/.test(COLLECTOR_CODE),
    'readList 와 같은 결함이 한 단계 뒤에 있었다 — 셀렉터가 안 맞는 것과 코드가 터진 것을 구분 못 했다')
  check('본문 실패 메시지가 두 경우를 구분한다',
    /본문 셀렉터가 터졌다/.test(COLLECTOR) && /본문이 비었다/.test(COLLECTOR))
}
check('🔴 진단이 예외 message 만 담는다 (스택·HTML 아님)',
  !/e\.stack/.test(COLLECTOR_CODE))

// ── 댓글 수: 진짜 0 과 못 읽음 구분 ──
{
  const base = { sourceArticleId: '1', sourceUrl: ARTICLE_URL('remonterrace', '1'), originalTitle: '제목' }
  const real0 = buildCollected('remonterrace', { ...base, sourceCommentCount: 0, sourceCommentCountRead: true }, '본문'.repeat(60), '2026-09-03T06:00:00.000Z')
  const unread = buildCollected('remonterrace', { ...base, sourceCommentCount: 0, sourceCommentCountRead: false }, '본문'.repeat(60), '2026-09-03T06:00:00.000Z')
  check('🔴 "진짜 댓글 0" 과 "못 읽음" 이 구분된다',
    real0.sourceCommentCountRead && !unread.sourceCommentCountRead
      && real0.sourceCommentCount === unread.sourceCommentCount,
    'sourceCommentCount 는 number 계약이라 둘 다 0 이다 — 플래그가 없으면 lowEngagement 통계가 오염된다')
  check('생략하면 "읽었다" 로 본다 (기존 호출부 호환)',
    buildCollected('remonterrace', { ...base, sourceCommentCount: 2 }, '본문'.repeat(60), '2026-09-03T06:00:00.000Z').sourceCommentCountRead)
  check('assertNaverCandidate 가 두 경우 다 통과',
    (() => { try { assertNaverCandidate(real0); assertNaverCandidate(unread); return true } catch { return false } })())
}

// ── 여전히 DB · Sheet 로 새지 않는다 ──
for (const [label, code] of [['collector', COLLECTOR_CODE], ['lib', LIB_CODE]] as const) {
  check(`[${label}] 🔴 진단 보강 후에도 prisma 를 부르지 않는다`, !/prisma|PrismaClient/.test(code))
  check(`[${label}] 🔴 Sheet · Candidate · Post · Queue 접근 0`,
    !/(googleapis|sheets\.|MicroSeedCandidate|OriginalPostApprovalQueue|\.post\.create)/.test(code))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑱ 🔴 브라우저 콜백에 이름 있는 함수를 두지 않는다 (PR-S2-b-6 근본 원인)')
// ─────────────────────────────────────────────────────────
{
  // 🔴 2026-09-03 실측 원인:
  //    tsx(esbuild) 의 keepNames 가 `const pick = () => {}` 에 __name(...) 래퍼를 씌운다.
  //    그 코드가 $$eval 로 브라우저에 넘어가면 __name 헬퍼가 없어 ReferenceError 가 난다.
  //    → PR-S2-b-4 에서는 콜백 전체가 죽어 목록 0건
  //    → PR-S2-b-5 에서는 try 가 잡아 링크는 살고 메타만 22/22 null
  //    두 증상이 같은 원인이었다. 이름을 못 붙이게 막는 것이 유일한 구조적 방어다.
  // 🔴 경계를 좁게 잡는다. 넓게 잡으면 바깥 `async function` 까지 삼켜 거짓 실패가 난다.
  const evalBodies: string[] = []
  for (let at = COLLECTOR_CODE.indexOf('$$eval'); at !== -1; at = COLLECTOR_CODE.indexOf('$$eval', at + 1)) {
    const bounds = [
      COLLECTOR_CODE.indexOf('async function', at + 1),
      COLLECTOR_CODE.indexOf('$$eval', at + 1),
      at + 2500,
    ].filter((n) => n > at)
    evalBodies.push(COLLECTOR_CODE.slice(at, Math.min(...bounds)))
  }
  check('$$eval 호출을 찾았다', evalBodies.length >= 2, `찾은 수: ${evalBodies.length}`)
  const named = evalBodies.filter((b) => /const\s+\w+\s*=\s*(\([^)]*\)|\w+)\s*(:[^=]+)?=>/.test(b))
  check('🔴 $$eval 콜백 안에 이름 있는 화살표 함수가 없다',
    named.length === 0,
    'esbuild keepNames 가 __name 을 씌우고 브라우저에서 ReferenceError 가 난다 — 목록 0건의 원인이었다')
  check('🔴 function 선언도 없다',
    !evalBodies.some((b) => /\bfunction\s+\w+/.test(b)))
  check('셀렉터를 콜백 밖에서 인자로 넘긴다',
    /\}, LIST_SELECTORS\)/.test(COLLECTOR_CODE),
    '콜백 안에서 상수를 만들면 다시 이름이 붙는다')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑲ 목록 셀렉터 — 🔴 추정이 아니라 실측값이다')
// ─────────────────────────────────────────────────────────
check('실측 클래스를 쓴다 (type_date · type_readCount)',
  /type_date/.test(LIST_SELECTORS.date) && /type_readCount/.test(LIST_SELECTORS.view))
check('댓글은 a.cmt', LIST_SELECTORS.comment === 'a.cmt')
check('게시판명은 a.board_name', LIST_SELECTORS.board === 'a.board_name')
check('🔴 빗나갔던 추정 셀렉터를 더 이상 쓰지 않는다',
  !/\.td_date|\.article-date|\.td_view\b|\.article-views|\.td_name\b|\.board-name/.test(JSON.stringify(LIST_SELECTORS)),
  'PR-S2-b-4 의 .td_date · .td_view · .td_name 은 실제 DOM 에 존재하지 않았다 — 메타 22/22 null 의 원인')
check('🔴 댓글 셀렉터에 em 을 넣지 않는다',
  !/\bem\b/.test(LIST_SELECTORS.comment),
  'em 은 board-tag · BadgeNotificationNew 를 잡아 엉뚱한 숫자를 읽는다')
check('링크 셀렉터는 그대로 (동작이 검증된 값)',
  LIST_SELECTORS.link.includes('a.article') && LIST_SELECTORS.link.includes('articleid'))
check('collector 가 lib 의 셀렉터를 쓴다 (하드코딩 없음)',
  /LIST_SELECTORS\.link/.test(COLLECTOR_CODE) && !/const LIST_LINK_SELECTOR/.test(COLLECTOR_CODE))

// 🔴 "댓글 0" 과 "못 읽음"
check('🔴 댓글 read 판정이 행 발견 여부다',
  /sourceCommentCountRead: r\.rowFound/.test(COLLECTOR_CODE),
  '네이버는 댓글 0 이면 a.cmt 를 렌더하지 않는다 — 링크 부재를 "못 읽음" 으로 보면 진짜 0 이 전부 미지값이 된다')
check('rowFound 를 브라우저에서 계산한다', /rowFound: near !== null/.test(COLLECTOR_CODE))

// ─────────────────────────────────────────────────────────
console.log('\n⑳ 실행 단위 분리 — 🔴 append 로 두 실행이 섞이지 않는다')
// ─────────────────────────────────────────────────────────
check('runId 는 KST yyyymmdd-hhmmss',
  runIdOf('2026-09-03T07:33:37.982Z') === '20260903-163337',
  `받은 값: ${runIdOf('2026-09-03T07:33:37.982Z')}`)
check('자정 경계도 KST 로 넘어간다',
  runIdOf('2026-09-02T15:00:00.000Z') === '20260903-000000')
check('🔴 ISO 가 아니면 던진다',
  (() => { try { runIdOf('어제'); return false } catch { return true } })())
check('실행별 경로가 갈린다',
  runOutputPath('remonterrace', '20260903-163337', 'detail')
    !== runOutputPath('remonterrace', '20260903-170000', 'detail'))
check('목록과 상세가 다른 파일',
  runOutputPath('remonterrace', '20260903-163337', 'list')
    !== runOutputPath('remonterrace', '20260903-163337', 'detail'))
check('경로에 runId 가 들어간다', runOutputPath('remonterrace', '20260903-163337', 'list').includes('20260903-163337'))
check('🔴 writeJsonl 이 append 하지 않는다',
  /function writeJsonl[\s\S]{0,200}writeFileSync/.test(COLLECTOR_CODE) && !/function writeJsonl[\s\S]{0,200}appendFileSync/.test(COLLECTOR_CODE),
  '두 실행이 한 파일에 44행으로 섞여 null 비율을 한 번 잘못 읽었다')
check('행마다 sourceRunId 가 붙는다',
  buildCollected('remonterrace', {
    sourceArticleId: '1', sourceUrl: ARTICLE_URL('remonterrace', '1'), originalTitle: '제목', sourceCommentCount: 0,
  }, '본문'.repeat(60), '2026-09-03T07:33:37.982Z').sourceRunId === '20260903-163337')
check('🔴 잘못된 runId 는 assert 가 막는다',
  (() => {
    const r = buildCollected('remonterrace', { sourceArticleId: '1', sourceUrl: ARTICLE_URL('remonterrace', '1'), originalTitle: '제목', sourceCommentCount: 0 }, '본문'.repeat(60), '2026-09-03T07:33:37.982Z')
    try { assertNaverCandidate({ ...r, sourceRunId: 'x' }); return false } catch { return true }
  })())

// ─────────────────────────────────────────────────────────
console.log('\n㉑ 소스 집중 — 🔴 카페를 넓히지 않고 셋을 깊게 본다 (PR-S2-b-7)')
// ─────────────────────────────────────────────────────────
{
  const active = activeCafes().map((c) => c.cafeId)
  check('활성 카페는 레몬테라스 · 우아한 갱년기 둘뿐',
    active.length === 2 && active.includes('remonterrace') && active.includes('wgang'),
    `받은 값: ${active.join(' · ')}`)
  for (const id of ['dlxogns01', 'masanmam', 'goondae', 'yeowooya']) {
    check(`🔴 ${id} 는 excluded`, findCafe(id)?.stage === 'excluded')
  }
  check('🔴 제외 카페를 지우지 않고 이유를 남긴다',
    ['dlxogns01', 'masanmam', 'goondae', 'yeowooya'].every((id) => (findCafe(id)?.note ?? '').includes('제외')),
    '왜 뺐는지가 남아야 나중에 다시 볼 수 있다')
  check('🔴 collector 가 excluded 카페를 코드로 막는다',
    /stage === 'excluded'/.test(COLLECTOR_CODE),
    '설정에만 있고 아무도 안 지키는 결정이 되면 안 된다')
}

// ─────────────────────────────────────────────────────────
console.log('\n㉒ 게시판 타깃 — 🔴 page range 는 가설이고 실측으로 고친다')
// ─────────────────────────────────────────────────────────
check('타깃 3개', BOARD_TARGETS.length === 3)
check('key 중복 0', BOARD_TARGETS.length === new Set(BOARD_TARGETS.map((b) => b.key)).size)
check('🔴 활성 카페의 게시판만 있다',
  BOARD_TARGETS.every((b) => activeCafes().some((c) => c.cafeId === b.cafeId)))
{
  const j = findBoard('remonterrace:jjong')!
  check('쫑알쫑알 menuId=23 · 2~16p', j.menuId === '23' && j.startPage === 2 && j.endPage === 16)
  check('🔴 쫑알쫑알은 1페이지를 보지 않는다',
    j.startPage > 1,
    '1p 는 방금 올라온 글이라 반응이 붙을 시간이 없고, 상단에 인기글·공지가 섞인다')
  const h = findBoard('remonterrace:humor')!
  check('유머·연예 menuId=56 · 1p만', h.menuId === '56' && h.startPage === 1 && h.endPage === 1)
  const w = findBoard('wgang:all')!
  check('우갱 전체글보기 menuId=0 · 1~5p', w.menuId === '0' && w.startPage === 1 && w.endPage === 5)
  check('모르는 키는 null', findBoard('nope:x') === null)

  check('URL 이 신형 menuId 경로다',
    boardListUrl(j, 3) === 'https://cafe.naver.com/f-e/cafes/10298136/menus/23?viewType=L&page=3',
    `받은 값: ${boardListUrl(j, 3)}`)
  check('우갱 cafeNo 가 다르다', boardListUrl(w, 1).includes('29349320'))
  check('page range 가 펼쳐진다', pagesOf(j).length === 15 && pagesOf(j)[0] === 2 && pagesOf(j)[14] === 16)
  check('1p만 타깃이면 1장', pagesOf(h).length === 1)
  check('🔴 잘못된 range 는 조용히 빈 배열이 아니라 던진다',
    [{ startPage: 5, endPage: 2 }, { startPage: 0, endPage: 3 }, { startPage: 1.5, endPage: 3 }]
      .every((r) => { try { pagesOf(r); return false } catch { return true } }))
  check('🔴 purpose 를 판정에 쓰지 않는다',
    !/\.purpose/.test(COLLECTOR_CODE.replace(/console\.log[^\n]*/g, '')),
    '사람이 읽는 메모다 — 코드가 읽으면 게시판이 고정 라벨이 된다')
}

// ─────────────────────────────────────────────────────────
console.log('\n㉓ 공지·필독·추천 라벨 — 🔴 자동 상세 fetch 에서 뺀다')
// ─────────────────────────────────────────────────────────
for (const l of ['공지', '필독', '추천']) {
  check(`"${l}" 라벨을 잡는다`, detectRowLabel(l, '')?.pinned === true)
}
check('행 class 로도 잡는다 (라벨 텍스트가 없어도)',
  detectRowLabel('', 'board-notice type_required').pinned
    && detectRowLabel('', 'tr board-notice').pinned)
check('일반 행은 pinned 아님', !detectRowLabel('', '').pinned && !detectRowLabel('', 'article-row').pinned)
check('🔴 모르는 라벨을 조용히 통과시키지 않는다',
  detectRowLabel('신규라벨', '').unknown === '신규라벨' && !detectRowLabel('신규라벨', '').pinned,
  '네이버가 문구를 바꾸면 여기서 드러나야 한다')
check('라벨 없으면 unknown 도 null', detectRowLabel('', '').unknown === null)
check('공백만 있으면 없는 것으로 본다', detectRowLabel('   ', '').unknown === null)
check('셀렉터에 라벨이 있다', /board-tag/.test(LIST_SELECTORS.label))
// 🔴 PR-S2-b-8 에서 제외 판정이 judgeExcludeReason 하나로 합쳐졌다.
//    pinned 를 직접 보던 단정을 사유 기반으로 옮긴다 — 약화가 아니라 축의 이동이다.
// 🔴 PR-S2-b-9 에서 필터가 thresholdBasis 안으로 들어갔다. 단정을 그쪽으로 옮긴다.
check('🔴 collector 가 pinned 행을 상세 후보에서 뺀다',
  /const eligible = basis\.eligible/.test(COLLECTOR_CODE)
    && judgeExcludeReason({ politicsExcluded: false, pinned: true, qualityFlags: [] }) === 'pinned'
    && thresholdBasis([{ sourceExcludeReason: 'pinned' as const }]).eligible.length === 0)
check('🔴 그래도 목록 JSONL 에는 남긴다',
  COLLECTOR_CODE.indexOf('writeJsonl(OUT_LIST') < COLLECTOR_CODE.indexOf('sourceExcludeReason'),
  '지우는 것이 아니라 자동 경로에서만 뺀다 — 정책 Q-1')
{
  const base = { sourceArticleId: '1', sourceUrl: ARTICLE_URL('remonterrace', '1'), originalTitle: '오늘 저녁 반찬 고민', sourceCommentCount: 0 }
  const r = buildCollected('remonterrace', { ...base, sourceRowLabel: '공지', sourcePinned: true, sourceMenuId: '23', sourceBoardKey: 'remonterrace:jjong' }, '본문'.repeat(60), '2026-09-03T07:00:00.000Z')
  check('산출물에 라벨·게시판 메타가 남는다',
    r.sourceRowLabel === '공지' && r.sourcePinned && r.sourceMenuId === '23' && r.sourceBoardKey === 'remonterrace:jjong')
  check('🔴 sourceSite 계약은 그대로다', r.sourceSite === 'navercafe:remonterrace')
  check('메타 없으면 기본값', (() => {
    const b = buildCollected('remonterrace', base, '본문'.repeat(60), '2026-09-03T07:00:00.000Z')
    return b.sourceRowLabel === null && !b.sourcePinned && b.sourceMenuId === null && b.sourceBoardKey === null
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n㉔ 정치·진영 제외 — 🔴 제목 단위. 게시판으로 판정하지 않는다')
// ─────────────────────────────────────────────────────────
for (const t of ['요즘 정치 얘기 너무 많아요', '진영 논리에 지친다', '이념 갈등이 심하네요',
  '정당 지지율 보셨어요', '선거 끝나고 조용하네', '대통령 발언 어떻게 보세요',
  '국회 뉴스 보다가', '공직자 재산공개', '정치인 인터뷰 봤는데', '좌파 우파 싸움']) {
  check(`제외: "${t.slice(0, 10)}…"`, judgePoliticsTitle(t).excluded)
}
for (const t of [
  '비상계엄 포고령 봤어요',
  '김건희특검과 채상병특검 뉴스',
  '조희대 코트패킹 논란',
  '한덕수 권한대행 이야기',
  '좌빨 수꼴 댓글부대 싸움',
  '친문 비명 팬덤정치',
  '대장동 백현동 성남FC 의혹',
  '거부권과 체포동의안',
  '지방선거 출구조사',
  '기본소득당 사회민주당',
  '방송3법과 중대재해처벌법',
  '사드 배치와 대북전단',
  '선관위 감사원 방통위',
  '촛불집회 탄핵집회',
]) {
  check(`제외: 정치 확장 "${t.slice(0, 14)}…"`, judgePoliticsTitle(t).excluded)
}
check('🔴 2026-09-03 실측에서 놓쳤던 단독 "정치" 를 이제 잡는다',
  judgePoliticsTitle('정치 얘기는 그만').excluded && judgePoliticsTitle('정치 얘기는 그만').hit === '정치')
for (const t of ['오늘 저녁 반찬 고민', '갱년기 불면증 어떻게 하세요', '아들 결혼식 준비',
  '무릎 관절 병원 추천', '드라마 마지막회 보셨어요', '가수 콘서트 다녀왔어요',
  '미리 감사드립니다', '부모님 옷 사드릴까요', '반장 선거 준비물', '동대표 선거 안내',
  '아파트 외벽 보수공사 하는데 시끄럽네요']) {
  check(`🟢 통과: "${t.slice(0, 10)}…"`, !judgePoliticsTitle(t).excluded)
}
// ─────────────────────────────────────────────────────────
// 🔴 `친한` 오탐 정정 (2026-09-05 · PR-S2-b-33)
//    "정말친한친구와 수다떠시나요" 가 politics hardExclude 됐다.
//    친한계·친한파(親韓)는 정치어가 맞지만 일상어 "친한 친구" 와 충돌한다.
//    → 정치 맥락에서만 잡도록 좁혔다. 다른 계파어는 건드리지 않았다.
// ─────────────────────────────────────────────────────────
for (const t of ['친한계', '친한파', '친한동훈 의원', '친한 후보 지지', '친한 의원 발언',
  '친한 인사', '친한 지도부', '친한 세력', '친한계 갈등']) {
  check(`🔴 정치 유지: "${t}"`, judgePoliticsTitle(t).excluded)
}
for (const t of ['친한 친구', '정말친한친구와 뇌를살짝빼두시고 수다떠시나요???', '친한 언니',
  '친한 동생', '친한 엄마', '친한 지인', '친한 사람', '친한 사이', '친한 친구와 수다']) {
  check(`🟢 생활 통과: "${t.slice(0, 14)}…"`, !judgePoliticsTitle(t).excluded,
    '이대로 두면 레테·우갱·82cook 생활글이 정치로 제외된다')
}
// ─────────────────────────────────────────────────────────
// 🔴 정치 hard block 빈칸 보강 (2026-09-05 · PR-S2-b-34)
//    친윤 · 친명 · 특검 · 탄핵 은 **원래 목록에 없었다.**
//    PR-S2-b-33 의 `친한` 오탐을 조사하다 드러난 빈 자리다.
// ─────────────────────────────────────────────────────────
for (const t of ['친윤계', '친윤파', '친윤 의원', '친윤 후보', '친윤 지도부', '친윤 세력',
  '친명계', '친명파', '친명 의원', '친명 후보', '친명 지도부', '친명 세력',
  '특검', '내란특검', '김건희특검', '채상병특검', '채해병특검', '특검사건',
  '탄핵', '탄핵소추', '탄핵심판', '탄핵집회']) {
  check(`🔴 정치 보강: "${t}"`, judgePoliticsTitle(t).excluded)
}
// 🔴 실측 충돌 2종 — 이 커뮤니티는 상속·부동산·명절 글이 많다
for (const t of ['모친명의로 된 집', '모친명절 준비', '부친 명의 아파트',
  '절친윤아랑 만났어요', '건강검진 특검사', '특검사 받았어요']) {
  check(`🟢 생활 통과: "${t.slice(0, 14)}…"`, !judgePoliticsTitle(t).excluded,
    '모친명의·모친명절·특검사가 정치로 잡히면 생활글이 통째로 사라진다')
}

// 🔴 기존 계파어를 약화시키지 않았는지 — 하나라도 풀리면 정치 hard block 이 헐거워진다
for (const t of ['친문 지지자', '친박 인사', '비박계', '친이계', '비명계', '반윤 성향', '친조']) {
  check(`🔴 기존 계파어 유지: "${t}"`, judgePoliticsTitle(t).excluded)
}

check('🔴 연예·방송·셀럽은 정치와 분리한다',
  !judgePoliticsTitle('연예인 이혼 소식 놀랍네요').excluded
    && !judgePoliticsTitle('방송 보다가 눈물났어요').excluded,
  'Growth 후보이고 축이 다르다 (설계 §4-C)')
check('🔴 판정 단위가 제목이다 — 게시판 이름으로 판정하지 않는다',
  /judgePoliticsTitle\(item\.originalTitle\)/.test(LIB_CODE)
    && !/judgePoliticsTitle\((item\.)?source(BoardName|MenuId|BoardKey)/.test(LIB_CODE),
  '게시판 하나가 통째로 정치로 분류되면 그 게시판의 생활글까지 전부 사라진다')
check('🔴 collector 가 정치 행을 상세 후보에서 뺀다',
  /const eligible = basis\.eligible/.test(COLLECTOR_CODE)
    && judgeExcludeReason({ politicsExcluded: true, pinned: false, qualityFlags: [] }) === 'politics'
    && thresholdBasis([{ sourceExcludeReason: 'politics' as const }]).eligible.length === 0)
check('산출물에 판정이 남는다',
  buildCollected('remonterrace', { sourceArticleId: '1', sourceUrl: ARTICLE_URL('remonterrace', '1'), originalTitle: '정치 얘기', sourceCommentCount: 0 }, '본문'.repeat(60), '2026-09-03T07:00:00.000Z').sourcePoliticsExcluded)

// ─────────────────────────────────────────────────────────
console.log('\n㉕ scout(list-only) — 🔴 상세에 무조건 들어가지 않는다')
// ─────────────────────────────────────────────────────────
check('scout 가 detail 보다 깊이 본다', SCOUT_MAX_PAGES > DETAIL_MAX_PAGES)
check('모드별 상한', maxPagesFor('scout') === SCOUT_MAX_PAGES && maxPagesFor('detail') === DETAIL_MAX_PAGES)
check('쫑알쫑알 15장이 scout 상한 안에 든다', pagesOf(findBoard('remonterrace:jjong')!).length <= SCOUT_MAX_PAGES)
check('🔴 쫑알쫑알 15장은 detail 상한을 넘는다 (상세는 얕게)',
  pagesOf(findBoard('remonterrace:jjong')!).length > DETAIL_MAX_PAGES,
  '깊게 보려면 --scout 로 목록만 본다')
check('🔴 scout 는 상세를 열지 않고 종료한다',
  /if \(SCOUT\) \{[\s\S]{0,1400}return\s*\n\s*\}/.test(COLLECTOR_CODE),
  'PR-S2-b-9 에서 요약 줄이 늘어 블록이 길어졌다 — 상한만 넓힌다')
check('🔴 scout 종료가 상세 루프보다 앞이다',
  COLLECTOR_CODE.indexOf('if (SCOUT)') < COLLECTOR_CODE.indexOf('readArticleBody(page)'))
check('scout 에서도 목록은 기록한다',
  COLLECTOR_CODE.indexOf('writeJsonl(OUT_LIST') < COLLECTOR_CODE.indexOf('if (SCOUT)'),
  '조건 미달이던 글도 다음 실행에서 후보가 될 수 있어야 한다')
check('페이지 상한을 코드가 강제한다', /PAGE_LIST!\.length > PAGE_CAP/.test(COLLECTOR_CODE))

// ─────────────────────────────────────────────────────────
console.log('\n㉖ 게시판명 — 🔴 기본값을 조용히 씌우지 않는다 (PR-S2-b-8)')
// ─────────────────────────────────────────────────────────
check('🔴 board 가 있으면 그 label 로 채운다',
  /sourceBoardName: r\.board \|\| BOARD\?\.label \|\| null/.test(COLLECTOR_CODE),
  '개별 게시판 페이지에는 a.board_name 셀이 없다 — 쫑알쫑알 225건이 전부 "전체글보기" 로 기록됐다')
{
  const b = { sourceArticleId: '1', sourceUrl: ARTICLE_URL('remonterrace', '1'), originalTitle: '반찬 고민', sourceCommentCount: 0 }
  const withBoard = buildCollected('remonterrace', { ...b, sourceBoardName: '쫑알쫑알 게시판', sourceMenuId: '23', sourceBoardKey: 'remonterrace:jjong' }, '본문'.repeat(60), '2026-09-03T07:00:00.000Z')
  check('게시판명·menuId·boardKey 가 함께 남는다',
    withBoard.sourceBoardName === '쫑알쫑알 게시판' && withBoard.sourceMenuId === '23' && withBoard.sourceBoardKey === 'remonterrace:jjong')
  check('🔴 boardKey 의 label 과 일치한다',
    withBoard.sourceBoardName === findBoard(withBoard.sourceBoardKey!)!.label,
    '셋이 어긋나면 분석에서 게시판을 잘못 읽는다')
  const legacy = buildCollected('remonterrace', b, '본문'.repeat(60), '2026-09-03T07:00:00.000Z')
  check('전체글보기 기존 동작은 그대로', legacy.sourceBoardName === '전체글보기' && legacy.sourceBoardKey === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n㉗ 제외 사유 — 🔴 단일 판정. 축을 합치지도 흩뜨리지도 않는다')
// ─────────────────────────────────────────────────────────
{
  const J = (o: Partial<{ politicsExcluded: boolean; pinned: boolean; qualityFlags: string[] }>) =>
    judgeExcludeReason({ politicsExcluded: false, pinned: false, qualityFlags: [], ...o })
  check('정치 제목 → politics', J({ politicsExcluded: true }) === 'politics')
  check('politicalTopicLikely → politics', J({ qualityFlags: ['politicalTopicLikely'] }) === 'politics')
  check('🔴 politicalOrPublicFigure → publicFigure (더 이상 후보에 남지 않는다)',
    J({ qualityFlags: ['politicalOrPublicFigure'] }) === 'publicFigure',
    '실측에서 이 2건이 sourcePoliticsExcluded=false 라 자동 후보에 남을 수 있었다')
  check('고정 슬롯 → pinned', J({ pinned: true }) === 'pinned')
  check('해당 없으면 null', J({ qualityFlags: ['lowEngagement'] }) === null)
  check('🔴 정치가 실명보다 먼저다',
    J({ politicsExcluded: true, qualityFlags: ['politicalOrPublicFigure'] }) === 'politics',
    '정치이면서 실명인 글을 publicFigure 로 적으면 나중에 Growth 로 되살릴 후보처럼 보인다')
  check('🔴 정치가 고정 슬롯보다 먼저다', J({ politicsExcluded: true, pinned: true }) === 'politics')

  // 🔵 연예·방송·셀럽은 정치와 분리된다
  check('🔵 연예 제목은 politics 가 아니다',
    !judgePoliticsTitle('연예인 이혼 소식').excluded && !judgePoliticsTitle('드라마 마지막회').excluded)
  check('🔴 사유를 남기는 이유 — Growth 가 열리면 publicFigure 를 갈라야 한다',
    /Growth 레인이 열리면/.test(LIB),
    '사유를 안 남기면 그때 무엇을 되살릴지 알 수 없다')
  check('collector 가 단일 판정으로 후보를 고른다',
    /const eligible = basis\.eligible/.test(COLLECTOR_CODE)
      && /sourceExcludeReason === null/.test(LIB_CODE)
      && !/!r\.sourcePinned && !r\.sourcePoliticsExcluded/.test(COLLECTOR_CODE),
    '필터는 thresholdBasis 안에 하나만 있어야 한다')
  check('사유별로 다르게 보고한다',
    /실명·공인 언급/.test(COLLECTOR) && /고정 슬롯/.test(COLLECTOR) && /정치·진영/.test(COLLECTOR))
}

// ─────────────────────────────────────────────────────────
console.log('\n㉘ 목록 중복 — 🔴 threshold 분모를 오염시키지 않는다')
// ─────────────────────────────────────────────────────────
{
  const R = (id: string, page: number) => ({ sourceSite: 'navercafe:remonterrace', sourceArticleId: id, page })
  const d = dedupeListRows([R('1', 3), R('2', 3), R('1', 4), R('3', 4)])
  check('중복이 빠진다', d.rows.length === 3 && d.duplicates === 1)
  check('🔴 먼저 본 위치를 남긴다',
    d.rows.find((r) => r.sourceArticleId === '1')?.page === 3,
    '밀려 내려간 위치는 크롤 타이밍의 산물이다')
  check('🔴 조용히 버리지 않고 센다', d.duplicateIds.includes('1'))
  check('카페가 다르면 같은 id 도 별개',
    dedupeListRows([R('1', 1), { ...R('1', 1), sourceSite: 'navercafe:wgang' }]).rows.length === 2,
    '네이버 articleId 는 카페 안에서만 유일하다')
  check('중복이 없으면 그대로', dedupeListRows([R('1', 1), R('2', 1)]).duplicates === 0)
  check('🔴 collector 가 분석 전에 dedup 한다',
    COLLECTOR_CODE.indexOf('dedupeListRows') < COLLECTOR_CODE.indexOf('writeJsonl(OUT_LIST'),
    'threshold 를 백분율로 재는 순간 분모가 오염된다')
}

// ─────────────────────────────────────────────────────────
console.log('\n㉙ threshold — 🔴 후보일 뿐이다. 코드가 자동 판정하지 않는다')
// ─────────────────────────────────────────────────────────
check('후보 2개', THRESHOLD_CANDIDATES.length === 2)
check('후보 A/B 값', THRESHOLD_CANDIDATES[0].minComments === 10 && THRESHOLD_CANDIDATES[1].minComments === 15)
check('둘 다 조회 300', THRESHOLD_CANDIDATES.every((t) => t.minViews === 300))
{
  const T = THRESHOLD_CANDIDATES[0]
  check('둘 다 넘으면 통과', passesThreshold({ sourceCommentCount: 12, sourceViewCount: 400 }, T))
  check('하나만 넘으면 탈락',
    !passesThreshold({ sourceCommentCount: 12, sourceViewCount: 100 }, T)
      && !passesThreshold({ sourceCommentCount: 2, sourceViewCount: 400 }, T))
  check('🔴 조회수를 못 읽었으면 통과시키지 않는다',
    !passesThreshold({ sourceCommentCount: 99, sourceViewCount: null }, T),
    '미지값을 0 으로도 무한대로도 보지 않는다')
}
check('🔴 자동 선별이 threshold 를 쓰지 않는다',
  !/passesThreshold\([\s\S]{0,80}planAutoFetch/.test(COLLECTOR_CODE)
    && /후보 \$\{t\.label\}/.test(COLLECTOR_CODE),
  '표본이 2.3시간짜리 하나뿐이라 확정하기에는 이르다 — 세어만 본다')

// ─────────────────────────────────────────────────────────
console.log('\n㉚ threshold 기준 — 🔴 전체가 아니라 제외 후 후보다 (PR-S2-b-9)')
// ─────────────────────────────────────────────────────────
{
  // 🔴 2026-09-03 유머·연예 1p 실측을 그대로 옮긴 모양:
  //    고정 슬롯은 조회수 중앙이 2,111 로 일반 글(321)의 7배다.
  //    전체에 threshold 를 걸면 **상세를 열 수도 없는 행이 통과율을 끌어올린다.**
  const row = (reason: 'pinned' | 'politics' | 'publicFigure' | null, c: number, v: number) =>
    ({ sourceExcludeReason: reason, sourceCommentCount: c, sourceViewCount: v })
  const rows = [
    ...Array.from({ length: 7 }, () => row('pinned', 50, 2111)),   // 고정 슬롯 — 전부 통과할 값
    row('politics', 30, 900),
    row('publicFigure', 30, 900),
    row(null, 12, 400),                                            // 진짜 후보 중 통과 1건
    ...Array.from({ length: 13 }, () => row(null, 2, 100)),         // 진짜 후보 중 미달
  ]
  const b = thresholdBasis(rows)
  check('전체와 후보를 나눠 센다', b.total === 23 && b.eligible.length === 14)
  check('🔴 제외 사유가 있는 행은 후보가 아니다',
    b.eligible.every((r) => r.sourceExcludeReason === null))

  const T = THRESHOLD_CANDIDATES[0]
  const whole = rows.filter((r) => passesThreshold(r, T)).length
  const elig = b.eligible.filter((r) => passesThreshold(r, T)).length
  check('🔴 전체 기준이면 부풀려진다 (착시)',
    whole === 10 && elig === 1,
    `전체 ${whole}건 vs 후보 ${elig}건 — 고정 슬롯이 통과율을 끌어올린다`)
  // 🔴 비교용 `whole` 계산 자체는 남긴다 — 착시를 보여주는 것이 목적이다.
  //    봐야 하는 것은 "보고하는 비율의 분모가 후보 수인가" 다.
  check('🔴 collector 가 후보 기준으로 센다',
    /const n = basis\.eligible\.filter\(\(r\) => passesThreshold/.test(COLLECTOR_CODE)
      && /const pct = basis\.eligible\.length === 0 \? 0 : Math\.round\(\(n \/ basis\.eligible\.length\)/.test(COLLECTOR_CODE),
    '비율의 분모가 후보 수여야 한다')
  check('전체 기준도 함께 보여주되 비교 축이 아니라고 적는다',
    /비교 축이 아니다/.test(COLLECTOR),
    '쫑알쫑알 9% 와 유머 35% 를 나란히 놓으면 안 되는 이유가 이것이다')
  check('로그가 전체·제외·후보를 구분한다',
    /목록 \$\{basis\.total\}건 기록/.test(COLLECTOR_CODE)
      && /제외 \$\{basis\.total - basis\.eligible\.length - basis\.legacy\}건 → 상세 후보 \$\{basis\.eligible\.length\}건/.test(COLLECTOR_CODE),
    '🔴 제외 수에서 legacy 를 빼야 한다 — 판정 없는 행을 제외로 세면 안 된다')
  // 🔴 이 저장소가 반복해온 "조용한 0" 을 여기서도 막는다.
  //    구 산출물(PR-S2-b-8 이전)에는 sourceExcludeReason 필드가 없다 —
  //    그걸 제외로 떨어뜨리면 225건이 "후보 0건 · NaN%" 가 되고 아무도 이유를 모른다.
  check('🔴 판정 없는 행을 제외로 세지 않고 따로 알린다',
    (() => {
      const b = thresholdBasis([{ sourceCommentCount: 1, sourceViewCount: 1 } as never, row(null, 1, 1)])
      return b.legacy === 1 && b.eligible.length === 1 && b.total === 2
    })(),
    '"판정이 없다" 와 "제외 판정을 받았다" 는 다른 사실이다')
  check('판정이 다 있으면 legacy 0', thresholdBasis(rows).legacy === 0)
  check('collector 가 판정 없는 행을 경고한다',
    /판정 없는 행 \$\{basis\.legacy\}건/.test(COLLECTOR_CODE))
  check('🔴 후보가 0건이어도 나눗셈이 터지지 않는다',
    (() => {
      const empty = thresholdBasis([row('pinned', 50, 2111)])
      return empty.eligible.length === 0
    })())
  check('상세 경로도 같은 basis 를 쓴다',
    /const eligible = basis\.eligible/.test(COLLECTOR_CODE),
    '요약과 실제 선별이 다른 집합을 보면 보고가 거짓이 된다')
  check('🔴 threshold 값은 여전히 확정이 아니다',
    THRESHOLD_CANDIDATES.length === 2
      && THRESHOLD_CANDIDATES[0].minComments === 10 && THRESHOLD_CANDIDATES[1].minComments === 15
      && THRESHOLD_CANDIDATES.every((t) => t.minViews === 300))
  check('제외 사유 분포는 계속 출력한다',
    /정치·진영 \$\{byReason\.politics\}건/.test(COLLECTOR_CODE)
      && /실명·공인 언급 \$\{byReason\.publicFigure\}건/.test(COLLECTOR_CODE)
      && /고정 슬롯 \$\{byReason\.pinned\}건/.test(COLLECTOR_CODE))
}

// ─────────────────────────────────────────────────────────
console.log(failed === 0
  ? '\n✅ 전부 통과 — 네이버 수집은 로컬·raw-only 밖으로 나가지 않는다.\n'
  : `\n❌ ${failed}건 실패\n`)
process.exit(failed === 0 ? 0 : 1)
