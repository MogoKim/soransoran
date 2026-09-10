#!/usr/bin/env tsx
/**
 * Persona 댓글 **모델 비교 실행기** — 🔴 기본은 호출 0 · 비용 0
 *
 * 🔴 **같은 입력·같은 Persona·같은 Gate 로만 비교한다.**
 *    모델마다 다른 글을 주면 그것은 모델 비교가 아니라 글 비교다.
 *
 * 🔴 실제 회원 글을 보내지 않는다. **합성 fixture** 로만 비교한다 —
 *    비교에 필요한 것은 "이 Persona 답게 쓰는가" 이지 특정 회원의 사연이 아니다.
 *    닉네임·개인정보·원문 전문은 어느 경로로도 나가지 않는다.
 *
 * 🔴 provider 오류에 재시도하지 않고, 다른 모델로 자동 대체하지 않는다.
 * 🔴 결과는 gitignored `tmp/` 에만. DB write 0.
 *
 * 사용법
 *   npm run persona:comment-eval             예상 비용과 계획 (호출 0)
 *   npm run persona:comment-eval -- --call   🔴 실제 호출 (30회 · $3 상한 안에서만)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildCommentInput, voiceEvidenceFromAssets, type CommentInput,
} from '../src/lib/persona-comment-input'
import {
  estimateCost, COMMENT_CALL_SHAPE, EVAL_AXES, EVAL_MAX_CALLS, EVAL_MAX_USD,
  type ModelPrice,
} from '../src/lib/persona-comment-cost'
import { COMMENT_REACTION_ROLES } from '../src/lib/persona-reaction-roles'
import { judgePostRichness, postBodyOf, SYNTHETIC_POSTS } from '../src/lib/persona-eval-posts'
import {
  runEval, textFingerprint, type EvalCaller, type EvalJudge,
} from './lib/persona-comment-eval-runner'
import { buildPromptFromInput, describeGateInput, toGateInput } from './lib/persona-comment-bridge'
import {
  allocateRolesByCorpus, bundlesForPersonas, buildReferenceManifest, carriesExperience,
  loadCanonAsset,
} from './lib/persona-reference-store.mjs'
import { judgeVoiceSeparation } from '../src/lib/persona-voice-reference'
import { judgeGateInputs } from '../src/lib/persona-comment-gate-report'
import { checkCommentCandidate } from './lib/persona-comment-candidate.mjs'
import {
  judgeBootstrapEligible, judgeGateReport, REQUIRED_GATES,
} from '../src/lib/persona-comment-gate-report'
import { parseCandidate } from './lib/persona-prompt'
import {
  EVAL_ROOT, LATEST_FILE, listRuns, pointLatest, runIdOf, savePaidRun,
} from './lib/persona-comment-eval-store'
import { M3_MODEL_CANDIDATES } from './lib/voice-m3-contract.mjs'
import { callProvider, keyStatus, type ProviderModel } from './lib/voice-m3-provider.mjs'
import pg from 'pg'

import { loadUnaoReadonlyUrl } from './lib/voice-unao-readonly.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const WANT_CALL = process.argv.includes('--call')
/** 🔴 비교 대상. 내부 라벨이다 — API 모델 ID 는 정본 표가 따로 들고 있다 */
/**
 * 🔴 `gpt-5-mini` 는 뺐다 (2026-09-09).
 *
 *    이 프롬프트·출력 상한 조합에서 reasoning 토큰 8,000 이 출력 예산을 전부 먹어
 *    10건 전부 `EMPTY` 로 돌아왔다. 모델이 나쁘다는 뜻이 아니라 **이 설정에서는
 *    결과물이 나오지 않는다**는 뜻이고, 결과물이 없으면 채점할 것도 없다.
 *    자동으로 다시 부르지 않는다 — 돈만 쓰고 같은 빈 응답을 받는다.
 */
const CANDIDATES = ['claude-haiku-4.5', 'gemini-3.7-flash'] as const
/**
 * 🔴 **모델당 입력 수 = 9** (2026-09-10, 창업자 판정 P0-5).
 *
 *    고품질 anchor 로 설 수 있는 Persona 는 **9종**이다.
 *    10번째는 anchor 비중이 바닥(37.5%)에 겨우 걸치므로 이번 비교에서 쓰지 않는다.
 *    🔴 production Persona 24명 중 나머지 15명은 근거가 없어
 *       `REFERENCE_MISSING` 으로 공개 후보 생성이 막힌다 —
 *       "24명 말투 준비 완료" 가 아니다.
 */
