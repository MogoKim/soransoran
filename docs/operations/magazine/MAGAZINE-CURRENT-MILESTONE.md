# Magazine current milestone

기준 시각: 2026-10-16 KST
commissioning 창: 48~72시간 · 목표 완료 2026-10-18 KST
상위 정본: `M-GRAPH-PROJECT-CHARTER.md`, `magazine-automation-runbook.md`

이 문서는 소란소란 매거진의 **현재 상태와 48~72시간 commissioning 실행 순서**만 관리한다. 목적은 글 수가
아니라, 검색 질문에서 들어온 독자가 연결된 답을 더 읽고 커뮤니티에 참여한 뒤 7일 안에 돌아오는 제품을
만드는 것이다.

## 1. 한 방향

우선순위는 아래 순서를 바꾸지 않는다.

1. **OUTCOME** — 유용한 답, 연속 탐색, 커뮤니티 참여, 7일 내 실제 사용자 재방문
2. **M-GRAPH** — 조사된 검색 의도와 설명 가능한 관계가 실제 공개 링크를 구동
3. **M-AUTO** — 승인 노드를 사람의 일상 개입 없이 안전하게 공급
4. 잠금·journal·HOLD·rehearsal — 위 세 목표를 지키는 지원 장치

### 2026-10-16 창업자 결정 — commissioning 게이트

- 현재 트래픽이 적어 OUTCOME 수치는 이번 완료 조건으로 쓰지 않는다. OUTCOME은 실패나 미완료가 아니라
  **`DEFERRED — TRAFFIC_NOT_SUFFICIENT`** 다. 제품 목적상 OUTCOME이 최상위라는 원칙은 그대로다.
- 이번 48~72시간 commissioning 게이트는 **M-GRAPH와 M-AUTO만** 판정한다. 순서는 **M-GRAPH → M-AUTO**다.
- 목표 완료일은 **2026-10-18 KST**다. 날짜는 목표이지 PASS 주장이 아니다.
- 대규모 legacy 삭제는 하지 않는다. DIRECT_SPEC 반복 성공 전까지 `LEGACY_BRIEF_V1`은 bounded rollback으로 유지한다.
- 광고, D100, 회원가입 전환, schema, migration, env, workflow, launchd는 이 게이트의 범위 밖이다.

목표 제작 경로는 다음과 같다.

```text
M-GRAPH next approved node
  -> 승인 source(magazine-article-spec-source/1) -> versioned ArticleSpec compiler
  -> ChatGPT manuscript
  -> deterministic QA / regeneration
  -> hero
  -> register / PR / CI / merge / deploy / scheduled publish / watch
```

주제 선정은 제거하지 않고 M-GRAPH의 결정적 다음 노드 선택으로 바꾼다. 일일 Claude brief와
`review.ts` 생성은 목표 경로에서 제거한다. `draft.md`는 QA·회복·원자 교체 경계로 유지한다.

## 2. 현재 상태 (2026-10-16 확인)

### M-GRAPH — ACTIVE(sleep·family), NOT COMPLETE

- 제품 graph는 `g-20261015-d5f6fe`이고 control은 `sleep`·`family` cluster와 footer surface
  (`FOOTER_NEXT`·`FOOTER_SIBLING`·`FOOTER_BRIDGE`)만 켠다. kill switch는 꺼져 있다.
- 2026-10-16 11:05 graph watch는 공개 54편 · 읽기 실패 0 · 결함 관측 0 · exit 0이었다.
- PR #734는 활성 cluster 전수 coverage, cluster별 3 direct + 1 discovery 표본, 이전 bundle rollback을
  graph 검사로 고정했다. PR #735가 `g-20261015-d5f6fe` bundle을 배포했다.
- 그러나 **연구 정본 `contract/build/current`는 아직 `g-20260923-ad8e89`** 를 가리킨다. 제품 판과
  달라 G8 편입 도구가 `GRAPH_BUNDLE_MISMATCH`로 멈춘다(2026-10-16 dry-run, 쓰기 0).
- 2026-10-16 읽기 전용 대조에서 **미등록 graph intent 87개 중 현재 제품 graph로 3 direct + 1 discovery가
  증명되는 노드는 0개**였다(cluster 제한을 무시해도 0, direct 2개 이상도 0). 미등록 노드에서 나가는
  edge 대부분이 아직 mapping되지 않은 intent를 가리킨다. 관계를 지어내 3+1을 맞추지 않는다.

### M-AUTO — PARTIAL

- 기존 queue 자연 회차는 2026-10-16 `kimjang-back-pain-prep`을 생성·QA·hero·등록했고 PR #742가
  CI를 통과해 merge SHA `3769062f`로 병합·Production 배포됐다. **기존 queue(`LEGACY_BRIEF_V1`) M-AUTO
  성공 증거**다. DIRECT_SPEC 증거가 아니다.
