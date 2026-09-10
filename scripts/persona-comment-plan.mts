#!/usr/bin/env tsx
/**
 * Conversation Engine **shadow 파이프라인** — 🔴 공개 Comment write 0 · DB write 0
 *
 * 🔴 **하나의 흐름이다.** 조각들이 각자 돌지 않는다.
 *
 *    planner(대상 글 + Persona) → Persona-first 입력 → 기존 `buildPrompt`
 *    → (선택) 기존 `callProvider` → 기존 9관문 Gate → shadow artifact
 *
 *    새 생성기를 만들지 않았다. 프롬프트 정본은 `buildPrompt`, 안전 판정 정본은
 *    `checkCommentCandidate` 이고, 이 스크립트는 그 사이를 잇기만 한다.
 *
 * 🔴 세 모드
 *    · `inspect` — 계획과 준비도만. 생성 0 · 호출 0
 *    · `shadow`  — 입력·프롬프트·Gate 까지. 🔴 **Comment/Queue DB write 0**
 *    · `release` — 이 스크립트에는 **없다.** 공개 발행 경로를 갖지 않는다
 *
 * 🔴 `--apply` 가 없다. `--call` 이 있어도 만드는 것은 후보 텍스트뿐이고
 *    그것은 gitignored `tmp/` 에만 남는다.
 *
 * 사용법
 *   npm run persona:comment-plan                 계획과 준비도 (inspect)
 *   npm run persona:comment-plan -- --shadow     입력·프롬프트·Gate 까지 (호출 0)
 *   npm run persona:comment-plan -- --shadow --call   🔴 실제 LLM 호출 (상한 안에서만)
 */
import { writeFileSync, mkdirSync } from 'node:fs'

import { PrismaClient } from '@prisma/client'

import { judgeInputDiversity, type CommentInput } from '../src/lib/persona-comment-input'
import {
  judgeRatio, judgeReadiness, readRunMode, windowFromRows,
  RATIO_WINDOW_DAYS, type CommentWindow,
} from '../src/lib/persona-comment-governor'
import { bundlesForPersonas } from './lib/persona-reference-store.mjs'
import { buildPromptFromInput, describeGateInput } from './lib/persona-comment-bridge'
import { gateInputOf, materializeTargets } from './lib/persona-comment-targets'
import { makeDbTargetSource } from './lib/persona-comment-source-db'
import {
  judgeGateInputs, judgeRealPostExternalCall, REAL_POST_EXTERNAL_CALL_ALLOWED,
} from '../src/lib/persona-comment-gate-report'
import { keyStatus, type ProviderModel } from './lib/voice-m3-provider.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const WANT_SHADOW = process.argv.includes('--shadow')
/**
 * 🔴 **실제 회원 글로는 외부 모델을 부르지 않는다 (2026-09-09).**
 *
 *    판정 정본은 `src/lib/persona-comment-gate-report.ts` 의
 *    `judgeRealPostExternalCall` 이다 — 스크립트 안의 플래그는 fixture 가 볼 수 없어서
 *    뒤집혀도 아무 검사가 깨지지 않는다. 그래서 정책을 정본으로 올렸다.
 */
const ASKED_CALL = process.argv.includes('--call')
const externalCall = judgeRealPostExternalCall({ asked: ASKED_CALL })
const WANT_CALL = externalCall.allowed
const MODEL: ProviderModel = 'claude-haiku-4.5'
const OUT = 'tmp/persona-comment-shadow.json'
/** 🔴 본문 요약 길이. 원문 전문을 프롬프트로 보내지 않는다 */
const DIGEST_CHARS = 600
const COMMENT_DIGEST_CHARS = 60

await loadEnvLocal()
const prisma = new PrismaClient()
const now = new Date()
const nowMs = now.getTime()
const windowStart = new Date(nowMs - RATIO_WINDOW_DAYS * 86_400_000)

const mode = readRunMode(process.env)
console.log('\n══ Conversation Engine shadow 파이프라인 (공개 write 0) ══\n')
console.log(`  실행 모드  ${mode.mode} — ${mode.reason}`)
console.log(`  이 회차    ${WANT_SHADOW ? 'shadow' : 'inspect'}`)
if (ASKED_CALL && !WANT_CALL) {
  console.log(`  🔴 --call 을 막았다 — ${externalCall.reason}`)
}

