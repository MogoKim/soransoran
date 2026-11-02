/**
 * D100 reliability replay — 검사 전용 하네스 부품. 운영 경로는 이 파일을 import 하지 않는다.
 *
 * 🔴 **baseline gap 은 승인된 정책이 아니다.** 지금 코드가 정본(canon)과 어긋나는 자리를 실제 함수 호출로
 *    재현해 구조화된 값으로 남긴 characterization 이다. 각 gap 은 지금 관측돼야 하는 값(`current`)과
 *    고친 뒤 관측돼야 하는 값(`target`)을 함께 가진다.
 *
 * 🔴 **뒤집는 방법은 하나다.** 후속 PR 이 결함을 고치면 이 하네스가 `GAP_CLOSED` 또는
 *    `DRIFT`로 먼저 실패해야 한다. 그 PR 에서 실제 새 운영 함수를 부르는 반례로 시나리오를 바꾸고
 *    교정 값을 고정한다. 아직 없는 미래 API를 하네스가 지어내 “고쳐진 판”을 PASS 하지 않는다.
 *
 * 🔴 DB 0 · 네트워크 0 · provider 0 · 운영 HOME 0 · 운영 launchctl 0. 파일은 OS 임시 디렉터리에만 쓴다.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 관측 한 칸 — 비교 가능한 원시값만 둔다 */
export type ObservedValue = string | number | boolean | null
export type Observation = Readonly<Record<string, ObservedValue>>

export type BaselineGap = {
  readonly code: string
  /** 사용자 과제의 시나리오 번호(1~6) */
  readonly scenario: number
  readonly summary: string
  /** 지금 관측돼야 하는 값(부분 일치) */
  readonly current: Observation
  /** 고친 뒤 관측돼야 하는 값(부분 일치) */
  readonly target: Observation
}

export const BASELINE_GAPS: readonly BaselineGap[] = [
  {
    code: 'PREFLIGHT_FULL_DAY_OPPORTUNITY',
    scenario: 1,
    summary: '07:00 preflight 가 그 시각의 READY + 원천 기회만으로 하루 전체 N 슬롯을 요구한다 — 당일 뒤 공급 회차가 새 원천으로 보충할 부족도 OPPORTUNITY_SHORT 다',
    current: {
      verdict: 'FAIL', onlyOpportunityShort: true, distinctFutureCapacityCoversShortfall: true,
      usesFutureSupplyCapacity: false, zeroFutureCapacityBlocked: true, unknownYieldBlocked: true,
      preflightFactsCurrentOnly: true, opportunityGateCurrentOnly: true, controllerPassesFactsDirectly: true,
    },
    target: {
      verdict: 'PASS', hasOpportunityShort: false, distinctFutureCapacityCoversShortfall: true,
      usesFutureSupplyCapacity: true, zeroFutureCapacityBlocked: true, unknownYieldBlocked: true,
      preflightFactsCurrentOnly: false, opportunityGateCurrentOnly: false, controllerPassesFactsDirectly: false,
    },
  },
  {
    code: 'BRAKE_DEMOTION_PERSISTS',
    scenario: 2,
    summary: '현재 bad 신호 하나가 인증된 단계(D5 PASS)의 release 를 한 칸 낮추고, 신호가 회복된 다음 날에도 낮춘 단계가 지속 단계로 남는다',
    current: {
      day0Brake: 'slowdown', day0Operating: 'd3', day0Release: 'd3', day1State: 'REPROVE',
      day1Sustained: 'd3', day1BelowCertified: true, exactNDay1Release: 'd5',
    },
    target: {
      certified: 'd5', day0Brake: 'slowdown', day0Operating: 'd3', day1Sustained: 'd5',
      day1Release: 'd5', day1BelowCertified: false, exactNDay1Release: 'd5',
    },
  },
  {
    code: 'EVIDENCE_USES_CURRENT_RUNNER_HEALTH',
    scenario: 3,
    summary: '전날 증거 판정에 오늘 07:00 에 관측한 러너 오류 신호가 들어가, 전날 자체로는 PASS 인 증명일이 RUNNER_BAD FAIL 이 되고 지속 단계가 시험 기반으로 내려간다',
    current: {
      controllerFeedsCurrentErrors: true, historicalCallCount: 4, currentErrorCallCount: 4,
      canDistinguishErrorDate: false, pastVerdict: 'FAIL', pastHasRunnerBad: true, sustainedAfter: 'd3',
    },
    target: {
      controllerFeedsCurrentErrors: false, historicalCallCount: 4, currentErrorCallCount: 0,
      canDistinguishErrorDate: true, pastVerdict: 'PASS', pastHasRunnerBad: false, sustainedAfter: 'd5',
    },
  },
  {
    code: 'SUPPLY_WAKE_NOT_IMPLEMENTED',
    scenario: 4,
    summary: '수집 완료 → 공급 깨움이 없다(NOT_IMPLEMENTED · 표식 0 · kickstart 0). 현재 깨움 대상은 댓글 러너 하나다',
    current: {
      supplyOutcome: 'NOT_IMPLEMENTED', supplyMarker: null, supplyKicks: 0,
      supplyWakeImplemented: false, wakeTargets: 'comment',
    },
    target: {
      supplyOutcome: 'SENT', supplyMarker: 'REQUESTED', supplyKicks: 1,
      supplyWakeImplemented: true, wakeTargets: 'comment,supply',
    },
  },
  {
    code: 'ATTEMPT_JOURNAL_CORRUPTION_PERMANENT',
    scenario: 5,
    summary: '첫 댓글 시도 기억 파일이 손상되면 60분 window 가 지나도 읽기·시작 기록이 계속 실패해, 무관한 글의 시도 기록까지 사람 복구 전에는 시작할 수 없다',
    current: {
      readOkAfterWindow: false, startOkAfterWindow: false, blocksUnrelatedPost: true,
      consumerSkipsOnCorruptMemory: true, consumerControlGenerates: true,
    },
    target: {
      readOkAfterWindow: true, startOkAfterWindow: true, blocksUnrelatedPost: false,
      generationRecoversAfterWindow: true, consumerSkipsOnCorruptMemory: false, consumerControlGenerates: true,
    },
  },
  {
    code: 'RUNTIME_MANIFEST_LACKS_PERSONA_ASSET_IDENTITY',
    scenario: 6,
    summary: 'runtime manifest 가 코드 SHA 만 결속한다 — 같은 SHA 위에서 어떤 Persona 말투 자산이 쓰였는지 manifest 로 대조할 수 없다',
    current: {
      manifestKeys: 'deployedAt,gates,previousSha,sha', referenceDigest: null, supplementDigest: null,
      bindsPersonaAsset: false,
    },
    target: {
      referenceDigest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      supplementDigest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      bindsPersonaAsset: true,
    },
  },
]

