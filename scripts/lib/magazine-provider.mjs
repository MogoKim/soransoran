/**
 * Magazine vNext S4 — provider 계약 (runbook §0.0B.2). ManuscriptProvider · ImageProvider 는 실패 · 비용 · 재시도가 독립이다.
 *
 * 이 파일이 정하는 것
 *   요청 바이트   buildManuscriptBody · buildRepairBody · buildImageBody — 입력은 ProviderPlan(+ 수리 대상) 하나뿐이다.
 *                 graph · queue · publishAt · PR · Git · planHash · 로컬 경로를 싣지 않는다. previous_response_id 를 쓰지 않는다.
 *   응답 판독     readSubmit · readTerminal · parseManuscriptText · parseRepairText · readImage — fake 와 실제가 **같은 판독기**를 지난다.
 *   비용          estimateCostUsd(전송 전 최악 추정 · 상한 판정용) · actualCostUsd(usage 기준). 단가는 설정에서만 받는다(지어내지 않는다).
 *   실제 adapter  makeOpenAiProviders — Responses API(background · store:true) · Images API. 🔴 키는 인자로만 받고 어디에도 쓰지 않는다.
 *
 * 🔴 wire 는 { httpStatus, bodyText } 다. 해석은 호출자가 응답 바이트를 먼저 원자 저장한 **뒤에** 한다(급사해도 ID 를 되찾는다).
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { canonicalJson } from './magazine-content-plan-input.mjs'
import { BANNED_WORDS } from './magazine-qa-constants.mjs'
import { CONTENT_PLAN_POLICY_BOARD } from './magazine-content-plan.mjs'

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string'

export const MANUSCRIPT_CONTRACT_ID = 'magazine-manuscript-contract/1'
export const REPAIR_CONTRACT_ID = 'magazine-repair-contract/1'
export const IMAGE_CONTRACT_ID = 'magazine-hero-contract/1'

// ── 원고 계약 ────────────────────────────────────────────────

const textBlock = (t) => ({ type: 'object', additionalProperties: false, required: ['type', 'text'], properties: { type: { type: 'string', enum: [t] }, text: { type: 'string' } } })
export const MANUSCRIPT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['title', 'description', 'heroAlt', 'heroScene', 'slugProposal', 'body'],
  properties: {
    title: { type: 'string' }, description: { type: 'string' }, heroAlt: { type: 'string' }, heroScene: { type: 'string' }, slugProposal: { type: 'string' },
    body: { type: 'array', items: { anyOf: [textBlock('p'), textBlock('h2'), textBlock('h3'), textBlock('callout'),
      { type: 'object', additionalProperties: false, required: ['type', 'items', 'ordered'], properties: { type: { type: 'string', enum: ['list'] }, items: { type: 'array', items: { type: 'string' } }, ordered: { type: 'boolean' } } },
      { type: 'object', additionalProperties: false, required: ['type', 'label', 'text'], properties: { type: { type: 'string', enum: ['cta'] }, label: { type: 'string' }, text: { type: 'string' } } }] } },
  },
})
export const REPAIR_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['replacement'], properties: { replacement: { type: 'string' } } })

/** 원고 지시 — 검증기(lib/magazine-vnext-qa.mjs)가 보는 것을 미리 알린다. 내부 표식 · 경로 · 시스템 이름을 쓰지 않는다 */
export const MANUSCRIPT_INSTRUCTIONS = [
  '당신은 소란소란 매거진 편집팀의 기사 한 편을 쓴다. 독자는 40대 중반에서 60대 중반의 여성이다.',
  '입력 JSON 의 primaryQuery 로 검색해 들어온 독자에게 answerScope 범위의 답을 준다. audienceSituation 이 독자의 지금 상황이다. 첫 문단에서 바로 답의 방향을 말한다.',
  '지킬 것:',
  '- 한국어 습니다체. 편집팀 시점으로 쓴다. 저는·제가 같은 1인칭 화자와 개인 경험담을 쓰지 않는다. 지난 일을 회상하는 문장보다 지금 할 수 있는 것을 쓴다.',
  '- exclusions 의 주제는 다루지 않는다. forbiddenClaims 에 해당하는 주장을 하지 않는다. inclusions 가 있으면 다룬다.',
  '- 독자가 양식을 작성하려고 온 경우, 가장 막히는 칸을 골라 가상의 상황과 그 칸에 그대로 들어갈 완성 예시를 함께 보여 준다. 필수 표시가 있는 칸, 선택 칸, 자유 양식은 구분한다.',
  '- 오래된 경력을 직무에 맞게 쓰는 글이라면 공고의 담당 업무 하나와 과거에 실제 했다고 가정한 일 하나를 먼저 밝힌다. 같은 사례에서 지원자가 경력란에 옮겨 적을 한 줄을 callout에 쓴다. 그 줄에 기간·역할과 구체적으로 무엇을 어떻게 처리했는지가 드러나게 한다. 공백 사유나 교육 이력은 경력 예시와 따로 쓴다. 가상 예시임을 본문에서 밝히고 확인할 수 없는 성과를 붙이지 않는다.',
  '- 통계 · 퍼센트 · 순위 · 조사 결과 · 기관 발표를 지어내지 않는다. 숫자가 꼭 필요하면 사람마다 다르다고 밝힌다. 본문에 URL 을 쓰지 않는다.',
  '- 의료 · 법률 · 세금 · 금융을 단정하지 않는다. 반드시 · 완치 · 보장 같은 말을 쓰지 않는다. 특정 상품 · 업체를 추천하지 않는다.',
   `- 독자를 나이로 묶는 다음 표현은 피한다: ${BANNED_WORDS.join(', ')}.`,
  '- relatedArticles 는 이미 공개된 다른 글이다. 그 내용을 되풀이하지 말고 이 글만의 답에 집중한다. 그 제목이나 링크를 본문에 적지 않는다.',
  '- 원고 밖의 말을 쓰지 않는다: 인사 · 작성 안내 · 요청 확인 · AI 라는 자기 언급 · 대괄호나 중괄호 자리표시자 · 마크다운 기호.',
  '형식:',
  '- title: 8~60자. primaryQuery 의 핵심어를 담는다.',
  '- description: 90~120자 안팎(60~160자)의 요약 한두 문장.',
  '- body: p · h2 · h3 · callout · list · cta 블록만 쓴다. h2 는 4~6개. 본문 전체 공백 제외 1,200~2,500자. cta 는 맨 끝에 정확히 1개 — label 은 커뮤니티에 이야기를 남겨 달라는 짧은 말, text 는 한 문장 안내.',
  '- heroAlt: 대표 이미지를 설명하는 한 문장(4~120자).',
  '- heroScene: 대표 이미지로 그릴 장면 묘사. 가로 16:9 구도. 생활 공간의 사물 · 손 · 뒷모습 위주로, 얼굴 클로즈업 · 글자 · 로고 · 워터마크 없이.',
  '- slugProposal: 영문 소문자 · 숫자 · 하이픈만, 3~80자.',
].join('\n')

