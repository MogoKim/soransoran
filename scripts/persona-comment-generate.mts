#!/usr/bin/env tsx
/**
 * 페르소나 댓글 후보 생성 — 🔴 기본 dry-run. --call 없이는 API 호출 0 · 비용 0
 *
 * 정본: docs/operations/2026-08-30-persona-architecture-design.md §10-1
 *       docs/operations/2026-08-30-persona-safety-originality-gate-design.md §1
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   [생성] ──▶ tmp/persona-comment-candidates.json ──▶ persona-comment-dry-run(Gate)
 *     ↑ 여기                                              ──▶ --enqueue ──▶ PENDING
 *
 * 🔴 **여기가 종점이다.** Gate 도 적재도 발행도 하지 않는다.
 *    --enqueue 를 부르지 않는다. 생성물이 그대로 대기열에 들어가면
 *    "생성기가 켜지는 순간 대기열이 찬다" 가 되고, Gate 결과를 사람이 보는 단계가 사라진다.
 *
 * 🔴 API 는 voice-m3-provider.mts 로만 부른다.
 *    이 저장소가 유료 호출 경로를 하나로 묶어 둔 이유를 깨지 않는다 —
 *    경로가 하나면 감시할 곳도 하나다.
 *
 * 🔴 **원문 저장 금지.** 대상 글 본문은 프롬프트로 나가지만 저장되지 않는다.
 *    candidates.json 에는 personaCode · text 만 남는다(persona-prompt.ts 계약).
 *    sourceTexts 는 Gate 가 런타임에 받아야 하는 값이라 파일에 넣지 않는다 —
 *    Gate 를 돌릴 때 대상 글에서 다시 읽는다.
 *
 * 🔴 출력에 담지 않는 것
 *      대상 글 본문 · 후보 본문 전문 · 프롬프트 전문 · 닉네임 · API key
 *    길이 · 첫 글자 · 해시 앞자리로만 보고한다.
 *
 * 사용법
 *   npx tsx scripts/persona-comment-generate.mts --post-id <id> --reaction-type empathy
 *       → dry-run. 프롬프트 요약만 출력. API 호출 0 · 파일 write 0
 *
 *   npx tsx scripts/persona-comment-generate.mts --post-id <id> --reaction-type empathy --call
 *       → 🔴 실제 LLM 호출 1회. 결과를 tmp/persona-comment-candidates.json 에 기록
 *
 *   옵션  --persona-code P05   기본 P05
 *         --model claude-haiku-4.5 | gpt-5-mini | gpt-5-nano   기본 claude-haiku-4.5
 *         --limit 1            🔴 지금은 1 만 허용한다
 *
 * 종료 코드: 막히면 1 · dry-run 정상 종료 0
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { callProvider, keyStatus, type ProviderModel } from './lib/voice-m3-provider.mjs'
import {
  buildPrompt, parseCandidate, toCandidateRecord, assertNoStoredSource,
  extractVoiceMarks, isReactionType, REACTION_TYPES, REPEAT_CALLOUT_MIN,
  type CandidateRecord,
} from './lib/persona-prompt'

const OUTPUT_PATH = 'tmp/persona-comment-candidates.json'
/** 🔴 지금은 1 건씩이다. 대량 생성은 검토 부담을 사람에게 떠넘긴다 */
const MAX_LIMIT = 1
const DEFAULT_MODEL: ProviderModel = 'claude-haiku-4.5'
const TIMEOUT_MS = 60_000

const argv = process.argv.slice(2)
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k)
  return i === -1 ? undefined : argv[i + 1]
}
const CALL = argv.includes('--call')
const POST_ID = (arg('--post-id') ?? '').trim()
const PERSONA_CODE = (arg('--persona-code') ?? 'P05').trim()
const REACTION = (arg('--reaction-type') ?? '').trim()
const MODEL = (arg('--model') ?? DEFAULT_MODEL) as ProviderModel
const LIMIT = Number.parseInt(arg('--limit') ?? '1', 10)

const fail: (m: string) => never = (m) => {
  console.error(`\n🔴 중단: ${m}\n`)
  process.exit(1)
}
const mask = (v: string): string => `${v.slice(0, 4)}…${v.slice(-3)}`
/** 🔴 전문을 남기지 않는다 — 첫 글자 + 길이 */
const brief = (v: string): string => {
  const c = [...v.trim()]
  return c.length === 0 ? '(비어 있음)' : `"${c[0]}…" (${c.length}자)`
}
/** 프롬프트는 길이와 해시 앞자리만 남긴다 — 재현 대조에는 충분하고 내용은 새지 않는다 */
const digest = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 8)

