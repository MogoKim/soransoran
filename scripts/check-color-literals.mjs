#!/usr/bin/env node
/**
 * 색상 리터럴 가드
 *
 * 정본 §3-4 원칙 1·2:
 *   색 리터럴은 토큰 정의 파일(globals.css)에만 존재한다.
 *   컴포넌트는 semantic token 만 쓴다.
 *
 * 우나어 반례: 토큰이 있는데도 코랄 리터럴이 39개 파일에 흩어져
 * 컬러 변경이 1줄 수정이 아니라 39파일 추적이 되었다.
 * 소란소란은 #FF6F61 을 임시 채택했으므로, 리터럴이 흩어지면 교체가 불가능해진다.
 *
 * 🔴 .ts/.tsx 는 정규식으로 주석을 지우지 않는다. TypeScript 로 구문 분석한다.
 *    `line.indexOf('//')` 방식은 문자열 안의 `https://` 를 주석 시작으로 오인해
 *    그 뒤에 있는 값을 통째로 놓친다. 한 줄에 블록 주석이 두 개인 경우도 어긋난다.
 *    파서는 문자열과 주석을 이미 정확히 구분하고, 주석은 AST 노드가 아니라
 *    순회 대상에서 자연히 빠진다. (check-brand-literals.mjs 와 같은 판단이다)
 *
 * 🔴 CSS 에는 `//` 주석이 없다. 블록 주석만 걷어내면 되고, 문자열 개념이 없는
 *    CSS 에서 그 처리는 안전하다 — 여기서만 수동 파싱을 쓴다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const TARGET = join(ROOT, 'src')

/**
 * 색 리터럴 정의가 허용되는 파일 — 이 둘이 색상의 SSoT 다.
 * globals.css = 화면에 그려지는 색 / brand.ts = metadata·manifest·next/og 전용
 */
const ALLOWED = new Set(['src/app/globals.css', 'src/lib/brand.ts'])

/**
 * 검사에서 빼는 경로.
 *
 * 🔴 admin 만 뺀다. 운영자 화면은 리브랜딩 대상이 아니다.
 *    이 목록을 넓히면 고객면이 함께 빠져나가므로 늘리지 않는다.
 *    (카카오 색은 경로가 아니라 globals.css 토큰으로 격리돼 있다 — §4)
 */
const EXCLUDED_PREFIXES = ['src/app/admin/', 'src/components/admin/']

/**
 * 경로로는 못 거르는 admin 전용 파일 — 파일 단위로 명시한다.
 *
 * 🔴 파일명에 admin 이 들어간다고 빼지 않는다. import 처로 판정했다.
 *    original-post-admin.ts 는 src/app/admin/original-post-candidates/ 두 화면에서만
 *    import 되는 검수 화면 보조 모듈이다(배지 색 3종).
 *
 * 🔴 이 목록의 파일이 고객면에서 import 되기 시작하면 제외가 틀린 것이다.
 *    늘릴 때는 반드시 import 처를 먼저 확인한다 — 넓히면 고객면이 함께 빠져나간다.
 */
const EXCLUDED_FILES = new Set(['src/lib/original-post-admin.ts'])

/** Tailwind 유틸 접두어 / 기본 팔레트 색 이름 */
const TW_UTIL =
  'bg|text|border|ring|fill|stroke|shadow|from|to|via|divide|outline|accent|caret|decoration|placeholder'
const TW_HUE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'

const PATTERNS = [
  { name: 'hex', re: /#[0-9a-fA-F]{3,8}\b/g },
  // rgb(…) · rgba(…) · hsl(…) · hsla(…) — 공백/쉼표 표기 모두
  { name: 'rgb/hsl', re: /\b(?:rgba?|hsla?)\s*\(/g },
  // Tailwind arbitrary color — 대괄호 안에 실제 색이 든 것만
  {
    name: 'arbitrary color',
    re: new RegExp(`(?:${TW_UTIL})-\\[[^\\]]*(?:#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()[^\\]]*\\]`, 'g'),
  },
  // Tailwind 기본 팔레트 — 고객면에서는 semantic token 을 쓴다
  {
    name: 'tailwind palette',
    re: new RegExp(
      `\\b(?:${TW_UTIL})-(?:${TW_HUE})-(?:50|100|200|300|400|500|600|700|800|900|950)\\b`,
      'g',
    ),
  },
]

function isSkipped(rel) {
  return (
    ALLOWED.has(rel) ||
    EXCLUDED_FILES.has(rel) ||
    EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))
  )
}

function match(text) {
  const hits = []
  for (const { name, re } of PATTERNS) {
    for (const m of text.match(re) ?? []) hits.push({ name, hit: m })
  }
  return hits
}

/**
 * .ts/.tsx — 사람이 쓴 문자열·template 텍스트·JSX 텍스트만 본다.
 * inline style 의 색도 결국 StringLiteral 이라 함께 걸린다.
 */
function scanTs(rel, text) {
  const sf = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const hits = []
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.JsxText: {
        const value = node.text ?? ''
        if (value) {
          const found = match(value)
          if (found.length) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
            for (const h of found) hits.push({ rel, line: line + 1, ...h })
          }
        }
        break
      }
      default:
        break
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** .css — 블록 주석만 걷어낸다 (한 줄에 여러 개여도 전부 처리한다) */
function scanCss(rel, text) {
  const hits = []
  let inBlock = false
  text.split('\n').forEach((raw, i) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) return
      inBlock = false
      line = line.slice(end + 2)
    }
    for (;;) {
      const open = line.indexOf('/*')
      if (open === -1) break
      const close = line.indexOf('*/', open + 2)
      if (close === -1) {
        inBlock = true
        line = line.slice(0, open)
        break
      }
      line = line.slice(0, open) + line.slice(close + 2)
    }
    if (!line.trim()) return
    for (const h of match(line)) hits.push({ rel, line: i + 1, ...h })
  })
  return hits
}

