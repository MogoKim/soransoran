/**
 * Content Core v2 프롬프트 — 🔴 **계획도 생성도 마스킹된 원문을 직접 읽는다**
 *
 * 🔴 **왜 이 모양인가** (2026-09-19, 대안 D).
 *    ① 생성이 요약만 받던 판에서는 원문의 말이 단계마다 변했다 → 원문을 직접 준다.
 *    ② 화자 선택이 `claimRequirements` 라는 중간 표현만 보던 판에서는
 *       그 표현이 비는 순간 **모두가 자격자**가 됐다 → 계획이 원문과 카드를 함께 본다.
 *
 * 🔴 **계획 호출에 말투 참고 댓글 본문을 보내지 않는다.** 자격 판정에 필요 없고,
 *    보내면 남의 글이 화자 선택에 섞인다.
 */
import type { SourceEvidencePacket } from '../../src/lib/content-core/evidence'
import { CLAIM_FACT_LABEL } from '../../src/lib/content-core/source-facts'
import type { PersonaLifeContract, SpeakerPlan } from '../../src/lib/content-core/speaker'
import { STANCE_LABEL } from '../../src/lib/content-core/speaker'
import type { VoiceEvidence } from '../../src/lib/content-core/voice-evidence'
import {
  LIFE_CONTRADICTION_FACTS, SEMANTIC_AXES, SEMANTIC_AXIS_PROMPT,
} from '../../src/lib/content-core/review'
import { BANNED_WORDS } from '../../src/lib/micro-seed-auto-draft'

/**
 * 🔴 **판 값의 정본은 `src/lib/content-core/pipeline.ts` 다.** 봉투·큐·발행이 같은 값을
 *    읽어야 해서 거기 있다. 여기서 다시 적으면 한쪽이 낡는다 — 다시 내보내기만 한다.
 */
export {
  SPEAKER_PLAN_PROMPT_VERSION, V2_DRAFT_PROMPT_VERSION, V2_REVIEW_PROMPT_VERSION,
} from '../../src/lib/content-core/pipeline'

/** 🔴 원문 근거를 한 덩어리로 — 계획도 생성도 검수도 **같은 것**을 본다 */
export function sourceBlock(p: SourceEvidencePacket): string {
  return [`제목: ${p.title}`, ...p.spans.filter((s) => s.kind !== 'title').map((s) => s.text)]
    .join('\n')
}

/**
 * 🔴 **생활사 계약을 줄로 편다 — 계획·생성·검수가 같은 것을 본다.**
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
// ① 화자 계획 — 🔴 원문과 실제 카드를 **함께** 본다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 자격 판정에 쓰는 칸만. 🔴 **이 줄은 모델이 읽는 용도다** — 모델이 이 값을 다시
 *    적어 낼 필요는 없다. 자격 판정은 코드가 정본 카드에서 직접 읽어 한다.
 */
export function qualificationLine(p: PersonaLifeContract): string {
  return `[${p.code}] 나이대 ${p.ageBand} · 사는 곳 ${p.region} · 혼인 ${p.maritalStatus}`
    + ` · 자녀수 ${p.childrenCount}${p.childrenAgeBands.length > 0 ? ` (${p.childrenAgeBands.join('·')})` : ''}`
    + ` · 하는 일 ${p.workStatus} · 형편 ${p.economicStatus}`
    + ` · 갱년기 ${p.menopauseStatus} · 부모 돌봄 ${p.parentCare}`
}

