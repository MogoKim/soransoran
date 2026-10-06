/**
 * Persona **creative 칸 생성 계약** — 🔴 순수 함수. DB · 파일 · 네트워크 · LLM 없음 (2026-10-06)
 *
 *   creative = 제목 · 성격 · noGo 소재 · noGo 표현 · variation (`PersonaCreative`)
 *   🔴 **실존 인물의 사실을 복원하지 않는다. Persona 설계값이다.**
 *
 * 🔴 **provider 에 나가는 것 — `CreativeBrief` 하나.**
 *    · 생활사 골격(결정론으로 만든 설계값) — 🔴 내부 생일은 넣지 않는다
 *    · 말투 **관찰값**(길이 띠 · 존댓말 · 이모티콘 · 문체 좌표 반올림값) — 🔴 댓글 원문 0 · 화자 식별자 0
 *    · 이미 있는 Persona 의 제목 · 성격(설계값) — 겹치지 않게 피할 대상
 *    표시명 · 회원 정보 · 원작자 · 원문 작성자 identity 는 이 모양에 **칸이 없다.**
 *
 * 🔴 **출력은 엄격하게 읽는다** (`parseCreative`). 칸 하나라도 없거나 · 남는 칸이 있거나 · 개수 · 길이 ·
 *    글자 규칙을 어기면 그 후보의 creative 는 없다(`null`) — 기본값으로 메우지 않는다.
 *    판정(카드 파서 · seed · 계약 · 겹침 · 문체 거리)은 여기서 하지 않는다 — `judgeAutogenBatch` 그대로다.
 */
import { BRAND_BANNED_WORDS } from './content-guard'
import type { LifeSkeleton, PersonaCreative, SeedVoiceCore } from './persona-autogen'
import { VARIATION_MAX, VARIATION_MIN } from './persona-card-verify'
import { isNoGoExpressionItem, noGoExpressionKey } from './persona-no-go'
import type { StyleVector } from './persona-voice-reference'

// ─────────────────────────────────────────────────────────
// 실행 한도 — 🔴 이 값을 넘는 실행은 provider 를 부르기 전에 끝난다
// ─────────────────────────────────────────────────────────

/** 🔴 한 실행에서 creative 를 만들 수 있는 후보 수 상한 */
export const CREATIVE_MAX_CANDIDATES = 8
/** 🔴 한 실행 총비용 hard cap (USD) — **다음 호출의 최악 예약액**을 더해 넘으면 부르지 않는다 */
export const CREATIVE_COST_CAP_USD = 0.05
/**
 * 🔴 모델 — thinking 이 없어 `max_tokens` 가 곧 출력 과금 상한이다(최악 비용을 호출 전에 확정할 수 있다).
 *    Gemini 3.x 는 thinking 이 기본으로 켜져 그 상한을 정직하게 잡을 수 없다(`voice-m3-contract`).
 */
export const CREATIVE_MODEL = 'claude-haiku-4.5'
/** creative JSON 하나 — 칸 5개 · 짧은 글자들. 실제 출력보다 넉넉하되 최악 비용을 키우지 않는다 */
export const CREATIVE_MAX_OUTPUT_TOKENS = 900
export const CREATIVE_TIMEOUT_MS = 60_000
/** 🔴 재시도하지 않는다 — 한 후보 한 번 */
export const CREATIVE_ATTEMPTS_PER_CANDIDATE = 1

// ─────────────────────────────────────────────────────────
// 브리프 — 🔴 provider 로 나가는 유일한 모양
// ─────────────────────────────────────────────────────────

export type CreativeBrief = {
  code: string
  life: Omit<LifeSkeleton, 'birthDate'>
  voice: {
    length: string
    register: string
    emoji: string
    /** 문체 좌표 — 소수 첫째 자리 반올림. 원문을 되살릴 수 없는 수치뿐이다 */
    style: { question: number; laugh: number; deco: number; politeEnding: number; sentences: number }
  }
}

/**
 * 🔴 **피할 대상 — 기존 Persona 와 앞선 후보의 creative 전체** (2026-10-06 보정).
 *    앞판은 제목 · 성격만 넘겨, 실측 6명 중 3명의 성격이 같은 낱말("침착함")로 모였다. 겹침 판정
 *    (`judgeDistinctness` 성격 · noGo Jaccard > 0.5)은 낱말 하나 겹침을 잡지 않는다 — 규칙을 덧대지 않고
 *    **생성 입력에서 먼저 피하게** 한다. 정본 카드에는 변주 글자가 없어(개수만) 있는 칸만 넘긴다.
 */
export type CreativePeer = {
  code: string
  title: string
  personality: readonly string[]
  noGoTopics?: readonly string[]
  noGoExpressions?: readonly string[]
  variations?: readonly string[]
}

export const creativePeerOf = (code: string, c: PersonaCreative): CreativePeer => ({
  code, title: c.title, personality: c.personality,
  noGoTopics: c.noGoTopics, noGoExpressions: c.noGoExpressions, variations: c.variations,
})

const r1 = (v: number): number => Math.round(v * 10) / 10

