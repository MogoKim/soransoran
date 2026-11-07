#!/usr/bin/env tsx
/**
 * 충돌 뒤 다시 읽기(고정 대기 일정) 변이 시험 (2026-11-08 · PR #835 CI D100 ⑧)
 *
 *   DATABASE_URL=… DIRECT_URL=… SORAN_ISOLATED_DB=yes-throwaway npx tsx scripts/publish-recheck-mutation.mts
 *
 * `src/lib/original-post-publish-tx.ts` 의 방어를 지운 코드로 `publish-slot-db-check` 를 돌려 **⑫ 실제 동작 반례가 FAIL 로 바뀌는지** 본다.
 * 구조(정규식) 검사가 아니라 격리 DB 트랜잭션 반례가 잡아야 한다.
 * 🔴 **자식을 죽이지 않는다.** `SORAN_SLOT_DB_STOP_AFTER_SECTION_12=yes-recheck-mutation` 을 넘기면 검사가 ⑫ 뒤 정리(wipe · disconnect)를
 *    마치고 sentinel 을 찍은 뒤 ⑪ E2E 를 시작하지 않고 **스스로 끝난다** — 그 종료를 기다린다(앞판은 ⑪ 헤더에서 SIGTERM 했고,
 *    이미 띄운 E2E 손자가 고아로 남아 다음 검사 DB 에 썼다). 매 실행 뒤 격리 DB 가 비었는지(Post · Queue · ActivityLog 0) 센다.
 * 겨냥 문장은 파일에 정확히 한 번 있어야 한다(0 · 2 이상은 무효 = FAIL).
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 sha256 을 대조한다. 신호 · 예외에도 되돌린다. 격리 DB 전용(운영 DB 0).
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

const URL = process.env.DATABASE_URL ?? ''
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway' || !/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL) || !/\/soran_test(\?|$)/.test(URL)) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  process.exit(2)
}

const F = 'src/lib/original-post-publish-tx.ts'
const CHECK = 'scripts/publish-slot-db-check.mts'
const STOP_ENV = 'SORAN_SLOT_DB_STOP_AFTER_SECTION_12'
const STOP_VALUE = 'yes-recheck-mutation'
const SENTINEL = 'SLOT_DB_STOPPED_AFTER_12'

/** 🔴 구조 잠금 — 정지 분기는 정확히 하나 · 정확 일치 · 정리(disconnect) 뒤 · ⑪ 헤더와 E2E spawn 앞 */
{
  const src = readFileSync(CHECK, 'utf-8')
  const guard = `if ((process.env.${STOP_ENV} ?? '') === '${STOP_VALUE}') {`
  const at = src.indexOf(guard)
  const lastDisconnect = src.lastIndexOf('await prisma.$disconnect()', at)
  const section11 = src.indexOf("console.log('\\n⑪ ")
  const e2eSpawn = src.indexOf("scripts/source-evidence-e2e-db-check.mts")
  const problems: string[] = []
  if (src.split(guard).length - 1 !== 1) problems.push('정지 분기가 정확히 하나가 아니다')
  if (src.split(STOP_ENV).length - 1 !== 1) problems.push('정지 env 를 읽는 곳이 하나가 아니다')
  if (!(lastDisconnect >= 0 && lastDisconnect < at && src.lastIndexOf('await wipe()', at) < lastDisconnect)) problems.push('정지가 정리(wipe · disconnect) 뒤가 아니다')
  if (!(at >= 0 && at < section11 && at < e2eSpawn)) problems.push('정지가 ⑪ 헤더 · E2E spawn 앞이 아니다')
  if (!src.slice(at, section11).includes(`${SENTINEL} ·`) || !src.slice(at, section11).includes('return')) problems.push('정지 분기가 sentinel 뒤 정상 return 하지 않는다')
  if (problems.length > 0) { console.log(`🔴 구조 잠금 실패 — ${problems.join(' · ')}`); process.exit(1) }
  console.log('  ✅ 구조 — 정지 분기 하나 · 정확 일치 · 정리 뒤 · ⑪ 앞 · sentinel 뒤 정상 return')
}

