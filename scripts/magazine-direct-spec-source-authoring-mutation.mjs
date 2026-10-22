#!/usr/bin/env node
/**
 * ArticlePlan(source/2) 변이 — 핵심 관문을 하나씩 끊으면 `authoringCases` 중 하나가 단언으로 실패해야 한다.
 *
 * 대상 세 겹 — lib(authoring: prepare · approve · materialize) · source(소비 관문 · 큐 복제 계약) · direct(G8 행 모드 판정).
 * 🔴 변이본은 원본 옆 임시 사본이다(상대 import 유지). source · direct 변이는 그 사본을 import 하는 lib · source 사본을 함께 만들고,
 *    반례는 변이된 source · direct 모듈을 주입받는다. CLI 도 변이 lib 을 import 하는 사본을 만든다.
 *    import 뒤 즉시 지우고, 끝에 원본 바이트 불변 · 잔여 0 을 확인한다.
 * 🔴 변이 지점이 대상 파일에 **정확히 1곳**이 아니거나(0곳·여러 곳) 변이본이 적재되지 않으면 검출이 아니라 하네스 결함(FAIL)이다.
 */
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  authoringCases, CLI_PATH, DIRECT_PATH, extractLinkBlock, LIB_PATH, linkCases, ROOT, SOURCE_CHECK_PATH, SOURCE_PATH,
} from './magazine-direct-spec-source-authoring-check.mjs'

const ORIGINAL = { lib: readFileSync(LIB_PATH, 'utf8'), cli: readFileSync(CLI_PATH, 'utf8'), sourceCheck: readFileSync(SOURCE_CHECK_PATH, 'utf8'),
  source: readFileSync(SOURCE_PATH, 'utf8'), direct: readFileSync(DIRECT_PATH, 'utf8') }
const CREATED = []
process.on('exit', () => { for (const f of CREATED) { try { unlinkSync(f) } catch { /* 이미 지웠다 */ } } })

/** 🔴 큐 복제 필드 변이 — QUEUE_REPLICA_FIELDS 리터럴에서 필드 하나씩 뺀다(필드마다 변이 1개) */
const REPLICA_BLOCK = (() => {
  const start = ORIGINAL.source.indexOf('export const QUEUE_REPLICA_FIELDS = Object.freeze([')
  const end = ORIGINAL.source.indexOf('])', start)
  return start === -1 || end === -1 ? null : ORIGINAL.source.slice(start, end + 2)
})()
const REPLICA_FIELDS = REPLICA_BLOCK ? [...REPLICA_BLOCK.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]) : []
const REPLICA_MUTATIONS = REPLICA_FIELDS.map((f) => [`MSQ-${f}`, `SOURCE_QUEUE_DRIFT 대조에서 ${f} 를 뺀다`, REPLICA_BLOCK,
  REPLICA_BLOCK.replace(new RegExp(`'${f}',\\s*`), ''), 'source'])

