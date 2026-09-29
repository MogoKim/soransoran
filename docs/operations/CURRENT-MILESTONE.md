# 현재 실행 정본 - 자동 D100 커뮤니티

> 마지막 창업자 동기화: 2026-09-29 10:59 KST
>
> 이 문서는 **지금 어디까지 왔고 무엇을 바로 끝낼지**만 정한다. 목적과 품질은
> [`NORTH-STAR.md`](./NORTH-STAR.md), 단계 성공과 목표 수치는
> [`2026-09-21-d100-goal-canon.md`](./2026-09-21-d100-goal-canon.md)가 이긴다.
> 아래 운영 숫자는 스냅샷이다. 판단 전 `npm run ops:status -- --json`과
> `npm run d100:readiness -- --json`으로 다시 읽는다.

## 1. 이번 단계의 목적과 완료

소란소란은 40대 중반부터 60대 중반 여성, 특히 50대 여성이 오늘의 생활과 관심사를 말하고,
사람 같은 반응을 받고, 다시 돌아오는 살아 있는 커뮤니티다. 잔잔한 원문은 잔잔하게 살려도 된다.
논쟁·남녀 갈등·연예·가십·돈·건강·관계가 원문의 참여 동력이면 AI가 그것을 훈계나 일반론으로
평탄화하면 실패다.

현재 단계의 완료는 아래 사슬이 **창업자 명령 없이** D10 규모에서 자동으로 반복되는 것이다.

```text
신선한 원천 수집 -> 참여 동력 기반 선택 -> Persona 초안 -> 자동 READY 보충
-> 자동 단계 결정 -> 슬롯 발행 -> 60분 내 첫 Persona 댓글
-> 발행 후 감사 -> 장애 격리·복구·감속 -> 다음 단계 자동 시험
```

PR, CI, helper, 수동 회차, 수동 stage override는 완료가 아니다. 완료 이름은
`code PASS`, `deployed PASS`, `operating PASS`로 나눠 쓴다.

## 2. 2026-09-29 10:59 운영 실측

| 축 | 실측 | 판정 |
|---|---|---|
| main / runtime | `ef472aa` / `2c20d40` | main 차이는 D100 host 이전 묶음. 현재 D100 글·댓글 실행 코드는 runtime에 있음 |
| M1 글 루프 | 09:30 자동 발행, Queue/Post/ActivityLog 일치 | **OPERATING PASS** |
| M2 첫 댓글 | 공개 댓글 0, 마지막 Persona 댓글은 09-15. runner는 절전 복구 뒤 exit 0·health `ok` | **NOT PASS** — 실행 회복과 공개 성공은 다르다 |
| 오늘 단계 | controller `TRIAL d3`, 공개 글 1/3 | 09:30 글이 60분 내 댓글을 못 받아 오늘 통합 D3 PASS 불가 |
| 자동 READY | ON | M1에서 작동. 글별 창업자 승인 없음 |
| 감사 | job loaded, 최근 exit 0 | 글 발행 후 감사 경로는 운영됨. D3 전 글 감사 증명은 남음 |
| READY 재고 | publishable 21 | 하루 시험은 가능. 지속 D3 14일 목표 42에는 미달 |
| READY 생산 | 2.5/day | 지속 D3 필요 4/day 미달 |
| 상세 원천 | Wgang 49.8 + Remonterrace 42.4 = 92.2/day | D20 필요 77/day까지 수량 충족, D30 필요 115/day부터 부족 |
| 82cook | job 없음, 측정 없음 | 보수적 canary 미착수 |
| Persona | active 24 | 자격 충돌 전원 미측정. 카드 기준은 미측정 제외 시 6명뿐 |
| Persona 결손 | life axis 16, dormant 7, voice evidence 6, no-go 표현 15 | 이름 수가 아니라 계약 유효 인원이 병목 |
| scheduler | D3/D5/D10 지원 | D20/D30/D50/D100 미지원 |
| 자동 승격 | 코드가 7/14/21일 대기와 사람 stage 변경을 요구 | 최신 창업자 계약과 충돌 |
| 상주 실행 | main MacBook job + keep-awake | 보조 MacBook 단일 소유권 cutover 미완료 |
| North Star 계측 | 미등록 | 현재 P0 아님. D10 자동 운영 뒤 연결 |

