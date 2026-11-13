/**
 * Magazine vNext S2 — ContentPlan **정적 컴파일** · **동적 admission** · ProviderPlan 투영 (charter §18-B · runbook §0.0B.1).
 *
 * 세 단계를 섞지 않는다 (2026-11-10 Codex 결정 D1 · D3 · D4 · D5)
 *   compileContentPlans  정적. 입력은 엄격 판독한 Bundle 과 이 파일의 정책 판(CONTENT_PLAN_POLICY_BOARD)뿐이다.
 *                        🔴 control · 현재 articles · legacy queue · 시각 · 진행 중 신원 · slug · provider · job · 경로 · PR · release · 승인은
 *                        planHash 에 들어가지 않는다. 같은 Bundle + 같은 정책 판 = 같은 planHash.
 *                        ContentPlan 은 날짜도 slug 도 없다 — `<graphVersion>:<intentId>` 로 식별한다.
 *   admitContentPlans    동적. 현재 control(엄격 판독) · articles · legacy queue 신원 투영 · 시각 · 진행 중 신원으로 출판 최소의
 *                        나머지(중복 0 · 공개/같은 release 대상 · 표면 · cluster)를 판정한다. 결과는 바뀔 수 있어도 planHash 는 그대로다.
 *                        S3 release 는 merge 직전에 같은 admission 을 다시 돌린다.
 *   projectProviderPlan  호출자 plan · admission 값을 받지 않는다 — 같은 admission 입력으로 봉인된 Bundle 에서 다시 도출하고 job 의 planHash 와
 *                        대조한다(낡은 내용 · 정책 판이면 PLAN_STALE). 허용 목록으로 새 객체를 만든 뒤 exact-key 를 확인하고, 재귀로 PII ·
 *                        내부 표식 · 원문 근거 · 경로 · token · query/fragment 가 붙은 URL 을 훑는다. 하나라도 걸리면 ProviderPlan 0.
 * 🔴 정책 신원표(POLICY_IDENTITY_TABLE)가 정책 판 · 원문 경계 규칙의 내용을 id 별로 고정한다 — 다르면 compile 부터 POLICY_IDENTITY_DRIFT(P1-G).
 * 🔴 articles · legacy queue 판독은 graph-control 의 토큰 선언 찾기 + 데이터 전용 판독 한 벌이다 — JS 실행 0 · 원시 중복 key · 같은 slug ·
 *    공개/예약 행의 잘못된 공개 시각은 fail-closed(P1-B · P1-D).
 *
 * 🔴 순수 모듈 — node:fs · cwd · env · 벽시계 · 네트워크 · provider SDK · queue 쓰기 · 초안/HOLD/격리 판독 0. 텍스트만 받는다.
 *    import 허용 목록과 금지 토큰은 경계 검사 R17 이 **전이 폐포**(이 파일이 부르는 모듈이 부르는 모듈까지)로 본다.
 *    공개 판정은 gate(fs · cwd · 벽시계 기본값)가 아니라 import 0 의 `magazine-public-rule.mjs` 를 쓴다(P1-C).
 * 🔴 legacy queue 는 **임시 중복 신원 오라클**로만 읽는다(intentId · slug · 정규화 제목 · cluster). 초안·HOLD·격리 바이트를 승계하지 않고,
 *    queue 를 쓰지 않는다. legacy 가 남아 있는 동안 queue 파일이 없거나 앵커를 못 찾으면 fail-closed 다.
 * 🔴 slug 는 여기서 만들지 않는다. stable slug 는 S3 의 vNext release 신원 경계가 묶는다 — admission 은 그 요구를
 *    `SLUG_BINDING_REQUIRED` 로 드러낼 뿐 ContentPlan 필드로 두지 않는다. 현재 queue 기반 G8 workflow 는 부르지 않는다.
 */
import { createHash } from 'node:crypto'

import { GRAPH_VERSION_RE, SOURCE_TEXT_RULE, TEXT_PROVENANCE, canonicalJson, byCodeUnit, isDense, parsePlanInputBundle } from './magazine-content-plan-input.mjs'
import { isHeldStatus, isPublicAt, strictPublishAtMs } from './magazine-public-rule.mjs'
import { ControlLocateError, locateConstLiteral, parseDataLiteral, parseGraphControl } from './magazine-graph-control.mjs'
import { BANNED_WORDS } from './magazine-qa-constants.mjs'
import { RELATION_DISPLAY_TARGET, VNEXT_PUBLICATION_RELATION_MINIMUM } from './magazine-relation-policy.mjs'

export const CONTENT_PLAN_SCHEMA = 'magazine-content-plan/1'
export const COMPILE_SCHEMA = 'magazine-content-plan-compile/1'
export const ADMISSION_SCHEMA = 'magazine-plan-admission/1'
/** S3 release 신원 경계가 stable slug 를 묶어야 한다는 요구 — ContentPlan 필드가 아니다 */
export const SLUG_BINDING_REQUIRED = 'SLUG_BINDING_REQUIRED'
/**
 * Article 행의 vNext 출처(`release`) schema — S3 P1. 공개 신원(intentId ↔ slug)의 merge 뒤 유일한 권위는 Article 행 자신이다
 * (별도 release-identity 파일 · releasedIdentityText 입력 없음). 출처는 신원만 싣는다 — edge · 공개 시각 · 산출물 해시 0.
 */
export const ARTICLE_RELEASE_SCHEMA = 'magazine-article-release/1'
export const ARTICLE_RELEASE_KEYS = Object.freeze(['bundleHash', 'graphVersion', 'intentId', 'planHash', 'policyBoard', 'schemaVersion'])
/** 출처의 정책 판 id 접두 — POLICY_IDENTITY_TABLE 의 원문 경계 규칙 행은 정책 판이 아니다 */
const POLICY_BOARD_ID_PREFIX = 'magazine-content-plan-policy/'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
const nonEmpty = (v) => isStr(v) && v.trim().length > 0
const deepFreeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v) } return v }

export class ContentPlanError extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; this.why = why }
}
const fail = (code, why) => { throw new ContentPlanError(code, why) }

/**
 * 정책 판 — 버전이 붙은 정적 규칙. 판의 해시가 ContentPlan 에 실리므로, 규칙을 바꾸면 id 를 올리고 planHash 가 바뀐다.
 *   relationMinimum   출판 최소 중 관계 수량 — 정의는 relation-policy 한 곳(VNEXT_PUBLICATION_RELATION_MINIMUM). 이 파일이 유일한 소비처다(R16)
 *   displayTarget     3+1 — 🔴 품질·표시 metadata 만. 출판 하드 게이트가 아니다(charter §18-B.2)
 *   profiles.compile  초기 commissioning 은 STANDARD 만. CONTROLLED 는 주장↔출처 validator 전까지 HOLD(§18-B.6)
 *   slots             graph builder 의 DIRECT_SLOTS · DISCOVERY_SLOT 과 같은 값 — content-plan 검사가 builder 와 대조한다
 */
