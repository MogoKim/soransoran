#!/usr/bin/env tsx
/**
 * Gate ⑧ 후보 귀속 · 글 × Persona 시도 기억 · 고정 잠금 · 회피 표지 · readiness 관측 — 변이 시험 (2026-11-07 D20)
 *
 *   npx tsx scripts/persona-voice-repeat-mutation.mts
 *
 * 방어를 지운 코드로 검사를 다시 돌려 **FAIL 로 바뀌는지** 본다. 겨냥 문장은 파일에 정확히 한 번 있어야 한다(0 · 2 이상은 무효 = FAIL).
 * 변이마다 voice-repeat-check → comment-loop-check → comment-engine-check 순으로 돌리고, 하나라도 실패하면 잡힌 것이다.
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 sha256 을 대조한다. 신호 · 예외에도 되돌린다.
 * 🔴 도는 동안 이 작업 트리를 고치지 않는다. DB 0 · provider 0 · 네트워크 0.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

type Edit = { file: string; find: string; replace: string }
const F = {
  repeat: 'src/lib/persona-voice-repeat.ts',
  targets: 'scripts/lib/persona-comment-targets.ts',
  policy: 'src/lib/persona-comment-attempt-policy.ts',
  prompt: 'scripts/lib/persona-prompt.ts',
  readiness: 'scripts/d20-readiness.mts',
  followup: 'scripts/lib/persona-comment-followup-run.mts',
}
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: '후보 소속 제거 — 임계 패턴이 있으면 후보와 무관하게 막는다(옛 영구 잠금)',
    edits: [{ file: F.repeat, find: '    if (over.some((p) => mine.has(p))) {', replace: '    if (over.length > 0) {' }] },
  { name: 'BASELINE_ONLY 차단 복귀 — prior 만 넘어도 후보 원인으로 막는다',
    edits: [{ file: F.repeat, find: '    if (over.length > 0) baselineOver = true', replace: "    if (over.length > 0) return { axis, band, cause: 'CANDIDATE', baselineShare, afterShare, candidateShare }" }] },
  { name: '>= 를 > 로 — 임계와 같은 점유율을 통과시킨다',
    edits: [{ file: F.repeat, find: '.filter(([, c]) => c / size >= limit)', replace: '.filter(([, c]) => c / size > limit)' }] },
  { name: 'review 무시 — regenerate 단계만 본다',
    edits: [{ file: F.repeat, find: "[['regenerate', t.regen], ['review', t.review]]", replace: "[['regenerate', t.regen]]" }] },
  { name: 'H1 band 회귀 — prior 만의 상위 단계를 후보에게 지운다(옛 최고 단계)',
    edits: [{ file: F.repeat, find: "      return { axis, band, cause: 'CANDIDATE', baselineShare, afterShare, candidateShare }",
      replace: "      return { axis, band: baselineOver ? 'regenerate' : band, cause: 'CANDIDATE', baselineShare, afterShare, candidateShare }" }] },
  { name: 'static lock 제거 — seed 공유 Persona 를 유료 호출 전에 빼지 않는다',
    edits: [{ file: F.targets, find: '      if (!fixed.capable) {', replace: '      if (false) {' }] },
  { name: 'post × Persona 제외 제거 — ⑧ 로 막힌 Persona 를 그 글에서 다른 역할로 다시 고른다',
    edits: [{ file: F.targets, find: '      if (args.voiceFailedPostPersonas?.has(ppKey) === true) {', replace: '      if (false) {' }] },
  { name: 'withAttemptStarted 방어 제거 — ⑧ 뒤 다른 역할 시작 기록을 받아 준다',
    edits: [{ file: F.policy, find: '  if (live.some((x) => isVoiceFailure(x) && postPersonaKeyOf(x) === postPersonaKeyOf(e))) {', replace: '  if (false) {' }] },
  { name: 'H1-b 회귀 — ⑧:notRun 도 ⑧ 실패로 센다',
    edits: [{ file: F.policy, find: '  e.failedGates.some((g) => VOICE_BLOCKING_GATES.has(g))', replace: "  e.failedGates.some((g) => g.startsWith('⑧:'))" }] },
  { name: 'dominant 표지 미주입(추출) — 막히는 패턴을 프롬프트 재료에 싣지 않는다',
    edits: [{ file: F.prompt, find: '    dominant: dominantRepeatMarks(texts),', replace: '    dominant: { endings: [], hooks: [], grams: [] },' }] },
  { name: 'dominant 표지 미주입(렌더) — 회피 줄을 프롬프트 본문에 넣지 않는다',
    edits: [{ file: F.prompt, find: '        ...dominantLines,\n', replace: '' }] },
  { name: 'followup seed 미상 차단 제거 — 그 사람만 빼고 회차의 다른 유료 호출을 계속한다',
    edits: [{ file: F.followup, find: '  for (const [code, n] of seedShareByCode) if (n === null) providerBlockers.push(', replace: '  for (const [code, n] of seedShareByCode) if (false && n === null) providerBlockers.push(' }] },
  { name: 'readiness static lock 관측 제거(판정) — 고정 잠금을 첫 댓글 가능 수에서 빼지 않는다',
    edits: [{ file: F.repeat, find: '    if (!v.capable) staticLocked.push({ code, codes: v.codes })\n', replace: '' }] },
  { name: 'readiness static lock 관측 제거(배선) — d20-readiness 가 계약 유효 수를 첫 댓글 가능 수로 싣는다',
    edits: [{ file: F.readiness, find: 'commentCapable: cap.commentCapable, staticLocked: cap.staticLocked,', replace: 'commentCapable: cap.contractValid, staticLocked: [],' }] },
]

const CHECKS = ['scripts/persona-voice-repeat-check.mts', 'scripts/persona-comment-loop-check.mts', 'scripts/persona-comment-engine-check.mts'] as const

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const ORIGINAL = new Map(files.map((f) => [f, readFileSync(f, 'utf-8')]))
const HASH = new Map([...ORIGINAL].map(([f, s]) => [f, sha(s)]))
const restore = (): void => { for (const [f, s] of ORIGINAL) writeFileSync(f, s) }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { restore(); process.exit(130) })
const verifyRestored = (): void => {
  for (const [f, h] of HASH) {
    if (sha(readFileSync(f, 'utf-8')) !== h) { restore(); console.log(`🔴 원복 해시 불일치 — ${f}`); process.exit(1) }
  }
}

const runOne = (script: string): { failed: boolean; summary: string } => {
  const r = spawnSync(process.execPath, [...process.execArgv, script], { encoding: 'utf-8', timeout: 900_000 })
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const fails = text.split('\n').filter((l) => l.includes('❌') || l.includes('🔴 FAIL')).slice(0, 2).map((l) => l.trim().slice(0, 160))
  return { failed: r.status !== 0, summary: `${script.replace('scripts/', '')} exit ${r.status} ${fails.join(' | ')}` }
}
/** 🔴 하나라도 실패하면 잡힌 것이다 — 앞 검사가 잡으면 뒤는 돌리지 않는다 */
const runChecks = (): { failed: boolean; summary: string } => {
  for (const c of CHECKS) {
    const r = runOne(c)
    if (r.failed) return r
  }
  return { failed: false, summary: '세 검사 모두 PASS' }
}

