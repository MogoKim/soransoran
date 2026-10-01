#!/usr/bin/env tsx
/**
 * Persona No-Go 하나 · C8 · C9 — **순수 반례** (DB · 네트워크 · LLM 0) · 2026-10-01 Phase 2B
 *
 *   ① 말버릇 열쇠 — 따옴표 · `류` 표기와 상관없이 댓글 Gate ⑦⑧ 가 잡는다
 *   ② 공통 금지(Pool §7-2) — 개인 목록이 빈 Persona 도 댓글 Gate 에 걸린다
 *   ③ 댓글 생성 프롬프트 · 카드 검증 · 복구가 같은 helper · 카드 파서 분류와 일치
 *   ⑦ (quality-v5) 글 쪽 — 생성 프롬프트 · 최종 초안 게이트 personaNoGo · 발행 배정 `hardFilter` 가 같은 helper.
 *      댓글 대상(남의 글)은 소재만 본다 · noGoTopics 회귀 0 · 정상 대화체 통과
 *   ④ C8 — 개인 말버릇 빈 칸은 계약 통과 · 소재 경계(noGoTopics)는 그대로 필수
 *   ⑤ C9 — 활동이 늘어도 지속 자격 유지 · 역할 쏠림은 회차에서 막힘 · 증명일 글쓴이 겹침은 FAIL
 *   ⑥ 가짜 활동 · 가짜 소재 · 임계 완화 0
 */
import { readFileSync } from 'node:fs'

import {
  anyNoGo, commonNoGoHits, COMMON_NO_GO_PHRASES, isNoGoExpressionItem, noGoExpressionKey, noGoHits, promptNoGoExpressions,
} from '../src/lib/persona-no-go'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { hardFilter, judgeLifeHistory, readPostRequirements, type PersonaForMatch } from '../src/lib/original-post-persona-match'
import { judgeDraftLife, DRAFT_GATE_VERSION } from '../src/lib/content-core/draft-life-gates'
import { QUALITY_CONTRACT_VERSION } from '../src/lib/quality-contract'
import { V2_DRAFT_PROMPT_VERSION } from '../src/lib/content-core/pipeline'
import { contractAxes, roleRoundVerdict, type ActivityHistory, type RoleHistory } from '../src/lib/persona-reserve'
import { planCommentDistribution, type PlannerPersona, type PlannerPost } from '../src/lib/persona-comment-planner'
import { PERSONA_LIFE_AXES, ROLE_SHARE_CAP, ACTIVITY_CAP_PER_DAY, CONSECUTIVE_EXPOSURE_CAP, PAIR_REPEAT_GAP } from '../src/lib/d100-persona-scale'
import { LIFE_CONTRACT_FIELDS } from '../src/lib/content-core/speaker'
import { judgeEvidenceForTarget, type EvidenceFactsFor } from '../src/lib/stage-evidence'
import { checkPersonaConsistency } from './lib/persona-gate-78.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const NEUTRAL = '요즘 밤에 자꾸 깨서 아침이 힘들어요. 다들 어떻게 지내세요?'

console.log('\n① 말버릇 열쇠 — 표기와 상관없이 잡는다')
{
  check('열쇠: `"우리 때는"` · `우리 때는` · `"요즘 애들" 류` → 따옴표 · 류 제거',
    noGoExpressionKey('"우리 때는"') === '우리 때는' && noGoExpressionKey('우리 때는') === '우리 때는'
    && noGoExpressionKey('"요즘 애들" 류') === '요즘 애들' && noGoExpressionKey('“요즘 애들”류') === '요즘 애들')
  const text = '우리 때는 그런 거 없었는데 요즘 애들은 다르더라고요'
  for (const stored of [['"우리 때는"'], ['우리 때는'], ['"요즘 애들" 류'], ['요즘 애들']]) {
    const c = checkPersonaConsistency(text, { noGoExpressions: stored })
    check(`🔴 댓글 Gate ⑦⑧ — 저장값 ${JSON.stringify(stored)} → NO_GO`, c.status === 'regenerate' && c.codes.includes('NO_GO'))
  }
  check('다른 말이면 걸리지 않는다', !anyNoGo(noGoHits(NEUTRAL, { noGoExpressions: ['"우리 때는"'] })))
}

