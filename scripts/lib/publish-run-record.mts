/**
 * 발행 러너 **마지막 실제 회차 기록** — 쓰기·읽기 (판정은 정본 `job-health.failingFromPublishRun`)
 *
 * 🔴 **쓰는 곳은 하나다** — `stage-consume-exec --by=publish` 가 러너가 끝난 뒤 한 번.
 *    launchd 가 띄운 회차(`XPC_SERVICE_NAME` = 발행 job label)만 쓴다. 손으로 돌린 회차는 쓰지 않는다 —
 *    수동 성공이 launchd 회차의 실패를 덮으면 안 된다.
 * 🔴 쓰기 실패는 발행 결과를 바꾸지 않는다 — 기록이 없으면 판정이 "모름" 으로 남을 뿐이다.
 * 🔴 파일 하나를 통째로 바꾼다(임시 파일 → rename). 반쯤 쓴 파일은 남지 않는다.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { parsePublishRunRecord, type PublishRunRead, type PublishRunRecord } from '../../src/lib/job-health'
import { PUBLISH_WINDOW_END_MINUTE, PUBLISH_WINDOW_START_MINUTE } from '../../src/lib/publish-slot-catchup'
import { HEARTBEAT_INTERVAL_MINUTES, PUBLISH_RUNNER_LABEL } from './original-post-runner-template'

/** 🔴 저장소 밖 — runtime 작업트리를 더럽히지 않는다. heartbeat 틱 표식과 같은 부모 디렉터리 */
export const PUBLISH_RUN_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'publish-runs')
const LAST_FILE = 'last.json'

/**
 * 🔴 **기록이 믿을 만한 최대 나이** — 발행 창 밖 공백(22:00→08:00) + heartbeat 두 칸.
 *    그보다 오래된 기록은 "그 사이 한 번도 안 돌았다" 는 뜻일 수 있다 — 모른다로 둔다.
 */
export const PUBLISH_RUN_MAX_AGE_MS =
  (24 * 60 - (PUBLISH_WINDOW_END_MINUTE - PUBLISH_WINDOW_START_MINUTE) + 2 * HEARTBEAT_INTERVAL_MINUTES) * 60_000

export function readPublishRunRecord(dir: string = PUBLISH_RUN_DIR): PublishRunRead {
  let text: string
  try { text = readFileSync(join(dir, LAST_FILE), 'utf-8') } catch (e) {
    return (e as { code?: string }).code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'corrupt', reason: `읽지 못했다 — ${(e as { code?: string }).code ?? 'UNKNOWN'}` }
  }
  return parsePublishRunRecord(text)
}

export type RecordOutcome = { written: true } | { written: false; reason: string }

/** 🔴 launchd 발행 회차 하나를 남긴다. 던지지 않는다 */
export function recordPublishRun(
  i: { launchdLabel: string | undefined; startedAt: Date; finishedAt: Date; exitCode: number },
  dir: string = PUBLISH_RUN_DIR,
): RecordOutcome {
  if (i.launchdLabel !== PUBLISH_RUNNER_LABEL) {
    return { written: false, reason: `launchd 발행 회차가 아니다(XPC_SERVICE_NAME=${i.launchdLabel ?? '없음'}) — 남기지 않는다` }
  }
  const rec: PublishRunRecord = {
    v: 1, label: i.launchdLabel,
    startedAt: i.startedAt.toISOString(), finishedAt: i.finishedAt.toISOString(), exitCode: i.exitCode,
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const tmp = join(dir, `${LAST_FILE}.${process.pid}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(rec)}\n`, { mode: 0o600 })
    renameSync(tmp, join(dir, LAST_FILE))
    return { written: true }
  } catch (e) {
    return { written: false, reason: `기록을 쓰지 못했다 — ${(e as { code?: string }).code ?? 'UNKNOWN'}` }
  }
}
