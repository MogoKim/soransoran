#!/usr/bin/env node
/**
 * hero 생성 — ChatGPT 이미지 → 1200×675 webp → article-draft.ts 주입 (M-AUTO-5 1차)
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   md-to-draft ──▶ [hero runner] ──▶ batch-qa ──▶ register
 *                    ↑ 여기
 *
 * 🔴 **등록 게이트를 열지 않는다.**
 *    hero 가 생겨도 riskLevel=HIGH · autoEligible=false 는 그대로 막는다.
 *    hero 는 batch-qa 의 ⑥번 조건 하나일 뿐이다.
 *
 * 🔴 기본은 dry-run. `--write` 없이는 아무 파일도 쓰지 않는다.
 *
 * 🔴 imageMode=OPTIONAL 은 만들지 않는다. `--allow-optional` 을 사람이 붙여야 한다.
 *    큐 35건 중 REQUIRED 는 3건뿐이다. 나머지를 자동으로 만들면 매일 32장을
 *    쌓아 두고 아무도 보지 않는다.
 *
 * 🔴 headed Chrome 으로만 돈다. headless 는 Cloudflare 가 막는다.
 *    `magazine-webui-runner.mjs --login` 으로 띄운 창을 재사용한다.
 *
 * 왜 Chrome 으로 webp 를 만드는가
 *    이 환경에는 cwebp · ImageMagick · sharp · vips · PIL 이 없고 ffmpeg 에는
 *    libwebp 인코더가 빠져 있다. sips 는 webp 출력을 못 한다. 실측으로 확인했다.
 *    **webp 를 만들 수 있는 수단이 Chrome 뿐이다** — 어차피 CDP 로 붙어 있으니
 *    canvas.toDataURL('image/webp') 로 리사이즈와 인코딩을 한 번에 한다.
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
import { CDP_URL, ensurePageTarget, CDP_CONNECT_TIMEOUT_MS } from './lib/chatgpt-session.mjs'
import {
  planHero, buildPrompt, injectHeroImage, verifyHeroFile,
  heroFilePath, heroPublicPath, HERO_WIDTH, HERO_HEIGHT,
} from './lib/magazine-hero.mjs'

const CHATGPT_URL = 'https://chatgpt.com/'
const GENERATE_TIMEOUT_MS = 360000
const WEBP_QUALITY = 0.82

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
  const tab = await ensurePageTarget()
  if (!tab.ok) return { ok: false, why: 'CHROME_NOT_RUNNING — magazine-webui-runner.mjs --login 으로 창을 띄운다' }

  const browser = await (await chromium()).connectOverCDP(CDP_URL, { timeout: CDP_CONNECT_TIMEOUT_MS })
  const ctx = browser.contexts()[0]
  if (!ctx) return { ok: false, why: 'no_context' }
  const page = await ctx.newPage()

  try {
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#prompt-textarea', { timeout: 60000 })
    await page.click('#prompt-textarea')
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
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

/** PNG 버퍼 → 1200×675 webp 버퍼. Chrome 내장 인코더를 쓴다 */
async function toHeroWebp(pngBuffer) {
  const browser = await (await chromium()).connectOverCDP(CDP_URL, { timeout: CDP_CONNECT_TIMEOUT_MS })
  const ctx = browser.contexts()[0]
  const page = await ctx.newPage()
  try {
    await page.goto('about:blank')
    const out = await page.evaluate(
      async ({ b64, w, h, q }) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + b64
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const g = canvas.getContext('2d')
        g.imageSmoothingEnabled = true
        g.imageSmoothingQuality = 'high'
        g.drawImage(img, 0, 0, w, h)
        const url = canvas.toDataURL('image/webp', q)
        return { type: url.slice(5, url.indexOf(';')), data: url.split(',')[1] }
      },
      { b64: pngBuffer.toString('base64'), w: HERO_WIDTH, h: HERO_HEIGHT, q: WEBP_QUALITY },
    )
    if (out.type !== 'image/webp') return { ok: false, why: `webp 인코딩 미지원 — ${out.type}` }
    return { ok: true, buffer: Buffer.from(out.data, 'base64') }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
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
🔴 등록 게이트를 열지 않는다 — HIGH · autoEligible=false 는 그대로 막힌다.

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
    const r = await apply(p, prompt, alt)
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
 */
async function apply(p, prompt, alt) {
  const gen = await generateImage(prompt)
  if (!gen.ok) return gen

  const webp = await toHeroWebp(gen.buffer)
  if (!webp.ok) return webp

  const file = heroFilePath(p.slug)
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
  console.log(`  hero     : ${c.heroExists ? '🔴 이미 있음' : '없음'}${c.force ? ' · --force' : ''}`)
  console.log(`  주입     : ${c.willInject ? `article-draft.ts 에 heroImage 4필드` : '하지 않음'}`)
  console.log('')

  if (p.verdict === 'READY') {
    if (write && applied) {
      console.log('  ✅ 완료')
      console.log(`     public${c.publicPath}  ${HERO_WIDTH}×${HERO_HEIGHT} webp`)
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

if (process.argv[1] && process.argv[1].endsWith('magazine-hero-runner.mjs')) main()
