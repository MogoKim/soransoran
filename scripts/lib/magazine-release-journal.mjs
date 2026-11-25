/**
 * vNext release writer 의 **journal + CAS** 쓰기 (runbook §0.0B.4 — queue 에 의존하지 않는 journal + CAS 트랜잭션).
 *
 * 무엇을 지키나
 *   · articles.ts 는 조립 때 읽은 바이트(beforeSha256)일 때만 바꾼다 — 바로 바꾸기 직전에 다시 읽어 대조한다(CAS).
 *     다르면 아무것도 남기지 않고 ARTICLES_CAS_MISMATCH — 호출자가 release 를 처음부터 다시 조립한다.
 *   · 어느 단계에서 죽어도 다음 실행이 같은 release 를 이어 간다 — journal 이 경로마다 before · after 해시를 갖고,
 *     지금 바이트가 after 면 건너뛰고 before 면 다시 쓰고, 둘 다 아니면 FILE_CONFLICT 로 멈춘다(남의 변경을 덮지 않는다).
 *   · 쓰기는 temp(O_EXCL) → fsync → rename → 폴더 fsync. temp 이름은 release 마다 고유하고, 같은 release 의 앞 실행이 남긴
 *     temp 만 지운다(다른 이름은 건드리지 않는다).
 *   · 단계 기록(APPLIED → COMMITTED → PUSHED → PR_OPEN → MERGED · CLOSED · ABANDONED)도 같은 journal 에 원자 기록한다.
 *     상태는 사실에서 다시 확인한다 — journal 만 믿고 넘어가지 않는다(파일 해시 · commit tree · 원격 SHA · PR 조회).
 *
 * 🔴 운영 경로는 `releaseStateRoot()` 하나 — HOME 아래 Application Support. 검사는 반드시 stateRoot 를 주입한다.
 * 🔴 hero 바이트는 Job 이 기록한 해시와 같아야 쓴다(HERO_BYTES_MISMATCH).
 * 🔴 journal 은 **재개 결속의 정본**이다 — 글마다 검증된 원고 해시 · hero 해시 · ProviderPlan 해시, 경로마다 쓴 바이트의 해시, 원본 commit 을 남긴다.
 *    다음 회차(01:00 · 02:00 복구)는 열린 PR 의 head 를 이 기록과 대조한 뒤에만 merge 한다(`judgeResumeBinding`). 날짜가 바뀌어도 같은 journal 을 이어 간다.
 * 🔴 MERGED 는 "main 에 들어갔다" 까지다. 그 SHA 가 운영 도메인에서 서빙되는지는 `serving` 사실로 따로 적는다(`noteJournal`) — 상태 전이가 아니다.
 */
import { recoverMagazineLock } from './magazine-lock-recovery.mjs'
import * as nodeFs from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const JOURNAL_SCHEMA = 'magazine-release-journal/1'
export const SLUG_RECORD_SCHEMA = 'magazine-release-slug/1'
export const JOURNAL_STATES = Object.freeze(['PREPARED', 'APPLIED', 'COMMITTED', 'PUSHED', 'PR_OPEN', 'MERGED', 'CLOSED', 'ABANDONED', 'ABORTED'])
const TERMINAL = new Set(['MERGED', 'CLOSED', 'ABANDONED', 'ABORTED'])
export const isTerminalJournal = (j) => TERMINAL.has(j?.state)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const INTENT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/
export const RELEASE_ID_RE = /^[0-9]{8}-[0-9a-f]{10}$/

export class ReleaseWriteError extends Error {
  constructor(code, why) { super(`${code}: ${why}`); this.code = code; this.why = why }
}
const fail = (code, why) => { throw new ReleaseWriteError(code, why) }

