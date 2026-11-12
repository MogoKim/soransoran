/**
 * graph control.ts 판독 — **`export const CONTROL` 텍스트 판독의 정의는 여기 한 곳이다** (S1 C5 · 2026-11-10).
 *
 * 판독 프로필 두 개를 **각자의 필드 규칙 그대로** 둔다 — 하나로 합치지 않는다(합치면 legacy 판정이 바뀐다).
 *   parseControlText   legacy builder 프로필(graph-build · research-current · g8). 느슨하다 — 형식을 String 으로 맞춰 읽는다.
 *                      반환: { graphVersion, enabled, enabledClusters, surfaces, killSwitchTripped }
 *   parseGraphControl  엄격 프로필(direct-spec-source · S2 admission). 형식이 다르면 null.
 *                      반환: { graphVersion, enabled, enabledClusters, surfaces, killSwitch: { tripped } }
 * 공유하는 것은 **선언 찾기**(locateControlObject → controlLiteral)와 **데이터 전용 판독**(evalControl → parseDataLiteral)뿐이다.
 *   필드 검증 · 강제 변환은 공유하지 않는다 — 두 프로필이 앞판의 필드 규칙을 각자 지킨다.
 *
 * 🔴 선언 찾기는 토큰 단위다(S2 P1-B · 2026-11-10). 주석 · 문자열 · template literal · 정규식 안의 가짜 `export const CONTROL`,
 *    `CONTROLLER` · `CONTROL_EXTRA` 같은 부분 일치 이름은 선언이 아니다. 최상위 실제 선언이 0개 · 2개 이상 · 토큰 판독 실패면
 *    두 프로필 모두 null(fail-closed)이다. 앞판은 텍스트 첫 출현(indexOf)을 읽어, 주석 속 가짜 선언이 실제 kill switch ·
 *    graph 꺼짐을 덮을 수 있었다(fail-open). 토큰 판독기는 편집 helper(`magazine-graph-control-edit.mjs`)에 있던 것을 그대로 옮겼고,
 *    편집 helper 는 이제 여기 locateControlObject 를 쓴다(판독기 한 벌).
 * 🔴 값 판독은 JS 를 실행하지 않는다(S2 P1-B). 앞판은 vm 평가였다 — getter · 함수 호출이 읽는 순간 실행되고, 중복 key 는 마지막 값이
 *    조용히 이겼다. 지금은 parseDataLiteral(JSON 과 같은 데이터만 · 중복 key · getter · 계산 key · spread · 호출 거부)이고 실패는 null 이다.
 *    같은 locateConstLiteral · parseDataLiteral 을 S2 admission 의 articles · legacy queue 신원 판독도 쓴다(P1-D · 한 벌).
 * 앞판: 같은 찾기·자르기·eval 이 `magazine-graph-build.mjs` 와 `magazine-direct-spec-source.mjs` 에 한 벌씩 있었다.
 *       두 파일은 같은 이름을 **같은 함수 그대로** 다시 내보낸다(호환 export · 경계 검사 R11).
 * 🔴 import 시점 부작용 0 — `magazine-literal.mjs` 만 import 한다(`magazine-load.mjs` 의 drafts 주입 차단을 끌어오지 않는다).
 * 사본이 다시 생기는지는 `scripts/magazine-vnext-boundary-check.mjs`(R6 · R11 · R13~R15)가 본다.
 */
import { sliceLiteral } from './magazine-literal.mjs'

/** 선언 찾기 · 데이터 판독 실패 — code: <prefix>_NOT_FOUND · <prefix>_AMBIGUOUS · <prefix>_PARSE_FAILED · LITERAL_NOT_DATA · LITERAL_DUPLICATE_KEY */
export class ControlLocateError extends Error {
  constructor(code, why, detail = null) { super(`${code}: ${why}`); this.code = code; this.why = why; this.detail = detail }
}
const fail = (code, why, detail) => { throw new ControlLocateError(code, why, detail) }

