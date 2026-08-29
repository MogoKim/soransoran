#!/usr/bin/env tsx
/**
 * VE-M3-2 fixture — 네트워크 · DB · LLM 없이 계약을 검증한다
 *
 * 정본: docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md
 *
 * 🔴 이 fixture 가 검사하는 것은 "payload 가 잘 만들어지는가" 가 아니라
 *    **"돈이 나갈 경로가 생기지 않았는가"** 다.
 *
 *    VE-M2 까지는 실수해도 시간만 잃었다. 여기서부터는 다르다.
 *    LLM import 한 줄 · fetch 한 줄이 곧 비용이다.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  M3_TASK_VERSION, M3_PROMPT_VERSION, M3_OUTPUT_SCHEMA_VERSION, M3_MODEL_UNDETERMINED,
  M3_CAPS, M3_SIGNAL_KEYS, M3_OUTPUT_SCHEMA, CACHE_KEY_PARTS,
  M3_ALLOWED_ADDRESS_TERMS, M3_FORBIDDEN_ADDRESS_TERMS, M3_LEAK_RUN_MIN,
  M3_MODEL_CANDIDATES, M3_EXPERIMENT_PER_MODEL, M3_EXPERIMENT_STAGES, M3_STRATA_AXES,
  buildCacheKey, estimateCost, checkCaps, validateAddressCandidates, assertNoSourceLeak, pricingFor,
  ESTIMATED_OUTPUT_TOKENS_PER_ITEM, outputTokenPolicyFor,
  classifyJsonFailure, isMaxTokensReached, formatDiagnostics,
  apiModelIdFor, M3_ANALYSIS_MODEL, M3_TERMINAL_SKIP_CODES, isTerminalSkip,
  M3_RETRYABLE_ERROR_CODES, isRetryable,
} from './lib/voice-m3-contract.mjs'
import { buildPromptPayload, buildInstruction, formatSummaryLine } from './lib/voice-m3-prompt.mjs'
import {
  selectStratifiedSample, validateSample, SAMPLE_AXES, selectFullModeBatch, type SampleCandidate,
} from './lib/voice-m3-sample.mjs'
import { keyStatus, ANTHROPIC_JSON_PREFILL, PROVIDER_KEY_ENV } from './lib/voice-m3-provider.mjs'
import { neutralizeFormula, csvCell } from './lib/voice-m3-csv.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIVE = join(HERE, 'voice-m3-dry-run.mts')
const CONTRACT_LIB = join(HERE, 'lib/voice-m3-contract.mts')
const PROMPT_LIB = join(HERE, 'lib/voice-m3-prompt.mts')
const SAMPLE_LIB = join(HERE, 'lib/voice-m3-sample.mts')
const PROVIDER_LIB = join(HERE, 'lib/voice-m3-provider.mts')
const RUN = join(HERE, 'voice-m3-run.mts')
const PLAN = join(HERE, 'voice-m3-plan.mts')
const EXPORT = join(HERE, 'voice-m3-export.mts')

const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string): void => { report.push({ ok: true, kind, name, detail }) }
const bad = (name: string, kind: string, detail: string): void => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

/** 🔴 `/**` 로 시작하는 한 줄 JSDoc 도 걷어낸다 — 설명을 위반으로 읽으면 안 된다 */
const stripComments = (raw: string): string =>
  raw.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n')

const liveCode = stripComments(readFileSync(LIVE, 'utf-8'))
const contractCode = stripComments(readFileSync(CONTRACT_LIB, 'utf-8'))
const promptCode = stripComments(readFileSync(PROMPT_LIB, 'utf-8'))
const sampleCode = stripComments(readFileSync(SAMPLE_LIB, 'utf-8'))
const providerCode = stripComments(readFileSync(PROVIDER_LIB, 'utf-8'))
const runCode = stripComments(readFileSync(RUN, 'utf-8'))
const planCode = stripComments(readFileSync(PLAN, 'utf-8'))
const exportCode = stripComments(readFileSync(EXPORT, 'utf-8'))
const ALL: Array<[string, string]> = [
  ['dry-run', liveCode], ['contract lib', contractCode], ['prompt lib', promptCode],
]

const SAMPLE_BODY = [
  '우갱님들 안녕하세요ㅠㅠ',
  '어제 병원 다녀왔는데요.. 검사 결과가 애매하다고 하네요~~',
  '혹시 저만 이런가요? 다들 어떠세요?',
].join('\n')
const SAMPLE_COMMENTS = ['저도 작년에 똑같이 겪었어요. 큰 병원으로 가보세요', '맞아요 힘내세요']

