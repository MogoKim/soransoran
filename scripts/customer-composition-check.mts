#!/usr/bin/env tsx
/**
 * 고객 구성 — 순수 판정 · 대상 조건 모양 · 화면 계약 가드. 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §11.
 *
 * 🔴 DB 가 필요한 계약(Persona·운영 계정이 실제로 빠지는가 · email=null 회원이 남는가 · 상태별 글·댓글 ·
 *    한 회원 여러 글 = 1명 · 7일 창의 실제 경계)은 이 스크립트가 증명하지 못한다. 여기서는 where 의
 *    **모양** 만 본다 — 실제 행에 대한 판정은 격리 Postgres 에서 loadCustomerComposition 을 돌려 확인한다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BoardType } from '@prisma/client'

import { REAL_MEMBER_WHERE } from '../src/lib/admin-format'
import { EXCLUDE_GREETING, GREETING_CATEGORY } from '../src/lib/greeting-policy'
import {
  AGE_BAND_ORDER,
  FIFTIES_BANDS,
  SEVEN_DAYS_MS,
  ageBandLabel,
  ageBandOf,
  ageBandOfAge,
  analysisAge,
  bucketByAge,
  formatShare,
  genderClass,
  isWithinSevenDays,
  kstBaseYear,
  operatorExclusions,
  parseBirthyear,
  parseEnvList,
  sevenDayStatus,
  sevenDayWindow,
  sumBands,
  totalOf,
} from '../src/lib/customer-composition'
import {
  COMPOSITION_BOARDS,
  GENERAL_POST_WHERE,
  GREETING_POST_WHERE,
  MEMBER_COMMENT_WHERE,
  activeFemaleCustomerWhere,
  femaleCustomerWhere,
  onboardedBaseWhere,
} from '../src/lib/queries/customer-composition'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${!ok && detail ? ` — ${detail}` : ''}`)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const root = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const BASE_YEAR = 2026

console.log('\n■ 1. 분석연령 경계 — 기준연도 − 출생연도')
const bands: [number, string][] = [
  [44, 'under45'], [45, '45-49'], [49, '45-49'], [50, '50-54'], [54, '50-54'], [55, '55-59'],
  [59, '55-59'], [60, '60-64'], [64, '60-64'], [65, '65-69'], [69, '65-69'], [70, '70plus'],
]
for (const [age, want] of bands) {
  const birthyear = String(BASE_YEAR - age)
  check(`분석연령 ${age} (출생 ${birthyear}) → ${want}`, ageBandOf(birthyear, BASE_YEAR) === want)
}
check('분석연령 = 기준연도 − 출생연도', analysisAge('1973', BASE_YEAR) === 53)
check('기준연도 출생 = 0세 → 45세 미만', ageBandOf(String(BASE_YEAR), BASE_YEAR) === 'under45')
check('음수·소수 나이는 미확인', ageBandOfAge(-1) === 'unknown' && ageBandOfAge(50.5) === 'unknown')

console.log('\n■ 2. 출생연도 미확인')
const invalid: [string | null | undefined, string][] = [
  [null, 'null'], [undefined, 'undefined'], ['', '빈 문자열'], ['0000', '0000'], ['abcd', '숫자 아님'],
  ['19750', '다섯 자리'], ['975', '세 자리'], [String(BASE_YEAR + 1), '미래 연도'], [' 1975', '앞 공백'],
  ['1975 ', '뒤 공백'], ['1e03', '지수 표기'], ['0999', '앞자리 0'], ['-197', '음수'],
]
for (const [raw, label] of invalid) {
  check(`${label} → 연령 미확인`, parseBirthyear(raw, BASE_YEAR) === null && ageBandOf(raw, BASE_YEAR) === 'unknown')
}
check('정상 1975 는 그대로 읽는다', parseBirthyear('1975', BASE_YEAR) === 1975)

console.log('\n■ 3. KST 기준연도 — UTC 연도를 쓰지 않는다')
check('2026-12-31T15:00Z(KST 1월 1일 0시) → 2027', kstBaseYear(new Date('2026-12-31T15:00:00Z')) === 2027)
check('2026-12-31T14:59Z(KST 12월 31일) → 2026', kstBaseYear(new Date('2026-12-31T14:59:59Z')) === 2026)

console.log('\n■ 4. 성별 — female·male 만 확인된 값')
check('female → 여성', genderClass('female') === 'female')
check('male → 남성', genderClass('male') === 'male')
check('null → 미확인', genderClass(null) === 'unknown')
check('대문자·다른 값 → 미확인 (여성으로 추정하지 않음)', genderClass('Female') === 'unknown' && genderClass('F') === 'unknown')

console.log('\n■ 5. 구간 집계 — groupBy 결과를 합친다')
const counts = bucketByAge(
  [
    { birthyear: '1973', count: 3 }, { birthyear: '1968', count: 2 }, { birthyear: '1980', count: 1 },
    { birthyear: null, count: 4 }, { birthyear: '0000', count: 1 },
  ],
  BASE_YEAR,
)
check('50~54 = 3', counts['50-54'] === 3)
check('55~59 = 2', counts['55-59'] === 2)
check('45~49 = 1', counts['45-49'] === 1)
check('미확인 = null 4 + 0000 1', counts.unknown === 5)
check('총계는 입력 인원 합과 같다', totalOf(counts) === 11)
check('50대 합계 = 50~54 + 55~59', sumBands(counts, FIFTIES_BANDS) === 5)
check('표 순서는 7구간 + 미확인', AGE_BAND_ORDER.length === 8 && AGE_BAND_ORDER[7] === 'unknown')
check('라벨', ageBandLabel('70plus') === '70세 이상' && ageBandLabel('unknown') === '연령 미확인')

console.log('\n■ 6. 7일 창 — [완료, 완료+7일)')
const T = new Date('2026-09-01T03:00:00Z')
const at = (ms: number) => new Date(T.getTime() + ms)
check('Agreement 없음 → 산정 불가', sevenDayStatus(null, at(30 * SEVEN_DAYS_MS)) === 'no_basis')
check('7일 직전 → 관측 중', sevenDayStatus(T, at(SEVEN_DAYS_MS - 1)) === 'observing')
check('정확히 7일 → 관측 완료', sevenDayStatus(T, at(SEVEN_DAYS_MS)) === 'complete')
check('7일 이후 → 관측 완료', sevenDayStatus(T, at(SEVEN_DAYS_MS + 1)) === 'complete')
check('완료 시각 활동 → 창 안', isWithinSevenDays(T, T))
check('7일 직전 활동 → 창 안', isWithinSevenDays(T, at(SEVEN_DAYS_MS - 1)))
check('정확히 7일 활동 → 창 밖', !isWithinSevenDays(T, at(SEVEN_DAYS_MS)))
check('완료 전 활동 → 창 밖', !isWithinSevenDays(T, at(-1)))
const w = sevenDayWindow(T)
check('DB 창 조건 = gte 완료 · lt 완료+7일', w.gte.getTime() === T.getTime() && w.lt.getTime() === T.getTime() + SEVEN_DAYS_MS)

console.log('\n■ 7. 비율 — 분자/분모를 함께')
check('3/10', formatShare(3, 10) === '3 / 10 (30%)')
check('분모 0 은 퍼센트를 만들지 않는다', formatShare(0, 0) === '0 / 0')
check('소수 한 자리', formatShare(1, 3) === '1 / 3 (33.3%)')

console.log('\n■ 8. 운영·시험 계정 목록')
check('trim·소문자·빈 항목 제거·중복 제거', same(parseEnvList(' A@x.com, ,a@x.com,B@Y.com '), ['a@x.com', 'b@y.com']))
check('비어 있으면 빈 목록', same(parseEnvList(undefined), []) && same(parseEnvList(''), []))
const ex = operatorExclusions({ SORAN_ADMIN_EMAILS: 'Admin@Soran.com', SIGNUP_ALLOWLIST: '12345, Tester@x.com' })
check('이메일 제외 = 관리자 + allowlist 전부', same(ex.emails, ['admin@soran.com', '12345', 'tester@x.com']))
check('회원번호 제외 = allowlist 전부', same(ex.providerAccountIds, ['12345', 'tester@x.com']))

console.log('\n■ 9. 대상 조건 모양')
const env = { SORAN_ADMIN_EMAILS: 'admin@soran.com', SIGNUP_ALLOWLIST: '12345' }
const base = onboardedBaseWhere(env) as Record<string, unknown>
check('REAL_MEMBER_WHERE 를 그대로 품는다', same(base.accounts, REAL_MEMBER_WHERE.accounts) && same(base.persona, REAL_MEMBER_WHERE.persona) && same(base.operatorWriter, REAL_MEMBER_WHERE.operatorWriter))
check('isOnboarded = true', base.isOnboarded === true)
check('isAdmin = false', base.isAdmin === false)
const and = base.AND as Record<string, unknown>[]
const emailClause = JSON.stringify(and[0])
check('🔴 이메일 제외는 email=null 을 명시적으로 살린다', emailClause.includes('{"email":null}'))
check('이메일 비교는 대소문자 무시', emailClause.includes('"mode":"insensitive"'))
check('allowlist 회원번호는 kakao Account none 으로 뺀다', JSON.stringify(and[1]) === JSON.stringify({ accounts: { none: { provider: 'kakao', providerAccountId: { in: ['12345'] } } } }))
check('목록이 비면 AND 를 붙이지 않는다', !('AND' in (onboardedBaseWhere({}) as object)))
check('REAL_MEMBER_WHERE 원본은 바뀌지 않았다', same(Object.keys(REAL_MEMBER_WHERE), ['accounts', 'persona', 'operatorWriter']))
const female = femaleCustomerWhere(env) as Record<string, unknown>
check('여성 고객 = 대상 + gender female · 차단 조건 없음', female.gender === 'female' && !('isBlocked' in female))
check('참여 대상 = 여성 고객 + 차단 아님', (activeFemaleCustomerWhere(env) as Record<string, unknown>).isBlocked === false)

console.log('\n■ 10. 활동 조건 모양')
const gp = GENERAL_POST_WHERE as Record<string, unknown>
check('일반 글: PUBLISHED · USER · Persona/운영 아님', gp.status === 'PUBLISHED' && gp.source === 'USER' && gp.personaId === null && gp.operatorWriterId === null)
check('일반 글: 가입인사 제외 조각(null 보존형)을 쓴다', same(gp.AND, [EXCLUDE_GREETING]))
const gr = GREETING_POST_WHERE as Record<string, unknown>
check('가입인사: category = 가입인사 · PUBLISHED', gr.category === GREETING_CATEGORY && gr.status === 'PUBLISHED')
const mc = MEMBER_COMMENT_WHERE as Record<string, unknown>
check('댓글: MEMBER · 삭제 아님 · 공개 글', mc.commentOrigin === 'MEMBER' && mc.isDeleted === false && same(mc.post, { status: 'PUBLISHED' }))
check('게시판: Prisma BoardType enum 값 전체와 일치', same(COMPOSITION_BOARDS, Object.values(BoardType)))
// 🔴 생성된 client 만 보면 같은 원천을 두 번 읽는 셈이다. schema.prisma 선언과도 순서까지 대조한다
const declared = (read('prisma/schema.prisma').match(/enum BoardType \{([^}]*)\}/)?.[1] ?? '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)
check('게시판: schema.prisma BoardType 선언 순서와 일치', declared.length > 0 && same(COMPOSITION_BOARDS, declared), JSON.stringify(declared))
check('게시판: 손으로 적은 게시판 목록이 없다', !/COMPOSITION_BOARDS[^=\n]*=\s*\[/.test(read('src/lib/queries/customer-composition.ts')))

console.log('\n■ 11. 소스 가드 — 화면·집계 계약')
const page = read('src/app/admin/(ops)/members/composition/page.tsx')
const query = read('src/lib/queries/customer-composition.ts')
const pure = read('src/lib/customer-composition.ts')
const nav = read('src/components/admin/AdminOpsNav.tsx')
check('페이지가 requireAdmin 을 직접 확인한다', /await requireAdmin\(\)/.test(page) && /if \(!ok\) return null/.test(page))
check("페이지는 force-dynamic", page.includes("export const dynamic = 'force-dynamic'"))
check('페이지가 prisma 를 직접 질의하지 않는다(조건을 흩지 않음)', !/prisma\.(user|post|comment|agreement)\./.test(page))
check('🔴 집계가 개인 필드를 select 하지 않는다', !/(name|nickname|email|phoneNumber|image)\s*:\s*true/.test(query))
check('🔴 가입 완료 근거로 금지된 값을 쓰지 않는다', !/profileConsentAt|marketingConsentAt|firstGreetingAt|sign_up/.test(query + pure))
check('🔴 User.createdAt 을 완료 시각으로 쓰지 않는다', !/createdAt:\s*true[\s\S]{0,40}user|user\.createdAt/.test(query))
check('🔴 날짜 cutoff 하드코딩 없음', !/20\d\d-\d\d-\d\d/.test(query + pure))
check('🔴 재방문율·리텐션이라 부르지 않는다', !/재방문율|리텐션|retention/i.test(page))
check('🔴 만 나이라고 부르지 않는다(부정문만 허용)', (page.match(/만 나이/g) ?? []).length === (page.match(/만 나이가 아닙니다/g) ?? []).length)
check('🔴 색 리터럴 없음', !/#[0-9a-fA-F]{3,8}\b/.test(page))
check('운영 메뉴는 7개 그대로', (nav.match(/\{ href: '\/admin/g) ?? []).length === 7 && !nav.includes('composition'))
check('「회원」 메뉴가 하위 경로에서 켜진다', nav.includes('pathname.startsWith(`${href}/`)'))
check('회원 목록·고객 구성이 공통 하위 탭으로 이어진다', read('src/app/admin/(ops)/members/page.tsx').includes('<MemberAdminTabs current="members" />')
  && page.includes('<MemberAdminTabs current="composition" />')
  && read('src/components/admin/MemberAdminTabs.tsx').includes("href: '/admin/members/composition'"))
check('REAL_MEMBER_WHERE 파일은 고객 구성 조건을 모른다', !read('src/lib/admin-format.ts').includes('isOnboarded'))

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
