/**
 * 댓글 **호출 결과 판정** — 🔴 장부 결과 하나를 후보로 삼아도 되는가.
 *
 * 🔴 **왜 따로 두는가** (2026-09-21).
 *
 *    이 판정은 러너 스크립트 안의 `if` 세 줄이었다. 스크립트 최상위 코드라
 *    **불러서 확인할 방법이 없었고**, 그래서 실제로는 두 구멍이 있었다.
 *
 *    ① `usageMetadata` 가 빠진 응답. 세션은 `usageUnknown` 으로 적고
 *       `settledUsd: null` 을 준다 — 그런데 **줄은 적혔으므로**
 *       `settlementRecorded` 는 `true` 다. 러너는 그 둘만 봐서
 *       **얼마인지 모르는 건을 정산된 것으로 취급**하고 후보를 만들었다.
 *       🔴 "미정산 기록 성공" 은 "정산 완료" 가 아니다.
 *
 *    ② 상한에 닿아 **잘린** 응답. provider 는 `ok: true` 를 준다 —
 *       종료 사유가 있으니 실패가 아니다. 잘린 JSON 이 우연히 파싱되면
 *       **문장이 끊긴 댓글**이 그대로 후보가 됐다.
 *
 * 🔴 **공유 장부 계약은 건드리지 않는다.** 글 공급 경로가 쓰는
 *    `SupplyCallResult` 의 모양도 의미도 그대로다 — 이 판정은 **댓글 경로만** 한다.
 */
import { parseCandidate } from './persona-prompt'

import type { SupplyCallResult } from './supply-llm-call.mjs'

/** `runEnqueuePipeline` 의 `provider` 가 돌려줘야 하는 모양 그대로다 */
export type CommentCallOutcome = {
  ok: boolean
  text: string | null
  errorCode: string | null
}

/** 🔴 정산 줄을 적지 못했다 — 쓴 돈이 장부에서 사라진다 */
export const SETTLE_NOT_RECORDED = 'SETTLE_NOT_RECORDED'
/** 🔴 줄은 적혔지만 **금액을 모른다**(`usageUnknown`) — 예약이 열린 채 남는다 */
export const SETTLE_AMOUNT_UNKNOWN = 'SETTLE_AMOUNT_UNKNOWN'
/** 🔴 출력 상한에 닿아 잘렸다 — 파싱되더라도 끝난 문장이 아니다 */
export const MAX_TOKENS_REACHED = 'MAX_TOKENS_REACHED'

/**
 * 🔴 **장부 결과를 후보로 삼아도 되는가.** 네 축을 **전부** 본다.
 *
 *    막는 쪽에 서는 이유는 하나다 — 여기서 통과시키면 그 다음은 Queue 다.
 *    사람이 승인 화면에서 "이 댓글 얼마였지" 를 물었을 때 답이 없으면 안 된다.
 */
export function judgeCommentCall(res: SupplyCallResult): CommentCallOutcome {
  if (!res.ok) return { ok: false, text: null, errorCode: res.errorCode }
  /**
   * 🔴 **오늘 이 줄은 도달하지 않는다.** 세션이 정산 줄을 못 적으면 스스로
   *    `ok: false` 로 뒤집기 때문에 위에서 걸린다 — 돌연변이로 확인했다.
   *    그래도 남긴다. 기대고 있는 그 계약은 검사가 따로 못박는다
   *    (`⑤ 세션은 정산을 못 적으면 ok 를 내주지 않는다`).
   */
  if (!res.settlementRecorded) return { ok: false, text: null, errorCode: SETTLE_NOT_RECORDED }
  /**
   * 🔴 `settledUsd === null` 은 `judgeSettle` 이 `usageUnknown` 일 때만 준다 —
   *    "0원" 이 아니라 **"모른다"** 다. 0 으로 보정하지 않는다.
   */
  if (res.settledUsd === null) return { ok: false, text: null, errorCode: SETTLE_AMOUNT_UNKNOWN }
  // 🔴 파싱 **앞**에 둔다. 뒤에 두면 "읽히니까 괜찮다" 가 판정을 이긴다
  if (res.maxTokensReached) return { ok: false, text: null, errorCode: MAX_TOKENS_REACHED }

  const parsed = parseCandidate(res.rawText)
  return parsed.ok
    ? { ok: true, text: parsed.text, errorCode: null }
    : { ok: false, text: null, errorCode: parsed.errorCode }
}
