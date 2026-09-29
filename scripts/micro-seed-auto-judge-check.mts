#!/usr/bin/env tsx
/**
 * 자동 판정 Shadow fixture — 🔴 **사람 판정을 사칭하지 않는다** (§4-AR)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  judgeOne, summarize, checkRegression, violatesProvenance, readReasons, readFlags,
  AUTO_DECISIONS, HUMAN_DECISIONS, HUMAN_PROVENANCE, AUTO_PROVENANCE, RULE_VERSION,
  HARD_BLOCK, HOLD_REASONS, KNOWN_SAFETY_CODES, REASON_LABEL, SEED_AXIS, RAW_AXIS,
  PROVEN_LANES, HOLD_ASSET_AXES, parseSemantic, hardGate, preSemanticGate,
  SEMANTIC_RISKS, SEMANTIC_DROP, SEMANTIC_HOLD, MIN_CONFIDENCE, BODY_HEAD_MAX,
  SEMANTIC_STATUSES, PROMPT_VERSION, inputHashOf, SKIPPED,
  type JudgeInput, type SemanticVerdict, type SemanticOutcome,
} from '../src/lib/micro-seed-auto-judge'
import { SAFETY_SIGNAL_CODES } from '../src/lib/micro-seed-safety-signals'
import { POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const NOW = '2026-09-07T12:00:00.000Z'
/** 🔴 모델 응답을 mock 한다 — fixture 는 네트워크를 쓰지 않는다 */
const okSem = (o: Partial<SemanticVerdict> = {}): SemanticVerdict => ({
  decision: 'AUTO_SEED', confidence: 0.9, risks: [], communityAngle: '살림 이야기', ...o,
})
/** semantic 결과를 outcome 으로 감싼다 — 러너가 넘기는 모양 그대로 */
const oc = (v: SemanticVerdict | null, status: SemanticOutcome['status'] = v === null ? 'timeout' : 'ok'): SemanticOutcome =>
  ({ verdict: v, status, attemptCount: 1, providerErrorCode: null, model: 'claude-haiku-4.5' })
const j = (o: Partial<JudgeInput> = {}, sem: SemanticVerdict | null = okSem()) => judgeOne({
  sourceArticleId: '4234470', axis: SEED_AXIS, access: 'ok', lane: 'microSeedQuestion',
  assetAxes: '', safetyVerdict: 'pass', safetyReasons: '', bodyLength: 816, qualityFlags: [],
  title: '당근에서 집안일 도와주실 분', bodyHead: '가'.repeat(120), commentCount: 10, ...o,
}, NOW, oc(sem))

console.log('\n자동 판정 Shadow — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 사람 판정을 사칭하지 않는다')
{
  check('결정 값 4종이 전부 AUTO_ 로 시작한다',
    AUTO_DECISIONS.every((d) => d.startsWith('AUTO_')))
  check('🔴 사람 값과 한 글자도 겹치지 않는다',
    AUTO_DECISIONS.every((d) => !(HUMAN_DECISIONS as readonly string[]).includes(d)))
  check(`provenance 가 ${AUTO_PROVENANCE} 다`, j().provenance === AUTO_PROVENANCE)
  check('🔴 provenance 가 사람 것이 아니다',
    !(HUMAN_PROVENANCE as readonly string[]).includes(AUTO_PROVENANCE))
  check('ruleVersion 이 붙는다', j().ruleVersion === RULE_VERSION)
  // 🔴 v4 (2026-09-29) — 모델 통과 라벨로 HOLD 하지 않는다(axisMismatch 폐지)
  check('🔴 v4 로 올랐다 — 판정 규칙이 바뀌면 캐시를 분리한다', RULE_VERSION === 'auto-judge-v4')
  check('promptVersion 이 붙는다', j().promptVersion === PROMPT_VERSION)
  check('decidedAt 이 붙는다', j().decidedAt === NOW)
  check('reasonCodes 가 배열이다', Array.isArray(j().reasonCodes))

  // 🔴 기록 직전 관문
  const row = j() as unknown as Record<string, unknown>
  check('🟢 온전한 판정은 통과', violatesProvenance(row).length === 0)
  for (const d of HUMAN_DECISIONS) {
    check(`🔴 decision=${d} 를 쓰면 잡는다`,
      violatesProvenance({ ...row, decision: d }).some((m) => m.includes('사칭') || m.includes('AUTO_')))
  }
  for (const p of HUMAN_PROVENANCE) {
    check(`🔴 provenance=${p} 를 쓰면 잡는다`,
      violatesProvenance({ ...row, provenance: p }).some((m) => m.includes('사칭')))
  }
  for (const k of ['ruleVersion', 'decidedAt', 'sourceArticleId'] as const) {
    check(`🔴 ${k} 가 비면 잡는다`,
      violatesProvenance({ ...row, [k]: '' }).some((m) => m.includes(k)))
  }
}

