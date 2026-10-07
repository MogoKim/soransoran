#!/usr/bin/env node
/**
 * page 0건 복구 검사 — 신원 관문이 「정확한 프로필 · 실행 중 · page 0」 에서만 ChatGPT 탭 하나를 열고
 * 전체 신원을 다시 보는지, 그 밖의 불일치에서는 탭을 하나도 열지 않는지 본다 (2026-10-07 자연 회차 결함).
 *
 * 🔴 **실제 Chrome · ChatGPT 에 닿지 않는다.** 신원 판정은 실제 `verifyAutomationProfile` →
 *    `judgeAutomationProfile` 을 쓰고, 주입하는 것은 입력(표식 · 명령줄 · 포트 · 페이지 목록)과
 *    탭을 여닫는 함수·목록뿐이다. probe 는 신원 다음 단계(`browserCheck`)에서 멈춘다 — 메시지 입력·send 0.
 *
 * 🔴 `CHATGPT_ZERO_PAGE_LIB_DIR` 는 변이 시험(`chatgpt-zero-page-mutation.mjs`)이 바꾼 lib 폴더를 넣는 자리다.
 *
 * 사용: node scripts/chatgpt-zero-page-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 🔴 **실제 CDP 포트로 가는 요청을 전부 막는다** (2026-10-07 사고).
 *    수정 뒤 코드로 주입 없는 재현 스크립트를 돌렸다가, 기본값 `/json/new` 가 이 기기의 **운영 자동화
 *    Chrome 에 실제 ChatGPT 탭 2개**를 열었다. 시험이 주입을 빠뜨려도 실제 브라우저에 닿지 않게,
 *    127.0.0.1·localhost 의 9333/9344 요청은 던지고 시도 자체를 실패로 센다.
 */
const realCdpAttempts = []
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input)
  if (/^https?:\/\/(127\.0\.0\.1|localhost):(9333|9344)\b/.test(url)) {
    realCdpAttempts.push(url)
    throw new Error(`시험이 실제 CDP 에 닿으려 했다: ${url}`)
  }
  return realFetch(input, init)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = process.env.CHATGPT_ZERO_PAGE_LIB_DIR ?? path.join(HERE, 'lib')
const SESS = await import(pathToFileURL(path.join(LIB, 'chatgpt-session.mjs')).href)
const AP = await import(pathToFileURL(path.join(LIB, 'chatgpt-automation-profile.mjs')).href)

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const finish = () => console.log(`\n${fail ? '🔴' : '✅'} page 0건 복구 검사 ${pass}/${pass + fail}\n`)
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e.message}`); finish(); process.exit(1) })
process.on('unhandledRejection', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.message ?? e}`); finish(); process.exit(1) })

const CHATGPT_PAGE = { id: 'T-new', type: 'page', url: 'https://chatgpt.com/' }
const GOOD_MARKER = { schemaVersion: 1, purpose: AP.MARKER_PURPOSE, cdpPort: AP.AUTOMATION_CDP_PORT }
const OUR_CMD = `Chrome --user-data-dir=${AP.AUTOMATION_PROFILE_DIR} --remote-debugging-port=${AP.AUTOMATION_CDP_PORT}`

/**
 * 가짜 세계 — 실제 판정 함수에 넣을 입력과, 탭을 열면 목록에 page 가 생기는 브라우저.
 * `over` 로 표식·권한·명령줄·포트·목록 읽기를 바꾼다.
 */
