#!/usr/bin/env tsx
/**
 * M-GRAPH 그래프 전용 자동 병합 레인.
 *
 * ── 🔴 왜 원고 레인을 그대로 쓰지 않는가 ──
 *
 *   `magazine-auto-merge.mjs` 의 판정(`judgeAutoMerge`)은 **원고 등록**을 본다 —
 *   등록 slug · publishAt · 큐 등급 · 중복 날짜. 그래프 PR 에는 그런 것이 없다.
 *   억지로 통과시키려면 가짜 등록 정보를 만들어 넣어야 하고, 그 순간
 *   **원고 레인의 관문이 그만큼 약해진다.** 시험이 실제보다 강할 수 없듯,
 *   관문도 자기가 모르는 것을 통과시키면 안 된다.
 *
 *   그래서 레인을 나눈다. 대신 **안전장치는 빌려 쓴다** —
 *   CI 계약(`REQUIRED_CHECKS` · `OK_CONCLUSIONS` · `REQUIRED_CONCLUSIONS`)과
 *   PR 조회 필드(`PR_FIELDS_ARG`)를 원고 레인에서 그대로 import 한다.
 *   M-AUTO 가 필수 검사를 늘리면 이 레인도 **자동으로** 따라간다. 사본이 아니다.
 *
 * ── 🔴 소유권과 1건 계약이 보존된다 ──
 *   원고 레인은 `feat/magazine-auto-register-` 로 PR 을 **필터해서** 찾는다.
 *   이 레인은 `chore/mgraph-graph-` 다. 서로의 PR 이 서로의 목록에 **들어가지 않는다** —
 *   그래서 각자 "미해결 1건" 을 따로 지킨다. 그래프 PR 하나가 떠 있다고
 *   원고 자동 발행이 막히지 않고, 그 반대도 아니다.
 *
 * ── 🔴 건드려도 되는 파일 ──
 *   `src/content/magazine/graph/` 의 네 파일뿐이다. 하나라도 벗어나면 막는다.
 *   원고·이미지·스키마·워크플로우를 이 레인이 만지는 경로는 없다.
 *
 * 사용법
 *   npx tsx scripts/magazine-graph-merge.mts                 검증만 (변경 0)
 *   npx tsx scripts/magazine-graph-merge.mts --apply         🔴 push → PR → 자동 병합
 *   npx tsx scripts/magazine-graph-merge.mts --reason "..."  커밋·PR 에 적을 사유
 *
 * 종료 코드: 막힌 것이 있으면 1
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  OK_CONCLUSIONS,
  PR_FIELDS_ARG,
  REQUIRED_CHECKS,
  REQUIRED_CONCLUSIONS,
} from './lib/magazine-merge-gate.mjs'

const ROOT = join(import.meta.dirname, '..')

/** 🔴 원고 레인(`feat/magazine-auto-register-`)과 **겹치지 않는다** */
export const GRAPH_BRANCH_PREFIX = 'chore/mgraph-graph-'

/** 🔴 이 레인이 건드려도 되는 파일. 네 가지 모양뿐이다 */
export const GRAPH_ALLOWED_FILE =
  /^src\/content\/magazine\/graph\/(types|current|control|g-\d{8}-[0-9a-f]+)\.ts$/

export const isGraphLaneFile = (path: string): boolean => GRAPH_ALLOWED_FILE.test(path)

export type Pr = {
  number: number
  url: string
  headRefName: string
  headRefOid: string
  state: string
  mergeable: string
  isDraft: boolean
}

export type Blocked = { code: string; message: string }

export type GraphMergeJudgement = {
  ok: boolean
  blockedBy: Blocked[]
  checked: string[]
}

/**
 * 이 PR 을 자동으로 merge 해도 되는가.
 *
 * 🔴 순수 함수다. 네트워크도 git 도 모른다 — fixture 가 이 판정을 통째로 돌린다.
 */
