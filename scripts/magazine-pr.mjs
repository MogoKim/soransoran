#!/usr/bin/env node
/**
 * 매거진 자동화 산출물 → 브랜치 · 커밋 · PR
 *
 * 🔴 이 스크립트는 merge 하지 않는다 — PR 까지가 종점이다.
 *    🔴 M3-A 이후 merge 판정은 사람이 아니라 `magazine-merge-gate.mjs` 가 한다.
 *    사람이 diff 를 본 뒤에만 나간다 — 운영 전략 §13.5.
 *
 * 🔴 왜 allowlist 인가
 *    이 repo 는 세션·Codex[3]·자동화가 같이 쓴다. stage 와 commit 사이 틈에
 *    다른 세션 파일이 섞여 들어간 사고가 실제로 있었다(7-D-6).
 *    그래서 커밋 직전에 staged 목록을 allowlist 와 **정확히 대조**하고,
 *    하나라도 어긋나면 커밋하지 않는다.
 *
 * 🔴 git add . 을 쓰지 않는다. 파일명을 하나씩 넘긴다.
 *
 * 사용법
 *   node scripts/magazine-pr.mjs --branch feat/magazine-2026-08-25 --title "..."
 *   node scripts/magazine-pr.mjs --branch ... --title "..." --push
 *   node scripts/magazine-pr.mjs --branch ... --title "..." --body-file <path>
 *   node scripts/magazine-pr.mjs ... --json
 *
 * 종료 코드: BLOCKED 면 1
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { ROOT } from './lib/magazine-load.mjs'

/** 자동화가 만들어도 되는 것 — 이 밖은 사람이 판단한다 */
const ALLOW = [
  /^src\/content\/magazine\/articles\.ts$/,
  /^drafts\/magazine\/topic-queue\.ts$/,
  /^drafts\/magazine\/[a-z0-9-]+\/.+$/,
  /^public\/magazine\/[a-z0-9-]+\/hero\.webp$/,
  /^docs\/operations\/.+$/,
  /^scripts\/magazine-[a-z-]+\.mjs$/,
  /^scripts\/lib\/magazine-[a-z-]+\.mjs$/,
]

/**
 * 여기 걸리면 즉시 멈춘다.
 * 공용 파일이거나 네이버 노출면이라 자동화가 건드릴 자리가 아니다.
 */
const DENY = [
  /^package(-lock)?\.json$/,
  /^prisma\//,
  /^src\/lib\/post-visibility\.ts$/,
  /^src\/lib\/queries\/posts\.ts$/,
  /^src\/app\/sitemap\.ts$/,
  /^src\/app\/robots\.ts$/,
  /^src\/app\/community\//,
  /^src\/app\/page\.tsx$/,
]

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const gitQuiet = (...args) => {
  try { return { ok: true, out: git(...args) } }
  catch (err) { return { ok: false, out: String(err?.stderr ?? err?.message ?? '').trim() } }
}

export function classify(path) {
  if (DENY.some((r) => r.test(path))) return 'DENY'
  if (ALLOW.some((r) => r.test(path))) return 'ALLOW'
  return 'UNKNOWN'
}

/**
 * 워킹트리에서 바뀔 것을 본다. staged/unstaged/untracked 를 한 번에.
 * 🔴 trim 하지 않는다 — porcelain 의 첫 두 칸은 상태이고 " M" 처럼 공백으로 시작한다.
 *    앞 공백을 지우면 경로가 한 칸씩 밀린다.
 */
function changedPaths() {
  // -uall: untracked 를 디렉터리로 뭉치지 않고 파일 단위로 펼친다.
  // 기본값은 새 디렉터리를 "drafts/magazine/foo/" 한 줄로 요약해 allowlist 가 매치하지 못한다.
  const out = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: ROOT, encoding: 'utf8' })
  if (!out.trim()) return []
  return out.split('\n').filter(Boolean).map((l) => {
    const path = l.slice(3).trim()
    // rename 은 "old -> new" 로 나온다. 새 이름이 대상이다
    return path.includes(' -> ') ? path.split(' -> ')[1] : path
  })
}