export const CONTENT_PLAN_POLICY_BOARD = deepFreeze({
  id: 'magazine-content-plan-policy/1',
  territory: { excluded: ['T9'], allowedPolicyScope: 'ALLOWED', passDecision: 'PASS', rejectDecision: 'REJECT' },
  profiles: { compile: ['STANDARD'], controlled: ['FINANCIAL', 'MEDICAL', 'SENSITIVE'] },
  relationMinimum: { direct: VNEXT_PUBLICATION_RELATION_MINIMUM.direct },
  displayTarget: { directMax: RELATION_DISPLAY_TARGET.directMax, discovery: RELATION_DISPLAY_TARGET.discovery },
  slots: { direct: ['ACTION_OR_CONTEXT', 'DIRECT_NEXT', 'SAME_EXPERIENCE'], discovery: 'BRIDGE_DISCOVERY', discoveryType: 'BRIDGE' },
  text: {
    readerReason: { min: 10, max: 160 },
    anchorLabel: { min: 4, max: 60 },
    bannedWords: [...BANNED_WORDS],
    internalMarkers: ['🔴', '🟠', '🟡', '🟢', '⚠', 'TODO', 'FIXME'],
  },
  cta: { boards: ['/community/free', '/community/menopause'] },
})
export const POLICY_BOARD_HASH = sha256(canonicalJson(CONTENT_PLAN_POLICY_BOARD))
/** 제3자 원문 경계 규칙(Bundle 조립 · textProvenance)의 내용 해시 — 정책 신원표가 고정한다 */
export const SOURCE_TEXT_RULE_HASH = sha256(canonicalJson(SOURCE_TEXT_RULE))

/**
 * 정책 신원표 (S2 P1-G) — 판 id 별 기대 내용 해시. **추가만 한다**(기존 id 의 해시를 고치지 않는다).
 * 🔴 정책 판 · 원문 경계 규칙의 내용이 바뀌었는데 id 가 그대로면 compile · admission · ProviderPlan 이 전부 fail-closed 다
 *    (POLICY_IDENTITY_DRIFT). legacy 공유 상수(금지어 · 관계 수량)가 바뀌어도 여기서 멈춘다 — vNext 정책 신원이 legacy 를 조용히 따라가지 않게.
 *    규칙을 바꿨으면 id 를 올리고 이 표에 새 행을 더한다. 검사 CP14 가 기존 행이 바뀌지 않았는지 따로 고정한다.
 */
export const POLICY_IDENTITY_TABLE = Object.freeze({
  'magazine-content-plan-policy/1': 'c21d58fd6089c49a1bf3475e74fa8cddc774051d37be777707de07670a15250d',
  'magazine-source-text-rule/1': 'e4fafd1b437d2c39e4f7d3a147c783b0cea00697e6a54801f57b4e568a653527',
})
function assertPolicyIdentity() {
  if (POLICY_IDENTITY_TABLE[CONTENT_PLAN_POLICY_BOARD.id] !== POLICY_BOARD_HASH) {
    fail('POLICY_IDENTITY_DRIFT', `정책 판 ${CONTENT_PLAN_POLICY_BOARD.id} 내용(${POLICY_BOARD_HASH})이 신원표와 다르다 — id 를 올리고 표에 행을 더한다`)
  }
  if (POLICY_IDENTITY_TABLE[SOURCE_TEXT_RULE.id] !== SOURCE_TEXT_RULE_HASH) {
    fail('POLICY_IDENTITY_DRIFT', `원문 경계 규칙 ${SOURCE_TEXT_RULE.id} 내용(${SOURCE_TEXT_RULE_HASH})이 신원표와 다르다 — id 를 올리고 표에 행을 더한다`)
  }
}

/** 사유 코드의 표시 순서 — 결과의 reasons 는 이 순서로 정렬된다(결정적) */
export const REASON_ORDER = Object.freeze([
  // 정적
  'TERRITORY_EXCLUDED', 'INTENT_NOT_PASS', 'INTENT_QUARANTINED', 'CONTROLLED_VALIDATOR_ABSENT', 'PROFILE_UNKNOWN',
  'CLUSTER_UNASSIGNED', 'PRIMARY_QUERY_MISSING', 'AUDIENCE_SITUATION_MISSING', 'ANSWER_SCOPE_MISSING', 'CTA_DESTINATION_INVALID',
  'DIRECT_RELATION_MINIMUM_UNMET',
  // 동적 — 판 전체
  'CONTROL_UNREADABLE', 'GRAPH_VERSION_MISMATCH', 'KILL_SWITCH_TRIPPED', 'GRAPH_DISABLED', 'ARTICLES_UNREADABLE', 'QUEUE_IDENTITY_UNREADABLE',
  // 동적 — plan
  'CLUSTER_DISABLED', 'NO_ENABLED_DIRECT_SURFACE',
  'DUPLICATE_MAPPED_ARTICLE', 'DUPLICATE_RELEASED_INTENT', 'DUPLICATE_ARTICLE_TITLE', 'DUPLICATE_QUEUE_INTENT', 'DUPLICATE_QUEUE_SLUG', 'DUPLICATE_QUEUE_TITLE',
  'DUPLICATE_SAME_RELEASE', 'IN_FLIGHT', 'WITHDRAWN',
  'RELATION_TARGET_UNAVAILABLE', 'SAME_RELEASE_UNGROUNDED',
])
const sortReasons = (xs) => [...new Set(xs)].sort((a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b))

const exactInput = (input, keys, label) => {
  if (!isPlain(input)) fail('INPUT_INVALID', `${label} 입력이 객체가 아니다`)
  const extra = Object.keys(input).filter((k) => !keys.includes(k))
  if (extra.length) fail('INPUT_UNKNOWN_KEY', `${label} 가 모르는 입력: ${extra.sort(byCodeUnit).join(', ')}`)
}

/** 제목 비교용 정규화 — NFKC · 소문자 · 글자/숫자만. 정확히 같을 때만 중복이다(비슷함은 중복이 아니다) */
export const normalizeTitleKey = (s) => (isStr(s) ? s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') : '')
const tokensOf = (s) => s.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => [...t].length >= 2)
const lengthOf = (s) => [...s.trim()].length

// ── 정적 컴파일 ─────────────────────────────────────────────

/** 관계 문구의 결정적 검사 — 비어 있지 않음 · 길이 · 금지어 · 내부 표식 · 이유≠앵커 · 앵커가 대상 질문을 언급 */
function relationTextProblems(r, target) {
  const T = CONTENT_PLAN_POLICY_BOARD.text
  const bad = []
  const weak = (s, rule) => !nonEmpty(s) || lengthOf(s) < rule.min || lengthOf(s) > rule.max
    || T.bannedWords.some((w) => s.includes(w)) || T.internalMarkers.some((m) => s.includes(m))
  if (weak(r.readerReason, T.readerReason)) bad.push('WEAK_READER_REASON')
  if (weak(r.anchorLabel, T.anchorLabel)) bad.push('WEAK_ANCHOR_LABEL')
  else if (r.anchorLabel.trim() === String(r.readerReason).trim()) bad.push('WEAK_ANCHOR_LABEL')
  else {
    const q = target?.primaryQuery
    const anchor = r.anchorLabel.normalize('NFKC').toLowerCase()
    const qa = nonEmpty(q) ? q.normalize('NFKC').toLowerCase() : ''
    const mentions = nonEmpty(q) && (tokensOf(q).some((t) => anchor.includes(t)) || tokensOf(r.anchorLabel).some((t) => qa.includes(t)))
    if (!mentions) bad.push('ANCHOR_TARGET_UNRELATED')
  }
  return bad
}

