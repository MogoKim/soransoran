/**
 * control.ts 사본의 `CONTROL.enabledClusters` 를 **구조적으로** 읽고 바꾸는 검사용 공용 helper (2026-10-18).
 *
 * 왜 있나
 *   검사 세 곳이 `enabledClusters: ['sleep', 'family']` 를 문자열 그대로 찾아 바꿨다. cluster 가 하나 늘거나
 *   따옴표 · 줄바꿈만 달라져도 "반례 준비 실패" 로 깨지고, 고정 문자열이 제품 control 의 현재값을 몰래 단정했다.
 *
 * 계약
 *   · CONTROL 객체 리터럴을 찾아 **최상위** enabledClusters 배열 구간만 바꾼다 (주석 · 문자열 안은 보지 않는다)
 *   · addCluster    — 기존 순서를 보존하고 끝에 정확히 한 번 더한다. 이미 있으면 CLUSTER_ALREADY_PRESENT
 *   · ensureCluster — 계약된 멱등. 이미 있으면 바이트 그대로 돌려주고 changed=false
 *   · removeCluster — 정확히 있을 때만 뺀다. 없으면 CLUSTER_NOT_PRESENT
 *   · 바꾼 뒤 CONTROL 전체를 다시 파싱해 enabledClusters 가 기대값인지, 다른 필드가 의미상 같은지 본다
 *   · 실패는 조용히 통과하지 않는다 — 전부 ControlEditError(code)
 * 🔴 제품 control.ts 를 쓰지 않는다. 텍스트를 받아 텍스트를 돌려줄 뿐이다.
 */
import { evalLiteral, sliceLiteral } from './magazine-load.mjs'

export class ControlEditError extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; this.why = why }
}
const fail = (code, why) => { throw new ControlEditError(code, why) }
const CLUSTER_RE = /^[a-z][a-z0-9-]*$/

/** CONTROL 객체 리터럴의 시작 위치 · 텍스트 · 파싱 값 */
function locateControl(text) {
  const src = String(text ?? '')
  const anchor = src.indexOf('export const CONTROL')
  if (anchor === -1) fail('CONTROL_NOT_FOUND', 'export const CONTROL 이 없다')
  const eq = src.indexOf('=', anchor)
  const start = eq === -1 ? -1 : src.indexOf('{', eq)
  const literal = start === -1 ? null : sliceLiteral(src, start, '{', '}')
  if (!literal) fail('CONTROL_PARSE_FAILED', 'CONTROL 객체 리터럴의 끝을 찾지 못했다')
  let value
  try { value = evalLiteral(literal, 'control.ts') } catch (e) { fail('CONTROL_PARSE_FAILED', e.message) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('CONTROL_PARSE_FAILED', 'CONTROL 이 객체가 아니다')
  return { src, start, literal, value }
}

/** CONTROL 리터럴 안 **최상위** enabledClusters 배열의 [시작, 끝) — 문자열 · 주석 · 중첩 안은 건너뛴다 */
function clustersSpan(src, start, literal) {
  const end = start + literal.length
  const spans = []
  let depth = 0, quote = null
  for (let i = start; i < end; i++) {
    const ch = src[i], next = src[i + 1]
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue }
    if (ch === '/' && next === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue }
    if (ch === '/' && next === '*') { i = src.indexOf('*/', i + 2) + 1; if (i === 0) break; continue }
    if (ch === "'" || ch === '"' || ch === '`') {
      // 따옴표 key — 최상위 "enabledClusters": 도 받는다
      if (depth === 1) {
        const m = /^(['"])enabledClusters\1\s*:\s*/.exec(src.slice(i, end))
        if (m) { spans.push(i + m[0].length); i += m[0].length - 1; continue }
      }
      quote = ch; continue
    }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; continue }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; continue }
    if (depth === 1 && /[A-Za-z_$]/.test(ch) && !/[A-Za-z0-9_$]/.test(src[i - 1] ?? '')) {
      const m = /^enabledClusters\s*:\s*/.exec(src.slice(i, end))
      if (m) { spans.push(i + m[0].length); i += m[0].length - 1 }
    }
  }
  if (spans.length === 0) fail('CLUSTERS_NOT_FOUND', 'CONTROL 최상위에 enabledClusters 가 없다')
  if (spans.length > 1) fail('CLUSTERS_AMBIGUOUS', `CONTROL 최상위에 enabledClusters 가 ${spans.length}번 있다`)
  const valueStart = spans[0]
  if (src[valueStart] !== '[') fail('CLUSTERS_NOT_ARRAY', 'enabledClusters 값이 배열 리터럴이 아니다')
  const arr = sliceLiteral(src, valueStart, '[', ']')
  if (!arr) fail('CLUSTERS_NOT_ARRAY', 'enabledClusters 배열의 끝을 찾지 못했다')
  return { from: valueStart, to: valueStart + arr.length, raw: arr }
}

