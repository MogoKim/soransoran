#!/usr/bin/env node
/**
 * DIRECT_SPEC source 작성 변이 — 핵심 관문을 하나씩 끊으면 `authoringCases` 중 하나가 단언으로 실패해야 한다.
 *
 * 🔴 변이본은 원본 옆 임시 사본이다(상대 import 유지). CLI 도 변이 lib 을 import 하는 사본을 만든다.
 *    import 뒤 즉시 지우고, 끝에 원본 바이트 불변 · 잔여 0 을 확인한다.
 * 🔴 변이 지점을 못 찾거나 변이본이 적재되지 않으면 **검출이 아니라 하네스 결함(FAIL)** 이다.
 */
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  authoringCases, CLI_PATH, extractLinkBlock, LIB_PATH, linkCases, ROOT, SOURCE_CHECK_PATH,
} from './magazine-direct-spec-source-authoring-check.mjs'

const SOURCE_PATH = join(dirname(LIB_PATH), 'magazine-direct-spec-source.mjs')
const ORIGINAL = { lib: readFileSync(LIB_PATH, 'utf8'), cli: readFileSync(CLI_PATH, 'utf8'), sourceCheck: readFileSync(SOURCE_CHECK_PATH, 'utf8'),
  source: readFileSync(SOURCE_PATH, 'utf8') }
const CREATED = []
process.on('exit', () => { for (const f of CREATED) { try { unlinkSync(f) } catch { /* 이미 지웠다 */ } } })