let killed = 0
let survived = 0
let invalid = 0
try {
  for (const c of CHECKS) {
    const base = runOne(c)
    if (base.failed) { console.log(`🔴 기준선 FAIL — ${base.summary}`); process.exit(1) }
  }
  console.log('  ✅ 기준선 PASS — 세 검사')
  for (const m of MUTATIONS) {
    let valid = true
    for (const e of m.edits) {
      const cur = readFileSync(e.file, 'utf-8')
      const n = cur.split(e.find).length - 1
      if (n !== 1) { valid = false; console.log(`  ❌ 변이 무효(문장 ${n}회) — ${m.name} · ${e.file}`); break }
      writeFileSync(e.file, cur.replace(e.find, e.replace))
    }
    if (!valid) { invalid += 1; restore(); verifyRestored(); continue }
    const r = runChecks()
    restore()
    verifyRestored()
    if (r.failed) { killed += 1; console.log(`  ✅ 잡았다 — ${m.name}\n       ${r.summary}`) } else { survived += 1; console.log(`  ❌ 살아남았다 — ${m.name}\n       ${r.summary}`) }
  }
} finally { restore() }
verifyRestored()
const ok = survived === 0 && invalid === 0
console.log(`\n${ok ? '✅' : '🔴'} 변이 ${MUTATIONS.length}개 — 잡음 ${killed} · 살아남음 ${survived} · 무효 ${invalid} · 원본 해시 복원 확인(${files.length}개 파일)`)
process.exit(ok ? 0 : 1)
