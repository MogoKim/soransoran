/**
 * 🔴 **재생성 계보 대조 — provider 를 다시 부르지 않고 장부를 사실에 맞춘다** (2026-10-11 Codex 재검토 1·3).
 *
 *    ① 입력 수리 pending 영수증 (신규)
 *       입력 수리는 draft 를 원자 교체한 **뒤** 장부에 INPUT_REPAIR 계보를 적는다. 그 사이에 죽거나 장부 쓰기가
 *       실패하면 "원고는 바뀌었는데 계보는 없는" 상태가 된다. 그래서 교체 **전에** slug 폴더에 영수증
 *       (`.regen-lineage-pending.json` · 교체 전/후 sha)을 fsync 로 남기고, 장부 기록이 끝난 뒤에만 지운다.
 *       다음 회차(producer 입력 수리 · 01:00 auto-register)는 영수증을 보고:
 *         지금 draft = 교체 후 sha → 계보를 연다(같은 증거면 그대로) → 영수증 삭제
 *         지금 draft = 교체 전 sha → 교체가 일어나지 않았다(journal 원복) → 영수증만 삭제 · 계보 0
 *         그 밖 · journal 이 남음 · 영수증 손상 → 아무것도 바꾸지 않는다 (fail-closed · 예산은 옛 계보 그대로)
 *
 *    ② 옛 입력 수리 영수증 대조 (cold-weather-joint-pain · autumn-low-mood — 2026-10-11 운영 후 상태)
 *       10/11 입력 수리는 draft 를 APPLIED 로 교체했지만 계보 코드가 없던 판이라 장부에 계보가 없다.
 *       결과 파일(`_runs/<날짜>/input-repair-*.json`)의 APPLIED 행과 장부의 수리 지문 · 지금 draft 검증을
 *       **모두** 대조해 맞을 때만 INPUT_REPAIR 계보를 **한 번** 연다. 하나라도 애매하면 열지 않는다.
 *
 *    ③ 옛 최초 invalid 응답 대조 (gray-hair-leave-as-is — 2026-10-11 운영 후 상태 · `LEGACY_INVALID_MIGRATIONS` 한 사건만)
 *       10/11 01:00 일반 요청은 응답을 특정해(대화·메시지) 원고 관문에서 탈락했고, runner 는 그 신원이 있을 때만
 *       예약을 풀었다(`settlesDeliveryReservation`). 그러나 옛 판은 신원·위반을 장부에 적지 않았다 — 같은 일반 요청을
 *       다시 보내면 중복 전송이다. 장부의 사유 문장(`[validate] invalid_manuscript — 코드: 이유 · 전송 1건`) ·
 *       sent=true · 예약 없음 · 원고 없음이 **모두** 맞을 때만, 위반 `{code, why}` 를 정제해 지금 일반 요청 지문에
 *       묶은 기록(`legacyLedgerKey`)을 **한 번** 남긴다. 다음 단계는 그 기록으로 교정 재생성을 한다 (일반 재전송 0).
 *
 * 🔴 모든 장부 변경은 `updateQuarantine` 잠금 안에서 **조건을 다시 확인한 뒤** 한다 (CAS). 시험·운영 공통 경로다.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { writeAtomic } from './magazine-g8-promoter.mjs'
import { judgeManuscriptFormat } from './magazine-manuscript-format.mjs'
import { briefEchoHeadings, validateManuscript } from './magazine-manuscript-guard.mjs'
import {
  MAX_REGEN_TOTAL, QUARANTINE_PATH, firstResponseInvalidRecord, lineageKeyOf, openLineageIn, readQuarantine,
  sanitizeViolations, updateQuarantine,
} from './magazine-quarantine.mjs'

export const PENDING_FILE = '.regen-lineage-pending.json'
export const PENDING_SCHEMA = 'regen-lineage-pending/1'
const JOURNAL_FILE = '.input-repair-journal.json'
const HEX64 = /^[0-9a-f]{64}$/
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const sha = (t) => createHash('sha256').update(String(t)).digest('hex')
const shaOfFile = (p) => (existsSync(p) ? sha(readFileSync(p, 'utf8')) : 'absent')
const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10)
function lstatOrNull(p) {
  try { return lstatSync(p) } catch (e) { if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return null; throw e }
}

// ─────────────────────────────────────────────────────────
// ① pending 영수증
// ─────────────────────────────────────────────────────────

/** 교체 **전에** 남기는 영수증 — fsync 원자 쓰기. 같은 이름이 있으면 던진다 (앞 영수증을 덮지 않는다) */
export function writeLineagePending({ draftsDir, slug, beforeSha, afterSha, repairFingerprint, now = Date.now() }) {
  if (!SLUG.test(String(slug))) throw new Error(`slug 모양이 아니다: ${slug}`)
  if (!HEX64.test(afterSha) || !(beforeSha === 'absent' || HEX64.test(beforeSha))) throw new Error('영수증 sha 모양이 아니다')
  const file = join(draftsDir, slug, PENDING_FILE)
  if (lstatOrNull(file)) throw new Error(`이미 완성되지 않은 계보 영수증이 있다: ${file}`)
  writeAtomic(file, `${JSON.stringify({ schema: PENDING_SCHEMA, slug, origin: 'INPUT_REPAIR', beforeSha, afterSha, repairFingerprint: repairFingerprint ?? null, createdAt: now }, null, 2)}\n`)
  return file
}