export const REPAIR_INSTRUCTIONS = [
  '당신은 소란소란 매거진 편집팀의 교정자다. 입력의 providerPlan 이 기사 범위이고, target.current 가 고칠 칸(또는 문장) 하나다.',
  'target.problems 에 적힌 문제만 고쳐 replacement 하나를 낸다. 뜻 · 길이 · 말투를 유지하고 새 사실 · 숫자 · 링크를 더하지 않는다.',
  '문장 대상이고 그 문장을 빼는 것이 맞으면 replacement 를 빈 문자열로 낸다. 칸 대상(title · description · heroAlt)은 빈 문자열을 내지 않는다.',
   `독자를 나이로 묶는 표현(${BANNED_WORDS.join(', ')})을 피한다. 습니다체. 원고 밖의 말을 쓰지 않는다.`,
].join('\n')

export const HERO_STYLE = '따뜻하고 차분한 생활 사진 느낌. 가로 16:9 구도. 글자 · 숫자 · 로고 · 워터마크 없음. 사람 얼굴을 정면으로 크게 그리지 않는다. 장면:'

for (const [name, text] of [['MANUSCRIPT_INSTRUCTIONS', MANUSCRIPT_INSTRUCTIONS], ['REPAIR_INSTRUCTIONS', REPAIR_INSTRUCTIONS], ['HERO_STYLE', HERO_STYLE]]) {
  // 🔴 지시문도 provider 로 나간다 — 내부 표식이 섞이면 적재 단계에서 멈춘다
  if (CONTENT_PLAN_POLICY_BOARD.text.internalMarkers.some((m) => text.includes(m))) throw new Error(`${name} 에 내부 표식이 있다`)
}

