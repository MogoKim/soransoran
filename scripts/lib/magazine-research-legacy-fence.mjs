/**
 * 🔴 **연구 저장소 옛 graph 도구 퇴역 (fence)** (2026-11-02 · release gate ② P1-2).
 *
 *    연구 `contract/promote-graph.mjs` 는 새 lock · journal 을 모르고 current · previous · control 을 직접 쓴다.
 *    `build-graph` 는 제품 builder 와 다른 판을 만들고, `validate-graph` 는 그 판의 형식만 안다.
 *    연구 저장소는 git 이 아니라서 "고쳐 두자" 가 남지 않는다 — 이 모듈이 **고정된 원본 바이트를 확인하고서만**
 *    각 도구를 결정적인 퇴역 stub 으로 바꾼다. stub 은 옛 계산을 하지 않고 LEGACY_GRAPH_TOOL_RETIRED 로 끝나며 새 명령을 안내한다.
 *
 *    쓰기 계약 (연구 `contract/` 아래만):
 *      lock      `contract/.legacy-fence.lock` — O_EXCL. 있으면 LEGACY_FENCE_LOCKED (지우지 않는다)
 *      상태      파일마다 ORIGINAL(고정 sha256) · RETIRED(그 파일의 stub 바이트) · DRIFT · MISSING. DRIFT · MISSING 이 하나라도 있으면 쓰기 0
 *      백업      `contract/.legacy-retired/<이름>.<원본 sha256>.orig` — no-clobber. 있으면 원본 바이트일 때만 재사용
 *      교체      임시 파일(`.legacy-retired/.tmp-<txId>-<이름>`) + rename. rename 직전에 그 파일이 아직 기대 상태인지 다시 본다
 *      journal   `contract/.legacy-retired/journal.json` — 첫 쓰기 전에. 같은 op 를 다시 돌리면 남은 파일만 마저 한다(멱등 = 급사 뒤 완성)
 *      receipt   `contract/.legacy-retired/receipt.json` — 파일별 원본 · stub sha256 · 백업 경로 · 상태
 *    🔴 기본은 dry-run — 쓰기 0. 제품 저장소는 읽지도 쓰지도 않는다.
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs'
import { basename, join } from 'node:path'

export const FENCE_DIR = join('contract', '.legacy-retired')
export const FENCE_LOCK = join('contract', '.legacy-fence.lock')
export const FENCE_SCHEMA = 'research-legacy-fence/1'
const OFFICIAL = {
  verify: 'node <제품>/scripts/magazine-research-current.mjs verify|install|rollback|recover',
  check: 'node <제품>/scripts/magazine-research-current.mjs check --research-dir <연구>',
  build: 'node <제품>/scripts/magazine-graph-build.mjs --input-root <snapshot> --product-root <제품> --effective-at … --generated-at … --out-dir <밖>',
  tests: 'node <제품>/scripts/magazine-research-current-check.mjs --research <연구>',
}

/** 고정 원본 — 2026-11-02 실제 연구 저장소 판독값. 다르면 LEGACY_TOOL_DRIFT 로 쓰기 0 */
export const LEGACY_TOOLS = Object.freeze({
  'contract/build-graph.mjs': { sha256: 'a400a3a53078363422404dd38a10b6beae02b52130390df2b9f05b2a7d4434ec', replacement: OFFICIAL.build, why: '제품 builder 와 다른 판(existingAssetRelation 옛 문자열)을 만든다' },
  'contract/promote-graph.mjs': { sha256: 'a8910b5f6e1aadd8e7ffaa59205ae0b7cd93bf68afdaff3b6fcbe5efe7754229', replacement: OFFICIAL.verify, why: 'lock · journal · CAS 없이 current · previous · control 을 쓴다' },
  'contract/validate-graph.mjs': { sha256: '0b229c40c114fbe554ae4b032269f51c405e186ea4aae1d42daf0bc26d2978e2', replacement: OFFICIAL.check, why: '옛 연구 builder manifest 형식만 안다 — 제품 builder 판을 판정하지 못한다' },
  'contract/export-graph.mjs': { sha256: 'ded89461160cfd03f1da7b75b57ed152da16d040a49adeb3536fdd516f3da1e2', replacement: OFFICIAL.build, why: '제품 bundle 은 제품 builder 가 만든다 — 연구 current 로 bundle 을 다시 만들지 않는다' },
  'contract/deliver-to-product.mjs': { sha256: 'c76121ba84adaa8c7d07b5eb2021cc39b4ebd1de7182b15467adae954f27bf09', replacement: '제품 저장소의 graph promote PR (사람 승인)', why: 'export-graph 산출을 제품에 내려놓는 옛 writer 다' },
  'contract/fault-injection.test.mjs': { sha256: '262783ae8246c25a1a3b688827c1198789df163bd8fbded182a8877d032bdc13', replacement: OFFICIAL.tests, why: '옛 validate-graph 를 시험한다' },
  'contract/promote-regression.test.mjs': { sha256: '488c95a6f6bf86b1fb0f89703a1cb8db3a6269b18401cb869d19afee945f9dc2', replacement: OFFICIAL.check, why: '옛 promote-graph 를 실행하고 그 형식을 요구한다' },
  'contract/delivery.test.mjs': { sha256: 'ef1a2bacf254b1962169eb176e233d2da4be575c5d91956aacb49c986c3fcf28', replacement: OFFICIAL.tests, why: '옛 export-graph 를 시험한다' },
  'contract/m3-e2e.mjs': { sha256: '329eb89eb90196531d0a0fbaae379061614cc40eb35adb055d51db9d3dd227a4', replacement: OFFICIAL.tests, why: '옛 build-graph · validate-graph 로 e2e 를 돈다' },
})

