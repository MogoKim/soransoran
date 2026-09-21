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
 * 🔴 **`--write` 에는 `--slug` 가 반드시 따라붙는다** (2026-09-21).
 *
 *    이 도구는 **사고 복구용**이다. 빠진 글을 한꺼번에 메우라고 만든 것이 아니다.
 *    `--write` 만으로 "누락된 전부" 를 고치게 두면, 손이 미끄러진 한 번에
 *    수십 건의 발행본이 사람 확인 없이 바뀐다 — 대표 이미지는 독자가 가장 먼저
 *    보는 것이고, 엉뚱한 그림이 붙으면 글보다 먼저 신뢰를 깎는다.
 *
 *    실제로 이번 8건은 **alt 가 그림과 달랐다.** 자동으로 붙인 문구를 사람이
 *    이미지와 대조하고서야 맞출 수 있었다. 그 대조를 건너뛸 수 있는 손잡이를
 *    남겨 두지 않는다. 고칠 글을 이름으로 적게 한다.
 *
 * 사용법
 *   node scripts/magazine-hero-backfill.mjs                     무엇이 바뀔지만 본다 (전체)
 *   node scripts/magazine-hero-backfill.mjs --slug a,b          그 글만 미리 본다
 *   node scripts/magazine-hero-backfill.mjs --slug a,b --write  🔴 실제로 넣는다
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTICLES_TS, DRAFTS_DIR, evalLiteral, loadArticles, sliceLiteral } from './lib/magazine-load.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/**
 * `--write` 를 받아도 되는가. **파일을 만지지 않는다.**
 *
 * 🔴 대상을 이름으로 적지 않은 일괄 쓰기를 막는다 (2026-09-21).
 *    dry-run 은 전체를 봐도 된다 — 보는 것은 아무것도 바꾸지 않는다.
 *
 * @returns {{ok:boolean, code:string, message:string}}
 */
export function judgeWriteScope({ write, slugs }) {
  if (!write) return { ok: true, code: 'DRY_RUN', message: 'dry-run — 무엇이 바뀔지만 본다' }
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return {
      ok: false,
      code: 'SLUG_REQUIRED',
      message: '--write 에는 --slug 가 필요하다 — 고칠 글을 이름으로 적는다 (일괄 수정은 막는다)',
    }
  }
  return { ok: true, code: 'SCOPED', message: `대상 ${slugs.length}건: ${slugs.join(', ')}` }
}

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

  // 🔴 대상을 이름으로 적지 않은 일괄 쓰기를 막는다
  const scope = judgeWriteScope({ write, slugs: only })
  if (!scope.ok) {
    console.error(`\n  🔴 ${scope.code}: ${scope.message}\n`)
    console.error('  예) node scripts/magazine-hero-backfill.mjs --slug dry-mouth-menopause --write\n')
    process.exit(2)
  }

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