/** 🔴 생활사 골격 + 말투 관찰값 → 브리프. 원문 · 화자 · 생일 칸은 입력에도 출력에도 없다 */
export function creativeBriefOf(input: {
  code: string
  life: LifeSkeleton
  voiceCore: SeedVoiceCore
  style: StyleVector
}): CreativeBrief {
  const { birthDate: _internal, ...life } = input.life
  void _internal
  return {
    code: input.code,
    life,
    voice: {
      length: input.voiceCore.length,
      register: input.voiceCore.register,
      emoji: input.voiceCore.emoji,
      style: {
        question: r1(input.style.question), laugh: r1(input.style.jamo), deco: r1(input.style.deco),
        politeEnding: r1(input.style.yo), sentences: r1(input.style.sentences),
      },
    },
  }
}

export const CREATIVE_SYSTEM_PROMPT = [
  '당신은 40대 중반~60대 중반 여성 커뮤니티의 **가상 Persona 설계자**다.',
  '주어진 생활사 골격과 말투 관찰값에 맞는 Persona 설계값을 만든다. 실존 인물을 만들거나 묘사하지 않는다.',
  '',
  '출력은 JSON 객체 하나다. 키는 정확히 다섯 개: title · personality · noGoTopics · noGoExpressions · variations.',
  '- title: 이 사람의 처지를 한 구절로. 이름 · 실명 · 지명 상호를 넣지 않는다',
  '- personality: 성격 3~6개 (예: "현실적", "말수 적음")',
  '- noGoTopics: 이 사람이 글이나 댓글에서 꺼내지 않을 소재 1~4개. 두 글자 이상 · 따옴표 없이',
  '- noGoExpressions: 이 사람이 쓰지 않을 말버릇 1~3개. **말버릇 글자 그대로만** · 각 항목 두 글자 이상 — 따옴표 · "류" 를 붙이지 않는다 (예: ["그래도 다행이죠", "다 지나가요"])',
  `- variations: 이 사람이 쓰는 글 · 댓글의 변주 ${VARIATION_MIN}~${VARIATION_MAX}개 (예: "짧은 공감", "되묻기")`,
  '',
  '규칙',
  '- 말투 관찰값과 어긋나지 않게 한다 (짧은 문장인 사람에게 긴 글 변주를 주지 않는다)',
  '- avoid 에 준 기존 Persona 와 앞선 후보의 제목 · 성격 · noGo · 변주 낱말을 되풀이하지 않는다 (같은 뜻의 다른 말로 바꿔 쓰는 것도 피한다)',
  '- 모든 글자에 가운뎃점(·) · 원문자(①~⑧) · 줄바꿈 · 백틱 · 세로막대를 쓰지 않는다',
  `- 이 낱말을 쓰지 않는다: ${BRAND_BANNED_WORDS.join(', ')}`,
  '- 의료 · 재무 조언, 정치, 특정 집단 비하를 성격이나 변주로 만들지 않는다',
].join('\n')

/** 🔴 user 턴 — 브리프와 피할 대상만. 문자열 조립은 여기 하나다 */
export function creativeUserPayload(brief: CreativeBrief, avoid: readonly CreativePeer[]): string {
  return JSON.stringify({
    persona: brief,
    avoid: avoid.map((p) => ({
      title: p.title, personality: [...p.personality],
      ...(p.noGoTopics === undefined ? {} : { noGoTopics: [...p.noGoTopics] }),
      ...(p.noGoExpressions === undefined ? {} : { noGoExpressions: [...p.noGoExpressions] }),
      ...(p.variations === undefined ? {} : { variations: [...p.variations] }),
    })),
  })
}

// ─────────────────────────────────────────────────────────
// 엄격한 파서 — 🔴 일부 누락을 기본값으로 메우지 않는다
// ─────────────────────────────────────────────────────────

