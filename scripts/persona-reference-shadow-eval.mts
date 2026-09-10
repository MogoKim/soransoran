#!/usr/bin/env tsx
/**
 * 고정 배정 Persona **shadow eval** — 🔴 확정 모델만 · DB write 0 · 발행 0
 *
 *   npx tsx scripts/persona-reference-shadow-eval.mts           dry-run (호출 0)
 *   npx tsx scripts/persona-reference-shadow-eval.mts --call    🔴 실제 호출
 *   npx tsx scripts/persona-reference-shadow-eval.mts --report  저장 artifact 를 읽어 보고
 *
 * 🔴 **production Persona 정본을 읽는다** (2026-09-10 정정).
 *    앞선 판은 `voiceCore` · `lifeStage` · `identity` 를 인덱스로 **합성**했다 —
 *    그러면 실제 Queue 가 쓰는 설정을 검증한 것이 아니다.
 *    이제 Queue 와 **같은 DB 경로**(`makeDbTargetSource().personas()`)로 읽는다.
 *    합성하는 것은 **게시글뿐**이고, 실제 회원 글은 외부로 나가지 않는다.
 *
 * 🔴 **raw 와 judgement 를 나눈다.**
 *    · raw        provider 원문. 한 번 쓰면 바뀌지 않는다
 *    · judgement  Gate 재판정. 보고는 **이것을 다시 읽어** 출력한다
 *    콘솔에서 다시 센 숫자를 완료 증거로 쓰지 않는다 —
 *    앞선 회차에서 저장값(statusPass 18/18)과 보고값(8/18)이 갈렸다.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  buildCommentInput, voiceEvidenceFromAssets, type CommentInput,
} from '../src/lib/persona-comment-input'
import { buildPromptFromInput, toGateInput } from './lib/persona-comment-bridge'
import { checkCommentCandidate } from './lib/persona-comment-candidate.mjs'
import {
  allocateRolesByCorpus, loadCanonAsset, stableAssignment,
} from './lib/persona-reference-store.mjs'
import { judgeExperienceGrounding } from '../src/lib/persona-experience-grounding'
import { judgeVoiceSeparation } from '../src/lib/persona-voice-reference'
import { postBodyOf, SYNTHETIC_POSTS } from '../src/lib/persona-eval-posts'
import { COMMENT_REACTION_ROLES } from '../src/lib/persona-reaction-roles'
import { PRODUCTION_PERSONA_CODES } from '../src/lib/persona-cohort'
import { readConfirmedSelection } from '../src/lib/persona-comment-provenance'
import { estimateCost, judgeSpend, type ModelPrice } from '../src/lib/persona-comment-cost'
import {
  EVALUATOR_VERSION, summarize, verifyJudgement,
  type JudgedRow, type JudgementArtifact, type RawArtifact, type RawRow,
} from '../src/lib/persona-shadow-artifact'
import { makeDbTargetSource } from './lib/persona-comment-source-db'
import { M3_MODEL_CANDIDATES } from './lib/voice-m3-contract.mjs'
import { callProvider, keyStatus, type ProviderModel } from './lib/voice-m3-provider.mjs'
import { parseCandidate } from './lib/persona-prompt'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const WANT_CALL = process.argv.includes('--call')
const WANT_REPORT = process.argv.includes('--report')
/**
 * 🔴 **이번 회차 승인치 — 수와 대상을 둘 다 못박는다** (2026-09-10, 창업자 (a) 선택).
 *
 *    앞선 승인은 "18회" 였다. 그런데 실제로 부를 수 있는 것은 14명이었고,
 *    수만 맞추려 들면 **누구를 불렀는지가 흐려진다** — 다음 회차에 다른 4명이
 *    빠지고 다른 4명이 들어와도 14는 14다.
 *    그래서 수와 함께 **대상 P 코드**를 고정한다. 명단이 다르면 부르지 않는다.
 */
