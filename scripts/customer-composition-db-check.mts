#!/usr/bin/env tsx
/**
 * 고객 구성 — 운영 DB **읽기 전용** 정합성·성능 검사(CB-M4). 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §11.
 *
 *   npm run check:customer-composition-db                    자기검사만. 🔴 DB 에 연결하지 않는다
 *   npm run check:customer-composition-db -- --live-readonly 운영 조회 — 한 번, read-only 트랜잭션 안에서만
 *
 * 🔴 연결은 이미 프로세스 환경에 있는 DATABASE_URL 하나만 쓴다. DIRECT_URL·파일·외부 콘솔에서 가져오지 않는다.
 * 🔴 연결 전에 URL 을 메모리에서만 읽어 Supabase project ref 를 확인한다. URL 의 어떤 조각도 출력하지 않는다.
 * 🔴 출력은 report() 하나로만 나간다 — 숫자, 그리고 정해진 상태 낱말뿐이다. 회원 id·이메일·전화번호·
 *    providerAccountId·개별 출생연도·개별 동의 시각·글/댓글 원문·환경변수 항목은 타입상 자리가 없다.
 * 🔴 판정·집계·불변식은 src/lib/customer-composition-m4.ts 코어에 있다. 이 파일은 인수·출력·자기검사·종료 코드만 맡는다.
 *    코어의 운영 조회 구간(LIVE-READONLY 표시 사이)은 이 자기검사가 소스를 읽어 쓰기 문장·쓰기 메서드·순서를 확인한다.
 *    실행 중에도 집계 client 는 읽기 메서드만 통과시킨다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { AGE_BAND_ORDER, ageBandLabel, formatShare, totalOf, type AgeCounts } from '../src/lib/customer-composition'
import {
  M4_EXPECTED_PROJECT_REF,
  WriteBlocked,
  birthyearQuality,
  compositionInvariants,
  decideLiveStart,
  envKeyState,
  m4ClientRuntime,
  perfVerdict,
  pickM4Env,
  readOnlyDelegate,
  runM4Readonly,
  safeErrorKind,
  supabaseProjectRef,
  type M4ClientFactory,
  type M4LiveClient,
  type M4Result,
  type M4Word,
} from '../src/lib/customer-composition-m4'

const LIVE_FLAG = '--live-readonly'

// ─────────── 출력 — 이 함수 하나로만 나간다 ───────────

/** 🔴 값은 숫자·정해진 낱말·분자/분모 표기뿐이다. 자유 문자열을 받지 않는다 */
function report(label: string, value: number | M4Word | { n: number; d: number }): void {
  const v = typeof value === 'object' ? formatShare(value.n, value.d) : String(value)
  console.log(`  ${label}: ${v}`)
}
function heading(title: string): void {
  console.log(`\n■ ${title}`)
}

/**
 * 코어 결과 → 텍스트. 🔴 코어가 돌려준 숫자·낱말만 그린다 — 판정을 여기서 다시 하지 않는다.
 * 줄 순서·라벨은 코어 분리 전 검사기 출력과 같다.
 */