const SAMPLES = 9
/** 🔴 dry-run 전용 경로. 유료 저장소와 **다른 곳**이다 */
const DRYRUN_OUT = 'tmp/persona-comment-eval-dryrun.json'
const TIMEOUT_MS = 60_000
/**
 * 🔴 **이번 회차 상한** (2026-09-10, 창업자 승인).
 *    정본 상한(`EVAL_MAX_CALLS` 30 · `EVAL_MAX_USD` 3)보다 **좁다**.
 *    좁은 쪽을 쓴다 — 넓은 쪽을 쓰면 승인 범위를 넘어도 코드가 막지 않는다.
 */
const RUN_MAX_CALLS = 18
const RUN_MAX_USD = 0.10

await loadEnvLocal()

console.log('\n══ Persona 댓글 모델 비교 실행기 ══\n')
console.log(`  모드  ${WANT_CALL ? '🔴 --call (실제 호출 시도)' : 'dry-run (호출 0 · 비용 0)'}`)

const priceOf = (label: (typeof CANDIDATES)[number]): ModelPrice => {
  const c = M3_MODEL_CANDIDATES[label]
  return {
    label,
    apiModelId: c.apiModelId,
    inputPerMTok: c.inputPerMTok,
    outputPerMTok: c.outputPerMTok,
    source: c.source,
    checkedAt: c.checkedAt,
  }
}

/**
 * 🔴 **합성 비교 입력.** 실제 회원 글이 아니다.
 *
 *    Persona 는 서로 다른 말투 자산을 갖도록 만든다 — 그래야 "모델이 Persona 를
 *    구분해 쓰는가" 를 잴 수 있다. 같은 설정 10개로 비교하면 그 축이 죽는다.
 */
const ENDINGS = ['~해요', '~같아요', '~어요', '~네요', '~더라고요']
const EMOJIS = ['가끔', '없음', '자주']
const STAGES = ['자녀 대학생', '손주 있음', '독립 준비', '부모님 돌봄', '재취업 준비']
/**
 * 🔴 **한 줄 요약을 버렸다** (2026-09-10, P0-3).
 *    `bodyDigest` 한 줄로는 반응할 거리가 없어 모델이 남는 자리를 자기 이야기로 채웠다.
 *    이제 주제·상황·감정·물음이 담긴 여러 문장 합성 원글을 쓴다.
 *    정본: `src/lib/persona-eval-posts.ts`
 */

/**
 * 🔴 이 회차의 Persona 가 맡을 수 있는 역할.
 *    `experience` 는 경험 근거가 있어야 한다 — 합성 설정에는 없다(P0-5).
 * 🔴 다만 **다른 역할에서도** 근거 없는 자기 경험은 막힌다 —
 *    판정은 역할이 아니라 `judgeExperienceGrounding` 이 한다(P0-1).
 */
/**
 * 🔴 이 회차의 Persona 가 맡을 수 있는 역할.
 *    `experience` 는 경험 근거가 있어야 한다 — 합성 설정에는 없다(P0-5).
 * 🔴 다만 **다른 역할에서도** 근거 없는 자기 경험은 막힌다 —
 *    판정은 역할이 아니라 `judgeExperienceGrounding` 이 한다.
 */
const ELIGIBLE_ROLES = COMMENT_REACTION_ROLES.filter((r) => r !== 'experience')

/**
 * 🔴 **역할 배정을 실제 코퍼스 분포에서 뽑는다** (2026-09-10, A).
 *    자산을 먼저 읽어야 하므로 입력을 만들기 전에 정한다.
 */
const ROLE_CORPUS = loadCanonAsset()
const ROLE_PLAN = allocateRolesByCorpus({
  rows: ROLE_CORPUS.rows, roles: ELIGIBLE_ROLES, count: SAMPLES,
})

