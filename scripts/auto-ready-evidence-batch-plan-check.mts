#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 증거 배치 검토 — 화면 제출 계획 순수 검사** (DB 0 · 네트워크 0 · 모델 0)
 *
 *   2026-09-27 운영 P0 — 제출 뒤 상태가 그대로라 운영자가 반복 클릭했고, 손대지 않은 행까지 전부
 *   서버로 가 "건너뜀" 만 쌓였다. 화면은 `planBatch` 의 `send` 만 보낸다. 이 검사는 그 계획을 잰다.
 *
 *   반례: 빈 판정 제출 · 손대지 않은 행 · 이미 결정된 행에 결정 칸 · 기록됨 행 재전송 ·
 *         성공 뒤 잠금 · 거절·건너뜀은 잠그지 않음 · 폐기된 행 재폐기(철회) · 묶음 이후 초안 변경(stale)
 *   그리고 화면 소스에 브라우저 기본 확인창이 돌아오지 않았는지 본다.
 *
 *   npm run auto-ready:evidence-plan-check
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  EMPTY_ENTRY, planBatch, canSubmit, editableOf, rowIssue, lockAfter, toneOf, resultLabel, describeSend, canReview, reviewingAfter,
  type Entry, type EvidenceRowState, type RowPhase,
} from '../src/lib/auto-ready-evidence-batch-plan'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}

const st = (queueId: string, phase: RowPhase, o: Partial<EvidenceRowState> = {}): EvidenceRowState => ({
  queueId, phase, status: phase === 'undecided' ? 'PENDING' : 'APPROVED', decidedBy: phase === 'undecided' ? 'machine:auto-draft-v5' : 'founder',
  published: false, outcome: 'noEdit', declineReason: null, mine: null, why: '', ...o,
})
const en = (o: Partial<Entry>): Entry => ({ ...EMPTY_ENTRY, ...o })
const NONE: ReadonlySet<string> = new Set()
const plan = (rows: EvidenceRowState[], entries: Record<string, Entry>, locked: ReadonlySet<string> = NONE) =>
  planBatch(rows.map((r) => r.queueId), new Map(rows.map((r) => [r.queueId, r])), entries, locked)

console.log('\n══ 자동 READY 증거 — 화면 제출 계획 (순수) ══\n')

console.log('1. 🔴 손댄 행만 보낸다')
{
  const rows = [st('a', 'undecided'), st('b', 'undecided'), st('c', 'decided')]
  const p = plan(rows, { a: en({ decision: 'ready', hardDefect: 'no' }), b: EMPTY_ENTRY, c: EMPTY_ENTRY })
  check('🔴 🔴 **세 행 중 하나만 골랐다 → 보내는 행 1 · 고르지 않은 행 2**',
    p.send.length === 1 && p.send[0]?.queueId === 'a' && p.untouched === 2 && p.blocking.length === 0, JSON.stringify(p))
  const none = plan(rows, {})
  check('🔴 아무것도 고르지 않았다 → 보낼 것 0 · CTA 닫힘', none.send.length === 0 && !canSubmit(none))
}

