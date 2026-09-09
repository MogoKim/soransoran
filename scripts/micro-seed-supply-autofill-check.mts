#!/usr/bin/env tsx
/**
 * 공급 자동 보충 fixture — 🔴 **사람이 뺀 것을 기계가 도로 넣지 않는다** (§4-AN)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import { POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
import {
  planRefill, judgeApply, readStock, verifyAfterRefill, isHeld, hasPendingSibling,
  provenanceKeyOf, baseArticleId,
  STOCK_TARGET, STOCK_MIN, STOCK_WARN, MAX_ALLOWED_OVERLAP,
  AUTOFILL_ALLOWED_TYPES, REQUIRED_DECISION, SKIP_LABEL,
  type Candidate, type HeldEntry, type QueueRow,
  MACHINE_PROFILE, MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_DECIDED_BY,
  MACHINE_SITE_PREFIX, HUMAN_ONLY_VALUES, USABLE_PROMPT_VERSIONS,
  machineProfileMismatch, impersonatesHuman, buildQueuePayload, queueProfileOf,
  AUTOFILL_PROMPT_VERSION, AUTOFILL_MODEL, AUTOFILL_SITE_PREFIX,
  type Envelope, type QueueProfileRow,
} from '../src/lib/micro-seed-supply-autofill'

const NOW = '2026-09-07T12:00:00.000Z'
let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

/** 통과하는 표본 — 여기서 한 가지씩 어긋뜨려 본다 */
const ok = (o: Partial<Candidate> = {}): Candidate => ({
  candidateType: 'seedOriginality', sourceArticleId: '34998804',
  sourceSite: 'navercafe:remonterrace', sourceInput: 'navercafe:remonterrace',
  sourceDecision: 'ADOPT', title: '아이랑 같이 갈 숙소, 뭐 보고 고르세요?',
  body: '숙소 고를 때 뭘 먼저 보시는지 궁금해요.',
  safetyVerdict: 'pass', maxOverlap: 3, leakedTokens: '', reviewedAt: '2026-09-06T11:00:00Z', ...o,
})
const base = { held: [] as HeldEntry[], existing: new Set<string>(), queue: [] as QueueRow[], usable: 5 }

// 🔴 2026-09-07 에 사람이 실제로 뺀 2건 — 이 fixture 의 존재 이유다
const HELD_REAL: HeldEntry[] = [
  { sourceArticleId: '34999239', title: '주방에서 제일 오래 쓴 물건이 뭐예요?', reason: '형제(후라이팬)가 큐에 있음' },
  { sourceArticleId: '35003196', title: '아침에 뭐 드세요?', reason: '형제(간식)가 이미 발행됨' },
]

console.log('\n공급 자동 보충 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 사람이 보류한 2건이 다시 들어오지 않는다')
{
  const held1 = ok({ sourceArticleId: '34999239', title: '주방에서 제일 오래 쓴 물건이 뭐예요?' })
  const held2 = ok({ sourceArticleId: '35003196', title: '아침에 뭐 드세요?' })
  check('🔴 "주방에서 제일 오래 쓴 물건" 이 보류로 잡힌다', isHeld(held1, HELD_REAL))
  check('🔴 "아침에 뭐 드세요?" 가 보류로 잡힌다', isHeld(held2, HELD_REAL))

  const r = planRefill({ ...base, held: HELD_REAL, candidates: [held1, ok(), held2] })
  check('🔴 보류 2건이 보충 대상에서 빠진다', r.targets.length === 1)
  check('🔴 남는 것은 보류가 아닌 1건뿐', r.targets[0]!.sourceArticleId === '34998804')
  check('빠진 이유가 HELD 로 남는다',
    r.skipped.filter((s) => s.code === 'HELD').length === 2)

  // 🔴 이것이 이 검사의 핵심이다 — 제목이 키에 들어가므로 "새 후보" 로 보인다
  check('🔴 보류 2건은 existing 으로는 못 막는다 — 올린 적이 없기 때문이다', (() => {
    const existing = new Set([provenanceKeyOf('34999239', '후라이팬 언제 바꾸세요?')])
    return !existing.has(provenanceKeyOf('34999239', '주방에서 제일 오래 쓴 물건이 뭐예요?'))
  })())
  check('🔴 보류 목록이 비면 그 2건이 도로 들어온다 — 목록이 유일한 방어다', (() => {
    const r2 = planRefill({ ...base, held: [], candidates: [held1, held2] })
    return r2.targets.length === 2
  })())

  check('제목의 공백 차이는 같은 것으로 본다', isHeld(
    ok({ sourceArticleId: '35003196', title: '아침에  뭐   드세요?' }), HELD_REAL))
  check('출처가 다르면 다른 글이다',
    !isHeld(ok({ sourceArticleId: '99999', title: '아침에 뭐 드세요?' }), HELD_REAL))
}

