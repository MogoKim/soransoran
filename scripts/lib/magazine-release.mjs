/**
 * Magazine vNext S3-P2 — release **조립**과 release PR **내용 관문**(runbook §0.0B.4 · charter §18-B.4).
 *
 * 두 함수가 같은 규칙을 쓴다 — writer 가 만든 것을 gate 가 처음부터 다시 만들어 바이트로 대조한다.
 *   assembleRelease     VALID·HERO_READY 후보 → (결속 · stable slug · 출판 최소 고정점 · 날짜 slot · 위상 순서) → articles.ts 새 바이트 ·
 *                       글마다 ContentPlan 파일 · hero 경로. 후보가 빠질 때마다 남은 후보의 출판 최소를 고정점까지 다시 판정한다.
 *   judgeReleaseContent main 의 Bundle · 정책 판으로 **재컴파일**한 planHash 가 PR 행 · plan 파일과 같고, 같은 admission 을 main 상태로
 *                       다시 통과하고, public graph 결속(runtime 생성 파일)이 그 plan 을 싣고, ProviderPlan 관문(내부 표식 · PII …)이
 *                       여전히 열려 있을 때만 통과한다. 기존 글 · 다른 파일 · 날짜 · slug 를 바꾼 PR 은 막는다.
 *
 * 🔴 변경 파일 모양(정본 — runbook §0.0B.4 의 "정확한 파일 이름은 S3 에서 고정"):
 *      src/content/magazine/articles.ts                그 release 의 slug 행만 더한다(기존 바이트 불변)
 *      src/content/magazine/plans/<slug>.json          그 글의 ContentPlan(재컴파일 결과의 canonical 직렬화)
 *      public/magazine/<slug>/hero.webp                hero 한 장(상세 · 목록 · 띠배너 재사용)
 * 🔴 stable slug — 한 intent 의 slug 는 처음 묶인 값을 계속 쓴다(RECORDED). 없으면 canonical mapping slug(정확히 하나) ·
 *    그것도 없으면 원고가 낸 제안 slug. 이미 쓰인 slug 와 겹치면 바꾸지 않고 그 후보만 뺀다(접미사로 피하지 않는다).
 * 🔴 publishAt 은 여기서만 정한다 — 내일부터 main · 열린 매거진 PR 이 쓰지 않은 날의 10:30 KST. 같은 release 안 관계는 대상 날짜가
 *    먼저다(층 순서). ContentPlan · planHash 에는 날짜가 없다 — 날짜를 놓쳐 다시 조립해도 plan 바이트는 같다.
 * 🔴 ProviderPlan 관문을 완화하지 않는다 — provider 로 갈 수 없는 plan(예: 내부 표식 INTERNAL_MARKER)은 release 도 merge 도 0 이다.
 *
 * 🔴 순수 모듈 — fs · cwd · env · 벽시계 · 네트워크 0. 텍스트와 사실만 받는다(경계 검사 R17 의 전이 폐포).
 */
import { byCodeUnit, canonicalJson, parsePlanInputBundle, planInputRel, sha256Hex } from './magazine-content-plan-input.mjs'
import {
  ARTICLE_RELEASE_SCHEMA, CONTENT_PLAN_POLICY_BOARD, admitContentPlans, compileContentPlans, parseArticleIdentityText, parseQueueIdentityText,
  projectProviderPlan, releaseBindingOf,
} from './magazine-content-plan.mjs'
import { ControlLocateError, locateConstLiteral, parseDataLiteral, parseGraphControl } from './magazine-graph-control.mjs'
import { KST_PUBLISH_TIME, strictOffsetTimeMs, strictPublishAtMs } from './magazine-public-rule.mjs'
import { BANNED_WORDS, HERO_HEIGHT, HERO_WIDTH } from './magazine-qa-constants.mjs'

export const RELEASE_SCHEMA = 'magazine-release/1'
export const RELEASE_ARTICLE_SCHEMA = 'magazine-release-article/1'
export const RELEASE_BRANCH_PREFIX = 'feat/magazine-release-'
export const ARTICLES_PATH = 'src/content/magazine/articles.ts'
export const BINDING_PATH = 'src/content/magazine/release-binding.ts'
export const PLAN_DIR = 'src/content/magazine/plans'
export const planFilePath = (slug) => `${PLAN_DIR}/${slug}.json`
export const heroFilePath = (slug) => `public/magazine/${slug}/hero.webp`
export const heroSrcOf = (slug) => `/magazine/${slug}/hero.webp`
/** 그 판의 ContentPlanInputBundle 경로 — 정본은 plan-input 의 planInputRel 하나 */
export const bundleFilePath = (graphVersion) => planInputRel(graphVersion)
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG_LEN = { min: 3, max: 80 }
const PUBLISH_AT_RE = /^\d{4}-\d{2}-\d{2}T10:30:00\+09:00$/
const HEX64_RE = /^[0-9a-f]{64}$/
/** 빈 날을 찾는 상한 — 1년 넘게 찬 달력은 정상 상태가 아니다(멈춘다) */
const SLOT_HORIZON_DAYS = 400

export class ReleaseError extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; this.why = why }
}
const fail = (code, why) => { throw new ReleaseError(code, why) }
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'
const nonEmpty = (v) => isStr(v) && v.trim().length > 0
const lengthOf = (s) => [...s].length
const exactInput = (input, keys, label) => {
  if (!isPlain(input)) fail('INPUT_INVALID', `${label} 입력이 객체가 아니다`)
  const extra = Object.keys(input).filter((k) => !keys.includes(k))
  if (extra.length) fail('INPUT_UNKNOWN_KEY', `${label} 가 모르는 입력: ${extra.sort(byCodeUnit).join(', ')}`)
}
const sameKeys = (v, keys) => isPlain(v) && canonicalJson(Object.keys(v).sort(byCodeUnit)) === canonicalJson([...keys].sort(byCodeUnit))

// ── 날짜 ─────────────────────────────────────────────────────

/** KST 날짜(YYYY-MM-DD) — 호출자가 준 시각에서만 계산한다 */
export const kstDateOf = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10)
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
export const publishAtOf = (day) => `${day}${KST_PUBLISH_TIME}`

