#!/usr/bin/env tsx
/**
 * 사건 깨움 변이 시험 (2026-10-12 Batch C2)
 *
 *   npx tsx scripts/event-wake-mutation.mts
 *
 * 방어를 지운 코드로 `event-wake-check` 를 다시 돌려 **FAIL 로 바뀌는지** 본다. 문장은 파일에 정확히 한 번 있어야 한다.
 * 🔴 제자리에서 바꾸고 변이마다 원본 바이트로 되돌린 뒤 해시를 대조한다. 신호 · 예외에도 되돌린다.
 * 🔴 macOS + /usr/bin/lockf 전용(실제 프로세스 반례 포함) — 그 밖에서는 SKIP(PASS 아님).
 * 🔴 도는 동안 이 작업 트리를 고치지 않는다.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

import { LOCKF_PATH, lockfUsable } from './lib/runner-lease.mjs'

type Edit = { file: string; find: string; replace: string }
const F = {
  wake: 'scripts/lib/runner-wake.mts',
  pub: 'scripts/original-post-auto-publish.mts',
  rec: 'scripts/runner-recover.mts',
  recovery: 'src/lib/runner-recovery.ts',
  kernel: 'scripts/lib/runner-lease.mts',
}
const MUTATIONS: { name: string; edits: Edit[] }[] = [
  { name: 'kill switch 기본값이 켜진다 — 미설정 = comment',
    edits: [{ file: F.wake, find: "  if (raw === '') return { mode: 'off', note: `${EVENT_WAKE_ENV} 미설정 → off` }", replace: "  if (raw === '') return { mode: 'comment', note: 'x' }" }] },
  { name: '모르는 값이 켜진다 — fail-open',
    edits: [{ file: F.wake, find: "  return { mode: 'off', note: `${EVENT_WAKE_ENV} 모르는 값 → off` }", replace: "  return { mode: 'comment', note: 'x' }" }] },
  { name: '폐지된 all 이 다시 켜진다',
    edits: [{ file: F.wake, find: "  if (raw === 'comment') return { mode: raw, note: `${EVENT_WAKE_ENV}=${raw}` }", replace: "  if (raw === 'comment' || raw === 'all') return { mode: 'comment', note: `${EVENT_WAKE_ENV}=${raw}` }" }] },
  { name: '발행 러너가 정본 env 대신 process.env 로 깨운다(출처 분기)',
    edits: [{ file: F.pub, find: "wakeRunner({ target: 'comment', env: readEnvKeys([EVENT_WAKE_ENV]).values, nowMs: Date.now() })", replace: "wakeRunner({ target: 'comment', env: process.env, nowMs: Date.now() })" }] },
  { name: '결정 문서가 폐지된 all 을 다시 켜는 값으로 설명한다(N1 재발)',
    edits: [{ file: 'docs/decisions/persona-comment-followup.md', find: '켜는 값은 `comment` 하나다. 옛 `all`은 2026-11-07 폐지되어\n  모르는 값(off)으로 읽는다.', replace: '`comment`와 `all` 모두 댓글만 열며,\n  같은 범위다.' }] },
  { name: '설치 상태가 댓글 러너 미등록을 ON 으로 본다',
    edits: [{ file: F.wake, find: "  if (!i.commentRunnerLoaded) return {", replace: "  if (false) return {" }] },
  { name: 'off 여도 표식을 남긴다',
    edits: [{ file: F.wake, find: "    if (m.mode === 'off') return { kind: 'OFF', why: m.note }",
      replace: "    if (m.mode === 'off') { requestFollowUp(WAKE_TARGETS.comment.lockDir(i.home), i.nowMs, 'event'); return { kind: 'OFF', why: m.note } }" }] },
  { name: 'comment 모드가 공급 깨움까지 허용한다',
    edits: [{ file: F.wake, find: "  return target === 'comment' && mode === 'comment'", replace: "  return mode === 'comment'" }] },
  { name: '원자 공개 제거 — 정본 marker를 직접 쓴다',
    edits: [{ file: F.kernel, find: '      linkSync(temporary, path)', replace: "      writeFileSync(path, readFileSync(temporary, 'utf-8'), { flag: 'wx', mode: 0o600 })" }] },
  { name: '원자 claim 제거 — 읽어 복사하는 사이 새 깨움을 옛 marker와 합친다',
    edits: [{ file: F.kernel, find: '  try { renameSync(path, claimed) } catch (e) {', replace: "  try { writeFileSync(claimed, readFileSync(path, 'utf-8')) } catch (e) {" }] },
  { name: 'commit 전에 깨운다 — 트랜잭션 앞',
    edits: [{ file: F.pub, find: '  res = await publishOriginalPostTx(prisma, {', replace: "  wakeRunner({ target: 'comment', env: readEnvKeys([EVENT_WAKE_ENV]).values, nowMs: Date.now() })\n  res = await publishOriginalPostTx(prisma, {" }] },
  { name: 'failure-open 제거 — kickstart 실패가 발행 회차를 실패시킨다',
    edits: [{ file: F.pub, find: "console.log(`   ${wakeGate.ok ? describeWake('comment', wakeRunner({ target: 'comment', env: readEnvKeys([EVENT_WAKE_ENV]).values, nowMs: Date.now() })) : `깨움(comment) 0 — ${wakeGate.why}`}`)",
      replace: "if (wakeGate.ok) { const w = wakeRunner({ target: 'comment', env: readEnvKeys([EVENT_WAKE_ENV]).values, nowMs: Date.now() }); if (w.kind === 'SENT' && w.kick === 'FAILED') process.exit(1) }" }] },
  { name: '정합 · 감사 확인 앞에서 깨운다(보정 전 위치)',
    edits: [{ file: F.pub, find: '// ── ⑧ 정합 확인 ──', replace: "wakeRunner({ target: 'comment', env: readEnvKeys([EVENT_WAKE_ENV]).values, nowMs: Date.now() })\n// ── ⑧ 정합 확인 ──" }] },
  { name: '깨움 문을 무시한다 — 정합 · 감사 실패에도 깨운다',
    edits: [{ file: F.pub, find: '${wakeGate.ok ? describeWake(', replace: '${true ? describeWake(' }] },
  { name: '깨움 문이 정합 실패를 무시한다',
    edits: [{ file: F.wake, find: '  if (!i.verifyOk) return {', replace: '  if (false) return {' }] },
  { name: '깨움 문이 감사 무결성 실패를 무시한다',
    edits: [{ file: F.wake, find: '  if (!i.auditIntegrityOk) return {', replace: '  if (false) return {' }] },
  { name: 'kickstart 시간 상한 제거 — 매달린 launchctl 이 발행 러너를 붙잡는다',
    edits: [{ file: F.wake, find: "{ stdio: 'ignore', timeout: KICKSTART_TIMEOUT_MS }", replace: "{ stdio: 'ignore' }" }] },
  { name: '합치기 제거 — 임시 marker를 덮어쓰기 모드로 만든다',
    edits: [{ file: F.kernel, find: "{ flag: 'wx', mode: 0o600 })", replace: "{ flag: 'w', mode: 0o600 })" }] },
  { name: '고아 복구 상한 제거 — 같은 표식을 매번 다시 깨운다',
    edits: [{ file: F.recovery, find: "  if (i.handled.kind === 'valid' && i.handled.wakeAt === i.marker.at) return skip(", replace: '  if (false) return skip(' }] },
  { name: '처리 기록 fail-closed 제거 — 못 읽은 기록이면 깨운다(손상 시 회차마다 반복)',
    edits: [{ file: F.recovery, find: "  if (i.handled.kind === 'unreadable') return skip(", replace: '  if (false) return skip(' }] },
  { name: '처리 기록 손상을 없음으로 읽는다 — wakeAt 이 문자열이 아니면 missing',
    edits: [{ file: F.recovery, find: "isCanonicalIso(w) ? { kind: 'valid', wakeAt: w } : { kind: 'unreadable' }", replace: "isCanonicalIso(w) ? { kind: 'valid', wakeAt: w } : { kind: 'missing' }" }] },
  { name: '처리 기록 날짜 검증 제거 — 비어 있지 않은 문자열이면 valid("garbage" 도)',
    edits: [{ file: F.recovery, find: "typeof w === 'string' && isCanonicalIso(w) ? { kind: 'valid', wakeAt: w }", replace: "typeof w === 'string' && w !== '' ? { kind: 'valid', wakeAt: w }" }] },
  { name: '처리 기록 날짜 검증 약화 — 유한한 시각이면 정본 모양이 아니어도 · 넘친 날짜여도 valid(되돌림 대조 제거)',
    edits: [{ file: F.recovery, find: '  return Number.isFinite(t) && new Date(t).toISOString() === v', replace: '  return Number.isFinite(t)' }] },
  { name: '처리 기록 읽기 실패를 없음으로 읽는다',
    edits: [{ file: F.rec, find: "try { return parseHandledWake(readFileSync(p, 'utf-8')) } catch { return { kind: 'unreadable' } }", replace: "try { return parseHandledWake(readFileSync(p, 'utf-8')) } catch { return { kind: 'missing' } }" }] },
  { name: '고아 복구가 사건 아닌 표식도 깨운다',
    edits: [{ file: F.recovery, find: "  if (i.marker.trigger !== 'event') return skip(", replace: '  if (false) return skip(' }] },
  { name: '고아 복구가 깨움 꺼짐을 무시한다',
    edits: [{ file: F.recovery, find: "  if (!i.enabled) return skip('사건 깨움이 꺼져 있다", replace: "  if (false) return skip('사건 깨움이 꺼져 있다" }] },
  { name: '고아 복구가 처리 표식을 남기지 않는다 — kickstart 실패면 무한 반복',
    edits: [{ file: F.rec, find: '        writeHandledWake(label, marker.at)\n', replace: '' }] },
]

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const files = [...new Set(MUTATIONS.flatMap((m) => m.edits.map((e) => e.file)))]
const ORIGINAL = new Map(files.map((f) => [f, readFileSync(f, 'utf-8')]))
const HASH = new Map([...ORIGINAL].map(([f, s]) => [f, sha(s)]))
const restore = (): void => { for (const [f, s] of ORIGINAL) writeFileSync(f, s) }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => { restore(); process.exit(130) })

const runCheck = (): { failed: boolean; summary: string } => {
  const r = spawnSync(process.execPath, [...process.execArgv, 'scripts/event-wake-check.mts'], { encoding: 'utf-8', timeout: 600_000 })
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const fails = text.split('\n').filter((l) => l.includes('❌')).slice(0, 2).map((l) => l.trim())
  return { failed: r.status !== 0, summary: `exit ${r.status} ${fails.join(' | ')}` }
}

if (!(process.platform === 'darwin' && lockfUsable(LOCKF_PATH))) {
  console.log('⏭️  SKIP — macOS + /usr/bin/lockf 전용 변이 시험이다. PASS 로 세지 않는다')
  process.exit(0)
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
    if (r.failed) { killed += 1; console.log(`  ✅ 잡았다 — ${m.name}\n       ${r.summary}`) } else { survived += 1; console.log(`  ❌ 살아남았다 — ${m.name}\n       ${r.summary}`) }
  }
} finally { restore() }
const ok = survived === 0 && invalid === 0
console.log(`\n${ok ? '✅' : '🔴'} 변이 ${MUTATIONS.length}개 — 잡음 ${killed} · 살아남음 ${survived} · 무효 ${invalid} · 원본 해시 복원 확인`)
process.exit(ok ? 0 : 1)
