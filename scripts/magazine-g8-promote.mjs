#!/usr/bin/env node
/**
 * G8 편입기 CLI — builder 가 판정한 GRAPH_READY intent 에 영구 slug 와 admission 신원을 부여한다.
 *
 * 🔴 **기본은 dry-run 이다.** 아무 파일도 쓰지 않는다. 시각 · 입력 루트에 기본값이나 벽시계 대체가 없다.
 * 🔴 **apply 가 쓰는 것은 연구 쪽 세 파일뿐이다** — receipt(contract/g8-admission/<hash>.json) ·
 *    m3-slug-manifest.json · m3-state.jsonl. 제품 파일 · topic queue · graph bundle 은 쓰지 않는다.
 *    운영 runtime checkout(`soransoran-magazine-runtime`)에는 쓰지 않는다 — 헌장 §8.
 *
 * 사용
 *   node scripts/magazine-g8-promote.mjs --snapshot <dir> --research <dir> --at <KST> --graph-effective-at <KST> [--repo <dir>] [--json] [--out <file>]
 *   node scripts/magazine-g8-promote.mjs --apply --manifest <file> --confirm-hash <hash> --snapshot <dir> --research <dir> --repo <dir>
 *        --approved-by <사람> --approved-at <KST> --committed-at <KST>
 *   node scripts/magazine-g8-promote.mjs --verify --research <dir> --repo <dir>
 *   node scripts/magazine-g8-promote.mjs --recover-stale-lock --research <dir> --repo <dir> --lock-sha256 <sha256> --operator <사람>
 *
 * 종료 코드: 0 정상 · 1 판정/쓰기 실패 · 2 사용법 오류
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib/magazine-load.mjs'
import {
  applyAdmissions, buildManifest, readManifestFile, recoverStaleLock, testPauseHook, verifyAdmissionState,
} from './lib/magazine-g8-promoter.mjs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name) => {
  const i = argv.indexOf(name)
  if (i === -1) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) usage(`${name} 에 값이 없다`)
  return v
}
function usage(why) {
  console.error(`\n  ⛔ ${why}\n`)
  process.exit(2)
}
const need = (name, why) => opt(name) ?? usage(`${name} 가 필요하다 — ${why} (기본값 없음)`)
if (flag('--asof')) usage('--asof 는 없앴다 — 날짜를 하루 끝으로 해석하지 않는다. --at YYYY-MM-DDTHH:MM:SS+09:00 을 쓴다')
for (const old of ['--queue-root', '--admission-root', '--graph-root']) {
  if (flag(old)) usage(`${old} 는 없앴다 — G8 은 큐를 쓰지 않는다. 연구 루트는 --research, 제품 루트는 --repo 다`)
}

/** 🔴 운영 runtime 은 읽기 전용이다. 실제 경로로 풀어서 본다 */
function refuseRuntime(dir, label) {
  const real = fs.realpathSync(dir)
  if (/(^|\/)soransoran-magazine-runtime(\/|$)/.test(real)) usage(`${label} 가 운영 runtime 이다 — 쓰지 않는다 (${real})`)
  return real
}
const roots = () => ({
  researchDir: refuseRuntime(need('--research', '연구 루트(편입 장부)'), '--research'),
  repoDir: refuseRuntime(opt('--repo') ?? ROOT, '--repo'),
})

function runVerify() {
  const r = verifyAdmissionState(roots())
  console.log(r.ok ? `✅ receipt · slug binding · ledger 일치 (CURRENT ${r.classes.CURRENT} · KNOWN_LEGACY ${r.classes.KNOWN_LEGACY})` : `🔴 어긋남 ${r.problems.length}건`)
  for (const p of r.problems) console.log(`  ${p}`)
  return r.ok ? 0 : 1
}

