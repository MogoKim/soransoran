#!/usr/bin/env node
/**
 * G8 편입기 CLI — 연구 정본의 AUTO_READY 의도를 topic queue 후보로 만든다.
 *
 * 🔴 **기본은 dry-run 이다.** 아무 파일도 쓰지 않는다.
 *    쓰기는 `--apply` 하나뿐이고, 큐 루트·편입 장부 루트·manifest 해시를 전부 명시해야 돈다.
 *    운영 runtime checkout(`soransoran-magazine-runtime`)에는 쓰지 않는다 — 헌장 §8.
 *
 * 🔴 **apply 가 쓰는 것은 topic queue 와 편입 장부(연구 m3-state.jsonl · m3-slug-manifest.json)뿐이다.**
 *    제품 graph bundle(src/content/magazine/graph)은 갱신하지 않는다 — 그래프 재빌드·export·배포는 별도 단계다.
 *
 * 사용
 *   node scripts/magazine-g8-promote.mjs [--research <dir>] [--repo <dir>] [--at YYYY-MM-DDTHH:MM:SS+09:00] [--json] [--out <file>]
 *   node scripts/magazine-g8-promote.mjs --apply --manifest <file> --confirm-hash <hash> --queue-root <dir> --admission-root <dir>
 *   node scripts/magazine-g8-promote.mjs --verify --queue-root <dir> --admission-root <dir>
 *
 * 종료 코드: 0 정상 · 1 판정/쓰기 실패 · 2 사용법 오류
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './lib/magazine-load.mjs'
import {
  loadInputs, buildManifest, applyManifest, readManifestFile, verifyConsistency, parseAt, testPauseHook,
  PRODUCT_FILES, ADMISSION_FILES, JOURNAL_FILE, CLASSES,
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
/** 지금 KST 시각 — `--at` 이 없을 때만. 초 단위로 자른다 */
const nowKst = () => `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19)}+09:00`
if (flag('--asof')) usage('--asof 는 없앴다 — 날짜를 하루 끝으로 해석하지 않는다. --at YYYY-MM-DDTHH:MM:SS+09:00 을 쓴다')
if (flag('--graph-root')) usage('--graph-root 는 --admission-root 로 바뀌었다 — 제품 graph bundle 이 아니라 편입 장부 루트다')

/** 🔴 운영 runtime 은 읽기 전용이다. 실제 경로로 풀어서 본다 */
function refuseRuntime(dir, label) {
  const real = fs.realpathSync(dir)
  if (/(^|\/)soransoran-magazine-runtime(\/|$)/.test(real)) usage(`${label} 가 운영 runtime 이다 — 쓰지 않는다 (${real})`)
  return real
}

function runVerify() {
  const queueRoot = opt('--queue-root')
  const admissionRoot = opt('--admission-root')
  if (!queueRoot || !admissionRoot) usage('--verify 는 --queue-root 와 --admission-root 가 필요하다')
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null)
  const r = verifyConsistency({
    queueSource: read(path.join(queueRoot, PRODUCT_FILES.queue)),
    articlesSource: read(path.join(queueRoot, PRODUCT_FILES.articles)),
    ledgerSource: read(path.join(admissionRoot, ADMISSION_FILES.ledger)),
    slugManifestSource: read(path.join(admissionRoot, ADMISSION_FILES.slugManifest)),
    journalPresent: fs.existsSync(path.join(admissionRoot, JOURNAL_FILE)),
  })
  console.log(r.ok ? '✅ 큐와 편입 장부가 같은 편입을 가리킨다 (제품 graph bundle 은 대조 대상이 아니다)' : `🔴 어긋남 ${r.problems.length}건`)
  for (const p of r.problems) console.log(`  ${p}`)
  return r.ok ? 0 : 1
}

async function runApply() {
  const file = opt('--manifest')
  const confirm = opt('--confirm-hash')
  const queueRoot = opt('--queue-root')
  const admissionRoot = opt('--admission-root')
  if (!file || !confirm || !queueRoot || !admissionRoot) {
    usage('--apply 는 --manifest · --confirm-hash · --queue-root · --admission-root 가 모두 필요하다 (기본값 없음)')
  }
  let faultHook
  try { faultHook = testPauseHook() } catch (e) { usage(e.message) }
  const { manifest, valid } = readManifestFile(file)
  if (!valid) usage('manifest 해시가 본문과 맞지 않는다')
  if (manifest.hash !== confirm) usage(`--confirm-hash 가 manifest 해시와 다르다 (${manifest.hash})`)
  const r = await applyManifest({ manifest, faultHook,
    queueRoot: refuseRuntime(queueRoot, '--queue-root'), admissionRoot: refuseRuntime(admissionRoot, '--admission-root') })
  console.log(JSON.stringify(r, null, 2))
  return r.ok ? 0 : 1
}

async function runDryRun() {
  const researchDir = opt('--research') ?? path.resolve(ROOT, '..', 'soransoran-mgraph-research')
  const repoDir = opt('--repo') ?? ROOT
  const at = opt('--at') ?? nowKst()
  try { parseAt(at) } catch (e) { usage(e.message) }

  let manifest
  try {
    manifest = buildManifest(await loadInputs({ researchDir, repoDir }), { at })
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
  console.log(`  판정 시각 ${manifest.at} · 제품 graph bundle ${manifest.productGraphBundle.graphVersion}(읽기만) · manifest ${manifest.hash.slice(0, 16)}`)
  console.log('  🔴 apply 는 topic queue 와 편입 장부만 쓴다 — 제품 graph bundle 갱신은 별도 단계(재빌드·export·배포)다')
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
  console.log(`\n  제품 graph bundle 에 매핑이 없는 글 ${manifest.drift.length}건 (재작성하지 않는다 — 보고만)`)
  for (const d of manifest.drift) console.log(`    ${d.slug} · ${d.state} ${d.publishAt} · ${d.kind}${d.researchIntents.length ? ` · ${d.researchIntents.join(',')}` : ''}`)
  console.log('')
}

// 🔴 process.exit 를 부르지 않는다 — 파이프로 나가는 큰 JSON 이 잘린다
process.exitCode = flag('--verify') ? runVerify() : flag('--apply') ? await runApply() : await runDryRun()
