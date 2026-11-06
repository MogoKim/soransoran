/**
 * 🔴 **StageDecision v6 reader 검사** (2026-11-06 · 두 릴리스의 첫 번째 — reader 먼저, writer 는 v5 그대로)
 *
 *    v6 = admission 계약 판이다(공급·READY 예측은 hard gate 가 아니라 경고 — canon §3.1·§3.2). release(증명) 계약은
 *    바뀌지 않았으므로 v5 증거는 v6 아래에서도 현재 계열이다. legacy 는 v4 하나뿐이다.
 *
 *    ① 판 상수 — v4·v5·v6 는 고정 이름 · writer alias 는 v5 · reader 목록은 writer alias 와 독립
 *    ② legacy 승격 금지 — v4 만 legacy · v5/v6 은 현재 계열
 *    ③ 판별 supply 모양 — v4/v5: null | {eligibleSpeakers, excluded} · v6: null | 정확히 {forecastWarnings}
 *       (운영 결정은 supply 를 채우지 않는다 — eligibleSpeakers 를 지어내지 않는다) · 판을 가로지른 모양은 거절
 *    ④ v6 도 v5 와 같은 구조 규칙(SUSTAIN 금지 · CERTIFIED 허용 · TRIAL fatal block)
 *    ⑤ 경고 enum 은 preflight 의 예측 코드만 — hard gate 코드가 섞이지 않는다
 *    ⑥ rollback 호환 — writer 가 아직 v5 를 쓰므로 이 reader 를 되돌려도 옛 reader 가 모든 새 행을 읽는다
 *
 *    🔴 DB · 네트워크 · 파일 write 0.
 */
import { readFileSync } from 'node:fs'
import {
  validateStoredDecision, isLegacyDecision, STAGE_DECISION_VERSION, STAGE_DECISION_READER_VERSIONS,
  STAGE_DECISION_V4, STAGE_DECISION_V5, STAGE_DECISION_V6,
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
const LEGACY_SUPPLY = { eligibleSpeakers: 40, excluded: [] }
const row = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  kstDate: D, capacity: 'd30', release: 'd20', state: 'PREPARE', reasons: [], blocks: [], dayPinned: true,
  supply: LEGACY_SUPPLY, decidedAt: '2026-11-06T22:55:00.000Z',
  contractVersion: STAGE_DECISION_V5, decidedBy: DECISION_WRITER, transition: null, ...o,
})
const v = (o: Record<string, unknown>): ReturnType<typeof validateStoredDecision> => validateStoredDecision({ row: row(o), expectKstDate: D })
const okOf = (o: Record<string, unknown>): boolean => v(o).ok
const v6 = (supply: unknown, o: Record<string, unknown> = {}): Record<string, unknown> => ({ contractVersion: STAGE_DECISION_V6, supply, ...o })
const fw = (warnings: unknown): Record<string, unknown> => ({ forecastWarnings: warnings })
const trial = { kind: 'TRIAL', trialBase: 'd10', previousKstDate: '2026-11-06', target: 'd20', basis: 'PASS' }

console.log('\n① 판 상수 — reader 목록은 writer alias 와 독립')
check('판 상수는 고정 문자열이다',
  STAGE_DECISION_V4 === 'stage-decision-v4' && STAGE_DECISION_V5 === 'stage-decision-v5' && STAGE_DECISION_V6 === 'stage-decision-v6')
