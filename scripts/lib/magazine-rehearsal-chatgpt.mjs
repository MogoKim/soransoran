/**
 * 🔴 **rehearsal 의 ChatGPT** — webui-runner 가 `SORAN_MAGAZINE_TEST_FIXTURE` 로 읽는 fixture 모듈 (2026-10-10).
 *
 *    실제 webui-runner 의 전송 경계(장부 예약 · composer 확인 · send · 응답 판독 · 원고 관문)는 그대로 돈다.
 *    갈아끼우는 것은 브라우저 하나뿐이다 — `connect` 가 가짜 page 를 돌려준다. 9333·9344 에 닿지 않는다.
 *
 *    page 계약은 m3a 시험의 가짜와 같다: send 전에는 assistant 응답 0, send 뒤에는 `readConversationDom` 이
 *    새 assistant 응답 1(코드블록 = 원고)을 돌려준다.
 *
 *    무엇을 돌려줄지는 보낸 글자로 정한다:
 *      `[입력 수리 요청]` 으로 시작   → 수리 요청 (input-repair)
 *      재생성 지시가 들어 있음        → 재생성 (QA 실패 후)
 *      그 밖                          → 최초 원고 요청
 *    시나리오(`fixture/scenario.json` 의 `chatgpt[slug]`)가 회차별 응답 모양을 고른다 (기본 good).
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.SORAN_REHEARSAL_ROOT
const REPO = join(ROOT, 'repo')
const FIX = join(ROOT, 'fixture')
const L = await import(pathToFileURL(join(REPO, 'scripts/lib/magazine-load.mjs')).href)
const C = await import(pathToFileURL(join(REPO, 'scripts/lib/magazine-rehearsal-content.mjs')).href)
/** 🔴 의료 플래그는 실제 QA 정본에서 */
const { MEDICAL_REQUIRED } = await import(pathToFileURL(join(REPO, 'scripts/magazine-qa.mjs')).href)

const log = (e) => appendFileSync(join(FIX, 'calls.jsonl'), `${JSON.stringify({ tool: 'chatgpt', at: new Date().toISOString(), ...e })}\n`)

function kindOf(text) {
  if (text.startsWith('[입력 수리 요청]')) return 'repair'
  if (/재생성|다시 써|고쳐 써|QA_FAIL|이전 원고/.test(text)) return 'regen'
  return 'initial'
}

/** 보낸 글자에서 큐 항목 — 제목이 들어 있는 것 (가장 긴 제목 우선) */
function itemOf(text) {
  const queue = L.loadQueue()
  return queue.filter((q) => text.includes(q.title)).sort((a, b) => b.title.length - a.title.length)[0]
    ?? queue.find((q) => text.includes(q.slug)) ?? null
}

function replyFor(text) {
  const item = itemOf(text)
  const kind = kindOf(text)
  if (!item) { log({ kind, error: 'SLUG_UNKNOWN', head: text.slice(0, 80) }); return '응답을 만들 수 없다' }
  const file = join(FIX, 'scenario.json')
  const st = JSON.parse(readFileSync(file, 'utf8'))
  const calls = st.chatgptCalls ?? {}
  const key = `${item.slug}:${kind}`
  calls[key] = (calls[key] ?? 0) + 1
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify({ ...st, chatgptCalls: calls }, null, 2)}\n`)
  renameSync(tmp, file)
  const plan = st.chatgpt?.[key] ?? []
  const mode = plan[calls[key] - 1] ?? 'good'
  log({ slug: item.slug, kind, call: calls[key], mode })
  return C.manuscriptFor({ repo: REPO, draftsDir: L.DRAFTS_DIR, slug: item.slug, item, mode, medicalRequired: MEDICAL_REQUIRED })
}

function makePage() {
  let typed = ''
  let sent = false
  let reply = null
  let url = 'https://chatgpt.com/'
  const composer = { async click() {}, async innerText() { return typed }, async fill(t) { typed = String(t ?? '') } }
  const sendBtn = {
    async click() {
      sent = true
      reply = replyFor(typed)
      url = `https://chatgpt.com/c/rehearsal-${Date.now().toString(36)}`
    },
  }
  return {
    async goto(u) { url = String(u ?? url) }, async waitForSelector() {}, async waitForTimeout() {}, async waitForFunction() {}, async close() {},
    url: () => url,
    async evaluate(fn) {
      if (fn?.name !== 'readConversationDom') return null
      if (!sent) return { readOk: true, stop: false, units: [] }
      return { readOk: true, stop: false, units: [{ id: 'rehearsal-assistant-1', role: 'assistant', source: 'new', candidates: [{ form: 'code-block', text: reply }], text: '', hasActions: true }] }
    },
    async evaluateHandle() { return { asElement: () => ({ async setInputFiles() {} }) } },
    locator(sel) {
      const l = /send-button|보내기|Send/.test(String(sel ?? '')) ? sendBtn : composer
      return { first: () => l, async all() { return [l] }, ...l }
    },
    keyboard: { async insertText(t) { typed += String(t ?? '') }, async press() {} },
  }
}

const fixture = {
  probe: async () => { log({ op: 'probe' }); return { status: 'ok', ok: true } },
  ensureTab: async () => ({ ok: true }),
  connect: async () => ({ contexts: () => [{ pages: () => [], newPage: async () => makePage() }], async close() {} }),
  fetchTiming: { pollMs: 5, stablePolls: 2, timeoutMs: 5000 },
}
export default fixture
