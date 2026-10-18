#!/usr/bin/env tsx
/**
 * quality-v12 창의 계약 변이 검사 (2026-10-18)
 *
 * CREATIVITY_BLOCK_CLASS 8-클래스를 반례·변이로 증명한다.
 * 🔴 문법·로드 오류를 잡힌 변이로 세지 않는다 — 실제 판정 함수를 직접 호출한다.
 * 🔴 DB 0 · 네트워크 0 · provider 0 · LLM 0.
 *
 * 증명 구조:
 *   반례 — ALLOW 클래스가 하드 차단되지 않음을 확인
 *   대조 — BLOCK 클래스가 하드 차단됨을 확인
 *   변이 — 저위험 텍스트에 고위험 축을 추가하면 차단을 켬(dead-gate 없음 증명)
 */
import {
  judgeDraftLife, judgeDraftGates,
  CREATIVITY_BLOCK_CLASS, DRAFT_GATE_VERSION,
  type DraftGateInput, type DraftGateCard, type DraftGatePlan, type DraftGateContext,
} from '../src/lib/content-core/draft-life-gates'
import { V2_DRAFT_PROMPT_VERSION, V2_REVIEW_PROMPT_VERSION } from '../src/lib/content-core/pipeline'
import { buildVoiceEvidence } from '../src/lib/content-core/voice-evidence'
import { buildV2DraftSystemPrompt, buildV2ReviewSystemPrompt } from './lib/content-core-prompts.mjs'
import { P13 } from './lib/draft-gate-fixtures.mjs'

// ─── 공유 픽스처 ───────────────────────────────────────────
const NOW = new Date('2026-10-18T09:00:00+09:00')
/** 원천·시각 중립 컨텍스트 — 시점·외부 커뮤니티 축이 개입하지 않는다 */
const CTX: DraftGateContext = {
  at: NOW,
  source: { title: '', body: '', site: 'navercafe:test', postedAt: NOW, capturedAt: NOW, imageCount: null },
}
const CARD_BASE: DraftGateCard = { childrenCount: 1, childrenAgeBands: ['중고등'], maritalStatus: '기혼' }
/** selfBasis=null — 1인칭 허가 없는 자리 */
const NO_PLAN: DraftGatePlan = { selfBasis: null, warrants: [] }

const inp = (
  title: string, body: string, plan: DraftGatePlan, card: DraftGateCard | null = CARD_BASE,
): DraftGateInput => ({ title, body, plan, card, context: CTX })

const hardCodes = (i: DraftGateInput): string[] => judgeDraftGates(i).map((f) => f.code)
const softCodes = (i: DraftGateInput): string[] => judgeDraftLife(i).reviews.map((r) => r.code)

