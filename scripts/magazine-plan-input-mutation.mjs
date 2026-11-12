#!/usr/bin/env node
/**
 * Magazine vNext S2 — ContentPlanInputBundle 조립 · 판독 · bootstrap 변이. 방어를 하나씩 되돌리면 `magazine-plan-input-check` 가
 * 기대한 항목으로 실패해야 한다.
 *
 *   node scripts/magazine-plan-input-mutation.mjs
 *
 * 🔴 저장소 파일을 고치지 않는다. 시작할 때 한 번 읽은 스냅샷(scripts/lib/*.mjs · 검사 · bootstrap CLI · 합성 fixture)을
 *    임시 폴더에 쓰고, 사본 하나에 변이 하나를 심어 그 사본의 검사를 돌린다.
 * 🔴 무변이 사본이 먼저 0 fail 이어야 한다. 변이 지점이 정확히 1곳이 아니면 하네스 FAIL(검출로 세지 않는다).
 * 🔴 검출 = exit 1 + 기대 항목 줄 `FAIL <id> `. 요약 줄 없이 죽은 사본은 검출이 아니다.
 * 마지막 줄: `plan-input 변이: <검출>/<변이 수> detected · <n> fail`
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const LIB = 'scripts/lib/magazine-content-plan-input.mjs'
const CLI = 'scripts/magazine-plan-input-bootstrap.mjs'
const CHECK = 'scripts/magazine-plan-input-check.mjs'

/** [id, 설명, 기대 항목, 편집[]] — 편집은 { file, from, to } (from 정확히 1곳) */
const MUTATIONS = [
  ['IM1', '참조 증거 파일이 없어도 관계를 싣는다', 'PI7', [{ file: LIB, from: "    if (docs.some((d) => d.text === null || d.text === undefined)) { skip('EVIDENCE_REF_MISSING'); continue }\n", to: '' }]],
  ['IM2', '증거 파일 schema 를 보지 않는다(변조 통과)', 'PI7', [{ file: LIB, from: "    if (!docs.every((d) => acceptEvidenceDoc(d.text))) { skip('EVIDENCE_SCHEMA_REJECTED'); continue }\n", to: '' }]],
  ['IM3', 'canonical basis 가 비어도 싣는다', 'PI7', [{ file: LIB, from: "    if (!nonEmpty(g.basis)) { skip('CANONICAL_BASIS_MISSING'); continue }\n", to: '' }]],
  ['IM4', 'current edge 와 canonical edge 관계 필드를 맞추지 않는다', 'PI7', [{ file: LIB, from: "    if (!RELATION_FIELDS.every((k) => g[k] === e[k])) { skip('CANONICAL_FIELD_MISMATCH'); continue }\n", to: '' }]],
  ['IM5', 'snapshot 입력 해시를 대조하지 않는다', 'PI4', [{ file: LIB, from: '  for (const name of want) if (sha256Hex(snapshot.texts[name]) !== inputHashes[name])', to: '  for (const name of []) if (sha256Hex(snapshot.texts[name]) !== inputHashes[name])' }]],
  ['IM6', 'control 판 불일치를 보지 않는다', 'PI4', [{ file: LIB, from: "  if (product.controlGraphVersion !== graphVersion) fail('CONTROL_GRAPH_VERSION_DRIFT',", to: "  if (false) fail('CONTROL_GRAPH_VERSION_DRIFT'," }]],
  ['IM7', '제품 graph 판 바이트를 대조하지 않는다', 'PI4', [{ file: LIB, from: "  if (product.graphFileText !== files[bundleName]) fail('PRODUCT_GRAPH_DRIFT',", to: "  if (false) fail('PRODUCT_GRAPH_DRIFT'," }]],
  ['IM8', 'intent 비공개 필드(verdictWhy)를 투영한다', 'PI3', [
    { file: LIB, from: "const INTENT_KEYS = ['answerScope', 'audienceSituation',", to: "const INTENT_KEYS = ['verdictWhy', 'answerScope', 'audienceSituation'," },
    { file: LIB, from: "      communityDestination: strOrNull(x.communityDestination, 'communityDestination'),\n    }\n", to: "      communityDestination: strOrNull(x.communityDestination, 'communityDestination'),\n      verdictWhy: strOrNull(x.verdictWhy, 'verdictWhy'),\n    }\n" }]],
  ['IM9', '판독이 모르는 키를 받아들인다(빠진 키만 본다)', 'PI3', [{ file: LIB, from: '  if (canonicalJson(got) !== canonicalJson(want)) {', to: '  if (want.some((k) => !got.includes(k))) {' }]],
  ['IM10', '같은 판 Bundle 이 있어도 다시 계산한다(정확히 1회 깨짐)', 'PI5', [{ file: CLI, from: "    if (present(outAbs)) stop('BUNDLE_ALREADY_EXISTS',", to: "    if (false) stop('BUNDLE_ALREADY_EXISTS'," }]],
  ['IM11', 'bootstrap 허용 판을 보지 않는다', 'PI6', [{ file: CLI, from: "    if (graphVersion !== BOOTSTRAP_GRAPH_VERSION) stop('BOOTSTRAP_VERSION_NOT_ALLOWED',", to: "    if (false) stop('BOOTSTRAP_VERSION_NOT_ALLOWED'," }]],
  ['IM12', 'Bundle 자기 해시를 대조하지 않는다', 'PI7', [{ file: LIB, from: "  if (!isStr(b.bundleHash) || b.bundleHash !== bundleHashOf(b)) fail('BUNDLE_HASH_MISMATCH',", to: "  if (!isStr(b.bundleHash)) fail('BUNDLE_HASH_MISMATCH'," }]],
  ['IM13', 'canonical JSON 이 키를 정렬하지 않는다', 'PI2', [{ file: LIB, from: '    const keys = Object.keys(value).sort(byCodeUnit)\n', to: '    const keys = Object.keys(value)\n' }]],
  ['IM14', 'intent 행을 정렬하지 않는다(입력 순서 의존)', 'PI2', [{ file: LIB, from: '  intents.sort((a, b) => byCodeUnit(a.intentId, b.intentId))\n', to: '' }]],
  ['IM15', '구조화 evidence 객체 없음을 따로 거르지 않는다', 'PI1', [{ file: LIB, from: "    if (!isPlain(g.evidence)) { skip('EVIDENCE_ABSENT'); continue }\n", to: '' }]],
  ['IM16', '증거 참조 0 인 근거를 싣는다(AUTOMATION_READY 만 믿음)', 'PI7', [{ file: LIB, from: "    if (!refs.length) { skip('EVIDENCE_REF_ABSENT'); continue }\n", to: '' }]],
  ['IM17', 'snapshot 파일 집합을 보지 않는다', 'PI4', [{ file: LIB, from: "  if (canonicalJson(got) !== canon) fail('SNAPSHOT_INPUT_SET',", to: "  if (false) fail('SNAPSHOT_INPUT_SET'," }]],
  ['IM18', '연구 control.json 판을 보지 않는다', 'PI4', [{ file: LIB, from: "  if (!isPlain(researchControl) || researchControl.graphVersion !== graphVersion) fail('RESEARCH_CONTROL_DRIFT',", to: "  if (false) fail('RESEARCH_CONTROL_DRIFT'," }]],
  ['IM19', 'CLI 가 모르는 인자를 받는다', 'PI6', [{ file: CLI, from: '    if (!KNOWN.has(a)) usage(`모르는 인자 ${a}`)\n', to: "    if (!KNOWN.has(a)) { i++; continue }\n" }]],
  // ── S2 P1 (2026-11-10) ──
  ['IM20', 'bundleHash 가 provenance 를 다시 포함한다(export 시점 control 이 planHash 로 샌다 · P1-A)', 'PI10', [{ file: LIB,
    from: "export const BUNDLE_CONTENT_KEYS = Object.freeze(['schemaVersion', 'graphVersion', 'intents', 'relations', 'mappings'])",
    to: "export const BUNDLE_CONTENT_KEYS = Object.freeze(['schemaVersion', 'graphVersion', 'intents', 'relations', 'mappings', 'provenance'])" }]],
  ['IM21', 'recordHash 를 검증하지 않는다(P1-A)', 'PI10', [{ file: LIB, from: "  if (!isStr(b.recordHash) || b.recordHash !== recordHashOf(b)) fail('RECORD_HASH_MISMATCH',", to: "  if (!isStr(b.recordHash)) fail('RECORD_HASH_MISMATCH'," }]],
  ['IM22', '저장 Bundle 의 inputHashes 를 개수만 본다(대체 이름 통과 · P1-D)', 'PI11', [{ file: LIB, from: "  exactKeys(R.inputHashes, SNAPSHOT_NAMES_SORTED, 'provenance.research.inputHashes')", to: "  need(isPlain(R.inputHashes) && Object.keys(R.inputHashes).length === 5, 'provenance.research.inputHashes')" }]],
  // 앞판 그대로 되돌린다 — 개수 5 + manifest ↔ snapshot 집합 일치만(이름이 canonical 인지 보지 않는다). 두 줄을 함께 되돌려야 앞판이다
  ['IM23', '조립이 manifest · snapshot 이름을 개수 · 서로 일치만 본다(대체 이름 통과 · P1-D)', 'PI11', [
    { file: LIB, from: "  if (canonicalJson(want) !== canon) fail('SNAPSHOT_INPUT_SET',", to: "  if (want.length !== 5 || canonicalJson(want) !== canonicalJson(got)) fail('SNAPSHOT_INPUT_SET'," },
    { file: LIB, from: "  if (canonicalJson(got) !== canon) fail('SNAPSHOT_INPUT_SET',", to: "  if (false) fail('SNAPSHOT_INPUT_SET'," }]],
  ['IM24', 'relation.evidence 의 모르는 키를 받는다(P1-D)', 'PI11', [{ file: LIB, from: "    exactKeys(r.evidence, ['basisSha256', 'objectSha256', 'refs'], `relation ${r.edgeId} evidence`)", to: "    need(isPlain(r.evidence), `relation ${r.edgeId} evidence`)" }]],
  ['IM25', '출력 경로 symlink 를 보지 않는다(루트 밖 쓰기 · P1-F)', 'PI12', [
    { file: CLI, from: "    if (st.isSymbolicLink()) stop('OUTPUT_PATH_SYMLINK', `출력 경로 구성 요소가 symlink 다: ${parts", to: "    if (false) stop('OUTPUT_PATH_SYMLINK', `출력 경로 구성 요소가 symlink 다: ${parts" }]],
  ['IM26', '운영 API 가 모르는 옵션(판 손잡이)을 받는다(P1-F)', 'PI6', [{ file: CLI, from: "    if (extra.length) stop('BOOTSTRAP_OPTION_UNKNOWN',", to: "    if (false) stop('BOOTSTRAP_OPTION_UNKNOWN'," }]],
  ['IM27', '최종 이름의 symlink 를 없는 것으로 본다(existsSync · P1-F)', 'PI12', [{ file: CLI, from: '    if (present(outAbs)) stop(', to: '    if (existsSync(outAbs)) stop(' }]],
  ['IM28', '제3자 제목 조각 대조를 끈다(P1-E)', 'PI13', [{ file: LIB, from: '    for (const s of segments) if (flat.includes(s)) return true\n', to: '' }]],
  ['IM29', '제3자 snippet 연속 원문 대조를 끈다(P1-E)', 'PI13', [{ file: LIB, from: '      if (isStr(o.snippet)) addRuns(normPoints(o.snippet))\n', to: '' }]],
  ['IM30', 'canonical communityTitle 을 corpus 에 넣지 않는다(P1-E)', 'PI13', [{ file: LIB, from: '  communityTitles.forEach(addTitle)\n', to: '' }]],
  ['IM31', 'corpus 가 불완전해도 CLEAR 로 본다(P1-E)', 'PI13', [{ file: LIB, from: '    if (!matcher.complete || !Array.isArray(refs) || refs.length === 0) return', to: '    if (!Array.isArray(refs) || refs.length === 0) return' }]],
  ['IM32', 'CLI 가 canonical g4 의 intent 증거를 읽지 않는다(P1-E)', 'PI13', [{ file: CLI, from: ', ...collectSourceTextRefs(snapshotTexts[INPUT_FILES.canonical])])].sort()', to: '])].sort()' }]],
  ['IM34', '우리 사이트 판별이 호스트 접미사만 본다(soransoran.com.evil 통과 · P1-E)', 'PI13', [{ file: LIB, from: '    return host !== null && R.ownHosts.some((h) => host === h || host.endsWith(`.${h}`))', to: '    return host !== null && R.ownHosts.some((h) => host.includes(h))' }]],
  ['IM35', '한 낱말 제목도 조각 대조한다(용어 오탐 · P1-E)', 'PI13', [{ file: LIB, from: '      if (pts.length >= R.titleSegmentMin && words >= R.titleSegmentMinWords) segments.add(pts.join(\'\'))', to: '      if (pts.length >= R.titleSegmentMin) segments.add(pts.join(\'\'))' }]],
  ['IM36', '우리 사이트 결과도 제3자 corpus 에 넣는다(P1-E)', 'PI13', [{ file: LIB, from: '      if (isOwn(o)) continue\n', to: '' }]],
  // ── S2 P1 재개 (2026-11-11) — crash-safe 쓰기 · mapping 원시 중복 ──
  ['IM37', '실패 정리에서 tmp 를 지우지 않는다(P1-F)', 'PI14', [{ file: CLI, from: '    if (tmpIno !== null) dropOwn(tmpName)\n', to: '' }]],
  ['IM38', 'link 오류를 전부 ALREADY 로 본다(EPERM 둔갑 · P1-F)', 'PI14', [{ file: CLI, from: "      if (e.code === 'EEXIST') stop('BUNDLE_ALREADY_EXISTS',", to: "      if (true) stop('BUNDLE_ALREADY_EXISTS'," }]],
  ['IM39', 'link 뒤 폴더 fsync 를 지운다(P1-F)', 'PI14', [{ file: CLI, from: "    try { fsyncCwd(io) } catch (e) { stop('BUNDLE_WRITE_FAILED', `폴더 fsync 실패 (${e.code ?? e.message})`, e.code) }\n", to: '' }]],
  ['IM40', '새 폴더의 부모를 fsync 하지 않는다(P1-F)', 'PI14', [{ file: CLI, from: '          try { fsyncCwd(io) } catch (e) { stop(\'BUNDLE_WRITE_FAILED\', `새 폴더의', to: '          try { } catch (e) { stop(\'BUNDLE_WRITE_FAILED\', `새 폴더의' }]],
  ['IM41', 'writer 가 잔여 tmp 를 보지 않는다(P1-F)', 'PI14', [{ file: CLI, from: "if (stale.length) stop('STALE_TEMP_PRESENT', `잔여 임시 파일 ${stale.map((n) =>", to: "if (false) stop('STALE_TEMP_PRESENT', `잔여 임시 파일 ${stale.map((n) =>" }]],
  ['IM42', 'runBootstrap 이 잔여 tmp 를 보지 않는다(dry-run 통과 · P1-F)', 'PI14', [{ file: CLI, from: "if (stale.length) stop('STALE_TEMP_PRESENT', `잔여 임시 파일 ${stale.map((x) =>", to: "if (false) stop('STALE_TEMP_PRESENT', `잔여 임시 파일 ${stale.map((x) =>" }]],
  ['IM43', '짧은 쓰기를 반복하지 않는다(한 번만 쓴다 · P1-F)', 'PI14', [{ file: CLI, from: '    for (let off = 0; off < bytes.length;) {', to: '    for (let off = 0; off < 1;) {' }]],
  ['IM44', '되읽기 대조를 지운다(조용한 손상 · P1-F)', 'PI14', [{ file: CLI, from: '    if (got !== bytes.length || !back.subarray(0, got).equals(bytes)) stop(', to: '    if (false) stop(' }]],
  ['IM45', 'link 뒤 경로 사후 확인을 지운다(TOCTOU · P1-F)', 'PI14', [{ file: CLI, from: "    if (raced) stop('OUTPUT_PATH_RACE',", to: "    if (false) stop('OUTPUT_PATH_RACE'," }]],
  ['IM46', '최종 이름 확인의 ENOENT 밖 오류를 없음으로 본다(P1-F)', 'PI14', [{ file: CLI, from: "  const lstatRel = (n) => { try { return io.lstatSync(n) } catch (e) { if (e.code === 'ENOENT') return null; return fsStop(", to: "  const lstatRel = (n) => { try { return io.lstatSync(n) } catch (e) { return null; return fsStop(" }]],
  ['IM47', 'link 뒤 실패에서 우리가 만든 최종 이름을 남긴다(P1-F)', 'PI14', [{ file: CLI, from: '    if (linked) dropOwn(name)\n', to: '' }]],
  ['IM48', 'writer 가 경로 구성 요소 symlink 를 보지 않는다(P1-F · P1-7)', 'PI14', [
    { file: CLI, from: "    if (st.isSymbolicLink()) stop('OUTPUT_PATH_SYMLINK', `출력 경로 구성 요소가 symlink 다: ${label}", to: "    if (false) stop('OUTPUT_PATH_SYMLINK', `출력 경로 구성 요소가 symlink 다: ${label}" }]],
  // ── S2 P1 반대 검토 (2026-11-11) — 경로 고정 · 입력 CAS · 증거 I/O · 구조화 오류 ──
  ['IM50', '진입 뒤 dev·ino 대조를 지운다(확인-진입 사이 바꿔치기 · P1-7)', 'PI14', [{ file: CLI, from: "    if (!same(here, st)) stop('OUTPUT_PATH_RACE'", to: "    if (false) stop('OUTPUT_PATH_RACE'" }]],
  ['IM51', 'tmp 를 고정 폴더 상대가 아니라 절대 경로로 연다(경로 다시 풀기 · P1-7)', 'PI14', [{ file: CLI, from: '    try { fd = io.openSync(tmpName, TMP_FLAGS, 0o644) }', to: '    try { fd = io.openSync(join(rootReal, dirRel, tmpName), TMP_FLAGS, 0o644) }' }]],
  ['IM52', '최종 이름을 절대 경로로 link 한다(경로 다시 풀기 · P1-7)', 'PI14', [{ file: CLI, from: '    try { io.linkSync(tmpName, name) } catch (e) {', to: '    try { io.linkSync(tmpName, join(rootReal, outRel)) } catch (e) {' }]],
  ['IM53', 'publication 직전 입력 CAS 를 지운다(P1-8)', 'PI16', [{ file: CLI, from: '    beforePublish()\n', to: '' }]],
  ['IM54', '입력 CAS 가 제품 파일을 보지 않는다(P1-8)', 'PI16', [{ file: CLI, from: '  for (const [k, v] of Object.entries(inp.product)) id[`product.${k}`] = h(v)\n', to: '' }]],
  ['IM55', '입력 CAS 가 연구 current 링크 대상을 보지 않는다(P1-8)', 'PI16', [{ file: CLI, from: "  id['research.currentDir'] = h(inp.research.currentDir)\n", to: '' }]],
  ['IM56', '증거 lstat 오류를 전부 없음으로 본다(P1-9)', 'PI17', [{ file: CLI, from: "  try { st = lstatSync(abs) } catch (e) { if (e.code === 'ENOENT') return null; return stop(", to: '  try { st = lstatSync(abs) } catch (e) { return null; return stop(' }]],
  ['IM57', '증거 읽기 오류를 없음으로 본다(P1-9)', 'PI17', [{ file: CLI, from: "  } catch (e) { return stop('EVIDENCE_READ_FAILED', `증거 ${ref} 를 읽지 못했다", to: "  } catch (e) { return null; return stop('EVIDENCE_READ_FAILED', `증거 ${ref} 를 읽지 못했다" }]],
  ['IM58', 'runBootstrap 이 파일 시스템 오류를 구조화하지 않는다(P1-9)', 'PI17', [{ file: CLI, from: "    if (typeof e?.code === 'string' && /^E[A-Z0-9]+$/.test(e.code)) return { ok: false, code: 'FILESYSTEM_ERROR'", to: "    if (false) return { ok: false, code: 'FILESYSTEM_ERROR'" }]],
  ['IM59', '구조화 오류가 errno 를 버린다(P1-9)', 'PI17', [{ file: CLI, from: '    if (e instanceof BootstrapStop) return { ok: false, code: e.code, why: e.why, ...(e.errno ? { errno: e.errno } : {}) }', to: '    if (e instanceof BootstrapStop) return { ok: false, code: e.code, why: e.why }' }]],
  ['IM60', '정리가 고정 폴더 상대가 아니라 절대 경로 이름을 지운다(P1-7)', 'PI14', [{ file: CLI, from: '    if (linked) dropOwn(name)\n', to: '    if (linked) dropOwn(join(rootReal, outRel))\n' }]],
  ['IM49', 'mapping 원시 중복을 조용히 줄인다(P1-D)', 'PI15', [{ file: LIB, from: "    if (mapKeys.has(k)) fail('RESEARCH_MAPPING_INVALID', `mapping 원시 중복 ${m.intentId} → ${m.slug}`)", to: '    if (mapKeys.has(k)) continue' }]],
  ['IM33', 'intent 자기 증거가 불량이어도 CLEAR 로 본다(P1-E)', 'PI13', [{ file: LIB, from: '    if (!own.every((p) => isStr(p) && SOURCE_REF_RE.test(p) && acceptEvidenceDoc(evidenceTexts?.[p]))) return', to: '    if (!own.every((p) => isStr(p))) return' }]],
]

