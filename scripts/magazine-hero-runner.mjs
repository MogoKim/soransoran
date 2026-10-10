#!/usr/bin/env node
/**
 * hero 생성 — ChatGPT 이미지 → 1200×675 webp → article-draft.ts 주입 (M-AUTO-5 1차)
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   md-to-draft ──▶ [hero runner] ──▶ batch-qa ──▶ register
 *                    ↑ 여기
 *
 * 🔴 **등록 게이트를 열지 않는다.**
 *    🔴 M3-A — 등급은 아무것도 막지 않는다. hero 는 등록 관문과 무관하다.
 *    hero 는 batch-qa 의 ⑥번 조건 하나일 뿐이다.
 *
 * 🔴 기본은 dry-run. `--write` 없이는 아무 파일도 쓰지 않는다.
 *
 * 🔴 imageMode=OPTIONAL 은 만들지 않는다. `--allow-optional` 을 사람이 붙여야 한다.
 *    큐 35건 중 REQUIRED 는 3건뿐이다. 나머지를 자동으로 만들면 매일 32장을
 *    쌓아 두고 아무도 보지 않는다.
 *
 * 🔴 이미지 생성은 headed Chrome 으로만 돈다. headless 는 Cloudflare 가 막는다.
 *    `magazine-webui-runner.mjs --login` 으로 띄운 창을 재사용한다.
 *
 * webp 변환은 Chrome 이 아니라 Node 의 sharp 다 (2026-10-10 · `lib/magazine-hero-webp.mjs`)
 *    앞판은 "이 환경에 sharp 가 없다" 며 같은 Chrome 의 canvas 로 변환했다. 지금 sharp 는 저장소 직접 의존성이고
 *    (src/lib/image-optimize.ts 도 쓴다) 1200×675 · fill · 품질 82 계약을 그대로 옮겼다. Chrome 이 필요한 것은 생성뿐이다.
 *
 * 🔴 시험 주입 — `SORAN_MAGAZINE_TEST_MODE=1` 일 때만 `generateImage`(ChatGPT 이미지 결과)와 `heroTrace`(관찰)를 받는다
 *    (`lib/magazine-test-harness.mjs`). 운영 모드에서 fixture 설정이 보이면 큐·파일·Chrome 에 닿기 전에 멈춘다.
 *    프롬프트 · 변환 · 저장 · 검증 · 원복 · heroImage 주입은 시험에서도 이 파일의 실제 코드다.
 *
 * 사용법
 *   node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…여성"
 *   node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --write
 *   node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --prompt "장면 서술" --write
 *   node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --force --write
 *   node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --allow-optional
 *   node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --json
 *
 * 종료 코드: BLOCKED 면 1, 아니면 0
 */

import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadQueue } from './lib/magazine-load.mjs'
import { loadTestHarness } from './lib/magazine-test-harness.mjs'
import { toHeroWebp } from './lib/magazine-hero-webp.mjs'
import {
  CDP_URL, ensureChrome, ensurePageTarget, CDP_CONNECT_TIMEOUT_MS,
  COMPOSER_SELECTOR, composerLocator,
} from './lib/chatgpt-session.mjs'
import {
  planHero, buildPrompt, injectHeroImage, verifyHeroFile,
  heroFilePath, heroPublicPath, HERO_WIDTH, HERO_HEIGHT,
} from './lib/magazine-hero.mjs'

const CHATGPT_URL = 'https://chatgpt.com/'
const GENERATE_TIMEOUT_MS = 360000

/** playwright-core 는 repo 의 것을 쓴다 */
async function chromium() {
  const mod = await import('playwright-core')
  return mod.chromium
}

/**
 * ChatGPT 대화에서 이미지를 만들고 PNG 버퍼를 돌려준다.
 *
 * ⚠️ 이미지 URL 은 `chatgpt.com/backend-api/estuary/content` 다.
 *    `oaiusercontent` 로만 거르면 못 찾는다 — 실측에서 6분을 흘려보냈다.
 *    폭으로 거르는 편이 호스트 변화에 강하다.
 */
