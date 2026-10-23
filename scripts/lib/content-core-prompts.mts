/**
 * Content Core v2 프롬프트 — 🔴 **계획도 생성도 마스킹된 원문을 직접 읽는다**
 *
 * 🔴 **왜 이 모양인가** (2026-09-19, 대안 D).
 *    ① 생성이 요약만 받던 판에서는 원문의 말이 단계마다 변했다 → 원문을 직접 준다.
 *    ② 화자 선택이 `claimRequirements` 라는 중간 표현만 보던 판에서는
 *       그 표현이 비는 순간 **모두가 자격자**가 됐다 → 계획이 원문을 직접 보고 요구값을 적는다.
 *    ③ (2026-10-12 Batch B · canon §4.1) 판독은 **Persona 를 보지 않는다.** 요구값을 적으면
 *       코드가 정본 카드로 그 값을 실제로 가진 사람을 찾는다(`decidePersona`).
 *
 * 🔴 **계획 호출에 말투 참고 댓글 본문을 보내지 않는다.** 자격 판정에 필요 없고,
 *    보내면 남의 글이 화자 선택에 섞인다.
 */
import type { SourceEvidencePacket } from '../../src/lib/content-core/evidence'
import { promptNoGoExpressions } from '../../src/lib/persona-no-go'
import { type AxisMapping } from '../../src/lib/content-core/speaker-relative-facts'
import type { LoadBearingRequirement } from '../../src/lib/content-core/load-bearing'
import { CLAIM_FACT_LABEL } from '../../src/lib/content-core/source-facts'
import type { PersonaLifeContract, SpeakerPlan } from '../../src/lib/content-core/speaker'
import { STANCE_LABEL } from '../../src/lib/content-core/speaker'
import type { VoiceEvidence } from '../../src/lib/content-core/voice-evidence'
import {
  LIFE_CONTRADICTION_FACTS, SEMANTIC_AXES, SEMANTIC_AXIS_PROMPT,
} from '../../src/lib/content-core/review'
import { COPY_RUN_CHARS, COPY_RUN_WORDS } from '../../src/lib/draft-originality'
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
// ① 원천 요구 — 🔴 **Persona 중립** (2026-10-12 Batch B · canon §4.1)
//    판독은 원문만 본다. 누가 쓸지는 코드가 정본 카드로 정한다(`decidePersona`).
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **자격 요구값의 어휘** — 후보 풀이 실제로 쓰는 글자만, 사람 이름 없이.
 *
 *    `work` · `region` · `age` · `childAgeBand` 는 카드의 글자와 **완전히 같아야** 코드가 대조할 수 있다.
 *    앞판은 그 글자를 후보 줄(`[P01] … 하는 일 파트타임`)에 실어 보냈다 — 그 줄이 곧 Persona 목록이었다.
 *    이제 **값만** 모아 보낸다. 코드 오름차순·중복 없이 — 같은 풀이면 같은 요청이다.
 */
export function requirementVocabulary(personas: readonly PersonaLifeContract[]): {
  work: string[]; region: string[]; age: string[]; childAgeBand: string[]
} {
  const uniq = (xs: readonly string[]): string[] =>
    [...new Set(xs.map((x) => x.trim()).filter((x) => x !== ''))].sort((a, b) => a.localeCompare(b))
  return {
    work: uniq(personas.map((p) => p.workStatus)),
    region: uniq(personas.map((p) => p.region)),
    age: uniq(personas.map((p) => p.ageBand)),
    childAgeBand: uniq(personas.flatMap((p) => p.childrenAgeBands)),
  }
}

