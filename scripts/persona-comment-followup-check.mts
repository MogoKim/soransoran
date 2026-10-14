#!/usr/bin/env tsx
/**
 * 글당 Persona 추가 댓글(첫 댓글 뒤 0~4건) 검사 — 🔴 DB · provider · 네트워크 · env 파일 · launchd 없음
 *
 *   npx tsx scripts/persona-comment-followup-check.mts
 *
 * 무엇을 잠그나
 *   ① 스위치 기본 OFF · 오타로 켜지지 않는다
 *   ② fixture 시나리오(scripts/fixtures/persona-comment-followup) — GO · WAIT · STOP · BLOCK
 *   ③ 회차 판정 — kill switch · 첫 댓글 양보 · 공유 장부의 첫 댓글 몫 · 상한 · 모르면 0
 *   ④ 24시간 시뮬레이션 불변식 — 글당 ≤5 · 같은 Persona 0 · 자기 글 0 · 시간차 · 실회원 우선 ·
 *      추가 댓글마다 그때 미해결이던 hook 하나를 소비 · 근거 없는 글은 0 · 글 id 무관 · 같은 입력 같은 결과
 *   ③ profile — 주입 없음·후보·손상·단계 불일치 → 0 · D100 profile 은 40건에 묶이지 않는다
 *   ⑤ 실제 소비자 접점 — #707 정본(`personaCommentProvenanceOf` · `FOLLOWUP_LANE_*` · `judgeConversationAudit`)을
 *      그대로 쓰는가 · 대화 감사 FAIL/판독 불가 → 추가 댓글 0 · 첫 댓글 경로는 이 모듈을 보지 않는다
 *      깨진 출처로도 보지 않는다 · bootstrap-auto 상한 1 이 활성화 선행조건임을 실행으로 드러낸다
 *   ⑥ 본문 중복 · Queue 도장
 *
 * 🔴 변이 시험(`persona-comment-followup-mutation.mts`)이 `FOLLOWUP_MODULE` 로 변이 모듈을 주입한다.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type * as FollowupModule from '../src/lib/persona-comment-followup'
import type { ReactionType } from '../src/lib/persona-reaction-roles'
import {
  FOLLOWUP_LANE_ACTIVITY_DECIDED_BY, FOLLOWUP_LANE_DECIDED_BY, commentProvenanceOf, judgeConversationAudit,
  personaCommentCapFor, personaCommentProvenanceOf, type CommentLinkFacts, type EvidencePost,
} from '../src/lib/stage-evidence'
import { AUTO_LANE_ACTIVITY_DECIDED_BY, AUTO_LANE_DECIDED_BY } from '../src/lib/persona-comment-auto-lane'
import { toPromptPost } from './lib/persona-comment-bridge'
import { sourceTextsOf } from './lib/persona-comment-targets'
import type { CommentInput } from '../src/lib/persona-comment-input'
import { decisionStageEnv } from '../src/lib/scale-runtime'
import { kstDateString } from '../src/lib/release-canary'
import { followupEligibleFor } from './lib/persona-comment-followup-run.mjs'
import { COMMENT_CONSUMER_BY, renderCommentRunnerPlist } from './lib/persona-comment-runner-template'
import { DECISION_CONSUMERS } from '../src/lib/stage-decision-store'

const here = dirname(fileURLToPath(import.meta.url))
const modulePath = process.env.FOLLOWUP_MODULE ?? join(here, '../src/lib/persona-comment-followup.ts')
const M = (await import(modulePath)) as typeof FollowupModule

let failures = 0
const lines: string[] = []
const check = (name: string, cond: boolean, detail = ''): void => {
  if (!cond) failures++
  lines.push(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const MIN = 60_000
const T0 = Date.parse('2026-10-13T00:00:00Z')

// 🔴 글 id 는 판정의 필요성에 쓰이지 않는다 — 시나리오는 고정 id 하나로 돈다(④에서 id 무관성을 따로 잠근다)
const FX_POST = 'post-fx'

type FxComment = {
  id: string; atMin: number; parent?: string; origin: 'PERSONA' | 'MEMBER' | 'GUEST'
  persona?: string; member?: string; reaction: ReactionType | null
  provenance?: 'auto' | 'followup' | 'none' | 'broken'; reported?: boolean; deleted?: boolean
}
type FxScenario = {
  name: string; nowMin: number
  post: { postReaction: ReactionType | null; autoManaged?: boolean; hasOpenQueue?: boolean; author?: string }
  comments: FxComment[]
  expect: { verdict: string; ordinal?: number; targetKind?: 'post' | 'reply'; targetId?: string; reasonIncludes?: string }
}

const rowOf = (postId: string, c: FxComment): FollowupModule.FollowupCommentRow => ({
  id: c.id, postId, parentId: c.parent ?? null, createdAt: new Date(T0 + c.atMin * MIN),
  isDeleted: c.deleted === true,
  authorId: c.origin === 'MEMBER' ? (c.member ?? 'u-x') : null,
  commentOrigin: c.origin, personaId: c.origin === 'PERSONA' ? (c.persona ?? null) : null, operatorWriterId: null,
  reaction: c.reaction, reported: c.reported ?? false,
  provenance: c.origin === 'PERSONA' ? (c.provenance ?? null) : null,
})

const factsOf = (postId: string, s: Pick<FxScenario, 'post' | 'comments'>): FollowupModule.FollowupPostFacts => ({
  postId, publishedAtMs: T0, postStatus: 'PUBLISHED',
  authorPersonaId: s.post.author ?? 'pA',
  autoManagedPost: s.post.autoManaged ?? true,
  postReaction: s.post.postReaction,
  comments: s.comments.map((c) => rowOf(postId, c)),
  hasOpenQueue: s.post.hasOpenQueue ?? false,
})

// ═════════ ① 스위치 ═════════
check('① 미설정 → OFF', M.readFollowupSwitch({}).enabled === false)
for (const v of ['1', 'true', 'ON', 'On', 'yes', 'enabled', ' on2']) {
  check(`① ${JSON.stringify(v)} → OFF`, M.readFollowupSwitch({ [M.FOLLOWUP_SWITCH_ENV]: v }).enabled === false)
}
check('① 정확히 on → ON', M.readFollowupSwitch({ [M.FOLLOWUP_SWITCH_ENV]: 'on' }).enabled === true)
check('① 추가 상한 = 5 − 1 = 4', M.FOLLOWUP_EXTRA_PER_POST_MAX === 4 && M.FOLLOWUP_TOTAL_PER_POST_MAX === 5)

// ═════════ ② fixture 시나리오 ═════════
type FxProfiles = {
  approved: Record<string, unknown>; approvedD100: Record<string, unknown>
  broken: { name: string; runtimeStage: string | null; profile?: unknown; patch?: Record<string, unknown> }[]
}
const fx = JSON.parse(readFileSync(join(here, 'fixtures/persona-comment-followup/scenarios.json'), 'utf-8')) as { scenarios: FxScenario[]; profiles: FxProfiles; firstCommentPrompt: { sha256: string } }
check('② fixture 시나리오가 있다', fx.scenarios.length >= 20, `${fx.scenarios.length}건`)
for (const s of fx.scenarios) {
  const postId = FX_POST
  const v = M.judgeFollowupPost(factsOf(postId, s), T0 + s.nowMin * MIN)
  const e = s.expect
  let ok = v.verdict === e.verdict
  if (ok && e.reasonIncludes !== undefined) ok = v.reason.includes(e.reasonIncludes)
  if (ok && v.verdict === 'GO') {
    if (e.ordinal !== undefined) ok = v.ordinal === e.ordinal
    if (ok && e.targetKind !== undefined) ok = v.target.kind === e.targetKind
    if (ok && e.targetId !== undefined) ok = v.target.kind === 'reply' && v.target.commentId === e.targetId
    if (ok) ok = v.key === M.followupKeyOf(postId, v.ordinal)
    // 🔴 GO 의 제외 목록에는 글쓴이와 이미 단 Persona 가 전부 있다
    if (ok) {
      const must = new Set([s.post.author ?? 'pA', ...s.comments.filter((c) => c.origin === 'PERSONA' && c.persona).map((c) => c.persona as string)])
      ok = [...must].every((p) => v.excludePersonaIds.includes(p))
    }
  }
  check(`② ${s.name}`, ok, `${v.verdict} · ${v.reason}`)
}

// ═════════ ③ 회차 판정 ═════════
const baseTick: FollowupModule.FollowupTickFacts = {
  switch: { enabled: true, reason: 'on' }, commentStage: 'bootstrap-auto', killSwitchOff: true,
  pendingFirstComments: 0, profile: fx.profiles.approved, runtimeStage: 'd10',
  followupsToday: 0, followupUsdToday: 0, commentLedgerRemainingUsd: 0.2, firstCommentReserveUsd: 0.02,
  perCallReserveUsd: 0.001, conversationAudit: { verdict: 'PASS', codes: [], counts: {} },
}
const tick = (over: Partial<FollowupModule.FollowupTickFacts>) => M.judgeFollowupTick({ ...baseTick, ...over })
check('③ 승인 profile(d10) → 회차 상한 3', tick({}).allowed === 3)
check('③ 스위치 OFF → 0', tick({ switch: M.readFollowupSwitch({}) }).allowed === 0)
check('③ 댓글 단계 shadow → 0', tick({ commentStage: 'shadow' }).allowed === 0)
check('③ 댓글 단계 organic → 0 (이 판은 무인 레인 위에서만)', tick({ commentStage: 'organic' }).allowed === 0)
check('③ kill switch 켜짐 → 0', tick({ killSwitchOff: false }).allowed === 0)
check('③ kill switch 모름 → 0', tick({ killSwitchOff: null }).allowed === 0)
check('③ 첫 댓글 대기 1편 → 0 (첫 댓글에 양보)', tick({ pendingFirstComments: 1 }).allowed === 0)
check('③ 첫 댓글 대기 수 모름 → 0', tick({ pendingFirstComments: null }).allowed === 0)
check('③ 오늘 수 모름 → 0', tick({ followupsToday: null }).allowed === 0)
check('③ 하루 건수 소진 → 0', tick({ followupsToday: 40 }).allowed === 0)
check('③ 하루 건수 잔량 1 → 1', tick({ followupsToday: 39 }).allowed === 1)
check('③ 자기 USD 몫 소진 → 0', tick({ followupUsdToday: 0.08 }).allowed === 0)
check('③ 🔴 공유 장부 잔량이 첫 댓글 몫뿐 → 0',
  tick({ commentLedgerRemainingUsd: 0.02, firstCommentReserveUsd: 0.02 }).allowed === 0)
check('③ 공유 장부에서 첫 댓글 몫을 뺀 잔량 0.0025 → 2',
  tick({ commentLedgerRemainingUsd: 0.0225, firstCommentReserveUsd: 0.02 }).allowed === 2)
check('③ 비용 값 NaN → 0', tick({ commentLedgerRemainingUsd: Number.NaN }).allowed === 0)
check('③ 예약액 0 → 0', tick({ perCallReserveUsd: 0 }).allowed === 0)
// ── profile 주입 · 손상 ──
check('③ 🔴 canary 후보는 승인 전이라 쓰지 않는다',
  !M.validateFollowupProfile(M.FOLLOWUP_CANARY_PROFILE_CANDIDATE, 'canary').ok
  && tick({ profile: M.FOLLOWUP_CANARY_PROFILE_CANDIDATE, runtimeStage: 'canary' }).allowed === 0)
check('③ 후보 숫자는 40건·$0.08 (상한이 아니라 후보값)',
  M.FOLLOWUP_CANARY_PROFILE_CANDIDATE.dailyCount === 40 && M.FOLLOWUP_CANARY_PROFILE_CANDIDATE.dailyUsd === 0.08)
for (const b of fx.profiles.broken) {
  const profile = b.profile === 'CANDIDATE' ? M.FOLLOWUP_CANARY_PROFILE_CANDIDATE
    : b.patch !== undefined ? { ...fx.profiles.approved, ...b.patch } : b.profile
  const v = M.validateFollowupProfile(profile, b.runtimeStage)
  check(`③ 🔴 profile ${b.name} → 0건`, !v.ok && tick({ profile, runtimeStage: b.runtimeStage }).allowed === 0, v.ok ? '통과해 버렸다' : v.reason)
}
{
  // 🔴 D100 은 40건·$0.08 에 묶이지 않는다 — 승인된 D100 profile 이 정한다
  const d100 = (over: Partial<FollowupModule.FollowupTickFacts>) => tick({
    profile: fx.profiles.approvedD100, runtimeStage: 'd100', commentLedgerRemainingUsd: 2, firstCommentReserveUsd: 0.1, ...over,
  })
  check('③ D100 승인 profile → 회차 20', d100({}).allowed === 20, d100({}).detail)
  check('③ D100 승인 profile → 오늘 41번째도 허용(40 고정 아님)', d100({ followupsToday: 40, followupUsdToday: 0.04 }).allowed === 20)
  check('③ D100 profile 을 D10 날에 주입 → 0', tick({ profile: fx.profiles.approvedD100, runtimeStage: 'd10' }).allowed === 0)
  check('③ 🔴 D100 이어도 첫 댓글 대기 → 0', d100({ pendingFirstComments: 2 }).allowed === 0)
  check('③ 🔴 D100 이어도 공유 장부 잔량 = 첫 댓글 몫 → 0', d100({ commentLedgerRemainingUsd: 0.1 }).allowed === 0)
  check('③ D100 하루 건수 300 소진 → 0', d100({ followupsToday: 300 }).allowed === 0)
}

// ═════════ ④ 24시간 시뮬레이션 ═════════
const PERSONAS = Array.from({ length: 30 }, (_, i) => `p${String(i).padStart(2, '0')}`)
const HOOK_DRAW: readonly ReactionType[] = ['other', 'other', 'other', 'empathy', 'question', 'experience', 'other', 'question']

type SimResult = { perPost: Map<string, FollowupModule.FollowupCommentRow[]>; violations: string[]; trace: string; postReaction: Map<string, ReactionType> }

function simulate(opts: { posts: number; salt: string; members?: (postId: string) => number; profile?: Record<string, unknown>; stage?: string }): SimResult {
  const profile = opts.profile ?? fx.profiles.approved
  const stage = opts.stage ?? 'd10'
  const perPersonaMax = profile.perPersonaDailyMax as number
  const runMax = profile.runMax as number
  const violations: string[] = []
  const perPost = new Map<string, FollowupModule.FollowupCommentRow[]>()
  const author = new Map<string, string>()
  const postReaction = new Map<string, ReactionType>()
  const trace: string[] = []
  for (let i = 0; i < opts.posts; i++) {
    const postId = `sim-${opts.salt}-${i}`
    const a = PERSONAS[Math.floor(M.unitOf('sim-author', postId) * PERSONAS.length)]!
    author.set(postId, a)
    postReaction.set(postId, HOOK_DRAW[Math.floor(M.unitOf('sim-post', postId) * HOOK_DRAW.length)]!)
    const rows: FollowupModule.FollowupCommentRow[] = []
    const members = opts.members?.(postId) ?? 0
    for (let m = 0; m < members; m++) {
      rows.push({
        id: `${postId}-m${m}`, postId, parentId: null, createdAt: new Date(T0 + (2 + m) * MIN), isDeleted: false,
        authorId: `u${m}`, commentOrigin: 'MEMBER', personaId: null, operatorWriterId: null,
        reaction: 'experience', reported: false, provenance: null,
      })
    }
    // 첫 댓글 — 자동 레인이 10~50분에 단다
    const first = PERSONAS.find((p) => p !== a && M.unitOf('sim-first', postId, p) < 0.2) ?? PERSONAS.find((p) => p !== a)!
    rows.push({
      id: `${postId}-c1`, postId, parentId: null, createdAt: new Date(T0 + (10 + Math.floor(M.unitOf('sim-first-at', postId) * 40)) * MIN),
      isDeleted: false, authorId: null, commentOrigin: 'PERSONA', personaId: first, operatorWriterId: null,
      reaction: HOOK_DRAW[Math.floor(M.unitOf('sim-first-r', postId) * HOOK_DRAW.length)]!, reported: false, provenance: 'auto',
    })
    perPost.set(postId, rows)
  }
  const followupsByPersona = new Map<string, number>()
  let followupsToday = 0
  for (let t = 60; t <= 26 * 60; t += 15) {
    const nowMs = T0 + t * MIN
    const allowed = M.judgeFollowupTick({
      ...baseTick, profile, runtimeStage: stage, followupsToday, followupUsdToday: followupsToday * 0.001,
      commentLedgerRemainingUsd: 5, firstCommentReserveUsd: 0.02,
    }).allowed
    let used = 0
    const goPosts = new Set<string>()
    const ready: { postId: string; go: Extract<FollowupModule.FollowupPostVerdict, { verdict: 'GO' }> }[] = []
    for (const [postId, rows] of perPost) {
      const v = M.judgeFollowupPost({
        postId, publishedAtMs: T0, postStatus: 'PUBLISHED', authorPersonaId: author.get(postId)!, autoManagedPost: true,
        postReaction: postReaction.get(postId)!, comments: rows, hasOpenQueue: false,
      }, nowMs)
      if (v.verdict === 'GO') ready.push({ postId, go: v })
    }
    for (const { postId, go: v } of M.orderFollowupGo(ready)) {
      if (used >= allowed) break
      const rows = perPost.get(postId)!
      if (goPosts.has(postId)) violations.push(`${postId} 한 회차 두 건`)
      // 🔴 소비 기록 — 그 순간 대상이 미해결 hook 이었는가
      const before = perPost.get(postId)!
      if (v.target.kind === 'reply') {
        const tid = v.target.commentId
        const parent = before.find((x) => x.id === tid)
        if (parent === undefined || parent.reaction === null || !M.FOLLOWUP_HOOKS.includes(parent.reaction)) violations.push(`${postId} hook 아닌 대상`)
        if (before.some((x) => x.parentId === tid)) violations.push(`${postId} 이미 답한 대상 재소비`)
      } else {
        if (!M.FOLLOWUP_HOOKS.includes(postReaction.get(postId)!)) violations.push(`${postId} hook 없는 글에 최상위 추가`)
        if (before.some((x) => x.parentId === null && x.provenance === 'followup')) violations.push(`${postId} 글 hook 재소비`)
      }
      const pick = M.pickFollowupPersona(v, postId, PERSONAS.map((p) => ({ personaId: p, eligible: true, followupsToday: followupsByPersona.get(p) ?? 0 })), perPersonaMax)
      if (pick.personaId === null) continue
      goPosts.add(postId)
      used++
      followupsToday++
      followupsByPersona.set(pick.personaId, (followupsByPersona.get(pick.personaId) ?? 0) + 1)
      const id = `${postId}-c${v.ordinal}`
      if (v.key !== M.followupKeyOf(postId, v.ordinal)) violations.push(`${postId} 멱등 열쇠 불일치`)
      rows.push({
        id, postId, parentId: v.target.kind === 'reply' ? v.target.commentId : null, createdAt: new Date(nowMs),
        isDeleted: false, authorId: null, commentOrigin: 'PERSONA', personaId: pick.personaId, operatorWriterId: null,
        reaction: HOOK_DRAW[Math.floor(M.unitOf('sim-r', id) * HOOK_DRAW.length)]!, reported: false, provenance: 'followup',
      })
      trace.push(`${t}:${id}:${pick.personaId}`)
    }
    if (used > runMax) violations.push(`회차 ${t} 에 ${used}건`)
  }
  // 불변식
  for (const [postId, rows] of perPost) {
    const persona = rows.filter((r) => r.commentOrigin === 'PERSONA').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const members = rows.filter((r) => r.commentOrigin !== 'PERSONA').length
    if (persona.length > 5) violations.push(`${postId} Persona ${persona.length}건`)
    const ids = persona.map((r) => r.personaId)
    if (new Set(ids).size !== ids.length) violations.push(`${postId} 같은 Persona 반복`)
    if (ids.includes(author.get(postId)!)) violations.push(`${postId} 자기 글 댓글`)
    for (let k = 1; k < persona.length; k++) {
      if (persona[k]!.createdAt.getTime() - persona[k - 1]!.createdAt.getTime() < M.FOLLOWUP_MIN_GAP_MS) violations.push(`${postId} 시간차 미달`)
      if (persona[k]!.createdAt.getTime() - T0 > M.FOLLOWUP_POST_AGE_MAX_MS) violations.push(`${postId} 식은 글에 이음`)
    }
    const extras = persona.length - 1
    const first = persona[0]!
    const noGround = !M.FOLLOWUP_HOOKS.includes(postReaction.get(postId)!)
      && (first.reaction === null || !M.FOLLOWUP_HOOKS.includes(first.reaction))
    if (noGround && extras > 0) violations.push(`${postId} 🔴 근거 없는 글에 추가 ${extras}건`)
    if (extras > M.FOLLOWUP_EXTRA_PER_POST_MAX) violations.push(`${postId} 추가 ${extras}건`)
    if (members >= 3 && extras > 0) violations.push(`${postId} 실회원 3건 글에 추가`)
    if (members > 0 && extras > M.FOLLOWUP_EXTRA_WITH_MEMBERS_MAX) violations.push(`${postId} 실회원 글에 추가 ${extras}건`)
    for (const r of persona) {
      if (r.parentId === null) continue
      const parent = rows.find((x) => x.id === r.parentId)
      if (parent === undefined) violations.push(`${postId} 고아 답글`)
      else if (parent.commentOrigin !== 'PERSONA') violations.push(`${postId} 실회원 댓글에 답함`)
      else if (parent.personaId === r.personaId) violations.push(`${postId} 자기 댓글에 답함`)
    }
  }
  for (const [p, n] of followupsByPersona) if (n > perPersonaMax) violations.push(`${p} 하루 ${n}건`)
  return { perPost, violations, trace: trace.join('|'), postReaction }
}

{
  const a = simulate({ posts: 10, salt: 'd10' })
  check('④ D10 24시간 불변식 위반 0', a.violations.length === 0, a.violations.slice(0, 3).join(' · '))
  const b = simulate({ posts: 10, salt: 'd10' })
  check('④ 같은 입력 → 같은 결과(멱등 · 결정적)', a.trace === b.trace && a.trace.length > 0)
  const counts = [...a.perPost.values()].map((rows) => rows.filter((r) => r.commentOrigin === 'PERSONA').length)
  check('④ D10 글마다 Persona 1~5건', counts.every((n) => n >= 1 && n <= 5), counts.join(','))
  check('④ D10 모든 글을 같은 수로 맞추지 않는다', new Set(counts).size > 1, counts.join(','))

  // 🔴 근거가 있는 글은 상한이 묶이지 않는 한 실제로 잇는다(필요성을 해시가 지우지 않는다)
  const grounded = [...a.perPost.entries()].filter(([id, rows]) =>
    M.FOLLOWUP_HOOKS.includes(a.postReaction.get(id)!)
    || M.FOLLOWUP_HOOKS.includes(rows.find((r) => r.provenance === 'auto')!.reaction as ReactionType))
  const groundedExtras = grounded.map(([, rows]) => rows.filter((r) => r.provenance === 'followup').length)
  check('④ 🔴 D10 근거 있는 글은 전부 1건 이상 이어진다', grounded.length > 0 && groundedExtras.every((n) => n >= 1),
    `${grounded.length}편 · ${groundedExtras.join(',')}`)

  const big = simulate({ posts: 100, salt: 'd100', profile: fx.profiles.approvedD100, stage: 'd100' })
  check('④ D100(승인 profile) 24시간 불변식 위반 0', big.violations.length === 0, big.violations.slice(0, 3).join(' · '))
  const bc = [...big.perPost.values()].map((rows) => rows.filter((r) => r.commentOrigin === 'PERSONA').length)
  const extrasTotal = bc.reduce((s, n) => s + n - 1, 0)
  check('④ D100 하루 추가 ≤ 그 profile 의 하루 건수', extrasTotal <= (fx.profiles.approvedD100.dailyCount as number), `${extrasTotal}건`)
  check('④ 🔴 D100 은 40건에 묶이지 않는다', extrasTotal > 40, `${extrasTotal}건`)
  check('④ D100 첫 댓글로 끝난 글(근거 없음)이 있다', bc.filter((n) => n === 1).length > 0, `${bc.filter((n) => n === 1).length}/100`)

  // 🔴 상한이 묶일 때 앞 글이 독차지하지 않는다 — d10 profile(40건)로 100편
  const tight = simulate({ posts: 100, salt: 'tight', profile: { ...fx.profiles.approved, stage: 'd10' } })
  const tc = [...tight.perPost.values()].map((rows) => rows.filter((r) => r.commentOrigin === 'PERSONA').length)
  const spread = tc.filter((n) => n >= 2).length
  check('④ 🔴 상한이 묶여도 앞 글이 독차지하지 않는다(추가 받은 글 ≥ 30)', tight.violations.length === 0 && spread >= 30, `${spread}/100`)

  // 🔴 글 id 무관 — 같은 대화 사실이면 글 id 가 달라도 필요성·대상·순번이 같다
  {
    const base = fx.scenarios[0]!
    const sig = (id: string) => {
      const v = M.judgeFollowupPost(factsOf(id, base), T0 + 200 * MIN)
      return v.verdict === 'GO' ? `GO:${v.ordinal}:${v.target.kind}:${v.target.kind === 'reply' ? v.target.commentId : ''}:${v.openHooks}` : v.verdict
    }
    // 첫 댓글(10분) + 최소 30분 + jitter 최대 40분이 다 지나고 24시간 안인 200분에 판정한다
    const sigs = new Set(Array.from({ length: 300 }, (_, i) => sig(`any-${i}`)))
    check('④ 🔴 필요성은 글 id 와 무관하다(300개 id 판정 동일)', sigs.size === 1 && [...sigs][0]!.startsWith('GO'), [...sigs].join(' | '))
    const none = { ...base, post: { postReaction: 'other' as ReactionType }, comments: base.comments.map((c) => ({ ...c, reaction: 'other' as ReactionType })) }
    const zero = Array.from({ length: 300 }, (_, i) => M.judgeFollowupPost(factsOf(`any-${i}`, none), T0 + 200 * MIN).verdict)
    check('④ 🔴 근거가 없으면 어떤 글 id 든 0(STOP)', zero.every((v) => v === 'STOP'))
  }

  // 🔴 회차 자리 순서 — 추가가 적은 글이 먼저다(해시 순서만으로는 이 계약을 증명할 수 없다)
  {
    const g = (postId: string, extras: number) => ({
      postId,
      go: { verdict: 'GO' as const, ordinal: extras + 2, extrasSoFar: extras, openHooks: 1, key: M.followupKeyOf(postId, extras + 2),
        target: { kind: 'post' as const, hook: 'question' as const }, excludePersonaIds: [], roles: ['other' as const], reason: '' },
    })
    let allOk = true
    for (let i = 0; i < 50; i++) {
      const items = [g(`o-${i}-a`, 3), g(`o-${i}-b`, 0), g(`o-${i}-c`, 2), g(`o-${i}-d`, 1), g(`o-${i}-e`, 0)]
      const order = M.orderFollowupGo(items).map((x) => x.go.extrasSoFar)
      if (order.join(',') !== '0,0,1,2,3') allOk = false
    }
    check('④ 🔴 회차 자리는 추가 댓글이 적은 글부터', allOk)
  }
  const withMembers = simulate({ posts: 30, salt: 'mem', members: (id) => (M.unitOf('m', id) < 0.5 ? 1 : 3) })
  check('④ 실회원 글 불변식 위반 0', withMembers.violations.length === 0, withMembers.violations.slice(0, 3).join(' · '))

}

// ═════════ ⑤ 실제 소비자 접점 — #707 정본 · 대화 감사 브레이크 ═════════
{
  const link = (queueBy: string | null, logBy: string | null, over: Partial<CommentLinkFacts['comment']> = {}): CommentLinkFacts => ({
    comment: { postId: 'P', personaId: 'pX', createdAtMs: T0 + 200 * MIN, topLevel: false, ...over },
    queues: queueBy === null ? [] : [{ targetPostId: 'P', personaId: 'pX', status: 'PUBLISHED', decidedBy: queueBy, decidedAtMs: T0 + 200 * MIN }],
    logs: logBy === null ? [] : [{ personaId: 'pX', decidedBy: logBy, publishedAtMs: T0 + 200 * MIN }],
  })
  // 🔴 모듈이 자체 표식·분류기를 더는 갖지 않는다 — 정본이 하나다
  const exported = Object.keys(M)
  check('⑤ 🔴 자체 표식 상수·분류기 없음(정본 단일화)',
    !['FOLLOWUP_DECIDED_BY', 'FOLLOWUP_ACTIVITY_DECIDED_BY', 'followupProvenanceOf'].some((k) => exported.includes(k)))
  const src = readFileSync(join(here, '../src/lib/persona-comment-followup.ts'), 'utf-8')
  check('⑤ 🔴 모듈 소스에 표식 문자열 리터럴이 다시 생기지 않았다',
    !src.includes("'machine:persona-comment-followup'") && !src.includes("'auto-followup'"))
  check('⑤ 정본 표식이 첫 댓글 표식과 다르다',
    (FOLLOWUP_LANE_DECIDED_BY as string) !== AUTO_LANE_DECIDED_BY
    && (FOLLOWUP_LANE_ACTIVITY_DECIDED_BY as string) !== AUTO_LANE_ACTIVITY_DECIDED_BY)
  const fu = link(FOLLOWUP_LANE_DECIDED_BY, FOLLOWUP_LANE_ACTIVITY_DECIDED_BY)
  check('⑤ 정본 분류: 추가 댓글 → followup · 첫 댓글 축(commentProvenanceOf)은 none',
    personaCommentProvenanceOf(fu) === 'followup' && commentProvenanceOf(fu) === 'none')
  check('⑤ 정본 분류: 표식 섞임 → broken(첫 댓글 축 FAIL)',
    personaCommentProvenanceOf(link(FOLLOWUP_LANE_DECIDED_BY, AUTO_LANE_ACTIVITY_DECIDED_BY)) === 'broken')
  check('⑤ 정본 분류: 추가 댓글 로그 누락 → followup-broken',
    personaCommentProvenanceOf(link(FOLLOWUP_LANE_DECIDED_BY, null)) === 'followup-broken')
  check('⑤ #707 이후에도 bootstrap-auto 단계 상한 1 은 그대로(추가 댓글은 상한 밖에서 따로 센다)',
    personaCommentCapFor('bootstrap-auto') === 1)

  // ── 정본 분류 결과를 모듈 입력으로 — followup-broken 이 있는 글은 BLOCK ──
  {
    const base = fx.scenarios[0]!
    const rows = factsOf(FX_POST, base)
    const withBroken: FollowupModule.FollowupPostFacts = {
      ...rows,
      comments: [...rows.comments, { ...rows.comments[0]!, id: 'fb', parentId: 'c1', personaId: 'pQ', createdAt: new Date(T0 + 90 * MIN), provenance: 'followup-broken' }],
    }
    check('⑤ 🔴 출처가 깨진 추가 댓글(followup-broken)이 있는 글 → BLOCK', M.judgeFollowupPost(withBroken, T0 + 200 * MIN).verdict === 'BLOCK')
  }

  // ── 대화 감사 브레이크 — 실제 judgeConversationAudit 출력을 그대로 넣는다 ──
  const ep = (personaComments: EvidencePost['personaComments'], author: string | null = 'pA'): EvidencePost => ({
    postId: 'P', queueId: 'Q', publishedAtMs: T0, unattended: true, queueRows: 1, publishLogs: 1,
    authorPersonaId: author, decider: 'auto', personaComments, release: 'STAMPED_ELIGIBLE',
  })
  const first = { personaId: 'pB', createdAtMs: T0 + 10 * MIN, topLevel: true, provenance: 'auto' as const }
  const good = judgeConversationAudit([ep([first, { personaId: 'pC', createdAtMs: T0 + 90 * MIN, topLevel: false, provenance: 'followup' }])])
  const none = judgeConversationAudit([ep([first])])
  check('⑤ 실제 감사 PASS(추가 댓글 정상) → 회차 허용', good.verdict === 'PASS' && tick({ conversationAudit: good }).allowed === 3)
  check('⑤ 실제 감사 PASS(추가 댓글 0 — 아직 켠 적 없음) → 회차 허용', none.verdict === 'PASS' && tick({ conversationAudit: none }).allowed === 3)
  const failCases: [string, EvidencePost][] = [
    ['출처 깨짐', ep([first, { personaId: 'pC', createdAtMs: T0 + 90 * MIN, topLevel: false, provenance: 'followup-broken' }])],
    ['첫 댓글 없음', ep([{ personaId: 'pC', createdAtMs: T0 + 90 * MIN, topLevel: false, provenance: 'followup' }])],
    ['같은 Persona', ep([first, { personaId: 'pB', createdAtMs: T0 + 90 * MIN, topLevel: false, provenance: 'followup' }])],
    ['자기 글', ep([first, { personaId: 'pA', createdAtMs: T0 + 90 * MIN, topLevel: false, provenance: 'followup' }])],
    ['총 6건', ep([first, ...['p1', 'p2', 'p3', 'p4', 'p5'].map((p, i) => ({ personaId: p, createdAtMs: T0 + (90 + i * 40) * MIN, topLevel: false, provenance: 'followup' as const }))])],
  ]
  for (const [name, post] of failCases) {
    const a = judgeConversationAudit([post])
    const t = tick({ conversationAudit: a })
    check(`⑤ 🔴 실제 감사 FAIL(${name}) → 추가 댓글 0`, a.verdict === 'FAIL' && t.allowed === 0 && t.blockers.some((b) => b.includes('대화 감사 FAIL')), a.codes.join(','))
  }
  const unreadable: [string, unknown][] = [
    ['없음(undefined)', undefined], ['null', null], ['문자열 PASS', 'PASS'], ['소문자 pass', { verdict: 'pass', codes: [] }],
    ['codes 없음', { verdict: 'PASS' }], ['PASS 인데 코드 있음', { verdict: 'PASS', codes: ['FOLLOWUP_SELF'] }],
    ['모르는 코드', { verdict: 'FAIL', codes: ['COMMENT_MISSING'] }], ['verdict UNKNOWN', { verdict: 'UNKNOWN', codes: [] }],
  ]
  for (const [name, raw] of unreadable) {
    check(`⑤ 🔴 대화 감사 판독 불가(${name}) → 추가 댓글 0`, tick({ conversationAudit: raw }).allowed === 0)
  }
  // 🔴 첫 댓글 경로는 대화 감사를 보지 않는다 — 브레이크가 첫 댓글을 멈출 수 없다
  //    (러너는 추가 댓글 단계를 부르기 위해 이 모듈을 import 한다 — 금지할 것은 import 가 아니라 순서·참조다)
  const autoLane = readFileSync(join(here, '../src/lib/persona-comment-auto-lane.ts'), 'utf-8')
  const loop = readFileSync(join(here, 'lib/persona-comment-loop.mts'), 'utf-8')
  check('⑤ 🔴 첫 댓글 레인 규칙(auto-lane)은 추가 댓글 모듈·대화 감사를 import 하지 않는다',
    !autoLane.includes('persona-comment-followup') && !autoLane.includes('ConversationAudit'))
  check('⑤ 🔴 러너는 대화 감사를 직접 참조하지 않고, 추가 댓글 단계는 첫 댓글 sweep 뒤에서만 부른다',
    !loop.includes('judgeConversationAudit') && !loop.includes('conversationAudit')
    && loop.indexOf('const sweepAfter = await sweepAutoLane') > 0
    && loop.indexOf('await deps.followupPhase()') > loop.indexOf('const sweepAfter = await sweepAutoLane'))
}

// ═════════ ⑥ 본문 · 도장 · Persona 고르기 ═════════
const normalizeDiffers = (a: string, b: string): boolean => {
  const x = M.normalizeForDup(a)
  const y = M.normalizeForDup(b)
  return x !== y && x.slice(0, M.FOLLOWUP_SAME_OPENING_CHARS) !== y.slice(0, M.FOLLOWUP_SAME_OPENING_CHARS)
}
{
  const ex = [{ text: '저도 그랬어요. 밤에 잠이 안 와서 고생했네요', persona: true }, { text: '병원은 어디 다니세요?', persona: false }]
  check('⑥ 같은 말 → 막음', !M.judgeFollowupText({ text: '저도 그랬어요!! 밤에 잠이 안 와서 고생했네요~', existing: ex }).ok)
  check('⑥ 같은 도입 → 막음', !M.judgeFollowupText({ text: '저도 그랬어요 근데 저는 운동으로 좀 나아졌어요', existing: ex }).ok)
  check('⑥ 다른 말 → 통과', M.judgeFollowupText({ text: '어머 그 약은 처음 들어 보네요 효과 있으셨어요?', existing: ex }).ok)
  // 🔴 완전 일치도 아니고 도입도 다른데 거의 같은 말 — 실회원 말을 Persona 가 되풀이하는 자리(도입 규칙은 Persona 끼리만)
  const member = [{ text: '밤에 잠이 안 와서 정말 고생했네요 저도 그랬어요', persona: false }]
  const near = '정말 밤에 잠이 안 와서 고생했네요 저도 그랬어요'
  check('⑥ 🔴 거의 같은 말(완전 일치·같은 도입 아님) → 막음',
    M.bigramJaccard(member[0]!.text, near) >= M.FOLLOWUP_DUP_JACCARD_MAX
    && normalizeDiffers(member[0]!.text, near) && !M.judgeFollowupText({ text: near, existing: member }).ok)
  check('⑥ 빈 말 → 막음', !M.judgeFollowupText({ text: 'ㅋㅋㅋ!!', existing: [] }).ok)

  const postId = FX_POST
  const go = M.judgeFollowupPost(factsOf(postId, fx.scenarios[0]!), T0 + 140 * MIN)
  if (go.verdict !== 'GO') check('⑥ 도장 시나리오 GO', false, go.reason)
  else {
    const stamp = M.stampOf(postId, go)
    check('⑥ 도장 왕복', M.verifyStamp(JSON.parse(JSON.stringify(stamp)), { postId, dedupKey: go.key }).ok)
    check('⑥ 다른 글 도장 → 거부', !M.verifyStamp(stamp, { postId: 'other', dedupKey: go.key }).ok)
    check('⑥ 순번·열쇠 불일치 → 거부', !M.verifyStamp({ ...stamp, ordinal: 3 }, { postId, dedupKey: go.key }).ok)
    check('⑥ 옛 판 도장 → 거부', !M.verifyStamp({ ...stamp, v: 'followup-v0' }, { postId, dedupKey: go.key }).ok)
    check('⑥ 도장 없음 → 거부', !M.verifyStamp(null, { postId, dedupKey: go.key }).ok)
    const pick = M.pickFollowupPersona(go, postId, [
      { personaId: 'pA', eligible: true, followupsToday: 0 },
      { personaId: 'pB', eligible: true, followupsToday: 0 },
      { personaId: 'pQ', eligible: false, followupsToday: 0 },
      { personaId: 'pR', eligible: true, followupsToday: 3 },
      { personaId: 'pS', eligible: true, followupsToday: null },
    ], 3)
    check('⑥ 글쓴이·이미 단 Persona·자격 없음·하루 상한·모름 → 고를 사람 없음', pick.personaId === null)
    const ok = M.pickFollowupPersona(go, postId, [{ personaId: 'pT', eligible: true, followupsToday: 2 }], 3)
    check('⑥ 남은 사람 → 고른다', ok.personaId === 'pT')
    check('⑥ 🔴 Persona 하루 상한은 profile 값이다(6이면 4건째 허용 · 3이면 막음)',
      M.pickFollowupPersona(go, postId, [{ personaId: 'pT', eligible: true, followupsToday: 4 }], 6).personaId === 'pT'
      && M.pickFollowupPersona(go, postId, [{ personaId: 'pT', eligible: true, followupsToday: 4 }], 3).personaId === null)
    check('⑥ 🔴 Persona 상한 손상(0·NaN) → 고르지 않는다',
      M.pickFollowupPersona(go, postId, [{ personaId: 'pT', eligible: true, followupsToday: 0 }], 0).personaId === null
      && M.pickFollowupPersona(go, postId, [{ personaId: 'pT', eligible: true, followupsToday: 0 }], Number.NaN).personaId === null)
    check('⑥ 역할은 생성기 어휘 안', go.roles.length > 0 && go.roles.every((r) => ['other', 'empathy', 'question', 'experience'].includes(r)))
  }
}

// ═════════ ⑦ 발행 트랜잭션 판정(judgeFollowupPublish) — 트랜잭션이 다시 읽은 사실로 막는다 ═════════
{
  const base = fx.scenarios[0]!
  const post = factsOf(FX_POST, base)
  const st = { v: M.FOLLOWUP_STAMP_VERSION, postId: FX_POST, ordinal: 2, parentCommentId: 'c1', hook: 'question' }
  const ok: FollowupModule.FollowupPublishFacts = {
    switch: { enabled: true, reason: 'on' }, commentStage: 'bootstrap-auto', actor: 'automation', queueStatus: 'PENDING',
    dedupKey: M.followupKeyOf(FX_POST, 2), editDiff: M.followupEditDiffOf(st as FollowupModule.FollowupStamp),
    post, candidatePersonaId: 'pZ', otherOpenQueue: false, profile: fx.profiles.approved, runtimeStage: 'd10',
    followupsTodayInTx: 0, personaFollowupsTodayInTx: 0, nowMs: T0 + 200 * MIN,
  }
  const pub = (over: Partial<FollowupModule.FollowupPublishFacts>) => M.judgeFollowupPublish({ ...ok, ...over })
  check('⑦ 기준선 — 온전한 도장 · 사실 → 발행', pub({}).ok, pub({}).blockers.join(' | '))
  const no = (name: string, over: Partial<FollowupModule.FollowupPublishFacts>, expect: string) => {
    const v = pub(over)
    check(`⑦ 🔴 ${name} → 막음`, !v.ok && v.blockers.some((b) => b.includes(expect)), v.blockers.join(' | '))
  }
  no('스위치 OFF(트랜잭션 재판독)', { switch: M.readFollowupSwitch({}) }, '미설정')
  no('댓글 단계 shadow', { commentStage: 'shadow' }, '댓글 단계')
  no('사람이 누른 발행', { actor: 'manual-admin' }, '사람이 누른')
  no('Queue 가 PENDING 아님', { queueStatus: 'APPROVED' }, 'PENDING 만')
  no('추가 댓글 열쇠 아님', { dedupKey: 'comment:post-fx:pZ:other' }, '열쇠가 아니다')
  no('profile 없음', { profile: null }, 'profile')
  no('profile 단계 불일치', { runtimeStage: 'd100' }, '단계')
  no('오늘 추가 댓글 profile 상한', { followupsTodayInTx: 40 }, '하루 상한')
  no('오늘 추가 수 모름', { followupsTodayInTx: null }, '세지 못했다')
  no('Persona 하루 상한', { personaFollowupsTodayInTx: 3 }, 'Persona 오늘')
  no('다른 열린 후보', { otherOpenQueue: true }, '다른 열린 후보')
  no('다른 열린 후보 모름', { otherOpenQueue: null }, '읽지 못했다')
  no('도장 없음', { editDiff: {} }, '도장이 없다')
  no('도장 순번이 지금 자리와 다름', {
    dedupKey: M.followupKeyOf(FX_POST, 3), editDiff: M.followupEditDiffOf({ ...st, ordinal: 3 } as FollowupModule.FollowupStamp),
  }, '도장 순번')
  no('직전 Persona 댓글과 간격 짧음', { nowMs: T0 + 25 * MIN }, '간격')
  no('후보 Persona 가 이미 그 글에 씀', { candidatePersonaId: 'pB' }, '이미 썼거나 글쓴이')
  no('후보 Persona 가 글쓴이', { candidatePersonaId: 'pA' }, '이미 썼거나 글쓴이')
  no('답글 대상이 이 글에 없음(고아)', {
    editDiff: M.followupEditDiffOf({ ...st, parentCommentId: 'gone' } as FollowupModule.FollowupStamp),
  }, '고아')
  {
    // 🔴 자기 댓글 답글 — 대상 댓글(c1)을 쓴 pB 가 후보면 '이미 그 글에 쓴 Persona' 로 막힌다(따로 분기를 두지 않는다)
    const v = pub({ candidatePersonaId: 'pB' })
    check('⑦ 🔴 자기 댓글에 답글 → 같은 Persona 규칙으로 막음', !v.ok && v.blockers.some((b) => b.includes('이미 썼거나')), v.blockers.join(' | '))
  }
  const consumed = {
    ...post,
    comments: [...post.comments, { ...post.comments[0]!, id: 'fu0', parentId: null, personaId: 'pY', createdAt: new Date(T0 + 60 * MIN), provenance: 'followup' as const }],
  }
  no('글 hook 이미 소비(최상위 추가 댓글 있음)', {
    post: consumed, dedupKey: M.followupKeyOf(FX_POST, 3), nowMs: T0 + 200 * MIN,
    editDiff: M.followupEditDiffOf({ ...st, ordinal: 3, parentCommentId: null } as FollowupModule.FollowupStamp),
  }, '글 hook')
  const answered = {
    ...post,
    comments: [...post.comments, { ...post.comments[0]!, id: 'm9', parentId: 'c1', commentOrigin: 'MEMBER', personaId: null, authorId: 'u9', isDeleted: true, createdAt: new Date(T0 + 30 * MIN), provenance: null }],
  }
  no('대상에 이미 답이 있음(지워진 실회원 답 포함)', { post: answered }, '이미 답이 있다')
}

// ═════════ ⑧ 첫 댓글 프롬프트 바이트 동일 · 답글 대상 줄 ═════════
{
  const input = {
    personaCode: 'P01', reactionRole: 'other',
    persona: { code: 'P01', ageBand: '50대 초반', region: '경기', lifeStage: '갱년기', identity: {}, voiceCore: {}, voiceVariations: {}, noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [] },
    post: { id: 'p', title: '요즘 밤마다 잠이 안 와요', bodyDigest: '새벽 세 시만 되면 눈이 떠져요. 다들 어떻게 보내세요?', boardLabel: 'FREE', existingCommentDigests: ['저도 그래요', '어머 공감돼요'] },
    voice: {}, memory: { has: false, note: '' }, fingerprint: 'x',
  } as unknown as CommentInput
  const empty = { ...input, post: { ...input.post, existingCommentDigests: [] } } as CommentInput
  const sha = createHash('sha256').update(JSON.stringify([toPromptPost(input), toPromptPost(empty)])).digest('hex')
  check('⑧ 🔴 첫 댓글 프롬프트(답글 대상 없음)가 main 과 바이트 동일', sha === fx.firstCommentPrompt.sha256, sha)
  const reply = { ...input, post: { ...input.post, replyToDigest: '그럴 땐 뭐 하세요?' } } as CommentInput
  const rc = toPromptPost(reply).content
  check('⑧ 추가 댓글만 — 답글 대상 줄이 붙는다', rc.startsWith(toPromptPost(input).content) && rc.includes('[이 댓글에 이어서 답합니다]') && rc.endsWith('- 그럴 땐 뭐 하세요?'))
  check('⑧ 🔴 답글 대상 요약도 ① 유출 대조 목록에 들어간다', sourceTextsOf(reply).includes('그럴 땐 뭐 하세요?') && !sourceTextsOf(input).includes('그럴 땐 뭐 하세요?'))
}

// ═════════ ⑨ E6 — 그날 결정은 consumer 가 넣은 오늘 결정만 · 정기 회차만 · plist 는 consumer 를 지난다 ═════════
{
  const NOW = new Date('2026-10-14T03:00:00Z')
  const today = kstDateString(NOW)
  const env = (mark: string | undefined, release: string | undefined, capacity: string | undefined) => decisionStageEnv({
    ...(mark === undefined ? {} : { SORAN_STAGE_DECISION_DATE: mark }),
    ...(release === undefined ? {} : { SORAN_RELEASE_STAGE: release }),
    ...(capacity === undefined ? {} : { SORAN_CAPACITY_STAGE: capacity }),
  })
  const ok = M.followupStageOf(env(today, 'd5', 'd10'), NOW)
  check('⑨ 오늘 결정(공개 d5 · 천장 d10) → d5', ok.stage === 'd5', ok.reason)
  const bad: [string, ReturnType<typeof env>][] = [
    ['결정 표식 없음(consumer 미경유)', env(undefined, 'd5', 'd10')],
    ['어제 날짜 표식(오래된 결정)', env('2026-10-13', 'd5', 'd10')],
    ['다른 날짜 표식(미래)', env('2026-10-15', 'd5', 'd10')],
    ['표식 모양이 아님', env('today', 'd5', 'd10')],
    ['정본에 없는 공개 단계(위조)', env(today, 'd7', 'd10')],
    ['천장 없음', env(today, 'd5', undefined)],
    ['공개 > 천장(consumer 가 낼 수 없는 모양)', env(today, 'd20', 'd10')],
  ]
  for (const [name, e] of bad) {
    const v = M.followupStageOf(e, NOW)
    check(`⑨ 🔴 ${name} → 단계 없음(추가 댓글 0)`, v.stage === null, v.reason)
  }
  // 🔴 회차 자격 — 정기 · --live · 스위치 on 만
  const on = { SORAN_PERSONA_COMMENT_FOLLOWUP: 'on' }
  check('⑨ 정기 회차 · --live · 스위치 on → 추가 댓글 단계', followupEligibleFor({ live: true, trigger: 'scheduled', env: on }).ok)
  for (const t of ['event', 'recovery', 'manual', 'unknown']) {
    check(`⑨ 🔴 ${t} 회차 → 첫 댓글만`, !followupEligibleFor({ live: true, trigger: t, env: on }).ok)
  }
  check('⑨ 🔴 dry-run → 단계 없음', !followupEligibleFor({ live: false, trigger: 'scheduled', env: on }).ok)
  check('⑨ 🔴 스위치 OFF → 단계 없음', !followupEligibleFor({ live: true, trigger: 'scheduled', env: {} }).ok)
  // 🔴 plist — consumer 를 지나 같은 러너를 부른다
  const xml = renderCommentRunnerPlist({ npxPath: '/n/npx', runtimeRoot: '/rt', logDir: '/log', nodeBinDir: '/n' })
  const args = [...(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? '').matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1])
  check('⑨ 🔴 댓글 러너 plist 가 consumer(--by=comment)를 지나 persona-comment-loop --live 를 부른다',
    JSON.stringify(args) === JSON.stringify(['/n/npx', 'tsx', '/rt/scripts/stage-consume-exec.mts', '--by=comment', '--',
      '/n/npx', 'tsx', '/rt/scripts/persona-comment-loop.mts', '--live']), JSON.stringify(args))
  check('⑨ 댓글 consumer 종류가 정본 목록에 있다', (DECISION_CONSUMERS as readonly string[]).includes(COMMENT_CONSUMER_BY))
  check('⑨ 🔴 plist 가 단계 env 를 직접 적지 않는다', !/SORAN_(RELEASE_STAGE|CAPACITY_STAGE|STAGE_DECISION_DATE)/.test(xml))
}

for (const l of lines) console.log(l)
console.log(`\n${failures === 0 ? '✅ PASS' : `❌ FAIL ${failures}건`} — ${lines.length}개 검사 · DB 0 · provider 0 · write 0`)
process.exit(failures === 0 ? 0 : 1)
