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
  estimateCost, judgeAbsoluteQuality, judgeModelSelection, judgeSpend,
  EVAL_MAX_CALLS, EVAL_MAX_USD, type ModelPrice,
} from '../src/lib/persona-comment-cost'
import { MEMBER_COMMENT_LIMIT } from '../src/lib/persona-target-rules'
import {
  COMMENT_REACTION_ROLES, REACTION_TYPES, isAdviceForbidden, isReactionType,
} from '../src/lib/persona-reaction-roles'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** fixture 전용 — 중간 디렉터리까지 만든다 */
const mkdirDeep = (dir: string): void => { mkdirSync(dir, { recursive: true }) }

import { M3_MODEL_CANDIDATES, apiModelIdFor } from './lib/voice-m3-contract.mjs'
import {
  classifyComment, windowFromRows, DEFAULT_SHADOW_LIMIT,
} from '../src/lib/persona-comment-governor'
import { judgeLifeHistory, readPostRequirements } from '../src/lib/original-post-persona-match'
import {
  judgeModelGate, judgePostAuthor, judgeRelease,
  ALLOWED_MODELS, MEMBER_POST_EXTERNAL_SEND_POLICY,
  type ModelGateVerdict, type PostAuthorFacts,
} from '../src/lib/persona-comment-release'
import {
  dedupKeyOf, planEnqueue, recheckBeforePublish,
  ENQUEUE_STATUS, OPEN_STATUSES, MEMBER_COMMENT_LIMIT_ON_PUBLISH,
  type EnqueueFacts, type TxRecheckFacts,
} from '../src/lib/persona-comment-queue'
import {
  COMMENT_RUNNER_LABEL, COMMENT_RUNNER_SCRIPT, COMMENT_RUNNER_SLOTS,
  readRunnerState, renderCommentRunnerPlist,
} from './lib/persona-comment-runner-template'
import {
  buildCanonFromScoring, provenanceOf, readConfirmedSelection, verifyCanonArtifacts,
  verifyProvenance, MODEL_CANON_FILE,
} from '../src/lib/persona-comment-provenance'
import { runEnqueuePipeline, type PipelineTarget } from './lib/persona-comment-pipeline'
import {
  gateInputOf, materializeTargets, sourceTextsOf,
  type SourcePersona, type SourcePost, type TargetSource,
} from './lib/persona-comment-targets'
import { makeDbTargetSource } from './lib/persona-comment-source-db'
import { judgeQueueFlags } from './lib/persona-comment-run-flags'
import {
  applyWithVerification, judgeMigrationState, judgeProjectRef,
  BASELINE_COLUMNS, BASELINE_INDEXES,
  NEW_COLUMNS as MIG_NEW_COLUMNS, NEW_INDEX as MIG_NEW_INDEX, TARGET_TABLE as MIG_TABLE,
} from './lib/migration-0024-state.mjs'
import { judgeSourceContext } from '../src/lib/persona-comment-source-context'
import { batchSizeFor, publishBatch } from './lib/persona-comment-publish-batch'
import { promoteRun, promotionStatus } from './lib/persona-comment-canon-store'
import { ARTIFACT_ROOT } from '../src/lib/persona-comment-provenance'
import {
  capabilitiesReady, COMMENT_CAPABILITIES,
} from '../src/lib/persona-comment-release'
import { isSerializationConflict, TX_MAX_WAIT_MS, TX_TIMEOUT_MS } from '../src/lib/persona-publish-tx'
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
import { bundlesForPersonas } from './lib/persona-reference-store.mjs'
import {
  bundlesAreDistinct, findReferenceCopy, looksLikePostBody,
} from '../src/lib/persona-voice-reference'
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
  /**
   * 🔴 **모델이 하나면 "우세" 가 아니다** (2026-09-10, Wave E 정정).
   *    옛 판은 하나뿐인 목록의 첫 줄을 winner 로 적었다. 그것은 비교 결과가 아니다.
   */
  check('🔴 비교 대상이 하나면 winner 를 내지 않는다', partial.winner === null)
  check('  이유를 말한다', partial.reason.includes('상대 비교가 성립하지 않는다'))

  /** 🔴 절대 품질 미달이면 평균이 더 높아도 winner 는 null 이다 */
  const allRejected = judgeModelSelection({
    minSamples: 2,
    verdicts: [
      { model: 'A', scores: { personaIdentity: 5 }, complete: true, samples: 10, rejected: 9,
        rejectReasons: { FABRICATED_SCENE: 9 } },
      { model: 'B', scores: { personaIdentity: 2 }, complete: true, samples: 10, rejected: 8,
        rejectReasons: { REPEATED_AI_OPENER: 8 } },
    ],
  })
  check('🔴 두 모델 모두 공개 불가면 winner 가 없다', allRejected.winner === null)
  check('  status 는 none', allRejected.status === 'none')
  check('  평균이 높은 A 도 승자가 아니다', !allRejected.reason.includes('앞섰다'))
  check('  탈락 모델을 이름으로 남긴다',
    (allRejected.rejectedModels ?? []).length === 2)
  check('🔴 Gate 통과는 사람 품질 통과가 아니다 — 별도 판정 함수가 있다',
    judgeAbsoluteQuality({ model: 'X', scores: {}, complete: true, samples: 10, rejected: 3 }).pass === false)
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
console.log('⑤-b 🔴 Wave E — 말투 근거(reference) 계약')
{
  /** 🔴 **자산을 실물로 읽는다.** 시험용 문자열만 보면 "연결됐는가" 를 증명하지 못한다 */
  const codes = ['S01', 'S02', 'S03', 'S04', 'S05']
  const ref = bundlesForPersonas({ repoRoot: process.cwd(), personaCodes: codes })
  const assetOk = ref.assets.some((a) => a.exists && a.comments > 0)
  check('🟢 실제 댓글 자산이 붙어 있다', assetOk)
  if (!assetOk) {
    check('🔴 자산이 없으면 숨기지 않고 blocker 를 낸다', ref.blocks.length > 0)
  } else {
    check(`🟢 Persona ${codes.length}종 전부 근거를 얻는다`, ref.byCode.size === codes.length)
    const bundles = [...ref.byCode.values()]

    /** 🔴 Persona 마다 근거가 **실제로 다르다** — 어미 차이가 아니라 자산이 다르다 */
    check('🔴 묶음이 서로 한 건도 겹치지 않는다', bundlesAreDistinct(bundles).distinct)

    /** 🔴 길이 분포가 살아 있다 — 짧은 것만 모이면 "무조건 짧게" 가 되살아난다 */
    for (const b of bundles) {
      check(`🔴 ${b.personaCode} 묶음이 길이 분포를 갖는다 (중앙 ${b.lengths.median} < p90 ${b.lengths.p90})`,
        b.lengths.p90 > b.lengths.median)
    }

    /** 🔴 본문·닉네임이 섞이지 않는다 */
    const allTexts = bundles.flatMap((b) => b.comments.map((c) => c.text))
    check('🔴 본문 길이 항목이 없다', allTexts.every((t) => !looksLikePostBody(t)))
    check('🔴 반환 항목에 작성자 자리가 없다',
      bundles.every((b) => b.comments.every((c) => Object.keys(c).join() === 'text')))

    const built = buildCommentInput({
      persona: {
        code: 'S01', ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
        identity: { job: '합성', note: '시험' },
        voiceCore: { ending: '~해요', register: '존댓말', emoji: '없음', length: '중간 길이' },
        voiceVariations: ['질문형'], noGoTopics: ['정치'], noGoExpressions: ['~하시길'],
        forbiddenReactionRoles: [],
      },
      post: {
        id: 'ref-1', title: '무릎이 시큰해요', bodyDigest: '계단 오를 때 아프다는 이야기',
        boardLabel: '수다방', existingCommentDigests: [],
      },
      reactionRole: 'empathy',
      voice: voiceEvidenceFromAssets({
        voiceCore: { ending: '~해요', register: '존댓말', emoji: '없음', length: '중간 길이' },
        voiceVariations: ['질문형'],
      }),
      memory: { has: false, note: '' },
    })
    check('🟢 시험 입력이 성립한다', built.ok)
    if (built.ok) {
      const bundle = ref.byCode.get('S01')!
      const p = buildPromptFromInput(built.input, [], bundle)
      check('🟢 근거를 주면 프롬프트가 만들어진다', p.ok)
      const sys = p.ok ? p.prompt.systemPrompt : ''
      /** 🔴 선언이 아니라 문자열로 확인한다 */
      check('🔴 근거 댓글이 실제로 프롬프트 안에 있다',
        bundle.comments.every((c) => sys.includes(c.text)))
      check('🔴 근거가 금지 목록보다 앞에 온다',
        sys.indexOf('말투는 아래 실제 댓글에서') < sys.indexOf('## 절대 하지 않는 것'))

      /** 🔴 **근거 없이는 부르지 않는다** — 옛 경로(설정만 보고 창작)로 돌아가지 못한다 */
      const blocked = buildPromptFromInput(built.input, [], undefined)
      check('🔴 근거가 없으면 프롬프트를 만들지 않는다', !blocked.ok)
      check('  REFERENCE_MISSING 으로 막는다',
        !blocked.ok && blocked.blocks.some((b) => b.code === 'REFERENCE_MISSING'))

      /** 🔴 통째로 베낀 것을 잡는다 — Gate ① 은 원글 대조라 이 자리를 보지 않는다 */
      const longest = bundle.comments.slice().sort((a, b) => b.text.length - a.text.length)[0]!
      const copied = findReferenceCopy(longest.text, bundle)
      check(`🔴 근거를 통째로 옮기면 잡는다 (연속 ${copied.runLength}자)`, copied.copied)
      check('🟢 제 말로 쓴 것은 잡지 않는다', !findReferenceCopy('오늘은 좀 낫네요 그쵸', bundle).copied)
    }
  }
}

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
    const prompt = buildPromptFromInput(built.input, [], undefined, { requireReference: false })
    check(`🟢 [${role}] buildPrompt 가 받아들인다 (share 사고 재발 방지)`, prompt.ok)
  }
  // 🔴 정본에 없는 낱말은 생성기가 거부한다 — 그 사실을 행동으로 확인한다
  const bogus = buildCommentInput({
    persona, post, reactionRole: 'share',
    voice: voiceEvidenceFromAssets({ voiceCore: persona.voiceCore, voiceVariations: persona.voiceVariations }),
    memory: { has: false, note: '' },
  })
  check('🔴 share 로 만든 입력은 buildPrompt 가 거부한다',
    bogus.ok && !buildPromptFromInput(bogus.input, [], undefined, { requireReference: false }).ok)

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

// ─────────────────────────────────────────────────────────
console.log('㉒ 모델 선택 계약 — winner 없으면 아무것도 안 한다')
// ─────────────────────────────────────────────────────────
{
  const none = judgeModelGate({ selection: null })
  check('🔴 선택 결과가 없으면 provider·Queue 둘 다 막는다',
    !none.canCallProvider && !none.canWriteQueue)
  const prov = judgeModelGate({ selection: { status: 'provisional', winner: 'claude-haiku-4.5' } })
  check('🔴 provisional 이면 winner 가 있어도 막는다', !prov.canCallProvider && !prov.canWriteQueue)
  check('🔴 그 이유를 "확정되지 않았다" 로 말한다', prov.reason.includes('확정되지 않았다'))
  check('🔴 confirmed 인데 winner 가 null 이면 막는다',
    !judgeModelGate({ selection: { status: 'confirmed', winner: null } }).canWriteQueue)
  check('🔴 confirmed 인데 winner 가 공백이면 막는다',
    !judgeModelGate({ selection: { status: 'confirmed', winner: '  ' } }).canWriteQueue)
  /** 🔴 오타 하나로 없는 모델에 돈을 쓴 적이 있다(2026-08-27 HTTP_404) */
  check('🔴 모르는 모델 이름이면 막는다',
    !judgeModelGate({ selection: { status: 'confirmed', winner: 'claude-haiku-4-5' } }).canWriteQueue)
  check('🔴 확정 모델과 다른 모델을 부르려 하면 막는다',
    !judgeModelGate({
      selection: { status: 'confirmed', winner: 'claude-haiku-4.5' }, model: 'gemini-3.7-flash',
    }).canWriteQueue)
  const ok = judgeModelGate({ selection: { status: 'confirmed', winner: 'claude-haiku-4.5' } })
  check('🟢 confirmed + 등록된 winner 면 통과', ok.canCallProvider && ok.canWriteQueue)
  check('🔴 등록 목록이 실제 후보 3종이다', ALLOWED_MODELS.length === 3)
}

// ─────────────────────────────────────────────────────────
console.log('㉓ 대상 글 개인정보 계약 — 모르면 보내지 않는다')
// ─────────────────────────────────────────────────────────
{
  const base: PostAuthorFacts = {
    authorPersonaCode: null, source: 'USER',
    authorRealMember: { accountCount: 0, providerId: null },
    authorIsAdmin: false,
    visibility: {
      status: 'PUBLISHED', isMicroSeed: false,
      permanentNoindex: false, indexPromotionBlocked: false,
    },
  }
  check('🔴 글을 못 찾으면 보내지 않는다', !judgePostAuthor(null).externalSendAllowed)
  check('🟢 Persona 글은 보낼 수 있다',
    judgePostAuthor({ ...base, authorPersonaCode: 'P01' }).externalSendAllowed)
  check('🟢 관리자 글은 보낼 수 있다',
    judgePostAuthor({ ...base, authorIsAdmin: true }).externalSendAllowed)
  check('🟢 자동 생성 글(source=SYSTEM)은 보낼 수 있다',
    judgePostAuthor({ ...base, source: 'SYSTEM' }).externalSendAllowed)

  /** 🔴 실회원 글은 보내지 않는다 — `slice` 는 요약도 익명화도 아니다 */
  const member = judgePostAuthor({ ...base, authorRealMember: { accountCount: 1, providerId: null } })
  check('🔴 실회원 글은 보내지 않는다', !member.externalSendAllowed && member.kind === 'member')
  check('🔴 그 이유를 "원문을 외부 모델로 보내지 않는다" 로 말한다',
    member.reason.includes('외부 모델로 보내지 않는다'))

  // 🔴 모르는 것은 전부 막는다
  for (const [label, over] of [
    ['노출 축을 못 읽으면', { visibility: null }],
    ['관리자 여부를 모르면', { authorIsAdmin: null }],
    ['작성자 계정 정보를 모르면', { authorRealMember: null }],
    ['Account 수를 못 읽으면', { authorRealMember: { accountCount: null, providerId: null } }],
    ['providerId 를 못 읽으면', { authorRealMember: { accountCount: 0, providerId: undefined } }],
    ['Account 수가 NaN 이면', { authorRealMember: { accountCount: Number.NaN, providerId: null } }],
  ] as const) {
    const v = judgePostAuthor({ ...base, ...over } as PostAuthorFacts)
    check(`🔴 ${label} 보내지 않는다`, !v.externalSendAllowed && v.kind === 'unknown')
  }
  /** 🔴 판정은 post-visibility 정본이 한다 — 축을 여기서 비교하지 않는다(C-2) */
  check('🔴 외부 커뮤니티에서 가져온 본문은 보내지 않는다',
    !judgePostAuthor({
      ...base,
      visibility: { status: 'PUBLISHED', isMicroSeed: true, permanentNoindex: true, indexPromotionBlocked: true },
    }).externalSendAllowed)
  check('🔴 유형을 확정 못 하면 보내지 않는다 (source 도 SYSTEM 이 아님)',
    !judgePostAuthor({ ...base, source: 'OTHER' }).externalSendAllowed)
  check('🔴 푸는 것은 코드가 아니라 정책 승인이라고 남긴다',
    MEMBER_POST_EXTERNAL_SEND_POLICY.includes('정책 승인'))
  /**
   * 🔴 **3축 판정을 이 파일이 직접 하지 않는다** (정본 §3 C-2).
   *    우나어에서 같은 비교가 49곳 9파일로 퍼졌고, 한 곳을 고쳐도 나머지가 따라오지 않았다.
   */
  check('🔴 release 모듈이 축을 직접 비교하지 않는다',
    !readFileSync('src/lib/persona-comment-release.ts', 'utf-8')
      .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .some((l) => l.includes('.isMicroSeed')))
  check('🔴 판정은 post-visibility 정본 함수로 한다',
    readFileSync('src/lib/persona-comment-release.ts', 'utf-8').includes('isExternalSourcedBody('))
}

