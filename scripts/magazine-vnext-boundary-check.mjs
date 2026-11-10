#!/usr/bin/env node
/**
 * Magazine vNext S1 경계 검사 — 공용 코어·상수·판독기가 **한 곳**에만 있고 lib 가 CLI 에 기대지 않는지 본다.
 *
 *   node scripts/magazine-vnext-boundary-check.mjs
 *
 * 왜 있는가 (runbook §0.0B · charter §18-B.2 · S1)
 *   vNext(S2 compiler · S4 검증)는 QA 판정 · 상수 · WebP · graph control · 관계 수량을 CLI 없이 써야 한다.
 *   지금은 lib 가 QA CLI 를 import 하고, 같은 상수·파서가 여러 벌이며, brief 정책이 QA 원문을 정규식으로 다시 읽는다.
 *   S1 은 이것을 옮기는 단계라 — 옮기는 동안 **새 사본이 생기거나, 옮긴 구현 때문에 기존 변이가 지점 0곳이 되어
 *   조용히 무력해지는 것**을 막는 것이 이 검사의 일이다.
 *
 * 규칙마다 세 칸을 따로 둔다
 *   canonical  정본 위치. 아직 없어도 된다(S1 이 만든다)
 *   pending    지금 남아 있는 위반 — S1 커밋이 하나씩 줄인다. 🔴 **발견 집합과 정확히 같아야 한다**(ratchet).
 *              고쳤는데 목록에서 안 빼면 FAIL 이다 — 목록이 현실보다 넓으면 그 자리로 위반이 되돌아와도 못 본다.
 *   exempt     S1 범위 밖이라 남겨 두는 자리 — 사유를 함께 적는다. 늘리려면 이 파일을 고쳐야 한다(조용히 늘지 않는다)
 *
 * 🔴 읽기만 한다. 변이 하네스가 사본 루트를 MAGAZINE_VNEXT_BOUNDARY_ROOT 로 넘긴다(없으면 이 저장소).
 * 마지막 줄: `vNext 경계 검사: <n> pass, <n> fail`
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(process.env.MAGAZINE_VNEXT_BOUNDARY_ROOT ?? join(HERE, '..'))

/** S1 이 새로 만드는 정본 lib — 생기는 순간 m3a 낡은 개념 스캔(FILES)에 들어 있어야 한다 */
const S1_NEW_LIB = Object.freeze([
  'scripts/lib/magazine-literal.mjs',
  'scripts/lib/magazine-qa-constants.mjs',
  'scripts/lib/magazine-webp.mjs',
  'scripts/lib/magazine-qa-core.mjs',
  'scripts/lib/magazine-graph-control.mjs',
])

// ── 파일 집합 ─────────────────────────────────────────────
const rel = (...p) => join(...p).split('\\').join('/')
const list = (dir, re) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((f) => re.test(f)).sort().map((f) => rel(dir, f)) : [])
// 🔴 이름이 `magazine-` 로 시작하는 파일만 — 다른 검사가 옆에 잠깐 만드는 숨김 변이 사본(`.dssc-*` 등)은 대상이 아니다
const LIB = list('scripts/lib', /^magazine-.*\.mjs$/)
/** 운영·도구 CLI — 검사(-check)·변이(-mutation)는 뺀다 */
const PROD = list('scripts', /^magazine-.*\.m[jt]s$/).filter((f) => !/-(check|mutation)\.m[jt]s$/.test(f))
const text = new Map()
const read = (f) => {
  if (!text.has(f)) { let t = null; try { t = readFileSync(join(ROOT, f), 'utf8') } catch { /* 없음 = null */ } text.set(f, t) }
  return text.get(f)
}

/**
 * 주석 줄을 뺀 코드 **전체 텍스트** — 주석에 적힌 import·예시는 위반이 아니다.
 * 🔴 줄 단위로 보지 않는다. `} from '…'` · `import(\n  pathToFileURL(…))` 처럼 여러 줄에 걸친 import 를 놓치지 않게.
 */
const codeText = (f) => (read(f) ?? '').split('\n').filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line)).join('\n')

/**
 * 파일들에서 정규식(전역)이 맞는 **(파일 → 키) 출현 횟수**.
 * 🔴 집합이 아니라 횟수다 — 같은 파일 안에 구현을 두 벌 두는 것도 사본이다.
 */
function scan(files, re, keyOf = () => '') {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const out = new Map()
  for (const f of files) for (const m of codeText(f).matchAll(g)) {
    const key = `${f}${keyOf(m) ? ` → ${keyOf(m)}` : ''}`
    out.set(key, (out.get(key) ?? 0) + 1)
  }
  return out
}

/** `import(` · `imp(` 호출의 괄호 안 텍스트 — 문자열 안 괄호는 세지 않는다(여러 줄 인자도 그대로) */
function callArgs(src, opener) {
  const out = []
  let at = src.indexOf(opener)
  while (at !== -1) {
    const start = at + opener.length
    let depth = 1, quote = null, i = start
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i]
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') depth--
    }
    out.push(src.slice(start, i - 1))
    at = src.indexOf(opener, i)
  }
  return out
}