`persona:comment-health`는 runner를 `ready`라 하면서도 사람 승인 Queue가 없어서 공개 불가라고
보고한다. `ops:status`의 comment lane은 절전 직후 DB 실패에서 회복해 현재 `ok`지만, 공개 댓글은
여전히 0이다. 실행 회복·코드 준비·실제 공개 성공을 섞으면 안 된다. 새 자동 글에 댓글이 생겨
DB와 공개 페이지가 일치하기 전까지 M2를 PASS로 읽지 않는다.

## 3. 단계 PASS와 즉시 자동 승격

### 3.1 첫 운영 PASS

한 단계의 첫 운영 PASS는 controller가 선택한 자동 하루 시험에서 다음을 모두 만족할 때다.

1. 목표 글 수를 예약 작업이 서로 다른 적격 Persona로 공개한다.
2. 모든 대상 글에 60분 안에 첫 Persona 댓글이 공개된다.
3. 정본 감사 표본 `ceil(자동 발행 N × 20%)`이 1건 이상 자동 선정되고, 선정된 감사 판정과
   다음 회차 open/close 판정이 끝난다. 전수 감사를 새 선행조건으로 만들지 않는다.
4. 중복 글·댓글, 자기 글 댓글, 실사용자 대화 침범, Persona 생활사 충돌이 0이다.
5. READY 보충, 비용 장부, 장애 격리와 rollback이 정상이다.

수동 공급·발행·댓글·단계 override는 commissioning일 뿐 단계 PASS가 아니다.

### 3.2 성공하면 바로 다음 단계

- 성공한 단계와 다음 단계 preflight가 green이면 controller가 다음 자동 canary를 즉시 예약한다.
- 같은 날 남은 슬롯으로 목표 전체를 정직하게 증명할 수 있으면 같은 날 시작한다.
- 그렇지 않으면 다음 KST 운영일의 첫 유효 슬롯에서 시작한다.
- 임의의 7/14/21일 대기나 사람이 env를 바꾸는 절차를 사이에 넣지 않는다.
- 한 단계 실패는 자동 감속·원인 격리 후 같은 단계를 다시 시험한다. 전체 개발은 멈추지 않는다.

### 3.3 첫 시험과 지속 운영을 분리한다

| 계약 | 첫 자동 canary | 지속 운영 |
|---|---|---|
| 재고 | 목표 공개량의 2일치 publishable stock | 14일치 stock |
| 관측 | 목표 하루 전량의 글·댓글·감사 완주 | 반복 성공률·READY 순증가·집중도·비용 추세 |
| Persona | canary 운영 하한과 당일 배정 가능성 | 단계별 다양성 목표와 다음 날 cadence 여력 |
| 승격 | PASS 직후 다음 canary 예약 | 반복 증거로 상시 release 유지·감속 판단 |

14일 재고와 반복 관측은 버리지 않는다. **다음 단계 첫 시험을 막는 대기열에서 빼고 병렬로
축적한다.** 현재 readiness의 `재고 21 < 42`, `7일 미달`은 지속 운영 경고이지 D3 첫 시험을
일주일 멈추라는 명령이 아니다.

## 4. 실행 마일스톤

날짜 약속이 아니라 증거가 끝나는 즉시 다음 칸으로 이동한다. 서로 다른 파일과 실행 경로는
동시에 진행한다.