export function buildSpeakerPlanSystemPrompt(): string {
  return [
    '너는 40대 중반~60대 중반 여성 커뮤니티에 올릴 글의 **화자 조건을 정리한다.**',
    '[원문]을 읽고, 이 이야기를 우리 회원이 어떤 자리에서 말해야 하는지와',
    '1인칭으로 말하려면 **그 사람에게 어떤 생활사가 있어야 하는지**를 적는다.',
    '🔴 사람을 고르지 않는다. 누가 쓸지는 코드가 정본 카드로 정한다.',
    '🔴 글을 쓰지 않는다. 요약하지도 않는다.',
    '',
    '## 🔴 원문은 `spans` 로 나뉘어 있다',
    '   각 span 의 `kind`(`title` · `head` · `tail`)가 **곧 `evidenceRef` 다.**',
    '   근거를 적을 때는 그 글자가 **실제로 들어 있는 span 의 kind** 를 쓴다.',
    '   예) 제목에만 있는 말이면 `evidenceRef: "title"`, 본문 앞이면 `"head"`.',
    '   🔴 자리가 틀리면 근거가 **없는 것으로 처리되어** 1인칭이 취소된다.',
    '',
    '## 자리(stance)',
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
    '   · spouse · parentCare · menopause · children → "있음" 또는 "없음"',
    '   · work · region · age · childAgeBand → **[값목록]에 적힌 글자 그대로**',
    '- evidenceRef / evidenceText: 그 요구가 나온 **[원문]의 실제 문장 조각**',
    '',
    '🔴 네가 할 일은 "원문이 어떤 자격을 요구하는가" 를 정하는 것까지다.',
    '   그 자격을 **정본 카드로 실제로 가진 사람**은 코드가 찾는다. 없으면 글을 만들지 않는다.',
    '🔴 근거는 **코드가 대조한다.** 원문에 없는 문장은 1인칭이 취소된다. 지어내면 글이 만들어지지 않는다.',
    '',
    '### selfBasis = "noLifeFactNeeded"',
    '원문이 **특정 생활사 자격을 요구하지 않는** 보편적인 이야기·감정·생각인 경우다.',
    '   예) 김치를 이르게 꺼낸 이야기 · 날씨 · 요즘 드는 생각',
    '`speakerWarrants` 는 **빈 배열**로 두고 `universalReason` 에 왜 그런지 한 줄 적는다.',
    '🔴 **"잘 모르겠다" 는 이 값이 아니다.** 모르면 자리를 낮춘다.',
    '',
    '## 자리를 어떻게 고를까',
    '- 관찰 · 생각 · 물음으로 말해도 이야기가 남으면 → 처음부터 OBSERVATION · REFLECTION · QUESTION',
    '- 당사자 경험이 이 글의 알맹이라 바꾸면 사라지면 → SELF_EXPERIENCE 와 그 자격 근거',
    '- 우리 게시판에 옮길 수 없는 글이면 → `decision: "hold"`',
    '',
    /**
     * 🔴 **원문 화자 자신의 사실은 따로 적는다** (2026-09-23).
     *    우리는 원문 작성자를 복제하지 않는다 — 그 값은 지키는 것이 아니라 **바꾼다.**
     *    다만 나이가 **결론을 바꾸는** 글(지원 자격·의료·임신·보험)은 숫자만 바꿀 수 없다.
     */
    '## speakerRelative — 🔴 **원문 화자 자신의** 사실',
    '- 원문을 쓴 사람의 나이·혼인·자녀 같은 값이다. **우리 사람 값으로 바꿔 쓸 것**이다.',
    '- axis: age (지금은 나이만 받습니다)',
    '- sourceText: 원문에 있는 그 값 **그대로** (예 "44" · "40대 초반")',
    '  🔴 구간은 구간 그대로 적습니다. "40대 초반" 을 "40" 으로 줄이지 마십시오.',
    '- evidenceRef: title|head|tail — 그 값이 나온 자리',
    '- materiality:',
    '   · incidental — 나이를 바꿔도 글의 뜻이 그대로다 (피부·패션·일상·감정)',
    '   · loadBearing — 나이가 **결론을 바꾼다** (지원 자격·연령 제한·의료·임신·보험)',
    '- 🔴 **제3자(아는 분·친구)의 나이는 여기 넣지 않습니다.** 그것은 원문 이야기의 일부입니다.',
    '- 🔴 **원문 화자 자신의 값을 protectedFacts 에 적었다면 여기에도 반드시 적습니다.**',
    '  한 건이라도 빠지면 그 답은 **버려지고 다시 묻습니다** — 기본값으로 통과시키지 않습니다.',
    '- 🔴 materiality 가 loadBearing 이면 그 나이 조건을 만족하는 사람은 **코드가 찾습니다.**',
    '  1인칭이 아니어도 뜻이 남는 글이면 처음부터 OBSERVATION · QUESTION 을 고르십시오.',
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
    ' "stance":"SELF_EXPERIENCE|OBSERVATION|REFLECTION|QUESTION",',
    ' "selfBasis":"lifeFacts|noLifeFactNeeded (SELF_EXPERIENCE 일 때만)",',
    ' "speakerWarrants":[{"fact":"work","requiredValue":"파트타임",',
    '                     "evidenceRef":"title|head|tail","evidenceText":"원문에 있는 조각"}],',
    ' "universalReason":"noLifeFactNeeded 일 때 한 줄",',
    ' "speakerRelative":[{"axis":"age","sourceText":"44","evidenceRef":"head",',
    '                      "materiality":"incidental|loadBearing"}],',
    ' "protectedFacts":[{"kind":"...","text":"...","evidenceRef":"title|head|tail"}],',
    ' "closingIntent":"ask|vent|share|none",',
    ' "contentRoles":["..."]}',
  ].join('\n')
}