const MUTATIONS = [
  // ── A. admission-only prepare ──
  ['MA1', 'prepare 가 APPROVED 후보를 낸다', "    schema: CANDIDATE_SCHEMA,\n    status: CANDIDATE_STATUS,", "    schema: CANDIDATE_SCHEMA,\n    status: 'APPROVED',"],
  ['MQ1', 'prepare 에 큐 행 요구를 되살린다 (v1)', '  if (reject.length) {\n    const ordered = ADMISSION_REJECT_ORDER', "  if (!queue.some((q) => q.slug === slug)) reject.push('QUEUE_ROW_ABSENT')\n  if (reject.length) {\n    const ordered = ADMISSION_REJECT_ORDER"],
  ['MR-A', 'receipt 없음 검사 제거', "  if (!hits.length) reject.push('RECEIPT_ABSENT')", "  if (false) reject.push('RECEIPT_ABSENT')"],
  ['MR-B', '같은 slug receipt 중복 검사 제거', "  else if (hits.length > 1) reject.push('RECEIPT_DUPLICATE')", "  else if (false) reject.push('RECEIPT_DUPLICATE')"],
  ['MR-C', 'receipt 자기 불변식 검사 제거', "  if (hit && receiptProblems(hit.file, hit.text).length) reject.push('RECEIPT_INVALID')", "  if (false) reject.push('RECEIPT_INVALID')"],
  ['MB-A', 'slug binding 검사 제거', "    if (slugs[a.intentId] !== slug || owners.length !== 1) reject.push('SLUG_BINDING_MISMATCH')", "    if (false) reject.push('SLUG_BINDING_MISMATCH')"],
  ['ML-A', 'ledger 사건 검사 제거', "    if (!event || crossed.length || event.schemaVersion !== G8_LEDGER_SCHEMA || !nonEmpty(event.at) || !sameRelations) reject.push('LEDGER_MISMATCH')", "    if (false) reject.push('LEDGER_MISMATCH')"],
  ['ML-B', 'ledger 관계 4필드 대조 제거', ' || !sameRelations) reject.push', ') reject.push'],
  ['MG1', 'G8 verifyAdmissions 결과 무시', "  if (!verify.ok) reject.push('G8_INCONSISTENT')\n", ''],
  ['MJ1', '남은 journal 검사 제거', "  if (existsSync(join(admissionRoot, JOURNAL_FILE))) reject.push('ADMISSION_IN_PROGRESS')\n", ''],
  ['MJ2', '남은 admission lock 검사 제거', "  if (existsSync(join(admissionRoot, LOCK_FILE))) reject.push('ADMISSION_LOCKED')\n", ''],
  ['ME1', 'receipt edge ↔ 제품 bundle 대조 제거', "{ reject.push('RECEIPT_EDGE_DRIFT'); break }", '{ break }'],
  ['ME2', 'receipt 판 ≠ current 검사 제거', "    if (receiptGv !== productGraph.pointer) reject.push('ADMISSION_GRAPH_STALE')\n", ''],
  ['ME3', 'receipt cluster ↔ 제품 intent cluster 대조 제거', "    if (!graphIntent || graphIntent.cluster !== a.cluster) reject.push('ADMISSION_CLUSTER_DRIFT')\n", ''],
  ['MAR', '등록된 slug 검사 제거', "    if (articles.some((x) => x.slug === slug)) reject.push('SLUG_ALREADY_REGISTERED')\n", ''],
  ['MAQ', '판독 단계의 이미 큐에 있음 검사 제거', "    if (queue.some((q) => q.slug === slug || (intentId && q.intentId === intentId))) reject.push('ALREADY_QUEUED')\n", ''],
  ['MAP', '판독 단계의 이미 계획됨 검사 제거', "    if (phase === 'plan' && plannedEntries(repoRoot, productGraph.pointer, { slug, intentId }).entries.length) reject.push('ALREADY_PLANNED')\n", ''],
  ['MRE1', '후보가 receipt 관계를 3개로 자른다', '    relations: { direct: (a.direct ?? []).map(asRelation),', '    relations: { direct: (a.direct ?? []).slice(0, 3).map(asRelation),'],
  ['MA4', '연구 intent hash ↔ 제품 graph 대조 제거', '  if (recomputed !== graph.contentHash?.intents) {', '  if (false) {'],
  ['MA2', 'graphVersion(pointer≠bundle) 검사 제거 (공용 판독)', "  if (graph.graphVersion !== pointer) blockers.push('GRAPH_VERSION_MISMATCH')\n", '', 'source'],
  ['MA3', 'EXPORT_HASH 재계산 대조 제거 (공용 판독)', "  if (!exportHash || exportHash !== recomputedExportHash) blockers.push('GRAPH_EXPORT_HASH_MISMATCH')\n", '', 'source'],
  ['MA24', 'prepare 가 사람 필드를 지어낸다 (ctaLabel)', 'safetyConstraints: null, hubPath: null, ctaLabel: null,', "safetyConstraints: null, hubPath: null, ctaLabel: '우리 이야기를 나눠요',"],
  // ── 관계 판정 ──
  ['MA8', '제품 graph 관계 증명 제거 (증명 없는 관계를 통과)', '      const proof = evidence.find((e) => e.slug === r.slug && e.slot === r.relationType && e.reason === r.reason)', '      const proof = evidence.find((e) => e.slug === r.slug && e.slot === r.relationType && e.reason === r.reason) ?? { surfaceOk: true, typeOk: true }'],
  ['MA9', '미래 공개 관계 글 허용', "    else if (t.state === 'FUTURE') problems.push('RELATION_TARGET_NOT_YET_PUBLIC')\n", ''],
  ['MA10', '자기 자신·중복 관계 허용', "  if (slugsOf.includes(slug)) problems.push('RELATION_SELF')\n  if (new Set(slugsOf).size !== slugsOf.length) problems.push('RELATION_DUPLICATE')\n", ''],
  ['MA11', '관계 수량(direct 2~3 · discovery 1) 검사 제거', "  if (!direct || !isValidDirectCount(direct.length)) problems.push('RELATIONS_DIRECT_COUNT_INVALID')\n  if (!isSingleDiscovery(discovery)) problems.push('RELATIONS_DISCOVERY_NOT_1')\n", ''],
  ['MA28', 'judge 가 exact-3 계약을 되살린다', "  if (!direct || !isValidDirectCount(direct.length)) problems.push(", "  if (!direct || direct.length !== 3) problems.push("],
  ['MA31', 'judge 가 discovery 단일 객체 검사를 버린다(배열 2개 허용)', "  if (!isSingleDiscovery(discovery)) problems.push('RELATIONS_DISCOVERY_NOT_1')", "  if (!discovery) problems.push('RELATIONS_DISCOVERY_NOT_1')"],
  ['MC4', 'source cluster enabled 검사 제거', "  if (!control.enabledClusters.includes(sourceCluster)) blockers.push('GRAPH_CLUSTER_DISABLED')\n", ''],
  ['MC5', '관계 surface 검사 제거 (BODY_CALLOUT 허용)', '      const surfaceOk = surfaces.includes(e.placement)', '      const surfaceOk = true'],
  ['MC6', '관계 type 검사 제거', "      const typeOk = relationTypes.includes(e.type) && (e.slot !== DISCOVERY_SLOT || e.type === DISCOVERY_TYPE)", '      const typeOk = true'],
  ['MC7', 'activation 근거를 무조건 ACTIVE 로 기록', "      const activation = e.active === true ? 'ACTIVE' : 'PREACTIVATION'", "      const activation = 'ACTIVE'"],
  ['MC1', 'control 판 일치 검사 제거 (공용 판독)', "  if (control.graphVersion !== pointer) blockers.push('GRAPH_CONTROL_VERSION_MISMATCH')\n", '', 'source'],
  ['MC2', 'graph enabled 검사 제거 (공용 판독)', "  if (!control.enabled) blockers.push('GRAPH_CONTROL_DISABLED')\n", '', 'source'],
  ['MC3', 'kill switch 검사 제거 (공용 판독)', "  if (control.killSwitch?.tripped !== false) blockers.push('GRAPH_KILL_SWITCH_TRIPPED')\n", '', 'source'],
  // ── B·C. plan · 승인 ──
  ['MPL1', '승인의 plan 검증 제거', "  if (plan.length) return fail('PLAN_INVALID', `plan 이 승인 계약을", "  if (false) return fail('PLAN_INVALID', `plan 이 승인 계약을"],
  ['MPL2', 'plan union 검사 완화 (임의 문자열 허용)', '    if (unions[k] && !unions[k].includes(v)) out.push(`PLAN_VALUE_NOT_IN_UNION:${k}`)', '    if (false) out.push(`PLAN_VALUE_NOT_IN_UNION:${k}`)'],
  ['MPL3', 'plan 필수 null 허용', "    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) { out.push(`PLAN_REQUIRED_MISSING:${k}`); continue }", "    if (v === null || v === undefined) continue"],
  ['MPL4', 'plan 제목 계약 제거', "  if (nonEmpty(plan.title)) for (const p of titleProblems(plan.title)) out.push(`PLAN_TITLE_INVALID:${p.split(' ')[0]}`)\n", ''],
  ['MPL5', 'plan 선택 필드 검사 제거 (series 짝)', "  if (given('seriesId') !== given('seriesOrder')) out.push('PLAN_SERIES_INCOMPLETE')\n", ''],
  ['MPL6', 'plan 모르는 키 허용', '  for (const k of Object.keys(plan)) if (![...ARTICLE_PLAN_REQUIRED, ...ARTICLE_PLAN_OPTIONAL].includes(k)) out.push(`PLAN_UNKNOWN_FIELD:${k}`)\n', ''],
  ['MA12', '승인 시 미해결 필드 검사 제거', '  if (unresolved.length) return fail(', '  if (false) return fail('],
  ['MA13', '기계 승인자 허용', '  if (MACHINE_APPROVER.test(approver.trim())) return fail(', '  if (false) return fail('],
  ['MA14', '후보 해시 확인 제거', '  if (confirmCandidateHash !== computed) return fail(', '  if (false) return fail('],
  ['MA15', '판 변경(STATE_CHANGED) 검사 제거', '  if (canonicalJson(state.identity) !== canonicalJson(candidate.identity)) {', '  if (false) {'],
  ['MA21', '후보의 승인 필드 위조 검사 제거', '  if (forged.length || candidate.entry?.node?.status !== CANDIDATE_STATUS) return fail(', '  if (false) return fail('],
  ['MA22', '승인의 실제 관문 재확인 제거', "  if (!gateCheck.ok) return fail('GATE_REJECTED'", "  if (false) return fail('GATE_REJECTED'"],
  ['MA23', '기계 고정 신원 필드(admission · 관계) 편집 검사 제거', '  if (drifted.length) return fail(', '  if (false) return fail('],
  ['MA17', 'lock 안 이미 계획됨 재확인 제거 (경쟁 승인을 덮는다)', "    if (doc.entries.some((x) => x?.node?.slug === e.node.slug || x?.node?.intentId === e.node.intentId)) {\n      return fail('ALREADY_PLANNED'", "    if (false) {\n      return fail('ALREADY_PLANNED'"],
  ['MA18', '단일 writer 잠금 제거', '  const lock = acquireLock(`${file}.lock`)', '  const lock = { ok: true, owns: () => true, release: () => {} }'],
  ['MA19', '원자 쓰기 제거 — 대상 파일에 바로 쓴다', "    const fd = openSync(tmp, 'w')", "    const fd = openSync(file, 'w')"],
  ['MB1', '승인 entry 에 productBasis 를 싣지 않는다', '    productBasis: state.productBasis,\n', ''],
  ['MT1', 'prepare 의 asOf≤now 제거', "  if (atMs > nowMs) return { ok: false, code: 'AS_OF_FUTURE'", "  if (false) return { ok: false, code: 'AS_OF_FUTURE'"],
  ['MT2', 'approve 의 at≤now 제거 (미래 시각으로 미래 공개 관계 승인)', "  if (atMs > nowMs) return fail('APPROVED_AT_FUTURE'", "  if (false) return fail('APPROVED_AT_FUTURE'"],
  ['MT3', 'approve 의 at≥asOf 제거', '  if (asOfMs === null || atMs < asOfMs) return fail(', '  if (false) return fail('],
  ['MT4', '실제 날짜 검사 제거 (2026-02-30 허용)', "  return back === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` ? ms : null", '  return ms'],
  ['MW1', 'artifact CAS 재확인 제거', '      if (now.exists !== before.exists || now.hash !== before.hash) {', '      if (false) {'],
  ['MK1', '읽을 수 없는 최근 잠금을 죽은 잠금으로 회수', '          if (age < UNREADABLE_LOCK_GRACE_MS) return { ok: false', '          if (false) return { ok: false'],
  ['MK2', '쓰기 직전 잠금 소유권 재확인 제거', '      if (!lock.owns()) {', '      if (false) {'],
  ['MR1', '연구 intents 원문 해시 재계산 대조 제거', '  if (manifest?.contentHash?.intents !== recomputed) {', '  if (false) {'],
  ['MR2', '연구 intent schema 검사 제거', "  if (rows.some((r) => r?.schemaVersion !== RESEARCH_INTENT_SCHEMA || !nonEmpty(r?.intentId))) throw", '  if (false) throw'],
  ['MR3', '연구 intentId 중복 검사 제거', "  if (new Set(ids).size !== ids.length) throw", '  if (false) throw'],
  // ── 출력 경로 신원 ──
  ['MP1', 'repo 와 out-root 같은 루트 검사 제거', '  if (canon.repoRoot !== canon.outRoot) return fail(', '  if (false) return fail('],
  ['MP2', 'symlink 조상 검사 제거', "    if (real !== resolve(p)) return fail('OUT_ROOT_SYMLINK'", "    if (false) return fail('OUT_ROOT_SYMLINK'"],
  ['MP3', '승인 대상 폴더 symlink 검사 제거', [
    ['  const below = checkNoSymlinkBelow(roots.root, file)\n  if (!below.ok) return below\n', '  const below = checkNoSymlinkBelow(roots.root, file)\n'],
    ["  if (realpathSync(dirname(file)) !== dirname(file)) return fail('OUT_PATH_SYMLINK', '대상 폴더가 symlink 를 지난다')\n", ''],
  ]],
  ['MP4', 'runtime canonical 경로 거부 제거', "    if (RUNTIME_PATH_PATTERNS.some((re) => re.test(real))) return fail('RUNTIME_OUTPUT_FORBIDDEN'", "    if (false) return fail('RUNTIME_OUTPUT_FORBIDDEN'"],
  ['MP5', '작업 트리(.git) 검사 제거', "  if (!existsSync(join(canon.repoRoot, '.git'))) return fail(", '  if (false) return fail('],
  ['MP6', 'materialize 의 큐 symlink 검사 제거', '  const below = checkNoSymlinkBelow(roots.root, queuePath)\n  if (!below.ok) return below\n', '  const below = checkNoSymlinkBelow(roots.root, queuePath)\n'],
  // ── D. materialize ──
  ['MM1', 'materialize 가 plan 밖의 값(receipt 질문)을 제목으로 쓴다', '    const row = queueRowFromEntry(entry, { day })', '    const row = { ...queueRowFromEntry(entry, { day }), title: state.admission.primaryQuery }'],
  ['MM2', 'day 를 max(day)+1 이 아니라 행 수로 정한다', '    const day = Math.max(0, ...queue.map((q) => q.day).filter(Number.isInteger)) + 1', '    const day = queue.length + 1'],
  ['MM3', '쓴 뒤 다시 읽기 대조 제거', "    if (!exactlyAdded(readFileSync(queuePath, 'utf8'))) {", '    if (false) {'],
  ['MM4', '쓰기 전 렌더 검증 제거', "    if (!exactlyAdded(next)) return fail('QUEUE_RENDER_INVALID'", "    if (false) return fail('QUEUE_RENDER_INVALID'"],
  ['MM5', '큐 CAS 재확인 제거 (외부 writer 를 덮는다)', "    if (readFileSync(queuePath, 'utf8') !== before) return fail('QUEUE_CHANGED'", "    if (false) return fail('QUEUE_CHANGED'"],
  ['MM6', '큐 writer lock 없이 쓴다', [
    ['  const locked = withQueueWriteLock(queuePath, () => {', '  const locked = ((fn) => ({ ok: true, value: fn() }))(() => {'],
    ['  }, { env })\n  if (!locked.ok) return locked', '  })\n  if (!locked.ok) return locked'],
  ]],
  ['MM7', 'materialize 의 사람 승인 검사 제거', "  if (entry.status !== 'APPROVED' || entry.node?.status !== 'APPROVED' || !nonEmpty(entry.approvedBy) || MACHINE_APPROVER.test(String(entry.approvedBy).trim())) {", '  if (false) {'],
  ['MM8', 'materialize 의 sourceHash 검사 제거', "  if (entry.sourceHash !== directSpecSourceHash(entry)) return fail('PLAN_HASH_DRIFT'", "  if (false) return fail('PLAN_HASH_DRIFT'"],
  ['MM9', 'materialize 의 admission 재대조 제거', "  if (canonicalJson(entry.admission) !== canonicalJson(state.admissionBlock)) return fail('ADMISSION_DRIFT'", "  if (false) return fail('ADMISSION_DRIFT'"],
  ['MM10', 'materialize 의 관계 재대조 제거', "  if (canonicalJson(entry.relations) !== canonicalJson(state.relations)) return fail('RELATIONS_DRIFT'", "  if (false) return fail('RELATIONS_DRIFT'"],
  ['MM11', 'materialize 의 plan 재검증 제거', "  if (plan.length) return fail('PLAN_INVALID', `승인 plan 이", "  if (false) return fail('PLAN_INVALID', `승인 plan 이"],
  ['MM12', 'materialize 의 실제 관문 사전검사 제거', "  if (!pre.ok) return fail('GATE_REJECTED'", "  if (false) return fail('GATE_REJECTED'"],
  ['MM13', 'lock 안 이미 큐에 있음 재확인 제거 (경쟁 writer 를 덮는다)', "    if (queue.some((q) => q.slug === slug || q.intentId === entry.node.intentId)) return fail('ALREADY_QUEUED'", "    if (false) return fail('ALREADY_QUEUED'"],
  // ── E. 소비 관문 (source) ──
  ...REPLICA_MUTATIONS,
  ['MSH', 'articlePlanHash 대조 제거', "  if (queueItem?.articlePlanHash !== entry.sourceHash) blockers.push('ARTICLE_PLAN_HASH_DRIFT')\n", '', 'source'],
  ['MSM', 'g8ManifestHash ↔ 승인 admission 대조 제거', "  if (entry.admission?.g8ManifestHash !== queueItem?.g8ManifestHash) blockers.push('MANIFEST_DRIFT')\n", '', 'source'],
  ['MSG', 'ArticleSpec 직전 G8_ROW_NOT_DIRECT 제거', '  if (g8RowProblem(queueItem)) blockers.push(G8_ROW_NOT_DIRECT)\n', '', 'source'],
  ['MSL1', 'internalLinks 를 3개로 자른다', '    internalLinks: internalLinksOf(entry?.relations),', '    internalLinks: internalLinksOf(entry?.relations).slice(0, 3),', 'source'],
  ['MSL2', 'internalLinks 순서를 뒤집는다 (discovery 먼저)', '  for (const r of [...(Array.isArray(relations?.direct) ? relations.direct : []), ...discovery]) {', '  for (const r of [...discovery, ...(Array.isArray(relations?.direct) ? relations.direct : [])]) {', 'source'],
  ['MSL3', 'internalLinks 중복 제거를 뺀다', "    if (typeof r?.slug === 'string' && !out.includes(r.slug)) out.push(r.slug)", "    if (typeof r?.slug === 'string') out.push(r.slug)", 'source'],
  // ── E. G8 행 모드 (direct) ──
  ['MD1', 'resolveMagazineAutoMode 의 G8_ROW_NOT_DIRECT 제거', '  if (g8) return { ok: false, mode: null, code: G8_ROW_NOT_DIRECT, why: g8 }\n', '', 'direct'],
  ['MD2', 'G8_ROW_NOT_DIRECT 를 intentId 기준으로 넓힌다 (legacy 행까지 막는다)', '  if (!g8 && !plan) return null', "  if (!g8 && !plan && !has('intentId')) return null", 'direct'],
  ['MD3', '해시 하나만 있어도 허용', '  if (!g8 || !plan) return `G8 행에', '  if (!g8 && !plan) return `G8 행에', 'direct'],
  ['MD4', 'DIRECT 가 아닌 G8 행 허용', '  if (queueItem[DIRECT_SPEC_OPT_IN_FIELD] !== DIRECT_SPEC_MODE) {\n    return `G8 행의', '  if (false) {\n    return `G8 행의', 'direct'],
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
const occurrences = (text, s) => (s ? text.split(s).length - 1 : 0)

if (!REPLICA_BLOCK || REPLICA_FIELDS.length !== 20) report(false, 'MSQ QUEUE_REPLICA_FIELDS 블록', `변이 지점을 읽지 못했다 (필드 ${REPLICA_FIELDS.length}개) — 하네스 결함`)

for (const [id, label, from, to, target = 'lib'] of MUTATIONS) {
  const pairs = Array.isArray(from) ? from : [[from, to]]
  const base = ORIGINAL[target]
  const counts = pairs.map(([a]) => occurrences(base, a))
  if (counts.some((n) => n !== 1)) { report(false, `${id} ${label}`, `변이 지점이 정확히 1곳이 아니다 (${counts.join('/')}곳) — 하네스 결함`); continue }
  const mutated = pairs.reduce((src, [a, b]) => src.replace(a, b), base)
  if (mutated === base) { report(false, `${id} ${label}`, '변이가 바이트를 바꾸지 않았다 — 하네스 결함'); continue }
  const tag = `.dssa-${id}-${process.pid}-`
  const libPath = join(dirname(LIB_PATH), `${tag}${basename(LIB_PATH)}`)
  const cliPath = join(dirname(CLI_PATH), `${tag}${basename(CLI_PATH)}`)
  const srcPath = join(dirname(SOURCE_PATH), `${tag}${basename(SOURCE_PATH)}`)
  const dirPath = join(dirname(DIRECT_PATH), `${tag}${basename(DIRECT_PATH)}`)
  CREATED.push(libPath, cliPath, srcPath, dirPath)
  // 🔴 변이가 닿은 모듈부터 위로 import 를 사본으로 돌린다 — direct → source → lib → CLI
  let sourceText = ORIGINAL.source
  let libText = ORIGINAL.lib
  if (target === 'direct') {
    writeFileSync(dirPath, mutated)
    sourceText = ORIGINAL.source.replace("from './magazine-direct-spec.mjs'", `from './${basename(dirPath)}'`)
  } else if (target === 'source') sourceText = mutated
  else libText = mutated
  if (target !== 'lib') {
    writeFileSync(srcPath, sourceText)
    libText = libText.replace("from './magazine-direct-spec-source.mjs'", `from './${basename(srcPath)}'`)
  }
  writeFileSync(libPath, libText)
  writeFileSync(cliPath, ORIGINAL.cli.replace("'./lib/magazine-direct-spec-source-authoring.mjs'", `'./lib/${basename(libPath)}'`))
  let caught = false
  let why = ''
  try {
    const mod = await import(pathToFileURL(libPath).href)
    const deps = { cliPath }
    if (target !== 'lib') deps.source = await import(pathToFileURL(srcPath).href)
    if (target === 'direct') deps.direct = await import(pathToFileURL(dirPath).href)
    const failures = []
    for (const [name, fn] of authoringCases(mod, deps)) {
      try { await fn() } catch (e) { failures.push(`${name} — ${e.message.split('\n')[0]}`) }
    }
    caught = failures.length > 0
    why = failures[0] ?? '모든 반례가 통과했다'
  } catch (e) {
    caught = false
    why = `변이 적재 실패 — 하네스 결함이지 검출이 아니다: ${e.message.split('\n')[0]}`
  } finally {
    for (const f of CREATED.filter((x) => x.includes(tag))) { try { unlinkSync(f) } catch { /* 이미 지웠다 */ } }
  }
  report(caught, `${id} ${label} → 잡혔다`, why.slice(0, 160))
}

{
  const block = extractLinkBlock(ORIGINAL.sourceCheck)
  for (const [id, label, from, to] of LINK_MUTATIONS) {
    if (occurrences(block, from) !== 1) { report(false, `${id} ${label}`, '변이 지점이 정확히 1곳이 아니다 (하네스 결함)'); continue }
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
    && readFileSync(DIRECT_PATH, 'utf8') === ORIGINAL.direct
  const residue = ['scripts', 'scripts/lib'].flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.startsWith('.dssa-')))
  report(unchanged && residue.length === 0, '변이 뒤 원본 바이트 불변 · 임시 사본 잔여 0', residue.join(', '))
}

console.log(`\nDIRECT_SPEC source 작성 변이: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
