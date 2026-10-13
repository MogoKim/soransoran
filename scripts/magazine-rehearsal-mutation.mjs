#!/usr/bin/env node
/**
 * 매거진 rehearsal 변이 시험 — 핵심 경계·단계를 지운 코드로 `magazine-rehearsal-check.mjs` 를 다시 돌려
 * **끝까지 실행된 뒤 단언이 FAIL 로 바뀌는지** 본다 (2026-10-10).
 *
 * 🔴 예외로만 멈춘 것은 잡은 것으로 세지 않는다 — 검사 요약 줄이 있어야 하고 ❌ 단언이 하나 이상이어야 한다.
 * 🔴 제자리에서 바꾸고 매 변이 뒤 원본 바이트로 되돌린 것을 해시로 확인한다 (rehearsal 은 작업 트리를 복사하므로
 *    변이가 임시 루트 안의 실제 래퍼·fixture·guard 에 그대로 들어간다).
 *
 * 사용: node scripts/magazine-rehearsal-mutation.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const CHECK = path.join(HERE, 'magazine-rehearsal-check.mjs')
const F = {
  guard: path.join(HERE, 'lib', 'magazine-rehearsal-guard.mjs'),
  scen: path.join(HERE, 'lib', 'magazine-rehearsal-scenarios.mjs'),
  sandbox: path.join(HERE, 'lib', 'magazine-rehearsal-sandbox.mjs'),
  bin: path.join(HERE, 'lib', 'magazine-rehearsal-bin.mjs'),
  orch: path.join(HERE, 'magazine-rehearsal.mjs'),
  merge: path.join(HERE, 'magazine-auto-merge.mjs'),
  quarantine: path.join(HERE, 'lib', 'magazine-quarantine.mjs'),
  hero: path.join(HERE, 'magazine-hero-runner.mjs'),
  webp: path.join(HERE, 'lib', 'magazine-hero-webp.mjs'),
  register: path.join(HERE, 'magazine-auto-register.mjs'),
  regen: path.join(HERE, 'lib', 'magazine-regen.mjs'),
  qa: path.join(HERE, 'magazine-qa.mjs'),
  repair: path.join(HERE, 'lib', 'magazine-input-repair.mjs'),
  webui: path.join(HERE, 'magazine-webui-runner.mjs'),
  ready: path.join(HERE, 'magazine-auto-register-ready.mjs'),
}
const MUTATIONS = [
  { name: '① guard 의 임시 루트 밖 쓰기 차단 제거', scenarios: 'S1', edits: [{ file: F.guard,
    find: 'function checkWrite(op, ...paths) {\n', replace: 'function checkWrite(op, ...paths) {\n  return\n' }] },
  { name: '② 네트워크(TCP)/CDP 차단 제거', scenarios: 'S1', edits: [{ file: F.guard,
    find: "    violate(Number(t.port) === 9333 || Number(t.port) === 9344 ? 'CDP_CONNECT' : 'NETWORK_CONNECT', t)\n", replace: '' }] },
  { name: '③ 실제 wrapper 대신 가짜 성공값', scenarios: 'S1', edits: [{ file: F.scen,
    find: '  const r = spawnSync(process.execPath, [join(sb.repo, \'scripts\', e.script), ...e.args], {',
    replace: '  const r = { status: 0, stdout: \'\', stderr: \'\' } || spawnSync(process.execPath, [join(sb.repo, \'scripts\', e.script), ...e.args], {' }] },
  { name: '④ producer 단계 생략', scenarios: 'S1', edits: [{ file: F.orch,
    find: "  stages.push(runStage(sb, { name: 'producer', entry: 'producer', kst: KST(date, '00:10') }))\n", replace: '' }] },
  { name: '⑤ auto-register 단계 생략', scenarios: 'S1', edits: [{ file: F.orch,
    find: "  stages.push(runStage(sb, { name: 'register', entry: 'register', kst: KST(date, '01:00') }))\n", replace: '' }] },
  { name: '⑥ exact-head 관문 제거 (--match-head-commit 없이 merge)', scenarios: 'S1', edits: [{ file: F.merge,
    find: "exec('gh', ['pr', 'merge', String(number), '--squash', '--match-head-commit', sha])", replace: "exec('gh', ['pr', 'merge', String(number), '--squash'])" }] },
  { name: '⑦ 02:00 recovery 단계 제거', scenarios: 'S4', edits: [{ file: F.orch,
    find: "  stages.push(runStage(sb, { name: 'recover', entry: 'recover', kst: KST(date, '02:00') }))\n", replace: '' }] },
  { name: '⑧ 공개 전 404 관문 제거 (예약 글이 바로 보인다)', scenarios: 'S6', edits: [{ file: F.bin,
    find: '    return L.parseArticlesSource(src).filter((a) => G.isPublic(a, Date.now()))', replace: '    void G\n    return L.parseArticlesSource(src)' }] },
  { name: '⑨ HOLD 후보를 다시 전송 (전송불명 HOLD 판정 제거)', scenarios: 'S3', edits: [{ file: F.quarantine,
    find: "  if (d.kind !== 'DELIVERY_UNCERTAIN') return null\n  return {", replace: "  if (true) return null\n  return {" }] },
  { name: '⑩ 잔여 lock/journal 검사 제거', scenarios: 'S1', edits: [{ file: F.scen,
    find: '  return [...new Set(hits)].sort()', replace: '  return []' }] },
  { name: '⑪ 결과 보고에서 실패 단계를 성공으로 기록', scenarios: 'S5', edits: [{ file: F.scen,
    find: 'kst, exit: r.status, signal', replace: 'kst, exit: 0, signal' }] },
  { name: '⑫ 고정 시각 대신 실제 시각', scenarios: 'S1', edits: [{ file: F.sandbox,
    find: '    SORAN_REHEARSAL_CLOCK: `${clock.fakeMs}:${clock.realMs}:${clock.speed}`,\n', replace: '' }] },
  // ── hero 신규 생성 (2026-10-10 · 선택지 B) ──
  { name: '⑬ S1 에 placeHero 사전 복사를 되살림 (재사용 우회)', scenarios: 'S1', edits: [{ file: F.orch,
    // S9 prepare 도 같은 세 줄이다 — S1 의 scenario 줄까지 묶어 S1 하나만 고른다
    find: '      await curate({ repo, keep: [t.slug] })\n      return { target: t.slug }\n    },\n    scenario: { ci: {}, deploy: {} },\n',
    replace: '      await curate({ repo, keep: [t.slug] })\n      placeHero({ repo, slug: t.slug })\n      return { target: t.slug }\n    },\n    scenario: { ci: {}, deploy: {} },\n' }] },
  { name: '⑭ 신규 이미지 생성 호출 생략 (기존 hero 를 생성 결과로)', scenarios: 'S1', edits: [{ file: F.hero,
    find: '  const gen = await generate(prompt)\n',
    replace: "  const gen = { ok: true, buffer: readFileSync(new URL('../public/magazine/avoiding-gatherings/hero.webp', import.meta.url)) }\n" }] },
  { name: '⑮ sharp 변환을 가짜 WebP 복사로', scenarios: 'S1', edits: [{ file: F.webp,
    find: "    const buffer = await sharp(input)\n      .resize(HERO_WIDTH, HERO_HEIGHT, { fit: 'fill' })\n      .webp({ quality: WEBP_QUALITY })\n      .toBuffer()\n",
    replace: "    const buffer = (await import('node:fs')).readFileSync(new URL('../../public/magazine/avoiding-gatherings/hero.webp', import.meta.url))\n" }] },
  { name: '⑯ 운영 모드 fixture 차단 제거', scenarios: 'S1', edits: [{ file: F.hero,
    find: '  if (!harness.ok) {\n', replace: '  if (false) {\n' }] },
  // ── S7 QA 재생성 ──
  { name: '⑰ QA 재생성 경로 제거', scenarios: 'S7', edits: [{ file: F.register,
    find: "      const rr = regenOnce('qa', qaRegenRows(r.stdout || r.stderr), lastQaFailures)",
    replace: "      const rr = { ok: false, code: 'MUTATED' } || regenOnce('qa', qaRegenRows(r.stdout || r.stderr), lastQaFailures)" }] },
  { name: '⑱ 실패 패킷에서 실제 QA 사유 제거', scenarios: 'S7', edits: [{ file: F.regen,
    find: "    code: f.code, label: f.label ?? f.message ?? '', sentence: String(f.sentence ?? '').slice(0, 160),",
    replace: "    code: f.code, label: f.label ?? f.message ?? '', sentence: ''," }] },
  // ── 2026-10-11 자연 회차 결함 (A·B·C) ──
  { name: '⑲ 최초 응답 교정 경로 제거 (gray — 형식 실패에서 멈춤)', scenarios: 'S8', edits: [{ file: F.register,
    find: "          correctFrom = { ...row, source: 'fetch' }", replace: "          correctFrom = null" }] },
  { name: '⑳ 장부의 최초 응답 기록 무시 (같은 일반 요청 재전송)', scenarios: 'S10', edits: [{ file: F.register,
    find: '    const priorInvalid = firstResponseInvalidFor(entryNow, g0.messageFingerprint)', replace: '    const priorInvalid = null' }] },
  { name: '㉑ QA 의 발행 길이 FAIL 제거 (autumn — hero 뒤 batch 에서 막힘)', scenarios: 'S9', edits: [{ file: F.qa,
    find: '  if (!body.hard.ok) report.fail(', replace: '  if (false) report.fail(' }] },
  { name: '㉒ 입력 수리 교체가 새 계보를 열지 않음 (cold — 옛 예산을 이어받음)', scenarios: 'S2', edits: [{ file: F.repair,
    find: '    const lineage = completePendingLineage({ draftsDir, slug: t.slug, path: quarantinePath })', replace: "    const lineage = { ok: true, status: 'OPENED' }" }] },
  { name: '㉓ 신원·정산 없는 응답도 교정 (fail-closed 제거 — 신원 확인과 정산 확인 둘 다)', scenarios: 'S8B', edits: [{ file: F.register,
    find: '    && Boolean(row?.conversationUrl && row?.assistantMessageId)\n', replace: '' }, { file: F.register, find: '    && row?.settled === true\n', replace: '' }] },
  // ── 2026-10-11 재검토 — 정산 원자화 · 운영 후 상태 대조 · producer 재전송 0 ──
  { name: '㉔ runner 가 결말 없이 예약만 푼다 (앞판 release — 장부에 교정 근거 없음)', scenarios: 'S10', edits: [{ file: F.webui,
    find: '        const st = settleDeliveryReservation({ slug, reservationId, outcome, path: quarantinePath })', replace: '        const st = settleDeliveryReservation({ slug, reservationId, outcome: null, path: quarantinePath })' }] },
  { name: '㉕ producer 일괄 계획이 교정 대기를 보지 않음 (00:10 gray 가 fetch 로 잡혀 접근 확인을 깨운다)', scenarios: 'S12', edits: [{ file: F.webui,
    find: '    if (fetchSet.has(t.slug) && correctionPending.has(t.slug)) {', replace: '    if (false) {' }] },
  { name: '㉖ auto-register 가 옛 장부 사유를 대조하지 않음 (gray — 교정 근거 없음)', scenarios: 'S12', edits: [{ file: F.register,
    find: '    if (!firstResponseInvalidFor(entryNow, g0.messageFingerprint)) {', replace: '    if (false) {' }] },
  { name: '㉗ auto-register 가 옛 입력 수리 영수증을 대조하지 않음 (cold·autumn — REGEN_EXHAUSTED)', scenarios: 'S11', edits: [{ file: F.register,
    find: "      const legacy = pend.status === 'NONE' ? reconcileLegacyInputRepair({ draftsDir: dd, slug, ...qp }) : null", replace: '      const legacy = null' }] },
  { name: '㉘ 단건 회수 관문이 교정 대기를 보지 않음 (01:00 일반 재전송)', scenarios: 'S12', edits: [
    { file: F.webui, find: '  if (gate.correctionPending) {\n    if (!quiet)', replace: '  if (false) {\n    if (!quiet)' },
    { file: F.register, find: '    if (!firstResponseInvalidFor(entryNow, g0.messageFingerprint)) {', replace: '    if (false) {' }] },
  // ── 2026-10-12 — 반례 큐 행은 고정 fixture (runtime 큐에서 gray 가 등록돼 빠져도 같은 시나리오) ──
  { name: '㉙ S12 가 fixture 큐 행을 넣지 않는다 (runtime 큐 상태에 묶임)', scenarios: 'S12', edits: [{ file: F.orch,
    // S14 공통 준비에도 같은 줄이 있다 — S12 의 다음 줄(등록된 gray 처리)까지 묶어 S12 하나만 고른다
    find: "      writeFileSync(qPath, RQ.withFixtureRows(qsrc, [slug]).src)\n      // 🔴 gray 가 이미 등록된 runtime", replace: '      writeFileSync(qPath, qsrc)\n      // 🔴 gray 가 이미 등록된 runtime' }] },
  // ── 2026-10-12 cold — QA 재생성 패킷이 검사가 본 위반을 빠짐없이 · 길이 목표 ──
  { name: '㉚ QA 재생성 패킷을 앞판 구성으로 (꼬리 3줄 + 목표 없는 길이 줄 — description 위반 누락)', scenarios: 'S13', edits: [{ file: F.register,
    find: "      const rr = regenOnce('qa', qaRegenRows(r.stdout || r.stderr), lastQaFailures)",
    replace: "      const rr = regenOnce('qa', [{ code: 'QA_FAIL', label: 'magazine QA FAIL', sentence: (r.stdout || r.stderr).trim().split('\\n').slice(-3).join(' ') }, ...lastQaFailures.filter((x) => /^BODY_TOO_(LONG|SHORT):/.test(x)).map((x) => ({ code: 'BODY_LENGTH', label: x }))], lastQaFailures)" }] },
  { name: '㉛ 발행 길이 줄에서 목표치·계산법 제거', scenarios: 'S13', edits: [{ file: F.register,
    find: "  if (!m) return line\n", replace: "  if (!m || true) return line\n" }] },
  // ── 2026-10-12 #690 뒤 — 등록돼 추적된 원고·articles 항목이 있어도 시나리오는 같다 (sandbox 사본에서만) ──
  { name: '㉜ S2 역할 글 원고를 sandbox 기준 커밋에서 미추적으로 두지 않는다 (추적 원고 → DIRTY_TREE)', scenarios: 'S2', edits: [{ file: F.sandbox,
    find: "  for (const f of prepared?.untrack ?? []) git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', f], repo, { allowFail: true })\n", replace: '' }] },
  { name: '㉝ S12 가 sandbox articles.ts 에서 이미 등록된 gray 항목을 빼지 않는다 (producer 가 등록 글로 건너뜀)', scenarios: 'S12', edits: [{ file: F.orch,
    find: "      if (at >= 0) {\n        const end = asrc.indexOf", replace: "      if (false) {\n        const end = asrc.indexOf" }] },
  // ── 2026-10-12 cold 1회성 복구 — 운영 경로 연결 ──
  { name: '㉞ ready 가 후보 판정 전에 1회성 복구를 열지 않는다 (cold 그대로 격리)', scenarios: 'S14', edits: [{ file: F.ready,
    find: "    ? openOneTimeRecoveries({ draftsDir: DRAFTS_DIR, ...(quarantinePath ? { path: quarantinePath } : {}) })", replace: '    ? []' }] },
  { name: '㉟ 재생성이 예산을 slug 없이 판정 (복구 계보를 못 보고 소진)', scenarios: 'S14', edits: [{ file: F.regen,
    find: '  const budget = regenBudget({ entry, slug })', replace: '  const budget = regenBudget({ entry })' }] },
  // ── 2026-10-13 S14 격리 — runtime 에 cold 가 등록돼도 같은 과거 사건 ──
  { name: '㊱ S14·S14B article registry 격리 제거 (runtime 사본 그대로)', scenarios: 'S14,S14B', edits: [{ file: F.orch,
    find: '      const iso = withoutArticle(asrc, slug, parse)\n', replace: '      const iso = { next: asrc, removed: false }\n' }] },
  { name: '㊲ 격리가 지정 slug 가 아니라 첫 글을 지운다', scenarios: 'S14', edits: [{ file: F.orch,
    find: "  const at = src.indexOf(`\\n  '${slug}': {\\n`)", replace: "  const at = src.indexOf(\"\\n  '\")" }] },
  { name: '㊳ 격리가 지정 글부터 끝까지 여러 글을 지운다', scenarios: 'S14', edits: [{ file: F.orch,
    find: "  const end = src.indexOf('\\n  },\\n', at + 1)", replace: "  const end = src.lastIndexOf('\\n  },\\n')" }] },
  { name: '㊴ 격리 뒤 다른 article 변화 검증 제거', scenarios: 'S14', edits: [{ file: F.orch,
    find: '  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(', replace: '  if (false) throw new Error(' }] },
]

const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const originals = Object.fromEntries(files.map((f) => [f, fs.readFileSync(f)]))
const startHashes = Object.fromEntries(files.map((f) => [f, sha(f)]))
const restoreAll = () => { for (const f of files) fs.writeFileSync(f, originals[f]) }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130) })
process.on('uncaughtException', (e) => { restoreAll(); console.error(e); process.exit(1) })
const occurrences = (s, sub) => s.split(sub).length - 1
const summary = (out) => (out.match(/리허설 검사 \d+\/\d+/g) ?? [null]).pop()

let bad = 0
let caught = 0
/** `--only ㉓,㉕` — 고친 변이만 다시 본다 (개발용 · 🔴 판정은 언제나 전체 실행으로) */
const only = process.argv.includes('--only') ? String(process.argv[process.argv.indexOf('--only') + 1] ?? '').split(',').filter(Boolean) : null
const RUN = only ? MUTATIONS.filter((m) => only.some((o) => m.name.startsWith(o))) : MUTATIONS
console.log(`\n매거진 rehearsal 변이 시험${only ? ` (일부만: ${only.join(',')} — 판정용 아님)` : ''}\n`)
const base = spawnSync(process.execPath, [CHECK, '--scenario', only ? [...new Set(RUN.flatMap((m) => m.scenarios.split(',')))].join(',') : 'S1,S2,S3,S4,S5,S6,S7,S8,S8B,S9,S10,S11,S12,S13,S14,S14U,S14B'], { encoding: 'utf8', cwd: ROOT, timeout: 60 * 60 * 1000 })
/** 🔴 변이 시험이 만든 rehearsal 산출물(임시 루트·보고서)은 남기지 않는다 */
const cleanup = (stdout) => {
  for (const m of stdout.matchAll(/(?:보존|보고서|실패 증거\(임시 루트 보존\)): (\S+)/g)) {
    const p = path.dirname(m[1])
    if (p.startsWith(path.resolve(os.tmpdir())) || p.startsWith('/private/var/folders/') || p.startsWith('/var/folders/')) fs.rmSync(p, { recursive: true, force: true })
  }
}
cleanup(base.stdout)
if (base.status !== 0) { bad++; console.log(`  ❌ 변이 없는 코드에서 검사가 FAIL 이다 (${summary(base.stdout) ?? '요약 없음'})`) } else console.log(`  기준선 (변이 없음) — PASS · ${summary(base.stdout)}`)
try {
  for (const mu of RUN) {
    const invalid = mu.edits.find((e) => occurrences(originals[e.file].toString('utf8'), e.find) !== 1)
    if (invalid) { bad++; console.log(`  ❌ ${mu.name} — ${path.basename(invalid.file)} 에 바꿀 문장이 ${occurrences(originals[invalid.file].toString('utf8'), invalid.find)}번 있다 (변이 무효)`); continue }
    const mutated = {}
    for (const e of mu.edits) mutated[e.file] = (mutated[e.file] ?? originals[e.file].toString('utf8')).replace(e.find, e.replace)
    let r
    try {
      for (const [f, text] of Object.entries(mutated)) fs.writeFileSync(f, text)
      r = spawnSync(process.execPath, [CHECK, '--scenario', mu.scenarios], { encoding: 'utf8', cwd: ROOT, timeout: 60 * 60 * 1000 })
    } finally { restoreAll() }
    if (files.some((f) => sha(f) !== startHashes[f])) { bad++; console.log(`  ❌ ${mu.name} — 원복 후 해시가 다르다`); break }
    // 🔴 변이 회차가 남긴 실패 증거(임시 루트·보고서)는 변이 시험의 산출물이 아니다 — 지운다
    cleanup(r.stdout)
    const s = summary(r.stdout)
    const failed = (r.stdout.match(/❌ [^\n]+/g) ?? []).filter((l) => !/│/.test(l))
    if (!s) { bad++; console.log(`  ❌ ${mu.name} — 검사가 끝까지 돌지 않았다 (예외로만 멈춤 · 종료 ${r.status} ${r.signal ?? ''})`) }
    else if (r.status === 0) { bad++; console.log(`  ❌ ${mu.name} — 검사가 여전히 PASS 다 (죽은 방어) · ${s}`) }
    else if (failed.length === 0) { bad++; console.log(`  ❌ ${mu.name} — FAIL 인데 단언 실패가 없다 · ${s}`) }
    else { caught++; console.log(`  ✅ ${mu.name} — FAIL (${s} · 실패 단언 ${failed.length} · 예: ${failed[0].slice(4, 90)})`) }
  }
} finally { restoreAll() }
const drift = files.filter((f) => sha(f) !== startHashes[f])
if (drift.length) { bad++; console.log(`  ❌ 끝난 뒤 원본과 다른 파일: ${drift.map((f) => path.basename(f)).join(', ')}`) } else console.log('\n  원복 확인 — 변이 대상 파일 전부 시작 해시와 같다')
console.log(`\n${bad ? '🔴' : '✅'} 변이 ${RUN.length}건 중 검사가 잡은 것 ${caught}건\n`)
process.exitCode = bad ? 1 : 0
