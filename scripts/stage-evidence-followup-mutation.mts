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
// 수·결 통과선의 경계 사례(운영 로그 재생)는 이 검사가 든다
const POLICY = 'scripts/ladder-policy-check.mts'
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
  M('추가 댓글을 첫 댓글 레인(중복·자기 글·사람 손)에 다시 넣음', 'p.personaComments.filter((c) => !isFollowupProvenance(c.provenance))', 'p.personaComments.filter(() => true)'),
  M('추가 댓글을 첫 댓글 증거로', "c.provenance === 'auto' && c.topLevel && c.personaId !== null", "(c.provenance === 'auto' || c.provenance === 'followup') && c.topLevel && c.personaId !== null"),
  M('추가 댓글 깨짐을 무결성에서 뺌', "c.provenance === 'broken' || c.provenance === 'followup-broken'", "c.provenance === 'broken'"),
  M('글당 댓글에서 추가 댓글을 뺌', "p.personaComments.filter((c) => c.provenance === 'auto' || c.provenance === 'followup')", "p.personaComments.filter((c) => c.provenance === 'auto')"),
  M('글당 댓글에 출처 없는·깨진 댓글을 넣음', "p.personaComments.filter((c) => c.provenance === 'auto' || c.provenance === 'followup')", 'p.personaComments.filter(() => true)'),
  // 판정 본체 — 수와 결의 통과선 (2026-11-19 사다리 재설계)
  M('수 통과선 판정 제거', "if (n < counts.countFloor) codes.add('PUBLISH_SHORT')", ''),
  M('첫 댓글 창 판정 제거', '\n      && c.createdAtMs >= p.publishedAtMs && c.createdAtMs - p.publishedAtMs <= LADDER_RULE.firstCommentWindowMs)).length', ')).length'),
  M('첫 댓글 비율 판정 제거', "else if (n > 0 && below(firstOk, firstClosed.length * LADDER_RULE.firstCommentRatio)) codes.add('FIRST_COMMENT_SHORT')", ''),
  M('창이 안 닫힌 글도 첫 댓글 분모에', 'autoTargets.filter((p) => p.publishedAtMs + LADDER_RULE.firstCommentWindowMs <= facts.readAtMs)', 'autoTargets.filter(() => true)', EV, POLICY),
  M('닫힌 글이 모자라도 모름으로 두지 않음', 'closed > 0 && closed >= n * LADDER_RULE.closedShareMin', 'closed >= 0', EV, POLICY),
  M('글당 댓글 통과선 판정 제거', "if (below(total / talkClosed.length, commentDepthFloorOf(targetMean))) codes.add('COMMENT_DEPTH_SHORT')", '', EV, POLICY),
  M('타인 3명 판정 제거', "if (below(voices, talkClosed.length * row.threeVoicesRatio)) codes.add('THREE_VOICES_SHORT')", '', EV, POLICY),
  M('타인 3명에 글쓴이를 넣음', '.map((c) => c.personaId).filter((id) => id !== null && id !== p.authorPersonaId)).size >= 3', '.map((c) => c.personaId).filter((id) => id !== null)).size >= 3', EV, POLICY),
  M('수집→공개가 꺼진 칸인데도 막음', 'if (LADDER_RULE.collectToPublish.gate && n > 0) {', 'if (n > 0) {'),
  // 대화 감사
  M('대화 감사 — 깨진 출처 무시', "if (broken > 0) codes.add('FOLLOWUP_PROVENANCE_BROKEN')", ''),
  M('대화 감사 — 첫 댓글 없는 추가 허용', "if (firstAt === null || fu.some((c) => c.createdAtMs < firstAt)) codes.add('FOLLOWUP_WITHOUT_FIRST')", ''),
  M('대화 감사 — 첫 댓글보다 앞선 추가 허용', 'if (firstAt === null || fu.some((c) => c.createdAtMs < firstAt))', 'if (firstAt === null)'),
  M('대화 감사 — 총량 10 초과 허용', "if (p.personaComments.length > PERSONA_COMMENTS_PER_POST_MAX) codes.add('FOLLOWUP_OVER_TOTAL')", ''),
  M('대화 감사 — 삭제된 과거 Persona 턴을 제외', "const personaHistory = history.filter((c) => c.commentOrigin === 'PERSONA')", "const personaHistory = history.filter((c) => c.commentOrigin === 'PERSONA' && !c.isDeleted)"),
  M('대화 감사 — 같은 Persona 허용', "codes.add('FOLLOWUP_DUP_PERSONA')", 'void 0'),
  M('대화 감사 — 글쓴이 답글 상한·최상위 제한 제거', "if (own.some((c) => c.parentId === null) || own.length > PERSONA_AUTHOR_FOLLOWUPS_PER_POST_MAX) codes.add('FOLLOWUP_SELF')", 'void 0'),
  M('대화 감사 — 시간순 장부 누락을 PASS', "if (history === undefined) {", 'if (false) {'),
  M('대화 감사 — 없는·비 Persona·선행 대상을 허용', "if (parent === undefined || parent.commentOrigin !== 'PERSONA' || parent.createdAtMs > c.createdAtMs\n        || (parent.reportedAtMs !== null && parent.reportedAtMs <= c.createdAtMs)) {", 'if (false) {'),
  M('대화 감사 — 발행 전 신고를 허용', '(parent.reportedAtMs !== null && parent.reportedAtMs <= c.createdAtMs)', 'false'),
  M('대화 감사 — 나중 신고도 소급 실패', 'parent.reportedAtMs <= c.createdAtMs', 'parent.reportedAtMs >= 0'),
  M('대화 감사 — 같은 답글 대상 재소비 허용', 'if (usesAtPublish > 1) {', 'if (false) {'),
  M('대화 감사 — 나중 답글도 소급 재소비로 판정', 'x.parentId === c.parentId && x.createdAtMs <= c.createdAtMs', 'x.parentId === c.parentId'),
  M('대화 감사 — 사슬 깊이 상한 제거', 'if (depth > PERSONA_REPLY_CHAIN_MAX) {', 'if (false) {'),
  M('대화 감사 — 자기 댓글 답글 허용', "} else if (c.personaId !== null && parent.personaId === c.personaId) {", '} else if (false) {'),
  M('대화 감사를 판정에 싣지 않음', '...(conversation === undefined ? {} : { conversation })', ''),
  M('이유 줄에 대화 감사 FAIL 을 남기지 않음', "const conv = v.conversation?.verdict === 'FAIL'", 'const conv = false'),
  // repo — 실제 DB 읽기가 새 분류기를 쓰는가 (격리 DB 가 있을 때만 잴 수 있다)
  M('repo 가 옛 분류기를 씀', 'const provenanceOf = (c: (typeof allPersonaComments)[number]) => personaCommentProvenanceOf({',
    'const provenanceOf = (c: (typeof allPersonaComments)[number]) => commentProvenanceOf({', REPO, DB),
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
