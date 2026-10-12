#!/usr/bin/env node
/**
 * 자동 회복 계약 검사 — 2026-10-11 자연 회차 등록 0 의 세 결함 (gray · autumn · cold).
 *
 *   A  최초 응답 형식 실패 — 교정할 수 있는 응답의 판정 · 증거(원문 없이) · 교정 실패 목록
 *   B  본문 길이 정본 — QA·batch 같은 계산 · hard 800~3000 FAIL/BLOCK · soft WARN 문장 불변
 *   C  재생성 예산 계보 — 신뢰된 사건만 새 계보 · 계보 2 · 전체 4 · 옛 행 이관 · 원복 · 소진 · 등록 성공 정리
 *
 * 🔴 운영 접근 0 — HOME·원고 폴더·장부는 임시. 실제 drive·래퍼 완주는 rehearsal S2·S8·S8B·S9 가 본다.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crypto from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.dirname(HERE)
const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-recovery-')))
const D = path.join(T, 'drafts', 'magazine')
fs.mkdirSync(D, { recursive: true })
process.env.HOME = T
process.env.SORAN_MAGAZINE_DRAFTS_DIR = D
process.env.SORAN_MAGAZINE_TEST_MODE = '1'
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }))

const Q = await import('./lib/magazine-quarantine.mjs')
if (!path.resolve(Q.QUARANTINE_PATH).startsWith(T + path.sep)) { console.log(`  ❌ 장부 경로가 격리 HOME 밖이다: ${Q.QUARANTINE_PATH}`); process.exit(1) }
const AR = await import('./magazine-auto-register.mjs')
const B = await import('./lib/magazine-body-length.mjs')
const S = await import('./lib/chatgpt-session.mjs')
const RG = await import('./lib/magazine-regen.mjs')
const DG = await import('./lib/magazine-delivery-gate.mjs')
const L = await import('./lib/magazine-load.mjs')
const IR = await import('./lib/magazine-input-repair.mjs')
const LR = await import('./lib/magazine-lineage-reconcile.mjs')
const PX = await import('./lib/magazine-producer-exit.mjs')
const QLm = await import('./lib/magazine-queue-lock.mjs')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}` : ''}`) } }
const finish = () => { console.log(`\n${fail ? '🔴' : '✅'} 자동 회복 계약 검사 ${pass}/${pass + fail}\n`); process.exitCode = fail ? 1 : 0 }
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.stack ?? e}`); finish(); process.exit(1) })
const SHA = 'a'.repeat(64)
const SHA2 = 'b'.repeat(64)
const ledger = (name, store = {}) => { const f = path.join(T, `${name}.json`); Q.saveQuarantine(store, f); return f }
const row = (f, slug = 's') => Q.readQuarantine(f).store[slug]

// ── A 최초 응답 ─────────────────────────────────────────────
console.log('\nA 최초 응답 형식 실패 — 교정 판정 · 증거 · 위반 {code, why} · 실패 목록')
{
  const good = { sent: true, stage: 'validate', reason: 'invalid_manuscript', conversationUrl: 'https://chatgpt.com/c/x', assistantMessageId: 'm1', responseSha256: SHA, settled: true,
    invalid: [{ code: 'FORMAT_VIOLATION', why: '1행: YAML frontmatter 가 없다. --- 로 시작해야 한다' }], length: 3100, responseExcerpt: '머리말 '.repeat(80), responseForm: 'code-block' }
  check('A 식별·정산된 invalid_manuscript (sent·validate·대화·메시지·sha·settled·위반 문장) → 교정 가능', AR.correctableFirstResponse(good))
  check('A markers_missing 도 교정 가능 (누락 문장 수가 위반 문장이 된다)', AR.correctableFirstResponse({ ...good, reason: 'markers_missing', invalid: null, missingCount: 2 }))
  for (const [k, v] of [['sent=null', { sent: null }], ['sent=false', { sent: false }], ['대화 없음', { conversationUrl: null }], ['메시지 없음', { assistantMessageId: null }],
    ['sha 없음', { responseSha256: null }], ['stage≠validate', { stage: 'await-response' }], ['다른 사유', { reason: 'response_timeout' }],
    ['정산 안 됨 (예약 남음)', { settled: false }], ['위반이 코드명뿐', { invalid: [{ code: 'FORMAT_VIOLATION', why: 'FORMAT_VIOLATION' }] }], ['위반 이유 없음', { invalid: [{ code: 'FORMAT_VIOLATION' }] }]]) {
    check(`A ${k} → 교정 0 (fail-closed)`, !AR.correctableFirstResponse({ ...good, ...v }))
  }
  const ev = AR.firstResponseEvidence(good)
  check('A 증거 — reason·stage·sent·invalid{code,why}·responseForm·대화·메시지·sha256·길이', ev.reason === 'invalid_manuscript' && ev.stage === 'validate' && ev.sent === true &&
    ev.invalid[0].code === 'FORMAT_VIOLATION' && ev.invalid[0].why.includes('YAML frontmatter') && ev.responseForm === 'code-block' && ev.conversationUrl && ev.assistantMessageId === 'm1' && ev.responseSha256 === SHA && ev.length === 3100)
  check('A 증거 — 앞부분은 200자 이하 · 원문 칸 없음', ev.responseExcerpt.length <= 200 && !('text' in ev) && !('body' in ev))
  const re = S.responseEvidence(`머리말 https://x.example/a 와 me@x.com 은 지운다\u0007\n\n---\ntitle: 제목\n${'가'.repeat(500)}`)
  check('A 응답 증거 — sha256 · 길이 · URL·메일·제어문자 제거 · 200자', /^[0-9a-f]{64}$/.test(re.responseSha256) && re.length > 500 && re.responseExcerpt.length <= 200 &&
    !/https?:|@x\.com|\u0007/.test(re.responseExcerpt) && re.responseExcerpt.includes('[URL]'), re.responseExcerpt.slice(0, 80))
  // 위반 정제 — 장부에 남는 유일한 모양
  const sv = Q.sanitizeViolations([{ code: 'FORMAT_VIOLATION', why: `${'가'.repeat(300)} https://x.example/q me@x.com\u0007` }, { code: 'NO_WHY' }, { code: 'SAME', why: 'SAME' }, { code: 'BAD CODE!', why: '이유' }])
  check('A 위반 정제 — why 160자 상한 · URL·메일·제어문자 제거 · why 없는/코드명뿐 위반은 버린다', sv.length === 2 && sv[0].why.length === Q.VIOLATION_WHY_MAX && Q.VIOLATION_WHY_MAX === 160 &&
    !/https?:|@x\.com|\u0007/.test(JSON.stringify(sv)) && sv[1].code === 'BADCODE', sv)
  const f = AR.firstResponseRegenFailures(good)
  check('A 교정 실패 목록 — 실제 위반 문장 그대로(코드: 이유) + frontmatter 규칙', f.some((x) => x.code === 'FIRST_RESPONSE_INVALID' && x.label === 'FORMAT_VIOLATION: 1행: YAML frontmatter 가 없다. --- 로 시작해야 한다') && f.some((x) => x.code === 'MANUSCRIPT_FORMAT_RULE' && x.label.includes('---')), f)
  // 교정 요청 문장 — 다른 지문 · 일반·QA 재생성 프롬프트 불변
  const pk = RG.buildFailurePacket({ slug: 'x', profile: 'STANDARD', failures: f, attempt: 1, attemptId: '00000000-0000-4000-8000-000000000000', source: 'FIRST_RESPONSE' })
  const corr = DG.firstResponseCorrectionPromptText(pk)
  check('A 교정 패킷 source=FIRST_RESPONSE · [교정 요청] 으로 시작 · 실제 위반 문장(YAML frontmatter …)이 실린다', pk.source === 'FIRST_RESPONSE' && corr.startsWith('[교정 요청]') && corr.includes('YAML frontmatter 가 없다. --- 로 시작해야 한다'), corr.split('\n').slice(-4).join(' / '))
  const h = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16)
  check('불변 — 일반 최초 요청 프롬프트 바이트', h(DG.legacyManuscriptPromptText(null)) === '5bb6e6ccb4bb9d3f', h(DG.legacyManuscriptPromptText(null)))
  const qaPk = RG.buildFailurePacket({ slug: 'x', profile: 'STANDARD', failures: [{ code: 'QA_FAIL', label: 'magazine QA FAIL', sentence: 's' }], attempt: 1, attemptId: 'a' })
  check('불변 — QA 재생성 지시문 바이트 · source 없음', h(qaPk.instruction) === 'aeea1a85dce887b0' && !('source' in qaPk), h(qaPk.instruction))
  // 정산 — 예약 해제 + invalid 증거를 한 번에 (장부에는 앞부분·원문 없음 · 위반 {code, why})
  const LF = ledger('a-first')
  const u = Q.reserveDelivery({ slug: 's', messageFingerprint: 'sha256:m', reservationId: 'rv-a', path: LF })
  const st = Q.settleDeliveryReservation({ slug: 's', reservationId: 'rv-a', path: LF,
    outcome: { kind: 'FIRST_RESPONSE_INVALID', evidence: { ...good, messageFingerprint: 'sha256:m', violations: Q.violationsOfResponse(good) } } })
  const e = row(LF)
  check('A 정산 — 예약 해제와 기록이 함께 (delivery 없음 · 기록 있음)', u.ok && st.ok && st.settled && e.delivery === undefined && Boolean(e.firstResponseInvalid), { st, e })
  check('A 장부 — 기록은 지문·대화·메시지·sha·길이·위반{code,why} 뿐 (앞부분·원문 없음)', e.firstResponseInvalid.responseSha256 === SHA && !('responseExcerpt' in e.firstResponseInvalid) && !JSON.stringify(e).includes('머리말') &&
    e.firstResponseInvalid.violations[0].why === '1행: YAML frontmatter 가 없다. --- 로 시작해야 한다' && !('invalidCodes' in e.firstResponseInvalid), e.firstResponseInvalid)
  check('A 같은 일반 요청 지문 → 교정 대상으로 찾는다 · 다른 지문(brief 변경)이면 아니다',
    Boolean(Q.firstResponseInvalidFor(e, 'sha256:m')) && !Q.firstResponseInvalidFor(e, 'sha256:other'))
  const ledgerFailures = AR.firstResponseRegenFailures(e.firstResponseInvalid)
  check('A 장부 기록에서 만든 교정 목록도 실제 위반 문장 그대로 — 코드명을 why 로 지어내지 않는다', ledgerFailures[0].label === 'FORMAT_VIOLATION: 1행: YAML frontmatter 가 없다. --- 로 시작해야 한다', ledgerFailures)
}

// ── B 길이 정본 ─────────────────────────────────────────────
console.log('\nB 본문 길이 — 정본 하나 · hard FAIL · soft WARN 불변')
{
  const art = (n, extra = '') => ({ title: '제목', description: '설명', body: [{ type: 'paragraph', text: 'x'.repeat(n) + extra }] })
  const base = B.publishText(art(0)).length
  check('B hard 경계 — 3000 통과 · 3001 BODY_TOO_LONG', B.measureBody(art(3000 - base)).hard.ok && B.measureBody(art(3001 - base)).hard.code === 'BODY_TOO_LONG')
  check('B hard 경계 — 800 통과 · 799 BODY_TOO_SHORT', B.measureBody(art(800 - base)).hard.ok && B.measureBody(art(799 - base)).hard.code === 'BODY_TOO_SHORT')
  check('B 기준 완화 0 — 800~3000 · 권장 1200~2500', B.HARD_BODY.min === 800 && B.HARD_BODY.max === 3000 && B.SOFT_BODY.min === 1200 && B.SOFT_BODY.max === 2500)
  const sp = art(10, ' \n \n')
  check('B hard 는 공백·줄바꿈을 센다 · soft 는 공백을 빼고 센다', B.measureBody(sp).hardLength === B.publishText(sp).length && B.measureBody(sp).softLength === 10)
  check('B 재생성 패킷 줄 — 실제 길이와 기준', Boolean(B.measureBody(art(3252 - base)).hard.packetLabel?.startsWith('BODY_TOO_LONG: 본문 3252자')) && Boolean(B.measureBody(art(3252 - base)).hard.packetLabel?.includes('800~3000')))
  check('B batch 재생성 코드에 BODY_TOO_* 포함 (그 밖 코드는 그대로)', AR.BATCH_REGEN_CODES.test('BODY_TOO_LONG') && AR.BATCH_REGEN_CODES.test('BODY_TOO_SHORT') && AR.BATCH_REGEN_CODES.test('MED_X') && !AR.BATCH_REGEN_CODES.test('HERO_MISSING') && !AR.BATCH_REGEN_CODES.test('BODY_TOO_LONGX'))

  // 실제 QA · batch 를 같은 원고로 — 길이 값이 정확히 같다 (임시 저장소 사본: 변환기는 저장소 drafts/ 밖에 쓰지 않는다)
  const M = path.join(T, 'mini')
  for (const rel of ['scripts', 'drafts/magazine/topic-queue.ts', 'drafts/magazine/_template', 'src/content/magazine', 'public/magazine/avoiding-gatherings']) {
    const from = path.join(REPO, rel)
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(path.dirname(path.join(M, rel)), { recursive: true })
    fs.cpSync(from, path.join(M, rel), { recursive: true })
  }
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(M, 'node_modules'))
  const q = L.loadQueue()
  const item = q.find((i) => i.cluster === 'relationship') ?? q[0]
  const slug = item.slug
  const SD = path.join(M, 'drafts', 'magazine', slug)
  fs.mkdirSync(SD, { recursive: true })
  for (const f of ['brief.md', 'review.ts']) fs.copyFileSync(path.join(REPO, 'drafts', 'magazine', 'avoiding-gatherings', f), path.join(SD, f))
  const draft = fs.readFileSync(path.join(REPO, 'drafts', 'magazine', 'avoiding-gatherings', 'draft.md'), 'utf8')
  const body = draft.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\n\[CTA\][^\n]*\n?$/, '').trimEnd()
  const longDraft = `${draft.replace(/\n\[CTA\][^\n]*\n?$/, '').trimEnd()}\n\n## 조금 더\n\n${body.split('\n').filter((l) => l && !/^[#>-]/.test(l)).join('\n\n')}\n\n${draft.match(/\[CTA\][^\n]*/)[0]}\n`
  fs.writeFileSync(path.join(SD, 'draft.md'), longDraft)
  const env = { PATH: process.env.PATH, HOME: T, SORAN_MAGAZINE_TEST_MODE: '1' }
  const MS = path.join(M, 'scripts')
  const conv = spawnSync(process.execPath, [path.join(MS, 'magazine-md-to-draft.mjs'), '--in', path.join(SD, 'draft.md'), '--out', path.join(SD, 'article-draft.ts')], { encoding: 'utf8', env, cwd: M })
  const qa = spawnSync(process.execPath, [path.join(MS, 'magazine-qa.mjs'), '--draft', path.join(SD, 'article-draft.ts')], { encoding: 'utf8', env, cwd: M })
  const bq = spawnSync(process.execPath, [path.join(MS, 'magazine-batch-qa.mjs'), slug, '--strict-auto', '--json'], { encoding: 'utf8', env, cwd: M })
  const qaN = Number((/BODY_TOO_LONG: 본문 (\d+)자/.exec(qa.stdout) ?? [])[1])
  let bqRow = null
  try { const j = JSON.parse(bq.stdout); bqRow = (Array.isArray(j) ? j : j.results ?? []).find((r) => r.slug === slug) } catch { bqRow = null }
  const bqMsg = bqRow?.blockedBy?.find((x) => x.code === 'BODY_TOO_LONG')?.message ?? ''
  const bqN = Number((/본문 (\d+)자/.exec(bqMsg) ?? [])[1])
  check('B 실제 변환 → QA FAIL BODY_TOO_LONG (hard · hero 전 단계)', conv.status === 0 && qa.status !== 0 && /✗ FAIL[^\n]*BODY_TOO_LONG: 본문 \d+자/.test(qa.stdout), `${conv.status} ${qa.stdout.split('\n').filter((l) => /BODY|FAIL/.test(l)).slice(0, 2).join(' / ')}`)
  check('B 실제 batch 도 같은 원고를 BODY_TOO_LONG(코드)으로 막는다', bqRow?.verdict !== 'READY_TO_SCHEDULE' && /^본문 \d+자 — 3000자를 넘었다$/.test(bqMsg), bqMsg || bq.stdout.slice(0, 200))
  check('B QA 와 batch 의 길이 값이 정확히 같다 (공백·줄바꿈 포함)', Number.isFinite(qaN) && qaN === bqN && bqN === bqRow?.checks?.bodyLength, { qaN, bqN, bodyLength: bqRow?.checks?.bodyLength })
  check('B 실제 QA 출력의 FAIL 줄에서 재생성 패킷 줄을 그대로 뽑는다', AR.qaFailLines(qa.stdout).some((l) => /^BODY_TOO_LONG: 본문 \d+자/.test(l)))
}

// ── C 재생성 예산 계보 ───────────────────────────────────────
console.log('\nC 재생성 예산 — 계보 2 · 전체 4 · 신뢰된 사건만 새 계보')
{
  // 옛 행 (cold 모양): regenCalls 2 · attempts 1 · 계보 없음
  const LC = ledger('c', { s: { attempts: 1, kind: 'CONTENT', regenCalls: 2, regenAttemptIds: ['p1', 'p2'], inputRepairCalls: 1 } })
  const b0 = Q.regenBudget({ entry: row(LC) })
  check('C 옛 행 — 쓴 2회 전부가 한 계보(LEGACY) 몫 → 소진 (보수적 이관)', b0.exhausted && b0.exhaustedBy === 'LINEAGE' && b0.lineage.origin === 'LEGACY' && b0.total === 2)
  const o1 = Q.openRegenLineage({ slug: 's', origin: 'INPUT_REPAIR', evidence: { sha256: SHA }, path: LC })
  const e1 = row(LC)
  const b1 = Q.regenBudget({ entry: e1 })
  check('C 계보 함수 계약 — 새 계보 · 계보 2회 남음 · 전체 2 보존 · attempts 불변 (실제 입력 수리 경로는 F · rehearsal S2·S11)', o1.opened && e1.regenLineage.origin === 'INPUT_REPAIR' && b1.left === 2 && e1.regenCalls === 2 && e1.attempts === 1 && e1.inputRepairCalls === 1, { e1, b1 })
  const again = Q.openRegenLineage({ slug: 's', origin: 'INPUT_REPAIR', evidence: { sha256: SHA }, path: LC })
  check('C 같은 증거로는 다시 열지 않는다 (SAME_EVIDENCE · 바이트 불변)', again.ok && !again.opened && again.reason === 'SAME_EVIDENCE')
  // 같은 계보 안에서 재생성 2회 — reserveDelivery 의 실제 임계구역으로
  const fp = (n) => `sha256:${String(n).repeat(64).slice(0, 64)}`
  for (const [i, id] of [[1, 'r1'], [2, 'r2']]) {
    const u = Q.reserveDelivery({ slug: 's', messageFingerprint: fp(i), reservationId: `rv${i}`, regen: { attemptId: id, packetHash: 'h' }, path: LC })
    Q.releaseDeliveryReservation({ slug: 's', reservationId: `rv${i}`, path: LC })
    check(`C 계보 재생성 ${i}회 예약`, u.ok, u.why)
  }
  const e2 = row(LC)
  const b2 = Q.regenBudget({ entry: e2 })
  check('C 계보 2회 → 소진 (LINEAGE) · 전체 4', b2.exhausted && e2.regenLineage.calls === 2 && e2.regenCalls === 4, { lineage: e2.regenLineage, total: e2.regenCalls })
  const blocked = Q.reserveDelivery({ slug: 's', messageFingerprint: fp(3), reservationId: 'rv3', regen: { attemptId: 'r3', packetHash: 'h' }, path: LC })
  check('C 소진 뒤 전송 경계도 막는다 · 장부 불변', !blocked.ok && blocked.exhausted && row(LC).regenCalls === 4)
  // 전체 상한 — 새 신뢰 사건이 와도 4에서 막는다
  const o3 = Q.openRegenLineage({ slug: 's', origin: 'FIRST_FETCH', evidence: { sha256: SHA2 }, path: LC })
  const b3 = Q.regenBudget({ entry: row(LC) })
  check(`C 전체 ${Q.MAX_REGEN_TOTAL}회에서 반드시 막는다 — 새 계보가 열려도 (TOTAL)`, o3.opened && b3.exhausted && b3.exhaustedBy === 'TOTAL' && Q.MAX_REGEN_TOTAL === 4, b3)
  // 재생성 후보 변경·수동 draft 변경은 계보를 열지 않는다 — 열 수 있는 사건은 셋뿐
  const LM = ledger('m', { s: { attempts: 0, regenCalls: 1, regenLineage: { id: 'x', origin: 'FIRST_FETCH', evidenceKey: `FIRST_FETCH:${SHA}`, calls: 1, attemptIds: ['q1'] } } })
  const bad = Q.openRegenLineage({ slug: 's', origin: 'REGEN_RESULT', evidence: { sha256: SHA2 }, path: LM })
  check('C 재생성 결과물·수동 변경 같은 사건으로는 계보를 열 수 없다 (허용 사건 3종)', !bad.ok && !bad.opened && Q.REGEN_LINEAGE_ORIGINS.join(',') === 'FIRST_FETCH,INPUT_REPAIR,INVALID_FIRST_RESPONSE')
  const changed = Q.recordFailure({ entry: row(LM), fingerprint: 'fp-new', now: 1, reasons: ['QA_FAIL: x'] })
  check('C 원고 지문이 바뀌어도(수동 draft 변경) 계보·전체 재생성 횟수는 그대로', changed.regenLineage === undefined && row(LM).regenLineage.calls === 1 && row(LM).regenCalls === 1)
  check('C recordFailure 는 재생성 칸을 만들지도 지우지도 않는다 (호출부가 기존 행에 덮어 쓴다)', !('regenCalls' in changed))
  // 자기 시도 원복 — 지금 계보의 몫만
  Q.updateQuarantine((cur) => ({ ...cur, s: Q.recordRegenCall({ entry: cur.s, now: 2, attemptId: 'q2' }) }), LM)
  const rv = Q.revertRegenAttempt({ slug: 's', attemptId: 'q2', path: LM })
  check('C 자기 시도 원복 — 계보·전체 1씩 · 다른 시도 표식 불변', rv.reverted && row(LM).regenLineage.calls === 1 && row(LM).regenCalls === 1 && row(LM).regenLineage.attemptIds.join(',') === 'q1')
  // 원고 그대로 → 이 계보만 닫는다 (전체를 덮지 않는다)
  const LN = ledger('n', { s: { regenCalls: 3, regenLineage: { id: 'y', origin: 'INPUT_REPAIR', evidenceKey: `INPUT_REPAIR:${SHA}`, calls: 1, attemptIds: [] } } })
  Q.exhaustRegenLineage({ slug: 's', path: LN })
  check('C 재생성했는데 원고 그대로 → 계보만 소진 · 전체 3 그대로 (2로 덮어 되살리지 않는다)', row(LN).regenLineage.calls === 2 && row(LN).regenCalls === 3)
  // 옛 행 이관은 한 번 · 결정적
  const LL = ledger('l', { s: { regenCalls: 1, regenAttemptIds: ['z'] } })
  Q.updateQuarantine((cur) => ({ ...cur, s: Q.recordRegenCall({ entry: cur.s, now: 3, attemptId: 'z2' }) }), LL)
  const el = row(LL)
  check('C 옛 행 첫 변경에서 계보로 굳는다 — LEGACY 1 + 이번 1 = 2 · 이후 그대로', el.regenLineage.origin === 'LEGACY' && el.regenLineage.calls === 2 && el.regenCalls === 2 && Q.regenBudget({ entry: el }).exhausted)
  // 등록 성공 — 기존 clearEntry/clearRegen 계약
  const LS = ledger('ok', { s: { attempts: 1, regenCalls: 2, regenLineage: { id: 'z', origin: 'INPUT_REPAIR', calls: 1 }, regenLineageKeys: ['k'], firstResponseInvalid: { responseSha256: SHA }, kind: 'CONTENT' } })
  RG.clearRegen('s', LS)
  const es = row(LS)
  check('C 등록 성공 → 재생성·계보·최초 응답 기록 정리 (attempts 등 나머지는 기존 계약대로)', !('regenCalls' in es) && !('regenLineage' in es) && !('regenLineageKeys' in es) && !('firstResponseInvalid' in es) && es.attempts === 1)
}

// ── E 전송 예약 정산 원자성 — 실제 자식 프로세스 SIGKILL ────────────────
console.log('\nE 전송 예약 정산 — 해제 + 결말 기록 한 번에 · commit 전 급사 = 예약 그대로')
const QURL = pathToFileURL(path.join(HERE, 'lib', 'magazine-quarantine.mjs')).href
const childEnv = { PATH: process.env.PATH, HOME: T, SORAN_MAGAZINE_TEST_MODE: '1' }
const lockOf = (f) => `${f}.lock`
function killSettle({ name, outcome, killAt }) {
  const LF = ledger(name)
  const u = Q.reserveDelivery({ slug: 's', messageFingerprint: 'sha256:m', reservationId: 'rv-k', path: LF })
  const before = fs.readFileSync(LF)
  const child = path.join(T, `${name}.mjs`)
  fs.writeFileSync(child, `const Q = await import(${JSON.stringify(QURL)})