const KEYS = ['title', 'personality', 'noGoTopics', 'noGoExpressions', 'variations'] as const
/** 🔴 카드 한 줄을 깨뜨리는 글자 — 렌더러가 `·` · `①` 로 칸을 가른다 */
const LINE_BREAKERS = /[·①②③④⑤⑥⑦⑧\n\r`|]/

export type CreativeParse =
  | { ok: true; creative: PersonaCreative }
  | { ok: false; problems: string[] }

const charLen = (s: string): number => [...s].length

/**
 * 🔴 **항목 글자 수 — 하류 계약이 요구하는 것만** (2026-10-06 보정).
 *    추적 결과 항목별 **최대** 길이를 요구하는 소비자는 없다 — DB 칸은 `String[]`/`Json`, 카드 머리 정규식은
 *    `(.+)`, `verifySeedCard` 는 개수만, 프롬프트(`jsonBrief`)는 자르지 않는다. 그래서 최대는 두지 않는다.
 *    출력 전체 크기는 provider 출력 상한 · 항목 개수 · 줄바꿈/구분자 금지가 묶는다.
 *    **최소**는 둘이다 — ① 빈 항목은 카드 한 줄에서 사라져 렌더 ≠ 파서가 된다(전 칸 1자 이상)
 *    ② noGo 소재 · 말버릇 열쇠는 본문 **부분 문자열 포함**으로 걸린다(`noGoHits`) — 한 글자면 거의 모든 글이 걸린다(2자 이상).
 */
function stringList(
  v: unknown, name: string, min: number, max: number, itemMin: number, problems: string[],
): string[] {
  if (!Array.isArray(v)) { problems.push(`${name}: 배열이 아니다`); return [] }
  if (v.length < min || v.length > max) problems.push(`${name}: ${v.length}개 (${min}~${max}개여야 한다)`)
  const out: string[] = []
  for (const [i, x] of v.entries()) {
    if (typeof x !== 'string') { problems.push(`${name}[${i}]: 문자열이 아니다`); continue }
    const t = x.trim()
    if (t !== x) problems.push(`${name}[${i}]: 앞뒤 공백`)
    if (charLen(t) < itemMin) problems.push(`${name}[${i}]: ${charLen(t)}자 < ${itemMin}자`)
    out.push(t)
  }
  return out
}

/**
 * 🔴 **creative JSON 하나를 읽는다.** 문제가 하나라도 있으면 `ok:false` 이고 creative 는 없다.
 *    모든 문제를 모은다 — 첫 문제에서 멈추지 않는다(무엇이 틀렸는지 한 번에 보여야 한다).
 */
export function parseCreative(raw: string): CreativeParse {
  const problems: string[] = []
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return { ok: false, problems: ['JSON 이 아니다'] } }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, problems: ['객체가 아니다'] }
  const rec = obj as Record<string, unknown>
  const extra = Object.keys(rec).filter((k) => !(KEYS as readonly string[]).includes(k))
  if (extra.length > 0) problems.push(`모르는 칸: ${extra.join(',')}`)
  const missing = KEYS.filter((k) => !(k in rec))
  if (missing.length > 0) problems.push(`빠진 칸: ${missing.join(',')}`)

  let title = ''
  if (typeof rec.title !== 'string') problems.push('title: 문자열이 아니다')
  else {
    title = rec.title.trim()
    if (title !== rec.title) problems.push('title: 앞뒤 공백')
    if (charLen(title) < 1) problems.push('title: 비었다')
    if (/—/.test(title)) problems.push('title: 줄표(—)는 카드 머리 구분자다')
  }
  const personality = stringList(rec.personality, 'personality', 3, 6, 1, problems)
  const noGoTopics = stringList(rec.noGoTopics, 'noGoTopics', 1, 4, 2, problems)
  const noGoExpressions = stringList(rec.noGoExpressions, 'noGoExpressions', 1, 3, 1, problems)
  const variations = stringList(rec.variations, 'variations', VARIATION_MIN, VARIATION_MAX, 1, problems)

  // ── 글자 규칙 · 칸 종류 ──
  const all: [string, string][] = [
    ['title', title], ...personality.map((s) => ['personality', s] as [string, string]),
    ...noGoTopics.map((s) => ['noGoTopics', s] as [string, string]),
    ...noGoExpressions.map((s) => ['noGoExpressions', s] as [string, string]),
    ...variations.map((s) => ['variations', s] as [string, string]),
  ]
  for (const [k, s] of all) {
    if (LINE_BREAKERS.test(s)) problems.push(`${k}: 카드 한 줄을 깨는 글자(· ① 줄바꿈 \` |)`)
    // 🔴 브랜드 금지 낱말 — 정본 목록 하나(`content-guard`)
    if (BRAND_BANNED_WORDS.some((w) => s.includes(w))) problems.push(`${k}: 브랜드 금지 낱말`)
  }
  for (const t of noGoTopics) if (isNoGoExpressionItem(t)) problems.push(`noGoTopics: 따옴표가 든 항목은 말버릇이다 — ${t.length}자`)
  for (const e of noGoExpressions) {
    if (!/^"[^"]+"( 류)?$/.test(e)) problems.push('noGoExpressions: 큰따옴표로 감싼 말버릇(뒤에 " 류" 만 허용)이 아니다')
    else if (charLen(noGoExpressionKey(e)) < 2) problems.push('noGoExpressions: 따옴표 안이 2자 미만 — 부분 문자열 대조라 거의 모든 글에 걸린다')
  }

  // ── 중복 — 칸 안 · 칸 사이 ──
  const dup = (name: string, xs: readonly string[], key: (s: string) => string = (s) => s): void => {
    const seen = new Set<string>()
    for (const x of xs) { const k = key(x); if (seen.has(k)) problems.push(`${name}: 중복 항목`); seen.add(k) }
  }
  dup('personality', personality)
  dup('noGoTopics', noGoTopics)
  dup('noGoExpressions', noGoExpressions, noGoExpressionKey)
  dup('variations', variations)
  if (noGoTopics.some((t) => noGoExpressions.map(noGoExpressionKey).includes(t))) problems.push('noGo: 소재와 말버릇이 같은 글자다')

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, creative: { title, personality, noGoTopics, noGoExpressions, variations } }
}

// ─────────────────────────────────────────────────────────
// 🔴 provider 출력 계약 — 정본 저장 형식과 분리한다 (2026-10-06)
// ─────────────────────────────────────────────────────────
//
// 정본(카드 · seed · DB · supplement 파일)의 말버릇은 따옴표로 감싼 글이다 — 카드 파서는 noGo 줄에서
// **따옴표가 있는 항목만** 말버릇으로 가른다(`isNoGoExpressionItem`). 하류 판정은 전부 `noGoExpressionKey` 로
// 따옴표 · `류` 를 벗긴 열쇠를 본다(`noGoHits` · 프롬프트 · `hardFilter`).
// 실측(production batch canary 6/6 CREATIVE_INVALID): JSON 문자열 안에 escaped 따옴표 + 선택적 " 류" 를 모델이
// 쓰게 한 계약이 무너졌다. 그래서 **모델은 말버릇 글자만** 내고, 코드가 정본 모양 `"말버릇"` 으로 감싼다.
// supplement · resume 파일은 정본이므로 `parseCreative` 그대로 엄격하게 읽는다(느슨하게 만들지 않는다).