/** 계약 해시 — 지시 · schema · 모델 · 출력 상한. 바뀌면 같은 planHash 라도 다른 계약이다(Job 에 기록) */
export const contractHashOf = ({ id, instructions, schema, model, maxOutputTokens = null, size = null }) => sha256(canonicalJson({ id, instructions, schema, model, maxOutputTokens, size }))

const jsonFormat = (name, schema) => ({ format: { type: 'json_schema', name, schema, strict: true } })

export function manuscriptContractHash({ model, maxOutputTokens }) {
  return contractHashOf({ id: MANUSCRIPT_CONTRACT_ID, instructions: MANUSCRIPT_INSTRUCTIONS, schema: MANUSCRIPT_SCHEMA, model, maxOutputTokens })
}

/** 원고 요청 바디 — background · store:true. 입력은 ProviderPlan JSON 하나 */
export function buildManuscriptBody({ providerPlan, model, maxOutputTokens }) {
  const body = { model, instructions: MANUSCRIPT_INSTRUCTIONS, input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(providerPlan) }] }],
    text: jsonFormat('magazine_manuscript', MANUSCRIPT_SCHEMA), background: true, store: true, max_output_tokens: maxOutputTokens }
  return { body, bodyText: JSON.stringify(body), contractHash: manuscriptContractHash({ model, maxOutputTokens }) }
}

/**
 * 부분 수리 바디 — 🔴 previous_response_id 0. 필요한 맥락(ProviderPlan · 고칠 칸 · 문제)을 매번 명시적으로 보낸다.
 * @param {{ providerPlan: object, target: { kind: 'field'|'sentence', field?: string, current: string, problems: string[] }, model: string, maxOutputTokens: number }} p
 */
export function buildRepairBody({ providerPlan, target, model, maxOutputTokens }) {
  const payload = { providerPlan, target: { kind: target.kind, ...(target.field ? { field: target.field } : {}), current: target.current, problems: target.problems } }
  const body = { model, instructions: REPAIR_INSTRUCTIONS, input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(payload) }] }],
    text: jsonFormat('magazine_repair', REPAIR_SCHEMA), background: true, store: true, max_output_tokens: maxOutputTokens }
  return { body, bodyText: JSON.stringify(body), contractHash: contractHashOf({ id: REPAIR_CONTRACT_ID, instructions: REPAIR_INSTRUCTIONS, schema: REPAIR_SCHEMA, model, maxOutputTokens }) }
}

/** hero 한 장 — 검증된 원고의 heroScene 만 보낸다 */
export function buildImageBody({ heroScene, model, size }) {
  const body = { model, prompt: `${HERO_STYLE} ${heroScene}`, size, quality: 'medium', n: 1 }
  return { body, bodyText: JSON.stringify(body), contractHash: contractHashOf({ id: IMAGE_CONTRACT_ID, instructions: HERO_STYLE, schema: { quality: body.quality }, model, size }) }
}

// ── 응답 판독 (fake · 실제 공통) ─────────────────────────────

export const parseWire = (text) => { try { const j = JSON.parse(text); return isPlain(j) ? j : null } catch { return null } }
const RESP_ID = /^[A-Za-z0-9_-]{4,128}$/
const TERMINAL = new Set(['completed', 'failed', 'incomplete', 'cancelled'])

/** 제출 응답 — id · status · store 실효값. id 가 없으면 null */
export function readSubmit(json) {
  if (!isPlain(json) || !RESP_ID.test(String(json.id ?? ''))) return null
  return { id: json.id, status: String(json.status ?? ''), store: typeof json.store === 'boolean' ? json.store : null }
}

/** 조회 응답 — terminal 이면 출력 텍스트 · 거절 · usage · 실패 사유 */
export function readTerminal(json) {
  if (!isPlain(json)) return { terminal: false, status: null }
  const status = String(json.status ?? '')
  if (!TERMINAL.has(status)) return { terminal: false, status }
  let outputText = null, refusal = null
  for (const item of Array.isArray(json.output) ? json.output : []) {
    if (item?.type !== 'message') continue
    for (const c of Array.isArray(item.content) ? item.content : []) {
      if (c?.type === 'output_text' && isStr(c.text)) outputText = (outputText ?? '') + c.text
      if (c?.type === 'refusal') refusal = String(c.refusal ?? 'refusal')
    }
  }
  const u = isPlain(json.usage) ? json.usage : null
  const usage = u && Number.isSafeInteger(u.input_tokens) && Number.isSafeInteger(u.output_tokens)
    ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, details: u.input_tokens_details ?? null } : null
  return { terminal: true, status, outputText, refusal, usage, store: typeof json.store === 'boolean' ? json.store : null,
    incompleteReason: json.incomplete_details?.reason ?? null, error: json.error?.code ?? json.error?.message ?? null }
}