export type GapVerdict = 'MATCH' | 'GAP_CLOSED' | 'DRIFT'

/** 기대 칸이 전부 같은 값인가 — 관측에 없는 칸은 불일치다 */
export function matchesObservation(observed: Observation, spec: Observation): boolean {
  return Object.entries(spec).every(([k, v]) => Object.prototype.hasOwnProperty.call(observed, k) && observed[k] === v)
}

export function judgeGap(gap: BaselineGap, observed: Observation): GapVerdict {
  const atCurrent = matchesObservation(observed, gap.current)
  const atTarget = matchesObservation(observed, gap.target)
  return atCurrent && !atTarget ? 'MATCH' : atTarget && !atCurrent ? 'GAP_CLOSED' : 'DRIFT'
}

/** `YYYY-MM-DD` 의 KST `HH:MM` 순간 */
export const kstAt = (kstDate: string, hhmm: string): Date => new Date(`${kstDate}T${hhmm}:00+09:00`)

export const addKstDays = (kstDate: string, n: number): string =>
  new Date(Date.parse(`${kstDate}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

export type ReplaySandbox = {
  readonly root: string
  /** 운영 HOME 대신 쓰는 디렉터리 */
  readonly home: string
  /** 인자를 한 줄씩 남기고 0 으로 끝나는 launchctl 대역 */
  readonly fakeLaunchctl: string
  launchctlCalls: () => string[]
  resetLaunchctlCalls: () => void
  dispose: () => void
}

export function createReplaySandbox(prefix: string): ReplaySandbox {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`))
  const home = join(root, 'home')
  const log = join(root, 'launchctl.log')
  const fakeLaunchctl = join(root, 'launchctl-ok.sh')
  writeFileSync(fakeLaunchctl, `#!/bin/sh\necho "$*" >> '${log}'\nexit 0\n`, { mode: 0o755 })
  return {
    root, home, fakeLaunchctl,
    launchctlCalls: () => (existsSync(log) ? readFileSync(log, 'utf-8').split('\n').filter((l) => l !== '') : []),
    resetLaunchctlCalls: () => rmSync(log, { force: true }),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}