async function generateImage(prompt) {
  /**
   * 🔴 **raw ensurePageTarget 앞에 ensureChrome 을 먼저 부른다** (2026-09-26 사고).
   *    앞판은 곧바로 탭을 열려 했고, Chrome 이 안 떠 있으면 그대로 실패했다.
   *    producer 쪽에는 자동 기동이 있는데 hero 쪽에는 없어서, 같은 회차 안에서
   *    한쪽은 뜨고 한쪽은 못 뜨는 어긋남이 생겼다. 경로를 하나로 맞춘다.
   */
  const boot = await ensureChrome()
  if (!boot.ok) return { ok: false, stage: 'chrome', why: `${boot.reason ?? 'CHROME_NOT_RUNNING'} — Chrome 을 띄우지 못했다` }
  const tab = await ensurePageTarget()
  if (!tab.ok) return { ok: false, stage: 'tab', why: 'CHROME_NOT_RUNNING — magazine-webui-runner.mjs --login 으로 창을 띄운다' }

  let browser = null
  let page = null
  let stage = 'connect'
  try {
    browser = await (await chromium()).connectOverCDP(CDP_URL, { timeout: CDP_CONNECT_TIMEOUT_MS })
    const ctx = browser.contexts()[0]
    if (!ctx) return { ok: false, stage, why: 'no_context' }
    stage = 'open-tab'
    page = await ctx.newPage()
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    // 🔴 정본 선택자 하나만 쓴다 (chatgpt-session.mjs · COMPOSER_SELECTOR)
    stage = 'composer'
    await page.waitForSelector(COMPOSER_SELECTOR, { timeout: 60000 })
    await composerLocator(page).click()
    await page.keyboard.insertText(prompt)
    await page.waitForTimeout(700)
    await page.keyboard.press('Enter')

    const deadline = Date.now() + GENERATE_TIMEOUT_MS
    let src = null
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000)
      src = await page.evaluate(() => {
        const big = [...document.querySelectorAll('img')].filter((i) => i.naturalWidth > 600)
        return big.length ? big[big.length - 1].src : null
      })
      if (src) break
    }
    if (!src) return { ok: false, why: '이미지가 생성되지 않았다 (타임아웃)' }

    const b64 = await page.evaluate(async (url) => {
      const res = await fetch(url)
      const bytes = new Uint8Array(await res.arrayBuffer())
      let s = ''
      const CH = 0x8000
      for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
      return btoa(s)
    }, src)
    return { ok: true, buffer: Buffer.from(b64, 'base64') }
  } catch (err) {
    /**
     * 🔴 **예외를 밖으로 흘리지 않는다** (2026-09-27 사고).
     *    앞판은 여기서 던진 예외가 `main()` 까지 올라가 프로세스가 죽었고,
     *    호출부(drive)는 stderr 의 **마지막 두 줄**만 취해 `HERO_FAILED — Node.js v24.14.0`
     *    을 남겼다. 무엇이 왜 터졌는지가 통째로 사라진 것이다.
     */
    return { ok: false, stage, why: `${stage}: ${err?.name ?? 'Error'} — ${String(err?.message ?? '').split('\n')[0].slice(0, 200)}` }
  } finally {
    // 🔴 성공·실패·예외 모두에서 **내가 연 탭만** 닫는다. Chrome 자체는 끊기만 한다.
    await page?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }
}

