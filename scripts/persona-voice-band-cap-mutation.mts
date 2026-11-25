#!/usr/bin/env tsx
/**
 * 새 묶음 voiceBand 상한(`planAppendOnlyBundles` ③′) — 변이 시험 (2026-11-23 · wave8)
 *
 *   npx tsx scripts/persona-voice-band-cap-mutation.mts
 *
 * 방어를 지운 코드로 `persona-voice-band-cap-check` 를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 겨냥 문장은 파일에 정확히 한 번 있어야 한다(0 · 2 이상은 무효 = FAIL).
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 sha256 을 대조한다. 신호 · 예외에도 되돌린다.
 * 🔴 도는 동안 이 작업 트리를 고치지 않는다. DB 0 · provider 0 · 네트워크 0.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

type Edit = { file: string; find: string; replace: string }
const F = {
  store: 'scripts/lib/persona-reference-store.mts',
  plan: 'scripts/lib/persona-reference-supplement-plan.mts',
  expansion: 'src/lib/persona-expansion.ts',
  gate: 'scripts/lib/persona-expansion-gate.mts',
  autogen: 'src/lib/persona-autogen.ts',
  voiceRef: 'src/lib/persona-voice-reference.ts',
}
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: '상한 끔 — 넘는 자리를 고르지 않는다(옛 ③ — 보통 33/43 그대로)',
    edits: [{ file: F.store, find: '    if (roomFor(band)) take(band)\n    else over.push(code)\n', replace: '    take(band)\n' }] },
  { name: '여분의 밴드 상한을 보지 않는다 — 같은 밴드 여분으로 바꾼다',
    edits: [{ file: F.store, find: 'if (to === null || !roomFor(to)) { j += 1; continue }', replace: 'if (to === null) { j += 1; continue }' }] },
  { name: '문체 거리 건너뛰기 제거 — 운영 · 뒤 자리와 같은 말투 여분을 앉힌다',
    edits: [{ file: F.store, find: 'if (voiceTooClose(mine, others, baseline) !== null) {', replace: 'if (false) {' }] },
  { name: 'seed 공유 건너뛰기 제거 — 다른 자리와 댓글을 나눠 가진 여분을 앉힌다',
    edits: [{ file: F.store, find: 'if (share === null || share > 1) {', replace: 'if (false) {' }] },
  { name: '앞 자리만 상대 — 교체 화자가 뒤 자리와 같은 말투여도 앉힌다(뒤 자리가 격리된다)',
    edits: [{ file: F.store, find: 'const others = [...operating, ...kept, ...chosen]',
      replace: 'const others = [...operating, ...kept.filter((k) => Number(k.personaCode.slice(1)) < Number(code.slice(1))), ...chosen]' }] },
  { name: '운영 기준에서 동결 묶음을 뺀다 — 정본 배정만으로 문체 거리를 잰다',
    edits: [{ file: F.store, find: 'const bundle = occupiedBy.get(code) ?? baseBy.get(code)', replace: 'const bundle = baseBy.get(code)' }] },
  { name: '정본에서 받은 자리를 세지 않는다 — 묶음 전체가 상한을 넘는다',
    edits: [{ file: F.store, find: '  for (const code of input.fromCanon) { const band = bandAt(code); if (band !== null) take(band) }\n', replace: '' }] },
  { name: '남은 넘침을 버린다 — 바꿀 화자가 모자라도 조용히 통과',
    edits: [{ file: F.store, find: '  return { replaced, skipped, baseline, problems }', replace: '  return { replaced, skipped, baseline, problems: [] }' }] },
  { name: '못 바꾼 자리를 세지 않는다 — 남은 넘침을 적게 센다',
    edits: [{ file: F.store, find: 'if (placed === null) { take(from); continue }', replace: 'if (placed === null) continue' }] },
  { name: '못 바꾼 자리를 비운다 — 빈 자리(BUNDLE_MISSING)를 만든다',
    edits: [{ file: F.store, find: 'if (placed === null) { take(from); continue }', replace: 'if (placed === null) { input.byCode.delete(code); take(from); continue }' }] },
  { name: '여분을 순위 역순으로 — 다음 순위가 아니라 맨 뒤 화자부터 앉힌다',
    edits: [{ file: F.store, find: 'const spares = input.ranked.filter((bundle) => !seated.has(input.digest(bundle)))',
      replace: 'const spares = input.ranked.filter((bundle) => !seated.has(input.digest(bundle))).reverse()' }] },
  { name: '이미 앉은 화자를 여분에서 빼지 않는다',
    edits: [{ file: F.store, find: 'const spares = input.ranked.filter((bundle) => !seated.has(input.digest(bundle)))',
      replace: 'const spares = input.ranked.filter(() => seated.size >= 0)' }] },
  { name: '기록이 남은 넘침을 막지 않는다',
    edits: [{ file: F.plan, find: '  for (const p of plan.voiceBandCap.problems) problems.push(`${p.rule}:${p.detail}`)\n', replace: '' }] },
  { name: '문턱 경계 — 70% 와 같은 점유도 막는다(판정 상수 변경)',
    edits: [{ file: F.expansion, find: 't.count / t.total > BATCH_SHARE_MAX', replace: 't.count / t.total >= BATCH_SHARE_MAX' }] },
  { name: '판정이 새 후보의 밴드를 재지 않는다',
    edits: [{ file: F.gate, find: 'const band = v === undefined ? null : voiceBandOfBundle(v.bundle)', replace: 'const band = null' }] },
  { name: '밴드 함수가 묶음을 보지 않는다 — 전부 보통',
    edits: [{ file: F.autogen, find: 'return readLengthBand(voiceCoreFromBundle(b).length)', replace: "return readLengthBand('중간 길이')" }] },
  { name: 'VOICE_TOO_CLOSE 식이 아무것도 막지 않는다',
    edits: [{ file: F.voiceRef, find: 'near !== undefined && near.distance < baseline ?', replace: 'near !== undefined && near.distance < 0 ?' }] },
]

const CHECKS = ['scripts/persona-voice-band-cap-check.mts'] as const

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
  const r = spawnSync(process.execPath, [...process.execArgv, script], { encoding: 'utf-8', timeout: 600_000 })
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const fails = text.split('\n').filter((l) => l.includes('🔴 FAIL') || l.includes('Error')).slice(0, 2).map((l) => l.trim().slice(0, 160))
  return { failed: r.status !== 0, summary: `${script.replace('scripts/', '')} exit ${r.status} ${fails.join(' | ')}` }
}
/** 🔴 하나라도 실패하면 잡힌 것이다 */
const runChecks = (): { failed: boolean; summary: string } => {
  for (const c of CHECKS) {
    const r = runOne(c)
    if (r.failed) return r
  }
  return { failed: false, summary: '검사 모두 PASS' }
}

let killed = 0
let survived = 0
let invalid = 0
try {
  for (const c of CHECKS) {
    const base = runOne(c)
    if (base.failed) { console.log(`🔴 기준선 FAIL — ${base.summary}`); process.exit(1) }
  }
  console.log('  ✅ 기준선 PASS')
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
