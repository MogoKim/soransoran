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

  const WANT = ['sourceSite','sourceUrl','sourceArticleId','sourceBoardName','sourceCommentCount',
    'originalTitle','rawBody','sourceCapturedAt','dedupKey','qualityFlags','qualitySignals']
  check(`산출물이 11필드다 (82cook 과 동일)`, WANT.every((k) => k in row) && Object.keys(row).length === WANT.length,
    Object.keys(row).join(','))
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
check('🔴 여우야는 shadow 다 (뷰티·미용 관심사)',
  findCafe('yeowooya')?.stage === 'shadow' && /뷰티|미용/.test(findCafe('yeowooya')?.note ?? ''))
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
console.log(failed === 0
  ? '\n✅ 전부 통과 — 네이버 수집은 로컬·raw-only 밖으로 나가지 않는다.\n'
  : `\n❌ ${failed}건 실패\n`)
process.exit(failed === 0 ? 0 : 1)