/**
 * 🔴 **원문을 span 으로 나눠 보낸다** (2026-09-19 실측 보정).
 *    모델이 어느 글자가 어느 자리에 있는지 알아야 `evidenceRef` 를 바로 적는다.
 *
 * 🔴 **Persona 를 싣지 않는다** (2026-10-12 Batch B). 후보 줄 · 코드 · 말투 참고 댓글 없이
 *    자격 값 어휘(`requirementVocabulary`)만 싣는다 — 판독이 사람을 고를 재료가 없다.
 * 🔴 원문 내용·개인정보 범위는 늘리지 않는다 — 이미 마스킹되고 300자로 묶인 그 span 들이다.
 */
export function buildSpeakerPlanPayload(input: {
  packet: SourceEvidencePacket
  /** 🔴 어휘를 만드는 데만 쓴다 — 코드·순서는 요청에 실리지 않는다 */
  personas: readonly PersonaLifeContract[]
  /**
   * 🔴 **같은 원천의 지난 실패** (2026-09-23 마스터 지적). 왜 실패했는지 모르면 같은 계획을
   *    또 세운다. 🔴 Persona 이름 없이 `자리 · 사유` 만 싣는다(`priorFailureNeedLines`).
   */
  priorFailures?: readonly string[]
  /** 🔴 지난 시도가 "조건을 만족하는 사람이 없다" 로 멈췄다 — 1인칭을 쓰면 안 된다 */
  selfForbidden?: boolean
}): string {
  const p = input.packet
  const prior = input.priorFailures ?? []
  return JSON.stringify({
    원문: {
      // 🔴 packet 에 **실제로 있는 span 만** — 없는 자리를 지어내 보내지 않는다
      spans: p.spans.map((x) => ({ kind: x.kind, text: x.text })),
      bodyLength: p.bodyLength,
      truncated: p.truncated,
    },
    값목록: requirementVocabulary(input.personas),
    // 🔴 빈 칸을 넣지 않는다 — 빈 배열은 "지난 시도가 없다" 와 구분되지 않는다
    ...(prior.length === 0 ? {} : { 지난실패: prior }),
    ...(input.selfForbidden !== true ? {} : {
      금지: ['🔴 stance 를 SELF_EXPERIENCE 로 쓰지 마십시오 — '
        + '원문의 핵심 조건을 만족하는 사람이 없습니다. '
        + 'OBSERVATION · QUESTION · REFLECTION 중에서 고르고 selfBasis 는 비웁니다.'],
    }),
  })
}

// ─────────────────────────────────────────────────────────
// ② 생성 — 한 편. 🔴 원문을 직접 읽는다
// ─────────────────────────────────────────────────────────

