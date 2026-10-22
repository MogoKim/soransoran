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
  { id: 'M4 contentHash 에 generatedAt 섞기', file: 'lib', from: "const combined = sha16(hI + hE + hM + (hP ?? ''))", to: "const combined = sha16(hI + hE + hM + (hP ?? '') + gen)", expect: '반례2' },
  { id: 'M5 bundle 머리말 시각을 벽시계로', file: 'lib', from: '// 생성: ${slim.generatedAt}', to: '// 생성: ${new Date().toISOString()}', expect: '반례3' },
  { id: 'M6 판 전환 파일 가드 제거', file: 'lib', from: "if (seen) fail('OUT_DIR_FORBIDDEN', 'out-dir 에 current.ts",
    to: "if (false) fail('OUT_DIR_FORBIDDEN', 'out-dir 에 current.ts", expect: '반례4b' },
  // 🔴 2026-10-21 — manifest 의 inputHashes 는 computeGraphAndReadiness 의 parts 에서 온다. 같은 manifest 자리를 겨냥한다
  { id: 'M7 manifest 에 입력 절대 경로 기록', file: 'lib', from: "    inputHashes,\n    productHashes: product.hashes,",
    to: "    inputHashes, inputRoot: process.argv[process.argv.indexOf('--input-root') + 1],\n    productHashes: product.hashes,", expect: '반례5' },
  { id: 'M8 생산 최소 direct 2 → 1', file: 'lib', from: 'productionMinimum: Object.freeze({ direct: RELATION_POLICY.directMin,',
    to: 'productionMinimum: Object.freeze({ direct: 1,', expect: '반례6' },
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
  { id: 'M69 lifecycle 정합 관문 전체 제거', file: 'lib', from: "if (m.assetState === 'LIVE' && PRE_PUBLIC_COVERAGES.includes(m.coverage)) bad.push(",
    to: 'if (false) bad.push(', expect: '반례17' },
  { id: 'M70 SCHEDULED_NOT_YET_PUBLIC 거부 제거', file: 'lib', from: "PRE_PUBLIC_COVERAGES = Object.freeze(['SCHEDULED_NOT_YET_PUBLIC', 'QUEUED_NOT_PUBLIC'])",
    to: "PRE_PUBLIC_COVERAGES = Object.freeze(['QUEUED_NOT_PUBLIC'])", expect: '반례17' },
  { id: 'M71 QUEUED_NOT_PUBLIC 거부 제거', file: 'lib', from: "PRE_PUBLIC_COVERAGES = Object.freeze(['SCHEDULED_NOT_YET_PUBLIC', 'QUEUED_NOT_PUBLIC'])",
    to: "PRE_PUBLIC_COVERAGES = Object.freeze(['SCHEDULED_NOT_YET_PUBLIC'])", expect: '반례17' },
  { id: 'M72 산출이 automation legacy 값을 그대로 복사', file: 'lib', from: 'existingAssetRelation: assetSummaryOf(r.intentId),',
    to: 'existingAssetRelation: r.existingAssetRelation,', expect: '반례18' },
  { id: 'M73 요약 helper 무력화(항상 없음)', file: 'lib', from: '  return intentMappings.map((m) =>', to: "  return '없음' || intentMappings.map((m) =>", expect: '반례18' },
  { id: 'M74 LIVE → PUBLISHED 호환 표현 제거', file: 'lib', from: "${m.assetState === 'LIVE' ? 'PUBLISHED' : m.assetState}", to: '${m.assetState}', expect: '반례18' },
  { id: 'M75 요약 = mappings 산출 검증 제거', file: 'lib', from: 'if (isStr(x.existingAssetRelation) && x.existingAssetRelation !== assetSummaryOf(x.intentId)) bad.push(',
    to: 'if (false) bad.push(', expect: '반례18c' },
  { id: 'M76 다중 mapping 순서를 slug 정렬로', file: 'lib', from: 'return (intentId) => summarizeExistingAssets(by.get(intentId) ?? [])',
    to: 'return (intentId) => summarizeExistingAssets([...(by.get(intentId) ?? [])].sort((a, b) => a.slug.localeCompare(b.slug)))', expect: '반례18b' },
  { id: 'M77 automation 값이 있으면 그것을 신뢰', file: 'lib', from: 'existingAssetRelation: assetSummaryOf(r.intentId),',
    to: 'existingAssetRelation: r.existingAssetRelation ?? assetSummaryOf(r.intentId),', expect: '반례18' },
  { id: 'M78 제품 lifecycle 관문 호출 제거', file: 'lib', from: '  assertProductLifecycle({ inputs, articles: product.articles, effectiveMs: eff.ms })\n', to: '', expect: '반례19i' },
  { id: 'M79 published 우선순위 제거(queue 가 published 를 덮는다)', file: 'lib', from: "    resolved.set(p.slug, state ?? 'UNKNOWN') // published 가 queue 를 가린다",
    to: "    if (!resolved.has(p.slug)) resolved.set(p.slug, state ?? 'UNKNOWN')", expect: '반례19b' },
  { id: 'M80 published·queue 교차 중복을 잘못 거부', file: 'lib', from: '    seenPublished.add(p.slug)\n',
    to: "    seenPublished.add(p.slug)\n    if (seenQueue.has(p.slug)) add(p.slug, '교차 중복')\n", expect: '반례19b' },
  { id: 'M81 queue-only 공개 slug 허용', file: 'lib', from: "    if (live && state !== 'LIVE') add(", to: "    if (live && state !== 'LIVE' && state !== 'QUEUE') add(", expect: '반례19' },
  { id: 'M82 effectiveAt 대신 현재 시각', file: 'lib', from: '    const live = Boolean(article) && isPublic(article, effectiveMs)',
    to: '    const live = Boolean(article) && isPublic(article, Date.now())', expect: '반례19h' },
  { id: 'M83 raw status 만 신뢰', file: 'lib', from: '    const live = Boolean(article) && isPublic(article, effectiveMs)',
    to: "    const live = Boolean(article) && article.status === 'PUBLISHED'", expect: '반례19' },
  { id: 'M84 미래 LIVE 허용', file: 'lib', from: "    if (!live && state === 'LIVE') add(", to: '    if (false) add(', expect: '반례19c' },
  { id: 'M85 canonical 공개 slug 누락 허용', file: 'lib', from: '  for (const slug of new Set([...resolved.keys(), ...canonicalSlugs])) {',
    to: '  for (const slug of new Set([...resolved.keys()])) {', expect: '반례19e' },
  { id: 'M86 slug 별 dedupe 제거', file: 'lib', from: '.map(([slug, reasons]) => ({ slug, reasons }))',
    to: '.flatMap(([slug, reasons]) => reasons.map((r) => ({ slug, reasons: [r] })))', expect: '반례19g' },
  { id: 'M87 SCHEDULED 제품 신원 관문 제거', file: 'lib', from: "    if (state === 'SCHEDULED') {", to: '    if (false) {', expect: '반례20' },
  { id: 'M88 SCHEDULED 제품 존재 검사 제거(phantom 허용)', file: 'lib', from: "      if (!article) add(slug, 'snapshot 은 SCHEDULED 인데 제품에 글이 없다')",
    to: "      if (false) add(slug, 'snapshot 은 SCHEDULED 인데 제품에 글이 없다')", expect: '반례20' },
  { id: 'M89 DRAFT 를 예약으로 허용', file: 'lib', from: "UNSCHEDULABLE_STATUSES = Object.freeze(['DRAFT', 'BLOCKED'])", to: "UNSCHEDULABLE_STATUSES = Object.freeze(['BLOCKED'])", expect: '반례20' },
  { id: 'M90 BLOCKED 를 예약으로 허용', file: 'lib', from: "UNSCHEDULABLE_STATUSES = Object.freeze(['DRAFT', 'BLOCKED'])", to: "UNSCHEDULABLE_STATUSES = Object.freeze(['DRAFT'])", expect: '반례20' },
  { id: 'M91 slim export 에서 coverage 제거', file: 'lib', from: 'cluster: x.cluster, coverage: x.coverage })),', to: 'cluster: x.cluster })),', expect: '반례21' },
  { id: 'M92 export coverage 자체 검사 제거', file: 'lib', from: 'if (coverageBad.length) bad.push(', to: 'if (false) bad.push(', expect: '반례21b' },
  // ── graph 참여(EDITORIAL_NON_SEARCH) 선언 ──
  { id: 'M93 editorial 근거 신원·hash 형식 검사 제거', file: 'lib',
    from: '    else if (!evidence.length || !evidence.every((e) => isPlain(e) && nonEmpty(e.ref) && isStr(e.sha256) && SHA256_RE.test(e.sha256))) {',
    to: '    else if (false) {', expect: '반례22c' },
  { id: 'M94 editorial evidenceHash 대조 제거', file: 'lib', from: '    else if (p.evidenceHash !== editorialEvidenceHash(evidence)) bad.push(',
    to: '    else if (false) bad.push(', expect: '반례22c' },
  { id: 'M95 editorial + mapping 충돌 검사 제거', file: 'lib', from: "    if (mappedSlugs.has(p.slug)) bad.push(`${at} EDITORIAL_NON_SEARCH 인데 canonical mapping 이 있다`)",
    to: '', expect: '반례22b' },
  { id: 'M96 editorial reasonCode 계약 제거', file: 'lib', from: 'if (!EDITORIAL_REASON_CODES.includes(p.reasonCode)) bad.push(`${at} reasonCode',
    to: 'if (false) bad.push(`${at} reasonCode', expect: '반례22c' },
  { id: 'M97 participation 을 graphVersion hash 에서 제외', file: 'lib', from: "const combined = sha16(hI + hE + hM + (hP ?? ''))",
    to: 'const combined = sha16(hI + hE + hM)', expect: '반례22' },
  { id: 'M98 slim 이 editorial 판정을 버린다', file: 'lib', from: '  if (participation.length) {\n    // 🔴 판정을 운반하는 bundle 만',
    to: '  if (false) {\n    // 🔴 판정을 운반하는 bundle 만', expect: '반례22' },
  { id: 'M99 export participation 자체 검사 제거', file: 'lib', from: 'if (partBad.length) bad.push(', to: 'if (false) bad.push(', expect: '반례22e' },
  { id: 'M100 graphParticipation 구조 검사 제거', file: 'lib',
    from: "    else if (p.graphParticipation !== undefined && (!isPlain(p.graphParticipation) || !Array.isArray(p.graphParticipation.evidence))) {",
    to: '    else if (false) {', expect: '반례22c' },
  // ── participation 산출 형식 방어 · bundle schema 표식 ──
  { id: 'M101 participation 행 객체 검사 제거(null 역참조)', file: 'lib',
    from: "    if (!isPlain(p)) { bad.push(`participation ${i + 1}번 객체가 아니다`); return }\n", to: '', expect: '반례22f' },
  { id: 'M102 근거 목록 배열 검사 제거', file: 'lib', from: 'const evidence = Array.isArray(p.evidence) ? p.evidence : null',
    to: 'const evidence = p.evidence', expect: '반례22f' },
  { id: 'M103 근거 원소 객체 검사 제거', file: 'lib', from: 'evidence.every((e) => isPlain(e) && nonEmpty(e.ref)',
    to: 'evidence.every((e) => nonEmpty(e.ref)', expect: '반례22f' },
  { id: 'M104 participation 배열 검사 제거', file: 'lib', from: 'const partRows = Array.isArray(participation) ? participation : []',
    to: 'const partRows = participation', expect: '반례22f' },
  { id: 'M105 slim 이 schema 표식을 달지 않는다', file: 'lib',
    from: '    slim.schemaVersion = { ...slim.schemaVersion, participation: PARTICIPATION_SCHEMA }\n', to: '', expect: '반례22g' },
  { id: 'M106 export 표식 누락 검사 제거', file: 'lib', from: 'if (hasPart && marker !== PARTICIPATION_SCHEMA) bad.push(',
    to: 'if (false) bad.push(', expect: '반례22g' },
  { id: 'M107 export 판정 없는 표식 검사 제거', file: 'lib', from: "if (!hasPart && (marker !== undefined || 'participation' in slim)) bad.push(",
    to: 'if (false) bad.push(', expect: '반례22g' },
  // 🔴 crossCluster — 2026-10-21 이전 구현(canonical 끼리만 비교)을 되살리면 잡혀야 한다
  { id: 'M108 crossCluster 를 canonical 값끼리만 비교(옛 구현)', file: 'lib',
    from: '      fromCluster, toCluster, crossCluster: isCommunity ? false : fromCluster !== toCluster,',
    to: '      fromCluster, toCluster, crossCluster: isCommunity ? false : ((I[e.fromIntentId]?.magazineCluster ?? null) !== (I[e.toIntentId]?.magazineCluster ?? null)),',
    expect: '반례23' },
  { id: 'M109 입력 edge cluster 가 canonical 보다 앞선다', file: 'lib', from: 'const fromCluster = I[e.fromIntentId]?.magazineCluster ?? e.fromCluster ?? null',
    to: 'const fromCluster = e.fromCluster ?? I[e.fromIntentId]?.magazineCluster ?? null', expect: '반례23' },
  { id: 'M110 COMMUNITY 도 cluster 로 crossCluster 판정', file: 'lib',
    from: 'crossCluster: isCommunity ? false : fromCluster !== toCluster,', to: 'crossCluster: fromCluster !== toCluster,', expect: '반례23' },
  { id: 'M111 산출 계약의 crossCluster 값 대조 제거', file: 'lib',
    from: "else if (e.crossCluster !== (e.relationType === 'COMMUNITY' ? false : e.fromCluster !== e.toCluster)) bad.push(",
    to: 'else if (false) bad.push(', expect: '반례23b' },
  // 🔴 readinessHash 분리 · 유일한 계산 경로 (2026-10-21)
  { id: 'M112 순수 계산이 generatedAt 을 읽는다', file: 'lib',
    from: 'export function computeGraphAndReadiness({ inputTexts, productTexts, admissionTexts = null, effectiveAt }) {\n',
    to: 'export function computeGraphAndReadiness({ inputTexts, productTexts, admissionTexts = null, effectiveAt, generatedAt = null }) {\n  if (generatedAt !== null) parseGeneratedAt(generatedAt)\n',
    expect: '반례24e' },
  { id: 'M113 readiness inputs 에 벽시계', file: 'lib',
    from: "admissionHashes: admission ? admission.hashes : 'UNREAD', effectiveAt: eff.text }",
    to: "admissionHashes: admission ? admission.hashes : 'UNREAD', effectiveAt: eff.text, observedAt: new Date().toISOString() }",
    expect: '반례24e' },
  { id: 'M114 readiness 보고서에서 inputs 누락', file: 'lib', from: '    inputs,\n    policy: READINESS_POLICY,', to: '    policy: READINESS_POLICY,', expect: '반례24f' },
  { id: 'M115 readiness inputs 에서 control 해시 누락', file: 'lib',
    from: 'Object.entries(PRODUCT_FILES).map(([k, rel]) => [k, product.hashes[rel]])',
    to: "Object.entries(PRODUCT_FILES).filter(([k]) => k !== 'control').map(([k, rel]) => [k, product.hashes[rel]])", expect: '반례24f' },
  { id: 'M116 buildAll 이 readiness 를 별도 계산 복사본으로 만든다', file: 'lib',
    from: "    'readiness.json': serializeReadiness(core.readiness),",
    to: "    'readiness.json': serializeReadiness(buildReadiness({ layers, product, admission: parseAdmissionTexts(admissionTexts), effective: eff, graphVersion, inputs: core.readiness.inputs }).report),",
    expect: '반례24g' },
  { id: 'M117 readinessHash 를 pretty 파일 직렬화로 계산', file: 'lib',
    from: 'export const readinessHashOf = (report) => sha256(stableJson(report))', to: 'export const readinessHashOf = (report) => sha256(prettyStable(report))', expect: '반례24a' },
  { id: 'M118 readinessFileSha256 을 canonical 로 계산', file: 'lib',
    from: '    readinessFileSha256: sha256(serializeReadiness(readiness.report)),', to: '    readinessFileSha256: sha256(stableJson(readiness.report)),', expect: '반례24a' },
  { id: 'M119 readiness inputs 에서 admission 해시 누락', file: 'lib',
    from: "graphSemanticHash, productHashes,\n    admissionHashes: admission ? admission.hashes : 'UNREAD', effectiveAt: eff.text }",
    to: 'graphSemanticHash, productHashes,\n    effectiveAt: eff.text }', expect: '반례24f' },
  { id: 'M120 readinessHash 를 graph semanticHash 로 대신', file: 'lib',
    from: '    readinessHash: readinessHashOf(readiness.report),', to: '    readinessHash: graphSemanticHash,', expect: '반례24a' },
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