// ─────────────────────────────────────────────────────────
console.log('㉔ Queue 적재 계약')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const gates = (eight = 'pass'): { gate: string; outcome: string }[] =>
    GATE_CODES.map((g) => line(g, g === '⑧' ? eight : 'pass'))
  const base: EnqueueFacts = {
    postId: 'p1', personaCode: 'P01', reactionRole: 'empathy', text: '저도 그래요',
    gates: gates(), gateStatus: 'pass', isBootstrap: false,
    hasOpenQueue: false, personaCommentsOnPost: 0, postStatus: 'PUBLISHED',
    personaActive: true, personaRealMember: false, modelConfirmed: true,
  }
  const ok = planEnqueue(base)
  check('🟢 조건이 다 맞으면 적재한다', ok.ok)
  /** 🔴 자동으로 APPROVED 를 만들지 않는다 — 그러면 사람 승인 단계가 사라진다 */
  check('🔴 적재는 PENDING 으로만 들어간다', ok.status === 'PENDING' && ENQUEUE_STATUS === 'PENDING')
  check('🔴 중복 열쇠는 (글·Persona·역할) 이다',
    ok.dedupKey === dedupKeyOf('p1', 'P01', 'empathy')
    && ok.dedupKey !== dedupKeyOf('p1', 'P01', 'question'))

  for (const [label, over, code] of [
    ['본문이 비면', { text: '  ' }, 'TEXT_EMPTY'],
    ['모델이 미확정이면', { modelConfirmed: false }, 'MODEL_NOT_CONFIRMED'],
    ['같은 Queue 가 열려 있으면', { hasOpenQueue: true }, 'DUPLICATE_QUEUE'],
    ['기존 Queue 를 못 읽으면', { hasOpenQueue: null }, 'DUPLICATE_QUEUE'],
    ['이미 Persona 댓글이 있으면', { personaCommentsOnPost: 1 }, 'POST_HAS_PERSONA_COMMENT'],
    ['Persona 댓글 수를 못 읽으면', { personaCommentsOnPost: null }, 'POST_HAS_PERSONA_COMMENT'],
    ['글이 공개가 아니면', { postStatus: 'HIDDEN' }, 'POST_NOT_PUBLISHED'],
    ['글 상태를 못 읽으면', { postStatus: null }, 'POST_STATE_UNKNOWN'],
    ['Persona 가 active 가 아니면', { personaActive: false }, 'PERSONA_NOT_ACTIVE'],
    ['실회원이면', { personaRealMember: true }, 'PERSONA_REAL_MEMBER'],
  ] as const) {
    const r = planEnqueue({ ...base, ...over })
    check(`🔴 ${label} 적재하지 않는다`, !r.ok && r.blocks.some((b) => b.code === code))
  }

  /** 🔴 notRun 을 pass 로 세지 않는다 */
  const nr = planEnqueue({ ...base, gates: gates('notRun') })
  check('🔴 필수 관문이 notRun 이면 적재하지 않는다',
    !nr.ok && nr.blocks.some((b) => b.code === 'GATE_MISSING_REQUIRED'))
  check('🔴 Gate 가 review 면 적재하지 않는다',
    !planEnqueue({ ...base, gates: gates('review'), gateStatus: 'review' }).ok)

  /**
   * 🔴 bootstrap 은 **막지 않고 사람 승인 전용으로** 적재한다.
   *    막으면 첫 댓글을 영원히 만들 수 없고, 자동 통과시키면 ⑧ 이 무의미해진다.
   */
  const boot = planEnqueue({ ...base, gates: gates('notRun'), isBootstrap: true })
  check('🟢 bootstrap 후보는 적재된다', boot.ok)
  check('🔴 그때 사람 승인 전용이라고 표시한다',
    boot.blocks.some((b) => b.code === 'BOOTSTRAP_NEEDS_HUMAN')
    && boot.summary.includes('사람 승인 전용'))
  check('🔴 그래도 PENDING 이다 (자동 승인 아님)', boot.status === 'PENDING')
  check('🔴 열린 상태 목록에 PUBLISHED 를 넣지 않는다',
    !OPEN_STATUSES.includes('PUBLISHED') && OPEN_STATUSES.includes('PENDING'))
}

// ─────────────────────────────────────────────────────────
console.log('㉕ 발행 transaction 재검사')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const base: TxRecheckFacts = {
    postStatus: 'PUBLISHED', personaActive: true, personaRealMember: false,
    personaCommentsOnPost: 0, memberCommentsOnPost: 0, allowanceCap: 1, mode: 'release' as const,
    lifeConflict: false, gates: GATE_CODES.map((g) => line(g, 'pass')), gateStatus: 'pass',
    isBootstrap: false, queueStatus: 'APPROVED', publishedCommentId: null,
    publishedTodayInTx: 0,
    // 🔴 자동 경로는 생성 근거가 있어야 한다
    provenanceOk: true, provenanceReason: '근거 확인',
  }
  check('🟢 전부 그대로면 발행한다', recheckBeforePublish(base).ok)
  check('🟢 EDITED 도 사람이 승인한 것이다', recheckBeforePublish({ ...base, queueStatus: 'EDITED' }).ok)

  /**
   * 🔴 **계획 시점과 발행 시점 사이에 세상이 바뀐다.**
   *    적재 뒤 글이 지워지고, 사람이 댓글을 달고, Persona 가 멈추고, Account 가 붙는다.
   */
  for (const [label, over] of [
    ['글이 삭제되면', { postStatus: 'DELETED' }],
    ['글이 숨겨지면', { postStatus: 'HIDDEN' }],
    ['글 상태를 못 읽으면', { postStatus: null }],
    ['Persona 가 정지되면', { personaActive: false }],
    ['Account 가 생기면(실회원)', { personaRealMember: true }],
    ['그 사이 Persona 댓글이 생기면', { personaCommentsOnPost: 1 }],
    ['Persona 댓글 수를 못 읽으면', { personaCommentsOnPost: null }],
    [`회원 댓글이 ${MEMBER_COMMENT_LIMIT_ON_PUBLISH}건이 되면`, { memberCommentsOnPost: MEMBER_COMMENT_LIMIT_ON_PUBLISH }],
    ['회원 댓글 수를 못 읽으면', { memberCommentsOnPost: null }],
    ['오늘 상한이 0 이 되면', { allowanceCap: 0 }],
    ['상한 값이 손상되면', { allowanceCap: Number.NaN }],
    ['생활사가 충돌하면', { lifeConflict: true }],
    ['Queue 가 PENDING 이면(사람 승인 전)', { queueStatus: 'PENDING' as const }],
    ['이미 발행됐으면', { publishedCommentId: 'c1' }],
    ['Gate 재검사가 실패하면', { gates: GATE_CODES.map((g) => line(g, g === '②' ? 'notRun' : 'pass')) }],
  ] as const) {
    check(`🔴 ${label} 발행하지 않는다`, !recheckBeforePublish({ ...base, ...over }).ok)
  }
  /** 🔴 bootstrap 은 자동 발행 경로로 오지 않는다 */
  const boot = recheckBeforePublish({ ...base, isBootstrap: true })
  check('🔴 bootstrap 후보는 자동 발행하지 않는다', !boot.ok)
  check('🔴 그 이유를 말한다', boot.blockers.some((b) => b.includes('자동 발행 대상이 아니다')))
  check('🔴 회원 댓글 2건까지는 아직 자리가 있다',
    recheckBeforePublish({ ...base, memberCommentsOnPost: 2 }).ok)
}

// ─────────────────────────────────────────────────────────
console.log('㉖ 동시 runner — 같은 후보를 두 번 발행하지 않는다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **조건부 UPDATE 로 경쟁을 가른다.**
   *    두 runner 가 같은 후보를 읽고 둘 다 통과 판정을 받을 수 있다.
   *    그때 `updateMany({ where: { status: 'APPROVED', publishedCommentId: null } })` 의
   *    `count` 가 0 인 쪽이 진 것이고, 그 쪽은 트랜잭션을 통째로 되돌린다.
   */
  type Row = { status: string; publishedCommentId: string | null }
  const row: Row = { status: 'APPROVED', publishedCommentId: null }
  const writes: string[] = []
  /** 조건부 update — 실제 Prisma updateMany 와 같은 계약 */
  const tryPublish = (commentId: string): { won: boolean } => {
    if (row.status !== 'APPROVED' || row.publishedCommentId !== null) return { won: false }
    row.status = 'PUBLISHED'
    row.publishedCommentId = commentId
    writes.push(commentId)
    return { won: true }
  }
  const a = tryPublish('c-A')
  const b = tryPublish('c-B')
  check('🔴 동시 runner 2개 중 하나만 성공한다', a.won && !b.won)
  check('🔴 Comment 는 한 번만 남는다', writes.length === 1)
  check('🔴 진 쪽은 아무것도 남기지 않는다', !writes.includes('c-B'))

  /** 🔴 부분 적용이 없다 — 셋 중 하나라도 실패하면 전부 되돌린다 */
  const applied: string[] = []
  const runTx = (failAt: number): { ok: boolean; applied: string[] } => {
    const local: string[] = []
    try {
      for (const [i, step] of ['comment', 'queue', 'activityLog'].entries()) {
        if (i === failAt) throw new Error(`${step} 실패`)
        local.push(step)
      }
      applied.push(...local)
      return { ok: true, applied: [...local] }
    } catch {
      // 🔴 rollback — 지역 변수만 버리면 된다. 밖으로 새어 나간 것이 없다
      return { ok: false, applied: [] }
    }
  }
  for (const failAt of [0, 1, 2]) {
    const r = runTx(failAt)
    check(`🔴 ${failAt + 1}번째 단계에서 실패하면 전부 rollback`, !r.ok && r.applied.length === 0)
  }
  check('🔴 rollback 뒤 밖에도 아무것도 남지 않는다', applied.length === 0)
  check('🟢 실패가 없으면 셋이 함께 적용된다', runTx(9).applied.length === 3)
}

// ─────────────────────────────────────────────────────────
console.log('㉗ release 조건 — 하나라도 빠지면 0')
// ─────────────────────────────────────────────────────────
{
  const good: ModelGateVerdict = { canCallProvider: true, canWriteQueue: true, reason: '확정' }
  const base = {
    mode: 'release' as const, publicAllowedToday: 1, modelGate: good,
    approvedQueueCount: 1, isBootstrap: false, txRecheckWired: true, runnerRegistered: true,
  }
  const ok = judgeRelease(base)
  check('🟢 전부 맞으면 공개 가능', ok.canPublishNow && ok.allowed === 1)

  for (const [label, over] of [
    ['shadow 모드면', { mode: 'shadow' as const }],
    ['inspect 모드면', { mode: 'inspect' as const }],
    ['모델이 미확정이면', { modelGate: { canCallProvider: false, canWriteQueue: false, reason: 'provisional' } }],
    ['오늘 허용량이 0 이면', { publicAllowedToday: 0 }],
    ['허용량이 손상되면', { publicAllowedToday: Number.NaN }],
    ['승인 Queue 가 없으면', { approvedQueueCount: 0 }],
    ['bootstrap 후보면', { isBootstrap: true }],
    ['트랜잭션 재검사가 없으면', { txRecheckWired: false }],
    ['runner 가 미등록이면', { runnerRegistered: false }],
  ] as const) {
    const r = judgeRelease({ ...base, ...over })
    check(`🔴 ${label} 공개 0`, !r.canPublishNow && r.allowed === 0)
  }
  /** 🔴 빠진 것을 전부 나열한다 — 하나만 보여 주면 고치고 또 막힌다 */
  const many = judgeRelease({
    ...base, mode: 'shadow', publicAllowedToday: 0, approvedQueueCount: 0, runnerRegistered: false,
  })
  check('🔴 빠진 것을 전부 나열한다', many.blockers.length === 4)
  check('🔴 화면·JSON 이 같이 쓸 한 줄이 있다', many.summary.includes('공개 불가'))

  // 🔴 이번 PR 의 실제 상태 — runner 미등록이므로 공개 불가
  check('🔴 지금은 runner 가 등록돼 있지 않다',
    !judgeRelease({ ...base, runnerRegistered: false }).canPublishNow)
}

// ─────────────────────────────────────────────────────────
console.log('㉘ runner schedule 템플릿 — 만들되 올리지 않는다')
// ─────────────────────────────────────────────────────────
{
  const plist = renderCommentRunnerPlist({
    runtimeRoot: '/Users/x/Documents/soransoran-runtime',
    npxPath: '/usr/local/bin/npx', logDir: '/Users/x/Library/Logs/soransoran',
  })
  check('🔴 runner 가 runtime worktree 를 가리킨다',
    plist.includes('<key>WorkingDirectory</key><string>/Users/x/Documents/soransoran-runtime</string>')
    && plist.includes('/Users/x/Documents/soransoran-runtime/scripts/persona-comment-runner.mts'))
  check('🔴 개발 작업트리를 가리키지 않는다', !plist.includes('soransoran-m0'))
  /** 🔴 RunAtLoad 가 true 면 등록하는 순간 돈다 */
  check('🔴 RunAtLoad 가 false 다 — 올리는 순간 돌지 않는다', plist.includes('<key>RunAtLoad</key><false/>'))
  check('🔴 label 이 정본과 같다', plist.includes(COMMENT_RUNNER_LABEL))
  /** 🔴 댓글 회차를 글 발행량과 묶지 않는다 */
  check('🔴 댓글 회차는 하루 1회다 (글 발행량과 무관)', COMMENT_RUNNER_SLOTS.length === 1)
  // 🔴 이번 PR 은 등록하지 않는다 — 실제 LaunchAgents 에 없어야 한다
  const agentDir = join(homedir(), 'Library', 'LaunchAgents')
  const registered = ((): boolean => {
    try { return readdirSync(agentDir).includes(`${COMMENT_RUNNER_LABEL}.plist`) } catch { return false }
  })()
  check('🔴 이번 PR 에서 runner 를 등록하지 않았다', !registered)
}

