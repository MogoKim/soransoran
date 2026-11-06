/**
 * 🔴 **StageDecision v6 reader 검사** (2026-11-06 · 두 릴리스의 첫 번째 — reader 먼저, writer 는 v5 그대로)
 *
 *    v6 = admission 계약 판이다(공급·READY 예측은 hard gate 가 아니라 경고 — canon §3.1·§3.2). release(증명) 계약은
 *    바뀌지 않았으므로 v5 증거는 v6 아래에서도 현재 계열이다. legacy 는 v4 하나뿐이다.
 *
 *    ① 판 집합 — writer v5 · reader v4/v5/v6 · 모르는 판 거절
 *    ② legacy 승격 금지 — v4 만 legacy · v5/v6 은 현재 계열
 *    ③ v6 만 예측 경고(`supply.forecastWarnings`)를 싣는다 — 닫힌 enum · 중복 금지 · v4/v5 소급 금지
 *    ④ v6 도 v5 와 같은 구조 규칙(SUSTAIN 금지 · CERTIFIED 허용 · TRIAL fatal block)
 *    ⑤ 경고 enum 은 preflight 의 예측 코드만 — hard gate 코드가 섞이지 않는다
 *    ⑥ rollback 호환 — writer 가 아직 v5 를 쓰므로 이 reader 를 되돌려도 옛 reader 가 모든 새 행을 읽는다
 *
 *    🔴 DB · 네트워크 · 파일 write 0.
 */