const eligibleIntent = (x) => {
  const P = CONTENT_PLAN_POLICY_BOARD
  return x && !P.territory.excluded.includes(x.territoryId) && x.policyScope === P.territory.allowedPolicyScope
    && x.automationDecision === P.territory.passDecision && !x.quarantined
}

const PLAN_KEYS = ['answerScope', 'audienceSituation', 'bundleHash', 'cluster', 'cta', 'exclusions', 'forbiddenClaims', 'graphVersion', 'inclusions',
  'intentId', 'officialSourceUrls', 'planHash', 'planId', 'policyBoard', 'primaryQuery', 'quality', 'relations', 'schemaVersion', 'territoryGrade',
  'territoryId', 'textProvenance', 'validationProfile']
const PLAN_RELATION_KEYS = ['anchorLabel', 'edgeId', 'evidence', 'placement', 'priority', 'readerReason', 'relationType', 'slot', 'toIntentId']

/** planHash — planHash 를 뺀 canonical JSON 의 sha256 */
export function planHashOf(plan) {
  const { planHash: _omit, ...rest } = plan
  return sha256(canonicalJson(rest))
}

/**
 * ContentPlan 모양 확인 — exact key(최상위 · cta · relations · quality · 관계 항목) · 자기 해시.
 * 🔴 publishAt · slug · provider · job · 경로 · PR · release · 승인 필드는 모르는 키라 실패다.
 */
export function assertContentPlan(plan) {
  const keysEq = (v, keys, at) => {
    if (!isPlain(v)) fail('PLAN_SCHEMA', `${at} 가 객체가 아니다`)
    const got = Object.keys(v).sort(byCodeUnit), want = [...keys].sort(byCodeUnit)
    if (canonicalJson(got) !== canonicalJson(want)) fail('PLAN_SCHEMA', `${at} 키 ${got.join(',')} ≠ 계약 ${want.join(',')}`)
  }
  keysEq(plan, PLAN_KEYS, 'plan')
  keysEq(plan.policyBoard, ['hash', 'id'], 'plan.policyBoard')
  keysEq(plan.cta, ['communityDestination'], 'plan.cta')
  keysEq(plan.relations, ['direct', 'discovery'], 'plan.relations')
  for (const r of [...plan.relations.direct, ...plan.relations.discovery]) {
    keysEq(r, PLAN_RELATION_KEYS, `plan relation ${r?.edgeId}`)
    keysEq(r.evidence, ['basisSha256', 'objectSha256', 'refs'], `plan relation ${r.edgeId} evidence`)
    if (!Array.isArray(r.evidence.refs)) fail('PLAN_SCHEMA', `plan relation ${r.edgeId} evidence.refs 가 배열이 아니다`)
    for (const d of r.evidence.refs) keysEq(d, ['ref', 'sha256'], `plan relation ${r.edgeId} evidence ref`)
  }
  keysEq(plan.quality, ['display', 'meetsDisplayTarget'], 'plan.quality')
  keysEq(plan.quality.display, ['direct', 'discovery'], 'plan.quality.display')
  if (plan.schemaVersion !== CONTENT_PLAN_SCHEMA || plan.planId !== `${plan.graphVersion}:${plan.intentId}`) fail('PLAN_SCHEMA', 'schemaVersion · planId')
  if (!TEXT_PROVENANCE.includes(plan.textProvenance)) fail('PLAN_SCHEMA', `textProvenance ${plan.textProvenance}`)
  if (plan.planHash !== planHashOf(plan)) fail('PLAN_HASH_MISMATCH', `${plan.planId} planHash 가 내용과 다르다`)
  return plan
}

/**
 * 정적 컴파일 — Bundle(텍스트 또는 값)만 받는다. 모르는 입력 키는 실패다(control · articles · queue · 시각이 섞여 들어오지 않게).
 * @returns {{ schemaVersion, graphVersion, bundleHash, policyBoard, plans, held }}
 *   plans  STANDARD · 영토 허용 · 근거 있는 direct 관계 ≥ 출판 최소인 intent 의 ContentPlan (planId 정렬)
 *   held   나머지 intent 와 정적 사유 (진단 — 저장하지 않는다)
 */
export function compileContentPlans(input) {
  exactInput(input, ['bundle'], 'compile')
  assertPolicyIdentity()
  const bundle = parsePlanInputBundle(input.bundle)
  const P = CONTENT_PLAN_POLICY_BOARD
  const byId = new Map(bundle.intents.map((x) => [x.intentId, x]))
  const outgoing = new Map()
  for (const r of bundle.relations) (outgoing.get(r.fromIntentId) ?? outgoing.set(r.fromIntentId, []).get(r.fromIntentId)).push(r)
  const plans = [], held = []

  for (const x of bundle.intents) {
    const reasons = []
    if (P.territory.excluded.includes(x.territoryId) || x.policyScope !== P.territory.allowedPolicyScope || x.automationDecision === P.territory.rejectDecision) reasons.push('TERRITORY_EXCLUDED')
    else if (x.automationDecision !== P.territory.passDecision) reasons.push('INTENT_NOT_PASS')
    if (x.quarantined) reasons.push('INTENT_QUARANTINED')
    if (P.profiles.controlled.includes(x.validationProfile)) reasons.push('CONTROLLED_VALIDATOR_ABSENT')
    else if (!P.profiles.compile.includes(x.validationProfile)) reasons.push('PROFILE_UNKNOWN')
    if (!nonEmpty(x.cluster)) reasons.push('CLUSTER_UNASSIGNED')
    if (!nonEmpty(x.primaryQuery)) reasons.push('PRIMARY_QUERY_MISSING')
    if (!nonEmpty(x.audienceSituation)) reasons.push('AUDIENCE_SITUATION_MISSING')
    if (!nonEmpty(x.answerScope)) reasons.push('ANSWER_SCOPE_MISSING')
    if (!P.cta.boards.includes(x.communityDestination)) reasons.push('CTA_DESTINATION_INVALID')

    // 관계 — priority → edgeId 순으로 판정. 근거는 Bundle 이 이미 걸렀다(근거 없는 관계는 Bundle 에 없다)
    const rels = [...(outgoing.get(x.intentId) ?? [])].sort((a, b) => a.priority - b.priority || byCodeUnit(a.edgeId, b.edgeId))
    const direct = [], discovery = [], rejected = []
    const usedTargets = new Set()
    for (const r of rels) {
      const target = byId.get(r.toIntentId)
      const why = []
      if (r.toIntentId === x.intentId) why.push('SELF_RELATION')
      if (!eligibleIntent(target)) why.push('TARGET_NOT_ELIGIBLE')
      const isDirect = P.slots.direct.includes(r.slot)
      const isDiscovery = r.slot === P.slots.discovery && r.relationType === P.slots.discoveryType
      if (!isDirect && !isDiscovery) why.push('SLOT_INVALID')
      why.push(...relationTextProblems(r, target))
      if (!why.length && usedTargets.has(r.toIntentId)) why.push('DUPLICATE_TARGET')
      if (why.length) { rejected.push({ edgeId: r.edgeId, why }); continue }
      usedTargets.add(r.toIntentId)
      const item = { edgeId: r.edgeId, toIntentId: r.toIntentId, relationType: r.relationType, slot: r.slot, placement: r.placement,
        priority: r.priority, readerReason: r.readerReason, anchorLabel: r.anchorLabel, evidence: r.evidence }
      ;(isDirect ? direct : discovery).push(item)
    }
    // 🔴 하드 최소는 근거 있는 direct 관계 수뿐이다. discovery 0 · 3+1 미달은 막지 않는다
    if (direct.length < P.relationMinimum.direct) reasons.push('DIRECT_RELATION_MINIMUM_UNMET')

    const planId = `${bundle.graphVersion}:${x.intentId}`
    if (reasons.length) { held.push({ planId, intentId: x.intentId, reasons: sortReasons(reasons), relationRejections: rejected }); continue }
    const display = { direct: direct.slice(0, P.displayTarget.directMax).map((r) => r.edgeId), discovery: discovery.length ? discovery[0].edgeId : null }
    const plan = {
      schemaVersion: CONTENT_PLAN_SCHEMA,
      planId,
      graphVersion: bundle.graphVersion,
      bundleHash: bundle.bundleHash,
      policyBoard: { id: P.id, hash: POLICY_BOARD_HASH },
      intentId: x.intentId,
      cluster: x.cluster,
      territoryId: x.territoryId,
      territoryGrade: 'AUTO',
      validationProfile: x.validationProfile,
      primaryQuery: x.primaryQuery,
      audienceSituation: x.audienceSituation,
      answerScope: x.answerScope,
      inclusions: [...x.inclusions],
      exclusions: [...x.exclusions],
      forbiddenClaims: [...x.forbiddenClaims],
      // 제3자 원문 경계 판정(Bundle 조립 때 증거와 결정적으로 대조) — CLEAR 가 아니면 ProviderPlan 0 (P1-E)
      textProvenance: x.textProvenance,
      // 승인된 공식 출처 URL — 현재 canonical 출처가 없다(결정적 빈 배열). 생기면 Bundle 계약을 먼저 고친다
      officialSourceUrls: [],
      cta: { communityDestination: x.communityDestination },
      relations: { direct, discovery },
      quality: {
        display,
        meetsDisplayTarget: display.direct.length >= P.displayTarget.directMax && (display.discovery === null ? 0 : 1) >= P.displayTarget.discovery,
      },
    }
    plan.planHash = planHashOf(plan)
    plans.push(assertContentPlan(plan))
  }
  plans.sort((a, b) => byCodeUnit(a.planId, b.planId))
  held.sort((a, b) => byCodeUnit(a.planId, b.planId))
  return { schemaVersion: COMPILE_SCHEMA, graphVersion: bundle.graphVersion, bundleHash: bundle.bundleHash, policyBoard: { id: P.id, hash: POLICY_BOARD_HASH }, plans, held }
}

