#!/usr/bin/env tsx
/**
 * 🔴 **2026-10-24 D10 근본 보정 — 변이 시험** (의미 감사 확인 호출 · 실질 변경 계약 · 400 요청 모양 거부 · 글쓴이 답글 · 첫 댓글 기능 소비)
 *
 *   npx tsx scripts/d10-root-alignment-mutation.mts
 *
 *   막는 줄 하나를 바꾸면 그 축의 순수 검사가 **판정으로** FAIL 해야 한다. 한 변이라도 살아남으면 exit 1.
 *
 * 🔴 문법·로드 오류는 잡힌 변이로 세지 않는다 — 검사가 non-zero 로 끝나고 **실패 판정 줄(❌ · 🔴 FAIL)을 찍었을 때만** 잡힘이다.
 *    판정 줄 없이 죽으면 "로드 실패" 로 적고 하네스 자체를 FAIL 로 둔다.
 * 🔴 worktree 를 고치지 않는다. `src` · `scripts` 를 OS 임시 디렉터리에 복사하고 나머지는 symlink 로 잇는다.
 * 🔴 먼저 변이 없는 사본이 각 검사에서 PASS 하는지 본다 — 기준선이 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SEM = 'src/lib/auto-ready-semantic-audit.ts'
const MAT = 'src/lib/content-core/material-contract.ts'
const PROMPTS = 'scripts/lib/content-core-prompts.mts'
const PIPE = 'scripts/lib/persona-comment-pipeline.ts'
const GENF = 'src/lib/content-core/generation-failure.ts'
const FU = 'src/lib/persona-comment-followup.ts'
const RUN = 'scripts/lib/persona-comment-followup-run.mts'
const EV = 'src/lib/stage-evidence.ts'

const AUDIT_CHECK = 'scripts/auto-ready-audit-check.mts'
const LOSS_CHECK = 'scripts/semantic-loss-check.mts'
const ENGINE_CHECK = 'scripts/persona-comment-engine-check.mts'
const FU_CHECK = 'scripts/persona-comment-followup-check.mts'
const EV_CHECK = 'scripts/stage-evidence-check.mts'

type Mutation = { name: string; file: string; from: string; to: string; check: string }
const M = (name: string, file: string, check: string, from: string, to: string): Mutation => ({ name, file, from, to, check })
const MUTATIONS: Mutation[] = [
  // ── A · 의미 감사 확인 호출 ──
  M('1차 yes 를 바로 확정(확인 호출 제거)', SEM, AUDIT_CHECK,
    '  const second = await measureOnce(provider, req)\n', '  const second: MeasureOnce = first\n'),
  M('확인 측정 실패를 no 로 읽음', SEM, AUDIT_CHECK,
    "if (!second.ok) return retryable(second.code, second.reason, binding, 'failed')",
    "if (!second.ok) return { outcome: 'measured', defect: 'no', confirmation: 'unconfirmed', code: null, reasons: [], binding, ...VERSIONS }"),
  M('확인 호출에 새 요청 객체(얼린 요청 아님)', SEM, AUDIT_CHECK,
    'const second = await measureOnce(provider, req)', 'const second = await measureOnce(provider, { ...req })'),
  M('확인 no 를 yes 로 확정', SEM, AUDIT_CHECK,
    "    outcome: 'measured', defect: 'no', confirmation: 'unconfirmed'", "    outcome: 'measured', defect: 'yes', confirmation: 'unconfirmed'"),
  M('의미 감사 지시문이 공유 실질 변경 계약을 싣지 않음', SEM, AUDIT_CHECK,
    "  ...MATERIAL_CONTRACT_LINES,\n  '주체·행동·원인·결과를", "  '주체·행동·원인·결과를"),
  M('시간 바꿔쓰기 줄 제거(공유 계약)', MAT, AUDIT_CHECK,
    "  '시간 표현은 낱말이 달라졌다는 이유만으로 바뀐 것이 아니다. \"새벽\"·\"이 밤\"·\"밤늦게\"처럼 같은 장면의 시간대를 달리 말한 것은 바꿔쓰기다.',\n", ''),
  M('Content Core 검수 지시문이 공유 실질 변경 계약을 싣지 않음', PROMPTS, LOSS_CHECK,
    "    ...MATERIAL_CONTRACT_LINES,\n    '',\n    '## ① droppedFromSource", "    '',\n    '## ① droppedFromSource"),
  // ── C · 400 요청 모양 거부 ──
  M('400 도 다음 후보로 재시도', PIPE, ENGINE_CHECK,
    'if (!res.ok && requestShapeRejected(res.errorCode)) {', 'if (false) {'),
  M('모든 실패에서 회차 중단(일시 오류 재시도 제거)', GENF, ENGINE_CHECK,
    "return (code ?? '').trim() === 'HTTP_400'", "return (code ?? '').trim() !== ''"),
  // ── B · 글쓴이 답글 ──
  M('글쓴이 답글 자리 없음(옛 동작)', FU, FU_CHECK,
    "  return { kind: 'author', personaId: author }\n}", "  return { kind: 'other' }\n}"),
  M('글쓴이 답글 한 번 제한 제거', FU, FU_CHECK,
    "  if (f.comments.some((c) => c.commentOrigin === 'PERSONA' && c.personaId === author)) return { kind: 'other' }\n", ''),
  M('실회원 댓글도 글쓴이 답글 자리', FU, FU_CHECK,
    "if (parent === undefined || parent.commentOrigin !== 'PERSONA') return { kind: 'other' }", "if (parent === undefined) return { kind: 'other' }"),
  M('고르기가 글쓴이 자리를 무시(무작위 Persona)', FU, FU_CHECK,
    "  if (speaker.kind === 'author') {\n    // 🔴 글쓴이 답글 자리", "  if (false && speaker.kind === 'author') {\n    // 🔴 글쓴이 답글 자리"),
  M('글쓴이가 못 답하면 다른 Persona 로 대체', FU, FU_CHECK,
    '    return a !== undefined && a.eligible',
    '    if (a === undefined || !a.eligible || !isCount(a.followupsToday) || a.followupsToday >= perPersonaDailyMax) {\n      const alt = candidates.find((c) => c.eligible && c.personaId !== speaker.personaId)\n      if (alt !== undefined) return { personaId: alt.personaId }\n    }\n    return a !== undefined && a.eligible'),
  M('트랜잭션이 글쓴이 자리에 다른 Persona 를 허용', FU, FU_CHECK,
    'if (f.candidatePersonaId !== speaker.personaId) blockers.push(', 'if (false) blockers.push('),
  // ── B · 첫 댓글의 대화 기능 소비 ──
  M('최상위 Persona 댓글 기능 소비 제거(옛 동작)', FU, FU_CHECK,
    '  const used = new Set(top.map((c) => functionOf(c.role as ReactionType)))', '  const used = new Set<string>()'),
  M('그냥 한마디·공감을 서로 다른 기능으로', FU, FU_CHECK,
    "(r === 'other' || r === 'empathy' ? 'generic' : r)", 'r'),
  M('역할 모름을 통과', FU, FU_CHECK,
    '  if (top.some((c) => c.role === null)) return []\n', ''),
  M('남은 역할 없이도 글 hook 을 연다', FU, FU_CHECK,
    '\n    && postHookRolesOf(f, f.postReaction).length > 0) {', ') {'),
  M('트랜잭션 글 hook 역할 재검사 제거', FU, FU_CHECK,
    '    else if (f.candidateRole === null || !postHookRolesOf(f.post, st.stamp.hook).some((r) => r === f.candidateRole)) {', '    else if (false) {'),
  M('run 이 첫 댓글 역할을 읽지 않음', RUN, FU_CHECK,
    "role: c.commentOrigin === 'PERSONA' ? followupRoleOf(qs.filter((q) => q.publishedCommentId === c.id)) : null", 'role: null'),
  // ── B · 대화 감사 ──
  M('대화 감사 — 글쓴이 최상위 추가 허용', EV, EV_CHECK, 'own.some((c) => c.topLevel) || ', ''),
  M('대화 감사 — 글쓴이 답글 여러 번 허용', EV, EV_CHECK, ' || own.length > 1)', ')'),
  M('대화 감사 — 글쓴이 답글 한 번도 결함(옛 동작)', EV, EV_CHECK,
    "if (own.some((c) => c.topLevel) || own.length > 1) codes.add('FOLLOWUP_SELF')", "if (own.length > 0) codes.add('FOLLOWUP_SELF')"),
]

const FAIL_LINE = /❌|🔴 FAIL/
const dir = mkdtempSync(join(tmpdir(), 'd10-root-mut-'))
const run = (check: string): { code: number; judged: boolean; tail: string } => {
  const r = spawnSync('npx', ['tsx', check], { cwd: dir, encoding: 'utf-8', env: process.env, timeout: 300_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  return { code: r.status ?? 99, judged: FAIL_LINE.test(r.stdout ?? ''), tail: out.trim().split('\n').slice(-1)[0] ?? '' }
}
let bad = 0
try {
  for (const e of readdirSync(root)) {
    if (e === 'src' || e === 'scripts' || e === '.git' || e === '.next') continue
    symlinkSync(join(root, e), join(dir, e))
  }
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true })

  console.log('\n══ D10 근본 보정 변이 시험 (worktree 변경 0 · 판정 FAIL 만 잡힘으로 센다) ══')
  for (const c of [...new Set(MUTATIONS.map((m) => m.check))]) {
    const b = run(c)
    console.log(`  ${b.code === 0 ? '✅' : '🔴'} 기준선 ${c} — exit ${b.code} (${b.tail})`)
    if (b.code !== 0) throw new Error(`기준선이 FAIL 이다 — ${c}`)
  }
  for (const m of MUTATIONS) {
    const path = join(dir, m.file)
    const orig = readFileSync(path, 'utf-8')
    const n = orig.split(m.from).length - 1
    if (n !== 1) { bad += 1; console.log(`  🔴 변이 자리 ${n}곳(정확히 1곳이어야 한다) — ${m.name}`); continue }
    writeFileSync(path, orig.replace(m.from, m.to))
    try {
      const r = run(m.check)
      if (r.code === 0) { bad += 1; console.log(`  🔴 살아남음 ${m.name}`) }
      else if (!r.judged) { bad += 1; console.log(`  🔴 로드 실패(잡힘 아님) ${m.name} — exit ${r.code} · ${r.tail}`) }
      else console.log(`  ✅ 잡힘 ${m.name}`)
    } finally {
      writeFileSync(path, orig)
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${bad === 0 ? '✅ PASS' : `🔴 FAIL ${bad}건`} — 변이 ${MUTATIONS.length}개`)
process.exit(bad === 0 ? 0 : 1)