/**
 * 내일(KST)부터 비어 있는 날 count 개 — occupied 는 main 과 열린 매거진 PR 이 이미 쓴 날.
 * @returns {string[]}
 */
export function freeSlots({ nowMs, occupied, count }) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) fail('INPUT_INVALID', 'nowMs 는 유한한 수다')
  const out = []
  for (let day = addDays(kstDateOf(nowMs), 1), i = 0; out.length < count; day = addDays(day, 1), i++) {
    if (i > SLOT_HORIZON_DAYS) fail('SLOT_HORIZON_EXHAUSTED', `${SLOT_HORIZON_DAYS}일 안에 빈 날이 ${count}개 없다`)
    if (!occupied.has(day)) out.push(day)
  }
  return out
}

/** 행의 공개 날짜(KST) — 엄격 시각 하나. 해석 불가면 null */
const rowDay = (row) => { const ms = strictPublishAtMs(row); return Number.isFinite(ms) ? kstDateOf(ms) : null }

// ── articles.ts 레코드 ───────────────────────────────────────

const RECORD_SPEC = { name: 'MAGAZINE_ARTICLE_RECORD', exported: false, open: '{', prefix: 'ARTICLES' }

/**
 * articles.ts 의 레코드 전체를 **데이터로만** 읽는다(JS 실행 0 · 중복 key 거부) — 기존 글 불변 대조와 새 행 추출용.
 * @returns {{ ok: true, span: {start:number,end:number}, record: Record<string, object>, slugs: string[] } | { ok: false, code: string }}
 */
export function parseArticleRecordText(text) {
  if (!isStr(text)) return { ok: false, code: 'ARTICLES_MISSING' }
  let span
  try { span = locateConstLiteral(text, RECORD_SPEC) } catch (e) { if (e instanceof ControlLocateError) return { ok: false, code: e.code }; throw e }
  let record
  try { record = parseDataLiteral(text.slice(span.start, span.end)) } catch (e) { if (e instanceof ControlLocateError) return { ok: false, code: e.code }; throw e }
  if (!isPlain(record)) return { ok: false, code: 'ARTICLES_UNREADABLE' }
  return { ok: true, span, record, slugs: Object.keys(record) }
}

/** 행 하나의 직렬화 — 레코드 안 2칸 들여쓰기 · 끝 쉼표. 같은 행 = 같은 바이트 */
const renderRow = (slug, body) => `  ${JSON.stringify(slug)}: ${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')},\n`

/**
 * 레코드 끝(닫는 `}` 바로 앞)에 행을 더한다. 🔴 그 앞 바이트와 그 뒤 바이트는 한 글자도 바꾸지 않는다.
 * 마지막 행에 끝 쉼표가 없는 등 안전하게 붙일 수 없으면 ARTICLES_INSERT_UNSAFE — 추측해서 고치지 않는다.
 */
export function insertArticleRows(text, rows) {
  const p = parseArticleRecordText(text)
  if (!p.ok) fail('ARTICLES_UNREADABLE', `articles.ts 레코드를 읽지 못했다 (${p.code})`)
  const close = p.span.end - 1
  if (text[close] !== '}') fail('ARTICLES_INSERT_UNSAFE', '레코드 닫는 괄호 위치가 어긋났다')
  const before = text.slice(0, close), after = text.slice(close)
  const trimmed = before.replace(/\s+$/u, '')
  if (!(trimmed.endsWith(',') || trimmed.endsWith('{'))) fail('ARTICLES_INSERT_UNSAFE', '마지막 행에 끝 쉼표가 없다 — 고쳐 붙이지 않는다')
  for (const r of rows) if (Object.prototype.hasOwnProperty.call(p.record, r.slug)) fail('ARTICLES_SLUG_EXISTS', `${r.slug} 가 이미 있다`)
  return `${before}${before.endsWith('\n') ? '' : '\n'}${rows.map((r) => renderRow(r.slug, r.body)).join('')}${after}`
}

// ── 후보 원고 계약 (Job → release · 읽기 전용) ───────────────

const ARTICLE_KEYS = ['body', 'description', 'heroAlt', 'medical', 'schemaVersion', 'title']
const BLOCK_KEYS = { p: ['text', 'type'], h2: ['text', 'type'], h3: ['text', 'type'], callout: ['text', 'type'], list: ['items', 'ordered', 'type'], cta: ['href', 'label', 'text', 'type'] }
const TEXT_RULE = { title: [4, 80], description: [20, 200], heroAlt: [4, 120] }
const forbiddenIn = (s) => BANNED_WORDS.some((w) => s.includes(w)) || CONTENT_PLAN_POLICY_BOARD.text.internalMarkers.some((m) => s.includes(m))

/**
 * 원고 구조 확인 — 품질 판정은 S4 검증기의 몫이고, 여기서는 release 가 쓸 수 있는 모양인지만 본다.
 *   exact key · 글자 수 · 블록 6종(image 블록 금지 — hero 는 따로) · CTA 는 plan 의 커뮤니티 목적지로만 · 금지어 · 내부 표식 0
 * @returns {string[]} 문제 코드(빈 배열이면 통과)
 */
