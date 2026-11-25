/**
 * Magazine vNext S4 — **fake provider** (rehearsal · 검사 전용). 실제 adapter 와 같은 wire({ httpStatus, bodyText })를 낸다 —
 * 생산기는 fake 와 실제를 구분하지 않고 같은 저장 · 해석 · 삭제 경로를 지난다.
 *
 * 🔴 이것은 자동 생산 결과가 아니다. 원고는 ProviderPlan 의 칸(primaryQuery · audienceSituation · answerScope)을 정해진 틀에 끼운
 *    **합성 문장**이고, hero 는 heroScene 해시로 칠한 추상 그림이다. Job 의 provider.kind 가 'fake' 로 남는다.
 *    생산기 CLI 는 fake 를 운영 Job 저장소에 쓰지 않는다(rehearsal 의 격리 저장소만).
 *
 * remote  원격 상태(응답 · 삭제 · 호출 기록) — 시험이 "프로세스 재시작" 사이에 같은 객체를 넘겨 원격이 살아 있는 것을 흉내 낸다.
 * faults  primaryQuery → { submit, poll, output, remove, image } 큐. 호출마다 앞에서 하나씩 꺼낸다(없으면 정상).
 *   submit  'TRANSPORT'(원격은 받았는데 응답이 끊김) · 'HTTP_500' · 'HTTP_429' · 'HTTP_401' · 'HTTP_400' · 'NO_ID' · 'ZDR'
 *   poll    'SLOW:<n>'(n 번 더 in_progress) · 'GONE'(404) · 'FAILED' · 'INCOMPLETE'
 *   output  'META_DESCRIPTION' · 'META_SENTENCE' · 'BANNED_SENTENCE' · 'DISCLAIMER' · 'FACT_STAT' · 'CTA_MISSING' · 'MARKDOWN' · 'STRUCTURE' · 'NOT_JSON' · 'MANY_BANNED'
 * faults.__remove · faults.__image — 삭제 · 이미지 요청은 ProviderPlan 을 싣지 않으므로 전역 큐다
 *   __remove  'HTTP_500' · 'HTTP_404'
 *   __image   'HTTP_500' · 'SQUARE' · 'SMALL' · 'DUP'
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { ProviderTransportError } from './magazine-provider.mjs'
import { BANNED_WORDS } from './magazine-qa-constants.mjs'

/** 금칙 호칭 반례 문장 — 낱말은 정본 상수에서만 온다 */
const [W0, W1, , W3] = BANNED_WORDS
const BANNED_RE = new RegExp(BANNED_WORDS.join('|'), 'g')

const sha = (s) => createHash('sha256').update(s).digest('hex')
const ok = (json) => ({ httpStatus: 200, bodyText: JSON.stringify(json) })
const err = (status, code) => ({ httpStatus: status, bodyText: JSON.stringify({ error: { code, message: code } }) })

export function makeRemote({ store = true } = {}) {
  return { store, seq: 0, responses: {}, images: [], calls: { submit: [], retrieve: [], remove: [], image: [] } }
}

/** 요청 바디 → (kind, ProviderPlan, 수리 대상) — fake 는 실제 provider 처럼 바디만 안다 */
function readBody(bodyText) {
  const b = JSON.parse(bodyText)
  const text = b.input?.[0]?.content?.[0]?.text
  if (b.text?.format?.name === 'magazine_repair') { const p = JSON.parse(text); return { kind: 'repair', plan: p.providerPlan, target: p.target, model: b.model } }
  return { kind: 'manuscript', plan: JSON.parse(text), model: b.model }
}

// ── 합성 원고 ────────────────────────────────────────────────

const hasJong = (s) => { const c = String(s).trim().slice(-1).charCodeAt(0); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 }
const eun = (s) => `${s}${hasJong(s) ? '은' : '는'}`
const eul = (s) => `${s}${hasJong(s) ? '을' : '를'}`
const VARIANTS = [
  (h) => `${h}에서 막히는 이유는 대개 무엇을 남기고 무엇을 덜어 낼지 기준이 없기 때문입니다. 먼저 지금 상황에서 가장 확인하고 싶은 것을 한 줄로 적어 두고, 그 기준에 맞는 것만 남기면 생각이 훨씬 단순해집니다.`,
  (h) => `같은 내용이라도 순서와 표현에 따라 받아들이는 인상이 달라집니다. ${eun(h)} 한 번에 한 가지씩 나누어 보고 이유를 짧게 붙여 두면, 다른 사람에게 설명하기도 쉬워집니다.`,
  (h) => `${eul(h)} 정할 때는 남이 정한 정답보다 지금 상황에 맞는 기준이 먼저입니다. 기준이 사람마다 다를 수 있다는 점을 인정하고, 필요하면 믿을 만한 안내를 함께 확인하면 덜 흔들립니다.`,
  (h) => `${eun(h)} 한 번에 끝내려고 하면 오히려 오래 걸립니다. 짧게 정리한 뒤 소리 내어 읽어 보고, 걸리는 부분만 고쳐 나가는 편이 낫습니다.`,
]