function help() {
  console.log(`hero 생성 — ChatGPT 이미지 → 1200×675 webp → article-draft.ts 주입

  node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…여성"
  node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --write
  node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --prompt "장면 서술" --write
  node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --force --write
  node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --allow-optional
  node scripts/magazine-hero-runner.mjs --slug <slug> --alt "…" --json

🔴 기본은 dry-run. --write 를 명시해야만 파일을 쓴다.
🔴 imageMode=OPTIONAL 은 만들지 않는다 — --allow-optional 을 사람이 붙인다.
🔴 hero 가 이미 있으면 BLOCKED. 덮어쓰려면 --force.
🔴 등록 게이트를 열지 않는다 — hero 를 만드는 것과 등록 판정은 별개다.

alt
  "…여성" 으로 끝내고 화면에 무엇이 있는지 적는다 (등록 17건이 전부 그 형태다).
  10~120자.

장면
  --prompt 가 없으면 cluster 로 기본 장면을 고른다. 병원·가운·약·검사 장비·
  화면 내 텍스트·20~30 대·서양인·노인 연출은 프롬프트가 항상 금지한다.

Chrome
  headed 로만 돈다. magazine-webui-runner.mjs --login 으로 띄운 창을 재사용한다.`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()
  /**
   * 🔴 **시험 주입은 큐·파일·Chrome 을 건드리기 전에 판정한다.** 운영 모드에서 fixture 가 보이면 여기서 끝난다.
   */
  const harness = await loadTestHarness()
  if (!harness.ok) {
    console.error(`⛔ ${harness.code} — ${harness.why} (파일 변경 0 · Chrome 접근 0)`)
    process.exit(2)
  }
  const deps = harness.test ? { generate: harness.deps.generateImage, trace: harness.deps.heroTrace ?? (() => {}) } : {}

  const arg = (k) => {
    const i = argv.indexOf(k)
    return i === -1 ? undefined : argv[i + 1]
  }
  const slug = arg('--slug')
  const alt = arg('--alt')
  const scene = arg('--prompt')
  const write = argv.includes('--write')
  const force = argv.includes('--force')
  const allowOptional = argv.includes('--allow-optional')
  const asJson = argv.includes('--json')

  const queue = loadQueue()
  const p = planHero({ slug, alt, queueItem: queue.find((i) => i.slug === slug) ?? null, force, allowOptional })
  const prompt = p.verdict === 'READY' ? buildPrompt({ title: p.checks.title, cluster: p.checks.cluster, scene }) : null

  let applied = null
  if (write && p.verdict === 'READY') {
    const r = await apply(p, prompt, alt, deps)
    applied = r.ok
    if (!r.ok) {
      p.verdict = 'BLOCKED'
      p.reasons.push(r.why)
    }
  }

  const out = {
    slug: p.slug,
    verdict: p.verdict,
    mode: write ? 'write' : 'dry-run',
    applied,
    reasons: p.reasons,
    notes: p.notes,
    checks: p.checks,
    prompt,
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    printHuman(p, prompt, write, applied)
  }
  process.exit(p.verdict === 'BLOCKED' ? 1 : 0)
}

/**
 * 생성 → 변환 → 저장 → 검증 → 주입.
 * **검증에 실패하면 파일을 지운다.** 반쯤 남기면 magazine-qa 가 FAIL 을 낸다.
 * `deps` 는 시험만 넘긴다 — generate(ChatGPT 이미지) · convert(시험의 원복 반례) · trace(관찰). 기본값이 운영 경로다.
 */
export async function apply(p, prompt, alt, { generate = generateImage, convert = toHeroWebp, trace = () => {} } = {}) {
  const file = heroFilePath(p.slug)

  /**
   * 🔴 **재사용 경로 — 이미지를 만들지 않는다.**
   *    유효한 hero 가 이미 있으면 Chrome 도, ChatGPT 도 부르지 않는다.
   *    할 일은 "다시 검증하고 heroImage 4필드를 다시 주입" 뿐이다.
   */
  if (p.checks.reuseExisting) {
    trace({ stage: 'reuse', slug: p.slug })
    const check = verifyHeroFile(p.slug)
    if (!check.ok) return { ok: false, why: `기존 hero 가 검증을 통과하지 못했다 — ${check.why}` }
    if (p.checks.willInject) {
      const injected = injectHeroImage(p._meta.src, p.slug, alt)
      if (!injected.ok) return { ok: false, why: `${injected.why} (기존 hero 파일은 그대로 두었다)` }
      writeFileSync(p._meta.path, injected.text)
    }
    return { ok: true, reused: true }
  }

  trace({ stage: 'generate', slug: p.slug })
  const gen = await generate(prompt)
  if (!gen.ok) return gen

  trace({ stage: 'convert', slug: p.slug })
  const webp = await convert(gen.buffer)
  if (!webp.ok) return webp

  const hadFile = existsSync(file)
  const backup = hadFile ? readFileSync(file) : null
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, webp.buffer)

  const check = verifyHeroFile(p.slug)
  if (!check.ok) {
    if (backup) writeFileSync(file, backup)
    else rmSync(file, { force: true })
    return { ok: false, why: `hero 검증 실패 — ${check.why} (파일을 되돌렸다)` }
  }

  if (p.checks.willInject) {
    const injected = injectHeroImage(p._meta.src, p.slug, alt)
    if (!injected.ok) {
      if (backup) writeFileSync(file, backup)
      else rmSync(file, { force: true })
      return { ok: false, why: `${injected.why} (hero 파일을 되돌렸다)` }
    }
    writeFileSync(p._meta.path, injected.text)
  }
  return { ok: true }
}