console.log('\n② 공통 금지 — 개인 목록이 비어도 걸린다 · 남의 글에는 적용하지 않는다')
{
  const empty = { noGoTopics: [], noGoExpressions: [] }
  check('개인 말버릇 빈 Persona · 평범한 글 → 통과(댓글)', checkPersonaConsistency(NEUTRAL, empty).codes.length === 0)
  for (const [name, t] of [
    ['추천드립니다', '이 제품 정말 좋아요. 추천드립니다'],
    ['도움이 되셨으면 좋겠습니다', '제 경험이 도움이 되셨으면 좋겠습니다'],
    ['불릿', '이렇게 해 보세요\n- 물 많이 마시기\n- 일찍 자기'],
    ['번호', '1. 물 마시기\n2. 일찍 자기'],
    ['마크다운 제목', '## 정리\n잠이 중요해요'],
    ['굵은 글씨', '**중요** 잠을 자야 해요'],
    ['먼저/다음으로/마지막으로', '먼저 물을 드시고 다음으로 산책을 하세요'],
  ] as const) {
    check(`🔴 공통 금지 ${name} → 댓글 NO_GO`, checkPersonaConsistency(t, empty).codes.includes('NO_GO'))
  }
  check('`먼저` 하나는 일상 말 — 걸리지 않는다', commonNoGoHits('제가 먼저 말 걸었어요').length === 0)
}