const inputs: CommentInput[] = []
for (let i = 0; i < SAMPLES; i += 1) {
  const post = SYNTHETIC_POSTS[i % SYNTHETIC_POSTS.length]!
  const voice = voiceEvidenceFromAssets({
    voiceCore: {
      ending: ENDINGS[i % ENDINGS.length]!,
      register: i % 2 === 0 ? '존댓말' : '구어체',
      emoji: EMOJIS[i % EMOJIS.length]!,
      length: i % 3 === 0 ? '짧은 문장' : '중간 길이',
    },
    // 🔴 `자기 경험 짧게` 를 지웠다 (2026-09-10, A) — 경험 근거가 없는 Persona 에게
    //    말투 변주로 자기 경험을 유도하고 있었다. 유도를 **입력에서** 없앤다.
    voiceVariations: ['바쁠 때 한 줄', '맞장구형', '한 줄 반응'],
  })
  const built = buildCommentInput({
    persona: {
      code: `S${String(i + 1).padStart(2, '0')}`,
      ageBand: i % 2 === 0 ? '50대' : '60대',
      region: '경기',
      lifeStage: STAGES[i % STAGES.length]!,
      identity: { job: `합성-${i}`, note: '비교용 합성 설정 — 실제 인물이 아니다' },
      voiceCore: {
        ending: ENDINGS[i % ENDINGS.length]!,
        register: i % 2 === 0 ? '존댓말' : '구어체',
        emoji: EMOJIS[i % EMOJIS.length]!,
        length: i % 3 === 0 ? '짧은 문장' : '중간 길이',
      },
      // 🔴 `자기 경험 짧게` 를 지웠다 (2026-09-10, A) — 경험 근거가 없는 Persona 에게
    //    말투 변주로 자기 경험을 유도하고 있었다. 유도를 **입력에서** 없앤다.
    voiceVariations: ['바쁠 때 한 줄', '맞장구형', '한 줄 반응'],
      noGoTopics: ['정치'],
      noGoExpressions: ['~하시길'],
      forbiddenReactionRoles: [],
    },
    post: {
      id: post.id,
      title: post.title,
      // 🔴 여러 문장 본문 — 반응할 거리를 준다
      bodyDigest: postBodyOf(post),
      boardLabel: post.boardLabel,
      existingCommentDigests: [],
    },
    // 🔴 **경험 근거가 없으면 `experience` 를 배정하지 않는다** (P0-5).
    //    합성 Persona 의 identity 는 `{ job, note }` 뿐이라 들려줄 기억이 없다.
    //    억지로 배정하면 모델이 참고 댓글의 장면을 자기 것으로 옮긴다(실측).
    // 🔴 고정 교대가 아니라 **실제 코퍼스 분포**에서 배정한다 (A)
    reactionRole: ROLE_PLAN.roles[i]!,
    voice,
    memory: { has: false, note: '' },
  })
  if (!built.ok) {
    console.error(`\n🔴 합성 입력 ${i} 를 만들지 못했다 — ${built.blocks.map((b) => b.code).join(', ')}\n`)
    process.exit(1)
  }
  inputs.push(built.input)
}
for (const sp of SYNTHETIC_POSTS) {
  const rich = judgePostRichness(sp)
  if (!rich.ok) { console.error(`\n🔴 중단: ${rich.reason}\n`); process.exit(1) }
}
console.log(`  합성 입력 ${inputs.length}건 (🔴 실제 회원 글 아님 · 고유 지문 ${new Set(inputs.map((i) => i.fingerprint)).size}개)`)

/**
 * ── 🔴 말투 근거 (2026-09-10, Wave E) ─────────────────────────
 *
 *    옛 회차는 Persona 설정만 주고 창작하게 했다. 20건이 서로 비슷했고
 *    원글과 무관한 생활 장면이 반복됐다. 이제 **실제 사람이 쓴 댓글**을 근거로 준다.
 *
 * 🔴 근거가 없거나 Persona 별로 겹치면 **호출 전에 멈춘다.** 돈을 쓰고 알면 늦다.
 */
