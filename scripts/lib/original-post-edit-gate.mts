/**
 * 🔴 **사람이 고친 문안을 저장 기준으로 다시 재는 한 곳** (2026-09-21)
 *
 *    운영 검토 러너(`publish:machine-review --decision=edit`)와 검사가 **같은 함수**를 쓴다.
 *    조립을 두 벌로 두면 검사는 통과하는데 운영은 다른 원문을 보는 일이 생긴다.
 *
 * 🔴 **원문은 artifact 의 마스킹된 근거다.** DB 의 `MicroSeedRawContent` 가 아니다 —
 *    적재기가 기계 후보마다 만드는 합성 raw 에는 **AI 초안의 사본**이 들어 있다
 *    (실측: `rawTitle`·`rawBody` 가 `draftTitle`·`draftBody` 와 글자까지 같았다).
 *    그것을 외부 원문으로 삼으면 사람이 한 글자만 고쳐도 자기 자신과 20자 넘게 겹쳐
 *    `SOURCE_ECHO` 로 막힌다 — 정상 수정이 영영 저장되지 않는다.
 *
 * 🔴 **게이트 규칙·임계값을 바꾸지 않는다.** 예외 문자열도 넣지 않는다.
 *    바로잡는 것은 "무엇을 원문으로 보는가" 하나뿐이다.
 */
import { readSourceProfile, mustKeepDetails } from './source-profile'
import { analyzeDraft } from './original-post-prompt'
import { gateDraft } from './original-post-gate'
import type { ReviewSourceEvidence } from '../../src/lib/original-post-machine-review'

export type EditGateVerdict = {
  /** `PASS` · `HOLD` · `BLOCK` — 정본 게이트가 내는 값 그대로 */
  verdict: string
  /** 🔴 사유 **코드만** — detail 에는 원문 조각이 섞일 수 있다 */
  codes: string[]
}

/**
 * 🔴 **한 원문으로 전부 잰다.** `readSourceProfile` · `analyzeDraft.sourceTexts` ·
 *    `sourceBodyLength` · `mustKeepDetails` 가 **같은 근거**를 본다 —
 *    한 곳만 다른 원문을 보면 판정이 어긋난다.
 */
export function gateEditedDraft(input: {
  source: ReviewSourceEvidence
  title: string
  body: string
}): EditGateVerdict {
  const { source } = input
  const profile = readSourceProfile({ rawTitle: source.rawTitle, rawBody: source.rawBody })
  const signals = analyzeDraft({
    title: input.title, body: input.body,
    sourceTexts: [source.rawTitle, source.rawBody],
    allowedContentUrl: profile.contentReferenceUrl,
    closingIntent: profile.closingIntent,
    allowNumberedList: profile.preserveStructure.numberedList,
  })
  const must = mustKeepDetails(profile.concreteDetailsToKeep)
  const both = `${input.title}\n${input.body}`
  const g = gateDraft({
    signals, closingIntent: profile.closingIntent,
    sourceBodyLength: [...source.rawBody].length,
    mustKeepTotal: must.length,
    mustKeepFound: must.filter((x) => both.includes(x.sample)).length,
  })
  return { verdict: g.verdict, codes: [...g.blocks, ...g.holds].map((f) => f.code) }
}