console.log('\n② 🔴 AUTO_PASS 필수 조건 — 하나라도 없으면 통과가 아니다')
{
  check('🟢 전부 맞으면 AUTO_SEED', j().decision === 'AUTO_SEED')
  check('🟢 raw 축이면 AUTO_RAW',
    j({ axis: RAW_AXIS }, okSem({ decision: 'AUTO_RAW' })).decision === 'AUTO_RAW')
  const cases: [string, Partial<JudgeInput>, string][] = [
    ['access 가 ok 가 아니다', { access: 'failed' }, 'AUTO_HOLD'],
    ['access 가 비었다', { access: '' }, 'AUTO_HOLD'],
    ['safety 가 pass 가 아니다', { safetyVerdict: 'hold' }, 'AUTO_HOLD'],
    ['본문 길이 0', { bodyLength: 0 }, 'AUTO_HOLD'],
    ['축이 SRN', { axis: 'shortRawNoindex' }, 'AUTO_HOLD'],
    ['축이 모르는 값', { axis: 'growthIssue' }, 'AUTO_HOLD'],
    ['🔴 축이 drop', { axis: 'drop' }, 'AUTO_DROP'],
    ['🔴 hardExclude', { safetyVerdict: 'hardExclude' }, 'AUTO_DROP'],
    ['🔴 id 없음', { sourceArticleId: '' }, 'AUTO_DROP'],
  ]
  for (const [label, patch, want] of cases) {
    check(`${label} → ${want}`, j(patch).decision === want)
  }
  check('🔴 어떤 조합으로도 통과가 새지 않는다', (() => {
    for (const p of [{ access: 'failed' }, { safetyVerdict: 'hold' }, { bodyLength: 0 }]) {
      const d = j(p).decision
      if (d === 'AUTO_SEED' || d === 'AUTO_RAW') return false
    }
    return true
  })())
  check('통과한 판정에는 축 사유만 남는다',
    j().reasonCodes.length === 1 && j().reasonCodes[0] === 'axisSeed')
}

console.log('\n②-b 🔴 v1 오진 회귀 방지 — title · bodyHead 가 판정 입력에 있어야 한다')
{
  check('🔴 title 이 없으면 통과가 아니라 HOLD', j({ title: '' }).decision === 'AUTO_HOLD')
  check('사유가 noTitle', j({ title: '' }).reasonCodes.includes('noTitle'))
  check('🔴 bodyHead 가 없으면 HOLD', j({ bodyHead: '' }).decision === 'AUTO_HOLD')
  check('사유가 noBodyHead', j({ bodyHead: '' }).reasonCodes.includes('noBodyHead'))
  check(`🔴 bodyHead 가 ${BODY_HEAD_MAX}자를 넘으면 HOLD — 전문이 섞였을 수 있다`,
    j({ bodyHead: '가'.repeat(BODY_HEAD_MAX + 1) }).decision === 'AUTO_HOLD')
  check('사유가 bodyHeadTooLong',
    j({ bodyHead: '가'.repeat(BODY_HEAD_MAX + 1) }).reasonCodes.includes('bodyHeadTooLong'))
  check(`정확히 ${BODY_HEAD_MAX}자는 통과`, j({ bodyHead: '가'.repeat(BODY_HEAD_MAX) }).decision === 'AUTO_SEED')
  check('🔴 preSemanticGate 가 둘을 본다', (() => {
    const g = preSemanticGate({ sourceArticleId: 'x', axis: SEED_AXIS, access: 'ok',
      safetyVerdict: 'pass', bodyLength: 100 })
    return g.includes('noTitle') && g.includes('noBodyHead')
  })())
  check('🔴 전역 봉쇄 상수가 없다 — 정상 후보를 코드로 막지 않는다', (() => {
    const lib = readFileSync('src/lib/micro-seed-auto-judge.ts', 'utf-8')
    return !/export const ALLOW_AUTO_PASS/.test(lib) && !/'passDisabled'/.test(lib)
  })())
  check('🟢 정상 후보는 실제로 AUTO_SEED 가 된다', j().decision === 'AUTO_SEED')
  check('🟢 raw 축이면 AUTO_RAW',
    j({ axis: RAW_AXIS }, okSem({ decision: 'AUTO_RAW' })).decision === 'AUTO_RAW')
}

