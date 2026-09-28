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
 *    ④ 코드블록과 일반 마크다운 응답을 **둘 다** 읽는다. 원고 검증(frontmatter·H2·CTA)은 호출부가 그대로 한다.
 *    ⑤ 시간을 늘려 해결하지 않는다 — 판정을 바르게 한다.
 *
 * 🔴 `readConversationDom` 은 `page.evaluate` 로 **브라우저 안에서** 돈다. 모듈 밖의 어떤 것도 참조하지 않는다.
 *    DOM API 는 `children` · `parentElement` · `tagName` · `getAttribute` · `textContent` 만 쓴다 —
 *    시험은 같은 API 를 가진 작은 트리(실측 DOM 골격)로 이 함수를 그대로 돌린다.
 */

/**
 * 대화의 구조화 스냅숏.
 * @returns {{readOk:boolean, stop:boolean, units:{id:string|null, role:'assistant'|'user', source:'new'|'old',
 *            codeBlocks:string[], markdown:string, hasActions:boolean}[]}}
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
  const cls = (e) => String(attr(e, 'class') ?? '')

  const STOP_LABELS = /^(스트리밍 중지|응답 중지|중지|Stop streaming|Stop generating|Stop)$/i
  // 🔴 완료 액션은 **턴 수준**의 것만 센다 — 코드블록 머리표의 "복사" 는 생성 중에도 보인다 (실측)
  const DONE_LABELS = /^(응답 다시 생성|다시 생성|Regenerate|Try again)$/i
  const COPY_LABELS = /^(복사|Copy|Copy response)$/i
  const stop = all.some((e) => attr(e, 'data-testid') === 'stop-button'
    || (tag(e) === 'button' && STOP_LABELS.test(String(attr(e, 'aria-label') ?? '').trim())))

  /** 렌더된 마크다운을 원문 마크다운으로 되돌린다 — 코드블록이 없는 응답용 */
  const toMarkdown = (e) => {
    const blocks = []
    const inline = (x) => text(x).replace(/ /g, ' ')
    const visit = (x) => {
      for (const c of kids(x)) {
        const t = tag(c)
        if (attr(c, 'data-markdown-copy') === 'exclude') continue
        if (t === 'h4' && attr(c, 'data-conversation-role')) continue
        if (/sr-only/.test(cls(c))) continue
        if (attr(c, 'data-markdown-copy') === 'code-block' || t === 'pre') {
          const code = within(c).find((y) => tag(y) === 'code')
          blocks.push({ k: 'code', v: text(code ?? c) })
          continue
        }
        const hm = /^h([1-6])$/.exec(t)
        if (hm) { blocks.push({ k: 'h', n: Number(hm[1]), v: inline(c).trim() }); continue }
        if (t === 'p') { blocks.push({ k: 'p', v: inline(c).trim() }); continue }
        if (t === 'hr') { blocks.push({ k: 'hr' }); continue }
        if (t === 'ul' || t === 'ol') {
          let i = 0
          for (const li of kids(c).filter((y) => tag(y) === 'li')) { i += 1; blocks.push({ k: 'li', v: `${t === 'ol' ? `${i}.` : '-'} ${inline(li).trim()}` }) }
          continue
        }
        if (t === 'blockquote') { blocks.push({ k: 'q', v: inline(c).trim().split('\n').map((l) => `> ${l}`).join('\n') }); continue }
        if (t === 'table') { blocks.push({ k: 'p', v: inline(c).trim() }); continue }
        if (kids(c).length) visit(c)
        else if (inline(c).trim()) blocks.push({ k: 'p', v: inline(c).trim() })
      }
    }
    visit(e)
    const out = []
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i]
      // 🔴 frontmatter 가 렌더되면 `<hr>` + setext `<h2>(title: …)` 가 된다 — 원문 `---\n…\n---` 로 되돌린다
      if (i === 0 && b.k === 'hr' && blocks[1]?.k === 'h' && blocks[1].n === 2 && /^[a-zA-Z_]+\s*:/.test(blocks[1].v)) {
        out.push(`---\n${blocks[1].v}\n---`); i += 1; continue
      }
      if (b.k === 'hr') out.push('---')
      else if (b.k === 'h') out.push(`${'#'.repeat(b.n)} ${b.v}`)
      else if (b.k === 'code') out.push(b.v.replace(/\n$/, ''))
      else if (b.k === 'li') {
        const prev = out.length ? out[out.length - 1] : ''
        if (i > 0 && blocks[i - 1].k === 'li') out[out.length - 1] = `${prev}\n${b.v}`
        else out.push(b.v)
      } else out.push(b.v)
    }
    return out.join('\n\n')
  }

  const readUnit = (e, role, id, source) => {
    const sub = within(e)
    const codeBlocks = source === 'new'
      ? sub.filter((x) => attr(x, 'data-markdown-copy') === 'code-block')
        .map((x) => within(x).find((y) => tag(y) === 'code')).filter(Boolean).map(text)
      : sub.filter((x) => tag(x) === 'pre').map((x) => within(x).find((y) => tag(y) === 'code') ?? x).map(text)
    const content = source === 'new'
      ? sub.find((x) => attr(x, 'data-markdown-text-style') === 'assistant-message')
      : sub.find((x) => /(^|\s)markdown(\s|$)/.test(cls(x)))
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
    return { id, role, source, codeBlocks, markdown: content ? toMarkdown(content) : '', hasActions }
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

/**
 * 응답 하나에서 원고 원문을 꺼낸다 — 🔴 검증은 하지 않는다(호출부 몫).
 * @returns {{ok:true, text:string, via:'code-block'|'markdown'}|{ok:false, why:string}}
 */
export function extractManuscript(unit) {
  const blocks = (unit?.codeBlocks ?? []).map((t) => String(t ?? ''))
  const fm = blocks.filter((t) => t.trimStart().startsWith('---'))
  if (fm.length === 1) return { ok: true, text: fm[0], via: 'code-block' }
  if (fm.length > 1) return { ok: false, why: `frontmatter 로 시작하는 코드블록이 ${fm.length}개다 — 어느 것이 원고인지 모른다` }
  const md = String(unit?.markdown ?? '')
  if (md.trim()) return { ok: true, text: md, via: 'markdown' }
  if (blocks.length === 1 && blocks[0].trim()) return { ok: true, text: blocks[0], via: 'code-block' }
  return { ok: false, why: '응답에서 원고를 찾지 못했다' }
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
  return {
    observe(snap) {
      const pick = pickNewAssistant(baseline, snap)
      if (pick.state === 'AMBIGUOUS' || pick.state === 'UNREADABLE') {
        return { done: false, abort: true, code: pick.state === 'AMBIGUOUS' ? 'response_ambiguous' : 'response_unreadable', why: pick.why }
      }
      if (pick.state === 'NONE') { lastText = null; same = 0; return { done: false, phase: 'waiting' } }
      const ex = extractManuscript(pick.unit)
      const finished = !snap.stop && (pick.unit.source === 'old' || pick.unit.hasActions)
      const t = ex.ok ? ex.text : null
      if (t !== null && t === lastText) same += 1
      else { lastText = t; same = t !== null ? 1 : 0 }
      if (finished && t !== null && same >= stablePolls) {
        return { done: true, text: t, via: ex.via, messageId: pick.unit.id }
      }
      return { done: false, phase: finished ? 'stabilizing' : 'generating', partial: t?.length ?? 0, why: ex.ok ? null : ex.why }
    },
  }
}
