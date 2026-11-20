/**
 * JSONL 을 **한 번에 내놓는다** — 임시 파일에 다 쓴 뒤 rename.
 *
 * 막는 사고:
 *   수집과 공급이 같은 시간대에 돈다(공급은 바퀴마다 수집 시작 뒤 `SUPPLY_AFTER_COLLECT_MINUTES` 분에 뜬다).
 *   수집기가 결과 파일을 쓰는 도중에 공급이 그 파일을 읽으면 앞부분 몇 행만 변환하고, 변환 산출물이 생긴
 *   그 파일은 "처리됨"으로 남아 나머지 행을 다시는 보지 않는다. rename 은 같은 디렉터리 안에서 원자적이라
 *   공급은 그 파일을 **아예 못 보거나 전부 본다**.
 *
 * 🔴 임시 파일 이름은 `.` 으로 시작하고 `.jsonl` 로 끝나지 않는다 — 공급의 미처리 입력 계획(`planPending`)이
 *    이름으로 입력을 고르므로, 쓰는 중인 파일이 입력으로 잡히지 않는다(`supply:cycle-check` 가 본다).
 */
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** 쓰는 동안만 존재하는 임시 파일 경로 — 최종 파일과 같은 디렉터리(같은 파일시스템이어야 rename 이 원자적이다) */
export function partialPathOf(path: string, pid: number = process.pid): string {
  return join(dirname(path), `.${basename(path)}.partial-${pid}`)
}

export function writeJsonlAtomic(path: string, rows: readonly object[]): void {
  const tmp = partialPathOf(path)
  try {
    writeFileSync(tmp, rows.map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf-8')
    renameSync(tmp, path)
  } catch (e) {
    // 🔴 반쯤 쓴 임시 파일을 남기지 않는다 — 최종 파일은 만들어지지 않았다(다음 바퀴가 그 글을 다시 연다)
    rmSync(tmp, { force: true })
    throw e
  }
}