function world(over = {}) {
  const state = {
    pages: over.pages ?? [],
    readOk: over.readOk ?? true,
    portInUse: over.portInUse ?? true,
    opens: 0,
    lagReads: over.lagReads ?? 0,
    /** 닫기를 요청받은 id 전부 — 자기가 연 것 말고는 하나도 없어야 한다 */
    closes: [],
    /** 이번 시험에서 openTargetFn 이 돌려준 id */
    openedIds: [],
  }
  const verifyProfileFn = (args = {}) => SESS.verifyAutomationProfile({
    ...args,
    // 🔴 신원 계약은 실제 자동화 폴더 경로다. 잠금 판정용 임시 폴더(아래)와 섞지 않는다
    profileDir: AP.AUTOMATION_PROFILE_DIR,
    // 🔴 `marker: null` 은 「표식 없음」 이다 — `??` 로 정상 표식이 되지 않게 키 존재로 가른다
    readMarkerFn: () => ('marker' in over && !over.marker
      ? { ok: false, why: '용도 표식이 없다' }
      : { ok: true, marker: over.marker ?? GOOD_MARKER, mode: over.markerMode ?? 0o600, dirMode: over.dirMode ?? 0o700 }),
    commandLinesFn: () => over.commandLines ?? [OUR_CMD],
    portInUseFn: async () => state.portInUse,
    listTargets: async () => {
      if (!state.readOk) return { readOk: false, pages: null }
      // 목록 반영이 늦는 상황 — 연 직후 몇 번은 아직 0건으로 보인다
      if (state.lagReads > 0 && state.opens > 0) { state.lagReads -= 1; return { readOk: true, pages: [] } }
      return { readOk: true, pages: state.pages }
    },
  })
  const openTargetFn = async () => {
    state.opens += 1
    if (over.openFails) return { ok: false, why: '시험: /json/new 거부' }
    const target = over.openedTarget ?? CHATGPT_PAGE
    if (target.id) state.openedIds.push(target.id)
    state.pages = [...state.pages, target, ...(over.afterOpenExtra ?? [])]
    return { ok: true, target }
  }
  const closeTargetFn = async (id) => {
    state.closes.push(id)
    if (over.closeFails) return { ok: false, why: '시험: /json/close 거부' }
    if (!over.closeLingers) state.pages = state.pages.filter((t) => t.id !== id)
    return { ok: true }
  }
  const listTargetsFn = async () => (over.listAfterCloseFails ? { readOk: false, targets: null } : { readOk: true, targets: state.pages })
  /** 자기가 연 것이 아닌 id 를 닫으려 한 기록 */
  const foreignCloses = () => state.closes.filter((id) => !state.openedIds.includes(id))
  return { state, verifyProfileFn, openTargetFn, closeTargetFn, listTargetsFn, foreignCloses }
}

/** probe 를 신원 관문 다음 단계에서 멈춘다 — browserCheck=false 면 BROWSER_MISSING 으로 끝난다(실제 CDP 0) */
const inj = (w) => ({ verifyProfileFn: w.verifyProfileFn, openTargetFn: w.openTargetFn, closeTargetFn: w.closeTargetFn, listTargetsFn: w.listTargetsFn })
const probeIn = (w) => SESS.probe({ ...inj(w), browserCheck: () => false })
const bootIn = (w, args = { requireRunning: false }) => SESS.verifyWithZeroPageBootstrap(w.verifyProfileFn, args, { ...inj(w), settleTries: 3, settleMs: 5 })
/**
 * 🔴 **환경을 읽지 않는다.** 잠금 판정은 임시 폴더로 고정한다 — 실제 자동화 프로필은 지금
 *    운영 Chrome 이 쓰고 있어 LIVE 로 판정된다 (첫 실행에서 실제로 그렇게 걸렸다).
 */
const LOCK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-page-lock-'))
process.on('exit', () => fs.rmSync(LOCK_DIR, { recursive: true, force: true }))
const ensureIn = (w, over = {}) => {
  let spawned = 0
  return SESS.ensureChrome({
    waitMs: 200, pollMs: 20, browserCheck: () => true, processes: () => '', profileDir: LOCK_DIR,
    cdpCheck: async () => w.state.portInUse,
    spawnFn: () => { spawned += 1; return { unref() {} } },
    ...inj(w), ...over,
  }).then((r) => ({ r, spawned }))
}

console.log('\npage 0건 복구 — 신원 관문')

