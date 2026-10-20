#!/usr/bin/env tsx
/**
 * preflight 시계 변이 시험 (2026-10-20)
 *
 *   SORAN_ISOLATED_DB=yes-throwaway DATABASE_URL=postgresql://…@127.0.0.1:PORT/soran_test npx tsx scripts/stage-preflight-window-mutation.mts
 *
 * 방어를 지운 코드로 `stage-preflight-window-check` 를 다시 돌려 **❌ 로 FAIL 하는지** 본다. 문장은 파일에 정확히 한 번 있어야 한다.
 * 🔴 로드 · 문법 실패는 잡은 것이 아니다 — 종료 코드 1 + 검사 줄 `❌` 가 있어야 "잡았다"로 센다(종료 2 · 줄 없음 = 무효).
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 해시를 대조한다. 신호 · 예외에도 되돌린다.
 * 🔴 도는 동안 이 작업 트리를 고치지 않는다.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

type Edit = { file: string; find: string; replace: string }
const F = { facts: 'scripts/lib/stage-preflight-facts.mts' }
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: '용량 창 끝이 전날 자정으로 되돌아간다 — preflightWindowsOf (06:15 회차 누락 재현)',
    edits: [{ file: F.facts, find: '  const to = now\n', replace: '  const to = proofTo\n' }] },
  { name: '용량 창 끝이 전날 자정으로 되돌아간다 — cohort 호출 지점',
    edits: [{ file: F.facts, find: 'windowFrom: win.capacity.from, windowTo: win.capacity.to,', replace: 'windowFrom: win.proof.from, windowTo: win.proof.to,' }] },
  { name: '용량 창이 72h 가 아니다 — 48h',
    edits: [{ file: F.facts, find: 'export const CAPACITY_WINDOW_MS = UNIT_COST_DAYS * 864e5', replace: 'export const CAPACITY_WINDOW_MS = 2 * 864e5' }] },
  { name: '용량 창 시작이 증명 창 시작을 따른다(롤링 아님)',
    edits: [{ file: F.facts, find: '  const from = new Date(now.getTime() - CAPACITY_WINDOW_MS)\n', replace: '  const from = proofFrom\n' }] },
  { name: '스냅샷 이후 회차를 넣는다 — 상한을 배타에서 포함으로 (now 정각 회차 · 자정 정각)',
    edits: [{ file: F.facts, find: 'if (at === null || at < fromMs || at >= toMs) continue', replace: 'if (at === null || at < fromMs || at > toMs) continue' }] },
  { name: '스냅샷 이후 회차를 넣는다 — 상한 제거',
    edits: [{ file: F.facts, find: 'if (at === null || at < fromMs || at >= toMs) continue', replace: 'if (at === null || at < fromMs) continue' }] },
  { name: '스냅샷 이후 큐 행을 넣는다 — DB createdAt 상한 제거',
    edits: [{ file: F.facts, find: 'createdAt: { gte: i.windowFrom, lt: i.windowTo }', replace: 'createdAt: { gte: i.windowFrom }' }] },
  { name: '전날 증명 창 끝이 now 로 늘어난다 — 오늘 데이터가 전날 증명에 샌다',
    edits: [{ file: F.facts, find: '  const proofTo = kstRange(evidenceDate).lt\n', replace: '  const proofTo = now\n' }] },
  { name: '전날 증명 날짜가 now 기준이 된다 — 오늘이 낀다',
    edits: [{ file: F.facts, find: '  const proofDates = recentDates(evidenceDate)\n', replace: '  const proofDates = recentDates(kstDateString(now))\n' }] },
  { name: '지연 조회가 용량 창으로 나간다 — 증명 창 호출 지점',
    edits: [{ file: F.facts, find: 'publishLatencyHours(prisma, win.proof.from, win.proof.to)', replace: 'publishLatencyHours(prisma, win.capacity.from, win.capacity.to)' }] },
  { name: '댓글 · 감사 단가가 용량 날짜를 쓴다 — 오늘 장부가 전날 증명에 샌다',
    edits: [{ file: F.facts, find: '  const dates = win.proof.dates\n', replace: '  const dates = win.capacity.dates\n' }] },
  { name: '공급 장부가 증명 날짜만 읽는다 — 오늘 장부 누락',
    edits: [{ file: F.facts, find: 'pooledEntries(win.capacity.ledgerDates.map(', replace: 'pooledEntries(win.proof.dates.map(' }] },
  { name: '자정 정각 now 에서 그날 파일을 날짜에 넣는다 — 마지막 순간(to − 1ms) 대신 to',
    edits: [{ file: F.facts, find: 'const last = kstDateString(new Date(to.getTime() - 1))', replace: 'const last = kstDateString(to)' }] },
]

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const ORIGINAL = new Map(files.map((f) => [f, readFileSync(f, 'utf-8')]))
const HASH = new Map([...ORIGINAL].map(([f, s]) => [f, sha(s)]))
const restore = (): void => { for (const [f, s] of ORIGINAL) writeFileSync(f, s) }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { restore(); process.exit(130) })

const runCheck = (): { failed: boolean; detected: boolean; summary: string } => {
  const r = spawnSync(process.execPath, [...process.execArgv, 'scripts/stage-preflight-window-check.mts'], { encoding: 'utf-8', timeout: 600_000 })
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const fails = text.split('\n').filter((l) => l.includes('❌')).slice(0, 2).map((l) => l.trim())
  // 🔴 검사 줄이 ❌ 로 끝나고 종료 1 이어야 "잡았다" — 로드 · 문법 · 가드 실패(종료 2 등)는 검출이 아니다
  return { failed: r.status !== 0, detected: r.status === 1 && fails.length > 0, summary: `exit ${r.status} ${fails.join(' | ')}` }
}

let killed = 0
let survived = 0
let invalid = 0
try {
  const base = runCheck()
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
    const r = runCheck()
    restore()
    for (const [f, h] of HASH) if (sha(readFileSync(f, 'utf-8')) !== h) { console.log(`🔴 원복 해시 불일치 — ${f}`); process.exit(1) }
    if (r.detected) { killed += 1; console.log(`  ✅ 잡았다 — ${m.name}\n       ${r.summary}`) }
    else if (r.failed) { invalid += 1; console.log(`  ❌ 검출 아님(로드 · 문법 · 가드 실패) — ${m.name}\n       ${r.summary}`) }
    else { survived += 1; console.log(`  ❌ 살아남았다 — ${m.name}\n       ${r.summary}`) }
  }
} finally { restore() }
const ok = survived === 0 && invalid === 0
console.log(`\n${ok ? '✅' : '🔴'} 변이 ${MUTATIONS.length}개 — 잡음 ${killed} · 살아남음 ${survived} · 무효 ${invalid} · 원본 해시 복원 확인`)
process.exit(ok ? 0 : 1)