const MUTATIONS = [
  ['MA1', 'prepare 가 APPROVED 후보를 낸다', "    schema: CANDIDATE_SCHEMA,\n    status: CANDIDATE_STATUS,", "    schema: CANDIDATE_SCHEMA,\n    status: 'APPROVED',"],
  ['MA2', 'graphVersion(pointer≠bundle) 검사 제거 (공용 판독)', "  if (graph.graphVersion !== pointer) blockers.push('GRAPH_VERSION_MISMATCH')\n", '', 'source'],
  ['MA3', 'EXPORT_HASH 재계산 대조 제거 (공용 판독)', "  if (!exportHash || exportHash !== recomputedExportHash) blockers.push('GRAPH_EXPORT_HASH_MISMATCH')\n", '', 'source'],
  ['MA4', '연구 intent hash ↔ 제품 graph 대조 제거', '  if (recomputed !== graph.contentHash?.intents) {', '  if (false) {'],
  ['MA5', 'G8 ADMITTED 사건 검사 제거', "  if (exact.length !== 1) blockers.push(exact.length ? 'ADMISSION_DUPLICATE' : 'ADMISSION_ABSENT')\n", ''],
  ['MA6', 'slug 표 결속 검사 제거', "  if (intentId && slugs[intentId] !== slug) blockers.push('SLUG_UNBOUND')\n", ''],
  ['MA7', 'STANDARD 검사 제거', "  if (!lane.ok || lane.profile !== 'STANDARD') blockers.push('PROFILE_NOT_STANDARD')\n", ''],
  ['MA8', '제품 graph 관계 증명 제거 (증명 없는 관계를 통과)', '      const proof = evidence.find((e) => e.slug === r.slug && e.slot === r.relationType && e.reason === r.reason)', '      const proof = evidence.find((e) => e.slug === r.slug && e.slot === r.relationType && e.reason === r.reason) ?? { surfaceOk: true, typeOk: true }'],
  ['MA9', '미래 공개 관계 글 허용', "    else if (t.state === 'FUTURE') problems.push('RELATION_TARGET_NOT_YET_PUBLIC')\n", ''],
  ['MA10', '자기 자신·중복 관계 허용', "  if (slugsOf.includes(slug)) problems.push('RELATION_SELF')\n  if (new Set(slugsOf).size !== slugsOf.length) problems.push('RELATION_DUPLICATE')\n", ''],
  ['MA11', '관계 수량(direct 2~3 · discovery 1) 검사 제거', "  if (!direct || !isValidDirectCount(direct.length)) problems.push('RELATIONS_DIRECT_COUNT_INVALID')\n  if (!isSingleDiscovery(discovery)) problems.push('RELATIONS_DISCOVERY_NOT_1')\n", ''],
  ['MA12', '승인 시 미해결 필드 검사 제거', '  if (unresolved.length) return fail(', '  if (false) return fail('],
  ['MA13', '기계 승인자 검사 제거', '  if (MACHINE_APPROVER.test(approver.trim())) return fail(', '  if (false) return fail('],
  ['MA14', '후보 해시 확인 제거', '  if (confirmCandidateHash !== computed) return fail(', '  if (false) return fail('],
  ['MA15', '판 변경(STATE_CHANGED) 검사 제거', '  if (canonicalJson(state.identity) !== canonicalJson(candidate.identity)) {', '  if (false) {'],
  ['MA17', '같은 entry 대조(멱등·충돌) 제거', '    if (same) {', '    if (false) {'],
  ['MA18', '단일 writer 잠금 제거', '  const lock = acquireLock(`${file}.lock`)', '  const lock = { ok: true, release: () => {} }'],
  ['MA19', '원자 쓰기 제거 — 대상 파일에 바로 쓴다', "    const fd = openSync(tmp, 'w')", "    const fd = openSync(file, 'w')"],
  ['MA20', '관계가 모자라도 후보에 채운다(숫자 맞추기)', '  if (isValidDirectCount(eligibleDirect.length)) {', '  if (eligibleDirect.length >= 1) {'],
  ['MA28', 'judge 가 exact-3 계약을 되살린다', "  if (!direct || !isValidDirectCount(direct.length)) problems.push(", "  if (!direct || direct.length !== 3) problems.push("],
  ['MA29', 'prepare 가 exact-3 계약을 되살린다', '  if (isValidDirectCount(eligibleDirect.length)) {', '  if (eligibleDirect.length === 3) {'],
  ['MA30', '증명된 direct 4개 이상을 자동으로 3개로 자른다', [
    ['  if (isValidDirectCount(eligibleDirect.length)) {', '  if (eligibleDirect.length >= RELATION_POLICY.directMin) {'],
    ['    direct = eligibleDirect.map(asRelation)', '    direct = eligibleDirect.slice(0, RELATION_POLICY.directMax).map(asRelation)'],
  ]],
  ['MA31', 'judge 가 discovery 단일 객체 검사를 버린다(배열 2개 허용)', "  if (!isSingleDiscovery(discovery)) problems.push('RELATIONS_DISCOVERY_NOT_1')", "  if (!discovery) problems.push('RELATIONS_DISCOVERY_NOT_1')"],
  ['MA21', '후보의 승인 필드 위조 검사 제거', '  if (forged.length || candidate.entry?.node?.status !== CANDIDATE_STATUS) return fail(', '  if (false) return fail('],
  ['MA22', '실제 source 관문 재확인 제거', '  if (!gateCheck.ok) return fail(', '  if (false) return fail('],
  ['MA23', '기계 고정 신원 필드 편집 검사 제거', '  if (drifted.length) return fail(', '  if (false) return fail('],
  ['MA24', 'prepare 가 사람 필드를 지어낸다 (ctaLabel)', 'safetyConstraints: null, hubPath: null, ctaLabel: null,', "safetyConstraints: null, hubPath: null, ctaLabel: '우리 이야기를 나눠요',"],
  ['MA25', 'G8 큐 행 manifest 검사 제거', "  if (!row || !nonEmpty(row.intentId) || !nonEmpty(row.g8ManifestHash)) blockers.push('QUEUE_NOT_G8_ADMITTED')\n", ''],
  // ── 시각
  ['MT1', 'prepare 의 asOf≤now 제거', "  if (atMs > nowMs) return { ok: false, code: 'AS_OF_FUTURE'", "  if (false) return { ok: false, code: 'AS_OF_FUTURE'"],
  ['MT2', 'approve 의 at≤now 제거 (미래 시각으로 미래 공개 관계 승인)', "  if (atMs > nowMs) return fail('APPROVED_AT_FUTURE'", "  if (false) return fail('APPROVED_AT_FUTURE'"],
  ['MT3', 'approve 의 at≥asOf 제거', '  if (asOfMs === null || atMs < asOfMs) return fail(', '  if (false) return fail('],
  ['MT4', '실제 날짜 검사 제거 (2026-02-30 허용)', "  return back === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` ? ms : null", '  return ms'],
  // ── CAS
  ['MW1', 'artifact CAS 재확인 제거', '      if (now.exists !== before.exists || now.hash !== before.hash) {', '      if (false) {'],
  // ── 출력 경로 신원
  ['MP1', 'repo 와 out-root 같은 루트 검사 제거', '  if (canon.repoRoot !== canon.outRoot) return fail(', '  if (false) return fail('],
  ['MP2', 'symlink 조상 검사 제거', "    if (real !== resolve(p)) return fail('OUT_ROOT_SYMLINK'", "    if (false) return fail('OUT_ROOT_SYMLINK'"],
  ['MP3', '대상 폴더 symlink 검사 제거', [
    ['  if (!below.ok) return below\n', ''],
    ["  if (realpathSync(dirname(file)) !== dirname(file)) return fail('OUT_PATH_SYMLINK', '대상 폴더가 symlink 를 지난다')\n", ''],
  ]],
  ['MP4', 'runtime canonical 경로 거부 제거', "    if (RUNTIME_PATH_PATTERNS.some((re) => re.test(real))) return fail('RUNTIME_OUTPUT_FORBIDDEN'", "    if (false) return fail('RUNTIME_OUTPUT_FORBIDDEN'"],
  ['MP5', '작업 트리(.git) 검사 제거', "  if (!existsSync(join(canon.repoRoot, '.git'))) return fail(", '  if (false) return fail('],
  // ── M-GRAPH control · surface
  ['MC1', 'control 판 일치 검사 제거 (공용 판독)', "  if (control.graphVersion !== pointer) blockers.push('GRAPH_CONTROL_VERSION_MISMATCH')\n", '', 'source'],
  ['MC2', 'graph enabled 검사 제거 (공용 판독)', "  if (!control.enabled) blockers.push('GRAPH_CONTROL_DISABLED')\n", '', 'source'],
  ['MC3', 'kill switch 검사 제거 (공용 판독)', "  if (control.killSwitch?.tripped !== false) blockers.push('GRAPH_KILL_SWITCH_TRIPPED')\n", '', 'source'],
  ['MC4', 'source cluster enabled 검사 제거', "  if (!sourceCluster || !control.enabledClusters.includes(sourceCluster)) blockers.push('GRAPH_CLUSTER_DISABLED')\n", ''],
  ['MC5', '관계 surface 검사 제거 (BODY_CALLOUT 허용)', '      const surfaceOk = surfaces.includes(e.placement)', '      const surfaceOk = true'],
  ['MC6', '관계 type 검사 제거', "      const typeOk = relationTypes.includes(e.type) && (e.slot !== DISCOVERY_SLOT || e.type === DISCOVERY_TYPE)", '      const typeOk = true'],
  ['MC7', 'activation 근거를 무조건 ACTIVE 로 기록', "      const activation = e.active === true ? 'ACTIVE' : 'PREACTIVATION'", "      const activation = 'ACTIVE'"],
  // ── 연구 정본
  ['MR1', '연구 intents 원문 해시 재계산 대조 제거', '  if (manifest?.contentHash?.intents !== recomputed) {', '  if (false) {'],
  ['MR2', '연구 intent schema 검사 제거', "  if (rows.some((r) => r?.schemaVersion !== RESEARCH_INTENT_SCHEMA || !nonEmpty(r?.intentId))) throw", '  if (false) throw'],
  ['MR3', '연구 intentId 중복 검사 제거', "  if (new Set(ids).size !== ids.length) throw", '  if (false) throw'],
  // ── G8 정본
  ['MG1', 'G8 verifyConsistency 결과 무시', "  if (!consistency.ok) blockers.push('G8_INCONSISTENT')\n", ''],
  ['MG2', 'G8 사건 schema 검사 제거', "  if (exact.some((e) => e.schemaVersion !== G8_LEDGER_SCHEMA || !nonEmpty(e.at) || !nonEmpty(e.title) || !nonEmpty(e.cluster))) blockers.push('ADMISSION_SCHEMA_INVALID')\n", ''],
  ['MG3', 'G8 교차 신원 검사 제거', "  if (crossed.length) blockers.push('ADMISSION_IDENTITY_CROSSED')\n", ''],
  // ── hero
  // ── 승인 basis · 잠금
  ['MB1', '승인 entry 에 productBasis 를 싣지 않는다', '    productBasis: state.productBasis,\n', ''],
  ['MK1', '읽을 수 없는 최근 잠금을 죽은 잠금으로 회수', '          if (age < UNREADABLE_LOCK_GRACE_MS) return { ok: false', '          if (false) return { ok: false'],
  ['MK2', '쓰기 직전 잠금 소유권 재확인 제거', '      if (!lock.owns()) {', '      if (false) {'],
]
/** source-check 의 부속 검사 연결 블록 변이 — 실패를 무시하면 linkCases 가 잡아야 한다 */
const LINK_MUTATIONS = [
  ['ML1', 'source-check 가 부속 검사 실패를 무시한다', '    else fail++\n', ''],
  ['ML3', 'source-check 가 부속 검사 성공을 pass 에 세지 않는다', '    if (ok) pass++\n    else fail++', '    if (!ok) fail++'],
  ['ML2', 'source-check 가 통과 표식 없이 종료 코드만 본다', '    const ok = r.status === 0 && marker.test(r.stdout)', '    const ok = r.status === 0'],
]