const reference = bundlesForPersonas({
  repoRoot: process.cwd(),
  personaCodes: inputs.map((i) => i.persona.code),
})
console.log('\n  ── 말투 근거 (실제 공개 댓글)')
for (const a of reference.assets) {
  console.log(`     ${a.path.padEnd(42)} ${a.exists ? `글 ${a.posts} · 댓글 ${a.comments}` : '🔴 없음'}`)
}
if (reference.blocks.length > 0) {
  for (const b of reference.blocks) console.error(`     🔴 ${b}`)
}
const refBundles = [...reference.byCode.values()]
console.log(`     출처  ${reference.origin}`)
for (const b of reference.blocks) console.error(`     🔴 ${b}`)
if (refBundles.length !== inputs.length) {
  console.error(`\n🔴 중단: Persona ${inputs.length}종 중 ${refBundles.length}종만 근거를 얻었다.`)
  console.error('   🔴 억지로 채우지 않는다. anchor 가 모자라면 그대로 blocker 다.\n')
  process.exit(1)
}

/**
 * 🔴 **manifest 를 먼저 만든다** (P0-2). 이것이 없으면 이 회차는 canon 승격이 막힌다.
 *    식별자 유출 검사가 여기서 돌고, 하나라도 걸리면 **호출 전에** 멈춘다.
 */
const referenceManifest = buildReferenceManifest({
  sourceDigest: reference.sourceDigest ?? '(미상)',
  rows: reference.rows,
  bundles: refBundles,
})
console.log(`     manifest  sanitizer ${referenceManifest.sanitizerVersion}`
  + ` · 코퍼스 ${referenceManifest.commentCount}건`
  + ` · corpus ${referenceManifest.sanitizedCorpusDigest}`
  + ` · bundle ${referenceManifest.personaBundleDigest}`)
console.log(`     🔴 식별자 유출 검사  ${referenceManifest.identityLeakCheck.detail}`)
if (referenceManifest.identityLeakCheck.hits > 0) {
  console.error('\n🔴 중단: 근거에 작성자 식별자가 섞였다 — 부르지 않는다.\n')
  process.exit(1)
}

/** 🔴 **말투가 실제로 갈리는가** — 겹침이 아니라 문체 좌표 거리로 본다 */
const sep = judgeVoiceSeparation(refBundles)
console.log(`     Persona ${refBundles.length}종 · 묶음당 ${refBundles[0]?.comments.length ?? 0}건`)
console.log(`     🔴 말투 분리(문체 거리) 최소 ${sep.minDistance.toFixed(3)} · 가장 가까운 쌍 ${sep.closestPair}`)
console.log('     🔴 "겹치지 않는다" 는 말투 차이의 증거가 아니다 — 위 거리가 근거다')
console.log('     code  anchor 보완 비중  중앙 p90')
for (const t of reference.table) {
  console.log(`       ${t.personaCode}  ${String(t.anchorComments).padStart(5)}`
    + ` ${String(t.supplements).padStart(4)} ${(t.anchorRatio * 100).toFixed(0).padStart(4)}%`
    + ` ${String(t.medianLen).padStart(5)} ${String(t.p90Len).padStart(4)}`)
}

/**
 * ── 🔴 유료 호출 전 사람이 확인할 다섯 가지 (2026-09-10, 창업자 요구) ──
 */
console.log('\n  ── 🔴 호출 전 확인 (dry-run 에서도 항상 찍는다)')
console.log(`     ① 역할 분포 (실제 코퍼스 근거)`)
for (const d of ROLE_PLAN.distribution) {
  console.log(`        ${d.role.padEnd(10)} 코퍼스 ${String(d.corpusPct).padStart(5)}% → 배정 ${d.assigned}건`)
}
const hasOther = ROLE_PLAN.roles.includes('other')
console.log(`     ② other 포함 ${hasOther ? '🟢 예' : '🔴 아니오'}`
  + ` (${ROLE_PLAN.roles.filter((r) => r === 'other').length}/${SAMPLES}건)`)