export function articleProblems(article, plan) {
  const bad = []
  if (!sameKeys(article, ARTICLE_KEYS) || article.schemaVersion !== RELEASE_ARTICLE_SCHEMA) return ['ARTICLE_SCHEMA']
  for (const [k, [min, max]] of Object.entries(TEXT_RULE)) {
    if (!nonEmpty(article[k]) || article[k] !== article[k].trim() || lengthOf(article[k]) < min || lengthOf(article[k]) > max) bad.push(`ARTICLE_${k.toUpperCase()}_INVALID`)
  }
  if (typeof article.medical !== 'boolean') bad.push('ARTICLE_MEDICAL_INVALID')
  if (!Array.isArray(article.body) || article.body.length < 3 || article.body.length > 200) return [...bad, 'ARTICLE_BODY_INVALID']
  let ctas = 0
  for (const b of article.body) {
    const keys = isPlain(b) ? BLOCK_KEYS[b.type] : null
    if (!keys) { bad.push('ARTICLE_BLOCK_TYPE'); continue }
    const optional = b.type === 'list' ? ['ordered'] : b.type === 'cta' ? ['text'] : []
    const got = Object.keys(b)
    if (got.some((k) => !keys.includes(k)) || keys.filter((k) => !optional.includes(k)).some((k) => !got.includes(k))) { bad.push('ARTICLE_BLOCK_KEYS'); continue }
    const texts = b.type === 'list' ? b.items : b.type === 'cta' ? [b.label, ...(b.text === undefined ? [] : [b.text])] : [b.text]
    if (!Array.isArray(texts) || !texts.length || !texts.every(nonEmpty)) bad.push('ARTICLE_BLOCK_TEXT')
    else if (texts.some(forbiddenIn)) bad.push('ARTICLE_TEXT_FORBIDDEN')
    if (b.type === 'list' && b.ordered !== undefined && typeof b.ordered !== 'boolean') bad.push('ARTICLE_BLOCK_KEYS')
    if (b.type === 'cta') { ctas++; if (b.href !== plan.cta.communityDestination) bad.push('ARTICLE_CTA_DESTINATION') }
  }
  if (ctas === 0) bad.push('ARTICLE_CTA_MISSING')
  if ([article.title, article.description, article.heroAlt].some((s) => nonEmpty(s) && forbiddenIn(s))) bad.push('ARTICLE_TEXT_FORBIDDEN')
  return [...new Set(bad)].sort(byCodeUnit)
}

/** articles.ts 에 들어갈 행 — 키 순서 고정(같은 입력 = 같은 바이트) */
function rowBodyOf({ article, plan, slug, day }) {
  return {
    title: article.title,
    description: article.description,
    cluster: plan.cluster,
    publishedAt: day,
    status: 'SCHEDULED',
    publishAt: publishAtOf(day),
    ...(article.medical ? { medical: true } : {}),
    heroImage: { src: heroSrcOf(slug), alt: article.heroAlt, width: HERO_WIDTH, height: HERO_HEIGHT },
    body: article.body,
    release: { schemaVersion: ARTICLE_RELEASE_SCHEMA, intentId: plan.intentId, graphVersion: plan.graphVersion, bundleHash: plan.bundleHash,
      planHash: plan.planHash, policyBoard: { id: plan.policyBoard.id, hash: plan.policyBoard.hash } },
  }
}
const ROW_KEYS = ['body', 'cluster', 'description', 'heroImage', 'publishAt', 'publishedAt', 'release', 'status', 'title']

/** ContentPlan 파일 바이트 — 키 정렬 canonical 의 2칸 들여쓰기. 재컴파일한 plan 으로 gate 가 똑같이 만든다 */
export const renderPlanFile = (plan) => `${JSON.stringify(JSON.parse(canonicalJson(plan)), null, 2)}\n`

/** runtime 결속 생성 파일 바이트 — releaseBindingOf 결과(또는 null)를 그대로 적는다 */
export function renderBindingFile(binding) {
  const head = [
    '/**',
    ' * vNext release 출처 결속 — 생성 파일이다. 손으로 고치지 않는다.',
    ' * 만드는 곳: `node scripts/magazine-release-binding.mjs --write` — 지금 graph 판의 ContentPlanInputBundle 을 정적 컴파일한 결과 그대로.',
    ' * 검사: check:magazine-graph · scripts/magazine-release-check.mjs 가 컴파일 결과와 바이트로 대조한다.',
    ' * 판이 지금 graph 와 다르거나 null 이면 runtime 은 출처를 쓰지 않는다(폴백).',
    ' */',
    "import type { ReleaseBinding } from '@/lib/magazine-provenance-rule.mjs'",
    '',
  ].join('\n')
  return `${head}\nexport const RELEASE_BINDING: ReleaseBinding | null = ${binding === null ? 'null' : JSON.stringify(binding, null, 2)}\n`
}

// ── stable slug ─────────────────────────────────────────────

export const isValidSlug = (s) => isStr(s) && SLUG_RE.test(s) && s.length >= SLUG_LEN.min && s.length <= SLUG_LEN.max

/**
 * release 신원 경계의 slug 결속 — admission 의 SLUG_BINDING_REQUIRED 를 여기서 푼다.
 *   ① 이미 묶인 기록(RECORDED)이 있으면 그 값만 쓴다(원고가 다른 제안을 내도 바꾸지 않는다)
 *   ② canonical mapping slug 가 정확히 하나면 그것(CANONICAL) — 둘 이상이면 고르지 않는다
 *   ③ 원고 제안(PROPOSAL) — 모양이 맞을 때만
 * @returns {{ ok: true, slug: string, source: 'RECORDED'|'CANONICAL'|'PROPOSAL' } | { ok: false, code: string }}
 */
export function bindReleaseSlug({ intentId, canonicalSlugs, recorded, proposal }) {
  const canon = [...new Set(canonicalSlugs)].sort(byCodeUnit)
  if (recorded !== null && recorded !== undefined) {
    if (!isPlain(recorded) || recorded.intentId !== intentId || !isValidSlug(recorded.slug)) return { ok: false, code: 'SLUG_RECORD_INVALID' }
    if (canon.length && !canon.includes(recorded.slug)) return { ok: false, code: 'SLUG_RECORD_CANONICAL_CONFLICT' }
    return { ok: true, slug: recorded.slug, source: 'RECORDED' }
  }
  if (canon.length > 1) return { ok: false, code: 'SLUG_CANONICAL_AMBIGUOUS' }
  if (canon.length === 1) return isValidSlug(canon[0]) ? { ok: true, slug: canon[0], source: 'CANONICAL' } : { ok: false, code: 'SLUG_CANONICAL_INVALID' }
  if (!isValidSlug(proposal)) return { ok: false, code: 'SLUG_PROPOSAL_INVALID' }
  return { ok: true, slug: proposal, source: 'PROPOSAL' }
}

// ── 공통 판독 ────────────────────────────────────────────────