export function judgeGraphMerge({
  pr,
  expectedSha,
  files,
  ciState,
  checks = [],
}: {
  pr: Pr | null
  expectedSha: string
  files: string[]
  ciState: string
  checks?: { name: string; status: string; conclusion: string | null }[]
}): GraphMergeJudgement {
  const blockedBy: Blocked[] = []
  const checked: string[] = []
  const block = (code: string, message: string) => blockedBy.push({ code, message })
  const pass = (name: string) => checked.push(name)

  if (!pr) {
    block('NO_PR', '그래프 자동 PR 을 찾지 못했다')
    return { ok: false, blockedBy, checked }
  }

  // ── ① PR 자체 ──
  if (typeof pr.headRefName !== 'string' || pr.headRefName === '') {
    block('PR_FIELDS_INCOMPLETE', `PR 조회에 headRefName 이 없다 — 조회 필드가 PR_FIELDS_ARG 와 어긋났다`)
  } else if (!pr.headRefName.startsWith(GRAPH_BRANCH_PREFIX)) {
    // 🔴 사람 PR 도, 원고 레인 PR 도 여기서 막힌다
    block('NOT_GRAPH_BRANCH', `${pr.headRefName} 는 그래프 레인 브랜치가 아니다`)
  } else pass('그래프 레인 브랜치')

  if (pr.state !== 'OPEN') block('NOT_OPEN', `PR 상태가 ${pr.state} 다`)
  else pass('OPEN')

  if (pr.isDraft) block('IS_DRAFT', 'draft PR 이다')
  else pass('draft 아님')

  if (pr.mergeable !== 'MERGEABLE') block('NOT_MERGEABLE', `mergeable=${pr.mergeable}`)
  else pass('MERGEABLE')

  // 🔴 우리가 검사한 그 커밋이어야 한다. 사이에 다른 커밋이 끼면 막는다.
  if (pr.headRefOid !== expectedSha) {
    block('SHA_MOVED', `PR head 가 ${String(pr.headRefOid).slice(0, 7)} 로 움직였다 (검사한 것은 ${expectedSha.slice(0, 7)})`)
  } else pass('SHA 고정')

  // ── ② 파일 ──
  if (files.length === 0) block('NO_FILES', 'PR 이 바꾼 파일이 없다')
  else {
    const foreign = files.filter((f) => !isGraphLaneFile(f))
    if (foreign.length > 0) {
      block('UNEXPECTED_FILES', `그래프 밖 파일이 ${foreign.length}건 있다: ${foreign.slice(0, 3).join(' · ')}`)
    } else pass(`그래프 파일만 ${files.length}건`)

    // 🔴 current.ts 와 버전 파일은 **함께** 가야 한다. 갈라지면 제품 빌드가 깨진다.
    const hasCurrent = files.includes('src/content/magazine/graph/current.ts')
    const hasVersion = files.some((f) => /\/g-\d{8}-[0-9a-f]+\.ts$/.test(f))
    if (hasCurrent && !hasVersion) {
      block('SPLIT_BUNDLE', 'current.ts 만 있고 버전 파일이 없다 — 이대로 merge 하면 빌드가 깨진다')
    } else if (hasCurrent || hasVersion) pass('current 와 버전 파일이 함께 있다')
  }

  // ── ③ CI — 🔴 계약을 원고 레인에서 그대로 빌려 쓴다 ──
  if (ciState !== 'success' && ciState !== 'SUCCESS') {
    block('CI_NOT_SUCCESS', `커밋 status 가 ${ciState} 다`)
  } else pass('커밋 status success')

  const badChecks = checks.filter(
    (c) => c.status === 'completed' && !OK_CONCLUSIONS.includes(c.conclusion ?? ''),
  )
  if (badChecks.length > 0) {
    block('CHECK_FAILED', `실패한 검사 ${badChecks.length}개: ${badChecks.map((c) => c.name).join(' · ')}`)
  } else pass('실패한 검사 없음')

  const missing = REQUIRED_CHECKS.filter(
    (n: string) => !checks.some((c) => c.name === n && REQUIRED_CONCLUSIONS.includes(c.conclusion ?? '')),
  )
  if (missing.length > 0) {
    // 🔴 그래프 PR 은 heavy 회차라 M-GRAPH 가드가 **반드시** 그 안에서 돈다
    block('REQUIRED_CHECK_MISSING', `필수 검사가 성공으로 끝나지 않았다: ${missing.join(' · ')}`)
  } else pass(`필수 검사 ${REQUIRED_CHECKS.length}개 성공`)

  return { ok: blockedBy.length === 0, blockedBy, checked }
}

// ─────────────────────────────────────────────────────────
// 실행기 — 🔴 전부 주입 가능하다. fixture 가 이 흐름을 통째로 돌린다
// ─────────────────────────────────────────────────────────
export type GraphMergeDeps = {
  log: (s: string) => void
  now: () => Date
  gitStatus: () => string
  currentBranch: () => string
  createBranch: (name: string) => boolean
  commit: (files: string[], message: string) => boolean
  push: (branch: string) => boolean
  headSha: () => string
  changedGraphFiles: () => string[]
  listGraphPrs: () => { ok: boolean; prs: Pr[]; reason?: string }
  createPr: (branch: string, title: string, body: string) => { ok: boolean; number?: number; url?: string; reason?: string }
  getPr: (n: number) => Pr | null
  listPrFiles: (n: number) => string[]
  getCi: (sha: string) => { ok: boolean; ciState: string; checks: { name: string; status: string; conclusion: string | null }[] }
  mergePr: (n: number, sha: string) => { ok: boolean; reason?: string }
}