console.log('\n2. 🔴 🔴 빈 판정 — 결정은 골랐는데 중대 결함을 비웠다')
{
  const rows = [st('a', 'undecided'), st('b', 'undecided')]
  const p = plan(rows, { a: en({ decision: 'ready' }), b: en({ decision: 'ready', hardDefect: 'no' }) })
  check('🔴 🔴 **막힌 행 1 · CTA 닫힘 · 막힌 행은 보내는 목록에 없다**',
    p.blocking.length === 1 && p.blocking[0]?.queueId === 'a' && !canSubmit(p) && !p.send.some((s) => s.queueId === 'a'), JSON.stringify(p))
  check('막힘 사유가 행에 보인다', (rowIssue(rows[0], en({ decision: 'ready' }), NONE) ?? '').includes('중대 결함'))
  check('🔴 결함만 고르고 결정을 비운 그림자 → 막힘', plan([st('a', 'undecided')], { a: en({ hardDefect: 'no' }) }).blocking.length === 1)
  check('🔴 폐기인데 사유 없음 → 막힘', plan([st('a', 'undecided')], { a: en({ decision: 'reject', hardDefect: 'no' }) }).blocking.length === 1)
  check('🔴 그대로 + 결함 있음 → 막힘', plan([st('a', 'undecided')], { a: en({ decision: 'ready', hardDefect: 'yes', reasons: '모순' }) }).blocking.length === 1)
  check('🔴 결함 있음인데 근거 없음 → 막힘', plan([st('a', 'undecided')], { a: en({ decision: 'reject', declineReason: 'OTHER', hardDefect: 'yes' }) }).blocking.length === 1)
  check('🔴 근거만 적었다 → 막힘(손댄 행)', plan([st('a', 'decided')], { a: en({ reasons: '메모' }) }).blocking.length === 1)
  const ok = plan([st('a', 'undecided')], { a: en({ decision: 'reject', declineReason: 'OTHER', hardDefect: 'yes', reasons: '생활사 모순\n  \n단정' }) })
  check('폐기 + 사유 + 결함 있음 + 근거 → 보낸다(빈 줄은 버린다)',
    canSubmit(ok) && ok.send[0]?.decision === 'reject' && ok.send[0]?.declineReason === 'OTHER' && ok.send[0]?.reasons.length === 2, JSON.stringify(ok))
}

console.log('\n3. 🔴 🔴 이미 결정된 행 — 결정 칸이 없다 · 다시 폐기하지 않는다')
{
  check('🔴 🔴 **decided → 결함 기록만(decide 아님)**', editableOf(st('a', 'decided'), NONE) === 'record')
  check('🔴 🔴 **undecided 만 결정 칸**', editableOf(st('a', 'undecided'), NONE) === 'decide')
  const p = plan([st('a', 'decided')], { a: en({ decision: 'reject', declineReason: 'OTHER', hardDefect: 'no' }) })
  check('🔴 🔴 **결정된 행에 결정 값이 남아 있어도 보내지 않는다(decision null)**',
    p.send.length === 1 && p.send[0]?.decision === null && p.send[0]?.declineReason === null, JSON.stringify(p))
  // 운영 uili19gp 모양 — 사람이 폐기(DECLINED/OTHER) 한 행
  const declined = st('u', 'decided', { status: 'DECLINED', outcome: 'declined', declineReason: 'OTHER' })
  const pd = plan([declined], { u: en({ hardDefect: 'yes', reasons: '모순', withdraw: true, declineReason: 'OTHER' }) })
  check('🔴 🔴 **폐기된 행(uili19gp 모양) — 철회·사유를 보내지 않는다(재폐기 0)**',
    pd.send.length === 1 && pd.send[0]?.withdraw === false && pd.send[0]?.decision === null && pd.send[0]?.declineReason === null, JSON.stringify(pd))
  const open = st('o', 'decided', { status: 'APPROVED' })
  check('🔴 미발행 승인 + 결함 있음 + 철회 없음 → 막힘', plan([open], { o: en({ hardDefect: 'yes', reasons: 'x' }) }).blocking.length === 1)
  check('🔴 미발행 승인 + 철회 + 사유 없음 → 막힘', plan([open], { o: en({ hardDefect: 'yes', reasons: 'x', withdraw: true }) }).blocking.length === 1)
  const w = plan([open], { o: en({ hardDefect: 'yes', reasons: 'x', withdraw: true, declineReason: 'TOPIC_UNFIT' }) })
  check('미발행 승인 + 철회 + 사유 → 철회를 보낸다', w.send[0]?.withdraw === true && w.send[0]?.declineReason === 'TOPIC_UNFIT', JSON.stringify(w))
  const wn = plan([open], { o: en({ hardDefect: 'no', withdraw: true, declineReason: 'TOPIC_UNFIT' }) })
  check('🔴 결함 없음으로 바꿨는데 철회 체크가 남았다 → 철회를 보내지 않는다', wn.send[0]?.withdraw === false && wn.send[0]?.declineReason === null)
}

