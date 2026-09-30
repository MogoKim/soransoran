/**
 * ChatGPT 응답 회수 — **전송 뒤 새로 생긴 assistant 응답 하나만**, 끝났고 안정됐을 때만 읽는다.
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 새로 만들었나** (2026-09-28 운영 실측).
 *    옛 판은 "마지막 `pre code` 가 `---` 로 시작하고 `[CTA]` 를 포함" 을 완료로 봤다.
 *    ChatGPT 가 화면을 바꾸면서 코드블록이 **`<pre>` 없이** 렌더되고(`[data-markdown-copy="code-block"]` 안의
 *    `code`), `data-message-author-role` 도 사라졌다. 원고가 다 왔는데도 영원히 완료를 못 알아보고
 *    5분 뒤 `response_timeout` — 그날 회수 4/5 · 재생성 4/4 가 그렇게 끝났다.
 *
 * 🔴 **원칙**
 *    ① 전송 **전** 대화 상태를 기준선으로 적고, 전송 **뒤 새로 생긴** assistant 응답만 본다.
 *       화면의 "마지막 텍스트" 를 가져오지 않는다 — 이전 응답·사람의 다른 대화를 오인한다.
 *    ② 새 응답이 둘 이상이거나 식별할 수 없으면 **판정 불가** — 저장하지 않는다(DELIVERY_UNCERTAIN).
 *    ③ 생성 중 표시가 없고 · 완료 액션이 보이고 · **내용이 연속 관찰에서 같을 때만** 끝난 것으로 본다.
 *    ④ 원문 후보는 두 형태뿐이다 — `pre code`(코드블록) 와 `data-markdown-copy="rich-block"` 의
 *       `data-markdown-copy-text` 속성. 그 밖의 형태는 **추측하지 않는다** — 전송불명으로 멈춘다.
 *       (2026-09-30: 응답이 rich-block 으로 왔고, 렌더된 화면을 되살리던 앞판이 블록 위 **제목 머리표**까지
 *        원고로 읽어 `---` 로 시작하지 않았다 — NO_FRONTMATTER · 저장 0.) 원고 검증은 호출부가 그대로 한다.
 *    ⑤ 시간을 늘려 해결하지 않는다 — 판정을 바르게 한다.
 *
 * 🔴 `readConversationDom` 은 `page.evaluate` 로 **브라우저 안에서** 돈다. 모듈 밖의 어떤 것도 참조하지 않는다.
 *    DOM API 는 `children` · `parentElement` · `tagName` · `getAttribute` · `textContent` 만 쓴다 —
 *    시험은 같은 API 를 가진 작은 트리(실측 DOM 골격)로 이 함수를 그대로 돌린다.
 */

/**
 * 대화의 구조화 스냅숏.
 * @returns {{readOk:boolean, stop:boolean, units:{id:string|null, role:'assistant'|'user', source:'new'|'old',
 *            candidates:{form:'code-block'|'rich-block', text:string|null}[], text:string, hasActions:boolean}[]}}
 */
