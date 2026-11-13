#!/usr/bin/env node
/**
 * Magazine vNext S2 — ContentPlan compiler · admission · ProviderPlan 변이. 방어를 하나씩 되돌리면 `magazine-content-plan-check` 가
 * 기대한 항목으로 실패해야 한다.
 *
 *   node scripts/magazine-content-plan-mutation.mjs
 *
 * 🔴 저장소 파일을 고치지 않는다. 시작할 때 한 번 읽은 스냅샷(scripts/lib/*.mjs · 검사 · bootstrap CLI · 합성 fixture ·
 *    CP15 가 읽는 제품 파일 두 개)을 임시 폴더에 쓰고, 사본 하나에 변이 하나를 심어 그 사본의 검사를 돌린다.
 * 🔴 무변이 사본이 먼저 0 fail 이어야 한다. 변이 지점이 정확히 1곳이 아니면 하네스 FAIL(검출로 세지 않는다).
 * 🔴 검출 = exit 1 + 기대 항목 줄 `FAIL <id> `. 요약 줄 없이 죽은 사본은 검출이 아니다.
 * 마지막 줄: `content-plan 변이: <검출>/<변이 수> detected · <n> fail`
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const LIB = 'scripts/lib/magazine-content-plan.mjs'
const CHECK = 'scripts/magazine-content-plan-check.mjs'

/** [id, 설명, 기대 항목, 편집[]] — 편집은 { file, from, to } (from 정확히 1곳) */
const MUTATIONS = [
  ['CM1', '3+1 을 출판 하드 게이트로 되돌린다', 'CP2', [{ file: LIB, from: "    if (direct.length < P.relationMinimum.direct) reasons.push('DIRECT_RELATION_MINIMUM_UNMET')", to: "    if (direct.length < P.displayTarget.directMax || discovery.length < P.displayTarget.discovery) reasons.push('DIRECT_RELATION_MINIMUM_UNMET')" }]],
  ['CM2', 'direct 최소를 지운다(direct 0 통과)', 'CP3', [{ file: LIB, from: '    if (direct.length < P.relationMinimum.direct) reasons', to: '    if (direct.length < 0) reasons' }]],
  ['CM3', '이유 문구 검사를 지운다', 'CP3', [{ file: LIB, from: "  if (weak(r.readerReason, T.readerReason)) bad.push('WEAK_READER_REASON')\n", to: '' }]],
  ['CM4', '앵커가 대상 질문을 언급하는지 보지 않는다', 'CP3', [{ file: LIB, from: "    if (!mentions) bad.push('ANCHOR_TARGET_UNRELATED')\n", to: '' }]],
  ['CM5', 'CONTROLLED 를 컴파일한다', 'CP4', [{ file: LIB, from: "    if (P.profiles.controlled.includes(x.validationProfile)) reasons.push('CONTROLLED_VALIDATOR_ABSENT')\n    else if (!P.profiles.compile.includes(x.validationProfile)) reasons.push('PROFILE_UNKNOWN')\n", to: '' }]],
  ['CM6', 'admission 이 control 을 planHash 에 섞는다', 'CP8', [{ file: LIB, from: '    admitted.push({ planId: plan.planId, planHash: plan.planHash,', to: '    admitted.push({ planId: plan.planId, planHash: sha256(plan.planHash + String(controlText)),' }]],
  ['CM7', 'control 판 불일치를 보지 않는다', 'CP8', [{ file: LIB, from: "  else if (control.graphVersion !== compiled.graphVersion) global.push('GRAPH_VERSION_MISMATCH')\n", to: '' }]],
  ['CM8', 'kill switch 를 보지 않는다', 'CP8', [{ file: LIB, from: "  else if (control.killSwitch.tripped) global.push('KILL_SWITCH_TRIPPED')\n", to: '' }]],
  ['CM9', '꺼진 cluster 를 보지 않는다', 'CP8', [{ file: LIB, from: "      if (!control.enabledClusters.includes(plan.cluster)) reasons.push('CLUSTER_DISABLED')\n", to: '' }]],
  ['CM10', 'direct 표면 꺼짐을 보지 않는다', 'CP8', [{ file: LIB, from: "      if (!plan.relations.direct.some((r) => surfaceOn(r.placement))) reasons.push('NO_ENABLED_DIRECT_SURFACE')\n", to: '' }]],
  ['CM11', '같은 cluster 의 모르는 queue 항목을 중복으로 본다(오탐)', 'CP7', [{ file: LIB, from: "      if (queueRows.some((q) => q.intentId === plan.intentId)) reasons.push('DUPLICATE_QUEUE_INTENT')", to: "      if (queueRows.some((q) => q.intentId === plan.intentId || q.cluster === plan.cluster)) reasons.push('DUPLICATE_QUEUE_INTENT')" }]],
  ['CM12', 'queue 판독 실패를 빈 목록으로 넘긴다(fail-open)', 'CP10', [{ file: LIB, from: "    else { queueCode = q.code; global.push('QUEUE_IDENTITY_UNREADABLE') }", to: '    else { queueCode = q.code }' }]],
  ['CM13', 'queue 제목 중복을 보지 않는다', 'CP9', [{ file: LIB, from: "      if (queueRows.some((q) => q.titleKey === titleKey)) reasons.push('DUPLICATE_QUEUE_TITLE')\n", to: '' }]],
  ['CM14', 'canonical mapping 중복을 보지 않는다', 'CP7', [{ file: LIB, from: "      if (slugs.some((s) => listedSlugs.has(s))) reasons.push('DUPLICATE_MAPPED_ARTICLE')\n", to: '' }]],
  ['CM15', 'same-release 순환을 근거로 센다', 'CP7', [{ file: LIB, from: '          if (g && g.layer < layer) via.push(', to: '          if (tid !== undefined && candidates.has(tid)) via.push(' }]],
  ['CM16', '빠진 후보를 재판정하지 않는다', 'CP11', [{ file: LIB, from: "      if (withdrawn.has(plan.planId)) reasons.push('WITHDRAWN')\n", to: '' }]],
  ['CM17', 'ProviderPlan 이 내부 표식을 통과시킨다', 'CP12', [{ file: LIB, from: "      for (const m of CONTENT_PLAN_POLICY_BOARD.text.internalMarkers) if (v.includes(m)) { add(path, 'INTERNAL_MARKER'); break }\n", to: '' }]],
  ['CM18', 'ProviderPlan 이 이메일을 통과시킨다', 'CP12', [{ file: LIB, from: "  ['PII_EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i],\n", to: '' }]],
  ['CM19', 'ProviderPlan 이 query 붙은 URL 을 통과시킨다', 'CP12', [{ file: LIB, from: "        if (m[0].includes('?') || m[0].includes('#') || /utm_|fbclid|gclid/i.test(m[0])) add(path, 'URL_TRACKING_OR_QUERY')\n", to: '' }]],
  ['CM20', 'ProviderPlan 에 허용 밖 필드를 싣는다', 'CP12', [{ file: LIB, from: '    officialSourceUrls: [...plan.officialSourceUrls],\n  }\n', to: '    officialSourceUrls: [...plan.officialSourceUrls],\n    planHash: plan.planHash,\n  }\n' }]],
  ['CM21', 'compile 이 모르는 입력(control · 시각 · queue)을 받는다', 'CP5', [{ file: LIB, from: "  exactInput(input, ['bundle'], 'compile')", to: "  exactInput(input, Object.keys(input ?? {}), 'compile')" }]],
  ['CM22', 'ContentPlan 에 publishAt 을 싣는다', 'CP5', [
    { file: LIB, from: "const PLAN_KEYS = ['answerScope', 'audienceSituation', 'bundleHash',", to: "const PLAN_KEYS = ['answerScope', 'audienceSituation', 'publishAt', 'bundleHash'," },
    { file: LIB, from: '      officialSourceUrls: [],\n', to: '      officialSourceUrls: [],\n      publishAt: null,\n' }]],
  ['CM23', '사유 순서를 정렬하지 않는다', 'CP16', [{ file: LIB, from: 'const sortReasons = (xs) => [...new Set(xs)].sort((a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b))', to: 'const sortReasons = (xs) => [...new Set(xs)].reverse()' }]],
  ['CM24', 'articles 판독 실패를 빈 목록으로 넘긴다(fail-open)', 'CP10', [{ file: LIB, from: "  if (!articles.ok) global.push('ARTICLES_UNREADABLE')\n", to: '' }]],
  ['CM25', '공개 판정이 입력 시각 대신 벽시계를 읽는다', 'CP7', [{ file: LIB, from: 'isPublicAt(articleBySlug.get(slug), nowMs))', to: 'isPublicAt(articleBySlug.get(slug), Date.now()))' }]],
  ['CM26', '정책 판 슬롯이 builder 와 갈라진다', 'CP14', [{ file: LIB, from: "slots: { direct: ['ACTION_OR_CONTEXT', 'DIRECT_NEXT', 'SAME_EXPERIENCE'],", to: "slots: { direct: ['DIRECT_NEXT', 'SAME_EXPERIENCE']," }]],
  // ── S2 P1 (2026-11-10) ──
  ['CM27', '정책 판 내용을 바꾸고 id 는 그대로 둔다(P1-G)', 'CP14', [{ file: LIB, from: "    internalMarkers: ['🔴', '🟠', '🟡', '🟢', '⚠', 'TODO', 'FIXME'],", to: "    internalMarkers: ['🔴', '🟠', '🟡', '🟢', '⚠', 'TODO', 'FIXME', 'XXX']," }]],
  ['CM28', 'legacy 금지어 상수가 바뀌면 vNext 정책 판이 조용히 따라간다(P1-G)', 'CP14', [{ file: 'scripts/lib/magazine-qa-constants.mjs', from: 'export const BANNED_WORDS = [', to: "export const BANNED_WORDS = ['합성추가금지어', " }]],
  ['CM29', '원문 경계 규칙 숫자를 바꾸고 id 는 그대로 둔다(P1-G)', 'CP14', [{ file: 'scripts/lib/magazine-content-plan-input.mjs', from: '  titleSegmentMin: 6,', to: '  titleSegmentMin: 8,' }]],
  ['CM30', 'DRAFT · BLOCKED 행도 중복으로 본다(P1-D)', 'CP20', [{ file: LIB, from: '  const listedRows = articles.ok ? articles.rows.filter((a) => !isHeldStatus(a)) : []', to: '  const listedRows = articles.ok ? articles.rows : []' }]],
  ['CM31', 'control 판독이 텍스트 첫 출현(주석 · 문자열 · CONTROLLER)을 자른다(P1-B fail-open)', 'CP19', [{ file: 'scripts/lib/magazine-graph-control.mjs',
    from: "  if (typeof controlText === 'string') return controlText.slice(span.start, span.end)",
    to: "  if (typeof controlText === 'string') return sliceLiteral(controlText, controlText.indexOf('=', controlText.indexOf('export const CONTROL')), '{', '}')" }]],
  ['CM32', 'control 실제 선언 2개를 허용한다(P1-B)', 'CP19', [{ file: 'scripts/lib/magazine-graph-control.mjs', from: "  if (decls.length > 1) fail(`${prefix}_AMBIGUOUS`", to: "  if (false) fail(`${prefix}_AMBIGUOUS`" }]],
  ['CM33', 'isPublicAt 가 nowMs 검증 없이 받는다(P1-C)', 'CP17', [{ file: 'scripts/lib/magazine-public-rule.mjs', from: "  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new TypeError(", to: "  if (false) throw new TypeError(" }]],
  ['CM34', 'ProviderPlan 이 제3자 원문 판정을 보지 않는다(P1-E)', 'CP21', [{ file: LIB, from: "  if (plan.textProvenance !== 'CLEAR') return none(", to: "  if (false) return none(" }]],
  ['CM35', 'ProviderPlan 이 괄호 지역번호 전화를 통과시킨다(P1-E)', 'CP12', [{ file: LIB, from: '(?:\\(\\s*0\\d{1,2}\\s*\\)|0\\d{1,2}|', to: '(?:0\\d{1,2}|' }]],
  ['CM36', 'ProviderPlan 이 저장소 상대 경로를 통과시킨다(P1-E)', 'CP12', [{ file: LIB, from: '|(?:^|[^\\w./-])(?:\\.{1,2}\\/)*(?:src|scripts|', to: '|(?:^|[^\\w./-])(?:\\.{1,2}\\/)*(?:zzsrc|scripts|' }]],
  // ── S2 P1 재개 (2026-11-11) — 데이터 전용 판독 · 원시 중복 · ProviderPlan 도출 · 정책 신원 runtime 강제 ──
  ['CM38', 'control 값 판독을 vm 평가로 되돌린다(getter · 호출 · 중복 key 덮어쓰기 · P1-B)', 'CP22', [
    { file: 'scripts/lib/magazine-graph-control.mjs', from: "import { sliceLiteral } from './magazine-literal.mjs'\n", to: "import { evalLiteral, sliceLiteral } from './magazine-literal.mjs'\n" },
    { file: 'scripts/lib/magazine-graph-control.mjs', from: '  try { raw = parseDataLiteral(literal) } catch (err) { if (err instanceof ControlLocateError) return null; throw err }', to: "  try { raw = evalLiteral(literal, 'control.ts') } catch { return null }" }]],
  ['CM39', '데이터 판독이 중복 key 를 받는다(마지막 값이 이긴다 · P1-B/D)', 'CP22', [{ file: 'scripts/lib/magazine-graph-control.mjs', from: "        if (seen.has(key)) fail('LITERAL_DUPLICATE_KEY', `중복 key ${key}`, { key, depth })\n", to: '' }]],
  ['CM40', '선언 찾기가 line 주석을 코드로 읽는다(가짜 articles 선언 · P1-D)', 'CP22', [{ file: 'scripts/lib/magazine-graph-control.mjs', from: "    if (ch === '/' && next === '/') { const e = src.indexOf('\\n', i);", to: "    if (false) { const e = src.indexOf('\\n', i);" }]],
  ['CM41', '공개 · 예약 행의 공개 시각을 검증하지 않는다(P1-D)', 'CP22', [{ file: LIB, from: "    if (!isHeldStatus(row) && !Number.isFinite(strictPublishAtMs(row))) return { ok: false, code: 'ARTICLES_PUBLISH_TIME_INVALID' }\n", to: '' }]],
  ['CM42', 'queue 의 같은 slug 두 행을 받는다(P1-D)', 'CP22', [{ file: LIB, from: "    if (slugs.has(r.slug)) return { ok: false, code: 'QUEUE_DUPLICATE_SLUG' }\n", to: '' }]],
  ['CM43', 'ProviderPlan 이 job 의 planHash 를 대조하지 않는다(낡은 plan · 정책 판 · P1-E)', 'CP23', [{ file: LIB, from: "  if (plan.planHash !== planHash) return none('PLAN_STALE')\n", to: '' }]],
  ['CM44', 'ProviderPlan 이 admission 승인을 보지 않는다(P1-E)', 'CP23', [{ file: LIB, from: '  const admitted = result.admitted.find((a) => a.planId === planId)\n', to: '  const admitted = result.admitted.find((a) => a.planId === planId) ?? { relatedPublic: [] }\n' }]],
  ['CM45', 'compile 이 정책 신원표를 강제하지 않는다(P1-G)', 'CP14', [{ file: LIB, from: '  assertPolicyIdentity()\n', to: '' }]],
  // ── S2 P1 반대 검토 (2026-11-11) — 엄격 시각 · same-release 중복 · 계좌 PII · 희소 배열 ──
  ['CM46', '엄격 시각이 달력(2/30 · 평년 2/29 · 24시)을 보지 않는다(P1-2)', 'CP24', [{ file: 'scripts/lib/magazine-public-rule.mjs', from: '  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || s > 59) return NaN', to: '  if (mo < 1 || mo > 12) return NaN' }]],
  ['CM47', 'articles 공개 시각을 Date.parse 로 판정한다(정규화 통과 · P1-2)', 'CP24', [{ file: LIB, from: '    if (!isHeldStatus(row) && !Number.isFinite(strictPublishAtMs(row))) return', to: "    if (!isHeldStatus(row) && !Number.isFinite(Date.parse(row.publishAt ?? `${row.publishedAt}T10:30:00+09:00`))) return" }]],
  ['CM48', '--admission-as-of 를 Date.parse 로 판정한다(P1-2)', 'CP24', [{ file: 'scripts/magazine-plan-input-bootstrap.mjs', from: '      const ms = strictOffsetTimeMs(admissionAsOf)', to: '      const ms = Date.parse(admissionAsOf)' }]],
  ['CM49', '오프셋 범위(+15:00 · +09:60)를 보지 않는다(P1-2)', 'CP24', [{ file: 'scripts/lib/magazine-public-rule.mjs', from: '    if (oh > 14 || om > 59) return NaN\n', to: '' }]],
  // 14시 오프셋의 분 가드만 지운다 — 시 · 분 범위 가드(CM49 대상)는 그대로 둔 채 +14:01 · -14:59 가 통과하는지 본다
  ['CM58', '오프셋 14시에 0 이 아닌 분(+14:01 · -14:59)을 받는다(Codex 리뷰 P1-A)', 'CP24', [{ file: 'scripts/lib/magazine-public-rule.mjs', from: '    if (oh === 14 && om !== 0) return NaN // ISO 8601 오프셋 최대 ±14:00 — +14:01 · -14:59 는 범위 밖\n', to: '' }]],
  ['CM50', 'same-release 정확 중복 판정을 지운다(P1-4)', 'CP25', [{ file: LIB, from: "    for (const p of open) if (root(p.planId) !== p.planId) reasonsOf.get(p.planId).push('DUPLICATE_SAME_RELEASE')\n", to: '' }]],
  ['CM51', 'same-release 중복이 mapping slug 를 보지 않는다(P1-4)', 'CP25', [{ file: LIB, from: ', ...(mappedSlugs.get(p.intentId) ?? []).map((s) => `slug:${s}`)]', to: ']' }]],
  ['CM52', 'same-release 중복의 남는 후보가 입력 순서(먼저 본 쪽)에 따른다(P1-4)', 'CP25', [{ file: LIB, from: '    const join = (a, b) => { const ra = root(a), rb = root(b); if (ra !== rb) parent.set(byCodeUnit(ra, rb) < 0 ? rb : ra, byCodeUnit(ra, rb) < 0 ? ra : rb) }', to: '    const join = (a, b) => { const ra = root(a), rb = root(b); if (ra !== rb) parent.set(ra, rb) }' }]],
  ['CM53', '계좌 구분자에 공백 · NBSP · 유니코드 대시를 받지 않는다(P1-5)', 'CP26', [{ file: LIB, from: '\\d{3,6}[-\\u2010-\\u2015\\s]\\d{2,6}[-\\u2010-\\u2015\\s]\\d{4,8}', to: '\\d{3,6}-\\d{2,6}-\\d{4,8}' }]],
  ['CM54', '이어 쓴 계좌 숫자를 보지 않는다(P1-5)', 'CP26', [{ file: LIB, from: '|(?:^|\\D)\\d{10,14}(?!\\d)/],', to: '/],' }]],
  ['CM55', 'canonical JSON 이 빈 칸을 받는다(Array(1) = [] · P1-6)', 'CP27', [{ file: 'scripts/lib/magazine-content-plan-input.mjs', from: "    if (!isDense(value)) fail('CANONICAL_JSON_INVALID', '희소 배열(빈 칸)')\n", to: '' }]],
  ['CM56', 'Bundle 판독이 빈 칸을 모양 판정 전에 거르지 않는다(P1-6)', 'CP27', [{ file: 'scripts/lib/magazine-content-plan-input.mjs', from: "  { const sp = sparsePathOf(b); if (sp) fail('BUNDLE_SCHEMA', `희소 배열(빈 칸) ${sp}`) }\n", to: '' }]],
  ['CM57', 'admission 진행 중 신원 배열의 빈 칸을 받는다(P1-6)', 'CP27', [{ file: LIB, from: 'Array.isArray(input[k]) && isDense(input[k]) && input[k].every(isStr)', to: 'Array.isArray(input[k]) && input[k].every(isStr)' }]],
  ['CM37', 'ProviderPlan 이 AWS access key id 를 통과시킨다(P1-E)', 'CP12', [{ file: LIB, from: '|\\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[A-Z0-9]{16}\\b', to: '' }]],
  // ── S3 P1 (2026-11-12) — Article 출처(release) · 출시 intent 중복 · intent 단위 진행 중 · 대상 신원 ──
  ['CM59', '출시 intent 를 공개 · 예약 행에서만 본다(DRAFT · BLOCKED 출처 무시 · 상태 필터)', 'CP28', [{ file: LIB,
    from: '  const releasedSlugOf = new Map(articles.ok ? articles.rows.filter((a) => a.release).map(', to: '  const releasedSlugOf = new Map(articles.ok ? articles.rows.filter((a) => a.release && !isHeldStatus(a)).map(' }]],
  ['CM60', '진행 중을 planId 로 비교한다(graphVersion 이 바뀌면 놓친다)', 'CP28', [{ file: LIB, from: "      if (inFlight.has(plan.intentId)) reasons.push('IN_FLIGHT')", to: "      if (inFlight.has(plan.planId)) reasons.push('IN_FLIGHT')" }]],
  ['CM61', '출시 intent 를 planId(graphVersion:intentId)로 비교한다', 'CP28', [
    { file: LIB, from: '.map((a) => [a.release.intentId, a.slug]) : [])', to: '.map((a) => [`${a.release.graphVersion}:${a.release.intentId}`, a.slug]) : [])' },
    { file: LIB, from: "      if (releasedSlugOf.has(plan.intentId)) reasons.push('DUPLICATE_RELEASED_INTENT')", to: "      if (releasedSlugOf.has(plan.planId)) reasons.push('DUPLICATE_RELEASED_INTENT')" }]],
  ['CM62', '출처 key 를 느슨하게 받는다(초과 · 누락 key 통과)', 'CP28', [{ file: LIB,
    from: "  if (!exactKeysOf(r, ARTICLE_RELEASE_KEYS) || !exactKeysOf(r.policyBoard, ['hash', 'id'])) return null", to: '  if (!isPlain(r) || !isPlain(r.policyBoard)) return null' }]],
  ['CM63', '모르는 정책 판 id 를 받는다(신원표에 없는 id)', 'CP28', [
    { file: LIB, from: ' || !Object.prototype.hasOwnProperty.call(POLICY_IDENTITY_TABLE, id)) return null', to: ') return null' },
    { file: LIB, from: '  if (!isStr(hash) || hash !== POLICY_IDENTITY_TABLE[id]) return null', to: '  if (!isStr(hash) || (id in POLICY_IDENTITY_TABLE && hash !== POLICY_IDENTITY_TABLE[id])) return null' }]],
  ['CM64', '정책 판 id 와 hash 의 일치를 보지 않는다', 'CP28', [{ file: LIB, from: '  if (!isStr(hash) || hash !== POLICY_IDENTITY_TABLE[id]) return null', to: '  if (!isStr(hash)) return null' }]],
  ['CM65', '같은 release.intentId 두 행을 받는다(마지막 행이 이긴다)', 'CP28', [{ file: LIB, from: "      if (releasedBy.has(release.intentId)) return { ok: false, code: 'ARTICLES_RELEASE_DUPLICATE_INTENT' }\n", to: '' }]],
  ['CM66', '깨진 출처(release: null)를 legacy 행으로 넘긴다', 'CP28', [{ file: LIB, from: "    if (Object.prototype.hasOwnProperty.call(a, 'release')) {", to: '    if (a.release !== undefined && a.release !== null) {' }]],
  // CM67(대상 판정이 출처 행을 보지 않는다)은 S3 P1 수리(2026-11-13)로 뺐다 — admission 은 공유 규칙 overlay 만 보고, P1 은 결속이 없어
  //   overlay 가 늘 비어 있다. 그 변이는 결과가 같아(동치) 죽일 수 없다. 출처 → 대상 경로는 CP28 ⑦-5(규칙 단위) · CM73~CM76 · graph-now 변이가 본다
  ['CM68', '대상 slug 가 둘 이상이면 하나를 임의로 고른다', 'CP28', [{ file: LIB, from: '    return s.length === 1 ? s[0] : null', to: '    return s.length >= 1 ? [...s].sort()[0] : null' }]],
  ['CM69', '이미 출시된 intent 를 막지 않는다', 'CP28', [{ file: LIB, from: "      if (releasedSlugOf.has(plan.intentId)) reasons.push('DUPLICATE_RELEASED_INTENT')\n", to: '' }]],
  ['CM70', 'compile 이 articles 를 입력으로 받는다', 'CP28', [{ file: LIB, from: "  exactInput(input, ['bundle'], 'compile')", to: "  exactInput(input, ['bundle', 'articlesText'], 'compile')" }]],
  ['CM71', 'admission 이 articles(출처)를 planHash 에 섞는다', 'CP28', [{ file: LIB, from: '    admitted.push({ planId: plan.planId, planHash: plan.planHash,', to: '    admitted.push({ planId: plan.planId, planHash: sha256(plan.planHash + String(articlesText)),' }]],
  ['CM72', '옛 키 inFlightPlanIds 를 조용히 받는다', 'CP28', [{ file: LIB,
    from: "  exactInput(input, ['bundle', 'controlText', 'articlesText', 'legacyQueue', 'nowMs', 'inFlightIntentIds', 'withdrawnPlanIds'], 'admission')",
    to: "  exactInput(input, ['bundle', 'controlText', 'articlesText', 'legacyQueue', 'nowMs', 'inFlightIntentIds', 'inFlightPlanIds', 'withdrawnPlanIds'], 'admission')" }]],
  // ── S3 P1 수리 (2026-11-13) — admission 은 runtime 과 같은 출처 규칙 하나로만 대상을 센다 ──
  ['CM73', 'admission 이 공유 규칙을 우회해 출처 slug 를 그대로 대상 후보에 넣는다(앞판)', 'CP28', [{ file: LIB,
    from: '    const pool = new Set([...(mappedSlugs.get(intentId) ?? []), ...(overlaySlugsOf.get(intentId) ?? [])])',
    to: '    const pool = new Set([...(mappedSlugs.get(intentId) ?? []), ...(releasedSlugOf.has(intentId) ? [releasedSlugOf.get(intentId)] : [])])' }]],
  ['CM74', 'admission 이 컴파일 plan 결속을 넘겨 P1 에서 출처를 켠다(runtime 은 꺼져 있다)', 'CP28', [{ file: LIB,
    from: '      binding: NO_RELEASE_BINDING,',
    to: '      binding: { graphVersion: compiled.graphVersion, bundleHash: compiled.bundleHash, policyBoard: compiled.policyBoard, planHashOf: Object.fromEntries(compiled.plans.map((p) => [p.intentId, p.planHash])) },' }]],
  ['CM75', '공유 규칙이 canonical 같은 intent(미공개)를 무시한다 — admission 경로', 'CP28', [{ file: 'src/lib/magazine-provenance-rule.mjs',
    from: '    if (slugsOfIntent.has(intentId)) continue', to: '    if (false) continue' }]],
  ['CM76', '공유 규칙이 결속 없음을 결속으로 본다 — admission 경로', 'CP28', [{ file: 'src/lib/magazine-provenance-rule.mjs',
    from: '  if (!binding) return false\n', to: '  if (!binding) return true\n' }]],
]

const lines = []
let detected = 0, harnessFail = 0
let base = null
try {
  const visible = (d, re) => (existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).filter((f) => !f.startsWith('.') && re.test(f)).map((f) => `${d}/${f}`) : [])
  const snapshot = new Map()
  for (const f of [...visible('scripts/lib', /\.mjs$/), ...visible('scripts/__fixtures__/magazine/content-plan', /./), CHECK,
    'scripts/magazine-plan-input-bootstrap.mjs', 'src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts',
    'src/lib/magazine-provenance-rule.mjs']) { // S3 P1 수리 — lib 가 상대 경로로 부르는 공유 출처 규칙
    if (existsSync(join(ROOT, f))) snapshot.set(f, readFileSync(join(ROOT, f), 'utf8'))
  }
  base = mkdtempSync(join(tmpdir(), 'content-plan-mutation-'))
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
    const m = /content-plan 검사: (\d+) pass, (\d+) fail/.exec(r.stdout ?? '')
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
console.log(`\ncontent-plan 변이: ${detected}/${MUTATIONS.length} detected · ${harnessFail} fail`)
process.exit(harnessFail ? 1 : 0)