function renderM4(r: M4Result): void {
  heading('운영 연결 사전조건')
  if (r.config === null) {
    report('DATABASE_URL', r.precondition.databaseUrl)
    report('project ref', r.precondition.projectRef)
    report('DB 연결', '연결 안 함')
    report('판정', r.verdict)
    return
  }
  report('project ref', '확인')
  report('SORAN_ADMIN_EMAILS', r.config.admin.state)
  report('SORAN_ADMIN_EMAILS 항목 수', r.config.admin.items)
  report('SIGNUP_ALLOWLIST', r.config.allow.state)
  report('SIGNUP_ALLOWLIST 항목 수', r.config.allow.items)

  const d = r.composition
  if (d && r.readOnly && r.birthyear && r.perf && r.operatorCandidates) {
    report('DB 연결', '연결함')
    report('transaction_read_only', r.readOnly.transactionReadOnly)
    report('statement_timeout(ms)', r.readOnly.statementTimeoutMs)

    heading('고객 구성 (집계)')
    report('분석연령 기준연도', d.baseYear)
    report('실제 여성 가입 완료 고객', d.femaleTotal)
    report('50대 (50~59세)', { n: d.fifties, d: d.femaleTotal })
    for (const key of AGE_BAND_ORDER) report(ageBandLabel(key), d.femaleByAge[key])
    report('성별 미확인 (가입 완료 대상 중)', d.onboarded.genderUnknown)
    report('확인된 남성 (가입 완료 대상 중)', d.onboarded.male)
    report('차단 여성 고객', d.femaleBlocked)
    report('참여 가능한 여성 고객', d.eligibleTotal)

    heading('참여 (고유 회원)')
    const p = d.participation
    report('일반 글 작성', { n: totalOf(p.generalPost), d: d.eligibleTotal })
    report('댓글 작성', { n: totalOf(p.comment), d: d.eligibleTotal })
    report('일반 글 또는 댓글', { n: totalOf(p.postOrComment), d: d.eligibleTotal })
    report('가입인사 작성', { n: totalOf(p.greeting), d: d.eligibleTotal })
    for (const key of AGE_BAND_ORDER) {
      report(`${ageBandLabel(key)} 대상`, p.eligible[key])
      report(`${ageBandLabel(key)} 글 또는 댓글`, { n: p.postOrComment[key], d: p.eligible[key] })
    }
    for (const b of d.boards) {
      report(`게시판 ${b.boardType} 일반 글 작성 회원`, b.postAuthors)
      report(`게시판 ${b.boardType} 댓글 작성 회원`, b.commentAuthors)
    }

    heading('가입 후 7일 내 참여')
    report('7일 관측 완료', totalOf(d.sevenDay.complete))
    report('7일 내 참여', { n: totalOf(d.sevenDay.participated), d: totalOf(d.sevenDay.complete) })
    report('관측 중', d.sevenDay.observing)
    report('산정 불가 (TERMS 동의 기록 없음)', d.sevenDay.noBasis)
    report('가입 완료 대상 전체 중 TERMS 동의 기록 없음', d.onboardedNoTerms)

    heading('정합성 불변식')
    for (const inv of r.invariants) report(inv.label, inv.ok ? 'PASS' : 'FAIL')

    heading('운영·시험 계정 일치 후보 (카카오 실회원 · 가입 완료 중, 값 출력 없음)')
    report('User.isAdmin=true', r.operatorCandidates.isAdmin)
    report('SORAN_ADMIN_EMAILS 이메일 일치', r.operatorCandidates.adminEmail)
    report('SIGNUP_ALLOWLIST 이메일 일치', r.operatorCandidates.allowlistEmail)
    report('SIGNUP_ALLOWLIST 카카오 회원번호 일치', r.operatorCandidates.allowlistAccount)

    heading('출생연도 품질 (실제 여성 고객 · 범주는 겹칠 수 있음)')
    const q = r.birthyear
    report('null 또는 빈 값', q.nullOrEmpty)
    report('네 자리 숫자 형식 아님', q.notFourDigits)
    report('앞뒤 공백', q.surroundingSpace)
    report('0으로 시작 (0000 등)', q.leadingZero)
    report('미래 연도', q.future)
    report('분석연령 120세 초과', q.over120)
    report('120세 초과 판단', q.review)

    heading('성능 (한 번 측정 · read-only REPEATABLE READ 트랜잭션 안 — 실제 화면보다 보수적)')
    report('DB 연결(ms)', r.perf.connectMs)
    report('집계 실행(ms)', r.perf.aggregateMs)
    report('집계 쿼리 수', r.perf.queries)
    report('집계 반환 행 수', r.perf.rows)
    report('성능 판정', r.perf.verdict)

    heading('판정')
    // 연결 종료가 실패했으면 이 줄 뒤에 FAIL 이 한 번 더 붙는다(분리 전과 같은 순서)
    report('판정', r.analysisVerdict ?? r.verdict)
  }
  if (r.error) {
    heading('중단')
    report('오류 종류', r.error.kind)
    if (r.error.code !== null) report('Prisma 오류 코드(P 뒤 숫자)', r.error.code)
    report('판정', 'M4 FAIL')
  }
  if (r.disconnect === 'DISCONNECT_FAILED') {
    report('연결 종료', 'DISCONNECT_FAILED')
    report('판정', 'M4 FAIL')
  }
}