const sha256 = (b) => createHash('sha256').update(b).digest('hex')
/** 퇴역 stub — 파일마다 결정적 바이트 (같은 원본이면 언제 만들어도 같다) */
export function stubText(rel, spec = LEGACY_TOOLS[rel]) {
  const record = { code: 'LEGACY_GRAPH_TOOL_RETIRED', tool: rel, originalSha256: spec.sha256, why: spec.why, replacement: spec.replacement,
    backup: `${FENCE_DIR}/${basename(rel)}.${spec.sha256}.orig`, installedBy: 'soransoran scripts/magazine-research-legacy-fence.mjs' }
  return `#!/usr/bin/env node\n// 🔴 퇴역 — LEGACY_GRAPH_TOOL_RETIRED. 옛 계산을 하지 않는다. 손으로 고치지 않는다 (제품 저장소 fence 도구가 설치 · rollback 한다)\n`
    + `const record = ${JSON.stringify(record, null, 2)}\nprocess.stderr.write(\`\${JSON.stringify(record, null, 2)}\\n\`)\nprocess.exit(3)\n`
}
const backupOf = (root, rel) => join(root, FENCE_DIR, `${basename(rel)}.${LEGACY_TOOLS[rel].sha256}.orig`)

/** 파일별 상태 — 읽기만 */
export function fenceStatus(root, tools = LEGACY_TOOLS) {
  const files = Object.keys(tools).map((rel) => {
    const p = join(root, rel)
    if (!existsSync(p)) return { rel, state: 'MISSING' }
    const h = sha256(readFileSync(p))
    const state = h === tools[rel].sha256 ? 'ORIGINAL' : h === sha256(stubText(rel, tools[rel])) ? 'RETIRED' : 'DRIFT'
    const b = join(root, FENCE_DIR, `${basename(rel)}.${tools[rel].sha256}.orig`)
    return { rel, state, sha256: h, backup: existsSync(b) ? (sha256(readFileSync(b)) === tools[rel].sha256 ? 'OK' : 'DRIFT') : 'NONE' }
  })
  const jp = join(root, FENCE_DIR, 'journal.json')
  let journal = null
  if (existsSync(jp)) { try { journal = JSON.parse(readFileSync(jp, 'utf8')) } catch { journal = { unreadable: true } } }
  return { files, journal, locked: existsSync(join(root, FENCE_LOCK)) }
}

function writeAtomic(path, text, tmp) {
  const fd = openSync(tmp, 'wx')
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, path)
}
function phase(name, hooks) {
  hooks?.[name]?.()
  const spec = process.env.SORAN_RESEARCH_CURRENT_TEST === '1' ? process.env.SORAN_LEGACY_FENCE_FAULT : null
  if (!spec) return
  const [what, at] = spec.split('@')
  if (at !== name) return
  if (what === 'kill') process.kill(process.pid, 'SIGKILL')
  if (what === 'throw') throw new Error(`FAULT_INJECTED@${name}`)
}

/**
 * op = 'apply' (원본 → stub) · 'rollback' (stub → 원본 백업).
 * 같은 op 의 journal 이 남아 있으면 그 tx 의 임시 조각을 치우고 남은 파일을 마저 한다. 다른 op 의 journal 이면 RECOVERY_REQUIRED.
 */
