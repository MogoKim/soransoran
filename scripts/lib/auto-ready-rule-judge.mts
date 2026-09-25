/**
 * 🔴 **규칙 기반 무결성·안전 감사자** (2026-09-25 · auto-ready-v2)
 *
 * 🔴 **이것은 "독립 의미 감사" 가 아니다.** 이름 그대로 **무결성·안전** 만 본다.
 *    도장을 찍은 판정과 다른 경로로 **실제로 발행된 Post** 를 다시 보지만, 원문과의 의미
 *    대조(없는 사실을 지어냈는가 · 생활사가 어긋나는가)는 하지 못한다. 모델을 부르지 않는다.
 *
 * 무엇을 결함(yes)으로 보나
 *   ① 발행된 제목·본문이 도장이 본 제목·본문과 다르다(hash) — 판정받지 않은 글이 나갔다
 *   ② 도장 기록이 없거나 모양이 깨졌다
 *   ③ 발행된 글에서 자동 READY 차단 표현이 나온다(이미지 의존 · 시점 어긋남 · 단정 · 후속 소재)
 *   ④ 발행 문안으로 다시 돌린 안전 필터가 pass 가 아니다
 *   ⑤ 제목이나 본문이 비었다
 *
 * 🔴 **이 감사자가 못 보는 것을 정직하게 적는다.** 원문과의 의미 대조(없는 사실을 지어냈는가 ·
 *    생활사가 어긋나는가)는 규칙으로 잴 수 없다. 그 판정은 모델 감사자가 해야 하는데,
 *    모델 호출은 이번 승인 범위가 아니다(유료 호출 0). 감사자는 `AuditJudge` 로 주입되므로
 *    모델 감사자는 **같은 계약**으로 나중에 끼울 수 있고, 그때는 `model`·`promptVersion` 이
 *    달라져 기록에 남는다.
 */
import {
  AUDIT_CONTRACT_VERSION, AUTO_READY_BLOCKERS, digestOf,
  type AuditJudge, type AuditVerdict,
} from '../../src/lib/auto-ready-v2'
import { safetyFilter } from './micro-seed-safety-filter.mjs'

export const RULE_JUDGE_MODEL = 'rule:integrity-safety-audit'
export const RULE_JUDGE_PROMPT_VERSION = 'integrity-safety-v1'

export const ruleAuditJudge: AuditJudge = async (i): Promise<AuditVerdict> => {
  const reasons: string[] = []
  const titleHash = digestOf(i.title)
  const bodyHash = digestOf(i.body)
  if (i.stamp === null) reasons.push('도장 기록이 없거나 깨졌다')
  else {
    if (i.stamp.titleHash !== titleHash) reasons.push('발행된 제목이 도장이 본 제목과 다르다')
    if (i.stamp.bodyHash !== bodyHash) reasons.push('발행된 본문이 도장이 본 본문과 다르다')
  }
  if (i.title.trim() === '' || i.body.trim() === '') reasons.push('제목이나 본문이 비었다')
  const both = `${i.title}\n${i.body}`
  for (const [name, re] of Object.entries(AUTO_READY_BLOCKERS)) {
    const hit = re.exec(both)
    if (hit !== null) reasons.push(`${name}="${hit[0]}"`)
  }
  const safety = safetyFilter({ title: i.title, body: i.body }).verdict
  if (safety !== 'pass') reasons.push(`안전 필터 ${safety}`)
  return {
    defect: reasons.length > 0 ? 'yes' : 'no',
    reasons,
    contractVersion: AUDIT_CONTRACT_VERSION,
    model: RULE_JUDGE_MODEL,
    promptVersion: RULE_JUDGE_PROMPT_VERSION,
    judgedTitleHash: titleHash,
    judgedBodyHash: bodyHash,
  }
}
