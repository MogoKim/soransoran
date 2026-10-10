/**
 * 🔴 **입력 수리 단계 — REPAIR_REQUIRED 를 사람 없이 고친다** (2026-10-10 자연 회차).
 *
 *    10/10 회차는 인프라가 아니라 입력이 막았다. 이번 범위는 정확히 두 종류다.
 *      ① BRIEF_FORMAT_CONTRACT — brief 에 표기 규칙(CTA 지시·허용 표기 표·금지 규칙)이 없다 (gray-hair-leave-as-is)
 *      ② DRAFT_INVALID(brief echo) — 원고 자리에 brief 가 그대로 저장돼 있다 (cold-weather · autumn-low-mood)
 *
 *    producer 회차 안에서 잠금·미해결 작업 검사를 통과한 뒤, 일반 원고 회수 **전에** 돈다.
 *
 * 🔴 **지키는 것**
 *    - 한 회차 최대 3건 · 큐 순서(day → slug)로 결정적 · 같은 수리 지문은 회차를 넘어 한 번만 (무한 반복 0)
 *    - 전송불명(DELIVERY_UNCERTAIN) 기록이 있는 slug 는 **어떤 수리도 하지 않는다** — brief 를 고치면
 *      메시지 지문이 바뀌어 HOLD 가 풀리고 같은 글이 다시 나간다 (HOLD 6건 runner 0 · 전송 0)
 *    - 후보는 임시 경로에서만 만들고, **모든 검증을 통과한 뒤에만** 원본을 journal 아래 교체한다
 *    - 한 후보의 실패·예외는 다른 후보를 막지 않는다
 *    - 입력 수리는 CONTENT attempts · QA regenCalls 를 쓰지 않는다
 *      (ChatGPT 전송은 inputRepairCalls · brief provider 호출은 briefRepairs[].providerCalls · briefRepairCalls 로 따로 센다)
 *    - 큐·articles.ts 를 고치지 않는다 · 장부는 quarantine 정본 함수(잠금 안)로만 · hero·등록·PR·병합 0
 *
 * 🔴 판정은 전부 기존 정본을 부른다 — `verifyBrief`(G1~G7·GF) · `judgeBriefFormatContract` ·
 *    `briefEchoHeadings` · `validateManuscript` · `judgeManuscriptFormat` · md-to-draft 변환.
 */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { judgeBriefFormatContract, judgeManuscriptFormat } from './magazine-manuscript-format.mjs'
import { briefEchoHeadings, validateManuscript } from './magazine-manuscript-guard.mjs'
import { verifyBrief } from './magazine-brief-policy.mjs'
import { isAutoLaneEligible } from './magazine-validation-profile.mjs'
import { checkJournalIdentity, shaOrAbsent, writeAtomic } from './magazine-g8-promoter.mjs'
import { reserveBriefRepair, settleBriefRepair } from './magazine-quarantine.mjs'

export const MAX_REPAIRS_PER_RUN = 3
export const REPAIR = { BRIEF: 'BRIEF_FORMAT_CONTRACT', DRAFT_ECHO: 'DRAFT_INVALID_BRIEF_ECHO' }
export const JOURNAL_FILE = '.input-repair-journal.json'

const sha = (t) => createHash('sha256').update(String(t)).digest('hex')

/** 전송불명 기록이 있는가 — 지문과 무관하게 수리하지 않는다 */
export const hasDeliveryUncertain = (entry) => entry?.delivery?.kind === 'DELIVERY_UNCERTAIN'

/**
 * 🔴 **수리 대상 찾기 — 순수 함수.** 파일 읽기는 주입한 `read`/`exists` 로만 한다.
 * @returns {{targets:object[], skipped:object[]}}
 */