console.log('\n②-c 🔴 semantic judge — 모르면 통과가 아니다')
{
  check('🔴 모델 답이 없으면 HOLD', j({}, null).decision === 'AUTO_HOLD')
  // 🔴 부르지 않은 것(skipped·noKey)과 불렀는데 실패한 것을 구분한다
  check('부르지 않았으면 semanticUnavailable',
    judgeOne({ sourceArticleId: 'x', axis: SEED_AXIS, access: 'ok', title: 't', bodyHead: 'b',
      safetyVerdict: 'pass', bodyLength: 10, lane: 'microSeedQuestion' }, NOW, SKIPPED)
      .reasonCodes.includes('semanticUnavailable'))
  check('불렀는데 실패했으면 semanticFailed', j({}, null).reasonCodes.includes('semanticFailed'))
  check('🔴 파싱 실패 → null', parseSemantic('이건 JSON 이 아니다') === null)
  check('🔴 모르는 decision → null', parseSemantic('{"decision":"YES","confidence":1}') === null)
  check('🔴 사람 값을 답해도 → null', parseSemantic('{"decision":"SEED","confidence":1}') === null)
  check('🔴 confidence 가 없으면 → null', parseSemantic('{"decision":"AUTO_SEED"}') === null)
  check('🔴 confidence 범위 밖 → null', parseSemantic('{"decision":"AUTO_SEED","confidence":2}') === null)
  check('🟢 온전한 응답은 읽는다', (() => {
    const v = parseSemantic('{"decision":"AUTO_SEED","confidence":0.9,"risks":[],"communityAngle":"살림"}')
    return v !== null && v.decision === 'AUTO_SEED' && v.confidence === 0.9
  })())
  check('앞 중괄호가 없어도 읽는다 (Anthropic prefill)',
    parseSemantic('"decision":"AUTO_SEED","confidence":0.8,"risks":[]}') !== null)
  check('🔴 모르는 위험 이름은 insufficientContext 로 읽는다', (() => {
    const v = parseSemantic('{"decision":"AUTO_SEED","confidence":0.9,"risks":["newRiskName"]}')
    return v !== null && v.risks.includes('insufficientContext')
  })())
  check(`🔴 confidence ${MIN_CONFIDENCE} 미만이면 HOLD`,
    j({}, okSem({ confidence: MIN_CONFIDENCE - 0.01 })).decision === 'AUTO_HOLD')
  check('사유가 lowConfidence',
    j({}, okSem({ confidence: 0.1 })).reasonCodes.includes('lowConfidence'))
  /**
   * 🔴 **v4 (2026-09-29) — 통과 라벨은 축 신호가 아니다.** 판정 프롬프트는 SEED 와 RAW 를 정의하지 않는다.
   *    위험 0 · 확신 충분 · 모델도 통과라 했으면 **우리 축**이 결정을 정한다 (v3 는 axisMismatch HOLD 였다).
   */
  check('🟢 v4 — seed 축인데 모델이 AUTO_RAW 라 해도 AUTO_SEED 다 (축은 우리가 정한다)',
    j({}, okSem({ decision: 'AUTO_RAW' })).decision === 'AUTO_SEED')
  check('🟢 v4 — raw 축인데 모델이 AUTO_SEED 라 해도 AUTO_RAW 다 (적응 경로)',
    j({ axis: RAW_AXIS }, okSem({ decision: 'AUTO_SEED' })).decision === 'AUTO_RAW')
  check('🔴 v4 — 통과 라벨이 달라도 위험이 있으면 그대로 막는다 (라벨이 위해를 풀지 않는다)',
    j({ axis: RAW_AXIS }, okSem({ decision: 'AUTO_SEED', risks: ['unverifiedDefamation'] })).decision === 'AUTO_DROP'
    && j({ axis: RAW_AXIS }, okSem({ decision: 'AUTO_SEED', risks: ['medicalDecisionRequest'] })).decision === 'AUTO_HOLD'
    && j({ axis: RAW_AXIS }, okSem({ decision: 'AUTO_SEED', confidence: 0.5 })).decision === 'AUTO_HOLD')
}