Q.settleDeliveryReservation({ slug: 's', reservationId: 'rv-k', path: ${JSON.stringify(LF)}, outcome: ${JSON.stringify(outcome)},
  phaseHook: (ph) => { if (ph === ${JSON.stringify(killAt)}) process.kill(process.pid, 'SIGKILL') } })
console.log('SURVIVED')
`)
  const r = spawnSync(process.execPath, [child], { env: childEnv, encoding: 'utf8' })
  return { LF, reserved: u.ok, before, signal: r.signal, survived: r.stdout.includes('SURVIVED') }
}
{
  const evidence = { messageFingerprint: 'sha256:m', conversationUrl: 'https://chatgpt.com/c/k', assistantMessageId: 'mk', responseSha256: SHA, length: 900, reason: 'invalid_manuscript',
    violations: [{ code: 'FORMAT_VIOLATION', why: '1행: YAML frontmatter 가 없다. --- 로 시작해야 한다' }] }
  for (const [label, outcome] of [['invalid 증거', { kind: 'FIRST_RESPONSE_INVALID', evidence }], ['FIRST_FETCH 계보', { kind: 'FIRST_FETCH', sha256: SHA2 }]]) {
    const k = killSettle({ name: `e-before-${outcome.kind}`, outcome, killAt: 'before-commit' })
    const after = fs.readFileSync(k.LF)
    const e = row(k.LF)
    check(`🔴 E ${label} — commit 전 실제 SIGKILL → 장부 바이트 그대로 · 예약 남음 · 결말 기록 없음 (예약만 풀린 중간 상태 0)`,
      k.reserved && k.signal === 'SIGKILL' && !k.survived && after.equals(k.before) && e.delivery?.reservationId === 'rv-k' && !e.firstResponseInvalid && !e.regenLineage, { signal: k.signal, e })
    const stale = fs.existsSync(lockOf(k.LF))
    const next = Q.updateQuarantine((cur) => cur, k.LF)
    check(`E ${label} — 죽은 주인의 잠금은 다음 변경이 거둔다 · 잔여 lock 0`, stale && next.ok && !fs.existsSync(lockOf(k.LF)) && !fs.existsSync(`${lockOf(k.LF)}.reclaim`), { stale, next })
    const k2 = killSettle({ name: `e-after-${outcome.kind}`, outcome, killAt: 'after-commit' })
    const e2 = row(k2.LF)
    const done = outcome.kind === 'FIRST_FETCH' ? e2.regenLineage?.origin === 'FIRST_FETCH' && e2.regenLineage.calls === 0 : e2.firstResponseInvalid?.violations?.[0]?.why === evidence.violations[0].why
    check(`E ${label} — commit 뒤 SIGKILL → 예약 해제와 기록이 둘 다 있다`, k2.signal === 'SIGKILL' && e2.delivery === undefined && done && !fs.existsSync(lockOf(k2.LF)), e2)
  }
  const LC = ledger('e-cas')
  Q.reserveDelivery({ slug: 's', messageFingerprint: 'sha256:m', reservationId: 'rv-mine', path: LC })
  const b = fs.readFileSync(LC)
  const other = Q.settleDeliveryReservation({ slug: 's', reservationId: 'rv-other', path: LC, outcome: { kind: 'FIRST_FETCH', sha256: SHA } })
  check('E CAS — 남의 예약 ID 로는 아무것도 바꾸지 않는다', other.ok && !other.settled && fs.readFileSync(LC).equals(b))
  const thin = Q.settleDeliveryReservation({ slug: 's', reservationId: 'rv-mine', path: LC, outcome: { kind: 'FIRST_RESPONSE_INVALID', evidence: { ...evidence, assistantMessageId: null } } })
  const noWhy = Q.settleDeliveryReservation({ slug: 's', reservationId: 'rv-mine', path: LC, outcome: { kind: 'FIRST_RESPONSE_INVALID', evidence: { ...evidence, violations: [{ code: 'FORMAT_VIOLATION' }] } } })
  check('E 증거가 모자라면(메시지 없음 · 위반 이유 없음) 정산 0 · 예약 유지 (fail-closed)', !thin.ok && !noWhy.ok && fs.readFileSync(LC).equals(b) && row(LC).delivery?.reservationId === 'rv-mine')
}

// ── F 입력 수리 계보 영수증 — 실제 SIGKILL · 장부 쓰기 실패 · 다음 회차 복구 ──────────
console.log('\nF 입력 수리 → 계보 영수증 — draft 교체 직후 급사 · 교체 중 급사 · 장부 실패 → 다음 회차가 provider 호출 0 으로 완성')
{
  const FXD = path.join(HERE, 'fixtures', 'magazine-format-contract')
  const COLD = 'cold-weather-joint-pain'
  // 🔴 큐 행은 고정 fixture — 실제 큐에서 cold 가 등록돼 빠져도 반례는 그대로 (2026-10-12)
  const coldItem = (await import('./fixtures/magazine-format-contract/repair-queue-rows.mjs')).fixtureQueue([COLD])[0]
  const ECHO = fs.readFileSync(path.join(FXD, 'cold-weather-joint-pain.draft.md'), 'utf8')
  const GOOD = fs.readFileSync(path.join(REPO, 'drafts', 'magazine', 'job-credentials', 'draft.md'), 'utf8')
  const BRIEF = fs.readFileSync(path.join(FXD, 'job-credentials.brief.md'), 'utf8')
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
  const setup = (name) => {
    const DD = path.join(T, `f-${name}`, 'drafts', 'magazine')
    fs.mkdirSync(path.join(DD, COLD), { recursive: true })
    fs.writeFileSync(path.join(DD, COLD, 'brief.md'), BRIEF)
    fs.writeFileSync(path.join(DD, COLD, 'review.ts'), 'export const REVIEW = {}\n')
    fs.writeFileSync(path.join(DD, COLD, 'draft.md'), ECHO)
    // cold 의 운영 모양 — 계보 없는 옛 행 (regenCalls 2 · attempts 1)
    const LF = ledger(`f-${name}`, { [COLD]: { attempts: 1, kind: 'CONTENT', regenCalls: 2, regenAttemptIds: ['p1', 'p2'], sent: false } })
    return { DD, LF, tmp: path.join(T, `f-${name}`, 'tmp') }
  }
  // 실제 자식과 같은 계약의 가짜 바깥 — 실제 수리 관문 · 실제 장부 예약 · 실제 정산
  const depsSrc = (DD, LF, killAt, corruptAfter = false) => `