// ① 정확한 프로필 + 실행 중 + page 0 → 탭 1개 → 재검사 통과 → probe 진행
{
  const w = world()
  const p = await probeIn(w)
  check('① probe — 정확한 프로필 · 실행 중 · page 0 이면 ChatGPT 탭을 정확히 1개 연다', w.state.opens === 1, `opens ${w.state.opens}`)
  check('① probe — 탭을 연 뒤 전체 신원 재검사를 통과해 다음 단계로 진행한다', p.status === SESS.STATUS.BROWSER_MISSING && p.zeroPageBootstrap?.opened === true,
    `${p.status} · ${JSON.stringify(p.zeroPageBootstrap)}`)
  check('① probe — 메시지 입력·send 경로에 닿지 않았다 (CDP 연결 0)', p.connected === false, `connected ${p.connected}`)
  const w2 = world()
  const e = await ensureIn(w2)
  check('① ensureChrome(hero 경로) — page 0 이면 탭 1개를 열고 ok', e.r.ok === true && w2.state.opens === 1 && e.spawned === 0,
    `ok ${e.r.ok} · opens ${w2.state.opens} · spawn ${e.spawned} · ${e.r.why ?? ''}`)
  check('① ensureChrome — 기록에 복구가 남는다', e.r.zeroPageBootstrap?.opened === true, JSON.stringify(e.r.zeroPageBootstrap))
  const w3 = world({ lagReads: 2 })
  const e3 = await ensureIn(w3)
  check('① 목록 반영이 늦어도 탭은 1개만 열고 기다린 뒤 통과한다', e3.r.ok === true && w3.state.opens === 1, `ok ${e3.r.ok} · opens ${w3.state.opens} · ${e3.r.why ?? ''}`)
  const w4 = world({ pages: [CHATGPT_PAGE] })
  const e4 = await ensureIn(w4)
  check('① ChatGPT page 가 이미 있으면 탭을 열지 않는다', e4.r.ok === true && w4.state.opens === 0, `opens ${w4.state.opens}`)
}

// ② 목록 읽기 실패 → 탭 0
{
  const w = world({ readOk: false })
  const p = await probeIn(w)
  const e = await ensureIn(world({ readOk: false }))
  check('② 페이지 목록을 못 읽으면 탭 생성 0 · MISMATCH (probe)', w.state.opens === 0 && p.status === SESS.STATUS.AUTOMATION_PROFILE_MISMATCH && /읽지 못했다/.test(p.errorDetail ?? ''),
    `opens ${w.state.opens} · ${p.status} · ${p.errorDetail}`)
  check('② 목록 읽기 실패는 ensureChrome 에서도 ok 가 아니다', e.r.ok === false && /읽지 못했다/.test(e.r.why ?? ''), e.r.why)
}

// ③ 다른 호스트 page → 탭 0
for (const [name, pages] of [
  ['다른 호스트 page 만', [{ type: 'page', url: 'https://www.google.com/' }]],
  ['ChatGPT + 다른 호스트 page', [CHATGPT_PAGE, { type: 'page', url: 'https://mail.google.com/' }]],
  ['운영 중 auth.openai.com', [{ type: 'page', url: 'https://auth.openai.com/log-in' }]],
]) {
  const w = world({ pages })
  const p = await probeIn(w)
  check(`③ ${name} → 탭 생성 0 · MISMATCH`, w.state.opens === 0 && p.status === SESS.STATUS.AUTOMATION_PROFILE_MISMATCH, `opens ${w.state.opens} · ${p.status}`)
}

// ④ 표식 · 폴더 권한 · 포트 주인 · 명령줄 불일치 → 탭 0
for (const [name, over] of [
  ['표식 용도가 다르다', { marker: { ...GOOD_MARKER, purpose: 'someone-else' } }],
  ['표식 포트가 다르다', { marker: { ...GOOD_MARKER, cdpPort: 9333 } }],
  ['표식 권한 0644', { markerMode: 0o644 }],
  ['폴더 권한 0755', { dirMode: 0o755 }],
  ['포트 주인이 다른 프로세스', { commandLines: ['Chrome --user-data-dir=/tmp/other --remote-debugging-port=9344'] }],
  ['같은 폴더 · 다른 포트', { commandLines: [`Chrome --user-data-dir=${AP.AUTOMATION_PROFILE_DIR} --remote-debugging-port=9222`] }],
]) {
  const w = world(over)
  const p = await probeIn(w)
  const w2 = world(over)
  const e = await ensureIn(w2)
  check(`④ ${name} → 탭 생성 0 (probe · ensureChrome)`, w.state.opens === 0 && w2.state.opens === 0 && p.status === SESS.STATUS.AUTOMATION_PROFILE_MISMATCH && e.r.ok === false,
    `opens ${w.state.opens}/${w2.state.opens} · ${p.status} · ${p.errorDetail}`)
}

