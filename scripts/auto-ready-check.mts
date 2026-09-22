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
  planAutoReadyWrite, recheckBeforePublish, bodyVersionOf, hardDefectOf, HARD_DEFECT_KEY,
  planRun, readAutoReadyStamp, isEditRecord, type StampCandidate,
  judgeAutoInTx, judgeAuditGate, auditStateOf, combineGates, readAuditRecord, AUDIT_RECORD_KEY,
  casMergeEditDiff, mergeJsonField, AUTO_READY_RECORD_KEY, markAuditPicked, recordAuditVerdict,
  type ReviewOutcome,
} from '../src/lib/auto-ready'
import { selectAutoTargets, autoReadyAccepted, MACHINE_REVIEWED_BY, AUTO_GATE_VERDICT, type AutoRow } from '../src/lib/original-post-auto-publish'
import { AUTO_READY_CONTRACT } from '../src/lib/supply-schedule-contract'
import { reviewPatchOf, REVIEW_HARD_DEFECT_KEY } from '../src/lib/original-post-machine-review'
import {
  MACHINE_PROFILE, MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX,
} from '../src/lib/micro-seed-supply-autofill'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { readFileSync } from 'node:fs'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'

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

console.log('\n③ 🔴 🔴 표본 — 무경고 적격 · 사람 결정 완료분만')
{
  const r = (decidedBy: string, o: Partial<ReviewOutcome> = {}): ReviewOutcome =>
    ({ decidedBy, hasEditDiff: false, hasDeclineReason: false, eligible: true, ...o })
  const s = sampleOf([
    r(HUMAN_DECIDER), r(HUMAN_DECIDER), r(HUMAN_DECIDER),
    r(HUMAN_DECIDER, { hasEditDiff: true, hardDefect: false }),
    r(HUMAN_DECIDER, { hasDeclineReason: true, hardDefect: false }),
    r(AUTO_DECIDER), r('machine:auto-draft-v5'),
    r(HUMAN_DECIDER, { eligible: false }),
  ])
  check('🔴 🔴 **사람이 결정한 것만 센다 — 자동·미검토는 표본이 아니다**', s.total === 5, String(s.total))
  check('🔴 🔴 **경고가 있던 행은 표본이 아니다 — 자동이 손대지 않을 종류다**',
    s.total === 5, String(s.total))
  check('🔴 🔴 **분모에 폐기가 들어간다 — 3/5 이지 3/4 가 아니다**',
    s.ready === 3 && s.edited === 1 && s.rejected === 1 && s.noEditAccuracy === 3 / 5,
    JSON.stringify(s))
  check('🔴 🔴 **표식이 전부 있으면 중대 결함은 수로 나온다**',
    s.hardDefects === 0 && !s.hardDefectsNote.includes('unmeasured'), JSON.stringify(s))
  check('🔴 🔴 **표식이 하나라도 없으면 `null` — 0 으로 치지 않는다**', (() => {
    const v = sampleOf([r(HUMAN_DECIDER), r(HUMAN_DECIDER, { hasEditDiff: true })])
    return v.hardDefects === null && v.hardDefectsNote.includes('unmeasured')
  })())
  check('🔴 중대 결함이 표시되면 센다',
    sampleOf([r(HUMAN_DECIDER, { hasEditDiff: true, hardDefect: true })]).hardDefects === 1)
  check('🔴 표본 0 이면 비율은 `null` — 0% 가 아니다', sampleOf([]).noEditAccuracy === null)
  check('🔴 🔴 **수정·폐기가 하나도 없으면 중대 결함 0 이다 — 잴 것이 없다**',
    sampleOf([r(HUMAN_DECIDER)]).hardDefects === 0)
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
  check('🔴 🔴 **N=7 — 기대 2건. 예전 구현은 1건만 뽑았다 (회귀)**', (() => {
    const v = auditPicks({ autoDecided: Array.from({ length: 7 }, (_, i) => `q${i}`), ratio: 0.2, seed: 3 })
    return v.length === 2 && new Set(v).size === 2
  })())
  check('🔴 🔴 **N=21 — 기대 5건. 예전 구현은 3건만 뽑았다 (회귀)**', (() => {
    const v = auditPicks({ autoDecided: Array.from({ length: 21 }, (_, i) => `q${i}`), ratio: 0.2, seed: 3 })
    return v.length === 5 && new Set(v).size === 5
  })())
  check('🔴 🔴 **모든 N 에서 정확히 ceil(N×0.2) 건 · 중복 없음**', (() => {
    for (let n = 1; n <= 120; n += 1) {
      const ids = Array.from({ length: n }, (_, i) => `q${i}`)
      const v = auditPicks({ autoDecided: ids, ratio: 0.2, seed: 7 })
      if (v.length !== Math.ceil(n * 0.2)) return false
      if (new Set(v).size !== v.length) return false
      if (v.some((id) => !ids.includes(id))) return false
    }
    return true
  })())
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

console.log('\n⑧ 🔴 🔴 **연결 검사 — 후보 → 자동 READY 기록 → 발행 선택 → 20% 감사**')
{
  // 해시는 부르는 쪽이 넘긴다. 검사에서는 결정적인 가짜 하나로 충분하다.
  const sha256 = (t: string) => {
    let h = 2166136261 >>> 0
    for (const ch of t) h = (Math.imul(h ^ ch.charCodeAt(0), 16777619)) >>> 0
    return h.toString(16).padStart(8, '0').repeat(8)
  }
  const cand = (i: number, body: string) => ({
    id: `q${i}`, gateVerdict: 'PASS', warnings: [] as string[], sourceCapturedKnown: true,
    title: `김치 이야기 ${i}`, body,
  })
  const good = '주변에 물어보면 반반이더라고요. 다들 어떻게 드시나요?'
  const bad = '이런 가죽쟈켓 어떤가요?'   // P08 실측 — 이미지 의존

  const sample = { total: 30, ready: 28, edited: 2, rejected: 0, noEditAccuracy: 28 / 30,
    hardDefects: 0, hardDefectsNote: 'ok' }
  const openOf = (o: Partial<Parameters<typeof judgeAutoReadyOpen>[0]>) => judgeAutoReadyOpen({
    enabled: true, reviewSampleMin: AUTO_READY_CONTRACT.reviewSampleMin,
    noEditAccuracyMin: AUTO_READY_CONTRACT.noEditAccuracyMin,
    hardDefectMax: AUTO_READY_CONTRACT.hardDefectMax, sample, ...o })

  // ── 정상 경로: 후보 10건 (9 적격 + 1 이미지 의존)
  const now = new Date('2026-09-22T19:00:00+09:00')
  const rows = [...Array.from({ length: 9 }, (_, i) => cand(i, good)), cand(9, bad)]
  const open = openOf({})
  const plans = rows.map((r) => ({ row: r, plan: planAutoReadyWrite({ row: r, open, now, sha256 }) }))
  const stamped = plans.filter((p) => p.plan.write)
  const toHuman = plans.filter((p) => !p.plan.write)

  check('🔴 🔴 **게이트가 열리면 적격 후보에 자동 도장이 찍힌다**', stamped.length === 9, String(stamped.length))
  check('🔴 🔴 **`founder` 로 위장하지 않는다 — 결정 주체가 자동으로 남는다**',
    String(AUTO_DECIDER) !== String(HUMAN_DECIDER)
    && stamped.every((p) => p.plan.write && String(p.plan.stamp.decidedBy) !== String(HUMAN_DECIDER)
      && p.plan.stamp.decidedBy === AUTO_DECIDER))
  check('🔴 🔴 **그때 본 본문의 판을 함께 남긴다**',
    stamped.every((p) => p.plan.write && p.plan.stamp.bodyVersion.length === 16))
  check('🔴 🔴 **차단된 후보는 버리지 않고 사람 묶음으로 간다**',
    toHuman.length === 1 && toHuman[0]?.plan.write === false
    && (toHuman[0]?.plan as { reasons: string[] }).reasons.some((r) => r.startsWith('imageDependent')))

  // ── 발행 선택: 자동 도장 행만 통과한다
  const safe = (t: string, b: string): string => safetyFilter({ title: t, body: b }).verdict
  const asRow = (id: string, decidedBy: string): AutoRow => ({
    id, status: 'APPROVED', createdPostId: null, gateVerdict: AUTO_GATE_VERDICT,
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, matchedPersonaId: null,
    sourceSite: `${MACHINE_SITE_PREFIX}navercafe`, title: '무릎이 시큰거려요', body: '계단이 무섭습니다.',
    gateResults: { autoDraft: {
      provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
      draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
      voice: { personaCode: 'P03', comments: 3, bundleDigest: 'b', sourceDigest: 's' } } },
    decidedBy, decidedAt: now, createdAt: now,
  })
  const picked = selectAutoTargets(stamped.map((p) => asRow(p.row.id, AUTO_DECIDER)), safe,
    { autoReadyOpen: open.open })
  check('🔴 🔴 **자동 도장 9건이 발행 후보로 선택된다**', picked.targets.length === 9,
    String(picked.targets.length))

  // ── 발행 직전 재확인
  const first = stamped[0]
  const v0 = first?.plan.write === true ? first.plan.stamp.bodyVersion : ''
  check('🔴 본문이 그대로면 통과한다',
    recheckBeforePublish({ stampedBodyVersion: v0, current: rows[0], open: true, row: rows[0], sha256 }).ok)
  check('🔴 🔴 **도장 이후 본문이 바뀌면 자동으로 나가지 않는다**', (() => {
    const changed = { ...rows[0], body: `${good} 한 줄 더 붙였어요.` }
    const v = recheckBeforePublish({ stampedBodyVersion: v0, current: changed, open: true,
      row: changed, sha256 })
    return !v.ok && v.reason.includes('본문이 바뀌었다')
  })())
  check('🔴 🔴 **바뀐 본문이 이번엔 부적격이면 그 이유로도 막힌다**', (() => {
    const changed = { ...rows[0], body: bad }
    const v = recheckBeforePublish({ stampedBodyVersion: bodyVersionOf(changed, sha256),
      current: changed, open: true, row: changed, sha256 })
    return !v.ok && v.reason.includes('imageDependent')
  })())

  // ── 20% 감사
  const audit = auditPicks({ autoDecided: picked.targets.map((t) => t.id),
    ratio: AUTO_READY_CONTRACT.sampledAuditRatio, seed: 20260922 })
  check('🔴 🔴 **자동 발행 9건 중 2건(ceil(9×0.2))을 감사한다**',
    audit.length === 2 && new Set(audit).size === 2, String(audit.length))
  check('🔴 🔴 **감사에서 결함이 나오면 다음 회차는 닫힌다**',
    judgeAuditOutcome({ audited: audit.length, defectsFound: 1 }).keepOpen === false)

  // ── 닫히는 네 경우가 **연결 전체**를 막는지
  const closes = (o: Partial<Parameters<typeof judgeAutoReadyOpen>[0]>) => {
    const g = openOf(o)
    const p = rows.map((r) => planAutoReadyWrite({ row: r, open: g, now, sha256 }))
    const sel = selectAutoTargets(rows.map((r) => asRow(r.id, AUTO_DECIDER)), safe,
      { autoReadyOpen: g.open })
    return !g.open && p.every((x) => !x.write) && sel.targets.length === 0
      && sel.rejected.every((x) => x.code === 'HUMAN_REVIEW_REQUIRED')
  }
  check('🔴 🔴 **스위치 OFF → 도장 0 · 발행 0**', closes({ enabled: false }))
  check('🔴 🔴 **표본 미달 → 도장 0 · 발행 0**',
    closes({ sample: { ...sample, total: 17, noEditAccuracy: 14 / 17 } }))
  check('🔴 🔴 **중대 결함 미측정 → 도장 0 · 발행 0 (0 으로 치지 않는다)**',
    closes({ sample: { ...sample, hardDefects: null } }))
  check('🔴 🔴 **무수정률 미달 → 도장 0 · 발행 0**',
    closes({ sample: { ...sample, noEditAccuracy: 0.82 } }))
}

console.log('\n⑨ 🔴 🔴 **중대 결함 기록 경로 — 재는 자리가 실제로 있다**')
{
  const draft = { draftTitle: '제목', draftBody: '본문입니다.' }
  const edit = { title: '제목', body: '고친 본문입니다.', note: '시점 중립화' }
  const gate = () => ({ ok: true, reason: 'PASS' })

  const yes = reviewPatchOf({ action: { decision: 'edit', edit, gate, hardDefect: true }, ...draft })
  const no = reviewPatchOf({ action: { decision: 'edit', edit, gate, hardDefect: false }, ...draft })
  const none = reviewPatchOf({ action: { decision: 'edit', edit, gate }, ...draft })
  check('🔴 🔴 **수정 결정이 중대 결함 표식을 남긴다**', hardDefectOf(yes.editDiff) === true)
  check('🔴 아니오도 값으로 남는다 — 빈칸과 구분된다', hardDefectOf(no.editDiff) === false)
  check('🔴 🔴 **적지 않으면 빈칸이다 — `false` 로 둔갑하지 않는다**',
    hardDefectOf(none.editDiff) === undefined)

  const rej = reviewPatchOf({ action: { decision: 'reject', declineReason: 'TOPIC_UNFIT', hardDefect: true }, ...draft })
  check('🔴 🔴 **폐기 결정도 같은 칸에 남긴다**',
    hardDefectOf(rej.editDiff) === true && rej.declineReason === 'TOPIC_UNFIT')
  check('🔴 승인(ready)은 표식을 쓰지 않는다 — 고칠 것이 없었다',
    reviewPatchOf({ action: { decision: 'ready' }, ...draft }).editDiff === undefined)
  check('🔴 표식을 넣어도 고친 내역은 그대로 남는다', (() => {
    const d = yes.editDiff as Record<string, unknown>
    return d.bodyChanged === true && d.note === '시점 중립화' && d.bodyCharsBefore === draft.draftBody.length
  })())

  // 🔴 읽는 쪽과 쓰는 쪽이 같은 열쇠를 본다 — 문자열이 어긋나면 영원히 미측정이다
  check('🔴 🔴 **쓰는 열쇠와 읽는 열쇠가 같다**', REVIEW_HARD_DEFECT_KEY === HARD_DEFECT_KEY)

  // 🔴 기록 → 표본 → 게이트가 한 줄로 이어지는가
  const outcome = (patch: { editDiff?: unknown }): ReviewOutcome => ({
    decidedBy: HUMAN_DECIDER, hasEditDiff: true, hasDeclineReason: false,
    eligible: true, hardDefect: hardDefectOf(patch.editDiff),
  })
  check('🔴 🔴 **기록한 값이 표본까지 이어진다**',
    sampleOf([outcome(no)]).hardDefects === 0 && sampleOf([outcome(yes)]).hardDefects === 1)
  check('🔴 🔴 **기록하지 않으면 표본이 미측정이고 게이트가 닫힌다**', (() => {
    const smp = sampleOf([outcome(none)])
    if (smp.hardDefects !== null) return false
    return judgeAutoReadyOpen({ enabled: true, reviewSampleMin: 1, noEditAccuracyMin: 0,
      hardDefectMax: 0, sample: smp }).open === false
  })())
}

console.log('\n⑩ 🔴 🔴 **회차 계획 — 러너가 그대로 집행하는 값**')
{
  const sha256 = (t: string) => {
    let h = 2166136261 >>> 0
    for (const ch of t) h = (Math.imul(h ^ ch.charCodeAt(0), 16777619)) >>> 0
    return h.toString(16).padStart(8, '0').repeat(8)
  }
  const MACHINE = 'machine:auto-draft-v5'
  const now = new Date('2026-09-22T12:00:00Z')
  const good = '주변에 물어보면 반반이더라고요. 다들 어떻게 드시나요?'
  const cand = (o: Partial<StampCandidate> = {}): StampCandidate => ({
    id: 'q1', decidedBy: MACHINE, updatedAt: new Date('2026-09-22T11:00:00Z'),
    status: 'APPROVED', createdPostId: null,
    gateVerdict: 'PASS', warnings: [], sourceCapturedKnown: true,
    title: '김치 이야기', body: good, ...o,
  })
  const OPEN = { open: true, reason: '네 조건 통과' }
  const SHUT = { open: false, reason: '표본 15/30 — 15건 부족' }
  const run = (c: StampCandidate[], open = OPEN) =>
    planRun({ candidates: c, open, now, machineDecidedBy: MACHINE, sha256 })

  check('🔴 🔴 **게이트가 닫히면 쓸 것이 0 이다 — 부르는 쪽이 잊어도 쓰지 않는다**',
    run([cand()], SHUT).writes.length === 0)
  check('🔴 닫혔을 때 후보는 버려지지 않고 사람 검토로 간다',
    run([cand()], SHUT).toHumanReview.length === 1)
  check('🔴 🔴 **`founder` 도장을 덮어쓰지 않는다**',
    run([cand({ decidedBy: HUMAN_DECIDER })]).writes.length === 0)
  check('🔴 🔴 **자동 도장을 두 번 찍지 않는다**',
    run([cand({ decidedBy: AUTO_DECIDER })]).writes.length === 0)
  check('🔴 🔴 **이미 발행된 행은 건드리지 않는다**',
    run([cand({ createdPostId: 'post-1' })]).writes.length === 0)

  const w = run([cand()]).writes[0]
  check('🔴 🔴 **결정 주체는 자동이다 — 사람 값이 아니다**',
    w?.data.decidedBy === AUTO_DECIDER && String(w?.data.decidedBy) !== String(HUMAN_DECIDER))
  check('🔴 🔴 **조건부 UPDATE 가 읽은 순간의 `updatedAt` 을 조건으로 건다**', (() => {
    const c = cand()
    return w?.where.updatedAt.getTime() === c.updatedAt.getTime()
      && w?.where.decidedBy === MACHINE && w?.where.createdPostId === null
  })())
  check('🔴 🔴 **본문 판을 함께 쓴다 — 나중에 대조할 수 있다**', (() => {
    const rec = readAutoReadyStamp(w?.data.editDiff)
    return rec !== null && rec.bodyVersion === bodyVersionOf(cand(), sha256)
  })())
  check('🔴 🔴 **자동 도장 기록은 "고친 내역" 으로 세어지지 않는다**',
    isEditRecord(w?.data.editDiff) === false)
  check('🔴 부적격 후보는 쓰지 않고 사람 검토로 보낸다', (() => {
    const r = run([cand({ id: 'q2', body: '이런 가죽쟈켓 어떤가요?' })])
    return r.writes.length === 0 && r.toHumanReview[0]?.reasons.some((x) => x.startsWith('imageDependent'))
  })())
}

console.log('\n⑪ 🔴 🔴 **운영 러너가 실제로 이 경로를 부른다**')
{
  const runner = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  const calls = (name: string) => new RegExp(`\\b${name}\\s*\\(`).test(runner)
  check('🔴 🔴 **발행 러너가 `planRun` 을 부른다 — 검사에서만 불리지 않는다**', calls('planRun'))
  check('🔴 🔴 **발행 러너가 `recheckBeforePublish` 를 부른다**', calls('recheckBeforePublish'))
  check('🔴 🔴 **발행 러너가 `auditPicks` 를 부른다**', calls('auditPicks'))
  check('🔴 🔴 **DB 에 실제로 쓴다 — `updateMany` 로 조건부 기록한다**',
    /updateMany\(\{[\s\S]{0,400}?decidedBy: w\.data\.decidedBy/.test(runner))
  check('🔴 🔴 **조건부 where 에 `updatedAt` 이 들어간다 — 그 사이 바뀌면 0건이다**',
    /where: \{[\s\S]{0,300}?updatedAt: w\.where\.updatedAt/.test(runner))
  check('🔴 🔴 **`--apply` 가 아니면 쓰지 않는다**', /if \(!APPLY\) \{\s*\n\s*console\.log\('     🟡 dry-run/.test(runner))
  check('🔴 🔴 **사람 도장을 쓰려 하면 그 자리에서 멈춘다**',
    /String\(w\.data\.decidedBy\) === String\(HUMAN_DECIDER\)/.test(runner))
  check('🔴 🔴 **발행 선택기에 게이트 판정을 넘긴다 — 기본 닫힘을 우회하지 않는다**',
    /autoReadyOpen: autoOpen\.open/.test(runner))
  check('🔴 표본은 기계 후보만 센다 — 사람 후보가 섞이면 부풀어 오른다 (실측 22 vs 15)',
    /startsWith: MACHINE_SITE_PREFIX/.test(runner))
}

console.log('\n⑫ 🔴 🔴 **경쟁 조건 — 재확인 직후 본문이 바뀌는 반례**')
{
  const sha256 = (t: string) => {
    let h = 2166136261 >>> 0
    for (const ch of t) h = (Math.imul(h ^ ch.charCodeAt(0), 16777619)) >>> 0
    return h.toString(16).padStart(8, '0').repeat(8)
  }
  const good = '주변에 물어보면 반반이더라고요. 다들 어떻게 드시나요?'
  const captured = new Date('2026-09-21T00:00:00Z')

  // 🔴 **한 행을 두 실행이 함께 본다.** 이것이 실제 배치의 모양이다.
  const store = {
    decidedBy: AUTO_DECIDER as string | null,
    title: '김치 이야기', body: good,
    editDiff: {} as unknown,
    gateVerdict: 'PASS' as unknown, gateResults: { holds: [], blocks: [] } as unknown,
    sourceCapturedAt: captured as Date | null,
  }
  store.editDiff = planRun({
    candidates: [{
      id: 'q1', decidedBy: 'machine:auto-draft-v5', updatedAt: new Date(), status: 'APPROVED',
      createdPostId: null, gateVerdict: 'PASS', warnings: [], sourceCapturedKnown: true,
      title: store.title, body: store.body,
    }],
    open: { open: true, reason: '네 조건 통과' }, now: new Date(),
    machineDecidedBy: 'machine:auto-draft-v5', sha256,
  }).writes[0]?.data.editDiff

  // ── ① 러너 A: 발행 직전 재확인 → 통과한다
  const stamp = readAutoReadyStamp(store.editDiff)!
  const outside = recheckBeforePublish({
    stampedBodyVersion: stamp.bodyVersion, current: { title: store.title, body: store.body },
    open: true, sha256,
    row: { gateVerdict: 'PASS', warnings: [], sourceCapturedKnown: true, title: store.title, body: store.body },
  })
  check('🔴 트랜잭션 밖 재확인은 이 순간 통과한다', outside.ok)

  // ── ② 그 직후 러너 B(또는 사람)가 본문을 고친다 — 트랜잭션은 아직 열리지 않았다
  store.body = `${good} 확실히 그런 겁니다.`

  // ── ③ 러너 A 가 이제 트랜잭션을 연다. **밖의 판정은 이미 낡았다.**
  const inTx = judgeAutoInTx({
    row: { ...store, title: store.title, body: store.body },
    autoReadyOpen: true, sha256,
  })
  check('🔴 🔴 **트랜잭션 안에서 잡는다 — 밖의 통과를 믿지 않는다**',
    inTx.ok === false && !inTx.ok && inTx.detail.includes('본문이 바뀌었다'), JSON.stringify(inTx))
  check('🔴 🔴 **밖의 재확인만 있었다면 바뀐 본문이 그대로 나갔을 것이다**', (() => {
    // 밖의 판정은 ①에서 이미 ok 였고, ②의 변경을 알 길이 없다
    return outside.ok && !inTx.ok
  })())

  // ── 게이트가 그 사이 닫혀도 막힌다
  store.body = good
  check('🔴 🔴 **도장 이후 게이트가 닫히면 트랜잭션 안에서 막힌다**', (() => {
    const v = judgeAutoInTx({ row: store, autoReadyOpen: false, sha256 })
    return !v.ok && v.detail.includes('닫혀')
  })())
  check('🔴 🔴 **해시 함수를 주지 않으면 발행되지 않는다 (fail-closed)**', (() => {
    const v = judgeAutoInTx({ row: store, autoReadyOpen: true, sha256: () => '' })
    return !v.ok
  })())
  check('🔴 🔴 **원천 시각을 잃으면 트랜잭션 안에서 막힌다**', (() => {
    const v = judgeAutoInTx({ row: { ...store, sourceCapturedAt: null }, autoReadyOpen: true, sha256 })
    return !v.ok && v.detail.includes('수집 시각')
  })())
  check('🔴 사람이 정한 글은 이 문을 지나지 않는다 — 기존 동작 불변',
    judgeAutoInTx({ row: { ...store, decidedBy: HUMAN_DECIDER }, autoReadyOpen: false, sha256 }).ok === true)
  check('🔴 본문이 그대로고 게이트가 열려 있으면 통과한다',
    judgeAutoInTx({ row: store, autoReadyOpen: true, sha256 }).ok === true)

  // ── 🔴 **실제 발행 함수를 돌린다.** 부르기만 하고 결과를 버리는 코드를 잡으려면
  //    문자열 검사로는 부족하다 — 가짜 저장소로 `publishOriginalPostTx` 자체를 실행한다.
  type Row = {
    id: string; status: string; createdPostId: string | null; gateVerdict: string
    draftTitle: string; draftBody: string; editedTitle: string | null; editedBody: string | null
    decidedBy: string | null; editDiff: unknown; gateResults: unknown
    rawContent: { sourceCapturedAt: Date | null }
    matchedPersona: {
      id: string; code: string; status: string; userId: string
      user: { providerId: string | null; _count: { accounts: number } }
    } | null
  }
  const baseRow = (): Row => ({
    id: 'q1', status: 'APPROVED', createdPostId: null, gateVerdict: 'PASS',
    draftTitle: '김치 이야기', draftBody: good, editedTitle: null, editedBody: null,
    decidedBy: AUTO_DECIDER, editDiff: store.editDiff, gateResults: { holds: [], blocks: [] },
    rawContent: { sourceCapturedAt: captured },
    matchedPersona: { id: 'p1', code: 'P10', status: 'active', userId: 'u1',
      user: { providerId: null, _count: { accounts: 0 } } },
  })
  /** 🔴 만들어진 Post 를 센다 — 0 이어야 "막았다" 이다 */
  const fakeDb = (row: Row) => {
    let created = 0
    const tx = {
      originalPostApprovalQueue: {
        findUnique: async () => row,
        updateMany: async () => ({ count: 1 }),
      },
      personaGlobalSwitch: { findUnique: async () => ({ enabled: false }) },
      personaActivityLog: { count: async () => 0, create: async () => { /* noop */ } },
      post: { create: async () => { created += 1; return { id: 'post-1', boardType: 'free' } } },
    }
    const client = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) }
    return { client: client as never, made: () => created }
  }

  const runTx = async (row: Row, open: boolean, hash: ((t: string) => string) | undefined) => {
    const db = fakeDb(row)
    const res = await publishOriginalPostTx(db.client, {
      queueId: row.id, publishedToday: 0, dailyCap: 5, autoReadyOpen: open, sha256: hash,
    })
    return { res, made: db.made() }
  }

  const okRun = await runTx(baseRow(), true, sha256)
  check('🔴 조건이 그대로면 실제로 발행된다 — 막기만 하는 코드가 아니다',
    okRun.res.kind === 'published' && okRun.made === 1, JSON.stringify(okRun.res))

  const changed = baseRow()
  changed.editedBody = `${good} 확실히 그런 겁니다.`   // 🔴 재확인 뒤 누가 고쳤다
  const changedRun = await runTx(changed, true, sha256)
  check('🔴 🔴 **바뀐 본문은 Post 가 만들어지지 않는다 (write 0)**',
    changedRun.res.kind === 'blocked' && changedRun.made === 0, JSON.stringify(changedRun.res))
  check('🔴 🔴 **막힌 이유가 값으로 남는다**',
    changedRun.res.kind === 'blocked' && changedRun.res.code === 'AUTO_READY_LOST')

  const shutRun = await runTx(baseRow(), false, sha256)
  check('🔴 🔴 **게이트가 닫혀 있으면 Post 0 이다**',
    shutRun.res.kind === 'blocked' && shutRun.made === 0)

  const noHash = await runTx(baseRow(), true, undefined)
  check('🔴 🔴 **해시를 안 넘기면 Post 0 이다 (fail-closed)**',
    noHash.res.kind === 'blocked' && noHash.made === 0)

  const human = baseRow()
  human.decidedBy = HUMAN_DECIDER
  const humanRun = await runTx(human, false, undefined)
  check('🔴 사람이 정한 글은 게이트와 무관하게 나간다 — 기존 동작 불변',
    humanRun.res.kind === 'published' && humanRun.made === 1, JSON.stringify(humanRun.res))
}

console.log('\n⑬ 🔴 🔴 **감사가 다음 회차에도 남고, 실제로 자동을 닫는다**')
{
  const row = (id: string, rec?: Record<string, unknown>) =>
    ({ id, editDiff: rec === undefined ? {} : { [AUDIT_RECORD_KEY]: rec } })
  const L2 = { pendingMaxDays: 2, pendingMax: 10, todayKst: '2026-09-22' }
  check('🔴 🔴 **기록이 행에 남아 다음 회차가 읽는다 — 임시 파일이 아니다**', (() => {
    const r = readAuditRecord({ [AUDIT_RECORD_KEY]: { pickedOn: '2026-09-22', defect: false } })
    return r?.pickedOn === '2026-09-22' && r.defect === false
  })())
  check('🔴 🔴 **결함이 나오면 자동이 닫힌다 — 비율을 줄이지 않는다**', (() => {
    const g = judgeAuditGate(auditStateOf([
      row('a', { pickedOn: 'd', defect: true }), row('b', { pickedOn: 'd', defect: false }), row('c'),
    ]), { pendingMaxDays: 2, pendingMax: 10, todayKst: '2026-09-22' })
    return !g.open && g.reason.includes('자동을 닫는다')
  })())
  const L = { pendingMaxDays: AUTO_READY_CONTRACT.auditPendingMaxDays,
    pendingMax: AUTO_READY_CONTRACT.auditPendingMax, todayKst: '2026-09-22' }
  check('🔴 🔴 **미확인이 있다는 사실만으로 즉시 닫지 않는다 — 사후 감사는 매회차 허가가 아니다**', (() => {
    const g = judgeAuditGate(auditStateOf([row('a', { pickedOn: '2026-09-22' }), row('b')]), L)
    return g.open && g.reason.includes('한도 안')
  })())
  check('🔴 🔴 **미확인이 오래 묵으면 닫는다**', (() => {
    const g = judgeAuditGate(auditStateOf([row('a', { pickedOn: '2026-09-18' }), row('b')]), L)
    return !g.open && g.reason.includes('4일')
  })())
  check('🔴 🔴 **미확인이 한도 건수를 넘으면 닫는다**', (() => {
    const many = Array.from({ length: AUTO_READY_CONTRACT.auditPendingMax + 1 },
      (_, i) => row(`p${i}`, { pickedOn: '2026-09-22' }))
    const g = judgeAuditGate(auditStateOf(many), L)
    return !g.open && g.reason.includes('한도')
  })())
  check('🔴 🔴 **한도를 주지 않으면 닫는다 — 계약을 빠뜨리면 안전한 쪽이다**',
    judgeAuditGate(auditStateOf([row('a', { pickedOn: '2026-09-22' }), row('b')])).open === false)
  check('🔴 🔴 **대기가 한도 안이어도 결함이 나오면 즉시 닫는다**', (() => {
    const g = judgeAuditGate(auditStateOf([
      row('a', { pickedOn: '2026-09-22', defect: true }), row('b', { pickedOn: '2026-09-22' }),
    ]), L)
    return !g.open && g.reason.includes('자동을 닫는다')
  })())
  check('🔴 날짜 형식이 이상하면 닫는다 — 모르면 안전한 쪽이다',
    judgeAuditGate(auditStateOf([row('a', { pickedOn: 'd' }), row('b')]), L).open === false)
  check('🔴 🔴 **자동 판정이 있는데 대상이 하나도 안 뽑혔으면 닫힌다**',
    judgeAuditGate(auditStateOf([row('a'), row('b')]), L2).open === false)
  check('🔴 전부 확인했고 결함 0 이면 통과한다',
    judgeAuditGate(auditStateOf([row('a', { pickedOn: 'd', defect: false }), row('b')]), L2).open === true)
  check('🔴 자동 판정이 아예 없으면 감사할 것이 없다', judgeAuditGate(auditStateOf([]), L2).open === true)
  check('🔴 🔴 **두 문 중 하나라도 닫히면 닫힌다**', (() => {
    const open = { open: true, reason: '통과' }
    const shut = { open: false, reason: '🔴 감사 — 결함' }
    return combineGates(open, shut).open === false
      && combineGates(shut, open).open === false
      && combineGates(open, open).open === true
  })())

  const runner = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  check('🔴 🔴 **러너가 감사 판정을 실제 게이트에 합친다**',
    /combineGates\(sampleGate, auditGate\)/.test(runner))
  check('🔴 🔴 **감사 대상을 DB 에 표시한다 — 러너 임시 디스크가 아니다**',
    /key: AUDIT_RECORD_KEY, value: markAuditPicked\(todayKst\)/.test(runner)
    && !/writeFileSync/.test(runner))
  check('🔴 🔴 **발행 트랜잭션에 게이트와 해시를 넘긴다**',
    /autoReadyOpen: autoOpen\.open, sha256,/.test(runner))
  check('🔴 감사 기록 명령이 있다 — 결과를 적을 자리가 실제로 있다', (() => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { scripts: Record<string, string> }
    return typeof pkg.scripts['auto-ready-audit'] === 'string'
  })())
}

console.log('\n⑭ 🔴 🔴 **두 실행이 같은 `editDiff` 를 쓴다 — 유실 반례**')
{
  // 🔴 실제 Prisma 의 모양을 흉내 낸다: `updatedAt` 은 쓸 때마다 바뀌고,
  //    `updateMany` 는 where 가 어긋나면 0 을 돌려준다.
  const makeRow = (editDiff: Record<string, unknown>) => {
    let state = { editDiff: editDiff as unknown, updatedAt: new Date(1000) }
    return {
      read: async () => ({ ...state }),
      /** 🔴 조건에 `updatedAt` 이 **있는** 쓰기 */
      writeCas: async (w: { where: { id: string; updatedAt: Date }; data: Record<string, unknown> }) => {
        if (w.where.updatedAt.getTime() !== state.updatedAt.getTime()) return 0
        state = { editDiff: w.data.editDiff, updatedAt: new Date(state.updatedAt.getTime() + 1) }
        return 1
      },
      /** 🔴 앞판처럼 `updatedAt` 이 **없는** 쓰기 — 언제나 성공한다 */
      writeBlind: async (data: Record<string, unknown>) => {
        state = { editDiff: data.editDiff, updatedAt: new Date(state.updatedAt.getTime() + 1) }
        return 1
      },
      now: () => state,
    }
  }
  const stampRec = { decidedBy: AUTO_DECIDER, bodyVersion: 'abcd1234abcd1234', openReason: '통과' }

  // ── 반례: 앞판 방식(updatedAt 없음)에서 도장이 사라진다
  {
    const row = makeRow({ [AUTO_READY_RECORD_KEY]: stampRec })
    // 실행 A 와 실행 B 가 **같은 값을 읽는다**
    const seenA = await row.read()
    const seenB = await row.read()
    // A: 감사 표시를 얹는다
    await row.writeBlind({ editDiff: mergeJsonField(seenA.editDiff, AUDIT_RECORD_KEY, { pickedOn: '2026-09-22' }) })
    // B: 자기가 읽은 (감사 표시 없는) 값에 감사 판정을 얹는다 — A 의 결과를 모른다
    await row.writeBlind({ editDiff: mergeJsonField(seenB.editDiff, AUDIT_RECORD_KEY, { pickedOn: '2026-09-22', defect: false }) })
    const after = row.now().editDiff
    check('🔴 🔴 **앞판 주장 "그 사이 변경 시 0건" 은 거짓이었다 — 두 쓰기가 다 성공한다**',
      readAuditRecord(after)?.defect === false)
    check('🔴 🔴 **그래도 도장은 살아남는다 (이번 경우)** — 유실은 값에 따라 달라진다',
      readAutoReadyStamp(after) !== null)
  }

  // ── 🔴 진짜 유실: B 가 A 보다 **먼저** 읽었고, 그 사이 A 가 도장을 찍었다
  {
    const row = makeRow({})
    const seenB = await row.read()                       // B 는 빈 칸을 봤다
    await row.writeBlind({ editDiff: mergeJsonField({}, AUTO_READY_RECORD_KEY, stampRec) }) // A 가 도장을 찍었다
    await row.writeBlind({ editDiff: mergeJsonField(seenB.editDiff, AUDIT_RECORD_KEY, { pickedOn: 'd' }) })
    check('🔴 🔴 **자동 도장이 통째로 사라진다 — 본문 판을 잃어 발행이 영구히 막힌다**',
      readAutoReadyStamp(row.now().editDiff) === null)
  }

  // ── 고친 방식: 조건부 + 재시도
  {
    const row = makeRow({})
    const seenB = await row.read()
    await row.writeBlind({ editDiff: mergeJsonField({}, AUTO_READY_RECORD_KEY, stampRec) })  // A 가 먼저 썼다
    // B 가 자기가 읽은 낡은 값으로 조건부로 쓰려 한다 → 0건 → 다시 읽어 합친다
    const res = await casMergeEditDiff({
      id: 'q1', key: AUDIT_RECORD_KEY, value: () => ({ pickedOn: 'd' }),
      read: async () => row.read(), write: async (w) => row.writeCas(w),
    })
    check('🔴 🔴 **조건부 + 재시도면 도장이 살아남는다**',
      res.ok && readAutoReadyStamp(row.now().editDiff) !== null, JSON.stringify(res))
    check('🔴 🔴 **감사 기록도 함께 남는다 — 둘 다 산다**',
      readAuditRecord(row.now().editDiff)?.pickedOn === 'd')
    check('🔴 낡은 값으로 쓰려던 시도는 0건이었다', seenB.updatedAt.getTime() !== row.now().updatedAt.getTime())
  }

  // ── 계속 바뀌면 성공한 척하지 않는다
  {
    const res = await casMergeEditDiff({
      id: 'q1', key: AUDIT_RECORD_KEY, value: () => ({ pickedOn: 'd' }),
      read: async () => ({ editDiff: {}, updatedAt: new Date(Math.random()) }),
      write: async () => 0, attempts: 3,
    })
    check('🔴 🔴 **끝내 못 쓰면 실패로 알린다 — 조용히 지나가지 않는다**',
      !res.ok && res.tries === 3)
  }
  check('🔴 다른 칸은 건드리지 않는다', (() => {
    const m = mergeJsonField({ titleChanged: true, [AUTO_READY_RECORD_KEY]: stampRec }, AUDIT_RECORD_KEY, { pickedOn: 'd' })
    return m.titleChanged === true && readAutoReadyStamp(m) !== null && readAuditRecord(m) !== null
  })())

  // 🔴 **부르는 쪽이 실제로 이 방식을 쓰는가**
  const runner = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  const audit = readFileSync('scripts/auto-ready-audit.mts', 'utf-8')
  check('🔴 🔴 **러너의 감사 표시가 조건부 병합을 쓴다**', /casMergeEditDiff\(/.test(runner))
  check('🔴 🔴 **감사 기록 명령이 조건부 병합을 쓴다**', /casMergeEditDiff\(/.test(audit))
  check('🔴 🔴 **두 곳 다 낡은 `editDiff` 통째 쓰기가 남아 있지 않다**',
    !/\.\.\.base, \[AUDIT_RECORD_KEY\]/.test(runner) && !/\.\.\.base,/.test(audit))
}

console.log('\n⑮ 🔴 🔴 **같은 `audit` 칸을 두 감사자가 엇갈려 쓴다**')
{
  // 🔴 앞 검사(⑭)는 **다른 키**가 살아남는지만 봤다. 같은 키 안의 **판정**이
  //    덮이는 것은 전혀 다른 문제다 — `yes` 가 `no` 에 덮이면 닫힌 게이트가 다시 열린다.
  const makeRow = (editDiff: Record<string, unknown>) => {
    let state = { editDiff: editDiff as unknown, updatedAt: new Date(1000) }
    return {
      read: async () => ({ ...state }),
      writeCas: async (w: { where: { id: string; updatedAt: Date }; data: Record<string, unknown> }) => {
        if (w.where.updatedAt.getTime() !== state.updatedAt.getTime()) return 0
        state = { editDiff: w.data.editDiff, updatedAt: new Date(state.updatedAt.getTime() + 1) }
        return 1
      },
      now: () => state,
    }
  }
  const L3 = { pendingMaxDays: 2, pendingMax: 10, todayKst: '2026-09-22' }
  const PICKED = { pickedOn: '2026-09-22' }

  // ── 감사자 A 는 "결함 있음", 감사자 B 는 "이상 없음" 을 기록한다.
  //    B 의 첫 시도는 A 때문에 0건이 되고, **재시도**에서 A 의 판정 위에 덮어쓴다.
  {
    const row = makeRow({ [AUDIT_RECORD_KEY]: PICKED })
    const a = await casMergeEditDiff({
      id: 'q1', key: AUDIT_RECORD_KEY, value: recordAuditVerdict({ defect: true, note: 'A: 나이 모순' }),
      read: async () => row.read(), write: async (w) => row.writeCas(w),
    })
    const b = await casMergeEditDiff({
      id: 'q1', key: AUDIT_RECORD_KEY, value: recordAuditVerdict({ defect: false, note: 'B: 이상 없음' }),
      read: async () => row.read(), write: async (w) => row.writeCas(w),
    })
    check('🔴 두 기록이 모두 성공한다 — 순서만 다르다', a.ok && b.ok)
    check('🔴 🔴 **`yes` 가 `no` 에 덮이지 않는다 — 덮이면 닫힌 게이트가 다시 열린다**',
      readAuditRecord(row.now().editDiff)?.defect === true,
      JSON.stringify(readAuditRecord(row.now().editDiff)))
    check('🔴 🔴 **게이트가 닫힌 채로 남는다**',
      judgeAuditGate(auditStateOf([{ id: 'q1', editDiff: row.now().editDiff }]), L3).open === false)
    check('🔴 뒤집힌 판정이 지워지지 않고 기록으로 남는다', (() => {
      const r = readAuditRecord(row.now().editDiff)
      return (r?.note ?? '').includes('A:') && (r?.note ?? '').includes('B:')
    })(), JSON.stringify(readAuditRecord(row.now().editDiff)))
  }

  // ── 순서를 바꿔도 같다
  {
    const row = makeRow({ [AUDIT_RECORD_KEY]: PICKED })
    await casMergeEditDiff({ id: 'q1', key: AUDIT_RECORD_KEY,
      value: recordAuditVerdict({ defect: false }), read: async () => row.read(), write: async (w) => row.writeCas(w) })
    await casMergeEditDiff({ id: 'q1', key: AUDIT_RECORD_KEY,
      value: recordAuditVerdict({ defect: true }), read: async () => row.read(), write: async (w) => row.writeCas(w) })
    check('🔴 🔴 **`no` 다음에 `yes` 가 와도 `yes` 가 이긴다**',
      readAuditRecord(row.now().editDiff)?.defect === true)
  }

  // ── 🔴 러너의 감사 대상 표시가 **이미 있는 판정을 지우지 못한다**
  {
    const row = makeRow({ [AUDIT_RECORD_KEY]: { pickedOn: '2026-09-21', defect: true, note: '결함' } })
    const r = await casMergeEditDiff({
      id: 'q1', key: AUDIT_RECORD_KEY, value: markAuditPicked('2026-09-22'),
      read: async () => row.read(), write: async (w) => row.writeCas(w),
    })
    const rec = readAuditRecord(row.now().editDiff)
    check('🔴 🔴 **표시가 이미 끝난 판정을 지우지 않는다**',
      rec?.defect === true && rec.note === '결함', JSON.stringify({ r, rec }))
    check('🔴 🔴 **뽑힌 날짜도 처음 것을 유지한다 — 다시 뽑아 시계를 되돌리지 않는다**',
      rec?.pickedOn === '2026-09-21')
  }

  // ── 아직 표시가 없으면 표시한다
  {
    const row = makeRow({})
    await casMergeEditDiff({ id: 'q1', key: AUDIT_RECORD_KEY, value: markAuditPicked('2026-09-22'),
      read: async () => row.read(), write: async (w) => row.writeCas(w) })
    check('🔴 표시가 없던 행은 감사 대상이 된다', readAuditRecord(row.now().editDiff)?.pickedOn === '2026-09-22')
  }

  // 🔴 부르는 쪽이 실제로 이 규칙을 쓰는가
  const runner = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  const audit = readFileSync('scripts/auto-ready-audit.mts', 'utf-8')
  check('🔴 🔴 **러너가 `markAuditPicked` 를 쓴다 — 통째 덮어쓰기가 아니다**',
    /value: markAuditPicked\(/.test(runner))
  check('🔴 🔴 **감사 기록 명령이 `recordAuditVerdict` 를 쓴다**',
    /value: recordAuditVerdict\(/.test(audit))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · write 0\n')
if (fail > 0) process.exit(1)