const IR = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'lib', 'magazine-input-repair.mjs')).href)})
const Q = await import(${JSON.stringify(QURL)})
const DG = await import(${JSON.stringify(pathToFileURL(path.join(HERE, 'lib', 'magazine-delivery-gate.mjs')).href)})
const fs = await import('node:fs')
const calls = { runner: 0, brief: 0 }
const deps = {
  log: () => {}, parseReview: () => ({}),
  generateBrief: async () => { calls.brief++; return { ok: false, why: 'x' } },
  repairGate: ({ slug }) => ({ gate: DG.inputRepairGate({ slug, draftsDir: ${JSON.stringify(DD)}, quarantinePath: ${JSON.stringify(LF)} }) }),
  runRepairFetch: async ({ slug, draftOut }) => {
    calls.runner++
    const g = DG.inputRepairGate({ slug, draftsDir: ${JSON.stringify(DD)}, quarantinePath: ${JSON.stringify(LF)} })
    const u = Q.reserveDelivery({ slug, messageFingerprint: g.messageFingerprint, reservationId: 'rv-ir', inputRepair: { fingerprint: g.messageFingerprint }, path: ${JSON.stringify(LF)} })
    if (!u.ok) return { slug, status: 'held', sent: false, errorDetail: u.why }
    fs.writeFileSync(draftOut, ${JSON.stringify(GOOD)})
    Q.settleDeliveryReservation({ slug, reservationId: 'rv-ir', path: ${JSON.stringify(LF)} })
    ${corruptAfter ? `fs.writeFileSync(${JSON.stringify(LF)}, '{ 깨진 장부')` : ''}
    return { slug, status: 'ok', sent: true, conversationUrl: 'https://chatgpt.com/c/fake-ir' }
  },
  convertCheck: () => ({ ok: true }),
  phaseHook: (ph) => { if (ph === ${JSON.stringify(killAt)}) process.kill(process.pid, 'SIGKILL') },
}
`
  const runIn = async (DD, LF, tmp) => {
    const calls = { runner: 0, brief: 0 }
    const deps = {
      log: () => {}, parseReview: () => ({}),
      generateBrief: async () => { calls.brief++; return { ok: false } },
      repairGate: ({ slug }) => ({ gate: DG.inputRepairGate({ slug, draftsDir: DD, quarantinePath: LF }) }),
      runRepairFetch: async () => { calls.runner++; return null },
      convertCheck: () => ({ ok: true }),
    }
    const report = await IR.runInputRepair({ draftsDir: DD, queue: [coldItem], ledger: Q.readQuarantine(LF), quarantinePath: LF, deps, tmpDir: tmp })
    return { report, calls }
  }
  const pending = (DD) => path.join(DD, COLD, LR.PENDING_FILE)
  check('F 준비 — cold 실제 큐 행 · 자동 레인 · brief echo 원고', Boolean(coldItem) && IR.scanRepairTargets({ queue: [coldItem], draftsDir: setup('probe').DD, store: {} }).targets.length === 1)

  // ① draft 교체 직후 · 장부 기록 전 실제 SIGKILL
  {
    const { DD, LF, tmp } = setup('kill-committed')
    const child = path.join(T, 'f-kill-committed.mjs')
    fs.writeFileSync(child, `${depsSrc(DD, LF, 'draft-committed')}
