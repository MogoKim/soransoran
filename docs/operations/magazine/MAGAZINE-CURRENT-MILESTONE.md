# Magazine current milestone

기준 시각: 2026-10-15 KST  
목표 게이트: 2026-10-22 KST  
상위 정본: `M-GRAPH-PROJECT-CHARTER.md`, `magazine-automation-runbook.md`

이 문서는 소란소란 매거진의 **현재 상태와 1주 실행 순서**만 관리한다. 목적은 글 수가 아니라,
검색 질문에서 들어온 독자가 연결된 답을 더 읽고 커뮤니티에 참여한 뒤 7일 안에 돌아오는 제품을
만드는 것이다.

## 1. 한 방향

우선순위는 아래 순서를 바꾸지 않는다.

1. **OUTCOME** — 유용한 답, 연속 탐색, 커뮤니티 참여, 7일 내 실제 사용자 재방문
2. **M-GRAPH** — 조사된 검색 의도와 설명 가능한 관계가 실제 공개 링크를 구동
3. **M-AUTO** — 승인 노드를 사람의 일상 개입 없이 안전하게 공급
4. 잠금·journal·HOLD·rehearsal — 위 세 목표를 지키는 지원 장치

목표 제작 경로는 다음과 같다.

```text
M-GRAPH next approved node
  -> versioned ArticleSpec compiler
  -> ChatGPT manuscript
  -> deterministic QA / regeneration
  -> hero
  -> register / PR / CI / merge / deploy / scheduled publish / watch
```

주제 선정은 제거하지 않고 M-GRAPH의 결정적 다음 노드 선택으로 바꾼다. 일일 Claude brief와
`review.ts` 생성은 목표 경로에서 제거한다. `draft.md`는 QA·회복·원자 교체 경계로 유지한다.

## 2. 현재 상태

### M-GRAPH — NOT ACTIVE

- 연구 자산과 canonical graph는 존재한다.
- 운영 graph control은 아직 전체 공개 구조를 구동하지 않는다.
- 최신 등록 글과 intent mapping, reverse update, bundle rebuild, 공개 3+1 링크와 watch가 남아 있다.

### M-AUTO — PARTIAL

- 생성·QA·hero·등록·PR·CI·병합·배포·예약 공개 장치는 대부분 구현돼 있다.
- 2026-10-15 자연 회차는 `kimjang-back-pain-prep`의 Claude brief가 고정 형식 블록을 빠뜨려 중단됐다.
- `4adb4c2b`는 공통 형식 블록을 코드가 조립하도록 고쳤고 전체 회귀 중이다.
- rehearsal S8/S8B는 현재 runtime 대상에 의존해 추적 파일을 바꾸는 시험 결함이 확인됐다.
  제품의 `DIRTY_TREE` 관문은 맞으며, 고정 gray 사건·article 격리·untrack으로 시험만 고친다.
- 현재 배포 경로는 여전히 `LEGACY_BRIEF_V1`이다. `DIRECT_SPEC_V1`은 아직 구현·배포 전이다.

### OUTCOME — NOT PROVEN

- 공개 글과 CTA 기록만으로는 성공이 아니다.
- 검색 유입 -> 관련 글 -> 커뮤니티 행동 -> 7일 내 실제 사용자 재방문의 identity-safe 측정이
  완결되지 않았다.

## 3. 2026-10-22 완료 게이트

### M-AUTO 목표

- `DIRECT_SPEC_V1` ArticleSpec schema·compiler·hash·검증이 코드와 fixture로 고정돼 있다.
- STANDARD 한 건이 기존 일일 Claude brief 없이 생성부터 배포까지 rehearsal을 통과한다.
- 최소 한 번의 **현재 코드 자연 무인 회차**가 선택 -> ArticleSpec -> 원고 -> QA -> hero -> 등록 ->
  PR -> CI -> 병합 -> 배포까지 중복 전송·잔여물 없이 끝난다.