// ── ① LLM SDK · 네트워크가 없다 (비용 0원) ──────────────
//    🔴 이 fixture 의 존재 이유에 가장 가깝다.
{
  const offenders: string[] = []
  for (const [label, code] of ALL) {
    if (/from\s+['"](openai|@anthropic-ai\/[^'"]*|@google\/[^'"]*|@mistralai\/[^'"]*)['"]/.test(code)) {
      offenders.push(`${label} 에 LLM SDK import`)
    }
    if (/\bfetch\s*\(|axios|node-fetch|got\(|https?\.request|undici/.test(code)) {
      offenders.push(`${label} 에 네트워크 호출`)
    }
    if (/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis/.test(code)) {
      offenders.push(`${label} 에 provider 엔드포인트`)
    }
    if (/OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY/.test(code)) {
      offenders.push(`${label} 에 provider key 요구`)
    }
    if (/Math\.random/.test(code)) offenders.push(`${label} 에 난수 — 재현 불가능해진다`)
  }
  if (offenders.length) bad('LLM · 네트워크 · key 0 (비용 0원)', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('LLM · 네트워크 · key 0 (비용 0원)', 'guard', 'SDK 0 · fetch 0 · 엔드포인트 0 · key 0 · 난수 0')
}

// ── ② --apply 가 없고, 넘어오면 거부한다 ────────────────
{
  const offenders: string[] = []
  if (!/process\.argv\.includes\('--apply'\)/.test(liveCode)) offenders.push('--apply 감지 없음')
  if (!/process\.exit\(1\)/.test(liveCode)) offenders.push('거부 경로 없음')
  // 🔴 감지만 하고 통과시키면 의미가 없다 — exit 이 감지 뒤에 있어야 한다
  const at = liveCode.indexOf("includes('--apply')")
  const after = at === -1 ? '' : liveCode.slice(at, at + 600)
  if (!/process\.exit\(1\)/.test(after)) offenders.push('--apply 감지 뒤에 즉시 거부가 없다')
  if (offenders.length) bad('--apply 는 존재하지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('--apply 는 존재하지 않는다', 'guard', '감지 즉시 exit(1)')
}

// ── ③ VoiceM3* 에 write 하지 않는다 ─────────────────────
{
  const offenders: string[] = []
  for (const model of ['voiceM3Run', 'voiceM3Cache', 'voiceM3CostEvent']) {
    for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      if (new RegExp(`${model}\\.${op}\\s*\\(`).test(liveCode)) offenders.push(`${model}.${op}`)
    }
  }
  // 다른 Voice 테이블에도 쓰지 않는다
  for (const model of ['voiceSource', 'voiceDerived', 'voiceCommentSignal', 'voiceJudgment']) {
    for (const op of ['create', 'createMany', 'update', 'upsert', 'delete']) {
      if (new RegExp(`${model}\\.${op}\\s*\\(`).test(liveCode)) offenders.push(`${model}.${op}`)
    }
  }
  if (/\$executeRaw|\$executeRawUnsafe/.test(liveCode)) offenders.push('raw execute')
  if (offenders.length) bad('DB write 0', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('DB write 0', 'guard', 'VoiceM3* · Voice* write 0 · raw execute 0')
}

// ── ④ Micro Seed 경로를 건드리지 않는다 ─────────────────
{
  const offenders: string[] = []
  for (const t of ['microSeedCandidate', 'microSeedRawContent', 'microSeedCandidateHistory',
    'planSheetWrite', 'appendRow', 'publishLive', 'approveLive']) {
    if (new RegExp(`\\b${t}\\b`).test(liveCode)) offenders.push(t)
  }
  if (/micro-seed-sheet/.test(liveCode)) offenders.push('Sheet 모듈 import')
  if (offenders.length) bad('Micro Seed 경로 0', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('Micro Seed 경로 0', 'guard', 'Candidate · Sheet · publisher 접점 0')
}

// ── ⑤ 원문 전문을 로그로 찍지 않는다 ────────────────────
{
  const offenders: string[] = []
  const logs = liveCode.split('\n').filter((l) => /console\.(log|error)/.test(l))
  for (const l of logs) {
    if (/\$\{[^}]*\bpayload\b[^}]*\}/.test(l) && !/payloadChars/.test(l)) offenders.push('로그에 payload')
    if (/\$\{[^}]*\bbody\b[^}]*\}/.test(l) && !/bodyLength|bodyHash/.test(l)) offenders.push('로그에 본문 변수')
    if (/\$\{[^}]*\bcomments\b[^}]*\}/.test(l) && !/Count|Total|Summary/.test(l)) offenders.push('로그에 댓글 원문')
    if (/JSON\.stringify\(\s*payload/.test(l)) offenders.push('payload 직렬화 출력')
  }
  // 요약 자체에 본문이 없어야 한다
  const { summary } = buildPromptPayload({
    sourceRef: 'x', body: SAMPLE_BODY, comments: SAMPLE_COMMENTS,
    derivedSignals: {}, legacyLabels: {}, commentSignalSummary: {},
  })
  const sj = JSON.stringify(summary)
  if (sj.includes('병원 다녀왔는데')) offenders.push('요약에 본문 문장')
  if (sj.includes('똑같이 겪었어요')) offenders.push('요약에 댓글 문장')
  if (!summary.bodyHash.startsWith('sha256:')) offenders.push('bodyHash 형식')
  if (formatSummaryLine(summary).includes('병원')) offenders.push('요약 한 줄에 본문')
  if (offenders.length) bad('원문 전문을 로그로 흘리지 않는다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('원문 전문을 로그로 흘리지 않는다', 'policy', `console ${logs.length}줄 정결 · 요약 ${sj.length}B 에 본문 0`)
}

// ── ⑥ payload 에는 원문이 있고 요약에는 없다 ────────────
//    🔴 이 구분이 VE-M3 의 핵심이다. 둘 다 검사한다.
{
  const { payload, summary } = buildPromptPayload({
    sourceRef: 'x', body: SAMPLE_BODY, comments: SAMPLE_COMMENTS,
    derivedSignals: { punctuationHabit: { question: 1 } }, legacyLabels: { ageSignal: '50s' },
    commentSignalSummary: { experience: 1 },
  })
  const offenders: string[] = []
  if (!payload.source.body.includes('병원 다녀왔는데')) offenders.push('payload 에 본문이 없다 (LLM 이 판단할 수 없다)')
  if (payload.source.comments.length !== 2) offenders.push('payload 에 댓글이 없다')
  if (summary.bodyLength !== SAMPLE_BODY.length) offenders.push('요약 길이가 틀리다')
  if (summary.commentCount !== 2) offenders.push('요약 댓글 수가 틀리다')
  if (summary.estimatedInputTokens <= 0) offenders.push('토큰 추정이 0')
  if (offenders.length) bad('payload 에는 원문 · 요약에는 수치', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('payload 에는 원문 · 요약에는 수치', 'policy', `payload ${summary.payloadChars}자 ≈ ${summary.estimatedInputTokens} tok`)
}

// ── ⑦ cacheKey 8요소 — 하나라도 빠지면 실패한다 ─────────
{
  const offenders: string[] = []
  const want = ['origin', 'sourceRef', 'contentHash', 'ruleVersion',
    'taskVersion', 'model', 'promptVersion', 'outputSchemaVersion']
  if (CACHE_KEY_PARTS.length !== 8) offenders.push(`구성 요소가 ${CACHE_KEY_PARTS.length}개 (8개여야 한다)`)
  for (const w of want) {
    if (!(CACHE_KEY_PARTS as readonly string[]).includes(w)) offenders.push(`${w} 누락`)
  }
  const base = {
    origin: 'unao_cafe', sourceRef: 'abc', contentHash: 'sha256:xyz', ruleVersion: 'voice-m2-rule-v1',
    taskVersion: M3_TASK_VERSION, model: M3_MODEL_UNDETERMINED,
    promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
  }
  const k0 = buildCacheKey(base)
  // 🔴 8요소 각각이 키에 실제로 반영되는가 — 하나씩 바꿔 보고 키가 달라져야 한다
  const variants: Array<[string, Record<string, string | null>]> = [
    ['origin', { origin: 'micro_seed' }],
    ['sourceRef', { sourceRef: 'other' }],
    ['contentHash', { contentHash: 'sha256:changed' }],
    ['ruleVersion', { ruleVersion: 'voice-m2-rule-v2' }],
    ['taskVersion', { taskVersion: 'other-task' }],
    ['model', { model: 'other-model' }],
    ['promptVersion', { promptVersion: 'other-prompt' }],
    ['outputSchemaVersion', { outputSchemaVersion: 'other-schema' }],
  ]
  for (const [name, patch] of variants) {
    if (buildCacheKey({ ...base, ...patch }) === k0) offenders.push(`${name} 이 키에 반영되지 않는다`)
  }
  if (buildCacheKey(base) !== k0) offenders.push('같은 입력이 다른 키를 낸다')
  if (offenders.length) bad('cacheKey 8요소 전부 반영', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('cacheKey 8요소 전부 반영', 'policy', '8/8 각각 키를 바꾼다 · 결정적')
}

// ── ⑧ model · promptVersion · outputSchemaVersion 이 비면 던진다 ──
{
  const offenders: string[] = []
  const base = {
    origin: 'unao_cafe', sourceRef: 'abc', contentHash: null, ruleVersion: 'r',
    taskVersion: 't', model: 'm', promptVersion: 'p', outputSchemaVersion: 'o',
  }
  for (const field of ['model', 'promptVersion', 'outputSchemaVersion'] as const) {
    for (const empty of ['', '   ']) {
      let threw = false
      try { buildCacheKey({ ...base, [field]: empty }) } catch { threw = true }
      if (!threw) offenders.push(`${field}='${empty}' 인데 통과했다`)
    }
  }
  // 🔴 placeholder 는 빈 문자열이 아니어야 한다
  if (M3_MODEL_UNDETERMINED.trim() === '') offenders.push('M3_MODEL_UNDETERMINED 가 빈 문자열이다')
  if (offenders.length) bad('빈 model · prompt · schema 는 거부', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('빈 model · prompt · schema 는 거부', 'guard', `3필드 × 2형태 거부 · placeholder='${M3_MODEL_UNDETERMINED}'`)
}

// ── ⑨ 공식 단가 없이 금액을 만들지 않는다 ───────────────
//    🔴 이전에 추정치를 확정처럼 적은 전례가 있다. 코드가 그것을 막는다.
{
  const offenders: string[] = []
  const noPrice = estimateCost(10_000, 10)
  if (noPrice.estimatedCostUsd !== null) offenders.push('단가 없이 금액이 나왔다')
  if (noPrice.costStatus !== 'unavailable_no_official_price') offenders.push(`costStatus=${noPrice.costStatus}`)
  if (noPrice.priceSource !== null) offenders.push('출처 없는 priceSource')
  if (noPrice.estimatedTotalTokens <= 0) offenders.push('토큰이 0')
  // 🔴 금액을 모르면 cap 통과라고 말하지 않는다
  const caps = checkCaps(noPrice, 10)
  if (caps.ok) offenders.push('금액 미상인데 cap 통과로 판정했다')
  if (!caps.violations.some((v) => v.includes('단가 미확정'))) offenders.push('미확정 사유가 보고되지 않는다')
  // 단가가 있으면 금액이 나온다
  const withPrice = estimateCost(10_000, 10, {
    inputPerMTok: 1, outputPerMTok: 5, source: 'test', checkedAt: '2026-08-27',
  })
  if (withPrice.estimatedCostUsd === null) offenders.push('단가가 있는데 금액이 없다')
  if (withPrice.priceSource === null) offenders.push('출처가 기록되지 않는다')
  if (offenders.length) bad('단가 없이는 금액을 만들지 않는다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('단가 없이는 금액을 만들지 않는다', 'policy', 'null · costStatus · cap 판정 불가까지')
}

// ── ⑩ cap 값이 계약과 일치한다 ──────────────────────────
//    🔴 리터럴로 못박는다 — 상수를 참조해 상대 비교만 하면 값을 바꿔도 통과한다
{
  const offenders: string[] = []
  const want: Array<[string, number]> = [
    ['itemLimit', 50], ['tokenCap', 500_000], ['dollarCap', 5],
    ['softDaily', 200], ['hardDaily', 1_000], ['timeoutSec', 30],
    ['maxRetry', 3], ['consecutiveFailureStop', 5],
  ]
  for (const [k, v] of want) {
    const actual = (M3_CAPS as unknown as Record<string, number>)[k]
    if (actual !== v) offenders.push(`${k}=${actual} (계약값 ${v})`)
  }
  if (offenders.length) bad('cap 값이 계약과 같다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('cap 값이 계약과 같다', 'guard', 'item 50 · token 500K · $5 · retry 3(cap 포함) · 연속실패 5')
}

// ── ⑪ 타겟 설명어가 생성 후보로 올라가지 않는다 ─────────
//    🔴 "우리 또래분들" 은 한 번 좋은 치환어로 적혔다가 폐기됐다(PR #100).
{
  const offenders: string[] = []
  for (const must of ['우리 또래분들', '50대 여성분들', '중년 여성분들', '같은 세대 분들']) {
    if (!(M3_FORBIDDEN_ADDRESS_TERMS as readonly string[]).includes(must)) offenders.push(`금지 목록에 ${must} 없음`)
    if ((M3_ALLOWED_ADDRESS_TERMS as readonly string[]).includes(must)) offenders.push(`🔴 허용 목록에 ${must}`)
    const v = validateAddressCandidates([must])
    if (v.ok) offenders.push(`${must} 이 생성 후보로 통과했다`)
    if (!v.forbidden.includes(must)) offenders.push(`${must} 이 금지로 잡히지 않는다`)
  }
  // 소란소란 호칭만 허용된다
  for (const must of ['소란님들', '소란소란님들', '소란소란님', '소란님']) {
    if (!(M3_ALLOWED_ADDRESS_TERMS as readonly string[]).includes(must)) offenders.push(`허용 목록에 ${must} 없음`)
    if (!validateAddressCandidates([must]).ok) offenders.push(`${must} 이 거부됐다`)
  }
  // 원출처 호칭도 생성 후보가 아니다
  for (const src of ['82님들', '우갱님들', '레테님들', '은오님들']) {
    if (validateAddressCandidates([src]).ok) offenders.push(`원출처 호칭 ${src} 이 생성 후보로 통과했다`)
  }
  // 프롬프트가 금지어를 실제로 싣는가 — 입력에서 먼저 막는다
  const inst = buildInstruction()
  if (!inst.includes('우리 또래분들')) offenders.push('프롬프트에 금지어 안내가 없다')
  if (!inst.includes('소란님들')) offenders.push('프롬프트에 허용 호칭 안내가 없다')
  if (offenders.length) bad('타겟 설명어는 생성 금지', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('타겟 설명어는 생성 금지', 'policy', `금지 ${M3_FORBIDDEN_ADDRESS_TERMS.length}종 · 허용 ${M3_ALLOWED_ADDRESS_TERMS.length}종 · 프롬프트에도 명시`)
}

// ── ⑫ 저장 전 20자 연속 유출 대조가 존재하고 동작한다 ───
{
  const offenders: string[] = []
  if (M3_LEAK_RUN_MIN !== 20) offenders.push(`임계값이 ${M3_LEAK_RUN_MIN} (1차값은 20)`)
  const base = '가나다라마바사아자차카타파하거너더러머버서어저처'
  const source = [`앞말 ${base} 뒷말`]
  const under = assertNoSourceLeak(base.slice(0, 19), source)
  const over = assertNoSourceLeak(base.slice(0, 20), source)
  if (under.leaked) offenders.push('19자에서 이미 걸린다')
  if (!over.leaked) offenders.push('20자를 놓친다')
  if (over.ok) offenders.push('유출인데 ok=true')
  // 공백으로 피해 가지 못한다
  if (!assertNoSourceLeak(base.slice(0, 20).split('').join(' '), source).leaked) {
    offenders.push('공백을 끼우면 빠져나간다')
  }
  // 정상 출력은 통과한다
  if (assertNoSourceLeak('문체가 구어체에 가깝고 망설임이 남아 있다', source).leaked) {
    offenders.push('정상 판정문이 유출로 잡힌다')
  }
  // 🔴 함수가 실제로 export 되어 VE-M3-3 에서 쓸 수 있어야 한다
  if (!/export function assertNoSourceLeak/.test(contractCode)) offenders.push('대조 함수가 export 되지 않는다')
  if (offenders.length) bad('저장 전 20자 유출 대조', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('저장 전 20자 유출 대조', 'guard', '19자 통과 · 20자 차단 · 공백 우회 차단 · 정상문 통과')
}

// ── ⑬ 출력 스키마 7종 · 계산하지 않는다 ─────────────────
{
  const offenders: string[] = []
  const want = ['naturalnessScore', 'voiceRetention', 'originalityDelta', 'overSanitizedRisk',
    'overMimicryRisk', 'expressionRisk', 'sequenceSimilarityRisk']
  if (M3_SIGNAL_KEYS.length !== 7) offenders.push(`신호가 ${M3_SIGNAL_KEYS.length}종 (7종이어야 한다)`)
  for (const w of want) {
    if (!(M3_SIGNAL_KEYS as readonly string[]).includes(w)) offenders.push(`${w} 누락`)
    const prop = (M3_OUTPUT_SCHEMA.properties as Record<string, { type?: string; maximum?: number }>)[w]
    if (!prop) offenders.push(`schema 에 ${w} 없음`)
    else if (prop.type !== 'integer' || prop.maximum !== 100) offenders.push(`${w} 타입/범위`)
  }
  if (!(M3_OUTPUT_SCHEMA.required as readonly string[]).includes('notes')) offenders.push('notes 누락')
  // 🔴 이번 단계에서 값을 만들지 않는다 — 계산 코드가 없어야 한다
  for (const [label, code] of ALL) {
    for (const w of want) {
      if (new RegExp(`${w}\\s*[:=]\\s*\\d`).test(code)) offenders.push(`${label} 에서 ${w} 를 계산한다`)
    }
  }
  // 자동 발행 조건으로 쓰지 않는다는 주석이 코드에 남아 있는가
  const raw = readFileSync(CONTRACT_LIB, 'utf-8')
  if (!/자동 발행 조건으로 쓰지 않는다/.test(raw)) offenders.push('자동 발행 금지 주석이 없다')
  if (offenders.length) bad('7종 스키마 정의 · 계산 0', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('7종 스키마 정의 · 계산 0', 'policy', '7종 0~100 정수 + notes · 값 산출 코드 0')
}

// ── ⑭ 버전 상수가 고정돼 있다 ───────────────────────────
{
  const offenders: string[] = []
  if (M3_TASK_VERSION !== 'voice-m3-task-v1') offenders.push(`taskVersion=${M3_TASK_VERSION}`)
  if (M3_PROMPT_VERSION !== 'voice-m3-prompt-v1') offenders.push(`promptVersion=${M3_PROMPT_VERSION}`)
  if (M3_OUTPUT_SCHEMA_VERSION !== 'voice-m3-output-v1') offenders.push(`outputSchemaVersion=${M3_OUTPUT_SCHEMA_VERSION}`)
  // 🔴 모델을 **확정**하지 않았다.
  //    후보 표에 모델명이 있는 것은 정당하다 — 20건 실험 대상이기 때문이다.
  //    막아야 하는 것은 "하나를 골라 기본값으로 박는" 일이다.
  if (M3_MODEL_UNDETERMINED !== 'undetermined') offenders.push('placeholder 가 바뀌었다')
  const candidateNames = Object.keys(M3_MODEL_CANDIDATES)
  if (candidateNames.includes(M3_MODEL_UNDETERMINED)) offenders.push('placeholder 가 실제 모델명이다')
  // 기본 모델을 정해 두면 실험 없이 선택된 것과 같다
  if (/const\s+DEFAULT_MODEL|model\s*=\s*['"](gpt-|claude-)/.test(contractCode + liveCode)) {
    offenders.push('기본 모델이 코드에 박혔다')
  }
  if (offenders.length) bad('버전 고정 · 모델 미확정', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('버전 고정 · 모델 미확정', 'guard', `task/prompt/schema v1 · placeholder='${M3_MODEL_UNDETERMINED}' · 기본 모델 없음`)
}

// ── ⑮ 단가는 출처 · 확인일 없이 등록되지 않는다 ─────────
//    🔴 확인되지 않은 단가로 만든 금액은 "확인된 비용" 처럼 읽힌다.
{
  const offenders: string[] = []
  const names = Object.keys(M3_MODEL_CANDIDATES)
  if (names.length < 2) offenders.push(`후보가 ${names.length}개 — 비교하려면 2개 이상이어야 한다`)
  for (const [name, p] of Object.entries(M3_MODEL_CANDIDATES)) {
    if (!p.source || !/^https?:\/\//.test(p.source)) offenders.push(`${name}: 출처 URL 없음`)
    if (!p.checkedAt || !/^\d{4}-\d{2}-\d{2}$/.test(p.checkedAt)) offenders.push(`${name}: 확인일 형식`)
    if (!(p.inputPerMTok > 0) || !(p.outputPerMTok > 0)) offenders.push(`${name}: 단가가 0 이하`)
  }
  // 🔴 등록되지 않은 모델은 금액을 지어내지 않고 던진다
  let threw = false
  try { pricingFor('made-up-model') } catch { threw = true }
  if (!threw) offenders.push('미등록 모델인데 단가를 반환했다')
  // 단가를 넘기면 금액이 나오고 출처가 따라온다
  const withPrice = estimateCost(10_000, 10, pricingFor(names[0]))
  if (withPrice.estimatedCostUsd === null) offenders.push('등록 단가인데 금액이 null')
  if (!withPrice.priceSource?.includes('http')) offenders.push('금액에 출처가 따라오지 않는다')
  if (offenders.length) bad('단가에 출처 · 확인일 필수', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('단가에 출처 · 확인일 필수', 'policy', `후보 ${names.length}종 · 전부 출처+날짜 · 미등록은 거부`)
}

// ── ⑯ 단계형 실험 · 층화 축 · cap 정합성 ────────────────
//    🔴 10건 1회로는 모델 품질을 가릴 수 없다. 단계마다 멈출 수 있어야 한다.
{
  const offenders: string[] = []
  const S = M3_EXPERIMENT_STAGES
  // 🔴 리터럴로 못박는다 — 상수를 참조해 상대 비교만 하면 값을 바꿔도 통과한다
  if (S.stage1PerModel !== 30) offenders.push(`1차가 ${S.stage1PerModel}건 (30건이어야 한다)`)
  if (S.stage2PerModel !== 100) offenders.push(`2차가 ${S.stage2PerModel}건 (100건이어야 한다)`)
  if (S.stage3Single !== 300) offenders.push(`3차가 ${S.stage3Single}건 (300건이어야 한다)`)
  if (M3_EXPERIMENT_PER_MODEL !== S.stage1PerModel) offenders.push('1차 건수 별칭이 어긋난다')

  // 🔴 1차는 한 실행에 들어가야 한다
  if (S.stage1PerModel > M3_CAPS.itemLimit) offenders.push('1차가 itemLimit 초과 — 한 실행에 못 담는다')

  // 🔴 tokenCap 이 실질 제약이다. 1건당 실측 5,468 tok 기준 한 실행 상한을 넘지 않아야 한다
  const PER_ITEM_TOKENS = 5_468
  const maxPerRun = Math.floor(M3_CAPS.tokenCap / PER_ITEM_TOKENS)
  if (M3_CAPS.itemLimit > maxPerRun) {
    offenders.push(`itemLimit ${M3_CAPS.itemLimit} 이 tokenCap 상한 ${maxPerRun}건을 넘는다`)
  }
  // 2차 · 3차는 쪼개야 도는 크기여야 한다 (한 실행에 안 들어가는 것이 정상)
  if (S.stage2PerModel <= M3_CAPS.itemLimit) offenders.push('2차가 한 실행에 들어간다 — 단계 구분이 무의미하다')

  // 🔴 dollarCap 안에서 도는가 (haiku 기준, 가장 비싼 쪽)
  const haiku = pricingFor('claude-haiku-4.5')
  const runCost = (M3_CAPS.itemLimit * 5_018) / 1e6 * haiku.inputPerMTok
    + (M3_CAPS.itemLimit * 450) / 1e6 * haiku.outputPerMTok
  if (runCost > M3_CAPS.dollarCap) offenders.push(`한 실행이 dollarCap 초과: $${runCost.toFixed(4)}`)

  // 층화 축
  if (M3_STRATA_AXES.length < 12) offenders.push(`층화 축이 ${M3_STRATA_AXES.length}개 — 너무 적다`)
  for (const must of ['shortBody', 'longBody', 'manyComments', 'fewComments',
    'strongEmotion', 'calmTone', 'question', 'complaint', 'experience',
    'sourceSpecificAddress', 'targetDescriptorRisk', 'highOtherReaction',
    'referenced', 'notReferenced']) {
    if (!(M3_STRATA_AXES as readonly string[]).includes(must)) offenders.push(`층화 축 ${must} 누락`)
  }
  if (offenders.length) bad('단계형 실험 · 층화 축 · cap 정합', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('단계형 실험 · 층화 축 · cap 정합', 'policy',
    `30 → 100 → 300 · 축 ${M3_STRATA_AXES.length}종 · 한 실행 ${M3_CAPS.itemLimit}건(tokenCap 상한 ${maxPerRun}) · $${runCost.toFixed(3)}/실행`)
}


// ══════════════════════════════════════════════════════════
// VE-M3-3 실행 경로 — 🔴 여기부터 돈이 나갈 수 있다
//
// 🔴 ① 의 기준이 바뀌었다. 실행 경로가 생겼으므로 provider 호출을
//    **허용 파일 안에서만** 인정한다. 그 밖은 여전히 0 이어야 한다.
// ══════════════════════════════════════════════════════════

// ── ⑰ provider 호출은 허용 파일에만 있다 ───────────────
{
  const offenders: string[] = []
  // 허용: provider adapter · run(게이트 뒤). 금지: dry-run · check · lib 나머지
  //
  // 🔴 **이 fixture 자신은 대상에서 뺀다.**
  //    검사 패턴을 문자열로 들고 있기 때문에, 자기 자신을 훑으면
  //    `indexOf('await fetch(')` 같은 줄이 위반으로 읽힌다 — 실제로 세 번 걸렸다.
  //    검사기가 자기 검사 문구에 걸리면 그 가드는 쓸 수 없다.
  //    대신 아래에서 **SDK import 만** 따로 본다. import 는 문자열로 쓸 일이 없다.
  const FORBIDDEN_FILES: Array<[string, string]> = [
    ['dry-run', liveCode], ['contract lib', contractCode], ['prompt lib', promptCode],
    ['sample lib', sampleCode],
    // 🔴 전량 계획 리포트도 provider 를 부르지 않는다 (VE-M3-5)
    ['plan', planCode],
  ]
  for (const [label, code] of FORBIDDEN_FILES) {
    // 🔴 **실제 호출 형태만** 본다.
    //    `\bfetch\s*\(` 같은 넓은 패턴을 쓰면 이 fixture 안의 검사 정규식 자체가 걸린다
    //    (실제로 걸렸다). 가드가 자기 자신을 위반으로 읽으면 쓸 수 없다.
    if (/(await|return|=)\s+fetch\s*\(/.test(code)) offenders.push(`${label} 에 fetch 호출`)
    if (/from\s+['"](openai|@anthropic-ai\/[^'"]*)['"]/.test(code)) offenders.push(`${label} 에 SDK import`)
    if (/['"]https:\/\/api\.(openai|anthropic)\.com/.test(code)) offenders.push(`${label} 에 엔드포인트`)
  }
  // 🔴 adapter 는 fetch 를 가져도 되지만 **top-level 에서 부르면 안 된다**.
  //    import 만으로 돈이 나가는 구조를 막는 검사다.
  //
  //    🔴 선언과 호출을 구분한다. `export async function callProvider(` 는 들여쓰기가 0이지만
  //       호출이 아니라 정의다 — 이걸 잡으면 정당한 코드를 막는다(실제로 한 번 걸렸다).
  //       실행문만 본다: 들여쓰기 0에서 await/void 로 시작하거나 곧바로 호출하는 줄.
  const topLevel = providerCode.split('\n').filter((l) =>
    /^(await\s+)?(fetch|callProvider)\s*\(/.test(l) || /^void\s+(fetch|callProvider)\s*\(/.test(l))
  if (topLevel.length > 0) offenders.push('provider adapter 가 top-level 에서 호출한다')
  // 🔴 호출은 반드시 함수 안에 있어야 한다 — adapter 에 fetch 가 있되 선언 뒤여야 한다
  const fnAt = providerCode.indexOf('export async function callProvider')
  const fetchAt = providerCode.indexOf('await fetch(')
  if (fnAt === -1) offenders.push('callProvider 선언을 찾지 못했다')
  else if (fetchAt !== -1 && fetchAt < fnAt) offenders.push('fetch 가 함수 선언보다 앞에 있다')
  // 🔴 이 fixture 자신에도 SDK import 는 없어야 한다 — import 는 리터럴로 쓸 일이 없어 안전하다
  const selfRaw = readFileSync(join(HERE, 'voice-m3-check.mts'), 'utf-8')
  if (/^import .*from\s+['"](openai|@anthropic-ai\/)/m.test(selfRaw)) offenders.push('check 에 SDK import')

  // adapter 밖에서 callProvider 를 부르는 곳은 run 하나뿐이어야 한다
  const callers = [['dry-run', liveCode], ['contract', contractCode], ['prompt', promptCode], ['sample', sampleCode], ['plan', planCode]] as const
  for (const [label, code] of callers) {
    // 실제 호출 형태만 — import 나 문자열 언급을 위반으로 읽지 않는다
    if (/(await|return|=)\s+callProvider\s*\(/.test(code)) offenders.push(`${label} 이 callProvider 를 부른다`)
  }
  if (offenders.length) bad('provider 호출은 허용 파일에만', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('provider 호출은 허용 파일에만', 'guard', 'adapter+run 만 · top-level 호출 0 · 나머지 파일 fetch 0')
}

// ── ⑱ API key 를 로그에 흘리지 않는다 ──────────────────
{
  const offenders: string[] = []
  const ENVS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']
  for (const [label, code] of [['run', runCode], ['provider', providerCode]] as const) {
    for (const l of code.split('\n').filter((x) => /console\.(log|error)/.test(x))) {
      for (const e of ENVS) if (l.includes(e) && !l.includes('envName')) offenders.push(`${label} 로그에 ${e}`)
      if (/\$\{[^}]*\bkey\b[^}]*\}/.test(l) && !/keyStatus|envName/.test(l)) offenders.push(`${label} 로그에 key 변수`)
    }
  }

  // 🔴 keyStatus 는 **envName 과 boolean 만** 돌려준다.
  //    초판은 `sk-a…` 앞 4자를 힌트로 줬는데 그것도 값의 일부다 —
  //    prefix 만으로 provider 와 키 종류가 드러나고, 로그는 우리가 통제하지 못한다.
  const st = keyStatus('gpt-5-nano')
  const allowed = ['envName', 'present']
  const extra = Object.keys(st).filter((k) => !allowed.includes(k))
  if (extra.length > 0) offenders.push(`keyStatus 가 ${extra.join(',')} 를 노출한다`)
  if (typeof (st as Record<string, unknown>).present !== 'boolean') {
    offenders.push('present 가 boolean 이 아니다')
  }
  // 🔴 값을 잘라 쓰는 코드가 **아예 없어야** 한다. 길이도 주지 않는다
  for (const [pat, why] of [
    [/hint\s*[:=]/, 'hint 필드'],
    [/preview\s*[:=]/, 'preview 필드'],
    [/raw\.slice\(/, 'key 를 잘라 쓴다'],
    [/raw\.substring\(|raw\.substr\(/, 'key 를 잘라 쓴다'],
    [/\.length\s*\}/, 'key 길이를 문자열에 넣는다'],
  ] as Array<[RegExp, string]>) {
    if (pat.test(providerCode)) offenders.push(`provider 에 ${why}`)
  }
  if (!/present: raw\.trim\(\)\.length > 0/.test(providerCode)) offenders.push('존재 여부를 boolean 으로 다루지 않는다')

  // 🔴 로그 문구에 key prefix 가 나오면 안 된다
  for (const [label, code] of [['run', runCode], ['provider', providerCode]] as const) {
    for (const l of code.split('\n').filter((x) => /console\.(log|error)/.test(x))) {
      if (/sk-proj|sk-ant|['"`]sk-/.test(l)) offenders.push(`${label} 로그에 key prefix`)
      if (/k\.hint|status\.hint|\.hint\b/.test(l)) offenders.push(`${label} 로그에 hint`)
    }
  }
  // 🔴 존재 표기는 OK/없음 만 — 값이 섞일 자리가 없다
  if (!/k\.present \? 'OK' : '없음'/.test(runCode)) {
    offenders.push("존재 표기가 OK/없음 형태가 아니다")
  }
  if (offenders.length) bad('API key 유출 0 (힌트·길이 포함)', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('API key 유출 0 (힌트·길이 포함)', 'guard', `envName+boolean 만 · slice 0 · prefix 0 · OK/없음 표기`)
}

// ── ⑲ 유료 게이트 — 하나라도 없으면 호출 불가 ───────────
//    🔴 이 저장소에서 처음으로 돈이 나갈 수 있는 자리다.
{
  const offenders: string[] = []
  if (!/function paidCallGate/.test(runCode)) offenders.push('게이트 함수 없음')
  // 🔴 **게이트 함수 본문**을 잘라내 그 안을 본다.
  //    파일 어딘가에 '--apply' 문자열이 있는 것으로는 부족하다 —
  //    argv 파싱만 남고 게이트 조건이 사라져도 통과해 버린다(역검증에서 실제로 뚫렸다).
  const gateStart = runCode.indexOf('function paidCallGate')
  const gateEnd = runCode.indexOf('\nasync function main', gateStart)
  const gateBody = gateStart === -1 ? '' : runCode.slice(gateStart, gateEnd === -1 ? gateStart + 2000 : gateEnd)
  if (!/blocked\.push[\s\S]{0,80}--apply/.test(gateBody)) offenders.push('게이트가 --apply 를 막지 않는다')
  if (!/blocked\.push[\s\S]{0,80}--confirm-paid-call/.test(gateBody)) offenders.push('게이트가 --confirm-paid-call 을 막지 않는다')
  if (!/!APPLY/.test(gateBody)) offenders.push('게이트에 APPLY 조건 없음')
  if (!/!CONFIRM_PAID/.test(gateBody)) offenders.push('게이트에 CONFIRM_PAID 조건 없음')
  // 🔴 --model · --stage 도 **차단 목록에 실제로 올리는지**를 본다.
  //    gateBody 어딘가에 'model' 이 있는 것으론 부족하다 — pricingFor(model) 같은
  //    다른 쓰임이 검사를 대신 통과시킨다(역검증에서 실제로 뚫렸다).
  if (!/blocked\.push[\s\S]{0,60}--model/.test(gateBody)) offenders.push('게이트가 --model 을 막지 않는다')
  if (!/blocked\.push[\s\S]{0,60}--stage/.test(gateBody)) offenders.push('게이트가 --stage 를 막지 않는다')
  if (!/!model/.test(gateBody)) offenders.push('게이트에 model 조건 없음')
  if (!/!stage/.test(gateBody)) offenders.push('게이트에 stage 조건 없음')
  // 🔴 maxOutputTokensFor 는 2026-08-27 에 추가됐다.
  //    출력 상한이 등록되지 않은 모델을 부르면 1,000 사고가 이름만 바꿔 되풀이된다
  for (const cond of ['itemLimit', 'dollarCap', 'tokenCap', 'pricingFor', 'keyStatus', 'maxOutputTokensFor']) {
    if (!gateBody.includes(cond)) offenders.push(`게이트에 ${cond} 검사 없음`)
  }
  // 🔴 게이트 실패 시 **아무것도 하지 않고** 멈춰야 한다
  if (!/willCallProvider && !gate\.ok[\s\S]{0,300}process\.exit\(1\)/.test(runCode)) {
    offenders.push('게이트 실패 시 즉시 중단하지 않는다')
  }
  // 🔴 callProvider 는 willCallProvider 분기 뒤에만 있어야 한다
  const dryReturn = runCode.indexOf('if (!willCallProvider)')
  const firstCall = runCode.indexOf('callProvider({')
  if (dryReturn === -1 || firstCall === -1 || firstCall < dryReturn) {
    offenders.push('dry-run 분기보다 앞에서 provider 를 부른다')
  }
  if (offenders.length) bad('유료 게이트 10중', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('유료 게이트 10중', 'guard', 'apply+confirm+model+stage+limit+dollar+token+단가+출력상한+key · 실패 시 즉시 중단')
}

// ── ⑳ 저장 전 원문 유출 대조가 실행 경로에 있다 ─────────
{
  const offenders: string[] = []
  if (!/assertNoSourceLeak\(/.test(runCode)) offenders.push('run 에 유출 대조가 없다')
  // 🔴 대조가 **저장보다 앞**에 있어야 한다
  const leakAt = runCode.indexOf('assertNoSourceLeak(')
  // 🔴 저장은 upsert 다(2026-08-27). 실패 캐시를 다시 부른 뒤 create 하면 UNIQUE 로 터진다
  const saveAt = runCode.indexOf('voiceM3Cache.upsert(')
  if (leakAt === -1 || saveAt === -1 || leakAt > saveAt) offenders.push('유출 대조가 저장 뒤에 있다')
  // 걸리면 저장하지 않고 skipped
  if (!/leak\.leaked[\s\S]{0,200}skipped/.test(runCode)) offenders.push('유출 시 skipped 처리가 없다')
  // 🔴 금지 호칭도 저장 전에 막는다
  if (!/M3_FORBIDDEN_ADDRESS_TERMS[\s\S]{0,300}skipped/.test(runCode)) {
    offenders.push('금지 호칭이 출력에 있어도 저장한다')
  }
  if (offenders.length) bad('저장 전 유출 · 금지어 차단', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('저장 전 유출 · 금지어 차단', 'policy', '대조 → 금지어 → 저장 순서 · 걸리면 skipped')
}

// ── ㉑ 표본은 deterministic 하고 두 모델이 같다 ──────────
{
  const offenders: string[] = []
  // 난수가 없어야 한다
  if (/Math\.random|crypto\.randomUUID/.test(sampleCode)) offenders.push('표본 선정에 난수')
  // 같은 입력 → 같은 표본
  const mk = (i: number): SampleCandidate => ({
    id: `id-${String(i).padStart(4, '0')}`, sourceRef: `ref-${i}`,
    sourceSite: i % 3 === 0 ? 'navercafe:wgang' : 'navercafe:dlxogns01',
    contentLength: 150 + (i * 37) % 1500, commentCount: i % 30,
    legacyLabels: { urgencyLevel: i % 5, communitySignal: ['question', 'complaint', 'confession'][i % 3],
      emotionTags: i % 2 === 0 ? ['ANGRY'] : ['HOPEFUL'], desireType: i % 4 === 0 ? 'big_desire' : 'need' },
    sourceSpecificCount: i % 11 === 0 ? 1 : 0,
    targetDescriptorCount: i % 53 === 0 ? 1 : 0,
    referenced: i % 3 === 0,
    commentSignalTotal: i % 12, otherReactionCount: i % 12, truncatedCount: i % 7 === 0 ? 1 : 0,
  })
  const pool = Array.from({ length: 300 }, (_, i) => mk(i))
  const a = selectStratifiedSample(pool, 30)
  const b = selectStratifiedSample(pool, 30)
  // 🔴 입력 순서를 섞어도 같은 결과여야 한다 — id 정렬에만 기대기 때문이다
  const shuffled = [...pool].reverse()
  const c = selectStratifiedSample(shuffled, 30)
  const idsA = a.rows.map((r) => r.id).join(',')
  if (idsA !== b.rows.map((r) => r.id).join(',')) offenders.push('같은 입력이 다른 표본을 낸다')
  if (idsA !== c.rows.map((r) => r.id).join(',')) offenders.push('입력 순서가 결과를 바꾼다')
  if (a.rows.length !== 30) offenders.push(`표본이 ${a.rows.length}건`)
  // 🔴 두 모델이 같은 표본을 쓴다 — 표본 선정에 model 이 들어가지 않는다
  if (/model/i.test(sampleCode.replace(/SampleCandidate|SampleRow|SampleAxis/g, ''))) {
    offenders.push('표본 선정이 model 을 참조한다')
  }
  // 3000자는 제외된다
  const withTrunc = [...pool, { ...mk(999), contentLength: 3000 }]
  if (selectStratifiedSample(withTrunc, 30).rows.some((r) => r.contentLength === 3000)) {
    offenders.push('3000자 잘린 글이 표본에 들어갔다')
  }
  if (offenders.length) bad('표본 deterministic · 모델 무관', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('표본 deterministic · 모델 무관', 'policy', '난수 0 · 재실행 동일 · 입력순서 무관 · 3000자 제외')
}

// ── ㉒ 층화 축이 계약과 같다 ────────────────────────────
{
  const offenders: string[] = []
  for (const must of ['shortBody', 'longBody', 'manyComments', 'fewComments',
    'strongEmotion', 'calmTone', 'question', 'complaint', 'experience',
    'sourceSpecificAddress', 'targetDescriptorRisk', 'highOtherReaction',
    'referenced', 'notReferenced', 'truncatedComment']) {
    if (!(SAMPLE_AXES as readonly string[]).includes(must)) offenders.push(`축 ${must} 누락`)
  }
  if (SAMPLE_AXES.length !== 15) offenders.push(`축이 ${SAMPLE_AXES.length}개 (15개여야 한다)`)
  // validateSample 이 빈 축을 잡는가
  const empty = validateSample({ rows: [], coverage: {}, missingAxes: [...SAMPLE_AXES], siteSpread: {} }, 30)
  if (empty.ok) offenders.push('빈 축을 통과시킨다')
  if (offenders.length) bad('층화 축 15종', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('층화 축 15종', 'policy', `${SAMPLE_AXES.length}축 · 빈 축이면 거부`)
}

// ── ㉓ dry-run 은 DB 에 쓰지 않는다 ─────────────────────
{
  const offenders: string[] = []
  // 🔴 write 는 전부 dry-run 분기 **뒤**에 있어야 한다
  const dryReturn = runCode.indexOf('if (!willCallProvider)')
  for (const w of ['voiceM3Run.create(', 'voiceM3Cache.upsert(', 'voiceM3CostEvent.create(', 'voiceM3Run.update(']) {
    const at = runCode.indexOf(w)
    if (at === -1) { offenders.push(`${w} 를 찾지 못했다`); continue }
    if (at < dryReturn) offenders.push(`${w} 가 dry-run 분기보다 앞에 있다`)
  }
  // Micro Seed 접점 0
  for (const t of ['microSeedCandidate', 'microSeedRawContent', 'planSheetWrite', 'micro-seed-sheet']) {
    if (runCode.includes(t)) offenders.push(`Micro Seed 접점: ${t}`)
  }
  if (offenders.length) bad('dry-run DB write 0 · Micro Seed 0', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('dry-run DB write 0 · Micro Seed 0', 'guard', 'write 4종 전부 게이트 뒤 · Micro Seed 접점 0')
}

// ══════════════════════════════════════════════════════════
// 2026-08-27 1차 실행 실패 보정 — 🔴 여기 다섯은 사고가 만든 fixture 다
//
//   gpt-5-nano 30건 중 5건 전부 JSON_PARSE 실패. 출력 토큰이 5건 모두 **정확히 1000**.
//   원인은 모델 품질이 아니라 우리 쪽 하드코딩 상한이었고,
//   그것을 확정하지 못한 이유는 진단을 저장하지 않았기 때문이다.
//   같은 두 결함이 다시 들어오지 못하게 막는다.
// ══════════════════════════════════════════════════════════

// ── ㉔ 출력 상한 부족으로 잘린 JSON 을 잡는다 ───────────
{
  const offenders: string[] = []
  // 🔴 하드코딩 1000 이 다시 들어오면 안 된다
  if (/maxOutputTokens:\s*1000\b/.test(runCode)) offenders.push('run 에 maxOutputTokens 1000 하드코딩')
  if (!/maxOutputTokens:\s*maxOut\b/.test(runCode)) offenders.push('run 이 모델별 상한을 쓰지 않는다')
  if (!/maxOutputTokensFor\(/.test(runCode)) offenders.push('run 이 maxOutputTokensFor 를 부르지 않는다')

  // 🔴 reasoning 모델은 상한이 산출물(450)보다 충분히 커야 한다
  const nano = outputTokenPolicyFor('gpt-5-nano')
  if (!nano.reasoning) offenders.push('gpt-5-nano 가 reasoning 모델로 등록되지 않았다')
  if (nano.maxOutputTokens <= 1000) offenders.push(`gpt-5-nano 상한이 ${nano.maxOutputTokens} — 실패한 값 이하다`)
  if (nano.maxOutputTokens - ESTIMATED_OUTPUT_TOKENS_PER_ITEM < 1000) {
    offenders.push('추론 예산이 1,000 tok 미만이다')
  }
  // 🔴 reasoning 토큰도 출력으로 과금된다. 추정이 상한을 따라가야 정직하다
  if (nano.estimatedOutputTokens < nano.maxOutputTokens) {
    offenders.push('reasoning 모델인데 비용 추정이 상한보다 작다 (과소추정)')
  }

  // 🔴 잘린 모양을 실제로 구분하는가
  const cases: Array<[string, string]> = [
    ['', 'empty'],
    ['{"naturalnessScore": 70, "voiceRet', 'truncated'],
    ['```json\n{"a":1}\n```', 'fenced'],
    ['죄송합니다. 답변할 수 없습니다.', 'not_json'],
    ['{"a": 1,}', 'invalid'],
  ]
  for (const [text, want] of cases) {
    const got = classifyJsonFailure(text)
    if (got !== want) offenders.push(`classifyJsonFailure("${want}") 가 ${got}`)
  }
  // 🔴 종료 사유가 없어도 토큰 대조로 잡아야 한다 — 1차 실행이 정확히 그 상황이었다
  if (!isMaxTokensReached('', 1000, 1000)) offenders.push('토큰 대조로 상한 도달을 잡지 못한다')
  if (!isMaxTokensReached('length', 10, 4000)) offenders.push('finish=length 를 상한 도달로 보지 않는다')
  if (!isMaxTokensReached('max_tokens', 10, 4000)) offenders.push('Anthropic max_tokens 를 놓친다')
  if (isMaxTokensReached('stop', 500, 4000)) offenders.push('정상 종료를 상한 도달로 오판한다')

  // cap 은 그대로여야 한다 — 상한을 올렸다고 예산을 올리지 않는다
  if (M3_CAPS.tokenCap !== 500_000) offenders.push(`tokenCap 이 ${M3_CAPS.tokenCap}`)
  if (M3_CAPS.dollarCap !== 5) offenders.push(`dollarCap 이 ${M3_CAPS.dollarCap}`)
  // 🔴 상한을 올려도 itemLimit 이 tokenCap 안에 들어와야 한다.
  //    **후보 전원을 본다** — 모델이 늘 때마다 한 모델만 검사하면 새 모델이 cap 을 깬다.
  //    입력 1,745 tok 은 30건 실측 평균이다.
  const INPUT_PER_ITEM = 1745
  let worstOfAll = 0
  for (const label of Object.keys(M3_MODEL_CANDIDATES)) {
    let pol
    try { pol = outputTokenPolicyFor(label) } catch { offenders.push(`${label} 에 출력 토큰 정책이 없다`); continue }
    const worst = INPUT_PER_ITEM + pol.maxOutputTokens
    worstOfAll = Math.max(worstOfAll, worst)
    if (worst * M3_CAPS.itemLimit > M3_CAPS.tokenCap) {
      offenders.push(`${label}: itemLimit ${M3_CAPS.itemLimit} × 최악 ${worst} tok 이 tokenCap 을 넘는다`)
    }
    // 🔴 30건 1회 실행이 dollarCap 안에서 도는가 — 최악값 기준
    let pr
    try { pr = pricingFor(label) } catch { offenders.push(`${label} 의 단가가 없다`); continue }
    const cost30 = (30 * INPUT_PER_ITEM) / 1e6 * pr.inputPerMTok
      + (30 * pol.estimatedOutputTokens) / 1e6 * pr.outputPerMTok
    if (cost30 > M3_CAPS.dollarCap) offenders.push(`${label}: 30건 최악 $${cost30.toFixed(4)} 이 dollarCap 초과`)
  }
  if (offenders.length) bad('출력 상한 부족 · 잘린 JSON 감지', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('출력 상한 부족 · 잘린 JSON 감지', 'guard',
    `nano ${nano.maxOutputTokens} tok(reasoning) · 5종 분류 정확 · cap 불변 · ` +
    `후보 ${Object.keys(M3_MODEL_CANDIDATES).length}종 최악 ${worstOfAll}×${M3_CAPS.itemLimit} < ${M3_CAPS.tokenCap}`)
}

// ── ㉕ 실패한 캐시가 재실행을 막지 않는다 ───────────────
{
  const offenders: string[] = []
  // 🔴 cache hit 판정에 status 조건이 있어야 한다
  if (!/cached && cached\.status === 'succeeded'/.test(runCode)) {
    offenders.push('cache hit 판정이 status 를 보지 않는다')
  }
  if (!/status:\s*true/.test(runCode)) offenders.push('캐시 조회가 status 를 읽지 않는다')
  // 🔴 저장이 upsert 여야 한다. create 면 재시도가 UNIQUE 로 터진다
  if (/voiceM3Cache\.create\(/.test(runCode)) offenders.push('run 이 아직 create 로 저장한다 (재시도 시 P2002)')
  if (!/voiceM3Cache\.upsert\(/.test(runCode)) offenders.push('run 이 upsert 로 저장하지 않는다')
  if (!/where:\s*\{\s*cacheKey: item\.cacheKey\s*\}/.test(runCode)) offenders.push('upsert 가 cacheKey 로 찾지 않는다')
  // 🔴 재시도 비용이 retryAttempt 로 이어져야 한다 — 0 부터 다시 세면 안 된다
  if (!/priorCalls\s*\+\s*retry/.test(runCode)) offenders.push('retryAttempt 가 이전 호출 수를 잇지 않는다')
  if (!/eventType:\s*'call'/.test(runCode)) offenders.push("이전 call 이벤트를 세지 않는다")
  if (!/voiceM3CostEvent\.count\(/.test(runCode)) offenders.push('이전 호출 횟수를 조회하지 않는다')
  // 🔴 실패 재시도 시 이전 산출물이 남으면 안 된다
  if (!/Prisma\.DbNull/.test(runCode)) offenders.push('실패 시 output 을 명시적으로 비우지 않는다')
  if (offenders.length) bad('failed 캐시는 재시도 가능', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('failed 캐시는 재시도 가능', 'guard', 'succeeded 만 hit · upsert 저장 · retryAttempt 누적 · output 초기화')
}

// ── ㉖ succeeded 캐시만 cache hit 으로 센다 ─────────────
{
  const offenders: string[] = []
  // 🔴 cacheHit 증가가 succeeded 분기 안에만 있어야 한다
  const hitAt = runCode.indexOf('cacheHit += 1')
  const guardAt = runCode.indexOf("cached.status === 'succeeded'")
  if (hitAt === -1) offenders.push('cacheHit 증가를 찾지 못했다')
  else if (guardAt === -1 || guardAt > hitAt) offenders.push('cacheHit 증가가 status 조건보다 앞에 있다')
  // 🔴 cache_hit 이벤트도 succeeded 일 때만
  const evAt = runCode.indexOf("eventType: 'cache_hit'")
  if (evAt === -1) offenders.push('cache_hit 이벤트가 없다')
  else if (guardAt === -1 || guardAt > evAt) offenders.push('cache_hit 이벤트가 status 조건 밖에 있다')
  // 🔴 실패 캐시는 miss 로 세어 다시 부른다
  const missAt = runCode.indexOf('cacheMiss += 1')
  if (missAt === -1 || missAt < hitAt) offenders.push('실패 캐시가 miss 로 이어지지 않는다')
  // 🔴 dry-run 요약도 재사용 가능 건수만 재사용이라고 말해야 한다
  if (!/status === 'succeeded'\)\.length/.test(runCode)) {
    offenders.push('dry-run 요약이 succeeded 만 재사용으로 세지 않는다')
  }
  // 캐시 상태 3종이 스키마와 같은가
  for (const s of ['succeeded', 'failed', 'skipped']) {
    if (!runCode.includes(`'${s}'`)) offenders.push(`캐시 상태 ${s} 를 다루지 않는다`)
  }
  if (offenders.length) bad('succeeded 캐시만 재사용', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('succeeded 캐시만 재사용', 'policy', 'hit·cache_hit 이벤트 모두 succeeded 분기 안 · 실패는 miss')
}

// ── ㉗ 종료 사유가 없으면 실패로 처리한다 ───────────────
{
  const offenders: string[] = []
  // 🔴 provider 가 두 provider 의 종료 사유를 각각 읽어야 한다
  if (!/finish_reason/.test(providerCode)) offenders.push('OpenAI finish_reason 을 읽지 않는다')
  if (!/stop_reason/.test(providerCode)) offenders.push('Anthropic stop_reason 을 읽지 않는다')
  // 🔴 비어 있으면 성공으로 세지 않는다
  if (!/NO_FINISH_REASON/.test(providerCode)) offenders.push('종료 사유 부재를 실패로 다루지 않는다')
  if (!/finishReason\.trim\(\) === ''[\s\S]{0,200}NO_FINISH_REASON/.test(providerCode)) {
    offenders.push('종료 사유가 비어도 성공으로 반환한다')
  }
  // 🔴 실패로 처리하되 토큰은 실어 보내야 한다 — 이미 청구된 비용이다
  if (!/NO_FINISH_REASON[\s\S]{0,300}inputTokens, outputTokens/.test(providerCode)) {
    offenders.push('종료 사유 부재 시 토큰을 버린다 (cap 계상이 어긋난다)')
  }
  // 🔴 reasoning 토큰은 0 이 아니라 null 로 구분한다
  if (!/reasoningTokens/.test(providerCode)) offenders.push('reasoning 토큰을 읽지 않는다')
  if (!/completion_tokens_details/.test(providerCode)) offenders.push('OpenAI reasoning 토큰 경로가 없다')
  // 🔴 run 이 진단을 실제로 저장해야 한다
  if (!/formatDiagnostics\(/.test(runCode)) offenders.push('run 이 진단을 만들지 않는다')
  if (!/finishReason: response\.finishReason/.test(runCode)) offenders.push('진단에 종료 사유가 없다')
  if (!/errorMessage/.test(runCode)) offenders.push('진단을 저장하지 않는다')
  // 진단 문자열에 필수 항목이 다 들어가는가
  const diag = formatDiagnostics({
    finishReason: 'length', outputTokens: 1000, maxOutputTokens: 1000,
    reasoningTokens: 1000, responseChars: 0, jsonFailure: 'empty', maxTokensReached: true,
  })
  for (const must of ['json=empty', 'finish=length', 'out=1000/1000', 'reasoning=1000', 'chars=0', 'maxTokens 도달']) {
    if (!diag.includes(must)) offenders.push(`진단에 ${must} 없음`)
  }
  // 종료 사유가 비어도 문자열이 깨지지 않아야 한다
  if (!formatDiagnostics({
    finishReason: '', outputTokens: 0, maxOutputTokens: 4000,
    reasoningTokens: null, responseChars: 0, jsonFailure: null, maxTokensReached: false,
  }).includes('finish=(없음)')) offenders.push('빈 종료 사유 표기가 없다')
  if (offenders.length) bad('종료 사유 없으면 실패', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('종료 사유 없으면 실패', 'guard', `finish_reason+stop_reason · 부재 시 NO_FINISH_REASON · 진단 "${diag}"`)
}

// ── ㉘ LLM 응답 전문을 저장하지 않는다 ──────────────────
{
  const offenders: string[] = []
  // 🔴 진단에 응답 본문이 들어갈 자리가 없어야 한다.
  //    입력 타입이 수치와 열거값뿐이라 실수로도 넣을 수 없는 구조인지 실제로 확인한다
  const secret = '어제 병원 다녀왔는데요 검사 결과가 애매하다고 하네요'
  const built = formatDiagnostics({
    finishReason: 'length', outputTokens: 1000, maxOutputTokens: 4000,
    reasoningTokens: 950, responseChars: secret.length, jsonFailure: 'truncated',
    maxTokensReached: true,
  })
  if (built.includes(secret)) offenders.push('진단에 응답 본문이 섞인다')
  if (built.includes('병원')) offenders.push('진단에 원문 조각이 섞인다')
  // 길이는 남기되 내용은 남기지 않는다
  if (!built.includes(`chars=${secret.length}`)) offenders.push('응답 길이를 남기지 않는다')

  // 🔴 rawText 를 저장 필드에 그대로 넣는 코드가 없어야 한다
  for (const [pat, why] of [
    [/errorMessage:\s*response\.rawText/, 'errorMessage 에 응답 전문'],
    [/errorMessage:\s*[^,\n]*rawText/, 'errorMessage 에 rawText 가 섞인다'],
    [/output:\s*response\.rawText/, 'output 에 응답 전문'],
    [/reason:\s*[^,\n]*rawText/, 'CostEvent.reason 에 rawText'],
    [/errorSummary:\s*[^,\n]*rawText/, 'Run.errorSummary 에 rawText'],
    [/rawText\.slice\(/, '응답을 잘라 저장한다'],
    [/rawText\.substring\(/, '응답을 잘라 저장한다'],
  ] as Array<[RegExp, string]>) {
    if (pat.test(runCode)) offenders.push(why)
  }
  // 🔴 응답을 로그로 찍지도 않는다
  for (const l of runCode.split('\n').filter((x) => /console\.(log|error)/.test(x))) {
    if (/\$\{[^}]*rawText[^}]*\}/.test(l)) offenders.push('로그에 응답 전문')
    if (/\$\{[^}]*\boutput\b[^}]*\}/.test(l)) offenders.push('로그에 산출물')
  }
  // 🔴 provider 도 응답 본문을 errorMessage 에 담지 않는다
  for (const l of providerCode.split('\n')) {
    if (/errorMessage:\s*[^,\n]*\b(text|body|json)\b/.test(l)) offenders.push('provider 가 응답을 사유에 담는다')
  }
  // 🔴 저장되는 산출물은 파싱된 JSON 이지 원문 문자열이 아니다
  if (!/JSON\.parse\(response\.rawText\)/.test(runCode)) offenders.push('산출물을 파싱하지 않고 저장한다')
  if (offenders.length) bad('LLM 응답 전문 저장 0', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('LLM 응답 전문 저장 0', 'policy', `진단 ${built.length}B 에 본문 0 · 길이만 · rawText 저장 경로 0`)
}

// ── ㉙ 내부 라벨을 provider 에 보내지 않는다 ─────────────
//    🔴 2026-08-27: `claude-haiku-4.5` 를 그대로 body.model 에 넣어
//       Haiku 30건이 HTTP_404 로 전멸했다(비용 0원). 품질 실패가 아니라 매핑 실패다.
{
  const offenders: string[] = []

  // ① 후보 전원이 apiModelId 를 갖는다 — 값이 같은 모델도 예외 없다
  for (const [label, c] of Object.entries(M3_MODEL_CANDIDATES as Record<string, { apiModelId?: string }>)) {
    if (typeof c.apiModelId !== 'string' || c.apiModelId.trim() === '') {
      offenders.push(`${label} 에 apiModelId 없음`)
    }
  }
  // ② 확인된 공식 ID 와 일치하는가
  //    🔴 조회를 try 로 감싼다. apiModelId 가 없으면 `apiModelIdFor` 가 던지는데,
  //       그대로 두면 fixture 가 **스택만 남기고 죽어** 무엇이 틀렸는지 읽히지 않는다.
  //       역검증에서 실제로 그렇게 됐다 — 막긴 했지만 이유를 말하지 못했다.
  const idOf = (label: string): string | null => {
    try { return apiModelIdFor(label) } catch { return null }
  }
  const haikuId = idOf('claude-haiku-4.5')
  const nanoId = idOf('gpt-5-nano')
  if (haikuId === null) offenders.push('haiku 의 apiModelId 를 꺼내지 못한다')
  else {
    if (haikuId !== 'claude-haiku-4-5-20251001') offenders.push(`haiku apiModelId 가 ${haikuId}`)
    // 🔴 내부 라벨이 그대로 API ID 인 것은 nano 의 우연이다. haiku 는 달라야 한다
    if (haikuId === 'claude-haiku-4.5') offenders.push('haiku 의 내부 라벨과 apiModelId 가 같다 — 404 를 부른 그 상태다')
  }
  if (nanoId === null) offenders.push('nano 의 apiModelId 를 꺼내지 못한다 (명시적 분리가 빠졌다)')
  else if (nanoId !== 'gpt-5-nano') offenders.push(`nano apiModelId 가 ${nanoId}`)
  // ③ 미등록 모델은 던진다
  for (const bad of ['gpt-4o', '', M3_MODEL_UNDETERMINED]) {
    let threw = false
    try { apiModelIdFor(bad) } catch { threw = true }
    if (!threw) offenders.push(`미등록 모델 "${bad}" 을 통과시킨다`)
  }

  // ④ 🔴 provider 가 **`req.model` 을 body 에 직접 넣지 않는다**
  const bodyStart = providerCode.indexOf('const body = isAnthropic')
  const bodyEnd = providerCode.indexOf('const res = await fetch', bodyStart)
  const bodyBlock = bodyStart === -1 ? '' : providerCode.slice(bodyStart, bodyEnd === -1 ? bodyStart + 900 : bodyEnd)
  if (bodyStart === -1) offenders.push('provider 의 body 조립부를 찾지 못했다')
  if (/model:\s*req\.model\b/.test(bodyBlock)) offenders.push('🔴 body.model 에 내부 라벨(req.model)을 직접 넣는다')
  // 두 provider 분기 **양쪽 모두** apiModelId 여야 한다
  const viaApi = (bodyBlock.match(/model:\s*apiModelId\b/g) ?? []).length
  if (viaApi < 2) offenders.push(`body.model 이 apiModelId 를 쓰는 곳이 ${viaApi}곳 (Anthropic·OpenAI 둘 다여야 한다)`)
  if (!/const apiModelId = apiModelIdFor\(req\.model\)/.test(providerCode)) {
    offenders.push('provider 가 apiModelIdFor 로 변환하지 않는다')
  }
  // 변환이 body 조립보다 앞이어야 한다
  const convAt = providerCode.indexOf('apiModelIdFor(req.model)')
  if (convAt === -1 || (bodyStart !== -1 && convAt > bodyStart)) {
    offenders.push('apiModelId 변환이 body 조립보다 뒤에 있다')
  }

  // ⑤ 🔴 cacheKey 는 **내부 라벨** 기준이다. apiModelId 가 아니다
  if (/apiModelId/.test(runCode)) offenders.push('run 이 apiModelId 를 다룬다 — provider 전용이어야 한다')
  const ckAt = runCode.indexOf('buildCacheKey({')
  const ckBlock = ckAt === -1 ? '' : runCode.slice(ckAt, ckAt + 400)
  if (ckAt === -1) offenders.push('run 에서 buildCacheKey 호출을 찾지 못했다')
  if (!/model: modelForKey/.test(ckBlock)) offenders.push('cacheKey 가 내부 라벨(modelForKey)을 쓰지 않는다')
  if (/apiModelId/.test(ckBlock)) offenders.push('🔴 cacheKey 에 apiModelId 가 들어간다')
  // 라벨과 apiModelId 는 서로 다른 키를 낸다 — 섞이면 실험 비교가 무너진다
  const base = {
    origin: 'unao_cafe', sourceRef: 'abc', contentHash: null,
    ruleVersion: 'r1', taskVersion: M3_TASK_VERSION,
    promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
  }
  const kLabel = buildCacheKey({ ...base, model: 'claude-haiku-4.5' })
  const kApi = buildCacheKey({ ...base, model: 'claude-haiku-4-5-20251001' })
  if (kLabel === kApi) offenders.push('라벨과 apiModelId 가 같은 cacheKey 를 낸다')
  // 🔴 기존 nano 캐시 키가 흔들리면 안 된다 — 30건 기준선이 무효가 된다
  const kNanoLabel = buildCacheKey({ ...base, model: 'gpt-5-nano' })
  if (kNanoLabel === kLabel) offenders.push('모델이 달라도 같은 키가 나온다')

  // ⑥ 단가 조회는 여전히 **내부 라벨**로 한다
  if (pricingFor('claude-haiku-4.5').inputPerMTok !== 1.0) offenders.push('라벨로 단가를 못 찾는다')

  if (offenders.length) bad('내부 라벨 ≠ provider 모델 ID', 'guard', `🔴 ${offenders.join(' / ')}`)
  else {
    ok('내부 라벨 ≠ provider 모델 ID', 'guard',
      `후보 ${Object.keys(M3_MODEL_CANDIDATES).length}종 전부 apiModelId · body 양쪽 apiModelId 경유 · ` +
      `haiku→${apiModelIdFor('claude-haiku-4.5')} · cacheKey 는 라벨 유지`)
  }
}

// ── ㉚ Anthropic assistant prefill · 프롬프트 불변 ───────
//    🔴 2026-08-27: Haiku 응답이 ```json 울타리에 감싸여 5건 전부 버려졌다.
//       응답은 정상이었고(finish=end_turn · 잘림 0) 판정 내용도 있었다 —
//       품질 실패가 아니라 출력 형식 문제다. prefill 로 구조적으로 막는다.
{
  const offenders: string[] = []

  // ① prefill 값 자체
  if (ANTHROPIC_JSON_PREFILL !== '{') offenders.push(`prefill 이 "${ANTHROPIC_JSON_PREFILL}"`)
  // 🔴 Anthropic 은 뒤쪽 공백이 붙은 prefill 을 400 으로 거부한다
  if (ANTHROPIC_JSON_PREFILL !== ANTHROPIC_JSON_PREFILL.trimEnd()) {
    offenders.push('prefill 끝에 공백이 있다 — Anthropic 이 400 으로 거부한다')
  }

  // ② 🔴 Anthropic 요청에만 assistant prefill 이 붙는다
  const bodyStart = providerCode.indexOf('const body = isAnthropic')
  const bodyEnd = providerCode.indexOf('const res = await fetch', bodyStart)
  const bodyBlock = bodyStart === -1 ? '' : providerCode.slice(bodyStart, bodyEnd === -1 ? bodyStart + 1200 : bodyEnd)
  if (bodyStart === -1) offenders.push('provider 의 body 조립부를 찾지 못했다')
  // Anthropic 분기(max_tokens)와 OpenAI 분기(max_completion_tokens)를 갈라서 본다
  const antAt = bodyBlock.indexOf('max_tokens:')
  const oaiAt = bodyBlock.indexOf('max_completion_tokens:')
  if (antAt === -1 || oaiAt === -1 || antAt > oaiAt) offenders.push('두 provider 분기를 구분하지 못했다')
  else {
    const ant = bodyBlock.slice(antAt, oaiAt)
    const oai = bodyBlock.slice(oaiAt)
    if (!/role:\s*'assistant'/.test(ant)) offenders.push('Anthropic 요청에 assistant prefill 이 없다')
    if (!/content:\s*ANTHROPIC_JSON_PREFILL/.test(ant)) offenders.push('prefill 이 상수를 쓰지 않는다')
    // 🔴 OpenAI 쪽에는 붙지 않아야 한다 — nano 기준선을 흔들면 안 된다
    if (/role:\s*'assistant'/.test(oai)) offenders.push('🔴 OpenAI 요청에 불필요한 assistant prefill 이 있다')
    // user 메시지가 prefill 보다 앞이어야 한다
    const uAt = ant.indexOf("role: 'user'")
    const aAt = ant.indexOf("role: 'assistant'")
    if (uAt === -1 || aAt === -1 || uAt > aAt) offenders.push('prefill 이 user 메시지보다 앞에 있다')
  }

  // ③ 🔴 prefill 을 쓰면 응답에 여는 `{` 가 없다 — 다시 붙여야 한다
  if (!/ANTHROPIC_JSON_PREFILL \+ continuation/.test(providerCode)) {
    offenders.push('응답에 prefill 을 재조립하지 않는다 — 이번엔 not_json 으로 전멸한다')
  }
  // 재조립은 유출 대조 대상인 rawText 로 이어져야 한다
  if (!/rawText: text\b/.test(providerCode)) offenders.push('재조립된 text 가 rawText 로 가지 않는다')

  // ④ 🔴 프롬프트는 바뀌지 않았다
  if (M3_PROMPT_VERSION !== 'voice-m3-prompt-v1') {
    offenders.push(`M3_PROMPT_VERSION 이 ${M3_PROMPT_VERSION} — nano 30건 기준선이 무효가 된다`)
  }
  // 버전만 보면 부족하다. **문구가 바뀌고 버전이 그대로면 더 위험하다** —
  // 같은 cacheKey 에 다른 프롬프트 결과가 섞인다. 문구 자체를 해시로 잠근다.
  const INSTRUCTION_SHA = '3afd99f33925e9a5'
  const got = createHash('sha256').update(buildInstruction(), 'utf8').digest('hex').slice(0, 16)
  if (got !== INSTRUCTION_SHA) {
    offenders.push(
      `프롬프트 문구가 바뀌었다 (sha ${got} ≠ ${INSTRUCTION_SHA}) — ` +
      'M3_PROMPT_VERSION 과 이 해시를 함께 올려야 한다',
    )
  }

  // ⑤ 🔴 파서를 관대하게 만들지 않았다
  if (classifyJsonFailure('```json\n{"a":1}\n```') !== 'fenced') offenders.push('fenced 를 분류하지 못한다')
  for (const [pat, why] of [
    [/replace\([^)]*```/, '울타리를 문자열 치환으로 벗긴다'],
    [/```json/, '울타리 리터럴을 다룬다'],
    [/stripFence|unfence|stripCodeBlock/i, '울타리 제거 함수'],
    [/trim\(\)\.replace\(/, '응답을 다듬어 파싱한다'],
  ] as Array<[RegExp, string]>) {
    if (pat.test(runCode)) offenders.push(`run 에 ${why}`)
    if (pat.test(providerCode)) offenders.push(`provider 에 ${why}`)
  }
  // 파싱은 여전히 원문 그대로여야 한다
  if (!/JSON\.parse\(response\.rawText\)/.test(runCode)) offenders.push('rawText 를 그대로 파싱하지 않는다')

  if (offenders.length) bad('Anthropic prefill · 프롬프트 불변', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('Anthropic prefill · 프롬프트 불변', 'guard',
    `prefill="${ANTHROPIC_JSON_PREFILL}" Anthropic 만 · 응답 재조립 · promptVersion ${M3_PROMPT_VERSION} · 문구 sha ${INSTRUCTION_SHA} · 파서 관대화 0`)
}

// ── ㉛ gpt-5-mini 후보 · provider 분기 정합 ─────────────
//    🔴 1차 30건에서 haiku 가 경계 사례 판별에 앞섰지만 비용이 nano 의 4.3배였다.
//       중간 후보를 넣는다. 후보가 늘수록 **표 세 개가 어긋날 위험**이 커진다 —
//       단가 · 출력 정책 · provider key/엔드포인트가 각각 다른 곳에 있다.
{
  const offenders: string[] = []
  const LABELS = Object.keys(M3_MODEL_CANDIDATES)

  // ① gpt-5-mini 가 후보에 있고 값이 맞는가
  const mini = (M3_MODEL_CANDIDATES as Record<string, {
    apiModelId?: string; inputPerMTok?: number; outputPerMTok?: number
    source?: string; checkedAt?: string
  }>)['gpt-5-mini']
  if (!mini) offenders.push('gpt-5-mini 가 후보에 없다')
  else {
    if (mini.apiModelId !== 'gpt-5-mini') offenders.push(`gpt-5-mini apiModelId 가 ${mini.apiModelId}`)
    if (mini.inputPerMTok !== 0.25) offenders.push(`gpt-5-mini 입력 단가가 ${mini.inputPerMTok}`)
    if (mini.outputPerMTok !== 2.0) offenders.push(`gpt-5-mini 출력 단가가 ${mini.outputPerMTok}`)
  }

  // ② 🔴 후보 전원이 단가 출처 · 확인일 · apiModelId 를 갖는다
  for (const label of LABELS) {
    const c = (M3_MODEL_CANDIDATES as Record<string, Record<string, unknown>>)[label]
    for (const f of ['apiModelId', 'source', 'checkedAt']) {
      if (typeof c[f] !== 'string' || String(c[f]).trim() === '') offenders.push(`${label} 에 ${f} 없음`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.checkedAt ?? ''))) offenders.push(`${label} checkedAt 형식이 아니다`)
    if (!String(c.source ?? '').startsWith('https://')) offenders.push(`${label} source 가 URL 이 아니다`)
  }

  // ③ 🔴 세 표가 같은 모델 집합을 덮는가.
  //    후보에만 있고 key/엔드포인트에 없으면 **호출 순간 undefined 로 터진다.**
  const keyEnv = Object.keys(PROVIDER_KEY_ENV)
  const endpointLabels = [...providerCode.matchAll(/^\s*'([^']+)':\s*'https:\/\/[^']+'/gm)].map((m) => m[1])
  for (const label of LABELS) {
    if (!keyEnv.includes(label)) offenders.push(`${label} 이 PROVIDER_KEY_ENV 에 없다`)
    if (!endpointLabels.includes(label)) offenders.push(`${label} 이 ENDPOINT 에 없다`)
    let ok2 = true
    try { outputTokenPolicyFor(label) } catch { ok2 = false }
    if (!ok2) offenders.push(`${label} 이 M3_OUTPUT_TOKEN_POLICY 에 없다`)
  }
  for (const k of keyEnv) if (!LABELS.includes(k)) offenders.push(`PROVIDER_KEY_ENV 에만 있는 모델: ${k}`)

  // ④ 🔴 gpt-5-mini 는 OpenAI 분기로 가야 한다
  if (PROVIDER_KEY_ENV['gpt-5-mini' as keyof typeof PROVIDER_KEY_ENV] !== 'OPENAI_API_KEY') {
    offenders.push('gpt-5-mini 가 OPENAI_API_KEY 를 쓰지 않는다')
  }
  // 엔드포인트 대조 — provider 파일에서 라벨별 URL 을 직접 읽는다
  const urlOf = (label: string): string =>
    new RegExp(`'${label.replace('.', '\\.')}':\\s*'(https://[^']+)'`).exec(providerCode)?.[1] ?? ''
  if (!urlOf('gpt-5-mini').includes('api.openai.com')) offenders.push('gpt-5-mini 엔드포인트가 OpenAI 가 아니다')
  if (!urlOf('gpt-5-nano').includes('api.openai.com')) offenders.push('gpt-5-nano 엔드포인트가 바뀌었다')
  if (!urlOf('claude-haiku-4.5').includes('api.anthropic.com')) offenders.push('haiku 엔드포인트가 바뀌었다')

  // ⑤ 🔴 `isAnthropic` 판정이 엔드포인트와 어긋나지 않는가.
  //    판정은 문자열 하나(`req.model === '...'`)에 의존한다. 후보가 늘수록
  //    "anthropic 엔드포인트인데 OpenAI 분기로 가는" 모델이 생길 위험이 커진다.
  const antLabel = /isAnthropic = req\.model === '([^']+)'/.exec(providerCode)?.[1] ?? ''
  if (antLabel === '') offenders.push('isAnthropic 판정을 찾지 못했다')
  else {
    const byEndpoint = LABELS.filter((l) => urlOf(l).includes('api.anthropic.com'))
    if (byEndpoint.length !== 1 || byEndpoint[0] !== antLabel) {
      offenders.push(
        `isAnthropic 판정('${antLabel}')과 anthropic 엔드포인트 모델(${byEndpoint.join(',') || '없음'})이 다르다`,
      )
    }
  }

  // ⑥ cacheKey 는 내부 라벨 — 세 모델이 서로 다른 키를 낸다
  const base = {
    origin: 'unao_cafe', sourceRef: 'abc', contentHash: null,
    ruleVersion: 'r1', taskVersion: M3_TASK_VERSION,
    promptVersion: M3_PROMPT_VERSION, outputSchemaVersion: M3_OUTPUT_SCHEMA_VERSION,
  }
  const keys = LABELS.map((l) => buildCacheKey({ ...base, model: l }))
  if (new Set(keys).size !== LABELS.length) offenders.push('모델이 달라도 같은 cacheKey 가 나온다')
  // 🔴 apiModelId 로는 키를 만들지 않는다 — mini 는 라벨과 값이 같아 이 검사가 무의미하므로 haiku 로 본다
  if (buildCacheKey({ ...base, model: 'claude-haiku-4.5' }) === buildCacheKey({ ...base, model: apiModelIdFor('claude-haiku-4.5') })) {
    offenders.push('라벨과 apiModelId 가 같은 키를 낸다')
  }

  // ⑦ 🔴 API key 는 이름만 다룬다 — 새 모델에서도 값이 새지 않는다
  const st = keyStatus('gpt-5-mini')
  if (st.envName !== 'OPENAI_API_KEY') offenders.push(`gpt-5-mini keyStatus envName 이 ${st.envName}`)
  if (Object.keys(st).some((k) => !['envName', 'present'].includes(k))) offenders.push('keyStatus 가 값을 노출한다')
  if (typeof st.present !== 'boolean') offenders.push('present 가 boolean 이 아니다')

  if (offenders.length) bad('gpt-5-mini 후보 · provider 분기', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('gpt-5-mini 후보 · provider 분기', 'guard',
    `후보 ${LABELS.length}종(${LABELS.join(' · ')}) · 단가·정책·key·엔드포인트 전부 정합 · ` +
    `mini→OpenAI $${mini?.inputPerMTok}/$${mini?.outputPerMTok} · cacheKey ${new Set(keys).size}/${LABELS.length} 고유`)
}

// ── ㉜ 분석 모델 확정 — 기록이지 기본값이 아니다 ────────
//    🔴 2026-08-27: 30건 3-way 비교 후 claude-haiku-4.5 로 확정했다.
//       확정을 **기본값으로 바꾸면 유료 게이트가 하나 사라진다** — 그것을 막는다.
{
  const offenders: string[] = []

  // ① 확정값
  if (M3_ANALYSIS_MODEL !== 'claude-haiku-4.5') offenders.push(`분석 모델이 ${M3_ANALYSIS_MODEL}`)
  // ② 확정 모델은 후보 · 단가 · 출력 정책 · key 를 전부 갖춰야 한다
  if (!(M3_ANALYSIS_MODEL in M3_MODEL_CANDIDATES)) offenders.push('확정 모델이 후보에 없다')
  for (const [fn, label] of [
    [(): unknown => pricingFor(M3_ANALYSIS_MODEL), '단가'],
    [(): unknown => outputTokenPolicyFor(M3_ANALYSIS_MODEL), '출력 정책'],
    [(): unknown => apiModelIdFor(M3_ANALYSIS_MODEL), 'apiModelId'],
  ] as Array<[() => unknown, string]>) {
    try { fn() } catch { offenders.push(`확정 모델에 ${label} 가 없다`) }
  }
  if (keyStatus(M3_ANALYSIS_MODEL).envName !== 'ANTHROPIC_API_KEY') {
    offenders.push('확정 모델의 key 환경변수가 다르다')
  }

  // ③ 🔴 **기본값으로 쓰이지 않는다.** 폴백이 생기면 `--model` 게이트가 무력해진다
  for (const [pat, why] of [
    [/MODEL \?\? M3_ANALYSIS_MODEL/, 'MODEL 폴백'],
    [/M3_ANALYSIS_MODEL[\s\S]{0,40}\?\?/, 'ANALYSIS_MODEL 을 기본값으로'],
    [/model\s*=\s*M3_ANALYSIS_MODEL/, 'model 에 직접 대입'],
    [/arg\('model'\)\s*\?\?/, '--model 에 기본값'],
  ] as Array<[RegExp, string]>) {
    if (pat.test(runCode)) offenders.push(`run 에 ${why} — 유료 게이트가 사라진다`)
  }
  // run 은 확정 모델을 아예 참조하지 않아야 한다
  if (/M3_ANALYSIS_MODEL/.test(runCode)) offenders.push('run 이 확정 모델 상수를 참조한다')
  // 🔴 게이트는 여전히 --model 을 요구한다
  const gs = runCode.indexOf('function paidCallGate')
  const ge = runCode.indexOf('\nasync function main', gs)
  const gate = gs === -1 ? '' : runCode.slice(gs, ge === -1 ? gs + 2000 : ge)
  if (!/blocked\.push[\s\S]{0,60}--model/.test(gate)) offenders.push('게이트가 --model 을 여전히 막지 않는다')

  // ④ 🔴 분석 모델과 생성 모델을 섞지 않는다 — 이름과 주석이 그것을 말해야 한다
  const contractRaw = readFileSync(CONTRACT_LIB, 'utf-8')
  const at = contractRaw.indexOf('export const M3_ANALYSIS_MODEL')
  const doc = at === -1 ? '' : contractRaw.slice(Math.max(0, at - 1800), at)
  if (!/분석|판정/.test(doc)) offenders.push('확정 상수에 "분석 · 판정 전용" 설명이 없다')
  if (!/생성|별도 실험/.test(doc)) offenders.push('생성 모델은 별도라는 경계 설명이 없다')
  // 생성 모델을 이 상수로 정한 흔적이 없어야 한다
  if (/GENERATION_MODEL|WRITER_MODEL/.test(contractRaw)) offenders.push('생성 모델 상수가 섞였다')

  if (offenders.length) bad('분석 모델 확정 · 기본값 아님', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('분석 모델 확정 · 기본값 아님', 'policy',
    `${M3_ANALYSIS_MODEL} 확정 · 후보·단가·정책·key 정합 · run 참조 0 · --model 게이트 유지`)
}

// ── ㉝ 전량 계획 리포트는 유료 경로가 없다 (VE-M3-5) ────
//    🔴 전량은 193회의 실행이다. 계획을 세우는 명령에 유료 경로가 섞이면
//       "계획만 볼 생각" 이 9,644건 호출로 바뀔 수 있다. 플래그 자체를 없앤다.
{
  const offenders: string[] = []

  // ① 🔴 유료 플래그를 **받지 않는다**. "무시한다" 가 아니라 파싱 코드가 없다.
  //
  //    🔴 **console.log 줄은 대상에서 뺀다.** plan 은 "승인 후 이렇게 실행한다" 를
  //       안내해야 하고, 그 문구에는 플래그 이름이 들어간다 — 안내를 위반으로 읽으면
  //       가드가 정당한 코드를 막는다(실제로 걸렸다). 검사할 것은 **argv 파싱**이다.
  const planLogic = planCode.split('\n').filter((l) => !/console\.(log|error)/.test(l)).join('\n')
  for (const [pat, why] of [
    [/argv\.includes\(\s*'--apply'/, '--apply 를 파싱한다'],
    [/argv\.includes\(\s*'--confirm-paid-call'/, '--confirm-paid-call 을 파싱한다'],
    [/\bAPPLY\b|\bCONFIRM_PAID\b/, '유료 플래그 변수를 둔다'],
    [/arg\('(apply|confirm-paid-call)'\)/, '유료 플래그를 arg 로 읽는다'],
  ] as Array<[RegExp, string]>) {
    if (pat.test(planLogic)) offenders.push(`plan 이 ${why}`)
  }
  for (const [pat, why] of [
    [/callProvider/, 'provider 를 부른다'],
    [/voice-m3-provider/, 'provider 를 import 한다'],
    [/(await|return|=)\s+fetch\s*\(/, 'fetch 호출'],
    [/keyStatus|API_KEY/, 'API key 를 다룬다'],
  ] as Array<[RegExp, string]>) {
    if (pat.test(planCode)) offenders.push(`plan 이 ${why}`)
  }

  // ② 🔴 DB write 0 — 계획은 읽기만 한다
  for (const m of ['voiceM3Run', 'voiceM3Cache', 'voiceM3CostEvent', 'voiceSource', 'voiceDerived',
    'voiceCommentSignal', 'voiceJudgment', 'microSeedCandidate', 'microSeedRawContent']) {
    for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
      if (new RegExp(`${m}\\.${op}\\s*\\(`).test(planCode)) offenders.push(`plan 이 ${m}.${op}`)
    }
  }
  if (/\$executeRaw|\$queryRaw/.test(planCode)) offenders.push('plan 에 raw SQL')
  // Sheet · 크롤링 접점 0
  for (const t of ['micro-seed-sheet', 'planSheetWrite', 'appendRow', 'publishLive']) {
    if (planCode.includes(t)) offenders.push(`plan 에 ${t}`)
  }

  // ③ 🔴 원문을 읽지 않는다 — 계획에 필요한 것은 길이와 개수뿐이다
  for (const [pat, why] of [
    [/\bcontent\s*:\s*true/, 'content 를 select 한다'],
    [/topComments/, '댓글 원문을 다룬다'],
    [/CafePost/, '우나어 원문 테이블을 조회한다'],
  ] as Array<[RegExp, string]>) {
    if (pat.test(planCode)) offenders.push(`plan 이 ${why}`)
  }

  // ④ 확정 모델을 쓰되 실행하지는 않는다
  if (!/M3_ANALYSIS_MODEL/.test(planCode)) offenders.push('plan 이 확정 모델을 참조하지 않는다')
  if (!/pricingFor|outputTokenPolicyFor/.test(planCode)) offenders.push('plan 이 단가 · 출력 정책을 쓰지 않는다')

  // ⑤ 🔴 cap 판정은 **최악값**으로 한다 — 실측 평균으로 하면 cap 이 늦게 걸린다.
  //    🔴 파일 어딘가에 `policy.maxOutputTokens` 가 있는 것으로는 부족하다 —
  //       시나리오 표에도 같은 이름이 쓰이므로 batch 계산이 실측 평균으로 바뀌어도 통과한다
  //       (역검증에서 실제로 뚫렸다). **batch 루프 본문**을 잘라 그 안을 본다.
  const bs = planCode.indexOf('for (let i = 0; i < pending.length; i += BATCH)')
  const be = planCode.indexOf('const overCap', bs)
  const batchBody = bs === -1 ? '' : planCode.slice(bs, be === -1 ? bs + 900 : be)
  if (bs === -1) offenders.push('batch 분할 루프를 찾지 못했다')
  else {
    if (!/policy\.maxOutputTokens/.test(batchBody)) offenders.push('batch cap 판정에 출력 상한을 쓰지 않는다')
    // 🔴 `[^;]*` 는 줄바꿈을 넘어 다음 줄의 같은 상수까지 먹는다 — 정상 코드를 오탐했다.
    //    같은 줄로 제한한다.
    if (/bout\s*=\s*[^;\n]*MEASURED_OUTPUT_PER_ITEM/.test(batchBody)) {
      offenders.push('🔴 batch cap 판정이 실측 평균이다 — cap 이 늦게 걸린다')
    }
  }
  if (!/M3_CAPS\.tokenCap/.test(planCode)) offenders.push('plan 이 tokenCap 을 검사하지 않는다')
  if (!/M3_CAPS\.dollarCap/.test(planCode)) offenders.push('plan 이 dollarCap 을 검사하지 않는다')
  // batch 는 itemLimit 을 넘을 수 없다
  if (!/BATCH > M3_CAPS\.itemLimit/.test(planCode)) offenders.push('batch 가 itemLimit 을 넘을 수 있다')

  // ⑥ 🔴 전량 실행 경로가 아직 없다는 사실을 리포트가 말해야 한다.
  //    말하지 않으면 "계획이 나왔으니 돌리면 되겠다" 로 읽힌다
  if (!/전량을 돌 수 없다|selectStratifiedSample/.test(planCode)) {
    offenders.push('plan 이 실행 경로 부재를 경고하지 않는다')
  }
  // run 은 여전히 층화 표본이다 — 경고가 사실인지 대조한다
  if (!/selectStratifiedSample\(candidates, LIMIT\)/.test(runCode)) {
    offenders.push('run 의 표본 선정이 바뀌었다 — plan 의 경고를 갱신해야 한다')
  }

  if (offenders.length) bad('전량 계획 리포트 유료 경로 0', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('전량 계획 리포트 유료 경로 0', 'guard',
    'apply · confirm · provider · fetch · key 0 · DB write 0 · 원문 조회 0 · cap 최악값 판정 · 실행경로 부재 경고')
}

// ── ㉞ 전량 모드(--mode=full) — 좁은 기본값 · 게이트 유지 ─
//    🔴 전량 경로가 생기면 실험용 명령이 전량으로 새어 나갈 수 있다.
//       기본값을 좁게 두고, 게이트를 하나도 완화하지 않았는지 검사한다.
{
  const offenders: string[] = []

  // ① 🔴 기본값은 sample 이다 — full 이 기본이면 명령 하나가 전량으로 샌다
  if (!/const MODE = arg\('mode'\) \?\? 'sample'/.test(runCode)) {
    offenders.push('--mode 기본값이 sample 이 아니다')
  }
  if (!/\['sample', 'full'\]\.includes\(MODE\)/.test(runCode)) offenders.push('--mode 값 검증이 없다')

  // ② 🔴 full 은 **succeeded 만** 제외한다. failed · skipped 는 재시도로 남아야 한다
  const fs = runCode.indexOf("if (MODE === 'full')")
  const fe = runCode.indexOf('} else {', fs)
  const fullBlock = fs === -1 ? '' : runCode.slice(fs, fe === -1 ? fs + 900 : fe)
  if (fs === -1) offenders.push('full 분기를 찾지 못했다')
  else {
    if (!/status: 'succeeded'/.test(fullBlock)) offenders.push('full 이 succeeded 로 좁히지 않는다')
    // 🔴 `failed` 는 **절대** 제외 대상이 아니다. JSON_PARSE · HTTP · TIMEOUT 은
    //    고치면 달라지므로 재시도로 남아야 한다
    if (/status: 'failed'/.test(fullBlock)) offenders.push("full 제외 조건에 'failed' 가 섞였다 — 재시도 대상이 사라진다")
    if (/not:/.test(fullBlock)) offenders.push('full 제외 조건에 부정 필터가 섞였다 — 무엇이 빠지는지 알 수 없다')
    // 🔴 `skipped` 는 **종결 코드와 함께일 때만** 허용한다(2026-08-27).
    //    조건 없이 skipped 를 통째로 제외하면 FORBIDDEN_ADDRESS 처럼
    //    아직 판단하지 않은 실패까지 조용히 버려진다
    if (/status: 'skipped'/.test(fullBlock) && !/M3_TERMINAL_SKIP_CODES/.test(fullBlock)) {
      offenders.push("full 이 skipped 를 종결 코드 조건 없이 제외한다")
    }
    if (!/selectFullModeBatch/.test(fullBlock)) offenders.push('full 이 전용 선정 함수를 쓰지 않는다')
  }

  // ③ 🔴 유료 게이트는 full 에서도 그대로다
  const gs = runCode.indexOf('function paidCallGate')
  const ge = runCode.indexOf('\nasync function main', gs)
  const gate = gs === -1 ? '' : runCode.slice(gs, ge === -1 ? gs + 2000 : ge)
  for (const must of ['--apply', '--confirm-paid-call', '--model', '--stage', 'itemLimit', 'dollarCap', 'tokenCap', 'pricingFor', 'maxOutputTokensFor', 'keyStatus']) {
    if (!gate.includes(must)) offenders.push(`게이트에서 ${must} 가 사라졌다`)
  }
  // 게이트가 mode 로 우회되지 않는다
  if (/MODE\s*===\s*'full'/.test(gate)) offenders.push('🔴 게이트가 mode 를 본다 — 전량이 게이트를 우회할 수 있다')
  // cap 상수 불변
  if (M3_CAPS.itemLimit !== 50 || M3_CAPS.tokenCap !== 500_000 || M3_CAPS.dollarCap !== 5) {
    offenders.push(`cap 이 바뀌었다: item ${M3_CAPS.itemLimit} · token ${M3_CAPS.tokenCap} · dollar ${M3_CAPS.dollarCap}`)
  }
  // 🔴 확정 모델 폴백은 여전히 없다
  if (/M3_ANALYSIS_MODEL/.test(runCode)) offenders.push('run 이 확정 모델을 참조한다 — --model 게이트가 무력해진다')

  // ④ 🔴 잘린 글 제외 기준이 두 경로에서 같은가
  if (!/isExcluded/.test(sampleCode)) offenders.push('sample lib 에 isExcluded 가 없다')
  if (!/const usable = candidates\.filter\(\(c\) => !isExcluded\(c\)\)/.test(sampleCode)) {
    offenders.push('full 선정이 잘린 글을 제외하지 않는다 — 층화와 모집단이 달라진다')
  }
  if (!/TRUNCATED_LENGTH/.test(planCode)) offenders.push('plan 이 잘린 글을 제외하지 않는다 — batch 경계가 어긋난다')

  // ⑤ 동작 검증 — 실제로 돌려 본다
  const mk = (i: number, len: number): SampleCandidate => ({
    id: `id-${String(i).padStart(4, '0')}`, sourceRef: `ref-${i}`, sourceSite: 'navercafe:wgang',
    contentLength: len, commentCount: i % 20, legacyLabels: {},
    sourceSpecificCount: 0, targetDescriptorCount: 0, referenced: false,
    commentSignalTotal: 0, otherReactionCount: 0, truncatedCount: 0,
  })
  const pool = [
    ...Array.from({ length: 100 }, (_, i) => mk(i, 500)),
    ...Array.from({ length: 5 }, (_, i) => mk(1000 + i, 3000)), // 🔴 잘린 글
  ]
  const done = new Set(['ref-0', 'ref-1', 'ref-2'])
  const b1 = selectFullModeBatch(pool, done, 10)
  if (b1.excluded !== 5) offenders.push(`잘린 글 제외가 ${b1.excluded}건 (5건이어야)`)
  if (b1.remaining !== 97) offenders.push(`남은 대상이 ${b1.remaining}건 (100-3=97 이어야)`)
  if (b1.rows.length !== 10) offenders.push(`batch 가 ${b1.rows.length}건`)
  if (b1.rows.some((r) => done.has(r.sourceRef))) offenders.push('🔴 이미 성공한 건이 batch 에 들어갔다')
  if (b1.rows.some((r) => r.contentLength === 3000)) offenders.push('🔴 잘린 글이 batch 에 들어갔다')
  // id 오름차순 · 재현 가능
  const ids = b1.rows.map((r) => r.id)
  if (ids.join() !== [...ids].sort().join()) offenders.push('batch 가 id 오름차순이 아니다')
  if (selectFullModeBatch([...pool].reverse(), done, 10).rows.map((r) => r.id).join() !== ids.join()) {
    offenders.push('입력 순서가 batch 를 바꾼다 — 재개가 불가능해진다')
  }
  // 다음 batch 는 겹치지 않는다
  const b2 = selectFullModeBatch(pool, new Set([...done, ...b1.rows.map((r) => r.sourceRef)]), 10)
  if (b2.rows.some((r) => b1.rows.some((x) => x.sourceRef === r.sourceRef))) {
    offenders.push('🔴 다음 batch 가 이전 batch 와 겹친다')
  }
  if (b2.remaining !== 87) offenders.push(`두 번째 batch 의 남은 수가 ${b2.remaining} (87 이어야)`)

  if (offenders.length) bad('전량 모드 · 좁은 기본값 · 게이트 유지', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('전량 모드 · 좁은 기본값 · 게이트 유지', 'guard',
    'mode 기본 sample · succeeded 만 제외 · 잘린 글 제외 일치 · id 오름차순 재현 · batch 무겹침 · 게이트 10중 불변')
}

// ── ㉟ SOURCE_LEAK 은 종결 · 나머지 실패는 재시도 ────────
//    🔴 2026-08-27 전량 3번째 batch 에서 SOURCE_LEAK 1건이 나왔다.
//       가드는 정상 작동해 저장을 막았지만(output null), skipped 는 재시도 대상이라
//       **189 batch 내내 같은 글을 다시 부르며 돈만 쓴다.**
//       원인이 우리 쪽에 없는 실패는 종결로 본다 — 가드를 푸는 것이 아니다.
{
  const offenders: string[] = []

  // ① 종결 코드 목록
  // 🔴 종결 코드는 **모델 출력 문제 두 가지뿐**이다. 늘어나면 고칠 수 있는 것을 버리게 된다
  const WANT = ['SOURCE_LEAK', 'FORBIDDEN_ADDRESS']
  if (M3_TERMINAL_SKIP_CODES.length !== WANT.length
      || !WANT.every((c) => (M3_TERMINAL_SKIP_CODES as readonly string[]).includes(c))) {
    offenders.push(`종결 코드가 ${JSON.stringify(M3_TERMINAL_SKIP_CODES)} (${WANT.join(',')} 이어야)`)
  }
  for (const t of WANT) if (!isTerminalSkip(t)) offenders.push(`${t} 을 종결로 보지 않는다`)
  // 🔴 고치면 달라지는 실패는 종결이 아니다
  for (const retryable of ['JSON_PARSE', 'HTTP_429', 'HTTP_500', 'TIMEOUT', 'NETWORK', 'NO_FINISH_REASON']) {
    if (isTerminalSkip(retryable)) offenders.push(`🔴 ${retryable} 을 종결로 본다 — 고칠 수 있는 것을 버린다`)
  }
  if (isTerminalSkip(null)) offenders.push('errorCode 가 null 인데 종결로 본다')
  // 🔴 저장 차단은 그대로다 — 종결로 본다는 것이 "통과시킨다" 는 뜻이 아니다
  if (!/forbidden\.length > 0[\s\S]{0,200}skipped/.test(runCode)) {
    offenders.push('금지 호칭 검출 시 skipped 처리가 사라졌다')
  }
  if (!/errorCode = 'FORBIDDEN_ADDRESS'/.test(runCode)) offenders.push('FORBIDDEN_ADDRESS 코드 부여가 사라졌다')
  if (!/M3_FORBIDDEN_ADDRESS_TERMS\.filter/.test(runCode)) offenders.push('금지 호칭 대조가 사라졌다')

  // ② 🔴 full 이 SOURCE_LEAK skipped 를 **제외**하는가
  //    (제외하지 않으면 같은 글을 매 batch 다시 부른다)
  const fs2 = runCode.indexOf("if (MODE === 'full')")
  const fe2 = runCode.indexOf('} else {', fs2)
  const fullBlock2 = fs2 === -1 ? '' : runCode.slice(fs2, fe2 === -1 ? fs2 + 1400 : fe2)
  if (fs2 === -1) offenders.push('full 분기를 찾지 못했다')
  else {
    if (!/M3_TERMINAL_SKIP_CODES/.test(fullBlock2)) {
      offenders.push('🔴 full 이 종결 skip 을 제외하지 않는다 — 같은 글을 매 batch 다시 부른다')
    }
    if (!/status: 'skipped'/.test(fullBlock2)) offenders.push('full 제외 조건에 skipped 가 없다')
    if (!/OR:/.test(fullBlock2)) offenders.push('full 제외가 두 조건(succeeded · 종결 skip)을 합치지 않는다')
    // 🔴 failed 는 여전히 남아야 한다
    if (/status: 'failed'/.test(fullBlock2)) {
      offenders.push('🔴 full 이 failed 까지 제외한다 — JSON_PARSE · HTTP 가 재시도되지 않는다')
    }
    // errorCode 조건 없이 skipped 를 통째로 빼면 안 된다
    if (/status: 'skipped'\s*\}/.test(fullBlock2)) {
      offenders.push('skipped 를 errorCode 조건 없이 제외한다')
    }
  }

  // ③ 🔴 가드는 완화되지 않았다 — SOURCE_LEAK 은 여전히 저장을 막는다
  if (!/leak\.leaked[\s\S]{0,200}skipped/.test(runCode)) offenders.push('유출 시 skipped 처리가 사라졌다')
  if (!/errorCode = 'SOURCE_LEAK'/.test(runCode)) offenders.push('SOURCE_LEAK 코드 부여가 사라졌다')
  // output 은 계속 null
  if (!/status === 'succeeded' && output !== undefined \? output : Prisma\.DbNull/.test(runCode)) {
    offenders.push('🔴 실패 · skip 에도 output 이 저장될 수 있다')
  }
  // 20자 임계값 불변
  if (M3_LEAK_RUN_MIN !== 20) offenders.push(`유출 임계값이 ${M3_LEAK_RUN_MIN} 자로 바뀌었다`)
  // 🔴 원문 조각을 잘라 저장하거나 파서를 관대하게 만들지 않았다
  for (const [pat, why] of [
    [/leak[\s\S]{0,60}slice\(/, '유출 부분을 잘라 저장한다'],
    [/rawText\.replace\(/, '응답을 치환해 통과시킨다'],
    // 🔴 `minRun:` 형태만 보면 **위치 인자를 놓친다.**
    //    `assertNoSourceLeak(text, sources, 999)` 로 임계값을 밀어 올릴 수 있고,
    //    역검증에서 실제로 뚫렸다. 인자 개수를 본다 — 세 번째 인자는 minRun 이다.
    [/assertNoSourceLeak\([^()]*,[^()]*,/, '유출 임계값을 호출부에서 넘긴다'],
    [/minRun\s*[:=]\s*(?!M3_LEAK_RUN_MIN)\d+/, '유출 임계값을 호출부에서 바꾼다'],
  ] as Array<[RegExp, string]>) {
    if (pat.test(runCode)) offenders.push(`run 이 ${why}`)
  }
  // 대조는 저장보다 앞
  const la = runCode.indexOf('assertNoSourceLeak('), sa = runCode.indexOf('voiceM3Cache.upsert(')
  if (la === -1 || sa === -1 || la > sa) offenders.push('유출 대조가 저장 뒤로 밀렸다')

  // ④ plan · 문서가 같은 정의를 쓰는가
  if (!/M3_TERMINAL_SKIP_CODES|SOURCE_LEAK/.test(planCode)) {
    offenders.push('plan 이 종결 skip 을 대상 산정에서 다루지 않는다')
  }

  if (offenders.length) bad('SOURCE_LEAK 종결 · 나머지는 재시도', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('SOURCE_LEAK 종결 · 나머지는 재시도', 'policy',
    `종결 ${M3_TERMINAL_SKIP_CODES.join(',')} 만 · failed 재시도 유지 · 20자 가드 불변 · output null 유지`)
}

// ── ㊱ HTTP_529 는 재시도 · 종결은 그대로 ────────────────
//    🔴 2026-08-28: 503 은 재시도하면서 529 만 빠져 있어 batch 가 불필요하게 멈췄다.
//       둘 다 "서버가 지금 바쁘다" 는 같은 말이다. 실측 3,927건 중 3건 · 토큰 0 · 과금 0.
{
  const offenders: string[] = []

  // ① 재시도 목록 — 다섯 종 정확히
  const WANT = ['HTTP_429', 'HTTP_503', 'HTTP_529', 'TIMEOUT', 'NETWORK']
  if (M3_RETRYABLE_ERROR_CODES.length !== WANT.length
      || !WANT.every((c) => (M3_RETRYABLE_ERROR_CODES as readonly string[]).includes(c))) {
    offenders.push(`재시도 목록이 ${JSON.stringify(M3_RETRYABLE_ERROR_CODES)} (${WANT.join(',')} 이어야)`)
  }
  for (const c of WANT) if (!isRetryable(c)) offenders.push(`${c} 를 재시도하지 않는다`)
  // 🔴 529 는 이번에 추가한 것이므로 따로 못 박는다
  if (!isRetryable('HTTP_529')) offenders.push('🔴 HTTP_529 를 재시도하지 않는다 — batch 가 불필요하게 멈춘다')
  if (isRetryable(null)) offenders.push('errorCode 가 null 인데 재시도로 본다')

  // ② 🔴 종결 · 모델 출력 문제는 batch 안에서 재시도하지 않는다
  for (const c of ['SOURCE_LEAK', 'FORBIDDEN_ADDRESS']) {
    if (isRetryable(c)) offenders.push(`🔴 ${c} 를 batch 안에서 재시도한다 — 종결이어야 한다`)
    if (!isTerminalSkip(c)) offenders.push(`${c} 종결 정책이 깨졌다`)
  }
  for (const c of ['JSON_PARSE', 'NO_FINISH_REASON']) {
    if (isRetryable(c)) offenders.push(`🔴 ${c} 를 batch 안에서 즉시 재시도한다 — 다음 batch 캐시 재시도여야 한다`)
    if (isTerminalSkip(c)) offenders.push(`${c} 를 종결로 본다 — 고칠 수 있는 것을 버린다`)
  }
  // 두 목록이 겹치면 안 된다
  for (const c of M3_RETRYABLE_ERROR_CODES) {
    if ((M3_TERMINAL_SKIP_CODES as readonly string[]).includes(c)) offenders.push(`${c} 가 재시도와 종결 양쪽에 있다`)
  }

  // ③ run 이 상수를 쓰는가 — 인라인 배열이 남아 있으면 두 곳이 어긋난다
  if (!/isRetryable\(response\.errorCode\)/.test(runCode)) offenders.push('run 이 isRetryable 을 쓰지 않는다')
  if (/\['HTTP_429'[^\]]*\]\.includes/.test(runCode)) offenders.push('run 에 인라인 재시도 배열이 남아 있다')
  // 재시도는 cap 안에서만
  if (!/retry < M3_CAPS\.maxRetry/.test(runCode)) offenders.push('재시도가 maxRetry cap 밖으로 나갔다')
  // 재시도도 CostEvent 에 남는다
  if (!/eventType: 'retry'/.test(runCode)) offenders.push('재시도를 CostEvent 에 남기지 않는다')
  if (!/retryAttempt: priorCalls \+ retry/.test(runCode)) offenders.push('retryAttempt 누적이 깨졌다')

  // ④ 🔴 다른 정책은 하나도 건드리지 않았다
  if (M3_LEAK_RUN_MIN !== 20) offenders.push(`유출 임계값이 ${M3_LEAK_RUN_MIN}`)
  if (!/assertNoSourceLeak\(/.test(runCode)) offenders.push('유출 대조가 사라졌다')
  if (/assertNoSourceLeak\([^()]*,[^()]*,/.test(runCode)) offenders.push('유출 임계값을 호출부에서 넘긴다')
  if (!/M3_FORBIDDEN_ADDRESS_TERMS\.filter/.test(runCode)) offenders.push('금지 호칭 대조가 사라졌다')
  if (!/status === 'succeeded' && output !== undefined \? output : Prisma\.DbNull/.test(runCode)) {
    offenders.push('실패 · skip 에도 output 이 저장될 수 있다')
  }
  if (!/k\.present \? 'OK' : '없음'/.test(runCode)) offenders.push('API key 로그 정책이 바뀌었다')

  if (offenders.length) bad('HTTP_529 재시도 · 종결 불변', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('HTTP_529 재시도 · 종결 불변', 'guard',
    `재시도 ${M3_RETRYABLE_ERROR_CODES.length}종(529 포함) · 종결 ${M3_TERMINAL_SKIP_CODES.length}종 · 겹침 0 · JSON_PARSE 는 캐시 재시도 · 가드 불변`)
}

// ── ㊲ export 에 유료 · write 경로가 없다 ────────────────
//    🔴 export 는 "읽어서 파일로 쓴다" 가 전부다. 그 밖의 능력이 생기면 안 된다.
{
  const offenders: string[] = []

  // provider · LLM · 유료 플래그 — 존재 자체가 위반이다
  if (/voice-m3-provider/.test(exportCode)) offenders.push('🔴 provider 를 import 한다')
  if (/callProvider|anthropic|openai|api\.anthropic|api\.openai/i.test(exportCode)) offenders.push('🔴 LLM 호출 흔적')
  for (const flag of ['apply', 'confirm-paid-call']) {
    if (new RegExp(`includes\\(['\`]--${flag}|--${flag}=`).test(exportCode)) offenders.push(`🔴 ${flag} 플래그를 받는다`)
  }
  // 🔴 DB write — 메서드 호출만 잡는다(문자열 · 주석 아님)
  for (const m of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'executeRaw']) {
    if (new RegExp(`prisma\\.[A-Za-z0-9_]+\\.${m}\\(`).test(exportCode)) offenders.push(`🔴 prisma ${m} 호출`)
  }
  // 우나어 DB 는 유출 재검사에만 — 쓰기 SQL 이 있으면 안 된다
  if (/unao\.query\(\s*['"`]\s*(INSERT|UPDATE|DELETE)/i.test(exportCode)) offenders.push('🔴 우나어 DB 에 쓰기 SQL')

  // 컬럼 화이트리스트에 금지 컬럼이 섞였는가
  const cols = /const SIGNAL_COLUMNS = \[([\s\S]*?)\] as const/.exec(exportCode)?.[1] ?? ''
  const skCols = /const SKIPPED_COLUMNS = \[([\s\S]*?)\] as const/.exec(exportCode)?.[1] ?? ''
  if (cols === '' || skCols === '') offenders.push('컬럼 화이트리스트를 찾을 수 없다')
  for (const key of ['sourceUrl', 'content', 'topComments', 'errorMessage', 'cacheKey', 'contentHash', 'legacyLabels', 'authorHash', 'title']) {
    if (new RegExp(`['"\`]${key}['"\`]`).test(cols)) offenders.push(`🔴 signals 컬럼에 ${key}`)
    if (new RegExp(`['"\`]${key}['"\`]`).test(skCols)) offenders.push(`🔴 skipped 컬럼에 ${key}`)
  }
  // select 절에도 금지 컬럼이 없어야 한다
  for (const key of ['sourceUrl', 'errorMessage', 'legacyLabels', 'authorHash']) {
    if (new RegExp(`${key}:\\s*true`).test(exportCode)) offenders.push(`🔴 select 에 ${key}: true`)
  }

  if (offenders.length) bad('export 유료 · write 경로 0', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('export 유료 · write 경로 0', 'guard',
    'provider import 0 · LLM 0 · 유료 플래그 0 · prisma write 0 · 금지 컬럼 0')
}

// ── ㊳ export 는 유출 검사를 통과해야만 파일을 쓴다 ──────
//    🔴 "검사한다" 가 아니라 **"걸리면 안 쓴다"** 를 검사한다.
//       위반 행만 빼고 내보내면 통과한 export 라는 잘못된 신뢰가 생긴다.
{
  const offenders: string[] = []

  if (M3_LEAK_RUN_MIN !== 20) offenders.push(`유출 임계값이 ${M3_LEAK_RUN_MIN}`)
  if (!/assertNoSourceLeak\(/.test(exportCode)) offenders.push('유출 대조가 없다')
  /**
   * 🔴 임계값을 호출부에서 넘기면 완화할 수 있다 — 인자 3개 금지.
   *    run 은 `assertNoSourceLeak(a, b)` 라 정규식으로 됐지만 export 는 인자 안에
   *    `String(...)` · `topCommentsToText(...)` 가 들어간다. `[^()]*` 는 거기서 끊긴다.
   *    **괄호 깊이를 세서 최상위 콤마만 센다.**
   */
  const topLevelArgCount = (code: string, at: number): number => {
    let depth = 0
    let commas = 0
    for (let i = at; i < code.length; i += 1) {
      const ch = code[i]
      if (ch === '(' || ch === '[' || ch === '{') depth += 1
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1
        if (depth === 0) break
      } else if (ch === ',' && depth === 1) commas += 1
    }
    return commas + 1
  }
  for (let i = exportCode.indexOf('assertNoSourceLeak('); i >= 0; i = exportCode.indexOf('assertNoSourceLeak(', i + 1)) {
    const args = topLevelArgCount(exportCode, i + 'assertNoSourceLeak'.length)
    if (args > 2) offenders.push(`유출 임계값을 호출부에서 넘긴다 (인자 ${args}개)`)
  }
  if (!/M3_FORBIDDEN_ADDRESS_TERMS\.some/.test(exportCode)) offenders.push('금지 호칭 대조가 없다')

  // 🔴 위반 시 파일을 쓰지 않고 빠져나가는가 — writeFileSync 보다 먼저 return 이 있어야 한다
  const guardAt = exportCode.search(/if \(leaked\.length > 0 \|\| forbidden\.length > 0\)/)
  const firstWrite = exportCode.search(/writeFileSync\(/)
  if (guardAt < 0) offenders.push('유출 시 중단 분기가 없다')
  else if (firstWrite >= 0 && guardAt > firstWrite) offenders.push('🔴 파일을 먼저 쓰고 나중에 검사한다')
  if (!/process\.exitCode = 1[\s\S]{0,80}return/.test(exportCode.slice(Math.max(0, guardAt)))) {
    offenders.push('유출 시 exit 1 로 끝내지 않는다')
  }
  // terminal skip 은 output null 이어야 한다
  if (!/skipWithOutput/.test(exportCode)) offenders.push('terminal skip output null 검사가 없다')

  if (offenders.length) bad('export 유출 가드 · 중단', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('export 유출 가드 · 중단', 'guard',
    `${M3_LEAK_RUN_MIN}자 전수 대조 · 금지 호칭 대조 · 1건이라도 걸리면 파일 생성 0 · skip output null 검사`)
}

// ── ㊴ export 산출물은 tmp/ 밖으로 나가지 않는다 ─────────
{
  const offenders: string[] = []

  if (!/join\(HERE, '\.\.', 'tmp', 'voice-m3-export'\)/.test(exportCode)) offenders.push('출력 경로가 tmp/ 하위가 아니다')
  // 🔴 .gitignore 가 tmp/ 를 덮고 있어야 산출물이 커밋되지 않는다
  const gitignore = readFileSync(join(HERE, '..', '.gitignore'), 'utf-8')
  if (!/^tmp\/$/m.test(gitignore)) offenders.push('🔴 .gitignore 에 tmp/ 가 없다 — export 산출물이 커밋된다')
  // CSV 는 BOM, JSONL 은 BOM 없음 (설계 §8-④ 확정)
  if (!/const BOM = /.test(exportCode)) offenders.push('BOM 상수가 없다')
  // 🔴 CSV 만 BOM — 직렬화는 lib 에 있고 BOM 은 호출부가 넘긴다
  const csvSrc = stripComments(readFileSync(join(HERE, 'lib/voice-m3-csv.mts'), 'utf-8'))
  if (!/return bom\s*\+ \[headers\.join/.test(csvSrc)) offenders.push('CSV 에 BOM 이 붙지 않는다')
  if (!/toCsv\(SIGNAL_COLUMNS, signalRows, BOM\)/.test(exportCode)) offenders.push('signals.csv 에 BOM 을 넘기지 않는다')
  if (!/toCsv\(SKIPPED_COLUMNS, skippedRows, BOM\)/.test(exportCode)) offenders.push('skipped.csv 에 BOM 을 넘기지 않는다')
  if (/write\('signals\.jsonl', BOM/.test(exportCode)) offenders.push('🔴 JSONL 에 BOM 이 붙는다')
  if (/JSON\.stringify\(manifest[\s\S]{0,40}BOM/.test(exportCode)) offenders.push('🔴 manifest 에 BOM 이 붙는다')
  // manifest 에 sha256 이 남는가
  if (!/sha256:/.test(exportCode)) offenders.push('manifest 에 sha256 이 없다')
  // 생성 후 금지 문자열 재검사가 있는가
  if (!/FORBIDDEN_EXPORT_KEYS/.test(exportCode)) offenders.push('생성 후 금지 컬럼 재검사가 없다')

  if (offenders.length) bad('export 산출물 격리', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('export 산출물 격리', 'guard',
    'tmp/voice-m3-export/ 하위 · .gitignore 커버 · CSV BOM · JSONL/manifest BOM 없음 · sha256 · 생성 후 재검사')
}

// ── ㊵ export 대상은 exact version 으로 좁힌다 ───────────
//    🔴 model 만으로 거르면 같은 haiku 의 **다른 분석**이 한 CSV 에 섞인다.
//       섞인 줄 모르고 평균을 내면 그 수는 아무것도 뜻하지 않는다.
{
  const offenders: string[] = []

  // Cache 조회 where 절 추출 — 버전 4종 + method 가 전부 있어야 한다
  const cacheWhere = /voiceM3Cache\.findMany\(\{\s*where:\s*\{([\s\S]*?)\}/.exec(exportCode)?.[1] ?? ''
  if (cacheWhere === '') offenders.push('Cache 조회 where 절을 찾을 수 없다')
  for (const [field, constant] of [
    ['model', 'M3_ANALYSIS_MODEL'], ['taskVersion', 'M3_TASK_VERSION'],
    ['promptVersion', 'M3_PROMPT_VERSION'], ['outputSchemaVersion', 'M3_OUTPUT_SCHEMA_VERSION'],
  ]) {
    if (!new RegExp(`${field}:\\s*${constant}`).test(cacheWhere)) offenders.push(`🔴 Cache where 에 ${field} 없음`)
  }
  if (!/method:\s*'llm'/.test(cacheWhere)) offenders.push('Cache where 에 method 없음')

  // CostEvent 집계도 같은 실행만 — 버전은 Run 이 들고 있으므로 relation 을 타야 한다
  const evWhere = /voiceM3CostEvent\.aggregate\(\{\s*where:\s*\{([\s\S]*?)\n      \},/.exec(exportCode)?.[1] ?? ''
  if (evWhere === '') offenders.push('CostEvent 집계 where 절을 찾을 수 없다')
  if (!/run:\s*\{/.test(evWhere)) offenders.push('🔴 CostEvent 가 Run relation 을 타지 않는다 — model-only 집계')
  for (const [field, constant] of [
    ['taskVersion', 'M3_TASK_VERSION'], ['promptVersion', 'M3_PROMPT_VERSION'],
    ['outputSchemaVersion', 'M3_OUTPUT_SCHEMA_VERSION'],
  ]) {
    if (!new RegExp(`${field}:\\s*${constant}`).test(evWhere)) offenders.push(`🔴 CostEvent run 에 ${field} 없음`)
  }

  if (offenders.length) bad('export 대상 exact version', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('export 대상 exact version', 'guard',
    `Cache where = model+task+prompt+schema+method · CostEvent 는 run relation 경유 · 다른 버전 혼입 0`)
}

// ── ㊶ CSV formula injection 중립화 ─────────────────────
//    🔴 notes 는 LLM 출력이다. 우리가 쓴 문장이 아닌 것을 사람이 Excel 로 연다.
//       `=` `+` `-` `@` 로 시작하면 수식으로 실행된다.
{
  const offenders: string[] = []

  const csvLib = stripComments(readFileSync(join(HERE, 'lib/voice-m3-csv.mts'), 'utf-8'))
  if (!/neutralizeFormula/.test(csvLib)) offenders.push('🔴 formula 중립화 함수가 없다')
  if (!/toCsv/.test(exportCode)) offenders.push('export 가 toCsv 를 쓰지 않는다')
  // 🔴 검사 대상 로직이 실행 진입점과 같은 파일에 있으면 fixture 가 작업을 일으킨다
  if (/main\(\)/.test(csvLib)) offenders.push('🔴 csv lib 에 실행 진입점이 있다')
  if (!/const s = neutralizeFormula\(raw\)/.test(csvLib)) offenders.push('csvCell 이 중립화를 거치지 않는다')
  // RFC4180 quoting 이 살아 있어야 한다
  if (!/s\.replace\(\/"\/g, '""'\)/.test(csvLib)) offenders.push('🔴 RFC4180 quoting 이 사라졌다')
  // 숫자는 중립화 대상이 아니다 — 음수가 텍스트로 변질되면 정렬 · 합계가 깨진다
  if (!/typeof v === 'number' \|\| typeof v === 'boolean'/.test(csvLib)) {
    offenders.push('숫자 · 불리언을 중립화에서 빼지 않는다')
  }

  // 🔴 실제로 막는지 — 위험 입력을 넣어 본다
  const cases: Array<[string, boolean]> = [
    ['=HYPERLINK("http://evil","click")', true],
    ['+cmd|\' /C calc\'!A0', true],
    ['-1+2', true],
    ['@SUM(1+1)', true],
    ['  =SUM(A1)', true],        // 선행 공백으로 회피 시도
    ['\t=1+1', true],            // 탭 회피 시도
    ['자연스러운 문장이다', false],
    ['평점 85점 = 높음', false],  // 중간의 = 는 안전
    ['', false],
  ]
  for (const [input, shouldNeutralize] of cases) {
    const out = neutralizeFormula(input)
    const did = out.startsWith("'") && out !== input
    if (did !== shouldNeutralize) {
      offenders.push(`🔴 "${input.slice(0, 12)}" → ${did ? '중립화됨' : '통과'} (기대 ${shouldNeutralize ? '중립화' : '통과'})`)
    }
    // 🔴 원본을 바꾸지 않는다 — 앞에 덧대기만 한다
    if (did && out.slice(1) !== input) offenders.push(`🔴 "${input.slice(0, 12)}" 원본이 변형됐다`)
  }

  if (offenders.length) bad('CSV formula injection 방어', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('CSV formula injection 방어', 'guard',
    `= + - @ · 선행 공백 · 탭 전부 중립화 · 원본 불변 · 숫자 제외 · RFC4180 유지 · 케이스 ${cases.length}종`)
}

// ── ㊷ manifest 도 금지 문자열 검사를 받는다 ─────────────
//    🔴 manifest 는 columns 배열을 담는다. 화이트리스트가 무너지면 여기 먼저 드러난다.
{
  const offenders: string[] = []

  if (!/files\['manifest\.json'\] = manifestPath/.test(exportCode)) {
    offenders.push('🔴 manifest 가 금지 문자열 검사 대상(files)에 들어가지 않는다')
  }
  // 검사 루프보다 먼저 등록돼야 한다
  const reg = exportCode.indexOf("files['manifest.json'] = manifestPath")
  const scan = exportCode.indexOf('for (const [name, p] of Object.entries(files))')
  if (reg >= 0 && scan >= 0 && reg > scan) offenders.push('🔴 manifest 등록이 검사 루프보다 뒤에 있다')
  if (!/FORBIDDEN_EXPORT_KEYS/.test(exportCode)) offenders.push('금지 키 목록이 없다')

  if (offenders.length) bad('manifest 금지 문자열 검사', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('manifest 금지 문자열 검사', 'guard',
    'manifest 도 files 에 등록돼 post-write scan 대상 · 등록이 검사보다 앞')
}

// ── 출력 ────────────────────────────────────────────────
console.log('\nVE-M3-2 dry-run — fixture 자기검증')
console.log('  이 fixture 는 네트워크 · DB · LLM 을 타지 않는다')
console.log('  🔴 검사하는 것은 "payload 가 잘 만들어지는가" 가 아니라 "돈이 나갈 경로가 생겼는가" 다')
console.log('  🔴 VE-M3-3 부터 provider 호출은 adapter · run 두 파일에만 허용된다\n')
const label: Record<string, string> = { policy: '[정책]  ', guard: '[가드]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(32)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — VE-M3-2 경로가 선을 넘지 않는다\n`)
