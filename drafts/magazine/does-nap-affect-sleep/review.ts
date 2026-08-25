/**
 * 검수 데이터 — 낮잠이 밤잠을 방해할까요
 *
 * LOW 등급이라 riskSentences 는 두지 않는다(전략 §5.1).
 * 대신 forbiddenPatterns 로 진단명·시간 처방·낮잠 금지 톤을 기계가 막는다.
 */
import type { ReviewData } from '../_template/review'

export const REVIEW: ReviewData = {
  slug: 'does-nap-affect-sleep',

  summary: [
    '점심 뒤 소파에서 눈이 스르르 감기는 장면으로 시작',
    '오후 졸음이 자연스러운 일이라는 설명을 단정 없이 가능성으로 제시',
    '낮잠이 밤잠을 방해하는 조건을 제시하되 사람마다 다르다는 전제를 붙임',
    '졸린 것을 억지로 참는 게 답은 아니라는 점을 짚음 — 낮잠 금지 톤으로 가지 않음',
    '길이가 아니라 결(짧게·이른 오후·기대어)까지만 다루고 갱년기톡으로 연결',
  ],

  risk: { medical: 'LOW', money: 'NONE', legal: 'NONE' },

  factsToVerify: [
    '낮잠을 금지하는 톤이 아닌지 (큐 notes 요구사항)',
    '몇 분이라는 시간 처방이 없는지',
    '수면 시간 논쟁으로 넘어가지 않았는지 (sleep-series 1편과 중복 회피)',
  ],

  /** brief 의 "절대 쓰지 말 것"을 기계 검사용으로 옮긴 것 */
  forbiddenPatterns: [
    '불면증', '수면장애', '기면증', '무호흡', '수면무호흡',
    '멜라토닌', '수면제', '영양제', '건강기능식품',
    '베개', '안대', '매트리스',
    '20분', '30분', '15분', '분 이내',
    '낮잠은 피', '낮잠을 피',
  ],

  notes:
    '7-D-13-C canary. sleep-series 3편 — 1편(수면 시간)·2편(야간 발한)과 각도가 겹치지 않는지 본다. ' +
    '시리즈 중간의 가벼운 편이라 무겁게 쓰지 않는 것이 요구사항이었다. ' +
    'ChatGPT Web UI 자동 회수(--fetch)로 받은 첫 원고다.',

  preparedAt: '2026-08-25',
  preparedBy: 'Claude Code',
}