| M | 목표 | operating PASS | 현재 |
|---|---|---|---|
| M0 | 정본·역할 통합 | 목적·단계·현재 실행·역사의 권한이 하나로 정렬되고 문서 검사가 지킴 | 이 브랜치에서 보정 중 |
| M1 | 무인 글 루프 | 자동 READY -> 공개 발행 -> 감사 -> 다음 회차 상태 전이 | **PASS** |
| M2 | 무인 첫 댓글 | 새 자동 글마다 60분 내 첫 댓글, DB/공개면 일치, 중복·자기 댓글 0 | **NOT PASS** |
| M3 | 상주 운영 | 보조 MacBook이 D100 9개 job을 단독 소유하고 reboot/network recovery 증명 | 패키지 main 반영, 실제 cutover 미완료 |
| M4 | 자동 D3 | controller 선택 3글 + 각 댓글 + 정본 감사 표본 + READY 보충 | 오늘 통합 시험 실패, 재시험 필요 |
| M5 | 자동 D5 | D3 PASS가 사람 없이 D5 시험을 열고 5글 사슬 완주 | 미완료 |
| M6 | 자동 D10 | D5 PASS가 사람 없이 D10 시험을 열고 10글 사슬 완주 | 미완료 |
| M7 | D20 준비·시험 | generic scheduler, READY 24/day, canary Persona 40, 다양성 60, 댓글 20~100/day | 미착수 |
| M8 | D30 준비·시험 | READY 36/day, 원천 115/day, canary Persona 60, 다양성 90 | 미착수 |
| M9 | D50 준비·시험 | READY 60/day, canary Persona 100, 다양성 150, 댓글 최대 250/day | 미착수 |
| M10 | D100 첫 자동 운영 | 100글 + 100~500댓글 + 감사·복구·비용·중복 계약 | 미착수 |
| M11 | 지속 D100 | READY 120/day, 원천 382/day, 계약 유효 Persona 300+, 반복 자동 운영 | 미착수 |
| M12 | 실사용자 성장 | 7일 재방문 참여 실사용자 계측과 개선 | 자동 운영 뒤 착수 |

## 5. 지금부터의 critical path

### P0-A. 댓글을 실제로 살린다

1. `ops:status`와 comment runner의 회차 종료·실패 코드를 같은 장부로 만든다.
2. `persona:comment-health`의 사람 승인 Queue 전제를 `bootstrap-auto` 실제 계약과 맞춘다.
3. 새 자동 발행 글에 최대 3회 시도해 60분 내 공개 댓글을 만들고 DB와 공개 페이지를 대조한다.
4. 한 번 성공으로 끝내지 않고 D3 하루 3글 전부에 적용한다.

### P0-B. 승격기를 증거 기반 상태기계로 바꾼다

1. `minimumObservationDays`를 첫 canary gate에서 제거하고 지속 안정성 지표로 이동한다.
2. `사람이 SORAN_RELEASE_STAGE를 올린다`를 제거한다.
3. `D3 -> D5 -> D10 -> D20 -> D30 -> D50 -> D100`을 하나의 generic stage profile로 처리한다.
4. PASS 즉시 다음 시험 예약, 실패 즉시 감속·격리·재시험을 fixture와 격리 DB로 검증한다.
5. 2일치 canary 재고와 14일치 지속 재고를 별도 필드·보고서로 만든다.

### P0-C. Persona를 자동으로 확장한다

1. 현재 24명의 자격 미측정 축을 먼저 계산한다.
2. life axis·관점·말투·지역·가족·일·경제·돌봄·no-go의 부족 벡터를 만든다.
3. 부족 축을 채우는 Persona를 생성하고, 생활사 일관성·voice evidence·글/댓글 자격을 자동 검증한다.
4. canary 운영 하한과 지속 다양성 목표를 코드의 서로 다른 필드로 둔다.
5. 특정 Persona·주제·말투에 몰리면 다음 Persona batch를 자동 생성한다.

### P0-D. 공급과 시의성을 규모에 맞춘다

1. 조회수·댓글 수·댓글 증가 속도·신선도로 원천을 고르고 참여 동력을 artifact에 남긴다.
2. `source captured -> candidate -> published` 지연을 측정하고 시의성 소재를 빠른 슬롯으로 보낸다.
3. Wgang·Remonterrace 92.2 detail/day는 D20까지 사용하고, D30 전에 추가 23/day 이상을 확보한다.
4. 82cook은 로그인/CAPTCHA/403/429 fail-closed, 낮은 요청 cap의 canary부터 자동 확대한다.
5. 공인·연예·남녀 갈등 소재를 주제만으로 버리는 collector/gate 회귀를 제거한다.