console.log('\n4. 🔴 🔴 잠금 — 기록됨 · 성공한 행 · 상태 없음')
{
  const recorded = st('r', 'recorded', { mine: { hardDefect: 'yes', reasons: ['x'], reviewedAt: '2026-09-27T00:00:00Z', bundleDigest: 'd' } })
  const touched = en({ decision: 'reject', declineReason: 'OTHER', hardDefect: 'yes', reasons: 'x' })
  const p = plan([recorded], { r: touched })
  check('🔴 🔴 **이미 내 기록이 있는 행 → 입력 없음 · 보내지 않음**', editableOf(recorded, NONE) === null && p.send.length === 0 && p.locked === 1)
  for (const ph of ['stale', 'missing', 'unsupported'] as const) {
    check(`🔴 ${ph} → 입력 없음 · 보내지 않음`, plan([st('x', ph)], { x: touched }).send.length === 0 && editableOf(st('x', ph), NONE) === null)
  }
  check('🔴 🔴 **서버 상태를 아직 못 읽은 행 → 보내지 않음(fail-closed)**',
    planBatch(['z'], new Map(), { z: touched }, NONE).send.length === 0 && editableOf(undefined, NONE) === null)

  // 부분 성공 — 성공 · 이미 기록 · 거절 · 건너뜀
  const rows = [st('a', 'undecided'), st('b', 'undecided'), st('c', 'undecided'), st('d', 'decided')]
  const entries = {
    a: en({ decision: 'ready', hardDefect: 'no' }), b: en({ decision: 'ready', hardDefect: 'no' }),
    c: en({ decision: 'ready', hardDefect: 'no' }), d: en({ hardDefect: 'no' }),
  }
  const locked = lockAfter(NONE, [
    { queueId: 'a', result: 'decidedAndRecorded', why: '' }, { queueId: 'b', result: 'unchanged', why: '' },
    { queueId: 'c', result: 'reject', why: '묶음을 만든 뒤 DB 초안이 바뀌었다' }, { queueId: 'd', result: 'skip', why: '' },
  ])
  const again = plan(rows, entries, locked)
  check('🔴 🔴 **성공·이미 기록 행은 잠겨 다시 보내지 않는다**', !again.send.some((s) => s.queueId === 'a' || s.queueId === 'b') && again.locked === 2)
  check('🔴 🔴 **거절·건너뜀 행은 잠그지 않는다(고쳐서 다시 보낼 수 있다)**',
    again.send.some((s) => s.queueId === 'c') && again.send.some((s) => s.queueId === 'd'))
  check('🔴 🔴 **더블 클릭 모사 — 첫 결과를 반영한 두 번째 계획은 같은 행을 보내지 않는다**',
    plan([st('a', 'undecided')], { a: entries.a }, lockAfter(NONE, [{ queueId: 'a', result: 'decidedAndRecorded', why: '' }])).send.length === 0)
}

console.log('\n5. 결과 표시 — 성공 · 건너뜀 · 거절')
{
  check('성공 4종', ['recorded', 'decidedAndRecorded', 'withdrawnAndRecorded', 'unchanged'].every((r) => toneOf(r) === '성공'))
  check('건너뜀', toneOf('skip') === '건너뜀')
  check('🔴 모르는 결과는 거절(성공으로 읽지 않는다)', toneOf('reject') === '거절' && toneOf('weird') === '거절')
  check('거절 사유를 그대로 보인다', resultLabel({ queueId: 'x', result: 'reject', why: '묶음을 만든 뒤 DB 초안이 바뀌었다' }).includes('초안이 바뀌었다'))
  check('이미 기록은 "새로 쓰지 않았다" 로 보인다', resultLabel({ queueId: 'x', result: 'unchanged', why: '' }).includes('새로 쓰지 않았습니다'))
  check('확인 단계 문장에 결정·사유·결함이 보인다',
    describeSend({ queueId: 'x', decision: 'reject', declineReason: 'OTHER', hardDefect: 'yes', reasons: ['a'], withdraw: false }) === '결정: 폐기 (기타) · 중대 결함: 있음 · 근거 1줄')
}

