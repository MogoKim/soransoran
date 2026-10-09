# D100 문서 분류표 — 권위·실행 입력·runbook·역사

> 상태: **문서 목록**. 이 파일은 정책이나 현재 운영 상태를 정하지 않는다.
> 권위 순서는 [`README.md`](./README.md), 현재 상태는 [`CURRENT-MILESTONE.md`](./CURRENT-MILESTONE.md)가 정한다.
> 목적은 “어떤 문서를 믿어야 하는가”와 “왜 남아 있는가”를 한눈에 구분하는 것이다.

## 1. 분류 규칙

| 분류 | 의미 | 현재값을 말할 수 있는가 |
|---|---|---|
| `AUTHORITY` | 목적·정책·현재 상태·기술 지도의 상위 문서 | 자기 역할 안에서만 가능 |
| `EXECUTABLE_INPUT` | runtime이나 검사가 구조화해 직접 읽는 좁은 입력 | 입력 필드만 가능. 제품 정책·운영 상태는 불가 |
| `RUNBOOK` | 승인된 정책을 실행·복구하는 절차 | 관측 명령만 가능. 정책·현재 상태를 새로 정하지 못함 |
| `HISTORY` | 설계 근거·사고·과거 실측·폐기된 절차 | 불가. 현재 정책에 투표하지 않음 |
| `ADJACENT` | 매거진·회원 전환·브랜드 등 별도 영역 | 자기 영역에서만 가능. D100을 덮지 못함 |

파일명에 날짜가 있다는 이유만으로 분류하지 않는다. 날짜 문서라도 runtime이 직접 읽는 좁은 입력이면
`EXECUTABLE_INPUT`이다. 반대로 제목에 “정본”이 있어도 아래에서 `HISTORY`면 과거 명칭일 뿐이다.

분류를 관리하는 메타 파일은 둘이다. `README.md`는 권위 순서를 찾는 인덱스이고,
`D100-DOCUMENT-INVENTORY.md`는 이 분류표 자체다. 둘 다 제품 정책이나 현재 상태를 새로 정하지 않는다.

## 2. AUTHORITY — 네 문서만

| 문서 | 역할 |
|---|---|
| `NORTH-STAR.md` | 고객·제품 본질·장기 North Star·영구 안전장치 |
| `2026-09-21-d100-goal-canon.md` | D3~D100 정책·단계 숫자·PASS·Persona·대화 계약 |
| `CURRENT-MILESTONE.md` | as-of가 붙은 검증 상태·충돌 장부·다음 critical path |
| `MASTER-OPERATING-SYSTEM.md` | 기술 지도·모델/비용 구조·역사 증거. 현재 상태·정책은 말하지 않음 |

이 넷의 충돌 순서는 README 표를 따른다. 이 분류표를 다섯 번째 권위 문서로 해석하지 않는다.

## 3. EXECUTABLE_INPUT — 현재 코드가 직접 읽는 좁은 입력

| 문서 | 실행 입력 | 경계 |
|---|---|---|
| `2026-08-30-persona-pool-design.md` | §5 Persona 카드. `PERSONA_POOL_DOC`를 통해 생성·댓글·감사·cohort 도구가 파싱 | 카드 필드만 기술 입력. 인원 목표·현재 active 수·단계 정책은 D100 canon/CURRENT가 정함 |
| `../constitution/MICRO_SEED_LANE_CONSTITUTION.md` | Micro Seed 안전·DB write·승인 경계 | D100 단계와 현재 운영 상태는 정하지 않음 |

코드 주석이 아래 역사 문서를 “정본”이라고 부르는 곳이 남아 있다. 그 표현은 구현 당시 출처를 뜻할 뿐
제품 정책 authority가 아니다. 현재 동작은 코드·fixture, 상위 정책은 네 권위 문서로 판정한다. 주석을
일괄 삭제하거나 역사 문서를 현재화하지 않고, 해당 코드를 수정할 때 `역사 설계 근거`로 순차 교정한다.

## 4. RUNBOOK — 현재 실행 절차

