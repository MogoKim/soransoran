#!/usr/bin/env tsx
/**
 * D30 stretch 정책 변이 시험 (2026-11-13)
 *
 *   npx tsx --tsconfig tsconfig.ops.json scripts/d30-stretch-mutation.mts
 *
 * 보호 장치를 지운 코드로 `d30-stretch-check` 를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 🔴 문장은 파일에 정확히 한 번 있어야 한다(0 · 2 이상이면 무효 — 죽은 변이를 통과로 세지 않는다).
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 해시를 대조한다. 신호 · 예외에도 되돌린다.
 * 🔴 도는 동안 이 작업 트리를 고치지 않는다. 운영 파일 · DB · 네트워크 0.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

type Edit = { file: string; find: string; replace: string }
const F = {
  gen: 'src/lib/stage-ladder-generic.ts',
  reserve: 'src/lib/persona-reserve.ts',
  evidence: 'src/lib/stage-evidence.ts',
  fate: 'src/lib/ready-fate.ts',
  diag: 'src/lib/supply-cost-diagnostics.ts',
  vit: 'src/lib/comment-vitality.ts',
  facts: 'scripts/lib/stage-preflight-facts.mts',
}
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: 'stage-active 하한을 보지 않는다 — reserve 만으로 D30 이 열린다',
    edits: [{ file: F.gen, find: "else { counts.personasActive = active; if (active < floor) codes.add('PERSONA_ACTIVE_SHORT') }", replace: 'else { counts.personasActive = active }' }] },
  { name: 'stage-active 칸이 없으면 초록으로 읽는다(fail-open)',
    edits: [{ file: F.gen, find: '    if (active === undefined || active === null || !isCount(active)\n', replace: '    if (active === null || (active !== undefined && !isCount(active))\n' }] },
  { name: 'stage-active ⊂ 계약 유효 어긋남을 받아들인다',
    edits: [{ file: F.gen, find: '      || (facts.contractValidPersonas !== null && active > facts.contractValidPersonas)) codes.add', replace: '      ) codes.add' }] },
  { name: 'D20 에도 stage-active 하한을 건다(소급 변경)',
    edits: [{ file: F.gen, find: "['d30', 'd50', 'd100']", replace: "['d20', 'd30', 'd50', 'd100']" }] },
  { name: 'PERSONA_ACTIVE_UNKNOWN 을 FAIL 로 접는다(모름이 FAIL 로 위장)',
    edits: [{ file: F.gen, find: "'PERSONA_UNKNOWN', 'PERSONA_ACTIVE_UNKNOWN', 'COMMENT_COST_UNKNOWN'", replace: "'PERSONA_UNKNOWN', 'COMMENT_COST_UNKNOWN'" }] },
  { name: '용량 helper 가 active 행 수를 stage-active 로 쓴다',
    edits: [{ file: F.reserve, find: "  return { contractValid: r.contractValid, stageActive: r.byState['stage-active'].length }", replace: "  return { contractValid: r.contractValid, stageActive: r.byState['stage-active'].length + r.byState['qualification-pending'].length }" }] },
  { name: '수동 Persona 증명 관문 시행일을 과거로 — 역사 판정 소급',
    edits: [{ file: F.evidence, find: "export const MANUAL_PERSONA_PROOF_GATE_FROM_KST = '2026-11-14' as const", replace: "export const MANUAL_PERSONA_PROOF_GATE_FROM_KST = '2026-09-01' as const" }] },
  { name: '자동 target 의 수동 Persona 댓글을 증명에서 묵인',
    edits: [{ file: F.evidence, find: "      if (manualOnTargets > 0) codes.add('COMMENT_MANUAL_PERSONA')", replace: '' }] },
  { name: '사람 승인 글의 수동 댓글까지 증명 FAIL 로 센다(범위 확장)',
    edits: [{ file: F.evidence, find: '      if (!(p.decider === \'auto\' && p.unattended)) continue\n      manualOnTargets += manualHere', replace: '      manualOnTargets += manualHere\n      if (!(p.decider === \'auto\' && p.unattended)) continue' }] },
  { name: 'noReady 단계 분해에서 재시도 단계를 뺀다',
    edits: [{ file: F.fate, find: "    if (fate === 'noReady') noReadyStage[e.stage] = (noReadyStage[e.stage] ?? 0) + e.settledUsd", replace: "    if (fate === 'noReady' && !e.stage.endsWith('Retry')) noReadyStage[e.stage] = (noReadyStage[e.stage] ?? 0) + e.settledUsd" }] },
  { name: 'epoch 진단이 시각을 못 읽은 회차를 조용히 넣는다',
    edits: [{ file: F.diag, find: '    if (at === null || !Number.isFinite(fromMs)) { unparsed += 1; continue }', replace: '    if (at === null || !Number.isFinite(fromMs)) { epochRuns.add(run); continue }' }] },
  { name: '판정 사실에 epoch 단가를 넣는다(유리한 회차만 골라 판정)',
    edits: [{ file: F.facts, find: '        usdPerSlotValidResult: costAttribution?.usdPerSlotValidResult ?? null,', replace: '        usdPerSlotValidResult: costEpochDiagnosticOf({ entries: supplyEntries, fateByKey, cohortRuns: cohort.cohortRuns }).usdPerSlotValidResult,' }] },
  { name: 'vitality — 글쓴이 답글을 일반 중복과 섞는다',
    edits: [{ file: F.vit, find: '      if (p.authorPersonaKey !== null && k === p.authorPersonaKey) authorReplies = n\n      else if (n > 1) duplicated = true', replace: '      if (n > 1) duplicated = true' }] },
  { name: 'vitality — 24시간이 안 된 글도 고립률 분모에 넣는다',
    edits: [{ file: F.vit, find: '    if (nowMs - publishedAt >= VITALITY_ISOLATION_WINDOW_MS) {', replace: '    if (true) {' }] },
  { name: 'vitality — 부분 데이터를 0 으로 읽는다',
    edits: [{ file: F.vit, find: "    if (!readable(p)) { codes.add('PARTIAL_DATA'); continue }", replace: '' }] },
  { name: 'vitality — 손님을 실회원으로 센다',
    edits: [{ file: F.vit, find: "    if (live.some((c) => c.origin === 'MEMBER')) memberPosts += 1", replace: "    if (live.some((c) => c.origin === 'MEMBER' || c.origin === 'GUEST')) memberPosts += 1" }] },
  { name: 'vitality — 평균 미달을 FAIL 로(quota 화)',
    edits: [{ file: F.vit, find: '  const failing = dup > 0 || authorOver > 0 || personaOver > 0', replace: '  const failing = dup > 0 || authorOver > 0 || personaOver > 0 || (readablePosts > 0 && liveTotal / readablePosts < 5)' }] },
]

const CHECKS = ['scripts/d30-stretch-check.mts']
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const ORIGINAL = new Map(files.map((f) => [f, readFileSync(f, 'utf-8')]))
const HASH = new Map([...ORIGINAL].map(([f, s]) => [f, sha(s)]))
const restore = (): void => { for (const [f, s] of ORIGINAL) writeFileSync(f, s) }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { restore(); process.exit(130) })

const runChecks = (): { failed: boolean; summary: string } => {
  const lines: string[] = []
  let failed = false
  for (const c of CHECKS) {
    const r = spawnSync(process.execPath, [...process.execArgv, c], { encoding: 'utf-8', timeout: 600_000 })
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (r.status !== 0) {
      failed = true
      const f = text.split('\n').filter((l) => l.includes('🔴 FAIL') || /Error/.test(l)).slice(0, 1).map((l) => l.trim().slice(0, 160))
      lines.push(`${c.replace('scripts/', '')} exit ${String(r.status)} ${f.join('')}`)
    }
  }
  return { failed, summary: lines.join(' | ') || 'exit 0' }
}

let killed = 0
let survived = 0
let invalid = 0
try {
  const base = runChecks()
  if (base.failed) { console.log(`🔴 기준선 FAIL — ${base.summary}`); process.exit(1) }
  console.log('  ✅ 기준선 PASS')
  for (const m of MUTATIONS) {
    let valid = true
    for (const e of m.edits) {
      const cur = readFileSync(e.file, 'utf-8')
      const n = cur.split(e.find).length - 1
      if (n !== 1) { valid = false; console.log(`  ❌ 변이 무효(문장 ${n}회) — ${m.name} · ${e.file}`); break }
      writeFileSync(e.file, cur.replace(e.find, e.replace))
    }
    if (!valid) { invalid += 1; restore(); continue }
    const r = runChecks()
    restore()
    for (const [f, h] of HASH) if (sha(readFileSync(f, 'utf-8')) !== h) { console.log(`🔴 원복 해시 불일치 — ${f}`); process.exit(1) }
    if (r.failed) { killed += 1; console.log(`  ✅ 잡았다 — ${m.name}\n       ${r.summary}`) } else { survived += 1; console.log(`  ❌ 살아남았다 — ${m.name}`) }
  }
} finally { restore() }
const ok = survived === 0 && invalid === 0
console.log(`\n${ok ? '✅' : '🔴'} 변이 ${MUTATIONS.length}개 — 잡음 ${killed} · 살아남음 ${survived} · 무효 ${invalid} · 원본 해시 복원 확인`)
process.exit(ok ? 0 : 1)
