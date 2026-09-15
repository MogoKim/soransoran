/**
 * hero 블록이 든 review.ts 모양 — 🔴 fixture 다. 실제 원고가 아니다.
 *
 * 회귀 테스트가 `parseHeroBlock` 으로 이 파일을 읽어, 자동 레인이 REQUIRED 이미지의
 * alt·scene 을 review.ts 에서 꺼내 오는지 확인한다.
 *
 * 🔴 alt 값은 실제 등록분에서 가져왔다 (`avoiding-gatherings` 의 heroImage.alt).
 *    지어낸 문장을 쓰면 길이·종결 규칙이 실제와 어긋난다.
 */
export const REVIEW = {
  slug: 'fixture-hero',
  hero: {
    alt: '저녁 거실 소파에 앉아 휴대폰을 내려놓고 잠시 쉬는 50대 한국 여성',
    scene: '집 거실 소파에 앉아 휴대폰을 내려놓고 잠시 쉬는 저녁 시간',
  },
}