console.log('\n5b. 🔴 🔴 재검토 — 내 기록이 있는 행은 기본 잠금 · 재검토를 눌렀을 때만 결함 칸 (2026-09-27 P0 정정)')
{
  const mine = { hardDefect: 'no' as const, reasons: [], reviewedAt: '2026-09-27T00:00:00Z', bundleDigest: 'd' }
  const openRec = st('o', 'recorded', { status: 'APPROVED', mine })
  const declRec = st('x', 'recorded', { status: 'DECLINED', outcome: 'declined', declineReason: 'OTHER', mine })
  const pubRec = st('p', 'recorded', { status: 'PUBLISHED', published: true, mine })
  const R = (...ids: string[]): ReadonlySet<string> => new Set(ids)
  const toYes = en({ hardDefect: 'yes', reasons: '생활사 모순', withdraw: true, declineReason: 'TOPIC_UNFIT' })

  check('🔴 🔴 **재검토 전 — 입력 없음 · 재검토 버튼 있음**', editableOf(openRec, NONE, NONE) === null && canReview(openRec, NONE))
  const noPress = planBatch(['o'], new Map([['o', openRec]]), { o: toYes }, NONE, NONE)
  check('🔴 🔴 **재검토를 누르지 않은 기록 행 → 보내는 행 0 (입력이 남아 있어도)**', noPress.send.length === 0 && noPress.locked === 1, JSON.stringify(noPress))
  check('🔴 🔴 **재검토 중 → 결함 기록(record)만 · 결정 칸(decide) 아님 · 버튼 숨김**',
    editableOf(openRec, NONE, R('o')) === 'record' && !canReview(openRec, R('o')))
  check('🔴 🔴 **이번 화면에서 성공해 잠긴 행도 재검토를 누르면 열린다**', editableOf(openRec, R('o'), R('o')) === 'record')
  check('🔴 재검토는 recorded 에서만 — undecided · stale 에 재검토 표시가 있어도 결정 전은 decide · stale 은 닫힘',
    editableOf(st('u', 'undecided'), NONE, R('u')) === 'decide' && editableOf(st('s', 'stale'), NONE, R('s')) === null && !canReview(st('u', 'undecided'), NONE))
  const withDecision = planBatch(['o'], new Map([['o', openRec]]), { o: en({ decision: 'reject', declineReason: 'OTHER', hardDefect: 'no' }) }, NONE, R('o'))
  check('🔴 🔴 **재검토 중 결정 값이 남아 있어도 보내지 않는다(decision null)**', withDecision.send[0]?.decision === null && withDecision.send[0]?.declineReason === null, JSON.stringify(withDecision))

  const noToYes = planBatch(['o'], new Map([['o', openRec]]), { o: toYes }, NONE, R('o'))
  check('🔴 🔴 **미발행 승인 no → yes + 철회 + 사유 + 근거 → 철회와 함께 보낸다**',
    noToYes.send.length === 1 && noToYes.send[0]?.withdraw === true && noToYes.send[0]?.declineReason === 'TOPIC_UNFIT' && noToYes.send[0]?.hardDefect === 'yes', JSON.stringify(noToYes))
  for (const [label, e] of [
    ['철회 없음', en({ hardDefect: 'yes', reasons: '모순', declineReason: 'TOPIC_UNFIT' })],
    ['사유 없음', en({ hardDefect: 'yes', reasons: '모순', withdraw: true })],
    ['근거 없음', en({ hardDefect: 'yes', withdraw: true, declineReason: 'TOPIC_UNFIT' })],
  ] as const) {
    const p = planBatch(['o'], new Map([['o', openRec]]), { o: e }, NONE, R('o'))
    check(`🔴 🔴 **미발행 승인 no → yes · ${label} → 막힘 · 보내는 행 0**`, p.send.length === 0 && p.blocking.length === 1 && !canSubmit(p), JSON.stringify(p))
  }
  const declYes = planBatch(['x'], new Map([['x', declRec]]), { x: toYes }, NONE, R('x'))
  check('🔴 🔴 **이미 폐기된 행 재검토 → 판정만 · 철회·폐기 사유는 보내지 않는다(재폐기 0)**',
    declYes.send[0]?.withdraw === false && declYes.send[0]?.declineReason === null && declYes.send[0]?.hardDefect === 'yes')
  const pubYes = planBatch(['p'], new Map([['p', pubRec]]), { p: en({ hardDefect: 'yes', reasons: '사후', withdraw: true, declineReason: 'OTHER' }) }, NONE, R('p'))
  check('🔴 🔴 **발행된 행 재검토 → 사후 판정만 · 철회 0**', pubYes.send[0]?.withdraw === false && pubYes.send[0]?.hardDefect === 'yes')
  const yesToNo = planBatch(['x'], new Map([['x', { ...declRec, mine: { ...mine, hardDefect: 'yes' as const } }]]), { x: en({ hardDefect: 'no' }) }, NONE, R('x'))
  check('yes → no 재검토 → no 로 보낸다', yesToNo.send[0]?.hardDefect === 'no' && yesToNo.send[0]?.withdraw === false)

  const after = reviewingAfter(R('o', 'x'), [{ queueId: 'o', result: 'withdrawnAndRecorded', why: '' }, { queueId: 'x', result: 'reject', why: '' }])
  check('🔴 🔴 **성공한 재검토는 닫힌다(다시 잠금) · 거절은 열린 채로 남는다**', !after.has('o') && after.has('x'))
  check('🔴 🔴 **unchanged 도 성공 — 재검토가 닫힌다**', !reviewingAfter(R('o'), [{ queueId: 'o', result: 'unchanged', why: '' }]).has('o'))
  check('🔴 🔴 **다시 잠긴 뒤 계획 — 보내는 행 0 · 재검토 버튼 다시 보임**',
    planBatch(['o'], new Map([['o', openRec]]), { o: toYes }, R('o'), after).send.length === 0 && canReview(openRec, after))
}

