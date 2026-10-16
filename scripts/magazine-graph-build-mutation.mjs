#!/usr/bin/env node
/**
 * M-GRAPH 결정적 build 변이 시험 — 지키는 줄을 하나씩 망가뜨리면 검사가 **실제로** 실패해야 한다.
 *
 *   node scripts/magazine-graph-build-mutation.mjs
 *
 * 🔴 저장소 파일을 고치지 않는다. lib · CLI 의 변이 사본을 임시 폴더에 만들고(상대 import 는 절대 경로로),
 *    검사에 MGRAPH_BUILD_LIB · MGRAPH_BUILD_CLI 로 주입한다.
 * 🔴 검출로 세는 것은 `RESULT pass=… fail=N(N>0)` 과 exit 1 뿐이다.
 *    변이 지점 없음 · 지점 중복 · 문법 오류 · 적재 실패(LOAD_ERROR) · RESULT 없음은 **하네스 FAIL** 이다.
 * 🔴 무변이 사본으로 먼저 돌려 fail=0 이어야 한다 — 사본 주입 경로가 고장 나면 모든 변이가 거짓 검출된다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = { lib: join(HERE, 'lib/magazine-graph-build.mjs'), cli: join(HERE, 'magazine-graph-build.mjs') }
const CHECK = join(HERE, 'magazine-graph-build-check.mjs')

const MUTATIONS = [
  { id: 'M1 graphVersion 날짜를 벽시계에서', file: 'lib', from: 'const graphVersion = `g-${eff.versionDate}-${combined.slice(0, 6)}`',
    to: "const graphVersion = `g-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${combined.slice(0, 6)}`", expect: '반례1' },
  { id: 'M2 KST 날짜 대신 UTC 날짜', file: 'lib', from: 'const kstDate = new Date(ms + 9 * 3600e3).toISOString().slice(0, 10)',
    to: 'const kstDate = new Date(ms).toISOString().slice(0, 10)', expect: '반례1b' },
  { id: 'M3 semanticHash 에 generatedAt 포함', file: 'lib', from: 'const { generatedAt: _omit, ...rest } = slim', to: 'const rest = slim', expect: '반례2' },
  { id: 'M4 contentHash 에 generatedAt 섞기', file: 'lib', from: 'const combined = sha16(hI + hE + hM)', to: 'const combined = sha16(hI + hE + hM + gen)', expect: '반례2' },
  { id: 'M5 bundle 머리말 시각을 벽시계로', file: 'lib', from: '// 생성: ${slim.generatedAt}', to: '// 생성: ${new Date().toISOString()}', expect: '반례3' },
  { id: 'M6 판 전환 파일 가드 제거', file: 'lib', from: "if (seen) fail('OUT_DIR_FORBIDDEN', 'out-dir 에 current.ts",
    to: "if (false) fail('OUT_DIR_FORBIDDEN', 'out-dir 에 current.ts", expect: '반례4b' },
  { id: 'M7 manifest 에 입력 절대 경로 기록', file: 'lib', from: "    inputHashes: inputs.hashes,",
    to: "    inputHashes: inputs.hashes, inputRoot: process.argv[process.argv.indexOf('--input-root') + 1],", expect: '반례5' },
  { id: 'M8 생산 최소 direct 2 → 1', file: 'lib', from: 'productionMinimum: Object.freeze({ direct: 2, discovery: 1 })',
    to: 'productionMinimum: Object.freeze({ direct: 1, discovery: 1 })', expect: '반례6' },
  { id: 'M9 discovery 최소 무시', file: 'lib', from: 'if (discoveryCount < min.discovery) shortfall.push', to: 'if (false) shortfall.push', expect: '반례6b' },
  { id: 'M10 HOLD·비자동화 edge 를 근거로', file: 'lib', from: 'if (!e.layers.AUTOMATION_READY) why.push(', to: 'if (false) why.push(', expect: '반례7' },
  { id: 'M11 미공개 대상을 근거로', file: 'lib', from: "if (slugs.length === 0) why.push('TARGET_NOT_PUBLIC')", to: 'if (false) why.push()', expect: '반례7' },
  { id: 'M12 빈 이유(weak filler) 허용', file: 'lib', from: "if (!nonEmpty(e.readerReason) || !nonEmpty(e.anchorLabel)) why.push('WEAK_REASON_OR_ANCHOR')",
    to: 'if (false) why.push()', expect: '반례7' },
  { id: 'M13 control-off·cluster 꺼짐을 표시 count 에 반영 안 함', file: 'lib', from: 'const visible = clusterOn(cluster)', to: 'const visible = true', expect: '반례7b' },
  { id: 'M14 꺼진 표면을 근거로', file: 'lib', from: 'if (!enabledSurfaces.has(e.placement)) why.push(', to: 'if (false) why.push(', expect: '반례7c' },
  { id: 'M15 reverse 출발 글 cluster 무시', file: 'lib', from: 'if (!clusterOn(articles.get(slug).cluster ?? null)) continue', to: '', expect: '반례7d' },
  { id: 'M16 reverse 불일치 blocker 제거', file: 'lib', from: "if (mismatches.length) blockers.push('REVERSE_LINK_MISMATCH')", to: '', expect: '반례8' },
  { id: 'M17 reverse 부재 허용', file: 'lib', from: "if (reverseSources.length === 0) shortfall.push('REVERSE_LINK_ABSENT')", to: '', expect: '반례8c' },
  { id: 'M18 G8 미판독을 조용히 통과', file: 'lib', from: "admissionState = 'UNREAD'; admissionBlockers.push('G8_ADMISSION_UNREAD')",
    to: "admissionState = 'UNREAD'", expect: '반례8d' },
  { id: 'M19 edge 없는 미등록 intent 누락', file: 'lib', from: 'if (registered(id)) continue',
    to: 'if (registered(id) || !layers.edges.some((e) => e.fromIntentId === id)) continue', expect: '반례9' },
  { id: 'M20 같은 판 폴더 덮어쓰기', file: 'lib', from: "if (!same) fail('OUT_STAGE_CONFLICT'", to: "if (false) fail('OUT_STAGE_CONFLICT'", expect: '반례3b' },
  { id: 'M21 out-dir 를 문자열 경로로 판정', file: 'lib', from: 'const canon = canonicalPath(outDir)', to: 'const canon = resolve(outDir)', expect: '반례10' },
  { id: 'M22 금지 구역을 문자열 경로로 판정', file: 'lib', from: 'const root = canonicalPath(f.path)', to: 'const root = resolve(f.path)', expect: '반례4b' },
  { id: 'M23 끊어진 symlink 허용', file: 'lib', from: "if (dangling) fail('OUT_DIR_FORBIDDEN'", to: "if (false) fail('OUT_DIR_FORBIDDEN'", expect: '반례10b' },
  { id: 'M24 판정 뒤 symlink 교체 무시(mkdir 전)', file: 'lib', from: "if (st.isSymbolicLink() || !st.isDirectory()) fail('OUT_DIR_CHANGED', `판정 뒤 경로가",
    to: "if (false) fail('OUT_DIR_CHANGED', `판정 뒤 경로가", expect: '반례10d' },
  { id: 'M25 rename 전 경로 재확인 제거', file: 'lib', from: '    hooks.beforeRename?.()\n    ensureRealDirs(canon)\n', to: '    hooks.beforeRename?.()\n', expect: '반례10d' },
  { id: 'M26 CLI 가 admission-root 를 금지 구역에서 뺌', file: 'cli', from: "if (admissionRoot) forbidden.push(", to: "if (false) forbidden.push(", expect: '반례10b' },
  { id: 'M27 달력 왕복 대조 제거', file: 'lib', from: 'if (!wallClockRoundTrips(text, offsetMin)) fail(', to: 'if (false) fail(', expect: '반례11' },
  { id: 'M28 offset 범위 검사 제거', file: 'lib', from: "if (oh > 14 || om > 59 || (oh === 14 && om > 0)) fail(", to: 'if (false) fail(', expect: '반례11' },
  { id: 'M29 입력 구조 검증 호출 제거', file: 'lib', from: '  validateInputs(out)\n', to: '', expect: '반례12' },
  { id: 'M30 edgeId 형식 검사 제거', file: 'lib', from: "label: 'graph edge', keyOf: (e) => e.edgeId, valid: isEdgeId,", to: "label: 'graph edge', keyOf: (e) => e.edgeId, valid: () => true,", expect: '반례12' },
  { id: 'M31 edgeId 중복 검사 제거', file: 'lib', from: "label: 'graph edge', keyOf: (e) => e.edgeId, valid: isEdgeId, unique: true", to: "label: 'graph edge', keyOf: (e) => e.edgeId, valid: isEdgeId, unique: false", expect: '반례12' },
  { id: 'M32 relationType 계약 검사 제거', file: 'lib', from: 'if (!Object.hasOwn(RELATION_TO_SLOT, e.relationType)) bad.push(', to: 'if (false) bad.push(', expect: '반례12' },
  { id: 'M33 intent 집합 정합 검사 제거', file: 'lib', from: 'if (onlyAuto.length || onlyCanon.length) bad.push(', to: 'if (false) bad.push(', expect: '반례12' },
  { id: 'M34 edge 끝점 intent 검사 제거', file: 'lib', from: "else if (!intentIds.has(e.toIntentId)) bad.push(", to: 'else if (false) bad.push(', expect: '반례12' },
  { id: 'M35 product-root 금지를 src 로 축소', file: 'cli', from: "{ label: 'product-root', path: productRoot }", to: "{ label: 'product-root', path: join(productRoot, 'src') }", expect: '반례13' },
  { id: 'M36 product-root 금지 제거', file: 'cli', from: "const forbidden = [{ label: 'product-root', path: productRoot }, ", to: 'const forbidden = [', expect: '반례13' },
  { id: 'M37 canonical 빈 집합 허용', file: 'lib', from: "if (!canonical.length) bad.push(", to: 'if (false) bad.push(', expect: '반례14' },
  { id: 'M38 automation 빈 집합 허용', file: 'lib', from: "if (!automation.length) bad.push(", to: 'if (false) bad.push(', expect: '반례14' },
  { id: 'M39 graph 빈 집합 허용', file: 'lib', from: "if (!graph.length) bad.push(", to: 'if (false) bad.push(', expect: '반례14' },
  { id: 'M40 primaryQuery · audienceSituation 검사 제거', file: 'lib', from: "for (const k of ['primaryQuery', 'audienceSituation']) if (!nonEmpty(x[k]))",
    to: "for (const k of ['primaryQuery', 'audienceSituation']) if (false)", expect: '반례14' },
  { id: 'M41 territoryId 검사 제거', file: 'lib', from: 'if (!isStr(x.territoryId) || !TERRITORY_RE.test(x.territoryId)) bad.push(', to: 'if (false) bad.push(', expect: '반례14' },
  { id: 'M42 intent enum 검사 제거', file: 'lib', from: 'if (!allowed.includes(x[k])) bad.push(', to: 'if (false) bad.push(', expect: '반례14' },
  { id: 'M43 runtimeState enum 검사 제거', file: 'lib', from: 'if (!RUNTIME_STATES.includes(x.runtimeState)) bad.push(', to: 'if (false) bad.push(', expect: '반례14' },
  { id: 'M44 설명 필드 검사 제거', file: 'lib', from: "for (const k of ['policyScopeWhy', 'verdictWhy', 'existingAssetRelation']) if (!isStr(x[k]))",
    to: "for (const k of ['policyScopeWhy', 'verdictWhy', 'existingAssetRelation']) if (false)", expect: '반례14' },
  { id: 'M45 evidence · profileSpec 검사 제거', file: 'lib', from: "for (const k of ['profileSpec', 'evidence']) if (!isPlain(x[k]))",
    to: "for (const k of ['profileSpec', 'evidence']) if (false)", expect: '반례14' },
  { id: 'M46 intent 게시판 검사 제거', file: 'lib', from: 'if (!BOARDS.includes(x.communityDestination)) bad.push(', to: 'if (false) bad.push(', expect: '반례14' },
  { id: 'M47 intent 게시판 계약을 / 시작이면 허용으로 완화', file: 'lib', from: 'if (!BOARDS.includes(x.communityDestination)) bad.push(',
    to: "if (!String(x.communityDestination).startsWith('/')) bad.push(", expect: '반례14' },
  { id: 'M48 reciprocalPolicy 검사 제거', file: 'lib', from: 'if (!RECIPROCAL_POLICIES.includes(e.reciprocalPolicy)) bad.push(', to: 'if (false) bad.push(', expect: '반례14' },
  { id: 'M49 priority 를 유한수면 허용', file: 'lib', from: 'if (!EDGE_PRIORITIES.includes(e.priority)) bad.push(',
    to: "if (typeof e.priority !== 'number' || !Number.isFinite(e.priority)) bad.push(", expect: '반례14' },
  { id: 'M50 산출 계약 호출 제거', file: 'lib', from: '  validateBuiltArtifacts(layers)\n', to: '', expect: '반례14' },
  { id: 'M51 runtimeState ACTIVE · FALLBACK 거부(과잉 축소)', file: 'lib', from: "RUNTIME_STATES = Object.freeze(['UNPUBLISHED', 'ACTIVE', 'FALLBACK', 'QUARANTINED'])",
    to: "RUNTIME_STATES = Object.freeze(['UNPUBLISHED', 'QUARANTINED'])", expect: '반례15' },
  { id: 'M52 evidence.refs 형식 검사 제거', file: 'lib', from: "if (isPlain(x.evidence) && (typeof x.evidence.refs !== 'number' || !Number.isFinite(x.evidence.refs))) bad.push(",
    to: 'if (false) bad.push(', expect: '반례15b' },
  { id: 'M53 COMMUNITY 도착 게시판 검사 제거', file: 'lib', from: "if (e.relationType === 'COMMUNITY') { if (!BOARDS.includes(e.toIntentId)) bad.push(",
    to: "if (e.relationType === 'COMMUNITY') { if (false) bad.push(", expect: '반례15b' },
  { id: 'M54 backlinkPlan.activateWhen 검사 제거', file: 'lib', from: 'else if (!nonEmpty(p.activateWhen)) bad.push(', to: 'else if (false) bad.push(', expect: '반례15b' },
  { id: 'M55 mapping coverage 검사 제거', file: 'lib', from: 'if (!MAPPING_COVERAGES.includes(m.coverage)) bad.push(', to: 'if (false) bad.push(', expect: '반례15b' },
  { id: 'M56 mapping assetState 검사 제거', file: 'lib', from: 'if (!ASSET_STATES.includes(m.assetState)) bad.push(', to: 'if (false) bad.push(', expect: '반례15c' },
  { id: 'M57 priority 4 허용', file: 'lib', from: 'EDGE_PRIORITIES = Object.freeze([1, 2, 3])', to: 'EDGE_PRIORITIES = Object.freeze([1, 2, 3, 4])', expect: '반례15b' },
  { id: 'M58 mapping intentId 신원 검사 제거', file: 'lib', from: 'if (!intentIds.has(m.intentId)) bad.push(', to: 'if (false) bad.push(', expect: '반례15c' },
  { id: 'M59 edge layers boolean 검사 제거', file: 'lib', from: "if (!isPlain(e.layers) || !['DESIGN', 'AUTOMATION_READY', 'RUNTIME_ACTIVE'].every((k) => typeof e.layers[k] === 'boolean')) bad.push(",
    to: 'if (false) bad.push(', expect: '반례15c' },
  { id: 'M60 mapping publishedAt 형식 검사 제거', file: 'lib', from: 'if (m.publishedAt !== null && !isRealDate(m.publishedAt)) bad.push(',
    to: 'if (false) bad.push(', expect: '반례15b' },
  { id: 'M61 파생 슬롯 정합 검사 제거', file: 'lib', from: '&& e.recommendationSlot !== RELATION_TO_SLOT[e.relationType]) bad.push(', to: '&& false) bad.push(', expect: '반례15c' },
  { id: 'M62 publishedAt 날짜 의미 검증 제거(모양만)', file: 'lib', from: 'if (m.publishedAt !== null && !isRealDate(m.publishedAt))',
    to: 'if (m.publishedAt !== null && !(isStr(m.publishedAt) && DATE_RE.test(m.publishedAt)))', expect: '반례16' },
  { id: 'M63 publishAt 날짜·시분초 검증 제거(모양만)', file: 'lib', from: 'if (m.publishAt !== null && !isRealKstAt(m.publishAt))',
    to: 'if (m.publishAt !== null && !(isStr(m.publishAt) && KST_AT_RE.test(m.publishAt)))', expect: '반례16' },
  { id: 'M64 산출 intent 중복 검증 제거', file: 'lib', from: "label: '산출 intent', keyOf: (x) => x.intentId, valid: nonEmpty, unique: true",
    to: "label: '산출 intent', keyOf: (x) => x.intentId, valid: nonEmpty, unique: false", expect: '반례16b' },
  { id: 'M65 산출 edge 형식 검증 제거', file: 'lib', from: "label: '산출 edge', keyOf: (e) => e.edgeId, valid: isEdgeId,",
    to: "label: '산출 edge', keyOf: (e) => e.edgeId, valid: () => true,", expect: '반례16b' },
  { id: 'M66 산출 edge 중복 검증 제거', file: 'lib', from: "label: '산출 edge', keyOf: (e) => e.edgeId, valid: isEdgeId, unique: true",
    to: "label: '산출 edge', keyOf: (e) => e.edgeId, valid: isEdgeId, unique: false", expect: '반례16b' },
  { id: 'M67 산출 mapping 신원 중복 검증 제거', file: 'lib', from: "label: '산출 mapping', keyOf: mappingKey, valid: nonEmpty, unique: true",
    to: "label: '산출 mapping', keyOf: mappingKey, valid: nonEmpty, unique: false", expect: '반례16b' },
  { id: 'M68 공용 시각 왕복 대조를 항상 참으로', file: 'lib', from: "return new Date(ms + offsetMin * 60e3).toISOString().slice(0, 19) === text.slice(0, 19)",
    to: 'return true', expect: '반례11' },
]

const TMP = mkdtempSync(join(tmpdir(), 'mgraph-build-mutation-'))
const text = { lib: readFileSync(SRC.lib, 'utf8'), cli: readFileSync(SRC.cli, 'utf8') }
/** 상대 import 를 원래 위치의 절대 경로로 — 사본이 임시 폴더에서도 같은 모듈을 읽게 한다 */
const absolutize = (src, from) => src.replace(/from '\.\/([^']+)'/g, (_, rel) => `from '${join(dirname(from), rel)}'`)