export function scanRepairTargets({ queue, draftsDir, store, exists = existsSync, read = (p) => readFileSync(p, 'utf8') }) {
  const targets = []
  const skipped = []
  const ordered = [...(queue ?? [])].sort((a, b) => (Number(a.day) - Number(b.day)) || String(a.slug).localeCompare(String(b.slug)))
  for (const item of ordered) {
    const slug = item.slug
    const brief = join(draftsDir, slug, 'brief.md')
    const draft = join(draftsDir, slug, 'draft.md')
    if (!exists(brief)) continue
    if (!isAutoLaneEligible(item).ok) continue
    const entry = store?.[slug] ?? null
    if (exists(draft)) {
      const echo = briefEchoHeadings(read(draft))
      if (!echo.length) continue
      if (hasDeliveryUncertain(entry)) { skipped.push({ slug, type: REPAIR.DRAFT_ECHO, reason: 'DELIVERY_UNCERTAIN_HOLD' }); continue }
      targets.push({ slug, type: REPAIR.DRAFT_ECHO, item, violations: echo.map((h) => ({ code: 'BRIEF_ECHO', why: `## ${h}` })) })
      continue
    }
    const contract = judgeBriefFormatContract(read(brief))
    if (contract.ok) continue
    if (hasDeliveryUncertain(entry)) { skipped.push({ slug, type: REPAIR.BRIEF, reason: 'DELIVERY_UNCERTAIN_HOLD' }); continue }
    targets.push({ slug, type: REPAIR.BRIEF, item, violations: contract.violations })
  }
  return { targets, skipped }
}

/** brief 수리 지문 — (slug · 원본 brief · 큐 행). 운영 장부에 영구 예약돼 같은 지문은 provider 를 한 번만 부른다 */
export function briefRepairFingerprint({ slug, briefText, item }) {
  return `sha256:${sha(JSON.stringify({ kind: REPAIR.BRIEF, slug, brief: sha(briefText), item }))}`
}

// ─────────────────────────────────────────────────────────
// 원자 교체 — 🔴 journal 이 먼저다. 급사하면 다음 실행이 원본으로 되돌린다
//
// 🔴 **journal 을 믿지 않는다** (2026-10-10 Codex P0).
//    앞판 recoverJournal 은 journal 의 files[].path · backup · staged 를 그대로 믿었다. 그래서 위조·손상된
//    journal 하나로 원고 폴더 밖 파일을 지우거나 덮을 수 있었고, 급사 뒤 다른 writer 가 바꾼 파일도 덮었다.
//    이제 G8 apply journal 과 **같은 검증**을 지난다 — 신원 검사(`checkJournalIdentity`)와 fsync 쓰기(`writeAtomic`)는
//    G8 의 것을 그대로 부르고, 이 단계에만 있는 것(kind·slug·역할·txId·phase·backup/staged 이름·symlink)을 더 본다.
//      신원이 어긋나면 RECOVERY_IDENTITY — 대상·외부 파일·backup·staged·journal 어느 것도 쓰거나 지우지 않는다.
//      현재 바이트가 journal 의 before 도 after 도 아니면 RECOVERY_CONFLICT — 아무것도 덮지 않는다.
// ─────────────────────────────────────────────────────────

export const JOURNAL_SCHEMA = 'input-repair-journal/2'
/** 교체 종류별로 인정하는 파일 — 🔴 이 목록 밖의 경로는 어떤 journal 이 적어도 건드리지 않는다 */
export const TX_FILES = Object.freeze({
  BRIEF: Object.freeze([['brief', 'brief.md'], ['review', 'review.ts']]),
  DRAFT: Object.freeze([['draft', 'draft.md']]),
})
const TX_PHASES = {
  BRIEF: ['initializing', 'prepared', 'committing-1', 'committing-2', 'committed'],
  DRAFT: ['initializing', 'prepared', 'committing-1', 'committed'],
}
const TX_ID = /^[0-9a-f]{16}$/
const HEX64 = /^[0-9a-f]{64}$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const backupOf = (file, txId) => `${file}.input-repair-backup-${txId}`
const stagedOf = (file, txId) => `${file}.input-repair-staged-${txId}`

/** 있으면 lstat, 없으면 null — 🔴 symlink 를 따라가지 않는다 */
function lstatOrNull(p) {
  try { return lstatSync(p) } catch (e) { if (e?.code === 'ENOENT') return null; throw e }
}
const readOrNull = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)

/** 현재 원고 폴더의 정본 slug 폴더 — 🔴 slug 모양 · 실제 디렉터리 · symlink 아님 */
function canonicalSlugDir(draftsDir, slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) return { ok: false, why: `slug 모양이 아니다 (${String(slug)})` }
  let root
  try { root = realpathSync(draftsDir) } catch (e) { return { ok: false, why: `원고 폴더를 확인하지 못했다: ${e?.message ?? e}` } }
  const dir = join(root, slug)
  const st = lstatOrNull(dir)
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return { ok: false, why: `${dir} 가 실제 디렉터리가 아니다 (symlink 탈출 금지)` }
  return { ok: true, root, dir }
}

