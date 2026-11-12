#!/usr/bin/env node
/**
 * Magazine vNext S2 — ContentPlanInputBundle **1회 bootstrap** CLI (charter §18-B.5 · runbook §0.0B.1).
 *
 *   node scripts/magazine-plan-input-bootstrap.mjs --research-dir <연구 폴더> --snapshot-dir <exact canonical snapshot>
 *        [--product-root <제품 저장소>] [--admission-as-of <ISO 시각(오프셋 필수)>] [--write]
 *
 * 왜 있는가
 *   제품 graph `g-20261102-427d4d` 는 Bundle 계약보다 먼저 배포됐다. 그 판의 **최초 Bundle 한 번만** graph 승격과 따로 더한다.
 *   다음 판부터는 graph 승격 변경이 Bundle 을 함께 싣는다(이 CLI 를 쓰지 않는다).
 *
 * 하는 일 (파일 읽기는 여기서만 — 조립·판독은 순수 lib `lib/magazine-content-plan-input.mjs`)
 *   ① 제품 current.ts 의 판이 bootstrap 허용 판(BOOTSTRAP_GRAPH_VERSION) 하나여야 한다 — 다른 판으로 넓히지 않는다
 *   ② 연구 current 링크 · 트리 · manifest · control.json · exact snapshot 다섯 입력 · 제품 graph 판 · control · current 를 대조한다
 *   ③ canonical g5 · g4 가 참조하는 증거 파일만 읽어(연구 폴더 안 · 일반 파일만) 근거 신원을 해시하고, intent 문장을 제3자 원문과 대조한다(P1-E)
 *   ④ 같은 판의 Bundle 이 이미 있으면 **쓰기 0** 으로 멈춘다(정확히 1회 · 같은 바이트여도 다시 쓰지 않는다)
 *   ⑤ 기본은 dry-run — 요약만 낸다. `--write` 일 때만 no-clobber 원자 쓰기(임시 파일 + link)
 *   ⑥ `--admission-as-of` 가 있으면 정적 컴파일 · 동적 admission · ProviderPlan 투영 결과를 **읽기만 해서** 함께 낸다
 *      (현재 control · articles · legacy queue 신원 투영을 읽는다 — 쓰기 0. 시각은 인자로만 받는다)
 *
 * 🔴 연구 폴더 · queue · graph 판 · control · current · articles 에 쓰지 않는다. 쓰는 파일은 Bundle 하나뿐이다.
 * 🔴 허용 판은 상수 하나다 — 실행 API 에 판을 바꾸는 손잡이가 없다(P1-F). 합성 fixture 검사는 저장소 밖 시험 전용 helper
 *    (`scripts/__fixtures__/magazine/content-plan/bootstrap-fixture.mjs`)가 이 파일의 사본에서 상수만 바꿔 쓴다.
 * 🔴 출력 경로의 어느 부모 · 구성 요소도 symlink 이면 쓰지 않는다(제품 루트 밖 쓰기 0 · P1-F).
 * 🔴 쓰기는 crash-safe no-clobber 다(writeBundleNoClobber · P1-F) — 최종 파일은 없거나, 바이트가 같고 fsync 된 완전한 파일이다.
 *    잔여 임시 파일(.<판>.json.tmp-*)이 있으면 지우지 않고 STALE_TEMP_PRESENT 로 멈춘다(사람이 원인을 보고 치운다).
 * 🔴 운영 runtime(`soransoran-magazine-runtime`)은 어느 루트로도 받지 않는다.
 * 종료 코드: 0 성공(dry-run 포함) · 1 거부(구조화 코드 · 쓰기 0) · 2 사용법 오류
 */