const APPROVED_CALL_CODES: readonly string[] = Object.freeze([
  'P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P08',
  'P11', 'P12', 'P13', 'P14', 'P16', 'P18', 'P19',
])
/**
 * 🔴 **막힌 채로 두기로 한 4명.** DB 를 고치지 않는다 —
 *    `lifeStage` 를 채우는 것은 DB write 이고, 이번 승인 범위 밖이다.
 *    이 4명이 갑자기 통과하면 그것은 **DB 가 바뀌었다는 뜻**이므로 멈춘다.
 */
const BLOCKED_CODES: readonly string[] = Object.freeze(['P07', 'P10', 'P15', 'P17'])
const RUN_MAX_CALLS = APPROVED_CALL_CODES.length
const RUN_MAX_USD = 0.06
const TIMEOUT_MS = 60_000
const OUT = 'tmp/persona-reference-shadow'

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16)
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

// ─────────────────────────────────────────────────────────
// --report : 🔴 저장된 judgement 를 **다시 읽어** 출력한다
// ─────────────────────────────────────────────────────────
if (WANT_REPORT) {
  const files = existsSync(OUT)
    ? readdirSync(OUT).filter((f) => f.endsWith('.judgement.json')).sort()
    : []
  if (files.length === 0) fail(`judgement artifact 가 없다 — ${OUT}`)
  const path = join(OUT, files[files.length - 1]!)
  const j = JSON.parse(readFileSync(path, 'utf-8')) as JudgementArtifact
  const rawPath = path.replace('.judgement.json', '.raw.json')
  const v = verifyJudgement({
    judgement: j,
    actualRawSha: existsSync(rawPath) ? sha16(readFileSync(rawPath, 'utf-8')) : undefined,
  })
  console.log('\n══ shadow eval 보고 (🔴 저장 artifact 에서 읽는다) ══\n')
  console.log(`  judgement  ${path}`)
  console.log(`  raw        ${rawPath}`)
  console.log(`  판정 판    ${j.evaluatorVersion} · rawSha ${j.rawSha} · inputDigest ${j.inputDigest}`)
  if (!v.ok) {
    for (const b of v.blocks) console.error(`  🔴 [${b.code}] ${b.message}`)
    fail('저장 artifact 가 스스로 모순이다')
  }
  console.log('  ✅ 저장 집계와 저장 행이 일치한다\n')
  const rawRows = existsSync(rawPath)
    ? (JSON.parse(readFileSync(rawPath, 'utf-8')) as RawArtifact).rows
    : []
  for (const r of j.rows) {
    const text = rawRows.find((x) => x.personaCode === r.personaCode)?.text ?? null
    console.log(`${r.personaCode} ${r.role.padEnd(9)} ${r.postId} 근거 ${r.bundleComments}건`
      + ` · ${String(r.textLength).padStart(3)}자 · gate ${r.gateStatus ?? '-'}`
      + ` · 근거없는경험 ${r.ungrounded}`)
    console.log(`   ${(text ?? '🔴 생성 실패').replace(/\n/g, ' / ')}`)
  }
  const s = j.summary
  console.log(`\n  statusPass ${s.statusPass}/${s.rows} · fullGatePass ${s.fullGatePass}/${s.rows}`
    + ` · 근거 없는 자기 경험 ${s.ungroundedTotal}/${s.rows}`)
  console.log('  Gate:')
  for (const k of ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']) {
    console.log(`    ${k} ${JSON.stringify(s.gateTally[k] ?? {})}`)
  }
  /**
   * 🔴 **무엇 사이의 거리인지 적는다.** 이 값은 **reference 묶음 18개** 사이의
   *    거리다 — 이번에 생성된 댓글 14건 사이가 아니다.
   *    그래서 가장 가까운 짝에 이번에 부르지 않은 P10 이 나올 수 있다.
   *    적지 않으면 "생성 결과가 그만큼 구분된다" 로 잘못 읽힌다.
   */
  console.log(`  문체 최소거리 ${s.minStyleDistance.toFixed(3)} (${s.closestPair})`
    + ' — 🔴 reference 묶음 사이 · 생성 댓글 사이가 아니다')
  console.log(`  Persona 설정 출처  ${j.rows[0]?.personaSource ?? '(없음)'}\n`)
  process.exit(0)
}

