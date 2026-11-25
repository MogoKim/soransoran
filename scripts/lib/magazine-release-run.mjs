/**
 * vNext release 실행기 — release writer 하나 · vNext merge gate (runbook §0.0B.4 · S3-P2).
 *
 *   ① rollout 이 vnext 일 때만 돈다(legacy 이면 아무것도 하지 않는다)
 *   ② 최신 origin/main 을 읽는다 — articles · control · Bundle · runtime 결속 · legacy queue 신원
 *   ③ 열린 매거진 PR(legacy 자동 · vNext release)의 날짜 · slug 를 점유로 읽는다
 *   ④ 열린 release PR 이 있으면 새 release 를 만들지 않는다 — 날짜를 놓쳤으면 닫고 다시 조립, 아니면 그 PR 의 merge 단계(auto) 또는 대기(draft)
 *   ⑤ 후보(Job 저장소) → assembleRelease(고정점 · stable slug · 날짜 slot) → slug 기록 → release worktree → journal + CAS 쓰기
 *   ⑥ commit(파일 이름 명시) → push(강제 0) → PR(draft 모드면 Draft · auto 모드면 일반)
 *   ⑦ auto 모드만: CI 관찰(유한) → 내용 관문(main 재컴파일 · admission 재판정 · public 결속 · ProviderPlan) → PR 관문(SHA · CI · 모양) →
 *      재개 결속(journal 의 원본 commit · 바이트 · 검증된 원고 · hero · ProviderPlan) → merge freeze →
 *      `gh pr merge --squash --match-head-commit` → main 에 행이 실제로 들어갔는지 확인(MERGED) → 그 SHA 의 서빙 관측(따로 적는다)
 *
 * 🔴 재실행 — 어느 단계에서 죽어도 같은 release 를 이어 간다(journal 상태 + 사실 재확인). 같은 PR 을 두 번 만들지 않는다.
 *    날짜가 바뀌어도 같다 — 열린 PR 은 브랜치 이름으로, PR 전에 멈춘 release 는 journal 로 찾는다(releaseId 를 다시 계산해 찾지 않는다).
 * 🔴 02:00 복구(`recover`)는 같은 함수의 좁은 모드다 — 이미 열린 release PR 의 merge 단계와 merge 뒤 마무리만 한다. 조립 · 새 PR · PR 닫기 0.
 * 🔴 결과 낱말을 뭉치지 않는다 — NOTHING_TO_RELEASE(후보 없음) · NO_RELEASABLE_CANDIDATE(후보 전부 보류) · RELEASE_CLOSE_FAILED(닫지 못함) ·
 *    RESUME_HOLD(재개 결속 불일치 보류) · MERGED_SERVED(merge + 그 SHA 서빙) · MERGED_SERVING_PENDING(merge 됨 · 서빙 미확인)은 서로 다른 사실이다.
 * 🔴 legacy 모듈(queue writer · register · legacy merge gate · auto-merge)을 import 하지 않는다 — 같은 위험을 같은 방식으로 따로 막는다.
 * 🔴 `--admin` · force push · `git add .` 0. merge 는 검증한 head SHA 로만.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { judgeMergeFreeze } from './magazine-merge-freeze.mjs'
import {
  ARTICLES_PATH, BINDING_PATH, RELEASE_BRANCH_PREFIX, assembleRelease, bundleFilePath, heroFilePath, judgeReleaseContent, parseArticleRecordText,
  planFilePath,
} from './magazine-release.mjs'
import { parseArticleIdentityText, projectProviderPlan, strictControlGraphVersion } from './magazine-content-plan.mjs'
import { resolveVercelContext, verifyVercelDirect } from './magazine-deploy-evidence.mjs'
import { strictPublishAtMs } from './magazine-public-rule.mjs'
import {
  RELEASE_ID_RE, ReleaseWriteError, advanceJournal, applyReleaseFiles, isTerminalJournal, journalPathOf, listReleaseJournals, noteJournal, readJournal, readSlugRecords, recordSlug,
  worktreePathOf,
} from './magazine-release-journal.mjs'

export const RUN_SCHEMA = 'magazine-release-run/1'
/** legacy 자동 등록 PR 접두 — 점유(날짜 · slug)를 읽기 위해서만 안다. legacy 와 같은 값인지 release 검사가 대조한다 */
export const LEGACY_AUTO_PREFIX = 'feat/magazine-auto-register-'
/** 필수 검사 — legacy 관문과 같은 이름 · 같은 결론 규칙(release 검사가 legacy 상수와 대조한다) */
export const RELEASE_REQUIRED_CHECKS = Object.freeze(['Micro Seed 3축 게이트'])
export const RELEASE_OK_CONCLUSIONS = Object.freeze(['success', 'skipped', 'neutral'])
export const RELEASE_REQUIRED_CONCLUSIONS = Object.freeze(['success'])
export const PR_FIELDS = 'number,url,headRefName,headRefOid,baseRefName,state,mergeable,isDraft'
export const RELEASE_CI_OBSERVE_MS = 30 * 60 * 1000
export const RELEASE_CI_POLL_MS = 30 * 1000
export const RELEASE_MERGEABLE_OBSERVE_MS = 3 * 60 * 1000
export const RELEASE_MERGEABLE_POLL_MS = 15 * 1000
/** merge 직후 서빙 관측 — 유한. 못 보면 MERGED_SERVING_PENDING 으로 끝내고 다음 회차가 한 번씩 다시 본다 */
export const RELEASE_SERVING_OBSERVE_MS = 10 * 60 * 1000
export const RELEASE_SERVING_POLL_MS = 30 * 1000
/** 한 merge SHA 의 서빙 관측 상한 — 넘으면 UNRESOLVED 로 적고 더 관측하지 않는다(끝없는 재관측 0) */
export const RELEASE_SERVING_MAX_ATTEMPTS = 40
const HEX40 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/
const QUEUE_PATH = 'drafts/magazine/topic-queue.ts'
const CONTROL_PATH = 'src/content/magazine/graph/control.ts'

const iso = (ms) => new Date(ms).toISOString()

/**
 * PR 관문 — PR 자체 · SHA · CI · 모드. 내용은 judgeReleaseContent 가 본다.
 * @returns {{ ok: boolean, blockedBy: {code:string,message:string}[], checked: string[] }}
 */
export function judgeReleasePr({ pr, expectedSha, ciState, checks, rollout }) {
  const blockedBy = [], checked = []
  const block = (code, message) => blockedBy.push({ code, message })
  if (rollout?.release !== 'auto') block('RELEASE_DRAFT_MODE', 'rollout release 가 draft 다 — release PR 을 자동으로 merge 하지 않는다(창업자 병합)')
  if (!pr) { block('NO_PR', 'PR 을 읽지 못했다'); return { ok: false, blockedBy, checked } }
  if (!releaseIdOf(pr.headRefName)) block('NOT_RELEASE_BRANCH', `${pr.headRefName} 는 vNext release 브랜치가 아니다`)
  if (pr.state !== 'OPEN') block('NOT_OPEN', `PR 상태 ${pr.state}`)
  if (pr.isDraft) block('IS_DRAFT', 'Draft release PR 이다 — 자동 merge 0')
  if (pr.mergeable !== 'MERGEABLE') block('NOT_MERGEABLE', `mergeable=${pr.mergeable}`)
  if (pr.baseRefName !== 'main') block('BASE_NOT_MAIN', `base ${pr.baseRefName}`)
  if (!expectedSha || pr.headRefOid !== expectedSha) block('SHA_DRIFTED', `head ${String(pr.headRefOid).slice(0, 7)} ≠ 검증한 ${String(expectedSha).slice(0, 7)}`)
  if (ciState !== 'success') block('CI_NOT_GREEN', `CI 상태 ${ciState}`)
  if (!Array.isArray(checks) || checks.length === 0) block('CHECKS_EMPTY', '검사 목록이 비었다 — 확정할 수 없으면 막는다')
  else {
    const bad = checks.filter((c) => c.status === 'completed' && !RELEASE_OK_CONCLUSIONS.includes(c.conclusion ?? ''))
    const pending = checks.filter((c) => c.status !== 'completed')
    if (bad.length) block('CHECK_FAILED', `실패한 검사: ${bad.map((c) => c.name).join(', ')}`)
    else if (pending.length) block('CHECK_PENDING', `아직 도는 검사: ${pending.map((c) => c.name).join(', ')}`)
    const byName = new Map(checks.map((c) => [c.name, c]))
    const missing = RELEASE_REQUIRED_CHECKS.filter((n) => { const c = byName.get(n); return !c || c.status !== 'completed' || !RELEASE_REQUIRED_CONCLUSIONS.includes(c.conclusion ?? '') })
    if (missing.length) block('REQUIRED_CHECK_MISSING', `필수 검사가 완료·성공이 아니다: ${missing.join(', ')}`)
  }
  if (!blockedBy.length) checked.push('PR · SHA · CI · 필수 검사 · auto 모드')
  return { ok: blockedBy.length === 0, blockedBy, checked }
}

