#!/usr/bin/env tsx
/**
 * Persona creative 생성 fixture — 🔴 **DB 0 · 네트워크 0 · 유료 호출 0** (2026-10-06)
 *
 * 🔴 provider 는 **주입한 가짜 함수**다. 판정은 운영 그대로(`parseCreative` → `judgeAutogenBatch`).
 *    반례는 한 칸씩만 비틀어 정확히 그 이유로 막히는지 본다.
 *
 *   ① 기본 실행(생성 플래그 없음) → 실제 CLI 를 가짜 fetch 로 돌려 provider 요청 0
 *   ② 브리프 — 생일 · 댓글 원문 · 화자 · 표시명 칸 0 · 원문이 실리면 부르지 않는다
 *   ③ 엄격한 파서 — 누락 · 남는 칸 · 개수 · 중복 · 카드 한 줄 깨는 글자 · 금지 낱말 · 따옴표 → fail-closed
 *   ④ 실행기 — 상한 초과 전 차단 · 후보 상한 · 재시도 0 · 사용량 모름 뒤 정지 · 같은 creative 복사 차단
 *   ⑤ 판정 연결 — 생성된 creative 가 운영 판정을 통과(valid) · 기존 Persona 와 겹치면 격리
 *   ⑥ CLI 가드 — 유료 조건이 어긋나면 DB · provider 에 붙기 전에 멈춘다
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AUTOGEN_BLOCK_CODES, autogenCodeOf, AUTOGEN_CODE_FIRST, proposeLifeSkeletons, voiceCoreFromBundle,
  type AutogenCandidate, type Cadence, type LifeSkeleton, type PersonaCreative,
} from '../src/lib/persona-autogen'
import {
  CREATIVE_BATCH_COST_CAP_USD, CREATIVE_BATCH_MAX_OUTPUT_TOKENS, CREATIVE_BATCH_SYSTEM_PROMPT, STATUS_LABELS,
  behaviorWordsOf, compactPeerOf, creativeBatchPayload, judgeCreativeQuality, parseCreativeBatch, sameBehavior,
  CREATIVE_COST_CAP_USD, CREATIVE_MAX_CANDIDATES, CREATIVE_MAX_OUTPUT_TOKENS, CREATIVE_MODEL, CREATIVE_SYSTEM_PROMPT,
  creativeBriefOf, creativePeerOf, creativeUserPayload, parseCreative, parseCreativeFile, payloadLeaks, type CreativeBrief,
} from '../src/lib/persona-creative'
import { BRAND_BANNED_WORDS } from '../src/lib/content-guard'
import { reserveOf } from '../src/lib/llm-pricing'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { judgeReferenceBundle, type VoiceReferenceBundle } from '../src/lib/persona-voice-reference'
import { judgeAutogenBatch } from './lib/persona-autogen.mjs'
import { CREATIVE_BLOCK_OF, generateCreativeBatch, generateCreatives, outcomesOfBatch, type CreativeCall } from './lib/persona-creative-run.mjs'
import type { LlmResponse } from './lib/voice-m3-provider.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { failN += 1; console.log(`  🔴 FAIL  ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}

console.log('\n══ Persona creative 생성 fixture ══\n')

// ── 합성 재료 — `persona-autogen-check` 와 같은 모양 ──
const bundleOf = (code: string, texts: string[]): VoiceReferenceBundle => {
  const v = judgeReferenceBundle({ personaCode: code, texts, anchorCount: texts.length })
  if (!v.ok) throw new Error(`fixture 묶음이 서지 않는다: ${v.blocks.map((b) => b.code).join(',')}`)
  return v.bundle
}
const TEXTS = ['그 마음 알 것 같아요', '저도 요즘 그래요', '천천히 하셔도 돼요', '날이 많이 추워졌네요']
const LIFE: LifeSkeleton = {
  ageBand: '50대 초반', birthDate: '1973-03-08', region: '광역시', maritalStatus: '이혼',
  spouseRelationship: '해당없음', childrenCount: 1, childrenAgeBands: ['대학·취준'], childrenLiving: '동거',
  workStatus: '파트타임', economicStatus: '빠듯', housing: '월세', menopauseStatus: '진행중', parentCare: '간헐',
}
const CADENCE: Cadence = {
  dailyCap: 3, weeklyCap: 12, silenceRate: 0.3,
  activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 },
}
const CODE = autogenCodeOf(AUTOGEN_CODE_FIRST)
const bundle = bundleOf(CODE, TEXTS)
const brief = creativeBriefOf({ code: CODE, life: LIFE, voiceCore: voiceCoreFromBundle(bundle), style: bundle.style })

const GOOD: PersonaCreative = {
  title: '혼자 대학생 아이 뒷바라지하며',
  personality: ['담담함', '말 짧음', '남 얘기 잘 들음'],
  noGoTopics: ['이혼 권유', '금액 언급'],
  noGoExpressions: ['"그래도 다행이죠" 류'],
  variations: ['짧게 툭', '담백한 경험', '되묻기', '무호칭', '한 줄'],
}
/** 🔴 Anthropic prefill 을 거친 rawText 모양 그대로(`{` 로 시작하는 JSON) */
const okResponse = (c: unknown, extra: Partial<LlmResponse> = {}): LlmResponse => ({
  ok: true, rawText: typeof c === 'string' ? c : JSON.stringify(c), inputTokens: 600, outputTokens: 180,
  finishReason: 'end_turn', reasoningTokens: null, responseChars: 0, maxTokensReached: false,
  errorCode: null, errorMessage: null, usageKnown: true, cacheWriteTokens: 0, cacheReadTokens: 0, usageKeys: [], ...extra,
})
const fakeCall = (byCode: (code: string) => LlmResponse): { call: CreativeCall; calls: () => number; bodies: string[] } => {
  let n = 0
  const bodies: string[] = []
  return {
    calls: () => n,
    bodies,
    call: async (req) => {
      n += 1
      bodies.push(`${req.systemPrompt}\n${req.userPayload}`)
      const code = (JSON.parse(req.userPayload) as { persona: { code: string } }).persona.code
      return byCode(code)
    },
  }
}
const briefFor = (code: string): CreativeBrief => ({ ...brief, code })
const variant = (i: number): PersonaCreative => ({
  title: `변주 후보 ${i} 의 처지`,
  personality: [`성격${i}가`, `성격${i}나`, `성격${i}다`],
  noGoTopics: [`소재${i}가`],
  noGoExpressions: [`"말버릇${i}" 류`],
  variations: ['짧은 공감', '되묻기', '한 줄', '경험 나눔', `변주${i}`],
})

