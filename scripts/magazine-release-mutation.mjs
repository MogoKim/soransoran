#!/usr/bin/env node
/**
 * Magazine vNext S3-P2 — release writer · merge gate · merge freeze 변이. 방어를 하나씩 되돌리면 `magazine-release-check` 가
 * 기대한 항목으로 실패해야 한다.
 *
 *   node scripts/magazine-release-mutation.mjs
 *
 * 🔴 저장소 파일을 고치지 않는다. 시작할 때 한 번 읽은 스냅샷을 임시 폴더에 쓰고, 사본 하나에 변이 하나를 심어 그 사본의 검사를 돌린다.
 * 🔴 무변이 사본이 먼저 0 fail 이어야 한다. 변이 지점이 정확히 1곳이 아니면 하네스 FAIL(검출로 세지 않는다).
 * 🔴 검출 = exit 1 + 기대 항목 줄 `FAIL <id> `. 요약 줄 없이 죽은 사본은 검출이 아니다.
 * 마지막 줄: `release 변이: <검출>/<변이 수> detected · <n> fail`
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CHECK = 'scripts/magazine-release-check.mjs'
const REL = 'scripts/lib/magazine-release.mjs'
const RUN = 'scripts/lib/magazine-release-run.mjs'
const JRN = 'scripts/lib/magazine-release-journal.mjs'
const FRZ = 'scripts/lib/magazine-merge-freeze.mjs'
const AM = 'scripts/magazine-auto-merge.mjs'

/** [id, 설명, 기대 항목, 편집[]] — 편집은 { file, from, to } (from 정확히 1곳) */
const MUTATIONS = [
  // freeze
  ['RM1', 'legacy 01:00 · 02:00 merge 앞 freeze 를 지운다', 'FZ2', [{ file: AM, from: '  if (freeze.frozen) return fail(freeze.code, freeze.message)\n', to: '' }]],
  ['RM2', 'vNext merge 앞 freeze 를 지운다', 'RE5', [{ file: RUN, from: "  if (freeze.frozen) { block(freeze.code, freeze.message); report.outcome = 'MERGE_FROZEN'; return }\n", to: '' }]],
  ['RM3', 'freeze 끝 시각을 포함한다(02:30 도 막는다)', 'FZ1', [{ file: FRZ, from: 'if (nowMs >= start && nowMs < end) {', to: 'if (nowMs >= start && nowMs <= end) {' }]],
  ['RM4', '시각 불명을 창 밖으로 본다', 'FZ1', [{ file: FRZ, from: "return { frozen: true, code: 'MERGE_FREEZE_CLOCK_INVALID'", to: "return { frozen: false, code: 'MERGE_FREEZE_CLOCK_INVALID'" }]],
  // PR 내용 관문
  ['RM5', 'gate 가 재컴파일 planHash 를 대조하지 않는다', 'RG2-PLAN_HASH_MISMATCH', [{ file: REL, from: '    if (rel.planHash !== plan.planHash || rel.bundleHash', to: '    if (false && rel.planHash !== plan.planHash || rel.bundleHash' }]],
  ['RM6', 'gate 가 ContentPlan 파일 바이트를 보지 않는다', 'RG2-PLAN_FILE_MISMATCH', [{ file: REL, from: '    if (planText !== renderPlanFile(plan)) block(', to: '    if (false) block(' }]],
  ['RM7', 'gate 가 merge 직전 admission 을 다시 돌지 않는다', 'RG2-ADMISSION_HELD', [{ file: REL, from: '  if (members.length === newSlugs.length && blockedBy.length === 0) {', to: '  if (false) {' }]],
  ['RM8', 'gate 가 ProviderPlan HOLD 를 보지 않는다', 'RG3', [{ file: REL, from: "      if (!pp.ok) block('PROVIDER_PLAN_HOLD',", to: "      if (false) block('PROVIDER_PLAN_HOLD'," }]],
  ['RM9', '조립이 ProviderPlan HOLD 를 보지 않는다', 'RA7', [{ file: REL, from: "    if (!pp.ok && ppCodes.join() !== 'NOT_ADMITTED') {", to: '    if (false) {' }]],
  ['RM10', 'gate 가 runtime 결속 파일을 보지 않는다', 'RG2-PUBLIC_BINDING_MISMATCH', [{ file: REL, from: '  if (M.bindingText !== renderBindingFile(main.binding)) {', to: '  if (false) {' }]],
  ['RM11', '조립이 후보 밖 plan 을 같은 release 대상으로 센다(고정점 없음)', 'RA2', [{ file: REL, from: '    adm = admitContentPlans({ ...admissionBase, withdrawnPlanIds: compiled.plans.map((p) => p.planId).filter((id) => !live.has(id)) })', to: '    adm = admitContentPlans({ ...admissionBase, withdrawnPlanIds: [] })' }]],
  ['RM12', '날짜를 층 순서가 아니라 planId 순으로 준다', 'RA1', [{ file: REL, from: '  const memberIds = [...live].sort((a, b) => admittedById.get(a).layer - admittedById.get(b).layer || byCodeUnit(a, b))', to: '  const memberIds = [...live].sort((a, b) => byCodeUnit(b, a))' }]],
  ['RM13', '기록된 slug 를 무시한다(stable slug 깨짐)', 'RA4', [{ file: REL, from: '  if (recorded !== null && recorded !== undefined) {', to: '  if (false) {' }]],
  ['RM14', '이미 쓰인 slug 를 막지 않는다', 'RA4', [{ file: REL, from: "    if (takenBy.has(bound.slug)) { addReason(c.planId, 'SLUG_TAKEN', takenBy.get(bound.slug)); continue }\n", to: '' }]],
  ['RM15', 'gate 가 기존 글 변경을 막지 않는다', 'RG2-EXISTING_ARTICLE_TOUCHED', [{ file: REL, from: '  if (touched.length) {', to: '  if (false) {' }]],
  ['RM16', 'gate 가 허용 밖 파일을 막지 않는다', 'RG2-UNEXPECTED_FILES', [{ file: REL, from: "  if (unexpected.length) block('UNEXPECTED_FILES',", to: "  if (false) block('UNEXPECTED_FILES'," }]],
  ['RM17', '낡은 base 를 보지 않는다', 'RE9', [{ file: REL, from: '  if (isStr(head?.baseArticlesText) && head.baseArticlesText !== M.articlesText) {', to: '  if (false) {' }]],
  ['RM18', 'gate 가 같은 release 순서를 보지 않는다', 'RG2-SAME_RELEASE_ORDER', [{ file: REL, from: "if (g.target === 'SAME_RELEASE' && !(at.get(g.planId) < at.get(m.planId))) block(", to: 'if (false) block(' }]],
  // journal + CAS
  ['RM19', 'articles 쓰기 직전 CAS 재확인을 지운다', 'RJ3', [{ file: JRN, from: '  if (again !== release.articles.beforeSha256 && again !== release.articles.afterSha256) {', to: '  if (false) {' }]],
  ['RM20', '이미 있는 다른 바이트 파일을 덮는다', 'RJ4', [{ file: JRN, from: "    if (now !== null && now !== e.afterSha256) fail('FILE_CONFLICT',", to: "    if (false) fail('FILE_CONFLICT'," }]],
  ['RM21', 'hero 바이트 해시를 보지 않는다', 'RJ4', [{ file: JRN, from: '    if (!Buffer.isBuffer(bytes) || sha256(bytes) !== f.heroSha256) fail(', to: '    if (!Buffer.isBuffer(bytes)) fail(' }]],
  ['RM22', 'slug 기록이 다른 값으로 덮인다', 'RJ5', [{ file: JRN, from: "    fail('SLUG_RECORD_CONFLICT',", to: '    return { created: false }; fail(\'SLUG_RECORD_CONFLICT\',' }]],
  // 실행기
  ['RM23', 'Draft 모드에서도 merge 단계로 간다', 'RE2', [{ file: RUN, from: "  if (rollout.release !== 'auto') { report.outcome = 'WAITING_FOUNDER_DRAFT'; return }\n", to: '' }]],
  ['RM24', 'PR 관문이 Draft 모드를 막지 않는다', 'RG4', [{ file: RUN, from: "  if (rollout?.release !== 'auto') block('RELEASE_DRAFT_MODE',", to: "  if (false) block('RELEASE_DRAFT_MODE'," }]],
  ['RM25', '열린 release PR 이 있어도 새 release 를 만든다', 'RE2', [{ file: RUN, from: '    if (openRelease) {', to: '    if (false) {' }]],
  ['RM26', '실행기가 legacy queue 신원 adapter 를 끈다', 'RE12', [{ file: RUN, from: '    legacyQueue: { active: true, text: queueText },', to: '    legacyQueue: { active: false, text: null },' }]],
  ['RM27', 'merge 를 검증한 head 에 묶지 않는다', 'RB5', [{ file: RUN, from: "gh(['pr', 'merge', String(n), '--squash', '--match-head-commit', sha])", to: "gh(['pr', 'merge', String(n), '--squash'])" }]],
  ['RM28', 'release 접두가 아닌 브랜치도 지운다', 'RB5', [{ file: RUN, from: '      if (!branch.startsWith(RELEASE_BRANCH_PREFIX)) return false\n      const remote', to: '      const remote' }]],
  ['RM29', 'CI 실패 PR 을 닫지 않는다', 'RE6', [{ file: RUN, from: "    const closed = closeRelease({ deps, pr: pr0, reason: 'release CI 실패", to: "    const closed = false && closeRelease({ deps, pr: pr0, reason: 'release CI 실패" }]],
  ['RM30', '종료된 release 를 같은 main 에서 다시 만든다', 'RE6', [{ file: RUN, from: '    if (prior && isTerminalJournal(prior)) return block(', to: '    if (false) return block(' }]],
  ['RM32', 'PR 을 연 직후 밖에서 닫힌 release 를 계속 merge 하려 든다', 'RE13b', [{ file: RUN, from: "    if (pr.state !== 'OPEN') {", to: '    if (false) {' }]],
  ['RM32b', '다음 회차가 밖에서 닫힌 release PR 을 사실(CLOSED)로 적지 않는다', 'RE13', [{ file: RUN, from: "      if (pr.state === 'CLOSED') {", to: '      if (false) {' }]],
  // 결속
  ['RM31', 'runtime 결속 파일이 컴파일 결과와 어긋난다', 'RB1', [{ file: 'src/content/magazine/release-binding.ts', from: '"bundleHash": "', to: '"bundleHash": "0' }]],
  // freeze 20:00 · 전수
  ['RM33', 'freeze 시작을 22:00 으로 되돌린다(첫 밤)', 'FZ1', [{ file: FRZ, from: "startAt: '2026-11-24T20:00:00+09:00'", to: "startAt: '2026-11-24T22:00:00+09:00'" }]],
  ['RM34', 'freeze 시작을 22:00 으로 되돌린다(둘째 밤)', 'FZ1', [{ file: FRZ, from: "startAt: '2026-11-25T20:00:00+09:00'", to: "startAt: '2026-11-25T22:00:00+09:00'" }]],
  // 01:00 ↔ 02:00 복구
  ['RM35', '복구가 열린 PR 이 없을 때 조립으로 넘어간다(새 PR)', 'RR2', [{ file: RUN, from: "    if (recover) { report.outcome = 'RECOVER_NOTHING_OPEN'; return report }\n", to: '' }]],
  ['RM36', '복구가 PR 전에 멈춘 release 의 PR 을 만든다', 'RR2', [{ file: RUN, from: '    if (recover) { report.notes.push(`release ${releaseId} 는 ${j.state} 에서 멈췄다', to: '    if (false) { report.notes.push(`release ${releaseId} 는 ${j.state} 에서 멈췄다' }]],
  ['RM37', '복구가 날짜를 놓친 PR 을 닫고 다시 조립한다', 'RR3', [{ file: RUN, from: "        if (recover) return block('RELEASE_DATE_MISSED',", to: "        if (false) return block('RELEASE_DATE_MISSED'," }]],
  ['RM38', '복구가 낡은 base 의 PR 을 닫고 다시 조립한다', 'RR3', [{ file: RUN, from: '      if (recover) { report.notes.push(`#${pr0.number} ${stale.code} — 복구 회차는 닫지 않는다', to: '      if (false) { report.notes.push(`#${pr0.number} ${stale.code} — 복구 회차는 닫지 않는다' }]],
  ['RM39', '진행 중 journal 을 보지 않는다(날짜가 바뀌면 새 releaseId · 고아 브랜치)', 'RR4', [{ file: RUN, from: '    if (apply && attempt === 1) {', to: '    if (false) {' }]],
  ['RM40', '공개 시각을 놓친 PR 전 release 를 그대로 이어 PR 을 연다', 'RR5', [{ file: RUN, from: '    if (!(minPublishMsOf(j.members) > deps.now())) {', to: '    if (false) {' }]],
  ['RM41', '닫지 못한 PR 을 닫았다고 적는다', 'RR6', [{ file: RUN, from: '  if (!r.ok) return false\n', to: '' }]],
  ['RM42', 'merge 응답을 잃은 release 를 사실(MERGED)로 적지 않는다', 'RR8', [{ file: RUN, from: "      if (pr.state === 'MERGED') {\n        // 밖에서 merge", to: "      if (false) {\n        // 밖에서 merge" }]],
  ['RM43', '02:00 진입점이 vnext 에서도 legacy 복구를 돈다', 'RR12', [{ file: AM, from: "    if (lane.lane === 'release') {", to: '    if (false) {' }]],
  // 재개 결속
  ['RM44', '실행기가 재개 결속을 merge 판정에 넣지 않는다', 'RR9', [{ file: RUN, from: '  report.blockedBy.push(...resume.blockedBy, ...content.blockedBy, ...prv.blockedBy)', to: '  report.blockedBy.push(...content.blockedBy, ...prv.blockedBy)' }]],
  ['RM45', '재개 결속이 원본 commit 을 보지 않는다', 'RS1', [{ file: RUN, from: '  if (!HEX40.test(String(journal.commitSha)) || journal.commitSha !== pr.headRefOid) {', to: '  if (false) {' }]],
  ['RM46', '재개 결속이 PR head 바이트를 보지 않는다', 'RS1', [{ file: RUN, from: "  if (!entries.length || drift.length) block('RESUME_BYTES_MISMATCH',", to: "  if (false) block('RESUME_BYTES_MISMATCH'," }]],
  ['RM47', '재개 결속이 Job 의 검증된 원고 · hero · ProviderPlan 기록을 보지 않는다', 'RS1', [{ file: RUN, from: '    else if (job.manuscriptSha256 !== m.manuscriptSha256 || job.heroSha256 !== m.heroSha256 || job.providerPlanHash !== m.providerPlanHash) {', to: '    else if (false) {' }]],
  ['RM48', '재개 결속이 지금 ProviderPlan 을 다시 만들어 대조하지 않는다', 'RS1', [{ file: RUN, from: "    if (providerPlanHashOf(m) !== m.providerPlanHash) block('RESUME_PROVIDER_PLAN_DRIFT',", to: "    if (false) block('RESUME_PROVIDER_PLAN_DRIFT'," }]],
  ['RM49', '이미 MERGED · CLOSED 인 journal 의 PR 을 merge 하게 둔다(중복 merge)', 'RS1', [{ file: RUN, from: "  if (journal.state !== 'PR_OPEN') block('RESUME_JOURNAL_STATE',", to: "  if (false) block('RESUME_JOURNAL_STATE'," }]],
  ['RM50', '조립이 Job 의 ProviderPlan 기록을 지금 값과 대조하지 않는다', 'RA8', [{ file: REL, from: '    if (pp.ok && c.providerPlanHash !== pp.providerPlanHash) {', to: '    if (false) {' }]],
  ['RM51', '조립이 검증된 원고 해시 없이 release 를 만든다', 'RA8', [{ file: REL, from: "    if (!HEX64_RE.test(String(c.manuscriptSha256))) { addReason(c.planId, 'MANUSCRIPT_UNBOUND'); continue }\n", to: '' }]],
  // merge ≠ 서빙
  ['RM52', 'SERVED 로 적은 release 를 회차마다 다시 관측한다', 'RR10', [{ file: RUN, from: "      if (j.mainVerified === true && ['SERVED', 'UNRESOLVED'].includes(j.serving?.state)) continue\n", to: '' }]],
  ['RM53', '서빙 관측 상한이 없다(끝없는 재관측)', 'RR10', [{ file: RUN, from: "  if (s.state !== 'SERVED' && s.attempts >= RELEASE_SERVING_MAX_ATTEMPTS) s.state = 'UNRESOLVED'\n", to: '' }]],
  ['RM54', 'main 에서 확인하지 못한 merge 도 서빙을 관측해 MERGED_* 로 적는다', 'RR11', [{ file: RUN, from: "    if (!ok) { block('MERGE_UNVERIFIED',", to: "    if (false) { block('MERGE_UNVERIFIED'," }]],
  ['RM55', '서빙을 못 봐도 SERVED 로 적는다(merge = 서빙)', 'RR10', [{ file: RUN, from: "      if (o?.served === true) { s.state = 'SERVED';", to: "      if (true) { s.state = 'SERVED';" }]],
]