/** 🔴 provider 말버릇에 들어오면 안 되는 글자 — 따옴표는 코드가 붙인다 */
const PROVIDER_QUOTES = /["“”'‘’]/

/**
 * 🔴 **provider creative 를 읽는다.** noGoExpressions 는 따옴표 없는 말버릇 배열이어야 한다 —
 *    따옴표 · 끝의 " 류" · 문자열 아님은 거부하고, 통과한 말버릇만 `"말버릇"` 으로 감싼 뒤
 *    **정본 파서(`parseCreative`)를 그대로** 통과시킨다(2자 · 구분자 · 줄바꿈 · 금지어 · 중복은 거기서 본다).
 */
export function parseProviderCreative(raw: string): CreativeParse {
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return { ok: false, problems: ['JSON 이 아니다'] } }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, problems: ['객체가 아니다'] }
  const rec = { ...(obj as Record<string, unknown>) }
  const problems: string[] = []
  if (Array.isArray(rec.noGoExpressions)) {
    rec.noGoExpressions = rec.noGoExpressions.map((e, i) => {
      if (typeof e !== 'string') { problems.push(`noGoExpressions[${i}]: 문자열이 아니다`); return e }
      const t = e.trim()
      if (t === '') problems.push(`noGoExpressions[${i}]: 비었다`)
      if (PROVIDER_QUOTES.test(t)) problems.push(`noGoExpressions[${i}]: 따옴표가 들어 있다 — 말버릇 글자만 낸다`)
      if (/\s류$/.test(t)) problems.push(`noGoExpressions[${i}]: 끝의 " 류" — 말버릇 글자만 낸다`)
      return `"${t}"`
    })
  }
  const p = parseCreative(JSON.stringify(rec))
  if (problems.length > 0) return { ok: false, problems: [...problems, ...(p.ok ? [] : p.problems)] }
  return p
}

export type CreativeFileParse =
  | { ok: true; creatives: Record<string, PersonaCreative> }
  | { ok: false; problems: string[] }

/**
 * 🔴 **앞 실행의 결과 파일(= `--supplement` 모양)을 다시 읽는다** — 생성 응답과 **같은 엄격한 파서**로.
 *    한 칸이라도 틀리면 파일 전체를 거부한다(일부만 살려 쓰지 않는다). 코드 형식 · 글자까지 같은 복사본도 거부한다.
 */
export function parseCreativeFile(raw: string): CreativeFileParse {
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return { ok: false, problems: ['JSON 이 아니다'] } }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, problems: ['객체가 아니다'] }
  const problems: string[] = []
  const creatives: Record<string, PersonaCreative> = {}
  const seen = new Set<string>()
  for (const [code, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!/^P\d\d$/.test(code)) { problems.push(`${code}: 코드 형식이 아니다`); continue }
    const p = parseCreative(JSON.stringify(v))
    if (!p.ok) { problems.push(...p.problems.map((x) => `${code}: ${x}`)); continue }
    const key = creativeKeyOf(p.creative)
    if (seen.has(key)) problems.push(`${code}: 앞 코드와 글자까지 같은 creative`)
    seen.add(key)
    creatives[code] = p.creative
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, creatives }
}

/** 🔴 두 creative 가 글자까지 같은가 — 같은 실행 안에서 복사본을 막는다(겹침 판정과 별개) */
export const creativeKeyOf = (c: PersonaCreative): string => JSON.stringify([
  c.title, [...c.personality].sort(), [...c.noGoTopics].sort(),
  [...c.noGoExpressions].map(noGoExpressionKey).sort(), [...c.variations].sort(),
])

/**
 * 🔴 **나가는 글에 원문이 실렸는가** — 브리프 조립이 바뀌어도 막는 마지막 문.
 *    `forbidden` 은 이 후보 묶음의 댓글 원문이다. 하나라도 그대로 들어 있으면 부르지 않는다.
 *    너무 짧은 글(4자 미만)은 우연히 겹칠 수 있어 보지 않는다.
 */
export function payloadLeaks(payload: string, forbidden: readonly string[]): number {
  return forbidden.filter((t) => charLen(t.trim()) >= 4 && payload.includes(t.trim())).length
}

// ─────────────────────────────────────────────────────────
// 🔴 batch — 여섯 후보를 **한 번의 호출에서 함께 비교하며** 설계한다 (2026-10-06)
// ─────────────────────────────────────────────────────────
//
// 왜: 개별 호출은 서로를 모른다. 실측(production model · 6+3 호출)에서 성격 "침착함 · 자족적 · 속 깊음"과
//    변주 "상황을 담담히 설명 · 남의 말을 먼저 받아주기"가 후보마다 되풀이됐고, 제목 하나는 사람을
//    혼인 · 주거 상태명 하나로 불렀다. 겹침 판정(Jaccard > 0.5)은 낱말 하나 겹침을 통과시킨다.
//    그래서 ① 한 번에 함께 설계하게 하고 ② 결과를 **하나의 품질 판정**(`judgeCreativeQuality`)으로 본다.

/** 🔴 batch 한 번의 hard cap (USD) — 호출 전 최악 예약(입력 바이트 + 출력 상한)이 넘으면 호출 0 */
export const CREATIVE_BATCH_COST_CAP_USD = 0.03
/** 여섯 명 JSON — 한 명 ≈ 300~450 tok. 넘치면 잘림 → 전체 fail-closed */
export const CREATIVE_BATCH_MAX_OUTPUT_TOKENS = 3200
export const CREATIVE_BATCH_TIMEOUT_MS = 120_000

