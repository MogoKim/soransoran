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

const ROOT = process.cwd()
const DRAFTS_DIR = join(ROOT, 'drafts')

/** frontmatter 에서 받는 값. 그 외 키가 오면 FAIL */
const ALLOWED_META = new Set([
  'title',
  'description',
  'cluster',
  'medical',
  'seriesId',
  'seriesOrder',
])
const REQUIRED_META = ['title', 'description', 'cluster']

/** 규칙 밖 요소 — 발견 즉시 FAIL 한다 */
const FORBIDDEN = [
  { re: /^\s*\|.*\|\s*$/, why: '표는 허용하지 않는다' },
  { re: /^\s*```/, why: '코드블록은 허용하지 않는다' },
  { re: /^#\s/, why: 'h1 은 페이지가 렌더한다. 본문에 두지 않는다' },
  { re: /^#{4,}\s/, why: 'h4 이하는 허용하지 않는다 (h2 · h3 만)' },
  { re: /!\[[^\]]*\]\([^)]*\)/, why: '마크다운 이미지는 허용하지 않는다' },
  { re: /https?:\/\//, why: '외부 링크는 허용하지 않는다' },
  { re: /<\/?[a-zA-Z][^>]*>/, why: 'HTML 태그는 허용하지 않는다' },
  { re: /^\s*\d+\.\s/, why: '번호 목록은 허용하지 않는다 (- 만 쓴다)' },
]

// ── frontmatter ────────────────────────────────────────────

function parseFrontmatter(lines, errors) {
  if (lines[0]?.trim() !== '---') {
    errors.push({ line: 1, why: 'YAML frontmatter 가 없다. --- 로 시작해야 한다' })
    return { meta: {}, bodyStart: 0 }
  }

  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end === -1) {
    errors.push({ line: 1, why: 'frontmatter 가 닫히지 않았다' })
    return { meta: {}, bodyStart: 0 }
  }

  const meta = {}
  for (let i = 1; i < end; i += 1) {
    const raw = lines[i]
    if (!raw.trim()) continue

    const sep = raw.indexOf(':')
    if (sep === -1) {
      errors.push({ line: i + 1, why: `frontmatter 형식이 아니다: ${raw.trim()}` })
      continue
    }

    const key = raw.slice(0, sep).trim()
    const value = raw.slice(sep + 1).trim().replace(/^["']|["']$/g, '')

    if (!ALLOWED_META.has(key)) {
      errors.push({ line: i + 1, why: `허용되지 않은 frontmatter 키: ${key}` })
      continue
    }
    if (key === 'medical') meta[key] = value === 'true'
    else if (key === 'seriesOrder') meta[key] = Number(value)
    else meta[key] = value
  }

  for (const key of REQUIRED_META) {
    if (!meta[key]) errors.push({ line: 1, why: `frontmatter 에 ${key} 가 없다` })
  }
  if (meta.seriesId && meta.seriesOrder === undefined) {
    errors.push({ line: 1, why: 'seriesId 가 있으면 seriesOrder 도 필요하다' })
  }
  if (meta.seriesOrder !== undefined && Number.isNaN(meta.seriesOrder)) {
    errors.push({ line: 1, why: 'seriesOrder 가 숫자가 아니다' })
  }

  return { meta, bodyStart: end + 1 }
}

// ── 본문 ───────────────────────────────────────────────────

/**
 * 줄 단위로 읽어 블록을 만든다.
 * 판단이 갈리는 자리를 만들지 않는 것이 이 함수의 목표다 — 규칙에 없으면 FAIL.
 */
function parseBody(lines, bodyStart, errors) {
  const blocks = []
  let paragraph = []
  let listItems = []
  let quoteLines = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'p', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push({ type: 'list', items: [...listItems] })
    listItems = []
  }
  const flushQuote = () => {
    if (quoteLines.length === 0) return
    blocks.push({ type: 'callout', text: quoteLines.join(' ') })
    quoteLines = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (let i = bodyStart; i < lines.length; i += 1) {
    const raw = lines[i]
    const lineNo = i + 1
    const text = raw.trim()

    // CTA 는 대괄호 표기라 링크 검사보다 먼저 본다
    if (text.startsWith('[CTA]')) {
      flushAll()
      const parts = text.slice(5).split('|').map((s) => s.trim())
      if (parts.length < 2) {
        errors.push({ line: lineNo, why: '[CTA] 형식은 "href | label | text" 다' })
        continue
      }
      const [href, label, ctaText] = parts
      if (!href.startsWith('/community/')) {
        errors.push({ line: lineNo, why: `CTA href 는 /community/ 로 시작해야 한다: ${href}` })
        continue
      }
      const block = { type: 'cta', href, label }
      if (ctaText) block.text = ctaText
      blocks.push(block)
      continue
    }

    for (const rule of FORBIDDEN) {
      if (rule.re.test(raw)) {
        errors.push({ line: lineNo, why: `${rule.why} — "${text.slice(0, 40)}"` })
      }
    }

    if (!text) {
      flushAll()
      continue
    }

    if (text.startsWith('### ')) {
      flushAll()
      blocks.push({ type: 'h3', text: text.slice(4).trim() })
    } else if (text.startsWith('## ')) {
      flushAll()
      blocks.push({ type: 'h2', text: text.slice(3).trim() })
    } else if (text.startsWith('> ')) {
      flushParagraph()
      flushList()
      quoteLines.push(text.slice(2).trim())
    } else if (text.startsWith('- ')) {
      flushParagraph()
      flushQuote()
      listItems.push(text.slice(2).trim())
    } else {
      flushList()
      flushQuote()
      paragraph.push(text)
    }
  }
  flushAll()

  const ctaCount = blocks.filter((b) => b.type === 'cta').length
  if (ctaCount !== 1) {
    errors.push({ line: lines.length, why: `[CTA] 는 정확히 1개여야 한다 (현재 ${ctaCount}개)` })
  }

  return blocks
}

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
    for (const e of errors) console.error(`  ✗ ${e.line}행: ${e.why}`)
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
