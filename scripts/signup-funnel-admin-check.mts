#!/usr/bin/env tsx
/**
 * 가입 전환 어드민 검사 — reader gate · 누계 조건 · 0 채움 · 비율 표시 · 회원 공통 하위 탭 · 레거시 링크 제거.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-6 · §8-7 · §8-10 · §10.
 *
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-funnel-admin-check.mts
 *
 * 🔴 DB 에 연결하지 않는다. reader 에는 호출을 세는(gate 가 닫히면 부르는 순간 실패로 남는) 대역을 넣는다.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SIGNUP_FUNNEL_RATIOS } from '../src/lib/signup-funnel'
import {
  CONVERSION_SCOPES,
  SIGNUP_FUNNEL_STEP_LABELS,
  buildConversionCounts,
  conversionGateNotice,
  formatRatio,
  ratioValue,
} from '../src/lib/signup-funnel-admin'
import { signupFunnelGate } from '../src/lib/signup-funnel-gate'
import { loadSignupConversion } from '../src/lib/queries/signup-funnel'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (s: string) => s.replace(/^\s*(\*|\/\/|\/\*\*|\{\/\*).*$/gm, '')
const BASE = 'ddf1006ba1efc8f8442029fbc4b94e886095de26' // 이 단계 직전
const gitShow = (p: string) => execFileSync('git', ['show', `${BASE}:${p}`], { encoding: 'utf8' })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

const P = {
  admin: 'src/lib/signup-funnel-admin.ts',
  reader: 'src/lib/queries/signup-funnel.ts',
  tabs: 'src/components/admin/MemberAdminTabs.tsx',
  conversion: 'src/app/admin/(ops)/members/conversion/page.tsx',
  members: 'src/app/admin/(ops)/members/page.tsx',
  composition: 'src/app/admin/(ops)/members/composition/page.tsx',
  detail: 'src/app/admin/(ops)/members/[id]/page.tsx',
  nav: 'src/components/admin/AdminOpsNav.tsx',
}

// ─────────── 1. reader ───────────
console.log('\n■ 1. reader — gate 닫히면 DB 0 · 열리면 groupBy 한 번')
type Rows = Array<{ step: string; contentType: string; _sum: { count: number | null } }>
function fakeDb(rows: Rows) {
  const calls: unknown[] = []
  const db = { signupFunnelDaily: { groupBy: async (args: unknown) => { calls.push(args); return rows } } }
  return { db: db as unknown as Parameters<typeof loadSignupConversion>[0], calls }
}
const NOW = new Date('2026-10-06T15:30:00.000Z') // KST 2026-10-07 00:30
for (const env of [{}, { VERCEL_ENV: 'preview', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }, { VERCEL_ENV: 'development', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' },
  { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: 'garbage' },
  { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-08' }]) {
  const f = fakeDb([])
  const r = await loadSignupConversion(f.db, env, NOW)
  check(`gate 닫힘 ${JSON.stringify(env)}: 집계 read 0 · counts 없음`, f.calls.length === 0 && r.counts === null && !r.gate.active)
}
{
  const f = fakeDb([
    { step: 'logged_out_view', contentType: 'community', _sum: { count: 30 } },
    { step: 'prompt_reach', contentType: 'community', _sum: { count: 12 } },
    { step: 'logged_out_view', contentType: 'magazine', _sum: { count: 10 } },
    { step: 'signup_complete', contentType: 'magazine', _sum: { count: 2 } },
    { step: 'prompt_impression', contentType: 'magazine', _sum: { count: null } },
  ])
  const r = await loadSignupConversion(f.db, { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }, NOW)
  check('gate 열림: groupBy 정확히 1회', f.calls.length === 1)
  check('누계 조건: 시작일 이상 · 오늘(KST) 이하 · content_end · 허용 다섯 단계 · 두 유형 · count 합만',
    JSON.stringify(f.calls[0]) === JSON.stringify({
      by: ['step', 'contentType'],
      where: {
        day: { gte: '2026-10-01', lte: '2026-10-07' },
        entryPoint: 'content_end',
        step: { in: ['logged_out_view', 'prompt_reach', 'prompt_impression', 'auth_start', 'signup_complete'] },
        contentType: { in: ['community', 'magazine'] },
      },
      _sum: { count: true },
    }), JSON.stringify(f.calls[0]))
  const c = r.counts
  check('누락 조합 0 채움 · null 합은 0', c !== null && c.auth_start.community === 0 && c.auth_start.magazine === 0 && c.prompt_impression.magazine === 0)
  check('전체 = 커뮤니티 + 매거진', c !== null && c.logged_out_view.all === 40 && c.prompt_reach.all === 12 && c.signup_complete.all === 2)
  check('반환은 gate 와 숫자뿐', JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['counts', 'gate'])
    && Object.values(c ?? {}).every((v) => Object.values(v).every((n) => typeof n === 'number')))
}
{
  const counts = buildConversionCounts([
    { step: 'prompt_reach', contentType: 'community', count: 3 }, { step: 'page_view', contentType: 'community', count: 99 },
    { step: 'prompt_reach', contentType: 'board', count: 99 }, { step: 'prompt_reach', contentType: 'community', count: 2 },
  ])
  check('허용값 밖 줄은 버리고 같은 칸은 더한다', counts.prompt_reach.community === 5 && counts.prompt_reach.all === 5 && counts.prompt_reach.magazine === 0)
}

// ─────────── 2. 비율 ───────────
console.log('\n■ 2. 비율 — 정의 재사용 · 분자/분모 · 산정 불가 · 자르지 않음')
check("표시 예: '12 / 30 · 40.0%'", formatRatio(12, 30) === '12 / 30 · 40.0%')
check("분모 0: '0 / 0 · 산정 불가'", formatRatio(0, 0) === '0 / 0 · 산정 불가' && formatRatio(5, 0) === '5 / 0 · 산정 불가')
check('100% 로 자르지 않는다', formatRatio(45, 30) === '45 / 30 · 150.0%')
{
  const counts = buildConversionCounts([
    { step: 'logged_out_view', contentType: 'community', count: 30 }, { step: 'prompt_reach', contentType: 'community', count: 12 },
    { step: 'logged_out_view', contentType: 'magazine', count: 10 }, { step: 'prompt_reach', contentType: 'magazine', count: 4 },
  ])
  const endReach = SIGNUP_FUNNEL_RATIOS[0]
  check('비율은 정의의 분자·분모로 계산 — 전체 16/40', ratioValue(endReach, counts, 'all') === '16 / 40 · 40.0%'
    && ratioValue(endReach, counts, 'community') === '12 / 30 · 40.0%' && ratioValue(endReach, counts, 'magazine') === '4 / 10 · 40.0%')
}
check('비율은 정의된 세 개 · signup_complete 비율 0', SIGNUP_FUNNEL_RATIOS.length === 3 && SIGNUP_FUNNEL_RATIOS.every((r) => !JSON.stringify(r).includes('signup_complete')))
const page = read(P.conversion)
const pageCode = code(page)
check('화면은 SIGNUP_FUNNEL_RATIOS 를 그대로 돌린다 · 화면 안 비율 계산·정의 0',
  /\{SIGNUP_FUNNEL_RATIOS\.map\(\(ratio\) =>/.test(page) && /ratioValue\(ratio, counts, scope\)/.test(page)
  && !/numerator:|denominator:|\* 100|toFixed/.test(pageCode))
check('가입 완료는 건수로만(signup_complete 비율 문구 0)', !/signup_complete/.test(pageCode) && !/가입 완료율|전환율/.test(pageCode))

// ─────────── 3. 화면 ───────────
console.log('\n■ 3. 가입 전환 화면 — 권한 먼저 · 상태 · 표 · 한계')
check('requireAdmin 확인 뒤에만 reader', page.indexOf('if (!ok) return null') > 0 && page.indexOf('if (!ok) return null') < page.indexOf('loadSignupConversion(')
  && page.indexOf('await requireAdmin()') < page.indexOf('if (!ok) return null'))
check('force-dynamic · env 는 gate 두 값만', page.includes("export const dynamic = 'force-dynamic'")
  && (pageCode.match(/process\.env\.[A-Z_]+/g) ?? []).sort().join() === 'process.env.SIGNUP_FUNNEL_COLLECTION_START,process.env.VERCEL_ENV')
check('수집 상태 · 시작일 · 종료일 · 측정 시각', /notice\.status/.test(page) && /gate\.active \? gate\.startDay : '—'/.test(page)
  && /gate\.active \? gate\.today : '—'/.test(page) && /측정 시각 \$\{formatKst\(now\)\}/.test(page))
check('gate 닫힘이면 표 없음(시작 전을 0 으로 보이지 않음)', /\{counts \? \(/.test(page))
check('다섯 단계 이름', JSON.stringify(Object.values(SIGNUP_FUNNEL_STEP_LABELS)) === JSON.stringify(['콘텐츠 열람', '가입 제안 기준 도달', '가입 제안 노출', '카카오 시작', '확인된 가입 완료']))
check('범위: 전체 · 커뮤니티 · 매거진', JSON.stringify(CONVERSION_SCOPES) === JSON.stringify(['all', 'community', 'magazine']))
for (const [reason, env, status] of [['not_production', {}, '비활성'], ['start_invalid', { VERCEL_ENV: 'production' }, '수집 전'],
  ['before_start', { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-08' }, '수집 전']] as const) {
  const n = conversionGateNotice(signupFunnelGate(env, NOW))
  check(`상태 ${reason}: ${status}${status === '수집 전' ? ' · UNKNOWN 안내' : ''}`, n.status === status && (status !== '수집 전' || n.description.includes('UNKNOWN')))
}
for (const phrase of ['고유 사람 수가 아니라', '다시 로그인한 경우', '로그아웃 상태의 운영자', '날짜 경계', '감사·과금급 증거가 아닙니다', '서버가 직접 증명한 값은 아닙니다', 'UNKNOWN'])
  check(`해석 한계: ${phrase}`, page.includes(phrase))
check('고객 구성 탭 안내(숫자 중복 0)', page.includes('「고객 구성」 탭이 셉니다'))
check('개인정보·회원/콘텐츠 목록·차트·기간 선택 0',
  !/prisma\.(user|post|comment|account)|nickname|email|phone|birth|<svg|chart|<select|<input|searchParams/i.test(pageCode))
check('client 조각 0', !/^'use client'/m.test(page) && !/^'use client'/m.test(read(P.tabs)))
const reader = read(P.reader)
check('reader: server-only · signupFunnelDaily groupBy 하나 · raw SQL 0 · 회원 값 0', /^import 'server-only'/m.test(reader)
  && (code(reader).match(/db\.signupFunnelDaily\.groupBy\(/g) ?? []).length === 1 && !/\$queryRaw|\$executeRaw|findMany|user|email/.test(code(reader)))
check('reader: writer 와 같은 gate 를 먼저', /const gate = signupFunnelGate\(env, now\)\s*if \(!gate\.active\) return \{ gate, counts: null \}/.test(reader))

// ─────────── 4. 공통 하위 탭 ───────────
console.log('\n■ 4. 회원 공통 하위 탭 · 레거시 링크 제거')
const tabs = read(P.tabs)
check('탭 셋 · 경로 · 이름', /\{ key: 'members', href: '\/admin\/members', label: '회원 관리' \}/.test(tabs)
  && /\{ key: 'composition', href: '\/admin\/members\/composition', label: '고객 구성' \}/.test(tabs)
  && /\{ key: 'conversion', href: '\/admin\/members\/conversion', label: '가입 전환' \}/.test(tabs))
check("현재 탭 aria-current='page' · 터치 52px", /aria-current=\{active \? 'page' : undefined\}/.test(tabs) && /min-h-\[52px\]/.test(tabs))
for (const [p, current] of [[P.members, 'members'], [P.composition, 'composition'], [P.conversion, 'conversion']] as const) {
  const s = read(p)
  check(`${current}: 같은 탭 컴포넌트 한 번`, (s.match(/<MemberAdminTabs current="([a-z]+)" \/>/g) ?? []).join() === `<MemberAdminTabs current="${current}" />`
    && s.includes("import MemberAdminTabs from '@/components/admin/MemberAdminTabs'"))
}
check('회원 상세에는 탭 없음', !read(P.detail).includes('MemberAdminTabs'))
const tabUsers = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[]).map((f) => f.split('\\').join('/'))
  .filter((f) => /\.(ts|tsx)$/.test(f) && read(join('src', f)).includes('<MemberAdminTabs')).sort()
check('탭을 그리는 곳은 세 화면뿐', JSON.stringify(tabUsers) === JSON.stringify([
  'app/admin/(ops)/members/composition/page.tsx', 'app/admin/(ops)/members/conversion/page.tsx', 'app/admin/(ops)/members/page.tsx',
]), tabUsers.join(', '))
const members = read(P.members)
const composition = read(P.composition)
check('회원 목록: 「고객 구성 보기 →」 링크 0 · 제목 「회원 관리」 · 미사용 Link import 0',
  !members.includes('고객 구성 보기') && /title="회원 관리"/.test(members) && !members.includes("import Link from 'next/link'"))
check('고객 구성: 「← 회원」 back 링크 0', !/backHref|backLabel|← 회원/.test(composition))
check('고객 구성: 낡은 정본 절 번호(v2.1 §7) 0', !composition.includes('v2.1 §7'))
check('상위 운영 메뉴 그대로(새 메뉴 0)', read(P.nav) === gitShow(P.nav))
check('공통 UI 그대로', read('src/components/admin/AdminUi.tsx') === gitShow('src/components/admin/AdminUi.tsx'))

// ─────────── 5. 경계 ───────────
console.log('\n■ 5. 경계 — 공개 화면·인증·온보딩 변경 0 · import 고정')
const publicUnchanged = ['src/app/community/[boardSlug]/[postId]/page.tsx', 'src/app/magazine/[slug]/page.tsx', 'src/app/login/page.tsx',
  'src/lib/actions/onboarding.ts', 'src/components/features/onboarding/onboarding-form.tsx', 'src/components/features/CommentSection.tsx',
  'src/components/features/KakaoSignInButton.tsx', 'src/components/features/signup-funnel/SignupFunnelTracker.tsx', 'prisma/schema.prisma',
].filter((p) => read(p) !== gitShow(p))
check('공개 화면·팝업·인증·온보딩·schema 변경 0', publicUnchanged.length === 0, publicUnchanged.join(', '))
const imports = (p: string) => [...read(p).matchAll(/^import .*$/gm)].map((m) => m[0])
check('reader import 고정(D100 0)', JSON.stringify(imports(P.reader)) === JSON.stringify([
  "import 'server-only'",
  "import type { PrismaClient } from '@prisma/client'",
  "import { SIGNUP_FUNNEL_CONTENT_TYPES, SIGNUP_FUNNEL_STEPS } from '@/lib/signup-funnel'",
  "import { buildConversionCounts, type ConversionCounts } from '@/lib/signup-funnel-admin'",
  "import { signupFunnelGate, type SignupFunnelEnv, type SignupFunnelGate } from '@/lib/signup-funnel-gate'",
]))
check('계산 모듈 import 고정(D100 0)', JSON.stringify(imports(P.admin)) === JSON.stringify(['import {', "import type { SignupFunnelGate } from '@/lib/signup-funnel-gate'"]))
check('탭 import 는 Link 하나', JSON.stringify(imports(P.tabs)) === JSON.stringify(["import Link from 'next/link'"]))

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
