#!/usr/bin/env tsx
/**
 * 자동 READY 계약 **행동 검사** — 🔴 DB 0 · 네트워크 0 · LLM 0
 *
 * 🔴 **이 검사가 잠그는 것은 "자동 READY 가 열렸다" 가 아니다.**
 *    사람 도장을 기계가 찍지 못한다는 것, 그리고 **못 잰 것을 통과로 읽지 않는다**는 것이다.
 */
import {
  HUMAN_DECIDER, AUTO_DECIDER, AUTO_READY_ENV, AUTO_READY_BLOCKERS,
  sampleOf, judgeAutoReadyOpen, judgeRow, auditPicks, judgeAuditOutcome,
} from '../src/lib/auto-ready'
import { selectAutoTargets, autoReadyAccepted, MACHINE_REVIEWED_BY, AUTO_GATE_VERDICT, type AutoRow } from '../src/lib/original-post-auto-publish'
import { AUTO_READY_CONTRACT } from '../src/lib/supply-schedule-contract'
import {
  MACHINE_PROFILE, MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX,
} from '../src/lib/micro-seed-supply-autofill'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else {
    fail += 1; console.log(`  🔴 FAIL ${n}${d === '' ? '' : ` — ${d}`}`)
  }
}
console.log('\n══ 자동 READY 계약 검사 (🔴 DB 0 · 네트워크 0 · LLM 0) ══\n')

console.log('① 🔴 🔴 사람 도장을 기계가 찍지 못한다')
/** 🔴 상수 타입이 좁아 `===` 가 컴파일 경고를 낸다 — 값을 문자열로 놓고 비교한다 */
const asText = (v: string): string => v
check('🔴 🔴 **사람 값과 자동 값이 다르다**',
  asText(HUMAN_DECIDER) !== asText(AUTO_DECIDER) && asText(AUTO_DECIDER) === 'auto-ready:v1')
check('🔴 🔴 **발행 선택기의 사람 도장은 `founder` 하나다**',
  asText(MACHINE_REVIEWED_BY) === asText(HUMAN_DECIDER))
check('🔴 🔴 **게이트가 닫혀 있으면 자동 값은 인정되지 않는다**',
  autoReadyAccepted(AUTO_DECIDER, false) === false)
check('🔴 게이트가 열려도 `founder` 는 이 함수가 인정하지 않는다 — 사람 경로가 따로 본다',
  autoReadyAccepted(HUMAN_DECIDER, true) === false)
check('🔴 게이트가 열리면 자동 값은 인정된다', autoReadyAccepted(AUTO_DECIDER, true) === true)

console.log('\n② 🔴 🔴 실제 발행 선택기까지 — 우회가 없다')
{
  const row = (decidedBy: string): AutoRow => ({
    id: `q-${decidedBy}`, status: 'APPROVED', createdPostId: null, gateVerdict: AUTO_GATE_VERDICT,
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, matchedPersonaId: null,
    sourceSite: `${MACHINE_SITE_PREFIX}navercafe`, title: '무릎이 시큰거려요', body: '계단이 무섭습니다.',
    gateResults: { autoDraft: {
      provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
      draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
      voice: { personaCode: 'P03', comments: 3, bundleDigest: 'b', sourceDigest: 's' } } },
    decidedBy, decidedAt: new Date(), createdAt: new Date(),
  })
  const safe = (t: string, b: string): string => safetyFilter({ title: t, body: b }).verdict
  const sel = (decidedBy: string, open: boolean) =>
    selectAutoTargets([row(decidedBy)], safe, { autoReadyOpen: open })
  check('🔴 🔴 **미검토 행은 닫혀 있든 열려 있든 막힌다**',
    sel('machine:auto-draft-v5', false).rejected[0]?.code === 'HUMAN_REVIEW_REQUIRED'
    && sel('machine:auto-draft-v5', true).rejected[0]?.code === 'HUMAN_REVIEW_REQUIRED')
  check('🔴 🔴 **자동 도장 + 게이트 닫힘 → 막힌다**',
    sel(AUTO_DECIDER, false).rejected[0]?.code === 'HUMAN_REVIEW_REQUIRED')
  check('🔴 🔴 **자동 도장 + 게이트 열림 → 통과한다**',
    sel(AUTO_DECIDER, true).targets.length === 1)
  check('🔴 사람 도장은 게이트와 무관하게 통과한다 — 기존 동작 불변',
    sel(HUMAN_DECIDER, false).targets.length === 1 && sel(HUMAN_DECIDER, true).targets.length === 1)
  check('🔴 🔴 **인자를 안 넘기면 닫힌 것이다 (fail-closed)**',
    selectAutoTargets([row(AUTO_DECIDER)], safe).rejected[0]?.code === 'HUMAN_REVIEW_REQUIRED')
}

