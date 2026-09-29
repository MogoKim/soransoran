# 운영 문서 지도

운영 판단은 목적, 규모, 현재 실행을 먼저 읽고 기술 상세가 필요할 때 Master로 내려간다.

## 정본 계층

| 순서 | 역할 | 문서/코드 |
|---|---|---|
| 1 | 목적·고객·제품 품질·North Star | `NORTH-STAR.md` |
| 2 | D3→D100 자동 규모와 PASS 계약 | `2026-09-21-d100-goal-canon.md`, 수치는 `src/lib/d100-capacity.ts` |
| 3 | 현재 상태·우선순위·다음 실행 | `CURRENT-MILESTONE.md` |
| 4 | 기술 지도·Lane 계약·역사 증거 | `MASTER-OPERATING-SYSTEM.md` |
| 5 | 안전 헌법 | `../constitution/MICRO_SEED_LANE_CONSTITUTION.md` |
| 6 | Lane 상세 설계 | Original Post, Persona Network, Voice, Scale 문서, **매거진은 `M-GRAPH-PROJECT-CHARTER.md`(검색 주제망 전략) + `magazine-automation-runbook.md`(M-AUTO 실행·안전)** |
| 7 | 실행 계약 | 코드, fixture, workflow, launchd template |
| 8 | 가변 운영 상태 | DB, `supply:health --json`, 실제 scheduler 상태 |
| 9 | 역사와 사고 기록 | 날짜별 runbook과 append-only 설계 기록 |

문서와 실제가 충돌하면 코드·DB·workflow를 직접 확인한다. 목적이나 정책 충돌은 위 순서의
상위 문서가 이기고, 가변 상태 충돌은 실측이 이긴다. 해당 정본과 현재 실행 문서를 같은 변경에서
갱신한다.

## 사용 규칙

- “왜 하는가, 어떤 글이어야 하는가”는 `NORTH-STAR.md`를 본다.
- “D10/D100 성공이 무엇인가”는 `2026-09-21-d100-goal-canon.md`를 본다.
- “어디까지 왔고 다음에 무엇을 하는가”는 `CURRENT-MILESTONE.md`를 본다.
- “전체 구조가 무엇인가”는 Master §3-4를 본다.
- “어떤 AI를 쓰고 비용이 드나”는 Master §5를 본다.
- 전략 변경은 목적·D100 목표·현재 실행 문서와 Master §13의 영향 범위를 함께 갱신한다.
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