/** 🔴 기존 Persona 의 **압축** 피할 대상 — 제목 · 핵심 성격만(카드 전체 · noGo 전문을 매번 보내지 않는다) */
export type CompactPeer = { title: string; personality: readonly string[] }
export const COMPACT_PERSONALITY_MAX = 5
export const compactPeerOf = (p: { title: string; personality: readonly string[] }): CompactPeer => ({
  title: p.title, personality: p.personality.slice(0, COMPACT_PERSONALITY_MAX),
})

export const CREATIVE_BATCH_SYSTEM_PROMPT = [
  '당신은 40대 중반~60대 중반 여성 커뮤니티의 **가상 Persona 설계자**다.',
  'candidates 에 준 여러 후보를 **한 묶음으로 함께 비교하며** 설계한다. 실존 인물을 만들거나 묘사하지 않는다.',
  '',
  '출력은 JSON 객체 하나다. 최상위 키는 candidates 의 code 그대로이고 **빠짐 · 추가 · 중복이 없다**.',
  '각 값은 키가 정확히 다섯 개인 객체다: title · personality · noGoTopics · noGoExpressions · variations.',
  '- title: 이 사람의 처지와 결을 한 구절로',
  '- personality: 성격 3~6개',
  '- noGoTopics: 꺼내지 않을 소재 1~4개. 두 글자 이상 · 따옴표 없이',
  '- noGoExpressions: 쓰지 않을 말버릇 1~3개. **말버릇 글자 그대로만** · 각 항목 두 글자 이상 — 따옴표 · "류" 를 붙이지 않는다 (예: ["그래도 다행이죠", "다 지나가요"])',
  `- variations: 글 · 댓글에서 실제로 보이는 **대화 행동** ${VARIATION_MIN}~${VARIATION_MAX}개`,
  '',
  '묶음 규칙 — 여섯 명이 서로 다른 실제 사람처럼 느껴져야 한다',
  '- 후보끼리 같은 성격 낱말을 쓰지 않는다. 같은 뜻의 다른 말로 바꾼 것도 같은 성격이다',
  '- 후보끼리 같은 대화 행동을 쓰지 않는다. 형용사만 바꾸지 말고 **관찰 가능한 행동**이 달라야 한다',
  '  (예시일 뿐 고정 역할이 아니다: 결론부터 말함 · 질문으로 파고듦 · 자기 경험부터 꺼냄 · 짧은 농담을 섞음 · 쉽게 반박함 · 숫자와 상황을 먼저 확인함)',
  '- 각 후보는 다른 후보에게 없는 대화 행동을 두 개 이상 가진다. 생활사와 말투 관찰값에 맞게 배정한다',
  '- 제목은 사람을 혼인 · 주거 상태나 성별 명사 하나로 부르지 않는다 (예: "이혼녀", "미망인", "노처녀" 금지). 생활사를 숨기라는 뜻이 아니다',
  '- noGo 로 그 사람의 생활사 전부를 막지 않는다 — 자기 삶의 이야기를 할 수 있어야 한다',
  '- 자기 noGo 말버릇 · 소재를 그 사람의 variations 에 쓰지 않는다(쓰지 않을 말을 쓰라고 하지 않는다)',
  '- 생활사 골격의 사실(자녀 수 · 혼인 상태)을 title · variations 에서 바꾸지 않는다',
  '- avoid 의 기존 Persona 제목 · 성격을 되풀이하지 않는다',
  '',
  '글자 규칙',
  '- 모든 글자에 가운뎃점(·) · 원문자(①~⑧) · 줄바꿈 · 백틱 · 세로막대를 쓰지 않는다',
  `- 이 낱말을 쓰지 않는다: ${BRAND_BANNED_WORDS.join(', ')}`,
  '- 의료 · 재무 조언, 정치, 특정 집단 비하를 성격이나 변주로 만들지 않는다',
].join('\n')

/** 🔴 batch user 턴 — 후보 브리프(골격 + 말투 관찰값)와 압축 피할 대상뿐 */
export function creativeBatchPayload(briefs: readonly CreativeBrief[], avoid: readonly CompactPeer[]): string {
  return JSON.stringify({
    candidates: briefs,
    avoid: avoid.map((p) => ({ title: p.title, personality: [...p.personality] })),
  })
}

export type CreativeBatchParse = {
  /** 🔴 구조(JSON · 최상위 코드 집합 · 중복 키)가 맞는가 — 아니면 전체 batch invalid, creative 0 */
  structuralOk: boolean
  problems: string[]
  /** 구조가 맞을 때만 — 엄격 파서를 통과한 후보 */
  creatives: Record<string, PersonaCreative>
  /** 구조가 맞을 때 엄격 파서에서 떨어진 후보 */
  invalid: Record<string, string[]>
}

/**
 * 🔴 **batch 응답을 읽는다.** 요청하지 않은 코드 · 빠진 코드 · 중복 키(JSON.parse 는 뒤 값을 조용히 고른다 —
 *    원문에서 센다) · JSON 아님 → **전체 invalid**(creative 0). 구조가 맞으면 후보마다 `parseCreative` 그대로.
 */