function runWith(libText, cliText, tag) {
  const libPath = join(TMP, `${tag}-lib.mjs`), cliPath = join(TMP, `${tag}-cli.mjs`)
  writeFileSync(libPath, absolutize(libText, SRC.lib))
  // CLI 는 lib 를 './lib/magazine-graph-build.mjs' 로 읽는다 — 변이 lib 사본으로 돌린다
  writeFileSync(cliPath, absolutize(cliText, SRC.cli).replace(join(dirname(SRC.cli), 'lib/magazine-graph-build.mjs'), libPath))
  const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env: { ...process.env, MGRAPH_BUILD_LIB: libPath, MGRAPH_BUILD_CLI: cliPath } })
  const m = /RESULT pass=(\d+) fail=(\d+)/.exec(r.stdout ?? '')
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', pass: m ? +m[1] : null, fail: m ? +m[2] : null, load: /LOAD_ERROR/.test(r.stdout ?? '') }
}

const lines = []
let harnessFail = 0, detected = 0
const base = runWith(text.lib, text.cli, 'base')
if (base.status !== 0 || base.fail !== 0 || base.load) {
  lines.push(`❌ 무변이 사본이 통과하지 않는다 — 주입 경로 고장 (status ${base.status} · ${base.out.slice(-300)} ${base.err.slice(-300)})`)
  harnessFail++
} else lines.push(`✅ 무변이 사본 pass=${base.pass} fail=0`)

