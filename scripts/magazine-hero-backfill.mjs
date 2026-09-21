#!/usr/bin/env node
/**
 * 이미 등록된 글에 **대표 이미지만** 이어 붙인다.
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-21 사고).
 *
 *    9/19~9/26 등록 글 8건이 전부 대표 이미지 없이 main 에 들어갔다.
 *    `magazine-hero-runner.mjs` 는 `drafts/<slug>/article-draft.ts` 에 주입하는데,
 *    그 글들은 **이미 `articles.ts` 로 옮겨진 뒤**였다. 초안을 고쳐도 발행본은 그대로다.
 *
 * 🔴 **대표 이미지 필드만 넣는다.** 본문·제목·publishAt·status 어느 것도 건드리지 않는다.
 *    사고를 메우려다 발행 내용을 바꾸면 그것은 더 큰 사고다.
 *
 * 🔴 **이미 있으면 건너뛴다.** 덮어쓰지 않는다 — 사람이 고른 이미지를 밀어내지 않는다.
 * 🔴 **파일이 실제로 있을 때만 넣는다.** 경로만 적고 그림이 없으면 독자에게는 깨진 이미지다.
 * 🔴 기본은 dry-run. `--write` 를 명시해야 쓴다.
 *
 * 사용법
 *   node scripts/magazine-hero-backfill.mjs              무엇이 바뀔지만 본다
 *   node scripts/magazine-hero-backfill.mjs --write      실제로 넣는다
 *   node scripts/magazine-hero-backfill.mjs --slug a,b   특정 글만
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTICLES_TS, DRAFTS_DIR, evalLiteral, loadArticles, sliceLiteral } from './lib/magazine-load.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/**
 * 초안(`article-draft.ts`)에서 대표 이미지를 읽는다.
 * 🔴 초안 전체를 가져오지 않는다 — heroImage 만이다.
 */
export function heroFromDraft(slug, { draftsDir = DRAFTS_DIR } = {}) {
  const file = join(draftsDir, slug, 'article-draft.ts')
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  const at = src.indexOf('heroImage')
  if (at === -1) return null
  const literal = sliceLiteral(src, src.indexOf(':', at), '{', '}')
  if (!literal) return null
  try {
    const hero = evalLiteral(literal, `${slug}/article-draft.ts`)
    return hero?.src ? hero : null
  } catch { return null }
}

/**
 * 이 글에 대표 이미지를 넣어도 되는가. **파일을 만지지 않는다.**
 *
 * @returns {{action:'INSERT'|'SKIP'|'BLOCKED', code:string, message:string, hero:object|null}}
 */
export function judgeBackfill({ article, hero, heroFileExists }) {
  if (article?.heroImage?.src) {
    return { action: 'SKIP', code: 'ALREADY_SET', message: `이미 대표 이미지가 있다 (${article.heroImage.src})`, hero: null }
  }
  if (!hero?.src) {
    return { action: 'BLOCKED', code: 'NO_HERO_IN_DRAFT', message: '초안에 대표 이미지가 없다 — 먼저 hero-runner 로 만든다', hero: null }
  }
  // 🔴 경로만 있고 그림이 없으면 넣지 않는다. 깨진 이미지가 더 나쁘다.
  if (!heroFileExists) {
    return { action: 'BLOCKED', code: 'HERO_FILE_ABSENT', message: `이미지 파일이 없다 (public${hero.src})`, hero: null }
  }
  for (const f of ['alt', 'width', 'height']) {
    if (hero[f] === undefined || hero[f] === null || hero[f] === '') {
      return { action: 'BLOCKED', code: 'HERO_INCOMPLETE', message: `대표 이미지에 ${f} 가 없다`, hero: null }
    }
  }
  return { action: 'INSERT', code: 'READY', message: `대표 이미지를 넣는다 (${hero.src})`, hero }
}

/**
 * `articles.ts` 원문에 heroImage 한 필드를 끼워 넣는다.
 *
 * 🔴 **그 글의 열린 중괄호 바로 다음 줄에 넣는다.** 다른 줄은 한 글자도 건드리지 않는다.
 * 🔴 정규식으로 통째로 갈아 끼우지 않는다 — 본문에 중괄호가 있으면 경계를 놓친다.
 */
export function insertHero(source, slug, hero) {
  const key = `'${slug}':`
  const at = source.indexOf(key)
  if (at === -1) return { ok: false, reason: `${slug} 를 articles.ts 에서 찾지 못했다`, source }
  const brace = source.indexOf('{', at)
  if (brace === -1) return { ok: false, reason: `${slug} 의 객체 시작을 찾지 못했다`, source }
  if (source.slice(at, brace + 1).includes('heroImage')) {
    return { ok: false, reason: `${slug} 에 이미 heroImage 가 있다`, source }
  }
  // 들여쓰기를 그 글의 다음 줄에서 그대로 빌려 온다
  const nl = source.indexOf('\n', brace)
  const indent = (source.slice(nl + 1).match(/^[ \t]*/) ?? [''])[0] || '    '
  const block = [
    `${indent}heroImage: {`,
    `${indent}  src: '${hero.src}',`,
    `${indent}  alt: ${JSON.stringify(hero.alt)},`,
    `${indent}  width: ${hero.width},`,
    `${indent}  height: ${hero.height},`,
    `${indent}},`,
  ].join('\n')
  return { ok: true, reason: null, source: `${source.slice(0, nl + 1)}${block}\n${source.slice(nl + 1)}` }
}

function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const only = argv.includes('--slug') ? String(argv[argv.indexOf('--slug') + 1] ?? '').split(',').filter(Boolean) : null

  const articles = loadArticles()
  const targets = articles.filter((a) => (only ? only.includes(a.slug) : !a.heroImage?.src))
  console.log(`\n  대표 이미지 보정 — ${write ? '🔴 실제 적용' : 'dry-run (변경 0)'}`)
  console.log(`  대상 ${targets.length}건\n`)

  let source = readFileSync(ARTICLES_TS, 'utf8')
  let inserted = 0
  let blocked = 0

  for (const a of targets) {
    const hero = heroFromDraft(a.slug)
    const fileOk = Boolean(hero?.src) && existsSync(join(ROOT, 'public', hero.src.replace(/^\//, '')))
    const v = judgeBackfill({ article: a, hero, heroFileExists: fileOk })
    const mark = v.action === 'INSERT' ? '✅' : v.action === 'SKIP' ? '·' : '⛔'
    console.log(`  ${mark} ${a.slug.padEnd(34)} ${v.message}`)
    if (v.action === 'BLOCKED') blocked += 1
    if (v.action !== 'INSERT') continue
    const r = insertHero(source, a.slug, v.hero)
    if (!r.ok) { console.log(`     ⛔ ${r.reason}`); blocked += 1; continue }
    source = r.source
    inserted += 1
  }

  if (write && inserted > 0) {
    writeFileSync(ARTICLES_TS, source, 'utf8')
    console.log(`\n  ✅ ${inserted}건에 대표 이미지를 넣었다 — 본문·날짜는 건드리지 않았다`)
  } else if (inserted > 0) {
    console.log(`\n  ${inserted}건이 대상이다 — 실제 적용은 --write`)
  }
  if (blocked > 0) console.log(`  🔴 막힌 건 ${blocked}건`)
  console.log('')
  process.exit(blocked > 0 ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-hero-backfill.mjs')) main()