// ── 동적 입력 판독 (텍스트 → 신원 투영) ─────────────────────

/** 현재 control.ts 의 판 — 엄격 판독(parseGraphControl)이 실패하면 null. bootstrap 신원 대조가 같은 판독을 쓰게 한다 */
export const strictControlGraphVersion = (controlText) => parseGraphControl(controlText)?.graphVersion ?? null

/**
 * 제품 TS 데이터 선언 판독 — 실제 최상위 선언(토큰 단위)을 찾아 **데이터로만** 읽는다(JS 실행 0 · 중복 key 거부 · P1-B/P1-D).
 * 주석 · 문자열 안의 가짜 선언, 같은 이름 선언 2개, getter · spread · 호출, 같은 slug · 같은 필드 두 번은 전부 code 로 실패한다.
 * @returns {{ ok: true, value: unknown } | { ok: false, code: string }}
 */
function readDataDecl(text, spec, codes) {
  if (!isStr(text)) return { ok: false, code: codes.missing }
  let span
  try { span = locateConstLiteral(text, spec) } catch (e) {
    if (!(e instanceof ControlLocateError)) throw e
    return { ok: false, code: e.code.endsWith('_NOT_FOUND') ? codes.anchor : e.code.endsWith('_AMBIGUOUS') ? codes.ambiguous : codes.unreadable }
  }
  try { return { ok: true, value: parseDataLiteral(text.slice(span.start, span.end)) } } catch (e) {
    if (!(e instanceof ControlLocateError)) throw e
    return { ok: false, code: e.code === 'LITERAL_DUPLICATE_KEY' ? codes.duplicate : codes.unreadable }
  }
}

const HEX64 = /^[0-9a-f]{64}$/
const exactKeysOf = (v, keys) => isPlain(v) && canonicalJson(Object.keys(v).sort(byCodeUnit)) === canonicalJson([...keys].sort(byCodeUnit))

/**
 * Article 행의 vNext 출처(`release`) 엄격 판독 — 통과하면 신원 투영, 아니면 null (S3 P1).
 *   exact key · 알려진 schema · 앞뒤 공백 없는 intentId · graphVersion 형식 · 64-hex 해시 ·
 *   정책 판 id 는 POLICY_IDENTITY_TABLE 에 **알려진 정책 판** 이고 hash 가 그 행과 같아야 한다.
 * 🔴 모르는 · 미래 · 깨진 출처를 legacy(출처 없음)로 되돌리지 않는다 — 호출자가 fail-closed 로 쓴다.
 */
function parseReleaseProvenance(r) {
  if (!exactKeysOf(r, ARTICLE_RELEASE_KEYS) || !exactKeysOf(r.policyBoard, ['hash', 'id'])) return null
  if (r.schemaVersion !== ARTICLE_RELEASE_SCHEMA) return null
  if (!nonEmpty(r.intentId) || r.intentId !== r.intentId.trim()) return null
  if (!isStr(r.graphVersion) || !GRAPH_VERSION_RE.test(r.graphVersion)) return null
  if (!isStr(r.bundleHash) || !HEX64.test(r.bundleHash) || !isStr(r.planHash) || !HEX64.test(r.planHash)) return null
  const { id, hash } = r.policyBoard
  if (!isStr(id) || !id.startsWith(POLICY_BOARD_ID_PREFIX) || !Object.prototype.hasOwnProperty.call(POLICY_IDENTITY_TABLE, id)) return null
  if (!isStr(hash) || hash !== POLICY_IDENTITY_TABLE[id]) return null
  return { intentId: r.intentId, graphVersion: r.graphVersion, bundleHash: r.bundleHash, planHash: r.planHash, policyBoard: { id, hash } }
}

/**
 * articles.ts 의 신원 투영 — slug · title · cluster · status · publishAt · publishedAt · release(vNext 출처 · 없으면 null) 만.
 * 🔴 앵커 없음 · 선언 2개 · 데이터 아님 · **같은 slug 두 번(원시 중복)** 은 { ok: false } — 빈 목록이나 마지막 값으로 넘어가지 않는다.
 * 🔴 공개 · 예약 행(DRAFT · BLOCKED 밖)의 공개 시각이 해석 불가 · 오프셋 없음이면 { ok: false, code: 'ARTICLES_PUBLISH_TIME_INVALID' } —
 *    그 행이 공개인지 예약인지 모르는 채로 중복 · 관계 대상 판정을 하지 않는다.
 * 🔴 `release` 가 있으면 상태와 무관하게 엄격 판독한다(S3 P1) — 깨진 출처는 ARTICLES_RELEASE_INVALID, 두 행이 같은 release.intentId 면
 *    ARTICLES_RELEASE_DUPLICATE_INTENT. 둘 다 { ok: false } 라 admission 전체가 ARTICLES_UNREADABLE 로 멈춘다.
 */