const lines = []
let detected = 0, harnessFail = 0
let base = null
try {
  const visible = (d, re) => (existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).filter((f) => !f.startsWith('.') && re.test(f)).map((f) => `${d}/${f}`) : [])
  const snapshot = new Map()
  for (const f of [...visible('scripts/lib', /\.mjs$/), ...visible('scripts/__fixtures__/magazine/content-plan', /./), CHECK, CLI]) {
    snapshot.set(f, readFileSync(join(ROOT, f), 'utf8'))
  }
  base = mkdtempSync(join(tmpdir(), 'plan-input-mutation-'))
  const world = (tag, edits) => {
    const files = new Map(snapshot)
    for (const e of edits) {
      const src = files.get(e.file)
      if (src === undefined) return { error: `${e.file} 가 스냅샷에 없다` }
      const k = src.split(e.from).length - 1
      if (k !== 1) return { error: `${e.file} 변이 지점 ${k}곳` }
      files.set(e.file, src.replace(e.from, () => e.to))
    }
    const dir = join(base, tag)
    for (const [f, t] of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), t) }
    return { dir }
  }
  const run = (dir) => {
    const r = spawnSync(process.execPath, [join(dir, CHECK)], { encoding: 'utf8', cwd: dir, timeout: 300_000 })
    const m = /plan-input 검사: (\d+) pass, (\d+) fail/.exec(r.stdout ?? '')
    return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', fail: m ? +m[2] : null, pass: m ? +m[1] : null }
  }
  const b = world('base', [])
  const rb = b.error ? null : run(b.dir)
  if (!rb || rb.status !== 0 || rb.fail !== 0) { harnessFail++; lines.push(`FAIL 무변이 사본이 통과하지 않는다 — ${b.error ?? `${rb.out}${rb.err}`.slice(-400)}`) }
  else lines.push(`PASS 무변이 사본 ${rb.pass} pass · 0 fail`)
  for (const [id, label, expect, edits] of MUTATIONS) {
    try {
      const w = world(id, edits)
      if (w.error) { harnessFail++; lines.push(`FAIL ${id} ${label} — ${w.error} (하네스 결함)`); continue }
      const r = run(w.dir)
      if (r.fail === null) { harnessFail++; lines.push(`FAIL ${id} ${label} — 요약 줄 없음(검출 아님): ${(r.out + r.err).slice(-200)}`); continue }
      const hit = r.out.split('\n').some((l) => l.startsWith(`FAIL ${expect} `))
      if (r.status === 1 && hit) { detected++; lines.push(`PASS ${id} ${label} → ${expect} 실패로 검출`) }
      else { harnessFail++; lines.push(`FAIL ${id} ${label} — 기대한 ${expect} 가 실패하지 않았다 (status ${r.status} fail=${r.fail})`) }
    } catch (e) {
      harnessFail++; lines.push(`FAIL ${id} ${label} — 하네스 예외(검출 아님): ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`)
    }
  }
} catch (e) {
  harnessFail++; lines.push(`FAIL 하네스 예외로 중단(검출 아님): ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`)
} finally {
  if (base) rmSync(base, { recursive: true, force: true })
}
console.log(lines.join('\n'))
console.log(`\nplan-input 변이: ${detected}/${MUTATIONS.length} detected · ${harnessFail} fail`)
process.exit(harnessFail ? 1 : 0)