await IR.runInputRepair({ draftsDir: ${JSON.stringify(DD)}, queue: [${JSON.stringify(coldItem)}], ledger: Q.readQuarantine(${JSON.stringify(LF)}), quarantinePath: ${JSON.stringify(LF)}, deps, tmpDir: ${JSON.stringify(tmp)} })
console.log('SURVIVED')
`)
    const k = spawnSync(process.execPath, [child], { env: childEnv, encoding: 'utf8' })
    const e0 = row(LF, COLD)
    check('🔴 F① 교체 직후 SIGKILL — draft 는 새 원고 · 영수증 남음 · 장부에 계보 없음 (APPLIED 로 숨지 않았다)',
      k.signal === 'SIGKILL' && fs.readFileSync(path.join(DD, COLD, 'draft.md'), 'utf8') === GOOD && fs.existsSync(pending(DD)) && !e0.regenLineage && e0.inputRepairCalls === 1, { signal: k.signal, e0, out: k.stdout.slice(0, 80) })
    const { report, calls } = await runIn(DD, LF, tmp)
    const e1 = row(LF, COLD)
    check('🔴 F① 다음 회차 — 영수증으로 INPUT_REPAIR 계보를 연다 · provider·ChatGPT 호출 0 · 영수증 삭제',
      report.lineagePending?.[0]?.status === 'OPENED' && calls.runner === 0 && calls.brief === 0 && e1.regenLineage?.origin === 'INPUT_REPAIR' && e1.regenLineage.calls === 0 &&
      e1.regenLineage.evidenceKey === `INPUT_REPAIR:${sha(GOOD)}` && !fs.existsSync(pending(DD)), { lp: report.lineagePending, calls, lineage: e1.regenLineage })
    check('F① 예산 — 새 계보 2 · 전체 regenCalls 2 보존 · attempts 불변 · producer 실패 0', Q.regenBudget({ entry: e1 }).left === 2 && e1.regenCalls === 2 && e1.attempts === 1 &&
      PX.summarizeRepairStage({ status: 0, report }).failures.length === 0)
    const again = await runIn(DD, LF, tmp)
    check('F① 그다음 회차 — 영수증 없음 · 계보 그대로 (두 번 열지 않는다)', again.report.lineagePending.length === 0 && Boolean(e1.regenLineage?.id) && row(LF, COLD).regenLineage?.id === e1.regenLineage?.id && again.calls.runner === 0)
  }
  // ② 교체 중(prepared) 실제 SIGKILL — journal 이 원복하고 영수증은 계보 없이 거둔다
  {
    const { DD, LF, tmp } = setup('kill-prepared')
    const child = path.join(T, 'f-kill-prepared.mjs')
    fs.writeFileSync(child, `${depsSrc(DD, LF, 'prepared')}