/** main 사실 — 이 시점의 origin/main 바이트. S4 생산기도 같은 함수로 읽는다(ProviderPlan 입력을 release 와 같게) */
export function readMainFacts(deps, baseSha) {
  const show = (p) => deps.showFile(baseSha, p)
  const controlText = show(CONTROL_PATH)
  const graphVersion = controlText ? strictControlGraphVersion(controlText) : null
  const queueText = show(QUEUE_PATH)
  return {
    controlText, graphVersion,
    articlesText: show(ARTICLES_PATH),
    bundle: graphVersion ? show(bundleFilePath(graphVersion)) : null,
    bindingText: show(BINDING_PATH),
    // 🔴 legacy 가 남아 있는 동안 queue 신원 adapter 는 켜져 있다 — 파일이 없으면 admission 이 fail-closed 로 막는다
    legacyQueue: { active: true, text: queueText },
    heroSlugs: deps.listHeroSlugs(baseSha),
  }
}

/** 열린 매거진 PR 이 main 에 더하는 행의 날짜 · slug — 못 읽으면 null(점유를 모르면 조립하지 않는다) */
function occupiedByPr(deps, pr, mainRecord) {
  if (!deps.fetchRef(pr.headRefName)) return null
  const text = deps.showFile(pr.headRefOid, ARTICLES_PATH)
  const rec = text ? parseArticleRecordText(text) : { ok: false }
  if (!rec.ok) return null
  const added = rec.slugs.filter((s) => !Object.prototype.hasOwnProperty.call(mainRecord.record, s))
  const days = []
  for (const s of added) { const ms = strictPublishAtMs(rec.record[s]); if (!Number.isFinite(ms)) return null; days.push(new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10)) }
  return { number: pr.number, branch: pr.headRefName, slugs: added, dates: days, minPublishMs: Math.min(...added.map((s) => strictPublishAtMs(rec.record[s]))) }
}

async function observeCi({ deps, sha }) {
  const started = deps.now()
  let snap = { ciState: 'unknown', checks: [] }
  for (;;) {
    const r = deps.getChecks(sha)
    if (r.ok) {
      snap = { ciState: r.ciState, checks: r.checks }
      const failed = r.checks.some((c) => c.status === 'completed' && !RELEASE_OK_CONCLUSIONS.includes(c.conclusion ?? ''))
      const reqBad = RELEASE_REQUIRED_CHECKS.some((n) => { const c = r.checks.find((x) => x.name === n); return c && c.status === 'completed' && !RELEASE_REQUIRED_CONCLUSIONS.includes(c.conclusion ?? '') })
      if (failed || reqBad || r.ciState === 'failure' || r.ciState === 'error') return { ...snap, outcome: 'FAILED' }
      const settled = r.checks.length > 0 && r.checks.every((c) => c.status === 'completed') && RELEASE_REQUIRED_CHECKS.every((n) => r.checks.some((c) => c.name === n && c.status === 'completed'))
      if (settled && r.ciState === 'success') return { ...snap, outcome: 'SETTLED' }
    }
    if (deps.now() - started >= RELEASE_CI_OBSERVE_MS) return { ...snap, outcome: 'TIMEOUT' }
    await deps.sleep(RELEASE_CI_POLL_MS)
  }
}

async function observeMergeable({ deps, number }) {
  const started = deps.now()
  for (;;) {
    const pr = deps.getPr(number)
    if (!pr || pr.mergeable !== 'UNKNOWN' || deps.now() - started >= RELEASE_MERGEABLE_OBSERVE_MS) return pr
    await deps.sleep(RELEASE_MERGEABLE_POLL_MS)
  }
}

/**
 * 재개 결속 — 열린 release PR 을 merge 하기 전에, 그 PR 이 **journal 이 기록한 바로 그 release** 인지 본다 (순수).
 *
 * 왜 있나
 *   01:00 이 연 PR 을 02:00 복구나 다음 날 01:00 이 이어받을 때 기준은 "지금 PR head" 였다. 내용 관문(judgeReleaseContent)은 구조 · 금칙 · 날짜를
 *   다시 보지만, 그 head 가 검증된 원고 · hero 로 만든 원래 commit 인지는 보지 않았다. 여기서 journal 의 기록과 사실을 하나씩 맞춘다.
 *     원본 commit      PR head SHA = journal.commitSha
 *     쓴 바이트        PR head 의 articles.ts · plan · hero 바이트 해시 = journal entries 의 afterSha256
 *     검증된 원고·hero  Job 저장소의 지금 기록(VALID · HERO_READY · HOLD 아님) = journal 이 조립 때 남긴 해시
 *     ProviderPlan     Job 이 묶은 값 = journal 값 = 지금 main 에서 다시 만든 값(원고가 쓰인 입력이 그대로다)
 * 🔴 하나라도 어긋나면 merge 하지 않는다. PR 을 닫지도 고치지도 않는다 — 보류다(사람이 본다). 낡은 release(날짜 · base)는 내용 관문이 따로 가른다.
 * @param {{ journal: object|null, pr: object, headSha256Of: (path: string) => string|null,
 *           jobOf: (planHash: string) => { manuscriptSha256: string, heroSha256: string, providerPlanHash: string|null }|null,
 *           providerPlanHashOf: (member: object) => string|null }} p
 * @returns {{ ok: boolean, blockedBy: {code:string,message:string}[], checked: string[] }}
 */
export function judgeResumeBinding({ journal, pr, headSha256Of, jobOf, providerPlanHashOf }) {
  const blockedBy = [], checked = []
  const block = (code, message) => blockedBy.push({ code, message })
  const done = () => ({ ok: blockedBy.length === 0, blockedBy, checked })
  if (!journal) { block('RESUME_JOURNAL_MISSING', `${pr?.headRefName} 의 journal 이 없다 — 이 writer 가 만든 release 인지 확인할 수 없다`); return done() }
  if (journal.broken) { block('RESUME_JOURNAL_BROKEN', `journal 을 읽지 못했다 (${journal.why}) — 자동으로 지우지 않는다`); return done() }
  // 🔴 MERGED · CLOSED 인 journal 의 PR 을 다시 merge 하지 않는다(중복 merge 0)
  if (journal.state !== 'PR_OPEN') block('RESUME_JOURNAL_STATE', `journal 이 ${journal.state} 다 — PR_OPEN 인 release 만 merge 한다`)
  if (journal.branch !== pr.headRefName || journal.prNumber !== pr.number) block('RESUME_PR_MISMATCH', `journal 의 PR(#${journal.prNumber} · ${journal.branch})과 열린 PR(#${pr.number} · ${pr.headRefName})이 다르다`)
  if (!HEX40.test(String(journal.commitSha)) || journal.commitSha !== pr.headRefOid) {
    block('RESUME_COMMIT_MISMATCH', `PR head ${String(pr.headRefOid).slice(0, 7)} 가 journal 의 원본 commit ${String(journal.commitSha).slice(0, 7)} 이 아니다`)
  }
  const entries = Array.isArray(journal.entries) ? journal.entries : []
  const drift = entries.filter((e) => !HEX64.test(String(e?.afterSha256)) || headSha256Of(e.path) !== e.afterSha256).map((e) => e?.path)
  if (!entries.length || drift.length) block('RESUME_BYTES_MISMATCH', `PR head 의 바이트가 journal 이 쓴 바이트와 다르다: ${drift.join(', ') || 'entries 없음'}`)
  const members = Array.isArray(journal.members) ? journal.members : []
  if (!members.length) block('RESUME_BINDING_ABSENT', 'journal 에 글이 없다')
  for (const m of members) {
    if (![m?.providerPlanHash, m?.heroSha256, m?.manuscriptSha256].every((h) => HEX64.test(String(h)))) { block('RESUME_BINDING_ABSENT', `${m?.slug} 의 원고 · hero · ProviderPlan 해시가 journal 에 없다`); continue }
    if (entries.find((e) => e.path === heroFilePath(m.slug))?.afterSha256 !== m.heroSha256) block('RESUME_BYTES_MISMATCH', `${m.slug} 의 hero 기록이 서로 다르다`)
    const job = jobOf(m.planHash)
    if (!job) block('RESUME_JOB_MISSING', `${m.slug} 의 Job 이 후보가 아니다(없음 · HOLD · 검증 전 · 산출물 해시 불일치)`)
    else if (job.manuscriptSha256 !== m.manuscriptSha256 || job.heroSha256 !== m.heroSha256 || job.providerPlanHash !== m.providerPlanHash) {
      block('RESUME_JOB_MISMATCH', `${m.slug} 의 Job 기록(원고 · hero · ProviderPlan)이 release 를 만든 뒤 바뀌었다`)
    }
    if (providerPlanHashOf(m) !== m.providerPlanHash) block('RESUME_PROVIDER_PLAN_DRIFT', `${m.slug} 의 ProviderPlan 이 지금 main 에서 다시 만든 값과 다르다 — 원고가 쓰인 입력이 바뀌었다`)
  }
  if (!blockedBy.length) checked.push(`재개 결속 — 원본 commit · 바이트 ${entries.length}개 · 글 ${members.length}편의 원고 · hero · ProviderPlan`)
  return done()
}

