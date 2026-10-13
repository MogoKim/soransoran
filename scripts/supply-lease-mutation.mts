#!/usr/bin/env tsx
/**
 * 공급 커널 lease · 실행 token 변이 시험 (2026-10-12 Batch C1)
 *
 *   npx tsx scripts/supply-lease-mutation.mts
 *
 * 방어를 지운 코드로 검사(`supply-lease-check` · 필요하면 `supply-process-check`)를 다시 돌려 **FAIL 로 바뀌는지** 본다.
 * 바꿀 문장이 파일에 정확히 한 번 있어야 한다(없거나 여럿이면 변이 무효 = 이 하네스가 FAIL).
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 해시를 대조한다. 중간에 끊겨도(신호 · 예외) 되돌린다.
 * 🔴 실제 OS 프로세스 반례는 macOS + /usr/bin/lockf 에서만 돈다 — 그 밖에서는 이 하네스 자체를 SKIP(실패 아님 · PASS 아님)로 끝낸다.
 * 🔴 도는 동안 이 작업 트리를 고치지 않는다(변이 코드가 다른 검사에 섞인다).
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

import { LOCKF_PATH, lockfUsable } from './lib/runner-lease.mjs'

type Edit = { file: string; find: string; replace: string }
type Mutation = { name: string; edits: Edit[]; checks: ('lease' | 'process')[] }

const F = {
  proc: 'scripts/supply-process.mts',
  lease: 'scripts/lib/supply-lease.mts',
  kernel: 'scripts/lib/runner-lease.mts',
  reserve: 'src/lib/supply-scheduled-reserve.ts',
}
const CHECKS = {
  lease: ['scripts/supply-lease-check.mts'],
  process: ['scripts/supply-process-check.mts'],
} as const

const MUTATIONS: Mutation[] = [
  {
    name: '옛 wx 잠금 복귀 — live 진입이 lease 대신 collect-lock wx 잠금을 잡는다',
    edits: [{ file: F.proc, find: '  return mayWriteRunState({ live: LIVE, killOpen }) ? viaLease() : main(null)\n',
      replace: "  if (!mayWriteRunState({ live: LIVE, killOpen })) return main(null)\n  const { acquireLock } = await import('./lib/collect-lock.mjs')\n"
        + "  return acquireLock(join(DATA_DIR, 'supply-process.lock'), Date.now(), 45 * 60_000).ok ? main(null) : 0\n" }],
    checks: ['lease', 'process'],
  },
  {
    name: 'lease 생략 — live 도 lease 없이 본체로 간다',
    edits: [{ file: F.proc, find: '  return mayWriteRunState({ live: LIVE, killOpen }) ? viaLease() : main(null)\n',
      replace: '  return mayWriteRunState({ live: LIVE, killOpen }) ? main(null) : main(null)\n' }],
    checks: ['lease', 'process'],
  },
  {
    name: 'lease 생략 — 회차 자식이 lease 재증명 실패를 무시한다',
    edits: [{ file: F.lease,
      find: "    if (!v.ok) { o.log(`🔴 LEASE_NOT_PROVEN(회차 자식) — ${v.reason} · provider 0 · DB 0`); return 1 }\n    return o.body(v.proof)",
      replace: "    return o.body(v.ok ? v.proof : { lockPath: '', followUpDir: '', lockf: '', fd: 9 })" }],
    checks: ['lease'],
  },
  {
    name: 'fd 전달 제거 — 자식 단계 stdio 9 번 칸에 fd 9 를 싣지 않는다',
    edits: [{ file: F.lease, find: '    base.push(proof.fd)\n', replace: '    void proof\n' }],
    checks: ['lease'],
  },
  {
    name: 'fd 전달 제거 — 회차 자식에게 fd 9 를 넘기지 않는다',
    edits: [{ file: F.lease, find: '  stdio.push(LEASE_FD)\n  const env: NodeJS.ProcessEnv', replace: "  stdio.push('ignore')\n  const env: NodeJS.ProcessEnv" }],
    checks: ['lease'],
  },
  {
    name: 'fd 전달 제거 — 러너 run() 이 lease 증명을 자식 단계에 넘기지 않는다',
    edits: [{ file: F.proc, find: 'const how = stageSpawnOf(script, args, STAGE_LEASE)', replace: 'const how = stageSpawnOf(script, args, null)' }],
    checks: ['process'],
  },
  {
    name: 'token 원자성 제거 — 임시 파일 + rename 대신 제자리 쓰기',
    edits: [{ file: F.lease,
      find: "  try { unlinkSync(tmp) } catch { /* 없다 */ }\n  writeFileSync(tmp, `${JSON.stringify(token, null, 2)}\\n`, { flag: 'wx', mode: 0o600 })\n  renameSync(tmp, path)",
      replace: "  void tmp; void unlinkSync; void renameSync\n  writeFileSync(path, `${JSON.stringify(token, null, 2)}\\n`, { mode: 0o600 })" }],
    checks: ['lease'],
  },
  {
    name: 'follow-up 상한 제거 — 겹친 깨움마다 회차를 더 돈다',
    edits: [
      { file: F.kernel, find: '    if (pass >= MAX_FOLLOW_UPS) break\n', replace: '    if (pass >= 99) break\n' },
      { file: F.kernel, find: "  return pass < MAX_FOLLOW_UPS && take === 'TAKEN'", replace: "  return pass < 99 && take === 'TAKEN'" },
    ],
    checks: ['lease'],
  },
  {
    name: 'trigger 보존 제거 — 표식을 거두며 trigger 를 버린다',
    edits: [{ file: F.kernel, find: "  return { take: 'TAKEN', ...read }", replace: "  return { take: 'TAKEN', trigger: null, at: null }" }],
    checks: ['lease'],
  },
  {
    name: '깨진 표식 추정 — JSON 이 아니면 event 로 읽는다',
    edits: [{ file: F.kernel, find: "  try { v = JSON.parse(raw) } catch { return { trigger: 'unknown', at: null } }",
      replace: "  try { v = JSON.parse(raw) } catch { return { trigger: 'event', at: null } }" }],
    checks: ['lease'],
  },
  {
    name: 'probe 가 잠금 파일을 지운다 — lockf -k 제거',
    edits: [{ file: F.kernel, find: "['-k', '-s', '-n', '-t', '0', lockPath, '/usr/bin/true']", replace: "['-s', '-n', '-t', '0', lockPath, '/usr/bin/true']" }],
    checks: ['lease'],
  },
  {
    name: 'busy 재시도 제거 — probe 순간에 뜬 정기 회차가 표식만 남기고 사라진다',
    edits: [{ file: F.lease, find: 'busyRetryMs: SUPPLY_BUSY_RETRY_MS, log: o.log,', replace: 'busyRetryMs: 0, log: o.log,' }],
    checks: ['lease'],
  },
  {
    name: 'token 이 예산 허가가 된다 — token env 가 있으면 창 밖도 정기로 판정',
    edits: [{ file: F.reserve, find: "  const label = (env[LAUNCHD_LABEL_ENV] ?? '').trim()\n",
      replace: "  if ((env.SORAN_SUPPLY_RUN_TOKEN ?? '') !== '' && activeSlotAt(now, slots, windowMs) === null) return { kind: 'scheduled', slot: '2026-10-12 08:15', why: 'token' }\n"
        + "  const label = (env[LAUNCHD_LABEL_ENV] ?? '').trim()\n" }],
    checks: ['lease'],
  },
]

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const ORIGINAL = new Map(files.map((f) => [f, readFileSync(f, 'utf-8')]))
const ORIGINAL_HASH = new Map([...ORIGINAL].map(([f, s]) => [f, sha(s)]))
const restore = (): void => { for (const [f, s] of ORIGINAL) writeFileSync(f, s) }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { restore(); process.exit(130) })

