#!/usr/bin/env tsx
/**
 * 🔴 **댓글 꼴 · 본보기 추첨 · 역할 몫 · 지시문 배선 검사** (2026-11-21 댓글 새 판)
 *
 *   npm run persona:comment-form-check
 *
 * ① `commentFormOf` 가 지어낸 댓글 꼴(한 줄 · 두 줄 · ㅋㅋ · ㅠㅠ · ^^ · 말줄임 · 물음 · 느낌표 · 물결 · 부호 없음)을 잰 값
 * ② 같은 (글 · 순번) → 같은 본보기 · 자산 행 순서와 무관 · 경험 자리는 41자 이상 · 빈 풀은 null
 * ③ 1,000 자리 추첨의 길이 분포가 풀의 분포와 ±3%p (지어낸 풀 · 정본 자산이 있으면 실제 풀도)
 * ④ 대화 계획 10,000편의 모양이 실제 몫 ±2%p · planner 가 몫에 비해 덜 쓰인 역할부터 고른다
 * ⑤ 지시문 — 꼴 절이 말버릇 바로 아래에 있고, 지운 문구가 없다 · 꼴 값은 userPayload JSON 으로 · 본보기가 비면 막는다
 * ⑥ 본보기 본문이 저장 레코드(`toCandidateRecord`)와 생성 경로 로그에 들어가지 않는다
 * 🔴 네트워크 0 · provider 0 · DB 0. 실제 함수를 돌려 값을 본다. 🔴 fixture 문장은 전부 지어낸 것이다.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  commentFormOf, FORM_EXAMPLE_MAX_CHARS, FORM_EXAMPLE_MIN_CHARS, FORM_EXPERIENCE_MIN_CHARS, pickFormExample, type CommentForm,
} from '../src/lib/persona-comment-form'
import { COMMENT_REACTION_ROLES, REAL_REACTION_SHARE, type ReactionType } from '../src/lib/persona-reaction-roles'
import { threadPlanOf } from '../src/lib/persona-thread-plan'
import { planCommentDistribution, type PlannerPersona, type PlannerPost } from '../src/lib/persona-comment-planner'
import { postPersonaMarksOf } from '../src/lib/persona-comment-input'
import {
  ALLOWED_RECORD_KEYS, assertNoStoredSource, buildPrompt, toCandidateRecord, type PromptPersona,
} from './lib/persona-prompt'
import { commentFormPool, loadCanonAsset } from './lib/persona-reference-store.mjs'
import { classifyReaction } from './lib/voice-comment-signals.mjs'
import { judgeReferenceBundle } from '../src/lib/persona-voice-reference'

const here = dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : ` — ${extra}`}`) }
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const len = (t: string): number => [...t].length

console.log('\n══ 댓글 꼴 · 본보기 · 역할 몫 · 지시문 (네트워크 0 · provider 0 · DB 0) ══')

// ─────────────────────────────────────────────────────────
console.log('\n① commentFormOf — 지어낸 댓글의 꼴')
// ─────────────────────────────────────────────────────────
{
  const cases: { body: string; want: CommentForm }[] = [
    { body: '저도요', want: { 글자수: 3, 줄수: 1, 끝: '저도요', 끝부호: '없음', 물음표수: 0, 말줄임수: 0, 이모티콘: false } },
    { body: '그맘 알것같네요.', want: { 글자수: 9, 줄수: 1, 끝: '같네요', 끝부호: '.', 물음표수: 0, 말줄임수: 0, 이모티콘: false } },
    { body: '진짜 웃기네요 ㅋㅋㅋ', want: { 글자수: 11, 줄수: 1, 끝: '기네요', 끝부호: 'ㅋㅎ류', 물음표수: 0, 말줄임수: 0, 이모티콘: true } },
    { body: '너무 속상하시겠어요ㅠㅠ', want: { 글자수: 12, 줄수: 1, 끝: '겠어요', 끝부호: 'ㅠㅜ류', 물음표수: 0, 말줄임수: 0, 이모티콘: true } },
    { body: '병원은 가보셨어요?', want: { 글자수: 10, 줄수: 1, 끝: '셨어요', 끝부호: '?', 물음표수: 1, 말줄임수: 0, 이모티콘: false } },
    { body: '그러게요...', want: { 글자수: 7, 줄수: 1, 끝: '러게요', 끝부호: '..', 물음표수: 0, 말줄임수: 1, 이모티콘: false } },
    { body: '와 대박이다!!', want: { 글자수: 8, 줄수: 1, 끝: '박이다', 끝부호: '!', 물음표수: 0, 말줄임수: 0, 이모티콘: false } },
    { body: '저도 그랬어요~', want: { 글자수: 8, 줄수: 1, 끝: '랬어요', 끝부호: '~', 물음표수: 0, 말줄임수: 0, 이모티콘: false } },
    { body: '아침에 일어났는데\n몸이 무거워서 그냥 누워있음', want: { 글자수: 24, 줄수: 2, 끝: '워있음', 끝부호: '없음', 물음표수: 0, 말줄임수: 0, 이모티콘: false } },
    { body: '좋은 하루 되세요^^', want: { 글자수: 11, 줄수: 1, 끝: '되세요', 끝부호: 'ㅋㅎ류', 물음표수: 0, 말줄임수: 0, 이모티콘: true } },
    { body: 'ㅋㅋㅋㅋ', want: { 글자수: 4, 줄수: 1, 끝: '', 끝부호: 'ㅋㅎ류', 물음표수: 0, 말줄임수: 0, 이모티콘: true } },
    { body: '네', want: { 글자수: 1, 줄수: 1, 끝: '네', 끝부호: '없음', 물음표수: 0, 말줄임수: 0, 이모티콘: false } },
  ]
  for (const c of cases) {
    const got = commentFormOf(c.body)
    check(`"${c.body.replace('\n', '⏎')}"`, same(got, c.want), `기대 ${JSON.stringify(c.want)} · 지금 ${JSON.stringify(got)}`)
  }
  check('같은 댓글이면 같은 값(순수)', same(commentFormOf('그러게요...'), commentFormOf('그러게요...')))
}

// ─────────────────────────────────────────────────────────
console.log('\n② pickFormExample — 결정적 · 순서 무관 · 경험 자리 · 빈 풀')
// ─────────────────────────────────────────────────────────
/** 🔴 지어낸 풀 — 길이가 고르게 퍼진 400개(5~160자) */
const SYLL = '가나다라마바사아자차카타파하'
const fakePool = Array.from({ length: 400 }, (_, i) => {
  const n = FORM_EXAMPLE_MIN_CHARS + ((i * 37) % (FORM_EXAMPLE_MAX_CHARS - FORM_EXAMPLE_MIN_CHARS + 1))
  return `${i}번 ${Array.from({ length: n }, (_, k) => SYLL[(i + k) % SYLL.length]).join('')}`.slice(0, n)
})
{
  const a = pickFormExample({ pool: fakePool, postId: 'post-a', ordinal: 3, experience: false })
  const b = pickFormExample({ pool: [...fakePool].reverse(), postId: 'post-a', ordinal: 3, experience: false })
  check('같은 (글 · 순번) → 같은 본보기 — 풀의 행 순서가 뒤집혀도 같다', a !== null && same(a, b), `${a?.본보기} · ${b?.본보기}`)
  check('본보기의 꼴 = commentFormOf(본보기)', a !== null && same(a.꼴, commentFormOf(a.본보기)))
  const ordinals = new Set(Array.from({ length: 8 }, (_, i) => pickFormExample({ pool: fakePool, postId: 'post-a', ordinal: i + 1, experience: false })?.본보기))
  check('같은 글의 자리마다 본보기가 갈린다(8자리 중 7종 이상)', ordinals.size >= 7, String(ordinals.size))
  const exp = Array.from({ length: 200 }, (_, i) => pickFormExample({ pool: fakePool, postId: `exp-${i}`, ordinal: 2, experience: true }))
  check(`경험으로 답하는 자리는 ${FORM_EXPERIENCE_MIN_CHARS}자 이상에서만 뽑는다`, exp.every((x) => x !== null && len(x.본보기) >= FORM_EXPERIENCE_MIN_CHARS))
  check('빈 풀 → null · 경험 자리에 쓸 긴 본보기가 없으면 null',
    pickFormExample({ pool: [], postId: 'p', ordinal: 1, experience: false }) === null
    && pickFormExample({ pool: ['짧은 댓글이에요'], postId: 'p', ordinal: 1, experience: true }) === null)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 길이 분포 — 1,000 자리 추첨이 풀의 분포 ±3%p')
// ─────────────────────────────────────────────────────────
const BINS: readonly (readonly [number, number])[] = [[5, 20], [21, 40], [41, 80], [81, 160]]
const shareIn = (xs: readonly string[], [lo, hi]: readonly [number, number]): number => xs.filter((t) => len(t) >= lo && len(t) <= hi).length / xs.length
const drawCheck = (name: string, pool: readonly string[]): void => {
  const draws = Array.from({ length: 1000 }, (_, i) => pickFormExample({ pool, postId: `len-${i}`, ordinal: 1 + (i % 6), experience: false })!.본보기)
  const off = BINS.filter((b) => Math.abs(shareIn(draws, b) - shareIn(pool, b)) > 0.03)
  check(`${name} — 구간 4개(≤20 · 21~40 · 41~80 · 81~160) 모두 ±3%p`, off.length === 0,
    BINS.map((b) => `${b[0]}-${b[1]} 추첨 ${(shareIn(draws, b) * 100).toFixed(1)}% · 풀 ${(shareIn(pool, b) * 100).toFixed(1)}%`).join(' / '))
}
drawCheck('지어낸 풀', fakePool)
{
  const canon = loadCanonAsset()
  if (!canon.ok) {
    console.log(`  🟡 정본 자산 없음(${canon.code}) — 실제 풀 분포는 자산이 있는 기계에서 본다`)
  } else {
    const pool = commentFormPool(canon.rows)
    check(`실제 풀 — 정본 ${canon.rows.length}건에서 300건 이상 남는다(${pool.length})`, pool.length >= 300)
    check('실제 풀 — 5~160자뿐이다', pool.every((t) => len(t) >= FORM_EXAMPLE_MIN_CHARS && len(t) <= FORM_EXAMPLE_MAX_CHARS))
    drawCheck('실제 풀', pool)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 역할 몫 — 대화 계획 10,000편 · planner 순서')
// ─────────────────────────────────────────────────────────
{
  const ALLOWED: Readonly<Record<string, readonly ReactionType[]>> = {
    post: ['other', 'empathy', 'question', 'experience'], author: ['other', 'experience', 'question'], reply: ['other', 'empathy', 'question'],
  }
  const slots = Array.from({ length: 10_000 }, (_, i) => threadPlanOf(`share-${i}`)).flatMap((p) => p.slots)
  for (const [kind, roles] of Object.entries(ALLOWED)) {
    const xs = slots.filter((s) => s.kind === kind)
    const total = roles.reduce((a, r) => a + (REAL_REACTION_SHARE[r] ?? 0), 0)
    const rows = roles.map((r) => ({ r, got: xs.filter((s) => s.shape === r).length / xs.length, want: (REAL_REACTION_SHARE[r] ?? 0) / total }))
    check(`${kind} 자리 ${xs.length}개 — 허용 역할 안에서 실제 몫 ±2%p`, rows.every((x) => Math.abs(x.got - x.want) <= 0.02)
      && xs.every((s) => roles.includes(s.shape)),
    rows.map((x) => `${x.r} ${(x.got * 100).toFixed(1)}%/${(x.want * 100).toFixed(1)}%`).join(' · '))
  }
  // 🔴 몫은 실측이다 — 정본 자산이 있으면 같은 분류기로 다시 재서 대조한다(배정하지 않는 rebuttal · information 몫은 없다)
  const canon = loadCanonAsset()
  if (!canon.ok) {
    console.log(`  🟡 정본 자산 없음(${canon.code}) — 몫 재측정은 자산이 있는 기계에서 본다`)
  } else {
    const measured = (role: ReactionType): number => canon.rows.filter((r) => classifyReaction(r.text) === role).length / canon.rows.length
    const off = (['other', 'question', 'empathy', 'experience'] as const)
      .filter((r) => Math.abs(measured(r) - (REAL_REACTION_SHARE[r] ?? 0)) > 0.001)
    check(`몫 = 정본 자산 ${canon.rows.length}건의 classifyReaction 실측(±0.1%p)`, off.length === 0,
      off.map((r) => `${r} 실측 ${(measured(r) * 100).toFixed(2)}% · 몫 ${((REAL_REACTION_SHARE[r] ?? 0) * 100).toFixed(1)}%`).join(' / '))
  }

  const NOW = Date.parse('2026-11-21T12:00:00+09:00')
  const post: PlannerPost = {
    id: 'p1', status: 'PUBLISHED', authorPersonaCode: null, memberComments: 0, personaComments: 0,
    personaCodesOnPost: [], openQueuePersonaCodes: [], publishedAtMs: NOW - 3_600_000, onHold: false, operatorWritten: false,
    title: '지어낸 글 제목', body: '지어낸 글 본문이에요',
  }
  const persona: PlannerPersona = {
    code: 'P01', status: 'active', realMember: { accountCount: 0, providerId: null }, seedComplete: true,
    forbiddenReactionRoles: [], recentComments: 0, recentRoles: { roleCounts: {}, unresolvedRoleEvents: 0 },
    life: { noGoTopics: [], noGoExpressions: [] },
  }
  const firstRole = (recentRoleCounts: Record<string, number>, roles: readonly string[] = COMMENT_REACTION_ROLES): string | undefined =>
    planCommentDistribution({ posts: [post], personas: [persona], reactionRoles: roles, limit: 1, nowMs: NOW, recentRoleCounts }).items[0]?.reactionRole
  // other 81 · question 11 · empathy 6 · experience 0 → 쓴 수 ÷ 몫: other 0.996 · question 0.957 · empathy 1.13 · experience 0 → experience
  check('planner — 몫에 비해 가장 덜 쓰인 역할부터(쓴 수 0 인 experience)', firstRole({ other: 81, question: 11, empathy: 6 }) === 'experience',
    String(firstRole({ other: 81, question: 11, empathy: 6 })))
  // other 70 · question 11 · empathy 6 · experience 1 → other 0.861 · question 0.957 · empathy 1.13 · experience 1.43 → other
  check('planner — 고르게 돌리지 않는다(적게 쓰인 empathy 가 아니라 몫 대비 모자란 other)', firstRole({ other: 70, question: 11, empathy: 6, experience: 1 }) === 'other',
    String(firstRole({ other: 70, question: 11, empathy: 6, experience: 1 })))
  check('planner — 쓴 수가 모두 0 이면 몫이 큰 other 부터', firstRole({}) === 'other', String(firstRole({})))
  check('planner — 몫 없는 역할(rebuttal)은 맨 뒤', firstRole({ other: 900 }, ['rebuttal', 'other']) === 'other', String(firstRole({ other: 900 }, ['rebuttal', 'other'])))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 지시문 — 꼴 절 · 지운 문구 · 꼴 값의 자리 · 본보기 없으면 막음')
// ─────────────────────────────────────────────────────────
const PERSONA: PromptPersona = { code: 'P01', ageBand: '50대 초반', region: '수도권', lifeStage: '갱년기', identity: {}, noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [] }
const POST = { title: '요즘 아침마다 손이 붓네요', content: '일어나면 손가락이 뻣뻣해요. 다들 그러세요?', boardLabel: 'MENOPAUSE' }
const REF = (() => {
  const v = judgeReferenceBundle({ personaCode: 'P01', texts: ['그러게 말이에요', '읽다 보니 남 일 같지 않네', '어머 진짜요?'] })
  if (!v.ok) throw new Error('시험용 말버릇 묶음이 계약을 못 지킨다')
  return v.bundle
})()
const FORM_TEXT = '저희 동네도 요즘 다 그래요ㅋㅋ'
const FORM = { 꼴: commentFormOf(FORM_TEXT), 본보기: FORM_TEXT }
/** 🔴 v 꼴 판에서 지운 지시 — 되살아나면 경험담 · 질문 · 감상문 · 반듯한 끝말로 다시 수렴한다 */
const DELETED = [
  '내 경우 한 토막', '내 경우를 한 토막', '궁금한 것을 물으면', '궁금한 것 하나를 묻는 것도', '~더라고요',
  '저는 이렇게 했어요', '공감하거나 묻거나', '한 조각도 그대로 쓰지 않습니다', '내 안에 남은 느낌만',
  '## 말투 설정', '상황별 변주', '## 길이', '맞출 필요는 없습니다', '문장 길이 · 호흡', '**한 줄**', '한두 문장', '서너 문장',
]
{
  const seat = { ordinal: 2, postPersonaMarks: { openers: ['어머'], endings: ['네요'] }, selfFacts: ['자녀 2명 (성인)'], menopauseExperienced: true, spouseStrain: false, reply: true }
  const variants: { name: string; extra: Record<string, unknown> }[] = [
    { name: '첫 댓글 · 근거 없음', extra: {} },
    { name: '첫 댓글 · 근거 있음', extra: { grounding: '작년 봄부터 아침에 손이 붓는다' } },
    { name: '추가 댓글 · 답글', extra: { seat: { ...seat, ownPost: false } } },
    { name: '추가 댓글 · 글쓴이 답글', extra: { seat: { ...seat, ownPost: true } } },
    { name: '추가 댓글 · 글에 답(부부 불화 근거 없음)', extra: { seat: { ...seat, reply: false, ownPost: false } } },
  ]
  for (const v of variants) {
    for (const reactionType of ['other', 'experience', 'question'] as const) {
      const p = buildPrompt({ persona: PERSONA, post: POST, reactionType, reference: REF, form: FORM, ...v.extra } as never)
      if (!p.ok) { check(`${v.name}/${reactionType}: 프롬프트가 선다`, false, JSON.stringify(p.blocks)); continue }
      const sys = p.prompt.systemPrompt
      const back = DELETED.filter((d) => sys.includes(d))
      check(`${v.name}/${reactionType}: 지운 문구가 하나도 없다`, back.length === 0, back.join(' | '))
      const at = (h: string): number => sys.indexOf(h)
      check(`${v.name}/${reactionType}: 꼴 절이 말버릇 바로 아래 · 반응 · 규칙보다 앞`,
        at('## 당신의 평소 말버릇 (실제 댓글)') >= 0 && at('## 당신의 평소 말버릇 (실제 댓글)') < at('## 🔴 이번 댓글의 꼴')
        && at('## 🔴 이번 댓글의 꼴') < at('## 이번에 쓸 반응') && at('## 🔴 이번 댓글의 꼴') < at('## 절대 하지 않는 것'))
      const tail = p.prompt.userPayload.split('\n').at(-1) ?? ''
      check(`${v.name}/${reactionType}: 꼴 · 본보기가 userPayload 끝의 JSON 으로 실린다`,
        p.prompt.userPayload.includes('\n[꼴 · 본보기]\n') && same(JSON.parse(tail), { 꼴: FORM.꼴, 본보기: FORM_TEXT }))
      check(`${v.name}/${reactionType}: 본보기 본문은 system 에 없다(값은 요청 끝 JSON 하나)`, !sys.includes(FORM_TEXT))
    }
  }
  const blocked = buildPrompt({ persona: PERSONA, post: POST, reactionType: 'other', reference: REF })
  check('🔴 근거를 강제하는 경로에서 본보기가 없으면 FORM_MISSING 으로 막는다', !blocked.ok && blocked.blocks.some((b) => b.code === 'FORM_MISSING'))
  const marks = postPersonaMarksOf(['어머 저도 그래요', '  ', '저는 괜찮더라구요ㅋㅋ', '어머 진짜요?'])
  check('같은 글 앞 Persona 댓글 표지 — 첫 어절 · 말끝 3자만, 중복 없이', same(marks, { openers: ['어머', '저는'], endings: ['그래요', '라구요', '진짜요'] }), JSON.stringify(marks))
  check('같은 글 앞 Persona 댓글 표지 — 최근 8개까지', postPersonaMarksOf(Array.from({ length: 12 }, (_, i) => `시작${i} 끝말${i}이에요`)).openers.length === 8)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 본보기 본문은 저장되지 않는다')
// ─────────────────────────────────────────────────────────
{
  check('저장 레코드 키에 꼴 · 본보기 자리가 없다', !ALLOWED_RECORD_KEYS.some((k) => ['꼴', '본보기', 'form', 'formExample'].includes(k)), ALLOWED_RECORD_KEYS.join(','))
  const rec = toCandidateRecord({ personaCode: 'P01', text: '우리 동네는 아직 괜찮던데요', sourcePostId: 'post-1' })
  let threw = false
  try { assertNoStoredSource([rec], [FORM_TEXT]) } catch { threw = true }
  check('레코드는 personaCode · text · sourcePostId 뿐이고 본보기 조각이 없다', !threw && same(Object.keys(rec), ['personaCode', 'text', 'sourcePostId']))
  const forged = { ...rec, 본보기: FORM_TEXT } as unknown as typeof rec
  let caught = false
  try { assertNoStoredSource([forged], []) } catch { caught = true }
  check('🔴 본보기를 레코드에 얹으면 저장 직전 방어가 막는다', caught)
  // 🔴 생성 · 적재 · 장부 경로가 꼴 값을 찍거나 넘기지 않는다 — 꼴은 bridge → buildPrompt → 요청에서만 산다
  const paths = ['persona-comment-loop.mts', 'lib/persona-comment-followup-run.mts', 'lib/persona-comment-pipeline.ts', 'lib/supply-llm-call.mts', 'lib/persona-candidate-write.ts', 'persona-comment-queue.mts']
  const FORM_VALUE = /pickFormExample|\.본보기|\.꼴|\.form\b/
  const leaks = paths.filter((rel) => {
    let src = ''
    try { src = readFileSync(join(here, rel), 'utf-8') } catch { src = readFileSync(join(here, '../src/lib', rel.replace('lib/', '')), 'utf-8') }
    return FORM_VALUE.test(src)
  })
  check('🔴 생성 · 적재 · 장부 경로 소스에 본보기 값을 다루는 곳이 없다', leaks.length === 0, leaks.join(','))
  // 🔴 그 정규식이 실제로 무언가를 잡는지 — 꼴을 다루는 단 두 곳(bridge · prompt)에서는 걸려야 한다
  check('  (대조) 꼴을 다루는 bridge · prompt 소스에서는 같은 정규식이 걸린다',
    FORM_VALUE.test(readFileSync(join(here, 'lib/persona-comment-bridge.ts'), 'utf-8'))
    && FORM_VALUE.test(readFileSync(join(here, 'lib/persona-prompt.ts'), 'utf-8')))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