// ── lexical scanner — 주석 · 문자열 · template literal(${} 중첩) · 정규식 리터럴을 건너뛰고 코드 토큰만 낸다 ──
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])
const isIdStart = (c) => /[A-Za-z_$]/.test(c)
const isIdPart = (c) => /[A-Za-z0-9_$]/.test(c)

/**
 * src[i..] 를 코드로 읽는다. nested 면 짝이 맞는 `}` (template `${ }` 의 끝)에서 멈춘다.
 * @returns {{ toks: { type: 'word'|'punct'|'string'|'template'|'regex'|'number', value?: string, start: number, end: number }[], end: number }}
 */
function lex(src, i, nested) {
  const toks = []
  const n = src.length
  let depth = 0
  const regexAllowed = () => {
    const p = toks[toks.length - 1]
    if (!p) return true
    if (p.type === 'word') return KEYWORDS_BEFORE_REGEX.has(p.value)
    if (p.type === 'punct') return !(p.value === ')' || p.value === ']' || p.value === '}')
    return false
  }
  while (i < n) {
    const ch = src[i], next = src[i + 1]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '/' && next === '/') { const e = src.indexOf('\n', i); i = e === -1 ? n : e; continue }
    if (ch === '/' && next === '*') {
      const e = src.indexOf('*/', i + 2)
      if (e === -1) fail('CONTROL_PARSE_FAILED', '닫히지 않은 block 주석')
      i = e + 2; continue
    }
    if (ch === "'" || ch === '"') {
      const s = i++
      while (i < n && src[i] !== ch) { if (src[i] === '\\') i++; else if (src[i] === '\n') fail('CONTROL_PARSE_FAILED', '닫히지 않은 문자열'); i++ }
      if (i >= n) fail('CONTROL_PARSE_FAILED', '닫히지 않은 문자열')
      toks.push({ type: 'string', start: s, end: ++i }); continue
    }
    if (ch === '`') {
      const s = i++
      const parts = [] // `${ }` 안의 코드 토큰 — 바깥 깊이 계산에는 섞지 않고 codeTokens 만 펼친다
      for (;;) {
        if (i >= n) fail('CONTROL_PARSE_FAILED', '닫히지 않은 template literal')
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '`') { i++; break }
        if (src[i] === '$' && src[i + 1] === '{') { const inner = lex(src, i + 2, true); parts.push(...inner.toks); i = inner.end; continue }
        i++
      }
      toks.push({ type: 'template', start: s, end: i, parts }); continue
    }
    if (ch === '/' && regexAllowed()) {
      const s = i++
      let inClass = false
      for (;;) {
        if (i >= n || src[i] === '\n') fail('CONTROL_PARSE_FAILED', '닫히지 않은 정규식')
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '[') inClass = true
        else if (src[i] === ']') inClass = false
        else if (src[i] === '/' && !inClass) { i++; break }
        i++
      }
      while (i < n && isIdPart(src[i])) i++
      toks.push({ type: 'regex', start: s, end: i }); continue
    }
    if (isIdStart(ch)) {
      const s = i
      while (i < n && isIdPart(src[i])) i++
      toks.push({ type: 'word', value: src.slice(s, i), start: s, end: i }); continue
    }
    if (/[0-9]/.test(ch)) {
      const s = i
      while (i < n && /[0-9A-Za-z_.]/.test(src[i])) i++
      toks.push({ type: 'number', start: s, end: i }); continue
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (nested && ch === '}' && depth === 0) return { toks, end: i + 1 }
      depth--
    }
    toks.push({ type: 'punct', value: ch, start: i, end: i + 1 })
    i++
  }
  if (nested) fail('CONTROL_PARSE_FAILED', '닫히지 않은 template 식')
  return { toks, end: i }
}

