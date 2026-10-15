# Magazine current milestone

기준 시각: 2026-10-15 KST  
구현·배포 집중 게이트: 2026-10-15 KST
운영 증거 상한: 2026-10-22 KST
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

- 2026-10-15 현재 제품 graph 검사는 275/275다. 연구 build는 167 intents · 339 edges ·
  82 mappings지만 제품에 export된 runtime bundle은 143 intents · 298 edges · 53 mappings다.
- 공개 글은 52편이지만 전체 cluster를 가정해도 현재 bundle이 graph 결과를 내는 글은 18편이다.
  공개 16편은 mapping이 없고, mapping이 있는 36편 중 18편은 활성 출발 관계 결과가 없다.
- 운영 `control.ts`는 아직 `enabled: false`, `enabledClusters: []`라 실제 공개 화면은 전부 fallback이다.
- PR #726은 `sleep` 5편만 여는 첫 canary 후보다. 로컬에서 5/5 GRAPH, 다른 47편 불변,
  kill switch 전체 fallback, 직접 3 + 발견 1 표본을 확인했고 Linux CI를 기다린다.
- 최신 등록 글의 mapping 보정, reverse update, bundle rebuild와 공개 watch가 남아 있다.

### M-AUTO — PARTIAL

- 생성·QA·hero·등록·PR·CI·병합·배포·예약 공개 장치는 대부분 구현돼 있다.
- 2026-10-15 자연 회차는 `kimjang-back-pain-prep`의 Claude brief가 고정 형식 블록을 빠뜨려 중단됐다.
- `4adb4c2b`는 공통 형식 블록을 코드가 조립하도록 고쳤다.
- 자식 `23014791`은 rehearsal S8/S8B를 10/11 gray 고정 사건·article 격리·untrack으로
  바꿨다. 제품의 `DIRTY_TREE` 관문은 유지했고 전체 변이 회귀가 진행 중이다.
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

## 4. 압축 실행표

| 날짜 | M-AUTO | M-GRAPH / OUTCOME |
|---|---|---|
| **10/15 오늘** | brief bridge 회귀 완료 → PR·CI·병합·배포. 이어서 `DIRECT_SPEC_V1` schema·compiler·hash·fixture와 STANDARD canary wiring을 병렬 파일 소유권 안에서 구현 | 52편 대조 완료 → PR #726 sleep canary CI·병합·배포·공개 HTML 확인. mapping 보정 입력과 최신 bundle rebuild 후보 생성. 기존 event·identity gap read-only 감사 |
| **10/15 오늘 stretch** | direct 정상·형식 실패·provider 실패·재실행 rehearsal과 변이까지 로컬 커밋 | reverse relation·미공개 누출·3+1·kill switch 검증 후 graph bundle PR |
| **10/16** | 오늘 끝낸 코드의 자연 무인 회차를 운영 증거로만 관측. 결정적 결함 발견을 이 날짜로 미루지 않는다 | canary watch·click/impression 수집 시작 상태 확인. 코드 결함은 즉시 같은 날 수리 |
| **10/17 이전** | direct canary가 통과하면 default 전환 여부 판정, legacy는 bounded rollback으로만 보존 | canary가 안전하면 다음 cluster 확장. OUTCOME cohort 시계 시작 |
| **10/22 상한** | 현재 코드 자연 무인 회차까지 포함해 M-AUTO OPERATING_PASS/미달을 판정 | M-GRAPH ACTIVE/미달과 OUTCOME 측정 가동을 판정. 7일 실제 사용자 결과는 관측창 종료 뒤 별도 판정 |

원칙은 **코드로 재현 가능한 결함을 내일 자연 회차로 넘기지 않는 것**이다. 내일 이후로 남겨도 되는 것은
실제 외부 시스템, 예약 공개, 무인 스케줄, 7일 재방문처럼 시간 경과가 증거의 일부인 관측뿐이다.

## 5. 병렬 작업과 파일 소유권

- **M-AUTO writer:** `scripts/magazine-*`, `scripts/lib/magazine-*`, rehearsal·fixture. graph 제품 파일을 고치지 않는다.
- **M-GRAPH writer:** graph research/build/bundle과 `src/content/magazine/graph/*`, 관련 resolver·UI. producer·register를 고치지 않는다.
- **OUTCOME writer:** 측정 계약과 event 경로. 광고·D100·회원가입 전환 파일과 겹치면 먼저 조정한다.
- 같은 파일은 한 번에 한 writer만 수정한다. 의미 있는 exact head마다 targeted 검사 후 전수 회귀와 CI는 한 번만 돌린다.