/** main 상태 판독 — 컴파일 · 결속 · articles · queue. 판독 실패는 code 로 돌려준다(던지지 않는다) */
function readMain({ bundle, controlText, articlesText, legacyQueue }) {
  let compiled
  try { compiled = compileContentPlans({ bundle }) } catch (e) { if (isStr(e?.code)) return { ok: false, code: `BUNDLE_${e.code}`, why: e.why ?? e.message }; throw e }
  const control = parseGraphControl(controlText)
  if (!control) return { ok: false, code: 'CONTROL_UNREADABLE', why: 'control.ts 를 엄격 판독하지 못했다' }
  if (control.graphVersion !== compiled.graphVersion) return { ok: false, code: 'PUBLIC_BINDING_MISMATCH', why: `control 판 ${control.graphVersion} ≠ Bundle 판 ${compiled.graphVersion}` }
  const identity = parseArticleIdentityText(articlesText)
  if (!identity.ok) return { ok: false, code: 'ARTICLES_UNREADABLE', why: identity.code }
  const record = parseArticleRecordText(articlesText)
  if (!record.ok) return { ok: false, code: 'ARTICLES_UNREADABLE', why: record.code }
  let queueRows = []
  if (!isPlain(legacyQueue) || typeof legacyQueue.active !== 'boolean') fail('INPUT_INVALID', 'legacyQueue 는 { active, text } 다')
  if (legacyQueue.active) {
    const q = parseQueueIdentityText(legacyQueue.text)
    if (!q.ok) return { ok: false, code: 'QUEUE_IDENTITY_UNREADABLE', why: q.code }
    queueRows = q.rows
  }
  return { ok: true, compiled, binding: releaseBindingOf(compiled), control, identity: identity.rows, record, queueRows, bundleMappings: parsePlanInputBundle(bundle).mappings,
    planByIntent: new Map(compiled.plans.map((p) => [p.intentId, p])), planById: new Map(compiled.plans.map((p) => [p.planId, p])) }
}

/** 다른 intent 의 canonical slug 와 이 intent 의 canonical slug */
const canonicalSlugsOf = (bundleMappings, intentId) => bundleMappings.filter((m) => m.intentId === intentId).map((m) => m.slug)

// ── 조립 ─────────────────────────────────────────────────────

/**
 * release 조립 — 순수. 같은 입력 = 같은 release(바이트 · releaseId).
 * @param {{
 *   bundle: string, controlText: string, articlesText: string, legacyQueue: { active: boolean, text: string|null }, nowMs: number,
 *   candidates: { planId: string, planHash: string, providerPlanHash: string|null, slugProposal: string|null, manuscriptSha256: string,
 *                 article: object, hero: { sha256: string, width: number, height: number } }[],
 *                 providerPlanHash — Job 이 원고를 만들 때 묶은 값. 지금 main 에서 다시 만든 값과 다르면 그 후보는 보류(PROVIDER_PLAN_DRIFT)
 *                 manuscriptSha256 — 검증된 원고 파일의 해시(재개 결속)
 *   slugRecords: Record<string, { intentId: string, slug: string }>,  intentId → 이미 묶인 slug
 *   occupied: { dates: string[], slugs: string[] },                     열린 매거진 PR 이 쓰는 날짜 · slug
 *   existingHeroSlugs: string[],                                        main 에 hero 폴더가 이미 있는 slug
 *   targetCandidates: number, inFlightIntentIds?: string[], baseSha?: string|null }} input   baseSha 는 releaseId 에만 쓴다(바이트 0)
 */
