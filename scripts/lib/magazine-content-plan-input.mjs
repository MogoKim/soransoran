/**
 * Magazine vNext S2 — ContentPlanInputBundle 의 **순수** 조립 · 엄격 판독 (charter §18-B.1 · §18-B.5 · runbook §0.0B.1).
 *
 * 책임
 *   ① 연구 current(제품 builder 산출) + exact canonical snapshot + 제품 graph 판 텍스트를 받아 신원을 대조하고,
 *      Bundle 을 **엄격 투영**으로 조립한다(buildPlanInputBundle). 연구 JSONL 을 그대로 옮기지 않는다.
 *   ② 저장된 Bundle 을 exact-key 로 판독하고 두 해시(bundleHash 내용 신원 · recordHash 출처 봉인)를 다시 계산한다(parsePlanInputBundle).
 *
 * 🔴 순수 모듈이다 — node:fs · cwd · env · 벽시계 · 네트워크 · provider · queue · 초안 · HOLD · 격리 판독 0.
 *    파일을 읽는 일은 `scripts/magazine-plan-input-bootstrap.mjs`(CLI 경계)만 한다. 이 모듈은 텍스트만 받는다.
 *    경계 검사 R17 이 import 허용 목록(node:crypto 만)과 금지 토큰을 본다.
 *
 * 왜 이 모양인가 (2026-11-10 Codex 결정 D1 · D2 · D5)
 *   - control 전체 해시는 export 시점 **출처 기록(provenance)** 일 뿐이다. ContentPlan · planHash 에 control 사실을 넣지 않는다.
 *     정당한 control 토글(cluster 켜기 등)이 Bundle 을 영구 무효로 만들거나 planHash 를 바꾸면 안 된다 — 현재 control 은 admission 이 본다.
 *   - `AUTOMATION_READY` 만 믿지 않는다. 내보낸 current edge 를 canonical g5 edge 와 edgeId · 관계 필드로 정확히 맞추고,
 *     canonical `basis` 가 비어 있지 않으며 구조화 `evidence` 객체가 참조하는 증거 파일이 있고 · 허용 schema 이고 · 해시된 관계만 싣는다.
 *     🔴 증거 원문(질의 · snippet · 본문 인용)은 싣지 않는다 — 정규화한 상대 경로와 해시만 싣는다.
 *   - `inclusions` 는 현재 canonical 출처가 없다 → 결정적 빈 배열. 포함 범위는 지금 `answerScope` 가 소유한다(문장을 지어내지 않는다).
 *   - 내부 문자열(🔴 주석 표식 포함)은 Bundle 에 **그대로** 보존한다. 걸러 내는 것은 ProviderPlan 투영의 일이다(fail-closed · 조용히 지우지 않는다).
 *   - 승인 흔적 · 메모 · runtime 사유 · 재시도 · readiness · generatedAt 은 투영하지 않는다(§18-B.7 · 결정적 해시).
 */
import { createHash } from 'node:crypto'

export const PLAN_INPUT_SCHEMA = 'magazine-content-plan-input/1'
/** 제품 저장소 안 Bundle 위치 — graphVersion 하나에 파일 하나 */
export const PLAN_INPUT_DIR = 'src/content/magazine/plan-input'
export const planInputRel = (graphVersion) => `${PLAN_INPUT_DIR}/${graphVersion}.json`
/** 연구 current 의 제품 builder 산출 schema — 이 schema 의 current 만 Bundle 로 투영한다 */
export const RESEARCH_BUILD_SCHEMA = 'mgraph-build/1'
/** 받아들이는 증거 파일 schema (연구 `evidence-store.mjs` writeEvidence 산출) */
export const EVIDENCE_DOC_SCHEMA = 'mgraph.search-evidence.v1'
export const VALIDATION_PROFILES = Object.freeze(['FINANCIAL', 'MEDICAL', 'SENSITIVE', 'STANDARD'])

export const GRAPH_VERSION_RE = /^g-\d{8}-[0-9a-f]{6}$/
const HEX64_RE = /^[0-9a-f]{64}$/
const HEX16_RE = /^[0-9a-f]{16}$/
/** 증거 상대 경로 — `evidence/<엔진>/<파일>.json`. `/` 로 시작하거나 `..` 세그먼트가 있으면 이 모양이 아니다 */
const EVIDENCE_REF_RE = /^evidence\/[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/
const EVIDENCE_REF_SCAN = /evidence\/[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]*\.json/g

export class PlanInputError extends Error {
  constructor(code, why, detail = null) { super(`${code}: ${why}`); this.code = code; this.why = why; this.detail = detail }
}
const fail = (code, why, detail) => { throw new PlanInputError(code, why, detail) }

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
const isStr = (v) => typeof v === 'string'
/** 빈 칸 없는 배열 — 모든 index 가 자기 속성이다. every · map 은 빈 칸을 건너뛰므로 따로 본다(P1-6) */
export const isDense = (a) => { for (let i = 0; i < a.length; i++) if (!Object.prototype.hasOwnProperty.call(a, i)) return false; return true }
/** 값 안의 첫 희소 배열 경로 — 없으면 null */
export function sparsePathOf(v, path = '$') {
  if (Array.isArray(v)) {
    if (!isDense(v)) return path
    for (let i = 0; i < v.length; i++) { const p = sparsePathOf(v[i], `${path}[${i}]`); if (p) return p }
  } else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) { const p = sparsePathOf(v[k], `${path}.${k}`); if (p) return p }
  }
  return null
}
const nonEmpty = (v) => isStr(v) && v.trim().length > 0
/** code-unit 정렬 — localeCompare 를 쓰지 않는다(환경 locale 에 따라 순서가 바뀌면 해시가 바뀐다) */
export const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * exact canonical snapshot 다섯 파일 — graph builder `INPUT_FILES` 와 같은 이름이다(검사 PI 가 builder 와 대조한다).
 * 🔴 이 순수 모듈은 builder(fs · 경로)를 import 하지 않으므로 이름을 여기 적는다. 다섯 개 · 대체 이름 0 — manifest ·
 *    snapshot · 저장 Bundle 의 inputHashes 가 정확히 이 집합이어야 한다(P1-D).
 */
