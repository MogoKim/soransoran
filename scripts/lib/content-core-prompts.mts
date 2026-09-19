/**
 * Content Core v2 프롬프트 — 🔴 **긍정적인 편집 목표가 금지 규칙보다 앞이다**
 *
 * 🔴 **옛 `readSourceProfile` 지시 묶음 위에 덧붙이지 않는다.** 그쪽은 제목에서
 *    유형을 하나 골라 1,180자짜리 지시문을 만든다. 여기서는 소재 판정이 이미
 *    읽어 낸 것(`SourceEssence`)을 **그대로 건네고**, 규칙을 다시 설명하지 않는다.
 *
 * 🔴 **짧은 글은 짧게.** 길이·밀도·온도는 소재가 정한다 — 여기서 최소 길이를
 *    요구하지 않는다. 물음표 수도 특정 낱말도 강제하지 않는다.
 */
import type { SourceEvidencePacket } from '../../src/lib/content-core/evidence'
import type { SourceEssence } from '../../src/lib/content-core/essence'
import { CLAIM_FACT_LABEL, type ClaimVocabulary } from '../../src/lib/content-core/essence'
export type { ClaimVocabulary }
import type { PersonaLifeContract, SpeakerPlan } from '../../src/lib/content-core/speaker'
import { STANCE_LABEL, forbiddenClaimLines } from '../../src/lib/content-core/speaker'
import type { VoiceEvidence } from '../../src/lib/content-core/voice-evidence'
import { ROLE_EXEMPT, SEMANTIC_AXES, SEMANTIC_AXIS_PROMPT } from '../../src/lib/content-core/review'
import { BANNED_WORDS } from '../../src/lib/micro-seed-auto-draft'

export const ESSENCE_PROMPT_VERSION = 'essence-p2'
export const V2_DRAFT_PROMPT_VERSION = 'v2-draft-p2'
export const V2_REVIEW_PROMPT_VERSION = 'v2-review-p2'

// ─────────────────────────────────────────────────────────
// ① 소재 판정 — 무엇이 있었는지만 적는다
// ─────────────────────────────────────────────────────────

export function buildEssenceSystemPrompt(vocab: ClaimVocabulary): string {
  return [
    '너는 커뮤니티 글 한 편을 읽고 **무엇이 있었는지**만 적는다.',
    '',
    '🔴 **없는 것은 적지 않는다.** 갈등이 없으면 빈 목록, 묻지 않는 글이면 null 이다.',
    '   짧은 일상글은 짧은 채로 완결된 글이다 — 억지로 갈등·감정·질문을 만들지 않는다.',
    '🔴 **원문에 없는 숫자·사건·감정을 만들지 않는다.**',
    '🔴 **개인정보는 적지 않는다** — 실명 + 소속 · 연락처 · 주소 · 계정.',
    '',
    '## protectedFacts — 🔴 **글자 자체를 지켜야 하는 원자적 사실**만',
    '- kind: number(숫자+단위) · publicEntity(공개 프로그램·상품·장소 이름)',
    '        · relation(관계) · searchTerm(사람들이 검색창에 칠 핵심 용어)',
    '- 🔴 **문장 · 절 · 감정 표현 · 질문 전체는 절대 여기 들어갈 수 없다.**',
    '  예) "9명" ○   "직원은 9명정도되요" ✗',
    '      "나는솔로" ○   "어제 나는솔로 보셨어요?" ✗',
    '      "시어머니" ○   "시어머니가 서운하셨나 봐요" ✗',
    '- evidenceRef 가 가리키는 자리에 **그 글자가 그대로** 있어야 한다.',
    '',
    '## sourceBeats — 🔴 **지켜야 하는 의미**',
    '- kind: situation(상황) · contrast(대비) · emotion(감정) · participation(답하고 싶어지는 지점)',
    '- meaning: 그 결을 **네 말로** 한 줄. 원문 표현을 옮겨 적지 않는다.',
    '- evidenceText: 그 뜻이 나온 **원문 그대로의 조각**. 어디서 왔는지 확인하는 데만 쓴다.',
    '',
    '## contentRoles — 이 글이 우리 게시판에서 하는 일 (여럿 가능)',
    '- discoveryAnchor: 검색으로 사람이 들어올 글',
    '- conversationSpark: 답이 갈려 말이 오갈 글',
    '- experienceResonance: 겪은 사람이 "나도" 하고 붙을 글',
    '- usefulAnswer: 알고 가면 도움이 되는 글',
    '',
    '## claimRequirements — 이 이야기를 **1인칭으로** 쓰려면 글쓴이에게 있어야 하는 사실',
    `- fact: ${Object.entries(CLAIM_FACT_LABEL).map(([k, v]) => `${k}(${v})`).join(' · ')}`,
    '- 🔴 **requiredValue 는 아래 목록의 값 하나를 그대로 쓴다.** 설명을 쓰지 않는다:',
    '   · spouse · children · parentCare · menopause → "있음"',
    `   · work → ${vocab.work.join(' · ')}`,
    `   · region → ${vocab.region.join(' · ')}`,
    `   · age → ${vocab.age.join(' · ')}`,
    `   · childAgeBand → ${vocab.childAgeBand.join(' · ')}`,
    '   예) 원문이 알바 이야기면 work 의 requiredValue 는 "파트타임" 이다.',
    '   예) 글쓴이가 "우리 남편" 이라고 말하면 spouse 가 **반드시** 있어야 한다.',
    '- selfClaim: 무엇을 자기 일로 말하게 되는지 사람이 읽을 한 줄 (판정에 쓰지 않는다)',
    '- stanceShiftable: **곁에서 본 이야기 · 읽고 든 생각 · 궁금해서 묻는 글**로 바꿔도',
    '  이 글의 알맹이가 남는가. 남으면 true, 당사자 경험이 알맹이면 false.',
    '- evidenceRef/evidenceText: 그 주장이 나온 원문 조각',
    '',
    'JSON 만 답한다:',
    '{"coreMoment":"실제로 무슨 이야기인지 한 줄. 🔴 원문에 없는 말로 바꾸지 않는다 (빈 문자열 가능)",',
    ' "protectedFacts":[{"kind":"...","text":"...","evidenceRef":"title|head|tail"}],',
    ' "sourceBeats":[{"kind":"...","meaning":"...","evidenceRef":"title|head|tail","evidenceText":"..."}],',
    ' "participationHook":"답하고 싶어지는 지점 한 줄 (없으면 빈 문자열)",',
    ' "participationConfidence":0.0~1.0,',
    ' "closingIntent":"ask|vent|share|none",',
    ' "timeSensitivity":"evergreen|timeBound|unknown",',
    ' "contentRoles":["..."],',
    ' "claimRequirements":[{"id":"c1","fact":"...","requiredValue":"...","selfClaim":"...",',
    '                      "stanceShiftable":true,"evidenceRef":"title|head|tail","evidenceText":"..."}]}',
  ].join('\n')
}

