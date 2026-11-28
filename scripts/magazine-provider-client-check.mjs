#!/usr/bin/env node
/**
 * 매거진 네이티브 provider client 검사 — 실제 Swift 소스를 컴파일해 돌린다(macOS 전용).
 *
 *   node scripts/magazine-provider-client-check.mjs [--only N3,N7]
 *
 * 🔴 키체인 접근 0 · 네트워크 0 · 유료 호출 0 · 운영 HOME 쓰기 0.
 *    운영 빌드는 `version` 과 인자 오류만 실행한다(둘 다 키체인 · 네트워크에 닿기 전에 끝난다).
 *    요청 · status · grant 경로는 OFFLINE_TEST 빌드로 돈다 — 같은 소스에서 **키 읽기와 소켓 두 곳만** 가짜로 바꾼 것이다.
 *    그래서 이 검사가 증명하지 않는 것: 실제 키체인의 동의 창 동작 · 실제 TLS 전송. 그 둘은 운영자가 grant · status 로 확인한다.
 * 마지막 줄: `네이티브 client 검사: <n> pass, <n> fail`
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'darwin') { console.log('SKIP macOS 가 아니다\n네이티브 client 검사: 0 pass, 0 fail'); process.exit(0) }

const TMPS = []
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })
const tmp = (p = 'mpc-') => { const d = mkdtempSync(join(tmpdir(), p)); TMPS.push(d); return d }
// 🔴 운영 경로를 기본값으로 쓰는 코드가 있어도 닿지 않게 — import 전에 HOME 을 임시 폴더로 바꾼다
process.env.HOME = tmp('mpc-home-')

const PV = await import('./lib/magazine-provider.mjs')
const T = await import('./magazine-provider-client.mjs')
const sha = (b) => createHash('sha256').update(b).digest('hex')
const argv = process.argv.slice(2)
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null

let pass = 0, fail = 0
async function test(id, name, fn) {
  if (ONLY && !ONLY.includes(id)) return
  let ok = false, detail = ''
  try { const r = await fn(); ok = r === true || r?.ok === true; detail = r?.detail ?? '' } catch (e) { detail = `예외 ${e?.code ?? ''} ${e?.message ?? e}`.slice(0, 400) }
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${!ok && detail ? ` — ${String(detail).slice(0, 700)}` : ''}`)
}

// ── 빌드 (실제 소스 · 두 판) ──
const PROD = T.buildClient({ outDir: tmp('mpc-prod-') })
const TEST = T.buildClient({ outDir: tmp('mpc-test-'), offlineTest: true })
if (!PROD.ok || !TEST.ok) { console.log(`HARNESS 빌드 실패 — ${JSON.stringify({ PROD, TEST })}`); process.exit(2) }

const TEST_KEY_PREFIX = 'sk-offline-test-'
const raw = (bin, mode, input = '', env = {}) => spawnSync(bin, [mode], { input, encoding: 'utf8', env: { HOME: process.env.HOME, ...env }, timeout: 60_000 })
const out = (r) => PV.parseWire(String(r.stdout).trim())
const netLog = () => join(tmp('mpc-net-'), 'net.log')
const req = (fields) => JSON.stringify({ v: 1, timeoutMs: 5000, ...fields })

const plan = { primaryQuery: '경력 단절 이력서 쓰는 법', audienceSituation: '다시 일을 찾는다', answerScope: '이력서 칸 채우기' }
const manuscript = PV.buildManuscriptBody({ providerPlan: plan, model: 'gpt-6-luna', maxOutputTokens: 6000 })
const repair = PV.buildRepairBody({ providerPlan: plan, target: { kind: 'field', field: 'title', current: '제목', problems: ['TITLE_LENGTH'] }, model: 'gpt-6.1-terra', maxOutputTokens: 800 })
const image = PV.buildImageBody({ heroScene: '책상 위의 종이와 펜', model: 'gpt-image-2.5-flare', size: '1536x864' })
const edit = (bodyText, fn) => { const b = JSON.parse(bodyText); fn(b); return JSON.stringify(b) }

// ── 운영 빌드 — 키체인 · 네트워크에 닿지 않는 모드만 ──
await test('N1', '운영 빌드 — 계약 상수가 Node 와 같다 · ad hoc + hardened runtime 서명 · 검사용 코드가 들어 있지 않다', async () => {
  const v = await T.readBuiltVersion({ bin: PROD.bin })
  const sign = spawnSync('/usr/bin/codesign', ['-dv', PROD.bin], { encoding: 'utf8' }).stderr
  const bytes = readFileSync(PROD.bin).toString('latin1')
  const testBuild = await T.readBuiltVersion({ bin: TEST.bin })
  return { ok: v.ok && v.version.imageSize === '1536x864' && v.version.maxManuscriptTokens === 32000 && v.version.maxRepairTokens === 4000
    && /Signature=adhoc/.test(sign) && /runtime/.test(sign) && sign.includes(T.CLIENT_IDENTIFIER)
    && !bytes.includes('MPC_TEST_') && !bytes.includes(TEST_KEY_PREFIX) && !testBuild.ok && testBuild.build === 'OFFLINE_TEST',
  detail: JSON.stringify({ v, sign: sign.slice(0, 300), testBuild }) }
})
await test('N2', '운영 빌드 — 인자 없음 · 모르는 모드 · 인자 초과는 사용법 오류(종료 2)로 끝난다', () => {
  const rs = [spawnSync(PROD.bin, [], { encoding: 'utf8' }), spawnSync(PROD.bin, ['serve'], { encoding: 'utf8' }), spawnSync(PROD.bin, ['version', 'x'], { encoding: 'utf8' })]
  return { ok: rs.every((r) => r.status === 2 && out(r)?.code === 'USAGE' && r.stderr === ''), detail: JSON.stringify(rs.map((r) => [r.status, r.stdout])) }
})

// ── 요청 경로 (OFFLINE_TEST 빌드) ──
await test('N3', '네 요청 — method · host · path 고정 · 본문은 받은 바이트 그대로 · 키는 헤더로만 가고 출력에 없다 · 쿠키 0', () => {
  const log = netLog()
  const env = { MPC_TEST_KEY: 'ok', MPC_TEST_NET_LOG: log }
  const rs = {
    submit: raw(TEST.bin, 'request', req({ op: 'submit', body: manuscript.bodyText }), env),
    repair: raw(TEST.bin, 'request', req({ op: 'submit', body: repair.bodyText }), env),
    retrieve: raw(TEST.bin, 'request', req({ op: 'retrieve', id: 'resp_0123abcd' }), env),
    remove: raw(TEST.bin, 'request', req({ op: 'remove', id: 'resp_0123abcd' }), env),
    image: raw(TEST.bin, 'request', req({ op: 'image', body: image.bodyText }), env),
  }
  const echo = Object.fromEntries(Object.entries(rs).map(([k, r]) => [k, JSON.parse(out(r).body).echo]))
  const want = { submit: ['POST', '/v1/responses'], repair: ['POST', '/v1/responses'], retrieve: ['GET', '/v1/responses/resp_0123abcd'], remove: ['DELETE', '/v1/responses/resp_0123abcd'], image: ['POST', '/v1/images/generations'] }
  const shape = Object.entries(want).every(([k, [m, p]]) => echo[k].method === m && echo[k].url === `https://api.openai.com${p}` && echo[k].authOk === true && echo[k].hasCookie === false)
  const bytes = echo.submit.bodySha256 === sha(manuscript.bodyText) && echo.repair.bodySha256 === sha(repair.bodyText) && echo.image.bodySha256 === sha(image.bodyText)
    && echo.submit.contentType === 'application/json' && echo.retrieve.bodyBytes === 0 && echo.remove.bodyBytes === 0
  const quiet = Object.values(rs).every((r) => r.status === 0 && r.stderr === '' && !r.stdout.includes(TEST_KEY_PREFIX) && !/Bearer|Authorization/i.test(r.stdout) && out(r).ok === true && out(r).httpStatus === 200)
  return { ok: shape && bytes && quiet && readFileSync(log, 'utf8').trim().split('\n').length === 5, detail: JSON.stringify(echo) }
})
await test('N4', '계약 밖 요청 — 모델 · n · 크기 · 토큰 상한 · 여분 필드 · id · op · 시간 은 전송 0 · 키 읽기 0 으로 거절한다', () => {
  const log = netLog()
  // 키를 읽으려 들면 KEY_ERROR 가 나온다 — BAD_REQUEST 가 나왔다는 것은 키 읽기 전에 멈췄다는 뜻이다
  const env = { MPC_TEST_KEY: 'error', MPC_TEST_NET_LOG: log }
  const bad = {
    model: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.model = 'gpt-other' }) }),
    tokensOver: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.max_output_tokens = 32001 }) }),
    tokensZero: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.max_output_tokens = 0 }) }),
    tokensFloat: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.max_output_tokens = 10.5 }) }),
    repairOver: req({ op: 'submit', body: edit(repair.bodyText, (b) => { b.max_output_tokens = 4001 }) }),
    previous: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.previous_response_id = 'resp_0123abcd' }) }),
    tools: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.tools = [] }) }),
    storeOff: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.store = false }) }),
    storeOne: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.store = 1 }) }),
    foreground: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.background = false }) }),
    formatName: req({ op: 'submit', body: edit(manuscript.bodyText, (b) => { b.text.format.name = 'other' }) }),
    imageN: req({ op: 'image', body: edit(image.bodyText, (b) => { b.n = 2 }) }),
    imageSize: req({ op: 'image', body: edit(image.bodyText, (b) => { b.size = '1536x1024' }) }),
    imageModel: req({ op: 'image', body: edit(image.bodyText, (b) => { b.model = 'gpt-image-other' }) }),
    imageQuality: req({ op: 'image', body: edit(image.bodyText, (b) => { b.quality = 'high' }) }),
    imageExtra: req({ op: 'image', body: edit(image.bodyText, (b) => { b.user = 'x' }) }),
    imageAsText: req({ op: 'submit', body: image.bodyText }),
    textAsImage: req({ op: 'image', body: manuscript.bodyText }),
    idTraversal: req({ op: 'retrieve', id: '../models' }),
    idQuery: req({ op: 'remove', id: 'resp_0123abcd?x=1' }),
    idPrefix: req({ op: 'retrieve', id: 'abcd0123abcd' }),
    idWithBody: req({ op: 'retrieve', id: 'resp_0123abcd', body: '{}' }),
    opUnknown: req({ op: 'models' }),
    extraTop: req({ op: 'submit', body: manuscript.bodyText, url: 'https://redirect.invalid/' }),
    hostTop: req({ op: 'submit', body: manuscript.bodyText, host: 'redirect.invalid' }),
    timeoutOver: JSON.stringify({ v: 1, op: 'submit', timeoutMs: 120001, body: manuscript.bodyText }),
    timeoutMissing: JSON.stringify({ v: 1, op: 'submit', body: manuscript.bodyText }),
    version: JSON.stringify({ v: 2, op: 'submit', timeoutMs: 5000, body: manuscript.bodyText }),
    notJson: 'POST /v1/responses',
    empty: '',
    bodyNotJson: req({ op: 'submit', body: 'x' }),
  }
  const rs = Object.fromEntries(Object.entries(bad).map(([k, input]) => { const r = raw(TEST.bin, 'request', input, env); return [k, [r.status, out(r)?.code, out(r)?.sent]] }))
  const wrong = Object.entries(rs).filter(([, v]) => v.join() !== '10,BAD_REQUEST,false')
  return { ok: wrong.length === 0 && !existsSync(log), detail: JSON.stringify(wrong) }
})
await test('N5', '키 실패(없음 · 동의 없음 · 형식 · 그 밖) — 전송 0 으로 끝나고 sent:false 를 말한다', () => {
  const log = netLog()
  const modes = { notfound: 'KEY_NOT_FOUND', consent: 'KEY_CONSENT_REQUIRED', malformed: 'KEY_MALFORMED', error: 'KEY_ERROR' }
  const rs = Object.fromEntries(Object.entries(modes).map(([m]) => { const r = raw(TEST.bin, 'request', req({ op: 'submit', body: manuscript.bodyText }), { MPC_TEST_KEY: m, MPC_TEST_NET_LOG: log }); return [m, [r.status, out(r)?.code, out(r)?.sent, out(r)?.ok]] }))
  return { ok: Object.entries(modes).every(([m, code]) => rs[m].join() === `10,${code},false,false`) && !existsSync(log), detail: JSON.stringify(rs) }
})
await test('N6', '전송 뒤 실패(끊김 · 판독 불가 응답) — sent:true 로 남는다 · HTTP 오류 응답은 상태와 바이트를 그대로 돌려준다', () => {
  const env = (net) => ({ MPC_TEST_KEY: 'ok', MPC_TEST_NET: net })
  const input = req({ op: 'submit', body: manuscript.bodyText })
  const lost = raw(TEST.bin, 'request', input, env('fail')), binary = raw(TEST.bin, 'request', input, env('binary'))
  const codes = [401, 429, 500].map((c) => out(raw(TEST.bin, 'request', input, env(`status:${c}`))))
  return { ok: lost.status === 11 && out(lost).sent === true && out(lost).code === 'TRANSPORT' && binary.status === 11 && out(binary).sent === true && out(binary).code === 'RESPONSE_NOT_UTF8'
    && codes.every((o, i) => o.ok === true && o.httpStatus === [401, 429, 500][i] && JSON.parse(o.body).error.message === 'credential: [REDACTED]' && !o.body.includes(TEST_KEY_PREFIX) && JSON.parse(o.body).error.code === `stub_${[401, 429, 500][i]}`),
  detail: JSON.stringify({ lost: out(lost), binary: out(binary), codes }) }
})
await test('N7', 'redirect 를 따라가지 않는다 — 다른 host 로 요청 0 · 키 누출 0 · 3xx 를 그대로 돌려준다', () => {
  const log = netLog()
  const r = raw(TEST.bin, 'request', req({ op: 'submit', body: manuscript.bodyText }), { MPC_TEST_KEY: 'ok', MPC_TEST_NET: 'redirect', MPC_TEST_NET_LOG: log })
  const o = out(r), seen = readFileSync(log, 'utf8').trim().split('\n')
  return { ok: o?.ok === true && o.httpStatus === 302 && seen.length === 1 && seen[0] === 'POST https://api.openai.com/v1/responses' && !r.stdout.includes('followed'), detail: JSON.stringify({ o, seen, status: r.status }) }
})

// ── status · grant ──
await test('N8', 'status — 준비됨 · 동의 필요 · 항목 없음을 구분한다 · 네트워크 0 · 비밀 출력 0 · 준비됨만 종료 0', () => {
  const log = netLog()
  const rs = Object.fromEntries(['ok', 'consent', 'notfound'].map((m) => { const r = raw(TEST.bin, 'status', '', { MPC_TEST_KEY: m, MPC_TEST_NET_LOG: log }); return [m, { status: r.status, o: out(r), clean: r.stderr === '' && !r.stdout.includes(TEST_KEY_PREFIX) }] }))
  return { ok: rs.ok.status === 0 && rs.ok.o.unattended === 'READY' && rs.ok.o.item === 'PRESENT' && rs.consent.status === 10 && rs.consent.o.unattended === 'KEY_CONSENT_REQUIRED' && rs.consent.o.item === 'PRESENT'
    && rs.notfound.status === 10 && rs.notfound.o.unattended === 'KEY_NOT_FOUND' && rs.notfound.o.item === 'ABSENT' && Object.values(rs).every((x) => x.clean) && !existsSync(log), detail: JSON.stringify(rs) }
})
await test('N9', 'grant — 터미널이 아니면 거부(예약 실행에서 창 0) · "항상 허용"만 준비됨 · 한 번 허용 · 거부는 준비 안 됨 · 네트워크 0', () => {
  const log = netLog()
  const g = (env) => raw(TEST.bin, 'grant', '', { MPC_TEST_KEY: 'consent', MPC_TEST_NET_LOG: log, ...env })
  const noTty = g({ MPC_TEST_GRANT: 'always' }), always = g({ MPC_TEST_TTY: '1', MPC_TEST_GRANT: 'always' }), once = g({ MPC_TEST_TTY: '1', MPC_TEST_GRANT: 'once' }), deny = g({ MPC_TEST_TTY: '1', MPC_TEST_GRANT: 'deny' })
  const prodNoTty = spawnSync(PROD.bin, ['grant'], { input: '', encoding: 'utf8', env: { HOME: process.env.HOME } }) // 터미널 확인이 키체인보다 앞이다
  return { ok: noTty.status === 2 && out(noTty).code === 'GRANT_REQUIRES_TERMINAL' && prodNoTty.status === 2 && out(prodNoTty).code === 'GRANT_REQUIRES_TERMINAL'
    && always.status === 0 && out(always).ok === true && out(always).unattended === 'READY'
    && once.status === 10 && out(once).code === 'CONSENT_NOT_PERSISTENT' && deny.status === 10 && out(deny).code === 'KEY_DENIED'
    && [noTty, always, once, deny].every((r) => !r.stdout.includes(TEST_KEY_PREFIX) && !r.stderr.includes(TEST_KEY_PREFIX)) && !existsSync(log),
  detail: JSON.stringify([noTty, always, once, deny, prodNoTty].map((r) => [r.status, r.stdout.trim()])) }
})

// ── 설치 · 승인 (임시 HOME) ──
const approve = (home, bin, patch = {}) => {
  const p = PV.nativeClientPaths({ home })
  mkdirSync(p.dir, { recursive: true, mode: 0o700 })
  cpSync(bin, p.bin); chmodSync(p.bin, 0o500)
  writeFileSync(p.approval, JSON.stringify({ schemaVersion: PV.NATIVE_CLIENT.approvalSchema, clientVersion: '1', sha256: sha(readFileSync(bin)), approvedBy: 'check', approvedAt: '2026-11-27T00:00:00.000Z', ...patch }), { mode: 0o600 })
  return p
}
await test('N10', '설치 — 운영 빌드만 받는다 · 0700/0500/0600 · 같은 바이트는 그대로 · 다른 바이트는 재승인 없이는 거부', async () => {
  const home = tmp('mpc-inst-')
  const nowIso = '2026-11-27T00:00:00.000Z'
  const noName = await T.installClient({ home, builtBin: PROD.bin, approvedBy: ' ', nowIso })
  const testBuild = await T.installClient({ home, builtBin: TEST.bin, approvedBy: 'check', nowIso })
  const nothing = !existsSync(PV.nativeClientPaths({ home }).dir)
  const first = await T.installClient({ home, builtBin: PROD.bin, approvedBy: 'check', nowIso })
  const p = PV.nativeClientPaths({ home })
  const modes = [statSync(p.dir).mode & 0o777, statSync(p.bin).mode & 0o777, statSync(p.approval).mode & 0o777]
  const again = await T.installClient({ home, builtBin: PROD.bin, approvedBy: 'check', nowIso })
  // 다른 바이트 — 운영 빌드에 꼬리 바이트를 붙인 사본(version 은 그대로 돈다 · 서명은 깨질 수 있으므로 run 을 대역으로 쓴다)
  const other = join(tmp('mpc-other-'), 'bin'); writeFileSync(other, Buffer.concat([readFileSync(PROD.bin), Buffer.from('x')]), { mode: 0o700 })
  const versionOk = async () => ({ started: true, stdout: spawnSync(PROD.bin, ['version'], { encoding: 'utf8' }).stdout })
  const silent = await T.installClient({ home, builtBin: other, approvedBy: 'check', nowIso, run: versionOk })
  const kept = PV.verifyNativeClient({ home })
  const re = await T.installClient({ home, builtBin: other, approvedBy: 'check2', nowIso, reapprove: true, run: versionOk })
  const after = PV.verifyNativeClient({ home })
  return { ok: noName.code === 'APPROVED_BY_REQUIRED' && testBuild.code === 'CLIENT_BUILD_REJECTED' && nothing && first.ok && !first.unchanged && modes.join() === [0o700, 0o500, 0o600].join()
    && again.ok && again.unchanged === true && silent.code === 'REAPPROVAL_REQUIRED' && kept.ok && kept.sha256 === PROD.sha256 && re.ok && re.replaced === true && after.ok && after.sha256 === sha(readFileSync(other)),
  detail: JSON.stringify({ noName, testBuild, nothing, first, modes, again, silent, kept, re, after }) }
})
await test('N11', '설치본 대조 — 미설치 · 바이트 변경 · 승인 기록 손상 · 남이 쓸 수 있는 권한 · symlink 는 전부 실행 0', async () => {
  const cases = {}
  cases.none = PV.verifyNativeClient({ home: tmp('mpc-v-') }).code
  { const home = tmp('mpc-v-'); const p = approve(home, TEST.bin); chmodSync(p.bin, 0o700); writeFileSync(p.bin, Buffer.concat([readFileSync(p.bin), Buffer.from('x')])); chmodSync(p.bin, 0o500); cases.tampered = PV.verifyNativeClient({ home }).code }
  { const home = tmp('mpc-v-'); approve(home, TEST.bin, { extra: 1 }); cases.approvalExtra = PV.verifyNativeClient({ home }).code }
  { const home = tmp('mpc-v-'); approve(home, TEST.bin, { clientVersion: '0' }); cases.approvalVersion = PV.verifyNativeClient({ home }).code }
  { const home = tmp('mpc-v-'); const p = approve(home, TEST.bin); chmodSync(p.bin, 0o570); cases.groupWritable = PV.verifyNativeClient({ home }).code }
  { const home = tmp('mpc-v-'); const p = approve(home, TEST.bin); chmodSync(p.dir, 0o777); cases.dirWritable = PV.verifyNativeClient({ home }).code }
  { const home = tmp('mpc-v-'); const p = approve(home, TEST.bin); const real = join(tmp('mpc-real-'), 'bin'); cpSync(p.bin, real); rmSync(p.bin, { force: true }); symlinkSync(real, p.bin); cases.symlink = PV.verifyNativeClient({ home }).code }
  { const home = tmp('mpc-v-'); approve(home, TEST.bin); cases.otherOwner = PV.verifyNativeClient({ home, uid: process.getuid() + 1 }).code }
  let spawned = 0
  const home = tmp('mpc-v-'); approve(home, TEST.bin, { sha256: '0'.repeat(64) })
  const ad = PV.makeNativeProviders({ home, build: 'OFFLINE_TEST', run: async () => { spawned++; return { started: false } } })
  const w = await ad.manuscript.submit(manuscript.bodyText)
  const st = await PV.nativeClientStatus({ home, build: 'OFFLINE_TEST', run: async () => { spawned++; return { started: false } } })
  const want = { none: 'CLIENT_NOT_INSTALLED', tampered: 'CLIENT_NOT_APPROVED', approvalExtra: 'CLIENT_APPROVAL_INVALID', approvalVersion: 'CLIENT_APPROVAL_INVALID', groupWritable: 'CLIENT_PERMISSIONS', dirWritable: 'CLIENT_PERMISSIONS', symlink: 'CLIENT_PATH_KIND', otherOwner: 'CLIENT_PERMISSIONS' }
  return { ok: JSON.stringify(cases) === JSON.stringify(want) && spawned === 0 && w.httpStatus === 401 && JSON.parse(w.bodyText).error.type === PV.LOCAL_NOT_SENT && JSON.parse(w.bodyText).error.code === 'CLIENT_NOT_APPROVED' && st.ready === false && st.code === 'CLIENT_NOT_APPROVED',
    detail: JSON.stringify({ cases, spawned, w, st }) }
})

// ── Node adapter ↔ 실제 client 바이너리 ──
await test('N12', 'adapter — 정상은 wire 그대로 · 키 실패는 "전송 안 함" wire(401 · 표식) · 계약 밖은 400 · 전송 뒤 실패만 TRANSPORT · 넘기는 환경은 HOME 하나', async () => {
  const home = tmp('mpc-ad-'); approve(home, TEST.bin)
  const log = netLog()
  const seenEnv = []
  const via = (env) => PV.makeNativeProviders({ home, build: 'OFFLINE_TEST', timeouts: { submit: 5000, retrieve: 5000, remove: 5000, image: 5000 },
    run: (o) => { seenEnv.push(Object.keys(o.env ?? { HOME: 1 })); return PV.runNativeClient({ ...o, env: { HOME: process.env.HOME, MPC_TEST_NET_LOG: log, ...env } }) } })
  const good = via({ MPC_TEST_KEY: 'ok' })
  const s = await good.manuscript.submit(manuscript.bodyText)
  const g = await good.manuscript.retrieve('resp_stub0001'), d = await good.manuscript.remove('resp_stub0001'), i = await good.image.generate(image.bodyText)
  const submitted = PV.readSubmit(PV.parseWire(s.bodyText))
  const sentCount = readFileSync(log, 'utf8').trim().split('\n').length
  const consent = await via({ MPC_TEST_KEY: 'consent' }).manuscript.submit(manuscript.bodyText)
  const missing = await via({ MPC_TEST_KEY: 'notfound' }).image.generate(image.bodyText)
  const badReq = await via({ MPC_TEST_KEY: 'ok' }).manuscript.submit(edit(manuscript.bodyText, (b) => { b.model = 'gpt-other' }))
  const afterLocal = readFileSync(log, 'utf8').trim().split('\n').length
  let lost = null, garbage = null, wrongBuild = null, timedOut = null
  try { await via({ MPC_TEST_KEY: 'ok', MPC_TEST_NET: 'fail' }).manuscript.submit(manuscript.bodyText) } catch (e) { lost = [e.code, e.causeName] }
  try { await PV.makeNativeProviders({ home, build: 'OFFLINE_TEST', run: async () => ({ started: true, status: 0, stdout: 'not json' }) }).manuscript.submit(manuscript.bodyText) } catch (e) { garbage = [e.code, e.causeName] }
  // 운영 판정(build PRODUCTION)은 검사 빌드의 출력을 믿지 않는다 — sent:false 라고 말해도 불명으로 둔다
  try { await PV.makeNativeProviders({ home, run: (o) => PV.runNativeClient({ ...o, env: { HOME: process.env.HOME, MPC_TEST_KEY: 'consent' } }) }).manuscript.submit(manuscript.bodyText) } catch (e) { wrongBuild = [e.code, e.causeName] }
  try { await PV.makeNativeProviders({ home, build: 'OFFLINE_TEST', run: async () => ({ started: true, status: null, signal: 'SIGKILL', timedOut: true, stdout: '' }) }).manuscript.submit(manuscript.bodyText) } catch (e) { timedOut = [e.code, e.causeName] }
  const notStarted = await PV.makeNativeProviders({ home, build: 'OFFLINE_TEST', run: async () => ({ started: false, error: 'ENOENT' }) }).manuscript.submit(manuscript.bodyText)
  const local = (w, status, code) => w.httpStatus === status && JSON.parse(w.bodyText).error.type === PV.LOCAL_NOT_SENT && JSON.parse(w.bodyText).error.code === code
  const defaultEnv = [...new Set(seenEnv.flat())] // adapter 는 env 를 넘기지 않는다 → runNativeClient 의 기본값(HOME 하나)이 쓰인다
  return { ok: s.httpStatus === 200 && submitted?.id === 'resp_stub0001' && submitted.store === true && [g, d, i].every((w) => w.httpStatus === 200) && sentCount === 4
    && local(consent, 401, 'KEY_CONSENT_REQUIRED') && local(missing, 401, 'KEY_NOT_FOUND') && local(badReq, 400, 'BAD_REQUEST') && local(notStarted, 401, 'CLIENT_SPAWN_FAILED') && afterLocal === 4
    && lost?.[0] === 'TRANSPORT' && /^TRANSPORT:-?\d+$/.test(lost[1]) && garbage?.join() === 'TRANSPORT,CLIENT_OUTPUT' && wrongBuild?.join() === 'TRANSPORT,CLIENT_OUTPUT' && timedOut?.join() === 'TRANSPORT,CLIENT_TIMEOUT'
    && defaultEnv.join() === 'HOME' && ![s, g, d, i, consent, missing].some((w) => JSON.stringify(w).includes(TEST_KEY_PREFIX)),
  detail: JSON.stringify({ s: s.httpStatus, submitted, sentCount, consent, missing, badReq, notStarted, afterLocal, lost, garbage, wrongBuild, timedOut }) }
})
await test('N13', 'status adapter — 준비됨 · 동의 필요 · 항목 없음 · 판독 불가를 구분한다(실행 전 점검용)', async () => {
  const home = tmp('mpc-st-'); approve(home, TEST.bin)
  const st = (env) => PV.nativeClientStatus({ home, build: 'OFFLINE_TEST', run: (o) => PV.runNativeClient({ ...o, env: { HOME: process.env.HOME, ...env } }) })
  const ready = await st({ MPC_TEST_KEY: 'ok' }), consent = await st({ MPC_TEST_KEY: 'consent' }), none = await st({ MPC_TEST_KEY: 'notfound' })
  const prodView = await PV.nativeClientStatus({ home, run: (o) => PV.runNativeClient({ ...o, env: { HOME: process.env.HOME, MPC_TEST_KEY: 'ok' } }) })
  return { ok: ready.ready === true && ready.sha256 === TEST.sha256 && consent.ready === false && consent.code === 'KEY_CONSENT_REQUIRED' && consent.item === 'PRESENT'
    && none.ready === false && none.code === 'KEY_NOT_FOUND' && none.item === 'ABSENT' && prodView.ready === false && prodView.code === 'CLIENT_STATUS_UNREADABLE', detail: JSON.stringify({ ready, consent, none, prodView }) }
})
await test('N14', '소스 — 일반 security CLI · Node 전송 경로 · 키를 받는 인자가 남아 있지 않다 · client 에 listener · 상주 코드가 없다', () => {
  const provider = readFileSync(new URL('./lib/magazine-provider.mjs', import.meta.url), 'utf8')
  const entry = readFileSync(new URL('./magazine-vnext-produce.mjs', import.meta.url), 'utf8')
  const swift = readFileSync(T.CLIENT_SOURCE, 'utf8')
  const code = (s) => s.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  const node = code(provider) + code(entry)
  return { ok: !/find-generic-password|spawnSync|fetch\(|fetchImpl|apiKey|Authorization|node:https|readApiKeyFromKeychain|makeOpenAiProviders/.test(node)
    && !/NWListener|listen\(|bind\(|SocketPort|NSXPCListener|RunLoop\.main\.run|dispatchMain|Process\(\)|\/usr\/bin\/security/.test(code(swift))
    && (code(swift).match(/SecItemCopyMatching/g) ?? []).length === 2 && /URLSessionConfiguration\.ephemeral/.test(swift), detail: 'source scan' }
})
await test('N15', '생산기 진입점 — client 미설치 · 동의 없음 · 키체인 항목 불일치는 요청 기록 전에 끝난다(Job 저장소 생성 0 · 종료 1)', () => {
  const entry = new URL('./magazine-vnext-produce.mjs', import.meta.url).pathname
  const cfgOf = (keychain) => { const f = join(tmp('mpc-cfg-'), 'live.json'); writeFileSync(f, JSON.stringify({ schemaVersion: 'magazine-provider-live/1', enabled: true, stage: 'S5_CANARY',
    manuscript: { model: 'gpt-6-luna', maxOutputTokens: 6000, repairMaxOutputTokens: 800, inputPer1M: 0.1, outputPer1M: 0.5 }, image: { model: 'gpt-image-2.5-flare', size: '1536x864', perImage: 0.14 },
    keychain, changedBy: 'check', changedAt: '2026-11-27T00:00:00.000Z' })); return f }
  const fixed = { service: PV.NATIVE_CLIENT.service, account: PV.NATIVE_CLIENT.account }
  const go = (home, cfg) => { const r = spawnSync(process.execPath, [entry, '--canary', cfg], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home }, timeout: 60_000 }); return { status: r.status, out: PV.parseWire(r.stdout.trim()), state: existsSync(join(home, 'Library', 'Application Support', 'soransoran', 'magazine-canary-jobs')) } }
  const none = go(tmp('mpc-e-'), cfgOf(fixed))
  const other = go(tmp('mpc-e-'), cfgOf({ service: 'other-service', account: fixed.account }))
  // 승인 기록은 맞지만 검사 빌드다 — 운영 판정은 그 status 출력을 믿지 않는다
  const home = tmp('mpc-e-'); approve(home, TEST.bin)
  const wrongBuild = go(home, cfgOf(fixed))
  return { ok: none.status === 1 && none.out.outcome === 'KEY_UNAVAILABLE' && none.out.client.code === 'CLIENT_NOT_INSTALLED' && !none.state
    && other.status === 1 && other.out.outcome === 'KEYCHAIN_CONFIG_MISMATCH' && !other.state
    && wrongBuild.status === 1 && wrongBuild.out.outcome === 'KEY_UNAVAILABLE' && wrongBuild.out.client.code === 'CLIENT_STATUS_UNREADABLE' && !wrongBuild.state, detail: JSON.stringify({ none, other, wrongBuild }) }
})

console.log(`\n네이티브 client 검사: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
