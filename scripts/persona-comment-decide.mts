#!/usr/bin/env tsx
/**
 * 댓글 생성 모델 **확정 정본 기록** — 🔴 기본은 read-only. AI 0 · DB 0 · 네트워크 0
 *
 *   npm run persona:comment-decide -- --run=20260910-180719            dry-run (기본)
 *   npm run persona:comment-decide -- --run=20260910-180719 --apply    🔴 실제 기록
 *
 * 🔴 **왜 별도 명령인가.**
 *    `persona:comment-canon` 은 "winner 를 정하지 않는다" 를 계약으로 적어 두었다.
 *    그 계약을 지키는 명령 안에 정하는 기능을 끼워 넣으면 문서와 코드가 갈린다.
 *    **정하는 일은 따로 부른다.**
 *
 * 🔴 **winner 를 인자로 받지 않는다.** 승인된 결정은 `APPROVED_DECISION` 상수 하나다 —
 *    명령줄로 받으면 오타 하나가 다른 모델을 확정한다.
 *
 * 🔴 **이 명령은 Queue 를 만들지 않고 runner 를 등록하지 않고 release 를 켜지 않는다.**
 *    확정 정본 파일 하나만 쓴다.
 */
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  APPROVED_DECISION, judgeCanonDecision, judgeCanonWrite,
} from '../src/lib/persona-canon-decision'
import {
  buildCanonFromScoring, MODEL_CANON_FILE, readConfirmedSelection,
} from '../src/lib/persona-comment-provenance'
import { readAssetDigests } from '../src/lib/persona-reference-digest'
import { ARTIFACT_ROOT } from '../src/lib/persona-comment-provenance'

const APPLY = process.argv.includes('--apply')
const runArg = process.argv.find((a) => a.startsWith('--run='))
const RUN_ID = runArg === undefined ? '' : runArg.slice('--run='.length)
const FILE_MODE = 0o600

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

console.log('\n══ 댓글 생성 모델 확정 (🔴 AI 0 · DB 0 · Queue 0 · runner 0 · release 0) ══\n')
console.log(`  모드          ${APPLY ? '🔴 --apply (확정 정본을 쓴다)' : 'dry-run (파일 write 0)'}`)
console.log(`  확정 정본     ${MODEL_CANON_FILE}`)
console.log(`  승인된 결정   회차 ${APPROVED_DECISION.runId} · winner ${APPROVED_DECISION.winner}`
  + ` · decidedBy ${APPROVED_DECISION.decidedBy}`)
console.log(`  탈락          ${APPROVED_DECISION.rejected} — ${APPROVED_DECISION.rejectedBasis}`)

if (RUN_ID === '') fail('--run=<runId> 를 명시해야 한다 (기본값을 두지 않는다)')

/**
 * ── artifact 읽기 — 🔴 **승격된 공용 경로에서만 읽는다** (2026-09-10 정정)
 *
 *    앞선 판은 로컬 `tmp/persona-comment-eval` 을 읽었다. 그런데 확정 정본을 소비하는
 *    `readConfirmedSelection` 은 **공용 경로**를 읽는다 — 두 곳이 다르면
 *    로컬에만 있는 회차로 정본을 쓰고, 소비 경로는 그 회차를 찾지 못한다.
 *    실측: 공용 회차 **0건**인 상태에서 `--apply` 가 canon 을 쓰고 나서
 *    되읽기에 실패해 exit 1 했고, **쓴 파일은 그대로 남았다.**
 *
 *    그래서 읽는 곳을 소비 경로와 **같은 곳**으로 맞춘다.
 *    없으면 여기서 멈춘다 — destination write 0 이다.
 */
const dir = join(ARTIFACT_ROOT, RUN_ID)
const read = (name: string): string => {
  try {
    return readFileSync(join(dir, name), 'utf-8')
  } catch {
    return fail(`공용 경로에서 ${name} 을 읽지 못했다 — ${dir}\n`
      + `   🔴 먼저 승격한다: npm run persona:comment-canon -- --promote=${RUN_ID}`)
  }
}
const summaryJson = read('summary.json')
const samplesJson = read('samples.json')
const keyJson = read('key.json')
const actualSha = {
  summary: sha16(summaryJson), samples: sha16(samplesJson), key: sha16(keyJson),
}
console.log(`\n  회차 artifact ${dir} (🔴 공용 경로 — 소비 경로와 같은 곳)`)
console.log(`     SHA  summary=${actualSha.summary} · samples=${actualSha.samples} · key=${actualSha.key}`)

const runCorpusDigest = ((): string | null => {
  try {
    const m = (JSON.parse(summaryJson) as { referenceManifest?: { sanitizedCorpusDigest?: unknown } })
      .referenceManifest
    return typeof m?.sanitizedCorpusDigest === 'string' ? m.sanitizedCorpusDigest : null
  } catch { return null }
})()
const asset = readAssetDigests()
console.log(`     회차 코퍼스 digest  ${runCorpusDigest ?? '🔴 없음'}`)
console.log(`     지금 자산 digest    ${asset?.sanitizedCorpusDigest ?? '🔴 읽지 못함'}`)