/** 파일들의 import 대상 (파일 → 대상) 횟수 — 정적 `from` · 부수효과 `import '…'` · 동적 `import(…)` · `imp(…)` */
function scanImports(files, staticTarget, dynamicTarget) {
  const out = new Map()
  const add = (k) => out.set(k, (out.get(k) ?? 0) + 1)
  for (const f of files) {
    const src = codeText(f)
    for (const m of src.matchAll(new RegExp(`(?:\\bfrom|^\\s*import)\\s+['"]${staticTarget.source}['"]`, 'gm'))) add(`${f} → ${m[1]}`)
    for (const opener of [/\bimport\(/g, /\bimp\(/g]) {
      for (const m of src.matchAll(opener)) {
        const [arg] = callArgs(src.slice(m.index), m[0])
        const hit = new RegExp(`['"](?:${dynamicTarget.source})['"]`).exec(arg ?? '')
        if (hit) add(`${f} → ${hit[1] ?? hit[2]}`)
      }
    }
  }
  return out
}

let pass = 0, fail = 0
const ok = (id, name) => { pass++; console.log(`PASS ${id} ${name}`) }
const bad = (id, name, why) => { fail++; console.log(`FAIL ${id} ${name} — ${why}`) }

/**
 * ratchet 판정 — 발견 = canonical ∪ pending ∪ exempt 안이어야 하고, pending 은 발견 안에 전부 있어야 한다.
 * canonical 은 파일 경로(그 파일 안 어디든), pending · exempt 는 scan 키 그대로.
 */
function ratchet(id, name, found, { canonical = [], pending = [], exempt = {}, once = false }) {
  const inCanonical = (k) => canonical.some((c) => k === c || k.startsWith(`${c} → `))
  const keys = [...found.keys()]
  const extra = keys.filter((k) => !inCanonical(k) && !pending.includes(k) && !(k in exempt))
  const stale = pending.filter((k) => !found.has(k))
  // 🔴 정의 규칙(once)은 정본 · pending 안에서도 한 파일 한 벌 — 같은 파일 안 두 번째 구현도 사본이다
  const doubled = once ? keys.filter((k) => found.get(k) > 1).map((k) => `${k} ×${found.get(k)}`) : []
  if (extra.length) bad(id, name, `새 위반 ${extra.length}곳: ${extra.join(' | ')}`)
  else if (doubled.length) bad(id, name, `같은 파일 안에 두 벌 이상: ${doubled.join(' | ')}`)
  else if (stale.length) bad(id, name, `pending 목록이 현실보다 넓다(고쳤으면 목록에서 뺀다): ${stale.join(' | ')}`)
  else ok(id, `${name} (남은 pending ${pending.length} · 예외 ${Object.keys(exempt).length})`)
}

// ── R1 lib → CLI import 0 ────────────────────────────────
// 정적 `from '../magazine-*.mjs'`(여러 줄 포함) · 부수효과 `import '../…'` · 동적 import(…'scripts/magazine-*.mjs') · rehearsal 의 imp(repo, 'scripts/magazine-*.mjs')
{
  const found = scanImports(LIB, /\.\.\/(magazine-[\w-]+\.m[jt]s)/, /scripts\/(magazine-[\w-]+\.m[jt]s)|\.\.\/(magazine-[\w-]+\.m[jt]s)/)
  ratchet('R1', 'lib 가 CLI 를 import 하지 않는다', found, {
    pending: [],
    exempt: {
      // producer 선정 함수(selectItems)를 실제 그대로 써야 rehearsal 이 운영 선정을 흉내 내지 않는다. 그 함수 이동은 S1 밖이다
      'scripts/lib/magazine-rehearsal-scenarios.mjs → magazine-producer-plan.mjs': 'S1 밖 — producer selectItems 이동 미승인',
    },
  })
}

// ── R2 QA 원문 재파싱 0 ───────────────────────────────────
// QA 소스 텍스트를 읽거나(readFileSync · qaPath 기본값) `const ${name} = [` 로 다시 파싱하는 동기화
{
  const re = /(readFileSync\([^)]*magazine-qa\.mjs)|(qaPath\s*=\s*[^)]*magazine-qa\.mjs)|(`const \$\{name\} = )/
  const kind = (m) => (m[1] ? 'QA 원문 읽기' : m[2] ? 'QA 경로 기본값' : '원문 재파싱 정규식')
  const found = scan([...LIB, ...PROD], re, kind)
  // 🔴 한시 예외는 정확히 이 키 1곳 × 1회다. 기본값(QA 경로 기본값) · 운영 경로 읽기(QA 원문 읽기)는 예외가 아니다 —
  //    인자 없는 운영 호출은 재파싱 0 이고, 그것은 R11(실제 호출) · VB29/VB30(기본 경로 부활 변이)이 본다.
  const LEGACY = 'scripts/lib/magazine-brief-policy.mjs → 원문 재파싱 정규식'
  if ((found.get(LEGACY) ?? 0) > 1) bad('R2', 'QA 원문을 다시 파싱해 동기화하지 않는다', `한시 예외 자리가 ${found.get(LEGACY)}벌이다 — 1벌만 허용`)
  else ratchet('R2', 'QA 원문을 다시 파싱해 동기화하지 않는다', found, {
    pending: [],
    exempt: {
      // assertQaWordsInSync(qaPath) 를 경로로 부르는 legacy 호출의 예외 종류 · 문장을 앞판 그대로 지키는 좁은 호환 분기(S1 동작 불변).
      // 운영 호출처는 경로를 넘기지 않는다. 경로 호출 계약을 정리할 때 이 분기와 함께 지운다
      [LEGACY]: 'S1 legacy 호환 — 명시적 string qaPath 분기만',
    },
  })
}

// ── R3 공용 상수 사본 0 ───────────────────────────────────
{
  const C = ['scripts/lib/magazine-qa-constants.mjs']
  const files = [...LIB, ...PROD]
  ratchet('R3a', 'BANNED_WORDS 값 정의는 한 곳', scan(files, /\[\s*'시니어'\s*,\s*'어르신'\s*,\s*'노인'\s*,\s*'실버'\s*\]/), {
    once: true, canonical: C, pending: [],
  })
  ratchet('R3b', 'MEDICAL_ASSERTIONS 값 정의는 한 곳', scan(files, /'치료됩니다'\s*,\s*'원인입니다'/), {
    once: true, canonical: C, pending: [],
  })
  ratchet('R3c', 'MEDICAL_REQUIRED · MEDICAL_SUGGESTED 정의는 한 곳', scan(files, /new Set\(\s*\[\s*'(menopause-symptom'\s*,\s*'sleep'\s*,\s*'clinic|daily'\s*,\s*'emotion)'\s*\]/,
    (m) => (m[1].startsWith('menopause') ? 'MEDICAL_REQUIRED' : 'MEDICAL_SUGGESTED')), {
    once: true, canonical: C, pending: [],
  })
  ratchet('R3d', 'HERO_WIDTH · HERO_HEIGHT 정의는 한 곳', scan(files, /\bHERO_(WIDTH\s*=\s*1200|HEIGHT\s*=\s*675)\b/, (m) => m[1].slice(0, m[1].search(/\s|=/))), {
    once: true, canonical: C, pending: [],
  })
}

// ── R4 리터럴 파서 사본 0 ─────────────────────────────────
ratchet('R4', 'sliceLiteral · evalLiteral 정의는 한 곳', scan([...LIB, ...PROD], /function\s+(sliceLiteral|evalLiteral)\s*\(/, (m) => m[1]), {
  once: true,
  canonical: ['scripts/lib/magazine-literal.mjs'],
  pending: [],
  exempt: { 'scripts/magazine-inventory.mjs → sliceLiteral': 'S1 밖 — 재고 계산 CLI 의 독자 사본, 이동 미승인' },
})

// ── R5 WebP 판독 사본 0 ───────────────────────────────────
ratchet('R5', 'WebP 헤더 판독은 한 곳', scan([...LIB, ...PROD], /(function\s+readWebpSize\s*\()|toString\(\s*'ascii'\s*,\s*8\s*,\s*12\s*\)/,
  (m) => (m[1] ? 'readWebpSize' : 'WEBP 헤더 파싱')), {
  once: true,
  canonical: ['scripts/lib/magazine-webp.mjs'],
  pending: [],
})

// ── R6 graph control 리터럴 판독 사본 0 ───────────────────
// control-edit 은 토큰 단위 편집·throw 계약이라 이 판독 패턴을 쓰지 않는다(분리 유지)
ratchet('R6', 'control.ts CONTROL 리터럴 판독은 한 곳', scan([...LIB, ...PROD], /indexOf\(\s*'export const CONTROL'\s*\)/), {
  once: true,
  canonical: ['scripts/lib/magazine-graph-control.mjs'],
  pending: [],
})

// ── R7 S1 새 lib 는 m3a 낡은 개념 스캔에 들어 있다 ─────────
{
  const m3a = read('scripts/magazine-m3a-check.mjs') ?? ''
  const at = m3a.indexOf('const FILES = [')
  const block = at === -1 ? null : m3a.slice(at, m3a.indexOf(']', at) + 1)
  if (!block) bad('R7', 'S1 새 lib 가 m3a FILES 스캔에 있다', 'm3a-check 의 `const FILES = [` 를 찾지 못했다')
  else {
    const missing = S1_NEW_LIB.filter((f) => existsSync(join(ROOT, f)) && !block.includes(`'${f}'`))
    if (missing.length) bad('R7', 'S1 새 lib 가 m3a FILES 스캔에 있다', `빠졌다: ${missing.join(', ')}`)
    else ok('R7', `S1 새 lib 가 m3a FILES 스캔에 있다 (존재 ${S1_NEW_LIB.filter((f) => existsSync(join(ROOT, f))).length}/${S1_NEW_LIB.length})`)
  }
}

// ── R8 S1 이 옮기는 코드를 겨냥한 변이 — 지점이 정확히 1곳 ──
// 🔴 CI 밖 변이(auto-recovery · rehearsal · g8 · graph-build)는 사람이 돌릴 때만 "지점 0곳"을 말한다.
//    여기서 매번 본다: 하네스에 그 변이가 그대로 있고, 겨냥 파일에 그 문장이 정확히 1곳.
//    S1 커밋이 구현을 옮기면 하네스와 이 표를 **같은 커밋에서** 새 위치로 옮긴다.
/** S1 C5 — MS15 · MS16 은 direct-spec-source-check 의 PATHS.control 을 바꾼다(라벨에 종류 'control' 을 포함해 본다) */
const CONTROL_HARNESS_PATH = Object.freeze({ def: "  control: join(ROOT, 'scripts/lib/magazine-graph-control.mjs'),\n" })
const MOVED_TARGETS = Object.freeze([
  // S1 C4 — QA 판정은 core 로 옮겼다. 다섯째 칸: 하네스 안의 경로 정의(def)와 그 변이가 쓰는 파일 참조(ref) — 표만 옮기고 하네스 경로를 남기면 잡는다
  ['scripts/magazine-auto-recovery-mutation.mjs', 'B QA 의 hard FAIL 제거', 'scripts/lib/magazine-qa-core.mjs', '  if (!body.hard.ok) report.fail(', { def: "qaCore: path.join(HERE, 'lib', 'magazine-qa-core.mjs')", ref: 'file: F.qaCore' }],
  ['scripts/magazine-rehearsal-mutation.mjs', '㉑ QA 의 발행 길이 FAIL 제거', 'scripts/lib/magazine-qa-core.mjs', '  if (!body.hard.ok) report.fail(', { def: "qaCore: path.join(HERE, 'lib', 'magazine-qa-core.mjs')", ref: 'file: F.qaCore' }],
  // D10 은 #825 directScenario prepare 리팩터링 뒤 지점 0곳(변이 무효)으로 남아 있었다 — 그 재발을 여기서 매번 본다
  ['scripts/magazine-rehearsal-mutation.mjs', 'D10 hero 를 미리 배치해 provider 호출 우회', 'scripts/magazine-rehearsal.mjs', '      const p = await prepareDirect(repo, { variant })\n'],
  ['scripts/magazine-direct-spec-source-check.mjs', "['control', 'MS15'", 'scripts/lib/magazine-graph-control.mjs', "  try { raw = evalLiteral(literal, 'control.ts') } catch { return null }", CONTROL_HARNESS_PATH],
  ['scripts/magazine-direct-spec-source-check.mjs', "['control', 'MS16'", 'scripts/lib/magazine-graph-control.mjs', "  if (typeof enabled !== 'boolean') return null\n  if (!Array.isArray(enabledClusters) || !enabledClusters.every((c) => typeof c === 'string' && c.trim())) return null\n", CONTROL_HARNESS_PATH],
  ['scripts/magazine-g8-promote-mutation.mjs', 'control 판 대조 제거', 'scripts/lib/magazine-g8-promoter.mjs', '  if (parseControlText(texts.graphControl)?.graphVersion !== payload.graphVersion) problems.push('],
  ['scripts/magazine-relation-policy-mutation.mjs', "'RP1'", 'scripts/lib/magazine-relation-policy.mjs', '  directMin: 2,'],
  ['scripts/magazine-relation-policy-mutation.mjs', "'RP2'", 'scripts/lib/magazine-relation-policy.mjs', 'export const RELATION_DISPLAY_TARGET = Object.freeze({\n  directMax: 3,\n'],
  ['scripts/magazine-relation-policy-mutation.mjs', "'RP3'", 'scripts/lib/magazine-direct-spec-source.mjs', "  if (path === 'relations.direct') return Array.isArray(value) && isValidDirectCount(value.length)"],
  ['scripts/magazine-relation-policy-mutation.mjs', "'RP4'", 'scripts/lib/magazine-direct-spec-source.mjs', "  if (path === 'relations.discovery') return isSingleDiscovery(value)\n"],
  ['scripts/magazine-relation-policy-mutation.mjs', "'RP5'", 'scripts/lib/magazine-article-spec.mjs', '  if (!isValidDirectCount(direct.length)) {'],
  ['scripts/magazine-relation-policy-mutation.mjs', "'RP7'", 'scripts/lib/magazine-graph-build.mjs', 'productionMinimum: Object.freeze({ direct: RELATION_POLICY.directMin,'],
  ['scripts/magazine-relation-policy-mutation.mjs', "'RP8'", 'scripts/lib/magazine-article-spec.mjs', "import { RELATION_CONTRACT_LABEL, RELATION_POLICY, isValidDirectCount } from './magazine-relation-policy.mjs'\n"],
  ['scripts/magazine-direct-spec-source-authoring-mutation.mjs', "'MA11'", 'scripts/lib/magazine-direct-spec-source-authoring.mjs', "  if (!direct || !isValidDirectCount(direct.length)) problems.push('RELATIONS_DIRECT_COUNT_INVALID')\n  if (!isSingleDiscovery(discovery)) problems.push('RELATIONS_DISCOVERY_NOT_1')\n"],
  ['scripts/magazine-direct-spec-source-authoring-mutation.mjs', "'MA28'", 'scripts/lib/magazine-direct-spec-source-authoring.mjs', '  if (!direct || !isValidDirectCount(direct.length)) problems.push('],
  ['scripts/magazine-direct-spec-source-authoring-mutation.mjs', "'MA31'", 'scripts/lib/magazine-direct-spec-source-authoring.mjs', "  if (!isSingleDiscovery(discovery)) problems.push('RELATIONS_DISCOVERY_NOT_1')"],
  ['scripts/magazine-graph-build-mutation.mjs', "'M8 생산 최소 direct 2 → 1'", 'scripts/lib/magazine-graph-build.mjs', 'productionMinimum: Object.freeze({ direct: RELATION_POLICY.directMin,'],
  ['scripts/magazine-graph-build-mutation.mjs', "'M114 readiness 보고서에서 inputs 누락'", 'scripts/lib/magazine-graph-build.mjs', '    inputs,\n    policy: READINESS_POLICY,'],
])
/** 하네스 소스에 적힌 JS 문자열 리터럴 모양 — 홑·겹따옴표 어느 쪽이든 */
const literalForms = (s) => {
  const base = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
  return [base.replace(/'/g, "\\'"), base.replace(/"/g, '\\"')]
}
{
  const problems = []
  for (const [harness, label, target, find, path] of MOVED_TARGETS) {
    const h = read(harness), t = read(target)
    if (h === null) { problems.push(`${harness} 없음`); continue }
    if (!h.includes(label)) { problems.push(`${harness} 에 변이 ${label} 이 없다`); continue }
    if (!literalForms(find).some((f) => h.includes(f))) { problems.push(`${harness} ${label} 의 겨냥 문장이 표와 다르다(하네스와 표를 같은 커밋에서 옮긴다)`); continue }
    if (path) {
      // 하네스가 실제로 그 파일을 바꾸는가 — 경로 정의 1곳 + 이 변이(라벨 → 겨냥 문장 사이)가 그 정의를 쓴다
      const at = h.indexOf(label)
      const seg = h.slice(at, Math.max(...literalForms(find).map((f) => h.indexOf(f, at))))
      if (h.split(path.def).length - 1 !== 1) { problems.push(`${harness} 에 경로 정의 ${path.def} 가 정확히 1곳이 아니다`); continue }
      if (path.ref && !seg.includes(path.ref)) { problems.push(`${harness} ${label} 이 ${path.ref} 를 쓰지 않는다`); continue }
    }
    const count = t === null ? 0 : t.split(find).length - 1
    if (count !== 1) problems.push(`${label} → ${target} 지점 ${count}곳`)
  }
  if (problems.length) bad('R8', `옮기는 코드를 겨냥한 변이 지점이 정확히 1곳 (${MOVED_TARGETS.length}개)`, problems.join(' | '))
  else ok('R8', `옮기는 코드를 겨냥한 변이 지점이 정확히 1곳 (${MOVED_TARGETS.length}개)`)
}

// ── R9 이 검사·변이가 실제로 등록돼 돈다 ─────────────────
{
  let scripts = {}
  try { scripts = JSON.parse(read('package.json') ?? '{}').scripts ?? {} } catch { /* 아래에서 FAIL */ }
  const chain = String(scripts['magazine:auto-check'] ?? '').split('&&').map((s) => s.trim())
  const need = ['node scripts/magazine-vnext-boundary-check.mjs', 'node scripts/magazine-vnext-boundary-mutation.mjs']
  const problems = []
  if (scripts['check:magazine-vnext-boundary'] !== need[0]) problems.push('check:magazine-vnext-boundary 스크립트가 없다·다르다')
  if (scripts['check:magazine-vnext-boundary-mutation'] !== need[1]) problems.push('check:magazine-vnext-boundary-mutation 스크립트가 없다·다르다')
  for (const n of need) if (!chain.includes(n)) problems.push(`magazine:auto-check 체인에 "${n}" 가 없다`)
  if (problems.length) bad('R9', '경계 검사·변이가 package 와 magazine:auto-check(CI) 에 등록돼 있다', problems.join(' | '))
  else ok('R9', '경계 검사·변이가 package 와 magazine:auto-check(CI) 에 등록돼 있다')
}

// ── R10 운영 CLI 가 QA CLI 를 import 하지 않는다 ───────────
// spawn 대상 경로(auto-register 의 `scripts/magazine-qa.mjs`)는 import 가 아니라 위반이 아니다
ratchet('R10', '운영 CLI 가 magazine-qa.mjs 를 import 하지 않는다',
  scanImports(PROD.filter((f) => f !== 'scripts/magazine-qa.mjs'), /\.\/(magazine-qa\.mjs)/, /\.\/(magazine-qa\.mjs)|scripts\/(magazine-qa\.mjs)/), {
  pending: [],
})

// ── R11 공용 상수 · 판독 함수는 같은 객체다 (런타임) ──────
// 🔴 R3 은 값 리터럴만 본다 — `[...BANNED_WORDS]` · `new Set([...])` 처럼 펼친 사본은 리터럴이 없어 못 본다.
//    그래서 실제로 적재해 brief 정책 · QA CLI 가 내보내는 값이 정본과 **같은 객체**인지 본다.
//    🔴 QA 안에서만 쓰는 사본(내보내지 않는 이름)은 이 규칙 밖이다 — 그 자리는 R3(리터럴)만 본다.
{
  const problems = []
  try {
    const at = (rel) => import(pathToFileURL(join(ROOT, rel)).href)
    const C = await at('scripts/lib/magazine-qa-constants.mjs')
    const P = await at('scripts/lib/magazine-brief-policy.mjs')
    const Q = await at('scripts/magazine-qa.mjs')
    try { if (P.assertQaWordsInSync() !== true) problems.push('assertQaWordsInSync() 가 true 가 아니다') } catch (e) { problems.push(`assertQaWordsInSync() 가 던졌다: ${String(e.message).split('\n')[0]}`) }
    for (const n of ['BANNED_WORDS', 'MEDICAL_ASSERTIONS']) if (P[n] !== C[n]) problems.push(`brief 정책 ${n} 이 정본 객체가 아니다`)
    for (const n of ['BANNED_WORDS', 'MEDICAL_REQUIRED', 'MEDICAL_SUGGESTED', 'HERO_WIDTH', 'HERO_HEIGHT']) if (Q[n] !== C[n]) problems.push(`QA CLI 가 내보내는 ${n} 이 정본과 다르다`)
    // S1 C3 — 판독 함수도 다시 내보내는 자리가 정본과 같은 함수여야 한다(감싼 함수 · 화살표 사본은 R4·R5 정규식을 피한다)
    const LT = await at('scripts/lib/magazine-literal.mjs')
    const W = await at('scripts/lib/magazine-webp.mjs')
    const L = await at('scripts/lib/magazine-load.mjs')
    for (const n of ['sliceLiteral', 'evalLiteral']) if (typeof LT[n] !== 'function' || L[n] !== LT[n]) problems.push(`load 가 내보내는 ${n} 이 정본 함수가 아니다`)
    if (typeof W.readWebpSize !== 'function' || Q.readWebpSize !== W.readWebpSize) problems.push('QA CLI 가 내보내는 readWebpSize 가 정본 함수가 아니다')
    // S1 C4 — QA CLI 의 runQa 는 core 의 그 함수여야 한다(감싼 함수 · 사본이면 다른 객체다)
    const QC = await at('scripts/lib/magazine-qa-core.mjs')
    if (typeof QC.runQa !== 'function' || Q.runQa !== QC.runQa) problems.push('QA CLI 가 내보내는 runQa 가 core 정본 함수가 아니다')
    // S1 C5 — control 판독 호환 export 는 남아 있어야 하고, 정본과 같은 함수여야 한다(감싼 함수 · 사본이면 다른 객체다)
    const GC = await at('scripts/lib/magazine-graph-control.mjs')
    const GBM = await at('scripts/lib/magazine-graph-build.mjs')
    const DSM = await at('scripts/lib/magazine-direct-spec-source.mjs')
    if (typeof GC.parseControlText !== 'function' || typeof GC.parseGraphControl !== 'function') problems.push('정본 graph-control 이 두 판독 함수를 내보내지 않는다')
    if (!('parseControlText' in GBM)) problems.push('graph-build 호환 export parseControlText 가 없다')
    else if (GBM.parseControlText !== GC.parseControlText) problems.push('graph-build 의 parseControlText 가 정본 함수가 아니다')
    if (!('parseGraphControl' in DSM)) problems.push('direct-spec-source 호환 export parseGraphControl 이 없다')
    else if (DSM.parseGraphControl !== GC.parseGraphControl) problems.push('direct-spec-source 의 parseGraphControl 이 정본 함수가 아니다')
  } catch (e) { problems.push(`적재 실패: ${String(e?.message ?? e).split('\n')[0]}`) }
  if (problems.length) bad('R11', '공용 상수 · 판독 함수는 다시 내보내는 자리에서 정본과 같은 객체다', problems.join(' | '))
  else ok('R11', '공용 상수 · 판독 함수는 다시 내보내는 자리에서 정본과 같은 객체다')
}

// ── R12 QA 판정 구현은 core 한 곳 ──────────────────────────
// 🔴 R11 은 내보내는 runQa 의 동일성만 본다 — CLI 가 core 를 다시 내보내면서 main 은 자기 사본을 쓰면 R11 은 통과한다.
//    그래서 판정 함수(runQa · checkArticle · checkCollisions)의 정의(function · const 화살표)가 core 밖에 없는지 본다.
ratchet('R12', 'QA 판정 구현(runQa · checkArticle · checkCollisions)은 core 한 곳',
  scan([...LIB, ...PROD], /(?:function\s+|const\s+)(runQa|checkArticle|checkCollisions)\s*[(=]/, (m) => m[1]), {
  once: true, canonical: ['scripts/lib/magazine-qa-core.mjs'], pending: [],
})

// ── R13 control 판독 정의는 정본 한 곳 ─────────────────────
// 🔴 판독 함수 · 공유 찾기·eval 의 정의(function · const/let/var)가 정본 밖에 다시 생기면 사본이다(감싼 호환 함수도 정의다)
const CONTROL_CANON = 'scripts/lib/magazine-graph-control.mjs'
ratchet('R13', 'control 판독 정의(parseControlText · parseGraphControl · controlLiteral · evalControl)는 정본 한 곳',
  scan([...LIB, ...PROD], /(?:function\s+|(?:const|let|var)\s+)(parseControlText|parseGraphControl|controlLiteral|evalControl)\s*[(=]/, (m) => m[1]), {
  once: true, canonical: [CONTROL_CANON], pending: [],
})

// ── R14 control 판독 소비 경계 ─────────────────────────────
// 🔴 ① 두 이름의 import 는 정본에서만 ② 다시 내보내기는 정확한 호환 선언 2개뿐(graph-build · direct-spec-source)
//    ③ 프로필 소유 — 엄격(parseGraphControl)은 direct-spec-source, legacy(parseControlText)는 graph-build · research-current · g8.
//       엄격 판독이 실패할 때 느슨한 판독으로 넘어가는 경로(fallback)를 막는다. 새 소비처는 이 표를 고쳐야 열린다
{
  const NAMES = ['parseControlText', 'parseGraphControl']
  const OWNERS = {
    parseControlText: ['scripts/lib/magazine-graph-build.mjs', 'scripts/lib/magazine-research-current.mjs', 'scripts/lib/magazine-g8-promoter.mjs'],
    parseGraphControl: ['scripts/lib/magazine-direct-spec-source.mjs'],
  }
  const COMPAT = { 'scripts/lib/magazine-graph-build.mjs': 'export { parseControlText }', 'scripts/lib/magazine-direct-spec-source.mjs': 'export { parseGraphControl }' }
  const found = new Map()
  const add = (k) => found.set(k, (found.get(k) ?? 0) + 1)
  for (const f of [...LIB, ...PROD].filter((x) => x !== CONTROL_CANON)) {
    const src = codeText(f)
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      for (const spec of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter((x) => NAMES.includes(x))) {
        if (!/(^|\/)magazine-graph-control\.mjs$/.test(m[2])) add(`${f} → ${spec} 를 ${m[2]} 에서 import`)
      }
    }
    for (const m of src.matchAll(/export\s*\{([^}]*)\}(\s*from\s*['"][^'"]+['"])?/g)) {
      if (!m[1].split(',').some((x) => NAMES.some((n) => new RegExp(`\\b${n}\\b`).test(x)))) continue
      if (m[0] !== COMPAT[f]) add(`${f} → 호환 선언이 아닌 다시 내보내기: ${m[0].replace(/\s+/g, ' ')}`)
    }
    for (const n of NAMES) if (new RegExp(`\\b${n}\\b`).test(src) && !OWNERS[n].includes(f)) add(`${f} → ${n} 를 쓴다(이 프로필의 소비처가 아니다)`)
  }
  for (const [f, decl] of Object.entries(COMPAT)) if (codeText(f).split(decl).length - 1 !== 1) add(`${f} → 호환 선언 ${decl} 가 정확히 1곳이 아니다`)
  ratchet('R14', 'control 판독은 정본에서 import · 호환 다시 내보내기 2곳뿐 · 프로필 소유 고정', found, { pending: [] })
}

// ── R15 정본 graph-control 은 부작용 없는 모듈만 import ────
// 🔴 magazine-load 는 적재 순간 drafts 주입을 검사해 exit 2 로 끝난다 — 정본이 그것을 끌어오면 소비처의 import 시점 동작이 바뀐다
{
  const name = '정본 graph-control 은 magazine-literal(과 node 내장)만 import'
  if (read(CONTROL_CANON) === null) bad('R15', name, '정본 파일이 없다')
  else {
    const src = codeText(CONTROL_CANON)
    const targets = [...src.matchAll(/(?:\bfrom|^\s*import)\s+['"]([^'"]+)['"]/gm), ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
    const extra = targets.filter((t) => t !== './magazine-literal.mjs' && !t.startsWith('node:'))
    if (extra.length) bad('R15', name, `허용 밖 import: ${extra.join(', ')}`)
    else if (!targets.includes('./magazine-literal.mjs')) bad('R15', name, 'magazine-literal 을 import 하지 않는다')
    else ok('R15', name)
  }
}

// ── R16 관계 수량 이름 소유 (S1 C6) ──────────────────────────
// 🔴 세 층(legacy 호환 · 표시 목표 · vNext 관계 최소)은 relation-policy 한 곳이 정의한다. 이름만 나눴고 legacy 값 · 판정은 앞판 그대로다.
//    ① 수량 숫자 리터럴(directMin · directMax · direct · discovery: <숫자>)은 정책 파일 밖에 없다(사본 0)
//    ② vNext 관계 최소(VNEXT_PUBLICATION_RELATION_MINIMUM)는 정책 파일 밖 어디도 아직 읽지 않는다 —
//       legacy 소비처가 읽으면 GRAPH_READY · source · ArticleSpec 판정이 쉬워진다. 첫 소비처는 S2 compiler 이고 그때 이 규칙을 고쳐 연다
//    ③ 정책 이름 · 호환 이름의 정의는 정책 파일 한 곳 (같은 이름의 사본 · 감싼 함수 금지)
//    ④ 호환 이름은 같은 객체 · 같은 함수 · 같은 문자열이고, builder 의 생산 최소는 legacy · 표시는 표시 목표 값이다(실제 적재)
//    ⑤ legacy 기준 · 표시 목표 블록은 숫자 리터럴만 — 서로(또는 다른 이름)에 기대지 않는다
{
  const POLICY = 'scripts/lib/magazine-relation-policy.mjs'
  const found = new Map()
  const add = (k) => found.set(k, (found.get(k) ?? 0) + 1)
  const NAMES = ['RELATION_POLICY', 'LEGACY_RELATION_POLICY', 'RELATION_DISPLAY_TARGET', 'VNEXT_PUBLICATION_RELATION_MINIMUM', 'isValidDirectCount', 'isSingleDiscovery', 'isLegacyDirectCount', 'isLegacySingleDiscovery', 'RELATION_CONTRACT_LABEL', 'LEGACY_RELATION_CONTRACT_LABEL']
  const defRe = new RegExp(`(?:function\\s+|(?:const|let|var)\\s+)(${NAMES.join('|')})\\b\\s*[(=]`, 'g')
  for (const f of [...LIB, ...PROD].filter((x) => x !== POLICY)) {
    const src = codeText(f)
    for (const m of src.matchAll(/\b(directMin|directMax|direct|discovery)\s*:\s*\d/g)) add(`${f} → 수량 숫자 리터럴 ${m[0]}`)
    if (/\bVNEXT_PUBLICATION_RELATION_MINIMUM\b/.test(src)) add(`${f} → VNEXT_PUBLICATION_RELATION_MINIMUM 를 읽는다(아직 소비처 0 — S2 compiler 가 연다)`)
    for (const m of src.matchAll(defRe)) add(`${f} → ${m[1]} 정의 사본`)
  }
  // ⑤ 소유 구조 — legacy 기준과 표시 목표는 각자 자기 숫자를 가진다. 블록 안 값이 다른 이름을 빌리면(예: legacy ← 표시 목표)
  //    표시(UI) 변경이 legacy 판정을 조용히 바꾼다. 값은 여기 다시 적지 않고, "숫자 리터럴만" 이라는 모양만 본다
  {
    const policySrc = read(POLICY) ?? ''
    const OWN = { LEGACY_RELATION_POLICY: ['directMin', 'directMax', 'discovery'], RELATION_DISPLAY_TARGET: ['directMax', 'discovery'] }
    for (const [name, keys] of Object.entries(OWN)) {
      const m = new RegExp(`export const ${name} = Object\\.freeze\\(\\{([^}]*)\\}\\)`).exec(policySrc)
      if (!m) { add(`정책 → ${name} 블록(Object.freeze({…}))을 찾지 못했다`); continue }
      const props = m[1].split('\n').map((l) => l.trim()).filter(Boolean)
      const seen = props.map((p) => /^(\w+)\s*:\s*\d+,?$/.exec(p)?.[1] ?? null)
      if (seen.includes(null)) add(`정책 → ${name} 값이 숫자 리터럴이 아니다(다른 이름에 기대는 소유 결합): ${props.filter((_, i) => seen[i] === null).join(' | ')}`)
      else if (JSON.stringify(seen) !== JSON.stringify(keys)) add(`정책 → ${name} 키가 ${keys.join(',')} 가 아니다: ${seen.join(',')}`)
    }
  }
  try {
    const at = (rel) => import(pathToFileURL(join(ROOT, rel)).href)
    const RP = await at(POLICY)
    const GBR = await at('scripts/lib/magazine-graph-build.mjs')
    if (RP.RELATION_POLICY !== RP.LEGACY_RELATION_POLICY) add('정책 → RELATION_POLICY 가 LEGACY_RELATION_POLICY 와 같은 객체가 아니다')
    if (typeof RP.isValidDirectCount !== 'function' || RP.isLegacyDirectCount !== RP.isValidDirectCount) add('정책 → isLegacyDirectCount 가 isValidDirectCount 와 같은 함수가 아니다')
    if (typeof RP.isSingleDiscovery !== 'function' || RP.isLegacySingleDiscovery !== RP.isSingleDiscovery) add('정책 → isLegacySingleDiscovery 가 isSingleDiscovery 와 같은 함수가 아니다')
    if (typeof RP.RELATION_CONTRACT_LABEL !== 'string' || RP.LEGACY_RELATION_CONTRACT_LABEL !== RP.RELATION_CONTRACT_LABEL) add('정책 → LEGACY_RELATION_CONTRACT_LABEL 이 RELATION_CONTRACT_LABEL 과 다르다')
    const pm = GBR.READINESS_POLICY?.productionMinimum, dt = GBR.READINESS_POLICY?.displayTarget, L = RP.LEGACY_RELATION_POLICY, D = RP.RELATION_DISPLAY_TARGET
    if (!L || pm?.direct !== L.directMin || pm?.discovery !== L.discovery) add('graph-build → 생산 최소가 legacy 호환 기준 값이 아니다')
    if (!D || dt?.directMax !== D.directMax || dt?.discovery !== D.discovery) add('graph-build → 표시 목표가 RELATION_DISPLAY_TARGET 값이 아니다')
  } catch (e) { add(`적재 실패: ${String(e?.message ?? e).split('\n')[0]}`) }
  ratchet('R16', '관계 수량은 relation-policy 가 세 이름으로 소유 · legacy 판정 그대로 · vNext 최소 소비 0', found, { pending: [] })
}

console.log(`\nvNext 경계 검사: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
