#!/usr/bin/env tsx
/**
 * 운영 체인 end-to-end 검사 — 🔴 **실제 러너가 쓴 파일만 증거로 쓴다**
 *
 * 🔴 **손으로 만든 봉투는 증거가 아니다.** 가짜 provider 와 임시 HOME 으로 **실제
 *    러너**를 돌려 나온 `candidates.json` · `artifacts.json` 을 **실제 순수 함수**
 *    (`readCandidateFile → machineProfileMismatch → planRefill → buildQueuePayload`
 *     → `findReviewArtifact`)에 그대로 넣는다.
 *
 * 🔴 네트워크 0 · 실제 provider 0 · DB 0 · Queue write 0.
 */
import { spawnSync } from 'node:child_process'
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readCandidateFile } from './micro-seed-supply-autofill.mjs'
import {
  MACHINE_PROFILE, MACHINE_MODEL, machineProfileMismatch, planRefill, buildQueuePayload,
} from '../src/lib/micro-seed-supply-autofill'
import {
  CONTENT_CORE_MODEL_LABEL, CONTENT_CORE_PIPELINE_VERSION, CONTENT_CORE_PROMPT_VERSION,
  STAGE_MODEL, stageModelsMismatch,
} from '../src/lib/content-core/pipeline'
import {
  findReviewArtifact, readReviewArtifact, reviewEvidenceLines, artifactCostUsd, usdPerReady,
  type ReviewArtifact,
} from '../src/lib/original-post-machine-review'
import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
import { maskSensitive } from './lib/micro-seed-raw-originality.mjs'
import { writeFakePersonaAsset } from './lib/fake-persona-asset.mjs'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) }
  else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : `\n      ${extra}`}`) }
}

console.log('\n══ 운영 체인 end-to-end (🔴 실제 러너 · 가짜 provider · 네트워크 0 · DB 0) ══\n')

// ─────────────────────────────────────────────────────────
// 실제 러너를 돌려 **진짜 파일**을 얻는다
// ─────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'chain-e2e-'))
const dd = join(root, '.microseed-data')
mkdirSync(dd, { recursive: true })
const fakeHome = join(root, 'home')
mkdirSync(join(fakeHome, 'Library', 'Application Support', 'soransoran'), { recursive: true })
// 🔴 합성 말투 자산 — 회원 댓글이 아니다. 없으면 러너가 생성 전에 멈춘다
writeFakePersonaAsset({ home: fakeHome })
// 🔴 Persona 정본 카드는 저장소 문서다 — 임시 root 에서도 같은 정본을 읽게 한다
symlinkSync(join(process.cwd(), 'docs'), join(root, 'docs'))

/** 🔴 제목에 연락처·메일·계정을 심는다 — 마스킹을 거치는지 본다 */
const RAW_TITLE = '김치 언제 꺼내세요 010-1234-5678 me@example.com @insta_id'
const SRC_ID = 'E1'
writeFileSync(join(dd, 'x.detail.jsonl'), `${JSON.stringify({
  sourceArticleId: SRC_ID, sourceSite: 'navercafe:wgang', title: RAW_TITLE,
  bodyHead: '올해는 좀 이른가 싶었는데 그냥 꺼냈어요. 다들 언제쯤 여시는지 궁금해요.',
  bodyHeadChars: 300, axis: 'life', lane: 'community',
  sourcePostedAt: '2026-09-18T01:00:00.000Z',
  sourceListedAt: '2026-09-18T02:00:00.000Z',
  sourceCapturedAt: '2026-09-18T03:00:00.000Z',
})}\n`, 'utf-8')
writeFileSync(join(dd, 'x.shadow.jsonl'), `${JSON.stringify({
  sourceArticleId: SRC_ID, decision: 'AUTO_SEED', semanticRisks: [],
  ruleVersion: 'auto-judge-v1', promptVersion: 'p', model: 'm', inputHash: 'h',
  provenance: 'machine-judged',
})}\n`, 'utf-8')
const runId = 'E2E'
writeFileSync(join(dd, queueSnapshotFileName(runId)),
  JSON.stringify(buildQueueSnapshot({ runId, takenAt: new Date(), rows: [] })), 'utf-8')

const bodyLog = join(root, 'body.log')
writeFileSync(bodyLog, '', 'utf-8')
const r = spawnSync(
  join(process.cwd(), 'node_modules/.bin/tsx'),
  [
    join(process.cwd(), 'scripts/micro-seed-auto-draft.mts'), '--call', '--apply',
    `--queue-snapshot=${join(dd, queueSnapshotFileName(runId))}`,
    `--run-id=${runId}`, '--require-queue-snapshot',
  ],
  {
    cwd: root, encoding: 'utf-8',
    env: {
      ...process.env, HOME: fakeHome,
      ANTHROPIC_API_KEY: 'fixture-fake-key', GEMINI_API_KEY: 'fixture-fake-gemini-key',
      FAKE_PROVIDER_BODY_LOG: bodyLog,
      NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
      SORAN_LLM_DAILY_BUDGET_USD: '1000',
      SORAN_LLM_RESERVE_HEADROOM: '1.5',
      SORAN_LLM_RUN_REQUEST_CAP: '10000',
    },
  },
)
const out = `${r.stdout ?? ''}${r.stderr ?? ''}`

// ─────────────────────────────────────────────────────────
console.log('① 실제 러너가 파일을 냈다')
// ─────────────────────────────────────────────────────────
const candFiles = readdirSync(dd).filter((f) => /\.candidates\.json$/.test(f))
const artFiles = readdirSync(dd).filter((f) => /\.artifacts\.json$/.test(f))
check('🔴 러너가 정상 종료했다', r.status === 0, out.split('\n').slice(-12).join('\n      '))
if (process.env.E2E_VERBOSE === '1') console.log(out)
check('🔴 candidates.json 이 나왔다', candFiles.length === 1, candFiles.join(','))
check('🔴 🔴 **artifacts.json 이 나왔다** — 사람이 볼 근거', artFiles.length === 1)
if (candFiles.length !== 1 || artFiles.length !== 1) {
  console.log(`\n${out.split('\n').slice(-25).join('\n')}`)
  console.log(`\n🔴 ${pass} pass · ${fail} fail`)
  process.exit(1)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 제목이 정본 maskSensitive 를 거쳤다')
// ─────────────────────────────────────────────────────────
{
  const sent = readFileSync(bodyLog, 'utf-8').split('\n').filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { url: string; body: string })
  check('🔴 provider 로 나간 요청이 있다', sent.length > 0)
  const all = sent.map((x) => x.body).join('\n')
  check('🔴 🔴 **연락처가 provider 로 나가지 않았다**', !all.includes('010-1234-5678'))
  check('🔴 🔴 **메일이 나가지 않았다**', !all.includes('me@example.com'))
  check('🔴 🔴 **계정이 나가지 않았다**', !all.includes('@insta_id'))
  check('🔴 마스킹 표식으로 바뀌었다', /\[연락처\]|\[메일\]|\[계정\]/.test(all), all.slice(0, 200))
  check('🟢 마스킹해도 소재는 남는다', all.includes('김치'))
  // 🔴 정본 함수와 같은 결과인가 — 러너가 제 함수를 만들지 않았다
  check('🔴 정본 maskSensitive 와 같은 값이다', all.includes(maskSensitive(RAW_TITLE)))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 실제 봉투 → machineProfileMismatch')
// ─────────────────────────────────────────────────────────
const { envelope, candidates } = readCandidateFile(join(dd, candFiles[0]!))
check('🔴 봉투를 실제 reader 로 읽었다', typeof envelope.provenance === 'string')
check('🔴 🔴 **봉투가 stageModels 를 싣는다** — 한 칸으로 뭉개지 않았다',
  stageModelsMismatch(envelope.stageModels).length === 0,
  JSON.stringify(envelope.stageModels))
check('🔴 봉투 promptVersion 이 세 판을 합친 값이다',
  envelope.promptVersion === CONTENT_CORE_PROMPT_VERSION, String(envelope.promptVersion))
check('🔴 봉투 pipelineVersion 이 정본과 같다',
  envelope.pipelineVersion === CONTENT_CORE_PIPELINE_VERSION)
check('🔴 🔴 **봉투에 model 한 칸이 없다** — Haiku 라고 거짓 기록하지 않았다',
  !('model' in (envelope as Record<string, unknown>))
  || (envelope as Record<string, unknown>).model === undefined)
if (candidates.length !== 1) {
  const dbg = JSON.parse(readFileSync(join(dd, artFiles[0]!), 'utf-8')) as Record<string, unknown>[]
  for (const a of dbg) {
    console.log(`      artifact ${String(a.sourceArticleId)} → ${JSON.stringify((a.review as Record<string, unknown>).machineReason)}`)
    console.log(`      plan ${JSON.stringify(a.plan)}`)
    console.log(`      calls ${JSON.stringify((a.cost as Record<string, unknown>).calls)}`)
  }
}
check('🔴 후보가 1건 나왔다', candidates.length === 1, `${candidates.length}건`)
const bad = candidates.length === 1 ? machineProfileMismatch(envelope, candidates[0]!) : ['후보 없음']
check('🔴 🔴 **실제 후보가 PROFILE 을 통과한다**', bad.length === 0, bad.join(' · '))

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 planRefill → buildQueuePayload')
// ─────────────────────────────────────────────────────────
{
  const plan = planRefill({
    envelope, candidates, held: [], existing: new Set<string>(), queue: [], usable: 0,
  })
  check('🔴 🔴 **실제 후보가 보충 대상으로 선정된다**',
    plan.targets.length === 1,
    JSON.stringify(plan.skipped))
  const payload = plan.targets.length === 1
    ? buildQueuePayload({
      envelope, candidate: plan.targets[0]!,
      autoJudge: { ruleVersion: 'auto-judge-v1', promptVersion: 'p', model: 'm', inputHash: 'h', provenance: 'machine-judged' },
      now: new Date().toISOString(),
    })
    : null
  check('🔴 🔴 **Queue payload 가 만들어진다**', payload !== null)
  if (payload !== null) {
    check('🔴 기계 profile 이다 — 사람 것을 사칭하지 않는다', payload.profile === 'machine')
    check('🔴 🔴 **Queue 가 한 모델 이름을 적지 않는다**',
      payload.model === MACHINE_MODEL && payload.model === CONTENT_CORE_MODEL_LABEL
      && payload.model.includes('gemini-3.7-flash') && payload.model.includes('claude-haiku-4.5'),
      payload.model)
    const ad = (payload.gateResults as Record<string, unknown>).autoDraft as Record<string, unknown>
    check('🔴 🔴 **gateResults 가 단계별 모델을 남긴다**',
      stageModelsMismatch(ad.stageModels).length === 0, JSON.stringify(ad.stageModels))
    check('🔴 gateResults 가 pipelineVersion 을 남긴다',
      ad.pipelineVersion === CONTENT_CORE_PIPELINE_VERSION)
    check('🔴 🔴 **원천 id 만 싣는다 — 원문 근거를 DB 로 복사하지 않는다**',
      ad.sourceArticleId === SRC_ID
      && !JSON.stringify(payload).includes('올해는 좀 이른가 싶었는데'))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 artifacts.json → 사람 검토 근거')
// ─────────────────────────────────────────────────────────
{
  const raw = JSON.parse(readFileSync(join(dd, artFiles[0]!), 'utf-8')) as unknown[]
  const arts = raw.map(readReviewArtifact).filter((x): x is ReviewArtifact => x !== null)
  check('🔴 artifact 를 읽었다', arts.length === 1, `${arts.length}장`)
  const a = arts[0]!
  const cand = candidates[0]!
  const ev = findReviewArtifact({
    sourceArticleId: SRC_ID, title: String(cand.title), body: String(cand.body), artifacts: arts,
  })
  check('🔴 🔴 **큐 행과 artifact 가 이어진다**', ev.ok, ev.ok ? '' : ev.reason)
  check('🔴 🔴 **다른 원천이면 거부한다**',
    !findReviewArtifact({ sourceArticleId: 'OTHER', title: String(cand.title), body: String(cand.body), artifacts: arts }).ok)
  check('🔴 🔴 **artifact 가 없으면 거부한다**',
    !findReviewArtifact({ sourceArticleId: SRC_ID, title: String(cand.title), body: String(cand.body), artifacts: [] }).ok)
  check('🔴 원천 id 가 없으면 거부한다',
    !findReviewArtifact({ sourceArticleId: null, title: String(cand.title), body: String(cand.body), artifacts: arts }).ok)
  check('🔴 🔴 **같은 원천이라도 글이 다르면 거부한다**',
    !findReviewArtifact({ sourceArticleId: SRC_ID, title: '다른 글', body: '다른 본문', artifacts: arts }).ok)

  const lines = reviewEvidenceLines(a).join('\n')
  check('🔴 🔴 **사람이 원문 근거를 본다**', lines.includes('원문 근거:') && lines.includes('김치'))
  check('🔴 사람이 Persona·stance 를 본다', /화자 P\d+ \/ \w+/.test(lines), lines.split('\n')[1])
  check('🔴 사람이 원문에 없는 것을 본다', lines.includes('원문에 없는 것'))
  check('🔴 사람이 생활사 모순을 본다', lines.includes('생활사 모순'))
  check('🔴 사람이 기계 사유를 본다', lines.includes('기계 '))
  check('🔴 🔴 **원문 근거가 마스킹된 값이다**',
    !lines.includes('010-1234-5678') && !lines.includes('me@example.com'))

  // ── 🔴 비용은 장부가 정산한 값만 쓴다 ──
  check('🔴 🔴 **artifact 가 장부 정산액을 싣는다**',
    a.calls.length === 3 && a.calls.every((c) => c.usd !== null),
    JSON.stringify(a.calls))
  check('🔴 원천별 총비용을 계산할 수 있다', artifactCostUsd(a) !== null && artifactCostUsd(a)! > 0)
  check('🔴 단계별 모델이 남았다',
    a.calls.map((c) => c.model).join(',')
      === `${STAGE_MODEL.speakerPlan},${STAGE_MODEL.draftGen},${STAGE_MODEL.semanticReview}`)
  const ready = usdPerReady({ artifacts: arts, readySourceIds: [SRC_ID] })
  check('🔴 🔴 **사람 READY 한 편당 비용을 계산할 수 있다**',
    ready.perReady !== null && ready.perReady > 0, JSON.stringify(ready))
  check('🔴 🔴 **READY 0 이면 계산 불가라고 말한다** — 0 으로 나누지 않는다', (() => {
    const z = usdPerReady({ artifacts: arts, readySourceIds: [] })
    return z.perReady === null && z.why.includes('계산 불가')
  })())
  check('🔴 정산 미상이 하나라도 있으면 합계를 만들지 않는다', (() => {
    const broken: ReviewArtifact = { ...a, calls: [{ stage: 'x', model: null, usd: null }] }
    return artifactCostUsd(broken) === null
      && usdPerReady({ artifacts: [broken], readySourceIds: [SRC_ID] }).total === null
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 하지 않은 것')
// ─────────────────────────────────────────────────────────
{
  check('🔴 DB 를 부르지 않았다', !/PrismaClient|prisma\./.test(
    readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')))
  check('🔴 Queue 파일을 쓰지 않았다',
    readdirSync(dd).every((f) => !/queue-write|\.queue\.json$/.test(f)))
  check('🔴 후보는 AUTO_ADOPT 다 — 사람 ADOPT 가 아니다',
    candidates.every((c) => String(c.sourceDecision) === MACHINE_PROFILE.sourceDecision))
  check('🔴 임시 HOME 밖 장부를 건드리지 않았다',
    existsSync(join(fakeHome, 'Library', 'Application Support', 'soransoran', 'llm-ledger')))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 다 — 실제 모델이 쓸 만한 글을 쓰는지는 증명하지 않았다.')
if (fail > 0) process.exit(1)