console.log('\n② 이미 큐에 올라간 것은 제외한다')
{
  const c = ok()
  const existing = new Set([provenanceKeyOf('34998804', '아이랑 같이 갈 숙소, 뭐 보고 고르세요?')])
  const r = planRefill({ ...base, existing, candidates: [c] })
  check('🔴 이미 올린 후보는 제외', r.targets.length === 0 && r.skipped[0]?.code === 'ALREADY')
  check('synthetic id 를 원래 id 로 되돌린다', baseArticleId('34998804-9588cfda') === '34998804')
  check('접미가 없으면 그대로', baseArticleId('34998804') === '34998804')
}

console.log('\n③ 같은 원문의 형제가 안 나갔으면 제외한다')
{
  const q = (id: string, pub: string | null): QueueRow =>
    ({ sourceArticleId: id, status: pub === null ? 'APPROVED' : 'PUBLISHED', createdPostId: pub })
  check('🔴 형제가 미발행으로 큐에 있으면 제외', (() => {
    const r = planRefill({ ...base, queue: [q('34998804-aaaaaaaa', null)], candidates: [ok()] })
    return r.targets.length === 0 && r.skipped[0]?.code === 'SIBLING'
  })())
  check('🟢 형제가 이미 발행됐으면 넣는다 — 시간이 벌어졌다', (() => {
    const r = planRefill({ ...base, queue: [q('34998804-aaaaaaaa', 'post1')], candidates: [ok()] })
    return r.targets.length === 1
  })())
  check('다른 원문은 형제가 아니다',
    !hasPendingSibling('34998804', [q('35003196-bbbbbbbb', null)]))
  check('🔴 같은 회차 안에서도 형제가 겹치면 하나만', (() => {
    const r = planRefill({ ...base, candidates: [
      ok({ title: '첫 번째 초안' }), ok({ title: '두 번째 초안' }),
    ] })
    return r.targets.length === 1 && r.skipped[0]?.code === 'SIBLING'
  })())
}

console.log('\n④ 값이 어긋난 후보를 거른다')
{
  const cases: [string, Partial<Candidate>, string][] = [
    ['SRN 은 경로가 다르다', { candidateType: 'shortRawNoindex' }, 'TYPE'],
    ['모르는 유형', { candidateType: 'growthIssue' }, 'TYPE'],
    // 🔴 이제 profile 로 통째로 본다 — 사람도 기계도 아닌 조합은 PROFILE 이다
    ['Seed 인데 ADOPT 가 아니다', { candidateType: 'seedOriginality', sourceDecision: 'HOLD' }, 'PROFILE'],
    ['Raw 인데 SAVE 가 아니다', { candidateType: 'rawOriginality', sourceDecision: 'ADOPT' }, 'PROFILE'],
    ['safety hold', { safetyVerdict: 'hold' }, 'SAFETY'],
    ['safety 없음', { safetyVerdict: '' }, 'SAFETY'],
    ['겹침 초과', { maxOverlap: MAX_ALLOWED_OVERLAP + 1 }, 'OVERLAP'],
    ['유출 토큰', { leakedTokens: '연락처' }, 'LEAK'],
    ['제목 빔', { title: '  ' }, 'EMPTY'],
    ['본문 빔', { body: '' }, 'EMPTY'],
  ]
  for (const [label, patch, code] of cases) {
    const r = planRefill({ ...base, candidates: [ok(patch)] })
    check(`🔴 ${label} → 제외 (${code})`, r.targets.length === 0 && r.skipped[0]?.code === code)
  }
  check('🟢 Raw 는 SAVE 면 통과', planRefill({ ...base, candidates: [
    ok({ candidateType: 'rawOriginality', sourceDecision: 'SAVE' }),
  ] }).targets.length === 1)
  // 🔴 경계값은 통과가 아니다 — 정책은 6자 **미만**이다
  check(`🔴 겹침이 ${MAX_ALLOWED_OVERLAP}자면 거절`, planRefill({ ...base, candidates: [
    ok({ maxOverlap: MAX_ALLOWED_OVERLAP }),
  ] }).targets.length === 0)
  check(`🟢 ${MAX_ALLOWED_OVERLAP - 1}자는 통과`, planRefill({ ...base, candidates: [
    ok({ maxOverlap: MAX_ALLOWED_OVERLAP - 1 }),
  ] }).targets.length === 1)
  check('허용 유형은 둘뿐', AUTOFILL_ALLOWED_TYPES.length === 2)
  check('유형마다 요구 결정이 다르다',
    REQUIRED_DECISION.seedOriginality === 'ADOPT' && REQUIRED_DECISION.rawOriginality === 'SAVE')
  check('제외 사유에 라벨이 있다', Object.keys(SKIP_LABEL).length === 11)
}

