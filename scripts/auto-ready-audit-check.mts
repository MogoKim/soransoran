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
  buildSemanticAuditRequest, combineAuditVerdicts, semanticNoteHead, AUDIT_BUDGET_ENV, SEMANTIC_AUDIT_SYSTEM_PROMPT,
  type CombinedAudit, type SemanticAuditContext, type SemanticAuditProvider, type SemanticVerdict,
} from '../src/lib/auto-ready-semantic-audit'
import {
  AUDIT_OVERDUE_HOURS, RETRYABLE_NOTE_PREFIX, automatedAuditorOk, adminReasonsOf, readRetryableFailure, retryableNoteOf,
} from '../src/lib/auto-ready-audit-store'
import { REVIEWER_KINDS, isHumanReviewer } from '../src/lib/review-provenance'
import { priceOf, reserveOf } from '../src/lib/llm-pricing'
import { LEDGER_STAGES, PAID_STAGES } from '../src/lib/llm-ledger'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { ruleAuditJudge, RULE_JUDGE_MODEL, RULE_JUDGE_PROMPT_VERSION } from './lib/auto-ready-rule-judge.mjs'
import { auditLedgerDir, auditLimitsFromEnv, offSemanticProvider, paidSemanticProvider, semanticProviderFromEnv } from './lib/auto-ready-semantic-provider.mjs'
import { MATERIAL_CONTRACT_LINES } from '../src/lib/content-core/material-contract'
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
  check('🟢 bounded creativity — 감상·질문·재구성·자연스러운 강조와 비핵심 생략은 결함이 아니다',
    SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('감상·반응·질문·비유·연결 문장·일반적 관찰·새로운 구성')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('정도 부사·강조 부사의 추가')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('같은 주체가 같은 행동을 했다고 명시했다면')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('새 사건·새 행위자·새 사실이라 하지 않는다')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('핵심 사실을 바꾸지 않는 자연스러운 강조')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('세부 내용을 일부 생략했어도'))
  check('🟢 no 출력은 허용 표현 설명 없이 세 배열을 비우는 단일 모양이다',
    SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('허용된 표현이나 결함이 아닌 이유를 배열에 설명하지 않는다')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('defect 가 "no"이면 세 배열은 반드시 모두 []이다')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('{"unsupportedFacts":[],"lifeContradictions":[],"sourceDistortions":[],"defect":"no"}')
    && !SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('[{"claim":"","why":""}]'))
  check('🔴 계속 막는 경계 — 구체 사실·명시적 생활사 모순·핵심 주체/행동/원인/결과/결론 왜곡',
    SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('숫자·금액·장소·새 사건·진단')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('같은 주어·같은 사실 축')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('주체·핵심 행동·원인·결과·결론'))
}