let pass = 0
let fail = 0
const report = (ok, name, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

for (const [id, label, from, to, target = 'lib'] of MUTATIONS) {
  const pairs = Array.isArray(from) ? from : [[from, to]]
  const base = target === 'source' ? ORIGINAL.source : ORIGINAL.lib
  if (!pairs.every(([a]) => base.includes(a))) { report(false, `${id} ${label}`, '변이 지점을 찾지 못했다 (하네스 결함)'); continue }
  const libPath = join(dirname(LIB_PATH), `.dssa-${id}-${process.pid}-${basename(LIB_PATH)}`)
  const cliPath = join(dirname(CLI_PATH), `.dssa-${id}-${process.pid}-${basename(CLI_PATH)}`)
  CREATED.push(libPath, cliPath)
  if (target === 'source') {
    // 🔴 공용 판독(source 모듈) 변이 — authoring lib 사본이 변이 source 를 import 한다
    const srcPath = join(dirname(SOURCE_PATH), `.dssa-${id}-${process.pid}-${basename(SOURCE_PATH)}`)
    CREATED.push(srcPath)
    writeFileSync(srcPath, pairs.reduce((src, [a, b]) => src.replace(a, b), ORIGINAL.source))
    writeFileSync(libPath, ORIGINAL.lib.replace("from './magazine-direct-spec-source.mjs'", `from './${basename(srcPath)}'`))
  } else writeFileSync(libPath, pairs.reduce((src, [a, b]) => src.replace(a, b), ORIGINAL.lib))
  writeFileSync(cliPath, ORIGINAL.cli.replace("'./lib/magazine-direct-spec-source-authoring.mjs'", `'./lib/${basename(libPath)}'`))
  let caught = false
  let why = ''
  try {
    const mod = await import(pathToFileURL(libPath).href)
    const failures = []
    for (const [name, fn] of authoringCases(mod, { cliPath })) {
      try { await fn() } catch (e) { failures.push(`${name} — ${e.message.split('\n')[0]}`) }
    }
    caught = failures.length > 0
    why = failures[0] ?? '모든 반례가 통과했다'
  } catch (e) {
    caught = false
    why = `변이 적재 실패 — 하네스 결함이지 검출이 아니다: ${e.message.split('\n')[0]}`
  } finally {
    for (const f of CREATED.filter((x) => x.includes(`.dssa-${id}-`))) { try { unlinkSync(f) } catch { /* 이미 지웠다 */ } }
  }
  report(caught, `${id} ${label} → 잡혔다`, why.slice(0, 160))
}

{
  const block = extractLinkBlock(ORIGINAL.sourceCheck)
  for (const [id, label, from, to] of LINK_MUTATIONS) {
    if (!block.includes(from)) { report(false, `${id} ${label}`, '변이 지점을 찾지 못했다 (하네스 결함)'); continue }
    let caught = false
    let why = ''
    try {
      const failures = []
      for (const [name, fn] of linkCases(block.replace(from, to))) {
        try { await fn() } catch (e) { failures.push(`${name} — ${e.message.split('\n')[0]}`) }
      }
      caught = failures.length > 0
      why = failures[0] ?? '모든 반례가 통과했다'
    } catch (e) { caught = false; why = `변이 실행 실패 — 하네스 결함이지 검출이 아니다: ${e.message.split('\n')[0]}` }
    report(caught, `${id} ${label} → 잡혔다`, why.slice(0, 160))
  }
}

{
  const unchanged = readFileSync(LIB_PATH, 'utf8') === ORIGINAL.lib && readFileSync(CLI_PATH, 'utf8') === ORIGINAL.cli
    && readFileSync(SOURCE_CHECK_PATH, 'utf8') === ORIGINAL.sourceCheck && readFileSync(SOURCE_PATH, 'utf8') === ORIGINAL.source
  const residue = ['scripts', 'scripts/lib'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.startsWith('.dssa-')))
  report(unchanged && residue.length === 0, '변이 뒤 원본 바이트 불변 · 임시 사본 잔여 0', residue.join(', '))
}

console.log(`\nDIRECT_SPEC source 작성 변이: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
