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

import {
  buildCommentInput, judgeInputDiversity, voiceEvidenceFromAssets,
  type CommentInput,
} from '../src/lib/persona-comment-input'
import {
  judgeRatio, judgeReadiness, readRunMode, windowFromRows,
  RATIO_WINDOW_DAYS, type CommentWindow,
} from '../src/lib/persona-comment-governor'
import {
  planCommentDistribution, type PlannerPersona, type PlannerPost,
} from '../src/lib/persona-comment-planner'
import { COMMENT_REACTION_ROLES } from '../src/lib/persona-reaction-roles'
import { buildPromptFromInput, describeGateInput, toGateInput } from './lib/persona-comment-bridge'
import {
  judgeGateInputs, judgeRealPostExternalCall, REAL_POST_EXTERNAL_CALL_ALLOWED,
} from '../src/lib/persona-comment-gate-report'
import pg from 'pg'

import { loadUnaoReadonlyUrl } from './lib/voice-unao-readonly.mjs'
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
const postRows = await prisma.post.findMany({
  select: {
    id: true, status: true, title: true, content: true, boardType: true,
    publishAt: true, createdAt: true, category: true,
    persona: { select: { code: true } },
    comments: {
      where: { isDeleted: false },
      select: { commentOrigin: true, personaId: true, content: true },
    },
  },
})
const openTargets = new Set(
  (await prisma.personaApprovalQueue.findMany({
    where: { status: { in: ['PENDING', 'APPROVED'] } },
    select: { targetPostId: true },
  })).map((q) => q.targetPostId).filter((x): x is string => x !== null),
)

const posts: PlannerPost[] = postRows.map((p) => ({
  id: p.id,
  status: p.status,
  authorPersonaCode: p.persona?.code ?? null,
  memberComments: p.comments.filter((c) => c.commentOrigin === 'MEMBER' || c.commentOrigin === 'GUEST').length,
  personaComments: p.comments.filter((c) => c.commentOrigin === 'PERSONA').length,
  hasOpenQueue: openTargets.has(p.id),
  publishedAtMs: (p.publishAt ?? p.createdAt)?.getTime() ?? null,
  // 🔴 가입인사는 대화를 여는 자리가 아니다
  onHold: p.category === '가입인사',
  title: p.title,
  body: p.content,
}))

const personaRows = await prisma.persona.findMany({
  select: {
    id: true, code: true, status: true, identity: true, voiceCore: true, voiceVariations: true,
    ageBand: true, region: true, lifeStage: true, noGoTopics: true, noGoExpressions: true,
    forbiddenReactionRoles: true,
    // 🔴 실회원 판별 정본에 필요한 **두 값을 모두** 넣는다.
    //    하나라도 빠지면 judgeRealMember 가 unknown 으로 막는다(그것이 맞는 동작이다).
    user: { select: { providerId: true, _count: { select: { accounts: true } } } },
    comments: { where: { isDeleted: false }, select: { content: true, createdAt: true } },
  },
})

/** identity JSON 에서 생활사 축을 읽는다. 🔴 없으면 undefined 로 둔다 — 0 으로 보정하지 않는다 */
const lifeOf = (identity: unknown): PlannerPersona['life'] => {
  const id = (identity ?? {}) as Record<string, unknown>
  const num = (v: unknown): number | null | undefined => (typeof v === 'number' ? v : undefined)
  const str = (v: unknown): string | null | undefined => (typeof v === 'string' ? v : undefined)
  const bands = Array.isArray(id.childrenAgeBands)
    ? (id.childrenAgeBands as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined
  return {
    maritalStatus: str(id.maritalStatus),
    childrenCount: num(id.childrenCount),
    childrenAgeBands: bands as PlannerPersona['life']['childrenAgeBands'],
    parentCare: str(id.parentCare),
    menopauseStatus: str(id.menopauseStatus),
    workStatus: str(id.workStatus),
    economicStatus: str(id.economicStatus),
    region: str(id.region),
    noGoTopics: [],
    voiceLength: undefined,
  }
}

const personas: PlannerPersona[] = personaRows.map((p) => ({
  code: p.code,
  status: p.status,
  // 🔴 판정은 judgeRealMember 하나가 한다. 여기서 비교하지 않는다
  realMember: {
    accountCount: p.user?._count.accounts ?? null,
    providerId: p.user?.providerId ?? null,
  },
  seedComplete: p.identity !== null && p.voiceCore !== null && p.lifeStage !== null && p.lifeStage.trim() !== '',
  forbiddenReactionRoles: p.forbiddenReactionRoles,
  recentComments: p.comments.filter((c) => c.createdAt >= windowStart).length,
  life: { ...lifeOf(p.identity), noGoTopics: p.noGoTopics },
}))

/**
 * 🔴 **최근 역할 사용량을 읽어 넘긴다.**
 *    넘기지 않으면 프로세스가 새로 뜰 때마다 `empathy` 부터 다시 고른다 —
 *    회차가 바뀌어도 같은 역할만 나가고, 커뮤니티는 응원봇 하나를 보게 된다.
 */
const recentRoleCounts = await (async (): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {}
  try {
    for (const q of await prisma.personaApprovalQueue.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { reactionType: true },
    })) counts[q.reactionType] = (counts[q.reactionType] ?? 0) + 1
  } catch { /* 못 읽으면 빈 채로 — 편중 방지가 약해질 뿐 상한은 건드리지 않는다 */ }
  return counts
})()

