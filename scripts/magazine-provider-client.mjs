#!/usr/bin/env node
/**
 * 매거진 네이티브 provider client 의 빌드 · 설치 · 점검 (소스: scripts/magazine-provider-client/main.swift).
 *
 *   node scripts/magazine-provider-client.mjs install --approved-by <이름> [--reapprove]
 *        빌드 → ad hoc 서명 → 고정 경로에 복사 → 승인 기록(SHA-256). 이미 다른 바이트가 승인돼 있으면 --reapprove 없이는 거부한다.
 *   "<설치 경로>" grant
 *        사람이 터미널에서 한 번 — macOS 창에서 "항상 허용". 바이너리가 바뀌면 macOS 가 다시 묻는다(서명 해시가 달라진다).
 *   node scripts/magazine-provider-client.mjs status
 *        비대화형 점검 — 설치본 대조 + 키가 창 없이 읽히는지. 비밀 출력 0 · 네트워크 0 · 유료 호출 0.
 *   node scripts/magazine-provider-client.mjs build --out <폴더>
 *        빌드와 서명만(설치 0).
 *
 * 설치 위치: ~/Library/Application Support/soransoran/magazine-provider-client/ (0700 · 바이너리 0500 · approval.json 0600)
 * 🔴 서명 identity 가 없어 ad hoc 서명이다. 신뢰의 근거는 둘이다 — ① 생산기가 실행 전마다 대조하는 승인 SHA-256 ② 키체인 동의(macOS 가 cdhash 로 묶는다).
 * 🔴 상주 프로세스 · listener 를 만들지 않는다. client 는 요청 한 건마다 떴다가 끝난다.
 * 종료 코드: 정상 0 · 막힘 1 · 사용법 2
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import nodeFs from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { NATIVE_CLIENT, nativeClientPaths, nativeClientStatus, parseWire, runNativeClient, verifyNativeClient } from './lib/magazine-provider.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CLIENT_SOURCE = join(HERE, 'magazine-provider-client', 'main.swift')
export const CLIENT_IDENTIFIER = 'com.soransoran.magazine-provider-client'
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

/** 빌드 + ad hoc 서명(hardened runtime — DYLD_* 주입을 막는다). offlineTest 는 검사 전용 빌드다 */
export function buildClient({ outDir, offlineTest = false, source = CLIENT_SOURCE, exec = spawnSync, fs = nodeFs }) {
  const bin = join(outDir, NATIVE_CLIENT.bin)
  const tail = (r) => String(r.stderr ?? r.error?.code ?? '').split('\n').filter((l) => /error/.test(l)).slice(0, 5).join(' | ').slice(0, 600)
  const c = exec('/usr/bin/xcrun', ['swiftc', '-O', ...(offlineTest ? ['-D', 'OFFLINE_TEST'] : []), '-o', bin, source], { encoding: 'utf8' })
  if (c.status !== 0) return { ok: false, code: 'COMPILE_FAILED', detail: tail(c) }
  const s = exec('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', CLIENT_IDENTIFIER, '--options', 'runtime', bin], { encoding: 'utf8' })
  if (s.status !== 0) return { ok: false, code: 'SIGN_FAILED', detail: tail(s) }
  const v = exec('/usr/bin/codesign', ['--verify', '--strict', bin], { encoding: 'utf8' })
  if (v.status !== 0) return { ok: false, code: 'SIGNATURE_INVALID', detail: tail(v) }
  return { ok: true, bin, sha256: sha256(fs.readFileSync(bin)) }
}

/** 빌드가 말하는 계약 값이 이 저장소의 상수와 같은지 — 검사 전용 빌드는 설치하지 않는다 */
export async function readBuiltVersion({ bin, run = runNativeClient }) {
  const r = await run({ bin, mode: 'version', timeoutMs: 20_000 })
  const j = r.started ? parseWire(String(r.stdout ?? '').trim()) : null
  const ok = j && j.v === NATIVE_CLIENT.protocol && j.mode === 'version' && j.build === NATIVE_CLIENT.build && j.clientVersion === NATIVE_CLIENT.clientVersion
    && j.service === NATIVE_CLIENT.service && j.account === NATIVE_CLIENT.account && j.host === NATIVE_CLIENT.host
  return ok ? { ok: true, version: j } : { ok: false, code: 'CLIENT_BUILD_REJECTED', build: j?.build ?? null }
}

