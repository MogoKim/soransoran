#!/usr/bin/env node
/**
 * M-GRAPH 결정적 build 변이 시험 — 지키는 줄을 하나씩 망가뜨리면 검사가 **실제로** 실패해야 한다.
 *
 *   node scripts/magazine-graph-build-mutation.mjs
 *
 * 🔴 저장소 파일을 고치지 않는다. lib · CLI 의 변이 사본을 임시 폴더에 만들고(상대 import 는 절대 경로로),
 *    검사에 MGRAPH_BUILD_LIB · MGRAPH_BUILD_CLI 로 주입한다.
 * 🔴 검출로 세는 것은 `RESULT pass=… fail=N(N>0)` 과 exit 1 뿐이다.
 *    변이 지점 없음 · 지점 중복 · 문법 오류 · 적재 실패(LOAD_ERROR) · RESULT 없음은 **하네스 FAIL** 이다.
 * 🔴 무변이 사본으로 먼저 돌려 fail=0 이어야 한다 — 사본 주입 경로가 고장 나면 모든 변이가 거짓 검출된다.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = { lib: join(HERE, 'lib/magazine-graph-build.mjs'), cli: join(HERE, 'magazine-graph-build.mjs') }
const CHECK = join(HERE, 'magazine-graph-build-check.mjs')

const MUTATIONS = [
  { id: 'M1 graphVersion 날짜를 벽시계에서', file: 'lib', from: 'const graphVersion = `g-${eff.versionDate}-${combined.slice(0, 6)}`',
    to: "const graphVersion = `g-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${combined.slice(0, 6)}`", expect: '반례1' },
  { id: 'M2 KST 날짜 대신 UTC 날짜', file: 'lib', from: 'const kstDate = new Date(ms + 9 * 3600e3).toISOString().slice(0, 10)',
    to: 'const kstDate = new Date(ms).toISOString().slice(0, 10)', expect: '반례1b' },
  { id: 'M3 semanticHash 에 generatedAt 포함', file: 'lib', from: 'const { generatedAt: _omit, ...rest } = slim', to: 'const rest = slim', expect: '반례2' },
  { id: 'M4 contentHash 에 generatedAt 섞기', file: 'lib', from: 'const combined = sha16(hI + hE + hM)', to: 'const combined = sha16(hI + hE + hM + gen)', expect: '반례2' },
  { id: 'M5 bundle 머리말 시각을 벽시계로', file: 'lib', from: '// 생성: ${slim.generatedAt}', to: '// 생성: ${new Date().toISOString()}', expect: '반례3' },
  { id: 'M6 판 전환 파일 가드 제거', file: 'cli', from: "if (existsSync(join(outDir, 'current.ts')) || existsSync(join(outDir, 'control.ts'))) {",
    to: 'if (false) {', expect: '반례4b' },
  { id: 'M7 manifest 에 입력 절대 경로 기록', file: 'lib', from: "    inputHashes: inputs.hashes,",
    to: "    inputHashes: inputs.hashes, inputRoot: process.argv[process.argv.indexOf('--input-root') + 1],", expect: '반례5' },
  { id: 'M8 생산 최소 direct 2 → 1', file: 'lib', from: 'productionMinimum: Object.freeze({ direct: 2, discovery: 1 })',
    to: 'productionMinimum: Object.freeze({ direct: 1, discovery: 1 })', expect: '반례6' },
  { id: 'M9 discovery 최소 무시', file: 'lib', from: 'if (discoveryCount < min.discovery) shortfall.push', to: 'if (false) shortfall.push', expect: '반례6b' },
  { id: 'M10 HOLD·비자동화 edge 를 근거로', file: 'lib', from: 'if (!e.layers.AUTOMATION_READY) why.push(', to: 'if (false) why.push(', expect: '반례7' },
  { id: 'M11 미공개 대상을 근거로', file: 'lib', from: "if (slugs.length === 0) why.push('TARGET_NOT_PUBLIC')", to: 'if (false) why.push()', expect: '반례7' },
  { id: 'M12 빈 이유(weak filler) 허용', file: 'lib', from: "if (!nonEmpty(e.readerReason) || !nonEmpty(e.anchorLabel)) why.push('WEAK_REASON_OR_ANCHOR')",
    to: 'if (false) why.push()', expect: '반례7' },
  { id: 'M13 control-off·cluster 꺼짐을 표시 count 에 반영 안 함', file: 'lib', from: 'const visible = clusterOn(cluster)', to: 'const visible = true', expect: '반례7b' },
  { id: 'M14 꺼진 표면을 근거로', file: 'lib', from: 'if (!enabledSurfaces.has(e.placement)) why.push(', to: 'if (false) why.push(', expect: '반례7c' },
  { id: 'M15 reverse 출발 글 cluster 무시', file: 'lib', from: 'if (!clusterOn(articles.get(slug).cluster ?? null)) continue', to: '', expect: '반례7d' },
  { id: 'M16 reverse 불일치 blocker 제거', file: 'lib', from: "if (mismatches.length) blockers.push('REVERSE_LINK_MISMATCH')", to: '', expect: '반례8' },
  { id: 'M17 reverse 부재 허용', file: 'lib', from: "if (reverseSources.length === 0) shortfall.push('REVERSE_LINK_ABSENT')", to: '', expect: '반례8c' },
  { id: 'M18 G8 미판독을 조용히 통과', file: 'lib', from: "admissionState = 'UNREAD'; admissionBlockers.push('G8_ADMISSION_UNREAD')",
    to: "admissionState = 'UNREAD'", expect: '반례8d' },
  { id: 'M19 edge 없는 미등록 intent 누락', file: 'lib', from: 'if (registered(id)) continue',
    to: 'if (registered(id) || !layers.edges.some((e) => e.fromIntentId === id)) continue', expect: '반례9' },
  { id: 'M20 같은 판 폴더 덮어쓰기', file: 'cli', from: "if (!same) refuse('OUT_STAGE_CONFLICT'", to: "if (false) refuse('OUT_STAGE_CONFLICT'", expect: '반례3b' },
]

const TMP = mkdtempSync(join(tmpdir(), 'mgraph-build-mutation-'))
const text = { lib: readFileSync(SRC.lib, 'utf8'), cli: readFileSync(SRC.cli, 'utf8') }
/** 상대 import 를 원래 위치의 절대 경로로 — 사본이 임시 폴더에서도 같은 모듈을 읽게 한다 */
const absolutize = (src, from) => src.replace(/from '\.\/([^']+)'/g, (_, rel) => `from '${join(dirname(from), rel)}'`)