const BLOCK_KEYS = { p: ['text', 'type'], h2: ['text', 'type'], h3: ['text', 'type'], callout: ['text', 'type'], list: ['items', 'ordered', 'type'], cta: ['label', 'text', 'type'] }
const sameKeys = (o, keys) => isPlain(o) && Object.keys(o).sort().join() === [...keys].sort().join()

/** 구조화 원고 판독 — schema 그대로(exact key). 다르면 계약 위반이다(내용 판정은 검증기 몫) */
export function parseManuscriptText(text) {
  const j = parseWire(String(text ?? ''))
  if (!j) return { ok: false, code: 'OUTPUT_NOT_JSON' }
  if (!sameKeys(j, MANUSCRIPT_SCHEMA.required) || !MANUSCRIPT_SCHEMA.required.filter((k) => k !== 'body').every((k) => isStr(j[k])) || !Array.isArray(j.body)) return { ok: false, code: 'OUTPUT_SCHEMA' }
  for (const b of j.body) {
    const keys = isPlain(b) ? BLOCK_KEYS[b.type] : null
    if (!keys || !sameKeys(b, keys)) return { ok: false, code: 'OUTPUT_SCHEMA' }
    if (b.type === 'list' ? !(Array.isArray(b.items) && b.items.every(isStr) && typeof b.ordered === 'boolean') : !Object.keys(b).every((k) => isStr(b[k]))) return { ok: false, code: 'OUTPUT_SCHEMA' }
  }
  return { ok: true, value: j }
}

export function parseRepairText(text) {
  const j = parseWire(String(text ?? ''))
  if (!j || !sameKeys(j, ['replacement']) || !isStr(j.replacement)) return { ok: false, code: 'OUTPUT_SCHEMA' }
  return { ok: true, replacement: j.replacement }
}

/** 이미지 응답 — base64 한 장 */
export function readImage(json) {
  const b64 = isPlain(json) && Array.isArray(json.data) && json.data.length === 1 ? json.data[0]?.b64_json : null
  if (!isStr(b64) || !b64.length) return { ok: false, code: 'IMAGE_OUTPUT_MISSING' }
  return { ok: true, bytes: Buffer.from(b64, 'base64') }
}

// ── 비용 ─────────────────────────────────────────────────────

/** 단가 판독 — 없거나 이상하면 null(PRICE_UNKNOWN 으로 호출 0) */
export function pricesOf(cfg) {
  const m = cfg?.manuscript, i = cfg?.image
  const num = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0
  if (!num(m?.inputPer1M) || !num(m?.outputPer1M) || !num(i?.perImage)) return null
  return { manuscript: { inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M }, image: { perImage: i.perImage } }
}

// Standard, Global · 2026-11-25 공식 모델 가격. 이 키로 사용하는 두 모델만 검증했다.
export const LIVE_TEXT_RATES = {
  'gpt-6-luna': { inputPer1M: 0.10, outputPer1M: 0.50, cached: 0.01, write30m: 0.125, write12h: 0.125 },
  'gpt-6.1-terra': { inputPer1M: 1, outputPer1M: 5, cached: 0.05, write30m: 1.25, write12h: 2.50 },
}

/** 입력은 UTF-8 바이트 기준 상한. 실제 API에서는 캐시 쓰기 최고 단가까지 예약한다. */
export const estimateCostUsd = ({ bodyText, maxOutputTokens, prices }) => {
  const upper = Buffer.byteLength(bodyText, 'utf8') + 256
  const long = upper > 272_000 && prices.cached !== undefined
  const inputPrice = Math.max(prices.inputPer1M, prices.write12h ?? 0, prices.write30m ?? 0)
  return (upper * inputPrice * (long ? 2 : 1) + maxOutputTokens * prices.outputPer1M * (long ? 1.5 : 1)) / 1e6
}