/** journal 판독 — releaseId 모양이 아니면 null(그 PR 은 이 writer 의 release 가 아니다) */
function journalOf(deps, releaseId) {
  try { const path = journalPathOf(deps.stateRoot, releaseId); return { path, journal: readJournal(path) } } catch { return { path: null, journal: null } }
}
function releaseIdOf(branch) {
  if (typeof branch !== 'string' || !branch.startsWith(RELEASE_BRANCH_PREFIX)) return null
  const id = branch.slice(RELEASE_BRANCH_PREFIX.length)
  return RELEASE_ID_RE.test(id) ? id : null
}
const minPublishMsOf = (members) => Math.min(...members.map((m) => strictPublishAtMs({ publishAt: m.publishAt, status: 'SCHEDULED' })))

/** release PR 제목 · 본문 — 조립 결과와 journal(이어받기) 어느 쪽에서도 같은 모양 */
function prTextOf({ releaseId, graphVersion, members, rollout }) {
  return {
    title: `[magazine release] ${members.map((x) => x.slug).join(', ')}`,
    body: [`vNext release ${releaseId} · graph ${graphVersion} · rollout ${rollout.release}`, '',
      ...members.map((x) => `- \`${x.slug}\` — ${x.intentId} · ${x.publishAt} · plan \`${x.planHash}\` · 층 ${x.layer}`), '',
      rollout.release === 'draft' ? '🔴 Draft release — 자동 merge 0. 창업자가 dev 렌더를 확인하고 병합 여부를 정한다.' : 'auto — vNext merge gate(재컴파일 · admission · 결속 · freeze)를 통과해야 merge 된다.'].join('\n'),
  }
}

/** release PR 하나를 닫는다 — journal 을 CLOSED 로(후보는 검증됨 그대로 · 같은 plan 으로 다시 조립된다). 🔴 닫지 못하면 false — 호출자가 멈춘다 */
function closeRelease({ deps, pr, reason, report }) {
  const r = deps.closePr(pr.number, reason)
  report.closed.push({ number: pr.number, branch: pr.headRefName, reason, ok: r.ok })
  if (!r.ok) return false
  const releaseId = releaseIdOf(pr.headRefName)
  try {
    const jp = journalPathOf(deps.stateRoot, releaseId)
    const j = readJournal(jp)
    if (j && !j.broken && !isTerminalJournal(j)) advanceJournal(jp, j, 'CLOSED', { closedReason: reason, closedPr: pr.number }, { nowIso: iso(deps.now()) })
  } catch (e) { report.notes.push(`닫은 release 의 journal 기록 실패 (${e?.code ?? e?.message}) — PR 은 닫혔다`) }
  cleanupRelease({ deps, releaseId, branch: pr.headRefName, report })
  return true
}
/** 닫기 실패 — 닫았다고 적지 않는다. PR · journal · 브랜치를 그대로 두고 멈춘다(다음 회차가 같은 PR 을 다시 본다) */
function closeFailed({ report, pr }) {
  report.blockedBy.push({ code: 'RELEASE_CLOSE_FAILED', message: `#${pr.number} 를 닫지 못했다 — 닫았다고 기록하지 않는다 · 다시 조립하지 않는다` })
  report.outcome = 'RELEASE_CLOSE_FAILED'
}

/** release 잔존물 정리 — 그 release 의 worktree · 원격/로컬 브랜치(접두가 release 인 이름만). 실패는 기록만 한다(판정을 바꾸지 않는다) */
function cleanupRelease({ deps, releaseId, branch, report }) {
  if (!releaseIdOf(branch)) return
  let wt = null
  try { wt = worktreePathOf(deps.stateRoot, releaseId) } catch { wt = null }
  if (wt && existsSync(wt) && !deps.removeWorktree(wt)) report.notes.push(`${wt} worktree 를 지우지 못했다`)
  if (!deps.deleteBranch(branch)) report.notes.push(`${branch} 브랜치를 지우지 못했다`)
}

/**
 * merge 뒤 — ① main 에 그 release 의 행이 실제로 있는가(MERGED 의 뜻) ② 그 merge SHA 가 운영 도메인에서 서빙되는가(따로 적는다).
 * 🔴 둘을 한 낱말로 뭉치지 않는다. MERGED_SERVED 만 "독자가 그 배포를 받는다" 이고, MERGED_SERVING_PENDING 은 merge 는 끝났고 서빙은 아직 못 봤다는 뜻이다.
 * 🔴 못 본 release 는 다음 회차(02:00 복구 포함)가 한 번씩 다시 본다 — 상한까지. 이미 SERVED · UNRESOLVED 로 적은 release 는 호출자(reconcileJournals)가
 *    이 함수를 부르지 않는다 — 같은 SHA 를 다시 관측하지 않는다.
 * @returns {Promise<string>} outcome
 */
async function settleMerged({ deps, path, report, waitMs }) {
  let j = readJournal(path)
  const block = (code, message) => report.blockedBy.push({ code, message })
  if (!j || j.broken || j.state !== 'MERGED') { block('JOURNAL_BROKEN', `${path} 를 MERGED 로 읽지 못했다`); return 'MERGED_UNVERIFIED' }
  if (j.mainVerified !== true) {
    const after = deps.fetchMain() ? deps.showFile(deps.readBaseSha(), ARTICLES_PATH) : null
    const ids = after ? parseArticleIdentityText(after) : { ok: false }
    const ok = ids.ok && j.members.every((x) => ids.rows.some((r) => r.slug === x.slug && r.release?.planHash === x.planHash && r.publishAt === x.publishAt))
    if (!ok) { block('MERGE_UNVERIFIED', `release ${j.releaseId} — merge 뒤 main 에서 release 행을 확인하지 못했다`); return 'MERGED_UNVERIFIED' }
    j = noteJournal(path, j, { mainVerified: true, mainVerifiedAt: iso(deps.now()) })
  }
  const prior = j.serving ?? null
  const sha = j.mergeCommit ?? (j.mergedPr ? deps.getMergeCommit(j.mergedPr) : null)
  const s = { releaseId: j.releaseId, sha: sha ?? null, state: null, code: null, attempts: prior?.attempts ?? 0 }
  report.settled.push(s)
  if (!HEX40.test(String(sha))) { s.state = 'PENDING'; s.code = 'MERGE_SHA_UNKNOWN' } else {
    const started = deps.now()
    for (;;) {
      const o = deps.observeServing(sha)
      s.attempts++
      if (o?.served === true) { s.state = 'SERVED'; s.code = null; s.deploymentId = o.deploymentId ?? null; break }
      s.state = 'PENDING'; s.code = o?.code ?? 'SERVING_UNKNOWN'
      if (deps.now() - started >= waitMs) break
      await deps.sleep(RELEASE_SERVING_POLL_MS)
    }
  }
  if (s.state !== 'SERVED' && s.attempts >= RELEASE_SERVING_MAX_ATTEMPTS) s.state = 'UNRESOLVED'
  noteJournal(path, { ...j, mergeCommit: sha ?? j.mergeCommit ?? null }, { serving: { sha: sha ?? null, state: s.state, code: s.code, attempts: s.attempts, deploymentId: s.deploymentId ?? null, observedAt: iso(deps.now()) } })
  if (s.state === 'SERVED') return 'MERGED_SERVED'
  if (s.state === 'UNRESOLVED') { block('SERVING_UNRESOLVED', `release ${j.releaseId} 의 merge ${String(sha).slice(0, 7)} 가 ${s.attempts}번 관측에도 운영 도메인에서 서빙되지 않는다 (${s.code}) — 더 관측하지 않는다`); return 'MERGED_SERVING_UNRESOLVED' }
  return 'MERGED_SERVING_PENDING'
}

