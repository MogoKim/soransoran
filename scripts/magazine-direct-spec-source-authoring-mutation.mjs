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

import { authoringCases, CLI_PATH, LIB_PATH, ROOT } from './magazine-direct-spec-source-authoring-check.mjs'

const ORIGINAL = { lib: readFileSync(LIB_PATH, 'utf8'), cli: readFileSync(CLI_PATH, 'utf8') }
const CREATED = []
process.on('exit', () => { for (const f of CREATED) { try { unlinkSync(f) } catch { /* 이미 지웠다 */ } } })

const MUTATIONS = [
  ['MA1', 'prepare 가 APPROVED 후보를 낸다', "    schema: CANDIDATE_SCHEMA,\n    status: CANDIDATE_STATUS,", "    schema: CANDIDATE_SCHEMA,\n    status: 'APPROVED',"],
  ['MA2', 'graphVersion(pointer≠bundle) 검사 제거', "  if (graph.graphVersion !== pointer) blockers.push('GRAPH_VERSION_MISMATCH')\n", ''],
  ['MA3', 'EXPORT_HASH 재계산 대조 제거', "  if (!declared || declared !== recomputed) blockers.push('GRAPH_EXPORT_HASH_MISMATCH')\n", ''],
  ['MA4', '연구 intent hash 대조 제거', '  if (intentsHash !== graph.contentHash?.intents) {', '  if (false) {'],
  ['MA5', 'G8 ADMITTED 사건 검사 제거', "  if (exact.length !== 1) blockers.push(exact.length ? 'ADMISSION_DUPLICATE' : 'ADMISSION_ABSENT')\n", ''],
  ['MA6', 'slug 표 결속 검사 제거', "  if (intentId && slugs[intentId] !== slug) blockers.push('SLUG_UNBOUND')\n", ''],
  ['MA7', 'STANDARD 검사 제거', "  if (!lane.ok || lane.profile !== 'STANDARD') blockers.push('PROFILE_NOT_STANDARD')\n", ''],
  ['MA8', '제품 graph 관계 증명 제거', "      if (!proof) problems.push('RELATION_NOT_IN_PRODUCT_GRAPH')\n", ''],
  ['MA9', '미래 공개 관계 글 허용', "    else if (t.state === 'FUTURE') problems.push('RELATION_TARGET_NOT_YET_PUBLIC')\n", ''],
  ['MA10', '자기 자신·중복 관계 허용', "  if (slugsOf.includes(slug)) problems.push('RELATION_SELF')\n  if (new Set(slugsOf).size !== slugsOf.length) problems.push('RELATION_DUPLICATE')\n", ''],
  ['MA11', '관계 3+1 개수 검사 제거', "  if (!direct || direct.length !== 3) problems.push('RELATIONS_DIRECT_NOT_3')\n  if (!discovery || typeof discovery !== 'object') problems.push('RELATIONS_DISCOVERY_NOT_1')\n", ''],
  ['MA12', '승인 시 미해결 필드 검사 제거', '  if (unresolved.length) return fail(', '  if (false) return fail('],
  ['MA13', '기계 승인자 검사 제거', '  if (MACHINE_APPROVER.test(approver.trim())) return fail(', '  if (false) return fail('],
  ['MA14', '후보 해시 확인 제거', '  if (confirmCandidateHash !== computed) return fail(', '  if (false) return fail('],
  ['MA15', '판 변경(STATE_CHANGED) 검사 제거', '  if (canonicalJson(state.identity) !== canonicalJson(candidate.identity)) {', '  if (false) {'],
  ['MA16', 'runtime 출력 거부 제거', '  if (isRuntimePath(outRoot) || isRuntimePath(repoRoot)) return fail(', '  if (false) return fail('],
  ['MA17', '같은 entry 대조(멱등·충돌) 제거', '    if (same) {', '    if (false) {'],
  ['MA18', '단일 writer 잠금 제거', '  const lock = acquireLock(`${file}.lock`)', '  const lock = { ok: true, release: () => {} }'],
  ['MA19', '원자 쓰기 제거 — 대상 파일에 바로 쓴다', "    const fd = openSync(tmp, 'w')", "    const fd = openSync(file, 'w')"],
  ['MA20', '관계가 모자라도 후보에 채운다(숫자 맞추기)', '  if (eligibleDirect.length === 3) {', '  if (eligibleDirect.length >= 1) {'],
  ['MA21', '후보의 승인 필드 위조 검사 제거', '  if (forged.length || candidate.entry?.node?.status !== CANDIDATE_STATUS) return fail(', '  if (false) return fail('],
  ['MA22', '실제 source 관문 재확인 제거', '  if (!gateCheck.ok) return fail(', '  if (false) return fail('],
  ['MA23', '기계 고정 신원 필드 편집 검사 제거', '  if (drifted.length) return fail(', '  if (false) return fail('],
  ['MA24', 'prepare 가 사람 필드를 지어낸다 (ctaLabel)', 'safetyConstraints: null, hubPath: null, ctaLabel: null,', "safetyConstraints: null, hubPath: null, ctaLabel: '우리 이야기를 나눠요',"],
  ['MA25', 'G8 큐 행 manifest 검사 제거', "  if (!row || !nonEmpty(row.intentId) || !nonEmpty(row.g8ManifestHash)) blockers.push('QUEUE_NOT_G8_ADMITTED')\n", ''],
]

let pass = 0
let fail = 0
const report = (ok, name, detail = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

for (const [id, label, from, to] of MUTATIONS) {
  if (!ORIGINAL.lib.includes(from)) { report(false, `${id} ${label}`, '변이 지점을 찾지 못했다 (하네스 결함)'); continue }
  const libPath = join(dirname(LIB_PATH), `.dssa-${id}-${process.pid}-${basename(LIB_PATH)}`)
  const cliPath = join(dirname(CLI_PATH), `.dssa-${id}-${process.pid}-${basename(CLI_PATH)}`)
  CREATED.push(libPath, cliPath)
  writeFileSync(libPath, ORIGINAL.lib.replace(from, to))
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
    for (const f of [libPath, cliPath]) { try { unlinkSync(f) } catch { /* 이미 지웠다 */ } }
  }
  report(caught, `${id} ${label} → 잡혔다`, why.slice(0, 160))
}

{
  const unchanged = readFileSync(LIB_PATH, 'utf8') === ORIGINAL.lib && readFileSync(CLI_PATH, 'utf8') === ORIGINAL.cli
  const residue = ['scripts', 'scripts/lib'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.startsWith('.dssa-')))
  report(unchanged && residue.length === 0, '변이 뒤 원본 바이트 불변 · 임시 사본 잔여 0', residue.join(', '))
}

console.log(`\nDIRECT_SPEC source 작성 변이: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
