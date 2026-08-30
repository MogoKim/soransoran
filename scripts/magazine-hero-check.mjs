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
  // hero 이미 있음 + force 없음 — which-clinic 은 등록돼 큐에 없다
  const p = planHero({ slug: 'which-clinic-menopause', alt: GOOD_ALT, queueItem: null })
  expect('hero 이미 있음 + force 없음 → BLOCKED', p.verdict, 'BLOCKED')
  expect('  사유가 hero 존재다', has(p, 'hero 가 이미 있다'), true)
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
  const required = queue.find((i) => i.imageMode === 'REQUIRED')
  const p = planHero({ slug: required.slug, alt: GOOD_ALT, queueItem: required })
  expect(`REQUIRED(${required.slug}) 은 draft 가 없어 BLOCKED`, p.verdict, 'BLOCKED')
  expect('  imageMode 사유는 없다 — REQUIRED 라서', has(p, 'imageMode='), false)
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
