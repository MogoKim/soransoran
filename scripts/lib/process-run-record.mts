/**
 * 공급 ProcessRun 기록의 생성·직렬화 정본.
 * 실제 공급 writer와 proof-day 관통검사가 같은 함수를 써서 필드명·태그·JSON 모양의 드리프트를 막는다.
 */
import { renameSync, writeFileSync } from 'node:fs'

import type { ProcessRun } from '../../src/lib/supply-process'

export function createProcessRunRecord(i: {
  runId: string
  runtimeSha?: string
  startedAt: string
  jit: ProcessRun['jit']
  runTokenShadow?: ProcessRun['runTokenShadow']
}): ProcessRun {
  return {
    runId: i.runId,
    ...(i.runtimeSha === undefined ? {} : { runtimeSha: i.runtimeSha }),
    startedAt: i.startedAt,
    status: 'running',
    completedAt: null,
    jit: i.jit,
    sources: [],
    stages: [],
    ...(i.runTokenShadow === undefined ? {} : { runTokenShadow: i.runTokenShadow }),
  }
}

/** 반쯤 쓴 JSON을 관제가 읽지 않도록 같은 디렉터리의 임시 파일을 rename한다. */
export function writeProcessRunRecord(path: string, record: ProcessRun): void {
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf-8')
  renameSync(temporary, path)
}
