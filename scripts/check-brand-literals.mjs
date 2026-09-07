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
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import {
  readManifest,
  resolveCurrentValues,
  valueTargets,
  escapeRe,
} from './lib/rebrand-manifest-reader.mjs'

const ROOT = process.cwd()
const TARGET = join(ROOT, 'src')

/** 검사하지 않는 경로 — 운영자 화면과 이미 발행된 콘텐츠 */
const EXCLUDED_PREFIXES = ['src/app/admin/', 'src/components/admin/', 'src/content/']

/**
 * 🔴 허용 파일은 값마다 다르다. 공통 allowlist 를 두지 않는다.
 *    public-site-info.ts 의 브랜드명도, brand-name.ts 의 이메일도 위반이다.
 *
 * 🔴 검사할 값을 여기 복사해 두지 않는다.
 *
 *   현재 값  brand-name.ts · public-site-info.ts 정본에서 읽는다
 *   옛 값    rebrand-manifest.ts 의 legacyValues 에서 읽는다
 *
 * 값을 복사해 두면 정본을 새 이름으로 바꾼 뒤 이 가드는 **새 이름의 중복만** 보고,
 * 옛 이름이 화면 어딘가 남아 있어도 통과한다. 그래서 legacy 도 함께 본다.
 * legacy 목록은 리브랜딩 manifest 하나가 갖는다 — 별도 정본을 또 만들지 않는다.
 */
