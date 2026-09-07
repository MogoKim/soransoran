#!/usr/bin/env node
/**
 * 브랜드 리터럴 가드
 *
 * 색상 가드(check-color-literals.mjs)와 같은 이유로 존재한다.
 * 정본이 있어도 리터럴이 흩어지면 교체가 1줄 수정이 아니라 파일 추적이 된다.
 *
 * 🔴 이 가드가 지키는 것은 "리브랜딩 때 한 곳만 고치면 되는 상태"다.
 *    화면·문구에서 값을 직접 적으면 이름을 바꿀 때 그 자리가 옛 이름으로 남는다 —
 *    에러가 나지 않으므로 아무도 모른 채 배포된다. 그래서 사람이 아니라 CI 가 본다.
 *
 * 🔴 정규식으로 주석을 지우지 않는다. TypeScript 로 구문 분석한다.
 *    `line.indexOf('//')` 방식은 문자열 안의 `https://` 를 주석 시작으로 오인해,
 *    그 뒤에 있는 브랜드명을 통째로 놓친다:
 *
 *        const url = 'https://example.com'; const name = '소란소란'   // ← 놓친다
 *
 *    한 줄에 블록 주석이 두 개 있는 경우도 마찬가지로 어긋난다.
 *    주석 제거 정규식을 더 정교하게 만드는 길은 끝이 없다 —
 *    파서는 문자열과 주석을 이미 정확히 구분하므로 그쪽을 쓴다.
 *    (주석은 AST 노드가 아니라, 순회 대상에서 자연히 빠진다)
 *
 * 검사 범위는 좁게 유지한다:
 *   - 대상은 src 아래 .ts / .tsx 뿐이다. 문서와 scripts 는 보지 않는다.
 *   - admin 은 운영자 화면이라 제외한다. src/content 는 이미 발행된 과거 콘텐츠라 제외한다.
 *   - 도메인·GA·카카오 같은 외부 식별자는 이 가드의 범위가 아니다(별도 판단이 필요하다).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const TARGET = join(ROOT, 'src')

/** 검사하지 않는 경로 — 운영자 화면과 이미 발행된 콘텐츠 */
const EXCLUDED_PREFIXES = ['src/app/admin/', 'src/components/admin/', 'src/content/']

/**
 * 🔴 허용 파일은 값마다 다르다. 공통 allowlist 를 두지 않는다.
 *
 * 파일 단위로 열어 주면 "정본 파일이니까" 라는 이유로 다른 값까지 함께 들어온다.
 * 브랜드명은 리브랜딩 때 반드시 바뀌고, 문의 이메일은 메일 계정 이전과 함께 판단한다 —
 * 성격이 다른 값이 한 파일에 섞이면 그 구분이 무너진다.
 * 그래서 public-site-info.ts 의 브랜드명도, brand-name.ts 의 이메일도 위반이다.
 */
const PATTERNS = [
  {
    name: '브랜드명',
    re: /소란소란/g,
    owner: 'src/lib/brand-name.ts',
    fix: 'BRAND_NAME (src/lib/brand-name.ts)',
  },
  {
    name: '문의 이메일',
    re: /soransoran\.community@gmail\.com/g,
    owner: 'src/lib/public-site-info.ts',
    fix: 'CONTACT_EMAIL (src/lib/public-site-info.ts)',
  },
]

function isExcluded(rel) {
  return EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))
}

/**
 * 사람이 읽는 문자열이 담기는 노드만 모은다.
 *
 *   StringLiteral                    'x' · "x" · JSX attribute 값
 *   NoSubstitutionTemplateLiteral    `x`
 *   TemplateHead/Middle/Tail         `${a} x` 의 텍스트 조각
 *   JsxText                          <p>x</p> 의 x
 *
 * import 경로도 StringLiteral 이지만, 브랜드명·이메일이 경로에 들어갈 일이 없어
 * 따로 걸러내지 않는다. 걸러내면 오히려 '@/lib/…소란소란' 같은 실수를 놓친다.
 */
