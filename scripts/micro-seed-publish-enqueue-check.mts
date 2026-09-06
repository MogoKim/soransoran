#!/usr/bin/env tsx
/**
 * 발행 후보 → 대기열 브리지 fixture — 🔴 **계약이 어긋나면 여기서 멈춘다** (§4-AJ)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  planEnqueue, readCandidates, latestCandidateFile, provenanceKey, syntheticArticleId,
  bridgeDedupKey, bridgeGateResults,
  SYNTHETIC_SITE_PREFIX, BRIDGE_PROMPT_VERSION, BRIDGE_MODEL, BRIDGE_GATE_VERDICT,
  ALLOWED_TYPES, TODAY_TITLES, type Candidate,
} from './micro-seed-publish-enqueue.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const cand = (o: Partial<Candidate>): Candidate => ({
  candidateType: 'seedOriginality', sourceArticleId: 'A1', sourceSite: 'navercafe:x',
  sourceInput: 'seed-review-r1.json', sourceDecision: 'ADOPT',
  title: TODAY_TITLES[0], body: '본문', safetyVerdict: 'pass', maxOverlap: 2,
  leakedTokens: '', reviewedAt: '2026-09-06T00:00:00Z', ...o,
})
const none = new Set<string>()

console.log('\n발행 후보 → 대기열 브리지 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 무엇이 올라가나 — 사람이 고른 것만')
{
  const { plan, skipped } = planEnqueue([
    cand({}),
    cand({ title: TODAY_TITLES[1], candidateType: 'rawOriginality', sourceDecision: 'SAVE', sourceArticleId: 'A2' }),
    cand({ title: TODAY_TITLES[0], sourceArticleId: 'B1', sourceDecision: 'REVISE' }),
    cand({ title: TODAY_TITLES[0], sourceArticleId: 'B2', sourceDecision: 'HOLD' }),
    cand({ title: TODAY_TITLES[0], sourceArticleId: 'B3', sourceDecision: 'DROP' }),
    cand({ title: TODAY_TITLES[0], sourceArticleId: 'B4', sourceDecision: '' }),
  ], { all: false, existing: none })
  check('🔴 ADOPT · SAVE 만 올라간다', plan.length === 2)
  check('🔴 REVISE · HOLD · DROP · 미선택은 제외', skipped.filter((s) => s.reason.startsWith('판정')).length === 4)
  check('Seed 와 Raw 둘 다 받는다',
    plan.some((p) => p.candidate.candidateType === 'seedOriginality')
    && plan.some((p) => p.candidate.candidateType === 'rawOriginality'))
}

console.log('\n② 🔴 SRN 은 오지 않는다 — noindex 정책이 다르다')
{
  check('허용 축은 둘뿐', ALLOWED_TYPES.join(',') === 'seedOriginality,rawOriginality')
  check('🔴 shortRawNoindex 축은 제외', !ALLOWED_TYPES.includes('shortRawNoindex'))
  const { plan, skipped } = planEnqueue([
    cand({ candidateType: 'shortRawNoindex', sourceDecision: 'APPROVE' }),
    cand({ candidateType: 'shortRawNoindex', sourceDecision: 'ADOPT' }),
  ], { all: false, existing: none })
  check('🔴 SRN 은 판정과 무관하게 올라가지 않는다', plan.length === 0 && skipped.length === 2)
  check('제외 사유에 축이 남는다', skipped.every((s) => s.reason.startsWith('축')))
}

console.log('\n③ 안전·본문 확인')
{
  const { plan, skipped } = planEnqueue([
    cand({ safetyVerdict: 'hold', sourceArticleId: 'S1' }),
    cand({ safetyVerdict: 'hardExclude', sourceArticleId: 'S2' }),
    cand({ safetyVerdict: '', sourceArticleId: 'S3' }),
    cand({ body: '', sourceArticleId: 'S4' }),
    cand({ title: '', sourceArticleId: 'S5' }),
    cand({ sourceArticleId: '' }),
  ], { all: false, existing: none })
  check('🔴 safety 가 pass 가 아니면 올리지 않는다', plan.length === 0)
  check('safety 사유가 남는다', skipped.filter((s) => s.reason.startsWith('safety')).length === 3)
  check('본문 없으면 제외', skipped.some((s) => s.reason === '본문 없음'))
  check('제목·id 없으면 제외', skipped.filter((s) => s.reason === '식별 불가').length === 2)
}

console.log('\n④ 오늘 2건만 — --all 로 푼다')
{
  const other = cand({ title: '다른 글입니다', sourceArticleId: 'C1' })
  const a = planEnqueue([cand({}), other], { all: false, existing: none })
  check('🔴 기본은 오늘 목록만', a.plan.length === 1 && a.skipped.some((s) => s.reason === '오늘 대상 아님'))
  const b = planEnqueue([cand({}), other], { all: true, existing: none })
  check('--all 이면 전부 본다', b.plan.length === 2)
  check('오늘 목록이 둘이다', TODAY_TITLES.length === 2)
  check('오늘 목록에 간식 글이 있다', TODAY_TITLES.some((t) => t.includes('간식')))
  check('오늘 목록에 엄마 글이 있다', TODAY_TITLES.some((t) => t.includes('엄마가 일을')))
}

console.log('\n⑤ 중복 — 같은 글은 두 번 올라가지 않는다')
{
  const c = cand({})
  const key = provenanceKey('A1', TODAY_TITLES[0]!)
  const { plan, skipped } = planEnqueue([c], { all: false, existing: new Set([key]) })
  check('🔴 이미 올린 것은 건너뛴다', plan.length === 0 && skipped[0]!.reason === '이미 올림')
  check('키는 id + 제목이다 — id 만으로는 서로 다른 초안이 사라진다',
    provenanceKey('X', '가 나') === 'X 가 나' && provenanceKey('X', ' 가  나 ') === 'X 가 나')
  check('🔴 같은 id 다른 제목은 서로 다른 글이다',
    provenanceKey('X', '제목1') !== provenanceKey('X', '제목2'))
}

console.log('\n⑥ synthetic 행 — 원문이 아님을 표시한다')
{
  const { plan } = planEnqueue([cand({})], { all: false, existing: none })
  const p = plan[0]!
  check('🟡 sourceSite 에 표시가 붙는다', p.syntheticSite.startsWith(SYNTHETIC_SITE_PREFIX))
  check('원래 소스도 지우지 않는다 — 어디서 온 소재인지는 남는다',
    p.syntheticSite.includes('navercafe:x'))
  check('sourceUrl 에 후보 파일이 적힌다', p.syntheticUrl.includes('seed-review-r1.json'))
  check('sourceUrl 이 실제 접속 가능한 주소가 아니다', !/^https?:/.test(p.syntheticUrl))
  check('🔴 synthetic articleId 는 원래 id 와 다르다 — 나중 원문 수집과 부딪히지 않는다',
    syntheticArticleId('A1', '제목') !== 'A1' && syntheticArticleId('A1', '제목').startsWith('A1-'))
  check('같은 글이면 같은 id, 다른 글이면 다른 id',
    syntheticArticleId('A1', '제목') === syntheticArticleId('A1', '제목')
    && syntheticArticleId('A1', '제목') !== syntheticArticleId('A1', '다른제목'))
  check('reviewedAt 이 capturedAt 이 된다', p.capturedAt.toISOString().startsWith('2026-09-06'))
  check('reviewedAt 이 깨져도 죽지 않는다',
    planEnqueue([cand({ reviewedAt: '깨진값' })], { all: false, existing: none })
      .plan[0]!.capturedAt instanceof Date)
}

console.log('\n⑦ 큐 필드 — 사람이 쓴 글임을 못박는다')
{
  check('🔴 promptVersion 이 브리지 값', BRIDGE_PROMPT_VERSION === 'publish-candidate-v1')
  check('🔴 model 이 human-curated — LLM 이 아니다', BRIDGE_MODEL === 'human-curated')
  check('gateVerdict 는 기존 게이트가 요구하는 PASS', BRIDGE_GATE_VERDICT === 'PASS')
  const g = bridgeGateResults(cand({ maxOverlap: 5, provenanceNote: '출처설명' })) as Record<string, unknown>
  check('기존 형식(holds·blocks)을 지킨다',
    Array.isArray(g.holds) && Array.isArray(g.blocks))
  check('우리가 확인한 것이 기록된다',
    JSON.stringify(g.bridge).includes('사람이 고른 발행 후보')
    && JSON.stringify(g.bridge).includes('출처설명'))
  check('dedupKey 는 sha256: 모양', /^sha256:[0-9a-f]{64}$/.test(bridgeDedupKey('raw1', '본문')))
  check('본문이 다르면 dedupKey 도 다르다', bridgeDedupKey('raw1', 'a') !== bridgeDedupKey('raw1', 'b'))
  check('원문 id 가 다르면 dedupKey 도 다르다', bridgeDedupKey('r1', 'a') !== bridgeDedupKey('r2', 'a'))
}

console.log('\n⑧ 🔴 이 스크립트가 하지 않는 것')
{
  const src = readFileSync('scripts/micro-seed-publish-enqueue.mts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [label, re] of [
    ['실제 발행(post.create)', /post\.create|publishOriginalPostTx|publishCandidateTx/],
    ['승인 전환(APPROVED)', /status:\s*'APPROVED'|'EDITED'/],
    ['페르소나 배정', /matchedPersonaId|matchedPersona:/],
    ['LLM 호출', /openai|anthropic|claude-|gpt-/i],
    ['네이버 접속', /cafe\.naver\.com|playwright|chromium|fetch\(/],
    ['Google Sheet', /googleapis|spreadsheet/i],
    ['82cook', /82cook/],
    ['마이그레이션', /\$executeRaw|ALTER TABLE|migrate/i],
  ] as const) check(`🔴 ${label} 없음`, !re.test(src))
  check('🔴 status 는 PENDING 으로만 만든다',
    /status:\s*'PENDING'/.test(src) && (src.match(/status:\s*'[A-Z]+'/g) ?? []).every((x) => x.includes('PENDING')))
  check('🔴 두 스위치가 있어야 write 한다', /if \(!APPLY\)/.test(src) && /--limit=N/.test(src))
  check('🔴 금지 호칭 없음', !['시니어', '어르신', '노인', '실버'].some((w) => src.includes(w)))
  check('엔트리포인트 가드', /if \(isDirectRun\) void main\(\)/.test(src))
}

console.log('\n⑨ 실제 후보 파일이 있으면 함께 본다')
try {
  const f = latestCandidateFile('.microseed-data')
  if (f === null) throw new Error('no file')
  const list = readCandidates(f)
  const { plan, skipped } = planEnqueue(list, { all: false, existing: none })
  check(`실 파일 후보 ${list.length}건 → 오늘 대상 ${plan.length}건`, plan.length === 2)
  check('🔴 오늘 2건이 정확히 그 둘이다',
    plan.every((p) => TODAY_TITLES.includes(String(p.candidate.title))))
  check('🔴 둘 다 safety pass', plan.every((p) => p.candidate.safetyVerdict === 'pass'))
  check('나머지는 "오늘 대상 아님" 으로만 빠진다',
    skipped.every((s) => s.reason === '오늘 대상 아님'))
  check('🔴 후보에 body 전문·bodyHead 가 없다',
    !list.some((c) => Object.prototype.hasOwnProperty.call(c, 'bodyHead')))
} catch {
  console.log('  🟡 .microseed-data/publish-candidates-* 없음 — 건너뜀')
}

console.log('\n⑩ 입력 읽기')
{
  const dir = mkdtempSync(join(tmpdir(), 'pub-enq-'))
  writeFileSync(join(dir, 'publish-candidates-1.json'), JSON.stringify({ candidates: [cand({})] }), 'utf-8')
  writeFileSync(join(dir, 'publish-candidates-2.json'),
    JSON.stringify({ candidates: [cand({ title: TODAY_TITLES[1], sourceArticleId: 'Z' })] }), 'utf-8')
  check('🔴 이름순 최신 파일을 고른다', String(latestCandidateFile(dir)).endsWith('publish-candidates-2.json'))
  check('후보를 읽는다', readCandidates(join(dir, 'publish-candidates-1.json')).length === 1)
  writeFileSync(join(dir, 'publish-candidates-3.json'), '{깨짐', 'utf-8')
  check('깨진 파일은 빈 배열', readCandidates(join(dir, 'publish-candidates-3.json')).length === 0)
  check('없는 디렉터리는 null', latestCandidateFile(join(dir, 'nope')) === null)
  rmSync(dir, { recursive: true, force: true })
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