console.log('\n③ 🔴 🔴 표본 — 분모에 폐기를 포함한다')
{
  const r = (decidedBy: string, edit = false, reject = false) =>
    ({ decidedBy, hasEditDiff: edit, hasDeclineReason: reject })
  const s = sampleOf([
    r(HUMAN_DECIDER), r(HUMAN_DECIDER), r(HUMAN_DECIDER),
    r(HUMAN_DECIDER, true), r(HUMAN_DECIDER, false, true),
    r(AUTO_DECIDER), r('machine:auto-draft-v5'),
  ])
  check('🔴 🔴 **사람이 결정한 것만 센다 — 자동·미검토는 표본이 아니다**', s.total === 5, String(s.total))
  check('🔴 🔴 **분모에 폐기가 들어간다 — 3/5 이지 3/4 가 아니다**',
    s.ready === 3 && s.edited === 1 && s.rejected === 1 && s.noEditAccuracy === 3 / 5,
    JSON.stringify(s))
  check('🔴 🔴 **중대 결함은 `null` — 0 이 아니다**',
    s.hardDefects === null && s.hardDefectsNote.includes('unmeasured'))
  check('🔴 표본 0 이면 비율은 `null` — 0% 가 아니다', sampleOf([]).noEditAccuracy === null)
}

console.log('\n④ 🔴 🔴 열림 판정 — 못 잰 것을 통과로 읽지 않는다')
{
  const base = { enabled: true, reviewSampleMin: AUTO_READY_CONTRACT.reviewSampleMin,
    noEditAccuracyMin: AUTO_READY_CONTRACT.noEditAccuracyMin, hardDefectMax: AUTO_READY_CONTRACT.hardDefectMax }
  const s = (total: number, acc: number | null, hard: number | null) => ({
    total, ready: 0, edited: 0, rejected: 0, noEditAccuracy: acc,
    hardDefects: hard, hardDefectsNote: 'x' })
  check('🔴 스위치가 꺼져 있으면 닫힘',
    judgeAutoReadyOpen({ ...base, enabled: false, sample: s(100, 1, 0) }).open === false)
  check('🔴 🔴 **표본이 모자라면 닫힘**', (() => {
    const v = judgeAutoReadyOpen({ ...base, sample: s(17, 1, 0) })
    return !v.open && v.reason.includes('17/30')
  })())
  check('🔴 🔴 **정확도가 기준 미만이면 닫힘**',
    judgeAutoReadyOpen({ ...base, sample: s(30, 0.82, 0) }).open === false)
  check('🔴 🔴 **중대 결함을 재지 못했으면 닫힘 — 이것이 지금 상태다**', (() => {
    const v = judgeAutoReadyOpen({ ...base, sample: s(30, 1, null) })
    return !v.open && v.reason.includes('재지 못했다')
  })())
  check('🔴 중대 결함이 있으면 닫힘',
    judgeAutoReadyOpen({ ...base, sample: s(30, 1, 1) }).open === false)
  check('🔴 넷을 다 만족해야 열린다',
    judgeAutoReadyOpen({ ...base, sample: s(30, 0.95, 0) }).open === true)
}