await loadEnvLocal()
console.log('\n══ 고정 배정 Persona shadow eval (🔴 DB write 0 · Queue 0 · 발행 0) ══\n')
console.log(`  모드  ${WANT_CALL ? '🔴 --call (실제 호출)' : 'dry-run (호출 0 · 비용 0)'}`)

const confirmed = readConfirmedSelection()
if (confirmed.selection?.status !== 'confirmed' || confirmed.selection.winner === null) {
  fail(`확정 모델이 없다 — ${confirmed.detail}`)
}
const MODEL: string = confirmed.selection?.winner ?? fail('확정 모델 이름을 읽지 못했다')
console.log(`  확정 모델  ${MODEL} (회차 ${confirmed.canon?.runId})`)

// ── 고정 배정 ──
const assign = stableAssignment({ repoRoot: process.cwd() })
const ready = PRODUCTION_PERSONA_CODES.filter((c) => assign.byCode.has(c))
const missing = PRODUCTION_PERSONA_CODES.filter((c) => !assign.byCode.has(c))
console.log(`\n  정본 ${PRODUCTION_PERSONA_CODES.length}명 · 준비 ${ready.length}명 · 차단 ${missing.length}명`)
console.log(`     준비 ${ready.join(' ')}`)
console.log(`     차단 ${missing.join(' ') || '없음'}`)


// ── 🔴 production Persona 정본을 Queue 와 같은 경로로 읽는다 ──
const prisma = new PrismaClient()
const source = makeDbTargetSource({ prisma, windowStart: new Date(0) })
const allPersonas = await source.personas()
await prisma.$disconnect()
const byCode = new Map(allPersonas.map((p) => [p.code, p]))
console.log(`\n  production Persona 정본 ${allPersonas.length}명 (Queue 와 같은 경로 · DB read-only)`)
const missingInDb = ready.filter((c) => !byCode.has(c))
if (missingInDb.length > 0) fail(`DB 에 없는 P코드 — ${missingInDb.join(' ')}`)

// ── 단가·상한 ──
const price: ModelPrice = ((): ModelPrice => {
  const table = M3_MODEL_CANDIDATES as Record<string, {
    apiModelId: string; inputPerMTok: number; outputPerMTok: number; source: string; checkedAt: string
  }>
  const c = table[MODEL]
  if (c === undefined) return fail(`단가 정본에 ${MODEL} 이 없다`)
  return {
    label: MODEL, apiModelId: c.apiModelId,
    inputPerMTok: c.inputPerMTok, outputPerMTok: c.outputPerMTok,
    source: c.source, checkedAt: c.checkedAt,
  }
})()
const key = keyStatus(MODEL as ProviderModel)
/**
 * 🔴 **여기서는 상계만 본다.** 실제 상한 판정은 payload 를 다 만든 **뒤**에 한다 —
 *    앞선 판은 `ready.length`(=18) 로 비용을 재고 상한 14 에 걸려 멈췄다.
 *    18 은 "묶음이 선 사람 수" 이지 "부를 사람 수" 가 아니다.
 *    쓰지도 않을 호출로 상한을 계산하면, 실제로는 14회인 회차가 부당하게 막힌다.
 */
const upper = estimateCost({ price, calls: ready.length })
console.log(`  상계 ${ready.length}회 · ${upper.ok ? `$${upper.estimate.usd}` : upper.reason}`
  + ' (🔴 실제 판정은 payload 확정 후)')
console.log(`  key ${key.envName} ${key.present ? '있음' : '🔴 없음'}`)