| 문서 | 역할 | 현재 상태 확인 방법 |
|---|---|---|
| `ALWAYS-ON-HOST.md` | 보조 Mac 단일 owner·cutover·rollback·전원/로그인/비밀 계약 | `host:migrate`, launchctl, owner 표식 |
| `launchd/README.md` | 템플릿·runtime 배포·스케줄 관측·수동 진단 | `launchctl`, `runtime:deploy`, stage wrapper |

runbook의 오래된 실측 절은 `📜` 또는 “작성 당시 스냅샷”으로 분리한다. 등록 템플릿이 있다는 사실과
현재 loaded 상태를 합치지 않는다.

## 5. HISTORY — D100 설계·구현·사고 기록

### 5.1 Micro Seed·공급·발행

| 문서 | 보존 이유 |
|---|---|
| `2026-08-26-micro-seed-m1-runbook.md` | 첫 Micro Seed 발행 절차와 초기 실측 |
| `2026-08-26-soransoran-milestones.md` | 옛 M1~M10 마일스톤 namespace |
| `2026-09-02-original-post-lane-strategy.md` | Original Post 레인 형성 과정 |
| `2026-09-03-controlled-activity-automation-strategy.md` | 자동화 전환 당시 속도·안전 판단 |
| `2026-09-03-raw-supply-chain-design.md` | 공급망 구현·사고·세부 함수의 설계 근거 |
| `2026-09-08-d10-activation-prep.md` | 옛 D10 준비와 복구 절차 |
| `2026-09-08-scale-foundation.md` | 옛 d1~d10 용량·재고 설계 |
| `2026-09-14-reliable-publish-scheduler.md` | scheduler·catch-up 설계와 지연 실측 |

### 5.2 Persona·대화

| 문서 | 보존 이유 |
|---|---|
| `2026-08-29-persona-network-strategy.md` | 관계·기억·댓글 비율의 초기 전략 |
| `2026-08-30-m3-reaction-map-design.md` | 반응 역할 지도 설계 근거 |
| `2026-08-30-persona-architecture-design.md` | Persona 필드·기억·매칭·댓글 구조의 초기 설계 |
| `2026-08-30-persona-mvp-activation-design.md` | 초기 5명 cohort 기록 |
| `2026-08-30-persona-safety-originality-gate-design.md` | 안전·독창성 gate 설계 근거 |
| `2026-08-31-persona-db-model-design.md` | Persona DB와 어드민 설계 근거 |
| `2026-08-31-persona-gate6-nickname-collision-design.md` | 기존 닉네임 충돌 gate 설계 근거 |
| `2026-09-08-persona-wave2-runbook.md` | wave2 활성화 기록 |
| `2026-09-14-persona-age-perspective.md` | 나이·생활사 모순 실측과 모델 한계 |
| `2026-09-23-speaker-relative-facts.md` | 원문 화자 사실을 Persona에게 복제하지 않는 근거 |

### 5.3 Voice 자산

| 문서 | 보존 이유 |
|---|---|
| `2026-08-26-voice-corpus-import-operations.md` | 과거 코퍼스 적재·누출 사고 |
| `2026-08-26-voice-derived-m2-design.md` | 규칙 기반 파생 신호 설계 |
| `2026-08-27-voice-engine-legacy-data-strategy.md` | UnaEO legacy 데이터의 과거 read-only 활용 판단 |
| `2026-08-27-voice-engine-schema-strategy.md` | Voice 자산 구조의 설계 근거 |
| `2026-08-27-voice-engine-style-strategy.md` | 자연 유사성·복제 유사성 경계 |
| `2026-08-27-voice-engine-v0-contract.md` | 초기 Voice Engine 계약 |
| `2026-08-27-voice-m2-completion.md` | M2 완료 기록 |
| `2026-08-27-voice-m3-full-scale-plan.md` | 당시 전량 확대 계획 |
| `2026-08-27-voice-m3-llm-experiment-contract.md` | M3 모델 실험 계약 |
| `2026-08-27-voice-m3-model-selection-criteria.md` | 모델 선택 근거 |
| `2026-08-29-voice-m3-export-design.md` | export 설계 근거 |
| `2026-08-29-voice-m3-learning-policy.md` | 학습 후보 선별의 과거 정책 |