export function assembleRelease(input) {
  exactInput(input, ['bundle', 'controlText', 'articlesText', 'legacyQueue', 'nowMs', 'candidates', 'slugRecords', 'occupied', 'existingHeroSlugs', 'targetCandidates', 'inFlightIntentIds', 'baseSha'], 'release')
  const { bundle, controlText, articlesText, legacyQueue, nowMs, candidates, slugRecords, occupied, existingHeroSlugs, targetCandidates } = input
  if (!Array.isArray(candidates) || !isPlain(slugRecords) || !isPlain(occupied) || !Array.isArray(occupied.dates) || !Array.isArray(occupied.slugs) || !Array.isArray(existingHeroSlugs)) fail('INPUT_INVALID', 'candidates · slugRecords · occupied · existingHeroSlugs 모양')
  if (!Number.isSafeInteger(targetCandidates) || targetCandidates < 1) fail('INPUT_INVALID', 'targetCandidates 는 1 이상의 정수다')
  const inFlightIntentIds = input.inFlightIntentIds ?? []
  const main = readMain({ bundle, controlText, articlesText, legacyQueue })
  const base = { schemaVersion: RELEASE_SCHEMA, asOf: new Date(nowMs).toISOString() }
  if (!main.ok) return { ...base, ok: false, code: main.code, why: main.why, members: [], withdrawn: candidates.map((c) => ({ planId: c?.planId ?? null, reasons: [main.code] })) }
  const { compiled, binding, bundleMappings } = main
  const admissionBase = { bundle, controlText, articlesText, legacyQueue, nowMs, inFlightIntentIds }

  // 이미 쓰인 slug — main 전 행(상태 무관) · legacy queue · 다른 intent 의 canonical slug · 열린 PR · main 의 hero 폴더
  const takenBy = new Map()
  for (const s of main.record.slugs) takenBy.set(s, 'MAIN_ARTICLE')
  for (const q of main.queueRows) takenBy.set(q.slug, 'LEGACY_QUEUE')
  for (const s of occupied.slugs) takenBy.set(s, 'OPEN_PR')
  for (const s of existingHeroSlugs) if (!takenBy.has(s)) takenBy.set(s, 'MAIN_HERO')
  const releasedIntents = new Set(main.identity.filter((r) => r.release).map((r) => r.release.intentId))
  const occupiedDays = new Set(occupied.dates)
  for (const r of main.identity) { const d = rowDay(r); if (d) occupiedDays.add(d) }

  // ① 후보별 정적 판정 — 실패한 후보는 이번 release 에서 빠진다(검증됨 상태 그대로)
  const reasons = new Map()
  const addReason = (planId, code, detail = null) => { const r = reasons.get(planId) ?? []; r.push(detail ? `${code}:${detail}` : code); reasons.set(planId, r) }
  const ok = new Map()
  const seenPlan = new Set(), slugOwner = new Map()
  const sortedCandidates = [...candidates].sort((a, b) => byCodeUnit(String(a?.planId), String(b?.planId)) || byCodeUnit(String(a?.planHash), String(b?.planHash)))
  for (const c of sortedCandidates) {
    if (!isPlain(c) || !nonEmpty(c.planId)) continue
    if (seenPlan.has(c.planId)) { addReason(`${c.planId}#dup`, 'CANDIDATE_DUPLICATE'); continue }
    seenPlan.add(c.planId)
    const plan = main.planById.get(c.planId)
    if (!plan) { addReason(c.planId, 'PLAN_NOT_COMPILED'); continue }
    if (plan.planHash !== c.planHash) { addReason(c.planId, 'PLAN_STALE'); continue }
    // 이미 출시된 intent(상태 무관) — slug 충돌보다 먼저 정확한 이유로 뺀다(admission 의 DUPLICATE_RELEASED_INTENT 와 같은 규칙)
    if (releasedIntents.has(plan.intentId)) { addReason(c.planId, 'DUPLICATE_RELEASED_INTENT'); continue }
    // 🔴 ProviderPlan 관문 그대로 — provider 로 갈 수 없는 plan 의 원고는 release 하지 않는다(내부 표식 · PII · 원문 경계 …)
    const pp = projectProviderPlan({ admission: admissionBase, planId: plan.planId, planHash: plan.planHash })
    //   admission 에서 빠지는 후보(NOT_ADMITTED)는 아래 고정점이 admission 의 실제 사유로 뺀다 — 여기서 흐린 사유로 덮지 않는다
    const ppCodes = [...new Set(pp.problems.map((p) => p.code))].sort(byCodeUnit)
    if (!pp.ok && ppCodes.join() !== 'NOT_ADMITTED') { addReason(c.planId, 'PROVIDER_PLAN_HOLD', ppCodes.join('+')); continue }
    // 🔴 원고가 쓰인 입력 = 지금 release 하려는 입력 — Job 이 기록한 ProviderPlan 해시가 지금 main 에서 다시 만든 값과 같아야 한다.
    //    다르면(관련 글 · 제목이 그 사이 바뀜) 그 원고가 어떤 입력으로 쓰였는지 설명할 수 없다 — 그 후보만 보류한다(재생성이 아니라 재검토 대상).
    //    기록이 없으면 대조할 수 없다 — 다시 만든 값으로 대신 채우지 않는다.
    if (pp.ok && c.providerPlanHash !== pp.providerPlanHash) { addReason(c.planId, HEX64_RE.test(String(c.providerPlanHash)) ? 'PROVIDER_PLAN_DRIFT' : 'PROVIDER_PLAN_UNBOUND'); continue }
    // 검증된 원고의 해시 — journal 의 재개 결속이 쓴다. 없으면 이어받을 때 대조할 수 없다
    if (!HEX64_RE.test(String(c.manuscriptSha256))) { addReason(c.planId, 'MANUSCRIPT_UNBOUND'); continue }
    const ap = articleProblems(c.article, plan)
    if (ap.length) { addReason(c.planId, 'ARTICLE_INVALID', ap.join('+')); continue }
    if (!isPlain(c.hero) || !/^[0-9a-f]{64}$/.test(String(c.hero.sha256)) || c.hero.width !== HERO_WIDTH || c.hero.height !== HERO_HEIGHT) { addReason(c.planId, 'HERO_INVALID'); continue }
    const bound = bindReleaseSlug({ intentId: plan.intentId, canonicalSlugs: canonicalSlugsOf(bundleMappings, plan.intentId), recorded: slugRecords[plan.intentId] ?? null, proposal: c.slugProposal })
    if (!bound.ok) { addReason(c.planId, bound.code); continue }
    const otherCanon = bundleMappings.some((m) => m.slug === bound.slug && m.intentId !== plan.intentId)
    if (otherCanon) { addReason(c.planId, 'SLUG_TAKEN', 'CANONICAL_OTHER_INTENT'); continue }
    if (takenBy.has(bound.slug)) { addReason(c.planId, 'SLUG_TAKEN', takenBy.get(bound.slug)); continue }
    if (slugOwner.has(bound.slug)) { addReason(c.planId, 'SLUG_TAKEN', 'SAME_RELEASE'); continue }
    slugOwner.set(bound.slug, c.planId)
    ok.set(c.planId, { c, plan, slug: bound.slug, slugSource: bound.source, providerPlanHash: pp.providerPlanHash })
  }

  // ② 출판 최소 고정점 — 후보 밖 plan 은 전부 withdrawn 으로 넘긴다(같은 release 대상으로 세지 않는다).
  //    admission 이 빠진 후보 때문에 관계를 잃은 후보를 빼고, 상한(targetCandidates)으로 뺀 뒤에도 같은 판정을 다시 돈다.
  let live = new Set(ok.keys())
  let adm = null
  for (let round = 0; round <= candidates.length + 1; round++) {
    adm = admitContentPlans({ ...admissionBase, withdrawnPlanIds: compiled.plans.map((p) => p.planId).filter((id) => !live.has(id)) })
    const admitted = adm.admitted.filter((a) => live.has(a.planId)).sort((a, b) => a.layer - b.layer || byCodeUnit(a.planId, b.planId))
    const next = new Set(admitted.slice(0, targetCandidates).map((a) => a.planId))
    for (const id of live) {
      if (next.has(id)) continue
      const held = adm.held.find((h) => h.planId === id)
      if (held) addReason(id, 'ADMISSION_HELD', held.reasons.filter((r) => r !== 'WITHDRAWN').join('+') || 'WITHDRAWN')
      else addReason(id, 'TARGET_CANDIDATES_CAP')
    }
    if (next.size === live.size) break
    live = next
  }
  const admittedById = new Map(adm.admitted.map((a) => [a.planId, a]))
  const memberIds = [...live].sort((a, b) => admittedById.get(a).layer - admittedById.get(b).layer || byCodeUnit(a, b))

  // ③ 날짜 — 층 순서대로 빈 날을 준다(대상이 먼저 공개된다)
  const days = memberIds.length ? freeSlots({ nowMs, occupied: occupiedDays, count: memberIds.length }) : []
  const dayOf = new Map(memberIds.map((id, i) => [id, days[i]]))
  for (const id of memberIds) {
    for (const g of admittedById.get(id).groundedBy) {
      if (g.target === 'SAME_RELEASE' && !(dayOf.get(g.planId) < dayOf.get(id))) fail('SAME_RELEASE_ORDER', `${id} 의 대상 ${g.planId} 가 먼저 공개되지 않는다`)
    }
  }
  const members = memberIds.map((id) => {
    const m = ok.get(id), a = admittedById.get(id)
    // 🔴 admission 을 통과한 후보는 ProviderPlan 도 열려 있어야 한다(NOT_ADMITTED 를 미룬 후보가 여기 올 수 없다) — 아니면 멈춘다
    if (!m.providerPlanHash) fail('PROVIDER_PLAN_UNRESOLVED', `${id} 의 ProviderPlan 을 확인하지 못했다`)
    return { planId: id, planHash: m.plan.planHash, intentId: m.plan.intentId, cluster: m.plan.cluster, slug: m.slug, slugSource: m.slugSource,
      publishAt: publishAtOf(dayOf.get(id)), layer: a.layer, groundedBy: a.groundedBy, providerPlanHash: m.providerPlanHash, heroSha256: m.c.hero.sha256,
      manuscriptSha256: m.c.manuscriptSha256 }
  })
  const withdrawn = [...reasons.entries()].map(([planId, rs]) => ({ planId, reasons: [...new Set(rs)].sort(byCodeUnit) })).sort((a, b) => byCodeUnit(a.planId, b.planId))
  if (!members.length) return { ...base, ok: false, code: 'NO_RELEASABLE_CANDIDATE', why: '출판 최소 · 결속 · slug 를 통과한 후보가 없다', members, withdrawn }

  // ④ 바이트 — articles.ts 새 행 · ContentPlan 파일 · hero 경로
  const rows = memberIds.map((id) => { const m = ok.get(id); return { slug: m.slug, body: rowBodyOf({ article: m.c.article, plan: m.plan, slug: m.slug, day: dayOf.get(id) }) } })
  const afterText = insertArticleRows(articlesText, rows)
  const verify = judgeReleaseText({ beforeText: articlesText, afterText, slugs: rows.map((r) => r.slug) })
  if (!verify.ok) fail('RELEASE_SELF_CHECK', verify.why)
  const files = [
    ...members.map((m) => ({ path: planFilePath(m.slug), text: renderPlanFile(ok.get(m.planId).plan) })),
    ...members.map((m) => ({ path: heroFilePath(m.slug), heroSha256: m.heroSha256, planHash: m.planHash })),
  ]
  // releaseId — 같은 main · 같은 구성 · 같은 날짜면 같은 id(재실행이 같은 release 를 이어 간다). main 이 바뀌면 새 id
  const releaseId = `${kstDateOf(nowMs).replace(/-/g, '')}-${sha256Hex(canonicalJson([input.baseSha ?? null, ...members.map((m) => [m.planHash, m.slug, m.publishAt])])).slice(0, 10)}`
  return {
    ...base, ok: true, code: null, why: null, releaseId, branch: `${RELEASE_BRANCH_PREFIX}${releaseId}`,
    graphVersion: compiled.graphVersion, bundleHash: compiled.bundleHash, policyBoard: compiled.policyBoard, binding,
    members, withdrawn,
    articles: { path: ARTICLES_PATH, beforeSha256: sha256Hex(articlesText), afterSha256: sha256Hex(afterText), afterText },
    files,
  }
}