/**
 * merge 단계 — auto 모드의 열린 release PR 하나. 01:00 회차와 02:00 복구가 **같은 함수 · 같은 journal · 같은 관문**을 지난다.
 * @param {{ recover?: boolean }} p  recover — 복구 회차. PR 을 닫고 다시 조립하는 일(새 PR)을 하지 않는다
 * @returns {Promise<void>} report 를 채운다
 */
async function mergeStep({ deps, pr0, rollout, report, recover = false }) {
  const m = report.merge = { number: pr0.number, branch: pr0.headRefName, head: pr0.headRefOid, ci: null, merged: false, mergeCommit: null, verified: false, checked: [] }
  const mark = report.blockedBy.length
  const block = (code, message) => report.blockedBy.push({ code, message })
  if (rollout.release !== 'auto') { report.outcome = 'WAITING_FOUNDER_DRAFT'; return }
  const ci = await observeCi({ deps, sha: pr0.headRefOid })
  m.ci = { outcome: ci.outcome, ciState: ci.ciState, checks: ci.checks.length }
  if (ci.outcome === 'FAILED') {
    // 🔴 release CI 실패 — 그 release 만 닫는다. 후보는 검증됨으로 남고 다음 회차가 다시 조립한다
    const closed = closeRelease({ deps, pr: pr0, reason: 'release CI 실패 — 후보는 검증됨으로 되돌아가 다음 회차에 다시 조립된다', report })
    block('RELEASE_CI_FAILED', `#${pr0.number} CI 실패`)
    if (!closed) { closeFailed({ report, pr: pr0 }); return }
    report.outcome = 'RELEASE_CI_FAILED_CLOSED'
    return
  }
  if (ci.outcome === 'TIMEOUT') { report.outcome = 'CI_PENDING'; block('CI_OBSERVE_TIMEOUT', `${RELEASE_CI_OBSERVE_MS / 60000}분 안에 CI 가 끝나지 않았다 — 다음 회차(02:00 복구 포함)가 같은 PR 을 다시 본다`); return }
  const pr = await observeMergeable({ deps, number: pr0.number })
  if (!deps.fetchMain()) { block('FETCH_FAILED', 'origin/main 을 가져오지 못했다'); report.outcome = 'MERGE_BLOCKED'; return }
  const baseSha = deps.readBaseSha()
  const main = readMainFacts(deps, baseSha)
  if (!deps.fetchRef(pr0.headRefName)) { block('FETCH_FAILED', `${pr0.headRefName} 를 가져오지 못했다`); report.outcome = 'MERGE_BLOCKED'; return }
  const files = deps.listPrFiles(pr0.number)
  const mergeBase = deps.mergeBase(pr0.headRefOid, baseSha)
  if (!mergeBase) { block('MERGE_BASE_UNKNOWN', `#${pr0.number} 와 main 의 merge-base 를 읽지 못했다`); report.outcome = 'MERGE_BLOCKED'; return }
  const head = { articlesText: deps.showFile(pr0.headRefOid, ARTICLES_PATH), baseArticlesText: deps.showFile(mergeBase, ARTICLES_PATH), planTexts: {}, heroPresent: {} }
  const headRec = head.articlesText ? parseArticleRecordText(head.articlesText) : null
  const mainRec = main.articlesText ? parseArticleRecordText(main.articlesText) : null
  const added = headRec?.ok && mainRec?.ok ? headRec.slugs.filter((s) => !Object.prototype.hasOwnProperty.call(mainRec.record, s)) : []
  for (const s of added) {
    head.planTexts[planFilePath(s)] = deps.showFile(pr0.headRefOid, planFilePath(s))
    head.heroPresent[heroFilePath(s)] = deps.hasFile(pr0.headRefOid, heroFilePath(s))
  }
  // 다른 열린 매거진 PR 의 점유 — 이 PR 은 뺀다
  const occ = { dates: [], slugs: [] }
  const open = deps.listOpenMagazinePrs()
  if (!open.ok) { block('PR_LOOKUP_FAILED', open.reason); report.outcome = 'MERGE_BLOCKED'; return }
  for (const p of open.prs.filter((x) => x.number !== pr0.number)) {
    const o = mainRec?.ok ? occupiedByPr(deps, p, mainRec) : null
    if (!o) { block('OPEN_PR_UNREADABLE', `#${p.number} 의 점유를 읽지 못했다`); report.outcome = 'MERGE_BLOCKED'; return }
    occ.dates.push(...o.dates); occ.slugs.push(...o.slugs)
  }
  const nowMs = deps.now()
  const content = judgeReleaseContent({
    main: { bundle: main.bundle, controlText: main.controlText, articlesText: main.articlesText, legacyQueue: main.legacyQueue, bindingText: main.bindingText },
    head, changedFiles: files, occupied: occ, nowMs,
  })
  const prv = judgeReleasePr({ pr, expectedSha: pr0.headRefOid, ciState: ci.ciState, checks: ci.checks, rollout })
  // 🔴 재개 결속 — 이 PR 이 journal 이 기록한 그 release 인가(원본 commit · 바이트 · 검증된 원고 · hero · ProviderPlan). 같은 회차에 만든 PR 도 같은 줄을 지난다
  const { path: jp, journal: j0 } = journalOf(deps, releaseIdOf(pr0.headRefName))
  const cand = deps.readCandidates()
  const jobs = new Map((cand?.ok ? cand.candidates : []).map((c) => [c.planHash, { manuscriptSha256: c.manuscriptSha256 ?? null, heroSha256: c.hero?.sha256 ?? null, providerPlanHash: c.providerPlanHash ?? null }]))
  const resume = judgeResumeBinding({
    journal: j0, pr: pr0, headSha256Of: (p) => deps.fileSha256(pr0.headRefOid, p), jobOf: (planHash) => jobs.get(planHash) ?? null,
    providerPlanHashOf: (x) => {
      try {
        return projectProviderPlan({ admission: { bundle: main.bundle, controlText: main.controlText, articlesText: main.articlesText, legacyQueue: main.legacyQueue, nowMs, inFlightIntentIds: [] },
          planId: x.planId, planHash: x.planHash }).providerPlanHash
      } catch { return null }
    },
  })
  report.blockedBy.push(...resume.blockedBy, ...content.blockedBy, ...prv.blockedBy)
  m.checked.push(...resume.checked, ...content.checked, ...prv.checked)
  if (report.blockedBy.length) {
    // 낡은 release(날짜를 놓침 · main 이 움직임)는 변조가 아니다 — 닫고 같은 회차에 다시 조립한다(plan · 원고 · 해시 불변)
    const stale = content.blockedBy.find((b) => b.code === 'PUBLISH_AT_PAST' || b.code === 'PR_BASE_STALE')
    if (stale && resume.ok && content.blockedBy.every((b) => ['PUBLISH_AT_PAST', 'PR_BASE_STALE'].includes(b.code)) && prv.blockedBy.every((b) => b.code !== 'SHA_DRIFTED')) {
      // 🔴 복구 회차는 닫지도 다시 조립하지도 않는다(새 PR 0) — 다음 01:00 회차의 몫이다
      if (recover) { report.notes.push(`#${pr0.number} ${stale.code} — 복구 회차는 닫지 않는다 · 다음 01:00 회차가 닫고 다시 조립한다`); report.outcome = 'RECOVER_DEFERRED'; return }
      if (!closeRelease({ deps, pr: pr0, reason: `${stale.code} — 닫고 지금 main 과 같은 ContentPlan 으로 다시 조립한다`, report })) { closeFailed({ report, pr: pr0 }); return }
      report.notes.push(`#${pr0.number} ${stale.code} — 닫고 다시 조립한다`)
      report.blockedBy.length = mark
      report.outcome = 'REASSEMBLE'
      return
    }
    // 재개 결속이 어긋난 PR 은 보류다 — 닫지도 merge 하지도 않는다
    report.outcome = resume.ok ? 'MERGE_BLOCKED' : 'RESUME_HOLD'
    return
  }
  // 🔴 마지막 재조회 — 검증 뒤에 움직였는지
  const fresh = deps.getPr(pr0.number)
  if (!fresh || fresh.headRefOid !== pr0.headRefOid || fresh.baseRefName !== 'main' || fresh.mergeable !== 'MERGEABLE' || fresh.isDraft || fresh.state !== 'OPEN') {
    block('PR_MOVED_LATE', 'merge 직전 재조회에서 head · base · mergeable · draft · 상태가 바뀌었다'); report.outcome = 'MERGE_BLOCKED'; return
  }
  // 🔴 merge freeze — merge 호출 바로 앞에서 시각을 다시 읽는다(legacy 01:00 · 02:00 과 같은 판정)
  const freeze = judgeMergeFreeze(deps.now())
  if (freeze.frozen) { block(freeze.code, freeze.message); report.outcome = 'MERGE_FROZEN'; return }
  const merged = deps.mergePr(pr0.number, pr0.headRefOid)
  if (!merged.ok) { block('MERGE_FAILED', merged.reason); report.outcome = 'MERGE_BLOCKED'; return }
  m.merged = true
  m.mergeCommit = merged.mergeCommit ?? null
  const releaseId = releaseIdOf(pr0.headRefName)
  // 🔴 MERGED 는 "main 에 들어갔다" 다 — 서빙은 settleMerged 가 따로 적는다
  advanceJournal(jp, readJournal(jp), 'MERGED', { mergeCommit: m.mergeCommit, mergedPr: pr0.number, mainVerified: false }, { nowIso: iso(deps.now()) })
  report.outcome = await settleMerged({ deps, path: jp, report, waitMs: RELEASE_SERVING_OBSERVE_MS })
  m.verified = report.outcome !== 'MERGED_UNVERIFIED'
  report.serving = report.settled.find((s) => s.releaseId === releaseId) ?? null
  if (m.verified) cleanupRelease({ deps, releaseId, branch: pr0.headRefName, report })
}

