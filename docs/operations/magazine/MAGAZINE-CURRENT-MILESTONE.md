# Magazine current milestone

기준 시각: 2026-11-03 13:30 KST
상위 정본: `M-GRAPH-PROJECT-CHARTER.md`(목적·관계·ContentPlan·공급 정책) · `magazine-automation-runbook.md`(실행·provider·rollout·release·복구)

이 문서는 소란소란 매거진의 **현재 상태와 지금 critical path**만 관리한다. 정책은 위 두 문서에만 있고 여기에 복제하지 않는다.
목적은 글 수가 아니라, 검색으로 들어온 40대 중반~60대 중반 여성이 유용한 답을 얻고 관련 글을 더 읽고 커뮤니티로 가서
7일 안에 다시 와 실제 글·댓글을 남기는 것이다. 우선순위는 **OUTCOME → M-GRAPH → M-AUTO → 신뢰성 장치**다.

## 1. 2026-11-03 설계 동결 — Magazine vNext

- **DESIGN_FREEZE_APPROVED (Codex, 2026-11-03).** 코드 구현 승인은 아니다. 이 문서 반영이 1단계다.
- 정책 위치: 권위 객체·관계 계약·previous 계층·M-GRAPH 공급 loop·영토 등급·hero/띠배너는 charter §12 · §18-B,
  provider·Job·rollout switch·release·A commissioning·legacy 삭제 조건은 runbook §0.0B.
- 창업자 결정 3건(2026-11-03) 기록 위치: 영토 등급 → charter §18-B.6 · API 예산 → runbook §0.0B.2 · A 판정자 → runbook §0.0B.6.

## 2. 현재 상태 (2026-11-03 실측)