console.log(`\n══ ${CALL ? '🔴 실제 호출 (--call)' : 'dry-run'} ══`)

if (POST_ID === '') fail('--post-id 가 필요합니다.')
if (!isReactionType(REACTION)) {
  fail(`--reaction-type 이 필요합니다 — ${REACTION_TYPES.join(' · ')}`)
}
if (!Number.isInteger(LIMIT) || LIMIT < 1 || LIMIT > MAX_LIMIT) {
  fail(`--limit 은 ${MAX_LIMIT} 까지입니다 (받은 값: ${arg('--limit') ?? '1'}).`)
}

await loadEnvLocal()
const prisma = new PrismaClient()

// ── 페르소나 ──
const persona = await prisma.persona.findUnique({
  where: { code: PERSONA_CODE },
  select: {
    code: true, status: true, ageBand: true, region: true, lifeStage: true,
    identity: true, voiceCore: true, voiceVariations: true,
    noGoTopics: true, noGoExpressions: true, forbiddenReactionRoles: true,
  },
})
if (persona === null) { await prisma.$disconnect(); fail(`페르소나 ${PERSONA_CODE} 를 찾지 못했습니다.`) }

// ── 대상 글 ──
const post = await prisma.post.findUnique({
  where: { id: POST_ID },
  select: { id: true, title: true, content: true, boardType: true, status: true },
})
if (post === null) { await prisma.$disconnect(); fail('대상 글을 찾지 못했습니다.') }
// 🔴 공개 글에만 단다. 숨김·삭제 글에 댓글을 만들 이유가 없다
if (post.status !== 'PUBLISHED') {
  await prisma.$disconnect()
  fail(`대상 글이 공개 상태가 아닙니다 (${post.status}).`)
}

console.log(`\n페르소나  ${persona.code} (${persona.status})`)
console.log(`대상 글    ${mask(post.id)} · ${post.boardType} · 제목 ${brief(post.title)} · 본문 ${[...post.content].length}자`)
console.log(`반응 유형  ${REACTION}`)