console.log('\n6. 🔴 화면 소스 — 브라우저 기본 확인창 0 · 계획의 send 만 보낸다')
{
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/components/admin/EvidenceBatchReview.tsx'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  check('🔴 🔴 **window.confirm · confirm( 호출 0**', !/\bconfirm\s*\(/.test(code) && !/window\s*\.\s*confirm/.test(code))
  check('🔴 🔴 **제출 payload 는 확인 단계 스냅샷의 send 하나**',
    /submitEvidenceBatch\(\{\s*bundleText,\s*entries:\s*confirmed\.send\s*\}\)/.test(code) && (code.match(/submitEvidenceBatch\(/g) ?? []).length === 1)
  check('🔴 결정 칸은 decide 행에서만 그린다', /ed === 'decide' &&/.test(code) && !/ed !== 'record' &&/.test(code))
  check('🔴 🔴 **재검토 버튼은 canReview 로만 · 계획에 reviewing 을 넘긴다**',
    /canReview\(s, reviewing\) &&/.test(code) && /planBatch\(queueIds, states, entries, locked, reviewing\)/.test(code)
    && /editableOf\(s, locked, reviewing\)/.test(code) && /setReviewing\(\(prev\) => reviewingAfter\(prev, rs\)\)/.test(code))
  check('🔴 보내는 중 ref 잠금', /inFlight\.current\) return/.test(code) || /inFlight\.current\)\s*return/.test(code))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)
