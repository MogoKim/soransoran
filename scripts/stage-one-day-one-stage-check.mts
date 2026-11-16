/**
 * 🔴 **하루 = 결정 하나 = 단계 하나 — 반례 검사** (2026-11-06 · canon §1.1 · §6)
 *
 *    KST 하루에는 create-only StageDecision 하나 · 공개 단계 하나 · 정확 N 증명 최대 한 번이다.
 *    PASS 가 실제로 확정된 뒤 다음 단계는 **다음 KST 운영일**의 첫 슬롯 전 결정으로만 열린다.
 *
 *    ① 저장 모델이 하루 하나를 강제한다(`kstDate @id`)
 *    ② 다음 단계 TRIAL 은 전날 결정에만 이어진다 — 같은 날짜를 기반으로 한 TRIAL 은 validator 가 거절한다
 *    ③ 정확 N 번째 글은 아래 단계의 마지막 슬롯에서야 생긴다 — 그 전에는 PASS 가 없다. 인접 다음 단계 프로필
 *       (D20→D30 · D30→D50)에는 그보다 늦은 예약 슬롯이 0 이다(첫 댓글이 즉시 달려도 같다). D100 은 runtime
 *       profile 에 배선되지 않아 이 비교 대상이 아니다
 *    ④ `LATE_START` 는 그대로다 — 프로필 슬롯이 정확히 N 개라 첫 슬롯이 지나면 남은 슬롯은 언제나 N 미만이다
 *       ("남은 N 슬롯" 으로 바꿔도 결코 참이 되지 않는다 · 조각 하루 증명 없음)
 *
 *    🔴 DB · 네트워크 · 파일 write 0.
 */
import { readFileSync } from 'node:fs'
import { validateStoredDecision, previousKstDate, STAGE_DECISION_VERSION, DECISION_WRITER } from '../src/lib/stage-decision-contract'
import { lateStartBlocks, firstSlotOn, slotTimesOn } from '../src/lib/stage-ladder-generic'
import { profileOf, RUNTIME_STAGES, type RuntimeStage } from '../src/lib/scale-profile'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail !== '' ? ` — ${detail}` : ''}`)
}

const X = '2026-11-08' // D20 증명일
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

console.log('\n③ 아래 단계 마지막 슬롯(정확 N 번째 글) 뒤에 다음 단계 예약 슬롯이 없다')
{
  /** 🔴 KST 시:분 라벨 — 펼친 실제 시각에서 뽑는다 */
  const hhmm = (d: Date): string => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(11, 16)
  check('🔴 D100 은 runtime profile 이 아니다 — 이 시간 비교는 runtime 단계끼리만 한다',
    !(RUNTIME_STAGES as readonly string[]).includes('d100'))
  for (const [lower, next] of [['d20', 'd30'], ['d30', 'd50']] as const satisfies readonly (readonly [RuntimeStage, RuntimeStage])[]) {
    // 🔴 `slotTimesOn` 은 `Slot.count` 를 펼친 오름차순 시각이다 — 한 슬롯에 여러 건이 묶여도 N 번째 글 시각이 맞다
    const lowerTimes = slotTimesOn(X, profileOf(lower))
    const n = profileOf(lower).dailyTarget
    const nth = lowerTimes[n - 1]
    const lowerLast = lowerTimes[lowerTimes.length - 1]
    const after = slotTimesOn(X, profileOf(next)).filter((d) => lowerLast !== undefined && d.getTime() > lowerLast.getTime())
    check(`🔴 ${lower}: 펼친 슬롯이 정확히 N(${n}) 개이고 N 번째 글 시각 = 마지막 슬롯 ${lowerLast === undefined ? '?' : hhmm(lowerLast)} — 그 전에는 PASS 가 없다`,
      lowerTimes.length === n && nth !== undefined && lowerLast !== undefined && nth.getTime() === lowerLast.getTime())
    check(`🔴 ${lower}→${next}: ${lowerLast === undefined ? '?' : hhmm(lowerLast)} 뒤 ${next} 예약 슬롯 ${after.length} 개 — 첫 댓글이 즉시 달려도 같은 날 ${next} 증명 자리는 0`,
      lowerLast !== undefined && after.length === 0, after.map(hhmm).join(','))
  }
}

console.log('\n④ LATE_START 는 첫 슬롯 기준 그대로 — 조각 하루 증명 없음')
for (const stage of ['d20', 'd30', 'd50'] as const satisfies readonly RuntimeStage[]) {
  const p = profileOf(stage)
  const first = firstSlotOn(X, p)!
  const before = new Date(first.getTime() - 5 * 60_000).toISOString()
  const after = new Date(first.getTime() + 60_000).toISOString()
  check(`${stage}: 첫 슬롯 전 결정이면 LATE_START 없음`, lateStartBlocks({ target: stage, kstDate: X, runAt: before }).length === 0)
  check(`🔴 ${stage}: 첫 슬롯 뒤 결정이면 LATE_START`,
    lateStartBlocks({ target: stage, kstDate: X, runAt: after }).some((b) => b.code === 'LATE_START'))
  const remaining = slotTimesOn(X, p).filter((d) => d.getTime() > first.getTime()).length
  check(`🔴 ${stage}: 프로필 슬롯은 정확히 N(${p.dailyTarget}) 개 — 첫 슬롯이 지나면 남은 슬롯 ${remaining} < N ("남은 N 슬롯" 은 결코 참이 아니다)`,
    slotTimesOn(X, p).length === p.dailyTarget && remaining < p.dailyTarget)
}

console.log(`\n하루 하나의 단계 검사: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