const runChecks = (names: readonly ('lease' | 'process')[]): { failed: boolean; summary: string } => {
  const out: string[] = []
  let failed = false
  for (const n of names) {
    for (const script of CHECKS[n]) {
      const r = spawnSync(process.execPath, [...process.execArgv, script], { encoding: 'utf-8', timeout: 900_000 })
      const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
      const fails = text.split('\n').filter((l) => l.includes('❌')).slice(0, 2).map((l) => l.trim())
      if (r.status !== 0) failed = true
      out.push(`${script.replace('scripts/', '')} exit ${r.status} ${fails.join(' | ')}`)
    }
  }
  return { failed, summary: out.join(' ; ') }
}

if (!(process.platform === 'darwin' && lockfUsable(LOCKF_PATH))) {
  console.log('⏭️  SKIP — macOS + /usr/bin/lockf 전용 변이 시험이다(실제 OS 프로세스 반례가 필요하다). PASS 로 세지 않는다')
  process.exit(0)
}

let killed = 0
let survived = 0
let invalid = 0
try {
  console.log('\n기준선 — 변이 없이 검사가 통과해야 변이 결과에 뜻이 있다')
  const base = runChecks(['lease', 'process'])
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
    const r = runChecks(m.checks)
    restore()
    for (const [f, h] of ORIGINAL_HASH) {
      if (sha(readFileSync(f, 'utf-8')) !== h) { console.log(`🔴 원복 해시 불일치 — ${f}`); process.exit(1) }
    }
    if (r.failed) { killed += 1; console.log(`  ✅ 잡았다 — ${m.name}\n       ${r.summary}`) } else { survived += 1; console.log(`  ❌ 살아남았다 — ${m.name}\n       ${r.summary}`) }
  }
} finally {
  restore()
}
const ok = survived === 0 && invalid === 0
console.log(`\n${ok ? '✅' : '🔴'} 변이 ${MUTATIONS.length}개 — 잡음 ${killed} · 살아남음 ${survived} · 무효 ${invalid} · 원본 해시 복원 확인`)
process.exit(ok ? 0 : 1)