// ── 역할 배정 ──
const ELIGIBLE = COMMENT_REACTION_ROLES.filter((r) => r !== 'experience')
const rolePlan = allocateRolesByCorpus({
  rows: loadCanonAsset().rows, roles: ELIGIBLE, count: ready.length,
})
console.log('\n  역할 배정 (실제 코퍼스 근거)')
for (const d of rolePlan.distribution) {
  console.log(`     ${d.role.padEnd(10)} 코퍼스 ${String(d.corpusPct).padStart(5)}% → ${d.assigned}건`)
}

// ── 입력 ──
type Job = {
  code: string; role: string; postId: string; system: string; user: string
  sourceTexts: string[]; input: CommentInput; bundleComments: number
}
const jobs: Job[] = []
/** 🔴 정본 설정으로 입력이 서지 않은 Persona */
const inputFailed: { code: string; codes: string[] }[] = []
for (const [i, code] of ready.entries()) {
  const p = byCode.get(code)!
  const sp = SYNTHETIC_POSTS[i % SYNTHETIC_POSTS.length]!
  const built = buildCommentInput({
    /** 🔴 **DB 정본 그대로.** 인덱스로 만들어 낸 값이 하나도 없다 */
    persona: {
      code: p.code, ageBand: p.ageBand, region: p.region, lifeStage: p.lifeStage,
      identity: p.identity, voiceCore: p.voiceCore, voiceVariations: p.voiceVariations,
      noGoTopics: p.noGoTopics, noGoExpressions: p.noGoExpressions,
      forbiddenReactionRoles: p.forbiddenReactionRoles,
    },
    post: {
      id: sp.id, title: sp.title, bodyDigest: postBodyOf(sp),
      boardLabel: sp.boardLabel, existingCommentDigests: [],
    },
    reactionRole: rolePlan.roles[i]!,
    voice: voiceEvidenceFromAssets({
      voiceCore: p.voiceCore as Parameters<typeof voiceEvidenceFromAssets>[0]['voiceCore'],
      voiceVariations: p.voiceVariations as string[],
    }),
    memory: { has: false, note: '' },
  })
  /**
   * 🔴 **정본 설정으로 입력이 서지 않으면 그 Persona 는 준비된 것이 아니다.**
   *    앞선 판은 설정을 합성해서 이 사실을 가렸다 — 실측으로 드러난 것을 모아 보고한다.
   */
  if (!built.ok) {
    inputFailed.push({ code, codes: built.blocks.map((b) => b.code) })
    continue
  }
  const bundle = assign.byCode.get(code)!
  const prompt = buildPromptFromInput(built.input, [], bundle)
  if (!prompt.ok) {
    inputFailed.push({ code, codes: prompt.blocks.map((b) => b.code) })
    continue
  }
  jobs.push({
    code, role: rolePlan.roles[i]!, postId: sp.id,
    system: prompt.prompt.systemPrompt, user: prompt.prompt.userPayload,
    sourceTexts: [sp.title, postBodyOf(sp)],
    input: built.input, bundleComments: bundle.comments.length,
  })
}
if (inputFailed.length > 0) {
  console.log(`\n  🔴 정본 설정으로 입력이 서지 않은 Persona ${inputFailed.length}명`)
  for (const f of inputFailed) console.log(`     ${f.code} — ${f.codes.join(' · ')}`)
}

/** 🔴 무엇을 넣어 만든 결과인지 남긴다 */
const inputDigest = sha16(JSON.stringify(jobs.map((j) => [j.code, j.role, j.postId, j.system, j.user])))
console.log(`\n  payload ${jobs.length}건 · inputDigest ${inputDigest} (🔴 실제 회원 원문 0)`)

/**
 * 🔴 **실제로 부를 수 있는 수가 승인치와 다르면 부르기 전에 멈춘다.**
 *
 *    "bundle 이 섰다" 와 "production 설정으로 입력이 선다" 는 다르다.
 *    앞선 판은 Persona 설정을 합성해서 그 차이를 가렸다 —
 *    실측하니 4명은 DB 에 `lifeStage` 가 없어 Queue 경로로는 입력이 서지 않는다.
 *    승인은 "18회" 이지 "몇 명이든" 이 아니다.
 */
