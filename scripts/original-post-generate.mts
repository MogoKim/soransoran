#!/usr/bin/env tsx
/**
 * 오리지널 게시글 초안 생성 — 🔴 기본 dry-run. --call 없이는 API 호출 0 · 비용 0
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
 *
 * 파이프라인에서 이 스크립트가 채우는 자리
 *   [수집 완료] MicroSeedRawContent ──▶ [생성] ──▶ tmp/original-post-candidates.json
 *                                         ↑ 여기        ──▶ (PR-B) originality gate
 *                                                       ──▶ (PR-C) 검수 대기열
 *                                                       ──▶ (PR-D) 발행
 *
 * 🔴 **여기가 종점이다.** 판정도 적재도 발행도 하지 않는다.
 *    Post 를 만들지 않는다. Post 의 persona 연결(3축 필드)도 채우지 않는다.
 *    초안 파일까지가 이 스크립트의 전부다 — 사람이 초안을 보는 단계를 없애지 않는다.
 *
 * 🔴 **크롤하지 않는다.** 이미 DB 에 있는 MicroSeedRawContent 만 읽는다.
 *    네트워크로 나가는 것은 LLM 호출(--call) 하나뿐이다.
 *
 * 🔴 API 는 voice-m3-provider.mts 로만 부른다.
 *    이 저장소가 유료 호출 경로를 하나로 묶어 둔 이유를 깨지 않는다 —
 *    경로가 하나면 감시할 곳도 하나다.
 *
 * 🔴 **원문 저장 금지.** 원문은 프롬프트로 나가지만 저장되지 않는다.
 *    candidates 파일에는 sourceRawContentId · title · body 만 남는다.
 *    원문은 MicroSeedRawContent 에 이미 원형으로 있다 — 두 벌 두지 않는다.
 *
 * 🔴 출력에 담지 않는 것
 *      원문 제목·본문 · 초안 본문 전문 · 프롬프트 전문 · sourceUrl · API key
 *    길이 · 첫 글자 · 해시 앞자리 · 세어 본 값으로만 보고한다.
 *
 * 사용법
 *   npx tsx scripts/original-post-generate.mts
 *       → dry-run. 재료 선정과 프롬프트 요약만. API 0 · 파일 write 0 · DB write 0
 *
 *   npx tsx scripts/original-post-generate.mts --limit 3
 *       → dry-run 으로 3건 계획 확인
 *
 *   npx tsx scripts/original-post-generate.mts --limit 3 --call
 *       → 🔴 실제 LLM 호출 3회. 결과를 tmp/original-post-candidates.json 에 append
 *
 *   옵션  --raw-id <id,id,id>   재료를 직접 고른다 (기본: 길이가 서로 다른 것부터 자동 선정)
 *         --board MENOPAUSE|FREE  기본 MENOPAUSE
 *         --model claude-haiku-4.5 | gpt-5-mini | gpt-5-nano   기본 claude-haiku-4.5
 *         --limit 1~3          기본 1 · 🔴 상한 3
 *
 * 종료 코드: 막히면 1 · dry-run 정상 종료 0
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { callProvider, keyStatus, PROVIDER_KEY_ENV, type ProviderModel } from './lib/voice-m3-provider.mjs'
import { outputTokenPolicyFor } from './lib/voice-m3-contract.mjs'
import {
  buildPrompt, parseDraft, toOriginalPostRecord, assertNoStoredSource, analyzeDraft,
  isPostBoardHint, POST_BOARD_HINTS, RAW_BODY_MIN_CHARS, MAX_VOICE_SAMPLES,
  partitionByStoredSource, selectByLengthQuantile,
  type OriginalPostRecord,
} from './lib/original-post-prompt'
import { selectVoiceSamples, type VoiceLearningRow, type ManualDecisionRow } from './lib/voice-sample-select'
import { readSourceProfile, mustKeepDetails, MAX_QUESTION_MARKS } from './lib/source-profile'
import { READ_QUERIES, loadUnaoReadonlyUrl } from './lib/voice-unao-readonly.mjs'
import pg from 'pg'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUT_PATH = 'tmp/original-post-candidates.json'
/**
 * 🔴 상한 5 (2026-09-01, 3 → 5).
 *
 * 3 이던 이유는 "비교" 였다 — 원문 하나만 보면 "이 정도면 괜찮나" 를 알 수 없다.
 * 5 로 올리는 이유는 다르다: **길이 구간을 다 덮기 위해서**다.
 * 짧음 · 중간 · 김 · 매우 김 네 구간을 3자리로는 채울 수 없고,
 * 지금까지 실패가 전부 긴 글에서 났는데 긴 쪽 표본이 한 자리뿐이었다.
 *
 * 🔴 그 이상은 올리지 않는다. 검토는 사람이 하고, 한 번에 읽을 수 있는 양이 있다.
 *    30건이 필요하면 5건씩 여섯 번이지 한 번에 30건이 아니다.
 */