console.log('\n②-c2 🔴 실패를 한 덩어리로 세지 않는다')
{
  check('상태 7종', SEMANTIC_STATUSES.length === 7)
  check('🔴 타임아웃과 파싱 실패가 다른 사유로 남는다', (() => {
    const t = judgeOne({ sourceArticleId: 'x', axis: SEED_AXIS, access: 'ok', title: 't',
      bodyHead: 'b', safetyVerdict: 'pass', bodyLength: 10, lane: 'microSeedQuestion' }, NOW,
    { verdict: null, status: 'timeout', attemptCount: 2, providerErrorCode: 'TIMEOUT', model: 'm' })
    return t.semanticStatus === 'timeout' && t.providerErrorCode === 'TIMEOUT' && t.attemptCount === 2
  })())
  check('🔴 키가 없는 것은 실패가 아니라 미수행이다', (() => {
    const t = judgeOne({ sourceArticleId: 'x', axis: SEED_AXIS, access: 'ok', title: 't',
      bodyHead: 'b', safetyVerdict: 'pass', bodyLength: 10, lane: 'microSeedQuestion' }, NOW,
    { verdict: null, status: 'noKey', attemptCount: 0, providerErrorCode: 'NO_API_KEY', model: '' })
    return t.reasonCodes.includes('semanticUnavailable')
  })())
  check('🔴 호출 실패는 semanticFailed 로 구분된다', (() => {
    const t = judgeOne({ sourceArticleId: 'x', axis: SEED_AXIS, access: 'ok', title: 't',
      bodyHead: 'b', safetyVerdict: 'pass', bodyLength: 10, lane: 'microSeedQuestion' }, NOW,
    { verdict: null, status: 'httpError', attemptCount: 2, providerErrorCode: 'HTTP_500', model: 'm' })
    return t.reasonCodes.includes('semanticFailed')
  })())
  check('SKIPPED 는 부르지 않았다는 뜻', SKIPPED.status === 'skipped' && SKIPPED.attemptCount === 0)

  // 🔴 결과 파일에 원문이 없다
  const row = j() as unknown as Record<string, unknown>
  for (const k of ['title', 'bodyHead', 'rawBody', 'body', 'sourceBody'] as const) {
    check(`🔴 판정 결과에 ${k} 가 없다`, !(k in row))
  }
  for (const k of ['model', 'promptVersion', 'inputHash', 'confidence', 'semanticRisks',
    'communityAngle', 'attemptCount', 'semanticStatus', 'providerErrorCode'] as const) {
    check(`추적 필드 ${k} 가 있다`, k in row)
  }
  check('🔴 inputHash 는 원문을 복원할 수 없다 — 16자 지문이다',
    /^[0-9a-f]{16}$/.test(String(row.inputHash)))
  check('같은 입력이면 같은 해시', inputHashOf({ title: 'a', bodyHead: 'b' })
    === inputHashOf({ title: 'a', bodyHead: 'b' }))
  check('🔴 다른 입력이면 다른 해시', inputHashOf({ title: 'a', bodyHead: 'b' })
    !== inputHashOf({ title: 'a', bodyHead: 'c' }))
}

