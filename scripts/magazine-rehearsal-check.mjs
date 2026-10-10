#!/usr/bin/env node
/**
 * 매거진 rehearsal 검사 — 실제 rehearsal 을 돌리고 **보고서의 원시 증거를 다시 판정한다** (2026-10-10).
 *
 * 🔴 orchestrator 의 ok·verdict 를 그대로 믿지 않는다. 단계 종료 코드 · 로그의 래퍼 표식 · 호출 기록 ·
 *    PR/merge/배포 · 경계 합계 · 반복성 · runtime 불변을 여기서 다시 센다. 그래서 "실패 단계를 성공으로 적는"
 *    결함이나 "래퍼 대신 가짜 성공값" 결함은 orchestrator 가 초록이라고 해도 여기서 FAIL 이다.
 *
 *   node scripts/magazine-rehearsal-check.mjs                     전체 (S1~S7 + S1 반복)
 *   node scripts/magazine-rehearsal-check.mjs --scenario S1,S4    고른 시나리오만 (변이 시험이 쓴다)
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { FIXTURE_HERO_SPEC } from './lib/magazine-rehearsal-content.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const pick = argv.includes('--scenario') ? argv[argv.indexOf('--scenario') + 1] : null
const ids = (pick ?? 'S1,S2,S3,S4,S5,S6,S7').split(',')
const repeat = !pick || argv.includes('--repeat')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`) }
}
const finish = () => { console.log(`\n${fail ? '🔴' : '✅'} 리허설 검사 ${pass}/${pass + fail}\n`); process.exitCode = fail ? 1 : 0 }

const work = mkdtempSync(join(tmpdir(), 'rehearsal-check-'))
const out = join(work, 'report.json')
console.log(`\n매거진 rehearsal 검사 — ${ids.join(',')}${repeat ? ' + S1 반복' : ''}\n`)
const r = spawnSync(process.execPath, [join(HERE, 'magazine-rehearsal.mjs'), '--scenario', ids.join(','), '--out', out, '--keep', ...(repeat ? [] : ['--no-repeat'])],
  { encoding: 'utf8', timeout: 90 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 })
process.stdout.write(r.stdout.split('\n').filter((l) => /✅|❌|REHEARSAL/.test(l)).map((l) => `  │ ${l}\n`).join(''))
const report = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null

check('rehearsal 이 보고서를 남겼다', Boolean(report), `${r.status} ${r.stderr.slice(-300)}`)
if (!report) { finish(); process.exit() }

const S = Object.fromEntries(report.scenarios.map((s) => [s.id, s]))
const stage = (s, name) => s?.stages.find((x) => x.name === name) ?? null
const logText = (s, name) => { const st = stage(s, name); try { return st && s.root ? readFileSync(join(s.root, st.log), 'utf8') : '' } catch { return '' } }
const BANNER = {
  producer: /매거진 producer 시작/,
  register: /매거진 자동 레인 시작/,
  recover: /자동 병합 복구 \(/,
  watch: /예약 공개 감시/,
}

// ── 판정의 정직성 — orchestrator 의 ok 를 다시 센다 ──
for (const s of report.scenarios) {
  const recomputed = s.checks.every((c) => c.ok)
  check(`${s.id} 보고된 ok 가 단언 결과와 같다`, s.ok === recomputed, { ok: s.ok, recomputed })
  check(`${s.id} 단언 전부 통과`, recomputed, s.checks.filter((c) => !c.ok).map((c) => c.id))
}
check('최종 verdict 가 시나리오·경계·runtime 결과와 같다',
  (report.verdict === 'REHEARSAL_PASS') === (report.ok && report.selfTest.ok && report.scenarios.every((s) => s.checks.every((c) => c.ok)) && report.runtime.unchanged),
  report.verdict)
check('verdict 는 REHEARSAL_PASS/FAIL 뿐 — OPERATING_PASS 를 쓰지 않는다', ['REHEARSAL_PASS', 'REHEARSAL_FAIL'].includes(report.verdict) && !/OPERATING_PASS/.test(report.verdict))

// ── 실제 엔트리포인트가 실제로 돌았다 (가짜 성공값이 아니다) ──
for (const s of report.scenarios) {
  for (const st of s.stages) {
    const text = logText(s, st.name)
    const want = BANNER[st.entry]
    check(`${s.id}/${st.name} — 실제 ${st.script} 가 돌았다 (로그 표식 · 실제 경과)`, Boolean(want?.test(text)) && st.realMs > 50 && typeof st.exit === 'number', { exit: st.exit, realMs: st.realMs, head: text.slice(0, 80) })
  }
}

// ── 경계 ──
check('경계 자체 시험 7/7 (쓰기·TCP·fetch·명령·시계·위반 기록·잔여물 검사기)', report.selfTest.ok && report.selfTest.checks.length === 7 && report.selfTest.checks.every((c) => c.ok), report.selfTest.checks.filter((c) => !c.ok))
for (const [k, v] of Object.entries(report.totals)) check(`합계 — ${k} 0`, v === 0, `${v}`)
check('운영 runtime 자료 불변 (해시 · HEAD · status)', report.runtime.unchanged && report.runtime.before.sha256 === report.runtime.after.sha256, report.runtime)
check('고정 시각 — 모든 단계가 지정한 KST 날짜의 run 디렉터리에 결과를 남겼다',
  report.scenarios.every((s) => !s.stages.some((st) => st.entry === 'producer') || Object.keys(s.evidence.runFiles ?? {}).includes(report.date)), report.scenarios.map((s) => [s.id, Object.keys(s.evidence.runFiles ?? {})]))

// ── 시나리오별 원시 증거 ──
const ev = (id) => S[id]?.evidence
if (S.S1) {
  const e = ev('S1')
  const t = S.S1.prepared.target
  check('S1 단계 — producer·register·recover·watch 순서와 종료 0', ['producer', 'register', 'recover', 'watch-after-publish'].every((n) => stage(S.S1, n)?.exit === 0), S.S1.stages.map((x) => `${x.name}:${x.exit}`))
  check('S1 전송 — 최초 1 · 재생성 0 · 수리 0', e.sends.initial === 1 && e.sends.regen === 0 && e.sends.repair === 0, e.sends)
  check('S1 PR 1 · merge 1 · --match-head-commit · 배포 1', e.prs.length === 1 && e.prs[0].state === 'MERGED' && e.mergeCalls.length === 1 && e.mergeCalls[0].args.includes('--match-head-commit') && e.deployments.length === 1, { prs: e.prs, merges: e.mergeCalls })
  check('S1 등록 = 대상 1건', e.registered.length === 1 && e.registered[0].slug === t, e.registered)
  check('S1 병합 직후 judgeDeploy 가 예약 404 를 확인했다', (S.S1.extras.apply?.deploy?.checked ?? []).some((c) => String(c).includes('404') && String(c).includes(t)) && S.S1.extras.apply?.deploy?.state === 'success', S.S1.extras.apply?.deploy)
  // 🔴 기대 hero 바이트를 여기서 따로 계산한다 — fixture PNG 를 운영 계약(1200×675 · fill · 품질 82)으로 sharp 변환. 운영 변환 모듈을 부르지 않는다
  const png = await sharp({ create: FIXTURE_HERO_SPEC }).png().toBuffer()
  const want = createHash('sha256').update(await sharp(png).resize(1200, 675, { fit: 'fill' }).webp({ quality: 82 }).toBuffer()).digest('hex')
  check('S1 hero 신규 생성 — 생성 경로 1 · 이미지 fixture 1 · 변환 1 · 재사용 0', e.hero.generate === 1 && e.hero.image === 1 && e.hero.convert === 1 && e.hero.reuse === 0, e.hero)
  check('S1 병합된 hero.webp = fixture PNG 의 실제 sharp 변환 바이트 (1200×675 · fill · q82)', e.registered[0]?.heroFile?.sha256 === want, { got: e.registered[0]?.heroFile?.sha256, want })
  check('S1 heroImage 4필드', e.registered[0]?.heroImage?.src === `/magazine/${t}/hero.webp` && e.registered[0]?.heroImage?.width === 1200 && e.registered[0]?.heroImage?.height === 675 && /여성$/.test(e.registered[0]?.heroImage?.alt ?? ''), e.registered[0]?.heroImage)
  check('S1 publishAt 뒤 watch 가 이 글을 확인했다', /✅/.test(logText(S.S1, 'watch-after-publish')) && logText(S.S1, 'watch-after-publish').includes(t))
}
if (S.S2) {
  const x = S.S2.extras
  const p = S.S2.prepared
  check('S2 producer 실제 종료 3 · handoff PARTIAL/3', stage(S.S2, 'producer')?.exit === 3 && x.handoff?.verdict === 'PARTIAL' && x.handoff?.code === 3, { exit: stage(S.S2, 'producer')?.exit, handoff: x.handoff?.verdict })
  check('S2 ENOTDIR·REPAIR_STAGE_FAILED 0 (로그)', !/ENOTDIR|REPAIR_STAGE_FAILED/.test(logText(S.S2, 'producer')))
  check('S2 급사 journal 복구 · gray·cold APPLIED · autumn 실패 · normal 최초 전송', (x.repair?.recovered ?? []).some((r) => r.slug === p.gray && r.rolledBack) &&
    (x.repair?.results ?? []).filter((r) => r.outcome === 'APPLIED').map((r) => r.slug).sort().join(',') === [p.gray, p.cold].sort().join(',') && ev('S2').sends.bySlug[`${p.normal}:initial`] === 1, x.repair)
}
if (S.S3) {
  const e = ev('S3')
  const p = S.S3.prepared
  check('S3 HOLD 전송 0 · 장부 행 불변 · held/attempted', !Object.keys(e.sends.bySlug).some((k) => k.startsWith(`${p.hold}:`)) && S.S3.extras.hold?.before === S.S3.extras.hold?.after && (S.S3.extras.register?.held ?? []).includes(p.hold) && S.S3.extras.register?.attempted === 1, { sends: e.sends.bySlug, register: S.S3.extras.register })
  check('S3 정상 글 완주 · 장부 손상 회차 전송 0', e.prs.length === 1 && e.prs[0].state === 'MERGED' && e.sends.initial === 1, { prs: e.prs, sends: e.sends })
}
if (S.S4) {
  const e = ev('S4')
  check('S4 01:00 병합 없음 → 02:00 --recover 병합 1 · --match-head-commit · PR 1 · 재전송 0', !S.S4.extras.apply?.merged && stage(S.S4, 'recover')?.exit === 0 && e.mergeCalls.length === 1 && e.mergeCalls[0].args.includes('--match-head-commit') && e.prs.length === 1 && e.sends.initial === 1 && e.sends.regen === 0, { apply: S.S4.extras.apply?.merged, merges: e.mergeCalls })
  check('S4 복구 결과 파일이 최초 결과와 분리돼 있다', (S.S4.extras.recovery ?? []).length === 1 && (e.runFiles[report.date] ?? []).some((f) => /^auto-merge-recovery-/.test(f)) && (e.runFiles[report.date] ?? []).includes('auto-merge.json'), e.runFiles[report.date])
}
if (S.S5) {
  const e = ev('S5')
  check('S5 merge 0 · 배포 0 · 01:00 회차 non-zero · CI 실패 이유', e.mergeCalls.length === 0 && e.deployments.length === 0 && stage(S.S5, 'register')?.exit !== 0 && /FAIL|failure/.test(JSON.stringify(S.S5.extras.apply?.blockedBy ?? '')), { merges: e.mergeCalls, exit: stage(S.S5, 'register')?.exit, why: S.S5.extras.apply?.blockedBy })
}
if (S.S7) {
  const e = ev('S7')
  const t = S.S7.prepared.target
  const typed = e.regenTyped.find((r) => r.slug === t)?.typed ?? ''
  const reg = logText(S.S7, 'register')
  check('S7 최초 1 · 재생성 1 · 최초 재전송 0', e.sends.bySlug[`${t}:initial`] === 1 && e.sends.bySlug[`${t}:regen`] === 1 && e.sends.initial === 1 && e.sends.regen === 1, e.sends.bySlug)
  check('S7 재생성 요청에 최초 QA 실패 사유 (medical 진료 권고) 가 실렸다', /\[QA_FAIL\][^\n]*진료 권고 문장/.test(typed), typed.split('\n').find((l) => l.includes('QA_FAIL')))
  check('S7 원자 교체 뒤 최종 QA PASS · 등록·PR·merge·배포 1', reg.includes('검증·변환 통과 뒤 원고 교체') && reg.includes('QA FAIL 0 (재생성 1회 뒤)') && e.registered.length === 1 && e.prs.length === 1 && e.prs[0].state === 'MERGED' && e.mergeCalls.length === 1 && e.deployments.length === 1, { prs: e.prs })
}
if (S.S6) {
  const x = S.S6.extras
  const t = S.S6.prepared.target
  check('S6 publishAt 전 404 · 목록·sitemap 누출 0 → 뒤 200 · 노출', x.site.before?.[`/magazine/${t}`]?.status === 404 && !x.site.before?.['/magazine']?.lists && !x.site.before?.['/sitemap.xml']?.lists &&
    x.site.after?.[`/magazine/${t}`]?.status === 200 && x.site.after?.['/magazine']?.lists && x.site.after?.['/sitemap.xml']?.lists, x.site)
}

// ── 반복성 ──
if (repeat) {
  check('반복성 — S1 두 번의 결정적 필드·판정이 같다', report.repeatability?.ok === true && JSON.stringify(report.repeatability.first) === JSON.stringify(report.repeatability.second), report.repeatability?.first?.checks?.length)
  check('반복성 — 비교에서 뺀 필드를 명시했다', Array.isArray(report.repeatability?.excluded) && report.repeatability.excluded.length > 0)
}

// 🔴 통과한 시나리오의 임시 루트는 남기지 않는다 · 실패한 시나리오만 증거로 보존한다 · 보고서(JSON 한 파일)는 남긴다
for (const s of report.scenarios) if (s.root && s.ok) rmSync(s.root, { recursive: true, force: true })
for (const s of report.scenarios) if (s.root) { try { const up = dirname(s.root); if (readdirSync(up).length === 0) rmSync(up, { recursive: true, force: true }) } catch { /* 없다 */ } }
console.log(`  보고서: ${out}`)
if (fail) console.log(`  실패 증거(임시 루트 보존): ${report.scenarios.filter((s) => !s.ok).map((s) => s.root).join(' · ') || '없음'}`)
finish()