/**
 * 한 slug 의 영수증을 완성한다.
 * @returns {{ok:boolean, status:'NONE'|'OPENED'|'SAME_EVIDENCE'|'DISCARDED'|'JOURNAL_PRESENT'|'PENDING_INVALID'|'CONFLICT'|'LEDGER_FAILED', why?:string}}
 */
export function completePendingLineage({ draftsDir, slug, path = QUARANTINE_PATH, now = Date.now() }) {
  const dir = join(draftsDir, slug)
  const file = join(dir, PENDING_FILE)
  const st = lstatOrNull(file)
  if (!st) return { ok: true, status: 'NONE' }
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, status: 'PENDING_INVALID', why: '영수증이 일반 파일이 아니다' }
  // 🔴 교체 journal 이 남아 있으면 그 복구가 먼저다 — 영수증을 판정하지 않는다
  if (lstatOrNull(join(dir, JOURNAL_FILE))) return { ok: false, status: 'JOURNAL_PRESENT', why: '교체 journal 이 남아 있다 — 복구 뒤에 본다' }
  let j
  try { j = JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return { ok: false, status: 'PENDING_INVALID', why: `영수증을 읽지 못했다: ${e?.message ?? e}` } }
  if (j?.schema !== PENDING_SCHEMA || j.slug !== slug || j.origin !== 'INPUT_REPAIR' || !HEX64.test(j.afterSha ?? '')
    || !(j.beforeSha === 'absent' || HEX64.test(j.beforeSha ?? ''))) {
    return { ok: false, status: 'PENDING_INVALID', why: '영수증 모양·신원이 맞지 않다 — 그대로 둔다' }
  }
  const cur = shaOfFile(join(dir, 'draft.md'))
  if (cur === j.beforeSha) {
    // 교체가 일어나지 않았다 (journal 원복 · 교체 전 급사) — 계보 0
    rmSync(file, { force: true })
    return { ok: true, status: 'DISCARDED' }
  }
  if (cur !== j.afterSha) return { ok: false, status: 'CONFLICT', why: '지금 draft 가 영수증의 교체 전·후 어느 쪽도 아니다 — 계보를 열지 않는다' }
  let r = null
  const u = updateQuarantine((store) => {
    r = openLineageIn(store[slug], { origin: 'INPUT_REPAIR', key: lineageKeyOf('INPUT_REPAIR', j.afterSha), now,
      extra: { pendingReceipt: true } })
    return r.opened ? { ...store, [slug]: r.entry } : store
  }, path)
  if (!u?.ok) return { ok: false, status: 'LEDGER_FAILED', why: u?.why ?? '장부 갱신 실패 — 영수증을 남긴다' }
  rmSync(file, { force: true })
  return { ok: true, status: r.opened ? 'OPENED' : 'SAME_EVIDENCE' }
}

