#!/usr/bin/env tsx
/**
 * 🔴 **단계 증거 · 추가 댓글 분리 — 변이 시험** (2026-10-13 · PR #704 E1)
 *
 *   npx tsx scripts/stage-evidence-followup-mutation.mts
 *   (격리 DB env 가 있으면 repo 변이는 `stage-evidence-db-check` 로도 잰다 — 없으면 그 변이는 건너뛰었다고 적는다)
 *
 *   막는 줄 하나를 바꾸면 검사가 반드시 FAIL 해야 한다. 한 변이라도 살아남으면 exit 1.
 *
 * 🔴 worktree 를 고치지 않는다. `src` · `scripts` 를 OS 임시 디렉터리에 복사하고 나머지(node_modules · docs · 설정)는
 *    symlink 로 잇는다. 변이는 그 사본에만 쓴다 — 원복 사고(백업 0개 · 변이 누적)가 구조적으로 생기지 않는다.
 * 🔴 먼저 변이 없는 사본이 PASS 하는지 본다 — 하네스가 늘 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EV = 'src/lib/stage-evidence.ts'
const REPO = 'src/lib/stage-evidence-repo.ts'
const PURE = 'scripts/stage-evidence-check.mts'
const DB = 'scripts/stage-evidence-db-check.mts'
const dbReady = (process.env.SORAN_ISOLATED_DB ?? '').trim() === 'yes-throwaway'

type Mutation = { name: string; file: string; from: string; to: string; check: string }
const M = (name: string, from: string, to: string, file = EV, check = PURE): Mutation => ({ name, file, from, to, check })
const MUTATIONS: Mutation[] = [
  // 분류기
  M('첫 댓글 표식이 있어도 추가 댓글 축으로', 'if (firstMarked || !followupMarked) return commentProvenanceOf(f)', 'if (!followupMarked) return commentProvenanceOf(f)'),
  M('추가 댓글 행 수 검사 제거', "if (f.queues.length !== 1 || f.logs.length !== 1) return 'followup-broken'", ''),
  M('추가 댓글 Queue 상태·표식 검사 제거', "if (q.status !== 'PUBLISHED' || (q.decidedBy ?? '').trim() !== FOLLOWUP_LANE_DECIDED_BY) return 'followup-broken'", ''),
  M('추가 댓글 로그 표식 검사 제거', "if ((l.decidedBy ?? '').trim() !== FOLLOWUP_LANE_ACTIVITY_DECIDED_BY) return 'followup-broken'", ''),
  M('추가 댓글 Persona 대조 제거', "if (c.personaId === null || q.personaId !== c.personaId || l.personaId !== c.personaId) return 'followup-broken'", ''),
  M('추가 댓글 대상 글 대조 제거', "if (q.targetPostId !== c.postId) return 'followup-broken'\n  if (q.decidedAtMs === null || l.publishedAtMs === null || q.decidedAtMs !== l.publishedAtMs) return 'followup-broken'",
    "if (q.decidedAtMs === null || l.publishedAtMs === null || q.decidedAtMs !== l.publishedAtMs) return 'followup-broken'"),
  M('추가 댓글 시각 일치 제거', "if (q.decidedAtMs === null || l.publishedAtMs === null || q.decidedAtMs !== l.publishedAtMs) return 'followup-broken'\n  // 🔴 추가 댓글은",
    '// 🔴 추가 댓글은'),
  M('추가 댓글 시계 차이 검사 제거', "if (c.createdAtMs - q.decidedAtMs < -AUTO_COMMENT_CLOCK_SKEW_MS) return 'followup-broken'", ''),
  M('추가 댓글 표식을 첫 댓글 표식과 같게', "FOLLOWUP_LANE_ACTIVITY_DECIDED_BY = 'auto-followup'", "FOLLOWUP_LANE_ACTIVITY_DECIDED_BY = 'auto'"),
  // 판정 본체 — 단계 증거
  M('추가 댓글을 단계 상한·중복에 다시 넣음', 'p.personaComments.filter((c) => !isFollowupProvenance(c.provenance))', 'p.personaComments.filter(() => true)'),
  M('상한을 1→5 로 단순 변경', 'if (stage === \'bootstrap-auto\') return AUTO_PERSONA_COMMENTS_PER_POST_MAX', 'if (stage === \'bootstrap-auto\') return PERSONA_COMMENTS_PER_POST_MAX'),
  M('상한 판정을 전체 댓글로', 'if (cap !== null && stageComments.length > cap)', 'if (cap !== null && p.personaComments.length > cap)'),
  M('중복 판정을 전체 댓글로', 'for (const c of stageComments) {\n        const k', 'for (const c of p.personaComments) {\n        const k'),
  M('자기 글 판정을 전체 댓글로', 'const own = stageComments.filter(', 'const own = p.personaComments.filter('),
  // 🔴 `eligible` 은 이미 추가 댓글을 뺀 `stageComments` 에서 고른다 — 조건 한 칸만 바꾸면 등가 변이다. 실제 회귀(전체 댓글에서 고르고 추가 댓글도 받음)를 넣는다
  M('추가 댓글을 첫 댓글 증거로', "const eligible = stageComments.filter((c) =>\n        c.topLevel && c.personaId !== null && c.personaId !== p.authorPersonaId && c.provenance === 'auto')",
    "const eligible = p.personaComments.filter((c) =>\n        c.topLevel && c.personaId !== null && c.personaId !== p.authorPersonaId && (c.provenance === 'auto' || c.provenance === 'followup'))"),
  M('추가 댓글 깨짐을 단계 FAIL 로', "if (c.provenance === 'broken') brokenProv += 1", "if (c.provenance === 'broken') brokenProv += 1\n      }\n      for (const c of p.personaComments) {\n        if (c.provenance === 'followup-broken') brokenProv += 1"),
  M('추가 댓글 수 미집계', 'followupCount += p.personaComments.length - stageComments.length', ''),
  // 대화 감사
  M('대화 감사 — 깨진 출처 무시', "if (broken > 0) codes.add('FOLLOWUP_PROVENANCE_BROKEN')", ''),
  M('대화 감사 — 첫 댓글 없는 추가 허용', "if (firstAt === null || fu.some((c) => c.createdAtMs < firstAt)) codes.add('FOLLOWUP_WITHOUT_FIRST')", ''),
  M('대화 감사 — 첫 댓글보다 앞선 추가 허용', 'if (firstAt === null || fu.some((c) => c.createdAtMs < firstAt))', 'if (firstAt === null)'),
  M('대화 감사 — 총량 5 초과 허용', "if (p.personaComments.length > PERSONA_COMMENTS_PER_POST_MAX) codes.add('FOLLOWUP_OVER_TOTAL')", ''),
  M('대화 감사 — 같은 Persona 허용', "codes.add('FOLLOWUP_DUP_PERSONA')", 'void 0'),
  M('대화 감사 — 자기 글 허용', "codes.add('FOLLOWUP_SELF')", 'void 0'),
  M('대화 감사를 판정에 싣지 않음', '...(conversation === undefined ? {} : { conversation })', ''),
  M('이유 줄에 대화 감사 FAIL 을 남기지 않음', "const conv = v.conversation?.verdict === 'FAIL'", 'const conv = false'),
  // repo — 실제 DB 읽기가 새 분류기를 쓰는가 (격리 DB 가 있을 때만 잴 수 있다)
  M('repo 가 옛 분류기를 씀', 'const provenanceOf = (c: (typeof comments)[number]) => personaCommentProvenanceOf({',
    'const provenanceOf = (c: (typeof comments)[number]) => commentProvenanceOf({', REPO, DB),
]

const dir = mkdtempSync(join(tmpdir(), 'stage-ev-mut-'))
const run = (check: string): { ok: boolean; tail: string } => {
  const r = spawnSync('npx', ['tsx', check], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return { ok: r.status === 0, tail: out.trim().split('\n').slice(-1)[0] ?? '' }
}
let survived = 0
let skipped = 0
try {
  for (const e of readdirSync(root)) {
    if (e === 'src' || e === 'scripts' || e === '.git' || e === '.next') continue
    symlinkSync(join(root, e), join(dir, e))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })
  // 🔴 repo 변이용 import 를 미리 열어 둔다 — 원본에서도 쓰이지 않는 이름이 아니라 같은 모듈의 정본 함수다
  const repoPath = join(dir, REPO)
  writeFileSync(repoPath, readFileSync(repoPath, 'utf-8').replace('import { personaCommentProvenanceOf, ', 'import { personaCommentProvenanceOf, commentProvenanceOf, '))

  console.log('\n══ 단계 증거 · 추가 댓글 분리 변이 시험 (worktree 변경 0) ══')
  const base = run(PURE)
  console.log(`  ${base.ok ? '✅' : '🔴'} 변이 없는 사본 — 순수 검사 ${base.ok ? 'PASS' : 'FAIL'} (${base.tail})`)
  if (!base.ok) throw new Error('하네스 기준선이 FAIL 이다 — 변이 시험이 아무것도 증명하지 않는다')
  if (dbReady) {
    const b = run(DB)
    console.log(`  ${b.ok ? '✅' : '🔴'} 변이 없는 사본 — DB 검사 ${b.ok ? 'PASS' : 'FAIL'} (${b.tail})`)
    if (!b.ok) throw new Error('DB 기준선이 FAIL 이다')
  }
  for (const m of MUTATIONS) {
    const path = join(dir, m.file)
    const orig = readFileSync(path, 'utf-8')
    const n = orig.split(m.from).length - 1
    if (n !== 1) throw new Error(`변이 대상이 정확히 한 곳이 아니다(${n}) — ${m.name}`)
    if (m.check === DB && !dbReady) {
      skipped += 1
      console.log(`  ⬚ 건너뜀(격리 DB 없음) ${m.name}`)
      continue
    }
    writeFileSync(path, orig.replace(m.from, m.to))
    try {
      const r = run(m.check)
      if (r.ok) { survived += 1; console.log(`  🔴 살아남음 ${m.name}`) } else console.log(`  ✅ 잡힘 ${m.name}`)
    } finally {
      writeFileSync(path, orig)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
const measured = MUTATIONS.length - skipped
console.log(`\n${survived === 0 ? '✅' : '🔴'} 변이 ${measured - survived}/${measured} 잡힘${skipped > 0 ? ` · 건너뜀 ${skipped}(격리 DB 없음)` : ''}`)
process.exit(survived === 0 ? 0 : 1)