const MAX_LIMIT = 5
const DEFAULT_MODEL: ProviderModel = 'claude-haiku-4.5'
const TIMEOUT_MS = 90_000

const argv = process.argv.slice(2)
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k)
  return i === -1 ? undefined : argv[i + 1]
}
const CALL = argv.includes('--call')
const RAW_IDS = (arg('--raw-id') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')
const BOARD = (arg('--board') ?? 'MENOPAUSE').trim()
// 🔴 무검증 캐스팅을 하지 않는다. 오타 하나가 apiModelIdFor 의 throw 로만 드러나면
//    "왜 죽었는지" 를 스택에서 읽어야 한다 — 여기서 이름을 대고 막는다
const MODEL_RAW = (arg('--model') ?? DEFAULT_MODEL).trim()
const SUPPORTED_MODELS = Object.keys(PROVIDER_KEY_ENV)
const MODEL = MODEL_RAW as ProviderModel
const LIMIT = Number.parseInt(arg('--limit') ?? '1', 10)
/** 🔴 --no-voice 는 실패한 첫 판을 그대로 재현한다 — A/B 비교용이지 기본값이 아니다 */
const NO_VOICE = argv.includes('--no-voice')
const VOICE_SAMPLES = Number.parseInt(arg('--voice-samples') ?? '2', 10)

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
/** 프롬프트는 길이와 해시 앞자리만 남긴다 — 재현 대조에 충분하고 내용은 새지 않는다 */
const digest = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 8)
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

if (!Number.isInteger(LIMIT) || LIMIT < 1 || LIMIT > MAX_LIMIT) {
  fail(`--limit 은 1~${MAX_LIMIT} 입니다 (받은 값: ${arg('--limit') ?? '없음'})`)
}
if (!SUPPORTED_MODELS.includes(MODEL_RAW)) {
  fail(`--model 은 ${SUPPORTED_MODELS.join(' | ')} 입니다 (받은 값: ${MODEL_RAW})`)
}
if (!isPostBoardHint(BOARD)) {
  fail(`--board 는 ${POST_BOARD_HINTS.join(' | ')} 입니다 (받은 값: ${BOARD})`)
}
if (RAW_IDS.length > 0 && RAW_IDS.length !== LIMIT) {
  fail(`--raw-id 를 ${RAW_IDS.length}개 줬는데 --limit 은 ${LIMIT} 입니다. 수를 맞춰 주세요`)
}
if (!NO_VOICE && (!Number.isInteger(VOICE_SAMPLES) || VOICE_SAMPLES < 1 || VOICE_SAMPLES > MAX_VOICE_SAMPLES)) {
  fail(`--voice-samples 는 1~${MAX_VOICE_SAMPLES} 입니다 (받은 값: ${arg('--voice-samples') ?? '없음'})`)
}

await loadEnvLocal()
const prisma = new PrismaClient()

console.log(CALL ? '\n══ 🔴 실제 호출 (--call) ══\n' : '\n══ dry-run (API 0 · 파일 write 0 · DB write 0) ══\n')

