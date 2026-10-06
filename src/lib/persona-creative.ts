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
  '- title: 이 사람의 처지를 한 구절로 (2~24자). 이름 · 실명 · 지명 상호를 넣지 않는다',
  '- personality: 성격 3~6개. 각 2~12자 (예: "현실적", "말수 적음")',
  '- noGoTopics: 이 사람이 글이나 댓글에서 꺼내지 않을 소재 1~4개. 각 2~20자. 따옴표 없이',
  '- noGoExpressions: 이 사람이 쓰지 않을 말버릇 1~3개. 각각 큰따옴표로 감싼다. 비슷한 말을 포함하면 뒤에 " 류" (예: "\\"그래도 다행이죠\\" 류")',
  `- variations: 이 사람이 쓰는 글 · 댓글의 변주 ${VARIATION_MIN}~${VARIATION_MAX}개. 각 2~24자 (예: "짧은 공감", "되묻기")`,
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

function stringList(
  v: unknown, name: string, min: number, max: number, itemMin: number, itemMax: number, problems: string[],
): string[] {
  if (!Array.isArray(v)) { problems.push(`${name}: 배열이 아니다`); return [] }
  if (v.length < min || v.length > max) problems.push(`${name}: ${v.length}개 (${min}~${max}개여야 한다)`)
  const out: string[] = []
  for (const [i, x] of v.entries()) {
    if (typeof x !== 'string') { problems.push(`${name}[${i}]: 문자열이 아니다`); continue }
    const t = x.trim()
    if (t !== x) problems.push(`${name}[${i}]: 앞뒤 공백`)
    if (charLen(t) < itemMin || charLen(t) > itemMax) problems.push(`${name}[${i}]: ${charLen(t)}자 (${itemMin}~${itemMax}자)`)
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
    if (charLen(title) < 2 || charLen(title) > 24) problems.push(`title: ${charLen(title)}자 (2~24자)`)
    if (/—/.test(title)) problems.push('title: 줄표(—)는 카드 머리 구분자다')
  }
  const personality = stringList(rec.personality, 'personality', 3, 6, 2, 12, problems)
  const noGoTopics = stringList(rec.noGoTopics, 'noGoTopics', 1, 4, 2, 20, problems)
  const noGoExpressions = stringList(rec.noGoExpressions, 'noGoExpressions', 1, 3, 4, 26, problems)
  const variations = stringList(rec.variations, 'variations', VARIATION_MIN, VARIATION_MAX, 2, 24, problems)

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
    else if (charLen(noGoExpressionKey(e)) < 2) problems.push('noGoExpressions: 따옴표 안이 비었다')
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
