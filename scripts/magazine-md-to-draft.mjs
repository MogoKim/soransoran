#!/usr/bin/env node
/**
 * ChatGPT 마크다운 원고 → article-draft.ts 변환
 *
 * ⚠️ 이 스크립트는 원고를 쓰지 않는다 (매거진 전략 §3.0).
 *    최종 원고는 ChatGPT 가 쓴다. 여기서는 형식만 바꾼다.
 *    규칙에 없는 요소가 나오면 **추측해서 변환하지 않고 FAIL** 한다.
 *    추측하는 순간 Claude Code 가 원고에 개입한 것이 된다.
 *
 * 입력 규칙 (brief 템플릿이 ChatGPT 에게 강제한다)
 *   YAML frontmatter   title · description · cluster · medical · seriesId · seriesOrder
 *   ##                 h2
 *   ###                h3
 *   >                  callout
 *   -                  list
 *   [CTA] href | label | text
 *   그 외 문단          p
 *
 * FAIL 대상: 표 · 코드블록 · 외부 링크 · 마크다운 이미지 · h1 · HTML 태그
 *
 * 사용법
 *   node scripts/magazine-md-to-draft.mjs --in <원고.md> --out <article-draft.ts>
 *   node scripts/magazine-md-to-draft.mjs --in <원고.md>            # 검사만 (파일 안 씀)
 *   node scripts/magazine-md-to-draft.mjs --help
 *
 * 종료 코드: 규칙 위반이 있으면 1, 아니면 0
 * 네트워크 · LLM 호출 0 · 파일 쓰기는 --out 1곳만.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, isAbsolute, relative } from 'node:path'
import { parseFrontmatter, parseBody, describeFormatViolation } from './lib/magazine-manuscript-format.mjs'

const ROOT = process.cwd()
const DRAFTS_DIR = join(ROOT, 'drafts')

/**
 * 🔴 판정(frontmatter · 본문 · 금지 표기 · CTA 1개)은 `lib/magazine-manuscript-format.mjs` 가 정본이다.
 *    원고 관문과 auto-register 도 같은 함수를 쓴다 — 여기서 규칙을 다시 적지 않는다 (2026-10-08).
 */

// ── 출력 ───────────────────────────────────────────────────