/** 운영 상태 루트 — HOME 기준(검사는 주입한다) */
export const releaseStateRoot = ({ home = homedir() } = {}) => join(home, 'Library', 'Application Support', 'soransoran', 'magazine-release')
export const releaseDirOf = (stateRoot, releaseId) => {
  if (!RELEASE_ID_RE.test(String(releaseId))) fail('RELEASE_ID_INVALID', `releaseId ${releaseId}`)
  return join(stateRoot, 'releases', releaseId)
}
export const journalPathOf = (stateRoot, releaseId) => join(releaseDirOf(stateRoot, releaseId), 'journal.json')
export const worktreePathOf = (stateRoot, releaseId) => join(releaseDirOf(stateRoot, releaseId), 'worktree')

/** 원자 쓰기 — temp(O_EXCL) → fsync → rename → 폴더 fsync */
export function writeFileAtomic(path, data, { fs = nodeFs, tag, mode = 0o644 } = {}) {
  fs.mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.release-tmp-${tag}`
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true }) // 같은 release 의 앞 실행이 남긴 temp 만(이름이 release 로 고유하다)
  const fd = fs.openSync(tmp, 'wx', mode)
  try {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')
    let off = 0
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  try { fs.renameSync(tmp, path) } catch (e) { try { fs.rmSync(tmp, { force: true }) } catch { /* 정리 실패 — 이름이 고유하다 */ } throw e }
  try { const d = fs.openSync(dirname(path), 'r'); try { fs.fsyncSync(d) } finally { fs.closeSync(d) } } catch { /* 폴더 fsync 미지원 — rename 은 원자적이다 */ }
}

const fileSha = (fs, path) => { try { return sha256(fs.readFileSync(path)) } catch (e) { if (e?.code === 'ENOENT') return null; throw e } }

/** journal 판독 — 없으면 null · 깨졌으면 { broken: true } */
export function readJournal(path, { fs = nodeFs } = {}) {
  let text
  try { text = fs.readFileSync(path, 'utf8') } catch (e) { if (e?.code === 'ENOENT') return null; return { broken: true, why: e?.code ?? 'READ_FAILED' } }
  try {
    const j = JSON.parse(text)
    if (j?.schemaVersion !== JOURNAL_SCHEMA || !JOURNAL_STATES.includes(j.state) || !RELEASE_ID_RE.test(j.releaseId) || !Array.isArray(j.entries)) return { broken: true, why: 'SCHEMA' }
    return j
  } catch { return { broken: true, why: 'JSON' } }
}

/** 상태 루트의 journal 전부 — releaseId 순. 깨진 것은 `{ broken: true }` 로 그대로 돌려준다(지우지 않는다) */
export function listReleaseJournals(stateRoot, { fs = nodeFs } = {}) {
  let ids = []
  try { ids = fs.readdirSync(join(stateRoot, 'releases')) } catch (e) { if (e?.code === 'ENOENT') return []; throw e }
  const out = []
  for (const id of ids.filter((x) => RELEASE_ID_RE.test(x)).sort()) {
    const path = journalPathOf(stateRoot, id)
    const journal = readJournal(path, { fs })
    if (journal) out.push({ releaseId: id, path, journal })
  }
  return out
}

/** 상태를 바꾸지 않고 사실만 덧붙인다(서빙 관측 · main 확인) — history 에 줄을 더하지 않는다 */
export function noteJournal(path, journal, facts, { fs = nodeFs } = {}) {
  const next = { ...journal, ...facts }
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, { fs, tag: journal.releaseId, mode: 0o600 })
  return next
}

/** journal 상태 전이 — 사실 기록을 덧붙인다(앞 기록을 지우지 않는다) */
export function advanceJournal(path, journal, state, facts = {}, { fs = nodeFs, nowIso } = {}) {
  if (!JOURNAL_STATES.includes(state)) fail('JOURNAL_STATE_INVALID', state)
  const next = { ...journal, ...facts, state, history: [...(journal.history ?? []), { state, at: nowIso }] }
  writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, { fs, tag: journal.releaseId, mode: 0o600 })
  return next
}

/**
 * release 파일 적용 — plan 파일 · hero 를 먼저, articles.ts 를 마지막에(CAS 재확인 직후) 쓴다.
 * @param {{ worktree: string, journalPath: string, release: object, heroBytesOf: (member: object) => Buffer, nowIso: string, fs?: object,
 *           beforeArticlesRename?: () => void }} p   beforeArticlesRename — 검사용(CAS 경쟁 주입)
 * @returns {{ journal: object, resumed: boolean }}
 */
export function applyReleaseFiles({ worktree, journalPath, release, heroBytesOf, nowIso, fs = nodeFs, beforeArticlesRename = null }) {
  if (!release?.ok) fail('RELEASE_NOT_ASSEMBLED', '조립되지 않은 release 는 쓰지 않는다')
  const articlesAbs = join(worktree, release.articles.path)
  // 쓸 바이트 — hero 는 Job 이 기록한 해시와 같은 바이트만
  const plan = release.files.map((f) => {
    if (typeof f.text === 'string') return { path: f.path, data: Buffer.from(f.text, 'utf8') }
    const member = release.members.find((m) => m.planHash === f.planHash)
    const bytes = heroBytesOf(member)
    if (!Buffer.isBuffer(bytes) || sha256(bytes) !== f.heroSha256) fail('HERO_BYTES_MISMATCH', `${f.path} 의 바이트가 Job 이 기록한 해시와 다르다`)
    return { path: f.path, data: bytes }
  })
  const entries = [
    ...plan.map((p) => ({ path: p.path, afterSha256: sha256(p.data) })),
    { path: release.articles.path, beforeSha256: release.articles.beforeSha256, afterSha256: release.articles.afterSha256 },
  ]

  let journal = readJournal(journalPath, { fs })
  if (journal?.broken) fail('JOURNAL_BROKEN', `${journalPath} 를 읽지 못했다 (${journal.why}) — 자동으로 지우지 않는다`)
  if (journal && journal.releaseId !== release.releaseId) fail('JOURNAL_FOREIGN', `journal 이 다른 release(${journal.releaseId})다`)
  if (journal && isTerminalJournal(journal)) fail('JOURNAL_TERMINAL', `release ${release.releaseId} 는 이미 ${journal.state} 다 — 같은 release 를 다시 쓰지 않는다`)
  const resumed = Boolean(journal)
  if (journal && journal.state !== 'PREPARED') {
    // 이미 적용 이후 단계 — 파일이 after 인지 사실로 다시 확인만 한다
    const drift = entries.filter((e) => fileSha(fs, join(worktree, e.path)) !== e.afterSha256)
    if (drift.length) fail('FILE_CONFLICT', `journal 은 ${journal.state} 인데 파일이 다르다: ${drift.map((e) => e.path).join(', ')}`)
    return { journal, resumed }
  }

  // CAS(조립 기준) — articles.ts 는 before 이거나(새로) after 여야 한다(이어 쓰기)
  const cur = fileSha(fs, articlesAbs)
  if (cur !== release.articles.beforeSha256 && cur !== release.articles.afterSha256) fail('ARTICLES_CAS_MISMATCH', 'articles.ts 가 조립 때 읽은 바이트가 아니다 — release 를 다시 조립한다')
  for (const e of entries.slice(0, -1)) {
    const now = fileSha(fs, join(worktree, e.path))
    if (now !== null && now !== e.afterSha256) fail('FILE_CONFLICT', `${e.path} 가 이미 다른 바이트로 있다 — 덮지 않는다`)
  }
  if (!journal) {
    journal = { schemaVersion: JOURNAL_SCHEMA, releaseId: release.releaseId, branch: release.branch, baseSha: release.baseSha ?? null,
      graphVersion: release.graphVersion ?? null,
      // 🔴 재개 결속 — 그 글의 검증된 원고 · hero · ProviderPlan 해시. 다음 회차가 Job 저장소 · PR head 와 대조한다
      members: release.members.map((m) => ({ planId: m.planId, planHash: m.planHash, intentId: m.intentId, slug: m.slug, publishAt: m.publishAt, layer: m.layer ?? null,
        providerPlanHash: m.providerPlanHash ?? null, heroSha256: m.heroSha256 ?? null, manuscriptSha256: m.manuscriptSha256 ?? null })),
      entries, state: 'PREPARED', history: [{ state: 'PREPARED', at: nowIso }] }
    writeFileAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`, { fs, tag: release.releaseId, mode: 0o600 })
  }

  const created = []
  for (const p of plan) {
    const abs = join(worktree, p.path)
    if (fileSha(fs, abs) === sha256(p.data)) continue
    writeFileAtomic(abs, p.data, { fs, tag: release.releaseId })
    created.push(abs)
  }
  // 🔴 CAS 재확인 — 바꾸기 바로 앞에서 다시 읽는다. 다르면 이번 실행이 만든 파일을 되돌리고 멈춘다(잔존물 0)
  beforeArticlesRename?.()
  const again = fileSha(fs, articlesAbs)
  if (again !== release.articles.beforeSha256 && again !== release.articles.afterSha256) {
    for (const abs of created) { try { fs.rmSync(abs, { force: true }) } catch { /* 아래 ABORTED 기록으로 남는다 */ } }
    advanceJournal(journalPath, journal, 'ABORTED', { abortedBy: 'ARTICLES_CAS_MISMATCH' }, { fs, nowIso })
    fail('ARTICLES_CAS_MISMATCH', 'articles.ts 가 쓰기 직전에 바뀌었다 — 만든 파일을 되돌렸다 · release 를 다시 조립한다')
  }
  if (again !== release.articles.afterSha256) writeFileAtomic(articlesAbs, release.articles.afterText, { fs, tag: release.releaseId })
  const drift = entries.filter((e) => fileSha(fs, join(worktree, e.path)) !== e.afterSha256)
  if (drift.length) fail('FILE_CONFLICT', `쓴 뒤 해시가 다르다: ${drift.map((e) => e.path).join(', ')}`)
  journal = advanceJournal(journalPath, journal, 'APPLIED', {}, { fs, nowIso })
  return { journal, resumed }
}

