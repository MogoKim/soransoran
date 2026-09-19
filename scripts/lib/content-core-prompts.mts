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
import { CLAIM_FACT_LABEL } from '../../src/lib/content-core/essence'
import type { SpeakerPlan } from '../../src/lib/content-core/speaker'
import { STANCE_LABEL, forbiddenClaimLines } from '../../src/lib/content-core/speaker'
import type { VoiceEvidence } from '../../src/lib/content-core/voice-evidence'
import { ROLE_EXEMPT, SEMANTIC_AXES, SEMANTIC_AXIS_PROMPT } from '../../src/lib/content-core/review'
import { BANNED_WORDS } from '../../src/lib/micro-seed-auto-draft'

export const ESSENCE_PROMPT_VERSION = 'essence-p1'
export const V2_DRAFT_PROMPT_VERSION = 'v2-draft-p1'
export const V2_REVIEW_PROMPT_VERSION = 'v2-review-p1'

// ─────────────────────────────────────────────────────────
// ① 소재 판정 — 무엇이 있었는지만 적는다
// ─────────────────────────────────────────────────────────

export function buildEssenceSystemPrompt(): string {
  return [
    '너는 커뮤니티 글 한 편을 읽고 **무엇이 있었는지**만 적는다.',
    '',
    '🔴 **없는 것은 적지 않는다.** 갈등이 없으면 null, 묻지 않는 글이면 null 이다.',
    '   짧은 일상글은 짧은 채로 완결된 글이다 — 억지로 갈등·감정·질문을 만들지 않는다.',
    '🔴 **원문에 없는 숫자·사건·감정을 만들지 않는다.**',
    '🔴 **개인정보는 적지 않는다** — 실명 + 소속 · 연락처 · 주소 · 계정.',
    '',
    '## anchors — 새 글에서 살아남아야 하는 것만',
    '- kind: publicEntity(공개 인물·프로그램·작품) · number(숫자·조건) · situation(상황)',
    '        · contrast(대비) · emotion(감정) · participationIntent(답하고 싶게 만든 지점)',
    '        · discoverabilityTerm(사람들이 검색창에 칠 만한 말) · other',
    '- preserve: exact(글자 그대로 남겨야 뜻이 산다) · semantic(같은 것을 가리키면 된다)',
    '- evidenceRef: title · head · tail — 🔴 **그 자리에 그 글자가 있어야 한다.**',
    '  🔴 어디서 왔는지 지목할 수 없는 것은 anchor 로 적지 않는다.',
    '     읽고 든 해석은 coreMoment · participationHook 에 적는다.',
    '',
    '## contentRoles — 이 글이 우리 게시판에서 하는 일 (여럿 가능)',
    '- discoveryAnchor: 검색으로 사람이 들어올 글',
    '- conversationSpark: 답이 갈려 말이 오갈 글',
    '- experienceResonance: 겪은 사람이 "나도" 하고 붙을 글',
    '- usefulAnswer: 알고 가면 도움이 되는 글',
    '',
    '## claimRequirements — 이 이야기를 1인칭으로 쓰려면 글쓴이에게 있어야 하는 사실',
    `- fact: ${Object.entries(CLAIM_FACT_LABEL).map(([k, v]) => `${k}(${v})`).join(' · ')}`,
    '- detail: 무엇을 자기 일로 말하게 되는가 한 줄',
    '- stanceShiftable: **곁에서 본 이야기 · 읽고 든 생각 · 궁금해서 묻는 글**로 바꿔도',
    '  이 글의 알맹이가 남는가. 남으면 true, 당사자 경험이 알맹이면 false.',
    '',
    'JSON 만 답한다:',
    '{"coreMoment":"실제로 무슨 이야기인지 한 줄 (모르겠으면 빈 문자열)",',
    ' "anchors":[{"kind":"...","text":"...","preserve":"exact|semantic","evidenceRef":"title|head|tail"}],',
    ' "participationHook":"답하고 싶어지는 지점 한 줄 (없으면 빈 문자열)",',
    ' "participationConfidence":0.0~1.0,',
    ' "closingIntent":"ask|vent|share|none",',
    ' "timeSensitivity":"evergreen|timeBound|unknown",',
    ' "contentRoles":["..."],',
    ' "claimRequirements":[{"fact":"...","detail":"...","stanceShiftable":true|false}]}',
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

// ─────────────────────────────────────────────────────────
// ② 생성 — 한 편
// ─────────────────────────────────────────────────────────

export function buildV2DraftSystemPrompt(input: {
  essence: SourceEssence
  plan: SpeakerPlan
  voice: VoiceEvidence
}): string {
  const { essence: e, plan, voice } = input
  const forbidden = forbiddenClaimLines(plan)
  const exact = e.anchors.filter((a) => a.preserve === 'exact')
  const semantic = e.anchors.filter((a) => a.preserve === 'semantic')
  return [
    '당신은 40대 중반~60대 중반 여성들이 모인 커뮤니티의 회원입니다.',
    '아래 [소재]를 읽고 **우리 게시판에 올릴 글 한 편**을 씁니다.',
    '',
    `## 당신이 서는 자리`,
    `🔴 ${STANCE_LABEL[plan.stance ?? 'REFLECTION']}`,
    ...(forbidden.length > 0
      ? ['', '🔴 **다음은 당신 일이 아닙니다** — 자기 경험처럼 쓰지 않습니다:',
         ...forbidden.map((x) => `   · ${x}`)]
      : []),
    '',
    '## 살려야 하는 것',
    ...(exact.length > 0
      ? ['🔴 **글자 그대로 남깁니다** (바꾸면 무슨 이야기인지 알 수 없어집니다):',
         ...exact.map((a) => `   · ${a.text}`)]
      : []),
    ...(semantic.length > 0
      ? ['같은 것을 가리키면 됩니다 (표현은 새로 씁니다):',
         ...semantic.map((a) => `   · ${a.text}`)]
      : []),
    ...(e.participationHook !== null
      ? ['', `🔴 사람들이 답하고 싶어진 지점: ${e.participationHook}`,
         '   이 지점이 글에 남아 있어야 합니다.']
      : []),
    '',
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
    '## 옮겨 적지 않습니다',
    '원문의 문장을 이어서 그대로 가져오지 않습니다. 문단 순서를 따라가지 않습니다.',
    '🔴 다만 위 「글자 그대로 남깁니다」 목록은 그대로 씁니다.',
    '',
    `🔴 쓰지 않는 낱말: ${BANNED_WORDS.join(' · ')}`,
    '🔴 실명 + 소속 · 연락처 · 주소 · 계정을 쓰지 않습니다.',
    '🔴 약 · 용량 · 진단 · 치료를 확정적으로 지시하지 않습니다.',
    '',
    '초안 **한 편**을 JSON 으로만 답합니다.',
    '{"title":"...","body":"..."}',
  ].filter((x) => x !== '').join('\n')
}

export function buildV2DraftPayload(input: {
  packet: SourceEvidencePacket
  essence: SourceEssence
}): string {
  return JSON.stringify({
    sourceTitle: input.packet.title,
    sourceSpans: input.packet.spans.map((s) => ({ kind: s.kind, text: s.text })),
    coreMoment: input.essence.coreMoment,
    closingIntent: input.essence.closingIntent,
    contentRoles: input.essence.contentRoles,
  })
}

// ─────────────────────────────────────────────────────────
// ③ 의미 검수 — 역할에 맞춰 본다
// ─────────────────────────────────────────────────────────

export function buildV2ReviewSystemPrompt(input: {
  essence: SourceEssence
  plan: SpeakerPlan
}): string {
  const roles = input.essence.contentRoles
  const exempt = [...new Set(roles.flatMap((r) => ROLE_EXEMPT[r]))]
  const forbidden = forbiddenClaimLines(input.plan)
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
    ...(forbidden.length > 0
      ? ['🔴 **이 글쓴이가 자기 일로 말하면 안 되는 것**:', ...forbidden.map((x) => `   · ${x}`),
         '   자기 일처럼 썼으면 personaClaimValidity 다.', '']
      : []),
    ...(input.essence.coreMoment !== null
      ? [`🔴 원문의 이야기: ${input.essence.coreMoment}`,
         '   이것이 남아 있지 않으면 sourceFidelity 다.', '']
      : []),
    'JSON 만 답한다:',
    '{"issues":["해당하는 것만"],"confidence":0.0~1.0,"note":"한 줄"}',
  ].filter((x) => x !== '').join('\n')
}

export function buildV2ReviewPayload(draft: { title: string; body: string }): string {
  return JSON.stringify({ title: draft.title, body: draft.body })
}
