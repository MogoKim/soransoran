#!/usr/bin/env node
/**
 * vNext release 진입점 — release writer 하나 (runbook §0.0B.4 · S3-P2).
 *
 *   node scripts/magazine-release.mjs            dry-run — 조립 결과만 낸다(쓰기 · slug 기록 · git · PR 0)
 *   node scripts/magazine-release.mjs --apply    실제 — release worktree 쓰기 · commit · push · PR(draft 모드는 Draft) · auto 모드면 merge gate → merge
 *
 * 🔴 rollout(`magazine-rollout.json`)이 VALID vnext 일 때만 무언가를 한다. 없음 · 손상 · legacy 이면 NOT_VNEXT 로 끝난다(쓰기 0).
 * 🔴 writer 는 하나 — `<상태 루트>/release.lock`. 다른 release 회차가 돌면 기다리지 않고 끝난다.
 * 🔴 결과는 JSON 한 줄(stdout)과 `<상태 루트>/runs/<KST 날짜>/release-<시각>-<pid>.json`.
 *
 * 종료 코드: 정상(할 일 없음 · 후보 없음 · Draft 대기 · merge 완료 · dry-run) 0 · 막힘 1 · 사용법 2
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRollout } from './lib/magazine-rollout.mjs'
import { jobsRootPath, readReleaseCandidates } from './lib/magazine-release-candidates.mjs'
import { acquireReleaseLock, releaseStateRoot } from './lib/magazine-release-journal.mjs'
import { makeReleaseDeps, runRelease } from './lib/magazine-release-run.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 막힘이 아닌 결과 — 정상 대기 · 정상 완료 */
export const OK_OUTCOMES = Object.freeze(['NOT_VNEXT', 'NOTHING_TO_RELEASE', 'NO_RELEASABLE_CANDIDATE', 'DRY_RUN_ASSEMBLED', 'DRY_RUN_OPEN_RELEASE',
  'DRY_RUN_DATE_MISSED', 'DRAFT_RELEASE_OPEN', 'WAITING_FOUNDER_DRAFT', 'MERGED'])

async function main() {
  const argv = process.argv.slice(2)
  const known = new Set(['--apply', '--help'])
  if (argv.some((a) => !known.has(a))) { console.error(`모르는 인자: ${argv.filter((a) => !known.has(a)).join(' ')}`); process.exit(2) }
  if (argv.includes('--help')) { console.log('node scripts/magazine-release.mjs [--apply]'); process.exit(0) }
  const apply = argv.includes('--apply')
  const stateRoot = releaseStateRoot()
  const jobsRoot = jobsRootPath()
  const nowIso = new Date().toISOString()
  // rollout 을 잠금보다 먼저 읽는다 — legacy 이면 상태 폴더도 만들지 않는다
  const rollout = readRollout()
  const deps = makeReleaseDeps({ root: ROOT, stateRoot, jobsRoot, readRollout: () => rollout, readCandidates: () => readReleaseCandidates({ jobsRoot }) })
  let report
  if (!(rollout.code === 'VALID' && rollout.effective.path === 'vnext')) report = await runRelease({ deps, apply })
  else {
    const lock = acquireReleaseLock({ stateRoot, nowIso })
    if (!lock.ok) report = { schemaVersion: 'magazine-release-run/1', mode: apply ? 'apply' : 'dry-run', at: nowIso, outcome: 'RELEASE_LOCK_HELD', blockedBy: [{ code: lock.code, message: lock.why }] }
    else { try { report = await runRelease({ deps, apply }) } finally { lock.release() } }
    try {
      const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
      const dir = join(stateRoot, 'runs', day)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(join(dir, `release-${nowIso.replace(/[:.]/g, '-')}-${process.pid}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    } catch (e) { console.error(`결과 파일을 남기지 못했다 (${e?.code ?? e?.message}) — 판정은 그대로다`) }
  }
  console.log(JSON.stringify(report))
  process.exit(OK_OUTCOMES.includes(report.outcome) ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