export const SNAPSHOT_INPUT_FILES = Object.freeze({
  canonical: 'g4-intents-canonical.jsonl',
  automation: 'g4-automation-2026-09-23.jsonl',
  graph: 'g5-graph-2026-09-23.jsonl',
  published: 'assets-published.jsonl',
  queued: 'assets-queue.jsonl',
})
const SNAPSHOT_NAMES_SORTED = Object.freeze(Object.values(SNAPSHOT_INPUT_FILES).sort(byCodeUnit))

/**
 * 제3자 원문 경계 규칙 (S2 P1-E) — provider 로 가는 intent 문장이 연구가 관측한 제3자 글(검색 결과 제목 · snippet ·
 * canonical 의 communityTitle)을 그대로 옮겼는지 **결정적으로 대조**한다. 문구 목록(denylist)이 아니다.
 *   corpus   canonical g4 의 intent 별 evidenceRefs + canonical g5 가 참조하는 증거 파일 전부의 organicResults 제목 · snippet,
 *            그리고 canonical g4 evidenceRefs 의 communityTitle. 🔴 원문은 Bundle 에 싣지 않는다 — intent 마다 판정 하나만 싣는다
 *            결과 URL 의 호스트가 ownHosts(우리 사이트)면 제3자가 아니다 — corpus 에서 뺀다. URL 이 없거나 못 읽으면 제3자로 본다
 *   title    제목을 사이트 구분자로 나눈 조각이 문장 모양(낱말 ≥ titleSegmentMinWords · 정규화 길이 ≥ titleSegmentMin)이고
 *            문장 안에 통째로 있으면 제3자 원문이다. 한 낱말 제목(기관 · 용어 이름)은 조각 대조 대상이 아니다(run 대조는 받는다)
 *   run      제목 · snippet 의 연속 snippetRunLength 글자(정규화)가 문장에 그대로 있으면 제3자 원문이다
 *   판정     THIRD_PARTY_TEXT(대조 적중) · UNVERIFIED(corpus 불완전 · intent 자기 증거 없음·불량) · CLEAR(나머지)
 * 🔴 숫자 · 필드를 바꾸면 id 를 올린다 — content-plan 검사 CP14 가 id 별 해시를 고정한다(P1-G).
 */
export const SOURCE_TEXT_RULE = Object.freeze({
  id: 'magazine-source-text-rule/1',
  fields: Object.freeze(['primaryQuery', 'audienceSituation', 'answerScope', 'exclusions', 'forbiddenClaims']),
  titleSegmentMin: 6,
  titleSegmentMinWords: 2,
  snippetRunLength: 20,
  ownHosts: Object.freeze(['soransoran.com']),
})
export const TEXT_PROVENANCE = Object.freeze(['CLEAR', 'THIRD_PARTY_TEXT', 'UNVERIFIED'])
/** canonical g4 evidenceRefs 의 증거 경로 — 연구 폴더 안 상대 경로(`evidence/…` 또는 `account-<n>/evidence/…`) */
const SOURCE_REF_RE = /^(?:account-[0-9]+\/)?evidence\/[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/

/**
 * 결정적 canonical JSON — 키는 code-unit 정렬, 배열 순서는 그대로.
 * 🔴 undefined · NaN · Infinity · 함수 · 평범하지 않은 객체(Date · Map · class)는 **던진다** — 조용히 빠지면 해시가 내용을 대표하지 못한다.
 */
export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('CANONICAL_JSON_INVALID', `유한하지 않은 수 ${value}`)
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    // 🔴 희소 배열(빈 칸)은 던진다 — map 은 빈 칸을 건너뛰고 join 은 빈 문자열로 써서 Array(1) 이 [] 와 같은 해시가 된다(P1-6)
    if (!isDense(value)) fail('CANONICAL_JSON_INVALID', '희소 배열(빈 칸)')
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (isPlain(value)) {
    const keys = Object.keys(value).sort(byCodeUnit)
    return `{${keys.map((k) => {
      if (value[k] === undefined) fail('CANONICAL_JSON_INVALID', `키 ${k} 의 값이 undefined`)
      return `${JSON.stringify(k)}:${canonicalJson(value[k])}`
    }).join(',')}}`
  }
  return fail('CANONICAL_JSON_INVALID', `직렬화할 수 없는 값 (${typeof value})`)
}
export const sha256Hex = (text) => createHash('sha256').update(text).digest('hex')
const sha16 = (text) => sha256Hex(text).slice(0, 16)
/** 사람이 읽는 canonical 바이트 — 키 정렬 · 2칸 들여쓰기 · 끝 줄바꿈. 저장 파일은 이 바이트여야 한다 */
export const prettyCanonical = (value) => `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`

function parseJsonl(text, code, label) {
  if (!isStr(text)) fail(code, `${label} 가 없다`)
  const rows = []
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line)) } catch (e) { fail(code, `${label} ${i + 1}행을 읽지 못했다: ${e.message}`) }
  }
  return rows
}

/** 제품 `current.ts` 가 가리키는 판 — `export { GRAPH, EXPORT_HASH } from './g-…'` 정확히 한 곳. 아니면 null */
export function currentGraphVersionOf(currentText) {
  if (!isStr(currentText)) return null
  // `from[ ]'` — 경계 검사 R17 의 import 판독이 이 정규식을 import 문으로 읽지 않게 공백을 문자 집합으로 적는다(뜻은 같다)
  const hits = [...currentText.matchAll(/^export \{ GRAPH, EXPORT_HASH \} from[ ]'\.\/(g-\d{8}-[0-9a-f]{6})'$/gm)]
  return hits.length === 1 ? hits[0][1] : null
}

