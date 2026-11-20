/**
 * 🔴 **하루 = 결정 하나 = 단계 하나 — 반례 검사** (canon §1.1 · §6)
 *
 *    KST 하루에는 create-only StageDecision 하나 · 공개 단계 하나다. 올림은 **다음 KST 운영일**의 결정으로만 열린다.
 *
 *    ① 저장 모델이 하루 하나를 강제한다(`kstDate @id`)
 *    ② 올린 날의 행(`TRIAL`)은 전날 결정에만 이어진다 — 같은 날짜를 기반으로 한 행은 validator 가 거절한다
 *
 *    🔴 DB · 네트워크 · 파일 write 0.
 */
import { readFileSync } from 'node:fs'
import { validateStoredDecision, previousKstDate, STAGE_DECISION_VERSION, DECISION_WRITER } from '../src/lib/stage-decision-contract'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail !== '' ? ` — ${detail}` : ''}`)
}

const X = '2026-11-08'
const NEXT = '2026-11-09'

console.log('\n① 저장 모델 — 하루 하나')
{
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const model = schema.match(/\nmodel StageDecision \{([\s\S]*?)\n\}/)?.[1] ?? ''
  check('🔴 StageDecision 기본키는 kstDate 하나다 — 같은 날 두 번째 결정(두 번째 단계)을 DB 가 막는다',
    /kstDate\s+String\s+@id/.test(model) && !/@@unique\(/.test(model) && !/@@id\(/.test(model))
}

console.log('\n② 다음 단계 TRIAL 은 전날 결정에만 이어진다')
{
  const trial30 = (kstDate: string, baseDate: string): Record<string, unknown> => ({
    kstDate, capacity: 'd50', release: 'd30', state: 'TRIAL', reasons: [], blocks: [], dayPinned: true, supply: null,
    // 🔴 그 KST 날짜 07:55 — 결정 시각은 언제나 유효하게 둔다. 거절은 오직 기반 날짜 연결에서 나와야 한다
    decidedAt: `${previousKstDate(kstDate)}T22:55:00.000Z`,
    contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER,
    transition: { kind: 'TRIAL', trialBase: 'd20', previousKstDate: baseDate, target: 'd30', basis: 'PASS' },
  })
  const sameDay = validateStoredDecision({ row: trial30(X, X), expectKstDate: X })
  check('🔴 반례: D20 증명일과 같은 날짜에 D20 을 기반으로 한 D30 TRIAL 은 거절된다 — 사유는 기반 날짜가 직전 날짜가 아님',
    !sameDay.ok && sameDay.reason.includes('이전 결정 날짜'), sameDay.ok ? '🔴 통과해 버림' : sameDay.reason)
  const nextDay = validateStoredDecision({ row: trial30(NEXT, X), expectKstDate: NEXT })
  check('🟢 다음 KST 날짜의 D30 TRIAL(기반 = 전날 D20 결정)은 유효하다',
    nextDay.ok, nextDay.ok ? '' : nextDay.reason)
}

console.log(`\n하루 하나의 단계 검사: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