function sectionsOf(plan) {
  const scope = String(plan.answerScope)
  const tail = scope.includes('—') ? scope.split('—').pop() : ''
  const items = tail.split(/,\s*/).map((s) => s.trim()).filter((s) => s.length >= 2)
  if (items.length >= 4) return items.slice(0, 6)
  const key = String(plan.primaryQuery).replace(/[?？]/g, '').split(/\s+/).find((w) => w.length >= 2) ?? '이 고민'
  return ['지금 드는 마음부터 정리하기', `${eul(key).slice(0, -1)}${hasJong(key) ? '을' : '를'} 둘러싼 말들`, '서로의 기준이 다를 때', '대화를 이어 가는 방법']
}

function clampDescription(plan) {
  let d = `${String(plan.audienceSituation).replace(/[.。]\s*$/, '')}, 먼저 정리해 둘 기준을 모았습니다.`
  if (d.length > 150) d = `${d.slice(0, 120).replace(/\s\S*$/, '')}, 먼저 정리해 둘 기준을 모았습니다.`
  if (d.length < 60) d = `${d} ${String(plan.answerScope).slice(0, 80)}`.trim()
  return d
}

export function composeFakeManuscript(plan, faults = []) {
  const f = new Set(faults)
  const q = String(plan.primaryQuery).trim()
  const heads = sectionsOf(plan)
  const body = [{ type: 'p', text: `${q}라는 질문에는 하나의 정답보다 지금 상황에 맞는 기준이 먼저입니다. 이 글은 ${heads.slice(0, 3).join(', ')} 같은 자리를 차례로 짚습니다.` }]
  heads.forEach((h, i) => {
    body.push({ type: 'h2', text: h })
    body.push({ type: 'p', text: VARIANTS[i % 4](h) })
    body.push({ type: 'p', text: VARIANTS[(i + 1) % 4](h) })
    body.push({ type: 'p', text: VARIANTS[(i + 2) % 4](h) })
    if (i === 1) body.push({ type: 'list', items: ['지금 가장 확인하고 싶은 것 적기', '남길 것과 덜어 낼 것 나누기', '한 번에 한 가지씩 정리하기', '정리한 뒤 소리 내어 읽어 보기'], ordered: false })
  })
  body.push({ type: 'callout', text: `${q} — 기준은 사람마다 다를 수 있으니, 나와 상대의 상황을 함께 놓고 확인해 보세요.` })
  body.push({ type: 'cta', label: '우리 또래 이야기 나누기', text: '비슷한 고민을 하는 분들의 경험을 들어 보세요.' })
  const out = { title: q, description: clampDescription(plan), heroAlt: '책상 위에 펼쳐 둔 종이와 펜, 따뜻한 차 한 잔', heroScene: `${q}를 떠올리게 하는 생활 공간의 책상 위 사물`, slugProposal: `fake-${sha(q).slice(0, 10)}`, body }
  if (f.has('META_DESCRIPTION')) out.description = `description: ${out.description}`
  if (f.has('META_SENTENCE')) body.splice(0, 0, { type: 'p', text: '다음은 요청하신 기사 원고입니다.' })
  if (f.has('BANNED_SENTENCE')) body.splice(2, 0, { type: 'p', text: `${W1} 세대도 다시 시작할 수 있습니다.` })
  if (f.has('MANY_BANNED')) { body.splice(2, 0, { type: 'p', text: `${W1} 세대도 다시 시작할 수 있습니다.` }); body.splice(4, 0, { type: 'p', text: `${W0} 구직자에게 맞는 방법이 있습니다.` }); body.splice(6, 0, { type: 'p', text: `${W3} 세대의 경험은 자산입니다.` }) }
  if (f.has('DISCLAIMER') && plan.exclusions?.length) body.splice(1, 0, { type: 'p', text: `${plan.exclusions[0]}은 이 글에서 다루지 않습니다.` })
  if (f.has('FACT_STAT')) body.splice(2, 0, { type: 'p', text: '다시 일을 찾는 사람의 73%가 첫 칸에서 막힙니다.' })
  if (f.has('CTA_MISSING')) out.body = body.filter((b) => b.type !== 'cta')
  if (f.has('MARKDOWN')) body[2] = { ...body[2], text: `**${body[2].text}**` }
  if (f.has('STRUCTURE')) out.body = [{ type: 'p', text: q }, { type: 'p', text: '짧은 답입니다.' }, body[body.length - 1]]
  return out
}

