# 매거진 자동 레인 fixture

🔴 **이 디렉터리의 파일은 추적된다.** 회귀 테스트(`magazine-auto-register-check.mjs`)가
여기만 읽는다.

## 왜 생겼나 (2026-09-15)

옛 테스트는 `drafts/magazine/{avoiding-gatherings,back-to-work-homemaker,memory-worry-menopause}/draft.md`
를 표본으로 썼다. 그런데 그 세 원고는 **origin/main 에 커밋된 적이 없었다** —
한 대의 맥에 미추적 파일로만 있었다. 그래서 clean checkout 에서는 언제나

```
⚠️ 실제 draft.md 가 하나도 없어 관문 시험을 건너뛴다
🔴 36 PASS · 1 FAIL
```

가 났다. CI 도, 다른 기계도 이 테스트를 통과할 수 없었다.

## 무엇을 두는가

- `manuscript-pass.draft.md` — **실제로 통과한 원고**(`avoiding-gatherings`)의 사본.
  🔴 손으로 지어낸 샘플을 쓰지 않는다는 원래 원칙은 그대로다. 길이·문체·구조가
  실제와 어긋나면 테스트는 통과하는데 실제 원고가 막힌다.
  테스트는 이 원고를 변형해 각 관문이 무엇을 잡는지 확인한다.

- `review-hero.fixture.ts` — hero alt/scene 이 담긴 review.ts 모양.
  자동 레인이 REQUIRED 이미지의 alt 를 여기서 읽는다.

## 고칠 때

원고 fixture 를 바꾸려면 **실제로 발행된 원고**에서 가져온다.
`drafts/magazine/{slug}/draft.md` 중 하나를 그대로 복사한다.
