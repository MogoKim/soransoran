#!/usr/bin/env tsx
/**
 * 🔴 **원문 꼴 재기 · 초안 요청 배선 검사** (quality-v30 · v2-draft-p17)
 *
 *   npm run content:source-form-check
 *
 * ① `sourceFormOf` 가 실제 원문 꼴(두 줄 · 마침표 없음 · ㅋㅋ 끝 · 빈 줄 많음 · 한 줄 · 빈 본문 …)을 잰 값
 * ② 초안 지시문에 "낱말은 새로, 꼴은 원문 그대로" 절이 있고 지운 문장이 없다
 * ③ 생성 요청 페이로드에 `꼴` 이 실리고 그 값이 원문 본문(제목 제외 · 보이는 부분)의 `sourceFormOf` 와 같다
 * 🔴 네트워크 0 · provider 0 · DB 0. 실제 함수를 돌려 값을 본다.
 */
import { buildEvidencePacket } from '../src/lib/content-core/evidence'
import { sourceFormOf, SOURCE_FORM_LINE_SHAPES_MAX, type SourceForm } from '../src/lib/content-core/source-form'
import { buildV2DraftPayload, buildV2DraftSystemPrompt, DRAFT_FORM_LINES } from './lib/content-core-prompts.mjs'
import type { PersonaLifeContract, SpeakerPlan } from '../src/lib/content-core/speaker'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, extra = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${extra === '' ? '' : ` — ${extra}`}`) }
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

console.log('\n══ 원문 꼴 재기 · 초안 요청 배선 (네트워크 0 · provider 0 · DB 0) ══')

// ─────────────────────────────────────────────────────────
console.log('\n① sourceFormOf — 실제 꼴 사례')
// ─────────────────────────────────────────────────────────
{
  const EMPTY: SourceForm = {
    글자수: 0, 줄수: 0, 마침표로끝나는줄: 0, 어미없이끊긴줄: 0, 말줄임: 0, 울음웃음: 0, 물음표: 0, 느낌표: 0, 줄끝모양: [], 끝맺음: '',
  }
  const cases: { name: string; body: string; want: Partial<SourceForm> }[] = [
    { name: '빈 본문', body: '', want: EMPTY },
    { name: '공백·빈 줄뿐', body: '  \n\n \t\n', want: EMPTY },
    { name: '한 줄 글 · 마침표 없음',
      body: '오늘 김장했는데 허리가 끊어질듯',
      want: { 글자수: 17, 줄수: 1, 마침표로끝나는줄: 0, 어미없이끊긴줄: 1, 줄끝모양: ['끊어질듯'], 끝맺음: '했는데 허리가 끊어질듯' } },
    { name: '두 줄 글 · 물음표로 끝',
      body: '갱년기 열감 때문에 잠을 못자요\n다들 어떻게 버티세요?',
      want: { 줄수: 2, 마침표로끝나는줄: 0, 어미없이끊긴줄: 0, 물음표: 1, 줄끝모양: ['을못자요', '티세요?'], 끝맺음: '다들 어떻게 버티세요?' } },
    { name: 'ㅋㅋ 로 끝나는 글',
      body: '남편이 설거지를 했어요\n해가 서쪽에서 뜨려나 ㅋㅋㅋ',
      want: { 줄수: 2, 울음웃음: 1, 어미없이끊긴줄: 0, 줄끝모양: ['를했어요', '나ㅋㅋㅋ'], 끝맺음: '서쪽에서 뜨려나 ㅋㅋㅋ' } },
    { name: '빈 줄 많은 글 — 빈 줄은 세지 않는다',
      body: '첫 줄이에요\n\n\n\n둘째 줄\n\n\n셋째 줄입니다.',
      want: { 줄수: 3, 글자수: 6 + 4 + 8, 마침표로끝나는줄: 1, 어미없이끊긴줄: 1 } },
    { name: '마침표로 끝나는 반듯한 글',
      body: '오늘은 병원에 다녀왔습니다.\n검사 결과는 괜찮다고 합니다.',
      want: { 줄수: 2, 마침표로끝나는줄: 2, 어미없이끊긴줄: 0, 말줄임: 0 } },
    { name: '말줄임 — .. · ... · … 는 덩어리마다 한 번',
      body: '그냥 그렇다구요..\n뭐 어쩌겠어요...\n그래도…… 참',
      want: { 말줄임: 3, 마침표로끝나는줄: 0, 어미없이끊긴줄: 1 } },
    { name: '울음 · 웃음 덩어리 — ㅠㅜ 섞임 하나 · ㅎㅎ 하나 · ㅋ 하나는 세지 않는다',
      body: '너무 속상해요 ㅠㅜㅠ\n그래도 웃어야죠 ㅎㅎ\n아 ㅋ',
      want: { 울음웃음: 2, 줄수: 3 } },
    { name: '느낌표 · 전각 물음표',
      body: '진짜요!!\n정말요？',
      want: { 느낌표: 2, 물음표: 1, 마침표로끝나는줄: 0 } },
    { name: 'zero-width 와 \\r\\n 은 꼴에 들어가지 않는다',
      body: '​첫줄이에요\r\n​\r\n둘째줄요​',
      want: { 줄수: 2, 글자수: 5 + 4, 줄끝모양: ['줄이에요', '둘째줄요'], 끝맺음: '둘째줄요' } },
    { name: '어미 없이 끊긴 줄 — 는데 · 인듯 · 했음',
      body: '아침에 일어났는데\n몸이 무거운게 몸살인듯\n결국 병원 갔음',
      want: { 어미없이끊긴줄: 3, 마침표로끝나는줄: 0 } },
  ]
  for (const c of cases) {
    const got = sourceFormOf(c.body)
    const diff = Object.entries(c.want).filter(([k, v]) => !same(got[k as keyof SourceForm], v))
    check(`${c.name}`, diff.length === 0, diff.map(([k, v]) => `${k}: 기대 ${JSON.stringify(v)} · 지금 ${JSON.stringify(got[k as keyof SourceForm])}`).join(' / '))
  }
  const long = Array.from({ length: 20 }, (_, i) => `${i + 1}번째 줄이에요`).join('\n')
  const lf = sourceFormOf(long)
  check(`줄끝모양은 앞에서 ${SOURCE_FORM_LINE_SHAPES_MAX}줄까지 · 줄수는 전부 · 끝맺음은 마지막 줄`,
    lf.줄수 === 20 && lf.줄끝모양.length === SOURCE_FORM_LINE_SHAPES_MAX && lf.끝맺음 === '20번째 줄이에요',
    JSON.stringify({ 줄수: lf.줄수, n: lf.줄끝모양.length, 끝: lf.끝맺음 }))
  check('끝맺음은 마지막 줄의 마지막 12글자', sourceFormOf('가나다라마바사아자차카타파하 끝이에요').끝맺음 === '아자차카타파하 끝이에요')
  check('같은 본문이면 같은 값(순수)', same(sourceFormOf(long), sourceFormOf(long)))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 초안 지시문 — 꼴 절이 있고 지운 문장이 없다')
// ─────────────────────────────────────────────────────────
const LIFE: PersonaLifeContract = {
  code: 'P01', ageBand: '50대 초반', region: '수도권', maritalStatus: '기혼', spouseRelationship: '원만',
  childrenCount: 1, childrenAgeBands: ['성인'], workStatus: '전업', economicStatus: '보통',
  menopauseStatus: '중', parentCare: '없음', personality: [], noGoTopics: [], noGoExpressions: [],
} as unknown as PersonaLifeContract
const planOf = (stance: SpeakerPlan['stance'], closingIntent: string): SpeakerPlan => ({
  decision: 'ok', personaCode: 'P01', stance, selfBasis: stance === 'SELF_EXPERIENCE' ? 'noLifeFactNeeded' : null,
  warrants: [], universalReason: '보편적인 이야기', protectedFacts: [], speakerRelative: [],
  closingIntent, contentRoles: ['conversationSpark'], reason: '', rejection: null, planVersion: 'x',
}) as unknown as SpeakerPlan
/** 🔴 v2-draft-p17 에서 지운 지시 — 되살아나면 초안이 다시 원문보다 길고 반듯해지고 같은 맺음말로 수렴한다 */
const DELETED_LINES = [
  '- 문장과 문단 구성은 **처음부터 새로** 씁니다. 원문 문장을 옮겨 적지 않습니다.',
  '- 원문 핵심을 바꾸지 않는 범위에서 **감상 · 질문 · 비유 · 연결 문장 · 일반적인 관찰**로 새 글을 만듭니다.',
  '- 원문이 짧아도 요약문으로 끝내지 않습니다. 다만 새 사건이나 결말을 지어 길이를 채우지 않습니다.',
  '말투 — 🔴 리듬만 빌립니다',
  '   🔴 남의 사연으로 옮겨 전하지도 않습니다. 그 주제를 두고 **당신이 묻고 생각하는 글**로 씁니다.',
  '   생각 · 감정 · 궁금함은 1인칭으로 말해도 됩니다.',
  '  당신의 경험으로 쓸 수 없는 자리면 그 일을 **사건으로 전하지 않고**, 같은 주제에 대한 당신의 질문·생각으로 씁니다.',
  '- 핵심 사실·감정·물음은 남기되, 어순·문장 구조·말투는 이 화자의 글로 바꾸어야 합니다.',
  '  제목 문장은 당신의 말로 새로 짓습니다. 원문 제목을 그대로 옮기지 않습니다.',
  '- 원문은 묻고 끝납니다. 그 물음이 살아 있어야 합니다.',
  '- 원문은 묻지 않습니다. 억지로 질문을 붙이지 않습니다.',
]
{
  for (const [stance, closing] of [['SELF_EXPERIENCE', 'ask'], ['QUESTION', 'none'], ['REFLECTION', 'vent']] as const) {
    const sys = buildV2DraftSystemPrompt({ plan: planOf(stance, closing), life: LIFE, mappings: [] })
    const lines = sys.split('\n')
    check(`${stance}/${closing}: "낱말은 새로, 꼴은 원문 그대로" 절이 줄 그대로 있다`,
      DRAFT_FORM_LINES.every((l) => lines.includes(l)) && lines.includes('## 🔴 낱말은 새로, 꼴은 원문 그대로'))
    const back = DELETED_LINES.filter((l) => sys.includes(l))
    check(`${stance}/${closing}: 지운 문장이 하나도 없다`, back.length === 0, back.join(' | '))
    check(`${stance}/${closing}: 제목 길이는 원문 제목의 0.7~1.3배`,
      lines.includes('  제목 길이는 원문 제목의 0.7~1.3배입니다. 원문 제목이 짧으면 짧게 둡니다 — 설명하는 문장으로 늘리지 않습니다. 원문 제목과 글자가 똑같지만 않으면 됩니다.'))
    check(`${stance}/${closing}: [보존] 설명에 꼴 줄이 있다`, lines.some((l) => l.startsWith('- 꼴: ')))
  }
  const q = buildV2DraftSystemPrompt({ plan: planOf('QUESTION', 'ask'), life: LIFE, mappings: [] })
  check('1인칭이 아닌 자리 — 원문의 물음·생각은 원문의 꼴대로',
    q.split('\n').includes('   🔴 남의 사연으로 옮겨 전하지도 않습니다. 원문의 물음이나 생각이 있으면 그것을 원문의 꼴대로 씁니다.'))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 생성 요청 페이로드 — 꼴이 실리고 원문 본문의 값과 같다')
// ─────────────────────────────────────────────────────────
{
  const plan = planOf('SELF_EXPERIENCE', 'none')
  const BODY = '남편이 설거지를 했어요\n\n해가 서쪽에서 뜨려나 ㅋㅋㅋ\n다들 이런 날 있죠..'
  const full = buildEvidencePacket({ sourceArticleId: 's1', title: '남편 설거지', maskedBody: BODY })
  const longBody = Array.from({ length: 40 }, (_, i) => `${i + 1}번째 줄은 이렇게 길게 이어지는데`).join('\n')
  const cut = buildEvidencePacket({ sourceArticleId: 's2', title: '긴 글 제목이에요', maskedBody: longBody })
  check('잘린 원문 표본이 실제로 잘렸다(머리·꼬리)', cut.truncated && !full.truncated)
  for (const [name, packet] of [['전체 원문', full], ['잘린 원문', cut]] as const) {
    const raw = JSON.parse(buildV2DraftPayload({ packet, plan })) as Record<string, unknown>
    // 🔴 기대값은 span 에서 직접 잇는다 — 러너의 이음 함수를 거치지 않는다
    const visible = packet.spans.filter((s) => s.kind !== 'title').map((s) => s.text).join('\n')
    check(`${name}: 페이로드에 원문 · 보존 · 꼴 · 제목글자수가 있다`,
      same(Object.keys(raw), ['원문', '보존', '꼴', '제목글자수']), Object.keys(raw).join(','))
    check(`${name}: 꼴 = sourceFormOf(보이는 본문 · 제목 제외)`, same(raw.꼴, sourceFormOf(visible)), JSON.stringify(raw.꼴))
    check(`${name}: 꼴에 제목이 섞이지 않는다`, !JSON.stringify(raw.꼴).includes(packet.title) || visible.includes(packet.title))
    check(`${name}: 제목글자수 = 원문 제목 글자 수`, raw.제목글자수 === [...packet.title].length, String(raw.제목글자수))
  }
  const fullForm = (JSON.parse(buildV2DraftPayload({ packet: full, plan })) as { 꼴: SourceForm }).꼴
  check('전체 원문 꼴 — 세 줄 · 끝맺음 "다들 이런 날 있죠.."',
    fullForm.줄수 === 3 && fullForm.끝맺음 === '다들 이런 날 있죠..' && fullForm.말줄임 === 1 && fullForm.울음웃음 === 1, JSON.stringify(fullForm))
  const cutForm = (JSON.parse(buildV2DraftPayload({ packet: cut, plan })) as { 꼴: SourceForm }).꼴
  check('잘린 원문 꼴 — 보이는 부분만 잰다(원문 40줄보다 적다)', cutForm.줄수 > 0 && cutForm.줄수 < 40, String(cutForm.줄수))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)