export function parseCreativeBatch(raw: string, requested: readonly string[]): CreativeBatchParse {
  const fail = (problems: string[]): CreativeBatchParse => ({ structuralOk: false, problems, creatives: {}, invalid: {} })
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return fail(['JSON 이 아니다 (잘림 포함)']) }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return fail(['객체가 아니다'])
  const keys = Object.keys(obj as Record<string, unknown>)
  const problems: string[] = []
  const extra = keys.filter((k) => !requested.includes(k))
  const missing = requested.filter((k) => !keys.includes(k))
  if (extra.length > 0) problems.push(`요청하지 않은 코드: ${extra.join(',')}`)
  if (missing.length > 0) problems.push(`빠진 코드: ${missing.join(',')}`)
  for (const k of requested) {
    const n = raw.match(new RegExp(`"${k}"\\s*:`, 'g'))?.length ?? 0
    if (n > 1) problems.push(`중복 코드: ${k} ×${n}`)
  }
  if (problems.length > 0) return fail(problems)
  const creatives: Record<string, PersonaCreative> = {}
  const invalid: Record<string, string[]> = {}
  for (const k of requested) {
    const p = parseProviderCreative(JSON.stringify((obj as Record<string, unknown>)[k]))
    if (p.ok) creatives[k] = p.creative
    else invalid[k] = p.problems
  }
  return { structuralOk: true, problems: [], creatives, invalid }
}

// ─────────────────────────────────────────────────────────
// 🔴 **품질 판정 — 이 함수 하나다.** 비슷한 판정을 다른 파일에 두지 않는다
// ─────────────────────────────────────────────────────────

/** 사람 전체를 한 상태명으로 부르는 낱말 — 제목에 들어가면 거부 */
export const STATUS_LABELS: readonly string[] = ['이혼녀', '이혼남', '미망인', '과부', '노처녀', '노총각', '돌싱녀', '독신녀', '홀어미']
/**
 * 🔴 **대화 행동 비교 — 핵심 낱말의 절반 이상이 같으면 같은 행동** (2026-10-06 보정).
 *    앞판은 낱말 앞 두 글자를 열쇠로 삼고 하나라도 겹치면 같은 행동으로 봤다. 그러면 "사진 묘사로 시작" 과
 *    "계절 인사로 시작" 이 `시작` 한 낱말로 같은 행동이 됐다(오탐). 이제는
 *      핵심 낱말 = 띄어쓰기 단위에서 끝의 조사 · 어미 하나를 떼고, 정도 · 꾸밈말을 뺀 것
 *      같은 행동 = 두 행동의 핵심 낱말 중 **적은 쪽의 절반 이상**이 같다
 *    🟡 알려진 미탐: 같은 뜻의 다른 낱말("해결책" · "해결법")은 같은 행동으로 보지 않는다 — 뜻 사전을 두지 않는다.
 */
const BEHAVIOR_MODIFIERS: ReadonlySet<string> = new Set([
  '짧은', '짧게', '긴', '길게', '한', '두', '조용한', '조용히', '차분한', '차분히', '담담한', '담담히', '덤덤하게', '천천히',
  '먼저', '가끔', '자주', '작은', '살짝', '중간중간', '일상', '일상의', '남의', '남들', '자신의', '자기', '내', '왜', '좀',
])
const BEHAVIOR_TAILS = ['하기', '하게', '하는', '해서', '으로', '에서', '부터', '처럼', '까지', '기', '히', '를', '을', '이', '가', '은', '는', '의', '에', '로', '과', '와', '도', '만'] as const

/** 대화 행동 → 핵심 낱말 묶음 */
export function behaviorWordsOf(v: string): string[] {
  const out: string[] = []
  for (const raw of v.split(/\s+/)) {
    const w0 = raw.replace(/[^\p{L}\p{N}]/gu, '')
    if (w0 === '' || BEHAVIOR_MODIFIERS.has(w0)) continue
    const tail = BEHAVIOR_TAILS.find((t) => w0.endsWith(t) && [...w0].length - [...t].length >= 2)
    const w = tail === undefined ? w0 : w0.slice(0, w0.length - tail.length)
    if (BEHAVIOR_MODIFIERS.has(w)) continue
    out.push(w)
  }
  return [...new Set(out)]
}

/** 🔴 같은 대화 행동인가 — 적은 쪽 핵심 낱말의 절반 이상이 겹친다 */
export function sameBehavior(a: string, b: string): boolean {
  const A = behaviorWordsOf(a)
  const B = new Set(behaviorWordsOf(b))
  if (A.length === 0 || B.size === 0) return false
  const shared = A.filter((w) => B.has(w)).length
  return shared * 2 >= Math.min(A.length, B.size)
}

const normKey = (s: string): string => s.replace(/\s+/g, '').toLowerCase()

/** 🔴 생활사 축 → 그 축을 막는 noGo 낱말. 있는 축이 **전부** 막히면 그 사람은 자기 이야기를 못 한다 */
function coreLifeAxes(l: LifeSkeleton): { axis: string; words: readonly string[] }[] {
  const out: { axis: string; words: readonly string[] }[] = []
  if (l.childrenCount > 0) out.push({ axis: '자녀', words: ['자녀', '아이', '아들', '딸', '애들'] })
  if (!['전업', '무직'].includes(l.workStatus)) out.push({ axis: '일', words: ['일', '직장', '회사', '가게', '업무', '장사', l.workStatus] })
  if (l.parentCare !== '없음' && l.parentCare !== '돌봄없음') out.push({ axis: '돌봄', words: ['돌봄', '간병', '부모', '친정', '시댁', '어머니', '아버지'] })
  if (['사별', '이혼', '별거'].includes(l.maritalStatus)) out.push({ axis: '혼인', words: ['남편', '전 남편', '이혼', '사별', '별거', l.maritalStatus] })
  out.push({ axis: '갱년기', words: ['갱년기', '몸', '건강'] })
  return out
}

