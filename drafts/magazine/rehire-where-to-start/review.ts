/**
 * 검수 데이터 — 50대 재취업 어디부터 알아봐야 하나요
 *
 * LOW 등급이라 riskSentences 는 두지 않는다(전략 §5.1).
 * 대신 forbiddenPatterns 로 기관·업체명과 금액 단정을 기계가 막는다.
 */
import type { ReviewData } from '../_template/review'

export const REVIEW: ReviewData = {
  slug: 'rehire-where-to-start',

  summary: [
    '구인 사이트를 열어 두고 검색어조차 못 넣는 장면으로 시작',
    '막막한 이유가 준비 부족이 아니라 기준 없음이라는 점을 짚음',
    '이력서보다 먼저 시간·거리·강도 같은 내가 지킬 조건을 적어 보는 순서를 제시',
    '경력을 직함이 아니라 해낸 일로 다시 세어 보는 방식을 제안',
    '경로의 종류까지만 이야기하고 수다방으로 연결',
  ],

  risk: { medical: 'NONE', money: 'LOW', legal: 'LOW' },

  factsToVerify: [
    '기관명·사이트명·업체명이 하나도 없는지 (큐 notes 요구사항)',
    '금액·제도 요건을 단정하지 않았는지',
    '연금 이야기로 넘어가지 않았는지 (pension-early-vs-normal 과 중복 회피)',
  ],

  /** brief 의 "절대 쓰지 말 것"을 기계 검사용으로 옮긴 것 */
  forbiddenPatterns: [
    '워크넷', '고용노동부', '사람인', '잡코리아', '알바몬', '인크루트', '벼룩시장',
    '여성새로일하기센터', '새일센터', '고용복지플러스센터', '국민취업지원제도',
    '시급', '월급', '연봉', '지원금',
    '자격증을 따', '자격증 취득',
    '국민연금', '기초연금', '실업급여',
    '취업률', '경쟁률',
    '무조건', '보장됩니다',
  ],

  notes:
    '7-D-11-B 3건 중 2편. LOW 등급이라 riskSentences 를 두지 않는다(전략 §5.1). ' +
    '기관명·사이트명·업체명이 한 줄도 없어야 한다 — 하나라도 들어가면 광고로 읽힌다. ' +
    'pension-early-vs-normal 과 달리 금액을 계산하지 않는다.',

  preparedAt: '2026-08-25',
  preparedBy: 'Claude Code',
}
