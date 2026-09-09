#!/usr/bin/env tsx
/**
 * Persona 댓글 엔진 검사 — 🔴 **read-only. DB 0 · 네트워크 0 · 공개 write 0**
 *
 * 🔴 소스 문자열을 세지 않는다. 순수 함수를 실제로 불러 **행동**을 본다.
 *    문자열 검사는 함수가 바뀌어도 통과하고, 통과한 검사는 아무것도 지키지 않는다.
 */
import {
  buildCommentInput, inputFingerprint, judgeInputDiversity, memoryLine, voiceEvidenceFromAssets,
  FORBIDDEN_REACTION_ROLES, MAX_VOICE_MARKS, NO_MEMORY_NOTE,
  type CommentInput, type CommentInputPersona, type CommentInputPost, type VoiceEvidence,
} from '../src/lib/persona-comment-input'
import {
  judgeRatio, judgeReadiness, readRunMode,
  DEFAULT_DAILY_CAP, PERSONA_RATIO_MAX, RATIO_WINDOW_DAYS, RELEASE_ENV_KEY,
  type CommentWindow,
} from '../src/lib/persona-comment-governor'
import {
  judgePlannerPersona, judgePlannerPost, planCommentDistribution, priorityOf,
  FRESHNESS_MAX_DAYS, type PlannerPersona, type PlannerPost,
} from '../src/lib/persona-comment-planner'
import {
  estimateCost, judgeModelSelection, judgeSpend,
  EVAL_MAX_CALLS, EVAL_MAX_USD, type ModelPrice,
} from '../src/lib/persona-comment-cost'
import { MEMBER_COMMENT_LIMIT } from '../src/lib/persona-target-rules'
import { COMMENT_REACTION_ROLES, REACTION_TYPES, isReactionType } from '../src/lib/persona-reaction-roles'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { M3_MODEL_CANDIDATES, apiModelIdFor } from './lib/voice-m3-contract.mjs'
import {
  classifyComment, windowFromRows, DEFAULT_SHADOW_LIMIT,
} from '../src/lib/persona-comment-governor'
import { judgeLifeHistory, readPostRequirements } from '../src/lib/original-post-persona-match'
import {
  judgeBootstrapEligible, judgeGateInputs, judgeGateReport, judgeRealPostExternalCall,
  bootstrapPhaseOver, GATE_CODES, REQUIRED_GATES, REAL_POST_EXTERNAL_CALL_ALLOWED,
  BOOTSTRAP_MAX_PER_PERSONA, BOOTSTRAP_MAX_PER_DAY_PER_PERSONA, BOOTSTRAP_EXIT_PRIOR_TEXTS,
  type GateReport,
} from '../src/lib/persona-comment-gate-report'
import {
  DEFAULT_FINGERPRINT_THRESHOLDS, REQUIRED_PRIOR_TEXTS, gateEightCanRun,
} from '../src/lib/persona-fingerprint-thresholds'
import { checkVoiceFingerprint } from './lib/persona-gate-78.mjs'
import {
  buildPromptFromInput, describeGateInput, toGateInput, toPromptPost, toRecentMarks,
} from './lib/persona-comment-bridge'
import { checkCommentCandidate } from './lib/persona-comment-candidate.mjs'
import { runEval, textFingerprint, type EvalCallResult, type EvalJudge } from './lib/persona-comment-eval-runner'
import {
  hashRun, listRuns, pointLatest, runIdOf, savePaidRun, LATEST_FILE,
} from './lib/persona-comment-eval-store'
import { NO_MEMORY_NOTE as NOTE_UNUSED } from '../src/lib/persona-comment-input'
void NOTE_UNUSED