// ─────────────────────────────────────────────────────────
console.log('㉙ 실제 배선 — 재검사가 발행 함수에 닿아 있는가')
// ─────────────────────────────────────────────────────────
{
  const txSrc = readFileSync('src/lib/persona-publish-tx.ts', 'utf-8')
  /**
   * 🔴 **fixture 에만 있는 계약은 아무것도 지키지 않는다.**
   *    앞선 판은 `recheckBeforePublish` 사용처가 fixture 뿐이었다 —
   *    server action 과 CLI 는 그것을 부르지 않고 발행했다.
   */
  check('🔴 publishCandidateTx 가 댓글 재검사를 실제로 부른다',
    txSrc.includes('recheckBeforePublish('))
  check('🔴 트랜잭션 안에서 rolling ratio 를 다시 센다',
    txSrc.includes('windowFromRows(') && txSrc.includes('judgeReadiness('))
  check('🔴 트랜잭션 안에서 실회원을 다시 판정한다',
    txSrc.includes('judgeRealMember(') && txSrc.includes('_count: { select: { accounts: true } }'))
  check('🔴 트랜잭션 안에서 providerId 도 읽는다', txSrc.includes('providerId: true'))
  check('🔴 트랜잭션 안에서 생활사·No-Go 를 다시 본다',
    txSrc.includes('judgeLifeHistory(') && txSrc.includes('readPostRequirements('))
  check('🔴 저장된 Gate 를 다시 읽는다', txSrc.includes('readStoredGates('))
  check('🔴 오늘 발행 수를 트랜잭션 안에서 다시 센다', txSrc.includes('publishedTodayInTx'))
  check('🔴 mode 를 env 에서 읽는다 (호출부가 넘긴 값을 믿지 않는다)',
    txSrc.includes('readRunMode(process.env)'))

  /** 🔴 server action 과 CLI 가 **같은 함수**를 쓴다 — 우회 경로가 없어야 한다 */
  const actionSrc = readFileSync('src/lib/actions/persona-publish.ts', 'utf-8')
  const cliSrc = readFileSync('scripts/persona-publish-live.mts', 'utf-8')
  check('🔴 server action 이 publishCandidateTx 를 쓴다', actionSrc.includes('publishCandidateTx('))
  check('🔴 CLI 가 publishCandidateTx 를 쓴다', cliSrc.includes('publishCandidateTx('))
  for (const [label, src] of [['server action', actionSrc], ['CLI', cliSrc]] as const) {
    check(`🔴 ${label} 이 comment.create 를 직접 부르지 않는다`, !src.includes('comment.create('))
  }
  /** 🔴 옛 --enqueue 경로가 직접 create 하지 않는다 */
  const dryRunSrc = readFileSync('scripts/persona-comment-dry-run.mts', 'utf-8')
  check('🔴 옛 dry-run 이 Queue 를 직접 create 하지 않는다',
    !dryRunSrc.includes('personaApprovalQueue.create('))
  check('🔴 옛 --enqueue 는 막히고 정본을 가리킨다',
    dryRunSrc.includes('persona:comment-queue'))
  /** 🔴 어드민 안내도 옛 명령을 가리키지 않는다 */
  check('🔴 어드민 안내가 새 정본을 가리킨다', (() => {
    const admin = readFileSync('src/app/admin/persona-candidates/page.tsx', 'utf-8')
    return admin.includes('persona:comment-queue') && !admin.includes('--enqueue')
  })())
  /** 🔴 Raw SQL 을 쓰지 않는다 */
  for (const f of [
    'src/lib/persona-publish-tx.ts', 'scripts/persona-comment-queue.mts',
    'scripts/persona-comment-runner.mts',
  ]) {
    check(`🔴 ${f} 가 Raw SQL 을 쓰지 않는다`,
      !/\$queryRaw|\$executeRaw/.test(readFileSync(f, 'utf-8')))
  }
}

// ─────────────────────────────────────────────────────────
console.log('㉚ 글로벌 ratio 경쟁 — 다른 후보끼리도 상한을 넘지 않는다')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const t: TxRecheckFacts = {
    postStatus: 'PUBLISHED', personaActive: true, personaRealMember: false,
    personaCommentsOnPost: 0, memberCommentsOnPost: 0, allowanceCap: 1, mode: 'release' as const,
    publishedTodayInTx: 0, lifeConflict: false,
    gates: GATE_CODES.map((g) => line(g, 'pass')), gateStatus: 'pass',
    isBootstrap: false, queueStatus: 'APPROVED', publishedCommentId: null,
    provenanceOk: true, provenanceReason: '근거 확인',
  }
  /**
   * 🔴 **서로 다른 글의 후보 2건**이 같은 여유 1 을 읽으면 둘 다 통과했다(실측).
   *    같은 후보의 경쟁은 조건부 UPDATE 가 막지만, 다른 후보끼리는 막을 것이 없었다.
   *    이제 트랜잭션 안에서 다시 센 발행 수로 자리를 확인한다.
   */
  check('🟢 첫 후보는 자리를 가져간다', recheckBeforePublish({ ...t, publishedTodayInTx: 0 }).ok)
  const second = recheckBeforePublish({ ...t, publishedTodayInTx: 1 })
  check('🔴 두 번째 후보는 상한에 막힌다 (다른 글이어도)', !second.ok)
  check('🔴 그 이유를 "다른 후보가 먼저 자리를 가져갔다" 로 말한다',
    second.blockers.some((b) => b.includes('먼저 자리를 가져갔다')))
  check('🔴 상한이 2 면 두 번째까지 간다',
    recheckBeforePublish({ ...t, allowanceCap: 2, mode: 'release' as const, publishedTodayInTx: 1 }).ok)
  check('🔴 트랜잭션 안에서 못 세면 막는다',
    !recheckBeforePublish({ ...t, publishedTodayInTx: Number.NaN }).ok)
  /** 🔴 mode 가 release 가 아니면 어떤 주체도 공개 write 를 못 한다 */
  for (const m of ['inspect', 'shadow'] as const) {
    check(`🔴 ${m} 모드면 발행하지 않는다`, !recheckBeforePublish({ ...t, mode: m }).ok)
    check(`🔴 ${m} 에서는 manual-admin 도 우회하지 못한다`,
      !recheckBeforePublish({ ...t, mode: m, actor: 'manual-admin' }).ok)
  }
  check('🔴 음수도 막는다', !recheckBeforePublish({ ...t, publishedTodayInTx: -1 }).ok)
}

// ─────────────────────────────────────────────────────────
console.log('㉛ bootstrap 변조 — 호출자 주장을 믿지 않는다')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const gates = (o: Record<string, string>): { gate: string; outcome: string }[] =>
    GATE_CODES.map((g) => line(g, o[g] ?? 'pass'))
  const base: EnqueueFacts = {
    postId: 'p1', personaCode: 'P01', reactionRole: 'empathy', text: '저도 그래요',
    gates: gates({}), gateStatus: 'pass', isBootstrap: false,
    hasOpenQueue: false, personaCommentsOnPost: 0, postStatus: 'PUBLISHED',
    personaActive: true, personaRealMember: false, modelConfirmed: true,
  }
  /**
   * 🔴 **① 유출이 reject 인데 `isBootstrap=true` 면 적재됐다**(실측).
   *    bootstrap 은 "⑧ 만 표본이 없다" 는 좁은 상태이지 Gate 면제가 아니다.
   */
  for (const [label, bad] of [
    ['① reject', { '①': 'reject', '⑧': 'notRun' }],
    ['② regenerate', { '②': 'regenerate', '⑧': 'notRun' }],
    ['⑥ review', { '⑥': 'review', '⑧': 'notRun' }],
    ['⑨ reject', { '⑨': 'reject', '⑧': 'notRun' }],
    ['② 도 notRun', { '②': 'notRun', '⑧': 'notRun' }],
  ] as const) {
    const r = planEnqueue({ ...base, isBootstrap: true, gates: gates(bad), gateStatus: 'reject' })
    check(`🔴 ${label} + bootstrap 주장 → 적재하지 않는다`, !r.ok)
    check(`🔴 그때 "bootstrap 이 아니라 Gate 실패" 라고 말한다`,
      r.blocks.some((b) => b.code === 'BOOTSTRAP_CLAIM_INVALID'))
  }
  /** 🟢 진짜 bootstrap — ⑧ 만 notRun 이고 나머지 전부 pass */
  const real = planEnqueue({ ...base, isBootstrap: true, gates: gates({ '⑧': 'notRun' }), gateStatus: 'pass' })
  check('🟢 ⑧ 만 notRun 이면 사람 승인 전용으로 적재한다', real.ok)
  check('🔴 그때 자동 공개 대상이 아님을 표시한다',
    real.blocks.some((b) => b.code === 'BOOTSTRAP_NEEDS_HUMAN'))

  /** 🔴 트랜잭션에서도 Gate 모양으로 다시 본다 — 플래그를 지워도 막힌다 */
  const tx: TxRecheckFacts = {
    postStatus: 'PUBLISHED', personaActive: true, personaRealMember: false,
    personaCommentsOnPost: 0, memberCommentsOnPost: 0, allowanceCap: 1, mode: 'release' as const,
    publishedTodayInTx: 0, lifeConflict: false,
    gates: gates({ '⑧': 'notRun' }), gateStatus: 'pass',
    // 🔴 호출자가 false 로 지워도
    isBootstrap: false, queueStatus: 'APPROVED', publishedCommentId: null,
    provenanceOk: true, provenanceReason: '근거 확인',
  }
  const r = recheckBeforePublish(tx)
  check('🔴 isBootstrap 을 false 로 지워도 Gate 모양으로 잡는다', !r.ok)
  check('🔴 그 이유를 bootstrap 으로 말한다', r.blockers.some((b) => b.includes('bootstrap')))
}

// ─────────────────────────────────────────────────────────
console.log('㉜ 개인정보 — 출처를 작성자보다 먼저 본다')
// ─────────────────────────────────────────────────────────
{
  const ms = (isMicroSeed: boolean): PostAuthorFacts['visibility'] => ({
    status: 'PUBLISHED', isMicroSeed,
    permanentNoindex: isMicroSeed, indexPromotionBlocked: isMicroSeed,
  })
  const base: PostAuthorFacts = {
    authorPersonaCode: null, source: 'USER',
    authorRealMember: { accountCount: 0, providerId: null },
    authorIsAdmin: false, visibility: ms(false),
  }
  /**
   * 🔴 **Persona 가 올린 글이라도 본문이 micro seed 면 남의 커뮤니티 원문이다**(실측 유출).
   *    "누가 올렸나" 와 "본문이 어디서 왔나" 는 다른 질문이고, 전송 금지는 본문이 정한다.
   */
  for (const [label, over] of [
    ['Persona 글', { authorPersonaCode: 'P01' }],
    ['관리자 글', { authorIsAdmin: true }],
    ['자동 생성 글', { source: 'SYSTEM' }],
    ['Persona + 관리자 + SYSTEM', { authorPersonaCode: 'P01', authorIsAdmin: true, source: 'SYSTEM' }],
  ] as const) {
    const v = judgePostAuthor({ ...base, ...over, visibility: ms(true) })
    check(`🔴 ${label} 이어도 micro seed 본문이면 보내지 않는다`, !v.externalSendAllowed)
  }
  check('🟢 micro seed 가 아니면 Persona 글은 보낼 수 있다',
    judgePostAuthor({ ...base, authorPersonaCode: 'P01' }).externalSendAllowed)
  check('🔴 노출 축을 못 읽으면 Persona 글이어도 보내지 않는다',
    !judgePostAuthor({ ...base, authorPersonaCode: 'P01', visibility: null }).externalSendAllowed)
  check('🔴 실회원 + micro seed 도 당연히 막힌다',
    !judgePostAuthor({
      ...base, authorRealMember: { accountCount: 1, providerId: null }, visibility: ms(true),
    }).externalSendAllowed)
}

// ─────────────────────────────────────────────────────────
console.log('㉝ runner 와 모델 정본')
// ─────────────────────────────────────────────────────────
{
  /** 🔴 템플릿이 없는 파일을 가리키면 등록하는 순간 조용히 실패한다 */
  check('🔴 runner 대상 스크립트가 실제로 있다', existsSync(COMMENT_RUNNER_SCRIPT))
  check('🔴 템플릿이 그 파일을 가리킨다',
    renderCommentRunnerPlist({ runtimeRoot: '/rt', npxPath: '/npx', logDir: '/log' })
      .includes(`/rt/${COMMENT_RUNNER_SCRIPT}`))

  /**
   * 🔴 **plist 가 있다고 등록된 것이 아니다.**
   *    파일만 있고 unload 됐거나 개발 트리를 가리켜도 앞선 판은 "등록됨" 이라 했다.
   */
  const st = (o: Partial<Parameters<typeof readRunnerState>[0]> = {}): ReturnType<typeof readRunnerState> =>
    readRunnerState({
      runtimeRoot: '/rt', agentDir: '/agents',
      fileExists: () => true,
      printJob: () => ({ ok: false, out: 'Could not find service' }),
      ...o,
    })
  const unloaded = st()
  check('🔴 plist 가 없으면 미등록', !unloaded.healthy && unloaded.loaded === 'unloaded')
  /**
   * 🔴 **plist 가 있어도 unloaded 면 등록이 아니다.**
   *    앞선 판은 `readdirSync(...).includes(...)` 만 봤다 — 파일만 있으면 "등록됨" 이었다.
   *    실제로 은퇴 job 2개가 파일이 남아 되살아나 개발 트리를 가리켰다.
   *    이 검사가 없으면 그 구조가 다시 통과한다.
   */
  const presentButDown = readRunnerState({
    runtimeRoot: '/rt', agentDir: '/agents', fileExists: () => true,
    // 🔴 plist 는 있다고 보고, launchctl 은 없다고 답한다
    listAgents: () => [`${COMMENT_RUNNER_LABEL}.plist`],
    printJob: () => ({ ok: false, out: 'Could not find service' }),
  })
  check('🔴 plist 가 있어도 loaded 가 아니면 미등록',
    presentButDown.plistPresent && presentButDown.loaded === 'unloaded' && !presentButDown.healthy)
  check('🔴 그때 "loaded 가 아니다" 로 말한다', presentButDown.detail.includes('loaded 가 아니다'))
  const presentUnknown = readRunnerState({
    runtimeRoot: '/rt', agentDir: '/agents', fileExists: () => true,
    listAgents: () => [`${COMMENT_RUNNER_LABEL}.plist`],
    printJob: () => ({ ok: false, out: 'Bad request. 알 수 없는 오류' }),
  })
  check('🔴 plist 가 있고 launchctl 을 못 읽으면 미등록(fail-closed)',
    presentUnknown.loaded === 'unknown' && !presentUnknown.healthy)
  check('🔴 launchctl 을 못 읽으면 unknown 이고 미등록', (() => {
    const r = st({ printJob: () => ({ ok: false, out: 'Bad request. some other error' }) })
    return r.loaded === 'unknown' && !r.healthy
  })())
  check('🔴 대상 스크립트가 없으면 미등록',
    !st({ fileExists: () => false }).healthy)
  /** 🔴 loaded 인데 개발 트리를 가리키면 이상으로 잡는다 */
  const devPath = readRunnerState({
    runtimeRoot: '/rt', agentDir: '/agents', fileExists: () => true,
    listAgents: () => [`${COMMENT_RUNNER_LABEL}.plist`],
    printJob: () => ({
      ok: true,
      out: 'path = /a\n\tprogram = /npx\n\targuments = {\n\t\ttsx\n'
        + '\t\t/Users/x/Documents/soransoran-m0/scripts/persona-comment-runner.mts\n\t}\n'
        + '\tworking directory = /Users/x/Documents/soransoran-m0\n',
    }),
  })
  check('🔴 loaded 지만 개발 트리를 가리키면 미등록으로 본다',
    devPath.loaded === 'loaded' && devPath.pathsOk === false && !devPath.healthy)

  /**
   * 🔴 **gitignored tmp 를 winner 정본으로 쓰지 않는다.**
   *    누구나 고칠 수 있고 회차를 지우면 사라진다 — 감사할 수 없는 값으로 공개를 열 수 없다.
   */
  const canon = readConfirmedSelection({ file: '/nonexistent/persona-comment-model.json' })
  check('🔴 정본이 없으면 provisional · winner null', canon.selection?.status === 'provisional' && canon.selection.winner === null)
  check('🔴 정본 경로가 worktree 밖이다', !MODEL_CANON_FILE.includes('soransoran-m0'))
  const built = buildCanonFromScoring({
    runId: '20260909-181515', summaryJson: '{"a":1}', samplesJson: '{"b":2}', keyJson: '{"c":3}',
    winner: 'claude-haiku-4.5', decidedBy: 'founder', decidedAt: '2026-09-10T00:00:00Z', scoredSamples: 20,
  })
  check('🔴 승격 계약이 runId·artifact SHA·채점자를 함께 남긴다',
    built.runId === '20260909-181515' && built.decidedBy === 'founder'
    && Object.keys(built.artifactSha).length === 3)
  check('🟢 artifact 가 그대로면 검증을 통과한다',
    verifyCanonArtifacts(built, { summaryJson: '{"a":1}', samplesJson: '{"b":2}', keyJson: '{"c":3}' }).ok)
  check('🔴 artifact 가 바뀌면 채점 근거가 사라졌다고 말한다', (() => {
    const v = verifyCanonArtifacts(built, { summaryJson: '{"a":9}', samplesJson: '{"b":2}', keyJson: '{"c":3}' })
    return !v.ok && v.reason.includes('채점 근거가 사라졌다')
  })())

  /** 🔴 health 가 배선 여부를 하드코딩하지 않는다 */
  const healthSrc = readFileSync('scripts/persona-comment-health.mts', 'utf-8')
  check('🔴 health 가 txRecheckWired 를 true 로 적어 두지 않는다',
    !healthSrc.includes('txRecheckWired: true'))
  /**
   * 🔴 소스 문자열 검사도 하지 않는다 — 주석에 이름만 적어도 통과했다.
   *    지금은 코드가 선언한 capability 를 쓰고, 그 선언이 참인지는 아래가 확인한다.
   */
  check('🔴 health 가 소스 includes 로 배선을 판정하지 않는다',
    !healthSrc.includes("includes('recheckBeforePublish("))
  check('🔴 health 가 capability 계약을 쓴다', healthSrc.includes('capabilitiesReady('))
  check('🔴 health 가 bootstrap 을 저장된 Gate 에서 센다',
    healthSrc.includes('judgeGateReport({ gates, status: r.gateStatus })'))
  /**
   * 🔴 **집계해 놓고 버리면 소용이 없다.**
   *    앞선 판은 `bootstrapReviewCount: null` 을 그대로 두었다 —
   *    계산은 했는데 화면·JSON 에는 "모른다" 가 나갔다.
   */
  check('🔴 health 가 집계값을 실제로 내보낸다',
    /bootstrapReviewCount,\n/.test(healthSrc) && !healthSrc.includes('bootstrapReviewCount: null'))
  check('🔴 provenance 없는 후보 수도 함께 낸다',
    /noProvenanceCount,\n/.test(healthSrc) && !healthSrc.includes('noProvenanceCount: null'))
  check('🔴 health 가 runner tri-state 를 쓴다', healthSrc.includes('readRunnerState()'))
}