// ─────────────────────────────────────────────────────────
console.log('① 기본 실행 — provider 0 (실제 CLI · 가짜 fetch)')
// ─────────────────────────────────────────────────────────
{
  const T = mkdtempSync(join(tmpdir(), 'soran-creative-'))
  const log = join(T, 'fake.log')
  writeFileSync(log, '')
  const env = { ...process.env, HOME: T, NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts', 'lib', 'fake-provider-hook.mjs')}`, FAKE_PROVIDER_LOG: log }
  const run = spawnSync('npx', ['tsx', 'scripts/persona-autogen.mts', '--count=8'], { env, encoding: 'utf-8' })
  check('생성 플래그 없는 CLI 가 정상 종료한다', run.status === 0, (run.stderr ?? '').slice(-300))
  check('🔴 생성 플래그 없음 → provider 요청 0 (fetch 0)', readFileSync(log, 'utf-8').trim() === '')
  check('생성 표가 찍히지 않는다', !/creative 생성/.test(run.stdout))
  const cli = readFileSync('scripts/persona-autogen.mts', 'utf-8')
  check('🔴 provider 모듈은 생성 분기 안에서만 불러온다', (cli.match(/voice-m3-provider/g) ?? []).length === 1
    && /if \(GENERATE\) \{[\s\S]*await import\('\.\/lib\/voice-m3-provider\.mjs'\)[\s\S]*\n\}\n/.test(cli))
  rmSync(T, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────
console.log('② 브리프 — 원문 · 화자 · 생일 · 표시명 0')
// ─────────────────────────────────────────────────────────
{
  const payload = creativeUserPayload(brief, [{ code: 'P01', title: '아이 키우며 파트타임', personality: ['부지런함'] }])
  check('브리프에 내부 생일이 없다', !payload.includes(LIFE.birthDate) && !('birthDate' in brief.life))
  check('🔴 브리프에 이 묶음의 댓글 원문 0건', payloadLeaks(payload, bundle.comments.map((x) => x.text)) === 0)
  check('브리프 칸은 code · life · voice 뿐이다', JSON.stringify(Object.keys(brief)) === JSON.stringify(['code', 'life', 'voice']))
  check('말투 칸은 관찰값(길이 · 존댓말 · 이모티콘 · 좌표)뿐 — 표시명 · 화자 · anchor 칸 0',
    JSON.stringify(Object.keys(brief.voice)) === JSON.stringify(['length', 'register', 'emoji', 'style'])
    && !/speaker|anchor|displayName|name"/.test(payload))
  check('🔴 원문이 실린 글을 대조가 잡는다(반례)', payloadLeaks(`${payload}${TEXTS[0]}`, TEXTS) === 1)
  check('🔴 시스템 프롬프트에 정본 금지 낱말 목록이 실린다', BRAND_BANNED_WORDS.every((w) => CREATIVE_SYSTEM_PROMPT.includes(w)))
}

// ─────────────────────────────────────────────────────────
console.log('③ 엄격한 파서 — 일부 누락을 기본값으로 메우지 않는다')
// ─────────────────────────────────────────────────────────
{
  const bad = (name: string, v: unknown, re: RegExp): void => {
    const p = parseCreative(typeof v === 'string' ? v : JSON.stringify(v))
    check(`${name} → fail-closed`, !p.ok && p.problems.some((x) => re.test(x)), p.ok ? '통과했다' : p.problems.join(' / '))
  }
  check('온전한 creative 는 읽힌다', parseCreative(JSON.stringify(GOOD)).ok)
  bad('JSON 아님', '그냥 글', /JSON 이 아니다/)
  bad('배열', [GOOD], /객체가 아니다/)
  const { variations: _v, ...noVar } = GOOD
  void _v
  bad('칸 누락(variations)', noVar, /빠진 칸: variations/)
  bad('남는 칸', { ...GOOD, name: '해솔' }, /모르는 칸: name/)
  bad('성격 2개', { ...GOOD, personality: ['담담함', '말 짧음'] }, /personality: 2개/)
  bad('변주 4개', { ...GOOD, variations: GOOD.variations.slice(0, 4) }, /variations: 4개/)
  bad('변주 9개', { ...GOOD, variations: [...GOOD.variations, 'a1', 'a2', 'a3', 'a4'] }, /variations: 9개/)
  bad('성격 중복', { ...GOOD, personality: ['담담함', '담담함', '말 짧음'] }, /personality: 중복/)
  bad('말버릇 중복(열쇠 기준)', { ...GOOD, noGoExpressions: ['"그래도 다행이죠" 류', '"그래도 다행이죠"'] }, /noGoExpressions: 중복/)
  bad('가운뎃점', { ...GOOD, personality: ['담담함 · 차분함', '말 짧음', '남 얘기'] }, /카드 한 줄을 깨는 글자/)
  bad('원문자', { ...GOOD, variations: ['① 짧게', ...GOOD.variations.slice(1)] }, /카드 한 줄을 깨는 글자/)
  bad('🔴 금지 낱말', { ...GOOD, title: `${BRAND_BANNED_WORDS[0]} 엄마의 하루` }, /브랜드 금지 낱말/)
  bad('따옴표 없는 말버릇', { ...GOOD, noGoExpressions: ['그래도 다행이죠'] }, /큰따옴표로 감싼 말버릇/)
  bad('따옴표 든 소재', { ...GOOD, noGoTopics: ['"금액"'] }, /따옴표가 든 항목은 말버릇/)
  bad('제목 줄표', { ...GOOD, title: '혼자 — 뒷바라지' }, /줄표/)
  bad('문자열 아닌 항목', { ...GOOD, personality: ['담담함', 3, '말 짧음'] }, /personality\[1\]: 문자열이 아니다/)
  bad('앞뒤 공백', { ...GOOD, title: ' 혼자 뒷바라지 ' }, /title: 앞뒤 공백/)

  // ── 결과 파일(= --supplement · --resume-creative) — 같은 엄격 파서 ──
  const file = (o: unknown) => parseCreativeFile(JSON.stringify(o))
  const okFile = file({ P26: GOOD, P27: variant(27) })
  check('온전한 결과 파일은 읽힌다', okFile.ok && Object.keys(okFile.creatives).join(',') === 'P26,P27')
  check('🔴 결과 파일 — JSON 아님 → fail-closed', !parseCreativeFile('{').ok)
  check('🔴 결과 파일 — 한 코드만 칸 누락이어도 파일 전체 거부', !file({ P26: GOOD, P27: { ...variant(27), variations: [] } }).ok)
  check('🔴 결과 파일 — 코드 형식 아님 → 거부', !file({ X1: GOOD }).ok)
  check('🔴 결과 파일 — 두 코드가 글자까지 같은 creative → 거부', !file({ P26: GOOD, P27: GOOD }).ok)
  check('피할 대상 모양 — creative 전체 칸', JSON.stringify(Object.keys(creativePeerOf('P26', GOOD)))
    === JSON.stringify(['code', 'title', 'personality', 'noGoTopics', 'noGoExpressions', 'variations']))
}

// ─────────────────────────────────────────────────────────
console.log('④ 실행기 — 상한 · 재시도 0 · 사용량 모름')
// ─────────────────────────────────────────────────────────
{
  const six = ['P26', 'P27', 'P28', 'P29', 'P30', 'P32'].map(briefFor)
  const noTexts = (): string[] => []
  {
    const f = fakeCall((code) => okResponse(variant(Number(code.slice(1)))))
    const r = await generateCreatives({ briefs: six, avoid: [], forbiddenTextsOf: noTexts, call: f.call })
    check('6명 → 호출 6 · generated 6', r.ok && f.calls() === 6 && r.outcomes.every((o) => o.status === 'generated'))
    check('실제 비용 = 사용량 × 정본 단가(haiku 1/5) 합', r.ok && r.ledger.usd !== null
      && Math.abs(r.ledger.usd - 6 * (600 * 1 + 180 * 5) / 1e6) < 1e-12, String(r.ledger.usd))
    check('토큰 합이 장부에 남는다', r.ledger.inputTokens === 3600 && r.ledger.outputTokens === 1080)
    check('🔴 모델 · 출력 상한이 정본 상수다', f.bodies.length === 6 && CREATIVE_MODEL === 'claude-haiku-4.5')
    check('뒤 후보의 피할 대상에 앞서 생성된 제목이 실린다', f.bodies[5]!.includes(variant(26).title))
    // 🔴 (보정) 피할 대상 = creative 전체 — 성격 낱말 하나 겹침은 겹침 판정이 못 잡으니 입력에서 먼저 피하게 한다
    check('🔴 뒤 후보의 피할 대상에 앞선 후보의 noGo · 말버릇 · 변주까지 실린다',
      f.bodies[5]!.includes(variant(26).noGoTopics[0]!) && f.bodies[5]!.includes('말버릇26') && f.bodies[5]!.includes('변주26'))
    check('🔴 1회 최악 예약 최대 ≤ 상한 (예약 합이 아니다)', r.ledger.maxReserveUsd > 0 && r.ledger.maxReserveUsd <= r.ledger.capUsd)
  }
  {
    const f = fakeCall(() => okResponse(GOOD))
    const r = await generateCreatives({
      briefs: Array.from({ length: CREATIVE_MAX_CANDIDATES + 1 }, (_, i) => briefFor(autogenCodeOf(26 + i))),
      avoid: [], forbiddenTextsOf: noTexts, call: f.call,
    })
    check(`🔴 후보 ${CREATIVE_MAX_CANDIDATES + 1}명 → 한 번도 부르지 않는다`, !r.ok && f.calls() === 0)
  }
  {
    // 🔴 상한 — 다음 호출의 최악 예약이 상한을 넘으면 부르지 않는다
    const payload = creativeUserPayload(briefFor('P26'), [])
    const one = reserveOf({
      model: CREATIVE_MODEL, countedInputTokens: Buffer.byteLength(CREATIVE_SYSTEM_PROMPT) + Buffer.byteLength(payload),
      maxOutputTokens: CREATIVE_MAX_OUTPUT_TOKENS, headroomMultiplier: 1,
    })
    check('최악 예약 1회가 상한 안이다(정본 상한으로 최소 1회는 부를 수 있다)', one.known && one.usd < CREATIVE_COST_CAP_USD)
    const f = fakeCall(() => okResponse(GOOD))
    const r0 = await generateCreatives({ briefs: six, avoid: [], forbiddenTextsOf: noTexts, call: f.call, capUsd: one.known ? one.usd / 2 : 0 })
    check('🔴 상한 < 최악 예약 1회 → 호출 0 · 전원 budget-blocked', r0.ok && f.calls() === 0
      && r0.outcomes.every((o) => o.status === 'budget-blocked'))
    // 실제 비용이 예약과 같게 나오는 호출 — 두 번째부터 상한을 넘으므로 1회만 부른다
    const worst = (code: string): LlmResponse => okResponse(variant(Number(code.slice(1))),
      { inputTokens: Buffer.byteLength(CREATIVE_SYSTEM_PROMPT) + Buffer.byteLength(creativeUserPayload(briefFor(code), [])),
        outputTokens: CREATIVE_MAX_OUTPUT_TOKENS })
    const f2 = fakeCall(worst)
    const r1 = await generateCreatives({ briefs: six, avoid: [], forbiddenTextsOf: noTexts, call: f2.call, capUsd: one.known ? one.usd * 1.5 : 0 })
    check('🔴 지출 + 다음 최악 예약 > 상한 → 그 뒤는 부르지 않는다(호출 1)', r1.ok && f2.calls() === 1
      && r1.outcomes.filter((o) => o.status === 'budget-blocked').length === 5)
    check('🔴 실제 지출은 상한을 넘지 않는다', r1.ledger.usd !== null && r1.ledger.usd <= r1.ledger.capUsd)
  }
  {
    const f = fakeCall(() => ({ ...okResponse(GOOD), ok: false, errorCode: 'HTTP_500', usageKnown: false }))
    const r = await generateCreatives({ briefs: six, avoid: [], forbiddenTextsOf: noTexts, call: f.call })
    check('🔴 호출 실패 → 재시도 0 · 사용량 모름 → 뒤 후보 0회 (호출 1)', r.ok && f.calls() === 1
      && r.outcomes[0]!.status === 'call-failed' && r.outcomes.slice(1).every((o) => o.status === 'budget-blocked'
        && /사용량 · 비용을 읽지 못했다/.test(o.problems.join('')))
      && r.ledger.usd === null)
  }
  {
    const f = fakeCall((code) => (code === 'P27' ? okResponse('{"title":"반쪽"') : okResponse(variant(Number(code.slice(1))))))
    const r = await generateCreatives({ briefs: six, avoid: [], forbiddenTextsOf: noTexts, call: f.call })
    const o = r.ok ? r.outcomes.find((x) => x.code === 'P27') : undefined
    check('🔴 잘린 JSON → 그 후보만 invalid · 재시도 0 (호출 6)', r.ok && f.calls() === 6 && o?.status === 'invalid' && o.creative === null)
  }
  {
    const f = fakeCall(() => okResponse({ ...GOOD, variations: GOOD.variations.slice(0, 2) }))
    const r = await generateCreatives({ briefs: six.slice(0, 1), avoid: [], forbiddenTextsOf: noTexts, call: f.call })
    check('🔴 일부 칸 개수 위반 → invalid · creative 없음(기본값 0)', r.ok && r.outcomes[0]!.status === 'invalid' && r.outcomes[0]!.creative === null)
  }
  {
    const f = fakeCall(() => okResponse(GOOD, { maxTokensReached: true }))
    const r = await generateCreatives({ briefs: six.slice(0, 1), avoid: [], forbiddenTextsOf: noTexts, call: f.call })
    check('🔴 출력 상한 닿음(잘림) → call-failed', r.ok && r.outcomes[0]!.status === 'call-failed')
  }
  {
    const f = fakeCall(() => okResponse(GOOD))
    const r = await generateCreatives({ briefs: six.slice(0, 2), avoid: [], forbiddenTextsOf: noTexts, call: f.call })
    check('🔴 두 후보가 글자까지 같은 creative → 뒤 후보 invalid', r.ok && r.outcomes[0]!.status === 'generated'
      && r.outcomes[1]!.status === 'invalid' && /글자까지 같은/.test(r.outcomes[1]!.problems.join('')))
  }
  {
    const f = fakeCall(() => okResponse(GOOD))
    const r = await generateCreatives({
      briefs: six.slice(0, 1), avoid: [{ code: 'P01', title: TEXTS[0]!, personality: [] }],
      forbiddenTextsOf: () => TEXTS, call: f.call,
    })
    check('🔴 나가는 글에 댓글 원문이 실리면 부르지 않는다(호출 0 · leak-blocked)', r.ok && f.calls() === 0 && r.outcomes[0]!.status === 'leak-blocked')
  }
  {
    const f = fakeCall(() => okResponse(GOOD))
    const r = await generateCreatives({ briefs: [briefFor('P26'), briefFor('P26')], avoid: [], forbiddenTextsOf: noTexts, call: f.call })
    check('같은 코드 두 번 → 호출 0', !r.ok && f.calls() === 0)
  }
  check('생성 실패 코드가 정본 격리 코드 목록에 있다',
    Object.values(CREATIVE_BLOCK_OF).every((c) => (AUTOGEN_BLOCK_CODES as readonly string[]).includes(c)))
}

// ─────────────────────────────────────────────────────────
console.log('⑤ 판정 연결 — 운영 판정 그대로')
// ─────────────────────────────────────────────────────────
{
  const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
  const base: AutogenCandidate = {
    code: CODE, life: LIFE, creative: null, voice: { bundle, seedShareCount: 1 }, cadence: CADENCE,
    binding: { accountCount: 0, providerId: null }, displayName: { name: '해솔', gate: 'pass' },
  }
  const judge = (cr: PersonaCreative | null) => judgeAutogenBatch([{ ...base, creative: cr }], {
    takenCodes: new Set(pool.cards.map((c) => c.code)), existingCards: pool.cards, productionBundles: [],
  }).verdicts[0]!
  const f = fakeCall(() => okResponse(GOOD))
  const r = await generateCreatives({ briefs: [brief], avoid: [], forbiddenTextsOf: () => TEXTS, call: f.call })
  const gen = r.ok ? r.outcomes[0]!.creative : null
  const v = judge(gen)
  // 🔴 운영 묶음이 없으면 문체 분리 기준을 못 잰다 — 그 이유 하나만 남아야 한다(다른 칸은 전부 통과)
  check('생성된 creative → 카드 파서 · seed · 계약 · 글/댓글 자격 통과 (남는 이유는 분리 기준 모름 하나)',
    v.blocks.join(',') === 'VOICE_SEPARATION_UNMEASURED' && v.cardMarkdown !== null && v.seed !== null, v.blocks.join(','))
  check('creative 없음 → LLM_STEP_UNIMPLEMENTED (기본값 0)', judge(null).blocks.includes('LLM_STEP_UNIMPLEMENTED'))
  const p01 = pool.cards.find((c) => c.code === 'P01')!
  const copy: PersonaCreative = { ...GOOD, personality: p01.personality, noGoTopics: p01.noGoTopics, noGoExpressions: p01.noGoExpressions }
  check('🔴 기존 Persona(P01)의 성격 · noGo 를 베낀 creative → NEAR_DUPLICATE_PERSONA', judge(copy).blocks.includes('NEAR_DUPLICATE_PERSONA'))
  check('🔴 기존 Persona 와 같은 제목 → NEAR_DUPLICATE_PERSONA', judge({ ...GOOD, title: p01.title }).blocks.includes('NEAR_DUPLICATE_PERSONA'))
}

// ─────────────────────────────────────────────────────────
console.log('⑥ CLI 가드 — DB · provider 에 붙기 전에 멈춘다')
// ─────────────────────────────────────────────────────────
{
  const T = mkdtempSync(join(tmpdir(), 'soran-creative-guard-'))
  const log = join(T, 'fake.log')
  writeFileSync(log, '')
  const env = { ...process.env, HOME: T, DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
    NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts', 'lib', 'fake-provider-hook.mjs')}`, FAKE_PROVIDER_LOG: log }
  const out = join(T, 'creative.json')
  const good = join(T, 'good.json')
  const broken = join(T, 'broken.json')
  writeFileSync(good, JSON.stringify({ P26: GOOD }))
  writeFileSync(broken, JSON.stringify({ P26: { ...GOOD, noGoExpressions: ['따옴표 없음'] } }))
  const cases: [string, string[], RegExp][] = [
    ['--db 없음', ['--generate-creative', `--creative-out=${out}`], /--db 가 필요하다/],
    ['--apply 동시', ['--db', '--generate-creative', '--apply', `--creative-out=${out}`], /--apply 를 함께 쓰지 않는다/],
    ['--supplement 동시', ['--db', '--generate-creative', `--supplement=${join(T, 'sup.json')}`, `--creative-out=${out}`], /--supplement 를 함께 쓰지 않는다/],
    ['결과 파일 없음', ['--db', '--generate-creative'], /--creative-out=/],
    ['9명', ['--db', '--generate-creative', `--creative-out=${out}`, '--count=9'], /8명까지다/],
    ['이어 하기 — 앞 비용 없음', ['--db', '--generate-creative', `--creative-out=${out}`, `--resume-creative=${good}`], /--prior-usd/],
    ['이어 하기 + --apply', ['--db', '--generate-creative', '--apply', `--creative-out=${out}`, `--resume-creative=${good}`, '--prior-usd=0.02'], /--apply 를 함께 쓰지 않는다/],
    ['상한 $0.06', ['--db', '--generate-creative', `--creative-out=${out}`, '--cost-cap=0.06'], /--cost-cap 은 0 초과/],
    ['앞 비용이 전체 상한을 다 썼다', ['--db', '--generate-creative', `--creative-out=${out}`, `--resume-creative=${good}`, '--prior-usd=0.05'], /남은 상한이 없다/],
    ['--cost-cap 만 (생성 없음)', ['--cost-cap=0.02'], /--generate-creative 와만 쓴다/],
    ['🔴 망가진 이어 하기 파일', ['--db', '--generate-creative', `--creative-out=${out}`, `--resume-creative=${broken}`, '--prior-usd=0.02'], /엄격 검증을 통과하지 못했다/],
    ['🔴 망가진 --supplement 파일', ['--db', `--supplement=${broken}`], /엄격 검증을 통과하지 못했다/],
  ]
  for (const [name, args, re] of cases) {
    const run = spawnSync('npx', ['tsx', 'scripts/persona-autogen.mts', ...args], { env, encoding: 'utf-8' })
    check(`${name} → exit 1 · 사유`, run.status === 1 && re.test(run.stderr), (run.stderr ?? '').slice(-200))
  }
  check('🔴 가드 회차 전부 provider 요청 0', readFileSync(log, 'utf-8').trim() === '')
  check('🔴 가드 회차 전부 결과 파일 write 0', !existsSync(out))
  rmSync(T, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────
console.log('⑦ batch — 호출 1회 · 구조 fail-closed')
// ─────────────────────────────────────────────────────────
const SIX = ['P26', 'P27', 'P28', 'P29', 'P30', 'P32']
const GOOD6 = JSON.parse(readFileSync('scripts/__fixtures__/persona-creative-batch-good.json', 'utf-8')) as Record<string, PersonaCreative>
const ACTUAL = JSON.parse(readFileSync('scripts/__fixtures__/persona-creative-actual-20261006.json', 'utf-8')) as Record<string, PersonaCreative>
const POOL = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
const LIVES = new Map(proposeLifeSkeletons({ existing: POOL.cards, codes: Array.from({ length: 8 }, (_, i) => autogenCodeOf(26 + i)) })
  .map((x) => [x.code, x.life]))
{
  const briefs = SIX.map((c) => creativeBriefOf({ code: c, life: LIVES.get(c)!, voiceCore: voiceCoreFromBundle(bundle), style: bundle.style }))
  const avoid = POOL.cards.map(compactPeerOf)
  const batchCall = (raw: (codes: string[]) => string, extra: Partial<LlmResponse> = {}) => {
    let n = 0
    const bodies: string[] = []
    return {
      calls: () => n, bodies,
      call: (async (req) => {
        n += 1
        bodies.push(req.userPayload)
        const codes = (JSON.parse(req.userPayload) as { candidates: { code: string }[] }).candidates.map((x) => x.code)
        return okResponse(raw(codes), { inputTokens: 4000, outputTokens: 2000, ...extra })
      }) as CreativeCall,
    }
  }
  const pick = (m: Record<string, PersonaCreative>) => (codes: string[]) => JSON.stringify(Object.fromEntries(codes.map((c) => [c, m[c]])))
  const run = (f: ReturnType<typeof batchCall>, capUsd?: number) => generateCreativeBatch({
    briefs, avoid, forbiddenTextsOf: () => TEXTS, call: f.call, ...(capUsd === undefined ? {} : { capUsd }),
  })

  const f1 = batchCall(pick(GOOD6))
  const r1 = await run(f1)
  check('🔴 6명 batch → provider 정확히 1회', f1.calls() === 1)
  check('6명 전부 형식 통과 (status parsed)', r1.ok && r1.status === 'parsed' && Object.keys(r1.creatives).length === 6)
  check('실제 비용 = 사용량 × 정본 단가', r1.ledger.usd !== null && Math.abs(r1.ledger.usd - (4000 * 1 + 2000 * 5) / 1e6) < 1e-12)
  const body = f1.bodies[0] ?? ''
  const sent = JSON.parse(body) as { candidates: { code: string; life: Record<string, unknown> }[]; avoid: Record<string, unknown>[] }
  check('🔴 payload 에 후보 6명', JSON.stringify(sent.candidates.map((x) => x.code)) === JSON.stringify(SIX))
  check('🔴 payload — 댓글 원문 0 · 생일 0 · 화자 · 회원 · 표시명 · 원작자 칸 0',
    payloadLeaks(body, bundle.comments.map((x) => x.text)) === 0 && !/birthDate|\d{4}-\d{2}-\d{2}/.test(body)
    && !/speaker|anchor|userId|displayName|nickname|author/i.test(body))
  check('🔴 기존 Persona 는 압축 — 제목 · 핵심 성격(≤5)만 · noGo · 변주 칸 0',
    sent.avoid.length === POOL.cards.length && sent.avoid.every((a) => JSON.stringify(Object.keys(a)) === '["title","personality"]'
      && (a.personality as string[]).length <= 5))
  const reserveSix = reserveOf({ model: CREATIVE_MODEL,
    countedInputTokens: Buffer.byteLength(CREATIVE_BATCH_SYSTEM_PROMPT) + Buffer.byteLength(creativeBatchPayload(briefs, avoid)),
    maxOutputTokens: CREATIVE_BATCH_MAX_OUTPUT_TOKENS, headroomMultiplier: 1 })
  check(`정본 batch 6명 최악 예약 < $${CREATIVE_BATCH_COST_CAP_USD} (부를 수 있는 크기)`, reserveSix.known && reserveSix.usd < CREATIVE_BATCH_COST_CAP_USD,
    reserveSix.known ? `$${reserveSix.usd.toFixed(4)}` : '')

  const f2 = batchCall(pick(GOOD6))
  const r2 = await run(f2, reserveSix.known ? reserveSix.usd / 2 : 0)
  check('🔴 최악 예약 > 상한 → 호출 0', f2.calls() === 0 && !r2.ok)
  const fBig = batchCall(pick(GOOD6))
  const rBig = await run(fBig, 1)
  check('🔴 상한 인자를 크게 줘도 batch hard cap 을 넘지 못한다', rBig.ledger.capUsd === CREATIVE_BATCH_COST_CAP_USD)

  const structural = async (name: string, raw: (codes: string[]) => string, re: RegExp): Promise<void> => {
    const f = batchCall(raw)
    const r = await run(f)
    check(`🔴 ${name} → 전체 batch invalid · creative 0`, f.calls() === 1 && r.ok && r.status === 'invalid'
      && Object.keys(r.creatives).length === 0 && r.problems.some((p) => re.test(p)), r.ok ? r.problems.join(' / ') : r.reason)
  }
  await structural('코드 1개 누락', (codes) => JSON.stringify(Object.fromEntries(codes.slice(1).map((c) => [c, GOOD6[c]]))), /빠진 코드: P26/)
  await structural('요청하지 않은 코드 추가', (codes) => JSON.stringify({ ...Object.fromEntries(codes.map((c) => [c, GOOD6[c]])), P31: GOOD6.P26 }), /요청하지 않은 코드: P31/)
  await structural('코드 중복(JSON.parse 가 조용히 고르는 키)', (codes) => {
    const ok = JSON.stringify(Object.fromEntries(codes.map((c) => [c, GOOD6[c]])))
    return `${ok.slice(0, -1)},"P27":${JSON.stringify(GOOD6.P27)}}`
  }, /중복 코드: P27/)
  await structural('잘린 출력', (codes) => JSON.stringify(Object.fromEntries(codes.map((c) => [c, GOOD6[c]]))).slice(0, 300), /JSON 이 아니다/)
  {
    const f = batchCall(pick({ ...GOOD6, P30: { ...GOOD6.P30!, variations: ['하나'] } }))
    const r = await run(f)
    check('🔴 한 후보 형식 위반 → batch invalid · 그 후보만 creative 없음(나머지는 결과 파일용으로만 남는다)',
      r.ok && r.status === 'invalid' && r.creatives.P30 === undefined && Object.keys(r.creatives).length === 5
      && outcomesOfBatch(r, SIX).find((o) => o.code === 'P30')?.status === 'invalid')
  }
  {
    const f = batchCall(pick(GOOD6), { maxTokensReached: true })
    const r = await run(f)
    check('🔴 출력 상한 닿음 → call-failed · creative 0 · 재시도 0', f.calls() === 1 && r.ok && r.status === 'call-failed' && Object.keys(r.creatives).length === 0)
  }
  {
    const f = batchCall(pick(GOOD6))
    const r = await generateCreativeBatch({ briefs, avoid: [{ title: TEXTS[1]!, personality: [] }], forbiddenTextsOf: () => TEXTS, call: f.call })
    check('🔴 나가는 글에 원문 → 호출 0 · 전원 leak-blocked', f.calls() === 0 && !r.ok && outcomesOfBatch(r, SIX).every((o) => o.status === 'leak-blocked'))
  }
}

// ─────────────────────────────────────────────────────────
console.log('⑧ creative 묶음 품질 — 단일 판정 judgeCreativeQuality')
// ─────────────────────────────────────────────────────────
{
  const q = (m: Record<string, PersonaCreative>) => judgeCreativeQuality({
    candidates: Object.entries(m).map(([code, creative]) => ({ code, creative, life: LIVES.get(code)! })),
    existingTitles: POOL.cards.map((c) => c.title),
  })
  const good = q(GOOD6)
  check('🔴 정상적으로 다른 6명 → PASS', good.ok, good.problems.join(' / '))
  check('정상 6명 — 후보마다 고유 대화 행동 ≥ 2', Object.values(good.uniqueBehaviors).every((n) => n >= 2) && Object.keys(good.uniqueBehaviors).length === 6)
  const act = q(ACTUAL)
  const has = (re: RegExp): boolean => act.problems.some((p) => re.test(p))
  check('🔴 실측 5명 파일 → FAIL', !act.ok)
  check('실측 — "침착함" · "자족적" personality 반복', has(/P26,P27,P29: 같은 personality — "침착함"/) && has(/P26,P29,P32: 같은 personality — "자족적"/))
  check('실측 — "남의 말을 먼저 받아주기" variation 반복', has(/P26,P28: 같은 variation/))
  check('실측 — P26 · P32 고유 대화 행동 0개 (전부 다른 후보와 같은 행동)', has(/P26: 고유 대화 행동 0개/) && has(/P32: 고유 대화 행동 0개/))
  check('실측 — P28 상태 낙인형 title', has(/P28: 상태 낙인형 title — "이혼녀"/))

  const swap = (code: string, patch: Partial<PersonaCreative>) => ({ ...GOOD6, [code]: { ...GOOD6[code]!, ...patch } })
  const fails = (name: string, m: Record<string, PersonaCreative>, re: RegExp): void => {
    const r = q(m)
    check(`🔴 ${name} → FAIL`, !r.ok && r.problems.some((p) => re.test(p)), r.problems.join(' / ') || 'PASS')
  }
  fails('같은 personality (공백 무시)', swap('P32', { personality: ['논리적', '셈이빠름', '계획적'] }), /P26,P32: 같은 personality/)
  fails('같은 variation', swap('P32', { variations: ['쉽게 반박하기', '근거 묻기', '장단점 나눠 보기', '기사 링크 요약', '결론부터 한 줄'] }), /P26,P32: 같은 variation/)
  fails('형용사만 바꾼 대화 행동 — 고유 행동 < 2', swap('P32', {
    variations: ['쉽게 반박하기', '가격 비교 먼저', '손님 이야기로 비유', '날짜 확인부터', '질문으로 파고듦'] }), /P32: 고유 대화 행동 1개 < 2/)
  for (const label of STATUS_LABELS.slice(0, 3)) fails(`상태 낙인형 title "${label}"`, swap('P28', { title: `새 동네 ${label}` }), /상태 낙인형 title/)
  fails('기존 Persona 와 같은 title', swap('P28', { title: POOL.cards[0]!.title }), /기존 Persona 와 같은 title/)
  fails('후보끼리 같은 title', swap('P28', { title: GOOD6.P27!.title }), /P27,P28: 같은 title/)
  fails('noGo 가 생활사 축 전부를 막음(빈 사람)', swap('P29', { noGoTopics: ['직장 이야기', '부모 돌봄', '갱년기 증상'] }), /P29: noGo 가 생활사 축 전부/)
  check('생활사 일부만 피하는 noGo 는 통과(정상 fixture 그대로)', !good.problems.some((p) => /빈 사람/.test(p)))

  // 🔴 미완성 batch — 형식 통과한 3명만 넘어와도 6명 묶음은 PASS 가 아니다
  const three = Object.fromEntries(['P27', 'P28', 'P29'].map((c) => [c, GOOD6[c]!]))
  const inc = judgeCreativeQuality({
    candidates: Object.entries(three).map(([code, creative]) => ({ code, creative, life: LIVES.get(code)! })),
    existingTitles: POOL.cards.map((c) => c.title), expected: SIX,
  })
  check('🔴 기대 6명 중 3명 → INCOMPLETE (PASS 아님)', inc.status === 'INCOMPLETE' && !inc.ok
    && inc.problems.some((p) => /INCOMPLETE: 기대 6명 중 3명 — creative 없음 P26,P30,P32/.test(p)), inc.problems[0] ?? inc.status)
  check('같은 3명도 기대 후보를 안 주면 그 3명 기준 PASS(기대 후보가 판정을 가른다)', q(three).status === 'PASS')

  // 🔴 항목 최대 글자 수는 없다 — 27~29자 대화 행동도 다른 계약을 어기지 않으면 통과
  const long = { ...GOOD6, P30: { ...GOOD6.P30!, variations: [
    '예전 일을 떠올리며 지금 형편과 천천히 견주어 보기', '자녀 이야기를 꺼내되 자랑보다 걱정을 먼저 말하기',
    ...GOOD6.P30!.variations.slice(2)] } }
  check('fixture 가 27~29자다', long.P30.variations.slice(0, 2).every((v) => [...v].length >= 27 && [...v].length <= 29))
  check('🔴 27~29자 대화 행동 → 형식 통과', parseCreative(JSON.stringify(long.P30)).ok)
  check('🔴 27~29자 대화 행동 → 묶음 품질 PASS', q(long).ok, q(long).problems.join(' / '))
  check('🔴 noGo 소재 1글자 → 여전히 거부(부분 문자열 대조)', !parseCreative(JSON.stringify({ ...GOOD6.P26!, noGoTopics: ['돈'] })).ok)
  check('🔴 말버릇 열쇠 1글자 → 여전히 거부', !parseCreative(JSON.stringify({ ...GOOD6.P26!, noGoExpressions: ['"네"'] })).ok)
}

// ─────────────────────────────────────────────────────────
console.log('⑧-b 대화 행동 비교 — 핵심 낱말 절반 이상 겹침')
// ─────────────────────────────────────────────────────────
{
  const same = (a: string, b: string, want: boolean, why: string): void =>
    check(`${want ? '같다' : '다르다'} — "${a}" · "${b}" (${why})`, sameBehavior(a, b) === want, behaviorWordsOf(a).join('/') + ' | ' + behaviorWordsOf(b).join('/'))
  // 정상 분리 — 앞판(앞 두 글자 · 한 낱말 겹침)이 같은 행동으로 막던 것
  same('사진 묘사로 시작', '계절 인사로 시작', false, '오탐 방지 — "시작" 한 낱말만 겹친다')
  same('질문으로 파고들기', '질투 섞인 농담', false, '오탐 방지 — 앞 두 글자 "질" 우연 일치가 아니다')
  same('결론부터 한 줄', '되묻지 않고 단정', false, '정상 분리')
  same('숫자와 날짜부터 확인', '쉽게 반박하기', false, '정상 분리')
  // 같은 행동 — 꾸밈말만 바꿨다
  same('상황 설명하기', '담담한 상황 설명', true, '꾸밈말 · 어미만 다르다')
  same('짧은 경험담', '경험담 덤덤하게 풀기', true, '적은 쪽 낱말 전부가 겹친다')
  same('남의 말을 먼저 받아주기', '남의 말을 먼저 알아주기', true, '핵심 낱말 절반이 같다')
  // 🟡 알려진 미탐 — 같은 뜻의 다른 낱말은 잡지 않는다(뜻 사전 없음)
  same('작은 해결책 제시', '실질적인 해결법 찾기', false, '알려진 미탐 — 해결책 ≠ 해결법')
}

// ─────────────────────────────────────────────────────────
console.log('⑨ CLI 가드 — batch')
// ─────────────────────────────────────────────────────────
{
  const T = mkdtempSync(join(tmpdir(), 'soran-creative-batch-guard-'))
  const log = join(T, 'fake.log')
  writeFileSync(log, '')
  const env = { ...process.env, HOME: T, DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none',
    NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts', 'lib', 'fake-provider-hook.mjs')}`, FAKE_PROVIDER_LOG: log }
  const out = join(T, 'c.json')
  writeFileSync(join(T, 'g.json'), JSON.stringify({ P26: GOOD6.P26 }))
  const cases: [string, string[], RegExp][] = [
    ['--creative-batch 만', ['--db', '--creative-batch', `--creative-out=${out}`], /--generate-creative 와만 쓴다/],
    ['batch + 이어 하기', ['--db', '--generate-creative', '--creative-batch', `--creative-out=${out}`, `--resume-creative=${join(T, 'g.json')}`, '--prior-usd=0.01'], /--resume-creative · --prior-usd 와 쓰지 않는다/],
    ['batch + --cost-cap 0.04', ['--db', '--generate-creative', '--creative-batch', `--creative-out=${out}`, '--cost-cap=0.04'], /batch 상한 \$0\.03 이하/],
    ['batch + --apply', ['--db', '--generate-creative', '--creative-batch', '--apply', `--creative-out=${out}`], /--apply 를 함께 쓰지 않는다/],
  ]
  for (const [name, args, re] of cases) {
    const r = spawnSync('npx', ['tsx', 'scripts/persona-autogen.mts', ...args], { env, encoding: 'utf-8' })
    check(`${name} → exit 1 · 사유`, r.status === 1 && re.test(r.stderr), (r.stderr ?? '').slice(-200))
  }
  check('🔴 batch 가드 회차 provider 0 · 결과 파일 0', readFileSync(log, 'utf-8').trim() === '' && !existsSync(out))
  rmSync(T, { recursive: true, force: true })
}

console.log(`\n${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail`)
console.log('🔴 DB 0 · 네트워크 0 · 유료 호출 0 — provider 는 주입한 가짜 함수 · CLI 는 가짜 fetch')
process.exit(failN === 0 ? 0 : 1)