/** 이 slug · 이 종류의 교체가 건드릴 수 있는 정확한 절대 경로 (역할 순서 그대로) */
export function expectedTxFiles({ draftsDir, slug, kind }) {
  const d = canonicalSlugDir(draftsDir, slug)
  if (!d.ok || !TX_FILES[kind]) return null
  return TX_FILES[kind].map(([role, name]) => ({ role, path: join(d.dir, name) }))
}

/**
 * 🔴 **입력 수리 journal 신원 검증** — 읽기만 한다. 쓰기·지우기 0.
 *    G8 `checkJournalIdentity`(schema · 개수 · 절대 경로 · 중복 · 정확한 경로 · before/afterSha) 위에
 *    kind · slug · txId · phase · 역할 · beforeSha 일치 · backup/staged 이름과 위치 · symlink 를 더 본다.
 */
export function checkRepairJournalIdentity(j, { draftsDir, slug }) {
  const fail = (why) => ({ ok: false, code: 'RECOVERY_IDENTITY', why })
  if (!j || typeof j !== 'object' || Array.isArray(j)) return fail('journal 이 객체가 아니다')
  if (j.schema !== JOURNAL_SCHEMA) return fail(`schema 가 ${JOURNAL_SCHEMA} 가 아니다 (${String(j.schema)})`)
  if (!Object.hasOwn(TX_FILES, String(j.kind))) return fail(`교체 종류가 BRIEF·DRAFT 가 아니다 (${String(j.kind)})`)
  if (j.slug !== slug) return fail(`journal slug(${String(j.slug)})가 이 폴더(${slug})와 다르다`)
  const d = canonicalSlugDir(draftsDir, slug)
  if (!d.ok) return fail(d.why)
  const want = expectedTxFiles({ draftsDir, slug, kind: j.kind })
  const base = checkJournalIdentity(j, want.map((w) => w.path), JOURNAL_SCHEMA)
  if (!base.ok) return { ...base, code: 'RECOVERY_IDENTITY' }
  if (typeof j.txId !== 'string' || !TX_ID.test(j.txId)) return fail(`txId 모양이 아니다 (${String(j.txId)})`)
  if (!TX_PHASES[j.kind].includes(j.phase)) return fail(`${j.kind} 교체에 없는 phase 다 (${String(j.phase)})`)
  for (const w of want) {
    const f = j.files.find((x) => x?.path === w.path)
    if (!f || typeof f !== 'object') return fail(`${w.path} 항목이 없다`)
    if (f.role !== w.role) return fail(`${w.path} 의 역할이 ${w.role} 가 아니다 (${String(f.role)})`)
    if (f.beforeSha !== shaOrAbsent(f.before)) return fail(`${w.path} 의 beforeSha 가 before 원문과 맞지 않는다`)
    if (!HEX64.test(f.afterSha)) return fail(`${w.path} 의 afterSha 가 sha256 이 아니다`)
    if (f.backup !== backupOf(w.path, j.txId)) return fail(`${w.path} 의 backup 경로가 정해진 이름·위치가 아니다 (${String(f.backup)})`)
    if (f.staged !== stagedOf(w.path, j.txId)) return fail(`${w.path} 의 staged 경로가 정해진 이름·위치가 아니다 (${String(f.staged)})`)
    for (const p of [w.path, f.backup, f.staged]) {
      const st = lstatOrNull(p)
      if (st && (st.isSymbolicLink() || !st.isFile())) return fail(`${p} 가 일반 파일이 아니다 (symlink 탈출 금지)`)
    }
  }
  return { ok: true }
}

/** 처음 만드는 파일 — `wx` · fsync. 같은 이름이 있으면 덮지 않고 실패한다 */
function createDurable(file, text) {
  const fd = openSync(file, 'wx')
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
}

/**
 * 한 slug 의 정해진 파일만 한 쌍으로 교체한다.
 * 순서: journal(initializing · before 원문 포함) → backup → staged → prepared → rename… → committed → 정리.
 * journal 은 매번 임시 파일 → fsync → rename (G8 `writeAtomic`). `phaseHook(phase)` 는 시험이 급사 지점을 고르는 자리다.
 *
 * @param {{draftsDir:string, slug:string, kind:'BRIEF'|'DRAFT', files:Record<string,string>, phaseHook?:(phase:string)=>void}} p
 *   files 는 역할 → 새 원문 (BRIEF: brief·review · DRAFT: draft). 🔴 역할이 정확히 맞지 않으면 아무것도 쓰지 않는다.
 */