const prisma = new PrismaClient()
/** 🔴 실행 뒤 격리 DB 가 비었는가 — 고아 자식이 남아 쓰면 여기서 잡힌다(잠깐 기다린 뒤 두 번 센다) */
async function dbEmpty(): Promise<{ ok: boolean; detail: string }> {
  const count = async (): Promise<string> => {
    const [p, q, l] = await Promise.all([prisma.post.count(), prisma.originalPostApprovalQueue.count(), prisma.personaActivityLog.count()])
    return `Post ${p} · Queue ${q} · ActivityLog ${l}`
  }
  const first = await count()
  await new Promise((r) => { setTimeout(r, 3_000) })
  const second = await count()
  return { ok: first === 'Post 0 · Queue 0 · ActivityLog 0' && second === first, detail: `${first} → 3초 뒤 ${second}` }
}
type Edit = { find: string; replace: string }
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: '반복 제거(1회 회귀) — 다시 읽기를 한 번만 한다',
    edits: [{ find: '  for (const delay of RECHECK_DELAYS_MS) {', replace: '  for (const delay of RECHECK_DELAYS_MS.slice(0, 1)) {' }] },
  { name: '횟수 변경 — 마지막 대기(16000ms)를 뺀다',
    edits: [{ find: 'Object.freeze([0, 250, 500, 1000, 2000, 4000, 8000, 16000])', replace: 'Object.freeze([0, 250, 500, 1000, 2000, 4000, 8000])' }] },
  { name: '"아직 낼 수 있다" 를 정상 무발행으로 처리한다',
    edits: [{ find: "    if (r.kind === 'recheck-open' || r.kind === 'conflict') {",
      replace: "    if (r.kind === 'recheck-open') return { kind: 'blocked', code: 'SLOT_CONSUMED', detail: 'mutant' }\n    if (r.kind === 'conflict') {" }] },
  { name: '다른 차단(ALREADY_PUBLISHED · AUTO_READY_RECHECK …)도 대기로 보낸다',
    edits: [{ find: "    if (r.kind === 'recheck-open' || r.kind === 'conflict') {", replace: "    if (r.kind === 'recheck-open' || r.kind === 'conflict' || r.kind === 'blocked') {" }] },
  { name: '다시 읽기의 충돌을 즉시 실패로 끝낸다(회복 없음)',
    edits: [{ find: "    if (r.kind === 'recheck-open' || r.kind === 'conflict') {", replace: "    if (r.kind === 'recheck-open') {" }] },
  { name: '대기를 하지 않는다 — 일정은 돌지만 기다리지 않는다',
    edits: [{ find: '    if (delay > 0) await sleep(delay)\n', replace: '' }] },
  { name: '세 번째 write — 다시 읽기 자리에서 write 시도를 다시 한다',
    edits: [{ find: "  return settleAfterConflicts(() => publishAttempt(prisma, input, deps, 'recheck'), deps.sleep ?? realSleep)",
      replace: "  return settleAfterConflicts(() => publishAttempt(prisma, input, deps, 2), deps.sleep ?? realSleep)" }] },
]

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const ORIGINAL = readFileSync(F, 'utf-8')
const HASH = sha(ORIGINAL)
const restore = (): void => { writeFileSync(F, ORIGINAL) }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { restore(); process.exit(130) })
const verifyRestored = (): void => {
  if (sha(readFileSync(F, 'utf-8')) !== HASH) { restore(); console.log(`🔴 원복 해시 불일치 — ${F}`); process.exit(1) }
}

/**
 * ⑫ 구간만 본다 — 정지 env 를 넘기고 자식이 **스스로 끝날 때까지** 기다린다. ⑫ 안에 ❌ 가 하나라도 있으면 잡힌 것이다.
 *    sentinel 이 없거나 ⑪ 헤더가 보이면 무효다. 상한 timeout 은 안전장치뿐 — 넘으면 프로세스 그룹 전체를 끝내고 무효로 센다.
 */
