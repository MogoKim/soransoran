# Magazine current milestone

기준 시각: 2026-11-09 13:40 KST
상위 정본: `M-GRAPH-PROJECT-CHARTER.md`(목적·관계·ContentPlan·공급 정책) · `magazine-automation-runbook.md`(실행·provider·rollout·release·복구)

이 문서는 소란소란 매거진의 **현재 상태와 지금 critical path**만 관리한다. 정책은 위 두 문서에만 있고 여기에 복제하지 않는다.
목적은 글 수가 아니라, 검색으로 들어온 40대 중반~60대 중반 여성이 유용한 답을 얻고 관련 글을 더 읽고 커뮤니티로 가서
7일 안에 다른 날 다시 와 실제 글·댓글을 남기는 것이다(North Star 정의는 `NORTH-STAR.md` 그대로).
우선순위는 **OUTCOME → M-GRAPH → M-AUTO → 신뢰성 장치**다.

## 1. 2026-11-09 S0 재동결

- 2026-11-03 설계 동결 위에 **창업자 결정 5건(2026-11-09)** 을 반영했다. 정책은 charter §18-B, 실행 계약은 runbook §0.0B 에만 있다.
  - 3+1 은 품질·표시 목표 · 출판 최소는 따로(charter §18-B.2)
  - legacy 기능 동결 · HOLD·격리·초안 바이트 승계 0(runbook §0.0B.7)
  - 허용 필드 ProviderPlan 만 `store: true` · 저장·검증 뒤 DELETE(runbook §0.0B.1 · §0.0B.2)
  - 원고 모델 cheapest viable first · 예산 $5 / $1 / $30(runbook §0.0B.2)
  - 우선순위와 North Star 정의는 바꾸지 않음
- 이 문서 반영이 **S0** 이다. 코드 구현 승인은 아니다. S1 은 Codex 재검토 뒤에 시작한다.

## 2. 현재 상태 (2026-11-09 13:40 KST 읽기 전용 실측)

