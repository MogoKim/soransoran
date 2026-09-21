/**
 * fixture 용 **화자 여력 파일** — 🔴 운영 파일과 **같은 계약**이다
 *
 * 🔴 **왜 공용인가.** 생성 러너는 유료 회차에서 이 파일 없이 돌지 않는다 —
 *    없으면 전체 후보로 되돌아가 "같은 화자에 몰아주기" 가 그대로 재현되기 때문이다.
 *    운영에서는 공급 러너가 DB 를 읽어 적는다. fixture 마다 손으로 적으면
 *    한 곳이 낡고, 그 검사만 조용히 옛 계약을 시험하게 된다.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SPEAKER_LOAD_FILE } from '../../src/lib/content-core/speaker-load-file'

/** 🔴 fixture 가 쓰는 여력 — 넉넉히 준다. 좁힘 자체는 전용 검사가 본다 */
export function writeFakeSpeakerLoad(
  dataDir: string,
  kind: 'fresh' | 'stale' | 'malformed' = 'fresh',
  /**
   * 🔴 **화자 분산과 무관한 검사용.** 한 명에게 넉넉한 여력을 주면 모든 원천이
   *    같은 후보 하나를 받아, 좁히기 전과 **같은 요청 수**가 나간다 —
   *    장부 상한처럼 화자와 무관한 것을 재는 검사가 이 값에 흔들리지 않는다.
   */
  onlyCode: string | null = null,
): void {
  if (kind === 'malformed') {
    writeFileSync(join(dataDir, SPEAKER_LOAD_FILE), JSON.stringify({ writtenAt: 1, byCode: {} }), 'utf-8')
    return
  }
  const writtenAt = kind === 'stale'
    ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    : new Date().toISOString()
  const byCode: Record<string, { openDays: number; readyCount: number }> = {}
  if (onlyCode !== null) byCode[onlyCode] = { openDays: 999, readyCount: 0 }
  else {
    for (let i = 1; i <= 50; i += 1) {
      byCode[`P${String(i).padStart(2, '0')}`] = { openDays: 7, readyCount: 0 }
    }
  }
  writeFileSync(
    join(dataDir, SPEAKER_LOAD_FILE),
    JSON.stringify({ writtenAt, horizonDays: 7, byCode }, null, 2), 'utf-8')
}