check('🔴 writer alias 는 그대로 v5 다 (reader 릴리스는 쓰기를 바꾸지 않는다)', STAGE_DECISION_VERSION === STAGE_DECISION_V5)
check('reader 판은 v5 · v6 (+ legacy v4)',
  JSON.stringify(STAGE_DECISION_READER_VERSIONS) === JSON.stringify(['stage-decision-v5', 'stage-decision-v6'])
  && JSON.stringify(LEGACY_STAGE_DECISION_VERSIONS) === JSON.stringify(['stage-decision-v4']))
{
  /**
   * 🔴 **writer 를 v6 으로 뒤집어도 v5 가 남는가** — reader 목록 정의가 writer alias 를 참조하면 뒤집는 날
   *    `[v6, v6]` 이 되어 전날 v5 행이 PREVIOUS_BROKEN 으로 멈춘다. 정의 식을 직접 본다.
   */
  const src = readFileSync('src/lib/stage-decision-contract.ts', 'utf8')
  const def = /export const STAGE_DECISION_READER_VERSIONS\s*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? ''
  const legacyDef = /export const LEGACY_STAGE_DECISION_VERSIONS\s*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? ''
  check('🔴 reader · legacy 목록 정의가 writer alias(`STAGE_DECISION_VERSION`)를 참조하지 않는다',
    def !== '' && legacyDef !== '' && !/STAGE_DECISION_VERSION\b/.test(def + legacyDef), `${def} | ${legacyDef}`)
  check('🔴 reader 목록이 v5 · v6 고정 상수로 정의된다',
    /STAGE_DECISION_V5/.test(def) && /STAGE_DECISION_V6/.test(def))
  const flipped: string = STAGE_DECISION_V6 // 개념상 다음 writer
  check('🔴 개념상 writer 를 v6 으로 뒤집어도 v5 · v6 둘 다 reader 다',
    flipped !== (STAGE_DECISION_V5 as string)
    && (STAGE_DECISION_READER_VERSIONS as readonly string[]).includes(STAGE_DECISION_V5)
    && (STAGE_DECISION_READER_VERSIONS as readonly string[]).includes(flipped))
}
check('v5 행을 읽는다', okOf({}))
check('🟢 v6 행을 읽는다', okOf(v6(fw([]))))
check('v4 행을 읽는다(legacy)', okOf({ contractVersion: STAGE_DECISION_V4 }))
check('🔴 모르는 판(v7 · v3)은 거절한다', !okOf({ contractVersion: 'stage-decision-v7' }) && !okOf({ contractVersion: 'stage-decision-v3' }))

console.log('\n② legacy 승격 금지 — v4 만 legacy')
check('🔴 v4 는 legacy 다', isLegacyDecision({ contractVersion: STAGE_DECISION_V4 }))
check('🔴 v5 는 v6 reader 아래에서도 legacy 가 아니다 (admission 판 변경이 release 증거를 지우지 않는다)',
  !isLegacyDecision({ contractVersion: STAGE_DECISION_V5 }))
check('🔴 v6 는 legacy 가 아니다 — writer 를 되돌려도 v6 행의 인증이 바닥으로 떨어지지 않는다',
  !isLegacyDecision({ contractVersion: STAGE_DECISION_V6 }))
check('🔴 모르는 판은 legacy 로 구제하지도 현재로 승격하지도 않는다 — validator 가 먼저 거절한다',
  !okOf({ contractVersion: 'stage-decision-v9' }))

console.log('\n③ 판별 supply 모양')
check('🟢 v6 supply null = 그날 preflight 를 평가하지 않았다', okOf(v6(null)))
check('🟢 v6 supply `{forecastWarnings: []}` = 평가했고 예측 경고 없음', okOf(v6(fw([]))))
check('🟢 v6 TRIAL 은 예측 경고가 있어도 유효하다 (경고는 시험을 막지 않는다)',
  okOf(v6(fw(['THROUGHPUT_SHORT', 'OPPORTUNITY_UNKNOWN']), { state: 'TRIAL', release: 'd20', capacity: 'd30', transition: trial })))
check('🔴 v6 supply 에 eligibleSpeakers · excluded 를 싣지 못한다 (지어낸 화자 수 금지)',
  !okOf(v6({ ...LEGACY_SUPPLY, forecastWarnings: [] })) && !okOf(v6(LEGACY_SUPPLY)))