/** 운영 조회 1회 — 🔴 세 키만 골라 코어에 넘긴다 */
async function runLiveReadonly(
  env: Record<string, string | undefined>,
  makeClient: M4ClientFactory = m4ClientRuntime.factory,
): Promise<number> {
  const result = await runM4Readonly(makeClient, pickM4Env(env), new Date())
  renderM4(result)
  return result.exitCode
}

// ─────────── 자기검사 — DB 에 연결하지 않는다 ───────────

const originalConsoleLog = console.log

async function selfCheck(): Promise<number> {
  let pass = 0
  let fail = 0
  const check = (label: string, ok: boolean): void => {
    ok ? (pass += 1) : (fail += 1)
    console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  }
  const root = join(import.meta.dirname, '..')
  const self = readFileSync(join(import.meta.dirname, 'customer-composition-db-check.mts'), 'utf8')
  const core = readFileSync(join(root, 'src/lib/customer-composition-m4.ts'), 'utf8')
  const query = readFileSync(join(root, 'src/lib/queries/customer-composition.ts'), 'utf8')
  const begin = core.indexOf('/* LIVE-READONLY:BEGIN')
  const end = core.indexOf('/* LIVE-READONLY:END */')
  const live = begin >= 0 && end > begin ? core.slice(begin, end) : ''
  // 블록 주석과 줄 주석을 지운다. 🔴 `postgresql://` 처럼 `:` 뒤의 // 는 주석이 아니다
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const liveCode = code(live)
  const coreCode = code(core)
  const selfCode = code(self)
  // CLI 실행 코드 = 자기검사 함수 앞부분(출력·렌더·운영 호출). 자기검사 안의 문자열에 검사가 걸리지 않게 나눈다
  const cliRuntime = selfCode.slice(0, selfCode.indexOf('async function selfCheck'))

  heading('1. 운영 조회 구간(코어) — 소스 검사')
  check('코어에서 LIVE-READONLY 구간을 찾았다', live.length > 0)
  const sqlWords = ['INSERT', 'UPDATE', 'DELETE', 'UPSERT', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE']
  for (const w of sqlWords) {
    check(`운영 구간·집계 모듈에 ${w} 없음`, !new RegExp(`\\b${w}\\b`).test(liveCode) && !new RegExp(`\\b${w}\\b`).test(code(query)))
  }
  const mutation = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/
  check('운영 구간에 Prisma 쓰기 메서드 호출 없음', !mutation.test(liveCode))
  check('집계 모듈에 Prisma 쓰기 메서드 호출 없음', !mutation.test(code(query)))
  check('Unsafe raw 호출 없음 (코어 전체)', !/\$(queryRawUnsafe|executeRawUnsafe)/.test(coreCode))
  const raws = [...coreCode.matchAll(/\$(?:executeRaw|queryRaw)(?:<[^`]*>)?`([^`]*)`/g)].map((m) => m[1])
  check('raw SQL 은 고정된 SET·SHOW 세 문장뿐 (코어 전체)', JSON.stringify(raws) === JSON.stringify([
    'SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '10000ms'", 'SHOW transaction_read_only',
  ]))
  check('raw SQL 에 ${} 결합 없음', raws.every((s) => !s.includes('${')))
  const iRo = liveCode.indexOf('SET TRANSACTION READ ONLY')
  const iTo = liveCode.indexOf('statement_timeout')
  const iShow = liveCode.indexOf('SHOW transaction_read_only')
  const iCheck = liveCode.indexOf("!== 'on'")
  const iLoad = liveCode.indexOf('loadCustomerComposition(')
  const iFirstDelegate = liveCode.search(/tx\.(user|post|comment|agreement)\b/)
  check('READ ONLY → timeout → SHOW → on 확인 → 집계 순서', iRo > 0 && iRo < iTo && iTo < iShow && iShow < iCheck && iCheck < iLoad)
  check('트랜잭션의 첫 모델 접근은 read-only 확인 뒤', iFirstDelegate > iCheck)
  check('집계는 정확히 한 번 호출', (liveCode.match(/loadCustomerComposition\(/g) ?? []).length === 1)
  check('집계는 트랜잭션 client(tx)로만 — 공용 prisma 를 쓰지 않음', !/from '@\/lib\/prisma'/.test(core) && !/from '\.\.\/src\/lib\/prisma'/.test(self) && !/\bprisma\./.test(liveCode))
  check('statement timeout 존재', liveCode.includes("SET LOCAL statement_timeout = '10000ms'") && coreCode.includes('M4_STATEMENT_TIMEOUT_MS = 10_000'))
  check('REPEATABLE READ — 집계와 직접 count 가 같은 스냅샷', liveCode.includes('TransactionIsolationLevel.RepeatableRead'))
  check('finally 에서 client 가 있을 때만 연결 종료', /finally\s*\{\s*if \(client !== null\)\s*\{\s*try\s*\{\s*await client\.\$disconnect\(\)/.test(liveCode))
  check('연결 종료 오류는 묶지 않고(catch {}) 정해진 낱말로만', /await client\.\$disconnect\(\)\s*r\.disconnect = 'OK'\s*\}\s*catch\s*\{\s*r\.disconnect = 'DISCONNECT_FAILED'/.test(liveCode))
  check('client 생성은 try 안 — 생성 오류도 safeErrorKind 로', /try \{\s*client = makeClient\(start\.url\)/.test(liveCode) && (liveCode.match(/makeClient\(/g) ?? []).length === 1)
  check('new PrismaClient 는 코어 factory 한 곳뿐 (CLI 0)', (liveCode.match(/new PrismaClient\(/g) ?? []).length === 1 && (coreCode.match(/new PrismaClient\(/g) ?? []).length === 1 && !/new PrismaClient\(/.test(cliRuntime))
  check('운영 구간이 오류의 message·stack 을 읽지 않음', !/\.(message|stack)\b/.test(liveCode))
  check('query·error 로그를 끈다(log: [])', liveCode.includes('log: []'))
  // 주석과 문자열 리터럴을 지운 코드에 그 이름이 없으면 어떤 경로도 그 값을 읽지 않는다
  const strip = (src: string) => src.replace(/'[^'\n]*'|`[^`]*`/g, '')
  check('DIRECT_URL 을 참조하지 않음 (CLI·코어)', ![selfCode, coreCode].some((c) => strip(c).includes(['DIRECT', 'URL'].join('_'))))
  check('연결은 decideLiveStart 가 돌려준 DATABASE_URL 로만', liveCode.includes('makeClient(start.url)') && liveCode.includes('datasourceUrl: url, log: []') && (liveCode.match(/datasourceUrl:/g) ?? []).length === 1)
  check('코어는 console·process.exit·process.env·node:fs 를 쓰지 않음', !/console\.|process\.exit|process\.env|node:fs/.test(coreCode))
  check('결과에 URL·환경변수 값을 담지 않음', !/r\.[\w.]+\s*=\s*(start\.url|url\b|env\b|env\.)/.test(liveCode))
  check('운영 구간이 개인 필드를 select 하지 않음', !/(email|nickname|name|phoneNumber|providerAccountId|birthyear|content|title|agreedAt)\s*:\s*true/.test(liveCode))
  check('오류 원문을 담지 않음 — safeErrorKind 만', /catch \(e\) \{\s*r\.error = safeErrorKind\(e\)/.test(liveCode) && !/\.message/.test(liveCode))
  check('CLI 는 판정·집계를 다시 하지 않음 — 코어 호출 1곳', cliRuntime.length > 0 && (cliRuntime.match(/runM4Readonly\(/g) ?? []).length === 1 && !/loadCustomerComposition|compositionInvariants\(|perfVerdict\(|safeErrorKind\(|\$transaction|\$queryRaw|\$executeRaw/.test(cliRuntime))
  check('CLI 는 세 키만 골라 코어에 넘김', /runM4Readonly\(makeClient, pickM4Env\(env\), new Date\(\)\)/.test(cliRuntime))
  check('main 은 플래그가 있을 때만 운영 경로를 부른다', /process\.argv\.includes\(LIVE_FLAG\)\s*\?\s*runLiveReadonly\(process\.env\)\s*:\s*selfCheck\(\)/.test(selfCode))
  check('최상위 예외도 원문 없이 FAIL 로', /\}\s*catch\s*\{\s*report\('오류 종류', 'UNKNOWN_ERROR'\)\s*report\('판정', 'M4 FAIL'\)/.test(selfCode))

  heading('2. project ref 판정 (가짜 주소)')
  const R = M4_EXPECTED_PROJECT_REF
  check('direct host → ref', supabaseProjectRef(`postgresql://postgres:pw@db.${R}.supabase.co:5432/postgres`) === R)
  check('pooler username → ref', supabaseProjectRef(`postgresql://postgres.${R}:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true`) === R)
  check('pooler 인데 username 에 ref 없음 → null', supabaseProjectRef('postgresql://postgres:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres') === null)
  check('direct host 와 username ref 가 다르면 null', supabaseProjectRef(`postgresql://postgres.abcdefghijklmnopqrst:pw@db.${R}.supabase.co:5432/postgres`) === null)
  check('다른 프로젝트 → 다른 ref', supabaseProjectRef('postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres') === 'abcdefghijklmnopqrst')
  check('supabase 가 아닌 host → null', supabaseProjectRef(`postgresql://postgres.${R}:pw@db.${R}.evil.example.com:5432/postgres`) === null)
  check('host 가 supabase.co 를 흉내 내면 null', supabaseProjectRef(`postgresql://u:pw@db.${R}.supabase.co.evil.com/postgres`) === null)
  check('localhost → null', supabaseProjectRef('postgresql://postgres@127.0.0.1:5432/soran_test') === null)
  check('URL 아님 → null', supabaseProjectRef('not a url') === null && supabaseProjectRef('') === null)
  check('postgres 가 아닌 scheme → null', supabaseProjectRef(`https://db.${R}.supabase.co`) === null)

  heading('3. 연결 시작 판정 — DATABASE_URL 만')
  check('DATABASE_URL 없음 → BLOCKED_CREDENTIALS', JSON.stringify(decideLiveStart({})) === JSON.stringify({ ok: false, verdict: 'M4 BLOCKED_CREDENTIALS', reason: 'CONNECTION' }))
  check('DIRECT_URL 만 있어도 BLOCKED (대신 쓰지 않음)', !decideLiveStart({ ['DIRECT' + '_URL']: `postgresql://postgres:pw@db.${R}.supabase.co:5432/postgres` }).ok)
  check('다른 프로젝트 → FAIL · 연결 안 함', JSON.stringify(decideLiveStart({ DATABASE_URL: 'postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co/postgres' })) === JSON.stringify({ ok: false, verdict: 'M4 FAIL', reason: 'PROJECT_REF' }))
  check('맞는 프로젝트 → 시작 가능', decideLiveStart({ DATABASE_URL: `postgresql://postgres:pw@db.${R}.supabase.co/postgres` }).ok)

  heading('4. 운영 제외 환경 키 — 값 없이 상태와 개수만')
  check('키 없음', JSON.stringify(envKeyState({}, 'SIGNUP_ALLOWLIST')) === JSON.stringify({ state: '키 없음', items: 0 }))
  check('빈 문자열 = 설정됐지만 항목 0개', JSON.stringify(envKeyState({ SIGNUP_ALLOWLIST: '' }, 'SIGNUP_ALLOWLIST')) === JSON.stringify({ state: '설정됐지만 항목 0개', items: 0 }))
  check('쉼표·공백만 = 항목 0개', envKeyState({ SIGNUP_ALLOWLIST: ' , ' }, 'SIGNUP_ALLOWLIST').items === 0)
  check('항목 수 (중복·대소문자 합침)', JSON.stringify(envKeyState({ SORAN_ADMIN_EMAILS: 'a@x.com, A@x.com ,b@y.com' }, 'SORAN_ADMIN_EMAILS')) === JSON.stringify({ state: '설정됨', items: 2 }))

  heading('5. 출생연도 품질 범주')
  const qq = birthyearQuality(
    [
      { birthyear: null, count: 2 }, { birthyear: '', count: 1 }, { birthyear: '  ', count: 1 },
      { birthyear: ' 1975', count: 3 }, { birthyear: 'abcd', count: 1 }, { birthyear: '19750', count: 1 },
      { birthyear: '0000', count: 1 }, { birthyear: '2030', count: 2 }, { birthyear: '1899', count: 1 },
      { birthyear: '1906', count: 1 }, { birthyear: '1973', count: 5 },
    ],
    2026,
  )
  check('null·빈 값·공백만 = 4', qq.nullOrEmpty === 4)
  check('앞뒤 공백 = 3', qq.surroundingSpace === 3)
  check('네 자리 숫자 아님 = 2', qq.notFourDigits === 2)
  check('0으로 시작 = 1', qq.leadingZero === 1)
  check('미래 연도 = 2', qq.future === 2)
  check('120세 초과 = 0000(2026세) + 1899(127세) = 2 · 1906(120세)은 아님', qq.over120 === 2)
  check('parseBirthyear 미확인 = 4 + 3 + 2 + 1 + 2 = 12', qq.unparseable === 12)

  heading('6. 불변식·성능 판정')
  const z = (n = 0) => Object.fromEntries(AGE_BAND_ORDER.map((k) => [k, n])) as AgeCounts
  const good = {
    femaleByAge: { ...z(), '50-54': 2, '55-59': 1, unknown: 1 }, femaleBlocked: 1,
    eligible: { ...z(), '50-54': 2, '55-59': 1 }, generalPost: { ...z(), '50-54': 1 }, comment: { ...z(), '55-59': 1 },
    postOrComment: { ...z(), '50-54': 1, '55-59': 1 }, greeting: z(), boards: [{ postAuthors: 1, commentAuthors: 1 }],
    sevenDay: { noBasis: 1, observing: 1, complete: { ...z(), '50-54': 1 }, participated: { ...z(), '50-54': 1 } },
    directFemaleCount: 4, directActiveCount: 3,
  }
  check('정상 입력 → 전부 PASS', compositionInvariants(good).every((i) => i.ok))
  check('직접 count 불일치 → FAIL', !compositionInvariants({ ...good, directFemaleCount: 5 }).every((i) => i.ok))
  check('7일 분해 불일치 → FAIL', !compositionInvariants({ ...good, sevenDay: { ...good.sevenDay, noBasis: 0 } }).every((i) => i.ok))
  check('참여 > 대상 → FAIL', !compositionInvariants({ ...good, comment: { ...z(), '55-59': 2 } }).every((i) => i.ok))
  check('성능 5000ms = PASS · 5001 = PARTIAL · 10000 = PARTIAL · 10001 = FAIL',
    perfVerdict(5000) === 'PASS' && perfVerdict(5001) === 'PARTIAL' && perfVerdict(10_000) === 'PARTIAL' && perfVerdict(10_001) === 'FAIL')

  heading('7. 실행 중 쓰기 차단 · 오류 원문 비노출')
  const meter = { queries: 0, rows: 0 }
  const fake = readOnlyDelegate({ count: async () => 3, findMany: async () => [1, 2], update: async () => 'x', deleteMany: async () => 'x' }, meter)
  let blocked = 0
  for (const m of ['update', 'deleteMany'] as const) {
    try {
      ;(fake[m] as () => unknown)()
    } catch (e) {
      if (e instanceof WriteBlocked) blocked += 1
    }
  }
  check('쓰기 메서드는 부르는 순간 차단', blocked === 2)
  await Promise.all([fake.count(), fake.findMany()])
  check('읽기 메서드는 통과하고 쿼리·행을 센다', meter.queries === 2 && meter.rows === 3)
  const secret = new Error('connect to postgresql://postgres:hunter2@db.x.supabase.co failed')
  const kind = safeErrorKind(secret)
  check('오류 분류는 정해진 낱말뿐 — 원문을 담지 않음', kind.kind === 'UNKNOWN_ERROR' && !JSON.stringify(kind).includes('hunter2'))
  check('statement timeout 분류', safeErrorKind(new Error('canceling statement due to statement timeout')).kind === 'STATEMENT_TIMEOUT')

  heading('8. 실패 경로 — 가짜 client 로 (DB 없음)')
  const SECRET_PW = 'hunter2-fake-pw'
  const SECRET_HOST = 'fake-host.internal.example'
  const fakeEnv = { DATABASE_URL: `postgresql://postgres:${SECRET_PW}@db.${M4_EXPECTED_PROJECT_REF}.supabase.co:5432/postgres` }
  const leak = new Error(`connect failed postgresql://postgres:${SECRET_PW}@${SECRET_HOST}:5432/postgres`)
  const reject = () => Promise.reject(leak)
  const fakeClient = (o: { connect?: () => Promise<void>; tx?: () => Promise<never>; disconnect?: () => Promise<void>; onDisconnect?: () => void }): M4LiveClient =>
    ({
      $connect: o.connect ?? (() => Promise.resolve()),
      $transaction: o.tx ?? (() => Promise.reject(new Error('canceling statement due to statement timeout'))),
      $disconnect: async () => {
        o.onDisconnect?.()
        await (o.disconnect ?? (() => Promise.resolve()))()
      },
    }) as unknown as M4LiveClient
  const capture = async (factory: M4ClientFactory): Promise<{ code: number | 'THREW'; out: string }> => {
    const lines: string[] = []
    const original = { log: console.log, error: console.error, warn: console.warn }
    console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '))
    console.error = console.log
    console.warn = console.log
    let result: number | 'THREW'
    try {
      result = await runLiveReadonly(fakeEnv, factory)
    } catch {
      result = 'THREW'
    } finally {
      console.log = original.log
      console.error = original.error
      console.warn = original.warn
    }
    return { code: result, out: lines.join('\n') }
  }
  const clean = (out: string) => !out.includes(SECRET_PW) && !out.includes(SECRET_HOST) && !out.includes('postgresql://') && !out.includes('supabase.co')

  let disconnects = 0
  const a = await capture(() => {
    throw leak
  })
  check('생성 오류 → 종료 코드 1 · 함수 밖으로 던지지 않음', a.code === 1)
  check('생성 오류 → 비밀번호·host·URL 원문 없음', clean(a.out))
  check('생성 오류 → 안전 분류만 (오류 종류 · M4 FAIL)', a.out.includes('오류 종류: UNKNOWN_ERROR') && a.out.includes('판정: M4 FAIL'))
  check('생성 실패 시 disconnect 를 부르지 않음 (client 없음)', !a.out.includes('연결 종료') && disconnects === 0)

  const b = await capture(() => fakeClient({ connect: reject, onDisconnect: () => void (disconnects += 1) }))
  check('연결 오류 → 종료 코드 1', b.code === 1)
  check('연결 오류 → 원문 없음 · 안전 분류만', clean(b.out) && b.out.includes('오류 종류: UNKNOWN_ERROR'))
  check('연결 오류 뒤에도 생성된 client 는 연결 종료를 시도', disconnects === 1)

  const c = await capture(() => fakeClient({ connect: reject, disconnect: reject }))
  check('연결 오류 + 종료 오류 → 종료 코드 1 · 던지지 않음', c.code === 1)
  check('종료 오류 → 원문 없음 · DISCONNECT_FAILED 로만', clean(c.out) && c.out.includes('연결 종료: DISCONNECT_FAILED'))
  check('🔴 종료 오류가 앞의 오류 보고를 덮어쓰지 않음', c.out.indexOf('오류 종류: UNKNOWN_ERROR') >= 0 && c.out.indexOf('오류 종류: UNKNOWN_ERROR') < c.out.indexOf('DISCONNECT_FAILED'))

  const d = await capture(() => fakeClient({ disconnect: reject }))
  check('트랜잭션 timeout + 종료 오류 → 종료 코드 1', d.code === 1)
  check('트랜잭션 오류는 STATEMENT_TIMEOUT 으로 남고 원문 없음', clean(d.out) && d.out.includes('오류 종류: STATEMENT_TIMEOUT') && d.out.includes('DISCONNECT_FAILED'))
  check('console 이 원래대로 복원됨', console.log === originalConsoleLog)

  heading('9. 성공 경로 — 가짜 트랜잭션으로 코어·출력 연결 (DB 없음)')
  const okEnv = { ...fakeEnv, SORAN_ADMIN_EMAILS: 'admin-fake@example.test', SIGNUP_ALLOWLIST: '99999999, tester-fake@example.test' }
  const txCalls: string[] = []
  const fakeTx = (readOnly: string) => ({
    $executeRaw: async (sql: TemplateStringsArray) => void txCalls.push(sql.join('')),
    $queryRaw: async (sql: TemplateStringsArray) => {
      txCalls.push(sql.join(''))
      return [{ transaction_read_only: readOnly }]
    },
    user: { count: async () => (txCalls.push('user.count'), 0), groupBy: async () => (txCalls.push('user.groupBy'), []), findMany: async () => (txCalls.push('user.findMany'), []), update: async () => 'x' },
    post: { findMany: async () => (txCalls.push('post.findMany'), []) },
    comment: { findMany: async () => (txCalls.push('comment.findMany'), []) },
  })
  const txClient = (readOnly: string): M4LiveClient =>
    ({
      $connect: async () => undefined,
      $disconnect: async () => undefined,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx(readOnly)),
    }) as unknown as M4LiveClient
  const okResult = await runM4Readonly(() => txClient('on'), pickM4Env(okEnv), new Date('2026-10-06T03:00:00Z'))
  check('빈 운영 데이터 → M4 PASS · 종료 코드 0', okResult.verdict === 'M4 PASS' && okResult.exitCode === 0 && okResult.analysisVerdict === 'M4 PASS')
  check('READ ONLY → timeout → SHOW 가 첫 세 호출', JSON.stringify(txCalls.slice(0, 3)) === JSON.stringify(['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '10000ms'", 'SHOW transaction_read_only']))
  check('불변식 16개 전부 PASS · 연결 종료 OK', okResult.invariants.length === 16 && okResult.invariants.every((i) => i.ok) && okResult.disconnect === 'OK')
  check('설정 키 두 개 존재 → config parity', okResult.config?.parity === true && okResult.config.admin.items === 1 && okResult.config.allow.items === 2)
  const okJson = JSON.stringify(okResult)
  check('🔴 결과 객체에 URL·환경변수 값 없음', clean(okJson) && !okJson.includes('admin-fake') && !okJson.includes('tester-fake') && !okJson.includes('99999999'))
  const okOut = await (async () => {
    const lines: string[] = []
    const original = console.log
    console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '))
    try {
      renderM4(okResult)
    } finally {
      console.log = original
    }
    return lines.join('\n')
  })()
  check('출력 순서 — 사전조건 → 집계 → 불변식 → 품질 → 성능 → 판정', ['■ 운영 연결 사전조건', '■ 고객 구성 (집계)', '■ 정합성 불변식', '■ 출생연도 품질', '■ 성능', '■ 판정'].every((h, i, arr) => i === 0 || okOut.indexOf(arr[i - 1]) < okOut.indexOf(h)))
  check('출력에 판정: M4 PASS · transaction_read_only: on', okOut.includes('판정: M4 PASS') && okOut.includes('transaction_read_only: on'))
  check('🔴 출력에 URL·환경변수 값 없음', clean(okOut) && !okOut.includes('admin-fake') && !okOut.includes('tester-fake') && !okOut.includes('99999999'))

  txCalls.length = 0
  const offResult = await runM4Readonly(() => txClient('off'), pickM4Env(okEnv), new Date('2026-10-06T03:00:00Z'))
  check('transaction_read_only=off → READ_ONLY_NOT_ON · M4 FAIL', offResult.error?.kind === 'READ_ONLY_NOT_ON' && offResult.verdict === 'M4 FAIL' && offResult.composition === null)
  check('🔴 read-only 가 아니면 모델 조회 0회', txCalls.every((c) => !/^(user|post|comment)\./.test(c)))
  check('pickM4Env 는 세 키만 — 다른 키는 버린다', JSON.stringify(Object.keys(pickM4Env({ ...okEnv, PATH: '/x', VERCEL_ENV: 'preview' })).sort()) === JSON.stringify(['DATABASE_URL', 'SIGNUP_ALLOWLIST', 'SORAN_ADMIN_EMAILS']))

  check('🔴 기본 모드는 실제 PrismaClient 를 만들지 않았다(DB 연결 0)', m4ClientRuntime.created === 0)

  console.log(`\n결과: ${pass} 통과 · ${fail} 실패 — DB 에 연결하지 않았다`)
  return fail === 0 ? 0 : 1
}

// 🔴 마지막 방어 — 어떤 예외도 원문으로 터미널에 떨어지지 않게 한다
let exitCode = 1
try {
  exitCode = await (process.argv.includes(LIVE_FLAG) ? runLiveReadonly(process.env) : selfCheck())
} catch {
  report('오류 종류', 'UNKNOWN_ERROR')
  report('판정', 'M4 FAIL')
  exitCode = 1
}
process.exit(exitCode)