export function readConversationDom(doc) {
  const d = doc ?? (typeof document !== 'undefined' ? document : null)
  if (!d) return { readOk: false, stop: false, units: [] }
  const root = d.body ?? d
  const kids = (e) => Array.from(e?.children ?? [])
  const all = []
  const walk = (e) => { for (const c of kids(e)) { all.push(c); walk(c) } }
  walk(root)
  const attr = (e, n) => (e && e.getAttribute ? e.getAttribute(n) : null)
  const tag = (e) => String(e?.tagName ?? '').toLowerCase()
  const text = (e) => String(e?.textContent ?? '')
  const within = (e) => { const out = []; const w = (x) => { for (const c of kids(x)) { out.push(c); w(c) } }; w(e); return out }

  const STOP_LABELS = /^(스트리밍 중지|응답 중지|중지|Stop streaming|Stop generating|Stop)$/i
  // 🔴 완료 액션은 **턴 수준**의 것만 센다 — 코드블록 머리표의 "복사" 는 생성 중에도 보인다 (실측)
  const DONE_LABELS = /^(응답 다시 생성|다시 생성|Regenerate|Try again)$/i
  const COPY_LABELS = /^(복사|Copy|Copy response)$/i
  const stop = all.some((e) => attr(e, 'data-testid') === 'stop-button'
    || (tag(e) === 'button' && STOP_LABELS.test(String(attr(e, 'aria-label') ?? '').trim())))

  /**
   * 🔴 **사용자 메시지의 글자만** — 화면 조작 요소의 글자는 뺀다 (2026-09-30 실측).
   *    긴 메시지는 말풍선 끝에 `<span aria-hidden>…</span>` 과 "더 보기" 버튼(`data-thread-find-skip`)이 붙는다.
   *    그 글자까지 읽으면 **우리가 보낸 바로 그 메시지**가 신원 대조에서 다른 글로 보인다.
   *    `childNodes` 가 없는 트리(시험 골격)는 전체 글자를 쓴다 — 골격도 같은 요소를 넣어 이 분기를 시험한다.
   */
  const SKIP_IN_MESSAGE = (x) => tag(x) === 'button' || attr(x, 'aria-hidden') === 'true' || attr(x, 'data-thread-find-skip') !== null
  const messageText = (x) => {
    if (SKIP_IN_MESSAGE(x)) return ''
    const nodes = x?.childNodes
    if (!nodes) return text(x)
    let out = ''
    for (const n of Array.from(nodes)) {
      if (n.nodeType === 3) out += String(n.textContent ?? '')
      else if (n.nodeType === 1) out += messageText(n)
    }
    return out
  }
  const readUnit = (e, role, id, source) => {
    const sub = within(e)
    /**
     * 🔴 **원문 후보는 두 형태뿐이다.** 화면에 그려진 글자(제목·머리표·본문)를 모아 원고로 만들지 않는다.
     *    ① rich-block — `data-markdown-copy-text` 속성 **만** 원문이다. 블록 안에는 같은 원문을 담은
     *       편집기(`contenteditable` 속 `pre code`)와 제목 머리표가 있다 — 둘 다 후보가 아니다 (2026-09-30 실측).
     *    ② 코드블록 — `pre code`, 또는 `pre` 없이 그려지는 `data-markdown-copy="code-block"` 의 `code` (2026-09-28 실측).
     *       rich-block **안**의 것은 세지 않는다 — 같은 원문을 두 번 세면 "여러 개" 로 잘못 멈춘다.
     */
    const richBlocks = sub.filter((x) => attr(x, 'data-markdown-copy') === 'rich-block')
    const insideRich = (x) => {
      for (let p = x.parentElement, n = 0; p && p !== e && n < 60; p = p.parentElement, n += 1) {
        if (attr(p, 'data-markdown-copy') === 'rich-block') return true
      }
      return false
    }
    const codeOf = (x) => within(x).find((y) => tag(y) === 'code') ?? null
    const codeHosts = sub.filter((x) => !insideRich(x) && (tag(x) === 'pre'
      || (attr(x, 'data-markdown-copy') === 'code-block' && !within(x).some((y) => tag(y) === 'pre'))))
    const candidates = [
      ...richBlocks.map((x) => ({ form: 'rich-block', text: attr(x, 'data-markdown-copy-text') })),
      ...codeHosts.map((x) => ({ form: 'code-block', text: text(codeOf(x) ?? x) })),
    ]
    // 완료 액션 — 새 DOM 은 응답 단위 **밖**(같은 턴 안)에 붙는다
    let scope = e
    for (let p = e.parentElement, n = 0; p && n < 12; p = p.parentElement, n += 1) {
      if (attr(p, 'data-turn-key') || attr(p, 'data-testid')?.startsWith?.('conversation-turn')) { scope = p; break }
    }
    const inCodeBlock = (x) => {
      for (let p = x.parentElement, n = 0; p && p !== scope && n < 20; p = p.parentElement, n += 1) {
        if (attr(p, 'data-markdown-copy')) return true
      }
      return false
    }
    const hasActions = within(scope).some((x) => {
      if (tag(x) !== 'button') return false
      const label = String(attr(x, 'aria-label') ?? '').trim()
      return DONE_LABELS.test(label) || (COPY_LABELS.test(label) && !inCodeBlock(x))
    })
    // 🔴 `text` 는 사용자 메시지의 신원 대조용이다 — 원고 후보로 쓰지 않는다
    const bubble = sub.find((x) => attr(x, 'data-user-message-bubble') === 'true')
    return { id, role, source, candidates, text: role === 'user' ? messageText(bubble ?? e) : '', hasActions }
  }

  const units = []
  const seen = new Set()
  for (const e of all) {
    const key = attr(e, 'data-chatgpt-search-unit-key')
    const m = key ? /:(assistant|user)$/.exec(key) : null
    if (!m) continue
    const id = String(attr(e, 'data-chatgpt-search-message-ids') ?? '').split(/\s+/).filter(Boolean)[0] ?? null
    const k = `new:${id ?? key}`
    if (seen.has(k)) continue
    seen.add(k)
    units.push(readUnit(e, m[1], id, 'new'))
  }
  for (const e of all) {
    const role = attr(e, 'data-message-author-role')
    if (role !== 'assistant' && role !== 'user') continue
    const id = attr(e, 'data-message-id')
    const k = `old:${id ?? units.length}`
    if (seen.has(k)) continue
    seen.add(k)
    units.push(readUnit(e, role, id, 'old'))
  }
  return { readOk: true, stop, units }
}

