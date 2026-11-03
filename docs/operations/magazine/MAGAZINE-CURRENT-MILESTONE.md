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
| **1** | 설계 동결 문서 반영 | 세 문서 역할 분리 · 폐기 정책 전문 제거와 대체 기록 · `master:doc-check` PASS |
| **2** | vNext 세로 경로 구현 — 전용 branch·worktree 하나 · writer 1명 · 순차 로컬 자식 커밋 · 커밋별 Codex 재검토 · 완성 exact head 에서 full 검사 1회 · Draft PR 1회 | 아래 커밋 순서 전부 + runbook §0.0B.8 공통 PASS |
| **3** | production-shaped rehearsal (fake provider · 녹화 evidence · 격리 저장소 · 다른 cluster 포함) | runbook §0.0B.8 rehearsal PASS |
| **4** | A commissioning (실제 provider 1편 · Draft PR · auto-merge 0 · 창업자 예/아니오 · 수동 병합) | runbook §0.0B.6 |
| **5** | 첫 신규 무인 글 B 의 release·배포·공개(자연 회차) · 다른 cluster 검증 · legacy 삭제 | runbook §0.0B.6 · §0.0B.7 |

**단계 2 의 로컬 자식 커밋 순서** (단계 사다리가 아니라 한 구현 단계 안의 변경 순서)

| # | 커밋 | 범위 |
|---|---|---|
| ①A | rollout 기반 | **소유 파일**: `scripts/lib/magazine-rollout.mjs` · `scripts/magazine-rollout.mjs` · `scripts/magazine-producer-run.mjs` · `scripts/magazine-auto-register-run.mjs` · rollout check·mutation. 계약은 runbook §0.0B.5. **진입점 계약**: rollout 이 없거나 깨졌거나 `legacy` 면 기존 legacy 산출 바이트 동일 · vNext 세로 경로가 아직 없는 exact head 에서 `path: vnext` 가 들어오면 legacy 로 몰래 실행하지 않고 **명시적으로 fail-closed · 쓰기 0** · 실제 운영 rollout 파일 생성 0 |
| ①B | behavior-preserving 경계 정리 (경계 정리만 — rollout 진입점 파일은 ①A 소유) | import 시점 `process.exit` 제거(`scripts/lib/magazine-load.mjs:62-70`) · 공용 상수 이동 · lib→CLI 역참조 제거(`lib/magazine-hero-brief.mjs:37` · `lib/magazine-hero.mjs:17` · `lib/magazine-judge.mjs:26` → `magazine-qa.mjs`) · `parseControlText` 단일화 · 각 변경의 기존 동작 불변 검증 |
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

## 대체 기록

- 2026-11-03: 2026-10-16 plan-first 48~72시간 commissioning 판을 대체했다.
- 폐기된 정책: 사람 승인 ArticlePlan · direct 2 생산 최소선 · publishAt 을 담은 ArticleSpec · DIRECT 2건 뒤 legacy 삭제 · OUTCOME `DEFERRED`.
- 현재 정본: [`M-GRAPH-PROJECT-CHARTER.md`](../M-GRAPH-PROJECT-CHARTER.md) §18-B · [`magazine-automation-runbook.md`](../magazine-automation-runbook.md) §0.0B.
- 옛 전문은 Git 이력(이 문서를 바꾼 변경의 parent)에서 볼 수 있다.
