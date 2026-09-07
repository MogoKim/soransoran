#!/usr/bin/env node
/**
 * 색상 정본 관계 검사 (parity)
 *
 * 색은 정의가 두 곳에 있다. 나눌 수밖에 없는 이유가 있다:
 *   src/app/globals.css  화면에 그려지는 모든 색 (CSS 변수)
 *   src/lib/brand.ts     metadata·manifest·next/og — CSS 변수를 해석하지 못하는 자리
 *
 * 🔴 두 곳이라는 사실 자체는 문제가 아니다. 문제는 **한쪽만 움직이는 것**이다.
 *    globals.css 를 고치면 화면은 바뀌지만 OG 이미지·manifest·최후 에러 화면은
 *    옛 색으로 남는다. 빌드도 타입도 통과하고, 아무도 모른 채 배포된다.
 *    (실제로 그 상태가 하나 있다 — 아래 KNOWN_DRIFT 참조)
 *
 * 🔴 이름이 비슷하다고 묶지 않는다. 아래 세 목록은 코드 사용처를 확인해 갈랐다.
 *    PAIRS        같은 역할 · 같아야 함
 *    KNOWN_DRIFT  지금 다름 · 다른 이유가 기록돼 있음 · 더 벌어지면 실패
 *    NOT_PAIRED   이름은 비슷하나 역할이 달라 **묶지 않기로 판정한 것**
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const CSS = join(ROOT, 'src/app/globals.css')
const BRAND_TS = join(ROOT, 'src/lib/brand.ts')

/** 같은 역할이므로 값이 일치해야 하는 쌍 */
const PAIRS = [
  { brand: 'color', css: '--brand', why: '브랜드 시그니처 — theme-color · OG 장식 면' },
  { brand: 'ink', css: '--brand-ink', why: '읽는 브랜드색 — OG 워드마크' },
  { brand: 'text', css: '--text-primary', why: '본문 텍스트 — OG 카피' },
  { brand: 'onBrand', css: '--cta-text', why: 'CTA 위 흰 글씨' },
  { brand: 'muted', css: '--text-muted', why: '보조 텍스트' },
  /**
   * 🔴 BRAND.cta 의 짝은 --cta 가 아니라 --cta-edge 다. 사용처로 판정했다.
   *    --cta 는 var(--brand) = 코랄이고 화면 CTA 버튼의 fill 이다(§3-1-B 코랄 전환).
   *    BRAND.cta 는 global-error.tsx 한 곳에서만 쓰이는데, 그 화면은 CSS 가 없을 수 있어
   *    흰 글씨 대비를 값 자체로 보장해야 한다 — 코랄은 흰 글씨에 2.73:1 로 미달이다.
   *    그 역할을 지는 토큰이 --cta-edge(#b64235, 흰 글씨 5.50:1)이고 값도 같다.
   */
  { brand: 'cta', css: '--cta-edge', why: 'CSS 없이도 흰 글씨가 읽혀야 하는 진한 액션색' },
]

/**
 * 지금 값이 다르고, 다른 이유가 기록돼 있는 쌍.
 *
 * 🔴 통과시키되 눈에 보이게 둔다. 조용히 목록에서 빼면 그대로 굳는다.
 * 🔴 값이 같아지면 이 목록에서 빼고 PAIRS 로 올려야 한다 — 그때 검사가 알려준다.
 */
const KNOWN_DRIFT = [
  {
    brand: 'background',
    css: '--surface-app',
    why:
      'globals.css 는 #fff8f6 을 "이전 값"으로 명시하고 버렸다(§3-2 개정 2026-08-27) — ' +
      '면적이 가장 넓은 바탕에 브랜드 계열을 깔면 화면 전체가 분홍으로 읽히고 CTA 가 묻힌다. ' +
      '화면 바탕은 --surface-app(#f9fafb)이 지는데 BRAND.background 만 옛 값에 남았다. ' +
      'manifest background_color · OG 배경 2곳 · global-error 배경이 그 값을 쓴다. ' +
      '해소는 렌더가 실제로 바뀌는 변경이라 단독으로 다룬다.',
  },
]