/** 원고 폴더 전체의 영수증 — 실제 디렉터리만 본다 (topic-queue.ts 같은 일반 파일은 건너뛴다) */
export function completeAllPendingLineages({ draftsDir, path = QUARANTINE_PATH, now = Date.now() }) {
  const out = []
  if (!existsSync(draftsDir)) return out
  for (const ent of readdirSync(draftsDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || !SLUG.test(ent.name)) continue
    if (!lstatOrNull(join(draftsDir, ent.name, PENDING_FILE))) continue
    out.push({ slug: ent.name, ...completePendingLineage({ draftsDir, slug: ent.name, path, now }) })
  }
  return out
}

// ─────────────────────────────────────────────────────────
// ② 옛 입력 수리 영수증 대조
// ─────────────────────────────────────────────────────────

/** 결과 파일들에서 (slug · 수리 지문) 행을 모은다 — 읽지 못한 파일은 근거가 되지 못할 뿐이다 */
function receiptRowsFor(runsDir, slug, fingerprint) {
  const rows = []
  if (!existsSync(runsDir)) return rows
  for (const d of readdirSync(runsDir, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(d.name)) continue
    for (const f of readdirSync(join(runsDir, d.name), { withFileTypes: true })) {
      if (!f.isFile() || !/^input-repair-.*\.json$/.test(f.name)) continue
      let j
      try { j = JSON.parse(readFileSync(join(runsDir, d.name, f.name), 'utf8')) } catch { continue }
      for (const r of Array.isArray(j?.results) ? j.results : []) {
        if (r?.slug === slug && r?.repairFingerprint === fingerprint) rows.push({ row: r, date: j.date ?? null, dir: d.name, file: f.name })
      }
    }
  }
  return rows
}

/** 지금 draft 가 원고 계약을 통과하는가 (brief echo 아님 · 관문 · 형식) */
function currentDraftValid(draftPath) {
  if (!existsSync(draftPath)) return { ok: false, why: 'draft.md 가 없다' }
  const text = readFileSync(draftPath, 'utf8')
  if (briefEchoHeadings(text).length) return { ok: false, why: 'draft 가 아직 brief echo 다' }
  const v = validateManuscript(text)
  const f = judgeManuscriptFormat(text)
  if (!v.ok || !f.ok) return { ok: false, why: `draft 가 원고 계약을 통과하지 못한다 (${[...v.reasons, ...f.violations].map((x) => x.code).join(',')})` }
  return { ok: true, sha: sha(text) }
}

/**
 * 이 행이 옛 입력 수리 대조 대상인가 — **순수 판정** (장부 행 · 영수증 행 · draft 검증 결과).
 * @returns {{ok:true, fingerprint:string, receipt:object}|{ok:false, why:string}}
 */