const lines = []
let detected = 0, harnessFail = 0
let base = null
try {
  const visible = (d, re) => (existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).filter((f) => !f.startsWith('.') && re.test(f)).map((f) => `${d}/${f}`) : [])
  const snapshot = new Map()
  for (const f of [...visible('scripts/lib', /\.mjs$/), ...visible('scripts/__fixtures__/magazine/content-plan', /./), CHECK, AM, 'scripts/magazine-graph-merge.mts',
    'scripts/magazine-release.mjs', 'scripts/magazine-release-binding.mjs', 'scripts/magazine-plan-input-bootstrap.mjs', 'scripts/magazine-rollout.mjs',
    'src/lib/magazine-provenance-rule.mjs', 'src/content/magazine/articles.ts', 'src/content/magazine/release-binding.ts', 'src/content/magazine/graph/control.ts',
    ...visible('src/content/magazine/plan-input', /^g-.*\.json$/), 'drafts/magazine/topic-queue.ts']) {
    if (existsSync(join(ROOT, f))) snapshot.set(f, readFileSync(join(ROOT, f), 'utf8'))
  }
  base = mkdtempSync(join(tmpdir(), 'release-mutation-'))
  const world = (tag, edits) => {
    const files = new Map(snapshot)
    for (const e of edits) {
      const src = files.get(e.file)
      if (src === undefined) return { error: `${e.file} 가 스냅샷에 없다` }
      const k = src.split(e.from).length - 1
      if (k !== 1) return { error: `${e.file} 변이 지점 ${k}곳` }
      files.set(e.file, src.replace(e.from, () => e.to))
    }
    const dir = join(base, tag)
    for (const [f, t] of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), t) }
    return { dir }
  }
  const run = (dir, selectedCase) => {
    const r = spawnSync(process.execPath, [join(dir, CHECK), ...(selectedCase ? ['--case', selectedCase] : [])], { encoding: 'utf8', cwd: dir, timeout: 300_000 })
    const m = /release 검사: (\d+) pass, (\d+) fail/.exec(r.stdout ?? '')
    return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', fail: m ? +m[2] : null, pass: m ? +m[1] : null }
  }
  const b = world('base', [])
  const rb = b.error ? null : run(b.dir)
  if (!rb || rb.status !== 0 || rb.fail !== 0) { harnessFail++; lines.push(`FAIL 무변이 사본이 통과하지 않는다 — ${b.error ?? `${rb.out.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ')}${rb.err}`.slice(-600)}`) }
  else lines.push(`PASS 무변이 사본 ${rb.pass} pass · 0 fail`)
  for (const [id, label, expect, edits] of MUTATIONS) {
    try {
      const w = world(id, edits)
      if (w.error) { harnessFail++; lines.push(`FAIL ${id} ${label} — ${w.error} (하네스 결함)`); continue }
      const r = run(w.dir, expect)
      if (r.fail === null) { harnessFail++; lines.push(`FAIL ${id} ${label} — 요약 줄 없음(검출 아님): ${(r.out + r.err).slice(-200)}`); continue }
      const hit = r.out.split('\n').some((l) => l.startsWith(`FAIL ${expect} `))
      if (r.status === 1 && hit) { detected++; lines.push(`PASS ${id} ${label} → ${expect} 실패로 검출`) }
      else { harnessFail++; lines.push(`FAIL ${id} ${label} — 기대한 ${expect} 가 실패하지 않았다 (status ${r.status} fail=${r.fail} · ${r.out.split('\n').filter((l) => l.startsWith('FAIL')).map((l) => l.split(' ')[1]).join(',')})`) }
    } catch (e) {
      harnessFail++; lines.push(`FAIL ${id} ${label} — 하네스 예외(검출 아님): ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`)
    }
  }
} catch (e) {
  harnessFail++; lines.push(`FAIL 하네스 예외로 중단(검출 아님): ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`)
} finally {
  if (base) rmSync(base, { recursive: true, force: true })
}
console.log(lines.join('\n'))
console.log(`\nrelease 변이: ${detected}/${MUTATIONS.length} detected · ${harnessFail} fail`)
process.exit(harnessFail ? 1 : 0)