// ── 🔴 판정 ──
const v = judgeCanonDecision({
  runId: RUN_ID,
  winner: APPROVED_DECISION.winner,
  decidedBy: APPROVED_DECISION.decidedBy,
  summaryJson, samplesJson, keyJson, actualSha,
  runCorpusDigest,
  assetCorpusDigest: asset?.sanitizedCorpusDigest ?? null,
})

if (v.evidence !== null) {
  const e = v.evidence
  console.log('\n  ── 표본 근거 (blind key 로 대응)')
  console.log(`     ${e.winner.padEnd(18)} 표본 ${e.winnerSamples}`
    + ` · 근거 없는 자기 경험 ${e.winnerUngrounded}`
    + ` · statusPass ${e.winnerStatusPass}   ← 확정 후보`)
  console.log(`     ${e.rejected.padEnd(18)} 표본 ${e.rejectedSamples}`
    + ` · 근거 없는 자기 경험 ${e.rejectedUngrounded}`
    + ` · statusPass ${e.rejectedStatusPass}   ← 🔴 탈락 (winner 로 고르지 않는다)`)
}

if (!v.ok) {
  console.error('\n  🔴 확정 조건을 못 지켰다:')
  for (const b of v.blocks) console.error(`     [${b.code}] ${b.message}`)
  console.error('\n  파일 write 0.\n')
  process.exit(1)
}
console.log('\n  ✅ 확정 조건 전부 통과')

// ── 쓸 내용 ──
const canon = buildCanonFromScoring({
  runId: RUN_ID, summaryJson, samplesJson, keyJson,
  winner: APPROVED_DECISION.winner,
  decidedBy: APPROVED_DECISION.decidedBy,
  decidedAt: new Date().toISOString(),
  scoredSamples: v.evidence.winnerSamples,
})
const nextJson = `${JSON.stringify(canon, null, 2)}\n`
const existingJson = existsSync(MODEL_CANON_FILE) ? readFileSync(MODEL_CANON_FILE, 'utf-8') : null
const w = judgeCanonWrite({ existingJson, nextJson })
console.log(`\n  쓰기 판정  ${w.action} — ${w.reason}`)

if (w.action === 'CONFLICT') fail(w.reason)

if (!APPLY) {
  console.log('\n🟡 dry-run 이다. 파일 write 0.')
  console.log('   쓸 내용:')
  for (const line of nextJson.trimEnd().split('\n')) console.log(`     ${line}`)
  console.log('\n   실제로 쓰려면 --apply 를 붙인다.\n')
  process.exit(0)
}

if (w.action === 'IDENTICAL') {
  console.log('\n✅ 이미 같은 확정 정본이 있다 — 바꾸지 않았다(멱등).\n')
  process.exit(0)
}

/**
 * ── 🔴 staging 에 쓰고 **먼저 검증한 뒤** 들여놓는다 ──
 *
 *    앞선 판은 destination 에 rename 한 **뒤** 되읽기를 했다.
 *    되읽기가 실패해도 파일은 이미 자리에 있었다 — 실패했는데 남는 것이 가장 나쁘다.
 *    이제 staging 파일을 `readConfirmedSelection({ file: staging })` 로 확인하고,
 *    통과한 것만 atomic rename 한다.
 */
const tmp = join(dirname(MODEL_CANON_FILE), `.persona-comment-model.staging-${process.pid}.json`)
const dropStaging = (): void => { try { rmSync(tmp, { force: true }) } catch { /* 이미 없다 */ } }
try {
  writeFileSync(tmp, nextJson, { encoding: 'utf-8', mode: FILE_MODE })
} catch (e) {
  dropStaging()
  fail(`staging 기록 실패 — ${(e as Error).message}`)
}

/** 🔴 **소비 경로가 쓰는 바로 그 함수**로 staging 을 먼저 읽는다 */
const staged = readConfirmedSelection({ file: tmp })
console.log(`   staging 검증  ${staged.selection?.status} · winner ${staged.selection?.winner ?? '(없음)'}`)
console.log(`                 ${staged.detail}`)
if (staged.selection?.status !== 'confirmed' || staged.selection.winner !== APPROVED_DECISION.winner) {
  dropStaging()
  fail('staging 이 confirmed · winner 로 읽히지 않았다 — 🔴 destination 에 쓰지 않았다')
}

try {
  renameSync(tmp, MODEL_CANON_FILE)
  chmodSync(MODEL_CANON_FILE, FILE_MODE)
} catch (e) {
  dropStaging()
  fail(`확정 정본 기록 실패 — ${(e as Error).message}`)
}
const mode = statSync(MODEL_CANON_FILE).mode & 0o777
console.log(`\n✅ 확정 정본 기록 — ${MODEL_CANON_FILE} · 권한 ${mode.toString(8)}`)

/** 🔴 자리에 놓인 것도 한 번 더 읽는다 */
const back = readConfirmedSelection()
console.log(`   되읽기  ${back.selection?.status} · winner ${back.selection?.winner ?? '(없음)'}`)
if (back.selection?.status !== 'confirmed' || back.selection.winner !== APPROVED_DECISION.winner) {
  fail('destination 되읽기에서 confirmed · winner 가 나오지 않았다')
}
console.log('\n  🔴 Queue 생성 0 · runner 등록 0 · release 점화 0 · DB write 0\n')
process.exit(0)