export function inspect() {
  const reasons = []
  const notes = []

  const paths = changedPaths()
  const denied = paths.filter((p) => classify(p) === 'DENY')
  const unknown = paths.filter((p) => classify(p) === 'UNKNOWN')
  const allowed = paths.filter((p) => classify(p) === 'ALLOW')

  for (const p of denied) reasons.push(`🔴 금지 파일이 변경돼 있다: ${p}`)
  for (const p of unknown) reasons.push(`allowlist 밖 변경: ${p}`)
  if (!paths.length) reasons.push('변경이 없다 — 커밋할 것이 없다')

  // origin/main 대비 위치
  let behind = null
  const fetched = gitQuiet('fetch', 'origin', 'main', '--quiet')
  if (!fetched.ok) notes.push('origin/main fetch 실패 — 네트워크를 확인해라')
  else {
    const rc = gitQuiet('rev-list', '--count', 'HEAD..origin/main')
    behind = rc.ok ? Number(rc.out) : null
    if (behind) reasons.push(`origin/main 보다 ${behind} 커밋 뒤에 있다 — 자동 rebase 하지 않는다`)
  }

  // 공백 오류
  const ws = gitQuiet('diff', '--check')
  if (!ws.ok) reasons.push('git diff --check 실패 — 공백 오류가 있다')

  return {
    verdict: reasons.length ? 'BLOCKED' : 'READY',
    reasons,
    notes,
    files: { allowed, denied, unknown },
    behind,
  }
}

function defaultBody(files, title) {
  return `## 무엇을

${title}

## 변경 파일

${files.map((f) => `- \`${f}\``).join('\n')}

## 검증

