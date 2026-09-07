/**
 * 색상 토큰 읽기 — parity 검사와 대비 검사가 함께 쓴다.
 *
 * 🔴 파서를 두 벌 두지 않는다. 같은 파일을 두 방식으로 읽기 시작하면
 *    한쪽만 고쳐졌을 때 두 검사가 서로 다른 값을 보고 조용히 갈라진다.
 */
import ts from 'typescript'

/** #abc → #aabbcc · 소문자 통일 */
export function normalize(v) {
  const s = String(v).trim().toLowerCase()
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
export function readCssTokens(text) {
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
    const value = m[2].split('/*')[0].trim() // 값 뒤 주석 제거
    if (!tokens.has(name)) tokens.set(name, value)
  }
  return tokens
}

/** var(--x) 를 실제 값까지 따라간다 (--cta: var(--brand) 같은 경우) */
export function resolve(tokens, name, seen = new Set()) {
  if (seen.has(name)) return null // 순환 참조
  seen.add(name)
  const raw = tokens.get(name)
  if (raw === undefined) return null
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(raw)
  if (ref) return resolve(tokens, ref[1], seen)
  return normalize(raw)
}

/** brand.ts 의 BRAND 객체에서 문자열 프로퍼티를 읽는다 (정규식 대신 파서) */
export function readBrandConstants(text) {
  const sf = ts.createSourceFile('brand.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map()
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'BRAND' &&
      node.initializer
    ) {
      let init = node.initializer
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
      if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            ts.isStringLiteral(p.initializer)
          ) {
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

/** #rrggbb → [r,g,b] (0~255) */
export function toRgb(hex) {
  const h = normalize(hex)
  const m = /^#([0-9a-f]{6})$/.exec(h)
  if (!m) return null
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
}

/** WCAG 2.x 상대 휘도 */
export function luminance(hex) {
  const rgb = toRgb(hex)
  if (!rgb) return null
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 대비비. 소수 둘째 자리에서 내림(반올림으로 기준을 넘기지 않기 위해) */
export function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  if (a === null || b === null) return null
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  return Math.floor(ratio * 100) / 100
}