/**
 * 진행 중 journal 정리 — 열린 release PR 목록에 없는 release 를 **journal 로** 이어 간다. 날짜가 바뀌어도 같은 release · 같은 브랜치 · 같은 journal 이다.
 *   MERGED            main 확인 · 서빙 관측이 덜 끝났으면 한 번 다시 본다(같은 SHA 를 SERVED 로 적었으면 관측 0)
 *   PR_OPEN           목록에 없다 — PR 을 조회해 MERGED · CLOSED 를 사실로 적는다(다시 merge 하지 않는다)
 *   COMMITTED·PUSHED  PR 을 만들기 전에 죽었다 — 그 브랜치의 PR 이 이미 있으면 받아들이고, 없고 공개 시각이 남았으면 같은 commit 으로 push → PR.
 *                     공개 시각을 놓쳤으면 ABANDONED(정리) — 같은 plan · 같은 원고로 다시 조립한다(재생성 0)
 *   PREPARED·APPLIED  commit 전이다 — 같은 날 재실행이 같은 releaseId 로 이어 쓴다. 조립 결과가 다른 id 면 호출자가 ABANDONED 로 정리한다
 * 🔴 복구 회차(recover)는 PR 을 만들지 않는다 — MERGED 마무리와 PR 상태 기록만 한다.
 * @returns {Promise<{ blocked: boolean, adopted: object|null, early: object[] }>}
 */
async function reconcileJournals({ deps, report, rollout, recover, openBranches }) {
  const out = { blocked: false, adopted: null, early: [] }
  const stop = (code, message, outcome = 'BLOCKED') => { report.blockedBy.push({ code, message }); report.outcome = outcome; out.blocked = true; return out }
  let all
  try { all = listReleaseJournals(deps.stateRoot) } catch (e) { return stop('JOURNALS_UNREADABLE', e?.code ?? e?.message) }
  const nowIso = iso(deps.now())
  for (const { releaseId, path, journal: j } of all) {
    if (j.broken) { report.notes.push(`release ${releaseId} journal 손상(${j.why}) — 자동으로 지우지 않는다`); continue }
    if (openBranches.has(j.branch)) continue
    if (j.state === 'MERGED') {
      if (j.mainVerified === true && ['SERVED', 'UNRESOLVED'].includes(j.serving?.state)) continue
      const o = await settleMerged({ deps, path, report, waitMs: 0 })
      if (o === 'MERGED_UNVERIFIED' || o === 'MERGED_SERVING_UNRESOLVED') { report.outcome = o; out.blocked = true; return out }
      continue
    }
    if (isTerminalJournal(j)) continue
    if (j.state === 'PR_OPEN') {
      const pr = deps.getPr(j.prNumber)
      if (!pr) return stop('PR_REFETCH_FAILED', `release ${releaseId} 의 #${j.prNumber} 를 읽지 못했다`)
      if (pr.state === 'MERGED') {
        // 밖에서 merge 됐거나 merge 호출 응답을 잃었다 — 다시 merge 하지 않고 사실만 적는다
        advanceJournal(path, j, 'MERGED', { mergeCommit: deps.getMergeCommit(pr.number), mergedPr: pr.number, mainVerified: false, closedReason: 'PR 이 이미 MERGED 다' }, { nowIso })
        cleanupRelease({ deps, releaseId, branch: j.branch, report })
        const o = await settleMerged({ deps, path, report, waitMs: 0 })
        report.notes.push(`release ${releaseId} #${pr.number} 는 이미 MERGED — 다시 merge 하지 않는다 (${o})`)
        if (o === 'MERGED_UNVERIFIED') { report.outcome = o; out.blocked = true; return out }
        continue
      }
      if (pr.state === 'CLOSED') {
        advanceJournal(path, j, 'CLOSED', { closedReason: 'PR 이 밖에서 CLOSED 됐다', closedPr: pr.number }, { nowIso })
        cleanupRelease({ deps, releaseId, branch: j.branch, report })
        report.notes.push(`release ${releaseId} #${pr.number} 는 밖에서 닫혔다 — journal CLOSED · 정리`)
        continue
      }
      return stop('RELEASE_PR_STATE_UNKNOWN', `release ${releaseId} 의 #${pr.number} 가 ${pr.state} 인데 열린 PR 목록에 없다 — 모르면 진행하지 않는다`)
    }
    if (j.state === 'PREPARED' || j.state === 'APPLIED') { out.early.push({ releaseId, path, journal: j }); continue }
    // COMMITTED · PUSHED
    const existing = deps.findPrByBranch(j.branch)
    if (existing) { advanceJournal(path, j, 'PR_OPEN', { prNumber: existing.number, prUrl: existing.url ?? null }, { nowIso }); out.adopted = existing; report.notes.push(`release ${releaseId} — 이미 열린 #${existing.number} 를 이어받는다`); break }
    if (recover) { report.notes.push(`release ${releaseId} 는 ${j.state} 에서 멈췄다 — 복구 회차는 PR 을 만들지 않는다(다음 01:00 회차)`); continue }
    if (!(minPublishMsOf(j.members) > deps.now())) {
      advanceJournal(path, j, 'ABANDONED', { abandonedBy: 'PUBLISH_AT_PAST' }, { nowIso })
      cleanupRelease({ deps, releaseId, branch: j.branch, report })
      report.notes.push(`release ${releaseId} 는 PR 전에 공개 시각을 놓쳤다 — 정리하고 같은 plan · 원고로 다시 조립한다`)
      continue
    }
    let cur = j
    if (cur.state === 'COMMITTED') {
      const wt = worktreePathOf(deps.stateRoot, releaseId)
      if (!existsSync(wt)) return stop('WORKTREE_MISSING', `release ${releaseId} 의 작업 사본이 없다 — commit ${String(cur.commitSha).slice(0, 7)} 을 push 할 수 없다`)
      const p = deps.push({ dir: wt, branch: cur.branch, sha: cur.commitSha })
      if (!p.ok) return stop('PUSH_FAILED', p.reason)
      cur = advanceJournal(path, cur, 'PUSHED', {}, { nowIso })
    }
    const pr = deps.createPr({ branch: cur.branch, draft: rollout.release === 'draft', ...prTextOf({ releaseId, graphVersion: cur.graphVersion, members: cur.members, rollout }) })
    if (!pr?.number) return stop('PR_CREATE_FAILED', pr?.reason ?? 'PR 을 만들지 못했다')
    advanceJournal(path, cur, 'PR_OPEN', { prNumber: pr.number, prUrl: pr.url ?? null }, { nowIso })
    out.adopted = deps.getPr(pr.number)
    if (!out.adopted) return stop('PR_REFETCH_FAILED', `#${pr.number} 를 다시 읽지 못했다`)
    report.notes.push(`release ${releaseId} — ${j.state} 에서 이어 #${pr.number} 를 열었다(같은 commit · 같은 journal)`)
    break
  }
  return out
}

