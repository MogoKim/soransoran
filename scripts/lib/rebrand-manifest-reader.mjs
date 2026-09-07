/**
 * 리브랜딩 manifest 읽기 — 가드들과 dry-run 이 함께 쓴다.
 *
 * 🔴 파서를 여러 벌 두지 않는다. 같은 파일을 다른 방식으로 읽으면
 *    한쪽만 고쳐졌을 때 검사들이 서로 다른 목록을 보고 조용히 갈라진다.
 *
 * 🔴 값이 비밀인 항목도 여기서는 **이름만** 읽는다. manifest 자체가 값을 갖고 있지 않다.
 *
 * 🔴 "지금 값"은 manifest 가 아니라 **정본 파일**에서 읽는다(readSymbolValues).
 *    검사기에 현재 값을 복사해 두면 정본이 바뀐 뒤 그 검사는 옛 값만 찾게 된다.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/** 리터럴 노드를 JS 값으로 — 문자열 이어붙이기(+)와 배열·객체를 함께 다룬다 */
function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = literal(node.left)
    const r = literal(node.right)
    if (typeof l === 'string' && typeof r === 'string') return l + r
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out = []
    for (const el of node.elements) {
      const v = literal(el)
      if (v !== undefined) out.push(v)
    }
    return out
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out = {}
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue
      const v = literal(p.initializer)
      if (v !== undefined) out[p.name.text] = v
    }
    return out
  }
  return undefined
}

/** REBRAND_CONFIGS 배열을 읽는다 */
export function readManifest(text) {
  const sf = ts.createSourceFile('m.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = []
  const visit = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'REBRAND_CONFIGS' &&
      n.initializer
    ) {
      let i = n.initializer
      while (ts.isAsExpression(i) || ts.isParenthesizedExpression(i)) i = i.expression
      if (ts.isArrayLiteralExpression(i)) {
        for (const el of i.elements) {
          if (!ts.isObjectLiteralExpression(el)) continue
          const o = literal(el)
          if (o && o.id) out.push(o)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** 파일 하나에서 `export const NAME = '값'` 형태의 문자열 상수를 읽는다 */
export function readSymbolValues(text) {
  const sf = ts.createSourceFile('c.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map()
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const v = literal(n.initializer)
      if (typeof v === 'string') out.set(n.name.text, v)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/**
 * manifest 항목의 **지금 값**을 정본 파일에서 읽어 붙인다.
 *
 * symbol 이 없는 항목(환경변수·외부 콘솔)은 current 가 undefined 로 남는다 —
 * 코드에 값이 없으므로 정상이다.
 */
export function resolveCurrentValues(configs, root, readFile) {
  const read =
    readFile ??
    ((rel) => {
      const abs = join(root, rel)
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null
    })
  const cache = new Map()
  return configs.map((c) => {
    if (!c.symbol || c.owner !== 'code') return { ...c, current: undefined }
    if (!cache.has(c.source)) {
      const text = read(c.source)
      cache.set(c.source, text === null ? new Map() : readSymbolValues(text))
    }
    return { ...c, current: cache.get(c.source).get(c.symbol) }
  })
}

/** 정규식 메타문자 이스케이프 — 도메인의 . 이 임의 문자가 되지 않도록 */
export function escapeRe(v) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 한 항목에서 검사할 값 목록을 만든다.
 *
 *   current  지금 값 — 정본(과 명시된 예외) 밖에 복사되면 안 된다
 *   legacy   옛 값  — legacyAllowed 밖 어디에도 남으면 안 된다
 *
 * 🔴 legacy 는 allowlist 가 비어 있으면 **어디에도 남을 수 없다**. 그게 기본값이다.
 */
export function valueTargets(config) {
  const out = []
  if (config.current) {
    out.push({
      id: config.id,
      kind: 'current',
      value: config.current,
      allowed: [config.source, ...(config.currentAlsoAllowed ?? []).map((a) => a.path)],
      fix: `${config.symbol} (${config.source})`,
    })
  }
  for (const v of config.legacyValues ?? []) {
    out.push({
      id: config.id,
      kind: 'legacy',
      value: v,
      allowed: (config.legacyAllowed ?? []).map((a) => a.path),
      fix: `옛 값이 남아 있습니다 — 새 값으로 바꾸거나 legacyAllowed 에 경로와 이유를 적으세요`,
    })
  }
  return out
}

/**
 * legacy 목록 자체의 무결성.
 *
 * 🔴 통과시키려고 legacy 를 비우지 않는다 — 비우면 잔존 검사가 사라진다.
 */
export function validateLegacy(configs) {
  const problems = []
  const seenAll = new Map() // 값 → 그 값을 등록한 id 들

  for (const c of configs) {
    const legacy = c.legacyValues
    if (legacy === undefined) continue

    if (c.secret && legacy.length) {
      problems.push(`비밀값은 legacy 에 넣지 않는다: ${c.id} (${c.source})`)
    }

    const seen = new Set()
    for (const v of legacy) {
      if (typeof v !== 'string' || v.trim() === '') {
        problems.push(`legacy 에 빈 값이 있습니다: ${c.id}`)
        continue
      }
      if (seen.has(v)) problems.push(`legacy 값 중복: ${c.id} 안에서 같은 값이 두 번`)
      seen.add(v)
      if (c.current && v === c.current) {
        problems.push(
          `현재 값을 legacy 에 넣지 않는다: ${c.id} — 정본을 바꾸기 전에 옮기면 둘이 같아진다`,
        )
      }
      const others = seenAll.get(v) ?? []
      if (others.length) problems.push(`legacy 값이 여러 항목에 중복 등록: ${v ? `${others[0]} ↔ ${c.id}` : ''}`)
      seenAll.set(v, [...others, c.id])
    }

    for (const a of [...(c.legacyAllowed ?? []), ...(c.currentAlsoAllowed ?? [])]) {
      if (!a.path || !a.why) {
        problems.push(`legacyAllowed 에는 path 와 why 가 모두 필요합니다: ${c.id}`)
      }
      if (a.path && a.path.endsWith('/')) {
        problems.push(`legacyAllowed 는 디렉터리를 열지 않는다 — 파일 경로로 적으세요: ${c.id} → ${a.path}`)
      }
    }
  }
  return problems
}