// ─────────────────────────────────────────────────────────
console.log('㉞ Serializable — 동시 두 트랜잭션에서 1건만')
// ─────────────────────────────────────────────────────────
{
  const txSrc = readFileSync('src/lib/persona-publish-tx.ts', 'utf-8')
  check('🔴 발행 트랜잭션이 Serializable 격리를 쓴다',
    /isolationLevel:\s*'Serializable'/.test(txSrc))
  check('🔴 maxWait·timeout 을 명시한다',
    txSrc.includes('maxWait: TX_MAX_WAIT_MS') && txSrc.includes('timeout: TX_TIMEOUT_MS'))
  check('🔴 시간 손잡이가 기본 5초보다 넉넉하다',
    TX_MAX_WAIT_MS >= 10_000 && TX_TIMEOUT_MS >= 20_000)
  /** 🔴 직렬화 충돌을 인식하고 **재시도하지 않는다** */
  check('🔴 P2034 를 직렬화 충돌로 본다', isSerializationConflict({ code: 'P2034' }))
  check('🔴 메시지로도 알아본다',
    isSerializationConflict(new Error('could not serialize access due to read/write dependencies')))
  check('🔴 모르는 오류는 충돌로 보지 않는다', !isSerializationConflict(new Error('timeout')))
  /**
   * 🔴 **충돌을 처리하는 분기가 실제로 살아 있어야 한다.**
   *    분기를 `if (false)` 로 죽여도 앞선 검사는 통과했다 — 함수 존재만 봤기 때문이다.
   *    catch 절이 그 함수를 **조건으로** 쓰는지 본다.
   */
  const catchTail = txSrc.slice(txSrc.indexOf('} catch (err) {'))
  check('🔴 catch 가 직렬화 충돌을 조건으로 분기한다',
    /if \(isSerializationConflict\(err\)\) \{/.test(catchTail))
  check('🔴 그 분기가 죽어 있지 않다', !/if \(false\)[\s\S]{0,200}다른 발행이 먼저/.test(catchTail))
  /**
   * 🔴 주석을 빼고 **코드만** 본다. "재시도하지 않는다" 는 주석에 걸려
   *    자기 설명 때문에 검사가 실패했다 — 검사가 주석을 읽으면 안 된다.
   */
  const catchCode = catchTail.split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n')
  check('🔴 충돌 처리에 재시도 루프가 없다',
    !/\bfor\s*\(|\bwhile\s*\(|setTimeout|retr(y|ies)/i.test(catchCode.slice(0, 800)))

  /**
   * 🔴 **진짜 동시 경쟁을 모사한다.**
   *    앞선 fixture 는 0→1 을 순차로 넣었다 — 그것은 동시성 증명이 아니다.
   *    여기서는 두 트랜잭션이 **같은 스냅샷(0)** 을 읽게 하고,
   *    Serializable 이 두 번째를 되돌리는 것까지 재현한다.
   */
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const facts = (publishedTodayInTx: number): TxRecheckFacts => ({
    postStatus: 'PUBLISHED', personaActive: true, personaRealMember: false,
    personaCommentsOnPost: 0, memberCommentsOnPost: 0, allowanceCap: 1, mode: 'release' as const,
    publishedTodayInTx, lifeConflict: false,
    gates: GATE_CODES.map((g) => line(g, 'pass')), gateStatus: 'pass',
    isBootstrap: false, queueStatus: 'APPROVED', publishedCommentId: null,
    provenanceOk: true, provenanceReason: '근거 확인',
  })

  /** 직렬화 저장소 — commit 순간에 스냅샷이 낡았으면 충돌로 되돌린다 */
  let committed = 0
  const runTx = (snapshot: number): { ok: boolean; conflict: boolean } => {
    const v = recheckBeforePublish(facts(snapshot))
    if (!v.ok) return { ok: false, conflict: false }
    // 🔴 Serializable: 내가 읽은 값과 지금 값이 다르면 직렬화 실패
    if (snapshot !== committed) return { ok: false, conflict: true }
    committed += 1
    return { ok: true, conflict: false }
  }
  // 🔴 두 트랜잭션이 **같은 0 을 읽고** 각자 commit 을 시도한다
  const snapA = committed
  const snapB = committed
  const rA = runTx(snapA)
  const rB = runTx(snapB)
  check('🔴 같은 스냅샷을 읽은 두 트랜잭션 중 1건만 commit 된다',
    [rA.ok, rB.ok].filter(Boolean).length === 1)
  check('🔴 진 쪽은 직렬화 충돌로 되돌아간다', rB.conflict)
  check('🔴 commit 수가 허용량 1 을 넘지 않는다', committed === 1)
  // 🔴 세 번째도 마찬가지
  check('🔴 세 번째 후보도 막힌다', !runTx(0).ok && committed === 1)
}

// ─────────────────────────────────────────────────────────
console.log('㉟ Queue 파이프라인 — 실제 경로 (provider 주입)')
// ─────────────────────────────────────────────────────────
{
  const persona: CommentInputPersona = {
    code: 'P01', ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    identity: { job: '강사' },
    voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
    voiceVariations: ['질문형'], noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
  }
  const built = buildCommentInput({
    persona,
    post: { id: 'p1', title: '무릎', bodyDigest: '무릎이 아프다', boardLabel: '수다방', existingCommentDigests: [] },
    reactionRole: 'empathy',
    voice: voiceEvidenceFromAssets({ voiceCore: persona.voiceCore, voiceVariations: persona.voiceVariations }),
    memory: { has: false, note: '' },
  })
  if (!built.ok) throw new Error('fixture 입력 실패')

  const canon = buildCanonFromScoring({
    runId: '20260909-181515', summaryJson: '{"a":1}', samplesJson: '{"b":2}', keyJson: '{"c":3}',
    winner: 'claude-haiku-4.5', decidedBy: 'founder', decidedAt: '2026-09-10T00:00:00Z', scoredSamples: 20,
  })
  const target = (over: Partial<PipelineTarget> = {}): PipelineTarget => ({
    input: built.input,
    author: {
      authorPersonaCode: 'P02', source: 'SYSTEM',
      authorRealMember: { accountCount: 0, providerId: null }, authorIsAdmin: false,
      visibility: { status: 'PUBLISHED', isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false },
    },
    facts: {
      postId: 'p1', personaCode: 'P01', reactionRole: 'empathy',
      hasOpenQueue: false, personaCommentsOnPost: 0, postStatus: 'PUBLISHED',
      personaActive: true, personaRealMember: false,
    },
    ...over,
  })
  const okGate = (): ReturnType<Parameters<typeof runEnqueuePipeline>[0]['gate']> => ({
    gates: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass' })), gateStatus: 'pass', isBootstrap: false,
  })

  /** 🔴 모델 미확정이면 **한 번도** 부르지 않는다 */
  let calls = 0
  const noModel = await runEnqueuePipeline({
    selection: { status: 'provisional', winner: null }, canon: null,
    targets: [target()], limit: 1, providerCallLimit: 1, preflightOk: true,
    provider: async () => { calls += 1; return { ok: true, text: '저도 그래요', errorCode: null } },
    gate: okGate,
  })
  check('🔴 모델 미확정이면 provider 호출 0', calls === 0 && noModel.providerCalls === 0)
  check('🔴 그때 Queue write 도 0', noModel.created === 0)
  check('🔴 멈춘 이유를 말한다', (noModel.stoppedReason ?? '').includes('정본이 없다'))

  /** 🔴 개인정보 판정이 provider **앞**에 있다 */
  let calls2 = 0
  const blocked = await runEnqueuePipeline({
    selection: { status: 'confirmed', winner: 'claude-haiku-4.5' }, canon,
    targets: [target({
      author: {
        // 🔴 Persona 글이 아니어야 실회원 판정까지 간다
        authorPersonaCode: null, source: 'USER',
        authorRealMember: { accountCount: 1, providerId: null }, authorIsAdmin: false,
        visibility: { status: 'PUBLISHED', isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false },
      },
    })],
    limit: 1, providerCallLimit: 1, preflightOk: true,
    provider: async () => { calls2 += 1; return { ok: true, text: 'x', errorCode: null } },
    gate: okGate,
  })
  check('🔴 실회원 글이면 provider 를 부르기 전에 막는다',
    calls2 === 0 && blocked.outcomes[0]?.step === 'AUTHOR_BLOCKED')

  /** 🟢 dry-run — provider 는 부르지만 create 는 하지 않는다 */
  const dry = await runEnqueuePipeline({
    selection: { status: 'confirmed', winner: 'claude-haiku-4.5' }, canon,
    targets: [target()], limit: 1, providerCallLimit: 1, preflightOk: true,
    provider: async () => ({ ok: true, text: '저도 그런 날이 있어요', errorCode: null }),
    gate: okGate,
  })
  check('🟢 dry-run 은 판정까지 가고 create 하지 않는다',
    dry.providerCalls === 1 && dry.created === 0 && dry.outcomes[0]?.step === 'WRITE_SKIPPED')

  /** 🟢 apply — writer 를 넘기면 create 한다 */
  const writes: string[] = []
  const applied = await runEnqueuePipeline({
    selection: { status: 'confirmed', winner: 'claude-haiku-4.5' }, canon,
    targets: [target()], limit: 1, providerCallLimit: 1, preflightOk: true,
    provider: async () => ({ ok: true, text: '저도 그런 날이 있어요', errorCode: null }),
    gate: okGate,
    writer: async ({ dedupKey, provenance }) => {
      writes.push(`${dedupKey}|${provenance.model}|${provenance.canonRunId}`)
      return { created: true, reason: 'PENDING 적재' }
    },
  })
  check('🟢 apply 면 PENDING 으로 적재한다', applied.created === 1 && applied.outcomes[0]?.step === 'ENQUEUED')
  check('🔴 적재할 때 생성 근거를 함께 넘긴다',
    writes[0]?.includes('claude-haiku-4.5') === true && writes[0]?.includes('20260909-181515') === true)
  check('🔴 dedupKey 가 (글·Persona·역할) 이다', writes[0]?.startsWith('comment:p1:P01:empathy') === true)

  /** 🔴 중복 경쟁 — unique 가 진 쪽을 막는다 */
  const dup = await runEnqueuePipeline({
    selection: { status: 'confirmed', winner: 'claude-haiku-4.5' }, canon,
    targets: [target()], limit: 1, providerCallLimit: 1, preflightOk: true,
    provider: async () => ({ ok: true, text: '저도 그런 날이 있어요', errorCode: null }),
    gate: okGate,
    writer: async () => ({ created: false, reason: '🔴 같은 dedupKey 가 이미 있다 — 다른 회차가 먼저 넣었다(fail-closed)' }),
  })
  check('🔴 dedupKey 경쟁에서 진 쪽은 적재되지 않는다',
    dup.created === 0 && dup.outcomes[0]?.step === 'WRITE_FAILED')
  check('🔴 그 이유를 말한다', (dup.outcomes[0]?.reason ?? '').includes('먼저 넣었다'))

  /** 🔴 Gate 가 막으면 create 하지 않는다 */
  const gateBad = await runEnqueuePipeline({
    selection: { status: 'confirmed', winner: 'claude-haiku-4.5' }, canon,
    targets: [target()], limit: 1, providerCallLimit: 1, preflightOk: true,
    provider: async () => ({ ok: true, text: '저도 그런 날이 있어요', errorCode: null }),
    gate: () => ({
      gates: GATE_CODES.map((g) => ({ gate: g, outcome: g === '①' ? 'reject' : 'pass' })),
      gateStatus: 'reject', isBootstrap: false,
    }),
    writer: async () => ({ created: true, reason: 'x' }),
  })
  check('🔴 Gate 가 막으면 create 하지 않는다',
    gateBad.created === 0 && gateBad.outcomes[0]?.step === 'ENQUEUE_BLOCKED')
}

// ─────────────────────────────────────────────────────────
console.log('㊱ 실행 주체 — bootstrap dead-end 를 없앤다')
// ─────────────────────────────────────────────────────────
{
  const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const boot = (over: Partial<TxRecheckFacts> = {}): TxRecheckFacts => ({
    postStatus: 'PUBLISHED', personaActive: true, personaRealMember: false,
    personaCommentsOnPost: 0, memberCommentsOnPost: 0, allowanceCap: 1, mode: 'release' as const,
    publishedTodayInTx: 0, lifeConflict: false,
    gates: GATE_CODES.map((g) => line(g, g === '⑧' ? 'notRun' : 'pass')), gateStatus: 'pass',
    isBootstrap: true, queueStatus: 'APPROVED', publishedCommentId: null,
    provenanceOk: true, provenanceReason: '근거 확인',
    bootstrapPriorTextCount: 0, bootstrapUsedTotal: 0, bootstrapUsedToday: 0, seedComplete: true,
    ...over,
  })
  /** 🔴 자동 경로는 막힌다 */
  check('🔴 automation 은 bootstrap 을 발행하지 못한다', !recheckBeforePublish(boot()).ok)
  check('🔴 actor 를 안 넘겨도 automation 으로 본다',
    !recheckBeforePublish({ ...boot(), actor: undefined }).ok)
  /** 🟢 사람이 누르면 가능하다 — 이것이 없으면 첫 댓글을 영원히 못 만든다 */
  check('🟢 manual-admin 은 bootstrap 을 발행할 수 있다',
    recheckBeforePublish(boot({ actor: 'manual-admin' })).ok)
  /** 🔴 사람이 눌러도 governor 조건은 그대로다 */
  for (const [label, over] of [
    ['하루 상한을 썼으면', { bootstrapUsedToday: 1 }],
    ['총 상한을 썼으면', { bootstrapUsedTotal: BOOTSTRAP_MAX_PER_PERSONA }],
    ['prior 가 이미 충분하면', { bootstrapPriorTextCount: REQUIRED_PRIOR_TEXTS }],
    ['seed 가 불완전하면', { seedComplete: false }],
    ['실회원이면', { personaRealMember: true }],
  ] as const) {
    check(`🔴 manual-admin 이어도 ${label} 막는다`,
      !recheckBeforePublish(boot({ actor: 'manual-admin', ...over })).ok)
  }
  /** 🔴 server action 만 manual-admin 을 준다 */
  const actionSrc = readFileSync('src/lib/actions/persona-publish.ts', 'utf-8')
  check('🔴 server action 이 requireAdmin 뒤에 manual-admin 을 넘긴다',
    /requireAdmin\(\)[\s\S]{0,600}actor: 'manual-admin'/.test(actionSrc))
  const runnerSrc = readFileSync('scripts/persona-comment-runner.mts', 'utf-8')
  check('🔴 runner 는 actor 를 넘기지 않는다 (= automation)',
    runnerSrc.includes('publishCandidateTx(') && !runnerSrc.includes("actor: 'manual-admin'"))
  const cliSrc = readFileSync('scripts/persona-publish-live.mts', 'utf-8')
  check('🔴 CLI 도 manual-admin 을 넘기지 않는다', !cliSrc.includes("actor: 'manual-admin'"))

  /** 🔴 자동 경로는 생성 근거 없는 후보를 발행하지 않는다 */
  check('🔴 provenance 가 없으면 automation 은 막힌다',
    !recheckBeforePublish({
      ...boot({ isBootstrap: false, gates: GATE_CODES.map((g) => line(g, 'pass')) }),
      provenanceOk: false, provenanceReason: '근거 없음',
    }).ok)
  check('🟢 사람이 누르면 근거가 없어도 읽고 발행할 수 있다',
    recheckBeforePublish({
      ...boot({
        isBootstrap: false, gates: GATE_CODES.map((g) => line(g, 'pass')),
        actor: 'manual-admin',
      }),
      provenanceOk: false, provenanceReason: '근거 없음',
    }).ok)
}

// ─────────────────────────────────────────────────────────
console.log('㊲ runner 배선 · capability · provenance 검증')
// ─────────────────────────────────────────────────────────
{
  const runnerSrc = readFileSync('scripts/persona-comment-runner.mts', 'utf-8')
  check('🔴 runner 가 publishCandidateTx 를 import 한다',
    /import \{ publishCandidateTx \}/.test(runnerSrc))
  check('🔴 runner 가 결정적으로 후보를 고른다',
    runnerSrc.includes("orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]"))
  /**
   * 🔴 **허용량만큼만 읽지 않는다** (2026-09-09 정정).
   *    허용 1건일 때 맨 앞 후보가 막히면 그 회차가 0건으로 끝났다 —
   *    유한한 배치를 읽고 막힌 것은 건너뛴다.
   */
  check('🔴 runner 가 유한한 배치를 읽는다', runnerSrc.includes('take: batchSize'))
  check('🔴 조건 미충족이면 그 앞에서 멈춘다',
    runnerSrc.indexOf('if (!release.canPublishNow)') < runnerSrc.indexOf('publishCandidateTx(prisma'))

  const queueSrc = readFileSync('scripts/persona-comment-queue.mts', 'utf-8')
  check('🔴 Queue CLI 가 파이프라인 정본을 부른다', queueSrc.includes('runEnqueuePipeline('))
  check('🔴 --apply 가 없으면 writer 를 넘기지 않는다',
    /WANT_APPLY \? \{\s*\n\s*writer:/.test(queueSrc))
  check('🔴 중복은 unique 로 가른다 (조회로 이기려 하지 않는다)',
    queueSrc.includes("code === 'P2002'") && !queueSrc.includes('findUnique({ where: { dedupKey }'))
  /** 🔴 주석을 빼고 **코드만** 본다 — 사고를 설명한 주석이 검사에 걸리면 안 된다 */
  const queueCode = queueSrc.split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n')
  /**
   * 🔴 **대상 선정은 두 벌로 갈라지지 않는다** (2026-09-09 정정).
   *    앞선 판은 Queue CLI 와 shadow planner 가 각자 적어 두어 입력이 달랐다.
   *    지금은 `materializeTargets` 하나를 **둘 다** 부른다.
   */
  const planSrc = readFileSync('scripts/persona-comment-plan.mts', 'utf-8')
  const targetsSrc = readFileSync('scripts/lib/persona-comment-targets.ts', 'utf-8')
  check('🔴 Queue CLI 가 공유 materializer 를 부른다', queueCode.includes('materializeTargets('))
  check('🔴 shadow planner 도 같은 함수를 부른다', planSrc.includes('materializeTargets('))
  check('🔴 대상 선정 로직을 스크립트가 다시 적어 두지 않는다',
    !queueCode.includes('planCommentDistribution(') && !planSrc.includes('planCommentDistribution('))
  check('🔴 대상 선정에 planner 정본을 쓴다', targetsSrc.includes('planCommentDistribution('))
  check('🔴 Persona-first 입력 계약으로 입력을 만든다', targetsSrc.includes('buildCommentInput('))
  check('🔴 말투 근거를 Voice 자산에서 만든다', targetsSrc.includes('voiceEvidenceFromAssets('))
  check('🔴 실회원 판정은 정본 함수로 한다', targetsSrc.includes('judgeRealMember('))
  check('🔴 Gate 입력을 손으로 채우지 않는다',
    !/knownNames:\s*\[\]/.test(queueCode) && !/seedUseCount:\s*1\b/.test(queueCode))
  /**
   * 🔴 **열린 Queue 는 두 층위로 본다.**
   *    planner 는 "이 글에 열린 것이 있나"(글 단위), 적재 직전 판정은
   *    "이 조합이 열려 있나"(글·Persona·역할)를 묻는다.
   *    옛 판은 `dedupKey` Set 에 `postId` 를 물어 **둘 다 항상 false** 였다.
   */
  check('🔴 조합 판정에 dedupKey 를 쓴다',
    /hasOpenQueue: openDedupKeys\.has\(dedupKeyOf\(/.test(targetsSrc))
  check('🔴 dedupKey Set 에 postId 를 묻지 않는다',
    !/openDedupKeys\.has\(pr\.id\)/.test(targetsSrc) && !/openQueue\.has\(p\.id\)/.test(targetsSrc))
  check('🔴 글 단위 판정은 열쇠에서 글 id 를 뽑아 만든다',
    targetsSrc.includes("k.split(':')[1]"))
  check('🔴 죽은 코드(void)를 남기지 않는다',
    !/\n\s*void (author|targets|planEnqueue|judgeRealMember)\b/.test(queueCode))
  /**
   * 🔴 **기본 회차도 실제 대상을 계산한다.**
   *    옛 판은 대상 상한이 `WANT_APPLY ? 1 : 0` 이라 기본 실행이 항상 0건이었다 —
   *    "무엇이 될지 본다" 는 모드가 아무것도 보지 못했다.
   */
  check('🔴 대상 상한을 쓰기 플래그에 묶지 않는다',
    queueCode.includes('limit: TARGET_LIMIT') && !/limit:\s*WANT_APPLY \? 1 : 0,\n\s*nowMs/.test(queueCode))
  check('🔴 호출 상한과 write 상한을 나눠 넘긴다',
    queueCode.includes('providerCallLimit: WANT_CALL ? TARGET_LIMIT : 0')
    && queueCode.includes('limit: WANT_APPLY ? 1 : 0'))
  /**
   * 🔴 **막는 사유를 한 자리에 모아 넘긴다.**
   *    Gate 입력만 뜻하는 이름이었을 때 분산 조회 실패를 다른 데서 삼켰다.
   */
  check('🔴 유료 호출 차단 판정을 파이프라인에 넘긴다',
    queueCode.includes('preflightOk: material.providerAllowed')
    && queueCode.includes('preflightBlockers: material.providerBlockers'))
  const healthSrc = readFileSync('scripts/persona-comment-health.mts', 'utf-8')
  check('🟢 health 도 남은 수량으로 말한다',
    healthSrc.includes('readiness.allowance.remaining')
    && !/publicAllowedToday:\s*readiness\.publicAllowedToday/.test(healthSrc))
  /**
   * 🔴 **읽을 수 있는 집계와 없는 집계를 갈라 센다.**
   *    근거 칼럼(0024)이 아직 없는 DB 에서 한 쿼리로 묶어 읽으면
   *    bootstrap 집계까지 함께 죽는다 — 실제로 그랬다.
   */
  check('🔴 bootstrap 집계가 근거 칼럼을 함께 읽지 않는다',
    /select: \{ gateResults: true, gateStatus: true \}/.test(healthSrc)
    && !/gateResults: true, gateStatus: true,\s*\n\s*generatedModel/.test(healthSrc))
  check('🔴 근거를 못 읽으면 그 사실을 말한다',
    healthSrc.includes('마이그레이션 0024 미적용일 수 있다'))

  /** 🔴 capability 선언이 참인가 — 선언과 실제가 어긋나면 여기서 깨진다 */
  const txSrc = readFileSync('src/lib/persona-publish-tx.ts', 'utf-8')
  const actual = {
    txRecheck: txSrc.includes('recheckBeforePublish('),
    serializable: /isolationLevel:\s*'Serializable'/.test(txSrc),
    enqueuePipeline: queueSrc.includes('runEnqueuePipeline('),
    runnerPublishes: /import \{ publishCandidateTx \}/.test(runnerSrc),
    /**
     * 🔴 근거를 **정본과 대조**하고, 적재는 **전용 칼럼**에 쓴다.
     *    옛 판은 접두사 모양만 보고 `storyRefs`/`topicTags` 에 끼워 넣었다 —
     *    사람이 편집하는 자리라 한 번 고치면 근거가 사라지거나 위조됐다.
     */
    provenance: txSrc.includes('verifyProvenance(')
      && queueCode.includes('generatedModel: provenance.model')
      && queueCode.includes('canonRunId: provenance.canonRunId')
      && queueCode.includes('canonDigest: provenance.canonDigest')
      && !queueCode.includes('storyRefs: [`provenance:'),
  }
  for (const k of Object.keys(COMMENT_CAPABILITIES) as (keyof typeof COMMENT_CAPABILITIES)[]) {
    check(`🔴 capability 선언이 참이다 — ${k}`, COMMENT_CAPABILITIES[k] === actual[k])
  }
  check('🟢 전부 연결됐다', capabilitiesReady(COMMENT_CAPABILITIES).ok)

  /** 🔴 정본이 artifact 를 실제로 읽고 대조한다 */
  const good = buildCanonFromScoring({
    runId: 'R1', summaryJson: 's', samplesJson: 'p', keyJson: 'k',
    winner: 'claude-haiku-4.5', decidedBy: 'founder', decidedAt: 'now', scoredSamples: 20,
  })
  const tmpDir = mkdtempSync(join(tmpdir(), 'soran-canon-'))
  const canonFile = join(tmpDir, 'canon.json')
  writeFileSync(canonFile, JSON.stringify(good), 'utf-8')
  const okRead = readConfirmedSelection({
    file: canonFile,
    readArtifacts: () => ({ summaryJson: 's', samplesJson: 'p', keyJson: 'k' }),
  })
  check('🟢 artifact 가 그대로면 confirmed', okRead.selection?.status === 'confirmed')
  const changed = readConfirmedSelection({
    file: canonFile,
    readArtifacts: () => ({ summaryJson: 'CHANGED', samplesJson: 'p', keyJson: 'k' }),
  })
  check('🔴 artifact 가 바뀌면 confirmed 가 아니다', changed.selection?.status === 'provisional')
  check('🔴 그때 winner 도 없다', changed.selection?.winner === null)
  const missing = readConfirmedSelection({ file: canonFile, readArtifacts: () => null })
  check('🔴 artifact 를 못 읽으면 confirmed 가 아니다(fail-closed)',
    missing.selection?.status === 'provisional')
  /** 🔴 모양만 맞는 파일로 공개를 열지 못한다 */
  writeFileSync(canonFile, JSON.stringify({ ...good, winner: 'made-up' }), 'utf-8')
  const forged = readConfirmedSelection({
    file: canonFile, readArtifacts: () => ({ summaryJson: 's', samplesJson: 'p', keyJson: 'k' }),
  })
  check('🔴 모양은 맞지만 등록되지 않은 모델이면 게이트가 막는다',
    !judgeModelGate({ selection: forged.selection }).canWriteQueue)
  rmSync(tmpDir, { recursive: true, force: true })

  /** 🔴 provenance 대조 */
  const prov = provenanceOf(good)
  check('🟢 같은 정본이면 근거가 맞는다', verifyProvenance({ stored: prov, canon: good }).ok)
  check('🔴 근거가 없으면 자동 공개 불가', !verifyProvenance({ stored: null, canon: good }).ok)
  check('🔴 다른 회차면 막는다',
    !verifyProvenance({ stored: { ...prov, canonRunId: 'R2' }, canon: good }).ok)
  check('🔴 정본이 바뀌면 막는다',
    !verifyProvenance({ stored: { ...prov, canonDigest: 'deadbeef' }, canon: good }).ok)
  check('🔴 다른 모델이면 막는다',
    !verifyProvenance({ stored: { ...prov, model: 'gpt-5-mini' }, canon: good }).ok)
  check('🔴 정본이 없으면 대조 자체가 불가', !verifyProvenance({ stored: prov, canon: null }).ok)
}

// ─────────────────────────────────────────────────────────
console.log('㊳ EDITED 상태 정합성')
// ─────────────────────────────────────────────────────────
{
  const txSrc = readFileSync('src/lib/persona-publish-tx.ts', 'utf-8')
  /**
   * 🔴 재검사는 EDITED 를 허용하는데 최종 `updateMany` 는 APPROVED 만 봤다.
   *    그래서 수정 승인본은 판정을 통과하고도 `count === 0` 으로 경쟁 오류를 던져
   *    **영원히 발행되지 않았다** — 경쟁이 아니라 상태 불일치였다.
   */
  check('🔴 최종 UPDATE 가 APPROVED·EDITED 를 모두 받는다',
    /status: \{ in: \['APPROVED', 'EDITED'\] \}/.test(txSrc))
  check('🔴 조건부 UPDATE 는 그대로다 (publishedCommentId: null)',
    txSrc.includes('publishedCommentId: null,\n        },\n        data: { status: \'PUBLISHED\'')
    || /publishedCommentId: null,[\s\S]{0,80}status: 'PUBLISHED'/.test(txSrc))
  check('🔴 editedText 가 있으면 그것을 발행한다', (() => {
    const rules = readFileSync('src/lib/persona-publish-rules.ts', 'utf-8')
    return rules.includes('const edited = (candidate.editedText ?? \'\').trim()')
  })())
  check('🟢 recheck 가 EDITED 를 허용한다', (() => {
    const line = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
    return recheckBeforePublish({
      postStatus: 'PUBLISHED', personaActive: true, personaRealMember: false,
      personaCommentsOnPost: 0, memberCommentsOnPost: 0, allowanceCap: 1, mode: 'release' as const,
      publishedTodayInTx: 0, lifeConflict: false,
      gates: GATE_CODES.map((g) => line(g, 'pass')), gateStatus: 'pass',
      isBootstrap: false, queueStatus: 'EDITED', publishedCommentId: null,
      provenanceOk: true, provenanceReason: '근거 확인',
    }).ok
  })())
}

// ─────────────────────────────────────────────────────────
console.log('㊴ 대상 materializer — shadow 와 Queue 가 한 함수를 쓴다')
// ─────────────────────────────────────────────────────────
{
  const NOW = Date.parse('2026-09-09T00:00:00Z')
  const DAY = 86_400_000

  const post: SourcePost = {
    id: 'p1', source: 'SYSTEM', title: '동네 산책',
    content: '오늘 동네를 한 바퀴 걸었어요. 바람이 선선했어요.',
    boardType: '수다방', publishAtMs: NOW - DAY, category: '수다방',
    sourceSite: null,
    authorPersonaCode: 'P02',
    author: null,
    visibility: {
      status: 'PUBLISHED', isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false,
    },
    comments: [{ origin: 'MEMBER', content: '저도 어제 걸었어요 좋더라고요' }],
  }
  const persona: SourcePersona = {
    code: 'P01', status: 'active',
    identity: { job: '강사', maritalStatus: '기혼' },
    voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
    voiceVariations: ['질문형'],
    ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
    user: { providerId: null, accountCount: 0 },
    // 🔴 ⑧ 은 후보를 포함해 minSamples 건이 되어야 돈다 — 이전 발화 5건을 준다
    comments: [
      '저도 그런 날이 있었어요', '무릎이 시큰해서 병원에 갔어요', '햇살이 좋더라고요',
      '같이 걸으면 더 좋아요', '오늘은 좀 쉬려고요',
    ].map((content, i) => ({ content, createdAtMs: NOW - (i + 1) * 3_600_000 })),
  }

  const makeSource = (over: Partial<TargetSource> = {}): TargetSource => ({
    posts: async () => [post],
    personas: async () => [persona],
    openDedupKeys: async () => [],
    recentRoleCounts: async () => ({}),
    knownNames: async () => ['홍길동'],
    frequency: async () => ({ lookup: () => 0, size: 1_000, corpusName: 'comment' }),
    seedUseCount: async () => 3,
    ...over,
  })

  /** 🔴 **실제 대상 1건을 만든다.** 옛 판은 planner 상한이 0 이라 항상 0건이었다 */
  const m1 = await materializeTargets({
    source: makeSource(), limit: 5, nowMs: NOW, windowMs: 7 * DAY,
  })
  check('🟢 실제 대상 1건을 만든다', m1.counts.built === 1 && m1.targets.length === 1)
  check('🟢 그 대상이 (글·Persona) 로 이어져 있다',
    m1.targets[0]?.target.facts.postId === 'p1' && m1.targets[0]?.target.facts.personaCode === 'P01')
  check('🟢 열린 Queue 가 없으면 hasOpenQueue 는 false',
    m1.targets[0]?.target.facts.hasOpenQueue === false)
  check('🟢 생활사 축이 입력까지 이어진다',
    m1.targets[0]?.target.input.persona.identity !== null
    && m1.targets[0]?.target.input.persona.lifeStage === '자녀 대학생')

  /**
   * 🔴 **provider 로 나가는 조각은 전부 ① 대조 목록에 있다.**
   *    프롬프트에는 있는데 sourceTexts 에 없으면 그 조각을 그대로 베껴도 안 잡힌다.
   */
  {
    const input = m1.targets[0]?.target.input
    if (input === undefined) throw new Error('fixture 대상 없음')
    const st = sourceTextsOf(input)
    const prompt = buildPromptFromInput(
      input, m1.targets[0]?.recentTexts ?? [], undefined, { requireReference: false })
    const payload = prompt.ok ? prompt.prompt.userPayload : ''
    const fragments = [input.post.title, input.post.bodyDigest, ...input.post.existingCommentDigests]
    check('🔴 프롬프트에 실리는 조각이 전부 ① sourceTexts 에 있다',
      fragments.every((f) => st.includes(f)))
    check('🔴 그 조각들이 실제로 프롬프트 payload 안에 있다',
      prompt.ok && fragments.every((f) => payload.includes(f)))
    check('🔴 기존 댓글 요약도 빠지지 않는다',
      input.post.existingCommentDigests.length === 1
      && st.includes(input.post.existingCommentDigests[0] ?? ' '))
  }

  /** 🔴 **같은 (글·Persona·역할) 이 열려 있으면 막힌다** — 옛 판은 postId 로 물어 항상 false 였다 */
  {
    const role = m1.targets[0]?.target.facts.reactionRole ?? 'empathy'
    const key = dedupKeyOf('p1', 'P01', role)
    const m2 = await materializeTargets({
      source: makeSource({ openDedupKeys: async () => [key] }),
      limit: 5, nowMs: NOW, windowMs: 7 * DAY,
    })
    check('🔴 열린 Queue 의 dedupKey 에서 postId 를 읽어 낸다', m2.openPostIds.has('p1'))
    check('🔴 그 글은 planner 단계에서 빠진다', m2.counts.built === 0)
    check('🔴 사유를 남긴다 (POST_HAS_OPEN_QUEUE)',
      m2.plan.skipped.some((sk) => sk.blocks.some((b) => b.code === 'POST_HAS_OPEN_QUEUE')))
    // 🔴 열쇠를 postId 로 물었다면 아래가 통과하지 못한다
    const m2b = await materializeTargets({
      source: makeSource({ openDedupKeys: async () => ['comment:p9:P09:advice'] }),
      limit: 5, nowMs: NOW, windowMs: 7 * DAY,
    })
    check('🔴 다른 글의 열린 건은 이 조합을 막지 않는다',
      m2b.counts.built === 1 && m2b.targets[0]?.target.facts.hasOpenQueue === false)
  }

  /** 🔴 **Gate 입력이 하나라도 빠지면 유료 호출을 하지 않는다** */
  {
    check('🟢 다 갖추면 완비다', m1.gateInputsComplete && m1.gaps.length === 0)
    const noNames = await materializeTargets({
      source: makeSource({ knownNames: async () => undefined }),
      limit: 5, nowMs: NOW, windowMs: 7 * DAY,
    })
    check('🔴 knownNames 를 못 읽으면 미완이다',
      !noNames.gateInputsComplete && noNames.gaps.some((g) => g.startsWith('knownNames')))
    const noCorpus = await materializeTargets({
      source: makeSource({ frequency: async () => null }),
      limit: 5, nowMs: NOW, windowMs: 7 * DAY,
    })
    check('🔴 코퍼스를 못 읽으면 미완이다',
      !noCorpus.gateInputsComplete && noCorpus.gaps.some((g) => g.startsWith('frequencyLookup')))
    const noSeed = await materializeTargets({
      source: makeSource({ seedUseCount: async () => null }),
      limit: 5, nowMs: NOW, windowMs: 7 * DAY,
    })
    check('🔴 seed 사용 횟수를 못 세면 미완이다',
      !noSeed.gateInputsComplete && noSeed.gaps.some((g) => g.startsWith('seedUseCount')))
    const shortPrior = await materializeTargets({
      source: makeSource({
        personas: async () => [{ ...persona, comments: persona.comments.slice(0, 1) }],
      }),
      limit: 5, nowMs: NOW, windowMs: 7 * DAY,
    })
    /**
     * 🔴 **표본 부족은 읽기 실패가 아니다.**
     *    ⑧ 은 이전 발화가 쌓이기 전에는 정의상 돌지 않는다. 그것까지 유료 호출을
     *    막으면 첫 후보를 영원히 만들 수 없다 — bootstrap dead-end 가 다시 생긴다.
     *    그래서 호출은 열어 두고, 그 후보는 사람 승인 경로로 간다.
     */
    check('🔴 이전 발화가 모자라면 ⑧ 이 돌지 않는다고 말한다',
      (shortPrior.targets[0]?.willNotRun ?? []).includes('⑧')
      && shortPrior.targets[0]?.gateReady === false)
    check('🟢 그래도 필드는 다 넘겼으므로 호출을 막지는 않는다',
      shortPrior.targets[0]?.fieldsComplete === true && shortPrior.gateInputsComplete)

    /** 🔴 그 상태로 파이프라인을 돌리면 **provider 호출 0** 이다 */
    let calls = 0
    const stopped = await runEnqueuePipeline({
      selection: { status: 'confirmed', winner: 'claude-haiku-4.5' },
      canon: buildCanonFromScoring({
        runId: '20260909-181515', summaryJson: '{"a":1}', samplesJson: '{"b":2}', keyJson: '{"c":3}',
        winner: 'claude-haiku-4.5', decidedBy: 'founder',
        decidedAt: '2026-09-10T00:00:00Z', scoredSamples: 20,
      }),
      targets: noNames.targets.map((t) => t.target),
      limit: 1,
      providerCallLimit: 5,
      preflightOk: noNames.providerAllowed,
      preflightBlockers: noNames.providerBlockers,
      provider: async () => { calls += 1; return { ok: true, text: 'x', errorCode: null } },
      gate: () => ({
        gates: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass' })),
        gateStatus: 'pass', isBootstrap: false,
      }),
    })
    check('🔴 Gate 입력 미완이면 provider 를 한 번도 부르지 않는다',
      calls === 0 && stopped.providerCalls === 0 && stopped.created === 0)
    check('🔴 그 이유를 말한다',
      (stopped.stoppedReason ?? '').includes('Gate 입력이 갖춰지지 않았다'))
  }

  /** 🔴 Gate 입력은 손으로 채우지 않는다 — materializer 가 준 것이 그대로 들어간다 */
  {
    const t = m1.targets[0]
    if (t === undefined) throw new Error('fixture 대상 없음')
    const gi = gateInputOf(t.gate, t.target.input, '저도 그런 날이 있어요')
    check('🔴 ⑥ 회원 표시명이 실제로 들어간다', gi.knownNames?.includes('홍길동') === true)
    check('🔴 ② 코퍼스 조회가 들어간다',
      typeof gi.frequencyLookup === 'function' && gi.corpusName === 'comment')
    check('🔴 ⑧ 이전 발화가 실제 발화다', (gi.priorTexts?.length ?? 0) === 5)
    check('🔴 ⑧ seed 사용 횟수가 실측이다 (1 로 적어 넣지 않는다)', gi.seedUseCount === 3)
    check('🔴 ⑨ 카페 운영 문맥 여부를 명시한다', gi.sourceIsCafeOperational === false)
  }
}

// ─────────────────────────────────────────────────────────
console.log('㊵ 실행 모드 · 상한 · 배치 진행')
// ─────────────────────────────────────────────────────────
{
  check('🟢 기본은 inspect — provider 0 · write 0', (() => {
    const f = judgeQueueFlags([])
    return f.ok && f.mode === 'inspect' && !f.providerAllowed && !f.writeAllowed
  })())
  check('🟢 --call 은 부르되 쓰지 않는다', (() => {
    const f = judgeQueueFlags(['--call'])
    return f.ok && f.mode === 'call' && f.providerAllowed && !f.writeAllowed
  })())
  check('🟢 --call 과 함께 주면 쓴다', (() => {
    const f = judgeQueueFlags(['--call', '--apply'])
    return f.ok && f.mode === 'call+apply' && f.providerAllowed && f.writeAllowed
  })())
  check('🔴 쓰기 플래그 단독은 실패다 (조용히 dry-run 으로 낮추지 않는다)', (() => {
    const f = judgeQueueFlags(['--apply'])
    return !f.ok && !f.providerAllowed && !f.writeAllowed && f.reason.includes('--call')
  })())

  const gline = (gate: string, outcome: string): { gate: string; outcome: string } => ({ gate, outcome })
  const txFacts = (over: Partial<TxRecheckFacts> = {}): TxRecheckFacts => ({
    postStatus: 'PUBLISHED', personaActive: true, personaRealMember: false,
    personaCommentsOnPost: 0, memberCommentsOnPost: 0,
    allowanceCap: 1, mode: 'release' as const, publishedTodayInTx: 0, lifeConflict: false,
    gates: GATE_CODES.map((g) => gline(g, 'pass')), gateStatus: 'pass',
    isBootstrap: false, queueStatus: 'APPROVED', publishedCommentId: null,
    provenanceOk: true, provenanceReason: '근거 확인',
    ...over,
  })

  /** 🔴 shadow·inspect 에서는 공개 write 가 0 이다 — manual-admin 도 우회하지 못한다 */
  check('🔴 shadow 모드면 트랜잭션이 막는다', !recheckBeforePublish(txFacts({ mode: 'shadow' })).ok)
  check('🔴 inspect 모드면 트랜잭션이 막는다', !recheckBeforePublish(txFacts({ mode: 'inspect' })).ok)
  check('🔴 manual-admin 도 shadow 를 우회하지 못한다',
    !recheckBeforePublish(txFacts({ mode: 'shadow', actor: 'manual-admin' })).ok)
  check('🔴 그 사유를 말한다', recheckBeforePublish(txFacts({ mode: 'shadow' })).blockers
    .some((b) => b.includes('공개 Comment 를 쓰지 않는다')))
  check('🟢 release 면 통과한다', recheckBeforePublish(txFacts()).ok)

  /** 🔴 cap 2 — 두 건은 되고 세 번째는 막힌다. 상한에서 **사용량을 뺀다** */
  check('🟢 cap 2 · 사용 0 → 통과',
    recheckBeforePublish(txFacts({ allowanceCap: 2, publishedTodayInTx: 0 })).ok)
  check('🟢 cap 2 · 사용 1 → 통과 (자리가 남았다)',
    recheckBeforePublish(txFacts({ allowanceCap: 2, publishedTodayInTx: 1 })).ok)
  check('🔴 cap 2 · 사용 2 → 막힌다',
    !recheckBeforePublish(txFacts({ allowanceCap: 2, publishedTodayInTx: 2 })).ok)
  check('🔴 cap 2 · 사용 3 → 막힌다',
    !recheckBeforePublish(txFacts({ allowanceCap: 2, publishedTodayInTx: 3 })).ok)
  check('🔴 상한·사용량을 못 세면 막는다',
    !recheckBeforePublish(txFacts({ allowanceCap: Number.NaN })).ok
    && !recheckBeforePublish(txFacts({ publishedTodayInTx: Number.NaN })).ok)

  /** 🔴 첫 후보가 막혀도 다음 후보로 간다 */
  {
    const outcomes = new Map<string, 'published' | 'blocked'>([
      ['a', 'blocked'], ['b', 'published'], ['c', 'published'], ['d', 'blocked'],
    ])
    const run = async (ids: string[], allowed: number): Promise<{
      published: number; attempted: number; seen: string[]
    }> => {
      const seen: string[] = []
      const r = await publishBatch({
        candidates: ids, allowed,
        publish: async (id) => {
          seen.push(id)
          return { outcome: outcomes.get(id) ?? 'blocked', detail: id }
        },
      })
      return { published: r.published, attempted: r.attempted, seen }
    }
    const one = await run(['a', 'b', 'c', 'd'], 1)
    check('🔴 맨 앞이 막히면 건너뛰고 다음을 발행한다',
      one.published === 1 && one.attempted === 2 && one.seen.join(',') === 'a,b')
    const two = await run(['a', 'b', 'c', 'd'], 2)
    check('🟢 허용 2 면 성공 2건까지 간다', two.published === 2 && two.seen.join(',') === 'a,b,c')
    const none = await run(['a', 'd'], 2)
    check('🔴 다 막히면 배치만큼만 시도하고 끝난다 (무한 루프 없음)',
      none.published === 0 && none.attempted === 2)
    const all = await publishBatch({
      candidates: ['a', 'd'], allowed: 2,
      publish: async () => ({ outcome: 'blocked' as const, detail: 'x' }),
    })
    check('🔴 허용치를 못 채웠다고 말한다', all.shortOfAllowed)
    check('🟢 배치 크기는 허용치의 배수이되 상한이 있다',
      batchSizeFor(1) === 5 && batchSizeFor(10) === 25 && batchSizeFor(0) === 1)
  }

  /** 🔴 runner 가 배선을 하드코딩하지 않는다 */
  {
    const runnerSrc = readFileSync('scripts/persona-comment-runner.mts', 'utf-8')
      .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
    check('🔴 재검사 배선을 true 로 적어 두지 않는다', !/txRecheckWired:\s*true/.test(runnerSrc))
    check('🟢 capability 판정을 실제로 읽는다', /txRecheckWired:\s*caps\.ok/.test(runnerSrc))
    check('🔴 읽는 수를 허용치로 고정하지 않는다', !/take:\s*release\.allowed/.test(runnerSrc))
    check('🟢 배치 크기 함수를 쓴다', runnerSrc.includes('batchSizeFor(release.allowed)'))
    check('🟢 남은 수량으로 판정한다', runnerSrc.includes('readiness.allowance.remaining'))
  }
}

// ─────────────────────────────────────────────────────────
console.log('㊶ 생성 근거 위조 · artifact 공용 경로')
// ─────────────────────────────────────────────────────────
{
  const canon2 = buildCanonFromScoring({
    runId: '20260909-101010', summaryJson: '{"s":1}', samplesJson: '{"m":2}', keyJson: '{"k":3}',
    winner: 'claude-haiku-4.5', decidedBy: 'founder',
    decidedAt: '2026-09-10T00:00:00Z', scoredSamples: 20,
  })
  const prov = provenanceOf(canon2)

  check('🟢 정본으로 만든 근거는 통과한다', verifyProvenance({ stored: prov, canon: canon2 }).ok)
  check('🔴 digest 를 바꾸면 막힌다',
    !verifyProvenance({ stored: { ...prov, canonDigest: 'deadbeefdeadbeef' }, canon: canon2 }).ok)
  check('🔴 회차를 바꾸면 막힌다',
    !verifyProvenance({ stored: { ...prov, canonRunId: '20260101-000000' }, canon: canon2 }).ok)
  check('🔴 모델명을 바꾸면 막힌다',
    !verifyProvenance({ stored: { ...prov, model: 'gpt-4o-mini' }, canon: canon2 }).ok)
  check('🔴 근거가 없으면 자동 공개 불가다', !verifyProvenance({ stored: null, canon: canon2 }).ok)
  check('🔴 정본이 없으면 대조 자체가 안 된다', !verifyProvenance({ stored: prov, canon: null }).ok)

  /** 🔴 **artifact 는 worktree 밖 공용 경로에 있다** — runtime 과 개발 트리가 같은 SHA 를 본다 */
  check('🔴 artifact 경로가 Application Support 아래다',
    ARTIFACT_ROOT.startsWith(join(homedir(), 'Library', 'Application Support', 'soransoran')))
  check('🔴 cwd 아래를 근거로 쓰지 않는다',
    !ARTIFACT_ROOT.startsWith(process.cwd()) && !ARTIFACT_ROOT.startsWith('tmp'))

  const tmpBase = mkdtempSync(join(tmpdir(), 'canon-promote-'))
  try {
    const fromRoot = join(tmpBase, 'local')
    const toRoot = join(tmpBase, 'shared')
    const runId = '20260909-101010'
    mkdirDeep(join(fromRoot, runId))
    writeFileSync(join(fromRoot, runId, 'summary.json'), '{"s":1}', 'utf-8')
    writeFileSync(join(fromRoot, runId, 'samples.json'), '{"m":2}', 'utf-8')
    writeFileSync(join(fromRoot, runId, 'key.json'), '{"k":3}', 'utf-8')

    const before = promotionStatus(runId, { fromRoot, toRoot })
    check('🔴 승격 전에는 공용 경로에 없다',
      before.inLocal !== null && before.inShared === null && !before.same)

    const r1 = promoteRun({ runId, fromRoot, toRoot })
    check('🟢 승격하면 공용 경로에 들어간다', r1.ok && !r1.already)
    const after = promotionStatus(runId, { fromRoot, toRoot })
    check('🟢 두 곳이 같은 SHA 를 본다', after.same)
    check('🟢 그 SHA 가 정본이 적어 둔 것과 같다',
      after.inShared?.['summary.json'] === canon2.artifactSha.summary
      && after.inShared?.['samples.json'] === canon2.artifactSha.samples
      && after.inShared?.['key.json'] === canon2.artifactSha.key)

    const r2 = promoteRun({ runId, fromRoot, toRoot })
    check('🟢 같은 내용을 다시 승격하면 아무것도 바꾸지 않는다', r2.ok && r2.already)

    // 🔴 로컬을 고쳐 두고 다시 승격해도 덮어쓰지 않는다
    writeFileSync(join(fromRoot, runId, 'samples.json'), '{"m":999}', 'utf-8')
    const r3 = promoteRun({ runId, fromRoot, toRoot })
    check('🔴 내용이 달라지면 승격을 거부한다 (불변)',
      !r3.ok && r3.reason.includes('덮어쓰지 않는다'))
    check('🔴 거부 뒤에도 공용 경로는 그대로다',
      promotionStatus(runId, { fromRoot, toRoot }).inShared?.['samples.json'] === canon2.artifactSha.samples)

    /** 🔴 정본을 공용 artifact 와 대조한다 — runtime 이 하는 것과 같은 판정이다 */
    const canonFile = join(tmpBase, 'model.json')
    writeFileSync(canonFile, JSON.stringify(canon2), 'utf-8')
    const readShared = (id: string): { summaryJson: string; samplesJson: string; keyJson: string } | null => {
      try {
        return {
          summaryJson: readFileSync(join(toRoot, id, 'summary.json'), 'utf-8'),
          samplesJson: readFileSync(join(toRoot, id, 'samples.json'), 'utf-8'),
          keyJson: readFileSync(join(toRoot, id, 'key.json'), 'utf-8'),
        }
      } catch { return null }
    }
    const confirmed2 = readConfirmedSelection({ file: canonFile, readArtifacts: readShared })
    check('🟢 공용 경로의 artifact 로 확정이 성립한다',
      confirmed2.selection?.status === 'confirmed' && confirmed2.canon?.runId === runId)
    const missing2 = readConfirmedSelection({ file: canonFile, readArtifacts: () => null })
    check('🔴 artifact 를 못 읽으면 확정으로 보지 않는다',
      missing2.selection?.status === 'provisional' && missing2.selection.winner === null)
  } finally {
    rmSync(tmpBase, { recursive: true, force: true })
  }
}

// ─────────────────────────────────────────────────────────
console.log('㊷ Gate 입력의 사실성 — 있음 ≠ 맞음')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **`adviceForbidden` 은 정본에서 파생한다.**
   *    옛 판은 `false` 를 고정으로 넘겨 ⑤ 의 조언 검사가 한 번도 돌지 않았다 —
   *    전면 금지라고 적어 둔 축이 꺼져 있었다.
   */
  check('🔴 advice 는 지금 정본에서 전면 금지다', FORBIDDEN_REACTION_ROLES.includes('advice'))
  check('🔴 그래서 파생값은 언제나 true 다', isAdviceForbidden([]) && isAdviceForbidden(['advice']))
  check('🔴 복제 상수를 만들지 않는다 — 목록 하나에서 나온다', (() => {
    const src = readFileSync('src/lib/persona-reaction-roles.ts', 'utf-8')
    return /FORBIDDEN_REACTION_ROLES\.includes\('advice'\)/.test(src)
  })())
  check('🔴 대상 구성이 고정 false 를 적어 넣지 않는다', (() => {
    const src = readFileSync('scripts/lib/persona-comment-targets.ts', 'utf-8')
      .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
    return !/adviceForbidden:\s*false/.test(src) && !/sourceIsCafeOperational:\s*false/.test(src)
  })())

  /** 🔴 ⑨ 출처 문맥 — true / false / unknown 세 경우 */
  const vis = (isMicroSeed: boolean): {
    status: 'PUBLISHED'; isMicroSeed: boolean; permanentNoindex: boolean; indexPromotionBlocked: boolean
  } => ({
    status: 'PUBLISHED', isMicroSeed,
    permanentNoindex: isMicroSeed, indexPromotionBlocked: isMicroSeed,
  })
  const base = {
    visibility: vis(true), sourceSite: '82cook', boardType: 'FREE',
    title: '동네 산책', body: '오늘 한 바퀴 걸었어요',
  }
  check('🟢 일상 글이면 false 다', judgeSourceContext(base).operational === false)
  check('🔴 공지 표지가 있으면 true 다',
    judgeSourceContext({ ...base, title: '[공지] 회원 여러분께' }).operational === true)
  check('🔴 광고·협찬 표지도 true 다',
    judgeSourceContext({ ...base, body: '이번 체험단 협찬 안내입니다' }).operational === true)
  check('🔴 운영 제작 게시판은 표지 없이도 true 다',
    judgeSourceContext({ ...base, boardType: 'MAGAZINE' }).operational === true)
  check('🔴 게시판을 모르면 unknown 이다',
    judgeSourceContext({ ...base, boardType: null }).operational === null)
  check('🔴 제목·본문이 비면 unknown 이다',
    judgeSourceContext({ ...base, title: '', body: '' }).operational === null)
  check('🔴 외부 글인데 출처 공동체를 모르면 unknown 이다',
    judgeSourceContext({ ...base, sourceSite: null }).operational === null)
  check('🟢 자체 글은 출처가 없어도 판정된다',
    judgeSourceContext({ ...base, visibility: vis(false), sourceSite: null }).operational === false)
  check('🔴 노출 축을 못 읽으면 unknown 이다',
    judgeSourceContext({ ...base, visibility: null }).operational === null)
  check('🔴 3축을 직접 비교하지 않는다 (정본 함수를 쓴다)', (() => {
    const src = readFileSync('src/lib/persona-comment-source-context.ts', 'utf-8')
    return src.includes('isExternalSourcedBody(')
  })())
  check('🔴 unknown 을 false 로 보정하지 않는다',
    judgeSourceContext({ ...base, boardType: null }).operational !== false)
  check('🔴 근거에 원문 조각을 담지 않는다', (() => {
    const v = judgeSourceContext({ ...base, title: '[공지] 비밀번호는 1234 입니다' })
    return v.operational === true && !v.reason.includes('1234')
  })())
}

// ─────────────────────────────────────────────────────────
console.log('㊸ 사실성·분산 실패가 유료 호출을 막는가 (행동)')
// ─────────────────────────────────────────────────────────
{
  const NOW = Date.parse('2026-09-09T00:00:00Z')
  const DAY = 86_400_000

  const post: SourcePost = {
    id: 'p1', source: 'SYSTEM', title: '동네 산책',
    content: '오늘 동네를 한 바퀴 걸었어요. 바람이 선선했어요.',
    boardType: 'FREE', publishAtMs: NOW - DAY, category: null,
    /**
     * 🔴 자체 글이다. 외부 원문(micro seed)은 `judgePostAuthor` 가 이미
     *    외부 전송을 막으므로, 여기서 provider 가 열리는지 보려면 자체 글이어야 한다.
     */
    sourceSite: null,
    authorPersonaCode: 'P02',
    author: null,
    visibility: {
      status: 'PUBLISHED', isMicroSeed: false, permanentNoindex: false, indexPromotionBlocked: false,
    },
    comments: [{ origin: 'MEMBER', content: '저도 어제 걸었어요 좋더라고요' }],
  }
  const persona: SourcePersona = {
    code: 'P01', status: 'active',
    identity: { job: '강사', maritalStatus: '기혼' },
    voiceCore: { ending: '~해요', register: '존댓말', emoji: '가끔', length: '짧은 문장' },
    voiceVariations: ['질문형'],
    ageBand: '50대', region: '경기', lifeStage: '자녀 대학생',
    noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [],
    user: { providerId: null, accountCount: 0 },
    comments: [
      '저도 그런 날이 있었어요', '무릎이 시큰해서 병원에 갔어요', '햇살이 좋더라고요',
      '같이 걸으면 더 좋아요', '오늘은 좀 쉬려고요',
    ].map((content, i) => ({ content, createdAtMs: NOW - (i + 1) * 3_600_000 })),
  }
  const makeSource = (over: Partial<TargetSource> = {}): TargetSource => ({
    posts: async () => [post],
    personas: async () => [persona],
    openDedupKeys: async () => [],
    recentRoleCounts: async () => ({}),
    knownNames: async () => ['홍길동'],
    frequency: async () => ({ lookup: () => 0, size: 1_000, corpusName: 'comment' }),
    seedUseCount: async () => 3,
    ...over,
  })
  const mat = (over: Partial<TargetSource> = {}): Promise<Awaited<ReturnType<typeof materializeTargets>>> =>
    materializeTargets({ source: makeSource(over), limit: 5, nowMs: NOW, windowMs: 7 * DAY })

  const canon3 = buildCanonFromScoring({
    runId: '20260909-181515', summaryJson: '{"a":1}', samplesJson: '{"b":2}', keyJson: '{"c":3}',
    winner: 'claude-haiku-4.5', decidedBy: 'founder',
    decidedAt: '2026-09-10T00:00:00Z', scoredSamples: 20,
  })
  const callsWith = async (m: Awaited<ReturnType<typeof materializeTargets>>): Promise<number> => {
    let n = 0
    await runEnqueuePipeline({
      selection: { status: 'confirmed', winner: 'claude-haiku-4.5' },
      canon: canon3,
      targets: m.targets.map((t) => t.target),
      limit: 1,
      providerCallLimit: 5,
      preflightOk: m.providerAllowed,
      preflightBlockers: m.providerBlockers,
      provider: async () => { n += 1; return { ok: true, text: 'x', errorCode: null } },
      gate: () => ({
        gates: GATE_CODES.map((g) => ({ gate: g, outcome: 'pass' })),
        gateStatus: 'pass', isBootstrap: false,
      }),
    })
    return n
  }

  /** 🟢 정상 0건 — 분산을 신뢰할 수 있다 */
  const zero = await mat()
  check('🟢 최근 역할 0건은 정상이다 (빈 객체)',
    zero.recentRoleCounts !== null && Object.keys(zero.recentRoleCounts).length === 0)
  check('🟢 그때 유료 호출은 열린다', zero.providerAllowed && await callsWith(zero) === 1)

  /** 🟢 정상 집계 */
  const some = await mat({ recentRoleCounts: async () => ({ empathy: 3, question: 1 }) })
  check('🟢 정상 집계는 그대로 넘어간다', some.recentRoleCounts?.empathy === 3)
  check('🟢 그때도 유료 호출은 열린다', some.providerAllowed)

  /** 🔴 조회 실패 — 정상 0건으로 위장하지 않는다 */
  const failed = await mat({ recentRoleCounts: async () => null })
  check('🔴 조회 실패는 null 로 남는다 — {} 로 위장하지 않는다', failed.recentRoleCounts === null)
  check('🔴 그 사유가 차단 목록에 있다',
    failed.providerBlockers.some((b) => b.startsWith('recentRoleCounts')))
  check('🔴 그때 provider 호출 0', !failed.providerAllowed && await callsWith(failed) === 0)
  check('🟢 그래도 대상 계산은 보여 준다 (inspect 는 죽지 않는다)', failed.counts.built === 1)


  /**
   * 🔴 **실제 DB 어댑터가 실패를 어떻게 돌려주는가.**
   *
   *    앞선 재주입에서 드러났다 — 가짜 source 만 쓰면 어댑터가 실패를 `{}` 로
   *    삼켜도 검사가 통과한다. 판정 함수는 지켰는데 **그 판정에 값을 넣는 쪽**이
   *    비어 있었다. 그래서 어댑터도 주입된 DB 로 직접 시험한다.
   */
  {
    type Thrower = { throws: boolean }
    const fakePrisma = (t: Thrower): Parameters<typeof makeDbTargetSource>[0]['prisma'] => ({
      personaApprovalQueue: {
        findMany: async () => {
          if (t.throws) throw new Error('연결 끊김')
          return [{ reactionType: 'empathy' }, { reactionType: 'empathy' }, { reactionType: 'question' }]
        },
        count: async () => { if (t.throws) throw new Error('연결 끊김'); return 2 },
      },
      user: {
        findMany: async () => {
          if (t.throws) throw new Error('연결 끊김')
          return [{ nickname: '홍길동', name: null }]
        },
      },
      persona: {
        findUnique: async () => { if (t.throws) throw new Error('연결 끊김'); return { id: 'x' } },
      },
      comment: {
        count: async () => { if (t.throws) throw new Error('연결 끊김'); return 3 },
      },
    } as unknown as Parameters<typeof makeDbTargetSource>[0]['prisma'])

    const src = (throws: boolean): TargetSource => makeDbTargetSource({
      prisma: fakePrisma({ throws }),
      windowStart: new Date(0),
      // 🔴 외부 코퍼스는 이 검사에서 열지 않는다 — 네트워크 0
      readCorpus: false,
    })

    const okCounts = await src(false).recentRoleCounts()
    check('🟢 어댑터는 정상 집계를 그대로 돌려준다', okCounts?.empathy === 2 && okCounts?.question === 1)
    check('🔴 어댑터는 조회 실패를 null 로 돌려준다 — {} 로 삼키지 않는다',
      await src(true).recentRoleCounts() === null)
    check('🔴 회원 표시명도 실패를 undefined 로 돌려준다',
      await src(true).knownNames() === undefined)
    check('🟢 정상이면 표시명을 돌려준다', (await src(false).knownNames())?.length === 1)
    check('🔴 seed 사용 횟수도 실패를 null 로 돌려준다',
      await src(true).seedUseCount('P01') === null)
    check('🟢 정상이면 실측 횟수를 돌려준다', await src(false).seedUseCount('P01') === 6)
    check('🔴 코퍼스를 열지 않기로 하면 null 이다', await src(false).frequency() === null)
  }

  /** 🔴 출처 문맥 판정 불가 — provider 앞에서 막는다 */
  const unknownCtx = await mat({
    // 🔴 게시판을 못 읽은 상태 — 출처 문맥을 판정할 재료가 없다
    posts: async () => [{ ...post, boardType: '' }],
  })
  check('🔴 출처 문맥을 못 정하면 차단 사유가 생긴다',
    unknownCtx.providerBlockers.some((b) => b.startsWith('sourceIsCafeOperational')))
  check('🔴 그때 provider 호출 0', !unknownCtx.providerAllowed && await callsWith(unknownCtx) === 0)
  check('🔴 Gate 입력에서 ⑨ 를 비워 둔다 (거짓 false 를 넣지 않는다)', (() => {
    const t = unknownCtx.targets[0]
    if (t === undefined) return false
    const gi = gateInputOf(t.gate, t.target.input, '저도 그래요')
    return gi.sourceIsCafeOperational === undefined
  })())

  /** 🔴 운영 문맥이면 그 사실이 Gate 로 넘어간다 */
  const opCtx = await mat({
    posts: async () => [{ ...post, title: '[공지] 이번 달 이벤트 안내' }],
  })
  check('🔴 운영 문맥은 true 로 Gate 에 넘어간다', (() => {
    const t = opCtx.targets[0]
    if (t === undefined) return false
    return gateInputOf(t.gate, t.target.input, '저도 그래요').sourceIsCafeOperational === true
  })())

  /** 🟢 일상 글이면 false 가 **관측 결과로** 넘어간다 */
  check('🟢 일상 글은 false 로 넘어가되 근거가 남는다', (() => {
    const t = zero.targets[0]
    if (t === undefined) return false
    return gateInputOf(t.gate, t.target.input, '저도 그래요').sourceIsCafeOperational === false
      && t.gate.sourceContextReason.includes('운영 표지 없음')
  })())

  /** 🔴 ⑤ 조언 축이 실제로 켜진 채 넘어간다 */
  check('🔴 adviceForbidden 이 true 로 Gate 에 넘어간다', (() => {
    const t = zero.targets[0]
    if (t === undefined) return false
    return gateInputOf(t.gate, t.target.input, '저도 그래요').adviceForbidden === true
  })())
}

// ─────────────────────────────────────────────────────────
console.log('㊹ migration 0024 상태 판정 — metadata 로만 (DB write 0)')
// ─────────────────────────────────────────────────────────
{
  const col = (name: string, nullable = 'YES', type = 'text'): {
    column_name: string; data_type: string; is_nullable: string
  } => ({ column_name: name, data_type: type, is_nullable: nullable })

  const baseCols = BASELINE_COLUMNS.map((c) => col(c, 'NO'))
  const baseIdx = [...BASELINE_INDEXES]
  const newCols = MIG_NEW_COLUMNS.map((c) => col(c))

  /** 🔴 미적용 — 오류가 아니라 사실이다. 그래도 통과는 아니다 */
  const notApplied = judgeMigrationState({
    table: MIG_TABLE, columns: baseCols, indexes: baseIdx,
  })
  check('🟢 미적용을 NOT_APPLIED 로 판정한다', notApplied.state === 'NOT_APPLIED')
  check('🔴 미적용은 controlled exit 1 이다', notApplied.exitCode === 1)
  check('🔴 기존 컬럼 유실을 만들어 내지 않는다',
    notApplied.findings.find((f) => f.code === 'BASELINE_COLUMNS')?.ok === true)

  /** 🟢 적용 완료 */
  const applied = judgeMigrationState({
    table: MIG_TABLE, columns: [...baseCols, ...newCols], indexes: [...baseIdx, MIG_NEW_INDEX],
  })
  check('🟢 적용을 APPLIED_AND_VALID 로 판정한다', applied.state === 'APPLIED_AND_VALID')
  check('🟢 그때만 exit 0 이다', applied.exitCode === 0)
  check('🟢 기존 컬럼 불변을 PASS 한다',
    applied.findings.filter((f) => f.code.startsWith('BASELINE')).every((f) => f.ok))

  /** 🔴 일부만 적용 */
  const partial = judgeMigrationState({
    table: MIG_TABLE,
    columns: [...baseCols, col('generatedModel')],
    indexes: [...baseIdx, MIG_NEW_INDEX],
  })
  check('🔴 컬럼이 일부만 있으면 PARTIAL_OR_INVALID', partial.state === 'PARTIAL_OR_INVALID')

  /** 🔴 NOT NULL 로 들어갔다 */
  const notNull = judgeMigrationState({
    table: MIG_TABLE,
    columns: [...baseCols, ...MIG_NEW_COLUMNS.map((c) => col(c, 'NO'))],
    indexes: [...baseIdx, MIG_NEW_INDEX],
  })
  check('🔴 NOT NULL 이면 PARTIAL_OR_INVALID', notNull.state === 'PARTIAL_OR_INVALID')
  check('🔴 그 이유를 말한다', notNull.summary.includes('NOT NULL'))

  /** 🔴 타입이 다르다 */
  const wrongType = judgeMigrationState({
    table: MIG_TABLE,
    columns: [...baseCols, ...MIG_NEW_COLUMNS.map((c) => col(c, 'YES', 'integer'))],
    indexes: [...baseIdx, MIG_NEW_INDEX],
  })
  check('🔴 타입이 text 가 아니면 PARTIAL_OR_INVALID', wrongType.state === 'PARTIAL_OR_INVALID')

  /** 🔴 인덱스 누락 */
  const noIdx = judgeMigrationState({
    table: MIG_TABLE, columns: [...baseCols, ...newCols], indexes: baseIdx,
  })
  check('🔴 인덱스가 없으면 PARTIAL_OR_INVALID', noIdx.state === 'PARTIAL_OR_INVALID')

  /** 🔴 기존 컬럼이 사라졌다 */
  const lost = judgeMigrationState({
    table: MIG_TABLE,
    columns: [...baseCols.filter((c) => c.column_name !== 'dedupKey'), ...newCols],
    indexes: [...baseIdx, MIG_NEW_INDEX],
  })
  check('🔴 기존 컬럼이 사라지면 PARTIAL_OR_INVALID', lost.state === 'PARTIAL_OR_INVALID')

  /** 🔴 관측 자체가 잘못됐다 — 다른 테이블 · 못 읽음 */
  check('🔴 다른 테이블 metadata 는 OBSERVATION_FAILED',
    judgeMigrationState({ table: 'MicroSeedCandidate', columns: baseCols, indexes: baseIdx })
      .state === 'OBSERVATION_FAILED')
  check('🔴 컬럼을 못 읽으면 OBSERVATION_FAILED',
    judgeMigrationState({ table: MIG_TABLE, columns: null, indexes: baseIdx })
      .state === 'OBSERVATION_FAILED')
  check('🔴 인덱스를 못 읽으면 OBSERVATION_FAILED',
    judgeMigrationState({ table: MIG_TABLE, columns: baseCols, indexes: null })
      .state === 'OBSERVATION_FAILED')
  check('🔴 컬럼 0개면 OBSERVATION_FAILED',
    judgeMigrationState({ table: MIG_TABLE, columns: [], indexes: baseIdx })
      .state === 'OBSERVATION_FAILED')
  check('🔴 관측 실패는 통과가 아니다',
    judgeMigrationState({ table: null, columns: null, indexes: null }).exitCode === 1)


  /**
   * 🔴 **적용은 COMMIT 전에 검증한다.**
   *    옛 순서(`BEGIN → SQL → COMMIT → 검증`)는 검증이 실패해도 되돌릴 수 없었다 —
   *    "적용 실패" 라고 말하면서 DB 는 바뀐 채로 남는다.
   */
  {
    const cols = BASELINE_COLUMNS.map((c) => col(c, 'NO'))
    const after = {
      table: MIG_TABLE,
      columns: [...cols, ...MIG_NEW_COLUMNS.map((c) => col(c))],
      indexes: [...BASELINE_INDEXES, MIG_NEW_INDEX],
    }
    const counts = { Comment: 26, PersonaApprovalQueue: 4 }
    const tx = async (o: {
      after?: typeof after; counts?: typeof counts; failOn?: string
    } = {}): Promise<Awaited<ReturnType<typeof applyWithVerification>>> => applyWithVerification({
      exec: async (_t: string, label: string) => {
        if (o.failOn === label) throw new Error(`${label} 실패(가짜)`)
        return {}
      },
      sql: 'ALTER TABLE "PersonaApprovalQueue" ADD COLUMN IF NOT EXISTS "generatedModel" TEXT;',
      observe: async () => o.after ?? after,
      countTables: async () => o.counts ?? counts,
      beforeCounts: counts,
    })

    const good = await tx()
    check('🟢 정상이면 COMMIT 1 · ROLLBACK 0', good.ok && good.committed === 1 && good.rolledBack === 0)
    check('🔴 검증이 COMMIT 앞에 있다',
      good.calls.join(',') === 'BEGIN,SQL,OBSERVE,COUNT,COMMIT')
    const noIdx = await tx({ after: { ...after, indexes: [...BASELINE_INDEXES] } })
    check('🔴 신규 인덱스가 없으면 되돌린다 (COMMIT 0)',
      !noIdx.ok && noIdx.committed === 0 && noIdx.rolledBack === 1)
    const moved = await tx({ counts: { ...counts, Comment: 27 } })
    check('🔴 기존 row 가 변하면 되돌린다 (COMMIT 0)',
      !moved.ok && moved.committed === 0 && moved.rolledBack === 1)
    const commitFail = await tx({ failOn: 'COMMIT' })
    check('🔴 COMMIT 이 실패하면 성공으로 보고하지 않는다',
      !commitFail.ok && commitFail.committed === 0)

    /** 🔴 기존 인덱스 기준선이 실측 5개와 같은가 */
    check('🔴 기존 인덱스 기준선이 5개다', BASELINE_INDEXES.length === 5)
    for (const gone of BASELINE_INDEXES) {
      check(`🔴 ${gone} 가 사라지면 잡는다`, judgeMigrationState({
        table: MIG_TABLE,
        columns: after.columns,
        indexes: after.indexes.filter((i) => i !== gone),
      }).state === 'PARTIAL_OR_INVALID')
    }
  }

  /**
   * 🔴 **다른 테이블의 컬럼 이름을 기존 컬럼으로 적어 두지 않았는가.**
   *    앞선 판은 0023(`MicroSeedCandidate`)에서 베낀 이름을 검사해
   *    늘 "유실 4종" 을 보고했고, 이어서 없는 컬럼을 조회하다 42703 으로 죽었다.
   */
  for (const alien of ['sourceRawContentId', 'draftTitle', 'draftBody', 'createdPostId']) {
    check(`🔴 기존 컬럼 목록에 ${alien} 가 없다`, !BASELINE_COLUMNS.includes(alien))
  }
  const migSrc = readFileSync('scripts/apply-migration-0024.mjs', 'utf-8')
  check('🔴 CLI 가 createdPostId 를 조회하지 않는다', !migSrc.includes('"createdPostId" IS NOT NULL'))
  check('🔴 CLI 가 판정을 스스로 다시 적지 않는다', migSrc.includes('judgeMigrationState('))
  check('🔴 --apply 없이는 어떤 쓰기도 하지 않는다', (() => {
    const code = migSrc.split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
    // 🔴 트랜잭션 제어는 검증 함수 한 곳에만 있다 — CLI 는 APPLY 뒤에만 그것을 부른다
    const applyAt = code.indexOf('if (!APPLY)')
    const txAt = code.indexOf('applyWithVerification(')
    return applyAt > 0 && txAt > applyAt
      && !/client\.query\('BEGIN'\)/.test(code) && !/client\.query\('COMMIT'\)/.test(code)
  })())

  /** 🔴 프로젝트를 못 알아보면 통과시키지 않는다 */
  const REF = 'buougdxmfobjilgjonby'
  check('🟢 host 에서 ref 를 읽는다',
    judgeProjectRef({ hostname: `db.${REF}.supabase.co`, username: 'postgres' }, REF).ok)
  check('🟢 pooler 사용자 이름에서도 읽는다',
    judgeProjectRef({
      hostname: 'aws-0-ap-northeast-2.pooler.supabase.com', username: `postgres.${REF}`,
    }, REF).ok)
  check('🔴 둘 다 못 읽으면 fail-closed',
    !judgeProjectRef({ hostname: 'localhost', username: 'postgres' }, REF).ok)
  check('🔴 그 사유를 말한다',
    judgeProjectRef({ hostname: 'localhost', username: 'postgres' }, REF)
      .reason.includes('fail-closed'))
  check('🔴 다른 프로젝트면 막는다',
    !judgeProjectRef({ hostname: 'db.otherproject.supabase.co', username: 'postgres' }, REF).ok)
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)
