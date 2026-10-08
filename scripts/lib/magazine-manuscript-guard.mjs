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
 * 🔴 md-to-draft 의 규칙을 여기에 복사하지 않는다 — **같은 함수를 부른다** (2026-10-08).
 *    판정 정본은 `magazine-manuscript-format.mjs` 다. md-to-draft CLI 도 그 함수를 쓴다.
 *    앞판은 `[CTA]` 를 세기만 했다. `clinic-booking-app` 은 CTA 0개로 저장됐고, 다음 단계가
 *    CONVERT_FAILED 로 멈췄다. 변환할 수 없는 원고는 **저장 전에** 막는다.
 */
import { REQUIRED_SECTIONS } from './magazine-brief-policy.mjs'
import { judgeManuscriptFormat, describeFormatViolation } from './magazine-manuscript-format.mjs'

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

/**
 * 🔴 **brief(작업지시서)를 원고로 받지 않는다** (2026-10-02 자연 회차 실측).
 *
 *    재생성 응답으로 `cold-weather-joint-pain`·`autumn-low-mood` 의 **brief 가 그대로** 돌아왔다.
 *    frontmatter·`##`·`[CTA]` 를 다 갖췄고 1200자를 넘었으므로 위 검사를 전부 통과해
 *    draft.md 를 덮었다. 원고에는 brief 의 섹션 소제목(`## 검색 의도` · `## 글 구조` …)이 나올 수 없다.
 *
 *    판정 근거는 **정본 하나**다 — `REQUIRED_SECTIONS` (magazine-brief-policy.mjs). 목록을 여기 다시 적지 않는다.
 *    원고의 `##` 소제목이 그중 하나와 **같으면** brief echo 다.
 *
 *    🔴 그 글의 brief `##` 전체와 비교하지 않는다. 최근 brief 는 원고에 쓸 소제목을 `##` 줄로
 *       그대로 적어 두므로, 정상 원고 5건(contact-old-friend-first 등)이 echo 로 오탐됐다 (운영 52건 실측).
 *    🔴 본문 문장도 비교하지 않는다 — "반드시 그대로 넣을 문장" 은 원고에 그대로 들어가는 것이 정상이다.
 */
const headingsOf = (text) => (String(text ?? '').match(/^##[ \t]+.+$/gm) ?? [])
  .map((h) => h.replace(/^##[ \t]+/, '').trim())

const BRIEF_OWN_HEADINGS = new Set(REQUIRED_SECTIONS)

export function briefEchoHeadings(body) {
  return headingsOf(body).filter((h) => BRIEF_OWN_HEADINGS.has(h))
}

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

  const echo = briefEchoHeadings(body)
  if (echo.length) {
    fail('BRIEF_ECHO', `원고가 아니라 brief(작업지시서)다 — brief 섹션 소제목이 있다: ${echo.slice(0, 3).map((h) => `## ${h}`).join(' · ')}`)
  }

  // ── 변환 가능한 형식인가 — md-to-draft 와 같은 판정 ──
  // 🔴 frontmatter 가 아예 없거나 닫히지 않았으면 위에서 이미 막았다. 같은 사유를 두 번 적지 않는다.
  const format = judgeManuscriptFormat(raw)
  if (hasOpen && !reasons.some((r) => r.code === 'FRONTMATTER_UNCLOSED')) {
    for (const v of format.violations) fail('FORMAT_VIOLATION', describeFormatViolation(v))
  }

  return {
    ok: reasons.length === 0,
    reasons,
    /** 🔴 구조화된 형식 위반 — 사람용 문장을 다시 파싱하지 않게 그대로 싣는다 */
    formatViolations: format.violations,
    stats: {
      length: raw.length,
      bodyLength,
      hangulRatio: Number(ratio.toFixed(3)),
      h2,
      cta: format.blocks.filter((b) => b.type === 'cta').length,
      title: meta.title ? '있음' : '없음',
      cluster: meta.cluster ?? null,
    },
  }
}

/** 사람이 읽는 한 줄 — 로그와 Slack 이 같은 문장을 쓴다 */
export function describeReasons(reasons) {
  return reasons.map((r) => `${r.code}: ${r.why}`).join(' / ')
}
