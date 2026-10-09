#!/usr/bin/env node
/**
 * 매거진 자동 병합 복구 검사 — 2026-10-09 #675.
 *
 *   필수 CI 21분 7초 → 01:00 병합이 옛 상한 20분에서 CI_OBSERVE_TIMEOUT → CI 는 61초 뒤 성공 →
 *   11:00 watch 는 공개 확인 전용이라 PR 이 OPEN 으로 남았다.
 *
 *   ① 상한 30분 (명시적 실패 즉시 · 무한 대기 없음)  ② 02:00 `--recover` 가 **같은 관문**으로 다시 본다
 *   ③ 0건 no-op · 2건 이상 fail-closed · 이미 병합됐으면 쓰기 0 · 01:00 병합과 동시 실행 0
 *
 * 🔴 실제 git·gh·배포·HTTP 에 닿지 않는다 — 전부 가짜 주입 · 시계·sleep 도 가짜 · 잠금은 임시 경로.
 *
 * 사용: node scripts/magazine-auto-merge-recovery-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'auto-merge-recovery-')))
process.on('exit', () => fs.rmSync(T, { recursive: true, force: true }))

const AM = await import('./magazine-auto-merge.mjs')
const MG = await import('./lib/magazine-merge-gate.mjs')
const LOCK = await import('./lib/magazine-auto-lock.mjs')

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const finish = () => console.log(`\n${fail ? '🔴' : '✅'} 자동 병합 복구 검사 ${pass}/${pass + fail}\n`)
process.on('unhandledRejection', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.stack ?? e}`); finish(); process.exit(1) })
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.stack ?? e}`); finish(); process.exit(1) })

// ── fixture — #675 모양 · 실제 관문 입력 그대로 ──────────────
const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const MERGED = 'c'.repeat(40)
const NOW = Date.parse('2026-10-09T01:04:38+09:00')
const ART = (rows) => [
  'export const MAGAZINE_ARTICLE_RECORD: Record<string, MagazineArticle> = {',
  ...rows.map((r) => `  '${r.slug}': { title: ${JSON.stringify(r.title ?? r.slug)}, publishedAt: '${r.publishAt.slice(0, 10)}', status: 'SCHEDULED', publishAt: '${r.publishAt}', heroImage: { src: '/magazine/${r.slug}/hero.webp' } },`),
  '}',
].join('\n')
const QUE = (rows) => [
  'export const TOPIC_QUEUE: TopicQueueItem[] = [',
  ...rows.map((r) => `  { slug: '${r.slug}', title: '${r.title ?? '시험 글은 왜 그런가요'}', cluster: '${r.cluster ?? 'daily'}', validationProfile: '${r.validationProfile ?? 'STANDARD'}', riskLevel: '${r.riskLevel}', autoEligible: ${r.autoEligible} },`),
  ']',
].join('\n')
const MAIN_ART = [{ slug: 'old-one', publishAt: '2026-10-08T10:30:00+09:00' }]
const NEW = { slug: 'new-675', publishAt: '2026-10-13T10:30:00+09:00' }
const BRANCH_ART = [...MAIN_ART, NEW]
const MAIN_Q = [{ slug: 'new-675', cluster: 'daily', validationProfile: 'STANDARD', riskLevel: 'LOW', autoEligible: true }, { slug: 'keep-one', cluster: 'daily', validationProfile: 'STANDARD', riskLevel: 'MEDIUM', autoEligible: true }]
const BRANCH_Q = [{ slug: 'keep-one', cluster: 'daily', validationProfile: 'STANDARD', riskLevel: 'MEDIUM', autoEligible: true }]
const PR675 = { number: 675, url: 'https://example/675', headRefName: `${MG.AUTO_BRANCH_PREFIX}2026-10-09-010012`, headRefOid: HEAD, baseRefName: 'main', state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false }
const FILES = ['src/content/magazine/articles.ts', 'drafts/magazine/topic-queue.ts', 'drafts/magazine/new-675/draft.md', 'public/magazine/new-675/hero.webp']
const FAST = [{ name: 'Vercel Preview Comments', status: 'completed', conclusion: 'success' }]
const REQ_OK = [{ name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'success' }]
const REQ_PENDING = [{ name: 'Micro Seed 3축 게이트', status: 'in_progress', conclusion: null }]
const LIVE = 'dpl_RECOVERY0000000000000000'

/** 가짜 git·gh·배포·HTTP — `ciGreenAt` 이전에는 필수 검사가 도는 중이다 */
function deps({ ciGreenAt = 0, prs = () => [{ ...PR675 }], over = {}, startAt = NOW } = {}) {
  let t = startAt
  const calls = []
  const d = {
    calls,
    log: () => {},
    now: () => t,
    sleep: async (ms) => { t += ms },
    fetchMain: () => { calls.push('fetchMain'); return true },
    readBaseSha: () => BASE,
    showFile: (sha, p) => (p.endsWith('articles.ts') ? ART(sha === BASE ? MAIN_ART : BRANCH_ART) : QUE(sha === BASE ? MAIN_Q : BRANCH_Q)),
    listAutoPrs: () => { calls.push('list'); return { ok: true, prs: prs() } },
    getPr: () => ({ ...PR675 }),
    listPrFiles: () => FILES,
    getChecks: (sha) => (sha === HEAD && t - startAt >= ciGreenAt
      ? { ok: true, ciState: 'success', checks: [...FAST, ...REQ_OK] }
      : { ok: true, ciState: 'pending', checks: [...FAST, ...REQ_PENDING] }),
    mergePr: (n, sha) => { calls.push(`merge:${n}:${sha.slice(0, 4)}`); return { ok: true, mergeCommit: MERGED } },
    getProductionDeployment: (sha) => ({ found: true, state: 'success', sha, deploymentId: LIVE }),
    liveDeploymentId: () => LIVE,
    httpStatus: () => 404,
    httpBody: () => '',
    ...over,
  }
  return d
}
const merges = (d) => d.calls.filter((c) => c.startsWith('merge:')).length
const codes = (r) => r.blockedBy.map((b) => b.code)
const freeLock = () => ({ ok: true, code: 'FREE', message: '', release: () => {} })
const MIN = 60 * 1000