// ─── 카운터 ────────────────────────────────────────────────
let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) }
  else { fail++; console.log(`  🔴 FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log(`\n══ quality-v12 창의 계약 변이 · gate ${DRAFT_GATE_VERSION} ══\n`)

// ══════════════════════════════════════════════════════════
// ALLOW 클래스
// ══════════════════════════════════════════════════════════

console.log(`── ALLOW: ${CREATIVITY_BLOCK_CLASS.SAFE_RHETORICAL} ──`)
// 생활사 축 낱말 없음 — 판정할 자리가 없어 통과
{
  const i1 = inp('공감이 됩니다', '참 어렵죠. 다들 비슷하게 느끼시지 않나요?', NO_PLAN, null)
  check('순수 공감·독자 질문 — 하드 차단 없음', hardCodes(i1).length === 0, hardCodes(i1).join(','))

  const i2 = inp('이런 경험 있으신가요', '왠지 마음이 짠해지더라고요. 이런 감정이 드시지 않나요?', NO_PLAN, null)
  check('감정 표현+질문 — 하드 차단 없음', hardCodes(i2).length === 0, hardCodes(i2).join(','))
}

console.log(`\n── ALLOW: ${CREATIVITY_BLOCK_CLASS.PERSONA_SUPPORTED} ──`)
// lifeFacts + warrants 가 자녀 언급을 뒷받침 → 통과
{
  const plan: DraftGatePlan = { selfBasis: 'lifeFacts', warrants: [{ fact: 'children', evidenceText: '우리 아이 중학교 들어가고' }] }
  const i1 = inp('우리 아이 요즘', '우리 아이 중학교 들어가고 대화가 많이 줄었어요.', plan)
  check('카드 지원 자녀 서술(lifeFacts) — 하드 차단 없음', hardCodes(i1).length === 0, hardCodes(i1).join(','))
}

console.log(`\n── ALLOW (v12): ${CREATIVITY_BLOCK_CLASS.LOW_RISK_TEXTURE} ──`)
// work 축: selfBasis=null 이어도 저위험 일상 결은 자동 READY hold 없이 통과
{
  const i1 = inp('직장이라는 공간', '제 직장에서도 비슷한 일이 있었어요.', NO_PLAN)
  const h1 = hardCodes(i1)
  check('[work] 제 직장 selfBasis=null — 하드 차단 없음(v12)', h1.length === 0, h1.join(','))
  const s1 = softCodes(i1)
  check('[work] 사람 검토도 없음 — 자동 READY 후보 유지', !s1.includes('unwarrantedSelfClaim'), s1.join(','))
}

// parents 축은 건강·돌봄·생애 사실로 번지므로 고위험 유지
{
  const i1 = inp('부모님 걱정', '저희 부모님은 올해 은퇴하셨어요.', NO_PLAN, null)
  const h1 = hardCodes(i1)
  check('[parents] 저희 부모님 selfBasis=null — unwarrantedSelfClaim 차단 유지', h1.includes('unwarrantedSelfClaim'), h1.join(','))
}

// 가족 유사 연결 표현 ("저희 집도 그래요") → v12 에서 즉시 차단 없음
{
  const i1 = inp('공감이요', '저희 집도 그런 상황이라 정말 공감이 됐어요.', NO_PLAN)
  const h1 = hardCodes(i1)
  check('[family-like] 저희 집도 그런 — 하드 차단 없음(v12)', h1.length === 0, h1.join(','))
  check('[family-like] 구체 사실이 없으면 사람 검토도 없음', !softCodes(i1).includes('unwarrantedSelfClaim'), softCodes(i1).join(','))
}

console.log('\n── 실제 생성·검수 프롬프트 경계 ──')
{
  const plan = {
    decision: 'ok', personaCode: 'P13', stance: 'REFLECTION', selfBasis: null,
    warrants: [], universalReason: '보편적인 이야기', protectedFacts: [], speakerRelative: [],
    closingIntent: 'ask', contentRoles: ['conversationSpark'], reason: '', rejection: null,
    planVersion: 'speaker-plan-p6',
  } as never
  const voice = buildVoiceEvidence({
    personaCode: 'P13', voiceTokens: ['존댓말'], samples: [], bundleDigest: 'b', sourceDigest: 's',
  })
  const draftPrompt = buildV2DraftSystemPrompt({ plan, voice, life: P13, mappings: [] })
  const reviewPrompt = buildV2ReviewSystemPrompt({ plan, voice, life: P13 })
  check('초안 프롬프트 판 p13', V2_DRAFT_PROMPT_VERSION === 'v2-draft-p13')
  check('검수 프롬프트 판 p9', V2_REVIEW_PROMPT_VERSION === 'v2-review-p9')
  check('초안이 감상·질문·비유·일반 관찰을 허용',
    draftPrompt.includes('감상 · 질문 · 비유 · 연결 문장 · 일반적인 관찰'))
  check('초안이 고위험 생활 사실과 제3자 사건·결과를 금지',
    draftPrompt.includes('배우자 · 자녀 · 부모 · 건강 · 치료 · 돈')
    && draftPrompt.includes('제3자의 사건 · 날짜 · 직접 대사 · 결과'))
  check('검수가 사소한 생략·재구성을 경고하지 않음',
    reviewPrompt.includes('사소한 세부 · 문장 순서 · 표현')
    && reviewPrompt.includes('재구성했어도 핵심 뜻과 결론이 남아 있으면 적지 않는다'))
  check('검수가 안전한 창작과 고위험 사실을 구분',
    reviewPrompt.includes('독자에게 던지는 질문 · 비유 · 연결 문장 · 일반적인 관찰')
    && reviewPrompt.includes('구체적 고위험 생활사'))
}

// ══════════════════════════════════════════════════════════
// BLOCK 클래스
// ══════════════════════════════════════════════════════════

console.log(`\n── BLOCK: ${CREATIVITY_BLOCK_CLASS.HIGH_RISK_FACT} ──`)
// spouse(배우자): HIGH_RISK — v12 에서도 즉시 차단
{
  const i1 = inp('부부 사이', '우리 남편이 요즘 말이 없어요.', NO_PLAN)
  check('[spouse] 우리 남편 selfBasis=null — unwarrantedSelfClaim 차단', hardCodes(i1).includes('unwarrantedSelfClaim'))
}

// children(자녀 수 초과): childLifeStageConflict — v12 에서도 즉시 차단
{
  const card: DraftGateCard = { ...CARD_BASE, childrenCount: 1 }
  const i1 = inp('아이들이요', '우리 아이들 셋이 다 중학생이라 정신이 없어요.', NO_PLAN, card)
  const h1 = hardCodes(i1)
  check('[children-over] 카드 1명 vs 셋 — 하드 차단', h1.length > 0, h1.join(','))
}

// menopause(카드 미지원): unsupportedHealthClaim — v12 에서도 즉시 차단
{
  const i1 = inp('건강 이야기', '항우울제를 먹어봤는데 효과가 있더라고요.', NO_PLAN, CARD_BASE)
  const h1 = hardCodes(i1)
  check('[health] 항우울제 카드·계획 미지원 — 하드 차단', h1.length > 0, h1.join(','))
}

console.log(`\n── BLOCK: ${CREATIVITY_BLOCK_CLASS.TRUNCATED_MEDIA_COMPLETION} ──`)
// mediaDependentDraft: 시각 자료에 기대는 말
{
  const i1 = inp('작년 여름 원피스예요', '사진 첨부합니다. 이 옷 나이에 안 맞나요?', NO_PLAN, null)
  check('[media] 사진 첨부 표현 — mediaDependentDraft 차단', hardCodes(i1).includes('mediaDependentDraft'))
}

console.log(`\n── BLOCK: ${CREATIVITY_BLOCK_CLASS.SOURCE_DISTORTION} / truncatedSourceCompletion ──`)
// truncatedSourceCompletion: 잘린 원문 뒤 결말 지어 붙이기
{
  const ctxTrunc: DraftGateContext = {
    at: NOW,
    source: { title: '남편이 아침에', body: '남편이 아침을 주니까 / 야', site: 'navercafe:test', postedAt: NOW, capturedAt: NOW, imageCount: null },
  }
  const i1: DraftGateInput = {
    title: '남편 이야기',
    body: '남편이 아침을 챙겨주니 본체만체하네요. 그래도 감사해야겠죠.',
    plan: NO_PLAN, card: CARD_BASE, context: ctxTrunc,
  }
  const life1 = judgeDraftLife(i1)
  check('[truncated] 잘린 원문 결말 — 차단 또는 검토', life1.failures.length > 0 || life1.reviews.length > 0)
}

// ══════════════════════════════════════════════════════════
// 변이: 저위험 → 고위험 전환이 차단을 켠다 (dead-gate 없음 증명)
// ══════════════════════════════════════════════════════════

console.log(`\n── 변이: 저위험→고위험 전환이 차단을 켠다 ──`)

// 변이 1: work 텍스트 → spouse 추가 → 즉시 차단
{
  const base = inp('', '제 직장에서도 비슷한 일이 있었어요.', NO_PLAN)
  const mut = inp('', '제 직장에서 그런 일이 있었는데 남편이 많이 걱정하더라고요.', NO_PLAN)
  check('변이1 기준(work만) — 차단 없음', hardCodes(base).length === 0)
  check('변이1 변이(spouse 추가) — unwarrantedSelfClaim 차단', hardCodes(mut).includes('unwarrantedSelfClaim'))
}

// 변이 2: parents 텍스트 자체가 고위험으로 즉시 차단
{
  const base = inp('', '저희 부모님은 올해 은퇴하셨어요.', NO_PLAN, null)
  check('변이2 parents — unwarrantedSelfClaim 차단', hardCodes(base).includes('unwarrantedSelfClaim'))
}

// 변이 3: 가족 유사 표현 → 배우자 이혼 추가 → 즉시 차단
{
  const base = inp('', '저희 집도 그런 상황이라 공감이 됐어요.', NO_PLAN)
  const mut = inp('', '저희 집도 그런 상황이고 남편이랑 이혼 얘기까지 나왔어요.', NO_PLAN)
  check('변이3 기준(가족 유사만) — 차단 없음', hardCodes(base).length === 0)
  check('변이3 변이(이혼 추가) — unwarrantedSelfClaim 차단', hardCodes(mut).includes('unwarrantedSelfClaim'))
}

// 변이 4: work 텍스트 → assets(자산) 추가 → 즉시 차단 (assets는 HIGH_RISK)
{
  const base = inp('', '제 직장 생활이 쉽지 않네요.', NO_PLAN)
  const mut = inp('', '제 직장 생활이 쉽지 않아서 보험도 해지했어요.', { selfBasis: 'noLifeFactNeeded', warrants: [] })
  check('변이4 기준(work만) — 차단 없음', hardCodes(base).length === 0)
  const m4 = judgeDraftLife(mut)
  check('변이4 변이(보험 해지 = assets) — 검토 or 차단', m4.failures.length > 0 || m4.reviews.some((r) => r.code === 'unwarrantedSelfClaim'))
}

// ══════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════

console.log(`\n══ quality-v12 창의 계약 변이 결과 ══`)
console.log(`  통과 ${pass} · 실패 ${fail}`)
if (fail > 0) process.exit(1)