/** 작은따옴표 문자열로 안전하게 감싼다 */
function q(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function renderDraft(meta, blocks, sourceName) {
  const L = []
  L.push('/**')
  L.push(` * ChatGPT 원고를 변환한 draft — 결정론적 QA 입력.`)
  L.push(' *')
  L.push(` * 원본: ${sourceName}`)
  L.push(' * 변환: scripts/magazine-md-to-draft.mjs (형식 변환만. 문장은 손대지 않았다)')
  L.push(' * 승인 후 src/content/magazine/articles.ts 로 옮긴다.')
  L.push(' */')
  L.push("import type { MagazineArticleBody } from '@/content/magazine/types'")
  L.push('')
  L.push('export const DRAFT: MagazineArticleBody = {')
  L.push(`  title: ${q(meta.title)},`)
  L.push('  description:')
  L.push(`    ${q(meta.description)},`)
  L.push(`  cluster: ${q(meta.cluster)},`)
  L.push("  // 발행일은 창업자가 확정한다")
  L.push(`  publishedAt: '',`)
  if (meta.medical) L.push('  medical: true,')
  if (meta.seriesId) {
    L.push(`  seriesId: ${q(meta.seriesId)},`)
    L.push(`  seriesOrder: ${meta.seriesOrder},`)
  }
  L.push('')
  L.push('  // heroImage 는 이미지 회수 후 채운다')
  L.push('')
  L.push('  body: [')

  for (const block of blocks) {
    if (block.type === 'list') {
      L.push('    {')
      L.push("      type: 'list',")
      L.push('      items: [')
      for (const item of block.items) L.push(`        ${q(item)},`)
      L.push('      ],')
      L.push('    },')
    } else if (block.type === 'cta') {
      L.push('    {')
      L.push("      type: 'cta',")
      L.push(`      href: ${q(block.href)},`)
      L.push(`      label: ${q(block.label)},`)
      if (block.text) L.push(`      text: ${q(block.text)},`)
      L.push('    },')
    } else {
      L.push('    {')
      L.push(`      type: ${q(block.type)},`)
      L.push(`      text: ${q(block.text)},`)
      L.push('    },')
    }
  }

  L.push('  ],')
  L.push('}')
  return L.join('\n')
}

// ── CLI ────────────────────────────────────────────────────

const USAGE = `
매거진 마크다운 → article-draft.ts 변환

  node scripts/magazine-md-to-draft.mjs --in <원고.md> --out <article-draft.ts>
  node scripts/magazine-md-to-draft.mjs --in <원고.md>          검사만 (파일 안 씀)
  node scripts/magazine-md-to-draft.mjs --help

입력 규칙
  frontmatter   title · description · cluster · medical · seriesId · seriesOrder
  ##            h2
  ###           h3
  >             callout
  -             list
  [CTA] href | label | text
  그 외 문단     p

허용하지 않음 (발견 시 변환 중단)
  표 · 코드블록 · 외부 링크 · 마크다운 이미지 · h1 · h4 이하 · HTML · 번호 목록

--out 은 drafts/ 하위만 허용한다.
`

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    process.exit(0)
  }

  const inFlag = args.indexOf('--in')
  if (inFlag === -1 || !args[inFlag + 1]) {
    console.error('--in <원고.md> 가 필요하다. 사용법은 --help')
    process.exit(2)
  }

  const inPath = isAbsolute(args[inFlag + 1]) ? args[inFlag + 1] : join(ROOT, args[inFlag + 1])
  if (!existsSync(inPath)) {
    console.error(`입력 파일이 없다: ${args[inFlag + 1]}`)
    process.exit(2)
  }

  const source = readFileSync(inPath, 'utf8')
  const lines = source.split('\n')
  const errors = []

  const { meta, bodyStart } = parseFrontmatter(lines, errors)
  const blocks = parseBody(lines, bodyStart, errors)

  if (errors.length > 0) {
    console.error('')
    console.error(`변환하지 않았다 — 규칙 밖 요소 ${errors.length}건`)
    console.error('')
    for (const e of errors) console.error(`  ✗ ${describeFormatViolation(e)}`)
    console.error('')
    console.error('  ChatGPT 에게 brief 의 마크다운 규칙을 다시 지켜 달라고 요청한다.')
    console.error('  여기서 추측해서 고치지 않는다 — 그건 원고에 개입하는 것이다.')
    console.error('')
    process.exit(1)
  }

  const output = renderDraft(meta, blocks, relative(ROOT, inPath))

  const outFlag = args.indexOf('--out')
  if (outFlag !== -1 && args[outFlag + 1]) {
    const outArg = args[outFlag + 1]
    const outPath = isAbsolute(outArg) ? outArg : join(ROOT, outArg)
    if (!resolve(outPath).startsWith(DRAFTS_DIR)) {
      console.error('--out 은 drafts/ 하위 경로만 허용한다')
      process.exit(2)
    }
    writeFileSync(outPath, `${output}\n`, 'utf8')
    console.log(`변환 완료: ${relative(ROOT, outPath)} (블록 ${blocks.length}개)`)
  } else {
    console.log(output)
  }
  process.exit(0)
}

/**
 * 🔴 **직접 실행할 때만 돈다.** 이 파일은 파일을 쓴다 —
 *    판정 함수를 빌리려고 import 한 쪽이 실제 회차를 돌리면 안 된다.
 *    (2026-09-15: magazine-producer-plan.mjs 가 그 상태로 _runs 를 통째로 만들었다)
 */
if (process.argv[1] && process.argv[1].endsWith('magazine-md-to-draft.mjs')) main()