// ── 🔴 자기모순 · 생활사 사실 충돌 — 결정적인 글자만 본다(뜻 추측 없음) ──

const KO_NUM: Readonly<Record<string, number>> = { 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5 }
const numOf = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : KO_NUM[w] ?? null)
const CHILD_TOTAL = '아이|애|자녀'
const CHILD_GENDER = '아들|딸'

export type ChildClaim = { total: number[]; sons: number[]; daughters: number[] }

/**
 * 🔴 **글에 적힌 자녀 수** — "두 아이 · 아이 둘 · 자녀 셋 · 2명 · 아들 하나 · 딸 둘 · 외동 · 자녀 없는" 만 읽는다.
 *    서수("둘째")는 수가 아니다. 숫자가 없으면 아무것도 읽지 않는다(모름 = 판정하지 않음).
 */
export function childClaimsOf(text: string): ChildClaim {
  const out: ChildClaim = { total: [], sons: [], daughters: [] }
  const put = (noun: string, n: number | null): void => {
    if (n === null) return
    if (noun === '아들') out.sons.push(n)
    else if (noun === '딸') out.daughters.push(n)
    else out.total.push(n)
  }
  const nouns = `${CHILD_TOTAL}|${CHILD_GENDER}`
  for (const m of text.matchAll(new RegExp(`(?:^|[^\\p{L}\\p{N}])(한|두|세|네|다섯|\\d+)\\s*(?:명의\\s*)?(${nouns})(?!\\p{L}*째)`, 'gu'))) put(m[2]!, numOf(m[1]!))
  for (const m of text.matchAll(new RegExp(`(${nouns})\\s*(하나|둘|셋|넷|다섯|(?:한|두|세|네|다섯|\\d+)\\s*명)(?!째)`, 'gu'))) {
    put(m[1]!, numOf(m[2]!.replace(/\s*명$/, '')))
  }
  if (/외동/.test(text)) out.total.push(1)
  if (/무자녀|(?:자녀|아이)\s*(?:없는|없이|없음)/.test(text)) out.total.push(0)
  return out
}

/** 🔴 자녀 수 충돌 — 글에 적힌 수가 골격과 다르면 이유를 돌려준다(적지 않았으면 null) */
export function childConflictOf(text: string, count: number): string | null {
  const c = childClaimsOf(text)
  const bad = c.total.find((n) => n !== count)
  if (bad !== undefined) return `자녀 ${bad}명 ≠ 골격 ${count}명`
  const s = c.sons.length > 0 ? Math.max(...c.sons) : null
  const d = c.daughters.length > 0 ? Math.max(...c.daughters) : null
  if (s !== null && d !== null && s + d !== count) return `아들 ${s} + 딸 ${d} ≠ 골격 ${count}명`
  if ((s ?? 0) > count || (d ?? 0) > count) return `${s !== null && s > count ? `아들 ${s}` : `딸 ${d}`}명 > 골격 ${count}명`
  return null
}

/** 🔴 title 이 스스로 밝힌 혼인 상태 — 골격 값과 같은 낱말만(변주는 남의 이야기일 수 있어 보지 않는다) */
const MARITAL_CLAIMS: readonly { status: string; re: RegExp }[] = [
  { status: '사별', re: /사별/ }, { status: '이혼', re: /이혼|돌싱/ }, { status: '별거', re: /별거/ }, { status: '비혼', re: /비혼|미혼/ },
]

export type CreativeQualityInput = {
  candidates: readonly { code: string; creative: PersonaCreative; life: LifeSkeleton }[]
  /** 기존 Persona 제목(정본 카드) — 같으면 거부 */
  existingTitles: readonly string[]
  /**
   * 🔴 **기대 후보** — 이 묶음이 덮어야 하는 코드 전부. 하나라도 creative 가 없으면 `INCOMPLETE`(PASS 아님).
   *    앞판은 형식 통과한 3명만 넘겨 받아 6명 묶음을 PASS 로 찍었다. 생략하면 넘겨받은 후보가 곧 기대 후보다.
   */
  expected?: readonly string[]
}
export type CreativeQuality = {
  /** 🔴 PASS 만 통과다. INCOMPLETE = 기대 후보 중 creative 가 없는 코드가 있다 */
  status: 'PASS' | 'FAIL' | 'INCOMPLETE'
  ok: boolean
  /** `${code}: ${rule} — 근거` */
  problems: string[]
  /** 후보별 — 다른 후보에게 없는 대화 행동 수 */
  uniqueBehaviors: Record<string, number>
}
/** 후보별 고유 대화 행동 하한 */
export const UNIQUE_BEHAVIOR_MIN = 2