export function runFence({ root, op, write = false, hooks = {}, tools = LEGACY_TOOLS }) {
  if (!['apply', 'rollback'].includes(op)) return { ok: false, code: 'USAGE', why: `op ${op}` }
  const st = fenceStatus(root, tools)
  const bad = st.files.filter((f) => f.state === 'DRIFT' || f.state === 'MISSING')
  if (bad.length) return { ok: false, code: 'LEGACY_TOOL_DRIFT', why: `고정 원본도 퇴역 stub 도 아닌 파일 — 쓰기 0: ${bad.map((f) => `${f.rel}(${f.state})`).join(', ')}`, files: st.files }
  if (st.journal?.unreadable) return { ok: false, code: 'RECOVERY_REQUIRED', why: 'fence journal 을 읽지 못했다' }
  if (st.journal && st.journal.op !== op) return { ok: false, code: 'RECOVERY_REQUIRED', why: `남은 journal 은 ${st.journal.op} 다 — 그 op 를 먼저 마친다` }
  const want = op === 'apply' ? 'RETIRED' : 'ORIGINAL'
  const todo = st.files.filter((f) => f.state !== want).map((f) => f.rel)
  if (op === 'rollback') {
    const noBackup = st.files.filter((f) => f.state === 'RETIRED' && f.backup !== 'OK')
    if (noBackup.length) return { ok: false, code: 'LEGACY_BACKUP_DRIFT', why: `원본 백업이 없거나 다르다 — 복원하지 않는다: ${noBackup.map((f) => f.rel).join(', ')}` }
  }
  if (op === 'apply') {
    const badBackup = st.files.filter((f) => f.backup === 'DRIFT')
    if (badBackup.length) return { ok: false, code: 'LEGACY_BACKUP_DRIFT', why: `백업 자리에 다른 바이트가 있다 — 덮지 않는다: ${badBackup.map((f) => f.rel).join(', ')}` }
  }
  const plan = { op, todo, files: st.files.map((f) => `${f.rel}:${f.state}`), resume: Boolean(st.journal) }
  if (!write) return { ok: true, code: 'DRY_RUN', plan }
  if (!todo.length && !st.journal) return { ok: true, code: op === 'apply' ? 'ALREADY_RETIRED' : 'ALREADY_ORIGINAL', plan }
  const lockPath = join(root, FENCE_LOCK)
  let fd
  try { fd = openSync(lockPath, 'wx') } catch (e) { if (e.code === 'EEXIST') return { ok: false, code: 'LEGACY_FENCE_LOCKED', why: '다른 fence 실행이 잠금을 쥐고 있다' }; throw e }
  const txId = st.journal?.txId ?? randomUUID()
  try { writeSync(fd, `${JSON.stringify({ txId, pid: process.pid })}\n`) } finally { closeSync(fd) }
  try {
    const dir = join(root, FENCE_DIR)
    mkdirSync(dir, { recursive: true })
    for (const n of readdirSync(dir)) if (n.startsWith(`.tmp-${txId}-`)) rmSync(join(dir, n), { force: true })
    const jp = join(dir, 'journal.json')
    if (!st.journal) writeAtomic(jp, `${JSON.stringify({ schema: FENCE_SCHEMA, txId, op, startedAt: new Date().toISOString() }, null, 2)}\n`, join(dir, `.tmp-${txId}-journal`))
    phase(`${op}-journaled`, hooks)
    for (const rel of todo) {
      const p = join(root, rel)
      const spec = tools[rel]
      if (op === 'apply') {
        const b = join(dir, `${basename(rel)}.${spec.sha256}.orig`)
        if (!existsSync(b)) writeAtomic(b, readFileSync(p), join(dir, `.tmp-${txId}-${basename(rel)}.orig`))
        if (sha256(readFileSync(b)) !== spec.sha256) throw Object.assign(new Error(`${rel} 백업이 원본과 다르다`), { code: 'LEGACY_BACKUP_DRIFT' })
        phase(`apply-backed-up:${basename(rel)}`, hooks)
        if (sha256(readFileSync(p)) !== spec.sha256) throw Object.assign(new Error(`${rel} 가 교체 직전에 바뀌었다`), { code: 'LEGACY_TOOL_DRIFT' })
        writeAtomic(p, stubText(rel, spec), join(dir, `.tmp-${txId}-${basename(rel)}`))
      } else {
        const b = join(dir, `${basename(rel)}.${spec.sha256}.orig`)
        if (sha256(readFileSync(p)) !== sha256(stubText(rel, spec))) throw Object.assign(new Error(`${rel} 가 복원 직전에 바뀌었다`), { code: 'LEGACY_TOOL_DRIFT' })
        writeAtomic(p, readFileSync(b), join(dir, `.tmp-${txId}-${basename(rel)}`))
      }
      phase(`${op}-replaced:${basename(rel)}`, hooks)
    }
    const after = fenceStatus(root, tools)
    if (after.files.some((f) => f.state !== want)) throw Object.assign(new Error(`끝난 뒤 상태가 ${want} 가 아니다`), { code: 'POST_FENCE_DRIFT' })
    writeAtomic(join(dir, 'receipt.json'), `${JSON.stringify({ schema: FENCE_SCHEMA, op, txId, state: want, finishedAt: new Date().toISOString(),
      files: after.files.map((f) => ({ rel: f.rel, state: f.state, sha256: f.sha256, originalSha256: tools[f.rel].sha256, stubSha256: sha256(stubText(f.rel, tools[f.rel])), backup: `${FENCE_DIR}/${basename(f.rel)}.${tools[f.rel].sha256}.orig` })) }, null, 2)}\n`,
    join(dir, `.tmp-${txId}-receipt`))
    unlinkSync(jp)
    return { ok: true, code: op === 'apply' ? 'RETIRED' : 'RESTORED', plan, txId }
  } catch (e) {
    return { ok: false, code: e.code ?? 'FENCE_FAILED', why: e.message, recovery: 'RERUN_SAME_OP' }
  } finally { try { unlinkSync(lockPath) } catch { /* 없다 */ } }
}