{
  // ③ 경험 근거 없는 Persona 의 프롬프트에 자기 경험 유도가 0건인가
  const lures = ['자기 경험 짧게', '나도 비슷했다', '내 이야기 한 토막']
  let lureHits = 0
  let conflict = 0
  for (const inp of inputs) {
    const pl = buildPromptFromInput(inp, [], reference.byCode.get(inp.persona.code))
    if (!pl.ok) continue
    const sys = pl.prompt.systemPrompt
    for (const l of lures) if (sys.includes(l)) lureHits += 1
    // ⑤ 상충 지시 — "지어내지 마라" 와 "자기 경험을 말하라" 가 같이 있으면 안 된다
    if (sys.includes('들려줄 자기 이야기가 없습니다') && sys.includes('내 이야기 한 토막')) conflict += 1
  }
  console.log(`     ③ 자기 경험 유도 문구 ${lureHits === 0 ? '🟢 0건' : `🔴 ${lureHits}건`}`)
  // ④ 각 bundle 에서 경험형 참고 댓글이 제외됐는가
  const refTexts = [...reference.byCode.values()].flatMap((b) => b.comments.map((c) => c.text))
  const carried = refTexts.filter(carriesExperience).length
  console.log(`     ④ 묶음 안 경험형 참고 댓글 ${carried === 0 ? '🟢 0건' : `🔴 ${carried}건`}`
    + ` (검사 ${refTexts.length}건)`)
  console.log(`     ⑤ 상충 지시 ${conflict === 0 ? '🟢 0건' : `🔴 ${conflict}건`}`)
  if (lureHits > 0 || carried > 0 || conflict > 0 || !hasOther) {
    console.error('\n🔴 중단: 호출 전 확인에서 걸렸다.\n')
    process.exit(1)
  }
}

console.log('\n  ── 후보와 단가 (정본: voice-m3-contract 의 M3_MODEL_CANDIDATES)')
for (const label of CANDIDATES) {
  const p = priceOf(label)
  console.log(`     ${label.padEnd(18)} api=${p.apiModelId} · in $${p.inputPerMTok} · out $${p.outputPerMTok} · 확인일 ${p.checkedAt}`)
}
console.log(`  한 건 토큰 추정  in ${COMMENT_CALL_SHAPE.inputTokens} · out ${COMMENT_CALL_SHAPE.outputTokens}`)

const estimates = CANDIDATES.map((label) => estimateCost({ price: priceOf(label), calls: SAMPLES }))
console.log('\n  ── 예상 비용')
for (const e of estimates) {
  if (e.ok) console.log(`     ${e.estimate.model.padEnd(18)} ${e.estimate.calls}회 → $${e.estimate.usd}`)
  else console.log(`     🔴 ${e.reason}`)
}

// 🔴 key 상태 — 값은 찍지 않는다. 있는가만 본다
const keys = CANDIDATES.map((label) => keyStatus(label as ProviderModel))
console.log('\n  ── provider key')
for (const [i, k] of keys.entries()) {
  console.log(`     ${CANDIDATES[i]!.padEnd(18)} ${k.envName} ${k.present ? '있음' : '🔴 없음'}`)
}
const keysReady = keys.every((k) => k.present)

/** 🔴 `--call` 이 없으면 아예 부르지 않는다 — keysReady 를 null 로 넘겨 fail-closed 로 막는다 */
const caller: EvalCaller = async ({ model, input }) => {
  /**
   * 🔴 **말투 근거 없이 부르지 않는다.**
   *    없으면 `buildPromptFromInput` 이 `REFERENCE_MISSING` 으로 막고,
   *    막힌 호출은 돈을 쓰지 않는다. 옛 경로(설정만 보고 창작)로 돌아가지 않는다.
   */
  const prompt = buildPromptFromInput(input, [], reference.byCode.get(input.personaCode))
  if (!prompt.ok) {
    return {
      ok: false, rawText: '', inputTokens: 0, outputTokens: 0, reasoningTokens: null,
      latencyMs: 0, errorCode: 'PROMPT_BLOCKED', errorMessage: prompt.blocks.map((b) => b.code).join(','),
    }
  }
  const t0 = Date.now()
  const res = await callProvider({
    model: model as ProviderModel,
    systemPrompt: prompt.prompt.systemPrompt,
    userPayload: prompt.prompt.userPayload,
    maxOutputTokens: prompt.prompt.maxOutputTokens,
    timeoutMs: TIMEOUT_MS,
  })
  return {
    ok: res.ok,
    rawText: res.rawText,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    reasoningTokens: res.reasoningTokens,
    latencyMs: Date.now() - t0,
    errorCode: res.errorCode,
    errorMessage: res.errorMessage,
  }
}

