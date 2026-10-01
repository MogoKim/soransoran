#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY v2 — 순수 계약 검사** (DB 0 · 네트워크 0 · LLM 0)
 *
 * 실행 경로(격리 DB)는 `auto-ready:db-check` 가 본다. 여기는 판정 규칙이 fail-closed 인지,
 * 계약 값을 낮추지 않았는지, founder 를 쓰지 않는지, 스위치가 기본 OFF 인지를 본다.
 */
import { readFileSync } from 'node:fs'

import { Prisma } from '@prisma/client'

import {
  warningsOfGate, semanticIssues, eligibilityOf, judgeRow, CONTRACT, AUTO_DECIDER, HUMAN_DECIDER,
  NO_SEMANTIC_RECORD, SEMANTIC_INVALID, SEMANTIC_HOLDS_MISMATCH,
  makeStamp, readStamp, stampValidFor, AUTO_READY_RECORD_KEY, JUDGE_CONTRACT_DIGEST,
  autoReadyEnabled, AUTO_READY_ENV, judgeOpen, auditTarget, pickAudits, mergeDefect, isHumanEditRecord,
  AUDIT_CONTRACT_VERSION, verdictShapeOk,
} from '../src/lib/auto-ready-v2'
import { isTransientTxLost, withStampTxRetry, STAMP_TX_MAX_ATTEMPTS } from '../src/lib/auto-ready-repo'
import { ruleAuditJudge } from './lib/auto-ready-rule-judge.mjs'
import { releaseStageCeiling, boundedReleaseStage, resolveScale } from '../src/lib/scale-runtime'
import {
  restoreRow, cohortSampleOf, humanSampleOf, readEvidenceReviews, digestOf, bindingOf,
  EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT,
  type ArtifactDoc, type CandidateDoc, type DecidedRow, type EvidenceReview,
} from '../src/lib/auto-ready-evidence'
import { isHumanReviewer, resolveHumanReviewer, LEGACY_DECISION_MARK } from '../src/lib/review-provenance'
import { planOriginalPostWithdrawal } from '../src/lib/original-post-withdrawal'
import { selectAutoTargets, type AutoRow } from '../src/lib/original-post-auto-publish'
import {
  currentQualityContract, readQualityContract, QUALITY_CONTRACT_KEY, QUALITY_CONTRACT_VERSION,
} from '../src/lib/quality-contract'
import {
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE, semanticHoldsOf,
} from '../src/lib/micro-seed-supply-autofill'
import { markedStageEnv } from './lib/stage-decision-fixture'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  🔴 FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
const codeOnly = (f: string): string => readFileSync(f, 'utf-8')
  .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')

/** 🔴 온전한 의미 검수 요약 — 이것에서 한 칸씩만 망가뜨린다 */
const GOOD_SR = {
  complete: true, deterministicPass: true,
  unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9,
}
const gateWith = (sr: unknown, holds: string[] = []): Record<string, unknown> => ({
  holds, blocks: [], semanticReview: sr,
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
  },
})
const elig = (gate: unknown, title = '평범한 하루 이야기', body = '아침에 산책을 다녀왔어요. 다들 어떻게 지내세요?') =>
  eligibilityOf({ gateVerdict: 'PASS', gateResults: gate, title, body })