console.log('\n② 🔴 유료 호출 — 기본 OFF')
{
  check('🔴 🔴 **스위치가 없으면 OFF**', !semanticPaidEnabled({}) && !semanticPaidEnabled({ [SEMANTIC_PAID_ENV]: 'true' }) && semanticPaidEnabled({ [SEMANTIC_PAID_ENV]: 'on' }))
  check('🔴 🔴 **env 기본값으로 고르면 부르지 않는 제공사다**', semanticProviderFromEnv({}, 'r').provider === offSemanticProvider && semanticProviderFromEnv({}, 'r').session === null)
  const on = semanticProviderFromEnv({ [SEMANTIC_PAID_ENV]: 'on' }, 'r')
  check('🔴 🔴 **ON 이어도 감사 예산 env 가 없으면 요청하지 않는 제공사 · 세션 없음 · 빈 이름을 적는다**',
    on.session === null && on.describe.includes(AUDIT_BUDGET_ENV.dailyUsd) && (await on.provider.complete({ systemPrompt: '', userPayload: '', maxOutputTokens: 1, timeoutMs: 1 })).ok === false)
  const supplyOnly = semanticProviderFromEnv({ [SEMANTIC_PAID_ENV]: 'on', SORAN_LLM_DAILY_BUDGET_USD: '5', SORAN_LLM_RUN_REQUEST_CAP: '100', SORAN_LLM_RESERVE_HEADROOM: '1.5' }, 'r')
  check('🔴 🔴 **공급 예산 env 는 감사 예산이 되지 않는다 — 공급 값만 있으면 여전히 요청 0**', supplyOnly.session === null)
  const full = semanticProviderFromEnv({ [SEMANTIC_PAID_ENV]: 'on', [AUDIT_BUDGET_ENV.dailyUsd]: '1', [AUDIT_BUDGET_ENV.runRequestCap]: '50', [AUDIT_BUDGET_ENV.headroomMultiplier]: '1.5' }, 'r', '/h')
  check('🔴 🔴 **감사 예산이 서면 감사 전용 장부 디렉터리의 세션 — 공급 장부와 다른 곳**',
    full.session !== null && full.session.dir === auditLedgerDir('/h') && full.session.dir !== join('/h', 'Library', 'Application Support', 'soransoran', 'llm-ledger')
    && full.session.limits.dailyUsd === 1 && full.session.limits.runRequestCap === 50)
  check('🔴 감사 예산 해석은 공급과 같은 규칙 — 0 · 음수 · 소수 요청 수는 없음',
    auditLimitsFromEnv({ [AUDIT_BUDGET_ENV.dailyUsd]: '0', [AUDIT_BUDGET_ENV.runRequestCap]: '2.5', [AUDIT_BUDGET_ENV.headroomMultiplier]: '-1' }).dailyUsd === null
    && auditLimitsFromEnv({ [AUDIT_BUDGET_ENV.runRequestCap]: '2.5' }).runRequestCap === null)
  const wf0 = readdirSync('.github/workflows').map((x) => readFileSync(`.github/workflows/${x}`, 'utf-8')).join('\n')
  check('🔴 감사 예산 env 는 어떤 워크플로우에도 설정돼 있지 않다', Object.values(AUDIT_BUDGET_ENV).every((n) => !wf0.includes(n)))
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

console.log('\n④ 🔴 🔴 의미 감사 판정 — 측정 못 한 것은 재시도 가능 실패 · 결속 깨짐은 무결성 · no 는 측정된 것만')
{
  const ok = async (p: SemanticAuditProvider): Promise<SemanticVerdict> => judgeSemantic({ ok: true, ctx: CTX }, p)
  const clean = await ok(scripted(CLEAN))
  check('기준선 — 측정된 no · 묶음 있음', clean.defect === 'no' && clean.outcome === 'measured' && clean.binding !== null)
  const retry: [string, string, Promise<SemanticVerdict>][] = [
    ['제공사 실패(HTTP)', 'HTTP_500', ok({ model: SEMANTIC_AUDIT_MODEL, complete: async () => ({ ok: false, code: 'HTTP_500', reason: 'x' }) })],
    ['제공사 예외', 'PROVIDER_EXCEPTION', ok({ model: SEMANTIC_AUDIT_MODEL, complete: async () => { throw new Error('boom') } })],
    ['응답 못 읽음', 'PARSE_FAILED', ok(scripted('{broken'))],
    ['자기모순 응답', 'PARSE_FAILED', ok(scripted(FOUND.replace('"defect":"yes"', '"defect":"no"')))],
    ['계약과 다른 모델', 'MODEL_MISMATCH', ok(scripted(CLEAN, 'gemini-3.7-flash'))],
    ['유료 OFF 제공사', 'PAID_OFF', ok(offSemanticProvider)],
    ['감사 예산 없음', 'AUDIT_BUDGET_UNSET', ok(semanticProviderFromEnv({ [SEMANTIC_PAID_ENV]: 'on' }, 'r').provider)],
    ['정본 파일 못 읽음(문맥 · 환경)', 'ARTIFACT_INDEX_UNREADABLE', judgeSemantic({ ok: false, code: 'ARTIFACT_INDEX_UNREADABLE', reason: 'x', integrity: false }, scripted(CLEAN))],
  ]
  for (const [tag, code, p] of retry) {
    const v = await p
    check(`🔴 🔴 **[${tag}] → 재시도 가능 실패 · defect null · 코드 ${code} (yes 도 no 도 아니다)**`, v.outcome === 'retryable' && v.defect === null && v.code === code, `${v.outcome} · ${v.defect} · ${v.code}`)
  }
  const integ = await judgeSemantic({ ok: false, code: 'ARTIFACT_MISSING', reason: 'x', integrity: true }, scripted(CLEAN))
  check('🔴 🔴 **[문맥 결속 깨짐(artifact 없음)] → 무결성 yes**', integ.outcome === 'integrity' && integ.defect === 'yes' && integ.code === 'ARTIFACT_MISSING')
  const found = await ok(scripted(FOUND))
  check('🔴 🔴 **실제 발견 → 측정된 yes(콘텐츠 결함) · 사유에 근거 없는 사실**', found.defect === 'yes' && found.outcome === 'measured' && found.reasons.some((r) => r.includes('근거 없는 사실')))
}

console.log('\n④-b 🔴 🔴 측정된 yes 한 번은 확정이 아니다 — 같은 요청으로 한 번 확인 (2026-10-24 · v3)')
{
  type Reply = string | { ok: false; code: string; reason: string } | 'THROW'
  /** 🔴 응답을 차례로 돌려주고, 받은 요청을 전부 남긴다 — 확인 호출이 같은 요청인지 잰다 */
  const sequence = (replies: Reply[]) => {
    const reqs: Parameters<SemanticAuditProvider['complete']>[0][] = []
    const provider: SemanticAuditProvider = {
      model: SEMANTIC_AUDIT_MODEL,
      complete: async (req) => {
        reqs.push(req)
        const r = replies[reqs.length - 1]
        if (r === undefined) return { ok: false, code: 'SEQUENCE_EXHAUSTED', reason: '예상보다 많이 불렀다' }
        if (r === 'THROW') throw new Error('boom')
        return typeof r === 'string' ? { ok: true, text: r } : r
      },
    }
    return { reqs, provider }
  }
  const rule = await ruleAuditJudge({ queueId: 'q', postId: 'post-1', title: CTX.post.title, body: CTX.post.body, stamp: CTX.stamp })
  const finalOf = (c: CombinedAudit): 'yes' | 'no' | 'retryable' => (c.kind === 'final' ? c.verdict.defect : 'retryable')
  const yes = (k: 'unsupportedFacts' | 'lifeContradictions' | 'sourceDistortions', item: Record<string, string>): string =>
    JSON.stringify({ unsupportedFacts: [], lifeContradictions: [], sourceDistortions: [], [k]: [item], defect: 'yes' })

  // 🔴 사고 fixture — 원천 35112945 의 같은 장면 시간 바꿔쓰기(새벽·이 밤 → 밤늦게) · 끝이 잘린 광고 꼬리는 생략됐다
  const INCIDENT: SemanticAuditContext = {
    post: {
      id: 'post-35112945', title: '밤늦게 악플 보다가 잠을 못 잤어요',
      body: '밤늦게 잠이 안 와서 휴대폰을 보는데 그 기사에 악플들이 실시간으로 달리더라고요. 보는 내내 마음이 무거웠어요. 다들 이런 거 보면 어떠세요?',
    },
    stamp: makeStamp('밤늦게 악플 보다가 잠을 못 잤어요', '밤늦게 잠이 안 와서', new Date('2026-10-24T00:00:00Z')),
    artifact: {
      artifactId: 'art-35112945', sourceArticleId: '35112945', sourceTitle: '이 밤에 악플이 실시간으로',
      sourceBody: '새벽에 잠안와서 폰 보는데 이밤에 악플이 실시간으로 달리네요 보는 내내 맘이 안좋아요 [광고] 지금 바로 구매하',
    },
    persona: { code: 'P01', card: cardOf('P01') },
  }
  const TIME_FP = yes('sourceDistortions', { claim: '밤늦게 … 악플들이 실시간으로', source: '새벽에 잠안와서 · 이밤에 악플이 실시간으로' })
  {
    const s = sequence([TIME_FP, CLEAN])
    const v = await judgeSemantic({ ok: true, ctx: INCIDENT }, s.provider)
    check('🔴 🔴 **[사고 재현] 새벽/이 밤 → 밤늦게 1차 yes · 확인 no → 측정된 no(확정 결함 아님) · 미확정**',
      v.outcome === 'measured' && v.defect === 'no' && v.confirmation === 'unconfirmed' && v.binding !== null, `${v.outcome} · ${v.defect} · ${v.confirmation}`)
    check('🔴 🔴 **[사고 재현] 제공사 호출 정확히 2 · 확인 호출은 1차와 같은 요청 객체(글·원문·카드·결속 동일)**',
      s.reqs.length === 2 && s.reqs[0] === s.reqs[1] && JSON.stringify(s.reqs[0]) === JSON.stringify(s.reqs[1]), `${s.reqs.length}회`)
    check('🔴 [사고 재현] 규칙 no 와 합치면 최종 no — 전역 자동 READY 를 닫지 않는다', finalOf(combineAuditVerdicts(rule, v)) === 'no')
    check('🔴 [사고 재현] 미확정 1차 발견은 사유에만 남고 note 머리에 confirm=unconfirmed',
      v.reasons.some((r) => r.includes('결함 아님') && r.includes('밤늦게')) && semanticNoteHead(v).includes('confirm=unconfirmed'))
  }
  check('🔴 🔴 **[사고 재현] 지시문 — 같은 장면 시간 바꿔쓰기는 바꿔쓰기 · 양립 불가 시각이 사건/순서를 바꿀 때만 실질 변경**',
    MATERIAL_CONTRACT_LINES.every((l) => SEMANTIC_AUDIT_SYSTEM_PROMPT.split('\n').includes(l))
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('"새벽"·"이 밤"·"밤늦게"처럼 같은 장면의 시간대를 달리 말한 것은 바꿔쓰기다')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('양립할 수 없는 시각을 적어 사건이나 순서가 달라질 때만 실질 변경이다'))
  check('🔴 지시문 — 사소한 생략·커뮤니티식 1인칭 다시 말하기 허용 · 고위험 개인 사실은 계속 막는다',
    SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('커뮤니티 글처럼 1인칭으로 다시 말하기')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('원문이나 카드 근거 없는 고위험 개인 사실·주장'))
  check('🔴 🔴 **[10-26 사고 반례] 회사 그만두고 → 일을 쉬고 같은 약한 일반화는 허용하고 반대 상태는 계속 막는다**',
    SEMANTIC_AUDIT_PROMPT_VERSION === 'semantic-audit-prompt-v7'
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('"회사를 그만두고"를 "일을 쉬고"로')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('"퇴사했다"를 "새 회사에 입사했다"로')
    && SEMANTIC_AUDIT_SYSTEM_PROMPT.includes('원문보다 넓고 약한 표현으로의 치환은 구체적 사실이 아니다'))

  // 🔴 참 반례 — 실질 변경은 확인도 yes 라 그대로 확정 결함이다
  const counter: [string, SemanticAuditContext, string][] = [
    ['명시된 시각과 양립 불가 · 사건 순서가 바뀜', {
      ...CTX,
      post: { id: 'post-time', title: '출근 전에 다툰 이야기', body: '아침 출근 전에 남편이랑 다투고 나왔어요. 그래서 하루 종일 일이 손에 안 잡혔어요.' },
      artifact: { ...CTX.artifact, sourceTitle: '퇴근하고 다툼', sourceBody: '퇴근하고 저녁에 남편이랑 다퉜어요. 하루는 잘 보냈는데 저녁에 망쳤네요.' },
    }, yes('sourceDistortions', { claim: '아침 출근 전에 다투고 하루 종일', source: '퇴근하고 저녁에 다퉜다 · 하루는 잘 보냈다' })],
    ['근거 없는 고위험 개인 사실(진단)', {
      ...CTX,
      post: { id: 'post-fact', title: '갱년기 약 이야기', body: '저는 작년에 유방암 진단을 받아서 호르몬제를 못 먹어요. 다들 어떻게 버티세요?' },
      artifact: { ...CTX.artifact, sourceTitle: '갱년기 약', sourceBody: '갱년기 약 먹어야 할지 고민이에요' },
    }, yes('unsupportedFacts', { claim: '작년에 유방암 진단', why: '원문·카드에 없는 고위험 건강 사실' })],
    ['결과·인과가 바뀜', {
      ...CTX,
      post: { id: 'post-cause', title: '시어머니 이야기', body: '시어머니가 사과하셔서 결국 화해했어요. 다들 시댁이랑은 어떠세요?' },
      artifact: { ...CTX.artifact, sourceTitle: '시어머니', sourceBody: '시어머니가 끝내 사과를 안 하셔서 연락을 끊었어요' },
    }, yes('sourceDistortions', { claim: '사과해서 화해했다', source: '사과를 안 해서 연락을 끊었다' })],
  ]
  for (const [tag, ctx, finding] of counter) {
    const s = sequence([finding, finding])
    const v = await judgeSemantic({ ok: true, ctx }, s.provider)
    check(`🔴 🔴 **[참 반례 · ${tag}] 1차 yes · 확인 yes → 확정 yes · 호출 2 · 최종 yes**`,
      v.outcome === 'measured' && v.defect === 'yes' && v.confirmation === 'confirmed' && s.reqs.length === 2 && s.reqs[0] === s.reqs[1]
      && finalOf(combineAuditVerdicts(rule, v)) === 'yes' && semanticNoteHead(v).includes('confirm=confirmed'),
      `${v.defect} · ${v.confirmation} · ${s.reqs.length}회`)
  }

  // 🔴 확인을 측정하지 못했다 — 결함도 아니고 no 도 아니다(fail-closed · 재시도 가능 실패 · 게이트 닫힘)
  const confirmFails: [string, Reply, string][] = [
    ['확인 HTTP 500', { ok: false, code: 'HTTP_500', reason: 'x' }, 'HTTP_500'],
    ['확인 사용량 미상', { ok: false, code: 'USAGE_UNKNOWN', reason: 'x' }, 'USAGE_UNKNOWN'],
    ['확인 예산·회차 상한 막힘', { ok: false, code: 'LEDGER_BLOCKED:RUN_REQUEST_CAP', reason: 'x' }, 'LEDGER_BLOCKED:RUN_REQUEST_CAP'],
    ['확인 응답 못 읽음', '{broken', 'PARSE_FAILED'],
    ['확인 제공사 예외', 'THROW', 'PROVIDER_EXCEPTION'],
  ]
  for (const [tag, second, code] of confirmFails) {
    const s = sequence([TIME_FP, second])
    const v = await judgeSemantic({ ok: true, ctx: INCIDENT }, s.provider)
    check(`🔴 🔴 **[${tag}] 1차 yes 뒤 확인 실패 → 재시도 가능 실패 · defect null · 코드 ${code} · no 가 아니다 · 합치면 재시도(닫힘)**`,
      v.outcome === 'retryable' && v.defect === null && v.code === code && v.confirmation === 'failed' && s.reqs.length === 2
      && finalOf(combineAuditVerdicts(rule, v)) === 'retryable', `${v.outcome} · ${v.defect} · ${v.code} · ${v.confirmation}`)
  }
  {
    const s = sequence([CLEAN])
    const v = await judgeSemantic({ ok: true, ctx: INCIDENT }, s.provider)
    check('🔴 1차 no → 확인 호출 없음 · 호출 1 · confirm=none', v.defect === 'no' && v.confirmation === 'none' && s.reqs.length === 1)
    const f = sequence([{ ok: false, code: 'HTTP_429', reason: 'x' }])
    const fv = await judgeSemantic({ ok: true, ctx: INCIDENT }, f.provider)
    check('🔴 1차 측정 실패 → 확인 호출 없음 · 호출 1 · 재시도 가능 실패', fv.outcome === 'retryable' && fv.code === 'HTTP_429' && f.reqs.length === 1)
    const both = sequence([TIME_FP, TIME_FP, CLEAN])
    await judgeSemantic({ ok: true, ctx: INCIDENT }, both.provider)
    check('🔴 확인은 한 번뿐 — yes·yes 뒤 세 번째 호출 없음', both.reqs.length === 2)
  }

  // 🔴 확인 호출도 같은 장부 경로를 지난다 — 운영 제공사(`paidSemanticProvider`)의 세션 호출이 정확히 2번
  {
    const calls: { stage: string; model: string; systemPrompt: string; userPayload: string }[] = []
    const answers = [TIME_FP, CLEAN]
    const session = {
      call: async (input: { stage: string; model: string; systemPrompt: string; userPayload: string }) => {
        calls.push(input)
        return { ok: true, rawText: answers[calls.length - 1] ?? '', settlementRecorded: true, maxTokensReached: false, settledUsd: 0.001, errorCode: null, errorMessage: null }
      },
    } as unknown as Parameters<typeof paidSemanticProvider>[0]
    const v = await judgeSemantic({ ok: true, ctx: INCIDENT }, paidSemanticProvider(session))
    check('🔴 🔴 **확인 호출도 감사 장부 세션(session.call · semanticAudit 단계)을 지난다 — 숨은 호출 0 · 같은 요청 2회**',
      v.defect === 'no' && calls.length === 2 && calls.every((c) => c.stage === 'semanticAudit' && c.model === SEMANTIC_AUDIT_MODEL)
      && calls[0]!.userPayload === calls[1]!.userPayload && calls[0]!.systemPrompt === calls[1]!.systemPrompt, `${calls.length}회`)
  }
  const sem = codeOnly('src/lib/auto-ready-semantic-audit.ts')
  check('🔴 의미 감사 판정은 주입된 제공사 밖으로 나가지 않는다(fetch · SDK 없음)', !/fetch\(|@anthropic|anthropic\.|openai/i.test(sem))
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

console.log('\n⑥ 🔴 🔴 합치기 — 규칙 · 의미 중 하나라도 yes 면 yes · 측정 못 했으면 재시도 가능 실패')
{
  const rule = await ruleAuditJudge({ queueId: 'q', postId: 'post-1', title: CTX.post.title, body: CTX.post.body, stamp: CTX.stamp })
  const ruleYes: AuditVerdict = { ...rule, defect: 'yes', reasons: ['규칙'] }
  const semNo = await judgeSemantic({ ok: true, ctx: CTX }, scripted(CLEAN))
  const semYes = await judgeSemantic({ ok: true, ctx: CTX }, scripted(FOUND))
  const semRetry = await judgeSemantic({ ok: true, ctx: CTX }, offSemanticProvider)
  const semInteg = await judgeSemantic({ ok: false, code: 'NO_PERSONA_CARD', reason: 'x', integrity: true }, scripted(CLEAN))
  const final = (c: CombinedAudit): 'yes' | 'no' | 'retryable' => (c.kind === 'final' ? c.verdict.defect : 'retryable')
  check('규칙 no · 의미 no → no', final(combineAuditVerdicts(rule, semNo)) === 'no')
  check('🔴 규칙 yes · 의미 no → yes', final(combineAuditVerdicts(ruleYes, semNo)) === 'yes')
  check('🔴 🔴 **규칙 no · 의미 yes → yes**', final(combineAuditVerdicts(rule, semYes)) === 'yes')
  check('🔴 🔴 **규칙 no · 의미 측정 못 함 → 재시도 가능 실패(확정 아님)**', final(combineAuditVerdicts(rule, semRetry)) === 'retryable')
  check('🔴 규칙 yes · 의미 측정 못 함 → yes (규칙이 본 결함은 결함이다)', final(combineAuditVerdicts(ruleYes, semRetry)) === 'yes')
  check('🔴 🔴 **규칙 no · 의미 무결성 → yes**', final(combineAuditVerdicts(rule, semInteg)) === 'yes')
  const c = combineAuditVerdicts(rule, semNo)
  check('🔴 기록 칸에 두 감사의 모델·프롬프트가 함께 남는다 · 감사 계약 판은 repo 그대로',
    c.kind === 'final' && c.verdict.model === `${RULE_JUDGE_MODEL}+${SEMANTIC_AUDIT_MODEL}` && c.verdict.promptVersion === `${RULE_JUDGE_PROMPT_VERSION}+${SEMANTIC_AUDIT_PROMPT_VERSION}` && c.verdict.contractVersion === AUDIT_CONTRACT_VERSION)
  const n1 = retryableNoteOf({ code: 'PAID_OFF', at: '2026-09-28T00:00:00.000Z', attempts: 3, reason: 'x'.repeat(5000) })
  const r1 = readRetryableFailure(n1)
  check('🔴 재시도 가능 실패 note — 코드·시각·시도 횟수가 읽히고 2000자 안이다', r1 !== null && r1.code === 'PAID_OFF' && r1.attempts === 3 && n1.length <= 2000 && n1.startsWith(RETRYABLE_NOTE_PREFIX))
  check('🔴 결과 note 는 실패 note 로 읽히지 않는다', readRetryableFailure(semanticNoteHead(semNo)) === null && readRetryableFailure(null) === null)
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
  const store = codeOnly('src/lib/auto-ready-audit-store.ts')
  check('🔴 🔴 **발행 트랜잭션이 자동 행 재검증 뒤 같은 트랜잭션에서 감사 막힘(재시도 가능 실패 · 시한)을 본다**',
    /if \(!recheck\.ok\) return[^\n]*\n[\s\S]{0,400}?const auditBlock = await auditBlockInTx\(tx, input\.autoReadyEnv \?\? \{\}, txNow\)\s*\n\s*if \(auditBlock !== null\) return \{ kind: 'blocked', code: 'AUTO_READY_RECHECK'/.test(tx))
  check('🔴 🔴 **감사 막힘 = 재시도 가능 실패(즉시) + 시한 초과 — 둘 다 센다**',
    /const r = await retryableFailureCount\(db\)\s*\n\s*if \(r > 0\) reasons\.push/.test(store) && /const o = await overdueAuditCount\(db, now\)\s*\n\s*if \(o > 0\) reasons\.push/.test(store))
  check('🔴 🔴 **러너는 재시도 가능 실패·행 오류가 있으면 non-zero 로 끝낸다**', /if \(r\.retryable\.length > 0 \|\| r\.rowErrors\.length > 0\) \{[\s\S]{0,300}return 2/.test(runner))
  const pub = codeOnly('scripts/original-post-auto-publish.mts')
  check('🔴 🔴 **발행 러너 — 열림은 auditAwareGate · 도장은 stampRoundAuditAware (맨 stampRound 없음)**',
    /const autoOpen = await auditAwareGate\(prisma, process\.env, RUN_AT\)/.test(pub) && /await stampRoundAuditAware\(prisma, \{ env: process\.env, now: RUN_AT \}\)/.test(pub) && !/\bstampRound\(/.test(pub))
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