export function commitFiles({ draftsDir, slug, kind, files, phaseHook = () => {} }) {
  const want = expectedTxFiles({ draftsDir, slug, kind })
  if (!want) throw new Error(`교체 대상이 아니다 — ${kind} · ${slug}`)
  const roles = Object.keys(files ?? {}).sort()
  if (roles.join(',') !== want.map((w) => w.role).sort().join(',') || roles.some((r) => typeof files[r] !== 'string')) {
    throw new Error(`${kind} 교체는 ${want.map((w) => w.role).join('·')} 정확히 ${want.length}개만 받는다 (${roles.join(',')})`)
  }
  const dir = dirname(want[0].path)
  const journalPath = join(dir, JOURNAL_FILE)
  if (lstatOrNull(journalPath)) throw new Error(`이미 진행 중인 교체 journal 이 있다: ${journalPath}`)
  for (const w of want) {
    const st = lstatOrNull(w.path)
    if (st && (st.isSymbolicLink() || !st.isFile())) throw new Error(`${w.path} 가 일반 파일이 아니다 — 교체하지 않는다`)
  }
  const txId = randomUUID().replace(/-/g, '').slice(0, 16)
  const tx = {
    schema: JOURNAL_SCHEMA, txId, kind, slug, phase: 'initializing',
    files: want.map((w) => {
      const before = readOrNull(w.path)
      return { role: w.role, path: w.path, before, beforeSha: shaOrAbsent(before), afterSha: shaOrAbsent(files[w.role]),
        backup: backupOf(w.path, txId), staged: stagedOf(w.path, txId) }
    }),
  }
  const save = () => writeAtomic(journalPath, `${JSON.stringify(tx, null, 2)}\n`)
  save()
  phaseHook(tx.phase)
  for (const f of tx.files) if (f.before !== null) createDurable(f.backup, f.before)
  for (const f of tx.files) createDurable(f.staged, files[f.role])
  tx.phase = 'prepared'; save(); phaseHook(tx.phase)
  tx.files.forEach((f, i) => {
    renameSync(f.staged, f.path)
    tx.phase = `committing-${i + 1}`; save(); phaseHook(tx.phase)
  })
  tx.phase = 'committed'; save(); phaseHook(tx.phase)
  for (const f of tx.files) rmSync(f.backup, { force: true })
  rmSync(journalPath, { force: true })
  return { ok: true, txId }
}

/**
 * 남은 journal 을 처리한다 — committed 전이면 원본으로 되돌리고, committed 면 정리만 한다.
 * 🔴 신원 검증 → 충돌 검증을 **둘 다** 통과해야 첫 쓰기가 일어난다. 실패하면 journal 도 그대로 둔다.
 * @returns {{recovered:boolean, ok?:boolean, code?:string, why?:string, phase?:string, rolledBack?:boolean}}
 */
export function recoverJournal({ draftsDir, slug }) {
  const journalPath = join(draftsDir, String(slug), JOURNAL_FILE)
  const jst = lstatOrNull(journalPath)
  if (!jst) return { recovered: false }
  if (jst.isSymbolicLink() || !jst.isFile()) return { recovered: false, ok: false, code: 'RECOVERY_IDENTITY', why: 'journal 이 일반 파일이 아니다' }
  let j
  try { j = JSON.parse(readFileSync(journalPath, 'utf8')) } catch (e) {
    return { recovered: false, ok: false, code: 'RECOVERY_IDENTITY', why: `journal 을 읽지 못했다: ${e?.message ?? e}` }
  }
  const id = checkRepairJournalIdentity(j, { draftsDir, slug })
  if (!id.ok) return { recovered: false, ...id }
  const committed = j.phase === 'committed'
  for (const f of j.files) {
    const cur = shaOrAbsent(readOrNull(f.path))
    const allowed = committed ? [f.afterSha] : [f.beforeSha, f.afterSha]
    if (!allowed.includes(cur)) {
      return { recovered: false, ok: false, code: 'RECOVERY_CONFLICT', why: `${f.path} 가 급사 뒤 다른 writer 에 의해 바뀌었다 — 되돌리지 않는다` }
    }
  }
  if (!committed) {
    for (const f of j.files) {
      if (shaOrAbsent(readOrNull(f.path)) === f.beforeSha) continue
      if (f.before === null) rmSync(f.path, { force: true })
      else writeAtomic(f.path, f.before)
    }
    if (!j.files.every((f) => readOrNull(f.path) === f.before)) {
      return { recovered: false, ok: false, code: 'RECOVERY_FAILED', why: '되돌린 뒤 바이트가 원본과 다르다 — journal 을 남긴다' }
    }
  }
  for (const f of j.files) { rmSync(f.backup, { force: true }); rmSync(f.staged, { force: true }) }
  rmSync(journalPath, { force: true })
  return { recovered: true, ok: true, phase: j.phase, rolledBack: !committed }
}

