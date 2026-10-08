#!/usr/bin/env node
/**
 * 원고 형식 계약 변이 시험 — 방어 하나를 지운 코드로 `magazine-format-contract-check.mjs` 를 다시 돌려
 * **검사가 FAIL 로 바뀌는지** 본다. 바꿀 문장이 파일에 정확히 한 번 있어야 한다 (없거나 여럿이면 변이 무효 = FAIL).
 *
 * 🔴 파일을 제자리에서 바꾸고 **매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인**한다.
 *    중간에 끊겨도(SIGINT·SIGTERM·예외) 되돌린다. 끝에 전 파일 해시가 시작과 같아야 PASS 다.
 * 🔴 검사 쪽에 실제 CDP 포트(9333/9344) 차단이 있다 — 변이가 주입을 무너뜨려도 운영 Chrome 에 닿지 않는다.
 *
 * 사용: node scripts/magazine-format-contract-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECK = path.join(HERE, 'magazine-format-contract-check.mjs')
const F = {
  session: path.join(HERE, 'lib', 'chatgpt-session.mjs'),
  gate: path.join(HERE, 'lib', 'magazine-delivery-gate.mjs'),
  policy: path.join(HERE, 'lib', 'magazine-brief-policy.mjs'),
  format: path.join(HERE, 'lib', 'magazine-manuscript-format.mjs'),
  guard: path.join(HERE, 'lib', 'magazine-manuscript-guard.mjs'),
  register: path.join(HERE, 'magazine-auto-register.mjs'),
  ready: path.join(HERE, 'magazine-auto-register-ready.mjs'),
  webui: path.join(HERE, 'magazine-webui-runner.mjs'),
}

const MUTATIONS = [
  { name: 'compose 원인 추출 제거', file: F.session,
    find: '    const errorCause = playwrightActionCause(err?.message)',
    replace: '    const errorCause = null' },
  { name: '전송 직전 brief 계약 제거', file: F.gate,
    find: '  if (!packet && !hold && message !== null) {',
    replace: '  if (false) {' },
  { name: 'HOLD 보다 계약을 먼저 본다 (이미 보낸 글 분류가 바뀐다)', file: F.gate,
    find: '  if (!packet && !hold && message !== null) {',
    replace: '  if (!packet && message !== null) {' },
  { name: '재생성에도 brief 계약을 건다 (clinic 회복 불가)', file: F.gate,
    find: '  if (!packet && !hold && message !== null) {',
    replace: '  if (!hold && message !== null) {' },
  { name: 'verifyBrief GF 무력화', file: F.policy,
    find: "  add('GF', contract.ok,",
    replace: "  add('GF', true," },
  { name: 'brief 계약 a — [CTA] 지시 검사 제거', file: F.format,
    find: "  const ctaLines = lines.map((l, i) => ({ text: l.trim(), line: i + 1 })).filter((x) => x.text.startsWith('[CTA]'))",
    replace: "  const ctaLines = [{ text: '[CTA] /community/free | 문구 | 앞 문장', line: 0 }]" },
  { name: 'brief 계약 b — 허용 표기 표 검사 제거', file: F.format,
    find: "  const notationTables = tables.filter((t) => t.includes('`[CTA]'))",
    replace: "  const notationTables = ['`## ` `> ` `- ` `[CTA]']" },
  { name: 'brief 계약 c — 금지 규칙 검사 제거', file: F.format,
    find: '  const missingTerms = BRIEF_FORBIDDEN_TERMS.filter(',
    replace: '  const missingTerms = [].filter(' },
  { name: '원고 관문 형식 판정 제거 (CTA 0 · 번호 목록 저장)', file: F.guard,
    find: "    for (const v of format.violations) fail('FORMAT_VIOLATION', describeFormatViolation(v))",
    replace: '    void describeFormatViolation' },
  { name: '저장된 draft 형식 판정 제거', file: F.register,
    find: "    let fmt = judgeManuscriptFormat(readFileSync(p.draftMd, 'utf8'))",
    replace: '    let fmt = { ok: true, violations: [] }' },
  { name: '형식 재생성 경로 제거', file: F.register,
    find: "      const rr = regenOnce('article', formatRegenFailures(fmt.violations), fmt.violations.map(describeFormatViolation))",
    replace: "      const rr = { ok: false, code: 'NO_REGEN', why: '재생성 없음' }" },
  { name: 'brief echo 원고도 재생성한다', file: F.register,
    find: "      if (echo.length) {\n        return stop('article', 'DRAFT_INVALID',",
    replace: "      if (false) {\n        return stop('article', 'DRAFT_INVALID'," },
  { name: '재생성 패킷에서 정확한 위반을 뺀다', file: F.register,
    find: "    ...(violations ?? []).slice(0, 8).map((v) => ({ code: 'MANUSCRIPT_FORMAT', label: describeFormatViolation(v) })),",
    replace: "    { code: 'MANUSCRIPT_FORMAT', label: '형식 위반' }," },
  { name: '실패 사유를 사람용 안내문으로 되돌린다', file: F.register,
    find: "  return `원고 형식 위반 ${violations?.length ?? 0}건 — ${rows.join(' / ')}${more}`",
    replace: "  void rows; void more\n  return 'ChatGPT 에게 brief 의 마크다운 규칙을 다시 지켜 달라고 요청한다.'" },
  { name: 'drive 결과의 구조화된 위반 제거', file: F.register,
    find: '    ...(lastFormatViolations.length ? { formatViolations: lastFormatViolations } : {}),',
    replace: '' },
  { name: '장부의 구조화된 위반 제거', file: F.ready,
    find: '            formatViolations: formatViolationsOf(r),',
    replace: '            formatViolations: undefined,' },
  { name: 'drive 앞단 계약 처리 제거 (회차 전체 정지로 오분류)', file: F.register,
    find: '    if (!g0.ok && g0.code === BRIEF_FORMAT_CONTRACT_REASON) {',
    replace: '    if (false) {' },
  { name: '일괄 회수 계획표가 계약을 무시한다 (probe·Chrome 기동)', file: F.webui,
    find: '    if (!g.ok && g.code === BRIEF_FORMAT_CONTRACT_REASON) contractBlocked.set(slug, g)',
    replace: '    void BRIEF_FORMAT_CONTRACT_REASON' },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.map((m) => m.file))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })

const occurrences = (s, sub) => s.split(sub).length - 1
const lineOf = (out) => (out.match(/원고 형식 계약 검사 \d+\/\d+/) ?? ['출력 없음'])[0]

let bad = 0
let caught = 0
console.log('\n원고 형식 계약 변이 시험\n')
const base = spawnSync(process.execPath, [CHECK], { encoding: 'utf8' })
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${lineOf(base.stdout)})`) } else console.log(`  기준선 (변이 없음) — PASS · ${lineOf(base.stdout)}`)
try {
  for (const mu of MUTATIONS) {
    const text = originals[mu.file].toString('utf8')
    const n = occurrences(text, mu.find)
    if (n !== 1) { bad++; console.log(`  ❌ ${mu.name} — ${path.basename(mu.file)} 에 바꿀 문장이 ${n}번 있다 (변이 무효)`); continue }
    fs.writeFileSync(mu.file, text.replace(mu.find, mu.replace))
    let r
    try { r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8' }) } finally { fs.writeFileSync(mu.file, originals[mu.file]) }
    if (sha(mu.file) !== startHashes[mu.file]) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    const failed = (r.stdout.match(/❌ [^\n]+/g) ?? [])
    const touchedReal = /실제 CDP 에 닿으려 했다/.test(r.stdout)
    if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어)`) } else {
      caught++
      console.log(`  ✅ ${mu.name} — 검사 FAIL (${lineOf(r.stdout)} · 실패 항목 ${failed.length}${touchedReal ? ' · 실제 CDP 시도는 차단됨' : ''})`)
    }
  }
} finally {
  restoreAll()
}
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${MUTATIONS.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