// ── ① rolling 창 — 🔴 레인 분류는 governor 정본이 한다 ──
const window: CommentWindow = await (async (): Promise<CommentWindow> => {
  try {
    const rows = await prisma.comment.findMany({
      where: { isDeleted: false, createdAt: { gte: windowStart, lte: now } },
      select: { commentOrigin: true, personaId: true },
    })
    return windowFromRows(rows, RATIO_WINDOW_DAYS)
  } catch {
    return { measured: false, real: 0, persona: 0, windowDays: RATIO_WINDOW_DAYS }
  }
})()
const ratio = judgeRatio(window)
console.log(`\n  최근 ${RATIO_WINDOW_DAYS}일  실사용자 ${window.real}건 · Persona ${window.persona}건`
  + `${window.measured ? '' : '  🔴 집계 실패'}`)
console.log(`  ratio     ${ratio.reason}`)

// ── ② 오늘 발행 수 · kill switch ──
const kstDayStart = new Date(Math.floor((nowMs + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000)
const publishedToday = await prisma.comment.count({
  where: { isDeleted: false, commentOrigin: 'PERSONA', createdAt: { gte: kstDayStart } },
}).catch(() => null)
const killSwitchOff = await (async (): Promise<boolean | null> => {
  try {
    // 🔴 `enabled` 는 "발화가 켜졌나" 가 아니라 **"중지가 켜졌나"** 다(스키마 주석).
    const row = await prisma.personaGlobalSwitch.findUnique({
      where: { id: 'global' }, select: { enabled: true },
    })
    return row === null ? true : !row.enabled
  } catch { return null }
})()

const readiness = judgeReadiness({
  window, mode: WANT_SHADOW ? 'shadow' : 'inspect', publishedToday, killSwitchOff,
})
console.log(`  오늘 발행  ${publishedToday === null ? '🔴 세지 못했다' : `${publishedToday}건`}`
  + ` · kill switch ${killSwitchOff === null ? '🔴 읽지 못했다' : killSwitchOff ? '꺼짐' : '🔴 켜짐'}`)
console.log(`\n  🔴 공개 허용 ${readiness.publicAllowedToday}건 · 공개 발행 ${readiness.canPublish ? '가능' : '불가'}`)
console.log(`  🟡 shadow   ${readiness.shadowLimit}건 — ratio 와 무관하다(계획·생성·Gate 는 계속 돈다)`)
for (const b of readiness.blockers) console.log(`     · ${b}`)

// ── ③ 대상 글·Persona 실측 ──
/**
 * 🔴 **Queue CLI 와 같은 함수를 쓴다** (2026-09-09 정정).
 *
 *    옛 판은 이 스크립트가 자기 몫의 대상 선정을 따로 적어 두었고,
 *    Queue CLI 도 자기 것을 따로 적어 두었다. 두 벌은 곧 갈라졌다 —
 *    이쪽은 생활사 축 8개를 넘겼고 저쪽은 하나만 넘겨서, 같은 planner 가
 *    **다른 대상**을 뽑았다. 열린 Queue 를 보는 열쇠도 서로 달랐다.
 *
 *    이제 재료는 `materializeTargets` 한 곳에서 나온다. 이 스크립트가 정하는 것은
 *    상한(`shadowLimit`)뿐이다.
 */
const material = await materializeTargets({
  source: makeDbTargetSource({ prisma, windowStart }),
  // 🔴 shadow 회차는 shadowLimit 로 돈다. 공개 상한이 0 이어도 계획은 만들어진다
  limit: WANT_SHADOW ? readiness.shadowLimit : readiness.allowance.remaining,
  nowMs,
  windowMs: RATIO_WINDOW_DAYS * 86_400_000,
  digestChars: DIGEST_CHARS,
  commentDigestChars: COMMENT_DIGEST_CHARS,
})
const plan = material.plan

console.log(`\n  공개 글 ${material.counts.posts}건`
  + ` · 살아 있는 댓글 0개 ${material.counts.postsWithNoComments}건`)
console.log(`  Persona ${material.counts.personas}명 · active ${material.counts.personasActive}`
  + ` · seed 완전 ${material.counts.personasSeedComplete}`)
// 🔴 "못 읽었다" 와 "0건" 을 갈라 적는다 — 같은 화면 글자로 뭉개면 다시 삼킨다
console.log(`  최근 역할 사용  ${material.recentRoleCounts === null
  ? '🔴 읽지 못했다 — 편중 방지를 신뢰할 수 없다'
  : Object.keys(material.recentRoleCounts).length === 0
    ? '(0건)'
    : Object.entries(material.recentRoleCounts).map(([k, v]) => `${k}=${v}`).join(' · ')}`)
for (const b of material.providerBlockers) console.log(`  🔴 유료 호출 차단: ${b}`)

console.log(`\n  ── 계획 ${plan.items.length}건`)
for (const it of plan.items) {
  console.log(`     ${it.personaCode} → ${it.postId.slice(0, 8)} (${it.reactionRole}) — ${it.why}`)
}
if (plan.items.length === 0) console.log('     (없다 — 상한이 0 이거나 대상이 없다)')

const reasons = new Map<string, number>()
for (const s of plan.skipped) for (const b of s.blocks) reasons.set(b.code, (reasons.get(b.code) ?? 0) + 1)
if (reasons.size > 0) {
  console.log('\n  ── 제외 사유')
  for (const [code, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`     ${code} ${n}건`)
}

// ── ④ shadow — 🔴 입력 → 프롬프트 → (선택) 호출 → 9관문 Gate ──
type ShadowRecord = {
  postId: string
  personaCode: string
  reactionRole: string
  fingerprint: string
  voiceSource: string
  promptOk: boolean
  promptBlocks: string[]
  called: boolean
  parseOk: boolean | null
  gateStatus: string | null
  gateHits: string[]
  textLength: number | null
  failure: string | null
  /** 🔴 실제 usage·지연. 추정이 아니라 provider 가 돌려준 값이다 */
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  /** 🔴 필드를 다 넘겼는가 — 관문이 **실제로 도는가**와 다른 질문이다 */
  gateFieldsComplete: boolean
  /** 🔴 채운 입력으로 필수 관문이 실제로 돌 수 있는가 */
  gateInputsOk: boolean
  gateInputsMissing: string[]
  willNotRun: string[]
}

if (WANT_SHADOW) {
  console.log('\n  ── shadow 실행 (🔴 Comment/Queue DB write 0 · 외부 호출 0)')
  const key = keyStatus(MODEL)
  console.log(`     provider key ${key.envName} ${key.present ? '있음' : '없음'} — 🔴 이 도구는 부르지 않는다`)

  /**
   * 🔴 **Gate 입력은 materializer 가 이미 갖췄다.**
   *    여기서 다시 읽지 않는다 — 두 번 읽으면 두 값이 갈리고,
   *    갈린 쪽으로 판정한 회차가 "관문이 돈다" 고 잘못 말하게 된다.
   */
  const withNames = material.gaps.filter((g) => g.startsWith('knownNames')).length === 0
  const withCorpus = material.gaps.filter((g) => g.startsWith('frequencyLookup')).length === 0
  console.log(`     ⑥-A 회원 표시명 ${withNames ? '조회함' : '🔴 조회 실패(undefined)'}`)
  console.log(`     ② 댓글 코퍼스 ${withCorpus ? '읽음 (원문 미저장)' : '🔴 없음 — ② 가 notRun 이 된다'}`)
  for (const g of material.gaps) console.log(`       빠짐: ${g}`)

  const inputs: CommentInput[] = material.targets.map((t) => t.target.input)
  const records: ShadowRecord[] = []

  /**
 * 🔴 **말투 근거** (2026-09-10, Wave E). 자산이 있으면 강제하고, 없으면 끈다 —
 *    이 경로는 shadow·미리보기라 자산 부재로 멈추면 관제가 죽는다.
 *    유료 생성 경로(`persona-comment-eval` · `persona-comment-generate`)는 강제한다.
 */
  const reference = bundlesForPersonas({
    repoRoot: process.cwd(),
    personaCodes: material.targets.map((x) => x.target.input.personaCode),
  })
  console.log(`  말투 근거  Persona ${reference.byCode.size}종`
    + (reference.blocks.length > 0 ? ` · 🟡 ${reference.blocks[0]}` : ''))

  for (const t of material.targets) {
    const input = t.target.input
    /**
     * 🔴 **자기 발화로 표지를 뽑는다.** 가짜 표지를 이전 발화로 세지 않는다 —
     *    그것은 발화가 아니라 글자이고, ⑧ 은 그것으로 말끝·시작어절을 잰다.
     */
    const prompt = buildPromptFromInput(input, t.recentTexts, reference.byCode.get(input.personaCode),
      { requireReference: reference.byCode.size > 0 })

    /**
     * 🔴 후보 텍스트가 없으므로 Gate 를 돌릴 수는 없다 —
     *    대신 "돌릴 수 있는 상태인가" 를 `judgeGateInputs` 로 판정한다.
     *    이것이 `notRun` 을 미리 아는 방법이다.
     */
    const readiness2 = judgeGateInputs(describeGateInput(
      gateInputOf(t.gate, input, '(shadow — 생성물 없음)'),
    ))

    records.push({
      postId: t.target.facts.postId,
      personaCode: t.target.facts.personaCode,
      reactionRole: t.target.facts.reactionRole,
      fingerprint: input.fingerprint,
      voiceSource: input.voice.source,
      promptOk: prompt.ok, promptBlocks: prompt.ok ? [] : prompt.blocks.map((b) => b.code),
      called: false, parseOk: null, gateStatus: null, gateHits: [], textLength: null,
      failure: null, latencyMs: null, inputTokens: null, outputTokens: null, reasoningTokens: null,
      gateFieldsComplete: readiness2.fieldsComplete,
      gateInputsOk: readiness2.ok,
      gateInputsMissing: readiness2.missing,
      willNotRun: readiness2.willNotRun,
    })
  }

  const dv = judgeInputDiversity(inputs)
  console.log(`     입력 ${inputs.length}건 · 막힘 ${material.blockedInputs.length}건`)
  if (material.blockedInputs.length > 0) {
    const m = new Map<string, number>()
    for (const c of material.blockedInputs) m.set(c, (m.get(c) ?? 0) + 1)
    for (const [c, n] of m) console.log(`       ${c} ${n}건`)
  }
  console.log(`     입력 고유성  ${dv.ok ? '🟢' : '🔴'} ${dv.reason}`)
  console.log(`     프롬프트 성립 ${records.filter((r) => r.promptOk).length}/${records.length}`)
  const fieldsN = records.filter((r) => r.gateFieldsComplete).length
  const runnableN = records.filter((r) => r.gateInputsOk).length
  // 🔴 둘을 나눠 적는다. "필드 전달 완료" 를 "관문 실행 가능" 으로 읽으면 안 된다
  console.log(`     Gate 필드 전달 ${fieldsN}/${records.length}`)
  console.log(`     🔴 Gate 실제 실행 가능 ${runnableN}/${records.length}`)
  const missAgg = new Map<string, number>()
  for (const r of records) for (const m of r.gateInputsMissing) missAgg.set(m, (missAgg.get(m) ?? 0) + 1)
  for (const [m, n] of [...missAgg].sort((a, b) => b[1] - a[1])) console.log(`       빠짐: ${m} (${n}건)`)
  const nrAgg = new Map<string, number>()
  for (const r of records) for (const g of r.willNotRun) nrAgg.set(g, (nrAgg.get(g) ?? 0) + 1)
  if (nrAgg.size > 0) {
    console.log(`       🔴 이대로면 notRun 될 관문: ${[...nrAgg].map(([g, n]) => `${g}×${n}`).join(' · ')}`)
  }

  mkdirSync('tmp', { recursive: true })
  writeFileSync(OUT, `${JSON.stringify({
    ranAt: now.toISOString(), mode: mode.mode,
    externalCallAllowed: REAL_POST_EXTERNAL_CALL_ALLOWED,
    called: false, calls: 0,
    // 🔴 남은 수량과 총 상한을 이름으로 나눠 적는다 — 하나로 적어 두 뜻으로 읽혔다
    publicAllowedToday: readiness.allowance.remaining,
    allowance: readiness.allowance,
    shadowLimit: readiness.shadowLimit,
    window, recentRoleCounts: material.recentRoleCounts,
    providerAllowed: material.providerAllowed, providerBlockers: material.providerBlockers,
    records,
  }, null, 2)}\n`, 'utf-8')
  console.log(`\n     기록 ${OUT} (🔴 gitignored · DB write 0 · 외부 호출 0)`)
}

console.log('\n  🔴 이 명령은 공개 댓글을 만들지 않았다 — Comment write 0 · Queue write 0 · 발행 0\n')
await prisma.$disconnect()
process.exit(0)