Voice 역사 문서와 `voice-unao-*` 이름이 남아 있다는 사실은 소란소란과 우나어의 운영 경계를 합친다는 뜻이
아니다. D100 active runtime에서 UnaEO DB·credential·콘텐츠를 읽는 경로가 없는지 별도 서비스 경계 감사로
증명하고, 중립 상수만 쓰는 import는 소란소란 모듈로 옮긴 뒤 legacy connector를 분류한다.

## 6. ADJACENT — D100과 별도 영역

| 영역 | 대표 문서 | D100과의 경계 |
|---|---|---|
| 회원가입 전환 | `MEMBER-CONVERSION-CANON.md` | `MC-*`·`CB-*` 단계. D100 단계·공급·Persona를 변경하지 않음 |
| 매거진 검색 전략 | `M-GRAPH-PROJECT-CHARTER.md` | 검색 주제망 영역 한정 |
| 매거진 자동화 | `magazine-automation-runbook.md` | 회사 Mac 매거진 4개 job. 보조 Mac D100 owner와 분리 |
| 브랜드·UI | `soransoran-brand-design-spec.md` | 화면·색·타이포 정본. D100 운영 상태를 정하지 않음 |
| 공개 launch 인계 | `2026-08-22-soransoran-public-launch-handoff.md` | 공개 전환 당시 기록. D100 현재 상태가 아님 |
| 매거진 SEO 생산 전략 | `2026-08-23-soransoran-magazine-seo-production-strategy.md` | 매거진 영역의 과거 생산 전략 |
| 매거진 전략 | `2026-08-23-soransoran-magazine-strategy.md` | 매거진 영역의 과거 전략 |
| SEO 색인 정책 | `2026-08-23-soransoran-seo-index-policy.md` | 검색·색인 영역의 좁은 정책 |
| 매거진 연속 운영 | `2026-08-25-magazine-continuation-runbook.md` | 매거진 과거 인계 절차 |
| 성능 기준선 | `2026-08-25-soransoran-performance-baseline.md` | 웹 성능 영역의 과거 기준선 |
| 디자인 시스템 안정화 | `2026-08-26-soransoran-design-system-stabilization.md` | UI·브랜드 영역의 과거 작업 기록 |

## 7. 서비스·작업공간 경계

소란소란 작업은 저장소 루트와 서비스 이름을 먼저 확인한다.

```bash
git rev-parse --show-toplevel
git remote get-url origin
node -p "require('./package.json').name"
```

- 루트가 의도한 `soransoran*` worktree가 아니거나 package name이 `soransoran`이 아니면 중단한다.
- `unao-main`·`age-doesnt-matter`에서 소란소란 명령·문서 수정·DB/env 접근을 하지 않는다.
- 다른 agent가 쓰는 worktree를 재사용하지 않는다. 같은 파일은 한 writer만 가진다.
- worktree 수가 많다는 사실은 보존 이유가 아니다. owner·브랜치·용도가 없는 것은 별도 감사 뒤 정리한다.

## 8. 변경 규칙

1. 제품 목적·정책·단계 숫자 변경: AUTHORITY와 `master:doc-check`를 같은 변경에서 고친다.
2. 현재 운영 사실 변경: `CURRENT-MILESTONE.md`의 as-of·증거·critical path를 고친다.
3. 구조화 Persona 카드 변경: `EXECUTABLE_INPUT`과 파서·fixture를 함께 검증한다.
4. 실행 절차 변경: RUNBOOK과 실제 CLI help/template/check를 함께 검증한다.
5. 과거 문서는 삭제해 현재화하지 않는다. 상단 분류를 명확히 하고 증거로 보존한다.
6. 새 D100 문서를 만들면 이 목록의 정확히 한 분류에 추가한다.