// ⑤ target 생성 실패 → 안전 중단
{
  const w = world({ openFails: true })
  const p = await probeIn(w)
  check('⑤ /json/new 실패 → 안전 중단 (MISMATCH · 진행 0)', p.status === SESS.STATUS.AUTOMATION_PROFILE_MISMATCH && /열지 못했다/.test(p.errorDetail ?? '') && w.state.opens === 1,
    `${p.status} · ${p.errorDetail}`)
  const e = await ensureIn(world({ openFails: true }))
  check('⑤ ensureChrome 도 ok 가 아니다', e.r.ok === false && /열지 못했다/.test(e.r.why ?? ''), e.r.why)
}

// ⑥ 생성된 target 이 ChatGPT 가 아니다 → 안전 중단
for (const [name, openedTarget] of [
  ['about:blank', { id: 'T-x', type: 'page', url: 'about:blank' }],
  ['다른 호스트', { id: 'T-y', type: 'page', url: 'https://example.com/' }],
  ['page 가 아닌 target', { id: 'T-z', type: 'service_worker', url: 'https://chatgpt.com/sw.js' }],
]) {
  const w = world({ openedTarget })
  const p = await probeIn(w)
  check(`⑥ 열린 target 이 ChatGPT page 가 아니다(${name}) → 안전 중단`, p.status === SESS.STATUS.AUTOMATION_PROFILE_MISMATCH && /ChatGPT page 가 아니다/.test(p.errorDetail ?? ''),
    `${p.status} · ${p.errorDetail}`)
}
{
  // ChatGPT 탭은 열렸지만 그 사이 남의 페이지가 나타났다 — 재검사가 잡아야 한다
  const w = world({ afterOpenExtra: [{ type: 'page', url: 'https://www.youtube.com/' }] })
  const p = await probeIn(w)
  check('⑥ 탭을 연 뒤 전체 신원 재검사가 실패하면 진행하지 않는다', p.status === SESS.STATUS.AUTOMATION_PROFILE_MISMATCH && /재검사 실패/.test(p.errorDetail ?? ''),
    `${p.status} · ${p.errorDetail}`)
}

// ⑦ Chrome 이 꺼진 상태의 auto-start 회귀
{
  // 꺼져 있다 → spawn → Chrome 이 chatgpt.com 으로 뜬다 → 탭 생성 0
  const w = world({ portInUse: false })
  let polls = 0
  const e = await ensureIn(w, {
    cdpCheck: async () => { polls += 1; if (polls > 1) { w.state.portInUse = true; w.state.pages = [CHATGPT_PAGE] } return w.state.portInUse },
  })
  check('⑦ Chrome 이 꺼져 있으면 띄우고 통과한다 (탭 생성 0)', e.r.ok === true && e.r.started === true && e.spawned === 1 && w.state.opens === 0,
    `ok ${e.r.ok} · started ${e.r.started} · spawn ${e.spawned} · opens ${w.state.opens}`)
  // 띄웠는데 아직 page 0 → 복구 1회
  const w2 = world({ portInUse: false })
  let polls2 = 0
  const e2 = await ensureIn(w2, { cdpCheck: async () => { polls2 += 1; if (polls2 > 1) w2.state.portInUse = true; return w2.state.portInUse } })
  check('⑦ 띄운 직후 page 0 이면 탭 1개를 열고 통과한다', e2.r.ok === true && e2.r.started === true && w2.state.opens === 1, `ok ${e2.r.ok} · opens ${w2.state.opens} · ${e2.r.why ?? ''}`)
  // 꺼진 상태에서 표식이 틀리면 띄우지도 않는다
  const w3 = world({ portInUse: false, marker: null })
  const e3 = await ensureIn(w3)
  check('⑦ 꺼진 상태에서 표식이 틀리면 spawn 0 · 탭 0', e3.r.ok === false && e3.spawned === 0 && w3.state.opens === 0, `spawn ${e3.spawned} · ${e3.r.why}`)
}