// ── 재료 선정 — 🔴 읽기만 한다. 크롤하지 않는다 ──
const pool = await prisma.microSeedRawContent.findMany({
  where: RAW_IDS.length > 0 ? { id: { in: RAW_IDS } } : {},
  select: { id: true, rawTitle: true, rawBody: true, sourceSite: true, sourceCapturedAt: true },
  orderBy: { sourceCapturedAt: 'asc' },
})
if (pool.length === 0) {
  await prisma.$disconnect()
  fail('MicroSeedRawContent 가 없습니다. 이 스크립트는 크롤하지 않습니다 — 수집은 별도 레인입니다')
}
if (RAW_IDS.length > 0 && pool.length !== RAW_IDS.length) {
  await prisma.$disconnect()
  fail(`--raw-id ${RAW_IDS.length}개 중 ${pool.length}개만 찾았습니다`)
}

/**
 * 🔴 자동 선정은 **길이 분위수**로 고른다 (p0 · p25 · p50 · p75 · p100).
 *    비슷한 길이끼리 고르면 "어느 길이에서 실패하는가" 를 알 수 없다.
 *    규칙은 selectByLengthQuantile 에 있다 — 순수 함수라 fixture 가 DB 없이 잠근다.
 */
const usable = pool.filter((r) => [...r.rawBody.trim()].length >= RAW_BODY_MIN_CHARS)
if (usable.length === 0) {
  await prisma.$disconnect()
  fail(`재료로 쓸 수 있는 원문이 없습니다 (본문 ${RAW_BODY_MIN_CHARS}자 이상 필요)`)
}
const selected = RAW_IDS.length > 0
  ? usable
  : selectByLengthQuantile({
      items: usable,
      lengthOf: (r) => [...r.rawBody].length,
      keyOf: (r) => r.id,
      limit: LIMIT,
    })
if (selected.length < LIMIT) {
  await prisma.$disconnect()
  fail(`--limit ${LIMIT} 인데 쓸 수 있는 원문이 ${selected.length}건뿐입니다`)
}

console.log(`재료  MicroSeedRawContent ${pool.length}건 중 ${selected.length}건 선정 (🔴 크롤 없음 · read-only)`)
for (const [i, r] of selected.entries()) {
  // 🔴 분위수 라벨을 함께 찍는다 — "왜 이 다섯인가" 를 화면에서 알 수 있어야 한다
  const pct = selected.length > 1 ? Math.round((i * 100) / (selected.length - 1)) : 100
  console.log(
    `  [${i + 1}] p${String(pct).padStart(3)} · ${mask(r.id)} · ${r.sourceSite}` +
      ` · 제목 ${brief(r.rawTitle)} · 본문 ${[...r.rawBody].length}자`,
  )
}
{
  // 🔴 dry-run 에서도 어느 모델·어느 key 를 쓸지 보여준다.
  //    --call 을 붙이고 나서야 key 부재를 아는 것은 늦다
  const k = keyStatus(MODEL)
  console.log(`게시판  ${BOARD}`)
  console.log(`모델    ${MODEL} · key ${k.envName} ${k.present ? '있음' : '🔴 없음'}${MODEL === DEFAULT_MODEL ? ' (기본)' : ' (실험)'}\n`)
}