for (const [i, mu] of MUTATIONS.entries()) {
  const src = text[mu.file]
  const count = src.split(mu.from).length - 1
  if (count !== 1) { lines.push(`❌ ${mu.id} — 변이 지점 ${count}곳 (정확히 1곳이어야 한다)`); harnessFail++; continue }
  const mutated = src.replace(mu.from, mu.to)
  const r = runWith(mu.file === 'lib' ? mutated : text.lib, mu.file === 'cli' ? mutated : text.cli, `m${i + 1}`)
  if (r.load || r.fail === null) { lines.push(`❌ ${mu.id} — 적재 실패·RESULT 없음(검출 아님): ${(r.out + r.err).slice(-240)}`); harnessFail++; continue }
  const failedNames = r.out.split('\n').filter((l) => l.includes('❌'))
  const hit = failedNames.some((l) => l.includes(`${mu.expect} `) || l.includes(`${mu.expect}—`))
  if (r.status === 1 && r.fail > 0 && hit) { detected++; lines.push(`✅ ${mu.id} → ${mu.expect} 실패로 검출 (fail=${r.fail})`) }
  else { lines.push(`❌ ${mu.id} — 기대한 ${mu.expect} 가 실패하지 않았다 (status ${r.status} fail=${r.fail})`); harnessFail++ }
}

rmSync(TMP, { recursive: true, force: true })
process.stdout.write(`M-GRAPH 결정적 build 변이\n${lines.join('\n')}\nMUTATION detected=${detected}/${MUTATIONS.length} harnessFail=${harnessFail}\n`)
process.exit(harnessFail ? 1 : 0)
