/**
 * 🔴 **검사 전용** — 단계 칸에 StageDecision 표식을 붙인 fixture env 를 만든다 (2026-09-30 · Lane A)
 *
 *    운영에서 표식을 넣는 곳은 consumer(`consumerEnvOf`) 하나다. 검사는 "결정이 d3 을 넣었다면" 을
 *    직접 적어야 하므로 이 도우미를 쓴다 — 표식 없는 손 env 는 `scale-runtime` 이 읽지 않는다(= d1).
 *
 * 🔴 **이 파일은 `*-check.mts` 만 import 한다.** 발행 · 공급 엔트리가 이 파일에 닿으면
 *    `stage-authority-graph` 가 막는다(표식을 손으로 만드는 길이 운영 경로에 생기는 것이다).
 */
import { STAGE_DECISION_MARK_ENV } from '../../src/lib/scale-runtime'

/** 🔴 fixture 표식 날짜 — 운영 결정 날짜처럼 보이지만 검사 밖으로 나가지 않는다 */
export const FIXTURE_DECISION_DATE = '2026-09-30'

export function markedStageEnv<T extends Record<string, string | undefined>>(env: T, kstDate: string = FIXTURE_DECISION_DATE): T & Record<string, string> {
  return { ...env, [STAGE_DECISION_MARK_ENV]: kstDate } as T & Record<string, string>
}
