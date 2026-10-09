#!/usr/bin/env tsx
/**
 * 회원가입 전환 ⑤ signup_complete 검사 — 귀속 표식 · 최초 온보딩 전환의 원자성 · ⑤ 기록·제외·실패 격리.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-4 · §8-5 · §8-7 · §8-11 · §8-13.
 *
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-complete-check.mts                   대역 · 소스 (DB 0)
 *   SORAN_ISOLATED_DB=yes-throwaway DATABASE_URL=postgresql://…@127.0.0.1:…/soran_… \
 *   tsx --tsconfig tsconfig.ops.json scripts/signup-complete-check.mts --isolated-db     + 격리 Postgres 동시성
 *
 * 🔴 --isolated-db 는 로컬 주소(127.0.0.1 · localhost · [::1])와 soran_ 으로 시작하는 DB 이름, 그리고
 *    SORAN_ISOLATED_DB=yes-throwaway 가 모두 맞을 때만 연결한다. 아니면 연결하지 않고 실패로 끝난다.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SignupFunnelKey } from '../src/lib/signup-funnel'
import { commitFirstOnboarding, recordSignupComplete, type SignupCompleteDeps } from '../src/lib/signup-completion'
import {
  AUTH_MARKER_KEY,
  AUTH_MARKER_TTL_MS,
  clearAuthMarker,
  parseAuthMarker,
  readAuthMarker,
  type PromptStorage,
} from '../src/lib/signup-prompt-storage'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (s: string) => s.replace(/^\s*(\*|\/\/|\/\*\*|\{\/\*).*$/gm, '')
const BASE = '94e29c70cd40168d8d41a7a5c27a76281acc9e92' // 이 단계 직전
const gitShow = (p: string) => execFileSync('git', ['show', `${BASE}:${p}`], { encoding: 'utf8' })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

const NOW = 1_790_000_000_000
const marker = (contentType: string, expiresAt: number) => ({ contentType, entryPoint: 'content_end', expiresAt })

// ─────────── 1. 귀속 표식 검증 ───────────
console.log('\n■ 1. 귀속 표식 — 엄격 검증')
check('정상 community', JSON.stringify(parseAuthMarker(marker('community', NOW + 1000), NOW)) === JSON.stringify(marker('community', NOW + 1000)))
check('정상 magazine', parseAuthMarker(marker('magazine', NOW + AUTH_MARKER_TTL_MS), NOW)?.contentType === 'magazine')
check('만료 경계: expiresAt = now 거부 · now+1 통과', parseAuthMarker(marker('community', NOW), NOW) === null && parseAuthMarker(marker('community', NOW + 1), NOW) !== null)
check('이미 만료 거부', parseAuthMarker(marker('community', NOW - 1), NOW) === null)
check('30분 정확히 통과 · 30분 초과 미래 거부', parseAuthMarker(marker('community', NOW + AUTH_MARKER_TTL_MS), NOW) !== null
  && parseAuthMarker(marker('community', NOW + AUTH_MARKER_TTL_MS + 1), NOW) === null)
for (const [name, value] of [
  ['소수 만료', marker('community', NOW + 1.5)], ['NaN', marker('community', Number.NaN)], ['Infinity', marker('community', Number.POSITIVE_INFINITY)],
  ['문자열 만료', { contentType: 'community', entryPoint: 'content_end', expiresAt: String(NOW + 1000) }],
  ['허용 밖 contentType', marker('board', NOW + 1000)], ['허용 밖 entryPoint', { contentType: 'community', entryPoint: 'header', expiresAt: NOW + 1000 }],
  ['추가 키', { ...marker('community', NOW + 1000), postId: 'p1' }], ['누락 키', { contentType: 'community', expiresAt: NOW + 1000 }],
  ['symbol 키', { ...marker('community', NOW + 1000), [Symbol('x')]: 1 }], ['배열', ['community', 'content_end', NOW + 1000]],
  ['null', null], ['문자열', JSON.stringify(marker('community', NOW + 1000))], ['숫자', 42],
] as const) check(`거부: ${name}`, parseAuthMarker(value, NOW) === null)
{
  const hidden = marker('community', NOW + 1000)
  Object.defineProperty(hidden, 'slug', { value: 's', enumerable: false })
  check('거부: 숨은 키', parseAuthMarker(hidden, NOW) === null)
  let getterCalls = 0
  const withGetter = { contentType: 'community', entryPoint: 'content_end' }
  Object.defineProperty(withGetter, 'expiresAt', { get: () => { getterCalls++; return NOW + 1000 }, enumerable: true })
  check('거부: getter · 호출 0', parseAuthMarker(withGetter, NOW) === null && getterCalls === 0)
  class Box { contentType = 'community'; entryPoint = 'content_end'; expiresAt = NOW + 1000 }
  check('거부: 클래스 객체', parseAuthMarker(new Box(), NOW) === null)
  const nullProto = Object.assign(Object.create(null) as Record<string, unknown>, marker('magazine', NOW + 1000))
  check('prototype 없는 일반 객체는 통과', parseAuthMarker(nullProto, NOW) !== null)
  const input = { ...marker('community', NOW + 1000), extra: 1 }
  const snap = JSON.stringify(input)
  parseAuthMarker(input, NOW)
  check('입력 불변', JSON.stringify(input) === snap)
}

console.log('\n■ 2. 표식 읽기·제거 — 예외가 밖으로 나오지 않는다')
function storage(seed: string | null, mode: 'ok' | 'throw' = 'ok') {
  const removed: string[] = []
  const s: PromptStorage & { removeItem(k: string): void } = {
    getItem: (k) => { if (mode === 'throw') throw new Error('blocked'); return k === AUTH_MARKER_KEY ? seed : null },
    setItem: () => {},
    removeItem: (k) => { if (mode === 'throw') throw new Error('blocked'); removed.push(k) },
  }
  return { s, removed }
}
const noThrow = (fn: () => unknown) => { try { fn(); return true } catch { return false } }
check('읽기: 정상 값', readAuthMarker(storage(JSON.stringify(marker('community', NOW + 1000))).s, NOW)?.contentType === 'community')
check('읽기: 값 없음 · storage 없음 null', readAuthMarker(storage(null).s, NOW) === null && readAuthMarker(null, NOW) === null)
check('읽기: 깨진 JSON · 접근 예외 · 만료 값 → null · 예외 0', noThrow(() => readAuthMarker(storage('{oops').s, NOW))
  && readAuthMarker(storage('{oops').s, NOW) === null && readAuthMarker(storage('x', 'throw').s, NOW) === null
  && readAuthMarker(storage(JSON.stringify(marker('community', NOW - 1))).s, NOW) === null)
{
  const ok = storage('x')
  clearAuthMarker(ok.s)
  check('제거: 표식 키 하나만', JSON.stringify(ok.removed) === JSON.stringify([AUTH_MARKER_KEY]))
  check('제거: 예외 · storage 없음에도 예외 0', noThrow(() => clearAuthMarker(storage('x', 'throw').s)) && noThrow(() => clearAuthMarker(null)))
}

// ─────────── 3. 온보딩 폼 ───────────
console.log('\n■ 3. 온보딩 폼 — 제출 직전 읽기 · 성공 뒤에만 제거')
const form = read('src/components/features/onboarding/onboarding-form.tsx')
const formBase = gitShow('src/components/features/onboarding/onboarding-form.tsx')
check('제출 직전 표식을 읽어 선택 인자로 넘긴다',
  /const attribution = readAuthMarker\(signupMarkerStorage\(\), Date\.now\(\)\) \?\? undefined\n\n\s*startTransition/.test(form)
  && /await completeOnboarding\(nickname, agreed, attribution\)/.test(form))
{
  const iError = form.indexOf('if (result.error) {')
  const iSucceeded = form.indexOf('succeeded = true')
  const iClear = form.indexOf('clearAuthMarker(signupMarkerStorage())')
  const iTrack = form.indexOf("trackEvent('sign_up', { method: 'kakao' })")
  const iReplace = form.indexOf('router.replace(destination)')
  check('제거는 성공 뒤(오류 return 뒤 · succeeded 뒤) · GA4 · 이동 앞', iError > 0 && iError < iSucceeded && iSucceeded < iClear && iClear < iTrack && iTrack < iReplace)
  check('제거는 한 곳 · finally·catch 에 없음', (form.match(/clearAuthMarker\(/g) ?? []).length === 1 && !/finally \{[^}]*clearAuthMarker/.test(form))
}
check('GA4 sign_up 속성 · 화면 문구 그대로', (formBase.match(/trackEvent\('sign_up', \{ method: 'kakao' \}\)/g) ?? []).length === 1
  && (form.match(/trackEvent\('sign_up', \{ method: 'kakao' \}\)/g) ?? []).length === 1
  && JSON.stringify(formBase.match(/>[^<>{}\n]*[가-힣][^<>{}\n]*</g)) === JSON.stringify(form.match(/>[^<>{}\n]*[가-힣][^<>{}\n]*</g)))
check('폼 저장소 접근 실패는 null', /function signupMarkerStorage\(\): Storage \| null \{\s*try \{\s*return window\.localStorage\s*\} catch \{\s*return null/.test(form))

// ─────────── 4. 최초 전환 — 대역 ───────────
console.log('\n■ 4. 최초 온보딩 전환 — 조건부 updateMany 하나가 근거')
type Op = { op: string; args: unknown }
function fakeDb(count: number, failAgreementAt = -1) {
  const ops: Op[] = []
  let agreementCalls = 0
  const tx = {
    user: { updateMany: async (args: unknown) => { ops.push({ op: 'user.updateMany', args }); return { count } } },
    agreement: {
      upsert: async (args: unknown) => {
        ops.push({ op: 'agreement.upsert', args })
        if (agreementCalls++ === failAgreementAt) throw new Error('agreement write failed')
        return {}
      },
    },
  }
  let txCalls = 0
  const db = { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => { txCalls++; return fn(tx) } }
  return { db: db as unknown as Parameters<typeof commitFirstOnboarding>[0], ops, txCalls: () => txCalls }
}
const AGREEMENTS = [{ type: 'TERMS_OF_SERVICE', version: 'v1' }, { type: 'PRIVACY_POLICY', version: 'v1' }]
const agreedAt = new Date(NOW)
{
  const f = fakeDb(1)
  const out = await commitFirstOnboarding(f.db, { userId: 'u1', nickname: '하늘', agreedAt, marketing: false, agreements: AGREEMENTS })
  const first = f.ops[0]?.args as { where: unknown; data: Record<string, unknown> }
  check('count 1 → 최초 전환 성공', out === 'onboarded' && f.txCalls() === 1)
  check('updateMany 조건은 정확히 id + isOnboarded:false', JSON.stringify(first?.where) === JSON.stringify({ id: 'u1', isOnboarded: false }))
  check('전환 데이터: 닉네임 · isOnboarded true · 마케팅 미동의면 시각 없음', JSON.stringify(first?.data) === JSON.stringify({ nickname: '하늘', isOnboarded: true }))
  check('약관 행은 같은 transaction 안에서 전환 뒤에', f.ops.map((o) => o.op).join() === 'user.updateMany,agreement.upsert,agreement.upsert')
}
{
  const f = fakeDb(1)
  await commitFirstOnboarding(f.db, { userId: 'u1', nickname: '하늘', agreedAt, marketing: true, agreements: [...AGREEMENTS, { type: 'MARKETING', version: 'v1' }] })
  const data = (f.ops[0]?.args as { data: Record<string, unknown> }).data
  check('마케팅 동의면 시각을 찍고 약관 행 셋', data.marketingConsentAt === agreedAt && f.ops.filter((o) => o.op === 'agreement.upsert').length === 3)
}
{
  const f = fakeDb(0)
  const out = await commitFirstOnboarding(f.db, { userId: 'u1', nickname: '하늘', agreedAt, marketing: true, agreements: AGREEMENTS })
  check('count 0(이미 마침 · 동시 패자) → already · 약관 write 0', out === 'already' && f.ops.filter((o) => o.op === 'agreement.upsert').length === 0)
}
{
  const f = fakeDb(1, 1)
  let threw = false
  try { await commitFirstOnboarding(f.db, { userId: 'u1', nickname: '하늘', agreedAt, marketing: false, agreements: AGREEMENTS }) } catch { threw = true }
  check('약관 쓰기 실패는 transaction 밖으로 올라간다(부분 성공 반환 0 — 실제 롤백은 격리 DB 로 확인)', threw)
}

// ─────────── 5. ⑤ 기록 ───────────
console.log('\n■ 5. ⑤ signup_complete — 조건 · 제외 · 실패 격리')
const OPEN = { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }
const COMPLETED = new Date('2026-10-06T15:00:00.000Z') // KST 2026-10-07 00:00
function deps(o: { env?: SignupCompleteDeps['env']; excluded?: boolean | 'throw'; save?: 'ok' | 'reject' } = {}) {
  const calls = { excluded: 0, saved: [] as Array<{ key: SignupFunnelKey; now: Date }> }
  const d: SignupCompleteDeps = {
    env: o.env ?? OPEN,
    now: () => COMPLETED,
    isExcluded: async () => { calls.excluded++; if (o.excluded === 'throw') throw new Error('x'); return o.excluded ?? false },
    increment: async (key, now) => { calls.saved.push({ key, now }); if (o.save === 'reject') throw new Error('db down') },
  }
  return { d, calls }
}
const valid = marker('magazine', COMPLETED.getTime() + 10 * 60 * 1000)
{
  const r = deps()
  const out = await recordSignupComplete(valid, r.d)
  check('유효 표식 · gate 열림 · 일반 회원 → upsert 1회', out === 'recorded' && r.calls.saved.length === 1 && r.calls.excluded === 1)
  check('key: 완료 시점 서버 KST 날짜 · signup_complete · 표식 값뿐', JSON.stringify(r.calls.saved[0]?.key)
    === JSON.stringify({ day: '2026-10-07', step: 'signup_complete', contentType: 'magazine', entryPoint: 'content_end' })
    && r.calls.saved[0]?.now === COMPLETED)
}
for (const env of [{}, { VERCEL_ENV: 'preview', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-01' }, { VERCEL_ENV: 'production' },
  { VERCEL_ENV: 'production', SIGNUP_FUNNEL_COLLECTION_START: '2026-10-08' }]) {
  const r = deps({ env })
  await recordSignupComplete(valid, r.d)
  check(`gate 닫힘 ${JSON.stringify(env)}: 제외 판정 0 · 집계 0`, r.calls.excluded === 0 && r.calls.saved.length === 0)
}
for (const [name, value] of [['없음', undefined], ['손상', { contentType: 'community' }], ['만료', marker('community', COMPLETED.getTime() - 1)],
  ['30분 초과', marker('community', COMPLETED.getTime() + AUTH_MARKER_TTL_MS + 1)], ['추가 키', { ...valid, userId: 'u1' }]] as const) {
  const r = deps()
  await recordSignupComplete(value, r.d)
  check(`표식 ${name}: 제외 판정 0 · 집계 0`, r.calls.excluded === 0 && r.calls.saved.length === 0)
}
{
  const r = deps({ excluded: true })
  check('관리자·allowlist 제외 → 집계 0', (await recordSignupComplete(valid, r.d)) === 'skipped' && r.calls.saved.length === 0)
  const t = deps({ excluded: 'throw' })
  check('제외 판정 실패 → 기록하지 않음', (await recordSignupComplete(valid, t.d)) === 'skipped' && t.calls.saved.length === 0)
  const s = deps({ save: 'reject' })
  let threw = false
  try { await recordSignupComplete(valid, s.d) } catch { threw = true }
  check('집계 upsert 실패 → 예외 0(가입 결과에 닿지 않음)', !threw && s.calls.saved.length === 1)
}

// ─────────── 6. server action 소스 ───────────
console.log('\n■ 6. completeOnboarding — commit 뒤에만 · 패자 0 · 제외 규칙 재사용')
const action = read('src/lib/actions/onboarding.ts')
const actionCode = code(action)
check('저장은 commitFirstOnboarding 하나 · 옛 배열 transaction·update 0',
  /outcome = await commitFirstOnboarding\(prisma, \{/.test(action) && !/\$transaction\(\[/.test(action) && !/prisma\.user\.update\(/.test(action))
{
  const iCommit = action.indexOf('outcome = await commitFirstOnboarding(prisma')
  const iAlready = action.indexOf("if (outcome === 'already') return { error: ALREADY_ONBOARDED }")
  const iRecord = action.indexOf('await recordSignupComplete(attribution')
  const iOk = action.lastIndexOf('return { ok: true }')
  check('순서: commit → already 면 끝(⑤ 0) → ⑤ → ok', iCommit > 0 && iCommit < iAlready && iAlready < iRecord && iRecord < iOk)
}
check('⑤ 호출은 try 로 한 번 더 격리 · 실패해도 ok', /try \{\s*await recordSignupComplete\(attribution, \{[\s\S]*?\}\)\s*\} catch \{[\s\S]*?\}\s*\n\s*return \{ ok: true \}/.test(action))
check('제외 판정은 기존 checkAdminForUser · isAllowlisted 재사용 · env 파서 복제 0',
  /\(await checkAdminForUser\(userId\)\)\.ok/.test(action) && /isAllowlisted\(/.test(action)
  && !/SIGNUP_ALLOWLIST|SORAN_ADMIN_EMAILS|split\(','\)/.test(actionCode))
check('제외 판정에 필요한 값만 읽는다(이메일 · 카카오 회원번호)',
  /select: \{ email: true, accounts: \{ where: \{ provider: 'kakao' \}, select: \{ providerAccountId: true \} \} \}/.test(action))
check('env 는 gate 두 값만', (actionCode.match(/process\.env\.[A-Z_]+/g) ?? []).sort().join() === 'process.env.SIGNUP_FUNNEL_COLLECTION_START,process.env.VERCEL_ENV')
check("'use server' 파일이 내보내는 action 은 그대로 둘(checkNickname · completeOnboarding)",
  JSON.stringify([...action.matchAll(/^export async function (\w+)/gm)].map((m) => m[1])) === JSON.stringify(['checkNickname', 'completeOnboarding']))
check('선행 확인은 안내용이라 주석에 명시 · 1회 근거라고 쓰지 않음', action.includes('실제로 막는 것은 저장 transaction 의 조건부 전환이다'))
check('로그에 회원 값 0', !/console\.\w+\([^)]*(userId|nickname|email|providerAccountId)/.test(actionCode))
const helper = read('src/lib/signup-completion.ts')
const helperCode = code(helper)
check('helper: server-only · use server 지시어 아님 · raw SQL·after·console 0', /^import 'server-only'/m.test(helper) && !/^'use server'/m.test(helper)
  && !/\$queryRaw|\$executeRaw|after\(|console\./.test(helperCode))
check('helper: interactive transaction 안 updateMany(id + isOnboarded:false) 다음 약관',
  /db\.\$transaction\(async \(tx\) => \{\s*const updated = await tx\.user\.updateMany\(\{\s*where: \{ id: userId, isOnboarded: false \}/.test(helper)
  && /if \(updated\.count !== 1\) return 'already'/.test(helper) && /await tx\.agreement\.upsert\(/.test(helper) && !/\bdb\.(user|agreement)\./.test(helperCode))
const imports = (p: string) => [...read(p).matchAll(/^import .*$/gm)].map((m) => m[0])
check('helper import 고정(D100 0)', JSON.stringify(imports('src/lib/signup-completion.ts')) === JSON.stringify([
  "import 'server-only'",
  "import type { PrismaClient } from '@prisma/client'",
  "import type { SignupFunnelKey } from '@/lib/signup-funnel'",
  "import { signupFunnelGate, type SignupFunnelEnv } from '@/lib/signup-funnel-gate'",
  "import { parseAuthMarker } from '@/lib/signup-prompt-storage'",
]))
// 이 단계 뒤 승인된 후속 보정 — 그 파일만 보정 commit 을 기준으로 고정하고 나머지는 BASE 그대로 본다
const APPROVED_FOLLOW_UPS: Record<string, string> = {
  'src/components/features/signup-funnel/SignupPromptDialog.tsx': '0e2269a5dd59a575b5b54f0b507626101e851839', // 접근성 색상
  'src/components/features/signup-funnel/SignupFunnelTracker.tsx': 'c9b0c8e0ed01b4d23275ea3b1016732320fd90fa', // dialog 비동기 로드
}
const isAncestor = (rev: string) => { try { execFileSync('git', ['merge-base', '--is-ancestor', rev, 'HEAD']); return true } catch { return false } }
check('승인된 후속 보정 기준은 현재 HEAD 의 조상 commit', Object.values(APPROVED_FOLLOW_UPS).every(isAncestor))
const pinned = (p: string) => execFileSync('git', ['show', `${APPROVED_FOLLOW_UPS[p] ?? BASE}:${p}`], { encoding: 'utf8' })
const unchanged = ['src/lib/auth.ts', 'src/lib/auth.config.ts', 'src/lib/admin.ts', 'src/lib/signup-policy.ts', 'prisma/schema.prisma',
  'src/components/features/CommentSection.tsx', 'src/components/features/KakaoSignInButton.tsx', 'src/lib/signup-funnel-store.ts', 'src/lib/signup-funnel.ts',
  'src/components/features/signup-funnel/SignupPromptDialog.tsx', 'src/components/features/signup-funnel/SignupFunnelTracker.tsx', 'src/app/login/page.tsx',
].filter((p) => read(p) !== pinned(p))
check('변경 금지 파일(인증·관리자·정책·schema·댓글·카카오·저장·팝업·복귀) 그대로', unchanged.length === 0, unchanged.join(', '))

// ─────────── 7. 격리 Postgres 동시성 ───────────
if (process.argv.includes('--isolated-db')) {
  console.log('\n■ 7. 격리 Postgres — 동시 요청 중 하나만 최초 전환 · ⑤ 자격')
  const url = process.env.DATABASE_URL ?? ''
  const guard = process.env.SORAN_ISOLATED_DB === 'yes-throwaway'
    && /^postgresql:\/\/[^@/]+@(127\.0\.0\.1|localhost|\[::1\]):\d+\/soran_[a-z0-9_]+$/.test(url)
  check('격리 DB 가드(로컬 주소 · soran_ DB · 명시 플래그)', guard)
  if (guard) {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    try {
      const user = await prisma.user.create({ data: {} })
      const N = 12
      const outcomes = await Promise.all(Array.from({ length: N }, (_, i) =>
        commitFirstOnboarding(prisma, { userId: user.id, nickname: `동시${i}`, agreedAt: new Date(NOW + i), marketing: i % 2 === 0, agreements: AGREEMENTS })
          .catch(() => 'error' as const)))
      const winners = outcomes.filter((o) => o === 'onboarded').length
      check(`동시 ${N}건 중 최초 전환 정확히 1건 · 나머지 already · 오류 0`, winners === 1 && outcomes.filter((o) => o === 'already').length === N - 1, outcomes.join(','))
      const winner = outcomes.indexOf('onboarded')
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { isOnboarded: true, nickname: true, marketingConsentAt: true } })
      const agreements = await prisma.agreement.findMany({ where: { userId: user.id }, select: { agreedAt: true } })
      check('닉네임·마케팅 시각은 승자 요청의 값', after.isOnboarded && after.nickname === `동시${winner}`
        && (winner % 2 === 0 ? after.marketingConsentAt?.getTime() === NOW + winner : after.marketingConsentAt === null))
      check('약관 행은 승자 한 번만(패자 갱신 0)', agreements.length === 2 && agreements.every((a) => a.agreedAt.getTime() === NOW + winner))
      // ⑤ 자격 — 승자만 recordSignupComplete 를 부른다(server action 순서와 같다)
      let fifth = 0
      for (const o of outcomes) if (o === 'onboarded') await recordSignupComplete(valid, { ...deps().d, increment: async () => { fifth++ } })
      check('⑤ 자격은 승자 1건뿐', fifth === 1)
      const again = await commitFirstOnboarding(prisma, { userId: user.id, nickname: '재요청', agreedAt: new Date(NOW + 999), marketing: true, agreements: AGREEMENTS })
      const agreementsAfter = await prisma.agreement.findMany({ where: { userId: user.id }, select: { agreedAt: true } })
      check('재요청: already · 약관 시각 그대로', again === 'already' && agreementsAfter.every((a) => a.agreedAt.getTime() === NOW + winner))

      const victim = await prisma.user.create({ data: {} })
      let rolledBack = false
      try {
        await commitFirstOnboarding(prisma, { userId: victim.id, nickname: '롤백', agreedAt, marketing: true,
          agreements: [AGREEMENTS[0], { type: 'PRIVACY_POLICY', version: null as unknown as string }] })
      } catch { rolledBack = true }
      const v = await prisma.user.findUniqueOrThrow({ where: { id: victim.id }, select: { isOnboarded: true, nickname: true, marketingConsentAt: true } })
      const vAgreements = await prisma.agreement.count({ where: { userId: victim.id } })
      check('약관 중간 실패 → 전부 롤백(전환·닉네임·마케팅·약관 0)', rolledBack && !v.isOnboarded && v.nickname === null && v.marketingConsentAt === null && vAgreements === 0)
    } finally {
      await prisma.$disconnect()
    }
  }
} else {
  console.log('\n■ 7. 격리 Postgres 동시성 — 실행하지 않음(--isolated-db 없음)')
}

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