export function judgeLegacyInputRepair({ entry, receipts, draft }) {
  const no = (why) => ({ ok: false, why })
  if (!entry || typeof entry !== 'object') return no('장부 행이 없다')
  if (entry.regenLineage) return no('이미 계보가 있다 — 옛 행이 아니다')
  if (entry.delivery) return no('전송 예약·전송불명 기록이 있다')
  const fps = Array.isArray(entry.inputRepairFingerprints) ? entry.inputRepairFingerprints : []
  if (!(Number.isFinite(entry.inputRepairCalls) && entry.inputRepairCalls >= 1 && entry.inputRepairCalls === fps.length)) return no('입력 수리 호출 기록이 지문 목록과 맞지 않다')
  const fingerprint = fps[fps.length - 1]
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint ?? '')) return no('수리 지문 모양이 아니다')
  if ((entry.regenLineageKeys ?? []).some((k) => k.endsWith(fingerprint.slice(7)))) return no('이 수리 지문으로 이미 대조했다')
  const total = Number.isFinite(entry.regenCalls) ? entry.regenCalls : 0
  if (!(total < MAX_REGEN_TOTAL)) return no(`전체 재생성 상한(${MAX_REGEN_TOTAL})에 닿았다`)
  if (receipts.length !== 1) return no(`이 수리 지문의 결과 행이 ${receipts.length}개다 — 정확히 1개여야 한다`)
  const { row, date } = receipts[0]
  if (!(row.type === 'DRAFT_INVALID_BRIEF_ECHO' && row.outcome === 'APPLIED' && row.candidateApplied === true && row.sent === true)) {
    return no(`결과 행이 APPLIED draft 교체가 아니다 (${row.type} · ${row.outcome})`)
  }
  if (!Number.isFinite(entry.lastInputRepairAt) || date !== kstDate(entry.lastInputRepairAt)) return no('결과 파일 날짜와 장부의 수리 시각이 다른 날이다')
  if (!draft.ok) return no(draft.why)
  return { ok: true, fingerprint, receipt: receipts[0] }
}

/** cold · autumn 대조 — 맞으면 장부 잠금 안에서 조건을 다시 보고 계보를 **한 번** 연다 */
export function reconcileLegacyInputRepair({ draftsDir, slug, path = QUARANTINE_PATH, now = Date.now() }) {
  if (lstatOrNull(join(draftsDir, slug, PENDING_FILE)) || lstatOrNull(join(draftsDir, slug, JOURNAL_FILE))) {
    return { ok: true, status: 'NOT_APPLICABLE', why: '완성되지 않은 영수증·journal 이 있다 — 그쪽이 먼저다' }
  }
  const ledger = readQuarantine(path)
  if (!ledger.ok) return { ok: false, status: 'LEDGER_FAILED', why: ledger.why }
  const entry = ledger.store[slug]
  if (!entry || entry.regenLineage || !(entry.inputRepairCalls >= 1)) return { ok: true, status: 'NOT_APPLICABLE' }
  const fp = (entry.inputRepairFingerprints ?? []).at(-1) ?? null
  const receipts = fp ? receiptRowsFor(join(draftsDir, '_runs'), slug, fp) : []
  const draft = currentDraftValid(join(draftsDir, slug, 'draft.md'))
  const j = judgeLegacyInputRepair({ entry, receipts, draft })
  if (!j.ok) return { ok: true, status: 'NOT_RECONCILED', why: j.why }
  const key = lineageKeyOf('INPUT_REPAIR', j.fingerprint.slice(7))
  let r = null
  let raced = null
  const u = updateQuarantine((store) => {
    // 🔴 잠금 안에서 다시 판정한다 — 그 사이 다른 writer 가 바꿨으면 열지 않는다
    const again = judgeLegacyInputRepair({ entry: store[slug], receipts, draft: currentDraftValid(join(draftsDir, slug, 'draft.md')) })
    if (!again.ok || again.fingerprint !== j.fingerprint) { raced = again.why ?? '수리 지문이 바뀌었다'; return store }
    r = openLineageIn(store[slug], { origin: 'INPUT_REPAIR', key, now,
      extra: { reconciledFrom: { kind: 'LEGACY_INPUT_REPAIR_RECEIPT', receipt: `${j.receipt.dir}/${basename(j.receipt.file)}`, repairFingerprint: j.fingerprint } } })
    return r.opened ? { ...store, [slug]: r.entry } : store
  }, path)
  if (!u?.ok) return { ok: false, status: 'LEDGER_FAILED', why: u?.why ?? '장부 갱신 실패' }
  if (raced) return { ok: true, status: 'NOT_RECONCILED', why: raced }
  return { ok: true, status: r.opened ? 'OPENED' : 'SAME_EVIDENCE', receipt: `${j.receipt.dir}/${j.receipt.file}` }
}

