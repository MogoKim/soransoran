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
  STAGE_MODEL, STAGE_MAX_OUTPUT_TOKENS, stageModelsMismatch,
} from '../src/lib/content-core/pipeline'
import {
  findReviewArtifact, readReviewArtifact, reviewEvidenceLines, artifactCostUsd,
  currentText, editDiffLines, completeReview,
  type ReviewArtifact, type ReviewTarget, type ReviewTx, type ReviewRow,
  REVIEW_DECISIONS, REVIEW_DECISION_STATUS, PUBLISHABLE_DECISIONS, reviewPatchOf,
  type ReviewGate,
} from '../src/lib/original-post-machine-review'
import {
  selectAutoTargets, MACHINE_PROMPT_VERSION,
  type AutoRow, type ReviewSnapshot,
} from '../src/lib/original-post-auto-publish'
import { ORIGINAL_POST_STATUSES } from '../src/lib/original-post-decision'
import { MACHINE_SITE_PREFIX } from '../src/lib/micro-seed-supply-autofill'
import { AUTO_GATE_VERDICT } from '../src/lib/original-post-auto-publish'
import { readSourceProfile, mustKeepDetails } from './lib/source-profile'
import { analyzeDraft } from './lib/original-post-prompt'
import { gateDraft } from './lib/original-post-gate'
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
console.log('\n②-b 🔴 🔴 단계마다 제 출력 상한으로 나갔다 (2026-09-20)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **나간 요청 본문에서 값을 읽는다.** 세 단계가 `DRAFT_MAX_TOKENS = 1200`
   *    하나를 같이 쓰다가, Gemini 의 thinking 이 본문 자리를 먹어 초안이 사라졌다
   *    (SHADOW5 449787 실측: thinking 1,027 · 1,196 에서 잘림 · 초안 0).
   *    🔴 주석이 아니라 **실제로 실려 나간 숫자**가 증거다.
   */
  const sent = readFileSync(bodyLog, 'utf-8').split('\n').filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { url: string; body: string })
  /** 유료 요청만 — 사전 계산은 `isCount` 로 이미 걸러져 로그에 없다 */
  const caps = sent.map((x) => {
    const b = JSON.parse(x.body) as Record<string, unknown>
    const gen = b.generationConfig as Record<string, unknown> | undefined
    return {
      gemini: x.url.includes('generativelanguage.googleapis.com'),
      max: typeof gen?.maxOutputTokens === 'number' ? gen.maxOutputTokens
        : typeof b.max_tokens === 'number' ? b.max_tokens : null,
    }
  })
  check('🔴 유료 요청 3건이 나갔다', caps.length === 3, `${caps.length}건`)
  // 🔴 순서는 speakerPlan → draftGen → semanticReview 다
  check('🔴 🔴 **speakerPlan 은 1200 으로 나갔다**',
    caps[0]?.gemini === true && caps[0]?.max === STAGE_MAX_OUTPUT_TOKENS.speakerPlan
    && STAGE_MAX_OUTPUT_TOKENS.speakerPlan === 1200, String(caps[0]?.max))
  check('🔴 🔴 **draftGen 은 2000 으로 나갔다** — 본문이 들어갈 자리다',
    caps[1]?.gemini === true && caps[1]?.max === STAGE_MAX_OUTPUT_TOKENS.draftGen
    && STAGE_MAX_OUTPUT_TOKENS.draftGen === 2000, String(caps[1]?.max))
  check('🔴 🔴 **semanticReview 는 1200 으로 나갔다**',
    caps[2]?.gemini === false && caps[2]?.max === STAGE_MAX_OUTPUT_TOKENS.semanticReview
    && STAGE_MAX_OUTPUT_TOKENS.semanticReview === 1200, String(caps[2]?.max))
  check('🔴 🔴 **세 단계가 한 값을 같이 쓰지 않는다** — 옛 공통 1200 으로 되돌리면 여기서 걸린다',
    new Set(caps.map((c) => c.max)).size === 2
    && caps[1]!.max !== caps[0]!.max && caps[1]!.max !== caps[2]!.max)
  check('🔴 🔴 **장부 예약도 그 상한으로 계산됐다** — draftGen 예약이 계획보다 크다', (() => {
    const ledgerDir = join(fakeHome, 'Library', 'Application Support', 'soransoran', 'llm-ledger')
    const day = readdirSync(ledgerDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    const rows = day.flatMap((f) => readFileSync(join(ledgerDir, f), 'utf-8').split('\n')
      .filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>))
    const res = (stage: string): number | null => {
      const r = rows.find((x) => x.stage === stage && x.status === 'reserved')
      return typeof r?.reservedUsd === 'number' ? r.reservedUsd : null
    }
    const plan = res('judge')
    const draft = res('draftGen')
    return plan !== null && draft !== null && draft > plan
  })())
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
  // 🔴 2026-09-20 — 이 둘은 경고다. 막지 않고 **사람에게 보여 준다**
  check('🔴 사람이 원문에 없어 보이는 것을 본다', lines.includes('원문에 없어 보이는 것'))
  check('🔴 사람이 원문에서 사라져 보이는 것을 본다', lines.includes('원문에서 사라져 보이는 것'))
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
  /**
   * 🔴 **전역 한 편당 비용은 내지 않는다** (2026-09-20). 분자(로컬 artifact 전부)와
   *    분모(지금 미발행 READY)의 모집단이 달라 발행이 진행될수록 값이 커진다.
   *    cohort 가 정해지기 전에는 **개별 비용만** 쓴다.
   */
  check('🔴 🔴 **전역 usdPerReady 를 더는 내보내지 않는다**', (() => {
    const lib = readFileSync('src/lib/original-post-machine-review.ts', 'utf-8')
    const cli = readFileSync('scripts/original-post-machine-review.mts', 'utf-8')
    return !/export function usdPerReady/.test(lib) && !/usdPerReady\(/.test(cli)
      && /한 편당 비용을 내지 않는다/.test(cli)
  })())
  check('🔴 개별 artifact 비용 표시는 남는다',
    reviewEvidenceLines(a).join('\n').includes('비용: $'))
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

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 🔴 🔴 검토 완료는 원자적이다 — 어긋나면 도장도 남지 않는다')
// ─────────────────────────────────────────────────────────
{
  const SNAP = (o: Partial<ReviewRow> = {}): ReviewRow => ({
    status: 'APPROVED', createdPostId: null, decidedBy: null, decidedAt: null,
    updatedAt: new Date('2026-09-20T00:00:00Z'),
    title: '기계 제목', body: '기계 본문', promptVersion: 'p', model: 'm',
    gateResults: {}, ...o,
  })
  const BY = 'founder:machine-reviewed'
  const NOW2 = new Date('2026-09-20T12:00:00Z')
  /** 🔴 최초 초안 — 수정본과 견주는 기준이다. 모든 결정이 이 값을 받는다 */
  const DRAFT = { draftTitle: '기계 제목', draftBody: '기계 본문' }

  /**
   * 🔴 **되돌아가는 저장소.** `transaction` 안에서 던지면 그 안의 기록이 **전부 없던 일**이
   *    된다 — 실제 DB 트랜잭션과 같은 계약이다. 실제 DB 는 쓰지 않는다.
   */
  const store = (o: {
    row: ReviewRow | null
    /** 두 번째 read 가 돌려줄 값 — 기록 뒤 상태를 흉내 낸다 */
    after?: (staged: ReviewRow | null) => ReviewRow | null
    stampCount?: number
  }): { store: { transaction: <T>(fn: (tx: ReviewTx) => Promise<T>) => Promise<T> }; committed: () => ReviewRow | null } => {
    let committed = o.row
    return {
      committed: () => committed,
      store: {
        transaction: async <T,>(fn: (tx: ReviewTx) => Promise<T>): Promise<T> => {
          // 🔴 트랜잭션 안의 변경은 여기 쌓이고, 던지면 버려진다
          let staged: ReviewRow | null = committed === null ? null : { ...committed }
          let reads = 0
          const tx: ReviewTx = {
            read: async (_id) => {
              reads += 1
              return reads >= 2 && o.after !== undefined ? o.after(staged) : staged
            },
            stamp: async (i) => {
              const n = o.stampCount ?? (staged !== null
                && staged.updatedAt.getTime() === i.where.updatedAt.getTime()
                && staged.decidedBy === i.where.decidedBy ? 1 : 0)
              if (n === 1 && staged !== null) {
                /** 🔴 실제 UPDATE 와 같게 — 결정이 바꾸는 칸을 그대로 반영한다 */
                staged = {
                  ...staged, decidedBy: i.decidedBy, decidedAt: i.decidedAt,
                  status: i.patch.status,
                  title: i.patch.editedTitle ?? staged.title,
                  body: i.patch.editedBody ?? staged.body,
                  updatedAt: new Date(staged.updatedAt.getTime() + 1000),
                }
              }
              return n
            },
          }
          try {
            const r = await fn(tx)
            committed = staged   // 🔴 끝까지 왔을 때만 커밋
            return r
          } catch (e) {
            // 🔴 되돌린다 — staged 를 버린다
            throw e
          }
        },
      },
    }
  }

  // ⓐ 정상 스냅샷만 검토 완료
  {
    const sv = store({ row: SNAP() })
    const v = await completeReview({ store: sv.store, id: 'q1', before: SNAP(), decidedBy: BY, now: NOW2, ...DRAFT })
    check('🟢 🔴 **정상 스냅샷이면 검토 완료된다**', v.ok, v.ok ? '' : v.reason)
    check('🔴 도장이 decidedBy·decidedAt 둘 다 커밋됐다',
      sv.committed()?.decidedBy === BY && sv.committed()?.decidedAt?.getTime() === NOW2.getTime())
  }

  // ⓑ 본문·제목·상태·provenance 가 바뀌면 write 0
  for (const [label, patch] of [
    ['본문', { body: '누가 바꿨다' }],
    ['제목', { title: '누가 바꿨다' }],
    ['상태', { status: 'PUBLISHED' }],
    ['provenance(promptVersion)', { promptVersion: 'other' }],
    ['provenance(model)', { model: 'other' }],
    ['발행됨(createdPostId)', { createdPostId: 'post-1' }],
  ] as const) {
    const sv = store({ row: SNAP(patch) })
    const v = await completeReview({ store: sv.store, id: 'q1', before: SNAP(), decidedBy: BY, now: NOW2, ...DRAFT })
    check(`🔴 🔴 **${label} 가 바뀌면 write 0**`,
      !v.ok && v.code === 'snapshotChanged' && sv.committed()?.decidedBy === null,
      v.ok ? 'ok 였다' : `${v.code} · decidedBy=${String(sv.committed()?.decidedBy)}`)
  }

  // ⓒ 조건 불일치 → founder 표식 0
  {
    const sv = store({ row: SNAP(), stampCount: 0 })
    const v = await completeReview({ store: sv.store, id: 'q1', before: SNAP(), decidedBy: BY, now: NOW2, ...DRAFT })
    check('🔴 🔴 **조건부 기록이 0건이면 도장 0**',
      !v.ok && v.code === 'conditionMissed' && sv.committed()?.decidedBy === null)
  }
  // ⓒ-2 사후 오류(쓴 뒤 대조 어긋남) → 되돌린다
  {
    const sv = store({
      row: SNAP(),
      after: (st) => (st === null ? null : { ...st, body: '쓴 뒤 누가 바꿨다' }),
    })
    const v = await completeReview({ store: sv.store, id: 'q1', before: SNAP(), decidedBy: BY, now: NOW2, ...DRAFT })
    check('🔴 🔴 **쓴 뒤 대조가 어긋나면 되돌린다 — 도장 0**',
      !v.ok && v.code === 'verifyFailed' && sv.committed()?.decidedBy === null,
      v.ok ? 'ok 였다' : `${v.code} · decidedBy=${String(sv.committed()?.decidedBy)}`)
  }
  {
    const sv = store({ row: SNAP(), after: (st) => (st === null ? null : { ...st, decidedBy: null }) })
    const v = await completeReview({ store: sv.store, id: 'q1', before: SNAP(), decidedBy: BY, now: NOW2, ...DRAFT })
    check('🔴 도장이 남지 않았으면 되돌린다',
      !v.ok && v.code === 'stampMissing' && sv.committed()?.decidedBy === null)
  }
  {
    // 🔴 표시는 맞는데 **시각**이 다르다 = 다른 write 가 끼어들었다
    const sv = store({
      row: SNAP(),
      after: (st) => (st === null ? null : { ...st, decidedAt: new Date('2026-09-20T13:00:00Z') }),
    })
    const v = await completeReview({ store: sv.store, id: 'q1', before: SNAP(), decidedBy: BY, now: NOW2, ...DRAFT })
    check('🔴 🔴 **도장 시각이 내가 찍은 값이 아니면 되돌린다**',
      !v.ok && v.code === 'stampMissing'
      && sv.committed()?.decidedBy === null && sv.committed()?.decidedAt === null,
      v.ok ? 'ok 였다' : v.code)
  }
  {
    const sv = store({ row: null })
    const v = await completeReview({ store: sv.store, id: 'q1', before: SNAP(), decidedBy: BY, now: NOW2, ...DRAFT })
    check('🔴 행이 없으면 검토 완료하지 않는다', !v.ok && v.code === 'notFound')
  }

  // ⓓ EDITED 정상 수정본은 계속 검토 가능
  {
    /** 🔴 스냅샷의 `title`/`body` 는 **수정본**이다 — 사람이 그것을 읽고 승인한다 */
    const edited = SNAP({ title: '사람이 고친 제목', body: '사람이 고친 본문' })
    const sv = store({ row: edited })
    const v = await completeReview({ store: sv.store, id: 'q1', before: edited, decidedBy: BY, now: NOW2, ...DRAFT })
    check('🟢 🔴 **EDITED 정상 수정본도 검토 완료된다**', v.ok && sv.committed()?.decidedBy === BY,
      v.ok ? '' : v.reason)
  }

  // ─────────────────────────────────────────────────────────
  // ⓔ 🔴 🔴 네 가지 결정 — APPROVED 기계 후보를 사람이 끝낼 수 있다 (2026-09-21)
  // ─────────────────────────────────────────────────────────
  /** 🔴 원천 35038242 와 같은 모양 — 첫 문장만 고쳐야 하는 글이다 */
  const REAL_TITLE = '친정엄마나 시어머니랑 매일 통화하시나요?'
  const REAL_DRAFT = [
    '딸들은 친정엄마랑 가까이 살아도 매일 통화하곤 하잖아요.',
    '',
    '아는 분 남편은 외아들이라 그런지 어머니랑 매일 통화를 한다고 하네요.',
    '그렇게 매일 할 말이 많을까 싶기도 하고.. 저는 좀 싫을 것 같다는 생각도 드네요.',
    '',
    '보통 남편분들이 어머니랑 매일 통화하는 경우가 잘 없지 않나요? 다들 어떠신지 궁금합니다.',
  ].join('\n')
  const REAL_FIXED = REAL_DRAFT.replace(
    '딸들은 친정엄마랑 가까이 살아도 매일 통화하곤 하잖아요.',
    '딸들은 친정엄마가 가까이 살아도 매일 통화하는 편인가요?',
  )
  const REAL = { draftTitle: REAL_TITLE, draftBody: REAL_DRAFT }
  const REAL_SNAP = (o: Partial<ReviewRow> = {}): ReviewRow =>
    SNAP({ title: REAL_TITLE, body: REAL_DRAFT, ...o })
  const passGate: ReviewGate = () => ({ ok: true, reason: '' })
  const blockGate: ReviewGate = () => ({ ok: false, reason: 'BLOCK — SOURCE_ECHO' })
  const NOTE = '원문이 질문한 것을 사실처럼 단정한 첫 문장만 바로잡았다'

  check('🔴 결정은 넷이다', REVIEW_DECISIONS.join(',') === 'ready,edit,reject,hold')
  check('🔴 🔴 **새 상태를 만들지 않았다** — 전부 기존 정본 상태다',
    REVIEW_DECISIONS.every((d) =>
      (ORIGINAL_POST_STATUSES as readonly string[]).includes(REVIEW_DECISION_STATUS[d])))
  check('🔴 🔴 **발행 가능한 결정은 둘뿐이다**',
    PUBLISHABLE_DECISIONS.join(',') === 'ready,edit')

  // ① 수정 없이 READY
  {
    const sv = store({ row: REAL_SNAP() })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision: 'ready', gate: blockGate,
    })
    const c = sv.committed()
    check('🟢 🔴 **수정 없이 READY 된다** — 게이트를 부르지도 않는다',
      v.ok && c?.status === 'APPROVED' && c.decidedBy === BY && c.body === REAL_DRAFT,
      v.ok ? '' : v.reason)
  }

  // ② APPROVED 기계 후보를 고쳐서 READY — 한 트랜잭션
  {
    const sv = store({ row: REAL_SNAP() })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision: 'edit', gate: passGate,
      edit: { title: REAL_TITLE, body: REAL_FIXED, note: NOTE },
    })
    const c = sv.committed()
    check('🟢 🔴 **APPROVED 기계 후보를 수정 후 READY 할 수 있다**',
      v.ok && c?.status === 'EDITED' && c.decidedBy === BY && c.body === REAL_FIXED,
      v.ok ? `${String(c?.status)}` : v.reason)
    check('🔴 🔴 **고친 문안이 발행 문안이 된다**', c?.body === REAL_FIXED && c.title === REAL_TITLE)
    check('🔴 🔴 **최초 초안은 그대로 남는다** — diff 의 기준이다',
      REAL.draftBody === REAL_DRAFT && REAL_FIXED !== REAL_DRAFT)
  }

  // ② 수정 전후 diff 보존
  {
    const patch = reviewPatchOf({
      decision: 'edit', draftTitle: REAL_TITLE, draftBody: REAL_DRAFT,
      edit: { title: REAL_TITLE, body: REAL_FIXED, note: NOTE }, declineReason: null,
    })
    const d = patch.editDiff as Record<string, unknown>
    check('🔴 🔴 **diff 가 남는다 — 무엇이 얼마나 바뀌었나와 왜**',
      patch.status === 'EDITED' && d.titleChanged === false && d.bodyChanged === true
      && d.bodyCharsBefore === REAL_DRAFT.length && d.bodyCharsAfter === REAL_FIXED.length
      && d.note === NOTE)
    check('🔴 🔴 **diff 에 본문을 담지 않는다** — 수정본은 editedBody 한 곳뿐',
      !JSON.stringify(d).includes('친정엄마'))
  }

  // ③ 수정본이 게이트를 통과하지 못하면 READY 불가 · write 0
  {
    const sv = store({ row: REAL_SNAP() })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision: 'edit', gate: blockGate,
      edit: { title: REAL_TITLE, body: REAL_FIXED, note: NOTE },
    })
    check('🔴 🔴 **수정본이 발행 기준에 걸리면 READY 불가 · write 0**',
      !v.ok && v.code === 'gateFailed'
      && sv.committed()?.decidedBy === null && sv.committed()?.status === 'APPROVED',
      v.ok ? 'ok 였다' : v.code)
  }
  {
    const sv = store({ row: REAL_SNAP() })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision: 'edit', gate: passGate,
      edit: { title: REAL_TITLE, body: REAL_DRAFT, note: NOTE },
    })
    check('🔴 고친 것이 없으면 edit 이 아니다 · write 0',
      !v.ok && v.code === 'editUnchanged' && sv.committed()?.decidedBy === null)
  }
  {
    const sv = store({ row: REAL_SNAP() })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision: 'edit', gate: passGate,
      edit: { title: REAL_TITLE, body: REAL_FIXED, note: '   ' },
    })
    check('🔴 왜 고쳤는지 없으면 쓰지 않는다', !v.ok && v.code === 'editMissing')
  }

  // ④ REJECT · HOLD — 발행 불가 상태로 간다
  for (const [decision, want] of [['reject', 'DECLINED'], ['hold', 'PENDING']] as const) {
    const sv = store({ row: REAL_SNAP() })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision, declineReason: decision === 'reject' ? 'TOPIC_UNFIT' : null,
    })
    const c = sv.committed()
    check(`🔴 🔴 **${decision} 는 ${want} 로 간다 — 발행 대상이 아니다**`,
      v.ok && c?.status === want, v.ok ? String(c?.status) : v.reason)
    check(`🔴 ${decision} 뒤에도 본문은 그대로다`, c?.body === REAL_DRAFT)
  }
  {
    const sv = store({ row: REAL_SNAP() })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision: 'reject', declineReason: null,
    })
    check('🔴 폐기 사유가 없으면 쓰지 않는다',
      !v.ok && v.code === 'reasonMissing' && sv.committed()?.status === 'APPROVED')
  }

  // ⑤ 🔴 발행기가 실제로 무엇을 고르는가 — 결정마다 값으로 본다
  {
    const ROW = (o: Partial<AutoRow>): AutoRow => ({
      id: 'q1', status: 'APPROVED', createdPostId: null, gateVerdict: 'PASS',
      promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
      matchedPersonaId: 'p1', title: REAL_TITLE, body: REAL_DRAFT,
      // 🔴 기계 profile 을 **정본 상수로** 만든다 — 값을 손으로 적지 않는다
      sourceSite: `${MACHINE_SITE_PREFIX}navercafe:remonterrace`,
      gateResults: {
        autoDraft: {
          provenance: MACHINE_PROFILE.envelopeProvenance,
          sourceDecision: MACHINE_PROFILE.sourceDecision,
          draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
        },
      },
      decidedBy: 'founder', decidedAt: NOW2, createdAt: NOW2, ...o,
    })
    const pick = (r: AutoRow): { ok: boolean; code: string } => {
      const out = selectAutoTargets([r], () => 'pass')
      return { ok: out.targets.length === 1, code: out.rejected[0]?.code ?? '' }
    }
    check('🔴 🔴 **ready(APPROVED+founder) 는 발행 대상이다**', pick(ROW({})).ok)
    check('🔴 🔴 **edit(EDITED+founder) 도 발행 대상이다**', pick(ROW({ status: 'EDITED' })).ok)
    for (const [d, st] of [['reject', 'DECLINED'], ['hold', 'PENDING']] as const) {
      const got = pick(ROW({ status: st }))
      check(`🔴 🔴 **${d}(${st}) 는 발행되지 않는다**`, !got.ok && got.code === 'STATUS', got.code)
    }
    const unreviewed = pick(ROW({ decidedBy: 'machine:auto-draft-v5' }))
    check('🔴 🔴 **사람이 보지 않은 기계 후보는 발행되지 않는다**',
      !unreviewed.ok && unreviewed.code === 'HUMAN_REVIEW_REQUIRED', unreviewed.code)
  }

  // ⑥ 🔴 stale snapshot — 결정이 무엇이든 전체 rollback
  for (const decision of REVIEW_DECISIONS) {
    const moved = REAL_SNAP({ body: '그 사이 누가 고쳤다' })
    const sv = store({ row: moved })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision, gate: passGate, declineReason: 'TOPIC_UNFIT',
      edit: { title: REAL_TITLE, body: REAL_FIXED, note: NOTE },
    })
    const c = sv.committed()
    check(`🔴 🔴 **${decision}: 스냅샷이 낡았으면 write 0**`,
      !v.ok && v.code === 'snapshotChanged'
      && c?.decidedBy === null && c.status === 'APPROVED' && c.body === '그 사이 누가 고쳤다',
      v.ok ? 'ok 였다' : v.code)
  }
  // 🔴 그 사이 발행됐으면 어떤 결정도 쓰지 않는다
  {
    const sv = store({ row: REAL_SNAP({ createdPostId: 'post1' }) })
    const v = await completeReview({
      store: sv.store, id: 'q1', before: REAL_SNAP(), decidedBy: BY, now: NOW2, ...REAL,
      decision: 'edit', gate: passGate,
      edit: { title: REAL_TITLE, body: REAL_FIXED, note: NOTE },
    })
    check('🔴 🔴 **그 사이 발행됐으면 write 0**',
      !v.ok && v.code === 'snapshotChanged' && sv.committed()?.decidedBy === null)
  }

  // ⑦ 🔴 이 경로는 Queue 한 테이블만 쓴다 — Post 를 만들지 않는다
  check('🔴 🔴 **검토 러너가 Queue 말고 아무것도 쓰지 않는다**', (() => {
    const cli = readFileSync('scripts/original-post-machine-review.mts', 'utf-8')
    const writes = [...cli.matchAll(/(?:prisma|tx)\.([a-zA-Z]+)\.(create|update|updateMany|delete|deleteMany|upsert)/g)]
    return writes.length > 0
      && writes.every((m) => m[1] === 'originalPostApprovalQueue')
  })())
  check('🔴 🔴 **결정이 건드리지 않는 칸** — 최초 초안·게이트 결과·판·모델', (() => {
    const src = readFileSync('src/lib/original-post-machine-review.ts', 'utf-8')
    const i = src.indexOf('export type ReviewPatch')
    const block = src.slice(i, src.indexOf('\n}', i))
    return !/draftTitle|draftBody|gateResults|promptVersion|model|createdPostId/.test(block)
  })())

  // ⑧ 🔴 🔴 실제 CLI — 모르는 결정·빠진 인자는 DB 를 열기 전에 멈춘다
  {
    const cli = (args: readonly string[]): { code: number | null; out: string } => {
      const r = spawnSync('npx', ['tsx', 'scripts/original-post-machine-review.mts', ...args], {
        encoding: 'utf-8', cwd: process.cwd(),
        // 🔴 DB 주소를 주지 않는다 — 열기 전에 멈추는지 보는 검사다
        env: { ...process.env, DATABASE_URL: '' },
      })
      return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    }
    const bad = cli(['--id', 'x', '--apply', '--limit=1', '--decision=뭔가'])
    check('🔴 🔴 **모르는 결정은 DB 를 열기 전에 멈춘다**',
      bad.code === 1 && bad.out.includes('모르는 결정')
      && !bad.out.includes('DATABASE_URL'), bad.out.slice(-200))
    check('🔴 쓸 수 있는 값을 알려 준다',
      REVIEW_DECISIONS.every((d) => bad.out.includes(d)))
  }

  // ⑨ 🔴 🔴 ② 재현 — 그 수정본이 실제 발행 게이트를 통과하는가
  {
    const src = {
      rawTitle: '친정엄마랑 매일 통화하시나요? 아는 지인 남편이 매일 시모랑 통화한대요',
      rawBody: [
        '딸은 가까이 살아도 매일 통화할거같은데 어떤가요?',
        '',
        '지인 남편이 매일 시모랑 통화하는데 그렇게 할말이 많나요? 외아들이라 시모랑 친한가봐요',
        '',
        '근데 전 싫을거같아요',
        '',
        '남편들은 매일 시모랑 통화하는분 없을거같은데 어때요?',
      ].join('\n'),
    }
    /** 🔴 운영 러너가 쓰는 그 경로다 — 여기서 규칙을 새로 만들지 않는다 */
    const gateOf = (t: { title: string; body: string }): string => {
      const profile = readSourceProfile(src)
      const signals = analyzeDraft({
        title: t.title, body: t.body, sourceTexts: [src.rawTitle, src.rawBody],
        allowedContentUrl: profile.contentReferenceUrl,
        closingIntent: profile.closingIntent,
        allowNumberedList: profile.preserveStructure.numberedList,
      })
      const must = mustKeepDetails(profile.concreteDetailsToKeep)
      const both = `${t.title}\n${t.body}`
      return gateDraft({
        signals, closingIntent: profile.closingIntent,
        sourceBodyLength: [...src.rawBody].length,
        mustKeepTotal: must.length,
        mustKeepFound: must.filter((x) => both.includes(x.sample)).length,
      }).verdict
    }
    /**
     * 🔴 **기계 초안 자체가 이 게이트로는 HOLD 다** — 기계 경로는 Content Core 의
     *    제 검수를 쓰고 이 게이트를 지나지 않는다. 그래서 수정본에만 `PASS` 를 요구하면
     *    고쳐야 할 글일수록 고칠 수 없게 된다. 막는 것은 `BLOCK` 하나다.
     */
    check('🔴 🔴 **최초 초안도 이 게이트로는 PASS 가 아니다** — 실측',
      gateOf({ title: REAL_TITLE, body: REAL_DRAFT }) === 'HOLD',
      gateOf({ title: REAL_TITLE, body: REAL_DRAFT }))
    check('🔴 🔴 **지정된 수정본은 BLOCK 이 아니다 — 저장할 수 있다**',
      gateOf({ title: REAL_TITLE, body: REAL_FIXED }) !== 'BLOCK',
      gateOf({ title: REAL_TITLE, body: REAL_FIXED }))
    const echoed = gateOf({ title: REAL_TITLE, body: src.rawBody })
    check('🔴 🔴 **원문을 그대로 넣으면 BLOCK 이다** — 게이트가 실제로 일한다',
      echoed === 'BLOCK', echoed)
  }

  // 🔴 운영 러너가 이 경계를 실제로 쓴다
  check('🔴 🔴 **운영 검토 러너가 네 결정을 실제로 배선한다**', (() => {
    const cli = readFileSync('scripts/original-post-machine-review.mts', 'utf-8')
    return /--decision=/.test(cli) && /--edited-file=/.test(cli) && /--reason=/.test(cli)
      && /gate: reGate/.test(cli) && /gateDraft\(\{/.test(cli)
      // 🔴 저장 금지 계약은 그대로 — BLOCK 이면 쓰지 않는다
      && /g\.verdict === 'BLOCK'/.test(cli)
  })())
  check('🔴 🔴 **운영 검토 러너가 completeReview 를 쓴다 — 도장 먼저 찍지 않는다**', (() => {
    const cli = readFileSync('scripts/original-post-machine-review.mts', 'utf-8')
    return /await completeReview\(\{/.test(cli)
      && /prisma\.\$transaction/.test(cli)
      // 🔴 트랜잭션 밖에서 도장을 찍는 updateMany 가 남아 있지 않다
      && (cli.match(/updateMany\(\{/g) ?? []).length === 1
  })())
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 🔴 🔴 정산 집계 — 실제 유료 요청 1건으로 숫자를 읽는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **소스 정규식으로 보지 않는다.** "집계 줄이 `clearOpen` 아래에 있다" 는 검사는
   *    줄이 함께 옮겨지면 늘 통과한다. 여기서는 가짜 provider 로 **요청을 실제로 보내고**
   *    끝난 뒤 회차 집계 숫자를 그대로 읽는다.
   */
  const probeDir = mkdtempSync(join(tmpdir(), 'chain-e2e-tally-'))
  const probe = (mode: 'ok' | 'settle-fail', env: Record<string, string> = {}): {
    paid: number; settledUsd: number; usageUnknown: number; settleHeld: number
    settlementRecorded: boolean; errorCode: string | null; usageKnown: boolean; ok: boolean
  } => {
    const r = spawnSync(
      join(process.cwd(), 'node_modules/.bin/tsx'),
      [join(process.cwd(), 'scripts/lib/settle-tally-probe.mts'),
        join(probeDir, `${mode}-${Object.keys(env).join('-')}`), mode],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: 'fixture-fake-key', GEMINI_API_KEY: 'fixture-fake-gemini-key',
          NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
          ...env,
        },
      },
    )
    const line = (r.stdout ?? '').trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? ''
    if (line === '') throw new Error(`탐침이 값을 내지 않았다 — ${r.stdout ?? ''}${r.stderr ?? ''}`)
    return JSON.parse(line)
  }

  // 🟢 정상: 줄이 적혔으니 금액이 집계에 오른다
  const okRun = probe('ok')
  check('🟢 정상 정산이면 금액이 집계에 오른다',
    okRun.settlementRecorded && okRun.paid === 1 && okRun.settledUsd > 0
    && okRun.usageUnknown === 0 && okRun.settleHeld === 0)

  // 🔴 사용량은 알지만 **정산 줄만** 못 적은 경우
  const sf = probe('settle-fail')
  check('🔴 🔴 **기록이 실패하면 settledUsd 가 0 이다** — 쓰지 않은 돈을 세지 않는다',
    sf.usageKnown && sf.settledUsd === 0)
  check('🔴 🔴 **사용량을 아는데 기록만 실패하면 usageUnknown 은 0 이다**',
    sf.usageUnknown === 0)
  check('🔴 🔴 **그 대신 settleHeld 가 1 이다** — 원인이 다른 두 가지를 한 칸에 담지 않는다',
    sf.settleHeld === 1)
  check('🔴 부르는 쪽은 완주 실패로 받는다',
    !sf.ok && !sf.settlementRecorded && sf.errorCode === 'SETTLE_NOT_RECORDED')

  // 🔴 사용량을 진짜 모르는 응답은 **정확히 한 번만** 센다
  const nu = probe('ok', { FAKE_PROVIDER_MODE: 'no-usage' })
  check('🔴 🔴 **사용량 미상 응답은 정확히 1건으로 센다** (두 번 세지 않는다)',
    !nu.usageKnown && nu.usageUnknown === 1 && nu.settleHeld === 0 && nu.settledUsd === 0)
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 다 — 실제 모델이 쓸 만한 글을 쓰는지는 증명하지 않았다.')
if (fail > 0) process.exit(1)
