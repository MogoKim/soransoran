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
  currentText, editDiffLines,
  type ReviewArtifact, type ReviewTarget,
} from '../src/lib/original-post-machine-review'
import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
import { maskSensitive } from './lib/micro-seed-raw-originality.mjs'
import { judgeReviewSnapshot } from '../src/lib/original-post-auto-publish'
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
/** 🔴 실제 러너 한 회차 — 시험 env 는 자식 프로세스에만 */
const runRunner = (extraEnv: Record<string, string> = {}, rid = runId): ReturnType<typeof spawnSync> =>
  spawnSync(
    join(process.cwd(), 'node_modules/.bin/tsx'),
    [
      join(process.cwd(), 'scripts/micro-seed-auto-draft.mts'), '--call', '--apply',
      `--queue-snapshot=${join(dd, queueSnapshotFileName(rid))}`,
      `--run-id=${rid}`, '--require-queue-snapshot',
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
        ...extraEnv,
      },
    },
  )
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
  const AID = a.artifactId
  /** 🔴 큐 행 모양 — artifact 는 **최초 초안**과 견준다 */
  const tgt = (o: Partial<ReviewTarget> = {}): ReviewTarget => ({
    artifactId: AID, sourceArticleId: SRC_ID,
    draftTitle: String(cand.title), draftBody: String(cand.body),
    editedTitle: null, editedBody: null, ...o,
  })
  check('🔴 🔴 **artifactId 가 후보 파일까지 이어진다**',
    String((cand as unknown as Record<string, unknown>).artifactId) === AID)
  check('🔴 artifactId 가 불투명하다 — 원문에서 유도하지 않았다',
    /^[0-9a-f]{32}$/.test(AID)
    && !AID.includes('E1') && !RAW_TITLE.includes(AID))
  check('🔴 🔴 **큐 행과 artifact 가 artifactId 로 이어진다**',
    findReviewArtifact({ target: tgt(), artifacts: arts }).ok)
  check('🔴 🔴 **다른 artifactId 면 검토 불가**',
    !findReviewArtifact({ target: tgt({ artifactId: 'f'.repeat(32) }), artifacts: arts }).ok)
  check('🔴 artifactId 가 없으면 거부한다',
    !findReviewArtifact({ target: tgt({ artifactId: null }), artifacts: arts }).ok)
  check('🔴 🔴 **원천이 다르면 거부한다**',
    !findReviewArtifact({ target: tgt({ sourceArticleId: 'OTHER' }), artifacts: arts }).ok)
  check('🔴 🔴 **최초 초안이 다르면 거부한다**',
    !findReviewArtifact({ target: tgt({ draftBody: '다른 본문' }), artifacts: arts }).ok)
  check('🔴 artifact 가 없으면 거부한다',
    !findReviewArtifact({ target: tgt(), artifacts: [] }).ok)
  /** 🔴 같은 원천의 다른 회차가 섞여도 **정확히 그 한 장**만 고른다 */
  {
    const other: ReviewArtifact = {
      ...a, artifactId: 'a'.repeat(32),
      draft: { title: '같은 원천 다른 회차', body: '다른 글입니다.' },
    }
    const r2 = findReviewArtifact({ target: tgt(), artifacts: [other, a] })
    check('🔴 🔴 **같은 원천의 여러 artifact 중 정확한 것만 고른다**',
      r2.ok && r2.artifact.artifactId === AID)
    check('🔴 같은 artifactId 인데 내용이 다르면 막는다', (() => {
      const clash: ReviewArtifact = { ...a, machineReason: '다른 사유' }
      const r3 = findReviewArtifact({ target: tgt(), artifacts: [a, clash] })
      return !r3.ok && r3.code === 'duplicateArtifactId'
    })())
  }

  // ── 🔴 EDIT_REQUIRED — 정상적인 사람 수정을 잘못된 artifact 로 오해하지 않는다 ──
  {
    const edited = tgt({ editedTitle: '사람이 고친 제목', editedBody: `${String(cand.body)}\n한 줄 덧붙였습니다.` })
    const r4 = findReviewArtifact({ target: edited, artifacts: arts })
    check('🟢 🔴 **정상 EDITED 후보도 검토 가능하다**', r4.ok, r4.ok ? '' : r4.reason)
    const cur = currentText(edited)
    check('🔴 사람이 읽는 것은 수정본이다',
      cur.edited && cur.title === '사람이 고친 제목' && cur.body.includes('한 줄 덧붙였습니다'))
    const diff = editDiffLines(edited).join('\n')
    check('🔴 🔴 **무엇이 바뀌었는지 보여 준다**',
      diff.includes('제목') && diff.includes('사람이 고친 제목') && diff.includes(String(cand.title)))
    check('🟢 정상 미수정 후보도 검토 가능하다',
      findReviewArtifact({ target: tgt(), artifacts: arts }).ok && !currentText(tgt()).edited)
    check('🔴 수정본이 있어도 **최초 초안이 다르면** 여전히 거부한다',
      !findReviewArtifact({ target: { ...edited, draftBody: '위조' }, artifacts: arts }).ok)
  }

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
  const ready = usdPerReady({ artifacts: arts, readyArtifactIds: [AID] })
  check('🔴 🔴 **사람 READY 한 편당 비용을 계산할 수 있다**',
    ready.perReady !== null && ready.perReady > 0, JSON.stringify(ready))
  /** 🔴 같은 장이 캐시 hit·여러 파일로 반복돼도 **한 번만** 센다 */
  check('🔴 🔴 **중복 artifact 비용을 한 번만 집계한다**', (() => {
    const one = usdPerReady({ artifacts: arts, readyArtifactIds: [AID] })
    const dup = usdPerReady({ artifacts: [...arts, ...arts, ...arts], readyArtifactIds: [AID] })
    return one.total !== null && dup.total === one.total && dup.perReady === one.perReady
  })())
  check('🔴 🔴 **같은 artifactId 가 다른 비용이면 오류로 막는다**', (() => {
    const clash: ReviewArtifact = { ...a, calls: [{ stage: 'x', model: 'm', usd: 99 }] }
    const v = usdPerReady({ artifacts: [a, clash], readyArtifactIds: [AID] })
    return v.total === null && v.why.includes('서로 다른 비용')
  })())
  check('🔴 🔴 **READY 0 이면 계산 불가라고 말한다** — 0 으로 나누지 않는다', (() => {
    const z = usdPerReady({ artifacts: arts, readyArtifactIds: [] })
    return z.perReady === null && z.why.includes('계산 불가')
  })())
  check('🔴 정산 미상이 하나라도 있으면 합계를 만들지 않는다', (() => {
    const broken: ReviewArtifact = { ...a, calls: [{ stage: 'x', model: null, usd: null }] }
    return artifactCostUsd(broken) === null
      && usdPerReady({ artifacts: [broken], readyArtifactIds: [AID] }).total === null
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

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 🔴 정산 줄을 못 적으면 후보가 0건이다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **provider 는 성공했는데 장부에 정산이 안 적힌** 상태를 실제 러너로 재현한다.
   *    앞판은 그때도 `settledUsd` 를 돌려줘서, **금액을 모르는 글**이 후보·캐시·
   *    AUTO_ADOPT 까지 갈 수 있었다.
   */
  const root2 = mkdtempSync(join(tmpdir(), 'chain-e2e-sf-'))
  const dd2 = join(root2, '.microseed-data')
  mkdirSync(dd2, { recursive: true })
  const home2 = join(root2, 'home')
  mkdirSync(join(home2, 'Library', 'Application Support', 'soransoran'), { recursive: true })
  writeFakePersonaAsset({ home: home2 })
  symlinkSync(join(process.cwd(), 'docs'), join(root2, 'docs'))
  for (const f of ['x.detail.jsonl', 'x.shadow.jsonl']) {
    writeFileSync(join(dd2, f), readFileSync(join(dd, f), 'utf-8'), 'utf-8')
  }
  const rid2 = 'E2ESF'
  writeFileSync(join(dd2, queueSnapshotFileName(rid2)),
    JSON.stringify(buildQueueSnapshot({ runId: rid2, takenAt: new Date(), rows: [] })), 'utf-8')
  const r2 = spawnSync(
    join(process.cwd(), 'node_modules/.bin/tsx'),
    [
      join(process.cwd(), 'scripts/micro-seed-auto-draft.mts'), '--call', '--apply',
      `--queue-snapshot=${join(dd2, queueSnapshotFileName(rid2))}`,
      `--run-id=${rid2}`, '--require-queue-snapshot',
    ],
    {
      cwd: root2, encoding: 'utf-8',
      env: {
        ...process.env, HOME: home2,
        ANTHROPIC_API_KEY: 'fixture-fake-key', GEMINI_API_KEY: 'fixture-fake-gemini-key',
        NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
        // 🔴 의미 검수(=draftQuality) 의 **정산 줄만** 못 적게 한다
        FAKE_LEDGER_SETTLE_FAIL: 'draftQuality',
        SORAN_LLM_DAILY_BUDGET_USD: '1000',
        SORAN_LLM_RESERVE_HEADROOM: '1.5',
        SORAN_LLM_RUN_REQUEST_CAP: '10000',
      },
    },
  )
  const out2 = `${r2.stdout ?? ''}${r2.stderr ?? ''}`
  const cand2 = readdirSync(dd2).filter((f) => /\.candidates\.json$/.test(f))
  const rows2 = cand2.flatMap((f) =>
    (JSON.parse(readFileSync(join(dd2, f), 'utf-8')) as { candidates?: unknown[] }).candidates ?? [])
  check('🔴 🔴 **정산 기록 실패 → 후보 0건**', rows2.length === 0,
    `${rows2.length}건\n      ${out2.split('\n').slice(-14).join('\n      ')}`)
  check('🔴 🔴 **AUTO_ADOPT 0건**', /AUTO_ADOPT\s+0건/.test(out2),
    `code=${r2.status}\n      ${out2.split('\n').slice(-16).join('\n      ')}`)
  const cachePath = join(dd2, 'auto-draft-cache.json')
  const cache2 = existsSync(cachePath)
    ? JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<string, unknown> : {}
  check('🔴 🔴 **캐시에도 남지 않는다** — 다음 회차가 그것을 재사용하지 않는다',
    Object.keys(cache2).length === 0, JSON.stringify(Object.keys(cache2)))
  check('🔴 장부에 미정산 보류 표식이 남는다', (() => {
    const ld = join(home2, 'Library', 'Application Support', 'soransoran', 'llm-ledger')
    if (!existsSync(ld)) return false
    // 🔴 파일 표식이 남아야 재시작이 우회가 되지 않는다
    return readdirSync(ld).some((f) => f.includes('hold'))
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 검토 뒤 글이 바뀌면 승인되지 않는다 (optimistic lock)')
// ─────────────────────────────────────────────────────────
{
  const snap = {
    status: 'APPROVED', createdPostId: null, decidedBy: null, updatedAt: new Date('2026-09-20T00:00:00Z'),
    title: '제목', body: '본문', promptVersion: 'p', model: 'm', gateResults: {},
  }
  check('🟢 아무것도 바뀌지 않으면 통과한다', judgeReviewSnapshot(snap, snap).ok)
  check('🔴 🔴 **검토 뒤 본문이 바뀌면 승인 실패**',
    !judgeReviewSnapshot(snap, { ...snap, body: '누가 바꿨다' }).ok)
  check('🔴 검토 뒤 제목이 바뀌어도 실패', !judgeReviewSnapshot(snap, { ...snap, title: 'x' }).ok)
  check('🔴 검토 뒤 상태가 바뀌어도 실패', !judgeReviewSnapshot(snap, { ...snap, status: 'PUBLISHED' }).ok)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 다 — 실제 모델이 쓸 만한 글을 쓰는지는 증명하지 않았다.')
if (fail > 0) process.exit(1)