/** writer 자기 확인 — 레코드 앞 · 뒤 바이트 불변 · 새 바이트가 판독되고 새 행의 출처가 엄격 판독된다 · 새 행 수가 맞다 */
function judgeReleaseText({ beforeText, afterText, slugs }) {
  const b = parseArticleRecordText(beforeText), c = parseArticleRecordText(afterText)
  if (!b.ok || !c.ok) return { ok: false, why: '레코드 판독 실패' }
  const close = b.span.end - 1
  if (!afterText.startsWith(beforeText.slice(0, close).replace(/\s+$/u, '')) || !afterText.endsWith(beforeText.slice(close))) return { ok: false, why: '레코드 밖 바이트가 바뀌었다' }
  const a = parseArticleIdentityText(afterText)
  if (!a.ok) return { ok: false, why: `새 articles.ts 를 판독하지 못했다 (${a.code})` }
  const added = c.slugs.slice(b.slugs.length)
  if (canonicalJson(added) !== canonicalJson(slugs) || !added.every((s) => a.rows.find((r) => r.slug === s)?.release)) return { ok: false, why: '새 행 · 출처가 조립 결과와 다르다' }
  return { ok: true }
}

// ── release PR 내용 관문 ─────────────────────────────────────

/**
 * release PR 내용 관문 — 순수. main 의 사실과 PR head 의 바이트만 받는다.
 * @param {{
 *   main: { bundle: string|null, controlText: string, articlesText: string, legacyQueue: { active: boolean, text: string|null }, bindingText: string|null },
 *   head: { articlesText: string, baseArticlesText?: string, planTexts: Record<string, string|null>, heroPresent: Record<string, boolean> },
 *          baseArticlesText — PR head 와 main 의 merge-base 의 articles.ts(낡은 release 판정)
 *   changedFiles: string[], occupied: { dates: string[], slugs: string[] }, nowMs: number }} input
 *   occupied   main 밖에서 이미 쓰인 날짜 · slug — 이 PR 을 뺀 다른 열린 매거진 PR
 * @returns {{ ok: boolean, blockedBy: {code:string, message:string}[], checked: string[], members: {slug:string, intentId:string, planHash:string, publishAt:string}[] }}
 */