/** 한 파일 검사. 파일 시스템을 건드리지 않으므로 self-test 가 그대로 쓴다 */
function scan(rel, text) {
  if (isSkipped(rel)) return []
  return rel.endsWith('.css') ? scanCss(rel, text) : scanTs(rel, text)
}

/** self-test — 파일을 만들지 않고 문자열만으로 가드 자신을 검증한다 */
function selfTest() {
  const cases = [
    // --- 잡아야 하는 것 ---
    { why: 'hex 리터럴', rel: 'src/components/X.tsx', src: "const c = '#ff6f61'", expect: 1 },
    { why: 'inline style 의 hex', rel: 'src/components/X.tsx', src: "const a = <p style={{ color: '#fff' }} />", expect: 1 },
    { why: 'rgba()', rel: 'src/components/X.tsx', src: "const c = 'rgba(0,0,0,0.08)'", expect: 1 },
    { why: 'hsl()', rel: 'src/components/X.tsx', src: "const c = 'hsl(10 20% 30%)'", expect: 1 },
    { why: 'Tailwind 기본 팔레트', rel: 'src/components/X.tsx', src: "const c = 'bg-gray-100'", expect: 1 },
    { why: 'SVG fill 하드코딩', rel: 'src/components/X.tsx', src: 'const a = <svg><path fill="#000000" /></svg>', expect: 1 },
    { why: 'URL 뒤 같은 줄의 hex (// 오인 금지)', rel: 'src/components/X.tsx', src: "const u = 'https://a.com'; const c = '#ff6f61'", expect: 1 },
    { why: '코드+블록주석+코드 한 줄', rel: 'src/components/X.tsx', src: "const c = '#ff6f61'; /* #000000 은 주석 */ const d = 1", expect: 1 },
    { why: 'CSS — 블록 주석 두 개여도 주석 밖만', rel: 'src/x.css', src: '/* #000 */ .a { color: #ff6f61; } /* #111 */', expect: 1 },
    { why: '고객면 컴포넌트는 제외되지 않는다', rel: 'src/components/features/X.tsx', src: "const c = '#ff6f61'", expect: 1 },

    // --- 잡으면 안 되는 것 ---
    { why: '라인 주석은 무시', rel: 'src/components/X.tsx', src: '// #ff6f61 은 브랜드색', expect: 0 },
    { why: '블록 주석은 무시', rel: 'src/components/X.tsx', src: '/* #ff6f61\n * rgba(0,0,0,0.1)\n */', expect: 0 },
    { why: 'semantic token 은 무시', rel: 'src/components/X.tsx', src: "const c = 'bg-surface-card text-content-primary shadow-toast'", expect: 0 },
    { why: 'CSS 변수 참조는 무시', rel: 'src/components/X.tsx', src: 'const a = <p style={{ color: `var(--brand)` }} />', expect: 0 },
    { why: 'admin 은 제외', rel: 'src/app/admin/x/page.tsx', src: "const c = 'bg-gray-100'", expect: 0 },
    { why: 'admin 컴포넌트도 제외', rel: 'src/components/admin/X.tsx', src: "const c = '#ff6f61'", expect: 0 },
    { why: '정본 globals.css 는 허용', rel: 'src/app/globals.css', src: ':root { --brand: #ff6f61; }', expect: 0 },
    { why: '정본 brand.ts 는 허용', rel: 'src/lib/brand.ts', src: "export const BRAND = { color: '#ff6f61' }", expect: 0 },
    { why: 'admin 전용 lib 파일은 명시 제외', rel: 'src/lib/original-post-admin.ts', src: "const c = 'bg-amber-50'", expect: 0 },
    { why: '다른 lib 파일은 제외되지 않는다', rel: 'src/lib/other.ts', src: "const c = 'bg-amber-50'", expect: 1 },
  ]

  const failed = []
  for (const c of cases) {
    const got = scan(c.rel, c.src).length
    if (got !== c.expect) failed.push({ ...c, got })
  }
  // arbitrary color 는 hex/rgb 패턴과 함께 잡히므로 건수 대신 "잡히는가" 로 본다
  const arb = scan('src/components/X.tsx', "const c = 'shadow-[0_4px_16px_rgb(47_38_36_/_0.12)]'")
  if (!arb.some((h) => h.name === 'arbitrary color')) {
    failed.push({ why: 'Tailwind arbitrary color', rel: '-', expect: '검출', got: '미검출' })
  }
  if (failed.length) {
    console.error('🔴 색상 가드 self-test 실패 — 가드 자신이 고장났습니다:\n')
    for (const f of failed) console.error(`  ${f.why}\n    ${f.rel}  기대 ${f.expect}건, 실제 ${f.got}건`)
    process.exit(1)
  }
  return cases.length + 1
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p)
  }
  return out
}

const selfTestCount = selfTest()

const violations = []
for (const file of walk(TARGET)) {
  violations.push(...scan(relative(ROOT, file), readFileSync(file, 'utf8')))
}

if (violations.length) {
  console.error('색상 리터럴이 토큰 정의 파일 밖에서 발견되었습니다:\n')
  for (const v of violations) console.error(`  ${v.rel}:${v.line}  [${v.name}] ${v.hit}`)
  console.error(`\n총 ${violations.length}건. semantic token 으로 교체하세요.`)
  process.exit(1)
}

console.log(`색상 리터럴 가드 통과 — 토큰 정의 파일 외 0건 (self-test ${selfTestCount}건 통과)`)
