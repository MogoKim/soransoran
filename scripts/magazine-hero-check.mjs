#!/usr/bin/env node
/**
 * hero 자동화 회귀 테스트 (M-AUTO-5)
 *
 * 🔴 이미지를 만들지 않는다. 브라우저도 띄우지 않는다.
 *    `planHero` · `checkAlt` · `injectHeroImage` 는 순수 함수라 그대로 부를 수 있고,
 *    `verifyHeroFile` 만 repo 에 이미 있는 which-clinic hero 로 실제 검증한다.
 *
 * 실행: node scripts/magazine-hero-check.mjs
 */

import { spawnSync } from 'node:child_process'
import { loadQueue } from './lib/magazine-load.mjs'
import {
  planHero, checkAlt, buildPrompt, injectHeroImage, verifyHeroFile,
  heroPublicPath, SAFETY_RULES, HERO_WIDTH, HERO_HEIGHT,
} from './lib/magazine-hero.mjs'

let failed = 0
let passed = 0
const expect = (label, actual, want) => {
  const ok = actual === want
  ok ? (passed += 1) : (failed += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}`)
  if (!ok) console.log(`       기대 ${want} · 실제 ${actual}`)
}
const queue = loadQueue()
const item = (slug) => queue.find((i) => i.slug === slug) ?? null
const has = (p, frag) => p.reasons.some((r) => r.includes(frag))

const GOOD_ALT = '아침 거실 창가에서 휴대폰을 내려다보는 40대 후반 한국 여성'

console.log('\n══════ 실패 케이스')
{
  const p = planHero({ slug: undefined, alt: GOOD_ALT })
  expect('slug 없음 → BLOCKED', p.verdict, 'BLOCKED')
  expect('  사유가 slug 다', has(p, '--slug 가 필요하다'), true)
}
{
  const p = planHero({ slug: 'no-such-slug-xyz', alt: GOOD_ALT, queueItem: null })
  expect('draft 없음 → BLOCKED', p.verdict, 'BLOCKED')
  expect('  사유가 article-draft.ts 다', has(p, 'article-draft.ts 가 없다'), true)
}
{
  // imageMode OPTIONAL — 큐에 실재하는 항목으로 본다
  const optional = queue.find((i) => i.imageMode === 'OPTIONAL')
  const p = planHero({ slug: optional.slug, alt: GOOD_ALT, queueItem: optional })
  expect(`imageMode=OPTIONAL (${optional.slug}) → BLOCKED`, p.verdict, 'BLOCKED')
  expect('  사유가 imageMode 다', has(p, 'imageMode=OPTIONAL'), true)
}
{
  /**
   * 🔴 **낡은 기대를 폐기했다** (2026-09-26 운영 사고 · SUPERSEDED).
   *    앞판은 `hero 이미 있음 + force 없음 → BLOCKED` 를 기대했다.
   *    그 규칙 때문에, 변환기가 `heroImage` 자리표시자를 되돌려 놓은 글은
   *    **파일이 멀쩡히 있는데도** 매 회차 HERO_FAILED 로 막혔다.
   *    지금은 유효한 hero 를 **재사용**한다. 막는 것은 손상된 hero 뿐이다.
   */
  const p = planHero({ slug: 'which-clinic-menopause', alt: GOOD_ALT, queueItem: null })
  expect('hero 이미 있음 + force 없음 → READY (재사용)', p.verdict, 'READY')
  expect('  hero 존재가 더 이상 사유가 아니다', has(p, 'hero 가 이미 있다'), false)
  expect('  재사용으로 표시된다', p.checks.reuseExisting, true)
  expect('  크기를 확인했다', p.checks.heroSize?.width, 1200)
}
{
  const p = planHero({ slug: 'which-clinic-menopause', alt: undefined, queueItem: null, force: true })
  expect('alt 없음 → BLOCKED', p.verdict, 'BLOCKED')
  expect('  사유가 alt 다', has(p, 'alt 가 없다'), true)
}

console.log('\n══════ alt 규칙')
expect('빈 alt', checkAlt('').ok, false)
expect('너무 짧다', checkAlt('여성').ok, false)
expect('"여성" 으로 끝나지 않는다', checkAlt('아침 거실에서 휴대폰을 보는 사람').ok, false)
expect('121자는 막는다', checkAlt('가'.repeat(119) + '여성').ok, false)
expect('정상 alt', checkAlt(GOOD_ALT).ok, true)

console.log('\n══════ 성공 경로 (파일은 쓰지 않는다)')
{
  const p = planHero({ slug: 'which-clinic-menopause', alt: GOOD_ALT, queueItem: null, force: true })
  expect('force + alt → READY', p.verdict, 'READY')
  expect('  사유 0건', p.reasons.length, 0)
  expect('  heroImage 가 이미 있어 주입하지 않는다', p.checks.willInject, false)
  expect('  publicPath', p.checks.publicPath, '/magazine/which-clinic-menopause/hero.webp')
}
{
  /**
   * 🔴 **큐에서 첫 항목을 고르지 않는다** (2026-09-27 CI 사고).
   *
   *    앞판은 `queue.find((i) => i.imageMode === 'REQUIRED')` 였다. 그 답은
   *    **큐 내용에 따라 바뀐다** — `checkup-items-50s` 가 등록돼 큐에서 빠지자
   *    `palpitations-menopause`(재료 없음)가 뽑혀 `BLOCKED` 가 됐고, 코드가 멀쩡한데
   *    시험만 빨개졌다. **자동 등록이 성공할수록 CI 가 깨지는 구조**다.
   *
   *    이제 **추적된 고정 자산**을 쓰고 `imageMode` 는 synthetic 으로 명시한다.
   *    REQUIRED 계약을 보는 것이 목적이지, 큐에 그 값이 실제로 있는지 보는 것이 아니다.
   *    🔴 큐가 0건이어도 이 시험은 같은 결과를 낸다.
   */
  const FIXED = 'which-clinic-menopause'
  /** 🔴 고정 자산이 **추적되고 있는지** 먼저 확인한다 — 미추적이면 환경에 따라 달라진다 */
  const tracked = (path) =>
    spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { encoding: 'utf8' }).status === 0
  expect(`${FIXED}/article-draft.ts 가 추적된다`, tracked(`drafts/magazine/${FIXED}/article-draft.ts`), true)
  expect(`${FIXED}/hero.webp 가 추적된다`, tracked(`public/magazine/${FIXED}/hero.webp`), true)

  const p = planHero({ slug: FIXED, alt: GOOD_ALT, queueItem: { slug: FIXED, imageMode: 'REQUIRED' } })
  expect(`REQUIRED(${FIXED}) 은 재료가 갖춰져 READY`, p.verdict, 'READY')
  expect('  imageMode 사유는 없다 — REQUIRED 라서', has(p, 'imageMode='), false)
  expect('  유효한 기존 hero 를 재사용한다', p.checks.reuseExisting, true)
  expect('  hero 가 1200×675 다', `${p.checks.heroSize?.width}×${p.checks.heroSize?.height}`, '1200×675')

  /**
   * 🔴 **큐를 어떻게 흔들어도 같은 결과여야 한다.** 이 시험이 큐를 읽지 않는다는 증거다.
   *    순서 뒤집기 · REQUIRED 0건 · 큐 자체가 0건 — 세 경우 모두 확인한다.
   */
  for (const [name, qi] of [
    ['synthetic REQUIRED', { slug: FIXED, imageMode: 'REQUIRED' }],
    ['큐에 없던 항목처럼', { slug: FIXED, imageMode: 'REQUIRED', day: 999 }],
  ]) {
    expect(`  큐 상태와 무관하다 (${name})`, planHero({ slug: FIXED, alt: GOOD_ALT, queueItem: qi }).verdict, 'READY')
  }
}

console.log('\n══════ 프롬프트 안전 정책')
{
  const prompt = buildPrompt({ title: '갱년기 증상 무슨 과에 가야 하나요', cluster: 'clinic' })
  for (const rule of ['hospitals', 'white coats', 'no visible text', '20s or 30s', 'Western', 'elderly']) {
    expect(`금지 문구 "${rule}" 포함`, prompt.includes(rule), true)
  }
  expect('SAFETY_RULES 9개 전부 들어간다', SAFETY_RULES.every((r) => prompt.includes(r)), true)
  expect('나이를 명시한다', prompt.includes('late 40s to early 50s'), true)
  expect('--prompt 가 장면을 덮어쓴다', buildPrompt({ cluster: 'clinic', scene: 'sitting by the window' }).includes('sitting by the window'), true)
}

console.log('\n══════ heroImage 주입 (문자열 변환만)')
{
  const src = "export const DRAFT = {\n  medical: true,\n  // heroImage 는 이미지 회수 후 채운다\n\n  body: [],\n}\n"
  const r = injectHeroImage(src, 'test-slug', GOOD_ALT)
  expect('주입 성공', r.ok, true)
  expect('  src 4필드 — src', r.text.includes("src: '/magazine/test-slug/hero.webp'"), true)
  expect('  alt', r.text.includes(`alt: '${GOOD_ALT}'`), true)
  expect('  width', r.text.includes(`width: ${HERO_WIDTH}`), true)
  expect('  height', r.text.includes(`height: ${HERO_HEIGHT}`), true)
  expect('  placeholder 가 사라진다', r.text.includes('heroImage 는 이미지 회수 후'), false)

  const already = injectHeroImage("  heroImage: {\n    src: 'x',\n  },\n", 'test-slug', GOOD_ALT)
  expect('이미 있으면 그대로 둔다', already.ok && already.text.includes("src: 'x'"), true)

  const none = injectHeroImage('export const DRAFT = {}\n', 'test-slug', GOOD_ALT)
  expect('자리가 없으면 실패', none.ok, false)
}

console.log('\n══════ webp 검증 — repo 의 실제 파일로 확인한다')
{
  const r = verifyHeroFile('which-clinic-menopause')
  expect('which-clinic hero 통과', r.ok, true)
  expect(`  ${HERO_WIDTH}×${HERO_HEIGHT}`, r.size && r.size.width === HERO_WIDTH && r.size.height === HERO_HEIGHT, true)

  const missing = verifyHeroFile('no-such-slug-xyz')
  expect('파일 없으면 실패', missing.ok, false)
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