/**
 * 모듈 텍스트의 **코드 토큰 전부** — 주석 · 문자열 · 정규식 본문은 토큰 하나로 건너뛰고, template `${ }` 안의 코드 토큰은 펼친다.
 * 경계 검사 R17(순수 폐포 import · 금지 접근 판정)이 정규식 대신 쓴다(S2 P1-3). 판독 실패는 ControlLocateError 로 던진다.
 * @returns {{ type: string, value?: string, start: number, end: number }[]}
 */
export function codeTokens(src) {
  const out = []
  const walk = (toks) => { for (const t of toks) { out.push(t); if (t.type === 'template' && t.parts.length) walk(t.parts) } }
  walk(lex(String(src), 0, false).toks)
  return out
}

const isDeclName = (w, name) => w === name
const OPEN = new Set(['{', '(', '[']), CLOSE = new Set(['}', ')', ']'])

/**
 * 🔴 실제 선언만 — 최상위 코드 토큰 `[export] const <name> … = <open> … <close>` 의 리터럴 [start, end) 와 선언 위치(declStart).
 *    S2 P1-B · P1-D: CONTROL · MAGAZINE_ARTICLE_RECORD · TOPIC_QUEUE 판독이 **같은 한 벌**을 쓴다(텍스트 첫 출현 indexOf 금지).
 *    최상위 `const <name>` 이 0개면 <prefix>_NOT_FOUND · 2개 이상이면 <prefix>_AMBIGUOUS(export 여부와 무관하게 센다 —
 *    export 없는 같은 이름 선언도 판독 대상을 모호하게 만든다) · exported 인데 export 가 없으면 <prefix>_NOT_FOUND ·
 *    토큰 판독 실패 · 초기값이 open 리터럴이 아니면 <prefix>_PARSE_FAILED — 전부 ControlLocateError 로 던진다.
 * @param {string} src
 * @param {{ name: string, exported: boolean, open: '{'|'[', prefix: string }} spec
 */
export function locateConstLiteral(src, { name, exported, open: want, prefix }) {
  const { toks } = lex(src, 0, false)
  const decls = []
  let depth = 0
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (t.type === 'punct') { if (OPEN.has(t.value)) depth++; else if (CLOSE.has(t.value)) depth--; continue }
    if (depth === 0 && t.type === 'word' && t.value === 'const'
      && !(toks[k - 1]?.type === 'punct' && toks[k - 1].value === '.')
      && toks[k + 1]?.type === 'word' && isDeclName(toks[k + 1].value, name)) decls.push(k + 1)
  }
  const label = `${exported ? 'export ' : ''}const ${name}`
  if (decls.length === 0) fail(`${prefix}_NOT_FOUND`, `실제 ${label} 선언이 없다`)
  if (decls.length > 1) fail(`${prefix}_AMBIGUOUS`, `실제 ${label} 선언이 ${decls.length}개다`)
  const isExported = toks[decls[0] - 2]?.type === 'word' && toks[decls[0] - 2].value === 'export'
  if (exported && !isExported) fail(`${prefix}_NOT_FOUND`, `실제 ${label} 선언이 없다(export 없음)`)
  // 타입 표기를 건너뛰어 같은 깊이의 `=` 를 찾는다 (`=>` 는 타입의 함수 화살표)
  let k = decls[0] + 1, d = 0
  for (; k < toks.length; k++) {
    const t = toks[k]
    if (t.type !== 'punct') continue
    if (OPEN.has(t.value)) d++
    else if (CLOSE.has(t.value)) d--
    else if (d === 0 && t.value === '=' && !(toks[k + 1]?.type === 'punct' && toks[k + 1].value === '>' && toks[k + 1].start === t.end)) break
  }
  const open = toks[k + 1]
  if (k >= toks.length || !open || open.type !== 'punct' || open.value !== want) fail(`${prefix}_PARSE_FAILED`, `${name} 의 초기값이 ${want === '{' ? '객체' : '배열'} 리터럴이 아니다`)
  let depth2 = 0
  for (let m = k + 1; m < toks.length; m++) {
    const t = toks[m]
    if (t.type !== 'punct') continue
    if (OPEN.has(t.value)) depth2++
    else if (CLOSE.has(t.value) && --depth2 === 0) return { declStart: toks[decls[0] - (isExported ? 2 : 1)].start, start: open.start, end: t.end }
  }
  return fail(`${prefix}_PARSE_FAILED`, `${name} 리터럴의 끝을 찾지 못했다`)
}