/** 원고 폴더 전체에서 남은 journal 을 처리한다 */
export function recoverAllJournals(draftsDir) {
  const out = []
  if (!existsSync(draftsDir)) return out
  for (const slug of readdirSync(draftsDir)) {
    if (lstatOrNull(join(draftsDir, slug, JOURNAL_FILE))) out.push({ slug, ...recoverJournal({ draftsDir, slug }) })
  }
  return out
}

// ─────────────────────────────────────────────────────────
// 수리 실행
// ─────────────────────────────────────────────────────────

/**
 * 한 회차의 입력 수리. 바깥 호출(Claude·ChatGPT·변환기)은 전부 주입이다.
 *
 * @param {object} p
 * @param {string} p.draftsDir
 * @param {object[]} p.queue
 * @param {{ok:boolean, store:object, why?:string}} p.ledger   장부 읽기 결과 (호출부가 한 번 읽어 넘긴다)
 * @param {object} p.deps
 * @param {(t:{slug:string, item:object})=>Promise<{ok:boolean, briefText?:string, reviewText?:string, why?:string, calls?:number}>} p.deps.generateBrief
 * @param {(t:{slug:string})=>{gate:{ok:boolean, hold:object|null, messageFingerprint:string|null, why?:string}}} p.deps.repairGate
 * @param {(t:{slug:string, draftOut:string})=>Promise<object>} p.deps.runRepairFetch   구조화된 회수 결과 행
 * @param {(candidatePath:string)=>{ok:boolean, why?:string}} p.deps.convertCheck
 */
export async function runInputRepair({ draftsDir, queue, ledger, quarantinePath, deps, max = MAX_REPAIRS_PER_RUN, tmpDir }) {
  const log = deps.log ?? (() => {})
  const recovered = recoverAllJournals(draftsDir)
  for (const r of recovered) log(`  ↺ ${r.slug} — 급사한 교체 journal 처리 (${r.recovered ? `${r.rolledBack ? '원복' : '정리'} · ${r.phase}` : `${r.code}: ${r.why}`})`)
  if (!ledger?.ok) {
    return { ok: false, code: 'QUARANTINE_UNREADABLE', why: ledger?.why ?? '장부를 읽지 못했다', results: [], skipped: [], recovered }
  }
  if (!quarantinePath) throw new Error('quarantinePath 가 필요하다 — brief 수리 실행권은 운영 장부 잠금 안에서 예약한다')
  const scan = scanRepairTargets({ queue, draftsDir, store: ledger.store })
  // 🔴 처리하지 못한 journal 이 남은 slug 는 이번 회차에 손대지 않는다 — 사람이 본다
  const blocked = new Set(recovered.filter((r) => !r.recovered).map((r) => r.slug))
  const targets = scan.targets.filter((t) => !blocked.has(t.slug))
  const skipped = [...scan.skipped, ...scan.targets.filter((t) => blocked.has(t.slug)).map((t) => ({ slug: t.slug, type: t.type, reason: 'RECOVERY_BLOCKED' }))]
  const chosen = targets.slice(0, max)
  const deferred = targets.slice(max).map((t) => ({ slug: t.slug, type: t.type, reason: 'RUN_LIMIT' }))
  const seen = new Set()
  const results = []
  mkdirSync(tmpDir, { recursive: true })
  for (const t of chosen) {
    const base = { slug: t.slug, type: t.type, violations: t.violations, sent: false, candidateApplied: false, conversationUrl: null }
    try {
      results.push(t.type === REPAIR.BRIEF
        ? await repairBrief({ t, base, draftsDir, deps, quarantinePath })
        : await repairDraftEcho({ t, base, draftsDir, deps, seen, tmpDir }))
    } catch (e) {
      // 🔴 한 후보의 예외는 다른 후보를 막지 않는다 — 원본은 교체 전이거나 journal 이 지킨다
      results.push({ ...base, outcome: 'FAILED', reason: `예외: ${e?.message ?? e}` })
    }
  }
  return { ok: true, results, skipped: [...skipped, ...deferred], recovered, limit: max }
}