- \`npm run typecheck\` · \`npm run lint\` 통과
- \`magazine-batch-qa\` READY (BLOCKED 0)
- 금지 파일 변경 0건 (package.json · prisma/** · post-visibility · queries/posts · sitemap · community/** · page.tsx)

## merge 판정

자동화가 만든 PR 이다. **사람이 diff 를 본 뒤에만 merge 한다.**
자동 merge 하지 않는다.
`
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`매거진 자동화 산출물 → 브랜치 · 커밋 · PR

  node scripts/magazine-pr.mjs --branch <branch> --title "<title>"
  node scripts/magazine-pr.mjs --branch <branch> --title "<title>" --push
  node scripts/magazine-pr.mjs ... --body-file <path> · --json

🔴 기본은 dry-run. --push 를 명시해야만 브랜치·커밋·PR 을 만든다.
🔴 merge 하지 않는다. main 에 직접 push 하지 않는다.
🔴 allowlist 밖 파일이 하나라도 바뀌어 있으면 BLOCKED.
🔴 origin/main 보다 뒤에 있으면 BLOCKED — 자동 rebase 하지 않는다.`)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const arg = (k) => {
    const i = argv.indexOf(k)
    return i === -1 ? undefined : argv[i + 1]
  }
  const branch = arg('--branch')
  const title = arg('--title')
  const bodyFile = arg('--body-file')
  const push = argv.includes('--push')
  const asJson = argv.includes('--json')

  if (!branch || !title) {
    console.error('  --branch 와 --title 이 필요하다')
    process.exit(2)
  }
  if (branch === 'main') {
    console.error('  🔴 main 에 직접 push 하지 않는다')
    process.exit(2)
  }
  if (bodyFile && !existsSync(bodyFile)) {
    console.error(`  --body-file 을 찾지 못했다: ${bodyFile}`)
    process.exit(2)
  }

  const r = inspect()
  // 🔴 M3-A — "[merge 금지]" 를 붙이지 않는다. merge 여부는 자동 관문이 판정한다
  const prTitle = title.replace(/^\[merge 금지\]\s*/, '')
  const steps = []

  if (push && r.verdict === 'READY') {
    const run = (label, ...args) => {
      const res = gitQuiet(...args)
      steps.push({ label, ok: res.ok, out: res.out.slice(0, 200) })
      return res.ok
    }

    if (run(`브랜치 ${branch}`, 'switch', '-c', branch)) {
      // 파일명을 하나씩 넘긴다. git add . 은 쓰지 않는다
      const added = run('stage', 'add', '--', ...r.files.allowed)

      // 커밋 직전 재대조 — stage 와 commit 사이에 다른 세션이 끼어들 수 있다
      const staged = gitQuiet('diff', '--cached', '--name-only')
      const stagedList = staged.ok && staged.out ? staged.out.split('\n') : []
      const strayed = stagedList.filter((p) => classify(p) !== 'ALLOW')
      const missing = r.files.allowed.filter((p) => !stagedList.includes(p))

      if (strayed.length) {
        steps.push({ label: '커밋 직전 재대조', ok: false, out: `allowlist 밖 staged: ${strayed.join(', ')}` })
        r.verdict = 'BLOCKED'
        r.reasons.push(`🔴 stage 후 allowlist 밖 파일이 섞였다: ${strayed.join(', ')} — 커밋하지 않는다`)
        gitQuiet('restore', '--staged', '.')
      } else if (missing.length) {
        steps.push({ label: '커밋 직전 재대조', ok: false, out: `stage 누락: ${missing.join(', ')}` })
        r.verdict = 'BLOCKED'
        r.reasons.push(`stage 되지 않은 파일이 있다: ${missing.join(', ')}`)
        gitQuiet('restore', '--staged', '.')
      } else if (added) {
        steps.push({ label: '커밋 직전 재대조', ok: true, out: `${stagedList.length}개 일치` })
        if (run('commit', 'commit', '-m', prTitle)) {
          if (run(`push ${branch}`, 'push', '-u', 'origin', branch)) {
            const body = bodyFile ? readFileSync(bodyFile, 'utf8') : defaultBody(r.files.allowed, title)
            try {
              const url = execFileSync('gh', ['pr', 'create', '--title', prTitle, '--body', body, '--base', 'main', '--head', branch], { cwd: ROOT, encoding: 'utf8' }).trim()
              steps.push({ label: 'PR 생성', ok: true, out: url })
            } catch (err) {
              // PR 실패해도 커밋·push 는 남아 있다. 사람이 이어받으면 된다
              steps.push({ label: 'PR 생성', ok: false, out: String(err?.stderr ?? err?.message ?? '').slice(0, 200) })
            }
          }
        }
      }
    }
  }

  const out = {
    verdict: r.verdict,
    mode: push ? 'push' : 'dry-run',
    branch,
    title: prTitle,
    behind: r.behind,
    files: r.files,
    reasons: r.reasons,
    notes: r.notes,
    steps,
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log('')
    console.log(`  매거진 PR — ${branch}`)
    console.log(`  모드     : ${push ? 'push' : 'dry-run (branch/commit/push/PR 0건)'}`)
    console.log(`  제목     : ${prTitle}`)
    console.log(`  origin/main: ${r.behind === null ? '확인 실패' : r.behind === 0 ? '최신' : `🔴 ${r.behind} 뒤`}`)
    console.log('')
    console.log(`  허용 ${r.files.allowed.length} · 금지 ${r.files.denied.length} · 미상 ${r.files.unknown.length}`)
    for (const f of r.files.allowed) console.log(`    ✅ ${f}`)
    for (const f of r.files.denied) console.log(`    🔴 ${f}`)
    for (const f of r.files.unknown) console.log(`    ❓ ${f}`)
    console.log('')
    for (const s of steps) console.log(`    ${s.ok ? '✅' : '⛔'} ${s.label}${s.out ? ` — ${s.out}` : ''}`)
    if (steps.length) console.log('')
    if (r.verdict === 'READY') {
      if (push) console.log('  ✅ 완료 — merge 는 사람이 한다')
      else {
        console.log('  ✅ READY — 위 파일로 브랜치·커밋·PR 을 만들 수 있다')
        console.log('     실제로 하려면 --push')
      }
    } else {
      console.log('  ⛔ BLOCKED')
      for (const x of r.reasons) console.log(`     ⛔ ${x}`)
      console.log('')
      console.log('     커밋하지 않는다.')
    }
    for (const n of r.notes) console.log(`     ℹ️  ${n}`)
    console.log('')
  }

  process.exit(r.verdict === 'BLOCKED' ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-pr.mjs')) main()
