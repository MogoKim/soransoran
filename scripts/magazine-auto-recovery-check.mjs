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
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
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
console.log('\nA 최초 응답 형식 실패 — 교정 판정 · 증거 · 실패 목록')
{
  const good = { sent: true, stage: 'validate', reason: 'invalid_manuscript', conversationUrl: 'https://chatgpt.com/c/x', assistantMessageId: 'm1', responseSha256: SHA,
    invalid: [{ code: 'NO_FRONTMATTER', why: 'YAML frontmatter 가 없다' }], length: 3100, responseExcerpt: '머리말 '.repeat(80), responseForm: 'code-block' }
  check('A 식별된 invalid_manuscript (sent·validate·대화·메시지·sha) → 교정 가능', AR.correctableFirstResponse(good))
  check('A markers_missing 도 교정 가능', AR.correctableFirstResponse({ ...good, reason: 'markers_missing' }))
  for (const [k, v] of [['sent=null', { sent: null }], ['sent=false', { sent: false }], ['대화 없음', { conversationUrl: null }], ['메시지 없음', { assistantMessageId: null }],
    ['sha 없음', { responseSha256: null }], ['stage≠validate', { stage: 'await-response' }], ['다른 사유', { reason: 'response_timeout' }]]) {
    check(`A ${k} → 교정 0 (fail-closed)`, !AR.correctableFirstResponse({ ...good, ...v }))
  }
  const ev = AR.firstResponseEvidence(good)
  check('A 증거 — reason·stage·sent·invalid·responseForm·대화·메시지·sha256·길이', ev.reason === 'invalid_manuscript' && ev.stage === 'validate' && ev.sent === true && ev.invalid[0].code === 'NO_FRONTMATTER' &&
    ev.responseForm === 'code-block' && ev.conversationUrl && ev.assistantMessageId === 'm1' && ev.responseSha256 === SHA && ev.length === 3100)
  check('A 증거 — 앞부분은 200자 이하 · 원문 칸 없음', ev.responseExcerpt.length <= 200 && !('text' in ev) && !('body' in ev))
  const re = S.responseEvidence(`머리말 https://x.example/a 와 me@x.com 은 지운다\u0007\n\n---\ntitle: 제목\n${'가'.repeat(500)}`)
  check('A 응답 증거 — sha256 · 길이 · URL·메일·제어문자 제거 · 200자', /^[0-9a-f]{64}$/.test(re.responseSha256) && re.length > 500 && re.responseExcerpt.length <= 200 &&
    !/https?:|@x\.com|\u0007/.test(re.responseExcerpt) && re.responseExcerpt.includes('[URL]'), re.responseExcerpt.slice(0, 80))
  const f = AR.firstResponseRegenFailures(good)
  check('A 교정 실패 목록 — 실제 위반 + frontmatter 규칙', f.some((x) => x.code === 'FIRST_RESPONSE_INVALID' && x.label.includes('NO_FRONTMATTER')) && f.some((x) => x.code === 'MANUSCRIPT_FORMAT_RULE' && x.label.includes('---')))
  // 교정 요청 문장 — 다른 지문 · 일반·QA 재생성 프롬프트 불변
  const pk = RG.buildFailurePacket({ slug: 'x', profile: 'STANDARD', failures: f, attempt: 1, attemptId: '00000000-0000-4000-8000-000000000000', source: 'FIRST_RESPONSE' })
  check('A 교정 패킷 source=FIRST_RESPONSE · 교정 문장은 [교정 요청] 으로 시작', pk.source === 'FIRST_RESPONSE' && DG.firstResponseCorrectionPromptText(pk).startsWith('[교정 요청]'))
  const h = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16)
  check('불변 — 일반 최초 요청 프롬프트 바이트', h(DG.legacyManuscriptPromptText(null)) === '5bb6e6ccb4bb9d3f', h(DG.legacyManuscriptPromptText(null)))
  const qaPk = RG.buildFailurePacket({ slug: 'x', profile: 'STANDARD', failures: [{ code: 'QA_FAIL', label: 'magazine QA FAIL', sentence: 's' }], attempt: 1, attemptId: 'a' })
  check('불변 — QA 재생성 지시문 바이트 · source 없음', h(qaPk.instruction) === 'aeea1a85dce887b0' && !('source' in qaPk), h(qaPk.instruction))
  // 증거 기록 — 장부에는 앞부분을 싣지 않는다
  const LF = ledger('a-first')
  Q.recordFirstResponseInvalid({ slug: 's', path: LF, evidence: { ...good, messageFingerprint: 'sha256:m', invalidCodes: ['NO_FRONTMATTER'] } })
  const e = row(LF)
  check('A 장부 — 최초 응답 기록에 지문·대화·메시지·sha·길이·코드만 (앞부분 없음)', e.firstResponseInvalid.responseSha256 === SHA && !('responseExcerpt' in e.firstResponseInvalid) && !JSON.stringify(e).includes('머리말'))
  check('A 같은 일반 요청 지문 → 교정 대상으로 찾는다 · 다른 지문(brief 변경)이면 아니다',
    Boolean(Q.firstResponseInvalidFor(e, 'sha256:m')) && !Q.firstResponseInvalidFor(e, 'sha256:other'))
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
  check('C 입력 수리 원자 교체 → 새 계보 · 계보 2회 남음 · 전체 2 보존 · attempts 불변', o1.opened && e1.regenLineage.origin === 'INPUT_REPAIR' && b1.left === 2 && e1.regenCalls === 2 && e1.attempts === 1 && e1.inputRepairCalls === 1, { e1, b1 })
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

check('운영 장부 기본 경로는 격리 HOME 아래', path.resolve(Q.QUARANTINE_PATH).startsWith(T + path.sep))
finish()