export function buildV2DraftSystemPrompt(input: {
  plan: SpeakerPlan
  voice: VoiceEvidence
  life: PersonaLifeContract
  /**
   * 🔴 **성공한 변환 계획만 받는다** (2026-09-23 fail-closed).
   *    앞판은 여기서 `planAxisMapping` 을 부르고 `mapping.ok ? … : []` 로 넘겼다 —
   *    실패해도 **빈 지시로 조용히 생성**됐고, 그러면 `protectedFacts` 에서 빠진
   *    사실이 대체 없이 사라진다. 이제 **부르는 쪽(`runContentCore`)이 먼저 판정**하고,
   *    성공했을 때만 그 결과를 여기로 넘긴다.
   */
  mappings: readonly AxisMapping[]
  /**
   * 🔴 **바꾸지 말고 지켜야 하는 조건** (2026-09-23 마스터 P0-2).
   *    `mappings`(바꿔라)와 **섞지 않는다** — 반대 지시다.
   */
  keep?: readonly LoadBearingRequirement[]
}): string {
  const { plan, voice, life } = input
  const replacements = input.mappings.map((m) => m.outputRule)
  const keeps = (input.keep ?? []).map((k) => k.outputRule)
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
    /**
     * 🔴 **원문 작성자를 복제하지 않습니다** (2026-09-23).
     *    원문 화자의 나이·혼인·자녀 같은 사실은 **지키는 것이 아니라 바꾸는 것**입니다.
     *    🔴 빼기만 하면 내용이 사라집니다 — 여기서 **무엇으로 바꿀지**를 줍니다.
     */
    ...(replacements.length > 0
      ? ['', '## 🔴 원문 작성자의 사실 → 당신의 사실로 바꿔 씁니다',
        ...replacements.map((r) => `- ${r}`),
        '- 🔴 위 값을 **빼지 말고 바꿉니다.** 그 자리를 비우면 글이 어색해집니다.',
        '- 🔴 배우자·자녀·건강·돈·나이·사는 곳처럼 검증이 필요한 생활 사실은 원문이나 카드 근거 없이 더하지 않습니다.']
      : []),
    /**
     * 🔴 **결론을 만드는 조건은 반대로 지킵니다** (2026-09-23).
     *    바꾸면 글이 성립하지 않습니다 — 위 "바꿔 씁니다" 와 **다른 목록**입니다.
     */
    ...(keeps.length > 0
      ? ['', '## 🔴 이 값은 **바꾸지 말고 지킵니다** (바꾸면 글이 성립하지 않습니다)',
        ...keeps.map((r) => `- ${r}`)]
      : []),
    ...(plan.closingIntent === 'ask'
      ? ['- 원문은 묻고 끝납니다. 그 물음이 살아 있어야 합니다.']
      : plan.closingIntent === 'none'
        ? ['- 원문은 묻지 않습니다. 억지로 질문을 붙이지 않습니다.']
        : []),
    '',
    '## 새로 쓰는 것',
    '- 문장과 문단 구성은 **처음부터 새로** 씁니다. 원문 문장을 옮겨 적지 않습니다.',
    '- 원문 핵심을 바꾸지 않는 범위에서 **감상 · 질문 · 비유 · 연결 문장 · 일반적인 관찰**로 새 글을 만듭니다.',
    '- 원문이 짧아도 요약문으로 끝내지 않습니다. 다만 새 사건이나 결말을 지어 길이를 채우지 않습니다.',
    '- 🔴 원문에 없는 **제3자의 사건 · 날짜 · 직접 대사 · 결과**를 사실처럼 만들지 않습니다.',
    '- 🔴 원문에 없는 **새벽 · 아침 · 퇴근길 · 방금 · 어제** 같은 시간대·상대 시점을 붙이지 않습니다. 언제 발행될지는 이 글이 모릅니다.',
    '- 🔴 원문 화자가 자기 일로 한 말을 **"아는 분이" · "누가 그러는데" · "지인이"** 같은 새 전달자의 일로 바꾸지 않습니다.',
    '  화자 자신의 경험으로 쓸 근거가 없으면 새 전언 사건을 만들지 말고 감상·질문 중심으로 재구성합니다.',
    '- 🔴 배우자 · 자녀 · 부모 · 건강 · 치료 · 돈 · 정확한 나이 · 거주지 같은 구체 생활 사실은 원문이나 아래 카드 근거 없이 만들지 않습니다.',
    '- 🟢 짧은 직장 경험 같은 저위험 일상 결은 원문 뜻과 충돌하지 않을 때만 자연스럽게 쓸 수 있습니다.',
    '- 🟢 "우리 집도 그래요"처럼 구체 사실이 없는 공감 표현은 쓸 수 있습니다.',
    // 🔴 (v2-draft-p10 · quality-v6) 원문 글쓴이의 만남·대화·들음은 그 사람의 경험이다 — 모든 자리에서.
    //    최종 게이트(`draft-life-gates` 만남)가 같은 선으로 막는다(위 "이번에 원문이 부른 것" 근거가 그 만남을 담을 때만 예외)
    '- 🔴 원문 글쓴이가 **누구를 만나고 · 이야기를 나누고 · 들은 일**은 그 사람의 경험입니다. 당신이 만나고 들은 일로 옮기지 않습니다.',
    '  그 이야기는 "어떤 분이 … 그러셨대요" 처럼 **그 사람을 주어로** 전합니다.',
    /**
     * 🔴 (v2-draft-p11 · 2026-10-13 의미 손실 감사) 전하는 말에 **보고 · 읽고 · 들은 경로**를 덧붙이지 않는다.
     *    운영 08:15·12:15 두 편이 `어디서 봤는데` · `어떤 글을 봤는데` 를 붙였고, 의미 검수가 원문에 없는
     *    겪은 일로 적었다(SEMANTIC_UNSUPPORTED_ADDITION). 검수 기준은 그대로 두고 생성이 그 말을 만들지 않는다.
     */
    '  🔴 그 이야기를 **어디서 보고 · 읽고 · 들었는지**는 지어내지 않습니다. "어디서 봤는데" · "어떤 글을 봤는데" 를 붙이지 않고 바로 전합니다.',
    '  예) 원문이 "남편이 집안일을 안 한다" 뿐이면,',
    '      "주말에 밥 차려달라고 하면 난리가 난다" 같은 장면을 **지어내지 않습니다.**',
    '',
    '## 당신은 이런 사람입니다',
    ...lifeContractLines(life).map((x) => `- ${x}`),
    '🔴 이것은 **당신이 이 글을 쓸 자격이 있는지**를 정하는 정보입니다. 글의 재료가 아닙니다.',
    '🔴 **원문이 부르지 않은 사는 곳 · 형편 · 배우자 · 자녀 · 부모 · 건강 · 나이 사실은 글에 넣지 않습니다.**',
    ...(plan.warrants.length > 0
      ? [`   이번에 원문이 부른 것: ${plan.warrants.map((w) => `${w.fact}=${w.requiredValue}`).join(' · ')}`]
      : ['   이번에 원문이 부른 생활사는 없습니다.']),
    '🔴 여기 없는 고위험 생활사를 새로 지어내지도 않습니다.',
    ...(life.noGoTopics.length > 0
      ? [`🔴 이 행동은 하지 않습니다: ${life.noGoTopics.join(' · ')}`,
         '   (비슷한 주제를 통째로 피하라는 뜻이 아닙니다)']
      : []),
    // 🔴 (quality-v5) 개인 말버릇(열쇠) + 전원 공통 금지(§7-2) — `persona-no-go` 하나. 개인 목록이 비어도 공통은 싣는다.
    //    생성 뒤 최종 게이트(`draft-life-gates` personaNoGo)가 같은 판정으로 막는다
    `🔴 이 말버릇은 쓰지 않습니다: ${promptNoGoExpressions(life.noGoExpressions).join(' · ')}`,
    '🔴 불릿 · 번호 목록 · 마크다운 제목 · 굵은 글씨 · "먼저/다음으로/마지막으로" 식 정리를 쓰지 않습니다',
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
    '',
    '## 🔴 [보존] — 원문에서 반드시 살릴 것 (코드가 원문에서 골라 함께 보냅니다)',
    '- 그대로쓸말: 이 목록의 **짧은 원자적 사실만** 글자 그대로 씁니다. 원문의 앞뒤 문장은 옮기지 않습니다',
    '- 원문의물음: 원문이 던진 **물음의 뜻**을 살립니다. 문장과 표현은 새로 씁니다',
    '- 원문범위: "일부" 면 [원문]은 머리와 꼬리만 있습니다. 비어 있는 가운데와 뒤는 **모릅니다** — 지어 채우지 않습니다',
    '',
    '## 🔴 원문과 겹치지 않게 마무리합니다',
    '- [보존].그대로쓸말 밖의 문장과 표현은 원문에서 옮기지 말고 새로 씁니다.',
    `- 답하기 전 [원문]과 다시 견주어, **연속 ${COPY_RUN_WORDS}어절** 또는 **공백을 빼고 ${COPY_RUN_CHARS}자** 이상 같은 부분이 있으면 그 문장을 다시 씁니다.`,
    '- 핵심 사실·감정·물음은 남기되, 어순·문장 구조·말투는 이 화자의 글로 바꾸어야 합니다.',
    '',
    '초안 **한 편**을 JSON 으로만 답합니다.',
    '{"title":"...","body":"..."}',
  ].filter((x) => x !== '').join('\n')
}