/** 실제 최상위 `export const CONTROL … = { … }` — 코드 CONTROL_NOT_FOUND · CONTROL_AMBIGUOUS · CONTROL_PARSE_FAILED */
export const locateControlObject = (src) => locateConstLiteral(src, { name: 'CONTROL', exported: true, open: '{', prefix: 'CONTROL' })

// ── 데이터 전용 리터럴 판독 (S2 P1-B · P1-D) ──────────────────────
// 🔴 JS 를 실행하지 않는다(vm 평가 0). 같은 lexer 의 토큰 위에서 JSON 과 같은 데이터만 받는다:
//    객체(식별자 · 따옴표 key) · 배열 · 따옴표 문자열 · 10진수(음수 포함) · true · false · null · 주석 · 끝 쉼표.
//    getter/setter · method · 계산 key · spread · shorthand · 함수 호출 · 식별자 값(undefined · NaN 포함) · template literal ·
//    정규식 · 빈 칸 배열 · 숫자 key · `__proto__` key · **중복 key** 는 전부 LITERAL_NOT_DATA / LITERAL_DUPLICATE_KEY 로 던진다.
//    이유: eval 은 중복 key 를 조용히 마지막 값으로 덮고(같은 slug 두 번 · kill switch 두 번), getter · 호출은 읽는 순간 실행된다.
const DATA_NUMBER_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/

/** 따옴표 문자열 토큰 본문 → 값. 8진 escape 는 거부(strict mode 와 같은 뜻) */
function decodeStringToken(raw) {
  const body = raw.slice(1, -1)
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') { out += ch; continue }
    const e = body[++i]
    const hex = (n) => { const h = body.slice(i + 1, i + 1 + n); if (!new RegExp(`^[0-9A-Fa-f]{${n}}$`).test(h)) fail('LITERAL_NOT_DATA', `잘못된 escape \\${e}${h}`); i += n; return parseInt(h, 16) }
    if (e === 'n') out += '\n'
    else if (e === 'r') out += '\r'
    else if (e === 't') out += '\t'
    else if (e === 'b') out += '\b'
    else if (e === 'f') out += '\f'
    else if (e === 'v') out += '\v'
    else if (e === '0' && !/[0-9]/.test(body[i + 1] ?? '')) out += '\0'
    else if (e === 'x') out += String.fromCharCode(hex(2))
    else if (e === 'u' && body[i + 1] === '{') {
      const close = body.indexOf('}', i + 2)
      const h = close === -1 ? '' : body.slice(i + 2, close)
      if (!/^[0-9A-Fa-f]{1,6}$/.test(h) || parseInt(h, 16) > 0x10ffff) fail('LITERAL_NOT_DATA', `잘못된 escape \\u{${h}}`)
      out += String.fromCodePoint(parseInt(h, 16)); i = close
    } else if (e === 'u') out += String.fromCharCode(hex(4))
    else if (e === '\r') { if (body[i + 1] === '\n') i++ } // 줄 이음
    else if (e === '\n' || e === ' ' || e === ' ') { /* 줄 이음 */ }
    else if (/[0-9]/.test(e)) fail('LITERAL_NOT_DATA', `8진 escape \\${e}`)
    else if (e === undefined) fail('LITERAL_NOT_DATA', '끝나지 않은 escape')
    else out += e
  }
  return out
}