export type GraphMergeReport = {
  mode: 'verify' | 'apply'
  branch: string | null
  pr: { number: number; url: string } | null
  blockedBy: Blocked[]
  checked: string[]
  merged: boolean
}

export async function runGraphMerge({
  apply = false,
  reason = '그래프 번들 갱신',
  deps,
}: {
  apply?: boolean
  reason?: string
  deps: GraphMergeDeps
}): Promise<GraphMergeReport> {
  const report: GraphMergeReport = {
    mode: apply ? 'apply' : 'verify',
    branch: null,
    pr: null,
    blockedBy: [],
    checked: [],
    merged: false,
  }
  const fail = (code: string, message: string) => {
    report.blockedBy.push({ code, message })
    return report
  }

  // ── ① 바꾼 파일이 그래프뿐인가 ──
  const dirty = deps.gitStatus().split('\n').filter(Boolean).map((l) => l.slice(3))
  const foreign = dirty.filter((f) => !isGraphLaneFile(f))
  if (foreign.length > 0) {
    return fail('DIRTY_OUTSIDE_GRAPH', `그래프 밖 변경이 ${foreign.length}건 있다: ${foreign.slice(0, 3).join(' · ')}`)
  }
  const files = deps.changedGraphFiles()
  if (files.length === 0) {
    deps.log('바뀐 그래프 파일이 없다 — 할 것이 없다')
    return report
  }
  report.checked.push(`그래프 파일 ${files.length}건`)

  // ── ② 이미 떠 있는 그래프 PR 이 있는가 — 🔴 1건 계약 ──
  const found = deps.listGraphPrs()
  if (!found.ok) return fail('PR_LOOKUP_FAILED', found.reason ?? 'PR 목록을 읽지 못했다')
  if (found.prs.length > 0) {
    // 🔴 원고 레인과 같은 태도다. 둘이 떠 있으면 고르지 않는다.
    return fail('GRAPH_PR_ALREADY_OPEN', `그래프 PR 이 이미 ${found.prs.length}건 떠 있다 — 1건 계약을 지킨다`)
  }
  report.checked.push('미해결 그래프 PR 0건')

  if (!apply) {
    deps.log('검증만 했다. 실제로 내보내려면 --apply')
    return report
  }

  // ── ③ 브랜치 · 커밋 · push ──
  const stamp = deps.now().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 14)
  const branch = `${GRAPH_BRANCH_PREFIX}${stamp}`
  report.branch = branch
  if (!deps.createBranch(branch)) return fail('BRANCH_FAILED', `브랜치를 만들지 못했다: ${branch}`)
  // 🔴 파일명을 명시한다. `git add .` 을 쓰지 않는다.
  if (!deps.commit(files, `chore(mgraph): ${reason}\n\n그래프 번들만 바꾼다. current.ts 와 버전 파일이 한 커밋에 함께 간다.`)) {
    return fail('COMMIT_FAILED', '커밋하지 못했다')
  }
  if (!deps.push(branch)) return fail('PUSH_FAILED', 'push 하지 못했다')
  const sha = deps.headSha()

  // ── ④ PR ──
  const created = deps.createPr(
    branch,
    `chore(mgraph): ${reason}`,
    `M-GRAPH 그래프 전용 레인. 바꾸는 파일은 \`src/content/magazine/graph/\` 뿐이다.\n\n사유: ${reason}`,
  )
  if (!created.ok || created.number === undefined) {
    return fail('PR_FAILED', created.reason ?? 'PR 을 만들지 못했다')
  }
  report.pr = { number: created.number, url: created.url ?? '' }

  // ── ⑤ 판정 후 merge ──
  const pr = deps.getPr(created.number)
  const ci = deps.getCi(sha)
  if (!ci.ok) return fail('CI_LOOKUP_FAILED', 'CI 상태를 읽지 못했다')
  const judged = judgeGraphMerge({
    pr,
    expectedSha: sha,
    files: deps.listPrFiles(created.number),
    ciState: ci.ciState,
    checks: ci.checks,
  })
  report.checked.push(...judged.checked)
  if (!judged.ok) {
    report.blockedBy.push(...judged.blockedBy)
    return report
  }

  const merged = deps.mergePr(created.number, sha)
  if (!merged.ok) return fail('MERGE_FAILED', merged.reason ?? 'merge 하지 못했다')
  report.merged = true
  return report
}