const jobCodes = jobs.map((j) => j.code).sort()
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])
if (WANT_CALL && !sameSet(jobCodes, [...APPROVED_CALL_CODES].sort())) {
  console.error(`\n🔴 중단: 부를 대상이 승인 명단과 다르다.`)
  console.error(`   승인 ${APPROVED_CALL_CODES.length}명  ${[...APPROVED_CALL_CODES].sort().join(' ')}`)
  console.error(`   지금 ${jobCodes.length}명  ${jobCodes.join(' ')}`)
  console.error(`   bundle 성립 ${ready.length}명 · production 입력 실패 ${inputFailed.length}명`)
  console.error('   호출 전에 멈춘다. 명단이 바뀌었으면 승인부터 다시 받는다.\n')
  process.exit(1)
}
/**
 * 🔴 **막기로 한 4명이 정말 막혔는가.** 통과해 버렸다면 DB 가 바뀐 것이다 —
 *    "부를 수 있게 됐으니 부른다" 가 아니라 **승인 밖이니 멈춘다.**
 */
if (WANT_CALL) {
  const stillBlocked = BLOCKED_CODES.filter((c) =>
    inputFailed.some((f) => f.code === c && f.codes.includes('PERSONA_LIFESTAGE_MISSING')))
  if (!sameSet(stillBlocked, BLOCKED_CODES)) {
    console.error(`\n🔴 중단: 막아 두기로 한 ${BLOCKED_CODES.join(' ')} 중`
      + ` ${stillBlocked.length}명만 PERSONA_LIFESTAGE_MISSING 이다.`)
    console.error('   DB 가 바뀌었다는 뜻이다. 승인 범위 밖이므로 호출 전에 멈춘다.\n')
    process.exit(1)
  }
  console.log(`\n  🔴 차단 유지 확인  ${BLOCKED_CODES.join(' ')} — 전부 PERSONA_LIFESTAGE_MISSING`)
  console.log(`  ✅ 승인 명단 일치  ${jobCodes.length}명 · 상한 $${RUN_MAX_USD}`)
}

/** 🔴 **실제로 부를 수만큼**으로 상한을 판정한다 */
const est = estimateCost({ price, calls: jobs.length })
const spend = judgeSpend({
  estimates: [est], keysReady: WANT_CALL ? key.present : null,
  maxCalls: RUN_MAX_CALLS, maxUsd: RUN_MAX_USD,
})
console.log(`  상한 판정  ${jobs.length}회 · ${est.ok ? `$${est.estimate.usd}` : est.reason}`
  + ` — ${spend.reason}`)

if (!WANT_CALL) {
  console.log('\n🟡 dry-run 이다. 호출 0 · 비용 0.')
  console.log('   실제로 부르려면 --call · 저장 결과를 보려면 --report\n')
  process.exit(0)
}
if (!spend.allowed) fail(spend.reason)

