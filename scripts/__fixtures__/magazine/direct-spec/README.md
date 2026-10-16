# direct-spec canary fixture

🔴 **이 디렉터리는 추적된다.** `check:magazine-direct-spec` / `check:magazine-direct-spec-mutation`
두 검사만 여기를 읽는다. 운영 queue · articles.ts · drafts/magazine/ 에는 **아무 변경이 없다.**

## 왜 있는가 (2026-10-15)

`magazine-article-spec/1` (PR #727) 이 main 에 들어왔지만 producer · delivery · QA · register
흐름에 **spec identity / hash 가 흐르는지** 결정론적으로 증명할 입력이 저장소에 없었다.
rehearsal 과 변이가 **production-shaped 입력**으로 adapter 를 돌릴 수 있도록 하나의
STANDARD 1건 canary 를 여기 둔다.

## canary.input.json

하나의 opt-in `DIRECT_SPEC_V1` STANDARD 입력이다 — graph node · queueItem · relations ·
publication · hero. 운영 topic-queue 와 articles.ts 어디에도 이 slug (`canary-direct-spec-01`)
는 **없다.** 운영 발화 0 의 근거다.

- `queueItem.directSpecMode === 'DIRECT_SPEC_V1'` 가 opt-in 신호다. 없으면 adapter 는
  `LEGACY_BRIEF_V1` 경로를 쓰라고 돌려준다 (현재 운영 전부).
- `contentType === 'EVERGREEN'` 로 둔다 — `compileArticleSpec` 의 `CONTENT_TYPES` 는
  `EVERGREEN | SEASONAL | COMMUNITY` 다. "STANDARD canary" 는 `validationProfile === 'STANDARD'`
  을 뜻한다 (`CONTENT_TYPES` 와 `VALIDATION_PROFILES` 는 다른 축이다).
- 모든 날짜·hash 는 결정론적이다. 모델·시계·네트워크·파일을 읽어 만들지 않는다.
