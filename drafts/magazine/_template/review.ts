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

  /**
   * 이 주제에서만 위험한 표현을 기계가 검사할 수 있게 적어 둔다. **선택 필드다.**
   *
   * 왜 필요한가
   *   magazine-qa.mjs 는 모든 글에 공통인 것만 잡는다 —
   *   금지 호칭(시니어·어르신…) · 의료 단정(반드시·치료됩니다…) · 형식 · 중복.
   *   "손목터널증후군" 같은 **주제별 진단명**이나 "명절은 없어져야" 같은 톤은 잡지 못한다.
   *   brief 의 "절대 쓰지 말 것"에 적은 것을 여기에 한 번 더 배열로 옮기면
   *   magazine-batch-qa.mjs 가 원고 본문과 대조해 자동으로 막는다.
   *
   * 없으면 그 검사를 건너뛴다(하위 호환). 대신 자동 승인 판정에서 그 층이 빠진다.
   *
   * 예: ['손목터널', '건초염', '관절염', '파스', '보조기', '갱년기 때문']
   */
  forbiddenPatterns?: string[]

  /**
   * 대표 이미지에 쓸 대체 텍스트와 장면. **`imageMode: 'REQUIRED'` 면 반드시 적는다.**
   *
   * 왜 여기 있는가
   *   자동 레인은 alt 를 스스로 지어내지 않는다 — 화면에 무엇이 보이는지는
   *   사람이 판단할 일이다. 그런데 그 판단을 적어 둘 자리가 없어서,
   *   `imageMode=REQUIRED` 인 글은 자동 레인에서 **언제나** HERO_ALT_REQUIRED 로 막혔다
   *   (2026-09-15 진단). 검수 데이터가 그 자리다.
   *
   *   alt   스크린리더가 읽는다. "{장소·행동} 여성" 형태로 끝낸다 (등록분 17건이 전부 그 형태다)
   *   scene 이미지 생성 프롬프트에 들어갈 장면. 생략하면 cluster 기본 장면을 쓴다
   *
   * 🔴 alt 에 "시니어·어르신·노인·실버" 를 쓰지 않는다 — 본문과 같은 금지 호칭이다.
   * 🔴 scene 에 병원·가운·약·눈물 같은 표현을 쓰지 않는다.
   *    프롬프트의 금지 목록과 정면으로 다투게 된다.
   * 🔴 이 값이 있다고 HIGH 나 autoEligible=false 가 통과하지 않는다. 등급 게이트는 그대로다.
   */
  hero?: {
    alt: string
    scene?: string
  }

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

  // 이 주제에서만 위험한 표현. 해당 없으면 이 줄을 지운다.
  forbiddenPatterns: ['이 주제에서 쓰면 안 되는 진단명', '단정으로 읽히는 표현'],

  // imageMode 가 REQUIRED 면 반드시 적는다. OPTIONAL·NO_IMAGE 면 이 블록을 지운다.
  hero: {
    alt: '창가에 앉아 잠시 바깥을 바라보는 50대 한국 여성',
    scene: '집 거실 창가에 앉아 머그잔을 들고 바깥을 바라보는 낮 시간',
  },

  preparedAt: '2026-08-24',
  preparedBy: 'Claude 채팅',
  notes: '',
}
