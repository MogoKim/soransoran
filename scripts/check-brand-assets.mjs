#!/usr/bin/env node
/**
 * 브랜드 자산 manifest 검사
 *
 * 🔴 목록이 현실과 어긋나면 목록이 없는 것보다 나쁘다.
 *    "여기 다 적혀 있다"고 믿고 리브랜딩 당일에 열었는데 경로가 옛것이면,
 *    빠뜨린 것을 빠뜨렸는지도 모른 채 넘어간다.
 *
 * ── 이 검사가 보장하는 것 ──
 *   · 엔트리 구조가 유효하다 (필수 필드 · 허용된 category 값)
 *   · path 가 목록 안에서 유일하다 (중복 등록 없음)
 *   · 필수 category 가 하나도 빠지지 않았다
 *   · 적힌 파일·코드 진입점이 실제로 존재한다
 *   · 외부 브랜드(locked)가 구분돼 있다
 *   · 🔴 **PNG 자산의 실제 픽셀 크기가 적힌 값과 같다** (PNG 헤더를 직접 읽는다)
 *   · 🔴 **manifest 의 아이콘 4종이 실제 파일·실제 크기·MIME 과 맞는다**
 *   · 🔴 **가로형 로고 파일이 표시 상자(brand-logo.ts)의 정확히 2배다**
 *   · 🔴 **구 텍스트 워드마크 계약이 코드에 남아 있지 않다**
 *
 * ── 🔴 보장하지 못하는 것 (과장하지 않는다) ──
 *   · **manifest 에 적지 않은 새 브랜드 자산은 찾아내지 못한다.**
 *     누군가 로고 이미지를 추가하고 목록에 넣지 않으면 이 검사는 그대로 통과한다.
 *     자동 탐색은 매거진·사용자 이미지까지 끌어와 오탐이 되므로 하지 않는다.
 *   · 이미지 **안에** 브랜드 요소(글자·로고)가 있는지 시각적으로 판정하지 못한다.
 *     크기는 재지만 **무엇이 그려져 있는지는 사람이 본다.**
 *   · 새 로고·아이콘을 만들어 주지 않는다. 교체는 사람의 일이다.
 *
 * 🔴 새 dependency 를 쓰지 않는다. PNG 크기는 헤더 24바이트에 있어
 *    이미지 라이브러리 없이 Node 표준만으로 읽는다.
 *
 * 🔴 이미지 파일 자체는 읽기만 한다. 수정·이동·이름 변경을 하지 않는다.
 *
 * manifest 는 src/lib/brand-assets.ts 다. TypeScript 파일이라 node 가 직접 못 읽으므로
 * 파서로 배열 리터럴을 훑는다 — 새 dependency 없이 tsc 만 쓴다.
 */
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const MANIFEST = join(ROOT, 'src/lib/brand-assets.ts')

/** 배타적 분류 — 이 값 외에는 오타로 본다 */
const CATEGORIES = [
  'app-icon',
  'apple-icon',
  'logo',
  'og',
  'manifest',
  'hero',
  'login-image',
  'external',
]

/**
 * 최소 하나는 있어야 하는 category.
 *
 * 🔴 자산을 지우면서 목록에서만 빼는 것을 막는다 —
 *    "OG 이미지 항목이 사라졌다"를 사람이 알아채기는 어렵다.
 */
const REQUIRED_CATEGORIES = [
  'app-icon',
  'apple-icon',
  'logo',
  'og',
  'manifest',
  'hero',
  'login-image',
  'external',
]

const REQUIRED_FIELDS = ['path', 'kind', 'category', 'use', 'replace', 'locked', 'note']