- 2026-10-16 11:00 magazine watch는 `cold-weather-joint-pain` 본문·이미지·목록을 확인했고 exit 0이었다.
- PR #727(ArticleSpec schema·compiler), #738(하류 원고·QA·재생성·등록), #739(승인 source 신원을
  선정·재사용·등록·전송·regen·입력 수리에서 재검증), #740(`magazine-article-spec-source/1` 후보 생산과
  사람의 명시적 승인 절차, 승인 basis의 소비 시점 재대조)이 main에 있다.
- 그러나 **승인 source 0 · G8 편입 DIRECT_SPEC 행 0 · queue opt-in 0 · DIRECT_SPEC 자연 회차 0**이다.
  현재 자연 경로는 계속 `LEGACY_BRIEF_V1`이다.
- magazine runtime은 `730478ec`이며 main보다 뒤다(#742 등록분 미반영). runtime 동기화는 이 문서의
  범위가 아니며 별도 운영 판단으로 한다.

### OUTCOME — DEFERRED — TRAFFIC_NOT_SUFFICIENT

- 이번 commissioning 게이트의 완료 관문이 아니다. 실패나 미완료로 보고하지 않는다.
- `magazine_related_impression`·`magazine_related_click`과 집계형 가입 퍼널은 계속 수집한다.
- search landing -> related click -> community action -> 7일 재방문의 identity-safe 측정 계약은
  트래픽이 충분해질 때 이어서 설계·판정한다. 그 전에는 `OUTCOME PROVEN`을 선언하지 않는다.

## 3. 2026-10-18 commissioning 완료 조건

### M-GRAPH 완료 조건 (먼저)

- 실제 승인 source — 현재 제품 graphVersion·control·surface에 묶인 `magazine-article-spec-source/1` entry
- G8 편입 — 그 노드의 큐 행이 정확한 ADMITTED 사건·slug 표·manifest hash를 가진다
- 제한적 cluster/surface 활성화 — 필요한 cluster·surface만 켜고 나머지는 그대로 둔다
- 직접 관련 3 + 발견 1 — 현재 제품 graph edge와 공개 대상 글로 증명된다
- 미공개 누출 0
- 공개 HTML·watch 검증 — 실제 공개 상세의 3+1 링크와 source/version/reason을 watch가 확인한다
- kill switch·rollback 계약 — cluster만 끄고 fallback으로 돌아가는 경로가 확인돼 있다

### M-AUTO 완료 조건 (M-GRAPH 다음)

- 서로 다른 DIRECT_SPEC canary 2건
- brief/review 수동 작성 의존 0
- source -> ArticleSpec -> 원고 -> QA -> hero -> 등록 -> PR -> CI -> merge -> deploy -> watch 완주
- 중복 provider·write·register 0
- 재실행 멱등성
- fail-closed와 rollback — 실패하면 해당 행만 HOLD하고 legacy로 되돌릴 수 있다
- 운영자 수동 개입 0

### 경계

- 기존 HOLD 6건은 **별도 legacy backlog**다. 첫 DIRECT_SPEC canary의 완료 관문이 아니다.
- 한 글 공개, PR 통과, rehearsal 통과, canary 한 건 성공을 전체 완료로 부르지 않는다.
- QA, HOLD, 재생성 예산, dirty-tree, exact-head, 배포 증거, watch 관문을 낮춰 통과시키지 않는다.

## 4. 압축 실행표

| 날짜 | M-GRAPH | M-AUTO |
|---|---|---|
| **10/16 오늘** | canary 후보 1건 준비. 현재 3+1이 증명되는 노드가 0이므로 먼저 §5의 M-GRAPH 선행 작업을 닫는다 | Codex 승인 뒤 실제 source 승인·G8·opt-in 1건, supervised commissioning 1건 |
| **10/17** | 활성 cluster·surface의 공개 HTML·watch와 kill switch 확인 | 첫 DIRECT_SPEC 자연 회차, 두 번째 canary |
| **10/18** | M-GRAPH OPERATING_PASS 또는 정확한 미달 판정 | 반복성·rollback 확인, M-AUTO OPERATING_PASS 또는 정확한 미달 판정 |

원칙은 **코드로 재현 가능한 결함을 내일 자연 회차로 넘기지 않는 것**이다. 내일 이후로 남겨도 되는 것은
실제 외부 시스템, 예약 공개, 무인 스케줄처럼 시간 경과가 증거의 일부인 관측뿐이다.

## 5. 첫 canary의 선행 blocker (2026-10-16 읽기 전용 대조)

| blocker | 근거 | 닫는 쪽 |
|---|---|---|
| G8 편입 불가 | 연구 `contract/build/current` = `g-20260923-ad8e89` ≠ 제품 `g-20261015-d5f6fe` → `GRAPH_BUNDLE_MISMATCH` | M-GRAPH — 제품 판과 같은 연구 build를 current로 승격 |
| 3+1 증명 노드 0 | 미등록 intent 87개 중 증명 가능한 관계가 가장 많은 노드도 direct 1 + discovery 1 | M-GRAPH — 공개 대상 글로 이어지는 근거 있는 관계를 build·export에 반영 |
| 후보 cluster 비활성 | 가장 가까운 후보(`I-T6-05`)는 `money-work` — control은 `sleep`·`family`만 켠다 | M-GRAPH — 근거가 생긴 cluster만 제한적으로 활성화 |
| queue G8 행 0 | 운영 queue에 `intentId`·`g8ManifestHash` 행이 없다 | G8 apply (위 두 blocker 뒤) |

관계가 없는 상태에서 3+1 계약을 낮추거나 관계를 지어내지 않는다. 계약을 바꾸려면 창업자의 명시적 결정이 필요하다.

## 6. 병렬 작업과 파일 소유권

- **M-AUTO writer:** `scripts/magazine-*`, `scripts/lib/magazine-*`, rehearsal·fixture. graph 제품 파일을 고치지 않는다.
- **M-GRAPH writer:** graph research/build/bundle과 `src/content/magazine/graph/*`, 관련 resolver·UI. producer·register를 고치지 않는다.
- **OUTCOME writer:** 이번 창에서는 배정하지 않는다. 기존 event 수집만 유지한다.
- 같은 파일은 한 번에 한 writer만 수정한다. 의미 있는 exact head마다 targeted 검사 후 전수 회귀와 CI는 한 번만 돌린다.

### M-AUTO work order — `DIRECT_SPEC_V1`

- 같은 graph node·queue·policy 입력은 같은 canonical JSON과 `specHash`를 내야 하며 모델·시계·네트워크를 읽지 않는다.
- spec은 검색 의도, 독자 질문, 구조, 근거·안전, 형식, CTA, 3+1 관계, hero, 공개 예약을 빠짐없이 담는다.
- opt-in STANDARD 한 건만 direct 경로를 타고 나머지는 legacy와 바이트·동작이 같아야 한다.
- direct는 `brief.md`·`review.ts`가 없어도 원고 요청을 만들 수 있어야 한다. 같은 회차에 legacy와 direct를
  모두 보내면 실패다.
- delivery fingerprint와 장부 증거가 `specVersion`·`specHash`를 식별해야 한다. 재실행·급사에도 일반 요청
  1회 원칙과 HOLD가 유지돼야 한다.
- QA, 재생성 예산, hero, register, exact-head, 배포 증거, watch는 기존 경로를 재사용한다.

### M-GRAPH work order — 현재 판 정합과 canary 노드

- 연구 build를 제품 판(`g-20261015-d5f6fe`)과 같은 판으로 current에 승격하고 hash·reverse relation·미공개
  누출·중복·자기 링크를 검증한다.
- 첫 canary 노드가 공개 대상 글로 이어지는 direct 3 + discovery 1을 갖도록 근거 있는 관계만 반영한다.
  제목 유사도로 mapping하거나 숫자를 위해 연결하지 않는다.
- 필요한 cluster·surface만 켠다. 직접 3 + 발견 1, 항목별 source/version/reason, kill switch와 fallback을
  실제 공개 HTML에서 확인한다.

## 7. 중단과 롤백

- 보안 사고, 데이터 손실, Production 장애는 즉시 중단한다.
- DIRECT_SPEC canary 실패는 해당 모드만 끄고 legacy 경로로 돌아간다. QA 관문을 낮춰 통과시키지 않는다.
- M-GRAPH canary에서 미래 글 노출, 잘못된 관계, 기존 링크 회귀가 생기면 cluster만 비활성화한다.
- 한 글 공개, PR 통과, rehearsal 통과를 전체 완료로 보고하지 않는다.

## 8. 다음 즉시 작업

1. M-GRAPH: 제품 판과 같은 연구 build를 current로 승격해 G8 `GRAPH_BUNDLE_MISMATCH`를 닫는다.
2. M-GRAPH: 첫 canary 노드 하나가 공개 글로 이어지는 근거 있는 3+1을 갖도록 관계를 보정하고, 그 cluster만 제한적으로 켠다.
3. 그 노드를 G8로 편입하고 `prepare` → 사람이 미해결 필드를 채움 → Codex 검토 → `approve` → opt-in 한 건 순서로 진행한다.
4. supervised commissioning 1건 뒤 자연 회차와 두 번째 canary로 반복성을 확인한다.
5. 모든 결과를 M-GRAPH · M-AUTO · OUTCOME으로 분리 보고한다. OUTCOME은 `DEFERRED — TRAFFIC_NOT_SUFFICIENT`로 적는다.