async function runApply() {
  const file = need('--manifest', 'dry-run 이 만든 manifest')
  const confirm = need('--confirm-hash', '사람이 확인한 manifest 해시')
  let faultHook
  try { faultHook = testPauseHook() } catch (e) { usage(e.message) }
  const { manifest, valid } = readManifestFile(file)
  if (!valid) usage('manifest 해시가 본문과 맞지 않는다')
  if (manifest.hash !== confirm) usage(`--confirm-hash 가 manifest 해시와 다르다 (${manifest.hash})`)
  const r = await applyAdmissions({
    manifest, ...roots(), snapshotDir: need('--snapshot', 'manifest 의 snapshot'),
    approval: { approvedBy: need('--approved-by', '승인한 사람'), approvedAt: need('--approved-at', '승인 시각'), confirmManifestHash: confirm },
    committedAt: need('--committed-at', '기록 시각'), faultHook,
  })
  console.log(JSON.stringify(r, null, 2))
  return r.ok ? 0 : 1
}

async function runRecoverStaleLock() {
  const r = await recoverStaleLock({ ...roots(), expectLockSha256: need('--lock-sha256', '사람이 확인한 잠금 파일 sha256'), operator: need('--operator', '확인한 사람') })
  console.log(JSON.stringify(r, null, 2))
  return r.ok ? 0 : 1
}

async function runDryRun() {
  const { researchDir, repoDir } = roots()
  let manifest
  try {
    manifest = await buildManifest({ repoDir, researchDir, snapshotDir: need('--snapshot', 'reconciled snapshot'),
      at: need('--at', '판정 시각'), graphEffectiveAt: need('--graph-effective-at', '제품 graph 의 build 기준 시각') })
  } catch (e) {
    console.error(`\n  🔴 ${e.message}\n`)
    return 1
  }
  const out = opt('--out')
  if (out) {
    // 🔴 manifest 는 보고서다. 저장소 안(운영 파일 옆)에 떨어뜨리지 않는다
    const abs = path.resolve(out)
    if (abs.startsWith(`${fs.realpathSync(ROOT)}/`) || abs.startsWith(`${path.resolve(repoDir)}/`)) usage('--out 은 저장소 밖 경로만 받는다')
    fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  if (flag('--json')) console.log(JSON.stringify(manifest, null, 2))
  else report(manifest, out)
  return 0
}

function report(m, out) {
  console.log(`\nG8 편입기 dry-run — 🔴 아무것도 쓰지 않았다${out ? ` (manifest 보고서만 ${out})` : ''}`)
  console.log(`  판정 시각 ${m.at} · graph ${m.graph.graphVersion}(build 기준 ${m.graphEffectiveAt}) · manifest ${m.hash}`)
  console.log(`  snapshot ${m.snapshot.name} · readinessHash ${m.readiness.readinessHash.slice(0, 16)} · 신원 입력 ${Object.keys(m.identityInputHashes).length}개`)
  console.log('  🔴 apply 는 연구 receipt · slug 표 · 장부만 쓴다 — 큐 행은 ArticlePlan 승인 뒤의 별도 단계다\n')
  console.log(`  admission 후보 ${m.admissions.length}건`)
  for (const a of m.admissions) {
    console.log(`    ${a.intentId} · ${a.slug} · ${a.primaryQuery} (${a.cluster})`)
    console.log(`      direct ${a.direct.map((x) => `${x.edgeId}→${x.targetSlug}`).join(' ')} · discovery ${a.discovery ? `${a.discovery.edgeId}→${a.discovery.targetSlug}` : '없음'} · reverse ${a.reverse.join(',') || '없음'}`)
  }
  if (m.refused.length) {
    console.log(`\n  GRAPH_READY 이지만 신원 검사에서 빠진 것 ${m.refused.length}건`)
    for (const r of m.refused) console.log(`    ${r.intentId} · ${r.slug ?? '-'} — ${r.why.join(' · ')}`)
  }
  console.log('')
}

// 🔴 process.exit 를 부르지 않는다 — 파이프로 나가는 큰 JSON 이 잘린다
process.exitCode = flag('--verify') ? runVerify()
  : flag('--recover-stale-lock') ? await runRecoverStaleLock()
    : flag('--apply') ? await runApply() : await runDryRun()