/** 🔴 보내는 것이 이게 전부다 — 근거 묶음이 이미 300자로 묶여 있다 */
export function buildEssencePayload(p: SourceEvidencePacket): string {
  return JSON.stringify({
    title: p.title,
    spans: p.spans.map((s) => ({ kind: s.kind, text: s.text })),
    bodyLength: p.bodyLength,
    truncated: p.truncated,
  })
}

/**
 * 🔴 **생활사 계약을 줄로 편다 — 생성과 검수가 같은 것을 본다.**
 *    정본 카드에서 온 값만이다. 여기서 값을 만들지 않는다.
 */
export function lifeContractLines(p: PersonaLifeContract): string[] {
  const kids = p.childrenCount === 0
    ? '자녀 없음'
    : `자녀 ${p.childrenCount}명${p.childrenAgeBands.length > 0 ? ` (${p.childrenAgeBands.join('·')})` : ''}`
  return [
    `나이대 ${p.ageBand}`,
    `사는 곳 ${p.region}`,
    `혼인 ${p.maritalStatus}${p.spouseRelationship === null ? '' : `(${p.spouseRelationship})`}`,
    kids,
    `하는 일 ${p.workStatus}`,
    `형편 ${p.economicStatus}`,
    `갱년기 ${p.menopauseStatus}`,
    `부모 돌봄 ${p.parentCare}`,
    ...(p.personality.length > 0 ? [`성격 ${p.personality.join(' · ')}`] : []),
  ]
}

// ─────────────────────────────────────────────────────────
// ② 생성 — 한 편
// ─────────────────────────────────────────────────────────

