/**
 * 검수 데이터 템플릿 — 글마다 drafts/magazine/{slug}/review.ts 로 복사해 채운다.
 *
 * ⚠️ 이 파일은 **원고를 쓰지 않은 Claude 세션이 작성한다.**
 *    Claude 채팅이든 Claude Code 든 상관없다. 요건은 하나다 —
 *    **최종 원고를 쓴 주체가 아니어야 한다.** 최종 원고는 언제나 ChatGPT 가 쓴다.
 *    (매거진 전략 §3.0 역할 분리)
 *
 * 왜 원고와 파일을 나누는가
 *    article-draft.ts = ChatGPT 가 쓴 최종 원고
 *    review.ts        = 그 원고를 읽고 뽑은 요약·위험 문장
 *    쓴 쪽과 뽑은 쪽이 같으면, 위험하다고 판단한 문장은 애초에 원고에 없었을 것이므로
 *    "위험 문장 5개"가 자기 검열의 결과물이 된다. 파일이 갈려야 검수가 실제 검증이 된다.
 *
 * ⚠️ Claude Code 가 이 파일을 만들 수는 있다. 그러나 **원고를 쓰면 안 된다.**
 *    Claude Code 는 파일을 고칠 수 있는 유일한 주체라, 작성 권한까지 가지면
 *    "쓴 사람이 곧 커밋하는 사람"이 되어 원칙 4(자동 발행 경로 없음)가 무너진다.
 *
 * 패킷 생성기가 거는 검사
 *    riskSentences 의 각 문장이 article-draft.ts 본문에 **그대로** 있어야 한다.
 *    없으면 FAIL — 원고가 수정됐거나 review 가 낡았다는 뜻이다.
 */

/** 정확히 5개. 4개나 6개면 빌드가 막는다 */
export type FiveLines = [string, string, string, string, string]

export type ReviewRisk = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'

export type ReviewData = {
  /** article-draft.ts 가 놓인 디렉터리명과 같아야 한다 */
  slug: string

  /** 창업자가 30초 안에 글을 파악하는 5줄. 본문 순서대로 */
  summary: FiveLines

  /**
   * 창업자가 눈으로 확인해야 할 문장.
   * LOW 는 생략 가능 · **MEDIUM/HIGH 는 필수**(전략 §5.1).
   * 반드시 본문에 실제로 있는 문장을 그대로 옮긴다. 요약하거나 다듬지 않는다.
   */
  riskSentences?: FiveLines

  /** 축별 위험도. 하나라도 HIGH 면 전문 검수다 */
  risk: {
    /** 증상·질환·약·치료·검사 */
    medical: ReviewRisk
    /** 금액·세금·연금·보험료 */
    money: ReviewRisk
    /** 제도 요건·법령 */
    legal: ReviewRisk
  }

  /** 창업자만 판단할 수 있는 사실관계. 발행 책임이 걸린 항목 */
  factsToVerify: string[]

  /** YYYY-MM-DD */
  preparedAt: string

  /**
   * 이 검수 데이터를 만든 주체. **원고 작성자가 아니다.**
   * 최종 원고 작성자는 언제나 ChatGPT 이고, 여기에는 적지 않는다.
   */
  preparedBy: 'Claude 채팅' | 'Claude Code'

  /** 특기 사항이 없으면 빈 문자열 */
  notes: string
}

/**
 * 아래는 형식을 보여주는 예시다. 복사한 뒤 전부 실제 값으로 바꾼다.
 * 예시 문장을 지우지 않고 발행하면 패킷 생성기가 원고 대조에서 FAIL 을 낸다.
 */
export const REVIEW: ReviewData = {
  slug: 'example-slug',

  summary: [
    '독자가 겪는 상황을 먼저 인정하는 도입',
    '왜 그런 변화가 생기는지 가능성으로만 설명',
    '흔히 나타나는 모습을 목록으로 정리',
    '오늘 해볼 수 있는 것을 부담 없는 수준으로 제시',
    '갱년기톡으로 경험을 나누도록 유도',
  ],

  riskSentences: [
    '본문에 실제로 있는 문장 ①',
    '본문에 실제로 있는 문장 ②',
    '본문에 실제로 있는 문장 ③',
    '본문에 실제로 있는 문장 ④',
    '본문에 실제로 있는 문장 ⑤',
  ],

  risk: {
    medical: 'MEDIUM',
    money: 'NONE',
    legal: 'NONE',
  },

  factsToVerify: [
    '일반적으로 통용되는 서술인지',
    '단정처럼 읽히는 표현이 없는지',
  ],

  preparedAt: '2026-08-24',
  preparedBy: 'Claude 채팅',
  notes: '',
}