check('🔴 v6 supply 에 다른 키를 싣지 못한다', !okOf(v6({ forecastWarnings: [], note: 'x' })))
check('🔴 v6 supply 가 객체가 아니면 거절한다', !okOf(v6([])) && !okOf(v6('THROUGHPUT_SHORT')))
check('🔴 모르는 경고 코드를 거절한다', !okOf(v6(fw(['MADE_UP']))))
check('🔴 hard gate 코드를 경고로 싣지 못한다', !okOf(v6(fw(['PERSONA_SHORT']))))
check('🔴 같은 경고를 두 번 싣지 못한다', !okOf(v6(fw(['THROUGHPUT_SHORT', 'THROUGHPUT_SHORT']))))
check('경고가 배열이 아니면 거절한다', !okOf(v6(fw('THROUGHPUT_SHORT'))) && !okOf(v6(fw(null))))
check('🟢 v5 supply 는 옛 모양 그대로 읽는다 (null · {eligibleSpeakers, excluded})', okOf({}) && okOf({ supply: null }))
check('🔴 v5 행에 v6 경고 모양을 실어 소급하지 못한다', !okOf({ supply: fw(['THROUGHPUT_SHORT']) }))
check('🔴 v5 행에 경고 키를 섞지 못한다', !okOf({ supply: { ...LEGACY_SUPPLY, forecastWarnings: [] } }))
check('🔴 v4 행에 경고 키를 섞지 못한다', !okOf({ contractVersion: STAGE_DECISION_V4, supply: fw([]) }))
{
  const r = v(v6(fw(['THROUGHPUT_SHORT'])))
  check('검증된 v6 결정이 경고만 손실 없이 담는다',
    r.ok && JSON.stringify(r.decision.supply) === '{"forecastWarnings":["THROUGHPUT_SHORT"]}', r.ok ? JSON.stringify(r.decision.supply) : r.reason)
  const x = v({})
  check('검증된 v5 결정은 옛 모양 그대로다(경고 칸 없음)',
    x.ok && JSON.stringify(x.decision.supply) === '{"eligibleSpeakers":40,"excluded":[]}', x.ok ? JSON.stringify(x.decision.supply) : x.reason)
}

console.log('\n④ v6 도 v5 구조 규칙을 그대로 받는다')
check('🔴 v6 SUSTAIN 거절', !okOf(v6(null, { state: 'SUSTAIN', release: 'd20', transition: { kind: 'SUSTAIN', from: 'd10', to: 'd20' } })))
check('🟢 v6 CERTIFIED HOLD/PREPARE 허용', okOf(v6(null, { release: 'd10', capacity: 'd20', transition: { kind: 'CERTIFIED', certified: 'd20' } })))
check('🔴 v6 TRIAL 에 fatal block(PREFLIGHT_FAIL)이 있으면 거절',
  !okOf(v6(null, { state: 'TRIAL', release: 'd20', capacity: 'd30', transition: trial, blocks: [{ code: 'PREFLIGHT_FAIL', reason: 'x' }] })))
check('🔴 v4 CERTIFIED 는 여전히 거절', !okOf({ contractVersion: STAGE_DECISION_V4, supply: null, release: 'd10', capacity: 'd20', transition: { kind: 'CERTIFIED', certified: 'd20' } }))

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
    d.contractVersion === STAGE_DECISION_V5 && s.contractVersion === STAGE_DECISION_V5
    && (d.supply === null || !('forecastWarnings' in d.supply)))
  const controller = readFileSync('src/lib/stage-controller.ts', 'utf8')
  const ladder = readFileSync('src/lib/stage-ladder.ts', 'utf8')
  check('🔴 writer 경로에 v6 판이 없다 (reader 먼저 · writer 는 별도 릴리스)',
    !controller.includes('stage-decision-v6') && !ladder.includes('stage-decision-v6')
    && !/STAGE_DECISION_V6|STAGE_DECISION_READER_VERSIONS/.test(controller + ladder))
}

console.log(`\nStageDecision v6 reader 검사: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