| 항목 | 사실 |
|---|---|
| origin/main | `c15e7bfd` (#822 · 제품 graph `g-20261102-427d4d` 승격 + 연구 current 단일 권위 release gate) · 11-03 fetch 로 확인 |
| 제품 graph | current `g-20261102-427d4d` · previous `g-20261021-081d9a` · 활성 cluster `sleep`·`family`·`money-work` · kill switch 꺼짐 |
| 연구 current | `g-20261102-427d4d` · previous `g-20260923-ad8e89` (계층별 이력 — charter §18-B.3) |
| runtime | `soransoran-magazine-runtime` `main` `1f15416c` · 추적 변경 0 · 다음 00:10 producer preflight 가 fetch + ff-only 로 main 을 따라붙는다 |
| launchd (메인 Mac) | `magazine-producer` 00:10 · `magazine-auto-register` 01:00 · `magazine-auto-merge-recovery` 02:00 · `magazine-watch` 11:00 · `magazine-graph-watch` 11:05 · 5개 loaded · 마지막 종료 0 |
| 11-03 01:00 등록 회차 | 등록 0 · 시도 2(`dinner-change-two-weeks` FORBIDDEN_PATTERN · `hardest-part-of-menopause` MED_CARE_LINE) · 전달 불명 HOLD 8 · QA_FAIL 2(`how-much-talk-with-husband` · `retirement-prep-status`) · 미해결 PR 없음 |
| 공개 | 11-03 11:00 watch exit 0 · 11:05 graph watch exit 0 · `articles.ts` 등록 57편 = 공개 57편 → **예약 재고 0** |
| legacy 큐 | `drafts/magazine/topic-queue.ts` 15행 — 전달 불명 HOLD 8 · 격리 3 · 계절 창 3 · 시리즈 차단 1 → 지금 생산 가능 0 |
| 연구 readiness (427d4d) | intent 167 · 등록 61 · 미등록 106 → `GRAPH_READY` 1(I-T6-03, direct 2) · INCOMPLETE 30 · BLOCKED 75 |
| vNext 3+1 기준 공급 | ContentPlan 컴파일 가능 0 — I-T6-03 도 direct 2 라 미충족. same-release 로 공개 순서 교착을 풀어도 3+1 상한 근사 5개 → **공급 loop 가 A 보다 먼저다** |

### 축별 판정

| 축 | 판정 | 근거 |
|---|---|---|
| **M-GRAPH** | **PARTIAL** | 공개 graph 427d4d 는 작동(11:05 graph watch exit 0) · 지속 공급 loop 미구현 · 3+1 ContentPlan 0 |
| **M-AUTO** | **PARTIAL** | 복구 경로로 `age-learning` 공개 성공 · 신규 무인 경로 미증명 · 오늘 등록 0 · 예약 재고 0 · `OPERATING_PASS` 아님 |
| **OUTCOME** | **NOT PROVEN** | North Star 하한(DB) 미계산 |

## 3. Critical path

| 순서 | 작업 | 다음으로 넘어가는 증거 |
|---|---|---|
| **1** | 설계 동결 문서 반영 (이 커밋) | 세 문서 역할 분리 · 낡은 정책의 HISTORY 표시 · `master:doc-check` PASS |
| **2** | vNext 세로 경로 구현 — 전용 branch·worktree 하나 · writer 1명 · 순차 로컬 자식 커밋 · 커밋별 Codex 재검토 · 완성 exact head 에서 full 검사 1회 · Draft PR 1회 | 아래 커밋 순서 전부 + runbook §0.0B.8 공통 PASS |
| **3** | production-shaped rehearsal (fake provider · 녹화 evidence · 격리 저장소 · 다른 cluster 포함) | runbook §0.0B.8 rehearsal PASS |
| **4** | A commissioning (실제 provider 1편 · Draft PR · auto-merge 0 · 창업자 예/아니오 · 수동 병합) | runbook §0.0B.6 |
| **5** | 첫 신규 무인 글 B 의 release·배포·공개(자연 회차) · 다른 cluster 검증 · legacy 삭제 | runbook §0.0B.6 · §0.0B.7 |

**단계 2 의 로컬 자식 커밋 순서** (단계 사다리가 아니라 한 구현 단계 안의 변경 순서)

| # | 커밋 | 범위 |
|---|---|---|
| ①A | rollout 기반 | rollout schema · reader · 원자 writer CLI · 감사 기록(변경자·시각·old/new) · 없음·손상·schema 불일치 → `legacy` · 기본 `legacy` 에서 기존 운영 산출 바이트 불변 · **실제 운영 rollout 파일 생성·활성화 0** |
| ①B | behavior-preserving 경계 정리 | import 시점 `process.exit` 제거(`scripts/lib/magazine-load.mjs:62-70`) · 공용 상수 이동 · lib→CLI 역참조 제거(`lib/magazine-hero-brief.mjs:37` · `lib/magazine-hero.mjs:17` · `lib/magazine-judge.mjs:26` → `magazine-qa.mjs`) · `parseControlText` 단일화 · 각 변경의 기존 동작 불변 검증 |
| ② | Canonical Graph shortfall loop + ContentPlan | charter §18-B.2·§18-B.5 |
| ③ | Job + provider 계약 + fake provider | runbook §0.0B.1·§0.0B.2 |
| ④ | 검증·부분 수리 + hero | runbook §0.0B.3 · charter §12 |
| ⑤ | release writer + 날짜 마지막 배정 | runbook §0.0B.4 |
| ⑥ | 브랜드 띠배너 + 최소 outcome 진단 | charter §12 · §18-B.8 |
| ⑦ | 통합 rehearsal | runbook §0.0B.8 |

**다음 즉시 작업: ①A.** 그 밖의 운영 변경(G8 apply · ArticlePlan · queue · runtime · launchd)은 이 경로에 없다.

## 4. 판정 경계

- M-AUTO 판정 근거와 A 의 위치는 runbook §0.0B.6, legacy 삭제 조건은 runbook §0.0B.7 이 정본이다.
- 한 글 공개 · PR·CI·rehearsal 한 번 통과를 전체 완료로 부르지 않는다.

---

## 📜 HISTORY — 2026-10-16 판 (대체됨 2026-11-03)

> 아래는 2026-10-16 plan-first 48~72시간 commissioning 판이다. 역사 증거로 보존한다. **현재 정책이 아니다.**
> 대체 내용: 사람 승인 ArticlePlan → 정책 판(영토 등급) 영수증 · 생산 최소선 direct 2 → ContentPlan 선택량 direct 3 + discovery 1 ·
> publishAt 을 담은 ArticleSpec → 날짜 없는 ContentPlan + release 직전 배정 · "DIRECT 2건 뒤 legacy 제거" → 삭제 조건 네 개 ·
> OUTCOME `DEFERRED` → `NOT PROVEN`(하한부터 계산). 2026-10-18 목표일은 지나갔고 그 완료 조건은 충족되지 않았다.

### 1. 한 방향

우선순위는 아래 순서를 바꾸지 않는다.

1. **OUTCOME** — 유용한 답, 연속 탐색, 커뮤니티 참여, 7일 내 실제 사용자 재방문
2. **M-GRAPH** — 조사된 검색 의도와 설명 가능한 관계가 실제 공개 링크와 다음 공급 계획을 구동
3. **M-AUTO** — 준비된 계획을 재해석하지 않고 안전하게 실행
4. 잠금·journal·HOLD·rehearsal — 위 세 목표를 지키는 지원 장치

#### 2026-10-16 창업자 결정 — plan-first 단순화

- 현재 트래픽이 적어 OUTCOME 수치는 이번 완료 조건으로 쓰지 않는다. OUTCOME은 실패나 미완료가 아니라
  **`DEFERRED — TRAFFIC_NOT_SUFFICIENT`** 다. 제품 목적상 OUTCOME이 최상위라는 원칙은 그대로다.
- 이번 48~72시간 commissioning은 **M-GRAPH → M-AUTO** 두 층만 판정한다. 목표 완료일은
  **2026-10-18 KST**이며 날짜는 목표이지 PASS 주장이 아니다.
- 후보를 고른 뒤 관계 부족을 발견하는 흐름을 폐기한다. M-GRAPH가 생산 가능한 계획 재고를 먼저 만들고,
  M-AUTO는 `SPEC_READY` 계획만 실행한다.
- 관계의 **생산 최소선은 근거 있는 direct 2 + discovery 1**, 제품 표시 목표는 **direct 최대 3 +
  discovery 1**이다. 숫자를 위해 약한 관계를 만들지 않는다.
- 신규 legacy 유입은 동결한다. `LEGACY_BRIEF_V1`은 DIRECT 경로와 입구를 분리한 bounded rollback으로만
  유지하고, 서로 다른 DIRECT 계획 2건이 완료되면 활성 경로에서 제거한다.
- 광고, D100, 회원가입 전환, schema, migration, env, workflow, launchd는 이 게이트의 범위 밖이다.

목표 경로는 하나다.

```text
research intent
  -> GRAPH_READY
  -> G8_ADMITTED (stable slug)
  -> APPROVED_PLAN (magazine-article-spec-source/2 · 사람 승인 ArticlePlan · articlePlanHash = sourceHash)
  -> SPEC_READY (versioned ArticleSpec)
  -> QUEUED
  -> manuscript -> QA / bounded regeneration -> hero
  -> register / PR / CI / merge / deploy / scheduled publish / watch
```

일일 Claude `brief.md`·`review.ts` 생성과 일일 관계 판단은 목표 경로에서 제거한다. `draft.md`는
QA·재생성·회복·원자 교체 경계로 유지한다.

### 2. 권위와 상태 경계

권위 데이터는 아래 다섯 종류만 둔다. 같은 콘텐츠 필드를 queue·run·ledger에 복제하지 않는다.

| 권위 | 책임 |
|---|---|
| graph bundle | 검색 의도·근거 있는 관계·mapping·제품 판 |
| approved ArticlePlan | 만들 글의 승인된 독자 질문·범위·관계·근거·안전·공개 계획 |
| ArticleSpec | ArticlePlan을 결정적으로 컴파일한 모델·QA 입력 계약 |
| execution ledger | 시도·HOLD·전송 예약·등록·배포 영수증 |
| published article | 고객이 읽는 최종 결과 |

- readiness 목록은 graph에서 언제든 다시 계산하는 **파생 보고서**다. 사람이 수정하는 새 정본이 아니다.
- G8은 graph-ready intent의 slug와 admission 신원만 부여한다. 콘텐츠 필드를 다시 보관하지 않는다.
- queue는 최종 목표에서 `planId`·`planHash`·`executeAt`만 참조한다.
- graph/product basis가 의미 있게 바뀌면 계획은 `PLAN_STALE`로 멈춘다. legacy로 자동 강등하지 않는다.
- 상태는 앞 단계로 몰래 돌아가지 않는다. 실패는 정확한 HOLD 사유를 남기고 같은 신원으로 멱등 재개한다.

### 3. 현재 상태 (2026-10-16 확인)

#### M-GRAPH — 공개 graph ACTIVE(sleep·family), 공급 graph NOT READY

- 제품 graph는 `g-20261015-d5f6fe`이고 control은 `sleep`·`family` cluster와 footer surface
  (`FOOTER_NEXT`·`FOOTER_SIBLING`·`FOOTER_BRIDGE`)만 켠다. kill switch는 꺼져 있다.
- 2026-10-16 11:05 graph watch는 공개 54편 · 읽기 실패 0 · 결함 관측 0 · exit 0이었다.
- PR #734는 활성 cluster coverage와 이전 bundle rollback을 graph 검사로 고정했고, PR #735가 현재 bundle을 배포했다.
- 연구 정본 `contract/build/current`는 아직 `g-20260923-ad8e89`를 가리켜 제품 판과 다르다.
  G8 편입 도구는 `GRAPH_BUNDLE_MISMATCH`로 멈춘다.
- 미등록 graph intent 87개를 현재 제품 판으로 대조했을 때 `GRAPH_READY` 노드는 0개였다. 연구에서 가까운
  후보가 있어도 공개 대상·mapping·discovery 근거를 모두 만족하지 않는다.
- builder는 graphVersion 날짜, `manifest.generatedAt`, 고정 입력 경로에 의존해 동일 입력의 동일 바이트
  재생산이 보장되지 않는다.

#### M-AUTO — legacy 운영 PASS, DIRECT 코드 후보·운영 0회

- 2026-10-16 `kimjang-back-pain-prep` 자연 회차는 생성·QA·hero·등록·CI·병합·배포를 완료했다.
  이는 `LEGACY_BRIEF_V1` 증거이며 DIRECT 증거가 아니다.
- ArticleSpec, 하류 원고·QA·재생성·등록, 승인 source 신원 관문, source 작성·승인 코드는 main에 있다.
- 승인 source 0 · G8 편입 DIRECT 행 0 · queue opt-in 0 · `article-spec.json` 0 · DIRECT 자연 회차 0이다.
- 현재 구현은 legacy `selected/reusable/brief/review/input-repair` 실행기 안에 DIRECT mode 분기가 흩어져 있다.
  목표 구조는 run 입구를 분리하고 `draft.md` 이후의 검증·등록·배포 핵심만 공유하는 것이다.

#### OUTCOME — DEFERRED — TRAFFIC_NOT_SUFFICIENT

- 이번 commissioning 완료 관문이 아니다.
- 기존 impression·click·가입 퍼널 수집은 유지한다.
- search landing -> related reading -> community action -> 7일 재방문은 트래픽이 충분해질 때 판정한다.

### 4. 관계와 공급 정책

- graph에는 근거 있는 관계를 수량 제한 없이 저장한다.
- `GRAPH_READY` 생산 최소선은 **공개 대상 direct 2개 이상 + discovery 1개**다.
- 제품 상세는 direct를 최대 3개, discovery를 1개 표시한다. direct가 2개뿐이면 2개만 표시한다.
- hub·series·community 출구는 별도 계약이며 discovery 수를 대신하지 않는다.
- 관계마다 source/version/reader reason을 가진다. 제목 유사도만으로 연결하지 않는다.
- 공개되지 않은 대상은 공개 링크 수에 포함하지 않는다. resolver와 watch가 미래 글 누출 0을 보장한다.
- 신규 글의 outgoing과 기존 글의 reverse relation을 같은 plan에서 준비한다.
- 후보 분류는 `GRAPH_READY`·`GRAPH_INCOMPLETE`·`BLOCKED` 중 하나이며, M-AUTO는 첫 상태만 본다.

### 5. 2026-10-18 commissioning 완료 조건

#### M-GRAPH PASS

- builder가 명시적 `inputRoot`·`outDir`·`effectiveAt`·`generatedAt`을 받고 동일 입력을 동일 바이트로 재현
- semantic hash에서 휘발 시각을 제외하고, build와 promote를 분리
- `GRAPH_READY` ArticlePlan 2건 + 예비 1건
- 각 plan에 direct 2~3, discovery 1, reverse relation, hub·community 출구, 근거·제품 basis 존재
- 미공개 누출·중복·자기 링크 0, cluster kill switch와 이전 bundle rollback 검증

#### M-AUTO PASS

- 서로 다른 DIRECT ArticleSpec 2건
- 승인 뒤 `ArticlePlan -> ArticleSpec -> 원고 -> QA -> hero -> 등록 -> PR -> CI -> merge -> deploy -> watch` 완주
- 일일 brief/review 작성, 관계 판단, 운영자 수동 개입 0
- provider·write·register 중복 0, 재실행 멱등, 급사 잔여 0
- DIRECT 실패 시 HOLD, 자동 legacy 강등 0, 단일 lane rollback 검증

#### 경계

- 기존 HOLD 6건은 별도 legacy backlog다. DIRECT 완료 관문이 아니다.
- 한 글 공개, PR·CI·rehearsal 한 번 통과를 전체 완료로 부르지 않는다.
- QA, HOLD, 재생성 예산, dirty-tree, exact-head, 배포 증거, watch 관문을 낮추지 않는다.

### 6. legacy와 DIRECT 전환

- 한 run은 DIRECT 또는 LEGACY 중 하나다. 같은 queue/run에서 두 mode를 섞지 않는다.
- DIRECT runner는 `SPEC_READY` 참조만 읽는다. legacy runner는 동결된 기존 backlog만 읽는다.
- 행별 실패를 다른 mode로 자동 재처리하지 않는다. rollback은 run 입구의 lane을 명시적으로 전환한다.
- `draft.md` 이후의 QA·재생성·hero·register·merge·deploy·watch만 공용 핵심으로 유지한다.
- 서로 다른 DIRECT 2건과 rollback이 확인되면 활성 경로에서 아래를 제거한다.
  - daily brief/review 생성과 direct 대상 input-repair
  - mixed `selected/reusable` 및 행별 `directSpecMode` 분기
  - 완료된 사건 전용 recovery 상수와 제거된 분기 전용 mutation·fixture
- 역사 증거는 archive로 남기되 운영 import와 실행 경로에서는 제거한다.

### 7. 압축 실행표

| 창 | M-GRAPH | M-AUTO |
|---|---|---|
| **0~12시간** | builder 재현성, 제품·연구 판 정합, 전체 readiness 보고 | 신규 legacy 유입 동결, DIRECT/legacy 입구 설계 고정 |
| **12~30시간** | GRAPH_READY 2건+예비 1건, G8 admission, ArticlePlan 승인 | plan/spec 참조 queue와 DIRECT 전용 runner |
| **30~48시간** | relation·reverse·미공개 누출·rollback 검사 | production-shaped E2E·급사·멱등·lane rollback rehearsal |
| **48~72시간** | 공개 HTML·watch 확인 | 서로 다른 DIRECT 2건, DIRECT 기본 전환, legacy 활성 경로 제거 |

관계 근거를 72시간 안에 확보하지 못하면 숫자를 지어내지 않는다. 그 결과는 코드 실패가 아니라
`GRAPH_SUPPLY_INVENTORY_SHORT`로 확정하고 부족한 관계·공개 대상·cluster를 정확히 보고한다.

### 8. 병렬 작업과 검사

- **M-GRAPH writer:** research/build/readiness, graph bundle·control·resolver·watch. producer/register를 고치지 않는다.
- **M-AUTO writer:** ArticleSpec, DIRECT runner, execution ledger, QA·register·rehearsal. graph 제품 파일을 고치지 않는다.
- **OUTCOME writer:** 이번 창에서는 배정하지 않는다.
- 같은 파일은 한 번에 한 writer만 수정한다.
- 검사는 graph/plan/spec 경계, ledger·중복·급사 경계, production-shaped DIRECT E2E, exact-head 전체 회귀로 구성한다.
- 제거된 legacy 줄을 보존하기 위한 mutation은 삭제하고, 남은 경계의 실제 행동을 검출하는 변이만 유지한다.
- targeted 검사 뒤 exact-head 전수 회귀와 CI는 의미 있는 head에서 한 번씩 실행한다.

### 9. 중단과 롤백

- 보안 사고, 데이터 손실, Production 장애는 즉시 중단한다.
- DIRECT 결함은 DIRECT lane만 끄고 동결된 legacy runner를 별도 회차로 명시적으로 선택한다.
- M-GRAPH 미래 글 노출, 잘못된 관계, 기존 링크 회귀는 해당 cluster를 끄고 이전 bundle로 되돌린다.
- graph/product basis의 의미 변화는 plan을 stale로 만들며 재컴파일·재승인 전에는 보내지 않는다.
- 운영 증거 없이 legacy 활성 경로를 삭제하거나 M-AUTO OPERATING_PASS를 선언하지 않는다.

### 10. 다음 즉시 작업

1. 이 plan-first 정책을 charter와 runbook에 동기화한다.
2. M-GRAPH builder의 시각·입력·출력 경로를 명시적으로 만들어 동일 바이트 재빌드를 증명한다.
3. 전체 intent readiness를 파생 계산하고 `GRAPH_READY` 2건+예비 1건을 근거로 준비한다.
4. M-AUTO의 DIRECT/legacy run 입구를 분리하고 queue를 plan/spec 참조로 축소한다.
5. production-shaped rehearsal 뒤 서로 다른 DIRECT 2건과 rollback을 확인한다.
6. 증거가 생긴 뒤에만 legacy 활성 경로를 제거한다.
7. 모든 결과를 M-GRAPH · M-AUTO · OUTCOME으로 분리 보고한다.
