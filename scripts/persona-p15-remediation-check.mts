#!/usr/bin/env tsx
/** P15 정본 교정 판정 검사 — 🔴 순수 함수만. DB 0 */
import { digestOf, judgeRemediationOutcome, planRemediation, type PlanInput, type RemediationPins } from './lib/persona-p15-remediation.mjs'

let pass = 0; let fail = 0
const check = (label: string, ok: boolean, d = ''): void => { if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${d ? ` — ${d}` : ''}`) } }

const before = { a: 1, workStatus: '옛값', z: ['x'] }
const after = { ...before, workStatus: '정본값' }
const PINS: RemediationPins = { code: 'P15', beforeIdentityDigest: digestOf(before), beforeUpdatedAt: '2026-10-01T15:44:37.757Z', afterIdentityDigest: digestOf(after) }
const base = (): PlanInput => ({
  pins: PINS, row: { identity: { ...before }, updatedAt: PINS.beforeUpdatedAt, status: 'active' },
  cardValue: '정본값', problemsBefore: ['workStatus 가 정본과 다르다 (정본 정본값)'], problemsAfter: [],
})
const want = (label: string, patch: Partial<PlanInput>, code: string): void => {
  const p = planRemediation({ ...base(), ...patch }); check(`${label} → ${code}`, p.code === code, `got ${p.code}`)
}

console.log('\n① 계획')
{ const p = planRemediation(base()); check('정확한 이전 값 → APPLY · workStatus 만 바뀐다', p.ok && p.code === 'APPLY' && digestOf(p.after) === PINS.afterIdentityDigest && digestOf({ ...p.after, workStatus: '옛값' }) === digestOf(before)) }
want('이미 교정됨(멱등)', { row: { identity: { ...after }, updatedAt: '2026-11-16T00:00:00.000Z', status: 'active' } }, 'ALREADY_APPLIED')
want('행 없음', { row: null }, 'NOT_FOUND')
want('이전 값 불일치(다른 칸이 바뀜)', { row: { identity: { ...before, a: 2 }, updatedAt: PINS.beforeUpdatedAt, status: 'active' } }, 'BEFORE_DIGEST_MISMATCH')
want('이전 값 불일치(workStatus 가 제3의 값)', { row: { identity: { ...before, workStatus: '다른값' }, updatedAt: PINS.beforeUpdatedAt, status: 'active' } }, 'BEFORE_DIGEST_MISMATCH')
want('동시성 — updatedAt 이 바뀜', { row: { identity: { ...before }, updatedAt: '2026-11-15T00:00:00.000Z', status: 'active' } }, 'BEFORE_UPDATED_AT_MISMATCH')
want('paused 는 교정하지 않는다', { row: { identity: { ...before }, updatedAt: PINS.beforeUpdatedAt, status: 'paused' } }, 'STATUS')
want('identity 모양 오류', { row: { identity: null, updatedAt: PINS.beforeUpdatedAt, status: 'active' } }, 'IDENTITY_SHAPE')
want('정본 카드 판독 실패', { cardValue: null }, 'CARD_UNREADABLE')
want('정본 대조 실패', { problemsBefore: null }, 'VERIFY_UNREADABLE')
want('교정 전 문제 2건(다른 축도 틀림)', { problemsBefore: ['workStatus 가 …', 'housing 가 …'] }, 'PROBLEMS_NOT_EXACT')
want('교정 전 문제가 다른 축 1건', { problemsBefore: ['housing 가 정본과 다르다'] }, 'PROBLEMS_NOT_EXACT')
want('교정 전 문제 0건', { problemsBefore: [] }, 'PROBLEMS_NOT_EXACT')
want('정본 카드 값이 바뀜(after digest 불일치)', { cardValue: '또다른값' }, 'AFTER_DIGEST_MISMATCH')
want('교정본에도 문제가 남음', { problemsAfter: ['x'] }, 'AFTER_NOT_CLEAN')
{
  const empty = { ...before, workStatus: '' }
  const p = planRemediation({ ...base(), pins: { ...PINS, beforeIdentityDigest: digestOf(empty) }, row: { identity: empty, updatedAt: PINS.beforeUpdatedAt, status: 'active' } })
  check('빈 칸 채우기는 하지 않는다(nonempty 만 교정) → FIELD_EMPTY', p.code === 'FIELD_EMPTY', `got ${p.code}`)
}

console.log('\n② 사후 판정 — 정확히 +1 · 다른 Persona diff 0')
const ok = { capacityBefore: { contractValid: 39, stageActive: 39 }, capacityAfter: { contractValid: 40, stageActive: 40 }, othersBefore: 'h', othersAfter: 'h' }
check('39→40 · 39→40 · 다른 지문 동일 → PASS', judgeRemediationOutcome(ok).code === 'PASS')
for (const [label, patch] of [
  ['contract 39→39', { capacityAfter: { contractValid: 39, stageActive: 40 } }],
  ['stage 39→39', { capacityAfter: { contractValid: 40, stageActive: 39 } }],
  ['contract 39→41', { capacityAfter: { contractValid: 41, stageActive: 40 } }],
  ['교정 후 판독 실패', { capacityAfter: { contractValid: null, stageActive: null } }],
  ['교정 전 판독 실패', { capacityBefore: { contractValid: null, stageActive: 39 } }],
  ['다른 Persona 지문 바뀜', { othersAfter: 'x' }],
] as const) check(`${label} → ROLLBACK`, judgeRemediationOutcome({ ...ok, ...patch }).code === 'ROLLBACK')

console.log(`\n결과: ${pass} 통과 · ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