/** 🔴 ② 코퍼스 — 없으면 ② 가 notRun 이 된다. 그 사실을 화면에 적는다 */
const corpusLookup = await (async (): Promise<((n: string) => number) | null> => {
  const url = ((): string | null => { try { return loadUnaoReadonlyUrl() } catch { return null } })()
  if (url === null) return null
  try {
    const unao = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await unao.connect()
    const { rows } = await unao.query<{ topComments: unknown }>(
      'SELECT "topComments" FROM "CafePost" WHERE "topComments" IS NOT NULL LIMIT 3000',
    )
    await unao.end()
    const bodies: string[] = []
    for (const r of rows) {
      let arr: unknown = r.topComments
      if (typeof arr === 'string') { try { arr = JSON.parse(arr) } catch { continue } }
      if (!Array.isArray(arr)) continue
      for (const item of arr) {
        if (item === null || typeof item !== 'object') continue
        const body = (item as Record<string, unknown>).content
        if (typeof body === 'string' && body.trim() !== '') bodies.push(body.replace(/\s+/gu, ''))
      }
    }
    return (ngram: string): number => {
      let n = 0
      for (const b of bodies) if (b.includes(ngram)) { n += 1; if (n > 6) break }
      return n
    }
  } catch { return null }
})()
console.log(`  ② 댓글 코퍼스 ${corpusLookup === null ? '🔴 없음 — ② 가 notRun 이 된다' : '연결됨 (원문 미저장)'}`)

/** 🔴 ⑧ 같은 배치의 앞선 후보 */
const priorByPersona = new Map<string, string[]>()

/**
 * 🔴 파싱과 Gate 는 **기존 정본**을 쓴다. 비교용 판정을 새로 만들지 않는다.
 *
 * 🔴 Gate 입력을 빠짐없이 채운다 — 빠뜨리면 관문이 `notRun` 인 채로 9개가 채워져
 *    "9관문 통과" 처럼 읽힌다.
 */
const judge: EvalJudge = ({ rawText, input }) => {
  const parsed = parseCandidate(rawText)
  if (!parsed.ok) {
    return {
      parseOk: false, gateStatus: null, gateHits: [], textLength: null,
      textFingerprint: null, failure: `${parsed.errorCode}: ${parsed.message}`,
      text: null, gateLines: [], missingRequired: [...REQUIRED_GATES],
      statusPass: false, fullGatePass: false, bootstrapReviewEligible: false,
    }
  }
  const gi = toGateInput({
    input, text: parsed.text,
    // 🔴 합성 글이므로 유출 대조 대상도 합성이다
    sourceTexts: [input.post.title, input.post.bodyDigest],
    // 🔴 합성 비교에는 실회원 표시명을 넣지 않는다 — 대신 **조회했다는 사실**을 빈 배열로 남긴다.
    //    `undefined` 로 두면 ⑥ 이 notRun 이 되어 "돌지 않은 검사" 가 통과로 읽힌다
    knownNames: [],
    frequencyLookup: corpusLookup ?? undefined,
    corpusName: corpusLookup === null ? undefined : 'comment',
    priorTexts: priorByPersona.get(input.personaCode) ?? [],
    seedUseCount: 1,
    adviceForbidden: false,
    sourceIsCafeOperational: false,
  })
  const verdict = checkCommentCandidate(gi)
  const report = judgeGateReport({ gates: verdict.gates, status: verdict.status })
  // 🔴 같은 배치의 앞선 후보를 다음 후보의 ⑧ 대조에 넣는다
  priorByPersona.set(input.personaCode, [...(priorByPersona.get(input.personaCode) ?? []), parsed.text])
  return {
    parseOk: true,
    gateStatus: verdict.status,
    gateHits: verdict.gates.filter((g) => g.outcome !== 'pass').map((g) => `${g.gate}:${g.outcome}`),
    textLength: parsed.text.length,
    textFingerprint: textFingerprint(parsed.text),
    failure: null,
    // 🔴 사람이 채점하려면 결과물을 읽어야 한다
    text: parsed.text,
    gateLines: verdict.gates.map((g) => ({ gate: g.gate, outcome: g.outcome })),
    missingRequired: report.missingRequired,
    statusPass: report.statusPass,
    fullGatePass: report.fullGatePass,
    /**
     * 🔴 합성 비교에서는 **Gate 축만** 본다. Persona 운영 조건(active·Account·
     *    생활사·governor)은 합성 인물에 적용할 수 없으므로 여기서 판단하지 않는다 —
     *    실제 배정 경로가 `judgeBootstrapEligible` 로 전부 확인한다.
     */
    bootstrapReviewEligible: judgeBootstrapEligible({
      report, priorTextCount: 0,
      bootstrapUsedTotal: 0, bootstrapUsedToday: 0,
      personaActive: true, realMember: false, seedComplete: true,
      lifeConflict: false, governorOk: true,
    }).bootstrapReviewEligible,
  }
}

