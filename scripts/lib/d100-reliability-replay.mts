/**
 * D100 reliability replay — 검사 전용 하네스 부품. 운영 경로는 이 파일을 import 하지 않는다.
 *
 * 🔴 **baseline gap 은 승인된 정책이 아니다.** 2026-11-02 보정 전 코드가 정본(canon)과 어긋났던 자리를
 *    실제 함수 호출로 남긴 characterization 이다. 각 gap 의 `current`는 보정 전 기준선이고,
 *    `target`은 지금 코드가 계속 지켜야 하는 교정 계약이다.
 *
 * 🔴 **판정은 실제 운영 함수로만 한다.** `target`과 같으면 `GAP_CLOSED`, 옛 기준선이면 `BASELINE_REPRODUCED`,
 *    둘 다 아니면 `DRIFT`다. 아직 없는 미래 API를 하네스가 지어내 “고쳐진 판”을 PASS 하지 않는다.
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
  /** 2026-11-02 보정 전 기준선(부분 일치) */
  readonly current: Observation
  /** 보정 뒤 계속 지켜야 하는 값(부분 일치) */
  readonly target: Observation
}

export const BASELINE_GAPS: readonly BaselineGap[] = [
  {
    code: 'PREFLIGHT_FULL_DAY_OPPORTUNITY',
    scenario: 1,
    summary: '07:00 preflight 가 그 시각의 READY + 원천 기회만으로 하루 전체 N 슬롯을 요구한다 — 당일 뒤 공급 회차가 새 원천으로 보충할 부족도 OPPORTUNITY_SHORT 다'
      + ' (PR1b · 2026-11-06: 기회 예측은 막지 않는 forecastWarnings — 미래 공급 0·모름은 지어내지 않고 경고로 남는다)',
    current: {
      verdict: 'FAIL', onlyOpportunityShort: true, distinctFutureCapacityCoversShortfall: true,
      usesFutureSupplyCapacity: false, zeroFutureCapacityWarned: false, unknownYieldWarned: false,
      preflightFactsCurrentOnly: true, opportunityGateCurrentOnly: true, controllerPassesFactsDirectly: true,
    },
    target: {
      verdict: 'PASS', hasOpportunityShort: false, distinctFutureCapacityCoversShortfall: true,
      usesFutureSupplyCapacity: true, zeroFutureCapacityWarned: true, unknownYieldWarned: true,
      preflightFactsCurrentOnly: false, opportunityGateCurrentOnly: false, controllerPassesFactsDirectly: true,
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
    /** 감속한 날의 행이 열린 단계를 `CERTIFIED` 로 들고 가고, 신호가 돌아온 날 그 단계로 돌아온다 */
    target: {
      certified: 'd5', day0Brake: 'slowdown', day0Operating: 'd3', day0Raised: false, day1Sustained: 'd5',
      day1Release: 'd5', day1BelowCertified: false, secondBrakeDayRelease: 'd3',
      readerAcceptsCertified: true, writerEmitsCertified: true,
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
    /** 하루 판정은 러너 건강을 입력으로 받지 않는다 — 양은 수가 재고 당일 러너 결함은 브레이크 오류 축이 본다 */
    target: {
      controllerFeedsCurrentErrors: false, currentErrorCallCount: 0, evidenceTakesRunnerHealth: false,
      pastVerdict: 'PASS', pastHasRunnerBad: false, sustainedAfter: 'd5',
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
      supplyOutcome: 'OFF', supplyMarker: null, supplyKicks: 0,
      supplyWakeImplemented: false, wakeTargets: 'comment', supplyWakeIntentionallyClosed: true,
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
  if (atCurrent && !atTarget) return 'MATCH'
  if (atTarget && !atCurrent) return 'GAP_CLOSED'
  return 'DRIFT'
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