// ── 🔴 말투 샘플 조달 (2026-09-01) ──
//    첫 판이 실패한 이유는 재료가 하나뿐이라 그 하나가 소재와 말투를 겸했기 때문이다.
//    voice engine 은 이미 9,674건을 분석했고 사람이 3,093건을 판단했는데
//    생성기에 한 줄도 연결돼 있지 않았다. 여기가 그 연결선이다.
//
// 🔴 본문은 **저장하지 않는다.** 프롬프트에만 실리고, 유출 대조 대상으로만 남는다.
const voiceSampleBodies: string[] = []
if (!NO_VOICE) {
  // ① 산출물 디렉터리 — 🔴 파일명을 짓지 않고 실제 있는 것 중 최신을 찾는다
  const LEARN_ROOT = 'tmp/voice-m3-learning'
  if (!existsSync(LEARN_ROOT)) {
    await prisma.$disconnect()
    fail(`${LEARN_ROOT} 가 없습니다. voice:m3-select-learning -- --write 를 먼저 돌리거나 --no-voice 를 쓰세요`)
  }
  const runs = readdirSync(LEARN_ROOT)
    .filter((d) => statSync(join(LEARN_ROOT, d)).isDirectory())
    .sort()
  const latest = runs[runs.length - 1]
  if (latest === undefined) {
    await prisma.$disconnect()
    fail(`${LEARN_ROOT} 안에 산출물이 없습니다`)
  }
  const runDir = join(LEARN_ROOT, latest)

  const readJsonl = (name: string): VoiceLearningRow[] => {
    const f = join(runDir, name)
    if (!existsSync(f)) return []
    return readFileSync(f, 'utf-8').trim().split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as VoiceLearningRow)
  }
  // 🔴 gold 를 먼저 넣는다. 같은 글이 양쪽에 있으면 앞의 것만 센다
  const rows = [...readJsonl('voice-gold.jsonl'), ...readJsonl('voice-silver.jsonl')]

  // ② 수동 판정 — 🔴 실제 존재하는 경로를 찾는다. 파일명을 지어내지 않는다
  const DEC_DIR = 'docs/operations/decisions'
  const decFile = existsSync(DEC_DIR)
    ? readdirSync(DEC_DIR).filter((f) => f.endsWith('.json') && f.includes('manual-decisions')).sort()[0]
    : undefined
  let decisions: ManualDecisionRow[] = []
  if (decFile !== undefined) {
    const parsed: unknown = JSON.parse(readFileSync(join(DEC_DIR, decFile), 'utf-8'))
    // 🔴 최상위가 배열이 아니라 { schema, note, ..., items: [...] } 다.
    //    배열만 받으면 조용히 0건이 되고, "사람 판정이 자동 점수를 이긴다" 는 규칙이
    //    실행되지 않은 채 통과한다 — 아래 sanity 검사가 그것을 막는다.
    const obj = (parsed !== null && typeof parsed === 'object') ? parsed as Record<string, unknown> : {}
    const arr = Array.isArray(parsed) ? parsed
      : Array.isArray(obj.items) ? obj.items
      : Array.isArray(obj.decisions) ? obj.decisions
      : []
    decisions = (arr as unknown[]).filter(
      (d): d is ManualDecisionRow =>
        d !== null && typeof d === 'object'
        && typeof (d as ManualDecisionRow).sourceRef === 'string'
        && typeof (d as ManualDecisionRow).class === 'string',
    )
    if (decisions.length === 0) {
      await prisma.$disconnect()
      fail(`${decFile} 을 읽었지만 판정이 0건입니다. 파일 구조가 바뀌었는지 확인하세요`)
    }
  }

  const plan = selectVoiceSamples({ rows, decisions, limit: VOICE_SAMPLES })
  const exLine = Object.entries(plan.excluded)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')
  console.log(
    `말투 샘플  ${runDir} · 후보 ${plan.considered}건 · 수동판정 ${decisions.length}건` +
      `${decFile === undefined ? ' 🟡 수동판정 파일 없음' : ` (${decFile})`}`,
  )
  console.log(`   제외  ${exLine === '' ? '없음' : exLine}`)

  if (plan.picked.length === 0) {
    await prisma.$disconnect()
    fail('말투 샘플을 한 건도 고르지 못했습니다. 기준을 확인하거나 --no-voice 를 쓰세요')
  }

  // ③ sourceRef → VoiceSource 확인 → 우나어 read-only 로 본문 조달
  //    🔴 sourceRef 는 우나어 CafePost.id 다(VoiceSource 주석). 그래도 origin 을 확인한다 —
  //       다른 origin 이 섞이면 엉뚱한 DB 의 id 로 조회하게 된다
  const refs = plan.picked.map((p) => p.sourceRef)
  const vs = await prisma.voiceSource.findMany({
    where: { sourceRef: { in: refs }, origin: 'unao_cafe' },
    select: { sourceRef: true, sourceSite: true, contentLength: true },
  })
  const okRefs = new Set(vs.map((v) => v.sourceRef))
  const usable = refs.filter((r) => okRefs.has(r))
  if (usable.length === 0) {
    await prisma.$disconnect()
    fail('고른 샘플이 VoiceSource(unao_cafe) 에 없습니다')
  }

  const client = new pg.Client({ connectionString: loadUnaoReadonlyUrl() })
  await client.connect()
  try {
    const res = await client.query(READ_QUERIES.bodiesBySourceRefs, [usable])
    for (const row of res.rows as Array<{ id: string; content: string }>) {
      const body = (row.content ?? '').trim()
      if (body !== '') voiceSampleBodies.push(body)
    }
  } finally {
    await client.end()
  }

  for (const [i, p] of plan.picked.entries()) {
    const meta = vs.find((v) => v.sourceRef === p.sourceRef)
    console.log(
      `   [${i + 1}] ${mask(p.sourceRef)} · ${p.bucket}` +
        `${p.humanApproved ? ' · 사람 승인' : ''}${p.speakerVerified ? ' · 화자 확인' : ''}` +
        ` · ${meta?.contentLength ?? '?'}자`,
    )
  }
  console.log(`   조달  본문 ${voiceSampleBodies.length}건 (🔴 메모리만 · 저장 안 함)\n`)
} else {
  console.log('🟡 --no-voice — 말투 샘플 없이 실행합니다 (실패한 첫 판 재현)\n')
}