### P0-E. 상주 인프라와 관제를 닫는다

1. main MacBook은 개발·통제·rollback, 보조 MacBook은 D100 runtime 단일 소유자로 둔다.
2. 두 호스트 동시 소유를 막은 뒤 9개 D100 job만 이전한다. 매거진 job은 옮기지 않는다.
3. AC·로그인·네트워크·reboot 뒤 collect/supply/publish/comment/audit/controller/recovery를 증명한다.
4. 한 화면에서 lane별 마지막 성공·실패 이유·비용·runtime SHA를 정확히 읽는다.

## 6. 단계별 용량 계약

`canary 하한`은 하루 시험을 안전하게 실행할 최소 인원이다. `지속 다양성`은 같은 사람과 말투에
몰리지 않고 반복 운영할 목표다. 둘을 하나의 `activePersonaTarget`으로 합치지 않는다.

| 단계 | 글/day | READY/day | 상세 원천/day | canary Persona 하한 | 지속 다양성 | 댓글/day |
|---|---:|---:|---:|---:|---:|---:|
| D3 | 3 | 4 | 12 | 24 | 24 | 3~15 |
| D5 | 5 | 6 | 20 | 24 | 24 | 5~25 |
| D10 | 10 | 12 | 39 | 30 | 30 | 10~50 |
| D20 | 20 | 24 | 77 | 40 | 60 | 20~100 |
| D30 | 30 | 36 | 115 | 60 | 90 | 30~150 |
| D50 | 50 | 60 | 191 | 100 | 150 | 50~250 |
| D100 | 100 | 120 | 382 | 180 | **300+** | 100~500 |

D100의 300명은 상한이 아니다. Persona당 주 3글이면 900 slot이라 필요한 700글보다 약 29%가
남는다. topic mismatch, 휴지기, 댓글 역할, 품질 탈락을 흡수할 첫 목표다.

## 7. 댓글과 대화 확장

M2와 D3~D10은 먼저 **글마다 첫 댓글 1건**을 확실히 만든다. 이것이 끝이라고 읽지 않는다.

1. 첫 댓글: 60분 내 1건, 자기 글·중복·실사용자 침범 0.
2. 다양 댓글: 글 특성에 따라 총 1~5건, 같은 Persona 쏠림·같은 말투를 제한한다.
3. 답글: 실사용자 반응이 있을 때 Persona끼리 자작 대화를 만들지 않고 맥락에 맞게 응답한다.
4. reaction/best: 실제 대화가 안정된 뒤 공개 신호를 사용한다. 가짜 활동 숫자는 만들지 않는다.

2~4번의 구현은 M2 관측을 기다리는 동안 설계·fixture·부하 검증을 병렬 진행한다.

## 8. 마스터와 실행 에이전트 계약

- Codex는 목적, 우선순위, 병렬 분해, PASS 판정, 비용·위험 경계를 소유한다.
- Claude Code는 구현, 검사, PR, 승인된 범위의 merge·배포·운영 관측을 끝까지 수행한다.
- 서로 다른 파일 집합은 병렬화하고, 같은 파일은 한 writer만 가진다.
- 창업자에게 PR마다 승인을 요청하지 않는다. exact head, 필수 CI, 통합 트리, rollback이 green이고
  이미 승인된 계약 안의 가역 변경이면 Codex가 순서를 정하고 Claude가 진행한다.
- 창업자 결정은 새 비용 상한, credential, 법률·브랜드 정책, DB migration, host 최종 cutover처럼
  외부 권한·비가역성이 있는 일에 한정한다.
- 예약 관측을 기다린다는 이유로 다른 구현·검사·Persona·source·host 준비를 멈추지 않는다.

## 9. 빠진 일을 다시 만들지 않는 범위표

