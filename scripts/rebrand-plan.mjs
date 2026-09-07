#!/usr/bin/env node
/**
 * 리브랜딩 dry-run — 무엇을 어떤 순서로 바꿔야 하는지 출력만 한다
 *
 * 🔴 이 스크립트는 **아무것도 바꾸지 않는다.**
 *    파일도, 환경변수도, 외부 서비스도 건드리지 않는다. 읽고 출력할 뿐이다.
 *    (그래서 CI 에 넣지 않는다 — 사람이 전환을 준비할 때 돌려 보는 도구다)
 *
 * 🔴 **비밀값은 절대 출력하지 않는다.**
 *    manifest 의 secret 항목은 값을 갖고 있지 않고(이름만 있다),
 *    이 스크립트도 process.env 를 읽지 않는다. 로그가 남는 자리라서다.
 *
 * 사용:
 *   npm run rebrand:plan                 순서와 검증·롤백을 출력
 *   npm run rebrand:plan -- --domain-only 도메인 종속 항목만
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readManifest, resolveCurrentValues } from './lib/rebrand-manifest-reader.mjs'

const ROOT = process.cwd()
const DOMAIN_ONLY = process.argv.includes('--domain-only')

const STEPS = ['decide', 'domain', 'external', 'code', 'cutover']
const STEP_LABEL = {
  decide: '브랜드 값·자산·메일 수신 확정',
  domain: '도메인·DNS·Vercel 준비',
  external: '외부 서비스 등록 (카카오 · GA · 검색엔진)',
  code: '코드 정본 변경 + preview QA',
  cutover: 'production 전환과 사후 관측',
}
const OWNER_LABEL = {
  code: '코드 자동',
  'client-public-env': '공개 환경변수(브라우저 노출)',
  'server-non-secret-env': '서버 환경변수(비밀 아님 · 브라우저 미노출)',
  'public-identifier': '공개 식별자',
  'secret-env': '비밀 환경변수',
  'external-console': '외부 콘솔 수동',
}
const POLICY_LABEL = {
  change: '반드시 변경',
  review: '조건부 검토',
  keep: '그대로 유지',
}

const configs = resolveCurrentValues(
  readManifest(readFileSync(join(ROOT, 'src/lib/rebrand-manifest.ts'), 'utf8')),
  ROOT,
)
const target = DOMAIN_ONLY ? configs.filter((c) => c.domainBound) : configs

const line = (n = 74) => '─'.repeat(n)

console.log('')
console.log('리브랜딩 전환 계획 (dry-run — 아무것도 바꾸지 않습니다)')
console.log(line())
console.log('')
console.log('🔴 0. 무엇보다 먼저 — 정본을 바꾸기 전에 기존 공개값을 legacyValues 로 옮긴다.')
console.log('     src/lib/rebrand-manifest.ts 의 각 항목 legacyValues 에 지금 값을 적는다.')
console.log('     순서를 뒤집으면 옛 값이 아무 데도 남지 않아, 잔존을 찾을 방법이 사라진다.')
console.log('     (가드는 새 값의 중복과 옛 값의 잔존을 **둘 다** 검사한다)')
console.log('')

// 옛 값은 항목명과 개수만 — 실제 문자열을 늘어놓을 이유가 없다
const tracked = target.filter((c) => c.legacyValues !== undefined)
const withLegacy = tracked.filter((c) => (c.legacyValues?.length ?? 0) > 0)
console.log(`     옛 값 추적 가능 ${tracked.length}항목 · 등록된 옛 값 ${withLegacy.reduce((n, c) => n + c.legacyValues.length, 0)}건`)
for (const c of tracked) {
  const n = c.legacyValues?.length ?? 0
  console.log(`       ${n ? `${n}건` : '없음'}  ${c.id}  (${c.what})`)
}
console.log('')
console.log(line())
console.log(
  `대상 ${target.length}건${DOMAIN_ONLY ? ' (도메인 종속만)' : ''} · ` +
    `코드 자동 ${target.filter((c) => c.owner === 'code').length} · ` +
    // 🔴 public-identifier 는 '-env' 로 끝나지 않는다. 접미어로 세면 빠진다
    `환경변수 ${target.filter((c) => c.owner !== 'code' && c.owner !== 'external-console').length} · ` +
    `외부 콘솔 ${target.filter((c) => c.owner === 'external-console').length}`,
)
console.log('')

// ── 순서대로 ──
for (const step of STEPS) {
  const items = target.filter((c) => c.step === step)
  if (!items.length) continue
  console.log(`■ ${STEPS.indexOf(step) + 1}. ${STEP_LABEL[step]}`)
  for (const c of items) {
    const mark = c.owner === 'code' ? '  🔧' : c.owner === 'external-console' ? '  👤' : '  ⚙️ '
    console.log(`${mark} [${POLICY_LABEL[c.policy]} · ${OWNER_LABEL[c.owner]}] ${c.what}`)
    console.log(`      위치   ${c.secret ? `${c.source} (환경변수 이름 · 값은 출력하지 않음)` : c.source}`)
    console.log(`      검증   ${c.verify}`)
    if (c.domainBound) console.log('      ⚠️  도메인이 바뀌면 반드시 함께 바뀐다')
  }
  console.log('')
}

// ── 리브랜딩 정책 3묶음 ──
const CHANGE = target.filter((c) => c.policy === 'change')
const REVIEW = target.filter((c) => c.policy === 'review')
const KEEP = target.filter((c) => c.policy === 'keep')

console.log(line())
console.log(`■ 1. 반드시 변경 (${CHANGE.length}건)`)
for (const c of CHANGE) {
  console.log(`  ${c.owner === 'code' ? '🔧' : c.owner === 'external-console' ? '👤' : '⚙️ '} ${c.what}`)
  console.log(`      ${c.source}`)
  console.log(`      ${c.policyWhy}`)
}
console.log('')

console.log(`■ 2. 조건부 검토 (${REVIEW.length}건)`)
console.log('  🔴 조건을 확인하기 전에는 바꾸지 않는다.')
for (const c of REVIEW) {
  console.log(`  ${c.owner === 'code' ? '🔧' : c.owner === 'external-console' ? '👤' : '⚙️ '} ${c.what}`)
  console.log(`      ${c.source}`)
  console.log(`      조건  ${c.policyWhy}`)
}
console.log('')

console.log(`■ 3. 그대로 유지 (${KEEP.length}건) — 🔴 변경 목록이 아니다`)
for (const c of KEEP) {
  console.log(`  🔒 ${c.what}`)
  console.log(`      ${c.source}`)
  console.log(`      ${c.policyWhy}`)
}
console.log('')

console.log(line())
console.log('■ 코드로 자동 변경되는 정본 (변경·검토 대상만)')
for (const c of [...CHANGE, ...REVIEW].filter((x) => x.owner === 'code')) {
  console.log(`  ${c.source}  —  ${c.what}  [${POLICY_LABEL[c.policy]}]`)
}
console.log('')
console.log('■ 사람이 외부 콘솔에서 직접 해야 하는 것 (자동화 불가)')
for (const c of [...CHANGE, ...REVIEW].filter((x) => x.owner === 'external-console')) {
  console.log(`  ${c.source}`)
  console.log(`    ${c.what}  [${POLICY_LABEL[c.policy]}]`)
}
console.log('')

// ── 전환 전후 검증 ──
console.log(line())
console.log('■ 전환 전 (preview 에서)')
console.log('  1. npm run check:brand · check:tokens · check:brand-colors · check:contrast')
console.log('  2. npm run check:rebrand-config  — 정본 밖 하드코딩 0')
console.log('  3. npm run check:brand-assets    — 아이콘 교체 여부')
console.log('  4. npm run check:contrast:rebrand — 새 색이 기준을 넘는지 (부채 미허용)')
console.log('  5. SORAN_ALLOW_INDEXING 을 비워 둔 채 preview QA')
console.log('')
console.log('■ 전환 후 (production 에서)')
for (const c of target.filter((x) => x.domainBound && x.policy !== 'keep')) {
  console.log(`  · ${c.what}`)
  console.log(`      ${c.verify}`)
}
console.log('')

// ── 롤백 ──
console.log(line())
console.log('■ 실패 시 롤백 순서 (전환의 역순)')
console.log('  🔴 옛 도메인·옛 카카오 redirect URI·옛 검색엔진 등록을 먼저 지우지 않는다.')
console.log('     지우지 않았으면 아래가 그대로 복구 경로가 된다.')
console.log('')
for (const [i, step] of [...STEPS].reverse().entries()) {
  // keep 은 바꾸지 않았으므로 되돌릴 것도 없다
  const items = target.filter((c) => c.step === step && c.policy !== 'keep')
  if (!items.length) continue
  console.log(`  ${i + 1}) ${STEP_LABEL[step]} 되돌리기`)
  for (const c of items) console.log(`     · ${c.what}\n         ${c.rollback}`)
}
console.log('')

// ── 비밀값 ──
console.log(line())
console.log('■ 절대 출력하면 안 되는 값 (이 스크립트는 이름만 압니다)')
for (const c of target.filter((x) => x.secret)) {
  console.log(`  ${c.source}  —  ${c.what}`)
}
console.log('  🔴 값은 Vercel 환경변수 화면에서만 다룬다. 터미널·PR·문서에 붙여넣지 않는다.')
console.log('')

// ── 한계 ──
console.log(line())
console.log('■ 이 계획이 보장하지 못하는 것')
console.log('  · manifest 에 적지 않은 전환 대상은 여기 없다. 사람이 적은 목록이다.')
console.log('  · 외부 콘솔의 실제 설정 상태를 읽지 못한다 — 👤 항목은 눈으로 확인해야 한다.')
console.log('  · 이미 발행된 글 본문의 옛 브랜드 호칭은 코드로 되돌릴 수 없다.')
console.log('')
console.log('상세 절차: docs/operations/rebrand-runbook.md')
console.log('')