/** 이름은 비슷하나 역할이 달라 묶지 않기로 판정한 것 — 재발 방지용 기록 */
const NOT_PAIRED = [
  {
    brand: 'cta',
    css: '--cta',
    why: '--cta 는 코랄 fill(var(--brand)), BRAND.cta 는 흰 글씨용 진한 색. BRAND.cta 의 짝은 --cta-edge 다.',
  },
]

/** #abc → #aabbcc · 소문자 통일 */
function normalize(v) {
  const s = v.trim().toLowerCase()
  const m = /^#([0-9a-f]{3})$/.exec(s)
  if (m) return '#' + [...m[1]].map((c) => c + c).join('')
  return s
}

/**
 * globals.css 의 첫 :root 블록에서 토큰을 읽는다.
 *
 * 첫 블록만 보는 이유: 뒤쪽의 [data-font-size] · admin scope 블록은 크기·표면을
 * 재정의하는 곳이라, 거기까지 훑으면 같은 이름이 덮여 엉뚱한 값이 잡힌다.
 */
function readCssTokens(text) {
  const start = text.indexOf(':root')
  if (start === -1) throw new Error('globals.css 에서 :root 를 찾지 못했습니다')
  const open = text.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('globals.css 의 :root 블록이 닫히지 않았습니다')

  const body = text.slice(open + 1, end)
  const tokens = new Map()
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const name = m[1]
    // 값에서 뒤따르는 주석을 떼어낸다
    const value = m[2].split('/*')[0].trim()
    if (!tokens.has(name)) tokens.set(name, value)
  }
  return tokens
}

/** var(--x) 를 실제 값까지 따라간다 (--cta: var(--brand) 같은 경우) */
function resolve(tokens, name, seen = new Set()) {
  if (seen.has(name)) return null // 순환 참조
  seen.add(name)
  const raw = tokens.get(name)
  if (raw === undefined) return null
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw)
  if (ref) return resolve(tokens, ref[1], seen)
  return normalize(raw)
}