- 실패 시 `LEGACY_BRIEF_V1`로 되돌릴 수 있고 QA, HOLD, 예산, dirty-tree, exact-head 관문은 약화되지 않는다.

### M-GRAPH 목표

- 현재 articles와 graph intents가 재대조되고 mapping 누락·중복이 0이다.
- 최신 bundle이 재생성·검증돼 있다.
- 저위험 cluster 하나가 canary로 활성화된다.
- 공개 상세에서 직접 관련 3개 + 발견 1개가 crawlable link로 나오고 선택 이유·클릭 event·watch가 확인된다.

### OUTCOME 목표

- landing, related click, community action, 7-day return의 identity-safe 측정 계약이 배포돼 있다.
- 첫 cohort의 관측 시계가 시작된다.
- 7일 관측창이 끝나기 전에는 `OUTCOME PROVEN`을 선언하지 않는다. 10월 22일 게이트는 측정 가동
  여부를 판정하며, 충분한 실사용 표본이 늦으면 결과 판정만 이후로 이어간다.

## 4. 1주 실행표

| 날짜 | M-AUTO | M-GRAPH / OUTCOME |
|---|---|---|
| 10/15 | `4adb4c2b` 회귀 완료, S8/S8B 고정 사건 수리, ArticleSpec 계약 확정 | 최신 articles·intent 차이 산출 |
| 10/16 | `DIRECT_SPEC_V1` compiler·fixture·STANDARD canary rehearsal | mapping 보정안과 bundle rebuild |
| 10/17 | PR·CI·병합·배포·runtime 반영 | bundle 검증, canary cluster 선정 |
| 10/18~19 | 자연 회차 또는 bounded live canary, 중복·잔여·rollback 확인 | canary 활성화, 공개 3+1 링크 확인 |
| 10/20 | direct 경로 결함 수리와 재검증 | reverse update·event·watch 확인 |
| 10/21 | default 전환 여부 판정 | OUTCOME 측정 end-to-end 확인 |
| 10/22 | 세 축을 각각 판정하고 legacy 제거 여부 결정 | ACTIVE/미달 사유와 다음 표본 시각 보고 |

## 5. 병렬 작업과 파일 소유권

- **M-AUTO writer:** `scripts/magazine-*`, `scripts/lib/magazine-*`, rehearsal·fixture. graph 제품 파일을 고치지 않는다.
- **M-GRAPH writer:** graph research/build/bundle과 `src/content/magazine/graph/*`, 관련 resolver·UI. producer·register를 고치지 않는다.
- **OUTCOME writer:** 측정 계약과 event 경로. 광고·D100·회원가입 전환 파일과 겹치면 먼저 조정한다.
- 같은 파일은 한 번에 한 writer만 수정한다. 의미 있는 exact head마다 targeted 검사 후 전수 회귀와 CI는 한 번만 돌린다.

## 6. 중단과 롤백

- 보안 사고, 데이터 손실, Production 장애는 즉시 중단한다.
- DIRECT_SPEC canary 실패는 해당 모드만 끄고 legacy 경로로 돌아간다. QA 관문을 낮춰 통과시키지 않는다.
- M-GRAPH canary에서 미래 글 노출, 잘못된 관계, 기존 링크 회귀가 생기면 cluster만 비활성화한다.
- 한 글 공개, PR 통과, rehearsal 통과를 전체 완료로 보고하지 않는다.

## 7. 다음 즉시 작업

1. 현재 Claude 회귀를 끝까지 받고 S8/S8B 수리를 `4adb4c2b`의 자식 커밋으로 검증한다.
2. 별도 M-AUTO worktree에서 ArticleSpec schema와 legacy/direct 경계를 구현한다.
3. 별도 M-GRAPH worktree에서 최신 mapping 차이와 canary 후보를 산출한다.
4. 세 작업의 파일 교집합을 0으로 유지하고, 결과를 M-GRAPH·M-AUTO·OUTCOME으로 분리 보고한다.