await IR.runInputRepair({ draftsDir: ${JSON.stringify(DD)}, queue: [${JSON.stringify(coldItem)}], ledger: Q.readQuarantine(${JSON.stringify(LF)}), quarantinePath: ${JSON.stringify(LF)}, deps, tmpDir: ${JSON.stringify(tmp)} })
`)
    const k = spawnSync(process.execPath, [child], { env: childEnv, encoding: 'utf8' })
    check('F② 교체 중 SIGKILL — journal · 영수증 남음', k.signal === 'SIGKILL' && fs.existsSync(path.join(DD, COLD, IR.JOURNAL_FILE)) && fs.existsSync(pending(DD)))
    const { report, calls } = await runIn(DD, LF, tmp)
    const e = row(LF, COLD)
    check('F② 다음 회차 — journal 원복 → 영수증 DISCARDED · 계보 0 · 같은 수리 지문 재전송 0 (HELD)',
      report.recovered?.[0]?.rolledBack === true && report.lineagePending?.[0]?.status === 'DISCARDED' && !e.regenLineage && fs.readFileSync(path.join(DD, COLD, 'draft.md'), 'utf8') === ECHO &&
      calls.runner === 0 && report.results?.[0]?.outcome === 'HELD' && !fs.existsSync(pending(DD)), { rec: report.recovered, lp: report.lineagePending, res: report.results?.map((r) => r.outcome), calls })
  }
  // ③ 장부 쓰기 실패 — 교체는 끝났고 계보는 못 적었다 → LINEAGE_PENDING · producer PARTIAL → 장부 회복 뒤 완성
  {
    const { DD, LF, tmp } = setup('ledger-fail')
    const good = fs.readFileSync(LF)
    const child = path.join(T, 'f-ledger-fail.mjs')
    fs.writeFileSync(child, `${depsSrc(DD, LF, '__never__', true)}
