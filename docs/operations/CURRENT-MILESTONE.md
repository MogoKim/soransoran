# 현재 실행 — 자동 D100 커뮤니티

> as-of: 2026-10-01 10:55 KST
> 마지막 창업자 동기화: 2026-09-30 (opportunity → conversation 하나의 루프)
>
> 이 문서는 **검증된 현재 상태와 다음 critical path** 만 적는다. 정책과 숫자는 적지 않는다.
> 목적은 [`NORTH-STAR.md`](./NORTH-STAR.md), 판정 방식·단계 표·PASS 계약은
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md) 가 이긴다. 권위 지도는
> [`README.md`](./README.md) 하나다.
> 아래 값은 as-of 시각의 스냅샷이다. 판단 전 `npm run ops:status -- --json` 과
> `npm run d100:readiness -- --json`(⓪ 루프 깔때기 포함), `git ls-remote origin main` 으로 다시 읽는다.
> 모르는 것은 모른다고 적는다. 관측하지 않은 것을 PASS 로 쓰지 않는다.

## 1. 기준

| 항목 | 값 | 근거 |
|---|---|---|
| origin/main | `3fd47c0` (#642 Conversation Thread R1) | `git fetch` 2026-10-01 |
| runtime | `2c88642` (#635 포함) | D100 job 경로 코드는 main 과 같다. 차이는 브랜드 에셋·매거진 파일과 #642 웹 댓글 화면·검사뿐 |
| 오늘 단계 결정 | **PREPARE d1** (2026-09-30) | 아래 §3 |
| 다음 증명일 | **새 계약의 D3 증명일 없음** — 2026-10-01 D3 시험은 옛 runtime(`2c88642` · stage-decision-v4)에서만 성립한다 | 새 계약(source-slot-v1)은 D1→D3 부터 다시 증명한다. 계약 유효 Persona 0 이라 D3 preflight 가 `PERSONA_SHORT` 로 열리지 않는다(아래 §2) |
| 새 루프 구조 (source-to-slot · JIT · 단일 준비도 · Persona 4상태 · 루프 깔때기) | **Draft PR #639 · main `3fd47c0` 까지 merge · main 미반영 · 미배포** (head·CI 는 PR 페이지가 정본) | runtime 은 `2c88642` 그대로 |
| 단계 authority 하나 · 자동 일정 owner(launchd) 하나 | **#639 에 구현 · 미배포** | GitHub `auto-publish` 예약은 **`disabled_manually`**(2026-09-30) — 지금 운영 발행 주체는 **launchd 하나**다. runtime 은 아직 사람 천장 env 를 읽는다(C4) |

## 2. 상태 — code / deployed / operating PASS 를 섞지 않는다

`code PASS` = main 에 있고 검사가 지킨다. `deployed PASS` = runtime 에 올라갔다.
`operating PASS` = 무인 운영에서 실제로 관측됐다. 앞 칸이 PASS 여도 뒤 칸은 따로 증명한다.

| 축 | code PASS | deployed PASS | operating PASS | 비고 |
|---|---|---|---|---|
| 무인 글 루프 (자동 READY → 예약 발행 → 감사) | ✅ | ✅ | ✅ 2026-09-29 이전 관측 | 옛 release 계약 아래의 증명이다. 새 계약의 단계 승급 근거가 아니다 |
| 무인 첫 댓글 (60분) | ✅ | ✅ | ✅ 관측 | 09-29 자동 글 2건 13.7분·1.6분, 09-30 09:31 글(P19) → P03 14.8분 — 자기 댓글·중복 0 (읽기 전용 DB 대조) |
| D3 단계 | — | — | ❌ 2026-09-29 증거 FAIL | `PUBLISH_NOT_AUTO_READY` · `AUDIT_COVERAGE_ZERO` · `RUNNER_UNKNOWN` (자동 2 + 사람 승인 1) |
| source-to-slot 판정 · 원문 증거 보존 | ❌ | ❌ | ❌ | main 은 적재 시각을 신선도로 쓴다(옛 경로). 적재 행 대부분이 `queue.createdAt − sourceCapturedAt ≤ 1h` |
| JIT 공급 · 단일 준비도 | ❌ | ❌ | ❌ | 통합 브랜치는 700 정지선·14일 감속·재고선 화면을 지웠다. main · runtime 에는 아직 남아 있다(옛 경로) |
| 자동 사다리 (사람 env 0) | 부분 | 부분 | ❌ | controller 는 돈다. 단계 입력원이 여럿이고 사람 천장 env 를 읽는다(옛 경로) |
| 공급 예산 천장 | 부분 | 부분 | ❌ | 2026-09-28 공급 장부 $1.1925 > 승인 $0.50 (손 실행 env). main 에서 그 경로는 닫혔고 남은 우회 두 개를 비용 레인이 고치는 중 |
| Persona 4상태 · contract-valid 수 | ❌ | ❌ | ❌ | 4상태 판정은 #639 에 있다(main 미반영 · 미배포). 운영 DB 읽기 전용 실측(2026-10-01 01시 · 쓰기 0): 계약 유효 **0** · active 24 는 용량이 아니다 · 축별 — lifeAxes 막힘 16 · 말투 근거 막힘 6(P20~P25) · 자격 막힘 5(P05·P07·P10·P15·P17 카드↔DB seed 불일치) · 자격 모름 19(`VOICE_AUTHOR_HASH_SALT` 없음 — #641 이 크롤 작가 대조를 빼 이 축을 없앤다 · 미병합) · 소재 모름 18. 소재 표본 하한 정합 PR(`fix/persona-contract-consistency`, #639 위) 적용 시 소재 모름 **18 → 1(P02)** · 계약 유효는 **0 그대로**(salt). 다음 단계 preflight 는 **올라갈 단계의** 하한을 보므로 D3 하한 24 가 먼저 막는다 — **D1→D3 부터 `PERSONA_SHORT`** |
| 사람·비회원 다중 댓글 (Conversation Thread R1) | ✅ #642 | ✅ Vercel production 2026-10-01 09:40 KST | 미관측 | 스레드 root·직접 답글 대상 보존. 웹 댓글 경로만 — D100 runtime 과 무관 |
| Persona 자동 대댓글 (선택적 다중 턴) | ❌ | ❌ | ❌ | **비활성.** Persona 레인은 최상위 첫 댓글만 쓴다(`parentId` null 불변식). 첫 댓글 운영이 먼저다 |
| 상시 실행 호스트 하나 | 부분 | ❌ | ❌ | 보조 MacBook cutover 미완료 |
| 82cook 수집 | 부분 | ❌ | ❌ | 수집 job 미설치. 마지막 artifact 2026-09-12. 공급원은 네이버 카페 둘 |
| North Star 계측 | ❌ | ❌ | ❌ | 자동 운영 뒤 연결 |

## 3. 2026-09-29 ~ 10-01 단계 사건

- **09-29 D3 증거 FAIL.** 사유는 §2 표. 사람 승인 글은 자동 목표 편수에 들어가지 않는다.
- **09-30 결정 PREPARE d1.** 같은 결정 안에서 증거 판정은 `RETEST d3`, 하루 canary 판정은 OK 였다.
  그런데 `holdUnknown`(발행 runner 성패를 모름)과 14일 시뮬레이션 감속이 겹쳐 가장 보수적인
  브레이크가 이겼다. 이것은 하나의 결정을 여러 판정이 나눠 내린다는 증거다(충돌 C2).
- **10-01 D3 시험은 옛 runtime 관측이다 — as-of 진행 중, PASS 로 선포하지 않는다.** 수동 생산·수동 stage 변경 없이 관측하되, 그 결과는 옛 release 계약
  아래의 증거라 새 계약의 단계를 열지 못한다(canon §6 계약 경계). 새 계약은 D1→D3 부터 재증명한다.
- **운영 DB 읽기 전용 실측 (2026-09-30).** 큐 369행 = APPROVED 325 · EDITED 1 · PUBLISHED 36 · DECLINED 7.
  미발행 326행은 전부 `sourceEvidence` 가 없다 → 새 계약에서 자동 만료 대상 297 · 수동 확인 29(창업자 결정 행) ·
  역사 보존 43. 레거시 행은 278(214+56+5+3)이다. 최근 7일 공개 12건 중 지금 계약 도장 0건 — 원문 게시 → 공개
  지연 · 같은 날 공개 비율은 **미관측**이다(`d100:readiness` ⓪).

## 4. 다음 critical path

관측을 기다리는 동안 겹치지 않는 용량 작업은 멈추지 않는다. 한 파일 묶음에는 writer 하나다.

| 순서 | 할 일 | 끝났다는 증거 |
|---|---|---|
| P0-1 | 10-01 옛 runtime 관측 보호 — 관측 창 동안 runtime·env·launchd 를 바꾸지 않는다(새 계약 증명은 아니다) | 결정 행과 증거 판정이 사람 개입 0 으로 기록됨 |
| P0-2 | 하나의 교체: source-to-slot 판정 · 원문 증거 보존 · JIT 생성 수요 · 발행 직전 재판정·만료 · 단일 준비도 · release 판정 도장 · 계약 경계. 옛 경로를 같은 변경에서 삭제 | code PASS → deployed PASS → 새 계약 아래 D3 operating PASS |
| P0-3 | 비용 판정 하나 — 장부 정산으로 천장을 지키고 별도 장부로 새 예산을 여는 경로를 닫는다 | 우회 재생 fixture fail-closed · 운영 장부 천장 안 |
| P0-4 | Persona 4상태 판정과 contract-valid 수 — 자격 공백을 재고 자동 보충 | 준비도가 active 행이 아니라 contract-valid 수를 읽음 · **D3 하한 24 가 먼저** — 계약 유효 24 전에는 D1→D3 이 열리지 않는다 |
| P0-5 | 자동 D5 → D10 | 같은 루프가 수동 생산·옛 글 구제·정책 분기 없이 5·10편 증명 |
| P1 | 선택적 답글 레인 — 스레드 root/직접 대상 의미, replay·shadow, 제한된 실회원 우선 답글 | 답글 안전 불변식 위반 0 · 예산 안 |
| P1 | 상시 실행 호스트 하나로 이전 — 증명일이 아닌 날 리허설과 rollback | reboot·망 복구 뒤 D100 job 증명 |
| P1 | D20~D100 용량 — 원천 유입·Persona 다양성·댓글·감사 | 단계별 증명일 준비도 green |
| P2 | 7일 재방문 참여 실사용자 계측과 개선 | Persona 산출 제외 계측 |

## 5. 충돌 장부 — 코드가 정본과 다른 곳

코드 쪽 옛 경로가 사라지면 그 행을 지운다. 정책은 canon 이 이긴다.

| ID | 코드의 옛 경로 | 정본 | 닫는 증거 |
|---|---|---|---|
| C1 | 신선도가 적재(초안) 시각을 원문 나이로 쓴다 — 옛 경로 | canon §2 source-to-slot 판정 | 공개 증명 글마다 release 판정 도장 |
| C2 | 재고·준비도·단계 판정이 경로마다 다른 답을 낸다 — 옛 경로 | canon §2.2 판정 하나 · §3.1 준비도 | 같은 시각 같은 DB 에서 답 하나 |
| C3 | 700 정지선·14일 감속·2일 버퍼가 공급과 발행 러너를 움직인다 — 옛 경로 | canon §3 JIT | 옛 상수 삭제 · 슬롯 기반 생성 수요 |
| C4 | 단계 입력원이 여럿이고 사람 천장 env 를 읽는다 — 옛 경로 | canon §6 자동 사다리 | 결정 행 하나가 단계를 정함 |
| C5 | 준비도가 active 행 수로 Persona 하한을 판정한다 — 옛 경로 | canon §4 contract-valid | contract-valid 수 입력 |
| C6 | 옛 PASS 가 새 release 계약 뒤에도 승급 근거로 재계산될 수 있다 — 옛 경로 | canon §6 계약 경계 | 계약 전 PASS 로 승급 불가 fixture |
| C7 | 82cook 수집 job 이 없다 | canon §12 필수 수집원 | 보수적 canary 관측 |

## 6. 대화

대화 정책은 canon §5 하나다. 실회원 댓글과 Persona 댓글에 같은 reply-worthiness 판정을 쓰고
실회원 대화를 우선한다. 지금 운영 순서는 첫 댓글 operating PASS 가 먼저이고, 선택적 답글은 병렬로
설계·replay·shadow 를 진행한다.

## 7. 마스터와 실행 에이전트 계약

- Codex는 목적, 우선순위, 병렬 분해, PASS 판정, 비용·위험 경계를 소유한다.
- Claude Code는 구현, 검사, PR, 승인된 범위의 merge·배포·운영 관측을 끝까지 수행한다.
- 서로 다른 파일 집합은 병렬화하고, 같은 파일은 한 writer만 가진다.
- 창업자에게 PR마다 승인을 요청하지 않는다. exact head, 필수 CI, 통합 트리, rollback이 green이고
  이미 승인된 계약 안의 가역 변경이면 Codex가 순서를 정하고 Claude가 진행한다.
- 창업자 결정은 새 비용 상한, credential, 법률·브랜드 정책, DB migration, host 최종 cutover처럼
  외부 권한·비가역성이 있는 일에 한정한다.
- 예약 관측을 기다린다는 이유로 다른 구현·검사·Persona·source·host 준비를 멈추지 않는다.
