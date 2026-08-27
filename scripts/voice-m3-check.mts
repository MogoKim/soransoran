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
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  M3_TASK_VERSION, M3_PROMPT_VERSION, M3_OUTPUT_SCHEMA_VERSION, M3_MODEL_UNDETERMINED,
  M3_CAPS, M3_SIGNAL_KEYS, M3_OUTPUT_SCHEMA, CACHE_KEY_PARTS,
  M3_ALLOWED_ADDRESS_TERMS, M3_FORBIDDEN_ADDRESS_TERMS, M3_LEAK_RUN_MIN,
  M3_MODEL_CANDIDATES, M3_EXPERIMENT_PER_MODEL,
  buildCacheKey, estimateCost, checkCaps, validateAddressCandidates, assertNoSourceLeak, pricingFor,
} from './lib/voice-m3-contract.mjs'
import { buildPromptPayload, buildInstruction, formatSummaryLine } from './lib/voice-m3-prompt.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIVE = join(HERE, 'voice-m3-dry-run.mts')
const CONTRACT_LIB = join(HERE, 'lib/voice-m3-contract.mts')
const PROMPT_LIB = join(HERE, 'lib/voice-m3-prompt.mts')

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
    ['itemLimit', 10], ['tokenCap', 500_000], ['dollarCap', 5],
    ['softDaily', 200], ['hardDaily', 1_000], ['timeoutSec', 30],
    ['maxRetry', 3], ['consecutiveFailureStop', 5],
  ]
  for (const [k, v] of want) {
    const actual = (M3_CAPS as unknown as Record<string, number>)[k]
    if (actual !== v) offenders.push(`${k}=${actual} (계약값 ${v})`)
  }
  if (offenders.length) bad('cap 값이 계약과 같다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('cap 값이 계약과 같다', 'guard', 'item 10 · token 500K · $5 · retry 3(cap 포함) · 연속실패 5')
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
  if (M3_EXPERIMENT_PER_MODEL !== 10) offenders.push(`모델당 실험 건수가 ${M3_EXPERIMENT_PER_MODEL} (10이어야 한다)`)
  // 🔴 모델당 10건이므로 itemLimit 을 넘지 않는다
  if (M3_EXPERIMENT_PER_MODEL > M3_CAPS.itemLimit) offenders.push('모델당 건수가 itemLimit 초과')
  if (offenders.length) bad('단가에 출처 · 확인일 필수', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('단가에 출처 · 확인일 필수', 'policy', `후보 ${names.length}종 · 전부 출처+날짜 · 미등록은 거부 · 모델당 ${M3_EXPERIMENT_PER_MODEL}건`)
}

// ── 출력 ────────────────────────────────────────────────
console.log('\nVE-M3-2 dry-run — fixture 자기검증')
console.log('  이 fixture 는 네트워크 · DB · LLM 을 타지 않는다')
console.log('  🔴 검사하는 것은 "payload 가 잘 만들어지는가" 가 아니라 "돈이 나갈 경로가 생겼는가" 다\n')
const label: Record<string, string> = { policy: '[정책]  ', guard: '[가드]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(32)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — VE-M3-2 경로가 선을 넘지 않는다\n`)
