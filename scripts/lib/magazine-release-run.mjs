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
 *      merge freeze → `gh pr merge --squash --match-head-commit` → main 에 행이 실제로 들어갔는지 확인
 *
 * 🔴 재실행 — 어느 단계에서 죽어도 같은 release 를 이어 간다(journal 상태 + 사실 재확인). 같은 PR 을 두 번 만들지 않는다.
 * 🔴 legacy 모듈(queue writer · register · legacy merge gate · auto-merge)을 import 하지 않는다 — 같은 위험을 같은 방식으로 따로 막는다.
 * 🔴 `--admin` · force push · `git add .` 0. merge 는 검증한 head SHA 로만.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { judgeMergeFreeze } from './magazine-merge-freeze.mjs'
import {
  ARTICLES_PATH, BINDING_PATH, RELEASE_BRANCH_PREFIX, assembleRelease, bundleFilePath, heroFilePath, judgeReleaseContent, parseArticleRecordText,
  planFilePath,
} from './magazine-release.mjs'
import { parseArticleIdentityText, strictControlGraphVersion } from './magazine-content-plan.mjs'
import { strictPublishAtMs } from './magazine-public-rule.mjs'
import {
  ReleaseWriteError, advanceJournal, applyReleaseFiles, isTerminalJournal, journalPathOf, readJournal, readSlugRecords, recordSlug, worktreePathOf,
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
  if (!String(pr.headRefName ?? '').startsWith(RELEASE_BRANCH_PREFIX)) block('NOT_RELEASE_BRANCH', `${pr.headRefName} 는 vNext release 브랜치가 아니다`)
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

/** main 사실 — 이 시점의 origin/main 바이트 */
function readMainFacts(deps, baseSha) {
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

/** release PR 하나를 닫는다 — journal 을 CLOSED 로(후보는 검증됨 그대로 · 같은 plan 으로 다시 조립된다) */
function closeRelease({ deps, pr, reason, report }) {
  const r = deps.closePr(pr.number, reason)
  report.closed.push({ number: pr.number, branch: pr.headRefName, reason, ok: r.ok })
  if (!r.ok) return false
  const releaseId = pr.headRefName.slice(RELEASE_BRANCH_PREFIX.length)
  try {
    const jp = journalPathOf(deps.stateRoot, releaseId)
    const j = readJournal(jp)
    if (j && !j.broken && !isTerminalJournal(j)) advanceJournal(jp, j, 'CLOSED', { closedReason: reason, closedPr: pr.number }, { nowIso: iso(deps.now()) })
  } catch (e) { report.notes.push(`닫은 release 의 journal 기록 실패 (${e?.code ?? e?.message}) — PR 은 닫혔다`) }
  cleanupRelease({ deps, releaseId, branch: pr.headRefName, report })
  return true
}

/** release 잔존물 정리 — 그 release 의 worktree · 원격/로컬 브랜치(접두가 release 인 이름만). 실패는 기록만 한다(판정을 바꾸지 않는다) */
function cleanupRelease({ deps, releaseId, branch, report }) {
  if (!branch.startsWith(RELEASE_BRANCH_PREFIX)) return
  const wt = worktreePathOf(deps.stateRoot, releaseId)
  if (existsSync(wt) && !deps.removeWorktree(wt)) report.notes.push(`${wt} worktree 를 지우지 못했다`)
  if (!deps.deleteBranch(branch)) report.notes.push(`${branch} 브랜치를 지우지 못했다`)
}

/**
 * merge 단계 — auto 모드의 열린 release PR 하나.
 * @returns {Promise<void>} report 를 채운다
 */
async function mergeStep({ deps, pr0, rollout, report }) {
  const m = report.merge = { number: pr0.number, branch: pr0.headRefName, head: pr0.headRefOid, ci: null, merged: false, mergeCommit: null, verified: false, checked: [] }
  const mark = report.blockedBy.length
  const block = (code, message) => report.blockedBy.push({ code, message })
  if (rollout.release !== 'auto') { report.outcome = 'WAITING_FOUNDER_DRAFT'; return }
  const ci = await observeCi({ deps, sha: pr0.headRefOid })
  m.ci = { outcome: ci.outcome, ciState: ci.ciState, checks: ci.checks.length }
  if (ci.outcome === 'FAILED') {
    // 🔴 release CI 실패 — 그 release 만 닫는다. 후보는 검증됨으로 남고 다음 회차가 다시 조립한다
    closeRelease({ deps, pr: pr0, reason: 'release CI 실패 — 후보는 검증됨으로 되돌아가 다음 회차에 다시 조립된다', report })
    report.outcome = 'RELEASE_CI_FAILED_CLOSED'
    block('RELEASE_CI_FAILED', `#${pr0.number} CI 실패`)
    return
  }
  if (ci.outcome === 'TIMEOUT') { report.outcome = 'CI_PENDING'; block('CI_OBSERVE_TIMEOUT', `${RELEASE_CI_OBSERVE_MS / 60000}분 안에 CI 가 끝나지 않았다 — 다음 회차가 같은 PR 을 다시 본다`); return }
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
  const content = judgeReleaseContent({
    main: { bundle: main.bundle, controlText: main.controlText, articlesText: main.articlesText, legacyQueue: main.legacyQueue, bindingText: main.bindingText },
    head, changedFiles: files, occupied: occ, nowMs: deps.now(),
  })
  const prv = judgeReleasePr({ pr, expectedSha: pr0.headRefOid, ciState: ci.ciState, checks: ci.checks, rollout })
  report.blockedBy.push(...content.blockedBy, ...prv.blockedBy)
  m.checked.push(...content.checked, ...prv.checked)
  if (report.blockedBy.length) {
    // 낡은 release(날짜를 놓침 · main 이 움직임)는 변조가 아니다 — 닫고 같은 회차에 다시 조립한다(plan · 원고 · 해시 불변)
    const stale = content.blockedBy.find((b) => b.code === 'PUBLISH_AT_PAST' || b.code === 'PR_BASE_STALE')
    if (stale && content.blockedBy.every((b) => ['PUBLISH_AT_PAST', 'PR_BASE_STALE'].includes(b.code)) && prv.blockedBy.every((b) => b.code !== 'SHA_DRIFTED')) {
      closeRelease({ deps, pr: pr0, reason: `${stale.code} — 닫고 지금 main 과 같은 ContentPlan 으로 다시 조립한다`, report })
      report.notes.push(`#${pr0.number} ${stale.code} — 닫고 다시 조립한다`)
      report.blockedBy.length = mark
      report.outcome = 'REASSEMBLE'
      return
    }
    report.outcome = 'MERGE_BLOCKED'
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
  const releaseId = pr0.headRefName.slice(RELEASE_BRANCH_PREFIX.length)
  const jp = journalPathOf(deps.stateRoot, releaseId)
  const j = readJournal(jp)
  if (j && !j.broken && !isTerminalJournal(j)) advanceJournal(jp, j, 'MERGED', { mergeCommit: m.mergeCommit, mergedPr: pr0.number }, { nowIso: iso(deps.now()) })
  // main 에 실제로 들어갔는가 — 출처 있는 행으로
  const after = deps.fetchMain() ? deps.showFile(deps.readBaseSha(), ARTICLES_PATH) : null
  const ids = after ? parseArticleIdentityText(after) : { ok: false }
  m.verified = ids.ok && content.members.every((x) => ids.rows.some((r) => r.slug === x.slug && r.release?.planHash === x.planHash && r.publishAt === x.publishAt))
  if (!m.verified) { block('MERGE_UNVERIFIED', 'merge 뒤 main 에서 release 행을 확인하지 못했다'); report.outcome = 'MERGED_UNVERIFIED'; return }
  cleanupRelease({ deps, releaseId, branch: pr0.headRefName, report })
  report.outcome = 'MERGED'
}

/**
 * release 회차 하나.
 * @param {{ deps: object, apply: boolean }} p
 */
export async function runRelease({ deps, apply }) {
  const report = { schemaVersion: RUN_SCHEMA, mode: apply ? 'apply' : 'dry-run', at: iso(deps.now()), rollout: null, baseSha: null,
    occupied: null, release: null, merge: null, closed: [], blockedBy: [], notes: [], outcome: null }
  const block = (code, message, outcome = 'BLOCKED') => { report.blockedBy.push({ code, message }); report.outcome = outcome; return report }

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
    const releasePrs = open.prs.filter((p) => p.headRefName.startsWith(RELEASE_BRANCH_PREFIX))
    if (releasePrs.length > 1) return block('MULTIPLE_RELEASE_PRS', `열린 release PR 이 ${releasePrs.length}건이다 — 고르지 않는다`)
    const occ = { dates: [], slugs: [] }
    let openRelease = null
    for (const p of open.prs) {
      const o = occupiedByPr(deps, p, mainRec)
      if (!o) return block('OPEN_PR_UNREADABLE', `#${p.number} 의 점유(날짜 · slug)를 읽지 못했다 — 모르면 조립하지 않는다`)
      if (p.headRefName.startsWith(RELEASE_BRANCH_PREFIX)) { openRelease = { pr: p, occ: o }; continue }
      occ.dates.push(...o.dates); occ.slugs.push(...o.slugs)
    }
    report.occupied = { dates: [...occ.dates].sort(), slugs: [...occ.slugs].sort(), openRelease: openRelease ? openRelease.pr.number : null }

    // ④ 열린 release PR — 다음 release 만 기다린다(생성은 막지 않는다 · 생성은 S4)
    if (openRelease) {
      if (openRelease.occ.minPublishMs <= deps.now()) {
        if (!apply) { report.outcome = 'DRY_RUN_DATE_MISSED'; report.notes.push(`#${openRelease.pr.number} 날짜를 놓쳤다 — apply 회차가 닫고 다시 조립한다`); return report }
        closeRelease({ deps, pr: openRelease.pr, reason: '날짜를 놓쳤다 — 닫고 같은 ContentPlan 으로 다시 조립한다(plan · 원고 · 해시 불변)', report })
        continue
      }
      if (!apply) { report.outcome = 'DRY_RUN_OPEN_RELEASE'; return report }
      await mergeStep({ deps, pr0: openRelease.pr, rollout, report })
      if (report.outcome === 'REASSEMBLE') continue
      return report
    }

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
      const pr = existing ?? deps.createPr({ branch: rel.branch, draft: rollout.release === 'draft',
        title: `[magazine release] ${rel.members.map((x) => x.slug).join(', ')}`,
        body: [`vNext release ${rel.releaseId} · graph ${rel.graphVersion} · rollout ${rollout.release}`, '',
          ...rel.members.map((x) => `- \`${x.slug}\` — ${x.intentId} · ${x.publishAt} · plan \`${x.planHash}\` · 층 ${x.layer}`), '',
          rollout.release === 'draft' ? '🔴 Draft release — 자동 merge 0. 창업자가 dev 렌더를 확인하고 병합 여부를 정한다.' : 'auto — vNext merge gate(재컴파일 · admission · 결속 · freeze)를 통과해야 merge 된다.'].join('\n') })
      if (!pr?.number) return block('PR_CREATE_FAILED', pr?.reason ?? 'PR 을 만들지 못했다')
      journal = advanceJournal(jp, journal, 'PR_OPEN', { prNumber: pr.number, prUrl: pr.url ?? null }, { nowIso })
    }
    report.release.pr = journal.prNumber ?? null
    const pr = deps.getPr(journal.prNumber)
    if (!pr) return block('PR_REFETCH_FAILED', `#${journal.prNumber} 를 다시 읽지 못했다`)
    if (pr.state !== 'OPEN') {
      // 사람이 닫았다(A commissioning 의 "아니오" 등) — 사실로 기록하고 정리한다. 같은 main 에서는 같은 release 를 다시 만들지 않는다
      advanceJournal(jp, journal, pr.state === 'MERGED' ? 'MERGED' : 'CLOSED', { closedReason: `PR 이 밖에서 ${pr.state} 됐다`, closedPr: pr.number }, { nowIso })
      cleanupRelease({ deps, releaseId: rel.releaseId, branch: rel.branch, report })
      if (pr.state === 'MERGED') { report.notes.push(`#${pr.number} 는 사람이 병합했다(Draft release)`); report.outcome = 'MERGED'; return report }
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
export function makeReleaseDeps({ root, stateRoot, jobsRoot, readRollout, readCandidates, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), exec = defaultExec }) {
  const git = (args, cwd = root) => exec('git', args, cwd)
  const gh = (args) => exec('gh', args, root)
  return {
    now, sleep, stateRoot, jobsRoot, readRollout, readCandidates,
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
      if (!branch.startsWith(RELEASE_BRANCH_PREFIX)) return false
      const remote = git(['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`])
      const r1 = remote.code === 0 ? git(['push', 'origin', '--delete', branch]).code === 0 : true
      const local = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).code === 0
      const r2 = local ? git(['branch', '-D', branch]).code === 0 : true
      return r1 && r2
    },
  }
}

function defaultExec(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? (r.error ? String(r.error.message) : '') }
}
