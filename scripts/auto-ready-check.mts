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
  type ReviewOutcome,
} from '../src/lib/auto-ready'
import { selectAutoTargets, autoReadyAccepted, MACHINE_REVIEWED_BY, AUTO_GATE_VERDICT, type AutoRow } from '../src/lib/original-post-auto-publish'
import { AUTO_READY_CONTRACT } from '../src/lib/supply-schedule-contract'
import { reviewPatchOf, REVIEW_HARD_DEFECT_KEY } from '../src/lib/original-post-machine-review'
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

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · LLM 0 · write 0\n')
if (fail > 0) process.exit(1)
