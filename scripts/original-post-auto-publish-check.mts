#!/usr/bin/env tsx
/**
 * 자동 발행 러너 fixture — 🔴 **아무거나 내보내지 않는다** (§4-AL)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import { assignedCodeOf } from '../src/lib/supply-candidates'
import {
  reviewPatchOf, REVIEW_DECISIONS, REVIEW_DECISION_STATUS, REVIEW_DECISION_WRITES,
} from '../src/lib/original-post-machine-review'
import { ORIGINAL_POST_STATUSES } from '../src/lib/original-post-decision'

import { SOURCE_TITLE_CHECK_VERSION } from '../src/lib/draft-originality'
import {
  selectAutoTargets, judgeApply, verifyAfterPublish, pickPublishTarget, queueOrderKey, compareAutoRow,
  sourceTitleCheckOf, founderRetitled,
  AUTO_PROMPT_VERSION, AUTO_MODEL, AUTO_SITE_PREFIX, AUTO_GATE_VERDICT, REJECT_LABEL,
  type AutoRow,
  profileOf, machineMarksOk,
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_GATE_MARKS,
  MACHINE_REVIEWED_BY, machineReviewedByHuman, judgeReviewSnapshot, type ReviewSnapshot,
} from '../src/lib/original-post-auto-publish'
import { DRAFT_PROVENANCE, DRAFT_RULE_VERSION } from '../src/lib/micro-seed-auto-draft'
import { MACHINE_DECIDED_BY, HUMAN_ONLY_VALUES } from '../src/lib/micro-seed-supply-autofill'
import { kstDayStart, DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
import { planMatch, POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'

/** 🔴 이 회차가 내 단계의 슬롯이다 — 슬롯 판정 자체는 scale-foundation-check 가 본다 */
const MY_SLOT = { run: true, reason: '09:30 KST 는 이 단계의 슬롯이다' }

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
/** 통과하는 표본 — 여기서 한 가지씩 어긋뜨려 본다 */
const ok = (o: Partial<AutoRow> = {}): AutoRow => ({
  id: 'good1', status: 'APPROVED', createdPostId: null, gateVerdict: AUTO_GATE_VERDICT,
  promptVersion: AUTO_PROMPT_VERSION, model: AUTO_MODEL, matchedPersonaId: null,
  title: '집에 늘 두고 드시는 간식이 있으세요?', body: '떨어지면 허전해서…',
  sourceSite: `${AUTO_SITE_PREFIX}navercafe:remonterrace`,
  // 🔴 이 표본은 **사람 profile** 이다 — `decidedBy` 는 사람 경로가 찍는 값 그대로
  decidedBy: 'founder',
  decidedAt: new Date('2026-09-06T00:00:00Z'), createdAt: new Date('2026-09-06T00:00:00Z'), ...o,
})
/** 실제 대기열에 사는 legacy 글 — 🔴 절대 대상이 아니다 */
const legacy = (o: Partial<AutoRow> = {}): AutoRow => ok({
  id: 'legacy1', promptVersion: '13~14판', model: 'gemini-3.7-flash',
  sourceSite: '82cook', title: '주기적으로 사람 잡는 친정아빠', ...o,
})
const allPass = (): string => 'pass'

console.log('\n자동 발행 러너 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 대상 조건 — 일곱 개를 모두 통과해야 한다')
{
  const r = selectAutoTargets([ok()], allPass)
  check('🟢 다 맞으면 후보가 된다', r.targets.length === 1)
  const cases: [string, Partial<AutoRow>, string][] = [
    ['status 가 PENDING', { status: 'PENDING' }, 'STATUS'],
    ['status 가 DECLINED', { status: 'DECLINED' }, 'STATUS'],
    ['이미 발행됨', { createdPostId: 'post1' }, 'ALREADY_PUBLISHED'],
    ['gate 가 HOLD', { gateVerdict: 'HOLD' }, 'GATE'],
    // 🔴 이제 셋을 따로 보지 않고 profile 로 통째로 본다
    ['legacy 판', { promptVersion: '13~14판' }, 'PROFILE'],
    ['LLM 모델', { model: 'gemini-3.7-flash' }, 'PROFILE'],
    ['출처가 synthetic 이 아님', { sourceSite: '82cook' }, 'PROFILE'],
    ['제목이 빔', { title: '  ' }, 'EMPTY'],
    ['본문이 빔', { body: '' }, 'EMPTY'],
  ]
  for (const [label, patch, code] of cases) {
    const x = selectAutoTargets([ok(patch)], allPass)
    check(`🔴 ${label} → 제외 (${code})`, x.targets.length === 0 && x.rejected[0]?.code === code)
  }
  check('🔴 safety 가 pass 가 아니면 제외',
    selectAutoTargets([ok()], () => 'hold').targets.length === 0)
  check('safety 는 저장값이 아니라 발행 문안으로 다시 잰다', (() => {
    let seen = ''
    selectAutoTargets([ok({ title: 'T', body: 'B' })], (t, b) => { seen = `${t}|${b}`; return 'pass' })
    return seen === 'T|B'
  })())
  check('EDITED 도 대상이다', selectAutoTargets([ok({ status: 'EDITED' })], allPass).targets.length === 1)
  // 🔴 2026-09-14 — HUMAN_REVIEW_REQUIRED · TITLE_COPIES_SOURCE 를 더해 11개다.
  //    코드와 라벨이 1:1 이어야 한다
  check('제외 사유에 라벨이 있다 — 코드와 1:1', Object.keys(REJECT_LABEL).length === 11)
}

