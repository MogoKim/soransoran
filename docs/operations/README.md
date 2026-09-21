# 운영 문서 지도

운영 판단은 [Master Operating System](./MASTER-OPERATING-SYSTEM.md)에서 시작한다.

## 정본 계층

| 순서 | 역할 | 문서/코드 |
|---|---|---|
| 1 | 목적·North Star | Master §1-2, 원본 `unao-main/docs/constitution/NORTH_STAR.md` |
| 2 | 현재 상태·우선순위·전체 구조 | `MASTER-OPERATING-SYSTEM.md` |
| 3 | 안전 헌법 | `../constitution/MICRO_SEED_LANE_CONSTITUTION.md` |
| 4 | Lane 상세 설계 | Original Post, Persona Network, Voice, Scale 문서, **매거진은 `M-GRAPH-PROJECT-CHARTER.md`(검색 주제망 전략) + `magazine-automation-runbook.md`(M-AUTO 실행·안전)** |
| 5 | 실행 계약 | 코드, fixture, workflow, launchd template |
| 6 | 가변 운영 상태 | DB, `supply:health --json`, 실제 scheduler 상태 |
| 7 | 역사와 사고 기록 | 날짜별 runbook과 append-only 설계 기록 |

문서와 실제가 충돌하면 코드·DB·workflow를 직접 확인하고 Master를 같은 변경에서 갱신한다.

## 사용 규칙

- “어디까지 왔나”는 Master §7을 본다.
- “전체 구조가 무엇인가”는 Master §3-4를 본다.
- “어떤 AI를 쓰고 비용이 드나”는 Master §5를 본다.
- “지금 무엇을 해야 하나”는 Master §12를 본다.
- 전략 변경은 Master §13의 다섯 항목을 한 PR에서 함께 갱신한다.
- 매거진의 검색 키워드·주제 선정·시리즈·관련 글·SEO 성장은 `M-GRAPH-PROJECT-CHARTER.md`를 먼저 본다.
- 매거진 설치·가동·병합·공개 감시는 `magazine-automation-runbook.md`를 본다. 둘을 섞지 않는다.
- 날짜별 문서의 과거 숫자를 현재값으로 인용하지 않는다.
- 설계, main 구현, 설정, 가동, 관찰을 분리해 보고한다.

## 상세 문서 분류

| 문서 | 역할 |
|---|---|
| `M-GRAPH-PROJECT-CHARTER.md` | 🔴 매거진 검색 영토·주제망·시리즈·내부 연결·장기 발행 계획의 전략 정본 (정본 계층 4단계 · Master §4) |
| `2026-09-03-controlled-activity-automation-strategy.md` | 자동화 속도·안전 전략 상세 |
| `2026-09-02-original-post-lane-strategy.md` | Original Post Lane 상세 |
| `2026-08-29-persona-network-strategy.md` | Persona와 댓글 비율 전략 상세 |
| `2026-08-30-persona-architecture-design.md` | Persona 생성·기억·매칭 설계 상세 |
| `2026-09-08-scale-foundation.md` | d1/d3/d5/d10 scale 계약 상세 |
| `2026-09-03-raw-supply-chain-design.md` | 구현 역사와 사고 기록 |
| `2026-08-26-soransoran-milestones.md` | 과거 마일스톤 기록, 현재 상태 정본 아님 |