console.log('\n⑤ 🔴 🔴 행 판정 — 회귀 사례 네 가지')
{
  const ok = { gateVerdict: 'PASS', warnings: [] as string[], sourceCapturedKnown: true,
    title: '김치 담가 드시나요', body: '주변에 물어보면 반반이더라고요. 다들 어떻게 드시나요?' }
  check('🔴 경고 없는 적격 후보는 자동 대상이다', judgeRow(ok).auto === true, judgeRow(ok).reasons.join(','))
  check('🔴 🔴 **이미지 의존 (P08 실측) — 자동 금지**', (() => {
    const v = judgeRow({ ...ok, title: '이 옷 어떨까요', body: '이런 가죽쟈켓 어떤가요?' })
    return !v.auto && v.reasons.some((r) => r.startsWith('imageDependent'))
  })())
  check('🔴 🔴 **시점 이동 (P03 실측) — 자동 금지**', (() => {
    const v = judgeRow({ ...ok, body: '오늘도 10시 전에 들어갔는데 아직도 안 나오고 있어요' })
    return !v.auto && v.reasons.some((r) => r.startsWith('timeDrift'))
  })())
  check('🔴 🔴 **근거 없는 단정 — 자동 금지**', (() => {
    const v = judgeRow({ ...ok, body: '이건 확실히 그런 겁니다.' })
    return !v.auto && v.reasons.some((r) => r.startsWith('unsourcedClaim'))
  })())
  check('🔴 🔴 **후속 뉴스가 있을 소재 (P01 심수봉 실측) — 자동 금지**', (() => {
    const v = judgeRow({ ...ok, body: '공개적으로 저격했나 봐요.' })
    return !v.auto && v.reasons.some((r) => r.startsWith('followUpLikely'))
  })())
  check('🔴 🔴 **원천 수집 시각을 모르면 자동 금지**',
    judgeRow({ ...ok, sourceCapturedKnown: false }).auto === false)
  check('🔴 gate 가 PASS 가 아니면 자동 금지', judgeRow({ ...ok, gateVerdict: 'HOLD' }).auto === false)
  check('🔴 경고가 하나라도 있으면 자동 금지', judgeRow({ ...ok, warnings: ['QUESTION_OVERUSE'] }).auto === false)
  check('🔴 막는 이유를 전부 적는다 — 하나만 적고 끝내지 않는다', (() => {
    const v = judgeRow({ gateVerdict: 'HOLD', warnings: ['X'], sourceCapturedKnown: false,
      title: '이 옷 어떨까요', body: '오늘도 이런 가죽쟈켓 어떤가요?' })
    return v.reasons.length >= 4
  })())
}

console.log('\n⑥ 🔴 🔴 사후 감사 20% 와 감속')
{
  const ids = Array.from({ length: 10 }, (_, i) => `q${i}`)
  const picked = auditPicks({ autoDecided: ids, ratio: AUTO_READY_CONTRACT.sampledAuditRatio, seed: 3 })
  check('🔴 🔴 **20% 를 고른다**', picked.length === 2, String(picked.length))
  check('🔴 🔴 **같은 입력이면 같은 답 — 무작위가 아니다**',
    JSON.stringify(auditPicks({ autoDecided: ids, ratio: 0.2, seed: 3 })) === JSON.stringify(picked))
  check('🔴 자동 판정이 0 건이면 감사도 0 건',
    auditPicks({ autoDecided: [], ratio: 0.2, seed: 1 }).length === 0)
  check('🔴 🔴 **감사에서 결함이 나오면 비율을 줄이지 않고 닫는다**', (() => {
    const v = judgeAuditOutcome({ audited: 2, defectsFound: 1 })
    return v.keepOpen === false && v.reason.includes('자동을 닫는다')
  })())
  check('🔴 🔴 **감사 표본이 0 이면 열어 둔 채로 두지 않는다**',
    judgeAuditOutcome({ audited: 0, defectsFound: 0 }).keepOpen === false)
  check('🔴 결함 0 이면 유지', judgeAuditOutcome({ audited: 2, defectsFound: 0 }).keepOpen === true)
}

console.log('\n⑦ 🔴 🔴 계약 값과 스위치')
check('🔴 계약 값은 `supply-schedule-contract` 하나가 정한다',
  AUTO_READY_CONTRACT.reviewSampleMin === 30 && AUTO_READY_CONTRACT.noEditAccuracyMin === 0.9
  && AUTO_READY_CONTRACT.hardDefectMax === 0 && AUTO_READY_CONTRACT.sampledAuditRatio === 0.2)
check('🔴 스위치 이름이 정해져 있다', AUTO_READY_ENV === 'SORAN_AUTO_READY_ENABLED')
check('🔴 막는 사유가 값으로 적혀 있다 — 코드가 읽는다',
  Object.keys(AUTO_READY_BLOCKERS).length === 4)

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · write 0\n')
if (fail > 0) process.exit(1)