/**
 * release 회차 하나.
 * @param {{ deps: object, apply: boolean, recover?: boolean }} p
 *   recover — 02:00 복구. **이미 열린 release PR 의 merge 단계와 merge 뒤 마무리만** 한다. 열린 PR의 Job 바이트를 다시 검사한다. 새 PR 조립은 01시 회차가 맡고, CI 실패 시 기존 PR의 닫기 결과를 기록한다
 */
export async function runRelease({ deps, apply, recover = false }) {
  const report = { schemaVersion: RUN_SCHEMA, mode: recover ? 'recover' : apply ? 'apply' : 'dry-run', at: iso(deps.now()), rollout: null, baseSha: null,
    occupied: null, release: null, merge: null, serving: null, settled: [], closed: [], blockedBy: [], notes: [], outcome: null }
  const block = (code, message, outcome = 'BLOCKED') => { report.blockedBy.push({ code, message }); report.outcome = outcome; return report }
  if (recover && !apply) return block('USAGE', '복구 회차는 실제 실행이다(apply)')

  // ① rollout — 회차 시작 때 한 번
  const ro = deps.readRollout()
  report.rollout = { code: ro.code, ...ro.effective }
  if (!(ro.code === 'VALID' && ro.effective.path === 'vnext')) { report.outcome = 'NOT_VNEXT'; return report }
  const rollout = ro.effective

  for (let attempt = 1; attempt <= 2; attempt++) {
    // ② main
    if (!deps.fetchMain()) return block('FETCH_FAILED', 'origin/main 을 가져오지 못했다')
    const baseSha = deps.readBaseSha()
    if (!baseSha) return block('BASE_SHA_UNKNOWN', 'origin/main SHA 를 읽지 못했다')
    report.baseSha = baseSha
    const main = readMainFacts(deps, baseSha)
    if (!main.articlesText || !main.controlText) return block('MAIN_UNREADABLE', 'main 의 articles.ts · control.ts 를 읽지 못했다')
    const mainRec = parseArticleRecordText(main.articlesText)
    if (!mainRec.ok) return block('ARTICLES_UNREADABLE', mainRec.code)

    // ③ 열린 매거진 PR — 점유 · 열린 release PR
    const open = deps.listOpenMagazinePrs()
    if (!open.ok) return block('PR_LOOKUP_FAILED', open.reason)
    const releasePrs = open.prs.filter((p) => releaseIdOf(p.headRefName))
    if (releasePrs.length > 1) return block('MULTIPLE_RELEASE_PRS', `열린 release PR 이 ${releasePrs.length}건이다 — 고르지 않는다`)
    const occ = { dates: [], slugs: [] }
    let openRelease = null
    for (const p of open.prs) {
      const o = occupiedByPr(deps, p, mainRec)
      if (!o) return block('OPEN_PR_UNREADABLE', `#${p.number} 의 점유(날짜 · slug)를 읽지 못했다 — 모르면 조립하지 않는다`)
      if (releaseIdOf(p.headRefName)) { openRelease = { pr: p, occ: o }; continue }
      occ.dates.push(...o.dates); occ.slugs.push(...o.slugs)
    }
    report.occupied = { dates: [...occ.dates].sort(), slugs: [...occ.slugs].sort(), openRelease: openRelease ? openRelease.pr.number : null }

    // ③-b 진행 중 journal — 목록에 없는 release 를 journal 로 이어 간다(쓰기가 있으므로 apply 만 · 한 회차에 한 번)
    let early = []
    if (apply && attempt === 1) {
      const rec = await reconcileJournals({ deps, report, rollout, recover, openBranches: new Set(releasePrs.map((p) => p.headRefName)) })
      if (rec.blocked) return report
      early = rec.early
      if (rec.adopted) {
        if (openRelease) return block('MULTIPLE_RELEASE_PRS', `열린 release PR #${openRelease.pr.number} 과 이어받은 #${rec.adopted.number} 가 함께 있다 — 고르지 않는다`)
        const o = occupiedByPr(deps, rec.adopted, mainRec)
        if (!o) return block('OPEN_PR_UNREADABLE', `#${rec.adopted.number} 의 점유(날짜 · slug)를 읽지 못했다`)
        openRelease = { pr: rec.adopted, occ: o }
        report.occupied.openRelease = rec.adopted.number
      }
    }

    // ④ 열린 release PR — 다음 release 만 기다린다(생성은 막지 않는다 · 생성은 S4)
    if (openRelease) {
      if (openRelease.occ.minPublishMs <= deps.now()) {
        if (!apply) { report.outcome = 'DRY_RUN_DATE_MISSED'; report.notes.push(`#${openRelease.pr.number} 날짜를 놓쳤다 — apply 회차가 닫고 다시 조립한다`); return report }
        // 🔴 복구 회차는 닫지도 다시 조립하지도 않는다(새 PR 0)
        if (recover) return block('RELEASE_DATE_MISSED', `#${openRelease.pr.number} 의 공개 시각이 지났다 — 복구 회차는 닫지 않는다 · 다음 01:00 회차가 닫고 다시 조립한다`, 'RECOVER_DEFERRED')
        if (!closeRelease({ deps, pr: openRelease.pr, reason: '날짜를 놓쳤다 — 닫고 같은 ContentPlan 으로 다시 조립한다(plan · 원고 · 해시 불변)', report })) { closeFailed({ report, pr: openRelease.pr }); return report }
        continue
      }
      if (!apply) { report.outcome = 'DRY_RUN_OPEN_RELEASE'; return report }
      await mergeStep({ deps, pr0: openRelease.pr, rollout, report, recover })
      if (report.outcome === 'REASSEMBLE') continue
      return report
    }
    // 🔴 복구 회차는 여기서 끝난다 — 후보 · 조립 · 새 PR 0
    if (recover) { report.outcome = 'RECOVER_NOTHING_OPEN'; return report }

    // ⑤ 후보 → 조립
    const cand = deps.readCandidates()
    if (!cand.ok) return block(cand.code, '후보(Job 저장소)를 읽지 못했다')
    for (const s of cand.skipped) report.notes.push(`Job ${s.dir.slice(0, 12)} 제외 — ${s.code}`)
    if (!cand.candidates.length) { report.outcome = 'NOTHING_TO_RELEASE'; return report }
    let slugRecords
    try { slugRecords = readSlugRecords(deps.stateRoot) } catch (e) { return block(e.code ?? 'SLUG_RECORDS_UNREADABLE', e.why ?? e.message) }
    const rel = assembleRelease({
      bundle: main.bundle ?? '', controlText: main.controlText, articlesText: main.articlesText, legacyQueue: main.legacyQueue, nowMs: deps.now(),
      candidates: cand.candidates.map(({ heroPath, ...c }) => c), slugRecords, occupied: occ, existingHeroSlugs: main.heroSlugs,
      targetCandidates: rollout.targetCandidates, baseSha,
    })
    report.release = { ok: rel.ok, code: rel.code, releaseId: rel.releaseId ?? null, branch: rel.branch ?? null,
      members: rel.members.map((x) => ({ planId: x.planId, intentId: x.intentId, slug: x.slug, slugSource: x.slugSource, publishAt: x.publishAt, layer: x.layer })),
      withdrawn: rel.withdrawn }
    if (!rel.ok) { report.outcome = 'NO_RELEASABLE_CANDIDATE'; return report }
    if (!apply) { report.outcome = 'DRY_RUN_ASSEMBLED'; return report }

    // ⑥ 쓰기 — slug 기록 → worktree → journal + CAS
    const nowIso = iso(deps.now())
    // commit 전에 멈춘 다른 release(날짜 · main · 구성이 달라져 id 가 바뀌었다)는 이어 쓸 수 없다 — ABANDONED 로 적고 정리한다(원고 · plan 은 그대로다)
    for (const e of early.filter((x) => x.releaseId !== rel.releaseId)) {
      advanceJournal(e.path, e.journal, 'ABANDONED', { abandonedBy: 'SUPERSEDED', supersededBy: rel.releaseId }, { nowIso })
      cleanupRelease({ deps, releaseId: e.releaseId, branch: e.journal.branch, report })
      report.notes.push(`release ${e.releaseId} 는 commit 전에 멈췄고 지금 조립과 다르다 — ABANDONED`)
    }
    try {
      for (const x of rel.members) if (x.slugSource !== 'RECORDED') recordSlug({ stateRoot: deps.stateRoot, intentId: x.intentId, slug: x.slug, planHash: x.planHash, nowIso })
    } catch (e) { return block(e.code ?? 'SLUG_RECORD_FAILED', e.why ?? e.message) }
    const wt = worktreePathOf(deps.stateRoot, rel.releaseId)
    const jp = journalPathOf(deps.stateRoot, rel.releaseId)
    // 같은 main · 같은 구성 · 같은 날짜의 release 가 이미 닫혔다(CI 실패 등) — 같은 것을 다시 만들지 않는다(worktree 도 만들지 않는다)
    const prior = readJournal(jp)
    if (prior?.broken) return block('JOURNAL_BROKEN', `${jp} 를 읽지 못했다 — 자동으로 지우지 않는다`)
    if (prior && isTerminalJournal(prior)) return block('JOURNAL_TERMINAL', `release ${rel.releaseId} 는 이미 ${prior.state} 다 — main 이나 후보가 바뀔 때까지 같은 release 를 다시 만들지 않는다`, 'WAITING_MAIN_CHANGE')
    const prepared = deps.prepareWorktree({ dir: wt, branch: rel.branch, baseSha })
    if (!prepared.ok) return block('WORKTREE_FAILED', prepared.reason)
    const heroOf = new Map(cand.candidates.map((c) => [c.planHash, c.heroPath]))
    let journal
    try {
      ({ journal } = applyReleaseFiles({ worktree: wt, journalPath: jp, release: { ...rel, baseSha }, heroBytesOf: (m) => readFileSync(heroOf.get(m.planHash)), nowIso,
        beforeArticlesRename: deps.beforeArticlesRename ?? null }))
    } catch (e) {
      if (e instanceof ReleaseWriteError && e.code === 'ARTICLES_CAS_MISMATCH' && attempt === 1) { report.notes.push('articles.ts CAS 불일치 — release 를 처음부터 다시 조립한다'); deps.removeWorktree(wt); continue }
      // 같은 main · 같은 구성 · 같은 날짜의 release 가 이미 닫혔다(CI 실패 등) — main 이나 후보가 바뀔 때까지 같은 것을 다시 만들지 않는다
      if (e instanceof ReleaseWriteError && e.code === 'JOURNAL_TERMINAL') return block(e.code, e.why, 'WAITING_MAIN_CHANGE')
      return block(e.code ?? 'RELEASE_WRITE_FAILED', e.why ?? e.message)
    }

    // ⑦ commit → push → PR (각 단계는 사실로 다시 확인하고 이어 간다)
    const paths = [ARTICLES_PATH, ...rel.files.map((f) => f.path)]
    if (journal.state === 'APPLIED') {
      const c = deps.commit({ dir: wt, paths, message: `feat(magazine): vNext release ${rel.releaseId}\n\n${rel.members.map((x) => `- ${x.slug} · ${x.intentId} · ${x.publishAt} · plan ${x.planHash.slice(0, 12)}`).join('\n')}\n` })
      if (!c.ok) return block('COMMIT_FAILED', c.reason)
      journal = advanceJournal(jp, journal, 'COMMITTED', { commitSha: c.sha }, { nowIso })
    }
    if (journal.state === 'COMMITTED') {
      const p = deps.push({ dir: wt, branch: rel.branch, sha: journal.commitSha })
      if (!p.ok) return block('PUSH_FAILED', p.reason)
      journal = advanceJournal(jp, journal, 'PUSHED', {}, { nowIso })
    }
    if (journal.state === 'PUSHED') {
      const existing = deps.findPrByBranch(rel.branch)
      const pr = existing ?? deps.createPr({ branch: rel.branch, draft: rollout.release === 'draft', ...prTextOf({ releaseId: rel.releaseId, graphVersion: rel.graphVersion, members: rel.members, rollout }) })
      if (!pr?.number) return block('PR_CREATE_FAILED', pr?.reason ?? 'PR 을 만들지 못했다')
      journal = advanceJournal(jp, journal, 'PR_OPEN', { prNumber: pr.number, prUrl: pr.url ?? null }, { nowIso })
    }
    report.release.pr = journal.prNumber ?? null
    const pr = deps.getPr(journal.prNumber)
    if (!pr) return block('PR_REFETCH_FAILED', `#${journal.prNumber} 를 다시 읽지 못했다`)
    if (pr.state !== 'OPEN') {
      // 사람이 닫았다(A commissioning 의 "아니오" 등) — 사실로 기록하고 정리한다. 같은 main 에서는 같은 release 를 다시 만들지 않는다
      advanceJournal(jp, journal, pr.state === 'MERGED' ? 'MERGED' : 'CLOSED',
        pr.state === 'MERGED' ? { mergeCommit: deps.getMergeCommit(pr.number), mergedPr: pr.number, mainVerified: false, closedReason: `PR 이 밖에서 ${pr.state} 됐다` } : { closedReason: `PR 이 밖에서 ${pr.state} 됐다`, closedPr: pr.number }, { nowIso })
      cleanupRelease({ deps, releaseId: rel.releaseId, branch: rel.branch, report })
      if (pr.state === 'MERGED') {
        report.notes.push(`#${pr.number} 는 사람이 병합했다(Draft release)`)
        report.outcome = await settleMerged({ deps, path: jp, report, waitMs: 0 })
        report.serving = report.settled.find((s) => s.releaseId === rel.releaseId) ?? null
        return report
      }
      return block('RELEASE_PR_CLOSED_EXTERNALLY', `#${pr.number} 가 ${pr.state} 다 — 시스템을 고치거나 main 이 바뀐 뒤 다시 조립한다`, 'WAITING_MAIN_CHANGE')
    }
    if (rollout.release !== 'auto') { report.outcome = 'DRAFT_RELEASE_OPEN'; return report }
    await mergeStep({ deps, pr0: pr, rollout, report })
    if (report.outcome === 'REASSEMBLE') continue
    return report
  }
  return block('REASSEMBLE_EXHAUSTED', '한 회차에서 두 번 다시 조립했지만 끝내지 못했다 — 다음 회차')
}