const report = await IR.runInputRepair({ draftsDir: ${JSON.stringify(DD)}, queue: [${JSON.stringify(coldItem)}], ledger: Q.readQuarantine(${JSON.stringify(LF)}), quarantinePath: ${JSON.stringify(LF)}, deps, tmpDir: ${JSON.stringify(tmp)} })
console.log(JSON.stringify(report))
`)
    const r = spawnSync(process.execPath, [child], { env: childEnv, encoding: 'utf8' })
    let report = null
    try { report = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { report = null }
    const res = report?.results?.[0]
    const sum = PX.summarizeRepairStage({ status: 0, report })
    const verdict = PX.judgeProducerRun({ plan: PX.stage('plan', { status: 0 }), brief: PX.stage('brief', { status: 0 }), fetch: PX.stage('fetch', { status: 0 }), repair: sum })
    check('🔴 F③ 장부 쓰기 실패 — APPLIED 아님 → LINEAGE_PENDING · candidateApplied · 영수증 남음', res?.outcome === 'LINEAGE_PENDING' && res.candidateApplied === true && res.regenLineage === 'LEDGER_FAILED' && fs.existsSync(pending(DD)), res)
    check('🔴 F③ producer 결과는 PARTIAL (수리 실패 LINEAGE_PENDING 1)', sum.failures.length === 1 && sum.failures[0].outcome === 'LINEAGE_PENDING' && verdict.verdict === 'PARTIAL', { failures: sum.failures, verdict })
    // 장부가 회복된다 (손상 직전 바이트 + 그 사이 실제로 적힌 수리 지문) — 다음 회차가 provider 호출 0 으로 완성
    Q.saveQuarantine({ ...JSON.parse(good.toString('utf8')), [COLD]: { ...JSON.parse(good.toString('utf8'))[COLD], inputRepairCalls: 1, inputRepairFingerprints: ['sha256:' + 'd'.repeat(64)] } }, LF)
    const { report: r2, calls } = await runIn(DD, LF, tmp)
    const e = row(LF, COLD)
    check('🔴 F③ 다음 회차 — 영수증 완성(OPENED) · provider·ChatGPT 0 · producer 실패 0', r2.lineagePending?.[0]?.status === 'OPENED' && calls.runner === 0 && calls.brief === 0 &&
      e.regenLineage?.origin === 'INPUT_REPAIR' && PX.summarizeRepairStage({ status: 0, report: r2 }).failures.length === 0 && !fs.existsSync(pending(DD)), { lp: r2.lineagePending, calls })
  }
  // ④ 영수증과 맞지 않는 draft (수동 편집) — 계보를 열지 않는다
  {
    const { DD, LF } = setup('conflict')
    LR.writeLineagePending({ draftsDir: DD, slug: COLD, beforeSha: sha(ECHO), afterSha: sha(GOOD), repairFingerprint: null })
    fs.writeFileSync(path.join(DD, COLD, 'draft.md'), `${GOOD}\n손으로 고친 줄\n`)
    const c = LR.completePendingLineage({ draftsDir: DD, slug: COLD, path: LF })
    check('F④ 수동 편집 draft — CONFLICT · 계보 0 · 영수증 보존 (예산은 옛 계보 그대로)', !c.ok && c.status === 'CONFLICT' && !row(LF, COLD).regenLineage && fs.existsSync(pending(DD)), c)
  }
}

// ── G 옛 행 대조 판정 — 애매하면 열지 않는다 ─────────────────────────
console.log('\nG 옛 행 대조 — cold·autumn 수리 영수증 · gray 장부 사유 — 하나라도 어긋나면 fail-closed')
{
  const FP = `sha256:${'e'.repeat(64)}`
  const at = Date.parse('2026-10-11T00:10:17+09:00')
  const entry = { attempts: 1, kind: 'CONTENT', regenCalls: 2, inputRepairCalls: 1, inputRepairFingerprints: [FP], lastInputRepairAt: at, sent: false }
  const rec = (o = {}) => ({ row: { slug: 'c', type: 'DRAFT_INVALID_BRIEF_ECHO', outcome: 'APPLIED', candidateApplied: true, sent: true, repairFingerprint: FP, ...o }, date: '2026-10-11', dir: '2026-10-11', file: 'input-repair-001543.json' })
  const ok = { ok: true, sha: SHA }
  check('G cold 모양 — 영수증 1 · 지문 · 날짜 · 유효 draft 모두 맞으면 대조 가능', LR.judgeLegacyInputRepair({ entry, receipts: [rec()], draft: ok }).ok)
  for (const [k, args] of [
    ['영수증 0', { receipts: [] }], ['영수증 2 (애매)', { receipts: [rec(), rec()] }], ['결과 FAILED', { receipts: [rec({ outcome: 'FAILED' })] }],
    ['brief 수리 행', { receipts: [rec({ type: 'BRIEF_FORMAT_CONTRACT' })] }], ['보내지 않은 수리', { receipts: [rec({ sent: false })] }],
    ['다른 날 영수증', { receipts: [{ ...rec(), date: '2026-10-10' }] }], ['draft 무효', { draft: { ok: false, why: 'echo' } }],
    ['이미 계보 있음', { entry: { ...entry, regenLineage: { calls: 0 } } }], ['전송 예약 있음', { entry: { ...entry, delivery: { kind: 'DELIVERY_UNCERTAIN' } } }],
    ['호출 수·지문 수 불일치', { entry: { ...entry, inputRepairCalls: 2 } }], ['전체 상한 4', { entry: { ...entry, regenCalls: 4 } }],
  ]) {
    check(`G cold 대조 거부 — ${k}`, !LR.judgeLegacyInputRepair({ entry, receipts: [rec()], draft: ok, ...args }).ok)
  }
  // gray — 2026-10-11 운영 행 그대로 · 수리 후 실제 brief(읽기 전용 복사 fixture) · 버전 있는 migration identity 한 건
  const GRAY = 'gray-hair-leave-as-is'
  const gray = { kind: 'CONTENT', sent: true, attempts: 1, lastAt: 1791648177801, fingerprint: null,
    reasons: ['FETCH_FAILED: 회수 실패 — [validate] invalid_manuscript — FORMAT_VIOLATION: 1행: YAML frontmatter 가 없다. --- 로 시작해야 한다 · 전송 1건'] }
  const GRAY_BRIEF = fs.readFileSync(path.join(HERE, 'fixtures', 'magazine-format-contract', 'gray-hair-leave-as-is.repaired-2026-10-11.brief.md'), 'utf8')
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
  const [MIG] = LR.LEGACY_INVALID_MIGRATIONS
  check('G migration identity — 한 건 · 버전 있는 id · gray slug · fixture brief SHA 와 장부 키가 상수와 같다', LR.LEGACY_INVALID_MIGRATIONS.length === 1 && /\/v1$/.test(MIG.id) && MIG.slug === GRAY &&
    MIG.briefSha256 === sha(GRAY_BRIEF) && MIG.legacyLedgerKey === sha(JSON.stringify([gray.lastAt, gray.reasons[0]])), MIG)
  const base = { entry: gray, slug: GRAY, hasDraft: false, hasBrief: true, briefSha256: sha(GRAY_BRIEF) }
  const fpA = `sha256:${'a1'.repeat(32)}`
  const fpB = `sha256:${'b2'.repeat(32)}`
  const judged = [fpA, fpB, MIG.messageFingerprint].map((fp) => LR.judgeLegacyInvalid({ ...base, messageFingerprint: fp }).ok)
  check('🔴 G 임의 지문 A/B 는 거부 · 기대 지문 하나만 통과', judged.join(',') === 'false,false,true', judged)
  const g = LR.judgeLegacyInvalid({ ...base, messageFingerprint: MIG.messageFingerprint })
  check('G gray 운영 사건 — 실제 위반 문장 그대로 · migration id', g.ok && g.violations[0].code === 'FORMAT_VIOLATION' && g.violations[0].why === '1행: YAML frontmatter 가 없다. --- 로 시작해야 한다' && g.migrationId === MIG.id, g)
  for (const [k, e2, f2] of [
    ['brief 한 글자 변경', {}, { briefSha256: sha(`${GRAY_BRIEF} `) }], ['다른 slug (같은 행·brief·지문)', {}, { slug: 'autumn-low-mood' }],
    ['다른 과거 CONTENT 행 (다른 시각)', { lastAt: gray.lastAt + 1 }], ['다른 과거 CONTENT 행 (다른 사유 문장)', { reasons: [gray.reasons[0].replace('1행', '2행')] }],
    ['markers_missing (위반 문장 없음)', { reasons: ['FETCH_FAILED: 회수 실패 — [validate] markers_missing (지정 문장 2개 누락) · 전송 1건'] }],
    ['전송 예약 남음 (신원 미확인)', { delivery: { kind: 'DELIVERY_UNCERTAIN' } }], ['보냈는지 모름', { sent: null }], ['2회 실패', { attempts: 2 }],
    ['재생성 기록', { regenCalls: 1 }], ['사유 2개', { reasons: [gray.reasons[0], 'x'] }], ['이미 기록 (migration 한 번)', { firstResponseInvalid: { x: 1 } }],
    ['원고 있음', {}, { hasDraft: true }], ['지문 모름', {}, { messageFingerprint: null }],
  ]) {
    check(`G gray 대조 거부 — ${k}`, !LR.judgeLegacyInvalid({ ...base, messageFingerprint: MIG.messageFingerprint, entry: { ...gray, ...e2 }, ...(f2 ?? {}) }).ok)
  }
  // 실제 관문 · 실제 대조 — 같은 brief 바이트로 같은 일반 요청 지문이 나온다
  const GD = path.join(T, 'g-gate', 'drafts', 'magazine')
  fs.mkdirSync(path.join(GD, GRAY), { recursive: true })
  fs.writeFileSync(path.join(GD, GRAY, 'brief.md'), GRAY_BRIEF)
  const LG = ledger('g-gate', { [GRAY]: gray })
  const gate = DG.deliveryGate({ slug: GRAY, draftsDir: GD, quarantinePath: LG })
  check('🔴 G 실제 일반 요청 지문 = migration 의 기대 지문 · 관문이 교정 대기로 닫힌다 (판정만 · 쓰기 0)',
    gate.messageFingerprint === MIG.messageFingerprint && gate.correctionPending?.source === 'legacy-ledger-reason' && !gate.hold, { fp: gate.messageFingerprint, cp: gate.correctionPending })
  // brief 한 글자 → 새 요청 — 대조 0 · 관문 열림(일반 요청은 새 메시지)
  const GD2 = path.join(T, 'g-gate2', 'drafts', 'magazine')
  fs.mkdirSync(path.join(GD2, GRAY), { recursive: true })
  fs.writeFileSync(path.join(GD2, GRAY, 'brief.md'), GRAY_BRIEF.replace('흰머리', '흰 머리'))
  const LG2 = ledger('g-gate2', { [GRAY]: gray })
  const b2 = fs.readFileSync(LG2)
  const gate2 = DG.deliveryGate({ slug: GRAY, draftsDir: GD2, quarantinePath: LG2 })
  const r0 = LR.reconcileLegacyInvalid({ draftsDir: GD2, slug: GRAY, messageFingerprint: gate2.messageFingerprint, path: LG2 })
  check('🔴 G brief 한 글자 변경 → 지문 다름 · 교정 대기 0 · NOT_RECONCILED · 장부 쓰기 0', GRAY_BRIEF.includes('흰머리') && gate2.messageFingerprint !== MIG.messageFingerprint && !gate2.correctionPending &&
    r0.status === 'NOT_RECONCILED' && fs.readFileSync(LG2).equals(b2), { r0 })
  // 다른 slug 에 같은 행 — 대조하지 않는다 (장부도 읽지 않는다)
  const LG3 = ledger('g-other', { 'autumn-low-mood': gray })
  const b3 = fs.readFileSync(LG3)
  const r3 = LR.reconcileLegacyInvalid({ draftsDir: GD, slug: 'autumn-low-mood', messageFingerprint: MIG.messageFingerprint, path: LG3 })
  check('G 다른 slug 의 같은 모양 행 → NOT_RECONCILED · 쓰기 0', r3.status === 'NOT_RECONCILED' && fs.readFileSync(LG3).equals(b3), r3)
  // 성공은 정확히 한 번 · 재실행은 쓰기 0
  const r1 = LR.reconcileLegacyInvalid({ draftsDir: GD, slug: GRAY, messageFingerprint: gate.messageFingerprint, path: LG })
  const after1 = fs.readFileSync(LG)
  const r2 = LR.reconcileLegacyInvalid({ draftsDir: GD, slug: GRAY, messageFingerprint: gate.messageFingerprint, path: LG })
  const fr = row(LG, GRAY).firstResponseInvalid
  check('🔴 G migration 은 한 번만 기록 — 위반 {code, why} · 기대 지문 · migration id · 재실행 NOT_RECONCILED · 장부 바이트 그대로', r1.status === 'RECORDED' && r2.status === 'NOT_RECONCILED' &&
    fs.readFileSync(LG).equals(after1) && fr.messageFingerprint === MIG.messageFingerprint && fr.migrationId === MIG.id && fr.violations[0].why.includes('YAML frontmatter') &&
    fr.source === 'LEGACY_LEDGER_REASON' && Q.identifiedInvalidRecord(fr) && DG.deliveryGate({ slug: GRAY, draftsDir: GD, quarantinePath: LG }).correctionPending?.source === 'ledger', { r1, r2, fr })
  check('G migration id 없는 옛 대조 기록은 교정 근거가 아니다', !Q.identifiedInvalidRecord({ ...fr, migrationId: undefined }))
}

// ── H 운영 writer 의 큐 잠금 위치 — 고정 하나 ─────────────────────────
console.log('\nH 운영 큐 잠금 — 운영 writer 두 개가 서로 다른 임시 위치를 주입해도 분리된 잠금을 얻지 못한다 (실제 자식 프로세스)')
{
  const QLURL = pathToFileURL(path.join(HERE, 'lib', 'magazine-queue-lock.mjs')).href
  const writer = (name, dir) => {
    const child = path.join(T, `h-${name}.mjs`)
    fs.writeFileSync(child, `const QL = await import(${JSON.stringify(QLURL)})