function runSection12(): Promise<{ reached: boolean; stopped: boolean; ran11: boolean; timedOut: boolean; fails: string[]; passes: number }> {
  return new Promise((resolve) => {
    const c = spawn(join(process.cwd(), 'node_modules/.bin/tsx'), [CHECK], { env: { ...process.env, [STOP_ENV]: STOP_VALUE }, detached: true })
    let buf = ''
    let inSection = false
    let reached = false
    let stopped = false
    let ran11 = false
    let timedOut = false
    let done = false
    const fails: string[] = []
    let passes = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const onLine = (line: string): void => {
      if (line.includes('⑫ 🔴 🔴 두 번 연속 직렬화 충돌')) { inSection = true; reached = true; return }
      if (line.startsWith(`${SENTINEL} ·`)) { inSection = false; stopped = true; return }
      if (/^\s*⑪ /.test(line)) { inSection = false; ran11 = true; return }
      if (!inSection) return
      if (line.includes('❌')) fails.push(line.trim().slice(0, 150))
      else if (line.includes('✅')) passes += 1
    }
    c.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const l of lines) onLine(l)
    })
    c.on('close', () => {
      if (done) return
      done = true
      if (timer !== null) clearTimeout(timer)
      if (buf !== '') onLine(buf)
      resolve({ reached, stopped, ran11, timedOut, fails, passes })
    })
    // 🔴 안전장치 — 정상 경로에서는 불리지 않는다. 불리면 그룹 전체를 끝낸다(손자까지)
    timer = setTimeout(() => {
      timedOut = true
      try { if (c.pid !== undefined) process.kill(-c.pid, 'SIGKILL') } catch { /* 이미 끝났다 */ }
    }, 900_000)
  })
}

const validRun = (r: Awaited<ReturnType<typeof runSection12>>): string | null =>
  !r.reached ? '⑫ 에 도달하지 못했다' : !r.stopped ? 'sentinel 없이 끝났다' : r.ran11 ? '⑪ 이 시작됐다' : r.timedOut ? '상한 timeout' : null

let killed = 0
let survived = 0
let invalid = 0
try {
  const base = await runSection12()
  const baseBad = validRun(base)
  const baseDb = await dbEmpty()
  if (baseBad !== null || base.fails.length > 0 || base.passes === 0 || !baseDb.ok) {
    console.log(`🔴 기준선 FAIL — ${baseBad ?? ''} · ⑫ ${base.passes} pass · ${base.fails.length} fail ${base.fails.join(' | ')} · DB ${baseDb.detail}`)
    process.exit(1)
  }
  console.log(`  ✅ 기준선 PASS — ⑫ ${base.passes} pass · 0 fail · sentinel 뒤 정상 종료 · ⑪ 0 · DB ${baseDb.detail}`)
  for (const m of MUTATIONS) {
    let valid = true
    for (const e of m.edits) {
      const cur = readFileSync(F, 'utf-8')
      const n = cur.split(e.find).length - 1
      if (n !== 1) { valid = false; console.log(`  ❌ 변이 무효(문장 ${n}회) — ${m.name}`); break }
      writeFileSync(F, cur.replace(e.find, e.replace))
    }
    if (!valid) { invalid += 1; restore(); verifyRestored(); continue }
    const r = await runSection12()
    restore()
    verifyRestored()
    const bad = validRun(r)
    const db = await dbEmpty()
    if (bad !== null || !db.ok) {
      invalid += 1
      console.log(`  ❌ 변이 실행 무효 — ${m.name} · ${bad ?? ''} · DB ${db.detail}`)
    } else if (r.fails.length > 0) { killed += 1; console.log(`  ✅ 잡았다 — ${m.name}\n       ⑫ ${r.fails[0]}`) } else {
      survived += 1
      console.log(`  ❌ 살아남았다 — ${m.name}\n       ⑫ ${r.passes} pass · 0 fail`)
    }
  }
} finally { restore(); await prisma.$disconnect() }
verifyRestored()
const ok = survived === 0 && invalid === 0
console.log(`\n${ok ? '✅' : '🔴'} 변이 ${MUTATIONS.length}개 — 잡음 ${killed} · 살아남음 ${survived} · 무효 ${invalid} · 원본 해시 복원 확인(${F})`)
process.exit(ok ? 0 : 1)
