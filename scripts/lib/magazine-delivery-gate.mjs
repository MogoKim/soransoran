/**
 * 🔴 **보낼 글자와 "보내도 되는가" 의 정본** (2026-09-28 · Codex P1).
 *
 *    전송 경계(`magazine-webui-runner.mjs` 의 `fetchSlug`)와 재생성(`magazine-regen.mjs` 의
 *    `attemptRegeneration`)이 **같은 생성기·같은 지문·같은 판정**을 써야 한다.
 *    재생성이 자기 판정을 따로 만들면 언젠가 갈라지고, 갈라진 날 이미 보낸 글을 다시 보낸다.
 *    그래서 둘 다 이 파일을 부른다. 조건을 다른 곳에 다시 쓰지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DRAFTS_DIR } from './magazine-load.mjs'
import { buildManuscriptMessage } from './chatgpt-session.mjs'
import {
  readQuarantine, deliveryFingerprintOf, deliveryHoldsFetch, QUARANTINE_PATH,
} from './magazine-quarantine.mjs'

/**
 * 🔴 **프롬프트 조립을 한 자리에 둔다** (2026-09-28 · P0-1).
 *    "보낼 글자" 의 지문으로 중복 전송을 막으려면, **대상을 고를 때 계산한 글자**와
 *    **실제로 보내는 글자**가 한 글자도 다르면 안 된다. 두 곳에서 따로 만들면
 *    언젠가 갈라지고, 갈라진 날 지문이 달라져 **막아야 할 것을 못 막는다.**
 */
export function manuscriptPromptText(packet = null) {
  return [
    // 🔴 brief 는 파일이 아니라 이 메시지 아래에 그대로 들어간다 (첨부 경로 폐지 · 2026-09-28)
    '아래 BRIEF 시작/끝 사이의 지시를 그대로 따라 최종 원고를 작성하세요.',
    '설명·인사·요약·후기를 붙이지 말고 원고 전체만 출력합니다.',
    '출력은 마크다운 코드블록 안에 마크다운 원본 표기 그대로 넣어 주세요.',
    'frontmatter 의 --- 부터 CTA 줄까지 전부 포함합니다.',
    // 🔴 관문이 막는 것을 프롬프트에서도 한 번 말한다. 막는 것보다 안 나오게 하는 편이 싸다.
    '웹 검색 인용 표기나 각주 마커를 본문에 남기지 마세요.',
    // 🔴 재생성이면 무엇이 걸렸는지 그대로 붙인다
    ...(packet ? ['', '--- 이전 원고가 자동 검사에 걸렸습니다 ---', packet.instruction] : []),
  ].join(' ')
}

/**
 * 이 slug 에 **보내게 될 메시지** — 아직 보내지 않는다.
 * 대상 선택이 지문을 계산하려면 이것이 필요하다. brief 가 없으면 `null`.
 */
export function plannedMessageFor(slug, draftsDir = DRAFTS_DIR, packet = null) {
  const briefPath = join(draftsDir, slug, 'brief.md')
  if (!existsSync(briefPath)) return null
  return buildManuscriptMessage({ promptText: manuscriptPromptText(packet), briefText: readFileSync(briefPath, 'utf8') })
}

/**
 * 🔴 **보내도 되는가 — 판정은 여기 하나다** (2026-09-28 · 재생성 HOLD).
 *
 *    앞판은 이 판정이 `fetchBatch` 안에만 있었다. `--fetch --force --regen-packet`
 *    (`fetchOne`) 은 장부를 보지 않고 곧장 보냈다 — 같은 재생성 요청이 응답 대기에서
 *    끊긴 뒤 다시 실행되면 **같은 글자를 두 번째로 보냈다.**
 *
 *    그래서 판정을 호출부가 아니라 **모든 전송이 지나는 `fetchSlug`** 로 옮기고,
 *    `fetchBatch` 의 계획표도 이 함수를 그대로 부른다. 조건을 다시 쓰지 않는다.
 *
 *    ① 보낼 메시지는 `plannedMessageFor` 하나가 만든다 — 일반·재생성 같은 생성기
 *    ② 지문은 `deliveryFingerprintOf` 하나가 만든다
 *    ③ HOLD 조건은 `deliveryHoldsFetch` 하나가 정한다 (slug + 지문 + DELIVERY_UNCERTAIN)
 *    날짜·runId·다른 후보·재시작은 판정에 들어가지 않는다. brief 나 재생성 지시가
 *    바뀌어 **보낼 글자가 달라질 때만** 다시 열린다.
 *
 * 🔴 장부를 못 읽으면 **보내지 않는다** — 모름은 "보낸 적 없음" 이 아니다.
 *
 * @returns {{ok:true, message:string|null, messageFingerprint:string|null, hold:object|null}
 *          |{ok:false, code:string, why:string, message:string|null, messageFingerprint:string|null}}
 */
export function deliveryGate({ slug, draftsDir = DRAFTS_DIR, packet = null, quarantinePath = QUARANTINE_PATH }) {
  const message = plannedMessageFor(slug, draftsDir, packet)
  const messageFingerprint = deliveryFingerprintOf(message)
  const ledger = readQuarantine(quarantinePath)
  if (!ledger.ok) {
    return { ok: false, code: 'QUARANTINE_UNREADABLE', why: ledger.why, message, messageFingerprint }
  }
  // 🔴 `entry` 는 앞단 확인(불필요한 probe 회피)용이다 — 정본 판정은 send 직전 `reserveDelivery` 가 잠금 안에서 한다
  return { ok: true, message, messageFingerprint, entry: ledger.store[slug] ?? null,
    hold: deliveryHoldsFetch(ledger.store[slug], messageFingerprint) }
}