/** brand.ts 의 BRAND 객체에서 문자열 프로퍼티를 읽는다 (정규식 대신 파서) */
function readBrandConstants(text) {
  const sf = ts.createSourceFile('brand.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map()
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'BRAND' &&
      node.initializer
    ) {
      // `as const` 를 벗겨 객체 리터럴에 닿는다
      let init = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ts.isStringLiteral(p.initializer)) {
            out.set(p.name.text, normalize(p.initializer.text))
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 대조 본체. 파일을 읽지 않으므로 self-test 가 그대로 쓴다 */
function compare(brandMap, cssTokens) {
  const mismatched = []
  const missing = []
  const healed = []

  for (const pair of PAIRS) {
    const a = brandMap.get(pair.brand)
    const b = resolve(cssTokens, pair.css)
    if (a === undefined || b === null) {
      missing.push({ ...pair, a, b })
      continue
    }
    if (a !== b) mismatched.push({ ...pair, a, b })
  }

  for (const pair of KNOWN_DRIFT) {
    const a = brandMap.get(pair.brand)
    const b = resolve(cssTokens, pair.css)
    if (a === undefined || b === null) {
      missing.push({ ...pair, a, b })
      continue
    }
    if (a === b) healed.push({ ...pair, a, b })
  }

  return { mismatched, missing, healed }
}

/** self-test — 파일을 만들지 않고 Map 만으로 검사기 자신을 확인한다 */
function selfTest() {
  const css = new Map([
    ['--brand', '#ff6f61'],
    ['--cta', 'var(--brand)'],
    ['--x-short', '#fff'],
  ])
  const checks = [
    ['var() 를 따라간다', resolve(css, '--cta') === '#ff6f61'],
    ['#abc 를 #aabbcc 로 편다', resolve(css, '--x-short') === '#ffffff'],
    ['없는 토큰은 null', resolve(css, '--nope') === null],
    [
      'brand.ts 파싱 — as const 를 벗긴다',
      readBrandConstants("export const BRAND = { color: '#FF6F61' } as const").get('color') ===
        '#ff6f61',
    ],
    [
      ':root 블록만 읽는다',
      readCssTokens(':root { --a: #111111; }\n[data-x] { --a: #222222; }').get('--a') === '#111111',
    ],
    [
      '값 뒤 주석을 떼어낸다',
      readCssTokens(':root { --a: #111111; /* 메모 */ }').get('--a') === '#111111',
    ],
    [
      '불일치를 잡는다',
      compare(new Map([['color', '#000000']]), new Map([['--brand', '#ff6f61']])).mismatched
        .length === 1,
    ],
    [
      'KNOWN_DRIFT 가 같아지면 알린다',
      compare(
        new Map([['background', '#f9fafb']]),
        new Map([['--surface-app', '#f9fafb']]),
      ).healed.length === 1,
    ],
  ]
  const failed = checks.filter(([, ok]) => !ok).map(([why]) => why)
  if (failed.length) {
    console.error('🔴 색상 parity self-test 실패 — 검사기 자신이 고장났습니다:\n')
    for (const f of failed) console.error(`  ${f}`)
    process.exit(1)
  }
  return checks.length
}

const selfTestCount = selfTest()

const cssTokens = readCssTokens(readFileSync(CSS, 'utf8'))
const brandMap = readBrandConstants(readFileSync(BRAND_TS, 'utf8'))
const { mismatched, missing, healed } = compare(brandMap, cssTokens)

if (missing.length) {
  console.error('색상 parity 검사: 대조할 값을 찾지 못했습니다 (이름이 바뀌었을 수 있습니다):\n')
  for (const m of missing) {
    console.error(`  BRAND.${m.brand} = ${m.a ?? '(없음)'}   ${m.css} = ${m.b ?? '(없음)'}`)
  }
  process.exit(1)
}

if (mismatched.length) {
  console.error('색상 정본 두 곳의 값이 어긋났습니다:\n')
  for (const m of mismatched) {
    console.error(`  ${m.why}`)
    console.error(`    src/lib/brand.ts   BRAND.${m.brand} = ${m.a}`)
    console.error(`    src/app/globals.css ${m.css} = ${m.b}`)
    console.error('')
  }
  console.error(
    `총 ${mismatched.length}건. 한쪽만 고치면 화면과 OG·manifest·최후 에러 화면의 색이 갈립니다.`,
  )
  process.exit(1)
}

console.log(`색상 parity 통과 — 대조 ${PAIRS.length}쌍 일치 (self-test ${selfTestCount}건 통과)`)

for (const h of healed) {
  console.log('')
  console.log(`ℹ️  BRAND.${h.brand} 와 ${h.css} 의 값이 같아졌습니다 (${h.a}).`)
  console.log('    KNOWN_DRIFT 에서 빼고 PAIRS 로 올리세요 — 그래야 다시 벌어질 때 잡힙니다.')
}

if (KNOWN_DRIFT.length && !healed.length) {
  console.log('')
  console.log('알려진 불일치 (실패로 보지 않음):')
  for (const d of KNOWN_DRIFT) {
    const a = brandMap.get(d.brand)
    const b = resolve(cssTokens, d.css)
    console.log(`  BRAND.${d.brand} = ${a}   ↔   ${d.css} = ${b}`)
  }
}

if (NOT_PAIRED.length) {
  console.log('')
  console.log('묶지 않기로 판정한 쌍 (역할이 다름):')
  for (const n of NOT_PAIRED) console.log(`  BRAND.${n.brand} ↮ ${n.css}`)
}
