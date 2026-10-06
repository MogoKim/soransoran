#!/usr/bin/env node
/**
 * G8 편입기 CLI — 연구 정본의 AUTO_READY 의도를 topic queue 후보로 만든다.
 *
 * 🔴 **기본은 dry-run 이다.** 아무 파일도 쓰지 않는다.
 *    쓰기는 `--apply` 하나뿐이고, 큐 루트·그래프 루트·manifest 해시를 전부 명시해야 돈다.
 *    운영 runtime checkout(`soransoran-magazine-runtime`)에는 쓰지 않는다 — 헌장 §8.
 *
 * 사용
 *   node scripts/magazine-g8-promote.mjs [--research <dir>] [--repo <dir>] [--asof YYYY-MM-DD] [--json] [--out <file>]
 *   node scripts/magazine-g8-promote.mjs --apply --manifest <file> --confirm-hash <hash> --queue-root <dir> --graph-root <dir>
 *   node scripts/magazine-g8-promote.mjs --verify --queue-root <dir> --graph-root <dir>
 *
 * 종료 코드: 0 정상 · 1 판정/쓰기 실패 · 2 사용법 오류
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib/magazine-load.mjs'
import {
  loadInputs, buildManifest, applyManifest, readManifestFile, verifyConsistency,
  PRODUCT_FILES, GRAPH_STATE_FILES, CLASSES,
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
/** 오늘 KST 날짜 — `--asof` 가 없을 때만 */
const todayKst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)

/** 🔴 운영 runtime 은 읽기 전용이다. 실제 경로로 풀어서 본다 */
function refuseRuntime(dir, label) {
  const real = fs.realpathSync(dir)
  if (/(^|\/)soransoran-magazine-runtime(\/|$)/.test(real)) usage(`${label} 가 운영 runtime 이다 — 쓰지 않는다 (${real})`)
  return real
}

function runVerify() {
  const queueRoot = opt('--queue-root')
  const graphRoot = opt('--graph-root')
  if (!queueRoot || !graphRoot) usage('--verify 는 --queue-root 와 --graph-root 가 필요하다')
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null)
  const r = verifyConsistency({
    queueSource: read(path.join(queueRoot, PRODUCT_FILES.queue)),
    articlesSource: read(path.join(queueRoot, PRODUCT_FILES.articles)),
    ledgerSource: read(path.join(graphRoot, GRAPH_STATE_FILES.ledger)),
    slugManifestSource: read(path.join(graphRoot, GRAPH_STATE_FILES.slugManifest)),
  })
  console.log(r.ok ? '✅ 큐와 그래프 장부가 같은 manifest 를 가리킨다' : `🔴 어긋남 ${r.problems.length}건`)
  for (const p of r.problems) console.log(`  ${p}`)
  return r.ok ? 0 : 1
}

function runApply() {
  const file = opt('--manifest')
  const confirm = opt('--confirm-hash')
  const queueRoot = opt('--queue-root')
  const graphRoot = opt('--graph-root')
  if (!file || !confirm || !queueRoot || !graphRoot) {
    usage('--apply 는 --manifest · --confirm-hash · --queue-root · --graph-root 가 모두 필요하다 (기본값 없음)')
  }
  const { manifest, valid } = readManifestFile(file)
  if (!valid) usage('manifest 해시가 본문과 맞지 않는다')
  if (manifest.hash !== confirm) usage(`--confirm-hash 가 manifest 해시와 다르다 (${manifest.hash})`)
  const r = applyManifest({ manifest, queueRoot: refuseRuntime(queueRoot, '--queue-root'), graphRoot: refuseRuntime(graphRoot, '--graph-root') })
  console.log(JSON.stringify(r, null, 2))
  return r.ok ? 0 : 1
}

async function runDryRun() {
  const researchDir = opt('--research') ?? path.resolve(ROOT, '..', 'soransoran-mgraph-research')
  const repoDir = opt('--repo') ?? ROOT
  const asOf = opt('--asof') ?? todayKst()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) usage(`--asof 형식이 YYYY-MM-DD 가 아니다: ${asOf}`)

  let manifest
  try {
    manifest = buildManifest(await loadInputs({ researchDir, repoDir }), { asOf })
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

function report(manifest, out) {
  const c = manifest.counts
  console.log(`\nG8 편입기 dry-run — 🔴 아무것도 쓰지 않았다${out ? ` (manifest 보고서만 ${out})` : ''}`)
  console.log(`  asOf ${manifest.asOf} · 그래프 ${manifest.graph.graphVersion} · manifest ${manifest.hash.slice(0, 16)}`)
  console.log(`  의도 ${c.intents} (AUTO_READY ${c.autoReadyTopic}) · 등록 글 ${c.articles} · 큐 ${c.queue}\n`)
  for (const k of CLASSES) console.log(`  ${k.padEnd(28)} ${String(c[k]).padStart(4)}`)

  const incomplete = {}
  for (const r of manifest.classification.filter((x) => x.class === 'INCOMPLETE')) {
    for (const why of r.reasons) { const key = why.split(' — ')[0]; incomplete[key] = (incomplete[key] ?? 0) + 1 }
  }
  if (Object.keys(incomplete).length) {
    console.log('\n  INCOMPLETE 사유 (한 의도에 여러 개일 수 있다)')
    for (const [k, n] of Object.entries(incomplete).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(26)} ${n}`)
  }

  const show = (label, list, rows) => {
    console.log(`\n  ${label} ${list.length}건`)
    list.forEach((s, i) => {
      const row = rows[i]
      console.log(`    ${s.intentId} · ${row.slug} · ${row.title}`)
      console.log(`      ${row.cluster} · ${row.riskLevel}/${row.validationProfile} · CTA ${row.ctaBoard} · 점수 ${s.score.total} (증거 ${s.score.evidence} · 공백 ${s.score.clusterGap} · 연결 ${s.score.connection} · 커뮤니티 ${s.score.community})`)
      console.log(`      관계 ${s.evidence.relations.join(' ') || '없음'} · 링크 ${row.internalLinks.join(',') || '없음'}`)
    })
  }
  show('primary', manifest.selection.primary, manifest.queueRows)
  show('fallback', manifest.selection.fallback, manifest.fallbackRows)
  if (manifest.selection.excluded.length) {
    console.log(`\n  이번 구간 제외 ${manifest.selection.excluded.length}건`)
    for (const x of manifest.selection.excluded) console.log(`    ${x.intentId} — ${x.reason}`)
  }
  console.log(`\n  그래프 미매핑 글 ${manifest.drift.length}건 (재작성하지 않는다 — 보고만)`)
  for (const d of manifest.drift) console.log(`    ${d.slug} · ${d.state} ${d.publishAt} · ${d.kind}${d.researchIntents.length ? ` · ${d.researchIntents.join(',')}` : ''}`)
  console.log('')
}

// 🔴 process.exit 를 부르지 않는다 — 파이프로 나가는 큰 JSON 이 잘린다
process.exitCode = flag('--verify') ? runVerify() : flag('--apply') ? runApply() : await runDryRun()