export function buildSpeakerPlanSystemPrompt(): string {
  return [
    '너는 40대 중반~60대 중반 여성 커뮤니티에 올릴 글의 **화자를 정한다.**',
    '[원문]을 읽고, [후보]에서 **이 이야기를 할 자격이 있는 사람**을 한 명 고른다.',
    '🔴 글을 쓰지 않는다. 요약하지도 않는다.',
    '',
    '## 🔴 원문은 `spans` 로 나뉘어 있다',
    '   각 span 의 `kind`(`title` · `head` · `tail`)가 **곧 `evidenceRef` 다.**',
    '   근거를 적을 때는 그 글자가 **실제로 들어 있는 span 의 kind** 를 쓴다.',
    '   예) 제목에만 있는 말이면 `evidenceRef: "title"`, 본문 앞이면 `"head"`.',
    '   🔴 자리가 틀리면 근거가 **없는 것으로 처리되어** 1인칭이 취소된다.',
    '',
    '## 자리(stance) — 🔴 자격이 있을 때만 위로 올라간다',
    ...Object.entries(STANCE_LABEL).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## 🔴 SELF_EXPERIENCE 를 고르려면 **근거를 대야 한다**',
    '',
    '`selfBasis` 를 반드시 둘 중 하나로 밝힌다.',
    '',
    '### selfBasis = "lifeFacts"',
    '원문이 직업 · 혼인 · 자녀 · 사는 곳 · 나이 · 부모 돌봄 · 갱년기를',
    '**자기 경험으로** 말하는 경우다. `speakerWarrants` 에 한 줄씩 적는다:',
    `- fact: ${Object.entries(CLAIM_FACT_LABEL).map(([k, v]) => `${k}(${v})`).join(' · ')}`,
    '- requiredValue: 그 사람에게 있어야 하는 값',
    '   · spouse · parentCare · menopause → "있음"',
    '   · children → "있음" 또는 "없음"',
    '   · work · region · age · childAgeBand → **[후보] 줄에 적힌 글자 그대로**',
    '- evidenceRef / evidenceText: 그 요구가 나온 **[원문]의 실제 문장 조각**',
    '',
    '🔴 **카드 값을 옮겨 적지 않는다.** 고른 사람의 카드는 코드가 정본에서 직접 읽는다.',
    '   네가 할 일은 "원문이 어떤 자격을 요구하는가" 를 정하는 것까지다.',
    '',
    '🔴 근거는 **코드가 대조한다.** 원문에 없는 문장, 고른 사람이 충족하지 못하는',
    '   requiredValue 는 **1인칭이 취소된다.** 지어내면 글이 만들어지지 않는다.',
    '',
    '### selfBasis = "noLifeFactNeeded"',
    '원문이 **특정 생활사 자격을 요구하지 않는** 보편적인 이야기·감정·생각인 경우다.',
    '   예) 김치를 이르게 꺼낸 이야기 · 날씨 · 요즘 드는 생각',
    '`speakerWarrants` 는 **빈 배열**로 두고 `universalReason` 에 왜 그런지 한 줄 적는다.',
    '🔴 **"잘 모르겠다" 는 이 값이 아니다.** 모르면 자리를 낮춘다.',
    '',
    '## 자격이 없으면',
    '- 관찰 · 생각 · 물음으로 바꿔도 이야기가 남으면 → OBSERVATION · REFLECTION · QUESTION',
    '- 당사자 경험이 이 글의 알맹이라 바꾸면 사라지면 → `decision: "hold"`',
    '',
    '## 누구를 고를까',
    '🔴 **자격을 채운 사람 중에서** 지금 회차에 맡은 수(load)가 적은 사람을 고른다.',
    '🔴 load 가 적다는 이유로 **자격 없는 사람을 고르지 않는다.**',
    '',
    '## protectedFacts — 🔴 글자 자체를 지켜야 하는 **원자적 사실**만',
    '- kind: number(숫자+단위) · publicEntity(공개 프로그램·상품·장소 이름)',
    '        · relation(관계) · searchTerm(검색창에 칠 핵심 용어)',
    '- 🔴 **문장 · 절 · 감정 표현 · 질문 전체는 절대 여기 들어갈 수 없다.**',
    '  예) "9명" ○   "직원은 9명정도되요" ✗',
    '- evidenceRef 가 가리키는 자리에 **그 글자가 그대로** 있어야 한다.',
    '',
    '## contentRoles — 이 글이 우리 게시판에서 하는 일 (여럿 가능)',
    '- discoveryAnchor: 검색으로 사람이 들어올 글',
    '- conversationSpark: 답이 갈려 말이 오갈 글',
    '- experienceResonance: 겪은 사람이 "나도" 하고 붙을 글',
    '- usefulAnswer: 알고 가면 도움이 되는 글',
    '🔴 experienceResonance **하나뿐**이면 자리를 낮출 수 없는 글이라는 뜻이다.',
    '',
    'JSON 만 답한다:',
    '{"decision":"ok|hold","holdReason":"hold 일 때 한 줄",',
    ' "personaCode":"P01","stance":"SELF_EXPERIENCE|OBSERVATION|REFLECTION|QUESTION",',
    ' "selfBasis":"lifeFacts|noLifeFactNeeded (SELF_EXPERIENCE 일 때만)",',
    ' "speakerWarrants":[{"fact":"work","requiredValue":"파트타임",',
    '                     "evidenceRef":"title|head|tail","evidenceText":"원문에 있는 조각"}],',
    ' "universalReason":"noLifeFactNeeded 일 때 한 줄",',
    ' "protectedFacts":[{"kind":"...","text":"...","evidenceRef":"title|head|tail"}],',
    ' "closingIntent":"ask|vent|share|none",',
    ' "contentRoles":["..."]}',
  ].join('\n')
}

