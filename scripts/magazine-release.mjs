#!/usr/bin/env node
/**
 * vNext release 진입점 — release writer 하나 (runbook §0.0B.4 · S3-P2).
 *
 *   node scripts/magazine-release.mjs            dry-run — 조립 결과만 낸다(쓰기 · slug 기록 · git · PR 0)
 *   node scripts/magazine-release.mjs --apply    실제 — release worktree 쓰기 · commit · push · PR(draft 모드는 Draft) · auto 모드면 merge gate → merge
 *   node scripts/magazine-release.mjs --recover  02:00 복구 — **이미 열린 release PR 만** 같은 journal · 같은 merge gate 로 이어받는다.
 *                                                후보 판독 · 조립 · 새 PR · PR 닫기 0. merge 뒤 마무리(main 확인 · 서빙 관측)는 한다
 *
 * 🔴 rollout(`magazine-rollout.json`)이 VALID vnext 일 때만 무언가를 한다. 없음 · 손상 · legacy 이면 NOT_VNEXT 로 끝난다(쓰기 0).
 * 🔴 writer 는 하나 — `<상태 루트>/release.lock`. 다른 release 회차가 돌면 기다리지 않고 끝난다.
 * 🔴 결과는 JSON 한 줄(stdout)과 `<상태 루트>/runs/<KST 날짜>/release-<시각>-<pid>.json`.
 *
 * 종료 코드: 정상(할 일 없음 · 후보 없음 · Draft 대기 · merge 완료 · dry-run) 0 · 막힘 1 · 사용법 2
 *   MERGED_SERVED 는 merge + 그 SHA 서빙 확인, MERGED_SERVING_PENDING 은 merge 는 끝났고 서빙은 아직 못 본 상태다(둘 다 0 — 다음 회차가 서빙을 다시 본다).
 *   닫지 못함(RELEASE_CLOSE_FAILED) · 재개 결속 보류(RESUME_HOLD) · 복구 보류(RECOVER_DEFERRED) · 서빙 미해결(MERGED_SERVING_UNRESOLVED)은 1 이다.
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
  'DRY_RUN_DATE_MISSED', 'DRAFT_RELEASE_OPEN', 'WAITING_FOUNDER_DRAFT', 'MERGED_SERVED', 'MERGED_SERVING_PENDING', 'RECOVER_NOTHING_OPEN'])

async function main() {
  const argv = process.argv.slice(2)
  const known = new Set(['--apply', '--recover', '--help'])
  if (argv.some((a) => !known.has(a))) { console.error(`모르는 인자: ${argv.filter((a) => !known.has(a)).join(' ')}`); process.exit(2) }
  if (argv.includes('--help')) { console.log('node scripts/magazine-release.mjs [--apply | --recover]'); process.exit(0) }
  const recover = argv.includes('--recover')
  if (recover && argv.includes('--apply')) { console.error('--recover 와 --apply 는 함께 쓰지 않는다'); process.exit(2) }
  const apply = recover || argv.includes('--apply')
  const stateRoot = releaseStateRoot()
  const jobsRoot = jobsRootPath()
  const nowIso = new Date().toISOString()
  // rollout 을 잠금보다 먼저 읽는다 — legacy 이면 상태 폴더도 만들지 않는다
  const rollout = readRollout()
  const deps = makeReleaseDeps({ root: ROOT, stateRoot, jobsRoot, readRollout: () => rollout, readCandidates: () => readReleaseCandidates({ jobsRoot }) })
  let report
  if (!(rollout.code === 'VALID' && rollout.effective.path === 'vnext')) report = await runRelease({ deps, apply, recover })
  else {
    const lock = acquireReleaseLock({ stateRoot, nowIso })
    // 🔴 01:00 회차와 02:00 복구는 같은 잠금을 쓴다 — 같은 PR 을 동시에 다루지 않는다(기다리지 않고 끝난다)
    if (!lock.ok) report = { schemaVersion: 'magazine-release-run/1', mode: recover ? 'recover' : apply ? 'apply' : 'dry-run', at: nowIso, outcome: 'RELEASE_LOCK_HELD', blockedBy: [{ code: lock.code, message: lock.why }] }
    else { try { report = await runRelease({ deps, apply, recover }) } finally { lock.release() } }
    try {
      const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
      const dir = join(stateRoot, 'runs', day)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(join(dir, `${recover ? 'release-recover' : 'release'}-${nowIso.replace(/[:.]/g, '-')}-${process.pid}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    } catch (e) { console.error(`결과 파일을 남기지 못했다 (${e?.code ?? e?.message}) — 판정은 그대로다`) }
  }
  console.log(JSON.stringify(report))
  process.exit(OK_OUTCOMES.includes(report.outcome) ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