console.log('\n②-c3 🔴 실행 계약 — 화면이 거짓말하지 않는다')
{
  const r = readFileSync('scripts/micro-seed-auto-judge.mts', 'utf-8')
  check('--call 이 있어야 부른다', /const CALL = argv\.includes\('--call'\)/.test(r))
  check('🔴 --apply 단독은 거부한다', /APPLY && !CALL[\s\S]{0,80}fail\(/.test(r))
  check('🔴 --call 이 없으면 부르기 전에 돌아간다', /if \(!CALL\) \{[\s\S]{0,300}return\n?\s*\}/.test(r))
  check('🔴 "네트워크 0" 문구는 CALL 이 아닐 때만 찍는다',
    /CALL \? '' : ' · 네트워크 0 · LLM 0 · 파일 write 0'/.test(r))
  // 🔴 --call 은 shadow 파일을 안 만들지만 캐시는 쓴다. 화면이 그걸 숨기면 거짓말이다
  check('🔴 --call 이 "파일 write 0" 이라고 말하지 않는다',
    !/호출 \(파일 write 0\)/.test(r))
  check('--call 이 cache write 를 밝힌다', /cache write 있음/.test(r))
  check('--call 단독에서도 캐시를 저장한다', (() => {
    const i = r.indexOf('shadow 판정 파일을 만들지 않는다')
    return i > 0 && r.slice(i, i + 400).includes('saveCache(cache)')
  })())
  check('재시도 상한이 있다', /MAX_ATTEMPTS = 2/.test(r))
  check('🔴 지수 백오프 + jitter', /RETRY_BASE_MS \* 2 \*\* /.test(r) && /Math\.random\(\)/.test(r))
  check('🔴 재시도해도 소용없는 것은 재시도하지 않는다', /isRetryable/.test(r))
  check('파싱 실패는 형식을 다시 일러 한 번 더 묻는다', /JSON 이 아니었다/.test(r))
  check('🔴 캐시에 원문을 담지 않는다', (() => {
    const i = r.indexOf('type CacheEntry')
    const body = r.slice(i, r.indexOf('}', i))
    return !/title|bodyHead|rawBody|body\b/.test(body)
  })())
  check('캐시 키에 규칙판·프롬프트판·모델이 들어간다',
    /RULE_VERSION\}\|\$\{PROMPT_VERSION\}\|\$\{JUDGE_MODEL\}/.test(r))
  /**
   * 🔴 (2026-09-29) 캐시에 담긴 것은 **모델 답**이다 — 규칙은 그 위에 다시 건다. 정본이 인정한 앞 판(v3)의
   *    캐시만 읽는다(다시 묻지 않는다 · 유료 0). 쓰기는 지금 판 key 다. 프롬프트·모델 판은 그대로 key 에 있다.
   */
  check('🔴 앞 판 캐시는 RULE_CARRY_OVER 가 인정한 판만 · 프롬프트·모델 판은 그대로 key 에 있다',
    /function cachedVerdict/.test(r) && /RULE_CARRY_OVER/.test(r)
    && /\$\{prev\}\|\$\{PROMPT_VERSION\}\|\$\{JUDGE_MODEL\}/.test(r)
    && (r.match(/cache\.set\(k,/g) ?? []).length >= 1)
  check('cache hit/miss 를 보고한다', /cache hit \$\{hit\} · miss \$\{miss\}/.test(r))
}

console.log('\n②-d 🔴 위험 축 — v1 이 못 잡던 것들')
{
  for (const r of SEMANTIC_DROP) {
    check(`🔴 ${r} → AUTO_DROP`, j({}, okSem({ risks: [r] })).decision === 'AUTO_DROP')
    check(`   사유가 남는다`, j({}, okSem({ risks: [r] })).reasonCodes.includes(r))
  }
  for (const r of SEMANTIC_HOLD) {
    check(`🟡 ${r} → AUTO_HOLD`, j({}, okSem({ risks: [r] })).decision === 'AUTO_HOLD')
  }
  // 🔴 2026-09-16 — 위기 신호 · 의료 판단 요청 · 건강 효능 주장 3종을 더했다
  check('위험 축이 11종', SEMANTIC_RISKS.length === 11)
  check('🔴 deterministic 축 이름과 semantic 축 이름이 같다',
    SAFETY_SIGNAL_CODES.every((c) => (SEMANTIC_RISKS as readonly string[]).includes(c)))
  check('🔴 위기 신호는 버리지 않고 사람에게 넘긴다 (정본 §4)',
    (SEMANTIC_HOLD as readonly string[]).includes('crisisSignal')
    && !(SEMANTIC_DROP as readonly string[]).includes('crisisSignal'))

  /**
   * 🔴 **옛 판은 "연예 소재는 HOLD · 검사 주기 질문은 DROP" 을 계약으로 박고 있었다**
   *    (2026-09-13 교체). 그 계약 때문에 40~60대 여성이 실제로 쓰는 이야기가
   *    통째로 막혔고, fixture 를 먼저 깨지 않으면 고칠 수 없었다.
   *    이제 **소재가 아니라 위해**를 본다.
   */
  for (const topic of ['연예·방송', '건강·갱년기', '부부 갈등', '검사·시술 주기 질문'] as const) {
    check(`🟢 ${topic} 은 이제 위험 축이 아니다 — 이름 자체가 없다`,
      !(SEMANTIC_RISKS as readonly string[]).some((r) =>
        ['celebrityOrBroadcast', 'healthScheduleOrMedicalAdvice',
          'hostilityOrConflictBait', 'medicalAdvice', 'politicsOrPublicFigure',
          'personalSpecificity'].includes(r)))
  }
  check('🟢 위험이 없으면 소재가 무엇이든 AUTO_SEED',
    j({}, okSem({ risks: [] })).decision === 'AUTO_SEED')

  // 🔴 위해 축은 버린다 — 소재가 무엇이든
  for (const risk of ['identifiablePrivatePerson', 'unverifiedDefamation',
    'targetedHarassmentOrThreat', 'dangerousMedicalInstruction', 'politicalCampaigning'] as const) {
    check(`🔴 ${risk} → AUTO_DROP`, j({}, okSem({ risks: [risk] })).decision === 'AUTO_DROP')
    check(`   사유가 남는다`, j({}, okSem({ risks: [risk] })).reasonCodes.includes(risk))
    check(`   어떤 confidence · 어떤 decision 으로도 통과하지 않는다`, (() => {
      for (const c of [0.71, 0.9, 1]) {
        for (const d of ['AUTO_SEED', 'AUTO_RAW', 'AUTO_HOLD', 'AUTO_DROP'] as const) {
          if (j({}, okSem({ risks: [risk], confidence: c, decision: d })).decision !== 'AUTO_DROP') return false
        }
      }
      return true
    })())
  }
  for (const risk of ['purchaseOrSellerRequest', 'brandListBait', 'insufficientContext'] as const) {
    check(`🟡 ${risk} → AUTO_HOLD (버리지 않는다)`,
      j({}, okSem({ risks: [risk] })).decision === 'AUTO_HOLD')
  }
  check('🔴 몸·건강 축으로 격리하지 않는다 — 그 소재가 우리 고객의 이야기다',
    HOLD_ASSET_AXES.length === 0
    && j({ assetAxes: '몸·건강' }, okSem({ risks: [] })).decision === 'AUTO_SEED')
  check('프롬프트가 소재를 막지 않는다고 말한다', (() => {
    const r = readFileSync('scripts/micro-seed-auto-judge.mts', 'utf-8')
    return /소재를 막지 않는다/.test(r)
      && !/celebrityOrBroadcast/.test(r) && !/healthScheduleOrMedicalAdvice/.test(r)
  })())
  check('프롬프트가 위해 축을 설명한다', (() => {
    const r = readFileSync('scripts/micro-seed-auto-judge.mts', 'utf-8')
    return SEMANTIC_RISKS.every((x) => r.includes(x))
  })())
  check('🔴 DROP 축과 HOLD 축이 겹치지 않는다',
    SEMANTIC_DROP.every((r) => !SEMANTIC_HOLD.includes(r)))
  check('🔴 모든 위험 축이 DROP 이거나 HOLD 다 — 어디에도 없는 축을 만들지 않는다',
    SEMANTIC_RISKS.every((r) => SEMANTIC_DROP.includes(r) || SEMANTIC_HOLD.includes(r)))
  // 🔴 **정책 taxonomy 가 모델 decision 을 이긴다**
  check('🔴 모델이 AUTO_DROP 인데 버릴 사유가 없으면 HOLD',
    j({}, okSem({ decision: 'AUTO_DROP', risks: [] })).decision === 'AUTO_HOLD')
  check('사유가 unexplainedModelDrop',
    j({}, okSem({ decision: 'AUTO_DROP', risks: [] })).reasonCodes.includes('unexplainedModelDrop'))
  check('🔴 모델이 AUTO_HOLD 라 하면 격리한다',
    j({}, okSem({ decision: 'AUTO_HOLD' })).decision === 'AUTO_HOLD')
  check('🔴 v4 는 axisMismatch 를 내지 않는다 — 사유는 우리 축(axisSeed · axisRaw)이다',
    !j({}, okSem({ decision: 'AUTO_RAW' })).reasonCodes.includes('axisMismatch')
    && j({}, okSem({ decision: 'AUTO_RAW' })).reasonCodes.join(',') === 'axisSeed'
    && j({ axis: RAW_AXIS }, okSem({ decision: 'AUTO_SEED' })).reasonCodes.join(',') === 'axisRaw')
}

console.log('\n②-e 🔴 모델이 hard gate 를 되돌릴 수 없다')
{
  const strong = okSem({ decision: 'AUTO_SEED', confidence: 1, risks: [] })
  check('🔴 hardExclude 는 모델이 통과라 해도 DROP',
    j({ safetyVerdict: 'hardExclude' }, strong).decision === 'AUTO_DROP')
  check('🔴 axis=drop 도 DROP', j({ axis: 'drop' }, strong).decision === 'AUTO_DROP')
  check('🔴 정치 사유도 DROP', j({ safetyReasons: 'politics' }, strong).decision === 'AUTO_DROP')
  check('🔴 access 실패는 모델이 뭐라 해도 HOLD',
    j({ access: 'failed' }, strong).decision === 'AUTO_HOLD')
  check('🔴 safety 미통과도 HOLD', j({ safetyVerdict: 'hold' }, strong).decision === 'AUTO_HOLD')
  check('🔴 hardGate 가 모델보다 먼저다', (() => {
    // 어떤 응답을 줘도 hardGate 에 걸린 것은 DROP 이다
    for (const sem of [strong, okSem({ decision: 'AUTO_SEED', confidence: 1 }), null]) {
      if (j({ safetyReasons: 'politics' }, sem).decision !== 'AUTO_DROP') return false
    }
    return true
  })())
}

console.log('\n③ 🔴 위험 사유는 AUTO_DROP — 통과가 아니다')
{
  for (const code of ['politics', 'personalIdentity', 'medicalClaim', 'promotion', 'hostility'] as const) {
    check(`🔴 ${code} → AUTO_DROP`, j({ safetyReasons: code }).decision === 'AUTO_DROP')
    check(`   사유가 남는다`, j({ safetyReasons: code }).reasonCodes.includes(code))
  }
  check('🔴 목록 플래그 politicalOrPublicFigure 도 막는다',
    j({ qualityFlags: ['politicalOrPublicFigure'] }).decision === 'AUTO_DROP')
  // 🔴 v1 은 이걸 medicalClaim 으로 단정해 사유를 왜곡했다. 이름 그대로 의료 **또는** 광고다
  check('🟡 medicalOrAdLikely → AUTO_HOLD (버리지 않는다)',
    j({ qualityFlags: ['medicalOrAdLikely'] }).decision === 'AUTO_HOLD')
  check('🔴 medicalClaim 으로 단정하지 않는다',
    !j({ qualityFlags: ['medicalOrAdLikely'] }).reasonCodes.includes('medicalClaim'))
  check('별도 사유 medicalOrAd 로 남는다',
    j({ qualityFlags: ['medicalOrAdLikely'] }).reasonCodes.includes('medicalOrAd'))
  check('🟢 다른 플래그는 막지 않는다',
    j({ qualityFlags: ['clickbaitTitle'] }).decision === 'AUTO_SEED')
  check('사유 코드 문자열이 `code:note` 여도 읽는다',
    j({ safetyReasons: 'politics:정치 어휘' }).decision === 'AUTO_DROP')
  check('여러 사유를 | 로 읽는다',
    readReasons('politics|promotion').length === 2)
  check('빈 문자열은 사유 0', readReasons('').length === 0)
  check('플래그 이름을 새로 만들지 않는다 — 옮기기만 한다',
    readFlags(['politicalOrPublicFigure']).join(',') === 'politics')
  check('🔴 의료와 광고를 합치지 않는다', readFlags(['medicalOrAdLikely']).join(',') === 'medicalOrAd')
}

console.log('\n④ 🔴 모르는 사유는 통과가 아니라 격리다')
{
  const r = j({ safetyReasons: 'brandNewReasonNobodyKnows' })
  check('🔴 모르는 사유 → AUTO_HOLD', r.decision === 'AUTO_HOLD')
  check('unknownReason 으로 기록된다', r.reasonCodes.includes('unknownReason'))
  check('🔴 규칙이 모르는 위험이 통과하지 않는다', r.decision !== 'AUTO_SEED')
  check('아는 사유 목록이 12종', KNOWN_SAFETY_CODES.length === 12)
  check('🟡 격리 사유는 버리지 않는다 — 사람이 보면 통과할 수도 있다',
    j({ safetyReasons: 'visualDependent' }).decision === 'AUTO_HOLD')
  check('volatile 도 격리 (drop 아님)',
    j({ safetyReasons: 'volatile' }).decision === 'AUTO_HOLD')
  check('noticeSlot 도 격리',
    j({ safetyReasons: 'noticeSlot' }).decision === 'AUTO_HOLD')
  check('🔴 HARD_BLOCK 과 HOLD_REASONS 가 겹치지 않는다',
    HARD_BLOCK.every((c) => !HOLD_REASONS.includes(c)))
  check('사유마다 라벨이 있다',
    Object.keys(REASON_LABEL).length >= HARD_BLOCK.length + HOLD_REASONS.length)
}

console.log('\n⑤ 회귀 대조 — 🔴 false pass 가 0이어야 한다')
{
  const rows = [
    { sourceArticleId: 'a', humanDecision: 'SEED', autoDecision: 'AUTO_SEED' as const },
    { sourceArticleId: 'b', humanDecision: 'HOLD', autoDecision: 'AUTO_HOLD' as const },
    { sourceArticleId: 'c', humanDecision: 'SEED', autoDecision: 'AUTO_HOLD' as const },
    { sourceArticleId: 'd', humanDecision: 'DROP', autoDecision: 'AUTO_SEED' as const },
  ]
  const r = checkRegression(rows)
  check('🔴 사람이 안 고른 것을 기계가 통과시키면 false pass', r.falsePass.length === 1)
  check('그 건을 지목한다', r.falsePass[0]!.sourceArticleId === 'd')
  check('🟡 사람은 골랐는데 기계가 안 고른 것은 보수적 — 허용', r.conservative.length === 1)
  check('일치 2건', r.agree.length === 2)
  check('🟢 false pass 가 없으면 빈 배열',
    checkRegression([rows[0]!, rows[1]!]).falsePass.length === 0)
}

console.log('\n⑥ 집계')
{
  const js = [j(), j({ axis: RAW_AXIS }, okSem({ decision: 'AUTO_RAW' })),
    j({ access: 'failed' }), j({ axis: 'drop' })]
  const s = summarize(js)
  check('총계', s.total === 4)
  check('AUTO_SEED 1 · AUTO_RAW 1 · HOLD 1 · DROP 1',
    s.AUTO_SEED === 1 && s.AUTO_RAW === 1 && s.AUTO_HOLD === 1 && s.AUTO_DROP === 1)
  check('사유별로 센다', Object.keys(s.byReason).length > 0)
}

console.log('\n⑦ 🔴 하지 않는 것 — 스캔')
{
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const runner = codeOf('scripts/micro-seed-auto-judge.mts')
  const lib = codeOf('src/lib/micro-seed-auto-judge.ts')

  for (const [label, re] of [
    ['Prisma / DB', /PrismaClient|prisma\./],
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['네트워크', /fetch\(|axios|playwright|chromium/i],
    ['Sheet', /googleapis|spreadsheet/i],
    ['Raw Vault', /microSeedRawContent/],
    ['큐 적재', /originalPostApprovalQueue/],
    ['Post 생성', /post\.create/i],
    ['발행 호출', /publishOriginalPostTx\s*\(/],
    ['새 검수 UI', /renderHtml|<html|writeFileSync\([^)]*\.html/i],
  ] as const) {
    check(`🔴 러너에 ${label} 없음`, !re.test(runner))
  }
  check('🔴 lib 은 순수 함수만이다',
    !/readFileSync|writeFileSync|fetch\(|await |PrismaClient/.test(lib))
  check('🔴 러너가 사람 값을 문자열로도 안 쓴다', (() => {
    // 회귀 대조에 쓰는 lib 함수 안에만 있어야 한다
    return !/'SEED'|'ADOPT'|'founder'|'human-curated'/.test(runner)
  })())
  // 🔴 LLM 을 쓰지만 **기존 경로**만 쓴다 — 새 클라이언트를 만들지 않았다
  check('🔴 새 HTTP 클라이언트를 만들지 않았다 — callProvider 를 쓴다',
    /from '\.\/lib\/voice-m3-provider\.mjs'/.test(runner) && !/new\s+\w*Client\(/.test(runner))
  check('🔴 러너가 직접 fetch 하지 않는다', !/\bfetch\(/.test(runner))
  check('🔴 프롬프트에 전문 필드가 없다', (() => {
    const i = runner.indexOf('export function buildPayload')
    const body = runner.slice(i, runner.indexOf('\n}', i))
    return !/rawBody|sourceBody|\bbody\b/.test(body) && /bodyHead/.test(body)
  })())
  check(`🔴 보낼 때도 ${BODY_HEAD_MAX}자로 자른다`, /slice\(0, BODY_HEAD_MAX\)/.test(runner))
  check('🔴 응답 실패·잘림을 상태로 옮긴다 — 통과가 아니다',
    /statusOf\(res\.errorCode, res\.maxTokensReached\)/.test(runner))
  check('🔴 상한에 닿은 것은 재시도하지 않는다', /maxTokens/.test(runner) && /isRetryable/.test(runner))
  check('계획이 기본이고 --apply 가 있어야 쓴다',
    /const APPLY = argv\.includes\('--apply'\)/.test(runner))
  check('🔴 false pass 가 있으면 멈춘다', /reg\.falsePass\.length > 0[\s\S]{0,120}fail\(/.test(runner))
  check('🔴 기록 직전 provenance 를 검사한다', /violatesProvenance/.test(runner))
  check('🔴 산출물은 데이터 디렉터리 안에만', /isInsideDataDir/.test(runner))
  check('엔트리포인트 가드가 있다', /isDirectRun/.test(runner))
}

console.log('\n⑧ 🔴 기존 경로를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-08).
  //    상수를 `RUNTIME_PROFILE` 에서 파생시키면서 `= 1` 리터럴이 사라졌다.
  //    원래 의도가 "값이 그대로인가" 였으므로 값으로 묻는 편이 더 강하다.
  check('POST_CAP_PER_WEEK = 1 그대로', POST_CAP_PER_WEEK === 1)
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', MIN_DAYS_BETWEEN_POSTS === 5)
  check('DAILY_PUBLISH_CAP = 1 그대로', DAILY_PUBLISH_CAP === 1)
  const auto = readFileSync('src/lib/original-post-auto-publish.ts', 'utf-8')
  check('🔴 자동 발행은 여전히 human-curated 만 먹는다',
    /export const AUTO_MODEL = 'human-curated'/.test(auto))
  check('🔴 machine-shadow 는 발행 경로에 없다', !/machine-shadow/.test(auto))
  check('🔴 supply-autofill 도 그대로',
    /AUTOFILL_MODEL = 'human-curated'/.test(readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')))
}

// ── exact input — 🔴 Autopilot 이 끊긴 회차를 이을 때 그 판을 판정해야 한다 (§4-AU) ──
{
  const r = readFileSync('scripts/micro-seed-auto-judge.mts', 'utf-8')
  check('🔴 --input 으로 판정할 파일을 지정할 수 있다', /--input=/.test(r) && /inputOverride/.test(r))
  check('🔴 지정이 없으면 종전대로 디렉터리 전체를 읽는다 — 기존 동작이 바뀌지 않는다',
    /only === null[\s\S]{0,80}filesEnding\(suffix\)/.test(r))
  check('🔴 지정한 파일만 판정한다 — 최신 파일에 맡기지 않는다',
    /only\.filter\(\(f\) => f\.endsWith\(suffix\)\)/.test(r))
  check('🔴 detail 과 raw-detail 둘 다 지정 목록에서 고른다',
    /pick\('\.detail\.jsonl'\)/.test(r) && /pick\('\.raw-detail\.jsonl'\)/.test(r))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