export function parseArticleIdentityText(text) {
  const d = readDataDecl(text, { name: 'MAGAZINE_ARTICLE_RECORD', exported: false, open: '{', prefix: 'ARTICLES' },
    { missing: 'ARTICLES_MISSING', anchor: 'ARTICLES_ANCHOR_MISSING', ambiguous: 'ARTICLES_ANCHOR_AMBIGUOUS', unreadable: 'ARTICLES_UNREADABLE', duplicate: 'ARTICLES_DUPLICATE_KEY' })
  if (!d.ok) return d
  if (!isPlain(d.value)) return { ok: false, code: 'ARTICLES_UNREADABLE' }
  const rows = []
  const releasedBy = new Map()
  for (const [slug, a] of Object.entries(d.value)) {
    if (!isPlain(a) || !nonEmpty(slug) || !isStr(a.title)) return { ok: false, code: 'ARTICLES_UNREADABLE' }
    for (const k of ['cluster', 'status', 'publishAt', 'publishedAt']) if (a[k] !== undefined && a[k] !== null && !isStr(a[k])) return { ok: false, code: 'ARTICLES_UNREADABLE' }
    // vNext 출처 — 키가 있으면(null 포함) 엄격 판독. 없으면 legacy 행이다
    let release = null
    if (Object.prototype.hasOwnProperty.call(a, 'release')) {
      release = parseReleaseProvenance(a.release)
      if (!release) return { ok: false, code: 'ARTICLES_RELEASE_INVALID' }
      // 🔴 상태와 무관하게(PUBLISHED · SCHEDULED · DRAFT · BLOCKED) 한 intent 는 한 행만 — 어느 행이 정본인지 고르지 않는다
      if (releasedBy.has(release.intentId)) return { ok: false, code: 'ARTICLES_RELEASE_DUPLICATE_INTENT' }
      releasedBy.set(release.intentId, slug)
    }
    const row = { slug, title: a.title, cluster: isStr(a.cluster) ? a.cluster : null, status: isStr(a.status) ? a.status : null,
      publishAt: isStr(a.publishAt) ? a.publishAt : null, publishedAt: isStr(a.publishedAt) ? a.publishedAt : null, release }
    // 엄격 시각 규칙 하나(public-rule) — 달력에 없는 날 · 24:00 · 오프셋 없음은 실패(Date.parse 정규화에 기대지 않는다 · P1-2)
    if (!isHeldStatus(row) && !Number.isFinite(strictPublishAtMs(row))) return { ok: false, code: 'ARTICLES_PUBLISH_TIME_INVALID' }
    rows.push(row)
  }
  return { ok: true, rows: rows.sort((a, b) => byCodeUnit(a.slug, b.slug)) }
}

/**
 * legacy queue 의 **신원 투영** — intentId · slug · 정규화 제목 · cluster 만. 그 밖의 필드(초안 · notes · plan 필드 · 상태)는 버린다.
 * 🔴 파일 없음 · 앵커 없음 · 선언 2개 · 데이터 아님 · 한 행의 같은 필드 두 번 · **같은 slug 두 행** · 신원 필드 형식 오류는 { ok: false } 다.
 *    legacy adapter 가 켜진 동안 admission 은 이것을 fail-closed 로 쓴다(마지막 값 · 빈 목록으로 넘어가지 않는다).
 */
export function parseQueueIdentityText(text) {
  const d = readDataDecl(text, { name: 'TOPIC_QUEUE', exported: true, open: '[', prefix: 'QUEUE' },
    { missing: 'QUEUE_FILE_MISSING', anchor: 'QUEUE_ANCHOR_MISSING', ambiguous: 'QUEUE_ANCHOR_AMBIGUOUS', unreadable: 'QUEUE_UNREADABLE', duplicate: 'QUEUE_DUPLICATE_KEY' })
  if (!d.ok) return d
  if (!Array.isArray(d.value)) return { ok: false, code: 'QUEUE_UNREADABLE' }
  const out = []
  const slugs = new Set()
  for (const r of d.value) {
    if (!isPlain(r) || !nonEmpty(r.slug) || !isStr(r.title)) return { ok: false, code: 'QUEUE_UNREADABLE' }
    if (r.intentId !== undefined && r.intentId !== null && !nonEmpty(r.intentId)) return { ok: false, code: 'QUEUE_UNREADABLE' }
    if (r.cluster !== undefined && r.cluster !== null && !isStr(r.cluster)) return { ok: false, code: 'QUEUE_UNREADABLE' }
    if (slugs.has(r.slug)) return { ok: false, code: 'QUEUE_DUPLICATE_SLUG' }
    slugs.add(r.slug)
    out.push({ intentId: nonEmpty(r.intentId) ? r.intentId : null, slug: r.slug, titleKey: normalizeTitleKey(r.title), cluster: isStr(r.cluster) ? r.cluster : null })
  }
  return { ok: true, rows: out.sort((a, b) => byCodeUnit(a.slug, b.slug)) }
}

// ── 동적 admission ──────────────────────────────────────────

/**
 * 동적 admission — 출판 최소의 동적 부분을 판정한다. planHash 는 바꾸지 않는다.
 * @param {{ bundle: string|object, controlText: string, articlesText: string,
 *           legacyQueue: { active: boolean, text: string|null }, nowMs: number,
 *           inFlightIntentIds?: string[], withdrawnPlanIds?: string[] }} input
 *   articlesText        공개 · 예약 행과 **vNext 출처(release)** 의 유일한 입력 — 이미 출시된 intent 는 상태 · graphVersion 과 무관하게
 *                       DUPLICATE_RELEASED_INTENT 다(S3 P1 · 별도 releasedIdentity 입력 없음)
 *   legacyQueue.active  legacy 경로가 남아 있는 동안 true — queue 신원으로 중복을 본다. 삭제 단계 뒤 false(text null)
 *   inFlightIntentIds   진행 중 Job 의 intentId — 두 번째 생성을 막는다. 🔴 planId 가 아니다: graphVersion 이 바뀌면 planId 가 바뀌어
 *                       같은 intent 의 두 번째 생성을 놓친다(S3 P1). 옛 키 inFlightPlanIds 는 모르는 입력으로 거부한다
 *   withdrawnPlanIds    같은 release 에서 빠진 후보(검증·조립·CI 실패) — 남은 후보를 고정점까지 다시 판정한다. 한 컴파일 안의 개념이라 plan 단위다
 */
export function admitContentPlans(input) {
  return admitWithPlans(input).result
}