export function judgeReleaseContent(input) {
  exactInput(input, ['main', 'head', 'changedFiles', 'occupied', 'nowMs'], 'release gate')
  const { main: M, head, changedFiles, occupied, nowMs } = input
  const blockedBy = [], checked = []
  const block = (code, message) => blockedBy.push({ code, message })
  const done = (members = []) => ({ ok: blockedBy.length === 0, blockedBy, checked, members })
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) { block('CLOCK_INVALID', '판정 시각이 없다'); return done() }
  if (!isStr(M?.bundle)) { block('BUNDLE_MISSING', 'main 에 지금 graph 판의 ContentPlanInputBundle 이 없다 — 재컴파일할 수 없으면 막는다'); return done() }

  // ① main 재컴파일 · public graph 결속
  const main = readMain({ bundle: M.bundle, controlText: M.controlText, articlesText: M.articlesText, legacyQueue: M.legacyQueue })
  if (!main.ok) { block(main.code, main.why); return done() }
  if (M.bindingText !== renderBindingFile(main.binding)) {
    block('PUBLIC_BINDING_MISMATCH', `main 의 ${BINDING_PATH} 가 Bundle 재컴파일 결속과 다르다 — 공개 graph 가 이 release 의 출처를 그리지 못한다`)
    return done()
  }
  checked.push(`main 재컴파일 ${main.compiled.plans.length} plan · 결속 ${main.compiled.graphVersion} = control · runtime 생성 파일 일치`)

  // ② articles.ts — PR 의 기준(merge-base)이 지금 main 과 같아야 한다. 다르면 변조가 아니라 낡은 release — 닫고 다시 조립한다
  if (isStr(head?.baseArticlesText) && head.baseArticlesText !== M.articlesText) {
    block('PR_BASE_STALE', 'release PR 을 만든 뒤 main 의 articles.ts 가 바뀌었다 — 이 PR 은 닫고 지금 main 으로 다시 조립한다')
    return done()
  }
  //   기존 행 불변 · 새 행만 · 바이트는 writer 규칙 그대로
  const before = main.record
  const after = parseArticleRecordText(head?.articlesText)
  const afterIdentity = parseArticleIdentityText(head?.articlesText)
  if (!after.ok || !afterIdentity.ok) { block('HEAD_ARTICLES_UNREADABLE', `PR 의 articles.ts 를 판독하지 못했다 (${after.ok ? afterIdentity.code : after.code})`); return done() }
  const touched = before.slugs.filter((s, i) => after.slugs[i] !== s || canonicalJson(after.record[s]) !== canonicalJson(before.record[s]))
  if (touched.length) { block('EXISTING_ARTICLE_TOUCHED', `기존 글이 바뀌었다: ${touched.join(', ')} — release 는 새 글만 더한다`); return done() }
  const newSlugs = after.slugs.slice(before.slugs.length)
  if (!newSlugs.length) { block('NOTHING_RELEASED', 'PR 이 더한 글이 없다'); return done() }
  let rebuilt = null
  try { rebuilt = insertArticleRows(M.articlesText, newSlugs.map((slug) => ({ slug, body: after.record[slug] }))) } catch (e) { if (!(e instanceof ReleaseError)) throw e }
  if (rebuilt !== head.articlesText) block('ARTICLES_SHAPE_DRIFT', 'articles.ts 바이트가 writer 규칙(레코드 끝에 행 추가)과 다르다')

  // ③ 새 행마다 — 출처 · 재컴파일 planHash · plan 파일 · 행 모양 · 날짜 · slug · hero
  const idOf = new Map(afterIdentity.rows.map((r) => [r.slug, r]))
  const mainDays = new Set(main.identity.map(rowDay).filter(Boolean))
  const openDays = new Set(occupied?.dates ?? []), openSlugs = new Set(occupied?.slugs ?? [])
  const queueSlugs = new Set(main.queueRows.map((q) => q.slug))
  const bundleMappings = main.bundleMappings
  const members = []
  const seenDay = new Map()
  for (const slug of newSlugs) {
    const row = after.record[slug], id = idOf.get(slug), rel = id?.release
    if (!rel) { block('RELEASE_PROVENANCE_MISSING', `${slug} 에 vNext 출처가 없다 — release PR 은 출처 있는 행만 더한다`); continue }
    const plan = main.planByIntent.get(rel.intentId)
    if (!plan) { block('PLAN_NOT_COMPILED', `${slug} 의 intent ${rel.intentId} 는 main Bundle 에서 컴파일되지 않는다`); continue }
    if (rel.planHash !== plan.planHash || rel.bundleHash !== main.binding.bundleHash || rel.graphVersion !== main.binding.graphVersion
      || rel.policyBoard.id !== main.binding.policyBoard.id || rel.policyBoard.hash !== main.binding.policyBoard.hash) {
      block('PLAN_HASH_MISMATCH', `${slug} 의 출처가 main 재컴파일 plan(${plan.planHash.slice(0, 12)})과 다르다 — PR 이 plan 을 바꿔 통과할 수 없다`)
      continue
    }
    if (main.binding.planHashOf[rel.intentId] !== rel.planHash) { block('PUBLIC_BINDING_MISMATCH', `${slug} 의 plan 이 공개 graph 결속에 없다`); continue }
    if (!isValidSlug(slug)) block('SLUG_SHAPE', `${slug} 모양`)
    const planText = head?.planTexts?.[planFilePath(slug)]
    if (planText !== renderPlanFile(plan)) block('PLAN_FILE_MISMATCH', `${planFilePath(slug)} 가 main 재컴파일 ContentPlan 과 바이트로 다르다`)
    if (!sameKeys(row, ROW_KEYS) && !sameKeys(row, [...ROW_KEYS, 'medical'])) block('ROW_SHAPE', `${slug} 행의 키가 release 계약과 다르다`)
    if (Object.prototype.hasOwnProperty.call(row, 'medical') && row.medical !== true) block('ROW_SHAPE', `${slug} medical 은 true 일 때만 싣는다`)
    if (row.status !== 'SCHEDULED') block('STATUS_UNEXPECTED', `${slug} 의 status 가 ${row.status} 다`)
    if (row.cluster !== plan.cluster) block('CLUSTER_MISMATCH', `${slug} 의 cluster ${row.cluster} ≠ plan ${plan.cluster}`)
    const art = { schemaVersion: RELEASE_ARTICLE_SCHEMA, title: row.title, description: row.description, heroAlt: row.heroImage?.alt, medical: row.medical === true, body: row.body }
    const ap = articleProblems(art, plan)
    if (ap.length) block('ARTICLE_INVALID', `${slug}: ${ap.join(', ')}`)
    // 날짜 — 10:30 KST · publishedAt 일치 · 미래 · PR 안 · main · 다른 열린 PR 과 중복 0
    const at = String(row.publishAt ?? '')
    const ms = strictOffsetTimeMs(at)
    const day = at.slice(0, 10)
    if (!PUBLISH_AT_RE.test(at) || !Number.isFinite(ms)) block('PUBLISH_AT_SHAPE', `${slug} 의 publishAt 이 10:30 KST 형태가 아니다: ${at || '없음'}`)
    else {
      if (row.publishedAt !== day) block('DATE_MISMATCH', `${slug} 의 publishedAt(${row.publishedAt}) ≠ publishAt 날짜(${day})`)
      if (ms <= nowMs) block('PUBLISH_AT_PAST', `${slug} 의 publishAt 이 이미 지났다(${at}) — merge 하면 즉시 공개된다. PR 을 닫고 다시 조립한다`)
      if (seenDay.has(day)) block('DUPLICATE_DATE_IN_PR', `${day} 가 PR 안에 두 번 있다`)
      if (mainDays.has(day)) block('DUPLICATE_DATE_IN_MAIN', `${day} 가 이미 main 에서 차 있다`)
      if (openDays.has(day)) block('DUPLICATE_DATE_OPEN_PR', `${day} 를 다른 열린 매거진 PR 이 쓴다`)
      seenDay.set(day, slug)
    }
    if (queueSlugs.has(slug)) block('DUPLICATE_SLUG_IN_QUEUE', `${slug} 가 legacy queue 에 있다`)
    if (openSlugs.has(slug)) block('DUPLICATE_SLUG_OPEN_PR', `${slug} 를 다른 열린 매거진 PR 이 쓴다`)
    const canon = canonicalSlugsOf(bundleMappings, rel.intentId)
    if (bundleMappings.some((m) => m.slug === slug && m.intentId !== rel.intentId)) block('SLUG_CANONICAL_CONFLICT', `${slug} 는 다른 intent 의 canonical slug 다`)
    else if (canon.length && !(canon.length === 1 && canon[0] === slug)) block('SLUG_CANONICAL_CONFLICT', `${rel.intentId} 의 canonical slug(${canon.join(',')})가 아닌 slug 다`)
    // hero — 경로 고정 · 크기 · PR head 에 파일
    const hero = row.heroImage
    if (!isPlain(hero) || hero.src !== heroSrcOf(slug) || hero.width !== HERO_WIDTH || hero.height !== HERO_HEIGHT || !sameKeys(hero, ['alt', 'height', 'src', 'width'])) block('HERO_SHAPE', `${slug} 의 heroImage 가 ${heroSrcOf(slug)} ${HERO_WIDTH}x${HERO_HEIGHT} 가 아니다`)
    if (head?.heroPresent?.[heroFilePath(slug)] !== true) block('HERO_FILE_ABSENT', `${heroFilePath(slug)} 가 PR head 에 없다`)
    members.push({ slug, intentId: rel.intentId, planId: plan.planId, planHash: plan.planHash, publishAt: at })
  }

  // ④ 변경 파일 — 정확히 articles.ts + slug 마다 plan · hero
  const want = new Set([ARTICLES_PATH, ...newSlugs.flatMap((s) => [planFilePath(s), heroFilePath(s)])])
  const got = new Set(changedFiles ?? [])
  const unexpected = [...got].filter((f) => !want.has(f)).sort(byCodeUnit)
  const missing = [...want].filter((f) => !got.has(f)).sort(byCodeUnit)
  if (unexpected.length) block('UNEXPECTED_FILES', `release 가 바꿀 수 없는 파일: ${unexpected.join(', ')}`)
  if (missing.length) block('MISSING_FILES', `release 에 있어야 할 파일이 바뀌지 않았다: ${missing.join(', ')}`)
  if (!unexpected.length && !missing.length) checked.push(`변경 파일 ${got.size}개 = articles.ts + 글 ${newSlugs.length}편의 plan · hero`)

  // ⑤ admission 재판정(main 상태 · 이 시각) — 같은 release 밖 plan 은 withdrawn. 같은 release 관계는 대상이 먼저 공개
  if (members.length === newSlugs.length && blockedBy.length === 0) {
    const memberIds = new Set(members.map((m) => m.planId))
    const admissionBase = { bundle: M.bundle, controlText: M.controlText, articlesText: M.articlesText, legacyQueue: M.legacyQueue, nowMs }
    const adm = admitContentPlans({ ...admissionBase, withdrawnPlanIds: main.compiled.plans.map((p) => p.planId).filter((id) => !memberIds.has(id)) })
    const at = new Map(members.map((m) => [m.planId, strictOffsetTimeMs(m.publishAt)]))
    for (const m of members) {
      const a = adm.admitted.find((x) => x.planId === m.planId)
      if (!a) { block('ADMISSION_HELD', `${m.slug}: ${(adm.held.find((h) => h.planId === m.planId)?.reasons ?? ['UNKNOWN']).join(', ')}`); continue }
      for (const g of a.groundedBy) if (g.target === 'SAME_RELEASE' && !(at.get(g.planId) < at.get(m.planId))) block('SAME_RELEASE_ORDER', `${m.slug} 의 같은 release 대상(${g.planId})이 먼저 공개되지 않는다`)
      // 🔴 ProviderPlan 관문 그대로 — merge 직전에도 provider 로 갈 수 없는 plan 이면 막는다
      const pp = projectProviderPlan({ admission: admissionBase, planId: m.planId, planHash: m.planHash })
      if (!pp.ok) block('PROVIDER_PLAN_HOLD', `${m.slug}: ${[...new Set(pp.problems.map((p) => p.code))].sort(byCodeUnit).join(', ')}`)
    }
    if (blockedBy.length === 0) checked.push(`admission 재판정 ${members.length}편 통과 · 같은 release 순서 · ProviderPlan 관문 열림`)
  }
  return done(members)
}