function runWith(libText, cliText, tag) {
  const libPath = join(TMP, `${tag}-lib.mjs`), cliPath = join(TMP, `${tag}-cli.mjs`)
  writeFileSync(libPath, absolutize(libText, SRC.lib))
  // CLI 는 lib 를 './lib/magazine-graph-build.mjs' 로 읽는다 — 변이 lib 사본으로 돌린다
  writeFileSync(cliPath, absolutize(cliText, SRC.cli).replace(join(dirname(SRC.cli), 'lib/magazine-graph-build.mjs'), libPath))
  const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env: { ...process.env, MGRAPH_BUILD_LIB: libPath, MGRAPH_BUILD_CLI: cliPath } })
  const m = /RESULT pass=(\d+) fail=(\d+)/.exec(r.stdout ?? '')
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', pass: m ? +m[1] : null, fail: m ? +m[2] : null, load: /LOAD_ERROR/.test(r.stdout ?? '') }
}

const lines = []
let harnessFail = 0, detected = 0
const base = runWith(text.lib, text.cli, 'base')
if (base.status !== 0 || base.fail !== 0 || base.load) {
  lines.push(`❌ 무변이 사본이 통과하지 않는다 — 주입 경로 고장 (status ${base.status} · ${base.out.slice(-300)} ${base.err.slice(-300)})`)
  harnessFail++
} else lines.push(`✅ 무변이 사본 pass=${base.pass} fail=0`)

for (const [i, mu] of MUTATIONS.entries()) {
  const src = text[mu.file]
  const count = src.split(mu.from).length - 1
  if (count !== 1) { lines.push(`❌ ${mu.id} — 변이 지점 ${count}곳 (정확히 1곳이어야 한다)`); harnessFail++; continue }
  const mutated = src.replace(mu.from, mu.to)
  const r = runWith(mu.file === 'lib' ? mutated : text.lib, mu.file === 'cli' ? mutated : text.cli, `m${i + 1}`)
  if (r.load || r.fail === null) { lines.push(`❌ ${mu.id} — 적재 실패·RESULT 없음(검출 아님): ${(r.out + r.err).slice(-240)}`); harnessFail++; continue }
  const failedNames = r.out.split('\n').filter((l) => l.includes('❌'))
  const hit = failedNames.some((l) => l.includes(`${mu.expect} `) || l.includes(`${mu.expect}—`))
  if (r.status === 1 && r.fail > 0 && hit) { detected++; lines.push(`✅ ${mu.id} → ${mu.expect} 실패로 검출 (fail=${r.fail})`) }
  else { lines.push(`❌ ${mu.id} — 기대한 ${mu.expect} 가 실패하지 않았다 (status ${r.status} fail=${r.fail})`); harnessFail++ }
}

rmSync(TMP, { recursive: true, force: true })
process.stdout.write(`M-GRAPH 결정적 build 변이\n${lines.join('\n')}\nMUTATION detected=${detected}/${MUTATIONS.length} harnessFail=${harnessFail}\n`)
process.exit(harnessFail ? 1 : 0)
