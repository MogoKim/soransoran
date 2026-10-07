# 운영 문서 지도

🔴 **이 README 가 권위 인덱스 하나다.** 현재 정책이나 실행을 말할 수 있는 문서는 아래 넷뿐이다.
새 에이전트는 이 README 와 네 문서만 읽고 목적·North Star·현재 단계·D3~D100 PASS·신선도·
Persona 용량·답글·다음 실행에 답할 수 있어야 한다.

## 권위 문서

| 순서 | 문서 | 정하는 것 | 정하지 않는 것 |
|---|---|---|---|
| 1 | `NORTH-STAR.md` | 고객 · 제품 본질 · 장기 North Star · 영구 안전장치 | 단계 숫자 · 현재 상태 |
| 2 | `2026-09-21-d100-goal-canon.md` | D3~D100 정책 — source-to-slot 판정 · JIT 공급 · Persona 4상태 · 대화 · 단계 PASS · 마일스톤 | 현재 상태 · 실측 보충량 |
| 3 | `CURRENT-MILESTONE.md` | as-of 시각이 붙은 검증 상태 · code/deployed/operating PASS · 다음 critical path · 코드와 정본의 충돌 | 정책과 정책 숫자 |
| 4 | `MASTER-OPERATING-SYSTEM.md` | 기술 지도 · 모델과 비용 구조 · 역사 증거 | 현재 운영 상태 · 현재 정책 |

## 충돌이 나면

- **목적·정책 충돌**: 위 순서의 앞 문서가 이긴다. 정책 숫자는 D100 canon 이 정본이고, 코드는 그
  구현이다. 코드가 canon 과 다르면 코드가 낡은 것이다 — `CURRENT-MILESTONE.md` 충돌 장부에 적고 코드를 고친다.
- **가변 상태 충돌**: runtime·DB·로그 실측이 낡은 상태 스냅샷을 이긴다. 실측은 제품 목표를 이기지 못한다.
- **새 정책**은 자기가 대체한 옛 경로를 canon 의 "제거·대체한 옛 경로" 표에 같은 변경으로 적는다.
  같은 결정을 내리는 정본이 둘이면 결함이다.
- 아래 상세·역사 문서는 현재 정책에 투표하지 않는다. **파일명에 날짜가 붙은 문서는 아래 표에서
  명시적으로 권위를 받은 D100 canon 하나를 제외하면 제품 정책·현재 상태 기준에서는 전부 역사 자료다.**
  과거 숫자를 현재값으로 인용하거나 제목의 `정본`·`단일 진실` 표현을 현재 권위로 해석하지 않는다.
  현재 코드가 직접 참조하는 좁은 기술 계약·runbook은 절차 자료로 쓸 수 있지만 상위 제품 정책을 바꾸지 못한다.
- runbook은 승인된 현재 정책을 실행하는 절차만 정한다. 제품 목적·단계·콘텐츠 정책을 새로 정하지 않는다.

## 어디서 찾나

| 질문 | 문서 |
|---|---|
| 왜 하는가, 어떤 글이어야 하는가 | `NORTH-STAR.md` |
| 원문이 슬롯 시점에도 지금의 이야기인가(신선도) | canon §2 source-to-slot 판정 |
| 무엇을 미리 준비하고 무엇을 그 시점에 만드나 · 준비도 | canon §3 |
| Persona 용량은 무엇으로 세나 | canon §4 |
| 첫 댓글 · 답글 · 대화 계속/멈춤 | canon §5 |
| 단계 PASS · 승격 · 재시험 | canon §6 |
| 오늘 단계는 누가 정하나 · 자동 일정 owner | canon §6 (`StageDecision` 하나 · launchd 하나) — 구현·배포 상태는 `CURRENT-MILESTONE.md` |
| D100 운영 Mac 이전·되돌리기 | `ALWAYS-ON-HOST.md` — 정책을 정하지 않는 현재 실행 runbook |
| 정치와 연예·방송·셀럽의 경계 | canon §7.1 — 정치 선동은 제외, 공개 인물 소재는 안전 gate 뒤 정상 경쟁 |
| 홈·베스트에서 실회원과 Persona 반응을 어떻게 보나 | canon §7.2 — 실회원 우선, 합성 활동 별도 관측 |
| 현재 마일스톤과 완료 증거 | canon §8 |
| 루프가 어디서 막히나(원문 게시 → 공개 지연 · 슬롯 채움 · 첫 댓글 · Persona 공백) | canon §9 측정 — 관측 화면 `npm run d100:readiness` ⓪ · `npm run ops:status` |
| 어디까지 왔고 다음에 무엇을 하나 | `CURRENT-MILESTONE.md` |
| 전체 구조 · 어떤 AI 를 쓰고 비용이 드나 · 과거 사고 | `MASTER-OPERATING-SYSTEM.md` |
| 매거진 (D100 과 별도 영역) | `M-GRAPH-PROJECT-CHARTER.md`(검색 주제망 전략) · `magazine-automation-runbook.md`(M-AUTO 실행·안전) |