if (CALL) {
  const key = keyStatus(MODEL)
  if (!key.present) {
    await prisma.$disconnect()
    fail(`${key.envName} 가 없습니다`)
  }
  console.log(`API key  ${key.envName} 확인됨\n`)
}

// ── 프롬프트 + (선택) 호출 ──
const records: OriginalPostRecord[] = []
const sourceTexts: string[] = []
/** ✅ 소재로 허용된 링크 정본 모음 — 유출 대조에서만 제외한다 */
const allowedContentUrls: string[] = []
let calls = 0

for (const [i, raw] of selected.entries()) {
  // 🔴 원문을 생성 전에 규칙으로 읽는다. 같은 값을 화면에도 찍어
  //    "이 글을 무엇으로 읽었는가" 를 사람이 확인할 수 있게 한다 —
  //    3판 실패는 전부 이 판단이 없어서 생겼고, 없으면 원인도 못 찾는다.
  const profile = readSourceProfile({ rawTitle: raw.rawTitle, rawBody: raw.rawBody })
  const keep = Object.entries(profile.preserveStructure)
    .filter(([, v]) => v).map(([k]) => k)
  console.log(
    `   프로파일 ${profile.emotionTone} · 제목 ${profile.titleTemperature} · ${profile.structureType}` +
      ` · ${profile.interactionNeed}`,
  )
  console.log(
    `            살릴 모양 ${keep.length === 0 ? '없음' : keep.join('·')}` +
      ` · 되풀이 ${profile.repeatedFixations.length}종 · 디테일 ${profile.concreteDetailsToKeep.length}건` +
      ` · 🔴 필수 ${mustKeepDetails(profile.concreteDetailsToKeep).length}건` +
      `${profile.externalAddressTerms.length > 0 ? ` · 🔴 외부호칭 ${profile.externalAddressTerms.length}종` : ''}` +
      `${profile.originTraceUrls.length > 0 ? ` · 🔴 출처링크 ${profile.originTraceUrls.length}건` : ''}` +
      `${profile.contentReferenceUrl !== null ? ' · ✅ 소재링크 1건(정본)' : ''}` +
      ` · 제목모양 ${profile.titleShape}` +
      `${profile.originTraceTerms.length > 0 ? ` · 🔴 출처흔적 ${profile.originTraceTerms.length}종` : ''}`,
  )
  const plan = buildPrompt({
    raw: { id: raw.id, rawTitle: raw.rawTitle, rawBody: raw.rawBody, sourceSite: raw.sourceSite },
    boardHint: BOARD,
    voiceSamples: voiceSampleBodies,
    profile,
  })
  if (!plan.ok) {
    console.error(`\n⛔ [${i + 1}] BLOCKED`)
    for (const b of plan.blocks) console.error(`   [${b.code}] ${b.message}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  const { systemPrompt, userPayload, maxOutputTokens } = plan.prompt
  // 🔴 reasoning 모델은 **추론 토큰이 이 상한을 함께 먹는다.**
  //    gpt-5-nano 가 1,000 에서 5/5 잘린 것이 정확히 이 자리였다(VE-M3 1차).
  //    Gemini 2.5 Pro 는 thinking 을 끌 수 없어 같은 구조다 —
  //    프롬프트가 정한 2,000 을 그대로 보내면 JSON 이 나오기 전에 끊긴다.
  //
  // 🔴 넓히기만 한다. Math.max 를 쓰는 이유는 haiku(정책 1,500)가 **줄어들면 안 되기**
  //    때문이다 — 기존 초안 3건의 기준선이 흔들린다.
  const policy = outputTokenPolicyFor(MODEL)
  const outCap = policy.reasoning ? Math.max(maxOutputTokens, policy.maxOutputTokens) : maxOutputTokens
  console.log(`── [${i + 1}] 프롬프트 (🔴 전문 미출력) ──`)
  console.log(`   system ${systemPrompt.length}자 · sha ${digest(systemPrompt)}`)
  console.log(`   user   ${userPayload.length}자 · sha ${digest(userPayload)} · maxOutputTokens ${outCap}` +
    `${policy.reasoning ? ` (reasoning 모델 — 추론 예산 포함, 프롬프트 기본 ${maxOutputTokens})` : ''}`)

  if (!CALL) {
    console.log('   🟡 dry-run — 호출하지 않았습니다\n')
    continue
  }

  console.log('   🔴 LLM 호출 1회…')
  const res = await callProvider({
    model: MODEL,
    systemPrompt,
    userPayload,
    maxOutputTokens: outCap,
    timeoutMs: TIMEOUT_MS,
  })
  calls += 1
  console.log(
    `   ok=${res.ok} · in ${res.inputTokens} · out ${res.outputTokens}` +
      ` · finish=${res.finishReason || '(없음)'} · chars ${res.responseChars}` +
      `${res.maxTokensReached ? ' · 🔴 상한 도달' : ''}`,
  )
  if (!res.ok) {
    // 🔴 사유를 반드시 찍는다. 2026-09-01 Gemini 3건이 전부 실패했는데
    //    화면에 "호출 실패" 만 남아 별도 프로브를 돌려서야 HTTP_404 임을 알았다.
    //    errorCode·errorMessage 에는 응답 본문도 key 도 담기지 않는다(provider 계약).
    console.error(`   ⛔ 호출 실패 [${res.errorCode ?? '(코드 없음)'}] ${res.errorMessage ?? ''}`)
    console.error('      이 건은 건너뜁니다 — 저장하지 않습니다\n')
    continue
  }

  const parsed = parseDraft(res.rawText)
  if (!parsed.ok) {
    // 🔴 파싱 실패도 코드로 남긴다. 잘림(TOO_LONG·상한 도달)과 형식 문제를 구분해야
    //    상한을 올릴지 프롬프트를 고칠지 정할 수 있다
    console.error(`   ⛔ 파싱 실패 [${parsed.errorCode}] ${parsed.message}`)
    console.error(`      finish=${res.finishReason || '(없음)'}${res.maxTokensReached ? ' · 🔴 상한 도달' : ''} — 저장하지 않습니다\n`)
    continue
  }

  records.push(toOriginalPostRecord({
    sourceRawContentId: raw.id,
    title: parsed.title,
    body: parsed.body,
  }))
  sourceTexts.push(raw.rawTitle, raw.rawBody)
  // ✅ 이 원문에 한해 써도 되는 소재 링크(정본). 저장 가드 대조에서 뺀다 —
  //    규칙상 허용한 링크 때문에 글 전체가 버려지면 가드가 일을 잘못하는 것이다
  if (profile.contentReferenceUrl !== null) allowedContentUrls.push(profile.contentReferenceUrl)

  // 🔴 판정이 아니다. 사람이 볼 신호만 찍는다.
  //    🔴 대조 대상이 둘이다 — 말투 샘플을 넣은 순간 우나어 원문이 두 번째 유출원이 됐다
  const seedTexts = [raw.rawTitle, raw.rawBody]
  // 🔴 원문이 번호 나열이면 초안의 번호도 흔적이 아니다 — 살리라고 시킨 것이다
  const allowNumberedList = profile.preserveStructure.numberedList
  const s = analyzeDraft({
    title: parsed.title, body: parsed.body, sourceTexts: seedTexts, allowNumberedList,
    allowedContentUrl: profile.contentReferenceUrl,
    closingIntent: profile.closingIntent,
  })
  const v = analyzeDraft({
    title: parsed.title, body: parsed.body, sourceTexts: voiceSampleBodies, allowNumberedList,
    allowedContentUrl: profile.contentReferenceUrl,
  })
  console.log(`   초안  제목 ${brief(parsed.title)} · 본문 ${brief(parsed.body)}`)
  console.log(
    `   신호  재료 연속20자 ${s.sourceEchoCount}건 · 어절 공유 ${pct(s.sharedWordRatio)}` +
      ` · 상투 시작 ${s.clicheOpener ?? '없음'}`,
  )
  console.log(
    `         🔴 말투샘플 연속20자 ${voiceSampleBodies.length === 0 ? '(샘플 없음)' : `${v.sourceEchoCount}건`}` +
      `${voiceSampleBodies.length === 0 ? '' : ` · 어절 공유 ${pct(v.sharedWordRatio)}`}`,
  )
  console.log(
    `         출처 흔적 ${s.sourceMarkers.length}건 · 금지 낱말 ${s.bannedTerms.length}건` +
      ` · 구조 흔적 ${s.structureFlags.length === 0 ? '없음' : s.structureFlags.join('·')}`,
  )
  // 🔴 창업자 critique 와 호칭 — 이 둘이 이번 판의 진짜 성적표다
  console.log(
    `         ${s.critiqueHits.length === 0 ? '✅' : '🔴'} 실패 표현 ${s.critiqueHits.length}건` +
      `${s.critiqueHits.length > 0 ? ` (${s.critiqueHits.join(' · ')})` : ''}` +
      ` · ${s.externalAddressHits.length === 0 ? '✅' : '🔴'} 외부 호칭 ${s.externalAddressHits.length}건` +
      ` · 우리 호칭 ${s.soransoranAddressHits.length === 0 ? '없음' : s.soransoranAddressHits.join('·')}`,
  )
  // 🔴 링크는 호칭보다 확실한 유출이다. 경계 표현은 실패와 섞지 않고 따로 센다
  console.log(
    `         ${{ ok: '✅', watch: '🟡', missing: '🔴', overuse: '🔴' }[s.questionVerdict]}` +
      ` 물음표 ${s.questionMarkCount}개` +
      `${s.questionVerdict === 'missing' ? ' (묻는 글인데 안 물었다)'
        : s.questionVerdict === 'overuse' ? ` (상한 ${MAX_QUESTION_MARKS} 초과 — 남발)` : ''}` +
      ` · ${s.originUrlHits.length === 0 ? '✅' : '🔴'} 출처링크 ${s.originUrlHits.length}건` +
      ` · ${s.contentUrlHits.length > 1 ? '🔴' : '✅'} 소재링크 ${s.contentUrlHits.length}건` +
      ` · ${s.originTraceHits.length === 0 ? '✅' : '🔴'} 출처흔적 ${s.originTraceHits.length}건` +
      `${s.originTraceHits.length > 0 ? ` (${s.originTraceHits.join(' · ')})` : ''}` +
      ` · ${s.critiqueWatchHits.length === 0 ? '✅' : '🟡'} 경계 표현 ${s.critiqueWatchHits.length}건` +
      `${s.critiqueWatchHits.length > 0 ? ` (${s.critiqueWatchHits.join(' · ')})` : ''}` +
      // 🔴 줄 끝마다 고르게 박히면 사람이 아니라 규칙이다. 판정이 아니라 신호로만 찍는다
      ` · 이모티콘 배치 ${s.emoticonEvenness === null ? '(짧아서 미측정)'
        : `${(s.emoticonEvenness * 100).toFixed(0)}%${s.emoticonEvenness >= 0.8 ? ' 🟡 균등' : ''}`}\n`,
  )
}

await prisma.$disconnect()

// ── 저장 ──
if (!CALL) {
  console.log('🟡 dry-run 입니다. API 호출 0 · 파일 write 0 · DB write 0.')
  console.log('   실제로 만들려면 --call 을 붙이세요. 🔴 유료 호출이 발생합니다.\n')
  process.exit(0)
}

if (records.length === 0) {
  // 🔴 성공 0건을 정상 종료로 두지 않는다. `--call` 을 붙였는데 아무것도 안 나온 것은
  //    사고이지 결과가 아니다. 종료 코드로도 드러나야 스크립트를 이어 붙일 수 있다
  console.error(`\n🔴 ${calls}회 호출했으나 저장할 초안이 0건입니다. 파일 write 0.`)
  console.error('   위의 [errorCode] 를 보고 원인을 확인하세요.\n')
  process.exit(1)
}

// 🔴 저장 직전 실측 방어 — **레코드별로** 가른다 (2026-09-01 7판).
//    이전에는 배치 전체를 한 덩어리로 검사해 한 건이 걸리면 깨끗한 나머지까지
//    통째로 버려졌다. 유료 호출 3회가 산출물 0건이 됐다.
//    🔴 완화가 아니다. 걸린 것은 여전히 저장하지 않는다 — 버리는 범위만 좁혔다.
const allSources = [...sourceTexts, ...voiceSampleBodies]
const { clean, leaking } = partitionByStoredSource(records, allSources, allowedContentUrls)

if (leaking.length > 0) {
  console.error(`\n🔴 원문 조각이 섞인 ${leaking.length}건은 저장하지 않습니다 (연속 20자 일치):`)
  for (const { record, echoCount } of leaking) {
    console.error(
      `   · ${mask(record.sourceRawContentId)} · 제목 ${brief(record.title)}` +
        ` · 본문 ${brief(record.body)} · 유출 ${echoCount}조각`,
    )
  }
  console.error('   같은 재료로 다시 만들려면 --call 을 한 번 더 돌립니다.\n')
}

if (clean.length === 0) {
  console.error(`🔴 ${calls}회 호출했으나 저장 가능한 초안이 0건입니다. 파일 write 0.\n`)
  process.exit(1)
}

// 🔴 통과한 것만 한 번 더 본다. 여기서 던지면 partition 과 assert 의 눈금이 갈린 것이다
assertNoStoredSource(clean, allSources, allowedContentUrls)

const existing: OriginalPostRecord[] = existsSync(OUTPUT_PATH)
  ? (JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')) as OriginalPostRecord[])
  : []
const merged = [...existing, ...clean]
mkdirSync('tmp', { recursive: true })
writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8')

console.log(`✅ 기록 — ${OUTPUT_PATH} (기존 ${existing.length}건 + ${clean.length}건 · gitignored)`)
console.log(`   생성 ${records.length}건 → 저장 ${clean.length}건 · 🔴 유출 제외 ${leaking.length}건`)
console.log(`   LLM 호출 ${calls}회 · DB write 0 · Post 생성 0 · 발행 0`)
console.log('   🔴 판정도 적재도 하지 않았습니다. 초안을 사람이 본 뒤가 다음 단계입니다.\n')