// ── release writer 잠금 — writer 는 하나다 ───────────────────

/**
 * `<stateRoot>/release.lock` 을 O_EXCL 로 쥔다. 살아 있는 pid 의 잠금이면 RELEASE_LOCK_HELD — 기다리지도 지우지도 않는다.
 * 죽은 pid 의 잠금만 회수한다(rename 으로 한 프로세스만 회수에 성공한다).
 * @returns {{ ok: true, release: () => void } | { ok: false, code: string, why: string }}
 */
export function acquireReleaseLock({ stateRoot, fs = nodeFs, pid = process.pid, pidAlive = defaultPidAlive, nowIso }) {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  const path = join(stateRoot, 'release.lock')
  const token = `${pid}-${createHash('sha256').update(`${pid}:${nowIso}:${Math.random()}`).digest('hex').slice(0, 12)}`
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(path, 'wx', 0o600)
      try { fs.writeSync(fd, `${JSON.stringify({ pid, token, at: nowIso })}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      return { ok: true, release: () => { try { if (fs.readFileSync(path, 'utf8').includes(token)) fs.rmSync(path, { force: true }) } catch { /* 이미 없다 */ } } }
    } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false, code: 'RELEASE_LOCK_FAILED', why: e?.code ?? 'OPEN_FAILED' }
      let holder = null
      try { holder = JSON.parse(fs.readFileSync(path, 'utf8')) } catch { holder = null }
      if (!holder || !Number.isSafeInteger(holder.pid)) return { ok: false, code: 'RELEASE_LOCK_CORRUPT', why: `${path} 를 읽지 못했다 — 자동으로 지우지 않는다` }
      if (pidAlive(holder.pid)) return { ok: false, code: 'RELEASE_LOCK_HELD', why: `release writer(pid ${holder.pid})가 이미 돈다` }
      try {
        if (recoverMagazineLock({ fs, path, observed: holder, pidAlive })) continue
      } catch (e) {
        if (e.code !== 'ENOENT') return { ok: false, code: 'RELEASE_LOCK_FAILED', why: e.code ?? 'RECOVERY_FAILED' }
      }
      return { ok: false, code: 'RELEASE_LOCK_HELD', why: '다른 회차가 잠금을 회수 중이다' }
    }
  }
  return { ok: false, code: 'RELEASE_LOCK_HELD', why: '잠금을 얻지 못했다' }
}
const defaultPidAlive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e?.code === 'EPERM' } }

// ── stable slug 기록 ────────────────────────────────────────

const slugPathOf = (stateRoot, intentId) => {
  if (!INTENT_FILE_RE.test(String(intentId))) fail('INTENT_ID_INVALID', `intentId ${intentId}`)
  return join(stateRoot, 'slugs', `${intentId}.json`)
}

/** 묶인 slug 전부 — intentId → { intentId, slug }. 깨진 기록이 하나라도 있으면 멈춘다(어느 slug 가 정본인지 고르지 않는다) */
export function readSlugRecords(stateRoot, { fs = nodeFs } = {}) {
  const dir = join(stateRoot, 'slugs')
  let names = []
  try { names = fs.readdirSync(dir) } catch (e) { if (e?.code === 'ENOENT') return {}; fail('SLUG_RECORDS_UNREADABLE', e?.code ?? 'READ_FAILED') }
  const out = {}
  for (const n of names.filter((x) => x.endsWith('.json')).sort()) {
    let r
    try { r = JSON.parse(fs.readFileSync(join(dir, n), 'utf8')) } catch { fail('SLUG_RECORD_BROKEN', n) }
    if (r?.schemaVersion !== SLUG_RECORD_SCHEMA || `${r.intentId}.json` !== n || typeof r.slug !== 'string') fail('SLUG_RECORD_BROKEN', n)
    out[r.intentId] = { intentId: r.intentId, slug: r.slug }
  }
  return out
}

/**
 * slug 를 한 번만 묶는다 — O_EXCL 로 만들고, 이미 있으면 같은 slug 일 때만 통과(SLUG_RECORD_CONFLICT 는 바꾸지 않고 멈춘다).
 * @returns {{ created: boolean }}
 */
export function recordSlug({ stateRoot, intentId, slug, planHash, nowIso, fs = nodeFs }) {
  const path = slugPathOf(stateRoot, intentId)
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const text = `${JSON.stringify({ schemaVersion: SLUG_RECORD_SCHEMA, intentId, slug, planHash, boundAt: nowIso }, null, 2)}\n`
  // 🔴 완전한 파일만 이름을 얻는다 — temp 에 쓰고 fsync 한 뒤 link(no-clobber). 중간에 죽어도 빈 기록이 생기지 않는다
  const tmp = `${path}.tmp-${process.pid}`
  fs.rmSync(tmp, { force: true })
  const fd = fs.openSync(tmp, 'wx', 0o600)
  try { fs.writeSync(fd, text); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try { fs.linkSync(tmp, path) } catch (e) {
    fs.rmSync(tmp, { force: true })
    if (e?.code !== 'EEXIST') throw e
    const cur = readSlugRecords(stateRoot, { fs })[intentId]
    if (cur?.slug === slug) return { created: false }
    fail('SLUG_RECORD_CONFLICT', `${intentId} 는 이미 ${cur?.slug} 로 묶였다 — 바꾸지 않는다`)
  }
  fs.rmSync(tmp, { force: true })
  return { created: true }
}