/**
 * 🔴 **생성 전에 보존할 원문 사실을 구조로 건넨다** (v2-draft-p12 · 2026-10-15 복제 수율 회귀 보정).
 *
 *    앞판은 원문 한 덩어리만 보냈다. 지킬 말·물음·원문이 어디까지인지는 지시문 문장 속에 흩어져 있거나
 *    아예 없었다 — 특히 근거가 머리·꼬리뿐인지 알리지 않아, 생성은 300자 조각을 글 전체로 읽었다.
 *
 * 🔴 **값은 전부 코드가 원문과 계획에서 고른다.** 새 유료 호출 0 · 계획 출력 칸 0(계획 답이 길어지면 잘린다).
 *    · 그대로쓸말 — 계획이 지목하고 코드가 원문 자리에서 확인한 `protectedFacts` 그대로
 *    · 원문의물음 — 원문이 묻고 끝날 때만, 원문 근거에 **실제로 있는** `?` 문장. 낱말 사전이 아니라 물음표다
 *    · 원문범위 — 근거 묶음이 본문을 잘랐는가(`packet.truncated`)
 * 🔴 의미 검수는 이것을 받지 않는다 — 검수 입력·기준은 그대로다.
 */
export function sourceKeepOf(plan: SpeakerPlan, packet: SourceEvidencePacket): {
  그대로쓸말: string[]; 원문의물음: string[]; 원문범위: '전체' | '일부'
} {
  const questions = plan.closingIntent !== 'ask' ? [] : [...new Set(
    packet.spans
      .flatMap((s) => s.text.split(/(?<=[?？])|\n+/))
      .map((x) => x.trim())
      .filter((x) => /[?？]$/.test(x) && /[가-힣]/.test(x)),
  )]
  return {
    그대로쓸말: [...new Set(plan.protectedFacts.map((f) => f.text))],
    원문의물음: questions,
    원문범위: packet.truncated ? '일부' : '전체',
  }
}