// ── 실제 실행기 ─────────────────────────────────────────────

/** 실제 git · gh 실행기 — cwd 는 runtime 저장소(이 파일의 두 단계 위) */
export function makeReleaseDeps({ root, stateRoot, jobsRoot, readRollout, readCandidates, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), exec = defaultExec,
  execBytes = defaultExecBytes, vercelContext = () => resolveVercelContext() }) {
  const git = (args, cwd = root) => exec('git', args, cwd)
  const gh = (args) => exec('gh', args, root)
  return {
    now, sleep, stateRoot, jobsRoot, readRollout, readCandidates,
    /** 그 commit 의 파일 바이트 해시 — hero 는 이진이라 문자열로 읽지 않는다. 못 읽으면 null(재개 결속이 막는다) */
    fileSha256: (sha, path) => { const r = execBytes('git', ['cat-file', 'blob', `${sha}:${path}`], root); return r.code === 0 && Buffer.isBuffer(r.out) ? createHash('sha256').update(r.out).digest('hex') : null },
    getMergeCommit: (n) => { const r = gh(['pr', 'view', String(n), '--json', 'mergeCommit', '--jq', '.mergeCommit.oid']); const v = r.code === 0 ? r.out.trim() : ''; return HEX40.test(v) ? v : null },
    /**
     * 그 merge SHA 가 운영 도메인에서 서빙되는가 — legacy 병합기가 쓰는 Vercel 직접 증거(`verifyVercelDirect`)를 그대로 쓴다(읽기 둘 · 판정 사본 0).
     * 도메인이 가리키는 배포의 gitSource.sha · production · READY · id 가 모두 맞을 때만 served 다. HTTP 200 은 증거가 아니다.
     */
    observeServing: (sha) => {
      const v = verifyVercelDirect({ sha, exec: (cmd, args, opts) => exec(cmd, args, root, opts), context: vercelContext() })
      return v.ok ? { served: true, code: null, deploymentId: v.deployment.deploymentId } : { served: false, code: v.code, deploymentId: null }
    },
    fetchMain: () => git(['fetch', 'origin', 'main']).code === 0,
    readBaseSha: () => { const r = git(['rev-parse', 'origin/main']); return r.code === 0 ? r.out.trim() : null },
    // 🔴 강제 갱신 refspec — PR 브랜치가 비정상으로 다시 쓰여도 그 head 를 읽어 관문이 판정하게 한다(못 읽으면 fail-closed)
    fetchRef: (branch) => git(['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]).code === 0,
    showFile: (sha, path) => { const r = git(['show', `${sha}:${path}`]); return r.code === 0 ? r.out : null },
    hasFile: (sha, path) => git(['cat-file', '-e', `${sha}:${path}`]).code === 0,
    listHeroSlugs: (sha) => { const r = git(['ls-tree', '--name-only', `${sha}`, 'public/magazine/']); return r.code === 0 ? r.out.split('\n').filter(Boolean).map((p) => p.split('/').pop()) : [] },
    listOpenMagazinePrs: () => {
      const r = gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', PR_FIELDS])
      if (r.code !== 0) return { ok: false, reason: 'gh 로 PR 목록을 읽지 못했다' }
      try { return { ok: true, prs: JSON.parse(r.out || '[]').filter((p) => [RELEASE_BRANCH_PREFIX, LEGACY_AUTO_PREFIX].some((x) => String(p.headRefName ?? '').startsWith(x))) } } catch { return { ok: false, reason: 'PR 목록 해석 실패' } }
    },
    getPr: (n) => { const r = gh(['pr', 'view', String(n), '--json', PR_FIELDS]); if (r.code !== 0) return null; try { return JSON.parse(r.out) } catch { return null } },
    findPrByBranch: (branch) => {
      const r = gh(['pr', 'list', '--state', 'open', '--head', branch, '--json', PR_FIELDS])
      if (r.code !== 0) return null
      try { const xs = JSON.parse(r.out || '[]'); return xs.length === 1 ? xs[0] : null } catch { return null }
    },
    listPrFiles: (n) => { const r = gh(['pr', 'view', String(n), '--json', 'files']); if (r.code !== 0) return []; try { return (JSON.parse(r.out).files ?? []).map((f) => f.path) } catch { return [] } },
    getChecks: (sha) => {
      const s = gh(['api', `repos/{owner}/{repo}/commits/${sha}/status`, '--jq', '.state'])
      const c = gh(['api', `repos/{owner}/{repo}/commits/${sha}/check-runs`, '--jq', '[.check_runs[] | {name, status, conclusion}]'])
      if (s.code !== 0 || c.code !== 0) return { ok: false, ciState: 'unknown', checks: [] }
      try { return { ok: true, ciState: s.out.trim(), checks: JSON.parse(c.out || '[]') } } catch { return { ok: false, ciState: 'unknown', checks: [] } }
    },
    prepareWorktree: ({ dir, branch, baseSha }) => {
      if (existsSync(dir)) {
        const h = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
        return h.code === 0 && h.out.trim() === branch ? { ok: true, reused: true } : { ok: false, reason: `${dir} 가 ${branch} 작업 사본이 아니다 — 자동으로 지우지 않는다` }
      }
      const exists = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0
      const r = exists ? git(['worktree', 'add', dir, branch]) : git(['worktree', 'add', '-b', branch, dir, baseSha])
      return r.code === 0 ? { ok: true, reused: false } : { ok: false, reason: (r.err || r.out).trim().split('\n').pop() }
    },
    commit: ({ dir, paths, message }) => {
      const add = git(['add', '--', ...paths], dir)
      if (add.code !== 0) return { ok: false, reason: add.err.trim() }
      const staged = git(['diff', '--cached', '--name-only'], dir)
      if (staged.code === 0 && staged.out.trim() === '') {
        // 앞 실행이 commit 까지 하고 죽었다 — HEAD 가 그 commit 이면 그대로 쓴다
        const head = git(['rev-parse', 'HEAD'], dir)
        return head.code === 0 ? { ok: true, sha: head.out.trim(), reused: true } : { ok: false, reason: 'HEAD 를 읽지 못했다' }
      }
      const c = git(['commit', '-m', message], dir)
      if (c.code !== 0) return { ok: false, reason: (c.err || c.out).trim().split('\n').pop() }
      const head = git(['rev-parse', 'HEAD'], dir)
      return { ok: head.code === 0, sha: head.out.trim() }
    },
    push: ({ dir, branch, sha }) => {
      const remote = git(['ls-remote', 'origin', `refs/heads/${branch}`], dir)
      if (remote.code === 0 && remote.out.split(/\s/)[0] === sha) return { ok: true, reused: true }
      const r = git(['push', 'origin', `${sha}:refs/heads/${branch}`], dir)
      return r.code === 0 ? { ok: true } : { ok: false, reason: (r.err || r.out).trim().split('\n').pop() }
    },
    createPr: ({ branch, title, body, draft }) => {
      const r = gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body, ...(draft ? ['--draft'] : [])])
      if (r.code !== 0) return { reason: (r.err || r.out).trim().split('\n').pop() }
      const url = r.out.trim().split('\n').pop()
      const n = Number((url.match(/\/pull\/(\d+)/) ?? [])[1])
      return Number.isSafeInteger(n) ? { number: n, url } : { reason: `PR 번호를 읽지 못했다: ${url}` }
    },
    closePr: (n, comment) => { const r = gh(['pr', 'close', String(n), '--comment', comment]); return { ok: r.code === 0 } },
    mergePr: (n, sha) => {
      const r = gh(['pr', 'merge', String(n), '--squash', '--match-head-commit', sha])
      if (r.code !== 0) return { ok: false, reason: (r.err || r.out).trim().split('\n').pop() }
      const after = gh(['pr', 'view', String(n), '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'])
      return { ok: true, mergeCommit: after.code === 0 ? after.out.trim() : null }
    },
    removeWorktree: (dir) => git(['worktree', 'remove', dir]).code === 0,
    mergeBase: (a, b) => { const r = git(['merge-base', a, b]); return r.code === 0 ? r.out.trim() : null },
    /** release 브랜치만 — 원격(있으면) · 로컬(있으면). worktree 를 먼저 지운 뒤 부른다 */
    deleteBranch: (branch) => {
      if (!releaseIdOf(branch)) return false
      const remote = git(['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`])
      const r1 = remote.code === 0 ? git(['push', 'origin', '--delete', branch]).code === 0 : true
      const local = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0
      const r2 = local ? git(['branch', '-D', branch]).code === 0 : true
      return r1 && r2
    },
  }
}

function defaultExec(cmd, args, cwd, { timeoutMs } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...(timeoutMs ? { timeout: timeoutMs } : {}) })
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? (r.error ? String(r.error.message) : '') }
}
/** 이진 출력용 — stdout 을 Buffer 그대로 돌려준다 */
function defaultExecBytes(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? 1, out: r.stdout ?? Buffer.alloc(0) }
}