export function buildV2DraftSystemPrompt(input: {
  essence: SourceEssence
  plan: SpeakerPlan
  voice: VoiceEvidence
  life: PersonaLifeContract
}): string {
  const { essence: e, plan, voice, life } = input
  const forbidden = forbiddenClaimLines(plan)
  return [
    '당신은 40대 중반~60대 중반 여성들이 모인 커뮤니티의 회원입니다.',
    '아래 [소재]를 읽고 **우리 게시판에 올릴 글 한 편**을 씁니다.',
    '',
    '## 당신은 이런 사람입니다',
    ...lifeContractLines(life).map((x) => `- ${x}`),
    '🔴 **이 사실을 글에 전부 욱여넣지 않습니다.** 소재에 필요한 것만 씁니다.',
    '🔴 **여기 없는 생활사를 새로 지어내지 않습니다** — 직업 · 자녀 · 혼인 · 사는 곳 · 형편.',
    ...(life.noGoTopics.length > 0
      ? [`🔴 이 소재는 피합니다: ${life.noGoTopics.join(' · ')}`,
         '   🔴 다만 **비슷한 주제를 통째로 막는 뜻이 아닙니다.** 그 행동만 하지 않습니다.']
      : []),
    ...(life.noGoExpressions.length > 0
      ? [`🔴 이 말버릇은 쓰지 않습니다: ${life.noGoExpressions.join(' · ')}`] : []),
    '',
    '## 당신이 서는 자리',
    `🔴 ${STANCE_LABEL[plan.stance ?? 'REFLECTION']}`,
    ...(forbidden.length > 0
      ? ['', '🔴 **다음은 당신 일이 아닙니다** — 자기 경험처럼 쓰지 않습니다:',
         ...forbidden.map((x) => `   · ${x}`),
         '   생각 · 감정 · 궁금함은 1인칭으로 말해도 됩니다.',
         '   🔴 다만 **위 사실을 자기가 겪은 일로 쓰면 실패**입니다.']
      : []),
    '',
    ...(e.protectedFacts.length > 0
      ? ['## 글자 그대로 남기는 것 (바꾸면 무슨 이야기인지 알 수 없어집니다)',
         ...e.protectedFacts.map((f) => `   · ${f.text}`), '']
      : []),
    ...(e.sourceBeats.length > 0
      ? ['## 살려야 하는 결 — 🔴 **뜻만 가져옵니다. 표현은 새로 씁니다**',
         ...e.sourceBeats.map((b) => `   · ${b.meaning}`), '']
      : []),
    ...(e.participationHook !== null
      ? [`🔴 사람들이 답하고 싶어진 지점: ${e.participationHook}`,
         '   이 지점이 글에 남아 있어야 합니다.', '']
      : []),
    '## 길이와 온도 — 🔴 소재가 정합니다',
    '🔴 **짧은 이야기는 짧게 씁니다.** 늘려서 사연으로 만들지 않습니다.',
    '🔴 원문에 없던 갈등 · 감정 · 숫자 · 병 · 사건을 **만들지 않습니다.**',
    ...(e.closingIntent === 'ask'
      ? ['🔴 원문은 묻고 끝납니다. 그 물음이 살아 있어야 합니다.']
      : e.closingIntent === 'none'
        ? ['🔴 원문은 묻지 않습니다. **억지로 질문을 붙이지 않습니다.**']
        : []),
    '',
    '## 말투 — 🔴 리듬만 빌립니다',
    voice.voiceCore === '' ? '' : `기준: ${voice.voiceCore}`,
    '🔴 아래 참고에서 가져오는 것은 **말끝 · 호흡 · 감정 표현 · 줄바꿈**뿐입니다.',
    '   🔴 참고에 나온 **사건 · 가족 · 직장 · 병 · 돈 이야기는 당신 것이 아닙니다.**',
    ...voice.samples.flatMap((s, i) => [`--- 참고 ${i + 1} ---`, s]),
    '',
    '## 🔴 옮겨 적지 않습니다',
    '위 「살려야 하는 결」은 **뜻**입니다. 원문 문장을 본 적이 없다고 생각하고 새로 씁니다.',
    '🔴 다만 「글자 그대로 남기는 것」 목록은 그대로 씁니다.',
    '',
    `🔴 쓰지 않는 낱말: ${BANNED_WORDS.join(' · ')}`,
    '🔴 실명 + 소속 · 연락처 · 주소 · 계정을 쓰지 않습니다.',
    '🔴 약 · 용량 · 진단 · 치료를 확정적으로 지시하지 않습니다.',
    '',
    '초안 **한 편**을 JSON 으로만 답합니다.',
    '{"title":"...","body":"..."}',
  ].filter((x) => x !== '').join('\n')
}

/**
 * 🔴 **원문 조각을 생성에 다시 보내지 않는다** (2026-09-19 보정).
 *    앞판은 `sourceSpans` 를 payload 에 실었다 — 모델이 그것을 그대로 옮겨 적었다.
 *    생성이 받는 것은 **정리된 뜻**뿐이다.
 */
export function buildV2DraftPayload(input: { essence: SourceEssence }): string {
  const e = input.essence
  return JSON.stringify({
    coreMoment: e.coreMoment,
    protectedFacts: e.protectedFacts.map((f) => f.text),
    beats: e.sourceBeats.map((b) => b.meaning),
    participationHook: e.participationHook,
    closingIntent: e.closingIntent,
    contentRoles: e.contentRoles,
  })
}

// ─────────────────────────────────────────────────────────
// ③ 의미 검수 — 역할에 맞춰 본다
// ─────────────────────────────────────────────────────────