/**
 * 🔴 **creative 묶음 품질 계약 — 단일 판정.** Persona 계약(`judgeAutogenBatch`)을 대신하지 않고 그 위에 얹힌다.
 *
 *    ① 후보끼리 같은 personality 항목 0 (공백 무시)
 *    ② 후보끼리 같은 variation 항목 0 (공백 무시)
 *    ③ 후보마다 다른 후보에게 없는 대화 행동 ≥ 2 — 같은 행동 = 핵심 낱말 절반 이상 겹침(`sameBehavior`)
 *    ④ title — 다른 후보 · 기존 Persona 와 같거나, 사람을 상태명 하나로 부르면(`STATUS_LABELS`) 거부
 *    ⑤ noGo 소재가 그 사람에게 있는 생활사 축을 **전부** 막으면 거부(빈 사람)
 *    ⑥ [SELF_CONTRADICTION] 자기 noGo 말버릇 열쇠 · 소재가 자기 variations 에 그대로 들어 있으면 거부
 *    ⑦ [LIFE_FACT_CONFLICT] title · variations 에 적힌 자녀 수, title 이 밝힌 혼인 상태가 골격과 다르면 거부
 *       (적지 않았으면 판정하지 않는다 — 뜻을 추측하지 않는다)
 */
export function judgeCreativeQuality(input: CreativeQualityInput): CreativeQuality {
  const problems: string[] = []
  const cs = [...input.candidates].sort((a, b) => a.code.localeCompare(b.code))

  const repeated = (pick: (c: PersonaCreative) => readonly string[], rule: string): void => {
    const owners = new Map<string, string[]>()
    for (const c of cs) for (const x of new Set(pick(c.creative).map(normKey))) owners.set(x, [...(owners.get(x) ?? []), c.code])
    for (const [x, codes] of owners) if (codes.length > 1) problems.push(`${codes.join(',')}: ${rule} — "${x}" 반복`)
  }
  repeated((c) => c.personality, '같은 personality')
  repeated((c) => c.variations, '같은 variation')

  const uniqueBehaviors: Record<string, number> = {}
  for (const c of cs) {
    const others = cs.filter((o) => o.code !== c.code).flatMap((o) => o.creative.variations)
    const n = c.creative.variations.filter((v) => behaviorWordsOf(v).length > 0 && !others.some((o) => sameBehavior(v, o))).length
    uniqueBehaviors[c.code] = n
    if (n < UNIQUE_BEHAVIOR_MIN) problems.push(`${c.code}: 고유 대화 행동 ${n}개 < ${UNIQUE_BEHAVIOR_MIN}`)
  }

  const existing = new Set(input.existingTitles.map(normKey))
  const titleOwners = new Map<string, string[]>()
  for (const c of cs) {
    const t = normKey(c.creative.title)
    titleOwners.set(t, [...(titleOwners.get(t) ?? []), c.code])
    if (existing.has(t)) problems.push(`${c.code}: 기존 Persona 와 같은 title`)
    const label = STATUS_LABELS.find((w) => c.creative.title.includes(w))
    if (label !== undefined) problems.push(`${c.code}: 상태 낙인형 title — "${label}"`)
  }
  for (const [, codes] of titleOwners) if (codes.length > 1) problems.push(`${codes.join(',')}: 같은 title`)

  for (const c of cs) {
    const axes = coreLifeAxes(c.life)
    const blocked = axes.filter((a) => c.creative.noGoTopics.some((t) => a.words.some((w) => w !== '' && t.includes(w))))
    if (axes.length > 0 && blocked.length === axes.length) {
      problems.push(`${c.code}: noGo 가 생활사 축 전부(${axes.map((a) => a.axis).join('·')})를 막는다 — 빈 사람`)
    }
  }
  for (const c of cs) {
    // [SELF_CONTRADICTION] 쓰지 않을 말버릇 · 소재를 변주가 쓰라고 한다(title 은 보지 않는다)
    const keys = c.creative.noGoExpressions.map(noGoExpressionKey).filter((k) => [...k].length >= 2)
    for (const v of c.creative.variations) {
      for (const k of keys) if (v.includes(k)) problems.push(`${c.code}: [SELF_CONTRADICTION] noGo 말버릇 "${k}" 를 변주 "${v}" 가 쓴다`)
      for (const t of c.creative.noGoTopics) if (v.includes(t)) problems.push(`${c.code}: [SELF_CONTRADICTION] noGo 소재 "${t}" 를 변주 "${v}" 가 지시한다`)
    }
    // [LIFE_FACT_CONFLICT] 골격의 자녀 수 · 혼인 상태를 글이 바꿨다
    for (const text of [c.creative.title, ...c.creative.variations]) {
      const why = childConflictOf(text, c.life.childrenCount)
      if (why !== null) problems.push(`${c.code}: [LIFE_FACT_CONFLICT] "${text}" — ${why}`)
    }
    for (const m of MARITAL_CLAIMS) {
      if (m.re.test(c.creative.title) && m.status !== c.life.maritalStatus) {
        problems.push(`${c.code}: [LIFE_FACT_CONFLICT] title 혼인 "${m.status}" ≠ 골격 "${c.life.maritalStatus}"`)
      }
    }
  }

  const have = new Set(cs.map((c) => c.code))
  const missing = (input.expected ?? []).filter((c) => !have.has(c))
  if (missing.length > 0) {
    problems.unshift(`INCOMPLETE: 기대 ${input.expected!.length}명 중 ${have.size}명 — creative 없음 ${missing.join(',')}`)
  }
  const status = missing.length > 0 ? 'INCOMPLETE' : problems.length === 0 ? 'PASS' : 'FAIL'
  return { status, ok: status === 'PASS', problems, uniqueBehaviors }
}
