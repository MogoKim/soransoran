/**
 * 🔴 **시험 사례 사이의 지난 생성 artifact 를 비운다** (2026-11-11 retry-authority-v7 · PR #838 CI).
 *
 *    `readPriorOutcomes` 는 두 종류를 읽는다 — **non-shadow 생성 artifact**(`auto-draft-*.artifacts.json`)와,
 *    호출자가 판정 canon 을 줄 때만 **판정 shadow**(`*.shadow.jsonl`). 이 helper 는 앞의 것만 비운다.
 *    v7 부터 같은 계약의 채택 · 결론 원천은 다시 만들지 않는다(채택 재생성 0). 데이터 폴더 하나를 여러 사례가
 *    이어 쓰면 앞 사례가 채택한 원천이 뒤 사례에서 `CONCLUDED` 로 막혀 provider 에 닿지 않고 —
 *    그 사례가 재려던 계약(장부 · 예산 · 형제 차단)을 재지 못한 채 결과가 사례 순서에 따라 갈린다.
 *
 *    🔴 shadow 를 비우지 않는 근거: 이 helper 를 쓰는 하네스(supply:process-check [FP] · supply:ledger-check [L])가
 *       띄우는 생성 러너는 canon 없이 읽어 shadow 를 지난 결과로 보지 않고(`micro-seed-auto-draft` · `readPriorOutcomes`),
 *       shadow 를 쓰지도 않는다. 그 하네스의 shadow 는 사례 전에 한 번 쓰는 **입력 seed** 라 사례 사이에 바뀌지 않는다.
 *       canon 을 주는 호출자(공급 러너)를 사례마다 띄우는 하네스가 생기면 이 helper 로는 격리되지 않는다.
 *    🔴 non-shadow 생성 artifact 의 파일 규칙은 러너 판독과 같은 `PRIOR_ARTIFACT_FILE_RE` 하나다 — 사본 정규식 0.
 *    🔴 채택 재생성 0 자체는 지우지 않은 채 다시 돌리는 살아 있는 사례(supply:process-check ⓪-b)가 따로 본다.
 */
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { PRIOR_ARTIFACT_FILE_RE } from './prior-outcomes.mjs'

/** 지운 파일 수를 낸다 — 시험이 "지울 것이 있었나" 를 볼 수 있게 */
export function clearPriorDraftArtifacts(dataDir: string): number {
  let n = 0
  for (const f of readdirSync(dataDir)) {
    if (!PRIOR_ARTIFACT_FILE_RE.test(f)) continue
    rmSync(join(dataDir, f))
    n += 1
  }
  return n
}