/**
 * 잘라낸 리터럴 텍스트 → 평범한 JSON 값. 실패는 ControlLocateError(LITERAL_NOT_DATA · LITERAL_DUPLICATE_KEY · CONTROL_PARSE_FAILED).
 * 🔴 리터럴 전체가 값 하나여야 한다(뒤에 남는 토큰 0).
 */
export function parseDataLiteral(literal) {
  if (typeof literal !== 'string') fail('LITERAL_NOT_DATA', '리터럴이 문자열이 아니다')
  const { toks } = lex(literal, 0, false)
  let k = 0
  const peek = () => toks[k]
  const isP = (t, v) => t?.type === 'punct' && t.value === v
  const where = () => (peek() ? `${peek().start}` : '끝')
  /** depth — 최상위 리터럴이 0. 중복 key 오류는 { key, depth } 를 detail 로 싣는다(편집 helper 가 최상위 enabledClusters 중복을 따로 부른다) */
  const value = (depth = 0) => {
    const t = toks[k++]
    if (!t) fail('LITERAL_NOT_DATA', '값이 없다')
    if (t.type === 'string') return decodeStringToken(literal.slice(t.start, t.end))
    if (t.type === 'number' || (isP(t, '-') && peek()?.type === 'number' && peek().start === t.end)) {
      const numTok = t.type === 'number' ? t : toks[k++]
      const text = literal.slice(numTok.start, numTok.end)
      if (!DATA_NUMBER_RE.test(text)) fail('LITERAL_NOT_DATA', `10진수가 아니다: ${text}`)
      return t.type === 'number' ? Number(text) : -Number(text)
    }
    if (t.type === 'word') {
      if (t.value === 'true') return true
      if (t.value === 'false') return false
      if (t.value === 'null') return null
      return fail('LITERAL_NOT_DATA', `식별자 값 ${t.value} (${t.start})`)
    }
    if (isP(t, '[')) {
      const arr = []
      while (!isP(peek(), ']')) {
        if (isP(peek(), ',')) fail('LITERAL_NOT_DATA', `빈 칸 배열 (${where()})`)
        arr.push(value(depth + 1))
        if (isP(peek(), ',')) { k++; continue }
        if (!isP(peek(), ']')) fail('LITERAL_NOT_DATA', `배열 구분자 오류 (${where()})`)
      }
      k++
      return arr
    }
    if (isP(t, '{')) {
      const obj = {}
      const seen = new Set()
      while (!isP(peek(), '}')) {
        const kt = toks[k++]
        let key
        if (kt?.type === 'word') key = kt.value
        else if (kt?.type === 'string') key = decodeStringToken(literal.slice(kt.start, kt.end))
        else fail('LITERAL_NOT_DATA', `key 가 식별자 · 따옴표 문자열이 아니다(계산 key · spread · 숫자 key) (${kt?.start ?? '끝'})`)
        if (!isP(peek(), ':')) fail('LITERAL_NOT_DATA', `key ${key} 뒤에 ':' 가 없다(getter · method · shorthand) (${where()})`)
        k++
        if (key === '__proto__') fail('LITERAL_NOT_DATA', '__proto__ key')
        if (seen.has(key)) fail('LITERAL_DUPLICATE_KEY', `중복 key ${key}`, { key, depth })
        seen.add(key)
        obj[key] = value(depth + 1)
        if (isP(peek(), ',')) { k++; continue }
        if (!isP(peek(), '}')) fail('LITERAL_NOT_DATA', `객체 구분자 오류 (${where()})`)
      }
      k++
      return obj
    }
    return fail('LITERAL_NOT_DATA', `데이터가 아닌 토큰 ${t.type}${t.value ? ` ${t.value}` : ''} (${t.start})`)
  }
  const v = value()
  if (k !== toks.length) fail('LITERAL_NOT_DATA', `값 뒤에 남은 토큰 (${where()})`)
  return v
}


