#!/usr/bin/env tsx
/**
 * 추가 댓글 판정 **변이 시험** — 막는 줄 하나를 지우면 검사가 반드시 FAIL 해야 한다
 *
 *   npx tsx scripts/persona-comment-followup-mutation.mts
 *
 * 🔴 worktree 를 고치지 않는다. 모듈 사본을 OS 임시 디렉터리에 쓰고(상대 import 는 절대 경로로 바꾼다)
 *    검사에 `FOLLOWUP_MODULE` 로 주입한다. 변이 원복 사고(백업 0개 · 누적)가 구조적으로 생기지 않는다.
 * 🔴 먼저 변이 없는 사본이 PASS 하는지 본다 — 하네스가 늘 FAIL 이면 변이 시험은 아무것도 증명하지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, '../src/lib')
const source = readFileSync(join(libDir, 'persona-comment-followup.ts'), 'utf-8')
  .replace(/from '\.\/([^']+)'/g, (_m, p: string) => `from '${join(libDir, p)}'`)

type Mutation = { name: string; from: string; to: string }
const MUTATIONS: Mutation[] = [
  { name: '스위치 아무 값이나 켬', from: 'if (raw === FOLLOWUP_SWITCH_ON) return', to: 'if (raw !== \'\') return' },
  { name: '첫 댓글 양보 제거', from: 'else if (f.pendingFirstComments > 0)', to: 'else if (false)' },
  { name: 'kill switch 모름을 통과', from: 'if (f.killSwitchOff !== true)', to: 'if (f.killSwitchOff === false)' },
  { name: '공유 장부 첫 댓글 몫 무시', from: '- (f.firstCommentReserveUsd as number))', to: '- 0)' },
  { name: '회차 상한 제거', from: 'Math.min(P.runMax, countLeft, byMoney)', to: 'Math.min(countLeft, byMoney)' },
  { name: '글당 5건 상한 느슨', from: 'if (personaCount >= FOLLOWUP_TOTAL_PER_POST_MAX)', to: 'if (personaCount > FOLLOWUP_TOTAL_PER_POST_MAX)' },
  { name: '실회원 1~2건 축소 제거', from: 'liveReal.length > 0 ? FOLLOWUP_EXTRA_WITH_MEMBERS_MAX', to: 'liveReal.length > 0 ? FOLLOWUP_EXTRA_PER_POST_MAX' },
  { name: '마지막 말 실회원 STOP 제거', from: "if (latest !== undefined && (latest.commentOrigin === 'MEMBER'", to: "if (false && (latest!.commentOrigin === 'MEMBER'" },
  { name: '자동 첫 댓글 요구 제거', from: 'if (firsts.length === 0)', to: 'if (false)' },
  { name: '깨진 출처(broken) BLOCK 제거', from: "c.provenance === 'broken' || ", to: '' },
  { name: '출처 모름(null) BLOCK 제거', from: " || c.provenance === null)) {", to: ')) {' },
  { name: '시간차 제거', from: 'if (nowMs < notBeforeMs)', to: 'if (false)' },
  { name: '식은 글 허용', from: 'if (nowMs - f.publishedAtMs > FOLLOWUP_POST_AGE_MAX_MS)', to: 'if (false)' },
  { name: '열린 후보 무시', from: 'if (f.hasOpenQueue) return', to: 'if (false) return' },
  { name: '실회원 댓글에 답함', from: "if (c.commentOrigin !== 'PERSONA' || c.reaction === null", to: 'if (c.reaction === null' },
  { name: '신고 댓글에 답함', from: 'if (c.reported !== false || consumed.has(c.id)) continue', to: 'if (consumed.has(c.id)) continue' },
  { name: '이미 답한 댓글에 또 답함(같은 대상 재소비)', from: 'if (c.reported !== false || consumed.has(c.id)) continue', to: 'if (c.reported !== false) continue' },
  { name: '실회원·지운 답을 소비로 안 봄', from: 'f.comments.filter((c) => c.parentId !== null)', to: "live.filter((c) => c.commentOrigin === 'PERSONA' && c.parentId !== null)" },
  { name: '글 hook 재소비', from: 'if (!postHookUsed && f.postReaction', to: 'if (f.postReaction' },
  { name: '근거 없는 글에도 잇기', from: 'const target = open[0] ?? null', to: "const target: FollowupTarget | null = open[0] ?? { kind: 'post', hook: 'question' }" },
  { name: 'hook 우선순위 제거', from: 'a.hookRank - b.hookRank || a.atMs', to: 'a.atMs' },
  { name: '글 id 해시로 필요성 재도입', from: 'const cap = Math.min(realCap, FOLLOWUP_EXTRA_PER_POST_MAX)', to: "const cap = Math.min(realCap, FOLLOWUP_EXTRA_PER_POST_MAX, Math.floor(unitOf('stamina', f.postId) * 5))" },
  { name: 'profile 판 검사 제거', from: 'if (p.v !== FOLLOWUP_PROFILE_VERSION) return', to: 'if (false) return' },
  { name: 'profile 단계 대조 제거', from: 'if (p.stage !== runtimeStage) return', to: 'if (false) return' },
  { name: 'profile 하루 건수 검사 제거', from: 'if (!isPosInt(p.dailyCount)) return', to: 'if (false) return' },
  { name: 'profile USD 검사 제거', from: "if (typeof p.dailyUsd !== 'number' || !Number.isFinite(p.dailyUsd) || p.dailyUsd <= 0) {", to: 'if (false) {' },
  { name: 'profile 회차>하루 허용', from: ' || p.runMax > p.dailyCount', to: '' },
  { name: 'profile 사람 승인 검사 제거', from: "if (typeof p.approvedBy !== 'string' || p.approvedBy.trim() === '' || p.approvedBy.trim().startsWith('machine:')) {", to: 'if (false) {' },
  { name: 'profile 기계 승인 허용', from: " || p.approvedBy.trim().startsWith('machine:')", to: '' },
  { name: 'profile 승인 시각 검사 제거', from: "if (typeof p.approvedAt !== 'string' || !Number.isFinite(Date.parse(p.approvedAt))) {", to: 'if (false) {' },
  { name: 'profile 무시하고 40건 고정', from: 'const countLeft = Math.max(0, P.dailyCount -', to: 'const countLeft = Math.max(0, 40 -' },
  { name: 'Persona 상한을 profile 대신 고정 3', from: 'c.followupsToday < perPersonaDailyMax)', to: 'c.followupsToday < 3)' },
  { name: '사슬 깊이 제거', from: 'if (ctx.chain.length + 1 > FOLLOWUP_CHAIN_MAX) continue', to: '' },
  { name: '같은 Persona 반복 허용', from: '&& !excluded.has(c.personaId)', to: '' },
  { name: 'Persona 하루 상한 제거', from: '&& c.followupsToday < perPersonaDailyMax', to: '' },
  { name: '글쓴이 제외 제거', from: 'if (f.authorPersonaId !== null) onPost.add(f.authorPersonaId)', to: '' },
  { name: '중복 문장 허용', from: '>= FOLLOWUP_DUP_JACCARD_MAX)', to: '>= 2)' },
  { name: '같은 도입 허용', from: "blockers.push('🔴 다른 Persona 댓글과 도입이 같다'); break", to: 'continue' },
  { name: '자체 표식 상수 부활', from: 'import type { PersonaCommentProvenance } from', to: "export const FOLLOWUP_DECIDED_BY = 'machine:persona-comment-followup'\nimport type { PersonaCommentProvenance } from" },
  { name: '깨진 추가 댓글(followup-broken) BLOCK 제거', from: " || c.provenance === 'followup-broken'", to: '' },
  { name: '🔴 대화 감사 브레이크 제거', from: '  if (!audit.ok) blockers.push(audit.reason)', to: '' },
  { name: '대화 감사 FAIL 사유 누락', from: "if (a.verdict === 'FAIL') {", to: 'if (false) {' },
  { name: '대화 감사 PASS 인데 코드 있음 허용', from: ' || a.codes.length > 0', to: '' },
  { name: '대화 감사 없음을 PASS 로', from: "if (raw === null || raw === undefined || typeof raw !== 'object') {", to: "if (raw === null || raw === undefined) return { ok: true }\n  if (typeof raw !== 'object') {" },
  { name: '도장 열쇠 대조 제거', from: 'if (followupKeyOf(expect.postId, s.ordinal) !== expect.dedupKey)', to: 'if (false)' },
  { name: '적은 글 먼저 제거', from: 'a.go.extrasSoFar - b.go.extrasSoFar\n    ||', to: '0 ||' },
  { name: '관계 이상 BLOCK 제거', from: "blockedAuthorIds: new Set() }).anomalies.length > 0)", to: "blockedAuthorIds: new Set() }).anomalies.length > 99)" },
]

const dir = mkdtempSync(join(tmpdir(), 'followup-mut-'))
const run = (code: string, tag: string): number => {
  const file = join(dir, `followup-${tag}.ts`)
  writeFileSync(file, code)
  const r = spawnSync('npx', ['tsx', join(here, 'persona-comment-followup-check.mts')], {
    env: { ...process.env, FOLLOWUP_MODULE: file }, encoding: 'utf-8',
  })
  return r.status ?? 99
}

let bad = 0
try {
  const base = run(source, 'base')
  console.log(`${base === 0 ? '✅' : '❌'} 변이 없는 사본 → PASS (exit ${base})`)
  if (base !== 0) bad++
  MUTATIONS.forEach((m, i) => {
    if (!source.includes(m.from)) {
      bad++
      console.log(`❌ [${m.name}] 변이 자리를 찾지 못했다 — 하네스가 낡았다`)
      return
    }
    const code = run(source.replace(m.from, m.to), String(i))
    const killed = code !== 0
    if (!killed) bad++
    console.log(`${killed ? '✅' : '❌'} [${m.name}] → ${killed ? '검사가 잡았다' : '🔴 살아남았다(죽은 게이트)'} (exit ${code})`)
  })
} finally {
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${bad === 0 ? '✅ PASS' : `❌ FAIL ${bad}건`} — 변이 ${MUTATIONS.length}개 · worktree 변경 0`)
process.exit(bad === 0 ? 0 : 1)