let pass = 0
let failN = 0
const check = (n: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${n}`) }
}

console.log('\n══ Persona 댓글 엔진 검사 (read-only · 공개 write 0) ══\n')

// ─────────────────────────────────────────────────────────
console.log('① ratio 30% 와 감속')
// ─────────────────────────────────────────────────────────
{
  const win = (real: number, persona = 0, measured = true): CommentWindow =>
    ({ measured, real, persona, windowDays: RATIO_WINDOW_DAYS })

  check('🔴 계약값이 30% · 7일 · 기본 1건/day 다',
    PERSONA_RATIO_MAX === 0.30 && RATIO_WINDOW_DAYS === 7 && DEFAULT_DAILY_CAP === 1)

  /**
   * 🔴 **실사용자 댓글이 0 이면 어떤 Persona 댓글도 30% 를 넘긴다.**
   *    0/0 은 비율이 아니다 — 여기서 열어 두면 아무도 없는 곳에 봇만 말한다.
   */
  const zero = judgeRatio(win(0))
  check('🔴 real 0 이면 상한 0 이다', zero.headroom === 0)
  check('🔴 그 이유를 "실사용자 댓글이 0" 으로 말한다', zero.reason.includes('실사용자 댓글이 0'))

  check('🔴 집계 실패면 상한 0 (fail-closed)', judgeRatio(win(100, 0, false)).headroom === 0)
  check('🔴 음수·NaN 이면 상한 0', judgeRatio(win(-1)).headroom === 0 && judgeRatio(win(Number.NaN)).headroom === 0)

  // 🔴 경계: p <= (0.3/0.7)·r = 0.4286·r
  check('🔴 real 1 → 0건 (0.43 은 0 으로 내린다. 반올림하면 사람 1명에 봇 1개가 붙는다)',
    judgeRatio(win(1)).headroom === 0)
  check('🔴 real 2 → 0건 (0.86)', judgeRatio(win(2)).headroom === 0)
  check('🟢 real 3 → 1건 (1.28)', judgeRatio(win(3)).headroom === 1)
  check('🟢 real 7 → 3건 (정확히 3.0 · 경계값)', judgeRatio(win(7)).headroom === 3)
  check('🟢 real 15 → 6건 (6.43)', judgeRatio(win(15)).headroom === 6)
  // 🔴 이미 쓴 만큼 뺀다
  check('🔴 이미 3건 썼으면 real 7 에서 여유 0', judgeRatio(win(7, 3)).headroom === 0)
  check('🔴 상한을 넘겨 썼어도 음수가 되지 않는다', judgeRatio(win(7, 99)).headroom === 0)
  // 🔴 30% 경계 전후를 실제 비율로 확인
  const at30 = judgeRatio(win(7, 3))
  check('🔴 real 7 · persona 3 이면 비율이 정확히 30% 다', Math.abs((at30.current ?? 0) - 0.3) < 1e-9)
  check('🔴 real 7 · persona 2 는 아직 30% 미만이라 1건 여유가 있다', judgeRatio(win(7, 2)).headroom === 1)
}

// ─────────────────────────────────────────────────────────
console.log('② 실행 모드 — 기본은 shadow')
// ─────────────────────────────────────────────────────────
{
  check('🔴 env 가 없으면 shadow 다 (설정을 안 했는데 발행이 시작되지 않게)',
    readRunMode({}).mode === 'shadow')
  check('🔴 빈 문자열도 shadow', readRunMode({ [RELEASE_ENV_KEY]: '   ' }).mode === 'shadow')
  const unknown = readRunMode({ [RELEASE_ENV_KEY]: 'production' })
  check('🔴 모르는 값이면 shadow 로 내린다 (fail-closed)', unknown.mode === 'shadow')
  check('🔴 그때 왜 내렸는지 말한다', unknown.reason.includes('모르는 값'))
  check('🟢 inspect · shadow · release 는 그대로 읽는다',
    readRunMode({ [RELEASE_ENV_KEY]: 'inspect' }).mode === 'inspect'
    && readRunMode({ [RELEASE_ENV_KEY]: 'release' }).mode === 'release')

  const base = {
    window: { measured: true, real: 15, persona: 0, windowDays: 7 } as CommentWindow,
    publishedToday: 0, killSwitchOff: true,
  }
  /** 🔴 상한이 남아 있어도 release 가 아니면 공개 write 는 불가다 */
  for (const m of ['inspect', 'shadow'] as const) {
    const v = judgeReadiness({ ...base, mode: m })
    check(`🔴 ${m} 모드는 공개 발행 불가 (상한이 남아도)`, !v.canPublish)
  }
  const rel = judgeReadiness({ ...base, mode: 'release' })
  check('🟢 release + 조건 충족이면 발행 가능', rel.canPublish && rel.publicAllowedToday === 1)
  check('🔴 일 cap 1 이 ratio 여유 6 보다 작으므로 1 이 적용된다', rel.publicAllowedToday === DEFAULT_DAILY_CAP)

  // 🔴 어느 하나라도 모르면 0
  check('🔴 오늘 발행 수를 못 세면 0',
    judgeReadiness({ ...base, mode: 'release', publishedToday: null }).publicAllowedToday === 0)
  check('🔴 kill switch 상태를 못 읽으면 0',
    judgeReadiness({ ...base, mode: 'release', killSwitchOff: null }).publicAllowedToday === 0)
  check('🔴 kill switch 가 켜져 있으면 0',
    judgeReadiness({ ...base, mode: 'release', killSwitchOff: false }).publicAllowedToday === 0)
  check('🔴 ratio 여유가 0 이면 release 여도 0',
    judgeReadiness({ ...base, mode: 'release', window: { measured: true, real: 1, persona: 0, windowDays: 7 } }).publicAllowedToday === 0)
  check('🔴 오늘 이미 cap 만큼 썼으면 0',
    judgeReadiness({ ...base, mode: 'release', publishedToday: 1 }).publicAllowedToday === 0)
  check('🔴 손상된 cap 은 0 으로 본다',
    judgeReadiness({ ...base, mode: 'release', dailyCap: Number.NaN }).publicAllowedToday === 0)
  /** 🔴 준비도 미달은 "끄기" 가 아니라 "0/day 감속" 이다 — 조건이 돌아오면 저절로 회복된다 */
  const recovered = judgeReadiness({ ...base, mode: 'release', window: { measured: true, real: 3, persona: 0, windowDays: 7 } })
  check('🟢 조건이 회복되면 스위치를 다시 켜지 않아도 상한이 돌아온다', recovered.publicAllowedToday === 1)
}

// ─────────────────────────────────────────────────────────
console.log('③ 댓글 분산 planner')
// ─────────────────────────────────────────────────────────
{
  const NOW = Date.parse('2026-09-09T12:00:00+09:00')
  const day = (n: number): number => NOW - n * 86_400_000
  const post = (o: Partial<PlannerPost> & { id: string }): PlannerPost => ({
    status: 'PUBLISHED', authorPersonaCode: null, memberComments: 0, personaComments: 0,
    hasOpenQueue: false, publishedAtMs: day(1), onHold: false,
    title: '오늘 날씨 이야기', body: '비가 와서 무릎이 시큰합니다', ...o,
  })
  const persona = (o: Partial<PlannerPersona> & { code: string }): PlannerPersona => ({
    status: 'active', realMember: { accountCount: 0, providerId: null }, seedComplete: true,
    forbiddenReactionRoles: [], recentComments: 0,
    life: { noGoTopics: [] }, ...o,
  })
  // 🔴 정본 어휘를 쓴다. `share` 는 REACTION_TYPES 에 없어 생성기가 거부한다
  const ROLES = [...COMMENT_REACTION_ROLES]
  const plan = (posts: PlannerPost[], personas: PlannerPersona[], limit = 3): ReturnType<typeof planCommentDistribution> =>
    planCommentDistribution({ posts, personas, reactionRoles: ROLES, limit, nowMs: NOW, recentRoleCounts: {} })

  // ── 댓글 0개 우선 ──
  {
    const posts = [
      post({ id: 'has2', memberComments: 2 }),
      post({ id: 'zero' }),
      post({ id: 'has1', memberComments: 1 }),
    ]
    const r = plan(posts, [persona({ code: 'P01' }), persona({ code: 'P02' }), persona({ code: 'P03' })])
    check('🔴 댓글 0개 글이 가장 먼저 뽑힌다', r.items[0]?.postId === 'zero')
    check('🔴 그 다음은 댓글이 적은 글이다',
      r.items[1]?.postId === 'has1' && r.items[2]?.postId === 'has2')
    check('🔴 왜 골랐는지 말한다', (r.items[0]?.why ?? '').includes('아무도 답하지 않은'))
    // 🔴 같은 댓글 수면 최신 글이 먼저다
    check('🔴 우선순위는 댓글 수가 먼저, 그 안에서 오래된 것이 나중이다',
      priorityOf(post({ id: 'a', publishedAtMs: day(1) }), NOW)
      < priorityOf(post({ id: 'b', publishedAtMs: day(10) }), NOW))
  }

  // ── 글 쪽 차단 ──
  {
    const cases: [string, PlannerPost, string][] = [
      ['HIDDEN 은 제외', post({ id: 'h', status: 'HIDDEN' }), 'POST_NOT_PUBLISHED'],
      ['DELETED 는 제외', post({ id: 'd', status: 'DELETED' }), 'POST_NOT_PUBLISHED'],
      ['이미 Persona 댓글이 있으면 제외', post({ id: 'p', personaComments: 1 }), 'POST_HAS_PERSONA_COMMENT'],
      [`회원 댓글 ${MEMBER_COMMENT_LIMIT}건 이상이면 끼어들지 않는다`, post({ id: 'm', memberComments: MEMBER_COMMENT_LIMIT }), 'POST_MEMBER_COMMENTS_FULL'],
      ['중복 Queue 가 있으면 제외', post({ id: 'q', hasOpenQueue: true }), 'POST_HAS_OPEN_QUEUE'],
      ['보류 중이면 제외', post({ id: 'o', onHold: true }), 'POST_ON_HOLD'],
      ['보류 여부를 모르면 제외 (fail-closed)', post({ id: 'ou', onHold: null }), 'POST_HOLD_UNKNOWN'],
      ['공개 시각을 모르면 제외 (fail-closed)', post({ id: 'pu', publishedAtMs: null }), 'POST_PUBLISHED_AT_UNKNOWN'],
      [`${FRESHNESS_MAX_DAYS}일 넘은 글은 제외`, post({ id: 'old', publishedAtMs: day(FRESHNESS_MAX_DAYS + 1) }), 'POST_TOO_OLD'],
    ]
    for (const [label, p, code] of cases) {
      const blocks = judgePlannerPost(p, NOW)
      check(`🔴 ${label}`, blocks.some((b) => b.code === code))
      const r = plan([p], [persona({ code: 'P01' })])
      check(`🔴 ${label} — planner 결과에 들어가지 않는다`, r.items.length === 0)
    }
    check(`🟢 ${FRESHNESS_MAX_DAYS}일 경계 안쪽은 통과`,
      judgePlannerPost(post({ id: 'edge', publishedAtMs: day(FRESHNESS_MAX_DAYS) }), NOW).length === 0)
  }

  // ── Persona 쪽 차단 ──
  {
    const p = post({ id: 'x', authorPersonaCode: 'P09' })
    const cases: [string, PlannerPersona, string][] = [
      ['active 가 아니면 제외', persona({ code: 'P01', status: 'paused' }), 'PERSONA_NOT_ACTIVE'],
      ['실회원 계정이 붙었으면 제외 (사칭)', persona({ code: 'P02', realMember: { accountCount: 1, providerId: null } }), 'PERSONA_HAS_ACCOUNT'],
      ['계정 연결을 모르면 제외 (fail-closed)', persona({ code: 'P03', realMember: { accountCount: null, providerId: null } }), 'PERSONA_ACCOUNT_UNKNOWN'],
      ['seed·voice 가 불완전하면 제외', persona({ code: 'P04', seedComplete: false }), 'PERSONA_SEED_INCOMPLETE'],
      ['자기 글에는 달지 않는다', persona({ code: 'P09' }), 'PERSONA_OWN_POST'],
      // 🔴 실제 본문에서 요구를 읽어 판정한다 — 고정 목록이 아니다
      ['noGo 주제가 본문에 있으면 제외', persona({ code: 'P05', life: { noGoTopics: ['무릎'] } }), 'PERSONA_LIFE_CONFLICT'],
    ]
    for (const [label, pers, code] of cases) {
      check(`🔴 ${label}`, judgePlannerPersona(pers, p, 'empathy').some((b) => b.code === code))
      const r = plan([p], [pers])
      check(`🔴 ${label} — 뽑히지 않는다`, r.items.length === 0)
    }
    check('🔴 맡지 않는 역할은 그 역할로 뽑지 않는다',
      judgePlannerPersona(persona({ code: 'P06', forbiddenReactionRoles: ['empathy'] }), post({ id: 'y' }), 'empathy')
        .some((b) => b.code === 'PERSONA_ROLE_FORBIDDEN'))
    // 🔴 다른 역할이 남아 있으면 그 역할로 뽑힌다 — 사람을 통째로 버리지 않는다
    const r = plan([post({ id: 'y' })], [persona({ code: 'P06', forbiddenReactionRoles: ['empathy'] })])
    check('🟢 금지되지 않은 다른 역할로는 뽑힌다', r.items[0]?.reactionRole !== undefined && r.items[0]?.reactionRole !== 'empathy')
  }

  // ── 편중 방지 ──
  {
    const posts = [post({ id: 'a' }), post({ id: 'b' }), post({ id: 'c' })]
    const personas = [persona({ code: 'P01' }), persona({ code: 'P02' }), persona({ code: 'P03' })]
    const r = plan(posts, personas, 3)
    check('🔴 한 회차에 같은 Persona 가 두 번 나오지 않는다',
      new Set(r.items.map((i) => i.personaCode)).size === r.items.length)
    check('🔴 역할이 한쪽으로 몰리지 않는다',
      new Set(r.items.map((i) => i.reactionRole)).size === r.items.length)
    // 🔴 최근에 많이 말한 Persona 는 뒤로 밀린다
    const r2 = plan([post({ id: 'a' })], [
      persona({ code: 'P01', recentComments: 5 }),
      persona({ code: 'P02', recentComments: 0 }),
    ], 1)
    check('🔴 최근에 적게 말한 Persona 가 먼저 뽑힌다', r2.items[0]?.personaCode === 'P02')
    // 🔴 최근에 많이 쓰인 역할은 뒤로 밀린다
    const r3 = planCommentDistribution({
      posts: [post({ id: 'a' })], personas: [persona({ code: 'P01' })],
      reactionRoles: ROLES, limit: 1, nowMs: NOW,
      // 🔴 정본 어휘로 센다. 최근에 많이 쓴 역할은 뒤로 밀린다
      recentRoleCounts: { empathy: 9, experience: 3, question: 0 },
    })
    check('🔴 최근에 적게 쓰인 역할이 먼저 배정된다', r3.items[0]?.reactionRole === 'question')
  }

  // ── 상한 ──
  {
    const posts = [post({ id: 'a' }), post({ id: 'b' }), post({ id: 'c' })]
    const personas = [persona({ code: 'P01' }), persona({ code: 'P02' }), persona({ code: 'P03' })]
    check('🔴 limit 을 넘겨 뽑지 않는다', plan(posts, personas, 2).items.length === 2)
    /** 🔴 governor 가 0 을 주면 아무것도 뽑지 않는다 — 감속이 실제로 planner 까지 닿는가 */
    const zero = plan(posts, personas, 0)
    check('🔴 limit 0 이면 한 건도 뽑지 않는다', zero.items.length === 0)
    /**
     * 🔴 상한 0 에서도 **왜** 안 뽑혔는지는 남아야 한다.
     *    상한 때문인지 대상이 없어서인지 운영자가 구분할 수 없으면 진단이 아니다.
     */
    check('🔴 상한 0 이어도 자격 있는 글은 LIMIT_EXHAUSTED 로 남는다',
      zero.skipped.filter((s) => s.blocks.some((b) => b.code === 'LIMIT_EXHAUSTED')).length === 3)
    check('🔴 상한 0 이어도 자격 없는 글은 원래 이유로 남는다',
      plan([post({ id: 'h', status: 'HIDDEN' })], personas, 0)
        .skipped.some((s) => s.blocks.some((b) => b.code === 'POST_NOT_PUBLISHED')))
    check('🔴 붙일 Persona 가 없으면 이유를 남긴다',
      plan([post({ id: 'a' })], []).skipped.some((s) => s.blocks.some((b) => b.code === 'NO_ELIGIBLE_PERSONA')))
    check('🔴 제외된 글은 조용히 사라지지 않고 이유와 함께 남는다',
      plan([post({ id: 'h', status: 'HIDDEN' })], personas).skipped.length === 1)
  }
}

// ─────────────────────────────────────────────────────────
console.log('④ Persona-first 입력 계약')
// ─────────────────────────────────────────────────────────
{
  const voice = (o: Partial<VoiceEvidence> = {}): VoiceEvidence => ({
    source: 'voice-derived', openers: ['저도'], endings: ['네요'], punctuation: ['ㅠㅠ'], sampleCount: 12, ...o,
  })
  const persona = (o: Partial<CommentInputPersona> & { code: string }): CommentInputPersona => ({
    ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    identity: { job: '방과후 강사' }, voiceCore: { tone: '담담' }, voiceVariations: { excited: '!' },
    noGoTopics: ['정치'], noGoExpressions: ['~하시길'], forbiddenReactionRoles: [], ...o,
  })
  const post: CommentInputPost = {
    id: 'p1', title: '요즘 무릎이 아파요', bodyDigest: '계단 오를 때 무릎이 시큰하다는 이야기',
    boardLabel: '수다방', existingCommentDigests: ['비슷한 경험을 말한 댓글 1건'],
  }
  const build = (o: Partial<Parameters<typeof buildCommentInput>[0]> = {}): ReturnType<typeof buildCommentInput> =>
    buildCommentInput({
      persona: persona({ code: 'P01' }), post, reactionRole: 'empathy',
      voice: voice(), memory: { has: false, note: '' }, ...o,
    })

  check('🟢 필요한 것이 다 있으면 입력이 만들어진다', build().ok)

  /** 🔴 advice·caution 전면 금지는 이번 PR 에서 풀지 않는다 */
  for (const role of FORBIDDEN_REACTION_ROLES) {
    const r = build({ reactionRole: role })
    check(`🔴 ${role} 역할은 전면 금지다`,
      !r.ok && r.blocks.some((b) => b.code === 'REACTION_ROLE_FORBIDDEN_GLOBAL'))
  }
  check('🔴 그 Persona 가 맡지 않는 역할도 막는다', (() => {
    const r = build({ persona: persona({ code: 'P02', forbiddenReactionRoles: ['empathy'] }) })
    return !r.ok && r.blocks.some((b) => b.code === 'REACTION_ROLE_FORBIDDEN_PERSONA')
  })())

  /**
   * 🔴 **말투 근거가 없으면 만들지 않는다.**
   *    실측상 24명 중 23명이 자기 댓글이 없다 — 그대로 두면 공통 프롬프트가 24번 나간다.
   */
  const noVoice = build({ voice: voice({ source: 'none', openers: [], endings: [], punctuation: [], sampleCount: 0 }) })
  check('🔴 말투 근거가 없으면 생성 입력을 만들지 않는다',
    !noVoice.ok && noVoice.blocks.some((b) => b.code === 'VOICE_EVIDENCE_MISSING'))
  check('🔴 source 만 있고 표지가 비어도 막는다', (() => {
    const r = build({ voice: voice({ openers: [], endings: [], punctuation: [] }) })
    return !r.ok && r.blocks.some((b) => b.code === 'VOICE_EVIDENCE_MISSING')
  })())
  check('🟢 Voice 자산에서 온 근거면 자기 댓글이 없어도 통과한다',
    build({ voice: voice({ source: 'voice-comment-signal' }) }).ok)

  for (const [label, o, code] of [
    ['identity 가 비면 막는다', { persona: persona({ code: 'P03', identity: null }) }, 'PERSONA_IDENTITY_MISSING'],
    ['voiceCore 가 비면 막는다', { persona: persona({ code: 'P04', voiceCore: {} }) }, 'PERSONA_VOICE_MISSING'],
    ['lifeStage 가 없으면 막는다', { persona: persona({ code: 'P05', lifeStage: null }) }, 'PERSONA_LIFESTAGE_MISSING'],
    ['글 요약이 비면 막는다', { post: { ...post, bodyDigest: '  ' } }, 'POST_DIGEST_EMPTY'],
  ] as const) {
    const r = build(o as never)
    check(`🔴 ${label}`, !r.ok && r.blocks.some((b) => b.code === code))
  }

  /** 🔴 기억이 없으면 없다고 적는다 — 없는 과거를 지어내지 않게 */
  check('🔴 Memory 가 없으면 "지어내지 마세요" 를 명시한다',
    memoryLine({ has: false, note: '' }) === NO_MEMORY_NOTE)
  check('🟢 Memory 가 있으면 그 요약을 쓴다',
    memoryLine({ has: true, summary: '지난달 무릎 이야기를 나눴다' }).includes('무릎'))

  /**
   * 🔴 **displayName 만 바뀐 공통 프롬프트 금지.**
   *    설정이 같으면 지문도 같아야 한다 — 그래야 "다 다르다" 는 거짓 통과가 막힌다.
   */
  const same = persona({ code: 'P10' })
  const sameOtherCode = persona({ code: 'P11' })
  check('🔴 code 만 다르고 설정이 같으면 지문이 같다 (공통 프롬프트를 잡아낸다)',
    inputFingerprint(same, voice()) === inputFingerprint(sameOtherCode, voice()))
  check('🔴 설정이 다르면 지문이 다르다',
    inputFingerprint(same, voice()) !== inputFingerprint(persona({ code: 'P10', lifeStage: '손주 있음' }), voice()))
  check('🔴 말투 근거가 다르면 지문이 다르다',
    inputFingerprint(same, voice()) !== inputFingerprint(same, voice({ endings: ['어요'] })))

  const mk = (p: CommentInputPersona): CommentInput => {
    const r = buildCommentInput({ persona: p, post, reactionRole: 'empathy', voice: voice(), memory: { has: false, note: '' } })
    if (!r.ok) throw new Error('fixture 입력이 만들어지지 않았다')
    return r.input
  }
  const clones = ['P01', 'P02', 'P03'].map((c) => mk(persona({ code: c })))
  const dv = judgeInputDiversity(clones)
  check('🔴 설정이 같은 3명은 "서로 다른 입력" 판정을 통과하지 못한다', !dv.ok && dv.unique === 1)
  check('🔴 그때 몇 개만 다른지 말한다', dv.reason.includes('공통 프롬프트'))
  const varied = [
    mk(persona({ code: 'P01', lifeStage: '자녀 초등' })),
    mk(persona({ code: 'P02', lifeStage: '손주 있음' })),
    mk(persona({ code: 'P03', lifeStage: '독립 준비' })),
  ]
  check('🟢 설정이 다르면 통과한다', judgeInputDiversity(varied).ok)
  check('🔴 빈 목록은 통과가 아니다', !judgeInputDiversity([]).ok)

  /**
   * 🔴 **Voice 자산 → 근거 연결.** 실측 구조 그대로 쓴다:
   *    `voiceCore = { ending, register, emoji, length }` · `voiceVariations = string[]`
   */
  {
    const core = { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' }
    const vars = ['바쁠 때 한 줄', '질문형', '맞장구형']
    const v = voiceEvidenceFromAssets({ voiceCore: core, voiceVariations: vars })
    check('🟢 자기 댓글이 없어도 voiceCore 로 근거가 만들어진다', v.source === 'voice-derived')
    check('🔴 말끝은 voiceCore.ending 에서 온다', v.endings.includes('~해요'))
    check('🔴 어투·이모지·길이가 표지에 들어간다',
      v.punctuation.some((x) => x.includes('이모지')) && v.punctuation.includes('존댓말'))
    check('🔴 변주가 opener 표지가 된다', v.openers.includes('질문형'))
    check('🔴 자기 발화가 있으면 출처를 그쪽으로 적는다',
      voiceEvidenceFromAssets({ voiceCore: core, voiceVariations: vars, recentTexts: ['저도 그래요'] }).source === 'persona-comments')
    check('🔴 자기 발화의 첫 어절도 opener 로 더한다',
      voiceEvidenceFromAssets({ voiceCore: core, voiceVariations: [], recentTexts: ['저도 그래요'] }).openers.includes('저도'))
    // 🔴 자산이 통째로 비면 근거가 없는 것이다 — 지어내지 않는다
    const none = voiceEvidenceFromAssets({ voiceCore: {}, voiceVariations: [] })
    check('🔴 자산이 비면 source=none 이고 입력이 막힌다', none.source === 'none')
    check('🔴 손상된 자산(문자열·null)도 안전하게 none',
      voiceEvidenceFromAssets({ voiceCore: null, voiceVariations: 'oops' }).source === 'none')
    check(`🔴 표지를 ${MAX_VOICE_MARKS}개 넘게 싣지 않는다 (프롬프트가 지시문이 된다)`,
      voiceEvidenceFromAssets({
        voiceCore: core,
        voiceVariations: Array.from({ length: 30 }, (_, i) => `v${i}`),
      }).openers.length <= MAX_VOICE_MARKS + 0)

    /**
     * 🔴 실측 구조에서 **서로 다른 Persona 는 서로 다른 지문**이 나와야 한다.
     *    이 검사가 없으면 "자산을 연결했다" 는 말만 남고 24명이 한 목소리로 돌아간다.
     */
    const mkP = (code: string, ending: string, emoji: string, stage: string): CommentInputPersona => ({
      code, ageBand: '50대', region: '서울', lifeStage: stage,
      identity: { job: `job-${code}` }, voiceCore: { ending, register: '존댓말', emoji, length: '짧은 문장' },
      voiceVariations: vars, noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
    })
    const real = [
      mkP('P01', '~해요', '가끔', '자녀 대학생'),
      mkP('P02', '~같아요', '없음', '손주 있음'),
      mkP('P03', '~어요', '자주', '독립 준비'),
    ]
    const fps = real.map((p) => inputFingerprint(p, voiceEvidenceFromAssets({ voiceCore: p.voiceCore, voiceVariations: p.voiceVariations })))
    check('🔴 실측 구조에서 세 Persona 의 지문이 모두 다르다', new Set(fps).size === 3)
    // 🔴 voiceCore 만 같고 나머지가 같으면 지문도 같다 — 거짓 통과를 막는 쪽 확인
    const twin = mkP('P04', '~해요', '가끔', '자녀 대학생')
    const twinBase = mkP('P05', '~해요', '가끔', '자녀 대학생')
    twin.identity = twinBase.identity
    check('🔴 설정이 완전히 같으면 code 가 달라도 지문이 같다',
      inputFingerprint(twin, voiceEvidenceFromAssets({ voiceCore: twin.voiceCore, voiceVariations: vars }))
      === inputFingerprint(twinBase, voiceEvidenceFromAssets({ voiceCore: twinBase.voiceCore, voiceVariations: vars })))
  }
}

// ─────────────────────────────────────────────────────────
console.log('⑤ 모델·비용 원장')
// ─────────────────────────────────────────────────────────
{
  /** 🔴 단가는 정본 표에서만 읽는다. 여기에 숫자를 다시 적지 않는다 */
  const priceOf = (label: keyof typeof M3_MODEL_CANDIDATES): ModelPrice => {
    const c = M3_MODEL_CANDIDATES[label]
    return {
      label, apiModelId: c.apiModelId,
      inputPerMTok: c.inputPerMTok, outputPerMTok: c.outputPerMTok,
      source: c.source, checkedAt: c.checkedAt,
    }
  }
  check('🔴 내부 라벨과 API 모델 ID 는 다른 값이다 (2026-08-27 Haiku 404)',
    apiModelIdFor('claude-haiku-4.5') === 'claude-haiku-4-5-20251001')
  check('🔴 등록되지 않은 모델은 던진다', (() => {
    try { apiModelIdFor('made-up-model'); return false } catch { return true }
  })())

  const est = estimateCost({ price: priceOf('claude-haiku-4.5'), calls: 10 })
  check('🟢 단가가 있으면 비용을 계산한다', est.ok)
  check('🔴 센트 아래를 0 으로 반올림하지 않는다 ($0.00 으로 보이면 안 된다)',
    est.ok && est.estimate.usd > 0 && est.estimate.usd < 1)
  check('🔴 추정인지 실측인지 함께 적는다', est.ok && est.estimate.basis === 'estimated')
  check('🔴 단가를 못 읽으면 계산하지 않는다 (0 으로 보고하면 "공짜" 로 읽힌다)',
    !estimateCost({ price: null, calls: 10 }).ok)
  check('🔴 손상된 단가는 계산하지 않는다',
    !estimateCost({ price: { ...priceOf('gpt-5-nano'), inputPerMTok: Number.NaN }, calls: 10 }).ok)

  const ok10 = estimateCost({ price: priceOf('claude-haiku-4.5'), calls: 10 })
  check('🔴 key 상태를 모르면 호출하지 않는다 (fail-closed)',
    !judgeSpend({ estimates: [ok10], keysReady: null }).allowed)
  check('🔴 key 가 없으면 harness 까지만 만들고 호출하지 않는다',
    !judgeSpend({ estimates: [ok10], keysReady: false }).allowed)
  check('🔴 비용을 계산하지 못한 모델이 하나라도 있으면 호출하지 않는다',
    !judgeSpend({ estimates: [ok10, estimateCost({ price: null, calls: 1 })], keysReady: true }).allowed)
  check(`🔴 총 호출이 ${EVAL_MAX_CALLS}회를 넘으면 막는다`,
    !judgeSpend({ estimates: [estimateCost({ price: priceOf('gpt-5-nano'), calls: EVAL_MAX_CALLS + 1 })], keysReady: true }).allowed)
  check(`🔴 예상 총비용이 $${EVAL_MAX_USD}를 넘으면 막는다`,
    !judgeSpend({
      estimates: [estimateCost({ price: priceOf('claude-haiku-4.5'), calls: 10, shape: { inputTokens: 5_000_000, outputTokens: 1_000_000 } })],
      keysReady: true,
    }).allowed)
  const allowed = judgeSpend({ estimates: [ok10], keysReady: true })
  check('🟢 상한 안이고 key 가 있으면 허용한다', allowed.allowed && (allowed.totalUsd ?? 0) > 0)

  /** 🔴 부족한 비교로 모델을 확정하지 않는다 */
  const partial = judgeModelSelection({
    verdicts: [{ model: 'claude-haiku-4.5', scores: { personaIdentity: 4 }, complete: false, samples: 3 }],
  })
  check('🔴 축을 다 못 쟀으면 provisional 이다', partial.status === 'provisional')
  check('🔴 그래도 지금까지 앞선 모델은 알려 준다', partial.winner === 'claude-haiku-4.5')
  check('🔴 비교 결과가 없으면 none', judgeModelSelection({ verdicts: [] }).status === 'none')
  const full = judgeModelSelection({
    minSamples: 2,
    verdicts: [
      { model: 'A', scores: Object.fromEntries((['personaIdentity', 'voiceSimilarity', 'contextFit', 'clicheAvoidance', 'noOverAdvice', 'noImpersonation', 'koreanNaturalness'] as const).map((k) => [k, 5])), complete: true, samples: 2 },
      { model: 'B', scores: Object.fromEntries((['personaIdentity', 'voiceSimilarity', 'contextFit', 'clicheAvoidance', 'noOverAdvice', 'noImpersonation', 'koreanNaturalness'] as const).map((k) => [k, 3])), complete: true, samples: 2 },
    ],
  })
  check('🟢 전 축·표본을 채우면 confirmed 로 고른다', full.status === 'confirmed' && full.winner === 'A')
}

// ─────────────────────────────────────────────────────────
console.log('⑥ 레인 분류 — 같은 행을 양쪽에 세지 않는다')
// ─────────────────────────────────────────────────────────
{
  const row = (commentOrigin: string, personaId: string | null): { commentOrigin: string; personaId: string | null } =>
    ({ commentOrigin, personaId })
  check('🟢 MEMBER + personaId 없음 = real', classifyComment(row('MEMBER', null)) === 'real')
  check('🟢 GUEST + personaId 없음 = real', classifyComment(row('GUEST', null)) === 'real')
  check('🟢 PERSONA + personaId 있음 = persona', classifyComment(row('PERSONA', 'p1')) === 'persona')
  check('🔴 MICRO_SEED_VERBATIM 은 어느 분자도 아니다', classifyComment(row('MICRO_SEED_VERBATIM', null)) === 'other')
  /**
   * 🔴 **모순은 0 으로 보정하지 않는다.**
   *    옛 판은 real 을 origin 으로, persona 를 `origin==='PERSONA' || personaId!==null` 로 셌다.
   *    `MEMBER` 인데 personaId 가 붙은 행은 **양쪽에 동시에** 세어져 분모가 부풀고 상한이 열린다.
   */
  check('🔴 MEMBER 인데 personaId 가 있으면 모순', classifyComment(row('MEMBER', 'p1')) === 'contradiction')
  check('🔴 PERSONA 인데 personaId 가 없으면 모순', classifyComment(row('PERSONA', null)) === 'contradiction')
  check('🔴 빈 문자열 personaId 는 없는 것으로 본다', classifyComment(row('PERSONA', '')) === 'contradiction')

  const clean = windowFromRows([row('MEMBER', null), row('GUEST', null), row('PERSONA', 'p1')], 7)
  check('🟢 정상 행이면 real 2 · persona 1', clean.measured && clean.real === 2 && clean.persona === 1)
  check('🔴 같은 행이 양쪽에 세어지지 않는다 (합이 행 수와 같다)', clean.real + clean.persona === 3)
  const dirty = windowFromRows([row('MEMBER', null), row('MEMBER', 'p1')], 7)
  check('🔴 모순 행이 하나라도 있으면 measured=false', !dirty.measured)
  check('🔴 그때 상한은 0 이다', judgeRatio(dirty).headroom === 0)
}

// ─────────────────────────────────────────────────────────
console.log('⑦ governor fail-closed 전수')
// ─────────────────────────────────────────────────────────
{
  const base = {
    window: { measured: true, real: 15, persona: 0, windowDays: 7 } as CommentWindow,
    mode: 'release' as const, publishedToday: 0, killSwitchOff: true,
  }
  check('🟢 기준 상태는 공개 1건', judgeReadiness(base).publicAllowedToday === 1)

  // 🔴 publishedToday 의 모든 나쁜 값
  for (const [label, v] of [
    ['undefined(필드 누락)', undefined], ['null', null], ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY], ['음수', -1], ['소수', 0.5],
  ] as const) {
    check(`🔴 publishedToday=${label} → 공개 0`,
      judgeReadiness({ ...base, publishedToday: v as number | null }).publicAllowedToday === 0)
  }
  // 🔴 killSwitchOff 의 모든 나쁜 값
  for (const [label, v] of [['undefined(필드 누락)', undefined], ['null', null]] as const) {
    check(`🔴 killSwitchOff=${label} → 공개 0`,
      judgeReadiness({ ...base, killSwitchOff: v as boolean | null }).publicAllowedToday === 0)
  }
  // 🔴 창의 손상값
  for (const [label, w] of [
    ['real 이 소수', { measured: true, real: 3.5, persona: 0, windowDays: 7 }],
    ['persona 가 Infinity', { measured: true, real: 15, persona: Number.POSITIVE_INFINITY, windowDays: 7 }],
    ['windowDays 가 3일', { measured: true, real: 15, persona: 0, windowDays: 3 }],
    ['windowDays 가 NaN', { measured: true, real: 15, persona: 0, windowDays: Number.NaN }],
  ] as const) {
    check(`🔴 창이 ${label} → 공개 0`,
      judgeReadiness({ ...base, window: w as CommentWindow }).publicAllowedToday === 0)
  }
  check('🔴 measured 가 true 가 아닌 값이면 0',
    judgeRatio({ measured: 1 as unknown as boolean, real: 15, persona: 0, windowDays: 7 }).headroom === 0)

  /**
   * 🔴 **shadow 는 ratio 와 무관하다.**
   *    ratio 가 0 이어도 내부 계획·생성·Gate·모델 비교는 계속 돌아야 한다 —
   *    그러지 않으면 실사용자 댓글이 늘어난 날 아무 준비 없이 공개를 켜게 된다.
   */
  const starved = judgeReadiness({
    ...base, mode: 'shadow', window: { measured: true, real: 0, persona: 0, windowDays: 7 },
  })
  check('🔴 ratio 0 이어도 shadow 는 계속 돈다', starved.shadowLimit > 0)
  check('🔴 그래도 공개는 0 이다', starved.publicAllowedToday === 0 && !starved.canPublish)
  check('🔴 집계 실패여도 shadow 는 돈다',
    judgeReadiness({ ...base, mode: 'shadow', window: { measured: false, real: 0, persona: 0, windowDays: 7 } }).shadowLimit > 0)
  check('🔴 inspect 는 아무것도 만들지 않는다',
    judgeReadiness({ ...base, mode: 'inspect' }).shadowLimit === 0)
  check(`🔴 shadow 상한은 ${DEFAULT_SHADOW_LIMIT} 를 넘지 않는다`,
    judgeReadiness({ ...base, mode: 'shadow', shadowLimit: 999 }).shadowLimit === DEFAULT_SHADOW_LIMIT)
  check('🔴 손상된 shadowLimit 은 0 으로 본다',
    judgeReadiness({ ...base, mode: 'shadow', shadowLimit: Number.NaN }).shadowLimit === 0)
}

// ─────────────────────────────────────────────────────────
console.log('⑧ 역할 어휘 통합 — planner 가 고른 것을 생성기가 받는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **여기가 `share` 사고를 막는 자리다.**
   *    planner 가 `share` 를 배정했는데 `REACTION_TYPES` 에는 그 낱말이 없어
   *    `buildPrompt` 가 `REACTION_TYPE_INVALID` 로 거부했다 —
   *    계획과 생성이 다른 낱말을 쓰고 있었다.
   */
  check('🔴 planner 어휘는 생성기 어휘의 부분집합이다',
    COMMENT_REACTION_ROLES.every((r) => isReactionType(r)))
  check('🔴 share 는 생성기 어휘에 없다 (옛 planner 가 쓰던 값)',
    !(REACTION_TYPES as readonly string[]).includes('share'))
  check('🔴 advice · caution 도 생성기 어휘에 없다',
    FORBIDDEN_REACTION_ROLES.every((r) => !(REACTION_TYPES as readonly string[]).includes(r)))

  const persona: CommentInputPersona = {
    code: 'P01', ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    identity: { job: '강사' }, voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
    voiceVariations: ['질문형', '맞장구형'], noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
  }
  const post: CommentInputPost = {
    id: 'p1', title: '무릎이 아파요', bodyDigest: '계단에서 무릎이 시큰하다',
    boardLabel: '수다방', existingCommentDigests: ['비슷하다는 댓글 1건'],
  }
  /** 🔴 planner 가 돌려줄 수 있는 **모든** 역할이 buildPrompt 를 통과해야 한다 */
  for (const role of COMMENT_REACTION_ROLES) {
    const built = buildCommentInput({
      persona, post, reactionRole: role,
      voice: voiceEvidenceFromAssets({ voiceCore: persona.voiceCore, voiceVariations: persona.voiceVariations }),
      memory: { has: false, note: '' },
    })
    check(`🟢 [${role}] 입력이 만들어진다`, built.ok)
    if (!built.ok) continue
    const prompt = buildPromptFromInput(built.input)
    check(`🟢 [${role}] buildPrompt 가 받아들인다 (share 사고 재발 방지)`, prompt.ok)
  }
  // 🔴 정본에 없는 낱말은 생성기가 거부한다 — 그 사실을 행동으로 확인한다
  const bogus = buildCommentInput({
    persona, post, reactionRole: 'share',
    voice: voiceEvidenceFromAssets({ voiceCore: persona.voiceCore, voiceVariations: persona.voiceVariations }),
    memory: { has: false, note: '' },
  })
  check('🔴 share 로 만든 입력은 buildPrompt 가 거부한다',
    bogus.ok && !buildPromptFromInput(bogus.input).ok)

  /** 🔴 Memory 가 없다는 사실이 프롬프트 본문에 실제로 실린다 */
  const built = buildCommentInput({
    persona, post, reactionRole: 'empathy',
    voice: voiceEvidenceFromAssets({ voiceCore: persona.voiceCore, voiceVariations: persona.voiceVariations }),
    memory: { has: false, note: '' },
  })
  if (built.ok) {
    const body = toPromptPost(built.input).content
    check('🔴 기억이 없다는 문장이 프롬프트에 들어간다', body.includes(NO_MEMORY_NOTE))
    check('🔴 기존 댓글 문맥이 프롬프트에 들어간다', body.includes('이미 달린 댓글'))
    check('🔴 댓글이 없으면 없다고 적는다',
      toPromptPost({ ...built.input, post: { ...post, existingCommentDigests: [] } }).content.includes('아직 댓글이 없습니다'))
    // 🔴 openerInitials 는 빈도를 지녀야 Gate ⑧ 이 잡는 것과 같은 것을 막는다
    const marks = toRecentMarks(built.input)
    check('🔴 말투 표지에 빈도가 실린다', marks.openerInitials.every((e) => e.count >= 1))
    // 🔴 Gate 입력에 forbiddenRoles 가 빠지면 관문 ⑦ 이 notRun 이 되어 통과처럼 읽힌다
    const gi = toGateInput({ input: built.input, text: '저도 그런 날이 있어요', sourceTexts: ['무릎이 아파요'] })
    check('🔴 Gate 입력에 forbiddenRoles 가 실린다', gi.forbiddenRoles !== undefined)
    check('🟢 기존 9관문 Gate 가 실제로 판정한다', checkCommentCandidate(gi).gates.length > 0)
  }
}

// ─────────────────────────────────────────────────────────
console.log('⑨ 생활사 정본 재사용')
// ─────────────────────────────────────────────────────────
{
  const base = {
    code: 'P01', noGoTopics: [] as string[],
  }
  const req = readPostRequirements('고3 딸 수능 이야기', '딸이 고3인데 수능이 코앞입니다')
  /** 🔴 글 매칭과 **같은 함수**를 부른다 — 복붙이면 한쪽만 고쳐진다 */
  const noKids = judgeLifeHistory(
    { ...base, status: 'active', accountCount: 0, providerId: null, postsThisWeek: 0, daysSinceLastPost: null, childrenCount: 0 },
    req, '고3 딸 수능 이야기', '딸이 고3인데 수능이 코앞입니다',
  )
  check('🔴 자녀가 없는데 자녀 글이면 막는다', noKids.some((b) => b.code === 'NO_CHILDREN'))
  const unknownBands = judgeLifeHistory(
    { ...base, status: 'active', accountCount: 0, providerId: null, postsThisWeek: 0, daysSinceLastPost: null, childrenCount: 2 },
    req, '고3 딸 수능 이야기', '딸이 고3인데 수능이 코앞입니다',
  )
  check('🔴 자녀 연령대를 모르면 막는다 (fail-closed)',
    unknownBands.some((b) => b.code === 'CHILD_AGE_UNKNOWN'))
  const noGo = judgeLifeHistory(
    { ...base, status: 'active', accountCount: 0, providerId: null, postsThisWeek: 0, daysSinceLastPost: null, noGoTopics: ['수능'] },
    req, '고3 딸 수능 이야기', '딸이 고3인데 수능이 코앞입니다',
  )
  check('🔴 noGo 주제가 본문에 있으면 막는다', noGo.some((b) => b.code === 'NOGO_TOPIC'))
  /**
   * 🔴 **글 발행 cadence 는 댓글에 걸지 않는다.**
   *    이번 주 글을 다 쓴 사람이 댓글도 못 다는 것은 이 규칙의 뜻이 아니다.
   */
  const busy = judgeLifeHistory(
    { ...base, status: 'active', accountCount: 0, providerId: null, postsThisWeek: 99, daysSinceLastPost: 0 },
    readPostRequirements('날씨', '비가 온다'), '날씨', '비가 온다',
  )
  check('🔴 WEEKLY_CAP · TOO_SOON 은 생활사 판정에 들어가지 않는다',
    !busy.some((b) => b.code === 'WEEKLY_CAP' || b.code === 'TOO_SOON'))
  check('🔴 실회원 판정도 생활사 판정에 들어가지 않는다 (거기는 planner 가 따로 본다)',
    !busy.some((b) => b.code === 'REAL_MEMBER'))
}

// ─────────────────────────────────────────────────────────
console.log('⑩ 실회원 정본 — judgeRealMember 하나만')
// ─────────────────────────────────────────────────────────
{
  const NOW = Date.parse('2026-09-09T12:00:00+09:00')
  const post = (o: Partial<PlannerPost> = {}): PlannerPost => ({
    id: 'x', status: 'PUBLISHED', authorPersonaCode: null, memberComments: 0, personaComments: 0,
    hasOpenQueue: false, publishedAtMs: NOW - 86_400_000, onHold: false,
    title: '날씨', body: '비가 온다', ...o,
  })
  const pers = (probe: PlannerPersona['realMember']): PlannerPersona => ({
    code: 'P01', status: 'active', realMember: probe, seedComplete: true,
    forbiddenReactionRoles: [], recentComments: 0, life: { noGoTopics: [] },
  })
  /** 🔴 조회가 어긋난 모든 모양을 fail-closed 로 막는다 */
  const bad: [string, PlannerPersona['realMember']][] = [
    ['accountCount undefined(select 누락)', { accountCount: undefined, providerId: null }],
    ['accountCount null', { accountCount: null, providerId: null }],
    ['accountCount NaN', { accountCount: Number.NaN, providerId: null }],
    ['accountCount Infinity', { accountCount: Number.POSITIVE_INFINITY, providerId: null }],
    ['accountCount 음수', { accountCount: -1, providerId: null }],
    ['accountCount 소수', { accountCount: 1.5, providerId: null }],
    ['accountCount 문자열', { accountCount: '0' as unknown as number, providerId: null }],
    ['accountCount 불리언', { accountCount: false as unknown as number, providerId: null }],
    ['providerId undefined(select 누락)', { accountCount: 0, providerId: undefined }],
  ]
  for (const [label, probe] of bad) {
    const blocks = judgePlannerPersona(pers(probe), post(), 'empathy')
    check(`🔴 ${label} → 제외`, blocks.some((b) => b.code === 'PERSONA_ACCOUNT_UNKNOWN'))
  }
  check('🔴 Account 가 있으면 사칭으로 막는다',
    judgePlannerPersona(pers({ accountCount: 1, providerId: null }), post(), 'empathy')
      .some((b) => b.code === 'PERSONA_HAS_ACCOUNT'))
  check('🔴 providerId 가 채워져 있어도 막는다 (방어적)',
    judgePlannerPersona(pers({ accountCount: 0, providerId: 'kakao:1' }), post(), 'empathy')
      .some((b) => b.code === 'PERSONA_HAS_ACCOUNT'))
  check('🟢 Account 0 · providerId null 이면 통과',
    judgePlannerPersona(pers({ accountCount: 0, providerId: null }), post(), 'empathy').length === 0)
}

// ─────────────────────────────────────────────────────────
console.log('⑪ 모델 비교 실행기 — 가짜 provider 로 행동 검증 (외부 호출 0)')
// ─────────────────────────────────────────────────────────
{
  const price = (label: string, inP: number, outP: number): ModelPrice => ({
    label, apiModelId: `${label}-api`, inputPerMTok: inP, outputPerMTok: outP,
    source: 'fixture', checkedAt: '2026-09-09',
  })
  const persona: CommentInputPersona = {
    code: 'S01', ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    identity: { job: '합성' }, voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
    voiceVariations: ['질문형'], noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
  }
  const mkInput = (i: number): CommentInput => {
    const r = buildCommentInput({
      persona: { ...persona, code: `S${i}`, lifeStage: `stage-${i}` },
      post: { id: `p${i}`, title: `제목 ${i}`, bodyDigest: `요약 ${i}`, boardLabel: '수다방', existingCommentDigests: [] },
      reactionRole: 'empathy',
      voice: voiceEvidenceFromAssets({ voiceCore: persona.voiceCore, voiceVariations: persona.voiceVariations }),
      memory: { has: false, note: '' },
    })
    if (!r.ok) throw new Error('fixture 입력 실패')
    return r.input
  }
  const inputs = [mkInput(1), mkInput(2)]
  const models = [
    { label: 'A', price: price('A', 1, 5) },
    { label: 'B', price: price('B', 0.25, 2) },
  ]
  const okCall = (rawText: string): EvalCallResult => ({
    ok: true, rawText, inputTokens: 1000, outputTokens: 200, reasoningTokens: null,
    latencyMs: 12, errorCode: null, errorMessage: null,
  })
  const judge: EvalJudge = ({ rawText }) => ({
    parseOk: true, gateStatus: 'pass', gateHits: [], textLength: rawText.length,
    textFingerprint: textFingerprint(rawText), failure: null,
    // 🔴 사람이 채점하려면 결과물이 있어야 한다
    text: rawText,
    gateLines: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass' })),
    missingRequired: [],
    statusPass: true, fullGatePass: true, bootstrapReviewEligible: false,
  })

  // 🔴 실제로 호출된 (model, input) 조합을 기록한다
  const seenPairs: string[] = []
  const r1 = await runEval({
    models, inputs, keysReady: true, maxCalls: 30, maxUsd: 3,
    call: async ({ model, input }) => {
      seenPairs.push(`${model}|${input.fingerprint}`)
      return okCall(`{"comment":"저도 그래요 ${model}"}`)
    },
    judge,
  })
  check('🟢 provider 를 실제로 부른다 (옛 판은 한 번도 부르지 않았다)', r1.totalCalls === 4)
  check('🟢 called 를 고정하지 않고 실제 호출 여부로 적는다', r1.called === true)
  /** 🔴 모델마다 **같은 입력**을 받아야 모델 비교가 된다 */
  const perModelInputs = new Map<string, Set<string>>()
  for (const p of seenPairs) {
    const [m, f] = p.split('|') as [string, string]
    perModelInputs.set(m, (perModelInputs.get(m) ?? new Set()).add(f))
  }
  const sets = [...perModelInputs.values()].map((s) => [...s].sort().join(','))
  check('🔴 두 모델이 완전히 같은 입력을 받았다', new Set(sets).size === 1 && sets.length === 2)
  check('🔴 실측 usage 로 비용을 다시 센다 (추정과 섞지 않는다)',
    r1.perModel[0]!.actualUsd !== null && r1.perModel[0]!.actualUsd !== r1.perModel[1]!.actualUsd)
  check('🔴 실제 비용 합계를 기록한다', (r1.totalActualUsd ?? 0) > 0)
  check('🔴 latency·token 을 모델별로 남긴다',
    r1.perModel.every((m) => m.latencyMsTotal > 0 && m.inputTokens > 0))
  check('🔴 blind 라벨로 모델명을 가린 표본을 남긴다',
    new Set(r1.samples.map((s) => s.blindLabel)).size === 2)
  /** 🔴 채점 전에는 winner 가 없다 */
  check('🔴 점수가 없으면 provisional 이고 winner 는 null 이다',
    r1.selection.status === 'provisional' && r1.selection.winner === null)

  // 🔴 같은 문장을 되풀이하면 중복으로 센다
  const r2 = await runEval({
    models: [models[0]!], inputs, keysReady: true, maxCalls: 30, maxUsd: 3,
    call: async () => okCall('{"comment":"똑같은 문장"}'), judge,
  })
  check('🔴 같은 지문이 반복되면 중복으로 센다', r2.perModel[0]!.duplicateTexts === 1)

  /**
   * 🔴 **호출 상한은 부르기 전에 막는다.**
   *    모델 2개 × 입력 2건 = 4회인데 상한이 3회면, 3회를 쓰고 멈추는 것이 아니라
   *    **한 번도 부르지 않는다** — 반쪽짜리 비교에 돈을 쓰지 않기 위해서다.
   */
  let attempted = 0
  const r3 = await runEval({
    models, inputs, keysReady: true, maxCalls: 3, maxUsd: 3,
    call: async () => { attempted += 1; return okCall('{"comment":"짧게"}') }, judge,
  })
  check('🔴 상한을 넘는 계획이면 한 번도 부르지 않는다', attempted === 0 && r3.totalCalls === 0)
  check('🔴 멈춘 이유를 적는다', (r3.stoppedReason ?? '').includes('상한 3회를 넘는다'))
  check('🔴 그때 called 는 false 다', !r3.called)

  // 🔴 실측 비용 상한 — 추정이 틀려도 실측이 넘으면 멈춘다
  const r4 = await runEval({
    models: [{ label: 'X', price: price('X', 1000, 1000) }], inputs,
    keysReady: true, maxCalls: 30, maxUsd: 0.5,
    call: async () => okCall('{"comment":"비싼 호출"}'), judge,
  })
  check('🔴 실측 비용이 상한을 넘으면 멈춘다', (r4.stoppedReason ?? '').includes('비용'))

  // 🔴 key 상태를 모르면 한 번도 부르지 않는다
  let called = 0
  const r5 = await runEval({
    models, inputs, keysReady: null, maxCalls: 30, maxUsd: 3,
    call: async () => { called += 1; return okCall('{"comment":"x"}') }, judge,
  })
  check('🔴 key 상태 불명이면 호출 0', called === 0 && r5.totalCalls === 0 && !r5.called)
  check('🔴 그때 winner 도 없다', r5.selection.winner === null)

  // 🔴 provider 실패는 실패로 적는다 — 재시도도 대체도 없다
  let attempts = 0
  const r6 = await runEval({
    models: [models[0]!], inputs, keysReady: true, maxCalls: 30, maxUsd: 3,
    call: async () => {
      attempts += 1
      return { ok: false, rawText: '', inputTokens: 0, outputTokens: 0, reasoningTokens: null,
        latencyMs: 5, errorCode: 'HTTP_429', errorMessage: 'rate limited' }
    },
    judge,
  })
  check('🔴 실패해도 재시도하지 않는다 (입력 수만큼만 시도)', attempts === inputs.length)
  check('🔴 실패 사유를 남긴다', r6.perModel[0]!.failures.some((f) => f.includes('HTTP_429')))
  check('🔴 실패는 성공으로 세지 않는다', r6.perModel[0]!.ok === 0)
}

// ─────────────────────────────────────────────────────────
console.log('⑫ 9관문 완전성 — notRun 을 pass 로 세지 않는다')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const all = (outcome: string): { gate: string; outcome: string }[] =>
    GATE_CODES.map((g) => line(g, outcome))

  const full = judgeGateReport({ gates: all('pass'), status: 'pass' })
  check('🟢 9개가 다 pass 면 fullPass', full.shaped && full.fullGatePass && full.ran === 9)
  check('🟢 그때 공개 Queue 적재 가능', full.queueEligible)

  /**
   * 🔴 **여기가 첫 판의 구멍이다.**
   *    `checkCommentCandidate` 는 입력과 무관하게 항상 ①~⑨ 를 돌려준다.
   *    그래서 `gates.length === 9` 는 아무것도 보장하지 않는다 —
   *    입력을 빠뜨리면 `notRun` 인 채로 9개가 채워지고 "9관문 통과" 로 읽힌다.
   */
  const withNotRun = judgeGateReport({
    gates: [...all('pass').filter((g) => g.gate !== '②'), line('②', 'notRun')],
    status: 'pass',
  })
  check('🔴 9개 결과가 있어도 notRun 이 있으면 fullPass 가 아니다',
    withNotRun.shaped && !withNotRun.fullGatePass)
  check('🔴 "결과 9개 존재" 와 "실제 실행 9개" 를 구분한다',
    withNotRun.shaped && withNotRun.ran === 8)
  check('🔴 필수 관문이 돌지 않았다고 말한다',
    withNotRun.missingRequired.includes('②') && withNotRun.reason.includes('돌지 않았다'))
  check('🔴 그때 공개 Queue 적재 불가', !withNotRun.queueEligible)
  check('🔴 notRun 을 passed 로 세지 않는다', withNotRun.passed === 8)

  // 🔴 ⑨ 는 필수가 아니다 — 출처가 카페일 때만 의미가 있다
  const onlyNine = judgeGateReport({
    gates: [...all('pass').filter((g) => g.gate !== '⑨'), line('⑨', 'notRun')],
    status: 'pass',
  })
  check('🟢 ⑨ 만 notRun 이면 필수는 충족된다', onlyNine.fullGatePass && onlyNine.queueEligible)
  check('🔴 그래도 실행 관문 수는 8 로 적는다', onlyNine.ran === 8)

  // 🔴 형식이 깨지면 fail-closed
  check('🔴 9개가 오지 않으면 막는다', !judgeGateReport({ gates: all('pass').slice(0, 8) }).shaped)
  check('🔴 같은 관문이 두 번 오면 막는다',
    !judgeGateReport({ gates: [...all('pass'), line('①', 'pass')] }).shaped)
  check('🔴 status 가 pass 가 아니면 Queue 불가',
    !judgeGateReport({ gates: all('pass'), status: 'review' }).queueEligible)
  check('🔴 status 를 안 넘기면 Queue 불가 (fail-closed)',
    !judgeGateReport({ gates: all('pass') }).queueEligible)
}

// ─────────────────────────────────────────────────────────
console.log('⑬ Gate 입력 완비 — 빠뜨린 것을 미리 안다')
// ─────────────────────────────────────────────────────────
{
  const persona: CommentInputPersona = {
    code: 'P01', ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    identity: { job: '강사', childrenCount: 1 },
    voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
    voiceVariations: ['질문형'], noGoTopics: ['정치'], noGoExpressions: ['~하시길'],
    forbiddenReactionRoles: ['rebuttal'],
  }
  const built = buildCommentInput({
    persona,
    post: { id: 'p1', title: '무릎', bodyDigest: '무릎이 아프다', boardLabel: '수다방', existingCommentDigests: [] },
    reactionRole: 'empathy',
    voice: voiceEvidenceFromAssets({ voiceCore: persona.voiceCore, voiceVariations: persona.voiceVariations }),
    memory: { has: false, note: '' },
  })
  if (!built.ok) throw new Error('fixture 입력 실패')

  const full = toGateInput({
    input: built.input, text: '저도 그래요', sourceTexts: ['무릎이 아프다'],
    knownNames: [], frequencyLookup: () => 0, corpusName: 'comment',
    // 🔴 후보 포함 표본이 minSamples 가 되도록 채운다 — 1건만 넣으면 ⑧ 이 못 돈다
    priorTexts: Array.from({ length: REQUIRED_PRIOR_TEXTS }, (_, i) => `이전 발화 ${i}`),
    seedUseCount: 1,
    adviceForbidden: false, sourceIsCafeOperational: false,
  })
  const v = judgeGateInputs(describeGateInput(full))
  check('🟢 전부 넘기면 Gate 입력 완비', v.ok && v.willNotRun.length === 0)

  /** 🔴 CommentInput 이 들고 있는 것은 **자동으로** 이어진다 — 호출부가 잊을 자리를 없앤다 */
  check('🔴 identity 가 자동으로 연결된다', full.identity !== null && full.identity !== undefined)
  check('🔴 noGoTopics·noGoExpressions 가 자동으로 연결된다',
    (full.noGoTopics ?? []).includes('정치') && (full.noGoExpressions ?? []).includes('~하시길'))
  check('🔴 forbiddenRoles 가 자동으로 연결된다', (full.forbiddenRoles ?? []).includes('rebuttal'))

  /** 🔴 `knownNames` 는 없는 것과 빈 배열이 다르다 */
  const noNames = toGateInput({
    input: built.input, text: 'x', sourceTexts: ['무릎이 아프다'],
    frequencyLookup: () => 0, corpusName: 'comment', priorTexts: [],
    adviceForbidden: false, sourceIsCafeOperational: false,
  })
  check('🔴 knownNames 를 안 넘기면 undefined 로 남는다 (빈 배열이 아니다)',
    noNames.knownNames === undefined)
  const nv = judgeGateInputs(describeGateInput(noNames))
  check('🔴 그때 ⑥ 이 돌지 않을 것이라고 미리 말한다', nv.willNotRun.includes('⑥'))
  check('🔴 빈 배열은 "조회했다" 로 인정한다',
    !judgeGateInputs(describeGateInput(toGateInput({
      input: built.input, text: 'x', sourceTexts: ['무릎'], knownNames: [],
      frequencyLookup: () => 0, corpusName: 'comment', priorTexts: [],
      adviceForbidden: false, sourceIsCafeOperational: false,
    }))).willNotRun.includes('⑥'))

  // 🔴 각 입력을 빼면 어느 관문이 죽는지
  const baseArgs = {
    input: built.input, text: 'x', sourceTexts: ['무릎'] as readonly string[],
    knownNames: [] as readonly string[],
    frequencyLookup: ((): number => 0) as Parameters<typeof toGateInput>[0]['frequencyLookup'],
    corpusName: 'comment' as string | undefined,
    priorTexts: [] as readonly string[] | undefined,
    adviceForbidden: false as boolean | undefined,
    sourceIsCafeOperational: false as boolean | undefined,
  }
  for (const [label, args, gate] of [
    ['frequencyLookup', { frequencyLookup: undefined, corpusName: undefined }, '②'],
    ['priorTexts', { priorTexts: undefined }, '⑧'],
    ['sourceIsCafeOperational', { sourceIsCafeOperational: undefined }, '⑨'],
  ] as const) {
    const gi = toGateInput({ ...baseArgs, ...args })
    check(`🔴 ${label} 을 빼면 ${gate} 이 돌지 않는다고 말한다`,
      judgeGateInputs(describeGateInput(gi)).willNotRun.includes(gate))
  }
  check('🔴 sourceTexts 가 비면 ① 이 성립하지 않는다',
    judgeGateInputs(describeGateInput(toGateInput({
      input: built.input, text: 'x', sourceTexts: ['  '], knownNames: [],
      frequencyLookup: () => 0, corpusName: 'comment', priorTexts: [],
      adviceForbidden: false, sourceIsCafeOperational: false,
    }))).willNotRun.includes('①'))

  /** 🔴 실제 Gate 정본을 우회하지 않는다 — 채운 입력으로 진짜 돌려 본다 */
  const verdict = checkCommentCandidate(full)
  const report = judgeGateReport({ gates: verdict.gates, status: verdict.status })
  check('🟢 채운 입력이면 9개 결과가 형식을 지킨다', report.shaped)
  check('🔴 실제로 돌아간 관문 수를 센다', report.ran >= 8)
  check('🔴 REQUIRED_GATES 는 ⑨ 를 뺀 여덟이다',
    REQUIRED_GATES.length === 8 && !REQUIRED_GATES.includes('⑨' as never))
}

{
  /**
   * 🔴 **실제 회원 글은 외부로 나가지 않는다.**
   *    `slice(0, 600)` 은 요약이 아니라 원문 앞부분이다.
   *    이 정책을 스크립트 플래그로 두면 뒤집혀도 아무 검사가 깨지지 않는다 —
   *    그래서 정본 상수로 올리고 여기서 값 자체를 잠근다.
   */
  check('🔴 실제 회원 글의 외부 전송이 정책상 금지다', REAL_POST_EXTERNAL_CALL_ALLOWED === false)
  const asked = judgeRealPostExternalCall({ asked: true })
  check('🔴 --call 을 붙여도 막힌다', !asked.allowed)
  check('🔴 그 이유를 "자른 원문은 요약이 아니다" 로 말한다',
    asked.reason.includes('요약이 아니다'))
  check('🔴 --call 이 없어도 당연히 막힌다', !judgeRealPostExternalCall({ asked: false }).allowed)
  // 🔴 정책을 열어도 --call 없이는 부르지 않는다 (두 조건이 곱해진다)
  check('🔴 정책을 열어도 --call 없으면 부르지 않는다',
    !judgeRealPostExternalCall({ asked: false, policyAllows: true }).allowed)
  check('🟢 정책이 열리고 --call 이 있어야 허용된다',
    judgeRealPostExternalCall({ asked: true, policyAllows: true }).allowed)
}

// ─────────────────────────────────────────────────────────
console.log('⑭ blind 표본 — 본문은 있고 모델명은 없다')
// ─────────────────────────────────────────────────────────
{
  const price = (label: string): ModelPrice => ({
    label, apiModelId: `${label}-api`, inputPerMTok: 1, outputPerMTok: 5,
    source: 'fixture', checkedAt: '2026-09-09',
  })
  const persona: CommentInputPersona = {
    code: 'S01', ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    identity: { job: '합성' }, voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
    voiceVariations: ['질문형'], noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
  }
  const r = buildCommentInput({
    persona,
    post: { id: 'p1', title: '제목', bodyDigest: '요약', boardLabel: '수다방', existingCommentDigests: [] },
    reactionRole: 'empathy',
    voice: voiceEvidenceFromAssets({ voiceCore: persona.voiceCore, voiceVariations: persona.voiceVariations }),
    memory: { has: false, note: '' },
  })
  if (!r.ok) throw new Error('fixture 입력 실패')

  const run = await runEval({
    models: [{ label: 'claude-haiku-4.5', price: price('claude-haiku-4.5') },
      { label: 'gemini-3.7-flash', price: price('gemini-3.7-flash') }],
    inputs: [r.input], keysReady: true, maxCalls: 30, maxUsd: 3,
    call: async ({ model }) => ({
      ok: true, rawText: `{"comment":"저도 그런 날이 있어요 ${model}"}`,
      inputTokens: 100, outputTokens: 20, reasoningTokens: null,
      latencyMs: 10, errorCode: null, errorMessage: null,
    }),
    judge: ({ rawText }) => ({
      parseOk: true, gateStatus: 'pass', gateHits: [], textLength: rawText.length,
      textFingerprint: textFingerprint(rawText), failure: null,
      // 🔴 사람이 읽을 본문이 있어야 7축 채점이 된다
      text: rawText, gateLines: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass' })), missingRequired: [],
    statusPass: true, fullGatePass: true, bootstrapReviewEligible: false,
    }),
  })
  check('🔴 표본에 생성 본문이 담긴다 (지문만으로는 채점할 수 없다)',
    run.samples.every((smp) => typeof smp.text === 'string' && smp.text.length > 0))
  check('🔴 표본에 9관문 전체 결과가 담긴다',
    run.samples.every((smp) => smp.gateLines.length === 9))
  check('🔴 표본에 blind 라벨이 있다', run.samples.every((smp) => /^[A-Z]$/.test(smp.blindLabel)))
  /**
   * 🔴 **모델명은 표본에 넣지 않는다.** 실제 파일 저장은 스크립트가 하지만,
   *    표본이 들고 있는 필드가 모델명을 담고 있으면 어떤 저장 방식으로도 새어 나간다.
   *    여기서는 "라벨이 모델명과 다르다" 를 확인한다 — 라벨이 곧 모델명이면 가림이 아니다.
   */
  check('🔴 blind 라벨이 모델명 자체가 아니다',
    run.samples.every((smp) => smp.blindLabel !== smp.model))
  check('🟢 대응표는 라벨→모델로 따로 만들 수 있다',
    new Set(run.samples.map((smp) => `${smp.blindLabel}=${smp.model}`)).size === 2)
  check('🔴 점수가 없으므로 winner 는 여전히 null',
    run.selection.winner === null && run.selection.status === 'provisional')
}

// ─────────────────────────────────────────────────────────
console.log('⑮ 평가 artifact 불변성 — dry-run 이 유료 결과를 덮지 않는다')
// ─────────────────────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'soran-eval-store-'))
  const art = (tag: string): Parameters<typeof savePaidRun>[0]['artifact'] => ({
    summary: { tag, totalCalls: 20 },
    samples: { samples: [{ id: 'S001', blindLabel: 'A', text: `본문 ${tag}` }] },
    key: { key: [{ blindLabel: 'A', model: 'claude-haiku-4.5' }] },
  })

  const paid = savePaidRun({ root, runId: '20260909-084801', called: true, artifact: art('paid') })
  check('🟢 유료 실행 결과가 runId 디렉터리에 저장된다', paid.ok)
  const before = hashRun(root, '20260909-084801')
  check('🔴 세 파일이 다 저장된다', before !== null && Object.keys(before).length === 3)
  check('🟢 latest 는 유료 실행 뒤에만 갱신된다',
    pointLatest({ root, runId: '20260909-084801', called: true }).ok)

  /**
   * 🔴 **여기가 실제로 일어난 사고다.**
   *    유료 20회 결과를 그 다음 dry-run 이 같은 경로에 덮어써 `samples: []` 만 남았다.
   */
  const dry = savePaidRun({ root, runId: '20260909-085112', called: false, artifact: art('dry') })
  check('🔴 dry-run 은 유료 저장소에 들어오지 않는다', !dry.ok)
  check('🔴 그 이유를 "유료 실행만 보관한다" 로 말한다', !dry.ok && dry.reason.includes('유료 실행만'))
  check('🔴 dry-run 은 latest 를 옮기지 않는다', !pointLatest({ root, runId: '20260909-084801', called: false }).ok)
  const after = hashRun(root, '20260909-084801')
  check('🔴 dry-run 을 돌려도 유료 표본의 해시가 그대로다',
    before !== null && after !== null
    && JSON.stringify(before) === JSON.stringify(after))

  /** 🔴 같은 회차에 두 번 쓰면 앞의 것이 사라진다 — 그래서 막는다 */
  const again = savePaidRun({ root, runId: '20260909-084801', called: true, artifact: art('overwrite') })
  check('🔴 같은 runId 는 덮어쓰지 않는다', !again.ok && again.reason.includes('덮어쓰지 않는다'))
  const after2 = hashRun(root, '20260909-084801')
  check('🔴 덮어쓰기 시도 뒤에도 해시가 그대로다',
    after2 !== null && JSON.stringify(before) === JSON.stringify(after2))

  // 🔴 다른 회차는 나란히 쌓인다
  check('🟢 다른 runId 는 새 디렉터리로 쌓인다',
    savePaidRun({ root, runId: '20260909-090000', called: true, artifact: art('second') }).ok)
  check('🔴 회차 목록이 오래된 것부터다',
    listRuns(root).join(',') === '20260909-084801,20260909-090000')
  check('🔴 첫 회차는 두 번째 저장에도 그대로다',
    JSON.stringify(hashRun(root, '20260909-084801')) === JSON.stringify(before))
  check('🔴 형식이 아닌 runId 는 저장하지 않는다',
    !savePaidRun({ root, runId: 'latest', called: true, artifact: art('x') }).ok)
  check('🔴 없는 회차로 latest 를 옮기지 않는다',
    !pointLatest({ root, runId: '20991231-000000', called: true }).ok)
  check('🟢 latest 파일이 만들어진다', existsSync(join(root, LATEST_FILE)))
  check('🔴 runId 형식이 정렬 가능하다', /^\d{8}-\d{6}$/.test(runIdOf(new Date())))

  rmSync(root, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────
console.log('⑯ Gate 지표 분리 — statusPass 와 fullGatePass 는 다르다')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const withEight = (eight: string): { gate: string; outcome: string }[] =>
    GATE_CODES.map((g) => line(g, g === '⑧' ? eight : 'pass'))

  /**
   * 🔴 **실제 20표본이 이 모양이었다.** ⑧ 이 notRun 인데 `status` 는 pass 라
   *    옛 집계가 전부 "Gate pass" 로 셌다.
   */
  const r = judgeGateReport({ gates: withEight('notRun'), status: 'pass' })
  check('🔴 statusPass 는 true 다 (돌아간 관문만 봤을 때)', r.statusPass)
  check('🔴 그러나 fullGatePass 는 false 다 (⑧ 이 돌지 않았다)', !r.fullGatePass)
  check('🔴 둘이 다른 값이다 — 이름 하나로 세면 안 된다', r.statusPass !== r.fullGatePass)
  check('🔴 missingRequired 에 ⑧ 이 있다', r.missingRequired.join('') === '⑧')
  check('🔴 queueEligible 은 false 다', !r.queueEligible)
  check('🔴 passed 에 notRun 을 세지 않는다', r.passed === 8)
  check('🔴 ran 은 8 이다', r.ran === 8)

  const full = judgeGateReport({ gates: withEight('pass'), status: 'pass' })
  check('🟢 ⑧ 이 pass 면 fullGatePass 이고 queueEligible 이다',
    full.fullGatePass && full.queueEligible && full.statusPass)
  check('🔴 status 가 review 면 statusPass 가 false 다',
    !judgeGateReport({ gates: withEight('pass'), status: 'review' }).statusPass)
}

// ─────────────────────────────────────────────────────────
console.log('⑰ Gate ⑧ cold-start — 자동 통과가 아니라 사람 승인')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const rep = (eight: string, status = 'pass'): GateReport =>
    judgeGateReport({ gates: GATE_CODES.map((g) => line(g, g === '⑧' ? eight : 'pass')), status })
  const base = {
    report: rep('notRun'), priorTextCount: 0,
    bootstrapUsedTotal: 0, bootstrapUsedToday: 0,
    personaActive: true, realMember: false, seedComplete: true,
    lifeConflict: false, governorOk: true,
  }

  const ok = judgeBootstrapEligible(base)
  check('🟢 ⑧ 만 표본이 없으면 bootstrap 후보다', ok.bootstrapReviewEligible)
  /** 🔴 bootstrap 은 **자동 공개가 아니다.** 어떤 분기로도 true 가 되지 않는다 */
  check('🔴 bootstrap 이어도 자동 공개는 불가하다', ok.autoPublishAllowed === false)
  check('🔴 사람 승인 Queue 로만 간다고 말한다', ok.reason.includes('사람 승인 Queue'))

  // 🔴 ⑧ 외에 다른 관문이 안 돌았으면 그것은 cold-start 가 아니라 입력 누락이다
  const twoMissing = judgeBootstrapEligible({
    ...base,
    report: judgeGateReport({
      gates: GATE_CODES.map((g) => line(g, g === '⑧' || g === '②' ? 'notRun' : 'pass')),
      status: 'pass',
    }),
  })
  check('🔴 ⑧ 외에도 안 돌았으면 bootstrap 이 아니다', !twoMissing.bootstrapReviewEligible)
  check('🔴 그때 "입력 누락이지 cold-start 가 아니다" 로 말한다',
    twoMissing.blockers.some((b) => b.includes('cold-start 가 아니다')))
  check('🔴 ⑧ 이 돌았으면 bootstrap 이 필요 없다',
    !judgeBootstrapEligible({ ...base, report: rep('pass') }).bootstrapReviewEligible)
  check('🔴 ⑧ 이 reject 면 bootstrap 이 아니다 (돌았는데 막힌 것이다)',
    !judgeBootstrapEligible({ ...base, report: rep('reject', 'reject') }).bootstrapReviewEligible)

  // 🔴 운영 조건은 전부 막는다
  for (const [label, over] of [
    // 🔴 이제는 **필요한 수에 도달했을 때**만 막는다. 1건은 아직 cold-start 다
    ['이전 발화가 필요한 수에 도달하면', { priorTextCount: REQUIRED_PRIOR_TEXTS }],
    ['active 가 아니면', { personaActive: false }],
    ['실회원이면(또는 판별 불가)', { realMember: true }],
    ['seed·voice 가 불완전하면', { seedComplete: false }],
    ['생활사가 충돌하면', { lifeConflict: true }],
    ['governor 가 정상이 아니면', { governorOk: false }],
  ] as const) {
    check(`🔴 ${label} bootstrap 불가`,
      !judgeBootstrapEligible({ ...base, ...over }).bootstrapReviewEligible)
  }

  // 🔴 상한
  check(`🔴 Persona 당 ${BOOTSTRAP_MAX_PER_PERSONA}건까지다`,
    !judgeBootstrapEligible({ ...base, bootstrapUsedTotal: BOOTSTRAP_MAX_PER_PERSONA }).bootstrapReviewEligible)
  check('🟢 상한 직전은 아직 가능하다',
    judgeBootstrapEligible({ ...base, bootstrapUsedTotal: BOOTSTRAP_MAX_PER_PERSONA - 1 }).bootstrapReviewEligible)
  check(`🔴 하루 ${BOOTSTRAP_MAX_PER_DAY_PER_PERSONA}건까지다`,
    !judgeBootstrapEligible({ ...base, bootstrapUsedToday: BOOTSTRAP_MAX_PER_DAY_PER_PERSONA }).bootstrapReviewEligible)

  /** 🔴 예외가 영구 규칙이 되지 않게 — 표본이 쌓이면 끝낸다 */
  check('🔴 표본이 쌓이기 전에는 bootstrap 구간이다', !bootstrapPhaseOver(0) && !bootstrapPhaseOver(1))
  check(`🟢 발화 ${BOOTSTRAP_EXIT_PRIOR_TEXTS}건이면 bootstrap 이 끝난다`,
    bootstrapPhaseOver(BOOTSTRAP_EXIT_PRIOR_TEXTS))
  check('🔴 bootstrap 이 끝나면 ⑧ 완전 판정 대상이다',
    !judgeBootstrapEligible({ ...base, priorTextCount: BOOTSTRAP_EXIT_PRIOR_TEXTS }).bootstrapReviewEligible)
}

// ─────────────────────────────────────────────────────────
console.log('⑱ Gate ⑧ 기준 단일 정본 — 사각지대가 없다')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const rep = (eight: string, status = 'pass'): GateReport =>
    judgeGateReport({ gates: GATE_CODES.map((g) => line(g, g === '⑧' ? eight : 'pass')), status })
  const base = {
    report: rep('notRun'),
    bootstrapUsedTotal: 0, bootstrapUsedToday: 0,
    personaActive: true, realMember: false, seedComplete: true,
    lifeConflict: false, governorOk: true,
  }

  /**
   * 🔴 **숫자를 두 곳에 적으면 어긋난다.**
   *    옛 판은 bootstrap 종료를 `2` 로 적었는데 ⑧ 의 기준은 `minSamples: 5` 였다.
   *    그래서 prior 1·2·3 인 Persona 는 bootstrap 도 막히고 ⑧ 도 안 돌았다 —
   *    첫 댓글을 하나 만들고 나면 두 번째부터 아무 데로도 갈 수 없었다.
   */
  check('🔴 bootstrap 종료 기준이 Gate ⑧ 정본에서 파생된다',
    BOOTSTRAP_EXIT_PRIOR_TEXTS === DEFAULT_FINGERPRINT_THRESHOLDS.minSamples - 1)
  check('🔴 후보 자신이 표본에 들어가므로 필요한 prior 는 minSamples-1 이다',
    REQUIRED_PRIOR_TEXTS === DEFAULT_FINGERPRINT_THRESHOLDS.minSamples - 1)
  /** 🔴 총 상한이 이보다 작으면 그 상한이 새 사각지대가 된다 */
  check('🔴 bootstrap 총 상한이 필요한 prior 수 이상이다',
    BOOTSTRAP_MAX_PER_PERSONA >= REQUIRED_PRIOR_TEXTS)

  // 🔴 prior 0 부터 필요한 수 직전까지 전부 열려 있어야 한다
  for (let n = 0; n < REQUIRED_PRIOR_TEXTS; n += 1) {
    const v = judgeBootstrapEligible({ ...base, priorTextCount: n, bootstrapUsedTotal: n })
    check(`🟢 prior ${n}건 → bootstrap 가능 (⑧ 이 아직 못 돈다)`, v.bootstrapReviewEligible)
    check(`🔴 prior ${n}건에서는 ⑧ 이 실제로 돌 수 없다`, !gateEightCanRun(n))
    check(`🔴 prior ${n}건은 아직 bootstrap 구간이다`, !bootstrapPhaseOver(n))
  }
  // 🔴 도달하면 종료되고, 바로 그 지점에서 ⑧ 이 돈다
  check(`🔴 prior ${REQUIRED_PRIOR_TEXTS}건이면 bootstrap 이 끝난다`,
    bootstrapPhaseOver(REQUIRED_PRIOR_TEXTS)
    && !judgeBootstrapEligible({ ...base, priorTextCount: REQUIRED_PRIOR_TEXTS }).bootstrapReviewEligible)
  check(`🟢 바로 그 지점에서 ⑧ 이 실제로 돈다`, gateEightCanRun(REQUIRED_PRIOR_TEXTS))
  check('🔴 종료 시점과 ⑧ 실행 시점이 정확히 같다 — 사각지대 0',
    Array.from({ length: 8 }, (_, n) => bootstrapPhaseOver(n) === gateEightCanRun(n)).every(Boolean))

  /**
   * 🔴 **후보 포함 표본이 정확히 minSamples 가 되는지** 실제 Gate ⑧ 으로 확인한다.
   *    상수만 맞추고 실제 관문이 다르게 세면 아무것도 지킨 것이 아니다.
   */
  const priors = Array.from({ length: REQUIRED_PRIOR_TEXTS }, (_, i) => `이전 발화 ${i} 입니다`)
  const ran = checkVoiceFingerprint('오늘은 날이 좋네요', { priorTexts: priors })
  check(`🟢 prior ${REQUIRED_PRIOR_TEXTS}건 + 후보 1건이면 Gate ⑧ 이 실제로 돈다`,
    ran.status !== 'notRun' && ran.sampleSize === DEFAULT_FINGERPRINT_THRESHOLDS.minSamples)
  const notRan = checkVoiceFingerprint('오늘은 날이 좋네요', { priorTexts: priors.slice(0, -1) })
  check('🔴 한 건만 모자라도 Gate ⑧ 은 notRun 이다', notRan.status === 'notRun')
  check('🔴 그때 "대조 발화 부족" 이라고 말한다', notRan.detail.includes('대조 발화 부족'))

  // 🔴 자동 공개 불가·사람 승인 전용·하루 1건은 그대로다
  const mid = judgeBootstrapEligible({ ...base, priorTextCount: 2, bootstrapUsedTotal: 2 })
  check('🔴 bootstrap 중에도 자동 공개는 불가하다', mid.autoPublishAllowed === false)
  check('🔴 사람 승인 Queue 로만 간다', mid.reason.includes('사람 승인 Queue'))
  check(`🔴 하루 ${BOOTSTRAP_MAX_PER_DAY_PER_PERSONA}건 제한은 그대로다`,
    !judgeBootstrapEligible({ ...base, priorTextCount: 1, bootstrapUsedToday: 1 }).bootstrapReviewEligible)
}

// ─────────────────────────────────────────────────────────
console.log('⑲ Gate 사전 판정 정직성 — 필드 전달 ≠ 실행 가능')
// ─────────────────────────────────────────────────────────
{
  const gi = (prior: readonly string[] | undefined): ReturnType<typeof judgeGateInputs> =>
    judgeGateInputs({
      knownNames: [], hasFrequencyLookup: true, corpusName: 'comment',
      identity: { a: 1 }, noGoTopics: [], noGoExpressions: [],
      priorTexts: prior, sourceTexts: ['x'], forbiddenRoles: [],
      adviceForbidden: false, sourceIsCafeOperational: false,
    })

  /**
   * 🔴 **`priorTexts: []` 를 "완비" 로 보면 안 된다.**
   *    필드는 왔지만 표본이 0 건이라 ⑧ 은 notRun 이다 —
   *    옛 판은 이것을 `ok: true`, `willNotRun: []` 로 돌려줬다.
   */
  const empty = gi([])
  check('🔴 priorTexts=[] 는 필드는 왔지만 실행 가능이 아니다',
    empty.fieldsComplete && !empty.ok)
  check('🔴 그때 ⑧ 이 돌지 않을 것이라고 말한다', empty.willNotRun.includes('⑧'))
  check('🔴 몇 건이 모자란지 수치로 말한다',
    empty.missing.some((m) => m.includes(String(DEFAULT_FINGERPRINT_THRESHOLDS.minSamples))))

  // 🔴 경계
  const short = gi(Array.from({ length: REQUIRED_PRIOR_TEXTS - 1 }, (_, i) => `p${i}`))
  check(`🔴 prior ${REQUIRED_PRIOR_TEXTS - 1}건은 아직 부족하다`, !short.ok && short.willNotRun.includes('⑧'))
  const enough = gi(Array.from({ length: REQUIRED_PRIOR_TEXTS }, (_, i) => `p${i}`))
  check(`🟢 prior ${REQUIRED_PRIOR_TEXTS}건이면 실행 가능이다`, enough.ok && enough.willNotRun.length === 0)
  check('🔴 필드 자체가 없으면 fieldsComplete 도 false 다',
    !gi(undefined).fieldsComplete && !gi(undefined).ok)

  /**
   * 🔴 **가짜 표지를 이전 발화로 세지 않는다.**
   *    옛 shadow 는 `'(이번 배치 후보)'` 라는 placeholder 를 배치 prior 에 넣었다.
   *    그것은 발화가 아니라 글자이고, ⑧ 은 그것으로 말끝·시작어절을 잰다 —
   *    표본 수만 부풀어 관문이 돈 것처럼 보인다.
   */
  const real = Array.from({ length: REQUIRED_PRIOR_TEXTS }, (_, i) => `저도 그런 날이 있었어요 ${i}`)
  const withPlaceholder = [...real.slice(0, 1), '(이번 배치 후보)', '(이번 배치 후보)', '(이번 배치 후보)']
  const rp = checkVoiceFingerprint('오늘은 날이 좋네요', { priorTexts: withPlaceholder })
  check('🔴 placeholder 로 채우면 표본 수가 채워져 관문이 돌아 버린다 (그래서 넣지 않는다)',
    rp.status !== 'notRun')
  // 🔴 실행 코드가 placeholder 를 넣지 않는지 — 넣으면 위 계산이 거짓이 된다
  const planSrc = readFileSync('scripts/persona-comment-plan.mts', 'utf-8')
  check('🔴 shadow 실행 코드가 placeholder 를 prior 로 넣지 않는다',
    !planSrc.includes("'(이번 배치 후보)'"))
  check('🟢 진짜 발화 4건이면 정상적으로 돈다',
    checkVoiceFingerprint('오늘은 날이 좋네요', { priorTexts: real }).sampleSize
    === DEFAULT_FINGERPRINT_THRESHOLDS.minSamples)
}

// ─────────────────────────────────────────────────────────
console.log('⑳ latest 갱신 실패는 성공이 아니다')
// ─────────────────────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'soran-latest-'))
  const art = {
    summary: { a: 1 }, samples: { samples: [] }, key: { key: [] },
  }
  check('🟢 저장은 된다', savePaidRun({ root, runId: '20260909-190000', called: true, artifact: art }).ok)
  /** 🔴 없는 회차를 가리키게 하면 실패해야 한다 — 성공으로 세면 옛 회차를 채점하게 된다 */
  const bad = pointLatest({ root, runId: '20991231-000000', called: true })
  check('🔴 없는 회차로는 latest 를 옮기지 않는다', !bad.ok)
  check('🔴 그 이유를 말한다', bad.reason.includes('그 회차가 없다'))
  check('🟢 있는 회차면 옮긴다', pointLatest({ root, runId: '20260909-190000', called: true }).ok)
  /** 🔴 실행 코드가 실패를 exit 1 로 다루는지 — 출력만 하고 넘어가면 아무도 모른다 */
  const evalSrc = readFileSync('scripts/persona-comment-eval.mts', 'utf-8')
  check('🔴 latest 실패를 exit 1 로 보고한다',
    /if \(!pointed\.ok\) \{[\s\S]*?process\.exit\(1\)/.test(evalSrc))
  check('🔴 그때 저장된 회차 경로를 함께 알린다', evalSrc.includes('저장된 회차는 그대로 있다'))
  rmSync(root, { recursive: true, force: true })
}

// ─────────────────────────────────────────────────────────
console.log('㉑ 문서가 실제 경로를 말하는가')
// ─────────────────────────────────────────────────────────
{
  const master = readFileSync('docs/operations/MASTER-OPERATING-SYSTEM.md', 'utf-8')
  /**
   * 🔴 실제 DB 글로는 provider 를 부르지 않는다(개인정보 계약).
   *    그런데 문서가 "planner → callProvider → Gate end-to-end 완료" 라고 적고 있었다.
   *    그 문장을 읽은 사람은 있지도 않은 경로를 있다고 믿는다.
   */
  check('🔴 실제 DB shadow 가 provider 호출로 끝난다고 적지 않는다',
    !/실제 DB[^\n]*→[^\n]*callProvider/.test(master)
    && !master.includes('planner → Persona-first 입력 → 기존 `buildPrompt`\n *    → (선택) 기존 `callProvider`'))
  check('🔴 실제 DB shadow 의 종점이 Gate 입력 사전검사임을 적는다',
    master.includes('Gate 입력 사전검사'))
  check('🔴 합성 eval 만 provider 를 부른다고 적는다',
    master.includes('합성 input → buildPrompt → provider → 실제 Gate'))
  check('🔴 단일 end-to-end 경로가 의도적으로 없다고 적는다',
    master.includes('의도적으로 막혀 있다'))
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
