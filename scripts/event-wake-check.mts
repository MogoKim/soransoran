#!/usr/bin/env tsx
/**
 * 사건 깨움(발행 commit → 댓글 러너) 검사 (2026-10-12 Batch C2)
 *
 *   npx tsx scripts/event-wake-check.mts
 *
 * ① 순수 — kill switch(off|comment|all · 미설정 = off) · 행동 범위(C2 는 댓글만) · 고아 표식 복구 판정(표식당 1회)
 * ② 깨움 helper — 임시 HOME · launchctl 대역: off 면 표식 · kickstart 0 · 합치기 · 실패 · 매달림 · 디렉터리 없음 · 던지지 않는다
 * ③ 배선 — 발행 러너가 commit(published) 뒤에만 깨우고 결과가 종료 코드에 들어가지 않는다 · 깨움을 부르는 곳은 발행 러너 하나
 * ④ 실제 OS 프로세스(macOS + /usr/bin/lockf · 그 밖은 SKIP 이고 PASS 가 아니다) — 댓글 러너와 같은 진입(leaseEntry) ·
 *    정기 회차 중 깨움 여러 개 → 본체 최대 1 · follow-up 1 · 고아 표식 → 복구 1회 뒤 반복 0
 *
 * 🔴 DB 0 · provider 0 · 운영 HOME 0 · 운영 launchctl 0(언제나 대역)
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EVENT_WAKE_ENV, FAKE_LAUNCHCTL_MARK, KICKSTART_TIMEOUT_MS, LAUNCHCTL_PATH, WAKE_TARGETS,
  describeWake, eventWakeModeOf, launchctlPath, wakeAllowed, wakeRunner,
} from './lib/runner-wake.mjs'
import { FOLLOW_UP_FILE, LOCKF_PATH, MAX_FOLLOW_UPS, followUpTriggerOf, lockfUsable } from './lib/runner-lease.mjs'
import { COMMENT_RUNNER_LABEL, commentLoopLockDir } from './lib/persona-comment-runner-template'
import { commentLoopLockDir as loopReExport, COMMENT_LOOP_LOCK_FILE } from './lib/persona-comment-loop.mjs'
import { ORPHAN_WAKE_GRACE_MS, judgeOrphanWake, type OrphanWakeInput } from '../src/lib/runner-recovery'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  ❌ ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}
const REPO = process.cwd()
const ROOT = mkdtempSync(join(tmpdir(), 'event-wake-check-'))
const strip = (f: string): string => readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')

try {
  // ─────────────────────────────────────────────────────────
  console.log('\n① 순수 — kill switch · 범위 · 고아 표식')
  // ─────────────────────────────────────────────────────────
  const mode = (v: string | undefined): string => eventWakeModeOf(v === undefined ? {} : { [EVENT_WAKE_ENV]: v }).mode
  check('🔴 kill switch — 미설정 · 빈 값 · off · 모르는 값(ON · true · comments)은 전부 off',
    [undefined, '', '  ', 'off', 'ON', 'true', 'comments', 'Comment'].every((v) => mode(v) === 'off'))
  check('kill switch — comment · all 만 켜진다', mode('comment') === 'comment' && mode('all') === 'all' && mode(' comment ') === 'comment')
  check('🔴 C2 행동 범위 — 댓글만 · 공급 깨움은 all 이어도 없다(C3)',
    wakeAllowed('comment', 'comment') && wakeAllowed('all', 'comment') && !wakeAllowed('off', 'comment')
    && !wakeAllowed('all', 'supply') && !wakeAllowed('comment', 'supply'))
  check('대상 — 댓글 러너 label · 잠금 디렉터리 정본 하나(러너 모듈이 같은 함수를 다시 내보낸다)',
    WAKE_TARGETS.comment.label === COMMENT_RUNNER_LABEL && WAKE_TARGETS.comment.lockDir('/h') === commentLoopLockDir('/h')
    && loopReExport('/h') === commentLoopLockDir('/h') && commentLoopLockDir('/h') === '/h/Library/Application Support/soransoran/persona-comment-loop')

  const now = new Date('2026-10-12T03:00:00.000Z')
  const at = new Date(now.getTime() - ORPHAN_WAKE_GRACE_MS).toISOString()
  const base: OrphanWakeInput = { enabled: true, state: 'loaded', running: false, marker: { trigger: 'event', at }, handledWakeAt: null, now }
  const act = (o: Partial<OrphanWakeInput>): string => judgeOrphanWake({ ...base, ...o }).action
  check('고아 사건 표식(유예 지남 · 처음) → 한 번 깨운다', act({}) === 'kickstart')
  check('🔴 고아 복구 상한 — 같은 표식(같은 시각)을 이미 깨웠으면 다시 깨우지 않는다(kickstart 실패여도)', act({ handledWakeAt: at }) === 'skip')
  check('새 표식(다른 시각)은 그 표식으로 다시 한 번', act({ handledWakeAt: new Date(now.getTime() - 3_600_000).toISOString() }) === 'kickstart')
  check('🔴 깨움 꺼짐 · 표식 없음 · 사건 아닌 표식(scheduled · manual · unknown) → 건드리지 않는다',
    act({ enabled: false }) === 'skip' && act({ marker: null }) === 'skip'
    && ['scheduled', 'manual', 'unknown', null].every((t) => act({ marker: { trigger: t, at } }) === 'skip'))
  check('🔴 표식 시각 모름 · 손상 → 상한을 셀 수 없어 건드리지 않는다', act({ marker: { trigger: 'event', at: null } }) === 'skip'
    && act({ marker: { trigger: 'event', at: 'x' } }) === 'skip')
  check('🔴 unloaded · 상태 모름 · 실행 중 · 유예 안 → 건드리지 않는다',
    act({ state: 'unloaded' }) === 'skip' && act({ state: 'unknown' }) === 'skip' && act({ running: true }) === 'skip'
    && act({ marker: { trigger: 'event', at: new Date(now.getTime() - ORPHAN_WAKE_GRACE_MS + 1).toISOString() } }) === 'skip')

  // ─────────────────────────────────────────────────────────
  console.log('\n② 깨움 helper — 임시 HOME · launchctl 대역')
  // ─────────────────────────────────────────────────────────
  const HOME = join(ROOT, 'home')
  const dir = commentLoopLockDir(HOME)
  const LOG = join(ROOT, 'launchctl.log')
  const fake = (name: string, body: string): string => { const p = join(ROOT, name); writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return p }
  const ok = fake('lctl-ok.sh', `echo "$*" >> '${LOG}'\nexit 0`)
  const bad = fake('lctl-bad.sh', `echo "FAIL $*" >> '${LOG}'\nexit 1`)
  const hang = fake('lctl-hang.sh', `echo "HANG $*" >> '${LOG}'\nexec /bin/sleep 30`)
  const calls = (): string[] => (existsSync(LOG) ? readFileSync(LOG, 'utf-8').split('\n').filter((l) => l !== '') : [])
  const marker = (): string | null => { try { return readFileSync(join(dir, FOLLOW_UP_FILE), 'utf-8') } catch { return null } }
  const g = globalThis as unknown as Record<symbol, unknown>
  const reset = (): void => { rmSync(LOG, { force: true }); rmSync(join(dir, FOLLOW_UP_FILE), { force: true }) }
  const wake = (env: Record<string, string | undefined>, target: 'comment' | 'supply' = 'comment') => wakeRunner({ target, env, nowMs: now.getTime(), home: HOME })
  const KICK = `kickstart gui/${process.getuid?.() ?? 0}/${COMMENT_RUNNER_LABEL}`

  check('🔴 운영 경로 launchctl — 대역 표식이 없으면 언제나 /bin/launchctl', launchctlPath() === LAUNCHCTL_PATH)
  g[FAKE_LAUNCHCTL_MARK] = ok
  mkdirSync(dir, { recursive: true })
  for (const env of [{}, { [EVENT_WAKE_ENV]: 'off' }, { [EVENT_WAKE_ENV]: 'yes' }]) {
    reset()
    const o = wake(env)
    check(`🔴 🔴 반례 kill switch ${JSON.stringify(env)} → OFF · 표식 0 · kickstart 0`, o.kind === 'OFF' && marker() === null && calls().length === 0, JSON.stringify(o))
  }
  reset()
  const sup = wake({ [EVENT_WAKE_ENV]: 'all' }, 'supply')
  check('🔴 all 이어도 공급 깨움은 행동하지 않는다(C3) — 표식 0 · kickstart 0', sup.kind === 'NOT_IMPLEMENTED' && marker() === null && calls().length === 0)
  reset()
  const w1 = wake({ [EVENT_WAKE_ENV]: 'comment' })
  const m1 = marker()
  check('🔴 comment — 표식 REQUESTED(trigger=event · 시각) · kickstart 1회 · 대상 = 댓글 러너 label · -k 없음',
    w1.kind === 'SENT' && w1.marker === 'REQUESTED' && w1.kick === 'OK' && m1 !== null && followUpTriggerOf(m1).trigger === 'event'
    && followUpTriggerOf(m1).at === now.toISOString() && JSON.stringify(calls()) === JSON.stringify([KICK]), JSON.stringify([w1, calls()]))
  const w2 = wake({ [EVENT_WAKE_ENV]: 'all' })
  const w3 = wake({ [EVENT_WAKE_ENV]: 'comment' })
  check('🔴 🔴 반례 깨움 여러 개 — 표식은 하나로 합쳐진다(COALESCED · 첫 표식 그대로) · kickstart 는 launchd 가 하나로 합친다',
    w2.kind === 'SENT' && w2.marker === 'COALESCED' && w3.kind === 'SENT' && w3.marker === 'COALESCED' && marker() === m1 && calls().length === 3)
  reset()
  g[FAKE_LAUNCHCTL_MARK] = bad
  const wf = wake({ [EVENT_WAKE_ENV]: 'comment' })
  check('🔴 🔴 반례 kickstart 실패(exit 1) — 던지지 않는다 · FAILED 로 남기고 표식은 남는다(고아 복구 · 정기 회차가 받는다)',
    wf.kind === 'SENT' && wf.kick === 'FAILED' && marker() !== null && /정기 회차/.test(describeWake('comment', wf)))
  reset()
  g[FAKE_LAUNCHCTL_MARK] = hang
  const t0 = Date.now()
  const wh = wake({ [EVENT_WAKE_ENV]: 'comment' })
  const took = Date.now() - t0
  check('🔴 반례 kickstart 가 매달림 — 시간 상한(5초)에서 끊고 FAILED · 발행 러너를 붙잡지 않는다',
    wh.kind === 'SENT' && wh.kick === 'FAILED' && took >= KICKSTART_TIMEOUT_MS - 200 && took < KICKSTART_TIMEOUT_MS + 3_000, `${took}ms`)
  reset()
  g[FAKE_LAUNCHCTL_MARK] = ok
  rmSync(dir, { recursive: true, force: true })
  const wd = wake({ [EVENT_WAKE_ENV]: 'comment' })
  check('🔴 반례 잠금 디렉터리 없음(러너가 한 번도 돈 적 없다) — 표식 ERROR · 디렉터리를 만들지 않는다 · kickstart 는 보낸다 · 던지지 않는다',
    wd.kind === 'SENT' && wd.marker === 'ERROR' && wd.kick === 'OK' && !existsSync(dir) && calls().length === 1)
  delete g[FAKE_LAUNCHCTL_MARK]

  // ─────────────────────────────────────────────────────────
  console.log('\n③ 배선 — commit 뒤에만 · 결과가 종료 코드에 들어가지 않는다')
  // ─────────────────────────────────────────────────────────
  const pub = strip('scripts/original-post-auto-publish.mts')
  const iWake = pub.indexOf("wakeRunner({ target: 'comment'")
  const iGuard = pub.indexOf("if (res.kind !== 'published') {")
  const iTx = pub.indexOf('res = await publishOriginalPostTx(')
  const iVerify = pub.indexOf('const v = verifyAfterPublish(')
  check('🔴 🔴 깨움은 발행 트랜잭션 결과가 published 로 확인된 뒤에만 — 막힘 · 만료 · 오류 · 무발행 경로는 그 위에서 끝난다',
    iWake > iGuard && iGuard > iTx && iWake < iVerify && (pub.match(/wakeRunner\(/g) ?? []).length === 1)
  check('🔴 깨움 결과가 종료 코드 · 정합 · 감사에 들어가지 않는다(값을 담지 않고 한 줄로만 찍는다)',
    /console\.log\(`   \$\{describeWake\('comment', wakeRunner\(\{ target: 'comment', env: process\.env, nowMs: Date\.now\(\) \}\)\)\}`\)/.test(pub)
    && /process\.exit\(v\.ok && auditIntegrityOk \? 0 : 1\)/.test(pub))
  const users = ['scripts/original-post-auto-publish.mts', 'scripts/runner-recover.mts', 'scripts/persona-comment-loop.mts', 'scripts/supply-process.mts',
    'scripts/micro-seed-navercafe-run.mts', 'scripts/lib/supply-lease.mts']
    .filter((f) => /wakeRunner\(/.test(strip(f)))
  check('🔴 깨움을 부르는 곳은 발행 러너 하나 — 수집 → 공급 깨움 0(C3)', JSON.stringify(users) === JSON.stringify(['scripts/original-post-auto-publish.mts']), users.join(','))
  const rec = strip('scripts/runner-recover.mts')
  check('🔴 고아 복구 — 표식 시각을 kickstart 전에 따로 적는다(슬롯 복구 표식과 섞지 않는다) · -k 없음',
    rec.indexOf('writeHandledWake(label, marker.at)') > 0 && rec.indexOf('writeHandledWake(label, marker.at)') < rec.indexOf("execFileSync('launchctl', ['kickstart', `gui/${process.getuid?.() ?? 0}/${label}`]", rec.indexOf('writeHandledWake(label, marker.at)'))
    && /`\$\{label\}\.wake\.json`/.test(rec) && !/'-k'/.test(rec))
  const hook = readFileSync('scripts/lib/fake-provider-hook.mjs', 'utf-8')
  const wakeSrc = readFileSync('scripts/lib/runner-wake.mts', 'utf-8')
  check('🔴 launchctl 대역 표식은 가짜 provider 훅만 건다 · runner-wake 는 env 를 보지 않는다',
    /globalThis\[Symbol\.for\('soransoran\.test\.fake-launchctl'\)\] = process\.env\.FAKE_LAUNCHCTL/.test(hook) && !/FAKE_LAUNCHCTL\b(?!_MARK)/.test(wakeSrc.replace(/`FAKE_LAUNCHCTL`/g, '')))

  // ─────────────────────────────────────────────────────────
  console.log('\n④ 실제 OS 프로세스 — 댓글 러너와 같은 진입(leaseEntry) · 정기 회차와 공존 · 고아 복구')
  // ─────────────────────────────────────────────────────────
  const REAL = process.platform === 'darwin' && lockfUsable(LOCKF_PATH)
  const CASES = ['정기 회차 중 깨움 5개 → 본체 최대 1 · follow-up 1(trigger=event)', '정기 회차가 없을 때 깨움 → 시작 회차가 표식을 받는다 · pass 1 없음', '고아 표식 → 복구 1회 · 같은 표식 반복 0']
  if (!REAL) { for (const c of CASES) console.log(`  ⏭️  SKIP(macOS + /usr/bin/lockf 전용 · PASS 로 세지 않는다) ${c}`) } else {
    const H2 = join(ROOT, 'home2')
    const LD = commentLoopLockDir(H2)
    mkdirSync(LD, { recursive: true })
    const PLOG = join(ROOT, 'passes.log')
    const HARNESS = join(ROOT, 'harness.mts')
    /** 🔴 댓글 러너 진입과 같은 함수 · 같은 잠금 파일 · 같은 디렉터리 — 본체만 시작 · 끝을 적고 잔다 */
    writeFileSync(HARNESS, [
      "import { appendFileSync } from 'node:fs'",
      "import { fileURLToPath } from 'node:url'",
      `import { leaseEntry } from ${JSON.stringify(join(REPO, 'scripts/lib/runner-lease.mjs'))}`,
      `import { COMMENT_LOOP_LOCK_FILE, commentLoopLockDir } from ${JSON.stringify(join(REPO, 'scripts/lib/persona-comment-loop.mjs'))}`,
      'const [log, holdMs] = process.argv.slice(2)',
      'const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))',
      "const code = await leaseEntry({ lockDir: commentLoopLockDir(), lockFile: COMMENT_LOOP_LOCK_FILE, scriptPath: fileURLToPath(import.meta.url),",
      "  argv: process.argv.slice(2), env: process.env, trigger: 'scheduled', log: () => undefined,",
      '  pass: async (pass, _proof, ctx) => {',
      "    appendFileSync(log!, JSON.stringify({ kind: 'start', pass, trigger: ctx.trigger, absorbed: ctx.absorbed, at: Date.now() }) + '\\n')",
      '    await sleep(Number(holdMs))',
      "    appendFileSync(log!, JSON.stringify({ kind: 'end', pass, at: Date.now() }) + '\\n')",
      '    return 0',
      '  } })',
      'process.exit(code)',
    ].join('\n'))
    type L = { kind: string; pass: number; trigger?: string; absorbed?: string | null; at: number }
    const lines = (): L[] => (existsSync(PLOG) ? readFileSync(PLOG, 'utf-8') : '').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as L)
    const starts = (): L[] => lines().filter((l) => l.kind === 'start')
    const maxConc = (): number => { let c = 0; let m = 0; for (const e of lines().sort((a, b) => a.at - b.at || (a.kind === 'end' ? -1 : 1))) { c += e.kind === 'start' ? 1 : -1; m = Math.max(m, c) } return m }
    const run = (hold: number) => spawn(process.execPath, [...process.execArgv, HARNESS, PLOG, String(hold)], { env: { PATH: process.env.PATH ?? '', HOME: H2 }, stdio: 'ignore' })
    const exitOf = (c: ReturnType<typeof spawn>): Promise<number | null> => new Promise((r) => { if (c.exitCode !== null) r(c.exitCode); else c.on('exit', (x) => r(x)) })
    const waitFor = async (p: () => boolean, ms = 20_000): Promise<boolean> => { const u = Date.now() + ms; while (Date.now() < u) { if (p()) return true; await new Promise((r) => setTimeout(r, 50)) } return p() }
    g[FAKE_LAUNCHCTL_MARK] = ok
    const wake2 = (): ReturnType<typeof wakeRunner> => wakeRunner({ target: 'comment', env: { [EVENT_WAKE_ENV]: 'comment' }, nowMs: Date.now(), home: H2 })

    // 정기 회차 도는 중 깨움 5개 — launchd 는 도는 job 을 다시 띄우지 않는다(kickstart no-op) → 본체가 표식을 거둔다
    writeFileSync(PLOG, '')
    const holder = run(3_000)
    const hExit = exitOf(holder)
    await waitFor(() => starts().length === 1)
    const ws = [wake2(), wake2(), wake2(), wake2(), wake2()]
    // 🔴 launchd 대신 그 순간 겹쳐 뜬 정기 회차 하나도 흉내낸다(같은 진입 · 잠금을 못 얻으면 표식만 합친다)
    const overlap = await exitOf(run(0))
    await hExit
    const ps = starts()
    check('🔴 🔴 반례 정기 회차 중 깨움 5개 + 겹친 정기 실행 → 본체 동시 최대 1 · 회차 pass 0 · 1 만(follow-up 상한 1)',
      ws.every((w) => w.kind === 'SENT') && overlap === 0 && maxConc() === 1 && ps.length === 2 && ps.map((p) => p.pass).join(',') === '0,1' && MAX_FOLLOW_UPS === 1,
      JSON.stringify(ps))
    check('🔴 follow-up 회차는 사건 깨움으로 기록된다(trigger=event · 거둔 표식 event) · 표식은 거둬졌다',
      ps[1]?.trigger === 'event' && ps[1]?.absorbed === 'event' && !existsSync(join(LD, FOLLOW_UP_FILE)), JSON.stringify(ps[1]))

    // 러너가 쉬는 동안 깨움 → kickstart 가 띄운 회차가 시작할 때 표식을 받는다
    writeFileSync(PLOG, '')
    wake2()
    await exitOf(run(200))
    const p2 = starts()
    check('🔴 쉬는 중 깨움 → 그 회차의 pass 0 이 표식을 받는다(정기 라벨이어도 거둔 표식 event 기록) · 불필요한 pass 1 없음',
      p2.length === 1 && p2[0]?.absorbed === 'event' && !existsSync(join(LD, FOLLOW_UP_FILE)), JSON.stringify(p2))

    // 고아 표식 — kickstart 실패로 아무도 안 거둔 표식 → 복구 판정 1회 · 같은 표식 반복 0
    wake2()
    const raw = readFileSync(join(LD, FOLLOW_UP_FILE), 'utf-8')
    const mk = followUpTriggerOf(raw)
    const later = new Date(Date.parse(mk.at!) + ORPHAN_WAKE_GRACE_MS + 1)
    const first = judgeOrphanWake({ enabled: true, state: 'loaded', running: false, marker: mk, handledWakeAt: null, now: later })
    const again = judgeOrphanWake({ enabled: true, state: 'loaded', running: false, marker: mk, handledWakeAt: mk.at, now: new Date(later.getTime() + 3_600_000) })
    check('🔴 🔴 반례 고아 표식 — 복구는 1회 · 그 표식으로 다시 깨우지 않는다(무한 반복 0)', first.action === 'kickstart' && again.action === 'skip')
    writeFileSync(PLOG, '')
    await exitOf(run(100))
    check('복구가 띄운 회차가 고아 표식을 거둔다', starts()[0]?.absorbed === 'event' && !existsSync(join(LD, FOLLOW_UP_FILE)))
    check('잠금 파일 이름 = 댓글 러너 정본', COMMENT_LOOP_LOCK_FILE === 'loop.kernel-lock' && existsSync(join(LD, COMMENT_LOOP_LOCK_FILE)))
    delete g[FAKE_LAUNCHCTL_MARK]
  }
} finally {
  delete (globalThis as unknown as Record<symbol, unknown>)[FAKE_LAUNCHCTL_MARK]
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} 사건 깨움 검사 ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · provider 0 · 운영 HOME 0 · 운영 launchctl 0\n')
process.exit(fail === 0 ? 0 : 1)