/**
 * 고정 경로에 복사하고 승인을 기록한다. 순서: 옛 승인 삭제 → 바이너리 교체 → 새 승인 — 중간에 죽으면 "미승인"으로 남는다.
 * 🔴 이미 다른 바이트가 있으면 reapprove 없이는 바꾸지 않는다(조용한 교체 0).
 */
export async function installClient({ home, builtBin, approvedBy, reapprove = false, nowIso, fs = nodeFs, run = runNativeClient, uid = process.getuid() }) {
  if (typeof approvedBy !== 'string' || !approvedBy.trim()) return { ok: false, code: 'APPROVED_BY_REQUIRED' }
  const built = await readBuiltVersion({ bin: builtBin, run })
  if (!built.ok) return built
  const bytes = fs.readFileSync(builtBin)
  const digest = sha256(bytes)
  const p = nativeClientPaths({ home })
  let existing = null
  try { existing = fs.lstatSync(p.bin) } catch { /* 처음 설치 */ }
  if (existing) {
    const now = verifyNativeClient({ home, fs, uid })
    if (now.ok && now.sha256 === digest) return { ok: true, unchanged: true, sha256: digest, paths: p }
    if (!reapprove) return { ok: false, code: 'REAPPROVAL_REQUIRED', installed: now.ok ? now.sha256 : now.code, built: digest }
  }
  fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 })
  const d = fs.lstatSync(p.dir)
  if (!d.isDirectory() || d.uid !== uid) return { ok: false, code: 'CLIENT_PATH_KIND' }
  fs.chmodSync(p.dir, 0o700)
  fs.rmSync(p.approval, { force: true })
  const put = (path, data, mode) => { const t = `${path}.tmp-${process.pid}`; fs.rmSync(t, { force: true }); fs.writeFileSync(t, data, { mode, flag: 'wx' }); fs.chmodSync(t, mode); fs.renameSync(t, path) }
  put(p.bin, bytes, 0o500)
  put(p.approval, `${JSON.stringify({ schemaVersion: NATIVE_CLIENT.approvalSchema, clientVersion: NATIVE_CLIENT.clientVersion, sha256: digest, approvedBy: approvedBy.trim(), approvedAt: nowIso }, null, 2)}\n`, 0o600)
  const after = verifyNativeClient({ home, fs, uid })
  if (!after.ok) return { ok: false, code: after.code }
  return { ok: true, unchanged: false, replaced: Boolean(existing), sha256: digest, paths: p }
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2)
  let args
  try {
    args = parseArgs({ args: rest, options: { 'approved-by': { type: 'string' }, reapprove: { type: 'boolean' }, out: { type: 'string' } } }).values
    if (!['install', 'status', 'build'].includes(mode) || (mode === 'install' && !args['approved-by']?.trim()) || (mode === 'build' && !args.out?.trim())) throw Error('usage')
  } catch { console.error('install --approved-by <이름> [--reapprove] | status | build --out <폴더>'); process.exit(2) }
  const home = homedir()
  if (mode === 'status') {
    const s = await nativeClientStatus({ home })
    console.log(JSON.stringify({ ...s, path: nativeClientPaths({ home }).bin }))
    process.exit(s.ready ? 0 : 1)
  }
  const outDir = mode === 'build' ? resolve(args.out) : nodeFs.mkdtempSync(join(tmpdir(), 'magazine-provider-client-'))
  nodeFs.mkdirSync(outDir, { recursive: true })
  const built = buildClient({ outDir })
  if (!built.ok || mode === 'build') { console.log(JSON.stringify(built)); process.exit(built.ok ? 0 : 1) }
  const r = await installClient({ home, builtBin: built.bin, approvedBy: args['approved-by'], reapprove: Boolean(args.reapprove), nowIso: new Date().toISOString() })
  nodeFs.rmSync(outDir, { recursive: true, force: true })
  console.log(JSON.stringify(r.ok ? { ...r, next: r.unchanged ? 'status 로 확인' : `터미널에서 "${r.paths.bin}" grant → "항상 허용" → status 로 확인` } : r))
  process.exit(r.ok ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