/** 합성 수리 — 문제 칸만 바꾼다(호칭 교체 · 메타 문장 삭제 · 칸 재작성) */
export function composeFakeRepair(plan, target) {
  if (target.kind === 'field') {
    if (target.field === 'description') return clampDescription(plan)
    if (target.field === 'title') return String(plan.primaryQuery).trim()
    return '책상 위에 펼쳐 둔 종이와 펜, 따뜻한 차 한 잔'
  }
  const s = String(target.current)
  if (/요청하신|원고입니다|^\s*\[/.test(s)) return ''
  return s.replace(BANNED_RE, '우리 또래').replace(/반드시/g, '되도록')
}

// ── fake 를 실제 wire 로 ─────────────────────────────────────

export function makeFakeProviders({ remote, faults = {} }) {
  const take = (plan, kind) => (faults[plan?.primaryQuery]?.[kind] ?? []).shift() ?? null
  const outputFaultsOf = (plan) => faults[plan?.primaryQuery]?.output ?? []
  return {
    kind: 'fake',
    manuscript: {
      async submit(bodyText) {
        const req = readBody(bodyText)
        remote.calls.submit.push({ kind: req.kind, query: req.plan?.primaryQuery, inputSha256: sha(bodyText) })
        const fault = take(req.plan, 'submit')
        if (fault?.startsWith('HTTP_')) return err(Number(fault.slice(5)), fault)
        const id = `resp_fake_${String(++remote.seq).padStart(4, '0')}`
        const slow = take(req.plan, 'poll')
        const store = fault === 'ZDR' ? false : remote.store
        const output = req.kind === 'repair'
          ? JSON.stringify({ replacement: composeFakeRepair(req.plan, req.target) })
          : (() => { const fs = outputFaultsOf(req.plan).length ? [outputFaultsOf(req.plan).shift()] : []; return fs[0] === 'NOT_JSON' ? '원고를 JSON 으로 만들지 못했습니다.' : JSON.stringify(composeFakeManuscript(req.plan, fs)) })()
        remote.responses[id] = { status: 'queued', store, polls: 0, need: slow?.startsWith('SLOW:') ? 1 + Number(slow.slice(5)) : 1, end: slow && !slow.startsWith('SLOW:') ? slow : null,
          output, usage: { input_tokens: Math.ceil(bodyText.length / 3), output_tokens: Math.ceil(output.length / 2) }, deleted: false }
        if (fault === 'TRANSPORT') throw new ProviderTransportError('submit', { name: 'AbortError' })
        if (fault === 'NO_ID') return ok({ object: 'response', status: 'queued' })
        return ok({ id, object: 'response', status: 'queued', background: true, store })
      },
      async retrieve(id) {
        remote.calls.retrieve.push(id)
        const r = remote.responses[id]
        if (!r || r.deleted || r.end === 'GONE') return err(404, 'not_found')
        r.polls += 1
        if (r.polls < r.need) return ok({ id, object: 'response', status: 'in_progress', store: r.store })
        if (r.end === 'FAILED') return ok({ id, object: 'response', status: 'failed', store: r.store, error: { code: 'server_error' } })
        if (r.end === 'INCOMPLETE') return ok({ id, object: 'response', status: 'incomplete', store: r.store, incomplete_details: { reason: 'max_output_tokens' } })
        return ok({ id, object: 'response', status: 'completed', store: r.store, usage: r.usage,
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: r.output }] }] })
      },
      async remove(id) {
        remote.calls.remove.push(id)
        const r = remote.responses[id]
        const fault = (faults.__remove ?? []).shift() ?? null
        if (fault?.startsWith('HTTP_')) return err(Number(fault.slice(5)), fault)
        if (!r || r.deleted) return err(404, 'not_found')
        r.deleted = true
        return ok({ id, object: 'response', deleted: true })
      },
    },
    image: {
      async generate(bodyText) {
        const b = JSON.parse(bodyText)
        remote.calls.image.push({ prompt: b.prompt })
        const fault = (faults.__image ?? []).shift() ?? null
        if (fault === 'TRANSPORT') throw new ProviderTransportError('image', { name: 'AbortError' })
        if (fault?.startsWith('HTTP_')) return err(Number(fault.slice(5)), fault)
        const [w, h] = fault === 'SQUARE' ? [1024, 1024] : fault === 'SMALL' ? [960, 640] : [1536, 1024]
        let png
        if (fault === 'DUP' && remote.images.length) png = remote.images[remote.images.length - 1]
        else png = await fakeHeroPng(sha(`${b.prompt}:${remote.images.length}`), w, h)
        remote.images.push(png)
        return ok({ created: 0, data: [{ b64_json: png.toString('base64') }] })
      },
    },
  }
}

/** heroScene 해시로 칠한 추상 그림 — 무엇을 그렸는지 주장하지 않는다(fake 표식) */
async function fakeHeroPng(hash, w, h) {
  const c = (i) => `#${hash.slice(i, i + 6)}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c(0)}"/><stop offset="1" stop-color="${c(6)}"/></linearGradient></defs>`
    + `<rect width="100%" height="100%" fill="url(#g)"/><circle cx="${(parseInt(hash.slice(12, 16), 16) % w)}" cy="${(parseInt(hash.slice(16, 20), 16) % h)}" r="${h / 3}" fill="${c(20)}" opacity="0.55"/>`
    + `<rect x="${parseInt(hash.slice(26, 30), 16) % (w / 2)}" y="${h / 2}" width="${w / 3}" height="${h / 4}" fill="${c(30)}" opacity="0.5"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