const assistants = (snap) => (snap?.units ?? []).filter((u) => u.role === 'assistant')

/**
 * 기준선 이후 **새로 생긴** assistant 응답.
 * @returns {{state:'UNREADABLE'|'NONE'|'ONE'|'AMBIGUOUS', unit?:object, why?:string}}
 */
export function pickNewAssistant(baseline, snap) {
  if (!baseline?.readOk || !snap?.readOk) return { state: 'UNREADABLE', why: '대화 상태를 읽지 못했다' }
  const before = assistants(baseline)
  const now = assistants(snap)
  if (before.some((u) => !u.id) || now.some((u) => !u.id)) {
    // 🔴 id 가 없는 응답이 섞이면 "새 것" 을 가릴 수 없다 — 추측하지 않는다
    return { state: 'AMBIGUOUS', why: '식별자 없는 assistant 응답이 있다 — 새 응답을 가릴 수 없다' }
  }
  const base = new Set(before.map((u) => u.id))
  const fresh = now.filter((u) => !base.has(u.id))
  const lost = before.filter((u) => !now.some((x) => x.id === u.id))
  if (lost.length) return { state: 'AMBIGUOUS', why: `기준선의 응답 ${lost.length}개가 사라졌다 — 다른 대화일 수 있다` }
  if (fresh.length === 0) return { state: 'NONE' }
  if (fresh.length > 1) return { state: 'AMBIGUOUS', why: `새 응답이 ${fresh.length}개다 — 하나로 가릴 수 없다` }
  return { state: 'ONE', unit: fresh[0] }
}