/** admission 본체 — 결과와 그 결과를 만든 정적 컴파일을 함께 돌려준다(ProviderPlan 이 같은 컴파일에서 plan 을 꺼낸다) */
function admitWithPlans(input) {
  exactInput(input, ['bundle', 'controlText', 'articlesText', 'legacyQueue', 'nowMs', 'inFlightIntentIds', 'withdrawnPlanIds'], 'admission')
  const { controlText, articlesText, legacyQueue, nowMs } = input
  for (const k of ['inFlightIntentIds', 'withdrawnPlanIds']) {
    if (input[k] !== undefined && !(Array.isArray(input[k]) && isDense(input[k]) && input[k].every(isStr))) fail('INPUT_INVALID', `${k} 는 빈 칸 없는 문자열 배열이다`)
  }
  const inFlight = new Set(input.inFlightIntentIds ?? [])
  const withdrawn = new Set(input.withdrawnPlanIds ?? [])
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs) || Math.abs(nowMs) > 8.64e15) fail('INPUT_INVALID', 'nowMs 는 Date 범위 안의 유한한 수여야 한다(벽시계를 읽지 않는다 — 호출자가 준다)')
  if (!isPlain(legacyQueue) || typeof legacyQueue.active !== 'boolean' || Object.keys(legacyQueue).some((k) => k !== 'active' && k !== 'text')) fail('INPUT_INVALID', 'legacyQueue 는 { active, text } 다')
  if (!legacyQueue.active && legacyQueue.text !== null && legacyQueue.text !== undefined) fail('INPUT_INVALID', 'legacy adapter 가 꺼졌는데 queue 텍스트가 왔다')
  const compiled = compileContentPlans({ bundle: input.bundle })
  const bundle = parsePlanInputBundle(input.bundle)

  // 판 전체 사유
  const global = []
  const control = parseGraphControl(controlText)
  if (!control) global.push('CONTROL_UNREADABLE')
  else if (control.graphVersion !== compiled.graphVersion) global.push('GRAPH_VERSION_MISMATCH')
  else if (control.killSwitch.tripped) global.push('KILL_SWITCH_TRIPPED')
  else if (!control.enabled) global.push('GRAPH_DISABLED')
  const articles = parseArticleIdentityText(articlesText)
  if (!articles.ok) global.push('ARTICLES_UNREADABLE')
  let queueRows = []
  let queueCode = null
  if (legacyQueue.active) {
    const q = parseQueueIdentityText(legacyQueue.text)
    if (q.ok) queueRows = q.rows
    else { queueCode = q.code; global.push('QUEUE_IDENTITY_UNREADABLE') }
  }

  const articleBySlug = new Map(articles.ok ? articles.rows.map((a) => [a.slug, a]) : [])
  // 🔴 중복 판정은 공개 · 예약 행만 본다(P1-D). DRAFT · BLOCKED 행은 공개도 예약도 아니라 같은 주제를 막지 않는다 — 규칙은 public-rule 한 곳
  const listedRows = articles.ok ? articles.rows.filter((a) => !isHeldStatus(a)) : []
  const listedSlugs = new Set(listedRows.map((a) => a.slug))
  const articleTitleKeys = new Set(listedRows.map((a) => normalizeTitleKey(a.title)))
  const mappedSlugs = new Map()
  for (const m of bundle.mappings) (mappedSlugs.get(m.intentId) ?? mappedSlugs.set(m.intentId, []).get(m.intentId)).push(m.slug)
  // vNext 출처 — 상태와 무관하게 이미 출시된 intent(중복 판정) · 출처가 가리키는 행의 slug(대상 신원)
  const releasedSlugOf = new Map(articles.ok ? articles.rows.filter((a) => a.release).map((a) => [a.release.intentId, a.slug]) : [])
  /**
   * 대상 intent 의 지금 공개된 slug — Bundle mapping slug ∪ 그 intent 의 vNext 출처 행 slug 중 공개된 것이 **정확히 하나일 때만** 센다.
   * 🔴 둘 이상이면 고르지 않는다(null · 대상 없음) — 어느 글이 그 질문의 답인지 임의로 정하지 않는다.
   */
  const publicSlugOf = (intentId) => {
    const pool = new Set(mappedSlugs.get(intentId) ?? [])
    if (releasedSlugOf.has(intentId)) pool.add(releasedSlugOf.get(intentId))
    const s = [...pool].filter((slug) => articleBySlug.has(slug) && isPublicAt(articleBySlug.get(slug), nowMs))
    return s.length === 1 ? s[0] : null
  }
  const surfaceOn = (placement) => control?.surfaces?.[placement] === true

  // plan 별 사유 (same-release 이전)
  const reasonsOf = new Map()
  for (const plan of compiled.plans) {
    const reasons = [...global]
    if (!global.length) {
      if (!control.enabledClusters.includes(plan.cluster)) reasons.push('CLUSTER_DISABLED')
      if (!plan.relations.direct.some((r) => surfaceOn(r.placement))) reasons.push('NO_ENABLED_DIRECT_SURFACE')
      const slugs = mappedSlugs.get(plan.intentId) ?? []
      if (slugs.some((s) => listedSlugs.has(s))) reasons.push('DUPLICATE_MAPPED_ARTICLE')
      // 🔴 이미 출시된 intent — 상태(DRAFT · BLOCKED 포함) · graphVersion 과 무관하다. rollback(BLOCKED)한 주제를 자동으로 다시 만들지 않는다
      if (releasedSlugOf.has(plan.intentId)) reasons.push('DUPLICATE_RELEASED_INTENT')
      const titleKey = normalizeTitleKey(plan.primaryQuery)
      if (articleTitleKeys.has(titleKey)) reasons.push('DUPLICATE_ARTICLE_TITLE')
      // 🔴 같은 cluster 라는 이유만으로는 막지 않는다 — 정확한 신원(intentId · mapping slug · 정규화 제목)만 중복이다
      if (queueRows.some((q) => q.intentId === plan.intentId)) reasons.push('DUPLICATE_QUEUE_INTENT')
      if (queueRows.some((q) => slugs.includes(q.slug))) reasons.push('DUPLICATE_QUEUE_SLUG')
      if (queueRows.some((q) => q.titleKey === titleKey)) reasons.push('DUPLICATE_QUEUE_TITLE')
      if (inFlight.has(plan.intentId)) reasons.push('IN_FLIGHT')
      if (withdrawn.has(plan.planId)) reasons.push('WITHDRAWN')
    }
    reasonsOf.set(plan.planId, reasons)
  }

  // same-release 정확 신원 중복 (P1-4) — 기존 글 · queue 와의 중복을 통과한 후보끼리도 intentId · canonical mapping slug ·
  //   정규화 제목이 같으면 한 release 에 둘 다 내지 않는다. 같은 신원을 하나라도 공유하는 후보를 묶고(연결 요소),
  //   묶음마다 planId code-unit 최소 하나만 남긴다 — 입력 순서와 무관하다(후보 집합 · planId 만으로 정해진다).
  {
    const open = compiled.plans.filter((p) => !reasonsOf.get(p.planId).length).sort((a, b) => byCodeUnit(a.planId, b.planId))
    const parent = new Map(open.map((p) => [p.planId, p.planId]))
    const root = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id }
    const join = (a, b) => { const ra = root(a), rb = root(b); if (ra !== rb) parent.set(byCodeUnit(ra, rb) < 0 ? rb : ra, byCodeUnit(ra, rb) < 0 ? ra : rb) }
    const owner = new Map()
    for (const p of open) {
      const keys = [`intent:${p.intentId}`, `title:${normalizeTitleKey(p.primaryQuery)}`, ...(mappedSlugs.get(p.intentId) ?? []).map((s) => `slug:${s}`)]
      for (const k of keys) { if (owner.has(k)) join(owner.get(k), p.planId); else owner.set(k, p.planId) }
    }
    for (const p of open) if (root(p.planId) !== p.planId) reasonsOf.get(p.planId).push('DUPLICATE_SAME_RELEASE')
  }

  // same-release 고정점 — 이미 공개된 대상에서 출발해 층을 쌓는다. 근거가 끊긴 후보를 빼면 남은 후보를 다시 판정한다
  const planById = new Map(compiled.plans.map((p) => [p.planId, p]))
  const planIdOfIntent = new Map(compiled.plans.map((p) => [p.intentId, p.planId]))
  let candidates = new Set(compiled.plans.filter((p) => !reasonsOf.get(p.planId).length).map((p) => p.planId))
  let grounded = new Map()
  for (;;) {
    grounded = new Map()
    let frontier = true
    for (let layer = 1; frontier; layer++) {
      frontier = false
      for (const id of [...candidates].sort(byCodeUnit)) {
        if (grounded.has(id)) continue
        const via = []
        for (const r of planById.get(id).relations.direct) {
          if (!surfaceOn(r.placement)) continue
          const slug = publicSlugOf(r.toIntentId)
          if (slug && layer === 1) { via.push({ edgeId: r.edgeId, toIntentId: r.toIntentId, target: 'PUBLIC', slug }); continue }
          const tid = planIdOfIntent.get(r.toIntentId)
          const g = tid !== undefined && candidates.has(tid) ? grounded.get(tid) : undefined
          if (g && g.layer < layer) via.push({ edgeId: r.edgeId, toIntentId: r.toIntentId, target: 'SAME_RELEASE', planId: tid })
        }
        if (via.length) { grounded.set(id, { layer, via }); frontier = true }
      }
    }
    const dropped = [...candidates].filter((id) => !grounded.has(id))
    if (!dropped.length) break
    // 사유는 이번 회차의 후보 집합으로 먼저 정한 뒤 한꺼번에 뺀다 — 순환 A↔B 의 둘째가 "대상 없음"으로 바뀌지 않게
    const why = dropped.map((id) => [id, planById.get(id).relations.direct.some((r) => surfaceOn(r.placement) && candidates.has(planIdOfIntent.get(r.toIntentId)))])
    for (const [id, sameRelease] of why) {
      reasonsOf.get(id).push(sameRelease ? 'SAME_RELEASE_UNGROUNDED' : 'RELATION_TARGET_UNAVAILABLE')
      candidates.delete(id)
    }
  }

  const admitted = [], held = []
  for (const plan of compiled.plans) {
    const reasons = sortReasons(reasonsOf.get(plan.planId))
    if (reasons.length) { held.push({ planId: plan.planId, planHash: plan.planHash, intentId: plan.intentId, reasons }); continue }
    const g = grounded.get(plan.planId)
    const relatedPublic = []
    for (const r of [...plan.relations.direct, ...plan.relations.discovery]) {
      if (!surfaceOn(r.placement)) continue
      const slug = publicSlugOf(r.toIntentId)
      if (slug) relatedPublic.push({ edgeId: r.edgeId, slug, title: articleBySlug.get(slug).title })
    }
    admitted.push({ planId: plan.planId, planHash: plan.planHash, intentId: plan.intentId, cluster: plan.cluster, layer: g.layer,
      groundedBy: g.via, relatedPublic, releaseIdentity: SLUG_BINDING_REQUIRED })
  }
  const result = {
    schemaVersion: ADMISSION_SCHEMA,
    graphVersion: compiled.graphVersion,
    bundleHash: compiled.bundleHash,
    policyBoard: compiled.policyBoard,
    asOf: new Date(nowMs).toISOString(),
    inputs: {
      controlSha256: sha256(String(controlText ?? '')),
      articlesSha256: sha256(String(articlesText ?? '')),
      legacyQueue: legacyQueue.active
        ? { active: true, identitySha256: queueCode ? null : sha256(canonicalJson(queueRows)), unreadable: queueCode }
        : { active: false, identitySha256: null, unreadable: null },
    },
    // stable slug 는 S3 release 신원 경계가 묶는다 — 여기서 만들지도 legacy materialization 을 쓰지도 않는다
    releaseIdentity: { required: SLUG_BINDING_REQUIRED, owner: 'S3 vNext release identity boundary' },
    admitted,
    held,
  }
  return { result, compiled }
}

