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
 *    - 한 회차 최대 3건 · 큐 순서(day → slug)로 결정적 · 각 후보는 한 번만 본다(무한 반복 0)
 *    - 전송불명(DELIVERY_UNCERTAIN) 기록이 있는 slug 는 **어떤 수리도 하지 않는다** — brief 를 고치면
 *      메시지 지문이 바뀌어 HOLD 가 풀리고 같은 글이 다시 나간다 (HOLD 6건 runner 0 · 전송 0)
 *    - 후보는 임시 경로에서만 만들고, **모든 검증을 통과한 뒤에만** 원본을 journal 아래 교체한다
 *    - 한 후보의 실패·예외는 다른 후보를 막지 않는다
 *    - 입력 수리는 CONTENT attempts · QA regenCalls 를 쓰지 않는다 (전송은 inputRepairCalls 로 따로 센다)
 *    - 큐·장부·articles.ts 를 직접 고치지 않는다 · hero·등록·PR·병합 0
 *
 * 🔴 판정은 전부 기존 정본을 부른다 — `verifyBrief`(G1~G7·GF) · `judgeBriefFormatContract` ·
 *    `briefEchoHeadings` · `validateManuscript` · `judgeManuscriptFormat` · md-to-draft 변환.
 */
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { judgeBriefFormatContract, judgeManuscriptFormat } from './magazine-manuscript-format.mjs'
import { briefEchoHeadings, validateManuscript } from './magazine-manuscript-guard.mjs'
import { verifyBrief } from './magazine-brief-policy.mjs'
import { isAutoLaneEligible } from './magazine-validation-profile.mjs'

export const MAX_REPAIRS_PER_RUN = 3
export const REPAIR = { BRIEF: 'BRIEF_FORMAT_CONTRACT', DRAFT_ECHO: 'DRAFT_INVALID_BRIEF_ECHO' }
export const JOURNAL_FILE = '.input-repair-journal.json'
const JOURNAL_VERSION = 'input-repair-journal/1'

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

/** brief 수리 지문 — 같은 회차에 같은 수리를 두 번 호출하지 않는다 */
export function briefRepairFingerprint({ slug, briefText, item }) {
  return `sha256:${sha(JSON.stringify({ kind: REPAIR.BRIEF, slug, brief: sha(briefText), item }))}`
}

// ─────────────────────────────────────────────────────────
// 원자 교체 — 🔴 journal 이 먼저다. 급사하면 다음 실행이 원본으로 되돌린다
// ─────────────────────────────────────────────────────────

/**
 * 여러 파일을 한 쌍으로 교체한다. 순서: journal → 원본 사본 → staged 쓰기 → (prepared) → rename… → committed → 정리.
 * `phaseHook(phase)` 는 시험이 급사 지점을 고르는 자리다.
 */
export function commitFiles({ dir, files, phaseHook = () => {} }) {
  const journalPath = join(dir, JOURNAL_FILE)
  if (existsSync(journalPath)) throw new Error(`이미 진행 중인 교체 journal 이 있다: ${journalPath}`)
  const id = randomUUID().slice(0, 8)
  const tx = {
    version: JOURNAL_VERSION, phase: 'initializing',
    files: files.map((f) => ({ path: f.path, existed: existsSync(f.path), backup: `${f.path}.input-repair-backup-${id}`, staged: `${f.path}.input-repair-staged-${id}` })),
  }
  const save = () => writeFileSync(journalPath, `${JSON.stringify(tx, null, 2)}\n`, 'utf8')
  save()
  phaseHook(tx.phase)
  for (const f of tx.files) if (f.existed) copyFileSync(f.path, f.backup)
  files.forEach((f, i) => writeFileSync(tx.files[i].staged, f.text, { encoding: 'utf8', flag: 'wx' }))
  tx.phase = 'prepared'; save(); phaseHook(tx.phase)
  tx.files.forEach((f, i) => {
    renameSync(f.staged, f.path)
    tx.phase = `committing-${i + 1}`; save(); phaseHook(tx.phase)
  })
  tx.phase = 'committed'; save(); phaseHook(tx.phase)
  for (const f of tx.files) rmSync(f.backup, { force: true })
  rmSync(journalPath, { force: true })
  return { ok: true }
}

/** 남은 journal 을 처리한다 — committed 전이면 원본으로 되돌리고, committed 면 정리만 한다 */
export function recoverJournal(dir) {
  const journalPath = join(dir, JOURNAL_FILE)
  if (!existsSync(journalPath)) return { recovered: false }
  let tx
  try { tx = JSON.parse(readFileSync(journalPath, 'utf8')) } catch (e) {
    return { recovered: false, error: `journal 을 읽지 못했다 — 사람이 확인한다: ${e.message}` }
  }
  if (tx?.version !== JOURNAL_VERSION || !Array.isArray(tx.files)) return { recovered: false, error: 'journal 모양이 다르다 — 사람이 확인한다' }
  if (tx.phase !== 'committed' && tx.phase !== 'initializing') {
    for (const f of tx.files) {
      if (f.existed) {
        if (!existsSync(f.backup)) return { recovered: false, error: `원복 사본이 없다: ${f.backup}` }
        copyFileSync(f.backup, f.path)
      } else rmSync(f.path, { force: true })
    }
  }
  for (const f of tx.files) { rmSync(f.backup, { force: true }); rmSync(f.staged, { force: true }) }
  rmSync(journalPath, { force: true })
  return { recovered: true, phase: tx.phase }
}