const exec = (cmd: string, args: string[], cwd = ROOT) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd, encoding: 'utf8' }), err: '' }
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string }
    return { code: x.status ?? 1, out: x.stdout ?? '', err: x.stderr ?? '' }
  }
}

export const realDeps: GraphMergeDeps = {
  log: (s) => console.log(`  ${s}`),
  now: () => new Date(),
  gitStatus: () => exec('git', ['status', '--porcelain']).out,
  currentBranch: () => exec('git', ['branch', '--show-current']).out.trim(),
  createBranch: (n) => exec('git', ['switch', '-c', n]).code === 0,
  commit: (files, msg) =>
    exec('git', ['add', ...files]).code === 0 && exec('git', ['commit', '-m', msg]).code === 0,
  push: (branch) => exec('git', ['push', '-u', 'origin', branch]).code === 0,
  headSha: () => exec('git', ['rev-parse', 'HEAD']).out.trim(),
  changedGraphFiles: () =>
    exec('git', ['status', '--porcelain'])
      .out.split('\n').filter(Boolean).map((l) => l.slice(3))
      .filter(isGraphLaneFile),
  listGraphPrs: () => {
    const r = exec('gh', ['pr', 'list', '--state', 'open', '--limit', '50', '--json', PR_FIELDS_ARG])
    if (r.code !== 0) return { ok: false, prs: [], reason: 'gh 로 PR 목록을 읽지 못했다' }
    try {
      const list = JSON.parse(r.out || '[]') as Pr[]
      // 🔴 그래프 레인 PR 만 센다 — 원고 레인 PR 은 이 레인의 1건 계약과 무관하다
      return { ok: true, prs: list.filter((p) => String(p.headRefName ?? '').startsWith(GRAPH_BRANCH_PREFIX)) }
    } catch {
      return { ok: false, prs: [], reason: 'PR 목록을 해석하지 못했다' }
    }
  },
  createPr: (branch, title, body) => {
    const r = exec('gh', ['pr', 'create', '--head', branch, '--title', title, '--body', body])
    if (r.code !== 0) return { ok: false, reason: (r.err || r.out).trim().split('\n').pop() }
    const url = r.out.trim().split('\n').pop() ?? ''
    const number = Number(url.split('/').pop())
    return Number.isFinite(number) ? { ok: true, number, url } : { ok: false, reason: `PR 번호를 읽지 못했다: ${url}` }
  },
  getPr: (n) => {
    const r = exec('gh', ['pr', 'view', String(n), '--json', PR_FIELDS_ARG])
    if (r.code !== 0) return null
    try { return JSON.parse(r.out) as Pr } catch { return null }
  },
  listPrFiles: (n) => {
    const r = exec('gh', ['pr', 'view', String(n), '--json', 'files'])
    if (r.code !== 0) return []
    try { return (JSON.parse(r.out).files ?? []).map((f: { path: string }) => f.path) } catch { return [] }
  },
  getCi: (sha) => {
    const s = exec('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/status`, '--jq', '.state'])
    const c = exec('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/check-runs`, '--jq', '[.check_runs[] | {name, status, conclusion}]'])
    if (s.code !== 0 || c.code !== 0) return { ok: false, ciState: 'unknown', checks: [] }
    try { return { ok: true, ciState: s.out.trim(), checks: JSON.parse(c.out || '[]') } }
    catch { return { ok: false, ciState: 'unknown', checks: [] } }
  },
  mergePr: (n, sha) => {
    const r = exec('gh', ['pr', 'merge', String(n), '--squash', '--match-head-commit', sha])
    return r.code === 0 ? { ok: true } : { ok: false, reason: (r.err || r.out).trim().split('\n').pop() }
  },
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const reason = argv.includes('--reason') ? argv[argv.indexOf('--reason') + 1] ?? '그래프 번들 갱신' : '그래프 번들 갱신'

  console.log(`\nM-GRAPH 그래프 레인 ${apply ? '(🔴 push → PR → 자동 병합)' : '(검증만 · 변경 0)'}\n`)
  const report = await runGraphMerge({ apply, reason, deps: realDeps })
  for (const c of report.checked) console.log(`  ✅ ${c}`)
  for (const b of report.blockedBy) console.log(`  🔴 ${b.code}: ${b.message}`)
  if (report.pr) console.log(`\n  PR #${report.pr.number} ${report.pr.url}`)
  console.log(`\n${report.blockedBy.length === 0 ? '✅' : '🔴'} 종료 (코드 ${report.blockedBy.length === 0 ? 0 : 1})\n`)
  process.exit(report.blockedBy.length === 0 ? 0 : 1)
}

if (process.argv[1]?.endsWith('magazine-graph-merge.mts')) void main()