| 축 | D10 자동 운영에 필요 | D100 지속 운영에 추가 |
|---|---|---|
| 글 | 자동 READY·발행·감사 | 100/day와 READY 120/day |
| 댓글 | 글마다 60분 내 1건 | 1~5건, reply topology, 집중도 |
| Persona | 계약 유효 30명 | 지속 다양성 300+, 자동 생성·자격화 |
| source | 39 detail/day, 참여 동력·신선도 | 382/day, 82cook 포함 다원화 |
| scheduler | D3/D5/D10 | generic D20/D30/D50/D100 |
| 운영 | 자동 승격·감속·복구 | 부하별 비용·retry·backpressure |
| host | 보조 MacBook 단일 소유 | reboot/network/session 장기 운영 |
| 품질 | founder gold·위해 차단·과차단 회귀 | source-relative vitality와 voice 집중도 |
| 데이터 | 중복·Queue/Post/Comment/Audit 정합 | 장기 보존·복구·관측 장부 |
| 성장 | 현재 blocker 아님 | 7일 재방문 참여 실사용자 North Star |

## 10. 지금 P0가 아닌 것

- 비어 있는 서비스의 실사용자 지표를 자동화보다 먼저 연결하는 일.
- 별도 SEO 정보형 글 레인.
- 매거진 자동화를 위해 D100 job을 멈추거나 reload하는 일.
- 근거 없이 이름만 다른 Persona를 수백 개 만드는 일.
- 한 후보의 결함 때문에 전체 supply·publish·comment를 멈추는 일.

## 11. 충돌 장부

| ID | 현재 충돌 | 최신 계약 | 닫는 증거 |
|---|---|---|---|
| C1 | readiness가 7/14/21일을 첫 canary 선행조건으로 사용 | 첫 시험과 지속 안정성 분리 | PASS 직후 다음 canary 자동 예약 fixture/DB/운영 증명 |
| C2 | readiness가 14일 stock만 사용 | canary 2일치, 지속 14일치 | 두 필드와 두 판정이 보고서에 분리 |
| C3 | 승격 결과가 사람 env 변경을 요구 | controller 자동 적용 | founder/operator 명령 0으로 D3->D5 전이 |
| C4 | M2 health 도구끼리 상태가 모순 | 실제 runner 장부가 단일 진실 | 공개 댓글 + DB/page 일치 + health green |
| C5 | active 24지만 계약 유효 수가 0 또는 미측정 | 자격과 집중도 측정 후 자동 보강 | D10 30명, D20 60명 다양성 목표 |
| C6 | D20 이상 release profile 없음 | generic D3~D100 scheduler | 각 단계 slot/catch-up/load fixture green |
| C7 | source 92.2/day로 D30부터 부족 | 참여 신호 기반 다원화와 82cook canary | D30 115/day, D100 382/day 실측 |
| C8 | main MacBook이 runtime 소유 | 보조 MacBook 단일 소유 | reboot/network recovery 뒤 9 lane proof |
| C9 | 코드가 D100 Persona 목표를 180~200 하나로 표현 | canary floor 180 / 지속 다양성 300+ 분리 | readiness와 assignment가 두 목표를 판정 |
| C10 | 일부 collector/gate가 논쟁·공인 소재를 주제로 배제 | 주제가 아니라 위해만 차단 | founder gold + recent HOLD/DROP false reject 0 |

## 12. 바로 실행할 순서

1. M2 comment health·Queue 계약을 통합하고 다음 자동 글에서 운영 PASS를 만든다.
2. 같은 작업과 병렬로 증거 기반 자동 승격기, 2일/14일 재고 분리, generic D100 scheduler를 만든다.
3. Persona 자격 측정과 부족 축 기반 자동 생성기를 시작한다.
4. 보조 MacBook preflight를 준비하고 창업자가 집에서 연결하면 단일 소유권 cutover를 실행한다.
5. D3 PASS 즉시 D5, D5 PASS 즉시 D10을 자동 시험한다.
6. D20~D100 profile·Persona·source·댓글 부하를 낮은 단계 관측과 병렬로 완성한다.

창업자 수동 검토, 파일 업로드, `human:*` 기록, 반복 명령은 0으로 유지한다.