let ran = 0
const r = QL.withQueueWriteLock('/x/topic-queue.ts', () => { ran++; const t = Date.now() + 300; while (Date.now() < t) {} }, { waitMs: 0 })
console.log(JSON.stringify({ ok: r.ok, code: r.code ?? null, ran }))
`)
    // 🔴 운영 모드 (TEST_MODE 없음) · HOME 은 임시 — 가드를 지운 변이에서도 운영 queue-locks 에 닿지 않는다
    return spawn(process.execPath, [child], { env: { PATH: process.env.PATH, HOME: path.join(T, 'h-home'), SORAN_MAGAZINE_QUEUE_LOCK_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  const dA = fs.mkdtempSync(path.join(os.tmpdir(), 'h-lock-a-'))
  const dB = fs.mkdtempSync(path.join(os.tmpdir(), 'h-lock-b-'))
  fs.mkdirSync(path.join(T, 'h-home'), { recursive: true })
  const outOf = (c) => new Promise((res) => { let o = ''; c.stdout.on('data', (d) => { o += d }); c.on('close', () => { try { res(JSON.parse(o.trim().split('\n').pop())) } catch { res({ parseError: o }) } }) })
  const [a, b] = await Promise.all([outOf(writer('a', dA)), outOf(writer('b', dB))])
  const files = [...fs.readdirSync(dA), ...fs.readdirSync(dB)]
  check('🔴 H 운영 writer 두 개 — 각자 다른 임시 잠금 위치 주입 → 둘 다 파일 접근 전 거부 · 임계구역 0 · 주입 위치에 잠금 파일 0',
    a.ok === false && b.ok === false && a.code === 'queue_lock_scope_blocked' && b.code === 'queue_lock_scope_blocked' && a.ran === 0 && b.ran === 0 && files.length === 0, { a, b, files })
  const dirOf = (env) => { try { return QLm.queueLockDir(env) } catch (e) { return e.code } }
  check('H 운영 모드 잠금 위치는 고정 하나 — 주입 없으면 QUEUE_LOCK_DIR', dirOf({}) === QLm.QUEUE_LOCK_DIR)
  let seamBlocked = null
  // 저장소 위치와 무관한 임시 폴더 밖 경로 — 검사 사본이 임시 폴더 아래에 있어도 같은 판정 (경로 판정만 · 파일 0)
  try { QLm.setQueueLockDirForTest('/opt/soransoran-not-tmp-queue-locks') } catch (e) { seamBlocked = e.code }
  check('H 같은 프로세스 시험 주입도 임시 폴더만 받는다', seamBlocked === 'queue_lock_scope_blocked')
  fs.rmSync(dA, { recursive: true, force: true })
  fs.rmSync(dB, { recursive: true, force: true })
}

// ── I QA 재생성 패킷 — 검사가 본 위반을 빠짐없이 (2026-10-12 cold) ─────────────────
console.log('\nI QA 재생성 패킷 — 꼬리 3줄에 빠진 FAIL 줄 · 길이 목표 · 기존 재생성 HOLD 패킷 바이트 불변')
{
  const FXD = path.join(HERE, 'fixtures', 'magazine-format-contract')
  // 실제 QA 출력 원문 (2026-10-12 · 운영 runtime 원고의 읽기 전용 사본으로 실제 magazine-qa 를 돌린 결과)
  const OUT = JSON.parse(fs.readFileSync(path.join(FXD, 'qa-output-2026-10-12.json'), 'utf8'))
  const oldRows = (out) => [{ code: 'QA_FAIL', label: 'magazine QA FAIL', sentence: String(out).trim().split('\n').slice(-3).join(' ') },
    ...AR.qaFailLines(out).filter((x) => /^BODY_TOO_(LONG|SHORT):/.test(x)).map((x) => ({ code: 'BODY_LENGTH', label: x }))]
  const instr = (rows) => RG.buildFailurePacket({ slug: 'x', profile: 'MEDICAL', failures: rows, attempt: 1, attemptId: 'a' }).instruction
  const cold = OUT['cold-weather-joint-pain']
  check('🔴 I 수정 전 반례 — cold 의 앞판 패킷에 description 위반이 없다 (꼬리 3줄 = WARN · 빈 줄 · 요약)', !/description/.test(instr(oldRows(cold))) && /description 57자/.test(cold), instr(oldRows(cold)))
  const rows = AR.qaRegenRows(cold)
  check('🔴 I cold — 새 패킷에 description 57자 위반 줄이 실린다', rows.some((r) => r.code === 'QA_FAIL_ITEM' && r.label === 'description 57자 — 허용 60~160자 밖') && /description 57자 — 허용 60~160자 밖/.test(instr(rows)), rows)
  check('🔴 I cold — 발행 길이 줄에 목표치(최소 632자 줄인다 · 2800자 이하)와 검사기의 계산법', rows.some((r) => r.code === 'BODY_LENGTH' && r.label.startsWith('BODY_TOO_LONG: 본문 3432자') && r.label.includes('목표 2800자 이하') && r.label.includes('최소 632자를 줄인다') && r.label.includes('공백·줄바꿈 포함')), rows.find((r) => r.code === 'BODY_LENGTH'))
  check('I 첫 줄은 앞판과 바이트 그대로 (QA_FAIL · 꼬리 3줄)', JSON.stringify(rows[0]) === JSON.stringify(oldRows(cold)[0]))
  check('I 꼬리에 이미 실린 위반은 다시 싣지 않는다 · 길이 위반은 QA_FAIL_ITEM 이 아니라 BODY_LENGTH 하나', rows.filter((r) => /BODY_TOO_LONG/.test(r.label)).length === 1)
  for (const slug of ['how-much-talk-with-husband', 'retirement-prep-status']) {
    const o = OUT[slug]
    const n = AR.qaRegenRows(o)
    const pk = (r) => RG.buildFailurePacket({ slug, profile: 'STANDARD', failures: r, attempt: 1, attemptId: 'a' })
    check(`🔴 I 기존 재생성 HOLD ${slug} — 새 패킷 = 앞판 패킷 (줄 · 지시문 · 해시 바이트 그대로 → 전송 지문·HOLD 불변)`,
      JSON.stringify(n) === JSON.stringify(oldRows(o)) && pk(n).instruction === pk(oldRows(o)).instruction && RG.packetHashOf(pk(n)) === RG.packetHashOf(pk(oldRows(o))), n)
  }
  const short = AR.bodyLengthPacketLabel('BODY_TOO_SHORT: 본문 700자 — 800자 미만이면 잘린 응답으로 본다')
  check('I 짧은 원고 — 목표 1000자 이상 · 최소 300자 늘린다', short.includes('목표 1000자 이상') && short.includes('최소 300자를 늘린다'), short)
  // 실제 원고 사본 → 실제 변환 · 실제 QA — 캡처한 출력이 지어낸 것이 아님을 같은 바이트로 재현
  const M = path.join(T, 'i-mini')
  for (const rel of ['scripts', 'drafts/magazine/topic-queue.ts', 'drafts/magazine/_template', 'src/content/magazine', 'src/lib']) {
    const from = path.join(REPO, rel)
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(path.dirname(path.join(M, rel)), { recursive: true })
    fs.cpSync(from, path.join(M, rel), { recursive: true })
  }
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(M, 'node_modules'))
  const RQ = await import('./fixtures/magazine-format-contract/repair-queue-rows.mjs')
  const mq = path.join(M, 'drafts', 'magazine', 'topic-queue.ts')
  fs.writeFileSync(mq, RQ.withFixtureRows(fs.readFileSync(mq, 'utf8'), ['cold-weather-joint-pain']).src)
  const SD = path.join(M, 'drafts', 'magazine', 'cold-weather-joint-pain')
  fs.mkdirSync(SD, { recursive: true })
  fs.copyFileSync(path.join(FXD, 'cold-weather-joint-pain.regen-source-2026-10-12.draft.md'), path.join(SD, 'draft.md'))
  const env = { PATH: process.env.PATH, HOME: T, SORAN_MAGAZINE_TEST_MODE: '1' }
  const conv = spawnSync(process.execPath, [path.join(M, 'scripts', 'magazine-md-to-draft.mjs'), '--in', path.join(SD, 'draft.md'), '--out', path.join(SD, 'article-draft.ts')], { encoding: 'utf8', env, cwd: M })
  const qa = spawnSync(process.execPath, [path.join(M, 'scripts', 'magazine-qa.mjs'), '--draft', path.join(SD, 'article-draft.ts')], { encoding: 'utf8', env, cwd: M })
  check('🔴 I 실제 cold 원고 사본 → 실제 변환·QA — description 57자 · 본문 3432자 재현 (캡처 출력의 FAIL 줄과 같다)',
    conv.status === 0 && qa.status !== 0 && JSON.stringify(AR.qaFailLines(qa.stdout)) === JSON.stringify(AR.qaFailLines(cold)) && /description 57자/.test(qa.stdout) && /본문 3432자/.test(qa.stdout),
    { conv: conv.status, fails: AR.qaFailLines(qa.stdout) })
  // 지시받은 것만 고치는 응답(fixture) — 앞판 패킷은 description 을 그대로 두고 문단 하나만 덜어 같은 실패를 되풀이한다
  const C = await import('./lib/magazine-rehearsal-content.mjs')
  const draft = fs.readFileSync(path.join(SD, 'draft.md'), 'utf8')
  const msg = (rows) => DG.regenerationPromptText(RG.buildFailurePacket({ slug: 'cold-weather-joint-pain', profile: 'MEDICAL', failures: rows, attempt: 1, attemptId: 'a' }), draft)
  const descOf = (t) => (/^description: (.*)$/m.exec(t) ?? [])[1] ?? ''
  const before = C.obedientRevision(msg(oldRows(cold)))
  const after = C.obedientRevision(msg(rows))
  check('🔴 I 수정 전 계약 — 지시받은 것만 고치면 description 57자가 그대로 (10/12 관측과 같다)', [...descOf(before)].length === 57 && [...descOf(draft)].length === 57, descOf(before))
  const noDesc = (t) => t.replace(/^description: .*$/m, '')
  check('I 수정 후 계약 — description 이 60자 이상 · description 밖 원고가 목표(632자) 이상 줄었다', [...descOf(after)].length >= 60 && noDesc(draft).length - noDesc(after).length >= 632, { desc: [...descOf(after)].length, cut: noDesc(draft).length - noDesc(after).length })
}

check('운영 장부 기본 경로는 격리 HOME 아래', path.resolve(Q.QUARANTINE_PATH).startsWith(T + path.sep))
finish()