// ── ① CI 관찰 30분 ─────────────────────────────────────────
console.log('\n① 01:00 병합 — CI 관찰 상한 30분 · 명시적 실패 즉시 · 무한 대기 없음')
{
  check('① 상한은 30분이다', AM.CI_OBSERVE_MS === 30 * MIN, String(AM.CI_OBSERVE_MS))
  const d = deps({ ciGreenAt: (21 * 60 + 7) * 1000 })
  const r = await AM.runAutoMerge({ apply: true, deps: d })
  check('① #675 실측 — CI 21분 7초 뒤 성공 → 최초 회차에서 병합 (SETTLED · merge 1)',
    r.ci.outcome === 'SETTLED' && r.merged === true && merges(d) === 1 && r.ci.waitedMs >= (21 * 60 + 7) * 1000, `${r.ci.outcome} · merge ${merges(d)} · ${r.ci.waitedMs}`)
  const d2 = deps({ ciGreenAt: 999 * MIN })
  const r2 = await AM.runAutoMerge({ apply: true, deps: d2 })
  check('① 30분을 넘겨 pending → CI_OBSERVE_TIMEOUT · 병합 0 · 31분 안에 끝난다',
    r2.ci.outcome === 'TIMEOUT' && codes(r2).includes('CI_OBSERVE_TIMEOUT') && merges(d2) === 0 && r2.ci.waitedMs >= 30 * MIN && r2.ci.waitedMs < 31 * MIN,
    `${r2.ci.outcome} · ${r2.ci.waitedMs}`)
  const d3 = deps({ over: { getChecks: () => ({ ok: true, ciState: 'failure', checks: [...FAST, { name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'failure' }] }) } })
  const r3 = await AM.runAutoMerge({ apply: true, deps: d3 })
  check('① 명시적 CI 실패 → 즉시 FAILED · 병합 0 · 기다리지 않는다', r3.ci.outcome === 'FAILED' && r3.ci.waitedMs === 0 && merges(d3) === 0, `${r3.ci.outcome} · ${r3.ci.waitedMs}`)
  const d4 = deps({ over: { getChecks: () => ({ ok: true, ciState: 'success', checks: [...FAST, { name: 'Micro Seed 3축 게이트', status: 'completed', conclusion: 'skipped' }] }) } })
  const r4 = await AM.runAutoMerge({ apply: true, deps: d4 })
  check('① 필수 검사 skipped 는 성공이 아니다 (completed + success 만)', merges(d4) === 0 && r4.ci.outcome === 'FAILED', r4.ci.outcome)
  check('① 최초 timeout 의 Slack 제목은 "보류 · 02:00 복구" 로 따로 적는다',
    /보류 — CI 관찰 30분 초과 \(#675\) · 02:00 복구/.test(AM.slackTitleFor(r2) ?? ''), AM.slackTitleFor(r2))
}

// ── ② 02:00 복구 — 같은 관문 ────────────────────────────────
console.log('\n② 02:00 복구 — 최초 timeout 뒤 CI 가 초록이면 같은 관문으로 병합')
const initialTimeout = { runId: '20261009010004-1', pr: { number: 675, head: HEAD }, merged: false, ci: { outcome: 'TIMEOUT' },
  blockedBy: [{ code: 'CI_OBSERVE_TIMEOUT', message: '20분 안에 CI 가 초록이 되지 않았다' }] }
{
  // #675 를 그대로 — 01:00 은 시간 초과로 끝났고(옛 판의 결과 파일), 02:00 에는 CI 가 이미 초록이다
  const d = deps({ ciGreenAt: 0, startAt: Date.parse('2026-10-09T02:00:00+09:00') })
  const r = await AM.runRecovery({ deps: d, initial: initialTimeout, acquire: freeLock })
  check('② 복구 → RECOVERED · merge 1 · exact head 로만', r.outcome === 'RECOVERED' && merges(d) === 1 && d.calls.includes(`merge:675:${HEAD.slice(0, 4)}`), `${r.outcome} · ${d.calls.join(',')}`)
  check('② 복구 결과에 최초 회차(시간 초과)를 따로 남긴다',
    r.mode === 'recovery' && r.initial.found && r.initial.pr === 675 && r.initial.codes.includes('CI_OBSERVE_TIMEOUT'), JSON.stringify(r.initial))
  check('② 복구도 배포·예약 비공개까지 확인한다 (같은 관문)', r.deploy?.state === 'success' && r.blockedBy.length === 0 && r.checked.some((c) => /merge 직전 재조회/.test(c)))
  check('② 복구 Slack 제목은 "복구" 와 최초 원인을 함께 적는다', /자동 병합 복구 — #675 merge 완료 \(최초 회차: CI_OBSERVE_TIMEOUT\)/.test(AM.slackTitleFor(r) ?? ''), AM.slackTitleFor(r))
  check('② 복구는 git·gh 병합 경로만 쓴다 — 원고 전송·재생성·재등록 호출 0',
    d.calls.every((c) => c === 'fetchMain' || c === 'list' || c.startsWith('merge:')), d.calls.join(','))
  // 같은 날 다시 돈다 — 이미 병합됐으므로 자동 PR 목록이 비었다
  const again = deps({ prs: () => [] })
  const r2 = await AM.runRecovery({ deps: again, initial: initialTimeout, acquire: freeLock })
  check('② 이미 병합된 뒤 복구가 다시 돌면 NOOP · 쓰기 0 · 성공 · 알림 0',
    r2.outcome === 'NOOP' && merges(again) === 0 && r2.blockedBy.length === 0 && AM.slackTitleFor(r2) === null, `${r2.outcome}`)
}
{
  // 관문이 막아야 하는 것 — 복구에서도 병합 0
  const startAt = Date.parse('2026-10-09T02:00:00+09:00')
  const cases = [
    ['필수 검사 누락 (빠른 검사만 성공)', deps({ startAt, over: { getChecks: () => ({ ok: true, ciState: 'success', checks: [...FAST] }) } }), 'CI_OBSERVE_TIMEOUT'],
    ['다른 SHA 의 성공', deps({ startAt, over: { getChecks: (sha) => (sha === HEAD ? { ok: true, ciState: 'pending', checks: [...FAST, ...REQ_PENDING] } : { ok: true, ciState: 'success', checks: [...FAST, ...REQ_OK] }) } }), 'CI_OBSERVE_TIMEOUT'],
    ['검증 뒤 head 변경', (() => { let n = 0; return deps({ startAt, over: { getPr: () => { n += 1; return { ...PR675, headRefOid: n >= 2 ? 'd'.repeat(40) : HEAD } } } }) })(), 'SHA_DRIFTED'],
    ['충돌 (CONFLICTING)', deps({ startAt, over: { getPr: () => ({ ...PR675, mergeable: 'CONFLICTING' }) } }), 'NOT_MERGEABLE'],
    ['draft PR', deps({ startAt, prs: () => [{ ...PR675, isDraft: true }], over: { getPr: () => ({ ...PR675, isDraft: true }) } }), 'IS_DRAFT'],
    ['사람 브랜치', deps({ startAt, prs: () => [{ ...PR675, headRefName: 'feat/human' }], over: { getPr: () => ({ ...PR675, headRefName: 'feat/human' }) } }), 'NOT_AUTO_BRANCH'],
    ['허용 밖 파일', deps({ startAt, over: { listPrFiles: () => [...FILES, 'scripts/magazine-auto-merge.mjs'] } }), 'UNEXPECTED_FILES'],
    ['main 이 전진하며 기존 글이 달라졌다', deps({ startAt, over: { showFile: (sha, p) => (p.endsWith('articles.ts')
      ? ART(sha === BASE ? [...MAIN_ART, { slug: 'landed-on-main', publishAt: '2026-10-10T10:30:00+09:00' }] : BRANCH_ART)
      : QUE(sha === BASE ? MAIN_Q : BRANCH_Q)) } }), 'EXISTING_ARTICLE_TOUCHED'],
  ]
  for (const [name, d, code] of cases) {
    const r = await AM.runRecovery({ deps: d, initial: initialTimeout, acquire: freeLock })
    check(`② 복구 · ${name} → 병합 0 · ${code}`, merges(d) === 0 && r.outcome === 'BLOCKED' && codes(r).some((c) => c.startsWith(code)), `${r.outcome} · ${codes(r).join(',')}`)
  }
  // main 이 전진했지만 충돌 없음 · 기존 글 그대로 → 지금 main 기준 전체 관문 통과 → 병합
  const advanced = deps({ startAt, over: { readBaseSha: () => 'e'.repeat(40), showFile: (sha, p) => (p.endsWith('articles.ts')
    ? ART(sha === HEAD ? BRANCH_ART : MAIN_ART) : QUE(sha === HEAD ? BRANCH_Q : MAIN_Q)) } })
  const ra = await AM.runRecovery({ deps: advanced, initial: initialTimeout, acquire: freeLock })
  check('② main 이 전진했지만 충돌·기존 글 변화 없음 → 지금 main 기준 관문 통과 → 병합', ra.outcome === 'RECOVERED' && merges(advanced) === 1 && ra.baseSha === 'e'.repeat(40), `${ra.outcome} · ${codes(ra).join(',')}`)
}

// ── ③ 0건 · 2건 이상 · 잠금 ─────────────────────────────────
console.log('\n③ 자동 PR 0건 no-op · 2건 이상 fail-closed · 01:00 병합과 동시 실행 0')
{
  const d0 = deps({ prs: () => [] })
  const r0 = await AM.runRecovery({ deps: d0, initial: null, acquire: freeLock })
  check('③ 자동 PR 0건 → NOOP · merge 0 · 성공(막힘 0) · 최초 결과 없음도 그대로 기록', r0.outcome === 'NOOP' && merges(d0) === 0 && r0.blockedBy.length === 0 && r0.initial.found === false)
  const d2 = deps({ prs: () => [{ ...PR675 }, { ...PR675, number: 676, headRefName: `${MG.AUTO_BRANCH_PREFIX}2026-10-09-020000` }] })
  const r2 = await AM.runRecovery({ deps: d2, initial: initialTimeout, acquire: freeLock })
  check('③ 자동 PR 2건 → MULTIPLE_AUTO_PRS · 고르지 않는다 · merge 0', r2.outcome === 'BLOCKED' && codes(r2).includes('MULTIPLE_AUTO_PRS') && merges(d2) === 0, codes(r2).join(','))
  // 실제 잠금 — 01:00 병합이 아직 쥐고 있다
  const lockPath = path.join(T, '.auto-merge.lock')
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, startedAt: Date.now(), label: 'auto-merge' })}\n`)
  const dl = deps()
  const rl = await AM.runRecovery({ deps: dl, initial: initialTimeout, acquire: () => LOCK.acquireLock({ path: lockPath, label: 'auto-merge-recovery' }) })
  check('③ 01:00 병합이 잠금을 쥐고 있으면 DEFERRED · 조회·merge 0 · 알림 0',
    rl.outcome === 'DEFERRED' && rl.deferred?.code === 'LOCK_HELD' && dl.calls.length === 0 && AM.slackTitleFor(rl) === null, `${rl.outcome} · ${dl.calls.join(',')}`)
  fs.rmSync(lockPath)
  const dr = deps()
  const rr = await AM.runRecovery({ deps: dr, initial: initialTimeout, acquire: () => LOCK.acquireLock({ path: lockPath, label: 'auto-merge-recovery' }) })
  check('③ 잠금이 풀려 있으면 잡고 진행 · 끝나면 놓는다', rr.outcome === 'RECOVERED' && !fs.existsSync(lockPath), `${rr.outcome} · lock ${fs.existsSync(lockPath)}`)
}

// ── ④ 실제 명령 조립 — 열린 PR 만 본다 ──────────────────────
console.log('\n④ 실제 실행기 — 자동 PR 은 열린 것만 · 병합은 exact head 로만')
{
  const seen = []
  const exec = (cmd, args) => { seen.push([cmd, ...args].join(' ')); return { code: 0, out: '[]', err: '' } }
  const real = AM.makeRealDeps(exec, { log: () => {} })
  real.listAutoPrs()
  check('④ 자동 PR 목록은 열린 PR 만 (--state open) — 이미 병합된 PR 은 대상이 아니다', seen.some((c) => /^gh pr list --state open\b/.test(c)), seen.join(' | '))
  seen.length = 0
  real.mergePr(675, HEAD)
  check('④ 병합은 --squash --match-head-commit <검증한 head>', seen.some((c) => c === `gh pr merge 675 --squash --match-head-commit ${HEAD}`), seen.join(' | '))
}

// ── ⑤ 배선 — watch 는 공개 확인 전용 · 결과 파일 분리 · 같은 잠금 ─────
console.log('\n⑤ 배선 — 11:00 watch 는 merge 하지 않는다 · 복구 결과는 따로 · 01:00 과 같은 잠금')
{
  const src = fs.readFileSync(path.join(HERE, 'magazine-auto-merge.mjs'), 'utf8')
  const main = src.slice(src.indexOf('async function main()'))
  const watchBlock = main.slice(main.indexOf("if (argv.includes('--watch'))"), main.indexOf("if (argv.includes('--recover'))"))
  check('⑤ --watch 경로에 merge·복구·runAutoMerge 가 없다', watchBlock.length > 0 && !/runAutoMerge|runRecovery|mergePr|--apply/.test(watchBlock))
  const recoverBlock = main.slice(main.indexOf("if (argv.includes('--recover'))"), main.indexOf("line(`자동 병합 ${apply"))
  check('⑤ 복구는 runRecovery 하나로 · 병합 잠금(MERGE_LOCK_PATH) 안에서', /runRecovery\(/.test(recoverBlock) && /MERGE_LOCK_PATH/.test(recoverBlock))
  check('⑤ 복구 결과는 auto-merge-recovery.json — 01:00 의 auto-merge.json 을 덮지 않는다',
    /'auto-merge-recovery\.json'/.test(recoverBlock) && !/'auto-merge\.json'\), `\$\{JSON/.test(recoverBlock))
  check('⑤ 01:00 --apply 도 같은 병합 잠금을 쓴다', /apply \? acquireLock\(\{ path: MERGE_LOCK_PATH/.test(main))
  check('⑤ 병합기는 원고·등록·재생성을 부르지 않는다 (재전송·재생성·재등록 0)', !/magazine-webui-runner|magazine-auto-register\b|magazine-regen|attemptRegeneration/.test(src))
}

finish()
process.exitCode = fail ? 1 : 0