// ─────────────────────────────────────────────────────────
// ③ 옛 최초 invalid 응답 대조
// ─────────────────────────────────────────────────────────

const LEGACY_INVALID_RE = /^FETCH_FAILED: 회수 실패 — \[validate\] invalid_manuscript — (.+) · 전송 1건$/

/** `코드: 이유 / 코드: 이유` (describeReasons) → 위반 목록. 한 조각이라도 모양이 다르면 null (애매 → 대조 안 함) */
export function parseLegacyViolations(text) {
  const parts = String(text ?? '').split(' / ')
  const out = []
  for (const p of parts) {
    const m = /^([A-Z][A-Z0-9_]+): (.+)$/.exec(p)
    if (!m) return null
    out.push({ code: m[1], why: m[2] })
  }
  const clean = sanitizeViolations(out)
  return clean.length === out.length && clean.length > 0 ? clean : null
}

/**
 * 🔴 **옛 invalid 대조는 정확히 한 사건만 — 버전이 있는 migration identity** (2026-10-11 Codex 재검토 P1).
 *    앞판은 옛 장부 사유를 **지금의 아무 요청 지문**에나 묶었다 — brief 가 바뀌어 새 요청이 되어도 교정으로 돌렸다.
 *    이제 아래 목록의 사건만, 다음이 **모두 정확히** 같을 때만 대조한다:
 *      slug · 장부 행의 legacyLedgerKey (lastAt + 사유 문장의 sha256) · 지금 brief SHA-256 · 지금 일반 요청 지문
 *    brief 나 보낼 메시지가 한 글자라도 바뀌면 NOT_RECONCILED (그때 일반 요청은 새 메시지다 — 중복이 아니다).
 *    값은 2026-10-11 운영 장부·runtime brief 의 **읽기 전용 복사본**에서 계산했다
 *    (brief 는 10/11 00:15:43 수리 뒤 그대로 · 일반 프롬프트 바이트 불변 → 10/11 01:00 에 실제로 보낸 요청의 지문).
 */
export const LEGACY_INVALID_MIGRATIONS = Object.freeze([Object.freeze({
  id: 'legacy-invalid-first-response/gray-hair-leave-as-is/2026-10-11/v1',
  slug: 'gray-hair-leave-as-is',
  legacyLedgerKey: '2efc6e90ba4ee9efdfa10099e91d5b574b4cf56c617c273413490320571af153',
  briefSha256: 'f010034d271a4e71dca84e4063f6e4c773d73678d67edf5196e90324e5fcd4ed',
  messageFingerprint: 'sha256:8052446296d79945af0a727924b025f803d730074fc23dc9108f2cece736e7cf',
})])