## 보고 규칙

- 설계 · main 구현 · 설정 · 가동 · 관찰을 분리해 보고한다. 완료는 `code PASS` · `deployed PASS` ·
  `operating PASS` 로 나눠 쓴다.
- 코드·DB·workflow 가 문서와 다르면 직접 확인한다. 추측으로 문서를 맞추지 않는다.
- 전략이 바뀌면 권위 문서와 문서 검사(`npm run master:doc-check`)를 같은 변경에서 갱신한다.

## 현재 실행 runbook — 정책 투표권 없음

| 문서 | 역할 |
|---|---|
| `ALWAYS-ON-HOST.md` | 상시 실행 호스트의 사전 점검·rehearsal·quiesce·cutover·rollback. 단계·콘텐츠·Persona 정책은 정하지 않고 위 권위 문서를 실행한다 |

runbook의 명령은 현재 정본 정책과 현재 상태를 먼저 확인한 뒤 실행한다. 역사 문서에 남은 수동 stage env,
GitHub 예약, 완성 글 재고 절차를 runbook처럼 사용하지 않는다.

## 상세·역사 문서 — 정책 투표권 없음

아래 문서는 설계 근거·사고·과거 실측을 보존한다. 내용이 유용해도 현재 정책 문장으로 복사하지 않고,
필요한 결론만 권위 문서에 반영한다. 역사 문서를 현재화하려면 그 문서를 다시 정본으로 만들지 말고
권위 문서와 `master:doc-check`를 같은 변경에서 고친다.

| 문서 | 역할 |
|---|---|
| `../constitution/MICRO_SEED_LANE_CONSTITUTION.md` | Micro Seed 안전 헌법 |
| `M-GRAPH-PROJECT-CHARTER.md` | 매거진 검색 영토·주제망·시리즈·내부 연결·장기 발행 계획의 전략 정본 (매거진 영역 한정) |
| `magazine-automation-runbook.md` | 매거진 M-AUTO 설치·가동·병합·공개 감시 |
| `2026-09-03-controlled-activity-automation-strategy.md` | 자동화 속도·안전 전략의 역사 |
| `2026-09-02-original-post-lane-strategy.md` | Original Post Lane 구현 역사 |
| `2026-08-29-persona-network-strategy.md` | Persona와 댓글 비율 전략 상세 (역사) |
| `2026-08-30-persona-architecture-design.md` | Persona 생성·기억·매칭 설계 상세 |
| `2026-09-08-scale-foundation.md` | d1/d3/d5/d10 scale 계약 상세 (역사 — 완성 글 재고 목표와 옛 단계 절차는 대체됨) |
| `2026-09-08-d10-activation-prep.md` | d10 준비 기록 (역사 — capture 시각 proxy 와 완성 글 재고 관문은 대체됨) |
| `2026-09-03-raw-supply-chain-design.md` | 구현 역사와 사고 기록 |
| `2026-08-26-soransoran-milestones.md` | 과거 마일스톤 기록, 현재 상태 정본 아님 |