// ⑧ hero 경로 — hero runner 는 ensureChrome 하나에 달려 있다
{
  const HERO_SRC = (await import('node:fs')).readFileSync(path.join(HERE, 'magazine-hero-runner.mjs'), 'utf8')
  check('⑧ hero runner 는 ensureChrome 을 거친 뒤에 탭을 연다', /const boot = await ensureChrome\(\)[\s\S]{0,400}ensurePageTarget\(\)/.test(HERO_SRC), 'ensureChrome → ensurePageTarget 순서')
  const w = world()
  const e = await ensureIn(w)
  check('⑧ hero 경로(ensureChrome) page 0 → 탭 1개 · ok', e.r.ok === true && w.state.opens === 1, `ok ${e.r.ok} · opens ${w.state.opens}`)
}

// ⑨ 로그인 모드는 page 0 을 원래대로 허용한다 — 복구가 끼어들지 않는다
{
  const w = world()
  const r = await bootIn(w, { mode: 'login', requireRunning: true })
  check('⑨ 로그인 모드 page 0 은 그대로 ok · 탭 생성 0', r.ok === true && w.state.opens === 0, `ok ${r.ok} · opens ${w.state.opens}`)
  const judged = AP.judgePages(null, { readOk: false })
  check('⑨ 읽기 실패 판정에는 zeroPage 가 붙지 않는다', judged.ok === false && judged.zeroPage !== true, JSON.stringify(judged))
  const foreign = AP.judgePages([{ type: 'page', url: 'https://www.google.com/' }])
  check('⑨ 남의 페이지 판정에는 zeroPage 가 붙지 않는다', foreign.ok === false && foreign.zeroPage !== true, JSON.stringify(foreign))
}