### M-AUTO work order — `DIRECT_SPEC_V1`

- 먼저 schema와 순수 compiler를 만든다. 같은 graph node·queue·policy 입력은 같은 canonical JSON과
  `specHash`를 내야 하며 모델·시계·네트워크를 읽지 않는다.
- spec은 검색 의도, 독자 질문, 구조, 근거·안전, 형식, CTA, 3+1 관계, hero, 공개 예약을 빠짐없이 담는다.
- opt-in STANDARD 한 건만 direct 경로를 타고 나머지는 legacy와 바이트·동작이 같아야 한다.
- direct는 `brief.md`·`review.ts`가 없어도 원고 요청을 만들 수 있어야 한다. 같은 회차에 legacy와 direct를
  모두 보내면 실패다.
- delivery fingerprint와 장부 증거가 `specVersion`·`specHash`를 식별해야 한다. 재실행·급사에도 일반 요청
  1회 원칙과 HOLD가 유지돼야 한다.
- QA, 재생성 예산, hero, register, exact-head, 배포 증거, watch는 기존 경로를 재사용한다.
- rehearsal에 정상, 형식 실패, provider 실패, 급사, 재실행, rollback 반례와 변이를 넣는다.

### M-GRAPH work order — current bundle과 canary

- 공개 52편·예약 글·queue와 167 intents/82 mappings를 대조해 `MAPPED`, `UNMAPPED`, `STALE`,
  `AMBIGUOUS`를 근거와 함께 산출한다. 제목 유사도로 임의 mapping하지 않는다.
- 현재 graph 적용 18/52의 나머지 34편이 mapping 부재인지, 관계 부재인지, 미공개 대상 때문인지 분리한다.
- 최신 bundle을 builder로 재생성하고 hash·reverse relation·미공개 누출·중복·자기 링크를 검증한다.
- 저위험 cluster 하나만 켠다. 직접 3 + 발견 1, 항목별 source/version/reason, click·impression,
  kill switch와 fallback을 실제 공개 HTML에서 확인한다.

### OUTCOME work order — 측정 계약

- 기존 `magazine_related_impression`·`magazine_related_click`을 재사용할 수 있는지 먼저 감사한다.
- search landing, related click, community action, 7-day return을 동일한 identity-safe cohort로 이을 수 없는
  구간을 명시한다. guest를 회원으로 추정하거나 Persona·운영자 활동을 실사용자로 세지 않는다.
- 광고·회원가입 전환·D100 파일과 겹치면 구현하지 말고 파일 교집합과 필요한 조정을 먼저 보고한다.

## 6. 중단과 롤백

- 보안 사고, 데이터 손실, Production 장애는 즉시 중단한다.
- DIRECT_SPEC canary 실패는 해당 모드만 끄고 legacy 경로로 돌아간다. QA 관문을 낮춰 통과시키지 않는다.
- M-GRAPH canary에서 미래 글 노출, 잘못된 관계, 기존 링크 회귀가 생기면 cluster만 비활성화한다.
- 한 글 공개, PR 통과, rehearsal 통과를 전체 완료로 보고하지 않는다.

## 7. 다음 즉시 작업

0. GitHub Actions 잠금 해제는 attempt 2가 실제 runner 단계에 진입해 확인됐다. PR #725 CI가 끝나면
   정본을 병합한다.
1. Claude의 `23014791` 전체 변이 회귀와 clean 원복을 확인하고 bridge PR·CI·병합·배포를 오늘 끝낸다.
2. PR #726 CI 뒤 `sleep` canary를 병합·배포하고 실제 공개 HTML·source/version/reason·kill switch 준비를 확인한다.
3. 별도 M-AUTO worktree에서 ArticleSpec schema와 legacy/direct 경계를 오늘 구현한다.
4. M-GRAPH 미매핑 16편과 NO_RESULT 18편을 근거별로 보정해 최신 bundle 후보를 오늘 만든다.
5. OUTCOME event·identity gap은 읽기 전용으로 오늘 확정하고 광고·회원가입 전환 파일과 겹치는 구현은
   writer 조정 뒤 진행한다.
6. 모든 결과를 M-GRAPH·M-AUTO·OUTCOME으로 분리 보고하고 한 층의 PASS를 전체 완료로 부르지 않는다.