/**
 * 🔴 **원문을 span 으로 나눠 보낸다** (2026-09-19 실측 보정).
 *
 *    앞판은 제목과 본문을 **한 문자열로 붙여** 보내면서 출력에는 `title`/`head`/`tail`
 *    을 요구했다. 모델은 어느 글자가 어느 자리에 있는지 알 방법이 없었고,
 *    그래서 A(`spouse`)·C(`work`) 의 허가 근거와 C 의 `3시간`·`9명` 이 전부
 *    `evidenceNotInSource` 로 거절됐다 — **지시문 문구가 아니라 준 정보의 문제였다.**
 *
 * 🔴 **말투 참고 댓글 본문은 보내지 않는다.** 자격 판정에 필요 없다.
 * 🔴 원문 내용·개인정보 범위는 늘리지 않는다 — 이미 마스킹되고 300자로 묶인 그 span 들이다.
 */
export function buildSpeakerPlanPayload(input: {
  packet: SourceEvidencePacket
  personas: readonly PersonaLifeContract[]
  load?: Readonly<Record<string, number>>
}): string {
  const load = input.load ?? {}
  const p = input.packet
  return JSON.stringify({
    원문: {
      // 🔴 packet 에 **실제로 있는 span 만** — 없는 자리를 지어내 보내지 않는다
      spans: p.spans.map((x) => ({ kind: x.kind, text: x.text })),
      bodyLength: p.bodyLength,
      truncated: p.truncated,
    },
    후보: input.personas.map((x) => `${qualificationLine(x)} · 맡은 수 ${load[x.code] ?? 0}`),
  })
}

// ─────────────────────────────────────────────────────────
// ② 생성 — 한 편. 🔴 원문을 직접 읽는다
// ─────────────────────────────────────────────────────────