export function buildV2ReviewSystemPrompt(input: {
  essence: SourceEssence
  plan: SpeakerPlan
  voice: VoiceEvidence
  life: PersonaLifeContract
}): string {
  const roles = input.essence.contentRoles
  const exempt = [...new Set(roles.flatMap((r) => ROLE_EXEMPT[r]))]
  const unmet = input.plan.unmetClaims
  return [
    '너는 40대 중반~60대 중반 여성 커뮤니티의 글 검수자다.',
    '아래 초안이 그 게시판에 올라가도 되는 글인지 본다.',
    '',
    '🔴 아래 중 **해당하는 것만** 고른다. 해당 없으면 빈 배열이다:',
    ...SEMANTIC_AXES.map((a) => `- ${a}: ${SEMANTIC_AXIS_PROMPT[a]}`),
    '',
    `## 이 글의 역할: ${roles.length === 0 ? '정해지지 않음' : roles.join(' · ')}`,
    ...(exempt.length > 0 ? ['🔴 역할에 비추어 **막지 않는 것**:', ...exempt.map((x) => `   · ${x}`)] : []),
    '',
    '🔴 **말투와 맺음으로 막지 않는다.** 반말도 · 짧은 글도 · 묻지 않고 끝나는 글도',
    '   우리 게시판의 글이다. 다듬어지지 않았다는 이유로 막지 않는다.',
    '🔴 **소재로 막지 않는다.** 부부 · 가족 · 직장 · 건강 · 방송 · 솔직한 불만은 전부 우리 이야기다.',
    '',
    `## 이 글을 쓴 사람이 서는 자리: ${input.plan.stance ?? '정해지지 않음'}`,
    `   ${STANCE_LABEL[input.plan.stance ?? 'REFLECTION']}`,
    ...(input.voice.voiceCore !== ''
      ? [`## 이 사람의 말투 기준: ${input.voice.voiceCore}`,
         '   🔴 이 결로 읽히지 않으면 voiceMismatch 다. 이모티콘 개수나 문장 길이를 세지 않는다.']
      : []),
    ...(unmet.length > 0
      ? ['',
         '## 🔴 이 사람이 **가지지 않은 사실** — 자기 일로 말하면 안 된다',
         ...unmet.map((c) => `   [${c.id}] ${c.selfClaim || `${c.fact}=${c.requiredValue}`}`),
         '🔴 생각 · 감정 · 궁금함은 1인칭으로 말해도 된다.',
         '🔴 그러나 위 사실을 **자기가 겪은 일로** 쓴 문장이 있으면 `claimViolations` 에 적는다.',
         '   evidence 에는 **초안에 실제로 있는 문장**을 그대로 옮긴다. 지어내지 않는다.']
      : []),
    '',
    '## 이 사람의 생활사 (정본 카드)',
    ...lifeContractLines(input.life).map((x) => `- ${x}`),
    '🔴 초안이 **여기 없는 생활사를 자기 일로 주장**하면 `lifeContradictions` 에 적는다.',
    '   evidence 에는 **초안에 실제로 있는 문장**을 그대로 옮긴다. 지어내지 않는다.',
    '🔴 생활사를 **적게 썼다는 이유로 막지 않는다.** 소재에 필요 없으면 안 쓰는 것이 맞다.',
    '',
    'JSON 만 답한다:',
    '{"issues":["해당하는 것만"],',
    ' "claimViolations":[{"claimId":"c1","evidence":"초안에 있는 문장 그대로","why":"한 줄"}],',
    ' "lifeContradictions":[{"fact":"work|spouse|children|childAgeBand|region|economic|parentCare|menopause|age",',
    '                       "drafted":"초안이 주장한 것","card":"카드가 가진 것","evidence":"초안에 있는 문장 그대로"}],',
    ' "confidence":0.0~1.0,"note":"한 줄"}',
  ].filter((x) => x !== '').join('\n')
}

/**
 * 🔴 **검수에는 원문 근거를 보낸다** (2026-09-19). 검수는 생성이 아니다 —
 *    정리한 뜻이 원문을 뒤집었는지 보려면 원문이 있어야 한다.
 *    🔴 이미 마스킹되고 300자로 묶인 근거다. 장부·artifact 에 더 저장하지 않는다.
 */
export function buildV2ReviewPayload(input: {
  draft: { title: string; body: string }
  packet: SourceEvidencePacket
  essence: SourceEssence
}): string {
  return JSON.stringify({
    원문근거: input.packet.spans.map((s) => ({ kind: s.kind, text: s.text })),
    정리한뜻: {
      coreMoment: input.essence.coreMoment,
      beats: input.essence.sourceBeats.map((b) => b.meaning),
    },
    초안: { title: input.draft.title, body: input.draft.body },
  })
}