/**
 * 🔴 **brief 수리 실행권은 한 지문에 한 번이다** (2026-10-10 Codex P1).
 *    앞판은 같은 회차 안에서만 지문을 기억했다. 그래서 수리가 실패·REJECTED 로 끝나면
 *    다음 자연 회차가 **같은 brief 로 다시 Claude 를 최대 2회** 불렀다 — 매일, 끝없이.
 *    이제 provider 를 부르기 **전에** 운영 장부 잠금 안에서 (slug, 지문) 실행권을 영구 예약한다.
 *    같은 지문이면 다음 회차는 provider 호출 0 · REPAIR_EXHAUSTED. 급사해 호출 여부를 몰라도 예약이 남아 다시 부르지 않는다.
 *    원본 brief 또는 큐 입력이 바뀌어 지문이 달라질 때만 새 실행권이 생긴다.
 *    호출 횟수는 CONTENT attempts · QA regenCalls 가 아니라 `briefRepairs[].providerCalls` · `briefRepairCalls` 에 남는다.
 */
async function repairBrief({ t, base, draftsDir, deps, quarantinePath }) {
  const dir = join(draftsDir, t.slug)
  const repairFingerprint = briefRepairFingerprint({ slug: t.slug, briefText: readFileSync(join(dir, 'brief.md'), 'utf8'), item: t.item })
  const out = { ...base, repairFingerprint, providerCalls: 0 }
  const r = reserveBriefRepair({ slug: t.slug, fingerprint: repairFingerprint, path: quarantinePath })
  if (!r.ok) {
    const outcome = r.code === 'REPAIR_EXHAUSTED' ? 'REPAIR_EXHAUSTED' : r.code === 'DELIVERY_UNCERTAIN_HOLD' ? 'HELD' : 'FAILED'
    return { ...out, outcome, reason: `${r.why} (provider 호출 0)`, priorOutcome: r.prior?.outcome ?? null }
  }
  let outcome = 'FAILED'
  let calls = null
  try {
    const cand = await deps.generateBrief({ slug: t.slug, item: t.item })
    calls = Number.isFinite(cand?.calls) ? cand.calls : null
    out.providerCalls = calls
    if (!cand?.ok) return { ...out, outcome, reason: `brief 후보 생성 실패 — ${cand?.why ?? '사유 없음'}` }
    // 🔴 후보를 **여기서 다시** 판정한다 — 생성기의 말을 믿지 않는다 (G1~G7 · GF · 형식 계약)
    const contract = judgeBriefFormatContract(cand.briefText)
    const verdict = verifyBrief({ briefText: cand.briefText, review: deps.parseReview(cand.reviewText), queueItem: t.item })
    if (!contract.ok || !verdict.ok) {
      outcome = 'REJECTED'
      return { ...out, outcome, reason: 'brief 후보가 계약을 통과하지 못했다 — 원본 두 파일 그대로',
        candidateViolations: [...contract.violations.map((v) => `${v.code}: ${v.why}`), ...verdict.results.filter((x) => !x.ok).map((x) => `${x.gate}: ${x.detail}`)] }
    }
    commitFiles({ draftsDir, slug: t.slug, kind: 'BRIEF', files: {
      brief: cand.briefText.endsWith('\n') ? cand.briefText : `${cand.briefText}\n`,
      review: cand.reviewText.endsWith('\n') ? cand.reviewText : `${cand.reviewText}\n`,
    }, phaseHook: deps.phaseHook })
    outcome = 'APPLIED'
    return { ...out, outcome, candidateApplied: true, reason: 'brief·review 한 쌍 교체' }
  } finally {
    // 🔴 결과만 적는다 — 예약은 지우지 않는다. 적지 못해도(급사·장부 실패) RESERVED 가 남아 다시 부르지 않는다
    settleBriefRepair({ slug: t.slug, fingerprint: repairFingerprint, outcome, providerCalls: calls, path: quarantinePath })
  }
}