// ── 🔴 최근 발화의 말투 표지 (A안) ──
//    ⑧ 은 이 페르소나의 이전 발화와 비교해 말끝·시작어절 반복을 잡는데,
//    모델은 자기가 예전에 뭘 썼는지 모른다. 첫 어절과 말끝만 뽑아 알려 준다.
//
// 🔴 본문은 프롬프트로 나가지 않는다. extractVoiceMarks 가 표지만 남긴다.
//    본문을 넣으면 이전 생성물이 다시 들어가 비슷하게 쓰도록 부추긴다.
const recentTexts: string[] = []
{
  // ① 이미 발행된 이 페르소나의 댓글
  const publishedByPersona = await prisma.comment.findMany({
    where: { personaId: { not: null }, isDeleted: false, persona: { code: persona.code } },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  recentTexts.push(...publishedByPersona.map((c) => c.content))

  // ② 아직 발행되지 않은 같은 페르소나의 후보 (파일)
  if (existsSync(OUTPUT_PATH)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'))
      if (Array.isArray(raw)) {
        for (const item of raw as Array<Record<string, unknown>>) {
          if (item.personaCode === persona.code && typeof item.text === 'string') {
            recentTexts.push(item.text)
          }
        }
      }
    } catch {
      // 🔴 읽지 못해도 생성을 멈추지 않는다. 표지가 없으면 그 지시만 빠진다
      console.log('   🟡 후보 파일을 읽지 못해 최근 말투 표지를 일부만 씁니다')
    }
  }
}
const recentMarks = extractVoiceMarks(recentTexts)
console.log(
  `\n최근 말투 표지  대조 발화 ${recentTexts.length}건 →` +
    ` 시작어절 ${recentMarks.openers.length}종 · 말끝 ${recentMarks.endings.length}종` +
    ' (🔴 본문 미사용)',
)
// 🔴 반복된 첫 글자를 사람이 보게 한다.
//    #12 때는 회피 목록에 그 글자가 **이미 있었는데도** 8자 나열에 섞여 보이지 않았고,
//    프롬프트가 최빈값을 지목하지 않는다는 사실도 화면에 드러나지 않았다.
{
  const repeated = recentMarks.openerInitials.filter((e) => e.count >= REPEAT_CALLOUT_MIN)
  console.log(
    repeated.length === 0
      ? `   시작 첫글자 반복 없음 (${recentMarks.openerInitials.length}종 · 전부 1회)`
      : `   🔴 시작 첫글자 반복 ${repeated.map((e) => `"${e.initial}" ${e.count}회`).join(' · ')}` +
          ' → 프롬프트가 이름을 대고 막습니다',
  )
}

// ── 프롬프트 ──
const plan = buildPrompt({
  recentMarks,
  persona: {
    code: persona.code,
    ageBand: persona.ageBand,
    region: persona.region,
    lifeStage: persona.lifeStage,
    identity: persona.identity,
    voiceCore: persona.voiceCore,
    voiceVariations: persona.voiceVariations,
    noGoTopics: persona.noGoTopics,
    noGoExpressions: persona.noGoExpressions,
    forbiddenReactionRoles: persona.forbiddenReactionRoles,
  },
  post: { title: post.title, content: post.content, boardLabel: post.boardType },
  reactionType: REACTION,
})

if (!plan.ok) {
  console.error('\n⛔ BLOCKED')
  for (const b of plan.blocks) console.error(`   [${b.code}] ${b.message}`)
  await prisma.$disconnect()
  process.exit(1)
}

const { systemPrompt, userPayload, maxOutputTokens } = plan.prompt
console.log('\n── 프롬프트 (🔴 전문 미출력) ──')
console.log(`  system   ${systemPrompt.length}자 · sha ${digest(systemPrompt)}`)
console.log(`  user     ${userPayload.length}자 · sha ${digest(userPayload)}`)
console.log(`  모델      ${MODEL} · maxOutputTokens ${maxOutputTokens}`)
const key = keyStatus(MODEL)
console.log(`  API key   ${key.envName} ${key.present ? '있음' : '🔴 없음'}`)

// ── dry-run 종료 ──
if (!CALL) {
  await prisma.$disconnect()
  console.log('\n🟡 dry-run 입니다. API 호출 0 · 파일 write 0 · DB write 0')
  console.log('   실제로 생성하려면 --call 을 붙입니다.\n')
  process.exit(0)
}

// ── 🔴 여기서 돈이 나간다 ──
if (!key.present) { await prisma.$disconnect(); fail(`${key.envName} 가 없습니다.`) }

console.log('\n🔴 LLM 호출 1회…')
const res = await callProvider({
  model: MODEL,
  systemPrompt,
  userPayload,
  maxOutputTokens,
  timeoutMs: TIMEOUT_MS,
})
console.log(
  `  ok=${res.ok} · in ${res.inputTokens} · out ${res.outputTokens}` +
    ` · finish=${res.finishReason || '(없음)'} · chars ${res.responseChars}` +
    `${res.maxTokensReached ? ' · 🔴 상한 도달' : ''}`,
)
if (!res.ok) {
  await prisma.$disconnect()
  fail(`호출 실패 — ${res.errorCode ?? '?'} ${res.errorMessage ?? ''}`)
}

const parsed = parseCandidate(res.rawText)
if (!parsed.ok) {
  await prisma.$disconnect()
  fail(`응답을 읽지 못했습니다 — [${parsed.errorCode}] ${parsed.message}`)
}
console.log(`\n생성물  ${brief(parsed.text)}`)

// ── 저장 — 🔴 원문 저장 금지 계약을 실측으로 확인한 뒤에만 쓴다 ──
// 🔴 sourcePostId 는 원문이 아니라 참조다. Gate 가 이 id 로 원문을 DB 에서 읽는다 —
//    그래야 파일에 원문을 두지 않고도 ① 20자 유출 검사가 성립한다.
const record: CandidateRecord = toCandidateRecord({
  personaCode: persona.code,
  text: parsed.text,
  sourcePostId: post.id,
})

// 기존 파일이 있으면 이어 붙인다. 🔴 덮어쓰면 손으로 채운 후보가 사라진다
let existing: CandidateRecord[] = []
if (existsSync(OUTPUT_PATH)) {
  try {
    const raw: unknown = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'))
    if (Array.isArray(raw)) existing = raw as CandidateRecord[]
  } catch {
    await prisma.$disconnect()
    fail(`${OUTPUT_PATH} 를 읽지 못했습니다. 손대지 않고 멈춥니다.`)
  }
}

// 🔴 새로 쓰는 레코드만 검사한다. 기존 항목은 이 스크립트가 만든 것이 아니다
assertNoStoredSource([record], [post.title, post.content])

mkdirSync('tmp', { recursive: true })
writeFileSync(OUTPUT_PATH, JSON.stringify([...existing, record], null, 2) + '\n', 'utf-8')

await prisma.$disconnect()
console.log(`\n✅ 기록 — ${OUTPUT_PATH} (기존 ${existing.length}건 + 1건 · gitignored)`)
console.log('   🔴 대기열에 넣지 않았습니다. Gate 판정은 아래를 따로 실행합니다:')
console.log('      npx tsx scripts/persona-comment-dry-run.mts')
console.log('   Gate 결과를 사람이 본 뒤에만 --enqueue 를 붙입니다.\n')