/**
 * PNG 의 실제 픽셀 크기 — 헤더에서 읽는다.
 *
 * PNG 는 8바이트 시그니처 뒤 첫 청크가 반드시 IHDR 이고, 그 안에 가로·세로가
 * 빅엔디안 uint32 로 들어 있다(12~15 'IHDR' · 16~19 width · 20~23 height).
 * 규격이 그렇게 정해져 있어 라이브러리 없이 확정적으로 읽을 수 있다.
 *
 * 🔴 크기를 못 읽으면 null 이 아니라 **문제로 올린다.** "못 읽었으니 통과"는
 *    검사가 아니다 — PNG 가 아니거나 깨진 것이고, 둘 다 자산으로는 실패다.
 */
export function readPngSize(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (buf.length < 24) return { error: '24바이트보다 작습니다 — PNG 가 아닙니다' }
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) return { error: 'PNG 시그니처가 아닙니다' }
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return { error: '첫 청크가 IHDR 이 아닙니다' }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** `'186x96'` → `{ width, height }`. 형식이 아니면 null */
export function parsePixels(text) {
  const m = /^(\d+)x(\d+)$/.exec(String(text ?? ''))
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null
}

/**
 * manifest 가 선언한 주소를 저장소 경로로 옮긴다.
 *
 * 🔴 Next.js app 규약 파일(`app/icon.png` · `app/apple-icon.png`)은 `public/` 에 없다.
 *    빌드가 루트 주소로 내보낸다 — 그 두 개만 예외이고 나머지는 전부 `public/` 이다.
 *    이 대응을 적어 두지 않으면 "manifest 에는 있는데 파일이 없다"로 오탐이 난다.
 */
const APP_CONVENTION = { '/icon.png': 'src/app/icon.png', '/apple-icon.png': 'src/app/apple-icon.png' }
export function manifestSrcToPath(src) {
  return APP_CONVENTION[src] ?? (src.startsWith('/') ? join('public', src.slice(1)) : null)
}

/** manifest.ts 의 icons 배열에서 { src, sizes, type } 을 읽는다 */
export function readManifestIcons(text) {
  const sf = ts.createSourceFile('manifest.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const icons = []
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'icons' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const el of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(el)) continue
        const o = {}
        for (const pr of el.properties) {
          if (!ts.isPropertyAssignment(pr) || !ts.isIdentifier(pr.name)) continue
          if (ts.isStringLiteral(pr.initializer)) o[pr.name.text] = pr.initializer.text
        }
        icons.push(o)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return icons
}

/**
 * 구 텍스트 워드마크 계약이 **코드에** 남아 있는지 본다.
 *
 * 🔴 주석은 세지 않는다. 옛 정책을 시점과 함께 남긴 서술은 지워야 할 것이 아니라
 *    남겨야 할 것이다(운영 정본과 같은 규칙). 지워야 하는 것은 **살아 있는 참조**다 —
 *    import 로 끌어다 쓰거나 아직 export 하고 있는 상태를 말한다.
 */
