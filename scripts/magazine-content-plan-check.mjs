#!/usr/bin/env node
/**
 * Magazine vNext S2 — ContentPlan 정적 컴파일 · 동적 admission · ProviderPlan 투영 검사 (합성 fixture 만 · 쓰기는 임시 폴더만).
 *
 *   node scripts/magazine-content-plan-check.mjs
 *
 * 보는 것 (반례 위주)
 *   CP1  기본 컴파일 — plan 집합 · 정적 사유(근거 없음 · CONTROLLED · 제외 영토)
 *   CP2  3+1 은 하드 게이트가 아니다 — direct 1 · discovery 0 이 정적 컴파일을 통과한다
 *   CP3  direct 0 · 약한 이유 · 약한 앵커 · 대상 질문과 무관한 앵커
 *   CP4  CONTROLLED 는 HOLD · T9 · BLOCKED · REJECT 는 제외
 *   CP5  publishAt · slug · provider · job · 경로 · PR · release · 승인 필드는 plan 에 못 들어간다 · 모르는 입력 키 거부
 *   CP6  결정성 — 두 번 같은 결과 · Bundle 키 순서 무관 · 정책 판 해시 고정
 *   CP7  admission 기본 — A→B→공개 층 · 순환 · 고립 묶음 · 이미 공개된 intent
 *   CP8  control — 판 불일치 · kill · 꺼짐 · cluster · 표면 · 판독 불가. 정당한 토글은 planHash 를 바꾸지 않는다
 *   CP9  중복 — 기사 제목 · queue intent · queue 제목 · queue slug · 진행 중. 같은 cluster 의 모르는 항목은 막지 않는다
 *   CP10 입력 판독 fail-closed — legacy queue(파일 없음 · 앵커 없음 · 판독 불가) · articles · adapter 꺼짐
 *   CP11 same-release 고정점 — 후보 탈락 뒤 재판정
 *   CP12 ProviderPlan — 허용 키만 · PII · 내부 표식 · 원문 근거 · 로컬 경로 · token · 추적 URL · 모르는 키 → 산출 0
 *   CP13 초안 · HOLD · 격리 입력은 컴파일 API 에 들어갈 길이 없다
 *   CP14 정책 판 ↔ relation-policy · graph builder 슬롯 대조
 *   CP15 실제 제품 파일 모양의 신원 투영 (읽기만 — articles.ts · topic-queue.ts)
 *   CP16 admission 출력 결정성 · 사유 순서 · release 신원 요구
 *   CP17 공개 판정 단일 출처(P1-C) — gate.isPublic 과 순수 isPublicAt 이 실제 articles 전 행 × 경계 시각에서 같다 · nowMs 필수
 *   CP19 CONTROL 선언 decoy(P1-B) — 주석 · 문자열 · template · CONTROLLER · CONTROL_EXTRA 의 가짜 선언이 실제 꺼짐 · kill switch 를
 *        덮지 못한다(두 판독 프로필 · admission) · 실제 선언 0 · 2개는 fail-closed
 *   CP20 중복은 공개 · 예약 행만(P1-D) — DRAFT · BLOCKED 행은 같은 제목 · mapping slug 여도 막지 않는다
 *   CP21 제3자 원문 경계(P1-E) — 커뮤니티 글 제목을 옮긴 intent · 증거 미검증 intent 는 ProviderPlan 0
 *   CP22 데이터 전용 판독 · 원시 중복(P1-B · P1-D) — control 의 getter · 계산 key · spread · 호출 · 중복 key(kill switch 두 번) ·
 *        articles 의 같은 slug 두 번 · 주석 속 가짜 선언 · 잘못된 공개 시각 · queue 의 한 행 같은 필드 두 번 · 같은 slug 두 행 → fail-closed
 *   CP24 엄격 공개 시각(P1-2) — 2/30 · 평년 2/29 · 24:00 · 범위 밖 오프셋 거부 · publishAt · publishedAt · --admission-as-of 같은 규칙
 *   CP25 same-release 정확 중복(P1-4) — 제목 · mapping slug 공유 · 연쇄 → planId 최소 하나만 · 순열 무관
 *   CP26 계좌 PII(P1-5) — 공백 · NBSP · 대시 · 연속 숫자 · 중첩 → ProviderPlan 0 · 날짜 · 짧은 수 통과
 *   CP27 희소 배열(P1-6) — 빈 칸은 해시 · 모양 판정 전에 BUNDLE_SCHEMA · CANONICAL_JSON_INVALID
 *   CP23 ProviderPlan 도출(P1-E) — 호출자 plan · admission 값을 받지 않는다 · 낡은 planHash(내용 · 정책 판) · 미컴파일 · 미승인 → 산출 0 ·
 *        관련 글 제목은 그 시각의 articles.ts 에서만
 *   CP28 Article 출처(release · S3 P1) — 엄격 schema 반례 · 같은 release.intentId 두 행 → 전체 실패 · 출시 intent 는 상태 · graphVersion
 *        무관 DUPLICATE_RELEASED_INTENT · revert 뒤 재승인 · 옛 inFlightPlanIds 거부 · 진행 중은 intent 단위 · planHash 불변 ·
 *        공개 출처 행이 대상 신원 · 둘 이상이면 고르지 않음 · 실제 articles.ts 는 출처 0
 * 마지막 줄: `content-plan 검사: <n> pass, <n> fail`
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeWorld, articlesText, queueText, controlText } from './__fixtures__/magazine/content-plan/world.mjs'
import { bootWorld, cleanupFixtureBootstrap } from './__fixtures__/magazine/content-plan/bootstrap-fixture.mjs'
import { SOURCE_TEXT_RULE, canonicalJson, parsePlanInputBundle as parsePI, planInputRel, prettyCanonical, sealBundle, sha256Hex } from './lib/magazine-content-plan-input.mjs'
import {
  ARTICLE_RELEASE_KEYS, ARTICLE_RELEASE_SCHEMA, CONTENT_PLAN_POLICY_BOARD, POLICY_BOARD_HASH, POLICY_IDENTITY_TABLE, PROVIDER_PLAN_KEYS, REASON_ORDER, SLUG_BINDING_REQUIRED, SOURCE_TEXT_RULE_HASH,
  admitContentPlans, assertContentPlan, compileContentPlans, parseArticleIdentityText, parseQueueIdentityText, planHashOf, projectProviderPlan, providerPlanProblems,
} from './lib/magazine-content-plan.mjs'
import { DIRECT_SLOTS, DISCOVERY_SLOT, DISCOVERY_TYPE } from './lib/magazine-graph-build.mjs'
import { RELATION_DISPLAY_TARGET, VNEXT_PUBLICATION_RELATION_MINIMUM } from './lib/magazine-relation-policy.mjs'
import { parseArticlesSource, parseQueueSource } from './lib/magazine-load.mjs'
import * as gate from './lib/magazine-gate.mjs'
import * as publicRule from './lib/magazine-public-rule.mjs'
import { parseControlText, parseGraphControl } from './lib/magazine-graph-control.mjs'

/**
 * 정책 신원 고정 (P1-G) — lib 의 POLICY_IDENTITY_TABLE 이 runtime 에서 강제하고, 이 표는 **기존 행이 바뀌지 않았는지**를 따로 고정한다.
 * 내용을 바꾸면 lib 표 · 이 표 모두 id 를 올린 새 행을 더해야 한다(기존 id 의 해시를 고치면 FAIL).
 * 🔴 legacy 공유 상수(금지어 · 관계 수량)가 바뀌어도 여기서 멈춘다 — vNext 정책 신원이 legacy 를 조용히 따라가지 않게.
 */
const POLICY_HASHES = Object.freeze({
  'magazine-content-plan-policy/1': 'c21d58fd6089c49a1bf3475e74fa8cddc774051d37be777707de07670a15250d',
  'magazine-source-text-rule/1': 'e4fafd1b437d2c39e4f7d3a147c783b0cea00697e6a54801f57b4e568a653527',
})

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const TMP = mkdtempSync(join(tmpdir(), 'content-plan-check-'))
const NOW = Date.parse('2026-11-10T17:00:00+09:00')
let pass = 0, fail = 0, n = 0
const check = async (id, name, fn) => {
  try { await fn(); pass++; console.log(`PASS ${id} ${name}`) } catch (e) { fail++; console.log(`FAIL ${id} ${name} — ${String(e?.message ?? e).split('\n')[0]}`) }
}
const assert = (ok, why) => { if (!ok) throw new Error(why) }
const codeOf = (fn) => { try { fn(); return 'OK' } catch (e) { return e.code ?? e.message } }

/** 합성 world → bootstrap 으로 만든 Bundle 텍스트(임시 폴더) — 시험 전용 helper(운영 API 에 판 손잡이 없음 · P1-F) */
async function fresh(mutate, after = () => {}) {
  const w = makeWorld(mkdtempSync(join(TMP, `w${n++}-`)), mutate)
  after(w)
  const r = await bootWorld(w, { write: true })
  if (!r.ok) throw new Error(`fixture bootstrap 실패 ${r.code} ${r.why}`)
  const text = readFileSync(join(w.productRoot, planInputRel(w.graphVersion)), 'utf8')
  const pid = (intentId) => `${w.graphVersion}:${intentId}`
  return { w, text, pid }
}
/** Bundle 값을 고친 뒤 두 해시(bundleHash · recordHash)를 다시 맞춘 canonical 텍스트 — 판독 계약 안에서 내용만 바꾼다 */
function edit(text, mut) {
  const b = JSON.parse(text); mut(b)
  return prettyCanonical(sealBundle(b))
}
function admissionInput(f, over = {}) {
  const { seed, graphVersion } = f.w
  return {
    bundle: over.bundle ?? f.text,
    controlText: over.controlText ?? controlText(graphVersion, over.control ?? seed.control),
    articlesText: over.articlesText ?? articlesText(over.articles ?? seed.articles),
    legacyQueue: over.legacyQueue ?? { active: true, text: queueText(over.queue ?? seed.queue) },
    nowMs: over.nowMs ?? NOW,
    inFlightIntentIds: over.inFlightIntentIds ?? [],
    withdrawnPlanIds: over.withdrawnPlanIds ?? [],
  }
}
const admit = (f, over = {}) => admitContentPlans(admissionInput(f, over))
/** ProviderPlan — admission 입력 · planId · job 이 묶인 planHash 만 넘긴다(P1-E) */
const provide = (f, plan, over = {}, planHash = plan.planHash) => projectProviderPlan({ admission: admissionInput(f, over), planId: plan.planId, planHash })
const heldOf = (a, id) => a.held.find((h) => h.planId === id)?.reasons ?? null
const admittedOf = (a, id) => a.admitted.find((x) => x.planId === id) ?? null
const plansOf = (c) => c.plans.map((p) => `${p.intentId}:${p.planHash}`).join(',')