console.log('\n① 🔴 semanticReview 는 fail-closed 다 — "객체이기만 하면 통과" 가 아니다')
{
  check('기준선 — 온전한 요약은 자동 대상이다', elig(gateWith(GOOD_SR)).auto, elig(gateWith(GOOD_SR)).reasons.join(','))
  const bad: [string, unknown, string][] = [
    ['기록 없음', undefined, NO_SEMANTIC_RECORD],
    ['null', null, NO_SEMANTIC_RECORD],
    ['빈 객체 {}', {}, `${SEMANTIC_INVALID}:complete`],
    ['배열', [], NO_SEMANTIC_RECORD],
    ['complete=false', { ...GOOD_SR, complete: false }, `${SEMANTIC_INVALID}:complete`],
    ['complete="true" (문자열)', { ...GOOD_SR, complete: 'true' }, `${SEMANTIC_INVALID}:complete`],
    ['deterministicPass 누락', { ...GOOD_SR, deterministicPass: undefined }, `${SEMANTIC_INVALID}:deterministicPass`],
    ['unsupportedAdditions="0" (문자열)', { ...GOOD_SR, unsupportedAdditions: '0' }, `${SEMANTIC_INVALID}:unsupportedAdditions`],
    ['lifeContradictions=-1 (음수)', { ...GOOD_SR, lifeContradictions: -1 }, `${SEMANTIC_INVALID}:lifeContradictions`],
    ['droppedFromSource=1.5 (정수 아님)', { ...GOOD_SR, droppedFromSource: 1.5 }, `${SEMANTIC_INVALID}:droppedFromSource`],
    ['droppedFromSource=NaN', { ...GOOD_SR, droppedFromSource: Number.NaN }, `${SEMANTIC_INVALID}:droppedFromSource`],
    ['confidence=null', { ...GOOD_SR, confidence: null }, `${SEMANTIC_INVALID}:confidence`],
    ['confidence=NaN', { ...GOOD_SR, confidence: Number.NaN }, `${SEMANTIC_INVALID}:confidence`],
    ['confidence=1.2', { ...GOOD_SR, confidence: 1.2 }, `${SEMANTIC_INVALID}:confidence`],
    ['confidence=-0.1', { ...GOOD_SR, confidence: -0.1 }, `${SEMANTIC_INVALID}:confidence`],
    ['confidence="0.9" (문자열)', { ...GOOD_SR, confidence: '0.9' }, `${SEMANTIC_INVALID}:confidence`],
    ['confidence=Infinity', { ...GOOD_SR, confidence: Number.POSITIVE_INFINITY }, `${SEMANTIC_INVALID}:confidence`],
  ]
  for (const [label, sr, code] of bad) {
    const v = elig(gateWith(sr))
    check(`🔴 🔴 **${label} → 예외 검토 (${code})**`, !v.auto && v.reasons.join(',').includes(code), v.reasons.join(','))
  }
  /** 🔴 요약과 holds 가 같은 말을 해야 한다 — 기대 holds 는 정본 `semanticHoldsOf` 가 만든다 */
  const one = { ...GOOD_SR, unsupportedAdditions: 1 }
  const expected = semanticHoldsOf(one as never)
  check('기준선 — 요약 1건 · holds 1건이면 불일치는 아니다(그래도 경고라 예외)',
    !warningsOfGate(gateWith(one, expected)).includes(SEMANTIC_HOLDS_MISMATCH)
    && !elig(gateWith(one, expected)).auto)
  check('🔴 🔴 **요약은 추가 1건인데 holds 가 비었다 → 불일치 예외**',
    warningsOfGate(gateWith(one, [])).includes(SEMANTIC_HOLDS_MISMATCH))
  check('🔴 🔴 **요약은 0 인데 holds 에 의미 경고가 있다 → 불일치 예외**',
    warningsOfGate(gateWith(GOOD_SR, ['SEMANTIC_DROPPED_FROM_SOURCE:2'])).includes(SEMANTIC_HOLDS_MISMATCH))
  check('🔴 confidence 에 통과 임계값을 만들지 않았다 — 0 도 유효한 값이다',
    elig(gateWith({ ...GOOD_SR, confidence: 0 })).auto && semanticIssues({ ...GOOD_SR, confidence: 0 }).issues.length === 0)
  check('🔴 경고는 후보 생성을 막지 않는다 — 적재 경로가 이 판정을 부르지 않는다',
    !/auto-ready-v2/.test(readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')))
}

console.log('\n② 🔴 증거 복원 — 여섯 갈래 · 추정 매칭 금지')
{
  const ART = 'a'.repeat(32)
  const base = 'A100'
  const draft = { title: '초안 제목', body: '초안 본문입니다.' }
  const artifact = (o: Partial<ArtifactDoc> = {}): ArtifactDoc => ({
    file: 'auto-draft-x.artifacts.json', artifactId: ART, sourceArticleId: base,
    contract: {
      pipelineVersion: 'content-core-v2.1', promptVersion: 'p7',
      stageModels: { draftGen: 'g', speakerPlan: 'g', semanticReview: 'h' },
    },
    planPersonaCode: 'P04',
    voice: { personaCode: 'P04', bundleDigest: 'bd', sourceDigest: 'sd' },
    draft,
    review: {
      deterministic: { pass: true }, semanticCompletion: { complete: true },
      semantic: { unsupportedAdditions: [], lifeContradictions: [], droppedFromSource: [], confidence: 0.95 },
    },
    ...o,
  })
  const cand = (o: Partial<CandidateDoc> = {}): CandidateDoc =>
    ({ file: 'auto-draft-x.candidates.json', artifactId: ART, sourceArticleId: base, sourceSite: 'navercafe:x', ...o })
  const row = (o: Partial<DecidedRow> = {}, ad: Record<string, unknown> = {}): DecidedRow => ({
    id: 'q1', decidedBy: HUMAN_DECIDER, draftTitle: draft.title, draftBody: draft.body,
    gateVerdict: 'PASS',
    gateResults: {
      holds: [], blocks: [],
      autoDraft: {
        artifactId: ART, sourceArticleId: base, pipelineVersion: 'content-core-v2.1',
        draftPromptVersion: 'p7', stageModels: { speakerPlan: 'g', draftGen: 'g', semanticReview: 'h' },
        voice: { personaCode: 'P04', bundleDigest: 'bd', sourceDigest: 'sd' }, ...ad,
      },
    },
    editDiff: null, declineReason: null,
    rawSourceSite: `${MACHINE_SITE_PREFIX}navercafe:x`, rawSourceArticleId: `${base}-deadbeef`,
    matchedPersonaCode: null, ...o,
  })
  const idx = (arts: ArtifactDoc[], cands: CandidateDoc[]) => ({
    a: new Map([[ART, arts]]), c: new Map([[ART, cands]]),
  })
  const run = (r: DecidedRow, arts = [artifact()], cands = [cand()]) => {
    const i = idx(arts, cands); return restoreRow(r, i.a, i.c)
  }
  check('기준선 — 모두 맞으면 clean', run(row()).klass === 'clean', JSON.stringify(run(row())))
  check('🔴 🔴 **artifactId 없는 옛 행 → missing (sourceArticleId 가 같아도)**',
    run(row({}, { artifactId: '' })).klass === 'missing')
  check('🔴 🔴 **정본 디렉터리에 그 artifact 가 없다 → missing**', run(row(), []).klass === 'missing')
  check('🔴 🔴 **같은 artifactId 가 두 장 → ambiguous**', run(row(), [artifact(), artifact({ file: 'b' })]).klass === 'ambiguous')
  check('🔴 candidates 가 두 줄 → ambiguous', run(row(), [artifact()], [cand(), cand({ file: 'c2' })]).klass === 'ambiguous')
  check('🔴 🔴 **원래 초안 본문이 다르다 → draftMismatch**', run(row({ draftBody: '다른 본문' })).klass === 'draftMismatch')
  check('🔴 원래 초안 제목이 다르다 → draftMismatch', run(row({ draftTitle: '다른 제목' })).klass === 'draftMismatch')
  check('🔴 🔴 **Persona 말투 출처가 다르다 → provenanceMismatch**',
    run(row({}, { voice: { personaCode: 'P09', bundleDigest: 'bd', sourceDigest: 'sd' } })).klass === 'provenanceMismatch')
  check('🔴 🔴 **sourceSite 가 다르다 → provenanceMismatch**',
    run(row({ rawSourceSite: `${MACHINE_SITE_PREFIX}navercafe:y` })).klass === 'provenanceMismatch')
  check('🔴 🔴 **원천 글 번호가 다르다 → provenanceMismatch**',
    run(row({ rawSourceArticleId: 'A999-deadbeef' })).klass === 'provenanceMismatch')
  check('🔴 생성 계약(pipeline)이 다르다 → provenanceMismatch',
    run(row({}, { pipelineVersion: 'content-core-v2.0' })).klass === 'provenanceMismatch')
  check('🔴 plan 과 voice 의 Persona 가 다르다 → provenanceMismatch',
    run(row(), [artifact({ planPersonaCode: 'P01' })]).klass === 'provenanceMismatch')
  check('🔴 🔴 **배정 Persona 가 artifact plan·voice 와 같으면 clean**', run(row({ matchedPersonaCode: 'P04' })).klass === 'clean')
  check('🔴 🔴 **배정 Persona 가 artifact 와 다르면 provenanceMismatch (clean 복원 아님)**',
    run(row({ matchedPersonaCode: 'P05' })).klass === 'provenanceMismatch')
  check('🔴 미배정(null) 그림자는 허용', run(row({ matchedPersonaCode: null })).klass === 'clean')
  check('🔴 🔴 **artifact 의 의미 검수가 불완전 → warning**',
    run(row(), [artifact({ review: { deterministic: { pass: true }, semanticCompletion: { complete: false }, semantic: { confidence: 0.9 } } })]).klass === 'warning')
  check('🔴 원문에 차단 표현이 있다 → warning', run(row({ draftBody: '오늘도 산책했어요', draftTitle: draft.title }), [artifact({ draft: { title: draft.title, body: '오늘도 산책했어요' } })]).klass === 'warning')
}

console.log('\n③ 🔴 표본 — 인증된 사람 v2 기록만 · 결과도 기록이 확정 · 결속이 깨지면 제외 · 기준 불변')
{
  const T = '평범한 하루'
  const B = '아침에 산책을 다녀왔어요'
  type Row = { decidedBy: string | null; status: string; draftTitle: string; draftBody: string; editedTitle: string | null; editedBody: string | null; declineReason: string | null; editDiff: unknown }
  const base = (o: Partial<Row> = {}): Row => ({
    decidedBy: HUMAN_DECIDER, status: 'APPROVED', draftTitle: T, draftBody: B, editedTitle: null, editedBody: null, declineReason: null, editDiff: null, ...o,
  })
  /** 지금 행 상태로 결속한 기록 — 기본은 서버가 쓴 human:founder · 결함 no */
  const rv = (row: Row, o: Partial<EvidenceReview> = {}): EvidenceReview => ({
    contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', reviewerUserId: 'u-founder', ...bindingOf(row),
    hardDefect: 'no', reasons: [], bundleDigest: digestOf('bundle'), reviewedAt: '2026-09-25T00:00:00Z', ...o,
  })
  const withReview = (row: Row, o: Partial<EvidenceReview> = {}): Row => ({ ...row, editDiff: { [EVIDENCE_REVIEW_KEY]: [rv(row, o)] } })
  const noEditRow = (o: Partial<EvidenceReview> = {}) => withReview(base(), o)
  const editedRow = (o: Partial<EvidenceReview> = {}) => withReview(base({ status: 'EDITED', editedBody: `${B} 고침` }), o)
  const declinedRow = (o: Partial<EvidenceReview> = {}) => withReview(base({ status: 'DECLINED', declineReason: 'TOPIC_UNFIT' }), o)
  const n = (k: number, noEdit: number) => [...Array.from({ length: noEdit }, () => noEditRow()), ...Array.from({ length: k - noEdit }, () => editedRow())]
  check('🔴 🔴 **30건 · 무수정 27(90.0%) · 결함 0 → 계약 충족 (열림)**', cohortSampleOf(n(30, 27)).meetsContract)
  check('🔴 🔴 **29건 → 미달 (30 을 낮추지 않았다)**', !cohortSampleOf(n(29, 29)).meetsContract)
  check('🔴 🔴 **30건 · 무수정 26(86.7%) → 미달 (90% 를 낮추지 않았다)**', !cohortSampleOf(n(30, 26)).meetsContract)
  check('🔴 결함 yes 하나면 미달', !cohortSampleOf([...n(29, 29), editedRow({ hardDefect: 'yes', reasons: ['생활사 모순'] })]).meetsContract)
  const um = cohortSampleOf([...n(29, 29), noEditRow({ hardDefect: 'unmeasured' })])
  check('🔴 🔴 **hardDefect 미측정 하나 → null · 게이트 닫힘**', um.hardDefects === null && um.hardDefectUnmeasured === 1 && !um.meetsContract)
  // ── 결과는 기록이 확정한다 — noEdit · edited · declined 각각 결속 ──
  const v1 = humanSampleOf(noEditRow()); const v2 = humanSampleOf(editedRow()); const v3 = humanSampleOf(declinedRow())
  check('🔴 🔴 **noEdit · edited · declined 각각 기록이 결과를 확정한다**',
    v1.counted && v1.outcome === 'noEdit' && v2.counted && v2.outcome === 'edited' && v3.counted && v3.outcome === 'declined')
  // ── 검토 뒤 최종 상태가 바뀌면 즉시 제외 ──
  const e = editedRow()
  check('🔴 🔴 **edited 검토 뒤 수정본이 바뀌면 제외 (bindingBroken)**',
    (() => { const x = humanSampleOf({ ...e, editedBody: `${B} 또 고침` }); return !x.counted && x.why === 'bindingBroken' })())
  const nr = noEditRow()
  check('🔴 🔴 **noEdit 검토 뒤 수정본이 생기면 제외**', !humanSampleOf({ ...nr, editedTitle: '새 제목', status: 'EDITED' }).counted)
  check('🔴 🔴 **noEdit 검토 뒤 폐기되면 제외**', !humanSampleOf({ ...nr, status: 'DECLINED', declineReason: 'TOPIC_UNFIT' }).counted)
  const dr = declinedRow()
  check('🔴 🔴 **declined 검토 뒤 폐기 사유가 바뀌면 제외**', !humanSampleOf({ ...dr, declineReason: 'TITLE_WEAK' }).counted)
  check('🔴 🔴 **초안이 바뀌면 제외**', !humanSampleOf({ ...nr, draftBody: `${B}!` }).counted)
  // ── legacy editDiff 표식은 결과를 정하지 않는다 ──
  const legacy = { ...noEditRow(), editDiff: { bodyChanged: true, [EVIDENCE_REVIEW_KEY]: [rv(base())] } }
  check('🔴 🔴 **옛 editDiff 수정 표식(Codex 기록일 수 있다)은 결과를 바꾸지 않는다 — 기록의 noEdit 그대로**',
    (() => { const x = humanSampleOf(legacy); return x.counted && x.outcome === 'noEdit' })())
  // ── 출처 ──
  const codex = cohortSampleOf([...n(29, 29), noEditRow({ reviewer: 'codex:master-review', reviewerUserId: null }), noEditRow({ reviewer: 'model:semantic-audit', reviewerUserId: null })])
  check('🔴 🔴 **Codex·모델 기록만 있는 행은 사람 표본이 아니다 → 29 · 닫힘**', codex.eligible === 29 && codex.excluded.nonHumanOnly === 2 && !codex.meetsContract)
  check('🔴 🔴 **사람 기록에 사용자 id 가 없으면 기록 자체가 무효 (서버가 쓰지 않은 기록)**',
    readEvidenceReviews(noEditRow({ reviewerUserId: null }).editDiff).length === 0 && readEvidenceReviews(noEditRow({ reviewerUserId: '' }).editDiff).length === 0)
  check('🔴 비사람 기록에 사용자 id 가 있으면 무효', readEvidenceReviews(noEditRow({ reviewer: 'codex:master-review', reviewerUserId: 'u' }).editDiff).length === 0)
  check('🔴 🔴 **legacy founder 표식만 있고 기록이 없으면 표본이 아니다**', cohortSampleOf([base()]).excluded.noReview === 1)
  check('🔴 🔴 **v1 기록은 읽지 않는다 (출처 증명 없음)**',
    readEvidenceReviews({ [EVIDENCE_REVIEW_KEY]: [{ ...rv(base()), contract: 'evidence-review-v1' }] }).length === 0)
  check('🔴 🔴 **임의 문자열 검토자는 기록 자체가 무효**',
    readEvidenceReviews({ [EVIDENCE_REVIEW_KEY]: [rv(base(), { reviewer: 'founder' as never }), rv(base(), { reviewer: 'Human:founder' as never })] }).length === 0
    && !isHumanReviewer('founder') && isHumanReviewer('human:founder'))
  check('🔴 결속이 맞지 않는 사람 기록은 무시 — 맞는 기록의 결과만 쓴다',
    (() => { const r0 = base(); const x = humanSampleOf({ ...r0, editDiff: { [EVIDENCE_REVIEW_KEY]: [{ ...rv(r0), reviewerUserId: 'u2', outcome: 'edited' }, rv(r0)] } }); return x.counted && x.outcome === 'noEdit' && x.reviewers.length === 1 })())
  check('🔴 사람 결정 표식이 없는 행(기계·자동)은 표본이 아니다',
    cohortSampleOf([{ ...noEditRow(), decidedBy: 'machine:auto-draft-v5' }, { ...noEditRow(), decidedBy: AUTO_DECIDER }]).eligible === 0)
  // ── 서버 검토자 결정 ──
  check('🔴 🔴 **검토자는 세션으로만 — 관리자면 human:operator · 아니면 null · env 의존 없음**',
    resolveHumanReviewer({ isAdmin: false }) === null && resolveHumanReviewer({ isAdmin: true }) === 'human:operator'
    && !/SORAN_FOUNDER_EMAILS/.test(codeOnly('src/lib/review-provenance.ts').replace(/\/\*\*[\s\S]*?\*\//g, '')
      + codeOnly('src/lib/actions/auto-ready-evidence.ts')))
  // ── 사용자별 최신 판정 합산 (2026-09-25 마스터 P0) ──
  const r0 = base()
  const at = (u: string, hd: EvidenceReview['hardDefect'], t: string, reasons: string[] = hd === 'yes' ? ['근거'] : []) =>
    rv(r0, { reviewer: 'human:operator', reviewerUserId: u, hardDefect: hd, reasons, reviewedAt: t })
  const hdOf = (...recs: EvidenceReview[]) => { const v = humanSampleOf({ ...r0, editDiff: { [EVIDENCE_REVIEW_KEY]: recs } }); return v.counted ? v.hardDefect : 'excluded' }
  check('🔴 🔴 **A unmeasured + B no → no**', hdOf(at('A', 'unmeasured', '2026-09-25T01:00:00Z'), at('B', 'no', '2026-09-25T01:00:00Z')) === 'no')
  check('🔴 🔴 **A no + B yes → yes**', hdOf(at('A', 'no', '2026-09-25T01:00:00Z'), at('B', 'yes', '2026-09-25T01:00:00Z')) === 'yes')
  check('🔴 모두 미측정일 때만 unmeasured', hdOf(at('A', 'unmeasured', '2026-09-25T01:00:00Z'), at('B', 'unmeasured', '2026-09-25T01:00:00Z')) === 'unmeasured')
  check('🔴 🔴 **같은 사람은 마지막에 붙은 기록만 — 앞의 yes 뒤에 no 면 no**',
    hdOf(at('A', 'yes', '2026-09-25T01:00:00Z'), at('A', 'no', '2026-09-25T02:00:00Z')) === 'no')
  check('🔴 🔴 **최신의 정본은 append 순서 — 나중에 붙은 기록의 시각이 더 과거여도 그 기록이 최신**',
    hdOf(at('A', 'no', '2026-09-25T02:00:00Z'), at('A', 'yes', '2026-09-25T01:00:00Z')) === 'yes'
    && !/Date\.parse|reviewedAt/.test(codeOnly('src/lib/auto-ready-evidence.ts').split('export function effectiveHumanReviews')[1]!.split('export type HumanSampleVerdict')[0]!))
  check('🔴 🔴 **결속이 깨진 옛 기록은 쓰지 않고 새 결속 기록을 쓴다 (이력은 남는다)**',
    (() => { const changed = { ...r0, editedBody: `${B} 새 문안`, status: 'EDITED' }
      const old = at('A', 'yes', '2026-09-25T01:00:00Z'); const fresh = { ...rv(changed, { reviewer: 'human:operator', reviewerUserId: 'A', hardDefect: 'no', reviewedAt: '2026-09-25T02:00:00Z' }) }
      const v = humanSampleOf({ ...changed, editDiff: { [EVIDENCE_REVIEW_KEY]: [old, fresh] } })
      return v.counted && v.outcome === 'edited' && v.hardDefect === 'no' && readEvidenceReviews({ [EVIDENCE_REVIEW_KEY]: [old, fresh] }).length === 2 })())
  check('🔴 🔴 **계약 값은 정본 그대로다 — 30 · 90% · 0**', CONTRACT.reviewSampleMin === 30 && CONTRACT.noEditAccuracyMin === 0.9
    && CONTRACT.hardDefectMax === 0 && CONTRACT.sampledAuditRatio === 0.2)
  check('🔴 🔴 **검토자 계약·운영 표식은 review-provenance 한 곳에서만 정의된다**',
    !/export const (HUMAN_DECIDER|MACHINE_REVIEWED_BY) = 'founder'|DECIDED_BY_VALUES = \['founder'\]/.test(
      codeOnly('src/lib/auto-ready-v2.ts') + codeOnly('src/lib/original-post-auto-publish.ts') + codeOnly('src/lib/original-post-decision.ts'))
    && HUMAN_DECIDER === LEGACY_DECISION_MARK
    && (codeOnly('src/lib/auto-ready-evidence.ts') + codeOnly('src/lib/auto-ready-evidence-store.ts')).match(/'human:founder'/g) === null)
  // ── 서버 경계 소스 계약 ──
  const action = codeOnly('src/lib/actions/auto-ready-evidence.ts')
  check('🔴 🔴 **서버 경계는 requireAdmin · 세션 · resolveHumanReviewer · 서버 시계로 기록한다**',
    /const \{ ok \} = await requireAdmin\(\)\s*if \(!ok\) return \{ error/.test(action) && /const session = await auth\(\)/.test(action)
    && /resolveHumanReviewer\(\{ isAdmin: true \}\)/.test(action)
    && /actor: \{ userId, reviewer \}, now: new Date\(\)/.test(action))
  check('🔴 🔴 **요청 본문의 reviewer · reviewedAt 은 읽지 않는다 — 다섯 칸만 꺼낸다**',
    !/\.reviewer\b|\.reviewedAt\b|reviewedAt:/.test(action.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))
    && (action.match(/const reviewer = resolveHumanReviewer\(\{ isAdmin: true \}\)\n/g) ?? []).length === 1
    && /decision: r\.decision, declineReason: r\.declineReason, hardDefect: r\.hardDefect, reasons: r\.reasons,\s*withdraw: r\.withdraw === true,/.test(action))
  const store = codeOnly('src/lib/auto-ready-evidence-store.ts')
  check('🔴 🔴 **사람 경로 — 빈 판정은 건너뜀(write 0) · yes·no 만 · 기록은 쌓는다(append-only)**',
    /if \(blank\) \{ out\.push\(\{ queueId: e\.queueId, result: 'skip'/.test(store)
    && /if \(e\.hardDefect !== 'yes' && e\.hardDefect !== 'no'\) \{ reject/.test(store)
    && /const m = appendHumanReview\(now\.editDiff, entry, now\)/.test(store) && !/if \(m\.kind === 'conflict'\) throw/.test(store))
  // ── 🔴 결함 yes 인데 발행 가능한 상태를 남기지 않는다 (2026-09-26 마스터 P0) ──
  check('🔴 🔴 **결정 전 행 — ready + 결함 yes 는 전체 거절**',
    /if \(decision === 'ready' && d\.hardDefect === 'yes'\) \{ reject\(/.test(store))
  check('🔴 🔴 **승인 미발행 + 결함 yes — 명시적 철회가 없으면 기록하지 않는다 · 철회 실패면 되돌린다**',
    /if \(d\.hardDefect === 'yes'\) \{\s*if \(!withdraw\) throw new Abort\(/.test(store)
    && /const w = await withdrawOriginalPostInTx\(tx, \{ row, reason: e\.declineReason, actorUserId: i\.actor\.userId, now: i\.now \}\)\s*if \(!w\.ok\) throw new Abort/.test(store))
  const W = codeOnly('src/lib/original-post-withdrawal.ts')
  check('🔴 🔴 **철회 계약 — APPROVED·EDITED 만 · 발행됨 불가 · 사유 코드 필수(기본값 없음)**',
    !planOriginalPostWithdrawal({ status: 'APPROVED', createdPostId: 'p1', reason: 'TOPIC_UNFIT' }).ok
    && !planOriginalPostWithdrawal({ status: 'DECLINED', createdPostId: null, reason: 'TOPIC_UNFIT' }).ok
    && !planOriginalPostWithdrawal({ status: 'PUBLISHED', createdPostId: null, reason: 'TOPIC_UNFIT' }).ok
    && !planOriginalPostWithdrawal({ status: 'APPROVED', createdPostId: null, reason: '' }).ok
    && !planOriginalPostWithdrawal({ status: 'APPROVED', createdPostId: null, reason: 'MADE_UP' }).ok
    && planOriginalPostWithdrawal({ status: 'EDITED', createdPostId: null, reason: 'TOPIC_UNFIT' }).ok)
  check('🔴 🔴 **철회는 승인 도장(decidedBy·decidedAt)을 덮지 않는다 · 조건부 쓰기(createdPostId null · updatedAt · editDiff)**',
    !/decidedBy:|decidedAt:/.test(W.split('data: {')[1]!.split('editDiff:')[0]!)
    && /createdPostId: null, updatedAt: i\.row\.updatedAt,/.test(W))
  check('🔴 🔴 **CLI importer 는 사람 기록을 만들지 못한다 · 시각은 프로세스 시계 · 결과는 지금 상태로 결속**',
    /if \(isHumanReviewer\(reviewer\)\) \{\s*return \{ ok: false/.test(store) && /reviewedAt: now\.toISOString\(\)/.test(store)
    && !/file\.reviewedAt/.test(store) && /reviewerUserId: null, \.\.\.bindingOf\(row\)/.test(store))
}

console.log('\n④ 🔴 도장 — 본문·제목·계약 판 hash')
{
  const st = makeStamp('제목', '본문', new Date('2026-09-25T00:00:00Z'))
  check('도장은 자동 표식이다 — founder 가 아니다', st.decidedBy === AUTO_DECIDER && (AUTO_DECIDER as string) !== HUMAN_DECIDER)
  check('기준선 — 같은 글이면 유효', stampValidFor(st, '제목', '본문').ok)
  check('🔴 🔴 **도장 뒤 본문이 한 글자 바뀌면 무효**', !stampValidFor(st, '제목', '본문.').ok)
  check('🔴 🔴 **도장 뒤 제목이 바뀌면 무효**', !stampValidFor(st, '제목!', '본문').ok)
  check('🔴 🔴 **판정 계약이 바뀌면 옛 도장은 무효**', !stampValidFor({ ...st, contractDigest: 'old' }, '제목', '본문').ok)
  check('🔴 도장 기록 왕복', JSON.stringify(readStamp({ [AUTO_READY_RECORD_KEY]: st })) === JSON.stringify(st))
  check('🔴 모양이 깨진 도장은 없는 것과 같다',
    readStamp({ [AUTO_READY_RECORD_KEY]: { ...st, bodyHash: '' } }) === null
    && readStamp({ [AUTO_READY_RECORD_KEY]: { ...st, decidedBy: HUMAN_DECIDER } }) === null
    && readStamp(null) === null && readStamp({}) === null)
  check('🔴 계약 판 digest 가 비어 있지 않다', JUDGE_CONTRACT_DIGEST.length === 32)
}

console.log('\n⑤ 🔴 selector — 기본 닫힘 · 도장이 지금 글과 같을 때만')
{
  const mk = (o: Partial<AutoRow> = {}): AutoRow => ({
    id: 'm1', status: 'APPROVED', createdPostId: null, gateVerdict: 'PASS',
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, matchedPersonaId: null,
    title: '제목', body: '본문', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:x`,
    // 🔴 도장은 지금 품질 계약 행에만 찍힌다(`stampRowInTx`) — fixture 도 그 모양이다
    gateResults: { ...gateWith(GOOD_SR), [QUALITY_CONTRACT_KEY]: currentQualityContract() },
    decidedBy: AUTO_DECIDER, decidedAt: new Date(), createdAt: new Date(),
    editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp('제목', '본문', new Date()) },
    ...o,
  } as AutoRow)
  const pass0 = () => 'pass'
  const codeOf = (r: AutoRow, open?: boolean) => {
    const x = selectAutoTargets([r], pass0, open === undefined ? {} : { autoReadyOpen: open })
    return x.targets.length === 1 ? 'TARGET' : x.rejected[0]?.code
  }
  check('🔴 🔴 **기본(옵션 없음)은 닫힘 → AUTO_READY_CLOSED**', codeOf(mk()) === 'AUTO_READY_CLOSED', String(codeOf(mk())))
  check('🔴 명시적으로 닫힘 → AUTO_READY_CLOSED', codeOf(mk(), false) === 'AUTO_READY_CLOSED')
  check('🔴 🔴 **열림 + 유효한 도장 → 대상**', codeOf(mk(), true) === 'TARGET', String(codeOf(mk(), true)))
  check('🔴 🔴 **열림이어도 도장 뒤 본문이 바뀌었으면 → AUTO_READY_STALE**', codeOf(mk({ body: '바뀐 본문' }), true) === 'AUTO_READY_STALE')
  check('🔴 열림이어도 도장이 없으면 → AUTO_READY_STALE', codeOf(mk({ editDiff: null }), true) === 'AUTO_READY_STALE')
  check('🔴 🔴 **기계 도장(machine:*)은 열려 있어도 사람 검토가 필요하다**',
    codeOf(mk({ decidedBy: 'machine:auto-draft-v5' }), true) === 'HUMAN_REVIEW_REQUIRED')
  check('🔴 사람(founder) 결정 행 동작은 그대로다 — 옵션과 무관하게 대상',
    codeOf(mk({ decidedBy: HUMAN_DECIDER, editDiff: null })) === 'TARGET')

  /**
   * 🔴 **옛 품질 계약 자동 도장 행 (2026-09-28).** 도장은 판정 계약만 보므로 품질 계약이 올라가도
   *    유효하게 읽힌다 — selector 가 거르지 않으면 발행 줄 선두에 서고 트랜잭션 재검증에서야 막힌다.
   *    PR #591 에 기대지 않는다 — 행 쪽 표식을 "지금 계약이 아닌 것" 으로 만든다.
   */
  const oldGate = (m: 'otherDigest' | 'otherVersion' | 'none'): Record<string, unknown> => ({
    ...gateWith(GOOD_SR),
    ...(m === 'none' ? {} : {
      [QUALITY_CONTRACT_KEY]: m === 'otherDigest'
        ? { version: QUALITY_CONTRACT_VERSION, digest: digestOf('옛 게이트 · 옛 검수') }
        : { version: 'quality-v0', digest: digestOf('옛 판') },
    }),
  })
  check('fixture 표식은 모양이 온전하다 — digest 만 다르다(모양 탓 legacy 가 아니다)',
    readQualityContract(oldGate('otherDigest')) !== null && readQualityContract(oldGate('otherVersion')) !== null
    && readQualityContract(oldGate('otherDigest'))?.version === QUALITY_CONTRACT_VERSION)
  check('🔴 🔴 **열림 + 유효한 도장이어도 같은 판 다른 digest → QUALITY_CONTRACT_MISMATCH** (자동 발행 0)',
    codeOf(mk({ gateResults: oldGate('otherDigest') }), true) === 'QUALITY_CONTRACT_MISMATCH',
    String(codeOf(mk({ gateResults: oldGate('otherDigest') }), true)))
  /**
   * 🔴 (quality-v5 · 2026-10-01) **실제 v4 표식** 그대로 — v4 로 도장 찍힌 운영 READY 는 v5 에서 자동 발행되지 않는다.
   *    구제 · 일괄 변환 경로가 없다: 표식을 지금 계약으로 바꾸는 코드는 도장(`stampRowInTx`) 하나뿐이고 지금 계약 행에만 찍는다.
   */
  const V4_MARK = { version: 'quality-v4', digest: '379bf6c61fe1431f928da2e44cde0731fdf1850a301b0c808378a6875be47daa' }
  check('🔴 🔴 **실제 v4 표식 READY → 열림 · 유효 도장이어도 QUALITY_CONTRACT_MISMATCH**',
    codeOf(mk({ gateResults: { ...gateWith(GOOD_SR), [QUALITY_CONTRACT_KEY]: V4_MARK } }), true) === 'QUALITY_CONTRACT_MISMATCH'
    && QUALITY_CONTRACT_VERSION === 'quality-v5' && currentQualityContract().digest !== V4_MARK.digest)
  check('🔴 새 계약(v5) 표식 READY 만 대상', codeOf(mk(), true) === 'TARGET')
  check('🔴 🔴 **옛 판 · 표식 없음(legacy)도 같다**',
    codeOf(mk({ gateResults: oldGate('otherVersion') }), true) === 'QUALITY_CONTRACT_MISMATCH'
    && codeOf(mk({ gateResults: oldGate('none') }), true) === 'QUALITY_CONTRACT_MISMATCH')
  check('🔴 🔴 **닫혀 있어도 영구 사유가 먼저다** — AUTO_READY_CLOSED(WIP)로 숨지 않는다',
    codeOf(mk({ gateResults: oldGate('otherDigest') }), false) === 'QUALITY_CONTRACT_MISMATCH')
  check('🔴 🔴 **사람이 검토한 옛 계약 행(founder)은 그대로 대상이다** — 임의로 빼지 않는다',
    codeOf(mk({ decidedBy: HUMAN_DECIDER, editDiff: null, gateResults: oldGate('otherDigest') }), true) === 'TARGET'
    && codeOf(mk({ decidedBy: HUMAN_DECIDER, editDiff: null, gateResults: oldGate('none') })) === 'TARGET')
  check('🔴 사람 검토 전 옛 계약 기계 행의 selector 코드는 그대로 HUMAN_REVIEW_REQUIRED (사람 검토 묶음 불변)',
    codeOf(mk({ decidedBy: 'machine:auto-draft-v5', gateResults: oldGate('otherDigest') }), true) === 'HUMAN_REVIEW_REQUIRED')
}

console.log('\n⑥ 🔴 열림 · 스위치 · 감사')
{
  const ev = { meetsContract: true, reasons: [] as string[] }
  check('🔴 🔴 **스위치 기본 OFF**', !autoReadyEnabled({}) && !autoReadyEnabled({ [AUTO_READY_ENV]: '' })
    && !autoReadyEnabled({ [AUTO_READY_ENV]: 'true' }) && !autoReadyEnabled({ [AUTO_READY_ENV]: '1' })
    && autoReadyEnabled({ [AUTO_READY_ENV]: 'on' }))
  check('기준선 — 넷 다 참이면 열림', judgeOpen({ enabled: true, evidence: ev, confirmedDefects: 0, missingAutoPosts: 0 }).open)
  check('🔴 스위치가 꺼져 있으면 닫힘', !judgeOpen({ enabled: false, evidence: ev, confirmedDefects: 0, missingAutoPosts: 0 }).open)
  check('🔴 🔴 **증거 미달이면 닫힘**', !judgeOpen({ enabled: true, evidence: { meetsContract: false, reasons: ['8/30'] }, confirmedDefects: 0, missingAutoPosts: 0 }).open)
  check('🔴 🔴 **확정 결함 하나면 닫힘 — 다음 회차를 멈춘다**', !judgeOpen({ enabled: true, evidence: ev, confirmedDefects: 1, missingAutoPosts: 0 }).open)
  check('🔴 결함 수를 못 읽으면(음수·NaN) 닫힘',
    !judgeOpen({ enabled: true, evidence: ev, confirmedDefects: Number.NaN, missingAutoPosts: 0 }).open
    && !judgeOpen({ enabled: true, evidence: ev, confirmedDefects: -1, missingAutoPosts: 0 }).open)
  check('🔴 🔴 **글이 사라진 자동 발행이 하나면 닫힘 — 감사로 뽑히지 않았어도**',
    !judgeOpen({ enabled: true, evidence: ev, confirmedDefects: 0, missingAutoPosts: 1 }).open)
  check('🔴 글 유실 수를 못 읽으면(음수·NaN) 닫힘',
    !judgeOpen({ enabled: true, evidence: ev, confirmedDefects: 0, missingAutoPosts: Number.NaN }).open
    && !judgeOpen({ enabled: true, evidence: ev, confirmedDefects: 0, missingAutoPosts: -1 }).open)
  check('🔴 🔴 **감사 대기는 열림 판정의 입력이 아니다 — 매 회차 사람 허가가 아니다**',
    !/pending|대기/.test(codeOnly('src/lib/auto-ready-v2.ts').split('export function judgeOpen')[1]?.split('export function auditTarget')[0] ?? 'x'))
  let exact = true
  for (let n = 0; n <= 2000; n += 1) if (auditTarget(n) !== (n === 0 ? 0 : Math.floor((n + 4) / 5))) { exact = false; break }
  check('🔴 🔴 **감사 수 = 정확히 ceil(N×0.2) (N 0~2000 전수)**', exact)
  check('🔴 비율이 바뀌어도 정수로 맞다 — 100×0.55 → 55 (부동소수 곱은 56)',
    auditTarget(100, 0.55) === 55 && Math.ceil(100 * 0.55) === 56)
  const ids = Array.from({ length: 23 }, (_, i) => `q${i}`)
  const p1 = pickAudits({ autoPublished: ids, alreadySelected: new Set() })
  check('🔴 🔴 **23건이면 정확히 5건을 고른다**', p1.target === 5 && p1.pick.length === 5 && new Set(p1.pick).size === 5)
  const p2 = pickAudits({ autoPublished: [...ids, 'q23', 'q24', 'q25'], alreadySelected: new Set(p1.pick) })
  check('🔴 🔴 **이미 고른 것은 다시 고르지 않고 모자란 만큼만 더 고른다**',
    p2.target === 6 && p2.pick.length === 1 && !p1.pick.includes(p2.pick[0]!))
  check('🔴 다시 돌려도 같은 답이다', JSON.stringify(pickAudits({ autoPublished: ids, alreadySelected: new Set() }).pick) === JSON.stringify(p1.pick))
  check('🔴 🔴 **결함 판정은 끈적하다 — yes 는 no 로 덮이지 않는다**',
    mergeDefect('yes', 'no') === 'yes' && mergeDefect('no', 'yes') === 'yes' && mergeDefect(null, 'no') === 'no')
}

console.log('\n⑦ 🔴 founder 기록 0 · 쓰기 경로 모양')
{
  const repo = codeOnly('src/lib/auto-ready-repo.ts')
  /** 🔴 쓰기(`data:`) 블록 안의 decidedBy 만 본다 — 조회 조건(`where:`)은 쓰기가 아니다 */
  const writes = [...repo.matchAll(/data: \{\s*decidedBy: ([A-Za-z_.']+),/g)].map((m) => m[1])
  /** 모든 `data: { ... }` 쓰기 블록 — 여기에 founder 가 나오면 안 된다 */
  const dataBlocks = [...repo.matchAll(/data: \{[^}]*\}/g)].map((m) => m[0])
  check('🔴 🔴 **저장 경로가 decidedBy 에 쓰는 값은 AUTO_DECIDER 하나뿐이다**',
    writes.length === 1 && writes[0] === 'AUTO_DECIDER'
    && dataBlocks.length >= 2
    && dataBlocks.every((b) => !/HUMAN_DECIDER|'founder'/.test(b)),
    `쓰기 ${JSON.stringify(writes)} · data 블록 ${dataBlocks.length}개`)
  check('🔴 🔴 **감사자는 founder 일 수 없다**', /auditor === HUMAN_DECIDER/.test(repo)
    && /AutoReadyAudit_auditor_not_founder/.test(readFileSync('prisma/migrations/0029_auto_ready_audit/migration.sql', 'utf-8')))
  check('🔴 🔴 **도장은 조건부 쓰기(CAS) + Serializable 이다**',
    /updatedAt: row\.updatedAt/.test(repo) && /decidedBy: row\.decidedBy/.test(repo)
    && /isolationLevel: 'Serializable'/.test(repo))
  check('🔴 🔴 **도장은 기계 도장 행만 — 사람·자동 결정 행을 건드리지 않는다**',
    /if \(!d\.startsWith\('machine:'\)\) return \{ kind: 'skip'/.test(repo))
  check('🔴 🔴 **yes 를 no 로 덮지 못하게 조건부로 쓴다**',
    /OR: \[\{ defect: null \}, \{ defect: 'no' \}\]/.test(repo))
  check('🔴 🔴 **스위치가 꺼져 있으면 감사 표를 읽지 않는다**',
    /if \(!enabled\) \{\s*return judgeOpen\(/.test(repo)
    && /if \(!autoReadyEnabled\(i\.env\)\) return \{ ok: false, reason: '자동 READY 스위치가 꺼져 있다' \}/.test(repo)
    && /if \(!autoReadyEnabled\(i\.env\)\) return \{ kind: 'off' \}/.test(repo))
  const tx = codeOnly('src/lib/original-post-publish-tx.ts')
  check('🔴 🔴 **발행 트랜잭션이 실제로 발행할 본문으로 재검증한다**',
    /recheckAutoReadyInTx\(tx, \{/.test(tx) && /title: row\.editedTitle \?\? row\.draftTitle/.test(tx)
    && /body: row\.editedBody \?\? row\.draftBody/.test(tx))
  check('🔴 발행 조건부 쓰기가 결정자도 대조한다', /createdPostId: null, decidedBy: row\.decidedBy \}/.test(tx))
  const runner = codeOnly('scripts/original-post-auto-publish.mts')
  check('🔴 🔴 **러너 스위치 기본 OFF — env 에서만 켠다**',
    /const AUTO_READY_ON = autoReadyEnabled\(process\.env\)/.test(runner)
    && /autoReadyEnv: process\.env/.test(runner))
  check('🔴 도장은 --apply 이고 열렸을 때만', /if \(APPLY && autoOpen\.open\) \{/.test(runner))
  check('🔴 🔴 **감사 기록은 로컬 파일이 아니라 DB 다**',
    !/writeFileSync|appendFileSync/.test(repo) && /tx\.autoReadyAudit\.create\(/.test(repo))
  /**
   * 🔴 **새 대기 기간·pending 상수·개수 제한 0.** 변수 이름 `pending` 은 "판정 전 목록" 이지
   *    상수가 아니다 — 대문자 상수와 조회 개수 제한(`take:`)을 본다.
   */
  const both = repo + codeOnly('src/lib/auto-ready-v2.ts')
  check('🔴 새 대기 기간·pending 상수·개수 제한을 만들지 않았다',
    !/\b[A-Z_]*(PENDING|WAIT_DAYS|GRACE|COOLDOWN|MAX_PENDING|AUDIT_LIMIT)[A-Z_]*\s*=/.test(both)
    && !/defect: null \}[^)]*take:/.test(repo),
    (both.match(/\b[A-Z_]*(PENDING|WAIT|GRACE|COOLDOWN)[A-Z_]*\s*=/g) ?? []).join(','))
}

console.log('\n⑨ 🔴 열림은 호출자가 정하지 않는다 — 쓰기 경계가 DB 로 판정한다')
{
  const repo = codeOnly('src/lib/auto-ready-repo.ts')
  const stampSig = repo.split('export async function stampAutoReady(')[1]?.split('): Promise<StampOutcome>')[0] ?? ''
  check('🔴 🔴 **도장 함수가 `open` 을 받지 않는다 — env 만 받는다**',
    !/open/.test(stampSig) && /env: Env/.test(stampSig), stampSig.replace(/\s+/g, ' '))
  const stampBody = repo.split('export async function stampAutoReady(')[1]?.split('export async function stampRound')[0] ?? ''
  check('🔴 🔴 **도장 트랜잭션 안에서 스위치·DB 증거·결함을 판정한다**',
    /const gate = await authoritativeGate\(tx, i\.env\)/.test(stampBody)
    && stampBody.indexOf('authoritativeGate(tx') < stampBody.indexOf('updateMany('))
  const recheck = repo.split('export async function recheckAutoReadyInTx(')[1]?.split('export async function selectAudits')[0] ?? ''
  check('🔴 🔴 **발행 재검증도 같은 DB 증거 게이트를 트랜잭션 안에서 본다**',
    /const gate = await authoritativeGate\(tx, i\.env\)/.test(recheck))
  const gate = repo.split('export async function authoritativeGate(')[1]?.split('export type StampOutcome')[0] ?? ''
  check('🔴 🔴 **게이트가 증거를 DB 에서 직접 읽는다 (정본 cohortSampleOf)**',
    /evidenceFromDb\(db\)/.test(gate) && /confirmedDefectCount\(db\)/.test(gate)
    && /return cohortSampleOf\(eligible\)/.test(repo))
  check('🔴 OpenState 를 받는 쓰기 함수가 없다',
    !/open: OpenState/.test(repo) && !/i\.open\b/.test(repo))
}

console.log('\n⑩ 🔴 자동 행 배정은 발행 트랜잭션 안에서 — 재검증이 모든 쓰기보다 먼저')
{
  const tx = codeOnly('src/lib/original-post-publish-tx.ts')
  const body = tx.split('return await prisma.$transaction(async (tx) => {')[1] ?? ''
  const at = (re: RegExp): number => { const m = re.exec(body); return m === null ? -1 : m.index }
  const iRecheck = at(/recheckAutoReadyInTx\(tx,/)
  const iAssign = at(/matchedPersonaId: persona\.id, matchedAt: txNow,/)
  const iJudge = at(/const verdict = judgePublish\(/)
  const iPost = at(/tx\.post\.create\(/)
  const firstWrite = Math.min(...[at(/\.updateMany\(/), at(/\.create\(/)].filter((x) => x >= 0))
  check('🔴 🔴 **재검증이 트랜잭션의 첫 쓰기보다 앞선다**', iRecheck >= 0 && iRecheck < firstWrite, `${iRecheck} < ${firstWrite}`)
  check('🔴 🔴 **배정 쓰기는 발행 판정 뒤 · Post 앞 — 같은 트랜잭션**',
    iJudge >= 0 && iAssign > iJudge && iPost > iAssign, `${iJudge} < ${iAssign} < ${iPost}`)
  check('🔴 배정 쓰기는 자동 행에만 — pendingAssign 이 isAuto 를 요구한다',
    /const pendingAssign = isAuto && !pinned && input\.autoAssign !== undefined/.test(tx)
    && /const pinned = row\.matchedPersona !== null/.test(tx))
  check('🔴 배정이 경쟁에 지면 롤백한다', /if \(assigned\.count !== 1\) throw new Error\(QUEUE_RACE\)/.test(tx))
  const runner = codeOnly('scripts/original-post-auto-publish.mts')
  check('🔴 🔴 **러너는 자동 행 배정을 미리 쓰지 않는다 — 계획만 넘긴다**',
    /if \(target\.matchedPersonaId === null && isAutoTarget\) \{/.test(runner)
    && /autoAssign = \{ personaId: persona\.id, matchMeta: ps\.meta \}/.test(runner)
    && /mode: \{ kind: 'scheduled', releaseStage: scale\.releaseStage, planned, unattended: TRIGGER === 'local' \|\| TRIGGER === 'schedule' \},/.test(runner)
    && /\} else if \(target\.matchedPersonaId === null\) \{/.test(runner))
  check('🔴 사람 행 배정 경로는 그대로다 — 기존 조건부 UPDATE 가 남아 있다',
    /where: \{ id: target\.id, status: \{ in: \['APPROVED', 'EDITED'\] \}, createdPostId: null, matchedPersonaId: null \}/.test(runner))
}

console.log('\n⑪ 🔴 감사 — 묶음 대조 · 옛 판정 거절 · 규칙 무결성·안전 감사자')
{
  const repo = codeOnly('src/lib/auto-ready-repo.ts')
  check('🔴 🔴 **고를 때 발행 글 hash 와 도장 계약 판을 묶는다**',
    /publishedTitleHash: digestOf\(post\.title\), publishedBodyHash: digestOf\(post\.content\)/.test(repo)
    && /stampContractDigest: readStamp\(row\.editDiff\)\?\.contractDigest/.test(repo))
  check('🔴 🔴 **다른 감사 계약 판의 결과는 받지 않는다**',
    /if \(i\.verdict\.contractVersion !== AUDIT_CONTRACT_VERSION\) return 'staleContract'/.test(repo))
  check('🔴 🔴 **판정한 글이 묶은 글과 다르면 무결성 yes — 대기(hashMismatch)로 남기지 않는다**',
    /i\.verdict\.judgedTitleHash !== row\.publishedTitleHash \|\| i\.verdict\.judgedBodyHash !== row\.publishedBodyHash\s*\? '판정자가 발행 글이 아닌 글을 판정했다'/.test(repo)
    && !/'hashMismatch'/.test(repo))
  check('🔴 🔴 **고른 뒤 글이 사라지거나 바뀌면 무결성 yes — 대기(postChanged)로 남기지 않는다**',
    /post === null \? '감사 대상 Post 가 없다'/.test(repo)
    && /digestOf\(post\.title\) !== row\.publishedTitleHash \|\| digestOf\(post\.content\) !== row\.publishedBodyHash\s*\? '선정 뒤 발행 글의 제목·본문이 바뀌었다'/.test(repo)
    && !/'postChanged'/.test(repo))
  check('🔴 판정 전 감사를 개수 제한 없이 전부 읽는다',
    /autoReadyAudit\.findMany\(\{ where: \{ defect: null \}, orderBy: \{ selectedAt: 'asc' \} \}\)/.test(repo))
  const sql = readFileSync('prisma/migrations/0029_auto_ready_audit/migration.sql', 'utf-8')
  check('🔴 🔴 **0029 가 묶음 칸과 판정 출처 CHECK 를 갖는다**',
    /"publishedTitleHash" TEXT NOT NULL/.test(sql) && /"stampContractDigest" TEXT NOT NULL/.test(sql)
    && /AutoReadyAudit_judged_has_provenance/.test(sql) && /"auditModel" IS NOT NULL/.test(sql))
  const st = makeStamp('평범한 하루', '산책을 다녀왔어요. 다들 어떠세요?', new Date())
  const good = await ruleAuditJudge({ queueId: 'q', postId: 'p', title: '평범한 하루', body: '산책을 다녀왔어요. 다들 어떠세요?', stamp: st })
  check('기준선 — 도장과 같고 깨끗한 글은 no', good.defect === 'no' && verdictShapeOk(good).ok, good.reasons.join(','))
  const changed = await ruleAuditJudge({ queueId: 'q', postId: 'p', title: '평범한 하루', body: '바뀐 본문', stamp: st })
  check('🔴 🔴 **발행 본문이 도장 본문과 다르면 yes**', changed.defect === 'yes')
  const noStamp = await ruleAuditJudge({ queueId: 'q', postId: 'p', title: '평범한 하루', body: '산책을 다녀왔어요. 다들 어떠세요?', stamp: null })
  check('🔴 도장이 없으면 yes', noStamp.defect === 'yes')
  const drift = makeStamp('평범한 하루', '오늘도 산책했어요', new Date())
  check('🔴 발행 글에 차단 표현이 있으면 yes',
    (await ruleAuditJudge({ queueId: 'q', postId: 'p', title: '평범한 하루', body: '오늘도 산책했어요', stamp: drift })).defect === 'yes')
  check('🔴 규칙 감사자는 자기 판을 밝힌다 — 모델·프롬프트·감사 계약',
    good.model === 'rule:integrity-safety-audit' && good.promptVersion === 'integrity-safety-v1'
    && good.contractVersion === AUDIT_CONTRACT_VERSION)
  check('🔴 판정 모양이 깨지면 기록하지 않는다',
    !verdictShapeOk({ ...good, model: '' }).ok && !verdictShapeOk({ ...good, judgedBodyHash: 'x' }).ok
    && !verdictShapeOk({ ...good, defect: 'maybe' as never }).ok)
  /**
   * 🔴 2026-09-27 — 감사 러너는 이제 의미 감사(모델)도 돌린다. 모델 호출은 **의미 감사 제공사 한 곳**
   *    (`auto-ready-semantic-provider` → 공급 장부)뿐이고 기본 OFF 다 — `auto-ready:audit-check` 가 본다.
   *    규칙 감사자와 repo 는 여전히 모델을 모른다. 러너도 직접 부르지 않는다.
   */
  check('🔴 🔴 **규칙 감사자·repo·러너는 모델을 직접 부르지 않는다 — 모델 호출은 장부를 지나는 의미 감사 제공사 한 곳**',
    !/anthropic|openai|gemini|fetch\(/i.test(codeOnly('scripts/lib/auto-ready-rule-judge.mts') + codeOnly('scripts/auto-ready-audit.mts') + repo))
  check('🔴 감사 회차는 운영 스케줄에 연결되지 않았다',
    !/auto-ready-audit/.test(readFileSync('.github/workflows/visibility-guard.yml', 'utf-8').replace(/auto-ready:(db-)?check/g, ''))
    && !/auto-ready-audit/.test(readFileSync('.github/workflows/auto-publish.yml', 'utf-8')))
}

console.log('\n⑫ 🔴 probe 는 표본을 따로 세지 않는다 — 정본을 부른다')
{
  const probe = codeOnly('scripts/auto-ready-v2-probe.mts')
  check('🔴 🔴 **probe 가 evidenceFromDb(정본 cohortSampleOf)를 부른다**', /const sample = await evidenceFromDb\(prisma\)/.test(probe))
  check('🔴 🔴 **probe 안에 무수정·수정·폐기를 직접 세는 코드가 없다**',
    !/bodyChanged|titleChanged|declineReason|noEdit = /.test(probe))
}

console.log('\n⑧ 🔴 D10 보고 문구 — 병목을 한 줄로 뭉개지 않는다')
{
  // 🔴 출력 문장은 코드 줄에서 본다 — 주석 속 "앞판은 이렇게 적었다" 인용은 출력이 아니다
  const probe = codeOnly('scripts/auto-ready-v2-probe.mts')
  check('🔴 🔴 **"글 부족 1차 · 배정 손실 2차 · 미래 Persona 적합성 미측정" 으로 나눈다**',
    /글 부족이 1차/.test(probe) && /배정 손실이 2차/.test(probe) && /Persona 적합성은 미측정/.test(probe)
    && !/Persona 병목 없음/.test(probe))
}

console.log('\n⑬ 🔴 🔴 발행 트랜잭션이 계획된 Persona 를 다시 판정한다 — 호출자 personaId 를 믿지 않는다')
{
  const tx = codeOnly('src/lib/original-post-publish-tx.ts')
  const loader = codeOnly('scripts/lib/publishable-stock.mts')
  const at = (re: RegExp): number => { const m = re.exec(tx); return m === null ? -1 : m.index }
  const reread = at(/tx\.persona\.findUnique\(\{ where: \{ id: personaId \}, select: PERSONA_FOR_MATCH_SELECT \}\)/)
  const assemble = at(/personaForMatchOf\(tx, pr, txNow, \{ excludeQueueId: row\.id \}\)/)
  const judge = at(/const v = judgeAutoAssignment\(\{\s*persona: forMatch, gateResults: row\.gateResults,/)
  const staleRet = at(/kind: 'blocked', code: 'AUTO_ASSIGN_STALE',\s*detail: `\$\{which\} \$\{pr\.code\}/)
  const pfm = codeOnly('src/lib/persona-for-match.ts')
  const judgeFn = pfm.slice(pfm.indexOf('export function judgeAutoAssignment'))
  const assignWrite = at(/const assigned = await tx\.originalPostApprovalQueue\.updateMany/)
  const postCreate = at(/const post = await tx\.post\.create/)
  check('🔴 🔴 **트랜잭션 안에서 Persona 를 다시 읽고 로더와 같은 조립(personaForMatchOf)을 쓴다**', reread > 0 && assemble > reread)
  check('🔴 🔴 **트랜잭션은 정본 판정 함수 judgeAutoAssignment 를 쓴다 (단계 상한과 함께)**',
    judge > assemble && /caps: releaseCapsOf\(profileOf\(stage\)\),/.test(tx))
  check('🔴 🔴 **정본 판정 안에서 judgeVoiceMatch · readPostRequirements · hardFilter 를 재사용한다**',
    /judgeVoiceMatch\(\{ voice: voiceOfGateResults\(i\.gateResults\), personaCode: i\.persona\.code, profile: 'machine' \}\)/.test(judgeFn)
    && /hardFilter\(i\.persona, readPostRequirements\(i\.title, i\.body\), i\.title, i\.body, i\.caps\)/.test(judgeFn))
  check('🔴 🔴 **탈락은 배정·Post 쓰기보다 먼저 AUTO_ASSIGN_STALE 로 돌아간다**',
    staleRet > judge && assignWrite > staleRet && postCreate > assignWrite && /if \(!v\.ok\) \{\s*return \{/.test(tx))
  check('🔴 🔴 **말투 불일치와 hardFilter 탈락이 둘 다 탈락 사유 · Persona 없음은 예외**',
    /\.\.\.\(voice\.ok \? \[\] : \[`VOICE_MISMATCH/.test(judgeFn) && /\.\.\.blocks\.map\(\(b\) => b\.code\)\]/.test(judgeFn)
    && /if \(codes\.length === 0\) return \{ ok: true \}/.test(judgeFn)
    && /if \(i\.persona === null\) return \{ ok: false, route: 'exception'/.test(judgeFn))
  check('🔴 🔴 **유예는 사유가 전부 hardFilter 시간 상한일 때만 — 그 밖은 예외**',
    /TIME_BOUND_ASSIGN_CODES: readonly string\[\] = \['WEEKLY_CAP', 'TOO_SOON'\]/.test(pfm)
    && /route: codes\.every\(\(c\) => TIME_BOUND_ASSIGN_CODES\.includes\(c\)\) \? 'defer' : 'exception'/.test(judgeFn))
  check('🔴 🔴 **기존 배정 행도 재판정한다 — 자동 행이면 pinned 든 계획이든 같은 블록**',
    /if \(isAuto && \(pinned \|\| pendingAssign\)\) \{/.test(tx)
    && /const personaId = pinned \? row\.matchedPersona!\.id : input\.autoAssign!\.personaId/.test(tx))
  check('🔴 🔴 **자기 배정은 주간 사용량·최소 간격에서 뺀다 — 이중 계산 없음**',
    /const notSelf = opts\.excludeQueueId === undefined \? \{\} : \{ id: \{ not: opts\.excludeQueueId \} \}/.test(codeOnly('src/lib/persona-for-match.ts'))
    && (codeOnly('src/lib/persona-for-match.ts').match(/\.\.\.notSelf/g) ?? []).length === 2)
  check('🔴 🔴 **상한은 숫자가 아니라 단계에서 — env 천장으로 누른 단계의 정본 상한**',
    /const stage = boundedReleaseStage\(input\.mode\.releaseStage, input\.autoReadyEnv \?\? \{\}, txNow\)/.test(tx)
    && !/caps\?: BatchCaps/.test(tx) && !/autoAssign!\.caps/.test(tx))
  check('🔴 🔴 **시계는 트랜잭션 하나 — 호출자 matchedAt 을 받지 않는다**',
    /const txNow = \(deps\.now \?\? \(\(\) => new Date\(\)\)\)\(\)/.test(tx) && !/autoAssign!\.matchedAt/.test(tx) && !/matchedAt: Date/.test(tx)
    && /kstDayStart\(txNow\)/.test(tx))
  check('🔴 로더도 같은 조립을 쓴다 — 계획과 쓰기가 갈리지 않는다',
    /select: PERSONA_FOR_MATCH_SELECT/.test(loader) && /personaForMatchOf\(prisma, r, now\)/.test(loader))
  check('🔴 새 규칙·키워드를 만들지 않았다 — persona-for-match 에 정규식 없음 (판정은 정본 함수 호출뿐)',
    !/new RegExp|\/[^/\n]+\/[gimsuy]*\.test\(/.test(pfm))
  // 🔴 P0 — 계획기가 같은 판정을 소비한다
  check('🔴 🔴 **계획기가 기존 배정 자동 행을 같은 judgeAutoAssignment 로 판정하고 줄에서 뺀다**',
    /const v = judgeAutoAssignment\(\{\s*persona: loaded\.pinnedAutoPersona\.get\(t\.id\) \?\? null/.test(loader)
    && /const blocked = new Set\(\[\.\.\.autoDeferred, \.\.\.autoExceptions\]\.map\(\(x\) => x\.id\)\)/.test(loader)
    && /if \(!v\.ok\) \(v\.route === 'defer' \? autoDeferred : autoExceptions\)\.push/.test(loader)
    && /candidates: loaded\.queueCandidates\.filter\(\(c\) => !blocked\.has\(c\.queueId\)\)/.test(loader)
    && /const freshOrdered = targets\s*\.filter/.test(loader) && /const brokenRecovery = targets/.test(loader))
  check('🔴 🔴 **로더는 기존 배정 자동 행을 자기 배정 제외로 조립한다 (트랜잭션과 같은 조립)**',
    /personaForMatchOf\(prisma, pr, now, \{ excludeQueueId: t\.id \}\)/.test(loader))
  check('🔴 🔴 **계획기는 재배정하지 않는다 — 뺀 행에 쓰기가 없다**',
    !/originalPostApprovalQueue\.(update|updateMany)/.test(loader.slice(loader.indexOf('export function planPublishBatch'))))
}

console.log('\n⑭ 🔴 🔴 감사 저장 경계는 판정자를 믿지 않는다')
{
  const repo = codeOnly('src/lib/auto-ready-repo.ts')
  const rec = repo.slice(repo.indexOf('export async function recordAuditResult'), repo.indexOf('export async function runAuditRound'))
  check('🔴 🔴 **저장 경계가 지금 큐 도장의 계약 판을 선정 때 묶은 값과 대조한다**',
    /cur\.contractDigest !== row\.stampContractDigest/.test(rec))
  check('🔴 🔴 **저장 경계가 지금 큐 도장의 제목·본문 hash 를 발행 hash 와 대조한다**',
    /cur\.titleHash !== row\.publishedTitleHash \|\| cur\.bodyHash !== row\.publishedBodyHash/.test(rec))
  check('🔴 🔴 **어긋나면 판정자 값이 아니라 무결성 yes 를 기록한다**',
    /markIntegrityDefect\(tx, i\.queueId, broken, i\.now\)/.test(rec)
    && rec.indexOf('if (broken !== null)') < rec.indexOf('const data = {'))
  check('🔴 🔴 **어긋남이 있으면 반드시 그 분기로 들어간다**', /if \(broken !== null\) \{\s*await markIntegrityDefect\(tx/.test(rec))
  check('🔴 무결성 기록은 founder 가 아니다', /INTEGRITY_AUDITOR = 'system:integrity'/.test(repo))
}

console.log('\n⑮ 🔴 🔴 감사 대상 유실은 대기가 아니라 무결성 결함이다')
{
  const repo = codeOnly('src/lib/auto-ready-repo.ts')
  const round = repo.slice(repo.indexOf('export async function runAuditRound'))
  const schema = codeOnly('prisma/schema.prisma')
  const sql = codeOnly('prisma/migrations/0029_auto_ready_audit/migration.sql')
  check('🔴 🔴 **감사 회차에 noPost 대기가 없다 — 유실은 markIntegrityDefect**',
    !/bump\('noPost'\)|'noPost'/.test(repo) && /if \(post === null \|\| queue === null\) \{\s*await markIntegrityDefect\(/.test(round))
  check('🔴 🔴 **FK RESTRICT — 스키마와 0029 둘 다**',
    /queue\s+OriginalPostApprovalQueue @relation\(fields: \[queueId\], references: \[id\], onDelete: Restrict\)/.test(schema)
    && /post\s+Post\s+@relation\(fields: \[postId\], references: \[id\], onDelete: Restrict\)/.test(schema)
    && /FOREIGN KEY \("queueId"\) REFERENCES "OriginalPostApprovalQueue"\("id"\) ON DELETE RESTRICT/.test(sql)
    && /FOREIGN KEY \("postId"\) REFERENCES "Post"\("id"\) ON DELETE RESTRICT/.test(sql))
  const runnerSrc = codeOnly('scripts/original-post-auto-publish.mts')
  check('🔴 🔴 **열림 판정이 글 유실을 직접 센다 — 감사 선정과 무관하게 닫는다**',
    /const missingAutoPosts = await missingAutoPostCount\(db\)/.test(repo)
    && /return judgeOpen\(\{ enabled, evidence, confirmedDefects, missingAutoPosts \}\)/.test(repo)
    && !/createdPost: \{ is: null \}/.test(repo))
  check('🔴 🔴 **러너는 missingPost 를 로그로만 흘리지 않는다 — 회차를 실패로 끝낸다**',
    /if \(au\.kind === 'ok' && au\.missingPost\.length > 0\) \{\s*auditIntegrityOk = false/.test(runnerSrc)
    && /process\.exit\(v\.ok && auditIntegrityOk \? 0 : 1\)/.test(runnerSrc))
  check('🔴 🔴 **큐 createdPostId → Post FK RESTRICT — 스키마와 0029 둘 다**',
    /createdPost\s+Post\?\s+@relation\(fields: \[createdPostId\], references: \[id\], onDelete: Restrict\)/.test(schema)
    && /FOREIGN KEY \("createdPostId"\) REFERENCES "Post"\("id"\) ON DELETE RESTRICT/.test(sql))
  check('🔴 선정은 Post 유실 하나로 전체가 멈추지 않는다 — findUniqueOrThrow 없음 · missingPost 로 보고',
    !/\.findUniqueOrThrow\(/.test(repo) && /missingPost/.test(repo))
}

console.log('\n⑰ 🔴 🔴 도장 회차는 bounded Serializable batch — 묶음마다 열림 한 번 · 행별 적격·CAS 유지')
{
  const repo = codeOnly('src/lib/auto-ready-repo.ts')
  const round = repo.slice(repo.indexOf('export async function stampRound'), repo.indexOf('/**\n * 🔴 **발행 트랜잭션 안의 재검증.**'))
  check('🔴 🔴 **묶음 트랜잭션 안에서 열림을 한 번 판정하고 행마다 stampRowInTx**',
    /const gate = await authoritativeGate\(tx, i\.env\)\s*if \(!gate\.open\) return batch\.map/.test(round)
    && /for \(const r of batch\) got\.push\(\(await stampRowInTx\(tx, r\.id, i\.now\)\)\.kind\)/.test(round)
    && /\}, SERIALIZABLE\)/.test(round))
  check('🔴 🔴 **행별 CAS 는 그대로 — 읽은 decidedBy·updatedAt 일 때만 쓴다**',
    /id: row\.id, decidedBy: row\.decidedBy, status: 'APPROVED', createdPostId: null,\s*updatedAt: row\.updatedAt,/.test(repo))
  check('🔴 묶음 충돌은 조용히 잃지 않는다 — race 로 센다', /bump\('race', batch\.length\)/.test(round))
  check('🔴 묶음 크기는 총량 제한이 아니다 — 모든 행을 순회한다',
    /for \(let at = 0; at < rows\.length; at \+= STAMP_BATCH_SIZE\)/.test(round))
  check('🔴 🔴 **증거 지문 재사용 설계를 쓰지 않는다**', !/fingerprint|지문\(/.test(round.replace(/\/\*\*[\s\S]*?\*\//g, '')))
}

console.log('\n⑱ 🔴 🔴 공개 단계 천장 — 호출자 단계는 env 천장을 넘지 못한다')
{
  const T = new Date('2026-09-25T03:00:00Z')
  // 🔴 결정이 넣은 env 를 흉내 낸다(표식 포함) — 표식 없는 손 env 는 아래에서 따로 본다(Lane A)
  const E = (rel?: string, cap?: string): Record<string, string> => (rel === undefined && cap === undefined ? {} : markedStageEnv({
    ...(rel === undefined ? {} : { SORAN_RELEASE_STAGE: rel }), ...(cap === undefined ? {} : { SORAN_CAPACITY_STAGE: cap }),
  }))
  check('🔴 🔴 **표식 없는 손 env(release d10 · capacity d10) → 천장 d1 — 트랜잭션도 결정만 믿는다**',
    releaseStageCeiling({ SORAN_RELEASE_STAGE: 'd10', SORAN_CAPACITY_STAGE: 'd10' }, T) === 'd1'
    && boundedReleaseStage('d10', { SORAN_RELEASE_STAGE: 'd10', SORAN_CAPACITY_STAGE: 'd10' }, T) === 'd1')
  check('🔴 설정 없음 → d1', releaseStageCeiling({}, T) === 'd1')
  check('🔴 🔴 **release d10 · capacity d3 → d3 (capacity 가 천장)**', releaseStageCeiling(E('d10', 'd3'), T) === 'd3')
  check('release d5 · capacity d10 → d5', releaseStageCeiling(E('d5', 'd10'), T) === 'd5')
  check('🔴 모르는 값 → d1', releaseStageCeiling(E('d999', 'd10'), T) === 'd1')
  check('🔴 🔴 **(2026-09-30) 기간 · 시험 허가 env 는 천장을 올리지 않는다 — 단계 입력은 결정 하나**',
    releaseStageCeiling({ ...E('d1', 'd5'), SORAN_RELEASE_WINDOW_STAGE: 'd3', SORAN_RELEASE_WINDOW_FROM: '2026-09-23', SORAN_RELEASE_WINDOW_UNTIL: '2026-09-27' }, T) === 'd1'
    && releaseStageCeiling({ ...E('d1', 'd3'), SORAN_RELEASE_CANARY_STAGE: 'd3', SORAN_RELEASE_CANARY_DATE: '2026-09-25' }, T) === 'd1')
  check('🔴 🔴 **호출자 d10 · env 천장 d1 → d1**', boundedReleaseStage('d10', {}, T) === 'd1')
  check('호출자 d3 · env 천장 d10 → d3 (낮추는 것은 받는다)', boundedReleaseStage('d3', E('d10', 'd10'), T) === 'd3')
  check('🔴 호출자 값이 없거나 모르면 가장 안전한 d1', boundedReleaseStage(undefined, E('d10', 'd10'), T) === 'd1'
    && boundedReleaseStage(1e9, E('d10', 'd10'), T) === 'd1')
  const envs = [E(), E('d10', 'd3'), E('d5', 'd10'), E('d3', 'd3'), E('d10', 'd10'), E('x', 'd5')]
  check('🔴 🔴 **정본 resolveScale 이 낸 단계는 언제나 천장 이하다**',
    envs.every((e) => { const r = resolveScale(e).releaseStage; return boundedReleaseStage(r, e, T) === r }))
}

console.log('\n⑲ 🔴 🔴 예약 발행 — 최종 권한은 트랜잭션 안 슬롯 재계산 (2026-09-26 마스터 P0)')
{
  const tx = codeOnly('src/lib/original-post-publish-tx.ts')
  const runner = codeOnly('scripts/original-post-auto-publish.mts')
  const live = codeOnly('scripts/original-post-publish-live.mts')
  const sched = tx.slice(tx.indexOf("if (input.mode.kind === 'scheduled') {"), tx.indexOf('dailyCap = input.mode.dailyCap'))
  check('🔴 🔴 **scheduled — 트랜잭션 시계·트랜잭션 발행 수로 기존 judgeCatchUp 을 다시 부른다(복제 없음)**',
    /const slot = judgeCatchUp\(\{ stage, now: txNow, trigger: 'local', cron: null, publishedToday: publishedTodayInTx \}\)/.test(sched)
    && !/function dueSlots|dueCountAt\(/.test(tx))
  check('🔴 🔴 **허용은 publishedTodayInTx < min(도래 슬롯, 정본 하루 목표) 일 때만**',
    /const target = profileOf\(stage\)\.dailyTarget/.test(sched) && /const limit = Math\.min\(slot\.dueCount, target\)/.test(sched)
    && /if \(!slot\.run \|\| !\(publishedTodayInTx < limit\)\) \{/.test(sched) && /dailyCap = target/.test(sched))
  check('🔴 🔴 **발행 방식은 필수 판별 유니온 — optional boolean 게이트 없음 · top-level dailyCap 없음**',
    /mode: PublishMode\n/.test(tx) && !/mode\?:/.test(tx) && !/slotGate|useSlots|slotGated/.test(tx)
    && /\| \{ kind: 'scheduled'; releaseStage: unknown; planned: PlannedTarget; unattended: boolean \}/.test(tx) && /\| \{ kind: 'manual-live'; dailyCap: number; releaseStage\?: RuntimeStage \}/.test(tx)
    && !/^\s*dailyCap: number$/m.test(tx.slice(tx.indexOf('export type PublishTxInput'), tx.indexOf('export async function publishOriginalPostTx'))))
  check('🔴 🔴 **자동 러너는 scheduled 만 — manual-live · 숫자 상한을 넘기지 않는다**',
    /mode: \{ kind: 'scheduled', releaseStage: scale\.releaseStage, planned, unattended: TRIGGER === 'local' \|\| TRIGGER === 'schedule' \}/.test(runner) && !/manual-live/.test(runner)
    && !/publishOriginalPostTx\(prisma, \{[^}]*dailyCap/.test(runner))
  check('🔴 🔴 **슬롯 경쟁 패자(SLOT_*)는 러너가 정상 무발행 exit 0 — 그 밖은 기존처럼 실패**',
    /if \(res\.kind === 'blocked' && \(NORMAL_NO_PUBLISH_CODES as readonly string\[\]\)\.includes\(res\.code\)\) \{[\s\S]{0,300}process\.exit\(0\)/.test(runner)
    && /if \(res\.kind !== 'published'\) \{\s*await prisma\.\$disconnect\(\)\s*fail\(/.test(runner))
  const pub = codeOnly('src/lib/original-post-publish.ts')
  check('🔴 🔴 **정상 무발행 코드는 정확히 셋 — ALREADY_PUBLISHED 는 여기 없다(선택기 결함을 숨기지 않는다)**',
    /export const NORMAL_NO_PUBLISH_CODES = \['SLOT_CONSUMED', 'SLOT_CLOSED', 'TARGET_RACE_LOST'\] as const/.test(pub))
  check('🔴 🔴 **TARGET_RACE_LOST 는 대상 자신의 전환으로만 — 계획 스냅샷(이 행 · 미발행 · 발행 가능 · 같은 결정자) → 지금 발행 · updatedAt 이 계획 뒤**',
    /const plannedPublishable = p\.queueId === row\.id && p\.createdPostId === null\s*&& \(p\.status === 'APPROVED' \|\| p\.status === 'EDITED'\) && p\.decidedBy === row\.decidedBy/.test(sched)
    && /const transitionedAfterPlan = row\.createdPostId !== null && row\.status === 'PUBLISHED'\s*&& row\.updatedAt\.getTime\(\) > p\.updatedAt\.getTime\(\)/.test(sched)
    && /if \(plannedPublishable && transitionedAfterPlan && publishedTodayInTx > input\.publishedToday\) \{/.test(sched)
    && /where: \{ kind: 'post', targetId: row\.createdPostId!, createdAt: \{ gte: kstDayStart\(txNow\) \} \}/.test(sched)
    && /if \(mine > 0\) \{\s*return \{\s*kind: 'blocked', publishedTodayInTx, code: 'TARGET_RACE_LOST'/.test(sched))
  check('🔴 🔴 **러너는 선택기 스냅샷을 그대로 넘긴다 — updatedAt 없으면 발행하지 않는다**',
    /mode: \{ kind: 'scheduled', releaseStage: scale\.releaseStage, planned, unattended: TRIGGER === 'local' \|\| TRIGGER === 'schedule' \},/.test(runner)
    && /queueId: target\.id, status: target\.status, createdPostId: target\.createdPostId,\s*updatedAt: target\.updatedAt!, decidedBy: target\.decidedBy,/.test(runner)
    && /if \(target\.updatedAt === undefined\) \{\s*await prisma\.\$disconnect\(\)\s*fail\(/.test(runner)
    && /editDiff: true, updatedAt: true,/.test(codeOnly('scripts/lib/publishable-stock.mts')))
  check('🔴 manual-live 는 사람이 부르는 publish-live 만 쓴다', /mode: \{ kind: 'manual-live', dailyCap: RELEASE_DAILY_CAP \}/.test(live))
  check('🔴 🔴 **운영 호출자는 시계를 주입하지 않는다 — 두 호출 모두 인자 둘**',
    [runner, live].every((c) => { const m = c.match(/publishOriginalPostTx\(prisma, \{[\s\S]*?\}\)/); return m !== null && !/\}, \{ now/.test(m[0]) }))
  // 🔴 (2026-10-01) 두 번째 충돌 뒤엔 write 없는 다시 읽기 하나 — 소비 증거(SLOT_CONSUMED · TARGET_RACE_LOST)만 정상 무발행
  check('🔴 🔴 **직렬화 충돌은 한 번만 재시도 — 재시도도 처음부터 다시 센다 · 두 번째 충돌 뒤엔 write 없는 다시 읽기 · 소비 증거 아니면 실패**',
    (tx.match(/await publishAttempt\(prisma, input, deps, (1|2)\)/g) ?? []).length === 2
    && (tx.match(/await publishAttempt\(prisma, input, deps, 'recheck'\)/g) ?? []).length === 1
    && /if \(second\.kind !== 'conflict'\) return second\s*const recheck = await publishAttempt/.test(tx)
    && /const CONSUMED_AFTER_CONFLICT = \['SLOT_CONSUMED', 'TARGET_RACE_LOST'\] as const/.test(tx)
    && /return \{\s*kind: 'error',\s*message: `다른 발행과 두 번 연속 부딪혔고/.test(tx))
  check('🔴 슬롯 소비 기록 시각도 트랜잭션 시계 — ActivityLog.createdAt = txNow', /publishedAt: txNow,[\s\S]{0,400}createdAt: txNow,/.test(tx))
}

console.log('\n⑯ 🔴 rule 감사자는 "무결성·안전 감사" 다 — 의미 감사라고 부르지 않는다')
{
  const judge = codeOnly('scripts/lib/auto-ready-rule-judge.mts')
  const runner = codeOnly('scripts/auto-ready-audit.mts')
  check('🔴 🔴 **모델·프롬프트 이름이 integrity-safety**',
    /RULE_JUDGE_MODEL = 'rule:integrity-safety-audit'/.test(judge) && /RULE_JUDGE_PROMPT_VERSION = 'integrity-safety-v1'/.test(judge))
  const claims = (t: string): boolean => t.split('\n').some((l) => /독립 (의미 )?감사/.test(l) && !/아니다|별도|나중|못/.test(l))
  // 🔴 러너는 이제 의미 감사를 실제로 돈다(2026-09-27) — 주장 금지는 규칙 감사자와 판정 조각에만 건다
  check('🔴 🔴 **규칙 감사자·판정 조각이 "독립 (의미) 감사" 를 한다고 주장하지 않는다**', !claims(judge) && !claims(codeOnly('src/lib/auto-ready-v2.ts')))
  check('🔴 🔴 **러너는 의미 감사를 실제로 부른다 — 규칙 감사만으로 기록하지 않는다**',
    /runCombinedAuditRound\(/.test(runner) && /makeAuditContextLoader\(/.test(runner) && !/runAuditRound\(/.test(runner))
}

console.log('\n⑰ 🔴 🔴 도장 트랜잭션 P2028 — 트랜잭션을 잃은 두 문구만 · 최대 1회 새로 시작 (2026-09-30 운영 반례)')
{
  /**
   * 🔴 문구는 지어내지 않았다 — 운영 로그(09-30 09:40 · stampRowInTx)의 `meta.error` 원문과,
   *    격리 DB 에서 실제 엔진이 낸 `meta.error` 원문(만료 query/commit · commit 뒤 · rollback 뒤)을 그대로 옮겼다.
   */
  const NOT_FOUND = "Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting."
  const EXPIRED_Q = 'Transaction already closed: A query cannot be executed on an expired transaction. The timeout for this transaction was 20000 ms, however 20041 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.'
  const EXPIRED_C = 'Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 20000 ms, however 20007 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.'
  const COMMITTED = 'Transaction already closed: A query cannot be executed on a committed transaction.'
  const ROLLED = 'Transaction already closed: A query cannot be executed on a transaction that was rolled back.'
  const kre = (code: string, meta?: Record<string, unknown>, message = `Transaction API error: ${String(meta?.error ?? '')}`) =>
    new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '6.19.3', meta })
  const p2028 = (error: string) => kre('P2028', { modelName: 'OriginalPostApprovalQueue', error })
  check('🔴 🔴 **운영 로그 원문 "Transaction not found…" → transient**', isTransientTxLost(p2028(NOT_FOUND)))
  check('🔴 만료 — query · commit (엔진 원문) → transient', isTransientTxLost(p2028(EXPIRED_Q)) && isTransientTxLost(kre('P2028', { error: EXPIRED_C })))
  const nonTarget: [string, unknown][] = [
    ['commit 된 트랜잭션 사용(코드 결함)', p2028(COMMITTED)],
    ['rollback 된 트랜잭션 사용', p2028(ROLLED)],
    ['시작 대기 초과', p2028('Unable to start a transaction in the given time.')],
    ['중첩 시작', p2028('Attempted to start a transaction inside of a transaction.')],
    ['알 수 없는 응답', p2028('Transaction already closed: Unexpected response: x')],
    ['meta 없음(문구는 message 에만)', kre('P2028', undefined, `Transaction API error: ${NOT_FOUND}`)],
    ['meta.error 가 문자열이 아님', kre('P2028', { error: { NOT_FOUND } })],
    ['문구가 앞에 오지 않음', p2028(`wrapped: ${NOT_FOUND}`)],
    ['P2034 에 같은 문구', kre('P2034', { error: NOT_FOUND })],
    ['P2002', kre('P2002', { target: ['x'] })],
    ['Prisma 오류가 아닌 Error', new Error(NOT_FOUND)],
  ]
  const wrongly = nonTarget.filter(([, e]) => isTransientTxLost(e)).map(([n]) => n)
  check(`🔴 🔴 **P2028 전체가 아니다 — 비대상 ${nonTarget.length}종은 transient 아님**`, wrongly.length === 0, wrongly.join(' · '))

  const attempt = async (errs: unknown[]): Promise<{ calls: number; ok: boolean; thrown: unknown }> => {
    let calls = 0
    try {
      await withStampTxRetry(async () => { calls += 1; const e = errs[calls - 1]; if (e !== undefined) throw e; return 'ok' })
      return { calls, ok: true, thrown: null }
    } catch (e) { return { calls, ok: false, thrown: e } }
  }
  const once = await attempt([p2028(NOT_FOUND)])
  check('🔴 🔴 **transient 1회 → 트랜잭션 전체를 한 번 새로 열어 성공 (시도 2)**', once.ok && once.calls === 2, JSON.stringify(once))
  const twice = await attempt([p2028(NOT_FOUND), p2028(EXPIRED_Q), p2028(NOT_FOUND)])
  check('🔴 🔴 **두 번째도 잃으면 던진다 — 시도는 정확히 2 (무한·3회 없음)**',
    !twice.ok && twice.calls === 2 && isTransientTxLost(twice.thrown), JSON.stringify({ calls: twice.calls, ok: twice.ok }))
  const other = await attempt([p2028(COMMITTED)])
  check('🔴 🔴 **비대상 P2028 → 재시도 없이 즉시 던진다 (시도 1)**', !other.ok && other.calls === 1 && other.thrown instanceof Prisma.PrismaClientKnownRequestError)
  for (const code of ['P2034', 'P2002']) {
    const r = await attempt([kre(code, { error: 'x' })])
    check(`🔴 ${code} 는 retry 가 건드리지 않는다 — 시도 1 · 그대로 부르는 쪽(race)으로`, !r.ok && r.calls === 1 && (r.thrown as { code?: string }).code === code)
  }
  const clean = await attempt([])
  check('정상 → 시도 1', clean.ok && clean.calls === 1)
  check('🔴 최대 시도 상수는 2', STAMP_TX_MAX_ATTEMPTS === 2)

  const repo = codeOnly('src/lib/auto-ready-repo.ts')
  check('🔴 🔴 **retry 는 도장 트랜잭션 둘(stampAutoReady · stampRound)에만 — 다른 트랜잭션은 그대로**',
    (repo.match(/withStampTxRetry\(\(\) => prisma\.\$transaction\(/g) ?? []).length === 2
    && /export async function stampAutoReady\([\s\S]*?return await withStampTxRetry\(\(\) => prisma\.\$transaction\([\s\S]*?\}, SERIALIZABLE\)\)\s*\} catch \(e\) \{\s*if \(isConflict\(e\)\) return \{ kind: 'race'/.test(repo)
    && /const outs = await withStampTxRetry\(\(\) => prisma\.\$transaction\([\s\S]*?\}, SERIALIZABLE\)\)\s*for \(const k of outs\) bump\(k\)\s*\} catch \(e\) \{\s*if \(!isConflict\(e\)\) throw e/.test(repo))
  check('🔴 🔴 **P2034/P2002 race 계약은 그대로**',
    /const isConflict = \(e: unknown\): boolean =>\s*e instanceof Prisma\.PrismaClientKnownRequestError && \(e\.code === 'P2034' \|\| e\.code === 'P2002'\)/.test(repo))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 순수 검사다 — 실행 경로(도장→selector→트랜잭션→감사→중지)는 auto-ready:db-check 가 본다\n')
if (fail > 0) process.exit(1)