const result = await runEval({
  models: CANDIDATES.map((label) => ({ label, price: priceOf(label) })),
  inputs,
  call: caller,
  judge,
  // 🔴 --call 이 없으면 key 상태를 null 로 넘긴다 → judgeSpend 가 fail-closed 로 막는다
  keysReady: WANT_CALL ? keysReady : null,
  // 🔴 정본 상한과 이번 회차 승인치 중 **좁은 쪽**
  maxCalls: Math.min(EVAL_MAX_CALLS, RUN_MAX_CALLS),
  maxUsd: Math.min(EVAL_MAX_USD, RUN_MAX_USD),
})

console.log(`\n  🔴 실제 호출  ${result.totalCalls}회 · 실제 비용 $${result.totalActualUsd ?? 0}`)
if (result.stoppedReason !== null) console.log(`     멈춘 이유  ${result.stoppedReason}`)
if (result.totalCalls > 0) {
  console.log('\n  ── 모델별 (실측)')
  for (const r of result.perModel) {
    console.log(`     ${r.model.padEnd(18)} 호출 ${r.calls} · 성공 ${r.ok} · parse ${r.parseOk}`)
    console.log(`        statusPass ${r.statusPassCount} (실행된 관문만) ·`
      + ` 🔴 fullGatePass ${r.fullGatePassCount} (필수 전부 돌고 전부 pass) ·`
      + ` bootstrap 후보 ${r.bootstrapCount} · 필수 미실행 ${r.missingRequiredCount}`)
    console.log(`        in ${r.inputTokens} · out ${r.outputTokens} · reasoning ${r.reasoningTokens}`
      + ` · $${r.actualUsd ?? '?'} · 평균 ${r.calls === 0 ? 0 : Math.round(r.latencyMsTotal / r.calls)}ms`
      + ` · 중복 지문 ${r.duplicateTexts}`)
    if (r.failures.length > 0) console.log(`        실패 ${r.failures.slice(0, 3).join(' / ')}`)
  }
}
console.log(`\n  모델 선택  ${result.selection.status} · winner ${result.selection.winner ?? '(없음)'}`)
console.log(`     ${result.selection.reason}`)
console.log(`  평가 축   ${EVAL_AXES.join(' · ')} (+ 비용 · latency 는 따로 본다)`)

/**
 * 🔴 **유료 실행 결과와 dry-run 을 다른 경로에 둔다.**
 *
 *    옛 판은 둘이 같은 파일 이름을 썼고, 실제 20회 호출로 만든 표본을
 *    그 다음 dry-run 이 통째로 덮어썼다(`samples: []` 만 남았다).
 *    돈을 쓴 결과물이 돈을 쓰지 않은 실행에 지워진 것이다.
 */