| 항목 | 사실 |
|---|---|
| origin/main | `a5507b76` (#835) · 11-09 fetch 로 확인 |
| runtime | `soransoran-magazine-runtime` `main` `a5507b76` · 추적 변경 0 |
| rollout | `magazine-rollout.json` 없음 → 실효 경로 **legacy** · vNext 세로 경로 코드 없음(`vnext` 이면 `VNEXT_NOT_IMPLEMENTED` 로 멈춘다) |
| launchd (회사 Mac · 매거진 레인) | `magazine-producer` · `magazine-auto-register` · `magazine-auto-merge-recovery` · `magazine-watch` · `magazine-graph-watch` loaded · 직전 종료 auto-register 1 · 나머지 0 |
| 자연 회차 11-03 ~ 11-09 | **7회 연속 등록 0** · producer 인계는 매일 `OK/0` 이라 공급 0 이 정상 종료처럼 보인다 |
| 공개 | `articles.ts` 등록 57편 = 공개 57편 → **예약 재고 0** |
| legacy 큐 (동결) | 15행 · 11-09 막힘: 전달 불명 HOLD 6 · 재생성 전송 불명 QA_FAIL 2 · 격리 3(면책 문장 오탐 · 진료 안내 누락 · description 길이) · 시리즈 순서 1 · 계절 창 3. vNext 로 승계하지 않는다 |
| 제품 graph | current `g-20261102-427d4d` · previous `g-20261021-081d9a` · 활성 cluster `sleep`·`family`·`money-work` · kill switch 꺼짐. 제품 intent 에는 콘텐츠 필드가 없다(id·cluster·board) |
| 연구 current | `g-20261102-427d4d` · Git 이 아닌 폴더 — runtime 은 직접 읽지 않는다(runbook §0.0B.1) |
| 새 출판 최소 기준 후보 (근사 · S2 compiler 가 정본으로 재계산) | 활성 cluster · 공개 대상 direct ≥1 · STANDARD 인 intent 4건: `I-T3-44` · `I-T3-47`(family) · `I-T6-03` · `I-T6-11`(money-work). `I-T6-10` 은 FINANCIAL 이라 제외. 글→글 inbound 가 있는 것은 `I-T6-03` 뿐(품질 지표) |
| 3+1 충족 미등록 intent | 0 — 품질 지표이며 출판을 막지 않는다 |
| 로컬 ①B 커밋 `a9764616` | 원격·PR 없음 · **merge 하지 않는다** · 참고 보존 → S1 병합 뒤 삭제 |
| 제품 화면 | 본문 중간 브랜드 띠배너 미구현 · hero 변환이 비율을 무시(`toHeroWebp` 의 `fit: 'fill'`) |
| 상시 호스트 | D100 레인은 2026-10-09 부터 보조 Mac 단독 owner(`ALWAYS-ON-HOST.md` §1.0). 매거진 레인은 회사 Mac 에 있다 — S10 대상 |

### 축별 판정

| 축 | 판정 | 근거 |
|---|---|---|
| **M-GRAPH** | **PARTIAL** | 공개 graph 427d4d 작동(graph watch exit 0) · ContentPlanInputBundle·compiler 미구현 · 공급 loop·graph 승격 lane 미자동화 |
| **M-AUTO** | **PARTIAL** | 7회 연속 등록 0 · 예약 재고 0 · vNext 세로 경로 미구현 · `OPERATING_PASS` 아님 |
| **OUTCOME** | **NOT PROVEN** | North Star 하한(DB) 미계산 · 매거진 귀속은 측정 수단 없음(OPEN ITEM) |

## 3. Critical path — 의존 순서

날짜가 아니라 앞 단계의 PASS 가 다음 단계를 연다. 계약은 runbook §0.0B, 관계·공급 정책은 charter §18-B 다.

| 단계 | 내용 | PASS | STOP | rollback |
|---|---|---|---|---|
| **S0 ← 현재** | 권위 문서 재동결(charter · runbook · 이 문서) | `master:doc-check` · Codex 재검토 | 창업자 결정 필요한 정책 충돌 | revert |
| S1 | 공용 코어 — QA core 추출 · 공용 상수 · WebP 판독 · 엄격 control 판독 · relation-policy 출판 최소/표시 목표 분리 · 미등록 검사 방지 | legacy 회차 산출 바이트 불변 · `magazine:auto-check` · `check:m3a` | 바이트 차이 | PR revert |
| S2 | ContentPlanInputBundle export + compiler — 출판 최소 · same-release 규칙 · 중복(legacy queue 포함) · ProviderPlan 투영 · PII scan. 현재 배포판 `g-20261102-427d4d` 의 최초 Bundle 은 **1회 bootstrap 변경**으로 추가한다(조건 정본 charter §18-B.5) | 결정적 planHash · 날짜·provider 0 · STANDARD 후보 ≥1 · bootstrap 은 해시·신원 정확 일치 · graph 바이트 변경 0 | 후보 0 → S9 를 앞당긴다 · bootstrap mismatch → 쓰기 0 | revert |
| S3 | release 경로 — `articles.ts` 전용 writer · vNext merge gate(planHash 재컴파일) · `feat/magazine-release-*` | 격리 저장소에서 Draft·auto PR 각 1 · 변조 반례 차단 · legacy PR 판정 회귀 0 | 회귀 | revert |
| S4 | Job · fake provider · 검증·부분 수리 · hero · vnext 위임 · dev 전용 시계 · production-shaped rehearsal | runbook §0.0B.8 전 항목 | 하나라도 FAIL | switch `legacy` |
| S4′ (S1 뒤 병렬) | 띠배너(`next/image`) · hero 비율 · 진단 이벤트 · 제품 전체 North Star 하한 계측(Prisma 변경 0) | 글자 크기 3단계 · 767px · 52px · 토큰 · 기존 글 렌더 회귀 0 | 회귀 | revert |
| S5 | provider canary — 창업자가 별도 project·최소 권한 키 발급 · Luna/Terra 블라인드 · `store` 실효값 · DELETE·404 · background + structured output · 이미지 16:9 | $5 안 · 계약 일치 | `DESIGN_CONTRACT_CONFLICT` | 호출 중지 · 키 폐기 |
| S6 | **A commissioning** — 같은 자동 경로를 `vnext / draft / 1` 로 · 마지막 병합만 창업자 | 사람 원고 수정 0 · 병합·공개·watch | 아니오 → 시스템 수정 · 같은 plan 재생성 | PR close · switch `legacy` |
| S7 | 다른 cluster 포함 STANDARD 2~3편 (`vnext / auto`) | 사람 입력 0 · 첫 통과 · 중복 0 · 잔존물 0 · watch 실패 0 · 비용 상한 | 기준 위반 | `targetCandidates` 1 · switch `legacy` |
| S8 | 자연 무인 회차 B → legacy 단일 삭제 단계 | B 공개 · 삭제 네 조건(runbook §0.0B.7) | 조건 미충족 | 삭제 전 switch · 삭제 뒤 git revert |
| S9 (S8 과 병렬 착수) | 지속 공급 — graph 승격 lane · Evidence 공급 loop | 출판 최소 후보가 마르지 않는다 | 수율 0 | graph previous |
| S10 | 매거진 레인을 보조 Mac 단독 owner 로 | 보조 Mac 자연 회차 1회 · 회사 Mac 매거진 job 0 · 레인 단위 owner 표식 | 이중 owner 흔적 | 역순 복귀 |

- 7 · 30 · 90일은 **관찰 창**이다(7일 공급 연속 · 30일 품질 지표 · 90일 North Star 하한 추이). 배포·삭제·이관의 gate 가 아니다.
- 그 밖의 운영 변경(legacy 보정 · queue · runtime · launchd · rollout 파일)은 이 경로에 없다.

## 4. OPEN ITEM — 블로커 아님

- **매거진 귀속** — 사람 단위 first-touch 최소 설계가 필요하다(charter §18-B.8). Prisma 변경은 별도 결정 전 0.
- **graph 승격 lane 자동화 범위** — 정책·영토 확대는 사람, 승인된 current 의 결정적 promote 는 자동 lane 후보(charter §18-B.5).
- **CONTROLLED validator** — 주장↔출처 대조 코드가 없어 CONTROLLED 출판 0(charter §18-B.6).
- **매거진 레인 이관 절차** — `ALWAYS-ON-HOST.md` 의 레인 단위 owner 계약과 맞춘다(S10).
- **문서보다 뒤인 코드** (해당 단계에서 해소): `RELATION_POLICY.directMin` 2 · builder `productionMinimum` · `TARGET_NOT_PUBLIC` 규칙 · `toHeroWebp` 의 `fill` ·
  rollout 손상 시 상태 전이 알림 미구현.

## 5. 판정 경계

- M-AUTO 판정 근거와 A 의 위치는 runbook §0.0B.6, legacy 삭제 조건은 runbook §0.0B.7 이 정본이다.
- 한 글 공개 · PR·CI·rehearsal 한 번 통과를 전체 완료로 부르지 않는다.

---

## 대체 기록

- 2026-11-09: 11-03 판의 "다음 즉시 작업 ①A" · ①A~⑦ 로컬 자식 커밋 순서 · "3+1 기준 공급 0 → 공급 loop 가 A 보다 먼저" 판정을
  §3 의 S0~S10 으로 대체했다. ①A 는 #825 로 main 에 있고, ①B 는 merge 하지 않는다(§2).
- 2026-11-03: 2026-10-16 plan-first 48~72시간 commissioning 판을 대체했다.
- 옛 전문은 Git 이력(이 문서를 바꾼 각 변경의 parent)에서 볼 수 있다.