/** 🔴 마스킹되고 300자로 묶인 원문 근거와 그 원문에서 살릴 것을 함께 건넨다 */
export function buildV2DraftPayload(input: { packet: SourceEvidencePacket; plan: SpeakerPlan }): string {
  return JSON.stringify({ 원문: sourceBlock(input.packet), 보존: sourceKeepOf(input.plan, input.packet) })
}

// ─────────────────────────────────────────────────────────
// ③ 의미 검수 — 🔴 원문과 초안을 **직접** 견준다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 (v2-review-p8 · 2026-10-13 · 14:40 감사 결함) **구체적 가족 사실** — 검수가 `아들 둘 데리고`(카드 자녀 1명)를
 *    모순 0 · 신뢰 0.95 로 놓쳤다. 계획(`speaker-plan-v8`) · 초안 게이트(`draft-gates-v8`)와 **같은 범위**를 적는다:
 *    수 · 자기 자녀를 가리키는 성별(`우리 딸` · `아들 둘` · `딸 키우는`) · 나이대. 화제로서의 `딸 얘기` 는 아니다.
 *    🔴 다른 축의 기준은 한 글자도 바꾸지 않는다 — 이 줄들을 지우면 p7 과 같다(의미 손실 검사가 대조한다).
 */
export const REVIEW_FAMILY_SPECIFICS_LINES: readonly string[] = [
  '   🔴 **구체적 가족 사실** — 초안이 글쓴이 **자기 자녀**의 수 · 성별 · 나이대를 말했는데 아래 정본 카드가 그 값을 보증하지 않으면',
  '      lifeContradictions 다(fact "children" · "childAgeBand"). 카드에는 **자녀 성별 칸이 없다**.',
  '      예) 카드 자녀 1명인데 "아들 둘 데리고" · "우리 딸이"(성별) · 카드 나이대가 초등인데 "중학생 아들"',
  '      🔴 남의 자녀 · 남이 한 말(`할아버지가 본인도 아들 둘이라고`) · 화제로서의 "딸 얘기" 는 아니다.',
]

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
    '## ① droppedFromSource — 빠져서 원문의 뜻·결론·핵심 질문이 달라지는 내용이 있는가',
    '   evidence 에는 **[원문]에 실제로 있는 문장**을 그대로 옮긴다.',
    '   🔴 사소한 세부 · 문장 순서 · 표현을 줄였다는 이유로 적지 않는다.',
    '   🔴 말을 바꿔 썼거나 재구성했어도 핵심 뜻과 결론이 남아 있으면 적지 않는다.',
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
    '## ② unsupportedAdditions — [원문]이나 허가된 카드 근거에 없는 **위험한 사실**을 새로 넣었는가',
    '   evidence 에는 **[초안]에 실제로 있는 문장**을 그대로 옮긴다.',
    '   🔴 모든 새 문장을 잡는 칸이 아니다. 아래 위험 범주만 적는다.',
    '',
    '   ### 적는다 (다음 위험 범주만)',
    '   ②-1 원문에 없는 **제3자의 사건 · 행동 · 날짜 · 기간 · 결과**',
    '        예) 원문에 없는 "일주일 휴가를 냈다"',
    '        🔴 원문에 없는 **새벽 · 아침 · 퇴근길 · 방금 · 어제** 같은 시간대·상대 시점도 여기 적는다.',
    '   ②-2 원문에 없는 **직접 대사**, 원문이나 카드가 뒷받침하지 않는 고위험 1인칭 경험',
    '   ②-3 🔴 **원문이 부르지 않은 구체적 고위험 생활사** — 초안이 자기 사는 곳 ·',
    '        형편 · 배우자 · 자녀 · 부모 · 건강 · 치료 · 나이 · 갱년기를 구체적으로 말했는데 [원문]도',
    '        아래 [원문이 부르는 생활사]도 그것을 요구하지 않으면,',
    '        🔴 **이 사람이 실제로 가진 사실이어도 새로 넣은 것이다.**',
    '        예) 원문이 자녀를 부르지 않는데 자녀 이야기를 구체적으로 쓴 것',
    '   ②-4 **원문의 뜻을 바꾸는 사실 주장** — 원문에 없는 행동으로 바꿔 쓴 것',
    '        🔴 원문 화자의 자기 일을 "아는 분이" · "누가 그러는데" · "지인이" 같은 새 전달자의 일로 바꾸는 것도 여기 적는다.',
    '',
    '   ### 적지 않는다',
    '      · 같은 뜻을 **화자의 말로 다시 표현**한 것',
    '      · 원문 상황에서 **자연스럽게 드러나는 감정 · 생각 · 궁금함**',
    '      · 말줄임표 · 이모티콘 · 문맥에 **이미 담긴 정서를 말로 푼 것**',
    '      · 독자에게 던지는 질문 · 비유 · 연결 문장 · 일반적인 관찰 · 새로운 문단 구성',
    '      · 원문 뜻과 충돌하지 않는 짧은 저위험 일상 결(예: 일반적인 직장 공감)',
    '      · 구체 사실을 주장하지 않는 "우리 집도 그래요" 같은 공감 표현',
    '      · 새 위험 사실을 주장하지 않는 **짧은 화자 관점**',
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
    ...REVIEW_FAMILY_SPECIFICS_LINES,
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