/** 구조화 evidence 객체 안의 증거 파일 참조 — 모든 문자열 값을 훑어 정규화한 상대 경로(중복 제거 · code-unit 정렬) */
export function evidenceRefsOf(evidence) {
  const out = new Set()
  const walk = (v) => {
    if (isStr(v)) { for (const m of v.matchAll(EVIDENCE_REF_SCAN)) out.add(m[0]) }
    else if (Array.isArray(v)) v.forEach(walk)
    else if (isPlain(v)) Object.values(v).forEach(walk)
  }
  walk(evidence)
  return [...out].sort(byCodeUnit)
}

/** canonical g5 snapshot 이 참조하는 증거 파일 전부 — CLI 가 이 목록만 읽는다 */
export function collectEvidenceRefs(canonicalGraphText) {
  const rows = parseJsonl(canonicalGraphText, 'SNAPSHOT_UNREADABLE', 'canonical g5')
  const out = new Set()
  for (const r of rows) if (isPlain(r) && isPlain(r.evidence)) for (const ref of evidenceRefsOf(r.evidence)) out.add(ref)
  return [...out].sort(byCodeUnit)
}

/** canonical g4 의 intent 별 증거 경로 전부(형식이 맞는 것만 · 중복 제거 · 정렬) — CLI 가 제3자 원문 대조용으로 이 목록도 읽는다 */
export function collectSourceTextRefs(canonicalIntentsText) {
  const out = new Set()
  for (const r of parseJsonl(canonicalIntentsText, 'SNAPSHOT_UNREADABLE', 'canonical g4')) {
    if (!isPlain(r) || !Array.isArray(r.evidenceRefs)) continue
    for (const e of r.evidenceRefs) if (isPlain(e) && isStr(e.evidencePath) && SOURCE_REF_RE.test(e.evidencePath)) out.add(e.evidencePath)
  }
  return [...out].sort(byCodeUnit)
}