/** 순수 판정 — migration identity · 장부 행 · 원고 존재 · 지금 brief · 지금 일반 요청 지문 */
export function judgeLegacyInvalid({ entry, slug, hasDraft, hasBrief, briefSha256, messageFingerprint, migrations = LEGACY_INVALID_MIGRATIONS }) {
  const no = (why) => ({ ok: false, why })
  const mig = migrations.find((x) => x.slug === slug)
  if (!mig) return no('옛 invalid 대조 migration 대상 slug 가 아니다')
  if (!entry || typeof entry !== 'object') return no('장부 행이 없다')
  if (entry.firstResponseInvalid) return no('이미 최초 응답 기록이 있다 (migration 은 한 번만)')
  if (entry.regenLineage || (Number.isFinite(entry.regenCalls) && entry.regenCalls > 0)) return no('재생성 기록이 있다 — 옛 최초 실패 행이 아니다')
  if (entry.delivery) return no('전송 예약·전송불명 기록이 있다 — 응답을 특정하지 못한 것일 수 있다')
  if (!(entry.kind === 'CONTENT' && entry.sent === true && entry.attempts === 1)) return no('보낸 1회의 내용 실패 행이 아니다')
  if (hasDraft) return no('원고가 이미 있다')
  if (!hasBrief) return no('brief 가 없다')
  const reasons = Array.isArray(entry.reasons) ? entry.reasons : []
  if (reasons.length !== 1) return no(`사유가 ${reasons.length}개다 — 정확히 1개여야 한다`)
  const m = LEGACY_INVALID_RE.exec(reasons[0])
  if (!m) return no('사유가 [validate] invalid_manuscript · 전송 1건 모양이 아니다')
  const violations = parseLegacyViolations(m[1])
  if (!violations) return no('위반 목록을 정확히 읽지 못했다')
  const legacyLedgerKey = sha(JSON.stringify([entry.lastAt ?? null, reasons[0]]))
  if (legacyLedgerKey !== mig.legacyLedgerKey) return no('장부 행이 migration 의 그 사건이 아니다 (legacyLedgerKey 불일치)')
  if (briefSha256 !== mig.briefSha256) return no('brief 가 그 사건 때와 다르다 (brief SHA-256 불일치) — 새 요청이다')
  if (messageFingerprint !== mig.messageFingerprint) return no('지금 일반 요청이 그 사건 때 보낸 요청이 아니다 (지문 불일치)')
  return { ok: true, violations, legacyLedgerKey, migrationId: mig.id }
}

/** gray 대조 — 맞으면 잠금 안에서 다시 보고 기록을 **한 번** 남긴다 (계보는 교정 단계가 그 키로 연다) · 재실행은 쓰기 0 */
export function reconcileLegacyInvalid({ draftsDir, slug, messageFingerprint, path = QUARANTINE_PATH, now = Date.now(), migrations = LEGACY_INVALID_MIGRATIONS }) {
  const facts = () => {
    const briefPath = join(draftsDir, slug, 'brief.md')
    const hasBrief = existsSync(briefPath)
    return { slug, migrations, hasDraft: existsSync(join(draftsDir, slug, 'draft.md')), hasBrief,
      briefSha256: hasBrief ? sha(readFileSync(briefPath, 'utf8')) : null, messageFingerprint }
  }
  // 대상 slug 가 아니면 장부도 읽지 않는다
  if (!migrations.some((x) => x.slug === slug)) return { ok: true, status: 'NOT_RECONCILED', why: '옛 invalid 대조 migration 대상 slug 가 아니다' }
  const ledger = readQuarantine(path)
  if (!ledger.ok) return { ok: false, status: 'LEDGER_FAILED', why: ledger.why }
  const j = judgeLegacyInvalid({ entry: ledger.store[slug], ...facts() })
  if (!j.ok) return { ok: true, status: 'NOT_RECONCILED', why: j.why }
  let raced = null
  const u = updateQuarantine((store) => {
    const again = judgeLegacyInvalid({ entry: store[slug], ...facts() })
    if (!again.ok) { raced = again.why; return store }
    const record = { ...firstResponseInvalidRecord({ messageFingerprint, reason: 'invalid_manuscript', violations: again.violations }, now),
      legacyLedgerKey: again.legacyLedgerKey, migrationId: again.migrationId, source: 'LEGACY_LEDGER_REASON' }
    return { ...store, [slug]: { ...store[slug], firstResponseInvalid: record } }
  }, path)
  if (!u?.ok) return { ok: false, status: 'LEDGER_FAILED', why: u?.why ?? '장부 갱신 실패' }
  if (raced) return { ok: true, status: 'NOT_RECONCILED', why: raced }
  return { ok: true, status: 'RECORDED', violations: j.violations, migrationId: j.migrationId }
}