async function repairDraftEcho({ t, base, draftsDir, deps, seen, tmpDir }) {
  const g = deps.repairGate({ slug: t.slug })
  const out = { ...base, repairFingerprint: g?.gate?.messageFingerprint ?? null }
  if (!g?.gate?.ok) return { ...out, outcome: 'FAILED', reason: `수리 관문을 판정하지 못했다 — ${g?.gate?.why ?? '사유 없음'} (전송 0)` }
  // 🔴 이미 보냈거나 보냈는지 모르면 runner 를 띄우지 않는다 — 재전송 0
  if (g.gate.hold) return { ...out, outcome: 'HELD', reason: `${g.gate.hold.why} (runner 0 · 전송 0)` }
  const key = `${t.slug}:${out.repairFingerprint}`
  if (seen.has(key)) return { ...out, outcome: 'SKIPPED_DUPLICATE', reason: '같은 수리 지문을 이 회차에 이미 시도했다' }
  seen.add(key)
  const candidate = join(tmpDir, `input-repair-${t.slug}-${process.pid}-${randomUUID().slice(0, 8)}.md`)
  try {
    const row = await deps.runRepairFetch({ slug: t.slug, draftOut: candidate })
    out.sent = row?.sent ?? null
    out.conversationUrl = row?.conversationUrl ?? null
    if (!row) return { ...out, sent: null, outcome: 'DELIVERY_UNCERTAIN', reason: '회수 결과를 읽지 못했다 — 보냈는지 모른다 · 다시 보내지 않는다' }
    if (row.status === 'held') return { ...out, outcome: 'HELD', reason: row.errorDetail ?? 'HOLD' }
    if (row.status !== 'ok') {
      // 🔴 보냈는지 모르거나, 보냈는데 응답을 확인하지 못했으면 전송불명이다 — 다시 보내지 않는다
      const settled = row.sent === true && (row.reason === 'invalid_manuscript' || row.reason === 'markers_missing')
      const uncertain = row.sent !== false && !settled
      return { ...out, outcome: uncertain ? 'DELIVERY_UNCERTAIN' : 'FAILED',
        reason: `${row.reason ?? '회수 실패'}${row.errorDetail ? ` — ${row.errorDetail}` : ''}`, invalid: row.invalid ?? null }
    }
    if (!existsSync(candidate)) return { ...out, outcome: 'FAILED', reason: '회수는 ok 인데 임시 원고가 없다 — 원본 그대로' }
    const text = readFileSync(candidate, 'utf8')
    // 🔴 원고 관문(brief echo·형식 포함) · 변환기 판정 · 실제 변환 검사를 **모두** 통과해야 교체한다
    const v = validateManuscript(text)
    const f = judgeManuscriptFormat(text)
    const c = deps.convertCheck(candidate)
    if (!v.ok || !f.ok || !c?.ok) {
      return { ...out, outcome: 'REJECTED', reason: '수리 응답이 원고 계약을 통과하지 못했다 — 원본 draft 그대로',
        candidateViolations: [...v.reasons.map((r) => `${r.code}: ${r.why}`), ...(c?.ok ? [] : [`CONVERT: ${c?.why ?? '변환 실패'}`])] }
    }
    commitFiles({ draftsDir, slug: t.slug, kind: 'DRAFT', files: { draft: text }, phaseHook: deps.phaseHook })
    return { ...out, outcome: 'APPLIED', candidateApplied: true, reason: 'draft.md 원자 교체 — QA·hero·등록은 01:00 auto-register 가 기존 경로로' }
  } finally {
    rmSync(candidate, { force: true })
  }
}

/** 결과 파일 — 시도별로 따로 남긴다 (`wx`) */
export function writeInputRepairResult({ dir, report, nowMs = Date.now() }) {
  mkdirSync(dir, { recursive: true })
  const hms = new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(11, 19).replace(/:/g, '')
  const file = join(dir, `input-repair-${hms}-${process.pid}-${randomUUID().slice(0, 8)}.json`)
  writeFileSync(file, `${JSON.stringify({ ...report, writtenAt: new Date(nowMs).toISOString() }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return file
}
