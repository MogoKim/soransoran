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
 *
 * ── 🔴 보장하지 못하는 것 (과장하지 않는다) ──
 *   · **manifest 에 적지 않은 새 브랜드 자산은 찾아내지 못한다.**
 *     누군가 로고 이미지를 추가하고 목록에 넣지 않으면 이 검사는 그대로 통과한다.
 *     자동 탐색은 매거진·사용자 이미지까지 끌어와 오탐이 되므로 하지 않는다.
 *   · 이미지 **안에** 브랜드 요소(글자·로고)가 있는지 시각적으로 판정하지 못한다.
 *   · 새 로고·아이콘을 만들어 주지 않는다. 교체는 사람의 일이다.
 *
 * 🔴 이미지 파일 자체는 읽기만 한다. 수정·이동·이름 변경을 하지 않는다.
 *
 * manifest 는 src/lib/brand-assets.ts 다. TypeScript 파일이라 node 가 직접 못 읽으므로
 * 파서로 배열 리터럴을 훑는다 — 새 dependency 없이 tsc 만 쓴다.
 */
import { existsSync, statSync, readFileSync } from 'node:fs'
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
  const entry = (path, category, extra = '') =>
    `{ path: '${path}', kind: 'file', category: '${category}', use: 'x', replace: false, locked: false, note: 'n'${extra} }`
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
console.log('🔴 이 검사는 manifest 에 적힌 것만 본다 —')
console.log('   목록에 넣지 않은 새 자산, 이미지 안의 브랜드 요소는 잡지 못한다.')

if (process.argv.includes('--verbose')) {
  console.log('')
  for (const a of assets) {
    const mark = a.locked ? '🔒' : a.replace ? '🔁' : '  '
    console.log(`  ${mark} [${a.category}/${a.kind}] ${a.path}`)
    console.log(`      ${a.use}`)
    console.log(`      ${a.note}`)
  }
}