/** 원고 폴더 전체에서 남은 journal 을 처리한다 */
export function recoverAllJournals(draftsDir) {
  const out = []
  if (!existsSync(draftsDir)) return out
  for (const slug of readdirSync(draftsDir)) {
    const dir = join(draftsDir, slug)
    if (existsSync(join(dir, JOURNAL_FILE))) out.push({ slug, ...recoverJournal(dir) })
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
export async function runInputRepair({ draftsDir, queue, ledger, deps, max = MAX_REPAIRS_PER_RUN, tmpDir }) {
  const log = deps.log ?? (() => {})
  const recovered = recoverAllJournals(draftsDir)
  for (const r of recovered) log(`  ↺ ${r.slug} — 급사한 교체 journal 처리 (${r.recovered ? `원복 · ${r.phase}` : r.error})`)
  if (!ledger?.ok) {
    return { ok: false, code: 'QUARANTINE_UNREADABLE', why: ledger?.why ?? '장부를 읽지 못했다', results: [], skipped: [], recovered }
  }
  const { targets, skipped } = scanRepairTargets({ queue, draftsDir, store: ledger.store })
  const chosen = targets.slice(0, max)
  const deferred = targets.slice(max).map((t) => ({ slug: t.slug, type: t.type, reason: 'RUN_LIMIT' }))
  const seen = new Set()
  const results = []
  mkdirSync(tmpDir, { recursive: true })
  for (const t of chosen) {
    const base = { slug: t.slug, type: t.type, violations: t.violations, sent: false, candidateApplied: false, conversationUrl: null }
    try {
      results.push(t.type === REPAIR.BRIEF
        ? await repairBrief({ t, base, draftsDir, deps, seen })
        : await repairDraftEcho({ t, base, draftsDir, deps, seen, tmpDir }))
    } catch (e) {
      // 🔴 한 후보의 예외는 다른 후보를 막지 않는다 — 원본은 교체 전이거나 journal 이 지킨다
      results.push({ ...base, outcome: 'FAILED', reason: `예외: ${e?.message ?? e}` })
    }
  }
  return { ok: true, results, skipped: [...skipped, ...deferred], recovered, limit: max }
}

async function repairBrief({ t, base, draftsDir, deps, seen }) {
  const dir = join(draftsDir, t.slug)
  const briefPath = join(dir, 'brief.md')
  const reviewPath = join(dir, 'review.ts')
  const repairFingerprint = briefRepairFingerprint({ slug: t.slug, briefText: readFileSync(briefPath, 'utf8'), item: t.item })
  const out = { ...base, repairFingerprint }
  // 🔴 slug 와 묶어 센다 — 장부의 수리 지문 기록도 slug 행마다다 (brief 가 같은 두 글을 서로 막지 않는다)
  const key = `${t.slug}:${repairFingerprint}`
  if (seen.has(key)) return { ...out, outcome: 'SKIPPED_DUPLICATE', reason: '같은 수리 지문을 이 회차에 이미 시도했다' }
  seen.add(key)
  const cand = await deps.generateBrief({ slug: t.slug, item: t.item })
  out.calls = cand?.calls ?? null
  if (!cand?.ok) return { ...out, outcome: 'FAILED', reason: `brief 후보 생성 실패 — ${cand?.why ?? '사유 없음'}` }
  // 🔴 후보를 **여기서 다시** 판정한다 — 생성기의 말을 믿지 않는다 (G1~G7 · GF · 형식 계약)
  const contract = judgeBriefFormatContract(cand.briefText)
  const verdict = verifyBrief({ briefText: cand.briefText, review: deps.parseReview(cand.reviewText), queueItem: t.item })
  if (!contract.ok || !verdict.ok) {
    return { ...out, outcome: 'REJECTED', reason: 'brief 후보가 계약을 통과하지 못했다 — 원본 두 파일 그대로',
      candidateViolations: [...contract.violations.map((v) => `${v.code}: ${v.why}`), ...verdict.results.filter((r) => !r.ok).map((r) => `${r.gate}: ${r.detail}`)] }
  }
  commitFiles({ dir, files: [
    { path: briefPath, text: cand.briefText.endsWith('\n') ? cand.briefText : `${cand.briefText}\n` },
    { path: reviewPath, text: cand.reviewText.endsWith('\n') ? cand.reviewText : `${cand.reviewText}\n` },
  ], phaseHook: deps.phaseHook })
  return { ...out, outcome: 'APPLIED', candidateApplied: true, reason: 'brief·review 한 쌍 교체' }
}

async function repairDraftEcho({ t, base, draftsDir, deps, seen, tmpDir }) {
  const dir = join(draftsDir, t.slug)
  const draftPath = join(dir, 'draft.md')
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
    commitFiles({ dir, files: [{ path: draftPath, text }], phaseHook: deps.phaseHook })
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