function collectTextNodes(sourceFile) {
  const found = []
  const visit = (node) => {
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TemplateHead:
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail:
      case ts.SyntaxKind.JsxText:
        found.push(node)
        break
      default:
        break
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** 한 파일의 내용을 검사한다. 파일 시스템을 건드리지 않으므로 self-test 가 그대로 쓴다 */
function scan(rel, text) {
  if (isExcluded(rel)) return []

  const sourceFile = ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  const hits = []
  for (const node of collectTextNodes(sourceFile)) {
    // JsxText 는 text 에 원문이, 나머지는 리터럴 값이 들어 있다
    const value = node.text ?? ''
    if (!value) continue
    for (const { name, re, owner, fix } of PATTERNS) {
      if (rel === owner) continue // 이 값의 정본 파일에서만 허용한다
      for (const m of value.match(re) ?? []) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        hits.push({ rel, line: line + 1, name, hit: m, fix })
      }
    }
  }
  return hits
}

/**
 * self-test — 파일을 만들지 않고 문자열만으로 가드 자신을 검증한다.
 *
 * 🔴 가드가 조용히 아무것도 잡지 못하게 되는 것이 가장 나쁜 실패다.
 *    정규식이나 소유권 규칙을 고칠 때 이 목록이 먼저 깨진다.
 */
function selfTest() {
  const cases = [
    // --- 잡아야 하는 것 ---
    { why: 'JSX 텍스트의 직접 브랜드명', rel: 'src/components/X.tsx', src: 'const a = <p>소란소란</p>', expect: 1 },
    { why: '문자열 안의 브랜드명', rel: 'src/components/X.tsx', src: "const label = '소란소란 홈'", expect: 1 },
    { why: 'aria-label 의 브랜드명', rel: 'src/components/X.tsx', src: 'const a = <a aria-label="소란소란 홈"></a>', expect: 1 },
    { why: 'alt 의 브랜드명', rel: 'src/components/X.tsx', src: 'const a = <img alt="소란소란 hero" />', expect: 1 },
    { why: 'metadata 문자열의 브랜드명', rel: 'src/app/x/page.tsx', src: "export const metadata = { description: '소란소란 이용약관' }", expect: 1 },
    { why: '직접 적힌 문의 이메일', rel: 'src/app/x/page.tsx', src: "const C = 'soransoran.community@gmail.com'", expect: 1 },

    // --- 이번에 막은 우회 구멍 ---
    {
      why: 'URL 문자열 뒤 같은 줄의 브랜드명 (// 오인 금지)',
      rel: 'src/components/X.tsx',
      src: "const url = 'https://example.com'; const name = '소란소란'",
      expect: 1,
    },
    {
      why: '코드 + 블록 주석 + 코드가 한 줄 — 주석 밖만 검출',
      rel: 'src/components/X.tsx',
      src: "const a = '소란소란'; /* 소란소란 은 주석이다 */ const b = 1",
      expect: 1,
    },
    {
      why: '한 줄에 블록 주석 두 개여도 주석 밖만 검출',
      rel: 'src/components/X.tsx',
      src: "/* 소란소란 */ const a = '소란소란'; /* 소란소란 */ const b = 2",
      expect: 1,
    },
    {
      why: 'template literal 안의 브랜드명',
      rel: 'src/components/X.tsx',
      src: 'const t = `소란소란 편집팀 ${x}`',
      expect: 1,
    },

    // --- 패턴별 소유권 ---
    {
      why: 'public-site-info.ts 안의 브랜드명은 위반',
      rel: 'src/lib/public-site-info.ts',
      src: "export const X = '소란소란 운영팀'",
      expect: 1,
    },
    {
      why: 'brand-name.ts 안의 이메일은 위반',
      rel: 'src/lib/brand-name.ts',
      src: "export const X = 'soransoran.community@gmail.com'",
      expect: 1,
    },
    {
      why: '정본 파일의 올바른 값은 허용 — 브랜드명',
      rel: 'src/lib/brand-name.ts',
      src: "export const BRAND_NAME = '소란소란'",
      expect: 0,
    },
    {
      why: '정본 파일의 올바른 값은 허용 — 이메일',
      rel: 'src/lib/public-site-info.ts',
      src: "export const CONTACT_EMAIL = 'soransoran.community@gmail.com'",
      expect: 0,
    },

    // --- 잡으면 안 되는 것 ---
    { why: '라인 주석은 무시', rel: 'src/components/X.tsx', src: '// 소란소란 은 이렇게 한다', expect: 0 },
    { why: '블록 주석은 무시', rel: 'src/components/X.tsx', src: '/* 소란소란\n * soransoran.community@gmail.com\n */', expect: 0 },
    { why: 'admin 경로는 무시', rel: 'src/app/admin/(ops)/layout.tsx', src: 'const a = <p>소란소란 운영</p>', expect: 0 },
    { why: 'admin 컴포넌트도 무시', rel: 'src/components/admin/AdminShell.tsx', src: 'const a = <p>소란소란 운영</p>', expect: 0 },
    { why: '과거 콘텐츠는 무시', rel: 'src/content/magazine/articles.ts', src: "const a = { text: '소란소란은 …' }", expect: 0 },
    { why: '정본 참조는 잡지 않는다', rel: 'src/components/X.tsx', src: 'const a = <p>{BRAND_NAME}</p>', expect: 0 },
    { why: 'SITE.name 참조도 잡지 않는다', rel: 'src/app/x/page.tsx', src: 'export const metadata = { description: `${SITE.name} 이용약관` }', expect: 0 },
    { why: 'CONTACT_EMAIL 참조도 잡지 않는다', rel: 'src/app/x/page.tsx', src: 'const a = <a href={`mailto:${CONTACT_EMAIL}`}></a>', expect: 0 },
  ]

  const failed = []
  for (const c of cases) {
    const got = scan(c.rel, c.src).length
    if (got !== c.expect) failed.push({ ...c, got })
  }
  if (failed.length) {
    console.error('🔴 브랜드 가드 self-test 실패 — 가드 자신이 고장났습니다:\n')
    for (const f of failed) {
      console.error(`  ${f.why}\n    ${f.rel}  기대 ${f.expect}건, 실제 ${f.got}건`)
    }
    process.exit(1)
  }
  return cases.length
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const selfTestCount = selfTest()

const violations = []
for (const file of walk(TARGET)) {
  violations.push(...scan(relative(ROOT, file), readFileSync(file, 'utf8')))
}

if (violations.length) {
  console.error('브랜드 리터럴이 정본 파일 밖에서 발견되었습니다:\n')
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  [${v.name}] ${v.hit}  →  ${v.fix} 를 쓰세요`)
  }
  console.error(`\n총 ${violations.length}건. 리브랜딩 때 이 자리가 옛 이름으로 남습니다.`)
  process.exit(1)
}

console.log(`브랜드 리터럴 가드 통과 — 정본 파일 외 0건 (self-test ${selfTestCount}건 통과)`)