let F = null, base = null
try {
  // setup 도 검사다 — 실패해도 요약 줄이 나오고, F 에 기대는 항목은 각자 FAIL 로 찍힌다(변이 하네스가 검출로 센다)
  await check('CP0', '기본 world — bootstrap · 정적 컴파일', async () => { F = await fresh(); base = compileContentPlans({ bundle: F.text }) })

  await check('CP1', '기본 컴파일 — plan 집합 · 정적 사유', async () => {
    assert(base.plans.map((p) => p.intentId).join() === 'I-F1-01,I-F2-01,I-F2-02,I-F3-01,I-F3-02,I-F4-01,I-F4-02,I-F8-01', `plans ${base.plans.map((p) => p.intentId)}`)
    const held = Object.fromEntries(base.held.map((h) => [h.intentId, h.reasons.join('+')]))
    assert(held['I-F5-01'] === 'CONTROLLED_VALIDATOR_ABSENT', `F5 ${held['I-F5-01']}`)
    assert(held['I-F6-01'] === 'DIRECT_RELATION_MINIMUM_UNMET', `F6 ${held['I-F6-01']}`)
    assert(held['I-F9-01'] === 'TERRITORY_EXCLUDED', `F9 ${held['I-F9-01']}`)
    assert(held['I-F1-02'] === 'DIRECT_RELATION_MINIMUM_UNMET', `builder 자동 역방향은 근거가 아니다 ${held['I-F1-02']}`)
    for (const p of base.plans) assertContentPlan(p)
    const p1 = base.plans[0]
    assert(p1.relations.direct.map((r) => r.edgeId).join() === 'E-0001,E-0002' && p1.relations.discovery.map((r) => r.edgeId).join() === 'E-0003', 'F1 관계 선택')
    assert(p1.policyBoard.hash === POLICY_BOARD_HASH && p1.bundleHash === JSON.parse(F.text).bundleHash, 'plan 이 Bundle · 정책 판 신원을 싣는다')
  })

  await check('CP2', '3+1 은 하드 게이트가 아니다 — direct 1 · discovery 0 통과', async () => {
    const p = base.plans.find((x) => x.intentId === 'I-F2-02')
    assert(p && p.relations.direct.length === 1 && p.relations.discovery.length === 0, 'direct 1 · discovery 0 plan 이 없다')
    assert(p.quality.meetsDisplayTarget === false && base.plans.every((x) => x.quality.meetsDisplayTarget === false), '3+1 미달이 품질 metadata 로 남지 않았다')
    const noDisc = compileContentPlans({ bundle: edit(F.text, (b) => { b.relations = b.relations.filter((r) => r.edgeId !== 'E-0003') }) })
    assert(noDisc.plans.some((x) => x.intentId === 'I-F1-01'), 'discovery 를 빼자 plan 이 사라졌다')
  })

  await check('CP3', 'direct 0 · 약한 이유 · 약한 앵커 · 무관한 앵커', async () => {
    const only = (mut) => compileContentPlans({ bundle: edit(F.text, (b) => { const r = b.relations.find((x) => x.edgeId === 'E-0010'); mut(r) }) })
    const rejOf = (c) => c.held.find((h) => h.intentId === 'I-F2-01')
    for (const [label, mut, why] of [
      ['짧은 이유', (r) => { r.readerReason = '짧다' }, 'WEAK_READER_REASON'],
      ['빈 이유', (r) => { r.readerReason = '   ' }, 'WEAK_READER_REASON'],
      ['금지어 이유', (r) => { r.readerReason = '합성 시니어 독자가 다음으로 간다' }, 'WEAK_READER_REASON'],
      ['내부 표식 이유', (r) => { r.readerReason = '🔴 합성 자동 생성 계획 문장이다' }, 'WEAK_READER_REASON'],
      ['짧은 앵커', (r) => { r.anchorLabel = '다음' }, 'WEAK_ANCHOR_LABEL'],
      ['이유와 같은 앵커', (r) => { r.anchorLabel = r.readerReason }, 'WEAK_ANCHOR_LABEL'],
      ['무관한 앵커', (r) => { r.anchorLabel = '전혀 엉뚱한 곳으로' }, 'ANCHOR_TARGET_UNRELATED'],
    ]) {
      const h = rejOf(only(mut))
      assert(h && h.reasons.includes('DIRECT_RELATION_MINIMUM_UNMET') && h.relationRejections.some((x) => x.edgeId === 'E-0010' && x.why.includes(why)), `${label}: ${JSON.stringify(h)}`)
    }
    const none = compileContentPlans({ bundle: edit(F.text, (b) => { b.relations = b.relations.filter((r) => r.edgeId !== 'E-0001' && r.edgeId !== 'E-0002') }) })
    assert(none.held.find((h) => h.intentId === 'I-F1-01')?.reasons.includes('DIRECT_RELATION_MINIMUM_UNMET'), 'direct 0 (discovery 만) 이 통과했다')
  })

  await check('CP4', 'CONTROLLED HOLD · 제외 영토', async () => {
    for (const prof of ['MEDICAL', 'FINANCIAL', 'SENSITIVE']) {
      const c = compileContentPlans({ bundle: edit(F.text, (b) => { b.intents.find((x) => x.intentId === 'I-F1-01').validationProfile = prof }) })
      assert(c.held.find((h) => h.intentId === 'I-F1-01')?.reasons.includes('CONTROLLED_VALIDATOR_ABSENT'), `${prof} 가 컴파일됐다`)
    }
    for (const [k, v] of [['policyScope', 'BLOCKED'], ['automationDecision', 'REJECT'], ['territoryId', 'T9']]) {
      const c = compileContentPlans({ bundle: edit(F.text, (b) => { b.intents.find((x) => x.intentId === 'I-F1-01')[k] = v }) })
      assert(c.held.find((h) => h.intentId === 'I-F1-01')?.reasons.includes('TERRITORY_EXCLUDED'), `${k}=${v} 가 제외되지 않았다`)
    }
    const hold = compileContentPlans({ bundle: edit(F.text, (b) => { b.intents.find((x) => x.intentId === 'I-F1-01').automationDecision = 'HOLD' }) })
    assert(hold.held.find((h) => h.intentId === 'I-F1-01')?.reasons.includes('INTENT_NOT_PASS'), 'HOLD intent 가 컴파일됐다')
  })

  await check('CP5', '날짜 · slug · provider · job · 경로 · PR · release · 승인 필드 0 · 모르는 입력 거부', async () => {
    const CONTRACT = ['answerScope', 'audienceSituation', 'bundleHash', 'cluster', 'cta', 'exclusions', 'forbiddenClaims', 'graphVersion', 'inclusions', 'intentId',
      'officialSourceUrls', 'planHash', 'planId', 'policyBoard', 'primaryQuery', 'quality', 'relations', 'schemaVersion', 'territoryGrade', 'territoryId', 'textProvenance', 'validationProfile']
    for (const p of base.plans) assert(Object.keys(p).sort().join() === CONTRACT.join(), `plan 키 ${Object.keys(p).sort()}`)
    const FORBIDDEN = ['publishAt', 'publishedAt', 'slug', 'provider', 'model', 'jobId', 'responseId', 'path', 'runtimePath', 'pr', 'prNumber', 'branch', 'release', 'releaseId', 'approvedBy', 'founderApproval', 'approver', 'asOf', 'controlSha256', 'queue', 'articles']
    for (const k of FORBIDDEN) {
      const p = JSON.parse(JSON.stringify(base.plans[0])); p[k] = 'x'
      assert(codeOf(() => assertContentPlan(p)) === 'PLAN_SCHEMA', `plan 에 ${k} 가 들어갔다`)
    }
    const nested = JSON.parse(JSON.stringify(base.plans[0])); nested.relations.direct[0].slug = 'fx-next'
    assert(codeOf(() => assertContentPlan(nested)) === 'PLAN_SCHEMA', '관계 항목에 slug 가 들어갔다')
    const s = JSON.stringify(base.plans)
    for (const k of ['"publishAt"', '"slug"', '"provider"', '"jobId"', '"release"', '"approvedBy"', '"asOf"']) assert(!s.includes(k), `plan 직렬화에 ${k}`)
    for (const k of ['controlText', 'articlesText', 'queueText', 'nowMs', 'publishAt', 'provider', 'drafts']) {
      assert(codeOf(() => compileContentPlans({ bundle: F.text, [k]: 'x' })) === 'INPUT_UNKNOWN_KEY', `compile 이 ${k} 입력을 받았다`)
    }
    const tampered = JSON.parse(JSON.stringify(base.plans[0])); tampered.validationProfile = 'MEDICAL'
    assert(codeOf(() => assertContentPlan(tampered)) === 'PLAN_HASH_MISMATCH', 'plan 내용 변조가 해시로 잡히지 않는다')
  })

  await check('CP6', '결정성 — 두 번 같음 · Bundle 키 순서 무관 · 정책 판 해시 고정', async () => {
    assert(canonicalJson(compileContentPlans({ bundle: F.text })) === canonicalJson(base), '두 번 컴파일 결과가 다르다')
    const reversed = (v) => (Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v)
    const keyShuffled = reversed(JSON.parse(F.text))
    assert(plansOf(compileContentPlans({ bundle: keyShuffled })) === plansOf(base), 'Bundle 키 순서가 planHash 를 바꿨다')
    assert(POLICY_BOARD_HASH === sha256Hex(canonicalJson(CONTENT_PLAN_POLICY_BOARD)) && Object.isFrozen(CONTENT_PLAN_POLICY_BOARD.text.bannedWords), '정책 판 해시 · 동결')
    const rowShuffled = JSON.parse(F.text); rowShuffled.intents.reverse()
    assert(codeOf(() => compileContentPlans({ bundle: rowShuffled })) === 'BUNDLE_SCHEMA', '정렬되지 않은 Bundle 행이 조용히 받아들여졌다')
  })

  await check('CP7', 'admission 기본 — 층 · 순환 · 고립 · 이미 공개', async () => {
    const a = admit(F)
    assert(a.admitted.map((x) => x.intentId).join() === 'I-F1-01,I-F2-01,I-F2-02', `admitted ${a.admitted.map((x) => x.intentId)}`)
    const f2a = admittedOf(a, F.pid('I-F2-01')), f2b = admittedOf(a, F.pid('I-F2-02')), f1 = admittedOf(a, F.pid('I-F1-01'))
    assert(f1.layer === 1 && f1.groundedBy.every((g) => g.target === 'PUBLIC'), 'F1 은 공개 대상으로 층 1')
    assert(f2b.layer === 1 && f2a.layer === 2 && f2a.groundedBy[0].target === 'SAME_RELEASE' && f2a.groundedBy[0].planId === F.pid('I-F2-02'), 'A→B→공개 는 B 층 1 · A 층 2')
    assert(heldOf(a, F.pid('I-F3-01'))?.join() === 'SAME_RELEASE_UNGROUNDED' && heldOf(a, F.pid('I-F3-02'))?.join() === 'SAME_RELEASE_UNGROUNDED', `순환 A↔B ${heldOf(a, F.pid('I-F3-01'))} / ${heldOf(a, F.pid('I-F3-02'))}`)
    assert(heldOf(a, F.pid('I-F4-01'))?.join() === 'SAME_RELEASE_UNGROUNDED' && heldOf(a, F.pid('I-F4-02'))?.join() === 'RELATION_TARGET_UNAVAILABLE', '고립 묶음')
    assert(heldOf(a, F.pid('I-F8-01'))?.join() === 'DUPLICATE_MAPPED_ARTICLE', '이미 공개된 intent(canonical mapping) 가 통과했다')
    const before = admit(F, { nowMs: Date.parse('2026-10-01T00:00:00+09:00') })
    assert(before.admitted.length === 0 && heldOf(before, F.pid('I-F1-01'))?.includes('RELATION_TARGET_UNAVAILABLE'), '대상 공개 전 시각에도 통과했다')
  })

  await check('CP8', 'control 게이트 · 정당한 토글은 planHash 불변', async () => {
    const hashes = (a) => [...a.admitted, ...a.held].map((x) => `${x.planId}:${x.planHash}`).sort().join()
    const want = hashes(admit(F))
    const C = F.w.seed.control
    const cases = [
      ['판 불일치', { controlText: controlText('g-20260101-000000', C) }, 'GRAPH_VERSION_MISMATCH'],
      ['kill switch', { control: { ...C, killSwitch: { ...C.killSwitch, tripped: true } } }, 'KILL_SWITCH_TRIPPED'],
      ['graph 꺼짐', { control: { ...C, enabled: false } }, 'GRAPH_DISABLED'],
      ['판독 불가', { controlText: 'export const CONTROL = {' }, 'CONTROL_UNREADABLE'],
    ]
    for (const [label, over, code] of cases) {
      const a = admit(F, over)
      assert(a.admitted.length === 0 && [...a.held].every((h) => h.reasons.includes(code)), `${label}: ${code} 로 전부 멈추지 않았다`)
      assert(hashes(a) === want, `${label}: planHash 가 바뀌었다`)
    }
    const famOff = admit(F, { control: { ...C, enabledClusters: ['money-work'] } })
    assert(heldOf(famOff, F.pid('I-F2-02'))?.includes('CLUSTER_DISABLED') && admittedOf(famOff, F.pid('I-F1-01')), 'cluster 끔')
    const surf = admit(F, { control: { ...C, surfaces: { ...C.surfaces, FOOTER_NEXT: false, FOOTER_SIBLING: false } } })
    assert(heldOf(surf, F.pid('I-F1-01'))?.includes('NO_ENABLED_DIRECT_SURFACE'), 'direct 표면이 모두 꺼졌는데 통과했다')
    const on = admit(F, { control: { ...C, enabledClusters: ['money-work', 'family', 'sleep', 'health'], surfaces: { ...C.surfaces, BODY_CALLOUT: true } } })
    assert(hashes(famOff) === want && hashes(surf) === want && hashes(on) === want, '정당한 control 토글이 planHash 를 바꿨다')
    assert(plansOf(compileContentPlans({ bundle: F.text })) === plansOf(base), '토글 뒤 재컴파일 planHash 가 다르다')
    // export 시점 control 이 달라도(꺼짐 · kill · cluster 0) 같은 내용의 Bundle 은 같은 bundleHash · planHash — 출처 봉인만 다르다(P1-A)
    const exported = await fresh(undefined, (w) => writeFileSync(join(w.productRoot, 'src/content/magazine/graph/control.ts'),
      controlText(w.graphVersion, { ...w.seed.control, enabled: false, enabledClusters: [], killSwitch: { ...w.seed.control.killSwitch, tripped: true } })))
    assert(plansOf(compileContentPlans({ bundle: exported.text })) === plansOf(base), 'export 시점 control 이 planHash 를 바꿨다')
    assert(JSON.parse(exported.text).bundleHash === JSON.parse(F.text).bundleHash && JSON.parse(exported.text).recordHash !== JSON.parse(F.text).recordHash, 'export 시점 control 은 recordHash 에만 남아야 한다')
  })

  await check('CP9', '중복 — 정확한 신원만 · 같은 cluster 모르는 항목은 통과', async () => {
    const titled = admit(F, { articles: [...F.w.seed.articles, { slug: 'fx-dup-title', title: '합성 이력서 칸을, 어떻게 채우나요?', cluster: 'family', publishAt: '2026-12-01T10:30:00+09:00' }] })
    assert(heldOf(titled, F.pid('I-F1-01'))?.join() === 'DUPLICATE_ARTICLE_TITLE', `기사 제목(예약 글 포함) ${heldOf(titled, F.pid('I-F1-01'))}`)
    const q = (rows) => admit(F, { queue: [...F.w.seed.queue, ...rows] })
    assert(heldOf(q([{ slug: 'fx-q1', title: '아무 제목', cluster: 'sleep', intentId: 'I-F1-01' }]), F.pid('I-F1-01'))?.join() === 'DUPLICATE_QUEUE_INTENT', 'queue intent')
    assert(heldOf(q([{ slug: 'fx-q2', title: '합성 이력서 칸을 어떻게 채우나요', cluster: 'sleep' }]), F.pid('I-F1-01'))?.join() === 'DUPLICATE_QUEUE_TITLE', 'queue 제목')
    assert(heldOf(q([{ slug: 'fx-queued', title: '다른 제목', cluster: 'family' }]), F.pid('I-F2-02'))?.includes('DUPLICATE_QUEUE_SLUG'), 'queue slug = canonical mapping slug')
    const same = q([{ slug: 'fx-q3', title: '합성 같은 cluster 다른 주제 둘', cluster: 'money-work' }, { slug: 'fx-q4', title: '합성 family 다른 주제', cluster: 'family' }])
    assert(admittedOf(same, F.pid('I-F1-01')) && admittedOf(same, F.pid('I-F2-01')), '같은 cluster 의 모르는 queue 항목이 막았다(오탐)')
    const flight = admit(F, { inFlightIntentIds: ['I-F1-01'] })
    assert(heldOf(flight, F.pid('I-F1-01'))?.join() === 'IN_FLIGHT', '진행 중 plan')
  })

  await check('CP10', '입력 판독 fail-closed — legacy queue · articles', async () => {
    for (const [label, text] of [['파일 없음', null], ['앵커 없음', 'export const OTHER = []\n'], ['판독 불가', 'export const TOPIC_QUEUE: X[] = [ { slug: \n']]) {
      const a = admit(F, { legacyQueue: { active: true, text } })
      assert(a.admitted.length === 0 && a.held.every((h) => h.reasons.includes('QUEUE_IDENTITY_UNREADABLE')), `${label}: fail-open`)
      assert(a.inputs.legacyQueue.unreadable !== null, `${label}: 사유 코드 없음`)
    }
    for (const [label, text] of [['articles 앵커 없음', 'export const X = {}\n'], ['articles 판독 불가', 'const MAGAZINE_ARTICLE_RECORD = { "a": \n']]) {
      const a = admit(F, { articlesText: text })
      assert(a.admitted.length === 0 && a.held.every((h) => h.reasons.includes('ARTICLES_UNREADABLE')), `${label}: fail-open`)
    }
    const off = admit(F, { legacyQueue: { active: false, text: null } })
    assert(off.admitted.length === 3 && off.inputs.legacyQueue.active === false, 'adapter 꺼짐(legacy 삭제 뒤) 경로')
    assert(codeOf(() => admit(F, { legacyQueue: { active: false, text: 'x' } })) === 'INPUT_INVALID', 'adapter 꺼짐 + 텍스트를 받았다')
    const q = parseQueueIdentityText(queueText(F.w.seed.queue))
    assert(q.ok && canonicalJson(Object.keys(q.rows[0]).sort()) === canonicalJson(['cluster', 'intentId', 'slug', 'titleKey']), 'queue 투영 필드가 신원 넷이 아니다')
    assert(!JSON.stringify(q).includes('PRIVATE-QUEUE'), 'queue 초안 메모가 투영에 남았다')
  })

  await check('CP11', 'same-release 고정점 — 후보 탈락 뒤 재판정', async () => {
    const w = admit(F, { withdrawnPlanIds: [F.pid('I-F2-02')] })
    assert(heldOf(w, F.pid('I-F2-02'))?.join() === 'WITHDRAWN' && heldOf(w, F.pid('I-F2-01'))?.join() === 'RELATION_TARGET_UNAVAILABLE', `탈락 ${heldOf(w, F.pid('I-F2-01'))}`)
    const dup = admit(F, { queue: [...F.w.seed.queue, { slug: 'fx-x', title: '무관', cluster: 'family', intentId: 'I-F2-02' }] })
    assert(heldOf(dup, F.pid('I-F2-01'))?.join() === 'RELATION_TARGET_UNAVAILABLE', '중복으로 빠진 대상의 출발 후보가 남았다')
    // A→B→C→공개 의 연쇄 탈락 — C 를 빼면 B · A 가 함께 빠진다
    const chain = edit(F.text, (b) => {
      b.relations = b.relations.map((r) => (r.edgeId === 'E-0040' ? r : r.edgeId === 'E-0041' ? { ...r, toIntentId: 'I-F2-02', anchorLabel: '합성 가족 다음 질문' } : r))
    })
    const ok = admit(F, { bundle: chain })
    assert(admittedOf(ok, F.pid('I-F4-01'))?.layer === 3 && admittedOf(ok, F.pid('I-F4-02'))?.layer === 2, '3층 연쇄')
    const cut = admit(F, { bundle: chain, withdrawnPlanIds: [F.pid('I-F2-02')] })
    assert(heldOf(cut, F.pid('I-F4-02'))?.join() === 'RELATION_TARGET_UNAVAILABLE' && heldOf(cut, F.pid('I-F4-01'))?.join() === 'SAME_RELEASE_UNGROUNDED', '연쇄 재판정')
  })

  await check('CP12', 'ProviderPlan — 허용 키 · 금지 내용이면 산출 0', async () => {
    const a = admit(F)
    const plan = base.plans.find((p) => p.intentId === 'I-F1-01')
    assert(admittedOf(a, plan.planId), 'I-F1-01 이 admission 을 통과하지 못했다')
    const r = provide(F, plan)
    assert(r.ok && Object.keys(r.providerPlan).sort().join() === [...PROVIDER_PLAN_KEYS].sort().join(), `기본 ProviderPlan ${JSON.stringify(r.problems)}`)
    assert(r.providerPlan.relatedArticles.map((x) => x.slug).join() === 'fx-next,fx-sibling,fx-bridge', '이미 공개된 관련 글만')
    const s = JSON.stringify(r.providerPlan)
    for (const k of ['edgeId', 'evidence', 'sha256', 'planHash', 'bundleHash', 'graphVersion', 'intentId', 'readerReason', 'serpapi']) assert(!s.includes(k), `ProviderPlan 에 ${k}`)
    const projected = (mut) => {
      const text = edit(F.text, (b) => mut(b.intents.find((x) => x.intentId === 'I-F1-01')))
      const p = compileContentPlans({ bundle: text }).plans.find((x) => x.intentId === 'I-F1-01')
      return provide(F, p, { bundle: text })
    }
    for (const [label, mut, code] of [
      ['이메일', (x) => { x.answerScope = '문의는 someone@example.com 으로' }, 'PII_EMAIL'],
      ['전화', (x) => { x.audienceSituation = '연락처 010-1234-5678 로 묻는 상황' }, 'PII_PHONE'],
      ['주민번호', (x) => { x.answerScope = '번호 900101-2345678 확인' }, 'PII_RRN'],
      ['계좌', (x) => { x.answerScope = '계좌 110-123-456789 로' }, 'PII_ACCOUNT'],
      ['내부 표식', (x) => { x.exclusions = ['🔴 신입 이력서 작성법 — 다른 독자다'] }, 'INTERNAL_MARKER'],
      ['원문 근거', (x) => { x.answerScope = 'evidence/serpapi/fx-a.json 의 결과' }, 'RAW_EVIDENCE'],
      ['로컬 경로', (x) => { x.answerScope = '파일 /Users/someone/notes 참고' }, 'LOCAL_PATH'],
      ['token', (x) => { x.answerScope = '키 sk-abcdefghijklmnopqrstuvwx 사용' }, 'TOKEN'],
      ['본문 URL', (x) => { x.answerScope = '자세한 내용은 https://example.com/a 참고' }, 'URL_OUTSIDE_SOURCES'],
      ['추적 URL', (x) => { x.answerScope = 'https://example.com/a?utm_source=x' }, 'URL_TRACKING_OR_QUERY'],
      ['회원 식별자', (x) => { x.audienceSituation = 'userId 로 찾은 회원 상황' }, 'MEMBER_IDENTIFIER'],
      // P1-E 실측 누락 — 저장소 상대 경로 · AWS access key id · 괄호 지역번호 · 국가번호
      ['저장소 상대 경로', (x) => { x.answerScope = '자세한 기준은 src/content/magazine/articles 에 있다' }, 'LOCAL_PATH'],
      ['AWS access key', (x) => { x.answerScope = '키 AKIAIOSFODNN7EXAMPLE 로 올린다' }, 'TOKEN'],
      ['괄호 지역번호 전화', (x) => { x.audienceSituation = '문의 (010) 1234-5678 로 받는 상황' }, 'PII_PHONE'],
      ['국가번호 전화', (x) => { x.audienceSituation = '문의 +82 10-1234-5678 로 받는 상황' }, 'PII_PHONE'],
    ]) {
      const p = projected(mut)
      assert(!p.ok && p.providerPlan === null && p.problems.some((x) => x.code === code), `${label}: ${JSON.stringify(p.problems)}`)
    }
    const extra = { ...r.providerPlan, notes: 'x' }
    assert(providerPlanProblems(extra).some((x) => x.code === 'UNKNOWN_KEY' && x.path === 'notes'), '모르는 키')
    for (const u of ['https://www.nps.or.kr/a?x=1', 'https://www.nps.or.kr/a#frag', 'http://www.nps.or.kr/a', 'https://u:p@www.nps.or.kr/']) {
      assert(providerPlanProblems({ ...r.providerPlan, officialSourceUrls: [u] }).some((x) => x.code === 'URL_NOT_CLEAN'), `깨끗하지 않은 출처 URL ${u}`)
    }
    assert(providerPlanProblems({ ...r.providerPlan, officialSourceUrls: ['https://www.nps.or.kr/jsppage/info/easy/easy_04_01.jsp'] }).length === 0, '깨끗한 공식 출처 URL 은 통과')
    assert(codeOf(() => projectProviderPlan({ admission: admissionInput(F), planId: plan.planId, planHash: plan.planHash, extra: 1 })) === 'INPUT_UNKNOWN_KEY', 'ProviderPlan 모르는 입력')
  })

  await check('CP13', '초안 · HOLD · 격리 입력은 컴파일 · admission 에 길이 없다', async () => {
    for (const k of ['drafts', 'hold', 'quarantine', 'queue']) {
      assert(codeOf(() => compileContentPlans({ bundle: F.text, [k]: [] })) === 'INPUT_UNKNOWN_KEY', `compile ${k}`)
      assert(codeOf(() => admitContentPlans({ bundle: F.text, controlText: '', articlesText: '', legacyQueue: { active: false, text: null }, nowMs: NOW, [k]: [] })) === 'INPUT_UNKNOWN_KEY', `admission ${k}`)
    }
    assert(codeOf(() => admitContentPlans({ bundle: F.text, controlText: '', articlesText: '', legacyQueue: { active: false, text: null } })) === 'INPUT_INVALID', 'nowMs 없이 벽시계로 넘어갔다')
    assert(codeOf(() => admit(F, { inFlightIntentIds: 'I-F1-01' })) === 'INPUT_INVALID', '진행 중 신원을 문자열로 받았다(글자 단위 집합)')
  })

  await check('CP14', '정책 판 ↔ relation-policy · graph builder', async () => {
    const P = CONTENT_PLAN_POLICY_BOARD
    assert(P.relationMinimum.direct === VNEXT_PUBLICATION_RELATION_MINIMUM.direct, '출판 최소')
    assert(P.displayTarget.directMax === RELATION_DISPLAY_TARGET.directMax && P.displayTarget.discovery === RELATION_DISPLAY_TARGET.discovery, '표시 목표')
    assert([...P.slots.direct].sort().join() === [...DIRECT_SLOTS].sort().join() && P.slots.discovery === DISCOVERY_SLOT && P.slots.discoveryType === DISCOVERY_TYPE, '슬롯이 builder 와 다르다')
    assert(P.profiles.compile.join() === 'STANDARD', '초기 commissioning 은 STANDARD 만')
    // 🔴 판 id 별 기대 해시(P1-G) — 내용이 바뀌었는데 id 가 그대로면 FAIL. legacy 상수 변경도 여기서 멈춘다
    assert(POLICY_HASHES[P.id] === POLICY_BOARD_HASH, `정책 판 ${P.id} 내용이 고정표와 다르다(현재 ${POLICY_BOARD_HASH}) — 규칙을 바꿨으면 id 를 올리고 표에 새 행을 더한다`)
    const ruleHash = sha256Hex(canonicalJson(SOURCE_TEXT_RULE))
    assert(POLICY_HASHES[SOURCE_TEXT_RULE.id] === ruleHash, `원문 경계 규칙 ${SOURCE_TEXT_RULE.id} 내용이 고정표와 다르다(현재 ${ruleHash}) — id 를 올리고 표에 새 행을 더한다`)
    assert(Object.isFrozen(SOURCE_TEXT_RULE) && Object.isFrozen(SOURCE_TEXT_RULE.fields) && Object.isFrozen(P.text.internalMarkers), '규칙 동결')
    // lib 신원표(runtime 강제)는 고정표의 기존 행을 그대로 담는다 — 기존 id 의 해시를 고치는 변경은 여기서 멈춘다
    for (const [id, h] of Object.entries(POLICY_HASHES)) assert(POLICY_IDENTITY_TABLE[id] === h, `lib 신원표의 ${id} 가 고정 해시와 다르다 — 기존 행을 고치지 말고 id 를 올린다`)
    assert(SOURCE_TEXT_RULE_HASH === ruleHash && Object.isFrozen(POLICY_IDENTITY_TABLE), 'lib 원문 규칙 해시 · 신원표 동결')
    // runtime 강제 — 정책 판 내용만 바꾼 lib 사본은 compile 이 POLICY_IDENTITY_DRIFT 로 멈춘다(사본은 임시 폴더 · 저장소 무변경)
    const libCopy = mkdtempSync(join(TMP, 'policy-drift-'))
    cpSync(join(HERE, 'lib'), libCopy, { recursive: true, filter: (src) => !src.split('/').some((x) => x.startsWith('.')) })
    const cpFile = join(libCopy, 'magazine-content-plan.mjs')
    const cpText = readFileSync(cpFile, 'utf8')
    const marker = "    internalMarkers: ['🔴', '🟠', '🟡', '🟢', '⚠', 'TODO', 'FIXME'],"
    assert(cpText.split(marker).length === 2, '정책 판 변이 지점이 정확히 1곳이 아니다')
    writeFileSync(cpFile, cpText.replace(marker, () => marker.replace("'FIXME']", "'FIXME', 'XXX']")))
    const bundleFile = join(libCopy, 'bundle.json'); writeFileSync(bundleFile, F.text)
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import { compileContentPlans } from ${JSON.stringify(`file://${cpFile}`)}; import { readFileSync } from 'node:fs'; try { compileContentPlans({ bundle: readFileSync(${JSON.stringify(bundleFile)}, 'utf8') }); console.log('NO_THROW') } catch (e) { console.log(e.code) }`], { encoding: 'utf8' })
    assert(probe.stdout.trim() === 'POLICY_IDENTITY_DRIFT', `id 를 올리지 않은 정책 판 변경이 runtime 에서 멈추지 않았다 (${probe.stdout.trim()} ${probe.stderr.slice(0, 200)})`)
  })

  await check('CP15', '실제 제품 파일 모양의 신원 투영 (읽기만)', async () => {
    const at = readFileSync(join(ROOT, 'src/content/magazine/articles.ts'), 'utf8')
    const a = parseArticleIdentityText(at)
    assert(a.ok && a.rows.length === parseArticlesSource(at).length, 'articles.ts 신원 투영 수')
    const qp = join(ROOT, 'drafts/magazine/topic-queue.ts')
    if (existsSync(qp)) {
      const qt = readFileSync(qp, 'utf8')
      const q = parseQueueIdentityText(qt)
      assert(q.ok && q.rows.length === parseQueueSource(qt).length, 'topic-queue.ts 신원 투영 수')
      assert(q.rows.every((r) => canonicalJson(Object.keys(r).sort()) === canonicalJson(['cluster', 'intentId', 'slug', 'titleKey'])), 'queue 투영 필드')
    }
    assert(!parseArticleIdentityText('const X = {}').ok && !parseQueueIdentityText('').ok, '앵커 없음은 실패')
  })

  await check('CP16', 'admission 출력 결정성 · 사유 순서 · release 신원', async () => {
    const a1 = admit(F), a2 = admit(F)
    assert(canonicalJson(a1) === canonicalJson(a2), '두 번 결과가 다르다')
    assert(a1.releaseIdentity.required === SLUG_BINDING_REQUIRED && a1.admitted.every((x) => x.releaseIdentity === SLUG_BINDING_REQUIRED), 'release 신원 요구')
    assert(a1.asOf === new Date(NOW).toISOString(), 'asOf 는 입력 시각')
    const many = admit(F, { control: { ...F.w.seed.control, enabledClusters: [] }, queue: [...F.w.seed.queue, { slug: 'fx-z', title: '합성 이력서 칸을 어떻게 채우나요', cluster: 'x', intentId: 'I-F1-01' }], inFlightIntentIds: ['I-F1-01'] })
    const r = heldOf(many, F.pid('I-F1-01'))
    assert(r.join() === [...r].sort((x, y) => REASON_ORDER.indexOf(x) - REASON_ORDER.indexOf(y)).join() && r.length === 4, `사유 순서 ${r}`)
    assert(!JSON.stringify(a1.admitted).includes('"slug":"I-') && a1.admitted.every((x) => !('publishAt' in x)), 'admission 이 날짜 · slug 신원을 만들었다')
  })
  await check('CP17', '공개 판정 단일 출처 — gate ≡ 순수 isPublicAt · nowMs 필수', async () => {
    assert(gate.KST_PUBLISH_TIME === publicRule.KST_PUBLISH_TIME && gate.resolvePublishAt === publicRule.resolvePublishAt, 'gate 가 public-rule 의 이름을 그대로 다시 내보내지 않는다(사본)')
    const rows = parseArticlesSource(readFileSync(join(ROOT, 'src/content/magazine/articles.ts'), 'utf8'))
    assert(rows.length > 0, 'articles 행 0 — 비교 대상이 없다')
    let compared = 0
    for (const a0 of rows) {
      for (const status of [a0.status, 'DRAFT', 'BLOCKED', 'SCHEDULED']) {
        const a = { ...a0, status }
        const at = publicRule.resolvePublishAt(a)
        const times = [Date.parse('2020-01-01T00:00:00Z'), Date.parse('2099-01-01T00:00:00Z'), ...(Number.isFinite(at) ? [at - 1, at, at + 1] : [])]
        for (const t of times) { assert(gate.isPublic(a, t) === publicRule.isPublicAt(a, t), `${a.slug} ${status} @${t}: gate ≠ isPublicAt`); compared++ }
      }
    }
    assert(compared >= rows.length * 8, `비교 수 ${compared}`)
    for (const bad of [undefined, NaN, Infinity, '1730000000000', null]) {
      let threw = false
      try { publicRule.isPublicAt(rows[0], bad) } catch (e) { threw = e instanceof TypeError }
      assert(threw, `isPublicAt 가 nowMs ${String(bad)} 를 받았다(벽시계 · 강제 변환으로 넘어간다)`)
    }
  })

  await check('CP19', 'CONTROL decoy — 가짜 선언이 실제 꺼짐 · kill switch 를 덮지 못한다 · 실제 0 · 2개는 fail-closed', async () => {
    const { graphVersion } = F.w
    const C = F.w.seed.control
    const open = { ...C, enabled: true, killSwitch: { ...C.killSwitch, tripped: false } }
    const lit = (c) => JSON.stringify({ graphVersion, enabled: c.enabled, enabledClusters: c.enabledClusters, surfaces: c.surfaces, killSwitch: c.killSwitch })
    const DECOYS = [
      ['line 주석', (g) => `// export const CONTROL = ${g}\n`],
      ['block 주석', (g) => `/*\nexport const CONTROL = ${g}\n*/\n`],
      ['작은따옴표 문자열', (g) => `const S1 = 'export const CONTROL = ${g}'\n`],
      ['큰따옴표 문자열', (g) => `const S2 = "export const CONTROL = ${g.replace(/"/g, '\\"')}"\n`],
      ['template literal', (g) => `const S3 = \`export const CONTROL = ${g}\`\n`],
      ['CONTROLLER', (g) => `export const CONTROLLER = ${g}\n`],
      ['CONTROL_EXTRA', (g) => `export const CONTROL_EXTRA = ${g}\n`],
    ]
    for (const [state, real, code] of [
      ['graph 꺼짐', { ...open, enabled: false }, 'GRAPH_DISABLED'],
      ['kill switch', { ...open, killSwitch: { ...open.killSwitch, tripped: true } }, 'KILL_SWITCH_TRIPPED'],
    ]) {
      for (const [label, decoy] of DECOYS) {
        const text = `${decoy(lit(open))}${controlText(graphVersion, real)}`
        const strict = parseGraphControl(text), legacy = parseControlText(text)
        assert(strict && strict.enabled === real.enabled && strict.killSwitch.tripped === real.killSwitch.tripped, `${state}/${label}: 엄격 판독이 가짜 선언을 읽었다 ${JSON.stringify(strict)}`)
        assert(legacy && legacy.enabled === real.enabled && legacy.killSwitchTripped === real.killSwitch.tripped, `${state}/${label}: legacy 판독이 가짜 선언을 읽었다 ${JSON.stringify(legacy)}`)
        const a = admit(F, { controlText: text })
        assert(a.admitted.length === 0 && a.held.every((h) => h.reasons.includes(code)), `${state}/${label}: admission 이 ${code} 로 멈추지 않았다`)
      }
    }
    // 실제 선언 0(가짜 · 부분 일치 이름만) · 실제 선언 2개 → 두 프로필 null · admission CONTROL_UNREADABLE
    const fakeOnly = DECOYS.map(([, d]) => d(lit(open))).join('')
    const twice = `${controlText(graphVersion, open)}${controlText(graphVersion, open).replace(/^import .*\n/m, '')}`
    for (const [label, text] of [['가짜 선언만', fakeOnly], ['실제 선언 2개', twice]]) {
      assert(parseGraphControl(text) === null && parseControlText(text) === null, `${label}: fail-closed 가 아니다`)
      const a = admit(F, { controlText: text })
      assert(a.admitted.length === 0 && a.held.every((h) => h.reasons.includes('CONTROL_UNREADABLE')), `${label}: admission 이 CONTROL_UNREADABLE 로 멈추지 않았다`)
    }
    // 대조군 — 실제 선언 뒤의 decoy 는 무관 · 열린 control 은 그대로 열린다
    const ok = `${controlText(graphVersion, open)}// export const CONTROL = ${lit({ ...open, enabled: false })}\n`
    assert(parseGraphControl(ok)?.enabled === true && parseControlText(ok)?.enabled === true && admit(F, { controlText: ok }).admitted.length === 3, '정상 control 대조군')
  })

  await check('CP20', '중복은 공개 · 예약 행만 — DRAFT · BLOCKED 는 막지 않는다 · 같은 cluster 비차단', async () => {
    const titleRow = (status, publishAt = '2026-12-01T10:30:00+09:00') => ({ slug: `fx-dup-${status.toLowerCase()}`, title: '합성 이력서 칸을, 어떻게 채우나요?', cluster: 'family', status, publishAt })
    for (const status of ['DRAFT', 'BLOCKED']) {
      const t = admit(F, { articles: [...F.w.seed.articles, titleRow(status)] })
      assert(admittedOf(t, F.pid('I-F1-01')), `${status} 같은 제목 행이 막았다 ${heldOf(t, F.pid('I-F1-01'))}`)
      const m = admit(F, { articles: F.w.seed.articles.map((x) => (x.slug === 'fx-registered' ? { ...x, status } : x)) })
      assert(!(heldOf(m, F.pid('I-F8-01')) ?? []).includes('DUPLICATE_MAPPED_ARTICLE'), `${status} mapping 행이 중복으로 막았다`)
    }
    for (const [status, at] of [['SCHEDULED', '2026-12-01T10:30:00+09:00'], ['PUBLISHED', '2026-10-01T10:30:00+09:00']]) {
      const t = admit(F, { articles: [...F.w.seed.articles, titleRow(status, at)] })
      assert(heldOf(t, F.pid('I-F1-01'))?.includes('DUPLICATE_ARTICLE_TITLE'), `${status} 같은 제목이 중복으로 잡히지 않았다`)
    }
    const reserved = admit(F, { articles: F.w.seed.articles.map((x) => (x.slug === 'fx-registered' ? { ...x, status: 'SCHEDULED', publishAt: '2026-12-24T10:30:00+09:00' } : x)) })
    assert(heldOf(reserved, F.pid('I-F8-01'))?.includes('DUPLICATE_MAPPED_ARTICLE'), '예약된 mapping 행이 중복으로 잡히지 않았다')
    const sameCluster = admit(F, { articles: [...F.w.seed.articles, { slug: 'fx-draft-mw', title: '합성 같은 cluster 초안', cluster: 'money-work', status: 'DRAFT', publishAt: '2026-12-01T10:30:00+09:00' },
      { slug: 'fx-sched-mw', title: '합성 같은 cluster 예약 다른 주제', cluster: 'money-work', publishAt: '2026-12-01T10:30:00+09:00' }] })
    assert(admittedOf(sameCluster, F.pid('I-F1-01')), '같은 cluster 의 다른 주제가 막았다(오탐)')
  })

  await check('CP21', '제3자 원문 경계 — 커뮤니티 제목을 옮긴 intent · 미검증 intent 는 ProviderPlan 0', async () => {
    const COMMUNITY = '✅ 82Cook 「40~50대 9명 모임 이름 추천해주세요」를 본 독자 상황'
    const doc = { query: 'PRIVATE-QUERY 합성 모임', organicTitle: '40~50대 9명 모임 이름 추천해주세요 ::: 82cook.com 자유게시판', domain: '82Cook' }
    const providerOf = async (mut) => {
      const G = await fresh((s) => { s.evidenceDocs['fx-community.json'] = doc; mut(s.intents.find((x) => x.intentId === 'I-F1-01')) })
      const plan = compileContentPlans({ bundle: G.text }).plans.find((p) => p.intentId === 'I-F1-01')
      const adm = plan && admit(G).admitted.find((x) => x.planId === plan.planId)
      assert(adm, 'I-F1-01 이 admission 을 통과하지 못했다 — 원문 경계 시험의 전제가 깨졌다')
      return { G, plan, adm, r: provide(G, plan) }
    }
    const hit = await providerOf((x) => { x.audienceSituation = COMMUNITY; x.sourceRefs = ['fx-a.json', 'fx-community.json'] })
    assert(hit.plan.textProvenance === 'THIRD_PARTY_TEXT' && !hit.r.ok && hit.r.providerPlan === null && hit.r.providerPlanHash === null
      && hit.r.problems.map((p) => p.code).join() === 'SOURCE_TEXT_THIRD_PARTY', `정확한 반례가 ProviderPlan 을 만들었다 ${JSON.stringify(hit.r.problems)}`)
    // 문구 스캔(2차)만으로는 이 문장을 못 잡는다 — 막는 것은 구조 판정이다(문구 denylist 를 더하지 않았다)
    const scanOnly = { primaryQuery: hit.plan.primaryQuery, audienceSituation: COMMUNITY, answerScope: hit.plan.answerScope, inclusions: [], exclusions: [...hit.plan.exclusions],
      validationProfile: hit.plan.validationProfile, forbiddenClaims: [...hit.plan.forbiddenClaims], cta: { ...hit.plan.cta }, relatedArticles: [], officialSourceUrls: [] }
    assert(providerPlanProblems(scanOnly).length === 0, `2차 스캔이 문구로 잡았다 — 구조 판정 시험이 아니게 된다 ${JSON.stringify(providerPlanProblems(scanOnly))}`)
    const unv = await providerOf((x) => { x.sourceRefs = [] })
    assert(unv.plan.textProvenance === 'UNVERIFIED' && !unv.r.ok && unv.r.problems.map((p) => p.code).join() === 'SOURCE_TEXT_UNVERIFIED', `미검증 intent ${JSON.stringify(unv.r.problems)}`)
    const clean = await providerOf(() => {})
    assert(clean.plan.textProvenance === 'CLEAR' && clean.r.ok && clean.r.providerPlan !== null, `CLEAR 대조군 ${JSON.stringify(clean.r.problems)}`)
    // 위장 — plan 을 넘길 길이 없다(모르는 입력) · 판정만 CLEAR 로 바꾼 plan 의 planHash 는 다시 컴파일한 plan 과 달라 낡은 plan 이다
    assert(codeOf(() => projectProviderPlan({ admission: admissionInput(hit.G), planId: hit.plan.planId, planHash: hit.plan.planHash, plan: { ...hit.plan, textProvenance: 'CLEAR' } })) === 'INPUT_UNKNOWN_KEY', 'plan 을 직접 넘겼다')
    const disguised = planHashOf({ ...hit.plan, textProvenance: 'CLEAR' })
    assert(provide(hit.G, hit.plan, {}, disguised).problems.map((p) => p.code).join() === 'PLAN_STALE', '판정 위장 planHash 가 통과했다')
  })
  await check('CP22', '데이터 전용 판독 · 원시 중복 · 잘못된 공개 시각 → fail-closed', async () => {
    const { graphVersion } = F.w
    const C = F.w.seed.control
    const realText = controlText(graphVersion, C)
    // ① control — JS 를 실행하지 않는다. 앞판 vm 평가라면 아래는 전부 "열린" control 로 읽혔다(중복 key 는 마지막 값이 이긴다)
    const killed = controlText(graphVersion, { ...C, killSwitch: { ...C.killSwitch, tripped: true } })
    const CONTROL_CASES = [
      ['중복 key(kill switch 두 번 — 뒤가 열림)', killed.replace(/killSwitch: (\{[^}]*\}),/, 'killSwitch: $1,\n  killSwitch: {"tripped":false},')],
      ['getter', realText.replace('enabled: true,', 'get enabled() { return true },')],
      ['함수 호출 값', realText.replace('enabled: true,', 'enabled: Boolean(1),')],
      ['spread', realText.replace('enabled: true,', '...{ enabled: true },')],
      ['계산 key', realText.replace('enabled: true,', '["enabled"]: true,')],
      ['식별자 값(undefined)', realText.replace('enabled: true,', 'enabled: true,\n  extra: undefined,')],
      ['template literal 값', realText.replace(`graphVersion: "${graphVersion}",`, `graphVersion: \`${graphVersion}\`,`)],
    ]
    for (const [label, text] of CONTROL_CASES) {
      assert(text !== realText && text !== killed, `${label}: 반례 텍스트가 바뀌지 않았다`)
      assert(parseGraphControl(text) === null && parseControlText(text) === null, `${label}: 데이터가 아닌 control 을 읽었다`)
      const a = admit(F, { controlText: text })
      assert(a.admitted.length === 0 && a.held.every((h) => h.reasons.includes('CONTROL_UNREADABLE')), `${label}: admission 이 CONTROL_UNREADABLE 로 멈추지 않았다`)
    }
    assert(parseGraphControl(realText)?.enabled === true && parseControlText(realText)?.killSwitchTripped === false, '대조군 — 정상 control')
    // ② articles — 같은 slug 두 번(뒤 행이 DRAFT 라 eval 이면 공개 행이 사라진다) · 가짜 선언 · 선언 2개 · 잘못된 시각
    const A = F.w.seed.articles
    const reg = A.find((x) => x.slug === 'fx-registered')
    const artCode = (text) => parseArticleIdentityText(text).code ?? 'OK'
    const dupSlug = articlesText([...A, { ...reg, status: 'DRAFT' }])
    assert(artCode(dupSlug) === 'ARTICLES_DUPLICATE_KEY', `같은 slug 두 번 ${artCode(dupSlug)}`)
    const dupAdm = admit(F, { articlesText: dupSlug })
    assert(dupAdm.admitted.length === 0 && dupAdm.held.every((h) => h.reasons.includes('ARTICLES_UNREADABLE')), '같은 slug 두 번이 admission 을 통과했다')
    const decoy = `// const MAGAZINE_ARTICLE_RECORD = {}\nconst S = 'const MAGAZINE_ARTICLE_RECORD = {}'\n${articlesText(A)}`
    const dec = parseArticleIdentityText(decoy)
    assert(dec.ok && dec.rows.length === A.length, `주석 · 문자열 속 가짜 선언을 읽었다 (${dec.code ?? dec.rows.length})`)
    assert(artCode(`${articlesText(A)}\nconst MAGAZINE_ARTICLE_RECORD = {}\n`) === 'ARTICLES_ANCHOR_AMBIGUOUS', '선언 2개')
    for (const [label, row] of [['해석 불가 시각', { ...reg, slug: 'fx-bad-time', publishAt: 'not-a-time' }], ['오프셋 없는 시각', { ...reg, slug: 'fx-local-time', publishAt: '2026-12-01T10:30:00' }]]) {
      assert(artCode(articlesText([...A, row])) === 'ARTICLES_PUBLISH_TIME_INVALID', `${label}: ${artCode(articlesText([...A, row]))}`)
      assert(admit(F, { articles: [...A, row] }).held.every((h) => h.reasons.includes('ARTICLES_UNREADABLE')), `${label}: admission 이 멈추지 않았다`)
      assert(artCode(articlesText([...A, { ...row, status: 'DRAFT' }])) === 'OK', `${label}: DRAFT 행의 시각은 공개 판정에 쓰지 않는다(오탐)`)
    }
    // ③ legacy queue — 한 행의 같은 필드 두 번 · 같은 slug 두 행 · 가짜 선언 · 신원 형식
    const Q = F.w.seed.queue
    const qCode = (text) => parseQueueIdentityText(text).code ?? 'OK'
    const qt = queueText(Q)
    assert(qCode(qt.replace('{"day":1,', '{"day":1,"slug":"fx-shadow",')) === 'QUEUE_DUPLICATE_KEY', '한 행의 slug 두 번')
    assert(qCode(queueText([...Q, { ...Q[0], title: '다른 제목' }])) === 'QUEUE_DUPLICATE_SLUG', '같은 slug 두 행')
    assert(qCode(queueText([...Q, { slug: 'fx-q-num', title: 'x', intentId: 7 }])) === 'QUEUE_UNREADABLE', 'intentId 형식')
    const qdec = parseQueueIdentityText(`// export const TOPIC_QUEUE = []\n${qt}`)
    assert(qdec.ok && qdec.rows.length === Q.length, `queue 가짜 선언을 읽었다 (${qdec.code ?? qdec.rows.length})`)
    for (const text of [qt.replace('{"day":1,', '{"day":1,"slug":"fx-shadow",'), queueText([...Q, { ...Q[0], title: '다른 제목' }])]) {
      const qa = admit(F, { legacyQueue: { active: true, text } })
      assert(qa.admitted.length === 0 && qa.held.every((h) => h.reasons.includes('QUEUE_IDENTITY_UNREADABLE')), 'queue 원시 중복이 admission 을 통과했다')
    }
  })

  await check('CP23', 'ProviderPlan 도출 — 호출자 값 불신 · 낡은 plan · 미승인 · 관련 글은 articles 에서만', async () => {
    const plan = base.plans.find((p) => p.intentId === 'I-F1-01')
    const codes = (r) => r.problems.map((p) => p.code).join()
    // 낡은 planHash — 임의 값 · 다른 정책 판으로 컴파일된 plan · Bundle 내용이 바뀐 뒤의 plan
    assert(codes(provide(F, plan, {}, '0'.repeat(64))) === 'PLAN_STALE', '임의 planHash')
    const oldBoard = planHashOf({ ...plan, policyBoard: { id: 'magazine-content-plan-policy/0', hash: '0'.repeat(64) } })
    assert(codes(provide(F, plan, {}, oldBoard)) === 'PLAN_STALE', '다른 정책 판의 plan 이 통과했다')
    const changed = edit(F.text, (b) => { const x = b.intents.find((i) => i.intentId === 'I-F1-01'); x.answerScope = `${x.answerScope} 합성 변경` })
    assert(codes(provide(F, plan, { bundle: changed })) === 'PLAN_STALE', 'Bundle 내용이 바뀐 뒤의 plan 이 통과했다')
    // 미컴파일 · 미승인 · 입력 형식
    assert(codes(projectProviderPlan({ admission: admissionInput(F), planId: `${F.w.graphVersion}:I-NOPE-01`, planHash: plan.planHash })) === 'PLAN_NOT_COMPILED', '미컴파일 plan')
    const held = base.plans.find((p) => p.intentId === 'I-F3-01')
    assert(codes(provide(F, held)) === 'NOT_ADMITTED', 'admission HOLD plan 이 ProviderPlan 을 만들었다')
    assert(codeOf(() => projectProviderPlan({ admission: admissionInput(F), planId: plan.planId, planHash: 'x' })) === 'INPUT_INVALID', 'planHash 형식')
    // 호출자 값 주입 길 0 — plan · admitted(relatedPublic · title) 를 넘기면 모르는 입력
    for (const k of ['plan', 'admitted', 'relatedPublic']) {
      assert(codeOf(() => projectProviderPlan({ admission: admissionInput(F), planId: plan.planId, planHash: plan.planHash, [k]: {} })) === 'INPUT_UNKNOWN_KEY', `${k} 를 받았다`)
    }
    // 관련 글 title 은 그 시각 articles.ts 의 값 — 제목을 바꾼 articles 로 admission 하면 그 제목이 실린다(호출자 값이 아니다)
    const renamed = F.w.seed.articles.map((x) => (x.slug === 'fx-next' ? { ...x, title: '합성 바뀐 관련 글 제목' } : x))
    const rr = provide(F, plan, { articles: renamed })
    assert(rr.ok && rr.providerPlan.relatedArticles.find((x) => x.slug === 'fx-next')?.title === '합성 바뀐 관련 글 제목', `관련 글 제목 도출 ${JSON.stringify(rr.problems)}`)
    // 관련 글이 공개 전이면(시각) 관련 글에 싣지 않는다 — 그 시각 admission 의 도출
    const early = provide(F, plan, { nowMs: Date.parse('2026-10-01T00:00:00+09:00') })
    assert(!early.ok && codes(early) === 'NOT_ADMITTED', '대상 공개 전 시각에 ProviderPlan 을 만들었다')
  })
  await check('CP24', '엄격 공개 시각 — 달력에 없는 날 · 평년 2/29 · 24:00 · 범위 밖 오프셋은 거부(Date.parse 정규화 불신) · 규칙 하나', async () => {
    const T = publicRule.strictOffsetTimeMs
    for (const bad of ['2026-02-30T10:30:00+09:00', '2026-02-29T10:30:00+09:00', '2026-12-01T24:00:00+09:00', '2026-13-01T10:30:00+09:00', '2026-00-10T10:30:00+09:00',
      '2026-04-31T10:30:00+09:00', '2026-12-01T10:60:00+09:00', '2026-12-01T10:30:60+09:00', '2026-12-01T10:30:00+15:00', '2026-12-01T10:30:00+09:60', '2026-12-01T10:30:00', '2026-12-01', 'x', null,
      '2026-12-01T10:30:00+14:01', '2026-12-01T10:30:00-14:59']) {
      assert(Number.isNaN(T(bad)), `${bad} 를 받았다`)
    }
    assert(Number.isFinite(Date.parse('2026-02-30T10:30:00+09:00')), '전제 — Date.parse 는 2/30 을 정규화해 받는다(이 반례가 의미 있는 이유)')
    assert(Number.isFinite(Date.parse('2026-12-01T10:30:00+14:01')) && Number.isFinite(Date.parse('2026-12-01T10:30:00-14:59')), '전제 — Date.parse 는 ±14:00 밖 오프셋도 받는다(이 반례가 의미 있는 이유)')
    for (const ok of ['2028-02-29T10:30:00+09:00', '2026-12-31T23:59:59.999Z', '2026-11-11T00:00:00-05:30', '2026-11-11T10:30+09:00', '2000-02-29T10:30:00+09:00',
      '2026-12-01T10:30:00+14:00', '2026-12-01T10:30:00-14:00']) {
      assert(T(ok) === Date.parse(ok), `${ok}: 엄격 ${T(ok)} ≠ Date.parse ${Date.parse(ok)}`)
    }
    // 실제 articles 전 행 — 엄격 판독이 legacy 해석과 같은 ms 다(현행 데이터는 전부 유효)
    for (const a of parseArticlesSource(readFileSync(join(ROOT, 'src/content/magazine/articles.ts'), 'utf8'))) {
      assert(publicRule.strictPublishAtMs(a) === publicRule.resolvePublishAt(a), `${a.slug}: 엄격 ${publicRule.strictPublishAtMs(a)} ≠ legacy ${publicRule.resolvePublishAt(a)}`)
    }
    // articles 신원 투영 — publishAt · publishedAt 둘 다 같은 규칙
    const rec = (row) => `const MAGAZINE_ARTICLE_RECORD = { 'fx-a': ${JSON.stringify({ title: '합성', ...row })} }\n`
    for (const row of [{ publishAt: '2026-02-30T10:30:00+09:00' }, { publishAt: '2026-02-29T10:30:00+09:00' }, { publishAt: '2026-12-01T24:00:00+09:00' }, { publishedAt: '2026-02-30' }, { publishedAt: '2026-02-29' }, { publishedAt: '2026-2-1' }]) {
      assert(parseArticleIdentityText(rec(row)).code === 'ARTICLES_PUBLISH_TIME_INVALID', `${JSON.stringify(row)} 가 통과했다`)
      assert(parseArticleIdentityText(rec({ ...row, status: 'DRAFT' })).ok, `${JSON.stringify(row)} DRAFT 행은 공개 판정에 쓰지 않는다(오탐)`)
    }
    assert(parseArticleIdentityText(rec({ publishedAt: '2028-02-29' })).ok && parseArticleIdentityText(rec({ publishAt: '2028-02-29T10:30:00+09:00' })).ok, '윤년 2/29 는 유효')
    // bootstrap --admission-as-of 도 같은 규칙
    const w = makeWorld(mkdtempSync(join(TMP, `w${n++}-`)))
    for (const [asOf, okWant] of [['2026-02-30T10:30:00+09:00', false], ['2026-11-10T24:00:00+09:00', false], ['2026-11-10T17:00:00+09:00', true]]) {
      const r = await bootWorld(w, { admissionAsOf: asOf })
      assert(okWant ? r.ok : (!r.ok && r.code === 'ADMISSION_AS_OF_INVALID'), `--admission-as-of ${asOf}: ${r.ok ? 'ok' : r.code}`)
    }
  })

  await check('CP25', 'same-release 정확 신원 중복 — 같은 정규화 제목 · canonical mapping slug 를 공유하는 후보는 하나만(planId 최소) · 입력 순서 무관', async () => {
    const pF1 = F.pid('I-F1-01'), pF22 = F.pid('I-F2-02'), pF21 = F.pid('I-F2-01')
    const q = (b, id) => b.intents.find((x) => x.intentId === id)
    const base1 = admit(F)
    assert(admittedOf(base1, pF1) && admittedOf(base1, pF22), '전제 — 두 후보가 함께 admitted')
    const verdict = (a) => [admittedOf(a, pF1) ? 'A' : heldOf(a, pF1).join('+'), admittedOf(a, pF22) ? 'A' : heldOf(a, pF22).join('+')].join('|')
    // ① 같은 정규화 제목 — 어느 쪽 문장을 복사하든 planId 최소(I-F1-01)만 남는다
    const t1 = edit(F.text, (b) => { q(b, 'I-F2-02').primaryQuery = `${q(b, 'I-F1-01').primaryQuery}?!` })
    const t2 = edit(F.text, (b) => { q(b, 'I-F1-01').primaryQuery = `  ${q(b, 'I-F2-02').primaryQuery.toUpperCase()} ` })
    for (const [label, t] of [['F2-02 ← F1-01 제목', t1], ['F1-01 ← F2-02 제목', t2]]) {
      const a = admit(F, { bundle: t })
      assert(verdict(a) === 'A|DUPLICATE_SAME_RELEASE', `${label}: ${verdict(a)}`)
      assert(a.admitted.filter((x) => [pF1, pF22].includes(x.planId)).length === 1, `${label}: 같은 신원 후보가 둘 다 admitted`)
    }
    // ② 같은 canonical mapping slug(아직 공개 글 없음)
    const sl = edit(F.text, (b) => { b.mappings.push({ intentId: 'I-F1-01', slug: 'fx-shared' }, { intentId: 'I-F2-02', slug: 'fx-shared' }); b.mappings.sort((x, y) => (`${x.intentId}\u0000${x.slug}` < `${y.intentId}\u0000${y.slug}` ? -1 : 1)) })
    assert(verdict(admit(F, { bundle: sl })) === 'A|DUPLICATE_SAME_RELEASE', `mapping slug 공유 ${verdict(admit(F, { bundle: sl }))}`)
    // ③ 연쇄(제목 F1~F2-02 · slug F2-02~F2-01) — 묶음 하나에서 최소 하나만
    const chain = edit(t1, (b) => { b.mappings.push({ intentId: 'I-F2-01', slug: 'fx-chain' }, { intentId: 'I-F2-02', slug: 'fx-chain' }); b.mappings.sort((x, y) => (`${x.intentId}\u0000${x.slug}` < `${y.intentId}\u0000${y.slug}` ? -1 : 1)) })
    const ac = admit(F, { bundle: chain })
    assert(admittedOf(ac, pF1) && heldOf(ac, pF22)?.includes('DUPLICATE_SAME_RELEASE') && heldOf(ac, pF21)?.includes('DUPLICATE_SAME_RELEASE'), `연쇄 ${JSON.stringify([heldOf(ac, pF22), heldOf(ac, pF21)])}`)
    // ④ 순열 — Bundle 키 순서 · 진행 중/철회 배열 순서가 결과를 바꾸지 않는다
    const reversed = (v) => (Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v)
    const ref = canonicalJson(admit(F, { bundle: t1, inFlightIntentIds: ['I-F3-01', 'I-F4-01'] }))
    assert(canonicalJson(admit(F, { bundle: reversed(JSON.parse(t1)), inFlightIntentIds: ['I-F4-01', 'I-F3-01'] })) === ref, '입력 순서가 결과를 바꿨다')
    // 대조군 — 정확히 같지 않은 비슷한 제목은 막지 않는다
    const near = edit(F.text, (b) => { q(b, 'I-F2-02').primaryQuery = `${q(b, 'I-F1-01').primaryQuery} 두 번째` })
    assert(verdict(admit(F, { bundle: near })) === 'A|A', `비슷한 제목이 막혔다 ${verdict(admit(F, { bundle: near }))}`)
  })

  await check('CP26', 'ProviderPlan 계좌 PII — 공백 · NBSP · 대시 · 이어 쓴 숫자 · 중첩 위치 → 산출 0 · 날짜 · 짧은 수는 통과', async () => {
    const projected = (mut) => {
      const text = edit(F.text, (b) => mut(b.intents.find((x) => x.intentId === 'I-F1-01')))
      const p = compileContentPlans({ bundle: text }).plans.find((x) => x.intentId === 'I-F1-01')
      return provide(F, p, { bundle: text })
    }
    for (const [label, mut] of [
      ['공백 구분', (x) => { x.answerScope = '계좌 110 123 456789 로 보내주세요' }],
      ['NBSP 구분', (x) => { x.answerScope = '계좌 110 123 456789 로' }],
      ['유니코드 대시', (x) => { x.answerScope = '계좌 110–123–456789 로' }],
      ['이어 쓴 12자리', (x) => { x.answerScope = '110123456789' }],
      ['중첩(exclusions 배열)', (x) => { x.exclusions = ['다른 독자', '입금 3333 01 1234567 안내'] }],
      ['중첩(forbiddenClaims)', (x) => { x.forbiddenClaims = ['1002345678901 로 보내라'] }],
    ]) {
      const r = projected(mut)
      assert(!r.ok && r.providerPlan === null && r.providerPlanHash === null && r.problems.some((p) => p.code === 'PII_ACCOUNT'), `${label}: ${JSON.stringify(r.problems)}`)
    }
    for (const [label, mut] of [
      ['날짜', (x) => { x.answerScope = `${x.answerScope} 2026-11-15 · 2026.11.15 · 20261115 기준` }],
      ['짧은 수', (x) => { x.answerScope = `${x.answerScope} 10만 원 · 3명 · 12345 · 1,000,000원` }],
    ]) {
      const r = projected(mut)
      assert(r.ok && r.providerPlan !== null, `${label}: 대조군이 막혔다 ${JSON.stringify(r.problems)}`)
    }
  })

  await check('CP27', '희소 배열 — 빈 칸은 canonical 해시 · 모양 판정 전에 구조화 거부(Array(1) ≠ [])', async () => {
    assert(codeOf(() => canonicalJson(Array(1))) === 'CANONICAL_JSON_INVALID' && codeOf(() => canonicalJson([, 'a'])) === 'CANONICAL_JSON_INVALID', 'canonicalJson 이 빈 칸을 받았다')
    assert(canonicalJson([]) === '[]' && canonicalJson([null]) === '[null]', '대조군 — 빈 배열 · null 은 다르다')
    const holed = (len, at, fill = 'x') => { const a = []; for (let i = 0; i < len; i++) if (i !== at) a[i] = fill; a.length = len; return a }
    for (const [label, mut] of [
      ['inclusions', (b) => { b.intents[0].inclusions = Array(1) }],
      ['exclusions', (b) => { b.intents[0].exclusions = holed(3, 1) }],
      ['forbiddenClaims', (b) => { b.intents[0].forbiddenClaims = holed(2, 0) }],
      ['relation evidence refs', (b) => { const r0 = b.relations[0].evidence.refs[0]; b.relations[0].evidence.refs = holed(2, 1, r0) }],
      ['intents 배열 자체', (b) => { b.intents.length += 1 }],
      ['mappings', (b) => { b.mappings.length += 2 }],
    ]) {
      const b = JSON.parse(F.text); mut(b)
      const c1 = (() => { try { parsePI(b); return 'OK' } catch (e) { return `${e.code}:${e.why}` } })()
      assert(c1.startsWith('BUNDLE_SCHEMA:') && c1.includes('희소'), `${label}: 판독 ${c1}`)
      assert(codeOf(() => compileContentPlans({ bundle: b })) === 'BUNDLE_SCHEMA', `${label}: 컴파일`)
      assert(codeOf(() => admitContentPlans({ ...admissionInput(F), bundle: b })) === 'BUNDLE_SCHEMA', `${label}: admission`)
    }
    const plan = JSON.parse(JSON.stringify(base.plans[0])); plan.exclusions = holed(2, 0)
    assert(codeOf(() => assertContentPlan(plan)) === 'CANONICAL_JSON_INVALID', 'ContentPlan 의 빈 칸')
    assert(codeOf(() => admit(F, { inFlightIntentIds: holed(2, 0, 'I-F1-01') })) === 'INPUT_INVALID', '진행 중 신원 배열의 빈 칸')
  })

  await check('CP28', 'Article 출처(release) — 엄격 판독 · 출시 intent 중복 · 상태/판 무관 · intent 단위 진행 중 · 대상 신원 · planHash 불변 (S3 P1)', async () => {
    const P = CONTENT_PLAN_POLICY_BOARD
    const rel = (intentId, over = {}) => ({ schemaVersion: ARTICLE_RELEASE_SCHEMA, intentId, graphVersion: F.w.graphVersion,
      bundleHash: JSON.parse(F.text).bundleHash, planHash: 'a'.repeat(64), policyBoard: { id: P.id, hash: POLICY_BOARD_HASH }, ...over })
    const PAST = '2026-11-01T10:30:00+09:00', FUTURE = '2026-12-24T10:30:00+09:00'
    const row = (slug, release, over = {}) => ({ slug, title: `합성 출시 글 ${slug}`, cluster: 'money-work', publishAt: PAST, release, ...over })
    const withRows = (...rows) => articlesText([...F.w.seed.articles, ...rows])
    const parsed = (...rows) => parseArticleIdentityText(withRows(...rows))
    const allHeld = (a, code) => a.admitted.length === 0 && a.held.length > 0 && a.held.every((h) => h.reasons.includes(code))
    // 대조군 — 올바른 출처는 통과하고 신원만 투영한다
    const good = parsed(row('fx-v1', rel('I-F1-01')))
    assert(good.ok && canonicalJson(good.rows.find((r) => r.slug === 'fx-v1').release) === canonicalJson({ intentId: 'I-F1-01', graphVersion: F.w.graphVersion,
      bundleHash: JSON.parse(F.text).bundleHash, planHash: 'a'.repeat(64), policyBoard: { id: P.id, hash: POLICY_BOARD_HASH } }), `올바른 출처 ${JSON.stringify(good)}`)
    assert(good.rows.filter((r) => r.release).length === 1 && good.rows.filter((r) => r.release === null).length === F.w.seed.articles.length, 'legacy 행은 release null')
    // ① 엄격 schema — 하나라도 어긋나면 ARTICLES_RELEASE_INVALID → admission 전체 ARTICLES_UNREADABLE
    const otherId = Object.keys(POLICY_IDENTITY_TABLE).find((k) => !k.startsWith('magazine-content-plan-policy/'))
    const BAD = [
      ['키 초과', { ...rel('I-F1-01'), publishAt: PAST }],
      ['planId 저장', { ...rel('I-F1-01'), planId: F.pid('I-F1-01') }],
      ...ARTICLE_RELEASE_KEYS.map((k) => [`${k} 누락`, (() => { const r = rel('I-F1-01'); delete r[k]; return r })()]),
      ['미래 schema', rel('I-F1-01', { schemaVersion: 'magazine-article-release/2' })],
      ['빈 intentId', rel('')], ['공백 intentId', rel(' I-F1-01')],
      ['graphVersion 형식', rel('I-F1-01', { graphVersion: 'g-2026-bad' })],
      ['bundleHash 대문자', rel('I-F1-01', { bundleHash: 'A'.repeat(64) })], ['bundleHash 63자', rel('I-F1-01', { bundleHash: 'a'.repeat(63) })],
      ['planHash hex 아님', rel('I-F1-01', { planHash: 'z'.repeat(64) })],
      ['정책 키 초과', rel('I-F1-01', { policyBoard: { id: P.id, hash: POLICY_BOARD_HASH, x: 1 } })],
      ['정책 hash 누락', rel('I-F1-01', { policyBoard: { id: P.id } })],
      ['모르는 정책 id', rel('I-F1-01', { policyBoard: { id: 'magazine-content-plan-policy/99', hash: POLICY_BOARD_HASH } })],
      ['정책 판 아닌 알려진 id', rel('I-F1-01', { policyBoard: { id: otherId, hash: POLICY_IDENTITY_TABLE[otherId] } })],
      ['id · hash 불일치', rel('I-F1-01', { policyBoard: { id: P.id, hash: 'b'.repeat(64) } })],
      ['release null', null], ['release 배열', [rel('I-F1-01')]], ['release 문자열', 'I-F1-01'],
    ]
    assert(BAD.length >= 20 && otherId, `반례 수 ${BAD.length}`)
    for (const [label, r] of BAD) {
      const p = parsed(row('fx-v1', r))
      assert(!p.ok && p.code === 'ARTICLES_RELEASE_INVALID', `${label}: ${JSON.stringify(p).slice(0, 120)}`)
      assert(allHeld(admit(F, { articlesText: withRows(row('fx-v1', r)) }), 'ARTICLES_UNREADABLE'), `${label}: admission 이 열렸다`)
    }
    // ② 같은 release.intentId 두 행 — 상태가 달라도(PUBLISHED · DRAFT) 전체 실패
    const dupText = withRows(row('fx-v1', rel('I-F1-01'), { status: 'PUBLISHED' }), row('fx-v2', rel('I-F1-01', { graphVersion: 'g-20260101-abcdef' }), { status: 'DRAFT' }))
    assert(parseArticleIdentityText(dupText).code === 'ARTICLES_RELEASE_DUPLICATE_INTENT', '출처 intent 중복이 통과했다')
    assert(allHeld(admit(F, { articlesText: dupText }), 'ARTICLES_UNREADABLE'), '출처 intent 중복에서 admission 이 열렸다')
    // ③ 이미 출시된 intent — 상태 · graphVersion 과 무관하게 DUPLICATE_RELEASED_INTENT
    assert(admittedOf(admit(F), F.pid('I-F1-01')), '전제 — I-F1-01 이 기본 admission 을 통과한다')
    for (const [status, publishAt] of [['PUBLISHED', PAST], ['SCHEDULED', FUTURE], ['DRAFT', FUTURE], ['BLOCKED', PAST]]) {
      for (const gv of [F.w.graphVersion, 'g-20260101-abcdef']) {
        const a = admit(F, { articles: [...F.w.seed.articles, row('fx-v1', rel('I-F1-01', { graphVersion: gv }), { status, publishAt })] })
        assert(heldOf(a, F.pid('I-F1-01'))?.join() === 'DUPLICATE_RELEASED_INTENT', `${status} · ${gv}: ${heldOf(a, F.pid('I-F1-01'))}`)
        assert(admittedOf(a, F.pid('I-F2-01')) && admittedOf(a, F.pid('I-F2-02')), `${status}: 다른 intent 까지 막았다`)
      }
    }
    // ④ revert 로 행이 사라지면 다시 받아들인다
    assert(admittedOf(admit(F, { articles: F.w.seed.articles }), F.pid('I-F1-01')), 'revert 뒤에도 막혔다')
    // ⑤ 옛 키 거부 · 진행 중은 intent 단위
    assert(codeOf(() => admitContentPlans({ ...admissionInput(F), inFlightPlanIds: [] })) === 'INPUT_UNKNOWN_KEY', '옛 키 inFlightPlanIds 를 조용히 받았다')
    assert(codeOf(() => projectProviderPlan({ admission: { ...admissionInput(F), inFlightPlanIds: [] }, planId: base.plans[0].planId, planHash: base.plans[0].planHash })) === 'INPUT_UNKNOWN_KEY', 'ProviderPlan 경로가 옛 키를 받았다')
    assert(heldOf(admit(F, { inFlightIntentIds: ['I-F1-01'] }), F.pid('I-F1-01'))?.join() === 'IN_FLIGHT', 'intent 진행 중이 막지 않았다')
    for (const asPlanId of [F.pid('I-F1-01'), 'g-20260101-abcdef:I-F1-01']) {
      assert(admittedOf(admit(F, { inFlightIntentIds: [asPlanId] }), F.pid('I-F1-01')), `planId(${asPlanId}) 로 진행 중을 판정했다 — intent 로 비교해야 한다`)
    }
    // ⑥ planHash 불변 — articles(출처 포함)는 컴파일 입력이 아니다
    assert(codeOf(() => compileContentPlans({ bundle: F.text, articlesText: withRows(row('fx-v1', rel('I-F1-01'))) })) === 'INPUT_UNKNOWN_KEY', 'compile 이 articles 를 받았다')
    const hashesOf = (a) => canonicalJson([...a.admitted, ...a.held].map((x) => [x.planId, x.planHash]).sort())
    const want = canonicalJson(base.plans.map((p) => [p.planId, p.planHash]).sort())
    for (const rows of [[], [row('fx-v1', rel('I-F1-01'))], [row('fx-v43', rel('I-F4-03'))], [row('fx-v1', rel('I-F1-01'), { status: 'BLOCKED' })]]) {
      assert(hashesOf(admit(F, { articles: [...F.w.seed.articles, ...rows] })) === want, `articles 가 planHash 를 바꿨다 (${rows.map((r) => r.slug)})`)
    }
    // ⑦ 대상 신원 — mapping 이 없는 intent 도 공개된 출처 행이면 대상이 된다 · 공개 전 · DRAFT 는 아니다 · 둘 이상이면 고르지 않는다
    const base4 = admit(F)
    assert(!admittedOf(base4, F.pid('I-F4-02')), '전제 — I-F4-02 는 공개 대상이 없어 기본 admission 에서 빠진다')
    const via = admit(F, { articles: [...F.w.seed.articles, row('fx-v43', rel('I-F4-03'))] })
    const g42 = admittedOf(via, F.pid('I-F4-02'))
    assert(g42 && g42.layer === 1 && canonicalJson(g42.groundedBy) === canonicalJson([{ edgeId: 'E-0041', toIntentId: 'I-F4-03', target: 'PUBLIC', slug: 'fx-v43' }]), `출처 대상 ${JSON.stringify(g42)}`)
    assert(admittedOf(via, F.pid('I-F4-01'))?.layer === 2, '출처 대상 위의 연쇄')
    for (const [label, over] of [['예약', { status: 'SCHEDULED', publishAt: FUTURE }], ['DRAFT', { status: 'DRAFT' }], ['BLOCKED', { status: 'BLOCKED' }]]) {
      assert(!admittedOf(admit(F, { articles: [...F.w.seed.articles, row('fx-v43', rel('I-F4-03'), over)] }), F.pid('I-F4-02')), `${label} 출처 행을 공개 대상으로 셌다`)
    }
    const sortMaps = (b) => b.mappings.sort((x, y) => (`${x.intentId}\u0000${x.slug}` < `${y.intentId}\u0000${y.slug}` ? -1 : 1))
    const two = edit(F.text, (b) => { b.mappings.push({ intentId: 'I-F4-03', slug: 'fx-m43' }); sortMaps(b) })
    const amb = admit(F, { bundle: two, articles: [...F.w.seed.articles, row('fx-v43', rel('I-F4-03')), row('fx-m43', undefined, { title: '합성 mapping 글 43' })].map((r) => (r.release === undefined ? (({ release, ...x }) => x)(r) : r)) })
    assert(!admittedOf(amb, F.pid('I-F4-02')), 'mapping slug 와 출처 slug 가 둘 다 공개인데 하나를 골랐다')
    const same = edit(F.text, (b) => { b.mappings.push({ intentId: 'I-F4-03', slug: 'fx-v43' }); sortMaps(b) })
    assert(admittedOf(admit(F, { bundle: same, articles: [...F.w.seed.articles, row('fx-v43', rel('I-F4-03'))] }), F.pid('I-F4-02')), '같은 slug 를 둘로 셌다(중복 제거)')
    // ⑧ 실제 제품 articles.ts — 출처 없는 legacy 57편 그대로 판독
    const real = parseArticleIdentityText(readFileSync(join(ROOT, 'src/content/magazine/articles.ts'), 'utf8'))
    assert(real.ok && real.rows.every((r) => r.release === null), `실제 articles 출처 ${real.ok ? real.rows.filter((r) => r.release).length : real.code}`)
  })

} finally {
  cleanupFixtureBootstrap()
  rmSync(TMP, { recursive: true, force: true })
}
console.log(`\ncontent-plan 검사: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
