#!/usr/bin/env tsx
/**
 * 의미 검수 앞 지배 판정 변이 시험 — H2 공급 비용 (2026-11-14)
 *
 *   npx tsx scripts/pre-review-dominance-mutation.mts
 *
 * 보호 장치를 지운 코드로 `generation-loss-check` 를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 🔴 문장은 파일에 정확히 한 번 있어야 한다(0 · 2 이상이면 무효 — 죽은 변이를 통과로 세지 않는다).
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 해시를 대조한다. 신호 · 예외에도 되돌린다.
 * 🔴 도는 동안 이 작업 트리를 고치지 않는다. 운영 파일 · DB · 네트워크 0.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

type Edit = { file: string; find: string; replace: string }
const F = {
  run: 'scripts/lib/content-core-run.mts',
  pick: 'src/lib/micro-seed-auto-draft.ts',
}
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: '지배 판정을 무시한다 — 결론이 정해진 초안에도 의미 검수를 산다',
    edits: [{ file: F.run, find: '  if (dominated !== null) {', replace: '  if (false) {' }] },
  { name: '지배 판정이 늘 "채택 가능" — 검수 앞 차단이 죽는다',
    edits: [{ file: F.pick, find: "  return p.decision === 'AUTO_ADOPT' ? null : p", replace: '  return null' }] },
  { name: '검수를 hold 로 가정한다 — 깨끗한 초안까지 검수 없이 막는다(판정 변경)',
    edits: [{ file: F.pick, find: "  const p = pickV2({ ...input, machineOutcome: 'adopt', machineReason: '' }, now)", replace: "  const p = pickV2({ ...input, machineOutcome: 'hold', machineReason: '' }, now)" }] },
]

const CHECKS = ['scripts/generation-loss-check.mts']
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
      const f = text.split('\n').filter((l) => l.includes('FAIL') || /Error/.test(l)).slice(0, 1).map((l) => l.trim().slice(0, 160))
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