const plan = planCommentDistribution({
  posts, personas,
  reactionRoles: COMMENT_REACTION_ROLES,
  // 🔴 shadow 회차는 shadowLimit 로 돈다. 공개 상한이 0 이어도 계획은 만들어진다
  limit: WANT_SHADOW ? readiness.shadowLimit : readiness.publicAllowedToday,
  nowMs,
  recentRoleCounts,
})

console.log(`\n  공개 글 ${posts.filter((p) => p.status === 'PUBLISHED').length}건`
  + ` · 살아 있는 댓글 0개 ${posts.filter((p) => p.status === 'PUBLISHED' && p.memberComments + p.personaComments === 0).length}건`)
console.log(`  Persona ${personas.length}명 · active ${personas.filter((p) => p.status === 'active').length}`
  + ` · seed 완전 ${personas.filter((p) => p.seedComplete).length}`)
console.log(`  최근 역할 사용  ${Object.keys(recentRoleCounts).length === 0 ? '(없음)' : Object.entries(recentRoleCounts).map(([k, v]) => `${k}=${v}`).join(' · ')}`)

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
   * 🔴 **Gate 입력을 여기서 갖춘다.**
   *    빠뜨리면 관문이 `notRun` 인 채로 9개가 채워져 "9관문 통과" 처럼 읽힌다.
   */
  // ⑥-A 회원 표시명 — 🔴 값은 찍지 않는다. `[]` 와 `undefined` 를 구별해 넘긴다
  const knownNames = await (async (): Promise<string[] | undefined> => {
    try {
      const users = await prisma.user.findMany({ select: { nickname: true, name: true } })
      return users.flatMap((u) => [u.nickname, u.name])
        .filter((v): v is string => v !== null && v.trim() !== '')
    } catch { return undefined }
  })()
  console.log(`     ⑥-A 회원 표시명 ${knownNames === undefined ? '🔴 조회 실패(undefined)' : `${knownNames.length}건`}`)

  /**
   * ② 댓글 코퍼스 빈도 — 🔴 우나어 read-only 에서 읽는다. 원문은 저장하지 않는다.
   *    dry-run 이 쓰는 것과 **같은 코퍼스**(댓글)다 — 본문 코퍼스로 재면
   *    "고생하셨어요" 같은 흔한 말이 고유 표현이 된다.
   */
  const corpus = await (async (): Promise<{ lookup: (n: string) => number; size: number } | null> => {
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
      return {
        size: bodies.length,
        lookup: (ngram: string): number => {
          let n = 0
          for (const b of bodies) if (b.includes(ngram)) { n += 1; if (n > 6) break }
          return n
        },
      }
    } catch { return null }
  })()
  console.log(`     ② 댓글 코퍼스 ${corpus === null ? '🔴 없음 — ② 가 notRun 이 된다' : `${corpus.size}건 (원문 미저장)`}`)

  const postById = new Map(postRows.map((p) => [p.id, p]))
  const personaById = new Map(personaRows.map((p) => [p.code, p]))
  const inputs: CommentInput[] = []
  const records: ShadowRecord[] = []
  const blockedInput: string[] = []

  for (const item of plan.items) {
    const pr = postById.get(item.postId)
    const pe = personaById.get(item.personaCode)
    if (pr === undefined || pe === undefined) continue

    const voice = voiceEvidenceFromAssets({
      voiceCore: pe.voiceCore,
      voiceVariations: pe.voiceVariations,
      recentTexts: pe.comments.map((c) => c.content),
    })
    const built = buildCommentInput({
      persona: {
        code: pe.code, ageBand: pe.ageBand, region: pe.region, lifeStage: pe.lifeStage,
        identity: pe.identity, voiceCore: pe.voiceCore, voiceVariations: pe.voiceVariations,
        noGoTopics: pe.noGoTopics, noGoExpressions: pe.noGoExpressions,
        forbiddenReactionRoles: pe.forbiddenReactionRoles,
      },
      post: {
        id: pr.id,
        title: pr.title,
        // 🔴 이것은 요약이 아니라 **원문 앞부분**이다. 그래서 외부로 나가지 않는다
        bodyDigest: pr.content.slice(0, DIGEST_CHARS),
        boardLabel: String(pr.boardType),
        existingCommentDigests: pr.comments.map((c) => c.content.slice(0, COMMENT_DIGEST_CHARS)),
      },
      reactionRole: item.reactionRole,
      voice,
      memory: { has: false, note: '' },
    })
    if (!built.ok) {
      for (const b of built.blocks) blockedInput.push(b.code)
      continue
    }
    inputs.push(built.input)

    const prompt = buildPromptFromInput(built.input, pe.comments.map((c) => c.content))

    /**
     * 🔴 **호출은 하지 않지만 Gate 입력은 갖춘다.**
     *    후보 텍스트가 없으므로 Gate 를 돌릴 수는 없다 — 대신 "돌릴 수 있는 상태인가" 를
     *    `judgeGateInputs` 로 판정한다. 이것이 `notRun` 을 미리 아는 방법이다.
     */
    /**
     * 🔴 **가짜 표지를 이전 발화로 세지 않는다.**
     *    옛 판은 배치 prior 자리에 뜻 없는 표지 문자열을 밀어 넣었다.
     *    그것은 발화가 아니라 글자이고, ⑧ 은 그것으로 말끝·시작어절을 잰다 —
     *    표본 수만 부풀려 관문이 돈 것처럼 보이게 만든다.
     *    이 회차는 후보 텍스트를 만들지 않으므로 **배치 prior 도 없다.**
     */
    const prior = pe.comments.map((c) => c.content)
    const gateInput = toGateInput({
      input: built.input,
      text: '(shadow — 생성물 없음)',
      sourceTexts: [pr.title, pr.content, ...pr.comments.map((c) => c.content)],
      knownNames,
      ...(corpus === null ? {} : { frequencyLookup: corpus.lookup, corpusName: 'comment' }),
      priorTexts: prior,
      seedUseCount: 1,
      // 🔴 명시한다. 없으면 ⑨ 가 notRun 이 된다
      adviceForbidden: false,
      sourceIsCafeOperational: false,
    })
    const readiness2 = judgeGateInputs(describeGateInput(gateInput))

    records.push({
      postId: item.postId, personaCode: item.personaCode, reactionRole: item.reactionRole,
      fingerprint: built.input.fingerprint, voiceSource: voice.source,
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
  console.log(`     입력 ${inputs.length}건 · 막힘 ${blockedInput.length}건`)
  if (blockedInput.length > 0) {
    const m = new Map<string, number>()
    for (const c of blockedInput) m.set(c, (m.get(c) ?? 0) + 1)
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
    publicAllowedToday: readiness.publicAllowedToday, shadowLimit: readiness.shadowLimit,
    window, recentRoleCounts, records,
  }, null, 2)}\n`, 'utf-8')
  console.log(`\n     기록 ${OUT} (🔴 gitignored · DB write 0 · 외부 호출 0)`)
}

console.log('\n  🔴 이 명령은 공개 댓글을 만들지 않았다 — Comment write 0 · Queue write 0 · 발행 0\n')
await prisma.$disconnect()
process.exit(0)