// ── 🔴 호출 → raw ──
const rawRows: RawRow[] = []
let usd = 0
for (const j of jobs) {
  const t0 = Date.now()
  const res = await callProvider({
    model: MODEL as ProviderModel, systemPrompt: j.system, userPayload: j.user,
    maxOutputTokens: 800, timeoutMs: TIMEOUT_MS,
  })
  usd += (res.inputTokens / 1_000_000) * price.inputPerMTok
    + (res.outputTokens / 1_000_000) * price.outputPerMTok
  const parsed = res.ok ? parseCandidate(res.rawText) : null
  rawRows.push({
    personaCode: j.code, role: j.role, postId: j.postId,
    text: parsed?.ok === true ? parsed.text : null,
    ok: res.ok, errorCode: res.ok ? null : (res.errorCode ?? 'UNKNOWN'),
    latencyMs: Date.now() - t0,
    inputTokens: res.inputTokens, outputTokens: res.outputTokens,
  })
  console.log(`  ${j.code} ${j.role.padEnd(9)} ${parsed?.ok === true ? `${[...parsed.text].length}자` : '🔴 실패'}`)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
mkdirSync(OUT, { recursive: true })
const raw: RawArtifact = {
  kind: 'raw', runId: stamp, model: MODEL, canonRunId: confirmed.canon?.runId ?? '(미상)',
  ranAt: new Date().toISOString(), inputDigest,
  actualUsd: Math.round(usd * 1_000_000) / 1_000_000,
  rows: rawRows,
}
const rawPath = join(OUT, `${stamp}.raw.json`)
/** 🔴 raw 는 불변이다 — 이미 있으면 덮어쓰지 않는다 */
if (existsSync(rawPath)) fail(`raw artifact 가 이미 있다 — 덮어쓰지 않는다 (${rawPath})`)
writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf-8')
const rawSha = sha16(readFileSync(rawPath, 'utf-8'))
console.log(`\n  raw 기록  ${rawPath} · sha ${rawSha}`)

// ── 🔴 판정 → judgement ──
const judged: JudgedRow[] = []
for (const j of jobs) {
  const text = rawRows.find((x) => x.personaCode === j.code)?.text ?? null
  const gate = text === null ? null : checkCommentCandidate(toGateInput({
    input: j.input, text, sourceTexts: j.sourceTexts,
    frequencyLookup: () => 0, knownNames: [],
  }))
  const g = judgeExperienceGrounding({ text: text ?? '', grounding: '' })
  judged.push({
    personaCode: j.code, role: j.role, postId: j.postId,
    personaSource: 'DB production Persona 정본 (Queue 와 같은 경로)',
    bundleComments: j.bundleComments,
    textLength: text === null ? 0 : [...text].length,
    gateStatus: gate?.status ?? null,
    statusPass: gate?.status === 'pass',
    fullGatePass: (gate?.gates.filter((x) => x.outcome === 'pass').length ?? 0) === 9,
    gateLines: gate?.gates.map((x) => ({ gate: x.gate, outcome: x.outcome })) ?? [],
    notRunGates: gate?.gates.filter((x) => x.outcome === 'notRun').map((x) => x.gate) ?? [],
    ungrounded: g.ungrounded.length,
    ungroundedSentences: g.ungrounded.map((c) => c.sentence),
  })
}
const sep = judgeVoiceSeparation(ready.map((c) => assign.byCode.get(c)!))
const judgement: JudgementArtifact = {
  kind: 'judgement', evaluatorVersion: EVALUATOR_VERSION, runId: stamp,
  judgedAt: new Date().toISOString(), rawSha, inputDigest,
  rows: judged,
  summary: summarize({
    rows: judged, minStyleDistance: sep.minDistance, closestPair: sep.closestPair,
  }),
}
const jPath = join(OUT, `${stamp}.judgement.json`)
writeFileSync(jPath, `${JSON.stringify(judgement, null, 2)}\n`, 'utf-8')

/** 🔴 쓴 것을 다시 읽어 스스로 모순이 아닌지 본다 */
const back = JSON.parse(readFileSync(jPath, 'utf-8')) as JudgementArtifact
const v = verifyJudgement({ judgement: back, actualRawSha: rawSha, actualInputDigest: inputDigest })
if (!v.ok) {
  for (const b of v.blocks) console.error(`  🔴 [${b.code}] ${b.message}`)
  fail('저장한 judgement 가 스스로 모순이다')
}
console.log(`  judgement 기록  ${jPath} · 판정 판 ${EVALUATOR_VERSION}`)
console.log(`  🔴 호출 ${rawRows.length}회 · 실측 $${raw.actualUsd}`)
console.log('  🔴 DB write 0 · Queue 0 · 발행 0')
console.log('\n   보고는 --report 로 읽는다 (콘솔 재계산을 증거로 쓰지 않는다)\n')