/** 검사가 읽는 CONTROL 값 — 실패는 ControlEditError. 다른 realm 의 값이 아니라 평범한 JSON 값으로 돌려준다 */
export function readControl(text) {
  const { value } = locateControl(text)
  const cs = value.enabledClusters
  if (!Array.isArray(cs) || !cs.every((c) => typeof c === 'string')) fail('CLUSTERS_NOT_ARRAY', `enabledClusters 형식 오류: ${JSON.stringify(cs)}`)
  return JSON.parse(JSON.stringify(value))
}

/** 키를 모든 깊이에서 정렬한 직렬화 — 하위 객체(surfaces · killSwitch) 변경도 본다 */
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : v !== null && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
    : JSON.stringify(v))

/** 🔴 대상 필드 밖 의미 불변 — enabledClusters 를 뺀 나머지가 모든 깊이에서 같아야 한다 */
export function assertOnlyClustersChanged(before, after) {
  const rest = (o) => { const { enabledClusters: _drop, ...r } = o; return stable(r) }
  if (rest(before) !== rest(after)) fail('OTHER_FIELD_CHANGED', 'enabledClusters 밖의 CONTROL 필드가 바뀌었다')
}

function rewrite(text, nextClusters) {
  const { src, start, literal, value: before } = locateControl(text)
  readControl(text)
  const span = clustersSpan(src, start, literal)
  const q = /["']/.exec(span.raw)?.[0] ?? "'"
  const out = `${src.slice(0, span.from)}[${nextClusters.map((c) => `${q}${c}${q}`).join(', ')}]${src.slice(span.to)}`
  // 🔴 사후조건 — 다시 파싱해 기대값과 다른 필드 불변을 본다
  verifyClusterEdit(before, readControl(out), nextClusters)
  return out
}

/** 🔴 편집 사후조건 — enabledClusters 가 기대값이고 나머지 필드가 의미상 같아야 한다 */
export function verifyClusterEdit(before, after, nextClusters) {
  if (JSON.stringify(after.enabledClusters) !== JSON.stringify(nextClusters)) {
    fail('POSTCONDITION_FAILED', `편집 뒤 enabledClusters ${JSON.stringify(after.enabledClusters)} ≠ 기대 ${JSON.stringify(nextClusters)}`)
  }
  assertOnlyClustersChanged(before, after)
}

const checkCluster = (c) => { if (typeof c !== 'string' || !CLUSTER_RE.test(c)) fail('CLUSTER_INVALID', `cluster 이름 형식 오류: ${JSON.stringify(c)}`) }

/** 끝에 정확히 한 번 더한다. 이미 있으면 CLUSTER_ALREADY_PRESENT */
export function addCluster(text, cluster) {
  checkCluster(cluster)
  const cs = readControl(text).enabledClusters
  if (cs.includes(cluster)) fail('CLUSTER_ALREADY_PRESENT', `${cluster} 가 이미 켜져 있다`)
  return rewrite(text, [...cs, cluster])
}

/** 계약된 멱등 — 이미 있으면 바이트 그대로 · changed=false. 없으면 addCluster 와 같다 */
export function ensureCluster(text, cluster) {
  checkCluster(cluster)
  const cs = readControl(text).enabledClusters
  if (cs.includes(cluster)) return { text: String(text), changed: false }
  return { text: addCluster(text, cluster), changed: true }
}

/** 정확히 있을 때만 뺀다. 없으면 CLUSTER_NOT_PRESENT */
export function removeCluster(text, cluster) {
  checkCluster(cluster)
  const cs = readControl(text).enabledClusters
  if (!cs.includes(cluster)) fail('CLUSTER_NOT_PRESENT', `${cluster} 가 켜져 있지 않다 — 반례가 아니다`)
  return rewrite(text, cs.filter((c) => c !== cluster))
}