export function actualCostUsd({ usage, prices }) {
  if (!usage) return null
  const { inputTokens, outputTokens, details } = usage
  if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) return null
  if (prices.cached === undefined) return (inputTokens * prices.inputPer1M + outputTokens * prices.outputPer1M) / 1e6
  if (!details) return null
  const cached = details.cached_tokens ?? 0, written = details.cache_write_tokens ?? 0
  const short = details.cache_write_tokens_details?.ttl_30m_tokens ?? 0
  const long = details.cache_write_tokens_details?.ttl_12h_tokens ?? 0
  if (![cached, written, short, long].every(n => Number.isSafeInteger(n) && n >= 0) ||
      cached + written > inputTokens || short + long !== written) return null
  const billable = (inputTokens - cached - written) * prices.inputPer1M + cached * prices.cached + short * prices.write30m + long * prices.write12h
  const extended = inputTokens > 272_000
  return (billable * (extended ? 2 : 1) + outputTokens * prices.outputPer1M * (extended ? 1.5 : 1)) / 1e6
}

/** 실제 Images API의 텍스트 전용 생성 호출. 단위는 Standard USD / 100만 토큰.
 * [OpenAI 모델 가격](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare), 2026-11-25 확인.
 * 단가를 확인하지 않은 모델이나 불완전한 usage는 실측으로 기록하지 않는다. */
export function imageUsageCost(model, usage) {
  if (model !== 'gpt-image-2.5-flare' || !isPlain(usage)) return null
  const text = usage.input_tokens_details?.text_tokens
  const image = usage.input_tokens_details?.image_tokens
  const output = usage.output_tokens
  if (![text, image, output].every(n => Number.isSafeInteger(n) && n >= 0) || text + image !== usage.input_tokens || output === 0) return null
  return (text * 5 + image * 8 + output * 30) / 1e6
}

// ── 실제 adapter (S5 전에는 부르지 않는다) ───────────────────

export class ProviderTransportError extends Error {
  constructor(op, cause) { super(`${op}: ${cause?.name ?? 'Error'}`); this.code = 'TRANSPORT'; this.op = op; this.causeName = cause?.name ?? null }
}

/**
 * OpenAI Responses · Images adapter. 🔴 키는 Authorization 헤더 밖 어디에도 두지 않는다(로그 · 오류 · Job 0).
 * @param {{ apiKey: string, fetchImpl?: typeof fetch, baseUrl?: string, timeouts?: { submit?: number, retrieve?: number, remove?: number, image?: number } }} p
 */
export function makeOpenAiProviders({ apiKey, fetchImpl = globalThis.fetch, baseUrl = 'https://api.openai.com/v1', timeouts = {} }) {
  if (!isStr(apiKey) || apiKey.length < 20) throw new Error('API 키가 없다')
  const t = { submit: 60_000, retrieve: 30_000, remove: 30_000, image: 240_000, ...timeouts }
  const call = async (op, method, path, bodyText, ms) => {
    let res
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${apiKey}`, ...(bodyText ? { 'Content-Type': 'application/json' } : {}) },
        ...(bodyText ? { body: bodyText } : {}), signal: AbortSignal.timeout(ms) })
    } catch (e) { throw new ProviderTransportError(op, e) }
    let text
    try { text = await res.text() } catch (e) { throw new ProviderTransportError(op, e) }
    return { httpStatus: res.status, bodyText: text }
  }
  return {
    kind: 'openai',
    manuscript: {
      submit: (bodyText) => call('submit', 'POST', '/responses', bodyText, t.submit),
      retrieve: (id) => call('retrieve', 'GET', `/responses/${encodeURIComponent(id)}`, null, t.retrieve),
      remove: (id) => call('remove', 'DELETE', `/responses/${encodeURIComponent(id)}`, null, t.remove),
    },
    image: { generate: (bodyText) => call('image', 'POST', '/images/generations', bodyText, t.image) },
  }
}

/** 키 — macOS 로그인 키체인에서 그 자리에서만 읽는다(출력 · 저장 0). 서비스 · 계정 이름은 live 설정이 준다 */
export function readApiKeyFromKeychain({ service, account, exec = spawnSync }) {
  const r = exec('security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8' })
  const key = r.status === 0 ? String(r.stdout ?? '').trim() : ''
  return key.length >= 20 ? key : null
}
