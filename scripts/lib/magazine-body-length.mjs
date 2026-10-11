/**
 * 🔴 **본문 길이 판정의 유일한 정본** (2026-10-11 자연 회차 · autumn-low-mood).
 *
 *    앞판은 길이 기준이 세 곳에 따로 있었다.
 *      magazine-qa        1200~2500자 · 공백 제외 · **WARN 만**
 *      magazine-batch-qa  800~3000자  · 공백 포함 · **BLOCK** (BODY_TOO_LONG)
 *    그래서 3252자 원고가 QA 를 통과하고 hero 까지 만든 뒤 batch 에서 막혔고, QA 재생성 패킷에는 길이가 실리지
 *    않아 재생성된 원고도 길이를 고칠 이유가 없었다.
 *
 *    이제 이 파일 하나가 본문 텍스트 구성 · 길이 계산 · 기준을 정한다.
 *      hard (발행 차단)  800~3000자 · `publishText` 길이 (공백·줄바꿈 포함) — QA 는 FAIL, batch 는 BLOCK. **완화하지 않는다**
 *      soft (편집 권장)  1200~2500자 · 본문 블록의 공백 제외 글자 수 — QA WARN 만 (앞판과 같은 값·같은 문장)
 *    🔴 soft 의 계산·문장을 바꾸지 않는 이유: QA 출력 꼬리가 재생성 패킷에 실리고, 그 패킷 지문이 기존 재생성 HOLD 의
 *       열쇠다. 출력이 한 글자만 바뀌어도 HOLD 가 풀려 같은 글에 다시 보낸다.
 */
export const HARD_BODY = Object.freeze({ min: 800, max: 3000 })
export const SOFT_BODY = Object.freeze({ min: 1200, max: 2500 })

/** 발행 텍스트 — 본문 블록(text · items · label) + 제목 + 설명, 줄바꿈으로 잇는다 (batch-qa 의 기존 구성 그대로) */
export function publishText(article) {
  const out = []
  for (const b of article?.body ?? []) {
    if (typeof b.text === 'string') out.push(b.text)
    if (Array.isArray(b.items)) out.push(...b.items)
    if (typeof b.label === 'string') out.push(b.label)
  }
  if (typeof article?.title === 'string') out.push(article.title)
  if (typeof article?.description === 'string') out.push(article.description)
  return out.join('\n')
}

/** 본문 블록 텍스트 — text · items · CTA 문구 (magazine-qa 의 기존 구성 그대로) */
export function bodyBlocksText(article) {
  const parts = []
  for (const block of article?.body ?? []) {
    if (typeof block.text === 'string') parts.push(block.text)
    if (Array.isArray(block.items)) parts.push(...block.items)
    if (block.type === 'cta' && typeof block.label === 'string') parts.push(block.label)
  }
  return parts.join('\n')
}

/**
 * @returns {{hardLength:number, softLength:number,
 *   hard:{ok:true}|{ok:false, code:'BODY_TOO_SHORT'|'BODY_TOO_LONG', message:string, packetLabel:string},
 *   soft:{ok:true}|{ok:false, message:string}}}
 */
export function measureBody(article) {
  const hardLength = publishText(article).length
  const softLength = bodyBlocksText(article).replace(/\s/g, '').length
  let hard = { ok: true }
  if (hardLength < HARD_BODY.min) {
    hard = { ok: false, code: 'BODY_TOO_SHORT', message: `본문 ${hardLength}자 — ${HARD_BODY.min}자 미만이면 잘린 응답으로 본다` }
  } else if (hardLength > HARD_BODY.max) {
    hard = { ok: false, code: 'BODY_TOO_LONG', message: `본문 ${hardLength}자 — ${HARD_BODY.max}자를 넘었다` }
  }
  if (!hard.ok) hard.packetLabel = `${hard.code}: 본문 ${hardLength}자 — 발행 기준 ${HARD_BODY.min}~${HARD_BODY.max}자 (제목·설명·본문, 공백·줄바꿈 포함). 이 범위 안으로 줄이거나 늘린다`
  const soft = softLength < SOFT_BODY.min || softLength > SOFT_BODY.max
    ? { ok: false, message: `본문 ${softLength}자 — 권장 ${SOFT_BODY.min}~${SOFT_BODY.max}자` }
    : { ok: true }
  return { hardLength, softLength, hard, soft }
}