import { createHash, randomBytes } from 'node:crypto'
import { closeSync, constants as fsConstants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { INPUT_FILES } from './lib/magazine-graph-build.mjs'
import { PlanInputError, buildPlanInputBundle, collectEvidenceRefs, collectSourceTextRefs, currentGraphVersionOf, planInputRel } from './lib/magazine-content-plan-input.mjs'
import { ContentPlanError, compileContentPlans, admitContentPlans, projectProviderPlan, strictControlGraphVersion } from './lib/magazine-content-plan.mjs'
import { treeOf } from './lib/magazine-research-current.mjs'
import { strictOffsetTimeMs } from './lib/magazine-public-rule.mjs'

/** bootstrap 예외가 허용된 유일한 판 (charter §18-B.5) */
export const BOOTSTRAP_GRAPH_VERSION = 'g-20261102-427d4d'
const GRAPH_DIR = 'src/content/magazine/graph'
const QUEUE_REL = 'drafts/magazine/topic-queue.ts'
const ARTICLES_REL = 'src/content/magazine/articles.ts'

class BootstrapStop extends Error { constructor(code, why, errno = null) { super(`${code}: ${why}`); this.code = code; this.why = why; this.errno = errno } }
const stop = (code, why, errno = null) => { throw new BootstrapStop(code, why, errno) }

const readText = (abs, code, label) => {
  try { return readFileSync(abs, 'utf8') } catch (e) { return stop(code, `${label} 를 읽지 못했다 (${e.code ?? e.message})`, e.code ?? null) }
}

/**
 * 연구 폴더 안의 증거 파일 — 일반 파일만 · 폴더 밖으로 나가지 않는다.
 * 🔴 ENOENT 만 "없음"(null — 관계가 빠지고 원문 corpus 는 불완전 → UNVERIFIED)이다(P1-9). EACCES · EIO · EMFILE 같은 그 밖의 lstat ·
 *    realpath · 읽기 오류는 bootstrap 전체를 EVIDENCE_READ_FAILED 로 멈춘다(출력 0) — 읽지 못한 것을 없는 것으로 보면 판정이 조용히 바뀐다.
 *    symlink · 폴더 같은 일반 파일 아닌 이름 · 폴더 밖 경로는 허용 증거가 아니라 null 이다(앞판 그대로).
 */
function readEvidence(researchDir, ref) {
  const abs = resolve(researchDir, ref)
  if (!abs.startsWith(`${researchDir}${sep}`)) return null
  let st
  try { st = lstatSync(abs) } catch (e) { if (e.code === 'ENOENT') return null; return stop('EVIDENCE_READ_FAILED', `증거 ${ref} lstat 실패 (${e.code ?? e.message})`, e.code ?? null) }
  if (!st.isFile()) return null
  try {
    const real = realpathSync(abs)
    if (!real.startsWith(`${realpathSync(researchDir)}${sep}`)) return null
    return readFileSync(abs, 'utf8')
  } catch (e) { return stop('EVIDENCE_READ_FAILED', `증거 ${ref} 를 읽지 못했다 (${e.code ?? e.message})`, e.code ?? null) }
}

/**
 * Bundle 의 권위 입력 전부를 읽는다 — 제품 current · control · graph 판, 연구 current 링크 대상 · 트리 · manifest · control.json · 파일,
 * exact snapshot 다섯, 증거 파일. 컴파일과 publication 직전 CAS(P1-8)가 **같은 함수**로 읽는다.
 * articles · queue 는 Bundle 바이트에 들어가지 않는 admission 진단 입력이라 여기 없다.
 */
function readAuthoritativeInputs({ productRoot, researchDir, snapshotDir, graphVersion }) {
  const productText = (rel) => readText(join(productRoot, rel), 'PRODUCT_FILE_MISSING', rel)
  const product = { currentText: productText(`${GRAPH_DIR}/current.ts`), controlText: productText(`${GRAPH_DIR}/control.ts`), graphFileText: productText(`${GRAPH_DIR}/${graphVersion}.ts`) }
  const buildDir = join(researchDir, 'contract', 'build')
  let currentDir
  try { currentDir = realpathSync(join(buildDir, 'current')) } catch (e) { stop('RESEARCH_CURRENT_MISSING', `연구 current 를 읽지 못했다 (${e.code ?? e.message})`, e.code ?? null) }
  const tree = treeOf(currentDir)
  const rd = (n) => readText(join(currentDir, n), 'RESEARCH_FILE_MISSING', `연구 current ${n}`)
  const files = {}
  for (const n of ['intents.jsonl', 'edges.jsonl', 'mappings.jsonl', `bundle/${graphVersion}.ts`]) files[n] = rd(n)
  if (tree['participation.jsonl'] !== undefined) files['participation.jsonl'] = rd('participation.jsonl')
  const research = { currentName: basename(currentDir), currentDir, manifestText: rd('manifest.json'), tree,
    controlJsonText: readText(join(buildDir, 'control.json'), 'RESEARCH_FILE_MISSING', '연구 control.json'), files }
  const snapshotTexts = Object.fromEntries(Object.values(INPUT_FILES).map((n) => [n, readText(join(snapshotDir, n), 'SNAPSHOT_FILE_MISSING', `snapshot ${n}`)]))
  // 관계 근거(g5) + 제3자 원문 대조 corpus(g4 intent 별 evidenceRefs) — 연구 폴더 안 일반 파일만
  const evidenceRefs = [...new Set([...collectEvidenceRefs(snapshotTexts[INPUT_FILES.graph]), ...collectSourceTextRefs(snapshotTexts[INPUT_FILES.canonical])])].sort()
  const evidenceTexts = Object.fromEntries(evidenceRefs.map((ref) => [ref, readEvidence(researchDir, ref)]))
  return { product, research, snapshotTexts, evidenceTexts }
}

/** 권위 입력의 바이트 신원 — 이름 → sha256(텍스트 · null · 경로). CAS 는 이 지도를 키 단위로 비교한다 */
function inputIdentity(inp) {
  const h = (t) => (t === null || t === undefined ? 'null' : createHash('sha256').update(String(t)).digest('hex'))
  const id = {}
  for (const [k, v] of Object.entries(inp.product)) id[`product.${k}`] = h(v)
  id['research.currentDir'] = h(inp.research.currentDir)
  id['research.tree'] = h(JSON.stringify(Object.entries(inp.research.tree).sort()))
  id['research.manifest'] = h(inp.research.manifestText)
  id['research.control.json'] = h(inp.research.controlJsonText)
  for (const [k, v] of Object.entries(inp.research.files)) id[`research.${k}`] = h(v)
  for (const [k, v] of Object.entries(inp.snapshotTexts)) id[`snapshot.${k}`] = h(v)
  for (const [k, v] of Object.entries(inp.evidenceTexts)) id[`evidence.${k}`] = h(v)
  return id
}

/** 이름이 있는가 — symlink 는 따라가지 않는다(가리키는 곳이 없어도 이름은 있다) */
const present = (abs) => { try { lstatSync(abs); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }

/**
 * 출력 경로 안전 — 제품 루트(realpath)부터 Bundle 의 부모까지 **모든 구성 요소**가 symlink 가 아닌 실제 폴더이거나 아직 없어야 한다.
 * 🔴 하나라도 symlink · 폴더 아님이면 쓰기 0 으로 멈춘다(제품 루트 밖으로 새는 쓰기를 막는다). 쓰기 직전에도 다시 본다.
 */
function assertOutputPathSafe(rootReal, outRel) {
  const parts = outRel.split('/')
  let cur = rootReal
  for (const [i, part] of parts.entries()) {
    cur = join(cur, part)
    let st
    try { st = lstatSync(cur) } catch (e) { if (e.code === 'ENOENT') return; throw e }
    if (st.isSymbolicLink()) stop('OUTPUT_PATH_SYMLINK', `출력 경로 구성 요소가 symlink 다: ${parts.slice(0, i + 1).join('/')} — 제품 루트 밖 쓰기를 막는다`)
    if (i < parts.length - 1 && !st.isDirectory()) stop('OUTPUT_PATH_NOT_DIRECTORY', `출력 경로 구성 요소가 폴더가 아니다: ${parts.slice(0, i + 1).join('/')}`)
  }
}

/** 잔여 임시 파일 이름 — writeBundleNoClobber 가 만드는 `.<판>.json.tmp-<pid>-<12hex>` */
export const STALE_TEMP_RE = /^\.g-\d{8}-[0-9a-f]{6}\.json\.tmp-/
const REAL_IO = Object.freeze({ openSync, writeSync, fsyncSync, closeSync, readSync, fstatSync, statSync, linkSync, unlinkSync, lstatSync, mkdirSync, readdirSync, realpathSync,
  chdir: (p) => process.chdir(p), cwd: () => process.cwd() })

/** 폴더의 잔여 임시 파일(정렬) — 폴더가 없으면 빈 목록 */
function staleTemps(io, dirAbs) {
  let names
  try { names = io.readdirSync(dirAbs) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  return names.filter((n) => STALE_TEMP_RE.test(n)).sort()
}

/** cwd(고정된 폴더) fsync — link · unlink · mkdir 로 바뀐 폴더 항목을 디스크에 남긴다. 🔴 macOS 의 fsync 는 F_FULLFSYNC 가 아니다(장치 캐시까지는 보장하지 않는다) */
function fsyncCwd(io) {
  const fd = io.openSync('.', 'r')
  try { io.fsyncSync(fd) } finally { io.closeSync(fd) }
}
const fsStop = (what, e) => stop('FILESYSTEM_ERROR', `${what} (${e?.code ?? e?.message})`, e?.code ?? null)
const TMP_FLAGS = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW

/**
 * crash-safe · 경로 고정 no-clobber 원자 쓰기 (S2 P1-F · P1-7 · P1-8).
 *   불변식  `<판>.json` 은 없거나, text 와 바이트가 같고 fsync 된 완전한 파일이다. 부분 파일 · 덮어쓰기 0.
 *           🔴 바이트와 이름은 **검증된 폴더 inode 안에만** 생긴다 — 제품 루트 밖 쓰기 0.
 *   경로 고정  Node 에는 openat · linkat(폴더 fd 기준 호출)이 없다. 같은 효과를 cwd 로 낸다: 제품 루트(realpath)부터 구성 요소마다
 *           lstat(symlink · 폴더 아님 거부) → chdir → stat('.') 의 dev·ino 가 lstat 과 같은지 확인한다(그 사이 바꿔치기면 OUTPUT_PATH_RACE · 쓰기 0).
 *           그 뒤 tmp open · link · unlink · fsync 는 전부 cwd 기준 상대 이름이다 — 경로가 나중에 symlink 로 바뀌어도 고정한 inode 를 떠나지 않는다.
 *           한계: 고정한 폴더 inode 자체를 누가 옮기면(rename) 그 폴더를 따라간다(openat 도 같다). 그 경우는 사후 확인이 잡고 우리가 만든 이름을 지운다.
 *           cwd 는 프로세스 전역이다 — 이 함수는 동기이고 끝에서 원래 cwd 로 돌아간다.
 *   순서    고정(필요하면 mkdir + 부모 fsync) → 최종 이름 없음 · 잔여 tmp 없음 → open(O_EXCL|O_NOFOLLOW) → 전부 쓰기(짧은 쓰기 반복) → fsync →
 *           fd 로 다시 읽어 대조 → beforePublish(입력 CAS · P1-8) → link(no-clobber) → 폴더 fsync → 경로 사후 확인 → unlink tmp → 폴더 fsync
 *   실패    link 전 실패는 tmp 를 지우고 BUNDLE_WRITE_FAILED(원래 오류 code 보존). link 의 EEXIST 만 BUNDLE_ALREADY_EXISTS 이고
 *           그 밖의 link 오류(EPERM · ENOTSUP …)는 BUNDLE_WRITE_FAILED 다 — rename 으로 대체하지 않는다(no-clobber 가 깨진다).
 *           link 뒤 폴더 fsync 실패 · 경로 사후 확인 실패는 고정 폴더 안의 우리 이름(같은 inode)만 지우고 BUNDLE_WRITE_FAILED · OUTPUT_PATH_RACE.
 *           그 밖의 파일 시스템 오류는 FILESYSTEM_ERROR(errno 보존)다.
 *   잔여    잔여 tmp 가 있으면 STALE_TEMP_PRESENT(쓰기 0 · 자동 삭제 0).
 * 🔴 io · step 은 시험 전용 주입(fault · 단계 관찰)이다. runBootstrap · CLI 는 넘기지 않는다 — 대상 경로 · 판을 바꾸는 손잡이가 아니다.
 * @param {{ rootReal: string, outRel: string, text: string }} target  rootReal = 제품 루트 realpath
 * @param {{ io?: object, step?: (name: string, info?: object) => void, beforePublish?: () => void }} [hooks]
 * @returns {{ written: string }}
 */
export function writeBundleNoClobber({ rootReal, outRel, text }, { io = REAL_IO, step = () => {}, beforePublish = () => {} } = {}) {
  const dirRel = dirname(outRel)
  const name = basename(outRel)
  const home = io.cwd()
  const same = (a, b) => a.ino === b.ino && a.dev === b.dev
  /** 상대 이름 lstat — 없으면 null · 그 밖의 오류는 FILESYSTEM_ERROR */
  const lstatRel = (n) => { try { return io.lstatSync(n) } catch (e) { if (e.code === 'ENOENT') return null; return fsStop(`lstat ${n}`, e) } }
  /** 폴더 하나 들어가기 — lstat 한 그 inode 에 정확히 들어왔는지 확인한다 */
  const enter = (n, st, label) => {
    if (st.isSymbolicLink()) stop('OUTPUT_PATH_SYMLINK', `출력 경로 구성 요소가 symlink 다: ${label} — 제품 루트 밖 쓰기를 막는다`)
    if (!st.isDirectory()) stop('OUTPUT_PATH_NOT_DIRECTORY', `출력 경로 구성 요소가 폴더가 아니다: ${label}`)
    step('enter', { part: label })
    try { io.chdir(n) } catch (e) { fsStop(`chdir ${label}`, e) }
    let here
    try { here = io.statSync('.') } catch (e) { fsStop(`stat ${label}`, e) }
    if (!same(here, st)) stop('OUTPUT_PATH_RACE', `${label} 가 확인과 진입 사이에 바뀌었다 — 아직 아무것도 쓰지 않았다`)
    return here
  }
  let fd = null, tmpIno = null, linked = false, tmpName = null
  const dropOwn = (n) => { try { if (io.lstatSync(n).ino === tmpIno) io.unlinkSync(n) } catch { /* 이미 없음 */ } }
  try {
    // ① 경로 고정 — 루트부터 한 칸씩. 없는 구성 요소만 만들고 만든 폴더마다 부모(cwd)를 fsync 한다
    let rootSt
    try { rootSt = io.lstatSync(rootReal) } catch (e) { fsStop('제품 루트 lstat', e) }
    enter(rootReal, rootSt, '<제품 루트>')
    let pinned = null
    for (const part of dirRel.split('/')) {
      let st = lstatRel(part)
      if (st === null) {
        try { io.mkdirSync(part) } catch (e) { if (e.code !== 'EEXIST') stop('BUNDLE_WRITE_FAILED', `폴더를 만들지 못했다 (${e.code ?? e.message})`, e.code) }
        st = lstatRel(part)
        if (st === null) stop('OUTPUT_PATH_RACE', `만든 폴더 ${part} 가 사라졌다`)
        if (!st.isSymbolicLink() && st.isDirectory()) {
          try { fsyncCwd(io) } catch (e) { stop('BUNDLE_WRITE_FAILED', `새 폴더의 부모 fsync 실패 (${e.code ?? e.message})`, e.code) }
          step('mkdir', { part })
        }
      }
      pinned = enter(part, st, part)
    }
    // ② 고정한 폴더 안 — 최종 이름 없음 · 잔여 tmp 없음
    if (lstatRel(name) !== null) stop('BUNDLE_ALREADY_EXISTS', `${outRel} 가 이미 있다`)
    let names
    try { names = io.readdirSync('.') } catch (e) { fsStop('readdir', e) }
    const stale = names.filter((n) => STALE_TEMP_RE.test(n)).sort()
    if (stale.length) stop('STALE_TEMP_PRESENT', `잔여 임시 파일 ${stale.map((n) => `${dirRel}/${n}`).join(', ')} — 지우지 않는다(원인을 보고 사람이 치운다)`)
    step('ready')
    // ③ tmp — 같은 폴더 · 숨김 · pid + 무작위 12hex. O_EXCL|O_NOFOLLOW(이미 있거나 symlink 면 실패)
    tmpName = `.${name}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`
    const bytes = Buffer.from(text, 'utf8')
    try { fd = io.openSync(tmpName, TMP_FLAGS, 0o644) } catch (e) { stop('BUNDLE_WRITE_FAILED', `임시 파일을 만들지 못했다 (${e.code ?? e.message})`, e.code) }
    tmpIno = io.fstatSync(fd).ino
    step('open')
    for (let off = 0; off < bytes.length;) {
      const n = io.writeSync(fd, bytes, off, bytes.length - off)
      if (!(Number.isInteger(n) && n > 0)) stop('BUNDLE_WRITE_FAILED', `쓰기가 진행하지 않았다 (${n}바이트)`)
      off += n
    }
    step('write')
    io.fsyncSync(fd)
    step('fsync')
    const back = Buffer.alloc(bytes.length + 1)
    let got = 0
    for (;;) { const n = io.readSync(fd, back, got, back.length - got, got); if (!(n > 0)) break; got += n; if (got === back.length) break }
    if (got !== bytes.length || !back.subarray(0, got).equals(bytes)) stop('BUNDLE_WRITE_FAILED', `다시 읽은 바이트가 쓴 바이트와 다르다 (${got}/${bytes.length})`)
    step('verify')
    io.closeSync(fd); fd = null
    // ④ 입력 CAS(P1-8) — 컴파일에 쓴 권위 입력을 link 바로 앞에서 다시 읽는다. 바뀌었으면 INPUT_DRIFT · 출력 0
    beforePublish()
    step('cas')
    try { io.linkSync(tmpName, name) } catch (e) {
      if (e.code === 'EEXIST') stop('BUNDLE_ALREADY_EXISTS', `쓰는 사이 ${outRel} 가 생겼다 — 덮지 않는다`)
      stop('BUNDLE_WRITE_FAILED', `link 실패 (${e.code ?? e.message}) — rename 으로 대체하지 않는다(no-clobber)`, e.code)
    }
    linked = true
    step('link')
    try { fsyncCwd(io) } catch (e) { stop('BUNDLE_WRITE_FAILED', `폴더 fsync 실패 (${e.code ?? e.message})`, e.code) }
    step('dirsync')
    // ⑤ 사후 확인 — 절대 경로가 지금도 고정한 폴더 · 우리 파일을 가리키는가(고정 폴더가 옮겨졌으면 거기 남긴 이름을 지운다)
    let raced = null
    try {
      assertOutputPathSafe(rootReal, outRel)
      if (!same(io.statSync(join(rootReal, dirRel)), pinned)) raced = '출력 폴더 경로가 고정한 폴더를 가리키지 않는다'
      else if (io.lstatSync(join(rootReal, outRel)).ino !== tmpIno) raced = '최종 파일이 우리가 쓴 파일이 아니다'
    } catch (e) { raced = e instanceof BootstrapStop ? e.why : `사후 확인 실패 (${e.code ?? e.message})` }
    if (raced) stop('OUTPUT_PATH_RACE', `${raced} — 고정 폴더 안의 우리 이름을 지웠다`)
    io.unlinkSync(tmpName)
    step('unlink')
    fsyncCwd(io)
    step('dirsync')
    return { written: outRel }
  } catch (e) {
    if (fd !== null) { try { io.closeSync(fd) } catch { /* 이미 닫힘 */ } }
    // 실패 정리 — 고정 폴더(cwd) 안의 우리 inode 이름만 지운다. 경로를 다시 풀지 않는다
    step('cleanup')
    if (linked) dropOwn(name)
    if (tmpIno !== null) dropOwn(tmpName)
    if (e instanceof BootstrapStop) throw e
    return stop('BUNDLE_WRITE_FAILED', `쓰기 오류 (${e.code ?? e.message})`, e.code ?? null)
  } finally {
    try { io.chdir(home) } catch { /* 원래 cwd 가 사라졌으면 그대로 둔다 — 이후 호출은 절대 경로만 쓴다 */ }
  }
}

const RUN_OPTION_KEYS = Object.freeze(['productRoot', 'researchDir', 'snapshotDir', 'write', 'admissionAsOf'])

/**
 * bootstrap 실행 — 성공이면 { ok: true, ... }, 거부면 { ok: false, code, why } (던지지 않는다).
 * @param {{ productRoot: string, researchDir: string, snapshotDir: string, write?: boolean, admissionAsOf?: string|null }} p
 *   🔴 허용 판은 BOOTSTRAP_GRAPH_VERSION 상수 하나다. 모르는 옵션(예: 옛 allowedGraphVersion)은 BOOTSTRAP_OPTION_UNKNOWN 으로 거부한다
 */
export function runBootstrap(options) {
  try {
    const extra = Object.keys(options ?? {}).filter((k) => !RUN_OPTION_KEYS.includes(k))
    if (extra.length) stop('BOOTSTRAP_OPTION_UNKNOWN', `모르는 옵션: ${extra.sort().join(', ')} — 허용 판을 바꾸는 손잡이는 없다`)
    const { productRoot: productRootIn, researchDir, snapshotDir, write = false, admissionAsOf = null } = options
    let productRoot
    try { productRoot = realpathSync(productRootIn) } catch (e) { stop('PRODUCT_ROOT_MISSING', `제품 루트를 읽지 못했다 (${e.code ?? e.message})`) }
    const productText = (rel) => readText(join(productRoot, rel), 'PRODUCT_FILE_MISSING', rel)
    const currentText = productText(`${GRAPH_DIR}/current.ts`)
    const graphVersion = currentGraphVersionOf(currentText)
    if (!graphVersion) stop('PRODUCT_CURRENT_UNREADABLE', 'current.ts 의 판을 읽지 못했다')
    if (graphVersion !== BOOTSTRAP_GRAPH_VERSION) stop('BOOTSTRAP_VERSION_NOT_ALLOWED', `bootstrap 은 ${BOOTSTRAP_GRAPH_VERSION} 한 판만 허용한다 — 제품 current 는 ${graphVersion}`)
    const outRel = planInputRel(graphVersion)
    const outAbs = join(productRoot, outRel)
    // ④ 정확히 1회 — 대조보다 먼저 본다(이미 있으면 무엇도 다시 계산해 쓰지 않는다). 이름만 있는 symlink 도 "있다"로 본다
    if (present(outAbs)) stop('BUNDLE_ALREADY_EXISTS', `${outRel} 가 이미 있다 — bootstrap 은 그 판의 최초 1회뿐이다`)
    assertOutputPathSafe(productRoot, outRel)
    // 잔여 임시 파일 — 앞 실행이 link 전에 죽은 흔적이다. 지우지 않고 멈춘다(dry-run 도 같은 판정)
    const stale = staleTemps(REAL_IO, dirname(outAbs))
    if (stale.length) stop('STALE_TEMP_PRESENT', `잔여 임시 파일 ${stale.map((x) => `${dirname(outRel)}/${x}`).join(', ')} — 지우지 않는다(원인을 보고 사람이 치운다)`)
    const inputs = readAuthoritativeInputs({ productRoot, researchDir, snapshotDir, graphVersion })
    const controlText = inputs.product.controlText
    if (inputs.product.currentText !== currentText) stop('INPUT_DRIFT', 'current.ts 가 읽는 사이 바뀌었다')
    const firstIdentity = inputIdentity(inputs)
    const built = buildPlanInputBundle({
      research: { currentName: inputs.research.currentName, manifestText: inputs.research.manifestText, tree: inputs.research.tree,
        controlJsonText: inputs.research.controlJsonText, files: inputs.research.files },
      snapshot: { texts: inputs.snapshotTexts, canonicalGraphName: INPUT_FILES.graph },
      product: { currentText, controlText, controlGraphVersion: strictControlGraphVersion(controlText), graphFileText: inputs.product.graphFileText },
      evidenceTexts: inputs.evidenceTexts,
    })
    const compiled = compileContentPlans({ bundle: built.text })
    const summary = {
      ok: true,
      code: write ? 'WRITTEN' : 'DRY_RUN',
      graphVersion,
      bundlePath: outRel,
      bundleHash: built.bundle.bundleHash,
      intents: built.report.intents,
      relations: built.report.relations,
      evidenceFiles: built.report.evidenceFiles,
      textProvenance: built.report.textProvenance,
      excludedRelations: Object.entries(built.report.excluded.reduce((m, x) => ({ ...m, [x.code]: (m[x.code] ?? 0) + 1 }), {})).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([code, n]) => ({ code, n })),
      plans: compiled.plans.map((p) => ({ planId: p.planId, planHash: p.planHash, direct: p.relations.direct.length, discovery: p.relations.discovery.length, meetsDisplayTarget: p.quality.meetsDisplayTarget })),
      heldStatic: compiled.held.length,
    }

    if (admissionAsOf !== null) {
      // 엄격 시각 규칙 하나(public-rule) — 달력에 없는 날 · 24:00 · 오프셋 없음은 거부(Date.parse 정규화에 기대지 않는다 · P1-2)
      const ms = strictOffsetTimeMs(admissionAsOf)
      if (!Number.isFinite(ms)) stop('ADMISSION_AS_OF_INVALID', `--admission-as-of 는 오프셋이 있는 ISO 시각이다: ${admissionAsOf}`)
      const queueAbs = join(productRoot, QUEUE_REL)
      const admissionInput = {
        bundle: built.text, controlText, articlesText: productText(ARTICLES_REL),
        // legacy 가 남아 있는 동안 adapter 는 켜져 있다 — 파일이 없으면 null 을 넘겨 fail-closed 로 판정받는다
        legacyQueue: { active: true, text: existsSync(queueAbs) ? readFileSync(queueAbs, 'utf8') : null },
        nowMs: ms, inFlightPlanIds: [], withdrawnPlanIds: [],
      }
      const admission = admitContentPlans(admissionInput)
      summary.admission = {
        asOf: admission.asOf,
        releaseIdentity: admission.releaseIdentity,
        admitted: admission.admitted.map((a) => {
          // ProviderPlan 은 호출자 값을 믿지 않는다 — 같은 admission 입력으로 다시 도출하고 이 plan 의 planHash 에 묶는다(P1-E)
          const pp = projectProviderPlan({ admission: admissionInput, planId: a.planId, planHash: a.planHash })
          return { planId: a.planId, layer: a.layer, groundedBy: a.groundedBy.map((g) => g.edgeId), providerPlan: pp.ok ? 'READY' : 'HOLD', providerPlanProblems: pp.problems }
        }),
        held: admission.held.map((h) => ({ planId: h.planId, reasons: h.reasons })),
      }
    }

    if (write) {
      if (/(^|\/)soransoran-magazine-runtime(\/|$)/.test(productRoot)) stop('RUNTIME_ROOT_REFUSED', '운영 runtime 에는 쓰지 않는다')
      // 입력 CAS(P1-8) — 컴파일에 쓴 권위 입력을 publication(link) 바로 앞에서 같은 함수로 다시 읽어 키 단위로 대조한다
      const beforePublish = () => {
        const again = inputIdentity(readAuthoritativeInputs({ productRoot, researchDir, snapshotDir, graphVersion }))
        const drift = [...new Set([...Object.keys(firstIdentity), ...Object.keys(again)])].filter((k) => firstIdentity[k] !== again[k]).sort()
        if (drift.length) stop('INPUT_DRIFT', `컴파일 뒤 권위 입력이 바뀌었다 — ${drift.join(', ')} · 출력 0`)
      }
      summary.written = writeBundleNoClobber({ rootReal: productRoot, outRel, text: built.text }, { beforePublish }).written
    }
    return summary
  } catch (e) {
    if (e instanceof BootstrapStop) return { ok: false, code: e.code, why: e.why, ...(e.errno ? { errno: e.errno } : {}) }
    if (e instanceof PlanInputError || e instanceof ContentPlanError) return { ok: false, code: e.code, why: e.why }
    if (e?.code && e?.why) return { ok: false, code: e.code, why: e.why } // research-current treeOf 의 구조화 오류
    // 🔴 그 밖의 파일 시스템 오류도 구조화한다(P1-9) — errno 를 보존하고 stack trace 로 끝나지 않는다
    if (typeof e?.code === 'string' && /^E[A-Z0-9]+$/.test(e.code)) return { ok: false, code: 'FILESYSTEM_ERROR', why: String(e.message ?? e).split('\n')[0], errno: e.code }
    throw e
  }
}

function main(argv) {
  const usage = (why) => { process.stderr.write(`사용법 오류 — ${why}\n`); process.exit(2) }
  const KNOWN = new Set(['--research-dir', '--snapshot-dir', '--product-root', '--admission-as-of', '--write'])
  const vals = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!KNOWN.has(a)) usage(`모르는 인자 ${a}`)
    if (a === '--write') { vals.write = true; continue }
    const v = argv[++i]
    if (!v || v.startsWith('--')) usage(`${a} 값이 없다`)
    vals[a] = v
  }
  const real = (p, label) => {
    let r
    try { r = realpathSync(resolve(p)) } catch { usage(`${label} 경로가 없다: ${p}`) }
    if (/(^|\/)soransoran-magazine-runtime(\/|$)/.test(r)) usage(`${label} 가 운영 runtime 이다 — 받지 않는다 (${r})`)
    return r
  }
  if (!vals['--research-dir'] || !vals['--snapshot-dir']) usage('--research-dir 와 --snapshot-dir 가 필요하다 (기본값 없음)')
  const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let r
  try {
    r = runBootstrap({
      productRoot: real(vals['--product-root'] ?? here, '--product-root'),
      researchDir: real(vals['--research-dir'], '--research-dir'),
      snapshotDir: real(vals['--snapshot-dir'], '--snapshot-dir'),
      write: vals.write === true,
      admissionAsOf: vals['--admission-as-of'] ?? null,
    })
  } catch (e) {
    // 🔴 마지막 그물 — 예상하지 못한 예외도 문서화된 JSON · exit 1 로 낸다(stack trace 0 · P1-9)
    r = { ok: false, code: 'INTERNAL_ERROR', why: String(e?.message ?? e).split('\n')[0] }
  }
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`)
  process.exit(r.ok ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2))
