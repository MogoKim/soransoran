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
 *    (실제로 BRAND.background 가 그 상태였다. 웜 모노크롬 전환에서 해소해 PAIRS 로 올렸다)
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
  { brand: 'ink', css: '--brand-ink', why: '큰 글씨 브랜드색 — 화면 --brand-ink 의 CSS 밖 짝' },
  /**
   * 🕘 2026-09-21 까지는 두 색 워드마크의 뒤 조각이었다. 로고가 이미지로 바뀌어
   *    BRAND.strong 을 읽는 코드는 0 이 됐지만, 화면의 --brand-strong 은 작은 글씨
   *    브랜드 텍스트·배지가 계속 쓴다. 짝을 지우면 그 값이 혼자 움직여도 아무도 모른다.
   */
  { brand: 'strong', css: '--brand-strong', why: '진한 주황 — 화면 토큰이 혼자 움직이는지 보는 짝' },
  { brand: 'text', css: '--text-primary', why: '본문 텍스트 — OG 카피' },
  { brand: 'onBrand', css: '--cta-content', why: '고객 primary CTA 의 글자·아이콘' },
  { brand: 'muted', css: '--text-muted', why: '보조 텍스트' },
  /**
   * 🔴 BRAND.cta 의 짝은 --cta 다. 둘 다 **대표 행동의 면**을 칠하는 같은 역할이다.
   *
   *    이전에는 --cta-edge 와 묶여 있었다. 그 판정의 근거는 "CSS 가 없을 수 있는
   *    global-error 화면에서 흰 글씨가 값 자체로 읽혀야 한다" 였는데,
   *    그 일은 이제 **내용색 짝**이 따로 진다 — BRAND.onBrand ↔ --cta-content 다.
   *
   *    현재 고객 CTA 의 내용은 **흰색(#ffffff)** 이다. 흰색은 원색 면 위에서 3.53:1 이라
   *    **text-lg + font-bold 계약과 한 몸**으로만 성립한다(큰 굵은 글씨 3:1).
   *    그 계약은 check-contrast.mjs 의 고객 CTA 계약 검사가 className 표현마다 확인한다.
   *    admin compact 버튼만 13~14px 이라 흰색을 못 쓰고 --text-primary 먹색(4.65:1)을 쓴다.
   *
   *    그래서 여기서는 **면끼리만** 묶는다. 면끼리 묶이지 않으면 화면 CTA 와
   *    최후 에러 화면 버튼이 서로 다른 색이 된다.
   *
   * 🔴 --cta 는 `var(--brand)` 라 문자열 그대로는 비교할 수 없다.
   *    resolveVar 가 최종값(#fa4601)까지 따라가서 대조한다 — 느슨하게 만든 것이 아니다.
   */
  { brand: 'cta', css: '--cta', why: '대표 행동 면 — 화면 CTA 와 CSS 없는 화면의 버튼이 같아야 한다' },
  /**
   * 🔴 웜 모노크롬 전환에서 KNOWN_DRIFT 를 해소하고 정식 PAIR 로 올렸다.
   *    이전에는 brand.ts 만 폐기된 옛 바탕색에 남아 화면과 갈려 있었다 —
   *    manifest background_color · OG 배경 · 최후 에러 화면이 그 값을 쓰는데
   *    화면 바탕은 --surface-app 이 져서, 공유 카드와 홈 화면의 바탕이 서로 달랐다.
   */
  { brand: 'background', css: '--surface-app', why: '페이지 바탕 — manifest·OG 배경과 화면이 같아야 한다' },
]

/**
 * 지금 값이 다르고, 다른 이유가 기록돼 있는 쌍.
 *
 * 🔴 통과시키되 눈에 보이게 둔다. 조용히 목록에서 빼면 그대로 굳는다.
 * 🔴 값이 같아지면 이 목록에서 빼고 PAIRS 로 올려야 한다 — 그때 검사가 알려준다.
 *
 * 🔴 지금은 비어 있다. BRAND.background 가 유일한 drift 였고
 *    웜 모노크롬 전환에서 --surface-app 과 값을 맞춰 PAIRS 로 올렸다.
 */
const KNOWN_DRIFT = []
/** 이름은 비슷하나 역할이 달라 묶지 않기로 판정한 것 — 재발 방지용 기록 */
const NOT_PAIRED = [
  {
    brand: 'cta',
    css: '--cta-edge',
    why:
      '--cta-edge 는 숨은 접근성 유틸 전용의 진한 보조색이고, BRAND.cta 는 대표 행동 면이다. ' +
      '두 값이 달라진 지금(#c43300 vs #fa4601) 묶으면 어느 한쪽이 잘못 따라간다 — ' +
      'BRAND.cta 의 짝은 --cta 다.',
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

/**
 * 대조 본체. 파일을 읽지 않으므로 self-test 가 그대로 쓴다.
 *
 * 🔴 목록을 인자로 받는다 — self-test 가 실제 PAIRS·KNOWN_DRIFT 에 의존하면
 *    목록이 비는 순간(=drift 해소) 검사기 자신의 테스트가 깨진다.
 */
function compare(brandMap, cssTokens, { pairs = PAIRS, drift = KNOWN_DRIFT } = {}) {
  const mismatched = []
  const missing = []
  const healed = []

  for (const pair of pairs) {
    const a = brandMap.get(pair.brand)
    const b = resolve(cssTokens, pair.css)
    if (a === undefined || b === null) {
      missing.push({ ...pair, a, b })
      continue
    }
    if (a !== b) mismatched.push({ ...pair, a, b })
  }

  for (const pair of drift) {
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
  // 가짜 값이다 — 실제 팔레트가 바뀌어도 이 테스트는 그대로 유효해야 한다
  const css = new Map([
    ['--sample', '#123456'],
    ['--ref', 'var(--sample)'],
    ['--x-short', '#fff'],
  ])
  const checks = [
    ['var() 를 따라간다', resolve(css, '--ref') === '#123456'],
    ['#abc 를 #aabbcc 로 편다', resolve(css, '--x-short') === '#ffffff'],
    ['없는 토큰은 null', resolve(css, '--nope') === null],
    [
      'brand.ts 파싱 — as const 를 벗긴다',
      readBrandConstants("export const BRAND = { color: '#AABBCC' } as const").get('color') ===
        '#aabbcc',
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
      compare(new Map([['x', '#000000']]), new Map([['--x', '#ffffff']]), {
        pairs: [{ brand: 'x', css: '--x', why: 't' }],
        drift: [],
      }).mismatched.length === 1,
    ],
    [
      '일치하면 통과',
      compare(new Map([['x', '#ffffff']]), new Map([['--x', '#ffffff']]), {
        pairs: [{ brand: 'x', css: '--x', why: 't' }],
        drift: [],
      }).mismatched.length === 0,
    ],
    [
      'KNOWN_DRIFT 가 같아지면 알린다',
      compare(new Map([['y', '#ffffff']]), new Map([['--y', '#ffffff']]), {
        pairs: [],
        drift: [{ brand: 'y', css: '--y', why: 't' }],
      }).healed.length === 1,
    ],
    [
      'KNOWN_DRIFT 가 아직 다르면 조용하다',
      compare(new Map([['y', '#000000']]), new Map([['--y', '#ffffff']]), {
        pairs: [],
        drift: [{ brand: 'y', css: '--y', why: 't' }],
      }).healed.length === 0,
    ],
    ['지금 KNOWN_DRIFT 는 비어 있다', KNOWN_DRIFT.length === 0],
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