/**
 * 실제 최상위 CONTROL 선언의 객체 리터럴. 선언 위치는 `anchorText`(문자열)에서 토큰 단위로 찾는다 — 없거나 · 둘 이상이거나 ·
 * 판독 실패면 null(fail-closed). 문자열 입력은 찾은 구간을 그대로 자른다. 엄격 프로필의 비문자열 입력(Buffer 등)은 앞판처럼
 * 받은 값에서 자른다 — 앵커만 실제 선언 위치로 바꿨다(비문자열 입력의 null · 오류 문장 보존).
 */
function controlLiteral(anchorText, controlText) {
  let span
  try { span = locateControlObject(anchorText) } catch (err) { if (err instanceof ControlLocateError) return null; throw err }
  if (typeof controlText === 'string') return controlText.slice(span.start, span.end)
  return sliceLiteral(controlText, controlText.indexOf('=', span.declStart), '{', '}')
}

/**
 * 잘라낸 리터럴을 **데이터로만** 읽는다(JS 실행 0 · S2 P1-B). 실패는 던지지 않고 null — 리터럴이 `{` 로 시작하므로 성공 값은 언제나 객체다.
 * 🔴 앞판은 vm 평가라 getter · 함수 호출이 읽는 순간 실행되고 중복 key(kill switch 두 번)는 마지막 값이 조용히 이겼다.
 */
function evalControl(literal) {
  let raw
  try { raw = parseDataLiteral(literal) } catch (err) { if (err instanceof ControlLocateError) return null; throw err }
  return raw
}

/** control.ts 의 CONTROL — 구조 파서. 판독 실패는 null (호출자가 blocker 로 막는다) */
export function parseControlText(text) {
  const src = String(text ?? '')
  const literal = controlLiteral(src, src)
  if (!literal) return null
  const raw = evalControl(literal)
  if (raw === null) return null
  const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!plain(raw) || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.enabledClusters)) return null
  if (!plain(raw.surfaces) || !plain(raw.killSwitch) || typeof raw.killSwitch.tripped !== 'boolean') return null
  return {
    graphVersion: String(raw.graphVersion ?? ''),
    enabled: raw.enabled,
    enabledClusters: [...raw.enabledClusters].map(String),
    surfaces: Object.fromEntries(Object.entries(raw.surfaces).map(([k, v]) => [k, v === true])),
    killSwitchTripped: raw.killSwitch.tripped,
  }
}

/**
 * control.ts 의 `export const CONTROL = {…}` 를 **구조 파서**(토큰 선언 찾기 + 데이터 전용 판독)로 읽는다.
 * 🔴 정상 TypeScript 리터럴(여러 줄 · 끝 쉼표 · 주석)은 한 줄 판과 같은 값으로 읽고,
 *    파싱 불가 · 필드 누락 · 형식 오류는 **던지지 않고** null 이다 — 호출자가 PRODUCT_BASIS_UNREADABLE 로 막는다.
 */
export function parseGraphControl(controlText) {
  const literal = controlLiteral(String(controlText ?? ''), controlText)
  if (!literal) return null
  const raw = evalControl(literal)
  if (raw === null) return null
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  if (!isPlain(raw)) return null
  const { graphVersion, enabled, enabledClusters, surfaces, killSwitch } = raw
  if (typeof graphVersion !== 'string' || !graphVersion.trim()) return null
  if (typeof enabled !== 'boolean') return null
  if (!Array.isArray(enabledClusters) || !enabledClusters.every((c) => typeof c === 'string' && c.trim())) return null
  if (!isPlain(surfaces) || !Object.values(surfaces).every((v) => typeof v === 'boolean')) return null
  if (!isPlain(killSwitch) || typeof killSwitch.tripped !== 'boolean') return null
  // 🔴 격리 컨텍스트의 객체를 이 컨텍스트의 평범한 값으로 옮긴다
  return {
    graphVersion,
    enabled,
    enabledClusters: [...enabledClusters],
    surfaces: Object.fromEntries(Object.entries(surfaces)),
    killSwitch: { tripped: killSwitch.tripped },
  }
}