const runId = runIdOf(new Date())
const summary = {
  runId,
  ranAt: new Date().toISOString(),
  called: result.called,
  totalCalls: result.totalCalls,
  totalActualUsd: result.totalActualUsd,
  stoppedReason: result.stoppedReason,
  candidates: CANDIDATES.map((label) => {
    const p = priceOf(label)
    return { label, apiModelId: p.apiModelId, inputPerMTok: p.inputPerMTok, outputPerMTok: p.outputPerMTok, checkedAt: p.checkedAt }
  }),
  estimates,
  perModel: result.perModel,
  selection: result.selection,
  axes: EVAL_AXES,
}
const samplesDoc = {
  runId,
  ranAt: new Date().toISOString(),
  note: '🔴 모델명 없음. 합성 입력의 생성물이며 실회원 정보가 아니다. 채점 뒤 key.json 과 대조한다.',
  axes: EVAL_AXES,
  scoreScale: '1~5 (빈칸이면 미채점 — 미채점이 하나라도 있으면 모델을 확정하지 않는다)',
  samples: result.samples.map((smp, i) => ({
    id: `S${String(i + 1).padStart(3, '0')}`,
    blindLabel: smp.blindLabel,
    personaCode: smp.personaCode,
    reactionRole: smp.reactionRole,
    inputFingerprint: smp.inputFingerprint,
    text: smp.text,
    textLength: smp.textLength,
    textFingerprint: smp.textFingerprint,
    parseOk: smp.parseOk,
    // 🔴 셋을 따로 적는다 — 하나로 적으면 "보지 않은 것" 이 "통과" 로 읽힌다
    statusPass: smp.statusPass,
    fullGatePass: smp.fullGatePass,
    bootstrapReviewEligible: smp.bootstrapReviewEligible,
    missingRequired: smp.missingRequired,
    gateStatus: smp.gateStatus,
    gateLines: smp.gateLines,
    gateHits: smp.gateHits,
    latencyMs: smp.latencyMs,
    failure: smp.failure,
    scores: Object.fromEntries(EVAL_AXES.map((a) => [a, null])),
    note: '',
  })),
}
const keyDoc = {
  runId,
  ranAt: new Date().toISOString(),
  note: '🔴 채점을 마친 뒤에 연다. 먼저 열면 blind 가 아니다.',
  key: CANDIDATES.map((label, i) => ({ blindLabel: String.fromCharCode(65 + i), model: label })),
}

if (!result.called) {
  // 🔴 dry-run 은 유료 저장소를 건드리지 않는다. latest 도 옮기지 않는다
  mkdirSync('tmp', { recursive: true })
  writeFileSync(DRYRUN_OUT, `${JSON.stringify({ ...summary, samples: samplesDoc.samples.length }, null, 2)}\n`, 'utf-8')
  console.log(`\n  dry-run 기록  ${DRYRUN_OUT}`)
  console.log(`  🔴 유료 결과 저장소(${EVAL_ROOT})는 건드리지 않았다 — latest 도 그대로다`)
  const runs = listRuns()
  console.log(`  보관된 유료 회차 ${runs.length}건${runs.length === 0 ? '' : ` (최근 ${runs[runs.length - 1]!})`}\n`)
  process.exit(0)
}

/** 🔴 manifest 를 summary 에 남긴다 — 없으면 canon 승격이 막힌다(P0-2) */
const summaryWithManifest = { ...summary, referenceManifest }
const saved = savePaidRun({
  runId, called: result.called,
  artifact: { summary: summaryWithManifest, samples: samplesDoc, key: keyDoc },
})
if (!saved.ok) {
  console.error(`\n🔴 결과를 저장하지 못했다 — ${saved.reason}\n`)
  process.exit(1)
}
console.log(`\n  유료 회차 저장  ${saved.dir}`)
for (const f of saved.files) console.log(`     ${f}  sha=${saved.hashes[f]}`)

/**
 * 🔴 **latest 갱신 실패를 exit 0 으로 끝내지 않는다.**
 *
 *    저장은 됐는데 포인터가 옛 회차를 가리키면, 채점하러 온 사람이
 *    **방금 돈 회차가 아닌 것**을 연다. 화면에 한 줄 찍고 성공으로 끝내면
 *    그 어긋남을 아무도 모른 채 지나간다.
 *
 * 🔴 저장된 회차는 지우지 않는다 — 포인터가 틀렸을 뿐 결과물은 온전하다.
 */
const pointed = pointLatest({ runId, called: result.called })
if (!pointed.ok) {
  console.error(`\n🔴 latest 포인터를 갱신하지 못했다 — ${pointed.reason}`)
  console.error(`   저장된 회차는 그대로 있다: ${saved.dir}`)
  console.error(`   latest 파일: ${join(EVAL_ROOT, LATEST_FILE)} (지금 이 회차를 가리키지 않는다)`)
  console.error(`   채점할 때는 ${runId} 를 직접 연다\n`)
  process.exit(1)
}
console.log(`  latest  ${pointed.reason}`)
console.log('  🔴 기존 회차는 덮어쓰지 않는다 · 전부 gitignored · DB write 0\n')
process.exit(0)