function buildTargets() {
  const manifestPath = join(ROOT, 'src/lib/rebrand-manifest.ts')
  if (!existsSync(manifestPath)) return []
  const configs = resolveCurrentValues(readManifest(readFileSync(manifestPath, 'utf8')), ROOT)
  // 이 가드가 책임지는 것은 서비스명과 문의 이메일 두 가지다
  const mine = configs.filter((c) => c.id === 'brand-name' || c.id === 'contact-email')
  const out = []
  for (const c of mine) out.push(...valueTargets(c))
  return out.map((t) => ({
    ...t,
    re: new RegExp(escapeRe(t.value), 'g'),
    name: `${t.id} (${t.kind === 'legacy' ? '옛 값' : '현재 값'})`,
  }))
}

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
function scan(rel, text, targets) {
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
    for (const t of targets) {
      if (t.allowed.includes(rel)) continue
      for (const m of value.match(t.re) ?? []) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        hits.push({ rel, line: line + 1, name: t.name, hit: m, fix: t.fix })
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
  // 지금(리브랜딩 전) 상태 — legacy 가 비어 있다
  const NOW = [
    { id: 'brand-name', owner: 'code', source: 'src/lib/brand-name.ts', symbol: 'BRAND_NAME',
      current: '소란소란', legacyValues: [], legacyAllowed: [] },
    { id: 'contact-email', owner: 'code', source: 'src/lib/public-site-info.ts', symbol: 'CONTACT_EMAIL',
      current: 'soransoran.community@gmail.com', legacyValues: [], legacyAllowed: [] },
  ]
  const mk = (cfgs) => {
    const out = []
    for (const c of cfgs) out.push(...valueTargets(c))
    return out.map((t) => ({ ...t, re: new RegExp(escapeRe(t.value), 'g'), name: `${t.id} (${t.kind})` }))
  }
  const T = mk(NOW)

  /**
   * 🔴 가짜 "리브랜딩 후" — 정본은 새 이름, 옛 이름은 legacyValues 에 있다.
   *    가드는 **둘 다** 잡아야 한다.
   */
  const AFTER = [
    { id: 'brand-name', owner: 'code', source: 'src/lib/brand-name.ts', symbol: 'BRAND_NAME',
      current: '새이름', legacyValues: ['소란소란'], legacyAllowed: [] },
    { id: 'contact-email', owner: 'code', source: 'src/lib/public-site-info.ts', symbol: 'CONTACT_EMAIL',
      current: 'new@example.test', legacyValues: ['old@example.test'],
      legacyAllowed: [{ path: 'src/lib/legacy-contact.ts', why: '옛 주소 안내 문구' }] },
  ]
  const TA = mk(AFTER)

  const cases = [
    // --- 잡아야 하는 것 ---
    { why: 'JSX 텍스트의 직접 브랜드명', rel: 'src/components/X.tsx', src: 'const a = <p>소란소란</p>', expect: 1 },
    { why: '문자열 안의 브랜드명', rel: 'src/components/X.tsx', src: "const label = '소란소란 홈'", expect: 1 },
    { why: 'aria-label 의 브랜드명', rel: 'src/components/X.tsx', src: 'const a = <a aria-label="소란소란 홈"></a>', expect: 1 },
    { why: 'alt 의 브랜드명', rel: 'src/components/X.tsx', src: 'const a = <img alt="소란소란 hero" />', expect: 1 },
    { why: 'metadata 문자열의 브랜드명', rel: 'src/app/x/page.tsx', src: "export const metadata = { description: '소란소란 이용약관' }", expect: 1 },
    { why: '직접 적힌 문의 이메일', rel: 'src/app/x/page.tsx', src: "const C = 'soransoran.community@gmail.com'", expect: 1 },
    { why: 'URL 뒤 같은 줄의 브랜드명 (// 오인 금지)', rel: 'src/components/X.tsx', src: "const url = 'https://example.com'; const name = '소란소란'", expect: 1 },
    { why: '코드+블록주석+코드 한 줄', rel: 'src/components/X.tsx', src: "const a = '소란소란'; /* 소란소란 은 주석이다 */ const b = 1", expect: 1 },
    { why: '한 줄 블록주석 두 개', rel: 'src/components/X.tsx', src: "/* 소란소란 */ const a = '소란소란'; /* 소란소란 */ const b = 2", expect: 1 },
    { why: 'template literal 안', rel: 'src/components/X.tsx', src: 'const t = `소란소란 편집팀 ${x}`', expect: 1 },
    { why: 'public-site-info.ts 안의 브랜드명은 위반', rel: 'src/lib/public-site-info.ts', src: "export const X = '소란소란 운영팀'", expect: 1 },
    { why: 'brand-name.ts 안의 이메일은 위반', rel: 'src/lib/brand-name.ts', src: "export const X = 'soransoran.community@gmail.com'", expect: 1 },

    // --- 잡으면 안 되는 것 ---
    { why: '정본의 올바른 값 — 브랜드명', rel: 'src/lib/brand-name.ts', src: "export const BRAND_NAME = '소란소란'", expect: 0 },
    { why: '정본의 올바른 값 — 이메일', rel: 'src/lib/public-site-info.ts', src: "export const CONTACT_EMAIL = 'soransoran.community@gmail.com'", expect: 0 },
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
    const got = scan(c.rel, c.src, T).length
    if (got !== c.expect) failed.push({ ...c, got })
  }

  // 🔴 리브랜딩 후 — 새 이름 중복과 옛 이름 잔존을 모두 잡는가
  const after = [
    { why: '정본 변경 후 새 이름 중복을 잡는다', rel: 'src/components/X.tsx', src: "const n = '새이름'", expect: 1 },
    { why: '정본 변경 후 옛 이름 잔존을 잡는다', rel: 'src/components/X.tsx', src: 'const a = <p>소란소란</p>', expect: 1 },
    { why: '옛 이메일 잔존을 잡는다', rel: 'src/app/x.tsx', src: "const c = 'old@example.test'", expect: 1 },
    { why: '허용된 정확한 경로만 통과', rel: 'src/lib/legacy-contact.ts', src: "const old = 'old@example.test'", expect: 0 },
    { why: '허용 경로가 아니면 옛 값도 잡는다', rel: 'src/lib/other.ts', src: "const old = 'old@example.test'", expect: 1 },
    { why: '옛 값도 주석에서는 안 잡는다', rel: 'src/components/X.tsx', src: '// 소란소란 이었다', expect: 0 },
  ]
  for (const c of after) {
    const got = scan(c.rel, c.src, TA).length
    if (got !== c.expect) failed.push({ ...c, got })
  }

  if (failed.length) {
    console.error('🔴 브랜드 가드 self-test 실패 — 가드 자신이 고장났습니다:\n')
    for (const f of failed) console.error(`  ${f.why}\n    ${f.rel}  기대 ${f.expect}건, 실제 ${f.got}건`)
    process.exit(1)
  }
  return cases.length + after.length
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

// 🔴 검사 대상은 정본과 manifest 에서 읽는다 (현재 값 + 옛 값)
const targets = buildTargets()
if (!targets.length) {
  console.error('검사 대상을 만들지 못했습니다 — src/lib/rebrand-manifest.ts 를 확인하세요')
  process.exit(1)
}

const violations = []
for (const file of walk(TARGET)) {
  violations.push(...scan(relative(ROOT, file), readFileSync(file, 'utf8'), targets))
}

if (violations.length) {
  console.error('브랜드 리터럴이 정본 파일 밖에서 발견되었습니다:\n')
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  [${v.name}] ${v.hit}  →  ${v.fix} 를 쓰세요`)
  }
  console.error(`\n총 ${violations.length}건. 리브랜딩 때 이 자리가 옛 이름으로 남습니다.`)
  process.exit(1)
}

const legacyN = targets.filter((t) => t.kind === 'legacy').length
console.log(
  `브랜드 리터럴 가드 통과 — 정본 파일 외 0건 · 검사 대상 ${targets.length}개` +
    `(현재 ${targets.length - legacyN} · 옛 값 ${legacyN}) (self-test ${selfTestCount}건 통과)`,
)