import { readFileSync } from 'node:fs'
import {
  validateStoredDecision, isLegacyDecision, STAGE_DECISION_VERSION, STAGE_DECISION_READER_VERSIONS,
  LEGACY_STAGE_DECISION_VERSIONS, FORECAST_WARNING_CODES, DECISION_WRITER,
} from '../src/lib/stage-decision-contract'
import { PREFLIGHT_CODES } from '../src/lib/stage-ladder-generic'
import { planStageDecision, safestDecision } from '../src/lib/stage-ladder'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail !== '' ? ` — ${detail}` : ''}`)
}

const D = '2026-11-07'
const row = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  kstDate: D, capacity: 'd30', release: 'd20', state: 'PREPARE', reasons: [], blocks: [], dayPinned: true,
  supply: { eligibleSpeakers: 40, excluded: [] }, decidedAt: '2026-11-06T22:55:00.000Z',
  contractVersion: STAGE_DECISION_VERSION, decidedBy: DECISION_WRITER, transition: null, ...o,
})
const v = (o: Record<string, unknown>): ReturnType<typeof validateStoredDecision> => validateStoredDecision({ row: row(o), expectKstDate: D })
const okOf = (o: Record<string, unknown>): boolean => v(o).ok
const v6supply = (warnings: unknown): Record<string, unknown> => ({ eligibleSpeakers: 40, excluded: [], forecastWarnings: warnings })
const trial = { kind: 'TRIAL', trialBase: 'd10', previousKstDate: '2026-11-06', target: 'd20', basis: 'PASS' }

console.log('\n① 판 집합')
check('🔴 writer 판은 그대로 v5 다 (reader 릴리스는 쓰기를 바꾸지 않는다)', STAGE_DECISION_VERSION === 'stage-decision-v5')
check('reader 판은 v5 · v6 (+ legacy v4)',
  JSON.stringify(STAGE_DECISION_READER_VERSIONS) === JSON.stringify(['stage-decision-v5', 'stage-decision-v6'])
  && JSON.stringify(LEGACY_STAGE_DECISION_VERSIONS) === JSON.stringify(['stage-decision-v4']))
check('v5 행을 읽는다', okOf({}))
check('🟢 v6 행을 읽는다', okOf({ contractVersion: 'stage-decision-v6', supply: v6supply([]) }))
check('v4 행을 읽는다(legacy)', okOf({ contractVersion: 'stage-decision-v4' }))
check('🔴 모르는 판(v7 · v3)은 거절한다', !okOf({ contractVersion: 'stage-decision-v7' }) && !okOf({ contractVersion: 'stage-decision-v3' }))

console.log('\n② legacy 승격 금지 — v4 만 legacy')
check('🔴 v4 는 legacy 다', isLegacyDecision({ contractVersion: 'stage-decision-v4' }))
check('🔴 v5 는 v6 reader 아래에서도 legacy 가 아니다 (admission 판 변경이 release 증거를 지우지 않는다)',
  !isLegacyDecision({ contractVersion: 'stage-decision-v5' }))
check('🔴 v6 는 legacy 가 아니다 — writer 를 되돌려도 v6 행의 인증이 바닥으로 떨어지지 않는다',
  !isLegacyDecision({ contractVersion: 'stage-decision-v6' }))
check('🔴 모르는 판은 legacy 로 구제하지도 현재로 승격하지도 않는다 — validator 가 먼저 거절한다',
  !okOf({ contractVersion: 'stage-decision-v9' }))

console.log('\n③ 예측 경고 — v6 만 · 닫힌 enum')
check('🟢 v6 TRIAL 은 예측 경고가 있어도 유효하다 (경고는 시험을 막지 않는다)',
  okOf({ contractVersion: 'stage-decision-v6', state: 'TRIAL', release: 'd20', capacity: 'd30', transition: trial,
    supply: v6supply(['THROUGHPUT_SHORT', 'OPPORTUNITY_UNKNOWN']) }))
check('🔴 v6 supply 객체에 `forecastWarnings` 키가 없으면 거절한다',
  !okOf({ contractVersion: 'stage-decision-v6', supply: { eligibleSpeakers: 40, excluded: [] } }))
check('v6 supply 가 null 이면 경고도 없다(그대로 읽는다)', okOf({ contractVersion: 'stage-decision-v6', supply: null }))
check('🔴 모르는 경고 코드를 거절한다', !okOf({ contractVersion: 'stage-decision-v6', supply: v6supply(['MADE_UP']) }))
check('🔴 hard gate 코드를 경고로 싣지 못한다', !okOf({ contractVersion: 'stage-decision-v6', supply: v6supply(['PERSONA_SHORT']) }))
check('🔴 같은 경고를 두 번 싣지 못한다', !okOf({ contractVersion: 'stage-decision-v6', supply: v6supply(['THROUGHPUT_SHORT', 'THROUGHPUT_SHORT']) }))
check('경고가 배열이 아니면 거절한다', !okOf({ contractVersion: 'stage-decision-v6', supply: v6supply('THROUGHPUT_SHORT') }))
check('🔴 v5 행에 경고를 붙여 소급하지 못한다', !okOf({ supply: v6supply(['THROUGHPUT_SHORT']) }))
check('🔴 v4 행에 경고를 붙여 소급하지 못한다', !okOf({ contractVersion: 'stage-decision-v4', supply: v6supply([]) }))
{
  const r = v({ contractVersion: 'stage-decision-v6', supply: v6supply(['THROUGHPUT_SHORT']) })
  check('검증된 v6 결정이 경고를 손실 없이 담는다',
    r.ok && r.decision.supply !== null && JSON.stringify(r.decision.supply.forecastWarnings) === '["THROUGHPUT_SHORT"]')
  check('검증된 v5 결정에는 경고 칸이 없다', (() => { const x = v({}); return x.ok && x.decision.supply !== null && !('forecastWarnings' in x.decision.supply) })())
}

console.log('\n④ v6 도 v5 구조 규칙을 그대로 받는다')
check('🔴 v6 SUSTAIN 거절', !okOf({ contractVersion: 'stage-decision-v6', supply: null, state: 'SUSTAIN', release: 'd20', transition: { kind: 'SUSTAIN', from: 'd10', to: 'd20' } }))
check('🟢 v6 CERTIFIED HOLD/PREPARE 허용', okOf({ contractVersion: 'stage-decision-v6', supply: null, release: 'd10', capacity: 'd20', transition: { kind: 'CERTIFIED', certified: 'd20' } }))
check('🔴 v6 TRIAL 에 fatal block(PREFLIGHT_FAIL)이 있으면 거절',
  !okOf({ contractVersion: 'stage-decision-v6', supply: null, state: 'TRIAL', release: 'd20', capacity: 'd30', transition: trial,
    blocks: [{ code: 'PREFLIGHT_FAIL', reason: 'x' }] }))
check('🔴 v4 CERTIFIED 는 여전히 거절', !okOf({ contractVersion: 'stage-decision-v4', supply: null, release: 'd10', capacity: 'd20', transition: { kind: 'CERTIFIED', certified: 'd20' } }))

console.log('\n⑤ 경고 enum 은 예측 코드만')
const pre = PREFLIGHT_CODES as readonly string[]
check('경고 코드는 전부 preflight 코드다', FORECAST_WARNING_CODES.every((c) => pre.includes(c)))
check('🔴 경고 enum 은 정확히 원천 기회·처리량·READY 필요량 예측 다섯이다',
  JSON.stringify([...FORECAST_WARNING_CODES].sort()) === JSON.stringify(
    ['OPPORTUNITY_SHORT', 'OPPORTUNITY_UNKNOWN', 'READY_REQUIREMENT_UNKNOWN', 'THROUGHPUT_SHORT', 'THROUGHPUT_UNKNOWN']))

console.log('\n⑥ rollback 호환 — 이 릴리스의 writer 는 v5 만 쓴다')
{
  const d = planStageDecision({
    kstDate: D, sustainedRelease: 'd10', previousDecision: null, nextPreflight: null, publishedToday: 0,
    supply: { eligibleSpeakers: 40, excluded: [] }, decidedAt: '2026-11-06T22:55:00.000Z',
  })
  const s = safestDecision(D, '2026-11-06T22:55:00.000Z')
  check('🔴 사다리·안전 결정이 쓰는 판은 v5 이고 경고 칸이 없다',
    d.contractVersion === 'stage-decision-v5' && s.contractVersion === 'stage-decision-v5'
    && (d.supply === null || !('forecastWarnings' in d.supply)))
  const controller = readFileSync('src/lib/stage-controller.ts', 'utf8')
  const ladder = readFileSync('src/lib/stage-ladder.ts', 'utf8')
  check('🔴 writer 경로에 v6 문자열이 없다 (reader 먼저 · writer 는 별도 릴리스)',
    !controller.includes('stage-decision-v6') && !ladder.includes('stage-decision-v6')
    && !/STAGE_DECISION_READER_VERSIONS/.test(controller + ladder))
}

console.log(`\nStageDecision v6 reader 검사: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