export function buildV2DraftSystemPrompt(input: {
  plan: SpeakerPlan
  voice: VoiceEvidence
  life: PersonaLifeContract
}): string {
  const { plan, voice, life } = input
  return [
    '당신은 40대 중반~60대 중반 여성들이 모인 커뮤니티의 회원입니다.',
    '[원문]은 다른 커뮤니티에서 사람들이 실제로 반응한 글입니다.',
    '그 이야기를 **당신의 말로 새로 써서** 우리 게시판에 올립니다.',
    '',
    '## 살리는 것',
    '- 원문의 주제 · 핵심 낱말 · 숫자 · 관계 · 상황 · 질문',
    ...(plan.protectedFacts.length > 0
      ? [`- 🔴 이 말들은 **그대로** 씁니다: ${plan.protectedFacts.map((f) => f.text).join(' · ')}`]
      : []),
    ...(plan.closingIntent === 'ask'
      ? ['- 원문은 묻고 끝납니다. 그 물음이 살아 있어야 합니다.']
      : plan.closingIntent === 'none'
        ? ['- 원문은 묻지 않습니다. 억지로 질문을 붙이지 않습니다.']
        : []),
    '',
    '## 새로 쓰는 것',
    '- 문장과 문단 구성은 **처음부터 새로** 씁니다. 원문 문장을 옮겨 적지 않습니다.',
    '- 원문이 짧으면 **짧게** 씁니다. 늘려서 사연으로 만들지 않습니다.',
    '- 🔴 원문에 없는 **사건 · 날짜 · 대사 · 겪은 일**을 만들지 않습니다.',
    '  예) 원문이 "남편이 집안일을 안 한다" 뿐이면,',
    '      "주말에 밥 차려달라고 하면 난리가 난다" 같은 장면을 **지어내지 않습니다.**',
    '',
    '## 당신은 이런 사람입니다',
    ...lifeContractLines(life).map((x) => `- ${x}`),
    '🔴 이것은 **당신이 이 글을 쓸 자격이 있는지**를 정하는 정보입니다. 글의 재료가 아닙니다.',
    '🔴 **원문이 부르지 않은 당신의 직업 · 사는 곳 · 형편 · 자녀 · 혼인은 글에 넣지 않습니다.**',
    ...(plan.warrants.length > 0
      ? [`   이번에 원문이 부른 것: ${plan.warrants.map((w) => `${w.fact}=${w.requiredValue}`).join(' · ')}`]
      : ['   이번에 원문이 부른 생활사는 없습니다.']),
    '🔴 여기 없는 생활사를 새로 지어내지도 않습니다.',
    ...(life.noGoTopics.length > 0
      ? [`🔴 이 행동은 하지 않습니다: ${life.noGoTopics.join(' · ')}`,
         '   (비슷한 주제를 통째로 피하라는 뜻이 아닙니다)']
      : []),
    ...(life.noGoExpressions.length > 0
      ? [`🔴 이 말버릇은 쓰지 않습니다: ${life.noGoExpressions.join(' · ')}`] : []),
    '',
    `## 당신이 서는 자리 — 🔴 ${STANCE_LABEL[plan.stance ?? 'REFLECTION']}`,
    ...(plan.stance !== null && plan.stance !== 'SELF_EXPERIENCE'
      ? ['🔴 **이 글 속 경험은 당신 것이 아닙니다.** 겪었다고 쓰지 않습니다.',
         '   생각 · 감정 · 궁금함은 1인칭으로 말해도 됩니다.']
      : []),
    '',
    `## 말투 — 🔴 리듬만 빌립니다. 기준: ${voice.voiceStandard}`,
    /**
     * 🔴 **기준은 경향이지 체크리스트가 아니다** (2026-09-20 실측 보정).
     *
     *    SHADOW5 450407 에서 `길게 · "ㅋㅋ" 자주 · 오타 잦음 · 느낌표 많음` 이
     *    **넣어야 할 항목 목록**으로 읽혔다. "꼬라지" · "터져나갑니다 ㅋㅋㅋ!!" ·
     *    "죽겟네요 진짜!!" 처럼 특징을 한 글에 다 욱여넣었고, 그 과정에서
     *    원문에 없는 표현 4건이 생겼다. 흉내가 사람 글을 밀어냈다.
     *
     * 🔴 **차단 규칙을 더하지 않는다.** 정규식으로 "ㅋㅋ 금지" 를 걸면 자연스러운
     *    글까지 막는다. 무엇을 우선 빌릴지를 **여기서 말로 정한다.**
     */
    '🔴 위 기준은 **그 사람의 경향**입니다. 항목을 하나씩 넣어야 하는 목록이 아닙니다.',
    '   🔴 **모든 특징을 한 글에 다 넣지 않습니다.** 이번 글에 자연스러운 것만 씁니다.',
    '   🔴 **오타를 일부러 만들지 않습니다.**',
    '   🔴 ㅋㅋ · ㅎㅎ · ㅠㅠ · 느낌표 · 사투리는 **원문의 감정과 맞을 때만** 씁니다.',
    '      원문이 담담하면 담담하게 씁니다. 억지로 밝게 만들지 않습니다.',
    '   🔴 사람이 차이를 느끼는 것은 **말끝 · 호흡 · 문장 길이 · 줄바꿈**입니다.',
    '      그것으로 먼저 이 사람의 글처럼 만듭니다.',
    '🔴 아래 참고에서 가져오는 것은 **말끝 · 호흡 · 감정 표현 · 줄바꿈**뿐입니다.',
    '   🔴 참고에 나온 **사건 · 가족 · 직장 · 병 · 돈 이야기는 당신 것이 아닙니다.**',
    ...voice.samples.flatMap((s, i) => [`--- 참고 ${i + 1} ---`, s]),
    '',
    `🔴 쓰지 않는 낱말: ${BANNED_WORDS.join(' · ')}`,
    '🔴 실명 + 소속 · 연락처 · 주소 · 계정을 쓰지 않습니다.',
    '🔴 약 · 용량 · 진단 · 치료를 확정적으로 지시하지 않습니다.',
    '',
    '초안 **한 편**을 JSON 으로만 답합니다.',
    '{"title":"...","body":"..."}',
  ].filter((x) => x !== '').join('\n')
}