console.log('\n①-b 🔴 기계 profile — 통째로 맞아야 발행 후보다')
{
  const goodGate = { holds: [], blocks: [], autoDraft: { ...MACHINE_GATE_MARKS } }
  const m = (o: Partial<AutoRow> = {}): AutoRow => ok({
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}navercafe:remonterrace`,
    gateResults: goodGate, ...o,
  })
  check('🟢 완전한 기계 profile 은 후보가 된다', selectAutoTargets([m()], allPass).targets.length === 1)
  check('🟢 사람 profile 은 그대로 후보 (회귀 0)', selectAutoTargets([ok()], allPass).targets.length === 1)
  check('profileOf 가 둘을 가른다', profileOf(m()) === 'machine' && profileOf(ok()) === 'human')

  // 🔴 일부만 섞인 행은 전부 제외
  const mixed: [string, Partial<AutoRow>][] = [
    ['판만 기계 · 모델은 사람', { promptVersion: MACHINE_PROMPT_VERSION }],
    ['모델만 기계', { model: MACHINE_MODEL }],
    ['출처만 기계', { sourceSite: `${MACHINE_SITE_PREFIX}x` }],
    ['판·모델 기계인데 출처가 사람', {
      promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
      sourceSite: 'publish-candidate:navercafe:x',
    }],
  ]
  for (const [label, patch] of mixed) {
    const r = selectAutoTargets([ok(patch)], allPass)
    check(`🔴 ${label} → 제외`, r.targets.length === 0 && r.rejected[0]?.code === 'PROFILE')
  }
  check('🔴 gateResults 표시가 없으면 기계가 아니다',
    selectAutoTargets([m({ gateResults: { holds: [], blocks: [] } })], allPass).targets.length === 0)
  check('🔴 gateResults 가 옛 판이면 제외', selectAutoTargets([m({
    gateResults: { autoDraft: { ...MACHINE_GATE_MARKS, draftRuleVersion: 'auto-draft-옛판' } },
  })], allPass).targets.length === 0)
  check('🔴 provenance 가 사람이면 제외', selectAutoTargets([m({
    gateResults: { autoDraft: { ...MACHINE_GATE_MARKS, provenance: 'human-curated' } },
  })], allPass).targets.length === 0)
  check('🔴 sourceDecision 이 ADOPT 면 제외', selectAutoTargets([m({
    gateResults: { autoDraft: { ...MACHINE_GATE_MARKS, sourceDecision: 'ADOPT' } },
  })], allPass).targets.length === 0)
  check('machineMarksOk 가 셋을 다 본다',
    machineMarksOk(goodGate) && !machineMarksOk({ autoDraft: {} }) && !machineMarksOk(null))
  check('🔴 기계 후보도 safety 를 다시 잰다',
    selectAutoTargets([m()], () => 'hold').targets.length === 0)
  check('🔴 기계 표시가 사람 것과 겹치지 않는다',
    (MACHINE_PROMPT_VERSION as string) !== (AUTO_PROMPT_VERSION as string)
    && (MACHINE_MODEL as string) !== (AUTO_MODEL as string))
}

console.log('\n② 🔴 legacy APPROVED 5건이 섞이지 않는다')
{
  // 실제 대기열을 닮은 표본 — legacy 5 + 우리 1
  const queue = [
    legacy({ id: 'L1', gateVerdict: 'PASS' }),
    legacy({ id: 'L2', gateVerdict: 'HOLD' }),
    legacy({ id: 'L3', gateVerdict: 'HOLD' }),
    legacy({ id: 'L4', gateVerdict: 'PASS' }),
    legacy({ id: 'L5', gateVerdict: 'HOLD' }),
    ok({ id: 'cmtprrfaq' }),
  ]
  const r = selectAutoTargets(queue, allPass)
  check('🔴 후보는 우리 1건뿐', r.targets.length === 1 && r.targets[0]!.id === 'cmtprrfaq')
  check('🔴 legacy 는 gate=PASS 여도 제외된다',
    !r.targets.some((t) => t.id === 'L1' || t.id === 'L4'))
  check('제외 5건 전부 사유가 남는다', r.rejected.length === 5)
  check('🔴 어느 것도 우연히 통과하지 않는다',
    r.rejected.every((x) => x.code === 'PROFILE' || x.code === 'GATE'))
}

console.log('\n③ 줄 세우기 — 오래 기다린 것이 먼저다')
{
  const D = (iso: string): Date => new Date(iso)
  const older = ok({ id: 'zzz', decidedAt: D('2026-09-01T00:00:00Z'), createdAt: D('2026-09-01T00:00:00Z') })
  const newer = ok({ id: 'aaa', decidedAt: D('2026-09-05T00:00:00Z'), createdAt: D('2026-09-05T00:00:00Z') })
  const r = selectAutoTargets([newer, older], allPass)
  check('🔴 오래된 것이 앞 — id 가 뒤여도 시각이 이긴다',
    r.targets.map((t) => t.id).join(',') === 'zzz,aaa')
  check('입력 순서를 바꿔도 같다',
    selectAutoTargets([older, newer], allPass).targets.map((t) => t.id).join(',') === 'zzz,aaa')
  // 🔴 후보 2건이면 오래된 1건만 나간다
  const g = judgeApply({ targets: r.targets, picked: r.targets[0]!, apply: true, limit: 1, publishedToday: 0, dailyCap: 1, killSwitchEnabled: false, slot: MY_SLOT })
  check('🔴 후보 2건이면 오래된 1건을 고른다', g.ok && g.target.id === 'zzz')
  const t2 = selectAutoTargets([older, newer], allPass).targets
  const g2 = judgeApply({ targets: t2, picked: t2[0]!, apply: true, limit: 1, publishedToday: 0, dailyCap: 1, killSwitchEnabled: false, slot: MY_SLOT })
  check('🔴 입력 순서가 바뀌어도 같은 1건을 고른다', g2.ok && g2.target.id === 'zzz')

  check('decidedAt 이 없으면 createdAt 이 대신한다',
    queueOrderKey(ok({ decidedAt: null, createdAt: D('2026-01-01T00:00:00Z') })) === D('2026-01-01T00:00:00Z').getTime())
  check('시각이 같으면 id 로 가른다', compareAutoRow(
    ok({ id: 'a', decidedAt: D('2026-09-01T00:00:00Z') }),
    ok({ id: 'b', decidedAt: D('2026-09-01T00:00:00Z') }),
  ) < 0)

  const sp = pickPublishTarget({ ordered: r.targets, assignedOf: () => 'PXX' })
  check('선택 1건 + 대기 N건으로 나뉜다', sp.picked?.id === 'zzz' && sp.waiting.length === 1)
  check('후보 0건이면 선택도 없다', pickPublishTarget({ ordered: [], assignedOf: () => 'PXX' }).picked === null)
  check('🔴 대기분을 숨기지 않는다', sp.waiting[0]!.id === 'aaa')
}

console.log('\n③-2 KST 자정 — cap 을 세는 기준')
{
  const eq = (a: Date, iso: string): boolean => a.toISOString() === iso
  // 🔴 setUTCHours(-9) 는 UTC 15시 이후에 어제로 밀린다. 그래서 기존 함수를 쓴다
  check('2026-09-06T14:59Z (KST 9/6 23:59) → 9/6 자정',
    eq(kstDayStart(new Date('2026-09-06T14:59:00Z')), '2026-09-05T15:00:00.000Z'))
  check('2026-09-06T15:00Z (KST 9/7 00:00) → 9/7 자정',
    eq(kstDayStart(new Date('2026-09-06T15:00:00Z')), '2026-09-06T15:00:00.000Z'))
  check('2026-09-06T23:59Z (KST 9/7 08:59) → 9/7 자정',
    eq(kstDayStart(new Date('2026-09-06T23:59:00Z')), '2026-09-06T15:00:00.000Z'))
  // 🔴 주석을 지우고 본다 — 주석에 적힌 금지 패턴이 자기 자신을 잡으면 안 된다
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('🔴 러너가 setUTCHours(-9) 를 쓰지 않는다',
    !/setUTCHours\(-9/.test(codeOf('scripts/original-post-auto-publish.mts'))
    && /kstDayStart\(/.test(codeOf('scripts/original-post-auto-publish.mts')))
  check('🔴 발행 스크립트 어디에도 setUTCHours(-9) 가 없다',
    ['scripts/original-post-auto-publish.mts', 'scripts/original-post-publish-live.mts']
      .every((f) => !/setUTCHours\(-9/.test(codeOf(f))))
}

console.log('\n③-b 🔴 배정 없는 맨 앞 글 때문에 하루를 버리지 않는다 (2026-09-07)')
{
  // 🔴 사고: 최희소 후보 하나가 막혀 09-20 · 21 · 22 사흘이 연속으로 비었다.
  //    맨 앞 글만 보고 멈췄기 때문이다. 이제는 **배정이 있는 첫 글**을 집는다.
  const D = (iso: string): Date => new Date(iso)
  const rows = selectAutoTargets([
    ok({ id: 'first', decidedAt: D('2026-09-01T00:00:00Z'), createdAt: D('2026-09-01T00:00:00Z') }),
    ok({ id: 'second', decidedAt: D('2026-09-02T00:00:00Z'), createdAt: D('2026-09-02T00:00:00Z') }),
    ok({ id: 'third', decidedAt: D('2026-09-03T00:00:00Z'), createdAt: D('2026-09-03T00:00:00Z') }),
  ], allPass).targets
  check('줄은 오래된 순 그대로다', rows.map((t) => t.id).join(',') === 'first,second,third')

  // 맨 앞이 생활사로 영구 차단(LIFE_BLOCKED) — 뒤 후보가 나간다
  const lifeBlocked = pickPublishTarget({ ordered: rows, assignedOf: (id) => (id === 'first' ? null : 'PXX') })
  check('🔴 맨 앞이 영구 차단이면 뒤 후보를 낸다', lifeBlocked.picked?.id === 'second')
  check('🔴 건너뛴 글은 지우지 않고 그대로 보고된다', lifeBlocked.skipped.map((t) => t.id).join(',') === 'first')
  check('건너뛴 글은 대기 목록에 중복으로 들어가지 않는다', lifeBlocked.waiting.map((t) => t.id).join(',') === 'third')

  // 맨 앞 두 건이 capacity 대기 — 세 번째가 나간다
  const capWait = pickPublishTarget({ ordered: rows, assignedOf: (id) => (id === 'third' ? 'PXX' : null) })
  check('🔴 앞 두 건이 여력 대기면 세 번째를 낸다', capWait.picked?.id === 'third')
  check('건너뛴 2건이 모두 보고된다', capWait.skipped.map((t) => t.id).join(',') === 'first,second')

  // 🔴 전부 차단이면 발행 0 — 아무거나 집어 내지 않는다
  const none = pickPublishTarget({ ordered: rows, assignedOf: () => null })
  check('🔴 모든 후보가 차단이면 발행 0', none.picked === null && none.waiting.length === 0)
  check('전부 차단이면 전부 건너뜀으로 보고된다', none.skipped.length === 3)

  // 🔴 맨 앞이 배정돼 있으면 예전과 똑같이 맨 앞이 나간다
  const normal = pickPublishTarget({ ordered: rows, assignedOf: () => 'PXX' })
  check('맨 앞이 배정되면 맨 앞이 나간다 — 순서를 뒤집지 않는다', normal.picked?.id === 'first' && normal.skipped.length === 0)

  // 🔴 한 회차 발행은 여전히 1건이다 — 건너뛰기가 상한을 열지 않는다
  check('🔴 건너뛰어도 한 회차 1건이다', lifeBlocked.skipped.length + 1 + lifeBlocked.waiting.length === rows.length)

  // 🔴 입력 순서를 바꿔도 같은 글이 나간다
  const reordered = selectAutoTargets([
    ok({ id: 'third', decidedAt: D('2026-09-03T00:00:00Z'), createdAt: D('2026-09-03T00:00:00Z') }),
    ok({ id: 'first', decidedAt: D('2026-09-01T00:00:00Z'), createdAt: D('2026-09-01T00:00:00Z') }),
    ok({ id: 'second', decidedAt: D('2026-09-02T00:00:00Z'), createdAt: D('2026-09-02T00:00:00Z') }),
  ], allPass).targets
  check('🔴 입력 순서가 바뀌어도 같은 글을 낸다',
    pickPublishTarget({ ordered: reordered, assignedOf: (id) => (id === 'first' ? null : 'PXX') }).picked?.id === 'second')

  // 🔴 exact-id 우회가 없다 — 고르는 근거는 배정 여부와 줄 순서뿐이다
  const codeOf = (f: string): string => readFileSync(f, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const lib = codeOf('src/lib/original-post-auto-publish.ts')
  check('🔴 특정 queue id 를 코드에 박아 우회하지 않는다', !/cm[a-z0-9]{20,}/.test(lib))
  check('🔴 러너도 특정 id 를 박지 않는다', !/cm[a-z0-9]{20,}/.test(codeOf('scripts/original-post-auto-publish.mts')))
}

console.log('\n③-c 🔴 복구 우선 — 배정만 하고 발행 못 한 행이 먼저 나간다 (2026-09-07)')
{
  const D = (iso: string): Date => new Date(iso)
  const rows = selectAutoTargets([
    ok({ id: 'stuck', decidedAt: D('2026-09-01T00:00:00Z'), createdAt: D('2026-09-01T00:00:00Z') }),
    ok({ id: 'newer1', decidedAt: D('2026-09-02T00:00:00Z'), createdAt: D('2026-09-02T00:00:00Z') }),
    ok({ id: 'newer2', decidedAt: D('2026-09-03T00:00:00Z'), createdAt: D('2026-09-03T00:00:00Z') }),
  ], allPass).targets

  // 🔴 기존 배정 행이 앞에 있고, 뒤에 신규 배정 행이 있다 → 기존 행이 우선이다
  const r1 = pickPublishTarget({
    ordered: rows,
    assignedOf: () => 'PXX',
    isRecovery: (id) => id === 'stuck',
  })
  check('🔴 기존 배정 행 뒤에 신규 배정 행이 있어도 기존 행이 먼저다', r1.picked?.id === 'stuck' && r1.recovered)

  // 🔴 기존 배정 행이 **뒤에** 있어도 복구가 먼저다 — 그 persona 의 여력이 이미 묶여 있다
  const r2 = pickPublishTarget({
    ordered: rows,
    assignedOf: () => 'PXX',
    isRecovery: (id) => id === 'newer2',
  })
  check('🔴 복구 행이 줄 뒤에 있어도 먼저 나간다', r2.picked?.id === 'newer2' && r2.recovered)
  check('복구로 건너뛴 앞줄은 지워지지 않고 보고된다', r2.skipped.map((t) => t.id).join(',') === 'stuck,newer1')

  // 🔴 복구 행의 배정이 깨졌으면(assignedOf null) 복구 대상이 아니다 — 다음 배정 행이 나간다
  const r3 = pickPublishTarget({
    ordered: rows,
    assignedOf: (id) => (id === 'stuck' ? null : 'PXX'),
    isRecovery: (id) => id === 'stuck',
  })
  check('🔴 배정이 깨진 복구 행은 고르지 않는다', r3.picked?.id === 'newer1' && !r3.recovered)

  // 🔴 복구 행이 없으면 예전과 같다 — 가장 오래된 배정 행
  const r4 = pickPublishTarget({ ordered: rows, assignedOf: () => 'PXX', isRecovery: () => false })
  check('복구 행이 없으면 가장 오래된 배정 행이 나간다', r4.picked?.id === 'stuck' && !r4.recovered)

  // 🔴 한 회차 1건은 그대로다
  check('🔴 복구여도 한 회차 1건이다', r2.skipped.length + 1 + r2.waiting.length === rows.length)

  // 🔴 러너가 기존 배정을 재배정하지 않는다 — updateMany 는 matchedPersonaId: null 인 행만 노린다
  const codeOf2 = (f: string): string => readFileSync(f, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const runnerSrc = codeOf2('scripts/original-post-auto-publish.mts')
  check('🔴 배정 저장은 matchedPersonaId 가 null 인 행만 노린다',
    /updateMany\([\s\S]{0,400}?matchedPersonaId: null/.test(runnerSrc))
  check('🔴 기존 배정 행은 배정 저장 블록에 들어가지 않는다',
    /if \(target\.matchedPersonaId === null\) \{/.test(runnerSrc))
  check('🔴 matchedAt 을 다시 쓰는 경로가 하나뿐이다',
    (runnerSrc.match(/matchedAt: new Date\(\)/g) ?? []).length === 1)
  // 🔴 조립이 `queueCandidateOf` 로 옮겨 갔다 (2026-09-22) — 러너·예측기가 같은 값을
  //    쓰게 하려고 뽑았다. 문자열이 아니라 **넘기는 값**과 **그 함수의 동작**을 본다.
  check('🔴 기존 배정을 정본 조립 함수에 넘긴다',
    /queueCandidateOf\(\{/.test(runnerSrc) && /matchedPersonaId: t\.matchedPersonaId/.test(runnerSrc))
  check('🔴 🔴 **배정 id 가 있으면 코드로, 못 찾으면 모르는 코드로 — 빈 값이 아니다**', (() => {
    const codeOf = new Map([['pid-1', 'P18']])
    return assignedCodeOf(null, codeOf) === null
      && assignedCodeOf('pid-1', codeOf) === 'P18'
      && assignedCodeOf('없음', codeOf) === '__unknown:없음'
  })())
  check('🔴 배정이 깨졌으면 발행하지 않고 멈춘다',
    /recoveryProblem/.test(runnerSrc) && /brokenRecovery/.test(runnerSrc))
  check('🔴 예고한 persona 와 발행된 persona 를 대조한다',
    /res\.personaCode !== announced/.test(runnerSrc))
}

console.log('\n③-d 🔴 judgeApply membership — 줄 밖 행을 발행하지 않는다')
{
  const D = (iso: string): Date => new Date(iso)
  const line = selectAutoTargets([
    ok({ id: 'a', decidedAt: D('2026-09-01T00:00:00Z'), createdAt: D('2026-09-01T00:00:00Z') }),
    ok({ id: 'b', decidedAt: D('2026-09-02T00:00:00Z'), createdAt: D('2026-09-02T00:00:00Z') }),
  ], allPass).targets
  const g = { apply: true, limit: 1, publishedToday: 0, dailyCap: 1, killSwitchEnabled: false, slot: MY_SLOT }

  check('🟢 줄 안의 행이면 통과', judgeApply({ ...g, targets: line, picked: line[0]! }).ok)

  // 🔴 legacy 행을 picked 로 밀어 넣는다 — 안전 재판정을 거치지 않은 행이다
  const legacy = ok({ id: 'legacy', promptVersion: '13판', model: 'gemini-2.5-flash' })
  check('🔴 legacy 행을 picked 로 주입하면 멈춘다',
    !judgeApply({ ...g, targets: line, picked: legacy }).ok)

  // 🔴 이미 발행된 행
  const published = ok({ id: 'done', createdPostId: 'post_1', status: 'PUBLISHED' })
  check('🔴 이미 발행된 행을 picked 로 주입하면 멈춘다',
    !judgeApply({ ...g, targets: line, picked: published }).ok)

  // 🔴 재판정을 통과했더라도 이 줄에 없으면 안 된다
  const elsewhere = ok({ id: 'elsewhere' })
  check('🔴 줄에 없는 행이면 멈춘다', !judgeApply({ ...g, targets: line, picked: elsewhere }).ok)

  // 🔴 같은 id 지만 내용이 다른 사본을 주면, 줄에 있는 그 행을 낸다
  const impostor = ok({ id: 'a', title: '바꿔치기' })
  const r = judgeApply({ ...g, targets: line, picked: impostor })
  check('🔴 같은 id 사본을 줘도 줄에 있는 행을 낸다', r.ok && r.target === line[0]!)

  // 🔴 줄에 같은 id 가 둘이면 어느 쪽인지 말할 수 없다 — 멈춘다
  const dup = [line[0]!, line[0]!]
  check('🔴 후보 목록에 id 중복이 있으면 멈춘다', !judgeApply({ ...g, targets: dup, picked: line[0]! }).ok)
}

console.log('\n④ 실행 게이트 — 하나라도 어긋나면 멈춘다')
{
  const one = [ok()]
  const base = { targets: one, picked: one[0]!, apply: true, limit: 1, publishedToday: 0, dailyCap: 1, killSwitchEnabled: false, slot: MY_SLOT }
  check('🟢 전부 맞으면 통과', judgeApply(base).ok)
  check('🔴 --apply 없으면 안 돈다', !judgeApply({ ...base, apply: false }).ok)
  check('🔴 --limit 없으면 안 돈다', !judgeApply({ ...base, limit: null }).ok)
  check('🔴 --limit 이 2면 안 돈다', !judgeApply({ ...base, limit: 2 }).ok)
  check('🔴 --limit 이 0이면 안 돈다', !judgeApply({ ...base, limit: 0 }).ok)
  check('🔴 후보 0건이면 안 돈다', !judgeApply({ ...base, targets: [], picked: null }).ok)
  // 🔴 후보는 있는데 아무도 배정되지 않았으면 나가지 않는다 (2026-09-07)
  check('🔴 배정된 후보가 없으면 안 돈다', !judgeApply({ ...base, picked: null }).ok)
  // 🔴 여럿이어도 멈추지 않는다 — 줄 순서대로 맨 앞 하나가 나간다
  {
    const two = selectAutoTargets([
      ok({ id: 'b', decidedAt: new Date('2026-09-02T00:00:00Z') }),
      ok({ id: 'a', decidedAt: new Date('2026-09-01T00:00:00Z') }),
    ], allPass).targets
    const r = judgeApply({ ...base, targets: two, picked: two[0]! })
    check('🔴 후보 2건이면 멈추지 않고 오래된 1건을 낸다', r.ok && r.target.id === 'a')
    check('한 번에 한 건이다 — 나머지는 다음 회차', pickPublishTarget({ ordered: two, assignedOf: () => 'PXX' }).waiting.length === 1)
  }
  check('🔴 오늘 cap 을 채웠으면 안 돈다', !judgeApply({ ...base, publishedToday: 1 }).ok)
  check('🔴 cap 을 넘겼어도 안 돈다', !judgeApply({ ...base, publishedToday: 3 }).ok)
  check('🔴 kill switch 가 켜지면 안 돈다', !judgeApply({ ...base, killSwitchEnabled: true }).ok)
  // 🔴 내 단계의 회차가 아니면 쓰기 문이 열리지 않는다 — DB write 0
  check('🔴 내 단계의 슬롯이 아니면 안 돈다',
    !judgeApply({ ...base, slot: { run: false, reason: '09:20 KST 는 d1 의 슬롯이 아니다' } }).ok)
  check('🔴 막힌 이유를 슬롯 판정 그대로 말한다', (() => {
    const r = judgeApply({ ...base, slot: { run: false, reason: '09:20 KST 는 d1 의 슬롯이 아니다' } })
    return !r.ok && r.reason.includes('09:20')
  })())
  check('통과하면 대상 1건을 돌려준다', (() => {
    const r = judgeApply(base)
    return r.ok && r.target.id === 'good1'
  })())
}

console.log('\n⑤ 발행 뒤 정합 — 셋이 다 맞아야 한다')
{
  const good = { queueStatus: 'PUBLISHED', createdPostId: 'p1', postExists: true, activityLogCount: 1 }
  check('🟢 다 맞으면 통과', verifyAfterPublish(good).ok)
  check('🔴 Queue 가 PUBLISHED 가 아니면 이상',
    !verifyAfterPublish({ ...good, queueStatus: 'APPROVED' }).ok)
  check('🔴 createdPostId 가 비면 이상', !verifyAfterPublish({ ...good, createdPostId: null }).ok)
  check('🔴 Post 가 없으면 이상', !verifyAfterPublish({ ...good, postExists: false }).ok)
  // 🔴 ActivityLog 가 cap 의 정본이다
  check('🔴 ActivityLog 0건이면 이상 — 다음 발행에서 상한이 조용히 열린다',
    !verifyAfterPublish({ ...good, activityLogCount: 0 }).ok)
  check('🔴 ActivityLog 2건이어도 이상', !verifyAfterPublish({ ...good, activityLogCount: 2 }).ok)
  check('무엇이 틀렸는지 말한다',
    verifyAfterPublish({ ...good, activityLogCount: 0 }).problems.some((p) => p.includes('ActivityLog')))
}

console.log('\n⑥ 🔴 러너가 하지 않는 것')
{
  const src = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [label, re] of [
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['LLM', /openai|anthropic|claude-|gpt-|gemini/i],
    ['네이버 접속', /cafe\.naver\.com|playwright|chromium|fetch\(/],
    ['Google Sheet', /googleapis|spreadsheet/i],
    ['마이그레이션', /ALTER TABLE|prisma migrate/i],
    ['status 를 APPROVED 로 바꾸기', /status:\s*'APPROVED'/],
  ] as const) check(`🔴 ${label} 없음`, !re.test(src))
  // 🔴 발행 write 를 여기서 다시 짜지 않는다
  check('🔴 post.create 를 직접 부르지 않는다 — 기존 tx 를 쓴다',
    !/prisma\.post\.create|tx\.post\.create/.test(src) && /publishOriginalPostTx\(/.test(src))
  check('두 스위치를 요구한다', /--apply/.test(src) && /--limit=1/.test(src))
  check('🔴 금지 호칭 없음', !['시니어', '어르신', '노인', '실버'].some((w) => src.includes(w)))

  const lib = readFileSync('src/lib/original-post-auto-publish.ts', 'utf-8')
  check('🔴 선정 lib 은 순수 함수만 — DB 도 await 도 없다',
    !/prisma|PrismaClient|await |async /.test(lib))
}

console.log('\n⑦ 🔴 pacing 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  const p = readFileSync('src/lib/original-post-publish.ts', 'utf-8')
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-08).
  //    상수를 `RUNTIME_PROFILE` 에서 파생시키면서 `= 1` 같은 리터럴이 사라졌다.
  //    문자열을 찾던 검사는 "값이 그대로인가" 를 물으려던 것이므로, 값으로 묻는 편이 더 강하다 —
  //    프로필이 바뀌면 문자열은 그대로여도 값이 달라질 수 있다.
  check('POST_CAP_PER_WEEK = 1 그대로', POST_CAP_PER_WEEK === 1)
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', MIN_DAYS_BETWEEN_POSTS === 5)
  check('DAILY_PUBLISH_CAP = 1 그대로', DAILY_PUBLISH_CAP === 1)
  check('러너가 상수를 재정의하지 않는다', (() => {
    const src = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
    return !/const (DAILY_PUBLISH_CAP|POST_CAP_PER_WEEK|MIN_DAYS_BETWEEN_POSTS)\s*=/.test(src)
  })())
}

// ══════════════════════════════════════════════════════════════════
// 🔴 persona mapping 누락 회귀 (2026-09-07 실측 사고)
//
// auto-publish 가 identity.childrenCount 를 넘기지 않아 **모든 persona 가 무자녀로
// 판정**됐다. hardFilter 는 `p.childrenCount ?? 0` 으로 읽기 때문이다.
// "아이랑 같이 갈 숙소, 뭐 보고 고르세요?" 글에서 자녀 있는 4명이 전부 NO_CHILDREN 으로
// 막혀 그 글은 영영 배정되지 못했다 — match-assign 은 넘기는데 여기만 빠져 있었다.
// ══════════════════════════════════════════════════════════════════
{
  // 🔴 CHILDREN_RE 가 실제로 잡는 낱말을 쓴다 — '아이랑' 은 패턴에 없다.
  //    fixture 가 트리거하지 못하면 통과해도 아무것도 검증하지 못한다.
  const KID_TITLE = '애들이랑 같이 갈 숙소, 뭐 보고 고르세요?'
  const KID_BODY = '이번에 애들이랑 같이 가려는데 숙소를 뭘 보고 골라야 할지 모르겠어요. 다들 어떻게 고르세요?'
  const base = {
    // 🔴 운영 persona 는 로그인하지 않으므로 Account 0 이 정상이다 (없으면 fail-closed 로 막힌다)
    status: 'active', providerId: null, accountCount: 0, maritalStatus: 'married',
    parentCare: null, menopauseStatus: null, workStatus: null,
    economicStatus: null, region: null, noGoTopics: [],
    voiceLength: null, postsThisWeek: 0, daysSinceLastPost: null,
  }
  const withKids = [
    { ...base, code: 'P10', childrenCount: 1 },
    { ...base, code: 'P17', childrenCount: 2 },
    { ...base, code: 'P15', childrenCount: 0 },
  ] as never[]
  // 🔴 버그 재현 — childrenCount 를 아예 넘기지 않은 입력
  const withoutKids = [
    { ...base, code: 'P10' }, { ...base, code: 'P17' }, { ...base, code: 'P15' },
  ] as never[]

  const planWith = planMatch({ queueId: 'q', title: KID_TITLE, body: KID_BODY, personas: withKids, voice: null, profile: 'human' })
  const planWithout = planMatch({ queueId: 'q', title: KID_TITLE, body: KID_BODY, personas: withoutKids, voice: null, profile: 'human' })

  check('🔴 [회귀] childrenCount 를 넘기면 자녀 있는 persona 가 eligible 이다', (() => {
    const codes = planWith.eligible.map((c) => c.code).sort().join(' ')
    return codes === 'P10 P17'
  })())
  check('🔴 [회귀] 무자녀 persona 는 자녀 글에서 계속 차단된다',
    planWith.blocked.some((b) => b.code === 'P15' && b.reasons.some((r) => r.code === 'NO_CHILDREN')))
  check('🔴 [회귀] childrenCount 가 없으면 **전원** 무자녀로 막힌다 — 이것이 사고였다', (() => {
    const blockedAll = planWithout.blocked.filter(
      (b) => b.reasons.some((r) => r.code === 'NO_CHILDREN')).length
    return planWithout.eligible.length === 0 && blockedAll === 3
  })())
  check('🔴 [회귀] 두 입력의 결과가 실제로 다르다 — fixture 가 헛돌지 않는다',
    planWith.eligible.length !== planWithout.eligible.length)

  // 🔴 러너가 실제로 그 필드를 넘기는지 소스로 고정한다
  const src = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  check('🔴 [회귀] auto-publish 가 childrenCount 를 넘긴다',
    /childrenCount: typeof id\.childrenCount === 'number' \? id\.childrenCount : null/.test(src))
  check('🔴 [회귀] match-assign 과 같은 필드 집합을 넘긴다', (() => {
    const assign = readFileSync('scripts/original-post-match-assign.mts', 'utf-8')
    const fields = ['childrenCount', 'childrenAgeBands', 'maritalStatus', 'parentCare', 'menopauseStatus', 'noGoTopics']
    return fields.every((f) => src.includes(f) && assign.includes(f))
  })())
}

console.log('\n⑳ 🔴 기계 후보는 사람이 확인한 것만 자동 발행 대상이다 (2026-09-14)')
{
  /**
   * 🔴 **실측 결함.** `MACHINE_AGE_HUMAN_REVIEW_REQUIRED=true` 가 로그에만 찍히고
   *    `selectAutoTargets` 는 그 값을 보지 않았다 — 사람이 확인하지 않은 기계 글
   *    **41건**이 그대로 자동 발행 대상이었다(운영 DB 실측).
   *
   * 🔴 새 DB 컬럼도 migration 도 만들지 않았다. 큐의 `decidedBy` 하나를 쓴다.
   */
  const MACHINE_GATE = {
    provenance: DRAFT_PROVENANCE, sourceDecision: 'AUTO_ADOPT', draftRuleVersion: DRAFT_RULE_VERSION,
  }
  /** 기계 후보 표본 — profile=machine 이 되는 네 축을 통째로 만족시킨다 */
  const mach = (o: Partial<AutoRow> = {}): AutoRow => ok({
    id: 'm1', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}navercafe:remonterrace`,
    gateResults: { autoDraft: MACHINE_GATE },
    decidedBy: `machine:${DRAFT_RULE_VERSION}`, ...o,
  })
  const sel = (rows: AutoRow[]): ReturnType<typeof selectAutoTargets> => selectAutoTargets(rows, allPass)

  check('🟢 [전제] 표본이 machine profile 로 읽힌다', profileOf(mach()) === 'machine')
  check('🟢 [전제] 사람 표본은 human profile 이다', profileOf(ok()) === 'human')

  // ── ① 미검토 machine → 자동 발행 차단 ──
  check('🔴 [실측 재현] 미검토 machine APPROVED 는 자동 발행 대상이 아니다', (() => {
    const r = sel([mach()])
    return r.targets.length === 0 && r.rejected[0]?.code === 'HUMAN_REVIEW_REQUIRED'
  })())
  check('🔴 decidedBy 가 null 이어도 막힌다 (모르면 확인 안 한 것)',
    sel([mach({ decidedBy: null })]).targets.length === 0)
  check('🔴 모르는 값이어도 막힌다', sel([mach({ decidedBy: 'someone' })]).targets.length === 0)
  check('🔴 옛 판 표시(machine:auto-draft-v3)도 막힌다',
    sel([mach({ decidedBy: 'machine:auto-draft-v3' })]).targets.length === 0)
  check('🔴 차단 사유가 사람이 읽을 문구로 남는다',
    REJECT_LABEL.HUMAN_REVIEW_REQUIRED.includes('사람이 확인하지 않았다'))

  // ── ② founder 검토 machine → 통과 ──
  check('🟢 founder 가 확인한 machine 은 통과한다',
    sel([mach({ decidedBy: MACHINE_REVIEWED_BY })]).targets.length === 1)
  check('🟢 판정 함수가 값 하나로 답한다',
    machineReviewedByHuman('founder') && !machineReviewedByHuman('machine:auto-draft-v5')
    && !machineReviewedByHuman(null) && !machineReviewedByHuman(undefined)
    && !machineReviewedByHuman(' Founder '))

  // ── ③ human profile 은 기존 동작 그대로 ──
  check('🟢 [계약] human profile 은 decidedBy 와 무관하게 기존대로 통과',
    sel([ok({ decidedBy: null })]).targets.length === 1
    && sel([ok({ decidedBy: 'machine:auto-draft-v5' })]).targets.length === 1
    && sel([ok({ decidedBy: 'founder' })]).targets.length === 1)

  // ── ④ 줄 순서 — 오래된 미검토가 앞에 있어도 뒤의 검토 완료본을 고른다 ──
  check('🟢 오래된 미검토가 앞에 있어도 뒤의 검토 완료 후보가 선택된다', (() => {
    const oldUnreviewed = mach({ id: 'm-old', decidedAt: new Date('2026-09-01T00:00:00Z') })
    const newReviewed = mach({ id: 'm-new', decidedBy: MACHINE_REVIEWED_BY, decidedAt: new Date('2026-09-10T00:00:00Z') })
    const r = sel([oldUnreviewed, newReviewed])
    return r.targets.length === 1 && r.targets[0]!.id === 'm-new'
      && r.rejected.some((x) => x.id === 'm-old' && x.code === 'HUMAN_REVIEW_REQUIRED')
  })())
  check('🟢 검토 완료본이 여럿이면 오래 기다린 것이 먼저다', (() => {
    const a = mach({ id: 'm-a', decidedBy: MACHINE_REVIEWED_BY, decidedAt: new Date('2026-09-02T00:00:00Z') })
    const b = mach({ id: 'm-b', decidedBy: MACHINE_REVIEWED_BY, decidedAt: new Date('2026-09-05T00:00:00Z') })
    return sel([b, a]).targets[0]!.id === 'm-a'
  })())

  // ── ⑤ 🔴 게이트를 떼면 fixture 가 깨진다 ──
  const codeOf = (f: string): string => readFileSync(f, 'utf-8')
  const pubLib = codeOf('src/lib/original-post-auto-publish.ts')
  check('🔴 [회귀] 발행 판정이 MACHINE_AGE_HUMAN_REVIEW_REQUIRED 를 실제로 읽는다',
    /MACHINE_AGE_HUMAN_REVIEW_REQUIRED && profile === 'machine'/.test(pubLib))
  check('🔴 [회귀] AutoRow 에 decidedBy 가 있다', /decidedBy: string \| null/.test(pubLib))
  check('🔴 [회귀] 러너 select 가 decidedBy 를 읽고 넘긴다', (() => {
    const runner = codeOf('scripts/original-post-auto-publish.mts')
    return /decidedBy: true,/.test(runner) && /decidedBy: r\.decidedBy,/.test(runner)
  })())
  check('🔴 [회귀] 예측기도 같은 게이트를 본다', (() => {
    const planner = codeOf('scripts/persona-capacity-planner.mts')
    return /decidedBy: true,/.test(planner) && /decidedBy: r\.decidedBy,/.test(planner)
  })())

  // ── ⑥ 🔴 자동 보충기는 founder 를 찍지 못한다 ──
  const autofill = codeOf('src/lib/micro-seed-supply-autofill.ts')
  const machineBlock = autofill.slice(autofill.indexOf("profile: 'machine'"), autofill.indexOf("// 사람 경로 — 기존 그대로"))
  check('🔴 [계약] 자동 보충기의 machine 경로가 decidedBy 에 MACHINE_DECIDED_BY 를 쓴다',
    /decidedBy: MACHINE_DECIDED_BY,/.test(machineBlock))
  check('🔴 [계약] 자동 보충기의 machine 경로가 founder 를 찍지 않는다',
    !/decidedBy: 'founder'/.test(machineBlock))
  check('🔴 [계약] 기계 표시는 machine: 접두를 유지한다',
    MACHINE_DECIDED_BY.startsWith('machine:')
    && (MACHINE_DECIDED_BY as string) !== (MACHINE_REVIEWED_BY as string))
  check('🔴 [계약] founder 는 사람 전용 값 목록에 있다', HUMAN_ONLY_VALUES.includes(MACHINE_REVIEWED_BY))

  // ── ⑦ 🔴 검토 명령 — 기본 read-only · 근거 없으면 거부 ──
  const rev = codeOf('scripts/original-post-machine-review.mts')
  /**
   * 🔴 2026-09-20 — 읽기·검증·기록·재대조가 `completeReview` **한 트랜잭션**으로 옮겨졌다.
   *    러너는 그 경계에 Prisma 를 끼워 넣기만 한다. 판정 계약은 이 정본이 들고 있다.
   *    🔴 되돌아가는지(write 0)는 `check:supply-chain-e2e` ⑨ 가 주입 저장소로 실제로 돌린다.
   */
  const revLib = codeOf('src/lib/original-post-machine-review.ts')
  check('🔴 검토 명령은 --apply 없이 DB write 0 으로 끝난다',
    /if \(!APPLY\) \{/.test(rev) && rev.indexOf('if (!APPLY) {') < rev.indexOf('updateMany('))
  check('🔴 --apply 는 --id 와 --limit=1 을 함께 요구한다',
    /--apply 는 --id 와 함께만 씁니다/.test(rev) && /LIMIT !== 1/.test(rev))
  check('🔴 Persona·나이대 근거가 없으면 검토 완료를 거부한다',
    /if \(!g\.ok\) \{/.test(rev) && /검토 완료할 수 없습니다/.test(rev))
  check('🔴 사람 후보의 decidedBy 는 바꾸지 않는다',
    /profileOf\(target\) !== 'machine'/.test(rev))
  // 🔴 2026-09-14 — 낙관적 잠금으로 바뀌었다. 자세한 계약은 ㉑ 이 본다
  check('🔴 조건부 UPDATE — 스냅샷이 바뀌었으면 멈춘다',
    /createdPostId: null,/.test(rev) && /updatedAt: i\.where\.updatedAt,/.test(rev))
  /**
   * 🔴 **결정이 바꾸는 칸은 계약이 정한다** (2026-09-21). `ready` 는 예전처럼 도장 두 칸뿐이고,
   *    `edit`·`reject`·`hold` 는 상태와 수정본·사유까지 바꾼다. 어느 결정도
   *    최초 초안·게이트 결과·판·모델·발행 id 는 건드리지 않는다.
   */
  check('🔴 🔴 **ready 는 여전히 도장 두 칸만 바꾼다**', (() => {
    const patch = reviewPatchOf({
      action: { decision: 'ready' }, draftTitle: 'ㄱ', draftBody: 'ㄴ',
    })
    return patch.status === 'APPROVED' && patch.editedTitle === undefined
      && patch.editedBody === undefined && patch.editDiff === undefined
      && patch.declineReason === undefined
  })())
  check('🔴 [계약] 검토 명령이 Post·Comment·Persona 를 쓰지 않는다',
    !/prisma\.(post|comment|persona)\.(create|update|updateMany|delete)/.test(rev))
  check('🔴 🔴 **검토 명령이 최초 초안·게이트 결과·판·모델을 쓰지 않는다**', (() => {
    // 🔴 계약 타입에 그 칸이 아예 없다 — 쓰고 싶어도 쓸 수 없다
    const i = revLib.indexOf('export type ReviewPatch')
    if (i === -1) return false
    const block = revLib.slice(i, revLib.indexOf('\n}', i))
    return !/draftTitle|draftBody|gateResults|promptVersion|model|createdPostId/.test(block)
  })())
  check('🔴 [계약] 검토 명령이 provider 를 부르지 않는다',
    !/callProvider|anthropic|openai|fetch\(/.test(rev))
  check('🔴 기계 생성 provenance 보존을 확인한다 — read-back 대조',
    /const still = judgeReviewSnapshot\(expected, back\)/.test(revLib)
    // 🔴 바뀌라고 쓴 칸만 기대값으로 바꾼다 — provenance 칸은 그대로 대조한다
    && /promptVersion: before\.promptVersion|\.\.\.input\.before,/.test(revLib))
}

console.log('\n㉑ 🔴 검토 시각 정합 · 스냅샷 보호 (2026-09-14)')
{
  const rev = readFileSync('scripts/original-post-machine-review.mts', 'utf-8')
  const revLib = readFileSync('src/lib/original-post-machine-review.ts', 'utf-8')
  const MACHINE_GATE2 = {
    provenance: DRAFT_PROVENANCE, sourceDecision: 'AUTO_ADOPT', draftRuleVersion: DRAFT_RULE_VERSION,
  }
  const m2 = (o: Partial<AutoRow> = {}): AutoRow => ok({
    id: 'mm', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}navercafe:remonterrace`,
    gateResults: { autoDraft: MACHINE_GATE2 },
    decidedBy: `machine:${DRAFT_RULE_VERSION}`, ...o,
  })

  // ── ① decidedBy 와 decidedAt 을 **함께** 쓴다 ──
  check('🔴 검토 완료 UPDATE 가 decidedBy 와 decidedAt 을 함께 기록한다',
    /decidedBy: i\.decidedBy, decidedAt: i\.decidedAt,/.test(rev))
  check('🔴 검토 시각은 실제 검토 완료 시각이다 (적재 시각이 아니다)',
    /const reviewedAt = new Date\(\)/.test(rev))
  check('🔴 [회귀] decidedBy 만 바꾸던 옛 판이 아니다',
    !/data: \{ decidedBy: i\.decidedBy \}/.test(rev))
  check('🔴 🔴 **결정마다 상태가 정본 상태 안에서 정해진다**',
    REVIEW_DECISIONS.every((d) =>
      (ORIGINAL_POST_STATUSES as readonly string[]).includes(REVIEW_DECISION_STATUS[d])))
  check('🔴 read-back 이 decidedAt 까지 확인한다',
    /back\.decidedAt\.getTime\(\) !== input\.now\.getTime\(\)/.test(revLib)
    && /RollbackSignal\('stampMissing'/.test(revLib))

  // ── ② 자동 발행 정렬이 **실제 사람 검토 순서**를 쓴다 ──
  check('🟢 정렬 근거가 decidedAt 이다', (() => {
    const machineLoaded = m2({ id: 'old-load', decidedAt: new Date('2026-09-01T00:00:00Z') })
    // 🔴 같은 행이 사람 검토로 decidedAt 이 갱신된 모습
    const afterReview = m2({ id: 'old-load', decidedBy: MACHINE_REVIEWED_BY, decidedAt: new Date('2026-09-14T09:00:00Z') })
    return queueOrderKey(machineLoaded) !== queueOrderKey(afterReview)
      && queueOrderKey(afterReview) === new Date('2026-09-14T09:00:00Z').getTime()
  })())
  check('🟢 [요구] 오래된 기계 적재 시각이 founder 검토 시각으로 교체되면 줄 뒤로 간다', (() => {
    // A: 기계 적재 09-01 → 사람이 09-14 에 검토 → decidedAt 09-14
    const a = m2({ id: 'm-a', decidedBy: MACHINE_REVIEWED_BY, decidedAt: new Date('2026-09-14T09:00:00Z') })
    // B: 기계 적재 09-05 → 사람이 09-10 에 검토 → decidedAt 09-10
    const b = m2({ id: 'm-b', decidedBy: MACHINE_REVIEWED_BY, decidedAt: new Date('2026-09-10T09:00:00Z') })
    const r = selectAutoTargets([a, b], allPass)
    // 🔴 적재 순서(A 가 먼저)가 아니라 **검토 순서**(B 가 먼저)로 나간다
    return r.targets.length === 2 && r.targets[0]!.id === 'm-b'
  })())

  // ── ③ 스냅샷 보호 — 하나라도 바뀌면 founder 를 붙이지 않는다 ──
  const base: ReviewSnapshot = {
    status: 'APPROVED', createdPostId: null, decidedBy: `machine:${DRAFT_RULE_VERSION}`,
    updatedAt: new Date('2026-09-14T00:00:00Z'),
    title: '제목', body: '본문', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    gateResults: { autoDraft: MACHINE_GATE2 },
  }
  check('🟢 [요구] 정확한 스냅샷이면 통과', judgeReviewSnapshot(base, { ...base }).ok)
  check('🔴 [요구] 조회 후 본문이 바뀌면 founder 표시 불가', (() => {
    const v = judgeReviewSnapshot(base, { ...base, body: '바뀐 본문' })
    return !v.ok && v.changed.some((x) => x.includes('본문'))
  })())
  check('🔴 조회 후 제목(발행 문안)이 바뀌면 불가',
    !judgeReviewSnapshot(base, { ...base, title: '바뀐 제목' }).ok)
  check('🔴 [요구] 조회 후 status 가 바뀌면 불가',
    !judgeReviewSnapshot(base, { ...base, status: 'DECLINED' }).ok)
  check('🔴 그 사이 발행됐으면 불가',
    !judgeReviewSnapshot(base, { ...base, createdPostId: 'p1' }).ok)
  check('🔴 gateResults(기계 provenance)가 바뀌면 불가',
    !judgeReviewSnapshot(base, { ...base, gateResults: { autoDraft: {} } }).ok)
  check('🔴 promptVersion · model 이 바뀌면 불가',
    !judgeReviewSnapshot(base, { ...base, promptVersion: 'x' }).ok
    && !judgeReviewSnapshot(base, { ...base, model: 'y' }).ok)
  check('🟢 decidedBy·decidedAt 은 대조에 넣지 않는다 — 바뀌라고 쓴 칸이다',
    judgeReviewSnapshot(base, { ...base, decidedBy: MACHINE_REVIEWED_BY }).ok)

  // ── ④ 🔴 updatedAt 낙관적 잠금이 where 에 있다 ──
  check('🔴 [요구] 조회 시 updatedAt 을 읽는다', /updatedAt: true,/.test(rev))
  check('🔴 [요구] 조건부 UPDATE where 에 id·status·createdPostId·decidedBy·updatedAt 이 있다', (() => {
    const i = rev.indexOf('stamp: async (i) => (await tx.originalPostApprovalQueue.updateMany({')
    if (i === -1) return false
    const w = rev.slice(i, rev.indexOf('data: {', i))
    return /id: i\.id,/.test(w) && /status: rawById\.get\(i\.id\)!\.status,/.test(w)
      && /createdPostId: null,/.test(w) && /decidedBy: i\.where\.decidedBy,/.test(w)
      && /updatedAt: i\.where\.updatedAt,/.test(w)
  })())
  check('🔴 [요구] update 0건이면 멈춘다 — 같은 경계 안에서 되돌린다',
    /if \(n !== 1\) throw new RollbackSignal\('conditionMissed'/.test(revLib))
  check('🔴 read-back 이 발행 문안(edited ?? draft)으로 대조한다',
    /title: r\.editedTitle \?\? r\.draftTitle, body: r\.editedBody \?\? r\.draftBody,/.test(rev))
  check('🔴 read-back 이 judgeReviewSnapshot 으로 판정한다',
    /const still = judgeReviewSnapshot\(expected, back\)/.test(revLib))
  check('🔴 스냅샷이 어긋나면 exit 1 — 아무것도 쓰지 않는다',
    /if \(!verdict\.ok\) \{/.test(rev) && /아무것도 바꾸지 않았습니다/.test(rev))

  // ── ⑤ 🔴 write 범위가 넓어지지 않았다 ──
  check('🔴 🔴 **[계약] write 범위가 넓어지지 않았다** — Queue 한 테이블뿐', (() => {
    const writes = [...rev.matchAll(/(?:prisma|tx)\.([a-zA-Z]+)\.(create|update|updateMany|delete|deleteMany|upsert)/g)]
    return writes.length > 0 && writes.every((m) => m[1] === 'originalPostApprovalQueue')
  })())
  check('🔴 [계약] Post·Comment·Persona write 0',
    !/prisma\.(post|comment|persona)\.(create|update|updateMany|delete|deleteMany|upsert)/.test(rev))
  check('🔴 [계약] Queue 의 다른 컬럼을 쓰는 두 번째 write 가 없다',
    (rev.match(/originalPostApprovalQueue\.(update|updateMany|create|delete)/g) ?? []).length === 1)
  check('🔴 [계약] provider 호출 0', (() => {
    // 🔴 주석은 설명문이다 — 모델 이름이 "왜 필요한가" 로 적혀 있을 수 있다
    const code = rev.split('\n')
      .filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/**') })
      .join('\n')
    return !/callProvider|anthropic|openai|gemini|fetch\(/.test(code)
  })())
  check('🔴 [계약] read-only 경로가 여전히 먼저다',
    rev.indexOf('if (!APPLY) {') < rev.indexOf('updateMany('))

  // ── ⑥ 🔴 화면 문구가 실제 write 범위와 같은 말을 한다 ──
  /**
   * 🔴 **문구가 코드보다 좁으면 그것도 거짓이다** (2026-09-14).
   *    실제로는 `decidedBy`·`decidedAt` 둘을 쓰는데 화면은 "decidedBy 하나뿐" 이라고 적혀 있었다.
   *    사람이 그 문장을 읽고 "시각은 안 바뀌는구나" 로 이해하면, 바뀐 순서를 설명할 수 없다.
   */
  check('🔴 [회귀] "decidedBy 하나뿐" 이라는 낡은 문구가 돌아오지 않는다',
    !/decidedBy` ?하나뿐|decidedBy ?하나뿐/.test(rev))
  /**
   * 🔴 **출력이 사실을 말하는가** (2026-09-21). 결정이 셋이 되면서 "두 칸만 바뀐다" 는
   *    거짓이 됐다. 문구를 손으로 적지 않고 **정본 값을 읽어** 적는지 본다.
   */
  check('🔴 🔴 **"두 칸뿐" 이라는 낡은 문구가 사라졌다**',
    !/두 칸뿐이다/.test(rev)
    && !/본문 · 제목 · status · gateResults · Post · Comment · Persona 는 바뀌지 않았습니다/.test(rev))
  check('🔴 🔴 **바뀐 칸을 정본에서 읽어 적는다**',
    /REVIEW_DECISION_WRITES\[decision\]/.test(rev)
    && /REVIEW_UNTOUCHED_COLUMNS/.test(rev))
  check('🔴 🔴 **결정마다 바뀌는 칸이 사실과 같다**',
    REVIEW_DECISION_WRITES.ready === 'decidedBy · decidedAt'
    && REVIEW_DECISION_WRITES.edit.includes('editDiff')
    && REVIEW_DECISION_WRITES.edit.includes('status')
    && REVIEW_DECISION_WRITES.reject.includes('declineReason')
    && !REVIEW_DECISION_WRITES.ready.includes('status'))
  check('🔴 🔴 **미루기가 결정 목록에 없다**',
    !(REVIEW_DECISIONS as readonly string[]).includes('hold')
    && /미루기는 결정이 아니다/.test(rev))

  // ── ⑥ 🔴 기존 Gate 와 human 동작은 그대로다 ──
  check('🟢 [계약] 미검토 machine 은 여전히 차단된다',
    selectAutoTargets([m2()], allPass).rejected[0]?.code === 'HUMAN_REVIEW_REQUIRED')
  check('🟢 [계약] founder 검토 machine 은 여전히 통과',
    selectAutoTargets([m2({ decidedBy: MACHINE_REVIEWED_BY })], allPass).targets.length === 1)
  check('🟢 [계약] human profile 은 여전히 decidedBy 와 무관하게 통과',
    selectAutoTargets([ok({ decidedBy: null })], allPass).targets.length === 1)
}

console.log('\n⑧ 🔴 외부 원문 제목 복제 — 생성 시점 대조 결과만으로 막는다')
{
  const pubLib = readFileSync('src/lib/original-post-auto-publish.ts', 'utf-8')
  const RUNNER = readFileSync('scripts/original-post-auto-publish.mts', 'utf-8')
  const AUTOFILL = readFileSync('src/lib/micro-seed-supply-autofill.ts', 'utf-8')
  const GEN = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
  const goodGate = { holds: [], blocks: [], autoDraft: { ...MACHINE_GATE_MARKS } }
  /** 🔴 적재기가 남기는 모양 그대로 — **원문 제목도 해시도 없다** */
  const withCheck = (copied: boolean): Record<string, unknown> => ({
    ...goodGate,
    autofill: {
      sourceTitleChecked: true, sourceTitleCopied: copied,
      sourceTitleCheckVersion: SOURCE_TITLE_CHECK_VERSION,
    },
  })
  const mach = (o: Partial<AutoRow> = {}, gate: unknown = goodGate): AutoRow => ok({
    promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
    sourceSite: `${MACHINE_SITE_PREFIX}navercafe:remonterrace`,
    gateResults: gate, decidedBy: MACHINE_REVIEWED_BY,
    draftTitle: '원문과 똑같은 제목', editedTitle: null,
    title: '원문과 똑같은 제목', ...o,
  })

  // ── ① 실제 외부 원문이 있고 제목이 같았던 글 ──
  check('🔴 [T] 대조에서 같았던 글(copied=true)은 자동 발행 대상이 아니다', (() => {
    const r = selectAutoTargets([mach({}, withCheck(true))], allPass)
    return r.targets.length === 0 && r.rejected[0]?.code === 'TITLE_COPIES_SOURCE'
  })())
  check('🟢 [T] 대조했지만 달랐던 글(copied=false)은 통과한다',
    selectAutoTargets([mach({}, withCheck(false))], allPass).targets.length === 1)

  // ── ② 사람이 제목을 다시 지었는가 ──
  check('🔴 [T] copied=true 인데 editedTitle 이 없으면 계속 차단', (() => {
    const r = selectAutoTargets([mach({ editedTitle: null }, withCheck(true))], allPass)
    return r.targets.length === 0 && r.rejected[0]?.code === 'TITLE_COPIES_SOURCE'
  })())
  check('🔴 [T] 공백·문장부호만 바꾼 editedTitle 은 바꾼 것이 아니다 — 계속 차단', (() => {
    const r = selectAutoTargets([mach({
      draftTitle: '후라이팬 언제 바꾸세요?',
      editedTitle: ' 후라이팬  언제 바꾸세요 ',
      title: ' 후라이팬  언제 바꾸세요 ',
    }, withCheck(true))], allPass)
    return r.targets.length === 0 && r.rejected[0]?.code === 'TITLE_COPIES_SOURCE'
  })())
  check('🟢 [T] founder 가 실제로 다른 제목을 넣으면 통과한다',
    selectAutoTargets([mach({
      draftTitle: '후라이팬 언제 바꾸세요?',
      editedTitle: '멀쩡해 보이는 후라이팬, 언제 바꾸세요?',
      title: '멀쩡해 보이는 후라이팬, 언제 바꾸세요?',
    }, withCheck(true))], allPass).targets.length === 1)
  check('🔴 [T] founderRetitled 판정 — 없음·부호만·실제 변경', (() => {
    const d = '후라이팬 언제 바꾸세요?'
    return !founderRetitled({ draftTitle: d, editedTitle: null })
      && !founderRetitled({ draftTitle: d, editedTitle: ' 후라이팬  언제 바꾸세요 ' })
      && founderRetitled({ draftTitle: d, editedTitle: '후라이팬, 다들 몇 년 쓰세요?' })
  })())

  // ── ③ 외부 원문이 없는 후보 · legacy — 기존 동작 유지 ──
  check('🟢 [T] 외부 원문이 없는 합성 seed 는 대조 기록이 없고 그대로 통과한다',
    selectAutoTargets([mach({}, goodGate)], allPass).targets.length === 1
    && sourceTitleCheckOf(goodGate).checked === false)
  check('🟢 [T] legacy 행(기록 없음)에 새 HOLD 를 만들지 않는다',
    selectAutoTargets([ok()], allPass).targets.length === 1
    && sourceTitleCheckOf(undefined).checked === false
    && sourceTitleCheckOf(null).checked === false
    && sourceTitleCheckOf({ holds: [], blocks: [] }).checked === false)
  check('🔴 [T] checked=false 면 copied 값이 있어도 막지 않는다', (() => {
    const gate = { ...goodGate, autofill: { sourceTitleCopied: true } }
    return sourceTitleCheckOf(gate).checked === false
      && selectAutoTargets([mach({}, gate)], allPass).targets.length === 1
  })())

  // ── ④ 🔴 실제 후라이팬 후보(human-curated · 합성 raw · 기록 없음)는 영향을 받지 않는다 ──
  check('🟢 [T] 실제 후라이팬 후보는 이 변경의 영향을 받지 않는다 (사람이 고른 글 · 대조 기록 없음)', (() => {
    const real = ok({
      id: 'cmtqhtwa400072yd2kwv1xsjh',
      promptVersion: 'publish-candidate-v1', model: 'human-curated',
      sourceSite: 'publish-candidate:navercafe:remonterrace',
      draftTitle: '후라이팬 언제 바꾸세요?', editedTitle: null,
      title: '후라이팬 언제 바꾸세요?',
      body: '슬슬 낡은 것 같은데 아직 쓸 만해 보여서 계속 쓰고 있어요.',
      gateResults: { holds: [], blocks: [], bridge: { candidateType: 'seedOriginality' } },
    })
    const r = selectAutoTargets([real], allPass)
    return r.targets.length === 1 && sourceTitleCheckOf(real.gateResults).checked === false
  })())

  // ── ⑤ 🔴 저장되는 값 — 원문 제목도 해시도 없다 ──
  check('🔴 [T] gateResults 에 원문 제목이 저장되지 않는다', (() => {
    const json = JSON.stringify(withCheck(true))
    return !json.includes('후라이팬') && !json.includes('sourceTitle"')
      && !/[0-9a-f]{64}/.test(json)
  })())
  check('🔴 [T] 저장되는 것은 세 값뿐이다', (() => {
    const keys = Object.keys((withCheck(true).autofill as Record<string, unknown>))
    return keys.length === 3
      && keys.includes('sourceTitleChecked') && keys.includes('sourceTitleCopied')
      && keys.includes('sourceTitleCheckVersion')
  })())
  check('🔴 [회귀] 원문 제목 해시 저장 경로가 저장소에 없다',
    !/titleKeyHash|sourceTitleHash|source-title-fingerprint/.test(pubLib + RUNNER + AUTOFILL + GEN))
  check('🔴 [회귀] 적재기가 원문 제목 전문을 받지 않는다',
    !/sourceTitle: S\(c\.sourceTitle\)/.test(AUTOFILL))

  // ── ⑥ 길이 · 소재 · 말투로 막지 않는다 ──
  check('🟢 [T] 짧은 후라이팬 생활 질문은 길이·소재 사유로 막히지 않는다',
    selectAutoTargets([mach({
      draftTitle: '후라이팬 코팅 벗겨지면 어떻게 하세요?',
      title: '후라이팬 코팅 벗겨지면 어떻게 하세요?', body: '궁금해서요.',
    }, withCheck(false))], allPass).targets.length === 1)
  check('🟢 [T] 반말 일상 질문도 막지 않는다',
    selectAutoTargets([mach({
      draftTitle: '다들 후라이팬 언제 바꿔?', title: '다들 후라이팬 언제 바꿔?', body: '난 아직 써.',
    }, withCheck(false))], allPass).targets.length === 1)
  check('🔴 [T] 최소 글자 수·금지어·의미 유사도 규칙이 없다',
    !/minLength|MIN_BODY_CHARS|최소 글자|BANNED_TITLE|similarity|유사도/.test(pubLib))

  // ── ⑦ 판정만 한다 ──
  check('🔴 [T] 판정이 입력 행을 바꾸지 않는다 (본문·status·persona·provenance 불변)', (() => {
    const row = mach({}, withCheck(true))
    const snap = JSON.stringify(row)
    selectAutoTargets([row], allPass)
    return JSON.stringify(row) === snap
  })())
  check('🔴 [T] 거절 라벨이 "글을 버리지 않는다" 를 말한다',
    REJECT_LABEL.TITLE_COPIES_SOURCE.includes('제목만 다시 지어'))

  // ── ⑧ 연결이 끊기면 빨개진다 ──
  check('🔴 [회귀] 발행 판정이 대조 기록을 실제로 읽는다',
    /sourceTitleCheckOf\(r\.gateResults\)/.test(pubLib)
    && /titleCheck\.checked && titleCheck\.copied && !founderRetitled\(r\)/.test(pubLib))
  check('🔴 [회귀] 러너가 draftTitle·editedTitle 을 넘긴다',
    /draftTitle: r\.draftTitle/.test(RUNNER) && /editedTitle: r\.editedTitle/.test(RUNNER))
  check('🔴 [회귀] 러너가 rawTitle 을 select 하지 않는다', !/rawTitle: true/.test(RUNNER))
  check('🔴 [회귀] 적재기가 세 값을 남긴다',
    /sourceTitleChecked: c\.sourceTitleChecked === true/.test(AUTOFILL)
    && /sourceTitleCopied: c\.sourceTitleCopied === true/.test(AUTOFILL))
  check('🔴 [회귀] 생성기가 메모리에서 대조하고 결과만 싣는다',
    /sourceTitleCopied: copiesSourceTitle\(a\.meta\.title, a\.draft\.title\)/.test(GEN))
  check('🔴 [회귀] 생성기가 원문 제목을 후보 파일에 싣지 않는다',
    !/sourceTitle: a\.meta\.title/.test(GEN))
}



console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