const RETIRED_WORDMARK = ['BRAND_NAME_HEAD', 'BRAND_NAME_TAIL', 'BRAND_NAME_SPLIT_AT']
export function findRetiredWordmark(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const el of node.importClause.namedBindings.elements) {
        if (RETIRED_WORDMARK.includes(el.name.text)) hits.push({ rel, name: el.name.text, how: 'import' })
      }
    }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && RETIRED_WORDMARK.includes(d.name.text)) {
          hits.push({ rel, name: d.name.text, how: 'export' })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/**
 * brand-logo.ts 의 표시 상자를 읽는다.
 *
 * 🔴 파일은 표시 상자의 **정확히 2배**여야 한다. 고밀도 화면에서 흐려지지 않게
 *    2배로 두기로 한 계약이고, 한쪽만 바뀌면 흐려지거나 쓸데없이 무거워진다.
 *    주석으로 적어 두면 어긋나도 아무도 모른다 — 그래서 검사가 센다.
 */
export function readLogoDisplaySize(text) {
  const sf = ts.createSourceFile('brand-logo.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let out = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'BRAND_LOGO' &&
      node.initializer
    ) {
      let init = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      if (ts.isObjectLiteralExpression(init)) {
        const o = {}
        for (const pr of init.properties) {
          if (!ts.isPropertyAssignment(pr) || !ts.isIdentifier(pr.name)) continue
          if (ts.isNumericLiteral(pr.initializer)) o[pr.name.text] = Number(pr.initializer.text)
          else if (ts.isStringLiteral(pr.initializer)) o[pr.name.text] = pr.initializer.text
        }
        if (o.width && o.height) out = o
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 파일 자산이 PNG 인지 — 확장자로 본다 */
export const isPng = (path) => path.toLowerCase().endsWith('.png')

/**
 * OG 가 런타임에 읽는 로고 경로 — `readFileSync(join(process.cwd(), '<여기>'))` 의 리터럴.
 *
 * 🔴 왜 리터럴을 따로 확인하는가
 *    이 경로는 상수가 아니라 **문자열로 박혀 있다.** 파일 추적기가 상수를 따라가지
 *    못해서 그렇게 둔 것인데(brand-logo-image.ts 머리말), 그 대가로 `brand-logo.ts` 와
 *    갈라질 수 있다. 갈라지면 OG 만 조용히 빈 로고가 된다.
 */
export function readRuntimeLogoPath(text) {
  const m = /readFileSync\(\s*join\(\s*process\.cwd\(\)\s*,\s*'([^']+)'\s*\)\s*\)/.exec(text)
  return m ? m[1] : null
}

/**
 * 빌드가 그 파일을 서버 번들에 올리도록 적어 두었는가.
 *
 * 🔴 **이 항목이 빠지면 로컬은 통과하고 배포만 깨진다.** 실제로 그렇게 깨졌다 —
 *    `.nft.json` 에 로고가 없었다. 그래서 설정의 존재를 검사로 고정한다.
 * 🔴 이 검사는 "적혀 있는가" 만 본다. 키가 실제 route 와 맞는지는 빌드 뒤
 *    `.nft.json` 을 열어 확인한다 — 어긋난 키는 조용히 아무것도 하지 않는다.
 */
export function tracingIncludesLogo(configText, logoPath, routeKeys) {
  const missing = []
  for (const key of routeKeys) {
    const re = new RegExp(`'${key.replace(/[[\]/]/g, (c) => '\\' + c)}'\\s*:\\s*\\[[^\\]]*${logoPath.replace(/[./]/g, (c) => '\\' + c)}`)
    if (!re.test(configText)) missing.push(key)
  }
  return missing
}

/** brand-assets.ts 의 BRAND_ASSETS 배열에서 각 항목을 읽는다 */
export function readManifest(text) {
  const sf = ts.createSourceFile('brand-assets.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const assets = []

  const literal = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    // 문자열 이어붙이기(+)는 note 에서 쓴다 — 합쳐서 돌려준다
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = literal(node.left)
      const r = literal(node.right)
      if (typeof l === 'string' && typeof r === 'string') return l + r
    }
    return undefined
  }

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'BRAND_ASSETS' &&
      node.initializer
    ) {
      let init = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      if (ts.isArrayLiteralExpression(init)) {
        for (const el of init.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue
          const obj = {}
          for (const p of el.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue
            const v = literal(p.initializer)
            if (v !== undefined) obj[p.name.text] = v
          }
          if (obj.path) assets.push(obj)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return assets
}

/** 구조·중복·필수 category 검사. 파일 시스템을 건드리지 않으므로 self-test 가 그대로 쓴다 */
export function validate(assets) {
  const problems = []

  if (!assets.length) problems.push('BRAND_ASSETS 배열을 찾을 수 없거나 비어 있습니다')

  for (const a of assets) {
    for (const f of REQUIRED_FIELDS) {
      if (a[f] === undefined) problems.push(`필드 누락: ${a.path ?? '(경로 없음)'} 에 ${f} 가 없습니다`)
    }
    if (a.category !== undefined && !CATEGORIES.includes(a.category)) {
      problems.push(`알 수 없는 category: ${a.path} → '${a.category}'`)
    }
    if (a.kind !== undefined && a.kind !== 'file' && a.kind !== 'code') {
      problems.push(`알 수 없는 kind: ${a.path} → '${a.kind}'`)
    }
    // 🔴 PNG 파일 자산은 크기를 적는다 — 적지 않으면 아래 픽셀 대조가 통째로 건너뛰어진다
    if (a.kind === 'file' && a.path && isPng(a.path)) {
      if (a.pixels === undefined) problems.push(`pixels 누락: ${a.path} — PNG 파일 자산은 '가로x세로' 를 적습니다`)
      else if (!parsePixels(a.pixels)) problems.push(`pixels 형식 오류: ${a.path} → '${a.pixels}' (예: '180x180')`)
    }
  }

  const seen = new Set()
  for (const a of assets) {
    if (seen.has(a.path)) problems.push(`경로 중복: ${a.path}`)
    seen.add(a.path)
  }

  const present = new Set(assets.map((a) => a.category))
  for (const c of REQUIRED_CATEGORIES) {
    if (!present.has(c)) problems.push(`필수 category 누락: ${c}`)
  }

  return problems
}

/** category 별 개수를 프로그램으로 센다 — 눈으로 더하지 않는다 */
export function countByCategory(assets) {
  const out = new Map(CATEGORIES.map((c) => [c, 0]))
  for (const a of assets) out.set(a.category, (out.get(a.category) ?? 0) + 1)
  return out
}

/** self-test — 파일을 만들지 않고 문자열만으로 검사기 자신을 확인한다 */
function selfTest() {
  // 🔴 표본도 실제 규칙을 지켜야 한다 — PNG 파일 자산이므로 pixels 를 갖는다.
  //    표본이 실제보다 느슨하면 검사가 아니라 검사를 피하는 장치가 된다.
  const entry = (path, category, extra = '') =>
    `{ path: '${path}', kind: 'file', category: '${category}', use: 'x', replace: false, locked: false, pixels: '1x1', note: 'n'${extra} }`
  const full = REQUIRED_CATEGORIES.map((c, i) => entry(`p/${i}.png`, c)).join(',\n      ')
  const wrap = (body) => `export const BRAND_ASSETS = [\n      ${body}\n    ] as const`

  const parsed = readManifest(
    wrap(
      `{ path: 'a/b.png', kind: 'file', category: 'app-icon', use: 'x', replace: true, locked: false, note: '앞' + '뒤' }`,
    ),
  )

  const checks = [
    ['배열 항목을 읽는다', parsed.length === 1],
    ['경로를 읽는다', parsed[0].path === 'a/b.png'],
    ['boolean 을 읽는다', parsed[0].replace === true],
    ['이어붙인 문자열을 합친다', parsed[0].note === '앞뒤'],
    ['category 를 읽는다', parsed[0].category === 'app-icon'],
    ['필수 category 가 다 있으면 문제 0', validate(readManifest(wrap(full))).length === 0],
    [
      '필수 category 누락을 잡는다',
      validate(readManifest(wrap(full.split(',\n      ').slice(1).join(',\n      ')))).some((p) =>
        p.includes('필수 category 누락'),
      ),
    ],
    [
      '경로 중복을 잡는다',
      validate(
        readManifest(wrap([full, entry('p/0.png', 'app-icon')].join(',\n      '))),
      ).some((p) => p.includes('경로 중복')),
    ],
    [
      '알 수 없는 category 를 잡는다',
      validate(readManifest(wrap([full, entry('p/z.png', 'nope')].join(',\n      ')))).some((p) =>
        p.includes('알 수 없는 category'),
      ),
    ],
    [
      '필드 누락을 잡는다',
      validate(
        readManifest(wrap(`{ path: 'x.png', kind: 'file', category: 'logo', use: 'u', replace: false }`)),
      ).some((p) => p.includes('필드 누락')),
    ],
    [
      'category 합계가 엔트리 수와 같다 (이중 계산 방지)',
      (() => {
        const a = readManifest(wrap(full))
        return [...countByCategory(a).values()].reduce((x, y) => x + y, 0) === a.length
      })(),
    ],
    ['빈 manifest 는 문제로 잡는다', validate(readManifest('export const BRAND_ASSETS = [] as const')).length > 0],

    // ── PNG 헤더 판독 ──
    (() => {
      // 32×32 PNG 헤더를 손으로 만든다 — 파일을 만들지 않는다
      const b = Buffer.alloc(24)
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
      b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(32, 16); b.writeUInt32BE(48, 20)
      const r = readPngSize(b)
      return ['PNG 헤더에서 크기를 읽는다', r.width === 32 && r.height === 48]
    })(),
    ['PNG 가 아니면 오류를 돌려준다', Boolean(readPngSize(Buffer.from('not a png at all......')).error)],
    ['너무 짧은 파일도 오류다', Boolean(readPngSize(Buffer.alloc(8)).error)],
    ["pixels 문자열을 읽는다", parsePixels('186x96')?.width === 186 && parsePixels('186x96')?.height === 96],
    ['pixels 형식 오류를 잡는다', parsePixels('186 x 96') === null && parsePixels('big') === null],
    [
      '🔴 PNG 파일 자산에 pixels 가 없으면 잡는다',
      validate(readManifest(wrap(`{ path: 'a/b.png', kind: 'file', category: 'logo', use: 'u', replace: false, locked: false, note: 'n' }`)))
        .some((x) => x.includes('pixels 누락')),
    ],
    [
      'code 진입점에는 pixels 를 요구하지 않는다',
      !validate(readManifest(wrap(`{ path: 'a/b.tsx', kind: 'code', category: 'logo', use: 'u', replace: false, locked: false, note: 'n' }`)))
        .some((x) => x.includes('pixels')),
    ],

    // ── manifest 아이콘 ──
    (() => {
      const icons = readManifestIcons(
        `export default function m(){return{icons:[{ src: '/icon.png', sizes: '32x32', type: 'image/png' }]}}`,
      )
      return ['manifest icons 를 읽는다', icons.length === 1 && icons[0].sizes === '32x32']
    })(),
    [
      'app 규약 주소를 저장소 경로로 옮긴다',
      manifestSrcToPath('/icon.png') === 'src/app/icon.png' &&
        manifestSrcToPath('/brand/icon-192.png') === join('public', 'brand/icon-192.png'),
    ],

    // ── 구 워드마크 계약 ──
    [
      '🔴 구 워드마크 import 를 잡는다',
      findRetiredWordmark('x.tsx', "import { BRAND_NAME_HEAD } from '@/lib/brand-name'").length === 1,
    ],
    [
      '🔴 구 워드마크 export 를 잡는다',
      findRetiredWordmark('x.ts', 'export const BRAND_NAME_SPLIT_AT = 2').length === 1,
    ],
    [
      '주석·역사 기록은 잡지 않는다',
      findRetiredWordmark('x.ts', '// 이전에는 BRAND_NAME_HEAD 가 있었다\n/* BRAND_NAME_TAIL */').length === 0,
    ],

    // ── 로고 표시 상자 ──
    (() => {
      const o = readLogoDisplaySize("export const BRAND_LOGO = { src: '/a.png', width: 93, height: 48 } as const")
      return ['brand-logo.ts 의 표시 상자를 읽는다', o?.width === 93 && o?.height === 48]
    })(),
    ['BRAND_LOGO 가 없으면 null', readLogoDisplaySize('export const OTHER = { width: 1, height: 2 }') === null],

    // ── OG 런타임 경로 · 파일 추적 ──
    [
      'OG 가 읽는 리터럴 경로를 읽는다',
      readRuntimeLogoPath("const b = readFileSync(join(process.cwd(), 'public/brand/x.png'))") === 'public/brand/x.png',
    ],
    ['리터럴이 없으면 null', readRuntimeLogoPath('const b = readFileSync(somewhereElse)') === null],
    [
      '파일 추적 설정이 있으면 빠진 route 0',
      tracingIncludesLogo(
        "outputFileTracingIncludes: { '/og': ['./public/brand/x.png'], '/a/[b]/og': ['./public/brand/x.png'] }",
        './public/brand/x.png',
        ['/og', '/a/[b]/og'],
      ).length === 0,
    ],
    [
      '🔴 한 route 만 빠져도 잡는다',
      tracingIncludesLogo(
        "outputFileTracingIncludes: { '/og': ['./public/brand/x.png'] }",
        './public/brand/x.png',
        ['/og', '/a/[b]/og'],
      ).join() === '/a/[b]/og',
    ],
    [
      '🔴 다른 파일을 적어 두면 잡는다',
      tracingIncludesLogo(
        "outputFileTracingIncludes: { '/og': ['./public/other.png'] }",
        './public/brand/x.png',
        ['/og'],
      ).length === 1,
    ],
  ]

  const failed = checks.filter(([, ok]) => !ok).map(([why]) => why)
  if (failed.length) {
    console.error('🔴 브랜드 자산 검사 self-test 실패 — 검사기 자신이 고장났습니다:\n')
    for (const f of failed) console.error(`  ${f}`)
    process.exit(1)
  }
  return checks.length
}

const selfTestCount = selfTest()

if (!existsSync(MANIFEST)) {
  console.error('브랜드 자산 manifest 가 없습니다: src/lib/brand-assets.ts')
  process.exit(1)
}

const assets = readManifest(readFileSync(MANIFEST, 'utf8'))

const problems = validate(assets)
if (problems.length) {
  console.error('브랜드 자산 manifest 구조에 문제가 있습니다:\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

const missing = []
const notFile = []
for (const a of assets) {
  const abs = join(ROOT, a.path)
  if (!existsSync(abs)) {
    missing.push(a)
    continue
  }
  if (a.kind === 'file' && !statSync(abs).isFile()) notFile.push(a)
}

if (missing.length || notFile.length) {
  console.error('브랜드 자산 manifest 가 실제 파일과 어긋납니다:\n')
  for (const a of missing) console.error(`  없음: ${a.path}   (${a.use})`)
  for (const a of notFile) console.error(`  파일이 아님: ${a.path}   (${a.use})`)
  console.error('\n경로를 옮겼다면 src/lib/brand-assets.ts 를 함께 고치세요.')
  process.exit(1)
}

// ── 🔴 PNG 자산의 실제 픽셀을 잰다 — note 의 서술을 믿지 않는다 ──
const pixelProblems = []
const pngSize = new Map()
for (const a of assets) {
  if (a.kind !== 'file' || !isPng(a.path)) continue
  const got = readPngSize(readFileSync(join(ROOT, a.path)))
  if (got.error) { pixelProblems.push(`${a.path} — ${got.error}`); continue }
  pngSize.set(a.path, got)
  const want = parsePixels(a.pixels)
  if (want.width !== got.width || want.height !== got.height) {
    pixelProblems.push(`${a.path} — 적힌 값 ${a.pixels} · 실제 ${got.width}x${got.height}`)
  }
}

// ── 🔴 manifest 가 선언한 아이콘이 실제와 맞는가 ──
const MANIFEST_TS = join(ROOT, 'src/app/manifest.ts')
const icons = readManifestIcons(readFileSync(MANIFEST_TS, 'utf8'))
const iconProblems = []
if (!icons.length) iconProblems.push('manifest.ts 에서 icons 배열을 찾지 못했습니다')
const seenIconSrc = new Set()
for (const ic of icons) {
  const rel = manifestSrcToPath(ic.src)
  if (!rel) { iconProblems.push(`주소가 '/' 로 시작하지 않습니다: ${ic.src}`); continue }
  if (seenIconSrc.has(ic.src)) iconProblems.push(`manifest 아이콘 주소 중복: ${ic.src}`)
  seenIconSrc.add(ic.src)
  if (!existsSync(join(ROOT, rel))) { iconProblems.push(`파일이 없습니다: ${ic.src} → ${rel}`); continue }
  if (!isPng(rel) || ic.type !== 'image/png') {
    iconProblems.push(`MIME·확장자 불일치: ${ic.src} → type '${ic.type}'`)
  }
  const got = pngSize.get(rel) ?? readPngSize(readFileSync(join(ROOT, rel)))
  const want = parsePixels(ic.sizes)
  if (!want) iconProblems.push(`sizes 형식 오류: ${ic.src} → '${ic.sizes}'`)
  else if (got.error) iconProblems.push(`${ic.src} — ${got.error}`)
  else if (want.width !== got.width || want.height !== got.height) {
    iconProblems.push(`크기 불일치: ${ic.src} — 선언 ${ic.sizes} · 실제 ${got.width}x${got.height}`)
  }
  // 🔴 manifest 에만 있고 자산 목록에 없으면, 리브랜딩 당일 이 아이콘만 남는다
  if (!assets.some((a) => a.path === rel)) {
    iconProblems.push(`자산 목록에 없습니다: ${ic.src} → ${rel} (brand-assets.ts 에 추가하세요)`)
  }
}

// ── 🔴 가로형 로고는 표시 상자의 정확히 2배여야 한다 ──
const logoProblems = []
{
  const display = readLogoDisplaySize(readFileSync(join(ROOT, 'src/lib/brand-logo.ts'), 'utf8'))
  if (!display) logoProblems.push('src/lib/brand-logo.ts 에서 BRAND_LOGO 표시 상자를 읽지 못했습니다')
  else {
    const rel = 'public/brand/soransoran-logo.png'
    const got = pngSize.get(rel)
    if (!got) logoProblems.push(`${rel} 크기를 재지 못했습니다`)
    else if (got.width !== display.width * 2 || got.height !== display.height * 2) {
      logoProblems.push(
        `${rel} — 표시 ${display.width}x${display.height} 의 2배(${display.width * 2}x${display.height * 2})여야 하는데 ` +
          `실제는 ${got.width}x${got.height} 입니다`,
      )
    }
    if (display.src !== '/' + rel.replace(/^public\//, '')) {
      logoProblems.push(`BRAND_LOGO.src '${display.src}' 가 등록 경로 ${rel} 와 맞지 않습니다`)
    }

    // 🔴 OG 가 런타임에 읽는 리터럴이 같은 파일을 가리키는가
    const runtimePath = readRuntimeLogoPath(readFileSync(join(ROOT, 'src/lib/brand-logo-image.ts'), 'utf8'))
    if (runtimePath === null) {
      logoProblems.push('src/lib/brand-logo-image.ts 에서 OG 가 읽는 로고 경로를 찾지 못했습니다')
    } else if (runtimePath !== rel) {
      logoProblems.push(`OG 가 읽는 경로 '${runtimePath}' 가 등록 경로 ${rel} 와 다릅니다`)
    }

    // 🔴 그 파일이 서버 번들에 올라가도록 적어 두었는가 (없으면 배포에서만 깨진다)
    const OG_ROUTES = ['/opengraph-image', '/community/[boardSlug]/[postId]/opengraph-image']
    const missingTrace = tracingIncludesLogo(
      readFileSync(join(ROOT, 'next.config.js'), 'utf8'),
      './' + rel,
      OG_ROUTES,
    )
    for (const key of missingTrace) {
      logoProblems.push(
        `next.config.js 의 outputFileTracingIncludes 에 '${key}' → './${rel}' 가 없습니다 ` +
          '(없으면 서버리스 함수에 파일이 빠져 배포에서만 로고가 사라집니다)',
      )
    }
  }
}

// ── 🔴 구 텍스트 워드마크 계약이 코드에 남아 있지 않은가 ──
const retired = []
{
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (/\.(ts|tsx)$/.test(name)) {
        retired.push(...findRetiredWordmark(abs.slice(ROOT.length + 1), readFileSync(abs, 'utf8')))
      }
    }
  }
  walk(join(ROOT, 'src'))
}

if (pixelProblems.length || iconProblems.length || logoProblems.length || retired.length) {
  console.error('브랜드 자산이 선언과 어긋납니다:\n')
  for (const x of pixelProblems) console.error(`  픽셀 불일치: ${x}`)
  for (const x of iconProblems) console.error(`  manifest 아이콘: ${x}`)
  for (const x of logoProblems) console.error(`  가로형 로고: ${x}`)
  for (const x of retired) console.error(`  구 워드마크 계약 잔존: ${x.rel} 에서 ${x.name} 을 ${x.how} 합니다`)
  console.error('\n🔴 통과시키려고 선언을 파일에 맞추지 마세요 — 어느 쪽이 맞는지 먼저 정합니다.')
  process.exit(1)
}

// ── 집계는 전부 프로그램이 센다. 사람이 더하지 않는다 ──
const byCategory = countByCategory(assets)
const categoryTotal = [...byCategory.values()].reduce((a, b) => a + b, 0)
const byKind = { file: assets.filter((a) => a.kind === 'file').length, code: assets.filter((a) => a.kind === 'code').length }
const mustReplace = assets.filter((a) => a.replace)
const locked = assets.filter((a) => a.locked)

console.log(
  `브랜드 자산 manifest 통과 — 총 ${assets.length}건 전부 존재 (self-test ${selfTestCount}건 통과)`,
)
console.log('')
console.log(`category 별 (배타적 분류 · 합계 ${categoryTotal} = 총 ${assets.length}):`)
for (const [c, n] of byCategory) console.log(`  ${String(n).padStart(2)}  ${c}`)
console.log('')
console.log('겹치는 축 (위 분류와 따로 세지 말 것):')
console.log(`  kind        file ${byKind.file} · code ${byKind.code}`)
console.log(`  replace     ${mustReplace.length}건 — 리브랜딩 시 사람이 새로 만들어야 한다`)
for (const a of mustReplace) console.log(`    🔁 ${a.path}`)
console.log(`  locked      ${locked.length}건 — 외부 브랜드, 손대지 않는다`)
for (const a of locked) console.log(`    🔒 ${a.path}`)
console.log('')
console.log(`PNG 실측 ${pngSize.size}건 — 전부 적힌 크기와 일치`)
for (const [rel, s] of pngSize) console.log(`    ${s.width}x${s.height}  ${rel}`)
console.log(`manifest 아이콘 ${icons.length}건 — 경로·크기·MIME 전부 실제와 일치`)
console.log('가로형 로고 — 파일이 표시 상자의 정확히 2배 (@2x)')
console.log('가로형 로고 — 화면 주소 · OG 런타임 경로 · 파일 추적 설정이 모두 같은 파일을 가리킨다')
console.log('구 텍스트 워드마크 계약(HEAD·TAIL·SPLIT_AT) 코드 잔존 0건')
console.log('')
console.log('🔴 이 검사는 manifest 에 적힌 것만 본다 —')
console.log('   목록에 넣지 않은 새 자산, 이미지 **안에** 무엇이 그려져 있는지는 잡지 못한다.')
console.log('   크기는 재지만 "두 사람이 손을 맞대고 있는가" 는 사람이 본다.')

if (process.argv.includes('--verbose')) {
  console.log('')
  for (const a of assets) {
    const mark = a.locked ? '🔒' : a.replace ? '🔁' : '  '
    console.log(`  ${mark} [${a.category}/${a.kind}] ${a.path}`)
    console.log(`      ${a.use}`)
    console.log(`      ${a.note}`)
  }
}
