/**
 * 검수 데이터 — 갱년기 이후 살이 잘 안 빠지는 이유
 *
 * ⚠️ riskSentences 는 brief.md 에서 "그대로 넣으라"고 지시한 문장이다.
 *    ChatGPT 원고가 나온 뒤 실제 본문과 대조해 확정한다.
 */
import type { ReviewData } from '../_template/review'

export const REVIEW: ReviewData = {
  slug: 'weight-harder-after-menopause',

  summary: [
    '며칠 신경 썼는데 체중계 숫자가 그대로인 순간으로 시작해 "의지 문제가 아니다"를 먼저 인정',
    '호르몬 변화가 지방을 쓰고 쌓는 방식에 영향을 준다는 설명을 단정 없이 제시',
    '함께 겹치는 요인 5가지를 제시하되 사람마다 다르다는 전제를 붙임',
    '예전 방법이 안 통하는 이유를 방식이 아니라 몸의 변화로 설명하고, 급격한 변화면 진료를 권함',
    '무리하지 않는 것 4가지를 숫자 처방 없이 제시하고 갱년기톡으로 연결',
  ],

  riskSentences: [
    '호르몬 변화가 몸이 지방을 쓰고 쌓는 방식에 영향을 준다고 이야기됩니다.',
    '어떤 변화가 더 크게 느껴지는지는 사람마다 다릅니다.',
    '예전만큼 빠지지 않는다고 해서 의지가 약한 것이 아닙니다.',
    '다만 체중이 갑자기 크게 변했다면 병원에서 확인해 보시는 편이 좋습니다.',
    '숫자보다 몸이 편한지를 먼저 보셔도 됩니다.',
  ],

  risk: { medical: 'MEDIUM', money: 'NONE', legal: 'NONE' },

  factsToVerify: [
    'body-change 시리즈 1편으로서 앞으로의 톤 기준이 될 만한가',
    '특정 다이어트법·보조제·비만약이 하나도 언급되지 않았는가',
    '칼로리·체중 목표·운동 시간 같은 숫자 처방이 없는가',
    '살이 찐 것을 실패나 방치로 그리지 않았는가',
  ],

  forbiddenPatterns: [
    '간헐적 단식', '저탄고지', '키토', '원푸드', '단식',
    '다이어트 보조제', '체지방률', '비만약', '삭센다', '위고비',
    '단백질 보충제', '호르몬 치료', '대사증후군', '갑상선기능저하',
  ],

  preparedAt: '2026-08-25',
  preparedBy: 'Claude Code',
  notes:
    'producer 2차 2건 중 2편. body-change 시리즈 첫 글이라 톤 기준이 된다. ' +
    'imageMode REQUIRED — hero 가 없으면 batch-qa 가 BLOCKED 를 낸다. ' +
    'riskSentences 는 원고 확정 후 실제 문장으로 대조·갱신할 것.',
}
