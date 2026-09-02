/**
 * 원고 관문 — 디스크에 닿기 전에 막는다.
 *
 * 🔴 저장한 뒤에 검사하지 않는다.
 *    지금까지는 fetchManuscript 가 먼저 쓰고 webui-runner 가 describeDraft 로
 *    "표 🔴 · http 🔴" 를 화면에 보여주기만 했다. 사람이 그 줄을 안 읽으면
 *    오염된 원고가 그대로 남고, 다음 단계(md-to-draft)가 그것을 받는다.
 *    쓰기 전에 판정해야 "저장 금지" 가 성립한다.
 *
 * 🔴 실제로 새어 나간 적이 있다.
 *    after-holiday-body-ache 본문에 ChatGPT 인용 마커
 *    `:contentReference[oaicite:0]{index=0}` 가 그대로 들어가 production 에 공개됐다.
 *    md-to-draft 의 FORBIDDEN 8종(표·코드블록·h1·h4·이미지·링크·HTML·번호목록)은
 *    이 형태를 걸러 내지 못한다. 그래서 여기에 별도 규칙을 둔다.
 *
 * 🔴 원고를 고치지 않는다. 판정만 한다.
 *    자동으로 지워 주면 "무엇이 잘못됐는지" 를 아무도 보지 않게 된다.
 *    막고, 이유를 말하고, 사람이 brief 를 고치게 한다.
 *
 * 🔴 md-to-draft 의 규칙을 여기에 복사하지 않는다.
 *    저 파일이 정본이고 이 관문은 그보다 앞에서 "받을 수 없는 것" 만 본다.
 *    두 곳에 같은 목록을 두면 한쪽만 고쳐지는 날이 온다.
 */

/** 이보다 짧으면 원고가 아니다. fetchManuscript 의 대기 조건(900자)보다 넉넉히 잡는다. */
export const MIN_BODY_LENGTH = 1200

/** 한글이 이 비율보다 적으면 한국어 본문이 아니다. */
export const MIN_HANGUL_RATIO = 0.3

/**
 * 생성기가 남기는 흔적 — 사람이 쓴 글에는 나올 수 없는 것들.
 *
 * 🔴 contentReference 가 첫 항목인 이유는 실제로 당했기 때문이다.
 *    ChatGPT 가 웹 검색을 쓰면 문장 끝에 인용 마커를 붙인다.
 */
const CONTAMINATION = [
  { re: /:contentReference\[/, why: 'ChatGPT 인용 마커(:contentReference)가 남아 있다' },
  { re: /【[^】]*†[^】]*】/, why: 'ChatGPT 각주 마커(【…†…】)가 남아 있다' },
  { re: /\[oaicite:/, why: 'ChatGPT 인용 id(oaicite)가 남아 있다' },
  { re: /\bturn\d+(?:search|view|image)\d+\b/, why: 'ChatGPT 도구 호출 흔적이 남아 있다' },
  // 🔴 "물론입니다 / 아래 원고입니다" 같은 대화체 인사를 따로 잡지 않는다.
  //    인사가 붙으면 원고가 --- 로 시작하지 않아 NO_FRONTMATTER 가 이미 잡는다.
  //    본문 단어로 잡으려 하면 오탐이 난다 — 실제 원고에 "여기서 중요한 것은…" 이 있다.
  //    관문의 오탐은 막지 못하는 것보다 나쁘다. 재고가 통째로 멈춘다.
  { re: /​|﻿/, why: '보이지 않는 문자(zero-width)가 섞여 있다' },
]

/** frontmatter 에 반드시 있어야 하는 키 — md-to-draft 의 REQUIRED_META 와 같다 */
const REQUIRED_META = ['title', 'description', 'cluster']

function hangulRatio(text) {
  // 공백·숫자·기호를 뺀 글자 중 한글 비율을 본다. 영어 원고를 받았을 때 잡는 것이 목적이다.
  const letters = text.replace(/[^A-Za-z가-힣]/g, '')
  if (letters.length === 0) return 0
  const hangul = letters.replace(/[^가-힣]/g, '')
  return hangul.length / letters.length
}

/**
 * 이 원고를 저장해도 되는가.
 *
 * @returns {{ ok: boolean, reasons: {code: string, why: string}[], stats: object }}
 */
export function validateManuscript(text) {
  const reasons = []
  const fail = (code, why) => reasons.push({ code, why })

  const raw = typeof text === 'string' ? text : ''
  const trimmed = raw.trim()

  // ── 비어 있는가 ──
  if (trimmed.length === 0) {
    return { ok: false, reasons: [{ code: 'EMPTY', why: '원고가 비어 있다' }], stats: { length: 0 } }
  }

  // ── frontmatter ──
  // 🔴 md-to-draft 가 --- 로 시작하기를 요구한다. 여기서 막지 않으면
  //    다음 단계에서 실패하는데, 그때는 이미 파일이 디스크에 있다.
  const hasOpen = trimmed.startsWith('---')
  if (!hasOpen) fail('NO_FRONTMATTER', 'YAML frontmatter 가 없다 — --- 로 시작해야 한다')

  let meta = {}
  let body = trimmed
  if (hasOpen) {
    const close = trimmed.indexOf('\n---', 3)
    if (close === -1) {
      fail('FRONTMATTER_UNCLOSED', 'frontmatter 가 닫히지 않았다')
    } else {
      const head = trimmed.slice(3, close)
      body = trimmed.slice(close + 4)
      for (const raw2 of head.split('\n')) {
        const line = raw2.trim()
        if (!line) continue
        const i = line.indexOf(':')
        if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
      }
      for (const key of REQUIRED_META) {
        if (!meta[key]) fail('META_MISSING', `frontmatter 에 ${key} 가 없다`)
      }
    }
  }

  // ── 길이 ──
  // 🔴 frontmatter 를 뺀 본문으로 잰다. 메타만 길고 본문이 비면 통과해서는 안 된다.
  const bodyLength = body.trim().length
  if (bodyLength < MIN_BODY_LENGTH) {
    fail('TOO_SHORT', `본문이 ${bodyLength}자다 — ${MIN_BODY_LENGTH}자 미만은 원고로 보지 않는다`)
  }

  // ── 한국어인가 ──
  const ratio = hangulRatio(body)
  if (ratio < MIN_HANGUL_RATIO) {
    fail('NOT_KOREAN', `한글 비율 ${(ratio * 100).toFixed(0)}% — 한국어 본문이 아니다`)
  }

  // ── 생성기 흔적 ──
  for (const c of CONTAMINATION) {
    if (c.re.test(raw)) fail('CONTAMINATED', c.why)
  }

  // ── 구조 ──
  // h2 가 하나도 없으면 문단만 이어진 덩어리다. 매거진 본문 규격이 아니다.
  const h2 = (body.match(/^## /gm) ?? []).length
  if (h2 === 0) fail('NO_SECTION', '## 소제목이 하나도 없다')

  return {
    ok: reasons.length === 0,
    reasons,
    stats: {
      length: raw.length,
      bodyLength,
      hangulRatio: Number(ratio.toFixed(3)),
      h2,
      cta: (raw.match(/\[CTA\]/g) ?? []).length,
      title: meta.title ? '있음' : '없음',
      cluster: meta.cluster ?? null,
    },
  }
}

/** 사람이 읽는 한 줄 — 로그와 Slack 이 같은 문장을 쓴다 */
export function describeReasons(reasons) {
  return reasons.map((r) => `${r.code}: ${r.why}`).join(' / ')
}
