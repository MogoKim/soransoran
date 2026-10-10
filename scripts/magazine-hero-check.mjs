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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

console.log('\n══════ 신규 생성 경로 — sharp 변환 · 원복 · 재사용 · 운영 모드 fixture 차단 (임시 루트 · 저장소 public 불변)')
{
  /**
   * 🔴 `apply` 는 저장소 ROOT 의 public/ 에 쓴다. 그래서 scripts 를 임시 루트로 복사해 **그 사본의 ROOT** 에서 돌린다.
   *    이미지 생성(ChatGPT)만 결정적 PNG 로 대신하고, 변환(sharp) · 저장 · 검증 · 원복 · 주입은 실제 코드다.
   */
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'hero-check-')))
  try {
    cpSync(join(REPO, 'scripts'), join(T, 'scripts'), { recursive: true })
    mkdirSync(join(T, 'drafts', 'magazine'), { recursive: true })
    cpSync(join(REPO, 'drafts', 'magazine', 'topic-queue.ts'), join(T, 'drafts', 'magazine', 'topic-queue.ts'))
    cpSync(join(REPO, 'src', 'content', 'magazine'), join(T, 'src', 'content', 'magazine'), { recursive: true })
    symlinkSync(join(REPO, 'node_modules'), join(T, 'node_modules'))
    mkdirSync(join(T, 'home'), { recursive: true })
    const child = join(T, 'hero-apply-cases.mjs')
    writeFileSync(child, `import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
const T = ${JSON.stringify(T)}
const H = await import(T + '/scripts/magazine-hero-runner.mjs')
const W = await import(T + '/scripts/lib/magazine-hero-webp.mjs')
const L = await import(T + '/scripts/lib/magazine-hero.mjs')
const ALT = ${JSON.stringify(GOOD_ALT)}
const slug = 'hero-check-slug'
const draftDir = join(T, 'drafts', 'magazine', slug)
const article = join(draftDir, 'article-draft.ts')
const heroFile = L.heroFilePath(slug)
const ARTICLE = "export const DRAFT = {\\n  title: '시험 제목',\\n  cluster: 'relationship',\\n  medical: false,\\n  // heroImage 는 이미지 회수 후 채운다\\n\\n  body: [],\\n}\\n"
const reset = ({ hero = null } = {}) => {
  mkdirSync(draftDir, { recursive: true }); writeFileSync(article, ARTICLE)
  rmSync(join(T, 'public'), { recursive: true, force: true })
  if (hero) { mkdirSync(join(T, 'public', 'magazine', slug), { recursive: true }); writeFileSync(heroFile, hero) }
}
const png = (r) => sharp({ create: { width: 1536, height: 1024, channels: 3, background: { r, g: 120, b: 90 } } }).png().toBuffer()
const PNG = await png(200)
const out = {}
const meta = async (b) => { const m = await sharp(b).metadata(); return { format: m.format, width: m.width, height: m.height } }
const plan = (force = false) => L.planHero({ slug, alt: ALT, queueItem: null, force, allowOptional: true })
const counted = (over = {}) => { const c = { generate: 0, convert: 0 }; return { c, deps: {
  generate: async () => { c.generate += 1; return over.gen ?? { ok: true, buffer: PNG } },
  convert: async (b) => { c.convert += 1; return over.convert ? over.convert(b) : W.toHeroWebp(b) } } } }

// ① 결정적 PNG → 실제 sharp 변환
const w = await W.toHeroWebp(PNG)
out.convert = { ok: w.ok, meta: w.ok ? await meta(w.buffer) : null, quality: W.WEBP_QUALITY }
// ② 잘못된 이미지 → webp 단계 실패 · 파일·article 불변
reset(); { const k = counted({ gen: { ok: true, buffer: Buffer.from('not an image at all') } }); const r = await H.apply(plan(), 'p', ALT, k.deps)
  out.bad = { ok: r.ok, stage: r.stage ?? null, why: r.why ?? null, file: existsSync(heroFile), article: readFileSync(article, 'utf8') === ARTICLE, calls: k.c } }
// ③ 저장 후 검증 실패 — 무파일 상태로 원복
reset(); { const k = counted({ convert: () => ({ ok: true, buffer: Buffer.from('RIFF0000WEBPbroken') }) }); const r = await H.apply(plan(), 'p', ALT, k.deps)
  out.rollbackNone = { ok: r.ok, why: r.why ?? null, file: existsSync(heroFile), article: readFileSync(article, 'utf8') === ARTICLE } }
// ④ 저장 후 검증 실패 — 기존 파일 바이트로 원복 (--force 덮어쓰기 경로)
const OLD = (await W.toHeroWebp(await png(30))).buffer
reset({ hero: OLD }); { const k = counted({ convert: () => ({ ok: true, buffer: Buffer.from('RIFF0000WEBPbroken') }) }); const r = await H.apply(plan(true), 'p', ALT, k.deps)
  out.rollbackOld = { ok: r.ok, why: r.why ?? null, restored: existsSync(heroFile) && Buffer.compare(readFileSync(heroFile), OLD) === 0, article: readFileSync(article, 'utf8') === ARTICLE } }
// ⑤ 기존 hero 재사용 — 생성·변환 0
reset({ hero: OLD }); { const k = counted(); const p = plan(); const r = await H.apply(p, 'p', ALT, k.deps)
  out.reuse = { reuseExisting: p.checks.reuseExisting, ok: r.ok, reused: r.reused === true, calls: k.c, same: Buffer.compare(readFileSync(heroFile), OLD) === 0, injected: readFileSync(article, 'utf8').includes("src: '/magazine/hero-check-slug/hero.webp'") } }
// ⑥ 신규 생성 — 생성 1 · 변환 1 · 1200×675 webp · heroImage 4필드
reset(); { const k = counted(); const r = await H.apply(plan(), 'p', ALT, k.deps); const a = readFileSync(article, 'utf8')
  out.fresh = { ok: r.ok, calls: k.c, meta: existsSync(heroFile) ? await meta(readFileSync(heroFile)) : null, same: existsSync(heroFile) && Buffer.compare(readFileSync(heroFile), w.buffer) === 0,
    fields: [\"src: '/magazine/hero-check-slug/hero.webp'\", 'alt: ' + JSON.stringify(ALT).replace(/\"/g, \"'\"), 'width: 1200', 'height: 675'].map((f) => a.includes(f)) } }
console.log(JSON.stringify(out))
`)
    const env = { PATH: process.env.PATH, HOME: join(T, 'home'), TMPDIR: join(T, 'home') }
    const r = spawnSync(process.execPath, [child], { encoding: 'utf8', env, cwd: T })
    let o = {}
    try { o = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { console.log(r.stdout, r.stderr) }
    expect('결정적 PNG → 실제 sharp 변환 → webp 1200×675 · 품질 82', o.convert?.ok && o.convert.meta?.format === 'webp' && o.convert.meta.width === HERO_WIDTH && o.convert.meta.height === HERO_HEIGHT && o.convert.quality === 82, true)
    expect('잘못된 이미지 → webp 단계 실패 (stage=webp · 진단 사유)', o.bad?.ok === false && o.bad.stage === 'webp' && /^webp: /.test(o.bad.why ?? ''), true)
    expect('  파일 0 · article 불변 · 생성 1 변환 1', !o.bad?.file && o.bad?.article && o.bad.calls.generate === 1 && o.bad.calls.convert === 1, true)
    expect('저장 후 검증 실패 → 무파일 상태로 원복 · article 불변', o.rollbackNone?.ok === false && /hero 검증 실패/.test(o.rollbackNone.why ?? '') && !o.rollbackNone.file && o.rollbackNone.article, true)
    expect('저장 후 검증 실패 → 기존 파일 바이트로 원복 · article 불변', o.rollbackOld?.ok === false && o.rollbackOld.restored && o.rollbackOld.article, true)
    expect('기존 hero 재사용 → 생성 0 · 변환 0 · 파일 그대로 · heroImage 주입', o.reuse?.reuseExisting && o.reuse.ok && o.reuse.reused && o.reuse.calls.generate === 0 && o.reuse.calls.convert === 0 && o.reuse.same && o.reuse.injected, true)
    expect('신규 생성 → 생성 1 · 변환 1 · 실제 변환 바이트 · 1200×675 webp', o.fresh?.ok && o.fresh.calls.generate === 1 && o.fresh.calls.convert === 1 && o.fresh.same && o.fresh.meta?.format === 'webp' && o.fresh.meta.width === HERO_WIDTH && o.fresh.meta.height === HERO_HEIGHT, true)
    expect('  article-draft.ts heroImage 4필드 (src · alt · width · height)', Array.isArray(o.fresh?.fields) && o.fresh.fields.every(Boolean), true)

    // ⑦ 운영 모드에서 fixture 설정 → 큐·파일·Chrome 전에 멈춘다 (fixture 를 import 조차 하지 않는다)
    const marker = join(T, 'fixture-imported')
    const fx = join(T, 'fx.mjs')
    writeFileSync(fx, `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'x')\nexport default { generateImage: async () => ({ ok: true, buffer: Buffer.alloc(0) }) }\n`)
    rmSync(join(T, 'public'), { recursive: true, force: true })
    const before = readFileSync(join(T, 'drafts', 'magazine', 'hero-check-slug', 'article-draft.ts'), 'utf8')
    const cli = spawnSync(process.execPath, [join(T, 'scripts', 'magazine-hero-runner.mjs'), '--slug', 'hero-check-slug', '--alt', GOOD_ALT, '--write', '--allow-optional'],
      { encoding: 'utf8', cwd: T, env: { ...env, SORAN_MAGAZINE_TEST_FIXTURE: fx } })
    expect('운영 모드 + fixture 설정 → 종료 2 · TEST_INJECTION_BLOCKED', cli.status === 2 && /TEST_INJECTION_BLOCKED/.test(cli.stderr), true)
    expect('  fixture import 0 · hero 파일 0 · article 불변', !existsSync(marker) && !existsSync(join(T, 'public')) && readFileSync(join(T, 'drafts', 'magazine', 'hero-check-slug', 'article-draft.ts'), 'utf8') === before, true)
  } finally {
    rmSync(T, { recursive: true, force: true })
  }
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL`)
process.exit(failed === 0 ? 0 : 1)