// ── ProviderPlan ────────────────────────────────────────────

export const PROVIDER_PLAN_KEYS = Object.freeze(['answerScope', 'audienceSituation', 'cta', 'exclusions', 'forbiddenClaims', 'inclusions',
  'officialSourceUrls', 'primaryQuery', 'relatedArticles', 'validationProfile'])

/**
 * 전송 전 재귀 검사 패턴 — 이름(code)과 정규식. 허용 목록 투영이 1차 방어이고 이것이 2차 방어다(runbook §0.0B.1).
 * 🔴 걸리면 지우지 않고 ProviderPlan 을 만들지 않는다.
 */
const SCAN_RULES = Object.freeze([
  ['PII_EMAIL', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  // 국내 번호 — 지역·이동 번호를 괄호로 묶은 꼴((010) 1234-5678) · 국가 번호(+82 10-…) 포함
  ['PII_PHONE', /(?:^|\D)(?:\(\s*0\d{1,2}\s*\)|0\d{1,2}|\+\s?82[-.\s]?\(?0?\d{1,2}\)?)[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/],
  ['PII_RRN', /(?:^|\D)\d{6}[-\s]?[1-8]\d{6}(?!\d)/],
  // 국내 계좌 — 구분자 '-' · 공백 · NBSP(\s 가 포함) · 유니코드 대시로 나뉜 3묶음, 또는 이어 쓴 10~14자리(P1-5).
  //   날짜(2026-11-15 · 2026.11.15 · 20261115)와 짧은 수는 마지막 묶음 4자리 · 10자리 하한에 걸리지 않는다
  ['PII_ACCOUNT', /(?:^|\D)\d{3,6}[-\u2010-\u2015\s]\d{2,6}[-\u2010-\u2015\s]\d{4,8}(?!\d)|(?:^|\D)\d{10,14}(?!\d)/],
  ['PII_CARD', /(?:^|\D)(?:\d{4}[-\s]?){3}\d{4}(?!\d)/],
  ['MEMBER_IDENTIFIER', /\b(?:userId|memberId|authorId|nickname|kakaoId)\b|\bc[a-z0-9]{24}\b/],
  ['RAW_EVIDENCE', /evidence\/|serpapi|organicResults|peopleAlsoAsk|relatedSearches|snippet|\b[0-9a-f]{64}\b/i],
  // 절대 경로 · 홈 · 저장소 상대 경로(src/ · scripts/ · drafts/ …) · 코드·데이터 확장자
  ['LOCAL_PATH', /(?:^|[\s("'`])(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|\/var\/|~\/)|file:\/\/|[A-Za-z]:\\|Library\/Application Support|\.(?:jsonl|mjs|cjs|mts|tsx?|jsx?|json|env|md|sh)\b|(?:^|[^\w./-])(?:\.{1,2}\/)*(?:src|scripts|drafts|docs|public|prisma|node_modules|app|lib|content|config|research|contract|evidence|reconciled|\.github)\/[\w.-]/],
  // 일반 비밀 꼴 — provider 키 · Bearer · 긴 무작위 문자열 · AWS access key id · GitHub · Slack · Google API key · 개인 키 머리말
  ['TOKEN', /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._-]{10,}|\b[A-Za-z0-9_-]{40,}\b|\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bxox[abposr]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----/],
])
const URL_RE = /https?:\/\/[^\s"'<>)]+/gi

/** ProviderPlan 값 검사 — exact key · 형식 · 재귀 스캔. 문제 목록(빈 배열이면 통과) */
export function providerPlanProblems(value) {
  const problems = []
  const add = (path, code) => problems.push({ path, code })
  if (!isPlain(value)) return [{ path: '$', code: 'NOT_OBJECT' }]
  const got = Object.keys(value).sort(byCodeUnit)
  for (const k of got) if (!PROVIDER_PLAN_KEYS.includes(k)) add(k, 'UNKNOWN_KEY')
  for (const k of PROVIDER_PLAN_KEYS) if (!got.includes(k)) add(k, 'MISSING_KEY')
  for (const k of ['primaryQuery', 'audienceSituation', 'answerScope']) if (k in value && !nonEmpty(value[k])) add(k, 'NOT_TEXT')
  for (const k of ['inclusions', 'exclusions', 'forbiddenClaims', 'officialSourceUrls']) if (k in value && !(Array.isArray(value[k]) && value[k].every(isStr))) add(k, 'NOT_TEXT_ARRAY')
  if ('validationProfile' in value && !CONTENT_PLAN_POLICY_BOARD.profiles.compile.includes(value.validationProfile)) add('validationProfile', 'PROFILE_NOT_ALLOWED')
  if ('cta' in value) {
    if (!isPlain(value.cta) || Object.keys(value.cta).join() !== 'communityDestination') add('cta', 'UNKNOWN_KEY')
    else if (!CONTENT_PLAN_POLICY_BOARD.cta.boards.includes(value.cta.communityDestination)) add('cta.communityDestination', 'CTA_DESTINATION_INVALID')
  }
  if ('relatedArticles' in value) {
    if (!Array.isArray(value.relatedArticles)) add('relatedArticles', 'NOT_ARRAY')
    else value.relatedArticles.forEach((a, i) => {
      if (!isPlain(a) || Object.keys(a).sort(byCodeUnit).join() !== 'slug,title') add(`relatedArticles[${i}]`, 'UNKNOWN_KEY')
      else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug) || !nonEmpty(a.title)) add(`relatedArticles[${i}]`, 'RELATED_ARTICLE_INVALID')
    })
  }
  // 공식 출처 URL — https · query 없음 · fragment 없음 · 자격 증명 없음
  if (Array.isArray(value.officialSourceUrls)) value.officialSourceUrls.forEach((u, i) => {
    let url = null
    try { url = new URL(u) } catch { url = null }
    if (!url || url.protocol !== 'https:' || url.search || url.hash || url.username || url.password || u.includes('?') || u.includes('#')) add(`officialSourceUrls[${i}]`, 'URL_NOT_CLEAN')
  })
  // 재귀 스캔 — 모든 문자열 (키 이름 포함)
  const walk = (v, path) => {
    if (isStr(v)) {
      for (const m of CONTENT_PLAN_POLICY_BOARD.text.internalMarkers) if (v.includes(m)) { add(path, 'INTERNAL_MARKER'); break }
      for (const [code, re] of SCAN_RULES) if (re.test(v)) add(path, code)
      for (const m of v.matchAll(URL_RE)) {
        if (!path.startsWith('officialSourceUrls[')) add(path, 'URL_OUTSIDE_SOURCES')
        if (m[0].includes('?') || m[0].includes('#') || /utm_|fbclid|gclid/i.test(m[0])) add(path, 'URL_TRACKING_OR_QUERY')
      }
      return
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return }
    if (isPlain(v)) { for (const [k, x] of Object.entries(v)) { walk(k, `${path}{key}`); walk(x, path ? `${path}.${k}` : k) } return }
    if (v !== null && typeof v !== 'boolean' && typeof v !== 'number') add(path, 'NOT_JSON_VALUE')
  }
  walk(value, '')
  return problems.sort((a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.code, b.code))
}

/**
 * ProviderPlan — **호출자가 준 plan · admission 결과를 믿지 않는다** (S2 P1-E).
 *   ① 같은 admission 입력(현재 control · articles · legacy queue 신원 · 시각 · 진행 중 신원)으로 봉인된 Bundle 에서 다시 컴파일 · admission 한다
 *      — Bundle 판독이 두 해시를 검증하고, compile 이 정책 신원표를 강제한다.
 *   ② job 이 묶인 planHash 와 다시 컴파일한 planHash 가 다르면 PLAN_STALE(내용 · 정책 판이 바뀐 뒤의 낡은 plan) — 산출 0.
 *   ③ relatedArticles 의 title · slug 는 admission 이 그 시각의 articles.ts 에서 도출한 값만 쓴다(호출자가 고친 관련 글 · 제목이 들어올 길 0).
 *   ④ 제3자 원문 판정이 CLEAR 가 아니면 산출 0 · 허용 목록으로 새로 만든 뒤 재귀 스캔.
 * @param {{ admission: object, planId: string, planHash: string }} input  admission = admitContentPlans 입력 그대로
 * @returns {{ ok: boolean, providerPlan: object|null, providerPlanHash: string|null, problems: {path,code}[] }}
 */
export function projectProviderPlan(input) {
  exactInput(input, ['admission', 'planId', 'planHash'], 'providerPlan')
  const { admission, planId, planHash } = input
  if (!nonEmpty(planId) || !isStr(planHash) || !/^[0-9a-f]{64}$/.test(planHash)) fail('INPUT_INVALID', 'planId 와 64자리 planHash 가 필요하다(job 이 묶인 plan 신원)')
  const none = (code) => ({ ok: false, providerPlan: null, providerPlanHash: null, problems: [{ path: '$', code }] })
  const { result, compiled } = admitWithPlans(admission)
  const plan = compiled.plans.find((p) => p.planId === planId)
  if (!plan) return none('PLAN_NOT_COMPILED')
  if (plan.planHash !== planHash) return none('PLAN_STALE')
  const admitted = result.admitted.find((a) => a.planId === planId)
  if (!admitted) return none('NOT_ADMITTED')
  // 🔴 제3자 원문 경계(P1-E) — 구조 판정이다(문구 목록이 아니다). Bundle 조립 때 intent 문장을 연구가 관측한 제3자 제목 · snippet ·
  //    communityTitle 과 대조한 결과가 CLEAR 일 때만 전송한다. 적중(THIRD_PARTY_TEXT)도 미검증(UNVERIFIED)도 산출 0
  if (plan.textProvenance !== 'CLEAR') return none(plan.textProvenance === 'THIRD_PARTY_TEXT' ? 'SOURCE_TEXT_THIRD_PARTY' : 'SOURCE_TEXT_UNVERIFIED')
  const candidate = {
    primaryQuery: plan.primaryQuery,
    audienceSituation: plan.audienceSituation,
    answerScope: plan.answerScope,
    inclusions: [...plan.inclusions],
    exclusions: [...plan.exclusions],
    validationProfile: plan.validationProfile,
    forbiddenClaims: [...plan.forbiddenClaims],
    cta: { communityDestination: plan.cta.communityDestination },
    relatedArticles: admitted.relatedPublic.map((a) => ({ title: a.title, slug: a.slug })),
    officialSourceUrls: [...plan.officialSourceUrls],
  }
  const problems = providerPlanProblems(candidate)
  if (problems.length) return { ok: false, providerPlan: null, providerPlanHash: null, problems }
  return { ok: true, providerPlan: candidate, providerPlanHash: sha256(canonicalJson(candidate)), problems: [] }
}