/** 원문을 감싼 ```markdown · ``` 표시**만** 벗긴다. 감싸지 않았으면 그대로 둔다 */
export function stripMarkdownFence(raw) {
  const t = String(raw ?? '')
  const m = /^```[ \t]*(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n)?$/.exec(t)
  return m ? m[1] : t
}

/**
 * 응답 하나에서 원고 원문을 꺼낸다 — 🔴 검증은 하지 않는다(호출부 몫).
 *
 * 🔴 후보가 **정확히 하나**일 때만 꺼낸다. 여럿이면 고르지 않고, 없으면(모르는 형태) 추측하지 않는다.
 * @returns {{ok:true, text:string, via:'code-block'|'rich-block'}
 *          |{ok:false, code:string, form:'code-block'|'rich-block'|'unknown'|'multiple', why:string}}
 */
export function extractManuscript(unit) {
  const cands = unit?.candidates ?? []
  if (cands.length === 0) {
    return { ok: false, code: 'response_format_unknown', form: 'unknown', why: '원문 후보(pre code · rich-block)가 없다 — 모르는 형태는 추측하지 않는다' }
  }
  if (cands.length > 1) {
    return { ok: false, code: 'response_multiple_candidates', form: 'multiple',
      why: `원문 후보가 ${cands.length}개다 (${cands.map((c) => c.form).join(', ')}) — 임의로 고르지 않는다` }
  }
  const c = cands[0]
  if (c.form === 'rich-block') {
    if (c.text === null || !String(c.text).trim()) {
      return { ok: false, code: 'response_rich_block_empty', form: 'rich-block', why: 'rich-block 에 원문 속성(data-markdown-copy-text)이 없거나 비었다' }
    }
    return { ok: true, text: stripMarkdownFence(c.text), via: 'rich-block' }
  }
  if (!String(c.text ?? '').trim()) {
    return { ok: false, code: 'response_format_unknown', form: 'code-block', why: '코드블록이 비었다' }
  }
  return { ok: true, text: c.text, via: 'code-block' }
}

/**
 * 관찰기 — 매 폴링의 스냅숏을 넣으면 끝났는지 말한다.
 *
 * 🔴 끝났다 = 새 응답 정확히 하나 · 생성 중 표시 없음 · (새 DOM 이면) 완료 액션 있음 ·
 *    꺼낸 원문이 **연속 `stablePolls` 번 같다.** 하나라도 모자라면 계속 본다.
 *    판정 불가(AMBIGUOUS·UNREADABLE)는 즉시 멈춘다 — 저장하지 않는다.
 */
export function createResponseWatch(baseline, { stablePolls = 3 } = {}) {
  let lastText = null
  let same = 0
  let failStreak = 0
  return {
    observe(snap) {
      const pick = pickNewAssistant(baseline, snap)
      if (pick.state === 'AMBIGUOUS' || pick.state === 'UNREADABLE') {
        return { done: false, abort: true, code: pick.state === 'AMBIGUOUS' ? 'response_ambiguous' : 'response_unreadable', why: pick.why, form: 'unknown', messageId: null }
      }
      if (pick.state === 'NONE') { lastText = null; same = 0; failStreak = 0; return { done: false, phase: 'waiting' } }
      const ex = extractManuscript(pick.unit)
      const finished = !snap.stop && (pick.unit.source === 'old' || pick.unit.hasActions)
      const t = ex.ok ? ex.text : null
      if (t !== null && t === lastText) same += 1
      else { lastText = t; same = t !== null ? 1 : 0 }
      if (finished && t !== null && same >= stablePolls) {
        return { done: true, text: t, via: ex.via, messageId: pick.unit.id }
      }
      /**
       * 🔴 **끝났는데도 원문을 못 꺼내는 상태가 연속되면 멈춘다** — 모르는 형태·여러 후보·빈 속성.
       *    기다린다고 바뀌지 않는다. 보낸 뒤이므로 결말은 전송불명(DELIVERY_UNCERTAIN)이다.
       */
      failStreak = finished && !ex.ok ? failStreak + 1 : 0
      if (failStreak >= stablePolls) {
        return { done: false, abort: true, code: ex.code, why: ex.why, form: ex.form, messageId: pick.unit.id }
      }
      return { done: false, phase: finished ? 'stabilizing' : 'generating', partial: t?.length ?? 0,
        why: ex.ok ? null : ex.why, messageId: pick.unit.id, form: ex.ok ? ex.via : ex.form }
    },
  }
}
