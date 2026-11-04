#!/usr/bin/env tsx
/**
 * 제한 복구 worker. controller가 만든 일일 intent 하나만 소비한다.
 *
 * 수집과 공급은 기존 정본 스크립트를 그대로 호출한다. 이 worker는 품질 판정이나
 * StageDecision을 쓰지 않는다. 최종 판정은 07:55 controller와 07:58 fallback이 다시 맡는다.
 */
import { closeSync, openSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ACTIVE_RECOVERY_DATE_ENV, ACTIVE_RECOVERY_DEADLINE_ENV, ACTIVE_RECOVERY_DEFICIT_ENV,
  ACTIVE_RECOVERY_NONCE_ENV,
  ACTIVE_RECOVERY_PAID_CUTOFF_MINUTE_KST,
  activeRecoveryDeadlineAt, kstMinuteOf,
} from '../src/lib/stage-active-recovery'
import { loaderArgs } from './lib/runner-lease.mjs'
import { runDetachedProcessGroup } from './lib/detached-process-group.mjs'
import { RUN_TIMEOUT_MS } from './lib/micro-seed-navercafe.mjs'
import {
  failStageRecoveryClaimBestEffort, hasStageRecoverySupplyReceipt, stageRecoveryClaimFromArgv,
  stageRecoveryLogPath, updateStageRecoveryIntent, validateStageRecoveryClaim,
  type StageRecoveryClaim, type StageRecoveryIntent,
} from './lib/stage-recovery-intent.mjs'

const argv = process.argv.slice(2)
const abortController = new AbortController()
const stop = (): void => { abortController.abort() }
process.once('SIGTERM', stop)
process.once('SIGINT', stop)

async function main(): Promise<number> {
  let claim: StageRecoveryClaim | null = null
  let intent: StageRecoveryIntent | null = null
  let logFd: number | null = null
  try {
    claim = stageRecoveryClaimFromArgv(argv)
    if (claim === null) throw new Error('stage recovery claim이 없다')
    intent = validateStageRecoveryClaim(claim)
    const deadline = activeRecoveryDeadlineAt(intent.kstDate, intent.createdAt)
    if (deadline === null) throw new Error('stage recovery 절대 마감을 계산하지 못했다')
    logFd = openSync(stageRecoveryLogPath(intent.kstDate), 'a', 0o600)
    const left = (): number => {
      const ms = deadline.getTime() - Date.now()
      if (ms <= 0) throw new Error('stage recovery 절대 마감 07:50을 넘겼다')
      return ms
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [ACTIVE_RECOVERY_DATE_ENV]: intent.kstDate,
      [ACTIVE_RECOVERY_NONCE_ENV]: intent.nonce,
      [ACTIVE_RECOVERY_DEFICIT_ENV]: String(intent.deficit),
      [ACTIVE_RECOVERY_DEADLINE_ENV]: deadline.toISOString(),
    }
    // controller의 launchd label은 recovery 자식의 기원이 아니다. 그대로 물리면 수집·공급이
    // 자연 scheduled 회차로 오인돼 liveness와 자연 증거를 부풀린다.
    delete env.XPC_SERVICE_NAME
    const collectCode = await runDetachedProcessGroup({
      command: process.execPath,
      args: [...loaderArgs(), resolve('scripts/micro-seed-collect-navercafe.mts'),
        '--board=wgang:all', `--max=${intent.collectMax}`, '--thin', '--live'],
      // collector 내부 15분 timeout이 자기 종료 기록과 lock 해제를 먼저 수행하게 한다.
      // 외부 process-group kill은 그 뒤 3분 동안 끝나지 않는 비정상 후손만 정리한다.
      cwd: process.cwd(), env, logFd, timeoutMs: Math.min(left(), RUN_TIMEOUT_MS + 3 * 60_000),
      signal: abortController.signal,
    })
    if (collectCode !== 0) throw new Error(`wgang 제한 수집 실패 exit ${collectCode}`)
    if (kstMinuteOf(new Date()) >= ACTIVE_RECOVERY_PAID_CUTOFF_MINUTE_KST) {
      throw new Error('수집 뒤 유료 공급 시작 마감 07:30을 넘겼다')
    }
    const supplyCode = await runDetachedProcessGroup({
      command: process.execPath,
      args: [...loaderArgs(), resolve('scripts/supply-process.mts'),
        '--live', `--workset-limit=${intent.worksetLimit}`,
        `--stage-recovery-date=${intent.kstDate}`,
        `--stage-recovery-nonce=${intent.nonce}`,
        `--stage-recovery-deficit=${intent.deficit}`,
      ],
      cwd: process.cwd(), env, logFd, timeoutMs: left(), signal: abortController.signal,
    })
    if (supplyCode !== 0) throw new Error(`제한 공급 실패 exit ${supplyCode}`)
    if (!hasStageRecoverySupplyReceipt(claim)) {
      throw new Error('공급 본체 완주 영수증이 없다 — lease 경합 또는 불완전 실행')
    }
    intent = updateStageRecoveryIntent({ intent, state: 'done', now: new Date(), message: '수집·공급 완료' })
    return 0
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown recovery failure'
    if (claim !== null) failStageRecoveryClaimBestEffort({ claim, now: new Date(), message })
    return 1
  } finally {
    if (logFd !== null) closeSync(logFd)
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}

process.exitCode = await main()
