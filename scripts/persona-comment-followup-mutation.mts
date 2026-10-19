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
  { name: '자동 첫 댓글 요구 제거', from: "if (!livePersona.some((c) => c.provenance === 'auto')) {", to: 'if (false) {' },
  { name: '깨진 출처(broken) BLOCK 제거', from: "c.provenance === 'broken' || ", to: '' },
  { name: '출처 모름(null) BLOCK 제거', from: " || c.provenance === null)) {", to: ')) {' },
  { name: '시간차 제거', from: 'if (nowMs < notBeforeMs)', to: 'if (false)' },
  { name: '식은 글 허용', from: 'if (nowMs - f.publishedAtMs > FOLLOWUP_POST_AGE_MAX_MS)', to: 'if (false)' },
  { name: '열린 후보 무시', from: 'if (f.hasOpenQueue) return', to: 'if (false) return' },
  { name: '실회원 댓글에 답함', from: "if (c.commentOrigin !== 'PERSONA') return { ok: false, reason: '대상이 Persona", to: "if (false) return { ok: false, reason: '대상이 Persona" },
  { name: '신고 댓글에 답함', from: 'if (c.reported !== false) return', to: 'if (false) return' },
  { name: '이미 답한 댓글에 또 답함(같은 대상 재소비)', from: 'if (consumed.has(c.id)) return', to: 'if (false) return' },
  { name: '실회원·지운 답을 소비로 안 봄', from: 'f.comments.filter((c) => c.parentId !== null)', to: "f.comments.filter((c) => c.commentOrigin === 'PERSONA' && !c.isDeleted && c.parentId !== null)" },
  { name: '글 hook 재소비', from: "!f.comments.some((c) => c.commentOrigin === 'PERSONA' && c.parentId === null && c.provenance === 'followup')", to: 'true' },
  { name: '근거 없는 글에도 잇기', from: 'const target = open[0] ?? null', to: "const target: FollowupTarget | null = open[0] ?? { kind: 'post', hook: 'question' }" },
  { name: 'hook 우선순위 제거', from: 'a.hookRank - b.hookRank || a.atMs', to: 'a.atMs' },
  { name: '글 id 해시로 필요성 재도입', from: 'const cap = Math.min(realCap, FOLLOWUP_EXTRA_PER_POST_MAX)', to: "const cap = Math.min(realCap, FOLLOWUP_EXTRA_PER_POST_MAX, Math.floor(unitOf('stamina', f.postId) * 5))" },
  { name: 'profile 판 검사 제거', from: 'if (p.v !== FOLLOWUP_PROFILE_VERSION) return', to: 'if (false) return' },
  { name: 'profile 단계 대조 제거', from: 'if (p.stage !== FOLLOWUP_PROFILE_ALL_STAGES && p.stage !== runtimeStage) {', to: 'if (false) {' },
  { name: '운영 공통 profile 지원 제거', from: 'p.stage !== FOLLOWUP_PROFILE_ALL_STAGES && p.stage !== runtimeStage', to: 'p.stage !== runtimeStage' },
  { name: 'profile 하루 건수 검사 제거', from: 'if (!isPosInt(p.dailyCount)) return', to: 'if (false) return' },
  { name: 'profile USD 검사 제거', from: "if (typeof p.dailyUsd !== 'number' || !Number.isFinite(p.dailyUsd) || p.dailyUsd <= 0) {", to: 'if (false) {' },
  { name: 'profile 회차>하루 허용', from: ' || p.runMax > p.dailyCount', to: '' },
  { name: 'profile 사람 승인 검사 제거', from: "if (typeof p.approvedBy !== 'string' || p.approvedBy.trim() === '' || p.approvedBy.trim().startsWith('machine:')) {", to: 'if (false) {' },
  { name: 'profile 기계 승인 허용', from: " || p.approvedBy.trim().startsWith('machine:')", to: '' },
  { name: 'profile 승인 시각 검사 제거', from: "if (typeof p.approvedAt !== 'string' || !Number.isFinite(Date.parse(p.approvedAt))) {", to: 'if (false) {' },
  { name: 'profile 무시하고 40건 고정', from: 'const countLeft = Math.max(0, P.dailyCount -', to: 'const countLeft = Math.max(0, 40 -' },
  { name: 'Persona 상한을 profile 대신 고정 3', from: 'c.followupsToday < perPersonaDailyMax)', to: 'c.followupsToday < 3)' },
  { name: '사슬 깊이 제거', from: 'if (ctx.chain.length + 1 > FOLLOWUP_CHAIN_MAX) return', to: 'if (false) return' },
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
  { name: '🔴 최신 글 우선 제거(hash-only 정렬 복원)',
    from: "(b.publishedAtMs ?? 0) - (a.publishedAtMs ?? 0)\n    || (a.postId < b.postId ? -1 : a.postId > b.postId ? 1 : 0)",
    to: "unitOf('followup-order', a.postId, String(a.go.ordinal)) - unitOf('followup-order', b.postId, String(b.go.ordinal))" },
  { name: '관계 이상 BLOCK 제거', from: "blockedAuthorIds: new Set() }).anomalies.length > 0)", to: "blockedAuthorIds: new Set() }).anomalies.length > 99)" },
  // ── 발행 트랜잭션 판정 ──
  { name: '🔴 트랜잭션 스위치 재판독 제거', from: '  if (!f.switch.enabled) blockers.push(f.switch.reason)\n  if (f.commentStage', to: '  if (f.commentStage' },
  { name: '트랜잭션 사람 발행 허용', from: "if (f.actor !== 'automation') blockers.push", to: 'if (false) blockers.push' },
  { name: '트랜잭션 PENDING 외 허용', from: "if (f.queueStatus !== 'PENDING') blockers.push", to: 'if (false) blockers.push' },
  { name: '트랜잭션 열쇠 모양 무시', from: 'if (!isFollowupKey(f.dedupKey)) blockers.push', to: 'if (false) blockers.push' },
  { name: '🔴 트랜잭션 profile 하루 상한 무시', from: 'else if (f.followupsTodayInTx >= prof.profile.dailyCount)', to: 'else if (false)' },
  { name: '트랜잭션 Persona 하루 상한 무시', from: 'else if (f.personaFollowupsTodayInTx >= prof.profile.perPersonaDailyMax)', to: 'else if (false)' },
  { name: '트랜잭션 다른 열린 후보 허용', from: 'if (f.otherOpenQueue !== false) blockers.push', to: 'if (false) blockers.push' },
  { name: '🔴 트랜잭션 순번 대조 제거', from: 'if (st.stamp.ordinal !== b.ordinal) blockers.push', to: 'if (false) blockers.push' },
  { name: '트랜잭션 최소 간격 제거', from: 'if (f.nowMs - b.lastPersonaMs < FOLLOWUP_MIN_GAP_MS) blockers.push', to: 'if (false) blockers.push' },
  { name: '🔴 트랜잭션 같은 Persona·글쓴이 허용', from: 'if (b.onPost.has(f.candidatePersonaId)) blockers.push', to: 'if (false) blockers.push' },
  { name: '트랜잭션 글 hook 재소비 허용', from: 'if (!postHookOpen(f.post)) blockers.push', to: 'if (false) blockers.push' },
  { name: '🔴 트랜잭션 고아 답글 허용', from: "if (parent === undefined) blockers.push('🔴 답글 대상이 이 글에 없다(고아 답글)')\n    else {", to: 'if (parent === undefined) { /* 변이 */ } else {' },
  { name: '🔴 트랜잭션 대상 유효성 무시', from: '      if (!open.ok) blockers.push(open.reason)', to: '      if (false) blockers.push(open.reason)' },
  // ── E6 그날 결정 ──
  { name: '🔴 표식 없음·오늘이 아닌 표식 허용(오래된·다른 날짜)', from: 'if (d.markDate !== kstDateString(now)) {', to: 'if (false) {' },
  { name: '정본 밖 단계 허용', from: 'if (!isRuntimeStage(d.release) || !isRuntimeStage(d.capacity)) return', to: 'if (false) return' },
  { name: '🔴 공개 > 천장 허용', from: 'if (RUNTIME_STAGES.indexOf(d.release) > RUNTIME_STAGES.indexOf(d.capacity)) {', to: 'if (false) {' },
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
