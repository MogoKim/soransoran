#!/usr/bin/env node
/**
 * Magazine rollout switch — 단일 owner CLI (runbook §0.0B.5).
 *
 *   node scripts/magazine-rollout.mjs                    상태만 본다 (쓰기 0)
 *   node scripts/magazine-rollout.mjs status             같음
 *   node scripts/magazine-rollout.mjs set --path legacy|vnext --release draft|auto --target-candidates <N> --changed-by <누구>
 *                                                         계획만 보여 준다 (쓰기 0)
 *   ... set ... --write                                   🔴 실제로 쓴다
 *
 * 🔴 기본은 dry-run 이다. `--write` 가 있어야 쓴다. `--help` · 사용법 오류는 쓰기 0.
 * 🔴 경로는 HOME 아래 정본 하나다 — 다른 경로를 받는 옵션이 없다.
 * 🔴 previous 는 사람이 쓰지 않는다. 디스크의 직전 실효값에서 계산한다.
 * 🔴 별도 장부·DB·append-only log 를 만들지 않는다 — 변경 기록은 파일의 changedBy · changedAt · previous 뿐이다.
 *
 * 종료 코드: 0 성공(dry-run · NO_CHANGE 포함) · 1 거부(LOCK_BUSY · WRITE_FAILED 등) · 2 사용법 오류
 */
import { RolloutWriteError, readRollout, rolloutPath, writeRollout } from './lib/magazine-rollout.mjs'

const argv = process.argv.slice(2)
const out = (v, code) => { process.stdout.write(`${JSON.stringify(v, null, 2)}\n`); process.exit(code) }
const usage = (why) => { process.stderr.write(`사용법 오류 — ${why}\n`); process.exit(2) }

/**
 * 🔴 시험 전용 — 잠금을 쥔 채 기다린다(두 writer 동시 실행 반례). `SORAN_MAGAZINE_TEST_MODE=1` 일 때만 받는다.
 *    운영에서 이 값이 보이면 아무것도 하지 않고 사용법 오류로 멈춘다.
 */
const HOLD_ENV = 'SORAN_MAGAZINE_ROLLOUT_TEST_HOLD_MS'
const holdMs = process.env[HOLD_ENV]
if (holdMs !== undefined && process.env.SORAN_MAGAZINE_TEST_MODE !== '1') usage(`${HOLD_ENV} 는 SORAN_MAGAZINE_TEST_MODE=1 일 때만 쓴다`)
const holdInLock = holdMs ? () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs)) : null

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write('magazine rollout — status | set --path legacy|vnext --release draft|auto --target-candidates N --changed-by NAME [--write]\n기본은 dry-run · --write 가 있어야 쓴다\n')
  process.exit(0)
}

const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'status'
const KNOWN = new Set(['--path', '--release', '--target-candidates', '--changed-by', '--write'])
for (let i = cmd === argv[0] ? 1 : 0; i < argv.length; i++) {
  const a = argv[i]
  if (!KNOWN.has(a)) usage(`모르는 인자 ${a}`)
  if (a !== '--write') i++
}
const arg = (n) => {
  const i = argv.indexOf(n)
  if (i === -1) return null
  const v = argv[i + 1]
  if (v === undefined || v.startsWith('--')) usage(`${n} 에 값이 없다`)
  return v
}

if (cmd === 'status') {
  if (argv.length > (argv[0] === 'status' ? 1 : 0)) usage('status 는 인자를 받지 않는다')
  const r = readRollout({ path: rolloutPath() })
  out({ ok: true, code: r.code, effective: r.effective, config: r.config, why: r.why, path: r.path }, 0)
}

if (cmd !== 'set') usage(`모르는 명령 ${cmd}`)
const path = arg('--path')
const release = arg('--release')
const target = arg('--target-candidates')
const changedBy = arg('--changed-by')
if (!path || !release || !target || !changedBy) usage('--path · --release · --target-candidates · --changed-by 가 모두 필요하다')
if (!/^[1-9]\d*$/.test(target)) usage('--target-candidates 는 1 이상의 정수다')

try {
  const r = writeRollout({ next: { path, release, targetCandidates: Number(target) }, changedBy, write: argv.includes('--write'), holdInLock })
  out(r, 0)
} catch (e) {
  if (e instanceof RolloutWriteError) {
    if (e.code === 'INVALID_REQUEST') usage(e.why)
    out({ ok: false, code: e.code, why: e.why }, 1)
  }
  throw e
}
