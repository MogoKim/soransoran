#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 독립 감사 루프 — 순수 계약 검사** (2026-09-27) · DB 0 · 네트워크 0 · LLM 0
 *
 *   의미 감사 판정(fail-closed) · 묶음(글·도장·원문 근거·카드) · 판·모델 분리 · 합치기 ·
 *   유료 기본 OFF · 감사 러너 템플릿 · 배선(러너·발행 러너·발행 트랜잭션·관리자 경계).
 *   실행 경로는 `auto-ready:audit-db-check`(격리 DB · 실제 러너 프로세스)와
 *   `auto-ready:defect-http-check`(실제 HTTP) 가 본다.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { AUDIT_CONTRACT_VERSION, makeStamp, type AuditVerdict } from '../src/lib/auto-ready-v2'
import { INTEGRITY_MODEL, INTEGRITY_PROMPT_VERSION } from '../src/lib/auto-ready-repo'
import {
  SEMANTIC_AUDIT_CONTRACT_VERSION, SEMANTIC_AUDIT_MODEL, SEMANTIC_AUDIT_PROMPT_VERSION, SEMANTIC_AUDITOR, SEMANTIC_PAID_ENV,
  SEMANTIC_AUDIT_MAX_OUTPUT_TOKENS, semanticPaidEnabled, parseSemanticAuditResponse, judgeSemantic, semanticBindingOf,
  buildSemanticAuditRequest, combineAuditVerdicts, type SemanticAuditContext, type SemanticAuditProvider, type SemanticVerdict,
} from '../src/lib/auto-ready-semantic-audit'
import { AUDIT_OVERDUE_HOURS, automatedAuditorOk, adminReasonsOf } from '../src/lib/auto-ready-audit-store'
import { REVIEWER_KINDS, isHumanReviewer } from '../src/lib/review-provenance'
import { priceOf, reserveOf } from '../src/lib/llm-pricing'
import { LEDGER_STAGES, PAID_STAGES } from '../src/lib/llm-ledger'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { ruleAuditJudge, RULE_JUDGE_MODEL, RULE_JUDGE_PROMPT_VERSION } from './lib/auto-ready-rule-judge.mjs'
import { offSemanticProvider, semanticProviderFromEnv } from './lib/auto-ready-semantic-provider.mjs'
import {
  AUDIT_INTERVAL_MINUTES, AUDIT_RUNNER_ARGS, AUDIT_RUNNER_LABEL, AUDIT_RUNNER_SCRIPT, auditRunnerSlots, renderAuditRunnerPlist, verifyAuditSlots,
} from './lib/auto-ready-audit-template'
import { AUDIT_POOL_DOC } from './lib/auto-ready-audit-context.mjs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
/** 주석을 뺀 코드 — 주석 속 문장으로 통과하지 않게 한다 */
const codeOnly = (p: string): string => readFileSync(p, 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')

console.log('\n══ 자동 READY 독립 감사 루프 — 순수 계약 (DB 0 · 네트워크 0 · LLM 0) ══\n')

const CARDS = parsePoolDoc(readFileSync(AUDIT_POOL_DOC, 'utf-8')).cards
const cardOf = (code: string) => CARDS.find((c) => c.code === code)!
const CTX: SemanticAuditContext = {
  post: { id: 'post-1', title: '아침 산책', body: '아침에 공원을 한 바퀴 걸었어요. 다들 어떤 운동 하세요?' },
  stamp: makeStamp('아침 산책', '아침에 공원을 한 바퀴 걸었어요. 다들 어떤 운동 하세요?', new Date('2026-09-27T00:00:00Z')),
  artifact: { artifactId: 'art-1', sourceArticleId: '5001', sourceTitle: '산책 이야기', sourceBody: '아침 산책이 좋다는 이야기' },
  persona: { code: 'P01', card: cardOf('P01') },
}
const scripted = (text: string, model = SEMANTIC_AUDIT_MODEL): SemanticAuditProvider => ({ model, complete: async () => ({ ok: true, text }) })
const CLEAN = JSON.stringify({ unsupportedFacts: [], lifeContradictions: [], sourceDistortions: [], defect: 'no' })
const FOUND = JSON.stringify({ unsupportedFacts: [{ claim: '3억', why: '원문에 없다' }], lifeContradictions: [], sourceDistortions: [], defect: 'yes' })

console.log('① 판 · 모델 · 계약 — 무결성 감사자와 섞지 않는다')
{
  const S = (v: string): string => v
  check('🔴 의미 감사 모델 ≠ 무결성·규칙 모델', S(SEMANTIC_AUDIT_MODEL) !== S(INTEGRITY_MODEL) && S(SEMANTIC_AUDIT_MODEL) !== S(RULE_JUDGE_MODEL))
  check('🔴 의미 감사 프롬프트 판 ≠ 무결성·규칙 판', S(SEMANTIC_AUDIT_PROMPT_VERSION) !== S(INTEGRITY_PROMPT_VERSION) && S(SEMANTIC_AUDIT_PROMPT_VERSION) !== S(RULE_JUDGE_PROMPT_VERSION))
  check('🔴 의미 감사 계약 판 ≠ 감사 계약 판(repo · 그대로)', (SEMANTIC_AUDIT_CONTRACT_VERSION as string) !== AUDIT_CONTRACT_VERSION && AUDIT_CONTRACT_VERSION === 'auto-ready-audit-v1')
  check('🔴 감사자 표식은 비사람 종류(review-provenance 닫힌 목록)', (REVIEWER_KINDS as readonly string[]).includes(SEMANTIC_AUDITOR) && !isHumanReviewer(SEMANTIC_AUDITOR))
  check('🔴 자동 감사자는 human:* · founder 일 수 없다', !automatedAuditorOk('human:operator') && !automatedAuditorOk('founder') && !automatedAuditorOk(' ') && automatedAuditorOk(`${SEMANTIC_AUDITOR}:runner`))
  check('🔴 의미 감사 모델은 가격표에 단가가 있다 — 예약액을 낼 수 있다', priceOf(SEMANTIC_AUDIT_MODEL) !== null)
  check('🔴 장부 단계 semanticAudit 는 유료 단계다', (LEDGER_STAGES as readonly string[]).includes('semanticAudit') && PAID_STAGES.includes('semanticAudit'))
}

console.log('\n② 🔴 유료 호출 — 기본 OFF')
{
  check('🔴 🔴 **스위치가 없으면 OFF**', !semanticPaidEnabled({}) && !semanticPaidEnabled({ [SEMANTIC_PAID_ENV]: 'true' }) && semanticPaidEnabled({ [SEMANTIC_PAID_ENV]: 'on' }))
  check('🔴 🔴 **env 기본값으로 고르면 부르지 않는 제공사다**', semanticProviderFromEnv({}, 'r').provider === offSemanticProvider && semanticProviderFromEnv({}, 'r').session === null)
  const on = semanticProviderFromEnv({ [SEMANTIC_PAID_ENV]: 'on' }, 'r')
  check('ON 이면 장부 세션이 붙은 유료 제공사 · 예산 env 가 비면 그 이름을 적는다', on.session !== null && on.provider !== offSemanticProvider && on.describe.includes('SORAN_LLM_DAILY_BUDGET_USD'))
  const wf = ['.github/workflows/visibility-guard.yml', ...readdirSync('.github/workflows').filter((x) => x !== 'visibility-guard.yml').map((x) => `.github/workflows/${x}`)]
  check('🔴 🔴 **유료 스위치는 어떤 워크플로우·템플릿에도 설정돼 있지 않다**',
    wf.every((p) => !readFileSync(p, 'utf-8').includes(SEMANTIC_PAID_ENV))
    && !renderAuditRunnerPlist({ runtimeRoot: '/rt', npxPath: '/n/npx', logDir: '/l', nodeBinDir: '/n' }).includes(SEMANTIC_PAID_ENV))
}

console.log('\n③ 🔴 🔴 응답 읽기 — 모양이 어긋나면 못 읽은 것이다(no 가 아니다)')
{
  check('깨끗한 응답 → no', (() => { const p = parseSemanticAuditResponse(CLEAN); return p.ok && p.defect === 'no' })())
  check('발견 있는 응답 → yes', (() => { const p = parseSemanticAuditResponse(FOUND); return p.ok && p.defect === 'yes' })())
  for (const [tag, raw] of [
    ['JSON 아님', '이상 없음'], ['배열 아님', '{"unsupportedFacts":{},"lifeContradictions":[],"sourceDistortions":[],"defect":"no"}'],
    ['칸 없음', '{"unsupportedFacts":[],"lifeContradictions":[],"defect":"no"}'], ['defect 없음', '{"unsupportedFacts":[],"lifeContradictions":[],"sourceDistortions":[]}'],
    ['발견 있는데 no', FOUND.replace('"defect":"yes"', '"defect":"no"')], ['발견 없는데 yes', CLEAN.replace('"defect":"no"', '"defect":"yes"')],
    ['빈 주장', '{"unsupportedFacts":[{"claim":" ","why":"x"}],"lifeContradictions":[],"sourceDistortions":[],"defect":"yes"}'],
    ['항목 칸이 문자열 아님', '{"unsupportedFacts":[{"claim":"x","why":1}],"lifeContradictions":[],"sourceDistortions":[],"defect":"yes"}'],
  ] as const) check(`🔴 [${tag}] → 못 읽음`, !parseSemanticAuditResponse(raw).ok)
}

console.log('\n④ 🔴 🔴 의미 감사 판정 — 어떤 실패도 no 가 아니다')
{
  const ok = async (p: SemanticAuditProvider): Promise<SemanticVerdict> => judgeSemantic({ ok: true, ctx: CTX }, p)
  const clean = await ok(scripted(CLEAN))
  check('기준선 — 측정된 no · 묶음 있음', clean.defect === 'no' && clean.measured && clean.binding !== null)
  const cases: [string, Promise<SemanticVerdict>][] = [
    ['문맥 없음(artifact 결속 실패)', judgeSemantic({ ok: false, code: 'ARTIFACT_MISSING', reason: 'x' }, scripted(CLEAN))],
    ['제공사 실패', ok({ model: SEMANTIC_AUDIT_MODEL, complete: async () => ({ ok: false, code: 'HTTP_500', reason: 'x' }) })],
    ['제공사 예외', ok({ model: SEMANTIC_AUDIT_MODEL, complete: async () => { throw new Error('boom') } })],
    ['응답 못 읽음', ok(scripted('{broken'))],
    ['계약과 다른 모델', ok(scripted(CLEAN, 'gemini-3.7-flash'))],
    ['유료 OFF 제공사', ok(offSemanticProvider)],
  ]
  for (const [tag, p] of cases) {
    const v = await p
    check(`🔴 🔴 **[${tag}] → yes · measured=false**`, v.defect === 'yes' && !v.measured && v.reasons.some((r) => r.includes('측정 불가')), JSON.stringify(v.reasons))
  }
  const found = await ok(scripted(FOUND))
  check('발견 → yes · measured=true · 사유에 근거 없는 사실', found.defect === 'yes' && found.measured && found.reasons.some((r) => r.includes('근거 없는 사실')))
}

console.log('\n⑤ 🔴 🔴 묶음 — 글 · 도장 · artifact 원문 근거 · Persona 카드 · 요청에 실린다')
{
  const b0 = semanticBindingOf(CTX).digest
  const variants: [string, SemanticAuditContext][] = [
    ['글 id', { ...CTX, post: { ...CTX.post, id: 'post-2' } }],
    ['글 본문', { ...CTX, post: { ...CTX.post, body: `${CTX.post.body}!` } }],
    ['도장', { ...CTX, stamp: makeStamp('다른', '도장', new Date()) }],
    ['도장 없음', { ...CTX, stamp: null }],
    ['artifact id', { ...CTX, artifact: { ...CTX.artifact, artifactId: 'art-2' } }],
    ['원문 근거', { ...CTX, artifact: { ...CTX.artifact, sourceBody: '다른 원문' } }],
    ['Persona', { ...CTX, persona: { code: 'P15', card: cardOf('P15') } }],
    ['카드 한 칸', { ...CTX, persona: { code: 'P01', card: { ...cardOf('P01'), maritalStatus: '비혼' } } }],
  ]
  for (const [tag, c] of variants) check(`🔴 [${tag}] 가 바뀌면 묶음 digest 가 바뀐다`, semanticBindingOf(c).digest !== b0)
  const req = buildSemanticAuditRequest(CTX)
  const payload = JSON.parse(req.userPayload) as Record<string, Record<string, unknown>>
  check('🔴 🔴 **요청에 발행 글 · 원문 근거 · 카드 생활사가 실린다**',
    payload.게시글?.본문 === CTX.post.body && payload.원문근거?.본문 === CTX.artifact.sourceBody
    && payload.글쓴이카드?.maritalStatus === cardOf('P01').maritalStatus && payload.글쓴이카드?.ageBand === cardOf('P01').ageBand)
  check('🔴 지시문에 세 가지 판정(근거 없는 사실 · 생활사 모순 · 원문 왜곡)이 있다',
    /unsupportedFacts/.test(req.systemPrompt) && /lifeContradictions/.test(req.systemPrompt) && /sourceDistortions/.test(req.systemPrompt))
  check('🔴 지시문·요청에 금지 표현이 없다', !/시니어|어르신|노인|실버/.test(req.systemPrompt + req.userPayload))
}

console.log('\n⑥ 🔴 🔴 합치기 — 규칙 · 의미 중 하나라도 yes 면 yes')
{
  const rule = await ruleAuditJudge({ queueId: 'q', postId: 'post-1', title: CTX.post.title, body: CTX.post.body, stamp: CTX.stamp })
  const ruleYes: AuditVerdict = { ...rule, defect: 'yes', reasons: ['규칙'] }
  const semNo = await judgeSemantic({ ok: true, ctx: CTX }, scripted(CLEAN))
  const semYes = await judgeSemantic({ ok: true, ctx: CTX }, scripted(FOUND))
  check('규칙 no · 의미 no → no', combineAuditVerdicts(rule, semNo).verdict.defect === 'no')
  check('🔴 규칙 yes · 의미 no → yes', combineAuditVerdicts(ruleYes, semNo).verdict.defect === 'yes')
  check('🔴 🔴 **규칙 no · 의미 yes → yes**', combineAuditVerdicts(rule, semYes).verdict.defect === 'yes')
  const c = combineAuditVerdicts(rule, semNo).verdict
  check('🔴 기록 칸에 두 감사의 모델·프롬프트가 함께 남는다 · 감사 계약 판은 repo 그대로',
    c.model === `${RULE_JUDGE_MODEL}+${SEMANTIC_AUDIT_MODEL}` && c.promptVersion === `${RULE_JUDGE_PROMPT_VERSION}+${SEMANTIC_AUDIT_PROMPT_VERSION}` && c.contractVersion === AUDIT_CONTRACT_VERSION)
}

console.log('\n⑦ 🔴 운영자 신고 근거 — 비면 받지 않는다')
{
  check('근거 1줄 이상 → 받는다', adminReasonsOf(['생활사 모순']) !== null)
  check('🔴 근거 없음 · 공백 · 배열 아님 · 너무 많음 → 받지 않는다',
    adminReasonsOf([]) === null && adminReasonsOf([' ']) === null && adminReasonsOf('x') === null && adminReasonsOf(Array.from({ length: 11 }, () => 'x')) === null)
}

console.log('\n⑧ 🔴 🔴 감사 러너 launchd 템플릿 — 코드가 렌더한다 · 설치하지 않는다')
{
  const slots = auditRunnerSlots()
  check('🔴 🔴 **슬롯이 있다 — 08:10~23:40 · 30분마다 32회**', slots.length === 32 && slots[0]!.hour === 8 && slots[0]!.minute === 10 && slots.at(-1)!.hour === 23 && slots.at(-1)!.minute === 40)
  check('🔴 🔴 **슬롯 계약 통과 · 빈 슬롯은 문제로 잡힌다**', verifyAuditSlots(slots).length === 0 && verifyAuditSlots([]).length > 0)
  check('🔴 판정 대기 시한은 감사 간격의 4배 이상 — 건강한 러너가 시한을 건드리지 않는다', AUDIT_OVERDUE_HOURS * 60 >= 4 * AUDIT_INTERVAL_MINUTES)
  const xml = renderAuditRunnerPlist({ runtimeRoot: '/rt', npxPath: '/nvm/bin/npx', logDir: '/Users/x/Library/Logs/soransoran', nodeBinDir: '/nvm/bin' })
  const cal = [...xml.matchAll(/<dict><key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer><\/dict>/g)]
  check('🔴 🔴 **렌더한 plist 의 StartCalendarInterval 이 슬롯과 같다**', /<key>StartCalendarInterval<\/key>/.test(xml) && cal.length === slots.length
    && cal.every((m, i) => Number(m[1]) === slots[i]!.hour && Number(m[2]) === slots[i]!.minute))
  check('🔴 Label · 스크립트 · --apply · RunAtLoad false · PATH 에 node', xml.includes(`<string>${AUDIT_RUNNER_LABEL}</string>`)
    && xml.includes(`<string>/rt/${AUDIT_RUNNER_SCRIPT}</string>`) && AUDIT_RUNNER_ARGS.every((a) => xml.includes(`<string>${a}</string>`))
    && /<key>RunAtLoad<\/key><false\/>/.test(xml) && xml.includes('<string>/nvm/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>'))
  check('🔴 로그가 Documents 밖이다', !/\/Documents\/[^<]*\.log/.test(xml))
}

console.log('\n⑨ 🔴 🔴 배선 — 러너 · 발행 러너 · 발행 트랜잭션 · 관리자 경계')
{
  const runner = codeOnly('scripts/auto-ready-audit.mts')
  check('🔴 🔴 **러너가 규칙 감사 + 문맥 로더 + env 제공사로 회차를 돈다**',
    /runCombinedAuditRound\(prisma, \{[\s\S]*ruleJudge: ruleAuditJudge, loadContext: makeAuditContextLoader\(prisma\), provider: choice\.provider,/.test(runner))
  check('🔴 🔴 **판정 전 0 이면 제공사를 만들기 전에 끝난다**',
    runner.indexOf('if (pendingCount === 0)') > 0 && runner.indexOf('if (pendingCount === 0)') < runner.indexOf('semanticProviderFromEnv(process.env'))
  check('🔴 러너에 직접 fetch · SDK 가 없다 — 요청은 장부를 지나는 제공사 한 곳', !/fetch\(|anthropic|openai|@google/i.test(runner))
  const prodScripts = readdirSync('scripts').filter((x) => x.endsWith('.mts') && !/-check\.mts$/.test(x)).map((x) => join('scripts', x))
  check('🔴 🔴 **운영 스크립트가 repo 의 규칙 단독 감사 경로(runAuditRound · recordAuditResult)를 부르지 않는다**',
    prodScripts.every((p) => !/\b(runAuditRound|recordAuditResult)\(/.test(codeOnly(p))), prodScripts.filter((p) => /\b(runAuditRound|recordAuditResult)\(/.test(codeOnly(p))).join(','))
  const allScripts = [...prodScripts, ...readdirSync('scripts/lib').filter((x) => /\.m?ts$/.test(x)).map((x) => join('scripts/lib', x))]
  check('🔴 🔴 **CLI 는 사람 기록을 만들 수 없다 — 운영자 신고 저장 함수를 부르는 스크립트가 없다**',
    allScripts.every((p) => !/recordAdminDefectReport|auto-ready-defect-report/.test(codeOnly(p))))
  const action = codeOnly('src/lib/actions/auto-ready-defect-report.ts')
  check('🔴 🔴 **관리자 경계 — requireAdmin · 세션 User.id 가 기록보다 먼저**',
    action.indexOf('await requireAdmin()') > 0 && action.indexOf('await auth()') > action.indexOf('await requireAdmin()')
    && action.indexOf('recordAdminDefectReport(') > action.indexOf('session?.user?.id'))
  const fields = [...action.matchAll(/\br\.(\w+)/g)].map((m) => m[1])
  check('🔴 🔴 **요청에서 꺼내는 칸은 postId · reasons 둘뿐 — 신고자·시각을 요청이 정하지 못한다**',
    fields.length > 0 && fields.every((x) => x === 'postId' || x === 'reasons') && /actor: \{ userId \}/.test(action) && /now: new Date\(\)/.test(action), fields.join(','))
  const tx = codeOnly('src/lib/original-post-publish-tx.ts')
  check('🔴 🔴 **발행 트랜잭션이 자동 행 재검증 뒤 같은 트랜잭션에서 판정 대기 시한을 본다**',
    /if \(!recheck\.ok\) return[^\n]*\n\s*const overdue = await overdueBlockInTx\(tx, input\.autoReadyEnv \?\? \{\}, txNow\)\s*\n\s*if \(overdue !== null\) return \{ kind: 'blocked', code: 'AUTO_READY_RECHECK'/.test(tx))
  const pub = codeOnly('scripts/original-post-auto-publish.mts')
  check('🔴 🔴 **발행 러너 — 열림은 auditAwareGate · 도장은 stampRoundAuditAware (맨 stampRound 없음)**',
    /const autoOpen = await auditAwareGate\(prisma, process\.env, RUN_AT\)/.test(pub) && /await stampRoundAuditAware\(prisma, \{ env: process\.env, now: RUN_AT \}\)/.test(pub) && !/\bstampRound\(/.test(pub))
  const store = codeOnly('src/lib/auto-ready-audit-store.ts')
  check('🔴 🔴 **자동 감사 쓰기는 판정 전일 때만 — 첫 기록이 이긴다**',
    /updateMany\(\{\s*where: \{ queueId: i\.queueId, defect: null \},/.test(store) && /where: \{ queueId, defect: null \},/.test(store))
  check('🔴 🔴 **운영자 신고만 no 를 yes 로 올린다**', /where: \{ queueId: queue\.id, OR: \[\{ defect: null \}, \{ defect: 'no' \}\] \}, data: judged/.test(store))
}

console.log('\n⑩ 참고 — 의미 감사 한 건의 예약액 상한(가격표 · 공식 사전 계산 대신 추정 입력 토큰)')
{
  const req = buildSemanticAuditRequest(CTX)
  // 🔴 추정이다 — 한글 1자 ≈ 1토큰(보수) · 실제 운영은 장부가 공식 count_tokens 로 예약한다
  const estIn = [...req.systemPrompt].length + [...req.userPayload].length
  const typicalIn = estIn + 1200 // 실제 원문 근거(수백 자)·본문(수백 자) 여유
  const r = reserveOf({ model: SEMANTIC_AUDIT_MODEL, countedInputTokens: typicalIn, maxOutputTokens: SEMANTIC_AUDIT_MAX_OUTPUT_TOKENS, headroomMultiplier: 1.5 })
  console.log(`   추정 입력 ≈ ${typicalIn} 토큰 · 출력 상한 ${SEMANTIC_AUDIT_MAX_OUTPUT_TOKENS} · 예약 상한 ${r.known ? `$${r.usd.toFixed(5)}` : '모름'} (여유 1.5배)`)
  check('예약액을 낼 수 있다(단가 · 모델 확정)', r.known)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 검사 — 실행 경로는 auto-ready:audit-db-check · auto-ready:defect-http-check 가 본다\n')
if (fail > 0) process.exit(1)