console.log('\n⑤ 재고 계산 — 🔴 발행 러너가 인정하는 행만 센다')
{
  const hRow = (o: Partial<QueueProfileRow & { status: string; createdPostId: string | null }> = {}) => ({
    status: 'APPROVED', createdPostId: null,
    promptVersion: AUTOFILL_PROMPT_VERSION, model: AUTOFILL_MODEL,
    sourceSite: `${AUTOFILL_SITE_PREFIX}navercafe:x`, gateResults: {}, ...o,
  })
  const mRow = (o: Partial<QueueProfileRow & { status: string; createdPostId: string | null }> = {}) => ({
    status: 'APPROVED', createdPostId: null,
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}82cook`,
    gateResults: { autoDraft: {
      provenance: MACHINE_PROFILE.envelopeProvenance,
      sourceDecision: MACHINE_PROFILE.sourceDecision,
      draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    } }, ...o,
  })
  check('🟢 사람 행을 센다', readStock([hRow()]).human === 1)
  check('🟢 기계 행도 센다', readStock([mRow()]).machine === 1)
  check('합계가 맞다', readStock([hRow(), mRow()]).usable === 2)
  check('🔴 legacy 는 재고가 아니다',
    readStock([hRow({ promptVersion: '13~14판' })]).usable === 0)
  check('🔴 발행된 것은 재고가 아니다', readStock([hRow({ createdPostId: 'p' })]).usable === 0)
  check('🔴 PENDING 은 재고가 아니다', readStock([hRow({ status: 'PENDING' })]).usable === 0)
  check('EDITED 는 재고다', readStock([hRow({ status: 'EDITED' })]).usable === 1)

  // 🔴 **잘못된 machine tuple 은 재고 0** — 판만 맞고 나머지가 어긋나면 아무도 못 먹는다
  check('🔴 기계 판인데 사람 접두 → 재고 0',
    readStock([mRow({ sourceSite: `${AUTOFILL_SITE_PREFIX}82cook` })]).usable === 0)
  check('🔴 기계 판인데 모델이 사람 것 → 재고 0',
    readStock([mRow({ model: AUTOFILL_MODEL })]).usable === 0)
  check('🔴 기계 판인데 gateResults 표시 없음 → 재고 0',
    readStock([mRow({ gateResults: {} })]).usable === 0)
  check('🔴 기계 판인데 gate 가 옛 판 → 재고 0', readStock([mRow({
    gateResults: { autoDraft: { provenance: 'machine-generated', sourceDecision: 'AUTO_ADOPT', draftRuleVersion: 'auto-draft-v2' } },
  })]).usable === 0)
  check('🔴 사람 판인데 기계 접두 → 재고 0',
    readStock([hRow({ sourceSite: `${MACHINE_SITE_PREFIX}x` })]).usable === 0)

  check(`경고선 ${STOCK_WARN} 이하`, readStock(Array.from({ length: 3 }, () => hRow())).level === 'critical')
  check(`${STOCK_MIN} 이상은 ok`, readStock(Array.from({ length: 5 }, () => hRow())).level === 'ok')
  check('부족분을 목표 기준으로 센다',
    readStock(Array.from({ length: 5 }, () => hRow())).shortfall === STOCK_TARGET - 5)
}

console.log('\n⑤-b 🔴 통합 — 만들어질 행이 발행 러너에게 machine 으로 보이는가')
{
  const mEnv: Envelope = {
    provenance: MACHINE_PROFILE.envelopeProvenance,
    ruleVersion: MACHINE_PROFILE.envelopeRuleVersion,
    promptVersion: MACHINE_PROFILE.envelopePromptVersion,
    model: MACHINE_PROFILE.envelopeModel,
  }
  const mc = ok({
    sourceDecision: 'AUTO_ADOPT', sourceInput: 'auto-judge',
    candidateType: 'seedOriginality', maxOverlap: 4, leakedTokens: '',
  })
  const aj = { ruleVersion: 'auto-judge-v3', promptVersion: 'semantic-shadow-v2b',
    model: 'claude-haiku-4.5', inputHash: 'abc123', provenance: 'machine-shadow' }
  const p1 = buildQueuePayload({ envelope: mEnv, candidate: mc, autoJudge: aj, now: NOW })
  check('🟢 기계 payload 가 만들어진다', p1 !== null && p1.profile === 'machine')
  // 🔴 이것이 P0 회귀 fixture다 — 만든 행을 그대로 발행 러너 눈으로 본다
  check('🔴 만들어진 machine 행이 profileOf=machine 이다', p1 !== null && queueProfileOf({
    promptVersion: p1.promptVersion, model: p1.model,
    sourceSite: p1.syntheticSite, gateResults: p1.gateResults,
  }) === 'machine')
  check('🔴 기계 접두를 쓴다', p1 !== null && p1.syntheticSite.startsWith(MACHINE_SITE_PREFIX))
  check('🔴 decidedBy 가 founder 가 아니다', p1 !== null && p1.decidedBy === MACHINE_DECIDED_BY)
  check('🔴 autoJudge 를 상수가 아니라 후보 값으로 남긴다', (() => {
    const g = p1?.gateResults.autoJudge as Record<string, unknown> | undefined
    return g?.ruleVersion === 'auto-judge-v3' && g?.inputHash === 'abc123'
  })())
  check('🔴 판정 출처가 없으면 payload 를 만들지 않는다',
    buildQueuePayload({ envelope: mEnv, candidate: mc, now: NOW }) === null)
  check('🔴 provenance 에 원문·제목·본문이 없다', (() => {
    const j = JSON.stringify(p1?.gateResults ?? {})
    return !/bodyHead|rawBody|"title"|"body"/.test(j)
  })())

  const p2 = buildQueuePayload({ envelope: {}, candidate: ok(), now: NOW })
  check('🟢 사람 payload 도 만들어진다', p2 !== null && p2.profile === 'human')
  check('🔴 만들어진 human 행이 profileOf=human 이다', p2 !== null && queueProfileOf({
    promptVersion: p2.promptVersion, model: p2.model,
    sourceSite: p2.syntheticSite, gateResults: p2.gateResults,
  }) === 'human')

  // 🔴 provenance 세탁 금지 — 입력이 틀렸는데 정상 상수를 찍지 않는다
  for (const [label, patch] of [
    ['envelope.promptVersion 없음', { promptVersion: '' }],
    ['envelope.model 이 사람 것', { model: 'human-curated' }],
  ] as const) {
    check(`🔴 ${label} → payload 없음`,
      buildQueuePayload({ envelope: { ...mEnv, ...patch }, candidate: mc, autoJudge: aj, now: NOW }) === null)
  }
  for (const [label, patch] of [
    ['maxOverlap 이 없음', { maxOverlap: undefined }],
    ['maxOverlap 6', { maxOverlap: 6 }],
    ['safety 미통과', { safetyVerdict: 'hold' }],
    ['leakedTokens 있음', { leakedTokens: '연락처' }],
  ] as const) {
    check(`🔴 ${label} → payload 없음`, buildQueuePayload({
      envelope: mEnv, candidate: ok({ ...mc, ...patch } as never), autoJudge: aj, now: NOW,
    }) === null)
  }
}

console.log('\n⑥ 실행 게이트 — 두 스위치가 다 있어야 한다')
{
  const t = [ok()]
  const g = { targets: t, apply: true, limit: 1, usable: 5 }
  check('🟢 전부 맞으면 통과', judgeApply(g).ok)
  check('🔴 --apply 없으면 안 돈다', !judgeApply({ ...g, apply: false }).ok)
  check('🔴 --limit 없으면 안 돈다', !judgeApply({ ...g, limit: null }).ok)
  check('🔴 --limit 0 이면 안 돈다', !judgeApply({ ...g, limit: 0 }).ok)
  check('🔴 --limit 이 음수면 안 돈다', !judgeApply({ ...g, limit: -1 }).ok)
  check('🔴 후보 0건이면 안 돈다', !judgeApply({ ...g, targets: [] }).ok)
  check(`🔴 재고가 목표 ${STOCK_TARGET}건이면 안 돈다`, !judgeApply({ ...g, usable: STOCK_TARGET }).ok)
  check('🔴 --limit 을 못 채우면 잘라내지 않고 멈춘다', (() => {
    const r = judgeApply({ ...g, limit: 3 })
    return !r.ok && r.reason.includes('잘라내지 않고 멈춘다')
  })())
  /**
   * 🔴 **자동 경로는 상한이다** (2026-09-09 Wave B 실측).
   *    목표를 42 로 올리자 부족분 29 를 `--limit` 으로 요구해 후보 1건에서 **적재 0건**이 됐다.
   *    사람이 주는 `--limit`(정확히)과 러너가 주는 `--up-to`(상한까지)를 나눈다.
   */
  check('🔴 --up-to 는 못 채워도 있는 만큼 적재한다', (() => {
    const r = judgeApply({ ...g, limit: null, upTo: 29 })
    return r.ok && r.take.length === g.targets.length
  })())
  check('🔴 --up-to 도 상한을 넘기지 않는다', (() => {
    const many = Array.from({ length: 5 }, (_, i) => ok({ title: `t${i}`, sourceArticleId: `a${i}` }))
    const r = judgeApply({ targets: many, apply: true, limit: null, upTo: 2, usable: 0, target: 42 })
    return r.ok && r.take.length === 2
  })())
  check('🔴 --up-to 도 목표 여력을 넘기지 않는다', (() => {
    const many = Array.from({ length: 5 }, (_, i) => ok({ title: `t${i}`, sourceArticleId: `a${i}` }))
    const r = judgeApply({ targets: many, apply: true, limit: null, upTo: 99, usable: 41, target: 42 })
    return r.ok && r.take.length === 1
  })())
  check('🔴 --up-to 와 --limit 을 함께 주면 막는다', (() => {
    const r = judgeApply({ ...g, limit: 1, upTo: 1 })
    return !r.ok && r.reason.includes('함께 주지 않는다')
  })())
  check('🔴 --up-to 여도 후보 0건이면 안 돈다', !judgeApply({ ...g, limit: null, upTo: 29, targets: [] }).ok)
  check('🔴 사람이 주는 --limit 의 "정확히" 계약은 그대로다', (() => {
    const r = judgeApply({ ...g, limit: 3 })
    return !r.ok && r.reason.includes('잘라내지 않고 멈춘다')
  })())
  check('🔴 러너는 --up-to 로 부른다 — --limit 으로 부르지 않는다', (() => {
    const lib = readFileSync('src/lib/supply-autopilot.ts', 'utf-8')
    return /mk\('fill', \['--apply', `--up-to=\$\{input\.shortfall\}`\]\)/.test(lib)
      && !/mk\('fill', \['--apply', `--limit=/.test(lib)
  })())
  check('🔴 autofill CLI 가 --up-to 를 실제로 판정부에 넘긴다', (() => {
    const cli = readFileSync('scripts/micro-seed-supply-autofill.mts', 'utf-8')
    return /const UP_TO = UP_TO_RAW === null \? null : Number\.parseInt\(UP_TO_RAW, 10\)/.test(cli)
      && /judgeApply\(\{ targets, apply: APPLY, limit: LIMIT, upTo: UP_TO,/.test(cli)
  })())
  check('여력만큼만 가져간다', (() => {
    const many = Array.from({ length: 5 }, (_, i) => ok({ title: `t${i}`, sourceArticleId: `a${i}` }))
    const r = judgeApply({ targets: many, apply: true, limit: 2, usable: 10 })
    return r.ok && r.take.length === 2
  })())
}

console.log('\n⑦ 🔴 발행하지 않는다 — 정합이 이것을 잡는다')
{
  const b = { raw: 48, queue: 14, post: 38 }
  check('🟢 정상 보충', verifyAfterRefill({ before: b, after: { raw: 50, queue: 16, post: 38 }, added: 2 }).ok)
  check('🔴 Post 가 늘면 실패다 — 공급은 발행하지 않는다', (() => {
    const r = verifyAfterRefill({ before: b, after: { raw: 50, queue: 16, post: 39 }, added: 2 })
    return !r.ok && r.problems.some((p) => p.includes('발행하지 않는다'))
  })())
  check('🔴 Post 가 줄어도 실패다', !verifyAfterRefill({
    before: b, after: { raw: 50, queue: 16, post: 37 }, added: 2 }).ok)
  check('RawContent 증가가 안 맞으면 실패', !verifyAfterRefill({
    before: b, after: { raw: 49, queue: 16, post: 38 }, added: 2 }).ok)
  check('Queue 증가가 안 맞으면 실패', !verifyAfterRefill({
    before: b, after: { raw: 50, queue: 15, post: 38 }, added: 2 }).ok)
}

console.log('\n⑧ 🔴 원문 컬럼을 만들지 않는다 · 발행 코드가 없다')
{
  // 🔴 주석을 지우고 본다 — 주석에 적힌 금지 패턴이 자기 자신을 잡으면 안 된다
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const lib = codeOf('src/lib/micro-seed-supply-autofill.ts')
  const runner = codeOf('scripts/micro-seed-supply-autofill.mts')

  for (const [label, re] of [
    ['post.create', /post\.create|Post\.create/],
    ['comment 생성', /comment\.create/i],
    ['ActivityLog 생성', /ActivityLog\.create/i],
    ['persona 배정', /matchedPersonaId|planBatch|planStore/],
    // 🔴 로그에 이름을 적는 것은 호출이 아니다. import 와 호출 형태만 잡는다
    ['publish 호출', /publishOriginalPostTx\s*\(|from\s+'[^']*(?:publish-live|auto-publish)'/],
    ['PUBLISHED 전환', /status:\s*'PUBLISHED'/],
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['LLM', /openai|anthropic|gemini|gpt-/i],
    ['Sheet', /googleapis|sheets\.|spreadsheet/i],
    ['네이버 네트워크', /naver\.com|playwright|chromium/i],
  ] as const) {
    check(`🔴 러너에 ${label} 없음`, !re.test(runner))
  }

  // 🔴 원문 컬럼 — 남의 글 전문을 우리 저장소에 쌓지 않는다 (§4-AF ⑤)
  for (const col of ['bodyHead', 'sourceBody', 'sourceTitle', 'rawComments'] as const) {
    check(`🔴 ${col} 컬럼을 쓰지 않는다`, !new RegExp(`\\b${col}\\b`).test(runner + lib))
  }

  check('🔴 lib 은 순수 함수만이다 — DB·파일·네트워크 없음',
    !/PrismaClient|readFileSync|writeFileSync|fetch\(|await /.test(lib))
  check('러너가 두 스위치를 요구한다',
    /--apply/.test(runner) && /--limit=N/.test(runner))
  check('러너가 보류 파일을 읽는다', /held-candidates\.json/.test(runner))
  check('🔴 보류 파일이 없으면 멈춘다', (() => {
    // `if (missing) { … process.exit(1) }` 블록이 실제로 있는지 본다
    const i = runner.indexOf('if (missing)')
    if (i < 0) return false
    const block = runner.slice(i, runner.indexOf('\n  }', i))
    return /process\.exit\(1\)/.test(block)
  })())
  check('🔴 "없다" 와 "비었다" 를 구분한다',
    /missing:\s*true/.test(runner) && /missing:\s*false/.test(runner))
  check('엔트리포인트 가드가 있다', /isDirectRun/.test(runner))
}

console.log('\n⑨ 🔴 pacing 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-08).
  //    상수를 `RUNTIME_PROFILE` 에서 파생시키면서 `= 1` 같은 리터럴이 사라졌다.
  //    문자열을 찾던 검사는 "값이 그대로인가" 를 물으려던 것이므로, 값으로 묻는 편이 더 강하다 —
  //    프로필이 바뀌면 문자열은 그대로여도 값이 달라질 수 있다.
  check('POST_CAP_PER_WEEK = 1 그대로', POST_CAP_PER_WEEK === 1)
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', MIN_DAYS_BETWEEN_POSTS === 5)
  const pub = readFileSync('src/lib/original-post-publish.ts', 'utf-8')
  check('DAILY_PUBLISH_CAP = 1 그대로', DAILY_PUBLISH_CAP === 1)
  const lib = readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')
  check('🔴 공급 lib 이 발행 상수를 재정의하지 않는다',
    !/DAILY_PUBLISH_CAP|POST_CAP_PER_WEEK|MIN_DAYS_BETWEEN_POSTS/.test(lib))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