// ⑩ 실패하면 이번 호출이 연 target 하나만 공통 helper 로 정리한다 (Codex 재검토 P1 · 2회)
//    🔴 closed=true 는 목록에서 사라진 것을 읽어 확인했을 때만이다. close 요청 성공은 closeRequestOk 다
console.log('\npage 0건 복구 — 실패 정리')
const OLD_CHATGPT = { id: 'P-old', type: 'page', url: 'https://chatgpt.com/c/old' }
const LATE_FOREIGN = { id: 'P-late', type: 'page', url: 'https://www.youtube.com/' }
const LATE_CHATGPT = { id: 'P-late-gpt', type: 'page', url: 'https://chatgpt.com/' }
const cleanupIs = (cl, want) => !!cl && Object.entries(want).every(([k, v]) => cl[k] === v)
/** 정리 계약 4종 — 같은 단언을 공통 bootstrap · probe · hero 에 똑같이 건다 */
const CLEANUP_CASES = [
  ['close 성공 · 실제 제거', {}, { closeAttempted: true, closeRequestOk: true, closed: true, residue: 'none' }, /연 탭\(T-new\)은 닫혔다/],
  ['close 200 · target 잔존', { closeLingers: true }, { closeAttempted: true, closeRequestOk: true, closed: false, residue: 'present' }, /정리 실패 — residue present · 닫기 요청 뒤에도 목록에 남아 있다/],
  ['close 뒤 목록 읽기 실패', { listAfterCloseFails: true }, { closeAttempted: true, closeRequestOk: true, closed: false, residue: 'unknown' }, /정리 실패 — residue unknown · 닫은 뒤 목록을 읽지 못해/],
  ['close 요청 실패', { closeFails: true }, { closeAttempted: true, closeRequestOk: false, closed: false, residue: 'present' }, /정리 실패 — residue present · 닫기 요청 실패/],
]
for (const [name, over, want, whyRe] of CLEANUP_CASES) {
  // 공통 bootstrap — 탭을 연 뒤 외부 page 가 나타나 재검사가 실패한다
  const w = world({ afterOpenExtra: [LATE_FOREIGN], ...over })
  const r = await bootIn(w)
  check(`⑩ bootstrap · ${name} → ${JSON.stringify(want)}`, r.ok === false && cleanupIs(r.bootstrap?.cleanup, want) && whyRe.test(r.why ?? '') && /재검사 실패/.test(r.why ?? ''),
    `${JSON.stringify(r.bootstrap?.cleanup)} · ${r.why}`)
  check(`⑩ bootstrap · ${name} → 자기 target 만 close 요청 · 외부 page 보존`, JSON.stringify(w.state.closes) === '["T-new"]' && w.state.pages.some((t) => t.id === 'P-late'),
    `closes ${JSON.stringify(w.state.closes)}`)
  // probe — 같은 결과 계약
  const wp = world({ afterOpenExtra: [LATE_FOREIGN], ...over })
  const p = await probeIn(wp)
  check(`⑩ probe · ${name} → 같은 계약 · MISMATCH 유지`, p.status === SESS.STATUS.AUTOMATION_PROFILE_MISMATCH && cleanupIs(p.identity?.bootstrap?.cleanup, want) && whyRe.test(p.errorDetail ?? ''),
    `${p.status} · ${JSON.stringify(p.identity?.bootstrap?.cleanup)} · ${p.errorDetail}`)
  // hero(ensureChrome) — 떠 있는 Chrome 에서 pre 가 탭을 열고, post 재확인 직전에 외부 page 가 나타난다
  const wh = world(over)
  let calls = 0
  const vf = async (a) => { calls += 1; if (calls === 3) wh.state.pages = [...wh.state.pages, LATE_FOREIGN]; return wh.verifyProfileFn(a) }
  const e = await ensureIn({ ...wh, verifyProfileFn: vf }, { settleTries: 3, settleMs: 5 })
  check(`⑩ hero · ${name} → 같은 helper 계약 · ok=false 유지`, e.r.ok === false && e.r.reason === SESS.STATUS.AUTOMATION_PROFILE_MISMATCH && cleanupIs(e.r.zeroPageBootstrap?.cleanup, want) && whyRe.test(e.r.why ?? ''),
    `${JSON.stringify(e.r.zeroPageBootstrap?.cleanup)} · ${e.r.why}`)
  // 가짜 브라우저의 실제 목록과 기록이 맞아야 한다 — 닫혔다고 적었으면 정말 없어야 하고, 잔존이면 정말 있어야 한다
  const stillThere = wh.state.pages.some((t) => t.id === 'T-new')
  const recordMatches = want.residue === 'none' ? !stillThere : want.residue === 'present' ? stillThere : true
  check(`⑩ hero · ${name} → 자기 target 만 close 요청 · 외부 page 보존 · 기록이 실제 목록과 일치`,
    JSON.stringify(wh.state.closes) === '["T-new"]' && wh.state.pages.some((t) => t.id === 'P-late') && recordMatches,
    `closes ${JSON.stringify(wh.state.closes)} · pages ${wh.state.pages.map((t) => t.id).join(',')}`)
}
{
  const w = world({ openedTarget: { id: 'T-blank', type: 'page', url: 'about:blank' }, afterOpenExtra: [LATE_CHATGPT] })
  const r = await bootIn(w)
  check('⑩ 잘못된 target 생성 → 자기 target 1번 close · 실제 제거 확인', r.ok === false && JSON.stringify(w.state.closes) === '["T-blank"]'
    && cleanupIs(r.bootstrap?.cleanup, { closed: true, residue: 'none' }) && !w.state.pages.some((t) => t.id === 'T-blank'), JSON.stringify(r.bootstrap))
  check('⑩ 잘못된 target — 그 사이 나타난 ChatGPT page 는 닫지 않는다', w.foreignCloses().length === 0 && w.state.pages.some((t) => t.id === 'P-late-gpt'),
    `closes ${JSON.stringify(w.state.closes)}`)
}
{
  const w = world({ lagReads: 99 })
  const r = await bootIn(w)
  check('⑩ 재검사가 계속 page 0 → 자기 target close · 실패', r.ok === false && JSON.stringify(w.state.closes) === '["T-new"]' && /재검사 실패/.test(r.why ?? ''),
    `closes ${JSON.stringify(w.state.closes)} · ${r.why}`)
}
{
  const w = world({ openedTarget: { type: 'page', url: 'about:blank' } })
  const r = await bootIn(w)
  check('⑩ target id 가 없다 → close 0 (추측 금지) · residue unknown · 실패 유지', r.ok === false && w.state.closes.length === 0
    && cleanupIs(r.bootstrap?.cleanup, { closeAttempted: false, closed: false, residue: 'unknown' }) && /추측해 닫지 않는다/.test(r.why ?? ''),
    `closes ${JSON.stringify(w.state.closes)} · ${JSON.stringify(r.bootstrap)}`)
  check('⑩ 공통 정리 helper(cleanupZeroPageTarget)가 있다', typeof SESS.cleanupZeroPageTarget === 'function')
  for (const bad of typeof SESS.cleanupZeroPageTarget === 'function' ? ['', '../json/version', 'a b'] : []) {
    const cl = await SESS.cleanupZeroPageTarget(bad, { closeTargetFn: w.closeTargetFn, listTargetsFn: w.listTargetsFn })
    check(`⑩ helper — 잘못된 id ${JSON.stringify(bad)} 는 close 0`, cl.closeAttempted === false && cl.closed === false && w.state.closes.length === 0, JSON.stringify(cl))
  }
}
{
  const w = world()
  const r = await bootIn(w)
  check('⑩ 성공 → close 0 · 새 ChatGPT target 유지 · cleanup 없음', r.ok === true && w.state.closes.length === 0 && w.state.pages.some((t) => t.id === 'T-new') && r.bootstrap?.cleanup === null,
    `ok ${r.ok} · closes ${JSON.stringify(w.state.closes)}`)
  const w2 = world({ pages: [OLD_CHATGPT] })
  const r2 = await bootIn(w2)
  check('⑩ 이미 있던 ChatGPT page → open 0 · close 0', r2.ok === true && w2.state.opens === 0 && w2.state.closes.length === 0, `opens ${w2.state.opens} · closes ${w2.state.closes.length}`)
}
{
  // hero — pre 가 탭을 열지 않았다(기존 page 로 통과) → post 실패에도 close 0
  const w = world({ pages: [OLD_CHATGPT] })
  let calls = 0
  const vf = async (a) => { calls += 1; if (calls === 2) w.state.pages = [...w.state.pages, LATE_FOREIGN]; return w.verifyProfileFn(a) }
  const e = await ensureIn({ ...w, verifyProfileFn: vf })
  check('⑩ hero — pre 가 탭을 열지 않았으면 post 실패에도 close 0 · 기존 page 보존', e.r.ok === false && w.state.closes.length === 0 && e.r.zeroPageBootstrap === undefined
    && w.state.pages.some((t) => t.id === 'P-old'), `closes ${JSON.stringify(w.state.closes)}`)
}
{
  // 어떤 실패에서도 기존·외부 page 는 닫지 않는다
  const cases = [
    world({ pages: [OLD_CHATGPT, LATE_FOREIGN] }),
    world({ readOk: false }),
    world({ openFails: true }),
    world({ openedTarget: { id: 'T-sw', type: 'service_worker', url: 'https://chatgpt.com/sw.js' }, afterOpenExtra: [LATE_FOREIGN] }),
    world({ afterOpenExtra: [LATE_FOREIGN, LATE_CHATGPT] }),
    world({ afterOpenExtra: [LATE_FOREIGN], closeFails: true }),
    world({ afterOpenExtra: [LATE_FOREIGN], closeLingers: true }),
    world({ marker: null }),
  ]
  for (const w of cases) { await bootIn(w); await probeIn(w); await ensureIn(w, { settleTries: 2, settleMs: 5 }) }
  const foreign = cases.flatMap((w) => w.foreignCloses())
  check('⑩ 다른 기존·외부 page 는 어떤 실패에서도 close 0 (bootstrap · probe · hero)', foreign.length === 0, JSON.stringify(foreign))
}

check('실제 CDP 포트 요청 0 (운영 Chrome 에 닿지 않았다)', realCdpAttempts.length === 0, realCdpAttempts.join(' · '))
finish()
process.exitCode = fail ? 1 : 0