/** 🔴 마스킹되고 300자로 묶인 원문 근거를 그대로 건넨다 */
export function buildV2DraftPayload(input: { packet: SourceEvidencePacket }): string {
  return JSON.stringify({ 원문: sourceBlock(input.packet) })
}

// ─────────────────────────────────────────────────────────
// ③ 의미 검수 — 🔴 원문과 초안을 **직접** 견준다
// ─────────────────────────────────────────────────────────

export function buildV2ReviewSystemPrompt(input: {
  plan: SpeakerPlan
  voice: VoiceEvidence
  life: PersonaLifeContract
}): string {
  const warrants = input.plan.warrants
  return [
    '너는 40대 중반~60대 중반 여성 커뮤니티의 글 검수자다.',
    '[원문]과 [초안]을 **직접 견주어** 아래 여섯 가지만 본다.',
    '',
    '## ① droppedFromSource — 원문의 핵심 상황이나 질문이 초안에서 사라졌는가',
    '   evidence 에는 **[원문]에 실제로 있는 문장**을 그대로 옮긴다.',
    '   🔴 말을 바꿔 썼을 뿐 뜻이 남아 있으면 적지 않는다. 표현이 아니라 뜻을 본다.',
    '',
    /**
     * 🔴 **허구 사실과 주관적 표현을 가른다** (2026-09-20 실측 보정).
     *
     *    SHADOW5B 에서 사람이 READY 로 본 글 2편을 이 축이 막았다 —
     *      · "나이가 들수록 운동 없이는 버티기 힘든가 봅니다"
     *      · "아이들 두고 둘만 더 맛난 거 먹으러 나가는 것 같아서 괜히 그렇기도 하고요"
     *    둘 다 **없는 사건을 만든 것이 아니라**, 원문에 이미 있는 생각과
     *    말줄임표·이모티콘의 정서를 화자의 말로 풀어 쓴 것이다.
     *
     * 🔴 **새 축도 새 규칙도 만들지 않는다.** 이 축이 원래 잡아야 하는 것이
     *    무엇인지를 **가려 적을 뿐**이다 — 기준은 "밖에서 확인할 수 있는 사실인가".
     */
    '## ② unsupportedAdditions — [원문]에 없는 **사실**을 새로 넣었는가',
    '   evidence 에는 **[초안]에 실제로 있는 문장**을 그대로 옮긴다.',
    '   🔴 기준은 하나다: **밖에서 확인할 수 있는 사실**을 새로 주장했는가.',
    '',
    '   ### 적는다 (네 가지뿐)',
    '   ②-1 원문에 없는 **사건 · 행동 · 날짜 · 기간** — 밖에서 확인할 수 있는 것',
    '        예) 원문에 없는 "일주일 휴가를 냈다"',
    '   ②-2 원문에 없는 **직접 대사**, 원문에 없는 **겪은 일**',
    '   ②-3 🔴 **원문이 부르지 않은 구체적 생활사** — 초안이 자기 직업 · 사는 곳 ·',
    '        형편 · 자녀 · 혼인 · 부모 돌봄 · 갱년기를 구체적으로 말했는데 [원문]도',
    '        아래 [원문이 부르는 생활사]도 그것을 요구하지 않으면,',
    '        🔴 **이 사람이 실제로 가진 사실이어도 새로 넣은 것이다.**',
    '        예) 원문이 자녀를 부르지 않는데 자녀 이야기를 구체적으로 쓴 것',
    '   ②-4 **원문의 뜻을 바꾸는 사실 주장** — 원문에 없는 행동으로 바꿔 쓴 것',
    '',
    '   ### 적지 않는다',
    '      · 같은 뜻을 **화자의 말로 다시 표현**한 것',
    '      · 원문 상황에서 **자연스럽게 드러나는 감정 · 생각 · 궁금함**',
    '      · 말줄임표 · 이모티콘 · 문맥에 **이미 담긴 정서를 말로 푼 것**',
    '      · 새 사건이나 생활사를 주장하지 않는 **짧은 화자 관점**',
    '      · 인사말',
    '',
    '   🔴 **확신이 서지 않으면 적지 않는다.** 이 축은 지어낸 사실을 잡는 자리이지',
    '      표현을 다듬는 자리가 아니다.',
    '',
    '## ③ lifeContradictions — 초안이 [이 사람의 생활사]와 **다른 사실**을 자기 일로 말했는가',
    `   fact 는 이 중 하나다: ${LIFE_CONTRADICTION_FACTS.join(' · ')}`,
    '   나이 · 자녀 나이도 여기서 본다 ("age" · "childAgeBand").',
    '   형편은 "economicStatus", 배우자와의 관계는 "spouseRelationship" 이다.',
    '   evidence 에는 **[초안]에 실제로 있는 문장**을 그대로 옮긴다.',
    '   🔴 생활사를 **적게 썼다는 이유로 적지 않는다.** 소재에 필요 없으면 안 쓰는 것이 맞다.',
    '   🔴 **불만 · 서운함 · 그날의 다툼을 관계 파탄으로 읽지 않는다.**',
    '      "남편이 집안일을 안 해서 답답하다" 는 원만한 사이에서도 하는 말이다.',
    '      상시 별거 · 이혼 절차 · 관계가 끝났다고 말할 때만 spouseRelationship 이다.',
    '',
    '## ④⑤⑥ issues — 해당하는 것만 고른다. 해당 없으면 빈 배열이다',
    ...SEMANTIC_AXES.map((a) => `   - ${a}: ${SEMANTIC_AXIS_PROMPT[a]}`),
    '',
    '🔴 **말투와 맺음으로 막지 않는다.** 반말도 · 짧은 글도 · 묻지 않고 끝나는 글도',
    '   우리 게시판의 글이다. 다듬어지지 않았다는 이유로, 짧다는 이유로 막지 않는다.',
    '🔴 **소재로 막지 않는다.** 부부 · 가족 · 직장 · 건강 · 방송 · 솔직한 불만은 전부 우리 이야기다.',
    '🔴 **근거를 지어내지 않는다.** 원문이나 초안에 없는 문장을 evidence 에 적지 않는다.',
    '',
    `## 이 글을 쓴 사람이 서는 자리: ${input.plan.stance ?? '정해지지 않음'}`,
    `   ${STANCE_LABEL[input.plan.stance ?? 'REFLECTION']}`,
    ...(input.plan.stance !== 'SELF_EXPERIENCE'
      ? ['🔴 이 자리에서는 **원문 속 경험을 자기 일로 말하면** `lifeContradictions` 다.'] : []),
    `## 이 사람의 말투 기준: ${input.voice.voiceStandard}`,
    '',
    '## 🔴 원문이 부르는 생활사 — 이것만 초안에 나와도 된다',
    ...(warrants.length > 0
      ? warrants.map((w) => `   · ${w.fact} = ${w.requiredValue} (원문 근거: ${w.evidenceText})`)
      : ['   (없음 — 원문이 글쓴이의 생활사를 부르지 않는다)']),
    '',
    '## 이 사람의 생활사 (정본 카드)',
    ...lifeContractLines(input.life).map((x) => `- ${x}`),
    '',
    'JSON 만 답한다:',
    '{"droppedFromSource":[{"evidence":"원문에 있는 문장 그대로","why":"한 줄"}],',
    ' "unsupportedAdditions":[{"evidence":"초안에 있는 문장 그대로","why":"한 줄"}],',
    ' "lifeContradictions":[{"fact":"위 목록의 이름 하나",',
    '                       "drafted":"초안이 주장한 것","card":"카드가 가진 것","evidence":"초안에 있는 문장 그대로"}],',
    ' "issues":["해당하는 것만"],"confidence":0.0~1.0,"note":"한 줄"}',
  ].filter((x) => x !== '').join('\n')
}

/** 🔴 검수는 **생성과 같은 원문**을 본다 — 요약을 거치지 않는다 */
export function buildV2ReviewPayload(input: {
  draft: { title: string; body: string }
  packet: SourceEvidencePacket
}): string {
  return JSON.stringify({
    원문: sourceBlock(input.packet),
    초안: { title: input.draft.title, body: input.draft.body },
  })
}