console.log('\n③ 생성 프롬프트 · 파서 · 카드 검증이 같은 helper')
{
  const pr = promptNoGoExpressions([])
  check('🔴 개인 목록이 비어도 프롬프트에 공통 금지 문구가 실린다', COMMON_NO_GO_PHRASES.every((x) => pr.includes(x)))
  check('프롬프트는 열쇠로 싣는다(따옴표 · 류 제거 · 중복 0)', JSON.stringify(promptNoGoExpressions(['"우리 때는"', '우리 때는'])) === JSON.stringify(['우리 때는', ...COMMON_NO_GO_PHRASES]))
  const src = (f: string): string => readFileSync(f, 'utf-8')
  check('댓글 프롬프트가 `promptNoGoExpressions` 를 부른다', /promptNoGoExpressions\(persona\.noGoExpressions\)/.test(src('scripts/lib/persona-prompt.ts')))
  check('카드 검증 · 복구 · 댓글 Gate 가 같은 helper 를 부른다',
    /from '\.\/persona-no-go'/.test(src('src/lib/persona-card-verify.ts'))
    && /from '\.\/persona-no-go'/.test(src('src/lib/persona-contract-remediation.ts'))
    && /noGoHits\(/.test(src('scripts/lib/persona-gate-78.mts')))
  const doc = parsePoolDoc(src('docs/operations/2026-08-30-persona-pool-design.md'))
  check('🔴 카드 파서 분류 = helper 분류 (25장 전 항목 · 갈라지면 빨개진다)',
    doc.cards.every((c) => c.noGoExpressions.every(isNoGoExpressionItem) && c.noGoTopics.every((t) => !isNoGoExpressionItem(t))))
  check('🔴 다른 곳에서 `includes(v.trim())` 류 말버릇 판정을 따로 하지 않는다',
    !/noGoExpressions[^\n]*\.some\(\(v\) => text\.includes/.test(src('scripts/lib/persona-gate-78.mts')))
  check('카드 파서 — 따옴표 항목만 말버릇', isNoGoExpressionItem('"우리 때는"') && !isNoGoExpressionItem('손주 자랑 반복'))
}

console.log('\n④ C8 — 개인 말버릇은 없어도 되는 칸 · 소재 경계는 필수')
{
  const H0: ActivityHistory = { recentEvents: 0, roleCounts: {}, unresolvedRoleEvents: 0, consecutiveExposures: 0, postsSinceLastPairing: 'never', daysSinceActive: null, activityToday: 0 }
  const QUAL = { seedProblems: [], realMember: { accountCount: 0, providerId: null }, nameGate: 'pass' as const, seedComplete: true }
  const ALL = [...LIFE_CONTRACT_FIELDS] as string[]
  const v = (filled: string[], h: ActivityHistory = H0) => contractAxes({ code: 'P', card: { filledAxes: filled, ageBand: '50대 초반', voiceComments: 3 }, qualification: QUAL, history: h })
  check('🔴 개인 말버릇 빈 칸 → 계약 통과', v(ALL.filter((a) => a !== 'noGoExpressions')).valid)
  check('🔴 noGoTopics 빈 칸 → 여전히 lifeAxes 막힘', v(ALL.filter((a) => a !== 'noGoTopics')).blocked.lifeAxes !== undefined)
  check('생성 계약 지문 칸은 14 그대로(개인 말버릇 포함) · 계약 축은 13', LIFE_CONTRACT_FIELDS.length === 14
    && (LIFE_CONTRACT_FIELDS as readonly string[]).includes('noGoExpressions') && PERSONA_LIFE_AXES.length === 13)

  console.log('\n⑤ C9 — 쓰일수록 빠지지 않는다 · 회차 방어는 남는다')
  const busy = (n: number, roles: Record<string, number> = {}): ActivityHistory => ({ ...H0, recentEvents: n, roleCounts: roles, daysSinceActive: 0 })
  check('🔴 활동 0 · 5 · 30 · 200건 → 전부 contract-valid', [0, 5, 30, 200].every((n) => v(ALL, busy(n)).valid))
  const conc = v(ALL, busy(10, { empathy: 9, question: 1 }))
  check('🔴 역할 쏠림 0.9 → 계약 유효 · 이번 회차 막힘', conc.valid && conc.roundBlocked.includes('roleShare'))
  const unk = v(ALL, { ...busy(10, { empathy: 3 }), unresolvedRoleEvents: 2 })
  check('🔴 역할 모름 → 계약 유효 · 이번 회차 배정 안 함', unk.valid && unk.roundUnknown.includes('roleShare'))
  const ev = (authors: (string | null)[]): string[] => {
    const facts: EvidenceFactsFor<string> = {
      kstDate: '2026-10-02', stage: 'd3', decision: null, commentCapPerPost: 3,
      posts: authors.map((a, i) => ({ postId: `p${i}`, queueId: `q${i}`, publishedAtMs: 0, unattended: true, queueRows: 1, publishLogs: 1,
        authorPersonaId: a, decider: 'auto' as const, personaComments: [], release: 'STAMPED_ELIGIBLE' as const })),
      orphanPublishLogs: 0, unloggedPublishes: 0,
      audits: { rows: [], globalDefectYes: 0, globalOverdue: 0, globalRetryable: 0, globalMissingPosts: 0 },
    } as unknown as EvidenceFactsFor<string>
    return [...judgeEvidenceForTarget('2026-10-02', 'd3', 3, facts, null).codes]
  }
  check('🔴 증명일 자동 글 글쓴이 겹침 → PERSONA_REPEAT', ev(['a', 'a', 'b']).includes('PERSONA_REPEAT'))
  check('🔴 글쓴이를 모르는 자동 글 → PERSONA_REPEAT(fail-closed)', ev(['a', null, 'b']).includes('PERSONA_REPEAT'))
  check('서로 다른 글쓴이 → PERSONA_REPEAT 없음', !ev(['a', 'b', 'c']).includes('PERSONA_REPEAT'))

  console.log('\n⑤-2 C9 — 역할 쏠림은 **실제 댓글 회차(planner)** 에서 막힌다')
  const NOW = Date.UTC(2026, 9, 1, 3)
  const post = (id: string): PlannerPost => ({
    id, status: 'PUBLISHED', authorPersonaCode: null, memberComments: 0, personaComments: 0,
    personaCodesOnPost: [], openQueuePersonaCodes: [], publishedAtMs: NOW - 3_600_000,
    onHold: false, operatorWritten: false, title: '요즘 잠이 안 와요', body: '밤마다 깨요. 다들 어떠세요?',
  })
  const who = (code: string, recentRoles: RoleHistory | null): PlannerPersona => ({
    code, status: 'active', realMember: { accountCount: 0, providerId: null }, seedComplete: true,
    forbiddenReactionRoles: [], recentComments: 0, recentRoles, life: { noGoTopics: [], noGoExpressions: [] },
  })
  const plan = (personas: PlannerPersona[], roles = ['empathy']) => planCommentDistribution({
    posts: [post('x')], personas, reactionRoles: roles, limit: 1, nowMs: NOW, recentRoleCounts: {},
  })
  const A = (r: RoleHistory | null) => who('A', r)
  const B = who('B', { roleCounts: {}, unresolvedRoleEvents: 0 })
  const concRoles = { roleCounts: { empathy: 9, question: 1 }, unresolvedRoleEvents: 0 }
  check('🔴 A(empathy 9 · question 1) → contract-valid 유지', v(ALL, { ...busy(10), roleCounts: concRoles.roleCounts }).valid)
  check('🔴 A 다음 empathy 배정에서 제외 → B 가 대신 선택', plan([A(concRoles), B]).items[0]?.personaCode === 'B')
  check('A 는 쏠리지 않은 역할(question)은 맡을 수 있다', plan([A(concRoles), B], ['question']).items[0]?.personaCode === 'A')
  check('🔴 역할 이력 못 읽음(null) → 이번 회차 제외 · B 선택', plan([A(null), B]).items[0]?.personaCode === 'B')
  check('🔴 역할 모르는 댓글 있음 → 이번 회차 제외 · B 선택', plan([A({ roleCounts: { empathy: 1 }, unresolvedRoleEvents: 1 }), B]).items[0]?.personaCode === 'B')
  check('표본 5 미만(empathy 4) → 기존대로 허용(A 먼저)', plan([A({ roleCounts: { empathy: 4 }, unresolvedRoleEvents: 0 }), B]).items[0]?.personaCode === 'A')
  check('비율 0.5 이하(empathy 5 · question 5) → 허용(A 먼저)', plan([A({ roleCounts: { empathy: 5, question: 5 }, unresolvedRoleEvents: 0 }), B]).items[0]?.personaCode === 'A')
  const none = plan([A(concRoles)])
  check('🔴 대안 Persona 없음 → 배정 0 · 사유 PERSONA_ROLE_CONCENTRATED (유료 호출 전 skip)',
    none.items.length === 0 && none.skipped.some((x) => x.blocks.some((b) => b.code === 'PERSONA_ROLE_CONCENTRATED')))
  const unknownOnly = plan([A(null)])
  check('🔴 대안 없음 · 이력 모름 → 배정 0 · 사유 PERSONA_ROLE_HISTORY_UNKNOWN',
    unknownOnly.items.length === 0 && unknownOnly.skipped.some((x) => x.blocks.some((b) => b.code === 'PERSONA_ROLE_HISTORY_UNKNOWN')))
  check('정본 함수 하나 — 0.9 → empathy 만 막는다 · 0.5 → 0 · 4건 → 0',
    JSON.stringify(roleRoundVerdict(concRoles)) === JSON.stringify({ status: 'ok', evidence: 'n=10 · 0.90 > 0.5', blockedRoles: ['empathy'] })
    && (roleRoundVerdict({ roleCounts: { empathy: 5, question: 5 }, unresolvedRoleEvents: 0 }) as { blockedRoles: string[] }).blockedRoles.length === 0
    && (roleRoundVerdict({ roleCounts: { empathy: 4 }, unresolvedRoleEvents: 0 }) as { blockedRoles: string[] }).blockedRoles.length === 0)
  const twoPosts = planCommentDistribution({
    posts: [post('x'), post('y')], personas: [A(concRoles), B], reactionRoles: ['empathy', 'question'], limit: 2, nowMs: NOW, recentRoleCounts: {},
  })
  check('한 사람이 막혀도 회차는 계속 — 글 2개 모두 배정 · A 는 empathy 0',
    twoPosts.items.length === 2 && !twoPosts.items.some((i) => i.personaCode === 'A' && i.reactionRole === 'empathy'))
  const src = (f: string): string => readFileSync(f, 'utf-8')
  check('🔴 운영 경로 배선 — DB source 가 roleHistoryOf 로 만들고 · targets 가 planner 로 넘긴다',
    /roleHistoryOf\(/.test(src('scripts/lib/persona-comment-source-db.ts'))
    && /recentRoles: pe\.recentRoles/.test(src('scripts/lib/persona-comment-targets.ts'))
    && /roleRoundVerdict\(persona\.recentRoles\)/.test(src('src/lib/persona-comment-planner.ts')))
}

console.log('\n⑥ 가짜 활동 · 가짜 소재 · 임계 완화 0')
{
  check('🔴 문턱 불변 — 역할 0.5 · 하루 활동 6 · 연속 1 · 짝 간격 5',
    ROLE_SHARE_CAP === 0.5 && ACTIVITY_CAP_PER_DAY === 6 && CONSECUTIVE_EXPOSURE_CAP === 1 && PAIR_REPEAT_GAP === 5)
  const files = ['src/lib/persona-no-go.ts', 'src/lib/persona-reserve.ts', 'src/lib/d100-persona-scale.ts', 'src/lib/stage-evidence.ts']
    .map((f) => readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*\*)/.test(l)).join('\n')).join('\n')
  check('🔴 소재 분류표 · 소재 라벨 쓰기 0', !/TOPIC_TAXONOMY|topicTags\s*:|category\s*:\s*['"]/.test(files))
  check('🔴 활동 행 생성 0', !/\.(post|comment|personaApprovalQueue|personaActivityLog)\.(create|createMany|upsert)/.test(files))
  check('🔴 옛 소재 축 삭제 — topicShareOf · TOPIC_SHARE_CAP · topicConcentrated 0', !/topicShareOf|TOPIC_SHARE_CAP|topicConcentrated/.test(files))
}

console.log('\n⑦ (quality-v5) 글 쪽 — 프롬프트 · 최종 초안 게이트 · 발행 배정이 같은 helper')
{
  const card = (expr: string[]) => ({ childrenCount: 0, childrenAgeBands: [], maritalStatus: '기혼', noGoExpressions: expr })
  const gate = (body: string, expr: string[] = []) => judgeDraftLife({
    title: '요즘 잠이 안 와요', body, plan: null, card: card(expr), context: { at: new Date('2026-10-01T03:00:00Z'), source: null },
  }).failures.filter((f) => f.code === 'personaNoGo')
  const NORMAL = '요즘 밤에 자꾸 깨서 아침이 힘들어요. 다들 어떻게 지내세요? 저만 이런 건지 궁금하네요.'
  check('🔴 정상 대화체 글 → personaNoGo 0', gate(NORMAL, ['"우리 때는"']).length === 0)
  for (const stored of [['"우리 때는"'], ['우리 때는'], ['"우리 때는" 류']]) {
    check(`🔴 초안 게이트 — 개인 말버릇 저장값 ${JSON.stringify(stored)} → personaNoGo`, gate(`${NORMAL} 우리 때는 안 그랬는데요.`, stored).length === 1)
  }
  check('🔴 초안 게이트 — 공통 금지 문구 → personaNoGo (개인 목록 빈 카드)', gate(`${NORMAL} 이 방법 추천드립니다`).length === 1)
  check('🔴 초안 게이트 — 불릿 → personaNoGo', gate(`${NORMAL}\n- 물 마시기\n- 일찍 자기`).length === 1)
  check('초안 게이트 — 카드가 없어도 공통 금지는 본다', judgeDraftLife({
    title: 't', body: '1. 물 마시기\n2. 일찍 자기', plan: null, card: null, context: { at: new Date(), source: null },
  }).failures.some((f) => f.code === 'personaNoGo'))
  const P = (expr: string[], topics: string[] = []): PersonaForMatch => ({
    code: 'P', status: 'active', providerId: null, accountCount: 0, noGoTopics: topics, noGoExpressions: expr,
    postsThisWeek: 0, daysSinceLastPost: null,
  })
  const hf = (p: PersonaForMatch, body: string) => hardFilter(p, readPostRequirements('t', body), 't', body).map((b) => b.code)
  check('🔴 발행 배정 — 따옴표 · 류 저장값 → NOGO_EXPRESSION', hf(P(['"요즘 애들" 류']), '요즘 애들은 다르더라고요').includes('NOGO_EXPRESSION'))
  check('🔴 발행 배정 — 공통 금지 → NOGO_COMMON', hf(P([]), '도움이 되셨으면 좋겠습니다').includes('NOGO_COMMON'))
  check('발행 배정 — 정상 대화체 → NoGo 0', !hf(P(['"우리 때는"']), NORMAL).some((c) => c.startsWith('NOGO')))
  check('🔴 noGoTopics 회귀 0 — 소재는 그대로 NOGO_TOPIC', hf(P([], ['무릎']), '무릎이 아파요').includes('NOGO_TOPIC'))
  check('🔴 댓글 대상(남의 글)은 소재만 — 불릿 · 추천드립니다 · 말버릇은 막지 않는다',
    judgeLifeHistory(P(['"우리 때는"']), readPostRequirements('t', '- 추천드립니다 우리 때는'), 't', '- 추천드립니다 우리 때는').length === 0)
  const src = (f: string): string => readFileSync(f, 'utf-8')
  check('🔴 글 생성 프롬프트 · 카드 파서 · 초안 게이트 · 배정 Gate 가 같은 helper',
    /promptNoGoExpressions\(life\.noGoExpressions\)/.test(src('scripts/lib/content-core-prompts.mts'))
    && !/life\.noGoExpressions\.length > 0/.test(src('scripts/lib/content-core-prompts.mts'))
    && /isNoGoExpressionItem\(item\)/.test(src('src/lib/persona-pool-card.ts'))
    && /noGoHits\(/.test(src('src/lib/content-core/draft-life-gates.ts'))
    && /noGoHits\(/.test(src('src/lib/original-post-persona-match.ts')))
  check('품질 계약 v6 · 초안 게이트 v6 · 초안 프롬프트 p9 (No-Go 판정은 v5 그대로)', QUALITY_CONTRACT_VERSION === 'quality-v6'
    && DRAFT_GATE_VERSION === 'draft-gates-v6' && V2_DRAFT_PROMPT_VERSION === 'v2-draft-p9')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail — DB 0 · 네트워크 0\n`)
process.exit(fail === 0 ? 0 : 1)