function printHuman(p, prompt, write, applied) {
  const c = p.checks
  console.log('')
  console.log(`  hero 생성 — ${p.slug ?? '(slug 없음)'}`)
  console.log(`  모드     : ${write ? 'write' : 'dry-run (파일 수정 0건)'}`)
  console.log(`  imageMode: ${c.imageMode ?? '-'}${c.allowOptional ? ' · --allow-optional' : ''}`)
  console.log(`  hero     : ${c.heroExists ? (c.reuseExisting ? `있음 — 재사용 (${c.heroSize?.width}×${c.heroSize?.height})` : '🔴 이미 있음') : '없음'}${c.force ? ' · --force' : ''}`)
  console.log(`  주입     : ${c.willInject ? `article-draft.ts 에 heroImage 4필드` : '하지 않음'}`)
  console.log('')

  if (p.verdict === 'READY') {
    if (write && applied) {
      console.log('  ✅ 완료')
      console.log(`     public${c.publicPath}  ${HERO_WIDTH}×${HERO_HEIGHT} webp${c.reuseExisting ? ' (기존 파일 재사용 · 이미지 생성 0회)' : ''}`)
      if (c.willInject) console.log('     article-draft.ts 에 heroImage 주입')
    } else {
      console.log('  ✅ READY — 생성 가능')
      console.log('     변경 예정:')
      console.log(`       public${c.publicPath}   새 webp ${HERO_WIDTH}×${HERO_HEIGHT}`)
      if (c.willInject) console.log(`       drafts/magazine/${p.slug}/article-draft.ts   heroImage 4필드`)
      console.log('     실제로 쓰려면 --write')
      console.log('')
      console.log('     프롬프트:')
      for (const line of prompt.split('\n')) console.log(`       ${line}`)
    }
  } else {
    console.log('  ⛔ BLOCKED')
    for (const r of p.reasons) console.log(`     ⛔ ${r}`)
    console.log('')
    console.log('     생성하지 않는다. 파일은 그대로다.')
  }
  for (const n of p.notes) console.log(`     ℹ️  ${n}`)
  console.log('')
}

/**
 * 🔴 **프로세스가 스택만 남기고 죽지 않게 한다.** 호출부는 마지막 몇 줄만 읽는다 —
 *    그 자리에 `Node.js v24.14.0` 이 남으면 진단이 통째로 사라진다.
 */
if (process.argv[1] && process.argv[1].endsWith('magazine-hero-runner.mjs')) {
  main().catch((err) => {
    console.error(`⛔ HERO_UNEXPECTED ${err?.name ?? 'Error'} — ${String(err?.message ?? '').split('\n')[0].slice(0, 200)}`)
    process.exit(1)
  })
}