/** 대조용 정규화 — NFKC · 소문자 · 글자/숫자만 · code point 배열 */
const normPoints = (s) => [...s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')]
/** 검색 결과 제목의 사이트 구분자 — `제목 ::: 사이트` · `제목 - 사이트` · `제목 | 사이트` 등 */
const TITLE_SPLIT_RE = /\s*:{2,}\s*|\s+[|\-–—·»:]\s+/u

/**
 * 제3자 원문 대조기 — corpus(증거 텍스트 · communityTitle)에서 제목 조각 집합과 연속 글자 run 집합을 만든다.
 * @returns {{ complete: boolean, hits: (text: string) => boolean }}  complete=false 면 참조 증거 중 판독 불가가 있다
 */
function sourceTextMatcher(refs, evidenceTexts, communityTitles) {
  const R = SOURCE_TEXT_RULE
  const segments = new Set(), runs = new Set()
  const addRuns = (pts) => { for (let i = 0; i + R.snippetRunLength <= pts.length; i++) runs.add(pts.slice(i, i + R.snippetRunLength).join('')) }
  const addTitle = (t) => {
    if (!isStr(t)) return
    for (const part of [t, ...t.split(TITLE_SPLIT_RE)]) {
      const pts = normPoints(part)
      const words = part.trim().split(/\s+/u).filter((w) => normPoints(w).length > 0).length
      if (pts.length >= R.titleSegmentMin && words >= R.titleSegmentMinWords) segments.add(pts.join(''))
      addRuns(pts)
    }
  }
  /** 우리 사이트 결과인가 — URL 호스트가 ownHosts 이거나 그 하위. URL 이 없거나 못 읽으면 제3자다(fail-closed) */
  const isOwn = (o) => {
    let host = null
    try { host = isStr(o.url) ? new URL(o.url).hostname.toLowerCase() : null } catch { host = null }
    return host !== null && R.ownHosts.some((h) => host === h || host.endsWith(`.${h}`))
  }
  let complete = true
  for (const ref of refs) {
    let d = null
    try { d = isStr(evidenceTexts?.[ref]) ? JSON.parse(evidenceTexts[ref]) : null } catch { d = null }
    if (!isPlain(d) || !Array.isArray(d.organicResults)) { complete = false; continue }
    for (const o of d.organicResults) {
      if (!isPlain(o)) { complete = false; continue }
      if (isOwn(o)) continue
      addTitle(o.title)
      if (isStr(o.snippet)) addRuns(normPoints(o.snippet))
    }
  }
  communityTitles.forEach(addTitle)
  const hits = (text) => {
    const pts = normPoints(text)
    const flat = pts.join('')
    for (const s of segments) if (flat.includes(s)) return true
    for (let i = 0; i + R.snippetRunLength <= pts.length; i++) if (runs.has(pts.slice(i, i + R.snippetRunLength).join(''))) return true
    return false
  }
  return { complete, hits }
}

/** 증거 파일이 허용 schema 인가 — 키 · 계정 정보가 제거되고(raw payload 없음) 정상 응답으로 저장된 검색 근거만 */
export function acceptEvidenceDoc(text) {
  if (!isStr(text)) return false
  let d
  try { d = JSON.parse(text) } catch { return false }
  return isPlain(d) && d.schema === EVIDENCE_DOC_SCHEMA && d.status === 'OK' && d.error === null
    && d.rawPayloadKept === false && d.queryEchoMismatch === false
    && nonEmpty(d.query) && nonEmpty(d.provider) && nonEmpty(d.engine) && nonEmpty(d.observedAt)
    && ['relatedSearches', 'peopleAlsoAsk', 'autocomplete', 'organicResults'].every((k) => Array.isArray(d[k]))
    && isPlain(d.counts)
}

const RELATION_FIELDS = Object.freeze(['fromIntentId', 'toIntentId', 'relationType', 'readerReason', 'anchorLabel', 'placement', 'priority'])

/**
 * Bundle 조립 — 순수 함수. 신원이 하나라도 어긋나면 PlanInputError 를 던진다(호출자는 쓰기 0 으로 멈춘다).
 * @param {{
 *   research: { currentName: string, manifestText: string, tree: Record<string,string>, controlJsonText: string,
 *               files: Record<string,string> },          // intents.jsonl · edges.jsonl · mappings.jsonl · participation.jsonl? · bundle/<판>.ts
 *   snapshot: { texts: Record<string,string>, canonicalGraphName: string },
 *   product:  { currentText: string, controlText: string, controlGraphVersion: string|null, graphFileText: string },
 *   evidenceTexts: Record<string, string|null>,
 * }} p
 * @returns {{ bundle, text, report }}
 */
export function buildPlanInputBundle({ research, snapshot, product, evidenceTexts }) {
  // ① 판 신원 — 제품 current · control · 연구 current · manifest 가 같은 판을 가리킨다
  const graphVersion = currentGraphVersionOf(product?.currentText)
  if (!graphVersion) fail('PRODUCT_CURRENT_UNREADABLE', 'current.ts 의 판을 읽지 못했다')
  if (product.controlGraphVersion === null || product.controlGraphVersion === undefined) fail('CONTROL_UNREADABLE', 'control.ts 를 엄격 판독하지 못했다')
  if (product.controlGraphVersion !== graphVersion) fail('CONTROL_GRAPH_VERSION_DRIFT', `control ${product.controlGraphVersion} ≠ current ${graphVersion}`)
  if (research?.currentName !== graphVersion) fail('RESEARCH_CURRENT_DRIFT', `연구 current ${research?.currentName} ≠ 제품 current ${graphVersion}`)
  let manifest
  try { manifest = JSON.parse(research.manifestText) } catch (e) { fail('RESEARCH_MANIFEST_UNREADABLE', e.message) }
  if (!isPlain(manifest) || manifest.schemaVersion !== RESEARCH_BUILD_SCHEMA) fail('RESEARCH_MANIFEST_SCHEMA', `manifest schema ${JSON.stringify(manifest?.schemaVersion)} — 제품 builder 산출만 받는다`)
  if (manifest.graphVersion !== graphVersion) fail('GRAPH_VERSION_DRIFT', `manifest ${manifest.graphVersion} ≠ ${graphVersion}`)
  let researchControl
  try { researchControl = JSON.parse(research.controlJsonText) } catch { researchControl = null }
  if (!isPlain(researchControl) || researchControl.graphVersion !== graphVersion) fail('RESEARCH_CONTROL_DRIFT', `연구 control.json 판 ${researchControl?.graphVersion} ≠ ${graphVersion}`)

  // ② 연구 current 트리 · 내용 해시 · combined — 파일 바이트가 manifest 와 트리에 적힌 값이다
  const bundleName = `bundle/${graphVersion}.ts`
  const ch = isPlain(manifest.contentHash) ? manifest.contentHash : {}
  const parts = [['intents', 'intents.jsonl'], ['edges', 'edges.jsonl'], ['mappings', 'mappings.jsonl']]
  if (ch.participation !== undefined) parts.push(['participation', 'participation.jsonl'])
  const files = research.files ?? {}
  for (const [k, name] of parts) {
    if (!isStr(files[name])) fail('RESEARCH_FILE_MISSING', `${name} 가 없다`)
    if (sha16(files[name]) !== ch[k]) fail('RESEARCH_CONTENT_HASH', `${name} 해시 ≠ manifest contentHash.${k}`)
  }
  const combined = sha16(ch.intents + ch.edges + ch.mappings + (ch.participation ?? ''))
  if (ch.combined !== combined || !graphVersion.endsWith(`-${combined.slice(0, 6)}`)) fail('RESEARCH_COMBINED_HASH', `combined ${ch.combined} 가 내용 해시와 판 이름에 맞지 않는다`)
  if (!isStr(files[bundleName])) fail('RESEARCH_FILE_MISSING', `${bundleName} 가 없다`)
  const tree = research.tree
  if (!isPlain(tree)) fail('RESEARCH_TREE_DRIFT', '연구 current 트리가 없다')
  for (const [name, text] of [['manifest.json', research.manifestText], ...parts.map(([, n]) => [n, files[n]]), [bundleName, files[bundleName]]]) {
    if (tree[name] !== sha256Hex(text)) fail('RESEARCH_TREE_DRIFT', `트리의 ${name} 해시가 읽은 바이트와 다르다`)
  }
  if (!Object.values(tree).every((h) => isStr(h) && HEX64_RE.test(h))) fail('RESEARCH_TREE_DRIFT', '트리 해시 형식 오류')

  // ③ exact canonical snapshot — manifest inputHashes · snapshot 이 **정확히 canonical 다섯 이름**이고 바이트가 같다(대체 이름 0 · P1-D)
  const inputHashes = isPlain(manifest.inputHashes) ? manifest.inputHashes : {}
  const want = Object.keys(inputHashes).sort(byCodeUnit)
  const got = Object.keys(snapshot?.texts ?? {}).sort(byCodeUnit)
  const canon = canonicalJson(SNAPSHOT_NAMES_SORTED)
  if (canonicalJson(want) !== canon) fail('SNAPSHOT_INPUT_SET', `manifest inputHashes 이름 ${want.join(',')} ≠ canonical 다섯 ${SNAPSHOT_NAMES_SORTED.join(',')}`)
  if (canonicalJson(got) !== canon) fail('SNAPSHOT_INPUT_SET', `snapshot 파일 집합 ${got.join(',')} ≠ canonical 다섯 ${SNAPSHOT_NAMES_SORTED.join(',')}`)
  for (const name of want) if (sha256Hex(snapshot.texts[name]) !== inputHashes[name]) fail('SNAPSHOT_INPUT_DRIFT', `snapshot ${name} 가 manifest inputHashes 와 다르다`)
  if (snapshot.canonicalGraphName !== SNAPSHOT_INPUT_FILES.graph) fail('SNAPSHOT_INPUT_SET', `canonical g5 이름 ${snapshot.canonicalGraphName} ≠ ${SNAPSHOT_INPUT_FILES.graph}`)

  // ④ 제품 graph 판 — 연구 current 의 bundle 과 바이트 동일 · EXPORT_HASH 가 manifest 값
  if (product.graphFileText !== files[bundleName]) fail('PRODUCT_GRAPH_DRIFT', `제품 graph 판 ${graphVersion}.ts 가 연구 current bundle 과 바이트가 다르다`)
  if (!HEX16_RE.test(String(manifest.exportHash)) || !product.graphFileText.includes(`\nexport const EXPORT_HASH = '${manifest.exportHash}'\n`)) fail('PRODUCT_GRAPH_EXPORT_HASH', 'EXPORT_HASH 가 manifest exportHash 와 다르다')
  if (!HEX16_RE.test(String(manifest.semanticHash))) fail('RESEARCH_MANIFEST_SCHEMA', 'semanticHash 형식 오류')

  // ⑤-a 제3자 원문 경계 (P1-E) — canonical g4 의 intent 별 증거 신원과 corpus. 원문은 여기서만 쓰고 Bundle 에는 판정만 싣는다
  const g4ById = new Map()
  const communityTitles = []
  for (const r of parseJsonl(snapshot.texts[SNAPSHOT_INPUT_FILES.canonical], 'SNAPSHOT_UNREADABLE', 'canonical g4')) {
    if (!isPlain(r) || !nonEmpty(r.intentId)) fail('SNAPSHOT_UNREADABLE', 'canonical g4 행에 intentId 가 없다')
    if (g4ById.has(r.intentId)) fail('SNAPSHOT_UNREADABLE', `canonical g4 intentId 중복 ${r.intentId}`)
    g4ById.set(r.intentId, r)
    if (Array.isArray(r.evidenceRefs)) for (const e of r.evidenceRefs) if (isPlain(e) && isStr(e.communityTitle)) communityTitles.push(e.communityTitle)
  }
  const corpusRefs = [...new Set([...collectSourceTextRefs(snapshot.texts[SNAPSHOT_INPUT_FILES.canonical]), ...collectEvidenceRefs(snapshot.texts[SNAPSHOT_INPUT_FILES.graph])])].sort(byCodeUnit)
  const matcher = sourceTextMatcher(corpusRefs, evidenceTexts, communityTitles)
  /** 판정 — 적중이 먼저다(증거가 불완전해도 이미 옮긴 원문은 원문이다). 그다음 corpus · 자기 증거가 온전해야 CLEAR */
  const textProvenanceOf = (projected) => {
    const texts = SOURCE_TEXT_RULE.fields.flatMap((k) => (Array.isArray(projected[k]) ? projected[k] : [projected[k]])).filter(isStr)
    if (texts.some(matcher.hits)) return 'THIRD_PARTY_TEXT'
    const refs = g4ById.get(projected.intentId)?.evidenceRefs
    if (!matcher.complete || !Array.isArray(refs) || refs.length === 0) return 'UNVERIFIED'
    const own = refs.map((e) => (isPlain(e) ? e.evidencePath : null))
    if (!own.every((p) => isStr(p) && SOURCE_REF_RE.test(p) && acceptEvidenceDoc(evidenceTexts?.[p]))) return 'UNVERIFIED'
    return 'CLEAR'
  }

  // ⑤ intent 투영 — 허용 필드만
  const builtIntents = parseJsonl(files['intents.jsonl'], 'RESEARCH_INTENT_INVALID', 'intents.jsonl')
  const intents = []
  const seen = new Set()
  for (const x of builtIntents) {
    const at = `intent ${x?.intentId}`
    if (!isPlain(x) || !nonEmpty(x.intentId) || seen.has(x.intentId)) fail('RESEARCH_INTENT_INVALID', `${at} 신원 누락·중복`)
    seen.add(x.intentId)
    const strOrNull = (v, k) => { if (v === null || v === undefined) return null; if (!isStr(v)) fail('RESEARCH_INTENT_INVALID', `${at} ${k} 형식 오류`); return v }
    const strArr = (v, k) => { if (v === undefined || v === null) return []; if (!Array.isArray(v) || !v.every(isStr)) fail('RESEARCH_INTENT_INVALID', `${at} ${k} 가 문자열 배열이 아니다`); return [...v] }
    if (!VALIDATION_PROFILES.includes(x.verificationProfile)) fail('RESEARCH_INTENT_INVALID', `${at} 검증 프로필 ${x.verificationProfile}`)
    if (!nonEmpty(x.territoryId) || !nonEmpty(x.policyScope) || !nonEmpty(x.automationDecision)) fail('RESEARCH_INTENT_INVALID', `${at} 영토·정책·결정 누락`)
    if (x.profileSpec !== undefined && x.profileSpec !== null && !isPlain(x.profileSpec)) fail('RESEARCH_INTENT_INVALID', `${at} profileSpec 형식 오류`)
    const projected = {
      intentId: x.intentId,
      territoryId: x.territoryId,
      cluster: strOrNull(x.magazineCluster, 'magazineCluster'),
      primaryQuery: strOrNull(x.primaryQuery, 'primaryQuery'),
      audienceSituation: strOrNull(x.audienceSituation, 'audienceSituation'),
      answerScope: strOrNull(x.answerScope, 'answerScope'),
      // canonical 출처 없음 — 포함 범위는 answerScope 가 소유한다(문장을 지어내지 않는다)
      inclusions: [],
      exclusions: strArr(x.exclusions, 'exclusions'),
      forbiddenClaims: strArr(x.profileSpec?.forbiddenClaims, 'profileSpec.forbiddenClaims'),
      validationProfile: x.verificationProfile,
      policyScope: x.policyScope,
      automationDecision: x.automationDecision,
      quarantined: x.runtimeState === 'QUARANTINED',
      communityDestination: strOrNull(x.communityDestination, 'communityDestination'),
    }
    intents.push({ ...projected, textProvenance: textProvenanceOf(projected) })
  }
  intents.sort((a, b) => byCodeUnit(a.intentId, b.intentId))

  // ⑥ 관계 — 내보낸 current edge 를 canonical g5 edge 와 정확히 맞추고 구조화 근거가 있는 것만
  const canonicalRows = parseJsonl(snapshot.texts[snapshot.canonicalGraphName], 'SNAPSHOT_UNREADABLE', 'canonical g5')
  const g5 = new Map()
  for (const r of canonicalRows) {
    if (!isPlain(r) || !nonEmpty(r.edgeId)) fail('SNAPSHOT_UNREADABLE', 'canonical g5 행에 edgeId 가 없다')
    if (g5.has(r.edgeId)) fail('SNAPSHOT_UNREADABLE', `canonical g5 edgeId 중복 ${r.edgeId}`)
    g5.set(r.edgeId, r)
  }
  const builtEdges = parseJsonl(files['edges.jsonl'], 'RESEARCH_EDGE_INVALID', 'edges.jsonl')
  const relations = []
  const excluded = []
  const edgeIds = new Set()
  for (const e of builtEdges) {
    if (!isPlain(e) || !nonEmpty(e.edgeId) || edgeIds.has(e.edgeId)) fail('RESEARCH_EDGE_INVALID', `edge 신원 누락·중복 ${e?.edgeId}`)
    edgeIds.add(e.edgeId)
    // 매거진 관계 후보만 — COMMUNITY CTA · 슬롯 없음 · 자동화 준비 밖은 대상이 아니다(근거 판정 전에 거른다)
    if (e.relationType === 'COMMUNITY' || !nonEmpty(e.recommendationSlot) || e.layers?.AUTOMATION_READY !== true) continue
    const skip = (code) => excluded.push({ edgeId: e.edgeId, code })
    const g = g5.get(e.edgeId)
    if (!g) { skip('NO_CANONICAL_EDGE'); continue }
    if (!RELATION_FIELDS.every((k) => g[k] === e[k])) { skip('CANONICAL_FIELD_MISMATCH'); continue }
    if (!nonEmpty(g.basis)) { skip('CANONICAL_BASIS_MISSING'); continue }
    if (!isPlain(g.evidence)) { skip('EVIDENCE_ABSENT'); continue }
    let objectSha256
    try { objectSha256 = sha256Hex(canonicalJson(g.evidence)) } catch { skip('EVIDENCE_OBJECT_INVALID'); continue }
    const refs = evidenceRefsOf(g.evidence)
    if (!refs.length) { skip('EVIDENCE_REF_ABSENT'); continue }
    const docs = refs.map((ref) => ({ ref, text: evidenceTexts?.[ref] }))
    if (!docs.every((d) => EVIDENCE_REF_RE.test(d.ref))) { skip('EVIDENCE_REF_INVALID'); continue }
    if (docs.some((d) => d.text === null || d.text === undefined)) { skip('EVIDENCE_REF_MISSING'); continue }
    if (!docs.every((d) => acceptEvidenceDoc(d.text))) { skip('EVIDENCE_SCHEMA_REJECTED'); continue }
    if (!isStr(e.readerReason) || !isStr(e.anchorLabel) || !isStr(e.placement) || !Number.isInteger(e.priority)) { skip('RELATION_FIELD_INVALID'); continue }
    relations.push({
      edgeId: e.edgeId,
      fromIntentId: e.fromIntentId,
      toIntentId: e.toIntentId,
      relationType: e.relationType,
      slot: e.recommendationSlot,
      placement: e.placement,
      priority: e.priority,
      readerReason: e.readerReason,
      anchorLabel: e.anchorLabel,
      evidence: { basisSha256: sha256Hex(g.basis), objectSha256, refs: docs.map((d) => ({ ref: d.ref, sha256: sha256Hex(d.text) })) },
    })
  }
  relations.sort((a, b) => byCodeUnit(a.edgeId, b.edgeId))
  excluded.sort((a, b) => byCodeUnit(a.edgeId, b.edgeId))

  // ⑦ mapping 신원 — 중복 판정(canonical mapping) · 대상 공개 판정(현재 articles 와 대조)에만 쓴다
  //    🔴 같은 (intentId, slug) 원시 행 두 번은 실패다(P1-D) — 조용히 하나로 줄이면 연구 산출의 이상을 Bundle 이 덮는다.
  //       한 intent → 여러 slug · 한 slug → 여러 intent 는 정상(실측 2026-11-11: 427d4d 87행 중 정확 중복 0 · 다대다 존재)이다
  const mapKeys = new Set()
  const mappings = []
  for (const m of parseJsonl(files['mappings.jsonl'], 'RESEARCH_MAPPING_INVALID', 'mappings.jsonl')) {
    if (!isPlain(m) || !nonEmpty(m.intentId) || !nonEmpty(m.slug)) fail('RESEARCH_MAPPING_INVALID', 'mapping 신원 누락')
    const k = `${m.intentId}\u0000${m.slug}`
    if (mapKeys.has(k)) fail('RESEARCH_MAPPING_INVALID', `mapping 원시 중복 ${m.intentId} → ${m.slug}`)
    mapKeys.add(k)
    mappings.push({ intentId: m.intentId, slug: m.slug })
  }
  mappings.sort((a, b) => byCodeUnit(a.intentId, b.intentId) || byCodeUnit(a.slug, b.slug))

  const record = {
    schemaVersion: PLAN_INPUT_SCHEMA,
    graphVersion,
    provenance: {
      research: {
        manifestSha256: sha256Hex(research.manifestText),
        treeSha256: sha256Hex(canonicalJson(tree)),
        contentCombined: ch.combined,
        semanticHash: manifest.semanticHash,
        exportHash: manifest.exportHash,
        inputHashes: Object.fromEntries(want.map((n) => [n, inputHashes[n]])),
      },
      product: {
        graphFile: `src/content/magazine/graph/${graphVersion}.ts`,
        graphFileSha256: sha256Hex(product.graphFileText),
        currentSha256: sha256Hex(product.currentText),
        // 🔴 export 시점 control 전체 해시 — 출처 기록일 뿐이다. 현재 control 판정은 admission 이 한다(D1)
        controlSha256: sha256Hex(product.controlText),
      },
      // 제3자 원문 대조에 쓴 규칙 · corpus 신원 — 원문이 아니라 경로와 바이트 해시만(P1-E)
      sourceText: {
        rule: SOURCE_TEXT_RULE.id,
        corpusSha256: sha256Hex(canonicalJson(corpusRefs.map((ref) => [ref, isStr(evidenceTexts?.[ref]) ? sha256Hex(evidenceTexts[ref]) : null]))),
      },
    },
    intents,
    relations,
    mappings,
  }
  const bundle = sealBundle(record)
  // 조립 결과도 판독 계약을 그대로 통과해야 한다(조립과 판독이 다른 모양을 허용하지 않게)
  const text = prettyCanonical(bundle)
  parsePlanInputBundle(text)
  const evidenceRefs = new Set(relations.flatMap((r) => r.evidence.refs.map((x) => x.ref)))
  const textProvenance = Object.fromEntries(TEXT_PROVENANCE.map((v) => [v, intents.filter((x) => x.textProvenance === v).length]))
  return { bundle, text, report: { graphVersion, intents: intents.length, relations: relations.length, evidenceFiles: evidenceRefs.size, excluded, textProvenance } }
}

/**
 * 두 해시 (S2 P1-A · charter §18-B.1)
 *   bundleHash  **내용 신원** — compiler 가 읽는 것과 정확히 같은 집합(schemaVersion · graphVersion · intents · relations · mappings)만.
 *               🔴 provenance(export 시점 control · current · manifest generatedAt 바이트 · 트리)는 넣지 않는다 — 정당한 control 토글 ·
 *               current 주석 · manifest 재생성이 planHash 를 바꾸면 안 된다. ContentPlan · planHash 는 이 값만 싣는다.
 *   recordHash  **출처 봉인** — recordHash 를 뺀 Bundle 전체(provenance · bundleHash 포함). ContentPlan · planHash 에 들어가지 않는다.
 */
export const BUNDLE_CONTENT_KEYS = Object.freeze(['schemaVersion', 'graphVersion', 'intents', 'relations', 'mappings'])
export function bundleHashOf(b) {
  return sha256Hex(canonicalJson(Object.fromEntries(BUNDLE_CONTENT_KEYS.map((k) => [k, b[k]]))))
}
export function recordHashOf(b) {
  const { recordHash: _omit, ...rest } = b
  return sha256Hex(canonicalJson(rest))
}
/** 기록(두 해시 없음 또는 낡은 해시) → 두 해시를 새로 계산해 봉인한 Bundle 값. 순서: bundleHash 다음 recordHash(봉인이 bundleHash 를 덮는다) */
export function sealBundle(record) {
  const { bundleHash: _b, recordHash: _r, ...rest } = record
  const withContent = { ...rest, bundleHash: bundleHashOf(rest) }
  return { ...withContent, recordHash: recordHashOf(withContent) }
}

// ── 엄격 판독 ────────────────────────────────────────────────

const INTENT_KEYS = ['answerScope', 'audienceSituation', 'automationDecision', 'cluster', 'communityDestination', 'exclusions', 'forbiddenClaims',
  'inclusions', 'intentId', 'policyScope', 'primaryQuery', 'quarantined', 'territoryId', 'textProvenance', 'validationProfile']
const RELATION_KEYS = ['anchorLabel', 'edgeId', 'evidence', 'fromIntentId', 'placement', 'priority', 'readerReason', 'relationType', 'slot', 'toIntentId']

function exactKeys(v, keys, at) {
  if (!isPlain(v)) fail('BUNDLE_SCHEMA', `${at} 가 객체가 아니다`)
  const got = Object.keys(v).sort(byCodeUnit)
  const want = [...keys].sort(byCodeUnit)
  if (canonicalJson(got) !== canonicalJson(want)) {
    const extra = got.filter((k) => !want.includes(k)), missing = want.filter((k) => !got.includes(k))
    fail('BUNDLE_SCHEMA', `${at} 키가 계약과 다르다 (모르는 키 ${extra.join(',') || '없음'} · 빠진 키 ${missing.join(',') || '없음'})`)
  }
}
const need = (ok, at) => { if (!ok) fail('BUNDLE_SCHEMA', at) }
const strOrNullOk = (v) => v === null || isStr(v)
const sortedUnique = (xs, key) => xs.every((x, i) => i === 0 || byCodeUnit(key(xs[i - 1]), key(x)) < 0)

/**
 * 저장된 Bundle 판독 — exact key(중첩 객체 전부) · 형식 · 정렬 · 참조 · 두 해시(bundleHash · recordHash) · (텍스트면) canonical 바이트.
 * 🔴 모르는 키는 실패다(연구 원문 필드 · 비공개 필드가 섞여 들어오는 것을 막는다).
 * @param {string|object} input 저장 파일 텍스트 또는 값
 */
export function parsePlanInputBundle(input) {
  let b
  if (isStr(input)) { try { b = JSON.parse(input) } catch (e) { fail('BUNDLE_UNREADABLE', e.message) } } else b = input
  // 🔴 모양 판정 전에 희소 배열부터 — every(isStr) 는 빈 칸을 통과시키고 canonical 해시는 빈 칸을 지운다(P1-6)
  { const sp = sparsePathOf(b); if (sp) fail('BUNDLE_SCHEMA', `희소 배열(빈 칸) ${sp}`) }
  exactKeys(b, ['bundleHash', 'graphVersion', 'intents', 'mappings', 'provenance', 'recordHash', 'relations', 'schemaVersion'], 'bundle')
  need(b.schemaVersion === PLAN_INPUT_SCHEMA, `schemaVersion ${b.schemaVersion}`)
  need(isStr(b.graphVersion) && GRAPH_VERSION_RE.test(b.graphVersion), 'graphVersion 형식')
  exactKeys(b.provenance, ['product', 'research', 'sourceText'], 'provenance')
  const R = b.provenance.research, P = b.provenance.product, S = b.provenance.sourceText
  exactKeys(R, ['contentCombined', 'exportHash', 'inputHashes', 'manifestSha256', 'semanticHash', 'treeSha256'], 'provenance.research')
  need(HEX64_RE.test(R.manifestSha256) && HEX64_RE.test(R.treeSha256) && HEX16_RE.test(R.contentCombined) && HEX16_RE.test(R.semanticHash) && HEX16_RE.test(R.exportHash), 'provenance.research 해시 형식')
  need(b.graphVersion.endsWith(`-${R.contentCombined.slice(0, 6)}`), 'graphVersion 접미사가 contentCombined 와 다르다')
  // 🔴 정확히 canonical 다섯 이름 — 개수만 맞는 대체 이름은 실패다(P1-D)
  exactKeys(R.inputHashes, SNAPSHOT_NAMES_SORTED, 'provenance.research.inputHashes')
  need(Object.values(R.inputHashes).every((h) => isStr(h) && HEX64_RE.test(h)), 'provenance.research.inputHashes 해시 형식')
  exactKeys(P, ['controlSha256', 'currentSha256', 'graphFile', 'graphFileSha256'], 'provenance.product')
  need(P.graphFile === `src/content/magazine/graph/${b.graphVersion}.ts`, 'provenance.product.graphFile')
  need([P.controlSha256, P.currentSha256, P.graphFileSha256].every((h) => isStr(h) && HEX64_RE.test(h)), 'provenance.product 해시 형식')
  exactKeys(S, ['corpusSha256', 'rule'], 'provenance.sourceText')
  need(S.rule === SOURCE_TEXT_RULE.id && isStr(S.corpusSha256) && HEX64_RE.test(S.corpusSha256), 'provenance.sourceText 규칙 · 해시')

  need(Array.isArray(b.intents), 'intents 배열')
  for (const x of b.intents) {
    exactKeys(x, INTENT_KEYS, `intent ${x?.intentId}`)
    need(nonEmpty(x.intentId) && nonEmpty(x.territoryId) && nonEmpty(x.policyScope) && nonEmpty(x.automationDecision), `intent ${x.intentId} 신원`)
    need(['cluster', 'primaryQuery', 'audienceSituation', 'answerScope', 'communityDestination'].every((k) => strOrNullOk(x[k])), `intent ${x.intentId} 문자열 필드`)
    need(['inclusions', 'exclusions', 'forbiddenClaims'].every((k) => Array.isArray(x[k]) && x[k].every(isStr)), `intent ${x.intentId} 배열 필드`)
    need(VALIDATION_PROFILES.includes(x.validationProfile) && typeof x.quarantined === 'boolean', `intent ${x.intentId} 프로필·격리`)
    need(TEXT_PROVENANCE.includes(x.textProvenance), `intent ${x.intentId} textProvenance ${x.textProvenance}`)
  }
  need(sortedUnique(b.intents, (x) => x.intentId), 'intents 가 intentId code-unit 정렬·유일이 아니다')
  const ids = new Set(b.intents.map((x) => x.intentId))

  need(Array.isArray(b.relations), 'relations 배열')
  for (const r of b.relations) {
    exactKeys(r, RELATION_KEYS, `relation ${r?.edgeId}`)
    need(nonEmpty(r.edgeId) && ids.has(r.fromIntentId) && ids.has(r.toIntentId), `relation ${r.edgeId} 양 끝 intent`)
    need(['relationType', 'slot', 'placement', 'readerReason', 'anchorLabel'].every((k) => isStr(r[k])) && Number.isInteger(r.priority), `relation ${r.edgeId} 필드 형식`)
    exactKeys(r.evidence, ['basisSha256', 'objectSha256', 'refs'], `relation ${r.edgeId} evidence`)
    need(HEX64_RE.test(r.evidence.basisSha256) && HEX64_RE.test(r.evidence.objectSha256), `relation ${r.edgeId} evidence 해시`)
    need(Array.isArray(r.evidence.refs) && r.evidence.refs.length > 0, `relation ${r.edgeId} 증거 참조 0`)
    for (const d of r.evidence.refs) {
      exactKeys(d, ['ref', 'sha256'], `relation ${r.edgeId} evidence ref`)
      need(EVIDENCE_REF_RE.test(d.ref) && HEX64_RE.test(d.sha256), `relation ${r.edgeId} 증거 참조 형식`)
    }
    need(sortedUnique(r.evidence.refs, (d) => d.ref), `relation ${r.edgeId} 증거 참조 정렬·유일`)
  }
  need(sortedUnique(b.relations, (r) => r.edgeId), 'relations 가 edgeId code-unit 정렬·유일이 아니다')

  need(Array.isArray(b.mappings), 'mappings 배열')
  for (const m of b.mappings) {
    exactKeys(m, ['intentId', 'slug'], 'mapping')
    need(ids.has(m.intentId) && nonEmpty(m.slug), `mapping ${m.intentId}→${m.slug}`)
  }
  need(sortedUnique(b.mappings, (m) => `${m.intentId}\u0000${m.slug}`), 'mappings 정렬·유일')

  if (!isStr(b.bundleHash) || b.bundleHash !== bundleHashOf(b)) fail('BUNDLE_HASH_MISMATCH', 'bundleHash 가 내용(schemaVersion · graphVersion · intents · relations · mappings)과 다르다')
  if (!isStr(b.recordHash) || b.recordHash !== recordHashOf(b)) fail('RECORD_HASH_MISMATCH', 'recordHash 가 기록 전체(provenance · bundleHash 포함)와 다르다')
  if (isStr(input) && input !== prettyCanonical(b)) fail('BUNDLE_NOT_CANONICAL', '저장 바이트가 canonical 직렬화가 아니다')
  // 호출자가 받은 값을 고쳐도 판독 결과가 바뀌지 않게 canonical 왕복 사본을 돌려준다
  return JSON.parse(canonicalJson(b))
}
